/* ================================================================
   cotacoes-analitico.js — COTAÇÕES · ANALÍTICO (pages/comercial-cot-analitico.html)

   20/10/2026 (pedido do usuário): o Analítico do Funil de Vendas da
   Licitação (pages/licitacao-funil-semanal-analitico.html, o mesmo CSS) para
   as cotações, sobre o motor cotacoes-semana.js — as MESMAS cotações do
   Funil (a semana avaliada, a janela e os filtros passam de uma aba à
   outra) e os ITENS delas:

     • o herói: em cima as cotações (os números do Funil); embaixo os itens —
       ganhei, perdi, em andamento e perdi por preço (27/10/2026: o quadro da
       distância do concorrente saiu — ela segue em "O preço do concorrente");
     • itens ganhos, em andamento e perdidos POR FAMÍLIA (a do Power BI do
       Comercial, 'Produtos'[Família] — GET /api/cot-casos?familias=1); o
       clique na família abre os SKUs; nos perdidos a barra é pintada pelo
       motivo;
     • por que perdi (os grupos de motivo e os motivos), o preço do
       concorrente e o resultado dos itens (marcado × pela cotação);
     • a lista por cotação ou por item — a linha abre a ficha à direita.

   O resultado do item: a marca no caso (Gestão › Itens cotados — Ganho ou
   Perdido, com o motivo opcional); sem ela, o da cotação: virou pedido =
   ganho; perdida, vencida ou cancelada = perdido; em aberto = em andamento.
   O motivo do perdido: o do item; sem ele, o da cotação (o "Perdida" pede o
   motivo); sem nenhum, "Sem motivo informado".
   ================================================================ */
