// ================================================================
// api/shared/kanban-ov.js — ORDENS DE VENDA DO DIA para o quadro KANBAN
//                           (D365 F&O, ao vivo, só a empresa MSB)
//
// Pedido do dono (06/11/2026): "crie uma área chamada KANBAN, conecte as
// ordens de venda (BIOSalesOrderHeaderV1, SalesOrderHeaderV3…), traga as
// ordens de venda do dia; depois vou triar o que cada status significa;
// integração realtime".
//
// SOMENTE LEITURA no Dynamics. NUNCA escreve.
//
// ── AS ENTIDADES ─────────────────────────────────────────────────
// Cabeçalho da OV em DUAS fontes, juntas pelo número da OV:
//   • a PRINCIPAL é a que define "do dia": a primeira candidata que responde
//     com o número da OV E uma coluna de data de criação;
//   • as outras que respondem (a BIO própria e a padrão) entram como
//     COMPLEMENTO, lidas pelos números das OVs do dia.
// Candidatas, na ordem: KANBAN_ENT_OV (env, lista), as Bio próprias
// (BIOSalesOrderHeaderV1 & variações de nome público), SalesOrderHeadersV3,
// SalesOrderHeadersV2, SalesOrderHeaders, e o que mais o service document
// do F&O publicar com "salesorderheader" no nome. Mesma inteligência das
// Faturas em Aberto (cobranca-d365.js do portal completo): a entidade só é
// aceita se a linha de amostra expuser o que o papel exige, e o que deu
// certo/errado volta em `diagnostico` (?diag=1 traz as colunas).
//
// ── STATUS ───────────────────────────────────────────────────────
// O dono vai decidir depois o que cada status significa. Por isso NADA de
// status é traduzido aqui: TODA coluna com cara de status, de TODAS as
// entidades, vai para a tela com os valores crus e a contagem de OVs em
// cada um — a tela agrupa o quadro pela coluna escolhida. Cada OV leva
// também os campos crus de cada entidade (sem os vazios), para conferir.
//
// ── DATA ─────────────────────────────────────────────────────────
// "Do dia" = criada no dia em Brasília (UTC-3, sem horário de verão desde
// 2019). Coluna data-hora: [dia 03:00Z, dia+1 03:00Z). Coluna só data:
// [dia 00:00Z, dia+1 00:00Z), e no formato Edm.Date se a data-hora der 400.
// ================================================================

const D = require('./d365');

const EMPRESA   = String(process.env.KANBAN_EMPRESA || process.env.ESTOQUE_MSB_EMPRESA || 'msb').trim().toLowerCase();
const TTL_MS    = Number(process.env.KANBAN_TTL_MS || 15000);        // cache do dia: 15 s (a tela consulta a cada 30 s)
const ORCAMENTO = Number(process.env.KANBAN_ORCAMENTO_MS || 36000);  // SWA corta em ~45 s
const PROVA_MS  = Number(process.env.KANBAN_PROVA_MS || 8000);
const PRAZO_MS  = Number(process.env.KANBAN_PRAZO_MS || 20000);
const LOTE_OV   = 20;                                                 // OVs por consulta (complemento e linhas)
const ENT_TTL   = 30 * 60000;
const FOLGA_MS  = 1500;
const FUSO_H    = 3;                                                  // Brasília = UTC-3

function envLista(nome, padrao) {
  const v = String(process.env[nome] || '').trim();
  return v ? v.split(',').map(s => s.trim()).filter(Boolean) : padrao;
}

const CANDIDATAS = envLista('KANBAN_ENT_OV', []).concat([
  'BIOSalesOrderHeaderV1', 'BIOSalesOrderHeadersV1', 'BioSalesOrderHeaderV1Entities', 'BIOSalesOrderHeaderV1Entities',
  'SalesOrderHeadersV3', 'SalesOrderHeadersV2', 'SalesOrderHeaders'
]).filter((v, i, a) => a.indexOf(v) === i);
const ENT_LINHAS = envLista('KANBAN_ENT_LINHAS', ['SalesOrderLines', 'SalesOrderLinesV2', 'SalesOrderLinesV3']);

