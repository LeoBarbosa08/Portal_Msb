/* ================================================================
   comercial-funil-lista.js — LISTA DE OPORTUNIDADES + FICHA do Funil de
   Oportunidades do Comercial (pages/comercial-funil.html).

   A mesma tabela do Funil de Vendas da Licitação (classes .fv- de
   licitacao-funil-vendas.css): uma linha por oportunidade, busca, ordem
   pelo cabeçalho, 60 por vez — e o clique abre à direita a FICHA da
   oportunidade, cópia do registro no Salesforce (todos os campos pelas
   seções do layout, propostas e itens da sincronizada).

   De onde vem cada coisa:
   • LISTA = Power BI do Comercial, com os MESMOS filtros da página (o
     `avBase()` dela): a soma das linhas fecha com o funil lá em cima. O
     fato é de ITEM, então a linha agrupa por nome + fase + cliente e o
     resto (vendedor, unidade, estratégia, família, médico) vem como lista
     de texto — agrupar por produto partiria a oportunidade em N linhas.
   • FICHA = Salesforce, por /api/comercial-funil. O modelo de BI não tem
     o Id da oportunidade: a ficha procura pelo NOME (o cliente e a fase
     desempatam homônimas). Abre na hora com o que a lista já sabe e
     completa quando o Salesforce responde.

   A página chama FunilLista.init({...}) com as dependências dela e
   FunilLista.carregar() a cada troca de filtro.
   ================================================================ */
