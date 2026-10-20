/* ================================================================
   comercial-funil-analitico.js — aba ANALÍTICO do Funil de
   Oportunidades do Comercial (pages/comercial-funil-analitico.html).

   A Visão Geral mostra ONDE está o pipeline; esta aba mostra O QUE está
   nele: o funil aberto por SKU (produto), família ou estratégia.

   • Mesmo modelo de BI e mesmos filtros da Visão Geral (a página entrega
     o avBase() dela): o total daqui fecha com o funil de lá.
   • O fato é de ITEM, então o SKU é o grão natural. "Oportunidades" de um
     SKU = em quantas oportunidades ele aparece (a medida do modelo conta
     oportunidades distintas). Soma entre FASES (a oportunidade está numa
     fase só), mas NÃO entre SKUs — uma oportunidade com 3 SKUs conta nas 3
     linhas. Por isso o total de cada fase vem de consulta própria.
   • Unidades: só se o fato tiver a coluna de quantidade do item (achada no
     catálogo INFO.VIEW.COLUMNS e provada com um SUM). Sem ela a métrica
     some da tela — nada de número inventado.
   • Clique numa linha, barra ou SKU abre a FICHA do recorte à direita
     (fases, clientes, vendedores, oportunidades com o item); a oportunidade
     abre a ficha do Salesforce por cima (comercial-funil-lista.js).

   A página chama FunilAnalitico.init({...}) e FunilAnalitico.carregar()
   a cada troca de filtro.
   ================================================================ */
