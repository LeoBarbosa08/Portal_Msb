// ================================================================
// api/shared/funil-sf.js — FUNIL DE VENDAS da Licitação · leitura do SF
//
// Lê as NEGOCIAÇÕES (Opportunity) do tipo de registro Licitação direto
// do Salesforce (org do CRM, a mesma da LICI) e devolve linhas planas
// para a página montar o funil. SOMENTE LEITURA.
//
// Três decisões que sustentam o módulo:
//
// 1. Os CAMPOS são resolvidos pelo describe, nunca chutados. Cada chave
//    tem candidatas por nome de API e por RÓTULO; a que não existe na org
//    sai do SELECT (e a página diz qual faltou) em vez de derrubar a
//    consulta inteira com "No such column". Só Id/Name/StageName são
//    obrigatórios.
// 2. As FASES vêm na ordem do PROCESSO DE VENDA do tipo de registro
//    (UI API: picklist de StageName por record type), e o "fechada/ganha"
//    de cada uma vem do OpportunityStage (IsClosed/IsWon). Sem UI API cai
//    no describe; sem OpportunityStage cai numa heurística pelo nome — e a
//    resposta diz qual fonte respondeu (`fonteFases`).
// 3. O período é UM campo de data escolhido pela tela (Data da
//    Participação por padrão). Negociação sem essa data fica FORA do
//    intervalo, mas é CONTADA à parte (`semData`) — some da tela, não
//    some do número.
//
// 4. O ESCOPO decide QUAIS negociações entram (`?escopo=`):
//      licitacao (padrão)  as do tipo de registro Licitação — o funil;
//      lici                as que a LICI criou: checkbox "Lici" marcado,
//                          de qualquer tipo de registro. Vem junto o
//                          "Manual Lici" (marcado = edital enviado à mão;
//                          desmarcado = o agente achou sozinho) — é o que o
//                          Relatório da LICI separa. A ordem das fases segue
//                          a do processo do tipo Licitação.
//
// 5. `?hist=1` (Funil Semanal) traz junto o CAMINHO de fases de cada
//    negociação, do OpportunityHistory: é ele que diz até onde a negociação
//    CHEGOU (uma perdida que passou do pregão converteu antes de perder) e
//    QUANDO — o que deixa comparar safras com o mesmo tempo de vida. Sem
//    acesso ao histórico, a coluna não vem e a tela usa a fase atual.
//
// 6. `?mov=1` (Funil Semanal) traz um 2º bloco, `fechadas`: as negociações
//    cuja fase VIROU fechada (ganha, perdida, cancelada…) dentro da janela,
//    criadas quando for — "o que foi ganho e perdido na semana" não depende
//    de quando a negociação nasceu. Ver encerradasNaJanela().
//
// 7. `?itens=1` (Analítico do Funil de Vendas) traz os ITENS da proposta
//    de cada negociação (a sincronizada; sem ela, a mais recente):
//    resultado do item, justificativa da perda, nosso preço, o lance do 1º
//    colocado, família… É deles que sai o "o que perdi e por quê" — o
//    Motivo da Perda da Negociação fica vazio na org (0 de 79 encerradas
//    em 120 dias, 08/10/2026). Sem ?mov=1 (16/10/2026: o Analítico pela
//    data da participação, casado com a Visão Geral) vêm no bloco `itens`,
//    de TODAS as negociações da lista; com ?mov=1, pendurados nas
//    `fechadas`. Ver itensDasEncerradas().
//
// O módulo não fala HTTP sozinho: recebe um `sf` com { soql, describe,
// restGet } (o adaptador real está em `adaptador(SF)`), o que deixa o
// harness de teste dublar o Salesforce inteiro.
// ================================================================

'use strict';

// ── campos (chave → candidatas) ─────────────────────────────────────
// lookup: o campo é uma referência e o que se lê é `<relação>.<lookup>`
const CAMPOS = [
  { k: 'id',      api: ['Id'],                                obrig: true },
  { k: 'nome',    api: ['Name'],                              obrig: true },
  { k: 'fase',    api: ['StageName'],                         obrig: true },
  { k: 'valor',   api: ['Amount'],                            tipo: 'num' },
  { k: 'dpart',   api: ['Data_de_Participacao__c'],           rot: ['Data da Participação', 'Data de Participação'], tipo: 'date' },
  { k: 'dfech',   api: ['CloseDate'],                         tipo: 'date' },
  { k: 'dcria',   api: ['CreatedDate'],                       tipo: 'datetime' },
  { k: 'dfase',   api: ['LastStageChangeDate'],               tipo: 'datetime' },
  { k: 'status',  api: ['Fase_da_Oportunidade__c'],           rot: ['Status'] },
  { k: 'numero',  api: ['Numero_da_Licitacao__c'],            rot: ['Número da Licitação'] },
  { k: 'apelido', api: ['Apelido_da_Negociacao__c'],          rot: ['Apelido da Negociação'] },
  { k: 'conta',   api: ['AccountId'],                         lookup: 'Name' },
  { k: 'uf',      api: ['Estado_de_Entrega__c'],              rot: ['Estado de Entrega'] },
  { k: 'esfera',  api: ['Esfera__c'],                         rot: ['Esfera'] },
  { k: 'modal',   api: ['Modalidade__c'],                     rot: ['Modalidade'] },
  { k: 'disputa', api: ['Modo_de_Disputa__c'],                rot: ['Modo de Disputa'] },
  { k: 'forma',   api: ['Forma_de_Participacao__c'],          rot: ['Forma de Participação'] },
  { k: 'origem',  api: ['Origem_da_Oportunidade__c'],         rot: ['Origem'] },
  { k: 'vend',    api: ['Vendedor_Representante__c'],         rot: ['Vendedor / Representante'], lookup: 'Name' },
  { k: 'ger',     api: ['Gerente__c'],                        rot: ['Gerente'], lookup: 'Name' },
  { k: 'dono',    api: ['OwnerId'],                           lookup: 'Name' },
  { k: 'unid',    api: ['Unidade_de_Negocio_da_Conta__c'],    rot: ['Unidade de Negócio da Conta'] },
  { k: 'msb',     api: ['Negocia_o_MSB__c'],                  rot: ['Faturamento MSB?'] },
  { k: 'motivo',  api: ['Motivo_da_Perda__c', 'Justificativa_da_Perda__c'], rot: ['Motivo da Perda', 'Justificativa da Perda', 'Motivo de Perda'] },
  // Tipo de faturamento (venda, consignação, comodato…): o nome de API não
  // foi conferido na org, então vale também um rótulo PARECIDO ("tipo" +
  // "faturamento") — só em campo de texto/lista, nunca num valor em R$. Se a
  // Negociação não tiver o campo, ele é procurado na PROPOSTA sincronizada
  // (SyncedQuote), que é de onde o modelo de BI da Licitação costuma tirá-lo.
  { k: 'tfat',    api: ['Tipo_de_Faturamento__c', 'Tipo_Faturamento__c', 'TipoFaturamento__c', 'Tipo_do_Faturamento__c'],
                  rot: ['Tipo de Faturamento', 'Tipo do Faturamento', 'Tipo Faturamento'], parecido: /\btipo\b.*\bfaturamento\b/, texto: true, viaProposta: true }
];

// só no escopo LICI. Os dois são CHECKBOX no Salesforce: campo achado pelo
// nome ou rótulo que não seja booleano não serve (o WHERE "= true" quebraria)
const CAMPOS_LICI = [
  { k: 'lici',   api: ['Lici__c'],        rot: ['Lici'],        tipo: 'bool' },
  { k: 'manual', api: ['Manual_Lici__c'], rot: ['Manual Lici'], tipo: 'bool' }
];

// escopos aceitos em ?escopo= (ver o item 4 do cabeçalho)
const ESCOPOS = { licitacao: 1, lici: 1 };
function lerEscopo(q) {
  const e = String((q && q.escopo) || 'licitacao').trim().toLowerCase();
  if (!ESCOPOS[e]) { const x = new Error('escopo inválido'); x.status = 400; x.publicMessage = 'Escopo inválido (use licitacao ou lici).'; throw x; }
  return e;
}

// tipos do describe que servem de categoria (o rótulo parecido não pode
// casar um campo de moeda chamado "Tipo de faturamento (R$)")
const TIPOS_TEXTO = { picklist: 1, multipicklist: 1, string: 1, combobox: 1, textarea: 1 };

// base de data do período (a tela escolhe uma)
const BASES = {
  participacao: 'dpart',
  fechamento:   'dfech',
  criacao:      'dcria'
};

// tipos de registro aceitos (nome ou nome de API, sem acento/caixa)
function tiposDoEnv(env) {
  const bruto = String((env && env.FUNIL_TIPOS_REGISTRO) || 'Licitação');
  return bruto.split(/[;,]/).map(norm).filter(Boolean);
}

function norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// ── resolução de campos pelo describe ───────────────────────────────
// Ordem: nome de API → rótulo exato → rótulo parecido (só quem declara
// `parecido`). Campo `texto` só aceita tipo de categoria pelo rótulo.
function indiceCampos(desc) {
  const ix = { fs: desc.fields || [], porNome: {}, porRot: {} };
  ix.fs.forEach(function (f) {
    ix.porNome[String(f.name).toLowerCase()] = f;
    const r = norm(f.label);
    if (r && !ix.porRot[r]) ix.porRot[r] = f;
  });
  return ix;
}
function acharCampo(ix, c) {
  const serve = function (f) { return !!f && (!c.texto || !!TIPOS_TEXTO[String(f.type || '').toLowerCase()]) && (c.tipo !== 'bool' || ehBool(f)); };
  let f = null;
  for (let i = 0; i < c.api.length && !f; i++) { const x = ix.porNome[c.api[i].toLowerCase()] || null; if (x && (c.tipo !== 'bool' || ehBool(x))) f = x; }
  for (let i = 0; c.rot && i < c.rot.length && !f; i++) { const x = ix.porRot[norm(c.rot[i])]; if (serve(x)) f = x; }
  if (!f && c.parecido) f = ix.fs.filter(function (x) { return c.parecido.test(norm(x.label)) && serve(x); })[0] || null;
  return f;
}
function ehBool(f) { return String(f.type || '').toLowerCase() === 'boolean'; }
function resolverCampos(desc, lista) {
  const ix = indiceCampos(desc), out = {};
  (lista || CAMPOS).forEach(function (c) {
    const f = acharCampo(ix, c);
    if (!f) { out[c.k] = { ok: false }; return; }
    if (c.lookup) {
      if (!f.relationshipName) { out[c.k] = { ok: false, api: f.name, motivo: 'sem relação' }; return; }
      out[c.k] = { ok: true, api: f.name, sel: f.relationshipName + '.' + c.lookup, rel: f.relationshipName, sub: c.lookup, label: f.label };
      return;
    }
    out[c.k] = { ok: true, api: f.name, sel: f.name, label: f.label, tipoSf: f.type };
  });
  return out;
}

// campo `viaProposta` que a Negociação não tem: procura na Quote e lê pela
// relação da proposta SINCRONIZADA (SyncedQuote.<campo>) — um valor por
// negociação, sem subconsulta. Org sem Cotações, ou run-as sem acesso à
// Quote, só deixa o campo de fora (a tela diz que ele faltou).
async function resolverViaProposta(sf, desc, campos, avisos) {
  const faltam = CAMPOS.filter(function (c) { return c.viaProposta && !campos[c.k].ok; });
  if (!faltam.length) return;
  const sync = (desc.fields || []).filter(function (f) { return f.name === 'SyncedQuoteId' && f.relationshipName; })[0];
  if (!sync) return;
  let dq;
  try { dq = await sf.describe('Quote'); } catch (e) { avisos.push('tipo de faturamento: proposta indisponível (' + curto(e) + ')'); return; }
  const ix = indiceCampos(dq);
  faltam.forEach(function (c) {
    const f = acharCampo(ix, c);
    if (!f) return;
    campos[c.k] = { ok: true, api: 'Quote.' + f.name, sel: sync.relationshipName + '.' + f.name, rel: sync.relationshipName, sub: f.name, label: f.label, tipoSf: f.type, fonte: 'proposta' };
  });
}

// ── tipos de registro ───────────────────────────────────────────────
function tiposRegistro(desc, env) {
  const alvo = tiposDoEnv(env);
  const infos = (desc.recordTypeInfos || []).filter(function (r) { return r && r.active !== false && !r.master; });
  const disponiveis = infos.map(function (r) { return r.name; });
  const casados = infos.filter(function (r) {
    const n = norm(r.name), d = norm(r.developerName);
    return alvo.some(function (a) { return a === n || a === d; });
  });
  return { ids: casados.map(function (r) { return r.recordTypeId; }), nomes: casados.map(function (r) { return r.name; }), disponiveis: disponiveis };
}

// ── fases (ordem do processo + fechada/ganha) ───────────────────────
const RX_GANHA  = /^(ganha|ganho|fechado e ganho|concluida|vencedor|homologad|adjudicad)/;
const RX_FECHA  = /(ganh|perd|cancel|suspens|nao autoriz|finaliz|revogad|encerrad|conclu|fracassad|desert)/;

async function fasesMeta(sf, desc, rtIds) {
  const avisos = [];
  // 1) ordem do PROCESSO de venda do tipo de registro (UI API)
  let ordem = null, fonteOrdem = null;
  if (rtIds.length && typeof sf.restGet === 'function') {
    try {
      const vistos = {}, lista = [];
      for (const rt of rtIds) {
        const j = await sf.restGet('/ui-api/object-info/Opportunity/picklist-values/' + rt + '/StageName');
        (j && j.values || []).forEach(function (v) {
          if (vistos[v.value]) return; vistos[v.value] = 1;
          lista.push({ nome: v.value, rotulo: v.label || v.value });
        });
      }
      if (lista.length) { ordem = lista; fonteOrdem = 'processo'; }
    } catch (e) { avisos.push('ordem das fases pelo processo de venda indisponível (' + curto(e) + ')'); }
  }
  // 2) sem UI API: ordem do picklist inteiro da org (inclui fases de outros tipos)
  if (!ordem) {
    const f = (desc.fields || []).filter(function (x) { return x.name === 'StageName'; })[0];
    ordem = ((f && f.picklistValues) || []).filter(function (p) { return p.active !== false; })
      .map(function (p) { return { nome: p.value, rotulo: p.label || p.value }; });
    fonteOrdem = 'picklist';
  }
  // 3) fechada/ganha: OpportunityStage
  let flags = null, fonteFlags = null;
  try {
    let recs;
    try { recs = await sf.soql('SELECT ApiName, MasterLabel, SortOrder, IsClosed, IsWon, IsActive, DefaultProbability FROM OpportunityStage'); }
    catch (e) { recs = await sf.soql('SELECT MasterLabel, SortOrder, IsClosed, IsWon, IsActive, DefaultProbability FROM OpportunityStage'); }
    flags = {};
    recs.forEach(function (r) {
      const info = { fechada: !!r.IsClosed, ganha: !!r.IsWon, prob: r.DefaultProbability == null ? null : Number(r.DefaultProbability), sort: r.SortOrder };
      if (r.ApiName) flags[r.ApiName] = info;
      if (r.MasterLabel && !flags[r.MasterLabel]) flags[r.MasterLabel] = info;
    });
    fonteFlags = 'opportunitystage';
  } catch (e) {
    avisos.push('fechada/ganha de cada fase deduzido pelo nome (OpportunityStage indisponível: ' + curto(e) + ')');
    fonteFlags = 'heuristica';
  }
  const fases = ordem.map(function (o, i) {
    const f = flags && (flags[o.nome] || flags[o.rotulo]);
    const n = norm(o.nome);
    const ganha = f ? f.ganha : RX_GANHA.test(n);
    const fechada = f ? f.fechada : (ganha || RX_FECHA.test(n));
    return { nome: o.nome, rotulo: o.rotulo, ordem: i, fechada: fechada, ganha: ganha, prob: f ? f.prob : null };
  });
  return { fases: fases, fonte: fonteOrdem + '+' + fonteFlags, avisos: avisos };
}

function curto(e) { return String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 120); }

// ── período ─────────────────────────────────────────────────────────
const RX_DIA = /^\d{4}-\d{2}-\d{2}$/;
function lerPeriodo(q) {
  const base = BASES[String(q.base || 'participacao').toLowerCase()] ? String(q.base || 'participacao').toLowerCase() : null;
  if (!base) { const e = new Error('base inválida (use participacao, fechamento ou criacao)'); e.status = 400; e.publicMessage = e.message; throw e; }
  const de = String(q.de || '').trim(), ate = String(q.ate || '').trim();
  [de, ate].forEach(function (d) {
    if (d && (!RX_DIA.test(d) || isNaN(Date.parse(d + 'T00:00:00Z')))) {
      const e = new Error('data inválida: ' + d.slice(0, 20)); e.status = 400; e.publicMessage = 'Data inválida (use AAAA-MM-DD).'; throw e;
    }
  });
  if (de && ate && de > ate) { const e = new Error('de > ate'); e.status = 400; e.publicMessage = 'O início do período é depois do fim.'; throw e; }
  return { base: base, de: de, ate: ate, semData: String(q.semdata || '') === '1', hist: String(q.hist || '') === '1', mov: String(q.mov || '') === '1',
    itens: String(q.itens || '') === '1' };
}

// condição SOQL do período no campo resolvido (date ou datetime)
function condPeriodo(campo, tipo, de, ate) {
  const c = [];
  if (tipo === 'datetime') {
    // datetime: o dia é o de Brasília (-03:00), senão a negociação criada
    // às 22h do dia 31 cairia no mês seguinte
    if (de)  c.push(campo + ' >= ' + de + 'T00:00:00-03:00');
    if (ate) c.push(campo + ' <= ' + ate + 'T23:59:59-03:00');
  } else {
    if (de)  c.push(campo + ' >= ' + de);
    if (ate) c.push(campo + ' <= ' + ate);
  }
  return c.join(' AND ');
}

function listaIds(ids) {
  return ids.map(function (i) { return "'" + String(i).replace(/[^A-Za-z0-9]/g, '') + "'"; }).join(', ');
}

