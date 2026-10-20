// ================================================================
// api/shared/consig-d365.js — o PROCESSO DE CONSIGNAÇÃO no Dynamics 365 F&O
//
// PI · Consignação (INCOMPLETO), refeita em 19/10/2026 com dois caminhos:
//   CRIAR o processo (a partir do PDF do consignado):
//     · já existe ordem de devolução → as DEVOLUÇÕES EM ABERTO do cliente
//       (cabeçalho + linhas) para marcar os itens e lotes do PDF;
//     · não existe → CRIA o cabeçalho e as linhas da ordem de devolução.
//   FATURAR o processo → as ORDENS DE VENDA EM ABERTO do cliente.
//
// Entidades (padrão; as envs CONSIG_ENT_* põem outra NA FRENTE da lista):
//   ReturnOrderHeadersV2 → ReturnOrderHeaders   cabeçalho da devolução
//   ReturnOrderLinesV2   → ReturnOrderLines     linhas (ReturnOrderLineV2Entity)
//   SalesOrderHeadersV2  → SalesOrderHeaders    cabeçalho da OV
//   SalesOrderLines                             linhas da OV
//
// NADA DE NOME DE COLUNA CHUMBADO (o jeito do Lançamentos Administrativos):
// cada informação tem nomes CANDIDATOS e a entidade é sondada com $top=1 —
// filtro, $select e corpo usam o nome que a entidade tem de verdade. A
// resposta leva o `diagnostico` (só NOMES de colunas, nunca valores) para o
// 1º teste real acertar o que faltar.
//
// O OData do F&O só filtra TEXTO com eq: cliente e nº da ordem vão por eq.
// A situação "Em aberto" (Open na devolução, Backorder na OV) é filtrada em
// memória — na OV tenta antes o filtro do enum (SalesStatus'Backorder') e,
// se o F&O recusar, cai na memória.
//
// ESCRITA DESLIGADA POR PADRÃO: sem CONSIG_D365_ESCRITA=true, "criar" só
// SIMULA — devolve as requisições exatas que faria, com as colunas já
// resolvidas pela sondagem, e não grava nada. Ligada: POST do cabeçalho e
// POST de cada linha; linha recusada = apaga o cabeçalho (o F&O leva as
// linhas junto) e a resposta diz se conseguiu desfazer.
// ================================================================
'use strict';

const D = require('./d365');

