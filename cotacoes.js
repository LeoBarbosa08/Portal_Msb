/* ================================================================
   cotacoes.js — GESTÃO DE COTAÇÕES (pages/comercial-cot-casos.html)

   O console das cotações, no molde dos tickets do Customer Service:

     Cotações  a fila (Em andamento · Prazo vencendo · Sem responsável ·
               Minhas · Aguardando PI · Viraram pedido · Perdidas · Todas),
               dividida por portal, com busca e ordem (o prazo primeiro).
               Clicar abre o CASO: o caminho das fases (Cotada → Em negociação →
               Virou pedido, e as saídas Perdida/Vencida/Cancelada — Vencida é
               automática, pela data de vencimento), a PROPOSTA no modelo da Biomedical
               (ver, enviar e reenviar ao comprador pelo Outlook),
               o cartão do PEDIDO (soltar o PDF do pedido do portal = a
               cotação vira pedido; o portal lê o pedido, compara com o que
               foi cotado e manda para o PI · Pedido; no fim a cotação FECHA
               com a Ordem de Venda do Dynamics, conferida no F&O — uma ou
               mais, do PI ou lançada à mão), os itens, a tramitação
               (notas), os dados editáveis, os anexos e o histórico.
     Quadro    kanban pelas fases; arrastar muda a fase (Virou pedido pede o
               PDF, Perdida pede o motivo).
     Config.   portais, motivos e o aviso de vencimento (o módulo é SÓ do dono
               do portal — não há equipe). Empresa é sempre BIO; a área vem da
               equipe de segurança de quem registra.

   Tempo real: /api/cot-casos?rev=N a cada 20 s (barato quando nada mudou).
   O PI avisa esta aba quando lança o pedido no Dynamics (BroadcastChannel
   'bm-cs' do customer-service-pi.js) e o caso se atualiza sozinho.
   ================================================================ */