(function () {
  'use strict';
  var C = window.COT, S = window.COTS;
  if (!C || !S || !document.body || document.body.getAttribute('data-cot-pagina') !== 'analitico') return;
  var D = document, $ = C.$, esc = C.esc;
  var COR = S.COR, NOME = S.NOME, F = S.F;
  var dm = S.dm, addDias = S.addDias, difDias = S.difDias, brl0 = S.brl0, setT = S.setT, setH = S.setH, quatro = S.quatro;

  // os grupos do motivo da perda — a ordem decide ("Comprador não informou o
  // motivo" é sem motivo; "Preço acima do concorrente" é preço)
  var GRUPOS = [
    { id: 'semmot', nome: 'Sem motivo informado', cor: '#CCD3D7', rx: /^$|sem motivo|nao informou/ },
    { id: 'preco', nome: 'Preço', cor: '#E4574C', rx: /preco|caro|valor|desconto/ },
    { id: 'prazo', nome: 'Prazo de entrega', cor: '#F29B4B', rx: /prazo|entrega/ },
    { id: 'produto', nome: 'Produto / especificação', cor: '#8E6CC9', rx: /marca|produto|especifica|tecnic|amostra|qualidade|aceit/ },
    { id: 'docs', nome: 'Documentação / registro', cor: '#4E8495', rx: /document|registro|anvisa|habilita|certid/ },
    { id: 'estoque', nome: 'Estoque', cor: '#3BA7A0', rx: /estoque|falta de/ },
    { id: 'vencida', nome: 'Proposta vencida', cor: '#E3B23C', rx: /vencid|validade/ },
    { id: 'cancel', nome: 'Cancelada / deserta', cor: '#97A8AE', rx: /cancel|desert|declin|nao vamos fornecer|sem resultado/ },
    { id: 'outros', nome: 'Outros motivos', cor: '#81939B', rx: null }
  ];
  var GI = {}; GRUPOS.forEach(function (g) { GI[g.id] = g; });
  function grupoDe(m) {
    var n = C.norm(m).trim();
    for (var i = 0; i < GRUPOS.length; i++) if (GRUPOS[i].rx && GRUPOS[i].rx.test(n)) return GRUPOS[i];
    return GI.outros;
  }
  // o resultado do item, com a cor do "Resultado dos itens"
  var RES = {
    gm: ['Ganho · marcado', '#2FBF71', 'gan', 'Ganho marcado no caso (Gestão › Itens cotados)'],
    gc: ['Ganho · virou pedido', '#8ED9AE', 'gan', 'sem a marca no item: a oportunidade virou pedido'],
    pm: ['Perdido · marcado', '#E4574C', 'per', 'Perdido marcado no caso (Gestão › Itens cotados)'],
    pc: ['Perdido · não virou', '#F2A39C', 'per', 'sem a marca no item: a oportunidade foi perdida'],
    an: ['Em andamento', '#77B2C0', 'and', 'sem a marca no item: a oportunidade segue em aberto']
  };
  var FAIXAS = [['abaixo', 'Já estávamos abaixo', -Infinity, 0], ['f5', 'Até 5% acima', 0, 0.05], ['f15', '5% a 15%', 0.05, 0.15],
    ['f30', '15% a 30%', 0.15, 0.30], ['f60', '30% a 60%', 0.30, 0.60], ['fx', 'Mais de 60%', 0.60, Infinity]];
  var LS_PASSO = 150, TOP = 10, SEMFAM = '(sem família)';
  var UI = { grao: lerSS('grao', ['cot', 'item'], 'cot'), sit: lerSS('sit', ['tudo', 'and', 'gan', 'per'], 'tudo'), busca: '', lim: LS_PASSO, ord: null,
    sel: { grp: null, mot: null, res: null }, aberto: {}, drill: { gan: null, and: null, per: null } };
  var UC = null;
  // a família dos produtos (o Power BI do Comercial, pelo servidor)
  var FAM = { estado: null, map: {}, motivo: '', v: 0, sig: '' };

  /* ══════════════════════════════════════════════════════════════
     OS ITENS de cada cotação (do índice: itensRes)
     ══════════════════════════════════════════════════════════════ */
  function codFam(c) { return String(c == null ? '' : c).replace(/ /g, ' ').trim().toUpperCase(); }
  function famOk() { return FAM.estado === 'ok' && Object.keys(FAM.map).length > 0; }
  function itensDe(o) {
    if (o._its && o._famV === FAM.v) return o._its;
    var c = o.c;
    o._its = (c.itensRes || []).map(function (x, i) {
      var marca = x[4] === 'g' ? 'ganho' : x[4] === 'p' ? 'perdido' : '';
      var sit = marca === 'ganho' ? 'gan' : marca === 'perdido' ? 'per' : o.sit;
      var it = { o: o, i: i, cod: x[0] || '', desc: x[1] || '', qtd: Number(x[2]) || 0, v: Number(x[3]) || 0, marca: marca, sit: sit };
      // o preço unitário cotado (27/10/2026): o valor do item ÷ a quantidade
      it.vu = it.qtd > 0 ? it.v / it.qtd : null;
      it.res = marca === 'ganho' ? 'gm' : marca === 'perdido' ? 'pm' : o.sit === 'gan' ? 'gc' : o.sit === 'per' ? 'pc' : 'an';
      if (sit === 'per') it.mot = x[5] || (o.sit === 'per' ? (c.perda || '') : '') || 'Sem motivo informado';
      else it.mot = null;
      it.g = it.mot ? grupoDe(it.mot).id : null;
      it.fam = famOk() ? (FAM.map[codFam(it.cod)] || SEMFAM) : SEMFAM;
      it.prod = it.desc || it.cod || '—';
      it.skuK = it.cod ? 'c:' + C.chave(it.cod) : 'n:' + C.chave(it.desc);
      return it;
    });
    o._famV = FAM.v;
    return o._its;
  }
  function todosItens(c) { var out = []; c.ls.forEach(function (o) { itensDe(o).forEach(function (it) { out.push(it); }); }); return out; }
  // o recorte dos quadros: `ignorar` = o do próprio quadro
  function filtra(lista, ignorar) {
    var s = UI.sel;
    return lista.filter(function (it) {
      if (s.grp && ignorar !== 'mot' && it.g !== s.grp) return false;
      if (s.mot && ignorar !== 'mot' && it.mot !== s.mot) return false;
      if (s.res && ignorar !== 'res' && it.res !== s.res) return false;
      return true;
    });
  }
  function temSel() { var s = UI.sel; return !!(s.grp || s.mot || s.res); }
  function nv(ls) { var r = { n: 0, v: 0 }; ls.forEach(function (it) { r.n++; r.v += it.v; }); return r; }
  function cotsDe(ls) { var m = {}; ls.forEach(function (it) { m[it.o.id] = 1; }); return Object.keys(m).length; }
  function ite(n) { return n === 1 ? 'item' : 'itens'; }
  function cot(n) { return n === 1 ? 'oportunidade' : 'oportunidades'; }
  function mediana(xs) { if (!xs.length) return null; var s = xs.slice().sort(function (a, b) { return a - b; }), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function pctS(x) { return (x > 0 ? '+' : '') + Math.round(x * 100) + '%'; }
  // a fatia pequena não vira "0%"
  function pct0(x) { return x > 0 && x < 0.01 ? '<1%' : F.pct(x, 0); }

  /* ══════════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════════ */
  var HOSTS = ['sf-gan-host', 'sf-and-host', 'sf-per-host', 'mo-host', 'pr-host', 're-host'];
  function vazio(msg) {
    HOSTS.forEach(function (id) { setH(id, '<div class="fv-empty">' + esc(msg) + '</div>'); });
    ['ha-gan-v', 'ha-gan-c', 'ha-per-v', 'ha-per-c', 'ha-and-v', 'ha-and-c', 'ha-pre-v', 'ha-pre-c', 'ls-info'].forEach(function (id) { setT(id, '—'); });
    ['ha-ng', 'ha-ng-tx', 'ha-tx', 'ha-gan-d', 'ha-per-d', 'ha-and-d', 'ha-pre-d', 're-nota', 'ls-head', 'ls-foot', 'ls-sel'].forEach(function (id) { setH(id, ''); });
    setH('ls-body', '<tr><td class="tx dim ng-vz">' + esc(msg) + '</td></tr>');
    var m = $('ls-mais'); if (m) m.hidden = true;
    UC = null;
  }
  function render(c) {
    UC = c;
    var T = todosItens(c), s = UI.sel;
    // seleção que o recorte novo não traz mais não pode deixar tudo vazio
    if (s.grp && !T.some(function (it) { return it.g === s.grp; })) s.grp = null;
    if (s.mot && !T.some(function (it) { return it.mot === s.mot; })) s.mot = null;
    if (s.res && !T.some(function (it) { return it.res === s.res; })) s.res = null;
    pintarHero(c, T);
    pintarSitFam(c, T, 'gan');
    pintarSitFam(c, T, 'and');
    pintarSitFam(c, T, 'per');
    pintarMotivos(c, T);
    pintarPreco(c);
    pintarResultados(c, T);
    pintarLista(c, T);
  }

  /* ── o herói ──────────────────────────────────────────────────── */
  function pintarHero(c, T) {
    var q = c.quando(), f = c.foco, WK = c.WK, Q = quatro(c.ls);
    setT('ha-k', 'Cotadas ' + q + ' · as mesmas oportunidades do Funil');
    var per0 = f.length === 1 ? 'de ' + dm(f[0]) + ' a ' + dm(addDias(f[0], 6)) : f.length ? 'em ' + f.length + ' semanas' : WK.length ? 'de ' + dm(WK[0]) + ' a ' + dm(addDias(WK[WK.length - 1], 6)) : '';
    setH('ha-ng-tx', 'data da cotação ' + esc(per0) + ' · situação de <b>hoje</b>');
    var cel = function (k, sub) {
      var x = Q[k], on = UI.grao === 'cot' && UI.sit === (k === 'ag' ? 'tudo' : k);
      return '<button type="button" class="fa-ng-c ' + k + (on ? ' on' : '') + '" data-ca-neg="' + (k === 'ag' ? 'tudo' : k) + '" title="' + esc(NOME[k] + ': ' + F.int(x.n) + ' ' + cot(x.n) + ' · ' + F.brl(x.v) + ' — clique para ver na lista') + '">' +
        '<span class="k"><i></i>' + NOME[k] + '</span><span class="v">' + esc(F.mi(x.v)) + '</span><span class="s"><b>' + F.int(x.n) + '</b> ' + cot(x.n) + (sub ? ' · ' + sub : '') + '</span></button>';
    };
    var pc = function (x) { return Q.ag.v ? F.pct(x.v / Q.ag.v, 0) + ' do valor' : ''; };
    setH('ha-ng', cel('ag', '') + cel('and', pc(Q.and)) + cel('gan', pc(Q.gan)) + cel('per', pc(Q.per)) +
      '<div class="fa-ng-c tx" title="ganhas ÷ cotadas, em quantidade — a mesma taxa do Funil"><span class="k">Taxa de ganho</span>' +
        '<span class="v">' + (Q.ag.n ? F.pct(Q.gan.n / Q.ag.n, 0) : '—') + '</span>' +
        '<span class="s">' + (Q.ag.n ? '<b>' + F.int(Q.gan.n) + '</b> de ' + F.int(Q.ag.n) + ' · ' + (Q.ag.v ? F.pct(Q.gan.v / Q.ag.v, 0) : '—') + ' em valor' : 'nenhuma cotada') + '</span></div>');

    setT('ha-ik', 'Os itens delas' + (temSel() ? ' · com o recorte dos quadros' : ''));
    var I = filtra(T), G = I.filter(function (it) { return it.sit === 'gan'; }), P = I.filter(function (it) { return it.sit === 'per'; }), A = I.filter(function (it) { return it.sit === 'and'; });
    var sg = nv(G), sp = nv(P), sa = nv(A), st = nv(I);
    var cnt = function (x, ls) { var nc = cotsDe(ls); return F.int(x.n) + ' ' + ite(x.n) + ' em ' + F.int(nc) + ' ' + cot(nc); };
    setT('ha-gan-v', F.mi(sg.v)); setT('ha-gan-c', cnt(sg, G));
    setT('ha-per-v', F.mi(sp.v)); setT('ha-per-c', cnt(sp, P));
    setT('ha-and-v', F.mi(sa.v)); setT('ha-and-c', cnt(sa, A));
    // o que o Funil não mostra: o item com resultado diferente da cotação
    var gFora = G.filter(function (it) { return it.o.sit !== 'gan'; }), pPed = P.filter(function (it) { return it.o.sit === 'gan'; });
    setH('ha-gan-d', gFora.length ? '<b>' + F.int(gFora.length) + '</b> ganho' + (gFora.length === 1 ? '' : 's') + ' em oportunidades ainda em aberto ou perdidas · ' + F.mi(nv(gFora).v)
      : (G.length ? 'todos em oportunidades que viraram pedido' : 'Nenhum item ganho ' + esc(q) + '.'));
    setH('ha-per-d', pPed.length ? '<b>' + F.int(pPed.length) + '</b> perdido' + (pPed.length === 1 ? '' : 's') + ' dentro de oportunidades que viraram pedido · ' + F.mi(nv(pPed).v)
      : (P.length ? 'todos em oportunidades que não viraram pedido' : 'Nenhum item perdido ' + esc(q) + '.'));
    setH('ha-and-d', A.length ? 'das <b>' + F.int(Q.and.n) + '</b> ' + cot(Q.and.n) + ' em aberto' : 'Nenhum item em andamento ' + esc(q) + '.');
    var pr = nv(P.filter(function (it) { return it.g === 'preco'; })), semM = P.filter(function (it) { return it.g === 'semmot'; }).length;
    setT('ha-pre-v', F.mi(pr.v));
    setT('ha-pre-c', F.int(pr.n) + ' ' + ite(pr.n) + (sp.v ? ' · ' + F.pct(pr.v / sp.v, 0) + ' do perdido' : ''));
    setH('ha-pre-d', P.length ? (semM ? '<b>' + F.int(semM) + '</b> perdido(s) sem motivo informado' : 'todos os perdidos com o motivo') : '');
    var pre = D.querySelector('.fs-mv.pre'); if (pre) pre.classList.toggle('on', UI.sel.grp === 'preco');
    ['gan', 'per', 'and'].forEach(function (k) { var e = D.querySelector('.fs-mv.' + k); if (e) e.classList.toggle('on', UI.grao === 'item' && UI.sit === k); });
    var res = sg.n + sp.n;
    setH('ha-tx', st.n ? 'Taxa de ganho dos itens: <b>' + F.pct(sg.n / st.n, 0) + '</b> em quantidade · <b>' + F.pct(st.v ? sg.v / st.v : 0, 0) + '</b> em valor' +
      (res && sa.n ? ' · <b>' + F.pct(sg.n / res, 0) + '</b> dos que já têm resultado' : '') : 'Nenhum item nas oportunidades ' + esc(q) + '.');
  }
  // as perdidas com o preço do concorrente: nosso valor cotado ÷ o dele − 1
  function concorrentes(c) {
    return c.ls.filter(function (o) { return o.fase === 'perdida' && Number(o.c.valorConcorrente) > 0 && o.v > 0; })
      .map(function (o) { o._gap = o.v / Number(o.c.valorConcorrente) - 1; return o; });
  }

  /* ── ganhos · em andamento · perdidos: família → SKU ──────────── */
  var SF = {
    gan: { cor: COR.gan, nomes: 'ganhos', sub: 'ganhos (marcados ou da oportunidade que virou pedido)', vz: 'Nenhum item ganho' },
    and: { cor: COR.and, nomes: 'em andamento', sub: 'ainda sem resultado — das oportunidades em aberto', vz: 'Nenhum item em andamento' },
    per: { cor: COR.per, nomes: 'perdidos', sub: 'perdidos (marcados ou da oportunidade que não virou)', vz: 'Nenhum item perdido' }
  };
  function sitItens(T, k) { return filtra(T, k === 'per' ? null : 'mot').filter(function (it) { return it.sit === k; }); }
  function notaFam() {
    if (FAM.estado === 'carga' || FAM.estado == null) return ' · lendo as famílias no Power BI…';
    if (!famOk()) return ' · sem a família do Power BI' + (FAM.motivo ? ' (' + FAM.motivo + ')' : '') + ': por SKU';
    return '';
  }
  function pintarSitFam(c, T, k) {
    var met = c.met, host = $('sf-' + k + '-host'), cf = SF[k], q = c.quando();
    var val = function (x) { return met === 'n' ? x.n : x.v; };
    var s = UI.sel, rec = k === 'per' ? (s.mot || (s.grp && GI[s.grp].nome)) : null;
    setT('sf-' + k + '-sub', 'itens ' + cf.sub + (rec ? ' · só os de “' + rec + '”' : '') + (famOk() ? ' · por família · clique numa família para ver os SKUs' : '') +
      (k === 'per' ? ' · passe o mouse para ver os motivos' : (s.grp || s.mot) ? ' · o recorte de motivo vale só para os perdidos' : '') + notaFam());
    var I = sitItens(T, k);
    if (!I.length) { UI.drill[k] = null; host.innerHTML = '<div class="fa-vz">' + cf.vz + ' nas cotadas ' + esc(q) + (temSel() || rec ? ' com o recorte escolhido' : '') + '.</div>'; return; }
    var m = {}, skus = {};
    I.forEach(function (it) {
      var x = m[it.fam] || (m[it.fam] = { k: it.fam, n: 0, v: 0, cots: {}, skus: {}, g: {} });
      x.n++; x.v += it.v; x.cots[it.o.id] = 1; x.skus[it.skuK] = 1; skus[it.skuK] = 1;
      if (it.g) { var y = x.g[it.g] || (x.g[it.g] = { n: 0, v: 0 }); y.n++; y.v += it.v; }
    });
    var tot = nv(I);
    // sem família do Power BI: os SKUs direto (um grupo só)
    if (!famOk()) { host.innerHTML = skusDe(c, k, I, m[SEMFAM], tot, true); return; }
    if (UI.drill[k] && !m[UI.drill[k]]) UI.drill[k] = null;
    if (UI.drill[k]) { host.innerHTML = skusDe(c, k, I, m[UI.drill[k]], tot, false); return; }
    var ls = Object.keys(m).map(function (fm) { return m[fm]; }).sort(function (a, b) { return val(b) - val(a) || b.n - a.n; });
    var max = Math.max.apply(null, ls.map(val).concat([1])), ab = 'f' + k, vis = UI.aberto[ab] ? ls : ls.slice(0, TOP), nS = Object.keys(skus).length, nC = cotsDe(I);
    var h = '<div class="fa-sf-tot"><b>' + F.mi(tot.v) + '</b> em <b>' + F.int(tot.n) + '</b> ' + ite(tot.n) + ' · <b>' + F.int(ls.length) + '</b> famíli' + (ls.length === 1 ? 'a' : 'as') +
      ' · <b>' + F.int(nS) + '</b> SKU' + (nS === 1 ? '' : 's') + ' · <b>' + F.int(nC) + '</b> ' + cot(nC) + '</div>';
    h += '<div class="fa-blk" style="margin-top:10px;">' + vis.map(function (x) {
      var nc = Object.keys(x.cots).length, ns = Object.keys(x.skus).length, pct = val(tot) ? val(x) / val(tot) : 0;
      return '<div class="fs-hb cl" role="button" tabindex="0" data-ca-sf="' + k + '" data-fam="' + esc(x.k) + '" title="' + esc(x.k + ' · ' + F.int(x.n) + ' ' + ite(x.n) + ' ' + cf.nomes + ' em ' + nc + ' ' + cot(nc) + ' · ' + F.brl(x.v) +
          ' · ' + F.pct(pct, 0) + ' do total · ' + ns + ' SKU' + (ns === 1 ? '' : 's') + (k === 'per' ? gruposTxt(x.g) : '') + ' — clique para ver os SKUs') + '">' +
        '<span class="nm' + (x.k === SEMFAM ? ' dim' : '') + '">' + esc(x.k) + '</span>' +
        '<span class="tr"><span class="cmp" style="width:' + Math.max(val(x) / max * 100, 1).toFixed(2) + '%;">' + barra(k, x, val) + '</span></span>' +
        '<span class="vl"><b>' + F.int(x.n) + '</b> ' + ite(x.n) + '<span>' + F.mi(x.v) + ' · ' + F.int(ns) + ' SKU' + (ns === 1 ? '' : 's') + '</span></span></div>';
    }).join('') + (ls.length > TOP ? '<button type="button" class="fa-mais" data-ca-abrir="' + ab + '">' + (UI.aberto[ab] ? 'Mostrar só as ' + TOP + ' primeiras' : 'Ver todas as ' + F.int(ls.length) + ' famílias') + '</button>' : '') + '</div>';
    host.innerHTML = h;
  }
  // a barra: a cor da situação — os perdidos em VERMELHO (21/10/2026, pedido
  // do usuário: eram pintados pelo motivo e "sem motivo" saía cinza); os
  // motivos seguem na dica da barra e no "Por que perdi"
  function barra(k, x, val) {
    return '<i style="width:100%;background:' + SF[k].cor + ';"></i>';
  }
  function gruposTxt(gs) {
    var ls = GRUPOS.filter(function (g) { return gs[g.id]; }).sort(function (a, b) { return gs[b.id].v - gs[a.id].v; });
    return ls.length ? ' — ' + ls.map(function (g) { return g.nome + ' ' + F.int(gs[g.id].n) + ' (' + F.brl(gs[g.id].v) + ')'; }).join(' · ') : '';
  }
  // os SKUs de uma família (ou de todas, sem a família do Power BI)
  function skusDe(c, k, I, fx, tot, todos) {
    var met = c.met, cf = SF[k];
    var val = function (x) { return met === 'n' ? x.n : x.v; };
    var m = {};
    I.filter(function (it) { return todos || it.fam === fx.k; }).forEach(function (it) {
      var y = m[it.skuK] || (m[it.skuK] = { k: it.skuK, cod: it.cod, nome: it.prod, n: 0, v: 0, qtd: 0, cots: {}, clis: {}, g: {}, mot: {} });
      y.n++; y.v += it.v; y.qtd += it.qtd; y.cots[it.o.id] = 1;
      var cl = it.o.cliente; if (cl) y.clis[cl] = (y.clis[cl] || 0) + it.v;
      if (it.g) { var z = y.g[it.g] || (y.g[it.g] = { n: 0, v: 0 }); z.n++; z.v += it.v; y.mot[it.mot] = (y.mot[it.mot] || 0) + it.v; }
    });
    var ls = Object.keys(m).map(function (s) { return m[s]; }).sort(function (a, b) { return val(b) - val(a) || b.n - a.n; });
    var max = Math.max.apply(null, ls.map(val).concat([1])), ab = 's' + k, vis = UI.aberto[ab] ? ls : ls.slice(0, TOP);
    var base = todos ? tot : fx, pct = val(tot) ? val(base) / val(tot) : 0;
    var h = todos ? '<div class="fa-sf-tot"><b>' + F.mi(tot.v) + '</b> em <b>' + F.int(tot.n) + '</b> ' + ite(tot.n) + ' · <b>' + F.int(ls.length) + '</b> SKU' + (ls.length === 1 ? '' : 's') + ' · <b>' + F.int(cotsDe(I)) + '</b> ' + cot(cotsDe(I)) + '</div>'
      : '<div class="fa-sf-cr"><button type="button" class="fa-sf-volta" data-ca-sfv="' + k + '" title="voltar para todas as famílias">‹ Famílias</button>' +
        '<span class="nm" title="' + esc(fx.k) + '">' + esc(fx.k) + '</span>' +
        '<span class="r"><b>' + F.mi(fx.v) + '</b> · ' + F.int(fx.n) + ' ' + ite(fx.n) + ' · ' + F.int(ls.length) + ' SKU' + (ls.length === 1 ? '' : 's') + ' · ' + F.pct(pct, 0) + ' dos ' + cf.nomes + '</span></div>';
    h += '<div class="fa-blk fa-sku" style="margin-top:8px;">' + vis.map(function (y) {
      var nc = Object.keys(y.cots).length, nomeQ = y.cod || y.nome;
      var clis = Object.keys(y.clis).sort(function (a, b) { return y.clis[b] - y.clis[a]; });
      var mots = Object.keys(y.mot).sort(function (a, b) { return y.mot[b] - y.mot[a]; });
      // 27/10/2026 (pedido do usuário): o preço médio cotado do SKU — o valor ÷ a quantidade, somados
      var pm = y.qtd > 0 ? y.v / y.qtd : null;
      var sub = (pm != null ? '<span class="pm">preço médio cotado <b>' + F.brl(pm) + '</b></span> · ' : '') + (k === 'per' && mots.length ? '<span class="mo"><i class="fa-dot" style="background:' + grupoDe(mots[0]).cor + ';"></i>' + esc(mots[0]) + (mots.length > 1 ? ' + ' + (mots.length - 1) : '') + '</span> · ' : '') +
        F.int(nc) + ' ' + cot(nc) + (clis.length ? ' · ' + esc(clis.slice(0, 2).join(', ')) + (clis.length > 2 ? ' + ' + (clis.length - 2) : '') : '');
      var num = met === 'n' ? '<b>' + F.int(y.n) + ' ' + ite(y.n) + '</b>' + F.mi(y.v) : '<b>' + F.mi(y.v) + '</b>' + F.int(y.n) + ' ' + ite(y.n);
      return '<div class="fa-sku-r" role="button" tabindex="0" data-ca-sku="' + k + '" data-q="' + esc(nomeQ) + '" title="' + esc((y.cod ? y.cod + ' · ' : '') + y.nome + ' — ' + F.int(y.n) + ' ' + ite(y.n) + ' ' + cf.nomes + ' · ' +
          C.qtd(y.qtd) + ' un. · ' + F.brl(y.v) + (pm != null ? ' · preço médio cotado ' + F.brl(pm) : '') + ' · em ' + nc + ' ' + cot(nc) + (clis.length ? ': ' + clis.join(', ') : '') + ' — clique para ver os itens na lista') + '">' +
        '<span class="t">' + (y.cod ? '<b class="cd">' + esc(y.cod) + '</b>' : '') + esc(y.nome) + '</span>' +
        '<span class="v">' + num + ' · ' + C.qtd(y.qtd) + ' un.</span>' +
        '<span class="tr"><span class="cmp" style="width:' + Math.max(val(y) / max * 100, 1).toFixed(2) + '%;">' + barra(k, y, val) + '</span></span>' +
        '<span class="s">' + sub + '</span></div>';
    }).join('') + (ls.length > TOP ? '<button type="button" class="fa-mais" data-ca-abrir="' + ab + '">' + (UI.aberto[ab] ? 'Mostrar só os ' + TOP + ' primeiros' : 'Ver todos os ' + F.int(ls.length) + ' SKUs') + '</button>' : '') + '</div>';
    return h;
  }

  /* ── por que perdi ────────────────────────────────────────────── */
  function pintarMotivos(c, T) {
    var met = c.met, host = $('mo-host'), q = c.quando();
    var val = function (x) { return met === 'n' ? x.n : x.v; };
    var P = filtra(T, 'mot').filter(function (it) { return it.sit === 'per'; });
    setT('mo-sub', 'o motivo da perda de cada item perdido das cotadas ' + q + ' — o do item (marcado no caso) ou o da oportunidade · clique para filtrar a página');
    if (!P.length) { host.innerHTML = '<div class="fa-vz">Nenhum item perdido nas cotadas ' + esc(q) + ' com os filtros escolhidos.</div>'; return; }
    var gs = {}, tot = nv(P);
    P.forEach(function (it) { var x = gs[it.g] || (gs[it.g] = { n: 0, v: 0 }); x.n++; x.v += it.v; });
    var ord = GRUPOS.filter(function (g) { return gs[g.id]; }).sort(function (a, b) { return val(gs[b.id]) - val(gs[a.id]); });
    var tv = val(tot) || 1, gsel = UI.sel.grp;
    var h = '<div class="fa-grp">' + ord.map(function (g) {
      var x = gs[g.id];
      return '<i data-ca-grp="' + g.id + '" class="' + (gsel && gsel !== g.id ? 'dim' : '') + '" style="flex-grow:' + (val(x) / tv).toFixed(4) + ';background:' + g.cor + ';" title="' + esc(g.nome + ': ' + F.int(x.n) + ' itens · ' + F.brl(x.v) + ' · ' + F.pct(val(x) / tv, 0)) + '"></i>';
    }).join('') + '</div><div class="fa-leg">' + ord.map(function (g) {
      var x = gs[g.id];
      return '<button type="button" class="fa-chip' + (gsel === g.id ? ' on' : gsel ? ' dim' : '') + '" data-ca-grp="' + g.id + '" title="clique para filtrar a página por ' + esc(g.nome) + '"><i style="background:' + g.cor + ';"></i>' + esc(g.nome) + ' <b>' + pct0(val(x) / tv) + '</b></button>';
    }).join('') + '</div>';
    var ms = {};
    P.filter(function (it) { return !gsel || it.g === gsel; }).forEach(function (it) { var x = ms[it.mot] || (ms[it.mot] = { k: it.mot, g: it.g, n: 0, v: 0, cots: {} }); x.n++; x.v += it.v; x.cots[it.o.id] = 1; });
    var lm = Object.keys(ms).map(function (k) { return ms[k]; }).sort(function (a, b) { return val(b) - val(a) || b.n - a.n; });
    var max = Math.max.apply(null, lm.map(val).concat([1])), vis = UI.aberto.mot ? lm : lm.slice(0, TOP), msel = UI.sel.mot;
    h += '<div class="fa-blk"><h5>' + (gsel ? esc(GI[gsel].nome) + ' · motivos' : 'Motivos') + '</h5>' + vis.map(function (x) {
      var g = GI[x.g], nc = Object.keys(x.cots).length;
      return '<div class="fs-hb cl' + (msel === x.k ? ' on' : msel ? ' dim' : '') + '" role="button" tabindex="0" data-ca-mot="' + esc(x.k) + '" title="' + esc(x.k + ' · ' + g.nome + ': ' + F.int(x.n) + ' itens em ' + nc + ' ' + cot(nc) + ' · ' + F.brl(x.v) + ' — clique para filtrar') + '">' +
        '<span class="nm' + (x.g === 'semmot' ? ' dim' : '') + '">' + esc(x.k) + '</span>' +
        '<span class="tr"><span class="cmp" style="width:' + Math.max(val(x) / max * 100, 1).toFixed(2) + '%;"><i style="width:100%;background:' + g.cor + ';"></i></span></span>' +
        '<span class="vl"><b>' + F.int(x.n) + '</b> ' + ite(x.n) + '<span>' + F.mi(x.v) + '</span></span></div>';
    }).join('') + (lm.length > TOP ? '<button type="button" class="fa-mais" data-ca-abrir="mot">' + (UI.aberto.mot ? 'Mostrar só os ' + TOP + ' primeiros' : 'Ver todos os ' + F.int(lm.length) + ' motivos') + '</button>' : '') + '</div>';
    host.innerHTML = h;
  }

  /* ── o preço do concorrente ───────────────────────────────────── */
  function pintarPreco(c) {
    var host = $('pr-host'), q = c.quando(), per = c.ls.filter(function (o) { return o.fase === 'perdida'; });
    var L = concorrentes(c);
    setT('pr-sub', 'as oportunidades perdidas ' + q + ' com o preço de quem levou (o "Preço do concorrente" de Perdida) · nosso valor cotado × o dele');
    var quem = {};
    per.forEach(function (o) { var k = (o.c.concorrente || '').trim(); if (k) { var x = quem[k] || (quem[k] = { n: 0, v: 0 }); x.n++; x.v += o.v; } });
    var lq = Object.keys(quem).sort(function (a, b) { return quem[b].n - quem[a].n || quem[b].v - quem[a].v; });
    if (!L.length && !lq.length) {
      host.innerHTML = '<div class="fa-vz">Nenhuma oportunidade perdida ' + esc(q) + ' com o concorrente ou o preço dele' + (per.length ? ' — ' + F.int(per.length) + ' perdida(s) sem essa informação; ao marcar Perdida, diga quem levou e por quanto' : '') + '.</div>';
      return;
    }
    var h = '';
    if (L.length) {
      var md = mediana(L.map(function (o) { return o._gap; })), emp = L.reduce(function (a, o) { return a + Math.max(0, o.v - o.c.valorConcorrente); }, 0);
      h += '<div class="fa-kpis">' +
        '<div class="fv-st"><div class="k">Perdidas com o preço dele</div><div class="v">' + F.int(L.length) + '</div><div class="s">de ' + F.int(per.length) + ' perdida(s) ' + esc(q) + '</div></div>' +
        '<div class="fv-st"><div class="k">Acima do concorrente (mediana)</div><div class="v neg">' + pctS(md) + '</div><div class="s">nosso valor ÷ o dele − 1</div></div>' +
        '<div class="fv-st"><div class="k">Para empatar</div><div class="v neg">' + F.mi(emp) + '</div><div class="s">de desconto nas oportunidades acima dele</div></div></div>';
      var fx = FAIXAS.map(function (f) { return { f: f, n: 0, v: 0 }; });
      L.forEach(function (o) { for (var i = 0; i < fx.length; i++) if ((o._gap > fx[i].f[2] && o._gap <= fx[i].f[3]) || (i === 0 && o._gap <= 0)) { fx[i].n++; fx[i].v += o.v; break; } });
      var maxN = Math.max.apply(null, fx.map(function (x) { return x.n; }).concat([1]));
      h += '<div class="fa-blk"><h5>Quanto acima do concorrente</h5>' + fx.filter(function (x) { return x.n; }).map(function (x) {
        var cor = x.f[0] === 'abaixo' ? '#2FBF71' : x.f[0] === 'f5' ? '#F2C14B' : x.f[0] === 'f15' ? '#F29B4B' : '#E4574C';
        return '<div class="fs-hb" title="' + esc(x.f[1] + ': ' + F.int(x.n) + ' ' + cot(x.n) + ' · ' + F.brl(x.v)) + '"><span class="nm">' + esc(x.f[1]) + '</span>' +
          '<span class="tr"><span class="cmp" style="width:' + Math.max(x.n / maxN * 100, 1).toFixed(2) + '%;"><i style="width:100%;background:' + cor + ';"></i></span></span>' +
          '<span class="vl"><b>' + F.int(x.n) + '</b> ' + cot(x.n) + '<span>' + F.mi(x.v) + '</span></span></div>';
      }).join('') + '</div>';
      var top = L.filter(function (o) { return o.v > o.c.valorConcorrente; }).sort(function (a, b) { return (b.v - b.c.valorConcorrente) - (a.v - a.c.valorConcorrente); }).slice(0, 5);
      if (top.length) h += '<div class="fa-blk"><h5>Onde estivemos mais longe (em R$)</h5><div class="fa-top">' + top.map(function (o) {
        return '<div class="fa-top-r" data-num="' + esc(o.id) + '" tabindex="0" title="' + esc(o.cliente + ' — clique para abrir a ficha') + '">' +
          '<span class="t">' + esc(o.cliente || o.id) + '</span><span class="s">' + esc(o.id + ' · ' + C.tituloCaso(o.c) + (o.c.concorrente ? ' · levou: ' + o.c.concorrente : '')) + '</span>' +
          '<span class="v"><b>' + pctS(o._gap) + '</b>' + brl0(o.v) + ' × ' + brl0(o.c.valorConcorrente) + '</span></div>';
      }).join('') + '</div></div>';
    }
    if (lq.length) {
      var maxQ = Math.max.apply(null, lq.map(function (k) { return quem[k].n; }).concat([1]));
      h += '<div class="fa-blk"><h5>Quem levou</h5>' + lq.slice(0, 6).map(function (k) {
        var x = quem[k];
        return '<div class="fs-hb" title="' + esc(k + ': ' + F.int(x.n) + ' ' + cot(x.n) + ' perdida(s) para ele · ' + F.brl(x.v) + ' cotados') + '"><span class="nm">' + esc(k) + '</span>' +
          '<span class="tr"><span class="cmp" style="width:' + Math.max(x.n / maxQ * 100, 1).toFixed(2) + '%;"><i style="width:100%;background:' + COR.per + ';"></i></span></span>' +
          '<span class="vl"><b>' + F.int(x.n) + '</b> ' + cot(x.n) + '<span>' + F.mi(x.v) + '</span></span></div>';
      }).join('') + '</div>';
    }
    host.innerHTML = h;
  }

  /* ── resultado dos itens ──────────────────────────────────────── */
  function pintarResultados(c, T) {
    var met = c.met, host = $('re-host'), nota = $('re-nota'), q = c.quando();
    var val = function (x) { return met === 'n' ? x.n : x.v; };
    var I = filtra(T, 'res');
    if (!I.length) { host.innerHTML = '<div class="fa-vz">Nenhum item nas cotadas ' + esc(q) + ' com os filtros escolhidos.</div>'; nota.innerHTML = ''; return; }
    var m = {};
    I.forEach(function (it) { var x = m[it.res] || (m[it.res] = { k: it.res, n: 0, v: 0 }); x.n++; x.v += it.v; });
    var ls = Object.keys(RES).filter(function (k) { return m[k]; }).map(function (k) { return m[k]; });
    var max = Math.max.apply(null, ls.map(val).concat([1])), rsel = UI.sel.res, tot = nv(I);
    host.innerHTML = '<div class="fa-blk" style="margin-top:12px;">' + ls.map(function (x) {
      var r = RES[x.k];
      return '<div class="fs-hb cl' + (rsel === x.k ? ' on' : rsel ? ' dim' : '') + '" role="button" tabindex="0" data-ca-res="' + x.k + '" title="' + esc(r[0] + ' (' + r[3] + '): ' + F.int(x.n) + ' ' + ite(x.n) + ' · ' + F.brl(x.v) + ' — clique para filtrar') + '">' +
        '<span class="nm">' + esc(r[0]) + '</span>' +
        '<span class="tr"><span class="cmp" style="width:' + Math.max(val(x) / max * 100, 1).toFixed(2) + '%;"><i style="width:100%;background:' + r[1] + ';"></i></span></span>' +
        '<span class="vl"><b>' + F.int(x.n) + '</b> ' + ite(x.n) + '<span>' + F.mi(x.v) + ' · ' + pct0(tot.v ? x.v / tot.v : 0) + '</span></span></div>';
    }).join('') + '</div>';
    var marc = I.filter(function (it) { return it.marca; }).length;
    nota.innerHTML = 'Sem a marca no item, vale o da oportunidade: virou pedido (Ganha) = ganho; Perdida = perdido; em aberto = em andamento. ' +
      '<b>' + F.int(marc) + '</b> de ' + F.int(I.length) + ' ' + ite(I.length) + ' com o resultado marcado no caso (Gestão de Oportunidades › Itens cotados).';
  }

  /* ── a lista: por cotação · por item ──────────────────────────── */
  var ROT_SIT = {
    cot: { tudo: 'Todas', and: 'Em aberto', gan: 'Ganhas', per: 'Perdidas' },
    item: { tudo: 'Todos', and: 'Em andamento', gan: 'Ganhos', per: 'Perdidos' }
  };
  var COLS_C = [
    { k: 'dia', l: 'Data' }, { k: 'id', l: 'Oportunidade', dica: 'o número no portal · embaixo, o cliente' },
    { k: 'fase', l: 'Fase hoje', dica: 'a fase de hoje · embaixo, quantos itens' },
    { k: '_its', l: 'Itens', num: true, dica: 'itens ganhos ✓, perdidos ✗ e em andamento ◦' },
    { k: '_mot', l: 'Principal motivo', dica: 'o motivo que mais pesou (em R$) entre os itens perdidos' },
    { k: '_gap', l: 'Dist. conc.', num: true, dica: 'a distância do concorrente: nosso valor cotado ÷ o preço dele − 1 (as perdidas com o preço do concorrente)' },
    { k: 'v', l: 'Cotado', num: true }, { k: '_vg', l: 'Ganho', num: true, dica: 'o valor dos itens ganhos' }, { k: '_vp', l: 'Perdido', num: true, dica: 'o valor dos itens perdidos' }
  ];
  var COLS_I = [
    { k: 'dia', l: 'Data' }, { k: 'id', l: 'Oportunidade' }, { k: 'prod', l: 'Item' }, { k: 'fam', l: 'Família' },
    { k: 'res', l: 'Resultado' }, { k: 'mot', l: 'Motivo' }, { k: 'qtd', l: 'Qtd', num: true },
    { k: 'vu', l: 'Valor unit.', num: true, dica: 'o preço unitário cotado: o valor do item ÷ a quantidade' }, { k: 'v', l: 'Valor', num: true }
  ];
  function cabec(cols, padrao) {
    $('ls-head').innerHTML = '<tr>' + cols.map(function (col) {
      var seta = UI.ord && UI.ord.k === col.k ? '<span class="seta">' + (UI.ord.d === 1 ? '▲' : '▼') + '</span>' : (!UI.ord && col.k === padrao ? '<span class="seta">▼</span>' : '');
      return '<th class="ord' + (col.num ? '' : ' tx') + '" data-k="' + col.k + '" title="' + esc(col.dica || ('ordenar por ' + col.l.toLowerCase())) + '">' + esc(col.l) + seta + '</th>';
    }).join('') + '</tr>';
  }
  function ordenar(ls, padrao, valor) {
    var o = UI.ord || { k: padrao, d: -1 };
    return ls.slice().sort(function (a, b) {
      var x = valor(a, o.k), y = valor(b, o.k), vx = x == null || x === '', vy = y == null || y === '';
      if (vx || vy) return vx && vy ? 0 : (vx ? 1 : -1);
      if (typeof x === 'number' && typeof y === 'number') return o.d * (x - y);
      return o.d * String(x).localeCompare(String(y), 'pt-BR', { numeric: true });
    });
  }
  function buscaOk(txt) { var q = C.norm(UI.busca).trim(); return !q || C.norm(txt).indexOf(q) >= 0; }
  function pintarLista(c, T) {
    var q = c.quando();
    Array.prototype.forEach.call(D.querySelectorAll('#ls-grao [data-grao]'), function (b) { b.classList.toggle('on', b.getAttribute('data-grao') === UI.grao); });
    var I = filtra(T), cont = { and: 0, gan: 0, per: 0, tudo: 0 };
    if (UI.grao === 'cot') {
      var comIt = {}; I.forEach(function (it) { comIt[it.o.id] = 1; });
      c.ls.forEach(function (o) { if (temSel() && !comIt[o.id]) return; cont.tudo++; cont[o.sit]++; });
    } else I.forEach(function (it) { cont.tudo++; cont[it.sit]++; });
    Array.prototype.forEach.call(D.querySelectorAll('#ls-sit [data-sit]'), function (b) {
      var k = b.getAttribute('data-sit'); b.classList.toggle('on', k === UI.sit);
      b.innerHTML = ROT_SIT[UI.grao][k] + ' <small>' + F.int(cont[k]) + '</small>';
    });
    var s = UI.sel, chips = [];
    if (s.grp) chips.push(['grp', GI[s.grp].nome]);
    if (s.mot) chips.push(['mot', s.mot]);
    if (s.res) chips.push(['res', RES[s.res][0]]);
    $('ls-sel').innerHTML = chips.map(function (x) { return '<button type="button" class="fa-chip on" data-ca-rm="' + x[0] + '" title="tirar este recorte">' + esc(x[1]) + '<span class="x">✕</span></button>'; }).join('');
    var nomeSit = UI.grao === 'cot' ? { tudo: 'cotadas', and: 'em aberto', gan: 'ganhas', per: 'perdidas' }[UI.sit] : { tudo: '', and: 'em andamento', gan: 'ganhos', per: 'perdidos' }[UI.sit];
    setT('ls-tt', UI.grao === 'cot' ? 'Oportunidades ' + nomeSit + ' ' + q : 'Itens ' + (nomeSit ? nomeSit + ' ' : '') + 'das cotadas ' + q);
    setT('ls-sub', UI.grao === 'cot'
      ? 'uma linha por oportunidade — as mesmas do Funil · os itens dela somados · clique para abrir a ficha'
      : 'uma linha por item · ' + (UI.sit === 'per' ? 'os perdidos, com o motivo' : UI.sit === 'gan' ? 'os ganhos' : UI.sit === 'and' ? 'os ainda sem resultado' : 'ganhos, perdidos e em andamento') + ' · clique para abrir a ficha da oportunidade');
    if (UI.grao === 'cot') listaCot(c, I); else listaItem(c, I);
  }
  function celDia(c, o) {
    if (!o.dia) return '<td class="tx dt z"><b>sem data</b></td>';
    var n = difDias(c.hoje, o.dia), rel = n === 0 ? 'hoje' : n === -1 ? 'ontem' : n < 0 ? 'há ' + F.int(-n) + ' dias' : 'em ' + F.int(n) + ' dias';
    return '<td class="tx dt' + (n === 0 ? ' hoje' : '') + '"><b>' + F.data(o.dia) + '</b><span>' + S.dsem(o.dia) + ' · ' + rel + '</span></td>';
  }
  function badge(o) { var f = C.fase(o.fase); return '<span class="fv-badge" style="--c:' + f.cor + ';" title="' + esc(f.nome) + '"><i></i>' + esc(f.nome) + '</span>'; }
  function celGap(g) {
    if (g == null) return '<td class="gp dim">—</td>';
    return '<td class="gp ' + (g > 0.15 ? 'alto' : g <= 0 ? 'baixo' : '') + '">' + pctS(g) + '</td>';
  }
  function maisLinhas(resto, total) {
    var mais = $('ls-mais'); mais.hidden = resto <= 0;
    if (resto > 0) mais.textContent = 'Mostrar mais ' + F.int(Math.min(LS_PASSO, resto)) + ' · faltam ' + F.int(resto) + ' de ' + F.int(total);
  }
  function listaCot(c, I) {
    var porO = {}; I.forEach(function (it) { (porO[it.o.id] || (porO[it.o.id] = [])).push(it); });
    var linhas = c.ls.filter(function (o) {
      if (temSel() && !porO[o.id]) return false;
      if (UI.sit !== 'tudo' && o.sit !== UI.sit) return false;
      var its = porO[o.id] || [];
      return buscaOk([o.id, o.c.cotacaoId, o.portal, o.cliente, o.uf, o.dono, o.unidade, C.fase(o.fase).nome, o.c.perda].concat(its.map(function (it) { return it.prod + ' ' + it.cod + ' ' + (it.mot || '') + ' ' + it.fam; })).join(' '));
    }).map(function (o) {
      var its = porO[o.id] || [], G = its.filter(function (it) { return it.sit === 'gan'; }), P = its.filter(function (it) { return it.sit === 'per'; }), A = its.filter(function (it) { return it.sit === 'and'; });
      var pm = {}; P.forEach(function (it) { pm[it.mot] = (pm[it.mot] || 0) + it.v; });
      var mots = Object.keys(pm).sort(function (a, b) { return pm[b] - pm[a]; });
      var gap = o.fase === 'perdida' && Number(o.c.valorConcorrente) > 0 && o.v > 0 ? o.v / Number(o.c.valorConcorrente) - 1 : null;
      return { o: o, ng: G.length, np: P.length, na: A.length, _its: its.length, _vg: nv(G).v, _vp: nv(P).v, _mot: mots[0] || null, nmot: mots.length, _gap: gap };
    });
    var valor = function (r, k) { return k.charAt(0) === '_' ? r[k] : k === 'fase' ? C.FASES.map(function (f) { return f.id; }).indexOf(r.o.fase) : r.o[k]; };
    var padrao = UI.sit === 'gan' ? '_vg' : UI.sit === 'per' ? '_vp' : 'v';
    var ord = ordenar(linhas, padrao, valor);
    cabec(COLS_C, padrao);
    var tv = linhas.reduce(function (a, r) { return a + r.o.v; }, 0), tg = linhas.reduce(function (a, r) { return a + r._vg; }, 0), tp = linhas.reduce(function (a, r) { return a + r._vp; }, 0);
    setT('ls-info', F.int(linhas.length) + ' ' + cot(linhas.length) + ' · ' + F.mi(tv) + ' · itens ganhos ' + F.mi(tg) + ' · perdidos ' + F.mi(tp));
    var body = $('ls-body'), foot = $('ls-foot');
    if (!linhas.length) { body.innerHTML = '<tr><td class="tx dim ng-vz" colspan="' + COLS_C.length + '">' + (UI.busca.trim() ? 'Nada com “' + esc(UI.busca.trim()) + '”.' : 'Nenhuma oportunidade neste recorte.') + '</td></tr>'; foot.innerHTML = ''; $('ls-mais').hidden = true; return; }
    var vis = ord.slice(0, UI.lim);
    body.innerHTML = vis.map(function (r) {
      var o = r.o, g = r._mot ? grupoDe(r._mot) : null;
      return '<tr data-num="' + esc(o.id) + '" tabindex="0">' + celDia(c, o) +
        '<td class="tx nm" title="' + esc(o.id + ' · ' + o.cliente) + ' — clique para abrir a ficha"><span class="t">' + esc(o.id) + '</span><span class="s">' + esc(o.cliente || C.tituloCaso(o.c)) + '</span></td>' +
        '<td class="tx fz">' + badge(o) + '<span class="s">' + (r._its ? F.int(r._its) + ' ' + ite(r._its) : 'sem itens') + '</span></td>' +
        '<td class="its" title="' + esc(F.int(r.ng) + ' ganho(s) · ' + F.int(r.np) + ' perdido(s) · ' + F.int(r.na) + ' em andamento') + '">' + (r._its ? [r.ng && '<b class="g">' + F.int(r.ng) + '</b> ✓', r.np && '<b class="p">' + F.int(r.np) + '</b> ✗', r.na && '<b class="a">' + F.int(r.na) + '</b> ◦'].filter(Boolean).join(' · ') : '<span class="dim">—</span>') + '</td>' +
        (r._mot ? '<td class="tx mot" title="' + esc(r._mot + (r.nmot > 1 ? ' (e mais ' + (r.nmot - 1) + ')' : '')) + '"><span class="t"><i class="fa-dot" style="background:' + g.cor + ';"></i>' + esc(r._mot) + '</span>' + (r.nmot > 1 ? '<span class="fa-sub">+ ' + (r.nmot - 1) + ' outro' + (r.nmot > 2 ? 's' : '') + '</span>' : '') + '</td>' : '<td class="tx mot dim">—</td>') +
        celGap(r._gap) + '<td class="forte">' + brl0(o.v) + '</td>' +
        '<td class="' + (r._vg ? 'pos' : 'dim') + '">' + brl0(r._vg) + '</td><td class="' + (r._vp ? 'neg' : 'dim') + '">' + brl0(r._vp) + '</td></tr>';
    }).join('');
    foot.innerHTML = '<tr><td class="tx" colspan="6">Total · ' + F.int(linhas.length) + ' ' + cot(linhas.length) + '</td><td>' + brl0(tv) + '</td><td>' + brl0(tg) + '</td><td>' + brl0(tp) + '</td></tr>';
    maisLinhas(ord.length - vis.length, ord.length);
  }
  function listaItem(c, I) {
    var linhas = I.filter(function (it) {
      if (UI.sit !== 'tudo' && it.sit !== UI.sit) return false;
      var o = it.o;
      return buscaOk([o.id, o.c.cotacaoId, o.portal, o.cliente, o.dono, o.unidade, it.prod, it.cod, it.fam, RES[it.res][0], it.mot].join(' '));
    });
    var valor = function (it, k) { return k === 'dia' || k === 'id' ? it.o[k] : k === 'res' ? RES[it.res][0] : it[k]; };
    var ord = ordenar(linhas, 'v', valor);
    cabec(COLS_I, 'v');
    var tv = nv(linhas).v;
    setT('ls-info', F.int(linhas.length) + ' ' + ite(linhas.length) + ' · ' + F.mi(tv));
    var body = $('ls-body'), foot = $('ls-foot');
    if (!linhas.length) { body.innerHTML = '<tr><td class="tx dim ng-vz" colspan="' + COLS_I.length + '">' + (UI.busca.trim() ? 'Nada com “' + esc(UI.busca.trim()) + '”.' : 'Nenhum item neste recorte.') + '</td></tr>'; foot.innerHTML = ''; $('ls-mais').hidden = true; return; }
    var vis = ord.slice(0, UI.lim);
    body.innerHTML = vis.map(function (it) {
      var o = it.o, g = it.g ? GI[it.g] : null, r = RES[it.res];
      return '<tr data-num="' + esc(o.id) + '" tabindex="0">' + celDia(c, o) +
        '<td class="tx nm" title="' + esc(o.id + ' · ' + o.cliente) + ' — clique para abrir a ficha"><span class="t">' + esc(o.id) + '</span><span class="s">' + esc(o.cliente || '') + '</span></td>' +
        '<td class="tx nm" title="' + esc(it.prod) + '"><span class="t">' + esc(it.prod) + '</span>' + (it.cod ? '<span class="s">' + esc(it.cod) + '</span>' : '') + '</td>' +
        '<td class="tx fam" title="' + esc(it.fam) + '">' + esc(it.fam === SEMFAM ? '—' : it.fam) + '</td>' +
        '<td class="tx"><span class="fa-rb" title="' + esc(r[3]) + '" style="background:' + S.hexA(r[1], 0.16) + ';color:' + (r[2] === 'gan' ? '#22794C' : r[2] === 'per' ? '#B54545' : '#3C7889') + ';"><i style="background:' + r[1] + ';"></i>' + esc(r[0]) + '</span></td>' +
        (it.mot ? '<td class="tx mot" title="' + esc(it.mot + ' · ' + g.nome) + '"><span class="t"><i class="fa-dot" style="background:' + g.cor + ';"></i>' + esc(it.mot) + '</span></td>' : '<td class="tx mot dim">—</td>') +
        '<td>' + C.qtd(it.qtd) + '</td><td>' + (it.vu != null ? F.brl(it.vu) : '<span class="dim">—</span>') + '</td><td class="forte">' + brl0(it.vu != null ? it.v : it.v) + '</td></tr>';
    }).join('');
    // o rodapé: com um SKU só (a busca por ele), a quantidade e o preço médio cotado
    var umSku = linhas.every(function (it) { return it.skuK === linhas[0].skuK; }), tq = linhas.reduce(function (a, it) { return a + it.qtd; }, 0);
    foot.innerHTML = '<tr><td class="tx" colspan="6">Total · ' + F.int(linhas.length) + ' ' + ite(linhas.length) + (umSku && tq > 0 ? ' · o valor unit. é o preço médio cotado' : '') + '</td>' +
      '<td>' + (umSku ? C.qtd(tq) : '') + '</td><td>' + (umSku && tq > 0 ? F.brl(tv / tq) : '') + '</td><td>' + brl0(tv) + '</td></tr>';
    maisLinhas(ord.length - vis.length, ord.length);
  }

  /* ══════════════════════════════════════════════════════════════
     A FAMÍLIA DOS PRODUTOS (uma vez por carga — o servidor guarda em cache)
     ══════════════════════════════════════════════════════════════ */
  function carregarFamilias(forcar) {
    var cods = {};
    (S.dados().objs || []).forEach(function (o) { (o.c.itensRes || []).forEach(function (x) { if (x[0]) cods[codFam(x[0])] = 1; }); });
    var sig = Object.keys(cods).sort().join('|');
    if (!forcar && (FAM.estado === 'carga' || (FAM.estado === 'ok' && FAM.sig === sig))) return;
    FAM.estado = 'carga'; FAM.sig = sig;
    C.api('cot-casos?familias=1').then(function (j) {
      FAM.map = (j && j.familias) || {}; FAM.motivo = (j && j.motivo) || ''; FAM.estado = 'ok'; FAM.v++;
      S.repintar();
    }).catch(function (e) {
      FAM.estado = 'erro'; FAM.motivo = (e && e.message) || 'o servidor não respondeu'; FAM.v++;
      S.repintar();
    });
  }

  /* ══════════════════════════════════════════════════════════════
     EVENTOS (os comuns — filtros, semana, Valor × Itens, a ficha — ficam
     no motor)
     ══════════════════════════════════════════════════════════════ */
  function repinta() { if (UC) render(UC); }
  function trocaSel(k, v) { UI.sel[k] = UI.sel[k] === v ? null : v; if (k === 'grp') UI.sel.mot = null; UI.lim = LS_PASSO; repinta(); }
  function irLista(grao, sit) {
    UI.grao = grao; salvarSS('grao', grao); UI.sit = sit; salvarSS('sit', sit); UI.ord = null; UI.lim = LS_PASSO; repinta();
    var el = $('ls-card'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  var app = $('cot-app');
  app.addEventListener('click', function (e) {
    var t = e.target; if (!t || !t.closest || !UC) return;
    var x;
    if ((x = t.closest('[data-ca-neg]'))) { irLista('cot', x.getAttribute('data-ca-neg')); return; }
    if ((x = t.closest('[data-ca-grp]'))) { trocaSel('grp', x.getAttribute('data-ca-grp')); return; }
    if ((x = t.closest('[data-ca-mot]'))) { trocaSel('mot', x.getAttribute('data-ca-mot')); return; }
    if ((x = t.closest('[data-ca-res]'))) { trocaSel('res', x.getAttribute('data-ca-res')); return; }
    // a família abre os SKUs; o SKU leva à lista por item naquela situação, buscando por ele
    if ((x = t.closest('[data-ca-sf]'))) { var sk = x.getAttribute('data-ca-sf'); UI.drill[sk] = x.getAttribute('data-fam'); UI.aberto['s' + sk] = false; repinta(); focar('[data-ca-sfv="' + sk + '"]'); return; }
    if ((x = t.closest('[data-ca-sfv]'))) { var sv = x.getAttribute('data-ca-sfv'); UI.drill[sv] = null; repinta(); return; }
    if ((x = t.closest('[data-ca-sku]'))) { var bq = x.getAttribute('data-q') || ''; UI.busca = bq; $('ls-busca').value = bq; irLista('item', x.getAttribute('data-ca-sku')); return; }
    if ((x = t.closest('[data-ca-rm]'))) { UI.sel[x.getAttribute('data-ca-rm')] = null; repinta(); return; }
    if ((x = t.closest('[data-ca-abrir]'))) { var k = x.getAttribute('data-ca-abrir'); UI.aberto[k] = !UI.aberto[k]; repinta(); return; }
    if ((x = t.closest('[data-ca-lista]'))) { irLista('item', x.getAttribute('data-ca-lista')); return; }
    if ((x = t.closest('#ls-grao [data-grao]'))) { UI.grao = x.getAttribute('data-grao'); salvarSS('grao', UI.grao); UI.ord = null; UI.lim = LS_PASSO; repinta(); return; }
    if ((x = t.closest('#ls-sit [data-sit]'))) { UI.sit = x.getAttribute('data-sit'); salvarSS('sit', UI.sit); UI.ord = null; UI.lim = LS_PASSO; repinta(); return; }
    if ((x = t.closest('#ls-head th[data-k]'))) {
      var kk = x.getAttribute('data-k'), col = COLS_C.concat(COLS_I).filter(function (y) { return y.k === kk; })[0], d0 = col && col.num ? -1 : 1;
      if (UI.ord && UI.ord.k === kk) UI.ord = UI.ord.d === d0 ? { k: kk, d: -d0 } : null;
      else UI.ord = { k: kk, d: d0 };
      UI.lim = LS_PASSO; pintarLista(UC, todosItens(UC)); return;
    }
    if ((x = t.closest('#ls-mais'))) { UI.lim += LS_PASSO; pintarLista(UC, todosItens(UC)); }
  });
  app.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var t = e.target; if (!t || !t.closest) return;
    var x = t.closest('[data-ca-lista],[data-ca-grp].fs-mv,.fs-hb.cl,.fa-sku-r');
    if (x && x === t) { e.preventDefault(); x.click(); }
  });
  var _tb = null;
  $('ls-busca').addEventListener('input', function (e) {
    var v = e.target.value; clearTimeout(_tb);
    _tb = setTimeout(function () { UI.busca = v; UI.lim = LS_PASSO; if (UC) pintarLista(UC, todosItens(UC)); }, 160);
  });

  /* ── utilitários ──────────────────────────────────────────────── */
  function lerSS(k, ok, padrao) { try { var v = sessionStorage.getItem('cot-ana-' + k); return ok.indexOf(v) >= 0 ? v : padrao; } catch (e) { return padrao; } }
  function salvarSS(k, v) { try { sessionStorage.setItem('cot-ana-' + k, v); } catch (e) {} }
  function focar(sel) { try { var e = D.querySelector(sel); if (e && e.focus) e.focus({ preventScroll: true }); } catch (er) {} }

  S.pagina({
    render: render, vazio: vazio,
    navInfo: function (c) {
      return 'Oportunidades com a <b>data da cotação</b> ' + (c.foco.length ? 'de segunda a domingo' : 'no período todo') + ' — as mesmas do <b>Funil</b> — e os <b>itens</b> de cada uma, com o resultado (o marcado no caso ou o da oportunidade)' +
        (c.foco.length ? '' : ' · as setas avaliam uma semana');
    },
    dados: function () { carregarFamilias(false); },
    recarregar: function () { carregarFamilias(true); },
    limpar: function () { UI.sel = { grp: null, mot: null, res: null }; UI.busca = ''; UI.drill = { gan: null, and: null, per: null }; var b = $('ls-busca'); if (b) b.value = ''; }
  });
})();
