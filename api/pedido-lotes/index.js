// ================================================================
// /api/pedido-lotes  —  Pedido Inteligente (portal)
//
// Para cada código de produto, cruza DUAS entidades do D365 F&O (OData
// direto, sem Power Automate):
//   1) BioInventSums        -> lotes (InventBatchId) com AvailPhysical > 0
//   2) BioInventItemBatchV3 -> validade (expDate) de cada lote
// Classifica cada lote pela proximidade do vencimento e devolve a lista
// ordenada por validade (FEFO: vence primeiro, sai primeiro).
//
//   POST /api/pedido-lotes  { codigos:["7024S11PDH", ...], location? }
//   -> { configured:true, location, itens:{ "COD": { disponivel:Number,
//          lotes:[ { batch, disponivel, expDate, dias, categoria } ] } } }
//   -> { configured:false }   (sem credenciais D365)
//
// Env vars: as do shared/d365.js (D365_TENANT_ID/CLIENT_ID/CLIENT_SECRET,
//   D365_RESOURCE_URL) + D365_ENTITY (BioInventSums), D365_BATCH_ENTITY
//   (BioInventItemBatchV3). Na MSB: ESTOQUE_MSB_EMPRESA (msb),
//   ESTOQUE_MSB_DEPOSITO (ALMOX-PA), ESTOQUE_MSB_LOCALIZACAO (vazia) — ver abaixo.
// ================================================================

const D = require('../shared/d365');
const auth = require('../shared/auth');
const http = require('../shared/http');

// RECORTE MSB (04/11/2026, pedido do dono): o estoque do PI da MSB é o da
// empresa MSB, depósito ALMOX-PA, SÓ nas localizações que começam com "PA."
// — o mesmo campo de sempre (Quantidade física disponível = AvailPhysical),
// somado por lote. As envs são PRÓPRIAS (ESTOQUE_MSB_*) de propósito: se
// alguém copiar do portal da BIO o ESTOQUE_EMPRESA (bio) ou o
// ESTOQUE_LOCATION (BCD), o estoque da MSB não muda.
const EMPRESA    = String(process.env.ESTOQUE_MSB_EMPRESA || 'msb').trim();
const LOCATION   = String(process.env.ESTOQUE_MSB_DEPOSITO || 'ALMOX-PA').trim();
// 05/11/2026 (pedido do dono): SEM filtro de localização por padrão. A
// RESERVA no Dynamics entra numa linha do depósito SEM localização (Qtd.
// física disponível -1, Reserva física 1) — com o filtro "PA." ela ficava de
// fora e o saldo mostrava 1 onde o certo é 0. O depósito ALMOX-PA inteiro,
// somado por lote, dá o saldo líquido certo. ESTOQUE_MSB_LOCALIZACAO volta o
// filtro, se um dia precisar.
const PREFIXO_LOC = String(process.env.ESTOQUE_MSB_LOCALIZACAO || '').trim().toUpperCase();
const ENT_SUM    = process.env.D365_ENTITY || 'BioInventSums';
const ENT_BATCH  = process.env.D365_BATCH_ENTITY || 'BioInventItemBatchV3';

const DIA = 86400000;

// classifica pela quantidade de dias até o vencimento
function categoriza(d) {
  if (d == null) return 'sem_data';
  if (d < 0)     return 'vencido';
  if (d <= 30)   return 'proximo';       // próximo do vencimento
  if (d <= 90)   return 'muito_curta';   // 1 a 3 meses
  if (d <= 180)  return 'curta';         // até 6 meses
  if (d <= 365)  return 'normal';        // até 1 ano
  if (d <= 730)  return 'boa';           // > 1 ano
  return 'muito_boa';                    // > 2 anos
}

// o campo da Localização (InventDim.wMSLocationId) na linha da entidade — o
// nome muda conforme a entidade (wMSLocationId, WMSLocationId,
// WarehouseLocationId…), então é descoberto na própria linha
function campoLocalizacao(row) {
  const ks = Object.keys(row || {});
  return ks.find(function (k) { return /^w?msLocationId$/i.test(k); }) ||
         ks.find(function (k) { return /^(warehouse)?locationid$/i.test(k); }) ||
         ks.find(function (k) { return /wms.*location/i.test(k) && !/^inventlocation/i.test(k); }) || null;
}

