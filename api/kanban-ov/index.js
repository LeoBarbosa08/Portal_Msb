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
//   -> { ok, configured, empresa, data, fontes, etapas, canceladas,
//        depositos (só ALMOX-PA: KANBAN_DEPOSITOS), foraDeposito, statusCols,
//        statusPadrao, ovs:[...], avisos, diagnostico }
//   GET /api/kanban-ov?ov=OV017525     -> as linhas da OV (a ficha do painel)
//   -> { ok, configured, numero, entidade, linhas:[{ linha, item, produto,
//        qtd, un, preco, desconto, descPct, valor, status, entrega,
//        confirmada, deposito }] }
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
    // ?ov=OV017525 -> as linhas da OV (a ficha do painel lê ao abrir)
    const ov = String(q.ov || '').trim();
    if (ov) {
      if (!/^[A-Za-z0-9._-]{3,40}$/.test(ov)) throw http.badRequest('Número de OV inválido.');
      json(200, await K.linhasDaOv(ov, { atualizar: q.atualizar === '1' }));
      return;
    }
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
