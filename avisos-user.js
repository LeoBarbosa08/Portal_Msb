// ================================================================
// avisos-user.js — Portal Biomedical
// Resolve o PERFIL de quem publica um aviso, a partir da identidade
// do login (MSAL / auth.js) e do grupo de segurança (AAD → área via
// /api/my-areas). O AUTOR exibido é o E-MAIL da pessoa logada.
//
// Uso:
//   window.bmAvisoUser().then(function (p) { ... })
//   p = { email, nome, displayName, sigla, setor, cat }
//     - nome  : o próprio e-mail (autor exibido)
//     - setor : nome da(s) área(s) do grupo de segurança (ou o nome da
//               pessoa, ou "Biomedical" como último recurso)
//     - sigla : iniciais para o avatar
//     - cat   : categoria de aviso sugerida (área do usuário) ou null
//
// Falha sempre de forma permissiva: se não conseguir identificar,
// devolve e-mail vazio (a página bloqueia a publicação com aviso claro)
// e NUNCA memoiza um perfil sem e-mail (deixa tentar de novo depois).
// ================================================================
(function () {
  'use strict';
  if (window.bmAvisoUser) return;

  // área (data-area) → rótulo amigável p/ o "setor"
  var CAT_LABEL = {
    comercial: 'Comercial', financeiro: 'Financeiro', logistica: 'Logística',
    marketing: 'Marketing', estoque: 'Estoque', contabil: 'Contábil',
    licitacao: 'Licitações', administrativo: 'Administrativo', produtos: 'Produtos',
    pessoas: 'Pessoas & Cultura', qualidade: 'Qualidade & Regulatório', ti: 'TI & Sistemas'
  };

  // área → categoria de aviso (só quando há correspondência direta; as
  // demais deixam a categoria no default da página, sem "chutar").
  var AREA_TO_CAT = {
    comercial: 'comercial', financeiro: 'financeiro', logistica: 'logistica',
    estoque: 'estoque', qualidade: 'qualidade', ti: 'ti', pessoas: 'pessoas'
  };

  // Iniciais p/ o avatar. Aceita "Sobrenome, Nome" (formato AD) e e-mail.
  function initials(s) {
    var n = String(s || '').trim();
    if (!n) return '';
    if (n.indexOf('@') > -1) n = n.split('@')[0].replace(/[._\-]+/g, ' ');
    if (n.indexOf(',') > -1) n = (n.split(',')[1] || n).trim();
    var p = n.split(/\s+/).filter(Boolean);
    var a = (p[0] || '')[0] || '';
    var b = p.length > 1 ? (p[p.length - 1][0] || '') : '';
    return (a + b).toUpperCase() || (n[0] || '').toUpperCase();
  }

  // Espera o auth.js definir window._portalUser (identidade do login).
  function waitUser(timeoutMs) {
    return new Promise(function (res) {
      var have = function () { return window._portalUser && window._portalUser.email; };
      if (have()) return res(window._portalUser);
      var n = 0, max = Math.ceil((timeoutMs || 30000) / 60);
      var iv = setInterval(function () {
        if (have()) { clearInterval(iv); res(window._portalUser); }
        else if (++n > max) { clearInterval(iv); res(window._portalUser || null); }
      }, 60);
    });
  }

  // Áreas do usuário (grupo de segurança). Reaproveita o cache que o
  // area-access.js grava na sessão; senão consulta /api/my-areas direto
  // (o auth.js injeta o x-portal-idtoken em toda chamada a /api/*).
  async function fetchAreas() {
    try {
      var c = JSON.parse(sessionStorage.getItem('portal_access') || 'null');
      if (c && Array.isArray(c.allowed)) return { areas: c.allowed, restricted: !!c.restricted };
    } catch (e) {}
    try {
      var r = await fetch('/api/my-areas');
      if (r.ok) {
        var j = await r.json();
        if (j && j.ok) return { areas: j.areas || [], restricted: !!j.restricted };
      }
    } catch (e) {}
    return { areas: [], restricted: false };
  }

  var _cache = null;

  window.bmAvisoUser = async function () {
    if (_cache) return _cache;

    var u = await waitUser();
    var email = (u && u.email) || '';
    var displayName = (u && u.name) || email;

    var setor = '', cat = null;
    if (email) {
      try {
        var az = await fetchAreas();
        // Só usamos as áreas p/ "afirmar de quem é a publicação" quando o
        // usuário é RESTRITO (pertence a grupos de área). Diretoria/TI/BI
        // (sem restrição) caem no nome da pessoa — não faz sentido listar
        // as 12 áreas como "setor".
        if (az.restricted && az.areas && az.areas.length) {
          setor = az.areas.map(function (a) { return CAT_LABEL[a] || a; }).slice(0, 2).join(' · ');
          cat = AREA_TO_CAT[az.areas[0]] || null;
        }
      } catch (e) {}
    }
    if (!setor) setor = (displayName && displayName !== email) ? displayName : 'Biomedical';

    var prof = {
      email: email,
      nome: email || 'Usuário Portal',   // AUTOR exibido = e-mail (requisito)
      displayName: displayName,
      sigla: initials(displayName || email) || 'US',
      setor: setor,
      cat: cat
    };
    if (email) _cache = prof;            // memoiza só quando identificou de fato
    return prof;
  };
})();
