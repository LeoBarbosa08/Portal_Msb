/* ================================================================
   cotacoes-semana.js — o MOTOR do Funil e do Analítico das Cotações
     pages/comercial-cot-funil.html      Funil (cotacoes-funil.js)
     pages/comercial-cot-analitico.html  Analítico (cotacoes-analitico.js)

   20/10/2026 (pedido do usuário): "seguindo a ideia do funil de vendas da
   licitação — a visão semana a semana e o mês fechado em comparativo com o
   ano passado, as cotações embaixo com a ficha à direita, a participação de
   cada um respeitando a área de cada um, as cotações por área e, no
   analítico, os itens ganhos e perdidos". É o molde do motor do Funil de
   Vendas (licitacao-funil-vendas.js, o mesmo CSS: .fv-, .fs-, .fc- e .gd-),
   com a fonte das cotações: o índice do /api/cot-casos (o resumo de cada
   cotação, com os itens e o resultado deles). Tudo é agregado AQUI.

   A ÁREA: o servidor só manda as cotações da(s) unidade(s) de negócio da
   pessoa (o RLS dela no Power BI; o dono vê todas) — a página nunca vê a
   cotação de outra unidade.

   A SEMANA da cotação = a da DATA DA COTAÇÃO (a do portal; sem ela, o dia em
   que foi registrada), de segunda a domingo. A situação é a de HOJE:
     and  em aberto = Cotada
     gan  ganha     = Virou pedido
     per  perdida   = Perdida (não virou pedido — 21/10/2026: a Vencida e a Cancelada são motivos dela)
   Cotadas = todas; taxa de ganho = ganhas ÷ cotadas.

   O estado (filtros, a JANELA de semanas, a semana AVALIADA e Valor ×
   Quantidade) atravessa as duas abas por sessionStorage. A semana avaliada
   de fábrica é ESTA (a cotação é do dia a dia).

   Uso: COTS.pagina({ render(ctx), vazio(msg) })
   ================================================================ */