// colunas de cada informação, pelos nomes que ela tem nas entidades do F&O
const COLS = {
  numero:   envLista('KANBAN_COL_NUMERO', ['SalesOrderNumber', 'SalesId', 'SALESID', 'SalesOrderId']),
  criadaEm: envLista('KANBAN_COL_CRIADA', ['OrderCreationDateTime', 'SalesOrderCreationDateTime', 'CreatedDateTime', 'CREATEDDATETIME', 'CreatedOn', 'CreatedDate', 'CreationDate']),
  conta:    ['OrderingCustomerAccountNumber', 'CustomerAccountNumber', 'CustAccount', 'CUSTACCOUNT', 'InvoiceCustomerAccountNumber'],
  nome:     ['SalesOrderName', 'SalesName', 'SALESNAME', 'CustomerName', 'DeliveryAddressName'],
  oc:       ['CustomersOrderReference', 'CustomerRequisitionNumber', 'PurchOrderFormNum', 'CustomerRef', 'PurchaseOrderFormNumber'],
  entrega:  ['RequestedShippingDate', 'ShippingDateRequested', 'RequestedReceiptDate', 'DeliveryDate'],
  deposito: ['DefaultShippingWarehouseId', 'InventLocationId', 'ShippingWarehouseId'],
  pool:     ['SalesOrderPoolId', 'SalesPoolId'],
  criadoPor:['OrderTakerPersonnelNumber', 'CreatedBy', 'CREATEDBY', 'OrderResponsiblePersonnelNumber']
};
const RE_CRIADA = /creat.*(date|time)|criad/i;
// coluna com cara de status (inclusive as próprias da Bio, em português)
const RE_STATUS = /status|situa|stage|etapa|fase|workflow|libera|release|hold|bloq|credit|credito|cr[eé]dito/i;
const RE_NAO_STATUS = /date|time|data|hora|reason|motivo|user|usuario|by$|limit|amount|valor|id$|number|card|cartao/i;
const VAZIOS = /^(|0|1900-01-01T00:00:00Z|00000000-0000-0000-0000-000000000000|None|NoYes'No'|No)$/;

// ── AS 4 ETAPAS DO QUADRO (07/11/2026, definidas pelo dono) ──────
// "Quando a ordem entra no sistema ela entra como Criada, depois vai para
// Gerenciamento de Crédito, Liberado e Faturado." Pelos campos da OV:
//   SalesStatus            "Ordem em aberto" (Backorder) | Faturado | Entregue | Cancelado
//   ReleaseStatus          "Liberado" (Released) | "Abrir" (Open)
//   CredManInCreditControl marcado = em gerenciamento de crédito
// Ordem de prioridade (a da fala do dono, ajustada num ponto: OV FATURADA
// também está liberada — a OV017517 tem Faturado + Liberado —, então o
// "Liberado" só vale para a ordem ainda em aberto):
//   1) SalesStatus que não é "Ordem em aberto" -> Faturado ("o restante")
//      (cancelada não é faturamento: fica FORA do quadro, contada à parte)
//   2) CredManInCreditControl marcado          -> Gerenciamento de Crédito
//   3) ReleaseStatus = Liberado                -> Liberado
//   4) senão                                   -> Criada
// Aceita o valor do OData (nome do enum: Backorder, Released, Yes) e o rótulo
// em português da tela do F&O. Colunas trocáveis por env: KANBAN_COL_SALESSTATUS,
// KANBAN_COL_RELEASE, KANBAN_COL_CREDITO.
const ETAPAS = [
  { id: 'criada',   nome: 'Criada' },
  { id: 'credito',  nome: 'Gerenciamento de Crédito' },
  { id: 'liberado', nome: 'Liberado' },
  { id: 'faturado', nome: 'Faturado' }
];
const COL_SALES   = envLista('KANBAN_COL_SALESSTATUS', ['SalesStatus', 'SalesOrderStatus']);
const COL_RELEASE = envLista('KANBAN_COL_RELEASE', ['ReleaseStatus', 'SalesOrderReleaseStatus']);
const COL_CREDITO = envLista('KANBAN_COL_CREDITO', ['CredManInCreditControl', 'CreditManagementInCreditControl', 'InCreditControl']);
const normV = (v) => String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// enum SalesStatus do F&O: None 0, Backorder 1, Delivered 2, Invoiced 3, Canceled 4
function situacaoOv(v) {
  const n = normV(v);
  if (!n) return null;
  if (/^(backorder|ordem em aberto|em aberto|aberta|aberto|1)$/.test(n)) return 'aberta';
  if (/^(canceled|cancelled|cancelado|cancelada|4)$/.test(n)) return 'cancelada';
  return 'outra';
}
const liberadoV = (v) => /^(released|liberado|liberada)$/.test(normV(v));
const marcadoV = (v) => v === true || /^(yes|sim|true|1|noyes yes)$/.test(normV(v));
function etapaDe(sales, release, credito) {
  const sit = situacaoOv(sales);
  if (sit === 'cancelada') return 'cancelada';
  if (sit === 'outra') return 'faturado';
  if (marcadoV(credito)) return 'credito';
  if (liberadoV(release)) return 'liberado';
  return 'criada';
}