async function itemDados(codigo, location, token) {
  // 1) saldos por lote. Filtro AvailPhysical NE 0 (traz linhas positivas E
  //    negativas — ex.: baixa de lote gera linha negativa). O saldo real é a
  //    SOMA de todas as linhas por lote (net), senão o saldo "não atualiza".
  var fSum = [];
  if (EMPRESA)  fSum.push("dataAreaId eq '" + D.odataStr(EMPRESA) + "'");
  if (location) fSum.push("InventLocationId eq '" + D.odataStr(location) + "'");
  fSum.push("ItemId eq '" + D.odataStr(codigo) + "'");
  fSum.push('AvailPhysical ne 0');
  var sums = await D.odataGet(ENT_SUM, { filter: fSum.join(' and '), crossCompany: true }, token);

  // RECORTE MSB: só as localizações que começam com PREFIXO_LOC (desligado por padrão)
  if (PREFIXO_LOC && sums.length) {
    var campo = campoLocalizacao(sums[0]);
    if (!campo) {
      var e = new Error('a tabela ' + ENT_SUM + ' do Dynamics não traz a Localização (wMSLocationId), então não dá para ficar só com "' + PREFIXO_LOC + '"');
      e.semLocalizacao = true;
      throw e;
    }
    sums = sums.filter(function (r) { return String(r[campo] == null ? '' : r[campo]).trim().toUpperCase().indexOf(PREFIXO_LOC) === 0; });
  }

  // total = soma de TODAS as linhas (positivas + negativas) = saldo líquido
  var disponivelTotal = sums.reduce(function (s, r) { var n = Number(D.pick(r, ['AvailPhysical'])); return s + (isNaN(n) ? 0 : n); }, 0);

  // agrega por lote (net por InventBatchId) — junta linhas +/- do mesmo lote
  var netPorLote = {};
  sums.forEach(function (r) {
    var b = D.pick(r, ['InventBatchId', 'inventBatchId']);
    if (!b) return;
    b = String(b);
    var n = Number(D.pick(r, ['AvailPhysical'])); if (isNaN(n)) n = 0;
    netPorLote[b] = (netPorLote[b] || 0) + n;
  });

  // só lotes com saldo líquido POSITIVO podem ser alocados
  var lotes = Object.keys(netPorLote)
    .filter(function (b) { return netPorLote[b] > 0; })
    .map(function (b) { return { batch: b, disponivel: netPorLote[b] }; });

  if (!lotes.length) return { disponivel: disponivelTotal, lotes: [] };

  // 2) validade por lote (uma consulta por item)
  var expMap = {};
  try {
    var fBat = [];
    if (EMPRESA) fBat.push("dataAreaId eq '" + D.odataStr(EMPRESA) + "'");
    fBat.push("itemId eq '" + D.odataStr(codigo) + "'");
    var batches = await D.odataGet(ENT_BATCH, { filter: fBat.join(' and '), crossCompany: true }, token);
    batches.forEach(function (b) {
      var id = D.pick(b, ['inventBatchId', 'InventBatchId']);
      var exp = D.pick(b, ['expDate', 'ExpDate', 'expirationDate', 'ExpirationDate']);
      if (id) expMap[String(id).toUpperCase()] = exp || null;
    });
  } catch (e) { /* sem validade: segue só com saldo */ }

  var now = Date.now();
  lotes.forEach(function (l) {
    var exp = expMap[String(l.batch).toUpperCase()] || null;
    var dias = null;
    if (exp) { var t = new Date(exp).getTime(); if (!isNaN(t)) dias = Math.floor((t - now) / DIA); }
    l.expDate = exp;
    l.dias = dias;
    l.categoria = categoriza(dias);
  });

  // FEFO: vence primeiro, primeiro da lista (sem validade vai pro fim)
  lotes.sort(function (a, b) {
    if (a.dias == null && b.dias == null) return 0;
    if (a.dias == null) return 1;
    if (b.dias == null) return -1;
    return a.dias - b.dias;
  });

  return { disponivel: disponivelTotal, lotes: lotes };
}

module.exports = async function (context, req) {
  const cors = http.cors(req);
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: cors }; return; }

  try {
    await auth.requireArea(req, ['comercial', 'estoque']);

    if (!D.CONFIGURED) { context.res = { status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, cors), body: { configured: false } }; return; }

    const body = req.body || {};
    const location = (body.location || LOCATION);
    let codigos = Array.isArray(body.codigos) ? body.codigos : (body.codigo ? [body.codigo] : []);
    codigos = codigos.map(function (c) { return String(c || '').trim(); }).filter(Boolean);
    codigos = codigos.filter(function (c, i) { return codigos.indexOf(c) === i; });
    if (!codigos.length) throw http.badRequest('Envie "codigos" (lista) ou "codigo".');
    if (codigos.length > 1000) throw http.badRequest('Excesso de códigos numa só chamada.');

    const token = await D.getToken();
    const arr = await Promise.all(codigos.map(function (c) {
      return itemDados(c, location, token).catch(function (e) { return { disponivel: null, lotes: [], erro: (e && e.message) || String(e) }; });
    }));
    const itens = {};
    codigos.forEach(function (c, i) { itens[c] = arr[i]; });
    // o 1º erro vira aviso para a tela (o PI avisa uma vez e deixa seguir)
    const comErro = arr.filter(function (x) { return x && x.erro; });
    const aviso = comErro.length ? (comErro.length + ' de ' + arr.length + ' produto(s) sem consulta: ' + comErro[0].erro) : '';

    context.res = { status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, cors),
      body: { configured: true, location: location, deposito: location, localizacao: PREFIXO_LOC ? PREFIXO_LOC + '*' : '', empresa: EMPRESA, aviso: aviso, itens: itens } };
  } catch (err) {
    http.sendError(context, req, 'pedido-lotes', err);
  }
};