// ── configuração (envs) ──────────────────────────────────────────
function lista(s) { return String(s || '').split(',').map(x => x.trim()).filter(Boolean); }
function unicos(a) { return a.filter((x, i) => x && a.indexOf(x) === i); }
function txt(v, max) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max || 200); }
// sem acento, minúsculo: "Em aberto" = "em aberto"
function norm(s) { return txt(s, 80).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function objetoJson(s, nome, erros) {
  if (!s) return {};
  try {
    const o = JSON.parse(s);
    if (o && typeof o === 'object' && !Array.isArray(o)) return o;
  } catch (e) { /* cai no erro abaixo */ }
  erros.push(nome + ' não é um objeto JSON válido — ignorado.');
  return {};
}

function config(env) {
  env = env || process.env;
  const erros = [];
  return {
    empresa:        txt(env.CONSIG_EMPRESA || 'bio', 10).toLowerCase(),
    entDevCab:      unicos(lista(env.CONSIG_ENT_DEV_CABECALHO).concat(['ReturnOrderHeadersV2', 'ReturnOrderHeaders'])),
    entDevLin:      unicos(lista(env.CONSIG_ENT_DEV_LINHAS).concat(['ReturnOrderLinesV2', 'ReturnOrderLines'])),
    entOvCab:       unicos(lista(env.CONSIG_ENT_OV_CABECALHO).concat(['SalesOrderHeadersV2', 'SalesOrderHeaders'])),
    entOvLin:       unicos(lista(env.CONSIG_ENT_OV_LINHAS).concat(['SalesOrderLines'])),
    // devolução "Em aberto" = a situação que NÃO está entre as fechadas (o valor do
    // enum, como o OData devolve). Medido em produção 19/10/26: o cabeçalho tem DUAS
    // colunas — ReturnStatus (Status de devolução da tela) e ReturnOrderStatus (a
    // situação de venda: Backorder/Invoiced) — e a lista de abertas "Open" deixava as
    // 261 devoluções do C000732 de fora. CONSIG_DEV_STATUS_ABERTOS (lista) troca a
    // regra por "só estas".
    devAbertas:     env.CONSIG_DEV_STATUS_ABERTOS ? lista(env.CONSIG_DEV_STATUS_ABERTOS).map(norm) : null,
    devFechadas:    lista(env.CONSIG_DEV_STATUS_FECHADOS || 'Closed,Canceled,Cancelled,Invoiced,None,Fechada,Cancelada,Faturada').map(norm),
    ovAbertas:      lista(env.CONSIG_OV_STATUS_ABERTOS || 'Backorder,Em aberto').map(norm),
    // linha de devolução já encerrada (usada só quando o cabeçalho não diz a situação)
    linhaFechada:   lista(env.CONSIG_DEV_LINHA_FECHADA || 'Invoiced,Canceled,Cancelled').map(norm),
    escrita:        String(env.CONSIG_D365_ESCRITA || '').trim().toLowerCase() === 'true',
    // devolução no F&O tem quantidade NEGATIVA (como a tela mostra: -1)
    qtdNegativa:    String(env.CONSIG_DEV_QTD_NEGATIVA || 'true').trim().toLowerCase() !== 'false',
    deposito:       txt(env.CONSIG_DEV_DEPOSITO, 40),     // aceita "{cliente}" — ex.: "{cliente}.CD"
    motivo:         txt(env.CONSIG_DEV_MOTIVO, 20),
    fixosCabecalho: objetoJson(env.CONSIG_DEV_CABECALHO_FIXOS, 'CONSIG_DEV_CABECALHO_FIXOS', erros),
    fixosLinha:     objetoJson(env.CONSIG_DEV_LINHA_FIXOS, 'CONSIG_DEV_LINHA_FIXOS', erros),
    autorizados:    lista(env.CONSIG_AUTORIZADOS).map(e => e.toLowerCase()),
    erros:          erros
  };
}

// ── cada informação, pelos nomes que ela pode ter nas entidades ────
const COL = {
  numero:       ['ReturnOrderNumber', 'SalesOrderNumber', 'SalesId'],
  rma:          ['RMANumber', 'ReturnMerchandiseAuthorizationNumber', 'RmaNumber', 'ReturnItemNum'],
  cliente:      ['CustomerAccountNumber', 'ReturnOrderCustomerAccountNumber', 'OrderingCustomerAccountNumber',
                 'InvoiceCustomerAccountNumber', 'CustomerAccount', 'CustAccount'],
  // no cabeçalho, ReturnStatus = o "Status de devolução" da tela (Created/Open/Closed/
  // Canceled); ReturnOrderStatus é a situação de VENDA da ordem (Backorder/Invoiced)
  situacao:     ['ReturnStatus', 'ReturnStatusHeader', 'ReturnOrderStatus', 'ReturnOrderHeaderStatus'],
  // a situação do CABEÇALHO quando ela vem na linha (sem o 'ReturnStatus', que na linha é a da linha)
  situacaoCab:  ['ReturnStatusHeader', 'ReturnOrderHeaderStatus', 'ReturnOrderStatus'],
  situacaoLin:  ['ReturnLineStatus', 'ReturnStatusLine', 'ReturnOrderLineStatus', 'ReturnStatus', 'SalesOrderLineStatus', 'LineStatus'],
  motivo:       ['ReturnReasonCodeId', 'CustomerReturnReasonCode', 'ReturnReasonCode'],
  prazo:        ['ReturnDeadlineDate', 'ReturnDeadline'],
  criadaEm:     ['ReturnOrderCreationDateTime', 'OrderCreationDateTime', 'CreatedDateTime', 'CreatedOn'],
  nome:         ['CustomerName', 'ReturnOrderName', 'SalesOrderName', 'SalesName', 'DeliveryAddressName'],
  referencia:   ['CustomersOrderReference', 'CustomerReference', 'CustomerRequisitionNumber', 'PurchaseOrderFormNumber'],
  linha:        ['LineCreationSequenceNumber', 'LineNumber', 'LineNum'],
  item:         ['ItemNumber', 'ItemId'],
  descricao:    ['LineDescription', 'ProductName', 'ItemName', 'Name'],
  // ReturnOrderLinesV2 de produção: ReturnSalesQuantity (a devolver) e ReturnedSalesQuantity (já devolvida)
  quantidade:   ['ExpectedReturnQuantity', 'ReturnSalesQuantity', 'ReturnQuantity', 'ExpectedRetQty',
                 'OrderedSalesQuantity', 'SalesQuantity', 'Quantity', 'ReturnedSalesQuantity'],
  lote:         ['ItemBatchNumber', 'InventBatchId', 'BatchNumber', 'BatchId'],
  // o Return lot ID (InventTransIdReturn: o lote da remessa que volta); ReturnInventoryLotId
  // fica por último — pelo nome pode ser o lote da própria linha de devolução
  lotId:        ['ReturnLotId', 'ReturningInventoryLotId', 'InventTransIdReturn', 'ReturnInventTransId', 'ReturnInventoryLotId'],
  deposito:     ['ShippingWarehouseId', 'ReturnWarehouseId', 'InventLocationId', 'WarehouseId'],
  preco:        ['SalesPrice', 'UnitPrice'],
  valor:        ['LineAmount', 'NetAmount']
};
const COL_OV = {
  numero:      ['SalesOrderNumber', 'SalesId'],
  cliente:     ['OrderingCustomerAccountNumber', 'InvoiceCustomerAccountNumber', 'CustomerAccountNumber', 'CustAccount'],
  situacao:    ['SalesOrderStatus', 'SalesStatus'],
  nome:        ['SalesOrderName', 'SalesName', 'DeliveryAddressName'],
  oc:          ['CustomersOrderReference', 'CustomerRequisitionNumber', 'PurchaseOrderFormNumber', 'CustomerRef'],
  criadaEm:    ['OrderCreationDateTime', 'CreatedDateTime', 'SalesOrderCreationDateTime'],
  entrega:     ['RequestedShippingDate', 'RequestedReceiptDate'],
  deposito:    ['DefaultShippingWarehouseId', 'InventLocationId', 'ShippingWarehouseId'],
  pool:        ['SalesOrderPoolId', 'SalesPoolId'],
  // linhas
  linha:       ['LineCreationSequenceNumber', 'LineNumber', 'LineNum'],
  item:        ['ItemNumber', 'ItemId'],
  descricao:   ['LineDescription', 'ProductName', 'ItemName', 'Name'],
  quantidade:  ['OrderedSalesQuantity', 'SalesQuantity', 'Quantity'],
  lote:        ['ItemBatchNumber', 'InventBatchId', 'BatchNumber'],
  situacaoLin: ['SalesOrderLineStatus', 'LineStatus', 'SalesStatus'],
  preco:       ['SalesPrice', 'UnitPrice'],
  valor:       ['LineAmount', 'NetAmount']
};

// o enum como a tela do F&O (pt-BR) mostra
const ROTULO = {
  open: 'Em aberto', closed: 'Fechada', created: 'Criada', canceled: 'Cancelada', cancelled: 'Cancelada',
  awaiting: 'Aguardando', registered: 'Registrada', quarantine: 'Quarentena', received: 'Recebida',
  invoiced: 'Faturada', backorder: 'Em aberto', delivered: 'Entregue', none: ''
};
function rotulo(v) { const s = txt(v, 40); const r = ROTULO[s.toLowerCase()]; return r != null ? r : s; }
// devolução em aberto? (regra "não está fechada", ou a lista de abertas da env)
function devAberta(v, cfg) {
  const s = norm(v);
  if (!s) return false;
  return cfg.devAbertas ? cfg.devAbertas.indexOf(s) >= 0 : cfg.devFechadas.indexOf(s) < 0;
}
// quantas devoluções em cada situação — vai para a tela (e mostra na hora quando a
// regra de "em aberto" não bate com o que o Dynamics grava)
function contarSituacoes(valores) {
  const m = new Map();
  valores.forEach(v => { const k = txt(v, 40) || '(vazio)'; m.set(k, (m.get(k) || 0) + 1); });
  return Array.from(m.entries()).map(e => ({ valor: e[0], rotulo: e[0] === '(vazio)' ? '(vazio)' : rotulo(e[0]), n: e[1] }))
    .sort((a, b) => b.n - a.n);
}

// ── nomes, números, datas ─────────────────────────────────────────
// conta do cliente como o F&O grava: "c004512" -> "C004512"
function contaCliente(v) {
  const s = txt(v, 30).toUpperCase().replace(/\s+/g, '');
  return /^[A-Z0-9][A-Z0-9._\-]{1,29}$/.test(s) ? s : '';
}
function numeroOrdem(v) {
  const s = txt(v, 40).toUpperCase().replace(/\s+/g, '');
  return /^[A-Z0-9][A-Z0-9._\-\/]{2,39}$/.test(s) ? s : '';
}
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
// '1900-01-01T00:00:00Z' é o "vazio" do F&O
function data(v) { const s = txt(v, 30); return /^1900-01-01/.test(s) ? '' : s; }

// ── colunas (sondagem com $top=1, cache de 30 min por entidade) ───
const TTL_COLUNAS = 30 * 60e3;
const _colunas = new Map();
function colunasDe(row) { return Object.keys(row || {}).filter(k => k.charAt(0) !== '@'); }

async function sondarColunas(entidade, token) {
  const c = _colunas.get(entidade);
  if (c && Date.now() - c.ts < TTL_COLUNAS) return c.colunas;
  const rows = await D.odataGetComPrazo(entidade, { top: 1, crossCompany: true }, token, 15000);
  const colunas = rows.length ? colunasDe(rows[0]) : null;   // vazia: não dá para saber
  _colunas.set(entidade, { ts: Date.now(), colunas: colunas });
  return colunas;
}

// a 1ª entidade da lista que responde; as que caem vão para `motivos`
async function resolver(cands, token, motivos) {
  for (const ent of cands) {
    try {
      return { entidade: ent, colunas: await sondarColunas(ent, token) };
    } catch (e) {
      motivos.push(ent + ': ' + motivoFO(e));
      if (e.demorou) break;   // F&O lento: a próxima também vai demorar
    }
  }
  return null;
}

// colunas = lista real (sondagem) ou null (entidade vazia: vale o 1º candidato)
function escolher(cands, colunas) {
  if (!colunas) return cands[0];
  for (const c of cands) {
    const t = c.toLowerCase();
    for (const k of colunas) if (k.toLowerCase() === t) return k;
  }
  return null;
}
// { papel: coluna|null } para um mapa de candidatos
function resolverColunas(mapa, colunas, papeis) {
  const out = {};
  (papeis || Object.keys(mapa)).forEach(p => { out[p] = escolher(mapa[p], colunas); });
  return out;
}
function selectDe(cols, colunas) {
  if (!colunas) return undefined;   // não sondou: a linha vem inteira
  return unicos(['dataAreaId'].concat(Object.keys(cols).map(k => cols[k]))).filter(c => colunas.indexOf(c) >= 0).join(',');
}
function ler(row, col) { return col && row ? row[col] : null; }

// O motivo legível de um erro do F&O: o error.innererror.message (sem o
// stacktrace) quando a resposta é o JSON de erro do OData; senão a mensagem.
function motivoFO(e) {
  if (!e) return 'erro desconhecido';
  if (e.corpo) {
    try {
      const j = JSON.parse(e.corpo);
      const er = (j && j.error) || {};
      const inner = er.innererror && er.innererror.message;
      const msg = inner || er.message;
      if (msg) return txt(msg, 600) + (e.statusD365 ? ' [' + e.statusD365 + ']' : '');
    } catch (x) { /* não era JSON */ }
  }
  return txt(String(e.message || e).replace(/^F&O (\d{3}): /, '[$1] '), 600);
}
function erroPublico(msg, status, extra) {
  const e = new Error(msg);
  e.publico = true;
  e.statusHttp = status || 502;
  e.extra = extra || null;
  return e;
}
function filtroBase(cfg, col, valor) {
  return "dataAreaId eq '" + D.odataStr(cfg.empresa) + "' and " + col + " eq '" + D.odataStr(valor) + "'";
}
async function buscar(entidade, filtro, select, top, token, ms) {
  return D.odataGetComPrazo(entidade, { filter: filtro, select: select, top: top, crossCompany: true }, token, ms || 25000);
}
// roda fn em cada item, no máximo `n` ao mesmo tempo
async function emLotes(itens, n, fn) {
  const out = new Array(itens.length);
  let i = 0;
  async function trabalhador() { while (i < itens.length) { const k = i++; out[k] = await fn(itens[k], k); } }
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, trabalhador));
  return out;
}

