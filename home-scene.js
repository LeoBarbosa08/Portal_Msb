// =====================================================================
// home-scene.js — BioNiko em 3D no hero da HOME (Layout v3)
// ---------------------------------------------------------------------
// Mascote da Biomedical com traço de desenho (toon + contorno): flutua no
// espaço, acena ao entrar e ao clique, pisca, segue o mouse com a cabeça
// e é orbitado por um anel de dados (o portal conectando as áreas).
// Three.js vem do cdnjs SÓ aqui e só depois da entrada do texto; celular /
// máquina fraca = cena simplificada; movimento reduzido = quadro parado.
// O logo do peito é a "órbita" da marca desenhada em canvas.
// Uso: window.bmCreateHeroScene(container, {low, still}) → Promise<cena>
// Tela de login (auth.js): {placement:'panel', band(), onAnchor(x, y)} →
// BioNiko no painel da marca, cabendo na faixa livre que band() devolve
// ({top, bottom, anchorX} em px do container); onAnchor recebe a cada quadro
// o ponto ao lado da cabeça, onde o balão de fala em HTML se apoia.
// {niko:false} → sem o mascote: só o anel girando, o brilho e a poeira
// (a HOME, desde 01/10/26). O BioNiko inteiro está guardado em docs/bioniko/.
// =====================================================================
(function () {
  'use strict';
  var THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.186.1/three.module.min.js';

  function buildNiko(THREE, low) {
    var NAVY = '#1A5586', WHITE = '#F4F8FC', LINING = '#D3DEEB', CYAN = '#3AA8C8', CYAN_L = '#5EC0DA', RIB = '#9CC3DB', CHEEK = '#C2CFE3', EYE = '#0E2C4F';
    var grad = new THREE.DataTexture(new Uint8Array([120, 190, 255]), 3, 1, THREE.RedFormat);
    grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.needsUpdate = true;
    var toon = function (c, extra) { var o = { color: c, gradientMap: grad }; if (extra) for (var k in extra) o[k] = extra[k]; return new THREE.MeshToonMaterial(o); };
    var flat = function (c) { return new THREE.MeshBasicMaterial({ color: c }); };
    var lineMat = new THREE.MeshBasicMaterial({ color: NAVY, side: THREE.BackSide });
    var seg = low ? 32 : 64;
    var outline = function (mesh, k) { var o = new THREE.Mesh(mesh.geometry, lineMat); o.scale.setScalar(k || 1.05); mesh.add(o); return mesh; };
    var sphere = function (r, s) { s = s || seg; return new THREE.SphereGeometry(r || 1, s, Math.max(12, (s * 0.7) | 0)); };

    var niko = new THREE.Group();

    /* cabeça: capacete redondo, forro claro, visor ciano */
    var head = new THREE.Group(); head.position.y = 0.1; niko.add(head);
    var helmet = outline(new THREE.Mesh(sphere(), toon(WHITE)), 1.045);
    helmet.scale.set(1, 0.95, 0.92); helmet.position.y = 0.95; head.add(helmet);
    var lining = new THREE.Mesh(sphere(), toon(LINING));
    lining.scale.set(0.8, 0.64, 0.36); lining.position.set(0.03, 0.92, 0.66); head.add(lining);

    var VA = 0.66, VB = 0.5, VC = 0.32;
    var face = new THREE.Group(); face.position.set(0.04, 0.97, 0.8); head.add(face);
    var visor = outline(new THREE.Mesh(sphere(), toon(CYAN)), 1.07);
    visor.scale.set(VA, VB, VC); face.add(visor);
    var onVisor = function (obj, x, y, lift) {
      lift = lift == null ? 0.012 : lift;
      var z = VC * Math.sqrt(Math.max(0, 1 - Math.pow(x / VA, 2) - Math.pow(y / VB, 2)));
      var n = new THREE.Vector3(x / (VA * VA), y / (VB * VB), z / (VC * VC)).normalize();
      obj.position.set(x, y, z).addScaledVector(n, lift);
      obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      face.add(obj); return obj;
    };
    var eyeGeo = new THREE.CircleGeometry(1, 32);
    var eyeL = onVisor(new THREE.Mesh(eyeGeo, flat(EYE)), -0.17, 0.08); eyeL.scale.set(0.062, 0.1, 1);
    var eyeR = onVisor(new THREE.Mesh(eyeGeo, flat(EYE)), 0.17, 0.08); eyeR.scale.set(0.062, 0.1, 1);
    onVisor(new THREE.Mesh(new THREE.CircleGeometry(0.02, 16), flat('#FFFFFF')), -0.185, 0.12, 0.02);
    onVisor(new THREE.Mesh(new THREE.CircleGeometry(0.02, 16), flat('#FFFFFF')), 0.155, 0.12, 0.02);
    var smile = onVisor(new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.018, 8, 32, Math.PI), flat(EYE)), 0, -0.1, 0.02);
    smile.rotateZ(Math.PI);
    onVisor(new THREE.Mesh(new THREE.CircleGeometry(0.1, 32), flat(CHEEK)), -0.44, -0.16, 0.012);
    onVisor(new THREE.Mesh(new THREE.CircleGeometry(0.1, 32), flat(CHEEK)), 0.44, -0.16, 0.012);

    /* antena */
    var antenna = new THREE.Group(); antenna.position.set(-0.74, 0.75, 0.38); head.add(antenna);
    var stick = outline(new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 1.05, 12), toon(CYAN_L)), 1.35);
    stick.position.y = 0.52; antenna.add(stick);
    var ball = outline(new THREE.Mesh(sphere(0.075, 20), toon(CYAN_L, { emissive: new THREE.Color('#1d7f9a'), emissiveIntensity: 0.4 })), 1.15);
    ball.position.y = 1.08; antenna.add(ball);

    /* corpo em formato de sino + logo "órbita" no peito */
    var prof = [[0, -0.7], [0.5, -0.69], [0.66, -0.62], [0.72, -0.46], [0.71, -0.12], [0.64, 0.22], [0.52, 0.5], [0.32, 0.66], [0, 0.7]].map(function (p) { return new THREE.Vector2(p[0], p[1]); });
    var body = outline(new THREE.Mesh(new THREE.LatheGeometry(prof, seg), toon(WHITE)), 1.05);
    body.scale.set(1, 1, 0.82); body.position.y = -0.55; niko.add(body);
    var logoTex = (function () {
      var c = document.createElement('canvas'); c.width = c.height = 256; var g = c.getContext('2d');
      var gr = g.createLinearGradient(50, 40, 210, 220); gr.addColorStop(0, '#2E8FE0'); gr.addColorStop(1, '#1FB8A6');
      g.beginPath(); g.arc(128, 128, 92, 0, Math.PI * 2); g.fillStyle = gr; g.fill();
      g.save(); g.translate(128, 128); g.rotate(-0.5);
      g.beginPath(); g.ellipse(0, 0, 118, 46, 0, 0, Math.PI * 2); g.lineWidth = 16; g.strokeStyle = '#1A5586'; g.stroke();
      g.beginPath(); g.ellipse(0, 12, 72, 26, 0, Math.PI * 1.05, Math.PI * 1.95); g.lineWidth = 15; g.lineCap = 'round'; g.strokeStyle = '#FFFFFF'; g.stroke();
      g.restore();
      var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
    })();
    var logo = new THREE.Mesh(new THREE.CircleGeometry(0.27, 40), new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, depthWrite: false }));
    logo.position.set(0, -0.62, 0.595); niko.add(logo);

    /* braços canelados */
    var makeArm = function (side) {
      var pivot = new THREE.Group(); pivot.position.set(0.5 * side, -0.05, 0); niko.add(pivot);
      var core = outline(new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.62, 6, low ? 16 : 24), toon(WHITE)), 1.12);
      core.position.y = -0.44; pivot.add(core);
      for (var k = 0; k < 6; k++) {
        var ring = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.02, 8, 28), toon(RIB));
        ring.rotation.x = Math.PI / 2; ring.position.y = -0.16 - k * 0.1; pivot.add(ring);
      }
      var hand = outline(new THREE.Mesh(sphere(0.15, 28), toon(WHITE)), 1.12);
      hand.scale.set(1, 1.1, 0.9); hand.position.y = -0.9; pivot.add(hand);
      return pivot;
    };
    var armL = makeArm(-1), armR = makeArm(1);
    armL.rotation.z = -0.2; armR.rotation.z = 0.2;

    /* pernas curtas */
    [-1, 1].forEach(function (side) {
      var leg = outline(new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.2, 6, low ? 16 : 24), toon(WHITE)), 1.1);
      leg.position.set(0.28 * side, -1.38, 0); niko.add(leg);
      [0, 1].forEach(function (k) {
        var ring = new THREE.Mesh(new THREE.TorusGeometry(0.168, 0.02, 8, 28), toon(RIB));
        ring.rotation.x = Math.PI / 2; ring.position.set(0.28 * side, -1.3 - k * 0.1, 0); niko.add(ring);
      });
    });

    return { niko: niko, head: head, eyes: [eyeL, eyeR], antenna: antenna, ball: ball, armR: armR, armL: armL };
  }

  function createHeroScene(container, opts) {
    opts = opts || {};
    return import(THREE_URL).then(function (THREE) {
      var low = !!opts.low, still = !!opts.still;
      var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1.5 : 2));
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.setClearColor(0x000000, 0);
      container.appendChild(renderer.domElement);

      var scene = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
      camera.position.set(0, 0, 11);
      scene.add(new THREE.HemisphereLight('#ffffff', '#5a7fb5', 1.35));
      var key = new THREE.DirectionalLight('#ffffff', 1.9); key.position.set(3.5, 4, 6); scene.add(key);
      var rim = new THREE.DirectionalLight('#8fd8ff', 1.2); rim.position.set(-5, 2, -4); scene.add(rim);

      var root = new THREE.Group(); scene.add(root);
      var N = opts.niko === false ? null : buildNiko(THREE, low);
      var rig = new THREE.Group(); if (N) rig.add(N.niko); root.add(rig);

      /* brilho atrás */
      var haloTex = (function () {
        var c = document.createElement('canvas'); c.width = c.height = 128;
        var g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        gr.addColorStop(0, 'rgba(127,227,240,0.45)'); gr.addColorStop(0.4, 'rgba(70,140,240,0.22)'); gr.addColorStop(1, 'rgba(40,90,200,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
        var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
      })();
      var halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.set(7.2, 7.2, 1); halo.position.set(0, 0.1, -2.5); root.add(halo);

      /* anel de órbita com pulsos de dados */
      var orbit = new THREE.Group(); orbit.rotation.set(-1.2, 0.28, 0); root.add(orbit);
      var R = 2.35;
      orbit.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.014, 8, 160), new THREE.MeshBasicMaterial({ color: '#7FE3F0', transparent: true, opacity: 0.55 })));
      var PULSES = low ? 5 : 8, pulses = [];
      for (var i = 0; i < PULSES; i++) {
        var p = new THREE.Mesh(new THREE.SphereGeometry(i % 3 === 0 ? 0.07 : 0.045, 12, 12), new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? '#F4A62A' : '#CFF7FF' }));
        orbit.add(p); pulses.push({ m: p, a: (i / PULSES) * Math.PI * 2, s: 0.35 + (i % 3) * 0.08 });
      }

      /* poeira de estrelas */
      var dustN = low ? 240 : 650, dp = new Float32Array(dustN * 3);
      for (var j = 0; j < dustN; j++) {
        var r = 4 + Math.random() * 7, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
        dp[j * 3] = r * Math.sin(ph) * Math.cos(th); dp[j * 3 + 1] = r * Math.cos(ph) * 0.6; dp[j * 3 + 2] = r * Math.sin(ph) * Math.sin(th) - 2;
      }
      var dotTex = (function () { var c = document.createElement('canvas'); c.width = c.height = 32; var g = c.getContext('2d'); var gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
      var dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
      var dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.07, map: dotTex, color: '#a8c8ff', transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
      root.add(dust);

      /* layout responsivo: à direita no desktop, no topo no celular */
      var W = 1, H = 1;
      function layout() {
        W = container.clientWidth || 1; H = container.clientHeight || 1;
        renderer.setSize(W, H, false);
        camera.aspect = W / H; camera.updateProjectionMatrix();
        var mobile = W / H < 1.1 || W < 1024;
        var halfW = Math.tan(THREE.MathUtils.degToRad(16)) * 11 * camera.aspect;
        var band = opts.placement === 'panel' && opts.band ? opts.band() : null;
        if (band && band.bottom - band.top > 60) {
          // tela de login (desktop): band() = faixa livre entre o logo e o texto, em px do
          // container. O BioNiko cabe nela e fica centrado. A câmera mira root/2, então o
          // centro aparente dele (0.175·s acima da raiz) fica em (root/2 + 0.175·s)/halfH.
          var halfH = Math.tan(THREE.MathUtils.degToRad(16)) * 11;
          var s = Math.max(0.24, Math.min(0.58, (band.bottom - band.top) / H * 2 * halfH / 4));
          var ndcY = 1 - (band.top + band.bottom) / H;
          var rx = halfW * 0.28;
          // anchorX: a cabeça (onde o balão se apoia) não fica à esquerda disso
          if (band.anchorX) rx = Math.max(rx, 2 * halfW * (2 * band.anchorX / W - 1) + 2.1 * s);
          rx = Math.min(rx, 2 * (0.96 * halfW - 2.35 * s));   // o anel não sai pela direita
          root.position.set(rx, 2 * (ndcY * halfH - 0.175 * s), 0); root.scale.setScalar(s);
        }
        else if (opts.placement === 'panel') {
          // tela de login sem faixa: painel alto = metade de cima; faixa do topo (celular)
          if (H > W * 0.9) { root.position.set(halfW * 0.28, 1.3, 0); root.scale.setScalar(0.58); }
          else { root.position.set(Math.min(1.5, halfW * 0.4), 0.45, 0); root.scale.setScalar(Math.min(0.72, halfW / 3.8)); }
        }
        else if (mobile) { root.position.set(0, -0.2, 0); root.scale.setScalar(Math.min(0.62, halfW / 2.8)); }
        else { root.position.set(Math.min(1.9, halfW * 0.24), -0.3, 0); root.scale.setScalar(Math.min(0.9, halfW / 5.4)); }
        if (still) render();
      }

      /* interação: mouse (olhar), clique (aceno + pulo), rolagem */
      var target = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
      var scrollP = 0, t = 0, running = false, raf = 0, burstUntil = 0, wave = 0, blinkAt = 3.2;
      var introUntil = still ? 0 : performance.now() + 2800;
      var onMove = function (e) { target.x = (e.clientX / window.innerWidth) * 2 - 1; target.y = (e.clientY / window.innerHeight) * 2 - 1; };
      var onDown = function (e) { if (e.target && e.target.closest && e.target.closest('a, button, input')) return; burstUntil = t + 2.2; if (still) { update(0.016); render(); } };
      window.addEventListener('pointermove', onMove, { passive: true });
      var hero = container.parentElement; if (hero) hero.addEventListener('pointerdown', onDown);

      function update(dt) {
        t += dt;
        cur.x += (target.x - cur.x) * 0.06; cur.y += (target.y - cur.y) * 0.06;
        var burst = t < burstUntil;
        if (N) {
          rig.position.y = Math.sin(t * 1.1) * 0.12 + (burst ? Math.abs(Math.sin((burstUntil - t) * 6)) * 0.18 : 0);
          rig.rotation.z = Math.sin(t * 0.8) * 0.04;
          rig.rotation.y = cur.x * 0.22 + Math.sin(t * 0.5) * 0.06;
          rig.rotation.x = scrollP * 0.35;
          N.head.rotation.y = cur.x * 0.32; N.head.rotation.x = cur.y * 0.14;
          var waving = burst || performance.now() < introUntil;
          wave += ((waving ? 1 : 0) - wave) * 0.07;
          N.armR.rotation.z = 0.2 + wave * 2.25 + Math.sin(t * 9) * 0.3 * wave;
          N.armL.rotation.z = -0.2 - Math.sin(t * 1.3) * 0.03;
          N.antenna.rotation.z = Math.sin(t * 2.2) * 0.05; N.ball.material.emissiveIntensity = 0.35 + (Math.sin(t * 3) * 0.5 + 0.5) * 0.5;
          if (t > blinkAt) { var k = (t - blinkAt) / 0.14; var sy = 0.1 * (k < 1 ? Math.abs(1 - 2 * k) + 0.05 : 1); N.eyes.forEach(function (e) { e.scale.y = sy; }); if (k >= 1) blinkAt = t + 2.8 + Math.random() * 2.5; }
        }
        orbit.rotation.z = t * 0.12;
        pulses.forEach(function (p) { var a = p.a + t * p.s * (burst ? 2.2 : 1); p.m.position.set(Math.cos(a) * R, Math.sin(a) * R, 0); });
        camera.position.x = cur.x * 0.3; camera.position.y = -cur.y * 0.18; camera.position.z = 11 + scrollP * 2;
        camera.lookAt(root.position.x * 0.5, root.position.y * 0.5, 0);
        dust.rotation.y = t * 0.015 + cur.x * 0.08; dust.rotation.x = cur.y * 0.04;
      }
      /* ponto ao lado da cabeça projetado na tela (balão de fala da tela de login) */
      var anchorV = new THREE.Vector3();
      function emitAnchor() {
        if (!opts.onAnchor || !N) return;
        N.head.updateWorldMatrix(true, false);
        N.head.localToWorld(anchorV.set(-1.05, 1.55, 0.2)).project(camera);
        opts.onAnchor((anchorV.x + 1) / 2 * W, (1 - anchorV.y) / 2 * H);
      }
      function render() { renderer.render(scene, camera); emitAnchor(); }
      var last = performance.now();
      function loop(now) { var dt = Math.min((now - last) / 1000, 0.05); last = now; update(dt); render(); raf = requestAnimationFrame(loop); }
      function start() { if (running || still) return; running = true; last = performance.now(); raf = requestAnimationFrame(loop); }
      function stop() { running = false; cancelAnimationFrame(raf); }

      var ro = new ResizeObserver(layout); ro.observe(container);
      var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) start(); else stop(); }, { threshold: 0.02 }); io.observe(container);
      var onVis = function () { if (document.hidden) stop(); else start(); };
      document.addEventListener('visibilitychange', onVis);

      layout(); update(0.016);
      var compiled = Promise.resolve();
      try {
        if (renderer.compileAsync && renderer.extensions && renderer.extensions.has && renderer.extensions.has('KHR_parallel_shader_compile')) compiled = renderer.compileAsync(scene, camera);
        else renderer.compile(scene, camera);
      } catch (e) {}
      return compiled.catch(function () {}).then(function () {
        render();
        if (still) container.classList.add('is-ready');
        else { requestAnimationFrame(function () { container.classList.add('is-ready'); }); start(); }
        return {
          setScroll: function (p) { scrollP = p; if (still) { update(0); render(); } },
          relayout: layout,   // quem mudou o entorno (ex.: a faixa livre do login) pede de novo
          setStill: function (v) { still = !!v; if (still) { stop(); update(0); render(); } else start(); },
          destroy: function () {
            stop(); ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVis);
            window.removeEventListener('pointermove', onMove); if (hero) hero.removeEventListener('pointerdown', onDown);
            scene.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { if (m.map) m.map.dispose(); if (m.gradientMap) m.gradientMap.dispose(); m.dispose(); }); });
            renderer.dispose(); if (renderer.forceContextLoss) renderer.forceContextLoss(); renderer.domElement.remove();
          }
        };
      });
    });
  }

  window.bmCreateHeroScene = createHeroScene;
})();