// ── valor de uma linha ──────────────────────────────────────────────
function diaBrt(v) {
  if (!v) return null;
  const s = String(v);
  if (RX_DIA.test(s)) return s;
  const t = Date.parse(s);
  if (isNaN(t)) return s.slice(0, 10);
  return new Date(t - 3 * 3600 * 1000).toISOString().slice(0, 10);
}
function valorDe(rec, c, meta) {
  if (!meta || !meta.ok) return null;
  let v;
  if (meta.rel) { const o = rec[meta.rel]; v = o ? o[meta.sub] : null; }
  else v = rec[meta.api];
  if (v == null || v === '') return null;
  if (c.tipo === 'num') { const n = Number(v); return isFinite(n) ? n : null; }
  if (c.tipo === 'bool') return v === true || v === 'true';
  if (c.tipo === 'date' || c.tipo === 'datetime') return diaBrt(v);
  if (Array.isArray(v)) return v.join('; ');
  return typeof v === 'object' ? null : String(v);
}

// ── propostas (Quote) das negociações do período ────────────────────
// O Analítico lê PROPOSTA e ITEM no modelo de BI, que casa pelo NOME da
// negociação. Esta contagem é a verdade do Salesforce — a mesma fonte das
// negociações — e serve para a tela saber se o modelo trouxe todas as
// propostas ou ficou devendo (o que antes passava como "sem proposta").
//
// Uma consulta só, com o MESMO recorte de período das negociações (pelo
// pai: Opportunity.<campo de data>). Se a org não tiver Cotações, ou o
// run-as não enxergar, sai um aviso e a tela segue sem a contagem.
// `filtro` é o recorte do escopo visto pela proposta (Opportunity.<...>)
async function propostasDoPeriodo(sf, filtro, mData, cData, per, maxPaginas) {
  let dq;
  try { dq = await sf.describe('Quote'); } catch (e) { return { ok: false, motivo: 'propostas indisponíveis (' + curto(e) + ')' }; }
  const temQ = {}; (dq.fields || []).forEach(function (f) { temQ[f.name] = 1; });
  if (!temQ.OpportunityId) return { ok: false, motivo: 'a Cotação não tem OpportunityId' };
  const cols = ['OpportunityId'].concat(temQ.IsSyncing ? ['IsSyncing'] : []);
  const onde = [filtro];
  const cp = condPeriodo('Opportunity.' + mData.api, cData.tipo, per.de, per.ate);
  if (cp) onde.push(per.semData ? '((' + cp + ') OR Opportunity.' + mData.api + ' = null)' : cp);
  let qs;
  try { qs = await sf.soql('SELECT ' + cols.join(', ') + ' FROM Quote WHERE ' + onde.join(' AND '), maxPaginas); }
  catch (e) { return { ok: false, motivo: 'contagem de propostas recusada pelo Salesforce (' + curto(e) + ')' }; }
  const porOpp = {};
  let total = 0;
  qs.forEach(function (q) {
    const k = q.OpportunityId; if (!k) return;
    const a = porOpp[k] || (porOpp[k] = { n: 0, s: 0 });
    a.n++; total++;
    if (q.IsSyncing === true) a.s++;
  });
  return { ok: true, porOpp: porOpp, total: total, sincronizada: !!temQ.IsSyncing };
}

// ── caminho de fases (OpportunityHistory) ───────────────────────────
// Uma linha por mudança registrada (fase, valor, data de fechamento…): o
// que interessa é a FASE e o dia. Sai, por negociação, a lista
// [[fase, 'AAAA-MM-DD'], …] em ordem de tempo, sem repetir a fase seguida
// (mudar o valor não é andar no funil). Ids em lotes — a lista já está na
// mão e não depende de a org aceitar filtro pelo pai no histórico.
const HIST_LOTE = 200, HIST_MAX_OPPS = 4000;
async function historicoFases(sf, ids, maxPaginas) {
  if (!ids.length) return { ok: true, porOpp: {}, linhas: 0 };
  if (ids.length > HIST_MAX_OPPS) return { ok: false, motivo: 'caminho das fases só até ' + HIST_MAX_OPPS.toLocaleString('pt-BR') + ' negociações — estreite a janela' };
  const lotes = [];
  for (let i = 0; i < ids.length; i += HIST_LOTE) lotes.push(ids.slice(i, i + HIST_LOTE));
  const brutos = {};
  let linhas = 0;
  try {
    // 3 lotes por vez: o histórico de um ano inteiro não vira 20 idas em fila
    for (let i = 0; i < lotes.length; i += 3) {
      const rs = await Promise.all(lotes.slice(i, i + 3).map(function (l) {
        return sf.soql('SELECT OpportunityId, StageName, CreatedDate FROM OpportunityHistory WHERE OpportunityId IN (' + listaIds(l) +
          ') ORDER BY OpportunityId, CreatedDate', maxPaginas);
      }));
      rs.forEach(function (recs) {
        recs.forEach(function (h) {
          if (!h.OpportunityId || !h.StageName) return;
          linhas++;
          (brutos[h.OpportunityId] || (brutos[h.OpportunityId] = [])).push([h.StageName, h.CreatedDate || '']);
        });
      });
    }
  } catch (e) { return { ok: false, motivo: 'caminho das fases indisponível (' + curto(e) + ')' }; }
  const porOpp = {};
  Object.keys(brutos).forEach(function (id) {
    const ev = brutos[id].sort(function (a, b) { return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0; });
    const out = [];
    ev.forEach(function (x) { if (!out.length || out[out.length - 1][0] !== x[0]) out.push([x[0], diaBrt(x[1])]); });
    porOpp[id] = out;
  });
  return { ok: true, porOpp: porOpp, linhas: linhas };
}

// ── ENCERRADAS na janela (?mov=1 — Funil Semanal) ───────────────────
// "O que foi ganho e perdido na semana": a negociação cuja fase VIROU
// fechada dentro da janela, criada quando for. O dia é o da TROCA DE FASE —
// não o CloseDate, que é a data prevista/do certame e costuma ficar semanas
// antes (uma Ganha registrada em 14/09 tinha "Data de fechamento" 24/08).
//   1º  LastStageChangeDate da Negociação: numa fechada, o dia em que
//       fechou. A criada já fechada pode vir sem ele — aí vale a criação.
//   2º  sem o campo (ou com o SOQL recusando): o OpportunityHistory diz quem
//       teve linha numa fase fechada dentro da janela; o dia sai depois, do
//       caminho de fases (`diaFechouPeloCaminho`) — mudar o valor de uma
//       ganha antiga também grava linha, e essa não fechou na janela.
// Devolve os registros crus (mesmo SELECT das negociações) e, no 1º caso,
// o dia de cada uma.
async function encerradasNaJanela(sf, desc, campos, usados, filtro, fases, per, maxPaginas) {
  if (!per.de) return { ok: false, motivo: 'ganhas e perdidas da semana só com uma janela de datas' };
  const nomes = fases.filter(function (f) { return f.fechada; }).map(function (f) { return "'" + soqlTxt(f.nome) + "'"; });
  if (!nomes.length) return { ok: false, motivo: 'o processo de venda não tem fase fechada' };
  const tem = {}; (desc.fields || []).forEach(function (f) { tem[f.name] = 1; });
  const fechada = tem.IsClosed ? 'IsClosed = true' : 'StageName IN (' + nomes.join(', ') + ')';
  const sel = 'SELECT ' + usados.map(function (c) { return campos[c.k].sel; }).join(', ') + ' FROM Opportunity WHERE ' + filtro + ' AND ' + fechada;
  const avisos = [];
  const mF = campos.dfase, mC = campos.dcria;
  if (mF.ok) {
    let cond = condPeriodo(mF.api, 'datetime', per.de, per.ate);
    if (mC.ok) cond = '((' + cond + ') OR (' + mF.api + ' = null AND ' + condPeriodo(mC.api, 'datetime', per.de, per.ate) + '))';
    try {
      const recs = await sf.soql(sel + ' AND ' + cond + ' ORDER BY ' + mF.api + ' DESC NULLS LAST, Id', maxPaginas);
      const dia = {};
      recs.forEach(function (r) { dia[r.Id] = diaBrt(r[mF.api]) || (mC.ok ? diaBrt(r[mC.api]) : null); });
      return { ok: true, fonte: 'fase', recs: recs, dia: dia, truncado: recs.length >= maxPaginas * 2000, avisos: avisos };
    } catch (e) { avisos.push('data da troca de fase recusada pelo Salesforce (' + curto(e) + ') — ganhas e perdidas lidas pelo histórico'); }
  }
  let hs;
  try {
    hs = await sf.soql('SELECT OpportunityId FROM OpportunityHistory WHERE ' + condPeriodo('CreatedDate', 'datetime', per.de, per.ate) +
      ' AND StageName IN (' + nomes.join(', ') + ')', 20);
  } catch (e) { return { ok: false, motivo: 'ganhas e perdidas da semana indisponíveis (' + curto(e) + ')', avisos: avisos }; }
  const vistos = {}, ids = [];
  hs.forEach(function (h) { if (h.OpportunityId && !vistos[h.OpportunityId]) { vistos[h.OpportunityId] = 1; ids.push(h.OpportunityId); } });
  if (ids.length > HIST_MAX_OPPS) return { ok: false, motivo: 'ganhas e perdidas da semana só até ' + HIST_MAX_OPPS.toLocaleString('pt-BR') + ' negociações — estreite a janela', avisos: avisos };
  const recs = [];
  try {
    for (let i = 0; i < ids.length; i += HIST_LOTE) {
      (await sf.soql(sel + ' AND Id IN (' + listaIds(ids.slice(i, i + HIST_LOTE)) + ')', maxPaginas)).forEach(function (r) { recs.push(r); });
    }
  } catch (e) { return { ok: false, motivo: 'ganhas e perdidas da semana indisponíveis (' + curto(e) + ')', avisos: avisos }; }
  return { ok: true, fonte: 'historico', recs: recs, dia: null, truncado: false, avisos: avisos };
}
// o dia em que a negociação ENTROU na fase de hoje (o começo do último
// trecho do caminho) — só vale se a fase de hoje for o fim do caminho
function diaFechouPeloCaminho(caminho, fase) {
  const u = caminho && caminho.length ? caminho[caminho.length - 1] : null;
  return u && u[0] === fase ? u[1] || null : null;
}