// ════════════════════════════════════════════════════════════════
// DEVOLUÇÕES EM ABERTO do cliente
// ════════════════════════════════════════════════════════════════
const TOP_CAB = 5000;          // cabeçalhos do cliente numa página (o F&O vai até 10.000)
const MAX_ABERTAS = 40;        // devoluções abertas que têm as linhas lidas

function linhaDev(r, l) {
  const q = num(ler(r, l.quantidade));
  return {
    linha: ler(r, l.linha) == null ? '' : String(ler(r, l.linha)),
    codigo: txt(ler(r, l.item), 40), descricao: txt(ler(r, l.descricao), 160),
    lote: txt(ler(r, l.lote), 40), quantidade: Math.abs(q), quantidadeD365: q,
    lotId: txt(ler(r, l.lotId), 40), deposito: txt(ler(r, l.deposito), 30),
    situacaoCod: txt(ler(r, l.situacaoLin), 30), situacao: rotulo(ler(r, l.situacaoLin)),
    preco: r2(ler(r, l.preco)), valor: r2(Math.abs(num(ler(r, l.valor))))
  };
}

async function devolucoesAbertas(cliente, cfg, token) {
  const conta = contaCliente(cliente);
  if (!conta) throw erroPublico('Informe o código do cliente no Dynamics (ex.: C004512).', 400);
  const motivos = [], avisos = [];
  const cab = await resolver(cfg.entDevCab, token, motivos);
  const lin = await resolver(cfg.entDevLin, token, motivos);
  if (!cab && !lin) throw erroPublico('Não consegui ler as ordens de devolução no Dynamics — ' + motivos.join(' · '));
  if (!cab) avisos.push('Cabeçalho da devolução indisponível (' + motivos.join(' · ') + ') — busquei direto nas linhas.');

  const c = cab ? resolverColunas(COL, cab.colunas, ['numero', 'rma', 'cliente', 'situacao', 'motivo', 'prazo', 'criadaEm', 'nome', 'referencia']) : null;
  // 2ª coluna de situação (a entidade de produção tem ReturnStatus E ReturnOrderStatus):
  // vale quando a 1ª vier sem informação nenhuma (toda vazia ou "None")
  if (c && c.situacao && cab.colunas) {
    c.situacao2 = COL.situacao.map(n => escolher([n], cab.colunas)).filter(x => x && x !== c.situacao)[0] || null;
  }
  const l = lin ? resolverColunas(COL, lin.colunas, ['numero', 'cliente', 'situacaoCab', 'situacaoLin', 'linha', 'item', 'descricao', 'quantidade', 'lote', 'lotId', 'deposito', 'preco', 'valor']) : null;
  const diagnostico = {
    cabecalho: cab ? { entidade: cab.entidade, colunas: cab.colunas, usadas: c } : null,
    linhas: lin ? { entidade: lin.entidade, colunas: lin.colunas, usadas: l } : null
  };
  if (cab && !cab.colunas) avisos.push(cab.entidade + ' está vazia no Dynamics: usei os nomes padrão das colunas.');
  if (lin && !lin.colunas) avisos.push(lin.entidade + ' está vazia no Dynamics: usei os nomes padrão das colunas.');
  if (l && !l.lote) avisos.push((lin.entidade) + ' não tem coluna de LOTE: o casamento com o PDF fica só pelo código do item.');

  let ordens = null, totalDoCliente = 0, situacoes = [];

  // 1) pelos cabeçalhos: o cliente filtra no F&O, a situação em memória
  if (cab && c.cliente && c.numero) {
    const rows = await buscar(cab.entidade, filtroBase(cfg, c.cliente, conta), selectDe(c, cab.colunas), TOP_CAB, token);
    totalDoCliente = rows.length;
    const informativa = col => rows.some(r => { const s = norm(ler(r, col)); return s && s !== 'none'; });
    if (c.situacao && c.situacao2 && rows.length && !informativa(c.situacao) && informativa(c.situacao2)) {
      avisos.push(cab.entidade + '.' + c.situacao + ' veio sem situação nenhuma — usei ' + c.situacao2 + '.');
      c.situacao = c.situacao2;
    }
    if (c.situacao) situacoes = contarSituacoes(rows.map(r => ler(r, c.situacao)));
    if (rows.length >= TOP_CAB) avisos.push('O cliente tem ' + TOP_CAB + '+ devoluções: li só as ' + TOP_CAB + ' primeiras.');
    ordens = rows.map(r => ({
      numero: txt(ler(r, c.numero), 40), rma: txt(ler(r, c.rma), 40),
      situacaoCod: txt(ler(r, c.situacao), 30), situacao: rotulo(ler(r, c.situacao)),
      aberta: c.situacao ? devAberta(ler(r, c.situacao), cfg) : null,
      criadaEm: data(ler(r, c.criadaEm)), prazo: data(ler(r, c.prazo)),
      motivo: txt(ler(r, c.motivo), 30), referencia: txt(ler(r, c.referencia), 60), nome: txt(ler(r, c.nome), 160),
      linhas: []
    })).filter(o => o.numero);
    if (!c.situacao) avisos.push(cab.entidade + ' não tem coluna de situação: "em aberto" decidido pelas linhas.');
  } else if (cab) {
    avisos.push(cab.entidade + ' não tem coluna de ' + (!c.cliente ? 'cliente' : 'nº da ordem') + ' — busquei direto nas linhas.');
  }

  if (!lin) {
    // só o cabeçalho: lista as abertas sem as linhas
    if (!ordens) throw erroPublico('Não consegui ler as ordens de devolução no Dynamics — ' + motivos.join(' · '));
    avisos.push('Linhas da devolução indisponíveis (' + motivos.join(' · ') + ').');
    return { cliente: conta, devolucoes: ordens.filter(o => o.aberta !== false), totalDoCliente, situacoes, avisos, diagnostico };
  }
  if (!l.numero) throw erroPublico(lin.entidade + ' não tem coluna de nº da ordem (procurei ' + COL.numero.join(', ') + ').', 502, { diagnostico });
  const selLin = selectDe(l, lin.colunas);

  if (ordens) {
    // 2a) as linhas de cada devolução que não está fechada
    let alvo = ordens.filter(o => o.aberta !== false);
    alvo.sort((a, b) => b.numero.localeCompare(a.numero));
    if (alvo.length > MAX_ABERTAS) {
      avisos.push(alvo.length + ' devoluções em aberto: mostrei as ' + MAX_ABERTAS + ' mais recentes.');
      alvo = alvo.slice(0, MAX_ABERTAS);
    }
    await emLotes(alvo, 5, async o => {
      const rows = await buscar(lin.entidade, filtroBase(cfg, l.numero, o.numero), selLin, 500, token, 15000);
      o.linhas = rows.map(r => linhaDev(r, l));
      o._cab = rows.length && l.situacaoCab ? ler(rows[0], l.situacaoCab) : null;
    });
    ordens = alvo;
  } else {
    // 2b) sem cabeçalho utilizável: as linhas do cliente, agrupadas pela ordem
    if (!l.cliente) throw erroPublico('Nem o cabeçalho nem as linhas da devolução têm coluna de cliente no Dynamics.', 502, { diagnostico });
    const rows = await buscar(lin.entidade, filtroBase(cfg, l.cliente, conta), selLin, TOP_CAB, token);
    const por = new Map();
    rows.forEach(r => {
      const n = txt(ler(r, l.numero), 40);
      if (!n) return;
      if (!por.has(n)) por.set(n, { numero: n, rma: '', situacaoCod: '', situacao: '', aberta: null, criadaEm: '', prazo: '', motivo: '', referencia: '', nome: '', linhas: [], _cab: l.situacaoCab ? ler(r, l.situacaoCab) : null });
      por.get(n).linhas.push(linhaDev(r, l));
    });
    ordens = Array.from(por.values());
    totalDoCliente = ordens.length;
  }

  // situação que faltou no cabeçalho: a do cabeçalho vinda na linha, senão as linhas
  ordens.forEach(o => {
    if (o.aberta !== null) return;
    if (o._cab != null && txt(o._cab)) {
      o.situacaoCod = txt(o._cab, 30); o.situacao = rotulo(o._cab);
      o.aberta = devAberta(o._cab, cfg);
    } else {
      o.aberta = o.linhas.some(x => x.situacaoCod && cfg.linhaFechada.indexOf(norm(x.situacaoCod)) < 0);
      o.situacao = o.aberta ? 'Em aberto' : 'Fechada';
    }
  });
  if (!situacoes.length) situacoes = contarSituacoes(ordens.map(o => o.situacaoCod || o.situacao));
  const devolucoes = ordens.filter(o => o.aberta).map(o => { delete o._cab; return o; });
  devolucoes.sort((a, b) => b.numero.localeCompare(a.numero));
  return { cliente: conta, devolucoes, totalDoCliente, situacoes, avisos, diagnostico };
}

