/* ================================================================
   cotacoes-funil.js — FUNIL DE COTAÇÕES (pages/comercial-cot-funil.html)

   20/10/2026 (pedido do usuário): o Funil das cotações no desenho do
   Funil de Vendas da Licitação (pages/licitacao-funil-semanal.html, o
   mesmo CSS), sobre o motor cotacoes-semana.js — dados, filtros, a janela
   de semanas e a semana AVALIADA; a ficha à direita é o cotacoes-ficha.js:

     • a semana avaliada (as setas) e o herói: as COTADAS da semana — quantas
       seguem em aberto, viraram pedido (ganhas) ou não viraram (perdidas)
       hoje — e o funil das quatro situações, com as fases embaixo;
     • SEMANA A SEMANA: quatro barras por semana, setas que andam a janela; o
       clique avalia a semana (Ctrl soma). MENSAL: os meses deste ano ao lado
       do mesmo mês do ano passado (o mês em curso, até o mesmo dia) e o
       acumulado do ano. Embaixo, a tabela das semanas (ou dos meses): a
       linha abre as cotações dela, dia a dia;
     • PARTICIPAÇÃO POR RESPONSÁVEL: a semana contra a média das semanas
       anteriores, a situação de hoje e o dia da semana (só quem cotou);
     • POR ÁREA (a unidade de negócio), por portal e por cliente;
     • até onde as cotações chegam (proposta → pedido → Dynamics);
     • FASES E COTAÇÕES: um cartão por fase e a lista — a cotação abre a
       ficha à direita.

   A área de cada um: o servidor só manda as cotações da(s) unidade(s) de
   negócio da pessoa (o dono vê todas) — nada daqui enxerga outra unidade.
   ================================================================ */
