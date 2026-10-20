// ================================================================
// api/shared/consig-regras.js — MOTOR DE REGRAS do Vigia de Consignação
//
// 100% DETERMINÍSTICO e sem I/O: entra dado, sai classificação. Nenhuma
// chamada de IA acontece aqui — mesma disciplina do api/chat (o DAX é a
// fonte da verdade) e do gotcha da LICI, onde a quantidade teve que vir do
// PNCP porque a IA desalinhava na quebra de página. A IA entra só na Fase 2,
// para REDIGIR o e-mail de um item JÁ APROVADO — nunca para produzir número.
//
// Duas funções públicas, as duas puras (testáveis com `node -e`):
//   classificar(dados, cfg)          -> { itens, resumo }
//   mesclar(filaAntiga, resultado)   -> { atualizadoEm, itens, resumo }
//
// FORMATO DE ENTRADA (colunar, p/ o POST do navegador caber num request):
//   { gerado, saldo:{cols,rows}, giro90:{...}, giro180:{...}, devol:{...}, meta:{...} }
// ================================================================

const crypto = require('crypto');

function num(v, def) { const n = Number(v); return isFinite(n) && n > 0 ? n : def; }

// ── CONFIG ─────────────────────────────────────────────────────────────────
// Defaults de negócio combinados com o usuário. Cada um pode ser sobrescrito
// por env na SWA (sem deploy de código) e, na chamada, pelo objeto `cfg`.
const CONFIG = {
  validadeCriticaDias: num(process.env.VIGIA_VALIDADE_DIAS, 90),   // "vence logo"
  giroCurtoDias:       num(process.env.VIGIA_GIRO_CURTO, 90),      // janela de consumo curta
  giroLongoDias:       num(process.env.VIGIA_GIRO_LONGO, 180),     // janela de consumo longa
  coberturaMaxMeses:   num(process.env.VIGIA_COBERTURA_MESES, 6),  // acima disso é excesso
  topN:                num(process.env.VIGIA_TOP_N, 200),          // itens enfileirados por rodada
  descarteTtlDias:     num(process.env.VIGIA_DESCARTE_TTL, 90),    // descarte "esquece" depois disso
  podaDias:            num(process.env.VIGIA_PODA_DIAS, 180),      // idade p/ podar resolvido/descartado
  filaMax:             num(process.env.VIGIA_FILA_MAX, 2000),      // teto duro da fila
  // ── SÓ REMESSA DE CONSIGNAÇÃO ENTRA (whitelist) ──
  // O filtro fixo do saldo é 'Grupo de depósitos = ESTOQUE CONSIGNADO/COMODATO':
  // os dois juntos. Para o dashboard tanto faz; para o agente, não — um laser
  // instalado num hospital em comodato NÃO deve ser "recolhido por falta de
  // giro", e como vale centenas de milhares ele monopoliza o topo da fila.
  //
  // Quem separa é o TIPO DE OPERAÇÃO, e o usuário inverteu a lógica em
  // 26/08/26: em vez de TIRAR o que parece comodato, ENTRA só o que começa com
  // `S.CON.00` — "de resto você pode desconsiderar". Whitelist é mais segura
  // que blacklist aqui: uma operação nova que ninguém mapeou fica de fora em
  // vez de entrar como "risco" e cobrar o cliente por um equipamento cedido.
  //
  // ⚠ O corte é feito DEPOIS de somar, sobre o texto da operação — e NÃO como
  // filtro DAX por lista de códigos: a lista dos 7 códigos de consignação ZERA
  // [Consignado - Saldo de remessas] neste visual (comentário em
  // estoque-saldo-consignado.html). Casar por código no resultado é seguro;
  // filtrar por código na origem não é. A página traz a operação como coluna de
  // GRUPO (isso o visual "Saldo por nota" já faz) e lista tudo o que achou.
  //
  // Ainda em 26/08/26 o usuário mandou INCLUIR duas operações de licitação:
  // S.LIC.003 e S.LIC.004. São remessa de verdade (o material fica no cliente
  // do mesmo jeito), só que sob contrato licitado — então cobram vigia igual.
  // ⚠ Entram pelo CÓDIGO EXATO, nunca pelo prefixo largo `S.LIC.00`: as outras
  // S.LIC.00X são venda/faturamento por licitação (S.LIC.002 é uma delas, veja
  // estoque-validade-curta.html) e cairiam na fila junto.
  //
  // Prefixos separados por vírgula, ajustáveis sem deploy por
  // VIGIA_OPERACOES_INCLUIR (ex.: 'S.CON.00, S.LIC.00' para trazer a licitação
  // inteira de uma vez).
  operacoesIncluir:    process.env.VIGIA_OPERACOES_INCLUIR || 'S.CON.00, S.LIC.003, S.LIC.004',
  // Só ROTULA o que ficou de fora ("isso aqui é comodato"), não decide mais
  // nada — quem decide é a whitelist acima. Serve para a radiografia da tela
  // dizer POR QUE cada operação ficou fora, em vez de um "fora" mudo.
  padraoComodato:      process.env.VIGIA_PADRAO_COMODATO || 'comodat|s\\.com\\.'
};