(function () {
  'use strict';
  var C = window.COT; if (!C) return;
  var D = document, W = window, $ = C.$, esc = C.esc, IC = C.IC;
  if (!D.body || D.body.getAttribute('data-cot-pagina') !== 'casos') return;

  var S = {
    eu: null, cfg: null, configurado: null, rev: null, casos: [], porNumero: {}, carregou: false, erro: '',
    visao: 'andamento', portal: '', busca: '', ordem: C.lerLocal('cot-ordem') || 'prazo',
    caso: null, abrindo: '', aba: 'lista', editandoItens: false, itensRascunho: null,
    leiturasPedido: {}, lendoPedido: {}, rascunho: {}, conhecidos: null,
    cfgTela: null, diag: null, padrao: null, pessoas: null, enviando: false,
    propPara: {}, propEnvio: {},  // a proposta, por caso: o "Para" digitado e o estado do envio
    ovRascunho: {}, ovEnvio: {}, ovMais: {}   // a Ordem de Venda, por caso: o número digitado, a conferência e o "+ outra OV"
  };

  var VISOES = [
    { id: 'andamento', nome: 'Em andamento', ic: IC.inbox },
    { id: 'vencendo', nome: 'Prazo vencendo', ic: IC.alarm, quente: true },
    { id: 'sem_dono', nome: 'Sem responsável', ic: IC.userx, quente: true },
    { id: 'minhas', nome: 'Minhas', ic: IC.user },
    { id: 'aguardando_pi', nome: 'Aguardando PI', ic: IC.cart, quente: true },
    { id: 'aguardando_ov', nome: 'Aguardando OV', ic: IC.tag, quente: true },
    { id: 'pedido', nome: 'Viraram pedido', ic: IC.trophy },
    { id: 'perdidas', nome: 'Perdidas, vencidas e canceladas', ic: IC.xc },
    { id: 'todas', nome: 'Todas', ic: IC.layers },
    { id: 'descartadas', nome: 'Descartadas', ic: IC.ban }
  ];
  function aviso() { return S.cfg && S.cfg.avisoDias != null ? S.cfg.avisoDias : 2; }
  function eMeu(c) { return !!(c.dono && S.eu && c.dono.email === S.eu.email); }
  function passa(c, v) {
    if (v === 'descartadas') return !!c.descartado;
    if (c.descartado) return false;
    var ab = C.aberta(c.fase);
    switch (v) {
      case 'andamento': return ab;
      case 'vencendo': var p = C.prazoDe(c, aviso()); return ab && !!p && p.nivel >= 1;
      case 'sem_dono': return ab && !c.dono;
      case 'minhas': return ab && eMeu(c);
      // pedido ainda sem lançar (a OV registrada à mão também tira daqui)
      case 'aguardando_pi': return c.fase === 'pedido' && c.pi !== 'enviado' && !temOv(c);
      // o PI lançou no Dynamics e falta fechar com a Ordem de Venda
      case 'aguardando_ov': return c.fase === 'pedido' && c.pi === 'enviado' && !temOv(c);
      case 'pedido': return c.fase === 'pedido';
      case 'perdidas': return c.fase === 'perdida' || c.fase === 'vencida' || c.fase === 'cancelada';
      default: return true;
    }
  }
  function temOv(c) { return !!(c.ovs && c.ovs.length); }
  function textoBusca(c) {
    return C.norm([c.numero, (c.ovs || []).join(' '), c.cliente && c.cliente.nome, c.cliente && c.cliente.cnpj, c.cliente && c.cliente.cidade, c.cliente && c.cliente.uf,
      c.portal, c.cotacaoId, c.oc, c.itensTxt, c.dono && c.dono.nome, c.empresa, c.area, C.fase(c.fase).nome].join(' '));
  }
  function filtrados(semPortal) {
    var t = C.norm(S.busca).trim(), dig = S.busca.replace(/\D/g, '');
    return S.casos.filter(function (c) {
      if (!passa(c, S.visao)) return false;
      if (!semPortal && S.portal && (c.portal || '(sem portal)') !== S.portal) return false;
      if (t) {
        var tb = textoBusca(c);
        if (tb.indexOf(t) < 0 && !(dig.length >= 4 && tb.replace(/\D/g, '').indexOf(dig) >= 0)) return false;
      }
      return true;
    });
  }
  function ordenar(l) {
    var o = S.ordem, chave;
    if (o === 'prazo') chave = function (c) { var p = C.prazoDe(c, aviso()); return p && p.quando ? p.quando.getTime() : (C.aberta(c.fase) ? 9e15 : 9.5e15 - C.ms(c.fechadoEm)); };
    else if (o === 'recentes') chave = function (c) { return -C.ms(c.criadoEm); };
    else if (o === 'chegada') chave = function (c) { return C.ms(c.criadoEm); };
    else if (o === 'valor') chave = function (c) { return -(c.totalPedido || c.total || 0); };
    else chave = function (c) { return -C.ms(c.atualizadoEm); };
    return l.slice().sort(function (a, b) { var x = chave(a), y = chave(b); return x - y || C.ms(b.criadoEm) - C.ms(a.criadoEm); });
  }
  function lista() { return ordenar(filtrados()); }

  /* ── o resumo local (o mesmo do api/shared/cot-motor.js) ──────── */
  function resumoLocal(c) {
    var ped = c.pedido || null, pv = ped && ped.previa;
    return {
      numero: c.numero, fase: c.fase, portal: c.portal || '', cotacaoId: c.cotacaoId || '',
      cliente: { nome: (c.cliente && c.cliente.nome) || '', cnpj: (c.cliente && c.cliente.cnpj) || '', uf: (c.cliente && c.cliente.uf) || '', cidade: (c.cliente && c.cliente.cidade) || '' },
      empresa: c.empresa || '', area: c.area || '', dono: c.dono ? { email: c.dono.email, nome: c.dono.nome } : null,
      total: c.total || 0, nItens: (c.itens || []).length,
      totalPedido: ped ? ((pv && pv.total) || ped.total || 0) : 0, oc: ped ? (ped.oc || (pv && pv.oc) || '') : '',
      validade: (c.datas && c.datas.validade) || '', dataCotacao: (c.datas && c.datas.cotacao) || '',
      criadoEm: c.criadoEm, atualizadoEm: c.atualizadoEm, faseEm: c.faseEm || c.criadoEm, fechadoEm: c.fechadoEm || null,
      fases: (c.fases || []).slice(-12).map(function (f) { return [C.faseAtual(f.fase), String(f.em || '').slice(0, 10)]; }),
      proposta: c.proposta ? { em: c.proposta.em, para: (c.proposta.para || []).join(', ') } : null,
      pi: c.pi ? c.pi.estado || '' : '', ovs: (c.ovs || []).map(function (o) { return o.numero; }), perda: c.perda ? c.perda.motivo || '' : '',
      nAnexos: (c.anexos || []).filter(function (a) { return !a.removido; }).length, nNotas: (c.notas || []).length,
      descartado: !!c.descartado,
      itensTxt: (c.itens || []).slice(0, 6).map(function (i) { return i.descricao || i.codigo; }).join(' · ').slice(0, 240)
    };
  }
  function mesclar(caso) {
    if (!caso) return;
    var r = resumoLocal(caso), i = S.casos.findIndex(function (x) { return x.numero === caso.numero; });
    if (i >= 0) S.casos[i] = r; else S.casos.unshift(r);
    S.porNumero[caso.numero] = r;
    if (S.caso && S.caso.numero === caso.numero) S.caso = caso;
  }

  /* ── faixa, selo ao vivo, KPIs ──────────────────────────────── */
  function faixa(html, tipo) { var f = $('cot-faixa'); if (f) f.innerHTML = html ? '<div class="cs-faixa ' + (tipo || '') + '">' + (tipo === 'erro' ? IC.alert : IC.info) + '<div>' + html + '</div></div>' : ''; }
  function pintarLive(st, txt) { var l = $('cot-live'); if (!l) return; l.className = 'cs-live ' + (st || ''); l.querySelector('span').textContent = txt; }
  function contagens() {
    var n = {}; VISOES.forEach(function (v) { n[v.id] = 0; });
    S.casos.forEach(function (c) { VISOES.forEach(function (v) { if (passa(c, v.id)) n[v.id]++; }); });
    return n;
  }
  function renderKpis() {
    var el = $('cot-kpis'); if (!el) return;
    var n = contagens(), vivos = S.casos.filter(function (c) { return !c.descartado; });
    var and = vivos.filter(function (c) { return C.aberta(c.fase); });
    var vAnd = and.reduce(function (s, c) { return s + (c.total || 0); }, 0);
    var vencidas = and.filter(function (c) { var p = C.prazoDe(c, aviso()); return p && p.nivel === 2; }).length;
    var agora = new Date(), iniMes = new Date(agora.getFullYear(), agora.getMonth(), 1).getTime();
    var ganhasMes = vivos.filter(function (c) { return c.fase === 'pedido' && C.ms(c.fechadoEm) >= iniMes; });
    var vGanhoMes = ganhasMes.reduce(function (s, c) { return s + (c.totalPedido || c.total || 0); }, 0);
    var d90 = Date.now() - 90 * 86400e3;
    var enc = vivos.filter(function (c) { return !C.aberta(c.fase) && C.ms(c.fechadoEm) >= d90; });
    var gan = enc.filter(function (c) { return c.fase === 'pedido'; }).length;
    var K = [
      ['andamento', IC.inbox, C.int(n.andamento), 'Em andamento', C.brlCurto(vAnd) + ' cotados', '#1A66D2', '#EEF4FE'],
      ['vencendo', IC.alarm, C.int(n.vencendo), 'Prazo vencendo', vencidas ? vencidas + ' já vencida(s)' : 'vencem nos próximos ' + aviso() + ' dia(s)', '#D97706', '#FEF1DA', n.vencendo > 0],
      ['sem_dono', IC.userx, C.int(n.sem_dono), 'Sem responsável', 'esperando alguém assumir', '#EA580C', '#FFEDD5', n.sem_dono > 0],
      ['pedido', IC.trophy, C.int(ganhasMes.length), 'Viraram pedido no mês', C.brlCurto(vGanhoMes), '#138A4B', '#DDF5E7'],
      ['aguardando_pi', IC.cart, C.int(n.aguardando_pi), 'Aguardando o PI', 'pedido sem lançar no Dynamics', '#5A3BC4', '#EEE8FD', n.aguardando_pi > 0],
      ['todas', IC.funnel, enc.length ? C.pct(gan / enc.length, 0) : '—', 'Conversão · 90 dias', enc.length ? gan + ' pedido(s) de ' + enc.length + ' encerrada(s)' : 'nenhuma encerrada', '#0891B2', '#E0F5FA']
    ];
    el.innerHTML = K.map(function (k) {
      return '<button type="button" class="cs-kpi' + (S.visao === k[0] && S.aba === 'lista' && !S.caso ? ' ativo' : '') + (k[7] ? ' quente' : '') + (S.carregou && (k[2] === '0' || k[2] === '—') ? ' zero' : '') + '" data-visao="' + k[0] + '" style="--k:' + k[5] + ';--kf:' + k[6] + '">' +
        '<span class="cs-kpi-top"><span class="cs-kpi-ic">' + k[1] + '</span></span><span class="cs-kpi-n">' + (S.carregou ? k[2] : '–') + '</span>' +
        '<span class="cs-kpi-l">' + esc(k[3]) + '</span><span class="cs-kpi-s">' + esc(S.carregou ? k[4] : '') + '</span></button>';
    }).join('');
    C.quieto(el);
  }

  /* ── a lista ────────────────────────────────────────────────── */
  function renderVisoes() {
    var el = $('cot-visoes'); if (!el) return;
    var n = contagens();
    el.innerHTML = VISOES.map(function (v) {
      return '<button type="button" class="tk-visao' + (S.visao === v.id ? ' ativo' : '') + (v.quente && n[v.id] ? ' quente' : '') + '" data-visao="' + v.id + '">' + v.ic + esc(v.nome) + '<span class="n">' + (S.carregou ? n[v.id] : '–') + '</span></button>';
    }).join('');
  }
  function renderPortais() {
    var el = $('cot-portais'); if (!el) return;
    var base = filtrados(true), por = {};
    base.forEach(function (c) { var p = c.portal || '(sem portal)'; por[p] = (por[p] || 0) + 1; });
    var nomes = Object.keys(por).sort(function (a, b) { return por[b] - por[a]; });
    if (S.portal && nomes.indexOf(S.portal) < 0) nomes.push(S.portal);
    if (nomes.length < 2 && !S.portal) { el.innerHTML = ''; return; }
    el.innerHTML = '<span class="tk-ests-l">Portal</span><button type="button" class="tk-est' + (!S.portal ? ' ativo' : '') + '" data-portal="">Todos<span class="n">' + base.length + '</span></button>' +
      nomes.map(function (p) { return '<button type="button" class="tk-est' + (S.portal === p ? ' ativo' : '') + '" data-portal="' + esc(p) + '">' + esc(p) + '<span class="n">' + (por[p] || 0) + '</span></button>'; }).join('');
  }
  function linhaHtml(c, chegou) {
    var f = C.fase(c.fase), pr = C.prazoDe(c, aviso());
    var sub = '<span class="cs-chip portal">' + esc(c.portal || 'sem portal') + '</span>' + (c.cotacaoId ? 'nº ' + esc(c.cotacaoId) : '') +
      ' <i>· ' + c.nItens + ' item(ns)' + (c.cliente && c.cliente.uf ? ' · ' + esc(c.cliente.uf) : '') + '</i>';
    var val = '<b>' + C.brl(c.total) + '</b>' + (c.fase === 'pedido' && c.totalPedido ? '<small class="ped">pedido ' + C.brlCurto(c.totalPedido) + (c.oc ? ' · OC ' + esc(c.oc) : '') + '</small>' : '<small>cotado</small>');
    var prazo = pr && !pr.semData ? C.chipPrazo(c, aviso()) : (!C.aberta(c.fase) && c.fechadoEm ? '<span class="tk-vazio">' + esc((c.fase === 'pedido' ? 'Pedido ' : 'Fechada ') + C.quando(c.fechadoEm)) + '</span>' : '<span class="tk-vazio">—</span>');
    return '<div class="cot-row' + (chegou ? ' chegou' : '') + (c.descartado ? ' desc' : '') + '" role="row" tabindex="0" data-num="' + esc(c.numero) + '" style="--c:' + (c.descartado ? '#94A3B8' : f.cor) + '">' +
      '<span class="cot-c cot-c-num" role="cell"><b class="cs-mono">' + esc(c.numero) + '</b><small title="Registrada ' + esc(C.dataBR(c.criadoEm, true)) + '">' + esc(C.chegada(c.criadoEm)) + '</small></span>' +
      '<span class="cot-c cot-c-cli" role="cell"><b>' + esc((c.cliente && c.cliente.nome) || 'Cliente não informado') + '</b><small>' + sub + '</small></span>' +
      '<span class="cot-c cot-c-val" role="cell">' + val + '</span>' +
      '<span class="cot-c cot-c-prazo" role="cell">' + prazo + '</span>' +
      '<span class="cot-c cot-c-fase" role="cell">' + (c.descartado ? '<span class="cs-chip descartada">Descartada</span>' : C.chipFase(c.fase) + C.chipPi(c)) + '</span>' +
      '<span class="cot-c cot-c-dono" role="cell">' + (c.dono ? C.avatar(c.dono.nome, c.dono.email, 'p') + '<span>' + esc(C.primeiroNome(c.dono.nome) || c.dono.email) + '</span>' : '<span class="tk-sem">Sem responsável</span>') + '</span>' +
    '</div>';
  }
  function renderLista(chegaram) {
    renderVisoes(); renderPortais();
    var el = $('cot-tabela'), cab = $('cot-cab'); if (!el) return;
    var l = lista(), v = VISOES.filter(function (x) { return x.id === S.visao; })[0];
    var soma = l.reduce(function (s, c) { return s + (c.total || 0); }, 0);
    var ordTxt = { prazo: 'pelo prazo', recentes: 'mais recentes primeiro', chegada: 'em ordem de chegada', valor: 'maior valor primeiro', atividade: 'por última atividade' }[S.ordem] || '';
    if (cab) cab.innerHTML = '<span><b>' + (S.carregou ? C.int(l.length) : '–') + '</b> cotação(ões) · ' + esc(v.nome) + (S.portal ? ' · ' + esc(S.portal) : '') +
      (l.length ? ' · <b>' + C.brlCurto(soma) + '</b> cotados' : '') + ' · ' + esc(ordTxt) + '</span>' +
      (S.portal || S.busca ? '<button type="button" class="cs-btn cs-btn-xs cs-btn-ghost" id="cot-limpar">Limpar filtros</button>' : '');
    if (!S.carregou) { el.innerHTML = '<div class="cs-esqueleto"></div><div class="cs-esqueleto"></div><div class="cs-esqueleto"></div>'; return; }
    if (!l.length) {
      var tx = S.configurado === false ? 'O armazenamento das Cotações ainda não foi configurado (COT_BLOB_URL).'
        : S.busca ? 'Nenhuma cotação com "' + esc(S.busca) + '".'
        : !S.casos.length ? 'Nenhuma cotação registrada ainda. Use o <a href="comercial-cot-nova.html">Agente de Cotações</a> para trazer a primeira.'
        : 'Nada nesta fila agora.';
      el.innerHTML = '<div class="cs-vazio"><div class="ic">' + C.svg('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>', 30) + '</div><h3>' + (S.busca ? 'Sem resultado' : 'Tudo em dia') + '</h3>' + tx + '</div>';
      return;
    }
    var MAX = 300;
    el.innerHTML = '<div class="cot-th" role="row"><span>Cotação · entrada</span><span>Cliente e portal</span><span class="n" style="text-align:right">Valor</span><span>Prazo</span><span>Fase</span><span>Responsável</span></div>' +
      l.slice(0, MAX).map(function (c) { return linhaHtml(c, chegaram && chegaram[c.numero]); }).join('') +
      (l.length > MAX ? '<div class="cs-vazio" style="padding:14px">Mostrando ' + MAX + ' de ' + l.length + ' — refine a busca.</div>' : '');
    C.quieto(el);
  }

  /* ── o caso aberto ──────────────────────────────────────────── */
  function mostrarCaso(sim) {
    var box = $('cot-caso'), ls = $('cot-lista');
    if (box) box.hidden = !sim;
    if (ls) ls.hidden = !!sim;
  }
  function abrirCaso(numero, semRota) {
    if (!numero) return;
    if (S.aba !== 'lista') irAba('lista', true);
    S.abrindo = numero; S.editandoItens = false; S.itensRascunho = null;
    var box = $('cot-caso');
    mostrarCaso(true);
    if (!S.caso || S.caso.numero !== numero) box.innerHTML = '<div class="tk-carregando"><span class="cs-spin"></span> Abrindo ' + esc(numero) + '…</div>';
    if (!semRota) { try { history.replaceState(null, '', location.pathname + '?caso=' + encodeURIComponent(numero) + location.hash); } catch (e) {} }
    renderKpis();
    return C.api('cot-casos?numero=' + encodeURIComponent(numero)).then(function (j) {
      if (S.abrindo !== numero) return;
      S.caso = j.caso; mesclar(j.caso);
      renderCaso();
      W.scrollTo({ top: 0, behavior: 'smooth' });
      var ab = D.querySelector('.dept-main'); if (ab) ab.scrollTo({ top: 0, behavior: 'smooth' });
      preLerPedido(S.caso);
    }).catch(function (e) {
      box.innerHTML = '<div class="cs-vazio"><h3>Não abriu</h3>' + esc(e.message) + '<br><br><button type="button" class="cs-btn cs-btn-sm" data-act="voltar">' + IC.back + 'Voltar à lista</button></div>';
    });
  }
  function fecharCaso() {
    S.caso = null; S.abrindo = '';
    mostrarCaso(false);
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
    renderTudo();
  }
  function acao(corpo, okTxt) {
    if (S.enviando) return Promise.resolve(null);
    S.enviando = true;
    return C.api('cot-casos', corpo).then(function (j) {
      S.enviando = false;
      if (j && j.caso) { mesclar(j.caso); if (S.caso && S.caso.numero === j.caso.numero) S.caso = j.caso; }
      renderTudo();
      if (okTxt) C.toast(okTxt, '', 'ok');
      return j;
    }).catch(function (e) {
      S.enviando = false;
      C.toast('Não deu certo', e.message, 'erro');
      throw e;
    });
  }

  function htmlHero(c) {
    var f = C.fase(c.fase), r = resumoLocal(c), pr = C.prazoDe(r, aviso());
    var ordem = ['cotada', 'negociacao', 'pedido'];
    var idx = ordem.indexOf(c.fase), perdeu = f.perdida;
    var path = ordem.map(function (id, i) {
      var cls = perdeu ? '' : i < idx ? 'feito' : i === idx ? 'atual' + (id === 'pedido' ? ' fim' : '') : '';
      return '<button type="button" class="' + cls + '" data-fase="' + id + '" title="Mudar para: ' + esc(C.fase(id).nome) + '"' + (c.descartado ? ' disabled' : '') + '>' +
        ((!perdeu && (i < idx || (i === idx && id === 'pedido'))) ? IC.check : '') + esc(C.fase(id).curto) + '</button>';
    }).join('');
    var saidas = '<div class="cot-saidas"><button type="button" data-fase="perdida" class="' + (c.fase === 'perdida' ? 'on' : '') + '"' + (c.descartado ? ' disabled' : '') + '>Perdida</button>' +
      (c.fase === 'vencida' ? '<button type="button" class="on venc" disabled title="A data de vencimento passou — automático">Vencida</button>' : '') +
      '<button type="button" data-fase="cancelada" class="' + (c.fase === 'cancelada' ? 'on' : '') + '"' + (c.descartado ? ' disabled' : '') + '>Cancelada</button></div>';
    var cli = c.cliente || {}, ped = c.pedido;
    var local = [cli.cidade, cli.uf].filter(Boolean).join('/');
    var prazoBox = pr && !pr.semData
      ? '<div class="tk-hero-conta ' + (pr.nivel === 2 ? 'vencido' : pr.nivel === 1 ? 'alerta' : '') + '"><small>Data de vencimento</small><b>' + esc(pr.txt) + '</b><span>' + esc(pr.quando ? C.quando(pr.quando.toISOString()) : '') + '</span></div>'
      : '<div class="tk-hero-conta vazio"><small>Data de vencimento</small><b>' + (C.aberta(c.fase) ? 'sem data' : (c.fechadoEm ? 'Fechada ' + esc(C.dataBR(c.fechadoEm)) : '—')) + '</b><span>' + (C.aberta(c.fase) ? 'informe em "Detalhes"' : esc(C.quando(c.fechadoEm))) + '</span></div>';
    var pedBox = ped
      ? '<div class="tk-hero-conta ganho"><small>Pedido</small><b class="grande">' + C.brl((ped.previa && ped.previa.total) || ped.total || 0) + '</b><span>' + esc(ped.oc ? 'OC ' + ped.oc : ped.nome) + ((c.ovs || []).length ? ' · ' + c.ovs[0].numero + (c.ovs.length > 1 ? ' +' + (c.ovs.length - 1) : '') : c.pi && c.pi.estado === 'enviado' ? ' · aguardando OV' : ' · aguardando o PI') + '</span></div>'
      : '<div class="tk-hero-conta"><small>Responsável</small><b>' + (c.dono ? esc(c.dono.nome) : 'Sem responsável') + '</b><span>' + (c.dono ? esc(c.dono.email) : 'clique em Assumir') + '</span></div>';
    return '<section class="cs-card tk-hero" style="--c:' + (c.descartado ? '#94A3B8' : f.cor) + '">' +
      '<div class="tk-hero-l1"><span class="cs-d-num" id="cot-copiar" title="Copiar o número e o link">' + esc(c.numero) + IC.copy + '</span>' +
        (c.descartado ? '<span class="cs-chip descartada">Descartada</span>' : C.chipFase(c.fase)) + '<span class="cs-chip portal">' + esc(c.portal || 'sem portal') + '</span>' +
        '<span class="tk-hero-meta" title="' + esc(C.dataBR(c.criadoEm, true)) + '">Registrada ' + esc(C.chegada(c.criadoEm)) + (c.criadoPor ? ' por ' + esc(c.criadoPor.nome) : '') + '</span></div>' +
      '<h2 class="tk-titulo">' + esc(cli.nome || 'Cliente não informado') + '</h2>' +
      '<div class="tk-hero-meta" style="margin:-6px 0 12px">' + esc(C.tituloCaso(c)) + (local ? ' · ' + esc(local) : '') + (cli.cnpj ? ' · <span class="cs-mono">' + esc(C.cnpjMask(cli.cnpj)) + '</span>' : '') + '</div>' +
      '<div class="tk-hero-cli cot-hero-cli">' +
        '<div class="tk-hero-conta"><small>Valor cotado</small><b class="grande">' + C.brl(c.total) + '</b><span>' + (c.itens || []).length + ' item(ns)' + (c.condicoes && c.condicoes.pagamento ? ' · ' + esc(c.condicoes.pagamento) : '') + '</span></div>' +
        prazoBox + pedBox +
        (ped ? '<div class="tk-hero-conta"><small>Responsável</small><b>' + (c.dono ? esc(c.dono.nome) : 'Sem responsável') + '</b><span>' + esc(c.dono ? c.dono.email : '') + '</span></div>'
          : '<div class="tk-hero-conta"><small>Fase</small><b>' + esc(f.nome) + '</b><span>desde ' + esc(C.quando(c.faseEm)) + '</span></div>') +
      '</div>' +
      '<div class="cot-path"><div class="cs-path" id="cot-path">' + path + '</div>' + saidas + '</div>' +
    '</section>';
  }
  function htmlFim(c) {
    if (c.descartado) {
      var d = c.descartado;
      return '<div class="cot-faixa-fim descartada">' + IC.ban + '<div><b>Cotação descartada</b>' + esc(d.motivo || 'registrada por engano') + ' · ' + esc((d.por && d.por.nome) || '') + ' · ' + esc(C.dataBR(d.em, true)) + '. Fica fora das filas e do funil.</div>' +
        '<button type="button" class="cs-btn cs-btn-sm" data-act="restaurar">' + IC.refresh + 'Restaurar</button></div>';
    }
    if (c.fase === 'vencida') {
      var pv = c.perda || {};
      return '<div class="cot-faixa-fim vencida">' + IC.alarm + '<div><b>Vencida' + (c.datas && c.datas.validade ? ' em ' + esc(C.diaBR(c.datas.validade)) : '') + '</b>' +
        (pv.automatica || !(pv.por && pv.por.email) ? 'A data de vencimento passou com a cotação aberta — o portal a descartou sozinho' : 'Marcada como vencida por ' + esc(pv.por.nome || '')) + (pv.em ? ' · ' + esc(C.dataBR(pv.em, true)) : '') +
        '. Fora das filas e do funil em andamento. Para reabrir, atualize a Data de vencimento em Detalhes.</div>' +
        '<button type="button" class="cs-btn cs-btn-sm" data-act="reabrir">' + IC.refresh + 'Reabrir</button></div>';
    }
    if (c.fase !== 'perdida' && c.fase !== 'cancelada') return '';
    var p = c.perda || {};
    return '<div class="cot-faixa-fim ' + c.fase + '">' + (c.fase === 'perdida' ? IC.xc : IC.ban) + '<div><b>' + (c.fase === 'perdida' ? 'Cotação perdida' : 'Cotação cancelada') + (p.motivo ? ' · ' + esc(p.motivo) : '') + '</b>' +
      [p.concorrente ? 'Concorrente: ' + esc(p.concorrente) : '', p.valorConcorrente ? 'Preço do concorrente: ' + C.brl(p.valorConcorrente) : '', p.obs ? esc(p.obs) : '',
        esc((p.por && p.por.nome) || '') + (p.em ? ' · ' + esc(C.dataBR(p.em, true)) : '')].filter(Boolean).join(' · ') + '</div>' +
      '<button type="button" class="cs-btn cs-btn-sm" data-act="reabrir">' + IC.refresh + 'Reabrir</button></div>';
  }

  // o cartão do PEDIDO: soltar o PDF do pedido do portal = a cotação vira pedido
  function htmlPedido(c) {
    if (c.descartado || c.fase === 'perdida' || c.fase === 'vencida' || c.fase === 'cancelada') return '';
    var ped = c.pedido, pi = c.pi || {};
    var temOvs = !!(ped && (c.ovs || []).length);
    var noPi = !!ped && (pi.estado === 'enviado' || pi.estado === 'em_andamento');
    var passo = function (on, txt) { return '<span class="' + (on ? 'on' : '') + '">' + txt + '</span>'; };
    var fluxo = '<div class="cs-pi-fluxo"><span class="on">Cotação</span><i>→</i>' + passo(!!ped, 'Pedido do portal') + '<i>→</i>' + passo(noPi, 'PI · Pedido') + '<i>→</i>' +
      passo(!!ped && (pi.estado === 'enviado' || temOvs), 'Dynamics') + '<i>→</i>' + passo(temOvs, 'Ordem de Venda') + '</div>';
    var h = '<div class="cs-card cot-ped"><h5>' + IC.cart + 'Pedido</h5>' + fluxo;
    if (!ped) {
      return h + '<h4>A cotação virou pedido?</h4><p>Quando o portal gerar o pedido desta cotação, baixe o PDF e solte aqui. A cotação vai para <b>Virou pedido</b>, o portal lê o pedido, compara com o que foi cotado e deixa pronto para o PI · Pedido lançar no Dynamics.</p>' +
        '<label class="cot-drop" id="cot-drop-ped" tabindex="0"><input type="file" id="cot-arq-ped" accept="application/pdf,.pdf" hidden><span class="ic">' + IC.upload + '</span><b>Soltar o PDF do pedido</b><small>ou clique para escolher · .pdf</small></label></div>';
    }
    var arq = '<div class="cs-pi-arq">' + IC.pdf + '<b>' + esc(ped.nome || 'Pedido.pdf') + '</b><button type="button" class="cs-btn cs-btn-xs" data-ver-anexo="' + esc(ped.anexoId) + '">' + IC.eye + 'Ver</button></div>';
    var pv = ped.previa;
    var prev = pv ? '<div class="cs-pi-prev">' +
        '<div><small>Ordem de compra</small><b>' + esc(pv.oc || ped.oc || '—') + '</b></div>' +
        '<div><small>Itens</small><b>' + (pv.itens || (pv.produtos || []).length || 0) + '</b></div>' +
        '<div><small>Total do pedido</small><b>' + (pv.total ? C.brl(pv.total) : '—') + '</b></div>' +
        '<div><small>Do cotado</small><b>' + (pv.total && c.total ? C.pct(pv.total / c.total, 0) : '—') + '</b></div></div>' + htmlComparacao(c) : '';
    if (pi.estado === 'enviado') {
      var e = pi.enviado || {};
      return h + arq + prev + '<div class="lancado">' + IC.checkc + '<div><b>Pedido lançado no Dynamics</b><br>' + esc((e.por && e.por.nome) || '') + ' · ' + esc(C.dataBR(e.em, true)) +
        (e.oc ? '<br>OC ' + esc(e.oc) : '') + (e.cliente ? ' · ' + esc(e.cliente) : '') + (e.total ? '<br>' + C.brl(e.total) + (e.itens ? ' · ' + e.itens + ' item(ns)' : '') : '') + '</div></div>' + htmlOv(c) + '</div>';
    }
    // fechou com a OV lançada fora do PI: o PI não tem mais o que fazer aqui
    if (temOvs) return h + arq + prev + htmlOv(c) + '</div>';
    if (S.lendoPedido[c.numero]) return h + arq + '<p><span class="cs-spin"></span>&nbsp; Lendo o pedido com o leitor do PI…</p></div>';
    var erro = pi.estado === 'erro' ? '<p>Não consegui ler o PDF do pedido: ' + esc(pi.erro || '') + '</p>' : '';
    var andamento = pi.estado === 'em_andamento' ? '<p>Aberto no PI por ' + esc((pi.abertoPor && pi.abertoPor.nome) || '') + ' · ' + esc(C.quando(pi.abertoEm)) + '. Quando o pedido for lançado, este cartão muda sozinho.</p>' : '';
    return h + arq + (pv ? prev : (erro || '<p>PDF do pedido anexado. O portal lê e entrega pronto para o PI conferir e lançar no Dynamics.</p>')) + andamento +
      '<div class="cot-ped-bts"><button type="button" class="cs-btn cs-btn-pi" data-act="abrir-pi">' + IC.cart + (pi.estado === 'em_andamento' ? 'Abrir no PI de novo' : 'Abrir no PI · Pedido') + '</button>' +
      (!pv ? '<button type="button" class="cs-btn cs-btn-sm cs-btn-ghost" data-act="ler-pedido">' + IC.refresh + 'Ler o pedido agora</button>' : '') +
      '<label class="cs-btn cs-btn-sm cs-btn-ghost" style="cursor:pointer">' + IC.upload + 'Trocar o PDF<input type="file" id="cot-arq-ped" accept="application/pdf,.pdf" hidden></label></div>' + htmlOv(c) + '</div>';
  }
  // a ORDEM DE VENDA: a cotação fecha com o número da OV do Dynamics (do PI
  // ou do pedido lançado à mão). O portal confere a OV no Dynamics antes de
  // gravar; pode haver mais de uma (pedido quebrado).
  function htmlOv(c) {
    if (c.descartado || c.fase !== 'pedido' || !c.pedido) return '';
    var ovs = c.ovs || [], num = c.numero, est = S.ovEnvio[num] || {};
    var lancado = c.pi && c.pi.estado === 'enviado';
    var h = '<div class="cot-ov' + (ovs.length ? ' fechada' : '') + '">';
    if (ovs.length) {
      h += '<div class="cot-ov-h">' + IC.lock + '<div><b>Cotação fechada' + (ovs.length > 1 ? ' com ' + ovs.length + ' Ordens de Venda' : ' com a Ordem de Venda') + '</b>' +
        esc((ovs[0].por && ovs[0].por.nome) || '') + ' · ' + esc(C.dataBR(ovs[0].em, true)) + '</div></div>' +
        '<div class="cot-ov-lista">' + ovs.map(function (o) { return htmlOvLinha(c, o); }).join('') + '</div>';
    } else {
      h += '<div class="cot-ov-h">' + IC.tag + '<div><b>' + (lancado ? 'Feche a cotação com a Ordem de Venda' : 'Lançou o pedido direto no Dynamics?') + '</b>' +
        (lancado ? 'Quando o pedido virar Ordem de Venda no Dynamics, informe o número aqui — o portal confere a OV e a cotação fecha.'
          : 'Informe a Ordem de Venda e a cotação fecha sem passar pelo PI. O portal confere a OV no Dynamics.') + '</div></div>';
    }
    var aberto = !ovs.length || S.ovMais[num];
    if (est.estado === 'conferindo') {
      h += '<p class="cot-ov-msg"><span class="cs-spin"></span>&nbsp; Conferindo a ' + esc(est.ov || 'OV') + ' no Dynamics…</p>';
    } else if (aberto) {
      var val = S.ovRascunho[num] != null ? S.ovRascunho[num] : '';
      h += '<div class="cot-ov-form"><input id="cot-ov-num" value="' + esc(val) + '" placeholder="OVBIO144950" autocomplete="off" spellcheck="false" maxlength="24" aria-label="Número da Ordem de Venda">' +
        '<button type="button" class="cs-btn cs-btn-sm cs-btn-pi" data-act="ov-fechar">' + (ovs.length ? IC.plus + 'Adicionar OV' : IC.check + 'Fechar cotação') + '</button>' +
        (ovs.length ? '<button type="button" class="cs-btn cs-btn-sm cs-btn-ghost" data-act="ov-mais-x">Cancelar</button>' : '') + '</div>' +
        (est.estado === 'erro' ? '<p class="cot-ov-msg erro">' + IC.alert + esc(est.msg) + '</p>' : '<p class="cot-ov-msg">OVBIO e os números — ou só os números. Pedido quebrado em mais de uma OV? Adicione as outras depois.</p>');
    } else {
      h += '<div class="cot-ped-bts"><button type="button" class="cs-btn cs-btn-sm cs-btn-ghost" data-act="ov-mais">' + IC.plus + 'Outra OV</button></div>';
    }
    return h + '</div>';
  }
  function htmlOvLinha(c, o) {
    var v = o.dynamics, conf, tom = 'ok';
    if (!v) { conf = 'sem conferência — Dynamics desligado no portal'; tom = 'mut'; }
    else if (v.erro) { conf = 'sem conferência — o Dynamics não respondeu (' + v.erro + ')'; tom = 'mut'; }
    else if (!v.achou) { conf = 'não encontrada no Dynamics — registrada mesmo assim'; tom = 'warn'; }
    else {
      conf = [v.cliente ? 'cliente ' + v.cliente + (v.nome ? ' · ' + v.nome : '') : '', v.oc ? 'OC ' + v.oc : '', v.situacao,
        v.itens ? v.itens + ' item(ns)' : '', v.total ? C.brl(v.total) + (c.total ? ' (' + C.pct(v.total / c.total, 0) + ' do cotado)' : '') : ''].filter(Boolean).join(' · ') || 'encontrada no Dynamics';
      if (o.confirmada) tom = 'warn';
    }
    return '<div class="cot-ov-linha ' + tom + '"><span class="ic">' + (tom === 'warn' ? IC.alert : tom === 'mut' ? IC.info : IC.checkc) + '</span>' +
      '<div class="tx"><b class="cs-mono">' + esc(o.numero) + '</b><small>' + esc(conf) + '</small>' +
      '<small class="quem">' + esc((o.por && o.por.nome) || '') + ' · ' + esc(C.dataBR(o.em, true)) + (o.origem === 'manual' ? ' · lançada fora do PI' : '') + (o.confirmada ? ' · registrada mesmo com o aviso' : '') + '</small></div>' +
      '<button type="button" class="cs-btn cs-btn-xs cs-btn-ghost" data-tirar-ov="' + esc(o.numero) + '" title="Tirar esta OV (registrada por engano)">' + IC.x + '</button></div>';
  }
  function htmlComparacao(c) {
    var pv = c.pedido && c.pedido.previa;
    if (!pv || !(pv.produtos || []).length || !(c.itens || []).length) return '';
    var cmp = C.comparar(c.itens, pv.produtos);
    var st = { ok: ['ok', 'igual'], dif: ['dif', 'diferente'], fora: ['fora', 'não pedido'], extra: ['extra', 'fora da cotação'] };
    var linhas = cmp.linhas.slice(0, 14).map(function (l) {
      var x = l.cot || l.ped, nome = (l.cot && l.cot.descricao) || (l.ped && l.ped.descricao) || (x && x.codigo) || '';
      var cotTxt = l.cot ? C.qtd(l.cot.quantidade) + ' × ' + C.brl(l.cot.valorUnitario) : '—';
      var pedTxt = l.ped ? C.qtd(l.ped.quantidade) + ' × ' + C.brl(l.ped.valorUnitario) : '—';
      var obs = l.st === 'dif' ? [!l.mesmaQtd ? 'qtd' : '', !l.mesmoPreco ? 'preço' : ''].filter(Boolean).join(' e ') + ' mudou' : '';
      var tag = '<span class="st ' + st[l.st][0] + '">' + st[l.st][1] + '</span>';
      return '<tr><td>' + esc(nome) + tag.replace('class="st ', 'class="st st-m ') + (obs ? '<small>' + esc(obs) + '</small>' : '') + '</td>' +
        '<td class="n" data-l="Cotado">' + cotTxt + '</td><td class="n" data-l="Pedido">' + pedTxt + '</td><td class="st-c">' + tag + '</td></tr>';
    }).join('');
    return '<div class="cot-cmp"><div class="cot-cmp-h">Cotação × pedido' +
      (cmp.ok ? '<span class="tag ok">' + cmp.ok + ' igual(is)</span>' : '') + (cmp.dif ? '<span class="tag dif">' + cmp.dif + ' com diferença</span>' : '') +
      (cmp.fora ? '<span class="tag fora">' + cmp.fora + ' não pedido(s)</span>' : '') + (cmp.extra ? '<span class="tag fora">' + cmp.extra + ' fora da cotação</span>' : '') + '</div>' +
      '<table><thead><tr><th>Item</th><th style="text-align:right">Cotado</th><th style="text-align:right">Pedido</th><th></th></tr></thead><tbody>' + linhas + '</tbody></table></div>';
  }

  // o cartão da PROPOSTA: o PDF no modelo da Biomedical (cotacoes-proposta.js)
  // com os dados do caso e de quem está logado; sai pelo Outlook da pessoa
  function htmlProposta(c) {
    if (c.descartado || !W.COTPROP) return '';
    var envios = (c.propostas || []).slice().reverse(), ult = envios[0];
    var est = S.propEnvio[c.numero] || {};
    var para = S.propPara[c.numero] != null ? S.propPara[c.numero] : ((c.contato && c.contato.email) || (ult && (ult.para || []).join(', ')) || '');
    var fechada = !C.aberta(c.fase) && c.fase !== 'pedido';
    var h = '<div class="cs-card cot-prop-card"><h5>' + IC.pdf + 'Proposta' + (ult ? '<span class="cs-chip prazo-ok" style="margin-left:6px">' + IC.check + 'enviada</span>' : '') + '</h5>';
    if (ult) {
      h += '<div class="cot-prop-ult">' + IC.checkc + '<div><b>Enviada para ' + esc((ult.para || []).join(', ')) + '</b>' + esc((ult.por && ult.por.nome) || '') + ' · ' + esc(C.dataBR(ult.em, true)) +
        (envios.length > 1 ? ' · ' + envios.length + ' envios' : '') + '</div>' +
        (ult.anexoId ? '<button type="button" class="cs-btn cs-btn-xs" data-ver-anexo="' + esc(ult.anexoId) + '">' + IC.eye + 'PDF enviado</button>' : '') + '</div>';
    } else {
      h += '<p>A proposta no modelo da Biomedical — dados desta cotação e os seus no "Preparado por" — pronta para o comprador.' + (fechada ? ' A cotação está ' + esc(C.fase(c.fase).nome.toLowerCase()) + '.' : '') + '</p>';
    }
    if (est.estado === 'enviando') return h + '<p><span class="cs-spin"></span>&nbsp; Gerando o PDF e enviando pelo seu Outlook…</p></div>';
    if (est.estado === 'erro') h += '<div class="cot-envio erro" style="margin:8px 0">' + IC.alert + '<div><b>A proposta não foi enviada</b>' + esc(est.msg) + '</div></div>';
    return h + '<div class="cot-prop-acoes"><input id="cot-prop-para" value="' + esc(para) + '" placeholder="e-mail do comprador" autocomplete="off">' +
      '<button type="button" class="cs-btn cs-btn-sm" data-act="prop-ver">' + IC.eye + 'Ver</button>' +
      '<button type="button" class="cs-btn cs-btn-sm cs-btn-p" data-act="prop-enviar">' + IC.arrow + (ult ? 'Reenviar' : 'Enviar proposta') + '</button></div></div>';
  }
  function operador(c) {
    var eu = S.eu || {};
    return { nome: eu.nome || '', email: eu.email || '', area: (c && c.area) || eu.area || eu.departamento || '', telefone: C.formatar('fone', C.lerLocal('cot-prop-tel') || eu.telefone || '') };
  }
  function verProposta(c) {
    var janela = W.open('', '_blank');
    if (janela) { try { janela.document.title = 'Proposta ' + c.numero; janela.document.body.innerHTML = '<p style="font:15px system-ui;padding:40px;color:#0A2447">Gerando a proposta…</p>'; } catch (e) {} }
    W.COTPROP.gerar(c, operador(c)).then(function (pdf) {
      var url = URL.createObjectURL(pdf.blob);
      if (janela && !janela.closed) janela.location.href = url; else W.open(url, '_blank');
      setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
    }).catch(function (e) { if (janela && !janela.closed) janela.close(); C.toast('Não consegui gerar a proposta', e.message, 'erro'); });
  }
  function enviarProposta(c) {
    var P = W.COTPROP, num = c.numero;
    var para = P.listaEmails(S.propPara[num] != null ? S.propPara[num] : ((c.contato && c.contato.email) || ''));
    if (!para.length) { S.propEnvio[num] = { estado: 'erro', msg: 'Informe o e-mail do comprador.' }; renderCaso(); return; }
    S.propEnvio[num] = { estado: 'enviando' }; renderCaso();
    // o token no clique (o consentimento da primeira vez abre um popup)
    P.autorizar().then(function () { return P.enviar(c, operador(c), { para: para }); }).then(function (r) {
      S.propEnvio[num] = {};
      if (r.caso) mesclar(r.caso);
      C.toast('Proposta enviada', para.join(', ') + (r.erroRegistro ? ' — não registrou no caso: ' + r.erroRegistro : ''), r.erroRegistro ? 'erro' : 'ok');
      renderTudo();
    }).catch(function (e) {
      S.propEnvio[num] = { estado: 'erro', msg: e.message || String(e) };
      renderCaso();
    });
  }

  function htmlItens(c) {
    if (S.editandoItens) {
      var its = S.itensRascunho || [];
      return '<div class="cs-card"><h5>' + IC.list + 'Itens cotados · editando</h5>' +
        '<div class="cot-itens-w"><table class="cot-itens"><thead><tr><th class="cod">Cód. Biomedical</th><th class="codc">Cód. comprador</th><th>Descrição</th><th class="marca">Fabricante</th><th class="rms">RMS</th><th class="un">Un</th><th class="qtd n">Qtd</th><th class="vu n">Preço unit.</th><th class="vt n">Total</th><th class="x"></th></tr></thead><tbody>' +
        its.map(function (it, i) {
          var ruim = it._cod && (it._cod.st === 'nao' || (it._cod.st === 'vazio' && Number(it.valorUnitario) > 0));
          return '<tr data-i="' + i + '"' + (ruim ? ' class="cod-nao"' : it._cod && it._cod.st === 'ok' ? ' class="cod-ok"' : '') + '><td class="cod"><input data-f="codigo" value="' + esc(it.codigo) + '" autocomplete="off"><span class="cod-st-box">' + C.statusCodigo(it) + '</span></td><td class="codc"><input data-f="codigoCliente" value="' + esc(it.codigoCliente) + '"></td>' +
            '<td><input data-f="descricao" value="' + esc(it.descricao) + '"></td><td class="marca"><input data-f="marca" value="' + esc(it.marca) + '" placeholder="Fabricante"></td><td class="rms"><input data-f="registro" value="' + esc(it.registro || '') + '" placeholder="ANVISA" inputmode="numeric"></td><td class="un"><input data-f="unidade" value="' + esc(it.unidade) + '"></td>' +
            '<td class="qtd n"><input data-f="quantidade" inputmode="decimal" value="' + esc(it.quantidade ? C.qtd(it.quantidade) : '') + '"></td>' +
            '<td class="vu n"><input data-f="valorUnitario" inputmode="decimal" value="' + esc(it.valorUnitario ? it.valorUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '') + '"></td>' +
            '<td class="vt tot" data-tot="' + i + '">' + (it.quantidade && it.valorUnitario ? C.brl(it.quantidade * it.valorUnitario) : '—') + '</td>' +
            '<td class="x"><button type="button" class="cs-btn cs-btn-xs cs-btn-ghost" data-tirar-item="' + i + '" title="Tirar">' + IC.x + '</button></td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="cot-itens-pe"><button type="button" class="cs-btn cs-btn-sm" data-act="item-mais">' + IC.plus + 'Item</button><span class="tot">Total<b id="cot-itens-total">' + C.brl(totalDe(its)) + '</b></span></div>' +
        '<div class="cot-comp-pe"><button type="button" class="cs-btn cs-btn-sm" data-act="itens-cancelar">Cancelar</button><button type="button" class="cs-btn cs-btn-sm cs-btn-p" data-act="itens-salvar">' + IC.check + 'Salvar itens</button></div></div>';
    }
    var l = c.itens || [];
    return '<div class="cs-card"><h5>' + IC.list + 'Itens cotados · ' + l.length + (c.descartado ? '' : '<button type="button" class="cs-btn cs-btn-xs" data-act="itens-editar">' + IC.edit + 'Editar</button>') + '</h5>' +
      (l.length ? '<div class="cot-itens-w"><table class="cot-itens ler"><thead><tr><th>Produto</th><th>Un</th><th class="n">Qtd</th><th class="n">Preço unit.</th><th class="n">Total</th></tr></thead><tbody>' +
        l.map(function (it) {
          var cods = [it.codigo, it.codigoCliente ? 'comprador ' + it.codigoCliente : '', it.marca, it.registro ? 'RMS ' + it.registro : ''].filter(Boolean).join(' · ');
          return '<tr><td class="desc"><b>' + esc(it.descricao || it.codigo || '—') + '</b>' + (cods ? '<small>' + esc(cods) + '</small>' : '') + '</td><td class="un">' + esc(it.unidade || '') + '</td>' +
            '<td class="n qtd">' + C.qtd(it.quantidade) + '</td><td class="n vu">' + (it.valorUnitario ? C.brl(it.valorUnitario) : '<span style="color:var(--cs-mut)">sem preço</span>') + '</td>' +
            '<td class="n tot">' + (it.quantidade && it.valorUnitario ? C.brl(it.quantidade * it.valorUnitario) : '—') + '</td></tr>';
        }).join('') + '</tbody><tfoot><tr><td colspan="4" class="rot">Total cotado</td><td class="n tot">' + C.brl(c.total) + '</td></tr></tfoot></table></div>'
        : '<p style="margin:0;font-size:13px;color:var(--cs-mut)">Nenhum item registrado. Clique em Editar para incluir.</p>') + '</div>';
  }
  function totalDe(its) { return (its || []).reduce(function (s, it) { return s + (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0); }, 0); }

  var RAPIDAS = ['Cobrei o comprador sobre o resultado', 'Comprador pediu desconto', 'Enviei contraproposta no portal', 'Resultado sai em breve', 'Ajustei prazo de entrega'];
  function htmlNotas(c) {
    var l = (c.notas || []).slice().reverse();
    return '<div class="cs-card"><h5>' + IC.note + 'Tramitação · ' + l.length + ' nota(s)</h5>' +
      (l.length ? '<div class="cot-notas">' + l.map(function (n) {
        return '<div class="cot-nota">' + C.avatar(n.por && n.por.nome, n.por && n.por.email, 'p') + '<div class="bx"><small><b>' + esc((n.por && n.por.nome) || '') + '</b> · ' + esc(C.dataBR(n.em, true)) + '</small>' + esc(n.texto) + '</div></div>';
      }).join('') + '</div>' : '<p style="margin:0;font-size:13px;color:var(--cs-mut)">Registre aqui cada passo da cotação: contato com o comprador, contraproposta, prazo combinado…</p>') +
      (c.descartado ? '' : '<div class="cot-comp"><div class="cot-rapidas">' + RAPIDAS.map(function (r) { return '<button type="button" data-rapida="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') + '</div>' +
        '<textarea id="cot-nota" placeholder="O que aconteceu com esta cotação? (fica no histórico, com o seu nome)">' + esc(S.rascunho[c.numero] || '') + '</textarea>' +
        '<div class="cot-comp-pe"><span class="dica">Ctrl+Enter registra</span><button type="button" class="cs-btn cs-btn-sm cs-btn-p" data-act="nota">' + IC.check + 'Registrar nota</button></div></div>') + '</div>';
  }

  // campo editável (clique -> input) — o mesmo jeito do Customer Service
  function ed(campo, valor, tipo, opcoes, mostrar) {
    var v = valor == null || valor === '' ? '<span class="vazio">—</span>' : esc(mostrar != null ? mostrar : valor);
    if (S.caso && S.caso.descartado) return v;
    return '<span class="cs-edit" data-edit="' + campo + '" data-tipo="' + (tipo || 'texto') + '"' + (opcoes ? ' data-op="' + esc(JSON.stringify(opcoes)) + '"' : '') + ' data-valor="' + esc(valor || '') + '">' + v + '</span>';
  }
  // a validade em dias = data de vencimento − data da cotação
  function diasValidade(dt) {
    var a = C.dataPortal(dt && dt.cotacao), b = C.dataPortal(dt && dt.validade);
    if (!a || !b) return '—';
    var n = Math.round((b.getTime() - a.getTime()) / 86400e3);
    return n + (n === 1 || n === -1 ? ' dia' : ' dias');
  }
  // o comprador no Dynamics (o retrato que o caso guardou ao nascer / no último "buscar")
  function htmlErpCaso(c) {
    var v = c.erp, bt = c.descartado ? '' : ' <button type="button" class="cs-btn cs-btn-xs cs-btn-ghost" data-act="erp" title="Procurar o CNPJ no Dynamics de novo">' + IC.refresh + 'Buscar</button>';
    if (!v) return '<span class="vazio">não consultado</span>' + bt;
    if (v.erro) return '<span class="vazio">não consultado (' + esc(v.erro) + ')</span>' + bt;
    if (!v.achou) return '<span class="vazio">CNPJ não encontrado — cliente novo</span>' + bt;
    return esc([v.codigo, (v.empresas || []).join('/') || v.empresa, v.grupo, v.pagamento ? 'cond. ' + v.pagamento : ''].filter(Boolean).join(' · ')) +
      (v.bloqueado ? ' <span class="cs-chip prazo-vencido">bloqueado (' + esc(v.bloqueio) + ')</span>' : '') + bt;
  }
  function htmlLado(c) {
    var cfg = S.cfg || {}, cli = c.cliente || {}, ct = c.contato || {}, dt = c.datas || {}, co = c.condicoes || {};
    var det = '<div class="cs-card"><h5>' + IC.info + 'Detalhes da cotação</h5><dl class="cs-kv">' +
      '<dt>Número</dt><dd class="cs-mono">' + esc(c.numero) + '</dd>' +
      '<dt>Fase</dt><dd>' + esc(C.fase(c.fase).nome) + ' <span class="vazio">desde ' + esc(C.dataBR(c.faseEm)) + '</span></dd>' +
      '<dt>Portal</dt><dd>' + ed('portal', c.portal, 'lista', (cfg.portais || []).concat(c.portal && (cfg.portais || []).indexOf(c.portal) < 0 ? [c.portal] : [])) + '</dd>' +
      '<dt>Nº da cotação</dt><dd class="cs-mono">' + ed('cotacaoId', c.cotacaoId) + '</dd>' +
      '<dt>Empresa</dt><dd>BIO</dd>' +
      '<dt>Área</dt><dd>' + ed('area', c.area) + (c.equipe ? '<br><span class="vazio" title="equipe de segurança de quem registrou">' + esc(c.equipe) + '</span>' : '') + '</dd>' +
      '<dt>Data da cotação</dt><dd>' + ed('datas.cotacao', dt.cotacao, 'data', null, C.diaBR(dt.cotacao)) + '</dd>' +
      '<dt>Data de vencimento</dt><dd>' + ed('datas.validade', dt.validade, 'data', null, C.diaBR(dt.validade)) + (dt.validade && C.venceu(dt.validade) ? ' <span class="cs-chip prazo-vencido">vencida</span>' : '') + '</dd>' +
      '<dt>Validade</dt><dd>' + esc(diasValidade(dt)) + ' <span class="vazio">(vencimento − data da cotação)</span></dd>' +
      '<dt>Responsável</dt><dd>' + (c.dono ? esc(c.dono.nome) : '<span class="vazio">sem responsável</span>') + '</dd>' +
      '<dt>Registrada</dt><dd>' + esc(C.dataBR(c.criadoEm, true)) + (c.criadoPor ? '<br><span class="vazio">' + esc(c.criadoPor.nome) + '</span>' : '') + '</dd>' +
      (c.fechadoEm ? '<dt>Fechada</dt><dd>' + esc(C.dataBR(c.fechadoEm, true)) + '</dd>' : '') +
      ((c.ovs || []).length ? '<dt>Ordem de Venda</dt><dd class="cs-mono">' + c.ovs.map(function (o) { return esc(o.numero); }).join('<br>') + '</dd>' : '') +
      '</dl></div>';
    var comp = '<div class="cs-card"><h5>' + IC.building + 'Comprador</h5><dl class="cs-kv">' +
      '<dt>Cliente</dt><dd>' + ed('cliente.nome', cli.nome) + '</dd>' +
      '<dt>CNPJ</dt><dd class="cs-mono">' + ed('cliente.cnpj', cli.cnpj, 'cnpj', null, C.cnpjMask(cli.cnpj)) + '</dd>' +
      '<dt>Código ERP</dt><dd class="cs-mono">' + ed('cliente.codigo', cli.codigo) + '</dd>' +
      '<dt>Dynamics</dt><dd>' + htmlErpCaso(c) + '</dd>' +
      '<dt>Endereço</dt><dd>' + ed('cliente.endereco', cli.endereco) + '</dd>' +
      '<dt>CEP</dt><dd>' + ed('cliente.cep', cli.cep, 'cep', null, C.formatar('cep', cli.cep)) +
        (C.avisoCepUf(cli.cep, cli.uf) ? ' <span class="vazio" style="color:var(--bm3-amber-800,#8A4B00)">' + esc(C.avisoCepUf(cli.cep, cli.uf)) + '</span>' : '') + '</dd>' +
      '<dt>Cidade</dt><dd>' + ed('cliente.cidade', cli.cidade) + '</dd>' +
      '<dt>UF</dt><dd>' + ed('cliente.uf', cli.uf, 'lista', C.UFS) + '</dd>' +
      '<dt>Contato</dt><dd>' + ed('contato.nome', ct.nome) + '</dd>' +
      '<dt>E-mail</dt><dd>' + ed('contato.email', ct.email, 'email') + (ct.email ? ' <a href="mailto:' + esc(ct.email) + '" title="Escrever">' + IC.arrow + '</a>' : '') + '</dd>' +
      '<dt>Telefone</dt><dd>' + ed('contato.telefone', ct.telefone, 'fone', null, C.formatar('fone', ct.telefone)) + '</dd>' +
      '</dl></div>';
    var cond = '<div class="cs-card"><h5>' + IC.tag + 'Condições ofertadas</h5><dl class="cs-kv">' +
      '<dt>Pagamento</dt><dd>' + ed('condicoes.pagamento', co.pagamento) + '</dd>' +
      '<dt>Observação</dt><dd>' + ed('condicoes.observacao', co.observacao, 'area') + '</dd>' +
      '</dl></div>';
    var anexos = (c.anexos || []).filter(function (a) { return !a.removido; });
    var anx = '<div class="cs-card"><h5>' + IC.clip + 'Anexos · ' + anexos.length + '</h5><div class="cot-anexos">' +
      anexos.map(function (a) {
        var emUso = c.pedido && c.pedido.anexoId === a.id;
        return '<div class="cot-anexo ' + esc(a.tipo) + '"><span class="ic">' + (a.tipo === 'outro' ? IC.clip : IC.pdf) + '</span><span class="tx"><b title="' + esc(a.nome) + '">' + esc(a.nome) + '</b><small>' +
          esc({ cotacao: 'PDF da cotação', pedido: 'PDF do pedido', proposta: 'proposta enviada', outro: 'anexo' }[a.tipo] || 'anexo') + (a.tamanho ? ' · ' + C.bytes(a.tamanho) : '') + ' · ' + esc((a.por && C.primeiroNome(a.por.nome)) || '') + ' ' + esc(C.dataBR(a.em)) + '</small></span>' +
          '<button type="button" class="cs-btn cs-btn-xs" data-ver-anexo="' + esc(a.id) + '" title="Abrir">' + IC.eye + '</button>' +
          (emUso || c.descartado ? '' : '<button type="button" class="cs-btn cs-btn-xs cs-btn-ghost" data-tirar-anexo="' + esc(a.id) + '" title="Tirar do caso">' + IC.x + '</button>') + '</div>';
      }).join('') +
      (c.descartado ? '' : '<label class="cot-anexo-add" id="cot-anexo-add">' + IC.plus + 'Anexar arquivo<input type="file" id="cot-arq-outro" hidden></label>') + '</div></div>';
    var l = c.leitura;
    var temPdfCot = anexos.some(function (a) { return a.tipo === 'cotacao'; });
    var ia = (l || temPdfCot) ? '<div class="cs-card cot-ia"><h5>' + IC.sparkle + 'Leitura da IA</h5>' +
      (l && l.ia ? '<p>A IA leu ' + esc(l.arquivo || 'o PDF') + ' ' + esc(C.quando(l.em)) + (l.modelo ? ' (' + esc(l.modelo) + ')' : '') + '.</p>' : (l && l.erro ? '<p>' + esc(l.erro) + '</p>' : '<p>Cotação preenchida à mão.</p>')) +
      (l && (l.avisos || []).length ? '<ul>' + l.avisos.map(function (a) { return '<li>' + esc(a.texto) + '</li>'; }).join('') + '</ul>' : '') +
      (temPdfCot && !c.descartado ? '<button type="button" class="cs-btn cs-btn-xs" data-act="reler">' + IC.refresh + 'Ler o PDF da cotação de novo</button>' : '') + '</div>' : '';
    var hist = '<details class="cs-card tk-hist"><summary><h5>' + IC.hist + 'Histórico · ' + (c.historico || []).length + '</h5></summary>' + htmlHist(c) + '</details>';
    return det + comp + cond + anx + ia + hist +
      (c.descartado ? '' : '<button type="button" class="cs-btn cs-btn-sm cs-btn-ghost cs-btn-perigo" data-act="descartar" style="align-self:flex-start">' + IC.trash + 'Descartar (registrada por engano)</button>');
  }
  function htmlHist(c) {
    var l = (c.historico || []).slice().reverse().slice(0, 60);
    var cor = { criado: '#1A66D2', fase: '#5A3BC4', nota: '#D97706', pi: '#5A3BC4', pedido: '#138A4B', anexo: '#0891B2', ia: '#C026D3', campo: '#8DBBF5', proposta: '#0E7490', erp: '#0F766E', ov: '#138A4B' };
    return '<ul class="cs-hist">' + l.map(function (h) {
      var corpo = (h.tipo === 'campo' || h.tipo === 'fase')
        ? '<b>' + esc(h.campo) + '</b>: ' + (h.de ? '<span class="de">' + esc(h.de) + '</span> → ' : '') + '<span class="para">' + esc(h.para || '—') + '</span>' + (h.texto ? '<br>' + esc(h.texto) : '')
        : esc(h.texto || '');
      return '<li style="--c:' + (cor[h.tipo] || '#8DBBF5') + '">' + corpo + '<small>' + esc((h.por && h.por.nome) || 'Portal') + ' · ' + esc(C.dataBR(h.em, true)) + '</small></li>';
    }).join('') + '</ul>';
  }

  function renderCaso() {
    var box = $('cot-caso'); if (!box) return;
    var c = S.caso;
    mostrarCaso(!!c);
    if (!c) { box.innerHTML = ''; return; }
    var l = lista(), pos = l.findIndex(function (x) { return x.numero === c.numero; });
    var meu = eMeu(c);
    box.setAttribute('data-num', c.numero);
    box.innerHTML =
      '<div class="tk-topo">' +
        '<button type="button" class="cs-btn cs-btn-sm" data-act="voltar">' + IC.back + 'Cotações</button>' +
        (pos >= 0 ? '<span class="tk-nav"><button type="button" class="cs-btn cs-btn-sm cs-ico-btn" data-nav="-1" title="Anterior (K)"' + (pos <= 0 ? ' disabled' : '') + '>' + IC.chevL + '</button>' +
          '<span>' + (pos + 1) + ' de ' + l.length + '</span><button type="button" class="cs-btn cs-btn-sm cs-ico-btn" data-nav="1" title="Próxima (J)"' + (pos >= l.length - 1 ? ' disabled' : '') + '>' + IC.chevR + '</button></span>' : '') +
        '<div class="tk-acoes">' + (c.descartado ? '' :
          (c.dono ? (meu ? '<button type="button" class="cs-btn cs-btn-sm" data-act="liberar" title="Devolver para a fila">' + IC.userx + 'Liberar</button>' : '<button type="button" class="cs-btn cs-btn-sm" data-act="assumir">' + IC.user + 'Assumir</button>')
            : '<button type="button" class="cs-btn cs-btn-sm cs-btn-p" data-act="assumir">' + IC.user + 'Assumir</button>') +
          '<button type="button" class="cs-btn cs-btn-sm" data-act="atribuir">' + IC.users + 'Atribuir</button>' +
          (C.aberta(c.fase) ? '<button type="button" class="cs-btn cs-btn-sm cs-btn-azul" data-act="virou-pedido">' + IC.trophy + 'Virou pedido</button>' : '')) +
        '</div>' +
      '</div>' +
      htmlHero(c) + htmlFim(c) +
      '<div class="tk-grid"><div class="tk-main">' + (c.fase === 'pedido' ? htmlPedido(c) + htmlProposta(c) : htmlProposta(c) + htmlPedido(c)) + htmlItens(c) + htmlNotas(c) + '</div>' +
      '<aside class="tk-lado">' + htmlLado(c) + '</aside></div>';
    C.quieto(box);
  }

  /* ── pedido: anexar, ler, mandar para o PI ──────────────────── */
  function anexarPedido(c, file, extra) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name || '') && !/pdf/i.test(file.type || '')) { C.toast('Só PDF', 'O pedido precisa ser o PDF que o portal gerou.', 'erro'); return; }
    var numero = c.numero;
    S.lendoPedido[numero] = true; renderCaso();
    C.lerArquivo(file).then(function (arq) {
      return C.api('cot-casos', Object.assign({ acao: 'pedido', numero: numero, anexo: { nome: arq.nome, tipo: 'application/pdf', base64: arq.base64 } }, extra || {})).then(function (j) {
        mesclar(j.caso); if (S.caso && S.caso.numero === numero) S.caso = j.caso;
        C.toast('Cotação virou pedido', j.caso.numero + ' · lendo o pedido…', 'ok');
        return lerPedido(j.caso, arq);
      });
    }).catch(function (e) {
      S.lendoPedido[numero] = false; renderTudo();
      C.toast('Não consegui anexar o pedido', e.message, 'erro');
    });
  }
  // lê o PDF do pedido com o leitor do PI (o PI recebe a leitura pronta)
  function lerPedido(c, arq) {
    var numero = c.numero;
    if (!C.leitorPronto()) { S.lendoPedido[numero] = false; renderTudo(); return Promise.resolve(); }
    S.lendoPedido[numero] = true; renderTudo();
    var pronto = arq ? Promise.resolve(arq) : C.baixarAnexo(numero, c.pedido.anexoId).then(function (a) { a.buffer = C.b64ParaBytes(a.base64).buffer; return a; });
    var arquivo = null;
    return pronto.then(function (a) {
      arquivo = a;
      return C.textoDoPdf(a.buffer);
    }).then(function (texto) {
      if (!texto || texto.trim().length < 40) throw new Error('o PDF parece escaneado (imagem, sem texto) — o PI vai pedir o preenchimento manual');
      return C.lerComIA(texto, arquivo.nome);
    }).then(function (r) {
      var d = (r && r.dados) || {};
      S.leiturasPedido[numero] = { dados: d, avisos: (r && r.avisos) || [] };
      var prods = d.produtos || [];
      var total = prods.reduce(function (s, p) { return s + (Number(p.quantidade) || 0) * (Number(p.valorUnitario) || 0); }, 0);
      return C.api('cot-casos', { acao: 'pi', numero: numero, estado: 'lido', previa: {
        cnpj: d.cnpj || '', cliente: d.nomeCliente || '', oc: d.ordemDeCompra || '', itens: prods.length, total: total,
        condicao: d.condicaoPagamento || '', email: d.email || '',
        produtos: prods.slice(0, 120).map(function (p) { return { codigo: p.codigo, descricao: p.descricao, quantidade: p.quantidade, valorUnitario: p.valorUnitario }; })
      } });
    }).then(function (j) {
      S.lendoPedido[numero] = false;
      if (j && j.caso) mesclar(j.caso);
      renderTudo();
    }).catch(function (e) {
      S.lendoPedido[numero] = false;
      C.api('cot-casos', { acao: 'pi', numero: numero, estado: 'erro', erro: String(e.message || e).slice(0, 280) })
        .then(function (j) { if (j && j.caso) mesclar(j.caso); renderTudo(); }).catch(function () { renderTudo(); });
    });
  }
  // ao abrir um caso com pedido ainda não lido, lê sozinho (como o Customer Service)
  function preLerPedido(c) {
    if (!c || c.fase !== 'pedido' || !c.pedido || c.descartado) return;
    if (c.pedido.previa || S.lendoPedido[c.numero] || (c.pi && (c.pi.estado === 'enviado' || c.pi.estado === 'erro'))) return;
    lerPedido(c);
  }
  function registrarOv(c, forcar, valor) {
    var num = c.numero;
    var n = C.numeroOv(valor != null ? valor : (S.ovRascunho[num] || ''));
    if (!n) {
      S.ovEnvio[num] = { estado: 'erro', msg: 'Número da Ordem de Venda inválido — use OVBIO seguido dos números (ex.: OVBIO144950).' };
      renderCaso(); var i = $('cot-ov-num'); if (i) i.focus();
      return;
    }
    if (S.enviando) return;
    S.enviando = true; S.ovEnvio[num] = { estado: 'conferindo', ov: n }; renderCaso();
    var primeira = !(c.ovs || []).length;
    C.api('cot-casos', { acao: 'ov', numero: num, ov: n, forcar: !!forcar }).then(function (j) {
      S.enviando = false; S.ovEnvio[num] = {}; S.ovRascunho[num] = ''; S.ovMais[num] = false;
      if (j && j.caso) { mesclar(j.caso); if (S.caso && S.caso.numero === num) S.caso = j.caso; }
      renderTudo();
      var o = j && j.caso && (j.caso.ovs || []).filter(function (x) { return x.numero === n; })[0];
      var v = o && o.dynamics;
      C.toast(primeira ? 'Cotação fechada' : 'OV adicionada', n + (v && v.achou ? ' · conferida no Dynamics' : ' · sem conferência no Dynamics'), 'ok');
    }).catch(function (e) {
      S.enviando = false;
      // OV que não existe, de outro cliente ou já em outra cotação: a pessoa confere
      if (e.status === 409 && e.corpo && e.corpo.confirmar) { S.ovEnvio[num] = {}; S.ovRascunho[num] = n; renderCaso(); dlgConfirmarOv(c, n, e.corpo.avisos || [e.message]); return; }
      S.ovEnvio[num] = { estado: 'erro', msg: e.message }; renderCaso();
    });
  }
  function dlgConfirmarOv(c, n, avisos) {
    C.dialogo('<h3>Confira a Ordem de Venda</h3><p>Antes de fechar ' + esc(c.numero) + ' com a <b>' + esc(n) + '</b>:</p>' +
      '<ul class="cot-ov-avisos">' + avisos.map(function (a) { return '<li>' + esc(a.charAt(0).toUpperCase() + a.slice(1)) + '</li>'; }).join('') + '</ul>' +
      '<p>Se o número está certo, registre mesmo assim (fica marcado no histórico).</p>' +
      '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Corrigir o número</button><button class="cs-btn cs-btn-p" value="ok" id="dlg-ok">Registrar mesmo assim</button></div>',
      function () {
        $('dlg-ok').addEventListener('click', function () { C.fecharDialogo(); registrarOv(c, true, n); });
      });
  }
  function dlgTirarOv(c, n) {
    var ultima = (c.ovs || []).length === 1;
    C.dialogo('<h3>Tirar a ' + esc(n) + ' da cotação?</h3><p>Use quando o número foi registrado por engano. A saída fica no histórico' + (ultima ? ' e a cotação volta a aguardar a OV' : '') + '.</p>' +
      '<div class="cs-campo"><label>Motivo (opcional)</label><input id="dlg-motivo-ov" placeholder="ex.: digitei o número errado" autocomplete="off"></div>' +
      '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Voltar</button><button class="cs-btn cs-btn-perigo" value="ok" id="dlg-ok">Tirar a OV</button></div>',
      function () {
        $('dlg-ok').addEventListener('click', function () {
          var m = $('dlg-motivo-ov').value;
          C.fecharDialogo();
          acao({ acao: 'removerOv', numero: c.numero, ov: n, motivo: m }, 'OV tirada da cotação').catch(function () {});
        });
      });
  }
  function abrirPI(c) {
    C.abrirNoPI(c, S.leiturasPedido[c.numero]).then(function (j) {
      if (j && j.caso) { mesclar(j.caso); renderTudo(); }
    });
  }

  /* ── diálogos ───────────────────────────────────────────────── */
  function opcoes(l, sel) { return (l || []).map(function (o) { return '<option' + (o === sel ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join(''); }
  function dlgPerda(c, faseAlvo) {
    var perdida = faseAlvo === 'perdida', cfg = S.cfg || {};
    var l = perdida ? cfg.motivosPerda : cfg.motivosCancelamento;
    C.dialogo('<h3>' + (perdida ? 'Cotação perdida' : 'Cancelar a cotação') + '</h3><p>' + esc(c.numero) + ' · ' + esc(C.tituloCaso(c)) + '. ' + (perdida ? 'O motivo alimenta o funil (por que perdemos).' : 'Fica fora do funil em andamento.') + '</p>' +
      '<div class="cs-campo"><label>Motivo' + (perdida ? ' *' : '') + '</label><select id="dlg-motivo"><option value="">Escolha…</option>' + opcoes(l) + '</select></div>' +
      (perdida ? '<div class="cot-grade" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="cs-campo"><label>Concorrente (se souber)</label><input id="dlg-conc" placeholder="quem ganhou"></div>' +
        '<div class="cs-campo"><label>Preço do concorrente</label><input id="dlg-vconc" inputmode="decimal" placeholder="R$"></div></div>' : '') +
      '<div class="cs-campo"><label>Observação</label><textarea id="dlg-obs" rows="2"></textarea></div>' +
      '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Voltar</button><button class="cs-btn ' + (perdida ? 'cs-btn-perigo' : 'cs-btn-p') + '" value="ok" id="dlg-ok">' + (perdida ? 'Marcar como perdida' : 'Cancelar a cotação') + '</button></div>',
      function () {
        $('dlg-ok').addEventListener('click', function (ev) {
          var m = $('dlg-motivo').value;
          if (perdida && !m) { ev.preventDefault(); C.toast('Escolha o motivo', '', 'erro'); return; }
          C.fecharDialogo();
          acao({ acao: 'fase', numero: c.numero, fase: faseAlvo, motivo: m, obs: $('dlg-obs').value, concorrente: perdida ? $('dlg-conc').value : '', valorConcorrente: perdida ? $('dlg-vconc').value : '' },
            perdida ? 'Cotação marcada como perdida' : 'Cotação cancelada').catch(function () {});
        });
      });
  }
  function dlgPedido(c) {
    C.dialogo('<h3>A cotação virou pedido</h3><p>Anexe o PDF do pedido que o portal gerou — ele fica no caso e segue para o PI · Pedido.</p>' +
      '<label class="cot-drop" id="dlg-drop" style="min-height:130px"><input type="file" id="dlg-arq" accept="application/pdf,.pdf" hidden><span class="ic">' + IC.upload + '</span><b id="dlg-arq-nome">Escolher o PDF do pedido</b><small>.pdf do portal</small></label>' +
      '<div class="cs-campo" style="margin-top:12px"><label>Nº da ordem de compra (opcional — o portal lê do PDF)</label><input id="dlg-oc" autocomplete="off"></div>' +
      '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Voltar</button><button class="cs-btn cs-btn-azul" value="ok" id="dlg-ok" disabled>' + IC.trophy + 'Virou pedido</button></div>',
      function () {
        var arq = null;
        function escolher(f) { if (!f) return; arq = f; $('dlg-arq-nome').textContent = f.name; $('dlg-ok').disabled = false; }
        $('dlg-arq').addEventListener('change', function () { escolher(this.files && this.files[0]); });
        var dz = $('dlg-drop');
        dz.addEventListener('dragover', function (ev) { ev.preventDefault(); dz.classList.add('drag'); });
        dz.addEventListener('dragleave', function () { dz.classList.remove('drag'); });
        dz.addEventListener('drop', function (ev) { ev.preventDefault(); dz.classList.remove('drag'); escolher(ev.dataTransfer.files && ev.dataTransfer.files[0]); });
        $('dlg-ok').addEventListener('click', function (ev) {
          if (!arq) { ev.preventDefault(); return; }
          var oc = $('dlg-oc').value.trim();
          C.fecharDialogo();
          anexarPedido(c, arq, oc ? { oc: oc } : null);
        });
      });
  }
  function dlgReabrir(c) {
    var ab = C.FASES.filter(function (f) { return f.aberta; });
    C.dialogo('<h3>Reabrir a cotação</h3><p>Para qual fase ela volta?</p><div class="cot-fases-ini">' +
      ab.map(function (f) { return '<button type="button" class="cot-fase-ini' + (f.id === 'cotada' ? ' on' : '') + '" data-volta="' + f.id + '" style="--f:' + f.cor + '"><b>' + esc(f.nome) + '</b><small>' + esc(f.desc) + '</small></button>'; }).join('') + '</div>' +
      '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Voltar</button><button class="cs-btn cs-btn-p" value="ok" id="dlg-ok">Reabrir</button></div>',
      function (dlg) {
        var alvo = 'cotada';
        dlg.addEventListener('click', function (ev) {
          var b = ev.target.closest('[data-volta]'); if (!b) return;
          ev.preventDefault(); alvo = b.getAttribute('data-volta');
          Array.prototype.forEach.call(dlg.querySelectorAll('[data-volta]'), function (x) { x.classList.toggle('on', x === b); });
        });
        $('dlg-ok').addEventListener('click', function () { C.fecharDialogo(); acao({ acao: 'fase', numero: c.numero, fase: alvo }, 'Cotação reaberta').catch(function () {}); });
      });
  }
  function dlgAtribuir(c) {
    C.dialogo('<h3>Atribuir ' + esc(c.numero) + '</h3><p>Quem vai acompanhar esta cotação até o fim?</p>' +
      '<div class="cs-campo"><label>Buscar pessoa</label><input id="dlg-q" placeholder="nome ou e-mail @biomedical.com.br" autocomplete="off"></div>' +
      '<div class="cs-pessoas" id="dlg-pessoas"></div>' +
      '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Cancelar</button><button class="cs-btn cs-btn-p" id="dlg-ok" value="ok">Atribuir ao e-mail digitado</button></div>',
      function () {
        var q = $('dlg-q'), box = $('dlg-pessoas');
        function todas() { return (S.pessoas || []).slice(); }
        function pintar() {
          var t = C.norm(q.value).trim();
          var l = todas().filter(function (p) { return !t || C.norm(p.nome + ' ' + p.email).indexOf(t) >= 0; }).slice(0, 30);
          box.innerHTML = l.length ? l.map(function (p) {
            return '<button type="button" data-email="' + esc(p.email) + '" data-nome="' + esc(p.nome) + '">' + C.avatar(p.nome, p.email, 'p') + '<span>' + esc(p.nome) + '<small>' + esc(p.email) + '</small></span></button>';
          }).join('') : '<div class="cs-vazio" style="padding:14px">Ninguém com esse nome — digite o e-mail completo e use o botão abaixo.</div>';
        }
        q.addEventListener('input', C.debounce(pintar, 120));
        box.addEventListener('click', function (ev) {
          var b = ev.target.closest('button[data-email]'); if (!b) return;
          C.fecharDialogo();
          acao({ acao: 'atribuir', numero: c.numero, para: { email: b.getAttribute('data-email'), nome: b.getAttribute('data-nome') } }, 'Cotação atribuída').catch(function () {});
        });
        $('dlg-ok').addEventListener('click', function (ev) {
          ev.preventDefault();
          var e = q.value.trim().toLowerCase();
          if (!/^[^@\s]+@biomedical\.com\.br$/.test(e)) { C.toast('E-mail inválido', 'Use um e-mail @biomedical.com.br.', 'erro'); return; }
          C.fecharDialogo();
          acao({ acao: 'atribuir', numero: c.numero, para: { email: e, nome: C.nomeDoEmail(e) } }, 'Cotação atribuída').catch(function () {});
        });
        pintar(); q.focus();
        if (!S.pessoas) C.api('pessoas').then(function (j) { S.pessoas = j.pessoas || []; pintar(); }).catch(function () { S.pessoas = []; });
      });
  }
  function dlgDescartar(c) {
    C.dialogo('<h3>Descartar ' + esc(c.numero) + '?</h3><p>Use quando a cotação foi registrada por engano ou em dobro. Ela sai das filas e do funil (dá para restaurar depois).</p>' +
      '<div class="cs-campo"><label>Motivo</label><input id="dlg-mot" value="Registrada por engano"></div>' +
      '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Voltar</button><button class="cs-btn cs-btn-perigo" value="ok" id="dlg-ok">Descartar</button></div>',
      function () { $('dlg-ok').addEventListener('click', function () { C.fecharDialogo(); acao({ acao: 'descartar', numero: c.numero, descartado: true, motivo: $('dlg-mot').value }, 'Cotação descartada').catch(function () {}); }); });
  }
  function mudarFase(c, alvo) {
    if (!alvo || alvo === c.fase) return;
    if (alvo === 'pedido') { if (c.pedido) acao({ acao: 'fase', numero: c.numero, fase: 'pedido' }).catch(function () {}); else dlgPedido(c); return; }
    if (alvo === 'perdida' || alvo === 'cancelada') { dlgPerda(c, alvo); return; }
    if (alvo === 'vencida') { acao({ acao: 'fase', numero: c.numero, fase: 'vencida' }, 'Cotação marcada como vencida').catch(function () {}); return; }
    if (c.fase === 'pedido' && c.pedido) {
      C.dialogo('<h3>Voltar a cotação para ' + esc(C.fase(alvo).nome) + '?</h3><p>O pedido sai do caso (o PDF continua nos anexos).</p><div class="cs-dlg-pe"><button class="cs-btn" value="x">Voltar</button><button class="cs-btn cs-btn-p" value="ok" id="dlg-ok">Confirmar</button></div>',
        function () { $('dlg-ok').addEventListener('click', function () { C.fecharDialogo(); acao({ acao: 'fase', numero: c.numero, fase: alvo }, 'Fase alterada').catch(function () {}); }); });
      return;
    }
    acao({ acao: 'fase', numero: c.numero, fase: alvo }, 'Fase: ' + C.fase(alvo).nome).catch(function () {});
  }

  /* ── edição em linha ────────────────────────────────────────── */
  function editarCampo(span) {
    var c = S.caso; if (!c || span.querySelector('input,select,textarea')) return;
    var campo = span.getAttribute('data-edit'), tipo = span.getAttribute('data-tipo'), atual = span.getAttribute('data-valor') || '';
    var ops = span.getAttribute('data-op') ? JSON.parse(span.getAttribute('data-op')) : null;
    var el;
    if (tipo === 'lista') { el = D.createElement('select'); el.innerHTML = '<option value="">—</option>' + opcoes(ops, atual); }
    else if (tipo === 'area') { el = D.createElement('textarea'); el.rows = 3; el.value = atual; el.style.height = 'auto'; }
    else { el = D.createElement('input'); el.type = tipo === 'data' ? 'date' : tipo === 'datahora' ? 'datetime-local' : 'text'; el.value = tipo === 'data' ? C.paraInput(atual) : tipo === 'datahora' ? C.paraInput(atual, true) : atual; }
    // CNPJ, CEP, telefone e e-mail: a mesma máscara e as mesmas regras do Agente
    var MASC = { cnpj: ['numeric', 18, '00.000.000/0000-00'], cep: ['numeric', 9, '00000-000'], fone: ['tel', 15, '(00) 00000-0000'], email: ['email', 200, 'nome@hospital.com.br'] }[tipo];
    var erroEl = null;
    if (MASC) {
      el.value = C.formatar(tipo, atual); el.inputMode = MASC[0]; el.maxLength = MASC[1]; el.placeholder = MASC[2]; el.spellcheck = false;
      el.addEventListener('input', function () { C.mascarar(el, tipo); if (erroEl && !C.validar(tipo, el.value)) mostrarErro(''); });
    }
    function mostrarErro(txt) {
      if (!erroEl) { erroEl = D.createElement('small'); erroEl.className = 'cot-erro-campo'; erroEl.setAttribute('role', 'alert'); span.appendChild(erroEl); }
      erroEl.textContent = txt; span.classList.toggle('invalido', !!txt);
    }
    // o vencimento não pode ficar antes da data da cotação (nem o contrário)
    function erroDaData(v) {
      var dt = c.datas || {};
      if (campo === 'datas.validade' && v && dt.cotacao && v < String(dt.cotacao).slice(0, 10)) return 'A data de vencimento é antes da data da cotação (' + C.diaBR(dt.cotacao) + ')';
      if (campo === 'datas.cotacao' && v && dt.validade && v > String(dt.validade).slice(0, 10)) return 'A data da cotação é depois do vencimento (' + C.diaBR(dt.validade) + ')';
      return '';
    }
    span.innerHTML = ''; span.appendChild(el); el.focus();
    var feito = false;
    function salvar() {
      if (feito) return; feito = true;
      var v = el.value.trim();
      if (MASC) v = C.formatar(tipo, v);
      var erro = MASC ? C.validar(tipo, v) : tipo === 'data' ? erroDaData(v) : '';
      if (erro) { feito = false; mostrarErro(erro); C.toast('Não salvei', erro, 'erro'); return; }
      if (v === atual || (MASC && v === C.formatar(tipo, atual)) || (tipo === 'data' && v === C.paraInput(atual)) || (tipo === 'datahora' && v === C.paraInput(atual, true))) { renderCaso(); return; }
      var obj = {}, ks = campo.split('.');
      if (ks.length === 2) { obj[ks[0]] = {}; obj[ks[0]][ks[1]] = v; } else obj[campo] = v;
      acao({ acao: 'campos', numero: c.numero, campos: obj }, 'Salvo').catch(function () { renderCaso(); });
    }
    el.addEventListener('blur', salvar);
    el.addEventListener('change', function () { if (tipo === 'lista') el.blur(); });
    el.addEventListener('keydown', function (ev) {
      // com máscara/data, o Enter salva sem tirar o foco: se estiver errado, a pessoa corrige ali mesmo
      if (ev.key === 'Enter' && tipo !== 'area') { ev.preventDefault(); if (MASC || tipo === 'data') salvar(); else el.blur(); }
      if (ev.key === 'Escape') { feito = true; renderCaso(); }
    });
  }

  /* ── quadro (kanban por fase) ───────────────────────────────── */
  function renderQuadro() {
    var el = $('cot-kanban'); if (!el) return;
    var d30 = Date.now() - 30 * 86400e3;
    el.innerHTML = C.FASES.map(function (f) {
      var l = S.casos.filter(function (c) { return !c.descartado && c.fase === f.id && (f.aberta || C.ms(c.fechadoEm) >= d30); });
      l = f.aberta ? ordenar(l) : l.sort(function (a, b) { return C.ms(b.fechadoEm) - C.ms(a.fechadoEm); });
      var v = l.reduce(function (s, c) { return s + (c.fase === 'pedido' ? (c.totalPedido || c.total || 0) : (c.total || 0)); }, 0);
      return '<div class="cs-col' + (f.aberta ? '' : ' fechada') + '" data-col="' + f.id + '"><div class="cs-col-h"><span class="bol" style="background:' + f.cor + '"></span><span>' + esc(f.nome) +
        '<span class="v">' + C.brlCurto(v) + '</span></span><span class="n">' + l.length + (f.aberta ? '' : ' · 30 dias') + '</span></div><div class="cs-col-b">' +
        l.slice(0, 80).map(function (c) {
          return '<div class="cs-kcard" draggable="true" data-num="' + esc(c.numero) + '" style="--c:' + f.cor + '">' +
            '<div class="q"><span class="cs-mono">' + esc(c.numero) + '</span><span>·</span><span>' + esc(C.quando(c.criadoEm)) + '</span></div>' +
            '<div class="cli">' + esc((c.cliente && c.cliente.nome) || 'Cliente não informado') + '</div>' +
            '<div class="sub">' + esc(C.tituloCaso(c)) + '</div>' +
            '<div class="r"><span class="val">' + C.brlCurto(c.fase === 'pedido' && c.totalPedido ? c.totalPedido : c.total) + '</span>' + C.chipPrazo(c, aviso()) + C.chipPi(c) + (c.dono ? C.avatar(c.dono.nome, c.dono.email, 'p') : '') + '</div></div>';
        }).join('') + (l.length > 80 ? '<div class="cs-vazio" style="padding:8px">+' + (l.length - 80) + '</div>' : '') + (l.length ? '' : '<div class="cs-vazio" style="padding:18px 8px;font-size:12px">' + esc(f.desc) + '</div>') +
        '</div></div>';
    }).join('');
    C.quieto(el);
  }

  /* ── configurações ──────────────────────────────────────────── */
  function renderConfig() {
    var el = $('cot-cfg'); if (!el) return;
    if (!S.cfgTela) {
      el.innerHTML = '<div class="cs-card larga"><div class="tk-carregando"><span class="cs-spin"></span> Carregando…</div></div>';
      C.api('cot-config').then(function (j) { S.cfgTela = j.config; S.diag = j.diagnostico; S.padrao = j.padrao; renderConfig(); })
        .catch(function (e) { el.innerHTML = '<div class="cs-card larga"><p>' + esc(e.message) + '</p></div>'; });
      return;
    }
    var c = S.cfgTela, d = S.diag || {}, dono = S.eu && S.eu.admin;
    var dis = dono ? '' : ' disabled';
    function bloco(id, titulo, txt, valor, linhas) {
      return '<div class="cs-card"><h3>' + esc(titulo) + '</h3><p>' + txt + '</p><textarea id="' + id + '" rows="' + (linhas || 8) + '"' + dis + '>' + esc((valor || []).join('\n')) + '</textarea></div>';
    }
    var arm = d.armazenamento ? 'Container próprio das cotações (COT_BLOB_URL).' : 'Sem armazenamento: configure o COT_BLOB_URL (SAS do container das cotações com Read + Create + Write).';
    el.innerHTML =
      '<div class="cs-card larga"><h3>Situação</h3><p>O que o módulo usa hoje no servidor.</p><div class="cot-diag">' +
        '<div class="' + (d.armazenamento ? 'ok' : 'nao') + '">' + (d.armazenamento ? IC.checkc : IC.alert) + '<span><b>Armazenamento</b>' + esc(arm) + '</span></div>' +
        '<div class="' + (d.ia ? 'ok' : 'nao') + '">' + (d.ia ? IC.checkc : IC.alert) + '<span><b>Leitura por IA</b>' + (d.ia ? 'Azure OpenAI do portal (o mesmo do PI · Pedido).' : 'Sem AOAI_ENDPOINT/AOAI_KEY: o agente abre o formulário vazio para preencher à mão.') + '</span></div>' +
        '<div class="ok">' + IC.info + '<span><b>Anexos</b>Até ' + (d.anexoMaxMB || 10) + ' MB por arquivo · PDF, imagem, planilha, documento, e-mail e ZIP.</span></div>' +
        '<div class="ok">' + IC.lock + '<span><b>Acesso</b>Só você (' + esc((S.eu && S.eu.email) || 'dono do portal') + '). Ninguém mais entra — nem admin do portal; não há equipe nem configuração que abra.</span></div>' +
      '</div></div>' +
      (dono ? '' : '<div class="cs-faixa larga">' + IC.lock + '<div>Só o dono do portal altera as configurações. Você vê o que está valendo.</div></div>') +
      bloco('cfg-portais', 'Portais de cotação', 'A lista do campo Portal (um por linha). A leitura da IA é encaixada nestes nomes — o funil agrupa por eles.', c.portais, 8) +
      bloco('cfg-perda', 'Motivos de perda', 'Obrigatório ao marcar "Perdida". Alimenta o funil: por que perdemos.', c.motivosPerda, 8) +
      bloco('cfg-cancel', 'Motivos de cancelamento', 'Opcional ao marcar "Cancelada". (Vencida não entra aqui: passou a data de vencimento, a cotação vira "Vencida" sozinha.)', c.motivosCancelamento, 8) +
      '<div class="cs-card"><h3>Empresa e área</h3><p>A cotação é sempre da <b>BIO</b>. A área é a da <b>equipe de segurança</b> (grupo do Entra) de quem registra — ' +
        (S.eu && S.eu.area ? 'a sua: <b>' + esc(S.eu.area) + '</b>' + (S.eu.equipe ? ' (' + esc(S.eu.equipe) + ')' : '') : 'a sua não veio do Entra; o agente pede para escrever') + '.</p></div>' +
      '<div class="cs-card"><h3>Aviso de vencimento</h3><p>Quantos dias antes da data de vencimento a cotação entra em "Prazo vencendo". Passou da data, ela vira "Vencida" sozinha.</p><div class="cs-campo"><input id="cfg-aviso" type="number" min="0" max="30" value="' + (c.avisoDias != null ? c.avisoDias : 2) + '"' + dis + '></div></div>' +
      (dono ? '<div class="cot-cfg-pe"><span class="tk-vazio" style="align-self:center">' + (c.atualizadoEm ? 'Salvo por ' + esc(c.atualizadoPor) + ' · ' + esc(C.dataBR(c.atualizadoEm, true)) : '') + '</span><button type="button" class="cs-btn cs-btn-p" data-act="cfg-salvar">' + IC.check + 'Salvar configurações</button></div>' : '');
  }
  function salvarConfig() {
    var linhas = function (id) { return $(id).value.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean); };
    C.api('cot-config', { acao: 'salvar', config: {
      portais: linhas('cfg-portais'), motivosPerda: linhas('cfg-perda'), motivosCancelamento: linhas('cfg-cancel'),
      avisoDias: Number($('cfg-aviso').value) || 0
    } }).then(function (j) {
      S.cfgTela = j.config;
      C.toast('Configurações salvas', '', 'ok');
      carregar(true);
      renderConfig();
    }).catch(function (e) { C.toast('Não salvou', e.message, 'erro'); });
  }

  /* ── abas, rota e render geral ──────────────────────────────── */
  function irAba(id, semRota) {
    S.aba = id;
    Array.prototype.forEach.call(D.querySelectorAll('#cot-abas [data-aba]'), function (a) { a.classList.toggle('active', a.getAttribute('data-aba') === id); });
    Array.prototype.forEach.call(D.querySelectorAll('[data-painel]'), function (p) { p.hidden = p.getAttribute('data-painel') !== id; });
    if (!semRota) { try { history.replaceState(null, '', location.pathname + location.search + '#' + id); } catch (e) {} }
    renderTudo();
  }
  function renderTudo(chegaram) {
    renderKpis();
    if (S.aba === 'lista') { if (S.caso) renderCaso(); else renderLista(chegaram); }
    if (S.aba === 'quadro') renderQuadro();
    if (S.aba === 'config') renderConfig();
  }

  /* ── dados e tempo real ─────────────────────────────────────── */
  function aplicar(j) {
    var antes = S.conhecidos, chegaram = {};
    S.eu = j.eu || S.eu; S.cfg = j.cfg || S.cfg; S.configurado = j.configurado !== false; S.rev = j.rev;
    if (S.cfg && S.cfg.fases) C.FASES.forEach(function (f) { var s = S.cfg.fases.filter(function (x) { return x.id === f.id; })[0]; if (s) { f.nome = s.nome; f.desc = s.desc || f.desc; } });
    S.casos = (j.casos || []).slice();
    S.porNumero = {}; S.casos.forEach(function (c) { S.porNumero[c.numero] = c; });
    S.conhecidos = {}; S.casos.forEach(function (c) { S.conhecidos[c.numero] = 1; if (antes && !antes[c.numero]) chegaram[c.numero] = 1; });
    S.carregou = true;
    pintarLive('ok', 'Ao vivo · ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    faixa(S.configurado ? '' : '<b>Armazenamento não configurado.</b> As cotações só começam a ser guardadas depois que o dono do portal configurar o <b>COT_BLOB_URL</b>.', 'alerta');
    return chegaram;
  }
  function carregar(forcar) {
    return C.api('cot-casos' + (!forcar && S.rev != null ? '?rev=' + S.rev : '')).then(function (j) {
      if (j && j.mudou === false) { pintarLive('ok', 'Ao vivo · ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })); return; }
      var chegaram = aplicar(j);
      // o caso aberto mudou por outra pessoa (ou pelo PI): recarrega
      if (S.caso) {
        var r = S.porNumero[S.caso.numero];
        if (r && r.atualizadoEm !== S.caso.atualizadoEm && !S.editandoItens) {
          C.api('cot-casos?numero=' + encodeURIComponent(S.caso.numero)).then(function (x) { if (S.caso && x.caso && x.caso.numero === S.caso.numero) { S.caso = x.caso; renderTudo(); } }).catch(function () {});
        }
      }
      renderTudo(chegaram);
    }).catch(function (e) {
      if (e.status === 401 || e.status === 403) {
        pintarLive('erro', 'Sem acesso');
        S.carregou = true; S.casos = [];
        faixa('<b>' + esc(e.message) + '</b>', 'erro');
        renderTudo();
        return;
      }
      pintarLive('alerta', 'Reconectando…');
    });
  }
  var timer = null;
  function ciclo() {
    clearTimeout(timer);
    timer = setTimeout(function () { if (!D.hidden) carregar().then(ciclo, ciclo); else ciclo(); }, 20000);
  }

  /* ── eventos ────────────────────────────────────────────────── */
  function ligar() {
    var app = $('cot-app');
    D.addEventListener('click', function (ev) {
      var a = ev.target.closest('#cot-abas [data-aba]');
      if (a) { ev.preventDefault(); if (S.caso) { S.caso = null; mostrarCaso(false); try { history.replaceState(null, '', location.pathname); } catch (e) {} } irAba(a.getAttribute('data-aba')); }
    });
    app.addEventListener('click', function (ev) {
      var t = ev.target;
      var k = t.closest('[data-visao]');
      if (k) { S.visao = k.getAttribute('data-visao'); if (S.caso) fecharCaso(); if (S.aba !== 'lista') irAba('lista'); else renderTudo(); return; }
      var p = t.closest('[data-portal]');
      if (p) { S.portal = p.getAttribute('data-portal'); renderLista(); return; }
      if (t.closest('#cot-limpar')) { S.portal = ''; S.busca = ''; $('cot-busca').value = ''; renderLista(); return; }
      var row = t.closest('.cot-row, .cs-kcard');
      if (row && !t.closest('button, a')) { abrirCaso(row.getAttribute('data-num')); return; }
      var c = S.caso;
      var nav = t.closest('[data-nav]');
      if (nav && c) { var l = lista(), i = l.findIndex(function (x) { return x.numero === c.numero; }), alvo = l[i + Number(nav.getAttribute('data-nav'))]; if (alvo) abrirCaso(alvo.numero); return; }
      var fb = t.closest('#cot-path [data-fase], .cot-saidas [data-fase]');
      if (fb && c) { mudarFase(c, fb.getAttribute('data-fase')); return; }
      var ver = t.closest('[data-ver-anexo]');
      if (ver && c) { var an = (c.anexos || []).filter(function (x) { return x.id === ver.getAttribute('data-ver-anexo'); })[0]; if (an) C.abrirAnexo(c.numero, an); return; }
      var tov = t.closest('[data-tirar-ov]');
      if (tov && c) { dlgTirarOv(c, tov.getAttribute('data-tirar-ov')); return; }
      var tira = t.closest('[data-tirar-anexo]');
      if (tira && c) { acao({ acao: 'removerAnexo', numero: c.numero, id: tira.getAttribute('data-tirar-anexo') }, 'Anexo tirado do caso').catch(function () {}); return; }
      var rap = t.closest('[data-rapida]');
      if (rap) { var ta = $('cot-nota'); if (ta) { ta.value = (ta.value ? ta.value.replace(/\s+$/, '') + '\n' : '') + rap.getAttribute('data-rapida') + ': '; ta.focus(); } return; }
      var ti = t.closest('[data-tirar-item]');
      if (ti && S.itensRascunho) { S.itensRascunho.splice(Number(ti.getAttribute('data-tirar-item')), 1); renderCaso(); return; }
      var edt = t.closest('.cs-edit');
      if (edt) { editarCampo(edt); return; }
      if (t.closest('#cot-copiar') && c) {
        var link = location.origin + location.pathname + '?caso=' + encodeURIComponent(c.numero);
        try { navigator.clipboard.writeText(c.numero + ' — ' + link); C.toast('Copiado', c.numero + ' e o link do caso', 'ok'); } catch (e) {}
        return;
      }
      var b = t.closest('[data-act]'); if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'voltar') { fecharCaso(); return; }
      if (act === 'cfg-salvar') { salvarConfig(); return; }
      if (!c) return;
      if (act === 'assumir' || act === 'liberar') { acao({ acao: act, numero: c.numero }, act === 'assumir' ? 'Você assumiu a cotação' : 'Cotação devolvida para a fila').catch(function () {}); return; }
      if (act === 'atribuir') { dlgAtribuir(c); return; }
      if (act === 'virou-pedido') { dlgPedido(c); return; }
      if (act === 'reabrir') { dlgReabrir(c); return; }
      if (act === 'descartar') { dlgDescartar(c); return; }
      if (act === 'restaurar') { acao({ acao: 'descartar', numero: c.numero, descartado: false }, 'Cotação restaurada').catch(function () {}); return; }
      if (act === 'abrir-pi') { abrirPI(c); return; }
      if (act === 'ler-pedido') { lerPedido(c); return; }
      if (act === 'ov-fechar') { registrarOv(c, false); return; }
      if (act === 'ov-mais') { S.ovMais[c.numero] = true; renderCaso(); var oi = $('cot-ov-num'); if (oi) oi.focus(); return; }
      if (act === 'ov-mais-x') { S.ovMais[c.numero] = false; S.ovEnvio[c.numero] = {}; renderCaso(); return; }
      if (act === 'nota') { enviarNota(c); return; }
      if (act === 'itens-editar') { S.editandoItens = true; S.itensRascunho = JSON.parse(JSON.stringify(c.itens || [])); if (!S.itensRascunho.length) S.itensRascunho.push(novoItem()); renderCaso(); return; }
      if (act === 'itens-cancelar') { S.editandoItens = false; S.itensRascunho = null; renderCaso(); return; }
      if (act === 'item-mais') { S.itensRascunho.push(novoItem()); renderCaso(); return; }
      if (act === 'itens-salvar') {
        var its = (S.itensRascunho || []).filter(function (x) { return x.descricao || x.codigo || x.codigoCliente; });
        var salvar = function () { acao({ acao: 'itens', numero: c.numero, itens: its }, 'Itens salvos').then(function (j) { if (!j) return; S.editandoItens = false; S.itensRascunho = null; S.salvarSemConferir = false; renderCaso(); }).catch(function () {}); };
        // o Cód. Biomedical tem de ser um produto nosso (a mesma conferência do agente e do PI)
        b.disabled = true; b.innerHTML = '<span class="cs-spin"></span> Conferindo os códigos…';
        C.conferirItens(S.itensRascunho, false).then(function () {
          var ruins = C.itensComCodigoRuim(its);
          if (ruins.length) { renderCaso(); C.toast(ruins.length + ' item(ns) sem código de produto Biomedical', 'Corrija o Cód. Biomedical das linhas em vermelho.', 'erro'); return; }
          salvar();
        }).catch(function (e) {
          renderCaso();
          // BI fora do ar: o 2º clique salva sem a conferência
          if (S.salvarSemConferir) { salvar(); return; }
          S.salvarSemConferir = true;
          C.toast('Não consegui conferir os códigos no BI', (e.message || e) + ' — clique em Salvar de novo para gravar sem a conferência.', 'erro');
        });
        return;
      }
      if (act === 'reler') { relerCotacao(c, b); return; }
      if (act === 'prop-ver') { verProposta(c); return; }
      if (act === 'erp') { acao({ acao: 'erp', numero: c.numero }, 'Consultado no Dynamics').catch(function () {}); return; }
      if (act === 'prop-enviar') { enviarProposta(c); return; }
    });
    app.addEventListener('input', function (ev) {
      var t = ev.target;
      if (t.id === 'cot-busca') { S.busca = t.value; buscar(); return; }
      if (t.id === 'cot-nota' && S.caso) { S.rascunho[S.caso.numero] = t.value; return; }
      if (t.id === 'cot-prop-para' && S.caso) { S.propPara[S.caso.numero] = t.value; return; }
      if (t.id === 'cot-ov-num' && S.caso) {
        // em maiúsculas enquanto digita (o cursor fica onde estava)
        var p0 = t.selectionStart, up = t.value.toUpperCase();
        if (up !== t.value) { t.value = up; try { t.setSelectionRange(p0, p0); } catch (e) {} }
        S.ovRascunho[S.caso.numero] = t.value;
        if (S.ovEnvio[S.caso.numero] && S.ovEnvio[S.caso.numero].estado === 'erro') { S.ovEnvio[S.caso.numero] = {}; var m = t.closest('.cot-ov') && t.closest('.cot-ov').querySelector('.cot-ov-msg.erro'); if (m) m.remove(); }
        return;
      }
      if (t.matches('[data-f]') && S.itensRascunho) {
        var tr = t.closest('tr'), i = Number(tr.getAttribute('data-i')), f = t.getAttribute('data-f'), it = S.itensRascunho[i]; if (!it) return;
        it[f] = (f === 'quantidade' || f === 'valorUnitario') ? C.num(t.value) : t.value;
        if (f === 'codigo' && it._cod) { it._cod = null; tr.classList.remove('cod-nao', 'cod-ok'); var st = tr.querySelector('.cod-st-box'); if (st) st.innerHTML = ''; }
        if (f === 'quantidade' || f === 'valorUnitario') {
          var cel = app.querySelector('[data-tot="' + i + '"]'); if (cel) cel.textContent = it.quantidade && it.valorUnitario ? C.brl(it.quantidade * it.valorUnitario) : '—';
          var tt = $('cot-itens-total'); if (tt) tt.textContent = C.brl(totalDe(S.itensRascunho));
        }
      }
    });
    app.addEventListener('change', function (ev) {
      var t = ev.target, c = S.caso;
      if (t.id === 'cot-ordem') { S.ordem = t.value; C.gravarLocal('cot-ordem', t.value); renderLista(); return; }
      if (t.id === 'cot-arq-ped' && c) { anexarPedido(c, t.files && t.files[0]); t.value = ''; return; }
      if (t.id === 'cot-arq-outro' && c) { anexarOutro(c, t.files && t.files[0]); t.value = ''; return; }
    });
    app.addEventListener('keydown', function (ev) {
      var t = ev.target;
      if (t.id === 'cot-nota' && ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && S.caso) { ev.preventDefault(); enviarNota(S.caso); return; }
      if (t.id === 'cot-ov-num' && ev.key === 'Enter' && S.caso) { ev.preventDefault(); registrarOv(S.caso, false); return; }
      if (t.classList && t.classList.contains('cot-row') && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); abrirCaso(t.getAttribute('data-num')); return; }
      if ((t.id === 'cot-drop-ped') && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); $('cot-arq-ped').click(); }
    });
    // atalhos J/K e Esc no caso
    D.addEventListener('keydown', function (ev) {
      if (!S.caso || /INPUT|TEXTAREA|SELECT/.test((ev.target && ev.target.tagName) || '') || (ev.target && ev.target.isContentEditable)) return;
      if ($('cs-dlg') && $('cs-dlg').open) return;
      if (ev.key === 'j' || ev.key === 'k') { var b = D.querySelector('[data-nav="' + (ev.key === 'j' ? 1 : -1) + '"]'); if (b && !b.disabled) b.click(); }
      if (ev.key === 'Escape') fecharCaso();
    });
    // soltar o PDF do pedido / anexo no caso
    app.addEventListener('dragover', function (ev) { var d = ev.target.closest && ev.target.closest('#cot-drop-ped, #cot-anexo-add'); if (d) { ev.preventDefault(); d.classList.add('drag'); } });
    app.addEventListener('dragleave', function (ev) { var d = ev.target.closest && ev.target.closest('#cot-drop-ped, #cot-anexo-add'); if (d) d.classList.remove('drag'); });
    app.addEventListener('drop', function (ev) {
      var d = ev.target.closest && ev.target.closest('#cot-drop-ped, #cot-anexo-add'); if (!d || !S.caso) return;
      ev.preventDefault(); d.classList.remove('drag');
      var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (d.id === 'cot-drop-ped') anexarPedido(S.caso, f); else anexarOutro(S.caso, f);
    });
    // quadro: arrastar muda a fase
    var arrastando = '';
    app.addEventListener('dragstart', function (ev) { var k = ev.target.closest && ev.target.closest('.cs-kcard'); if (!k) return; arrastando = k.getAttribute('data-num'); k.classList.add('arrastando'); try { ev.dataTransfer.setData('text/plain', arrastando); } catch (e) {} });
    app.addEventListener('dragend', function (ev) { var k = ev.target.closest && ev.target.closest('.cs-kcard'); if (k) k.classList.remove('arrastando'); Array.prototype.forEach.call(D.querySelectorAll('.cs-col.alvo'), function (x) { x.classList.remove('alvo'); }); });
    app.addEventListener('dragover', function (ev) { var col = ev.target.closest && ev.target.closest('#cot-kanban .cs-col'); if (col && arrastando) { ev.preventDefault(); col.classList.add('alvo'); } });
    app.addEventListener('dragleave', function (ev) { var col = ev.target.closest && ev.target.closest('#cot-kanban .cs-col'); if (col && !col.contains(ev.relatedTarget)) col.classList.remove('alvo'); });
    app.addEventListener('drop', function (ev) {
      var col = ev.target.closest && ev.target.closest('#cot-kanban .cs-col'); if (!col || !arrastando) return;
      ev.preventDefault(); col.classList.remove('alvo');
      var num = arrastando, alvo = col.getAttribute('data-col'); arrastando = '';
      var r = S.porNumero[num]; if (!r || r.fase === alvo) return;
      C.api('cot-casos?numero=' + encodeURIComponent(num)).then(function (j) { mudarFase(j.caso, alvo); }).catch(function (e) { C.toast('Não abriu a cotação', e.message, 'erro'); });
    });
    // o PI avisa quando lançou o pedido no Dynamics
    if (W.CSPI) W.CSPI.ouvir(function (m) {
      if (!m || m.tipo !== 'pi-enviado' || !/^COT-/.test(m.numero || '')) return;
      C.toast('Pedido lançado no Dynamics', m.numero + ' · o PI registrou na cotação', 'ok');
      carregar(true);
      if (S.caso && S.caso.numero === m.numero) C.api('cot-casos?numero=' + encodeURIComponent(m.numero)).then(function (j) { S.caso = j.caso; mesclar(j.caso); renderTudo(); });
    });
    D.addEventListener('visibilitychange', function () { if (!D.hidden) carregar(); });
  }
  var buscar = C.debounce(function () { renderLista(); }, 160);
  function novoItem() { return { codigo: '', codigoCliente: '', descricao: '', marca: '', registro: '', unidade: '', quantidade: 0, valorUnitario: 0 }; }
  function enviarNota(c) {
    var ta = $('cot-nota'); if (!ta) return;
    var t = ta.value.trim(); if (!t) { ta.focus(); return; }
    acao({ acao: 'nota', numero: c.numero, texto: t }, 'Nota registrada').then(function (j) { if (!j) return; S.rascunho[c.numero] = ''; renderCaso(); }).catch(function () {});
  }
  function anexarOutro(c, file) {
    if (!file) return;
    if (file.size > 10 * 1048576) { C.toast('Arquivo grande demais', 'O limite é 10 MB.', 'erro'); return; }
    C.toast('Enviando ' + file.name, '', '');
    C.lerArquivo(file).then(function (arq) {
      return acao({ acao: 'anexo', numero: c.numero, tipo: 'outro', anexo: { nome: arq.nome, tipo: arq.tipo, base64: arq.base64 } }, 'Arquivo anexado');
    }).catch(function () {});
  }
  // a IA lê de novo o PDF da cotação e completa o que estiver vazio
  function relerCotacao(c, botao) {
    var a = (c.anexos || []).filter(function (x) { return x.tipo === 'cotacao' && !x.removido; }).pop();
    if (!a) return;
    if (!C.leitorPronto()) { C.toast('O leitor de PDF não carregou', 'Recarregue a página.', 'erro'); return; }
    botao.disabled = true; botao.innerHTML = '<span class="cs-spin"></span> Lendo…';
    var arquivo;
    C.baixarAnexo(c.numero, a.id).then(function (arq) { arquivo = arq; return C.textoDoPdf(C.b64ParaBytes(arq.base64).buffer); })
      .then(function (texto) {
        if (!texto || texto.trim().length < 40) throw new Error('o PDF parece escaneado (sem texto)');
        return C.lerComIA(texto, arquivo.nome, 'cotacao');
      })
      .then(function (r) {
        return acao({ acao: 'leitura', numero: c.numero, dados: C.dadosDaLeitura(r && r.dados), leitura: { modelo: (r && (r.model || r.deployment)) || '', avisos: (r && r.avisos) || [] } }, 'A IA leu de novo');
      })
      .catch(function (e) { C.toast('A IA não conseguiu ler', e.message, 'erro'); renderCaso(); });
  }

  /* ── início ─────────────────────────────────────────────────── */
  function iniciar() {
    ligar();
    var aba = (location.hash || '').replace('#', '');
    if (['lista', 'quadro', 'config'].indexOf(aba) >= 0) irAba(aba, true); else irAba('lista', true);
    var sel = $('cot-ordem'); if (sel) sel.value = S.ordem;
    var q = new URLSearchParams(location.search);
    C.aguardarLogin().then(function () { return carregar(true); }).then(function () {
      var num = q.get('caso');
      if (num) abrirCaso(num, true);
      ciclo();
    });
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
