// ================================================================
// api/shared/d365.js — helper de acesso ao Dynamics 365 F&O (OData)
// Autenticação client-credentials (token em cache) + GET OData.
// Usado por /api/pedido-lotes (e disponível p/ outros endpoints).
// ================================================================

const TENANT   = process.env.D365_TENANT_ID;
const CLIENT   = process.env.D365_CLIENT_ID;
const SECRET   = process.env.D365_CLIENT_SECRET;
const RESOURCE = (process.env.D365_RESOURCE_URL || 'https://mlb.operations.dynamics.com').replace(/\/$/, '');

const CONFIGURED = !!(TENANT && CLIENT && SECRET);

// escapa aspas simples para strings OData ('' = uma aspa)
function odataStr(s) { return String(s == null ? '' : s).replace(/'/g, "''"); }

let _tok = null, _tokExp = 0;
async function getToken() {
  var now = Date.now();
  if (_tok && now < _tokExp - 60000) return _tok;
  var url = 'https://login.microsoftonline.com/' + TENANT + '/oauth2/v2.0/token';
  var body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT,
    client_secret: SECRET,
    scope: RESOURCE + '/.default'
  });
  var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body });
  var txt = await r.text();
  if (!r.ok) throw new Error('token ' + r.status + ': ' + txt.slice(0, 200));
  var j = JSON.parse(txt);
  _tok = j.access_token;
  _tokExp = now + ((Number(j.expires_in) || 3600) * 1000);
  return _tok;
}

// monta a query string OData a partir de opts
function odataQs(opts) {
  opts = opts || {};
  var qs = [];
  if (opts.crossCompany) qs.push('cross-company=true');
  if (opts.select)  qs.push('$select=' + encodeURIComponent(opts.select));
  if (opts.filter)  qs.push('$filter=' + encodeURIComponent(opts.filter));
  if (opts.orderby) qs.push('$orderby=' + encodeURIComponent(opts.orderby));
  if (opts.top)     qs.push('$top=' + encodeURIComponent(opts.top));
  return qs.length ? ('?' + qs.join('&')) : '';
}

// Quanto do corpo de erro do F&O entra na mensagem. 180 não bastava: o F&O
// devolve o erro em JSON indentado e o motivo de verdade está em
// error.innererror.message — com 180 a string parava em '"inner' e todo 400 de
// $filter ficava indistinguível ("An error has occurred.").
var ERRO_MAX = Number(process.env.D365_ERRO_MAX || 600);

// GET numa entidade OData. opts: { filter, select, orderby, top, crossCompany }
async function odataGet(entity, opts, token) {
  var url = RESOURCE + '/data/' + entity + odataQs(opts);
  var r = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
  var txt = await r.text();
  if (!r.ok) throw new Error('F&O ' + r.status + ': ' + txt.replace(/\s+/g, ' ').slice(0, ERRO_MAX));
  var j = JSON.parse(txt);
  return Array.isArray(j.value) ? j.value : [];
}

// GET seguindo @odata.nextLink (paginação server-driven do F&O, ~10k linhas
// por página). Devolve TODAS as linhas; maxPages é a trava de segurança.
async function odataGetAll(entity, opts, token, maxPages) {
  var url = RESOURCE + '/data/' + entity + odataQs(opts);
  var out = [], pages = 0, cap = maxPages || 60;
  while (url && pages < cap) {
    var r = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
    var txt = await r.text();
    if (!r.ok) throw new Error('F&O ' + r.status + ': ' + txt.replace(/\s+/g, ' ').slice(0, ERRO_MAX));
    var j = JSON.parse(txt);
    if (Array.isArray(j.value)) out = out.concat(j.value);
    url = j['@odata.nextLink'] || null;
    pages++;
  }
  return out;
}

// GET (uma página) com PRAZO. O SWA corta a Function em ~45 s SEM avisar — a
// tela recebe 500 sem corpo — e uma consulta lenta do F&O sozinha passa
// disso. Com prazo, quem chama recebe um erro com `demorou: true` a tempo de
// responder alguma coisa. O prazo cobre também a leitura do corpo.
async function odataGetComPrazo(entity, opts, token, ms) {
  var ctl = new AbortController();
  var t = setTimeout(function () { ctl.abort(); }, Math.max(1, Number(ms) || 1));
  try {
    var r = await fetch(RESOURCE + '/data/' + entity + odataQs(opts), {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: ctl.signal
    });
    var txt = await r.text();
    if (!r.ok) throw new Error('F&O ' + r.status + ': ' + txt.replace(/\s+/g, ' ').slice(0, ERRO_MAX));
    var j = JSON.parse(txt);
    return Array.isArray(j.value) ? j.value : [];
  } catch (e) {
    if (e && e.name === 'AbortError') {
      var err = new Error('o Dynamics não respondeu em ' + Math.round(ms / 1000) + ' s (' + entity + ')');
      err.demorou = true;
      throw err;
    }
    throw e;
  } finally { clearTimeout(t); }
}

// ESCRITA (POST / PATCH / DELETE) numa entidade OData, com prazo. `caminho` é
// o nome da entidade ou a entidade com a chave — "Entidade(dataAreaId='bio',X='1')".
// Devolve o corpo da resposta já em JSON (null quando vem vazio, ex.: DELETE).
// No erro, `e.corpo` leva a resposta inteira do F&O (o motivo de verdade
// está em error.innererror.message) e `e.statusD365` o status — NÃO `e.status`,
// que o http.publicError trataria como erro do próprio portal.
// Hoje só o Lançamentos Administrativos escreve (api/lancamentos).
async function odataEnviar(metodo, caminho, corpo, token, ms) {
  var ctl = new AbortController();
  var t = setTimeout(function () { ctl.abort(); }, Math.max(1, Number(ms) || 30000));
  try {
    var r = await fetch(RESOURCE + '/data/' + caminho, {
      method: metodo,
      headers: {
        Authorization: 'Bearer ' + token, Accept: 'application/json',
        'Content-Type': 'application/json', Prefer: 'return=representation'
      },
      body: corpo == null ? undefined : JSON.stringify(corpo),
      signal: ctl.signal
    });
    var txt = await r.text();
    if (!r.ok) {
      var e = new Error('F&O ' + r.status + ': ' + txt.replace(/\s+/g, ' ').slice(0, ERRO_MAX));
      e.statusD365 = r.status;
      e.corpo = txt;
      throw e;
    }
    return txt ? JSON.parse(txt) : null;
  } catch (e) {
    if (e && e.name === 'AbortError') {
      var err = new Error('o Dynamics não respondeu em ' + Math.round((ms || 30000) / 1000) + ' s (' + metodo + ' ' + caminho + ')');
      err.demorou = true;
      throw err;
    }
    throw e;
  } finally { clearTimeout(t); }
}

// lê um campo por vários nomes possíveis (case-insensitive)
function pick(obj, names) {
  if (!obj) return null;
  for (var i = 0; i < names.length; i++) if (obj[names[i]] != null) return obj[names[i]];
  var keys = Object.keys(obj);
  for (var n = 0; n < names.length; n++) {
    var t = names[n].toLowerCase();
    for (var k = 0; k < keys.length; k++) if (keys[k].toLowerCase() === t) return obj[keys[k]];
  }
  return null;
}

module.exports = { CONFIGURED, RESOURCE, getToken, odataGet, odataGetAll, odataGetComPrazo, odataEnviar, odataStr, pick };
