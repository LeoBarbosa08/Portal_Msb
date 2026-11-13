// ================================================================
// /api/rastreio  —  KANBAN › RASTREIO DE ENTREGA (13/11/2026)
//
//   GET  /api/rastreio                    -> o quadro: { ok, configured, desde, fases,
//                                            ovs:[{ numero, cliente, notas, cargas,
//                                            expedidaEm, fase, rastreio, … }], rodada,
//                                            intervaloMin, brix, registro, avisos }
//   GET  /api/rastreio?atualizar=1        -> relê o Dynamics (sem o cache de 45 s)
//   POST /api/rastreio { acao: 'consultar' }
//                                         -> o ROBÔ: consulta a transportadora (Brix)
//                                            e move as entregues para Aguardando
//                                            Revisão -> { ok, brix, rodada }
//   POST /api/rastreio { acao: 'concluir', ov }  -> Aguardando Revisão -> Entregue
//   POST /api/rastreio { acao: 'reabrir', ov }   -> Entregue -> Aguardando Revisão
//
// Acesso: a ÁREA kanban (login do portal). O robô também roda pelo AGENDAMENTO
// (GitHub Actions, a cada 30 min), sem login: cabeçalho x-rastreio-chave igual
// ao RASTREIO_CHAVE das configurações do site — sem essa env, só com login.
// A chave só serve para 'consultar'.
// ================================================================

const crypto = require('crypto');
const auth = require('../shared/auth');
const http = require('../shared/http');
const K    = require('../shared/kanban-ov');
const R    = require('../shared/rastreio');

function chaveConfere(req) {
  const certa = String(process.env.RASTREIO_CHAVE || '');
  const veio = String(((req && req.headers) || {})['x-rastreio-chave'] || '');
  if (certa.length < 16 || !veio) return false;
  const a = crypto.createHash('sha256').update(certa).digest(), b = crypto.createHash('sha256').update(veio).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = async function (context, req) {
  const cors = http.cors(req);
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: cors }; return; }
  const json = (status, body) => {
    context.res = { status, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, cors), body };
  };
  try {
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    b = b || {};
    const acao = req.method === 'POST' ? String(b.acao || '') : '';
    // o agendamento: só 'consultar', só com a chave
    const peloAgendamento = acao === 'consultar' && chaveConfere(req);
    const base = peloAgendamento ? null : await auth.requireArea(req, 'kanban');
    if (!K.CONFIGURED) { json(200, { ok: true, configured: false }); return; }
    const quem = base ? { email: String((base.user && base.user.email) || '').toLowerCase(), nome: (base.user && base.user.name) || '', validado: !!base.validated } : null;

    if (req.method === 'POST') {
      if (acao === 'consultar') {
        const r = await R.rodar({ por: peloAgendamento ? 'agendamento' : (quem.email || 'tela') });
        context.log('[rastreio] consultar', JSON.stringify({ por: peloAgendamento ? 'agendamento' : quem.email, rodada: r.rodada }));
        json(200, r);
        return;
      }
      if (acao === 'concluir' || acao === 'reabrir') {
        const r = acao === 'concluir' ? await R.concluir(b.ov, quem) : await R.reabrir(b.ov, quem);
        context.log('[rastreio] ' + acao, JSON.stringify({ por: quem.email, validado: quem.validado, ov: r.ov.numero }));
        json(200, r);
        return;
      }
      throw http.badRequest('Ação desconhecida.');
    }
    const q = req.query || {};
    json(200, await R.quadro({ atualizar: q.atualizar === '1', diag: q.diag === '1' }));
  } catch (e) {
    if (e && [400, 401, 403, 404, 409].indexOf(e.status) >= 0) {
      if (e.status === 401 || e.status === 403) { http.sendError(context, req, 'rastreio', e); return; }
      json(e.status, { ok: false, error: e.publicMessage || e.message });
      return;
    }
    http.logError(context, 'rastreio', e);
    json(502, { ok: false, error: e && e.publicMessage ? e.publicMessage : 'Não foi possível ler o rastreio agora.', detalhe: String((e && e.message) || e).slice(0, 300) });
  }
};
