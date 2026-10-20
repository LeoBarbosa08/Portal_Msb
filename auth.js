// ================================================================
// auth.js — Portal Biomedical · Authentication Guard
// Bloqueia acesso total sem login @biomedical.com.br ou @bio-id.com
// Layout da tela de login: "Login Desktop/Mobile" (Claude Design) com o
// painel da marca do Layout v3 — BioNiko 3D (home-scene.js), balão de fala,
// piso em perspectiva, status/aviso e entrada em cascata.
// ================================================================
(function () {
  'use strict';

  // ── Transporte de identidade p/ o backend ──────────────────────────
  // O Azure SWA descarta o header Authorization; por isso a identidade vai
  // num header CUSTOM que o SWA repassa: x-portal-idtoken (id token do Entra).
  // Este patch injeta esse header em TODA chamada a /api/* (mesma origem),
  // usando o MSAL assim que estiver pronto. É o que permite ao backend
  // VALIDAR a assinatura do token (api/shared/auth.js) e, no futuro, ligar
  // AUTH_ENFORCE. NUNCA bloqueia a chamada (se não houver token, segue sem).
  if (!window.__portalApiAuthPatched) {
    window.__portalApiAuthPatched = true;
    const _origFetch = window.fetch.bind(window);
    let _tok = null, _tokExp = 0;
    // Vencimento escrito NO PRÓPRIO token (claim exp). O acquireTokenSilent
    // devolve o id token do CACHE, que pode já estar vencido; contar 50 min
    // a partir do pedido mandava token vencido para o backend — foi o
    // "Não autenticado." da Cobrança aberta havia mais de 1 h (15/10/2026).
    const _expDe = function (t) {
      try {
        const b = String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return (JSON.parse(atob(b + '==='.slice((b.length + 3) % 4))).exp || 0) * 1000;
      } catch (e) { return 0; }
    };
    const _idToken = async function (forcar) {
      try {
        const inst = window._msalAuth;
        if (!inst) return null;
        const acct = (inst.getActiveAccount && inst.getActiveAccount()) ||
                     (inst.getAllAccounts && inst.getAllAccounts()[0]);
        if (!acct) return null;
        const now = Date.now();
        if (!forcar && _tok && now < _tokExp) return _tok;
        let r = await inst.acquireTokenSilent({ scopes: ['openid', 'profile'], account: acct, forceRefresh: !!forcar });
        let t = (r && r.idToken) || null;
        // o do cache vence em menos de 5 min (ou já venceu): pede um novo
        const e1 = _expDe(t);
        if (t && !forcar && e1 && e1 - now < 5 * 60000) {
          r = await inst.acquireTokenSilent({ scopes: ['openid', 'profile'], account: acct, forceRefresh: true });
          t = (r && r.idToken) || t;
        }
        _tok = t;
        const exp = _expDe(t);
        _tokExp = exp ? exp - 5 * 60000 : now + 50 * 60 * 1000;
        return _tok;
      } catch (e) { return null; }
    };
    const _comToken = function (input, init, t) {
      init = Object.assign({}, init);
      const h = new Headers((init && init.headers) ||
                  (typeof input !== 'string' && input && input.headers) || {});
      h.set('x-portal-idtoken', t);
      init.headers = h;
      return init;
    };
    // dá para mandar de novo? (corpo que não é stream já consumido)
    const _repetivel = function (input, init) {
      if (typeof input !== 'string') return false;
      const b = init && init.body;
      return b == null || typeof b === 'string' || (typeof FormData !== 'undefined' && b instanceof FormData) ||
        (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams) || (typeof Blob !== 'undefined' && b instanceof Blob);
    };
    window.fetch = async function (input, init) {
      let isApi = false, init2 = init, mandou = false;
      try {
        const u = (typeof input === 'string') ? input : (input && input.url) || '';
        isApi = u.indexOf('/api/') === 0 || u.indexOf(location.origin + '/api/') === 0;
        if (isApi) {
          const t = await _idToken();
          const jaTem = new Headers((init && init.headers) || (typeof input !== 'string' && input && input.headers) || {}).has('x-portal-idtoken');
          if (t && !jaTem) { init2 = _comToken(input, init, t); mandou = true; }
        }
      } catch (e) { /* nunca bloqueia a chamada */ }
      const res = await _origFetch(input, init2);
      // 401 com o token que ESTE patch pôs: token novo e mais uma tentativa
      // (o backend confere a identidade antes de qualquer efeito, então
      // repetir uma chamada recusada não duplica nada)
      if (isApi && mandou && res.status === 401 && _repetivel(input, init)) {
        try {
          const t2 = await _idToken(true);
          if (t2) return _origFetch(input, _comToken(input, init, t2));
        } catch (e) { /* fica a resposta original */ }
      }
      return res;
    };
  }

  const AUTH = {
    clientId:      '129978ce-ff3b-431d-98b3-66a1bcb766b1',
    tenantId:      'c311c9e6-6017-42a9-b306-4057beba5786',
    // bio-id.com entrou em 19/10/2026 (contas da BIO.ID no mesmo tenant).
    // O servidor tem a mesma lista em api/shared/auth.js (ALLOWED_DOMAINS).
    allowedDomains: ['biomedical.com.br', 'bio-id.com'],
    scopes: [
      'openid', 'profile', 'User.Read',
      'GroupMember.Read.All', 'Sites.ReadWrite.All',
      'https://analysis.windows.net/powerbi/api/Dataset.Read.All',
      'https://analysis.windows.net/powerbi/api/Report.Read.All'
    ]
  };

  // No celular, popups de login são bloqueados/instáveis (iOS Safari, Chrome
  // Android) e a autenticação trava. Nesses casos usamos fluxo de redirect.
  const IS_MOBILE =
    /Android|iPhone|iPad|iPod|Mobile|Windows Phone|webOS|BlackBerry/i.test(navigator.userAgent)
    || (window.matchMedia && window.matchMedia('(max-width: 820px)').matches);

  // O app inteiro pode acabar carregado DENTRO de uma janela-popup do MSAL
  // (a pessoa autoriza o popup, ele abre o portal e ela navega por ali). Desse
  // ponto em diante qualquer popup novo morre com "block_nested_popups" e so
  // um logout devolve o portal. Detectamos o estado e, nele, nunca abrimos popup.
  const IS_IN_POPUP = (function () {
    try { return !!(window.opener && window.opener !== window); } catch (e) { return false; }
  })();

  // -- Broker de token -------------------------------------------
  // Antes: ~60 pontos do portal faziam acquireTokenSilent e, no catch, caiam
  // direto em acquireTokenPopup/loginPopup. No celular isso gerava (a) o aviso
  // "este site esta tentando abrir um pop-up" e (b) o app preso dentro do popup.
  // Agora todos passam por aqui - o patch em patchPopups() reescreve os dois
  // metodos do MSAL, entao nenhuma pagina precisa mudar:
  //   1. acquireTokenSilent   (cache / refresh token - sem UI)
  //   2. ssoSilent            (iframe na sessao M365 - sem UI)
  //   3. acquireTokenRedirect (celular ou dentro de popup - navega e volta)
  //   4. popup                (so desktop, e so se 1-3 falharem)
  function _acctOf(inst, req) {
    try {
      return (req && req.account)
          || (inst.getActiveAccount && inst.getActiveAccount())
          || (inst.getAllAccounts && inst.getAllAccounts()[0])
          || null;
    } catch (e) { return null; }
  }

  // Trava anti-loop: sem ela, um token que NUNCA pode ser emitido (falta de
  // licenca/consentimento) viraria recarregamento infinito da pagina.
  function _redirectAllowed(key) {
    try {
      var k = 'bm_authredir_' + key;
      if (Date.now() - (+(sessionStorage.getItem(k) || 0)) < 5 * 60 * 1000) return false;
      sessionStorage.setItem(k, String(Date.now()));
      return true;
    } catch (e) { return true; }
  }

  async function acquire(inst, req, popupFn) {
    req = Object.assign({}, req || {});
    const scopes  = req.scopes || ['openid', 'profile'];
    const key     = scopes.join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60);
    const acct    = _acctOf(inst, req);
    const forceUI = !!req.prompt;   // quem pediu prompt QUER a tela (login inicial)

    if (!forceUI && acct) {
      try { return await inst.acquireTokenSilent(Object.assign({}, req, { account: acct })); }
      catch (e) { /* segue para o ssoSilent */ }
      if (inst.ssoSilent) {
        // e este passo que resolve o "fiquei inativo e voltei ao app": renova
        // pela sessao do navegador, sem popup e sem sair da pagina.
        try {
          await inst.ssoSilent({ scopes: scopes, account: acct, loginHint: acct.username });
          return await inst.acquireTokenSilent(Object.assign({}, req, { account: acct }));
        } catch (e) { /* segue para o interativo */ }
      }
    }

    if (IS_MOBILE || IS_IN_POPUP || req.noPopup) {
      if (!_redirectAllowed(key)) {
        const err = new Error('interaction_required (redirect ja tentado nesta sessao)');
        err.errorCode = 'portal_redirect_suppressed';
        throw err;
      }
      const rq = Object.assign({}, req, {
        account: acct || undefined,
        redirectStartPage: window.location.href   // volta para ESTA pagina
      });
      delete rq.noPopup;
      console.log('[Auth] token via redirect (' + (IS_IN_POPUP ? 'dentro de popup' : 'celular') + ') scopes=' + scopes.join(' '));
      if (acct && inst.acquireTokenRedirect) await inst.acquireTokenRedirect(rq);
      else if (inst.loginRedirect)           await inst.loginRedirect(rq);
      else throw new Error('sem fluxo de redirect disponivel');
      return await new Promise(function () {});   // a pagina esta navegando
    }

    return await popupFn.call(inst, req);         // desktop: popup, como antes
  }

  // Reescreve loginPopup/acquireTokenPopup do MSAL para passarem pelo broker.
  // Feito no prototipo: vale para a instancia do auth.js E para as instancias
  // proprias que algumas paginas criam.
  function patchPopups() {
    try {
      const P = window.msal && window.msal.PublicClientApplication
             && window.msal.PublicClientApplication.prototype;
      if (!P || P.__bmPopupPatched) return;
      P.__bmPopupPatched = true;
      const origAcq = P.acquireTokenPopup, origLogin = P.loginPopup;
      P.acquireTokenPopup = function (req) { return acquire(this, req, origAcq); };
      P.loginPopup        = function (req) { return acquire(this, req, origLogin); };
      // Broker explicito para quem quiser chamar direto (ex.: area-access.js).
      window.portalToken = function (scopes, opts) {
        const inst = window._msalAuth || _msalInstance;
        if (!inst) return Promise.reject(new Error('msal-not-ready'));
        return acquire(inst, Object.assign({ scopes: [].concat(scopes || ['openid', 'profile']) }, opts || {}), origAcq);
      };
      console.log('[Auth] broker de token ativo'
        + (IS_MOBILE ? ' | celular: sem popup' : '')
        + (IS_IN_POPUP ? ' | rodando dentro de popup' : ''));
    } catch (e) { console.warn('[Auth] patch de popup falhou:', e); }
  }

  // ── Fontes do design (Outfit + Manrope — as do Layout v3) ─────
  (function loadFonts() {
    const add = (rel, href, cross) => {
      const l = document.createElement('link');
      l.rel = rel; l.href = href;
      if (cross) l.crossOrigin = 'anonymous';
      document.head.appendChild(l);
    };
    add('preconnect', 'https://fonts.googleapis.com');
    add('preconnect', 'https://fonts.gstatic.com', true);
    add('stylesheet', 'https://fonts.googleapis.com/css2?family=Outfit:wght@300..800&family=Manrope:wght@400..800&family=JetBrains+Mono:wght@400;500;700&display=swap');
  })();

  // ── CSS da tela de login ──────────────────────────────────────
  const css = `
    #portal-auth-screen {
      position: fixed; inset: 0; z-index: 99999; overflow: auto;
      display: flex; color: #0F1E33; background: #0A1B39;
      font-family: 'Manrope', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
    }
    #portal-auth-screen * { box-sizing: border-box; }
    #portal-auth-screen a { color: #1E5AD1; text-decoration: none; font-weight: 600; }
    #portal-auth-screen a:hover { color: #123C97; }

    /* ============ PAINEL DE MARCA (navy) · Layout v3 com o BioNiko 3D ============ */
    .pa-brand {
      --pa-gap: 28px;
      position: relative; overflow: hidden; isolation: isolate; flex: 0 0 56.5%; min-width: 0;
      display: flex; flex-direction: column; justify-content: flex-start; gap: var(--pa-gap);
      padding: 44px 56px 40px; color: #fff;
      background:
        radial-gradient(700px 520px at 68% 34%, rgba(47,127,230,.42), transparent 64%),
        radial-gradient(600px 400px at 0% 100%, rgba(19,64,125,.9), transparent 70%),
        linear-gradient(170deg, #061631 0%, #0A2447 55%, #0C2C57 100%);
    }
    /* piso em perspectiva (o mesmo do hero da home) */
    .pa-floor {
      position: absolute; left: -30%; right: -30%; bottom: -8%; height: 55%; z-index: -2; pointer-events: none;
      background-image: linear-gradient(rgba(141,187,245,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(141,187,245,.12) 1px, transparent 1px);
      background-size: 60px 60px;
      transform: perspective(700px) rotateX(62deg); transform-origin: 50% 100%;
      -webkit-mask-image: radial-gradient(ellipse 55% 70% at 60% 10%, #000 10%, transparent 70%);
      mask-image: radial-gradient(ellipse 55% 70% at 60% 10%, #000 10%, transparent 70%);
      animation: pa-floor 18s linear infinite;
    }
    @keyframes pa-floor { from { background-position: 0 0, 0 0; } to { background-position: 0 60px, 0 0; } }
    /* BioNiko 3D (home-scene.js no modo "panel") — aparece em fade quando o 1º quadro fica pronto */
    .pa-niko { position: absolute; inset: 0; z-index: -1; opacity: 0; transition: opacity 1.2s cubic-bezier(.22,1,.36,1); }
    .pa-niko.is-ready { opacity: 1; }
    .pa-niko canvas { width: 100% !important; height: 100% !important; display: block; }
    /* o espaço livre entre o logo e o texto: é a faixa onde o BioNiko cabe (band() mede
       este elemento) e onde fica um brilho enquanto o 3D carrega, na checagem de
       sessão e sem WebGL. Margem negativa = a faixa vai de borda a borda dos vizinhos. */
    .pa-fallback { position: relative; z-index: -1; flex: 1 1 auto; min-height: 0; margin: calc(var(--pa-gap) * -1) 0; pointer-events: none; transition: opacity 1s; }
    .pa-niko.is-ready ~ .pa-fallback { opacity: 0; }
    .pa-fallback i { position: absolute; left: 57%; top: 50%; translate: -50% -50%; display: block; border-radius: 50%; animation: pa-fade 1.2s ease .45s backwards; }
    .pa-fallback i:nth-child(1) { height: min(250px, 78%); aspect-ratio: 1; background: radial-gradient(circle, rgba(127,227,240,.35), rgba(47,127,230,.18) 45%, transparent 70%); filter: blur(8px); animation: pa-fade 1.2s ease .45s backwards, pa-breathe 5s ease-in-out 1.65s infinite; }
    .pa-fallback i:nth-child(2) { height: min(310px, 96%); aspect-ratio: 1.4; border: 1px solid rgba(127,227,240,.4); transform: rotate(-18deg) scaleY(.32); }
    @keyframes pa-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
    /* balão de fala: o canto de baixo-direita segue a cabeça (onAnchor da cena) */
    .pa-bubble {
      position: absolute; z-index: 2; left: 0; top: 0; margin: 0; max-width: 260px; padding: 12px 16px;
      border-radius: 18px 18px 4px 18px; background: rgba(255,255,255,.96); color: #0A2447;
      font-weight: 700; font-size: 14.5px; line-height: 1.35; box-shadow: 0 18px 40px -14px rgba(0,0,0,.55);
      transform: translate(-100%, -100%) translate(var(--bx, -9999px), var(--by, -9999px));
      opacity: 0; transition: opacity .5s cubic-bezier(.22,1,.36,1); pointer-events: none; will-change: transform;
    }
    .pa-bubble.is-on { opacity: 1; }
    .pa-bubble small { display: block; font-weight: 600; color: #56657A; font-size: 12.5px; margin-top: 2px; }

    .pa-logo { display: flex; align-items: center; gap: 12px; align-self: flex-start; }
    .pa-logo-mark {
      width: 44px; height: 44px; border-radius: 13px; display: block; object-fit: cover;
      box-shadow: 0 8px 18px -8px rgba(0,0,0,.6);
    }
    .pa-logo-word { font-family: 'Outfit', 'Segoe UI', sans-serif; font-weight: 700; font-size: 24px; letter-spacing: -.02em; color: #fff; }

    .pa-hero { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 14px; max-width: 560px; margin-top: auto; }
    .pa-eyebrow {
      display: inline-flex; align-items: center; gap: 10px;
      color: #9CC8FF; font-weight: 700; font-size: 12px; letter-spacing: .16em;
    }
    .pa-eyebrow span { width: 28px; height: 2px; background: #9CC8FF; border-radius: 2px; }
    .pa-hero h1 {
      margin: 0; font-family: 'Outfit', 'Segoe UI', sans-serif; font-weight: 600; font-size: clamp(32px, 3.2vw, 48px);
      line-height: 1.1; letter-spacing: -.035em; color: #fff; text-wrap: balance;
    }
    .pa-hero h1 span { background: linear-gradient(95deg, #FFFFFF 0%, #B9D8FF 55%, #FFD08A 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
    .pa-hero p { margin: 0; font-size: 16.5px; line-height: 1.55; color: rgba(255,255,255,.78); max-width: 46ch; }
    /* informações úteis: status dos sistemas + último aviso (texto de LOGIN_INFO) */
    .pa-infos { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px; }
    .pa-info {
      display: flex; gap: 12px; align-items: flex-start; padding: 14px 16px; border-radius: 16px;
      background: linear-gradient(160deg, rgba(255,255,255,.12), rgba(255,255,255,.04));
      border: 1px solid rgba(255,255,255,.16); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
    }
    .pa-dot { position: relative; flex: none; width: 10px; height: 10px; border-radius: 50%; margin-top: 6px; background: #3DDC84; box-shadow: 0 0 0 4px rgba(61,220,132,.18); }
    .pa-dot::after { content: ""; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid currentColor; color: #3DDC84; opacity: 0; animation: pa-live 2.4s cubic-bezier(.22,1,.36,1) 1.6s infinite; }
    .pa-dot.is-warn { background: #F4A62A; box-shadow: 0 0 0 4px rgba(244,166,42,.2); }
    .pa-dot.is-warn::after { color: #F4A62A; }
    .pa-dot.is-info { background: #8DBBF5; box-shadow: 0 0 0 4px rgba(141,187,245,.18); }
    .pa-dot.is-info::after { display: none; }
    @keyframes pa-live { 0% { transform: scale(.6); opacity: .9; } 100% { transform: scale(2.1); opacity: 0; } }
    .pa-tag { display: block; margin-bottom: 2px; color: #9CC8FF; font-size: 10.5px; font-weight: 800; letter-spacing: .08em; }
    .pa-info b { display: block; font-size: 14px; line-height: 1.35; font-weight: 700; }
    .pa-info small { display: block; margin-top: 2px; color: rgba(255,255,255,.7); font-size: 12.5px; line-height: 1.4; }
    .pa-copyright { color: rgba(255,255,255,.62); font-size: 12.5px; }

    /* Layout v3: entrada em cascata (a do protótipo). O atraso de .45s é de
       propósito — com sessão já aberta a tela some antes disso, e a pessoa vê
       só o fundo da marca (sem o formulário piscando a cada troca de página).
       fill "backwards": terminada a entrada, o elemento volta ao próprio
       estilo — o :hover do botão continua mexendo no transform. */
    @keyframes pa-drop { from { opacity: 0; transform: translateY(-12px); } }
    @keyframes pa-rise { from { opacity: 0; transform: translateY(22px); } }
    @keyframes pa-rise-sm { from { opacity: 0; transform: translateY(14px); } }
    @keyframes pa-fade { from { opacity: 0; } }
    .pa-logo { animation: pa-drop .7s cubic-bezier(.16,1,.3,1) .45s backwards; }
    .pa-hero > * { animation: pa-rise 1s cubic-bezier(.16,1,.3,1) .6s backwards; }
    .pa-hero > :nth-child(2) { animation-delay: .68s; }
    .pa-hero > :nth-child(3) { animation-delay: .76s; }
    .pa-hero > :nth-child(4) { animation-delay: .84s; }
    .pa-copyright { animation: pa-fade 1s ease .9s backwards; }
    .pa-login-inner > * { animation: pa-rise-sm .8s cubic-bezier(.16,1,.3,1) .5s backwards; }
    .pa-login-inner > #portal-auth-error { animation: none; }   /* o erro aparece na hora, sem atraso */
    .pa-login-inner > :nth-child(2) { animation-delay: .56s; }
    .pa-login-inner > :nth-child(3) { animation-delay: .62s; }
    .pa-login-inner > :nth-child(4) { animation-delay: .68s; }
    .pa-login-inner > :nth-child(5) { animation-delay: .74s; }
    .pa-login-inner > :nth-child(7) { animation-delay: .8s; }
    .pa-login-inner > :nth-child(8) { animation-delay: .86s; }
    .pa-login-inner > :nth-child(9) { animation-delay: .92s; }
    @media (prefers-reduced-motion: reduce) {
      #portal-auth-screen *, #portal-auth-screen *::before, #portal-auth-screen *::after { animation: none !important; transition: none !important; }
    }
    html.bm3-reduce #portal-auth-screen *, html.bm3-reduce #portal-auth-screen *::before, html.bm3-reduce #portal-auth-screen *::after { animation: none !important; transition: none !important; }

    /* ============ PAINEL DE LOGIN (claro) ============ */
    .pa-login {
      position: relative; flex: 1 1 44.44%; min-width: 0;
      background: #F6F8FC; display: flex; align-items: center; justify-content: center;
      padding: 40px 72px; box-shadow: inset 30px 0 60px -46px rgba(9,22,46,.55);
    }
    .pa-login-inner { width: 100%; max-width: 384px; }
    .pa-badge {
      display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 999px;
      background: #EDF1FA; border: 1px solid #E0E8F5; color: #4A5C7E;
      font-weight: 700; font-size: 11.5px; letter-spacing: .13em; margin-bottom: 26px;
    }
    .pa-login h2 {
      margin: 0 0 10px; font-family: 'Outfit', 'Segoe UI', sans-serif; font-weight: 600; font-size: 32px;
      letter-spacing: -.02em; color: #0F1E33;
    }
    .pa-lead { margin: 0 0 26px; font-size: 15px; line-height: 1.55; color: #5A6B85; }
    .pa-email {
      display: inline-flex; align-items: center; gap: 9px; padding: 9px 15px; border-radius: 11px;
      background: #EAF0FB; border: 1px solid #DBE6F8; color: #1E5AD1;
      font-weight: 600; font-size: 14px; margin-bottom: 26px;
    }
    #portal-auth-btn {
      width: 100%; display: flex; align-items: center; justify-content: center; gap: 12px;
      padding: 16px 22px; border: none; border-radius: 13px;
      background: linear-gradient(180deg, #2E71EA, #1E5AD1); color: #fff;
      font-family: 'Manrope', sans-serif; font-weight: 600; font-size: 16px; cursor: pointer;
      box-shadow: 0 12px 26px -10px rgba(30,90,209,.75);
      transition: transform .16s ease, box-shadow .16s ease, filter .16s ease;
    }
    #portal-auth-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 16px 32px -10px rgba(30,90,209,.85); filter: brightness(1.06); }
    #portal-auth-btn:active:not(:disabled) { transform: translateY(0); }
    #portal-auth-btn:disabled { cursor: default; opacity: .92; }
    .pa-btn-inner { display: inline-flex; align-items: center; gap: 12px; }
    .pa-ms { display: grid; grid-template-columns: 9px 9px; grid-template-rows: 9px 9px; gap: 2px; }
    .pa-ms i { display: block; }
    .pa-ms i:nth-child(1) { background: #F25022; }
    .pa-ms i:nth-child(2) { background: #7FBA00; }
    .pa-ms i:nth-child(3) { background: #00A4EF; }
    .pa-ms i:nth-child(4) { background: #FFB900; }
    .auth-spinner {
      width: 18px; height: 18px; border-radius: 50%;
      border: 2.4px solid rgba(255,255,255,.35); border-top-color: #fff;
      animation: auth-spin .7s linear infinite; flex-shrink: 0;
    }
    @keyframes auth-spin { to { transform: rotate(360deg); } }

    .pa-divider {
      display: flex; align-items: center; gap: 14px; margin: 24px 0;
      color: #98A6C0; font-size: 11px; font-weight: 700; letter-spacing: .08em;
    }
    .pa-divider span { flex: 1; height: 1px; background: #E4EAF3; }
    .pa-secure { display: flex; align-items: center; justify-content: center; gap: 8px; color: #7A8AA6; font-size: 13px; }
    .pa-support { text-align: center; font-size: 13.5px; color: #5A6B85; margin-top: 22px; }
    #portal-auth-error {
      display: none; margin-top: 18px;
      background: rgba(239,68,68,.10); border: 1px solid rgba(239,68,68,.32);
      color: #B4342E; border-radius: 11px; padding: 12px 15px;
      font-size: 13.5px; line-height: 1.45; text-align: left; white-space: pre-line;
    }

    /* ============ TELA MÉDIA (notebook pequeno / tablet deitado) ============ */
    @media (max-width: 1100px) {
      .pa-brand { flex-basis: 50%; padding: 36px 36px 32px; }
      .pa-infos { grid-template-columns: 1fr; }
      .pa-login { padding: 40px 44px; }
      .pa-bubble { max-width: 214px; font-size: 13.5px; }
    }
    /* altura curta (a barra do navegador come ~120px): o texto encolhe em degraus
       para sobrar faixa ao BioNiko, que se ajusta ao que sobrar */
    @media (min-width: 861px) and (max-height: 800px) {
      .pa-brand { --pa-gap: 20px; padding-top: 32px; padding-bottom: 28px; }
      .pa-hero h1 { font-size: clamp(28px, 2.8vw, 40px); }
      .pa-hero p { font-size: 15px; }
    }
    @media (min-width: 861px) and (max-height: 700px) {
      .pa-hero { gap: 10px; }
      .pa-infos small { display: none; }
    }
    @media (min-width: 861px) and (max-height: 620px) { .pa-hero p { display: none; } }
    @media (min-width: 861px) and (max-height: 540px) { .pa-infos { display: none; } }

    /* ============ MOBILE (coluna: faixa navy com o BioNiko, folha clara embaixo) ============ */
    @media (max-width: 860px) {
      #portal-auth-screen { flex-direction: column; background: #0A2447; }
      .pa-brand {
        --pa-gap: 0px; flex: none; min-height: 300px;
        padding: calc(env(safe-area-inset-top, 0px) + 22px) 22px 44px;
      }
      .pa-fallback i { left: 64%; }
      .pa-logo-mark { width: 38px; height: 38px; border-radius: 11px; }
      .pa-logo-word { font-size: 21px; }
      /* na faixa do celular quem aparece é o BioNiko; o texto só volta sem WebGL */
      .pa-hero, .pa-copyright, .pa-bubble { display: none; }
      .pa-brand.pa-no3d { min-height: 0; padding-bottom: 50px; }
      .pa-brand.pa-no3d .pa-fallback { display: none; }
      .pa-brand.pa-no3d .pa-hero { display: flex; max-width: none; margin-top: 24px; gap: 12px; }
      .pa-eyebrow { font-size: 11px; letter-spacing: .18em; }
      .pa-eyebrow span { width: 22px; }
      .pa-hero h1 { font-size: 26px; line-height: 1.16; }
      .pa-hero p { font-size: 14px; color: rgba(255,255,255,.7); }
      .pa-infos { display: none; }
      .pa-login {
        flex: 1 1 auto; margin-top: -24px; border-radius: 30px 30px 0 0; align-items: flex-start;
        padding: 34px 30px calc(env(safe-area-inset-bottom, 0px) + 30px);
        box-shadow: 0 -18px 40px -24px rgba(9,22,46,.4);
      }
      .pa-login-inner { max-width: 420px; }
      .pa-badge { font-size: 11px; margin-bottom: 18px; }
      .pa-login h2 { font-size: 24px; }
      .pa-lead { font-size: 14px; margin-bottom: 20px; }
      .pa-email { font-size: 13.5px; margin-bottom: 20px; }
      #portal-auth-btn { font-size: 15.5px; padding: 16px 20px; }
      .pa-divider { margin: 20px 0; }
    }

    @media (max-width: 380px) {
      .pa-brand { padding-left: 18px; padding-right: 18px; }
      .pa-login { padding-left: 22px; padding-right: 22px; }
      .pa-hero h1 { font-size: 24px; }
    }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ── Ícones (SVG inline) ───────────────────────────────────────
  const IC_LOCK = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="9" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>`;
  const IC_MAIL = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 7l9 6 9-6"></path></svg>`;

  // ── Painel da marca: status dos sistemas e último aviso ──────────
  // Texto FIXO de propósito: a tela de login é pública (vem antes do login),
  // então não lê /api/* — o mural de avisos exige identidade. Quem mantém
  // é a TI, aqui. status.warn = true pinta a bolinha de âmbar.
  const LOGIN_INFO = {
    status: { warn: false, title: 'Operando normalmente', text: 'Dynamics 365, Salesforce, Power BI e demais' },
    aviso:  { tag: 'ÚLTIMO AVISO · TI · 08 SET. 2026', title: 'Bem Vindos ao portal corporativo da BIOMEDICAL' }
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const saudacao = () => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; };

  // Conteúdo do botão (padrão x carregando)
  const MS_GRID    = `<span class="pa-ms"><i></i><i></i><i></i><i></i></span>`;
  const BTN_DEFAULT = `<span class="pa-btn-inner">${MS_GRID}Entrar com Microsoft</span>`;
  const BTN_LOADING = `<span class="pa-btn-inner"><span class="auth-spinner"></span>Conectando…</span>`;

  // ── HTML da tela de login ─────────────────────────────────────
  const screen = document.createElement('div');
  screen.id = 'portal-auth-screen';
  screen.innerHTML = `
    <!-- Painel de marca (navy): BioNiko 3D + informações úteis -->
    <div class="pa-brand">
      <div class="pa-floor" aria-hidden="true"></div>
      <div class="pa-niko" id="pa-niko" aria-hidden="true"></div>
      <p class="pa-bubble" id="pa-bubble" aria-hidden="true"></p>
      <div class="pa-logo">
        <img class="pa-logo-mark" src="/icons/icon-192.png" alt="Biomedical"
             onerror="this.style.display='none'">
        <span class="pa-logo-word">Biomedical</span>
      </div>
      <div class="pa-fallback" aria-hidden="true"><i></i><i></i></div>
      <div class="pa-hero">
        <div class="pa-eyebrow"><span></span>PORTAL CORPORATIVO</div>
        <h1>Tudo da Biomedical <span>em um só lugar.</span></h1>
        <p>Aprovações, áreas, sistemas e agentes IA em um único acesso com a sua conta corporativa.</p>
        <div class="pa-infos">
          <div class="pa-info">
            <span class="pa-dot${LOGIN_INFO.status.warn ? ' is-warn' : ''}" aria-hidden="true"></span>
            <div><span class="pa-tag">STATUS DOS SISTEMAS</span><b>${esc(LOGIN_INFO.status.title)}</b><small>${esc(LOGIN_INFO.status.text)}</small></div>
          </div>
          <div class="pa-info">
            <span class="pa-dot is-info" aria-hidden="true"></span>
            <div><span class="pa-tag">${esc(LOGIN_INFO.aviso.tag)}</span><b>${esc(LOGIN_INFO.aviso.title)}</b></div>
          </div>
        </div>
      </div>
      <div class="pa-copyright">© 2026 Biomedical S.A. · Todos os direitos reservados.</div>
    </div>

    <!-- Painel de login (claro) -->
    <div class="pa-login">
      <div class="pa-login-inner">
        <div class="pa-badge">${IC_LOCK} ACESSO RESTRITO</div>
        <h2>Bem-vindo de volta</h2>
        <p class="pa-lead">Entre com sua conta corporativa Microsoft para continuar no Portal Corporativo.</p>
        <div class="pa-email">${IC_MAIL} @biomedical.com.br · @bio-id.com</div>
        <button type="button" id="portal-auth-btn">${BTN_DEFAULT}</button>
        <div id="portal-auth-error"></div>
        <div class="pa-divider"><span></span>AUTENTICAÇÃO MICROSOFT 365<span></span></div>
        <div class="pa-secure">${IC_LOCK} Ambiente protegido · Biomedical S.A.</div>
        <div class="pa-support">Problemas para acessar? <a href="mailto:chamados.ti@biomedical.com.br">Falar com o Suporte de TI</a></div>
      </div>
    </div>
  `;

  // ── Helpers ───────────────────────────────────────────────────
  function showScreen() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', showScreen); return; }
    // trava o scroll do documento enquanto a tela de login está aberta (padrão modal):
    // evita que o conteúdo da página por trás cause rolagem/overflow horizontal no celular.
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.appendChild(screen);
  }

  function hideScreen() {
    unmountNiko();
    if (screen.parentNode) screen.parentNode.removeChild(screen);
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  // ── BioNiko 3D no painel da marca (Layout v3) ─────────────────
  // Só entra quando a pessoa PRECISA fazer login: com sessão aberta a tela
  // some antes, e o Three.js nem é baixado. A cena é a mesma da home
  // (home-scene.js), no modo "panel", e o login nunca espera por ela: vem
  // depois do botão, em tempo ocioso. Sem WebGL de verdade (VDI/acesso
  // remoto cai no WebGL por SOFTWARE, que come CPU) fica o brilho em CSS.
  let _niko = null, _nikoRO = null, _nikoOn = false, _nikoOff = false;

  function motionReduced() {
    try {
      if (document.documentElement.classList.contains('bm3-reduce') || localStorage.getItem('bm3-reduce') === '1') return true;
    } catch (e) {}
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function webglOk() {
    try {
      const cv = document.createElement('canvas');
      const gl = cv.getContext('webgl2') || cv.getContext('webgl');
      if (!gl) return false;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const ren = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return !/swiftshader|llvmpipe|softpipe|basic render|software/i.test(ren);
    } catch (e) { return false; }
  }

  function mountNiko() {
    if (_nikoOn) return;
    _nikoOn = true; _nikoOff = false;
    const brand  = screen.querySelector('.pa-brand');
    const box    = screen.querySelector('#pa-niko');
    const bubble = screen.querySelector('#pa-bubble');
    const faixa  = screen.querySelector('.pa-fallback');
    const hero   = screen.querySelector('.pa-hero');
    const logo   = screen.querySelector('.pa-logo');
    if (!brand || !box || !bubble || !faixa || !hero || !logo) return;
    if (!webglOk()) { brand.classList.add('pa-no3d'); return; }
    bubble.innerHTML = saudacao() + '! Eu sou o BioNiko.<small>Entre com sua conta para começar.</small>';
    const mm = q => !!(window.matchMedia && window.matchMedia(q).matches);
    const low = mm('(max-width: 860px)') || mm('(pointer: coarse)') || (navigator.hardwareConcurrency || 8) <= 4;
    const still = motionReduced();
    const falhou = err => { brand.classList.add('pa-no3d'); console.warn('[Auth] BioNiko 3D indisponível, fica o brilho em CSS', err); };
    // o balão não sai do painel nem sobe no logo: limites medidos fora do quadro a quadro
    // (ler offsetWidth a cada quadro forçaria layout 60x por segundo)
    let minX = 290, minY = 150;
    const medir = () => {
      if (!bubble.offsetWidth) return;                 // celular: balão escondido
      minX = bubble.offsetWidth + 24;
      minY = logo.offsetTop + logo.offsetHeight + 12 + bubble.offsetHeight;
    };
    medir();
    const montar = () => {
      if (_nikoOff || typeof window.bmCreateHeroScene !== 'function') return;
      window.bmCreateHeroScene(box, {
        low: low, still: still, placement: 'panel',
        // faixa livre entre o logo e o texto (px do painel); no celular o texto some
        // e vale o posicionamento do protótipo (faixa do topo)
        band: () => hero.offsetParent === null ? null : {
          top: faixa.offsetTop + 30, bottom: faixa.offsetTop + faixa.offsetHeight - 14, anchorX: minX
        },
        // canto de baixo-direita do balão ao lado da cabeça
        onAnchor: (x, y) => {
          bubble.style.setProperty('--bx', Math.max(x, minX) + 'px');
          bubble.style.setProperty('--by', Math.max(y, minY) + 'px');
        }
      }).then(cena => {
        if (_nikoOff) { cena.destroy(); return; }   // a tela saiu enquanto carregava
        _niko = cena;
        // a faixa muda quando o texto reflui (fonte carregando, degrau de altura)
        if ('ResizeObserver' in window) {
          _nikoRO = new ResizeObserver(() => { medir(); if (_niko && _niko.relayout) _niko.relayout(); });
          _nikoRO.observe(faixa); _nikoRO.observe(bubble);
        }
        setTimeout(() => { if (!_nikoOff) bubble.classList.add('is-on'); }, still ? 0 : 700);
      }).catch(falhou);
    };
    const carregar = () => {
      if (_nikoOff) return;
      if (typeof window.bmCreateHeroScene === 'function') { montar(); return; }
      const s = document.createElement('script');
      s.src = '/home-scene.js?v=2'; s.async = true;
      s.onload = montar; s.onerror = falhou;
      document.head.appendChild(s);
    };
    if ('requestIdleCallback' in window) requestIdleCallback(carregar, { timeout: 600 });
    else setTimeout(carregar, 300);
  }

  function unmountNiko() {
    _nikoOff = true; _nikoOn = false;
    if (_nikoRO) { _nikoRO.disconnect(); _nikoRO = null; }
    if (_niko) { try { _niko.destroy(); } catch (e) {} _niko = null; }
  }

  function showError(msg) {
    const el = document.getElementById('portal-auth-error');
    if (el) { el.style.display = 'block'; el.textContent = msg; }
    setLoading(false);
  }

  function setLoading(on) {
    const btn = document.getElementById('portal-auth-btn');
    if (!btn) return;
    btn.disabled = on;
    btn.innerHTML = on ? BTN_LOADING : BTN_DEFAULT;
  }

  // mesma pilula de "carregando", com texto proprio (usada pela porta de acesso)
  function setLoadingMsg(txt) {
    const btn = document.getElementById('portal-auth-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="pa-btn-inner"><span class="auth-spinner"></span>' + txt + '</span>';
  }

  // Promise/evento de login concluido - evita que o resto do portal fique
  // fazendo setInterval com timeout arbitrario esperando window._portalUser
  // (era isso que fazia o area-access.js desistir em 12s e LIBERAR TUDO).
  let _authReadyResolve;
  window._portalAuthReady = new Promise(function (res) { _authReadyResolve = res; });

  // ── MSAL ─────────────────────────────────────────────────────
  let _msalInstance = null;

  async function initMSAL() {
    if (_msalInstance) return _msalInstance;
    patchPopups();
    _msalInstance = new window.msal.PublicClientApplication({
      auth: {
        clientId:    AUTH.clientId,
        authority:   `https://login.microsoftonline.com/${AUTH.tenantId}`,
        redirectUri: window.location.origin + '/'
      },
      cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: true }
    });
    if (_msalInstance.initialize) await _msalInstance.initialize();
    // Processa o retorno do login por redirect (celular). Se voltou com conta,
    // define como ativa para o checkExistingSession conceder o acesso.
    const redirectResp = await _msalInstance.handleRedirectPromise().catch(() => null);
    if (redirectResp && redirectResp.account && _msalInstance.setActiveAccount) {
      _msalInstance.setActiveAccount(redirectResp.account);
    }
    return _msalInstance;
  }

  // ── Foto do Azure AD (Microsoft Graph /me/photo) ──────────────
  // Pinta TODO avatar da própria pessoa — cabeçalho e menu da conta
  // (portal-motion.js), rodapé da barra lateral (nav-sidebar.js) e folha de
  // perfil do celular (perfil-sheet.js) — sem mexer em quem desenha cada um:
  // a foto vira a variável --bm-foto no <html> e o CSS abaixo a põe por cima
  // das iniciais, que seguem no HTML como reserva (sem foto, Graph fora).
  // Só token SILENCIOSO (o User.Read já vem do login): uma foto nunca abre
  // popup nem redirect. Cache de 24h por e-mail, inclusive o "não tem foto"
  // (404), para não ir ao Graph a cada página; o portalLogout apaga o cache.
  const FOTO_TTL = 24 * 60 * 60 * 1000;
  const FOTO_LADO = 128;   // o maior avatar tem 52px: 128 fica nítido em tela 2x

  const fotoCss = document.createElement('style');
  fotoCss.textContent =
    'html.bm-tem-foto .bm3-avatar, html.bm-tem-foto .sb-user-avatar, html.bm-tem-foto .bmp-avatar {' +
    ' background-image: var(--bm-foto) !important; background-size: cover !important;' +
    ' background-position: center !important; color: transparent !important; text-shadow: none !important; }';
  document.head.appendChild(fotoCss);

  function aplicarFoto(url) {
    const h = document.documentElement;
    if (url) { h.style.setProperty('--bm-foto', 'url("' + url + '")'); h.classList.add('bm-tem-foto'); }
    else     { h.style.removeProperty('--bm-foto'); h.classList.remove('bm-tem-foto'); }
    if (window._portalUser) window._portalUser.foto = url || null;
  }

  // Recorta no centro e reduz para FOTO_LADO (JPEG): /me/photo/$value pode
  // vir em 648×648 e o data URL vai para o localStorage.
  function reduzirFoto(blob) {
    return new Promise(function (res, rej) {
      const src = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = function () {
        try {
          const w = img.naturalWidth, h = img.naturalHeight, lado = Math.min(w, h);
          const cv = document.createElement('canvas');
          cv.width = cv.height = FOTO_LADO;
          cv.getContext('2d').drawImage(img, (w - lado) / 2, (h - lado) / 2, lado, lado, 0, 0, FOTO_LADO, FOTO_LADO);
          res(cv.toDataURL('image/jpeg', 0.86));
        } catch (e) { rej(e); } finally { URL.revokeObjectURL(src); }
      };
      img.onerror = function () { URL.revokeObjectURL(src); rej(new Error('foto ilegível')); };
      img.src = src;
    });
  }

  async function carregarFoto(account) {
    const email = String(account.username || '').toLowerCase();
    if (!email || !_msalInstance) return;
    const chave = 'bm-foto-v1:' + email;
    let c = null;
    try { c = JSON.parse(localStorage.getItem(chave) || 'null'); } catch (e) {}
    if (c && c.foto) aplicarFoto(c.foto);   // a última foto conhecida, na hora
    if (c && Date.now() - (c.em || 0) < (c.ttl || FOTO_TTL)) return;
    try {
      const r = await _msalInstance.acquireTokenSilent({ scopes: ['User.Read'], account: account });
      const auth = { Authorization: 'Bearer ' + r.accessToken };
      let blob = null;
      // 240×240 primeiro (leve); conta sem esse tamanho cai na original
      for (const u of ['/me/photos/240x240/$value', '/me/photo/$value']) {
        const resp = await fetch('https://graph.microsoft.com/v1.0' + u, { headers: auth });
        if (resp.status === 404) continue;   // 404 nas duas = a pessoa não tem foto
        if (!resp.ok) throw new Error('Graph ' + resp.status);
        blob = await resp.blob();
        break;
      }
      const foto = blob ? await reduzirFoto(blob) : null;
      aplicarFoto(foto);
      try { localStorage.setItem(chave, JSON.stringify({ em: Date.now(), foto: foto })); } catch (e) {}
    } catch (e) {
      // token ou Graph indisponível: fica o que já está na tela e tenta de novo em 1h
      try { localStorage.setItem(chave, JSON.stringify({ em: Date.now(), ttl: 60 * 60 * 1000, foto: (c && c.foto) || null })); } catch (e2) {}
      console.warn('[Auth] foto do perfil indisponível:', (e && e.message) || e);
    }
  }

  function grantAccess(account) {
    const email = (account.username || '').toLowerCase();
    window._portalUser = { name: account.name || email, email: account.username };
    window._msalAuth   = _msalInstance;
    if (typeof window.setSidebarUser === 'function') {
      window.setSidebarUser(account.name || email, account.username);
    }
    console.log('[Auth] ✅ Acesso concedido:', account.username);
    _authReadyResolve(window._portalUser);
    document.dispatchEvent(new CustomEvent('portalauth:ready', { detail: { email: account.username } }));
    carregarFoto(account);   // não espera: os avatares trocam sozinhos quando a foto chegar

    // -- PORTA DE ACESSO ---------------------------------------------
    // Quem precisa filtrar a tela pelo perfil da pessoa (a home, via
    // area-access.js; as paginas internas, via nav-sidebar.js) registra uma
    // funcao em window.__bmGates. O portal so aparece depois que TODAS
    // resolverem - assim nao existe instante em que a pessoa ve area que nao e
    // dela. Cada porta cuida do proprio limite de tempo; aqui fica so um teto
    // de seguranca para nunca prender a tela de login para sempre.
    const abrir = function () { hideScreen(); };
    const rodarPortas = function () {
      const gates = window.__bmGates || [];
      if (!gates.length) { abrir(); return; }
      setLoadingMsg('Verificando seu acesso…');
      let feito = false;
      const umaVez = function () { if (!feito) { feito = true; abrir(); } };
      Promise.all(gates.map(function (g) {
        try { return Promise.resolve(g()).catch(function () {}); } catch (e) { return Promise.resolve(); }
      })).then(umaVez, umaVez);
      setTimeout(umaVez, 25000);
    };
    // espera o DOM: garante que os scripts `defer` ja registraram as portas
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rodarPortas);
    else rodarPortas();
  }

  function validateDomain(account) {
    const email = (account.username || '').toLowerCase();
    if (!AUTH.allowedDomains.some(d => email.endsWith('@' + d))) {
      if (IS_MOBILE && _msalInstance.logoutRedirect) {
        _msalInstance.logoutRedirect({ account, postLogoutRedirectUri: window.location.origin + '/' }).catch(() => {});
      } else {
        _msalInstance.logoutPopup({ account }).catch(() => {});
      }
      showError(`❌ Acesso negado.\nUse um e-mail ${AUTH.allowedDomains.map(d => '@' + d).join(' ou ')}.\n(${account.username})`);
      console.warn('[Auth] ❌ Domínio inválido:', account.username);
      return false;
    }
    return true;
  }

  async function checkExistingSession() {
    try {
      await initMSAL();
      const accounts = _msalInstance.getAllAccounts();
      if (accounts.length > 0) {
        setLoading(true);
        if (validateDomain(accounts[0])) { grantAccess(accounts[0]); return; }
      }
      showScreen();
      mountNiko();   // sem sessão: agora sim a pessoa vai ver a tela de login
    } catch (e) {
      console.error('[Auth] Erro ao checar sessão:', e);
      showScreen();
      mountNiko();
    }
  }

  async function handleLogin() {
    const errEl = document.getElementById('portal-auth-error');
    if (errEl) errEl.style.display = 'none';
    setLoading(true);
    try {
      await _msalReady; // aguarda MSAL estar carregado antes de prosseguir
      if (!_msalInstance) await initMSAL();

      // Celular: redireciona para a Microsoft (popup trava no mobile).
      // O retorno é tratado por handleRedirectPromise/checkExistingSession.
      if (IS_MOBILE) {
        await _msalInstance.loginRedirect({
          scopes: AUTH.scopes,
          prompt: 'select_account'
        });
        return; // a página navega para a Microsoft; não continua aqui
      }

      // Desktop: tenta popup; se falhar (bloqueado, janela anônima, etc.), cai para redirect.
      const result = await _msalInstance.loginPopup({
        scopes: AUTH.scopes,
        prompt: 'select_account'   // sempre pergunta qual conta usar (evita SSO silencioso)
      });
      if (validateDomain(result.account)) grantAccess(result.account);
    } catch (e) {
      if (e.errorCode === 'user_cancelled') { setLoading(false); return; }
      console.error('[Auth] Login via popup falhou, tentando redirect:', e);
      // Fallback robusto: o popup falha em janela anônima / popup bloqueado / partições
      // de armazenamento. O redirect navega a própria página para a Microsoft e volta
      // autenticado (o retorno é tratado por handleRedirectPromise/checkExistingSession).
      try {
        await _msalInstance.loginRedirect({ scopes: AUTH.scopes, prompt: 'select_account' });
        return; // a página navega para a Microsoft; não continua aqui
      } catch (e2) {
        console.error('[Auth] Login via redirect também falhou:', e2);
        const code = e2.errorCode || e2.name || e.errorCode || e.name || 'erro';
        const aad  = ((e2.errorMessage || e2.message || e.errorMessage || e.message || '').match(/AADSTS\d+/) || [])[0] || '';
        showError('Erro ao fazer login (' + code + (aad ? ' / ' + aad : '') + '). Avise a TI se persistir.');
      }
    }
  }

  // ── Logout global (reset total + sign-out Microsoft) ──────────
  window.portalLogout = async function () {
    console.log('[Auth] 🔒 Logout — desconectando da Microsoft e limpando cache…');

    // 1. Expira todos os cookies do domínio
    try {
      document.cookie.split(';').forEach(c => {
        const name = c.split('=')[0].trim();
        if (name) {
          document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
          document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + location.hostname;
        }
      });
    } catch (e) {}

    // 2. Limpa sessionStorage e storage NÃO-msal (mantém as chaves msal
    //    intactas para o logoutRedirect conseguir identificar a conta)
    try { sessionStorage.clear(); } catch (e) {}
    try {
      Object.keys(localStorage).forEach(k => {
        if (!/msal|login\.windows|\.b2clogin/i.test(k)) localStorage.removeItem(k);
      });
    } catch (e) {}

    // 3. Logout REAL na Microsoft via redirect (encerra a sessão M365 do
    //    navegador). MSAL limpa o próprio cache e volta pro portal.
    try {
      const inst = window._msalAuth || _msalInstance;
      if (inst && typeof inst.logoutRedirect === 'function') {
        const account = inst.getActiveAccount ? inst.getActiveAccount() : null;
        await inst.logoutRedirect({
          account: account || (inst.getAllAccounts && inst.getAllAccounts()[0]) || undefined,
          postLogoutRedirectUri: window.location.origin + '/'
        });
        return; // navega pra Microsoft — não chega aqui
      }
    } catch (e) {
      console.warn('[Auth] logoutRedirect falhou, fazendo limpeza local:', e);
    }

    // 4. Fallback: sem MSAL → limpa tudo e volta pra tela principal
    try { localStorage.clear(); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
    window.location.replace(window.location.origin + '/');
  };

  // ── Bootstrap ─────────────────────────────────────────────────
  // Promise que resolve quando MSAL estiver totalmente carregado
  let _msalReadyResolve;
  const _msalReady = new Promise(res => { _msalReadyResolve = res; });

  function bootstrap() {
    if (typeof window.msal === 'undefined') {
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/@azure/msal-browser@2.38.3/lib/msal-browser.min.js';
      s.onload  = () => { patchPopups(); _msalReadyResolve(); checkExistingSession(); };
      s.onerror = () => { showScreen(); mountNiko(); showError('Erro ao carregar biblioteca de autenticação.'); };
      document.head.appendChild(s);
    } else {
      patchPopups();
      _msalReadyResolve();
      checkExistingSession();
    }
  }

  // O patch dos popups precisa valer ANTES de qualquer pagina chamar loginPopup.
  // Varias paginas carregam o proprio msal-browser (as vezes mais rapido que o
  // unpkg do auth.js), entao vigiamos o window.msal e aplicamos assim que der.
  // patchPopups() e idempotente.
  (function watchMsal() {
    var n = 0;
    var iv = setInterval(function () {
      if (window.msal && window.msal.PublicClientApplication) { patchPopups(); }
      if ((window.msal && window.msal.PublicClientApplication
           && window.msal.PublicClientApplication.prototype.__bmPopupPatched) || ++n > 400) {
        clearInterval(iv);
      }
    }, 30);
  })();

  // Mostra overlay imediatamente para evitar flash de conteúdo
  showScreen();

  // Inicia autenticação após DOM pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bootstrap();
      setTimeout(() => {
        const btn = document.getElementById('portal-auth-btn');
        if (btn) btn.addEventListener('click', handleLogin);
      }, 50);
    });
  } else {
    bootstrap();
    setTimeout(() => {
      const btn = document.getElementById('portal-auth-btn');
      if (btn) btn.addEventListener('click', handleLogin);
    }, 50);
  }

})();
