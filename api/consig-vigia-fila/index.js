// ================================================================
// /api/consig-vigia-fila — Vigia de Consignação · fila de aprovação
//
// GET                                  -> devolve a fila (browser)
// POST { id, status, motivo }          -> decisão do OPERADOR
//        status ∈ pendente | aprovado | executado | descartado
//
// A fila é a defesa contra falso positivo. Como o modelo NÃO tem campo de
// "lote reservado para cirurgia agendada" (confirmado com o usuário em
// 25/08/26), nenhum item vira ação sem um humano aprovar — e o descarte é
// LEMBRADO por VIGIA_DESCARTE_TTL dias (default 90) antes de voltar a cobrar.
//
// Env: VIGIA_BLOB_URL. Sem ela, GET devolve fila vazia com configured:false e
// o POST recusa com 409 (não existe onde gravar a decisão).
// ================================================================

const blob   = require('../shared/vigia-blob');
const regras = require('../shared/consig-regras');
const auth   = require('../shared/auth');
const http   = require('../shared/http');

const FILA = 'fila.json';
const VAZIA = { atualizadoEm: null, itens: [], resumo: null };

module.exports = async function (context, req) {
  const reply = (status, body) => {
    context.res = { status, headers: Object.assign({ 'Content-Type': 'application/json' }, http.cors(req)), body };
  };
  if (req.method === 'OPTIONS') { context.res = http.preflight(req); return; }

  try {
    const sess = await auth.requireArea(req, 'estoque');
    const operador = (sess && sess.user && (sess.user.email || sess.user.name)) || 'operador';

    if (req.method === 'GET') {
      // ?resumo=1 -> só os contadores, sem os itens. É o que o badge do menu
      // lateral consome em TODA página do portal; mandar a fila inteira (até
      // 2.000 itens com carteira e valor) só para escrever um número seria
      // caro e exporia dado que aquela tela nem mostra.
      const soResumo = String((req.query && (req.query.resumo || req.query.summary)) || '') === '1';
      if (!blob.configurado()) {
        reply(200, soResumo
          ? { ok: true, configured: false, atualizadoEm: null, pendentes: 0, vencidos: 0, custoEmRisco: 0, contagem: {} }
          : Object.assign({ ok: true, configured: false }, VAZIA));
        return;
      }
      // Blob inacessível não pode derrubar a tela: degrada como "sem
      // persistência" e devolve o motivo para o operador poder consertar.
      let fila;
      try { fila = await blob.lerJson(FILA, VAZIA); }
      catch (e) {
        const d = blob.diagnostico(e);
        if (!d) throw e;
        http.logError(context, 'consig-vigia-fila/blob', e);
        reply(200, Object.assign({ ok: true, configured: false, blobErro: d },
          soResumo ? { atualizadoEm: null, pendentes: 0, vencidos: 0, custoEmRisco: 0, contagem: {} } : VAZIA));
        return;
      }
      if (soResumo) {
        const itens = fila.itens || [];
        const pend = itens.filter(x => x && x.status === 'pendente');
        const contagem = {};
        regras.STATUS_OK.forEach(st => { contagem[st] = itens.filter(x => x && x.status === st).length; });
        reply(200, {
          ok: true, configured: true, atualizadoEm: fila.atualizadoEm || null,
          pendentes: pend.length,
          vencidos: pend.filter(x => x.classe === 'vencido').length,
          custoEmRisco: Math.round(pend.reduce((a, x) => a + (Number(x.custoEmRisco) || 0), 0)),
          contagem
        });
        return;
      }
      reply(200, Object.assign({ ok: true, configured: true }, fila));
      return;
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const id = String(b.id || '').trim();
      const status = String(b.status || '').trim().toLowerCase();
      if (!id) throw http.badRequest('mande { id, status }.');
      if (regras.STATUS_OK.indexOf(status) < 0) throw http.badRequest('status inválido: use ' + regras.STATUS_OK.join(' | ') + '.');
      if (!blob.configurado()) { reply(409, { ok: false, error: 'Persistência desligada: configure VIGIA_BLOB_URL para registrar decisões.' }); return; }

      const fila = await blob.lerJson(FILA, VAZIA);
      const e = (fila.itens || []).find(x => x && x.id === id);
      if (!e) { reply(404, { ok: false, error: 'Item não está na fila.' }); return; }

      // guarda a decisão anterior antes de sobrescrever (auditoria + Fase 4)
      if (e.status && e.status !== status) {
        e.historico = (e.historico || []).concat([{ em: e.decididoEm || null, status: e.status, motivo: e.motivo || null, operador: e.operador || null }]);
      }
      e.status = status;
      e.decididoEm = new Date().toISOString();
      e.operador = operador;
      e.motivo = b.motivo ? String(b.motivo).slice(0, 300) : null;
      if (status === 'pendente') { e.decididoEm = null; e.operador = null; e.motivo = null; }

      fila.atualizadoEm = new Date().toISOString();
      if (fila.resumo) {
        const contagem = {};
        regras.STATUS_OK.forEach(st => { contagem[st] = fila.itens.filter(x => x.status === st).length; });
        fila.resumo.contagem = contagem;
      }
      await blob.gravarJson(FILA, fila);
      reply(200, { ok: true, item: e, atualizadoEm: fila.atualizadoEm });
      return;
    }

    reply(405, { ok: false, error: 'Use GET ou POST.' });
  } catch (err) {
    http.sendError(context, req, 'consig-vigia-fila', err);
  }
};
