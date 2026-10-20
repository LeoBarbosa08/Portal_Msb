/* ================================================================
   cotacoes-ficha.js — A FICHA DA COTAÇÃO (painel à direita)

   O resumo de tudo o que aconteceu com uma cotação, sem sair da tela:
   em que fase ela está e desde quando, o caminho das fases, o que já foi
   feito (registrada → proposta ao comprador → pedido do portal → PI →
   Dynamics), se há pedido ou não (e quanto do cotado ele levou), por que
   não virou, os itens, a tramitação, o comprador, os anexos e o histórico.

   Só leitura: para mudar alguma coisa, "Abrir o caso completo" leva à
   Gestão de Cotações (comercial-cot-casos.html?caso=…).

   O desenho é o da ficha da negociação da Licitação (.fv-dw-*, do
   licitacao-funil-vendas.css) — o mesmo da ficha da oportunidade; o que
   é só da cotação tem prefixo .cot-dw- (cotacoes.css).

   Uso (cotacoes-funil.js):
     COT.ficha.abrir(numero, { resumo, lista, origem })
       resumo  função numero -> a linha do índice (/api/cot-casos): o topo
               aparece na hora, antes do caso inteiro chegar
       lista   função -> os números na ordem da tela (‹ › andam por ela)
       origem  o elemento que volta a ter o foco ao fechar
     COT.ficha.atualizar()   o índice foi relido: se a cotação aberta mudou,
                             a ficha lê o caso de novo
   ================================================================ */