// ── util ─────────────────────────────────────────────────────────
const txt = (v) => String(v == null ? '' : v).trim();
function num(v) { if (v == null || v === '') return null; const n = Number(v); return isNaN(n) ? null : n; }
function colunasDe(row) { return Object.keys(row || {}).filter(k => k.charAt(0) !== '@'); }
function restante(ate) { return ate - Date.now(); }
function prazo(ate, teto) { return Math.max(1, Math.min(teto, restante(ate) - FOLGA_MS)); }
function hojeSP() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function maisDias(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function achaCol(cols, nomes) {
  const baixo = {}; cols.forEach(c => { baixo[c.toLowerCase()] = c; });
  for (const n of nomes) { const r = baixo[String(n).toLowerCase()]; if (r) return r; }
  return null;
}
const ehDataHora = (col) => /time/i.test(col);
// dia (Brasília) de um valor da coluna de criação
function diaDe(v, col) {
  const s = txt(v);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  if (!ehDataHora(col)) return s.slice(0, 10);
  const t = Date.parse(s.length === 10 ? s + 'T00:00:00Z' : s);
  return isNaN(t) ? null : new Date(t - FUSO_H * 3600000).toISOString().slice(0, 10);
}
function chaveOv(v) { return txt(v).toUpperCase(); }

// ── descoberta: quais entidades de cabeçalho respondem (cache 30 min) ─
let _ents = null, _entsTs = 0, _servico = null, _servicoTs = 0;
async function doServico(token, ate) {
  if (_servico && Date.now() - _servicoTs < ENT_TTL) return _servico;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), prazo(ate, 8000));
    const r = await fetch(D.RESOURCE + '/data', { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('service document ' + r.status);
    const j = JSON.parse(await r.text());
    _servico = (Array.isArray(j.value) ? j.value : []).map(e => txt(e && (e.name || e.url))).filter(Boolean);
  } catch (e) { _servico = _servico || []; }
  _servicoTs = Date.now();
  return _servico;
}

async function sondar(ent, token, ate) {
  let rows = null, erro = null;
  for (const filtro of ["dataAreaId eq '" + D.odataStr(EMPRESA) + "'", null]) {
    try {
      rows = await D.odataGetComPrazo(ent, Object.assign({ top: 1, crossCompany: true }, filtro ? { filter: filtro } : {}), token, prazo(ate, PROVA_MS));
      if (rows.length) break;
    } catch (e) { erro = String(e.message || e); if (/\b404\b/.test(erro) || e.demorou) break; }
  }
  if (!rows || !rows.length) return { entidade: ent, serve: false, erro: erro ? erro.slice(0, 200) : 'sem linhas' };
  const cols = colunasDe(rows[0]);
  const numero = achaCol(cols, COLS.numero);
  const criadaEm = achaCol(cols, COLS.criadaEm) || cols.find(c => RE_CRIADA.test(c)) || null;
  const temEmpresa = cols.some(c => c.toLowerCase() === 'dataareaid');
  return { entidade: ent, serve: !!numero, numero, criadaEm, temEmpresa, colunas: cols, erro: numero ? null : 'sem coluna de número da OV' };
}