// ── classes, em ordem de severidade (a PRIMEIRA que casar vence) ───────────
const CLASSES = {
  vencido:         { rotulo: 'Vencido no cliente', acao: 'Recolher para perda ou negociar troca',    peso: 5 },
  vencer_sem_giro: { rotulo: 'Vence sem giro',     acao: 'Recolher ou remanejar para outro cliente', peso: 4 },
  vencer_com_giro: { rotulo: 'Vence com giro',     acao: 'Antecipar faturamento ou trocar o lote',   peso: 3 },
  parado:          { rotulo: 'Parado',             acao: 'Renegociar volume ou recolher',            peso: 2 },
  excesso:         { rotulo: 'Excesso',            acao: 'Reduzir na próxima remessa',               peso: 1 }
};

const STATUS_OK = ['pendente', 'aprovado', 'executado', 'descartado', 'resolvido'];
// Status que NUNCA são podados nem sobrescritos por uma varredura nova.
// (A fila do Radar LICI já apagou item APROVADO uma vez — aqui a poda é explícita.)
const STATUS_PROTEGIDO = ['pendente', 'aprovado', 'executado'];

// ── helpers ────────────────────────────────────────────────────────────────
const s = v => (v == null ? '' : String(v)).trim();
const n0 = v => { const x = Number(v); return isFinite(x) ? x : 0; };
const chave = function () { return Array.prototype.map.call(arguments, x => s(x).toUpperCase()).join('|'); };
const idDe = function () { return crypto.createHash('sha1').update(chave.apply(null, arguments)).digest('hex').slice(0, 16); };

// "2027-03-15T00:00:00" | "2027-03-15" -> Date (UTC, meia-noite). Inválido -> null.
function dataDe(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(v));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
function diasEntre(de, ate) { return Math.round((ate - de) / 86400000); }

// tabela colunar {cols,rows} -> [{col:valor}]
function objetos(t) {
  if (!t || !Array.isArray(t.cols) || !Array.isArray(t.rows)) return [];
  return t.rows.map(function (r) {
    const o = {};
    t.cols.forEach(function (c, i) { o[c] = r[i]; });
    return o;
  });
}

// soma uma tabela colunar num mapa "chave composta" -> total
function mapaSoma(t, campos, campoValor) {
  const m = new Map();
  objetos(t).forEach(function (o) {
    const k = chave.apply(null, campos.map(function (c) { return o[c]; }));
    m.set(k, (m.get(k) || 0) + n0(o[campoValor]));
  });
  return m;
}

const fBRL = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fNUM = v => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

const SEM_OPERACAO = '(sem operação)';
const semAcento = v => s(v).normalize('NFD').replace(/[̀-ͯ]/g, '');

