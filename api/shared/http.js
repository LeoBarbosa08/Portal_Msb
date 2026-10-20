// ================================================================
// api/shared/http.js — helpers de HTTP para as Functions
//  - cors(req): CORS travado na(s) origem(ns) do portal (não mais "*")
//  - preflight(req): resposta 204 para OPTIONS
//  - publicError(err): mensagem de erro SANITIZADA (sem corpo upstream,
//    sem stack, sem tokens) para devolver ao cliente
//  - logError(context, tag, err): loga o detalhe COMPLETO só no servidor
//
// Env: PORTAL_ALLOWED_ORIGINS = lista separada por vírgula
//      (default = https://portalcorporativo.biomedical.com.br)
// ================================================================

const ALLOWED_ORIGINS = String(
  process.env.PORTAL_ALLOWED_ORIGINS || 'https://portalcorporativo.biomedical.com.br'
).split(',').map(s => s.trim()).filter(Boolean);

function cors(req) {
  const origin = String((req && req.headers && (req.headers.origin || req.headers.Origin)) || '');
  const allow = ALLOWED_ORIGINS.indexOf(origin) >= 0 ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-portal-idtoken, x-portal-oid, x-portal-email, x-radar-key',
  };
}

function preflight(req) {
  return { status: 204, headers: cors(req) };
}

// Mensagem pública segura: nunca vaza corpo upstream, stack ou detalhe interno.
function publicError(err) {
  const status = (err && err.status) || 500;
  if (status === 401) return { status, body: { ok: false, error: 'Não autenticado.' } };
  if (status === 403) return { status, body: { ok: false, error: 'Acesso negado.' } };
  if (status === 400) return { status, body: { ok: false, error: (err && err.publicMessage) || 'Requisição inválida.' } };
  if (status === 404) return { status, body: { ok: false, error: (err && err.publicMessage) || 'Não encontrado.' } };
  return { status: status >= 400 && status < 600 ? status : 500, body: { ok: false, error: 'Erro interno.' } };
}

function logError(context, tag, err) {
  try {
    if (context && context.log && context.log.error) {
      context.log.error('[' + tag + ']', (err && (err.stack || err.message)) || String(err));
    }
  } catch (e) { /* noop */ }
}

// Escreve uma resposta de erro sanitizada em context.res
function sendError(context, req, tag, err) {
  logError(context, tag, err);
  const pe = publicError(err);
  context.res = { status: pe.status, headers: Object.assign({ 'Content-Type': 'application/json' }, cors(req)), body: pe.body };
}

// erro 400 com mensagem pública explícita
function badRequest(msg) { const e = new Error(msg || 'bad request'); e.status = 400; e.publicMessage = msg; return e; }

module.exports = { cors, preflight, publicError, logError, sendError, badRequest, ALLOWED_ORIGINS };
