// ================================================================
// /api/kanban-ov  —  área KANBAN › Ordens do Dia
//
// As ordens de venda da MSB criadas no dia, lidas AO VIVO do Dynamics F&O
// (BIOSalesOrderHeaderV1 + SalesOrderHeadersV3/V2, juntas pelo número da
// OV; valor pelas linhas). O motor e o porquê de cada escolha estão em
// api/shared/kanban-ov.js.
//
//   GET /api/kanban-ov                 -> o QUADRO (09/11/2026): as OVs em aberto
//                                         de qualquer data + as com nota HOJE + as
//                                         faturadas com a carga Carregado (10/11/26:
//                                         o Faturado sem data)
//                                         12/11/26: SEM período — de/ate/data são
//                                         ignorados (uma página antiga em cache que
//                                         ainda mande o período não dá erro)
//   GET /api/kanban-ov?modo=dia&data=… -> o modo antigo: as OVs CRIADAS no dia
//   GET /api/kanban-ov?atualizar=1     -> ignora o cache de 15 s
//   GET /api/kanban-ov?diag=1          -> + colunas das entidades
//   -> { ok, configured, empresa, data, fontes, etapas, canceladas,
//        depositos (só ALMOX-PA: KANBAN_DEPOSITOS), foraDeposito, statusCols,
//        statusPadrao, ovs:[{ …, etapa, regra:{ …, credito*, trabalho }, trabalhos:[…] }],
//        avisos, diagnostico }
//   POST /api/kanban-ov { acao: 'enviar-pallet', carga: 'LD-…', ov: 'OV…' }
//                                      -> 11/11/26: DESLIGADO (410) — o botão saiu da
//                                         ficha; KANBAN_PALLET_BOTAO=1 religa. Ligado:
//                                         grava ENVIARPALLET_CUSTOM = Sim na carga
//                                         (exige o login VALIDADO; fica no log) e
//                                         relê para conferir: { confirmado, leitura, aviso }
//   POST /api/kanban-ov { acao: 'email-cotacao', ov: 'OV…', enviar: false|true }
//                                      -> 12/11/26: o e-mail da Cotação da OV — a prévia
//                                         ou o envio já (login validado) para os
//                                         destinatários do Azure (kanban-email.js)
//   GET /api/kanban-ov?ov=OV017525     -> as linhas da OV (a ficha do painel)
//   -> { ok, configured, numero, entidade, linhas:[{ linha, item, produto,
//        qtd, un, preco, desconto, descPct, valor, status, entrega,
//        confirmada, deposito }] }
//
// Acesso: a ÁREA kanban. Nasceu RESERVADA às contas do dono; desde
// 09/11/2026 é ABERTA a qualquer pessoa autenticada do domínio
// (AREAS_ABERTAS em api/shared/auth.js).
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
    const base = await auth.requireArea(req, 'kanban');
    if (!K.CONFIGURED) { json(200, { ok: true, configured: false }); return; }
    // ── ESCRITA: "Enviar para o Pallet" (09/11/2026) ──
    if (req.method === 'POST') {
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
      b = b || {};
      // 12/11/26 (dono): o E-MAIL DA COTAÇÃO pela ficha — prévia (enviar: false) ou
      // envio já (enviar: true) para os destinatários do Azure (KANBAN_EMAIL_PARA);
      // ninguém escolhe para quem vai. Enviar exige o login VALIDADO.
      if (String(b.acao || '') === 'email-cotacao') {
        const quem = String((base.user && base.user.email) || '').toLowerCase();
        if (b.enviar && !base.validated) { const e = new Error('Para enviar o e-mail é preciso o login validado. Saia e entre de novo no portal.'); e.status = 403; e.publicMessage = e.message; throw e; }
        try {
          const r = await K.emailCotacao(b.ov, { enviar: !!b.enviar, por: quem });
          if (b.enviar) context.log('[kanban-ov] email-cotacao', JSON.stringify({ por: quem, ov: r.ov, para: r.enviado && r.enviado.para, caixas: r.caixas }));
          json(200, r);
        } catch (e) {
          if (b.enviar) context.log('[kanban-ov] email-cotacao recusado', JSON.stringify({ por: quem, ov: String(b.ov || '').slice(0, 40), erro: String(e.message || e).slice(0, 300) }));
          if (e && [400, 404, 409, 502].indexOf(e.status) >= 0) { json(e.status, { ok: false, error: e.message }); return; }
          throw e;
        }
        return;
      }
      if (String(b.acao || '') !== 'enviar-pallet') throw http.badRequest('Ação desconhecida.');
      // 11/11/26 (dono: "retira o BOTÃO ENVIAR PARA O PALLET"): a ficha não tem mais o
      // botão e o Kanban não grava no Dynamics — o envio fica DESLIGADO
      // (KANBAN_PALLET_BOTAO=1 religa, junto com o botão de volta na tela)
      if (String(process.env.KANBAN_PALLET_BOTAO || '').trim() !== '1') {
        json(410, { ok: false, error: 'O envio ao Pallet pelo portal foi desativado: marque ' + 'ENVIARPALLET_CUSTOM = Sim na carga, no Dynamics.' });
        return;
      }
      // gravar no Dynamics só com o login VALIDADO (com o enforce desligado a
      // identidade vem de cabeçalho e qualquer um forjaria o e-mail)
      if (!base.validated) { const e = new Error('Para gravar no Dynamics é preciso o login validado. Saia e entre de novo no portal.'); e.status = 403; e.publicMessage = e.message; throw e; }
      const email = String((base.user && base.user.email) || '').toLowerCase();
      try {
        const r = await K.enviarParaPallet(b.carga);
        context.log('[kanban-ov] enviar-pallet', JSON.stringify({ por: email, carga: r.carga, ov: String(b.ov || '').slice(0, 40), ja: !!r.ja, entidade: r.entidade, coluna: r.coluna, confirmado: r.confirmado, leitura: r.leitura }));
        json(200, r);
      } catch (e) {
        context.log('[kanban-ov] enviar-pallet recusado', JSON.stringify({ por: email, carga: String(b.carga || '').slice(0, 40), erro: String(e.message || e).slice(0, 300) }));
        if (e && (e.status === 400 || e.status === 404 || e.status === 409)) { json(e.status, { ok: false, error: e.message }); return; }
        throw e;
      }
      return;
    }
    const q = req.query || {};
    // ?ov=OV017525 -> as linhas da OV (a ficha do painel lê ao abrir)
    const ov = String(q.ov || '').trim();
    if (ov) {
      if (!/^[A-Za-z0-9._-]{3,40}$/.test(ov)) throw http.badRequest('Número de OV inválido.');
      json(200, await K.linhasDaOv(ov, { atualizar: q.atualizar === '1' }));
      return;
    }
    const flags = { atualizar: q.atualizar === '1', diag: q.diag === '1' };
    if (String(q.modo || '') === 'dia') {
      const data = String(q.data || '').trim();
      if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw http.badRequest('Data inválida: use AAAA-MM-DD.');
      json(200, await K.ordensDoDia(Object.assign({ data }, flags)));
      return;
    }
    // 12/11/26 (dono: "remove o período… tem que mostrar tudo" — e o erro "Período
    // grande demais: no máximo 1 ano"): o quadro não tem mais período; de/ate/data
    // são ignorados, sem validar
    json(200, await K.quadro(flags));
  } catch (e) {
    if (e && (e.status === 401 || e.status === 403 || e.status === 400)) { http.sendError(context, req, 'kanban-ov', e); return; }
    // o motivo do Dynamics volta na resposta (é o diagnóstico da tela)
    http.logError(context, 'kanban-ov', e);
    json(502, { ok: false, error: req.method === 'POST' ? 'Não foi possível gravar no Dynamics agora.' : 'Não foi possível ler o Dynamics agora.', detalhe: String((e && e.message) || e).slice(0, 400) });
  }
};