// "S.CON.00, S.LIC.00" -> regex ancorada em fronteira de token.
// O teste roda no CÓDIGO e no RÓTULO juntos, então serve tanto se a coluna do
// modelo trouxer "S.CON.001" quanto "S.CON.001 - Saída por consignação". A
// fronteira `(^|[^A-Za-z0-9])` é o que impede "XS.CON.001" de passar.
// Especificação vazia -> null, e o chamador trata como "não filtrar" (NUNCA
// como "não incluir nada": fila vazia se leria como "sem risco").
function reOperacoes(spec) {
  const partes = String(spec == null ? '' : spec).split(/[;,|]/)
    .map(function (x) { return x.trim(); }).filter(Boolean)
    .map(function (x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
  if (!partes.length) return null;
  try { return new RegExp('(^|[^A-Za-z0-9])(' + partes.join('|') + ')', 'i'); }
  catch (e) { return null; }
}

// ── urgência por classe (0..1): a curva que vira prioridade junto com o R$ ──
function urgenciaDe(classe, ctx, cfg) {
  const crit = cfg.validadeCriticaDias;
  const prox = 1 - Math.min(1, Math.max(0, ctx.dias) / crit);   // 1 = vence hoje
  if (classe === 'vencido')         return 1;
  if (classe === 'vencer_sem_giro') return 0.60 + 0.40 * prox;  // 0.60 .. 1.00
  if (classe === 'vencer_com_giro') return 0.30 + 0.20 * prox;  // 0.30 .. 0.50
  // parado há mais tempo pesa mais (satura em 1 ano de consignação)
  if (classe === 'parado')          return 0.35 + 0.25 * Math.min(1, n0(ctx.diasEmConsignacao) / 365);
  // quanto mais acima da cobertura aceitável, mais urgente (satura em 2x o teto)
  if (classe === 'excesso')         return 0.15 + 0.20 * Math.min(1, Math.max(0, ctx.cobertura / cfg.coberturaMaxMeses - 1));
  return 0;
}

// ── QUANTO do saldo está REALMENTE em risco ────────────────────────────────
// Nem toda classe põe o lote inteiro em risco:
//   • vencer_com_giro -> o que NÃO será consumido até a data de vencimento
//   • excesso         -> só o excedente acima da cobertura aceitável
//   • as demais       -> o saldo inteiro (vencido, sem giro e parado não giram)
// Sem isso a prioridade mente: um lote de R$60k com giro passa na frente de um
// de R$25k parado, mesmo quando quase todo o R$60k vai ser consumido a tempo.
function qtdeEmRiscoDe(classe, it, cfg) {
  if (classe === 'vencer_com_giro') {
    const esperado = n0(it.consumoMensal) * (Math.max(0, it.diasParaVencer) / 30);
    return Math.max(0, it.qtde - esperado);
  }
  if (classe === 'excesso') {
    return Math.max(0, it.qtde - cfg.coberturaMaxMeses * n0(it.consumoMensal));
  }
  return it.qtde;
}

// ── frase determinística do "por quê" (a IA da Fase 2 REESCREVE, não recalcula)
function porqueDe(classe, it, cfg) {
  const vol   = fNUM(it.qtde) + ' un · ' + fBRL(it.custo);
  const risco = fNUM(it.qtdeEmRisco) + ' un · ' + fBRL(it.custoEmRisco);
  if (classe === 'vencido')
    return 'Lote venceu há ' + Math.abs(it.diasParaVencer) + ' dias no cliente (' + vol + ').';
  if (classe === 'vencer_sem_giro')
    return 'Vence em ' + it.diasParaVencer + ' dias e não teve consumo nos últimos ' + cfg.giroCurtoDias + ' dias (' + vol + ').';
  if (classe === 'vencer_com_giro')
    return 'Vence em ' + it.diasParaVencer + ' dias; no ritmo de ' + fNUM(it.consumoMensal) + ' un/mês sobram ' + risco + ' sem consumir (saldo de ' + vol + ').';
  // os dias em consignação têm coluna própria na tela — não repetir aqui
  if (classe === 'parado')
    return 'Sem nenhum consumo nos últimos ' + cfg.giroLongoDias + ' dias (' + vol + ').';
  if (classe === 'excesso')
    return 'Saldo cobre ' + fNUM(it.coberturaMeses) + ' meses de consumo — teto de ' + cfg.coberturaMaxMeses + '; excedente de ' + risco + ' (saldo de ' + vol + ').';
  return '';
}

// ── CLASSIFICAÇÃO ──────────────────────────────────────────────────────────
function classificar(dados, cfgIn) {
  const cfg = Object.assign({}, CONFIG, cfgIn || {});
  const d = dados || {};
  const hoje = dataDe(d.gerado) || new Date();

  const g90  = mapaSoma(d.giro90,  ['codcli', 'codprod'], 'qtd');
  const g180 = mapaSoma(d.giro180, ['codcli', 'codprod'], 'qtd');

  // lote com devolução em curso sai da fila: não peça de volta o que já está voltando
  const emDevolucao = new Set();
  objetos(d.devol).forEach(function (o) {
    if (n0(o.saldo) !== 0) emDevolucao.add(chave(o.codcli, o.codprod, o.lote));
  });

  const candidatos = [];
  let semRisco = 0, ignoradosDevolucao = 0, saldoNaoPositivo = 0;

  // Radiografia das operações encontradas — a fonte da verdade sobre o que
  // existe no recorte. É por ela que se descobre o rótulo real do comodato,
  // em vez de deduzir códigos (deduzir já custou caro neste modelo).
  const operacoes = {};
  const fora     = { itens: 0, custo: 0, operacoes: {} };   // tudo o que a whitelist barrou
  const comodato = { itens: 0, custo: 0, operacoes: {} };   // subconjunto do `fora`, só p/ leitura
  // Padrão inválido não pode derrubar a varredura (ele vem de env, editável na
  // SWA por quem não escreve regex): cai no default e segue.
  let reComodato;
  try { reComodato = new RegExp(String(cfg.padraoComodato || CONFIG.padraoComodato), 'i'); }
  catch (e) { reComodato = new RegExp(CONFIG.padraoComodato, 'i'); }
  // Whitelist da operação: remessa de consignação (`S.CON.00*`) + as duas
  // remessas de licitação que o usuário pediu (S.LIC.003 / S.LIC.004).
  const reInclui = reOperacoes(cfg.operacoesIncluir);

  // ── PASSO 1: whitelist da operação + volta ao grão cliente × produto × lote ──
  // A consulta agrupa TAMBÉM por operação (é assim que a operação chega até
  // aqui), então o mesmo lote pode vir em 2+ linhas — S.CON.001 e S.CON.002, por
  // exemplo. Somar de volta é obrigatório: o id do item é o trio
  // cliente/produto/lote, e duas linhas com o mesmo id duplicariam a fila.
  const grupos = new Map();
  objetos(d.saldo).forEach(function (o) {
    const cod = s(o.opcod || o.idop);          // 'S.CON.001'
    const rot = s(o.oplabel || o.tipoop);      // 'Saída por consignação'
    const txt = semAcento(cod + ' ' + rot);
    // A radiografia é agrupada pelo CÓDIGO, não pelo rótulo: é o código que a
    // regra usa, e vários códigos dividem o mesmo rótulo ("Saída por
    // consignação" cobre S.CON.001 e S.CON.002). Agrupar por rótulo escondia
    // justamente o que precisa ser conferido — quais 00X existem no recorte.
    const chaveOp = cod || rot || SEM_OPERACAO;

    // registra a operação ANTES de qualquer corte (o diagnóstico tem que ver tudo)
    const bucket = operacoes[chaveOp] || (operacoes[chaveOp] = { itens: 0, custo: 0, cod: cod, rot: rot, incluida: false, comodato: false });
    if (!bucket.rot && rot) bucket.rot = rot;
    bucket.itens++; bucket.custo += n0(o.custo);
    const ehComodato = reComodato.test(txt);
    if (ehComodato) bucket.comodato = true;

    // Sem prefixo configurado NÃO se filtra nada (o resumo grita) — fila vazia
    // se leria como "sem risco", que é o pior modo de falhar deste agente.
    if (reInclui && !reInclui.test(txt)) {
      fora.itens++; fora.custo += n0(o.custo);
      const fb = fora.operacoes[chaveOp] || (fora.operacoes[chaveOp] = { itens: 0, custo: 0, cod: cod, rot: rot, comodato: ehComodato });
      fb.itens++; fb.custo += n0(o.custo);
      if (ehComodato) {
        comodato.itens++; comodato.custo += n0(o.custo);
        const cb = comodato.operacoes[chaveOp] || (comodato.operacoes[chaveOp] = { itens: 0, custo: 0, rot: rot });
        cb.itens++; cb.custo += n0(o.custo);
      }
      return;
    }
    bucket.incluida = true;

    const k3 = chave(o.codcli, o.codprod, o.lote);
    let g = grupos.get(k3);
    if (!g) {
      g = {
        codcli: s(o.codcli), cliente: s(o.cliente), vendedor: s(o.vendedor),
        codprod: s(o.codprod), produto: s(o.produto), familia: s(o.familia),
        lote: s(o.lote), coddep: s(o.coddep), datavenc: null,
        qtde: 0, custo: 0, aguardfat: 0, diascons: null, datacons: null,
        rotulos: {}, codigos: {}, linhas: 0
      };
      grupos.set(k3, g);
    }
    g.linhas++;
    g.qtde += n0(o.qtde); g.custo += n0(o.custo); g.aguardfat += n0(o.aguardfat);
    ['cliente', 'vendedor', 'produto', 'familia', 'coddep'].forEach(function (c) { if (!g[c]) g[c] = s(o[c]); });
    // MAX dos dias e MIN da data são o MESMO evento: a remessa mais ANTIGA
    // ainda parada nesse cliente × produto × lote.
    const dias = (o.diascons == null || o.diascons === '') ? null : n0(o.diascons);
    if (dias != null && (g.diascons == null || dias > g.diascons)) g.diascons = dias;
    const dtc = s(o.datacons).slice(0, 10);
    if (dtc && (!g.datacons || dtc < g.datacons)) g.datacons = dtc;
    // vencimento: o mais CEDO manda (é o que decide a urgência). Na prática o
    // lote tem uma data só — vem da dimensão 'Lotes' —, mas se vier mais de uma
    // o agente erra para o lado de cobrar antes, não depois.
    const dtv = s(o.datavenc).slice(0, 10);
    if (dtv && (!g.datavenc || dtv < g.datavenc)) g.datavenc = dtv;
    if (rot) g.rotulos[rot] = true;
    if (cod) g.codigos[cod] = true;
  });

  // ── PASSO 2: classificação, agora 1 linha = 1 item da fila ──
  grupos.forEach(function (o) {
    const qtde = n0(o.qtde);
    // saldo <= 0 não é material parado no cliente (é devolução/estorno em excesso)
    if (qtde <= 0) { saldoNaoPositivo++; return; }

    const k3 = chave(o.codcli, o.codprod, o.lote);
    if (emDevolucao.has(k3)) { ignoradosDevolucao++; return; }

    const k2   = chave(o.codcli, o.codprod);
    const c90  = n0(g90.get(k2));
    const c180 = n0(g180.get(k2));
    const venc = dataDe(o.datavenc);
    const dias = venc ? diasEntre(hoje, venc) : null;

    const consumoMensal  = c180 / (cfg.giroLongoDias / 30);
    const coberturaMeses = consumoMensal > 0 ? qtde / consumoMensal : null;

    // ── a cascata de classificação (ordem = severidade, primeira que casa vence) ──
    let classe = null;
    if (dias != null && dias < 0)                             classe = 'vencido';
    else if (dias != null && dias <= cfg.validadeCriticaDias) classe = (c90 === 0 ? 'vencer_sem_giro' : 'vencer_com_giro');
    else if (c180 === 0)                                      classe = 'parado';
    else if (coberturaMeses != null && coberturaMeses > cfg.coberturaMaxMeses) classe = 'excesso';

    if (!classe) { semRisco++; return; }

    const it = {
      id: idDe(o.codcli, o.codprod, o.lote),
      codcli: s(o.codcli), cliente: s(o.cliente), vendedor: s(o.vendedor),
      codprod: s(o.codprod), produto: s(o.produto), familia: s(o.familia),
      lote: s(o.lote), coddep: s(o.coddep),
      // 1 lote pode ter chegado por 2 operações de consignação (001 e 002): as
      // duas ficam registradas, porque foi a soma delas que virou este item.
      operacao: Object.keys(o.rotulos || {}).join(' / ').slice(0, 120),
      idOperacao: Object.keys(o.codigos || {}).join(' / ').slice(0, 60),
      linhasOrigem: n0(o.linhas) || 1,
      datavenc: s(o.datavenc).slice(0, 10) || null,
      diasParaVencer: dias,
      // dias/data da remessa mais ANTIGA ainda parada nesse cliente×produto×lote
      diasEmConsignacao: (o.diascons == null ? null : n0(o.diascons)),
      dataConsignacao: s(o.datacons).slice(0, 10) || null,
      qtde: qtde, custo: n0(o.custo), aguardFat: n0(o.aguardfat),
      consumo90: c90, consumo180: c180,
      consumoMensal: Math.round(consumoMensal * 100) / 100,
      coberturaMeses: (coberturaMeses == null ? null : Math.round(coberturaMeses * 10) / 10),
      classe: classe
    };
    // parcela do saldo efetivamente em risco (e o R$ proporcional a ela)
    const qRisco = qtdeEmRiscoDe(classe, it, cfg);
    it.qtdeEmRisco  = Math.round(qRisco * 100) / 100;
    it.custoEmRisco = Math.round(it.qtde > 0 ? it.custo * (qRisco / it.qtde) : 0);

    const urg = urgenciaDe(classe, {
      dias: (dias == null ? cfg.validadeCriticaDias : dias),
      diasEmConsignacao: it.diasEmConsignacao,
      cobertura: it.coberturaMeses || 0
    }, cfg);
    it.urgencia = Math.round(urg * 100) / 100;
    it.score    = Math.round(it.custoEmRisco * urg);   // R$ em risco × urgência
    it.rotulo   = CLASSES[classe].rotulo;
    it.acao     = CLASSES[classe].acao;
    it.porque   = porqueDe(classe, it, cfg);
    candidatos.push(it);
  });

  candidatos.sort(function (a, b) { return (b.score - a.score) || (b.custoEmRisco - a.custoEmRisco); });
  const itens    = candidatos.slice(0, cfg.topN);
  const cortados = candidatos.length - itens.length;

  // resumo por classe — e o que ficou DE FORA, dito em voz alta. Truncagem
  // silenciosa faz o relatório parecer completo quando não está.
  const porClasse = {};
  Object.keys(CLASSES).forEach(function (c) { porClasse[c] = { rotulo: CLASSES[c].rotulo, itens: 0, custo: 0, custoEmRisco: 0 }; });
  candidatos.forEach(function (i) {
    porClasse[i.classe].itens++;
    porClasse[i.classe].custo += i.custo;
    porClasse[i.classe].custoEmRisco += i.custoEmRisco;
  });
  Object.keys(porClasse).forEach(function (c) {
    porClasse[c].custo = Math.round(porClasse[c].custo);
    porClasse[c].custoEmRisco = Math.round(porClasse[c].custoEmRisco);
  });

  return {
    itens: itens,
    resumo: {
      gerado: d.gerado || new Date().toISOString(),
      linhasLidas: (d.saldo && d.saldo.rows ? d.saldo.rows.length : 0),
      candidatos: candidatos.length,
      enfileirados: itens.length,
      cortadosPorTeto: cortados,
      teto: cfg.topN,
      semRisco: semRisco,
      ignoradosDevolucao: ignoradosDevolucao,
      saldoNaoPositivo: saldoNaoPositivo,
      // ── o que a WHITELIST da operação barrou ──
      // Comodato, licitação, venda, transferência: tudo o que não começa com
      // `S.CON.00` some da fila. O número tem que ficar à vista, senão o
      // dinheiro "desaparece" entre o dashboard e o agente sem explicação.
      operacoesIncluir: cfg.operacoesIncluir,
      fora: {
        itens: fora.itens,
        custo: Math.round(fora.custo),
        operacoes: Object.keys(fora.operacoes).map(function (k) {
          return { operacao: fora.operacoes[k].rot || k, idop: fora.operacoes[k].cod, itens: fora.operacoes[k].itens, custo: Math.round(fora.operacoes[k].custo), comodato: fora.operacoes[k].comodato };
        }).sort(function (a, b) { return b.custo - a.custo; })
      },
      // ⚠ NADA passou pela whitelist, mas havia linha para passar. Quase sempre
      // é a coluna de operação vindo vazia ou com outro formato — e uma fila
      // vazia se leria como "sem risco", que é o pior modo de falhar aqui.
      alertaOperacaoZerou: !!(fora.itens && !grupos.size),
      // sem prefixo nenhum configurado o filtro não é aplicado (degrada para o
      // comportamento antigo: comodato VOLTA para a fila). Também tem que gritar.
      alertaSemFiltroOperacao: !reInclui,
      linhasConsolidadas: grupos.size,
      comodato: {
        itens: comodato.itens,
        custo: Math.round(comodato.custo),
        operacoes: Object.keys(comodato.operacoes).map(function (k) {
          return { operacao: comodato.operacoes[k].rot || k, idop: k, itens: comodato.operacoes[k].itens, custo: Math.round(comodato.operacoes[k].custo) };
        }).sort(function (a, b) { return b.custo - a.custo; })
      },
      padraoComodato: cfg.padraoComodato,
      // radiografia COMPLETA: toda operação do recorte, com itens, R$ e se
      // entrou na fila. Sem ela, o corte seria fé.
      operacoes: Object.keys(operacoes).map(function (k) {
        return { operacao: operacoes[k].rot || k, idop: operacoes[k].cod, itens: operacoes[k].itens, custo: Math.round(operacoes[k].custo), incluida: operacoes[k].incluida, comodato: operacoes[k].comodato };
      }).sort(function (a, b) { return b.custo - a.custo; }),
      // custoSaldo = saldo consignado dos candidatos; custoEmRisco = só a parcela
      // que não deve girar a tempo. É o segundo que manda na prioridade.
      custoSaldo: Math.round(candidatos.reduce(function (a, i) { return a + i.custo; }, 0)),
      custoEmRisco: Math.round(candidatos.reduce(function (a, i) { return a + i.custoEmRisco; }, 0)),
      custoEnfileirado: Math.round(itens.reduce(function (a, i) { return a + i.custoEmRisco; }, 0)),
      porClasse: porClasse,
      fonteTruncada: !!(d.meta && d.meta.truncado),
      camposIgnorados: (d.meta && d.meta.camposIgnorados) || [],
      // total de controle medido pelo coletor (recorte sem coluna de grupo) x o
      // que ele leu agrupado. Divergir = agrupar por operação mexeu na soma.
      controle: (d.meta && d.meta.controle) || null,
      // linhas que cada consulta de apoio trouxe. Giro vazio faz TODO item de
      // validade longa cair em "Parado" — o número tem que ficar à vista.
      giro90Linhas: (d.giro90 && d.giro90.rows ? d.giro90.rows.length : 0),
      giro180Linhas: (d.giro180 && d.giro180.rows ? d.giro180.rows.length : 0),
      devolLinhas: (d.devol && d.devol.rows ? d.devol.rows.length : 0),
      config: {
        validadeCriticaDias: cfg.validadeCriticaDias, giroCurtoDias: cfg.giroCurtoDias,
        giroLongoDias: cfg.giroLongoDias, coberturaMaxMeses: cfg.coberturaMaxMeses, topN: cfg.topN
      }
    }
  };
}

// ── MESCLA com a fila existente ────────────────────────────────────────────
// A decisão do operador é SOBERANA e nunca é apagada por uma varredura:
//   • item novo ....................... entra como "pendente"
//   • pendente que voltou ............. números atualizados, detectadoEm preservado
//   • aprovado / executado ............ números atualizados, status intocado
//   • descartado dentro do TTL ........ continua descartado, +1 reincidência
//   • descartado fora do TTL .......... volta a pendente (o motivo vira histórico)
//   • resolvido que voltou ............ volta a pendente
//   • sumiu da varredura .............. pendente -> "resolvido"; o resto fica
//   • poda ............................ SÓ resolvido/descartado antigos
//
// O descarte com memória é o que compensa a falta de um campo de "lote
// reservado para cirurgia": o operador descarta uma vez e o item não volta a
// incomodar por `descarteTtlDias` — mas volta depois, porque a reserva expira.
function mesclar(filaAntiga, resultado, cfgIn) {
  const cfg    = Object.assign({}, CONFIG, cfgIn || {});
  const agora  = new Date();
  const nowIso = agora.toISOString();

  const antigos = new Map();
  ((filaAntiga && filaAntiga.itens) || []).forEach(function (e) { if (e && e.id) antigos.set(e.id, e); });

  const vistos = new Set();
  const saida  = [];

  (resultado.itens || []).forEach(function (novo) {
    vistos.add(novo.id);
    const velho = antigos.get(novo.id);
    if (!velho) {
      saida.push(Object.assign({}, novo, { status: 'pendente', detectadoEm: nowIso, atualizadoEm: nowIso }));
      return;
    }
    // sobrescreve o que é MEDIDA; preserva o que é DECISÃO
    const e = Object.assign({}, velho, novo, {
      status: velho.status,
      detectadoEm: velho.detectadoEm || nowIso,
      atualizadoEm: nowIso
    });

    if (velho.status === 'descartado') {
      const dec = Date.parse(velho.decididoEm || '');
      const expirou = !isFinite(dec) || (agora - dec) / 86400000 > cfg.descarteTtlDias;
      if (expirou) {
        e.historico = (velho.historico || []).concat([{ em: velho.decididoEm || null, status: 'descartado', motivo: velho.motivo || null, operador: velho.operador || null }]);
        e.status = 'pendente'; e.motivo = null; e.decididoEm = null; e.operador = null;
        e.reabertoEm = nowIso;
      } else {
        e.reincidencias = n0(velho.reincidencias) + 1;
      }
    } else if (velho.status === 'resolvido') {
      e.historico = (velho.historico || []).concat([{ em: velho.decididoEm || velho.atualizadoEm || null, status: 'resolvido' }]);
      e.status = 'pendente'; e.motivo = null; e.decididoEm = null; e.operador = null;
      e.reabertoEm = nowIso;
    }
    saida.push(e);
  });

  // o que NÃO apareceu nesta varredura
  antigos.forEach(function (velho, id) {
    if (vistos.has(id)) return;
    if (velho.status === 'pendente') {
      saida.push(Object.assign({}, velho, {
        status: 'resolvido', decididoEm: nowIso, operador: 'sistema (auto)',
        motivo: 'RISCO NÃO APARECEU NA ÚLTIMA VARREDURA'
      }));
      return;
    }
    saida.push(velho);   // aprovado/executado/descartado/resolvido seguem intactos
  });

  // ── PODA — só o que já não exige ação; status protegido nunca sai ──
  const limite = cfg.podaDias * 86400000;
  function podavel(e) {
    if (['resolvido', 'descartado'].indexOf(e.status) < 0) return false;
    const t = Date.parse(e.decididoEm || '');
    return isFinite(t) && (agora - t) > limite;
  }
  let itens = saida.filter(function (e) { return !podavel(e); });
  const podados = saida.length - itens.length;

  // teto duro da fila: se ainda estourar, corta pelos NÃO protegidos de menor score
  let cortadosDaFila = 0;
  if (itens.length > cfg.filaMax) {
    const protegidos = itens.filter(function (e) { return STATUS_PROTEGIDO.indexOf(e.status) >= 0; });
    const resto = itens.filter(function (e) { return STATUS_PROTEGIDO.indexOf(e.status) < 0; })
                       .sort(function (a, b) { return n0(b.score) - n0(a.score); });
    const cabem = Math.max(0, cfg.filaMax - protegidos.length);
    cortadosDaFila = Math.max(0, resto.length - cabem);
    itens = protegidos.concat(resto.slice(0, cabem));
  }

  const ordem = { pendente: 0, aprovado: 1, executado: 2, descartado: 3, resolvido: 4 };
  itens.sort(function (a, b) { return (ordem[a.status] - ordem[b.status]) || (n0(b.score) - n0(a.score)); });

  const contagem = {};
  STATUS_OK.forEach(function (st) { contagem[st] = itens.filter(function (e) { return e.status === st; }).length; });

  return {
    atualizadoEm: nowIso,
    itens: itens,
    resumo: Object.assign({}, resultado.resumo, {
      podados: podados, cortadosDaFila: cortadosDaFila, contagem: contagem, totalFila: itens.length
    })
  };
}

module.exports = { CONFIG, CLASSES, STATUS_OK, STATUS_PROTEGIDO, classificar, mesclar, idDe };
