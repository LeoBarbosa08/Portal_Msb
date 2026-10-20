// =====================================================================
// portal-motion.js — motor de animações do Layout v3 (todas as páginas)
// ---------------------------------------------------------------------
// Não depende de biblioteca: IntersectionObserver + CSS (portal-v3.css).
// O que ele faz, na ordem em que a pessoa vê:
//   1. espera a tela de login / o véu de acesso saírem (whenRevealed) e só
//      então faz a ENTRADA da página (hero, cabeçalho, abas, cartões);
//   2. cartões fora da tela ficam esperando e SOBEM EM 3D ao rolar;
//   3. números grandes (KPIs) CONTAM até o valor quando chegam da API;
//   4. cartões clicáveis INCLINAM seguindo o ponteiro (tilt 3D);
//   5. abas ganham a "pílula" navy que desliza; o menu do topo, a "tinta";
//   6. gráficos Chart.js ganham volume 3D (barras com face lateral e tampa,
//      rosca com parede), entrada escalonada e replay ao aparecer na tela;
//      barras HTML (progresso/ranking) ganham brilho de cilindro e crescem;
//   7. home de departamento ganha os blocos Agentes de IA / Automações /
//      Atalhos, montados a partir do MENU LATERAL já podado pelo acesso.
// Movimento reduzido (sistema ou botão do rodapé da home) desliga tudo.
// Nada aqui pode quebrar a página: cada etapa roda dentro de try/catch.
// =====================================================================
(function () {
  'use strict';
  if (window.BM3) return;

  var D = document, W = window, H = D.documentElement;
  var mm = function (q) { return W.matchMedia ? W.matchMedia(q) : { matches: false, addEventListener: function () {} }; };
  var MQ_REDUCE = mm('(prefers-reduced-motion: reduce)');
  var MQ_FINE = mm('(hover: hover) and (pointer: fine)');
  var IO_OK = 'IntersectionObserver' in W;
  var FONT_TEXT = "'Roboto', 'Segoe UI', system-ui, sans-serif";
  var FONT_DISPLAY = "'Roboto', 'Segoe UI', system-ui, sans-serif";
  var inPages = location.pathname.indexOf('/pages/') >= 0;
  var ROOT = inPages ? '../' : '';
  var revealed = false, revealAt = 0;
  var now = function () { return (W.performance && performance.now) ? performance.now() : Date.now(); };

  try { if (localStorage.getItem('bm3-reduce') === '1') H.classList.add('bm3-reduce'); } catch (e) {}
  function reduced() { return !!MQ_REDUCE.matches || H.classList.contains('bm3-reduce'); }
  function safe(fn) { return function () { try { return fn.apply(this, arguments); } catch (e) { if (W.console) console.warn('[bm3]', e); } }; }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function inView(el, pad) {
    var r = el.getBoundingClientRect();
    pad = pad || 0;
    return r.bottom > -pad && r.top < (W.innerHeight || H.clientHeight) + pad && r.right > 0 && r.left < (W.innerWidth || H.clientWidth) && (r.width > 0 || r.height > 0);
  }

  // ------------------------------------------------------------------
  // 1. QUANDO A PÁGINA APARECE — a tela de login (auth.js) cobre tudo e
  //    o nav-sidebar.js ainda põe um véu (visibility:hidden) até decidir o
  //    acesso. Animar antes disso é animar para ninguém.
  // ------------------------------------------------------------------
  function contentVisible() {
    if (D.getElementById('portal-auth-screen')) return false;
    var probe = D.querySelector('.dept-shell') || D.querySelector('.site-header') || D.body.firstElementChild;
    if (!probe) return true;
    return getComputedStyle(probe).visibility !== 'hidden';
  }
  var revealCbs = [];
  function whenRevealed(cb) { if (revealed) { cb(); return; } revealCbs.push(cb); }
  function watchReveal() {
    var t0 = Date.now();
    (function check() {
      if (contentVisible() || Date.now() - t0 > 30000) {
        revealed = true; revealAt = now();
        H.classList.add('bm3-revealed');
        var cbs = revealCbs.splice(0);
        cbs.forEach(function (f) { safe(f)(); });
        return;
      }
      setTimeout(check, 60);
    })();
  }

  // ------------------------------------------------------------------
  // 2. CARTÕES — reconhecidos por classe conhecida OU por aparência
  //    (fundo sólido + raio ≥ 6px + borda ou sombra + tamanho de cartão).
  //    Só o cartão MAIS EXTERNO de cada bloco é animado.
  // ------------------------------------------------------------------
  var KNOWN_CARDS = [
    '.modulo-card', '.kpi-card', '.sr-panel', '.sr-kpi', '.ix-card', '.av-card', '.av-panel', '.av-panel2', '.av-kpi',
    '.fn-panel', '.fn-card', '.fn-kpi', '.ov-card', '.ov-kpi', '.ng-kpi', '.tp-card', '.pv-panel', '.pv-card', '.ffc-kpi',
    '.ac-card', '.fca-forecast-card', '.area-card', '.sistema-card', '.contato-card', '.aviso-card', '.bm3-shortcut'
  ].join(',');
  var TILT_SEL = [
    '.modulo-card', '.area-card', '.sistema-card', '.kpi-card', '.sr-kpi', '.av-kpi', '.fn-kpi', '.ov-kpi', '.ng-kpi',
    '.ffc-kpi', '.ix-card', '.contato-card', '.aviso-card', '.bm3-tilt-me'
  ].join(',');
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, SVG: 1, svg: 1, CANVAS: 1, SELECT: 1, OPTION: 1,
    INPUT: 1, TEXTAREA: 1, BUTTON: 1, IMG: 1, VIDEO: 1, IFRAME: 1, NOSCRIPT: 1, TEMPLATE: 1, LINK: 1, META: 1, BR: 1, HR: 1 };
  var SKIP_CLS = /(^|\s)(site-header|site-footer|area-sidebar|area-header|bm-tabbar|fab-stack|cmdk-overlay|bm3-hero-layers|cp-widget|bmp-sheet|bmp-overlay|sb-overlay|fx-head|fx-tabs|fx-filters|fxdd-panel|av-dd-panel)(\s|$)/;
  var IN_CARD = KNOWN_CARDS + ', .bm3-card';
  // contêineres que NUNCA são o cartão (mesmo quando o CSS os pinta como
  // painel por um instante): os filhos é que sobem, um a um
  var NOCARD = '.areas-section, .sistemas-section, .contato-section, .modulos-section, .bm3-block, .dept-main, .area-body, .area-main, .area-grid';

  function isTransparent(c) { return !c || c === 'transparent' || /rgba\([^)]*,\s*0(\.0+)?\s*\)$/.test(c); }
  function rgbList(s) { return (String(s).match(/rgba?\([^)]*\)/g) || []).map(function (x) { var m = x.match(/[\d.]+/g) || []; return [+m[0], +m[1], +m[2], m[3] != null ? +m[3] : 1]; }); }
  function grayish(c) { var v = rgbList(c)[0]; return !!v && v[0] > 195 && v[1] > 195 && v[2] > 195 && Math.max(v[0], v[1], v[2]) - Math.min(v[0], v[1], v[2]) < 34; }
  function subtleShadow(s) {
    if (!s || s === 'none') return true;
    var cs = rgbList(s); if (!cs.length) return false;
    return cs.every(function (v) { return v[3] <= 0.16 && Math.max(v[0], v[1], v[2]) < 90; });
  }
  function cardLike(el) {
    if (el.matches && el.matches(KNOWN_CARDS)) return true;
    if (el.matches && el.matches(NOCARD)) return false;
    var w = el.offsetWidth, h = el.offsetHeight;
    if (w < 140 || h < 60) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'inline' || cs.display === 'contents' || cs.position === 'fixed' || cs.position === 'absolute') return false;
    var hasImg = cs.backgroundImage && cs.backgroundImage !== 'none';
    if (isTransparent(cs.backgroundColor) && !hasImg) return false;
    if ((parseFloat(cs.borderTopLeftRadius) || 0) < 6) return false;
    var hasBorder = (parseFloat(cs.borderTopWidth) || 0) > 0 || (parseFloat(cs.borderLeftWidth) || 0) > 0;
    var hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
    return hasBorder || hasShadow || hasImg;
  }
  function scanCards(root, out, depth) {
    out = out || []; depth = depth || 0;
    if (!root || depth > 11) return out;
    for (var c = root.firstElementChild; c; c = c.nextElementSibling) {
      if (SKIP_TAGS[c.tagName]) continue;
      var cls = typeof c.className === 'string' ? c.className : '';
      if (SKIP_CLS.test(cls) || c.id === 'cp-widget' || c.hidden) continue;
      if (c.__bm3card) { continue; }
      if (cardLike(c)) {
        c.__bm3card = 1; out.push(c);
        decorateCard(c);
        continue;
      }
      scanCards(c, out, depth + 1);
    }
    return out;
  }
  // Cartão reconhecido só pela aparência: ganha o acabamento do layout
  // (raio grande, borda e sombra da paleta nova) SEM perder cor semântica —
  // borda colorida (alerta, status) e sombra colorida ficam como estão.
  function decorateCard(el) {
    if (!el.matches(KNOWN_CARDS)) {
      el.classList.add('bm3-card');
      var cs = getComputedStyle(el);
      var r = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomLeftRadius, cs.borderBottomRightRadius];
      var uniform = r[0] === r[1] && r[1] === r[2] && r[2] === r[3] && (parseFloat(r[0]) || 0) >= 8;
      var fc = el.firstElementChild;
      var clipSafe = /hidden|clip/.test(cs.overflow) || !fc || isTransparent(getComputedStyle(fc).backgroundColor);
      if (uniform && clipSafe && el.offsetHeight > 90) el.classList.add('bm3-r');
      if ((parseFloat(cs.borderTopWidth) || 0) > 0 && grayish(cs.borderTopColor)) el.classList.add('bm3-bline');
      if (!isTransparent(cs.backgroundColor) && subtleShadow(cs.boxShadow)) el.classList.add('bm3-sh');
    }
    if (el.matches(TILT_SEL)) el.classList.add('bm3-tilt');
  }
  function markTilt(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches(TILT_SEL)) root.classList.add('bm3-tilt');
    root.querySelectorAll(TILT_SEL).forEach(function (el) { el.classList.add('bm3-tilt'); });
  }

  // ------------------------------------------------------------------
  // 3. REVELAÇÃO — entrada escalonada + sobe-ao-rolar
  // ------------------------------------------------------------------
  var rvIO = null;
  function playIn(el, delay) {
    if (!el || el.__bm3played) return;
    el.__bm3played = 1;
    el.classList.remove('bm3-rv');
    if (reduced()) return;
    var tall = el.offsetHeight > 620;
    el.style.setProperty('--bm3-d', (delay || 0) + 'ms');
    el.classList.add('bm3-in');
    if (!tall && el.__bm3kind !== 'flat') el.classList.add('bm3-3d');
    var done = function (e) {
      if (e && e.target !== el) return;
      el.classList.remove('bm3-in', 'bm3-3d');
      el.style.removeProperty('--bm3-d');
      el.removeEventListener('animationend', done);
    };
    el.addEventListener('animationend', done);
    setTimeout(done, 1600 + (delay || 0));
    countUpWithin(el, delay);
  }
  function ensureIO() {
    if (rvIO || !IO_OK) return rvIO;
    rvIO = new IntersectionObserver(function (entries) {
      var batch = entries.filter(function (e) { return e.isIntersecting; }).map(function (e) { return e.target; });
      if (!batch.length || !revealed) return;
      batch.sort(function (a, b) { var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return (ra.top - rb.top) || (ra.left - rb.left); });
      batch.forEach(function (el, i) { rvIO.unobserve(el); playIn(el, Math.min(i, 8) * 60); });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0 });   // 0: cartão mais alto que a tela também dispara
    return rvIO;
  }
  // prepara um alvo: antes da página aparecer, TODO alvo espera; depois,
  // só quem está fora da tela espera (quem está à vista já foi visto).
  function arm(el, kind) {
    if (!el || el.__bm3armed || reduced() || !IO_OK) return;
    el.__bm3armed = 1;
    if (kind) el.__bm3kind = kind;
    if (!revealed) { el.classList.add('bm3-rv'); ensureIO().observe(el); return; }
    if (inView(el, 0)) { el.__bm3played = 1; return; }
    el.classList.add('bm3-rv'); ensureIO().observe(el);
  }
  function revealAll() {
    D.querySelectorAll('.bm3-rv').forEach(function (el) { el.classList.remove('bm3-rv'); el.__bm3played = 1; });
    D.querySelectorAll('.bm3-wait').forEach(function (el) { el.classList.remove('bm3-wait'); });
  }
  W.addEventListener('beforeprint', revealAll);

  function entrance() {
    var list = [];
    D.querySelectorAll('.bm3-rv').forEach(function (el) { if (!el.__bm3played && inView(el, 0)) list.push(el); });
    list.sort(function (a, b) { var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return (Math.round(ra.top / 40) - Math.round(rb.top / 40)) || (ra.left - rb.left); });
    list.forEach(function (el, i) { if (rvIO) rvIO.unobserve(el); playIn(el, Math.min(i, 10) * 70); });
  }

  // ------------------------------------------------------------------
  // 4. NÚMEROS QUE CONTAM — "R$ 5.162,61", "89,70%", "4.089", "R$ 1,42 mi"
  // ------------------------------------------------------------------
  var NUM_RE = /[-−]?\d{1,3}(?:\.\d{3})+(?:,\d+)?|[-−]?\d+(?:,\d+)?/g;
  var written = new WeakMap();
  var lastRun = new WeakMap();
  function numberParts(txt) {
    var m = txt.match(NUM_RE);
    if (!m || m.length !== 1) return null;
    var tok = m[0];
    if (/^\d{4}$/.test(tok) && +tok >= 1990 && +tok <= 2100) return null;       // ano
    // só "número com unidade" conta ("R$ 1,42 mi", "89,7%", "4.089"); texto
    // com número no meio ("Top 10", "12 pedidos") fica como está
    var rest = txt.replace(tok, '').replace(/R\$|US\$|€|%|mi\b|mil\b|bi\b|\bk\b|\bx\b|p\.p\.|pp\b|[\s+·()\-−]/gi, '');
    if (rest.length > 2) return null;
    var neg = /^[-−]/.test(tok);
    var body = tok.replace(/^[-−]/, '');
    var dec = (body.split(',')[1] || '').length;
    var val = parseFloat(body.replace(/\./g, '').replace(',', '.'));
    if (!isFinite(val) || val === 0) return null;
    var i = txt.indexOf(tok);
    return { pre: txt.slice(0, i), post: txt.slice(i + tok.length), val: neg ? -val : val, dec: dec, group: /\d\.\d{3}/.test(body), minus: neg ? tok.charAt(0) : '' };
  }
  function fmtNum(v, p) {
    var a = Math.abs(v);
    var s = a.toLocaleString('pt-BR', { minimumFractionDigits: p.dec, maximumFractionDigits: p.dec, useGrouping: p.group });
    return p.pre + (v < 0 ? (p.minus || '-') : '') + s + p.post;
  }
  function textNodeOf(el) {
    if (el.childNodes.length === 1 && el.firstChild.nodeType === 3) return el.firstChild;
    return null;
  }
  function countUp(el, from, delay) {
    if (reduced()) return;
    var tn = textNodeOf(el); if (!tn) return;
    var target = tn.nodeValue;
    var p = numberParts(target); if (!p) return;
    var prevRun = lastRun.get(el);
    if (prevRun && prevRun.raf) cancelAnimationFrame(prevRun.raf);
    var start = (typeof from === 'number' && isFinite(from)) ? from : 0;
    if (Math.abs(start - p.val) < 1e-9) return;
    var dur = 1100, t0 = 0, run = { raf: 0 }, ultimo = target;
    lastRun.set(el, run);
    el.classList.add('bm3-counting');
    var step = function (t) {
      if (!t0) t0 = t + (delay || 0);
      var k = Math.max(0, Math.min(1, (t - t0) / dur));
      var e = 1 - Math.pow(1 - k, 4);
      var node = textNodeOf(el);
      if (!node) return;                                   // a página redesenhou: desiste
      // a página reescreveu o texto no meio da conta com algo que não conta
      // ("8 neg.", "R$ 0", "—"): desiste — senão o fim da animação devolvia
      // o número velho por cima do novo
      if (node.nodeValue !== ultimo) { el.classList.remove('bm3-counting'); run.raf = 0; return; }
      var txt = k >= 1 ? target : fmtNum(start + (p.val - start) * e, p);
      written.set(el, txt);
      node.nodeValue = txt; ultimo = txt;
      if (k < 1) run.raf = requestAnimationFrame(step);
      else { el.classList.remove('bm3-counting'); run.raf = 0; }
    };
    run.raf = requestAnimationFrame(step);
  }
  function bigNumber(el) {
    if (!el || el.nodeType !== 1 || el.closest('table, select, option, svg, .cmdk-overlay, [contenteditable], .fxdd-panel, .av-dd-panel, #cp-widget')) return false;
    var tn = textNodeOf(el); if (!tn) return false;
    var t = tn.nodeValue.trim();
    if (!t || t.length > 28 || !/\d/.test(t)) return false;
    if (!numberParts(t)) return false;
    var fs = parseFloat(getComputedStyle(el).fontSize) || 0;
    return fs >= 20 && el.offsetParent !== null;
  }
  function countUpWithin(root, delay) {
    if (reduced() || !root.querySelectorAll) return;
    var n = 0;
    var els = root.querySelectorAll('b, strong, span, div, p, h1, h2, h3, h4, h5');
    for (var i = 0; i < els.length && n < 10; i++) {
      var el = els[i];
      if (el.childElementCount || !bigNumber(el)) continue;
      n++; countUp(el, 0, (delay || 0) + 120);
    }
  }
  function onTextChange(el, oldTxt) {
    if (!revealed || !el || !bigNumber(el)) return;
    var cur = textNodeOf(el).nodeValue;
    if (written.get(el) === cur) return;                    // fui eu que escrevi
    if (!inView(el, 40)) { written.set(el, cur); return; }
    var from = 0;
    if (oldTxt) { var po = numberParts(oldTxt.trim()); if (po) from = po.val; }
    countUp(el, from, 0);
  }

  // ------------------------------------------------------------------
  // 5. TILT 3D — delegado no documento, 1 frame por movimento
  // ------------------------------------------------------------------
  function setupTilt() {
    if (!MQ_FINE.matches) return;
    var cur = null, raf = 0, lastE = null;
    function leave(el) {
      if (!el) return;
      el.classList.remove('is-hover');
      el.style.removeProperty('--bm3-rx'); el.style.removeProperty('--bm3-ry');
    }
    function frame() {
      raf = 0;
      var e = lastE; if (!e || reduced()) return;
      var el = e.target && e.target.closest ? e.target.closest('.bm3-tilt') : null;
      if (el !== cur) {
        leave(cur); cur = el;
        if (el) {
          el.classList.add('is-hover');
          if (!el.__bm3spot) { el.__bm3spot = 1; var bi = getComputedStyle(el).backgroundImage; if (!bi || bi === 'none') el.classList.add('bm3-spot'); }
        }
      }
      if (!cur) return;
      var r = cur.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      var max = r.width > 520 || r.height > 320 ? 3 : (cur.matches('.modulo-card, .area-card, .bm3-agent') ? 9 : 6);
      cur.style.setProperty('--bm3-rx', (-py * max).toFixed(2) + 'deg');
      cur.style.setProperty('--bm3-ry', (px * max).toFixed(2) + 'deg');
      cur.style.setProperty('--bm3-gx', ((px + 0.5) * 100).toFixed(1) + '%');
      cur.style.setProperty('--bm3-gy', ((py + 0.5) * 100).toFixed(1) + '%');
    }
    D.addEventListener('pointermove', function (e) { if (e.pointerType && e.pointerType !== 'mouse') return; lastE = e; if (!raf) raf = requestAnimationFrame(frame); }, { passive: true });
    D.addEventListener('pointerleave', function () { leave(cur); cur = null; }, { passive: true });
    W.addEventListener('blur', function () { leave(cur); cur = null; });
  }

  // ------------------------------------------------------------------
  // 6. MENU DO TOPO — "tinta" que desliza sob o item ativo / em foco
  // ------------------------------------------------------------------
  function setupNavInk() {
    var nav = D.querySelector('.site-header .header-nav');
    if (!nav || nav.querySelector('.bm3-ink')) return;
    var ink = D.createElement('span'); ink.className = 'bm3-ink'; ink.setAttribute('aria-hidden', 'true');
    nav.appendChild(ink); nav.classList.add('bm3-has-ink');
    function place(a) {
      if (!a) { ink.style.opacity = '0'; return; }
      ink.style.width = Math.max(0, a.offsetWidth - 28) + 'px';
      ink.style.transform = 'translateX(' + (a.offsetLeft + 14) + 'px)';
      ink.style.opacity = '1';
    }
    function active() { return nav.querySelector('a.active, a[aria-current="page"]'); }
    W.BM3_placeInk = function () { place(active()); };
    nav.addEventListener('mouseover', function (e) { var a = e.target.closest('a'); if (a && nav.contains(a)) place(a); });
    nav.addEventListener('mouseleave', function () { place(active()); });
    W.addEventListener('resize', function () { place(active()); });
    // o nav-sidebar marca "Áreas" depois; a home troca o ativo ao rolar
    new MutationObserver(function () { place(active()); }).observe(nav, { attributes: true, subtree: true, attributeFilter: ['class', 'aria-current'] });
    if (D.fonts && D.fonts.ready) D.fonts.ready.then(function () { place(active()); });
    place(active());
  }

  // ------------------------------------------------------------------
  // 7. ABAS — pílula navy deslizante (continua de uma página para outra)
  // ------------------------------------------------------------------
  function setupTabs() {
    D.querySelectorAll('.fx-tabs').forEach(safe(function (bar) {
      if (bar.__bm3tabs) return; bar.__bm3tabs = 1;
      var act = bar.querySelector('.active'); if (!act) return;
      // <i> e não <span>: as páginas estilizam ".fx-tabs span" (a aba ativa é um span)
      var th = D.createElement('i'); th.className = 'bm3-tab-thumb'; th.setAttribute('aria-hidden', 'true');
      bar.insertBefore(th, bar.firstChild);
      bar.classList.add('bm3-has-thumb');
      var sig = 'bm3-tab:' + Array.prototype.map.call(bar.querySelectorAll('a, span'), function (a) { return a.textContent.trim(); }).join('|').slice(0, 300);
      function place(el, instant) {
        if (!el) return;
        if (instant) th.style.transition = 'none';
        th.style.width = el.offsetWidth + 'px';
        th.style.height = el.offsetHeight + 'px';
        th.style.transform = 'translate(' + el.offsetLeft + 'px,' + el.offsetTop + 'px)';
        th.style.opacity = '1';
        if (instant) { void th.offsetWidth; th.style.transition = ''; }
      }
      var prev = null;
      try { prev = JSON.parse(sessionStorage.getItem(sig) || 'null'); sessionStorage.removeItem(sig); } catch (e) {}
      if (prev && !reduced() && typeof prev.x === 'number') {
        th.style.transition = 'none';
        th.style.width = prev.w + 'px'; th.style.height = act.offsetHeight + 'px';
        th.style.transform = 'translate(' + prev.x + 'px,' + act.offsetTop + 'px)';
        th.style.opacity = '1';
        void th.offsetWidth; th.style.transition = '';
        whenRevealed(function () { setTimeout(function () { place(act); }, 120); });
      } else {
        place(act, true);
      }
      // rola a aba ativa para a vista (abas em uma linha só)
      function fades() {
        var max = bar.scrollWidth - bar.clientWidth;
        bar.classList.toggle('bm3-fade-l', bar.scrollLeft > 4);
        bar.classList.toggle('bm3-fade-r', max - bar.scrollLeft > 4);
      }
      if (bar.scrollWidth > bar.clientWidth + 4) {
        var target = act.offsetLeft - (bar.clientWidth - act.offsetWidth) / 2;
        bar.style.scrollBehavior = 'auto'; bar.scrollLeft = Math.max(0, target); bar.style.scrollBehavior = '';
      }
      fades();
      bar.addEventListener('scroll', fades, { passive: true });
      bar.addEventListener('click', function (e) {
        var a = e.target.closest('a'); if (!a || a.classList.contains('active')) return;
        if (e.ctrlKey || e.metaKey || e.shiftKey || a.target === '_blank') return;
        try { sessionStorage.setItem(sig, JSON.stringify({ x: act.offsetLeft, w: act.offsetWidth })); } catch (err) {}
        place(a);
      });
      W.addEventListener('resize', function () { place(bar.querySelector('.active'), true); fades(); });
      if (D.fonts && D.fonts.ready) D.fonts.ready.then(function () { place(bar.querySelector('.active'), true); fades(); });
    }));
  }

  // ------------------------------------------------------------------
  // 8. HERO DO DEPARTAMENTO — camadas de vidro + título palavra a palavra
  // ------------------------------------------------------------------
  function splitWords(h, base) {
    if (!h || h.__bm3split || h.childElementCount || reduced()) return;
    var txt = h.textContent; if (!txt || txt.length > 90) return;
    h.__bm3split = 1;
    var words = txt.trim().split(/\s+/);
    h.innerHTML = words.map(function (w, i) {
      return '<span class="bm3-w"><span style="--bm3-d:' + (base + i * 80) + 'ms">' + esc(w) + '</span></span>';
    }).join(' ');
    h.classList.add('bm3-words');
    setTimeout(function () { if (h.classList.contains('bm3-words') && h.querySelector('.bm3-w')) { h.textContent = txt; h.classList.remove('bm3-words'); } }, base + words.length * 80 + 1500);
  }
  function setupHero() {
    var hero = D.querySelector('body.dshell .area-header');
    if (!hero || hero.querySelector('.bm3-hero-layers')) return;
    var lay = D.createElement('div');
    lay.className = 'bm3-hero-layers'; lay.setAttribute('aria-hidden', 'true');
    lay.innerHTML = '<span class="bm3-par" data-depth="10" style="position:absolute;inset:0"><span class="bm3-glass bm3-glass--1"></span></span>' +
      '<span class="bm3-par" data-depth="20" style="position:absolute;inset:0"><span class="bm3-glass bm3-glass--2"></span></span>' +
      '<span class="bm3-par" data-depth="30" style="position:absolute;inset:0"><span class="bm3-glass bm3-glass--3"></span></span>';
    hero.insertBefore(lay, hero.firstChild);
    if (MQ_FINE.matches) {
      var pars = lay.querySelectorAll('.bm3-par'), raf = 0, lx = 0, ly = 0;
      D.addEventListener('pointermove', function (e) {
        lx = e.clientX / (W.innerWidth || 1) - 0.5; ly = e.clientY / (W.innerHeight || 1) - 0.5;
        if (raf || reduced()) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          pars.forEach(function (p) { var d = +p.getAttribute('data-depth') || 10; p.style.translate = (lx * d).toFixed(1) + 'px ' + (ly * d).toFixed(1) + 'px'; });
        });
      }, { passive: true });
    }
    var dots = hero.querySelectorAll('.dv-dot');
    dots.forEach(function (d) { d.style.position = 'relative'; });
  }

  // ------------------------------------------------------------------
  // 9. CABEÇALHO — sino (alertas da home) + avatar com menu da conta
  // ------------------------------------------------------------------
  var IC = {
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
    motion: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
    bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M12 11V7"/><circle cx="12" cy="5" r="2"/><circle cx="8" cy="16" r="1" fill="currentColor"/><circle cx="16" cy="16" r="1" fill="currentColor"/></svg>',
    zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    arrow: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>'
  };
  function initials(name) {
    var p = String(name || '').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
    return ((p[0] || '?').charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase();
  }
  function alertCount() {
    try {
      var c = JSON.parse(sessionStorage.getItem('bm-alertas-v1') || 'null');
      if (!c || !c.r || Date.now() - c.em > 30 * 60 * 1000) return 0;
      var eu = String((W._portalUser && W._portalUser.email) || '').toLowerCase();
      var dono = String((c.r.papel && c.r.papel.email) || '').toLowerCase();
      if (!eu || (dono && dono !== eu)) return 0;
      return (c.r.itens || []).filter(function (i) { return i.tipo === 'aprovacao' || i.prioridade === 'alta'; }).length;
    } catch (e) { return 0; }
  }
  function setupHeaderActions() {
    var hc = D.querySelector('.site-header .container');
    if (!hc || hc.querySelector('.bm3-avatar')) return;
    var home = D.body.classList.contains('home-v2');
    var box = hc.querySelector('.hv-head-actions');
    if (!box) {
      box = D.createElement('div'); box.className = 'bm3-hd-actions';
      box.innerHTML = '<a class="bm3-iconbtn bm3-bell" href="' + ROOT + 'index.html#alertas" aria-label="Alertas para você" title="Alertas para você">' + IC.bell + '<span class="bm3-badge" hidden></span></a>';
      hc.appendChild(box);
    }
    var av = D.createElement('button');
    av.type = 'button'; av.className = 'bm3-avatar'; av.setAttribute('aria-label', 'Sua conta'); av.setAttribute('aria-expanded', 'false');
    av.textContent = '··';
    var menu = D.createElement('div'); menu.className = 'bm3-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
    box.appendChild(av); box.appendChild(menu);
    function paint() {
      var u = W._portalUser; if (!u) return false;
      av.textContent = initials(u.name || u.email);
      menu.innerHTML = '<div class="bm3-menu-head"><span class="bm3-avatar" aria-hidden="true">' + esc(initials(u.name || u.email)) + '</span><div style="min-width:0"><strong>' + esc(u.name || 'Usuário') + '</strong><small>' + esc(u.email || '') + '</small></div></div>' +
        // Tema claro/escuro: o seletor e o clique são do portal-tema.js
        (W.BMTema && W.BMTema.seletorHtml ? W.BMTema.seletorHtml() : '') +
        (home ? '' : '<a href="' + ROOT + 'index.html" role="menuitem">' + IC.home + 'Voltar ao portal</a>') +
        '<button type="button" class="bm3-menu-item" data-bm3="motion" role="menuitem">' + IC.motion + (reduced() ? 'Ligar animações' : 'Reduzir animações') + '</button>' +
        '<button type="button" class="bm3-menu-item is-danger" data-bm3="sair" role="menuitem">' + IC.out + 'Sair da conta</button>';
      var n = alertCount(), b = box.querySelector('.bm3-bell .bm3-badge');
      if (b) { b.textContent = n > 9 ? '9+' : String(n); b.hidden = !n; }
      if (n && !reduced()) {
        var bell = box.querySelector('.bm3-bell');
        try { if (!sessionStorage.getItem('bm3-rang')) { sessionStorage.setItem('bm3-rang', '1'); setTimeout(function () { bell.classList.add('bm3-ring'); }, 900); } } catch (e) {}
      }
      return true;
    }
    if (!paint()) {
      D.addEventListener('portalauth:ready', function () { setTimeout(paint, 0); });
      var n = 0, iv = setInterval(function () { if (paint() || ++n > 120) clearInterval(iv); }, 250);
    }
    function open(v) { menu.hidden = !v; av.setAttribute('aria-expanded', v ? 'true' : 'false'); }
    av.addEventListener('click', function (e) { e.stopPropagation(); if (!W._portalUser) return; open(menu.hidden); });
    menu.addEventListener('click', function (e) {
      var b = e.target.closest('[data-bm3]'); if (!b) return;
      if (b.getAttribute('data-bm3') === 'sair') { open(false); if (typeof W.portalLogout === 'function') W.portalLogout(); }
      if (b.getAttribute('data-bm3') === 'motion') { BM3.setReduced(!reduced()); paint(); }
    });
    D.addEventListener('click', function (e) { if (!menu.hidden && !menu.contains(e.target) && e.target !== av) open(false); });
    D.addEventListener('keydown', function (e) { if (e.key === 'Escape') open(false); });
  }

  // ------------------------------------------------------------------
  // 10. HOME DO DEPARTAMENTO — Agentes de IA / Automações / Atalhos
  //     A fonte é o MENU LATERAL (já podado pelo nav-sidebar.js): quem não
  //     pode abrir um agente não vê o cartão. Os cartões são a.modulo-card,
  //     então a poda de acesso (bmPodarNavegacao) também passa por eles.
  // ------------------------------------------------------------------
  function setupDeptHome() {
    if (!D.body.classList.contains('dept-home') || D.getElementById('bm3-agentes')) return;
    var nav = D.querySelector('.area-sidebar nav'); if (!nav) return;
    var anchor = D.querySelector('.modulos-section'); if (!anchor) return;
    var dept = (D.querySelector('.area-sidebar .sb-tt') || {}).textContent || '';
    var g = { agentes: [], automacoes: [], atalhos: [] }, cur = null, seen = {};
    Array.prototype.forEach.call(nav.children, function (el) {
      if (el.classList.contains('sb-section')) { var t = norm(el.textContent); cur = /agente/.test(t) ? 'agentes' : /automa/.test(t) ? 'automacoes' : /atalho/.test(t) ? 'atalhos' : null; return; }
      if (!cur || el.tagName !== 'A') return;
      var href = el.getAttribute('href') || '';
      var lbl = (el.querySelector('.sb-lbl') || el).textContent.trim();
      if (!href || href === '#' || seen[cur + href + '|' + lbl]) return;
      seen[cur + href + '|' + lbl] = 1;
      g[cur].push({ href: href, label: lbl, ext: el.getAttribute('target') === '_blank' });
    });
    var html = '';
    function block(id, title, sub, inner) {
      return '<section class="bm3-block" id="' + id + '"><div class="container"><div class="fin-subhead"><h2>' + title + '</h2><span class="sub">' + sub + '</span></div>' + inner + '</div></section>';
    }
    function card(it, kind) {
      var ia = kind === 'agente';
      return '<a href="' + esc(it.href) + '" class="modulo-card bm3-' + (ia ? 'agent' : 'auto') + '" data-tone="' + (ia ? 'agente' : 'auto') + '">' +
        '<div class="mc-top"><span class="mc-icon">' + (ia ? IC.bot : IC.zap) + '</span>' +
        '<span class="bm3-tag ' + (ia ? 'bm3-tag--ia' : 'bm3-tag--auto') + '"><span class="bm3-dot"></span>' + (ia ? 'Agente de IA' : 'Automação') + '</span></div>' +
        '<span class="mc-name">' + esc(it.label) + '</span>' +
        '<span class="mc-desc">' + (ia ? 'Assistente com IA' : 'Rotina automática') + (dept ? ' · ' + esc(dept.trim()) : '') + '</span>' +
        '<span class="mc-open">' + (ia ? 'Abrir agente ' : 'Abrir automação ') + IC.arrow + '</span></a>';
    }
    if (g.agentes.length) html += block('bm3-agentes', 'Agentes de IA', 'Assistentes com IA desta área', '<div class="bm3-card-grid">' + g.agentes.map(function (a) { return card(a, 'agente'); }).join('') + '</div>');
    if (g.automacoes.length) html += block('bm3-automacoes', 'Automações', 'Rotinas que rodam sozinhas', '<div class="bm3-card-grid">' + g.automacoes.map(function (a) { return card(a, 'auto'); }).join('') + '</div>');
    if (g.atalhos.length) html += block('bm3-atalhos', 'Atalhos', 'Sistemas e links usados pela área',
      '<div class="bm3-shortcut-row">' + g.atalhos.map(function (a) {
        return '<a class="bm3-shortcut" href="' + esc(a.href) + '"' + (a.ext ? ' target="_blank" rel="noopener"' : '') + '><span class="bm3-tint">' + IC.ext + '</span>' + esc(a.label) + '</a>';
      }).join('') + '</div>');
    if (!html) return;
    var holder = D.createElement('div'); holder.innerHTML = html;
    var frag = D.createDocumentFragment();
    while (holder.firstChild) frag.appendChild(holder.firstChild);
    anchor.parentNode.insertBefore(frag, anchor.nextSibling);
    // mesma poda de acesso dos módulos, no mesmo tique (nada pisca na tela)
    if (typeof W.bmPodarNavegacao === 'function') { try { W.bmPodarNavegacao(); } catch (e) {} }
    ['bm3-agentes', 'bm3-automacoes'].forEach(function (id) { var s = D.getElementById(id); if (s && !s.querySelector('.modulo-card')) s.remove(); });
  }

  // ------------------------------------------------------------------
  // 11. BARRAS HTML — progresso, ranking, colunas feitas de <div>
  // ------------------------------------------------------------------
  var WRE = /(?:^|;)\s*width\s*:\s*[\d.]+%/i, HRE = /(?:^|;)\s*height\s*:\s*[\d.]+%/i;
  var barIO = null;
  function growBar(el, delay) {
    if (!el.classList.contains('bm3-wait') && el.__bm3grown) return;
    el.__bm3grown = 1;
    el.classList.remove('bm3-wait');
    if (reduced()) return;
    var cls = el.classList.contains('bm3-vbar') ? 'bm3-grow-y' : 'bm3-grow-x';
    el.style.setProperty('--bm3-d', (delay || 0) + 'ms');
    el.classList.add(cls);
    var done = function () { el.classList.remove(cls); el.style.removeProperty('--bm3-d'); el.removeEventListener('animationend', done); };
    el.addEventListener('animationend', done);
    setTimeout(done, 1500 + (delay || 0));
  }
  function scanBars(root) {
    if (!root || !root.querySelectorAll) return;
    var list = root.querySelectorAll('[style*="width"], [style*="height"]');
    var fresh = [];
    for (var i = 0, n = 0; i < list.length && n < 700; i++) {
      var el = list[i];
      if (el.__bm3bar) continue;
      var st = el.getAttribute('style') || '';
      var isW = WRE.test(st), isH = !isW && HRE.test(st);
      if (!isW && !isH) continue;
      n++;
      el.__bm3bar = 1;
      if (el.closest('svg, .cmdk-overlay, #cp-widget, .fxdd-panel, .av-dd-panel, .bm3-hero-layers')) continue;
      var p = el.parentElement; if (!p) continue;
      var w = el.offsetWidth, h = el.offsetHeight, pw = p.offsetWidth, ph = p.offsetHeight;
      var cs = getComputedStyle(el);
      var bgi = cs.backgroundImage && cs.backgroundImage !== 'none';
      if (isTransparent(cs.backgroundColor) && !bgi) continue;
      if (isW && h >= 3 && h <= 26 && pw >= 40 && ph <= 34) {
        el.classList.add('bm3-hbar'); if (!bgi) el.classList.add('bm3-gloss');
        var pcs = getComputedStyle(p);
        if (!isTransparent(pcs.backgroundColor) && ph <= 30) p.classList.add('bm3-track');
        fresh.push(el);
      } else if (isH && w >= 3 && w <= 90 && ph >= 40) {
        el.classList.add('bm3-vbar'); if (!bgi) el.classList.add('bm3-gloss');
        fresh.push(el);
      }
    }
    if (!fresh.length || reduced()) return;
    if (!barIO && IO_OK) {
      barIO = new IntersectionObserver(function (es) {
        if (!revealed) return;
        var vis = es.filter(function (e) { return e.isIntersecting; }).map(function (e) { return e.target; });
        vis.forEach(function (el, i) { barIO.unobserve(el); growBar(el, Math.min(i, 14) * 55); });
      }, { threshold: 0.2 });
    }
    fresh.forEach(function (el) {
      if (revealed && inView(el, 0) && !el.closest('.bm3-rv')) { growBar(el, 0); return; }
      el.classList.add('bm3-wait');
      if (barIO) barIO.observe(el); else growBar(el, 0);
    });
  }
  function growVisibleBars() {
    D.querySelectorAll('.bm3-wait').forEach(function (el, i) { if (inView(el, 0)) { if (barIO) barIO.unobserve(el); growBar(el, Math.min(i, 14) * 55); } });
  }

  // ------------------------------------------------------------------
  // 12. CHART.JS — volume 3D, entrada escalonada, replay ao aparecer
  // ------------------------------------------------------------------
  var colorCache = {};
  var probeCtx = null;
  function rgbaOf(c) {
    if (typeof c !== 'string') return null;
    if (colorCache[c]) return colorCache[c];
    if (!probeCtx) { var cv = D.createElement('canvas'); cv.width = cv.height = 1; probeCtx = cv.getContext('2d'); }
    probeCtx.fillStyle = '#000'; probeCtx.fillStyle = c;
    var s = probeCtx.fillStyle, out;
    if (s.charAt(0) === '#') out = [parseInt(s.substr(1, 2), 16), parseInt(s.substr(3, 2), 16), parseInt(s.substr(5, 2), 16), 1];
    else { var m = s.match(/[\d.]+/g) || [0, 0, 0, 1]; out = [+m[0], +m[1], +m[2], m[3] != null ? +m[3] : 1]; }
    colorCache[c] = out;
    return out;
  }
  // cor semitransparente → a MESMA cor já composta sobre o branco (sólida):
  // a grade deixa de aparecer através da coluna e o volume 3D fica nítido
  function solid(c) {
    if (typeof c !== 'string') return c;
    var v = rgbaOf(c); if (!v || v[3] >= 0.99 || v[3] < 0.3) return c;
    var a = v[3];
    return 'rgb(' + Math.round(v[0] * a + 255 * (1 - a)) + ',' + Math.round(v[1] * a + 255 * (1 - a)) + ',' + Math.round(v[2] * a + 255 * (1 - a)) + ')';
  }
  function shade(c, amt) {
    var v = rgbaOf(c) || [31, 111, 214, 1];
    var t = amt < 0 ? 0 : 255, k = Math.abs(amt);
    return 'rgba(' + Math.round(v[0] + (t - v[0]) * k) + ',' + Math.round(v[1] + (t - v[1]) * k) + ',' + Math.round(v[2] + (t - v[2]) * k) + ',' + v[3] + ')';
  }
  function barRect(el) {
    var p = el.getProps(['x', 'y', 'base', 'width', 'height']);
    var L, R, T, B;
    if (el.horizontal) { var h2 = p.height / 2; L = Math.min(p.x, p.base); R = Math.max(p.x, p.base); T = p.y - h2; B = p.y + h2; }
    else { var w2 = p.width / 2; L = p.x - w2; R = p.x + w2; T = Math.min(p.y, p.base); B = Math.max(p.y, p.base); }
    return { L: L, R: R, T: T, B: B, hz: !!el.horizontal };
  }
  function depthFor(r) { var t = r.hz ? (r.B - r.T) : (r.R - r.L); return t < 5 ? 0 : Math.max(3, Math.min(10, t * 0.3)); }
  function bm3Enabled(chart) { return !(chart.options && chart.options.plugins && chart.options.plugins.bm3 === false); }
  function drawBarDepth(chart, meta) {
    var ctx = chart.ctx, els = meta.data || [];
    ctx.save();
    for (var i = 0; i < els.length; i++) {
      var el = els[i]; if (!el || el.skip || !el.getProps) continue;
      var r = barRect(el), w = r.R - r.L, h = r.B - r.T;
      if (!(w > 1 && h > 1)) continue;
      var d = depthFor(r); if (!d) continue;
      var dy = d * 0.62, col = el.options && el.options.backgroundColor;
      if (!r.hz && h > 6) {
        ctx.fillStyle = 'rgba(15,29,35,.10)';
        ctx.beginPath(); ctx.ellipse((r.L + r.R + d) / 2, r.B + 1, (w + d) * 0.6, 2.6, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = shade(col, -0.34);
      ctx.beginPath(); ctx.moveTo(r.R, r.T); ctx.lineTo(r.R + d, r.T - dy); ctx.lineTo(r.R + d, r.B - dy); ctx.lineTo(r.R, r.B); ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(col, 0.4);
      ctx.beginPath(); ctx.moveTo(r.L, r.T); ctx.lineTo(r.L + d, r.T - dy); ctx.lineTo(r.R + d, r.T - dy); ctx.lineTo(r.R, r.T); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function drawBarShine(chart, meta) {
    var ctx = chart.ctx, els = meta.data || [];
    ctx.save();
    for (var i = 0; i < els.length; i++) {
      var el = els[i]; if (!el || el.skip || !el.getProps) continue;
      var r = barRect(el), w = r.R - r.L, h = r.B - r.T;
      if (!(w > 1 && h > 1) || !depthFor(r)) continue;
      var g = r.hz ? ctx.createLinearGradient(0, r.T, 0, r.B) : ctx.createLinearGradient(r.L, 0, r.R, 0);
      g.addColorStop(0, 'rgba(255,255,255,.30)'); g.addColorStop(0.4, 'rgba(255,255,255,.05)');
      g.addColorStop(0.58, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.17)');
      ctx.fillStyle = g; ctx.fillRect(r.L, r.T, w, h);
      ctx.fillStyle = 'rgba(255,255,255,.32)';
      if (!r.hz && h > 10) ctx.fillRect(r.L + w * 0.16, r.T + 3, Math.max(1.5, w * 0.12), h - 6);
      if (r.hz && w > 10) ctx.fillRect(r.L + 3, r.T + h * 0.18, w - 6, Math.max(1.5, h * 0.14));
    }
    ctx.restore();
  }
  function drawArcDepth(chart, meta) {
    var ctx = chart.ctx, els = meta.data || []; if (!els.length) return;
    var p0 = els[0].getProps(['outerRadius']);
    var depth = Math.max(4, Math.min(11, (p0.outerRadius || 0) * 0.075));
    ctx.save();
    var c0 = els[0].getProps(['x', 'y']), R0 = p0.outerRadius || 0;
    // sombra de chão suave, EMBAIXO do anel (no centro ela apareceria pelo furo)
    if (R0 > 10) {
      ctx.save();
      ctx.translate(c0.x, c0.y + R0 + depth * 0.55); ctx.scale(1, 0.16);
      var sg = ctx.createRadialGradient(0, 0, 0, 0, 0, R0 * 0.92);
      sg.addColorStop(0, 'rgba(15,29,35,.20)'); sg.addColorStop(1, 'rgba(15,29,35,0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, R0 * 0.92, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    for (var k = depth; k >= 1; k -= 1.5) {
      for (var i = 0; i < els.length; i++) {
        var el = els[i]; if (!el || el.skip || !el.getProps) continue;
        var p = el.getProps(['x', 'y', 'startAngle', 'endAngle', 'innerRadius', 'outerRadius']);
        if (!(p.outerRadius > 0) || p.endAngle - p.startAngle <= 0) continue;
        ctx.fillStyle = shade(el.options && el.options.backgroundColor, -0.28 - (k / depth) * 0.12);
        ctx.beginPath();
        ctx.arc(p.x, p.y + k, p.outerRadius, p.startAngle, p.endAngle);
        ctx.arc(p.x, p.y + k, Math.max(0, p.innerRadius), p.endAngle, p.startAngle, true);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }
  function hasData(chart) {
    var ds = (chart.data && chart.data.datasets) || [];
    for (var i = 0; i < ds.length; i++) if (ds[i] && ds[i].data && ds[i].data.length) return true;
    return false;
  }
  function replay(chart) {
    if (!chart || !chart.canvas || !chart.$bm3 || reduced() || !hasData(chart)) return;
    if (chart.options && chart.options.animation === false) return;
    chart.$bm3.t0 = now(); chart.$bm3.played = true; chart.$bm3.wipe = now();
    try { chart.reset(); chart.update(); } catch (e) {}
    runWipe(chart);
  }
  function runWipe(chart) {
    var st = chart.$bm3; if (!st || st.wiping) return;
    var hasLine = (chart.data.datasets || []).some(function (d, i) { var m = chart.getDatasetMeta(i); return m && m.type === 'line' && !m.hidden; });
    if (!hasLine) return;
    st.wiping = true;
    (function tick() {
      if (!chart.canvas || !chart.$bm3) return;
      // enquanto o próprio Chart.js anima, ele já redesenha a cada quadro
      var an = W.Chart && W.Chart.animator, busy = false;
      try { busy = !!(an && an.running && an.running(chart)); } catch (e) {}
      if (!busy) { try { chart.draw(); } catch (e) { st.wiping = false; return; } }
      if (now() - st.wipe < 1000) requestAnimationFrame(tick); else { st.wiping = false; try { chart.draw(); } catch (e) {} }
    })();
  }
  function watchChart(chart) {
    if (!IO_OK || !chart.canvas) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        chart.$bm3.visible = e.isIntersecting;
        if (!e.isIntersecting || !revealed || chart.$bm3.played) return;
        if (now() - chart.$bm3.t0 > 450) replay(chart); else chart.$bm3.played = true;
        io.disconnect();
      });
    }, { threshold: 0.2 });
    io.observe(chart.canvas);
    chart.$bm3.io = io;
  }
  var P3D = {
    id: 'bm3d',
    beforeInit: function (chart) { chart.$bm3 = { t0: now(), played: false, wipe: now(), hadData: false }; watchChart(chart); },
    beforeUpdate: function (chart) {
      if (!chart.$bm3) chart.$bm3 = { t0: now(), played: false, wipe: now() };
      if (W.Chart.defaults.font.family !== FONT_TEXT) W.Chart.defaults.font.family = FONT_TEXT;
      if (!bm3Enabled(chart)) return;
      var type = chart.config && chart.config.type;
      var ds = (chart.data && chart.data.datasets) || [], any = false;
      for (var i = 0; i < ds.length; i++) {
        var d = ds[i]; if (!d) continue;
        if (d.data && d.data.length) any = true;
        var t = d.type || type;
        if (t === 'bar' && d.bm3 !== false) {
          d.borderRadius = 0;
          if (d.borderSkipped === undefined || d.borderSkipped === false) d.borderSkipped = 'start';
          if (typeof d.backgroundColor === 'string') d.backgroundColor = solid(d.backgroundColor);
          else if (Array.isArray(d.backgroundColor)) d.backgroundColor = d.backgroundColor.map(solid);
        }
      }
      // rosca/pizza: reserva embaixo o espaço da parede 3D (senão o canvas corta)
      if ((type === 'doughnut' || type === 'pie') && !chart.$bm3.pad) {
        chart.$bm3.pad = true;
        try {
          var o = chart.config.options || (chart.config.options = {});
          o.layout = o.layout || {};
          var p = o.layout.padding;
          if (typeof p === 'number') p = { top: p, right: p, bottom: p, left: p };
          p = p || {};
          p.bottom = (p.bottom || 0) + 14;
          o.layout.padding = p;
        } catch (e) {}
      }
      if (any && !chart.$bm3.hadData) { chart.$bm3.hadData = true; chart.$bm3.t0 = now(); chart.$bm3.wipe = now(); if (revealed) runWipe(chart); }
    },
    beforeDatasetDraw: function (chart, args) {
      if (!bm3Enabled(chart)) return;
      var meta = args.meta; if (!meta || meta.hidden) return;
      var ctx = chart.ctx;
      if (meta.type === 'bar') { drawBarDepth(chart, meta); return; }
      if (meta.type === 'doughnut' || meta.type === 'pie') { drawArcDepth(chart, meta); return; }
      if (meta.type === 'line') {
        var ds = chart.data.datasets[args.index] || {};
        var col = typeof ds.borderColor === 'string' ? ds.borderColor : '#31798F';
        ctx.save(); meta.$bm3saved = true;
        ctx.shadowColor = shade(col, 0).replace(/,[\d.]+\)$/, ',.32)'); ctx.shadowBlur = 10; ctx.shadowOffsetY = 5;
        var st = chart.$bm3, a = chart.chartArea;
        if (st && a && !reduced()) {
          var k = Math.min(1, (now() - st.wipe) / 1000), e = 1 - Math.pow(1 - k, 3);
          if (k < 1) { ctx.beginPath(); ctx.rect(a.left - 12, a.top - 40, (a.right - a.left + 24) * e, a.bottom - a.top + 80); ctx.clip(); }
        }
      }
    },
    afterDatasetDraw: function (chart, args) {
      var meta = args.meta; if (!meta) return;
      if (meta.$bm3saved) { chart.ctx.restore(); meta.$bm3saved = false; }
      if (!bm3Enabled(chart) || meta.hidden) return;
      if (meta.type === 'bar') drawBarShine(chart, meta);
    },
    afterDestroy: function (chart) { if (chart.$bm3 && chart.$bm3.io) chart.$bm3.io.disconnect(); }
  };
  function setupCharts() {
    var C = W.Chart;
    if (!C || !C.register || !C.defaults) return false;
    if (C.__bm3) return true;
    C.__bm3 = true;
    var d = C.defaults;
    try {
      d.font.family = FONT_TEXT; d.color = '#58666D';
      if (d.animation) {
        d.animation.duration = reduced() ? 0 : 1100; d.animation.easing = 'easeOutQuart';
        d.animation.delay = function (ctx) {
          var c = ctx && ctx.chart;
          if (!c || !c.$bm3 || ctx.type !== 'data' || reduced()) return 0;
          if (now() - c.$bm3.t0 > 500) return 0;
          var meta = c.getDatasetMeta(ctx.datasetIndex) || {};
          var n = (meta.data && meta.data.length) || 1;
          var step = Math.max(10, Math.min(55, 650 / n));
          return ctx.dataIndex * step + ctx.datasetIndex * 80;
        };
      }
      var tt = d.plugins && d.plugins.tooltip;
      if (tt) {
        tt.backgroundColor = '#08151B'; tt.titleColor = '#fff'; tt.bodyColor = 'rgba(255,255,255,.86)'; tt.footerColor = 'rgba(255,255,255,.7)';
        tt.padding = 12; tt.cornerRadius = 12; tt.caretSize = 6; tt.boxPadding = 6; tt.usePointStyle = true;
        tt.titleFont = { family: FONT_TEXT, weight: '800', size: 12.5 }; tt.bodyFont = { family: FONT_TEXT, weight: '600', size: 12.5 };
      }
      var lg = d.plugins && d.plugins.legend && d.plugins.legend.labels;
      if (lg) { lg.usePointStyle = true; lg.pointStyle = 'rectRounded'; lg.boxWidth = 10; lg.boxHeight = 10; lg.font = { family: FONT_TEXT, weight: '600', size: 12.5 }; }
      if (d.scale && d.scale.grid) d.scale.grid.color = '#EAEEF1';
      if (d.elements && d.elements.point) { d.elements.point.hoverRadius = 6; d.elements.point.hoverBorderWidth = 2; }
      if (d.elements && d.elements.line) { d.elements.line.borderCapStyle = 'round'; d.elements.line.borderJoinStyle = 'round'; }
    } catch (e) {}
    try { C.register(P3D); } catch (e) {}
    try {
      var inst = C.instances || {};
      Object.keys(inst).forEach(function (k) { var c = inst[k]; if (c && !c.$bm3) { c.$bm3 = { t0: 0, played: false, wipe: 0, hadData: hasData(c) }; watchChart(c); } try { c.update('none'); } catch (e) {} });
      D.addEventListener('bm3:motion', function (ev) { try { d.animation.duration = ev.detail.reduced ? 0 : 1100; } catch (e) {} });
    } catch (e) {}
    if (D.fonts && D.fonts.ready) D.fonts.ready.then(function () { try { Object.keys(C.instances || {}).forEach(function (k) { C.instances[k].draw(); }); } catch (e) {} });
    return true;
  }
  function chartsOnReveal() {
    var C = W.Chart; if (!C || !C.instances) return;
    Object.keys(C.instances).forEach(function (k) {
      var c = C.instances[k]; if (!c || !c.$bm3 || c.$bm3.played) return;
      if (inView(c.canvas, 0)) { c.$bm3.played = true; replay(c); }
    });
  }

  // ------------------------------------------------------------------
  // 13. SIDEBAR — itens entram deslizando (1x por sessão)
  // ------------------------------------------------------------------
  function sidebarEntrance() {
    if (reduced()) return;
    var nav = D.querySelector('body.dshell .area-sidebar nav'); if (!nav) return;
    try { if (sessionStorage.getItem('bm3-sb-in')) return; sessionStorage.setItem('bm3-sb-in', '1'); } catch (e) { return; }
    var items = Array.prototype.slice.call(nav.children, 0, 22);
    items.forEach(function (el, i) {
      el.style.setProperty('--bm3-d', (i * 26) + 'ms');
      el.classList.add('bm3-in', 'bm3-side');
      setTimeout(function () { el.classList.remove('bm3-in', 'bm3-side'); el.style.removeProperty('--bm3-d'); }, 900 + i * 26);
    });
  }

  // ------------------------------------------------------------------
  // 14. OBSERVADOR — o conteúdo que a página desenha depois (API/BI)
  // ------------------------------------------------------------------
  var pend = [], pendT = 0, lastBurst = new WeakMap();
  function flushAdded() {
    pendT = 0;
    var roots = pend.splice(0);
    roots.forEach(safe(function (r) {
      if (!r.isConnected) return;
      var parent = r.parentElement || r;
      if (r.closest('.site-header, .area-sidebar, .fab-stack, .cmdk-overlay, #cp-widget, .fxdd-panel, .av-dd-panel, .bm3-menu')) return;
      markTilt(r);
      var cards = [];
      var insideCard = parent && parent.closest && parent.closest(IN_CARD);
      if (!insideCard) {
        if (!r.__bm3card && !SKIP_TAGS[r.tagName] && !SKIP_CLS.test(typeof r.className === 'string' ? r.className : '') && cardLike(r)) { r.__bm3card = 1; decorateCard(r); cards.push(r); }
        else scanCards(r, cards, 0);
      }
      var t = now(), last = lastBurst.get(parent) || 0;
      lastBurst.set(parent, t);
      cards.forEach(function (c, i) {
        if (!revealed) { arm(c); return; }
        if (t - last < 1500) { c.__bm3played = 1; return; }          // redesenho repetido: não anima de novo
        if (inView(c, 0)) { c.__bm3armed = 1; playIn(c, Math.min(i, 8) * 55); }
        else arm(c);
      });
      scanBars(r);
    }));
  }
  function observe(root) {
    if (!('MutationObserver' in W) || !root) return;
    new MutationObserver(function (recs) {
      var tbVisto = null;
      for (var i = 0; i < recs.length; i++) {
        var rc = recs[i];
        if (rc.type === 'characterData') { var pe = rc.target.parentElement; if (pe) onTextChange(pe, rc.oldValue); continue; }
        if (rc.type !== 'childList') continue;
        var tgt = rc.target;
        // tabela pintada linha a linha gera um registro por linha: olha uma vez
        if (tgt.tagName === 'TBODY' && tgt !== tbVisto) { tbVisto = tgt; safe(tbMudou)(tgt); }
        if (tgt.nodeType === 1 && rc.addedNodes.length === 1 && rc.addedNodes[0].nodeType === 3) {
          var old = rc.removedNodes.length === 1 && rc.removedNodes[0].nodeType === 3 ? rc.removedNodes[0].nodeValue : '';
          onTextChange(tgt, old);
          continue;
        }
        for (var j = 0; j < rc.addedNodes.length; j++) {
          var n = rc.addedNodes[j];
          if (n.nodeType === 1 && !SKIP_TAGS[n.tagName]) pend.push(n);
        }
      }
      if (pend.length && !pendT) pendT = setTimeout(flushAdded, 90);
    }).observe(root, { childList: true, subtree: true, characterData: true, characterDataOldValue: true });
  }

  // ------------------------------------------------------------------
  // 14b. TABELA RECARREGANDO — a página não encolhe embaixo de quem lê
  // ------------------------------------------------------------------
  // Ao trocar filtro ou campo, as páginas trocam o corpo da tabela por UMA
  // linha "Carregando…" até a consulta voltar. A tabela despencava de
  // altura, a página encurtava e o navegador puxava a rolagem para cima:
  // quem estava no fim (a matriz costuma ser o último bloco) via a tela
  // pular a cada clique. Enquanto o "Carregando…" está lá, a caixa da
  // tabela segura a altura que tinha; a resposta (ou o erro) a devolve.
  var TB_CARREGANDO = /^\s*(carregando|atualizando|consultando|buscando)\b/i;
  // altura no mesmo modelo de caixa que o min-height vai usar
  function tbMedir(cx) {
    if (cx.__bm3hold) return;                         // segurando: a medida é a nossa
    var cs = getComputedStyle(cx), h = cx.offsetHeight;
    if (cs.boxSizing !== 'border-box') {
      h -= (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) +
           (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    }
    if (h > 0) cx.__bm3h = h;                         // escondida (display:none) mede 0: guarda a anterior
  }
  // o observador de tamanho pega o que muda sem trocar linha (janela, coluna)
  var tbRO = ('ResizeObserver' in W) ? new ResizeObserver(function (es) {
    es.forEach(function (e) { tbMedir(e.target); });
  }) : null;
  function tbCaixa(tb) { var t = tb.parentElement; return t && t.tagName === 'TABLE' ? t.parentElement : null; }
  function tbVigiar(tb) {
    var cx = tbCaixa(tb);
    if (tbRO && cx && !cx.__bm3ro) { cx.__bm3ro = 1; tbRO.observe(cx); }
    return cx;
  }
  function tbCarregando(tb) {
    var rs = tb.rows;
    if (rs.length !== 1 || rs[0].cells.length !== 1) return false;
    var tx = rs[0].textContent;
    return tx.length < 120 && TB_CARREGANDO.test(tx);
  }
  // chamado pelo observador (14) a cada troca de linhas de um <tbody>
  function tbMudou(tb) {
    var cx = tbVigiar(tb);
    if (!cx) return;
    if (tbCarregando(tb)) {
      if (!cx.__bm3hold && cx.__bm3h > 0) {
        cx.__bm3hold = 1; cx.__bm3minh = cx.style.minHeight;
        cx.style.minHeight = cx.__bm3h + 'px';
      }
    } else {
      if (cx.__bm3hold) { cx.__bm3hold = 0; cx.style.minHeight = cx.__bm3minh || ''; }
      // e já mede a tabela pintada: é a altura a segurar na próxima recarga
      // (não espera o observador de tamanho, que não roda em aba escondida)
      tbMedir(cx);
    }
  }

  // ------------------------------------------------------------------
  // 15. FILTROS — o painel aberto nunca fica atrás (nem cortado)
  // ------------------------------------------------------------------
  // O painel do filtro é FILHO da barra de filtros. A barra tem vidro
  // (backdrop-filter) e, no celular, rolagem horizontal (overflow-x) —
  // as duas coisas prendem o painel: o vidro abre um contexto de
  // empilhamento (o z-index do painel só vale DENTRO da barra, então
  // qualquer cartão que venha depois no HTML passa por cima) e a rolagem
  // recorta o que sai da barra. O CSS resolve com .bm3-dd-open na barra;
  // aqui só marcamos QUANDO há um filtro aberto — vale para toda página,
  // inclusive as que montam a barra depois (API/BI).
  var DD_OPEN = '.av-dd.open, .fxdd.open, .bm3-dd.open';
  var DD_ANY = '.av-dd, .fxdd, .bm3-dd';
  var FBAR = '.fx-filters, .av-toolbar, .az-toolbar, .fca-toolbar, .table-toolbar, .bm3-fbar';
  // Painel que passa da borda da tela: puxa de volta para dentro. Acontece
  // no filtro mais à direita da barra (o painel nasce alinhado ao botão) e
  // no celular, onde ele é quase da largura da tela. Medimos pelo wrapper
  // .av-dd e por offsetWidth — não pelo rect do painel — porque o painel
  // está no meio da animação de abertura e o rect viria com a escala dela.
  var DD_PANEL = '.av-dd-panel, .fxdd-panel, .bm3-dd-panel';
  var DD_MARGEM = 8;
  function ddDesencostar(dd) {
    var panel = dd.querySelector(DD_PANEL);
    if (!panel) return;
    panel.style.removeProperty('margin-left');
    var cs = getComputedStyle(panel);
    if (cs.position !== 'absolute' && cs.position !== 'fixed') return;   // no celular alguns viram lista em fluxo
    var r = dd.getBoundingClientRect(), w = panel.offsetWidth;
    if (!w) return;
    var esq = cs.left !== 'auto' ? r.left + (parseFloat(cs.left) || 0)
                                 : r.right - (parseFloat(cs.right) || 0) - w;
    var largura = W.innerWidth || H.clientWidth;
    var desloc = 0;
    if (esq + w > largura - DD_MARGEM) desloc = largura - DD_MARGEM - w - esq;   // sai pela direita
    if (esq + desloc < DD_MARGEM) desloc = DD_MARGEM - esq;                      // e não pode sair pela esquerda
    if (Math.round(desloc)) panel.style.marginLeft = Math.round(desloc) + 'px';
  }
  // rolador vertical de verdade: alto (a área da página, um modal) ou já
  // rolado. A barra que só rola na horizontal no celular é baixa e fica de fora.
  function ddRolador(m, cs) {
    if (!/auto|scroll/.test(cs.overflowY)) return false;
    return m.scrollTop > 0 || m.clientHeight >= (W.innerHeight || H.clientHeight) * 0.5;
  }
  var ddT = 0;
  function ddSync() {
    ddT = 0;
    // 1. tira a marca de quem não tem mais filtro aberto
    D.querySelectorAll('.bm3-dd-open').forEach(function (b) {
      if (!b.querySelector(DD_OPEN)) b.classList.remove('bm3-dd-open');
    });
    // …e devolve o painel que tinha sido puxado para dentro da tela
    D.querySelectorAll(DD_PANEL).forEach(function (pn) {
      var dd = pn.closest ? pn.closest(DD_ANY) : null;
      if (pn.style.marginLeft && (!dd || !dd.classList.contains('open'))) pn.style.removeProperty('margin-left');
    });
    // 2. para cada filtro aberto: encaixa o painel na tela e marca as barras
    D.querySelectorAll(DD_OPEN).forEach(function (dd) {
      safe(ddDesencostar)(dd);
      // marca TODA barra acima do filtro (há página com .av-toolbar dentro da
      // .fx-filters — a de fora é justamente a do vidro, a que prendia).
      var achou = false;
      for (var n = dd.parentElement; n && n !== D.body; n = n.parentElement) {
        if (n.matches && n.matches(FBAR)) { n.classList.add('bm3-dd-open'); achou = true; }
      }
      if (achou) return;
      // barra fora do padrão: sobe até achar quem recorta ou empilha — mas
      // PARA no rolador (o .dept-main da página): overflow:visible nele zera
      // a rolagem, e a tela voltava lá para cima a cada tecla ou clique no
      // filtro (o "➕ Campos" das matrizes, fora de barra conhecida, caía
      // aqui). Dentro do rolador o painel não é cortado: só alonga a rolagem.
      for (var m = dd.parentElement; m && m !== D.body; m = m.parentElement) {
        var cs = getComputedStyle(m);
        if (ddRolador(m, cs)) break;
        if (/hidden|auto|scroll|clip/.test(cs.overflowX + ' ' + cs.overflowY) ||
            (cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.filter && cs.filter !== 'none')) {
          m.classList.add('bm3-dd-open');
          break;
        }
      }
    });
  }
  function ddQueue() { if (!ddT) ddT = setTimeout(safe(ddSync), 0); }
  function watchDropdowns() {
    if (!('MutationObserver' in W)) return;
    new MutationObserver(function (recs) {
      for (var i = 0; i < recs.length; i++) {
        var rc = recs[i], t = rc.target;
        // troca de classe no próprio filtro (abrir/fechar) — o caso comum
        if (rc.type === 'attributes') {
          if (t.nodeType === 1 && t.matches && t.matches(DD_ANY)) { ddQueue(); return; }
          continue;
        }
        // barra desenhada depois (a maioria dos relatórios monta os filtros
        // quando os dados chegam) — aí o filtro já nasce pronto
        for (var j = 0; j < rc.addedNodes.length; j++) {
          var n = rc.addedNodes[j];
          if (n.nodeType === 1 && n.matches && n.matches(DD_ANY)) { ddQueue(); return; }
        }
        // um closest por registro, não por nó: o redesenho de uma tabela
        // grande vem em lotes e todos os nós do lote têm o mesmo pai
        if (rc.addedNodes.length && t.nodeType === 1 && t.closest && t.closest(FBAR)) { ddQueue(); return; }
      }
    }).observe(D.body, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
    // rede de segurança: clique/tecla que abre ou fecha sem trocar classe aqui
    D.addEventListener('click', ddQueue, true);
    D.addEventListener('keyup', ddQueue, true);
    W.addEventListener('resize', ddQueue, { passive: true });
  }

  // ------------------------------------------------------------------
  // BOOT
  // ------------------------------------------------------------------
  function scanRoot() {
    return D.querySelector('body.dshell .area-body') || D.querySelector('.dept-main') || D.querySelector('.area-main') ||
      D.querySelector('.hv-shell') || D.querySelector('main') || D.body;
  }
  function boot() {
    safe(watchDropdowns)();      // primeiro: filtro tapado é bug de todo dia
    D.body.classList.add('bm3');
    safe(setupNavInk)();
    safe(setupHeaderActions)();
    safe(setupHero)();
    safe(setupDeptHome)();
    safe(setupTabs)();
    safe(setupTilt)();
    var root = scanRoot();
    // blocos estruturais animados como um só (topo da página)
    ['.area-header', '.fx-head > div:first-child', '.fx-dw', '.fx-tabs', '.fx-filters'].forEach(function (s) {
      D.querySelectorAll(s).forEach(function (el) { arm(el, s === '.area-header' || s === '.fx-tabs' ? 'flat' : null); });
    });
    var cards = safe(scanCards)(root) || [];
    cards.forEach(function (c) { arm(c); });
    safe(markTilt)(root);
    safe(scanBars)(root);
    observe(root === D.body ? D.body : (D.querySelector('.dept-main') || root));
    D.querySelectorAll('tbody').forEach(safe(tbMudou));    // tabelas que já vêm no HTML
    // filtros fixos só quando cabem (uma ou duas linhas)
    D.querySelectorAll('body.dept .fx-filters').forEach(function (f) {
      if (f.offsetHeight && f.offsetHeight < 130 && f.parentElement && f.parentElement.offsetHeight > f.offsetHeight * 3) {
        f.classList.add('bm3-sticky');
        var sc = D.querySelector('.dept-main');
        if (sc) sc.addEventListener('scroll', function () { f.classList.toggle('bm3-stuck', f.getBoundingClientRect().top <= 12 && sc.scrollTop > 40); }, { passive: true });
      }
    });
    if (!setupCharts()) { var n = 0, iv = setInterval(function () { if (setupCharts() || ++n > 200) clearInterval(iv); }, 50); }
    whenRevealed(function () {
      var hero = D.querySelector('body.dshell .area-header h1');
      if (hero && hero.closest('.bm3-rv')) splitWords(hero, 160);
      var fxt = D.querySelector('body.dept .fx-title');
      if (fxt && fxt.closest('.bm3-rv')) splitWords(fxt, 120);
      entrance();
      sidebarEntrance();
      growVisibleBars();
      setTimeout(chartsOnReveal, 60);
    });
    watchReveal();
  }

  W.BM3 = {
    version: '1.0',
    reduced: reduced,
    whenRevealed: whenRevealed,
    revealAll: revealAll,
    countUp: function (el, from) { countUp(el, from || 0, 0); },
    arm: arm,
    setReduced: function (v) {
      H.classList.toggle('bm3-reduce', !!v);
      try { localStorage.setItem('bm3-reduce', v ? '1' : '0'); } catch (e) {}
      if (v) revealAll();
      D.dispatchEvent(new CustomEvent('bm3:motion', { detail: { reduced: !!v } }));
    },
    toast: function (msg) {
      var t = D.getElementById('bm3-toast');
      if (!t) { t = D.createElement('div'); t.id = 'bm3-toast'; t.className = 'bm3-toast'; t.setAttribute('role', 'status'); D.body.appendChild(t); }
      t.textContent = msg; t.classList.add('show');
      clearTimeout(t.__t); t.__t = setTimeout(function () { t.classList.remove('show'); }, 3200);
    }
  };

  // Script `defer` roda com readyState = 'interactive' ANTES do
  // DOMContentLoaded — e é no DOMContentLoaded que o nav-sidebar.js monta o
  // shell e o menu. Então espera o evento (o dele foi registrado antes, roda
  // antes); `load` é a rede para quando este arquivo chega depois do evento.
  var booted = false;
  function go() { if (booted) return; booted = true; safe(boot)(); }
  D.addEventListener('DOMContentLoaded', go);
  W.addEventListener('load', go);
  if (D.readyState === 'complete') go();
})();