// ── ITENS das propostas (?itens=1 — Analítico do Funil de Vendas) ───
// Das negociações da lista (pela participação) ou das encerradas da janela
// (com ?mov=1). Por negociação, os itens de UMA proposta: a sincronizada (é a que vale);
// sem ela, a mais recente. Campos resolvidos pelo describe (nome de API e
// rótulo); o que a org não tiver sai da coluna e a tela diz o que faltou.
// Duas idas em lotes: as propostas das negociações e os itens das
// escolhidas — nada de filtro pelo avô (QuoteLineItem → Quote → Opp).
const ITEM_ANALISE = [
  { k: 'num',   api: ['Itemnumero__c'], rot: ['Nº do Item', 'Número do Item', 'Item'], t: 'num' },
  { k: 'prod',  api: ['Item__c', 'Nome_do_Produto__c', 'Produto_Reduzido__c'], rot: ['Nome do Produto'] },
  { k: 'prodn', api: ['Product2Id'], lookup: 'Name' },
  // o SKU (16/10/2026: ganhos · em andamento · perdidos por família → SKU):
  // o código do produto do catálogo; sem ele, o código gravado no item
  { k: 'codp',  api: ['Product2Id'], lookup: 'ProductCode' },
  { k: 'cod',   api: ['Cod_Prod__c', 'Cod_Produto__c'], rot: ['Código do Produto', 'Cód. Produto'] },
  { k: 'fam',   api: ['Nome_da_Fam_lia__c', 'Familia__c', 'Fam_lia_do_Produto__c'], rot: ['Nome da Família', 'Família', 'Família do Produto'] },
  { k: 'marca', api: ['Marca_Fabricante__c'], rot: ['Marca / Fabricante', 'Marca'] },
  { k: 'qtd',   api: ['Quantity'], t: 'num' },
  { k: 'unit',  api: ['UnitPrice'], t: 'num' },
  { k: 'vfin',  api: ['Valor_Final__c'], rot: ['Valor Final'], t: 'num' },
  { k: 'lance', api: ['Valor_do_Ultimo_Lance__c'], rot: ['Lance 1º colocado', 'Lance do 1º colocado', 'Valor do Último Lance'], t: 'num' },
  { k: 'total', api: ['TotalPrice'], t: 'num' },
  { k: 'res',   api: ['ResultadoItem__c', 'Resultado_do_Item__c'], rot: ['Resultado do Item'] },
  { k: 'sti',   api: ['Status_do_item__c'], rot: ['Status do item'] },
  { k: 'just',  api: ['Justificativa_da_Perda__c'], rot: ['Justificativa da Perda', 'Motivo da Perda'] }
];
const ITEM_LOTE = 200;
async function itensDasEncerradas(sf, ids, maxPaginas) {
  if (ids.length > HIST_MAX_OPPS) return { ok: false, motivo: 'itens das propostas só até ' + HIST_MAX_OPPS.toLocaleString('pt-BR') + ' negociações — estreite a janela' };
  let dq, dl;
  try { dq = await sf.describe('Quote'); dl = await sf.describe('QuoteLineItem'); }
  catch (e) { return { ok: false, motivo: 'itens das propostas indisponíveis (' + curto(e) + ')' }; }
  const temQ = {}; (dq.fields || []).forEach(function (f) { temQ[f.name] = 1; });
  if (!temQ.OpportunityId) return { ok: false, motivo: 'a Cotação não tem OpportunityId' };

  // campos do item: nome de API primeiro, rótulo depois (nunca uma
  // referência para chave de texto — "Produto" é também o Product2Id)
  const porNome = {}, porRot = {};
  (dl.fields || []).forEach(function (f) { porNome[f.name.toLowerCase()] = f; const r = norm(f.label); if (r && !porRot[r] && f.type !== 'reference') porRot[r] = f; });
  const usados = [], campos = {};
  ITEM_ANALISE.forEach(function (c) {
    let f = null;
    (c.api || []).forEach(function (a) { if (!f) f = porNome[a.toLowerCase()] || null; });
    (c.rot || []).forEach(function (r) { if (!f) f = porRot[norm(r)] || null; });
    if (f && !c.lookup && usados.some(function (u) { return u.sel === f.name; })) f = null;   // o mesmo campo por duas chaves
    if (!f || (c.lookup && !f.relationshipName)) { campos[c.k] = { ok: false }; return; }
    const u = c.lookup ? { k: c.k, sel: f.relationshipName + '.' + c.lookup, rel: f.relationshipName, sub: c.lookup, t: 'txt' }
      : { k: c.k, sel: f.name, t: c.t || 'txt' };
    usados.push(u);
    campos[c.k] = { ok: true, api: f.name, label: f.label || null };
  });
  const cols = ['opp', 'sinc'].concat(usados.map(function (u) { return u.k; }));
  if (!ids.length) return { ok: true, cols: cols, rows: [], campos: campos, propostas: 0, naoSinc: 0, semProposta: 0 };

  // 1. a proposta de cada negociação
  const colsQ = ['Id', 'OpportunityId'].concat(temQ.IsSyncing ? ['IsSyncing'] : []).concat(temQ.CreatedDate ? ['CreatedDate'] : []);
  const escolhida = {};
  try {
    for (let i = 0; i < ids.length; i += ITEM_LOTE * 3) {
      const rs = await Promise.all([0, 1, 2].map(function (j) {
        const l = ids.slice(i + j * ITEM_LOTE, i + (j + 1) * ITEM_LOTE);
        return l.length ? sf.soql('SELECT ' + colsQ.join(', ') + ' FROM Quote WHERE OpportunityId IN (' + listaIds(l) + ')', maxPaginas) : [];
      }));
      rs.forEach(function (recs) {
        recs.forEach(function (q) {
          if (!q.OpportunityId) return;
          const a = escolhida[q.OpportunityId], s = q.IsSyncing === true, cr = String(q.CreatedDate || '');
          if (!a || (s && !a.sinc) || (s === a.sinc && cr > a.cr)) escolhida[q.OpportunityId] = { id: q.Id, sinc: s, cr: cr };
        });
      });
    }
  } catch (e) { return { ok: false, motivo: 'propostas das negociações indisponíveis (' + curto(e) + ')' }; }
  const oppDe = {};
  Object.keys(escolhida).forEach(function (o) { oppDe[escolhida[o].id] = o; });
  const qids = Object.keys(oppDe);

  // 2. os itens das escolhidas
  const rows = [];
  let lidos = 0;
  try {
    for (let i = 0; i < qids.length; i += ITEM_LOTE * 3) {
      const rs = await Promise.all([0, 1, 2].map(function (j) {
        const l = qids.slice(i + j * ITEM_LOTE, i + (j + 1) * ITEM_LOTE);
        return l.length ? sf.soql('SELECT QuoteId, ' + usados.map(function (u) { return u.sel; }).join(', ') + ' FROM QuoteLineItem WHERE QuoteId IN (' + listaIds(l) + ')', maxPaginas) : [];
      }));
      rs.forEach(function (recs) {
        recs.forEach(function (r) {
          const opp = oppDe[r.QuoteId]; if (!opp) return;
          lidos++;
          rows.push([opp, escolhida[opp].sinc].concat(usados.map(function (u) {
            let v = u.rel ? (r[u.rel] ? r[u.rel][u.sub] : null) : r[u.sel];
            if (v == null || v === '' || typeof v === 'object') return null;
            if (u.t === 'num') { const n = Number(v); return isFinite(n) ? n : null; }
            return String(v);
          })));
        });
      });
    }
  } catch (e) { return { ok: false, motivo: 'itens das propostas indisponíveis (' + curto(e) + ')' }; }
  const naoSinc = Object.keys(escolhida).filter(function (o) { return !escolhida[o].sinc; }).length;
  return { ok: true, cols: cols, rows: rows, campos: campos, propostas: qids.length, naoSinc: naoSinc,
    semProposta: ids.filter(function (o) { return !escolhida[o]; }).length, itens: lidos, truncado: lidos >= maxPaginas * 2000 };
}

