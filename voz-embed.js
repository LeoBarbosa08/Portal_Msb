/* ================================================================
   voz-embed.js — Assistente Comercial (LLM) · popup premium
   Carregar SOMENTE nas páginas do Comercial. Substitui o chat "Bio".

   v4: TTS destravado de verdade no celular (utterance silenciosa no
   gesto + espera pós-cancel do Android) e microfone com fallback de
   gravação (MediaRecorder → /api/transcrever) para Edge desktop e
   iPhone, onde o Web Speech não transcreve.
   Motor: /api/chat (Azure OpenAI) + DAX no navegador.
   ================================================================ */
(function () {
  'use strict';
  if (document.getElementById('vzp-fab')) return;

  // ── Perfil do agente por página ─────────────────────────────────
  // A página declara ANTES deste script: <script>window.VOZ_AGENT='negociacoes'</script>
  // Sem declaração = perfil 'comercial' (dataset Comercial, prompt comercial).
  var PERFIL = (window.VOZ_AGENT === 'negociacoes') ? 'negociacoes' : 'comercial';
  var NEG_DATASET = 'a34b4911-4bd9-4891-b87c-1e624f3d9c8a';   // dataset Negociações (mesmo workspace)
  if (PERFIL === 'negociacoes') window.VOZPBI_DATASET = NEG_DATASET;  // voz-pbi.js consulta ESTE dataset
  var TITULO = PERFIL === 'negociacoes' ? 'Assistente de Negociações' : 'Assistente Comercial';

  // 1) esconde o chat "Bio" só nesta página (Comercial)
  var hide = document.createElement('style');
  hide.textContent = '#cp-widget{display:none!important;}';
  document.head.appendChild(hide);

  // 2) estilos — tema escuro premium, orbe animado
  var css = document.createElement('style');
  css.textContent = [
    '.vzp-fab{position:fixed;left:24px;bottom:24px;z-index:9100;width:60px;height:60px;border:1px solid rgba(56,225,255,.35);border-radius:50%;cursor:pointer;',
      'background:radial-gradient(circle at 35% 30%,rgba(56,225,255,.25),rgba(8,25,46,.92));color:#38e1ff;box-shadow:0 0 26px rgba(56,225,255,.35);',
      'display:flex;align-items:center;justify-content:center;font-size:24px;transition:transform .12s,box-shadow .2s;}',
    '.vzp-fab:hover{transform:translateY(-2px);box-shadow:0 0 40px rgba(56,225,255,.55);}',
    /* painel (maior) */
    '.vzp-panel{position:fixed;left:24px;bottom:94px;z-index:9100;width:460px;max-width:calc(100vw - 28px);height:min(720px,82vh);',
      'border-radius:22px;overflow:hidden;display:flex;flex-direction:column;',
      'background:radial-gradient(1000px 560px at 50% -12%,rgba(36,167,175,.16),transparent 60%),',
        'radial-gradient(760px 420px at 88% 112%,rgba(12,84,124,.28),transparent 55%),',
        'radial-gradient(circle at 1px 1px,rgba(120,200,255,.05) 1px,transparent 0) 0 0 / 26px 26px,',
        'linear-gradient(165deg,#02060f 0%,#051224 55%,#02060f 100%);',
      'border:1px solid rgba(56,225,255,.16);box-shadow:0 24px 80px rgba(2,8,20,.7);',
      'opacity:0;visibility:hidden;transform:translateY(14px);transition:opacity .2s ease,transform .2s ease;color:#dbeefc;}',
    '.vzp-panel.open{opacity:1;visibility:visible;transform:translateY(0);}',
    /* modo tela cheia */
    '.vzp-panel.full{left:0;right:0;top:0;bottom:0;width:100vw;max-width:100vw;height:100vh;border-radius:0;border:0;}',
    '.vza-head{display:flex;align-items:center;gap:9px;padding:14px 16px;flex:0 0 auto;}',
    '.vza-head .t{font-weight:700;font-size:14px;letter-spacing:.12em;text-transform:uppercase;}',
    '.vza-head .t b{color:#38e1ff;}',
    '.vza-head .m{margin-left:auto;font-size:9.5px;color:rgba(160,200,240,.5);letter-spacing:.05em;}',
    '.vza-ibtn{border:1px solid rgba(56,225,255,.18);background:rgba(8,25,46,.6);color:#9cd6f5;width:30px;height:30px;border-radius:9px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;transition:color .15s,border-color .15s;}',
    '.vza-ibtn:hover{color:#38e1ff;border-color:rgba(56,225,255,.5);}',
    '.vza-head .m + .vza-ibtn{margin-left:0;}',
    /* palco / orb em canvas */
    '.vza-stage{flex:0 0 auto;height:168px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2px 12px 6px;}',
    '.vzp-panel.full .vza-stage{height:36vh;}',
    '.vza-orb{display:block;width:150px;height:150px;}',
    '.vzp-panel.full .vza-orb{width:min(34vh,82vw);height:min(34vh,82vw);}',
    '.vza-status{margin-top:2px;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:rgba(56,225,255,.6);text-shadow:0 0 12px rgba(56,225,255,.4);min-height:14px;text-align:center;}',
    /* transcript (maior) */
    '.vza-msgs{flex:1 1 auto;overflow-y:auto;padding:8px 16px 14px;display:flex;flex-direction:column;gap:11px;width:100%;}',
    '.vzp-panel.full .vza-msgs{max-width:860px;margin:0 auto;}',
    '.vza-q{align-self:flex-end;max-width:86%;font-size:14px;color:#eafcff;',
      'background:linear-gradient(135deg,rgba(12,84,124,.85),rgba(36,167,175,.6));',
      'border:1px solid rgba(56,225,255,.25);padding:11px 15px;border-radius:15px 15px 5px 15px;white-space:pre-wrap;}',
    '.vza-a{align-self:flex-start;max-width:94%;font-size:15px;line-height:1.58;color:#dbeefc;background:rgba(8,25,46,.55);',
      'border:1px solid rgba(56,225,255,.16);padding:13px 16px;border-radius:5px 16px 16px 16px;white-space:pre-wrap;',
      'box-shadow:0 6px 24px rgba(2,8,20,.4);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);}',
    '.vza-a.speaking-now{border-color:rgba(56,225,255,.5);box-shadow:0 0 22px rgba(56,225,255,.18);}',
    '.vza-a .vza-lead{font-size:16px;font-weight:600;color:#f2fbff;line-height:1.42;margin:0 0 2px;}',
    '.vza-a p{margin:8px 0 0;font-size:14px;line-height:1.58;color:rgba(219,238,252,.92);}',
    '.vza-a .vza-ul{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;}',
    '.vza-a .vza-ul li{position:relative;padding:6px 10px 6px 24px;font-size:13.5px;line-height:1.45;',
      'background:rgba(56,225,255,.05);border-radius:9px;border:1px solid rgba(56,225,255,.09);}',
    '.vza-a .vza-ul li::before{content:"◆";position:absolute;left:9px;top:6px;font-size:8px;color:rgba(56,225,255,.55);}',
    '.vza-a b{color:#38e1ff;font-weight:700;}',
    '.vza-tool{align-self:flex-start;font-size:10.5px;color:rgba(160,200,240,.45);font-style:italic;padding:0 4px;letter-spacing:.03em;}',
    '.vza-chart{align-self:stretch;background:rgba(8,25,46,.55);border:1px solid rgba(56,225,255,.16);border-radius:14px;padding:12px;height:260px;box-shadow:0 8px 26px rgba(2,8,20,.4);}',
    /* controles */
    '.vza-voice{display:flex;gap:6px;align-items:center;justify-content:center;flex-wrap:wrap;padding:7px 10px;flex:0 0 auto;border-top:1px solid rgba(56,225,255,.1);width:100%;}',
    '.vzp-panel.full .vza-voice,.vzp-panel.full .vza-form{max-width:860px;margin:0 auto;}',
    '.vza-vlabel{font-size:10px;color:rgba(160,200,240,.55);font-weight:600;letter-spacing:.04em;}',
    '.vza-vsel{padding:5px 8px;border:1px solid rgba(56,225,255,.18);border-radius:8px;font-size:11px;max-width:180px;background:rgba(8,25,46,.6);color:#dbeefc;}',
    '.vza-vsel option{color:#0F172A;}',
    '#vza-rate{accent-color:#38e1ff;width:80px;}',
    '.vza-form{display:flex;gap:9px;padding:11px 13px 14px;flex:0 0 auto;align-items:center;width:100%;}',
    '.vza-input{flex:1;min-width:0;padding:13px 16px;border:1px solid rgba(56,225,255,.16);border-radius:999px;font-size:14.5px;',
      'background:rgba(8,25,46,.6);color:#eafcff;outline:none;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);}',
    '.vza-input::placeholder{color:rgba(160,200,240,.45);}',
    '.vza-input:focus{border-color:rgba(56,225,255,.5);box-shadow:0 0 20px rgba(56,225,255,.12);}',
    '.vza-mic{border:1px solid rgba(56,225,255,.2);border-radius:50%;width:50px;height:50px;flex:0 0 auto;cursor:pointer;font-size:20px;color:#38e1ff;',
      'background:radial-gradient(circle at 35% 30%,rgba(56,225,255,.18),rgba(8,25,46,.85));box-shadow:0 0 22px rgba(56,225,255,.15);transition:box-shadow .2s;}',
    '.vza-mic:hover{box-shadow:0 0 32px rgba(56,225,255,.3);}',
    '.vza-mic.on{color:#fff;border-color:rgba(255,90,90,.7);background:radial-gradient(circle at 35% 30%,rgba(255,90,90,.35),rgba(60,10,18,.85));box-shadow:0 0 30px rgba(255,90,90,.45);}',
    '.vza-send{border:1px solid rgba(56,225,255,.35);border-radius:50%;width:50px;height:50px;flex:0 0 auto;cursor:pointer;font-size:17px;color:#04121f;',
      'background:linear-gradient(135deg,#38e1ff,#24A7AF);box-shadow:0 0 22px rgba(56,225,255,.3);}',
    '@media(max-width:640px){.vzp-fab{left:14px;bottom:14px;width:54px;height:54px;}',
      '.vzp-panel{left:8px;right:8px;bottom:72px;width:auto;height:min(640px,82vh);}',
      '.vza-stage{height:150px;}.vza-orb{width:132px;height:132px;}}',
    /* ── App shell (Claude Design): o botão e o painel do JARVIS acompanham
       a sidebar do departamento em vez de ficar por cima dela. No desktop
       (>=768px) a sidebar ocupa a esquerda (var --bm-sb-w: 248px aberta /
       64px recolhida); o FAB e o painel deslizam p/ a área de conteúdo à
       direita dela e transicionam junto quando ela abre/recolhe. No mobile
       do shell (<768px) a sidebar vira drawer e há tab bar embaixo — sobem
       p/ não cobri-la. Fora do shell (páginas sem body.dshell) nada muda. */
    '@media(min-width:768px){',
      'body.dshell .vzp-fab{left:calc(var(--bm-sb-w,248px) + 24px);transition:transform .12s,box-shadow .2s,left .2s ease;}',
      'body.dshell .vzp-panel:not(.full){left:calc(var(--bm-sb-w,248px) + 24px);max-width:calc(100vw - var(--bm-sb-w,248px) - 48px);transition:opacity .2s ease,transform .2s ease,left .2s ease;}',
    '}',
    '@media(max-width:767px){',
      'body.dshell .vzp-fab{left:14px;right:auto;bottom:calc(78px + env(safe-area-inset-bottom));width:54px;height:54px;}',
      'body.dshell .vzp-panel:not(.full){left:8px;right:8px;width:auto;max-width:none;bottom:calc(140px + env(safe-area-inset-bottom));height:min(620px,72vh);}',
    '}'
  ].join('');
  document.head.appendChild(css);

  // 3) DOM
  var root = document.createElement('div');
  root.id = 'vzp-root';
  root.innerHTML =
    '<div id="vzp-panel" class="vzp-panel">' +
    '  <div class="vza-head"><span class="t"><b>BIO</b> · ' + TITULO + '</span><span class="m" id="vza-model"></span>' +
    '    <button type="button" class="vza-ibtn" id="vza-full" aria-label="Tela cheia" title="Tela cheia">⛶</button>' +
    '    <button type="button" class="vza-ibtn" id="vza-close" aria-label="Fechar" title="Fechar">✕</button></div>' +
    '  <div class="vza-stage"><canvas class="vza-orb" id="vza-orb"></canvas><div class="vza-status" id="vza-status">Toque no microfone e pergunte sobre suas vendas</div></div>' +
    '  <div class="vza-msgs" id="vza-msgs"></div>' +
    '  <div class="vza-voice">' +
    '    <span class="vza-vlabel">Voz</span><select id="vza-voice" class="vza-vsel"></select>' +
    '    <span class="vza-vlabel">Vel.</span><input type="range" id="vza-rate" min="0.8" max="1.4" step="0.05" value="1">' +
    '  </div>' +
    '  <form class="vza-form" id="vza-form" autocomplete="off">' +
    '    <button type="button" class="vza-mic" id="vza-mic" title="Falar">🎤</button>' +
    '    <input type="text" class="vza-input" id="vza-input" placeholder="Ou digite sua pergunta…">' +
    '    <button type="submit" class="vza-send" title="Enviar">➤</button>' +
    '  </form>' +
    '</div>' +
    '<button id="vzp-fab" class="vzp-fab" type="button" aria-label="' + TITULO + '" title="' + TITULO + ' (voz e chat)">🎤</button>';
  document.body.appendChild(root);

  var fab = document.getElementById('vzp-fab');
  var panel = document.getElementById('vzp-panel');
  var started = false;
  fab.addEventListener('click', function () {
    panel.classList.toggle('open');
    primeTTS();                                   // gesto do usuário: destrava o áudio no celular
    if (panel.classList.contains('open') && !started) { started = true; boot(); }
  });
  document.getElementById('vza-close').addEventListener('click', function () { panel.classList.remove('open'); });

  // 4) dependências: MSAL → Chart.js → voz-pbi.js
  function loadScript(src, cb) { var s = document.createElement('script'); s.src = src; s.onload = cb || null; document.body.appendChild(s); }
  function chain(list) { if (!list.length) return; var it = list.shift(); if (it.skip) return chain(list); loadScript(it.src, function () { chain(list); }); }
  var base = location.pathname.indexOf('/pages/') >= 0 ? '../' : '';
  chain([
    { src: 'https://unpkg.com/@azure/msal-browser@2.38.3/lib/msal-browser.min.js', skip: !!window.msal },
    { src: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js', skip: typeof Chart !== 'undefined' },
    { src: base + 'voz-pbi.js?v=2', skip: !!window.VOZPBI }
  ]);

  // ================= estado visual (orb em canvas — "Jarvis") =================
  var orb = document.getElementById('vza-orb');
  var octx = orb.getContext('2d');
  var statusEl = document.getElementById('vza-status');
  var orbState = 'idle';
  var STG = { idle: '', listening: 'OUVINDO…', thinking: 'ANALISANDO OS DADOS…', speaking: 'FALANDO…' };

  // pontos numa esfera (espiral de fibonacci) + arestas p/ vizinhos
  var ON = 170, OPTS = [], OED = [];
  (function () {
    var ga = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < ON; i++) {
      var y = 1 - (i / (ON - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i;
      OPTS.push({ x: Math.cos(th) * r, y: y, z: Math.sin(th) * r, seed: (i * 2654435761 % 1000) / 1000 * 6.283 });
    }
    for (var a = 0; a < ON; a++) {
      var d = [];
      for (var b = 0; b < ON; b++) if (b !== a) { var dx = OPTS[a].x - OPTS[b].x, dy = OPTS[a].y - OPTS[b].y, dz = OPTS[a].z - OPTS[b].z; d.push([dx * dx + dy * dy + dz * dz, b]); }
      d.sort(function (p, q) { return p[0] - q[0]; });
      for (var k = 0; k < 3; k++) if (d[k][1] > a) OED.push([a, d[k][1]]);
    }
  })();
  var ODPR = Math.min(window.devicePixelRatio || 1, 2);
  function orbResize() { var s = (orb.clientWidth || 150) * ODPR; if (orb.width !== s) { orb.width = s; orb.height = s; } }
  window.addEventListener('resize', orbResize);
  var oRotY = 0, oRotX = -0.28, oLast = 0;
  function orbDraw(t) {
    requestAnimationFrame(orbDraw);
    if (!panel.classList.contains('open')) return;      // não desenha com o popup fechado
    orbResize();                                         // garante buffer quadrado do tamanho atual
    if (!oLast) oLast = t; var dt = Math.min(t - oLast, 50); oLast = t;
    var speed = orbState === 'thinking' ? .0011 : orbState === 'speaking' ? .0006 : orbState === 'listening' ? .00045 : .00028;
    var amp = orbState === 'listening' ? .10 : orbState === 'thinking' ? .075 : orbState === 'speaking' ? .06 + .06 * Math.abs(Math.sin(t * .008)) : .035;
    oRotY += speed * dt;
    var W = orb.width, H = orb.height, cx = W / 2, cy = H / 2, R = Math.min(W, H) * .30, F = 3.2;
    octx.clearRect(0, 0, W, H);
    var g = octx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.5);
    g.addColorStop(0, 'rgba(56,225,255,.20)'); g.addColorStop(.45, 'rgba(36,167,175,.08)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    octx.fillStyle = g; octx.beginPath(); octx.arc(cx, cy, R * 1.5, 0, 6.283); octx.fill();
    var proj = new Array(ON), sy = Math.sin(oRotY), cyy = Math.cos(oRotY), sx = Math.sin(oRotX), cxx = Math.cos(oRotX);
    for (var i = 0; i < ON; i++) {
      var p = OPTS[i], rr = 1 + amp * Math.sin(t * .0022 + p.seed * 3.1);
      var x = p.x * rr, y = p.y * rr, z = p.z * rr;
      var x1 = x * cyy + z * sy, z1 = -x * sy + z * cyy, y2 = y * cxx - z1 * sx, z2 = y * sx + z1 * cxx, sc = F / (F - z2);
      proj[i] = { x: cx + x1 * R * sc, y: cy + y2 * R * sc, z: z2 };
    }
    octx.lineWidth = Math.max(1, ODPR * .7);
    for (var e = 0; e < OED.length; e++) {
      var A = proj[OED[e][0]], B = proj[OED[e][1]], al = .06 + ((A.z + B.z) / 2 + 1) * .20;
      octx.strokeStyle = 'rgba(56,225,255,' + al.toFixed(3) + ')';
      octx.beginPath(); octx.moveTo(A.x, A.y); octx.lineTo(B.x, B.y); octx.stroke();
    }
    for (var n = 0; n < ON; n++) {
      var q = proj[n], al2 = .15 + (q.z + 1) * .30;
      octx.fillStyle = 'rgba(150,240,255,' + al2.toFixed(3) + ')';
      octx.beginPath(); octx.arc(q.x, q.y, ODPR * (q.z > 0 ? 1.5 : 1), 0, 6.283); octx.fill();
    }
    octx.save(); octx.translate(cx, cy);
    octx.strokeStyle = 'rgba(56,225,255,.28)'; octx.lineWidth = ODPR; octx.setLineDash([2 * ODPR, 6 * ODPR]);
    octx.beginPath(); octx.arc(0, 0, R * 1.34, t * .0002, t * .0002 + 4.4); octx.stroke(); octx.setLineDash([]);
    octx.strokeStyle = 'rgba(56,225,255,.16)';
    octx.beginPath(); octx.arc(0, 0, R * 1.52, -t * .00013, -t * .00013 + 2.4); octx.stroke();
    octx.strokeStyle = 'rgba(56,225,255,.35)';
    for (var tk = 0; tk < 14; tk++) { var an = -t * .00013 + tk * .12; octx.beginPath(); octx.moveTo(Math.cos(an) * R * 1.52, Math.sin(an) * R * 1.52); octx.lineTo(Math.cos(an) * R * 1.58, Math.sin(an) * R * 1.58); octx.stroke(); }
    octx.restore();
  }
  requestAnimationFrame(orbDraw);

  // botão tela cheia
  document.getElementById('vza-full').addEventListener('click', function () {
    var f = panel.classList.toggle('full');
    this.textContent = f ? '⤡' : '⛶';
    this.title = f ? 'Sair da tela cheia' : 'Tela cheia';
    setTimeout(orbResize, 60);
  });

  function setState(st, txt) {
    orbState = st || 'idle';
    statusEl.textContent = (txt !== undefined) ? txt : (STG[orbState] || '');
  }

  // ================= transcript =================
  var msgsEl = document.getElementById('vza-msgs');
  function scrollEnd() { msgsEl.scrollTop = msgsEl.scrollHeight; }
  function addQ(t) { var d = document.createElement('div'); d.className = 'vza-q'; d.textContent = t; msgsEl.appendChild(d); scrollEnd(); }
  // Renderiza a resposta com ESTRUTURA: 1ª linha destacada, parágrafos,
  // itens com marcador (•/-/números) e **negrito**. O TTS usa o texto puro.
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function inl(s){ return esc(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/\*(.+?)\*/g,'<b>$1</b>'); }
  function addA(t) {
    var d = document.createElement('div'); d.className = 'vza-a';
    var linhas = String(t).split(/\n+/).map(function(x){return x.trim();}).filter(Boolean);
    var html = '', bulletBuf = [];
    function flush(){ if(bulletBuf.length){ html += '<ul class="vza-ul">' + bulletBuf.map(function(b){return '<li>'+inl(b)+'</li>';}).join('') + '</ul>'; bulletBuf=[]; } }
    linhas.forEach(function(ln, i){
      var mb = ln.match(/^\s*(?:[-•]|\d+[.)])\s+(.*)$/);
      if (mb) { bulletBuf.push(mb[1]); return; }
      flush();
      if (i === 0) html += '<div class="vza-lead">' + inl(ln) + '</div>';
      else html += '<p>' + inl(ln) + '</p>';
    });
    flush();
    d.innerHTML = html || inl(String(t));
    msgsEl.appendChild(d); scrollEnd(); return d;
  }
  function addTool(t) { var d = document.createElement('div'); d.className = 'vza-tool'; d.textContent = '⚙ ' + t; msgsEl.appendChild(d); scrollEnd(); }

  function grafico(spec) {
    var wrap = document.createElement('div'); wrap.className = 'vza-chart';
    var cv = document.createElement('canvas'); cv.style.width = '100%'; cv.style.height = '100%'; wrap.appendChild(cv);
    msgsEl.appendChild(wrap); scrollEnd();
    if (typeof Chart === 'undefined') { wrap.textContent = '(gráfico indisponível)'; return; }
    var money = spec.formato === 'money';
    function fmt(v) { if (spec.formato === 'pct') return (Number(v) * 100).toFixed(1) + '%'; if (money) { var a = Math.abs(v); return a >= 1e6 ? 'R$ ' + (v / 1e6).toFixed(2) + ' mi' : a >= 1e3 ? 'R$ ' + (v / 1e3).toFixed(0) + ' mil' : 'R$ ' + Number(v).toFixed(0); } return Number(v).toLocaleString('pt-BR'); }
    var tipo = spec.tipo === 'line' ? 'line' : 'bar';
    var valAxis = { beginAtZero: true, ticks: { callback: fmt, font: { size: 9 } }, grid: { color: 'rgba(15,23,42,.06)' } };
    var catAxis = { ticks: { font: { size: 9 }, autoSkip: false }, grid: { display: false } };
    new Chart(cv.getContext('2d'), { type: tipo, data: { labels: spec.labels, datasets: [{ data: spec.valores, backgroundColor: tipo === 'line' ? 'rgba(36,167,175,.18)' : 'rgba(12,84,124,.85)', borderColor: '#0C547C', borderWidth: tipo === 'line' ? 2 : 0, fill: tipo === 'line', tension: .3, borderRadius: 4, maxBarThickness: 26, pointRadius: 3, pointBackgroundColor: '#0C547C' }] },
      options: { indexAxis: tipo === 'bar' ? 'y' : 'x', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, title: { display: !!spec.titulo, text: spec.titulo || '', font: { size: 11 } }, tooltip: { callbacks: { label: function (c) { return fmt(c.raw); } } } }, scales: tipo === 'bar' ? { x: valAxis, y: catAxis } : { x: catAxis, y: valAxis } } });
  }

  // ================= TTS (com correção p/ celular) =================
  var _voz = null;
  var _taxa = Number(localStorage.getItem('vozbi_rate') || 1);
  var _ttsPrimed = false;
  function vozesPt() { var vs = (window.speechSynthesis && speechSynthesis.getVoices()) || []; return vs.filter(function (v) { return /^pt/i.test(v.lang) || /portug/i.test(v.name); }); }
  function melhorVoz() {
    function score(v) { var s = 0; if (/pt[-_]?br/i.test(v.lang)) s += 4; if (/natural|online|neural/i.test(v.name)) s += 12; if (/google/i.test(v.name)) s += 6; if (/antonio|francisca|thalita|brenda|giovanna|donato|maria|luciana|felipe/i.test(v.name)) s += 3; return s; }
    return vozesPt().slice().sort(function (a, b) { return score(b) - score(a); })[0] || null;
  }
  // iOS/Android exigem que um speak() REAL aconteça num GESTO do usuário.
  // Fala uma utterance silenciosa dentro do gesto (destrava o áudio) e limpa
  // a fila logo depois para não travar as falas seguintes.
  function primeTTS() {
    try { if (window.speechSynthesis) speechSynthesis.resume(); } catch (e) {}
    if (_ttsPrimed || !window.speechSynthesis) return;
    _ttsPrimed = true;
    try {
      var u = new SpeechSynthesisUtterance(' ');
      u.volume = 0; u.rate = 2; u.lang = 'pt-BR';
      speechSynthesis.speak(u);
      setTimeout(function () { if (!_falando) { try { speechSynthesis.cancel(); } catch (e) {} } }, 600);
    } catch (e) {}
  }

  // Fala o texto inteiro numa utterance (confiável no desktop) + keep-alive.
  var _falando = false, _keep = null, _falaSeq = 0;
  function falar(texto, bolha) {
    if (!window.speechSynthesis) return;
    var txt = String(texto).replace(/\s+/g, ' ').trim();
    if (!txt) return;
    try { speechSynthesis.cancel(); } catch (e) { }
    if (_keep) { clearInterval(_keep); _keep = null; }
    setState('speaking', 'Falando…');
    if (bolha) bolha.classList.add('speaking-now');
    var seq = ++_falaSeq;

    function dizer() {
      if (seq !== _falaSeq) return;
      var u = new SpeechSynthesisUtterance(txt);
      u.rate = _taxa; u.volume = 1; u.pitch = 1;
      var v = _voz || melhorVoz();
      if (v) { u.voice = v; u.lang = v.lang || 'pt-BR'; } else { u.lang = 'pt-BR'; }
      u.onend = u.onerror = function () {
        _falando = false; if (_keep) { clearInterval(_keep); _keep = null; }
        if (bolha) bolha.classList.remove('speaking-now'); setState('idle', '');
      };
      _falando = true;
      try { speechSynthesis.speak(u); } catch (e) { _falando = false; }
      // Chrome pausa síntese longa — mantém viva enquanto fala
      _keep = setInterval(function () { if (!_falando) { clearInterval(_keep); _keep = null; return; } try { speechSynthesis.resume(); } catch (e) { } }, 5000);
    }
    // Android descarta um speak() chamado logo após cancel() — a pequena
    // espera resolve; também dá tempo de as vozes carregarem no 1º uso.
    if (speechSynthesis.getVoices().length) setTimeout(dizer, 180);
    else { try { speechSynthesis.getVoices(); } catch(e){} setTimeout(dizer, 400); }
  }
  function popularVozes() {
    var sel = document.getElementById('vza-voice'); if (!sel) return; var vs = vozesPt(); if (!vs.length) return;
    var salva = localStorage.getItem('vozbi_voz');
    sel.innerHTML = vs.map(function (v) { var nome = v.name.replace('Microsoft ', '').replace('Google ', ''); var tag = /natural|online|neural/i.test(v.name) ? ' ⭐' : ''; return '<option value="' + v.name + '">' + nome + tag + '</option>'; }).join('');
    var pick = (salva && vs.filter(function (v) { return v.name === salva; })[0]) || melhorVoz();
    if (pick) { _voz = pick; sel.value = pick.name; }
    sel.onchange = function () { _voz = vs.filter(function (v) { return v.name === sel.value; })[0] || null; if (_voz) localStorage.setItem('vozbi_voz', _voz.name); falar('Este é um exemplo da minha voz.'); };
    var rate = document.getElementById('vza-rate'); if (rate) { rate.value = _taxa; rate.oninput = function () { _taxa = Number(rate.value); localStorage.setItem('vozbi_rate', rate.value); }; }
  }

  // ================= schema dinâmico (perfil Negociações) =================
  // O modelo de Negociações não tem prompt fixo: na 1ª pergunta o agente lê os
  // METADADOS reais do dataset (INFO.VIEW.*) e manda junto pro LLM. Cache 24h.
  var _schemaTxt = null;
  async function pbiPronto() {
    var t = 0;
    while (!window.VOZPBI && t++ < 40) await new Promise(function (r) { setTimeout(r, 250); });
    return !!window.VOZPBI;
  }
  async function ensureSchemaNeg() {
    if (PERFIL !== 'negociacoes' || _schemaTxt) return;
    var key = 'vozneg_schema_' + NEG_DATASET.slice(0, 8);
    try {
      var cached = JSON.parse(localStorage.getItem(key) || 'null');
      if (cached && cached.txt && (Date.now() - cached.t) < 86400000) { _schemaTxt = cached.txt; return; }
    } catch (e) { }
    try {
      var cols = [], meas = [];
      try {
        cols = await window.VOZPBI.query('EVALUATE SELECTCOLUMNS(FILTER(INFO.VIEW.COLUMNS(), NOT [IsHidden]), "t", [Table], "c", [Name], "ty", [DataType])');
      } catch (e1) {
        // fallback: COLUMNSTATISTICS lista tabela+coluna (sem tipos)
        try {
          cols = (await window.VOZPBI.query('EVALUATE COLUMNSTATISTICS()')).map(function (r) {
            return { '[t]': r['[Table Name]'], '[c]': r['[Column Name]'], '[ty]': '' };
          });
        } catch (e2) { console.warn('[voz] sem colunas:', e2); }
      }
      try {
        meas = await window.VOZPBI.query('EVALUATE SELECTCOLUMNS(INFO.VIEW.MEASURES(), "m", [Name], "d", [Description])');
      } catch (e3) { }

      var porTab = {};
      (cols || []).forEach(function (r) {
        var t = String(r['[t]'] || '');
        if (!t || /^(DateTableTemplate|LocalDateTable)/i.test(t)) return;   // tabelas ocultas de data
        (porTab[t] = porTab[t] || []).push(String(r['[c]'] || ''));
      });
      var out = ['TABELAS E COLUNAS:'];
      Object.keys(porTab).sort().forEach(function (t) { out.push("'" + t + "': " + porTab[t].join(', ')); });
      if (meas && meas.length) {
        out.push(''); out.push('MEDIDAS (use exatamente como [Nome]):');
        meas.forEach(function (r) { out.push('[' + String(r['[m]'] || '') + ']' + (r['[d]'] ? ' — ' + String(r['[d]']) : '')); });
      } else {
        out.push(''); out.push('(Não foi possível listar medidas — derive agregações com SUM/COUNTROWS/AVERAGE/DISTINCTCOUNT sobre as colunas.)');
      }
      _schemaTxt = out.join('\n').slice(0, 22000);
      try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), txt: _schemaTxt })); } catch (e) { }
    } catch (e) { console.warn('[voz] schema negociações falhou:', e); }
  }

  // ================= protocolo /api/chat =================
  var messages = [];
  async function postChat() {
    var body = { messages: messages, perfil: PERFIL };
    if (PERFIL === 'negociacoes' && _schemaTxt) body.schema = _schemaTxt;
    var r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    var j = await r.json();
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    if (j.model || j.deployment) { var m = document.getElementById('vza-model'); if (m) m.textContent = j.model || j.deployment; }
    return j.message;
  }

  async function ask(texto) {
    primeTTS();
    addQ(texto);
    messages.push({ role: 'user', content: texto });
    setState('thinking', 'Analisando seus dados…');
    if (PERFIL === 'negociacoes' && !_schemaTxt) {
      setState('thinking', 'Mapeando o modelo de Negociações…');
      try { if (await pbiPronto()) await ensureSchemaNeg(); } catch (e) { }
      setState('thinking', 'Analisando seus dados…');
    }
    try {
      for (var i = 0; i < 12; i++) {
        var asst = await postChat();
        messages.push(asst);
        if (asst.tool_calls && asst.tool_calls.length) {
          for (var k = 0; k < asst.tool_calls.length; k++) {
            var tc = asst.tool_calls[k];
            var res;
            if (tc.function.name === 'mostrar_grafico') {
              try { var spec = JSON.parse(tc.function.arguments); grafico(spec); res = 'gráfico exibido para o usuário'; }
              catch (e) { res = 'ERRO ao gerar gráfico: ' + (e && e.message ? e.message : e); }
            } else {
              try {
                var dax = JSON.parse(tc.function.arguments).dax;
                setState('thinking', 'Consultando o Power BI…');
                var rows = await window.VOZPBI.query(dax);
                res = JSON.stringify(rows).slice(0, 20000);
              } catch (e) { var em = (e && e.message ? e.message : String(e)); res = 'ERRO ao executar DAX (corrija e tente outra query): ' + em; addTool('erro: ' + em.slice(0, 160)); }
            }
            messages.push({ role: 'tool', tool_call_id: tc.id, content: res });
          }
          continue;
        }
        var resp = asst.content || '';
        var promessa = /(vou|irei|ja vou|já vou|vamos)\s+(buscar|consultar|trazer|puxar|verificar|ver)|ja volto|já volto|um momento|aguarde|deixa eu/i.test(resp);
        if (!resp || promessa) {
          messages.push({ role: 'user', content: 'Continue agora: rode as consultas necessárias e me dê a resposta final direto, sem anunciar que vai buscar.' });
          continue;
        }
        // separa a linha "FALA:" — resumo falado gerado pelo modelo (não aparece no chat)
        var falaTxt = null;
        var mFala = resp.match(/(?:^|\n)\s*FALA:\s*([\s\S]+?)\s*$/i);
        if (mFala) { falaTxt = mFala[1].replace(/\s+/g, ' ').trim(); resp = resp.slice(0, mFala.index).trim(); }
        var bolha = addA(resp);
        // sem FALA: lê só a 1ª linha (resposta direta), não o texto inteiro
        var fala = falaTxt || String(resp).split(/\n/)[0].replace(/\*\*?(.+?)\*\*?/g, '$1').replace(/^\s*[-•]\s+/, '').trim();
        falar(fala, bolha);
        return;
      }
      setState('idle', ''); addA('Não consegui concluir a consulta (muitas etapas).');
    } catch (e) { setState('idle', ''); addA('Erro: ' + (e && e.message ? e.message : e)); }
  }

  var form = document.getElementById('vza-form');
  var input = document.getElementById('vza-input');
  var micBtn = document.getElementById('vza-mic');
  form.addEventListener('submit', function (e) { e.preventDefault(); var t = input.value.trim(); if (!t) return; input.value = ''; ask(t); });

  // ---- microfone (STT) ----
  // Correção fonética: o reconhecimento de voz troca "BIO" por "bill/biu/bio"
  // e "MSB" por "eme esse bê / ms b". Normaliza ANTES de mandar pro LLM.
  function corrigirVoz(t) {
    if (!t) return t;
    return t
      .replace(/\b(bill|billy|biu|b[íìi]o|b[íìi]u|vio)\b/gi, 'BIO')
      .replace(/\b(msb|mesb|mesbe|eme\s+esse\s+b[eê]|m\s+s\s+b)\b/gi, 'MSB');
  }
  var SRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  var canGravar = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  // Edge desktop tem Web Speech mas falha calado (language-not-supported) —
  // quando isso acontece uma vez, lembramos e vamos direto pra gravação.
  var usarSR = !!SRec && localStorage.getItem('voz_stt_fallback') !== '1';

  // ---- fallback: grava com MediaRecorder e transcreve no servidor ----
  var _gravador = null, _gravTimer = null;
  function pararGravacao() { try { if (_gravador && _gravador.state !== 'inactive') _gravador.stop(); } catch (e) {} }
  function iniciarGravacao() {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var mime = '';
      ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].some(function (m) {
        if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) { mime = m; return true; } return false;
      });
      var chunks = [];
      _gravador = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      _gravador.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      _gravador.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        if (_gravTimer) { clearTimeout(_gravTimer); _gravTimer = null; }
        micBtn.classList.remove('on');
        _gravador = null;
        var blob = new Blob(chunks, { type: (mime || 'audio/webm').split(';')[0] });
        if (blob.size < 1200) { setState('idle', 'Não ouvi nada — toque no 🎤 e fale de novo.'); return; }
        setState('thinking', 'Transcrevendo sua fala…');
        var fr = new FileReader();
        fr.onloadend = function () {
          var b64 = String(fr.result || '').split(',')[1] || '';
          fetch('/api/transcrever', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio: b64, mime: (mime || 'audio/webm').split(';')[0] }) })
            .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
            .then(function (x) {
              if (!x.ok) { setState('idle', 'Transcrição indisponível: ' + ((x.j && x.j.error) || 'erro no servidor')); return; }
              var t = corrigirVoz(String((x.j && x.j.text) || '').trim());
              if (!t) { setState('idle', 'Não entendi — toque no 🎤 e fale de novo.'); return; }
              ask(t);
            })
            .catch(function () { setState('idle', 'Falha ao transcrever — tente de novo.'); });
        };
        fr.readAsDataURL(blob);
      };
      _gravador.start();
      micBtn.classList.add('on');
      setState('listening', 'Ouvindo… toque no 🎤 de novo para enviar');
      _gravTimer = setTimeout(pararGravacao, 30000);   // limite de 30 s por fala
    }).catch(function () {
      setState('idle', 'Permita o microfone no navegador.');
    });
  }
  function micGravacao() {
    if (_gravador) { pararGravacao(); return; }        // 2º toque = enviar
    try { speechSynthesis.cancel(); } catch (e) {}
    iniciarGravacao();
  }

  if (SRec || canGravar) {
    var rec = null, ouv = false, _finalTxt = '', _interimTxt = '';
    if (SRec) {
      rec = new SRec(); rec.lang = 'pt-BR'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
      rec.onstart = function () { ouv = true; micBtn.classList.add('on'); setState('listening', 'Ouvindo… fale sua pergunta'); };
      rec.onresult = function (e) {
        _interimTxt = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var r = e.results[i];
          if (r.isFinal) _finalTxt += r[0].transcript;
          else _interimTxt += r[0].transcript;
        }
        // feedback ao vivo no campo enquanto fala
        input.value = (_finalTxt + ' ' + _interimTxt).trim();
      };
      rec.onerror = function (e) {
        // Web Speech quebrado neste navegador (Edge/offline) → muda pra gravação+servidor
        if (e.error === 'language-not-supported' || e.error === 'service-not-allowed' || e.error === 'network') {
          usarSR = false; ouv = false;
          if (e.error !== 'network') { try { localStorage.setItem('voz_stt_fallback', '1'); } catch (_) {} }
          if (canGravar) { iniciarGravacao(); return; }
          setState('idle', 'Reconhecimento de voz não funciona neste navegador.');
          return;
        }
        var msg = e.error === 'not-allowed' ? 'Permita o microfone no navegador.'
                : e.error === 'no-speech' ? 'Não ouvi nada — toque no 🎤 e fale de novo.'
                : e.error === 'audio-capture' ? 'Microfone não encontrado.'
                : '';
        setState('idle', msg);
      };
      // ao terminar (parou de falar ou 2º clique), ENVIA o texto reconhecido
      rec.onend = function () {
        if (!usarSR) return;                           // o fallback assumiu este ciclo
        ouv = false; micBtn.classList.remove('on');
        var t = corrigirVoz((_finalTxt || _interimTxt || input.value || '').trim());
        _finalTxt = ''; _interimTxt = '';
        if (t) { input.value = ''; ask(t); }
        else if (orbState === 'listening') setState('idle', '');
      };
    }
    if (!SRec) usarSR = false;
    micBtn.addEventListener('click', function () {
      primeTTS();
      if (!usarSR) { micGravacao(); return; }
      if (ouv) { rec.stop(); return; }                 // 2º clique = parar e enviar o que ouviu
      try { speechSynthesis.cancel(); } catch (e) { }
      _finalTxt = ''; _interimTxt = '';
      try { rec.start(); } catch (e) { try { rec.stop(); } catch(_){} }
    });
  } else {
    // navegador sem reconhecimento e sem gravação — só digitação (a RESPOSTA sai em voz normalmente)
    micBtn.style.display = 'none';
    input.placeholder = 'Digite sua pergunta… (a resposta sai em voz)';
  }

  // ---- primeira abertura ----
  function boot() {
    popularVozes();
    if (window.speechSynthesis) speechSynthesis.onvoiceschanged = popularVozes;
    addA(PERFIL === 'negociacoes'
      ? 'Oi! Sou o assistente de **Negociações**. Pergunte sobre oportunidades, funil, cotações e licitações — ex.: “quanto tem no pipeline?”, “oportunidades por fase”, “cotações em aberto”.'
      : 'Oi! Sou o assistente comercial. Pergunte sobre vendas que eu analiso seus dados — ex.: “como foi junho vs maio?”, “top 5 famílias esse ano”, “gráfico da evolução de 2026”.');
    function conectar() { if (window.VOZPBI) { window.VOZPBI.connect().catch(function () { }); } else setTimeout(conectar, 500); }
    conectar();
  }
})();