// ════════════════════════════════════════════════════════════════
// ORDENS DE VENDA EM ABERTO do cliente
// ════════════════════════════════════════════════════════════════
async function ovsAbertas(cliente, cfg, token) {
  const conta = contaCliente(cliente);
  if (!conta) throw erroPublico('Informe o código do cliente no Dynamics (ex.: C004512).', 400);
  const motivos = [], avisos = [];
  const cab = await resolver(cfg.entOvCab, token, motivos);
  if (!cab) throw erroPublico('Não consegui ler as ordens de venda no Dynamics — ' + motivos.join(' · '));
  const c = resolverColunas(COL_OV, cab.colunas, ['numero', 'cliente', 'situacao', 'nome', 'oc', 'criadaEm', 'entrega', 'deposito', 'pool']);
  const diagnostico = { cabecalho: { entidade: cab.entidade, colunas: cab.colunas, usadas: c } };
  if (!c.cliente || !c.numero) throw erroPublico(cab.entidade + ' não tem coluna de ' + (!c.cliente ? 'cliente' : 'nº da OV') + '.', 502, { diagnostico });
  const base = filtroBase(cfg, c.cliente, conta), sel = selectDe(c, cab.colunas);

  // só "Backorder" = dá para pedir ao F&O pelo enum; o resto filtra em memória
  let rows = null, filtrouNoFO = false;
  if (c.situacao && cfg.ovAbertas.indexOf('backorder') >= 0 && cfg.ovAbertas.every(s => s === 'backorder' || s === 'em aberto')) {
    try {
      rows = await buscar(cab.entidade, base + ' and ' + c.situacao + " eq Microsoft.Dynamics.DataEntities.SalesStatus'Backorder'", sel, TOP_CAB, token);
      filtrouNoFO = true;
    } catch (e) {
      if (!/^F&O 400/.test(e.message || '')) throw e;
      avisos.push('O Dynamics recusou o filtro da situação — filtrei em memória.');
    }
  }
  if (!rows) rows = await buscar(cab.entidade, base, sel, TOP_CAB, token);
  if (rows.length >= TOP_CAB) avisos.push('Mais de ' + TOP_CAB + ' ordens: li só as ' + TOP_CAB + ' primeiras.');
  if (!c.situacao) avisos.push(cab.entidade + ' não tem coluna de situação: listei todas as ordens do cliente.');

  const ovs = rows.map(r => ({
    numero: txt(ler(r, c.numero), 40), nome: txt(ler(r, c.nome), 160), oc: txt(ler(r, c.oc), 60),
    situacaoCod: txt(ler(r, c.situacao), 30), situacao: rotulo(ler(r, c.situacao)),
    criadaEm: data(ler(r, c.criadaEm)), entrega: data(ler(r, c.entrega)),
    deposito: txt(ler(r, c.deposito), 30), pool: txt(ler(r, c.pool), 30)
  })).filter(o => o.numero && (!c.situacao || filtrouNoFO || cfg.ovAbertas.indexOf(norm(o.situacaoCod)) >= 0));
  ovs.sort((a, b) => b.numero.localeCompare(a.numero));
  return { cliente: conta, ovs, avisos, diagnostico };
}

