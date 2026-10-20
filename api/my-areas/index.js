// ================================================================
// /api/my-areas — Portal Biomedical
// Devolve as áreas que o usuário LOGADO pode ver (para o front esconder
// cards / bloquear páginas). A identidade e a autorização agora vêm do
// módulo compartilhado api/shared/auth.js, que:
//   - VERIFICA a assinatura do id token do Entra (não confia mais em
//     x-portal-oid/email nem em JWT sem validação);
//   - consulta os grupos AAD via app-only (com cache) validando o OID
//     como GUID antes de montar a URL do Graph (sem SSRF);
//   - aplica o mapa grupo→área no servidor.
//
// Rollout faseado: enquanto AUTH_ENFORCE != "true", cai no comportamento
// legado (headers) sem bloquear. Detalhes em api/shared/auth.js.
//
// Resposta: { ok, email, name, areas:[...], modulos:[...], restricted,
//             reason, validated }
// `modulos` = páginas avulsas liberadas SEM abrir a área inteira. Neste
// portal (só Comercial + Estoque) a única origem é o mapa GRUPO_MODULOS do
// auth.js (por grupo do Entra). O front usa a lista para deixar passar só
// essas páginas.
// ================================================================

const auth = require('../shared/auth');
const http = require('../shared/http');
const acessoLog = require('../shared/acesso-log');

const FN_VERSION = '2026-10-14b-lider-indicadores-area-compras';

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = http.preflight(req); return; }
  try {
    const { user, validated } = await auth.requireUser(req);
    const az = await auth.authorizedAreas(user);

    // RECORTE COMERCIAL + ESTOQUE: o portal completo soma aqui dois módulos
    // avulsos — o convite da Votação OKR (Diretoria) e o líder de área dos
    // Indicadores (Gerencial). Nenhuma das duas áreas existe neste portal,
    // então os dois blocos saíram.

    // LOG DE ENTRADA — grava o acesso no blob dedicado (best-effort).
    // registrar() nunca lança (try/catch + timeout internos); este await
    // só garante que a linha seja gravada antes da Function encerrar.
    try {
      await acessoLog.registrar(req, {
        email: user.email, name: user.name, oid: user.oid,
        validated: validated, restricted: az.restricted, reason: az.reason,
        areas: az.areas, modulos: az.modulos
      });
    } catch (e) { /* nunca quebra o my-areas */ }

    context.res = {
      status: 200,
      headers: Object.assign({ 'Content-Type': 'application/json' }, http.cors(req)),
      body: {
        ok: true,
        email: user.email,
        name: user.name || '',
        areas: az.areas,
        modulos: az.modulos || [],
        restricted: az.restricted,
        reason: az.reason,
        validated: validated,
        version: FN_VERSION
      }
    };
  } catch (err) {
    http.sendError(context, req, 'my-areas', err);
  }
};
