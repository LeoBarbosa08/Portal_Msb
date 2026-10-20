// ================================================================
// /api/pbi-query  —  Portal Biomedical
// Backend que autentica como Service Principal e consulta Power BI
// aplicando RLS via "effectiveIdentity" do usuário LOGADO.
//
// SEGURANÇA (2026-07): a identidade não vem mais de header/body forjável.
// Vem do id token do Entra validado (api/shared/auth.js); o e-mail do RLS
// é o do usuário autenticado. Sob AUTH_ENFORCE off, cai no legado sem
// bloquear (rollout). CORS travado na origem; erros sanitizados.
// ================================================================

const auth = require('../shared/auth');
const http = require('../shared/http');

const TENANT_ID     = process.env.PBI_TENANT_ID;
const CLIENT_ID     = process.env.PBI_CLIENT_ID;
const CLIENT_SECRET = process.env.PBI_CLIENT_SECRET;
const WORKSPACE_ID  = process.env.PBI_WORKSPACE_ID;
const DATASET_ID    = process.env.PBI_DATASET_ID;       // opcional (cache)
const DATASET_NAME  = process.env.PBI_DATASET_NAME;     // fallback: descobre pelo nome
const RLS_ROLES     = (process.env.PBI_RLS_ROLES || '').split(',').map(s => s.trim()).filter(Boolean);

const MAX_DAX = Number(process.env.PBI_MAX_DAX_CHARS || 20000); // trava anti-abuso

// Cache do token (vale ~1h)
let _tokenCache = { token: null, expiresAt: 0 };
async function getAppToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt - 60000) return _tokenCache.token;
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    scope: 'https://analysis.windows.net/powerbi/api/.default'
  });
  const r = await fetch(url, { method: 'POST', body });
  if (!r.ok) throw new Error('Falha token SP: ' + r.status);
  const j = await r.json();
  _tokenCache = { token: j.access_token, expiresAt: Date.now() + (j.expires_in * 1000) };
  return j.access_token;
}

let _datasetIdCache = null;
async function resolveDatasetId(token) {
  if (DATASET_ID) return DATASET_ID;
  if (_datasetIdCache) return _datasetIdCache;
  const url = `https://api.powerbi.com/v1.0/myorg/groups/${WORKSPACE_ID}/datasets`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('Falha listar datasets: ' + r.status);
  const j = await r.json();
  const found = (j.value || []).find(d => d.name === DATASET_NAME);
  if (!found) throw new Error('Dataset não encontrado');
  _datasetIdCache = found.id;
  return found.id;
}

async function executeQuery({ token, datasetId, dax, userEmail }) {
  const url = `https://api.powerbi.com/v1.0/myorg/groups/${WORKSPACE_ID}/datasets/${datasetId}/executeQueries`;
  const payload = { queries: [{ query: dax }], serializerSettings: { includeNulls: true } };
  // RLS por impersonação: SP "vira" o usuário AUTENTICADO
  if (userEmail) {
    payload.impersonatedUserName = userEmail;
    if (RLS_ROLES.length > 0) payload.roles = RLS_ROLES;
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await r.text();
  if (!r.ok) { const err = new Error('PBI executeQueries ' + r.status); err.status = 502; err.upstream = text; throw err; }
  return JSON.parse(text);
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = http.preflight(req); return; }
  try {
    if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !WORKSPACE_ID) {
      const e = new Error('backend PBI mal configurado'); e.status = 500; throw e;
    }

    // identidade validada (token Entra); RLS usa SEMPRE o e-mail autenticado
    const { user } = await auth.requireArea(req, ['financeiro', 'comercial', 'contabil', 'estoque', 'produtos']);
    const userEmail = (user && user.email) || '';
    if (!userEmail) { const e = new Error('sem identidade'); e.status = 401; throw e; }

    const dax = req.body && req.body.dax;
    if (!dax || typeof dax !== 'string') throw http.badRequest('Faltou "dax" (string) no body.');
    if (dax.length > MAX_DAX) throw http.badRequest('Consulta DAX excede o limite.');

    const token     = await getAppToken();
    const datasetId = await resolveDatasetId(token);
    const result    = await executeQuery({ token, datasetId, dax, userEmail });

    context.res = {
      status: 200,
      headers: Object.assign({ 'Content-Type': 'application/json' }, http.cors(req)),
      body: { ok: true, userEmail, data: result }   // não expõe datasetId/roles internos
    };
  } catch (err) {
    http.sendError(context, req, 'pbi-query', err);
  }
};