async function linhasOv(numero, cfg, token) {
  const n = numeroOrdem(numero);
  if (!n) throw erroPublico('Número de ordem de venda inválido.', 400);
  const motivos = [];
  const lin = await resolver(cfg.entOvLin, token, motivos);
  if (!lin) throw erroPublico('Não consegui ler as linhas da ordem de venda — ' + motivos.join(' · '));
  const l = resolverColunas(COL_OV, lin.colunas, ['numero', 'linha', 'item', 'descricao', 'quantidade', 'lote', 'situacaoLin', 'preco', 'valor', 'deposito']);
  if (!l.numero) throw erroPublico(lin.entidade + ' não tem coluna de nº da OV.', 502);
  const rows = await buscar(lin.entidade, filtroBase(cfg, l.numero, n), selectDe(l, lin.colunas), 500, token, 15000);
  const linhas = rows.map(r => ({
    linha: ler(r, l.linha) == null ? '' : String(ler(r, l.linha)),
    codigo: txt(ler(r, l.item), 40), descricao: txt(ler(r, l.descricao), 160),
    quantidade: num(ler(r, l.quantidade)), lote: txt(ler(r, l.lote), 40),
    situacao: rotulo(ler(r, l.situacaoLin)), preco: r2(ler(r, l.preco)), valor: r2(ler(r, l.valor)),
    deposito: txt(ler(r, l.deposito), 30)
  }));
  return { numero: n, linhas, total: r2(linhas.reduce((s, x) => s + x.valor, 0)), diagnostico: { entidade: lin.entidade, colunas: lin.colunas, usadas: l } };
}

