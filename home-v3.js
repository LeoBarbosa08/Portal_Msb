// =====================================================================
// home-v3.js — comportamento da HOME no Layout v3 (só no index.html)
// ---------------------------------------------------------------------
//  · cabeçalho de vidro: escuro sobre o hero, claro depois; menu segue a
//    rolagem (Início / Áreas / Sistemas / Avisos / Contato)
//  · entrada do hero em sequência + paralaxe (mouse e rolagem) + anel de
//    órbita 3D (home-scene.js, Three.js só aqui e só depois da entrada)
//  · "Resumo de hoje" com números REAIS: aprovações e alertas vêm do
//    alertas.js (evento alertas:pintado); áreas = cartões liberados
//  · "Para você": filtro por área (segmentado) + 1º alerta urgente em destaque
//  · departamentos com "N módulos" (catálogo do portal); sistemas com chips;
//    suporte com "Copiar"; rodapé com "Voltar ao topo" e "Reduzir animações"
// Nada aqui decide acesso: só lê o que o area-access.js/alertas.js já decidiram.
// =====================================================================
(function () {
  'use strict';
  var D = document, W = window, B = D.body;
  if (!B || !B.classList.contains('home-v3')) return;
  var BM3 = W.BM3 || { reduced: function () { return false; }, whenRevealed: function (f) { f(); }, countUp: function () {}, setReduced: function () {} };
  var fine = W.matchMedia && W.matchMedia('(hover: hover) and (pointer: fine)').matches;
  function reduced() { return BM3.reduced(); }
  function $(s, r) { return (r || D).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || D).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
  var SVG = {
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
    ext: '<svg class="hv3-ext" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
  };

  // ------------------------------------------------------------------
  // cabeçalho: tom escuro enquanto o hero está à vista
  // ------------------------------------------------------------------
  var hero = $('#inicio');
  if (hero && 'IntersectionObserver' in W) {
    B.classList.add('hv3-dark');
    new IntersectionObserver(function (es) { B.classList.toggle('hv3-dark', es[0].isIntersecting); }, { rootMargin: '-80px 0px 0px 0px', threshold: 0.12 }).observe(hero);
  }

  // menu do topo acompanha a rolagem
  (function spy() {
    var nav = $('.site-header .header-nav'); if (!nav || !('IntersectionObserver' in W)) return;
    var map = { inicio: 'index.html', alertas: 'index.html', areas: '#areas', sistemas: '#sistemas', avisos: '#avisos', contato: '#contato' };
    function set(href) {
      $$('a', nav).forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === href); });
      if (W.BM3_placeInk) W.BM3_placeInk();
    }
    set('index.html');
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting && map[e.target.id]) set(map[e.target.id]); });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(map).forEach(function (id) { var el = D.getElementById(id); if (el) io.observe(el); });
  })();

  // ------------------------------------------------------------------
  // busca grande do hero → abre o mesmo palette do cabeçalho
  // ------------------------------------------------------------------
  var bigSearch = $('#hv3-search');
  if (bigSearch) bigSearch.addEventListener('click', function () { var t = D.getElementById('search-trigger'); if (t) t.click(); });

  // ------------------------------------------------------------------
  // entrada do hero (classes com atraso) — só depois do login sair
  // ------------------------------------------------------------------
  function stagger(el, delay, kind) {
    if (!el || reduced()) return;
    el.style.setProperty('--bm3-d', delay + 'ms');
    el.classList.add('bm3-in');
    if (kind) el.classList.add(kind);
    setTimeout(function () { el.classList.remove('bm3-in', 'bm3-3d'); el.style.removeProperty('--bm3-d'); }, 1500 + delay);
  }
  function heroPre() {
    if (reduced()) return;
    ['.hv-kicker', '.hv-sub', '#hv3-search', '.hv-recentes', '#hv3-pulse'].forEach(function (s) { var el = $(s); if (el) el.classList.add('bm3-rv'); });
    var g = $('#hv-greeting'); if (g) g.classList.add('hv3-pre');
  }
  function heroIn() {
    if (reduced()) { $$('.bm3-rv', hero).forEach(function (e) { e.classList.remove('bm3-rv'); }); return; }
    var steps = [['.hv-kicker', 0], ['.hv-sub', 420], ['#hv3-search', 560], ['.hv-recentes', 700]];
    steps.forEach(function (s) { var el = $(s[0]); if (el) { el.classList.remove('bm3-rv'); stagger(el, s[1]); } });
    var p = $('#hv3-pulse'); if (p) { p.classList.remove('bm3-rv'); stagger(p, 520, 'bm3-3d'); }
    var g = $('#hv-greeting');
    if (g) {
      g.classList.remove('hv3-pre');
      $$('.hv3-w > span', g).forEach(function (s, i) {
        s.animate([{ transform: 'translateY(115%)' }, { transform: 'none' }], { duration: 1200, delay: 160 + i * 90, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
      });
    }
  }
  heroPre();
  BM3.whenRevealed(function () { heroIn(); setTimeout(loadScene, reduced() ? 0 : 450); });

  // ------------------------------------------------------------------
  // paralaxe: mouse (profundidade) + rolagem
  // ------------------------------------------------------------------
  var pulse = $('#hv3-pulse'), copy = $('.hv3-copy'), pulseWrap = $('.hv3-pulse-wrap');
  var orbs = $$('.hv3-bg [data-depth]'), floor = $('.hv3-floor');
  var scene = null;
  if (fine) {
    var mx = 0, my = 0, raf1 = 0;
    W.addEventListener('pointermove', function (e) {
      mx = e.clientX / (W.innerWidth || 1) - 0.5; my = e.clientY / (W.innerHeight || 1) - 0.5;
      if (raf1 || reduced()) return;
      raf1 = requestAnimationFrame(function () {
        raf1 = 0;
        if (pulse) pulse.style.transform = 'translate3d(' + (-mx * 18).toFixed(1) + 'px,' + (-my * 14).toFixed(1) + 'px,0) rotateY(' + (mx * 6).toFixed(2) + 'deg) rotateX(' + (-my * 5).toFixed(2) + 'deg)';
        orbs.forEach(function (o) { var d = +o.getAttribute('data-depth') || 1; o.style.translate = (mx * 60 * d).toFixed(1) + 'px ' + (my * 40 * d).toFixed(1) + 'px'; });
      });
    }, { passive: true });
  }
  var raf2 = 0;
  function onScroll() {
    if (raf2) return;
    raf2 = requestAnimationFrame(function () {
      raf2 = 0;
      if (!hero || reduced()) return;
      var h = hero.offsetHeight || 1, y = Math.max(0, Math.min(h, W.scrollY || W.pageYOffset || 0)), p = y / h;
      if (floor) floor.style.translate = '0 ' + (p * 18).toFixed(2) + '%';
      if (orbs[0]) orbs[0].style.marginTop = (p * 40).toFixed(1) + '%';
      if (copy) copy.style.transform = 'translateY(' + (-p * 70).toFixed(1) + 'px)';
      if (pulseWrap) pulseWrap.style.transform = 'translateY(' + (-p * 130).toFixed(1) + 'px)';
      if (scene && scene.setScroll) scene.setScroll(p);
    });
  }
  W.addEventListener('scroll', onScroll, { passive: true });

  // ------------------------------------------------------------------
  // Anel de órbita 3D (carrega o Three.js só aqui, depois da entrada do texto)
  // ------------------------------------------------------------------
  function loadScene() {
    var box = $('#hv3-canvas'); if (!box || W.__noWebGL) return;
    // sem GPU (acesso remoto/VDI costuma cair no WebGL por SOFTWARE) o 3D
    // come CPU: fica o fallback de CSS, que já é bonito e não pesa
    try {
      var cv = D.createElement('canvas'), gl = cv.getContext('webgl2') || cv.getContext('webgl');
      if (!gl) return;
      var dbg = gl.getExtension('WEBGL_debug_renderer_info');
      var ren = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
      if (/swiftshader|llvmpipe|softpipe|basic render|software/i.test(ren)) return;
      var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    } catch (e) { return; }
    var low = (W.matchMedia && (W.matchMedia('(max-width: 760px)').matches || W.matchMedia('(pointer: coarse)').matches)) || (navigator.hardwareConcurrency || 8) <= 4;
    var go = function () {
      if (typeof W.bmCreateHeroScene !== 'function') return;
      // niko:false = só o anel girando (01/10/26); o BioNiko está guardado em docs/bioniko/
      W.bmCreateHeroScene(box, { low: low, still: reduced(), niko: false }).then(function (s) { scene = s; onScroll(); })
        .catch(function (err) { if (W.console) console.warn('[home] cena 3D indisponível, fica o fallback CSS', err); });
    };
    if (typeof W.bmCreateHeroScene === 'function') { go(); return; }
    var s = D.createElement('script'); s.src = 'home-scene.js?v=3'; s.async = true; s.onload = go;
    D.head.appendChild(s);
  }
  D.addEventListener('bm3:motion', function (e) { if (scene && scene.setStill) scene.setStill(!!(e.detail && e.detail.reduced)); });

  // ------------------------------------------------------------------
  // RESUMO DE HOJE — números de verdade (ou "—" enquanto não há)
  // ------------------------------------------------------------------
  function setNum(id, n) {
    var el = D.getElementById(id); if (!el) return;
    if (n == null) { el.textContent = '—'; return; }
    var prev = parseInt(el.textContent, 10);
    el.textContent = String(n);
    if (!reduced() && n > 0 && BM3.countUp) BM3.countUp(el, isFinite(prev) ? prev : 0);
  }
  function areasCount() {
    return $$('#areas .area-card').filter(function (c) { return getComputedStyle(c).display !== 'none'; }).length;
  }
  D.addEventListener('areaaccess:ready', function () { setTimeout(function () { setNum('hv3-n-areas', areasCount()); deptMeta(); sysChips(); }, 30); });

  // ------------------------------------------------------------------
  // "PARA VOCÊ" — segmentado por área + alerta urgente em destaque
  // ------------------------------------------------------------------
  var segFilter = 'todos', wasOpen = false;
  function cardArea(c) { var ch = $('.al-chip', c); return ch ? ch.textContent.split('·')[0].trim() : ''; }
  function moveSegThumb(seg) {
    var on = $('button[aria-selected="true"]', seg), th = $('i', seg);
    if (!on || !th) return;
    th.style.width = on.offsetWidth + 'px'; th.style.transform = 'translateX(' + on.offsetLeft + 'px)';
  }
  function applySeg() {
    var cards = $$('#al-grid .al-card:not(.al-vazio)');
    cards.forEach(function (c) { c.classList.toggle('hv3-off', segFilter !== 'todos' && cardArea(c) !== segFilter); });
    if (segFilter !== 'todos') { if (!B.classList.contains('al-aberto')) { wasOpen = false; B.classList.add('al-aberto'); } }
    else if (!wasOpen) B.classList.remove('al-aberto');
    var tg = D.getElementById('al-toggle'); if (tg && segFilter !== 'todos') tg.hidden = true;
  }
  function buildSeg(itens) {
    var head = $('#alertas .hv-al-actions'); if (!head) return;
    var seg = D.getElementById('hv3-seg');
    var cards = $$('#al-grid .al-card:not(.al-vazio)');
    if (!cards.length) { if (seg) seg.remove(); return; }
    var cont = {}, order = [];
    cards.forEach(function (c) { var a = cardArea(c); if (!a) return; if (!cont[a]) { cont[a] = 0; order.push(a); } cont[a]++; });
    if (order.length < 2) { if (seg) seg.remove(); segFilter = 'todos'; return; }
    if (!seg) { seg = D.createElement('div'); seg.id = 'hv3-seg'; seg.className = 'hv3-seg'; seg.setAttribute('role', 'tablist'); seg.setAttribute('aria-label', 'Filtrar por área'); head.insertBefore(seg, head.firstChild); }
    if (segFilter !== 'todos' && !cont[segFilter]) segFilter = 'todos';
    seg.innerHTML = '<i aria-hidden="true"></i>' +
      '<button type="button" role="tab" data-seg="todos" aria-selected="' + (segFilter === 'todos') + '">Todos <span>' + cards.length + '</span></button>' +
      order.map(function (a) { return '<button type="button" role="tab" data-seg="' + esc(a) + '" aria-selected="' + (segFilter === a) + '">' + esc(a) + ' <span>' + cont[a] + '</span></button>'; }).join('');
    seg.onclick = function (e) {
      var b = e.target.closest('button[data-seg]'); if (!b) return;
      if (segFilter === 'todos' && b.getAttribute('data-seg') !== 'todos') wasOpen = B.classList.contains('al-aberto');
      segFilter = b.getAttribute('data-seg');
      $$('button', seg).forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
      moveSegThumb(seg); applySeg();
    };
    requestAnimationFrame(function () { moveSegThumb(seg); });
    applySeg();
  }
  function focusCard() {
    var cards = $$('#al-grid .al-card:not(.al-vazio)');
    cards.forEach(function (c) { c.classList.remove('hv3-focus'); var p = $('.hv3-prio', c); if (p) p.remove(); });
    var f = cards.filter(function (c) { return c.classList.contains('p-alta') && c.classList.contains('com-badge'); })[0]
         || cards.filter(function (c) { return c.classList.contains('p-alta'); })[0];
    if (!f) return;
    f.classList.add('hv3-focus');
    var meta = $('.al-meta', f);
    if (meta) { var s = D.createElement('span'); s.className = 'hv3-prio'; s.innerHTML = SVG.warn + 'Prioridade · Urgente'; meta.insertBefore(s, meta.firstChild); }
    // o número grande conta só quando MUDA (a faixa é redesenhada a cada
    // releitura do /api/alertas — mesmo número não anima de novo)
    var badge = $('.al-badge', f), sig = (f.getAttribute('data-id') || '') + ':' + (badge ? badge.textContent : '');
    if (badge && sig !== lastFocus && !reduced() && BM3.countUp) BM3.countUp(badge, 0);
    lastFocus = sig;
  }
  var lastFocus = '', painted = false;
  D.addEventListener('alertas:pintado', function (e) {
    var d = (e && e.detail) || null;
    setNum('hv3-n-aprov', d ? d.aprovacoes : null);
    setNum('hv3-n-alertas', d ? d.total : null);
    focusCard();
    buildSeg();
    deptAlerts(d && d.itens);
    // 1ª pintura: o painel "Para você" sobe junto com a entrada do hero
    if (!painted && d) {
      painted = true;
      var sec = D.getElementById('alertas');
      BM3.whenRevealed(function () { if (sec && !sec.hidden) stagger(sec, 380, 'bm3-3d'); });
    }
  });
  W.addEventListener('resize', function () { var s = D.getElementById('hv3-seg'); if (s) moveSegThumb(s); });

  // ------------------------------------------------------------------
  // DEPARTAMENTOS — "N módulos" (catálogo) + selo de alertas da área
  // ------------------------------------------------------------------
  function deptMeta() {
    var CAT = W.PORTAL_CATALOGO; if (!CAT || !CAT.modulos) return;
    $$('#areas .area-card').forEach(function (c) {
      if (c.__hv3) return; c.__hv3 = 1;
      var key = c.getAttribute('data-area'), h3 = $('h3', c); if (!h3) return;
      var top = CAT.modulos.filter(function (m) { return m[0] === key && !m[2]; }).length;
      var all = CAT.modulos.filter(function (m) { return m[0] === key; }).length;
      var n = top || all;
      var ag = (CAT.agentes || []).filter(function (a) { return a[0] === key; }).length;
      var wrap = D.createElement('span'); wrap.className = 'hv3-dept-txt';
      h3.parentNode.insertBefore(wrap, h3); wrap.appendChild(h3);
      var meta = D.createElement('span'); meta.className = 'hv3-dept-meta';
      meta.textContent = (n ? n + (n === 1 ? ' módulo' : ' módulos') : 'Departamento') + (ag ? ' · ' + ag + (ag === 1 ? ' agente' : ' agentes') : '');
      wrap.appendChild(meta);
      var arr = $('.area-card-arrow', c); if (arr) arr.innerHTML = SVG.arrow + '<span class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Acessar</span>';
    });
  }
  function deptAlerts(itens) {
    $$('#areas .hv3-dept-alert').forEach(function (e) { e.remove(); });
    if (!itens || !itens.length) return;
    var byName = {};
    $$('#areas .area-card').forEach(function (c) { var h = $('h3', c); if (h) byName[norm(h.textContent)] = c; });
    var cnt = {};
    itens.forEach(function (it) {
      var a = norm(it.areaRotulo || ''); if (!a) return;
      var key = byName[a] ? a : (a === 'licitacoes' && byName['licitacao'] ? 'licitacao' : (a === 'ti' && byName['ti & sistemas'] ? 'ti & sistemas' : null));
      if (!key) return;
      cnt[key] = (cnt[key] || 0) + 1;
    });
    Object.keys(cnt).forEach(function (k) {
      var c = byName[k]; if (!c) return;
      var s = D.createElement('span'); s.className = 'hv3-dept-alert'; s.title = cnt[k] + ' alerta(s) para você';
      s.textContent = cnt[k] + (cnt[k] === 1 ? ' alerta' : ' alertas');
      c.appendChild(s);
    });
  }

  // ------------------------------------------------------------------
  // SISTEMAS — chips de categoria (usam o filtro que já existe no index)
  // ------------------------------------------------------------------
  function sysChips() {
    var box = D.getElementById('sistemas-tabs'); if (!box) return;
    var cards = $$('#sistemas-grid .sistema-card');
    $$('.sistemas-tab', box).forEach(function (t) {
      var cat = t.getAttribute('data-tab');
      var n = cat === 'todos' ? cards.length : cards.filter(function (c) { return c.getAttribute('data-cat') === cat; }).length;
      var sp = $('span', t); if (!sp) { sp = D.createElement('span'); t.appendChild(sp); }
      sp.textContent = n;
      t.hidden = !n && cat !== 'todos';
    });
    cards.forEach(function (c) { if (!$('.hv3-ext', c) && c.getAttribute('target') === '_blank') c.insertAdjacentHTML('beforeend', SVG.ext); });
  }

  // ------------------------------------------------------------------
  // SUPORTE — copiar e-mail
  // ------------------------------------------------------------------
  D.addEventListener('click', function (e) {
    var b = e.target.closest('.hv3-copybtn'); if (!b) return;
    var v = b.getAttribute('data-copy'), lbl = $('span', b);
    var ok = function () {
      b.classList.add('done'); if (lbl) lbl.textContent = 'Copiado';
      var ic = $('svg', b); if (ic) ic.outerHTML = SVG.check;
      setTimeout(function () { b.classList.remove('done'); if (lbl) lbl.textContent = 'Copiar'; var i2 = $('svg', b); if (i2) i2.outerHTML = SVG.copy; }, 1800);
    };
    (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(ok, function () {
      var ta = D.createElement('textarea'); ta.value = v; D.body.appendChild(ta); ta.select();
      try { D.execCommand('copy'); } catch (err) {}
      ta.remove(); ok();
    });
  });

  // ------------------------------------------------------------------
  // RODAPÉ — voltar ao topo / reduzir animações
  // ------------------------------------------------------------------
  var top = D.getElementById('hv3-top');
  if (top) top.addEventListener('click', function () { W.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); });
  var mot = D.getElementById('hv3-motion');
  function paintMot() { if (!mot) return; mot.setAttribute('aria-pressed', String(reduced())); var s = $('span', mot); if (s) s.textContent = reduced() ? 'Ligar animações' : 'Reduzir animações'; }
  if (mot) mot.addEventListener('click', function () { BM3.setReduced(!reduced()); paintMot(); if (BM3.toast) BM3.toast(reduced() ? 'Animações reduzidas: 3D parado e transições desligadas.' : 'Animações ligadas.'); });
  paintMot();

  // estado inicial (antes do acesso decidido já dá para montar o que é estático)
  deptMeta(); sysChips();
})();
