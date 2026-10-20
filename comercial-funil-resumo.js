/* ================================================================
   comercial-funil-resumo.js — RESUMO DO RECORTE do Funil de
   Oportunidades do Comercial (pages/comercial-funil.html).

   Clicar numa fase do funil (ou num mini-funil de estratégia, numa
   barra de cliente, família, vendedor ou filial) abre à direita o
   resumo daquele recorte: números-chave, principais oportunidades,
   famílias, clientes, estratégias, vendedores e filiais.

   • RECORTE = { fase?, estr?, cli?, fam?, vend?, unid? }. Cada chave vira
     um predicado DAX (DaxLit.igual) SOMADO aos filtros da página
     (avBase): o resumo fecha com o que a página mostra.
   • Dentro do painel: o seletor troca a fase; clicar numa barra estreita
     o recorte; o × do chip tira a dimensão.
   • Números = Power BI (até 6 consultas, cada seção pinta quando a sua
     chega). Tempo na fase e cirurgias vêm da lista de oportunidades
     (comercial-funil-lista.js), que também abre a FICHA do Salesforce ao
     clicar numa oportunidade — a ficha abre por cima e, ao fechar, o
     resumo continua ali.

   A página chama FunilResumo.init({...}) e FunilResumo.abrir(recorte).
   ================================================================ */
