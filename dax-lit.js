/* ================================================================
   dax-lit.js — literal e predicado DAX com o TIPO certo da coluna
   ----------------------------------------------------------------
   Por que existe: as matrizes analíticas do portal (Análise de Vendas,
   Funil, Cotações, Licitações, Novos Negócios, Custos SG&A…) descem o
   grão remontando o caminho do drill-down como filtro DAX. Até aqui esse
   filtro saía SEMPRE entre aspas:

       'Calendário'[Mês/Ano] IN { "202609" }

   Se a coluna do modelo é NÚMERO (Mês/Ano, Ano, Cód. Cliente, Cód.
   Produto, Nº da fatura…) o Power BI recusa a consulta inteira:
   «DAX comparison operations do not support comparing values of type
   Text with values of type Integer». O erro é engolido pelo try/catch do
   drill e o nível some da tela como "sem dados" — o grão parece não
   descer, quando na verdade a consulta nem rodou. O mesmo vale para
   coluna de DATA (o valor volta "2026-09-15T00:00:00") e para o valor
   EM BRANCO, que virava a string vazia "".

   Aqui o literal é montado pelo tipo que o PRÓPRIO Power BI devolveu no
   JSON da consulta (número vira número, data vira DATE(), branco vira
   ISBLANK), então o filtro fecha com a coluna seja ela qual for.

   Como usar numa página:
       <script src="../dax-lit.js?v=1"></script>
       ...
       const pf = path.map(p => DaxLit.igual(p.col, p.value));     // drill
       const fl = DaxLit.em(col, [...selecionados], tipoOpcional); // slicer
       const tr = DaxLit.treatas(ref, vals, tipoOpcional);         // TREATAS

   `tipo` é opcional: só entregue quando a página souber de antemão
   ('number' | 'string' | 'date' | 'boolean'); sem ele o tipo sai do
   próprio valor, que é o caminho normal no drill-down.
   ================================================================ */
(function (global) {
  'use strict';

  // forma que o Power BI usa p/ coluna Data/DataHora no JSON da consulta
  var RX_DATAHORA = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/;
  var RX_DATA     = /^(\d{4})-(\d{2})-(\d{2})$/;

  function esc(v) { return String(v == null ? '' : v).replace(/"/g, '""'); }

  // tipo do valor como ele voltou da consulta (ou o que a página declarou)
  function tipoDe(v, tipo) {
    // branco vem antes do tipo declarado: coluna de data sem valor é BLANK,
    // não uma data vazia
    if (v === null || v === undefined) return 'blank';
    // "" numa coluna que NÃO é texto é vazio, não o número zero
    if (tipo) return (v === '' && tipo !== 'string') ? 'blank' : tipo;
    var t = typeof v;
    if (t === 'number')  return isFinite(v) ? 'number' : 'blank';
    if (t === 'boolean') return 'boolean';
    // só a forma COMPLETA (com hora) vira data: assim uma coluna de texto
    // que por acaso guarda "2026-09-15" continua sendo comparada como texto
    if (t === 'string' && RX_DATAHORA.test(v)) return 'date';
    return 'string';
  }

  function dataLit(v) {
    var m = RX_DATAHORA.exec(String(v));
    if (m) {
      var dia = 'DATE(' + (+m[1]) + ', ' + (+m[2]) + ', ' + (+m[3]) + ')';
      var h = +m[4], mi = +m[5], s = +m[6];
      return (h || mi || s) ? dia + ' + TIME(' + h + ', ' + mi + ', ' + s + ')' : dia;
    }
    m = RX_DATA.exec(String(v));
    if (m) return 'DATE(' + (+m[1]) + ', ' + (+m[2]) + ', ' + (+m[3]) + ')';
    return '"' + esc(v) + '"';   // não é data reconhecível: trata como texto
  }

  // literal DAX de UM valor
  function lit(v, tipo) {
    switch (tipoDe(v, tipo)) {
      case 'blank':   return 'BLANK()';
      case 'number':  { var n = Number(v); return isFinite(n) ? String(n) : '"' + esc(v) + '"'; }
      case 'boolean': return (v === true || /^(true|verdadeiro|sim|1)$/i.test(String(v))) ? 'TRUE()' : 'FALSE()';
      case 'date':    return dataLit(v);
      default:        return '"' + esc(v) + '"';
    }
  }

  var ehBranco = function (v) { return v === null || v === undefined; };

  // predicado de UM valor — é o que o drill-down usa p/ fixar o nível pai
  function igual(col, v, tipo) {
    var l = lit(v, tipo);
    return (l === 'BLANK()') ? 'ISBLANK(' + col + ')' : col + ' IN { ' + l + ' }';
  }

  // predicado de LISTA — é o que os dropdowns multi-seleção usam.
  // Devolve null quando nada foi escolhido (= "Todos", sem filtro).
  function em(col, vals, tipo) {
    var v = (vals || []).slice();
    var temBranco = v.some(ehBranco);
    var cheios = v.filter(function (x) { return !ehBranco(x); });
    if (!v.length) return null;
    if (!cheios.length) return 'ISBLANK(' + col + ')';
    var dentro = col + ' IN { ' + cheios.map(function (x) { return lit(x, tipo); }).join(', ') + ' }';
    return temBranco ? '(' + dentro + ' || ISBLANK(' + col + '))' : dentro;
  }

  // mesma lista, na forma TREATAS (usada onde o filtro precisa ser TABELA)
  function treatas(ref, vals, tipo) {
    var v = (vals || []);
    if (!v.length) return null;
    return 'TREATAS({ ' + v.map(function (x) { return lit(x, tipo); }).join(', ') + ' }, ' + ref + ')';
  }

  var API = { lit: lit, igual: igual, em: em, treatas: treatas, tipoDe: tipoDe, esc: esc };
  global.DaxLit = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
