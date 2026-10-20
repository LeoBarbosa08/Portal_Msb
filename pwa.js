/* ================================================================
   pwa.js — Liga o portal como PWA (instalável no celular)
   - Injeta <link rel="manifest">, theme-color e metatags do iOS
   - Registra o service worker (/sw.js)
   Carregado em todas as páginas (index.html direto; demais via nav-sidebar.js).
   Idempotente: pode ser chamado mais de uma vez sem duplicar tags.
   ================================================================ */
(function () {
  'use strict';
  var head = document.head || document.getElementsByTagName('head')[0];
  if (!head) return;

  function ensureMeta(name, content) {
    if (document.querySelector('meta[name="' + name + '"]')) return;
    var m = document.createElement('meta');
    m.name = name; m.content = content;
    head.appendChild(m);
  }
  function ensureLink(rel, href, extra) {
    if (document.querySelector('link[rel="' + rel + '"]')) return;
    var l = document.createElement('link');
    l.rel = rel; l.href = href;
    if (extra) Object.keys(extra).forEach(function (k) { l.setAttribute(k, extra[k]); });
    head.appendChild(l);
  }

  // Manifest + tema da barra de status
  ensureLink('manifest', '/manifest.webmanifest');
  ensureMeta('theme-color', '#002E5D');

  // iOS / Android — comportamento de app em tela cheia
  ensureMeta('apple-mobile-web-app-capable', 'yes');
  ensureMeta('mobile-web-app-capable', 'yes');
  ensureMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
  ensureMeta('apple-mobile-web-app-title', 'Biomedical');
  ensureLink('apple-touch-icon', '/icons/apple-touch-icon.png');

  // Registra o service worker
  if ('serviceWorker' in navigator) {
    var reg = function () {
      navigator.serviceWorker.register('/sw.js').catch(function (e) {
        console.warn('[PWA] Falha ao registrar o service worker:', e);
      });
    };
    if (document.readyState === 'complete') reg();
    else window.addEventListener('load', reg);
  }
})();