// ── carga completa ──────────────────────────────────────────────────
async function carregar(sf, q, env) {
  const per = lerPeriodo(q || {});
  const escopo = lerEscopo(q || {}), lici = escopo === 'lici';
  const desc = await sf.describe('Opportunity');
  const LISTA = lici ? CAMPOS.concat(CAMPOS_LICI) : CAMPOS;
  const campos = resolverCampos(desc, LISTA);
  const faltaObrig = CAMPOS.filter(function (c) { return c.obrig && !campos[c.k].ok; }).map(function (c) { return c.api[0]; });
  if (faltaObrig.length) throw new Error('Opportunity sem ' + faltaObrig.join(', '));
  const avisosCampos = [];
  await resolverViaProposta(sf, desc, campos, avisosCampos);

  const kData = BASES[per.base];
  const mData = campos[kData];
  if (!mData.ok) {
    const e = new Error('campo de data ausente: ' + kData);
    e.status = 400; e.publicMessage = 'O Salesforce não tem o campo de data escolhido (' + per.base + ').';
    throw e;
  }
  const cData = CAMPOS.filter(function (c) { return c.k === kData; })[0];

  // LICI sem o checkbox "Lici" na org (ou sem permissão de leitura nele):
  // não há como saber quais negociações são da LICI — a tela explica
  if (lici && !campos.lici.ok) {
    return {
      ok: true, configured: true, escopo: escopo, semCampoLici: true,
      base: per.base, de: per.de, ate: per.ate, fases: [], cols: [], rows: [], avisos: avisosCampos
    };
  }

  const rt = tiposRegistro(desc, env);
  const meta = await fasesMeta(sf, desc, rt.ids);
  const avisos = meta.avisos.concat(avisosCampos);
  if (lici && !campos.manual.ok) avisos.push('o Salesforce não devolveu o campo "Manual Lici" — a separação manual × agente fica vazia');
  // no escopo LICI o tipo de registro só ordena as fases: sem ele, a ordem
  // cai no picklist da org e o relatório segue
  if (!rt.ids.length && !lici) {
    return {
      ok: true, configured: true, semTipo: true,
      tiposDisponiveis: rt.disponiveis, tipoRegistro: [],
      base: per.base, de: per.de, ate: per.ate,
      fases: meta.fases, fonteFases: meta.fonte, cols: [], rows: [], avisos: avisos
    };
  }

  // o "Lici" é o próprio filtro (sempre true): não precisa voltar na linha
  let usados = LISTA.filter(function (c) { return campos[c.k].ok && c.k !== 'lici'; });
  const filtro = lici ? campos.lici.api + ' = true' : 'RecordTypeId IN (' + listaIds(rt.ids) + ')';
  const onde = [filtro];
  const cp = condPeriodo(mData.api, cData.tipo, per.de, per.ate);
  if (cp) onde.push(per.semData ? '((' + cp + ') OR ' + mData.api + ' = null)' : cp);
  const montar = function () {
    return 'SELECT ' + usados.map(function (c) { return campos[c.k].sel; }).join(', ') +
      ' FROM Opportunity WHERE ' + onde.join(' AND ') + ' ORDER BY ' + mData.api + ' DESC NULLS LAST, Id';
  };

  const MAXP = Number((env && env.FUNIL_MAX_PAGINAS) || 60);   // 60 × 2.000 = 120 mil
  let recs;
  try { recs = await sf.soql(montar(), MAXP); }
  catch (e) {
    // campo lido pela PROPOSTA (SyncedQuote.x) que o describe mostrou mas o
    // SOQL recusou: sai do SELECT e o funil segue sem ele
    const msg = String((e && e.message) || e);
    const viaQ = usados.filter(function (c) { return campos[c.k].fonte === 'proposta'; });
    if (!viaQ.length || !viaQ.some(function (c) { return msg.indexOf(campos[c.k].sub) >= 0 || msg.indexOf(campos[c.k].rel) >= 0; })) throw e;
    viaQ.forEach(function (c) { campos[c.k] = { ok: false, motivo: 'recusado no SOQL' }; });
    usados = usados.filter(function (c) { return campos[c.k].ok; });
    avisos.push('tipo de faturamento da proposta recusado pelo Salesforce (' + curto(e) + ')');
    recs = await sf.soql(montar(), MAXP);
  }
  const truncado = recs.length >= MAXP * 2000;

  const cols = usados.map(function (c) { return c.k; });
  const rows = recs.map(function (r) { return usados.map(function (c) { return valorDe(r, c, campos[c.k]); }); });

  // quantas PROPOSTAS cada negociação tem no Salesforce (duas colunas a
  // mais: nprop = propostas, npsinc = quantas estão sincronizadas)
  const prop = await propostasDoPeriodo(sf, 'Opportunity.' + filtro, mData, cData, per, Math.min(MAXP, 30));
  if (prop.ok) {
    cols.push('nprop', 'npsinc');
    recs.forEach(function (r, i) {
      const a = prop.porOpp[r.Id] || null;
      rows[i].push(a ? a.n : 0, a ? a.s : 0);
    });
  } else if (prop.motivo) avisos.push(prop.motivo);

  // caminho de fases de cada negociação (só com ?hist=1 — Funil Semanal).
  // Negociação sem linha no histórico leva [] e a tela usa a fase atual.
  let historico = null, hs = null;
  if (per.hist) {
    hs = await historicoFases(sf, recs.map(function (r) { return r.Id; }), 20);
    if (hs.ok) {
      cols.push('hist');
      recs.forEach(function (r, i) { rows[i].push(hs.porOpp[r.Id] || []); });
      historico = { ok: true, linhas: hs.linhas, comCaminho: Object.keys(hs.porOpp).length };
    } else {
      historico = { ok: false, motivo: hs.motivo };
      avisos.push(hs.motivo + ' — o funil semanal usa a fase atual de cada negociação');
    }
  }

  // itens das propostas de TODAS as negociações da lista (?itens=1 sem
  // ?mov=1 — o Analítico do Funil de Vendas pela data da participação: as
  // mesmas negociações da Visão Geral, em aberto, ganhas e perdidas)
  let itens = null;
  if (per.itens && !per.mov) {
    itens = await itensDasEncerradas(sf, recs.map(function (r) { return r.Id; }), Math.min(MAXP, 30));
    if (!itens.ok) avisos.push(itens.motivo + ' — o Analítico mostra só as negociações');
    else if (itens.truncado) avisos.push('os itens das propostas passaram do teto de leitura do Salesforce — estreite a janela');
  }

  // ganhas e perdidas NA JANELA, criadas quando for (só com ?mov=1 — Funil
  // Semanal): 2º bloco de linhas com as MESMAS colunas das negociações +
  // `dfechou` (o dia em que a fase virou fechada) + `hist` quando houver.
  let fechadas = null;
  if (per.mov) {
    const fx = await encerradasNaJanela(sf, desc, campos, usados, filtro, meta.fases, per, MAXP);
    (fx.avisos || []).forEach(function (a) { avisos.push(a); });
    if (!fx.ok) {
      fechadas = { ok: false, motivo: fx.motivo };
      avisos.push(fx.motivo + ' — o Funil de Vendas mostra só o que entrou');
    } else {
      // caminho das encerradas: o que já veio com as criadas é reaproveitado
      let caminho = null;
      if (per.hist || fx.fonte === 'historico') {
        const ja = hs && hs.ok ? hs.porOpp : {};
        const faltam = fx.recs.map(function (r) { return r.Id; }).filter(function (id) { return !ja[id]; });
        const h2 = await historicoFases(sf, faltam, 20);
        if (h2.ok) caminho = Object.assign({}, ja, h2.porOpp);
        else if (fx.fonte === 'historico') { fechadas = { ok: false, motivo: h2.motivo }; avisos.push(h2.motivo + ' — o Funil de Vendas mostra só o que entrou'); }
      }
      if (!fechadas) {
        const fcols = usados.map(function (c) { return c.k; }).concat(['dfechou']);
        const comCaminho = per.hist && !!caminho;
        if (comCaminho) fcols.push('hist');
        const frows = [];
        fx.recs.forEach(function (r) {
          const dia = fx.dia ? fx.dia[r.Id] : diaFechouPeloCaminho(caminho[r.Id], r.StageName);
          // pelo histórico, só conta quem ENTROU na fase de hoje dentro da janela
          if (!dia || (per.de && dia < per.de) || (per.ate && dia > per.ate)) return;
          const row = usados.map(function (c) { return valorDe(r, c, campos[c.k]); });
          row.push(dia);
          if (comCaminho) row.push(caminho[r.Id] || []);
          frows.push(row);
        });
        fechadas = { ok: true, fonte: fx.fonte, cols: fcols, rows: frows, total: frows.length, truncado: !!fx.truncado };
        if (fx.truncado) avisos.push('as ganhas e perdidas da janela passaram do teto de leitura do Salesforce — estreite a janela');
        // itens das propostas das encerradas (só com ?itens=1 — Analítico)
        if (per.itens) {
          const jI = fcols.indexOf('id');
          const it = await itensDasEncerradas(sf, frows.map(function (r) { return r[jI]; }), Math.min(MAXP, 30));
          fechadas.itens = it;
          if (!it.ok) avisos.push(it.motivo + ' — o Analítico mostra só as negociações');
          else if (it.truncado) avisos.push('os itens das ganhas e perdidas passaram do teto de leitura do Salesforce — estreite a janela');
        }
      }
    }
  }

  // negociações SEM a data escolhida: fora do intervalo, mas contadas —
  // é o que a tela usa para dizer "N ficaram de fora"
  let semData = null;
  if (cp && !per.semData) {
    try {
      const temValor = campos.valor.ok;
      const agg = await sf.soql('SELECT StageName, COUNT(Id) n' + (temValor ? ', SUM(Amount) v' : '') +
        ' FROM Opportunity WHERE ' + filtro + ' AND ' + mData.api + ' = null GROUP BY StageName');
      semData = { n: 0, v: 0, porFase: [] };
      agg.forEach(function (a) {
        const n = Number(a.n || a.expr0 || 0), v = Number(a.v || a.expr1 || 0) || 0;
        semData.n += n; semData.v += v;
        semData.porFase.push({ fase: a.StageName, n: n, v: v });
      });
      semData.porFase.sort(function (a, b) { return b.n - a.n; });
    } catch (e) { avisos.push('contagem das negociações sem data indisponível (' + curto(e) + ')'); }
  }

  // fase que aparece nos dados e não está no processo do tipo (legado)
  const conhecidas = {};
  meta.fases.forEach(function (f) { conhecidas[f.nome] = 1; });
  const iF = cols.indexOf('fase');
  const extras = {};
  rows.forEach(function (r) { const f = r[iF]; if (f && !conhecidas[f]) extras[f] = (extras[f] || 0) + 1; });
  if (fechadas && fechadas.ok) {
    const jF = fechadas.cols.indexOf('fase');
    fechadas.rows.forEach(function (r) { const f = r[jF]; if (f && !conhecidas[f]) extras[f] = (extras[f] || 0) + 1; });
  }
  const fases = meta.fases.slice();
  Object.keys(extras).forEach(function (f) {
    const n = norm(f), ganha = RX_GANHA.test(n);
    fases.push({ nome: f, rotulo: f, ordem: fases.length, fechada: ganha || RX_FECHA.test(n), ganha: ganha, prob: null, foraDoProcesso: true });
  });
  if (Object.keys(extras).length) avisos.push(Object.keys(extras).length + ' fase(s) nos dados fora do processo de venda do tipo de registro');

  return {
    ok: true, configured: true, escopo: escopo,
    tipoRegistro: rt.nomes, tiposDisponiveis: rt.disponiveis,
    base: per.base, de: per.de, ate: per.ate, incluiSemData: per.semData,
    fases: fases, fonteFases: meta.fonte,
    campos: Object.keys(campos).reduce(function (o, k) {
      o[k] = { ok: campos[k].ok, api: campos[k].api || null, label: campos[k].label || null };
      if (campos[k].fonte) o[k].fonte = campos[k].fonte;
      return o;
    }, {}),
    cols: cols, rows: rows, total: rows.length, truncado: truncado,
    propostasSf: prop.ok
      ? { ok: true, total: prop.total, comProposta: Object.keys(prop.porOpp).length, sincronizada: !!prop.sincronizada }
      : { ok: false, motivo: prop.motivo || null },
    historico: historico, fechadas: fechadas, itens: itens,
    semData: semData, avisos: avisos
  };
}

