// ================================================================
// api/shared/pedido-revisar.js
// Confere, CONTRA O TEXTO DO PDF, o que a IA devolveu em cada item —
// e conserta a troca de QUANTIDADE por VALOR UNITÁRIO.
//
// Por que não dá para confiar só na IA: o texto do PDF chega em
// colunas ("Qtd Compr. | Vl.Unit. | ... | Vl Total") e, quando o
// layout está apertado, o modelo troca as duas. A trava óbvia —
// quantidade x unitário = total — NÃO pega a inversão, porque a
// multiplicação é comutativa (10 x 720 = 720 x 10 = 7.200). O que
// PEGA é a POSIÇÃO: no papel, a coluna de quantidade vem antes da de
// valor unitário, e o pi-pdf-texto.js entrega a linha na ordem
// visual. Então:
//
//   cabeçalho diz  qtd ... unit   (nessa ordem)
//   linha do item  10,0000  720,0000  ...  7.200,00
//   IA devolveu    quantidade=720  valorUnitario=10
//   -> o número que ela chamou de quantidade está na coluna do
//      unitário: TROCA (e avisa).
//
// Só age com as duas âncoras na mão (cabeçalho + os dois números na
// mesma linha, sem ambiguidade). Em qualquer dúvida, não mexe: apenas
// devolve um aviso para a tela pedir conferência humana.
//
//   const { revisar } = require('../shared/pedido-revisar');
//   const r = revisar(dados.produtos, textoDoPdf);
//   // r.produtos (corrigidos) · r.avisos [{ item, tipo, texto }]
// ================================================================
'use strict';