(function () {
  'use strict';
  var C = window.COT, S = window.COTS;
  if (!C || !S || !document.body || document.body.getAttribute('data-cot-pagina') !== 'funil') return;
  var D = document, $ = C.$, esc = C.esc;
  var COR = S.COR, NOME = S.NOME, UM = S.UM, F = S.F, SEM = S.SEM, MV = ['ag', 'and', 'gan', 'per'];
  var addDias = S.addDias, difDias = S.difDias, dm = S.dm, isoSemana = S.isoSemana, curto = S.curto, nf1 = S.nf1, brl0 = S.brl0, pl = S.pl, setT = S.setT, setH = S.setH;
  var quatro = S.quatro, nv = S.nv;
  var COR_ANT = '#A4B6BE';   // o ano passado (Mensal)
  var DS7 = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
  var UC = null;

  function val(c, x) { return c.met === 'n' ? x.n : x.v; }
  function fm(c, x) { return c.met === 'n' ? F.int(x) : F.mi(x); }
  // texto dentro da faixa colorida: o azul-claro pede tinta escura (contraste)
  function tintaDe(k) { return k === 'and' ? '#10323E' : S.tinta(COR[k]); }
  function cotTxt(n) { return n === 1 ? 'oportunidade' : 'oportunidades'; }
  // a etapa do pedido de uma ganha
  // 21/10/2026 (pedido do usuário): "Aguardando o PI" não existe mais — é Ganha
  var ETAPAS = { pi: ['Ganha', '#2FBF71'], ov: ['Aguardando a OV', '#77B2C0'], ok: ['Fechada com OV', '#138A4B'] };
  function etapa(o) { return (o.c.ovs || []).length ? 'ok' : o.c.pi === 'enviado' ? 'ov' : 'pi'; }
  function badge(o) { var f = C.fase(o.fase); return '<span class="fv-badge" style="--c:' + f.cor + ';" title="' + esc(f.nome) + '"><i></i>' + esc(f.nome) + '</span>'; }

  /* ══════════════════════════════════════════════════════════════
     VAZIO / RENDER
     ══════════════════════════════════════════════════════════════ */
  function vazio(msg) {
    ['fn-host', 'wk-host', 'fases-host', 'unid-host', 'portal-host', 'cli-host'].forEach(function (id) { setH(id, '<div class="fv-empty">' + esc(msg) + '</div>'); });
    ['hr-val', 'hr-cnt', 'hr-tot', 'hr-gan', 'hr-gan-s', 'hr-per', 'hr-per-s', 'hr-tx', 'hr-tx-s', 'hr-tv', 'hr-tv-s', 'ls-info'].forEach(function (id) { setT(id, '—'); });
    ['hr-split', 'hr-legs', 'fn-fases', 'pe-head', 'pe-foot', 'ls-head', 'ls-foot', 'wk-leg', 'wk-head', 'wk-foot', 'wk-nota', 'wk-mnota', 'conv-host'].forEach(function (id) { setH(id, ''); });
    ['ls-body', 'wk-body'].forEach(function (id) { setH(id, '<tr><td class="tx dim ng-vz">' + esc(msg) + '</td></tr>'); });
    setH('pe-body', '<tr><td class="gd-empty">' + esc(msg) + '</td></tr>');
    var m = $('ls-mais'); if (m) m.hidden = true;
    UC = null;
  }
  function render(c) {
    UC = c;
    Array.prototype.forEach.call(D.querySelectorAll('.cot-rec'), function (e) { e.textContent = 'cotadas ' + c.quando(true); });
    pintarFunil(c);
    pintarGrafico(c);
    pintarTabela(c);
    pintarDonas(c);
    pintarRecortes(c);
    pintarConversao(c);
    pintarLista(c);
  }

  /* ══════════════════════════════════════════════════════════════
     HERÓI: os totais das cotadas + o funil das quatro situações
     ══════════════════════════════════════════════════════════════ */
  function pintarHero(c, T) {
    var f = c.foco, WK = c.WK;
    setT('hr-k', 'Cotadas ' + c.quando());
    setT('hr-val', F.mi(T.ag.v));
    setT('hr-cnt', F.int(T.ag.n) + ' ' + cotTxt(T.ag.n));
    var per = f.length === 1 ? 'de ' + dm(f[0]) + ' a ' + dm(addDias(f[0], 6)) : f.length ? 'em ' + f.length + ' semanas' : WK.length ? 'de ' + dm(WK[0]) + ' a ' + dm(addDias(WK[WK.length - 1], 6)) : '';
    var nFat = c.ls.filter(function (o) { return o.fase === 'faturar'; }).length;
    setH('hr-tot', 'Data da cotação ' + esc(per) + ' · <b>' + F.int(T.and.n) + '</b> ainda em aberto');
    var tot = val(c, T.ag) || 1, barra = $('hr-split');
    barra.innerHTML = ['and', 'gan', 'per'].map(function (k) {
      var x = val(c, T[k]); if (!x) return '';
      return '<i data-cs-lista="' + k + '" style="width:' + (x / tot * 100).toFixed(2) + '%;background:' + COR[k] + ';color:' + tintaDe(k) + ';cursor:pointer;"' +
        ' title="' + esc(NOME[k] + ': ' + fm(c, x) + ' · ' + F.pct(x / tot, 0) + ' das cotadas — clique para ver a lista') + '"><span data-pct="' + F.pct(x / tot, 0) + '">' + fm(c, x) + '</span></i>';
    }).join('');
    // o que não couber no pedaço vira a %; se nem ela couber, sai (fica na legenda)
    Array.prototype.forEach.call(barra.querySelectorAll('i > span'), function (sp) {
      if (sp.scrollWidth <= sp.parentNode.clientWidth) return;
      sp.textContent = sp.getAttribute('data-pct');
      if (sp.scrollWidth > sp.parentNode.clientWidth) sp.parentNode.removeChild(sp);
    });
    setH('hr-legs', ['and', 'gan', 'per'].map(function (k) {
      return '<span class="fv-spleg"><i style="background:' + COR[k] + ';"></i>' + esc(NOME[k]) + ' <b>' + fm(c, val(c, T[k])) + '</b> · ' + F.pct(val(c, T[k]) / tot, 0) + '</span>';
    }).join(''));
    setT('hr-gan', F.mi(T.gan.v));
    setT('hr-gan-s', F.int(T.gan.n) + ' ' + cotTxt(T.gan.n) + (T.gan.vPed ? ' · ' + F.mi(T.gan.vPed) + ' em pedidos' : ''));
    setT('hr-per', F.mi(T.per.v));
    // 21/10/2026: a Vencida e a Cancelada viraram motivos da Perdida — conta pelo motivo
    var pf = { perdida: 0, vencida: 0, cancelada: 0 };
    c.ls.forEach(function (o) { if (o.sit !== 'per') return; var m = C.norm(o.c.perda || ''); pf[/vencid/.test(m) ? 'vencida' : /cancel|desert/.test(m) ? 'cancelada' : 'perdida']++; });
    setT('hr-per-s', T.per.n ? F.int(pf.perdida) + ' perdida(s) · ' + F.int(pf.vencida) + ' por proposta vencida · ' + F.int(pf.cancelada) + ' cancelada(s)' : 'nenhuma ' + c.quando(true));
    setT('hr-tx', T.ag.n ? F.pct(T.gan.n / T.ag.n, 0) : '—');
    setT('hr-tx-s', T.ag.n ? F.int(T.gan.n) + ' ' + pl(T.gan.n, UM.gan) + ' de ' + F.int(T.ag.n) + ' ' + pl(T.ag.n, UM.ag) : 'nenhuma cotada no recorte');
    setT('hr-tv', T.ag.v ? F.pct(T.gan.v / T.ag.v, 0) : '—');
    setT('hr-tv-s', T.ag.v ? F.mi(T.gan.v) + ' de ' + F.mi(T.ag.v) : 'sem valor cotado');
  }
  // Uma escala só — a das cotadas (o total); as outras três são pedaços
  // dela. Embaixo, as fases de cada resultado (clique filtra a lista).
  function pintarFunil(c) {
    var T = quatro(c.ls), q = c.quando(true), met = c.met, host = $('fn-host'), fasesH = $('fn-fases');
    pintarHero(c, T);
    setT('fn-tt', c.foco.length === 1 ? 'Funil da semana' : c.foco.length ? 'Funil das semanas avaliadas' : 'Funil do período');
    setT('fn-sub', 'cotadas = data da cotação ' + q + ' · em aberto, ganhas e perdidas = a situação de hoje delas · clique para ver a lista');
    if (!T.ag.n) {
      host.innerHTML = '<div class="fv-empty">Nenhuma oportunidade ' + esc(q) + ' com os filtros escolhidos.</div>';
      fasesH.innerHTML = ''; return;
    }
    var max = Math.max(val(c, T.ag), 1), PISO = 26;
    var css = function (y) { return 'max(' + (PISO + (100 - PISO) * y / max).toFixed(1) + '%, var(--fn-min))'; };
    var NADA = { and: 'nenhuma em aberto', fat: 'nenhuma a faturar', gan: 'nenhuma ganha', per: 'nenhuma perdida' };
    // 27/10/2026 (pedido do usuário): a A faturar no funil — a faixa logo abaixo
    // das em aberto (ela é parte delas: aberta, aguardando a Ordem de Venda)
    var FAT = { n: 0, v: 0 }; c.ls.forEach(function (o) { if (o.fase === 'faturar') { FAT.n++; FAT.v += o.v; } });
    var Tx = Object.assign({}, T, { fat: FAT }), CORx = Object.assign({}, COR, { fat: C.fase('faturar').cor });
    var NOMEx = Object.assign({}, NOME, { fat: 'A faturar' }), DICAx = Object.assign({}, S.DICA, { fat: 'em aberto, aguardando o faturamento (a Ordem de Venda) — parte das em aberto' });
    var pctAg = function (x) { return F.pct(val(c, T.ag) ? val(c, x) / val(c, T.ag) : 0, 0); };
    var faixa = function (k) {
      var x = Tx[k], vaz = !x.n, pc = k !== 'ag' ? pctAg(x) : null;
      var sub = '<b>' + F.mi(x.v) + '</b> · ' + F.int(x.n) + ' op.' + (pc ? ' · <span class="cv" title="das cotadas ' + esc(q) + ', em ' + (met === 'n' ? 'quantidade' : 'valor') + '">' + pc + '</span>' : '');
      var dentro = vaz ? NADA[k] : (met === 'n' ? '<b>' + F.int(x.n) + ' op.</b> · ' + F.mi(x.v) : '<b>' + F.mi(x.v) + '</b> · ' + F.int(x.n) + ' op.') + (pc ? ' · ' + pc : '');
      var est = 'width:' + css(vaz ? 0 : val(c, x)) + ';' + (vaz
        ? 'background:' + S.hexA(CORx[k], 0.12) + ';color:#5F727A;border:1px dashed ' + S.hexA(CORx[k], 0.7) + ';box-shadow:none;'
        : 'background:' + CORx[k] + ';color:' + (k === 'fat' ? S.tinta(CORx.fat) : tintaDe(k)) + ';');
      var dica = NOMEx[k] + ' — ' + DICAx[k] + ': ' + F.int(x.n) + ' ' + cotTxt(x.n) + ' · ' + F.brl(x.v) + ' — clique para ver a lista';
      // (a A faturar é uma fase: o clique filtra a lista por ela)
      var on = k === 'ag' ? !NG.fases && !NG.etapa : k === 'fat' ? !!(NG.fases && NG.fases.length === 1 && NG.fases[0] === 'faturar' && !NG.sit) : NG.sit === k;
      return '<div class="fv-fn-row ' + k + (on ? ' on' : '') + '" ' + (k === 'fat' ? 'data-cs-pf="faturar"' : 'data-cs-lista="' + k + '"') + ' title="' + esc(dica) + '" role="button" tabindex="0">' +
        '<div class="fv-fn-lb"><div class="t">' + NOMEx[k] + '</div><div class="s">' + sub + '</div></div>' +
        '<div class="fv-fn-w"><div class="fv-fn-bar' + (vaz ? ' vazia' : '') + '" style="' + est + '"><span>' + dentro + '</span></div></div></div>';
    };
    // RECORTE MSB (05/11/2026, pedido do dono): sem a fase A faturar — sem a faixa dela
    host.innerHTML = faixa('ag') + '<div class="fv-fn-sep"><span class="k">Das cotadas, hoje</span><hr></div>' + faixa('and') + faixa('gan') + faixa('per');

    // embaixo: as fases das em aberto e das perdidas, e a etapa do pedido das ganhas
    var porF = { and: {}, per: {} }, porE = {};
    c.ls.forEach(function (o) {
      if (o.sit === 'gan') { var e = etapa(o), y = porE[e] || (porE[e] = { n: 0, v: 0 }); y.n++; y.v += o.v; return; }
      var m = porF[o.sit], x = m[o.fase] || (m[o.fase] = { n: 0, v: 0 }); x.n++; x.v += o.v;
    });
    var chips = function (k, rot) {
      var m = porF[k], fs = C.FASES.filter(function (f) { return m[f.id]; });
      if (!fs.length) return '';
      return '<span class="fs-pfl"><span class="k">' + rot + '</span>' + fs.map(function (f) {
        var x = m[f.id];
        return '<button type="button" class="fa-chip' + (NG.fases && NG.fases.length === 1 && NG.fases[0] === f.id ? ' on' : '') + '" data-cs-pf="' + f.id + '" title="' + esc(f.nome + ': ' + F.int(x.n) + ' · ' + F.brl(x.v) + ' — clique para ver na lista') + '">' +
          '<i style="background:' + f.cor + ';"></i>' + esc(f.nome) + ' <b>' + F.int(x.n) + '</b></button>';
      }).join('') + '</span>';
    };
    var es = Object.keys(ETAPAS).filter(function (k) { return porE[k]; });
    var chipsE = es.length ? '<span class="fs-pfl"><span class="k">Ganhas · o pedido</span>' + es.map(function (k) {
      var x = porE[k];
      return '<button type="button" class="fa-chip' + (NG.etapa === k ? ' on' : '') + '" data-cs-pe="' + k + '" title="' + esc(ETAPAS[k][0] + ': ' + F.int(x.n) + ' · ' + F.brl(x.v) + ' — clique para ver na lista') + '">' +
        '<i style="background:' + ETAPAS[k][1] + ';"></i>' + esc(ETAPAS[k][0]) + ' <b>' + F.int(x.n) + '</b></button>';
    }).join('') + '</span>' : '';
    var h = chips('and', 'Em aberto por fase') + chipsE + chips('per', 'Perdidas por fase');
    fasesH.innerHTML = h ? '<div class="fs-pfs2">' + h + '</div>' : '';
  }

  /* ══════════════════════════════════════════════════════════════
     O GRÁFICO: Semanal (padrão) ou Mensal (este ano × o ano passado)
     ══════════════════════════════════════════════════════════════ */
  var LS_VIS = 'cot-funil-vis';
  var VIS = (function () { try { return localStorage.getItem(LS_VIS) === 'mes' ? 'mes' : 'sem'; } catch (e) { return 'sem'; } })();
  function pintarGrafico(c) {
    Array.prototype.forEach.call(D.querySelectorAll('#wk-vis [data-cvis]'), function (b) {
      var on = b.getAttribute('data-cvis') === VIS; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var mes = VIS === 'mes', ano = c.hoje.slice(0, 4);
    setT('wk-tt', mes ? 'Mês a mês · ' + ano + ' × ' + (+ano - 1) : 'Semana a semana');
    setT('wk-sub', mes ? 'cotadas em cada mês deste ano ao lado do mesmo mês do ano passado (o mês em curso, até o mesmo dia), pela data da cotação · com os filtros da barra · não muda com o período nem com a semana avaliada'
      : 'cotadas, em aberto, ganhas e perdidas de cada semana, pela data da cotação · clique na semana para avaliá-la · Ctrl+clique soma semanas');
    var tk = $('wk-tk');
    if (tk) { tk.hidden = !mes; tk.textContent = 'Mês a mês · cada mês de ' + ano + ' com o mesmo mês de ' + (+ano - 1) + ' · clique no mês para ver as oportunidades dele'; }
    if (mes) pintarMeses(c); else { setH('wk-mnota', ''); pintarSemanas(c); }
  }

  // ── semana a semana: quatro barras com rótulo, setas e divisórias ─
  // Só as semanas que CABEM; a seta anda uma tela de semanas dentro da
  // janela e, na ponta, anda a janela (o mesmo tanto).
  var IC_ESQ = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
  var IC_DIR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
  var WKV = { ini: null, k: 0, jan: '', foco: '', salto: 0 }, WKV_PX = 162;
  function cabem(host, n) { return host.clientWidth ? Math.max(1, Math.min(n, Math.floor((host.clientWidth - 2 * (30 + 6) - 2 + 6) / WKV_PX))) : n; }
  function telaSemanas(host, WK, foco) {
    var n = WK.length, k = cabem(host, n), jan = WK[0] + '|' + WK[n - 1], fk = foco.join(',');
    if (jan !== WKV.jan) { WKV.ini = WKV.salto < 0 ? 0 : null; WKV.jan = jan; if (WKV.salto) WKV.foco = fk; }
    WKV.salto = 0;
    var ini = WKV.ini == null ? n - k : Math.max(0, Math.min(WKV.ini, n - k));
    if (fk !== WKV.foco) {
      WKV.foco = fk;
      var vis = foco.some(function (s) { var i = WK.indexOf(s); return i >= ini && i < ini + k; });
      var ul = foco.length ? WK.indexOf(foco[foco.length - 1]) : -1;
      if (!vis && ul >= 0) ini = ul < ini ? ul : ul - k + 1;
    }
    WKV.ini = ini >= n - k ? null : ini; WKV.k = k;
    return { ini: ini, k: k, n: n };
  }
  function setas(c, V) {
    var WK = c.WK;
    var faixa = function (a) {
      var b = a + V.k - 1;
      return (a === b ? 'a semana ' + isoSemana(WK[a]) : 'as semanas ' + isoSemana(WK[a]) + ' a ' + isoSemana(WK[b])) + ' (' + dm(WK[a]) + ' a ' + dm(addDias(WK[b], 6)) + ')';
    };
    var bt = function (lado, attr, dica, off) {
      return '<button type="button" class="fs-wk-nav"' + attr + ' aria-label="Semanas ' + (lado < 0 ? 'anteriores' : 'seguintes') + '"' + (off ? ' disabled' : '') + ' title="' + esc(dica) + '">' + (lado < 0 ? IC_ESQ : IC_DIR) + '</button>';
    };
    return {
      esq: V.ini > 0 ? bt(-1, ' data-cs-tela="-1"', 'Ver ' + faixa(Math.max(0, V.ini - V.k)))
        : bt(-1, ' data-cs-jan="-1"', 'Ver as ' + V.k + ' semanas anteriores (' + dm(addDias(WK[0], -7 * V.k)) + ' a ' + dm(addDias(WK[0], -1)) + ') — o período anda junto'),
      dir: V.ini + V.k < V.n ? bt(1, ' data-cs-tela="1"', 'Ver ' + faixa(Math.min(V.n - V.k, V.ini + V.k)))
        : c.noFim ? bt(1, '', 'O período já chega a esta semana', true)
        : bt(1, ' data-cs-jan="1"', 'Ver as semanas seguintes — o período anda junto')
    };
  }
  function moverTela(d) {
    if (!UC || !UC.WK.length) return;
    var n = UC.WK.length, k = WKV.k || 1, ini = Math.max(0, Math.min(n - k, (WKV.ini == null ? n - k : WKV.ini) + d * k));
    WKV.ini = ini >= n - k ? null : ini;
    pintarSemanas(UC);
  }
  function legenda() { return MV.map(function (k) { return '<span><i style="background:' + COR[k] + ';"></i>' + esc(NOME[k]) + '</span>'; }).join(''); }
  function pintarSemanas(c) {
    var host = $('wk-host'), WK = c.WK, foco = c.foco, segHoje = S.segunda(c.hoje), met = c.met;
    var por = {};
    c.lsJ.forEach(function (o) { (por[o.semana] || (por[o.semana] = [])).push(o); });
    setH('wk-leg', legenda());
    if (!WK.length) { host.innerHTML = '<div class="fv-empty">Sem semanas no período.</div>'; return; }
    var V = telaSemanas(host, WK, foco);
    var T = WK.slice(V.ini, V.ini + V.k).map(function (s) { return { s: s, t: quatro(por[s] || []) }; });
    // a escala é a das semanas À VISTA; a de cima é sempre a das cotadas
    var max = Math.max.apply(null, T.map(function (x) { return val(c, x.t.ag); }).concat([1])), TETO = 0.8;
    var rot = function (y) { return met === 'n' ? F.int(y) : curto(y); };
    var dica = function (x, ef, at) {
      return 'Semana ' + isoSemana(x.s) + ' (' + dm(x.s) + ' a ' + dm(addDias(x.s, 6)) + ')' + (at ? ', em curso' : '') + ': ' +
        MV.map(function (k) { return NOME[k].toLowerCase() + ' ' + F.int(x.t[k].n) + ' (' + F.brl(x.t[k].v) + ')'; }).join(' · ') +
        (ef ? ' · clique de novo para ver o período todo' : ' · clique para avaliar esta semana');
    };
    var plot = T.map(function (x) {
      var ef = foco.indexOf(x.s) >= 0, at = x.s === segHoje;
      var barras = MV.map(function (k) {
        var y = val(c, x.t[k]);
        return '<span class="b' + (y ? '' : ' z') + '"><em>' + esc(rot(y)) + '</em><i style="height:' + (y ? Math.max(y / max * TETO * 100, 1.2).toFixed(2) + '%' : '2px') + ';background:' + COR[k] + ';"></i></span>';
      }).join('');
      return '<div class="fv-mes-col' + (ef ? ' foco' : '') + (at ? ' atual' : '') + '" data-cs-sem="' + x.s + '" title="' + esc(dica(x, ef, at)) + '"><div class="fs-quad">' + barras + '</div></div>';
    }).join('');
    var xs = T.map(function (x) {
      return '<span class="' + (foco.indexOf(x.s) >= 0 ? 'foco' : '') + (x.s === segHoje ? ' atual' : '') + '" data-cs-sem="' + x.s + '" title="' + dm(x.s) + ' a ' + dm(addDias(x.s, 6)) + '">Semana ' + isoSemana(x.s) + '</span>';
    }).join('');
    var vs = T.map(function (x) { return '<span class="tg" data-cs-sem="' + x.s + '" title="taxa de ganho: ganhas ÷ cotadas da semana">' + (x.t.ag.n ? F.pct(x.t.gan.n / x.t.ag.n, 0) : '') + '</span>'; }).join('');
    var A = setas(c, V);
    host.innerHTML = '<div class="fs-wkw">' + A.esq + '<div class="fv-mes-sc" style="overflow:hidden;"><div class="fv-mes-in">' +
      '<div class="fv-mes-plot">' + plot + '</div><div class="fv-mes-x">' + xs + '</div><div class="fv-mes-v">' + vs + '</div></div></div>' + A.dir + '</div>';
  }
  // a tela mudou de largura: cabem mais (ou menos) semanas
  (function () {
    var h = $('wk-host'), t = 0; if (!h) return;
    var ver = function () { if (UC && VIS === 'sem' && UC.WK.length && cabem(h, UC.WK.length) !== WKV.k) pintarSemanas(UC); };
    if (typeof ResizeObserver === 'function') new ResizeObserver(function () { cancelAnimationFrame(t); t = requestAnimationFrame(ver); }).observe(h);
    else window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(ver, 120); });
  })();

  // ── mês a mês: os meses DESTE ANO, cada um ao lado do mesmo mês do ano
  // passado (o mês em curso compara até o mesmo dia), e o acumulado do ano.
  // Com os filtros da barra; a janela e a semana avaliada não mexem nela.
  function meses(c) {
    var hj = c.hoje, anoA = hj.slice(0, 4), anoP = String(+anoA - 1), mmdd = hj.slice(5), mmA = hj.slice(5, 7);
    var por = {};
    c.todas.forEach(function (o) { if (o.mes) (por[o.mes] || (por[o.mes] = [])).push(o); });
    var ate = function (ls) { return ls.filter(function (o) { return o.dia.slice(5) <= mmdd; }); };
    var out = [];
    for (var i = 1; i <= +mmA; i++) {
      var mm = String(i).padStart(2, '0'), ka = anoA + '-' + mm, kp = anoP + '-' + mm, atual = mm === mmA;
      var la = por[ka] || [], lp = por[kp] || [];
      out.push({ ym: ka, ymp: kp, atual: atual, ls: la, a: quatro(la), p: quatro(atual ? ate(lp) : lp), pc: quatro(lp) });
    }
    // os meses de antes de haver cotação (nem neste ano nem no passado) saem
    while (out.length > 1 && !out[0].a.ag.n && !out[0].pc.ag.n) out.shift();
    var YA = quatro(c.todas.filter(function (o) { return o.dia.slice(0, 4) === anoA && o.dia <= hj; }));
    var YP = quatro(c.todas.filter(function (o) { return o.dia.slice(0, 4) === anoP && o.dia.slice(5) <= mmdd; }));
    return { ms: out, anoA: anoA, anoP: anoP, ate: dm(hj), YA: YA, YP: YP };
  }
  function variacao(a, b, dica) {
    if (!b) return '<span class="fc-dv" title="' + esc(dica + ' — sem base no ano passado') + '">' + (a ? 'novo' : '') + '</span>';
    var r = Math.round((a / b - 1) * 100);
    return '<span class="fc-dv ' + (r > 0 ? 'up' : r < 0 ? 'dn' : '') + '" title="' + esc(dica) + '">' + (r > 0 ? '▲ +' : r < 0 ? '▼ ' : '= ') + Math.abs(r) + '%</span>';
  }
  function pintarMeses(c) {
    var host = $('wk-host'), met = c.met, M = meses(c), ms = M.ms, TETO = 0.84;
    setH('wk-leg', '<span><i style="background:' + COR.ag + ';"></i>' + esc(M.anoA) + '</span><span><i style="background:' + COR_ANT + ';"></i>' + esc(M.anoP) + ' · o mesmo mês</span>');
    var vv = function (x) { return met === 'n' ? x.n : x.v; };
    var max = Math.max.apply(null, ms.map(function (m) { return Math.max(vv(m.a.ag), vv(m.p.ag)); }).concat([1e-9]));
    var ql = function (x) { return F.int(x.ag.n) + ' ' + cotTxt(x.ag.n) + ' · ' + F.brl(x.ag.v) + ' · ' + F.int(x.gan.n) + ' ganha(s)'; };
    var barra = function (x, cls, cor) {
      return '<div class="fc-pb ' + cls + '"><span class="n">' + (x.ag.n ? (met === 'n' ? F.int(x.ag.n) : curto(x.ag.v)) : '') + '</span>' +
        '<i style="height:' + (x.ag.n ? Math.max(vv(x.ag) / max * TETO * 100, 1.2) : 0).toFixed(2) + '%;background:' + cor + ';"></i></div>';
    };
    var plot = ms.map(function (m) {
      var dica = F.mes(m.ym) + (m.atual ? ' (até hoje, ' + M.ate + ')' : '') + ': ' + ql(m.a) + '\n' + F.mes(m.ymp) + (m.atual ? ' (até ' + M.ate + ')' : '') + ': ' + ql(m.p) +
        (m.atual ? '\n' + F.mes(m.ymp) + ' inteiro: ' + ql(m.pc) : '');
      return '<div class="fv-mes-col fc-mc" data-cs-mesg="' + m.ym + '" title="' + esc(dica) + '"><div class="fc-par">' + barra(m.a, 'a', COR.ag) + barra(m.p, 'p', COR_ANT) + '</div></div>';
    }).join('');
    var xs = ms.map(function (m) { return '<span class="' + (m.atual ? 'atual' : '') + '">' + F.mes(m.ym, false) + (m.atual ? ' · até ' + M.ate : '') + '</span>'; }).join('');
    var vs = ms.map(function (m) { return variacao(vv(m.a.ag), vv(m.p.ag), F.mes(m.ym) + ' contra ' + F.mes(m.ymp) + ', em ' + (met === 'n' ? 'quantidade' : 'valor') + ' cotado'); }).join('');
    var leg = '<div class="fc-dleg"><span><i style="background:' + COR.ag + ';"></i>' + esc(M.anoA) + '</span><span><i style="background:' + COR_ANT + ';"></i>' + esc(M.anoP) + ' · o mesmo mês</span>' +
      '<span class="r">Barra = ' + (met === 'n' ? 'quantidade' : 'valor') + ' cotado; embaixo, a variação contra ' + esc(M.anoP) + '</span></div>';
    host.innerHTML = '<div class="fc-mm"><div class="fc-mm-m"><div class="fv-mes-sc"><div class="fv-mes-in" style="min-width:' + (ms.length * 76) + 'px;">' +
      '<div class="fv-mes-plot">' + plot + '</div><div class="fv-mes-x">' + xs + '</div><div class="fv-mes-v">' + vs + '</div></div></div>' + leg + '</div>' + acumulado(c, M) + '</div>';
    var A = M.YA, P = M.YP;
    setH('wk-mnota', '<b>' + esc(M.anoA) + ' até agora:</b> ' + esc(F.mi(A.ag.v)) + ' cotados em ' + F.int(A.ag.n) + ' ' + cotTxt(A.ag.n) + ' · ' + F.int(A.gan.n) + ' ganha(s) (' + F.pct(A.ag.n ? A.gan.n / A.ag.n : null, 0) + ')' +
      ' · <b>' + esc(M.anoP) + ' no mesmo período:</b> ' + esc(F.mi(P.ag.v)) + ' em ' + F.int(P.ag.n) + ' ' + cotTxt(P.ag.n) + ' · ' + F.int(P.gan.n) + ' ganha(s)' +
      ' · o mês em curso compara até o mesmo dia (' + M.ate + ') · com os filtros da barra');
  }
  // ao lado dos meses: o acumulado do ano × o do ano passado no MESMO período
  function acumulado(c, M) {
    var met = c.met, TETO = 0.84, A = M.YA, P = M.YP;
    var vv = function (x) { return met === 'n' ? x.n : x.v; };
    var max = Math.max(vv(A.ag), vv(P.ag), 1e-9);
    var col = function (x, ano, cor, cls) {
      return '<div class="fv-mes-col fc-mc ' + cls + '" title="' + esc(ano + ', de 1º/jan até ' + M.ate + ': ' + F.int(x.ag.n) + ' ' + cotTxt(x.ag.n) + ' · ' + F.brl(x.ag.v) + ' · ' + F.int(x.gan.n) + ' ganha(s)') + '">' +
        '<span class="fv-mes-n">' + (x.ag.n ? (met === 'n' ? F.int(x.ag.n) : curto(x.ag.v)) : '0') + '</span>' +
        '<div class="fv-mes-stk" style="height:' + (x.ag.n ? Math.max(vv(x.ag) / max * TETO * 100, 1.2) : 0).toFixed(2) + '%;"><i style="height:100%;background:' + cor + ';"></i></div></div>';
    };
    var dl = function (a, b, rot) {
      if (!b) return '<span class="fc-ya-d" title="sem base no ano passado">— ' + rot + '</span>';
      var r = Math.round((a / b - 1) * 100), cl = r > 0 ? 'up' : r < 0 ? 'dn' : '';
      return '<span class="fc-ya-d ' + cl + '" title="' + esc(M.anoA + ' contra ' + M.anoP + ', de 1º/jan até ' + M.ate) + '">' + (r > 0 ? '▲ +' : r < 0 ? '▼ ' : '= ') + Math.abs(r) + '% ' + rot + '</span>';
    };
    return '<div class="fc-mm-a"><div class="fv-mes-plot">' + col(A, M.anoA, COR.ag, 'ya') + col(P, M.anoP, COR_ANT, 'yp') + '</div>' +
      '<div class="fv-mes-x"><span class="ya">' + esc(M.anoA) + '</span><span>' + esc(M.anoP) + '</span></div>' +
      '<div class="fv-mes-v"><span>' + (met === 'n' ? curto(A.ag.v) : F.int(A.ag.n) + ' op.') + '</span><span>' + (met === 'n' ? curto(P.ag.v) : F.int(P.ag.n) + ' op.') + '</span></div>' +
      '<div class="fc-ya"><span class="k">Acumulado · 1º/jan a ' + M.ate + '</span>' + dl(A.ag.v, P.ag.v, 'cotado') + dl(A.ag.n, P.ag.n, 'em oportunidades') + dl(A.gan.v, P.gan.v, 'ganho') + '</div></div>';
  }

  /* ══════════════════════════════════════════════════════════════
     A TABELA embaixo do gráfico: as semanas da janela (ou os meses do
     ano, no Mensal). A linha abre as cotações dela em faixas por dia; na
     semana, o clique também a avalia (de novo fecha; Ctrl soma, sem abrir).
     ══════════════════════════════════════════════════════════════ */
  var WKA = { aberta: null, lim: {} }, WKA_PASSO = 30;
  function pintarTabela(c) { if (VIS === 'mes') tabelaMeses(c); else tabelaSemanas(c); }
  function sitCel(x, k) {
    return '<td class="' + (x.n ? (k === 'gan' ? 'pos' : k === 'per' ? 'neg' : '') : 'dim') + '">' + F.int(x.n) + (x.n ? ' <span class="fc-sub">' + esc(F.mi(x.v)) + '</span>' : '') + '</td>';
  }
  function tgCel(t) { return '<td class="tg">' + (t.ag.n ? F.pct(t.gan.n / t.ag.n, 0) + '<span class="fs-mini g"><i style="width:' + (t.gan.n / t.ag.n * 100).toFixed(1) + '%;"></i></span>' : '—') + '</td>'; }
  function tabelaSemanas(c) {
    var met = c.met, foco = c.foco, segHoje = S.segunda(c.hoje), WK = c.WK;
    var head = $('wk-head'), body = $('wk-body'), foot = $('wk-foot');
    if (!WK.length) { head.innerHTML = ''; foot.innerHTML = ''; setH('wk-nota', ''); body.innerHTML = '<tr><td class="tx dim ng-vz">Sem semanas no período.</td></tr>'; return; }
    var por = {};
    c.lsJ.forEach(function (o) { (por[o.semana] || (por[o.semana] = [])).push(o); });
    var T = WK.map(function (s) { return { s: s, t: quatro(por[s] || []) }; });
    var G = quatro(c.lsJ), tG = val(c, G.ag);
    head.innerHTML = '<tr><th class="tx">Semana</th><th title="oportunidades com a data da cotação na semana">Cotadas</th><th>Valor cotado</th>' +
      '<th title="ainda sem resultado (Cotada) · embaixo, o valor">Em aberto</th><th title="viraram pedido · embaixo, o valor">Ganhas</th>' +
      '<th title="Perdida (o motivo inclui proposta vencida e cancelada) · embaixo, o valor">Perdidas</th><th title="ganhas ÷ cotadas da semana, em quantidade">Taxa de ganho</th>' +
      '<th title="fatia da semana no ' + (met === 'n' ? 'total de oportunidades' : 'valor cotado') + ' do período">% do período</th></tr>';
    var linha = function (t) {
      return '<td class="' + (t.ag.n ? '' : 'dim') + '">' + F.int(t.ag.n) + '</td><td class="forte">' + brl0(t.ag.v) + '</td>' + sitCel(t.and, 'and') + sitCel(t.gan, 'gan') + sitCel(t.per, 'per') + tgCel(t);
    };
    body.innerHTML = T.slice().reverse().map(function (x) {
      var ef = foco.indexOf(x.s) >= 0, at = x.s === segHoje, p = tG ? val(c, x.t.ag) / tG : 0, ch = 's:' + x.s, ab = WKA.aberta === ch;
      return '<tr class="fc-wk' + (ef ? ' foco' : '') + (ab ? ' aberta' : '') + '" data-cs-wk="' + x.s + '" tabindex="0" aria-expanded="' + (ab ? 'true' : 'false') + '"' +
          ' title="' + (ab ? 'clique de novo para fechar as oportunidades' : 'clique para avaliar esta semana e ver as oportunidades dela, dia a dia') + '">' +
        '<td class="tx wk"><b><span class="fc-car">▸</span>Semana ' + isoSemana(x.s) + (at ? ' · em curso' : '') + '</b><span>' + dm(x.s) + ' a ' + dm(addDias(x.s, 6)) + '</span></td>' + linha(x.t) +
        '<td class="cv">' + (tG ? F.pct(p, 0) + '<span class="fs-mini"><i style="width:' + (p * 100).toFixed(1) + '%;"></i></span>' : '—') + '</td></tr>' +
        (ab ? '<tr class="fc-wk-det"><td class="fc-wk-dt" colspan="8">' + listaPeriodo(c, ch, por[x.s] || [], 'semana') + '</td></tr>' : '');
    }).join('');
    var nW = WK.length;
    foot.innerHTML = '<tr><td class="tx">Total · ' + F.int(nW) + ' semanas</td>' + linha(G) + '<td>' + (tG ? '100%' : '—') + '</td></tr>' +
      '<tr><td class="tx">Média por semana</td><td>' + nf1(G.ag.n / nW) + '</td><td>' + brl0(G.ag.v / nW) + '</td><td>' + nf1(G.and.n / nW) + '</td><td>' + nf1(G.gan.n / nW) + '</td><td>' + nf1(G.per.n / nW) + '</td><td></td><td></td></tr>';
    setH('wk-nota', 'Cada semana vai de <b>segunda a domingo</b>; a oportunidade conta na semana da <b>data da cotação</b> — em aberto, ganhas e perdidas são a situação de <b>hoje</b> e somam as cotadas.' +
      (WK.indexOf(segHoje) >= 0 ? ' A semana em curso ainda não terminou.' : '') + ' Clique na semana para avaliá-la e ver as oportunidades dela, dia a dia · Ctrl+clique soma semanas.');
  }
  function tabelaMeses(c) {
    var met = c.met, M = meses(c), head = $('wk-head'), body = $('wk-body'), foot = $('wk-foot');
    var vv = function (x) { return met === 'n' ? x.n : x.v; };
    head.innerHTML = '<tr><th class="tx">Mês</th><th title="oportunidades com a data da cotação no mês">Cotadas</th><th>Valor cotado</th><th title="em aberto hoje · embaixo, o valor">Em aberto</th>' +
      '<th title="viraram pedido · embaixo, o valor">Ganhas</th><th title="Perdida (o motivo inclui proposta vencida e cancelada) · embaixo, o valor">Perdidas</th><th title="ganhas ÷ cotadas do mês">Taxa de ganho</th>' +
      '<th title="o mesmo mês de ' + M.anoP + ' (o mês em curso, até o mesmo dia) · embaixo, o valor">' + M.anoP + ' · cotadas</th><th title="as ganhas do mesmo mês de ' + M.anoP + '">' + M.anoP + ' · ganhas</th>' +
      '<th title="cotado contra o mesmo mês de ' + M.anoP + ', em ' + (met === 'n' ? 'quantidade' : 'valor') + '">Var. cotado</th><th title="ganho contra o mesmo mês de ' + M.anoP + ', em ' + (met === 'n' ? 'quantidade' : 'valor') + '">Var. ganho</th></tr>';
    var dv = function (a, b) {
      if (!b) return '<td class="dim">' + (a ? 'novo' : '—') + '</td>';
      var r = Math.round((a / b - 1) * 100);
      return '<td class="' + (r > 0 ? 'pos' : r < 0 ? 'neg' : '') + '">' + (r > 0 ? '▲ +' : r < 0 ? '▼ ' : '= ') + Math.abs(r) + '%</td>';
    };
    var cel = function (x) { return '<td class="' + (x.n ? '' : 'dim') + '">' + F.int(x.n) + (x.n ? ' <span class="fc-sub">' + esc(F.mi(x.v)) + '</span>' : '') + '</td>'; };
    var linha = function (a, p) {
      return '<td class="' + (a.ag.n ? '' : 'dim') + '">' + F.int(a.ag.n) + '</td><td class="forte">' + brl0(a.ag.v) + '</td>' + sitCel(a.and, 'and') + sitCel(a.gan, 'gan') + sitCel(a.per, 'per') + tgCel(a) +
        cel(p.ag) + cel(p.gan) + dv(vv(a.ag), vv(p.ag)) + dv(vv(a.gan), vv(p.gan));
    };
    body.innerHTML = M.ms.slice().reverse().map(function (m) {
      var ch = 'm:' + m.ym, ab = WKA.aberta === ch;
      return '<tr class="fc-wk' + (ab ? ' aberta' : '') + '" data-cs-mes="' + m.ym + '" tabindex="0" aria-expanded="' + (ab ? 'true' : 'false') + '" title="' + (ab ? 'clique de novo para fechar' : 'clique para ver as oportunidades do mês, dia a dia') + '">' +
        '<td class="tx wk"><b><span class="fc-car">▸</span>' + esc(F.mes(m.ym)) + (m.atual ? ' · em curso' : ' · fechado') + '</b><span>' + (m.atual ? 'até ' + M.ate + ' · ' + esc(F.mes(m.ymp)) + ' até o mesmo dia' : 'contra ' + esc(F.mes(m.ymp))) + '</span></td>' +
        linha(m.a, m.p) + '</tr>' +
        (ab ? '<tr class="fc-wk-det"><td class="fc-wk-dt" colspan="11">' + listaPeriodo(c, ch, m.ls, 'mês') + '</td></tr>' : '');
    }).join('');
    foot.innerHTML = '<tr><td class="tx">Acumulado · 1º/jan a ' + M.ate + '</td>' + linha(M.YA, M.YP) + '</tr>';
    setH('wk-nota', 'Cada mês de <b>' + M.anoA + '</b> ao lado do <b>mesmo mês de ' + M.anoP + '</b>, pela data da cotação; o mês em curso compara até o mesmo dia (' + M.ate + '). Os meses fechados comparam inteiros. Com os filtros da barra · clique no mês para ver as oportunidades dele, dia a dia.');
  }

  // ── as cotações do período aberto na tabela, em faixas por dia — o dia
  // mais recente primeiro (21/10/2026, pedido do usuário); no dia, a de maior
  // valor primeiro; sem data, no fim — a linha abre a ficha à direita
  var COLS_P = [
    { k: 'dia', l: 'Data', dica: 'a data da cotação (a do portal)' },
    { k: 'num', l: 'Oportunidade', dica: 'o número no portal · embaixo, o portal e o nº da cotação dele' },
    { k: 'cli', l: 'Cliente' }, { k: 'uf', l: 'UF' },
    { k: 'fase', l: 'Fase hoje', dica: 'a fase de hoje · embaixo, o motivo (perdidas), o vencimento (em aberto) ou o pedido (ganhas)' },
    { k: 'dono', l: 'Responsável' }, { k: 'unidade', l: 'Unidade' },
    { k: 'v', l: 'Cotado', num: true },
    { k: 'reg', l: 'Registrada em', dica: 'o dia em que a oportunidade entrou no portal' }
  ];
  function listaPeriodo(c, ch, ls, nome) {
    if (!ls.length) return '<div class="fc-wk-vz">Nenhuma oportunidade neste ' + nome + ' com os filtros escolhidos.</div>';
    var TOT = nv(ls).v;
    var ord = ls.slice().sort(function (a, b) { return (a.dia > b.dia ? -1 : a.dia < b.dia ? 1 : 0) || b.v - a.v; });
    var vis = ord.slice(0, WKA.lim[ch] || WKA_PASSO);
    var porDia = {};
    ord.forEach(function (o) { (porDia[o.dia] || (porDia[o.dia] = [])).push(o); });
    var ant = null, h = '';
    vis.forEach(function (o) {
      if (o.dia !== ant) {
        ant = o.dia;
        var g = quatro(porDia[ant]);
        var sits = ['and', 'gan', 'per'].filter(function (k) { return g[k].n; }).map(function (k) { return '<b>' + F.int(g[k].n) + '</b> ' + pl(g[k].n, UM[k]); });
        h += '<tr class="fv-ng-g"><td class="tx" colspan="' + COLS_P.length + '">' + (ant ? esc(F.dia(ant)) + (ant === c.hoje ? ' · hoje' : '') : 'Sem data') +
          ' · <b>' + F.int(g.ag.n) + '</b> ' + cotTxt(g.ag.n) + ' · ' + esc(F.mi(g.ag.v)) + (sits.length ? ' · ' + sits.join(' · ') : '') + '</td></tr>';
      }
      h += '<tr data-num="' + esc(o.id) + '" tabindex="0">' + COLS_P.map(function (col) { return celula(o, col, c); }).join('') + '</tr>';
    });
    var resto = ord.length - vis.length;
    return '<div class="fc-wk-ng"><table class="fv-tb fv-ng cot-ng"><thead><tr>' + COLS_P.map(function (col) {
        return '<th class="' + (col.num ? '' : 'tx') + '"' + (col.dica ? ' title="' + esc(col.dica) + '"' : '') + '>' + esc(col.l) + '</th>';
      }).join('') + '</tr></thead><tbody>' + h + '</tbody>' +
      '<tfoot><tr><td class="tx" colspan="7">Total do ' + nome + ' · ' + F.int(ls.length) + ' ' + cotTxt(ls.length) + ' · pela data da cotação · clique na oportunidade para abrir a ficha</td><td>' + brl0(TOT) + '</td><td></td></tr></tfoot></table></div>' +
      (resto > 0 ? '<button type="button" class="fv-mais" data-cs-wkmais="' + esc(ch) + '">Mostrar mais ' + F.int(Math.min(WKA_PASSO, resto)) + ' · faltam ' + F.int(resto) + ' de ' + F.int(ord.length) + '</button>' : '');
  }
  function repintarTabela() { if (UC) pintarTabela(UC); }
  // a linha da semana: avalia a semana E abre as cotações dela (de novo:
  // fecha, a semana segue avaliada). Ctrl/⌘ soma semanas, sem abrir.
  function abrirSemana(s, somar) {
    if (!UC || !s) return;
    if (somar) { S.focarSemana(s, true); return; }
    var ch = 's:' + s, abrir = WKA.aberta !== ch;
    WKA.aberta = abrir ? ch : null;
    var f = UC.foco;
    if (abrir && !(f.length === 1 && f[0] === s)) { NG.lim = NG_PASSO; NG.fases = null; NG.sit = null; NG.etapa = null; S.setFoco([s]); }
    else repintarTabela();
    if (abrir) rolarAberta();
  }
  function abrirMes(m) {
    var ch = 'm:' + m;
    WKA.aberta = WKA.aberta === ch ? null : ch;
    repintarTabela();
    if (WKA.aberta) rolarAberta();
  }
  function rolarAberta() {
    setTimeout(function () { var tr = D.querySelector('#wk-body tr.fc-wk.aberta'); if (tr && tr.scrollIntoView) tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 60);
  }

  /* ══════════════════════════════════════════════════════════════
     PARTICIPAÇÃO POR RESPONSÁVEL — o formato da "Participação por
     proprietária" do Funil de Vendas (.gd-tb/.gd-det): as cotadas da semana
     avaliada de cada responsável contra a média por semana das semanas
     anteriores (até 8, desde a 1ª cotação do módulo), a situação de hoje e
     o dia da semana da cotação. Só aparece quem cotou na semana; a Equipe
     soma todo mundo. A área: só as cotações das unidades da pessoa.
     ══════════════════════════════════════════════════════════════ */
  var PE = { ord: { k: 'n', d: -1 }, aberta: null, lim: {} }, PE_PASSO = 40, PE_COLS = 19;
  function pintarDonas(c) {
    var f = c.foco, q = c.quando();
    var head = $('pe-head'), body = $('pe-body'), foot = $('pe-foot');
    // as semanas anteriores: até 8, sem contar as de antes da 1ª cotação
    var prim = c.todas.reduce(function (m, o) { return o.semana && (!m || o.semana < m) ? o.semana : m; }, '');
    var ant = [];
    if (f.length) for (var i = 8; i >= 1; i--) { var s = addDias(f[0], -7 * i); if (prim && s >= prim) ant.push(s); }
    var nA = ant.length, nF = f.length || c.WK.length || 1, naAnt = {};
    ant.forEach(function (s) { naAnt[s] = 1; });
    var mapa = {};
    var pega = function (o) {
      var k = o.donoK;
      return mapa[k] || (mapa[k] = { k: k, nome: o.donoK === SEM ? 'Sem responsável' : o.dono, n: 0, v: 0, and: 0, gan: 0, per: 0, vg: 0, rn: 0, rv: 0, d: [0, 0, 0, 0, 0, 0, 0], dv: [0, 0, 0, 0, 0, 0, 0], ls: [], clis: {}, unids: {} });
    };
    c.ls.forEach(function (o) {
      var p = pega(o), i = o.semana && o.dia ? difDias(o.semana, o.dia) : -1;
      p.n++; p.v += o.v; p[o.sit]++; if (o.sit === 'gan') p.vg += o.v; p.ls.push(o);
      if (i >= 0 && i < 7) { p.d[i]++; p.dv[i] += o.v; }
      if (o.cliente) p.clis[o.cliente] = 1;
      if (o.unidade) p.unids[o.unidade] = 1;
    });
    if (nA) c.todas.forEach(function (o) { if (naAnt[o.semana]) { var p = pega(o); p.rn++; p.rv += o.v; } });
    var fecha = function (p) {
      p.mn = nA ? p.rn / nA : null; p.mv = nA ? p.rv / nA : null;
      p.varN = p.mn ? (p.n / nF) / p.mn - 1 : null; p.varV = p.mv ? (p.v / nF) / p.mv - 1 : null;
      p.tx = p.n ? p.gan / p.n : null;
      return p;
    };
    var ls = Object.keys(mapa).map(function (k) { return fecha(mapa[k]); });
    var T = { n: 0, v: 0, and: 0, gan: 0, per: 0, vg: 0, rn: 0, rv: 0, d: [0, 0, 0, 0, 0, 0, 0], dv: [0, 0, 0, 0, 0, 0, 0] };
    ls.forEach(function (p) {
      ['n', 'v', 'and', 'gan', 'per', 'vg', 'rn', 'rv'].forEach(function (k) { T[k] += p[k]; });
      p.d.forEach(function (x, j) { T.d[j] += x; T.dv[j] += p.dv[j]; });
    });
    fecha(T);
    ls = ls.filter(function (p) { return p.n; });
    var eu = c.eu || {};
    setT('pe-sub', 'cada oportunidade conta para o responsável dela · só quem tem oportunidade ' + q +
      (nA ? ' · comparado com a média das ' + (nA === 1 ? 'semana anterior' : nA + ' semanas anteriores') : '') +
      ' · situação de hoje · ' + (eu.admin ? 'todas as unidades de negócio' : 'só as oportunidades da(s) sua(s) unidade(s) de negócio') +
      ' · clique no cabeçalho para ordenar · clique na pessoa para ver as oportunidades dela');

    var um = f.length === 1;
    var sOrd = function (k) { return PE.ord.k === k ? '<span class="seta">' + (PE.ord.d === -1 ? '▼' : '▲') + '</span>' : ''; };
    var th = function (k, r, cls, dica, cor) {
      return '<th class="ord' + (cls ? ' ' + cls : '') + (PE.ord.k === k ? ' on' : '') + '" data-pe-ord="' + k + '"' + (dica ? ' title="' + esc(dica) + '"' : '') + (cor ? ' style="--c:' + cor + ';"' : '') + '>' + r + sOrd(k) + '</th>';
    };
    var rotQ = um ? 'Na semana' : f.length ? 'Nas ' + f.length + ' sem.' : 'No período';
    var dicaM = nA ? 'média por semana das ' + (nA === 1 ? 'semana anterior' : nA + ' semanas anteriores') : 'sem semanas anteriores com oportunidade';
    var dias = DS7.map(function (nm, j) {
      var d = um ? addDias(f[0], j) : null, hj = d && d === c.hoje;
      return th('d' + j, nm + (d ? '<small>' + dm(d) + '</small>' : ''), 'dd' + (j === 0 ? ' grp' : '') + (hj ? ' hj' : ''),
        (d ? F.data(d) + (hj ? ' (hoje)' : '') : 'soma das ' + nm + ' ' + q) + ' · oportunidades com a data no dia · clique para ordenar', COR.ag);
    }).join('');
    head.innerHTML = '<tr class="g"><th class="rk" rowspan="2">#</th>' +
        '<th class="pe ord' + (PE.ord.k === 'nome' ? ' on' : '') + '" rowspan="2" data-pe-ord="nome">Responsável' + sOrd('nome') + '</th>' +
        '<th class="grp" colspan="3">Oportunidades</th><th class="grp" colspan="3">Valor cotado</th>' +
        '<th class="grp" colspan="4">Situação hoje</th>' +
        '<th class="grp" colspan="7">' + (um ? 'Por dia da cotação' : 'Por dia da cotação · somados') + ' · quantidade</th></tr>' +
      '<tr class="s">' +
        th('n', rotQ, 'grp', 'oportunidades ' + q + ' · % = fatia da equipe · clique para ordenar', COR.ag) + th('mn', 'Média anterior', '', dicaM, '#CCD5D9') +
        th('varN', 'Variação', '', 'oportunidades ' + (f.length > 1 ? 'por semana avaliada' : q) + ' contra a média anterior (quantidade)') +
        th('v', rotQ, 'grp', 'valor cotado ' + q + ' · % = fatia da equipe · clique para ordenar', COR.ag) + th('mv', 'Média anterior', '', dicaM, '#CCD5D9') +
        th('varV', 'Variação', '', 'valor ' + (f.length > 1 ? 'por semana avaliada' : q) + ' contra a média anterior') +
        th('and', 'Em aberto', 'grp', 'ainda sem resultado (Cotada)', COR.and) + th('gan', 'Ganhas', '', 'viraram pedido', COR.gan) +
        th('per', 'Perdidas', '', 'Perdida (o motivo inclui proposta vencida e cancelada)', COR.per) + th('tx', 'Taxa de ganho', '', 'ganhas ÷ cotadas, em quantidade', COR.gan) +
        dias + '</tr>';
    if (!ls.length) { body.innerHTML = '<tr><td class="gd-empty" colspan="' + PE_COLS + '">Nenhuma oportunidade ' + esc(q) + ' com os filtros escolhidos.</td></tr>'; foot.innerHTML = ''; return; }
    var chave = function (p, k) {
      if (k === 'nome') return p.k === SEM ? '￿' : p.nome;
      if (k.charAt(0) === 'd' && k.length === 2) return p.d[+k.charAt(1)];
      var x = p[k]; return x == null ? -Infinity : x;
    };
    var o = PE.ord;
    ls.sort(function (a, b) {
      var x = chave(a, o.k), y = chave(b, o.k);
      if (o.k === 'nome') return String(x).localeCompare(String(y), 'pt-BR') * o.d;
      if (x !== y) return (x - y) * o.d;
      return b.n - a.n || b.v - a.v || String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    });
    var mx = {
      n: Math.max.apply(null, ls.map(function (p) { return p.n; }).concat([0])),
      v: Math.max.apply(null, ls.map(function (p) { return p.v; }).concat([0])),
      d: Math.max.apply(null, ls.map(function (p) { return Math.max.apply(null, p.d); }).concat([0]))
    };
    var h = [];
    ls.forEach(function (p, idx) {
      var aberta = PE.aberta === p.k, sem = p.k === SEM, nC = Object.keys(p.clis).length;
      var cg = sem ? 'oportunidade sem responsável' : F.int(nC) + ' cliente' + (nC === 1 ? '' : 's') + ' · ' + F.int(p.and) + ' em aberto';
      h.push('<tr class="lin' + (aberta ? ' aberta' : '') + '" data-pe-p="' + esc(p.k) + '" tabindex="0" aria-expanded="' + (aberta ? 'true' : 'false') + '">' +
        '<td class="rk">' + (idx + 1) + '</td>' +
        '<td class="pe"><span class="nm"><span class="car">▸</span>' + esc(p.nome) + '</span><span class="cg">' + esc(cg) + '</span></td>' +
        celulasPe(p, T, mx, um, f) + '</tr>');
      if (aberta) h.push('<tr class="det"><td colspan="' + PE_COLS + '">' + detalhePe(c, p, T, q) + '</td></tr>');
    });
    body.innerHTML = h.join('');
    foot.innerHTML = '<tr><td class="rk"></td><td class="pe"><span class="nm">Equipe</span><span class="cg">' + F.int(ls.length) + ' responsáve' + (ls.length === 1 ? 'l' : 'is') + ' com oportunidade ' + esc(q) + '</span></td>' +
      celulasPe(T, T, null, um, f) + '</tr>';
  }
  function celulasPe(p, T, mx, um, f) {
    var eq = p === T;
    var cel = function (cls, txt, h, dica, sub) {
      return '<td class="' + cls + '"' + (h ? ' style="--h:' + h.toFixed(3) + ';"' : '') + (dica ? ' title="' + esc(dica) + '"' : '') + '>' + txt + (sub ? '<span class="pct">' + sub + '</span>' : '') + '</td>';
    };
    var vr = function (x, dica) {
      if (x == null || !isFinite(x)) return cel('z', '—', 0, p.mn === 0 && p.n ? 'sem oportunidade nas semanas anteriores' : 'sem base de comparação');
      var r = Math.round(x * 100);
      return cel(r > 0 ? 'up' : r < 0 ? 'dn' : '', (r > 0 ? '▲ +' : r < 0 ? '▼ ' : '= ') + Math.abs(r) + '%', 0, dica);
    };
    return cel('grp' + (p.n ? '' : ' z'), F.int(p.n), mx && mx.n ? p.n / mx.n : 0, F.int(p.n) + ' ' + cotTxt(p.n), !eq && T.n ? F.pct(p.n / T.n, 0) : '') +
      cel(p.mn ? '' : 'z', p.mn == null ? '—' : nf1(p.mn), 0, p.mn == null ? 'sem semanas anteriores com oportunidade' : nf1(p.mn) + ' oportunidades por semana antes') +
      vr(p.varN, 'quantidade contra a média anterior') +
      cel('grp' + (p.v ? '' : ' z'), esc(F.mi(p.v)), mx && mx.v ? p.v / mx.v : 0, F.brl(p.v), !eq && T.v ? F.pct(p.v / T.v, 0) : '') +
      cel(p.mv ? '' : 'z', p.mv == null ? '—' : esc(F.mi(p.mv)), 0, p.mv == null ? 'sem semanas anteriores com oportunidade' : F.brl(p.mv) + ' por semana antes') +
      vr(p.varV, 'valor contra a média anterior') +
      cel('grp' + (p.and ? '' : ' z'), F.int(p.and), 0, F.int(p.and) + ' ainda sem resultado') +
      cel(p.gan ? 'g' : 'z', F.int(p.gan), 0, F.int(p.gan) + ' ganha(s) · ' + F.brl(p.vg)) +
      cel(p.per ? 'p' : 'z', F.int(p.per), 0, F.int(p.per) + ' perdida(s)') +
      cel(p.tx == null ? 'z' : 'g', p.tx == null ? '—' : F.pct(p.tx, 0), 0, p.tx == null ? '' : F.int(p.gan) + ' ganha(s) de ' + F.int(p.n) + ' cotada(s)') +
      p.d.map(function (x, i) {
        var d = um ? addDias(f[0], i) : null;
        var dica = (d ? F.data(d) : DS7[i] + ' (somadas)') + ': ' + F.int(x) + ' ' + cotTxt(x) + ' · ' + F.brl(p.dv[i]);
        return cel('dd' + (i === 0 ? ' grp' : '') + (x ? '' : ' z'), F.int(x), mx && mx.d ? x / mx.d : 0, dica);
      }).join('');
  }
  // a linha que abre: os números da pessoa + as cotações dela (abrem a ficha)
  function detalhePe(c, p, T, q) {
    var lim = PE.lim[p.k] || PE_PASSO, sem = p.k === SEM;
    var tx = function (k, v, s) { return '<div><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>'; };
    var nC = Object.keys(p.clis).length, nU = Object.keys(p.unids).length;
    var tiles = '<div class="gd-tx">' +
      tx('Oportunidades', F.int(p.n), T.n ? F.pct(p.n / T.n, 0) + ' das ' + F.int(T.n) + ' da equipe ' + esc(q) : 'nenhuma da equipe ' + esc(q)) +
      tx('Valor cotado', esc(F.mi(p.v)), T.v ? F.pct(p.v / T.v, 0) + ' de ' + esc(F.mi(T.v)) + ' da equipe' : '—') +
      tx('Taxa de ganho', p.tx == null ? '—' : F.pct(p.tx, 0), F.int(p.gan) + ' ganha' + (p.gan === 1 ? '' : 's') + ' · ' + F.int(p.per) + ' perdida' + (p.per === 1 ? '' : 's') + ' · ' + F.int(p.and) + ' em aberto') +
      tx('Contra as semanas anteriores', p.varN == null ? '—' : (p.varN >= 0 ? '+' : '') + F.pct(p.varN, 0),
        p.mn == null ? 'sem semanas anteriores com oportunidade' : 'média de ' + nf1(p.mn) + ' oportunidades e ' + esc(F.mi(p.mv)) + ' por semana') + '</div>';
    var info = '<div class="gd-det-h"><b>' + esc(p.nome) + '</b><span>' + (sem ? 'oportunidades sem responsável — assuma na Gestão de Oportunidades' : 'responsável pelas oportunidades') + '</span>' +
      (p.n ? '<span class="gd-gchip">' + F.int(nC) + ' cliente' + (nC === 1 ? '' : 's') + '</span><span class="gd-gchip">' + F.int(nU) + ' unidade' + (nU === 1 ? '' : 's') + '</span>' : '') + '</div>';
    var ord = p.ls.slice().sort(function (a, b) { return (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : 0) || b.v - a.v; });
    var linhas = ord.slice(0, lim).map(function (o) {
      var dd = o.dia ? F.data(o.dia) + ' <span class="fc-sem">' + S.dsem(o.dia) + '</span>' : '—';
      return '<tr data-num="' + esc(o.id) + '" tabindex="0" title="clique para abrir a ficha"><td>' + dd + '</td><td class="tx nm">' + esc(o.id) + '</td>' +
        '<td class="tx org" title="' + esc(o.cliente) + '">' + esc(o.cliente || '—') + '</td><td class="tx">' + esc(o.uf || '—') + '</td>' +
        '<td class="tx">' + esc(o.portal || '—') + '</td><td class="tx">' + badge(o) + '</td><td class="tx">' + esc(o.unidade || '—') + '</td><td>' + esc(F.brl(o.v)) + '</td></tr>';
    }).join('');
    var resto = ord.length - Math.min(lim, ord.length);
    return '<div class="gd-det">' + info + tiles +
      '<div class="gd-ntw"><table class="gd-nt"><thead><tr><th>Data</th><th class="tx">Oportunidade</th><th class="tx">Cliente</th><th class="tx">UF</th><th class="tx">Portal</th>' +
      '<th class="tx">Fase hoje</th><th class="tx">Unidade</th><th>Cotado</th></tr></thead><tbody>' + linhas + '</tbody></table></div>' +
      (resto > 0 ? '<button type="button" class="gd-mais" data-pe-mais="' + esc(p.k) + '">Mostrar mais ' + F.int(Math.min(PE_PASSO, resto)) + ' · ' + F.int(ord.length) + ' oportunidades no total</button>' : '') + '</div>';
  }
  function repintarDonas() { if (UC) pintarDonas(UC); }

  /* ══════════════════════════════════════════════════════════════
     RECORTES: por área (unidade de negócio), por portal e por cliente —
     a barra do Funil de Vendas (.fv-br), pintada por em aberto · ganhas ·
     perdidas; taxa = ganhas ÷ cotadas. O clique filtra a página.
     ══════════════════════════════════════════════════════════════ */
  function barras(hostId, grupos, cfg) {
    var host = $(hostId); if (!host || !UC) return;
    var met = UC.met, v = function (g) { return met === 'n' ? g.n : g.v; };
    var gs = grupos.slice().sort(function (a, b) { return v(b) - v(a) || b.n - a.n; }).slice(0, cfg.top || 8);
    if (!gs.length) { host.className = 'fv-bars'; host.innerHTML = '<div class="fv-empty">Nenhuma oportunidade ' + esc(UC.quando(true)) + '.</div>'; return; }
    var max = Math.max.apply(null, gs.map(v).concat([1]));
    host.className = 'fv-bars' + (gs.length <= 5 ? ' sparse' : '');
    host.innerHTML = gs.map(function (g) {
      var tot = v(g) || 0, w = tot / max * 100;
      var pz = ['and', 'gan', 'per'].map(function (s) {
        var x = met === 'n' ? g[s].n : g[s].v; if (!x) return '';
        return '<i style="width:' + (x / (tot || 1) * 100).toFixed(2) + '%;background:' + COR[s] + ';" title="' + esc(NOME[s] + ': ' + (met === 'n' ? F.int(x) : F.brl(x))) + '"></i>';
      }).join('');
      var d = function (s) { var x = met === 'n' ? g[s].n : g[s].v; return '<span class="fv-br-d ' + s + (x ? '' : ' z') + '" title="' + esc(NOME[s]) + '">' + fm(UC, x) + '</span>'; };
      return '<div class="fv-br' + (cfg.on && cfg.on(g) ? ' on' : '') + '" ' + cfg.attr + '="' + esc(g.k) + '" role="button" tabindex="0" title="' + esc(g.nome + ' — ' + cfg.dica) + '">' +
        '<span class="fv-br-nm">' + esc(g.nome) + '</span>' +
        '<span class="fv-br-tr"><span class="fv-br-cmp" style="width:' + Math.max(w, 0.6).toFixed(2) + '%;">' + pz + '</span></span>' +
        '<span class="fv-br-v">' + fm(UC, tot) + '</span>' +
        '<span class="fv-br-tx">' + d('and') + d('gan') + d('per') + '<span class="n">' + (met === 'n' ? F.mi(g.v) : F.int(g.n) + ' op.') + '</span>' +
          (g.n ? '<span class="tx">taxa <b>' + F.pct(g.gan.n / g.n, 0) + '</b></span>' : '') + '</span></div>';
    }).join('');
  }
  function pintarRecortes(c) {
    var f = c.f;
    barras('unid-host', S.agrupar(c.ls, function (o) { return o.unidade || SEM; }, function (o, k) { return k === SEM ? 'Sem unidade' : k; }),
      { attr: 'data-cs-unid', dica: 'clique para filtrar a página por esta unidade', on: function (g) { return f.unidade === g.k; } });
    barras('portal-host', S.agrupar(c.ls, function (o) { return o.portal || SEM; }, function (o, k) { return k === SEM ? 'Sem portal' : k; }),
      { attr: 'data-cs-portal', dica: 'clique para filtrar a página por este portal', on: function (g) { return f.portal === g.k; } });
    barras('cli-host', S.agrupar(c.ls, function (o) { return o.cliente || SEM; }, function (o, k) { return k === SEM ? 'Cliente não informado' : k; }),
      { attr: 'data-cs-cli', dica: 'clique para ver as oportunidades dele na lista', on: function (g) { return NG.busca && NG.busca === g.k; } });
  }

  /* ── até onde as cotações chegam ──────────────────────────────── */
  function pintarConversao(c) {
    var ls = c.ls, N = ls.length, q = c.quando(true);
    setT('conv-sub', 'das cotadas ' + q + ', quantas tiveram a proposta enviada ao comprador, viraram pedido e já estão no Dynamics (lançadas pelo PI ou com a Ordem de Venda)');
    var r = ls.filter(function (o) { return !!o.c.proposta; }), p = ls.filter(function (o) { return o.fase === 'pedido'; });
    var d = p.filter(function (o) { return o.c.pi === 'enviado' || (o.c.ovs || []).length; }), ov = p.filter(function (o) { return (o.c.ovs || []).length; });
    var soma = function (l, k) { return l.reduce(function (s, o) { return s + (o[k] || 0); }, 0); };
    var and = ls.filter(function (o) { return o.sit === 'and'; }).length;
    var cards = [
      ['Cotadas', N, N, F.mi(soma(ls, 'v')) + ' cotados · ' + F.int(and) + ' ainda em aberto', COR.ag],
      ['Proposta enviada', r.length, N, F.mi(soma(r, 'v')) + ' em propostas ao comprador', '#367284'],
      ['Viraram pedido', p.length, N, F.mi(soma(p, 'vPed')) + ' em pedidos' + (N ? ' · ' + F.pct(p.length / N, 0) + ' das cotadas' : ''), COR.gan],
      ['No Dynamics', d.length, N, F.mi(soma(d, 'vPed')) + ' · ' + F.int(ov.length) + ' com a Ordem de Venda' + (p.length ? ' · ' + F.pct(d.length / p.length, 0) + ' dos pedidos' : ''), '#138A4B']
    ];
    setH('conv-host', N ? cards.map(function (k) {
      var x = k[2] ? k[1] / k[2] : 0;
      return '<div class="cot-conv-p" style="--c:' + k[4] + '"><div class="k">' + esc(k[0]) + '</div><div class="v">' + F.int(k[1]) + ' <small>' + F.pct(x, 0) + '</small></div>' +
        '<div class="s">' + esc(k[3]) + '</div><div class="b"><i style="width:' + (x * 100).toFixed(1) + '%"></i></div></div>';
    }).join('') : '<div class="fv-empty" style="grid-column:1/-1">Nenhuma oportunidade ' + esc(q) + '.</div>');
  }

  /* ══════════════════════════════════════════════════════════════
     FASES E COTAÇÕES da semana avaliada — um cartão por fase e a lista;
     o clique no cartão recorta só a lista; a cotação abre a ficha.
     ══════════════════════════════════════════════════════════════ */
  var NG_PASSO = 60;
  // fases = null (todas) | [ids] · sit = a situação escolhida no funil · etapa = a do pedido
  var NG = { busca: '', ord: null, lim: NG_PASSO, fases: null, sit: null, etapa: null };
  var TOT_V = 0;
  var COLS = [
    { k: 'dia', l: 'Data', dica: 'a data da cotação (a do portal)' },
    { k: 'num', l: 'Oportunidade', dica: 'o número no portal · embaixo, o portal e o nº da cotação dele' },
    { k: 'cli', l: 'Cliente', dica: 'o comprador · embaixo, a cidade e a UF' },
    { k: 'cod', l: 'Cód. cliente', dica: 'o código do cliente no Dynamics (ERP)' },
    { k: 'fase', l: 'Fase hoje', dica: 'a fase de hoje · embaixo, o motivo (perdidas), o vencimento (em aberto) ou o pedido (ganhas)' },
    { k: 'dono', l: 'Responsável' },
    { k: 'unidade', l: 'Unidade', dica: 'a unidade de negócio (a área) de quem registrou' },
    { k: 'v', l: 'Cotado', num: true },
    { k: 'vPed', l: 'Pedido', num: true, dica: 'o valor do pedido (as que viraram pedido)' },
    { k: 'its', l: 'Itens', num: true, dica: 'itens cotados · ✓ ganhos e ✗ perdidos (marcados ou pela fase)' },
    { k: 'pct', l: '% do total', num: true, dica: 'o valor da oportunidade ÷ o valor das cotadas do recorte' }
  ];
  function noRecorte(o) {
    if (NG.fases && NG.fases.indexOf(o.fase) < 0) return false;
    if (NG.etapa && (o.fase !== 'pedido' || etapa(o) !== NG.etapa)) return false;
    return true;
  }
  function pintarFases(c) {
    var met = c.met, host = $('fases-host');
    var v = function (x) { return met === 'n' ? x.n : x.v; };
    var por = {};
    S.agrupar(c.ls, function (o) { return o.fase; }).forEach(function (g) { por[g.k] = g; });
    var tem = function (f) { return !!por[f.id] || (NG.fases && NG.fases.indexOf(f.id) >= 0); };
    var cards = C.FASES.filter(tem);
    var tot = v(nv(c.ls)), algum = !!NG.fases, num = { cotada: 1, faturar: 2 }, vaz = { n: 0, v: 0, ls: [] };
    var n = cards.length;
    host.style.setProperty('--cols', String(n <= 3 ? 3 : n));
    if (!n) { host.innerHTML = '<div class="fv-empty">Nenhuma oportunidade ' + esc(c.quando(true)) + ' com os filtros escolhidos.</div>'; return; }
    host.innerHTML = cards.map(function (f) {
      var g = por[f.id] || vaz, share = tot ? v(g) / tot : 0, on = algum && NG.fases.indexOf(f.id) >= 0;
      var selo = f.aberta ? String(num[f.id] || '•') : f.ganha ? '✓' : '✕';
      // 26/10/2026: A faturar — em aberto, aguardando o faturamento
      var cap = f.faturar ? 'em aberto · aguardando o faturamento' : f.aberta ? 'em aberto · aguardando o resultado' : f.ganha ? 'encerrada · ganha' : 'encerrada · sem ganho';
      var desde = g.ls.map(function (o) { return o.c[f.aberta ? 'faseEm' : 'fechadoEm'] || o.c.faseEm; }).filter(Boolean)
        .map(function (t) { return Math.max(0, Math.floor((Date.now() - C.ms(t)) / 86400e3)); });
      var dmd = desde.length ? Math.round(desde.reduce(function (a, x) { return a + x; }, 0) / desde.length) : null;
      var m = function (k, val, cls) { return '<div class="fv-pc-m' + (cls ? ' ' + cls : '') + '"><span>' + k + '</span><b>' + val + '</b></div>'; };
      var h = m(F.int(g.n) + ' ' + cotTxt(g.n), F.mi(g.v), 'um') + m('Ticket médio', g.n ? F.mi(g.v / g.n) : '—') +
        m(f.aberta ? 'Na fase (média)' : 'Encerrada há (média)', dmd == null ? '—' : F.int(dmd) + (dmd === 1 ? ' dia' : ' dias'));
      var pe = '';
      if (f.faturar) {
        pe += m('Com o pedido registrado', F.int(g.ls.filter(function (o) { return o.c.temPedido; }).length));
      } else if (f.aberta) {
        var vence = g.ls.map(function (o) { return o.c.validade; }).filter(Boolean).sort()[0];
        pe += m('Vence primeiro', vence ? C.diaBR(vence, true) : '—');
      } else if (f.ganha) {
        var e = { pi: 0, ov: 0, ok: 0 }; g.ls.forEach(function (o) { e[etapa(o)]++; });
        pe += m('Aguardando a OV', F.int(e.ov)) + m('Fechadas com OV', F.int(e.ok));
      } else {
        var mo = {}; g.ls.forEach(function (o) { var k = o.c.perda || ''; if (k) mo[k] = (mo[k] || 0) + 1; });
        var top = Object.keys(mo).sort(function (a, b) { return mo[b] - mo[a]; })[0];
        if (top) pe += '<div class="fv-pc-m" title="o motivo mais comum: ' + esc(top) + '"><span>' + esc(top) + '</span><b>' + F.int(mo[top]) + '</b></div>';
      }
      if (!g.n) pe = '<div class="fv-pc-m"><span>sem oportunidade com os outros filtros</span></div>';
      var dica = esc(f.nome) + (on ? ' — clique de novo para voltar a todas as fases' : ' — clique para ver as oportunidades desta fase na lista');
      return '<button type="button" class="fv-pc' + (on ? ' on' : '') + (algum && !on ? ' dim' : '') + (!g.n ? ' vazia' : '') + '" style="--c:' + f.cor + ';" data-cs-fase="' + f.id + '" aria-pressed="' + (on ? 'true' : 'false') + '" title="' + dica + '">' +
        '<div class="fv-pc-top"><span class="fv-pc-b" style="color:' + S.tinta(f.cor) + ';">' + selo + '</span>' +
          '<span class="fv-pc-n"><span class="t">' + esc(f.nome) + '</span><small>' + esc(cap) + '</small></span>' +
          '<span class="fv-pc-p">' + (tot ? F.pct(share, 0) : '—') + '</span></div>' +
        '<div class="fv-pc-bar"><i style="width:' + (g.n ? Math.max(2, share * 100) : 0).toFixed(1) + '%;"></i></div>' +
        h + (pe ? '<div class="fv-pc-pe">' + pe + '</div>' : '') + '</button>';
    }).join('');
  }
  function textoBusca(o) {
    var c = o.c;
    // o código do cliente e o CNPJ também acham (21/10/2026)
    return C.norm([o.id, c.cotacaoId, o.portal, o.cliente, c.cliente && c.cliente.codigo, c.cliente && c.cliente.cnpj, o.cidade, o.uf, o.dono, o.unidade, c.itensTxt, c.oc, (c.ovs || []).join(' '), c.perda, C.fase(o.fase).nome].filter(Boolean).join(' '));
  }
  // o código do cliente no Dynamics (C00…) — coluna própria na lista (22/10/2026)
  function codCli(o) { return String((o.c.cliente && o.c.cliente.codigo) || '').trim(); }
  // itens: [n, ganhos, perdidos] — a marca do item ou, sem ela, a fase da cotação
  function itensDe(o) {
    var its = o.c.itensRes || [], g = 0, p = 0;
    its.forEach(function (x) { var r = C.resultadoItem(x[4] === 'g' ? 'ganho' : x[4] === 'p' ? 'perdido' : '', o.fase).r; if (r === 'ganho') g++; else if (r === 'perdido') p++; });
    return [o.c.nItens || its.length, g, p];
  }
  function ordenar(lista) {
    var o = NG.ord;
    if (!o) return lista.slice().sort(function (a, b) { return (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : 0) || b.v - a.v; });
    var d = o.d;
    var valor = function (x) {
      switch (o.k) {
        case 'num': return x.id; case 'cli': return x.cliente; case 'cod': return codCli(x); case 'fase': return C.FASES.map(function (f) { return f.id; }).indexOf(x.fase);
        case 'its': return itensDe(x)[0]; case 'pct': return x.v; default: return x[o.k];
      }
    };
    return lista.slice().sort(function (a, b) {
      var x = valor(a), y = valor(b), vx = x == null || x === '', vy = y == null || y === '';
      if (vx || vy) return vx && vy ? b.v - a.v : (vx ? 1 : -1);
      if (typeof x === 'number' && typeof y === 'number') return d * (x - y) || b.v - a.v;
      return d * String(x).localeCompare(String(y), 'pt-BR', { numeric: true }) || b.v - a.v;
    });
  }
  function pintarLista(c) {
    setT('ls-tt', 'Fases e oportunidades ' + c.rotuloFoco());
    setT('ls-sub', 'um cartão por fase · o número grande é a fatia da fase no ' + (c.met === 'n' ? 'total de oportunidades' : 'valor cotado') + ' · clique na fase para ver as oportunidades dela na lista · clique na oportunidade para abrir a ficha');
    pintarFases(c);
    TOT_V = nv(c.ls).v;
    var q = C.norm(NG.busca).trim();
    var lista = c.ls.filter(noRecorte).filter(function (o) { return !q || textoBusca(o).indexOf(q) >= 0; });
    var fs = NG.fases || [];
    setT('ng-tt', 'Oportunidades · ' + (NG.etapa ? ETAPAS[NG.etapa][0].toLowerCase() : NG.sit ? NOME[NG.sit].toLowerCase() : fs.length === 1 ? C.fase(fs[0]).nome : fs.length ? fs.length + ' fases' : 'todas as fases') + (q ? ' · “' + NG.busca.trim() + '”' : ''));
    var be = $('ls-etapa');
    if (be) { be.hidden = !(NG.fases || NG.etapa || q); be.textContent = '✕ todas as oportunidades'; be.title = 'voltar a todas as fases, sem a busca'; }
    var sv = nv(lista).v;
    setT('ls-info', F.int(lista.length) + ' ' + cotTxt(lista.length) + ' · ' + F.mi(sv) + (TOT_V ? ' · ' + F.pct(sv / TOT_V, 0) + ' do total' : ''));
    $('ls-head').innerHTML = '<tr>' + COLS.map(function (col) {
      var seta = NG.ord && NG.ord.k === col.k ? '<span class="seta">' + (NG.ord.d === 1 ? '▲' : '▼') + '</span>' : (!NG.ord && col.k === 'dia' ? '<span class="seta">▼</span>' : '');
      var ar = NG.ord && NG.ord.k === col.k ? (NG.ord.d === 1 ? 'ascending' : 'descending') : 'none';
      return '<th class="ord' + (col.num ? '' : ' tx') + '" data-k="' + col.k + '" aria-sort="' + ar + '" title="' + esc(col.dica || ('ordenar por ' + col.l.toLowerCase())) + '">' + esc(col.l) + seta + '</th>';
    }).join('') + '</tr>';
    var body = $('ls-body'), mais = $('ls-mais'), foot = $('ls-foot');
    if (!lista.length) {
      body.innerHTML = '<tr><td class="tx dim ng-vz" colspan="' + COLS.length + '">' + (q ? 'Nenhuma oportunidade com “' + esc(NG.busca.trim()) + '” neste recorte.' : 'Nenhuma oportunidade neste recorte.') + '</td></tr>';
      foot.innerHTML = ''; mais.hidden = true; return;
    }
    var ords = ordenar(lista), vis = ords.slice(0, NG.lim);
    body.innerHTML = vis.map(function (o) { return '<tr data-num="' + esc(o.id) + '" tabindex="0">' + COLS.map(function (col) { return celula(o, col, c); }).join('') + '</tr>'; }).join('');
    var vp = lista.reduce(function (s, o) { return s + o.vPed; }, 0);
    foot.innerHTML = '<tr><td class="tx" colspan="7">Total · ' + F.int(lista.length) + ' ' + cotTxt(lista.length) + '</td><td>' + brl0(sv) + '</td><td>' + (vp ? brl0(vp) : '—') + '</td><td></td><td>' + (TOT_V ? F.pct(sv / TOT_V, 1) : '—') + '</td></tr>';
    var resto = ords.length - vis.length;
    mais.hidden = resto <= 0;
    if (resto > 0) mais.textContent = 'Mostrar mais ' + F.int(Math.min(NG_PASSO, resto)) + ' · faltam ' + F.int(resto) + ' de ' + F.int(ords.length);
  }
  // a célula de uma coluna (a lista do fim e a do período aberto na tabela)
  function celula(o, col, c) {
    var oc = o.c;
    switch (col.k) {
      case 'dia': {
        if (!o.dia) return '<td class="tx dt z"><b>sem data</b></td>';
        var n = difDias(c.hoje, o.dia), rel = n === 0 ? 'hoje' : n === -1 ? 'ontem' : n < 0 ? 'há ' + F.int(-n) + ' dias' : 'em ' + F.int(n) + ' dias';
        return '<td class="tx dt' + (n === 0 ? ' hoje' : '') + '"><b>' + F.data(o.dia) + '</b><span>' + S.dsem(o.dia) + ' · ' + rel + '</span></td>';
      }
      case 'reg': {
        var t = C.ms(oc.criadoEm); if (!t) return '<td class="tx dt z"><b>—</b></td>';
        var d = new Date(t - 3 * 3600e3).toISOString().slice(0, 10);
        return '<td class="tx dt' + (d === c.hoje ? ' hoje' : '') + '"><b>' + F.data(d) + '</b><span>' + S.dsem(d) + ' · S' + isoSemana(S.segunda(d)) + '</span></td>';
      }
      case 'num': {
        var sub = C.tituloCaso(oc);
        return '<td class="tx nm" title="' + esc(o.id + ' · ' + sub) + ' — clique para abrir a ficha"><span class="t">' + esc(o.id) + '</span><span class="s">' + esc(sub) + '</span></td>';
      }
      case 'cli': {
        var lugar = [o.cidade, o.uf].filter(Boolean).join('/');
        return '<td class="tx nm org" title="' + esc(o.cliente) + '"><span class="t">' + esc(o.cliente || 'Cliente não informado') + '</span>' + (lugar ? '<span class="s">' + esc(lugar) + '</span>' : '') + '</td>';
      }
      case 'cod': { var cod = codCli(o); return cod ? '<td class="tx cod" title="código do cliente no Dynamics">' + esc(cod) + '</td>' : '<td class="tx dim">—</td>'; }
      case 'uf': return o.uf ? '<td class="tx">' + esc(o.uf) + '</td>' : '<td class="tx dim">—</td>';
      case 'fase': {
        var s = '';
        if (o.sit === 'per') s = oc.perda || '';
        else if (o.sit === 'gan') s = ETAPAS[etapa(o)][0] + ((oc.ovs || []).length ? ' · ' + oc.ovs[0] : '');
        else { var p = C.prazoDe(oc, (UC && UC.cfg && UC.cfg.avisoDias != null) ? UC.cfg.avisoDias : 2); s = p && !p.semData ? p.txt : ''; }
        return '<td class="tx fz">' + badge(o) + (s ? '<span class="s" title="' + esc(s) + '">' + esc(s) + '</span>' : '') + '</td>';
      }
      case 'dono': return o.dono ? '<td class="tx vd" title="' + esc(o.dono) + '">' + esc(o.dono) + '</td>' : '<td class="tx vd warn">sem responsável</td>';
      case 'unidade': return o.unidade ? '<td class="tx vd" title="' + esc(o.unidade) + '">' + esc(o.unidade) + '</td>' : '<td class="tx vd dim">—</td>';
      case 'v': return '<td class="forte">' + brl0(o.v) + '</td>';
      case 'vPed': return o.fase === 'pedido' ? '<td class="pos">' + brl0(o.vPed) + '</td>' : '<td class="dim">—</td>';
      case 'its': {
        var it = itensDe(o);
        return '<td title="' + F.int(it[0]) + ' itens · ' + F.int(it[1]) + ' ganho(s) · ' + F.int(it[2]) + ' perdido(s)">' + F.int(it[0]) +
          (it[1] || it[2] ? '<span class="fc-sub"><b class="g">✓' + F.int(it[1]) + '</b> <b class="p">✗' + F.int(it[2]) + '</b></span>' : '') + '</td>';
      }
      case 'pct': return '<td class="dim">' + (TOT_V ? F.pct(o.v / TOT_V, 1) : '—') + '</td>';
    }
    return '<td></td>';
  }
  // escolhe as fases da lista e rola até ela
  function irLista(sit, fase, rolar, et) {
    var etAntes = NG.etapa;
    NG.etapa = null;
    if (et) { NG.etapa = etAntes === et ? null : et; NG.fases = null; NG.sit = null; }
    else if (fase != null) { NG.fases = NG.fases && NG.fases.length === 1 && NG.fases[0] === fase && !rolar ? null : [fase]; NG.sit = null; }
    else if (!sit || sit === 'ag') { NG.fases = null; NG.sit = null; }
    else {
      var vis = {}; (UC ? UC.ls : []).forEach(function (o) { if (o.sit === sit) vis[o.fase] = 1; });
      NG.fases = Object.keys(vis); NG.sit = sit;
    }
    NG.ord = null; NG.lim = NG_PASSO;
    if (UC) { pintarFunil(UC); pintarLista(UC); }
    if (rolar) { var el = $('ls-card'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  /* ══════════════════════════════════════════════════════════════
     EVENTOS (os comuns — filtros, setas da semana, Valor × Quantidade,
     a ficha — ficam no motor)
     ══════════════════════════════════════════════════════════════ */
  var app = $('cot-app');
  app.addEventListener('click', function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var x;
    if ((x = t.closest('tr[data-cs-wk]'))) { abrirSemana(x.getAttribute('data-cs-wk'), e.ctrlKey || e.metaKey); return; }
    if ((x = t.closest('tr[data-cs-mes]'))) { abrirMes(x.getAttribute('data-cs-mes')); return; }
    if ((x = t.closest('[data-cs-sem]'))) { S.focarSemana(x.getAttribute('data-cs-sem'), e.ctrlKey || e.metaKey); return; }
    if ((x = t.closest('[data-cs-wkmais]'))) { var ch = x.getAttribute('data-cs-wkmais'); WKA.lim[ch] = (WKA.lim[ch] || WKA_PASSO) + WKA_PASSO; repintarTabela(); return; }
    if ((x = t.closest('#wk-vis [data-cvis]'))) {
      VIS = x.getAttribute('data-cvis') === 'mes' ? 'mes' : 'sem'; WKA.aberta = null;
      try { localStorage.setItem(LS_VIS, VIS); } catch (er) {}
      if (UC) { pintarGrafico(UC); repintarTabela(); }
      return;
    }
    if ((x = t.closest('[data-cs-tela]'))) { moverTela(Number(x.getAttribute('data-cs-tela'))); return; }
    if ((x = t.closest('[data-cs-jan]'))) { if (!x.disabled && UC) { var dj = Number(x.getAttribute('data-cs-jan')); WKV.salto = dj; S.moverJanela(dj * (WKV.k || UC.WK.length)); } return; }
    if ((x = t.closest('#pe-head th[data-pe-ord]'))) {
      var k = x.getAttribute('data-pe-ord');
      PE.ord = PE.ord.k === k ? { k: k, d: -PE.ord.d } : { k: k, d: k === 'nome' ? 1 : -1 };
      repintarDonas(); return;
    }
    if ((x = t.closest('[data-pe-mais]'))) { var pk = x.getAttribute('data-pe-mais'); PE.lim[pk] = (PE.lim[pk] || PE_PASSO) + PE_PASSO; repintarDonas(); return; }
    if ((x = t.closest('#pe-body tr.lin'))) { var pp = x.getAttribute('data-pe-p'); PE.aberta = PE.aberta === pp ? null : pp; repintarDonas(); return; }
    if ((x = t.closest('[data-cs-pf]'))) { irLista(null, x.getAttribute('data-cs-pf'), true); return; }
    if ((x = t.closest('[data-cs-pe]'))) { irLista(null, null, true, x.getAttribute('data-cs-pe')); return; }
    if ((x = t.closest('[data-cs-fase]'))) { irLista(null, x.getAttribute('data-cs-fase'), false); return; }
    if ((x = t.closest('[data-cs-lista]'))) { irLista(x.getAttribute('data-cs-lista'), null, true); return; }
    if ((x = t.closest('[data-cs-unid]'))) { S.setFiltro('unidade', x.getAttribute('data-cs-unid')); return; }
    if ((x = t.closest('[data-cs-portal]'))) { S.setFiltro('portal', x.getAttribute('data-cs-portal')); return; }
    if ((x = t.closest('[data-cs-cli]'))) {
      var cl = x.getAttribute('data-cs-cli'), b = $('ls-busca');
      NG.busca = NG.busca === cl || cl === SEM ? '' : cl; if (b) b.value = NG.busca; NG.lim = NG_PASSO;
      if (UC) { pintarRecortes(UC); pintarLista(UC); }
      if (NG.busca) { var l = $('ls-card'); if (l && l.scrollIntoView) l.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      return;
    }
    if ((x = t.closest('#ls-etapa'))) { NG.busca = ''; var bb = $('ls-busca'); if (bb) bb.value = ''; irLista('ag', null, false); return; }
    if ((x = t.closest('#ls-head th[data-k]'))) {
      var kk = x.getAttribute('data-k'), col = COLS.filter(function (y) { return y.k === kk; })[0];
      if (kk === 'dia') NG.ord = !NG.ord || NG.ord.k !== 'dia' ? { k: 'dia', d: 1 } : NG.ord.d === 1 ? { k: 'dia', d: -1 } : null;
      else if (NG.ord && NG.ord.k === kk) NG.ord = { k: kk, d: -NG.ord.d };
      else NG.ord = { k: kk, d: col && col.num ? -1 : 1 };
      NG.lim = NG_PASSO; if (UC) pintarLista(UC); return;
    }
    if ((x = t.closest('#ls-mais'))) { NG.lim += NG_PASSO; if (UC) pintarLista(UC); return; }
  });
  app.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var t = e.target; if (!t || !t.closest) return;
    var x = t.closest('tr[data-cs-wk], tr[data-cs-mes], #pe-body tr.lin, [data-cs-lista], .fv-br');
    if (x && x === t) { e.preventDefault(); x.click(); }
  });
  var _tb = null;
  var busca = $('ls-busca');
  if (busca) busca.addEventListener('input', function (e) {
    var v = e.target.value; clearTimeout(_tb);
    _tb = setTimeout(function () { NG.busca = v; NG.lim = NG_PASSO; if (UC) { pintarRecortes(UC); pintarLista(UC); } }, 160);
  });

  S.pagina({
    render: render, vazio: vazio,
    limpar: function () { NG.fases = null; NG.sit = null; NG.etapa = null; NG.busca = ''; NG.ord = null; WKA.aberta = null; var b = $('ls-busca'); if (b) b.value = ''; }
  });
})();
