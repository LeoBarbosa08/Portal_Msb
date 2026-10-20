// ================================================================
// area-access.js — Portal Biomedical
// Filtra os cards de Área e os resultados da busca conforme os grupos
// do Azure AD da pessoa, consultados no backend /api/my-areas.
//
// FAIL-CLOSED (mudança de 20/08/26). A versão anterior chamava showAll()
// em TODO caminho de erro — inclusive num "timeout aguardando login" de
// 12s que estourava antes do login concluir. Resultado: quem só tinha
// Comercial e Estoque via os 12 departamentos até clicar em algo e voltar.
// Agora:
//   • os cards começam ESCONDIDOS e só aparecem com decisão do backend;
//   • qualquer incerteza (sem token, HTTP, rede, payload) NÃO libera nada;
//   • a decisão roda com a TELA DE LOGIN ainda por cima (porta de acesso
//     registrada em window.__bmGates) — o portal só aparece já filtrado;
//   • nenhum popup: o token sai do broker do auth.js (silent → ssoSilent →
//     redirect), então no celular não aparece mais o aviso de pop-up.
// ================================================================
(function () {
  'use strict';

  // Só o ID TOKEN interessa: o backend usa o token para IDENTIFICAR a pessoa
  // (oid/email) e consulta os grupos via app-only. Pedir só openid/profile faz
  // o acquireTokenSilent acertar praticamente sempre — era o escopo do Graph
  // que derrubava o silent e caía no popup.
  const SCOPES  = ['openid', 'profile'];
  const ENDPOINT = '/api/my-areas';
  const TAG      = '[AreaAccess]';
  const TIMEOUT  = 12000;   // por tentativa de HTTP
  const TENTATIVAS = 2;


  // ── Area de cada pagina (ESPELHO do MAPA em nav-sidebar.js) ───
  // Paginas cujo NOME DE ARQUIVO nao comeca pela area precisam ser
  // declaradas aqui. Sem isso, o card de "Sistemas & Links", os atalhos de
  // "Continue de onde parou" e a busca do portal ofereciam modulos de outro
  // departamento — o caso mais visivel era a Cobranca Automatica (Financeiro)
  // aparecendo para todo mundo. Mais de uma area = "qualquer uma serve".
  // AO CRIAR PAGINA NOVA sem prefixo de area, declare NOS DOIS arquivos.
  const AREAS_IDS = ['comercial', 'financeiro', 'logistica', 'marketing', 'estoque',
    'contabil', 'licitacao', 'administrativo', 'produtos', 'pessoas', 'qualidade', 'ti',
    'diretoria', 'vendedor', 'gerencial', 'atendimento', 'compras'];
  const EXTRA = {
    'cobranca-automatica':       ['financeiro'],
    'cobranca-notas':            ['financeiro'],
    'lici':                      ['licitacao'],
    'lici-relatorio':            ['licitacao'],
    'pedido-inteligente':        ['comercial'],
    'pi-pedido-teste':           ['comercial'],
    'pi-cotacao':                ['comercial', 'licitacao'],
    'pi-consignacao':            ['comercial', 'estoque'],
    'pi-consignacao-incompleto': ['comercial', 'estoque'],
    'inventario':                ['estoque'],
    'agente-administrativo':     ['administrativo'],
    'agente-chat':               ['comercial'],
    'agente-comercial':          ['comercial'],
    'agente-contabil':           ['contabil'],
    'agente-estoque':            ['estoque'],
    'agente-financeiro':         ['financeiro'],
    'agente-licitacao':          ['licitacao'],
    'agente-logistica':          ['logistica'],
    'agente-marketing':          ['marketing'],
    'agente-pedidos':            ['comercial'],
    'agente-produtos':           ['produtos'],
    'agente-qualidade':          ['qualidade'],
    'agente-rh':                 ['pessoas'],
    'agente-ti':                 ['ti'],
    'agente-voz':                ['financeiro'],
    // enderecos antigos do Customer Service (hoje so redirecionam p/ atendimento*)
    'comercial-customer-service': ['atendimento'],
    'comercial-cs-casos':        ['atendimento']
  };

  // href -> id da pagina (nome do arquivo, sem .html) ou '' se nao houver
  function fileOf(href) {
    const h = String(href || '');
    if (!h || h.charAt(0) === '#') return '';
    return h.split('/').pop().split('#')[0].split('?')[0].replace(/\.html$/i, '').toLowerCase();
  }

  // href -> array de areas (qualquer uma libera) ou null se a pagina nao
  // pertence a area nenhuma (avisos, offline, ancoras...).
  function areasDoHref(href) {
    const f = fileOf(href);
    if (!f) return null;
    if (EXTRA[f]) return EXTRA[f];
    for (let i = 0; i < AREAS_IDS.length; i++) {
      const a = AREAS_IDS[i];
      if (f === a || f.indexOf(a + '-') === 0) return [a];
    }
    return null;
  }
  window.bmAreasDoHref = areasDoHref;

  // ── Modulos avulsos (GRUPO_MODULOS do backend) ────────────────
  // Grant cirurgico: a pessoa NAO tem a area, mas pode abrir estas paginas
  // (ex.: Coordenacao de Compras/Estoque so na Margem de Contribuicao, que
  // e' do Contabil). Chega em /api/my-areas -> j.modulos.
  // A VISAO GERAL do departamento entra junto como porta de entrada: sem ela
  // nao havia como chegar no modulo pela home. Os cards de la sao podados
  // pelo nav-sidebar.js, entao so o modulo liberado fica a' vista.
  window.bmDeptsPorModulo = function () {
    const out = new Set();
    const m = window._allowedModulos;
    if (!m || !m.size) return out;
    m.forEach(function (id) {
      const a = areasDoHref(id + '.html');
      if (a) a.forEach(function (x) { out.add(x); });
    });
    return out;
  };

  window.bmModuloPermitido = function (href) {
    const m = window._allowedModulos;
    if (!m || !m.size) return false;
    const f = fileOf(href);
    if (!f) return false;
    if (m.has(f)) return true;
    return window.bmDeptsPorModulo().has(f);   // 'contabil' = visao geral do dept
  };

  // Pode mostrar este link? undefined = acesso ainda nao decidido (nao mostra),
  // null = sem restricao (mostra), Set = restrito (any-of das areas da pagina).
  window.bmHrefPermitido = function (href, ext) {
    if (ext) return true;                         // link externo (Outlook, Power BI...)
    const areas = areasDoHref(href);
    if (!areas) return true;                      // pagina sem area
    const allow = window._allowedAreas;
    if (typeof allow === 'undefined') return false;
    if (!allow) return true;
    for (let i = 0; i < areas.length; i++) if (allow.has(areas[i])) return true;
    return window.bmModuloPermitido(href);      // liberacao por MODULO avulso
  };

  // Cards de "Sistemas & Links" que apontam para pagina INTERNA do portal.
  // REMOVE do DOM em vez de esconder: o filtro de abas do index reatribui
  // display='' e traria o card de volta.
  function filtrarSistemas() {
    Array.prototype.slice.call(document.querySelectorAll('#sistemas-grid .sistema-card'))
      .forEach(function (c) {
        if (c.getAttribute('target') === '_blank') return;
        if (window.bmHrefPermitido(c.getAttribute('href'), false)) c.style.display = '';
        else c.remove();
      });
  }

  function cards() {
    return Array.prototype.slice.call(document.querySelectorAll('.area-card[data-area]'));
  }

  // ── Esconde JÁ, antes de qualquer coisa ────────────────────────
  // (a grade também está com opacity:0 pelo .acesso-pendente do index; aqui
  // garantimos display:none por card, que é o que a busca/o drawer leem)
  function esconderTudo() {
    cards().forEach(function (c) { c.style.display = 'none'; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', esconderTudo);
  else esconderTudo();

  // grava o resultado na sessão p/ o guard das páginas internas (nav-sidebar.js)
  // decidir na hora, sem novo token/HTTP. NUNCA grava resultado de falha.
  function cache(restricted, allowed, modulos) {
    try {
      sessionStorage.setItem('portal_access', JSON.stringify({
        restricted: !!restricted, allowed: allowed || [], modulos: modulos || [], t: Date.now()
      }));
    } catch (e) {}
  }

  function pronto(detail) {
    document.body && document.body.classList.remove('acesso-pendente');
    document.dispatchEvent(new CustomEvent('areaaccess:ready', { detail: detail }));
  }

  // ── Aplica a decisão do backend ───────────────────────────────
  function aplicar(areas, restricted, reason, modulos) {
    const allow = new Set(areas || []);
    window._allowedAreas   = restricted ? allow : null;
    window._allowedModulos = new Set(restricted ? (modulos || []) : []);
    // dept que a pessoa alcanca SO por modulo avulso: o card aparece para
    // servir de porta de entrada (la dentro so o modulo liberado sobrevive).
    const porModulo = window.bmDeptsPorModulo();
    cards().forEach(function (c) {
      const a = c.getAttribute('data-area');
      c.style.display = (allow.has(a) || porModulo.has(a)) ? '' : 'none';
    });
    filtrarSistemas();               // Cobranca Automatica & cia (paginas internas)
    cache(restricted, Array.from(allow), Array.from(window._allowedModulos));
    console.log(TAG, restricted ? 'RESTRITO' : 'sem restrição', '·', reason,
      '· áreas=[' + Array.from(allow).join(', ') + ']',
      window._allowedModulos.size ? '· módulos=[' + Array.from(window._allowedModulos).join(', ') + ']' : '');
    pronto({ restricted: !!restricted, allowed: Array.from(allow), modulos: Array.from(window._allowedModulos) });
  }

  // ── Falhou: não libera NADA ───────────────────────────────────
  function negar(motivo) {
    esconderTudo();
    window._allowedAreas   = new Set();   // busca/drawer também ficam vazios
    window._allowedModulos = new Set();
    filtrarSistemas();                  // e nenhum modulo interno em "Sistemas"
    // não gravamos cache: falha aqui não deve trancar as páginas internas,
    // que fazem a própria consulta.
    console.error(TAG, '🔒 acesso NÃO confirmado →', motivo, '· nada foi liberado');
    avisar(motivo);
    pronto({ restricted: true, allowed: [], erro: motivo });
  }

  // aviso visível no lugar da grade, com botão de tentar de novo
  function avisar(motivo) {
    var grid = document.querySelector('.areas-grid');
    var alvo = (grid && grid.parentNode) || document.getElementById('areas');
    if (!alvo || document.getElementById('aa-erro')) return;
    var box = document.createElement('div');
    box.id = 'aa-erro';
    box.style.cssText = 'margin:18px 0;padding:18px 20px;border-radius:14px;background:#FEF3C7;'
      + 'border:1px solid #FCD34D;color:#78350F;font-size:14.5px;line-height:1.55;';
    box.innerHTML = '<strong>Não foi possível confirmar seu perfil de acesso.</strong><br>'
      + 'Por segurança os departamentos não foram exibidos. Recarregue a página; '
      + 'se continuar, avise a TI. <span style="opacity:.7">(' + String(motivo).replace(/</g, '&lt;') + ')</span>'
      + '<br><button type="button" id="aa-retry" style="margin-top:12px;border:none;border-radius:9px;'
      + 'padding:9px 20px;font-size:14px;font-weight:600;background:#78350F;color:#fff;cursor:pointer;">'
      + 'Tentar de novo</button>';
    alvo.insertBefore(box, grid || null);
    var b = document.getElementById('aa-retry');
    if (b) b.addEventListener('click', function () { location.reload(); });
  }

  // ── Token: só pelo broker do auth.js (nunca popup) ────────────
  async function idToken() {
    if (typeof window.portalToken === 'function') {
      const r = await window.portalToken(SCOPES, { noPopup: true });
      if (r && r.idToken) return r.idToken;
      throw new Error('broker sem idToken');
    }
    // fallback: broker ainda não instalado → silent puro, sem popup
    const inst = window._msalAuth;
    if (!inst) throw new Error('msal-not-ready');
    const acct = (inst.getActiveAccount && inst.getActiveAccount())
              || (inst.getAllAccounts && inst.getAllAccounts()[0]);
    if (!acct) throw new Error('sem conta');
    const r = await inst.acquireTokenSilent({ scopes: SCOPES, account: acct });
    if (!r || !r.idToken) throw new Error('silent sem idToken');
    return r.idToken;
  }

  async function consultar(token, claims, username) {
    const ctrl = ('AbortController' in window) ? new AbortController() : null;
    const t = ctrl && setTimeout(function () { ctrl.abort(); }, TIMEOUT);
    try {
      // O SWA descarta o Authorization — a identidade vai em headers CUSTOM,
      // que o SWA repassa: x-portal-idtoken/oid/email.
      const res = await fetch(ENDPOINT, {
        signal: ctrl ? ctrl.signal : undefined,
        headers: {
          'x-portal-idtoken': token,
          'x-portal-oid': claims.oid || '',
          'x-portal-email': username || ''
        }
      });
      if (!res.ok) {
        const txt = await res.text().catch(function () { return ''; });
        const e = new Error('HTTP ' + res.status + ' · ' + txt.substring(0, 160));
        e.status = res.status;
        throw e;
      }
      const j = await res.json();
      if (!j || j.ok !== true) throw new Error('payload inválido');
      return j;
    } finally { if (t) clearTimeout(t); }
  }

  async function run() {
    // Espera o login de verdade (promise do auth.js) — sem timeout arbitrário.
    if (window._portalAuthReady) await window._portalAuthReady;
    else if (!window._msalAuth || !window._portalUser) { negar('login não concluído'); return; }

    const inst = window._msalAuth;
    const account = inst && ((inst.getActiveAccount && inst.getActiveAccount())
                 || (inst.getAllAccounts && inst.getAllAccounts()[0]));
    if (!account) { negar('sem conta logada'); return; }
    console.log(TAG, 'conta:', account.username);

    let token;
    try { token = await idToken(); }
    catch (e) { negar('sem ID token (' + (e && (e.errorCode || e.message)) + ')'); return; }

    const claims = account.idTokenClaims || {};
    let j = null, ultimoErro = '';
    for (var i = 0; i < TENTATIVAS; i++) {
      try { j = await consultar(token, claims, account.username); break; }
      catch (e) {
        ultimoErro = (e && e.name === 'AbortError') ? 'tempo esgotado' : (e && e.message) || 'erro';
        console.warn(TAG, 'tentativa', i + 1, 'falhou:', ultimoErro);
        if (e && e.status && e.status !== 429 && e.status < 500) break;   // 401/403 não melhora com retry
      }
    }
    if (!j) { negar(ultimoErro || 'falha em ' + ENDPOINT); return; }

    if (j.reason === 'groups_unavailable') {
      console.warn(TAG, '⚠️ Graph NÃO listou os grupos → status=', j.graphStatus, '· erro=', j.graphError,
        '· provável falta de admin consent para GroupMember.Read.All no App Registration.');
    }
    aplicar(j.areas, j.restricted, j.reason, j.modulos);
  }

  // ── Porta de acesso ───────────────────────────────────────────
  // Registrada ANTES do login concluir: o auth.js só remove a tela de login
  // depois que esta promise resolver, então o portal aparece já filtrado.
  var _resolvida = null;
  function decidir() { return _resolvida || (_resolvida = run().catch(function (e) { negar('erro inesperado: ' + (e && e.message)); })); }
  (window.__bmGates = window.__bmGates || []).push(decidir);

  // rede de segurança: se por algum motivo a porta não for chamada
  // (auth.js antigo em cache, por ex.), decide sozinho quando o login sair.
  if (window._portalAuthReady) window._portalAuthReady.then(decidir);
  else setTimeout(decidir, 3000);
})();