(function () {
  'use strict';

  var FATO = 'FAT_OPORTUNIDADES_COTACOES';
  var COL = {
    cod: 'DIM_PRODUTOS[CODIGO_PRODUTO]', prod: 'DIM_PRODUTOS[PRODUTO]',
    fam: 'DIM_FAMILIAS[FAMILIA]', estr: 'DIM_FAMILIAS[ESTRATEGIA]',
    fase: FATO + '[FASE]', nome: FATO + '[NOME]', cli: 'DIM_CLIENTES[CLIENTE_FORNECEDOR]',
    vend: 'DIM_VENDEDORES[VENDEDOR]', cir: FATO + '[DATA_CIRURGIA]', cria: FATO + '[DATA_DE_CRIACAO]', tf: FATO + '[tempo_fase]'
  };
  var M_V = '[Preco total oportunidades]', M_Q = '[quantidade oportunidades]';
  // coluna de quantidade do item no fato ("QUANTIDADE", "QTD_ITEM"…)
  var RX_UNID = /^(quantidade|qtd|qtde|quantity)([ _]?(do[ _]?)?(item|itens|produto))?$/i;
  var CHAVE_UNID = 'bio_cf_unid';
  var PASSO = 60;
  var ROT = { sku: 'SKU', fam: 'Família', estr: 'Estratégia' };
  var MET = { v: 'Valor', q: 'Oportunidades', u: 'Unidades' };

  var P = null;   // dependências da página (init)
  var ST = { seq: 0, grupo: 'sku', met: 'v', busca: '', ord: null, lim: PASSO, U: undefined, skus: null, fases: null, grupos: {}, erro: null };

  // ── utilitários ─────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function nf(v, d) { return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function fINT(v) { return Math.round(Number(v) || 0).toLocaleString('pt-BR'); }
  function fBRL(v) { return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function fMi(v) {
    var a = Math.abs(v || 0);
    if (a >= 1e6) return 'R$ ' + nf(v / 1e6, 2) + ' Mi';
    if (a >= 1e3) return 'R$ ' + nf(v / 1e3, 0) + 'k';
    return 'R$ ' + nf(v, 0);
  }
  function fPct(x) { return x == null || !isFinite(x) ? '—' : nf(x * 100, 1) + '%'; }
  function fDia(iso) { if (!iso) return ''; var p = String(iso).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0].slice(2) : String(iso); }
  function hexA(hex, a) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || ''); if (!m) return hex;
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
  }
  // valor da linha do executeQueries pela coluna (a chave vem "TABELA[COL]" ou "[apelido]")
  function val(r, nome) {
    var alvo = '[' + nome.toLowerCase() + ']';
    for (var k in r) if (k.toLowerCase().slice(-alvo.length) === alvo) return r[k];
    return null;
  }
  function num(x) { return x == null || x === '' || isNaN(Number(x)) ? 0 : Number(x); }
  function dia(v) { if (v == null || v === '') return null; var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v)); return m ? m[1] + '-' + m[2] + '-' + m[3] : null; }
  function listaDe(v) {
    if (v == null || v === '') return [];
    return String(v).split('|').map(function (x) { return x.trim(); }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  }
  function diasDe(v) {
    var ns = listaDe(v).map(function (x) { var m = /-?\d+(?:[.,]\d+)?/.exec(x); return m ? Math.round(Number(m[0].replace(',', '.'))) : null; })
      .filter(function (x) { return x != null && isFinite(x); });
    return ns.length ? Math.max.apply(null, ns) : null;
  }
  function nomeDe(v, vazio) { return v == null || String(v).trim() === '' ? (vazio || '(em branco)') : String(v); }
  function sessao(k, v) {
    try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { }
    return null;
  }
  function fUn(v) { return fINT(v) + ' un.'; }

  // ══════════════════════════════════════════════════════════════
  // CONSULTAS (Power BI)
  // ══════════════════════════════════════════════════════════════
  function meds() { return '"v", ' + M_V + ', "q", ' + M_Q + (ST.U ? ', "u", CALCULATE(SUM(' + ST.U + '))' : ''); }
  function calc(inner, extra) { var f = P.filtros().concat(extra || []); return f.length ? 'CALCULATETABLE(' + inner + ', ' + f.join(', ') + ')' : inner; }
  function agrupa(cols, ext) {
    return 'FILTER(ADDCOLUMNS(SUMMARIZE(' + FATO + ', ' + cols.join(', ') + '), ' + meds() + (ext && ext.length ? ', ' + ext.join(', ') : '') + '), [q] > 0 || NOT ISBLANK([v]))';
  }
  function topn(n, inner) { return 'EVALUATE TOPN(' + n + ', ' + inner + ', [v], DESC)'; }
  function daxSku() { return 'EVALUATE ' + calc(agrupa([COL.cod, COL.prod, COL.fam, COL.estr, COL.fase])); }
  function daxFases() { return 'EVALUATE ' + calc(agrupa([COL.fase])); }
  function daxGrupo(g) { return 'EVALUATE ' + calc(agrupa(g === 'fam' ? [COL.fam, COL.estr, COL.fase] : [COL.estr, COL.fase])); }

  // a coluna de unidades: catálogo → nome que casa → prova com SUM. Fica
  // guardada na sessão (só quando o catálogo respondeu: falha passageira
  // não desliga a métrica para sempre)
  async function unidades() {
    if (ST.U !== undefined) return ST.U;
    var g = sessao(CHAVE_UNID);
    if (g !== null) { ST.U = g ? FATO + '[' + g + ']' : null; return ST.U; }
    var col = null, catalogo = false;
    try {
      var rows = await P.query('EVALUATE SELECTCOLUMNS(INFO.VIEW.COLUMNS(), "T", [Table], "N", [Name])');
      catalogo = true;
      col = (rows || []).filter(function (r) { return String(val(r, 'T') || '').toUpperCase() === FATO; })
        .map(function (r) { return String(val(r, 'N') || ''); })
        .filter(function (n) { return RX_UNID.test(n); })[0] || null;
    } catch (e) {
      console.warn('[Funil · analítico] catálogo fechado, tentando QUANTIDADE:', e.message);
      col = 'QUANTIDADE';
    }
    if (col) {
      try { await P.query('EVALUATE ROW("u", SUM(' + FATO + '[' + col + ']))'); }
      catch (e) { console.warn('[Funil · analítico] sem unidades (' + col + '):', e.message); col = null; }
    }
    ST.U = col ? FATO + '[' + col + ']' : null;
    if (catalogo) sessao(CHAVE_UNID, col || '');
    return ST.U;
  }

  // ══════════════════════════════════════════════════════════════
  // MONTAGEM
  // ══════════════════════════════════════════════════════════════
  function cel(r) { return { v: num(val(r, 'v')), q: num(val(r, 'q')), u: num(val(r, 'u')) }; }
  function soma(o, c) { o.v += c.v; o.q += c.q; o.u += c.u; }
  function vazio() { return { v: 0, q: 0, u: 0 }; }

  function montarSkus(rows) {
    var map = {}, out = [];
    (rows || []).forEach(function (r) {
      var cod = val(r, 'CODIGO_PRODUTO'), prod = val(r, 'PRODUTO'), fase = val(r, 'FASE');
      if (fase == null || fase === '') return;
      var k = JSON.stringify([cod == null ? null : cod, prod == null ? null : prod]);
      var o = map[k];
      if (!o) {
        o = map[k] = { id: k, g: 'sku', cod: cod, prodRaw: prod, nome: nomeDe(prod, '(produto sem nome)'), fams: [], estrs: [], f: {}, v: 0, q: 0, u: 0 };
        out.push(o);
      }
      var fam = val(r, 'FAMILIA'), es = val(r, 'ESTRATEGIA');
      if (fam != null && fam !== '' && o.fams.indexOf(String(fam)) < 0) o.fams.push(String(fam));
      if (es != null && es !== '' && o.estrs.indexOf(String(es)) < 0) o.estrs.push(String(es));
      var c = cel(r);
      soma(o.f[fase] = o.f[fase] || vazio(), c); soma(o, c);
    });
    out.forEach(function (o) {
      o.sub = [o.cod != null && o.cod !== '' ? 'cód. ' + o.cod : 'sem código', o.fams.join(' / ') || 'sem família', o.estrs.join(' / ')].filter(Boolean).join(' · ');
      o.busca = norm([o.nome, o.cod, o.fams.join(' '), o.estrs.join(' ')].join(' '));
    });
    return out;
  }
  function montarFases(rows) {
    return (rows || []).map(function (r) { var c = cel(r); c.nome = val(r, 'FASE'); return c; })
      .filter(function (x) { return x.nome != null && x.nome !== '' && (x.q > 0 || x.v); })
      .sort(function (a, b) { return P.ordemFase(a.nome) - P.ordemFase(b.nome) || b.v - a.v; });
  }
  function montarGrupo(g, rows) {
    var map = {}, out = [];
    (rows || []).forEach(function (r) {
      var fase = val(r, 'FASE'); if (fase == null || fase === '') return;
      var raw = val(r, g === 'fam' ? 'FAMILIA' : 'ESTRATEGIA'), k = raw == null ? '' : String(raw);
      var o = map[k];
      if (!o) { o = map[k] = { id: g + '|' + k, g: g, raw: raw, nome: nomeDe(raw), estrs: [], f: {}, v: 0, q: 0, u: 0 }; out.push(o); }
      if (g === 'fam') { var es = val(r, 'ESTRATEGIA'); if (es != null && es !== '' && o.estrs.indexOf(String(es)) < 0) o.estrs.push(String(es)); }
      var c = cel(r);
      soma(o.f[fase] = o.f[fase] || vazio(), c); soma(o, c);
    });
    // quantos SKUs (e famílias) cada linha junta: sai da consulta por SKU
    out.forEach(function (o) {
      var skus = (ST.skus || []).filter(function (s) { return (g === 'fam' ? s.fams : s.estrs).indexOf(o.nome) >= 0 || (o.raw == null && !(g === 'fam' ? s.fams : s.estrs).length); });
      var fams = {}; skus.forEach(function (s) { s.fams.forEach(function (f) { fams[f] = 1; }); });
      o.nSku = skus.length; o.nFam = Object.keys(fams).length;
      o.sub = g === 'fam'
        ? [o.estrs.join(' / ') || 'sem estratégia', ST.skus ? fINT(o.nSku) + ' SKU' + (o.nSku === 1 ? '' : 's') : ''].filter(Boolean).join(' · ')
        : (ST.skus ? fINT(o.nFam) + ' famíli' + (o.nFam === 1 ? 'a' : 'as') + ' · ' + fINT(o.nSku) + ' SKU' + (o.nSku === 1 ? '' : 's') : '');
      o.busca = norm([o.nome, o.estrs.join(' ')].join(' '));
    });
    return out;
  }

  // ══════════════════════════════════════════════════════════════
  // CARGA
  // ══════════════════════════════════════════════════════════════
  async function carregar() {
    if (!P) return;
    var meu = ++ST.seq;
    ST.skus = null; ST.fases = null; ST.grupos = {}; ST.erro = null; ST.lim = PASSO;
    pintarTudo();
    try { await unidades(); } catch (e) { ST.U = null; }
    if (meu !== ST.seq) return;
    var r;
    try { r = await Promise.all([P.query(daxSku()), P.query(daxFases())]); }
    catch (e) {
      // a soma das unidades caiu (tipo da coluna, permissão): segue sem ela
      if (ST.U) {
        console.warn('[Funil · analítico] consulta com unidades caiu, indo sem:', e.message);
        ST.U = null;
        try { r = await Promise.all([P.query(daxSku()), P.query(daxFases())]); } catch (e2) { e = e2; r = null; }
      }
      if (!r) { if (meu === ST.seq) { ST.erro = e.message || String(e); pintarTudo(); } return; }
    }
    if (meu !== ST.seq) return;
    ST.skus = montarSkus(r[0]); ST.fases = montarFases(r[1]);
    if (ST.met === 'u' && !ST.U) ST.met = 'v';
    pintarTudo();
    if (ST.grupo !== 'sku') carregarGrupo(ST.grupo);
  }
  async function carregarGrupo(g) {
    var meu = ST.seq;
    if (ST.grupos[g]) return;
    ST.grupos[g] = { lendo: true };
    var rows;
    try { rows = await P.query(daxGrupo(g)); }
    catch (e) { if (meu === ST.seq) { ST.grupos[g] = { erro: e.message || String(e) }; if (ST.grupo === g) pintarMatriz(); } return; }
    if (meu !== ST.seq) return;
    ST.grupos[g] = { ls: montarGrupo(g, rows) };
    if (ST.grupo === g) pintarMatriz();
  }

  // ══════════════════════════════════════════════════════════════
  // PINTURA DA PÁGINA
  // ══════════════════════════════════════════════════════════════
  function fasesVisiveis() {
    var nomes = (ST.fases || []).map(function (f) { return f.nome; });
    (ST.skus || []).forEach(function (s) { Object.keys(s.f).forEach(function (n) { if (nomes.indexOf(n) < 0) nomes.push(n); }); });
    return nomes.sort(function (a, b) { return P.ordemFase(a) - P.ordemFase(b); });
  }
  function totais() {
    return (ST.fases || []).reduce(function (a, f) { soma(a, f); return a; }, vazio());
  }
  function aviso(id, html) { var el = $(id); if (el) el.innerHTML = html; }
  function carregando() { return '<div class="fx-empty">Carregando…</div>'; }
  function erroHtml() { return '<div class="fx-empty" style="color:#B54545;">Erro: ' + esc(String(ST.erro).slice(0, 180)) + '</div>'; }
  function pintarTudo() { pintarHero(); pintarTop(); pintarColunas(); pintarMatriz(); pintarMetricas(); }

  // ── herói: SKUs no pipeline + curva ABC ──
  function abc(skus, tot) {
    var acc = 0, cls = { A: { n: 0, v: 0 }, B: { n: 0, v: 0 }, C: { n: 0, v: 0 } };
    skus.forEach(function (s) {
      var antes = tot ? acc / tot : 1;
      var c = antes < 0.8 ? 'A' : antes < 0.95 ? 'B' : 'C';
      cls[c].n++; cls[c].v += s.v; acc += s.v; s.abc = c;
    });
    return cls;
  }
  var COR_ABC = { A: '#4FD98D', B: '#4596CC', C: 'rgba(255,255,255,.32)' };
  function pintarHero() {
    var el = $('an-hero'); if (!el) return;
    var k = '<span class="fx-hero-k">SKUS NO PIPELINE</span>';
    if (ST.erro) { el.innerHTML = k + '<div class="fx-empty" style="color:#FFB4B4;">Erro: ' + esc(String(ST.erro).slice(0, 160)) + '</div>'; return; }
    if (!ST.skus) { el.innerHTML = k + '<div class="fx-hero-vrow"><span class="fx-hero-v">—</span></div><div class="fx-empty" style="color:#8FAECB;">Carregando…</div>'; return; }
    var skus = ST.skus.filter(function (s) { return s.v > 0; }).sort(function (a, b) { return b.v - a.v; });
    var t = totais(), n = skus.length;
    if (!n) { el.innerHTML = k + '<div class="fx-empty" style="color:#8FAECB;">Sem itens no período.</div>'; return; }
    var cls = abc(skus, t.v);
    var pares = ST.skus.reduce(function (a, s) { return a + s.q; }, 0);
    var maior = skus[0];
    var bar = ['A', 'B', 'C'].map(function (c) { return cls[c].n ? '<span style="width:' + (cls[c].n / n * 100).toFixed(1) + '%;background:' + COR_ABC[c] + ';"></span>' : ''; }).join('');
    var leg = ['A', 'B', 'C'].filter(function (c) { return cls[c].n; }).map(function (c) {
      return '<span><i style="background:' + COR_ABC[c] + ';"></i>' + c + ' · ' + fINT(cls[c].n) + ' SKU' + (cls[c].n === 1 ? '' : 's') + ' = ' + fPct(t.v ? cls[c].v / t.v : null) + ' do valor</span>';
    }).join('');
    el.innerHTML = k
      + '<div class="fx-hero-vrow"><span class="fx-hero-v">' + fINT(n) + ' SKU' + (n === 1 ? '' : 's') + '</span><span class="fx-hero-q">' + esc(fMi(t.v)) + ' em ' + fINT(t.q) + ' oportunidade' + (t.q === 1 ? '' : 's') + '</span></div>'
      + '<div class="fx-hero-bar" title="curva ABC: a barra divide os SKUs; a legenda diz quanto do valor cada classe carrega">' + bar + '</div>'
      + '<div class="fx-hero-leg">' + leg + '</div>'
      + '<div class="fx-hero-spacer"></div>'
      + '<div class="fx-hero-foot">'
      +   '<div class="an-hf-maior" data-an-sku="' + esc(maior.id) + '" role="button" tabindex="0" title="' + esc(maior.nome + ' — ' + maior.sub) + ' — clique para a ficha do SKU"><div class="l">MAIOR SKU</div><div class="v">' + esc(maior.nome) + '</div><div class="s">' + esc(fMi(maior.v)) + ' · ' + fPct(t.v ? maior.v / t.v : null) + '</div></div>'
      +   '<div><div class="l">SKUS POR OPORTUNIDADE</div><div class="v">' + (t.q ? nf(pares / t.q, 1) : '—') + '</div><div class="s">média de itens distintos</div></div>'
      +   (ST.U
          ? '<div><div class="l">UNIDADES</div><div class="v gr">' + fINT(t.u) + '</div><div class="s">' + (t.u ? esc(fBRL(t.v / t.u)) + ' / un. em média' : '&nbsp;') + '</div></div>'
          : '<div><div class="l">VALOR MÉDIO POR SKU</div><div class="v gr">' + esc(fMi(t.v / n)) + '</div><div class="s">&nbsp;</div></div>')
      + '</div>';
  }

  // ── top 10 SKUs: a barra do SKU dividida pelas fases ──
  function pintarTop() {
    var el = $('an-top'); if (!el) return;
    var leg = $('an-top-leg');
    if (ST.erro) { el.innerHTML = erroHtml(); return; }
    if (!ST.skus) { el.innerHTML = carregando(); return; }
    var fs = fasesVisiveis();
    if (leg) leg.innerHTML = fs.map(function (f) { return '<span><i style="background:' + esc(P.cor(f)) + ';"></i>' + esc(P.curto(f)) + '</span>'; }).join('');
    var todos = ST.skus.filter(function (s) { return s.v > 0; }).sort(function (a, b) { return b.v - a.v; });
    var top = todos.slice(0, 10), t = totais();
    var somaTop = top.reduce(function (a, s) { return a + s.v; }, 0);
    var sub = $('an-top-sub');
    if (sub) sub.textContent = top.length ? 'os ' + top.length + ' maiores = ' + fPct(t.v ? somaTop / t.v : null) + ' do pipeline · a barra é dividida pelas fases' : 'valor dos SKUs no pipeline';
    if (!top.length) { el.innerHTML = '<div class="fx-empty">Sem itens no período.</div>'; return; }
    var max = top[0].v || 1;
    el.innerHTML = top.map(function (s) {
      var segs = fs.filter(function (f) { return s.f[f] && s.f[f].v > 0; }).map(function (f) {
        return '<span style="flex:' + (s.f[f].v / s.v).toFixed(4) + ' 1 0;background:' + esc(P.cor(f)) + ';"></span>';
      }).join('');
      var dica = s.nome + ' — ' + s.sub + '\n' + fBRL(s.v) + ' · ' + fINT(s.q) + ' oportunidade' + (s.q === 1 ? '' : 's') + (ST.U ? ' · ' + fUn(s.u) : '') + '\n'
        + fs.filter(function (f) { return s.f[f] && s.f[f].v > 0; }).map(function (f) { return P.curto(f) + ': ' + fMi(s.f[f].v); }).join(' · ') + '\nclique para a ficha do SKU';
      return '<div class="fx-brow" data-an-sku="' + esc(s.id) + '" role="button" tabindex="0" title="' + esc(dica) + '"><span class="fx-bname">' + esc(s.nome) + '</span>'
        + '<div class="fx-btrack"><div class="fx-bfill fx-bstk" style="width:' + Math.max(Math.round(s.v / max * 100), 3) + '%;background:#C8D6E4;">' + segs + '</div></div>'
        + '<span class="fx-bval">' + esc(fMi(s.v)) + '</span></div>';
    }).join('');
  }

  // ── SKUs em cada fase: uma coluna por fase, os maiores SKUs dela ──
  var POR_FASE = 6;
  function pintarColunas() {
    var el = $('an-fases'); if (!el) return;
    if (ST.erro) { el.innerHTML = erroHtml(); return; }
    if (!ST.skus) { el.innerHTML = carregando(); return; }
    var fs = fasesVisiveis();
    if (!fs.length) { el.innerHTML = '<div class="fx-empty">Sem itens no período.</div>'; return; }
    var tf = {}; (ST.fases || []).forEach(function (f) { tf[f.nome] = f; });
    el.style.setProperty('--cols', Math.min(fs.length, 4));
    el.innerHTML = fs.map(function (f) {
      var cor = P.cor(f), tot = tf[f] || vazio();
      var ls = ST.skus.filter(function (s) { return s.f[f] && (s.f[f].v > 0 || s.f[f].q > 0); })
        .sort(function (a, b) { return b.f[f].v - a.f[f].v; });
      var max = ls.length ? ls[0].f[f].v || 1 : 1;
      var itens = ls.slice(0, POR_FASE).map(function (s) {
        var c = s.f[f];
        return '<button type="button" class="an-fc-i" data-an-sku="' + esc(s.id) + '" data-an-fase="' + esc(f) + '" title="' + esc(s.nome + ' — ' + s.sub + '\n' + fBRL(c.v) + ' · ' + fINT(c.q) + ' oportunidade' + (c.q === 1 ? '' : 's') + (ST.U ? ' · ' + fUn(c.u) : '') + '\nclique para a ficha do SKU nesta fase') + '">'
          + '<span class="n">' + esc(s.nome) + '</span><span class="v">' + esc(fMi(c.v)) + '</span>'
          + '<span class="t"><i style="width:' + Math.max(2, Math.round(c.v / max * 100)) + '%;"></i></span>'
          + '<span class="p">' + fPct(tot.v ? c.v / tot.v : null) + ' da fase · ' + fINT(c.q) + ' op.' + (ST.U ? ' · ' + fUn(c.u) : '') + '</span></button>';
      }).join('');
      return '<div class="an-fc" style="--c:' + esc(cor) + ';--c-a:' + esc(hexA(cor, 0.14)) + ';">'
        + '<div class="an-fc-h"><i></i><span class="n" title="' + esc(f) + '">' + esc(f) + '</span></div>'
        + '<div class="an-fc-m"><b>' + esc(fMi(tot.v)) + '</b> · ' + fINT(tot.q) + ' op. · ' + fINT(ls.length) + ' SKU' + (ls.length === 1 ? '' : 's') + '</div>'
        + '<div class="an-fc-l">' + (itens || '<div class="fx-empty">Nenhum item.</div>') + '</div>'
        + (ls.length > POR_FASE ? '<button type="button" class="an-fc-mais" data-an-ordfase="' + esc(f) + '">ver os ' + fINT(ls.length) + ' na tabela →</button>' : '')
        + '</div>';
    }).join('');
  }

  // ── métrica: o botão Unidades só existe se o modelo tiver a coluna ──
  function pintarMetricas() {
    var seg = $('an-met'); if (!seg) return;
    var bu = seg.querySelector('[data-an-met="u"]');
    if (bu) bu.hidden = !ST.U;
    seg.querySelectorAll('button[data-an-met]').forEach(function (b) {
      var on = b.getAttribute('data-an-met') === ST.met;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var sg = $('an-grupo');
    if (sg) sg.querySelectorAll('button[data-an-grupo]').forEach(function (b) {
      var on = b.getAttribute('data-an-grupo') === ST.grupo;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // ══════════════════════════════════════════════════════════════
  // TABELA: linhas (SKU / família / estratégia) × fases
  // ══════════════════════════════════════════════════════════════
  function linhasDoGrupo() {
    if (ST.grupo === 'sku') return ST.skus;
    var g = ST.grupos[ST.grupo];
    return g && g.ls ? g.ls : null;
  }
  function filtradas(ls) {
    var b = norm(ST.busca).trim();
    return b ? ls.filter(function (o) { return b.split(/\s+/).every(function (p) { return o.busca.indexOf(p) >= 0; }); }) : ls.slice();
  }
  function m(c) { return c ? c[ST.met] || 0 : 0; }
  function ordenar(ls) {
    var o = ST.ord;
    if (!o) return ls.sort(function (a, b) { return m(b) - m(a) || b.v - a.v; });
    return ls.sort(function (a, b) {
      if (o.k === 'nome') return o.d * a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true });
      var x = o.k === 'tot' ? m(a) : m(a.f[o.k]), y = o.k === 'tot' ? m(b) : m(b.f[o.k]);
      return o.d * (x - y) || b.v - a.v;
    });
  }
  function fmtMet(v, met) { return met === 'v' ? fMi(v) : met === 'u' ? fINT(v) : fINT(v); }
  function subMet(c, met) {
    if (!c) return '';
    return met === 'v' ? fINT(c.q) + ' op.' : fMi(c.v);
  }
  function pintarMatriz() {
    var head = $('an-head'), body = $('an-body'), foot = $('an-foot'), mais = $('an-mais');
    if (!body) return;
    pintarMetricas();
    var rot = ROT[ST.grupo], info = $('an-info'), sub = $('an-mx-sub');
    if (sub) sub.textContent = 'cada linha é ' + (ST.grupo === 'sku' ? 'um SKU' : ST.grupo === 'fam' ? 'uma família' : 'uma estratégia')
      + ' · cada coluna, uma fase do funil · ' + MET[ST.met].toLowerCase() + ' na célula'
      + (ST.met === 'q' ? ' (em quantas oportunidades aparece)' : '') + ' · clique na linha para a ficha';
    var fs = fasesVisiveis();
    var cab = function (k, l, extra) {
      var on = ST.ord && ST.ord.k === k, seta = on ? (ST.ord.d === -1 ? '▼' : '▲') : '';
      return '<th class="ord' + (k === 'nome' ? ' tx' : '') + '" data-an-ord="' + esc(k) + '"' + (extra || '') + '>' + l + (seta ? '<span class="seta">' + seta + '</span>' : '') + '</th>';
    };
    var pctRot = ST.met === 'v' ? '% do valor' : ST.met === 'q' ? '% das oport.' : '% das unid.';
    if (head) head.innerHTML = '<tr>' + cab('nome', esc(rot))
      + fs.map(function (f) { return cab(f, '<i class="an-dot" style="background:' + esc(P.cor(f)) + ';"></i>' + esc(P.curto(f)), ' title="' + esc(f) + '"'); }).join('')
      + cab('tot', 'Total') + '<th title="' + (ST.met === 'q' ? 'em quantas das oportunidades do recorte o item aparece' : 'parte do total do recorte') + '">' + pctRot + '</th></tr>';
    var col = fs.length + 3;
    if (ST.erro) { body.innerHTML = '<tr><td colspan="' + col + '" class="ng-vz" style="color:#B54545;">Erro: ' + esc(String(ST.erro).slice(0, 180)) + '</td></tr>'; if (foot) foot.innerHTML = ''; if (mais) mais.hidden = true; if (info) info.textContent = '—'; return; }
    var g = ST.grupo !== 'sku' ? ST.grupos[ST.grupo] : null;
    if (g && g.erro) { body.innerHTML = '<tr><td colspan="' + col + '" class="ng-vz" style="color:#B54545;">Erro: ' + esc(String(g.erro).slice(0, 180)) + '</td></tr>'; if (foot) foot.innerHTML = ''; if (mais) mais.hidden = true; return; }
    var ls = linhasDoGrupo();
    if (!ls) { body.innerHTML = '<tr><td colspan="' + col + '" class="ng-vz">Carregando…</td></tr>'; if (foot) foot.innerHTML = ''; if (mais) mais.hidden = true; if (info) info.textContent = '—'; return; }
    var t = totais(), tm = t[ST.met] || 0;
    var rows = ordenar(filtradas(ls));
    // o tom da célula: o maior valor de fase da tabela inteira (não só da página)
    var max = 0;
    rows.forEach(function (o) { fs.forEach(function (f) { var x = m(o.f[f]); if (x > max) max = x; }); });
    var vis = rows.slice(0, ST.lim);
    if (!rows.length) body.innerHTML = '<tr><td colspan="' + col + '" class="ng-vz">' + (ls.length ? 'Nada casa com a busca.' : 'Sem itens no período.') + '</td></tr>';
    else body.innerHTML = vis.map(function (o) {
      var tds = fs.map(function (f) {
        var c = o.f[f], x = m(c);
        if (!c || (!x && !c.v)) return '<td class="an-c z">—</td>';
        var a = max ? 0.05 + 0.27 * x / max : 0.05;
        return '<td class="an-c" style="background:' + esc(hexA(P.cor(f), a.toFixed(3))) + ';" title="' + esc(o.nome + ' · ' + f + '\n' + fBRL(c.v) + ' · ' + fINT(c.q) + ' oportunidade' + (c.q === 1 ? '' : 's') + (ST.U ? ' · ' + fUn(c.u) : '')) + '">'
          + '<b>' + esc(fmtMet(x, ST.met)) + '</b><span>' + esc(subMet(c, ST.met)) + '</span></td>';
      }).join('');
      return '<tr data-an-row="' + esc(o.id) + '" tabindex="0" title="' + esc(o.nome) + ' — clique para a ficha">'
        + '<td class="nm"><span class="t">' + esc(o.nome) + '</span><span class="s">' + esc(o.sub || '') + '</span></td>' + tds
        + '<td class="an-c an-tot"><b>' + esc(fmtMet(m(o), ST.met)) + '</b><span>' + esc(subMet(o, ST.met)) + '</span></td>'
        + '<td><span class="fx-pct">' + fPct(tm ? m(o) / tm : null) + '</span></td></tr>';
    }).join('');
    // rodapé: o total de cada fase vem de consulta própria (oportunidade conta 1 vez)
    if (foot) foot.innerHTML = rows.length ? '<tr><td class="nm" title="total do recorte: uma oportunidade com vários itens conta UMA vez aqui e uma vez em cada linha">Total do recorte</td>'
      + fs.map(function (f) { var c = (ST.fases || []).filter(function (x) { return x.nome === f; })[0] || vazio(); return '<td class="an-c"><b>' + esc(fmtMet(m(c), ST.met)) + '</b><span>' + esc(subMet(c, ST.met)) + '</span></td>'; }).join('')
      + '<td class="an-c"><b>' + esc(fmtMet(tm, ST.met)) + '</b><span>' + esc(subMet(t, ST.met)) + '</span></td><td><span class="fx-pct">100%</span></td></tr>' : '';
    if (mais) {
      var resta = rows.length - vis.length;
      mais.hidden = resta <= 0;
      mais.textContent = resta > 0 ? 'Mostrar mais ' + fINT(Math.min(PASSO, resta)) + ' (faltam ' + fINT(resta) + ')' : '';
    }
    if (info) info.textContent = rows.length === ls.length
      ? fINT(ls.length) + ' ' + (ST.grupo === 'sku' ? 'SKU' + (ls.length === 1 ? '' : 's') : ST.grupo === 'fam' ? 'famíli' + (ls.length === 1 ? 'a' : 'as') : 'estratégi' + (ls.length === 1 ? 'a' : 'as'))
      : fINT(rows.length) + ' de ' + fINT(ls.length);
  }

  function excel() {
    if (typeof XLSX === 'undefined') { alert('Biblioteca de exportação não carregou.'); return; }
    var ls = linhasDoGrupo(); if (!ls) return;
    var fs = fasesVisiveis(), rows = ordenar(filtradas(ls)), U = !!ST.U;
    var cab = ST.grupo === 'sku' ? ['Código', 'Produto', 'Família', 'Estratégia'] : ST.grupo === 'fam' ? ['Família', 'Estratégia', 'SKUs'] : ['Estratégia', 'Famílias', 'SKUs'];
    var mets = U ? ['Valor', 'Oportunidades', 'Unidades'] : ['Valor', 'Oportunidades'];
    fs.concat(['Total']).forEach(function (f) { mets.forEach(function (mm) { cab.push(f + ' · ' + mm); }); });
    cab.push('% do valor');
    var t = totais();
    var aoa = [cab].concat(rows.map(function (o) {
      var l = ST.grupo === 'sku' ? [o.cod == null ? '' : o.cod, o.nome, o.fams.join(' / '), o.estrs.join(' / ')]
        : ST.grupo === 'fam' ? [o.nome, o.estrs.join(' / '), o.nSku || 0] : [o.nome, o.nFam || 0, o.nSku || 0];
      fs.map(function (f) { return o.f[f] || vazio(); }).concat([o]).forEach(function (c) {
        l.push(Math.round(c.v * 100) / 100, c.q); if (U) l.push(c.u);
      });
      l.push(t.v ? Math.round(o.v / t.v * 10000) / 100 : '');
      return l;
    }));
    var ws = XLSX.utils.aoa_to_sheet(aoa), wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Analítico');
    XLSX.writeFile(wb, 'funil_analitico_' + ({ sku: 'sku', fam: 'familia', estr: 'estrategia' })[ST.grupo] + '.xlsx');
  }

  // ══════════════════════════════════════════════════════════════
  // FICHA DO RECORTE (à direita) — SKU, família ou estratégia
  // ══════════════════════════════════════════════════════════════
  var IC_X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var FC = { o: null, fase: '', seq: 0, d: {} };
  var _dw = null, _ov = null, _volta = null;

  function montar() {
    if (_dw) return;
    _ov = document.createElement('div'); _ov.className = 'fv-dw-ov fx-ovw-ov';
    _dw = document.createElement('aside'); _dw.className = 'fv-dw fx-ovw';
    _dw.setAttribute('role', 'dialog'); _dw.setAttribute('aria-modal', 'true'); _dw.setAttribute('aria-labelledby', 'an-dw-tt');
    _dw.innerHTML =
        '<div class="fv-dw-head">'
      +   '<div class="fv-dw-hl"><div class="fv-dw-k" id="an-dw-k"></div><h2 class="fv-dw-tt" id="an-dw-tt"></h2>'
      +   '<div class="fv-dw-sub" id="an-dw-sub"></div>'
      +   '<div class="fv-seg fx-ov-seg" id="an-dw-seg" role="group" aria-label="Fase da ficha"></div></div>'
      +   '<button type="button" class="fv-dw-x" data-an-dw="fechar" aria-label="Fechar a ficha">' + IC_X + '</button>'
      + '</div>'
      + '<div class="fv-dw-body" id="an-dw-body"></div>'
      + '<div class="fv-dw-foot"><span class="fv-dw-lido" id="an-dw-ctx"></span><button type="button" class="fv-dw-btn" data-an-dw="fechar">Fechar</button></div>';
    document.body.appendChild(_ov); document.body.appendChild(_dw);
    _ov.addEventListener('click', fechar);
    _dw.addEventListener('click', cliqueFicha);
    // captura: com a ficha do Salesforce aberta por cima, o Esc fecha só ela
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _dw.classList.contains('open') && !document.querySelector('.fv-dw.open:not(.fx-ovw)')) fechar();
    }, true);
  }
  function acharLinha(id) {
    var ls = [].concat(ST.skus || []);
    ['fam', 'estr'].forEach(function (g) { if (ST.grupos[g] && ST.grupos[g].ls) ls = ls.concat(ST.grupos[g].ls); });
    return ls.filter(function (o) { return o.id === id; })[0] || null;
  }
  function abrir(o, fase, origem) {
    if (!o) return;
    montar();
    if (!_dw.classList.contains('open')) _volta = origem || document.activeElement;
    FC.o = o; FC.fase = fase || '';
    _ov.classList.add('open'); _dw.classList.add('open');
    document.documentElement.classList.add('fx-ovw-on');
    carregarFicha();
    $('an-dw-body').scrollTop = 0;
    setTimeout(function () { try { _dw.querySelector('.fv-dw-x').focus(); } catch (e) { } }, 40);
  }
  function fechar() {
    if (!_dw) return;
    FC.seq++;
    _dw.classList.remove('open'); _ov.classList.remove('open');
    document.documentElement.classList.remove('fx-ovw-on');
    FC.o = null;
    if (_volta && _volta.focus && document.contains(_volta)) { try { _volta.focus({ preventScroll: true }); } catch (e) { } }
  }
  function predsDe(o, fase) {
    var p = o.g === 'sku' ? [DaxLit.igual(COL.cod, o.cod), DaxLit.igual(COL.prod, o.prodRaw)]
      : [DaxLit.igual(o.g === 'fam' ? COL.fam : COL.estr, o.raw)];
    if (fase) p.push(DaxLit.igual(COL.fase, fase));
    return p;
  }
  function txt(col) { return 'CALCULATE(CONCATENATEX(SUMMARIZE(' + FATO + ', ' + col + '), ' + col + ', "|", ' + col + ', ASC))'; }
  function daxOps(o, fase, completa) {
    // valor da oportunidade INTEIRA (sem o recorte do item, com os filtros da
    // página): o item é parte dela, e a ficha do Salesforce fala da inteira
    var pf = P.filtros();
    var ext = ['"vt", CALCULATE(' + M_V + ', REMOVEFILTERS(DIM_PRODUTOS), REMOVEFILTERS(DIM_FAMILIAS)' + (pf.length ? ', ' + pf.join(', ') : '') + ')'];
    if (completa) ext.push('"vend", ' + txt(COL.vend), '"tf", ' + txt(COL.tf), '"cir", CALCULATE(MIN(' + COL.cir + '))', '"cria", CALCULATE(MIN(' + COL.cria + '))');
    return topn(40, calc(agrupa([COL.nome, COL.fase, COL.cli], ext), predsDe(o, fase)));
  }
  function daxDim(o, fase, col, n) { return topn(n, calc(agrupa([col]), predsDe(o, fase))); }

  function carregarFicha() {
    var meu = ++FC.seq, o = FC.o, fase = FC.fase;
    FC.d = {};
    cabecalho();
    var h = '<div id="an-dw-kpis">' + kpisHtml() + '</div>';
    if (!fase) h += secao('fases', 'Por fase');
    if (o.g !== 'sku') h += secao('skus', 'Principais SKUs');
    h += secao('ops', 'Oportunidades com ' + (o.g === 'sku' ? 'este SKU' : o.g === 'fam' ? 'esta família' : 'esta estratégia'));
    h += '<div class="fx-ov-grid">' + secao('cli', 'Principais clientes') + secao('vend', 'Vendedores') + '</div>';
    $('an-dw-body').innerHTML = h;
    if (!fase) pintarFasesFicha();
    function vale() { return meu === FC.seq; }
    function falhou(id) { return function (err) { if (vale()) erroSec(id, err); }; }
    P.query(daxOps(o, fase, true)).catch(function (e) {
      console.warn('[Funil · analítico] oportunidades: consulta completa caiu, indo à mínima:', e.message);
      return P.query(topn(40, calc(agrupa([COL.nome, COL.fase, COL.cli]), predsDe(o, fase))));
    }).then(function (rows) {
      if (!vale()) return;
      FC.d.ops = (rows || []).map(function (r) {
        var vt = val(r, 'vt');
        return { nome: String(val(r, 'NOME') == null ? '' : val(r, 'NOME')).trim(), fase: val(r, 'FASE') || '', cli: val(r, 'CLIENTE_FORNECEDOR') || '',
          v: num(val(r, 'v')), q: num(val(r, 'q')), u: num(val(r, 'u')), vt: vt == null ? null : num(vt),
          vend: listaDe(val(r, 'vend')), tf: diasDe(val(r, 'tf')), cir: dia(val(r, 'cir')), cria: dia(val(r, 'cria')) };
      }).sort(function (a, b) { return b.v - a.v; });
      pintarOps();
    }, falhou('ops'));
    if (o.g !== 'sku') P.query(daxDim(o, fase, COL.prod, 10)).then(function (rows) {
      if (!vale()) return;
      barras('skus', (rows || []).map(function (r) { return { nome: nomeDe(val(r, 'PRODUTO'), '(produto sem nome)'), v: num(val(r, 'v')), q: num(val(r, 'q')), u: num(val(r, 'u')) }; }), '#135E97', true);
    }, falhou('skus'));
    [['cli', COL.cli, 8, '#1272C4'], ['vend', COL.vend, 6, '#4596CC']].forEach(function (d) {
      P.query(daxDim(o, fase, d[1], d[2])).then(function (rows) {
        if (!vale()) return;
        var campo = d[1].replace(/^.*\[/, '').replace(']', '');
        barras(d[0], (rows || []).map(function (r) { return { nome: nomeDe(val(r, campo), d[0] === 'vend' ? 'Sem vendedor' : '(em branco)'), v: num(val(r, 'v')), q: num(val(r, 'q')), u: num(val(r, 'u')) }; }), d[3], true);
      }, falhou(d[0]));
    });
  }
  function rotuloGrupo(g) { return g === 'sku' ? 'SKU' : g === 'fam' ? 'Família' : 'Estratégia'; }
  function cabecalho() {
    var o = FC.o;
    $('an-dw-k').textContent = rotuloGrupo(o.g) + ' · análise' + (FC.fase ? ' · ' + P.curto(FC.fase) : '');
    $('an-dw-tt').textContent = o.nome;
    $('an-dw-sub').textContent = o.sub || '';
    $('an-dw-ctx').textContent = (P.contexto ? P.contexto() + ' · ' : '') + 'mesmos filtros da página';
    var fs = fasesVisiveis().filter(function (f) { return o.f[f] && (o.f[f].q > 0 || o.f[f].v); });
    if (FC.fase && fs.indexOf(FC.fase) < 0) fs.push(FC.fase);
    var b = function (f, rot, n, cor) {
      var on = (f || '') === FC.fase;
      return '<button type="button" data-an-dw="fase" data-fase="' + esc(f) + '"' + (on ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + (f ? ' title="' + esc(f) + '"' : '') + '>'
        + (cor ? '<i style="background:' + esc(cor) + ';"></i>' : '') + esc(rot) + ' <small>' + fINT(n) + '</small></button>';
    };
    $('an-dw-seg').innerHTML = b('', 'Todas', o.q) + fs.map(function (f) { return b(f, P.curto(f), (o.f[f] || vazio()).q, P.cor(f)); }).join('');
  }
  function kp(k, v, s) { return '<div class="fv-dw-kp"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>'; }
  function kpisHtml() {
    var o = FC.o, c = FC.fase ? o.f[FC.fase] || vazio() : o, t = totais();
    var base = FC.fase ? (ST.fases || []).filter(function (x) { return x.nome === FC.fase; })[0] || vazio() : t;
    var onde = FC.fase ? 'da fase' : 'do pipeline';
    var h = kp('Valor', esc(fMi(c.v)), fPct(base.v ? c.v / base.v : null) + ' ' + onde)
      + kp('Oportunidades', fINT(c.q), 'em ' + fPct(base.q ? c.q / base.q : null) + ' das oportunidades ' + onde)
      + kp('Ticket', esc(c.q ? fMi(c.v / c.q) : '—'), 'por oportunidade');
    if (ST.U) h += kp('Unidades', fINT(c.u), c.u ? esc(fBRL(c.v / c.u)) + ' / un. em média' : 'sem quantidade no modelo');
    if (!FC.fase) {
      var fs = fasesVisiveis().filter(function (f) { return o.f[f] && o.f[f].v > 0; });
      var fat = o.f['A Faturar'];
      h += kp('A faturar', esc(fat ? fMi(fat.v) : 'R$ 0'), fat ? fPct(o.v ? fat.v / o.v : null) + ' do item já ganho' : 'nada na última fase');
      if (fs.length) { var mx = fs.slice().sort(function (a, b) { return o.f[b].v - o.f[a].v; })[0]; h += kp('Onde mais pesa', esc(P.curto(mx)), fPct(o.v ? o.f[mx].v / o.v : null) + ' do valor do item'); }
    }
    return '<div class="fv-dw-kpis">' + h + '</div>';
  }
  function secao(id, titulo) {
    return '<section class="fv-dw-card" id="an-dw-s-' + id + '"><h4>' + esc(titulo) + '</h4><div class="fx-ov-sec"><div class="fx-ov-sk l"></div><div class="fx-ov-sk l"></div><div class="fx-ov-sk l"></div></div></section>';
  }
  function corpo(id) { var s = $('an-dw-s-' + id); return s ? s.querySelector('.fx-ov-sec') : null; }
  function erroSec(id, err) {
    var c = corpo(id); if (!c) return;
    c.innerHTML = '<div class="fv-dw-err"><span>Não deu para ler esta parte: <b>' + esc(String((err && err.message) || err).slice(0, 160)) + '</b></span>'
      + '<button type="button" class="fv-act" data-an-dw="tentar">Tentar de novo</button></div>';
  }
  function linhaBarra(x, w, cor, tot, attrs) {
    var meta = [x.q ? fINT(x.q) + ' op.' : '', ST.U && x.u ? fUn(x.u) : '', tot ? fPct(x.v / tot) : ''].filter(Boolean).join(' · ');
    return '<' + (attrs ? 'button type="button" ' + attrs : 'div') + ' class="fx-ov-b' + (attrs ? '' : ' nc') + '" title="' + esc(x.nome + ' — ' + fBRL(x.v)) + '">'
      + '<span class="n">' + esc(x.nome) + '</span><span class="v"><small>' + meta + '</small>' + esc(fMi(x.v)) + '</span>'
      + '<span class="t"><i style="width:' + w + '%;background:' + esc(cor) + ';"></i></span></' + (attrs ? 'button' : 'div') + '>';
  }
  function barras(id, itens, cor, parcial) {
    var c = corpo(id); if (!c) return;
    if (!itens.length) { c.innerHTML = '<div class="fv-dw-nada">Nada neste recorte.</div>'; return; }
    itens.sort(function (a, b) { return b.v - a.v; });
    var tot = parcial ? (FC.fase ? (FC.o.f[FC.fase] || vazio()).v : FC.o.v) : itens.reduce(function (a, x) { return a + x.v; }, 0);
    var max = Math.max.apply(null, itens.map(function (x) { return x.v; }).concat([1]));
    c.innerHTML = itens.map(function (x) { return linhaBarra(x, Math.max(2, Math.round(x.v / max * 100)), cor, tot); }).join('');
  }
  // por fase: sai da linha da tabela, sem consulta
  function pintarFasesFicha() {
    var c = corpo('fases'), o = FC.o; if (!c) return;
    var fs = fasesVisiveis().filter(function (f) { return o.f[f] && (o.f[f].v > 0 || o.f[f].q > 0); });
    if (!fs.length) { c.innerHTML = '<div class="fv-dw-nada">Nada neste recorte.</div>'; return; }
    var max = Math.max.apply(null, fs.map(function (f) { return o.f[f].v; }).concat([1]));
    c.innerHTML = fs.map(function (f) {
      var x = { nome: f, v: o.f[f].v, q: o.f[f].q, u: o.f[f].u };
      return linhaBarra(x, Math.max(2, Math.round(x.v / max * 100)), P.cor(f), o.v, 'data-an-dw="fase" data-fase="' + esc(f) + '"');
    }).join('');
  }
  function pintarOps() {
    var c = corpo('ops'); if (!c || !FC.d.ops) return;
    var ops = FC.d.ops;
    if (!ops.length) { c.innerHTML = '<div class="fv-dw-nada">Nenhuma oportunidade neste recorte.</div>'; return; }
    var hoje = new Date(), hISO = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0') + '-' + String(hoje.getDate()).padStart(2, '0');
    c.innerHTML = ops.map(function (op, i) {
      var s = [esc(op.cli || '—')];
      if (op.vend.length) s.push(esc(op.vend.join(' · ')));
      if (ST.U && op.u) s.push(esc(fUn(op.u)));
      if (op.cir) s.push((op.cir >= hISO ? 'cirurgia ' : 'cirurgia foi ') + fDia(op.cir));
      var badge = FC.fase ? '' : '<span class="fv-badge" style="--c:' + esc(P.cor(op.fase)) + ';"><i></i>' + esc(P.curto(op.fase)) + '</span>';
      var parte = op.vt != null && op.vt > op.v * 1.005 ? '<small title="valor da oportunidade inteira">de ' + esc(fMi(op.vt)) + '</small>' : '<small>' + (op.vt != null ? 'o item é toda a op.' : '&nbsp;') + '</small>';
      return '<button type="button" class="fx-ov-op" data-an-dw="op" data-i="' + i + '" title="' + esc(op.nome) + ' — clique para abrir a ficha do Salesforce">'
        + '<span class="r">' + (i + 1) + '</span>'
        + '<span class="c"><span class="t">' + esc(op.nome || '(sem nome)') + '</span><span class="s">' + badge + s.join(' · ') + '</span></span>'
        + '<span class="v"><b>' + esc(fMi(op.v)) + '</b>' + parte + '</span></button>';
    }).join('')
      + '<div class="an-dw-nota">valor = a parte ' + (FC.o.g === 'sku' ? 'deste SKU' : FC.o.g === 'fam' ? 'desta família' : 'desta estratégia') + ' na oportunidade · ' + (ops.length >= 40 ? 'as 40 maiores' : fINT(ops.length) + ' oportunidade' + (ops.length === 1 ? '' : 's')) + '</div>';
  }
  // a linha que a ficha do Salesforce (comercial-funil-lista.js) espera
  function linhaFicha(op) {
    return { k: 'an', nome: op.nome, fase: op.fase, cli: op.cli, v: op.vt != null ? op.vt : op.v, q: 1,
      vend: op.vend, unid: [], estr: [], fam: [], med: [], uf: [], tf: op.tf, cir: op.cir, cria: op.cria, vendT: op.vend.join(' · '), unidT: '' };
  }
  function cliqueFicha(e) {
    var b = e.target.closest ? e.target.closest('[data-an-dw]') : null; if (!b) return;
    var a = b.getAttribute('data-an-dw');
    if (a === 'fechar') fechar();
    else if (a === 'tentar') carregarFicha();
    else if (a === 'fase') { FC.fase = b.getAttribute('data-fase') || ''; carregarFicha(); $('an-dw-body').scrollTop = 0; }
    else if (a === 'op') {
      var op = (FC.d.ops || [])[+b.getAttribute('data-i')];
      if (op && window.FunilLista) FunilLista.ficha(linhaFicha(op), b);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // EVENTOS DA PÁGINA
  // ══════════════════════════════════════════════════════════════
  function ligar() {
    var raiz = $('an-app'); if (!raiz || raiz._anLigado) return;
    raiz._anLigado = true;
    raiz.addEventListener('click', function (e) {
      var t = e.target;
      var sk = t.closest('[data-an-sku]');
      if (sk) { abrir(acharLinha(sk.getAttribute('data-an-sku')), sk.getAttribute('data-an-fase') || '', sk); return; }
      var tr = t.closest('tr[data-an-row]');
      if (tr) { abrir(acharLinha(tr.getAttribute('data-an-row')), '', tr); return; }
      var th = t.closest('th[data-an-ord]');
      if (th) {
        var k = th.getAttribute('data-an-ord');
        if (ST.ord && ST.ord.k === k) ST.ord = ST.ord.d === (k === 'nome' ? 1 : -1) ? { k: k, d: -ST.ord.d } : null;   // 1º sentido → 2º → padrão
        else ST.ord = { k: k, d: k === 'nome' ? 1 : -1 };
        ST.lim = PASSO; pintarMatriz(); return;
      }
      var bm = t.closest('[data-an-met]');
      if (bm) { ST.met = bm.getAttribute('data-an-met'); pintarMatriz(); return; }
      var bg = t.closest('[data-an-grupo]');
      if (bg) {
        var g = bg.getAttribute('data-an-grupo'); if (g === ST.grupo) return;
        ST.grupo = g; ST.ord = null; ST.lim = PASSO;
        if (g !== 'sku') carregarGrupo(g);
        pintarMatriz(); return;
      }
      var bo = t.closest('[data-an-ordfase]');
      if (bo) {
        ST.grupo = 'sku'; ST.ord = { k: bo.getAttribute('data-an-ordfase'), d: -1 }; ST.lim = PASSO; ST.busca = '';
        var bi = $('an-busca'); if (bi) bi.value = '';
        pintarMatriz();
        var card = $('an-mx-card'); if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (t.closest('#an-mais')) { ST.lim += PASSO; pintarMatriz(); return; }
      if (t.closest('#an-excel')) excel();
    });
    raiz.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var el = e.target.closest && e.target.closest('tr[data-an-row], [data-an-sku][role="button"]');
      if (el && el === e.target) { e.preventDefault(); el.click(); }
    });
    var tb = null, bi = $('an-busca');
    if (bi) bi.addEventListener('input', function (e) {
      clearTimeout(tb); var v = e.target.value;
      tb = setTimeout(function () { ST.busca = v; ST.lim = PASSO; pintarMatriz(); }, 160);
    });
  }

  window.FunilAnalitico = {
    // cfg: { query(dax) → linhas, filtros() → [predicados DAX], cor(fase), ordemFase(fase), curto(fase), contexto()? }
    init: function (cfg) { P = cfg; ligar(); pintarTudo(); },
    carregar: carregar,
    diag: function () {
      return { unidades: ST.U, skus: ST.skus ? ST.skus.length : null, fases: ST.fases ? ST.fases.map(function (f) { return f.nome; }) : null,
        grupo: ST.grupo, met: ST.met, erro: ST.erro, grupos: Object.keys(ST.grupos) };
    }
  };
})();
