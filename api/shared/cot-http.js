// ================================================================
// api/shared/cot-http.js — resposta/erro comuns das Functions do módulo
// Cotações. Como no cs-http.js: o http.sendError do portal transforma todo
// 409/413 em "Erro interno."; aqui esses casos são RECADO para quem opera
// ("esta cotação já foi registrada: COT-…", "arquivo grande demais",
// "armazenamento não configurado"), então a mensagem pública vai junto —
// e o `extra` do erro (ex.: { duplicado: 'COT-…' }) também. 5xx continua
// sanitizado.
// ================================================================

const http = require('./http');
const store = require('./cot-store');

function cabecalhos(req) {
  return Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, http.cors(req));
}
function ok(context, req, body, status) {
  context.res = { status: status || 200, headers: cabecalhos(req), body: body };
}
function falhar(context, req, tag, err) {
  const st = (err && err.status) || 500;
  if (err && err.blob) {
    http.logError(context, tag, err);
    context.res = { status: 502, headers: cabecalhos(req), body: { ok: false, error: 'O armazenamento das Cotações recusou a operação.', armazenamento: store.diagnostico(err) } };
    return;
  }
  if (err && err.publicMessage && [400, 401, 403, 404, 409, 413, 422, 502, 503].indexOf(st) >= 0) {
    if (st >= 409) http.logError(context, tag, err);
    context.res = { status: st, headers: cabecalhos(req), body: Object.assign({ ok: false, error: err.publicMessage }, err.extra || {}) };
    return;
  }
  http.sendError(context, req, tag, err);
}
function preflight(context, req) {
  if (req.method !== 'OPTIONS') return false;
  context.res = { status: 204, headers: http.cors(req) };
  return true;
}

module.exports = { ok, falhar, preflight, cabecalhos };