async function entidades(token, ate, diag, comColunas) {
  if (_ents && Date.now() - _entsTs < ENT_TTL) { diag.push({ etapa: 'ov:entidades', cache: true, usadas: _ents.map(e => e.entidade) }); return _ents; }
  const servico = await doServico(token, ate);
  const existe = {}; servico.forEach(n => { existe[n.toLowerCase()] = n; });
  let alvos = CANDIDATAS.map(n => existe[n.toLowerCase()] || n);
  if (servico.length) {
    // com o service document: só as candidatas publicadas + as que ele tiver com "salesorderheader"
    alvos = alvos.filter(n => existe[n.toLowerCase()]);
    servico.filter(n => /salesorderheader/i.test(n) && alvos.indexOf(n) < 0).slice(0, 6).forEach(n => alvos.push(n));
    diag.push({ etapa: 'ov:servico', publicadas: alvos });
  }
  // em paralelo: a primeira abertura não pode gastar o orçamento testando uma a uma
  const sondas = await Promise.all(alvos.map(ent => sondar(ent, token, ate).catch(e => ({ entidade: ent, serve: false, erro: String(e.message || e).slice(0, 200) }))));
  const achadas = [];
  sondas.forEach(s => {
    const item = { etapa: 'ov:entidade', entidade: s.entidade, serve: s.serve, numero: s.numero || null, criadaEm: s.criadaEm || null, empresa: !!s.temEmpresa, erro: s.erro };
    if (comColunas && s.colunas) item.colunas = s.colunas;
    diag.push(item);
    if (s.serve) achadas.push(s);
  });
  if (achadas.length) { _ents = achadas; _entsTs = Date.now(); }
  return achadas;
}

// ── leituras ─────────────────────────────────────────────────────
async function ovsDoDia(E, dia, token, ate, diag) {
  const c = E.criadaEm;
  const dh = ehDataHora(c);
  const ini = dh ? dia + 'T0' + FUSO_H + ':00:00Z' : dia + 'T00:00:00Z';
  const fim = dh ? maisDias(dia, 1) + 'T0' + FUSO_H + ':00:00Z' : maisDias(dia, 1) + 'T00:00:00Z';
  const formas = [{ f: c + ' ge ' + ini + ' and ' + c + ' lt ' + fim, rot: 'data-hora' }];
  if (!dh) formas.push({ f: c + ' ge ' + dia + ' and ' + c + ' lt ' + maisDias(dia, 1), rot: 'data' });
  let ultimo = null;
  for (const fo of formas) {
    try {
      const rows = await D.odataGetComPrazo(E.entidade, { crossCompany: true, filter: (E.temEmpresa ? "dataAreaId eq '" + D.odataStr(EMPRESA) + "' and " : '') + fo.f }, token, prazo(ate, PRAZO_MS));
      diag.push({ etapa: 'ov:dia', entidade: E.entidade, coluna: c, forma: fo.rot, linhas: rows.length });
      return rows.filter(r => diaDe(r[c], c) === dia);
    } catch (e) {
      ultimo = e;
      diag.push({ etapa: 'ov:dia', entidade: E.entidade, coluna: c, forma: fo.rot, erro: String(e.message || e).slice(0, 220) });
      if (!/\b400\b/.test(String(e.message))) break;
    }
  }
  throw ultimo || new Error('sem tempo para ler as OVs do dia');
}

