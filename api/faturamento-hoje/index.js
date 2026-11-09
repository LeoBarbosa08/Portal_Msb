// ================================================================
// /api/faturamento-hoje  —  Comercial › Sales Report › Faturamento do Dia
//
// As notas da MSB faturadas no dia (venda e devolução), lidas AO VIVO do
// Dynamics F&O pela entidade de documento fiscal. O motor (e o porquê de
// cada escolha) está em api/shared/faturamento-dia.js.
//
//   GET /api/faturamento-hoje                 -> o dia de hoje (Brasília)
//   GET /api/faturamento-hoje?data=2026-11-05 -> outro dia
//   GET /api/faturamento-hoje?atualizar=1     -> ignora o cache de 1 min
//   GET /api/faturamento-hoje?diag=1          -> + colunas das entidades
//   GET /api/faturamento-hoje?sondar=1        -> SONDA: qual entidade do D365
//        traz o tipo de operação das notas de 2026 (api/shared/fatdia-sonda.js)
//   -> { ok, configured, empresa, data, fonte, notas:[...], resumo,
//        conferencia, avisos, diagnostico }
//   -> { configured:false }   (sem credenciais D365)
//
// SÓ DO DONO (pedido dele, 06/11/2026: "oculta para todo mundo menos para
// mim"): as mesmas duas contas do PI · Pedido. Token VALIDADO obrigatório —
// sem o modo legado de e-mail em header. Para abrir para a equipe: tirar
// daqui (DONOS) e do SO_DONO do nav-sidebar.js.
// ================================================================

const auth = require('../shared/auth');
const http = require('../shared/http');
const FD   = require('../shared/faturamento-dia');
const SONDA = require('../shared/fatdia-sonda');

const DONOS = ['leonardo.barbosa@biomedical.com.br', 'ia@biomedical.com.br'];
async function exigirDono(req) {
  const r = await auth.requireUser(req);
  const email = String((r.user && r.user.email) || '').trim().toLowerCase();
  if (!r.validated || !email) { const e = new Error('Entre com a sua conta Microsoft para ver o Faturamento do Dia.'); e.status = 401; throw e; }
  if (DONOS.indexOf(email) < 0) { const e = new Error('O Faturamento do Dia é de acesso restrito.'); e.status = 403; throw e; }
}

module.exports = async function (context, req) {
  const cors = http.cors(req);
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: cors }; return; }
  const json = (status, body) => {
    context.res = { status, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, cors), body };
  };
  try {
    await exigirDono(req);
    if (!FD.CONFIGURED) { json(200, { ok: true, configured: false }); return; }
    const q = req.query || {};
    if (q.sondar === '1') { json(200, await SONDA.sondar()); return; }
    const data = String(q.data || '').trim();
    if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw http.badRequest('Data inválida: use AAAA-MM-DD.');
    const r = await FD.notasDoDia({ data, atualizar: q.atualizar === '1', diag: q.diag === '1' });
    json(200, r);
  } catch (e) {
    if (e && (e.status === 401 || e.status === 403 || e.status === 400)) { http.sendError(context, req, 'faturamento-hoje', e); return; }
    // dono do módulo: o motivo do Dynamics volta para ele (é o diagnóstico)
    http.logError(context, 'faturamento-hoje', e);
    json(502, { ok: false, error: 'Não foi possível ler o Dynamics agora.', detalhe: String((e && e.message) || e).slice(0, 400) });
  }
};
