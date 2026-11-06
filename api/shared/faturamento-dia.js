// ================================================================
// api/shared/faturamento-dia.js — NOTAS FATURADAS NO DIA (D365 F&O, ao vivo)
//
// Pedido do dono (06/11/2026): "trazer as notas faturadas hoje, tanto venda
// como devolução, só da empresa MSB", direto do Dynamics (sem esperar a
// atualização do Power BI), pela entidade de DOCUMENTO FISCAL.
//
// SOMENTE LEITURA no Dynamics. NUNCA escreve.
//
// ── A MESMA INTELIGÊNCIA DAS FATURAS EM ABERTO ───────────────────
// Copiada da Cobrança Automática do portal completo
// (LeoBarbosa08/Claude.rep, api/shared/cobranca-d365.js e cobranca-nf.js):
//   • nada de coluna chumbada: cada PAPEL tem candidatas de entidade e de
//     coluna, e a entidade só é aceita se a linha de amostra expuser o que o
//     papel EXIGE ("responde" não é "serve");
//   • o que resolveu e o que falhou volta em `diagnostico` — para investigar
//     sem deploy: /api/faturamento-hoje?diag=1 traz também as colunas;
//   • tudo pode ser fixado por env (FATDIA_ENT_*, FATDIA_COL_*);
//   • cada ida ao F&O tem PRAZO (o SWA corta a Function em ~45 s sem avisar).
//
// ── AS DUAS FONTES ───────────────────────────────────────────────
//  1) FISCAL  FiscalDocuments — o nome PÚBLICO (OData) da
//     FiscalDocumentHeaderEntity no F&O da Biomedical (confirmado pelo
//     Financeiro em 09/10/2026; "FiscalDocumentHeaders" dá 404). É a fonte
//     pedida. Venda = documento de SAÍDA para CLIENTE; devolução = documento de
//     ENTRADA de CLIENTE (nota de compra, de fornecedor, fica de fora).
//  2) DIÁRIO  SalesInvoiceHeadersV2 (CustInvoiceJour) — CONFERÊNCIA. Em
//     15/10/2026 o portal completo achou a FiscalDocuments (OData) SEM nota
//     da MSB depois de 05/12/2023. Se isso ainda valer, ela volta vazia e a
//     tela cairia em "nenhuma nota hoje" mentindo. Por isso o diário é lido
//     junto: se a fiscal não trouxer nada no dia e o diário trouxer, a tela
//     mostra o diário e DIZ por quê (com a data da última nota da MSB na
//     FiscalDocuments). Fatura com valor negativo no diário = devolução
//     (nota de crédito).
//  3) CLIENTES CustomersV3 — razão social/CNPJ por conta e, quando a fiscal
//     não diz o tipo da conta, quem é cliente (separa devolução de compra).
//
// ── DATA ─────────────────────────────────────────────────────────
// "Hoje" é o dia em Brasília. O F&O guarda a data como meia-noite UTC: o
// filtro vai como [dia 00:00Z, dia seguinte 00:00Z) e, se a coluna for
// Edm.Date (400 no formato data-hora), cai no formato só data.
// ================================================================

const D = require('./d365');

const EMPRESA   = String(process.env.FATDIA_EMPRESA || process.env.ESTOQUE_MSB_EMPRESA || 'msb').trim().toLowerCase();
const TTL_MS    = Number(process.env.FATDIA_TTL_MS || 60000);      // cache do dia (1 min)
const ORCAMENTO = Number(process.env.FATDIA_ORCAMENTO_MS || 36000); // SWA corta em ~45 s
const PROVA_MS  = Number(process.env.FATDIA_PROVA_MS || 9000);     // teto da linha de amostra
const PRAZO_MS  = Number(process.env.FATDIA_PRAZO_MS || 20000);    // teto da leitura do dia
const CLI_TTL   = 6 * 3600000;                                      // razão social muda pouco
const ENT_TTL   = 30 * 60000;                                       // entidade/colunas resolvidas
const LOTE_CLI  = 25;                                               // contas por consulta
const FOLGA_MS  = 1500;

function envLista(nome, padrao) {
  const v = String(process.env[nome] || '').trim();
  return v ? v.split(',').map(s => s.trim()).filter(Boolean) : padrao;
}

