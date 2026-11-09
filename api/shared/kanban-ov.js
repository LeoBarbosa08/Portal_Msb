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
// SÓ O DEPÓSITO ALMOX-PA (09/11/2026, pedido do dono: "depósito somente o que
// for ALMOX-PA, não precisa do restante"): a OV de outro depósito — ou sem
// depósito — fica fora do quadro. Pelo depósito do CABEÇALHO da OV (COLS.deposito).
// Trocável por env (lista): KANBAN_DEPOSITOS=ALMOX-PA,OUTRO; "*" = todos.
const DEPOSITOS = envLista('KANBAN_DEPOSITOS', ['ALMOX-PA']).map(s => s.toUpperCase());
const TODOS_DEPOSITOS = DEPOSITOS.indexOf('*') >= 0;
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
//   3) ReleaseStatus = Liberado                -> Separação (id liberado)
//   4) senão                                   -> Criada
// Aceita o valor do OData (nome do enum: Backorder, Released, Yes) e o rótulo
// em português da tela do F&O. Colunas trocáveis por env: KANBAN_COL_SALESSTATUS,
// KANBAN_COL_RELEASE, KANBAN_COL_CREDITO.
// 09/11/2026 (dono): SEIS colunas — "Criada, Gerenciamento de Crédito,
// Separação (ReleaseStatus = Released), Conferência, Cotação, Faturado;
// conferência e cotação irei te mandar os campos para definição da fase".
//   • Separação = a antiga "Liberado"/"Logística": o id segue 'liberado' e a
//     regra é a mesma (ReleaseStatus = Liberado);
//   • Conferência e Cotação entram no quadro VAZIAS (pendente: true) até o
//     dono mandar os campos — nenhuma OV cai nelas por enquanto.
const ETAPAS = [
  { id: 'criada',      nome: 'Criada' },
  { id: 'credito',     nome: 'Gerenciamento de Crédito' },
  { id: 'liberado',    nome: 'Separação' },
  // Conferência: trabalho de depósito da OV FECHADO (09/11/26 — ver TRABALHO DE DEPÓSITO)
  { id: 'conferencia', nome: 'Conferência' },
  { id: 'cotacao',     nome: 'Cotação',     pendente: true },
  { id: 'faturado',    nome: 'Faturado' }
];
const COL_SALES   = envLista('KANBAN_COL_SALESSTATUS', ['SalesStatus', 'SalesOrderStatus']);
const COL_RELEASE = envLista('KANBAN_COL_RELEASE', ['ReleaseStatus', 'SalesOrderReleaseStatus']);
const COL_CREDITO = envLista('KANBAN_COL_CREDITO', ['CredManInCreditControl', 'CreditManagementInCreditControl', 'InCreditControl']);
// ── GERENCIAMENTO DE CRÉDITO PELA TABELA DA BIO (09/11/2026) ─────
// Dono: "gerenciamento de crédito vem dessa tabela (Credit management:
// BioCredManTableV1Staging -> BioCredManTableV1Entity), o campo é ACTIVE, a
// ordem é SALESID; cruzar com o nº da OV do BIOSalesOrderHeader e ver se está
// ativo". OV com um registro ATIVO na tabela -> Gerenciamento de Crédito; sem
// registro, ou só com registro inativo -> não está no crédito. A tabela vale
// ANTES do CredManInCreditControl do cabeçalho, que fica só de reserva para
// quando a entidade não responder (com aviso na tela).
// O nome PÚBLICO da entidade no OData não se sabe daqui: as candidatas abaixo
// + o que o service document publicar com "credman" no nome (KANBAN_ENT_CREDITO
// fixa outro). Colunas pelo nome, sem caixa: KANBAN_COL_CREDITO_OV (SALESID) e
// KANBAN_COL_CREDITO_ATIVO (ACTIVE).
const ENT_CREDITO = envLista('KANBAN_ENT_CREDITO', []).concat([
  'BioCredManTableV1', 'BioCredManTablesV1', 'BioCredManTableV1Entity', 'BioCredManTableV1Entities',
  'BIOCredManTableV1', 'BIOCredManTablesV1', 'BioCredManTable', 'BioCredManTables'
]).filter((v, i, a) => a.indexOf(v) === i);
const COL_CRED_OV    = envLista('KANBAN_COL_CREDITO_OV', ['SALESID', 'SalesOrderNumber', 'SalesOrderId']);
const COL_CRED_ATIVO = envLista('KANBAN_COL_CREDITO_ATIVO', ['ACTIVE', 'IsActive']);
// ── TRABALHO DE DEPÓSITO: SEPARAÇÃO -> CONFERÊNCIA (09/11/2026) ──
// Dono: "Separação será o status do ReleaseStatus e a fase é em processo;
// quando sair desse status para fechado ele vai para Conferência". A fase é a
// do TRABALHO de depósito da OV (WHSWorkTableBiEntity — o cabeçalho do
// trabalho: WorkStatus Aberto/Em processo/Fechado/Cancelado), ligado à OV
// pelo nº do pedido de origem (OrderNum). Por OV, sem os cancelados/combinados:
//   • todos os trabalhos FECHADOS            -> Conferência
//   • algum aberto ou em processo            -> Separação (mesmo sem o
//     ReleaseStatus = Liberado: parcialmente liberada, por ex.)
//   • sem trabalho                           -> segue o ReleaseStatus
// Nome público no OData e colunas: descobertos como os da tabela de crédito
// (candidatas + "worktable"/"warehousework" no service document; env
// KANBAN_ENT_TRABALHO, KANBAN_COL_TRABALHO_OV, KANBAN_COL_TRABALHO_STATUS).
const ENT_TRABALHO = envLista('KANBAN_ENT_TRABALHO', []).concat([
  'WHSWorkTableBiEntities', 'WHSWorkTableBiEntity', 'WHSWorkTableBi', 'WHSWorkTableBis',
  'WarehouseWorkHeadersBi', 'WarehouseWorkHeaders', 'WHSWorkTables', 'WarehouseWorkTables'
]).filter((v, i, a) => a.indexOf(v) === i);
const COL_TRAB = {
  numero:   envLista('KANBAN_COL_TRABALHO_OV', ['OrderNum', 'OrderNumber', 'SourceOrderNumber', 'SalesId', 'SalesOrderNumber']),
  status:   envLista('KANBAN_COL_TRABALHO_STATUS', ['WorkStatus', 'Status']),
  id:       ['WorkId'],
  tipo:     ['WorkTransType', 'WorkOrderType', 'TransType'],
  usuario:  ['LockedUser', 'WorkInProcessUserId', 'UserId'],
  inicio:   ['WorkInProcessUTCDateTime', 'WorkInProcessDateTime'],
  fim:      ['WorkClosedUTCDateTime', 'WorkClosedDateTime'],
  criado:   ['WorkCreatedDateTime', 'WorkCreatedUTCDateTime', 'CreatedDateTime'],
  onda:     ['WaveId'],
  carga:    ['LoadId'],
  remessa:  ['ShipmentId'],
  deposito: ['InventLocationId', 'WarehouseId']
};
// fase de UM trabalho, pelo WorkStatus (nome do enum no OData ou rótulo da tela)
function faseTrab(v) {
  const n = normV(v);
  if (/^(closed|fechado|fechada|encerrado|encerrada)$/.test(n)) return 'fechado';
  if (/^(cancelled|canceled|cancelado|cancelada|combined|combinado|combinada)$/.test(n)) return 'ignora';
  if (/^(inprocess|in process|em processo|em processamento|processando)$/.test(n)) return 'processo';
  if (/^(open|aberto|aberta)$/.test(n)) return 'aberto';
  return 'outro';
}
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
// trabalho = fase do trabalho de depósito da OV ('fechado' | 'processo' |
// 'aberto' | null = sem trabalho / sem a entidade)
function etapaDe(sales, release, credito, trabalho) {
  const sit = situacaoOv(sales);
  if (sit === 'cancelada') return 'cancelada';
  if (sit === 'outra') return 'faturado';
  if (marcadoV(credito)) return 'credito';
  if (trabalho === 'fechado') return 'conferencia';
  if (liberadoV(release) || trabalho === 'processo' || trabalho === 'aberto') return 'liberado';
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

// ── entidades EXTRAS da OV (crédito, trabalho de depósito) ────────
// Mesma descoberta para as duas: as candidatas + o que o service document
// publicar com o pedaço do nome (reNome); a que tiver as colunas obrigatórias
// na linha de amostra serve. Cache 30 min (sem ela, refaz em 5 min); o motivo
// de não servir vai para o aviso da tela.
const CFG_CREDITO = {
  chave: 'credito', candidatas: ENT_CREDITO, reNome: /credman/i, pedaco: 'credman',
  cols: { numero: COL_CRED_OV, ativo: COL_CRED_ATIVO }, obrig: ['numero', 'ativo'],
  erroCol: (p) => p === 'numero' ? 'sem a coluna da OV (' + COL_CRED_OV.join('/') + ')' : 'sem a coluna ' + COL_CRED_ATIVO.join('/')
};
const CFG_TRABALHO = {
  chave: 'trabalho', candidatas: ENT_TRABALHO, reNome: /worktable|warehousework/i, pedaco: 'worktable',
  cols: COL_TRAB, obrig: ['numero', 'status'],
  erroCol: (p) => 'sem a coluna ' + COL_TRAB[p].join('/')
};
const _extras = {};
async function sondarExtra(cfg, ent, token, ate) {
  let rows = null, erro = null;
  for (const filtro of ["dataAreaId eq '" + D.odataStr(EMPRESA) + "'", null]) {
    try {
      rows = await D.odataGetComPrazo(ent, Object.assign({ top: 1, crossCompany: true }, filtro ? { filter: filtro } : {}), token, prazo(ate, PROVA_MS));
      if (rows.length) break;
    } catch (e) { erro = String(e.message || e); if (/\b404\b/.test(erro) || e.demorou) break; }
  }
  if (!rows || !rows.length) return { entidade: ent, serve: false, erro: erro ? erro.slice(0, 200) : 'sem linhas' };
  const cols = colunasDe(rows[0]);
  const achado = {};
  Object.keys(cfg.cols).forEach(papel => { achado[papel] = achaCol(cols, cfg.cols[papel]); });
  const falta = cfg.obrig.filter(papel => !achado[papel]);
  return Object.assign({ entidade: ent, serve: !falta.length, temEmpresa: cols.some(c => c.toLowerCase() === 'dataareaid'), colunas: cols,
    erro: falta.length ? cfg.erroCol(falta[0]) : null }, achado);
}
async function entidadeExtra(cfg, token, ate, diag) {
  const c = _extras[cfg.chave];
  if (c && Date.now() - c.ts < (c.E ? ENT_TTL : 5 * 60000)) {
    diag.push({ etapa: cfg.chave + ':entidade', cache: true, entidade: c.E ? c.E.entidade : null });
    return c;
  }
  const servico = await doServico(token, ate);
  const existe = {}; servico.forEach(n => { existe[n.toLowerCase()] = n; });
  let alvos = cfg.candidatas.map(n => existe[n.toLowerCase()] || n);
  if (servico.length) {
    alvos = alvos.filter(n => existe[n.toLowerCase()]);
    servico.filter(n => cfg.reNome.test(n) && alvos.indexOf(n) < 0).slice(0, 6).forEach(n => alvos.push(n));
  }
  diag.push({ etapa: cfg.chave + ':candidatas', servico: servico.length > 0, alvos });
  const sondas = await Promise.all(alvos.map(ent => sondarExtra(cfg, ent, token, ate).catch(e => ({ entidade: ent, serve: false, erro: String(e.message || e).slice(0, 200) }))));
  sondas.forEach(x => {
    const d = { etapa: cfg.chave + ':entidade', entidade: x.entidade, serve: x.serve, empresa: !!x.temEmpresa, erro: x.erro || null };
    cfg.obrig.forEach(papel => { d[papel] = x[papel] || null; });
    diag.push(d);
  });
  const E = sondas.find(x => x.serve) || false;
  const motivo = E ? '' : !alvos.length
    ? 'nenhuma entidade com "' + cfg.pedaco + '" no nome está publicada no OData'
    : sondas.map(x => x.entidade + ': ' + (x.erro || 'não serve')).join('; ').slice(0, 300);
  _extras[cfg.chave] = { E, ts: Date.now(), motivo };
  return _extras[cfg.chave];
}
// crédito, por OV: quantos registros, se algum está ATIVO e o registro que
// decide (o ativo; sem ativo, o primeiro)
async function creditoDasOvs(numeros, token, ate, diag) {
  const x = await entidadeExtra(CFG_CREDITO, token, ate, diag), E = x.E;
  if (!E) return { E: null, por: {}, erro: x.motivo };
  const rows = await porNumeros(E.entidade, E.numero, numeros, token, ate, diag, 'ov:credito', null, !E.temEmpresa);
  const por = {};
  rows.forEach(r => {
    const k = chaveOv(r[E.numero]); if (!k) return;
    const o = por[k] || (por[k] = { n: 0, ativo: false, row: null });
    o.n++;
    if (marcadoV(r[E.ativo]) && !o.ativo) { o.ativo = true; o.row = r; }
    else if (!o.row) o.row = r;
  });
  return { E, por };
}

// trabalho de depósito, por OV: os trabalhos (sem os cancelados/combinados),
// quantos em cada fase e a fase da OV
const dataHora = (v) => { const t = txt(v); return /^\d{4}-\d{2}-\d{2}/.test(t) && !/^1900-01-01/.test(t) ? t : null; };
async function trabalhosDasOvs(numeros, token, ate, diag) {
  const x = await entidadeExtra(CFG_TRABALHO, token, ate, diag), E = x.E;
  if (!E) return { E: null, por: {}, erro: x.motivo };
  const rows = await porNumeros(E.entidade, E.numero, numeros, token, ate, diag, 'ov:trabalho', null, !E.temEmpresa);
  const por = {};
  const v = (r, papel) => { const col = E[papel] || achaCol(colunasDe(r), COL_TRAB[papel]); return col ? r[col] : null; };
  rows.forEach(r => {
    const k = chaveOv(r[E.numero]); if (!k) return;
    const o = por[k] || (por[k] = { fechados: 0, processo: 0, abertos: 0, outros: 0, ignorados: 0, lista: [], row: null });
    const st = txt(r[E.status]), fase = faseTrab(st);
    if (fase === 'ignora') o.ignorados++;
    else if (fase === 'fechado') o.fechados++;
    else if (fase === 'processo') o.processo++;
    else if (fase === 'aberto') o.abertos++;
    else o.outros++;
    o.lista.push({
      id: txt(v(r, 'id')), status: st, fase, tipo: txt(v(r, 'tipo')), usuario: txt(v(r, 'usuario')),
      criado: dataHora(v(r, 'criado')), inicio: dataHora(v(r, 'inicio')), fim: dataHora(v(r, 'fim')),
      onda: txt(v(r, 'onda')), carga: txt(v(r, 'carga')), remessa: txt(v(r, 'remessa')), deposito: txt(v(r, 'deposito'))
    });
    // o registro que vai para os campos crus: o em processo; senão o 1º válido
    if (fase === 'processo' || (!o.row && fase !== 'ignora')) o.row = r;
  });
  Object.keys(por).forEach(k => {
    const o = por[k], validos = o.fechados + o.processo + o.abertos + o.outros;
    o.total = validos;
    o.fase = !validos ? null : o.fechados === validos ? 'fechado' : (o.processo || o.outros || o.fechados) ? 'processo' : 'aberto';
    o.lista.sort((a, b) => String(a.criado || a.id).localeCompare(String(b.criado || b.id)));
  });
  return { E, por };
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
  const [compl, porLinha, CRED, TRAB] = await Promise.all([
    Promise.all(complementos.map(async E => {
      if (!numeros.length) return { E, rows: [] };
      try { return { E, rows: await porNumeros(E.entidade, E.numero, numeros, token, ate, diag, 'ov:complemento', null, !E.temEmpresa) }; }
      catch (e) { avisos.push('Complemento ' + E.entidade + ': ' + String(e.message || e).slice(0, 160)); return { E, rows: [] }; }
    })),
    numeros.length ? linhas(numeros, token, ate, diag) : Promise.resolve({}),
    // gerenciamento de crédito: a tabela da Bio (BioCredManTableV1), pelo SALESID
    numeros.length
      ? creditoDasOvs(numeros, token, ate, diag).catch(e => ({ E: null, por: {}, erro: String(e.message || e).slice(0, 160) }))
      : Promise.resolve({ E: null, por: {} }),
    // trabalho de depósito (WHSWorkTableBiEntity), pelo nº da OV: Separação/Conferência
    numeros.length
      ? trabalhosDasOvs(numeros, token, ate, diag).catch(e => ({ E: null, por: {}, erro: String(e.message || e).slice(0, 160) }))
      : Promise.resolve({ E: null, por: {} })
  ]);
  if (TRAB.E) fontes.push({ entidade: TRAB.E.entidade, papel: 'trabalho', colunas: TRAB.E.numero + ' + ' + TRAB.E.status, trabalhos: Object.keys(TRAB.por).reduce((s2, k) => s2 + TRAB.por[k].lista.length, 0) });
  if (CRED.E) fontes.push({ entidade: CRED.E.entidade, papel: 'crédito', colunas: CRED.E.numero + ' + ' + CRED.E.ativo, registros: Object.keys(CRED.por).reduce((s2, k) => s2 + CRED.por[k].n, 0) });
  compl.forEach(({ E, rows: rs }) => {
    fontes.push({ entidade: E.entidade, papel: 'complemento', linhas: rs.length });
    rs.forEach(r => { const k = chaveOv(r[E.numero]); if (reg[k]) reg[k][E.entidade] = r; });
  });

  const pega = (k, campo) => {
    for (const ent of Object.keys(reg[k])) { const col = achaCol(colunasDe(reg[k][ent]), COLS[campo]); if (col && txt(reg[k][ent][col]) && !VAZIOS.test(txt(reg[k][ent][col]))) return txt(reg[k][ent][col]); }
    return '';
  };

  // só as OVs do depósito do quadro (DEPOSITOS): as outras saem ANTES de
  // contar status, etapas e valores — contadas à parte em foraDeposito
  let foraDeposito = 0, semDeposito = 0;
  if (!TODOS_DEPOSITOS) {
    Object.keys(reg).forEach(k => {
      const dep = pega(k, 'deposito').toUpperCase();
      if (!dep) semDeposito++;
      if (DEPOSITOS.indexOf(dep) < 0) { delete reg[k]; foraDeposito++; }
    });
    if (numeros.length && semDeposito === numeros.length) {
      avisos.push('Nenhuma OV do dia trouxe o depósito (' + COLS.deposito.join(', ') + '): o quadro mostra só ' + DEPOSITOS.join(', ') + ' e ficou vazio.');
    }
  }

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
    const sa = cru(k, COL_SALES), re = cru(k, COL_RELEASE);
    // crédito: a tabela da Bio decide (registro ATIVO pelo SALESID); sem a
    // tabela no OData, o CredManInCreditControl do cabeçalho
    let cr = null, crAtivo = null, crFonte = null, crN = null;
    const cd = CRED.E ? (CRED.por[k] || null) : null;
    if (CRED.E) {
      crFonte = 'tabela'; crN = cd ? cd.n : 0; crAtivo = !!(cd && cd.ativo);
      cr = { valor: cd && cd.row ? cd.row[CRED.E.ativo] : null, coluna: CRED.E.entidade + '.' + CRED.E.ativo };
    } else {
      cr = cru(k, COL_CREDITO);
      if (cr) { crFonte = 'cabecalho'; crAtivo = marcadoV(cr.valor); }
    }
    if (sa) achou.sales++; if (re) achou.release++; if (crFonte) achou.credito++;
    const tb = TRAB.E ? (TRAB.por[k] || null) : null;
    const etapa = etapaDe(sa && sa.valor, re && re.valor, crAtivo, tb ? tb.fase : null);
    const status = {};
    statusCols.forEach(s => { const r = reg[k][s.entidade]; status[s.chave] = r ? (txt(r[s.coluna]) || '(vazio)') : null; });
    const campos = {};
    Object.keys(reg[k]).forEach(ent => { campos[ent] = crus(reg[k][ent]); });
    if (cd && cd.row) campos[CRED.E.entidade] = crus(cd.row);
    if (tb && tb.row) campos[TRAB.E.entidade] = crus(tb.row);
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
        credito: cr && cr.valor != null ? txt(cr.valor) : null, creditoCol: cr ? cr.coluna : null,
        // de onde veio o crédito ('tabela' = BioCredManTableV1; 'cabecalho' =
        // CredManInCreditControl), se está ativo e quantos registros a OV tem
        creditoFonte: crFonte, creditoAtivo: crFonte ? crAtivo : null, creditoRegistros: crN,
        creditoOv: CRED.E ? CRED.E.numero : null,
        // trabalho de depósito: a fase da OV e a contagem (null = entidade fora do OData)
        trabalho: TRAB.E ? { fase: tb ? tb.fase : null, total: tb ? tb.total : 0, fechados: tb ? tb.fechados : 0, processo: tb ? tb.processo : 0,
          abertos: tb ? tb.abertos : 0, ignorados: tb ? tb.ignorados : 0, coluna: TRAB.E.entidade + '.' + TRAB.E.status, colOv: TRAB.E.numero } : null
      },
      trabalhos: tb ? tb.lista : [],
      status, campos
    };
  }).sort((a, b) => b.criadaEm.localeCompare(a.criadaEm) || b.numero.localeCompare(a.numero));

  // as 4 colunas, na ordem do fluxo, com contagem e valor
  const etapas = ETAPAS.map(e => {
    const lista = ovs.filter(o => o.etapa === e.id);
    return { id: e.id, nome: e.nome, pendente: !!e.pendente, qtd: lista.length, valor: Math.round(lista.reduce((s2, o) => s2 + (o.valor || 0), 0) * 100) / 100 };
  });
  const canceladas = ovs.filter(o => o.etapa === 'cancelada').length;
  if (ovs.length) {
    const falta = [];
    if (!achou.sales) falta.push(COL_SALES[0]);
    if (!achou.release) falta.push(COL_RELEASE[0]);
    // o crédito que faltar já sai no aviso da tabela de crédito, logo abaixo
    if (!TRAB.E) {
      avisos.push('A entidade de trabalho de depósito (WHSWorkTableBiEntity) não respondeu no OData' + (TRAB.erro ? ' (' + TRAB.erro + ')' : '') +
        '. Sem ela, a Conferência fica vazia e a Separação segue só o ReleaseStatus. Se a entidade não for pública no OData, é preciso publicá-la (ou fixar o nome em KANBAN_ENT_TRABALHO).');
    }
    if (!CRED.E) {
      avisos.push('A tabela de gerenciamento de crédito (Credit management · BioCredManTableV1Entity) não respondeu no OData' +
        (CRED.erro ? ' (' + CRED.erro + ')' : '') +
        '. Sem ela, o crédito sai do ' + COL_CREDITO[0] + ' do cabeçalho' + (achou.credito ? '' : ', que também não veio') +
        '. Se a entidade não for pública no OData, é preciso publicá-la (ou fixar o nome em KANBAN_ENT_CREDITO).');
    }
    if (falta.length) avisos.push('Não achei ' + falta.join(', ') + ' nas entidades lidas (' + fontes.map(f => f.entidade).join(', ') + '): as etapas dependem desses campos. Veja os campos de cada OV no painel.');
    else if (achou.sales < ovs.length) avisos.push((ovs.length - achou.sales) + ' OV(s) sem SalesStatus: ficaram em Criada, Gerenciamento de Crédito ou Separação pelos outros campos.');
  }
  const r = Object.assign(base, { fontes, etapas, canceladas, depositos: TODOS_DEPOSITOS ? null : DEPOSITOS, foraDeposito, statusCols, statusPadrao, ovs, avisos, diagnostico: diag });
  if (!opts.diag) _cache.set(dia, { ts: Date.now(), r });
  return r;
}

