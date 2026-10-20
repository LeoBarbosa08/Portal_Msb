// =====================================================================
// portal-tema.js — TEMA CLARO / ESCURO do portal
// ---------------------------------------------------------------------
// A escolha fica no menu do avatar (canto superior direito) e, no
// celular, na aba Perfil. Vai para localStorage['bm-tema'] ('claro' ou
// 'escuro') e vale para todas as abas abertas (evento storage). Padrão:
// claro — quem nunca escolheu não vê diferença nenhuma.
//
// O <head> de cada página tem uma linha inline que marca o <html> com
// data-tema="escuro" ANTES do primeiro quadro, e o portal-tema.css troca
// os tokens (texto, linha, fundo, cartão). Este arquivo cuida do resto,
// que nenhum token alcança: são ~140 páginas com cor fixa no próprio
// <style> (#fff, #0F2831, #E4E9ED…) e HTML montado por JS com style="…".
//
//   1. GERADOR — percorre o CSSOM de todas as folhas (menos a do tema e a
//      da tela de login) e, para cada regra com cor, emite a MESMA regra
//      prefixada por :where(html[data-tema="escuro"]) — especificidade
//      idêntica à original e na mesma ordem, numa <style> que fica por
//      ÚLTIMO no documento. A cor muda conforme o PAPEL dela: fundo claro
//      → navy (branco = cartão; cinza-azulado = um degrau acima; pastel =
//      o mesmo matiz, escuro), texto escuro → claro, linha clara → linha
//      navy, sombra navy → sombra preta. Cor que não precisa mudar é
//      reemitida igual — senão a ordem da cascata quebraria
//      (.btn{#fff} antes de .btn-primary{azul}: o azul tem de continuar
//      vencendo). Tokens (--x) das páginas: se o token só aparece num
//      papel (só fundo, só texto…), a DEFINIÇÃO é convertida; se aparece
//      em papéis misturados, o valor é resolvido e convertido no uso.
//   2. INLINE — style="…" e fill/stroke de SVG, na carga e em tudo que o
//      JS das páginas inserir depois (MutationObserver: roda antes do
//      quadro seguinte, sem piscar). O original fica guardado no elemento:
//      voltar ao claro desfaz exatamente o que foi trocado.
//   3. GRÁFICOS — plugin do Chart.js: eixos, legendas e grade clareiam;
//      o branco que separa as fatias da rosca vira a cor do cartão.
// Impressão: a camada escura é só @media screen e o inline é desfeito no
// beforeprint — o papel sai sempre claro.
// Ilhas que ficam claras: a tela de login e quem tiver .bm-tema-claro.
// Nada aqui pode quebrar a página: cada etapa roda dentro de try/catch.
// =====================================================================
(function () {
  'use strict';
  if (window.BMTema) return;

  var D = document, W = window, H = D.documentElement;
  var KEY = 'bm-tema', ESCURO = 'escuro', CLARO = 'claro';
  var PRE = ':where(html[data-tema="escuro"])';        // prefixo sem especificidade
  var PRE_RAIZ = ':where([data-tema="escuro"])';        // para seletor que começa em html/:root
  var ILHA = '#portal-auth-screen, .bm-tema-claro';
  var ILHA_RX = /#portal-auth-screen|\.pa-[\w-]|\.auth-spinner|\.bm-tema-claro/;
  var NAVY_H = 198;                                    // matiz do petróleo da MSB (o --bmt-card)
  var CARD = { r: 0x24, g: 0x34, b: 0x3B, a: 1 };        // = --bmt-card do portal-tema.css
  var COR_META = '#1D2A31';                              // = --bmt-head (barra do navegador no celular)

  function safe(fn) { return function () { try { return fn.apply(this, arguments); } catch (e) { if (W.console) console.warn('[tema]', e); } }; }
  function salvo() { try { return localStorage.getItem(KEY) === ESCURO ? ESCURO : CLARO; } catch (e) { return CLARO; } }
  function atual() { return H.getAttribute('data-tema') === ESCURO ? ESCURO : CLARO; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ------------------------------------------------------------------
  // CORES — leitura, HSL e a conversão por papel
  // ------------------------------------------------------------------
  var NOMES = {
    white: [255, 255, 255], black: [0, 0, 0], whitesmoke: [245, 245, 245], gainsboro: [220, 220, 220],
    lightgray: [211, 211, 211], lightgrey: [211, 211, 211], silver: [192, 192, 192], gray: [128, 128, 128],
    grey: [128, 128, 128], dimgray: [105, 105, 105], dimgrey: [105, 105, 105], darkgray: [169, 169, 169],
    darkgrey: [169, 169, 169], ghostwhite: [248, 248, 255], aliceblue: [240, 248, 255], snow: [255, 250, 250],
    ivory: [255, 255, 240], floralwhite: [255, 250, 240], seashell: [255, 245, 238], linen: [250, 240, 230],
    beige: [245, 245, 220], honeydew: [240, 255, 240], mintcream: [245, 255, 250], azure: [240, 255, 255],
    lavender: [230, 230, 250], lightyellow: [255, 255, 224], lightcyan: [224, 255, 255], navy: [0, 0, 128],
    midnightblue: [25, 25, 112]
  };
  var COR_RX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?)\([^()]*\)|\b(?:white|black|whitesmoke|gainsboro|lightgr[ae]y|silver|gr[ae]y|dimgr[ae]y|darkgr[ae]y|ghostwhite|aliceblue|snow|ivory|floralwhite|seashell|linen|beige|honeydew|mintcream|azure|lavender|lightyellow|lightcyan|navy|midnightblue)\b/gi;
  var URL_RX = /url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi;

  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, r, g, b;
    if (h < 60) { r = c; g = x; b = 0; } else if (h < 120) { r = x; g = c; b = 0; } else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; } else if (h < 300) { r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  function canal(x, escala) {
    if (x === 'none') return 0;
    var v = parseFloat(x);
    if (isNaN(v)) return NaN;
    return x.slice(-1) === '%' ? v / 100 * escala : v;
  }
  function parse(s) {
    s = String(s).trim().toLowerCase();
    var m;
    if (s.charAt(0) === '#') {
      var h = s.slice(1);
      if (h.length === 3 || h.length === 4) h = h.replace(/./g, '$&$&');
      if (h.length !== 6 && h.length !== 8) return null;
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    }
    if ((m = s.match(/^(rgba?|hsla?)\(([^()]*)\)$/))) {
      var p = m[2].replace(/\s*\/\s*/, ',').split(/\s*,\s*|\s+/).filter(Boolean);
      if (p.length < 3) return null;
      var a = p.length > 3 ? canal(p[3], 1) : 1;
      var c;
      if (m[1].charAt(0) === 'r') c = { r: canal(p[0], 255), g: canal(p[1], 255), b: canal(p[2], 255), a: a };
      else { var x = hsl2rgb(parseFloat(p[0]), canal(p[1], 1) / (p[1].slice(-1) === '%' ? 1 : 100), canal(p[2], 1) / (p[2].slice(-1) === '%' ? 1 : 100)); c = { r: x[0], g: x[1], b: x[2], a: a }; }
      if (isNaN(c.r) || isNaN(c.g) || isNaN(c.b) || isNaN(c.a)) return null;
      c.r = clamp(c.r, 0, 255); c.g = clamp(c.g, 0, 255); c.b = clamp(c.b, 0, 255); c.a = clamp(c.a, 0, 1);
      return c;
    }
    var n = NOMES[s];
    return n ? { r: n[0], g: n[1], b: n[2], a: 1 } : null;
  }
  function info(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h: h, s: s, l: l, ch: d };
  }
  function hsl(h, s, l, a) { var x = hsl2rgb(h, s, l); return { r: x[0], g: x[1], b: x[2], a: a == null ? 1 : a }; }
  function fmt(c) {
    var r = Math.round(c.r), g = Math.round(c.g), b = Math.round(c.b), a = Math.round(c.a * 1000) / 1000;
    return a >= 1 ? 'rgb(' + r + ', ' + g + ', ' + b + ')' : 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')';
  }
  var BRANCO = function (a) { return { r: 255, g: 255, b: 255, a: a }; };
  // tom do matiz misturado ao navy do cartão (t = quanto do matiz entra):
  // o pastel claro vira um véu da mesma cor sobre o fundo escuro, sem
  // saturar (amarelo não vira mostarda, vermelho não vira vinho forte)
  function tom(h, t, a) {
    if (h >= 42 && h <= 68) h = 36 + (h - 42) * 0.25;      // amarelo sobre navy vira oliva: puxa para o âmbar
    var v = hsl2rgb(h, 0.75, 0.5);
    return { r: CARD.r + (v[0] - CARD.r) * t, g: CARD.g + (v[1] - CARD.g) * t, b: CARD.b + (v[2] - CARD.b) * t, a: a };
  }

  // Cada função devolve a PRÓPRIA cor quando não precisa mudar (o texto
  // original é mantido como estava, sem reformatar).
  function mapBg(c) {
    if (!c || c.a === 0) return c;
    var k = info(c);
    if (k.l >= 0.80) {
      if (c.a <= 0.35) return c;                                  // véu branco translúcido (vidro sobre o navy): fica
      if (k.ch < 0.06) {                                          // branco / cinza-azulado claro
        if (k.l >= 0.985) return { r: CARD.r, g: CARD.g, b: CARD.b, a: c.a };
        var base = hsl(NAVY_H, 0.34, clamp(0.205 + (0.985 - k.l) * 1.4, 0.2, 0.40), c.a);   // um degrau acima do cartão
        // quase-branco com matiz que não é azul (#F0FDF4 verdinho, #FFFBEB creme): só um toque dele
        var azul = k.h >= 190 && k.h <= 250;
        if (k.ch > 0.015 && !azul) {
          var v = hsl2rgb(k.h, 0.75, 0.5), t = Math.min(k.ch * 2.2, 0.13);
          base.r += (v[0] - base.r) * t; base.g += (v[1] - base.g) * t; base.b += (v[2] - base.b) * t;
        }
        return base;
      }
      return tom(k.h, clamp(0.1 + k.ch * 0.8, 0.14, 0.26), c.a);   // pastel → véu do mesmo matiz sobre o navy
    }
    if (k.l < 0.3 && c.a < 0.4) return BRANCO(Math.min(c.a * 1.2, 0.16));   // sombreado escuro sobre claro → brilho sobre escuro
    return c;
  }
  function mapText(c) {
    if (!c || c.a === 0) return c;
    var k = info(c);
    if (k.l >= 0.62) return c;
    if (k.ch < 0.25 || k.l < 0.25) {                              // tinta (navy, cinza, preto) → quase branco
      var neutro = k.ch < 0.02;
      return hsl(neutro ? NAVY_H : k.h, neutro ? 0.16 : Math.min(k.s, 0.3), Math.max(0.66, 0.93 - k.l * 0.5), c.a);
    }
    return hsl(k.h, Math.min(k.s, 0.65), clamp(0.62 + (k.l - 0.3) * 0.4, 0.62, 0.78), c.a);   // cor viva → a mesma, mais clara
  }
  function mapBorder(c) {
    if (!c || c.a === 0) return c;
    var k = info(c);
    if (k.l >= 0.75) {
      if (c.a <= 0.35 && k.l >= 0.95) return c;                   // fio branco translúcido (sobre o navy)
      if (k.ch < 0.08) return hsl(NAVY_H, 0.28, clamp(0.27 + (0.95 - k.l) * 0.6, 0.25, 0.36), c.a);
      return tom(k.h, clamp(0.25 + k.ch * 0.5, 0.3, 0.5), c.a);
    }
    // fio de cor viva e clara (amarelo de aviso, azul de foco): vira o tom, sem acender
    if (k.l >= 0.6 && k.ch >= 0.3 && c.a > 0.35) return tom(k.h, clamp(0.3 + k.ch * 0.4, 0.4, 0.62), c.a);
    if (k.l < 0.3 && c.a < 0.4) return BRANCO(Math.min(c.a * 1.4, 0.16));
    return c;
  }
  function mapSvg(c) {
    if (!c || c.a === 0) return c;
    var k = info(c);
    if (k.l < 0.5 && (k.ch < 0.25 || k.l < 0.25)) return mapText(c);
    if (k.l >= 0.85) return mapBg(c);
    return c;
  }
  function mapShadow(c) {
    if (!c || c.a === 0) return c;
    var k = info(c);
    if (k.l >= 0.8) return c.a >= 0.9 ? mapBg(c) : BRANCO(Math.round(c.a * 0.12 * 1000) / 1000);   // anel branco = cor do cartão; brilho some
    if (k.l < 0.3 && k.ch < 0.3) return { r: 0, g: 0, b: 0, a: Math.min(c.a * 1.6, 0.6) };            // sombra navy → preta, mais funda
    return c;
  }
  // gráficos: o branco que separa fatias/pontos vira o cartão; trilho cinza-claro
  // escurece; série pastel (a "secundária" do desenho claro) vira o tom médio do
  // mesmo matiz — branca no navy ela ofuscava e destoava da legenda HTML
  function mapArco(c) { if (!c) return c; var k = info(c); return (k.l >= 0.9 && k.ch < 0.06) ? { r: CARD.r, g: CARD.g, b: CARD.b, a: c.a } : c; }
  function mapDado(c) {
    if (!c) return c;
    var k = info(c);
    if (k.l >= 0.85 && k.ch < 0.08) return mapBorder(c);
    if (k.l >= 0.78 && k.ch >= 0.08) return tom(k.h, 0.42, c.a);
    return c;
  }
  var MAP = { bg: mapBg, text: mapText, border: mapBorder, svg: mapSvg, shadow: mapShadow, arco: mapArco, dado: mapDado };

  function trocaCores(str, papel) {
    var f = MAP[papel];
    return str.replace(COR_RX, function (m) { var c = parse(m); if (!c) return m; var n = f(c); return n === c ? m : fmt(n); });
  }
  // troca cada var(--x[, fallback]) — com parênteses balanceados — pelo que fn devolver (null = mantém)
  function trocaVars(str, fn) {
    var out = '', i = 0, k;
    while ((k = str.indexOf('var(', i)) >= 0) {
      out += str.slice(i, k);
      var j = k + 4, prof = 1;
      while (j < str.length && prof) { var ch = str.charAt(j); if (ch === '(') prof++; else if (ch === ')') prof--; j++; }
      var dentro = str.slice(k + 4, prof ? j : j - 1), cv = dentro.indexOf(',');
      var nome = (cv >= 0 ? dentro.slice(0, cv) : dentro).trim();
      var rep = fn(nome, cv >= 0 ? dentro.slice(cv + 1) : null, str.slice(k, j));
      out += rep == null ? str.slice(k, j) : rep;
      i = j;
    }
    return out + str.slice(i);
  }
  function absUrl(u, base) {
    if (!base) return u;
    var m = u.match(/^url\(\s*(["']?)(.*?)\1\s*\)$/i);
    if (!m || !m[2] || /^(data:|blob:|[a-z][a-z0-9+.-]*:|\/|#)/i.test(m[2])) return u;
    try { return 'url("' + new URL(m[2], base).href + '")'; } catch (e) { return u; }
  }

  // ------------------------------------------------------------------
  // TOKENS (--x) — quem define, onde é usado, e a decisão por token
  // ------------------------------------------------------------------
  var TOK = {};
  function tok(n) { return TOK[n] || (TOK[n] = { defs: [], selsClaro: [], tema: false, papeis: {}, aliases: {}, dec: null }); }
  function papelPeloNome(n) {
    if (/shadow/.test(n)) return 'shadow';
    if (/(^|-)(ink|text|txt|body|muted|mut)\d*(-|$)/.test(n)) return 'text';
    if (/(line|border|bd)/.test(n)) return 'border';
    if (/(page|surface|bg|card|input|zebra|headbg|soft|elev|head)/.test(n)) return 'bg';
    return null;
  }
  function nomesVar(v, f) { var rx = /var\(\s*(--[\w-]+)/g, m; while ((m = rx.exec(v))) f(m[1]); }
  // valor CLARO de um token, já sem var() — null quando é ambíguo
  function claroDe(nome, prof) {
    prof = prof || 0;
    if (prof > 6) return null;
    var t = TOK[nome], v = null;
    if (t && t.defs.length) {
      if (!t.unico) return null;
      v = t.defs[t.defs.length - 1];
    } else if (t && t.tema) {
      return null;
    } else {
      try { v = getComputedStyle(D.body).getPropertyValue(nome).trim(); } catch (e) {}
    }
    if (!v) return null;
    if (v.indexOf('var(') >= 0) v = trocaVars(v, function (n, fb) { var c = claroDe(n, prof + 1); return c != null ? c : (fb != null ? fb.trim() : ''); });
    return v;
  }
  function decideVar(nome, papel) {
    var t = TOK[nome];
    if (!t) return null;
    if (t.tema) {                                     // token do portal-tema.css: já é escuro no papel dele
      var pt = papelPeloNome(nome);
      if (!pt || pt === papel) return null;
      var c = claroDe(nome);
      return c ? trocaCores(c, papel) : null;         // usado em outro papel: converte o valor claro
    }
    if (t.dec === papel && t.defs.length) return null;   // a própria definição já foi convertida
    var c2 = claroDe(nome);
    return c2 ? trocaCores(c2, papel) : null;
  }

  // valor de uma declaração no escuro (ctx.mantem = texto sobre fundo de cor viva: fica).
  // Memória por geração: o mesmo valor aparece centenas de vezes (var(--bm3-line), #fff…)
  var MEMO = {};
  function converte(valor, papel, ctx, base) {
    if (!valor || !MAP[papel]) return valor;
    if (papel === 'text' && ctx && ctx.mantem) return valor;
    var chave = papel + '|' + (valor.indexOf('url(') >= 0 ? base + '|' : '') + valor;
    var memo = MEMO[chave];
    if (memo !== undefined) return memo;
    return (MEMO[chave] = converte0(valor, papel, base));
  }
  function converte0(valor, papel, base) {
    var urls = [], subs = [];
    var v = valor.replace(URL_RX, function (u) { urls.push(u); return '\u0001' + (urls.length - 1) + '\u0001'; });
    if (v.indexOf('var(') >= 0) {
      v = trocaVars(v, function (nome, fb, orig) {
        var r = decideVar(nome, papel);
        if (r == null) r = fb != null ? 'var(' + nome + ',' + trocaCores(fb, papel) + ')' : orig;
        subs.push(r);
        return '\u0002' + (subs.length - 1) + '\u0002';
      });
    }
    v = trocaCores(v, papel);
    if (subs.length) v = v.replace(/\u0002(\d+)\u0002/g, function (_, i) { return subs[+i]; });
    if (urls.length) v = v.replace(/\u0001(\d+)\u0001/g, function (_, i) { return absUrl(urls[+i], base); });
    return v;
  }

  // ------------------------------------------------------------------
  // DECLARAÇÕES de cor de uma regra (ou de um style="…")
  // ------------------------------------------------------------------
  var LONG = {
    'background-color': 'bg', 'background-image': 'bg',
    'color': 'text', '-webkit-text-fill-color': 'text', 'caret-color': 'text', 'text-decoration-color': 'text',
    'border-top-color': 'border', 'border-right-color': 'border', 'border-bottom-color': 'border', 'border-left-color': 'border',
    'outline-color': 'border', 'column-rule-color': 'border',
    'fill': 'svg', 'stroke': 'svg', 'stop-color': 'svg',
    'box-shadow': 'shadow', 'text-shadow': 'shadow'
  };
  // atalho com var() não abre em longhands no CSSOM (ficam vazias): pega o atalho
  var CURTAS = [
    ['background', 'bg', /^background-/],
    ['border', 'border', /^border-(top|right|bottom|left)-color$/],
    ['border-color', 'border', /^border-(top|right|bottom|left)-color$/],
    ['border-top', 'border', /^border-top-color$/], ['border-right', 'border', /^border-right-color$/],
    ['border-bottom', 'border', /^border-bottom-color$/], ['border-left', 'border', /^border-left-color$/],
    ['outline', 'border', /^outline-color$/]
  ];
  function declsDe(st) {
    var out = [], cobre = [], vistos = {};
    for (var c = 0; c < CURTAS.length; c++) {
      var v = st.getPropertyValue(CURTAS[c][0]);
      if (v && v.indexOf('var(') >= 0) {
        cobre.push(CURTAS[c][2]);
        if (vistos[v]) continue;                    // border × border-top devolvendo o mesmo texto
        vistos[v] = 1;
        out.push({ p: CURTAS[c][0], v: v, imp: st.getPropertyPriority(CURTAS[c][0]), papel: CURTAS[c][1] });
      }
    }
    var defs = null;
    for (var i = 0; i < st.length; i++) {
      var p = st[i];
      if (p.charCodeAt(0) === 45 && p.charCodeAt(1) === 45) {
        (defs || (defs = [])).push({ p: p, v: st.getPropertyValue(p).trim(), imp: st.getPropertyPriority(p) });
        continue;
      }
      var papel = LONG[p];
      if (!papel) continue;
      var coberto = false;
      for (var j = 0; j < cobre.length; j++) if (cobre[j].test(p)) { coberto = true; break; }
      if (coberto) continue;
      var v2 = st.getPropertyValue(p);
      if (!v2) continue;
      out.push({ p: p, v: v2, imp: st.getPropertyPriority(p), papel: papel });
    }
    // texto com degradê (background-clip: text): o fundo é a TINTA
    if (out.length && /text/.test(st.getPropertyValue('-webkit-background-clip') + st.getPropertyValue('background-clip'))) {
      out.forEach(function (d) { if (d.papel === 'bg') d.papel = 'text'; });
    }
    return { decls: out, defs: defs };
  }
  function primeiraCor(valor) {
    var v = valor.indexOf('var(') >= 0 ? trocaVars(valor, function (n) { var c = claroDe(n); return c == null ? '' : c; }) : valor;
    v = v.replace(URL_RX, '');
    COR_RX.lastIndex = 0;
    var m = COR_RX.exec(v);
    COR_RX.lastIndex = 0;
    return m ? parse(m[0]) : null;
  }
  // a regra pinta um fundo de cor viva/média que FICA (botão azul, selo âmbar):
  // o texto dela é o do desenho original, não se mexe
  function mantemTexto(decls) {
    for (var i = 0; i < decls.length; i++) {
      var d = decls[i];
      if (d.papel !== 'bg') continue;
      var c = primeiraCor(d.v);
      if (c && c.a >= 0.6 && mapBg(c) === c && info(c).l >= 0.3) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------
  // 1. GERADOR — a folha escura das regras de todas as páginas
  // ------------------------------------------------------------------
  function partesSel(sel) {
    var out = [], prof = 0, q = '', ini = 0;
    for (var i = 0; i < sel.length; i++) {
      var c = sel.charAt(i);
      if (c === '\\') { i++; continue; }
      if (q) { if (c === q) q = ''; continue; }
      if (c === '"' || c === "'") q = c;
      else if (c === '(' || c === '[') prof++;
      else if (c === ')' || c === ']') prof--;
      else if (c === ',' && !prof) { out.push(sel.slice(ini, i)); ini = i + 1; }
    }
    out.push(sel.slice(ini));
    return out;
  }
  function prefixa(sel) {
    return partesSel(sel).map(function (p) {
      p = p.trim();
      var m = p.match(/^(html|:root)(?![\w-])/i);
      return m ? m[1] + PRE_RAIZ + p.slice(m[1].length) : PRE + ' ' + p;
    }).join(',');
  }
  function ehPrint(mt) { return /print/i.test(mt) && !/screen|all/i.test(mt); }

  var gerado = null, stats = { regras: 0, ms: 0, vezes: 0, obsN: 0, obsMs: 0 };
  function coleta() {
    TOK = {};
    var lista = [];
    function anda(regras, cond, base, tema) {
      for (var i = 0; i < regras.length; i++) {
        var r = regras[i];
        if (r.type === 1) {                                   // CSSStyleRule
          var sel = r.selectorText;
          if (!sel || sel.indexOf('&') >= 0) continue;
          var dd = declsDe(r.style);
          if (dd.defs) dd.defs.forEach(function (d) {
            var t = tok(d.p);
            if (tema) { if (/data-tema/.test(sel)) t.tema = true; return; }
            if (ILHA_RX.test(sel)) return;
            t.defs.push(d.v); t.selsClaro.push(sel);
            nomesVar(d.v, function (n) { tok(n).aliases[d.p] = 1; });
          });
          if (tema || ILHA_RX.test(sel)) continue;
          dd.decls.forEach(function (d) { nomesVar(d.v, function (n) { tok(n).papeis[d.papel] = 1; }); });
          if (dd.decls.length || dd.defs) lista.push({ sel: sel, cond: cond, base: base, decls: dd.decls, defs: dd.defs });
        } else if (r.type === 4) {                            // @media
          var mt = r.media.mediaText;
          if (!ehPrint(mt)) anda(r.cssRules, cond.concat('@media ' + mt), base, tema);
        } else if (r.type === 12) {                           // @supports
          anda(r.cssRules, cond.concat('@supports ' + r.conditionText), base, tema);
        } else if (r.type === 3) {                            // @import
          try { if (r.styleSheet && !ehPrint(r.media.mediaText)) anda(r.styleSheet.cssRules, r.media.mediaText ? cond.concat('@media ' + r.media.mediaText) : cond, r.styleSheet.href || base, tema); } catch (e) {}
        } else if (W.CSSContainerRule && r instanceof W.CSSContainerRule) {
          anda(r.cssRules, cond.concat('@container ' + r.conditionText), base, tema);
        } else if (W.CSSLayerBlockRule && r instanceof W.CSSLayerBlockRule) {
          anda(r.cssRules, cond.concat('@layer ' + r.name), base, tema);
        }
      }
    }
    for (var i = 0; i < D.styleSheets.length; i++) {
      var sh = D.styleSheets[i], dono = sh.ownerNode;
      if (!dono || dono === gerado || sh.disabled) continue;
      var href = sh.href || '';
      var tema = /portal-tema\.css/.test(href);
      // a <style> da tela de login (auth.js) fica clara
      if (!tema && dono.tagName === 'STYLE' && (dono.textContent || '').indexOf('#portal-auth-screen') >= 0) continue;
      var mt = sh.media && sh.media.mediaText;
      if (mt && ehPrint(mt)) continue;
      var regras;
      try { regras = sh.cssRules; } catch (e) { continue; }   // folha de outra origem (Google Fonts…)
      if (!regras) continue;
      anda(regras, mt && mt !== 'all' ? ['@media ' + mt] : [], href || location.href, tema);
    }
    // decisão por token: só um papel → a definição é convertida; misturado → converte no uso
    function papeisDe(n, vistos) {
      var t = TOK[n]; if (!t || vistos[n]) return [];
      vistos[n] = 1;
      var s = Object.keys(t.papeis);
      Object.keys(t.aliases).forEach(function (a) { s = s.concat(papeisDe(a, vistos)); });
      return s;
    }
    Object.keys(TOK).forEach(function (n) {
      var t = TOK[n];
      var dist = {}; t.defs.forEach(function (v) { dist[v] = 1; });
      t.unico = Object.keys(dist).length <= 1 || t.selsClaro.every(function (s) { return /^\s*(:root|html|body)\b/i.test(s); });
      if (t.tema) { t.dec = 'tema'; return; }
      var ps = {}; papeisDe(n, {}).forEach(function (p) { ps[p] = 1; });
      ps = Object.keys(ps);
      t.dec = ps.length === 1 ? ps[0] : (ps.length ? 'misto' : null);
    });
    return lista;
  }
  function emite(lista) {
    var css = [], abertas = [];
    function abre(cond) {
      var k = 0;
      while (k < abertas.length && k < cond.length && abertas[k] === cond[k]) k++;
      while (abertas.length > k) { css.push('}'); abertas.pop(); }
      for (; k < cond.length; k++) { css.push(cond[k] + '{'); abertas.push(cond[k]); }
    }
    var n = 0;
    lista.forEach(function (e) {
      var linhas = [];
      if (e.defs) e.defs.forEach(function (d) {
        var t = TOK[d.p];
        if (!t || !t.dec || t.dec === 'misto' || t.dec === 'tema' || !t.defs.length) return;
        linhas.push(d.p + ':' + converte(d.v, t.dec, null, e.base) + (d.imp ? ' !important' : ''));
      });
      var ctx = { mantem: mantemTexto(e.decls) };
      e.decls.forEach(function (d) {
        linhas.push(d.p + ':' + converte(d.v, d.papel, ctx, e.base) + (d.imp ? ' !important' : ''));
      });
      if (!linhas.length) return;
      abre(e.cond);
      css.push(prefixa(e.sel) + '{' + linhas.join(';') + '}');
      n++;
    });
    abre([]);
    stats.regras = n;
    return css.join('\n');
  }
  // impressão digital das folhas: <style> sem regra nova (véu do nav-sidebar
  // que entra e sai, folha vazia) não pede outra geração
  function digital() {
    var s = [];
    for (var i = 0; i < D.styleSheets.length; i++) {
      var sh = D.styleSheets[i];
      if (!sh.ownerNode || sh.ownerNode === gerado) continue;
      var n = -1; try { n = sh.cssRules ? sh.cssRules.length : -1; } catch (e) {}
      var dono = sh.ownerNode;
      s.push((sh.href || 'i') + ':' + n + (sh.disabled ? 'd' : '') + (dono.tagName === 'STYLE' ? ':' + (dono.textContent || '').length : ''));
    }
    return s.join('|');
  }
  var gerando = false, ultimaDigital = '';
  function gera(forca) {
    if (gerando) return;
    var dg = digital();
    if (!forca && dg === ultimaDigital && gerado && gerado.parentNode) return;
    gerando = true;
    try {
      var t0 = (W.performance && performance.now) ? performance.now() : Date.now();
      MEMO = {};
      var css = emite(coleta());
      ultimaDigital = dg;
      if (!gerado) {
        gerado = D.createElement('style');
        gerado.id = 'bm-tema-gerado';
        gerado.media = 'screen';
      }
      if (gerado.textContent !== css) gerado.textContent = css;
      // por ÚLTIMO no documento (depois do <body>): vence as <style> que as
      // páginas põem no corpo e as que o JS injeta depois
      if (gerado.parentNode !== H || H.lastElementChild !== gerado) H.appendChild(gerado);
      var t1 = (W.performance && performance.now) ? performance.now() : Date.now();
      stats.ms = Math.round(t1 - t0); stats.vezes++;
    } catch (e) {
      if (W.console) console.warn('[tema] gerador', e);
    } finally {
      gerando = false;
    }
  }
  // <style> nova no meio da carga (auth.js, nav-sidebar.js, módulos): junta
  // as do mesmo quadro numa regeração só, antes da pintura seguinte
  var pendente = false;
  function agendaGera() {
    if (pendente) return;
    pendente = true;
    var f = function () { pendente = false; if (atual() === ESCURO) { gera(); if (D.body) trataArvore(D.body); } };
    if (W.requestAnimationFrame) requestAnimationFrame(safe(f)); else setTimeout(safe(f), 0);
  }
  function tiraGerado() { if (gerado && gerado.parentNode) gerado.parentNode.removeChild(gerado); }

  // ------------------------------------------------------------------
  // 2. INLINE — style="…" e fill/stroke de SVG
  // ------------------------------------------------------------------
  var SVG_ATTR = ['fill', 'stroke', 'stop-color'];
  var ALVO_INLINE = '[style], svg [fill], svg [stroke], svg [stop-color]';
  function trataEl(el) {
    if (!el || el.nodeType !== 1 || el === gerado) return;
    var attr = el.getAttribute('style');
    var ehSvg = el.namespaceURI === 'http://www.w3.org/2000/svg';
    if (!ehSvg && attr === el.__bmtS) return;                 // nada mudou desde a última passada (ou fomos nós)
    if (!attr && !ehSvg) return;
    if (el.closest && el.closest(ILHA)) return;
    var st = el.style, o = el.__bmtO || {}, mexeu = false;
    if (st && attr) {
      var dd = declsDe(st), ctx = { mantem: mantemTexto(dd.decls) };
      dd.decls.forEach(function (d) {
        var reg = o[d.p];
        if (reg && reg.m === d.v) return;                     // valor que nós mesmos pusemos
        var nv = converte(d.v, d.papel, ctx, null);
        if (nv !== d.v) {
          st.setProperty(d.p, nv, d.imp);
          o[d.p] = { v: d.v, m: st.getPropertyValue(d.p), imp: d.imp };
          mexeu = true;
        } else if (reg) delete o[d.p];
      });
      if (dd.defs) dd.defs.forEach(function (d) {
        var t = TOK[d.p], reg = o[d.p];
        if (!t || !t.dec || t.dec === 'misto' || t.dec === 'tema') return;
        if (reg && reg.m === d.v) return;
        var nv = converte(d.v, t.dec, null, null);
        if (nv !== d.v) { st.setProperty(d.p, nv, d.imp); o[d.p] = { v: d.v, m: st.getPropertyValue(d.p).trim(), imp: d.imp }; mexeu = true; }
      });
    }
    if (ehSvg) {
      SVG_ATTR.forEach(function (a) {
        var v = el.getAttribute(a);
        var reg = o[a];
        if (!v) { if (reg && reg.attr) { st.removeProperty(a); delete o[a]; } return; }
        if (!reg && st.getPropertyValue(a)) return;            // o style já decide essa cor
        if (reg && !reg.attr) return;
        var nv = converte(v, 'svg', null, null);
        if (nv !== v) {
          if (!reg || reg.m !== nv) { st.setProperty(a, nv); o[a] = { v: '', m: st.getPropertyValue(a), attr: true }; }
          mexeu = true;
        } else if (reg) { st.removeProperty(a); delete o[a]; }
      });
    }
    if (mexeu || el.__bmtO) el.__bmtO = o;
    el.__bmtS = el.getAttribute('style');
  }
  function trataArvore(raiz) {
    if (!raiz || raiz.nodeType !== 1) return;
    trataEl(raiz);
    var els = raiz.querySelectorAll(ALVO_INLINE);
    for (var i = 0; i < els.length; i++) trataEl(els[i]);
  }
  function desfazInline() {
    var els = D.querySelectorAll('[style]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], o = el.__bmtO;
      el.__bmtS = undefined;
      if (!o) continue;
      for (var p in o) {
        var r = o[p], cur = el.style.getPropertyValue(p);
        if (p.indexOf('--') === 0) cur = cur.trim();
        if (cur !== r.m) continue;                             // o JS da página trocou depois: é dele
        if (r.v) el.style.setProperty(p, r.v, r.imp); else el.style.removeProperty(p);
      }
      el.__bmtO = null;
    }
  }

  var obs = null;
  function aoMudar(recs) {
    if (atual() !== ESCURO) return;
    var t0 = (W.performance && performance.now) ? performance.now() : 0;
    try { aoMudar0(recs); } finally { stats.obsN++; if (t0) stats.obsMs += performance.now() - t0; }
  }
  function aoMudar0(recs) {
    var regen = false, alvos = [], soEl = [];
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      if (r.type === 'childList') {
        if (r.target && r.target.tagName === 'STYLE') regen = true;
        for (var j = 0; j < r.addedNodes.length; j++) {
          var n = r.addedNodes[j];
          if (n.nodeType !== 1 || n === gerado) continue;
          if (n.tagName === 'STYLE') { regen = true; continue; }
          if (n.tagName === 'LINK') {
            if (/stylesheet/i.test(n.rel || '')) n.addEventListener('load', agendaGera, { once: true });
            continue;
          }
          if (n.querySelector && n.querySelector('style')) regen = true;
          alvos.push(n);
        }
      } else if (r.type === 'attributes') soEl.push(r.target);
    }
    if (regen) agendaGera();
    for (var a = 0; a < alvos.length; a++) if (alvos[a].isConnected !== false) trataArvore(alvos[a]);
    for (var b = 0; b < soEl.length; b++) trataEl(soEl[b]);
  }
  function observa(liga) {
    if (!W.MutationObserver) return;
    if (!liga) { if (obs) { obs.disconnect(); obs = null; } return; }
    if (obs) return;
    obs = new MutationObserver(safe(aoMudar));
    var cfg = { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'fill', 'stroke', 'stop-color'] };
    if (D.head) obs.observe(D.head, { childList: true, subtree: true });
    if (D.body) obs.observe(D.body, cfg);
  }

  // ------------------------------------------------------------------
  // 3. GRÁFICOS (Chart.js)
  // ------------------------------------------------------------------
  var defOrig = null;
  function temaDefaults(escuro) {
    var C = W.Chart; if (!C || !C.defaults) return;
    var d = C.defaults, arc = d.elements && d.elements.arc;
    if (escuro) {
      if (!defOrig) defOrig = { color: d.color, borderColor: d.borderColor, arc: arc && arc.borderColor, escuro: null };
      // o motion.js reescreve d.color no setup dele: confere a cada atualização
      if (typeof d.color === 'string' && d.color !== defOrig.escuro) {
        defOrig.color = d.color;
        defOrig.escuro = converte(d.color, 'text');
        d.color = defOrig.escuro;
      }
      d.borderColor = 'rgba(255, 255, 255, 0.08)';
      if (arc) arc.borderColor = fmt(CARD);
    } else if (defOrig) {
      d.color = defOrig.color; d.borderColor = defOrig.borderColor;
      if (arc) arc.borderColor = defOrig.arc;
      defOrig = null;
    }
  }
  // cada (objeto, chave) convertido guarda o valor que NÓS pusemos: a página
  // que troca os datasets a cada filtro (chart.data = {...}) é convertida de
  // novo na atualização seguinte; a que não mexeu não é convertida duas vezes
  var MARCA = W.WeakMap ? new WeakMap() : null;
  function temaChart(chart, escuro) {
    var cfg = chart && chart.config, o = cfg && cfg.options;
    if (!o || !MARCA) return;
    if (!escuro) {
      if (chart.$bmt) {
        for (var i = chart.$bmt.length - 1; i >= 0; i--) {
          var r = chart.$bmt[i];
          if (r[0][r[1]] === r[3]) r[0][r[1]] = r[2];
          MARCA.delete(r[0]);
        }
      }
      chart.$bmt = null;
      return;
    }
    var log = chart.$bmt || (chart.$bmt = []);
    function tro(obj, key, papel) {
      if (!obj || typeof obj !== 'object') return;
      var v = obj[key], m = MARCA.get(obj);
      if (m && m.hasOwnProperty(key) && m[key] === v) return;      // já é o nosso valor
      if (!m) { m = {}; MARCA.set(obj, m); }
      var n = v;
      if (typeof v === 'string') n = converte(v, papel);
      else if (Array.isArray(v)) {
        var mud = false, arr = v.map(function (x) { if (typeof x !== 'string') return x; var y = converte(x, papel); if (y !== x) mud = true; return y; });
        if (mud) n = arr;
      }
      if (n !== v) { log.push([obj, key, v, n]); obj[key] = n; }
      m[key] = n;
    }
    var sc = o.scales || {};
    Object.keys(sc).forEach(function (k) {
      var s = sc[k] || {};
      tro(s.ticks, 'color', 'text'); tro(s.title, 'color', 'text'); tro(s.pointLabels, 'color', 'text');
      tro(s.grid, 'color', 'border'); tro(s.grid, 'borderColor', 'border'); tro(s.border, 'color', 'border'); tro(s.angleLines, 'color', 'border');
    });
    var pl = o.plugins || {};
    if (pl.legend) tro(pl.legend.labels, 'color', 'text');
    tro(pl.title, 'color', 'text'); tro(pl.subtitle, 'color', 'text'); tro(pl.datalabels, 'color', 'text');
    var tipo = cfg.type;
    ((cfg.data && cfg.data.datasets) || []).forEach(function (ds) {
      if (!ds) return;
      var t = ds.type || tipo;
      if (t === 'doughnut' || t === 'pie' || t === 'polarArea') tro(ds, 'borderColor', 'arco');
      tro(ds, 'pointBackgroundColor', 'arco'); tro(ds, 'pointBorderColor', 'arco');
      // na linha, backgroundColor é o miolo do ponto (#fff) ou a área translúcida
      tro(ds, 'backgroundColor', t === 'line' || t === 'radar' ? 'arco' : 'dado');
      if (t !== 'line' && t !== 'radar' && t !== 'doughnut' && t !== 'pie' && t !== 'polarArea') tro(ds, 'borderColor', 'dado');
      if (ds.datalabels) tro(ds.datalabels, 'color', 'text');
    });
  }
  function chartsAgora(forcaClaro) {
    var C = W.Chart; if (!C || !C.instances) return;
    var e = !forcaClaro && atual() === ESCURO;
    temaDefaults(e);
    Object.keys(C.instances).forEach(function (k) {
      var ch = C.instances[k];
      try { temaChart(ch, e); ch.update('none'); } catch (x) {}
    });
  }
  function setupCharts() {
    var C = W.Chart;
    if (!C || !C.register || !C.defaults) return false;
    if (C.__bmTema) return true;
    C.__bmTema = true;
    C.register({
      id: 'bmTema',
      beforeUpdate: function (chart) { try { var e = atual() === ESCURO && !imprimindo; temaDefaults(e); temaChart(chart, e); } catch (x) {} }
    });
    if (atual() === ESCURO) chartsAgora();
    return true;
  }

  // ------------------------------------------------------------------
  // SELETOR (menu do avatar via portal-motion.js; aba Perfil do celular)
  // ------------------------------------------------------------------
  var IC = {
    tema: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
    sol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
    lua: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
  };
  function seletorHtml(extra) {
    var t = atual();
    return '<div class="bmt-row' + (extra ? ' ' + extra : '') + '" role="group" aria-label="Tema da tela">' +
      '<span>' + IC.tema + 'Tema</span><div class="bmt-seg">' +
      '<button type="button" data-bmt="claro" aria-pressed="' + (t === CLARO) + '">' + IC.sol + 'Claro</button>' +
      '<button type="button" data-bmt="escuro" aria-pressed="' + (t === ESCURO) + '">' + IC.lua + 'Escuro</button>' +
      '</div></div>';
  }
  function sincronizaBotoes() {
    var t = atual(), bs = D.querySelectorAll('[data-bmt]');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', String(bs[i].getAttribute('data-bmt') === t));
  }
  function montaSheet() {
    var sh = D.querySelector('.bmp-sheet');
    if (!sh) return false;
    if (sh.querySelector('.bmt-row')) return true;
    var tmp = D.createElement('div');
    tmp.innerHTML = seletorHtml('bmt-row--sheet');
    sh.insertBefore(tmp.firstChild, sh.querySelector('.bmp-logout'));
    return true;
  }

  // ------------------------------------------------------------------
  // LIGA / DESLIGA
  // ------------------------------------------------------------------
  var meta = null, metaOrig = null, imprimindo = false;
  function corMeta(escuro) {
    meta = meta || D.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    if (metaOrig == null) metaOrig = meta.getAttribute('content') || '';
    meta.setAttribute('content', escuro ? COR_META : metaOrig);
  }
  function pronto() { H.classList.add('bmt-ok'); }
  function liga() {
    gera();
    if (D.body) trataArvore(D.body);
    observa(true);
    pronto();
    chartsAgora();
    corMeta(true);
  }
  function desliga() {
    observa(false);
    tiraGerado();
    desfazInline();
    chartsAgora();
    corMeta(false);
  }
  function aplica(v) {
    if (v === atual()) { sincronizaBotoes(); return; }
    if (v === ESCURO) { H.setAttribute('data-tema', ESCURO); liga(); }
    else { H.removeAttribute('data-tema'); desliga(); }
    sincronizaBotoes();
    try { D.dispatchEvent(new CustomEvent('bmtema:mudou', { detail: { tema: v } })); } catch (e) {}
  }
  function reduzido() {
    return (W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches) || H.classList.contains('bm3-reduce');
  }
  function set(v) {
    v = v === ESCURO ? ESCURO : CLARO;
    try { localStorage.setItem(KEY, v); } catch (e) {}
    if (v === atual()) { sincronizaBotoes(); return; }
    var run = safe(function () { aplica(v); });
    if (D.startViewTransition && !reduzido()) { try { D.startViewTransition(run); return; } catch (e) {} }
    run();
  }

  W.BMTema = {
    get: atual,
    set: set,
    alterna: function () { set(atual() === ESCURO ? CLARO : ESCURO); },
    seletorHtml: seletorHtml,
    regenera: function () { if (atual() === ESCURO) { gera(true); trataArvore(D.body); } },
    converte: converte,
    stats: function () {
      return { regras: stats.regras, ms: stats.ms, vezes: stats.vezes, bytes: gerado ? gerado.textContent.length : 0,
        obsN: stats.obsN, obsMs: Math.round(stats.obsMs) };
    }
  };

  // ------------------------------------------------------------------
  // BOOT — roda logo (defer: o corpo já está todo lido), sem esperar o
  // DOMContentLoaded: quanto antes a folha escura existir, menos pisca.
  // ------------------------------------------------------------------
  function boot() {
    // página sem a linha do <head>: marca agora
    if (salvo() === ESCURO && atual() !== ESCURO) H.setAttribute('data-tema', ESCURO);
    // o conteúdo só aparece com .bmt-ok (portal-tema.css): sai mesmo se a geração falhar
    try { if (atual() === ESCURO) liga(); } catch (e) { if (W.console) console.warn('[tema]', e); } finally { pronto(); }

    D.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('[data-bmt]');
      if (!b) return;
      e.preventDefault();
      set(b.getAttribute('data-bmt'));
    });
    W.addEventListener('storage', safe(function (e) { if (e.key === KEY) aplica(salvo()); }));
    W.addEventListener('beforeprint', safe(function () {
      if (atual() !== ESCURO) return;
      imprimindo = true; observa(false); desfazInline(); chartsAgora(true);
    }));
    W.addEventListener('afterprint', safe(function () {
      if (!imprimindo) return;
      imprimindo = false;
      if (atual() === ESCURO) { trataArvore(D.body); observa(true); chartsAgora(); }
    }));

    // Chart.js e a aba Perfil chegam depois (CDN / nav-sidebar.js): tenta por um tempo
    var n = 0, iv = setInterval(safe(function () {
      var okC = setupCharts(), okS = montaSheet();
      if ((okC && okS) || ++n > 60) clearInterval(iv);
    }), 400);
    W.addEventListener('load', safe(function () {
      setupCharts(); montaSheet();
      // folhas <link> que terminaram de carregar depois do boot
      if (atual() === ESCURO) { gera(); trataArvore(D.body); }
    }));
  }
  safe(boot)();
})();
