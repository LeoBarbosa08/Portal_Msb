// ================================================================
// /api/consig-lote  —  PI Consignação (portal)
//
// INVERSO do /api/pedido-lotes: recebe LOTES (InventBatchId) e descobre,
// para cada um, QUAL PRODUTO (ItemId) ele é no Dynamics F&O, além do
// saldo disponível e da validade. Usa OData direto (sem Power Automate):
//   1) BioInventSums        -> ItemId + AvailPhysical por lote (saldo líquido)
//   2) BioInventItemBatchV3 -> validade (expDate) do lote
//
//   POST /api/consig-lote  { lotes:["L2405A", ...], cliente?, location? }
//   -> { configured:true, itens:{ "<lote>": { batch, itemId, disponivel,
//          expDate, dias, categoria, deposito, found:true } } }
//   -> lote fora do depósito do cliente:
//          { batch, itemId:null, found:false, motivo:'fora_deposito_cliente',
//            depositoCliente:'C000000.CD' }
//   -> { configured:false }   (sem credenciais D365)
//
// ESCOPO POR CLIENTE (consignação): informe "cliente" (código do cliente) e o
//   endpoint só considera o depósito de consignação dele — "<cliente>.CD"
//   (ex.: C006620.CD). SEM isso, o mesmo lote presente em vários depósitos faz
//   o endpoint escolher pelo maior saldo e devolver o PRODUTO ERRADO. O
//   casamento tolera prefixo "C" e zeros à esquerda (compara só os dígitos).
//
// Env: as do shared/d365.js + ESTOQUE_EMPRESA (bio), D365_ENTITY
//   (BioInventSums), D365_BATCH_ENTITY (BioInventItemBatchV3).
//   "location" (opcional) restringe a um depósito exato via OData.
// ================================================================

const D = require('../shared/d365');
const auth = require('../shared/auth');
const http = require('../shared/http');

const EMPRESA   = (process.env.ESTOQUE_EMPRESA !== undefined ? process.env.ESTOQUE_EMPRESA : 'bio');
const ENT_SUM   = process.env.D365_ENTITY || 'BioInventSums';
const ENT_BATCH = process.env.D365_BATCH_ENTITY || 'BioInventItemBatchV3';

const DIA = 86400000;

function categoriza(d) {
  if (d == null) return 'sem_data';
  if (d < 0)     return 'vencido';
  if (d <= 30)   return 'proximo';
  if (d <= 90)   return 'muito_curta';
  if (d <= 180)  return 'curta';
  if (d <= 365)  return 'normal';
  if (d <= 730)  return 'boa';
  return 'muito_boa';
}

// dígitos significativos de um código/depósito (sem prefixo nem zeros à esq.)
function soDigitos(s) { return String(s == null ? '' : s).replace(/\D/g, '').replace(/^0+/, ''); }

// depósito de consignação do cliente = "<código>.CD" (ex.: C006620.CD).
// Casamento tolerante a prefixo "C" e zeros à esquerda: compara só os dígitos.
function ehDepositoDoCliente(locId, cliDig) {
  var loc = String(locId == null ? '' : locId).trim();
  if (!/\.cd\s*$/i.test(loc)) return false;   // precisa terminar em ".CD"
  if (!cliDig) return false;
  return soDigitos(loc) === cliDig;
}

