// ================================================================
// /api/directline-token  —  Portal Biomedical
// Gera um token temporário do Direct Line a partir do SEGREDO do canal
// (App Setting DIRECTLINE_SECRET). O navegador nunca vê o segredo.
//
// SEGURANÇA (2026-07): exige usuário autenticado (requireUser) — evita
// emissão anônima ilimitada de tokens do bot. Sob AUTH_ENFORCE off não
// bloqueia (rollout). CORS travado; erro sanitizado.
// ================================================================

const auth = require('../shared/auth');
const http = require('../shared/http');

const SECRET   = process.env.DIRECTLINE_SECRET;
const ENDPOINT = process.env.DIRECTLINE_TOKEN_ENDPOINT
  || 'https://directline.botframework.com/v3/directline/tokens/generate';

// id "enhanced" do Direct Line, derivado do usuário autenticado quando houver
function buildUserId(user) {
  const raw = (user && (user.oid || user.email)) || '';
  const clean = String(raw).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 56);
  return clean ? 'dl_' + clean : 'dl_anon_' + Math.random().toString(36).slice(2, 14);
}

module.exports = async function (context, req) {
  const cors = http.cors(req);
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: cors }; return; }

  try {
    const { user } = await auth.requireUser(req);

    if (!SECRET) { const e = new Error('DIRECTLINE_SECRET ausente'); e.status = 500; throw e; }

    const userId = buildUserId(user);
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: { id: userId } })
    });
    if (!r.ok) { await r.text(); const e = new Error('directline ' + r.status); e.status = 502; throw e; }

    const j = await r.json();
    context.res = {
      status: 200,
      headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, cors),
      body: { token: j.token, expires_in: j.expires_in, conversationId: j.conversationId, userId }
    };
  } catch (err) {
    http.sendError(context, req, 'directline-token', err);
  }
};
