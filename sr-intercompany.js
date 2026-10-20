/* ================================================================
   sr-intercompany.js — filtro-base do Sales Report do Comercial:
                        'Faturamentos'[É intercompany?] = "NÃO"
   ----------------------------------------------------------------
   Regra do negócio: TODA página do Sales Report do Comercial filtra o
   fato Faturamentos por [É intercompany?] = "NÃO". Ele soma ao filtro
   antigo por unidade ('DIM_UNIDADE_DE_NEGOCIO_V2'[UNIDADE_DE_NEGOCIO]
   <> "INTERCOMPANY"), não o substitui.

   Por que a grafia não vai fixa no código: a coluna irmã em Pedidos se
   chama "É intercomapny?" (sic) no modelo — com o nome "certo" a consulta
   inteira cai com «Column … cannot be found». Aqui o nome EXATO sai do
   catálogo do modelo (INFO.VIEW.COLUMNS) e o "NÃO" sai do próprio
   VALUES() da coluna (texto "NÃO"/"Não", booleano FALSE ou 0). Sem
   catálogo, testa as grafias conhecidas uma a uma.

   Se não resolver, o filtro NÃO entra (chute derrubaria a página) e
   SRInterco.aviso diz o motivo — a página mostra isso no banner.

   Como usar numa página:
       <script src="../sr-intercompany.js?v=1"></script>
       ...
       await pbiConnect();
       await SRInterco.resolver(pbiQuery);        // 1x, antes da 1ª consulta
       SRInterco.marcarBanner(banner);            // âmbar se não aplicou
       ...
       const base = [..., MEDIDAS.semNfOculta].concat(SRInterco.filtros());

   F12:  SRInterco.estado()  → coluna, literal, predicado e aviso
   ================================================================ */
(function (global) {
  'use strict';

  var TABELA = 'Faturamentos';
  // grafias já vistas/pedidas; a 1ª é a correta, as outras são as do modelo
  var CANDS = ['É intercompany?', 'É intercomapny?', 'É intercomapany?', 'E intercompany?'];

  var ST = { coluna: null, literal: null, pred: null, aviso: null };
  var _prom = null;

  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function esc(s) { return String(s).replace(/"/g, '""'); }
  function ref(col) { return "'" + TABELA + "'[" + col + ']'; }
  function campo(r, rx) { var k = Object.keys(r || {}).find(function (x) { return rx.test(x); }); return k ? r[k] : null; }
  function valores(rows) {
    var k = (rows && rows.length) ? Object.keys(rows[0])[0] : null;
    return k ? rows.map(function (r) { return r[k]; }) : [];
  }

  // literal DAX do "não" com o tipo que a coluna devolveu (null = não tem)
  function literalNao(vals) {
    var v = vals.find(function (x) { return x === false || x === 0 || /^(nao|n|false|0)$/.test(norm(x)); });
    if (v === undefined) return null;
    if (typeof v === 'boolean') return 'FALSE()';
    if (typeof v === 'number') return String(v);
    return '"' + esc(v) + '"';
  }

  // nome exato da coluna pelo catálogo; null = catálogo indisponível
  async function colunaDoCatalogo(q) {
    var rows;
    try {
      rows = await q('EVALUATE FILTER(SELECTCOLUMNS(INFO.VIEW.COLUMNS(), "T", [Table], "N", [Name]), [T] = "' + TABELA + '")');
    } catch (e) { return null; }
    var nomes = (rows || []).map(function (r) { return campo(r, /\[N\]$/); })
      .filter(function (n) { return n != null; }).map(String);
    if (!nomes.length) return null;
    var exato = CANDS.map(norm);
    var hit = nomes.find(function (n) { return exato.indexOf(norm(n)) >= 0; });
    if (hit) return hit;
    // grafia nova: qualquer coluna "É interco…" da tabela
    var cand = nomes.filter(function (n) { return /interco/.test(norm(n)); });
    return cand.find(function (n) { return /^e interco/.test(norm(n)); }) || cand[0] || '';
  }

  async function resolverAgora(q) {
    ST.coluna = ST.literal = ST.pred = ST.aviso = null;
    var col = await colunaDoCatalogo(q);
    var vals = null;
    if (col === '') {
      ST.aviso = 'a tabela ' + TABELA + ' não tem a coluna [É intercompany?] (nem outra com "interco" no nome)';
      return null;
    }
    if (col) {
      try { vals = valores(await q('EVALUATE VALUES(' + ref(col) + ')')); }
      catch (e) { ST.aviso = 'erro ao ler ' + ref(col) + ': ' + String(e && e.message).slice(0, 90); return null; }
    } else {
      // sem catálogo: a 1ª grafia que o modelo aceitar
      for (var i = 0; i < CANDS.length && !col; i++) {
        try { vals = valores(await q('EVALUATE VALUES(' + ref(CANDS[i]) + ')')); col = CANDS[i]; }
        catch (e) { /* grafia não existe no modelo: tenta a próxima */ }
      }
      if (!col) { ST.aviso = 'não achei ' + ref(CANDS[0]) + ' no modelo (catálogo indisponível)'; return null; }
    }
    var lit = literalNao(vals);
    if (!lit) {
      ST.aviso = ref(col) + ' não tem valor "NÃO" (achei: ' + (vals.slice(0, 6).map(String).join(' / ') || 'nada') + ')';
      return null;
    }
    ST.coluna = col; ST.literal = lit; ST.pred = ref(col) + ' = ' + lit;
    return ST.pred;
  }

  // resolve uma vez por página; nunca rejeita (sem filtro → aviso)
  function resolver(q) {
    if (!_prom) {
      _prom = resolverAgora(q).catch(function (e) {
        ST.aviso = 'erro ao resolver o filtro: ' + String(e && e.message).slice(0, 90);
        return null;
      }).then(function (p) {
        if (ST.aviso) console.warn('[SR] filtro intercompany de Faturamentos NÃO aplicado — ' + ST.aviso);
        return p;
      });
    }
    return _prom;
  }

  // pronto p/ .concat() no filtro-base: [] enquanto/quando não resolveu
  function filtros() { return ST.pred ? [ST.pred] : []; }

  // banner de "Conectado" vira âmbar e diz o motivo quando o filtro não entrou
  function marcarBanner(el) {
    if (!el || !ST.aviso) return;
    el.style.background = '#FFFBEB'; el.style.borderColor = '#FDE68A'; el.style.color = '#78350F';
    var s = document.createElement('span');
    s.style.flex = '1 1 0'; s.style.minWidth = '0';   // banner é flex: o aviso ocupa a sobra
    s.textContent = ' · ⚠ filtro ' + ref(CANDS[0]) + ' = "NÃO" não aplicado — ' + ST.aviso;
    el.appendChild(s);
  }

  var API = {
    resolver: resolver, filtros: filtros, marcarBanner: marcarBanner,
    estado: function () { return Object.assign({}, ST); },
    get pred() { return ST.pred; }, get coluna() { return ST.coluna; },
    get literal() { return ST.literal; }, get aviso() { return ST.aviso; },
    _reset: function () { _prom = null; ST.coluna = ST.literal = ST.pred = ST.aviso = null; }
  };
  global.SRInterco = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