// linhas de uma entidade pelos números das OVs (em lotes)
async function porNumeros(ent, colNum, numeros, token, ate, diag, etapa, select, semEmpresa) {
  const out = [];
  for (let i = 0; i < numeros.length; i += LOTE_OV) {
    if (restante(ate) < FOLGA_MS + 1000) { diag.push({ etapa, entidade: ent, erro: 'sem tempo: ' + (numeros.length - i) + ' OV(s) sem ' + etapa.split(':')[1] }); break; }
    const lote = numeros.slice(i, i + LOTE_OV);
    const filtro = (semEmpresa ? '' : "dataAreaId eq '" + D.odataStr(EMPRESA) + "' and ") + '(' + lote.map(n => colNum + " eq '" + D.odataStr(n) + "'").join(' or ') + ')';
    try {
      const rows = await D.odataGetComPrazo(ent, Object.assign({ crossCompany: true, filter: filtro }, select ? { select } : {}), token, prazo(ate, 12000));
      rows.forEach(r => out.push(r));
    } catch (e) {
      diag.push({ etapa, entidade: ent, erro: String(e.message || e).slice(0, 200) });
      throw e;
    }
  }
  diag.push({ etapa, entidade: ent, linhas: out.length });
  return out;
}

// valor e nº de itens pelas linhas da OV
let _entLinhas = null;
async function linhas(numeros, token, ate, diag) {
  const alvos = _entLinhas ? [_entLinhas] : ENT_LINHAS;
  for (const ent of alvos) {
    try {
      const rows = await porNumeros(ent, 'SalesOrderNumber', numeros, token, ate, diag, 'ov:linhas', 'SalesOrderNumber,LineAmount,dataAreaId');
      _entLinhas = ent;
      const por = {};
      rows.forEach(r => {
        const k = chaveOv(r.SalesOrderNumber);
        const o = por[k] || (por[k] = { valor: 0, itens: 0 });
        o.itens++; o.valor += Number(r.LineAmount) || 0;
      });
      Object.keys(por).forEach(k => { por[k].valor = Math.round(por[k].valor * 100) / 100; });
      return por;
    } catch (e) {
      if (!/\b(400|404)\b/.test(String(e.message))) return {};
    }
  }
  return {};
}

// campos crus de uma linha, sem os vazios (o painel da OV mostra tudo)
function crus(row) {
  const o = {};
  colunasDe(row).forEach(k => {
    const v = row[k];
    if (v == null || typeof v === 'object') return;
    const s = txt(v);
    if (VAZIOS.test(s)) return;
    o[k] = typeof v === 'number' || typeof v === 'boolean' ? v : s.slice(0, 300);
  });
  return o;
}

