// ================================================================
// api/shared/cot-lotes.js — o LOTE do material da A faturar no Dynamics 365 (F&O)
//
// 29/10/26 (pedido do usuário): ao passar a cotação para A faturar, "tenho
// que validar o LOTE e verificar se ele de fato existe, com base no PRODUTO
// da cotação". O lote é conferido no cadastro de lotes do item no F&O
// (BioInventItemBatchV3 — a mesma entidade da validade do /api/pedido-lotes):
// existe a linha itemId = o Cód. Biomedical do item E inventBatchId = o lote.
// Não importa o saldo: o material já foi usado na cirurgia (muitas vezes de
// consignado no hospital), então o lote pode estar zerado no depósito.
//
// SÓ LEITURA, app-only (as mesmas D365_* do /api/pedido-lotes e do
// shared/cot-ov.js). O OData do F&O só filtra texto com eq; o banco compara
// sem caixa (l2291a = L2291A). Cache por produto|lote: 1 h quando existe,
// 10 min quando não existe.
//
//   conferir([{ codigo, lote }]) -> { configurado, lotes: [{ codigo, lote,
//     existe: true | false | null, validade, erro }] }
//   existe null = não deu para conferir (Dynamics fora/sem permissão: erro)
// ================================================================

const D = require('./d365');

// RECORTE MSB: o lote é o da empresa msb — a env PRÓPRIA da MSB, a mesma do
// /api/pedido-lotes (o ESTOQUE_EMPRESA copiado do portal da BIO é 'bio')
const EMPRESA = String(process.env.ESTOQUE_MSB_EMPRESA || 'msb').trim();
const ENT_BATCH = process.env.D365_BATCH_ENTITY || 'BioInventItemBatchV3';
const TTL_ACHOU = 60 * 60e3, TTL_NAO = 10 * 60e3;
const _cache = new Map();   // 'COD|LOTE' -> { em, ttl, v }

function txt(v, max) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max || 60); }
function chave(cod, lote) { return txt(cod, 40).toUpperCase() + '|' + txt(lote, 60).toUpperCase(); }
// "L2291A, L2291B" -> ['L2291A', 'L2291B'] (o item que usou mais de um lote)
function separar(v) {
  return String(v == null ? '' : v).split(/[,;]+/).map(function (x) { return txt(x, 60).toUpperCase(); })
    .filter(function (x, i, l) { return x && l.indexOf(x) === i; });
}

async function umLote(codigo, lote, token, ms) {
  const f = [];
  if (EMPRESA) f.push("dataAreaId eq '" + D.odataStr(EMPRESA) + "'");
  f.push("itemId eq '" + D.odataStr(codigo) + "'");
  f.push("inventBatchId eq '" + D.odataStr(lote) + "'");
  const rows = await D.odataGetComPrazo(ENT_BATCH, { filter: f.join(' and '), crossCompany: true, top: 5 }, token, ms);
  if (!rows.length) return { existe: false, validade: '' };
  const exp = D.pick(rows[0], ['expDate', 'ExpDate', 'expirationDate', 'ExpirationDate']);
  return { existe: true, validade: exp ? txt(exp, 30).slice(0, 10).replace(/^1900-01-01$/, '') : '' };
}

async function conferir(pares, opts) {
  const lista = [];
  (Array.isArray(pares) ? pares : []).slice(0, 200).forEach(function (p) {
    const codigo = txt(p && p.codigo, 40).toUpperCase(), lote = txt(p && p.lote, 60).toUpperCase();
    if (lote && !lista.some(function (x) { return x.codigo === codigo && x.lote === lote; })) lista.push({ codigo: codigo, lote: lote });
  });
  if (!D.CONFIGURED) return { configurado: false, lotes: lista.map(function (x) { return Object.assign({}, x, { existe: null, validade: '', erro: 'a consulta ao Dynamics não está ligada no portal' }); }) };
  const ms = (opts && opts.timeoutMs) || 8000;
  let token = null, erroToken = '';
  const out = [];
  for (const x of lista) {
    if (!x.codigo) { out.push(Object.assign({}, x, { existe: null, validade: '', erro: 'o item não tem o Código do produto' })); continue; }
    const k = chave(x.codigo, x.lote), h = _cache.get(k);
    if (h && Date.now() - h.em < h.ttl) { out.push(Object.assign({}, x, h.v)); continue; }
    try {
      if (!token && !erroToken) token = await D.getToken();
      if (erroToken) throw new Error(erroToken);
      const v = await umLote(x.codigo, x.lote, token, ms);
      _cache.set(k, { em: Date.now(), ttl: v.existe ? TTL_ACHOU : TTL_NAO, v: v });
      out.push(Object.assign({}, x, v));
    } catch (e) {
      if (!token) erroToken = txt(e && e.message, 160) || 'sem acesso ao Dynamics';
      out.push(Object.assign({}, x, { existe: null, validade: '', erro: txt(e && e.message, 160) || 'o Dynamics não respondeu' }));
    }
  }
  return { configurado: true, lotes: out };
}

module.exports = { conferir, separar, configurado: function () { return D.CONFIGURED; }, _zerar: function () { _cache.clear(); } };
