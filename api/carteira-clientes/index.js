// ================================================================
// /api/carteira-clientes — CARTEIRA DE CLIENTES (Comercial) · ESPELHO MSB
// Dynamics 365 × Salesforce, cruzados pelo CNPJ. SÓ LEITURA.
//
// Trazida do portal completo em 27/11/2026 (origin/master e6ac11c de
// Claude.rep) — pedido do dono: "a carteira de clientes toda, só que eles
// não podem criar conta: é apenas um espelho". O motor
// (../shared/carteira-clientes.js) é o MESMO arquivo do completo, sem
// mudança: a mesma carteira, o mesmo cruzamento e, com o mesmo blob, a
// mesma carteira montada.
//
// RECORTE MSB — o que esta rota faz (tudo GET):
//   GET                    a carteira inteira (pacote enxuto: colunas +
//                          dicionário) com o resumo do cruzamento e o
//                          estado de cada fonte; pode responder
//                          { carregando } na primeira carga de uma
//                          instância fria — a tela pergunta de novo
//       [&fresh=1]         o botão Atualizar: recarrega as duas fontes
//   GET ?ficha=<chave>     a ficha de UM cliente, lida na hora nas fontes
//       [&leve=1][&contatos=1]
//   GET ?busca=<termo>     a busca por TUDO do cliente (e-mail, telefone,
//                          contatos, oportunidades…)
//   GET ?arquivo=<id>&pai=<conta>
//                          o arquivo/nota da conta, lido pelo portal
//   GET ?diag=1            o que cada fonte resolveu e o estado do blob
//
// O que NÃO veio (fica só no portal completo): a NOVA CONTA no Salesforce,
// novo CONTATO, ANEXAR arquivo, INCLUIR DESCRIÇÃO e o PEDIDO DE CADASTRO NO
// ERP — todo POST (o function.json nem aceita POST; 405 aqui por garantia) e
// as leituras que só servem a esses formulários (?conta, ?modeloConta, ?cep,
// ?modeloContato, ?erpConferir: 403). O histórico dos pedidos de cadastro
// no ERP feitos no completo aparece na ficha (../shared/carteira-erp-leitura.js,
// só leitura). Sem `sfInstance`: a tela não leva link para o Salesforce.
//
// Acesso: id token VALIDADO e a área comercial — conferidos aqui mesmo com
// AUTH_ENFORCE desligado (a carteira tem cliente, dono da conta e
// oportunidade), como no /api/comercial-funil.
// ================================================================

const C    = require('../shared/carteira-clientes');
const ERP  = require('../shared/carteira-erp-leitura');
const D    = require('../shared/d365');
const SF   = require('../shared/salesforce');
const auth = require('../shared/auth');
const http = require('../shared/http');

// o estado das fontes SEM o mapa de colunas (vai só no ?diag=1)
function fontesPublicas(f) {
  const out = {};
  Object.keys(f || {}).forEach(function (k) {
    const x = Object.assign({}, f[k]);
    delete x.colunas; delete x.campos;
    out[k] = x;
  });
  return out;
}

// RECORTE MSB: os parâmetros dos formulários de escrita do completo
const SO_ESCRITA_1 = ['modeloConta', 'modeloContato'];
const SO_ESCRITA_VALOR = ['conta', 'cep', 'erpConferir', 'novaConta'];
function pedidoDeEscrita(q) {
  return SO_ESCRITA_1.some((k) => String(q[k] || '') === '1') ||
    SO_ESCRITA_VALOR.some((k) => q[k] != null && String(q[k]).trim() !== '');
}
const MSG_ESPELHO = 'No portal da MSB a Carteira de Clientes é só consulta: conta nova, contato, arquivo, descrição e pedido de cadastro no ERP não são feitos por aqui.';