// ── o motor ──────────────────────────────────────────────────────
const _cache = new Map();
async function ordensDoDia(opts) {
  opts = opts || {};
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.data || '')) ? String(opts.data) : hojeSP();
  const c = _cache.get(dia);
  if (!opts.atualizar && !opts.diag && c && Date.now() - c.ts < TTL_MS) return Object.assign({}, c.r, { cache: true });

  const ate = Date.now() + ORCAMENTO;
  const diag = [], avisos = [];
  const token = await D.getToken();
  const ents = await entidades(token, ate, diag, !!opts.diag);
  const base = { ok: true, configured: true, empresa: EMPRESA, data: dia, hoje: hojeSP(), geradoEm: new Date().toISOString() };
  if (!ents.length) {
    return Object.assign(base, { fontes: [], etapas: ETAPAS.map(e => Object.assign({ qtd: 0, valor: 0 }, e)), canceladas: 0, statusCols: [], statusPadrao: null, ovs: [],
      avisos: ['Nenhuma entidade de ordem de venda respondeu no Dynamics (testadas: ' + CANDIDATAS.join(', ') + '). Veja o diagnóstico.'], diagnostico: diag });
  }

  const principal = ents.find(e => e.criadaEm && e.temEmpresa) || ents.find(e => e.criadaEm);
  if (principal && !principal.temEmpresa) avisos.push('A ' + principal.entidade + ' não tem a coluna de empresa (dataAreaId): não deu para garantir que só venham OVs da MSB.');
  if (!principal) {
    return Object.assign(base, { fontes: ents.map(e => ({ entidade: e.entidade, papel: 'sem data' })), etapas: ETAPAS.map(e => Object.assign({ qtd: 0, valor: 0 }, e)), canceladas: 0, statusCols: [], statusPadrao: null, ovs: [],
      avisos: ['As entidades de ordem de venda responderam, mas nenhuma tem coluna de data de criação para separar as OVs do dia (' + ents.map(e => e.entidade).join(', ') + '). Fixe a coluna em KANBAN_COL_CRIADA.'], diagnostico: diag });
  }

  const rows = await ovsDoDia(principal, dia, token, ate, diag);
  const numeros = Array.from(new Set(rows.map(r => chaveOv(r[principal.numero])).filter(Boolean)));
  const fontes = [{ entidade: principal.entidade, papel: 'principal', colunaData: principal.criadaEm, linhas: rows.length }];

  // registro por OV: { ent: row }
  const reg = {};
  rows.forEach(r => { const k = chaveOv(r[principal.numero]); if (k) (reg[k] = reg[k] || {})[principal.entidade] = r; });

  // complemento (as outras entidades) e linhas, em paralelo
  const complementos = ents.filter(e => e !== principal);
  const [compl, porLinha] = await Promise.all([
    Promise.all(complementos.map(async E => {
      if (!numeros.length) return { E, rows: [] };
      try { return { E, rows: await porNumeros(E.entidade, E.numero, numeros, token, ate, diag, 'ov:complemento', null, !E.temEmpresa) }; }
      catch (e) { avisos.push('Complemento ' + E.entidade + ': ' + String(e.message || e).slice(0, 160)); return { E, rows: [] }; }
    })),
    numeros.length ? linhas(numeros, token, ate, diag) : Promise.resolve({})
  ]);
  compl.forEach(({ E, rows: rs }) => {
    fontes.push({ entidade: E.entidade, papel: 'complemento', linhas: rs.length });
    rs.forEach(r => { const k = chaveOv(r[E.numero]); if (reg[k]) reg[k][E.entidade] = r; });
  });

  // colunas de status de todas as entidades (valores crus + contagem)
  const statusMap = {};
  Object.keys(reg).forEach(k => {
    Object.keys(reg[k]).forEach(ent => {
      const r = reg[k][ent];
      colunasDe(r).forEach(col => {
        if (!RE_STATUS.test(col) || RE_NAO_STATUS.test(col.replace(/status/ig, ''))) return;
        const v = r[col];
        if (v != null && typeof v === 'object') return;
        const chave = ent + '.' + col;
        const s = statusMap[chave] || (statusMap[chave] = { chave, entidade: ent, coluna: col, valores: {} });
        const val = txt(v) || '(vazio)';
        s.valores[val] = (s.valores[val] || 0) + 1;
      });
    });
  });
  const statusCols = Object.values(statusMap).sort((a, b) => {
    const pa = /^bio/i.test(a.entidade) ? 0 : 1, pb = /^bio/i.test(b.entidade) ? 0 : 1;
    return pa - pb || a.chave.localeCompare(b.chave);
  });
  // padrão: env; senão a 1ª coluna de status da entidade Bio; senão SalesOrderStatus
  const envPadrao = txt(process.env.KANBAN_STATUS_PADRAO);
  const statusPadrao = (envPadrao && statusMap[envPadrao] ? envPadrao : null)
    // da Bio, o status do PEDIDO antes de qualquer outro status (liberação, crédito…)
    || (statusCols.find(s => /^bio/i.test(s.entidade) && /status/i.test(s.coluna) && /pedido|order|ordem|^ov|venda/i.test(s.coluna)) || {}).chave
    || (statusCols.find(s => /^bio/i.test(s.entidade) && /status/i.test(s.coluna)) || {}).chave
    || (statusCols.find(s => /^SalesOrderStatus$/i.test(s.coluna)) || {}).chave
    || (statusCols[0] || {}).chave || null;

  const pega = (k, campo) => {
    for (const ent of Object.keys(reg[k])) { const col = achaCol(colunasDe(reg[k][ent]), COLS[campo]); if (col && txt(reg[k][ent][col]) && !VAZIOS.test(txt(reg[k][ent][col]))) return txt(reg[k][ent][col]); }
    return '';
  };
  // valor cru de um campo da regra: o 1º NOME da lista que existir em qualquer
  // entidade (o nome que o dono deu — SalesStatus — ganha do equivalente)
  const cru = (k, nomes) => {
    for (const nome of nomes) {
      for (const ent of Object.keys(reg[k])) {
        const col = achaCol(colunasDe(reg[k][ent]), [nome]);
        if (col && reg[k][ent][col] != null && txt(reg[k][ent][col]) !== '') return { valor: reg[k][ent][col], coluna: ent + '.' + col };
      }
    }
    return null;
  };
  const achou = { sales: 0, release: 0, credito: 0 };
  const ovs = Object.keys(reg).map(k => {
    const sa = cru(k, COL_SALES), re = cru(k, COL_RELEASE), cr = cru(k, COL_CREDITO);
    if (sa) achou.sales++; if (re) achou.release++; if (cr) achou.credito++;
    const etapa = etapaDe(sa && sa.valor, re && re.valor, cr && cr.valor);
    const status = {};
    statusCols.forEach(s => { const r = reg[k][s.entidade]; status[s.chave] = r ? (txt(r[s.coluna]) || '(vazio)') : null; });
    const campos = {};
    Object.keys(reg[k]).forEach(ent => { campos[ent] = crus(reg[k][ent]); });
    const l = porLinha[k] || null;
    return {
      numero: k,
      cliente: pega(k, 'nome'), conta: pega(k, 'conta'), oc: pega(k, 'oc'),
      criadaEm: txt(reg[k][principal.entidade][principal.criadaEm]),
      entrega: pega(k, 'entrega'), deposito: pega(k, 'deposito'), pool: pega(k, 'pool'), criadoPor: pega(k, 'criadoPor'),
      valor: l ? l.valor : null, itens: l ? l.itens : null,
      etapa,
      // os três campos que decidiram a etapa (valor cru + de onde veio)
      regra: {
        salesStatus: sa ? txt(sa.valor) : null, salesStatusCol: sa ? sa.coluna : null,
        releaseStatus: re ? txt(re.valor) : null, releaseStatusCol: re ? re.coluna : null,
        credito: cr ? txt(cr.valor) : null, creditoCol: cr ? cr.coluna : null
      },
      status, campos
    };
  }).sort((a, b) => b.criadaEm.localeCompare(a.criadaEm) || b.numero.localeCompare(a.numero));

  // as 4 colunas, na ordem do fluxo, com contagem e valor
  const etapas = ETAPAS.map(e => {
    const lista = ovs.filter(o => o.etapa === e.id);
    return { id: e.id, nome: e.nome, qtd: lista.length, valor: Math.round(lista.reduce((s2, o) => s2 + (o.valor || 0), 0) * 100) / 100 };
  });
  const canceladas = ovs.filter(o => o.etapa === 'cancelada').length;
  if (ovs.length) {
    const falta = [];
    if (!achou.sales) falta.push(COL_SALES[0]);
    if (!achou.release) falta.push(COL_RELEASE[0]);
    if (!achou.credito) falta.push(COL_CREDITO[0]);
    if (falta.length) avisos.push('Não achei ' + falta.join(', ') + ' nas entidades lidas (' + fontes.map(f => f.entidade).join(', ') + '): as etapas dependem desses campos. Veja os campos de cada OV no painel.');
    else if (achou.sales < ovs.length) avisos.push((ovs.length - achou.sales) + ' OV(s) sem SalesStatus: ficaram em Criada, Gerenciamento de Crédito ou Liberado pelos outros campos.');
  }
  const r = Object.assign(base, { fontes, etapas, canceladas, statusCols, statusPadrao, ovs, avisos, diagnostico: diag });
  if (!opts.diag) _cache.set(dia, { ts: Date.now(), r });
  return r;
}

function _limparCache() { _cache.clear(); _ents = null; _entsTs = 0; _servico = null; _servicoTs = 0; _entLinhas = null; }

module.exports = { ordensDoDia, hojeSP, EMPRESA, CONFIGURED: D.CONFIGURED, ETAPAS, _limparCache, _interno: { diaDe, RE_STATUS, RE_NAO_STATUS, etapaDe } };