// ── AS LINHAS DE UMA OV (o painel da OV, 09/11/2026) ─────────────
// "No kanban, melhore o modal à direita, se baseie muito no Sales Report,
// pedido em andamento": a ficha lista as linhas da OV (produto, quantidade ×
// preço, status e entrega de cada linha). Lidas SÓ quando a ficha abre —
// o quadro, que relê a cada 30 s, continua pedindo só o valor das linhas.
// Sem $select (uma OV tem poucas linhas e cada campo é lido por vários
// nomes: o que a entidade não tiver fica vazio). Cache por OV: 15 s.
const COLS_LINHA = {
  linha:      ['LineNumber', 'LineCreationSequenceNumber'],
  item:       ['ItemNumber', 'ItemId'],
  produto:    ['LineDescription', 'ProductName', 'ItemName', 'Name'],
  qtd:        ['OrderedSalesQuantity', 'SalesQuantity', 'Quantity'],
  un:         ['SalesUnitSymbol', 'SalesUnit'],
  preco:      ['SalesPrice', 'UnitPrice'],
  desconto:   ['LineDiscountAmount'],
  descPct:    ['LineDiscountPercentage'],
  valor:      ['LineAmount', 'NetAmount'],
  status:     ['SalesOrderLineStatus', 'LineStatus', 'SalesStatus'],
  entrega:    ['RequestedShippingDate', 'RequestedReceiptDate'],
  confirmada: ['ConfirmedShippingDate', 'ConfirmedReceiptDate'],
  deposito:   ['ShippingWarehouseId', 'InventLocationId']
};
// data "vazia" do F&O (1900-01-01, em qualquer hora) = sem data
const dataLinha = (v) => { const s = txt(v); return /^\d{4}-\d{2}-\d{2}/.test(s) && !/^1900-01-01/.test(s) ? s.slice(0, 10) : null; };
const _cacheLinhas = new Map();
async function linhasDaOv(numero, opts) {
  opts = opts || {};
  const n = chaveOv(numero);
  const base = { ok: true, configured: true, numero: n, geradoEm: new Date().toISOString() };
  if (!n) return Object.assign(base, { linhas: [], entidade: null });
  const c = _cacheLinhas.get(n);
  if (!opts.atualizar && c && Date.now() - c.ts < TTL_MS) return Object.assign({}, c.r, { cache: true });
  const ate = Date.now() + Math.min(ORCAMENTO, 25000);
  const token = await D.getToken();
  const alvos = _entLinhas ? [_entLinhas] : ENT_LINHAS;
  let rows = null, entidade = null, ultimo = null;
  for (const ent of alvos) {
    try {
      rows = await D.odataGetComPrazo(ent, { crossCompany: true, top: 500,
        filter: "dataAreaId eq '" + D.odataStr(EMPRESA) + "' and SalesOrderNumber eq '" + D.odataStr(n) + "'" }, token, prazo(ate, 15000));
      entidade = ent; _entLinhas = _entLinhas || ent;
      break;
    } catch (e) {
      ultimo = e;
      if (!/\b(400|404)\b/.test(String(e.message))) break;
    }
  }
  if (!rows) throw ultimo || new Error('nenhuma entidade de linhas de OV respondeu (' + alvos.join(', ') + ')');
  const pk = (r, campo) => D.pick(r, COLS_LINHA[campo]);
  const linhas = rows.map(r => {
    const s = (campo) => { const v = pk(r, campo); return v == null || VAZIOS.test(txt(v)) ? '' : txt(v); };
    return {
      linha: num(pk(r, 'linha')), item: s('item'), produto: s('produto'),
      qtd: num(pk(r, 'qtd')), un: s('un'), preco: num(pk(r, 'preco')),
      desconto: num(pk(r, 'desconto')), descPct: num(pk(r, 'descPct')), valor: num(pk(r, 'valor')),
      status: s('status'), entrega: dataLinha(pk(r, 'entrega')), confirmada: dataLinha(pk(r, 'confirmada')), deposito: s('deposito')
    };
  }).sort((a, b) => (a.linha == null ? 1e9 : a.linha) - (b.linha == null ? 1e9 : b.linha));
  const r = Object.assign(base, { entidade, linhas });
  _cacheLinhas.set(n, { ts: Date.now(), r });
  if (_cacheLinhas.size > 200) _cacheLinhas.delete(_cacheLinhas.keys().next().value);
  return r;
}

