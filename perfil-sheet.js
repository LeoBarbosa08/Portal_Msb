// ================================================================
// perfil-sheet.js — Portal Biomedical
// Aba "Perfil" na tab bar inferior (mobile) + bottom sheet com os
// dados do usuário e o botão de SAIR (logout).
//
// Motivação: no celular a sidebar vertical (drawer) é a única forma
// de deslogar nas páginas de departamento, e em alguns aparelhos
// (ex.: iPhone) ela não abre. Esta aba deixa o logout sempre a um
// toque de distância, direto na barra inferior, tanto na home quanto
// nas páginas de departamento.
//
// Não faz NADA no desktop (a tab bar é escondida por CSS, então a
// aba injetada some junto). Módulo self-contained, sem dependências.
// ================================================================
(function () {
  'use strict';

  if (window._bmPerfilSheetLoaded) return;      // evita dupla injeção
  window._bmPerfilSheetLoaded = true;

  /* ── Ícones ──────────────────────────────────────────────────── */
  var IC_USER =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  var IC_LOGOUT =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
  var IC_CLOSE =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  /* ── CSS (tema claro, mesma identidade do portal) ───────────────
     Prefixo .bmp- para não colidir com nada existente. O sheet é
     anexado ao <body> e não depende do escopo .home-v2. ── */
  var css = ''
    + '.bmp-tab{text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent;}'
    + '.bmp-overlay{position:fixed;inset:0;z-index:100010;background:rgba(15,23,42,.46);opacity:0;pointer-events:none;transition:opacity .22s ease;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);}'
    + '.bmp-overlay.open{opacity:1;pointer-events:auto;}'
    + '.bmp-sheet{position:fixed;left:0;right:0;bottom:0;z-index:100011;background:#fff;color:#0F172A;'
    +   'border-radius:20px 20px 0 0;box-shadow:0 -18px 60px rgba(15,23,42,.28);'
    +   'transform:translateY(110%);transition:transform .3s cubic-bezier(.2,.7,.2,1);'
    +   'padding:10px 20px calc(22px + env(safe-area-inset-bottom));'
    +   'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;}'
    + '.bmp-sheet.open{transform:translateY(0);}'
    + '.bmp-grip{width:42px;height:5px;border-radius:999px;background:#CBD5E1;margin:2px auto 16px;}'
    + '.bmp-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;}'
    + '.bmp-head-title{font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#94A3B8;}'
    + '.bmp-x{background:#F1F5F9;border:1px solid #E2E8F0;color:#475569;border-radius:9px;padding:6px;display:inline-flex;cursor:pointer;-webkit-tap-highlight-color:transparent;}'
    + '.bmp-x:active{background:#E2E8F0;}'
    + '.bmp-user{display:flex;align-items:center;gap:14px;padding:4px 2px 20px;}'
    + '.bmp-avatar{width:52px;height:52px;flex:0 0 auto;border-radius:50%;display:flex;align-items:center;justify-content:center;'
    +   'background:linear-gradient(135deg,#0C547C,#1272C4);color:#fff;font-size:19px;font-weight:700;letter-spacing:.02em;}'
    + '.bmp-id{min-width:0;flex:1 1 auto;}'
    + '.bmp-name{font-size:17px;font-weight:700;color:#0F172A;line-height:1.25;word-break:break-word;}'
    + '.bmp-email{font-size:13px;color:#64748B;margin-top:2px;word-break:break-all;}'
    + '.bmp-logout{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;'
    +   'padding:15px 18px;border-radius:13px;border:1px solid #FECACA;background:#FEF2F2;color:#DC2626;'
    +   'font-family:inherit;font-size:15.5px;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent;'
    +   'transition:background .14s ease,transform .1s ease;}'
    + '.bmp-logout:active{background:#FEE2E2;transform:scale(.985);}'
    + 'body.bmp-lock{overflow:hidden;}';

  var style = document.createElement('style');
  style.id = 'bmp-css';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  /* ── Helpers ─────────────────────────────────────────────────── */
  function initials(name) {
    var n = String(name || '').trim();
    if (!n) return '?';
    // "Sobrenome, Nome" (formato AD) → usa o nome
    if (n.indexOf(',') > -1) n = (n.split(',')[1] || n).trim();
    var parts = n.split(/\s+/).filter(Boolean);
    var a = (parts[0] || '')[0] || '';
    var b = parts.length > 1 ? (parts[parts.length - 1][0] || '') : '';
    return (a + b).toUpperCase() || '?';
  }

  function doLogout() {
    if (typeof window.portalLogout === 'function') { window.portalLogout(); return; }
    // Fallback: limpa tudo e volta pra tela principal
    try { localStorage.clear(); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
    window.location.replace(window.location.origin + '/');
  }

  /* ── Bottom sheet ────────────────────────────────────────────── */
  var overlay, sheet, elName, elEmail, elAvatar, tabEl;

  function buildSheet() {
    overlay = document.createElement('div');
    overlay.className = 'bmp-overlay';

    sheet = document.createElement('div');
    sheet.className = 'bmp-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Perfil');
    sheet.innerHTML =
      '<div class="bmp-grip"></div>'
      + '<div class="bmp-head">'
      +   '<span class="bmp-head-title">Minha conta</span>'
      +   '<button type="button" class="bmp-x" aria-label="Fechar">' + IC_CLOSE + '</button>'
      + '</div>'
      + '<div class="bmp-user">'
      +   '<div class="bmp-avatar">?</div>'
      +   '<div class="bmp-id">'
      +     '<div class="bmp-name">Carregando…</div>'
      +     '<div class="bmp-email"></div>'
      +   '</div>'
      + '</div>'
      + '<button type="button" class="bmp-logout">' + IC_LOGOUT + '<span>Sair da conta</span></button>';

    document.body.appendChild(overlay);
    document.body.appendChild(sheet);

    elAvatar = sheet.querySelector('.bmp-avatar');
    elName   = sheet.querySelector('.bmp-name');
    elEmail  = sheet.querySelector('.bmp-email');

    overlay.addEventListener('click', close);
    sheet.querySelector('.bmp-x').addEventListener('click', close);
    sheet.querySelector('.bmp-grip').addEventListener('click', close);
    sheet.querySelector('.bmp-logout').addEventListener('click', function () {
      this.disabled = true;
      this.querySelector('span').textContent = 'Saindo…';
      doLogout();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sheet.classList.contains('open')) close();
    });
  }

  function open() {
    fillUser();
    overlay.classList.add('open');
    sheet.classList.add('open');
    document.body.classList.add('bmp-lock');
    if (tabEl) tabEl.classList.add('active');
  }
  function close() {
    overlay.classList.remove('open');
    sheet.classList.remove('open');
    document.body.classList.remove('bmp-lock');
    if (tabEl) tabEl.classList.remove('active');
  }

  function fillUser() {
    var u = window._portalUser || {};
    var name = u.name || u.email || '';
    if (elAvatar) elAvatar.textContent = initials(name);
    if (elName)   elName.textContent = name ? (u.name || u.email) : 'Não identificado';
    if (elEmail)  elEmail.textContent = u.email || '';
  }

  /* ── Aba "Perfil" na tab bar ─────────────────────────────────── */
  function mountTab() {
    var bar = document.querySelector('.hv-tabbar, .bm-tabbar');
    if (!bar || bar.querySelector('.bmp-tab')) return true;   // ainda não existe / já montada

    tabEl = document.createElement('a');
    // .hv-tab cobre o estilo da home; nas páginas de dept o seletor é por
    // tag <a> dentro de .bm-tabbar, então também herda automaticamente.
    tabEl.className = 'hv-tab bmp-tab';
    tabEl.href = '#perfil';
    tabEl.setAttribute('aria-haspopup', 'dialog');
    tabEl.setAttribute('aria-label', 'Perfil e sair');
    tabEl.innerHTML = IC_USER + '<span>Perfil</span>';
    tabEl.addEventListener('click', function (e) {
      e.preventDefault();
      open();
    });
    bar.appendChild(tabEl);

    // a barra tem grid de N colunas fixas; ajusta pro nº real de abas
    bar.style.gridTemplateColumns = 'repeat(' + bar.children.length + ', 1fr)';
    return true;
  }

  /* ── Boot: a tab bar da home é estática; a de dept é criada pelo
     nav-sidebar.js no DOMContentLoaded. Faz polling curto até achar. ── */
  function boot() {
    buildSheet();
    // atualiza os dados assim que o auth.js definir o usuário
    var un = 0, uiv = setInterval(function () {
      if (window._portalUser) { clearInterval(uiv); fillUser(); }
      else if (++un > 200) clearInterval(uiv);
    }, 80);

    var tn = 0, tiv = setInterval(function () {
      var bar = document.querySelector('.hv-tabbar, .bm-tabbar');
      if (bar) { mountTab(); if (bar.querySelector('.bmp-tab')) clearInterval(tiv); }
      if (++tn > 60) clearInterval(tiv);   // ~9s de tentativa
    }, 150);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