// ── os papéis: candidatas, colunas e o que EXIGEM ────────────────
const PAPEIS = {
  fiscal: {
    rotulo: 'documentos fiscais',
    alvos: envLista('FATDIA_ENT_FISCAL', ['FiscalDocuments', 'FiscalDocumentHeaders', 'FiscalDocumentHeaderEntities']),
    exige: ['numero', 'data'],
    cols: {
      numero:    envLista('FATDIA_COL_NUMERO',  ['FiscalDocumentNumber', 'DocumentNumber', 'FiscalDocumentNum']),
      // emissão primeiro; a contábil só se a entidade não tiver a de emissão
      data:      envLista('FATDIA_COL_DATA',    ['FiscalDocumentDate', 'IssueDate', 'DocumentDate', 'EmissionDate', 'AccountingDate']),
      serie:     ['FiscalDocumentSeries', 'Series', 'FiscalDocumentSerie'],
      chave:     ['AccessKey', 'FiscalDocumentAccessKey', 'NFeAccessKey'],
      direcao:   envLista('FATDIA_COL_DIRECAO', ['Direction', 'FiscalDocumentDirection', 'DocumentDirection']),
      tipoConta: ['FiscalDocumentAccountType', 'AccountType', 'ThirdPartyAccountType'],
      conta:     ['FiscalDocumentAccountNum', 'CustAccount', 'CustomerAccount', 'InvoiceAccount', 'ThirdPartyAccountNum', 'ThirdPartyAccount', 'AccountNum'],
      nome:      ['ThirdPartyName', 'FiscalDocumentAccountName', 'CustomerName'],
      cnpj:      ['ThirdPartyCNPJCPF', 'CNPJCPF', 'FiscalDocumentAccountCNPJCPF', 'ThirdPartyCNPJ'],
      valor:     envLista('FATDIA_COL_VALOR',   ['TotalAmount', 'FiscalDocumentTotalAmount', 'DocumentTotalAmount', 'InvoiceAmount', 'TotalInvoiceAmount', 'Amount']),
      status:    ['Status', 'FiscalDocumentStatus', 'DocumentStatus'],
      emissor:   ['FiscalDocumentIssuer', 'Issuer'],
      // 06/11/26: o dono confirmou que o tipo de operação é o OperationDescription
      natureza:  envLista('FATDIA_COL_OPERACAO', ['OperationDescription', 'OperationNature', 'FiscalOperationNature', 'NatureOfOperation', 'OperationType', 'FiscalOperationType']),
      modelo:    ['Model', 'FiscalDocumentModel', 'FiscalDocumentSpecie']
    },
    // reserva por padrão de nome, quando nenhuma candidata exata existe
    re: {
      data:     /^(?!.*(cancel|due|venc|creat|modif)).*(document|issue|emission|fiscal).*date$/i,
      valor:    /(total.*amount|amount.*total|valor.*total|total.*valor)/i,
      direcao:  /direction|direcao/i,
      natureza: /natur|cfop/i
    }
  },
  diario: {
    rotulo: 'diário de faturas de venda',
    alvos: envLista('FATDIA_ENT_DIARIO', ['SalesInvoiceHeadersV2', 'SalesInvoiceHeaders', 'SalesInvoiceHeaderV4Entity']),
    exige: ['numero', 'data', 'valor'],
    cols: {
      numero: ['InvoiceNumber', 'InvoiceId'],
      data:   ['InvoiceDate'],
      conta:  ['InvoiceCustomerAccountNumber', 'InvoiceAccount', 'OrderingCustomerAccountNumber', 'CustomerAccount'],
      valor:  ['TotalInvoiceAmount', 'InvoiceTotalAmount', 'InvoiceAmount'],
      ordem:  ['SalesOrderNumber', 'SalesId'],
      moeda:  ['CurrencyCode'],
      natureza: envLista('FATDIA_COL_OPERACAO', ['OperationDescription'])
    },
    re: {}
  },
  cliente: {
    rotulo: 'clientes',
    alvos: envLista('FATDIA_ENT_CLIENTES', ['CustomersV3', 'Customers', 'CustomersV2']),
    exige: ['conta', 'nome'],
    cols: {
      conta: ['CustomerAccount', 'AccountNum'],
      nome:  ['OrganizationName', 'Name', 'NameAlias'],
      cnpj:  ['BrazilianCNPJOrCPF', 'CNPJCPFNum_BR', 'CNPJCPFNumber', 'CNPJCPFNum']
    },
    re: {}
  }
};

