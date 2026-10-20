/* ================================================================
   pi-pdf-texto.js — PDF -> TEXTO COM O LAYOUT PRESERVADO
   Fonte única do "ler o PDF" dos módulos de Pedido Inteligente
   (PI Pedido, PI Consignação, PI Cotação, Pedido Inteligente).

   POR QUE ESTE ARQUIVO EXISTE
   ---------------------------
   A versão anterior (uma cópia por página) fazia:

       tc.items.forEach(it => { ...quebra a linha pelo Y...; linha.push(it.str) })

   e juntava tudo com um espaço. Isso tem DOIS defeitos que fazem a IA
   trocar QUANTIDADE por VALOR UNITÁRIO:

   1) `tc.items` vem na ordem em que o PDF DESENHA o texto — que não é,
      nem de longe, sempre da esquerda para a direita. Em relatórios de
      ERP (SOULMV, MV, Tasy, Philips…) as células saem embaralhadas, e a
      linha do item chegava na IA como "720,0000 10,0000 7.200,00" quando
      no papel está "10,0000  720,0000  ...  7.200,00". A IA lia o
      primeiro número como quantidade — e invertia. Conserto: ORDENAR
      CADA LINHA POR X.

   2) Juntar as células com UM espaço destrói as colunas: um vão de 40pt
      (fronteira de coluna) e um de 1pt (continuação da mesma palavra)
      viravam a mesma coisa. Conserto: reconstruir a linha numa GRADE DE
      CARACTERES pela posição X, de modo que o cabeçalho ("Qtd Compr.
      Vl.Unit. ... Vl Total") fique alinhado por cima dos números. A IA
      passa a mapear coluna por coluna em vez de adivinhar.

   Também troca a quebra de linha "diferença contra o ÚLTIMO item" (que
   deriva em linhas com sub/superscrito) por agrupamento em faixas de
   baseline com tolerância vinda da altura da fonte.

   USO
   ---
     var texto = await PIPDF.texto(arrayBuffer);         // grade (default)
     var texto = await PIPDF.texto(buf, { grade: false }); // só ordenado
     PIPDF.linhasDaPagina(itens)   // testável sem pdf.js (ver .claude/pi-pdf-testes.js)

   Requer pdfjsLib (pdf.js do CDN) já carregado na página.
   ================================================================ */
(function () {
  'use strict';

  var LARGURA_MAX = 240;   // colunas de caractere por linha (evita linha gigante)
  var COLA_MAX    = 0.32;  // vão < 0,32 caractere = mesma palavra, cola sem espaço

  // mediana simples (sem ordenar o array original)
  function mediana(v) {
    if (!v.length) return 0;
    var a = v.slice().sort(function (x, y) { return x - y; });
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  // Um item do pdf.js -> { str, x, y, w, alt }. `transform` é a matriz
  // [a,b,c,d,e,f]: e = x, f = y (baseline), |d| ≈ altura da fonte.
  function normaliza(it) {
    var t = it.transform || [1, 0, 0, 1, 0, 0];
    var alt = Math.abs(Number(it.height) || Number(t[3]) || 0) || 8;
    return {
      str: String(it.str),
      x: Number(t[4]) || 0,
      y: Number(t[5]) || 0,
      w: Math.abs(Number(it.width) || 0),
      alt: alt
    };
  }

  /* Agrupa os itens em linhas visuais e devolve as linhas de texto.
     Exportada para poder ser testada em node com itens sintéticos. */
  function linhasDaPagina(itensBrutos, opts) {
    opts = opts || {};
    var grade = opts.grade !== false;

    var itens = [];
    for (var i = 0; i < itensBrutos.length; i++) {
      var it = itensBrutos[i];
      if (!it || !it.str || !String(it.str).trim()) continue;   // fora os espaços soltos
      itens.push(normaliza(it));
    }
    if (!itens.length) return [];

    // tolerância de baseline: fração da altura típica da fonte da página
    var alturaTipica = mediana(itens.map(function (o) { return o.alt; })) || 8;
    var tol = Math.max(1.5, alturaTipica * 0.45);

    // topo -> base; empate resolvido pelo X (só para o agrupamento ficar estável)
    itens.sort(function (a, b) { return (b.y - a.y) || (a.x - b.x); });

    var linhas = [];
    var atual = null;
    for (var k = 0; k < itens.length; k++) {
      var o = itens[k];
      // compara com a BASELINE DA LINHA (a primeira que a abriu), não com o
      // item anterior: assim um "3" em superscrito não arrasta a faixa
      if (atual && Math.abs(o.y - atual.y) <= tol) {
        atual.itens.push(o);
      } else {
        atual = { y: o.y, itens: [o] };
        linhas.push(atual);
      }
    }

    // ↓ A CORREÇÃO PRINCIPAL: cada linha na ordem visual (esquerda -> direita)
    linhas.forEach(function (L) {
      L.itens.sort(function (a, b) { return a.x - b.x; });
    });

    if (!grade) {
      return linhas.map(function (L) {
        return L.itens.map(function (o) { return o.str; }).join(' ').replace(/\s+$/, '');
      });
    }

    // largura de um caractere na página (para virar coluna de texto)
    var larguras = [];
    itens.forEach(function (o) {
      var n = o.str.length;
      if (n > 1 && o.w > 0) larguras.push(o.w / n);
    });
    var charW = mediana(larguras);
    if (!(charW > 0.5)) charW = Math.max(1, alturaTipica * 0.5);

    // se a página é larga demais para a grade, comprime a escala
    var xMin = Infinity, xMax = -Infinity;
    itens.forEach(function (o) {
      if (o.x < xMin) xMin = o.x;
      if (o.x + o.w > xMax) xMax = o.x + o.w;
    });
    var colunasNecessarias = (xMax - xMin) / charW;
    if (colunasNecessarias > LARGURA_MAX) charW = (xMax - xMin) / LARGURA_MAX;

    return linhas.map(function (L) {
      var buf = '';
      var fimAnterior = null;   // x onde o item anterior terminou
      for (var j = 0; j < L.itens.length; j++) {
        var o = L.itens[j];
        var vao = fimAnterior === null ? null : (o.x - fimAnterior) / charW;

        if (vao !== null && vao < COLA_MAX) {
          buf += o.str;                       // "7.200" + ",00" -> "7.200,00"
        } else {
          var col = Math.round((o.x - xMin) / charW);
          if (col > buf.length) {
            buf += new Array(col - buf.length + 1).join(' ');
          } else if (buf.length) {
            buf += ' ';                       // colidiu: garante o separador
          }
          buf += o.str;
        }
        fimAnterior = o.x + (o.w || o.str.length * charW);
      }
      return buf.replace(/\s+$/, '');
    });
  }

  /* PDF (ArrayBuffer) -> texto. Uma linha em branco entre páginas. */
  async function texto(buf, opts) {
    var pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    var paginas = [];
    for (var i = 1; i <= pdf.numPages; i++) {
      var page = await pdf.getPage(i);
      var tc = await page.getTextContent();
      var linhas = linhasDaPagina(tc.items || [], opts);
      paginas.push(linhas.join('\n'));
    }
    return paginas.join('\n\n');
  }

  window.PIPDF = { texto: texto, linhasDaPagina: linhasDaPagina };
})();
