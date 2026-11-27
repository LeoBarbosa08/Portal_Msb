// ================================================================
// api/shared/carteira-erp-leitura.js — o HISTÓRICO dos pedidos de
// cadastro no ERP, SÓ LEITURA (Carteira de Clientes da MSB, 27/11/2026)
//
// No portal completo, a ficha de um cliente que só está no Salesforce tem o
// botão "Pedir cadastro no ERP" (api/shared/carteira-erp.js de lá): sai um
// e-mail e o pedido fica registrado em erp-pedidos.json, na mesma pasta do
// blob da carteira (carteira.json.gz). A ficha e a lista mostram "Cadastro
// pedido em 18/11 por Fulano".
//
// RECORTE MSB: aqui a Carteira é um ESPELHO — ninguém pede cadastro, cria
// conta nem escreve nada. Este módulo só LÊ o mesmo registro (quando o blob
// está configurado com o mesmo endereço do completo), para o espelho mostrar
// o mesmo histórico. Nenhum PUT, nenhum e-mail: o carteira-erp.js do
// completo NÃO veio. Sem blob, o histórico fica vazio.
//
// Envs (as mesmas do completo): CARTEIRA_ERP_BLOB_URL (SAS do container ou
// do próprio arquivo) ou, sem ela, a pasta do blob da carteira
// (CARTEIRA_BLOB_URL / RADAR_BLOB_URL — ver api/shared/carteira-clientes.js).
// ================================================================

const C = require('./carteira-clientes');

const BLOB_ENV = String(process.env.CARTEIRA_ERP_BLOB_URL || '').trim();
const ARQUIVO  = 'erp-pedidos.json';
const CACHE_MS = 60000;
const PRAZO_MS = 6000;

let _cache = null;   // { em, dados } — a lista lê a cada abertura

function urlRegistro() {
  if (BLOB_ENV) {
    const q = BLOB_ENV.indexOf('?');
    const base = q < 0 ? BLOB_ENV : BLOB_ENV.slice(0, q), sas = q < 0 ? '' : BLOB_ENV.slice(q);
    if ((base.split('/').pop() || '').indexOf('.') >= 0) return BLOB_ENV;
    return base.replace(/\/+$/, '') + '/' + ARQUIVO + sas;
  }
  return C.urlBlob(ARQUIVO) || '';
}

async function lerRegistro() {
  const url = urlRegistro();
  if (!url) return {};
  const ctl = new AbortController();
  const t = setTimeout(function () { ctl.abort(); }, PRAZO_MS);
  try {
    const r = await fetch(url, { headers: { 'x-ms-version': '2021-08-06' }, signal: ctl.signal });
    if (r.status === 404) return {};
    if (!r.ok) throw new Error('registro (blob) GET ' + r.status);
    const j = await r.json().catch(function () { return null; });
    return j && j.pedidos && typeof j.pedidos === 'object' && !Array.isArray(j.pedidos) ? j.pedidos : {};
  } finally { clearTimeout(t); }
}

async function pedidos() {
  if (_cache && Date.now() - _cache.em < CACHE_MS) return _cache.dados;
  try { _cache = { em: Date.now(), dados: await lerRegistro() }; }
  catch (e) { if (!_cache) _cache = { em: Date.now() - CACHE_MS + 10000, dados: {} }; }
  return _cache.dados;
}

function publico(r) {
  return { em: r.em, por: r.por, porEmail: r.porEmail, de: r.de, via: r.via, para: r.para, obs: r.obs || '', anexos: r.anexos || [],
    conf: r.conf || '', diferencas: r.diferencas == null ? null : r.diferencas };
}

// o que a ficha mostra: o pedido está DESLIGADO aqui (ligado: false — a tela
// não oferece o botão) e o histórico do que foi pedido no portal completo
async function estado(k) {
  const p = k ? await pedidos() : {};
  const l = k && Array.isArray(p[k]) ? p[k] : [];
  return { ligado: false, espelho: true, para: [], pedidos: l.map(publico) };
}

// o que a lista mostra: o último pedido de cada cliente
async function resumoLista() {
  const p = await pedidos(), out = {};
  Object.keys(p).forEach(function (k) { const l = p[k]; if (Array.isArray(l) && l.length) out[k] = { em: l[l.length - 1].em, por: l[l.length - 1].por }; });
  return out;
}

module.exports = {
  estado, resumoLista, urlRegistro,
  _zerar: function () { _cache = null; }
};