// ── AS OPERAÇÕES QUE CONTAM (06/11/2026, definidas pelo dono) ─────
// O tipo de operação da nota (OperationDescription) é quem diz se ela é
// faturamento. Só estas contam; o resto (remessa em consignação,
// bonificação, transferência, compra…) fica FORA da soma e a tela mostra
// quantas e quais. Trocar a lista sem deploy: FATDIA_OP_VENDA /
// FATDIA_OP_DEVOLUCAO, separadas por ";".
// REGRA ESTRITA (07/11/2026, depois de a nota 000021466 entrar sem ser de
// nenhuma das operações): a descrição tem que ser IGUAL a um item da lista —
// só maiúsculas, acentos, pontuação e espaços são ignorados. A versão
// anterior aceitava "começa com", e "Venda de produção do estabelecimento"
// engolia outras operações que começam igual (ST, fora do estabelecimento…).
// E nota SEM OperationDescription não conta (antes caía na regra da direção
// da nota): fica fora, como "(sem tipo de operação)". A lista traz as
// descrições como o Dynamics grava — cortadas ("…destinada a não contri").
function envListaPV(nome, padrao) {
  const v = String(process.env[nome] || '').trim();
  return v ? v.split(';').map(s => s.trim()).filter(Boolean) : padrao;
}
const OP_VENDA = envListaPV('FATDIA_OP_VENDA', [
  'Venda de produção do estabelecimento',
  'Venda de produção do estabelecimento, destinada a não contri',
  'Venda de produção do estabelecimento, destinada a não contribuinte',
  'Venda prod estab remet ant consignação mercantil'
]);
const OP_DEVOLUCAO = envListaPV('FATDIA_OP_DEVOLUCAO', [
  'Dev venda merc adquirida ou receb terceiros'
]);
const normOp = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const OP_V = OP_VENDA.map(normOp), OP_D = OP_DEVOLUCAO.map(normOp);
// -> 'venda' | 'devolucao' | 'outra' | null (sem descrição) — só IGUALDADE
function tipoPorOperacao(desc) {
  const n = normOp(desc);
  if (!n) return null;
  if (OP_D.indexOf(n) >= 0) return 'devolucao';
  if (OP_V.indexOf(n) >= 0) return 'venda';
  return 'outra';
}
const SEM_OP = '(sem tipo de operação)';
// número da nota sem zeros à esquerda ('000021466' -> '21466')
const numNorm = (v) => String(v == null ? '' : v).replace(/\D/g, '').replace(/^0+(?=.)/, '');

// ── util ─────────────────────────────────────────────────────────
const txt = (v) => String(v == null ? '' : v).trim();
function num(v) { if (v == null || v === '') return null; const n = Number(v); return isNaN(n) ? null : n; }
function colunasDe(row) { return Object.keys(row || {}).filter(k => k.charAt(0) !== '@'); }

// Data em ISO a partir do TEXTO, sem new Date(): o D365 manda o dia como
// meia-noite UTC e a conversão para Brasília jogava para o dia anterior.
function isoData(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(v));
  return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
}