// ════════════════════════════════════════════════════════════════
// CRIAR A ORDEM DE DEVOLUÇÃO (cabeçalho + linhas)
// ════════════════════════════════════════════════════════════════
// papel: nome do destino (aparece no "o que vai para o Dynamics" da tela)
// col:   nomes candidatos da coluna, na ordem de preferência
// campo: de qual valor vem
const MAPA_CABECALHO = [
  { papel: 'Cliente', col: COL.cliente, campo: 'cliente', obrigatorio: true },
  { papel: 'Motivo da devolução', col: COL.motivo, campo: 'motivo' },
  { papel: 'Referência do cliente', col: COL.referencia, campo: 'referencia' }
];
const MAPA_LINHA = [
  { papel: 'Item', col: COL.item, campo: 'codigo', obrigatorio: true },
  { papel: 'Quantidade', col: COL.quantidade, campo: 'quantidade', obrigatorio: true },
  { papel: 'Lote', col: COL.lote, campo: 'lote' },
  { papel: 'Depósito', col: COL.deposito, campo: 'deposito' }
];

function montar(mapa, valores, colunas, entidade) {
  const corpo = {}, mapeamento = [], avisos = [], erros = [];
  mapa.forEach(m => {
    const v = valores[m.campo];
    if (v == null || v === '') return;                 // vazio não vai (o D365 aplica o padrão dele)
    const col = escolher(m.col, colunas);
    if (!col) {
      const msg = entidade + ' não tem coluna para "' + m.papel + '" (procurei ' + m.col.join(', ') + ').';
      if (m.obrigatorio) erros.push(msg); else avisos.push(msg + ' Ficou de fora.');
      return;
    }
    if (Object.prototype.hasOwnProperty.call(corpo, col)) return;
    corpo[col] = v;
    mapeamento.push({ papel: m.papel, coluna: col, valor: v });
  });
  return { corpo, mapeamento, avisos, erros };
}
function aplicarFixos(corpo, mapeamento, fixos) {
  Object.keys(fixos || {}).forEach(k => {
    corpo[k] = fixos[k];
    mapeamento.push({ papel: 'Fixo (configuração)', coluna: k, valor: fixos[k] });
  });
}