(function () {
  'use strict';

  var API = '/api/comercial-funil';
  var PASSO = 60;
  var FATO = 'FAT_OPORTUNIDADES_COTACOES';
  var COL = {
    nome: FATO + '[NOME]', fase: FATO + '[FASE]', cli: 'DIM_CLIENTES[CLIENTE_FORNECEDOR]',
    uf: 'DIM_CLIENTES[CODIGO_UF_UNIDADE]', vend: 'DIM_VENDEDORES[VENDEDOR]', unid: 'DIM_UNIDADE_DE_NEGOCIO_V2[UNIDADE_DE_NEGOCIO]',
    estr: 'DIM_FAMILIAS[ESTRATEGIA]', fam: 'DIM_FAMILIAS[FAMILIA]', med: 'DIM_MEDICOS[MEDICO]',
    cir: FATO + '[DATA_CIRURGIA]', cria: FATO + '[DATA_DE_CRIACAO]', tf: FATO + '[tempo_fase]'
  };
  var M_VALOR = '[Preco total oportunidades]', M_QTDE = '[quantidade oportunidades]';

  var P = null;   // dependências da página (init)
  var ST = { ls: null, erro: null, seq: 0, completa: true, fase: '', modo: 'todas', busca: '', ord: null, lim: PASSO };

  // ── utilitários ─────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function nf(v, d) { return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function fINT(v) { return (Number(v) || 0).toLocaleString('pt-BR'); }
  function fBRL(v) { return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function brl0(v) { return 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
  function fMi(v) {
    var a = Math.abs(v || 0);
    if (a >= 1e6) return 'R$ ' + nf(v / 1e6, 2) + ' Mi';
    if (a >= 1e3) return 'R$ ' + nf(v / 1e3, 0) + 'k';
    return 'R$ ' + nf(v, 0);
  }
  function fPct(x, d) { return x == null || !isFinite(x) ? '—' : nf(x * 100, d == null ? 1 : d) + '%'; }
  function fData(iso) { if (!iso) return '—'; var p = String(iso).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function hojeISO() { return iso(new Date()); }
  function dias(a, b) { return Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86400000); }
  var DS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var DSEM = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  function relDia(d) {
    if (!d) return '';
    var n = dias(hojeISO(), d);
    if (n === 0) return 'hoje'; if (n === 1) return 'amanhã'; if (n === -1) return 'ontem';
    return n > 0 ? 'em ' + fINT(n) + ' dias' : 'há ' + fINT(-n) + ' dias';
  }
  function dorme(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function esperaAuth() {
    for (var i = 0; i < 150 && !window._portalAuthReady; i++) await dorme(100);
    if (window._portalAuthReady) { try { await Promise.race([window._portalAuthReady, dorme(15000)]); } catch (e) { } }
  }
  // valor da linha do executeQueries pela coluna (a chave vem "TABELA[COL]" ou "[apelido]")
  function val(r, nome) {
    var alvo = '[' + nome.toLowerCase() + ']';
    for (var k in r) if (k.toLowerCase().slice(-alvo.length) === alvo) return r[k];
    return null;
  }
  function num(x) { return x == null || x === '' || isNaN(Number(x)) ? null : Number(x); }
  function dia(v) { if (v == null || v === '') return null; var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v)); return m ? m[1] + '-' + m[2] + '-' + m[3] : null; }
  // texto "a|b|c" (CONCATENATEX) → lista sem vazios nem repetição
  function listaDe(v) {
    if (v == null || v === '') return [];
    return String(v).split('|').map(function (x) { return x.trim(); }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  }
  // tempo_fase pode vir número ou texto ("12", "12 dias"): o maior número basta
  function diasDe(v) {
    var ns = listaDe(v).map(function (x) { var m = /-?\d+(?:[.,]\d+)?/.exec(x); return m ? Math.round(Number(m[0].replace(',', '.'))) : null; })
      .filter(function (x) { return x != null && isFinite(x); });
    return ns.length ? Math.max.apply(null, ns) : null;
  }

  // ══════════════════════════════════════════════════════════════
  // CARGA (Power BI)
  // ══════════════════════════════════════════════════════════════
  function txt(col) { return 'CALCULATE(CONCATENATEX(SUMMARIZE(' + FATO + ', ' + col + '), ' + col + ', "|", ' + col + ', ASC))'; }
  function dax(completa) {
    var ext = ['"v", ' + M_VALOR, '"q", ' + M_QTDE];
    if (completa) ext = ext.concat([
      '"vend", ' + txt(COL.vend), '"unid", ' + txt(COL.unid), '"estr", ' + txt(COL.estr), '"fam", ' + txt(COL.fam),
      '"med", ' + txt(COL.med), '"uf", ' + txt(COL.uf), '"tf", ' + txt(COL.tf),
      '"cir", CALCULATE(MIN(' + COL.cir + '))', '"cria", CALCULATE(MIN(' + COL.cria + '))'
    ]);
    var inner = 'FILTER(ADDCOLUMNS(SUMMARIZE(' + FATO + ', ' + COL.nome + ', ' + COL.fase + ', ' + COL.cli + '), ' + ext.join(', ') + '), [q] > 0 || NOT ISBLANK([v]))';
    var f = P.filtros();
    return 'EVALUATE TOPN(3000, ' + (f.length ? 'CALCULATETABLE(' + inner + ', ' + f.join(', ') + ')' : inner) + ', [v], DESC)';
  }
  function linha(r, i) {
    var o = {
      k: 'o' + i, nome: String(val(r, 'NOME') == null ? '' : val(r, 'NOME')).trim(), fase: val(r, 'FASE') || '',
      cli: val(r, 'CLIENTE_FORNECEDOR') || '', v: num(val(r, 'v')) || 0, q: num(val(r, 'q')) || 0,
      vend: listaDe(val(r, 'vend')), unid: listaDe(val(r, 'unid')), estr: listaDe(val(r, 'estr')), fam: listaDe(val(r, 'fam')),
      med: listaDe(val(r, 'med')), uf: listaDe(val(r, 'uf')), tf: diasDe(val(r, 'tf')), cir: dia(val(r, 'cir')), cria: dia(val(r, 'cria'))
    };
    o.vendT = o.vend.join(' · '); o.unidT = o.unid.join(' · ');
    return o;
  }

  async function carregar() {
    if (!P) return;
    var meu = ++ST.seq;
    ST.ls = null; ST.erro = null; ST.lim = PASSO;
    pintar();
    var rows = null;
    try { rows = await P.query(dax(true)); ST.completa = true; }
    catch (e) {
      // coluna/relação que o modelo não tem: vai a lista mínima (nome, fase, cliente, valor)
      console.warn('[Funil · lista] consulta completa caiu, indo à mínima:', e.message);
      try { rows = await P.query(dax(false)); ST.completa = false; }
      catch (e2) { if (meu === ST.seq) { ST.erro = e2.message || String(e2); pintar(); } return; }
    }
    if (meu !== ST.seq) return;
    ST.ls = (rows || []).map(linha).filter(function (o) { return o.nome || o.v; });
    pintar();
    // o resumo da fase (comercial-funil-resumo.js) completa o que depende da lista
    if (P.carregou) { try { P.carregou(); } catch (e) { console.warn('[Funil · lista] carregou:', e.message); } }
  }

  // ══════════════════════════════════════════════════════════════
  // LISTA
  // ══════════════════════════════════════════════════════════════
  var COLS = [
    { k: 'nome', l: 'Oportunidade', t: 'nome', dica: 'nome da oportunidade · embaixo: estratégia e família dos itens' },
    { k: 'cli',  l: 'Cliente',      t: 'tx', cls: 'org' },
    { k: 'fase', l: 'Fase',         t: 'fase' },
    { k: 'vendT', l: 'Vendedor',    t: 'tx', cls: 'vd', compl: true },
    { k: 'unidT', l: 'Unidade',     t: 'tx', cls: 'st', compl: true },
    { k: 'cir',  l: 'Cirurgia',     t: 'dt', compl: true, dica: 'data da cirurgia (a mais próxima dos itens)' },
    { k: 'tf',   l: 'Na fase',      t: 'dias', num: true, compl: true, dica: 'dias parada na mesma fase (tempo de fase do modelo)' },
    { k: 'v',    l: 'Valor',        t: 'brl', num: true },
    { k: 'pct',  l: '% do total',   t: 'pct', num: true, dica: 'valor da oportunidade ÷ valor de todas as linhas no recorte' }
  ];
  function sum(ls) { return ls.reduce(function (a, o) { return a + o.v; }, 0); }
  function textoBusca(o) { return norm([o.nome, o.cli, o.fase, o.vendT, o.unidT, o.estr.join(' '), o.fam.join(' '), o.med.join(' '), o.uf.join(' ')].join(' ')); }

  function ordenar(lista) {
    var o = ST.ord;
    if (!o) {
      // padrão: valor; nas abas de cirurgia, a agenda (a mais perto de hoje primeiro)
      if (ST.modo === 'prox') return lista.slice().sort(function (a, b) { return a.cir < b.cir ? -1 : a.cir > b.cir ? 1 : b.v - a.v; });
      if (ST.modo === 'ant') return lista.slice().sort(function (a, b) { return a.cir > b.cir ? -1 : a.cir < b.cir ? 1 : b.v - a.v; });
      return lista.slice().sort(function (a, b) { return b.v - a.v; });
    }
    var d = o.d;
    return lista.slice().sort(function (a, b) {
      var x = o.k === 'pct' ? a.v : a[o.k], y = o.k === 'pct' ? b.v : b[o.k];
      var vx = x == null || x === '', vy = y == null || y === '';
      if (vx || vy) return vx && vy ? b.v - a.v : (vx ? 1 : -1);          // vazio sempre por último
      if (o.k === 'fase') return d * (P.ordemFase(a.fase) - P.ordemFase(b.fase)) || b.v - a.v;
      if (typeof x === 'number' && typeof y === 'number') return d * (x - y) || b.v - a.v;
      return d * String(x).localeCompare(String(y), 'pt-BR', { numeric: true }) || b.v - a.v;
    });
  }

  function badge(fase) { return '<span class="fv-badge" style="--c:' + esc(P.cor(fase)) + ';" title="' + esc(fase) + '"><i></i>' + esc(fase || '—') + '</span>'; }

  function pintar() {
    var body = $('op-body'); if (!body || !P) return;
    var head = $('op-head'), foot = $('op-foot'), mais = $('op-mais');
    var cols = COLS.filter(function (c) { return ST.completa || !c.compl; });
    head.innerHTML = '<tr>' + cols.map(function (col) {
      var seta = ST.ord && ST.ord.k === col.k ? '<span class="seta">' + (ST.ord.d === 1 ? '▲' : '▼') + '</span>'
        : (!ST.ord && ((col.k === 'v' && ST.modo === 'todas') || (col.k === 'cir' && ST.modo !== 'todas')) ? '<span class="seta">' + (col.k === 'v' ? '▼' : ST.modo === 'prox' ? '▲' : '▼') + '</span>' : '');
      var ar = ST.ord && ST.ord.k === col.k ? (ST.ord.d === 1 ? 'ascending' : 'descending') : 'none';
      return '<th class="ord' + (col.num ? '' : ' tx') + '" data-k="' + col.k + '" aria-sort="' + ar + '" title="' + esc(col.dica || ('ordenar por ' + col.l.toLowerCase())) + '">' + esc(col.l) + seta + '</th>';
    }).join('') + '</tr>';

    if (ST.erro) {
      body.innerHTML = '<tr><td class="tx dim ng-vz" colspan="' + cols.length + '">Não deu para montar a lista: ' + esc(String(ST.erro).slice(0, 200)) + '</td></tr>';
      foot.innerHTML = ''; mais.hidden = true; setInfo('—'); pintarSegs([]);
      return;
    }
    if (!ST.ls) {
      body.innerHTML = '<tr><td class="tx dim ng-vz" colspan="' + cols.length + '"><span class="fv-spin" style="display:inline-block;vertical-align:-3px;margin-right:8px;"></span>Carregando as oportunidades…</td></tr>';
      foot.innerHTML = ''; mais.hidden = true; setInfo('—'); pintarSegs([]);
      return;
    }

    var tudo = ST.ls, totV = sum(tudo);
    // a fase escolhida (seletor ou clique no funil) que saiu do recorte volta a "todas"
    if (ST.fase && !tudo.some(function (o) { return o.fase === ST.fase; })) ST.fase = '';
    var porFase = ST.fase ? tudo.filter(function (o) { return o.fase === ST.fase; }) : tudo;
    var hoje = hojeISO();
    var temCir = ST.completa && tudo.some(function (o) { return o.cir; });
    if (!temCir) ST.modo = 'todas';
    var fut = porFase.filter(function (o) { return o.cir && o.cir >= hoje; });
    var pas = porFase.filter(function (o) { return o.cir && o.cir < hoje; });
    pintarSegs(tudo, porFase, fut, pas, temCir);

    var base = ST.modo === 'prox' ? fut : ST.modo === 'ant' ? pas : porFase;
    var q = norm(ST.busca).trim();
    var lista = q ? base.filter(function (o) { return textoBusca(o).indexOf(q) >= 0; }) : base;
    var sv = sum(lista);
    $('op-tt').textContent = 'Oportunidades · ' + (ST.fase || 'todas as fases') + (ST.modo === 'prox' ? ' · cirurgia de hoje em diante' : ST.modo === 'ant' ? ' · cirurgia já passou' : '');
    setInfo(fINT(lista.length) + ' oportunidade' + (lista.length === 1 ? '' : 's') + ' · ' + fMi(sv) + (totV ? ' · ' + fPct(sv / totV, 0) + ' do total' : ''));

    if (!lista.length) {
      var msg = q ? 'Nenhuma oportunidade com “' + esc(ST.busca.trim()) + '” neste recorte.'
        : ST.modo === 'prox' ? 'Nenhuma cirurgia de hoje em diante neste recorte.'
        : ST.modo === 'ant' ? 'Nenhuma cirurgia anterior a hoje neste recorte.'
        : 'Nenhuma oportunidade neste recorte.';
      body.innerHTML = '<tr><td class="tx dim ng-vz" colspan="' + cols.length + '">' + msg + '</td></tr>';
      foot.innerHTML = ''; mais.hidden = true;
      return;
    }
    var ords = ordenar(lista), vis = ords.slice(0, ST.lim);
    body.innerHTML = vis.map(function (o) {
      return '<tr data-op="' + esc(o.k) + '" tabindex="0">' + cols.map(function (col) { return celula(o, col, hoje, totV); }).join('') + '</tr>';
    }).join('');
    // total de TUDO o que a lista filtrou (não só das linhas visíveis)
    var comD = lista.filter(function (o) { return o.tf != null; });
    var dmed = comD.length ? Math.round(comD.reduce(function (a, o) { return a + o.tf; }, 0) / comD.length) : null;
    var iV = cols.map(function (x) { return x.k; }).indexOf('tf');
    if (iV < 0) iV = cols.map(function (x) { return x.k; }).indexOf('v');
    foot.innerHTML = '<tr><td class="tx" colspan="' + iV + '">Total · ' + fINT(lista.length) + ' oportunidade' + (lista.length === 1 ? '' : 's') + '</td>' +
      cols.slice(iV).map(function (col) {
        if (col.k === 'v') return '<td>' + brl0(sv) + '</td>';
        if (col.k === 'tf') return '<td title="média">' + (dmed == null ? '—' : fINT(dmed) + ' d') + '</td>';
        if (col.k === 'pct') return '<td>' + (totV ? fPct(sv / totV, 1) : '—') + '</td>';
        return '<td></td>';
      }).join('') + '</tr>';
    var resto = ords.length - vis.length;
    mais.hidden = resto <= 0;
    if (resto > 0) mais.textContent = 'Mostrar mais ' + fINT(Math.min(PASSO, resto)) + ' · faltam ' + fINT(resto) + ' de ' + fINT(ords.length);
  }
  function setInfo(t) { var e = $('op-info'); if (e) e.textContent = t; }

  // seletores: fase (com a contagem de cada uma) e cirurgia (todas · próximas · anteriores)
  function pintarSegs(tudo, porFase, fut, pas, temCir) {
    var sf = $('op-fases'), sm = $('op-modo');
    if (!tudo || !tudo.length) { sf.innerHTML = ''; sf.hidden = true; sm.hidden = true; return; }
    var cont = {};
    tudo.forEach(function (o) { cont[o.fase] = (cont[o.fase] || 0) + 1; });
    var fases = Object.keys(cont).sort(function (a, b) { return P.ordemFase(a) - P.ordemFase(b); });
    sf.hidden = false;
    sf.innerHTML = '<button type="button" data-op-fase=""' + (ST.fase ? '' : ' class="on" aria-pressed="true"') + '>Todas <small>' + fINT(tudo.length) + '</small></button>' +
      fases.map(function (f) {
        var on = ST.fase === f;
        return '<button type="button" data-op-fase="' + esc(f) + '" title="' + esc(f) + '"' + (on ? ' class="on" aria-pressed="true"' : '') + '>' +
          '<i class="op-dot" style="background:' + esc(P.cor(f)) + ';"></i>' + esc(P.curto(f)) + ' <small>' + fINT(cont[f]) + '</small></button>';
      }).join('');
    sm.hidden = !temCir;
    if (!temCir) return;
    Array.prototype.forEach.call(sm.querySelectorAll('[data-op-modo]'), function (b) {
      var k = b.getAttribute('data-op-modo'), n = k === 'prox' ? fut.length : k === 'ant' ? pas.length : porFase.length;
      b.classList.toggle('on', k === ST.modo); b.setAttribute('aria-pressed', k === ST.modo ? 'true' : 'false');
      b.innerHTML = (k === 'prox' ? 'Próximas' : k === 'ant' ? 'Anteriores' : 'Todas') + ' <small>' + fINT(n) + '</small>';
      b.title = k === 'prox' ? 'cirurgia de hoje em diante' : k === 'ant' ? 'cirurgia que já passou' : 'com e sem data de cirurgia';
    });
  }

  function celula(o, col, hoje, totV) {
    switch (col.t) {
      case 'nome': {
        var sub = o.estr.concat(o.fam).join(' · ');
        return '<td class="tx nm" title="' + esc(o.nome) + ' — clique para abrir a ficha"><span class="t">' + esc(o.nome || '(sem nome)') + '</span>' +
          (sub ? '<span class="s" title="' + esc(sub) + '">' + esc(sub) + '</span>' : '') + '</td>';
      }
      case 'fase': return '<td class="tx">' + badge(o.fase) + '</td>';
      case 'dt': {
        if (!o.cir) return '<td class="tx dt z"><b>sem data</b></td>';
        var n = dias(hoje, o.cir), dd = new Date(o.cir + 'T12:00:00');
        return '<td class="tx dt' + (n === 0 ? ' hoje' : n < 0 ? ' foi' : '') + '"><b>' + fData(o.cir) + '</b><span>' + DS[dd.getDay()] + ' · ' + relDia(o.cir) + '</span></td>';
      }
      case 'brl': return '<td class="forte">' + brl0(o.v) + (o.q > 1 ? ' <span class="op-q" title="' + fINT(o.q) + ' oportunidades com este nome, cliente e fase somadas nesta linha">×' + fINT(o.q) + '</span>' : '') + '</td>';
      case 'dias': return o.tf == null ? '<td class="dim">—</td>' : '<td' + (o.tf > 14 ? ' class="warn" title="parada há mais de 14 dias"' : '') + '>' + fINT(o.tf) + ' d</td>';
      case 'pct': return '<td class="dim">' + (totV ? fPct(o.v / totV, 1) : '—') + '</td>';
      default: {
        var v = o[col.k], cl = 'tx' + (col.cls ? ' ' + col.cls : '');
        return v ? '<td class="' + cl + '" title="' + esc(v) + '">' + esc(v) + '</td>' : '<td class="' + cl + ' dim">—</td>';
      }
    }
  }

  // ── Excel: TODAS as linhas filtradas (não só as 60 visíveis) ─────
  function excel() {
    if (typeof XLSX === 'undefined') { alert('A biblioteca de exportação não carregou.'); return; }
    if (!ST.ls || !ST.ls.length) return;
    var hoje = hojeISO(), q = norm(ST.busca).trim();
    var ls = ST.ls.filter(function (o) {
      if (ST.fase && o.fase !== ST.fase) return false;
      if (ST.modo === 'prox' && !(o.cir && o.cir >= hoje)) return false;
      if (ST.modo === 'ant' && !(o.cir && o.cir < hoje)) return false;
      return !q || textoBusca(o).indexOf(q) >= 0;
    });
    var aoa = [['Oportunidade', 'Cliente', 'UF', 'Fase', 'Vendedor', 'Unidade', 'Estratégia', 'Família', 'Médico', 'Data da cirurgia', 'Data de criação', 'Dias na fase', 'Valor (R$)']];
    ordenar(ls).forEach(function (o) {
      aoa.push([o.nome, o.cli, o.uf.join(', '), o.fase, o.vendT, o.unidT, o.estr.join(', '), o.fam.join(', '), o.med.join(', '),
        o.cir ? fData(o.cir) : '', o.cria ? fData(o.cria) : '', o.tf == null ? '' : o.tf, Math.round(o.v * 100) / 100]);
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa), wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Oportunidades');
    XLSX.writeFile(wb, 'funil_oportunidades_lista_' + hojeISO() + '.xlsx');
  }

  // ══════════════════════════════════════════════════════════════
  // FICHA DA OPORTUNIDADE — painel à direita (mesmo desenho da ficha
  // da negociação da Licitação: classes .fv-dw-*)
  // ══════════════════════════════════════════════════════════════
  var _fichas = new Map();   // chave → { carregando } | { erro, status } | { d }
  var _dw = null, _dwOv = null, _dwO = null, _dwChave = null, _dwVolta = null, _dwVazios = false, _dwTodosItens = false;
  var IC_X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var IC_EXT = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

  function montarFicha() {
    if (_dw) return;
    _dwOv = document.createElement('div'); _dwOv.className = 'fv-dw-ov';
    _dw = document.createElement('aside'); _dw.className = 'fv-dw';
    _dw.setAttribute('role', 'dialog'); _dw.setAttribute('aria-modal', 'true'); _dw.setAttribute('aria-labelledby', 'op-dw-tt');
    _dw.innerHTML =
        '<div class="fv-dw-head">'
      +   '<div class="fv-dw-hl"><div class="fv-dw-k" id="op-dw-k"></div><h2 class="fv-dw-tt" id="op-dw-tt"></h2>'
      +   '<div class="fv-dw-sub" id="op-dw-sub"></div><div class="fv-dw-tags" id="op-dw-tags"></div></div>'
      +   '<button type="button" class="fv-dw-x" data-op-dw="fechar" aria-label="Fechar a ficha">' + IC_X + '</button>'
      + '</div>'
      + '<div class="fv-dw-body" id="op-dw-body"></div>'
      + '<div class="fv-dw-foot"><a class="fv-dw-sf" id="op-dw-sf" target="_blank" rel="noopener" hidden>Abrir no Salesforce ' + IC_EXT + '</a>'
      +   '<span class="fv-dw-lido" id="op-dw-lido"></span><button type="button" class="fv-dw-btn" data-op-dw="fechar">Fechar</button></div>';
    document.body.appendChild(_dwOv); document.body.appendChild(_dw);
    _dwOv.addEventListener('click', fecharFicha);
    _dw.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-op-dw]') : null; if (!b) return;
      var a = b.getAttribute('data-op-dw');
      if (a === 'fechar') fecharFicha();
      else if (a === 'vazios') { _dwVazios = !_dwVazios; pintarFicha(); }
      else if (a === 'itens') { _dwTodosItens = !_dwTodosItens; pintarFicha(); }
      else if (a === 'tentar') carregarFicha(_dwChave, true);
      else if (a === 'outra') { e.preventDefault(); trocarPara(b.getAttribute('data-id')); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && _dw.classList.contains('open')) fecharFicha(); });
  }
  // chave da ficha: 'n|' + [nome, cliente, fase] (busca pelo nome) ou 'i|' + Id
  function chaveDe(o) { return 'n|' + JSON.stringify([o.nome, o.cli, o.fase]); }
  function abrirFicha(o, origem) {
    if (!o) return;
    montarFicha();
    _dwO = o; _dwChave = chaveDe(o); _dwVolta = origem || document.activeElement; _dwVazios = false; _dwTodosItens = false;
    _dwOv.classList.add('open'); _dw.classList.add('open');
    document.documentElement.classList.add('fv-dw-on');
    pintarFicha();
    $('op-dw-body').scrollTop = 0;
    setTimeout(function () { try { _dw.querySelector('.fv-dw-x').focus(); } catch (e) { } }, 40);
    carregarFicha(_dwChave, false);
  }
  // homônima escolhida na ficha: lê pelo Id (a busca pelo nome fica guardada)
  function trocarPara(id) {
    if (!id) return;
    _dwChave = 'i|' + id; _dwVazios = false; _dwTodosItens = false;
    pintarFicha(); $('op-dw-body').scrollTop = 0;
    carregarFicha(_dwChave, false);
  }
  function fecharFicha() {
    if (!_dw) return;
    _dw.classList.remove('open'); _dwOv.classList.remove('open');
    document.documentElement.classList.remove('fv-dw-on');
    _dwChave = null; _dwO = null;
    if (_dwVolta && _dwVolta.focus) { try { _dwVolta.focus(); } catch (e) { } }
  }
  async function carregarFicha(chave, fresco) {
    var st = _fichas.get(chave);
    if (st && st.d && !fresco) return;
    if (st && st.carregando) return;
    _fichas.set(chave, { carregando: true });
    if (_dwChave === chave) pintarFicha();
    var url;
    if (chave.charAt(0) === 'i') url = API + '?id=' + encodeURIComponent(chave.slice(2));
    else {
      var p = JSON.parse(chave.slice(2));
      url = API + '?nome=' + encodeURIComponent(p[0]) + '&cliente=' + encodeURIComponent(p[1]) + '&fase=' + encodeURIComponent(p[2]);
    }
    if (fresco) url += '&fresh=1';
    var r = null, j = null;
    try {
      await esperaAuth();
      r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (r.status === 401) { await dorme(1500); r = await fetch(url, { headers: { Accept: 'application/json' } }); }
      try { j = JSON.parse(await r.text()); } catch (e) { j = null; }
    } catch (e) { j = null; r = null; }
    if (!r) _fichas.set(chave, { erro: 'Não consegui falar com o portal.' });
    else if (r.ok && j && j.ok && j.configured === false) _fichas.set(chave, { erro: 'a leitura do Salesforce ainda não está ligada no portal.', status: 503 });
    else if (r.ok && j && j.ok) {
      _fichas.set(chave, { d: j });
      // a busca guardou as homônimas: a escolhida também fica pelo Id
      if (chave.charAt(0) === 'n' && j.id) _fichas.set('i|' + j.id, { d: j });
    }
    else _fichas.set(chave, { erro: (j && j.error ? j.error + (j.detalhe ? ' — ' + j.detalhe : '') : 'HTTP ' + r.status), status: r.status, naoAchou: !!(j && j.naoAchou) });
    if (_dwChave === chave) pintarFicha();
  }

  // valor de um campo da ficha, pelo tipo que o servidor mandou
  function fmtCampo(c) {
    var v = c.v;
    if (v == null || v === '') return null;
    switch (c.t) {
      case 'brl': return esc(fBRL(v));
      case 'date': return esc(fData(v));
      case 'datetime': {
        var d = new Date(v); if (isNaN(d)) return esc(v);
        return esc(d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
      }
      case 'time': return esc(String(v).slice(0, 5));
      case 'bool': return v === true || v === 'true' ? 'Sim' : 'Não';
      case 'pct': return esc(nf(v, Number(v) % 1 ? 1 : 0) + '%');
      case 'num': return esc(Number(v).toLocaleString('pt-BR'));
      case 'url': return /^https?:\/\//i.test(String(v)) ? '<a href="' + esc(v) + '" target="_blank" rel="noopener">' + esc(v) + '</a>' : esc(v);
      case 'email': return '<a href="mailto:' + esc(v) + '">' + esc(v) + '</a>';
      case 'longo': return '<span class="pre">' + esc(v) + '</span>';
      default: return esc(String(v).replace(/;(?=\S)/g, '; '));
    }
  }
  function dl(pares) {
    return '<dl class="fv-dw-dl">' + pares.map(function (p) { return '<div class="' + (p[2] || '') + '"><dt>' + esc(p[0]) + '</dt><dd>' + p[1] + '</dd></div>'; }).join('') + '</dl>';
  }
  function linkSf(inst, obj, id) { return inst && id ? inst.replace(/\/$/, '') + '/lightning/r/' + obj + '/' + encodeURIComponent(id) + '/view' : null; }

  function pintarFicha() {
    if (!_dw || !_dwChave) return;
    var o = _dwO, st = _fichas.get(_dwChave) || {}, d = st.d || null;
    // a busca pelo nome (com as homônimas) mora na chave do NOME, mesmo depois de trocar
    var porNome = o ? (_fichas.get(chaveDe(o)) || {}).d || null : null;
    var busca = porNome ? porNome.busca || null : null;
    // trocou de homônima na ficha: os números da linha da lista são da OUTRA
    // oportunidade — o topo passa a falar da que está aberta
    var cand = busca && _dwChave.charAt(0) === 'i' && _dwChave.slice(2) !== porNome.id
      ? (busca.candidatos || []).filter(function (c) { return c.id === _dwChave.slice(2); })[0] || null : null;
    var lin = cand ? null : o;
    $('op-dw-k').textContent = 'Oportunidade · Comercial' + (d && d.fase && lin && d.fase !== lin.fase ? ' · no Salesforce: ' + d.fase : '');
    $('op-dw-tt').textContent = (d && d.nome) || (o && o.nome) || 'Oportunidade';
    $('op-dw-sub').textContent = cand ? [cand.conta, cand.dono].filter(Boolean).join(' · ') : o ? [o.cli, o.uf.join(', '), o.vendT].filter(Boolean).join(' · ') : '';
    var tags = [];
    if (cand && cand.fase) tags.push(badge(cand.fase));
    if (lin && lin.fase) tags.push(badge(lin.fase));
    if (lin) lin.unid.forEach(function (u) { tags.push('<span class="fv-dw-tag">' + esc(u) + '</span>'); });
    if (lin) lin.estr.forEach(function (e) { tags.push('<span class="fv-dw-tag s-and">' + esc(e) + '</span>'); });
    $('op-dw-tags').innerHTML = tags.join('');
    var a = $('op-dw-sf'), lk = d ? linkSf(d.instance, 'Opportunity', d.id) : null;
    if (lk) { a.href = lk; a.hidden = false; } else a.hidden = true;
    $('op-dw-lido').textContent = d && d.geradoEm ? 'lida às ' + new Date(d.geradoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

    var h = '';
    // ── números-chave (vêm da lista: aparecem na hora) ──
    if (lin) {
      var dc = lin.cir ? new Date(lin.cir + 'T12:00:00') : null;
      h += '<div class="fv-dw-kpis">'
        + '<div class="fv-dw-kp"><div class="k">Valor</div><div class="v">' + esc(fBRL(lin.v)) + '</div><div class="s">' + esc(fMi(lin.v)) + (lin.q > 1 ? ' · ' + fINT(lin.q) + ' oportunidades' : '') + '</div></div>'
        + '<div class="fv-dw-kp"><div class="k">Cirurgia</div><div class="v">' + esc(lin.cir ? fData(lin.cir) : '—') + '</div><div class="s' + (lin.cir === hojeISO() ? ' hoje' : '') + '">' + esc(dc ? DSEM[dc.getDay()] + ' · ' + relDia(lin.cir) : 'sem data no modelo') + '</div></div>'
        + '<div class="fv-dw-kp"><div class="k">Na fase</div><div class="v' + (lin.tf > 14 ? ' warn' : '') + '">' + (lin.tf == null ? '—' : fINT(lin.tf) + ' dias') + '</div><div class="s' + (lin.tf > 14 ? ' warn' : '') + '">' + esc(lin.tf == null ? 'sem tempo de fase' : lin.tf > 14 ? 'parada há mais de 14 dias' : 'andando') + '</div></div>'
        + '<div class="fv-dw-kp"><div class="k">Criada</div><div class="v">' + esc(lin.cria ? fData(lin.cria) : '—') + '</div><div class="s">' + esc(lin.cria ? relDia(lin.cria) : 'sem data no modelo') + '</div></div>'
        + '</div>';
    }
    if (busca) h += fichaBusca(busca, d);
    if (d) h += fichaCompleta(d);
    else {
      if (st.carregando) h += '<div class="fv-dw-load"><span class="fv-spin"></span>' + (_dwChave.charAt(0) === 'n' ? 'Procurando a oportunidade no Salesforce…' : 'Lendo a ficha completa no Salesforce…') + '</div>';
      if (st.erro) h += '<div class="fv-dw-err"><span>' + (st.naoAchou
          ? 'Não achei esta oportunidade no Salesforce pelo nome <b>“' + esc(o ? o.nome : '') + '”</b> — o nome pode ter mudado depois da última carga do DW.'
          : 'Não deu para ler a ficha completa: <b>' + esc(st.erro) + '</b>') + '</span>'
        + (st.status === 404 || st.status === 503 ? '' : '<button type="button" class="fv-act" data-op-dw="tentar">Tentar de novo</button>') + '</div>';
      if (lin) h += '<section class="fv-dw-card"><h4>Resumo da oportunidade · Power BI</h4>' + dl(resumoDe(lin)) + '</section>';
    }
    $('op-dw-body').innerHTML = h;
  }
  // o que a lista já tem — enquanto a ficha do Salesforce não chega
  function resumoDe(o) {
    var ps = [];
    ps.push(['Cliente', esc(o.cli || '—')]);
    if (o.uf.length) ps.push(['UF', esc(o.uf.join(', '))]);
    ps.push(['Fase', esc(o.fase || '—')]);
    if (o.vendT) ps.push(['Vendedor', esc(o.vendT)]);
    if (o.unidT) ps.push(['Unidade de negócio', esc(o.unidT)]);
    if (o.estr.length) ps.push(['Estratégia', esc(o.estr.join(', '))]);
    if (o.fam.length) ps.push(['Família', esc(o.fam.join(', ')), o.fam.length > 2 ? 'largo' : '']);
    if (o.med.length) ps.push(['Médico', esc(o.med.join(', ')), o.med.length > 2 ? 'largo' : '']);
    return ps;
  }
  // homônimas: o nome do BI casou com mais de uma oportunidade (ou só o começo do nome)
  function fichaBusca(b, d) {
    var cs = b.candidatos || [];
    if (cs.length < 2 && b.casamento === 'nome') return '';
    var atual = d ? d.id : null;
    var tit = cs.length > 1 ? fINT(cs.length) + (b.limite ? '+' : '') + ' oportunidades com este nome no Salesforce' : 'Achada pelo começo do nome';
    var nota = cs.length > 1 ? 'A ficha abriu a que mais combina com o cliente e a fase da lista. Clique em outra para trocar.'
      : 'O nome na lista do Power BI é o começo do nome no Salesforce.';
    return '<section class="fv-dw-card"><h4>' + esc(tit) + '</h4><div class="fv-dw-nada" style="margin-bottom:8px;">' + esc(nota) + '</div>'
      + (cs.length > 1 ? '<div class="fv-dw-props">' + cs.map(function (c) {
        var on = c.id === atual;
        return '<div class="fv-dw-pr' + (on ? ' sinc' : '') + '">'
          + '<div class="c"><div class="t">' + (on ? esc(c.nome) + ' <span class="fv-dw-tag s-and">aberta</span>' : '<a href="#" data-op-dw="outra" data-id="' + esc(c.id) + '">' + esc(c.nome) + '</a>') + '</div>'
          + '<div class="s">' + esc([c.conta, c.fase, c.tipo, c.criada ? 'criada ' + fData(c.criada) : null].filter(Boolean).join(' · ')) + '</div></div>'
          + '<div class="v">' + (c.valor == null ? '—' : esc(fBRL(c.valor))) + '</div></div>';
      }).join('') + '</div>' : '')
      + '</section>';
  }
  function fichaCompleta(d) {
    var h = '', vazios = 0;
    (d.secoes || []).forEach(function (s) {
      var ps = [];
      s.campos.forEach(function (c) {
        var v = fmtCampo(c);
        if (v == null) { vazios++; if (!_dwVazios) return; ps.push([c.r, '<span class="z">—</span>', 'vazio']); return; }
        ps.push([c.r, v, c.t === 'longo' && String(c.v).length > 60 ? 'largo' : '']);
      });
      if (!ps.length) return;
      var tt = esc(s.titulo || 'Outras informações');
      h += s.fora
        ? '<details class="fv-dw-card fv-dw-mais"><summary><h4>' + tt + ' <small>' + fINT(ps.length) + '</small></h4></summary>' + dl(ps) + '</details>'
        : '<section class="fv-dw-card"><h4>' + tt + '</h4>' + dl(ps) + '</section>';
    });
    if (vazios) h += '<button type="button" class="fv-dw-vaz" data-op-dw="vazios">' + (_dwVazios ? 'Esconder os campos vazios' : 'Mostrar os ' + fINT(vazios) + ' campos vazios') + '</button>';
    h += fichaPropostas(d) + fichaItens(d);
    if ((d.avisos || []).length) h += '<div class="fv-dw-av">' + d.avisos.map(esc).join('<br>') + '</div>';
    return h;
  }
  function fichaPropostas(d) {
    if (!d.propostas) return '';
    if (!d.propostas.length) return '<section class="fv-dw-card"><h4>Propostas</h4><div class="fv-dw-nada">Nenhuma proposta criada nesta oportunidade.</div></section>';
    return '<section class="fv-dw-card"><h4>Propostas <small>' + fINT(d.propostas.length) + '</small></h4><div class="fv-dw-props">' + d.propostas.map(function (p) {
      var lk = linkSf(d.instance, 'Quote', p.id);
      var tt = esc(p.nome || p.numero || 'Proposta');
      return '<div class="fv-dw-pr' + (p.sinc ? ' sinc' : '') + '">'
        + '<div class="c"><div class="t">' + (lk ? '<a href="' + esc(lk) + '" target="_blank" rel="noopener">' + tt + '</a>' : tt) + (p.sinc ? ' <span class="fv-dw-tag s-and">sincronizada</span>' : '') + '</div>'
        + '<div class="s">' + esc([p.numero ? 'nº ' + p.numero : null, p.status, p.criada ? 'criada ' + fData(p.criada) : null, p.validade ? 'válida até ' + fData(p.validade) : null].filter(Boolean).join(' · ')) + '</div></div>'
        + '<div class="v">' + (p.total == null ? '—' : esc(fBRL(p.total))) + '</div></div>';
    }).join('') + '</div></section>';
  }
  function fichaItens(d) {
    var it = d.itens; if (!it) return '';
    var ix = {}; it.cols.forEach(function (c, i) { ix[c.k] = i; });
    var g = function (r, k) { return ix[k] == null ? null : r[ix[k]]; };
    var p = (d.propostas || []).filter(function (x) { return x.id === it.proposta; })[0];
    var tit = 'Itens da proposta ' + (p && p.sinc ? 'sincronizada' : 'mais recente');
    if (!it.rows.length) return '<section class="fv-dw-card"><h4>' + tit + '</h4><div class="fv-dw-nada">A proposta não tem itens.</div></section>';
    var tot = 0, gan = 0, per = 0;
    it.rows.forEach(function (r) {
      tot += Number(g(r, 'total')) || 0;
      var res = g(r, 'res'); if (res != null && res !== '') { if (/^ganh/.test(norm(res))) gan++; else per++; }
    });
    var lim = _dwTodosItens ? it.rows.length : 40;
    var lista = it.rows.slice(0, lim).map(function (r, i) {
      var nI = g(r, 'num'), res = g(r, 'res'), qtd = g(r, 'qtd'), unit = g(r, 'unit'), totI = g(r, 'total');
      var cod = g(r, 'cod') || g(r, 'codp');
      var meta = [cod, g(r, 'lote') ? 'lote ' + g(r, 'lote') : null, g(r, 'unid'), g(r, 'marca')].filter(Boolean).join(' · ');
      var ds = g(r, 'desc') || g(r, 'desc2');
      var cls = res == null || res === '' ? '' : (/^ganh/.test(norm(res)) ? 'gan' : 'per');
      return '<div class="fv-dw-it">'
        // sem nº do item (o da licitação), vale a posição na proposta
        + '<div class="n" title="' + (nI == null ? 'posição na proposta' : 'nº do item') + '">' + esc(nI == null ? i + 1 : Number(nI).toLocaleString('pt-BR')) + '</div>'
        + '<div class="c"><div class="t">' + esc(g(r, 'prod') || 'Item sem produto') + '</div>'
        +   (meta ? '<div class="s">' + esc(meta) + '</div>' : '')
        +   (ds ? '<div class="d" title="' + esc(ds) + '">' + esc(ds) + '</div>' : '')
        +   (g(r, 'obs') ? '<div class="d">' + esc(g(r, 'obs')) + '</div>' : '') + '</div>'
        + '<div class="v"><b>' + (totI == null ? '—' : esc(fBRL(totI))) + '</b>'
        +   (qtd != null ? '<span>' + esc(Number(qtd).toLocaleString('pt-BR')) + (unit != null ? ' × ' + esc(fBRL(unit)) : '') + '</span>' : '')
        +   (cls ? '<span class="fv-dw-tag s-' + cls + '">' + esc(res) + '</span>' : '') + '</div>'
        + '</div>';
    }).join('');
    return '<section class="fv-dw-card"><h4>' + tit + ' <small>' + fINT(it.rows.length) + (it.truncado ? '+' : '') + '</small></h4>'
      + '<div class="fv-dw-its-r"><span>Total dos itens <b>' + esc(fBRL(tot)) + '</b></span>'
      + (gan + per ? '<span><b class="gan">' + fINT(gan) + '</b> ganhos · <b class="per">' + fINT(per) + '</b> perdidos · ' + fINT(it.rows.length - gan - per) + ' sem resultado</span>' : '') + '</div>'
      + '<div class="fv-dw-its">' + lista + '</div>'
      + (it.rows.length > 40 ? '<button type="button" class="fv-dw-vaz" data-op-dw="itens">' + (_dwTodosItens ? 'Mostrar só os 40 primeiros' : 'Mostrar os ' + fINT(it.rows.length) + ' itens') + '</button>' : '')
      + '</section>';
  }

  // ══════════════════════════════════════════════════════════════
  // EVENTOS
  // ══════════════════════════════════════════════════════════════
  function ligar() {
    var card = $('fx-ops'); if (!card || card._opLigado) return;
    card._opLigado = true;
    card.addEventListener('click', function (e) {
      var t = e.target;
      var tr = t.closest('tr[data-op]');
      if (tr) { abrirFicha(objeto(tr.getAttribute('data-op')), tr); return; }
      var th = t.closest('#op-head th[data-k]');
      if (th) {
        var k = th.getAttribute('data-k');
        if (ST.ord && ST.ord.k === k) ST.ord = ST.ord.d === -1 ? { k: k, d: 1 } : null;   // ▼ → ▲ → padrão
        else ST.ord = { k: k, d: k === 'v' || k === 'pct' || k === 'tf' ? -1 : 1 };
        ST.lim = PASSO; pintar(); return;
      }
      var bf = t.closest('[data-op-fase]');
      if (bf) { fase(bf.getAttribute('data-op-fase'), false); return; }
      var bm = t.closest('[data-op-modo]');
      if (bm) { ST.modo = bm.getAttribute('data-op-modo'); ST.lim = PASSO; pintar(); return; }
      if (t.closest('#op-mais')) { ST.lim += PASSO; pintar(); return; }
      if (t.closest('#op-excel')) excel();
    });
    card.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var tr = e.target.closest && e.target.closest('tr[data-op]');
      if (tr) { e.preventDefault(); abrirFicha(objeto(tr.getAttribute('data-op')), tr); }
    });
    var tb = null;
    $('op-busca').addEventListener('input', function (e) {
      clearTimeout(tb); var v = e.target.value;
      tb = setTimeout(function () { ST.busca = v; ST.lim = PASSO; pintar(); }, 160);
    });
  }
  function objeto(k) { return ST.ls ? ST.ls.filter(function (o) { return o.k === k; })[0] || null : null; }
  // fase da lista: o seletor do cartão e o clique no funil lá em cima
  function fase(nome, rolar) {
    ST.fase = ST.fase === nome && rolar ? '' : (nome || '');
    ST.lim = PASSO; pintar();
    if (rolar) { var c = $('fx-ops'); if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  // "Ver na lista" do resumo: fixa a fase (sem alternar) e a busca, e rola até a lista
  function mostrar(o) {
    o = o || {};
    ST.fase = o.fase || ''; ST.modo = 'todas';
    if (o.busca != null) { ST.busca = String(o.busca); var b = $('op-busca'); if (b) b.value = ST.busca; }
    ST.lim = PASSO; pintar();
    var c = $('fx-ops'); if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  window.FunilLista = {
    // cfg: { query(dax) → linhas, filtros() → [predicados DAX], cor(fase), ordemFase(fase), curto(fase), carregou()? }
    init: function (cfg) { P = cfg; ligar(); pintar(); },
    carregar: carregar,
    fase: function (nome) { fase(nome, true); },
    mostrar: mostrar,
    ficha: abrirFicha,
    // linhas carregadas (null enquanto carrega) e a linha de uma oportunidade pela chave da lista
    linhas: function () { return ST.ls; },
    completa: function () { return ST.completa; },
    achar: function (nome, fase, cli) {
      return ST.ls ? ST.ls.filter(function (o) { return o.nome === nome && o.fase === fase && o.cli === cli; })[0] || null : null;
    },
    diag: function () { return { linhas: ST.ls ? ST.ls.length : null, completa: ST.completa, erro: ST.erro, fase: ST.fase, modo: ST.modo }; }
  };
})();
