// ================================================================
// /api/comercial-funil — FICHA da oportunidade do Funil de Oportunidades
// do Comercial · SOMENTE LEITURA
//
// GET ?id=006…                     ficha de UMA oportunidade
// GET ?nome=…[&cliente=…][&fase=…]  acha a oportunidade pelo NOME e devolve
//                                   a ficha da mais provável + `busca`
//                                   (as homônimas, para a tela trocar)
//     [&fresh=1]                    ignora o cache de 1 min
//
// A lista do funil sai do Power BI do Comercial, que NÃO tem o Id do
// Salesforce: a tela manda o nome (o mesmo `Name` da Opportunity) e o
// cliente/fase da linha, que desempatam nomes repetidos. A ficha é a da
// Licitação — todos os campos pelas seções do layout do tipo de registro,
// as propostas e os itens da sincronizada (motor em ../shared/funil-sf.js).
//
// Trava: só abre negociação que NÃO seja do tipo Licitação (Id da
// Licitação devolve 404, como se não existisse). Envs opcionais:
//   FUNIL_TIPOS_REGISTRO   o(s) tipo(s) da Licitação — os que ficam de fora
//   FUNIL_TIPOS_COMERCIAL  restringe aos tipos nomeados (vazio = todos os outros)
//
// A carteira tem cliente, valor e vendedor: exige id token VALIDADO e a
// área comercial — conferida aqui mesmo com AUTH_ENFORCE desligado.
// ================================================================

const SF    = require('../shared/salesforce');
const funil = require('../shared/funil-sf');
const auth  = require('../shared/auth');
const http  = require('../shared/http');

const TTL = 60 * 1000;    // a ficha é lida sob demanda: 1 min basta
const _cache = new Map();

module.exports = async function (context, req) {
  const reply = (status, body) => {
    context.res = { status, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, http.cors(req)), body };
  };
  if (req.method === 'OPTIONS') { context.res = http.preflight(req); return; }
  if (req.method !== 'GET') { reply(405, { ok: false, error: 'Use GET.' }); return; }

  try {
    const sess = await auth.requireArea(req, 'comercial');
    if (!sess || sess.validated !== true) { reply(401, { ok: false, error: 'Não autenticado.' }); return; }
    const az = await auth.authorizedAreas(sess.user);
    if (!az || (az.areas || []).indexOf('comercial') < 0) { reply(403, { ok: false, error: 'Área restrita.' }); return; }

    if (!SF.CONFIGURED) { reply(200, { ok: true, configured: false }); return; }

    const q = req.query || {};
    const id = String(q.id || '').trim();
    const nome = String(q.nome || '').replace(/\s+/g, ' ').trim();
    if (!id && !nome) { reply(400, { ok: false, error: 'Informe o id ou o nome da oportunidade.' }); return; }

    const chave = id ? 'id|' + id : ['nome', nome, String(q.cliente || '').trim(), String(q.fase || '').trim()].join('|');
    const hit = _cache.get(chave);
    if (hit && Date.now() - hit.t < TTL && String(q.fresh || '') !== '1') { reply(200, Object.assign({}, hit.body, { cache: true })); return; }

    const sf = funil.adaptador(SF);
    let ficha;
    if (id) ficha = await funil.detalheComercial(sf, id, process.env);
    else {
      const b = await funil.acharComercial(sf, { nome: nome, cliente: q.cliente, fase: q.fase }, process.env);
      if (!b.escolhido) { reply(404, { ok: false, naoAchou: true, error: 'Nenhuma oportunidade do Comercial com este nome no Salesforce.' }); return; }
      ficha = await funil.detalheComercial(sf, b.escolhido, process.env);
      ficha.busca = { casamento: b.casamento, candidatos: b.candidatos, limite: b.limite };
    }
    ficha.geradoEm = new Date().toISOString();
    ficha.instance = await sf.instancia();   // p/ o link "abrir no Salesforce"
    _cache.set(chave, { t: Date.now(), body: ficha });
    if (_cache.size > 60) _cache.delete(_cache.keys().next().value);
    reply(200, ficha);
  } catch (err) {
    // recusa do Salesforce sai com o motivo curto (sem segredo no corpo do
    // SF); 400/404 do motor saem com a mensagem pública
    const msg = String((err && err.message) || '');
    if (/^(SF |Opportunity sem )/.test(msg)) {
      http.logError(context, 'comercial-funil/sf', err);
      reply(502, { ok: false, error: 'O Salesforce recusou a leitura.', detalhe: msg.replace(/\s+/g, ' ').slice(0, 240) });
      return;
    }
    http.sendError(context, req, 'comercial-funil', err);
  }
};