// ── TIPO DE OPERAÇÃO DAS OVs (09/11/2026) ─────────────────────────
// Pedido do dono: o Faturamento do Dia mostra o tipo de operação de cada
// nota; o diário de faturas não tem, então ele vem da ORDEM DE VENDA da nota.
// Reaproveita a descoberta das entidades de OV deste motor (BIO + V3/V2…):
// em cada uma, as colunas com cara de tipo de operação (operation, operação,
// CFOP, natureza, SalesPurchOperationType), lidas pelos números das OVs.
// -> { porOv: { OV: { valor, coluna, todos:{ 'Ent.Col': v } } }, colunas:[…], diag:[…] }
const RE_OPER = /operation|opera[cç]|cfop|natur|opertype|salespurchoper/i;
const RE_OPER_NAO = /operationalsite|operatingunit|date|time/i;
// enum que diz "não se aplica" não é tipo de operação (no print do dono, toda
// nota saía "DoesNotApply · pela OV")
const SEM_VALOR_OP = /^(doesnotapply|notapplicable|not applicable|none|no|nao se aplica|não se aplica|n\/a)$/i;
// 09/11/26 (o dono achou o campo na ficha da OV do Kanban): o tipo de operação
// da nota ligada à OV é o FiscalDocumentOperationTypeId (ex.: "S.LIC.002").
// Ele vence qualquer outra coluna com cara de operação. KANBAN_COL_OPERACAO
// troca/acrescenta nomes (lista, em ordem de preferência).
const COL_OPERACAO = envLista('KANBAN_COL_OPERACAO', ['FiscalDocumentOperationTypeId']);
async function operacoesDasOvs(numeros, ate) {
  const diag = [], porOv = {};
  const nums = Array.from(new Set((numeros || []).map(chaveOv).filter(Boolean)));
  if (!nums.length) return { porOv, colunas: [], diag };
  const token = await D.getToken();
  const ents = await entidades(token, ate, diag, false);
  const comOp = ents.map(E => ({ E, cols: (E.colunas || []).filter(c => RE_OPER.test(c) && !RE_OPER_NAO.test(c)) })).filter(x => x.cols.length);
  if (!comOp.length) {
    diag.push({ etapa: 'ov:operacao', erro: 'nenhuma entidade de OV tem coluna de tipo de operação', entidades: ents.map(e => e.entidade) });
    return { porOv, colunas: [], diag };
  }
  await Promise.all(comOp.map(async ({ E, cols }) => {
    try {
      const rows = await porNumeros(E.entidade, E.numero, nums, token, ate, diag, 'ov:operacao', [E.numero].concat(cols).join(','), !E.temEmpresa);
      rows.forEach(r => {
        const k = chaveOv(r[E.numero]); if (!k) return;
        const o = porOv[k] || (porOv[k] = { todos: {} });
        cols.forEach(c => { const v = txt(r[c]); if (v && !VAZIOS.test(v) && !SEM_VALOR_OP.test(v)) o.todos[E.entidade + '.' + c] = v; });
      });
    } catch (e) { /* o erro já está no diag */ }
  }));
  // o que vai para a tela: o FiscalDocumentOperationTypeId (COL_OPERACAO), se
  // alguma entidade trouxer; senão uma coluna de descrição; senão a 1ª preenchida
  const colDe = (chave) => chave.split('.').pop().toLowerCase();
  Object.keys(porOv).forEach(k => {
    const ks = Object.keys(porOv[k].todos);
    let pref = null;
    for (const nome of COL_OPERACAO) { pref = ks.find(x => colDe(x) === nome.toLowerCase()); if (pref) break; }
    pref = pref || ks.find(x => /descr|name|nome|texto|text/i.test(x)) || ks[0] || null;
    porOv[k].coluna = pref; porOv[k].valor = pref ? porOv[k].todos[pref] : '';
  });
  return { porOv, colunas: comOp.map(x => x.E.entidade + ': ' + x.cols.join(', ')), diag };
}


function _limparCache() { _cache.clear(); _cacheLinhas.clear(); _ents = null; _entsTs = 0; _servico = null; _servicoTs = 0; _entLinhas = null; Object.keys(_extras).forEach(k => { delete _extras[k]; }); }

module.exports = { ordensDoDia, linhasDaOv, operacoesDasOvs, hojeSP, EMPRESA, CONFIGURED: D.CONFIGURED, ETAPAS, _limparCache, _interno: { diaDe, RE_STATUS, RE_NAO_STATUS, etapaDe } };