async function loteDados(lote, opts, token) {
  opts = opts || {};
  var location = opts.location || null;
  var cliDig   = opts.clienteCod ? soDigitos(opts.clienteCod) : '';
  var depCli   = opts.clienteCod ? (String(opts.clienteCod).trim() + '.CD') : null;

  // 1) saldos do lote (todas as linhas do InventBatchId). AvailPhysical NE 0
  //    traz positivas e negativas — o saldo real é a SOMA (net) por ItemId.
  var fSum = [];
  if (EMPRESA)  fSum.push("dataAreaId eq '" + D.odataStr(EMPRESA) + "'");
  if (location) fSum.push("InventLocationId eq '" + D.odataStr(location) + "'");
  fSum.push("InventBatchId eq '" + D.odataStr(lote) + "'");
  fSum.push('AvailPhysical ne 0');
  var sums = await D.odataGet(ENT_SUM, { filter: fSum.join(' and '), crossCompany: true }, token);

  if (!sums.length) return { batch: lote, itemId: null, disponivel: null, found: false };

  // ESCOPO por depósito de consignação do cliente ("<cod>.CD"). Sem achar o lote
  // NESSE depósito, NÃO adivinha o produto por outro depósito (evita faturar o
  // produto errado quando o mesmo lote existe em vários depósitos).
  var depUsado = null;
  if (cliDig) {
    var noCliente = sums.filter(function (r) {
      return ehDepositoDoCliente(D.pick(r, ['InventLocationId', 'inventLocationId']), cliDig);
    });
    if (!noCliente.length) {
      return { batch: lote, itemId: null, disponivel: null, found: false,
               motivo: 'fora_deposito_cliente', depositoCliente: depCli };
    }
    sums = noCliente;
    depUsado = D.pick(noCliente[0], ['InventLocationId', 'inventLocationId']) || depCli;
  }

  // net por ItemId (normalmente 1 item por lote naquele depósito)
  var netPorItem = {};
  sums.forEach(function (r) {
    var it = D.pick(r, ['ItemId', 'itemId']);
    if (!it) return;
    it = String(it);
    var n = Number(D.pick(r, ['AvailPhysical'])); if (isNaN(n)) n = 0;
    netPorItem[it] = (netPorItem[it] || 0) + n;
    if (!depUsado) depUsado = D.pick(r, ['InventLocationId', 'inventLocationId']) || null;
  });

  // escolhe o ItemId com maior saldo líquido (desempata pelo primeiro)
  var itemId = null, best = -Infinity;
  Object.keys(netPorItem).forEach(function (it) { if (netPorItem[it] > best) { best = netPorItem[it]; itemId = it; } });
  if (!itemId) return { batch: lote, itemId: null, disponivel: null, found: false };

  var disponivel = netPorItem[itemId];

  // 2) validade do lote
  var expDate = null;
  try {
    var fBat = [];
    if (EMPRESA) fBat.push("dataAreaId eq '" + D.odataStr(EMPRESA) + "'");
    fBat.push("itemId eq '" + D.odataStr(itemId) + "'");
    fBat.push("inventBatchId eq '" + D.odataStr(lote) + "'");
    var batches = await D.odataGet(ENT_BATCH, { filter: fBat.join(' and '), crossCompany: true }, token);
    if (batches.length) {
      expDate = D.pick(batches[0], ['expDate', 'ExpDate', 'expirationDate', 'ExpirationDate']) || null;
    }
  } catch (e) { /* sem validade: segue só com saldo */ }

  var dias = null;
  if (expDate) { var t = new Date(expDate).getTime(); if (!isNaN(t)) dias = Math.floor((t - Date.now()) / DIA); }

  return { batch: lote, itemId: itemId, disponivel: disponivel, deposito: depUsado, expDate: expDate, dias: dias, categoria: categoriza(dias), found: true };
}

module.exports = async function (context, req) {
  const cors = http.cors(req);
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: cors }; return; }

  try {
    await auth.requireArea(req, ['comercial', 'estoque']);

    if (!D.CONFIGURED) { context.res = { status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, cors), body: { configured: false } }; return; }

    const body = req.body || {};
    const location = body.location || null;
    const clienteCod = (body.cliente != null && String(body.cliente).trim()) ? String(body.cliente).trim() : null;
    let lotes = Array.isArray(body.lotes) ? body.lotes : (body.lote ? [body.lote] : []);
    lotes = lotes.map(function (l) { return String(l || '').trim(); }).filter(Boolean);
    lotes = lotes.filter(function (l, i) { return lotes.indexOf(l) === i; });
    if (!lotes.length) throw http.badRequest('Envie "lotes" (lista) ou "lote".');
    if (lotes.length > 1000) throw http.badRequest('Excesso de lotes numa só chamada.');

    const token = await D.getToken();
    const opts = { location: location, clienteCod: clienteCod };
    const arr = await Promise.all(lotes.map(function (l) {
      return loteDados(l, opts, token).catch(function (e) { return { batch: l, itemId: null, disponivel: null, found: false, erro: (e && e.message) || String(e) }; });
    }));
    const itens = {};
    lotes.forEach(function (l, i) { itens[l] = arr[i]; });

    context.res = { status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, cors),
      body: { configured: true, empresa: EMPRESA, itens: itens } };
  } catch (err) {
    http.sendError(context, req, 'consig-lote', err);
  }
};