module.exports = async function (context, req) {
  const reply = (status, body) => {
    context.res = { status, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, http.cors(req)), body };
  };
  if (req.method === 'OPTIONS') { context.res = http.preflight(req); return; }
  // RECORTE MSB: espelho — nada de POST (nova conta, contato, arquivo, descrição, ERP)
  if (req.method !== 'GET') { reply(405, { ok: false, espelho: true, error: MSG_ESPELHO }); return; }

  try {
    const q = req.query || {};
    const sess = await auth.requireArea(req, 'comercial');
    if (!sess || sess.validated !== true) { reply(401, { ok: false, error: 'Não autenticado.' }); return; }
    const az = await auth.authorizedAreas(sess.user);
    if (!az || (az.areas || []).indexOf('comercial') < 0) { reply(403, { ok: false, error: 'Área restrita.' }); return; }

    if (pedidoDeEscrita(q)) { reply(403, { ok: false, espelho: true, error: MSG_ESPELHO }); return; }

    const configured = { d365: !!D.CONFIGURED, sf: !!SF.CONFIGURED };
    if (!configured.d365 && !configured.sf) { reply(200, { ok: true, configured: false, espelho: true, fontesConfiguradas: configured }); return; }

    // ── arquivo/nota da conta, lido pelo portal ────────────────────
    if (q.arquivo != null && String(q.arquivo).trim() !== '') {
      let arq;
      try { arq = await C.arquivoConta(q.pai, q.arquivo); }
      catch (e) {
        if (e && e.status >= 400 && e.status < 500 && e.publicMessage) { reply(e.status, { ok: false, error: e.publicMessage }); return; }
        throw e;
      }
      const nomeAscii = arq.nome.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
      context.res = {
        status: 200, isRaw: true, body: arq.buf,
        headers: Object.assign({
          'Content-Type': arq.tipo,
          'Content-Disposition': (arq.inline ? 'inline' : 'attachment') + '; filename="' + nomeAscii + '"; filename*=UTF-8\'\'' + encodeURIComponent(arq.nome),
          'Content-Length': String(arq.buf.length),
          'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"
        }, http.cors(req))
      };
      return;
    }

    // ── busca por tudo do cliente ──────────────────────────────────
    if (q.busca != null && String(q.busca).trim() !== '') {
      reply(200, await C.buscar(String(q.busca), function (secao, e) { http.logError(context, 'carteira-clientes/' + secao, e); }));
      return;
    }

    // ── ficha de um cliente ────────────────────────────────────────
    if (q.ficha != null && String(q.ficha).trim() !== '') {
      const leve = String(q.leve || '') === '1';
      const f = await C.fichaCliente(String(q.ficha), function (secao, e) { http.logError(context, 'carteira-clientes/ficha/' + secao, e); },
        { leve: leve, contatos: String(q.contatos || '') === '1' });
      // o histórico dos pedidos de cadastro no ERP feitos no portal completo (só leitura)
      if (!leve) f.erp = await ERP.estado((f.cliente && f.cliente.k) || f.chave).catch(function () { return null; });
      f.espelho = true;
      reply(200, f);
      return;
    }

    // ── diagnóstico da carga ───────────────────────────────────────
    if (String(q.diag || '') === '1') {
      const b = C.baseAtual();
      reply(200, {
        ok: true, espelho: true, fontesConfiguradas: configured, carregada: !!b,
        geradoEm: b ? b.geradoEm : null, msCarga: b ? b.msCarga : null,
        fontes: b ? b.fontes : null, resumo: b ? b.resumo : null,
        blob: C.estadoBlob()
      });
      return;
    }

    // ── a carteira inteira ─────────────────────────────────────────
    const r = await C.obterBase({ forcar: String(q.fresh || '') === '1' });
    if (r.carregando) { reply(200, { ok: true, carregando: true, espelho: true, desde: r.desde, fontesConfiguradas: configured }); return; }
    const b = r.base;
    reply(200, {
      ok: true, espelho: true, fontesConfiguradas: configured,
      geradoEm: b.geradoEm, atualizando: !!r.atualizando, parcial: b.parcial,
      fontes: fontesPublicas(b.fontes), resumo: b.resumo, alertas: C.ALERTAS,
      // RECORTE MSB: sem sfInstance — nenhum link da tela leva ao Salesforce
      sfInstance: null,
      eu: String((sess.user && sess.user.email) || '').toLowerCase(),
      erpPedidos: await ERP.resumoLista().catch(function () { return {}; }),
      pacote: b.pacote
    });
  } catch (err) {
    const msg = String((err && err.message) || '');
    if (err && err.naoConfigurado) { reply(200, { ok: true, configured: false, espelho: true }); return; }
    // recusa das fontes sai com o motivo curto (sem segredo nem corpo inteiro)
    if (/^(SF |CRM |F&O |Dynamics:|token |o Dynamics|o Salesforce|o CRM|Salesforce)/.test(msg)) {
      http.logError(context, 'carteira-clientes/fonte', err);
      reply(502, { ok: false, error: 'Uma das fontes recusou a leitura.', detalhe: msg.replace(/\s+/g, ' ').replace(/Salesforce|\bSF\b/g, 'CRM').slice(0, 240) });
      return;
    }
    http.sendError(context, req, 'carteira-clientes', err);
  }
};