// itens que vieram da tela, já limpos; erro = lista de motivos
function itensLimpos(itens) {
  const out = [], erros = [];
  (Array.isArray(itens) ? itens : []).slice(0, 200).forEach((it, i) => {
    const codigo = txt(it && it.codigo, 40).toUpperCase();
    const lote = txt(it && it.lote, 40);
    const q = Math.abs(num(it && it.quantidade));
    if (!codigo) { erros.push('Item ' + (i + 1) + ': falta o código.'); return; }
    if (!(q > 0)) { erros.push('Item ' + (i + 1) + ' (' + codigo + '): quantidade deve ser maior que zero.'); return; }
    out.push({ codigo, lote, quantidade: q, descricao: txt(it && it.descricao, 160) });
  });
  if (!out.length && !erros.length) erros.push('Nenhum item para a ordem de devolução.');
  return { itens: out, erros };
}

// O PLANO: os corpos que vão para o Dynamics, já com as colunas reais.
// colunas = { cabecalho: [...]|null, linhas: [...]|null }
function planejar(dados, cfg, ents, colunas) {
  colunas = colunas || {};
  const conta = contaCliente(dados && dados.cliente);
  const erros = [], avisos = [];
  if (!conta) erros.push('Falta o código do cliente no Dynamics.');
  const lim = itensLimpos(dados && dados.itens);
  erros.push.apply(erros, lim.erros);

  const cab = montar(MAPA_CABECALHO, {
    cliente: conta, motivo: cfg.motivo, referencia: txt(dados && dados.referencia, 20)
  }, colunas.cabecalho || null, ents.cabecalho);
  const corpoCab = Object.assign({ dataAreaId: cfg.empresa }, cab.corpo);
  aplicarFixos(corpoCab, cab.mapeamento, cfg.fixosCabecalho);

  const colNumCab = escolher(COL.numero, colunas.cabecalho || null);
  const colNumLin = escolher(COL.numero, colunas.linhas || null);
  if (!colNumLin) erros.push(ents.linhas + ' não tem coluna para o nº da ordem (procurei ' + COL.numero.join(', ') + ').');
  const deposito = cfg.deposito ? cfg.deposito.replace(/\{cliente\}/gi, conta) : '';

  const linhas = [];
  let mapLinha = null;
  lim.itens.forEach(it => {
    const m = montar(MAPA_LINHA, {
      codigo: it.codigo, lote: it.lote, deposito: deposito,
      quantidade: cfg.qtdNegativa ? -it.quantidade : it.quantidade
    }, colunas.linhas || null, ents.linhas);
    m.erros.forEach(e => { if (erros.indexOf(e) < 0) erros.push(e); });
    m.avisos.forEach(a => { if (avisos.indexOf(a) < 0) avisos.push(a); });
    const corpo = { dataAreaId: cfg.empresa };
    if (colNumLin) corpo[colNumLin] = null;            // o nº que o D365 devolver no cabeçalho
    Object.assign(corpo, m.corpo);
    aplicarFixos(corpo, m.mapeamento, cfg.fixosLinha);
    if (!mapLinha) mapLinha = m.mapeamento;
    linhas.push({ item: it, corpo });
  });

  return {
    cliente: conta,
    cabecalho: { entidade: ents.cabecalho, corpo: corpoCab, mapeamento: cab.mapeamento, colunaNumero: colNumCab, sondado: !!colunas.cabecalho },
    linhas: { entidade: ents.linhas, itens: linhas, mapeamento: mapLinha || [], colunaNumero: colNumLin, sondado: !!colunas.linhas },
    avisos: cab.avisos.concat(avisos).concat(cfg.erros),
    erros: cab.erros.concat(erros)
  };
}