(function () {
  'use strict';
  var C = window.COT; if (!C) return;
  var D = document, W = window, $ = C.$, esc = C.esc, IC = C.IC;

  var COR = { ag: '#367D8E', and: '#77B2C0', gan: '#2FBF71', per: '#E4574C' };
  var NOME = { ag: 'Cotadas', and: 'Em aberto', gan: 'Ganhas', per: 'Perdidas' };
  var UM = { ag: ['cotada', 'cotadas'], and: ['em aberto', 'em aberto'], gan: ['ganha', 'ganhas'], per: ['perdida', 'perdidas'] };
  var DICA = {
    ag: 'oportunidades com a data da cotação no período',
    and: 'ainda sem resultado — Cotada ou A faturar',
    gan: 'viraram pedido',
    per: 'não viraram pedido — Perdida (inclui proposta vencida e cancelada)'
  };
  // o período (como o do Funil de Participação da Licitação): atalhos de
  // semanas inteiras ou De/Até livre — sempre pela DATA DA COTAÇÃO
  var PRESETS = [
    { id: 'u4', label: 'Últimas 4 semanas' },
    { id: 'u8', label: 'Últimas 8 semanas' },
    { id: 'u12', label: 'Últimas 12 semanas' },
    { id: 'u26', label: 'Últimas 26 semanas' },
    { id: 'a', label: 'Este ano' }
  ];
  var PER0 = 'u8';
  // os botões ao lado do período: a semana avaliada (dá para marcar mais de uma)
  var SEMANAS = [
    { d: -7, label: 'Semana −1', dica: 'a semana passada' },
    { d: 0, label: 'Semana 0', dica: 'esta semana' },
    { d: 7, label: 'Semana +1', dica: 'a semana que vem' }
  ];
  var SS = 'cot-semana-v1', SEM = '(sem)';
  var DS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  /* ── datas (dia = 'AAAA-MM-DD', no fuso do navegador) ─────────── */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hoje() { return iso(new Date()); }
  function addDias(s, n) { var d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  function difDias(a, b) { return Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86400000); }
  function segunda(s) { var d = new Date(String(s).slice(0, 10) + 'T12:00:00'); if (isNaN(d)) return ''; d.setDate(d.getDate() - (d.getDay() + 6) % 7); return iso(d); }
  function isoSemana(s) {
    var d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
    var dia = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - dia);
    var y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - y0) / 86400000 + 1) / 7);
  }
  function dm(s) { return s ? s.slice(8, 10) + '/' + s.slice(5, 7) : ''; }
  function dsem(s) { return DS[new Date(s + 'T12:00:00').getDay()]; }
  // o dia da cotação: a DATA DA COTAÇÃO (a do portal); sem ela, o dia em que
  // foi registrada (no fuso de Brasília, como o servidor)
  function diaDe(c) {
    var d = String(c.dataCotacao || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    var t = C.ms(c.criadoEm);
    return t ? new Date(t - 3 * 3600e3).toISOString().slice(0, 10) : '';
  }

  /* ── formatação ───────────────────────────────────────────────── */
  var F = {
    mi: C.brlCurto, int: C.int, brl: C.brl,
    pct: function (x, d) { return x == null || !isFinite(x) ? '—' : C.pct(x, d == null ? 1 : d); },
    data: function (s) { return s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '—'; },
    dia: function (s) { return s ? dsem(s) + ' ' + dm(s) : ''; },
    mes: function (ym, comAno) { if (!ym) return ''; return MESES[+ym.slice(5, 7) - 1] + (comAno === false ? '' : '/' + ym.slice(2, 4)); }
  };
  function nf1(v) { return (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }); }
  function brl0(v) { return 'R$ ' + Math.round(Number(v) || 0).toLocaleString('pt-BR'); }
  // rótulo de dado do gráfico: curto, sem o "R$" (o valor inteiro fica na dica)
  function curto(v) {
    v = Number(v) || 0; var a = Math.abs(v);
    var f = function (x, d) { return x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }); };
    if (a >= 1e9) return f(v / 1e9, 1) + ' Bi';
    if (a >= 1e6) return f(v / 1e6, a >= 1e7 ? 0 : 1) + ' Mi';
    if (a >= 1e3) return f(v / 1e3, 0) + ' mil';
    return f(v, 0);
  }
  function tinta(hex) {
    var h = String(hex).replace('#', ''); if (h.length === 3) h = h.split('').map(function (x) { return x + x; }).join('');
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#10323E' : '#fff';
  }
  function hexA(hex, a) { var h = String(hex).replace('#', ''); return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'; }
  function pl(n, par) { return n === 1 ? par[0] : par[1]; }
  function setT(id, t) { var e = $(id); if (e) e.textContent = t; }
  function setH(id, h) { var e = $(id); if (e) e.innerHTML = h; }

  /* ── estado ───────────────────────────────────────────────────── */
  // foco = as semanas avaliadas (segundas); null = de fábrica (esta semana);
  // [] = o período todo. per = o período: um atalho (p) andado `off` semanas
  // para trás pelas setas do gráfico, ou p '' com De/Até
  var ST = { f: { portal: '', dono: '', unidade: '' }, foco: null, per: { p: PER0, de: '', ate: '', off: 0 }, met: 'v' };
  var DIA = /^\d{4}-\d{2}-\d{2}$/;
  try {
    var salvo = JSON.parse(sessionStorage.getItem(SS) || 'null');
    if (salvo) {
      if (salvo.f) ST.f = Object.assign(ST.f, salvo.f);
      if (Array.isArray(salvo.foco)) ST.foco = salvo.foco.filter(function (s) { return DIA.test(s); });
      var sp = salvo.per;
      if (sp && (sp.p === '' || PRESETS.some(function (x) { return x.id === sp.p; }))) {
        ST.per = { p: sp.p, de: DIA.test(sp.de || '') ? sp.de : '', ate: DIA.test(sp.ate || '') ? sp.ate : '', off: Math.max(0, Math.round(Number(sp.off) || 0)) };
      }
      if (salvo.met === 'n') ST.met = 'n';
    }
  } catch (e) {}
  function guardar() { try { sessionStorage.setItem(SS, JSON.stringify(ST)); } catch (e) {} }
  function fimHoje() { return segunda(hoje()); }
  // o período em segundas (de/ate = a primeira e a última semana), sem a +1
  function janelaBase() {
    var segH = fimHoje(), P = ST.per, de, ate;
    if (P.p) {
      ate = addDias(segH, -7 * (P.off || 0));
      de = P.p === 'a' ? addDias(segunda(hoje().slice(0, 4) + '-01-01'), -7 * (P.off || 0)) : addDias(ate, -7 * Number(P.p.slice(1)));
    } else {
      ate = P.ate ? segunda(P.ate) : segH;
      if (ate > segH) ate = segH;
      de = P.de ? segunda(P.de) : addDias(ate, -7 * 8);
    }
    if (de > ate) de = ate;
    // dez anos no máximo (uma data digitada pela metade não trava a tela)
    if (difDias(de, ate) > 7 * 520) de = addDias(ate, -7 * 520);
    return { de: de, ate: ate };
  }
  // a Semana +1 avaliada estica o período até ela
  function janela() {
    var J = janelaBase(), prox = addDias(fimHoje(), 7);
    if (J.ate === fimHoje() && ST.foco && ST.foco.indexOf(prox) >= 0) J.ate = prox;
    return J;
  }
  function janelaFim() { return janela().ate; }
  function semanas() { var J = janela(), out = []; for (var s = J.de; s <= J.ate; s = addDias(s, 7)) out.push(s); return out; }
  function focoAtual() { return ST.foco == null ? [fimHoje()] : ST.foco.slice().sort(); }
  function nomePeriodo() {
    var P = ST.per, J = janelaBase();
    var pre = P.p && PRESETS.filter(function (x) { return x.id === P.p; })[0];
    if (pre) return pre.label + (P.off ? ' · até ' + dm(addDias(J.ate, 6)) : '');
    return F.data(J.de) + ' – ' + F.data(addDias(J.ate, 6));
  }

  var DADOS = { casos: [], objs: [], porNumero: {}, rev: null, cfg: null, eu: null, carregou: false, configurado: true, erro: null, lidoEm: null };
  var PAG = null;

  /* ── as cotações em objetos da página ─────────────────────────── */
  function sitDe(fase) { var f = C.fase(fase); return f.aberta ? 'and' : f.ganha ? 'gan' : 'per'; }
  function objeto(c) {
    var dia = diaDe(c);
    return {
      c: c, id: c.numero, dia: dia, semana: dia ? segunda(dia) : '', mes: dia.slice(0, 7), fase: C.faseDe(c), sit: sitDe(C.faseDe(c)),
      v: Number(c.total) || 0, vPed: c.fase === 'pedido' ? (Number(c.totalPedido) || Number(c.total) || 0) : 0,
      dono: c.dono ? (c.dono.nome || c.dono.email) : '', donoK: c.dono ? c.dono.email : SEM,
      portal: c.portal || '', unidade: c.unidade || '', cliente: (c.cliente && c.cliente.nome) || '', uf: (c.cliente && c.cliente.uf) || '',
      cidade: (c.cliente && c.cliente.cidade) || ''
    };
  }
  function passa(o) {
    var f = ST.f;
    if (o.c.descartado) return false;
    if (f.portal && (o.portal || SEM) !== f.portal) return false;
    if (f.dono && o.donoK !== f.dono) return false;
    if (f.unidade && (o.unidade || SEM) !== f.unidade) return false;
    return true;
  }
  // as quatro situações de uma lista
  function quatro(ls) {
    var r = { ag: { n: 0, v: 0 }, and: { n: 0, v: 0 }, gan: { n: 0, v: 0, vPed: 0 }, per: { n: 0, v: 0 } };
    for (var i = 0; i < ls.length; i++) { var o = ls[i]; r.ag.n++; r.ag.v += o.v; r[o.sit].n++; r[o.sit].v += o.v; if (o.sit === 'gan') r.gan.vPed += o.vPed; }
    return r;
  }
  function nv(ls) { var r = { n: 0, v: 0 }; for (var i = 0; i < ls.length; i++) { r.n++; r.v += ls[i].v; } return r; }
  // agrupa por uma chave, com as quatro situações de cada grupo
  function agrupar(ls, chaveFn, nomeFn) {
    var m = {};
    ls.forEach(function (o) {
      var k = chaveFn(o);
      if (!m[k]) m[k] = { k: k, nome: nomeFn ? nomeFn(o, k) : k, ls: [] };
      m[k].ls.push(o);
    });
    return Object.keys(m).map(function (k) { var g = m[k], q = quatro(g.ls); g.n = q.ag.n; g.v = q.ag.v; g.and = q.and; g.gan = q.gan; g.per = q.per; return g; });
  }

  /* ── o contexto da página ─────────────────────────────────────── */
  function quando(foco, curto) { return foco.length === 1 ? 'na semana' : foco.length ? 'nas ' + foco.length + ' semanas' : (curto ? 'no período' : 'no período todo'); }
  function rotuloFoco(foco, WK) {
    if (foco.length === 1) return 'na semana ' + isoSemana(foco[0]) + ' (' + dm(foco[0]) + ' a ' + dm(addDias(foco[0], 6)) + ')';
    if (foco.length) return 'nas semanas ' + foco.map(isoSemana).join(', ').replace(/, (\d+)$/, ' e $1');
    return 'no período' + (WK.length ? ' (' + dm(WK[0]) + ' a ' + dm(addDias(WK[WK.length - 1], 6)) + ')' : '');
  }
  function ctx() {
    var WK = semanas(), naJan = {};
    WK.forEach(function (s) { naJan[s] = 1; });
    var todas = DADOS.objs.filter(passa);
    var foco = focoAtual(), noFoco = {};
    foco.forEach(function (s) { noFoco[s] = 1; });
    var lsJ = todas.filter(function (o) { return naJan[o.semana]; });
    var ls = foco.length ? todas.filter(function (o) { return noFoco[o.semana]; }) : lsJ;
    return {
      hoje: hoje(), WK: WK, foco: foco, todas: todas, lsJ: lsJ, ls: ls, met: ST.met, f: ST.f, jan: WK.length,
      cfg: DADOS.cfg || {}, eu: DADOS.eu || {}, porNumero: DADOS.porNumero, lidoEm: DADOS.lidoEm,
      quando: function (c) { return quando(foco, c); }, rotuloFoco: function () { return rotuloFoco(foco, WK); },
      fimJanela: janelaFim(), noFim: janelaFim() >= fimHoje()
    };
  }

  /* ── filtros (barra do topo) ──────────────────────────────────── */
  function opcoesDe(chaveFn, rotuloFn) {
    var m = {};
    DADOS.objs.forEach(function (o) { if (o.c.descartado) return; var k = chaveFn(o); if (!m[k]) m[k] = { k: k, nome: rotuloFn(o, k), n: 0 }; m[k].n++; });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.n - a.n || String(a.nome).localeCompare(String(b.nome), 'pt-BR'); });
  }
  var SETA = '<svg class="cot-per-seta" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
  var perAberto = false;
  // a barra é montada uma vez; cada repintura só troca o que muda (a data
  // sendo digitada no De/Até não perde o foco)
  function montarFiltros(el) {
    el.innerHTML = '<div class="cot-per" id="cots-per">' +
        '<button type="button" class="cot-per-b" data-cots-per="abrir" aria-haspopup="true" aria-expanded="false"></button>' +
        '<div class="cot-per-p fv-per" role="dialog" aria-label="Período das oportunidades">' +
          '<div class="fv-per-k">Janela de semanas</div>' +
          '<div class="cot-per-h">Pela <b>data da cotação</b> — semanas inteiras, de segunda a domingo.</div>' +
          '<div class="fv-per-k">Atalhos</div>' +
          '<div class="fv-pre">' + PRESETS.map(function (x) { return '<button type="button" data-cots-pre="' + x.id + '">' + esc(x.label) + '</button>'; }).join('') + '</div>' +
          '<label>De <input type="date" data-cots-dt="de"></label>' +
          '<label>Até <input type="date" data-cots-dt="ate"></label>' +
          '<div class="cot-per-h">O período é o que o gráfico e a tabela mostram. A semana avaliada escolhe-se nos botões ao lado ou clicando na semana do gráfico.</div>' +
          '<div class="cot-per-f"><span></span><button type="button" data-cots-per="fechar">Fechar</button></div>' +
        '</div>' +
      '</div>' +
      '<div class="fv-sem cot-sem" id="cots-sem" role="group" aria-label="Semana avaliada — dá para marcar mais de uma">' +
        SEMANAS.map(function (x) { return '<button type="button" data-cots-sem="' + x.d + '" aria-pressed="false"></button>'; }).join('') +
        '<button type="button" data-cots-sem="todo" aria-pressed="false"></button>' +
      '</div>' +
      '<span class="cot-fsel" id="cots-fsel"></span><span class="fim" id="cots-fim"></span>';
  }
  function pintarFiltros() {
    var el = $('cot-filtros'); if (!el) return;
    if (!$('cots-per')) montarFiltros(el);
    var sel = function (id, rot, ops, atual, todos) {
      return '<label class="' + (atual ? 'on' : '') + '">' + esc(rot) + '<select data-cots-f="' + id + '"><option value="">' + esc(todos || 'Todos') + '</option>' +
        ops.map(function (o) { return '<option value="' + esc(o.k) + '"' + (o.k === atual ? ' selected' : '') + '>' + esc(o.nome) + ' (' + o.n + ')</option>'; }).join('') + '</select></label>';
    };
    // o período (o botão e o painel)
    var P = ST.per, J = janelaBase(), segH = fimHoje(), foco = focoAtual();
    var per = $('cots-per'), bt = per.querySelector('.cot-per-b');
    per.classList.toggle('open', perAberto); bt.setAttribute('aria-expanded', perAberto ? 'true' : 'false');
    bt.classList.toggle('has', P.p !== PER0 || !!P.off);
    bt.title = 'Oportunidades com a data da cotação de ' + F.data(J.de) + ' a ' + F.data(addDias(J.ate, 6));
    bt.innerHTML = IC.calendar + '<span class="k">Período</span><span class="v">' + esc(nomePeriodo()) + '</span>' + SETA;
    Array.prototype.forEach.call(per.querySelectorAll('[data-cots-pre]'), function (x) { x.classList.toggle('on', !P.off && x.getAttribute('data-cots-pre') === P.p); });
    Array.prototype.forEach.call(per.querySelectorAll('[data-cots-dt]'), function (x) {
      if (D.activeElement === x) return;
      x.value = x.getAttribute('data-cots-dt') === 'de' ? J.de : addDias(J.ate, 6);
    });
    // os botões da semana avaliada
    Array.prototype.forEach.call($('cots-sem').querySelectorAll('[data-cots-sem]'), function (x) {
      var k = x.getAttribute('data-cots-sem'), liga, tit, d0, d1, rot;
      if (k === 'todo') {
        var W = semanas(); d0 = W[0]; d1 = addDias(W[W.length - 1], 6);
        liga = !foco.length; rot = 'Período todo';
        tit = 'Avaliar o período todo — oportunidades com a data da cotação de ' + F.data(d0) + ' a ' + F.data(d1);
      } else {
        var s = SEMANAS.filter(function (y) { return String(y.d) === k; })[0];
        d0 = addDias(segH, s.d); d1 = addDias(d0, 6);
        liga = foco.indexOf(d0) >= 0; rot = s.label;
        tit = 'Avaliar ' + s.dica + ' — oportunidades com a data da cotação de ' + F.data(d0) + ' a ' + F.data(d1) +
          (liga ? ' · clique de novo para tirar' : ' · dá para marcar mais de uma junto');
      }
      x.classList.toggle('on', liga); x.setAttribute('aria-pressed', liga ? 'true' : 'false'); x.title = tit;
      x.innerHTML = '<span class="k">' + esc(rot) + '</span><span class="d">' + dm(d0) + '–' + dm(d1) + '</span>';
    });
    var portais = opcoesDe(function (o) { return o.portal || SEM; }, function (o, k) { return k === SEM ? 'Sem portal' : k; });
    var donos = opcoesDe(function (o) { return o.donoK; }, function (o, k) { return k === SEM ? 'Sem responsável' : o.dono; });
    // a unidade de negócio — o servidor só manda as da pessoa
    var unids = opcoesDe(function (o) { return o.unidade || SEM; }, function (o, k) { return k === SEM ? 'Sem unidade' : k; });
    var algum = ST.f.portal || ST.f.dono || ST.f.unidade || P.p !== PER0 || P.off || ST.foco != null;
    $('cots-fsel').innerHTML = sel('unidade', 'Unidade', unids, ST.f.unidade, 'Todas') + sel('portal', 'Portal', portais, ST.f.portal) + sel('dono', 'Responsável', donos, ST.f.dono);
    $('cots-fim').innerHTML = '<span class="info" id="cots-info"></span>' + (algum ? '<button type="button" class="cs-btn cs-btn-xs" data-cots="limpar">' + IC.x + 'Limpar filtros</button>' : '');
  }

  /* ── a semana avaliada (a faixa com as setas) ─────────────────── */
  function pintarNav(c) {
    var f = c.foco, segHoje = fimHoje(), WK = c.WK, tt, sm = '';
    if (f.length === 1) {
      var dif = Math.round(difDias(f[0], segHoje) / 7);
      tt = 'Semana ' + isoSemana(f[0]) + ' · ' + dm(f[0]) + ' a ' + dm(addDias(f[0], 6));
      sm = dif === 0 ? 'esta semana' : dif === 1 ? 'semana passada' : dif > 1 ? 'há ' + dif + ' semanas' : dif === -1 ? 'semana que vem' : '';
    } else if (f.length > 1) {
      var seguidas = f.every(function (s, i) { return !i || difDias(f[i - 1], s) === 7; });
      tt = seguidas ? 'Semanas ' + isoSemana(f[0]) + ' a ' + isoSemana(f[f.length - 1]) + ' · ' + dm(f[0]) + ' a ' + dm(addDias(f[f.length - 1], 6))
        : f.length + ' semanas · ' + f.map(function (s) { return 'S' + isoSemana(s); }).join(', ');
      sm = f.length + ' semanas juntas';
    } else {
      tt = 'Período todo · ' + WK.length + ' semanas';
      sm = WK.length ? dm(WK[0]) + ' a ' + dm(addDias(WK[WK.length - 1], 6)) : '';
    }
    var t = $('fs-tt'); if (t) t.innerHTML = esc(tt) + (sm ? '<small>' + esc(sm) + '</small>' : '');
    var info = $('fs-nav-i');
    // a página sem o gráfico (o Analítico) diz o texto dela nos dois casos
    if (info) info.innerHTML = PAG && PAG.navInfo ? PAG.navInfo(c) : f.length
      ? 'Oportunidades com a <b>data da cotação</b> de segunda a domingo — <b>cotadas</b> e quantas seguem <b>em aberto</b>, viraram pedido (<b>ganhas</b>) ou não viraram (<b>perdidas</b>) até hoje'
      : 'Clique numa semana do gráfico (ou use as setas) para avaliar só ela';
    var prev = $('fs-prev'), next = $('fs-next');
    if (!prev || !next) return;
    var alvoP = f.length ? addDias(f[0], -7) : WK[WK.length - 1];
    var alvoN = f.length ? addDias(f[f.length - 1], 7) : null;
    prev.disabled = !alvoP; prev.setAttribute('data-alvo', alvoP || '');
    next.disabled = !alvoN || alvoN > addDias(segHoje, 7); next.setAttribute('data-alvo', next.disabled ? '' : alvoN);
    prev.title = alvoP ? 'Semana anterior (' + dm(alvoP) + ')' + (WK.indexOf(alvoP) < 0 ? ' — o período anda junto' : '') : '';
    next.title = next.disabled ? (f.length ? 'Esta já é a semana que vem (Semana +1)' : 'Escolha uma semana primeiro') : 'Semana seguinte (' + dm(alvoN) + ')' + (WK.indexOf(alvoN) < 0 ? ' — o período anda junto' : '');
  }

  /* ── ações do estado ──────────────────────────────────────────── */
  // anda o período k semanas (k < 0 = para trás), o mesmo tamanho, sem
  // passar desta semana: o atalho guarda o tanto que andou (off)
  function andar(k) {
    var segH = fimHoje(), P = ST.per;
    if (P.p) { P.off = Math.max(0, (P.off || 0) - k); return; }
    var J = janelaBase(), n = difDias(J.de, J.ate), ate = addDias(J.ate, 7 * k);
    if (ate > segH) ate = segH;
    P.de = addDias(ate, -n); P.ate = addDias(ate, 6);
  }
  // a semana fora do período puxa o período até ela (a +1 estica sozinha)
  function trazerJanela(s) {
    if (!s) return;
    if (s > fimHoje()) s = fimHoje();
    var J = janelaBase();
    if (s > J.ate) andar(Math.round(difDias(J.ate, s) / 7));
    else if (s < J.de) andar(-Math.round(difDias(s, J.de) / 7));
  }
  function setFoco(lista) {
    ST.foco = (lista || []).filter(Boolean).sort();
    if (ST.foco.length) trazerJanela(ST.foco[ST.foco.length - 1]);
    guardar(); repintar();
  }
  // clique na semana: avalia SÓ ela (de novo = o período todo); somar = Ctrl/⌘
  function focarSemana(s, somar) {
    var f = focoAtual();
    if (somar) { var i = f.indexOf(s); if (i >= 0) f.splice(i, 1); else f.push(s); setFoco(f); return; }
    setFoco(f.length === 1 && f[0] === s ? [] : [s]);
  }
  // os botões Semana −1 / 0 / +1 ligam e desligam a semana (várias juntas);
  // nenhuma = o período todo
  function semanaBotao(k) {
    if (k === 'todo') { setFoco([]); return; }
    var s = addDias(fimHoje(), Number(k) || 0), f = focoAtual(), i = f.indexOf(s);
    if (i >= 0) f.splice(i, 1); else f.push(s);
    setFoco(f);
  }
  // as setas do gráfico na ponta do período: o período anda n semanas
  function moverJanela(n) { andar(n); guardar(); repintar(); }
  function setPeriodo(p) { ST.per = { p: p, de: '', ate: '', off: 0 }; guardar(); repintar(); }
  // De/Até digitado: vale quando a data está inteira (ano de quatro dígitos)
  var tDt = null;
  function setDatas() {
    var per = $('cots-per'); if (!per) return;
    var de = per.querySelector('[data-cots-dt="de"]').value, ate = per.querySelector('[data-cots-dt="ate"]').value;
    var ok = function (d) { return !d || (DIA.test(d) && d.slice(0, 4) >= '2000'); };
    if (!ok(de) || !ok(ate)) return;
    if (de && ate && de > ate) { var x = de; de = ate; ate = x; }
    ST.per = { p: '', de: de, ate: ate, off: 0 };
    guardar(); repintar();
  }
  function setMet(m) { ST.met = m === 'n' ? 'n' : 'v'; guardar(); repintar(); }
  function setFiltro(k, v) { ST.f[k] = ST.f[k] === v ? '' : v; guardar(); repintar(); }
  function limpar() { ST.f = { portal: '', dono: '', unidade: '' }; ST.per = { p: PER0, de: '', ate: '', off: 0 }; ST.foco = null; perAberto = false; guardar(); if (PAG && PAG.limpar) PAG.limpar(); repintar(); }

  /* ── pintar ───────────────────────────────────────────────────── */
  function repintar() {
    pintarFiltros();
    if (!PAG || !DADOS.carregou) return;
    var c = ctx();
    setT('cots-info', C.int(c.ls.length) + (c.ls.length === 1 ? ' oportunidade ' : ' oportunidades ') + c.quando(true));
    Array.prototype.forEach.call(D.querySelectorAll('[data-cots-met]'), function (b) { b.classList.toggle('on', b.getAttribute('data-cots-met') === c.met); });
    pintarNav(c);
    if (!DADOS.objs.length && PAG.vazio) {
      PAG.vazio(DADOS.configurado === false ? 'Armazenamento das oportunidades não configurado.' : DADOS.erro || 'Nenhuma oportunidade registrada ainda — o funil começa com a primeira oportunidade trazida pelo Agente de Oportunidades.');
    } else PAG.render(c);
    var rt = $('cots-atualizado');
    if (rt && DADOS.lidoEm) rt.textContent = 'lido às ' + pad(DADOS.lidoEm.getHours()) + ':' + pad(DADOS.lidoEm.getMinutes());
    C.quieto($('cot-app'));
    if (C.ficha) C.ficha.atualizar();
  }

  /* ── dados ────────────────────────────────────────────────────── */
  function pintarLive(st, txt) { var l = $('cot-live'); if (!l) return; l.className = 'cs-live ' + (st || ''); var s = l.querySelector('span'); if (s) s.textContent = txt; }
  function aplicar(j) {
    // o submódulo do CRM (Venda Recorrente / BIO.ID): só as da unidade dele
    DADOS.casos = C.doSubmodulo(j.casos || []); DADOS.rev = j.rev; DADOS.cfg = j.cfg || DADOS.cfg; DADOS.eu = j.eu || DADOS.eu; DADOS.configurado = j.configurado !== false;
    if (DADOS.cfg && DADOS.cfg.fases) C.FASES.forEach(function (f) { var s = DADOS.cfg.fases.filter(function (x) { return x.id === f.id; })[0]; if (s) { f.nome = s.nome; f.desc = s.desc || f.desc; } });
    DADOS.porNumero = {}; DADOS.casos.forEach(function (c) { DADOS.porNumero[c.numero] = c; });
    // as AMOSTRAS (23/10/2026) não contam em nada: fora do funil e do analítico
    DADOS.objs = DADOS.casos.filter(function (c) { return !c.amostra; }).map(objeto);
    DADOS.carregou = true; DADOS.lidoEm = new Date(); DADOS.erro = null;
    var eu = DADOS.eu || {}, fora = C.foraDoSubmodulo(eu);
    C.guardarPessoa(eu);
    // a unidade de negócio não confirmada: a pessoa não vê nenhuma cotação
    if (fora) setH('cot-faixa', '<div class="cs-faixa alerta">' + IC.alert + '<div>' + fora + '</div></div>');
    else if (j.configurado === false) setH('cot-faixa', '<div class="cs-faixa alerta">' + IC.alert + '<div><b>Armazenamento não configurado.</b> As oportunidades só começam a ser guardadas depois que o dono do portal configurar o COT_MSB_BLOB_URL.</div></div>');
    else if (!eu.admin && !eu.unidadeConfirmada) setH('cot-faixa', '<div class="cs-faixa alerta">' + IC.alert + '<div><b>Não consegui confirmar a sua unidade de negócio no Power BI</b>: ' + esc(eu.unidadeMotivo || 'sem resposta') + '. Aqui aparecem só as oportunidades da sua unidade — sem ela, nenhuma. Abra a Gestão de Oportunidades e use "Conectar ao Power BI".</div></div>');
    else if (!eu.admin && !(eu.unidades || []).length) setH('cot-faixa', '<div class="cs-faixa alerta">' + IC.alert + '<div><b>O Power BI não mostra nenhuma unidade de negócio para você no Comercial.</b> Aqui aparecem só as oportunidades da sua unidade.</div></div>');
    else setH('cot-faixa', '');
  }
  function carregar(forcar) {
    return C.api('cot-casos' + (!forcar && DADOS.rev != null ? '?rev=' + DADOS.rev : '')).then(function (j) {
      pintarLive('ok', 'Atualizado · ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      if (j && j.mudou === false) return false;
      aplicar(j || {});
      if (PAG && PAG.dados) PAG.dados(DADOS);
      repintar();
      return true;
    }).catch(function (e) {
      if (e.status === 401 || e.status === 403) {
        pintarLive('erro', 'Sem acesso');
        setH('cot-faixa', '<div class="cs-faixa erro">' + IC.alert + '<div><b>' + esc(e.message) + '</b></div></div>');
        DADOS.carregou = true; DADOS.casos = []; DADOS.objs = []; DADOS.erro = 'Sem acesso às oportunidades.';
        repintar();
        return false;
      }
      pintarLive('alerta', 'Reconectando…');
      return false;
    });
  }

  /* ── a ficha da cotação (à direita — cotacoes-ficha.js) ───────── */
  function abrirFicha(num, origem) {
    if (!num) return;
    if (!C.ficha) { location.href = 'comercial-cot-casos.html?caso=' + encodeURIComponent(num); return; }
    C.ficha.abrir(num, {
      origem: origem,
      resumo: function (n) { return DADOS.porNumero[n] || null; },
      // ‹ › andam pela ordem da tela (as linhas visíveis, sem repetir)
      lista: function () {
        var vistos = {}, out = [];
        Array.prototype.forEach.call(D.querySelectorAll('#cot-app [data-num]'), function (x) { var n = x.getAttribute('data-num'); if (n && !vistos[n]) { vistos[n] = 1; out.push(n); } });
        return out;
      },
      avisoDias: function () { return DADOS.cfg && DADOS.cfg.avisoDias != null ? DADOS.cfg.avisoDias : 2; }
    });
  }

  /* ── eventos comuns ───────────────────────────────────────────── */
  function ligar() {
    var app = $('cot-app'); if (!app) return;
    app.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.getAttribute && t.getAttribute('data-cots-dt')) { clearTimeout(tDt); tDt = setTimeout(setDatas, 500); return; }
      var k = t.getAttribute && t.getAttribute('data-cots-f'); if (!k) return;
      ST.f[k] = t.value; guardar(); repintar();
    });
    app.addEventListener('click', function (ev) {
      var t = ev.target; if (!t.closest) return;
      var x;
      if ((x = t.closest('[data-cots="limpar"]'))) { limpar(); return; }
      // o período: abre/fecha o painel, atalhos; as semanas avaliadas
      if ((x = t.closest('[data-cots-per]'))) { perAberto = x.getAttribute('data-cots-per') === 'abrir' ? !perAberto : false; pintarFiltros(); return; }
      if ((x = t.closest('[data-cots-pre]'))) { setPeriodo(x.getAttribute('data-cots-pre')); return; }
      if ((x = t.closest('[data-cots-sem]'))) { semanaBotao(x.getAttribute('data-cots-sem')); return; }
      if ((x = t.closest('[data-cots="recarregar"]'))) { x.disabled = true; carregar(true).then(function () { x.disabled = false; if (PAG && PAG.recarregar) PAG.recarregar(); }); return; }
      if ((x = t.closest('[data-cots-met]'))) { setMet(x.getAttribute('data-cots-met')); return; }
      if ((x = t.closest('#fs-prev, #fs-next'))) { var a = x.getAttribute('data-alvo'); if (a && !x.disabled) setFoco([a]); return; }
      // a cotação (linha com data-num): a ficha à direita
      if ((x = t.closest('[data-num]')) && !t.closest('button, a, select, input')) { abrirFicha(x.getAttribute('data-num'), x); return; }
    });
    // fora do painel do período: fecha
    D.addEventListener('click', function (ev) {
      // o caminho do clique (o botão que repintou já saiu da página)
      var per = $('cots-per');
      if (!perAberto || !per || (ev.composedPath ? ev.composedPath().indexOf(per) >= 0 : per.contains(ev.target))) return;
      perAberto = false; pintarFiltros();
    });
    app.addEventListener('keydown', function (ev) {
      if (perAberto && ev.key === 'Escape') { perAberto = false; pintarFiltros(); var b = D.querySelector('#cots-per .cot-per-b'); if (b) b.focus(); return; }
      if (ev.target.getAttribute && ev.target.getAttribute('data-cots-dt') && ev.key === 'Enter') { ev.preventDefault(); clearTimeout(tDt); setDatas(); return; }
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var x = ev.target.closest && ev.target.closest('[data-num]');
      if (x && x === ev.target) { ev.preventDefault(); abrirFicha(x.getAttribute('data-num'), x); }
    });
    D.addEventListener('visibilitychange', function () { if (!D.hidden) carregar(); });
    setInterval(function () { if (!D.hidden) carregar(); }, 60000);
  }

  function pagina(cfg) {
    PAG = cfg;
    var go = function () {
      ligar();
      repintar();
      C.aguardarLogin().then(function () { return carregar(true); });
    };
    if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', go); else go();
  }

  W.COTS = {
    pagina: pagina, repintar: repintar, carregar: carregar, ctx: ctx, abrirFicha: abrirFicha,
    setFoco: setFoco, focarSemana: focarSemana, moverJanela: moverJanela, setMet: setMet, setFiltro: setFiltro,
    dados: function () { return DADOS; },
    COR: COR, NOME: NOME, UM: UM, DICA: DICA, SEM: SEM, F: F, DS: DS,
    quatro: quatro, nv: nv, agrupar: agrupar, sitDe: sitDe,
    hoje: hoje, addDias: addDias, difDias: difDias, segunda: segunda, isoSemana: isoSemana, dm: dm, dsem: dsem,
    curto: curto, nf1: nf1, brl0: brl0, tinta: tinta, hexA: hexA, pl: pl, setT: setT, setH: setH
  };
})();
