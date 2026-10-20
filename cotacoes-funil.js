/* ================================================================
   cotacoes-funil.js — FUNIL DE COTAÇÕES (pages/comercial-cot-funil.html)

   O funil de conversão das cotações, no desenho do Funil de Vendas da
   Licitação (o CSS .fv-* é o mesmo): o herói "em andamento", o funil por
   fase com as perdidas/vencidas/canceladas "fora do funil", até onde as
   cotações chegam (proposta enviada → pedido → Dynamics), semana a semana, por portal,
   por responsável, os motivos de perda, os clientes e a lista. Clicar numa
   cotação da lista abre a FICHA dela à direita (cotacoes-ficha.js): a
   fase, o caminho, o que já foi feito, o pedido (ou a falta dele), os
   itens, a tramitação e o histórico — sem sair do funil.

   A fonte é o índice das cotações (/api/cot-casos — o resumo de cada caso,
   com o caminho de fases); tudo é agregado AQUI, no navegador. Descartadas
   ficam de fora de tudo.

   Situação de cada cotação, pela FASE:
     and = Em cotação · Cotada · Em negociação
     gan = Virou pedido
     per = Perdida · Cancelada
   Valor = o valor COTADO. O que virou pedido mostra também o valor do
   PEDIDO (pode ser parcial) — é ele que entra na "conversão em valor".
   ================================================================ */