// As requisições como a tela mostra (simulação / "o que vai para o Dynamics")
function requisicoesDoPlano(plano) {
  const out = [{ metodo: 'POST', url: D.RESOURCE + '/data/' + plano.cabecalho.entidade, corpo: plano.cabecalho.corpo }];
  plano.linhas.itens.forEach(l => {
    const corpo = Object.assign({}, l.corpo);
    if (plano.linhas.colunaNumero) corpo[plano.linhas.colunaNumero] = '(nº que o Dynamics devolver no cabeçalho)';
    out.push({ metodo: 'POST', url: D.RESOURCE + '/data/' + plano.linhas.entidade, corpo: corpo });
  });
  return out;
}

// sonda as duas entidades da devolução; falha vira aviso (usa os padrões)
async function sondarDevolucao(cfg, token) {
  const motivos = [], avisos = [];
  const cab = await resolver(cfg.entDevCab, token, motivos);
  const lin = await resolver(cfg.entDevLin, token, motivos);
  if (!cab || !lin) avisos.push('Não consegui ler as colunas da devolução (' + motivos.join(' · ') + ') — usei os nomes padrão.');
  if (cab && !cab.colunas) avisos.push(cab.entidade + ' está vazia no Dynamics: usei os nomes padrão das colunas.');
  if (lin && !lin.colunas) avisos.push(lin.entidade + ' está vazia no Dynamics: usei os nomes padrão das colunas.');
  return {
    ents: { cabecalho: cab ? cab.entidade : cfg.entDevCab[0], linhas: lin ? lin.entidade : cfg.entDevLin[0] },
    colunas: { cabecalho: cab ? cab.colunas : null, linhas: lin ? lin.colunas : null },
    sondou: !!(cab && lin),
    avisos
  };
}

async function planoDevolucao(dados, cfg, token) {
  const s = await sondarDevolucao(cfg, token);
  const plano = planejar(dados, cfg, s.ents, s.colunas);
  plano.avisos = s.avisos.concat(plano.avisos);
  return plano;
}

function chaveOData(obj) {
  return Object.keys(obj).map(k => k + "='" + D.odataStr(obj[k]) + "'").join(',');
}

// grava: cabeçalho, depois cada linha; linha recusada = apaga o cabeçalho
async function gravar(plano, cfg, token) {
  const cab = await D.odataEnviar('POST', plano.cabecalho.entidade, plano.cabecalho.corpo, token, 25000);
  const numero = txt(D.pick(cab, COL.numero), 40);
  const rma = txt(D.pick(cab, COL.rma), 40);
  if (!numero) {
    throw erroPublico('O Dynamics aceitou o cabeçalho mas não devolveu o nº da ordem de devolução — confira em ' +
      plano.cabecalho.entidade + ' antes de tentar de novo.', 502, { etapa: 'cabecalho-sem-numero' });
  }
  const feitas = [];
  for (let i = 0; i < plano.linhas.itens.length; i++) {
    const l = plano.linhas.itens[i];
    const corpo = Object.assign({}, l.corpo);
    corpo[plano.linhas.colunaNumero] = numero;
    try {
      const r = await D.odataEnviar('POST', plano.linhas.entidade, corpo, token, 25000);
      feitas.push({ codigo: l.item.codigo, lote: l.item.lote, quantidade: l.item.quantidade, linha: D.pick(r, COL.linha) });
    } catch (e) {
      let desfeito = false;
      const chave = { dataAreaId: cfg.empresa };
      chave[plano.cabecalho.colunaNumero || COL.numero[0]] = numero;
      try {
        await D.odataEnviar('DELETE', plano.cabecalho.entidade + '(' + chaveOData(chave) + ')', null, token, 20000);
        desfeito = true;
      } catch (e2) { /* fica o aviso: a ordem sobrou no D365 */ }
      throw erroPublico('O Dynamics recusou a linha ' + (i + 1) + ' (' + l.item.codigo + (l.item.lote ? ' · lote ' + l.item.lote : '') + '): ' + motivoFO(e),
        502, { etapa: 'linha', numero, rma, desfeito, linhasGravadas: feitas.length });
    }
  }
  return { numero, rma, empresa: cfg.empresa.toUpperCase(), linhas: feitas };
}

// o mesmo pedido duas vezes (clique duplo, voltar e reenviar) não cria duas ordens
const TTL_REPETIDO = 15 * 60e3;
const _feitas = new Map();
function assinatura(plano) {
  return plano.cliente + '|' + plano.linhas.itens.map(l => l.item.codigo + ':' + l.item.lote + ':' + l.item.quantidade).sort().join(',');
}
function jaCriada(plano) {
  const k = assinatura(plano), v = _feitas.get(k);
  return v && Date.now() - v.em < TTL_REPETIDO ? v.res : null;
}
function lembrar(plano, res) { _feitas.set(assinatura(plano), { em: Date.now(), res: res }); }

module.exports = {
  config, COL, COL_OV, rotulo, contaCliente, numeroOrdem, motivoFO,
  devolucoesAbertas, ovsAbertas, linhasOv,
  planejar, planoDevolucao, requisicoesDoPlano, gravar, jaCriada, lembrar, itensLimpos,
  _zerar: function () { _colunas.clear(); _feitas.clear(); }
};
