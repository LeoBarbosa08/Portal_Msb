// ================================================================
// /api/nf-status — o Power Automate manda o STATUS DAS NOTAS (18/11/2026)
//
// O status da nota (Aprovada, Cancelada, Rejeitada…) está no banco que
// alimenta o BI e às vezes não vem pelo OData do Dynamics (a 000021638
// "Sem status" no Kanban). Um fluxo lê esse status no banco e chama esta
// porta; o Kanban e o Faturamento do Dia usam o que chegou como RESERVA
// (o do Dynamics vale primeiro). Ninguém precisa de licença do Power BI:
// quem lê o banco é o fluxo, e quem mostra é o portal.
//
//   POST { "notas": [ { "numero": "000021638", "status": "Aprovada",
//                       "data": "2026-11-17", "empresa": "msb" } ] }
//        também aceita a lista pura, { value: [...] } ou o corpo do
//        "Executar uma consulta SQL (V2)" ({ ResultSets: { Table1: [...] } })
//   cabeçalho x-portal-chave: <KANBAN_NF_CHAVE>
//
//   200 { ok, recebidas, gravadas, novas, alteradas, ignoradas, motivos, total }
//   400 corpo sem a lista · 401 chave ausente/errada · 413 notas demais
//   502 o armazenamento recusou · 503 KANBAN_NF_CHAVE não configurada
//
// Sem login (quem chama é o Power Automate): só age com a chave certa
// (fail-closed: sem a variável, 503) e não devolve dado de nota nenhuma além
// das contagens e dos números que não entraram (com o motivo).
// ================================================================

const FLUXO = require('../shared/nf-status-fluxo');
const H = require('../shared/cot-http');

module.exports = async function (context, req) {
  if (H.preflight(context, req)) return;
  try {
    if (req.method !== 'POST') { const e = new Error('metodo'); e.status = 400; e.publicMessage = 'Use POST.'; throw e; }
    FLUXO.exigirChave(req);
    const r = await FLUXO.receber(req.body == null ? req.rawBody : req.body);
    H.ok(context, req, Object.assign({ ok: true }, r));
  } catch (err) {
    H.falhar(context, req, 'nf-status', err);
  }
};