// ════════════════════════════════════════════════════════════════════
// FICHA de UMA negociação — o painel lateral que abre ao clicar numa
// participação. Três blocos, cada um com a sua rede de segurança:
//
//   secoes    TODOS os campos que o run-as enxerga (o describe já respeita
//             o FLS), agrupados pelas SEÇÕES do layout do tipo de registro
//             (UI API). Sem UI API: agrupa por principais / personalizados
//             / sistema. Campo fora do layout vai para "Outros campos".
//   propostas as Quotes da negociação (a sincronizada primeiro).
//   itens     os QuoteLineItem da sincronizada (ou da mais recente).
//
// A trava do tipo de registro está no WHERE: um Id de negociação do
// Comercial devolve 404 aqui, como se não existisse — a rota é da área
// Licitação e não pode virar porta para a carteira do Comercial. No
// escopo LICI a trava é o checkbox "Lici" (só abre o que a LICI criou).
// ════════════════════════════════════════════════════════════════════
const RX_OPP = /^006[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;
// tipos que não viram texto de ficha (compostos e binários)
const TIPOS_FORA = { address: 1, location: 1, base64: 1, complexvalue: 1, encryptedstring: 1 };
// ruído do sistema que o layout nunca mostra
const CAMPOS_FORA = { isdeleted: 1, systemmodstamp: 1, lastvieweddate: 1, lastreferenceddate: 1, fiscal: 1, fiscalquarter: 1,
  fiscalyear: 1, hasopenactivity: 1, hasoverduetask: 1, hasopportunitylineitem: 1, forecastcategory: 1, pushcount: 1 };
// alvos de lookup com Name consultável (OpportunityHistory, p.ex., não tem)
const COM_NOME = { user: 1, account: 1, contact: 1, campaign: 1, pricebook2: 1, recordtype: 1, quote: 1, opportunity: 1, lead: 1, product2: 1, group: 1 };

function nomeavel(f) {
  const alvos = f.referenceTo || [];
  return !!f.relationshipName && alvos.length > 0 && alvos.every(function (a) { return /__c$/i.test(a) || COM_NOME[String(a).toLowerCase()]; });
}
function semHtml(s) {
  return String(s).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}
// tipo do SF → tipo curto que a tela formata
function tipoCurto(f) {
  const t = String(f.type || '').toLowerCase();
  if (t === 'currency') return 'brl';
  if (t === 'date') return 'date';
  if (t === 'datetime') return 'datetime';
  if (t === 'time') return 'time';
  if (t === 'boolean') return 'bool';
  if (t === 'percent') return 'pct';
  if (t === 'double' || t === 'int' || t === 'long') return 'num';
  if (t === 'url') return 'url';
  if (t === 'email') return 'email';
  if (t === 'textarea') return 'longo';
  return 'txt';
}
function valorCampo(rec, f) {
  if (f.type === 'reference') {
    if (nomeavel(f)) { const o = rec[f.relationshipName]; if (o && o.Name != null) return String(o.Name); }
    return rec[f.name] == null ? null : String(rec[f.name]);
  }
  const v = rec[f.name];
  if (v == null || v === '') return null;
  if (typeof v === 'object') return null;
  if (f.type === 'textarea' && (f.htmlFormatted || f.extraTypeInfo === 'richtextarea')) return semHtml(v) || null;
  return v;
}

// SELECT em lotes: 300 campos num GET só estouram o limite de URL do SF
async function lerRegistro(sf, obj, campos, onde, lote) {
  lote = lote || 90;
  let rec = null;
  for (let i = 0; i < campos.length; i += lote) {
    const parte = campos.slice(i, i + lote);
    if (parte.indexOf('Id') < 0) parte.unshift('Id');
    const rs = await sf.soql('SELECT ' + parte.join(', ') + ' FROM ' + obj + ' WHERE ' + onde + ' LIMIT 1');
    if (!rs.length) return null;
    rec = Object.assign(rec || {}, rs[0]);
  }
  return rec;
}

// seções do layout (UI API). Devolve null quando a org não deixa ler.
async function secoesLayout(sf, rtId, avisos) {
  if (typeof sf.restGet !== 'function' || !rtId) return null;
  try {
    const j = await sf.restGet('/ui-api/layout/Opportunity?layoutType=Full&mode=View&recordTypeId=' + encodeURIComponent(rtId));
    const out = [];
    // o rótulo do LAYOUT é o que a pessoa vê no Salesforce ("Nome da
    // conta"); o do describe é o do campo ("ID da conta")
    (j && j.sections || []).forEach(function (s) {
      const apis = [], rots = {};
      (s.layoutRows || []).forEach(function (row) {
        (row.layoutItems || []).forEach(function (it) {
          (it.layoutComponents || []).forEach(function (c) {
            if (!c || c.componentType !== 'Field' || !c.apiName || apis.indexOf(c.apiName) >= 0) return;
            apis.push(c.apiName);
            if (it.label) rots[c.apiName] = String(it.label);
          });
        });
      });
      if (apis.length) out.push({ titulo: s.heading || '', apis: apis, rots: rots });
    });
    return out.length ? out : null;
  } catch (e) {
    avisos.push('layout do Salesforce indisponível — campos agrupados por tipo (' + curto(e) + ')');
    return null;
  }
}

// propostas + itens (Quote / QuoteLineItem). Tudo opcional: org sem
// Cotações habilitadas, ou run-as sem acesso, só gera aviso.
const ITEM_CAMPOS = [
  { k: 'num',   api: ['Itemnumero__c'], rot: ['Nº do Item', 'Número do Item', 'Item Número', 'Nº Item', 'Item'], t: 'num' },
  { k: 'lote',  rot: ['Lote', 'Nº do Lote', 'Número do Lote'] },
  { k: 'prod',  api: ['Product2Id'], lookup: 'Name' },
  { k: 'cod',   api: ['Cod_Prod__c', 'Cod_Produto__c'], rot: ['Código do Produto', 'Cód. Produto'] },
  { k: 'codp',  api: ['Product2Id'], lookup: 'ProductCode' },
  { k: 'desc',  api: ['Descritivo_Edital__c'], rot: ['Descritivo do Edital', 'Descrição do Edital', 'Descritivo Edital'] },
  { k: 'desc2', api: ['Description'] },
  { k: 'unid',  api: ['Unidade_do_Item__c'], rot: ['Unidade do Item', 'Unidade'] },
  { k: 'marca', rot: ['Marca', 'Marca do Produto'] },
  { k: 'qtd',   api: ['Quantity'], t: 'num' },
  { k: 'unit',  api: ['UnitPrice'], t: 'brl' },
  { k: 'total', api: ['TotalPrice'], t: 'brl' },
  // unitário, ao lado do Valor de Venda (a Gestão de Desempenho lê o mesmo campo)
  { k: 'min',   api: ['Valor_Minimo_Aprovado__c', 'Valor_Minimo__c', 'Preco_Minimo_Aprovado__c'], rot: ['Valor Mínimo Aprovado', 'Valor Mínimo', 'Preço Mínimo Aprovado', 'Preço Mínimo'], t: 'brl' },
  { k: 'res',   rot: ['Resultado do Item', 'Resultado', 'Status do Item', 'Situação do Item'] },
  { k: 'col',   rot: ['Colocação', 'Classificação', 'Posição'] },
  { k: 'obs',   api: ['Observacao__c'], rot: ['Observação'] }
];
async function propostasEItens(sf, oppId, syncId, avisos) {
  const out = { propostas: null, itens: null };
  let dq;
  try { dq = await sf.describe('Quote'); } catch (e) { avisos.push('propostas indisponíveis (' + curto(e) + ')'); return out; }
  const temQ = {}; (dq.fields || []).forEach(function (f) { temQ[f.name] = 1; });
  const colsQ = ['Id', 'Name', 'QuoteNumber', 'Status', 'IsSyncing', 'GrandTotal', 'TotalPrice', 'ExpirationDate', 'CreatedDate'].filter(function (c) { return temQ[c]; });
  let qs;
  try {
    qs = await sf.soql('SELECT ' + colsQ.join(', ') + " FROM Quote WHERE OpportunityId = '" + oppId + "' ORDER BY CreatedDate DESC LIMIT 50");
  } catch (e) { avisos.push('propostas indisponíveis (' + curto(e) + ')'); return out; }
  qs.sort(function (a, b) { return (b.IsSyncing ? 1 : 0) - (a.IsSyncing ? 1 : 0) || (a.Id === syncId ? -1 : b.Id === syncId ? 1 : 0); });
  out.propostas = qs.map(function (q) {
    return { id: q.Id, nome: q.Name || null, numero: q.QuoteNumber || null, status: q.Status || null,
      sinc: !!q.IsSyncing || q.Id === syncId, total: q.GrandTotal != null ? Number(q.GrandTotal) : (q.TotalPrice != null ? Number(q.TotalPrice) : null),
      validade: q.ExpirationDate || null, criada: diaBrt(q.CreatedDate) };
  });
  const alvo = out.propostas.filter(function (p) { return p.sinc; })[0] || out.propostas[0];
  if (!alvo) return out;

  let dl;
  try { dl = await sf.describe('QuoteLineItem'); } catch (e) { avisos.push('itens da proposta indisponíveis (' + curto(e) + ')'); return out; }
  const porNome = {}, porRot = {};
  (dl.fields || []).forEach(function (f) { porNome[f.name.toLowerCase()] = f; const r = norm(f.label); if (r && !porRot[r]) porRot[r] = f; });
  const usados = [];
  ITEM_CAMPOS.forEach(function (c) {
    let f = null;
    (c.api || []).forEach(function (a) { if (!f) f = porNome[a.toLowerCase()] || null; });
    (c.rot || []).forEach(function (r) { if (!f) f = porRot[norm(r)] || null; });
    if (!f) return;
    if (c.lookup) { if (f.relationshipName) usados.push({ k: c.k, sel: f.relationshipName + '.' + c.lookup, rel: f.relationshipName, sub: c.lookup, t: c.t || 'txt', r: f.label }); return; }
    if (usados.some(function (u) { return u.sel === f.name; })) return;   // o mesmo campo por duas chaves
    usados.push({ k: c.k, sel: f.name, t: c.t || tipoCurto(f), r: f.label, html: !!(f.htmlFormatted || f.extraTypeInfo === 'richtextarea') });
  });
  if (!usados.length) return out;
  const ordem = ['SortOrder', 'LineNumber'].filter(function (c) { return porNome[c.toLowerCase()]; });
  let its;
  try {
    its = await sf.soql('SELECT Id, ' + usados.map(function (u) { return u.sel; }).join(', ') + " FROM QuoteLineItem WHERE QuoteId = '" + String(alvo.id).replace(/[^A-Za-z0-9]/g, '') + "'" +
      (ordem.length ? ' ORDER BY ' + ordem.join(', ') : '') + ' LIMIT 1000');
  } catch (e) { avisos.push('itens da proposta indisponíveis (' + curto(e) + ')'); return out; }
  out.itens = {
    proposta: alvo.id,
    cols: usados.map(function (u) { return { k: u.k, r: u.r, t: u.t }; }),
    rows: its.map(function (r) {
      return usados.map(function (u) {
        let v = u.rel ? (r[u.rel] ? r[u.rel][u.sub] : null) : r[u.sel];
        if (v == null || v === '' || typeof v === 'object') return null;
        return u.html ? semHtml(v) : v;
      });
    }),
    truncado: its.length >= 1000
  };
  return out;
}

// a trava do escopo: Licitação = tipo de registro; LICI = checkbox "Lici".
// null = a org não tem como separar (quem chama devolve 404)
function travaLicitacao(desc, env, escopo) {
  if (escopo === 'lici') {
    const cl = resolverCampos(desc, CAMPOS_LICI).lici;
    return cl.ok ? cl.api + ' = true' : null;
  }
  const rt = tiposRegistro(desc, env);
  return rt.ids.length ? 'RecordTypeId IN (' + listaIds(rt.ids) + ')' : null;
}
function naoLicitacao(escopo) {
  return function () {
    const e = new Error('negociação fora do escopo'); e.status = 404;
    e.publicMessage = escopo === 'lici' ? 'Negociação não encontrada no relatório da LICI.' : 'Negociação não encontrada no funil da Licitação.';
    return e;
  };
}

async function detalhe(sf, id, env, escopo) {
  id = String(id || '').trim();
  if (!RX_OPP.test(id)) { const e = new Error('id inválido'); e.status = 400; e.publicMessage = 'Id de negociação inválido.'; throw e; }
  escopo = lerEscopo({ escopo: escopo });
  const desc = await sf.describe('Opportunity');
  const nao = naoLicitacao(escopo);
  const trava = travaLicitacao(desc, env, escopo);
  if (!trava) throw nao();
  return fichaDe(sf, desc, id, trava, nao);
}

// a ficha propriamente dita: `trava` é o pedaço do WHERE que decide o que
// esta rota pode abrir (Id fora dela = `nao()`, um 404)
async function fichaDe(sf, desc, id, trava, nao) {
  // lookup sem Name (OpportunityHistory…) só mostraria um Id cru: fica fora
  const campos = (desc.fields || []).filter(function (f) {
    return f && f.name && !TIPOS_FORA[String(f.type).toLowerCase()] && !CAMPOS_FORA[f.name.toLowerCase()] && !f.deprecatedAndHidden &&
      (f.type !== 'reference' || nomeavel(f));
  });
  const sel = [];
  campos.forEach(function (f) {
    sel.push(f.name);
    if (f.type === 'reference' && nomeavel(f)) sel.push(f.relationshipName + '.Name');
  });
  // RecordTypeId na 1ª leva: é ela que decide o layout
  ['RecordTypeId', 'Name', 'StageName'].reverse().forEach(function (c) { const i = sel.indexOf(c); if (i > 0) { sel.splice(i, 1); sel.unshift(c); } });
  const onde = "Id = '" + id + "' AND " + trava;
  const rec = await lerRegistro(sf, 'Opportunity', sel, onde);
  if (!rec) throw nao();

  const avisos = [];
  const porApi = {};
  campos.forEach(function (f) { porApi[f.name] = f; });
  const item = function (f, rot) {
    // lookup sem layout: "ID da conta" → "Conta"
    let r = rot || f.label;
    if (!rot && f.type === 'reference') { r = String(f.label || '').replace(/^ID d[aoe]s? /i, '').replace(/ ID$/i, '') || f.label; r = r.charAt(0).toUpperCase() + r.slice(1); }
    return { api: f.name, r: r, t: f.type === 'reference' ? 'txt' : tipoCurto(f), v: valorCampo(rec, f) };
  };

  let secoes = [], fonte = 'layout';
  const lay = await secoesLayout(sf, rec.RecordTypeId, avisos);
  const usados = {};
  if (lay) {
    lay.forEach(function (s) {
      const cs = s.apis.map(function (a) { return porApi[a]; }).filter(Boolean);
      cs.forEach(function (f) { usados[f.name] = 1; });
      if (cs.length) secoes.push({ titulo: s.titulo, campos: cs.map(function (f) { return item(f, s.rots[f.name]); }) });
    });
    const resto = campos.filter(function (f) { return !usados[f.name]; });
    if (resto.length) secoes.push({ titulo: 'Outros campos', fora: true, campos: resto.sort(porRotulo).map(function (f) { return item(f); }) });
  } else {
    fonte = 'describe';
    const princ = [];
    CAMPOS.forEach(function (c) {
      c.api.forEach(function (a) { const f = porApi[a]; if (f && !usados[f.name]) { usados[f.name] = 1; princ.push(f); } });
    });
    const cust = campos.filter(function (f) { return !usados[f.name] && f.custom; }).sort(porRotulo);
    const pad = campos.filter(function (f) { return !usados[f.name] && !f.custom; }).sort(porRotulo);
    if (princ.length) secoes.push({ titulo: 'Principais', campos: princ.map(function (f) { return item(f); }) });
    if (cust.length) secoes.push({ titulo: 'Campos personalizados', campos: cust.map(function (f) { return item(f); }) });
    if (pad.length) secoes.push({ titulo: 'Campos padrão e do sistema', fora: true, campos: pad.map(function (f) { return item(f); }) });
  }

  const pi = await propostasEItens(sf, id, rec.SyncedQuoteId || null, avisos);
  return {
    ok: true, id: rec.Id, nome: rec.Name, fase: rec.StageName, fonte: fonte,
    secoes: secoes, propostas: pi.propostas, itens: pi.itens, avisos: avisos
  };
}
function porRotulo(a, b) { return String(a.label || '').localeCompare(String(b.label || ''), 'pt-BR'); }

// ════════════════════════════════════════════════════════════════════
// FICHA DO COMERCIAL — a mesma ficha, aberta pela lista do Funil de
// Oportunidades do Comercial (/api/comercial-funil). Duas diferenças:
//
//   trava    a INVERSA da Licitação: abre negociação de qualquer tipo de
//            registro MENOS o da Licitação (FUNIL_TIPOS_REGISTRO). Com
//            FUNIL_TIPOS_COMERCIAL preenchido, só os tipos nomeados ali.
//            Sem achar o tipo Licitação na org, fecha (404): não há como
//            separar as carteiras e a rota do Comercial não vira porta
//            para a da Licitação.
//   busca    o modelo de BI do Comercial não expõe o Id do Salesforce, então
//            a tela manda o NOME da oportunidade (+ cliente e fase, que
//            desempatam homônimas) e `acharComercial` procura.
// ════════════════════════════════════════════════════════════════════
function travaComercial(desc, env) {
  const lic = tiposRegistro(desc, env);
  if (!lic.ids.length) return null;
  const c = ['RecordTypeId NOT IN (' + listaIds(lic.ids) + ')'];
  const so = String((env && env.FUNIL_TIPOS_COMERCIAL) || '').trim();
  if (so) {
    const com = tiposRegistro(desc, { FUNIL_TIPOS_REGISTRO: so });
    if (!com.ids.length) return null;
    c.unshift('RecordTypeId IN (' + listaIds(com.ids) + ')');
  }
  return c.join(' AND ');
}
function naoComercial() {
  const e = new Error('oportunidade fora do escopo'); e.status = 404;
  e.publicMessage = 'Oportunidade não encontrada no Salesforce do Comercial.';
  return e;
}

async function detalheComercial(sf, id, env) {
  id = String(id || '').trim();
  if (!RX_OPP.test(id)) { const e = new Error('id inválido'); e.status = 400; e.publicMessage = 'Id de oportunidade inválido.'; throw e; }
  const desc = await sf.describe('Opportunity');
  const trava = travaComercial(desc, env);
  if (!trava) throw naoComercial();
  return fichaDe(sf, desc, id, trava, naoComercial);
}

// literal de texto do SOQL (aspas e barra escapadas; quebra de linha vira
// espaço). `like` também escapa os curingas % e _.
function soqlTxt(s, like) {
  let t = String(s).replace(/[\r\n\t]+/g, ' ').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  if (like) t = t.replace(/%/g, '\\%').replace(/_/g, '\\_');
  return t;
}
// o cliente do BI (Dynamics) e a conta do Salesforce nem sempre se escrevem
// igual: igual > um contém o outro > metade das palavras em comum
// (palavra de instituição — "hospital", "clínica"… — não conta: casaria todo mundo)
const PALAVRAS_VAZIAS = { de: 1, da: 1, do: 1, das: 1, dos: 1, e: 1, ltda: 1, sa: 1, me: 1, eireli: 1,
  hospital: 1, hosp: 1, clinica: 1, instituto: 1, inst: 1, rede: 1, saude: 1, santa: 1, casa: 1, fundacao: 1,
  associacao: 1, assoc: 1, centro: 1, municipal: 1, regional: 1, prefeitura: 1, secretaria: 1, medico: 1, medica: 1 };
function parecenca(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 3;
  if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return 2;
  const pa = a.split(' ').filter(function (p) { return p.length > 1 && !PALAVRAS_VAZIAS[p]; });
  const pb = {}; b.split(' ').forEach(function (p) { pb[p] = 1; });
  const comuns = pa.filter(function (p) { return pb[p]; }).length;
  return pa.length && comuns / pa.length >= 0.5 ? 1 : 0;
}

// q = { nome, cliente?, fase? } → { candidatos: [...], escolhido, casamento }
// casamento: 'nome' (nome idêntico) | 'inicio' (o nome do BI é o começo do
// nome no Salesforce — o modelo corta texto longo)
const BUSCA_MAX = 25;
function nomeDaBusca(q) {
  const nome = String((q && q.nome) || '').replace(/\s+/g, ' ').trim();
  if (!nome || nome.length > 255) { const e = new Error('nome inválido'); e.status = 400; e.publicMessage = 'Informe o nome da oportunidade.'; throw e; }
  return nome;
}
async function acharComercial(sf, q, env) {
  const nome = nomeDaBusca(q);
  const desc = await sf.describe('Opportunity');
  const trava = travaComercial(desc, env);
  if (!trava) throw naoComercial();
  return acharNaTrava(sf, desc, nome, q, trava);
}
// A MESMA busca pelo nome, aberta pela área Vendedor no módulo Licitação: o
// modelo de BI da Licitação também não expõe o Id, só 'Licitações'[Nome da
// oportunidade]. Trava = a da ficha da Licitação (tipo de registro ou "Lici").
async function acharLicitacao(sf, q, env, escopo) {
  const nome = nomeDaBusca(q);
  escopo = lerEscopo({ escopo: escopo });
  const desc = await sf.describe('Opportunity');
  const trava = travaLicitacao(desc, env, escopo);
  if (!trava) throw naoLicitacao(escopo)();
  return acharNaTrava(sf, desc, nome, q, trava);
}
async function acharNaTrava(sf, desc, nome, q, trava) {
  const campos = resolverCampos(desc, CAMPOS);
  const tem = {}; (desc.fields || []).forEach(function (f) { tem[f.name] = f; });
  const sel = ['Id', 'Name', 'StageName'];
  [['conta', 'conta'], ['valor', 'valor'], ['dcria', 'dcria'], ['dono', 'dono']].forEach(function (p) { if (campos[p[0]].ok) sel.push(campos[p[0]].sel); });
  if (tem.RecordTypeId && tem.RecordTypeId.relationshipName) sel.push(tem.RecordTypeId.relationshipName + '.Name');
  const ordem = tem.LastModifiedDate ? ' ORDER BY LastModifiedDate DESC' : '';
  const ler = function (cond) { return sf.soql('SELECT ' + sel.join(', ') + ' FROM Opportunity WHERE ' + cond + ' AND ' + trava + ordem + ' LIMIT ' + BUSCA_MAX); };

  let casamento = 'nome';
  let recs = await ler("Name = '" + soqlTxt(nome) + "'");
  if (!recs.length && nome.length >= 8) { casamento = 'inicio'; recs = await ler("Name LIKE '" + soqlTxt(nome, true) + "%'"); }

  const fase = norm(q && q.fase), cliente = String((q && q.cliente) || '').trim();
  const cands = recs.map(function (r, i) {
    const conta = valorDe(r, campos.conta, campos.conta);
    const pts = (cliente ? parecenca(cliente, conta) * 2 : 0) + (fase && norm(r.StageName) === fase ? 2 : 0);
    return {
      id: r.Id, nome: r.Name, fase: r.StageName || null, conta: conta,
      valor: valorDe(r, { tipo: 'num' }, campos.valor), criada: valorDe(r, { tipo: 'datetime' }, campos.dcria),
      dono: valorDe(r, campos.dono, campos.dono),
      tipo: tem.RecordTypeId && r[tem.RecordTypeId.relationshipName] ? r[tem.RecordTypeId.relationshipName].Name || null : null,
      pts: pts, i: i
    };
  });
  // mais pontos primeiro; empate fica na ordem do SOQL (a mexida mais recente)
  cands.sort(function (a, b) { return b.pts - a.pts || a.i - b.i; });
  cands.forEach(function (c) { delete c.i; });
  return { candidatos: cands, escolhido: cands.length ? cands[0].id : null, casamento: casamento, limite: recs.length >= BUSCA_MAX };
}

// ── adaptador do shared/salesforce.js real ──────────────────────────
function adaptador(SF) {
  return {
    soql: function (q, maxPages) { return SF.soql(q, maxPages); },
    describe: function (s) { return SF.describe(s); },
    restGet: async function (caminho) {
      if (typeof SF.restGet === 'function') return SF.restGet(caminho);   // dublê de teste
      const a = await SF.getToken();
      const url = a.instance + '/services/data/' + SF.APIVER + caminho;
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + a.token, Accept: 'application/json' } });
      const txt = await r.text();
      if (!r.ok) throw new Error('SF ' + r.status + ': ' + txt.slice(0, 160));
      return JSON.parse(txt);
    },
    instancia: async function () { try { return (await SF.getToken()).instance; } catch (e) { return null; } }
  };
}

module.exports = {
  CAMPOS, CAMPOS_LICI, BASES, norm, resolverCampos, resolverViaProposta, tiposRegistro, fasesMeta, lerPeriodo, lerEscopo, condPeriodo,
  valorDe, diaBrt, carregar, detalhe, lerRegistro, adaptador, propostasDoPeriodo, historicoFases, encerradasNaJanela, diaFechouPeloCaminho, itensDasEncerradas,
  travaComercial, detalheComercial, acharComercial, acharLicitacao, travaLicitacao, soqlTxt, parecenca, ITEM_CAMPOS
};