// ── números no formato do documento ──────────────────────────────
// "7.200,00" -> 7200   "1,9100" -> 1.91   "720" -> 720   "7.200" -> 7200
function paraNumero(txt) {
  var s = String(txt).trim();
  if (!s) return NaN;
  if (s.indexOf(',') >= 0) {                       // tem vírgula: ela é o decimal
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {    // 7.200 / 1.234.567 = milhar
    s = s.replace(/\./g, '');
  }
  var n = Number(s);
  return isFinite(n) ? n : NaN;
}

var RE_NUM = /-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+,\d+|-?\d+(?:\.\d+)?/g;

// todos os números de uma linha, com onde cada um começa
function numerosDaLinha(linha) {
  var out = [];
  var m;
  RE_NUM.lastIndex = 0;
  while ((m = RE_NUM.exec(linha)) !== null) {
    var v = paraNumero(m[0]);
    if (!isNaN(v)) out.push({ txt: m[0], valor: v, pos: m.index });
  }
  return out;
}

// ── rótulos de coluna ────────────────────────────────────────────
// "Qtd Compr.", "Qtde", "Quant.", "Qt. Cons.", "QTD"
var RE_CAB_QTD  = /\b(?:qtd|qtde|qte|qty|quant|quantidade|qt)\b\.?/gi;
// "Vl.Unit.", "Valor Unitário", "Preço Unit.", "Vlr Unit", "Unitário"
var RE_CAB_UNIT = /\b(?:vl|vlr|v|valor|pre[çc]o|prc)\b\.?\s*unit\w*|\bunit[áa]rio\b/gi;

/* Acha, no texto todo, a linha de CABEÇALHO da tabela de itens e diz
   se a coluna de quantidade vem antes da de valor unitário.
   -> { qtdAntes: bool, colQtd, colUnit, linha } ou null */
function cabecalhoDaTabela(texto) {
  var linhas = String(texto || '').split(/\r?\n/);
  for (var i = 0; i < linhas.length; i++) {
    var L = linhas[i];
    RE_CAB_UNIT.lastIndex = 0;
    var mu = RE_CAB_UNIT.exec(L);
    if (!mu) continue;

    // o rótulo de quantidade que interessa é o ÚLTIMO antes do unitário
    // (num "Qt. Cons. ... Qtd Compr. ... Vl.Unit." é o "Qtd Compr.")
    RE_CAB_QTD.lastIndex = 0;
    var mq, ultimoAntes = null, algumDepois = null;
    while ((mq = RE_CAB_QTD.exec(L)) !== null) {
      if (mq.index < mu.index) ultimoAntes = mq.index;
      else if (algumDepois === null) algumDepois = mq.index;
    }
    if (ultimoAntes === null && algumDepois === null) continue;

    return {
      qtdAntes: ultimoAntes !== null,
      colQtd: ultimoAntes !== null ? ultimoAntes : algumDepois,
      colUnit: mu.index,
      linha: L
    };
  }
  return null;
}

// ── achar a linha do item no texto ───────────────────────────────
function normaliza(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

/* Procura a linha que corresponde ao item.

   Não basta achar o código: quando a descrição quebra em várias linhas
   (é o normal em OC de hospital), o código costuma cair numa linha SEM
   número nenhum —

     Outros Cateter Eletrodo Temporario 6FR x MSB 2 Pc 1,00 700,00 0,0 1.400,00
            110cm/125cm (Cabo eletrodo) Ref.
            VCET-6110CK1 (NEUROMEDEX)          <- o código está AQUI

   — e ancorar nela é o mesmo que não achar nada. Então a busca é por
   PONTOS: quem tem o código, as palavras da descrição e o total do item
   pontua, e só entram no páreo linhas com pelo menos dois números (a
   linha do item sempre tem quantidade e valor). */
function linhaDoItem(linhas, prod) {
  var cod = normaliza(prod.codigo);
  var palavras = normaliza(prod.descricao).split(' ')
    .filter(function (p) { return p.length >= 4; }).slice(0, 4);
  var total = Number(prod.valorTotal);

  var melhor = '', melhorPonto = 0;
  for (var i = 0; i < linhas.length; i++) {
    var linha = linhas[i];
    var nums = numerosDaLinha(linha);
    if (nums.length < 2) continue;                 // linha de texto solto

    var n = normaliza(linha);
    var ponto = 0;
    if (cod && cod.length >= 4 && n.indexOf(cod) >= 0) ponto += 3;
    for (var p = 0; p < palavras.length; p++) {
      if (n.indexOf(palavras[p]) >= 0) ponto += 1;
    }
    if (!ponto) continue;                          // nada a ver com este item
    if (isFinite(total) && total > 0 &&
        nums.some(function (x) { return mesmoNumero(x.valor, total); })) ponto += 2;
    if (nums.length >= 3) ponto += 1;              // cara de linha de tabela

    if (ponto > melhorPonto) { melhorPonto = ponto; melhor = linha; }
  }
  return melhor;
}

// quase-igualdade tolerante (o texto pode ter 2 ou 4 decimais)
function mesmoNumero(a, b) {
  if (!isFinite(a) || !isFinite(b)) return false;
  var d = Math.abs(a - b);
  return d < 0.005 || d / Math.max(Math.abs(a), Math.abs(b), 1) < 0.0005;
}

var PERTO = 25;   // colunas de tolerância para dizer "está nessa coluna"

/* Ocorrências de um valor numa linha. Quando há mais de uma, só resolve o
   empate se uma delas estiver perto da coluna esperada (do cabeçalho) —
   fora disso devolve null, e quem chamou não mexe em nada. */
function acharValor(nums, valor, colEsperada) {
  var hits = nums.filter(function (n) { return mesmoNumero(n.valor, valor); });
  if (!hits.length) return null;
  if (hits.length === 1) return hits[0];
  if (typeof colEsperada !== 'number') return null;
  var maisPerto = hits.slice().sort(function (a, b) {
    return Math.abs(a.pos - colEsperada) - Math.abs(b.pos - colEsperada);
  })[0];
  return Math.abs(maisPerto.pos - colEsperada) <= PERTO ? maisPerto : null;
}

// ================================================================
// revisar(produtos, texto) -> { produtos, avisos }
// ================================================================
function revisar(produtos, texto) {
  var lista = Array.isArray(produtos) ? produtos : [];
  var avisos = [];
  if (!lista.length) return { produtos: lista, avisos: avisos };

  var linhas = String(texto || '').split(/\r?\n/);
  var cab = cabecalhoDaTabela(texto);

  // soma dos itens como a IA os leu — serve para reconhecer o total DO
  // PEDIDO copiado por engano na linha de um item
  var somaDosItens = lista.reduce(function (t, p) {
    var a = Number(p.quantidade), b = Number(p.valorUnitario);
    return t + ((isFinite(a) ? a : 0) * (isFinite(b) ? b : 0));
  }, 0);

  var out = lista.map(function (p, idx) {
    var prod = Object.assign({}, p);
    var q = Number(prod.quantidade);
    var v = Number(prod.valorUnitario);
    var total = Number(prod.valorTotal);
    if (!isFinite(q)) q = 0;
    if (!isFinite(v)) v = 0;

    var rotulo = (prod.codigo || prod.descricao || ('item ' + (idx + 1))).toString().slice(0, 40);
    var linha = linhaDoItem(linhas, prod);
    var nums = linha ? numerosDaLinha(linha) : [];

    // ── 1. inversão de quantidade x valor unitário ───────────────
    if (cab && linha && q > 0 && v > 0 && !mesmoNumero(q, v)) {
      var alvoQtd  = cab.qtdAntes ? cab.colQtd : cab.colUnit;
      var alvoUnit = cab.qtdAntes ? cab.colUnit : cab.colQtd;
      var tQ = acharValor(nums, q, alvoQtd);
      var tV = acharValor(nums, v, alvoUnit);

      if (tQ && tV && tQ.pos !== tV.pos) {
        var qtdVemAntes = tQ.pos < tV.pos;
        if (qtdVemAntes !== cab.qtdAntes) {
          // o número que a IA chamou de quantidade está na coluna do
          // unitário (e vice-versa): troca.
          prod.quantidade = v;
          prod.valorUnitario = q;
          var tmp = q; q = v; v = tmp;
          avisos.push({
            item: idx, tipo: 'invertido', corrigido: true,
            texto: rotulo + ': quantidade e valor unitário estavam trocados no PDF — ' +
                   'corrigi para ' + prod.quantidade + ' x ' + prod.valorUnitario + '. Confira.'
          });
        }
      }
    }

    // ── 2. quantidade x unitário tem de dar o total do item ──────
    // (quando a IA copia o total DO PEDIDO na linha do item, ignora: seria
    //  um alarme falso em todo pedido de mais de um item)
    if (isFinite(total) && total > 0 && q > 0 && v > 0 && !(lista.length > 1 && mesmoNumero(total, somaDosItens))) {
      var calc = q * v;
      if (Math.abs(calc - total) > Math.max(0.05, total * 0.005)) {
        avisos.push({
          item: idx, tipo: 'total', corrigido: false,
          texto: rotulo + ': ' + q + ' x ' + v + ' = ' + calc.toFixed(2) +
                 ', mas o PDF traz total ' + total.toFixed(2) + '. Confira quantidade e valor.'
        });
      }
    }

    // ── 3. o item ficou sem um dos dois números ──────────────────
    if (q <= 0) {
      avisos.push({ item: idx, tipo: 'sem-quantidade', corrigido: false,
        texto: rotulo + ': não consegui ler a quantidade. Preencha.' });
    }
    if (v <= 0) {
      avisos.push({ item: idx, tipo: 'sem-valor', corrigido: false,
        texto: rotulo + ': não consegui ler o valor unitário. Preencha.' });
    }

    delete prod.valorTotal;      // o total é sempre recalculado na tela
    return prod;
  });

  return { produtos: out, avisos: avisos };
}

module.exports = {
  revisar: revisar,
  // expostos para os testes
  paraNumero: paraNumero,
  numerosDaLinha: numerosDaLinha,
  cabecalhoDaTabela: cabecalhoDaTabela,
  linhaDoItem: linhaDoItem
};