function hojeSP() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function diaSeguinte(iso) {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Resolve cada campo numa coluna real (sem repetir coluna entre campos).
function mapaColunas(cols, def) {
  const baixo = {}; cols.forEach(c => { baixo[c.toLowerCase()] = c; });
  const usadas = {}, mapa = {};
  Object.keys(def.cols).forEach(campo => {
    mapa[campo] = null;
    for (const cand of def.cols[campo]) {
      const real = baixo[String(cand).toLowerCase()];
      if (real && !usadas[real]) { mapa[campo] = real; usadas[real] = 1; break; }
    }
  });
  Object.keys(def.re || {}).forEach(campo => {
    if (mapa[campo]) return;
    const real = cols.find(c => def.re[campo].test(c) && !usadas[c]);
    if (real) { mapa[campo] = real; usadas[real] = 1; }
  });
  return mapa;
}

function restante(ate) { return ate - Date.now(); }
function prazo(ate, teto) { return Math.max(1, Math.min(teto, restante(ate) - FOLGA_MS)); }

// ── descoberta da entidade de cada papel (cache 30 min) ──────────
const _ent = {};   // papel -> { ts, r }
async function resolver(papel, token, ate, diag, comColunas) {
  const c = _ent[papel];
  if (c && Date.now() - c.ts < ENT_TTL) { diag.push({ etapa: papel + ':entidade', entidade: c.r.entidade, cache: true }); return c.r; }
  const def = PAPEIS[papel];
  for (const ent of def.alvos) {
    if (restante(ate) < FOLGA_MS + 1000) { diag.push({ etapa: papel + ':entidade', entidade: ent, erro: 'sem tempo para testar' }); break; }
    let rows = null, erro = null;
    // a amostra é da MSB (a coluna que existe numa empresa existe nas outras,
    // mas a MSB pode não ter linha nenhuma: aí a amostra sai sem filtro)
    for (const filtro of ["dataAreaId eq '" + D.odataStr(EMPRESA) + "'", null]) {
      try {
        rows = await D.odataGetComPrazo(ent, Object.assign({ top: 1, crossCompany: true }, filtro ? { filter: filtro } : {}), token, prazo(ate, PROVA_MS));
        if (rows.length) break;
      } catch (e) { erro = String(e.message || e); if (/\b404\b/.test(erro) || e.demorou) break; }
    }
    if (!rows || !rows.length) {
      diag.push({ etapa: papel + ':entidade', entidade: ent, serve: false, erro: erro ? erro.slice(0, 220) : 'sem linhas' });
      continue;
    }
    const cols = colunasDe(rows[0]);
    const campos = mapaColunas(cols, def);
    const falta = def.exige.filter(k => !campos[k]);
    const item = { etapa: papel + ':entidade', entidade: ent, serve: !falta.length, campos, falta };
    if (comColunas) item.colunas = cols;
    diag.push(item);
    if (!falta.length) {
      const r = { entidade: ent, col: campos, colunas: cols };
      _ent[papel] = { ts: Date.now(), r };
      return r;
    }
  }
  return null;
}

// ── leitura do dia numa entidade resolvida ───────────────────────
// Formato data-hora primeiro; 400 = coluna Edm.Date -> formato só data.
async function lerDia(E, dia, token, ate, diag, papel) {
  const prox = diaSeguinte(dia);
  const c = E.col.data;
  const sel = Array.from(new Set(Object.values(E.col).filter(Boolean).concat(['dataAreaId'].filter(x => E.colunas.indexOf(x) >= 0)))).join(',');
  const formas = [
    { f: c + ' ge ' + dia + 'T00:00:00Z and ' + c + ' lt ' + prox + 'T00:00:00Z', rot: 'data-hora' },
    { f: c + ' ge ' + dia + ' and ' + c + ' lt ' + prox, rot: 'data' }
  ];
  let ultimo = null;
  for (const fo of formas) {
    if (restante(ate) < FOLGA_MS + 500) break;
    const filtro = "dataAreaId eq '" + D.odataStr(EMPRESA) + "' and " + fo.f;
    try {
      const rows = await D.odataGetComPrazo(E.entidade, { crossCompany: true, filter: filtro, select: sel }, token, prazo(ate, PRAZO_MS));
      diag.push({ etapa: papel + ':dia', entidade: E.entidade, forma: fo.rot, linhas: rows.length });
      // segurança: só o dia pedido (se o F&O ignorar parte do filtro, não passa)
      return rows.filter(r => isoData(r[c]) === dia);
    } catch (e) {
      ultimo = e;
      diag.push({ etapa: papel + ':dia', entidade: E.entidade, forma: fo.rot, erro: String(e.message || e).slice(0, 220) });
      if (!/\b400\b/.test(String(e.message))) break;   // só o 400 justifica tentar a outra forma
    }
  }
  throw ultimo || new Error('sem tempo para ler o dia em ' + E.entidade);
}

// última data com nota da MSB na entidade — o "por quê" de ela vir vazia
async function ultimaData(E, token, ate, diag) {
  if (restante(ate) < FOLGA_MS + 2000) return null;
  try {
    const rows = await D.odataGetComPrazo(E.entidade, {
      crossCompany: true, filter: "dataAreaId eq '" + D.odataStr(EMPRESA) + "'",
      orderby: E.col.data + ' desc', top: 1, select: E.col.data
    }, token, prazo(ate, 8000));
    const d = rows.length ? isoData(rows[0][E.col.data]) : null;
    diag.push({ etapa: 'fiscal:ultima', entidade: E.entidade, ultima: d });
    return d;
  } catch (e) {
    diag.push({ etapa: 'fiscal:ultima', entidade: E.entidade, erro: String(e.message || e).slice(0, 160) });
    return null;
  }
}

// ── clientes (razão social, CNPJ e "é cliente?"), cache 6 h ──────
const _cli = new Map();   // conta -> { ts, nome, cnpj, existe }
async function clientes(contas, token, ate, diag) {
  const agora = Date.now();
  const falta = Array.from(new Set(contas.filter(Boolean))).filter(c => { const x = _cli.get(c); return !x || agora - x.ts > CLI_TTL; });
  if (falta.length) {
    const E = await resolver('cliente', token, ate, diag, false).catch(() => null);
    if (E) {
      const sel = [E.col.conta, E.col.nome, E.col.cnpj].filter(Boolean).join(',');
      for (let i = 0; i < falta.length; i += LOTE_CLI) {
        if (restante(ate) < FOLGA_MS + 1000) { diag.push({ etapa: 'cliente:nomes', erro: 'sem tempo: ' + (falta.length - i) + ' conta(s) sem nome' }); break; }
        const lote = falta.slice(i, i + LOTE_CLI);
        const filtro = "dataAreaId eq '" + D.odataStr(EMPRESA) + "' and (" + lote.map(c => E.col.conta + " eq '" + D.odataStr(c) + "'").join(' or ') + ')';
        try {
          const rows = await D.odataGetComPrazo(E.entidade, { crossCompany: true, filter: filtro, select: sel }, token, prazo(ate, 10000));
          const achou = new Set();
          rows.forEach(r => {
            const k = txt(r[E.col.conta]); achou.add(k);
            _cli.set(k, { ts: Date.now(), nome: txt(r[E.col.nome]), cnpj: E.col.cnpj ? txt(r[E.col.cnpj]) : '', existe: true });
          });
          lote.forEach(k => { if (!achou.has(k)) _cli.set(k, { ts: Date.now(), nome: '', cnpj: '', existe: false }); });
        } catch (e) {
          diag.push({ etapa: 'cliente:nomes', entidade: E.entidade, erro: String(e.message || e).slice(0, 160) });
          break;
        }
      }
    }
  }
  const out = {};
  contas.forEach(c => { const x = _cli.get(c); if (x) out[c] = x; });
  return out;
}

// ── classificação ────────────────────────────────────────────────
const CANCELADA = /cancel|deneg|denied|inutil|reject|rejeit/i;
function direcaoDe(v) {
  const s = txt(v).toLowerCase();
  if (/^out|sa[ií]da|^s$/.test(s)) return 'saida';
  if (/^in|entrada|^e$/.test(s)) return 'entrada';
  return null;
}
function tipoContaDe(v) {
  const s = txt(v).toLowerCase();
  if (/cust|client/.test(s)) return 'cliente';
  if (/vend|fornec|supplier/.test(s)) return 'fornecedor';
  return null;
}

// fora da soma: conta por operação e guarda a nota (o diagnóstico lista)
function poeFora(fora, numero, op, valor) {
  const k = op || SEM_OP;
  fora.operacoes[k] = (fora.operacoes[k] || 0) + 1;
  fora.valores = fora.valores || {};
  if (valor != null) fora.valores[k] = Math.round(((fora.valores[k] || 0) + valor) * 100) / 100;
  if (fora.notas.length < 500) fora.notas.push({ numero, operacao: k, valor: valor == null ? null : valor });
}

// Só a OPERAÇÃO decide (a direção da nota e o tipo da conta não entram mais:
// as operações da lista já dizem se é venda ou devolução de cliente).
function notasFiscal(rows, E, cli) {
  const C = E.col, out = [], fora = { operacoes: {}, notas: [] };
  rows.forEach(r => {
    const conta = C.conta ? txt(r[C.conta]) : '';
    const op = C.natureza ? txt(r[C.natureza]) : '';
    const porOp = tipoPorOperacao(op);
    if (porOp !== 'venda' && porOp !== 'devolucao') { poeFora(fora, txt(r[C.numero]), op, C.valor ? num(r[C.valor]) : null); return; }
    const status = C.status ? txt(r[C.status]) : '';
    const c = cli[conta] || {};
    out.push({
      tipo: porOp,
      numero: txt(r[C.numero]),
      serie: C.serie ? txt(r[C.serie]) : '',
      chave: C.chave ? txt(r[C.chave]) : '',
      emissao: isoData(r[C.data]),
      conta,
      cliente: (C.nome && txt(r[C.nome])) || c.nome || '',
      cnpj: (C.cnpj && txt(r[C.cnpj])) || c.cnpj || '',
      valor: C.valor ? num(r[C.valor]) : null,
      status,
      cancelada: !!(status && CANCELADA.test(status)),
      operacao: op,
      emissor: C.emissor ? txt(r[C.emissor]) : ''
    });
  });
  return { notas: out, fora };
}

// operação de uma nota do diário pelo mapa número -> [{conta, op}] da fiscal:
// a da mesma conta; senão, a única operação que aparecer para o número
function opDoMapa(mapa, numero, conta) {
  const cands = mapa[numNorm(numero)] || [];
  if (!cands.length) return '';
  const mesma = cands.filter(x => x.conta && x.conta === conta);
  const lista = mesma.length ? mesma : cands;
  const ops = Array.from(new Set(lista.map(x => x.op).filter(Boolean)));
  return ops.length === 1 ? ops[0] : '';
}

function notasDiario(rows, E, cli, fora, mapaOp) {
  const C = E.col;
  return rows.map(r => {
    const conta = C.conta ? txt(r[C.conta]) : '';
    const v = num(r[C.valor]);
    const c = cli[conta] || {};
    const numero = txt(r[C.numero]);
    const op = (C.natureza && txt(r[C.natureza])) || opDoMapa(mapaOp || {}, numero, conta);
    const porOp = tipoPorOperacao(op);
    if (porOp !== 'venda' && porOp !== 'devolucao') { if (fora) poeFora(fora, numero, op, v == null ? null : Math.abs(v)); return null; }
    return {
      tipo: porOp,
      numero, serie: '', chave: '',
      emissao: isoData(r[C.data]),
      conta, cliente: c.nome || '', cnpj: c.cnpj || '',
      valor: v == null ? null : Math.abs(v),
      status: '', cancelada: false, operacao: op,
      ordem: C.ordem ? txt(r[C.ordem]) : ''
    };
  }).filter(Boolean);
}

function resumo(notas) {
  const r = { venda: { qtd: 0, valor: 0 }, devolucao: { qtd: 0, valor: 0 }, canceladas: 0, semValor: 0 };
  notas.forEach(n => {
    if (n.cancelada) { r.canceladas++; return; }
    r[n.tipo].qtd++;
    if (n.valor == null) r.semValor++; else r[n.tipo].valor += n.valor;
  });
  r.venda.valor = Math.round(r.venda.valor * 100) / 100;
  r.devolucao.valor = Math.round(r.devolucao.valor * 100) / 100;
  r.liquido = Math.round((r.venda.valor - r.devolucao.valor) * 100) / 100;
  return r;
}

// todas as notas do dia agrupadas pelo OperationDescription:
// { operacao, conta: 'venda'|'devolucao'|'fora', qtd, valor, canceladas }
function porOperacao(notas, fora) {
  const g = {};
  const linha = (k, conta) => g[k] || (g[k] = { operacao: k, conta, qtd: 0, valor: 0, canceladas: 0 });
  (notas || []).forEach(n => {
    const x = linha(n.operacao || SEM_OP, n.tipo);
    if (n.cancelada) { x.canceladas++; return; }
    x.qtd++; x.valor += n.valor || 0;
  });
  if (fora) Object.keys(fora.operacoes || {}).forEach(k => {
    const x = linha(k, 'fora');
    x.qtd += fora.operacoes[k];
    x.valor += (fora.valores || {})[k] || 0;
  });
  return Object.values(g).map(x => Object.assign(x, { valor: Math.round(x.valor * 100) / 100 }))
    .sort((a, b) => b.valor - a.valor || b.qtd - a.qtd);
}

function ordenar(notas) {
  return notas.sort((a, b) => (b.numero.replace(/\D/g, '') - a.numero.replace(/\D/g, '')) || b.numero.localeCompare(a.numero));
}

// número -> [{conta, op}] a partir de linhas da entidade fiscal
function juntaOps(mapa, rows, E) {
  rows.forEach(r => {
    const k = numNorm(r[E.col.numero]); if (!k) return;
    (mapa[k] = mapa[k] || []).push({ conta: E.col.conta ? txt(r[E.col.conta]) : '', op: txt(r[E.col.natureza]) });
  });
}
// busca na fiscal, pelo número, a operação das notas do diário que a leitura
// do dia não trouxe (o número vai como veio, sem zeros e com 9 dígitos)
async function opsPorNumero(F, numeros, token, ate, diag) {
  const mapa = {};
  const C = F.col;
  const sel = [C.numero, C.natureza, C.conta].filter(Boolean).join(',');
  for (let i = 0; i < numeros.length; i += 10) {
    if (restante(ate) < FOLGA_MS + 1000) { diag.push({ etapa: 'fiscal:operacao', erro: 'sem tempo: ' + (numeros.length - i) + ' nota(s) sem operação' }); break; }
    const formas = [];
    numeros.slice(i, i + 10).forEach(n => {
      const d = numNorm(n);
      [txt(n), d, ('000000000' + d).slice(-9)].forEach(f => { if (f && formas.indexOf(f) < 0) formas.push(f); });
    });
    const filtro = "dataAreaId eq '" + D.odataStr(EMPRESA) + "' and (" + formas.map(f => C.numero + " eq '" + D.odataStr(f) + "'").join(' or ') + ')';
    try {
      const rows = await D.odataGetComPrazo(F.entidade, { crossCompany: true, filter: filtro, select: sel }, token, prazo(ate, 10000));
      juntaOps(mapa, rows, F);
      diag.push({ etapa: 'fiscal:operacao', entidade: F.entidade, numeros: numeros.slice(i, i + 10).length, linhas: rows.length });
    } catch (e) {
      diag.push({ etapa: 'fiscal:operacao', entidade: F.entidade, erro: String(e.message || e).slice(0, 200) });
      break;
    }
  }
  return mapa;
}

// ── o motor ──────────────────────────────────────────────────────
const _cache = new Map();   // dia -> { ts, r }
async function notasDoDia(opts) {
  opts = opts || {};
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.data || '')) ? String(opts.data) : hojeSP();
  const c = _cache.get(dia);
  if (!opts.atualizar && !opts.diag && c && Date.now() - c.ts < TTL_MS) return Object.assign({}, c.r, { cache: true });

  const ate = Date.now() + ORCAMENTO;
  const diag = [];
  const token = await D.getToken();

  // fiscal e diário em paralelo: um não espera o outro
  const lerFonte = async (papel) => {
    const E = await resolver(papel, token, ate, diag, !!opts.diag);
    if (!E) return { E: null, rows: [], erro: 'nenhuma entidade de ' + PAPEIS[papel].rotulo + ' serviu' };
    try { return { E, rows: await lerDia(E, dia, token, ate, diag, papel), erro: null }; }
    catch (e) { return { E, rows: [], erro: String(e.message || e) }; }
  };
  const [F, J] = await Promise.all([lerFonte('fiscal'), lerFonte('diario')]);

  // contas que precisam de nome (ou de "é cliente?" na fiscal sem tipo de conta)
  const contas = [];
  if (F.E && F.E.col.conta) F.rows.forEach(r => {
    const k = txt(r[F.E.col.conta]);
    // nome vazio na própria nota (a coluna existe mas veio em branco) também vai ao cadastro
    if (k && (!F.E.col.tipoConta || !F.E.col.nome || !txt(r[F.E.col.nome]))) contas.push(k);
  });
  if (J.E && J.E.col.conta) J.rows.forEach(r => { const k = txt(r[J.E.col.conta]); if (k) contas.push(k); });
  const cli = contas.length ? await clientes(contas, token, ate, diag) : {};

  const fiscal = F.E ? notasFiscal(F.rows, F.E, cli) : { notas: [], fora: { operacoes: {}, notas: [] } };
  // o diário não traz a operação: ela vem da fiscal pelo número da nota —
  // primeiro das linhas fiscais do dia já lidas, depois buscando as que faltam
  let mapaOp = {};
  if (J.E && J.rows.length && !J.E.col.natureza && F.E && F.E.col.natureza) {
    juntaOps(mapaOp, F.rows, F.E);
    const faltam = Array.from(new Set(J.rows.map(r => txt(r[J.E.col.numero])).filter(n => n && !mapaOp[numNorm(n)])));
    if (faltam.length) {
      const extra = await opsPorNumero(F.E, faltam, token, ate, diag);
      Object.keys(extra).forEach(k => { mapaOp[k] = (mapaOp[k] || []).concat(extra[k]); });
    }
  }
  const foraDiario = { operacoes: {}, notas: [] };
  const diario = J.E ? notasDiario(J.rows, J.E, cli, foraDiario, mapaOp) : [];
  const avisos = [];

  let fonte, notas, ultimaFiscal = null;
  if (fiscal.notas.length || !diario.length) {
    fonte = F.E ? { papel: 'fiscal', entidade: F.E.entidade, colunas: F.E.col } : null;
    notas = fiscal.notas;
    // dia vazio nas duas: a data da última nota da MSB na fiscal diz se é
    // "ainda não faturou hoje" ou "a entidade parou" (o caso de 2023)
    if (!notas.length && F.E && !F.erro) ultimaFiscal = await ultimaData(F.E, token, ate, diag);
  } else {
    // a fiscal não trouxe nada e o diário trouxe: mostra o diário e diz por quê
    const ult = F.E ? await ultimaData(F.E, token, ate, diag) : null;
    fonte = { papel: 'diario', entidade: J.E.entidade, colunas: J.E.col };
    notas = diario;
    avisos.push((F.E ? 'A ' + F.E.entidade + ' (documento fiscal) não trouxe nenhuma nota da MSB neste dia'
      + (ult ? ' — a última nota da MSB nela é de ' + ult.split('-').reverse().join('/') : '') : 'Nenhuma entidade de documento fiscal serviu')
      + '. As notas abaixo vêm do diário de faturas de venda (' + J.E.entidade + ').');
  }
  if (F.erro) avisos.push('Documento fiscal: ' + F.erro.slice(0, 200));
  if (J.erro && fonte && fonte.papel === 'diario') avisos.push('Diário de faturas: ' + J.erro.slice(0, 200));
  if (fonte && fonte.papel === 'fiscal' && !F.E.col.valor) avisos.push('A ' + F.E.entidade + ' não expõe o valor total da nota: a coluna Valor fica vazia.');
  if (fonte && fonte.papel === 'fiscal' && !F.E.col.natureza) avisos.push('A ' + F.E.entidade + ' não traz o tipo de operação (OperationDescription): nenhuma nota pôde ser conferida com a lista de operações do faturamento.');
  if (fonte && fonte.papel === 'diario' && !J.E.col.natureza) avisos.push((F.E && F.E.col.natureza)
    ? 'O tipo de operação de cada nota do diário foi buscado na ' + F.E.entidade + ' pelo número da nota; a que não foi achada lá ficou fora da soma.'
    : 'O diário de faturas (' + J.E.entidade + ') não traz o tipo de operação (OperationDescription) e não há documento fiscal de onde buscá-lo: nenhuma nota pôde ser conferida.');
  const foraAqui = fonte ? (fonte.papel === 'fiscal' ? fiscal.fora : foraDiario) : null;
  if (foraAqui && foraAqui.operacoes[SEM_OP]) avisos.push(foraAqui.operacoes[SEM_OP] + ' nota(s) sem tipo de operação (OperationDescription) no Dynamics ficaram fora da soma.');

  const r = {
    ok: true, configured: true, empresa: EMPRESA, data: dia, hoje: hojeSP(),
    geradoEm: new Date().toISOString(),
    fonte,
    notas: ordenar(notas),
    resumo: resumo(notas),
    // notas de operações que não são faturamento: { "Remessa em consignação": 2, … }
    foraPorOperacao: foraAqui ? foraAqui.operacoes : {},
    // e quais notas (o diagnóstico da tela lista: número + operação)
    foraNotas: foraAqui ? foraAqui.notas : [],
    // 07/11/26 (pedido do dono, para conferir o líquido): TODAS as notas do dia
    // por tipo de operação — as que contam e as que ficaram fora — com valor
    porOperacao: porOperacao(notas, foraAqui),
    ultimaFiscal,
    // a outra fonte, para conferir os totais
    conferencia: fonte && fonte.papel === 'fiscal' && J.E && !J.erro
      ? Object.assign({ entidade: J.E.entidade }, resumo(diario)) : null,
    avisos,
    diagnostico: diag
  };
  if (!opts.diag) _cache.set(dia, { ts: Date.now(), r });
  return r;
}

function _limparCache() { _cache.clear(); _cli.clear(); Object.keys(_ent).forEach(k => delete _ent[k]); }

module.exports = { notasDoDia, hojeSP, EMPRESA, CONFIGURED: D.CONFIGURED, _limparCache, _interno: { mapaColunas, PAPEIS, direcaoDe, tipoContaDe, tipoPorOperacao } };
