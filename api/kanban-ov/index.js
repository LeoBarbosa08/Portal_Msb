// ================================================================
// /api/kanban-ov  —  área KANBAN › Ordens do Dia
//
// As ordens de venda da MSB criadas no dia, lidas AO VIVO do Dynamics F&O
// (BIOSalesOrderHeaderV1 + SalesOrderHeadersV3/V2, juntas pelo número da
// OV; valor pelas linhas). O motor e o porquê de cada escolha estão em
// api/shared/kanban-ov.js.
//
//   GET /api/kanban-ov                 -> o dia de hoje (Brasília)
//   GET /api/kanban-ov?data=2026-11-05 -> outro dia
//   GET /api/kanban-ov?atualizar=1     -> ignora o cache de 15 s
//   GET /api/kanban-ov?diag=1          -> + colunas das entidades
//   -> { ok, configured, empresa, data, fontes, statusCols, statusPadrao,
//        ovs:[...], avisos, diagnostico }
//
// Acesso: a ÁREA kanban, que nasce RESERVADA (AREAS_RESERVADAS em
// api/shared/auth.js — as duas contas do dono e quem tem acesso full),
// enquanto o dono define o que cada status significa.
// ================================================================

const auth = require('../shared/auth');
const http = require('../shared/http');
const K    = require('../shared/kanban-ov');

module.exports = async function (context, req) {
  const cors = http.cors(req);
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: cors }; return; }
  const json = (status, body) => {
    context.res = { status, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, cors), body };
  };
  try {
    await auth.requireArea(req, 'kanban');
    if (!K.CONFIGURED) { json(200, { ok: true, configured: false }); return; }
    const q = req.query || {};
    const data = String(q.data || '').trim();
    if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw http.badRequest('Data inválida: use AAAA-MM-DD.');
    json(200, await K.ordensDoDia({ data, atualizar: q.atualizar === '1', diag: q.diag === '1' }));
  } catch (e) {
    if (e && (e.status === 401 || e.status === 403 || e.status === 400)) { http.sendError(context, req, 'kanban-ov', e); return; }
    // área reservada ao dono: o motivo do Dynamics volta para ele (é o diagnóstico)
    http.logError(context, 'kanban-ov', e);
    json(502, { ok: false, error: 'Não foi possível ler o Dynamics agora.', detalhe: String((e && e.message) || e).slice(0, 400) });
  }
};
