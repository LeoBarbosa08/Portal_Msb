// =====================================================================
// portal-mobile.js — acabamento de CELULAR que o CSS não alcança
// (varredura de responsividade 15/10/26). Só age com a tela ≤640px;
// no computador e no tablet não faz nada — nem o Chart.js é tocado
// fora do celular (o rótulo volta inteiro se a janela alargar).
//
// 1. GRÁFICOS (Chart.js): o rótulo da CATEGORIA (cliente, família,
//    unidade…) é encurtado com "…" para caber. Sem isso, nas barras
//    deitadas o nome era cortado pela ESQUERDA ("RICÓRDIA DE PORTO
//    ALEGRE") e nas barras em pé os nomes inclinados se embolavam e
//    roubavam a altura do gráfico. Vale para os ~28 painéis de uma vez:
//    o ajuste fica na escala de categoria do próprio Chart.js, depois de
//    o callback da página montar o texto. O nome inteiro continua na
//    dica (tooltip) ao tocar na barra.
// 2. NÚMEROS GRANDES DOS CARTÕES (KPI): "R$ 40.536.090,96" não cabia no
//    cartão de meia tela — ou era cortado ("7.220.000,(") ou o "R$" ia
//    sozinho para outra linha. A fonte do número diminui o necessário
//    para caber numa linha (mínimo 12px). Só números curtos, com fonte
//    ≥16px, em elemento com "kpi" na classe ou filho direto dele (a FCA
//    usa .ffc-kpi > .v); rótulos e textos ficam como estão.
// =====================================================================
(function () {
  'use strict';
  var W = window, D = document;
  var MQ = W.matchMedia ? W.matchMedia('(max-width: 640px)') : null;
  function celular() { return !!(MQ && MQ.matches); }

  // ------------------------------------------------------------------
  // 1. Rótulos de categoria dos gráficos
  // ------------------------------------------------------------------
  var RET = '…';
  function encurta(ctx, txt, max) {
    if (typeof txt !== 'string' || !txt) return txt;
    if (ctx.measureText(txt).width <= max) return txt;
    var lo = 1, hi = txt.length - 1, ok = 1;
    while (lo <= hi) {   // maior prefixo que cabe com as reticências
      var m = (lo + hi) >> 1;
      if (ctx.measureText(txt.slice(0, m).replace(/[\s·\-–,.]+$/, '') + RET).width <= max) { ok = m; lo = m + 1; } else hi = m - 1;
    }
    return txt.slice(0, ok).replace(/[\s·\-–,.]+$/, '') + RET;
  }
  function ajustaEscala(scale) {
    var ticks = scale.ticks, chart = scale.chart;
    if (!ticks || !ticks.length || !chart || !scale.ctx) return;
    // barras deitadas: o nome fica à esquerda e pode usar até ~40% da
    // largura; barras em pé: o nome inclinado fica curto (até ~110px)
    var max = scale.isHorizontal()
      ? Math.max(64, Math.min(96, (chart.height || 240) * 0.3))
      : Math.max(70, (chart.width || 300) * 0.40);
    var ctx = scale.ctx, fonte = null;
    try { fonte = scale._resolveTickFontOptions(0); } catch (e) {}
    ctx.save();
    if (fonte && fonte.string) ctx.font = fonte.string;
    for (var i = 0; i < ticks.length; i++) {
      var lab = ticks[i].label;
      if (Array.isArray(lab)) ticks[i].label = lab.map(function (l) { return encurta(ctx, l, max); });
      else ticks[i].label = encurta(ctx, lab, max);
    }
    ctx.restore();
  }
  function preparaChart() {
    var C = W.Chart;
    if (!C || !C.registry || !C.registry.getScale) return false;
    var Cat = null;
    try { Cat = C.registry.getScale('category'); } catch (e) {}
    if (!Cat || !Cat.prototype) return false;
    if (Cat.prototype.__bmMobile) return true;
    var orig = Cat.prototype.afterTickToLabelConversion;
    Cat.prototype.afterTickToLabelConversion = function () {
      if (orig) orig.apply(this, arguments);
      if (!celular()) return;
      try { ajustaEscala(this); } catch (e) {}
    };
    Cat.prototype.__bmMobile = true;
    // gráficos que já estavam na tela antes do ajuste: redesenha uma vez
    if (celular()) {
      try { Object.keys(C.instances || {}).forEach(function (k) { try { C.instances[k].update('none'); } catch (e) {} }); } catch (e) {}
    }
    return true;
  }

  // ------------------------------------------------------------------
  // 2. Números grandes dos cartões
  // ------------------------------------------------------------------
  var NUM = /\d/;
  function cabeNumeros() {
    if (!celular()) return;
    var els = D.querySelectorAll('[class*="kpi"], [class*="kpi"] > *');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var txt = el.textContent.replace(/\s+/g, ' ').trim();
      if (!txt || txt.length > 24 || !NUM.test(txt)) continue;
      // só o NÚMERO (texto corrido): o cartão e a grade que o contêm ficam de fora
      if (el.querySelector('div,p,section,article,ul,ol,table,canvas,button,input,select,h1,h2,h3,h4,h5,h6')) continue;
      if (el.dataset.mfit) { el.style.removeProperty('font-size'); el.style.removeProperty('white-space'); }
      var cs = getComputedStyle(el);
      var fs = parseFloat(cs.fontSize);
      if (!(fs >= 16) || el.clientWidth < 40) continue;
      el.style.setProperty('white-space', 'nowrap', 'important');
      var precisa = el.scrollWidth, tem = el.clientWidth - 1;
      if (precisa <= tem) {
        // cabe numa linha: só fica com o nowrap se antes quebrava a linha
        if (!el.dataset.mfit) el.style.removeProperty('white-space');
        else { el.style.removeProperty('white-space'); delete el.dataset.mfit; }
        continue;
      }
      var novo = Math.max(12, Math.floor(fs * tem / precisa * 10) / 10);
      el.style.setProperty('font-size', novo + 'px', 'important');
      el.dataset.mfit = '1';
    }
  }
  var tm = 0;
  function agenda() { clearTimeout(tm); tm = setTimeout(cabeNumeros, 220); }

  function boot() {
    if (!preparaChart()) {
      var n = 0, iv = setInterval(function () { if (preparaChart() || ++n > 300) clearInterval(iv); }, 60);
    }
    agenda();
    var raiz = D.querySelector('.dept-main') || D.body;
    if (W.MutationObserver && raiz) {
      new MutationObserver(function () { if (celular()) agenda(); })
        .observe(raiz, { childList: true, subtree: true, characterData: true });
    }
    W.addEventListener('resize', agenda);
    if (MQ) {
      var mudou = function () {
        agenda();
        // voltou a ser celular (ou deixou de ser): os gráficos refazem os rótulos
        try { var C = W.Chart; Object.keys((C && C.instances) || {}).forEach(function (k) { try { C.instances[k].update('none'); } catch (e) {} }); } catch (e) {}
        if (!celular()) {
          var fx = D.querySelectorAll('[data-mfit]');
          for (var i = 0; i < fx.length; i++) { fx[i].style.removeProperty('font-size'); fx[i].style.removeProperty('white-space'); delete fx[i].dataset.mfit; }
        }
      };
      if (MQ.addEventListener) MQ.addEventListener('change', mudou); else if (MQ.addListener) MQ.addListener(mudou);
    }
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot); else boot();
})();
