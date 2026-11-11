// ================================================================
// /api/pedido-lotes  —  Pedido Inteligente (portal)
//
// Para cada código de produto, cruza DUAS entidades do D365 F&O (OData
// direto, sem Power Automate):
//   1) BioInventSums        -> saldo de cada lote (InventBatchId) =
//        PhysicalInvent das localizações "PA."  −  ReservPhysical sem localização
//        (linha "PA." com físico = reserva física fica fora)
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
//   ESTOQUE_MSB_DEPOSITO (ALMOX-PA), ESTOQUE_MSB_LOCALIZACAO (PA.) — ver abaixo.
// ================================================================

const D = require('../shared/d365');
const auth = require('../shared/auth');
const http = require('../shared/http');

// RECORTE MSB (04/11/2026, pedido do dono): o estoque do PI da MSB é o da
// empresa MSB, depósito ALMOX-PA (a conta do lote, desde 11/11, logo abaixo).
// As envs são PRÓPRIAS (ESTOQUE_MSB_*) de propósito: se alguém copiar do
// portal da BIO o ESTOQUE_EMPRESA (bio) ou o ESTOQUE_LOCATION (BCD), o
// estoque da MSB não muda.
const EMPRESA    = String(process.env.ESTOQUE_MSB_EMPRESA || 'msb').trim();
const LOCATION   = String(process.env.ESTOQUE_MSB_DEPOSITO || 'ALMOX-PA').trim();
// 05/11/2026 (pedido do dono): SEM filtro de localização. A RESERVA no
// Dynamics entra numa linha do depósito SEM localização (Qtd. física
// disponível -1, Reserva física 1) — com o filtro "PA." ela ficava de fora e o
// saldo mostrava 1 onde o certo é 0.
//
// 11/11/2026 (pedido do dono) — A CONTA DO LOTE, campo a campo:
//   saldo do lote = PhysicalInvent (estoque físico) das linhas do ALMOX-PA cuja
//                   localização (wMSLocationId) começa com "PA."
//                 − ReservPhysical (reserva física) das linhas do MESMO lote
//                   SEM localização.
// Saiu o AvailPhysical (Qtd. física disponível). As outras localizações
// (fora de "PA.") não somam físico, e a reserva que tem localização não
// entra. ESTOQUE_MSB_LOCALIZACAO troca o prefixo (padrão "PA.").
//   11/11/2026 (pedido do dono): linha em "PA." com PhysicalInvent IGUAL ao
//   ReservPhysical (tudo reservado naquela localização) fica FORA da conta —
//   o físico dela não soma. Se o lote só tem linha assim, ele nem aparece.
const PREFIXO_LOC = String(process.env.ESTOQUE_MSB_LOCALIZACAO || 'PA.').trim().toUpperCase();
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

function numero(r, nomes) { var n = Number(D.pick(r, nomes)); return isNaN(n) ? 0 : n; }

async function itemDados(codigo, location, token) {
  // 1) as linhas do item no depósito com físico OU reserva física (as duas
  //    pernas da conta do lote — ver PREFIXO_LOC acima)
  var fSum = [];
  if (EMPRESA)  fSum.push("dataAreaId eq '" + D.odataStr(EMPRESA) + "'");
  if (location) fSum.push("InventLocationId eq '" + D.odataStr(location) + "'");
  fSum.push("ItemId eq '" + D.odataStr(codigo) + "'");
  fSum.push('(PhysicalInvent ne 0 or ReservPhysical ne 0)');
  var sums = await D.odataGet(ENT_SUM, { filter: fSum.join(' and '), crossCompany: true }, token);

  // sem a Localização na linha não dá para separar "PA." de "sem localização"
  var campo = sums.length ? campoLocalizacao(sums[0]) : null;
  if (sums.length && !campo) {
    var e = new Error('a tabela ' + ENT_SUM + ' do Dynamics não traz a Localização (wMSLocationId), então não dá para fazer a conta "' + PREFIXO_LOC + '" menos a reserva sem localização');
    e.semLocalizacao = true;
    throw e;
  }

  // por lote: físico das localizações PREFIXO_LOC e reserva física sem localização
  // (linha sem lote fica no grupo '' — entra no total, não vira lote alocável)
  var porLote = {};
  sums.forEach(function (r) {
    var b = String(D.pick(r, ['InventBatchId', 'inventBatchId']) || '');
    var loc = String(r[campo] == null ? '' : r[campo]).trim().toUpperCase();
    var g = porLote[b] || (porLote[b] = { fisico: 0, reserva: 0 });
    if (loc && loc.indexOf(PREFIXO_LOC) === 0) {
      var fis = numero(r, ['PhysicalInvent']), res = numero(r, ['ReservPhysical']);
      if (Math.abs(fis - res) < 1e-9) return;   // tudo reservado nesta localização: fora da conta
      g.fisico += fis;
    }
    else if (!loc) g.reserva += numero(r, ['ReservPhysical']);
  });
  Object.keys(porLote).forEach(function (b) { porLote[b].saldo = porLote[b].fisico - porLote[b].reserva; });

  // total = soma dos saldos POSITIVOS (lote com reserva maior que o físico em
  // PA. fica em 0 — não come o saldo dos outros lotes); bate com o que a
  // etapa Lotes deixa alocar
  var disponivelTotal = Object.keys(porLote).reduce(function (s, b) { return s + Math.max(0, porLote[b].saldo); }, 0);

  // só lotes com saldo POSITIVO podem ser alocados
  var lotes = Object.keys(porLote)
    .filter(function (b) { return b && porLote[b].saldo > 0; })
    .map(function (b) { return { batch: b, disponivel: porLote[b].saldo, fisico: porLote[b].fisico, reserva: porLote[b].reserva }; });

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
