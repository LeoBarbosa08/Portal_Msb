/* ================================================================
   sr-regional.js — Regional do Sales Report do Comercial
   ----------------------------------------------------------------
   Regional = região do Brasil, montada pela UF ('Estados'[Cód. do
   estado]) — o mesmo filtro dos cartões "REGIONAL …" do relatório no
   Power BI (Nordeste = AL, BA, CE, MA, PB, PE, PI, RN ou SE). Cada
   medida é avaliada NA REGIONAL (não soma estados): Gap e % saem iguais
   aos do relatório.

   "Exterior / sem UF" junta o que não cai em nenhuma das 5 (exterior,
   UF em branco ou sem estado): o NOT … IN pega também a linha em branco
   da tabela de estados — assim as 5 + ela fecham com o total.

   Uma lista só para as abas que mostram regional: Visão Geral (banner e
   Performance por Regional), Performance de Vendas, Análise de Vendas e
   Análise de Pedidos.

   Como usar numa página:
       <script src="../sr-regional.js?v=1"></script>
       ...
       SRRegional.filtro('NORDESTE')            // 'Estados'[Cód. do estado] IN { "AL", … }
       SRRegional.filtroSel(['SUL', 'OUTRAS'])  // várias em OU (filtro da barra); nada = null
       SRRegional.porRegional(cols, filtros)    // EVALUATE … 1 linha por regional, coluna [Reg] = id
       SRRegional.opcoes()                      // [{ value:id, label:nome }] p/ o dropdown

   `col` (último argumento, opcional) troca a coluna de UF: a Análise de
   Pedidos usa Clientes[Cód. Estado], que é a UF que chega ao fato Pedidos.
   ================================================================ */
(function (global) {
  'use strict';

  var UF_COL = "'Estados'[Cód. do estado]";
  var REGIONAIS = [
    { id: 'NORDESTE',     nome: 'Nordeste',     ufs: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'] },
    { id: 'SUDESTE',      nome: 'Sudeste',      ufs: ['ES', 'MG', 'RJ', 'SP'] },
    { id: 'SUL',          nome: 'Sul',          ufs: ['PR', 'RS', 'SC'] },
    { id: 'CENTRO-OESTE', nome: 'Centro-Oeste', ufs: ['DF', 'GO', 'MS', 'MT'] },
    { id: 'NORTE',        nome: 'Norte',        ufs: ['AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO'] }
  ];
  var OUTRAS = { id: 'OUTRAS', nome: 'Exterior / sem UF', ufs: [] };
  var TODAS = REGIONAIS.concat(OUTRAS);
  var UFS_BR = REGIONAIS.reduce(function (a, r) { return a.concat(r.ufs); }, []);

  function lista(ufs) { return '{ ' + ufs.map(function (u) { return '"' + u + '"'; }).join(', ') + ' }'; }
  function achar(id) { return TODAS.find(function (r) { return r.id === id; }) || null; }

  // predicado DAX de UMA regional (null = id desconhecido)
  function filtro(id, col) {
    col = col || UF_COL;
    if (id === OUTRAS.id) return 'NOT(' + col + ' IN ' + lista(UFS_BR) + ')';
    var r = achar(id);
    return r ? col + ' IN ' + lista(r.ufs) : null;
  }

  // várias regionais em OU — o filtro "Regional" da barra. Com "Exterior /
  // sem UF" na seleção vira "tudo menos as UFs das regionais NÃO marcadas":
  // uma condição só sobre a coluna, que o CALCULATE aceita como filtro.
  // Nada marcado (ou tudo marcado) = null, sem filtro.
  function filtroSel(ids, col) {
    col = col || UF_COL;
    var sel = TODAS.filter(function (r) { return (ids || []).indexOf(r.id) >= 0; });
    if (!sel.length || sel.length === TODAS.length) return null;
    var temOutras = sel.indexOf(OUTRAS) >= 0;
    var ufs = (temOutras ? REGIONAIS.filter(function (r) { return sel.indexOf(r) < 0; }) : sel)
      .reduce(function (a, r) { return a.concat(r.ufs); }, []);
    return temOutras ? 'NOT(' + col + ' IN ' + lista(ufs) + ')' : col + ' IN ' + lista(ufs);
  }

  // EVALUATE com 1 linha por regional (+ OUTRAS): ROW("Reg", id, cols)
  // avaliada na UF dela. KEEPFILTERS: a UF da regional se SOMA ao que já
  // estiver filtrado na coluna (o filtro de Estado da barra, por ex.) em vez
  // de passar por cima dele.
  function porRegional(cols, filtros, col) {
    var f = (filtros || []).filter(Boolean);
    return 'EVALUATE CALCULATETABLE(UNION('
      + TODAS.map(function (r) {
        return 'CALCULATETABLE(ROW("Reg", "' + r.id + '", ' + cols + '), KEEPFILTERS(' + filtro(r.id, col) + '))';
      }).join(', ')
      + ')' + (f.length ? ', ' + f.join(', ') : '') + ')';
  }

  // id da regional numa linha devolvida por porRegional()
  function idDe(row) {
    var k = Object.keys(row || {}).find(function (x) { return /\[Reg\]$/.test(x); });
    return k ? row[k] : null;
  }

  // as 5 pela chave (maior primeiro); "Exterior / sem UF" sempre por último
  function ordenar(itens, chave) {
    return itens.slice().sort(function (a, b) {
      return ((a.id === OUTRAS.id) - (b.id === OUTRAS.id)) || ((chave(b) || 0) - (chave(a) || 0));
    });
  }

  global.SRRegional = {
    UF_COL: UF_COL,
    REGIONAIS: REGIONAIS,
    OUTRAS: OUTRAS,
    TODAS: TODAS,
    achar: achar,
    nome: function (id) { var r = achar(id); return r ? r.nome : String(id); },
    // texto do title="" da linha: as UFs que formam a regional
    dica: function (id) { var r = achar(id); return !r ? '' : r.ufs.length ? r.nome + ': ' + r.ufs.join(', ') : 'Exterior, UF em branco ou sem estado'; },
    opcoes: function () { return TODAS.map(function (r) { return { value: r.id, label: r.nome }; }); },
    filtro: filtro,
    filtroSel: filtroSel,
    porRegional: porRegional,
    idDe: idDe,
    ordenar: ordenar
  };
})(window);