(function () {
  'use strict';
  var C = window.COT; if (!C) return;
  var D = document, $ = C.$, esc = C.esc, IC = C.IC;
  if (!D.body || D.body.getAttribute('data-cot-pagina') !== 'funil') return;

  var SIT = {
    and: { label: 'Em andamento', cor: '#3F8FD2' },
    gan: { label: 'Viraram pedido', cor: '#2FBF71' },
    per: { label: 'Não viraram', cor: '#E4574C' }
  };
  var COR_FN = { cotada: '#5C9FDF', negociacao: '#2A6CB8', pedido: '#2FBF71', perdida: '#E4574C', vencida: '#D9822B', cancelada: '#93A7BA' };
  var PERIODOS = [['30d', 'Últimos 30 dias'], ['mes', 'Este mês'], ['tri', 'Este trimestre'], ['ano', 'Este ano'], ['12m', 'Últimos 12 meses'], ['tudo', 'Tudo']];
  var SS = 'cot-funil-filtros';

  var S = { casos: [], rev: null, cfg: null, carregou: false, met: 'v', semMet: 'v', fase: '', motivo: '', busca: '',
    f: { periodo: '12m', portal: '', dono: '', empresa: '', area: '' } };
  try { var salvo = JSON.parse(sessionStorage.getItem(SS) || 'null'); if (salvo && salvo.f) { S.f = Object.assign(S.f, salvo.f); S.met = salvo.met || 'v'; } } catch (e) {}
  function guardar() { try { sessionStorage.setItem(SS, JSON.stringify({ f: S.f, met: S.met })); } catch (e) {} }

  function sit(c) { return C.aberta(c.fase) ? 'and' : c.fase === 'pedido' ? 'gan' : 'per'; }
  function vPedido(c) { return c.totalPedido || c.total || 0; }
  function avisoDias() { return S.cfg && S.cfg.avisoDias != null ? S.cfg.avisoDias : 2; }
  function inicioPeriodo(p) {
    var h = new Date(); h.setHours(0, 0, 0, 0);
    if (p === '30d') return h.getTime() - 29 * 86400e3;
    if (p === 'mes') return new Date(h.getFullYear(), h.getMonth(), 1).getTime();
    if (p === 'tri') return new Date(h.getFullYear(), Math.floor(h.getMonth() / 3) * 3, 1).getTime();
    if (p === 'ano') return new Date(h.getFullYear(), 0, 1).getTime();
    if (p === '12m') return new Date(h.getFullYear() - 1, h.getMonth(), h.getDate() + 1).getTime();
    return 0;
  }
  function donoK(c) { return c.dono ? c.dono.email : '(sem)'; }
  // os filtros, menos o período (a semana a semana usa as 12 últimas semanas)
  function passaFiltros(c) {
    if (c.descartado) return false;
    var f = S.f;
    if (f.portal && (c.portal || '(sem portal)') !== f.portal) return false;
    if (f.dono && donoK(c) !== f.dono) return false;
    if (f.empresa && (c.empresa || '(sem)') !== f.empresa) return false;
    if (f.area && (c.area || '(sem)') !== f.area) return false;
    return true;
  }
  function linhas() {
    var ini = inicioPeriodo(S.f.periodo);
    return S.casos.filter(function (c) { return passaFiltros(c) && (!ini || C.ms(c.criadoEm) >= ini); });
  }
  function soma(ls) {
    var z = function () { return { n: 0, v: 0 }; };
    var t = { n: 0, v: 0, and: z(), gan: z(), per: z(), vPed: 0 };
    ls.forEach(function (c) { var s = sit(c), v = c.total || 0; t.n++; t.v += v; t[s].n++; t[s].v += v; if (s === 'gan') t.vPed += vPedido(c); });
    return t;
  }
  function agrupar(ls, chaveFn, rotuloFn) {
    var m = {};
    ls.forEach(function (c) {
      var k = chaveFn(c);
      if (!m[k]) m[k] = { k: k, nome: rotuloFn ? rotuloFn(c, k) : k, ls: [] };
      m[k].ls.push(c);
    });
    return Object.keys(m).map(function (k) { var g = m[k]; return Object.assign(g, soma(g.ls)); });
  }
  function setT(id, t) { var e = $(id); if (e) e.textContent = t; }
  function setH(id, h) { var e = $(id); if (e) e.innerHTML = h; }
  function tinta(hex) {
    var h = String(hex).replace('#', ''); if (h.length === 3) h = h.split('').map(function (x) { return x + x; }).join('');
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#0A2E5C' : '#fff';
  }
  function hexA(hex, a) { var h = String(hex).replace('#', ''); return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'; }
  function fm(x, met) { return (met || S.met) === 'n' ? C.int(x) : C.brlCurto(x); }

  /* ── filtros ────────────────────────────────────────────────── */
  function opcoesDe(chaveFn, rotuloFn) {
    var m = {};
    S.casos.forEach(function (c) { if (c.descartado) return; var k = chaveFn(c); if (!m[k]) m[k] = { k: k, nome: rotuloFn(c, k), n: 0 }; m[k].n++; });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.n - a.n; });
  }
  function renderFiltros() {
    var el = $('cot-filtros'); if (!el) return;
    var sel = function (id, rot, ops, atual, todos) {
      return '<label class="' + (atual ? 'on' : '') + '">' + esc(rot) + '<select data-f="' + id + '"><option value="">' + esc(todos || 'Todos') + '</option>' +
        ops.map(function (o) { return '<option value="' + esc(o.k) + '"' + (o.k === atual ? ' selected' : '') + '>' + esc(o.nome) + ' (' + o.n + ')</option>'; }).join('') + '</select></label>';
    };
    var portais = opcoesDe(function (c) { return c.portal || '(sem portal)'; }, function (c, k) { return k; });
    var donos = opcoesDe(donoK, function (c, k) { return c.dono ? c.dono.nome : 'Sem responsável'; });
    var emp = opcoesDe(function (c) { return c.empresa || '(sem)'; }, function (c, k) { return k === '(sem)' ? 'Sem empresa' : k; });
    var areas = opcoesDe(function (c) { return c.area || '(sem)'; }, function (c, k) { return k === '(sem)' ? 'Sem área' : k; });
    var algum = S.f.portal || S.f.dono || S.f.empresa || S.f.area || S.f.periodo !== '12m';
    el.innerHTML = '<label class="on">Entrada<select data-f="periodo">' + PERIODOS.map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === S.f.periodo ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select></label>' +
      sel('portal', 'Portal', portais, S.f.portal) + sel('dono', 'Responsável', donos, S.f.dono) + sel('empresa', 'Empresa', emp, S.f.empresa, 'Todas') + sel('area', 'Área', areas, S.f.area, 'Todas') +
      '<span class="fim"><span class="info" id="flt-info"></span>' + (algum ? '<button type="button" class="cs-btn cs-btn-xs" id="flt-limpar">' + IC.x + 'Limpar filtros</button>' : '') + '</span>';
  }

  /* ── herói + funil ──────────────────────────────────────────── */
  function renderHeroi(ls, T) {
    var val = function (x) { return S.met === 'n' ? x.n : x.v; };
    setT('h-val', C.brlCurto(T.and.v));
    setT('h-cnt', C.int(T.and.n) + ' cotaç' + (T.and.n === 1 ? 'ão' : 'ões'));
    setH('h-tot', 'Total no período: <b>' + C.brlCurto(T.v) + '</b> cotados · <b>' + C.int(T.n) + '</b> cotações (inclui as que viraram pedido e as que não viraram)');
    var tot = val(T) || 1;
    var barra = $('h-split');
    barra.innerHTML = ['and', 'gan', 'per'].map(function (s) {
      var x = val(T[s]); if (!x) return '';
      return '<i style="width:' + (x / tot * 100).toFixed(2) + '%;background:' + SIT[s].cor + ';color:' + tinta(SIT[s].cor) + ';" title="' + esc(SIT[s].label) + ': ' + fm(x) + ' · ' + C.pct(x / tot, 0) + '"><span data-pct="' + C.pct(x / tot, 0) + '">' + fm(x) + '</span></i>';
    }).join('');
    Array.prototype.forEach.call(barra.querySelectorAll('i > span'), function (sp) {
      if (sp.scrollWidth <= sp.parentNode.clientWidth) return;
      sp.textContent = sp.getAttribute('data-pct');
      if (sp.scrollWidth > sp.parentNode.clientWidth) sp.parentNode.removeChild(sp);
    });
    setH('h-legs', ['and', 'gan', 'per'].map(function (s) { return '<span class="fv-spleg"><i style="background:' + SIT[s].cor + ';"></i>' + esc(SIT[s].label) + ' <b>' + fm(val(T[s])) + '</b> · ' + C.pct(val(T[s]) / tot, 0) + '</span>'; }).join(''));
    var fech = T.gan.n + T.per.n;
    var perd = ls.filter(function (c) { return c.fase === 'perdida'; }).length, canc = ls.filter(function (c) { return c.fase === 'cancelada'; }).length;
    var venc = ls.filter(function (c) { return c.fase === 'vencida'; }).length;
    setT('h-gan', C.brlCurto(T.vPed));
    setT('h-gan-s', C.int(T.gan.n) + ' cotaç' + (T.gan.n === 1 ? 'ão' : 'ões') + ' · ' + C.brlCurto(T.gan.v) + ' cotados');
    setT('h-per', C.brlCurto(T.per.v));
    setT('h-per-s', C.int(perd) + ' perdida(s) · ' + C.int(venc) + ' vencida(s) · ' + C.int(canc) + ' cancelada(s)');
    setT('h-tx', fech ? C.pct(T.gan.n / fech) : '—');
    setT('h-tx-s', fech ? C.int(T.gan.n) + ' pedidos de ' + C.int(fech) + ' encerradas' : 'nenhuma encerrada no recorte');
    setT('h-tick', T.n ? C.brlCurto(T.v / T.n) : '—');
    setT('h-tick-s', T.and.n ? 'em andamento: ' + C.brlCurto(T.and.v / T.and.n) : 'por cotação no período');
  }
  function renderFunil(ls, T) {
    var met = S.met, val = function (x) { return met === 'n' ? x.n : x.v; };
    Array.prototype.forEach.call(D.querySelectorAll('#fn-met button'), function (b) { b.classList.toggle('on', b.getAttribute('data-met') === met); });
    var por = {}; C.FASES.forEach(function (f) { por[f.id] = { n: 0, v: 0, vPed: 0 }; });
    ls.forEach(function (c) { var g = por[c.fase]; if (!g) return; g.n++; g.v += c.total || 0; g.vPed += vPedido(c); });
    var etapas = ['cotada', 'negociacao', 'pedido'].map(function (id) { return { f: C.fase(id), g: por[id] }; });
    var fora = ['perdida', 'vencida', 'cancelada'].map(function (id) { return { f: C.fase(id), g: por[id] }; });
    var maxE = Math.max.apply(null, etapas.map(function (e) { return val(e.g); }).concat([1]));
    var totP = val(T) || 1, PISO = 26;
    var larg = function (e) { return PISO + (100 - PISO) * val(e.g) / maxE; };
    var css = function (w) { return 'max(' + w.toFixed(1) + '%, var(--fn-min))'; };
    if (!T.n) { setH('fn-host', '<div class="fv-empty">Nenhuma cotação neste recorte.</div>'); return; }
    var h = '';
    etapas.forEach(function (e, i) {
      var w = larg(e), prox = etapas[i + 1], wn = prox ? larg(prox) : 0, cor = COR_FN[e.f.id], vazia = !e.g.n;
      var a = css(w), b = css(wn), on = S.fase === e.f.id, algum = !!S.fase;
      var dentro = met === 'n' ? '<b>' + C.int(e.g.n) + ' cot.</b> · ' + C.brlCurto(e.g.v) : '<b>' + C.brlCurto(e.g.v) + '</b> · ' + C.int(e.g.n) + ' cot.';
      var clip = prox ? 'polygon(calc(50% - ' + a + ' / 2) 0%, calc(50% + ' + a + ' / 2) 0%, calc(50% + ' + b + ' / 2) 100%, calc(50% - ' + b + ' / 2) 100%)' : '';
      var estilo = vazia ? 'width:' + a + ';background:' + hexA(cor, 0.14) + ';color:#5B7189;border:1px dashed ' + hexA(cor, 0.8) + ';box-shadow:none;' : 'width:' + a + ';background:' + cor + ';color:' + tinta(cor) + ';';
      h += '<div class="fv-fn-row' + (on ? ' on' : '') + (algum && !on ? ' dim' : '') + '" data-fase-f="' + e.f.id + '" title="' + esc(e.f.nome) + ': ' + C.brl(e.g.v) + ' · ' + C.int(e.g.n) + ' cotações">' +
        '<div class="fv-fn-lb"><div class="t">' + esc(e.f.nome) + '</div><div class="s"><b>' + C.brlCurto(e.g.v) + '</b> · ' + C.int(e.g.n) + ' cot. · ' + C.pct(val(e.g) / totP, 0) + '</div></div>' +
        '<div class="fv-fn-w"><div class="fv-fn-bar' + (vazia ? ' vazia' : '') + '" style="' + estilo + '"><span>' + dentro + '</span></div>' +
          (prox ? '<div class="fv-fn-conn" style="clip-path:' + clip + ';background:' + hexA(cor, 0.26) + ';"></div>' : '') + '</div></div>';
    });
    var tSG = fora.reduce(function (s, e) { s.n += e.g.n; s.v += e.g.v; return s; }, { n: 0, v: 0 });
    h += '<div class="fv-fn-sep"><span class="k">Fora do funil</span><hr></div>' +
      '<div class="fv-fn-out"><div class="k"><b>' + C.brlCurto(tSG.v) + '</b>' + C.int(tSG.n) + ' não viraram pedido</div><div class="fv-chips">' +
      fora.map(function (e) {
        return '<div class="fv-chip' + (S.fase === e.f.id ? ' on' : '') + '" style="--c:' + COR_FN[e.f.id] + ';" data-fase-f="' + e.f.id + '"><span class="t">' + esc(e.f.nome) + '</span><span class="v">' + fm(val(e.g)) + '</span><span class="s">' + (met === 'n' ? C.brlCurto(e.g.v) : C.int(e.g.n) + ' cot.') + '</span></div>';
      }).join('') + '</div></div>';
    setH('fn-host', h);

    // as estatísticas embaixo do funil
    var enc = ls.filter(function (c) { return sit(c) !== 'and'; });
    var vEnc = enc.reduce(function (s, c) { return s + (c.total || 0); }, 0);
    setT('s-a', vEnc ? C.pct(T.vPed / vEnc) : '—');
    setT('s-a-s', vEnc ? C.brlCurto(T.vPed) + ' em pedidos de ' + C.brlCurto(vEnc) + ' cotados (encerradas)' : 'nenhuma encerrada no recorte');
    var gan = ls.filter(function (c) { return c.fase === 'pedido' && c.fechadoEm; });
    var dias = gan.map(function (c) { return (C.ms(c.fechadoEm) - C.ms(c.criadoEm)) / 86400e3; }).filter(function (d) { return d >= 0; });
    var med = dias.length ? dias.reduce(function (s, d) { return s + d; }, 0) / dias.length : null;
    setT('s-b', med == null ? '—' : C.int(Math.round(med)) + (Math.round(med) === 1 ? ' dia' : ' dias'));
    setT('s-b-s', med == null ? 'nenhum pedido no recorte' : 'da entrada ao pedido · média de ' + C.int(dias.length));
    var abertas = ls.filter(function (c) { return sit(c) === 'and'; });
    var venc = abertas.filter(function (c) { var p = C.prazoDe(c, avisoDias()); return p && p.nivel >= 1; });
    var vencidas = venc.filter(function (c) { return C.prazoDe(c, avisoDias()).nivel === 2; });
    setT('s-c', C.int(venc.length));
    setT('s-c-s', venc.length ? C.int(vencidas.length) + ' já vencida(s) · ' + C.brlCurto(venc.reduce(function (s, c) { return s + (c.total || 0); }, 0)) : 'nenhuma no limite do prazo');
    var semPI = ls.filter(function (c) { return c.fase === 'pedido' && c.pi !== 'enviado'; });
    setT('s-d', C.int(semPI.length));
    setT('s-d-s', semPI.length ? C.brlCurto(semPI.reduce(function (s, c) { return s + vPedido(c); }, 0)) + ' em pedidos sem lançar no Dynamics' : 'todo pedido já está no Dynamics');
  }

  /* ── até onde chegam (proposta enviada → pedido → Dynamics) ─── */
  function renderConversao(ls) {
    var N = ls.length;
    // toda cotação entra Cotada (09/10/26): o degrau agora é a PROPOSTA ter ido ao comprador
    var r = ls.filter(function (c) { return !!c.proposta; }), p = ls.filter(function (c) { return c.fase === 'pedido'; }), d = p.filter(function (c) { return c.pi === 'enviado'; });
    var and = ls.filter(function (c) { return sit(c) === 'and'; }).length;
    var vR = r.reduce(function (s, c) { return s + (c.total || 0); }, 0), vP = p.reduce(function (s, c) { return s + vPedido(c); }, 0), vD = d.reduce(function (s, c) { return s + vPedido(c); }, 0);
    var cards = [
      ['Entraram', N, N, 'cotações no período · ' + C.int(and) + ' ainda em andamento', '#3F8FD2'],
      ['Proposta enviada', r.length, N, C.brlCurto(vR) + ' em propostas ao comprador', '#2A6CB8'],
      ['Viraram pedido', p.length, N, C.brlCurto(vP) + ' em pedidos' + (N ? ' · ' + C.pct(p.length / N, 0) + ' das que entraram' : ''), '#2FBF71'],
      ['Lançadas no Dynamics', d.length, N, C.brlCurto(vD) + ' pelo PI' + (p.length ? ' · ' + C.pct(d.length / p.length, 0) + ' dos pedidos' : ''), '#138A4B']
    ];
    setH('conv-host', N ? cards.map(function (k) {
      var x = k[2] ? k[1] / k[2] : 0;
      return '<div class="cot-conv-p" style="--c:' + k[4] + '"><div class="k">' + esc(k[0]) + '</div><div class="v">' + C.int(k[1]) + ' <small style="font-size:13px;color:#7C93A8">' + C.pct(x, 0) + '</small></div>' +
        '<div class="s">' + esc(k[3]) + '</div><div class="b"><i style="width:' + (x * 100).toFixed(1) + '%"></i></div></div>';
    }).join('') : '<div class="fv-empty" style="grid-column:1/-1">Nenhuma cotação neste recorte.</div>');
  }

  /* ── semana a semana ────────────────────────────────────────── */
  function segunda(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); var dw = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dw); return d; }
  function renderSemanas() {
    var met = S.semMet, val = function (x) { return met === 'n' ? x.n : x.v; };
    Array.prototype.forEach.call(D.querySelectorAll('#sem-met button'), function (b) { b.classList.toggle('on', b.getAttribute('data-met') === met); });
    var base = S.casos.filter(passaFiltros);
    var hoje = segunda(Date.now()), semanas = [];
    for (var i = 11; i >= 0; i--) { var ini = new Date(hoje); ini.setDate(ini.getDate() - 7 * i); var fim = new Date(ini); fim.setDate(fim.getDate() + 7); semanas.push({ ini: ini, fim: fim, ent: { n: 0, v: 0 }, gan: { n: 0, v: 0, vPed: 0 }, per: { n: 0, v: 0 } }); }
    var achar = function (t) { for (var k = 0; k < semanas.length; k++) if (t >= semanas[k].ini.getTime() && t < semanas[k].fim.getTime()) return semanas[k]; return null; };
    base.forEach(function (c) {
      var s = achar(C.ms(c.criadoEm)); if (s) { s.ent.n++; s.ent.v += c.total || 0; }
      if (!C.aberta(c.fase) && c.fechadoEm) {
        var f = achar(C.ms(c.fechadoEm));
        if (f) { var k = c.fase === 'pedido' ? 'gan' : 'per'; f[k].n++; f[k].v += c.total || 0; if (k === 'gan') f.gan.vPed += vPedido(c); }
      }
    });
    var max = Math.max.apply(null, semanas.map(function (s) { return Math.max(val(s.ent), val(s.gan), val(s.per)); }).concat([1]));
    var dd = function (d) { return C.pad(d.getDate()) + '/' + C.pad(d.getMonth() + 1); };
    var plot = semanas.map(function (s, i) {
      var atual = i === semanas.length - 1, fimV = new Date(s.fim.getTime() - 86400e3);
      var tx = s.gan.n + s.per.n ? s.gan.n / (s.gan.n + s.per.n) : null;
      var barra = function (x, cor, rot) { return '<i style="height:' + (val(x) / max * 100).toFixed(1) + '%;background:' + cor + '" title="' + rot + ': ' + C.int(x.n) + ' · ' + C.brl(x.v) + '"></i>'; };
      return '<div class="cot-semg-col' + (atual ? ' atual' : '') + '" title="Semana de ' + dd(s.ini) + ' a ' + dd(fimV) + (atual ? ' (em curso)' : '') + '"><div class="bars">' +
        barra(s.ent, SIT.and.cor, 'Entraram') + barra(s.gan, SIT.gan.cor, 'Viraram pedido') + barra(s.per, SIT.per.cor, 'Não viraram') + '</div>' +
        '<span class="x">' + dd(s.ini) + '</span><span class="t">' + (tx == null ? '' : C.pct(tx, 0)) + '</span></div>';
    }).join('');
    setH('sem-host', '<div class="cot-semg"><div class="cot-semg-plot">' + plot + '</div></div>' +
      '<div class="fv-foot"><span class="fv-leg" style="display:inline-flex"><span><i style="background:' + SIT.and.cor + '"></i>Entraram</span><span><i style="background:' + SIT.gan.cor + '"></i>Viraram pedido</span><span><i style="background:' + SIT.per.cor + '"></i>Não viraram</span></span>' +
      ' · embaixo de cada semana, a conversão das que fecharam nela (pedidos ÷ encerradas). A semana em curso fica destacada.</div>');
    var tot = { ent: { n: 0, v: 0 }, gan: { n: 0, v: 0, vPed: 0 }, per: { n: 0, v: 0 } };
    semanas.forEach(function (s) { ['ent', 'gan', 'per'].forEach(function (k) { tot[k].n += s[k].n; tot[k].v += s[k].v; }); tot.gan.vPed += s.gan.vPed; });
    var txCel = function (g, p) { var e = g + p; if (!e) return '<td class="n">—</td>'; var x = g / e; return '<td class="n"><span class="tx">' + C.pct(x, 0) + '<i><b style="width:' + (x * 100).toFixed(0) + '%"></b></i></span></td>'; };
    setH('sem-tb', '<thead><tr><th>Semana</th><th class="n">Entraram</th><th class="n">Valor que entrou</th><th class="n">Viraram pedido</th><th class="n">Valor dos pedidos</th><th class="n">Não viraram</th><th class="n">Valor perdido</th><th class="n">Conversão</th></tr></thead><tbody>' +
      semanas.slice().reverse().map(function (s, i) {
        var fimV = new Date(s.fim.getTime() - 86400e3);
        return '<tr><td><b>' + dd(s.ini) + ' a ' + dd(fimV) + '</b>' + (i === 0 ? ' <span style="color:#1272C4;font-weight:700">· em curso</span>' : '') + '</td>' +
          '<td class="n">' + C.int(s.ent.n) + '</td><td class="n">' + C.brl(s.ent.v) + '</td><td class="n gan">' + C.int(s.gan.n) + '</td><td class="n gan">' + C.brl(s.gan.vPed) + '</td>' +
          '<td class="n per">' + C.int(s.per.n) + '</td><td class="n per">' + C.brl(s.per.v) + '</td>' + txCel(s.gan.n, s.per.n) + '</tr>';
      }).join('') + '</tbody><tfoot><tr><td>Total · 12 semanas</td><td class="n">' + C.int(tot.ent.n) + '</td><td class="n">' + C.brl(tot.ent.v) + '</td><td class="n">' + C.int(tot.gan.n) + '</td><td class="n">' + C.brl(tot.gan.vPed) + '</td>' +
      '<td class="n">' + C.int(tot.per.n) + '</td><td class="n">' + C.brl(tot.per.v) + '</td>' + txCel(tot.gan.n, tot.per.n) + '</tr></tfoot>');
  }

  /* ── barras por dimensão (o .fv-br da Licitação) ────────────── */
  function barras(hostId, grupos, cfg) {
    cfg = cfg || {};
    var host = $(hostId); if (!host) return;
    var met = S.met, val = function (g) { return met === 'n' ? g.n : g.v; };
    var gs = grupos.slice().sort(function (a, b) { return val(b) - val(a); }).slice(0, cfg.top || 8);
    if (!gs.length) { host.innerHTML = '<div class="fv-empty">' + (cfg.vazio || 'Sem cotações neste recorte.') + '</div>'; return; }
    var max = Math.max.apply(null, gs.map(val).concat([1]));
    host.className = 'fv-bars' + (gs.length <= 5 ? ' sparse' : '');
    host.innerHTML = gs.map(function (g) {
      var tot = val(g) || 0, w = tot / max * 100;
      var pz = cfg.cor ? '<i style="width:100%;background:' + cfg.cor + '"></i>' : ['and', 'gan', 'per'].map(function (s) {
        var x = met === 'n' ? g[s].n : g[s].v; if (!x) return '';
        return '<i style="width:' + (x / (tot || 1) * 100).toFixed(2) + '%;background:' + SIT[s].cor + ';" title="' + esc(SIT[s].label) + ': ' + (met === 'n' ? C.int(x) : C.brl(x)) + '"></i>';
      }).join('');
      var d = function (s, cls) { var x = met === 'n' ? g[s].n : g[s].v; return '<span class="fv-br-d ' + (x ? cls : cls + ' z') + '" title="' + esc(SIT[s].label) + '">' + fm(x) + '</span>'; };
      var enc = g.gan.n + g.per.n;
      return '<div class="fv-br' + (cfg.on && cfg.on(g) ? ' on' : '') + '"' + (cfg.attr ? ' ' + cfg.attr + '="' + esc(g.k) + '"' : '') + ' title="' + esc(g.nome) + (cfg.attr ? ' — clique para filtrar' : '') + '">' +
        '<span class="fv-br-nm">' + esc(g.nome) + '</span>' +
        '<span class="fv-br-tr"><span class="fv-br-cmp" style="width:' + Math.max(w, 0.6).toFixed(2) + '%;">' + pz + '</span></span>' +
        '<span class="fv-br-v">' + fm(tot) + '</span>' +
        '<span class="fv-br-tx">' + (cfg.cor ? '' : d('and', 'and') + d('gan', 'gan') + d('per', 'per')) +
          '<span class="n">' + (met === 'n' ? C.brlCurto(g.v) : C.int(g.n) + (g.n === 1 ? ' cot.' : ' cot.')) + '</span>' +
          (!cfg.cor && enc ? '<span class="tx">conversão <b>' + C.pct(g.gan.n / enc, 0) + '</b></span>' : '') + '</span></div>';
    }).join('');
  }

  /* ── a lista ────────────────────────────────────────────────── */
  function renderLista(ls) {
    var t = C.norm(S.busca).trim();
    var l = ls.filter(function (c) {
      if (S.fase && c.fase !== S.fase) return false;
      if (S.motivo && (c.perda || '(sem motivo)') !== S.motivo) return false;
      if (t && C.norm([c.numero, c.cliente && c.cliente.nome, c.portal, c.cotacaoId, c.oc, c.dono && c.dono.nome, c.itensTxt].join(' ')).indexOf(t) < 0) return false;
      return true;
    }).sort(function (a, b) { return C.ms(b.criadoEm) - C.ms(a.criadoEm); });
    var filtro = [S.fase ? C.fase(S.fase).nome : '', S.motivo ? 'motivo: ' + S.motivo : ''].filter(Boolean).join(' · ');
    setH('ls-tit', (filtro ? 'Cotações · ' + esc(filtro) : 'Cotações do período') + (filtro ? ' <button type="button" class="fv-act" id="ls-tudo">ver todas</button>' : ''));
    setT('ls-sub', C.int(l.length) + ' cotação(ões) · ' + C.brlCurto(l.reduce(function (s, c) { return s + (c.total || 0); }, 0)) + ' cotados · clique numa cotação para ver a ficha dela');
    var MAX = 300;
    setH('ls-tb', '<thead><tr><th>Cotação</th><th>Cliente e portal</th><th>Entrada</th><th>Fase</th><th>Prazo</th><th class="n">Cotado</th><th class="n">Pedido</th><th>Responsável</th></tr></thead><tbody>' +
      (l.length ? l.slice(0, MAX).map(function (c) {
        return '<tr data-num="' + esc(c.numero) + '" tabindex="0"><td class="num">' + esc(c.numero) + '</td>' +
          '<td class="nm"><b title="' + esc((c.cliente && c.cliente.nome) || '') + '">' + esc((c.cliente && c.cliente.nome) || 'Cliente não informado') + '</b><span>' + esc(C.tituloCaso(c)) + (c.cliente && c.cliente.uf ? ' · ' + esc(c.cliente.uf) : '') + '</span></td>' +
          '<td>' + esc(C.dataBR(c.criadoEm)) + '</td><td>' + (c.descartado ? '' : C.chipFase(c.fase)) + '</td><td>' + (C.chipPrazo(c, avisoDias()) || '<span style="color:#93A7BA">—</span>') + '</td>' +
          '<td class="n"><b style="color:#0A2E5C">' + C.brl(c.total) + '</b></td><td class="n">' + (c.fase === 'pedido' ? '<b style="color:#22794C">' + C.brl(vPedido(c)) + '</b>' : '—') + '</td>' +
          '<td>' + (c.dono ? esc(c.dono.nome) : '<span style="color:#A8541F;font-weight:700">sem responsável</span>') + '</td></tr>';
      }).join('') + (l.length > MAX ? '<tr><td colspan="8" style="text-align:center;color:#7C93A8">Mostrando ' + MAX + ' de ' + l.length + ' — use os filtros.</td></tr>' : '')
        : '<tr><td colspan="8" style="text-align:center;padding:26px;color:#93A7BA">Nenhuma cotação com esses filtros.</td></tr>') + '</tbody>');
  }

  /* ── render geral ───────────────────────────────────────────── */
  function render() {
    renderFiltros();
    if (!S.carregou) return;
    var ls = linhas(), T = soma(ls);
    setT('flt-info', C.int(ls.length) + ' cotação(ões) no recorte');
    if (!S.casos.length) {
      setH('cot-faixa', '<div class="cs-faixa">' + IC.info + '<div><b>Nenhuma cotação registrada ainda.</b> O funil começa a se formar com a primeira cotação trazida pelo <a href="comercial-cot-nova.html">Agente de Cotações</a>.</div></div>');
    }
    renderHeroi(ls, T);
    renderFunil(ls, T);
    renderConversao(ls);
    renderSemanas();
    barras('portal-host', agrupar(ls, function (c) { return c.portal || '(sem portal)'; }), { attr: 'data-portal', on: function (g) { return S.f.portal === g.k; } });
    barras('dono-host', agrupar(ls, donoK, function (c) { return c.dono ? c.dono.nome : 'Sem responsável'; }), { attr: 'data-dono', on: function (g) { return S.f.dono === g.k; } });
    var perdidas = ls.filter(function (c) { return sit(c) === 'per'; });
    barras('motivo-host', agrupar(perdidas, function (c) { return c.perda || '(sem motivo)'; }, function (c, k) { return k === '(sem motivo)' ? 'Sem motivo' : k; }),
      { attr: 'data-motivo', cor: SIT.per.cor, vazio: 'Nenhuma perdida, vencida ou cancelada no recorte.', on: function (g) { return S.motivo === g.k; } });
    barras('cli-host', agrupar(ls, function (c) { return (c.cliente && c.cliente.nome) || '(sem cliente)'; }), { attr: 'data-cli' });
    renderLista(ls);
    C.quieto($('cot-app'));
    if (C.ficha) C.ficha.atualizar();
  }

  /* ── dados ──────────────────────────────────────────────────── */
  function pintarLive(st, txt) { var l = $('cot-live'); if (!l) return; l.className = 'cs-live ' + (st || ''); l.querySelector('span').textContent = txt; }
  function carregar(forcar) {
    return C.api('cot-casos' + (!forcar && S.rev != null ? '?rev=' + S.rev : '')).then(function (j) {
      pintarLive('ok', 'Atualizado · ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      if (j && j.mudou === false) return;
      S.casos = j.casos || []; S.rev = j.rev; S.cfg = j.cfg || S.cfg; S.carregou = true;
      if (j.configurado === false) setH('cot-faixa', '<div class="cs-faixa alerta">' + IC.alert + '<div><b>Armazenamento não configurado.</b> As cotações só começam a ser guardadas depois que o dono do portal configurar o COT_BLOB_URL.</div></div>');
      render();
    }).catch(function (e) {
      if (e.status === 401 || e.status === 403) {
        pintarLive('erro', 'Sem acesso');
        setH('cot-faixa', '<div class="cs-faixa erro">' + IC.alert + '<div><b>' + esc(e.message) + '</b></div></div>');
        S.carregou = true; S.casos = []; render();
        return;
      }
      pintarLive('alerta', 'Reconectando…');
    });
  }

  function ligar() {
    var app = $('cot-app');
    app.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.matches('select[data-f]')) { S.f[t.getAttribute('data-f')] = t.value; guardar(); render(); }
    });
    app.addEventListener('input', function (ev) { if (ev.target.id === 'ls-busca') { S.busca = ev.target.value; buscar(); } });
    app.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.closest('#flt-limpar')) { S.f = { periodo: '12m', portal: '', dono: '', empresa: '', area: '' }; S.fase = ''; S.motivo = ''; guardar(); render(); return; }
      if (t.closest('#ls-tudo')) { S.fase = ''; S.motivo = ''; render(); return; }
      var m = t.closest('#fn-met [data-met]'); if (m) { S.met = m.getAttribute('data-met'); guardar(); render(); return; }
      var sm = t.closest('#sem-met [data-met]'); if (sm) { S.semMet = sm.getAttribute('data-met'); renderSemanas(); return; }
      var fz = t.closest('[data-fase-f]'); if (fz) { var f = fz.getAttribute('data-fase-f'); S.fase = S.fase === f ? '' : f; render(); var l = $('ls-tb'); if (S.fase && l) l.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      var pt = t.closest('[data-portal]'); if (pt) { var p = pt.getAttribute('data-portal'); S.f.portal = S.f.portal === p ? '' : p; guardar(); render(); return; }
      var dn = t.closest('[data-dono]'); if (dn) { var d = dn.getAttribute('data-dono'); S.f.dono = S.f.dono === d ? '' : d; guardar(); render(); return; }
      var mo = t.closest('[data-motivo]'); if (mo) { var k = mo.getAttribute('data-motivo'); S.motivo = S.motivo === k ? '' : k; render(); var l2 = $('ls-tb'); if (S.motivo && l2) l2.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      var cl = t.closest('[data-cli]'); if (cl) { var b = $('ls-busca'); S.busca = cl.getAttribute('data-cli'); if (b) b.value = S.busca; render(); var l3 = $('ls-tb'); if (l3) l3.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      var tr = t.closest('tr[data-num]'); if (tr) abrirFicha(tr);
    });
    app.addEventListener('keydown', function (ev) {
      var tr = ev.target.closest && ev.target.closest('tr[data-num]');
      if (tr && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); abrirFicha(tr); }
    });
    D.addEventListener('visibilitychange', function () { if (!D.hidden) carregar(); });
    setInterval(function () { if (!D.hidden) carregar(); }, 60000);
  }
  // a ficha da cotação à direita (cotacoes-ficha.js); ‹ › andam pela lista na ordem da tela
  function abrirFicha(tr) {
    var num = tr.getAttribute('data-num');
    if (!C.ficha) { location.href = 'comercial-cot-casos.html?caso=' + encodeURIComponent(num); return; }
    C.ficha.abrir(num, {
      origem: tr,
      resumo: function (n) { for (var i = 0; i < S.casos.length; i++) if (S.casos[i].numero === n) return S.casos[i]; return null; },
      lista: function () { return Array.prototype.map.call(D.querySelectorAll('#ls-tb tr[data-num]'), function (x) { return x.getAttribute('data-num'); }); },
      avisoDias: avisoDias
    });
  }
  var buscar = C.debounce(function () { renderLista(linhas()); if (C.ficha) C.ficha.atualizar(); }, 160);

  function iniciar() {
    ligar();
    render();
    C.aguardarLogin().then(function () { return carregar(true); });
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