(function () {
  'use strict';
  var C = window.COT; if (!C || C.ficha) return;
  var D = document, $ = C.$, esc = C.esc, IC = C.IC;

  var F = { el: null, ov: null, num: '', o: null, volta: null, casos: {}, histTudo: false, itensTudo: false, notasTudo: false };
  var COR_HIST = { criado: '#1A66D2', fase: '#5A3BC4', nota: '#D97706', pi: '#5A3BC4', pedido: '#138A4B', anexo: '#0891B2', ia: '#C026D3', campo: '#8DBBF5', proposta: '#0E7490', erp: '#0F766E' };
  var IC_X = C.svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', 18);
  var IC_EXT = C.svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>', 13);

  /* ── utilidades ─────────────────────────────────────────────── */
  function dias(iso, ate) { var t = C.ms(iso); if (!t) return null; var fim = (ate && C.ms(ate)) || Date.now(); return Math.max(0, Math.floor((fim - t) / 86400e3)); }
  function txtDias(n) { return n == null ? '—' : n === 0 ? 'hoje' : n === 1 ? '1 dia' : C.int(n) + ' dias'; }
  function quem(p) { return (p && p.nome) || ''; }
  function dl(pares) {
    return '<dl class="fv-dw-dl">' + pares.filter(Boolean).map(function (p) { return '<div class="' + (p[2] || '') + '"><dt>' + esc(p[0]) + '</dt><dd>' + p[1] + '</dd></div>'; }).join('') + '</dl>';
  }
  function vazio(t) { return '<span class="z">' + esc(t || '—') + '</span>'; }
  function card(titulo, n, corpo, cls) {
    return '<section class="fv-dw-card' + (cls ? ' ' + cls : '') + '"><h4>' + titulo + (n != null ? ' <small>' + esc(n) + '</small>' : '') + '</h4>' + corpo + '</section>';
  }
  function maisBtn(acao, ligado, n, limite, rotulo) {
    if (n <= limite) return '';
    return '<button type="button" class="fv-dw-vaz" data-cot-dw="' + acao + '">' + (ligado ? 'Mostrar só ' + (limite === 1 ? 'o último' : 'os ' + limite + ' primeiros') : 'Mostrar ' + (rotulo || 'tudo') + ' (' + C.int(n) + ')') + '</button>';
  }

  // os números do topo: do caso inteiro quando ele chega, da linha da lista até lá
  function topo(r, c) {
    if (!c) return r || {};
    var ped = c.pedido, pv = ped && ped.previa;
    return {
      numero: c.numero, fase: C.faseAtual(c.fase), portal: c.portal || '', cotacaoId: c.cotacaoId || '', cliente: c.cliente || {}, dono: c.dono || null,
      total: c.total || 0, nItens: (c.itens || []).length, totalPedido: ped ? ((pv && pv.total) || ped.total || 0) : 0, oc: ped ? (ped.oc || (pv && pv.oc) || '') : '',
      validade: (c.datas && c.datas.validade) || '', criadoEm: c.criadoEm, faseEm: c.faseEm || c.criadoEm, fechadoEm: c.fechadoEm || null,
      pi: c.pi ? c.pi.estado || '' : '', perda: c.perda ? c.perda.motivo || '' : '', proposta: c.proposta, descartado: !!c.descartado, descartadoEm: c.descartado ? c.descartado.em : '', atualizadoEm: c.atualizadoEm
    };
  }
  // o caminho das fases, de qualquer das duas fontes: [{ fase, em, por }]
  function fasesDe(r, c) {
    if (c && (c.fases || []).length) return c.fases.map(function (f) { return { fase: C.faseAtual(f.fase), em: f.em, dia: C.dataBR(f.em), por: f.por }; });
    return ((r && r.fases) || []).map(function (f) { return { fase: f[0], em: f[1], dia: C.diaBR(f[1]), por: null }; });
  }

  /* ── o painel ───────────────────────────────────────────────── */
  function montar() {
    if (F.el) return;
    F.ov = D.createElement('div'); F.ov.className = 'fv-dw-ov';
    F.el = D.createElement('aside'); F.el.className = 'fv-dw cot-dw';
    F.el.setAttribute('role', 'dialog'); F.el.setAttribute('aria-modal', 'true'); F.el.setAttribute('aria-labelledby', 'cot-dw-tt');
    F.el.innerHTML =
        '<div class="fv-dw-head">'
      +   '<div class="fv-dw-hl"><div class="fv-dw-k" id="cot-dw-k"></div><h2 class="fv-dw-tt" id="cot-dw-tt"></h2>'
      +   '<div class="fv-dw-sub" id="cot-dw-sub"></div><div class="fv-dw-tags" id="cot-dw-tags"></div></div>'
      +   '<div class="cot-dw-nav">'
      +     '<button type="button" class="cot-dw-pn" data-cot-dw="ant" aria-label="Cotação anterior da lista" title="Anterior da lista (←)">' + IC.chevL + '</button>'
      +     '<button type="button" class="cot-dw-pn" data-cot-dw="prox" aria-label="Próxima cotação da lista" title="Próxima da lista (→)">' + IC.chevR + '</button>'
      +     '<button type="button" class="fv-dw-x" data-cot-dw="fechar" aria-label="Fechar a ficha" title="Fechar (Esc)">' + IC_X + '</button>'
      +   '</div>'
      + '</div>'
      + '<div class="fv-dw-body" id="cot-dw-body"></div>'
      + '<div class="fv-dw-foot"><a class="fv-dw-sf" id="cot-dw-caso" href="#">Abrir o caso completo ' + IC_EXT + '</a>'
      +   '<span class="fv-dw-lido" id="cot-dw-lido"></span><button type="button" class="fv-dw-btn" data-cot-dw="fechar">Fechar</button></div>';
    D.body.appendChild(F.ov); D.body.appendChild(F.el);
    F.ov.addEventListener('click', fechar);
    F.el.addEventListener('click', function (e) {
      var anx = e.target.closest ? e.target.closest('[data-cot-anexo]') : null;
      if (anx) { var a = acharAnexo(anx.getAttribute('data-cot-anexo')); if (a) C.abrirAnexo(F.num, a); return; }
      var b = e.target.closest ? e.target.closest('[data-cot-dw]') : null; if (!b) return;
      var x = b.getAttribute('data-cot-dw');
      if (x === 'fechar') fechar();
      else if (x === 'ant') andar(-1);
      else if (x === 'prox') andar(1);
      else if (x === 'tentar') carregar(F.num, true);
      else if (x === 'hist') { F.histTudo = !F.histTudo; pintar(); }
      else if (x === 'itens') { F.itensTudo = !F.itensTudo; pintar(); }
      else if (x === 'notas') { F.notasTudo = !F.notasTudo; pintar(); }
    });
    D.addEventListener('keydown', function (e) {
      if (!F.el.classList.contains('open')) return;
      if (D.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') { e.preventDefault(); fechar(); return; }
      if (e.key === 'Tab') { prender(e); return; }
      var t = e.target, digitando = t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
      if (!digitando && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); andar(e.key === 'ArrowLeft' ? -1 : 1); }
    });
  }
  // o foco não sai da ficha enquanto ela está aberta
  function prender(e) {
    var fs = Array.prototype.filter.call(F.el.querySelectorAll('button, a[href], summary, [tabindex]:not([tabindex="-1"])'), function (x) { return !x.disabled && x.offsetParent !== null; });
    if (!fs.length) return;
    var a = fs[0], z = fs[fs.length - 1];
    if (e.shiftKey && (D.activeElement === a || !F.el.contains(D.activeElement))) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && (D.activeElement === z || !F.el.contains(D.activeElement))) { e.preventDefault(); a.focus(); }
  }
  function linhaDe(num) { return num ? D.querySelector('tr[data-num="' + String(num).replace(/["\\]/g, '\\$&') + '"]') : null; }
  function marcarLinha() {
    Array.prototype.forEach.call(D.querySelectorAll('tr.is-aberta[data-num]'), function (tr) { tr.classList.remove('is-aberta'); });
    var tr = F.el && F.el.classList.contains('open') ? linhaDe(F.num) : null;
    if (tr) tr.classList.add('is-aberta');
  }

  function abrir(numero, o) {
    if (!numero) return;
    montar();
    var jaAberta = F.el.classList.contains('open');
    F.o = o || F.o || {};
    if (!jaAberta) F.volta = (o && o.origem) || D.activeElement;
    irPara(numero);
    F.ov.classList.add('open'); F.el.classList.add('open');
    D.documentElement.classList.add('fv-dw-on');
    marcarLinha();
    if (!jaAberta) setTimeout(function () { try { F.el.querySelector('.fv-dw-x').focus(); } catch (e) {} }, 40);
  }
  function irPara(numero) {
    F.num = numero; F.histTudo = false; F.itensTudo = false; F.notasTudo = false;
    pintar();
    $('cot-dw-body').scrollTop = 0;
    var r = resumo(), st = F.casos[numero];
    // o caso guardado ainda vale se o índice não mudou desde a leitura
    var velho = st && st.caso && r && r.atualizadoEm && st.caso.atualizadoEm !== r.atualizadoEm;
    carregar(numero, !!velho);
  }
  function fechar() {
    if (!F.el || !F.el.classList.contains('open')) return;
    F.el.classList.remove('open'); F.ov.classList.remove('open');
    D.documentElement.classList.remove('fv-dw-on');
    var num = F.num; F.num = '';
    marcarLinha();
    // o foco volta para a linha da cotação que estava na ficha (andou com ‹ ›?)
    var alvo = linhaDe(num) || F.volta;
    if (alvo && alvo.focus) { try { alvo.focus(); } catch (e) {} }
  }
  function ordem() { return (F.o && F.o.lista ? F.o.lista() : []) || []; }
  function andar(d) {
    var l = ordem(), i = l.indexOf(F.num);
    if (i < 0 || !l[i + d]) return;
    irPara(l[i + d]);
    marcarLinha();
    var tr = linhaDe(F.num); if (tr && tr.scrollIntoView) tr.scrollIntoView({ block: 'nearest' });
  }
  function resumo() { return F.o && F.o.resumo ? F.o.resumo(F.num) : null; }
  function acharAnexo(id) { var st = F.casos[F.num], c = st && st.caso; return c ? (c.anexos || []).filter(function (a) { return a.id === id; })[0] : null; }

  function carregar(numero, fresco) {
    var st = F.casos[numero];
    if (st && st.carregando) return;
    if (st && st.caso && !fresco) return;
    F.casos[numero] = { carregando: true, caso: st && st.caso };
    if (F.num === numero) pintar();
    C.api('cot-casos?numero=' + encodeURIComponent(numero)).then(function (j) {
      F.casos[numero] = { caso: j.caso, lidoEm: Date.now() };
    }).catch(function (e) {
      F.casos[numero] = { erro: e.message || String(e), status: e.status, caso: st && st.caso };
    }).then(function () { if (F.num === numero) pintar(); });
  }
  function atualizar() {
    if (!F.el || !F.el.classList.contains('open') || !F.num) return;
    var r = resumo(), st = F.casos[F.num];
    if (r && st && st.caso && r.atualizadoEm && st.caso.atualizadoEm !== r.atualizadoEm) carregar(F.num, true);
    else pintar();
    marcarLinha();
  }

  /* ── o desenho ──────────────────────────────────────────────── */
  function pintar() {
    if (!F.el || !F.num) return;
    var r = resumo(), st = F.casos[F.num] || {}, c = st.caso || null, t = topo(r, c);
    var cli = t.cliente || {}, f = C.fase(t.fase);
    var local = [cli.cidade, cli.uf].filter(Boolean).join('/');
    $('cot-dw-k').textContent = 'Cotação · ' + F.num;
    $('cot-dw-tt').textContent = cli.nome || 'Cliente não informado';
    $('cot-dw-sub').innerHTML = esc([C.tituloCaso(t), local].filter(Boolean).join(' · ')) + (cli.cnpj ? ' · <span class="cs-mono">' + esc(C.cnpjMask(cli.cnpj)) + '</span>' : '');
    $('cot-dw-tags').innerHTML = (t.descartado ? '<span class="cs-chip descartada">Descartada</span>' : C.chipFase(t.fase) + C.chipPi(t) + C.chipPrazo(t, aviso())) +
      (t.dono ? '<span class="fv-dw-tag">' + esc(t.dono.nome) + '</span>' : '<span class="fv-dw-tag cot-dw-semdono">sem responsável</span>');
    var lk = $('cot-dw-caso'); lk.href = 'comercial-cot-casos.html?caso=' + encodeURIComponent(F.num);
    $('cot-dw-lido').textContent = st.carregando ? 'lendo o caso…' : st.lidoEm ? 'lido às ' + new Date(st.lidoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    var l = ordem(), i = l.indexOf(F.num);
    F.el.querySelector('[data-cot-dw="ant"]').disabled = i <= 0;
    F.el.querySelector('[data-cot-dw="prox"]').disabled = i < 0 || i >= l.length - 1;

    var h = htmlKpis(t, c) + htmlSituacao(t, c, f) + htmlCaminho(t, fasesDe(r, c));
    if (c) {
      h += htmlFeito(c) + htmlPedido(c) + htmlPerda(c) + htmlItens(c) + htmlNotas(c) + htmlDados(c) + htmlAnexos(c) + htmlHistorico(c);
    } else if (st.erro) {
      h += '<div class="fv-dw-err"><span>Não deu para ler o caso: <b>' + esc(st.erro) + '</b></span>' + (st.status === 404 || st.status === 403 ? '' : '<button type="button" class="fv-act" data-cot-dw="tentar">Tentar de novo</button>') + '</div>';
    } else {
      h += '<div class="fv-dw-load"><span class="fv-spin"></span>Lendo o caso — proposta, pedido, itens e histórico…</div>';
    }
    if (c && st.erro) h += '<div class="fv-dw-av">Não consegui atualizar agora (' + esc(st.erro) + ') — mostrando a última leitura.</div>';
    $('cot-dw-body').innerHTML = h;
    C.quieto($('cot-dw-body'));
  }
  function aviso() { return F.o && F.o.avisoDias != null ? F.o.avisoDias() : 2; }

  // os quatro números do topo
  function htmlKpis(t, c) {
    var aberta = C.aberta(t.fase) && !t.descartado, pr = C.prazoDe(t, aviso());
    var co = (c && c.condicoes) || {};
    var kp = function (k, v, s, cls) { return '<div class="fv-dw-kp"><div class="k">' + esc(k) + '</div><div class="v' + (cls ? ' ' + cls : '') + '">' + v + '</div><div class="s' + (cls === 'warn' ? ' warn' : '') + '">' + s + '</div></div>'; };
    var h = kp('Cotado', esc(C.brl(t.total)), esc(C.int(t.nItens || 0) + ' item(ns)' + (co.pagamento ? ' · ' + co.pagamento : '')));
    if (t.fase === 'pedido' || t.totalPedido) {
      var pc = t.total && t.totalPedido ? C.pct(t.totalPedido / t.total, 0) + ' do cotado' : '';
      h += kp('Pedido', esc(t.totalPedido ? C.brl(t.totalPedido) : 'Sem valor'), esc([t.oc ? 'OC ' + t.oc : '', pc].filter(Boolean).join(' · ') || 'o PI ainda não leu o pedido'), 'pos');
    } else {
      h += kp('Pedido', 'Sem pedido', esc(aberta ? 'ainda não virou pedido' : t.descartado ? 'cotação descartada' : 'não virou pedido'), 'mut');
    }
    if (t.descartado) {
      return '<div class="fv-dw-kpis">' + h + kp('Descartada', esc(t.descartadoEm ? C.dataBR(t.descartadoEm) : '—'), esc(t.descartadoEm ? C.quando(t.descartadoEm) : 'fora das filas e do funil')) +
        kp('Fase ao descartar', esc(C.fase(t.fase).nome), esc('desde ' + C.dataBR(t.faseEm))) + '</div>';
    }
    if (aberta && pr && !pr.semData) h += kp('Vencimento', esc(C.diaBR(t.validade)), esc(pr.quando ? (pr.nivel === 2 ? 'venceu ' : 'vence ') + C.quando(pr.quando.toISOString()) : pr.txt), pr.nivel >= 1 ? 'warn' : '');
    else if (aberta) h += kp('Vencimento', 'Sem data', 'informe no caso completo', 'mut');
    else h += kp(t.fase === 'pedido' ? 'Virou pedido' : 'Encerrada', esc(t.fechadoEm ? C.dataBR(t.fechadoEm) : '—'), esc(t.fechadoEm ? C.quando(t.fechadoEm) : ''));
    if (aberta) {
      var nf = dias(t.faseEm);
      h += kp('Na fase atual', esc(txtDias(nf)), esc(C.fase(t.fase).nome + ' desde ' + C.dataBR(t.faseEm)), nf > 14 ? 'warn' : '');
    } else {
      var ciclo = t.fechadoEm ? dias(t.criadoEm, t.fechadoEm) : null;
      h += kp('Ciclo', esc(txtDias(ciclo)), esc('da entrada (' + C.dataBR(t.criadoEm) + ') ao ' + (t.fase === 'pedido' ? 'pedido' : 'encerramento')));
    }
    return '<div class="fv-dw-kpis">' + h + '</div>';
  }

  // a frase do momento: onde a cotação está e o que falta
  function htmlSituacao(t, c, f) {
    var tom = t.descartado ? 'neutro' : f.ganha ? 'gan' : f.perdida ? (t.fase === 'vencida' ? 'venc' : t.fase === 'cancelada' ? 'neutro' : 'per') : 'and';
    var tit = '', tx = '';
    var pr = C.prazoDe(t, aviso());
    if (t.descartado) {
      var d = (c && c.descartado) || {};
      tit = 'Cotação descartada';
      tx = (d.motivo || 'registrada por engano') + (d.por ? ' · ' + quem(d.por) : '') + (d.em ? ' · ' + C.dataBR(d.em, true) : '') + '. Fica fora das filas e do funil.';
    } else if (t.fase === 'pedido') {
      var pi = c && c.pi || { estado: t.pi };
      tit = 'Virou pedido' + (t.totalPedido ? ' · ' + C.brl(t.totalPedido) : '') + (t.oc ? ' · OC ' + t.oc : '');
      var ovs = (c && c.ovs) || [];
      tx = ovs.length ? 'Fechada com a' + (ovs.length > 1 ? 's Ordens de Venda ' : ' Ordem de Venda ') + ovs.map(function (o) { return o.numero; }).join(', ') + (ovs[0].em ? ' em ' + C.dataBR(ovs[0].em, true) + (ovs[0].por ? ' por ' + quem(ovs[0].por) : '') : '') + '. A venda aconteceu.'
        : pi.estado === 'enviado' ? 'O pedido já foi lançado no Dynamics pelo PI' + (pi.enviado && pi.enviado.em ? ' em ' + C.dataBR(pi.enviado.em, true) + (pi.enviado.por ? ' por ' + quem(pi.enviado.por) : '') : '') + ' — falta fechar a cotação com a Ordem de Venda.'
        : pi.estado === 'em_andamento' ? 'O pedido está aberto no PI · Pedido' + (pi.abertoPor ? ' (' + quem(pi.abertoPor) + ', ' + C.quando(pi.abertoEm) + ')' : '') + ' — falta lançar no Dynamics.'
        : pi.estado === 'erro' ? 'O PDF do pedido está no caso, mas a leitura falhou' + (pi.erro ? ' (' + pi.erro + ')' : '') + ' — falta lançar no Dynamics pelo PI.'
        : 'O PDF do pedido está no caso — falta lançar no Dynamics pelo PI · Pedido.';
    } else if (f.perdida) {
      var p = (c && c.perda) || { motivo: t.perda };
      tit = f.nome + (p.motivo ? ' · ' + p.motivo : '');
      tx = t.fase === 'vencida'
        ? 'A data de vencimento' + (t.validade ? ' (' + C.diaBR(t.validade) + ')' : '') + ' passou com a cotação aberta e ela saiu sozinha do funil.'
        : 'Não virou pedido' + (p.concorrente ? ' — quem levou: ' + p.concorrente + (p.valorConcorrente ? ' (' + C.brl(p.valorConcorrente) + ')' : '') : '') + (p.por && p.por.nome ? '. Marcada por ' + quem(p.por) : '') + (p.em ? ' em ' + C.dataBR(p.em, true) : '') + '.';
    } else {
      var prop = c ? (c.propostas || []).length : (t.proposta ? 1 : 0);
      tit = f.nome + ' · aguardando o resultado';
      var pEm = (c && c.proposta && c.proposta.em) || (t.proposta && t.proposta.em) || '';
      tx = (prop ? 'Proposta enviada ao comprador' + (pEm ? ' em ' + C.dataBR(pEm) + ' (' + C.quando(pEm) + ')' : '') + '. ' : 'A proposta no modelo da Biomedical ainda não foi enviada ao comprador. ') +
        (pr && !pr.semData ? (pr.nivel === 2 ? 'O prazo venceu em ' + C.diaBR(t.validade) + '.' : 'Vence em ' + C.diaBR(t.validade) + ' (' + C.quando(pr.quando.toISOString()) + ').') : 'Sem data de vencimento.') +
        ' Quando o portal gerar o pedido, o PDF entra no caso e a cotação vira pedido.';
    }
    var ic = t.descartado ? IC.ban : f.ganha ? IC.trophy : f.perdida ? (t.fase === 'vencida' ? IC.alarm : IC.xc) : IC.hist;
    return '<div class="cot-dw-sit ' + tom + '">' + ic + '<div><b>' + esc(tit) + '</b>' + esc(tx) + '</div></div>';
  }

  // o caminho das fases: Cotada → Em negociação → Virou pedido (+ a saída)
  function htmlCaminho(t, fs) {
    var ORD = ['cotada', 'negociacao', 'pedido'];
    var ultima = {}; fs.forEach(function (x) { ultima[x.fase] = x; });
    var atual = C.faseAtual(t.fase), f = C.fase(atual), idx = ORD.indexOf(atual);
    // até onde chegou dentro do funil: a fase atual, ou — fora do funil — a
    // mais adiantada por onde passou antes de sair
    var ate = idx;
    if (idx < 0) fs.forEach(function (x) { var k = ORD.indexOf(x.fase); if (k > ate) ate = k; });
    var nos = ORD.map(function (id, i) {
      var x = ultima[id];
      var cls = i < ate || (idx < 0 && i === ate) ? (x ? 'feito' : 'pulou') : i === idx ? 'atual' + (id === 'pedido' ? ' fim' : '') : '';
      return '<div class="p ' + cls + '" title="' + esc(C.fase(id).nome + (x ? ' · ' + x.dia + (x.por ? ' · ' + quem(x.por) : '') : cls === 'pulou' ? ' · não passou por esta fase' : '')) + '">' +
        '<i>' + (cls === 'feito' || cls === 'atual fim' ? IC.check : '') + '</i><b>' + esc(C.fase(id).curto) + '</b><small>' + esc(x ? x.dia : cls === 'pulou' ? 'não passou' : '—') + '</small></div>';
    }).join('');
    if (f.perdida) {
      var xs = ultima[atual];
      nos += '<div class="p sai ' + atual + '" title="' + esc(f.nome + (xs ? ' · ' + xs.dia + (xs.por ? ' · ' + quem(xs.por) : '') : '')) + '"><i>' + (atual === 'vencida' ? IC.alarm : IC.x) + '</i><b>' + esc(f.curto) + '</b><small>' + esc(xs ? xs.dia : '—') + '</small></div>';
    }
    var trilha = fs.length > 1 ? '<div class="cot-dw-trilha">' + fs.slice(-8).map(function (x) { return '<span>' + esc(C.fase(x.fase).curto) + ' <i>' + esc(x.dia) + '</i></span>'; }).join('<em>→</em>') + '</div>' : '';
    return card('Caminho das fases', null, '<div class="cot-dw-path">' + nos + '</div>' + trilha);
  }

  // o que já foi feito: os marcos da cotação, do registro ao Dynamics
  function htmlFeito(c) {
    var ped = c.pedido, pi = c.pi || {}, props = c.propostas || [], ult = props[props.length - 1];
    var f = C.fase(c.fase), perdeu = f.perdida && !c.descartado;
    var l = c.leitura;
    var passos = [];
    passos.push(['ok', 'Cotação registrada', C.dataBR(c.criadoEm, true) + (c.criadoPor ? ' · ' + quem(c.criadoPor) : '') +
      (l && l.arquivo ? ' · a partir do PDF ' + l.arquivo + (l.ia ? ' (lido pela IA)' : '') : ' · preenchida à mão')]);
    if (ult) passos.push(['ok', 'Proposta enviada ao comprador', 'para ' + (ult.para || []).join(', ') + ' · ' + C.dataBR(ult.em, true) + (ult.por ? ' · ' + quem(ult.por) : '') + (props.length > 1 ? ' · ' + props.length + ' envios' : '')]);
    else passos.push([perdeu || c.fase === 'pedido' || c.descartado ? 'na' : 'agora', 'Proposta ao comprador', 'a proposta no modelo da Biomedical não foi enviada por e-mail']);
    if (ped) {
      passos.push(['ok', 'Pedido do portal', (ped.nome || 'PDF do pedido') + (ped.oc ? ' · OC ' + ped.oc : '') + ' · ' + C.dataBR(ped.em, true) + (ped.por ? ' · ' + quem(ped.por) : '')]);
      var pv = ped.previa;
      if (pv) passos.push(['ok', 'Pedido lido', (pv.itens || (pv.produtos || []).length || 0) + ' item(ns)' + (pv.total ? ' · ' + C.brl(pv.total) : '') + (pv.lidoEm ? ' · ' + C.dataBR(pv.lidoEm, true) : '')]);
      else if (pi.estado === 'erro') passos.push(['x', 'Leitura do pedido', 'não deu para ler o PDF' + (pi.erro ? ': ' + pi.erro : '')]);
      else passos.push(['agora', 'Leitura do pedido', 'o pedido ainda não foi lido pelo leitor do PI']);
      if (pi.estado === 'enviado') {
        var e = pi.enviado || {};
        passos.push(['ok', 'Lançado no Dynamics', C.dataBR(e.em, true) + (e.por ? ' · ' + quem(e.por) : '') + (e.oc ? ' · OC ' + e.oc : '') + (e.total ? ' · ' + C.brl(e.total) : '')]);
      } else if (pi.estado === 'em_andamento') passos.push(['agora', 'Lançamento no Dynamics', 'aberto no PI · Pedido' + (pi.abertoPor ? ' por ' + quem(pi.abertoPor) : '') + (pi.abertoEm ? ' ' + C.quando(pi.abertoEm) : '') + ' — falta lançar']);
      else if ((c.ovs || []).length) passos.push(['ok', 'Lançamento no Dynamics', 'lançado fora do PI · Pedido']);
      else passos.push(['agora', 'Lançamento no Dynamics', 'aguardando o PI · Pedido']);
      var ovs2 = c.ovs || [];
      if (ovs2.length) ovs2.forEach(function (o) {
        var v = o.dynamics;
        passos.push(['ok', 'Ordem de Venda ' + o.numero, C.dataBR(o.em, true) + (o.por ? ' · ' + quem(o.por) : '') +
          (v && v.achou ? ' · conferida no Dynamics' + (v.total ? ' · ' + C.brl(v.total) : '') : ' · sem conferência no Dynamics')]);
      });
      else passos.push([pi.estado === 'enviado' ? 'agora' : 'pend', 'Ordem de Venda', 'a cotação fecha com o número da OV do Dynamics']);
    } else {
      passos.push([perdeu || c.descartado ? 'na' : 'pend', 'Pedido do portal', perdeu ? 'não houve pedido' : 'sem pedido — quando o portal gerar, o PDF entra no caso']);
      passos.push(['na', 'Lançamento no Dynamics', 'depende do pedido']);
      passos.push(['na', 'Ordem de Venda', 'depende do pedido']);
    }
    if (c.descartado) {
      var d = c.descartado;
      passos.push(['x', 'Descartada', [d.motivo || 'registrada por engano', quem(d.por), d.em ? C.dataBR(d.em, true) : ''].filter(Boolean).join(' · ')]);
    } else if (perdeu) {
      var p = c.perda || {};
      passos.push(['x', f.nome, [p.motivo, p.por && p.por.nome ? p.por.nome : '', p.em ? C.dataBR(p.em, true) : ''].filter(Boolean).join(' · ')]);
    }
    var ICS = { ok: IC.check, x: IC.x, agora: '', pend: '', na: '' };
    return card('O que já foi feito', null, '<ol class="cot-dw-feito">' + passos.map(function (p) {
      return '<li class="' + p[0] + '"><i>' + ICS[p[0]] + '</i><div><b>' + esc(p[1]) + '</b><span>' + esc(p[2]) + '</span></div></li>';
    }).join('') + '</ol>');
  }

  // o pedido: há ou não há, quanto do cotado, e a comparação item a item
  function htmlPedido(c) {
    var ped = c.pedido;
    if (!ped) {
      if (c.fase === 'pedido') return '';
      var f = C.fase(c.fase);
      var tx = c.descartado ? 'A cotação foi descartada.' : f.perdida ? 'Esta cotação não virou pedido.' : 'Ainda não há pedido. Quando o portal gerar o pedido desta cotação, o PDF entra no caso e ela vai para Virou pedido.';
      return card('Pedido', null, '<div class="cot-dw-sem">' + IC.cart + '<span><b>Sem pedido</b>' + esc(tx) + '</span></div>');
    }
    var pv = ped.previa || {}, pi = c.pi || {}, e = pi.enviado || {};
    var tot = pv.total || ped.total || 0;
    var h = dl([
      ['Ordem de compra', ped.oc || pv.oc ? '<span class="cs-mono">' + esc(ped.oc || pv.oc) + '</span>' : vazio()],
      ['Total do pedido', tot ? '<b class="cot-dw-pos">' + esc(C.brl(tot)) + '</b>' : vazio('não lido')],
      ['Do cotado', tot && c.total ? esc(C.pct(tot / c.total, 0) + ' de ' + C.brl(c.total)) : vazio()],
      ['Itens do pedido', pv.itens || (pv.produtos || []).length ? esc(C.int(pv.itens || pv.produtos.length)) : vazio()],
      pv.condicao ? ['Condição', esc(pv.condicao)] : null,
      ped.data ? ['Data do pedido', esc(C.diaBR(ped.data))] : null,
      ['Anexado', esc(C.dataBR(ped.em, true) + (ped.por ? ' · ' + quem(ped.por) : ''))],
      ['No Dynamics', pi.estado === 'enviado' ? esc('Sim · ' + C.dataBR(e.em, true) + (e.por ? ' · ' + quem(e.por) : '')) + (e.codigoCliente ? ' · cliente <span class="cs-mono">' + esc(e.codigoCliente) + '</span>' : '')
        : '<span class="cot-dw-warn">' + esc(pi.estado === 'em_andamento' ? 'aberto no PI, falta lançar' : 'aguardando o PI') + '</span>'],
      ['PDF do pedido', '<button type="button" class="cot-dw-ver" data-cot-anexo="' + esc(ped.anexoId) + '">' + IC.eye + esc(ped.nome || 'Pedido.pdf') + '</button>', 'largo'],
      ped.obs ? ['Observação', '<span class="pre">' + esc(ped.obs) + '</span>', 'largo'] : null
    ]);
    return card('Pedido', null, h + htmlComparacao(c), 'cot-dw-ped');
  }
  function htmlComparacao(c) {
    var pv = c.pedido && c.pedido.previa;
    if (!pv || !(pv.produtos || []).length || !(c.itens || []).length) return '';
    var cmp = C.comparar(c.itens, pv.produtos);
    var ST = { ok: ['ok', 'igual'], dif: ['dif', 'diferente'], fora: ['fora', 'não pedido'], extra: ['extra', 'fora da cotação'] };
    var linhas = cmp.linhas.slice(0, 20).map(function (l) {
      var nome = (l.cot && l.cot.descricao) || (l.ped && l.ped.descricao) || ((l.cot || l.ped || {}).codigo) || '';
      var obs = l.st === 'dif' ? [!l.mesmaQtd ? 'qtd' : '', !l.mesmoPreco ? 'preço' : ''].filter(Boolean).join(' e ') + ' mudou' : '';
      return '<tr><td>' + esc(nome) + (obs ? '<small>' + esc(obs) + '</small>' : '') + '</td>' +
        '<td class="n">' + (l.cot ? esc(C.qtd(l.cot.quantidade) + ' × ' + C.brl(l.cot.valorUnitario)) : '—') + '</td>' +
        '<td class="n">' + (l.ped ? esc(C.qtd(l.ped.quantidade) + ' × ' + C.brl(l.ped.valorUnitario)) : '—') + '</td>' +
        '<td><span class="st ' + ST[l.st][0] + '">' + ST[l.st][1] + '</span></td></tr>';
    }).join('');
    return '<div class="cot-dw-cmp"><div class="h">Cotação × pedido' +
      (cmp.ok ? '<span class="tag ok">' + cmp.ok + ' igual(is)</span>' : '') + (cmp.dif ? '<span class="tag dif">' + cmp.dif + ' com diferença</span>' : '') +
      (cmp.fora ? '<span class="tag fora">' + cmp.fora + ' não pedido(s)</span>' : '') + (cmp.extra ? '<span class="tag fora">' + cmp.extra + ' fora da cotação</span>' : '') + '</div>' +
      '<div class="w"><table><thead><tr><th>Item</th><th class="n">Cotado</th><th class="n">Pedido</th><th></th></tr></thead><tbody>' + linhas + '</tbody></table></div>' +
      (cmp.linhas.length > 20 ? '<div class="fv-dw-av">Mostrando 20 de ' + cmp.linhas.length + ' linhas — a comparação inteira está no caso completo.</div>' : '') + '</div>';
  }

  // por que não virou (perdida, vencida, cancelada)
  function htmlPerda(c) {
    var f = C.fase(c.fase);
    if (!f.perdida || c.descartado) return '';
    var p = c.perda || {};
    return card(c.fase === 'perdida' ? 'Por que perdemos' : c.fase === 'vencida' ? 'Por que venceu' : 'Por que foi cancelada', null, dl([
      ['Motivo', p.motivo ? '<b>' + esc(p.motivo) + '</b>' : vazio('sem motivo')],
      ['Marcada', p.automatica || !(p.por && p.por.email) ? esc('automaticamente pelo portal' + (p.em ? ' · ' + C.dataBR(p.em, true) : '')) : esc(quem(p.por) + (p.em ? ' · ' + C.dataBR(p.em, true) : ''))],
      c.fase === 'perdida' ? ['Concorrente', p.concorrente ? esc(p.concorrente) : vazio('não informado')] : null,
      c.fase === 'perdida' ? ['Preço do concorrente', p.valorConcorrente ? esc(C.brl(p.valorConcorrente)) + (c.total ? ' <span class="cot-dw-mut">· nosso: ' + esc(C.brl(c.total)) + '</span>' : '') : vazio('não informado')] : null,
      p.obs ? ['Observação', '<span class="pre">' + esc(p.obs) + '</span>', 'largo'] : null
    ]), 'cot-dw-perda');
  }

  // os itens cotados
  function htmlItens(c) {
    var l = c.itens || [];
    if (!l.length) return card('Itens cotados', 0, '<div class="fv-dw-nada">Nenhum item registrado.</div>');
    var LIM = 12, vis = F.itensTudo ? l : l.slice(0, LIM);
    var semPreco = l.filter(function (it) { return !Number(it.valorUnitario); }).length;
    return card('Itens cotados', l.length,
      '<div class="fv-dw-its-r"><span>Total cotado <b>' + esc(C.brl(c.total)) + '</b></span>' + (semPreco ? '<span>' + C.int(semPreco) + ' sem preço (não cotado' + (semPreco > 1 ? 's' : '') + ')</span>' : '') + '</div>' +
      '<div class="fv-dw-its">' + vis.map(function (it, i) {
        var meta = [it.codigo, it.codigoCliente ? 'comprador ' + it.codigoCliente : '', it.marca, it.registro ? 'RMS ' + it.registro : '', it.unidade].filter(Boolean).join(' · ');
        var tot = (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0);
        return '<div class="fv-dw-it"><div class="n">' + (i + 1) + '</div>' +
          '<div class="c"><div class="t">' + esc(it.descricao || it.codigo || 'Item sem descrição') + '</div>' + (meta ? '<div class="s">' + esc(meta) + '</div>' : '') + '</div>' +
          '<div class="v"><b>' + (tot ? esc(C.brl(tot)) : '<span class="cot-dw-mut">sem preço</span>') + '</b><span>' + esc(C.qtd(it.quantidade) + (it.valorUnitario ? ' × ' + C.brl(it.valorUnitario) : '')) + '</span></div></div>';
      }).join('') + '</div>' + maisBtn('itens', F.itensTudo, l.length, LIM, 'os itens'));
  }

  // a tramitação: as notas do time
  function htmlNotas(c) {
    var l = (c.notas || []).slice().reverse();
    if (!l.length) return card('Tramitação', 0, '<div class="fv-dw-nada">Nenhuma nota registrada nesta cotação.</div>');
    var LIM = 4, vis = F.notasTudo ? l : l.slice(0, LIM);
    return card('Tramitação', l.length, '<div class="cot-notas">' + vis.map(function (n) {
      return '<div class="cot-nota">' + C.avatar(n.por && n.por.nome, n.por && n.por.email, 'p') + '<div class="bx"><small><b>' + esc(quem(n.por)) + '</b> · ' + esc(C.dataBR(n.em, true)) + '</small>' + esc(n.texto) + '</div></div>';
    }).join('') + '</div>' + maisBtn('notas', F.notasTudo, l.length, LIM, 'as notas'));
  }

  // o comprador, as condições e as datas
  function htmlDados(c) {
    var cli = c.cliente || {}, ct = c.contato || {}, dt = c.datas || {}, co = c.condicoes || {}, v = c.erp;
    var erp = !v ? vazio('não consultado') : v.erro ? vazio('não consultado (' + v.erro + ')') : !v.achou ? vazio('CNPJ não encontrado — cliente novo')
      : esc([v.codigo, (v.empresas || []).join('/') || v.empresa, v.grupo, v.pagamento ? 'cond. ' + v.pagamento : ''].filter(Boolean).join(' · ')) + (v.bloqueado ? ' <span class="cs-chip prazo-vencido">bloqueado (' + esc(v.bloqueio) + ')</span>' : '');
    var validade = (function () {
      var a = C.dataPortal(dt.cotacao), b = C.dataPortal(dt.validade);
      if (!a || !b) return '';
      var n = Math.round((b.getTime() - a.getTime()) / 86400e3);
      return n + (n === 1 || n === -1 ? ' dia' : ' dias');
    })();
    var comp = dl([
      ['Cliente', cli.nome ? esc(cli.nome) : vazio(), 'largo'],
      ['CNPJ', cli.cnpj ? '<span class="cs-mono">' + esc(C.cnpjMask(cli.cnpj)) + '</span>' : vazio()],
      ['Código ERP', cli.codigo ? '<span class="cs-mono">' + esc(cli.codigo) + '</span>' : vazio()],
      ['Dynamics', erp, 'largo'],
      ['Cidade/UF', [cli.cidade, cli.uf].filter(Boolean).length ? esc([cli.cidade, cli.uf].filter(Boolean).join('/')) : vazio()],
      ['CEP', cli.cep ? esc(C.formatar('cep', cli.cep)) : vazio()],
      cli.endereco ? ['Endereço', esc(cli.endereco), 'largo'] : null,
      ['Contato', ct.nome ? esc(ct.nome) : vazio()],
      ['Telefone', ct.telefone ? esc(C.formatar('fone', ct.telefone)) : vazio()],
      ['E-mail', ct.email ? '<a href="mailto:' + esc(ct.email) + '">' + esc(ct.email) + '</a>' : vazio(), 'largo']
    ]);
    var cond = dl([
      ['Data da cotação', dt.cotacao ? esc(C.diaBR(dt.cotacao)) : vazio()],
      ['Vencimento', dt.validade ? esc(C.diaBR(dt.validade)) + (validade ? ' <span class="cot-dw-mut">· ' + esc(validade) + '</span>' : '') : vazio()],
      ['Pagamento', co.pagamento ? esc(co.pagamento) : vazio()],
      ['Entrega', co.entrega ? esc(co.entrega) : vazio()],
      co.frete ? ['Frete', esc(co.frete)] : null,
      co.validade ? ['Validade (PDF)', esc(co.validade)] : null,
      ['Empresa', esc(c.empresa || 'BIO')],
      ['Área', c.area ? esc(c.area) : vazio()],
      ['Responsável', c.dono ? esc(c.dono.nome) : '<span class="cot-dw-warn">sem responsável</span>'],
      ['Registrada', esc(C.dataBR(c.criadoEm, true) + (c.criadoPor ? ' · ' + quem(c.criadoPor) : ''))],
      co.observacao ? ['Observação', '<span class="pre">' + esc(co.observacao) + '</span>', 'largo'] : null
    ]);
    return card('Comprador', null, comp) + card('Condições e datas', null, cond);
  }

  // os anexos: o PDF da cotação, o do pedido, as propostas enviadas e o resto
  function htmlAnexos(c) {
    var l = (c.anexos || []).filter(function (a) { return !a.removido; });
    var props = (c.propostas || []).slice().reverse();
    var TIPO = { cotacao: 'PDF da cotação', pedido: 'PDF do pedido', proposta: 'proposta enviada', outro: 'anexo' };
    var envios = props.length ? '<div class="cot-dw-envios">' + props.map(function (p) {
      return '<div class="fv-dw-pr"><div class="c"><div class="t">' + IC.arrow + 'Proposta para ' + esc((p.para || []).join(', ')) + '</div>' +
        '<div class="s">' + esc(C.dataBR(p.em, true) + (p.por ? ' · ' + quem(p.por) : '') + ((p.copia || []).length ? ' · cópia: ' + p.copia.join(', ') : '')) + '</div></div>' +
        (p.anexoId ? '<button type="button" class="cot-dw-ver" data-cot-anexo="' + esc(p.anexoId) + '">' + IC.eye + 'PDF</button>' : '') + '</div>';
    }).join('') + '</div>' : '';
    var arqs = l.filter(function (a) { return a.tipo !== 'proposta'; });
    var lista = arqs.length ? '<div class="fv-dw-props">' + arqs.map(function (a) {
      return '<div class="fv-dw-pr"><div class="c"><div class="t">' + (a.tipo === 'outro' ? IC.clip : IC.pdf) + esc(a.nome) + '</div>' +
        '<div class="s">' + esc([TIPO[a.tipo] || 'anexo', a.tamanho ? C.bytes(a.tamanho) : '', quem(a.por), C.dataBR(a.em)].filter(Boolean).join(' · ')) + '</div></div>' +
        '<button type="button" class="cot-dw-ver" data-cot-anexo="' + esc(a.id) + '">' + IC.eye + 'Ver</button></div>';
    }).join('') + '</div>' : '';
    if (!envios && !lista) return card('Propostas e anexos', 0, '<div class="fv-dw-nada">Nenhum anexo nem proposta enviada.</div>');
    return card('Propostas e anexos', arqs.length + props.length, envios + lista);
  }

  // tudo o que aconteceu, do mais novo para o mais antigo
  function htmlHistorico(c) {
    var l = (c.historico || []).slice().reverse();
    if (!l.length) return '';
    var LIM = 10, vis = F.histTudo ? l : l.slice(0, LIM);
    return card('Histórico', l.length, '<ul class="cs-hist cot-dw-hist">' + vis.map(function (h) {
      var corpo = (h.tipo === 'campo' || h.tipo === 'fase')
        ? '<b>' + esc(h.campo) + '</b>: ' + (h.de ? '<span class="de">' + esc(h.de) + '</span> → ' : '') + '<span class="para">' + esc(h.para || '—') + '</span>' + (h.texto ? '<br>' + esc(h.texto) : '')
        : esc(h.texto || '');
      return '<li style="--c:' + (COR_HIST[h.tipo] || '#8DBBF5') + '">' + corpo + '<small>' + esc(quem(h.por) || 'Portal') + ' · ' + esc(C.dataBR(h.em, true)) + '</small></li>';
    }).join('') + '</ul>' + maisBtn('hist', F.histTudo, l.length, LIM, 'o histórico'));
  }

  C.ficha = { abrir: abrir, fechar: fechar, atualizar: atualizar, aberta: function () { return !!(F.el && F.el.classList.contains('open')) && F.num; } };
})();