(function () {
  'use strict';

  var FATO = 'FAT_OPORTUNIDADES_COTACOES';
  var COL = {
    fase: FATO + '[FASE]', nome: FATO + '[NOME]',
    cli: 'DIM_CLIENTES[CLIENTE_FORNECEDOR]', estr: 'DIM_FAMILIAS[ESTRATEGIA]', fam: 'DIM_FAMILIAS[FAMILIA]',
    vend: 'DIM_VENDEDORES[VENDEDOR]', unid: 'DIM_UNIDADE_DE_NEGOCIO_V2[UNIDADE_DE_NEGOCIO]'
  };
  // ordem em que as dimensões aparecem nos chips e dão nome ao painel
  var DIMS = ['estr', 'cli', 'fam', 'vend', 'unid'];
  var ROT = { fase: 'Fase', estr: 'Estratégia', cli: 'Cliente', fam: 'Família', vend: 'Vendedor', unid: 'Filial' };
  var MEDS = '"v", [Preco total oportunidades], "q", [quantidade oportunidades]';
  var COR = { fam: '#2E9E63', cli: '#1272C4', estr: '#135E97', vend: '#4596CC', unid: '#1272C4' };

  var P = null;          // dependências da página (init)
  var E = null;          // recorte aberto
  var seq = 0;           // consulta velha não pinta
  var D = {};            // dados do recorte aberto, por seção
  var _dw = null, _ov = null, _volta = null;

  // ── utilitários ─────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nf(v, d) { return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function fINT(v) { return (Number(v) || 0).toLocaleString('pt-BR'); }
  function fBRL(v) { return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function fMi(v) {
    var a = Math.abs(v || 0);
    if (a >= 1e6) return 'R$ ' + nf(v / 1e6, 2) + ' Mi';
    if (a >= 1e3) return 'R$ ' + nf(v / 1e3, 0) + 'k';
    return 'R$ ' + nf(v, 0);
  }
  function fPct(x) { return x == null || !isFinite(x) ? '—' : nf(x * 100, 1) + '%'; }
  function fData(iso) { if (!iso) return '—'; var p = String(iso).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] : String(iso); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function tem(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  // valor da linha do executeQueries pela coluna (a chave vem "TABELA[COL]" ou "[apelido]")
  function val(r, nome) {
    var alvo = '[' + nome.toLowerCase() + ']';
    for (var k in r) if (k.toLowerCase().slice(-alvo.length) === alvo) return r[k];
    return null;
  }
  function num(x) { return x == null || x === '' || isNaN(Number(x)) ? 0 : Number(x); }
  function nomeDe(dim, v) { return v == null || v === '' ? (dim === 'vend' ? 'Sem vendedor' : '(em branco)') : String(v); }
  function lista() { return window.FunilLista && FunilLista.linhas ? FunilLista.linhas() : null; }

  // ══════════════════════════════════════════════════════════════
  // CONSULTAS (Power BI)
  // ══════════════════════════════════════════════════════════════
  function preds(rec, sem) {
    var f = P.filtros().slice();
    ['fase'].concat(DIMS).forEach(function (k) { if (k !== sem && tem(rec, k)) f.push(DaxLit.igual(COL[k], rec[k])); });
    return f;
  }
  function calc(inner, rec, sem) { return 'CALCULATETABLE(' + inner + ', ' + preds(rec, sem).join(', ') + ')'; }
  function agrupa(cols) { return 'FILTER(ADDCOLUMNS(SUMMARIZE(' + FATO + ', ' + cols.join(', ') + '), ' + MEDS + '), [q] > 0)'; }
  function topn(n, inner) { return 'EVALUATE TOPN(' + n + ', ' + inner + ', [v], DESC)'; }

  // fases do recorte SEM a fase: dá os totais, a contagem do seletor e a
  // "parte do todo" — e é a mesma consulta para todas as fases (cache)
  function qFases(rec) { return P.query('EVALUATE ' + calc(agrupa([COL.fase]), rec, 'fase')); }
  function qOps(rec) { return P.query(topn(10, calc(agrupa([COL.nome, COL.fase, COL.cli]), rec))); }
  // família leva a estratégia (a família é de uma só): a soma por estratégia sai daqui
  function qFam(rec) { return P.query('EVALUATE ' + calc(agrupa([COL.estr, COL.fam]), rec)); }
  function qDim(rec, k, n) { return P.query(n ? topn(n, calc(agrupa([COL[k]]), rec)) : 'EVALUATE ' + calc(agrupa([COL[k]]), rec)); }

  // ══════════════════════════════════════════════════════════════
  // PAINEL
  // ══════════════════════════════════════════════════════════════
  var IC_X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var IC_XS = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var IC_LISTA = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';

  function montar() {
    if (_dw) return;
    _ov = document.createElement('div'); _ov.className = 'fv-dw-ov fx-ovw-ov';
    _dw = document.createElement('aside'); _dw.className = 'fv-dw fx-ovw';
    _dw.setAttribute('role', 'dialog'); _dw.setAttribute('aria-modal', 'true'); _dw.setAttribute('aria-labelledby', 'ov-tt');
    _dw.innerHTML =
        '<div class="fv-dw-head">'
      +   '<div class="fv-dw-hl"><div class="fv-dw-k" id="ov-k"></div><h2 class="fv-dw-tt" id="ov-tt"></h2>'
      +   '<div class="fv-dw-sub" id="ov-sub"></div><div class="fv-dw-tags" id="ov-chips"></div>'
      +   '<div class="fv-seg fx-ov-seg" id="ov-seg" role="group" aria-label="Fase do resumo"></div></div>'
      +   '<button type="button" class="fv-dw-x" data-ov="fechar" aria-label="Fechar o resumo">' + IC_X + '</button>'
      + '</div>'
      + '<div class="fv-dw-body" id="ov-body"></div>'
      + '<div class="fv-dw-foot"><button type="button" class="fv-dw-sf" data-ov="lista">' + IC_LISTA + 'Ver na lista</button>'
      +   '<span class="fv-dw-lido" id="ov-ctx"></span><button type="button" class="fv-dw-btn" data-ov="fechar">Fechar</button></div>';
    document.body.appendChild(_ov); document.body.appendChild(_dw);
    _ov.addEventListener('click', fechar);
    _dw.addEventListener('click', clique);
    // captura: com a ficha do Salesforce aberta por cima, o Esc fecha só ela
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _dw.classList.contains('open') && !document.querySelector('.fv-dw.open:not(.fx-ovw)')) fechar();
    }, true);
  }

  function abrir(rec, origem) {
    if (!P || !rec) return;
    montar();
    if (!_dw.classList.contains('open')) _volta = origem || document.activeElement;
    E = limpo(rec);
    _ov.classList.add('open'); _dw.classList.add('open');
    document.documentElement.classList.add('fx-ovw-on');
    carregar();
    setTimeout(function () { try { _dw.querySelector('.fv-dw-x').focus(); } catch (e) { } }, 40);
  }
  function fechar() {
    if (!_dw) return;
    seq++;
    _dw.classList.remove('open'); _ov.classList.remove('open');
    document.documentElement.classList.remove('fx-ovw-on');
    E = null;
    if (_volta && _volta.focus && document.contains(_volta)) { try { _volta.focus({ preventScroll: true }); } catch (e) { } }
  }
  // só as chaves conhecidas; null vale (= em branco no modelo, ex.: sem vendedor)
  function limpo(rec) {
    var o = {};
    if (rec.fase) o.fase = String(rec.fase);
    DIMS.forEach(function (k) { if (tem(rec, k) && rec[k] !== undefined) o[k] = rec[k]; });
    return o;
  }
  function trocar(rec) { E = limpo(rec); carregar(); $('ov-body').scrollTop = 0; }

  function clique(e) {
    var b = e.target.closest ? e.target.closest('[data-ov]') : null; if (!b) return;
    var a = b.getAttribute('data-ov'), rec;
    if (a === 'fechar') fechar();
    else if (a === 'tentar') carregar();
    else if (a === 'fase') { rec = copia(E); var f = b.getAttribute('data-fase'); if (f) rec.fase = f; else delete rec.fase; trocar(rec); }
    else if (a === 'tira') { rec = copia(E); delete rec[b.getAttribute('data-dim')]; trocar(rec); }
    else if (a === 'dim') {
      var it = (D.itens || {})[b.getAttribute('data-dim')];
      it = it && it[+b.getAttribute('data-i')]; if (!it) return;
      rec = copia(E); rec[b.getAttribute('data-dim')] = it.raw; trocar(rec);
    }
    else if (a === 'op') {
      var o = (D.ops || [])[+b.getAttribute('data-i')];
      if (o && window.FunilLista) FunilLista.ficha(o.lin || minimo(o), b);
    }
    else if (a === 'lista') {
      var busca = '';
      ['cli', 'fam', 'vend', 'unid', 'estr'].some(function (k) { if (tem(E, k) && E[k] != null) { busca = String(E[k]); return true; } return false; });
      var fase = E.fase || '';
      fechar();
      if (window.FunilLista) FunilLista.mostrar({ fase: fase, busca: busca });
    }
  }
  function copia(o) { var c = {}; for (var k in o) if (tem(o, k)) c[k] = o[k]; return c; }

  // a linha que a ficha espera, quando a oportunidade não está na lista carregada
  function minimo(o) {
    return { k: 'ov', nome: o.nome, fase: o.fase, cli: o.cli, v: o.v, q: o.q, vend: [], unid: [], estr: [], fam: [], med: [], uf: [],
      tf: null, cir: null, cria: null, vendT: '', unidT: '' };
  }

  // ══════════════════════════════════════════════════════════════
  // CARGA + PINTURA
  // ══════════════════════════════════════════════════════════════
  function carregar() {
    var meu = ++seq, rec = copia(E);
    D = { itens: {} };
    cabecalho();
    var semF = !tem(rec, 'fase');
    var h = '<div id="ov-kpis">' + kpisHtml() + '</div>';
    if (semF) h += secao('fases', 'Por fase');
    h += secao('ops', 'Principais oportunidades');
    h += '<div class="fx-ov-grid">';
    if (!tem(rec, 'fam')) h += secao('fam', 'Principais famílias');
    if (!tem(rec, 'cli')) h += secao('cli', 'Principais clientes');
    if (!tem(rec, 'estr')) h += secao('estr', 'Por estratégia');
    if (!tem(rec, 'vend')) h += secao('vend', 'Vendedores');
    if (!tem(rec, 'unid')) h += secao('unid', 'Filiais');
    h += '</div>';
    $('ov-body').innerHTML = h;

    function vale() { return meu === seq; }
    function falhou(id) { return function (err) { if (vale()) erro(id, err); }; }
    qFases(rec).then(function (rows) {
      if (!vale()) return;
      D.fases = (rows || []).map(function (r) { return { nome: val(r, 'FASE') || '', v: num(val(r, 'v')), q: num(val(r, 'q')) }; })
        .filter(function (x) { return x.nome; })
        .sort(function (a, b) { return P.ordemFase(a.nome) - P.ordemFase(b.nome) || b.v - a.v; });
      seletor(); pintarKpis();
      if (semF) pintarBarras('fases', D.fases.map(function (x) { return { nome: x.nome, raw: x.nome, v: x.v, q: x.q, cor: P.cor(x.nome) }; }), 'fase');
      ['fam', 'cli', 'vend'].forEach(function (k) { if (D.itens[k]) pintarBarras(k, D.itens[k], k, true); });
      if (D.ops) pintarOps();
    }, function (err) { if (vale()) { erro('fases', err); $('ov-kpis').innerHTML = errHtml(err); } });
    qOps(rec).then(function (rows) {
      if (!vale()) return;
      D.ops = (rows || []).map(function (r) {
        return { nome: String(val(r, 'NOME') == null ? '' : val(r, 'NOME')).trim(), fase: val(r, 'FASE') || '', cli: val(r, 'CLIENTE_FORNECEDOR') || '',
          v: num(val(r, 'v')), q: num(val(r, 'q')) };
      }).sort(function (a, b) { return b.v - a.v; });
      pintarOps();
    }, falhou('ops'));
    if (!tem(rec, 'fam') || !tem(rec, 'estr')) qFam(rec).then(function (rows) {
      if (!vale()) return;
      var fams = [], estr = {};
      (rows || []).forEach(function (r) {
        var es = val(r, 'ESTRATEGIA'), v = num(val(r, 'v'));
        fams.push({ nome: nomeDe('fam', val(r, 'FAMILIA')), raw: val(r, 'FAMILIA'), v: v, q: num(val(r, 'q')), sub: es });
        var k = es == null ? '' : String(es);
        (estr[k] = estr[k] || { nome: nomeDe('estr', es), raw: es, v: 0, n: 0 }).v += v; estr[k].n++;
      });
      if (!tem(rec, 'fam')) pintarBarras('fam', fams.sort(function (a, b) { return b.v - a.v; }).slice(0, 8), 'fam', true);
      if (!tem(rec, 'estr')) pintarBarras('estr', Object.keys(estr).map(function (k) { return estr[k]; }).sort(function (a, b) { return b.v - a.v; }), 'estr');
    }, function (err) { if (vale()) { erro('fam', err); erro('estr', err); } });
    [['cli', 8], ['vend', 6], ['unid', 0]].forEach(function (d) {
      var k = d[0]; if (tem(rec, k)) return;
      qDim(rec, k, d[1]).then(function (rows) {
        if (!vale()) return;
        pintarBarras(k, (rows || []).map(function (r) { var x = val(r, COL[k].replace(/^.*\[/, '').replace(']', '')); return { nome: nomeDe(k, x), raw: x, v: num(val(r, 'v')), q: num(val(r, 'q')) }; })
          .sort(function (a, b) { return b.v - a.v; }), k, !!d[1]);
      }, falhou(k));
    });
  }

  // ── cabeçalho: título, chips do recorte, seletor de fase, contexto ──
  function cabecalho() {
    var outros = DIMS.filter(function (k) { return tem(E, k); });
    $('ov-k').textContent = 'Resumo · ' + (tem(E, 'fase') ? 'fase do funil' : outros.length ? ROT[outros[0]].toLowerCase() : 'pipeline');
    $('ov-tt').textContent = tem(E, 'fase') ? E.fase : outros.length ? nomeDe(outros[0], E[outros[0]]) : 'Pipeline completo';
    $('ov-sub').textContent = P.contexto ? P.contexto() : '';
    $('ov-chips').innerHTML = outros.map(function (k) {
      return '<button type="button" class="fx-ov-chip" data-ov="tira" data-dim="' + k + '" title="tirar ' + esc(ROT[k].toLowerCase()) + ' do recorte">'
        + '<span class="l">' + esc(ROT[k]) + '</span>' + esc(nomeDe(k, E[k])) + IC_XS + '</button>';
    }).join('');
    $('ov-ctx').textContent = 'mesmos filtros da página';
    seletor();
  }
  function seletor() {
    var el = $('ov-seg'); if (!el) return;
    var cont = {}, nomes = [];
    (D.fases || []).forEach(function (x) { cont[x.nome] = x.q; nomes.push(x.nome); });
    if (!D.fases) nomes = (P.fases ? P.fases() : []).slice();
    if (E.fase && nomes.indexOf(E.fase) < 0) nomes.push(E.fase);
    nomes.sort(function (a, b) { return P.ordemFase(a) - P.ordemFase(b); });
    var tot = (D.fases || []).reduce(function (a, x) { return a + x.q; }, 0);
    var b = function (f, rot, n, cor) {
      var on = (f || '') === (E.fase || '');
      return '<button type="button" data-ov="fase" data-fase="' + esc(f) + '"' + (on ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + (f ? ' title="' + esc(f) + '"' : '') + '>'
        + (cor ? '<i style="background:' + esc(cor) + ';"></i>' : '') + esc(rot) + (n != null ? ' <small>' + fINT(n) + '</small>' : '') + '</button>';
    };
    el.innerHTML = b('', 'Todas', D.fases ? tot : null) + nomes.map(function (f) { return b(f, P.curto(f), D.fases ? cont[f] || 0 : null, P.cor(f)); }).join('');
  }

  // ── números-chave ──
  function noRecorte() {
    var ls = lista(); if (!ls) return null;
    if (FunilLista.completa && !FunilLista.completa()) return null;   // a lista mínima não tem tempo de fase, cirurgia, estratégia…
    return ls.filter(function (o) {
      if (tem(E, 'fase') && o.fase !== E.fase) return false;
      if (tem(E, 'cli') && o.cli !== E.cli) return false;
      if (tem(E, 'vend') && (E.vend == null ? o.vend.length > 0 : o.vend.indexOf(E.vend) < 0)) return false;
      return ['estr', 'fam', 'unid'].every(function (k) { return !tem(E, k) || o[k].indexOf(E[k]) >= 0; });
    });
  }
  function kp(k, v, s, cls) {
    return '<div class="fv-dw-kp"><div class="k">' + k + '</div><div class="v' + (cls ? ' ' + cls : '') + '">' + v + '</div><div class="s' + (cls ? ' ' + cls : '') + '">' + s + '</div></div>';
  }
  function kpisHtml() {
    if (!D.fases) return '<div class="fv-dw-kpis">' + ['Valor', 'Oportunidades', 'Ticket médio', 'Na fase · média', 'Cirurgias · 30d'].map(function (k) {
      return kp(k, '<span class="fx-ov-sk"></span>', '&nbsp;');
    }).join('') + '</div>';
    // tudo = o recorte SEM a fase (a consulta das fases); aqui = o recorte aberto
    var tudo = D.fases.reduce(function (a, x) { a.v += x.v; a.q += x.q; return a; }, { v: 0, q: 0 });
    var aqui = tem(E, 'fase') ? (D.fases.filter(function (x) { return x.nome === E.fase; })[0] || { v: 0, q: 0 }) : tudo;
    var pipe = P.total ? P.total() : null;
    var outros = DIMS.filter(function (k) { return tem(E, k); });
    var bl = outros.length ? esc(nomeDe(outros[0], E[outros[0]])) + (outros.length > 1 ? ' +' + (outros.length - 1) : '') : '';
    // parte do todo: a fase dentro do recorte (Proposta = 41% de EXTRAÇÃO); sem recorte, do pipeline
    var parte, deQ;
    if (tem(E, 'fase')) {
      parte = fPct(tudo.v ? aqui.v / tudo.v : null) + (bl ? ' de ' + bl : ' do pipeline');
      deQ = 'de ' + fINT(tudo.q) + (bl ? ' em ' + bl : ' no pipeline');
    } else if (bl) {
      parte = fPct(pipe && pipe.valor ? aqui.v / pipe.valor : null) + ' do pipeline';
      deQ = pipe && pipe.qtde ? 'de ' + fINT(pipe.qtde) + ' no pipeline' : '&nbsp;';
    } else {
      parte = 'todo o pipeline';
      deQ = 'em ' + fINT(D.fases.length) + ' fase' + (D.fases.length === 1 ? '' : 's');
    }
    var h = kp('Valor', esc(fMi(aqui.v)), parte)
      + kp('Oportunidades', fINT(aqui.q), deQ)
      + kp('Ticket médio', esc(aqui.q ? fMi(aqui.v / aqui.q) : '—'), 'por oportunidade');
    var ls = noRecorte();
    if (!ls) h += lista() ? kp('Na fase · média', '—', 'sem a lista completa') + kp('Cirurgias · 30d', '—', 'sem a lista completa')
      : kp('Na fase · média', '<span class="fx-ov-sk"></span>', 'lendo a lista…') + kp('Cirurgias · 30d', '<span class="fx-ov-sk"></span>', '&nbsp;');
    else {
      var comT = ls.filter(function (o) { return o.tf != null; });
      var med = comT.length ? Math.round(comT.reduce(function (a, o) { return a + o.tf; }, 0) / comT.length) : null;
      var par = comT.filter(function (o) { return o.tf > 14; }).length;
      var hoje = iso(new Date()), lim = iso(new Date(Date.now() + 30 * 86400000));
      var cir = ls.filter(function (o) { return o.cir && o.cir >= hoje && o.cir <= lim; });
      h += kp('Na fase · média', med == null ? '—' : fINT(med) + ' dias', par ? fINT(par) + ' parada' + (par === 1 ? '' : 's') + ' há +14 dias' : 'nenhuma parada há +14 dias', par ? 'warn' : '')
        + kp('Cirurgias · 30d', fINT(cir.length), cir.length ? esc(fMi(cir.reduce(function (a, o) { return a + o.v; }, 0))) + ' em oportunidades' : 'nenhuma nos próximos 30 dias');
    }
    return '<div class="fv-dw-kpis">' + h + '</div>';
  }
  function pintarKpis() { var el = $('ov-kpis'); if (el) el.innerHTML = kpisHtml(); }

  // ── seções ──
  function secao(id, titulo) {
    return '<section class="fv-dw-card" id="ov-s-' + id + '"><h4>' + esc(titulo) + '</h4><div class="fx-ov-sec"><div class="fx-ov-sk l"></div><div class="fx-ov-sk l"></div><div class="fx-ov-sk l"></div></div></section>';
  }
  function corpo(id) { var s = $('ov-s-' + id); return s ? s.querySelector('.fx-ov-sec') : null; }
  function errHtml(err) {
    return '<div class="fv-dw-err"><span>Não deu para ler esta parte: <b>' + esc(String((err && err.message) || err).slice(0, 160)) + '</b></span>'
      + '<button type="button" class="fv-act" data-ov="tentar">Tentar de novo</button></div>';
  }
  function erro(id, err) { var c = corpo(id); if (c) c.innerHTML = errHtml(err); }

  // valor do recorte aberto (null até a consulta das fases chegar)
  function totalRecorte() {
    if (!D.fases) return null;
    if (!tem(E, 'fase')) return D.fases.reduce(function (a, x) { return a + x.v; }, 0);
    return (D.fases.filter(function (x) { return x.nome === E.fase; })[0] || { v: 0 }).v;
  }
  // parcial = só o top N do recorte: o % é sobre o recorte inteiro, não sobre as barras
  function pintarBarras(id, itens, dim, parcial) {
    var c = corpo(id); if (!c) return;
    D.itens[dim] = itens;
    if (!itens.length) { c.innerHTML = '<div class="fv-dw-nada">Nada neste recorte.</div>'; return; }
    var tot = parcial ? totalRecorte() : itens.reduce(function (a, x) { return a + x.v; }, 0);
    var max = Math.max.apply(null, itens.map(function (x) { return x.v; }).concat([1]));
    var cor = COR[dim] || '#1272C4';
    c.innerHTML = itens.map(function (x, i) {
      var w = Math.max(2, Math.round(x.v / max * 100));
      var meta = [x.q && dim !== 'estr' ? fINT(x.q) + ' op.' : x.n ? fINT(x.n) + ' fam.' : '', tot ? fPct(x.v / tot) : ''].filter(Boolean).join(' · ');
      var dica = x.nome + ' — ' + fBRL(x.v) + (x.q ? ' · ' + fINT(x.q) + ' oportunidade' + (x.q === 1 ? '' : 's') : '') + (x.sub ? ' · ' + x.sub : '') + ' — clique para estreitar o resumo';
      return '<button type="button" class="fx-ov-b" data-ov="' + (dim === 'fase' ? 'fase' : 'dim') + '" data-dim="' + dim + '" data-i="' + i + '"' + (dim === 'fase' ? ' data-fase="' + esc(x.raw) + '"' : '') + ' title="' + esc(dica) + '">'
        + '<span class="n">' + esc(x.nome) + '</span><span class="v"><small>' + meta + '</small>' + esc(fMi(x.v)) + '</span>'
        + '<span class="t"><i style="width:' + w + '%;background:' + esc(x.cor || cor) + ';"></i></span></button>';
    }).join('');
  }

  function pintarOps() {
    var c = corpo('ops'); if (!c || !D.ops) return;
    if (!D.ops.length) { c.innerHTML = '<div class="fv-dw-nada">Nenhuma oportunidade neste recorte.</div>'; return; }
    var tot = totalRecorte(), hoje = iso(new Date());
    c.innerHTML = D.ops.map(function (o, i) {
      o.lin = window.FunilLista && FunilLista.achar ? FunilLista.achar(o.nome, o.fase, o.cli) : null;
      var l = o.lin, s = [];
      if (!tem(E, 'cli')) s.push(esc(o.cli || '—'));
      if (l && l.vendT && !tem(E, 'vend')) s.push(esc(l.vendT));
      if (l && l.tf != null) s.push('<span' + (l.tf > 14 ? ' class="warn"' : '') + '>' + fINT(l.tf) + ' d na fase</span>');
      if (l && l.cir) s.push((l.cir >= hoje ? 'cirurgia ' : 'cirurgia foi ') + fData(l.cir));
      // recorte por estratégia/família: o valor aqui é a PARTE da oportunidade no recorte
      var parte = l && l.v > o.v * 1.01 ? '<small title="valor da oportunidade inteira">de ' + esc(fMi(l.v)) + '</small>' : tot ? '<small>' + fPct(o.v / tot) + '</small>' : '';
      var badge = tem(E, 'fase') ? '' : '<span class="fv-badge" style="--c:' + esc(P.cor(o.fase)) + ';"><i></i>' + esc(P.curto(o.fase)) + '</span>';
      return '<button type="button" class="fx-ov-op" data-ov="op" data-i="' + i + '" title="' + esc(o.nome) + ' — clique para abrir a ficha do Salesforce">'
        + '<span class="r">' + (i + 1) + '</span>'
        + '<span class="c"><span class="t">' + esc(o.nome || '(sem nome)') + (o.q > 1 ? ' <small>×' + fINT(o.q) + '</small>' : '') + '</span>'
        + '<span class="s">' + badge + s.join(' · ') + '</span></span>'
        + '<span class="v"><b>' + esc(fMi(o.v)) + '</b>' + parte + '</span></button>';
    }).join('')
      + '<button type="button" class="fv-dw-vaz" data-ov="lista">Ver todas na lista de oportunidades</button>';
  }

  // a lista chegou (ou recarregou) com o painel aberto: completa o que dependia dela
  function listaPronta() {
    if (!_dw || !_dw.classList.contains('open') || !E) return;
    if (D.fases) pintarKpis();
    if (D.ops) pintarOps();
  }

  window.FunilResumo = {
    // cfg: { query(dax), filtros() → [predicados DAX], cor(fase), ordemFase(fase), curto(fase),
    //        fases() → [nomes], total() → {valor, qtde}, contexto() → texto do período }
    init: function (cfg) { P = cfg; },
    abrir: abrir,
    fechar: fechar,
    listaPronta: listaPronta,
    aberto: function () { return E ? copia(E) : null; }
  };
})();
