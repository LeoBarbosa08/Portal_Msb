/* ================================================================
   cotacoes.js — GESTÃO DE COTAÇÕES (pages/comercial-cot-casos.html)

   O console das cotações, no molde dos tickets do Customer Service:

     Cotações  cinco cartões (Cotadas · Em andamento · Perdidas · Ganhas ·
               Conversão — 21/10/2026) e a fila (Minhas · Em andamento · Prazo
               vencendo · Ganhas · Perdidas · Todas — 21/10/2026),
               dividida por portal, com busca e ordem (o prazo primeiro).
               Clicar abre o CASO: o caminho das fases (21/10/2026: só três —
               Cotada → Ganha (virou pedido), e a saída Perdida, com o motivo:
               preço, prazo, proposta vencida, cancelada…; passou da data de
               vencimento, o portal marca Perdida sozinho — 22/10/2026), a PROPOSTA no modelo da Biomedical
               (ver, enviar e reenviar ao comprador pelo Outlook),
               o cartão do PEDIDO (soltar o PDF do pedido do portal = a
               cotação vira pedido; o portal lê o pedido, compara com o que
               foi cotado e manda para o PI · Pedido; no fim a cotação FECHA
               com a Ordem de Venda do Dynamics, conferida no F&O — uma ou
               mais, do PI ou lançada à mão; o flow do PI também devolve a OV
               sozinho, por /api/cot-ov-retorno), os itens, a tramitação
               (notas), os dados editáveis, os anexos e o histórico.
     Quadro    kanban pelas fases; arrastar muda a fase (Virou pedido pede o
               PDF, Perdida pede o motivo). O cartão mostra o código do
               cliente e o quadro tem os filtros da lista — portal, unidade e
               a busca (23/10/2026).
     Config.   portais, motivos e o aviso de vencimento (o módulo é SÓ do dono
               do portal — não há equipe). Empresa é sempre BIO; a UNIDADE DE
               NEGÓCIO é a do RLS de quem registra no Power BI e cada pessoa só
               vê as cotações da(s) unidade(s) dela (o servidor filtra; o dono
               vê todas) — filtro "Unidade" quando ela vê mais de uma.

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
    visao: 'andamento', portal: '', unidade: '', busca: '', ordem: C.lerLocal('cot-ordem') || 'prazo',
    // 23/10/2026: o filtro por responsável (e-mail | '(sem)'), o "Possui
    // tramitação", os meses abertos/fechados do quadro e o Histórico do cliente
    dono: '', tramitacao: false, mesAberto: {}, histCod: '', histAberto: {},
    caso: null, abrindo: '', aba: 'lista', editandoItens: false, itensRascunho: null,
    leiturasPedido: {}, lendoPedido: {}, rascunho: {}, conhecidos: null,
    cfgTela: null, diag: null, padrao: null, pessoas: null, enviando: false,
    propPara: {}, propEnvio: {},  // a proposta, por caso: o "Para" digitado e o estado do envio
    propNome: {},                 // e o nome do comprador digitado (29/10/2026)
    ipiEdicao: false,             // o "Tem IPI?" na edição dos itens (29/10/2026)
    propExtras: {},               // e os outros arquivos que vão junto: { arquivos: [], doCaso: {id: true} }
    ovRascunho: {}, ovEnvio: {}, ovMais: {}   // a Ordem de Venda, por caso: o número digitado, a conferência e o "+ outra OV"
  };

  // 21/10/2026 (pedido do usuário): só seis filtros, nesta ordem — Minhas, Em
  // andamento, Prazo vencendo, Ganhas, Perdidas e Todas (saíram Sem
  // responsável, Aguardando PI, Aguardando OV e Descartadas). A cotação aberta
  // com o prazo vencido conta em Perdidas — desde 22/10/2026 o servidor a passa
  // para a fase Perdida ("Comprador não informou o motivo"); até lá, e na
  // reaberta à mão, conta pela data
  var VISOES = [
    { id: 'minhas', nome: 'Minhas', ic: IC.user },
    { id: 'andamento', nome: 'Em andamento', ic: IC.inbox },
    { id: 'vencendo', nome: 'Prazo vencendo', ic: IC.alarm, quente: true },
    // 26/10/2026 (pedido do usuário): a fase A faturar — o pedido registrado, falta a OV
    { id: 'faturar', nome: 'A faturar', ic: IC.cart },
    { id: 'pedido', nome: 'Ganhas', ic: IC.trophy },
    // 23/10/2026 (pedido do usuário): as AMOSTRAS, ao lado das Ganhas — a cópia
    // da perdida para a gestão; não contam em nenhuma outra visão nem valor
    { id: 'amostras', nome: 'Amostras', ic: IC.amostra },
    { id: 'perdidas', nome: 'Perdidas', ic: IC.xc },
    { id: 'todas', nome: 'Todas', ic: IC.layers }
  ];
  function aviso() { return S.cfg && S.cfg.avisoDias != null ? S.cfg.avisoDias : 2; }
  function eMeu(c) { return !!(c.dono && S.eu && c.dono.email === S.eu.email); }
  function passa(c, v) {
    if (c.descartado) return false;
    // a amostra não conta em nada: só aparece na visão dela (e não entra nela a cotação)
    if (c.amostra || v === 'amostras') return !!c.amostra && v === 'amostras';
    var ab = C.aberta(c.fase);
    switch (v) {
      // (26/10/2026: a A faturar tem a visão dela — sai do Em andamento)
      case 'andamento': return ab && c.fase !== 'faturar' && !prazoVencido(c);
      case 'faturar': return c.fase === 'faturar';
      case 'vencendo': var p = C.prazoDe(c, aviso()); return ab && !temPedido(c) && !!p && p.nivel === 1;
      case 'minhas': return ab && eMeu(c);
      case 'pedido': return c.fase === 'pedido';
      case 'perdidas': return C.faseAtual(c.fase) === 'perdida' || (ab && prazoVencido(c));
      default: return true;
    }
  }
  // a cotação aberta com a data de vencimento já passada (22/10/2026: a que
  // tem o pedido registrado aguarda a OV — o prazo não conta)
  function prazoVencido(c) { if (temPedido(c)) return false; var p = C.prazoDe(c, aviso()); return !!p && p.nivel === 2; }
  // o pedido registrado (PDF ou à mão), aguardando a OV para fechar como Ganha
  function temPedido(c) { return !!(c && (c.pedido || c.temPedido)); }
  function textoBusca(c) {
    return C.norm([c.numero, c.unidade, (c.ovs || []).join(' '), c.cliente && c.cliente.nome, c.cliente && c.cliente.cnpj, c.cliente && c.cliente.codigo, c.cliente && c.cliente.cidade, c.cliente && c.cliente.uf,
      c.portal, c.cotacaoId, c.oc, c.itensTxt, c.dono && c.dono.nome, c.empresa, c.area, C.fase(c.fase).nome, c.amostra ? 'amostra ' + (c.amostraDe || '') : '', c.paciente || ''].join(' '));
  }
  // o responsável como filtro: o e-mail (ou '(sem)')
  function donoK(c) { return c.dono && c.dono.email ? String(c.dono.email).toLowerCase() : '(sem)'; }
  // as cotações do quadro: as das colunas (no lugar da fila escolhida)
  function doQuadro(c) { return COLUNAS.some(function (col) { return passa(c, col.visao); }); }
  // 23/10/2026: portal, unidade, responsável, "Possui tramitação" e busca valem
  // na lista e no quadro (quadro = true). sem = o filtro que fica de fora — as
  // contagens dos botões dele: 'portal' | 'unidade' | 'dono' | 'tram'
  function filtrados(sem, quadro) {
    var t = C.norm(S.busca).trim(), dig = S.busca.replace(/\D/g, '');
    return S.casos.filter(function (c) {
      if (!(quadro ? doQuadro(c) : passa(c, S.visao))) return false;
      if (sem !== 'portal' && S.portal && (c.portal || '(sem portal)') !== S.portal) return false;
      if (sem !== 'unidade' && S.unidade && (c.unidade || '(sem unidade)') !== S.unidade) return false;
      if (sem !== 'dono' && S.dono && donoK(c) !== S.dono) return false;
      if (sem !== 'tram' && S.tramitacao && !(c.nNotas > 0)) return false;
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
      numero: c.numero, fase: C.faseDe(c), portal: c.portal || '', cotacaoId: c.cotacaoId || '',
      cliente: { nome: (c.cliente && c.cliente.nome) || '', cnpj: (c.cliente && c.cliente.cnpj) || '', codigo: (c.cliente && c.cliente.codigo) || '', uf: (c.cliente && c.cliente.uf) || '', cidade: (c.cliente && c.cliente.cidade) || '' },
      empresa: c.empresa || '', area: c.area || '', unidade: c.unidade || '', dono: c.dono ? { email: c.dono.email, nome: c.dono.nome } : null,
      total: c.total || 0, nItens: (c.itens || []).length,
      totalPedido: ped ? ((pv && pv.total) || ped.total || 0) : 0, oc: ped ? (ped.oc || (pv && pv.oc) || '') : '',
      validade: (c.datas && c.datas.validade) || '', dataCotacao: (c.datas && c.datas.cotacao) || '',
      criadoEm: c.criadoEm, atualizadoEm: c.atualizadoEm, faseEm: c.faseEm || c.criadoEm, fechadoEm: c.fechadoEm || null,
      amostra: !!c.amostra, amostraDe: (c.amostra && c.amostra.de) || '', amostras: (c.amostras || []).map(function (a) { return a.numero; }),
      paciente: (c.faturamento && c.faturamento.paciente) || '',
      fases: (c.fases || []).slice(-12).map(function (f) { return [C.faseAtual(f.fase), String(f.em || '').slice(0, 10)]; }),
      proposta: c.proposta ? { em: c.proposta.em, para: (c.proposta.para || []).join(', ') } : null,
      pi: c.pi ? c.pi.estado || '' : '', ovs: (c.ovs || []).map(function (o) { return o.numero; }), perda: c.perda ? c.perda.motivo || '' : '', temPedido: !!c.pedido,
      nAnexos: (c.anexos || []).filter(function (a) { return !a.removido; }).length, nNotas: (c.notas || []).length,
      descartado: !!c.descartado,
      itensTxt: (c.itens || []).slice(0, 6).map(function (i) { return i.descricao || i.codigo; }).join(' · ').slice(0, 240),
      itensRes: (c.itens || []).slice(0, 60).map(function (i) {
        return [i.codigo || '', String(i.descricao || '').slice(0, 70), i.quantidade || 0, Math.round((i.quantidade || 0) * (i.valorUnitario || 0) * 100) / 100,
          i.resultado === 'ganho' ? 'g' : i.resultado === 'perdido' ? 'p' : ''];
      })
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
  // 21/10/2026 (pedido do usuário): só cinco cartões — Cotadas (todas),
  // Em andamento, Perdidas (com as de prazo vencido), Ganhas e Conversão
  // (ganhas ÷ cotadas). Clicar abre a visão do cartão.
  // 23/10/2026: + Amostras, ao lado de Ganhas — fora de todas as outras contas
  // 26/10/2026: + A faturar, depois de Em andamento
  function renderKpis() {
    var el = $('cot-kpis'); if (!el) return;
    var n = contagens(), vivos = S.casos.filter(function (c) { return !c.descartado && !c.amostra; });
    var soma = function (l, ped) { return l.reduce(function (s, c) { return s + ((ped && c.totalPedido) || c.total || 0); }, 0); };
    var de = function (v) { return vivos.filter(function (c) { return passa(c, v); }); };
    var and = de('andamento'), fat = de('faturar'), per = de('perdidas'), gan = de('pedido');
    var venc = per.filter(function (c) { return C.aberta(c.fase); }).length, aguarda = and.filter(temPedido).length;
    // as amostras pelo resultado (ganha ou perdida, ficam na Amostra)
    var ams = S.casos.filter(function (c) { return passa(c, 'amostras'); });
    var amG = ams.filter(function (c) { return c.fase === 'amostra_ganha'; }).length, amP = ams.filter(function (c) { return c.fase === 'amostra_perdida'; }).length;
    var K = [
      ['todas', IC.layers, C.int(vivos.length), 'Cotadas', 'todas as oportunidades · ' + C.brlCurto(soma(vivos)), '#324C57', '#ECF0F3'],
      ['andamento', IC.inbox, C.int(n.andamento), 'Em andamento', (aguarda ? aguarda + ' com pedido, aguardando a OV · ' : '') + C.brlCurto(soma(and)) + ' cotados', '#2C7288', '#EEF5F9'],
      ['faturar', IC.cart, C.int(n.faturar), 'A faturar', fat.length ? C.brlCurto(soma(fat, true)) + ' a faturar' : 'aguardando o faturamento', '#D97706', '#FEF1DA'],
      ['perdidas', IC.xc, C.int(n.perdidas), 'Perdidas', (venc ? venc + ' com o prazo vencido · ' : '') + C.brlCurto(soma(per)), '#CF3434', '#FDE7E7'],
      ['pedido', IC.trophy, C.int(n.pedido), 'Ganhas', C.brlCurto(soma(gan, true)) + ' em pedidos', '#138A4B', '#DDF5E7'],
      ['amostras', IC.amostra, C.int(n.amostras), 'Amostras', !n.amostras ? 'a perdida pode virar amostra' : amG || amP ? [amG ? amG + ' ganha' + (amG > 1 ? 's' : '') : '', amP ? amP + ' perdida' + (amP > 1 ? 's' : '') : ''].filter(Boolean).join(' · ') + ' · fora das contas' : 'cópias das perdidas · fora das contas', '#7C3AED', '#F1EAFE'],
      ['pedido', IC.funnel, vivos.length ? C.pct(gan.length / vivos.length, 0) : '—', 'Conversão', vivos.length ? 'ganhas ÷ cotadas · ' + gan.length + ' de ' + vivos.length : 'nenhuma oportunidade', '#2B6CC4', '#E6EEFA', 'conv']
    ];
    el.innerHTML = K.map(function (k) {
      return '<button type="button" class="cs-kpi' + (S.visao === k[0] && S.aba === 'lista' && !S.caso && k[7] !== 'conv' ? ' ativo' : '') + (S.carregou && (k[2] === '0' || k[2] === '—') ? ' zero' : '') + '" data-visao="' + k[0] + '" style="--k:' + k[5] + ';--kf:' + k[6] + '">' +
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
  function renderPortais(quadro) {
    var el = $(quadro ? 'cot-portais-q' : 'cot-portais'); if (!el) return;
    var base = filtrados('portal', quadro), por = {};
    base.forEach(function (c) { var p = c.portal || '(sem portal)'; por[p] = (por[p] || 0) + 1; });
    var nomes = Object.keys(por).sort(function (a, b) { return por[b] - por[a]; });
    if (S.portal && nomes.indexOf(S.portal) < 0) nomes.push(S.portal);
    if (nomes.length < 2 && !S.portal) { el.innerHTML = ''; return; }
    el.innerHTML = '<span class="tk-ests-l">Portal</span><button type="button" class="tk-est' + (!S.portal ? ' ativo' : '') + '" data-portal="">Todos<span class="n">' + base.length + '</span></button>' +
      nomes.map(function (p) { return '<button type="button" class="tk-est' + (S.portal === p ? ' ativo' : '') + '" data-portal="' + esc(p) + '">' + esc(p) + '<span class="n">' + (por[p] || 0) + '</span></button>'; }).join('');
  }
  // as unidades de negócio que a pessoa vê na lista (o servidor já filtrou pelo RLS)
  function renderUnidades(quadro) {
    var el = $(quadro ? 'cot-unidades-q' : 'cot-unidades'); if (!el) return;
    var base = filtrados('unidade', quadro), por = {};
    base.forEach(function (c) { var u = c.unidade || '(sem unidade)'; por[u] = (por[u] || 0) + 1; });
    var nomes = Object.keys(por).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    if (S.unidade && nomes.indexOf(S.unidade) < 0) nomes.push(S.unidade);
    if (nomes.length < 2 && !S.unidade) { el.innerHTML = ''; return; }
    el.innerHTML = '<span class="tk-ests-l">Unidade</span><button type="button" class="tk-est' + (!S.unidade ? ' ativo' : '') + '" data-unidade="">Todas<span class="n">' + base.length + '</span></button>' +
      nomes.map(function (u) { return '<button type="button" class="tk-est' + (S.unidade === u ? ' ativo' : '') + '" data-unidade="' + esc(u) + '">' + esc(u) + '<span class="n">' + (por[u] || 0) + '</span></button>'; }).join('');
  }
  // 23/10/2026 (pedido do usuário): o nome de cada RESPONSÁVEL nos filtros —
  // clicar mostra só as cotações dele (o que cada um está fazendo), com a cor
  // dele; "Sem responsável" quando houver
  function renderDonos(quadro) {
    var el = $(quadro ? 'cot-donos-q' : 'cot-donos'); if (!el) return;
    var base = filtrados('dono', quadro), por = {}, quem = {};
    base.forEach(function (c) { var k = donoK(c); por[k] = (por[k] || 0) + 1; if (c.dono && !quem[k]) quem[k] = c.dono; });
    if (S.dono && !(S.dono in por)) { por[S.dono] = 0; var r0 = S.casos.filter(function (c) { return donoK(c) === S.dono; })[0]; if (r0 && r0.dono) quem[S.dono] = r0.dono; }
    var ks = Object.keys(por);
    if (ks.length < 2 && !S.dono) { el.innerHTML = ''; return; }
    var nomes = nomesCurtos(ks.filter(function (k) { return k !== '(sem)'; }).map(function (k) { return { k: k, nome: (quem[k] && quem[k].nome) || C.nomeDoEmail(k) }; }));
    ks.sort(function (a, b) { return (a === '(sem)') - (b === '(sem)') || por[b] - por[a] || String(nomes[a]).localeCompare(String(nomes[b]), 'pt-BR'); });
    el.innerHTML = '<span class="tk-ests-l">Responsável</span><button type="button" class="tk-est' + (!S.dono ? ' ativo' : '') + '" data-dono="">Todos<span class="n">' + base.length + '</span></button>' +
      ks.map(function (k) {
        var p = quem[k];
        return '<button type="button" class="tk-est cot-est-dono' + (S.dono === k ? ' ativo' : '') + '" data-dono="' + esc(k) + '" title="' + esc(p ? p.nome + ' · ' + p.email : 'Sem responsável') + '">' +
          (p ? C.avatar(p.nome, p.email, 'mini') : '') + esc(k === '(sem)' ? 'Sem responsável' : nomes[k]) + '<span class="n">' + (por[k] || 0) + '</span></button>';
      }).join('');
  }
  // o primeiro nome; dois com o mesmo, o primeiro e o último
  function nomesCurtos(l) {
    var vezes = {}, r = {};
    l.forEach(function (x) { var p = C.primeiroNome(x.nome); vezes[p] = (vezes[p] || 0) + 1; });
    l.forEach(function (x) {
      var p = C.primeiroNome(x.nome), ps = String(x.nome || '').trim().split(/\s+/);
      r[x.k] = vezes[p] > 1 && ps.length > 1 ? p + ' ' + C.primeiroNome(ps[ps.length - 1]) : p || x.k;
    });
    return r;
  }
  // 23/10/2026 (pedido do usuário): "Possui tramitação" — só as cotações com
  // nota na tramitação, em qualquer fase (no quadro: as três colunas)
  function renderTram(quadro) {
    var el = $(quadro ? 'cot-tram-q' : 'cot-tram'); if (!el) return;
    var n = filtrados('tram', quadro).filter(function (c) { return c.nNotas > 0; }).length;
    el.innerHTML = '<button type="button" class="tk-est cot-tram-f' + (S.tramitacao ? ' ativo' : '') + '" data-tram="1" aria-pressed="' + (S.tramitacao ? 'true' : 'false') + '" title="Só as oportunidades com nota na tramitação — passe o mouse na oportunidade para ler">' +
      IC.chat + 'Possui tramitação<span class="n">' + n + '</span></button>';
  }
  // os filtros da lista (quadro = false) ou do quadro
  function renderFiltros(quadro) { renderPortais(quadro); renderUnidades(quadro); renderDonos(quadro); renderTram(quadro); }
  function algumFiltro() { return !!(S.portal || S.unidade || S.dono || S.tramitacao || S.busca.trim()); }
  // o que está filtrado, para o cabeçalho (' · Bionexo · Jonas · com tramitação')
  function textoFiltros() {
    var dono = S.dono ? (S.dono === '(sem)' ? 'sem responsável' : ((S.casos.filter(function (c) { return donoK(c) === S.dono; })[0] || {}).dono || {}).nome || S.dono) : '';
    return [S.portal, S.unidade, dono, S.tramitacao ? 'com tramitação' : '', S.busca.trim() ? 'busca "' + S.busca.trim() + '"' : ''].filter(Boolean).map(function (x) { return ' · ' + esc(x); }).join('');
  }
  // a faixa de quem não teve a unidade confirmada no Power BI (não vê cotação nenhuma)
  function faixaUnidade() {
    var eu = S.eu || {};
    if (eu.admin || !S.carregou || !S.configurado) return '';
    var fora = C.foraDoSubmodulo(eu);
    if (fora) return fora;
    if (!eu.unidadeConfirmada) return '<b>Não consegui confirmar a sua unidade de negócio no Power BI</b>: ' + esc(eu.unidadeMotivo || 'sem resposta') + '. Você só vê as oportunidades da sua unidade — sem ela, nenhuma aparece. <button type="button" class="cs-btn cs-btn-xs" data-act="pbi-conectar">Conectar ao Power BI</button>';
    if (!(eu.unidades || []).length) return '<b>O Power BI não mostra nenhuma unidade de negócio para você no Comercial.</b> Você só vê as oportunidades da sua unidade — fale com quem cuida do acesso ao BI.';
    return '';
  }
  function conectarPbi() {
    var p = W.VOZPBI && W.VOZPBI.connect ? W.VOZPBI.connect() : Promise.resolve();
    Promise.resolve(p).catch(function () {}).then(function () { C.esquecerTokenPbi(); return carregar(true); });
  }
  // a tramitação (as notas) da cotação: passar o mouse mostra (23/10/2026)
  function chipTram(c) { return c.nNotas > 0 ? '<span class="cot-tram" title="' + c.nNotas + ' nota(s) na tramitação — passe o mouse para ler">' + IC.chat + c.nNotas + '</span>' : ''; }
  var COR_AMOSTRA = '#7C3AED';
  // 26/10/2026 (pedido do usuário): a fase da amostra — Envio de amostra
  // (roxo), Ganha (verde) ou Perdida (vermelho); fica sempre fora das contas
  function chipAmostra(c) {
    var id = C.faseDe(Object.assign({ amostra: true }, c)), g = id === 'amostra_ganha', p = id === 'amostra_perdida';
    return '<span class="cs-chip cot-chip-amostra' + (g ? ' am-ganha' : p ? ' am-perdida' : '') + '" title="' + esc('Amostra' + (c.amostraDe ? ' de ' + c.amostraDe : '') + ' · ' + C.fase(id).nome + ' — fora das contas') + '">' +
      IC.amostra + (g ? 'Amostra ganha' : p ? 'Amostra perdida' : 'Envio de amostra') + '</span>';
  }
  function linhaHtml(c, chegou) {
    var f = C.fase(c.fase), pr = C.prazoDe(c, aviso());
    var sub = '<span class="cs-chip portal">' + esc(c.portal || 'sem portal') + '</span>' + (c.cotacaoId ? 'nº ' + esc(c.cotacaoId) : '') +
      (S.multiUnidade ? ' <i>· ' + esc(c.unidade || 'sem unidade') + '</i>' : '') +
      // o código do cliente no Dynamics (21/10/2026 — a busca também acha por ele)
      (c.cliente && c.cliente.codigo ? ' <i>· cód. <b class="cot-cod-cli">' + esc(c.cliente.codigo) + '</b></i>' : '') +
      ' <i>· ' + c.nItens + ' item(ns)' + (c.cliente && c.cliente.uf ? ' · ' + esc(c.cliente.uf) : '') + '</i>';
    // 29/10/2026 (pedido do usuário): o paciente da A faturar à vista, numa linha só dele
    var pac = c.paciente && !c.amostra && (c.fase === 'faturar' || c.fase === 'pedido') ?
      '<span class="cot-pac' + (naoInformado(c.paciente) ? ' ni' : '') + '" title="' + esc('Paciente: ' + c.paciente) + '">' + IC.user + 'Paciente <b>' + esc(c.paciente) + '</b></span>' : '';
    var val = '<b>' + C.brl(c.total) + '</b>' + ((c.fase === 'pedido' || c.fase === 'faturar') && c.totalPedido ? '<small class="ped">pedido ' + C.brlCurto(c.totalPedido) + (c.oc ? ' · OC ' + esc(c.oc) : '') + '</small>' : '<small>cotado</small>');
    var prazo = temPedido(c) && C.aberta(c.fase) ? '<span class="tk-vazio">pedido registrado</span>' : f.faturar ? '<span class="tk-vazio">a faturar</span>' : pr && !pr.semData ? C.chipPrazo(c, aviso()) : (!C.aberta(c.fase) && c.fechadoEm ? '<span class="tk-vazio">' + esc((c.fase === 'pedido' ? 'Pedido ' : c.amostra ? C.fase(c.fase).curto + ' ' : 'Fechada ') + C.quando(c.fechadoEm)) + '</span>' : '<span class="tk-vazio">—</span>');
    return '<div class="cot-row' + (chegou ? ' chegou' : '') + (c.descartado ? ' desc' : '') + '" role="row" tabindex="0" data-num="' + esc(c.numero) + '" style="--c:' + (c.descartado ? '#95A4AB' : f.cor) + '">' +
      '<span class="cot-c cot-c-num" role="cell"><b class="cs-mono">' + esc(c.numero) + '</b><small title="Registrada ' + esc(C.dataBR(c.criadoEm, true)) + '">' + esc(C.chegada(c.criadoEm)) + '</small></span>' +
      '<span class="cot-c cot-c-cli" role="cell"><b>' + esc((c.cliente && c.cliente.nome) || 'Cliente não informado') + '</b><small>' + sub + '</small>' + pac + '</span>' +
      '<span class="cot-c cot-c-val" role="cell">' + val + '</span>' +
      '<span class="cot-c cot-c-prazo" role="cell">' + prazo + '</span>' +
      '<span class="cot-c cot-c-fase" role="cell">' + (c.descartado ? '<span class="cs-chip descartada">Descartada</span>' : (c.amostra ? chipAmostra(c) : C.chipFase(c.fase) + C.chipPi(c))) + chipTram(c) + '</span>' +
      '<span class="cot-c cot-c-dono" role="cell">' + (c.dono ? C.avatar(c.dono.nome, c.dono.email, 'p') + '<span>' + esc(C.primeiroNome(c.dono.nome) || c.dono.email) + '</span>' : '<span class="tk-sem">Sem responsável</span>') + '</span>' +
    '</div>';
  }
  function renderLista(chegaram) {
    renderVisoes(); renderFiltros(false);
    var el = $('cot-tabela'), cab = $('cot-cab'); if (!el) return;
    var l = lista(), v = VISOES.filter(function (x) { return x.id === S.visao; })[0];
    var soma = l.reduce(function (s, c) { return s + (c.total || 0); }, 0);
    var ordTxt = { prazo: 'pelo prazo', recentes: 'mais recentes primeiro', chegada: 'em ordem de chegada', valor: 'maior valor primeiro', atividade: 'por última atividade' }[S.ordem] || '';
    if (cab) cab.innerHTML = '<span><b>' + (S.carregou ? C.int(l.length) : '–') + '</b> oportunidade(s) · ' + esc(v.nome) + textoFiltros() +
      (l.length ? ' · <b>' + C.brlCurto(soma) + '</b> ' + (S.visao === 'amostras' ? 'nas amostras (fora das contas)' : 'cotados') : '') + ' · ' + esc(ordTxt) + '</span>' +
      (algumFiltro() ? '<button type="button" class="cs-btn cs-btn-xs cs-btn-ghost" id="cot-limpar">Limpar filtros</button>' : '');
    if (!S.carregou) { el.innerHTML = '<div class="cs-esqueleto"></div><div class="cs-esqueleto"></div><div class="cs-esqueleto"></div>'; return; }
    if (!l.length) {
      var eu = S.eu || {}, semUnidade = !eu.admin && (!eu.unidadeConfirmada || !(eu.unidades || []).length);
      var tx = S.configurado === false ? 'O armazenamento das Oportunidades ainda não foi configurado (COT_MSB_BLOB_URL).'
        : semUnidade ? 'Sem a sua unidade de negócio confirmada no Power BI, nenhuma oportunidade aparece — você só vê as da sua unidade.'
        : S.busca ? 'Nenhuma oportunidade com "' + esc(S.busca) + '".'
        : !S.casos.length ? 'Nenhuma oportunidade registrada ainda. Use o <a href="comercial-cot-nova.html">Agente de Oportunidades</a> para trazer a primeira.'
        : 'Nada nesta fila agora.';
      el.innerHTML = '<div class="cs-vazio"><div class="ic">' + C.svg('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>', 30) + '</div><h3>' + (semUnidade ? 'Unidade não confirmada' : S.busca ? 'Sem resultado' : 'Tudo em dia') + '</h3>' + tx + '</div>';
      return;
    }
    var MAX = 300;
    el.innerHTML = '<div class="cot-th" role="row"><span>Oportunidade · entrada</span><span>Cliente e portal</span><span class="n" style="text-align:right">Valor</span><span>Prazo</span><span>Fase</span><span>Responsável</span></div>' +
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
    // 23/10/2026: aberto do quadro ou do histórico, o "voltar" leva para lá
    if (!S.caso && !S.abrindo) S.deAba = S.aba === 'quadro' || S.aba === 'historico' ? S.aba : '';
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
    var volta = S.deAba; S.deAba = '';
    if (volta) { irAba(volta); return; }
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
    // 21/10/2026: só três fases (a Perdida é a saída); 26/10/2026: + A faturar,
    // depois de Cotada — e a amostra com as dela: Envio de amostra → Ganha (ou Perdida)
    var ordem = c.amostra ? ['amostra', 'amostra_ganha'] : ['cotada', 'faturar', 'pedido'], fim = ordem[ordem.length - 1], saida = c.amostra ? 'amostra_perdida' : 'perdida';
    var idx = ordem.indexOf(c.fase), perdeu = f.perdida;
    var path = ordem.map(function (id, i) {
      var cls = perdeu ? '' : i < idx ? 'feito' : i === idx ? 'atual' + (id === fim ? ' fim' : '') : '';
      return '<button type="button" class="' + cls + '" data-fase="' + id + '" title="Mudar para: ' + esc(C.fase(id).nome) + '"' + (c.descartado ? ' disabled' : '') + '>' +
        ((!perdeu && (i < idx || (i === idx && id === fim))) ? IC.check : '') + esc(C.fase(id).curto) + '</button>';
    }).join('');
    // a saída: Perdida (o motivo diz se foi preço, prazo, proposta vencida, cancelada…)
    var saidas = '<div class="cot-saidas"><button type="button" data-fase="' + saida + '" class="' + (c.fase === saida ? 'on' : '') + '"' + (c.descartado ? ' disabled' : '') + ' title="' + (c.amostra ? 'Marcar a amostra como perdida — o motivo é opcional; ela fica na Amostra' : 'Marcar como perdida — com o motivo') + '">Perdida</button></div>';
    var cli = c.cliente || {}, ped = c.pedido;
    var local = [cli.cidade, cli.uf].filter(Boolean).join('/');
    var prazoBox = f.faturar
      ? '<div class="tk-hero-conta"><small>Data de vencimento</small><b>' + (r.validade ? esc(C.diaBR(r.validade, true)) : 'sem data') + '</b><span>em A faturar, o prazo não conta</span></div>'
      : pr && !pr.semData
      ? '<div class="tk-hero-conta ' + (pr.nivel === 2 ? 'vencido' : pr.nivel === 1 ? 'alerta' : '') + '"><small>Data de vencimento</small><b>' + esc(pr.txt) + '</b><span>' + esc(pr.quando ? C.quando(pr.quando.toISOString()) : '') + '</span></div>'
      : '<div class="tk-hero-conta vazio"><small>Data de vencimento</small><b>' + (C.aberta(c.fase) ? 'sem data' : (c.fechadoEm ? 'Fechada ' + esc(C.dataBR(c.fechadoEm)) : '—')) + '</b><span>' + (C.aberta(c.fase) ? 'informe em "Detalhes"' : esc(C.quando(c.fechadoEm))) + '</span></div>';
    var pedBox = ped
      ? '<div class="tk-hero-conta ganho"><small>Pedido</small><b class="grande">' + C.brl((ped.previa && ped.previa.total) || ped.total || 0) + '</b><span>' + esc(ped.oc ? 'OC ' + ped.oc : ped.nome) + ((c.ovs || []).length ? ' · ' + c.ovs[0].numero + (c.ovs.length > 1 ? ' +' + (c.ovs.length - 1) : '') : c.pi && c.pi.estado === 'enviado' ? ' · aguardando OV' : c.fase === 'pedido' ? ' · ganha' : ' · aguardando a OV') + '</span></div>'
      : '<div class="tk-hero-conta"><small>Responsável</small><b>' + (c.dono ? esc(c.dono.nome) : 'Sem responsável') + '</b><span>' + (c.dono ? esc(c.dono.email) : 'clique em Assumir') + '</span></div>';
    return '<section class="cs-card tk-hero" style="--c:' + (c.descartado ? '#95A4AB' : f.cor) + '">' +
      '<div class="tk-hero-l1"><span class="cs-d-num" id="cot-copiar" title="Copiar o número e o link">' + esc(c.numero) + IC.copy + '</span>' +
        (c.descartado ? '<span class="cs-chip descartada">Descartada</span>' : (c.amostra ? chipAmostra({ amostraDe: c.amostra.de, fase: c.fase }) : C.chipFase(c.fase))) + '<span class="cs-chip portal">' + esc(c.portal || 'sem portal') + '</span>' +
        '<span class="cs-chip portal" title="Unidade de negócio">' + esc(c.unidade || 'sem unidade') + '</span>' +
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
      return '<div class="cot-faixa-fim descartada">' + IC.ban + '<div><b>Oportunidade descartada</b>' + esc(d.motivo || 'registrada por engano') + ' · ' + esc((d.por && d.por.nome) || '') + ' · ' + esc(C.dataBR(d.em, true)) + '. Fica fora das filas e do funil.</div>' +
        '<button type="button" class="cs-btn cs-btn-sm" data-act="restaurar">' + IC.refresh + 'Restaurar</button></div>';
    }
    // 23/10/2026: a amostra diz de onde veio e que não conta
    // 26/10/2026: e o resultado — ganha (verde) ou perdida (vermelho), sem sair da Amostra
    if (c.amostra) {
      var a = c.amostra, ag = c.fase === 'amostra_ganha', ap = c.fase === 'amostra_perdida', pa = c.perda || {};
      return '<div class="cot-faixa-fim amostra' + (ag ? ' am-ganha' : ap ? ' am-perdida' : '') + '">' + (ag ? IC.trophy : ap ? IC.xc : IC.amostra) +
        '<div><b>' + (ag ? 'Amostra ganha' : ap ? 'Amostra perdida' + (pa.motivo ? ' · ' + esc(pa.motivo) : '') : 'Envio de amostra') + (a.de ? ' · da oportunidade ' + esc(a.de) : '') + '</b>' +
        (ap && pa.obs ? esc(pa.obs) + '. ' : '') +
        'Cópia da oportunidade perdida' + (a.motivo ? ' (' + esc(a.motivo) + ')' : '') + ' para a gestão — <strong>não conta</strong> nas cotadas, nos valores, nas filas, no funil nem no analítico' +
        (ag || ap ? ', e fica na Amostra (fora das ' + (ag ? 'Ganhas' : 'Perdidas') + '). ' : '. ') +
        esc((a.por && a.por.nome) || '') + (a.em ? ' · ' + esc(C.dataBR(a.em, true)) : '') + '.</div>' +
        (a.de ? '<button type="button" class="cs-btn cs-btn-sm" data-abrir="' + esc(a.de) + '">' + IC.eye + 'Abrir a original</button>' : '') + '</div>';
    }
    if (c.fase !== 'perdida') return '';
    var p = c.perda || {}, ams = (c.amostras || []).map(function (x) { return x.numero; });
    return '<div class="cot-faixa-fim perdida">' + IC.xc + '<div><b>Oportunidade perdida' + (p.motivo ? ' · ' + esc(p.motivo) : '') + '</b>' +
      [p.concorrente ? 'Concorrente: ' + esc(p.concorrente) : '', p.valorConcorrente ? 'Preço do concorrente: ' + C.brl(p.valorConcorrente) : '', p.obs ? esc(p.obs) : '',
        esc((p.por && p.por.nome) || '') + (p.em ? ' · ' + esc(C.dataBR(p.em, true)) : '')].filter(Boolean).join(' · ') + '. Virou pedido? Use <b>Virou pedido</b> no topo.' +
      (ams.length ? '<span class="cot-am-links">Amostra: ' + ams.map(function (n) { return '<button type="button" class="cot-link" data-abrir="' + esc(n) + '">' + esc(n) + '</button>'; }).join(', ') + '</span>' : '') + '</div>' +
      '<div class="cot-faixa-bts"><button type="button" class="cs-btn cs-btn-sm" data-act="reabrir">' + IC.refresh + 'Reabrir</button>' +
      (c.descartado ? '' : '<button type="button" class="cs-btn cs-btn-sm cot-btn-amostra" data-act="amostra" title="Criar uma cópia como amostra — a original continua Perdida">' + IC.amostra + (ams.length ? 'Outra amostra' : 'Criar amostra') + '</button>') + '</div></div>';
  }

  // o cartão do PEDIDO: soltar o PDF do pedido do portal = a cotação vira pedido
  // (também na VENCIDA — 20/10/2026: o pedido entra mesmo com a data passada)
  function htmlPedido(c) {
    if (c.descartado || c.fase === 'perdida' || c.amostra) return '';
    var ped = c.pedido, pi = c.pi || {};
    var temOvs = !!(ped && (c.ovs || []).length);
    var noPi = !!ped && (pi.estado === 'enviado' || pi.estado === 'em_andamento');
    var passo = function (on, txt) { return '<span class="' + (on ? 'on' : '') + '">' + txt + '</span>'; };
    var fluxo = '<div class="cs-pi-fluxo"><span class="on">Oportunidade</span><i>→</i>' + passo(!!ped, 'Pedido do portal') + '<i>→</i>' + passo(noPi, 'PI · Pedido') + '<i>→</i>' +
      passo(!!ped && (pi.estado === 'enviado' || temOvs), 'Dynamics') + '<i>→</i>' + passo(temOvs, 'Ordem de Venda') + '</div>';
    var h = '<div class="cs-card cot-ped"><h5>' + IC.cart + 'Pedido</h5>' + fluxo;
    if (!ped) {
      // 21/10/2026 (pedido do usuário): as duas alternativas ao PDF aqui também
      return h + '<h4>A oportunidade virou pedido?</h4><p>Solte o PDF do pedido que o portal gerou — o portal lê, compara com o que foi cotado e deixa pronto para o PI · Pedido. Sem o PDF? Registre <b>à mão</b> (os itens ganhos são o pedido) ou, se o pedido já foi feito no Dynamics, <b>amarre a Ordem de Venda</b>.</p>' +
        '<label class="cot-drop" id="cot-drop-ped" tabindex="0"><input type="file" id="cot-arq-ped" accept="application/pdf,.pdf" hidden><span class="ic">' + IC.upload + '</span><b>Soltar o PDF do pedido</b><small>ou clique para escolher · .pdf</small></label>' +
        '<div class="cot-ped-alt"><button type="button" class="cs-btn" data-act="ped-manual">' + IC.edit + 'À mão, sem o PDF</button>' +
        '<button type="button" class="cs-btn" data-act="ped-ov">' + IC.tag + 'Já tenho a Ordem de Venda</button></div></div>';
    }
    // o pedido à mão (21/10/2026): sem PDF — os itens ganhos são o pedido
    var arq = ped.manual
      ? '<div class="cs-pi-arq">' + IC.edit + '<b>' + (ped.viaOv ? 'Pedido já lançado no Dynamics (pela Ordem de Venda)' : 'Pedido registrado à mão') + '</b><span class="cot-ped-man">' +
        esc([ped.oc ? 'OC ' + ped.oc : '', ped.total ? C.brl(ped.total) + ' em itens ganhos' : ''].filter(Boolean).join(' · ') || 'sem o PDF') + '</span></div>'
      : '<div class="cs-pi-arq">' + IC.pdf + '<b>' + esc(ped.nome || 'Pedido.pdf') + '</b><button type="button" class="cs-btn cs-btn-xs" data-ver-anexo="' + esc(ped.anexoId) + '">' + IC.eye + 'Ver</button></div>';
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
    var texto = ped.manual ? '<p>Sem o PDF: os itens ganhos da oportunidade são o pedido. <b>Abrir no PI · Pedido</b> leva o comprador e esses itens prontos para conferir e lançar no Dynamics.</p>'
      : (erro || '<p>PDF do pedido anexado. O portal lê e entrega pronto para o PI conferir e lançar no Dynamics.</p>');
    return h + arq + (pv ? prev : texto) + andamento +
      '<div class="cot-ped-bts"><button type="button" class="cs-btn cs-btn-pi" data-act="abrir-pi">' + IC.cart + (pi.estado === 'em_andamento' ? 'Abrir no PI de novo' : 'Abrir no PI · Pedido') + '</button>' +
      (!pv && !ped.manual ? '<button type="button" class="cs-btn cs-btn-sm cs-btn-ghost" data-act="ler-pedido">' + IC.refresh + 'Ler o pedido agora</button>' : '') +
      '<label class="cs-btn cs-btn-sm cs-btn-ghost" style="cursor:pointer">' + IC.upload + (ped.manual ? 'Anexar o PDF do pedido' : 'Trocar o PDF') + '<input type="file" id="cot-arq-ped" accept="application/pdf,.pdf" hidden></label></div>' + htmlOv(c) + '</div>';
  }
  // a ORDEM DE VENDA: a cotação fecha com o número da OV do Dynamics (do PI
  // ou do pedido lançado à mão). O portal confere a OV no Dynamics antes de
  // gravar; pode haver mais de uma (pedido quebrado).
  function htmlOv(c) {
    if (c.descartado || !c.pedido) return '';
    var ovs = c.ovs || [], num = c.numero, est = S.ovEnvio[num] || {};
    var lancado = c.pi && c.pi.estado === 'enviado';
    var h = '<div class="cot-ov' + (ovs.length ? ' fechada' : '') + '">';
    if (ovs.length) {
      h += '<div class="cot-ov-h">' + IC.lock + '<div><b>Oportunidade fechada' + (ovs.length > 1 ? ' com ' + ovs.length + ' Ordens de Venda' : ' com a Ordem de Venda') + '</b>' +
        esc((ovs[0].por && ovs[0].por.nome) || '') + ' · ' + esc(C.dataBR(ovs[0].em, true)) + '</div></div>' +
        '<div class="cot-ov-lista">' + ovs.map(function (o) { return htmlOvLinha(c, o); }).join('') + '</div>';
    } else {
      // 22/10/2026 (pedido do usuário): o pedido registrado não é Ganha — a OV é que fecha
      h += '<div class="cot-ov-h">' + IC.tag + '<div><b>' + (lancado ? 'Feche a oportunidade com a Ordem de Venda' : 'A oportunidade fecha como Ganha com a Ordem de Venda') + '</b>' +
        (lancado ? 'Quando o pedido virar Ordem de Venda no Dynamics, informe o número aqui (o fluxo do PI também devolve sozinho) — o portal confere a OV e a oportunidade fecha como Ganha.'
          : 'O pedido está registrado; a oportunidade segue aberta. Mande pelo PI · Pedido — a OV volta do fluxo — ou, se lançou direto no Dynamics, informe a OV aqui.') + '</div></div>';
    }
    var aberto = !ovs.length || S.ovMais[num];
    if (est.estado === 'conferindo') {
      h += '<p class="cot-ov-msg"><span class="cs-spin"></span>&nbsp; Conferindo a ' + esc(est.ov || 'OV') + ' no Dynamics…</p>';
    } else if (aberto) {
      var val = S.ovRascunho[num] != null ? S.ovRascunho[num] : '';
      h += '<div class="cot-ov-form"><input id="cot-ov-num" value="' + esc(val) + '" placeholder="OVMSB144950" autocomplete="off" spellcheck="false" maxlength="24" aria-label="Número da Ordem de Venda">' +
        '<button type="button" class="cs-btn cs-btn-sm cs-btn-pi" data-act="ov-fechar">' + (ovs.length ? IC.plus + 'Adicionar OV' : IC.check + 'Fechar como Ganha') + '</button>' +
        (ovs.length ? '<button type="button" class="cs-btn cs-btn-sm cs-btn-ghost" data-act="ov-mais-x">Cancelar</button>' : '') + '</div>' +
        (est.estado === 'erro' ? '<p class="cot-ov-msg erro">' + IC.alert + esc(est.msg) + '</p>' : '<p class="cot-ov-msg">OVMSB e os números — ou só os números. Pedido quebrado em mais de uma OV? Adicione as outras depois.</p>');
    } else {
      h += '<div class="cot-ped-bts"><button type="button" class="cs-btn cs-btn-sm cs-btn-ghost" data-act="ov-mais">' + IC.plus + 'Outra OV</button></div>';
    }
    if (!ovs.length && !lancado && c.fase !== 'pedido') h += '<div class="cot-ped-bts"><button type="button" class="cs-btn cs-btn-sm cs-btn-ghost" data-act="ped-desfazer" title="Tirar o pedido e o resultado dos itens — a oportunidade volta para Cotada">' + IC.x + 'Desfazer o pedido</button></div>';
    return h + '</div>';
  }
  function htmlOvLinha(c, o) {
    var v = o.dynamics, conf, tom = 'ok', av = o.avisos || [];
    if (!v) { conf = 'sem conferência — Dynamics desligado no portal'; tom = 'mut'; }
    else if (v.erro) { conf = 'sem conferência — o Dynamics não respondeu (' + v.erro + ')'; tom = 'mut'; }
    else if (!v.achou) { conf = o.origem === 'flow' ? 'não encontrada no Dynamics na hora da conferência' : 'não encontrada no Dynamics — registrada mesmo assim'; tom = 'warn'; }
    else {
      conf = [v.cliente ? 'cliente ' + v.cliente + (v.nome ? ' · ' + v.nome : '') : '', v.oc ? 'OC ' + v.oc : '', v.situacao,
        v.itens ? v.itens + ' item(ns)' : '', v.total ? C.brl(v.total) + (c.total ? ' (' + C.pct(v.total / c.total, 0) + ' do cotado)' : '') : ''].filter(Boolean).join(' · ') || 'encontrada no Dynamics';
      if (o.confirmada) tom = 'warn';
      // a OV que o flow devolveu não pede confirmação: o que a conferência estranhou aparece aqui
      if (av.length) { tom = 'warn'; conf += ' · aviso: ' + av.join('; '); }
    }
    return '<div class="cot-ov-linha ' + tom + '"><span class="ic">' + (tom === 'warn' ? IC.alert : tom === 'mut' ? IC.info : IC.checkc) + '</span>' +
      '<div class="tx"><b class="cs-mono">' + esc(o.numero) + '</b><small>' + esc(conf) + '</small>' +
      '<small class="quem">' + esc((o.por && o.por.nome) || '') + ' · ' + esc(C.dataBR(o.em, true)) + (o.origem === 'manual' ? ' · lançada fora do PI' : o.origem === 'flow' ? ' · devolvida pelo flow do PI' : '') + (o.confirmada ? ' · registrada mesmo com o aviso' : '') + '</small></div>' +
      '<button type="button" class="cs-btn cs-btn-xs cs-btn-ghost" data-tirar-ov="' + esc(o.numero) + '" title="Tirar esta OV (registrada por engano)">' + IC.x + '</button></div>';
  }
  function htmlComparacao(c) {
    var pv = c.pedido && c.pedido.previa;
    if (!pv || !(pv.produtos || []).length || !(c.itens || []).length) return '';
    var cmp = C.comparar(c.itens, pv.produtos);
    var st = { ok: ['ok', 'igual'], dif: ['dif', 'diferente'], fora: ['fora', 'não pedido'], extra: ['extra', 'fora da oportunidade'] };
    var linhas = cmp.linhas.slice(0, 14).map(function (l) {
      var x = l.cot || l.ped, nome = (l.cot && l.cot.descricao) || (l.ped && l.ped.descricao) || (x && x.codigo) || '';
      var cotTxt = l.cot ? C.qtd(l.cot.quantidade) + ' × ' + C.brl(l.cot.valorUnitario) : '—';
      var pedTxt = l.ped ? C.qtd(l.ped.quantidade) + ' × ' + C.brl(l.ped.valorUnitario) : '—';
      var obs = l.st === 'dif' ? [!l.mesmaQtd ? 'qtd' : '', !l.mesmoPreco ? 'preço' : ''].filter(Boolean).join(' e ') + ' mudou' : '';
      var tag = '<span class="st ' + st[l.st][0] + '">' + st[l.st][1] + '</span>';
      return '<tr><td>' + esc(nome) + tag.replace('class="st ', 'class="st st-m ') + (obs ? '<small>' + esc(obs) + '</small>' : '') + '</td>' +
        '<td class="n" data-l="Cotado">' + cotTxt + '</td><td class="n" data-l="Pedido">' + pedTxt + '</td><td class="st-c">' + tag + '</td></tr>';
    }).join('');
    return '<div class="cot-cmp"><div class="cot-cmp-h">Oportunidade × pedido' +
      (cmp.ok ? '<span class="tag ok">' + cmp.ok + ' igual(is)</span>' : '') + (cmp.dif ? '<span class="tag dif">' + cmp.dif + ' com diferença</span>' : '') +
      (cmp.fora ? '<span class="tag fora">' + cmp.fora + ' não pedido(s)</span>' : '') + (cmp.extra ? '<span class="tag fora">' + cmp.extra + ' fora da oportunidade</span>' : '') + '</div>' +
      '<table><thead><tr><th>Item</th><th style="text-align:right">Cotado</th><th style="text-align:right">Pedido</th><th></th></tr></thead><tbody>' + linhas + '</tbody></table></div>';
  }

  // o cartão da PROPOSTA: o PDF no modelo da Biomedical (cotacoes-proposta.js)
  // com os dados do caso e de quem está logado; sai pelo Outlook da pessoa
  function htmlProposta(c) {
    // 26/10/2026 (pedido do usuário): a amostra não gera a proposta (PDF)
    if (c.descartado || c.amostra || !W.COTPROP) return '';
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
      h += '<p>A proposta no modelo da Biomedical — dados desta oportunidade e os seus no "Preparado por" — pronta para o comprador. A descrição, o fabricante e o RMS de cada item saem do cadastro do Salesforce.' + (fechada ? ' A oportunidade está ' + esc(C.fase(c.fase).nome.toLowerCase()) + '.' : '') + '</p>';
    }
    if (est.estado === 'enviando') return h + '<p><span class="cs-spin"></span>&nbsp; Gerando o PDF e enviando pelo seu Outlook…</p></div>';
    if (est.estado === 'erro') h += '<div class="cot-envio erro" style="margin:8px 0">' + IC.alert + '<div><b>A proposta não foi enviada</b>' + esc(est.msg) + '</div></div>';
    var setor = C.contatoDoSetor(c.unidade), ex = extrasDe(c);
    if (setor) h += '<p class="cot-prop-setor-l">' + IC.info + 'Sai com o contato do setor <b>' + esc(setor.setor) + '</b> — ' + esc(setor.email) + ' · ' + esc(setor.telefone) + ' — e pela caixa dele.</p>';
    h += '<div id="cot-prop-extras">' + C.htmlExtras(ex.arquivos, anexosParaExtra(c).map(function (a) { return { id: a.id, nome: a.nome, tamanho: a.tamanho, on: !!ex.doCaso[a.id] }; })) + '</div>';
    // 29/10/2026 (pedido do usuário): o nome do comprador no envio — o contato da
    // cotação: sai no PDF ("Nome completo") e no "Prezado(a)" do e-mail
    return h + '<div class="cot-prop-acoes"><input id="cot-prop-nome" value="' + esc(nomeComprador(c)) + '" placeholder="nome do comprador" autocomplete="off" aria-label="Nome do comprador">' +
      '<input id="cot-prop-para" value="' + esc(para) + '" placeholder="e-mail do comprador" autocomplete="off" aria-label="E-mail do comprador">' +
      '<button type="button" class="cs-btn cs-btn-sm" data-act="prop-ver">' + IC.eye + 'Ver</button>' +
      '<button type="button" class="cs-btn cs-btn-sm cs-btn-p" data-act="prop-enviar">' + IC.arrow + (ult ? 'Reenviar' : 'Enviar proposta') + '</button></div></div>';
  }
  function nomeComprador(c) { var v = S.propNome[c.numero]; return v != null ? String(v).trim() : ((c.contato && c.contato.nome) || ''); }
  // a cotação com o nome do comprador digitado (o PDF e o e-mail saem com ele)
  function comNomeDigitado(c) {
    var nome = nomeComprador(c);
    return nome === ((c.contato && c.contato.nome) || '') ? c : Object.assign({}, c, { contato: Object.assign({}, c.contato || {}, { nome: nome }) });
  }
  // os outros arquivos da proposta: os escolhidos no computador e os do caso marcados
  function extrasDe(c) { return S.propExtras[c.numero] || (S.propExtras[c.numero] = { arquivos: [], doCaso: {} }); }
  function anexosParaExtra(c) { return (c.anexos || []).filter(function (a) { return !a.removido && a.tipo !== 'proposta'; }); }
  function pintarExtras(c) {
    var el = $('cot-prop-extras'); if (!el) return;
    var ex = extrasDe(c);
    el.innerHTML = C.htmlExtras(ex.arquivos, anexosParaExtra(c).map(function (a) { return { id: a.id, nome: a.nome, tamanho: a.tamanho, on: !!ex.doCaso[a.id] }; }));
  }
  function operador(c) {
    var eu = S.eu || {};
    return { nome: eu.nome || '', email: eu.email || '', area: (c && c.area) || eu.area || eu.departamento || '', telefone: C.formatar('fone', C.lerLocal('cot-prop-tel') || eu.telefone || '') };
  }
  function verProposta(c) {
    if (c.amostra) return;
    var janela = W.open('', '_blank');
    if (janela) { try { janela.document.title = 'Proposta ' + c.numero; janela.document.body.innerHTML = '<p style="font:15px system-ui;padding:40px;color:#0F2831">Gerando a proposta…</p>'; } catch (e) {} }
    W.COTPROP.gerar(comNomeDigitado(c), operador(c)).then(function (pdf) {
      var url = URL.createObjectURL(pdf.blob);
      if (janela && !janela.closed) janela.location.href = url; else W.open(url, '_blank');
      setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
    }).catch(function (e) { if (janela && !janela.closed) janela.close(); C.toast('Não consegui gerar a proposta', e.message, 'erro'); });
  }
  function enviarProposta(c) {
    if (c.amostra) return;
    var P = W.COTPROP, num = c.numero;
    var para = P.listaEmails(S.propPara[num] != null ? S.propPara[num] : ((c.contato && c.contato.email) || ''));
    if (!para.length) { S.propEnvio[num] = { estado: 'erro', msg: 'Informe o e-mail do comprador.' }; renderCaso(); return; }
    S.propEnvio[num] = { estado: 'enviando' }; renderCaso();
    var ex = extrasDe(c), ids = Object.keys(ex.doCaso).filter(function (k) { return ex.doCaso[k]; });
    var cc = comNomeDigitado(c);
    // o token no clique (o consentimento da primeira vez abre um popup)
    P.autorizar().then(function () {
      // o nome do comprador mudou aqui: grava no caso antes (29/10/2026)
      if (cc === c) return null;
      return C.api('cot-casos', { acao: 'campos', numero: num, campos: { contato: { nome: cc.contato.nome } } }).then(function (j) { if (j && j.caso) { mesclar(j.caso); cc = j.caso; } });
    }).then(function () {
      return Promise.all(ids.map(function (id) { return C.baixarAnexo(num, id).then(function (a) { return { nome: a.nome, tipo: a.tipo || 'application/octet-stream', tamanho: a.tamanho, base64: a.base64 }; }); }));
    }).then(function (doCaso) { return P.enviar(cc, operador(cc), { para: para, anexos: ex.arquivos.concat(doCaso) }); }).then(function (r) {
      S.propEnvio[num] = {};
      S.propExtras[num] = null;
      S.propNome[num] = null;
      if (r.caso) mesclar(r.caso);
      C.toast('Proposta enviada', para.join(', ') + (C.comoSaiu(r) ? ' · ' + C.comoSaiu(r) : '') + (r.erroRegistro ? ' — não registrou no caso: ' + r.erroRegistro : ''), r.erroRegistro ? 'erro' : 'ok');
      renderTudo();
    }).catch(function (e) {
      S.propEnvio[num] = { estado: 'erro', msg: e.message || String(e) };
      renderCaso();
    });
  }

  function htmlItens(c) {
    if (S.editandoItens) {
      var its = S.itensRascunho || [], comIpi = S.ipiEdicao || C.temIpi(its);
      return '<div class="cs-card"><h5>' + IC.list + 'Itens cotados · editando</h5>' +
        '<div class="cot-itens-w"><table class="cot-itens"><thead><tr><th class="cod">Cód. Biomedical</th><th class="codc">Cód. comprador</th><th>Descrição</th><th class="marca">Fabricante</th><th class="rms">RMS</th><th class="un">Un</th><th class="qtd n">Qtd</th><th class="vu n">Preço unit.</th>' +
        (comIpi ? '<th class="ipi n" title="O IPI de cada item, em % — sai na proposta">IPI %</th>' : '') + '<th class="vt n">Total</th><th class="res">Resultado do item</th><th class="x"></th></tr></thead><tbody>' +
        its.map(function (it, i) {
          var ruim = it._cod && (it._cod.st === 'nao' || (it._cod.st === 'vazio' && Number(it.valorUnitario) > 0));
          return '<tr data-i="' + i + '"' + (ruim ? ' class="cod-nao"' : it._cod && it._cod.st === 'ok' ? ' class="cod-ok"' : '') + '><td class="cod"><input data-f="codigo" value="' + esc(it.codigo) + '" autocomplete="off"><span class="cod-st-box">' + C.statusCodigo(it) + '</span></td><td class="codc"><input data-f="codigoCliente" value="' + esc(it.codigoCliente) + '"></td>' +
            '<td><input data-f="descricao" value="' + esc(it.descricao) + '"><span class="cot-sf-box">' + C.dicaSf(it) + '</span></td><td class="marca"><input data-f="marca" value="' + esc(it.marca) + '" placeholder="Fabricante"></td><td class="rms"><input data-f="registro" value="' + esc(it.registro || '') + '" placeholder="ANVISA" inputmode="numeric"></td><td class="un"><input data-f="unidade" value="' + esc(it.unidade) + '"></td>' +
            '<td class="qtd n"><input data-f="quantidade" inputmode="decimal" value="' + esc(it.quantidade ? C.qtd(it.quantidade) : '') + '"></td>' +
            '<td class="vu n"><input data-f="valorUnitario" inputmode="decimal" value="' + esc(it.valorUnitario ? it.valorUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '') + '"></td>' +
            (comIpi ? '<td class="ipi n"><input data-f="ipi" inputmode="decimal" value="' + esc(it.ipi ? String(it.ipi).replace('.', ',') : '') + '" placeholder="%" title="O IPI do item, em %"></td>' : '') +
            '<td class="vt tot" data-tot="' + i + '">' + (it.quantidade && it.valorUnitario ? C.brl(it.quantidade * it.valorUnitario) : '—') + '</td>' +
            '<td class="res"><select data-f="resultado" aria-label="Resultado do item"><option value="">—</option>' +
              ['ganho', 'perdido'].map(function (r) { return '<option value="' + r + '"' + (it.resultado === r ? ' selected' : '') + '>' + C.RESULTADOS[r] + '</option>'; }).join('') + '</select></td>' +
            '<td class="x"><button type="button" class="cs-btn cs-btn-xs cs-btn-ghost" data-tirar-item="' + i + '" title="Tirar">' + IC.x + '</button></td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="cot-itens-pe"><button type="button" class="cs-btn cs-btn-sm" data-act="item-mais">' + IC.plus + 'Item</button>' +
          '<span class="cot-tot-grp"><label class="cot-ipi-chk" title="Marque para informar o IPI de cada item (em %) — sai na proposta"><input type="checkbox" id="cot-ipi"' + (comIpi ? ' checked' : '') + '> Tem IPI?</label>' +
          '<span class="tot">Total<b id="cot-itens-total">' + C.brl(totalDe(its)) + '</b></span>' + htmlTotIpi(its, comIpi) + '</span></div>' +
        '<div class="cot-comp-pe"><button type="button" class="cs-btn cs-btn-sm" data-act="itens-cancelar">Cancelar</button><button type="button" class="cs-btn cs-btn-sm cs-btn-p" data-act="itens-salvar">' + IC.check + 'Salvar itens</button></div></div>';
    }
    var l = c.itens || [], lIpi = C.temIpi(l);
    var rs = l.map(function (it) { return C.resultadoItem(it.resultado, c.fase); });
    var vRes = { ganho: 0, perdido: 0 };
    l.forEach(function (it, i) { if (rs[i].r) vRes[rs[i].r] += (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0); });
    var nRes = function (r) { return rs.filter(function (x) { return x.r === r; }).length; };
    var totRes = (nRes('ganho') ? '<span class="g">' + C.int(nRes('ganho')) + ' ganho(s) · ' + C.brl(vRes.ganho) + '</span>' : '') +
      (nRes('perdido') ? '<span class="p">' + C.int(nRes('perdido')) + ' perdido(s) · ' + C.brl(vRes.perdido) + '</span>' : '');
    return '<div class="cs-card"><h5>' + IC.list + 'Itens cotados · ' + l.length + (c.descartado ? '' : '<button type="button" class="cs-btn cs-btn-xs" data-act="itens-editar">' + IC.edit + 'Editar</button>') + '</h5>' +
      htmlNaoPedidos(c) +
      (l.length ? '<div class="cot-itens-w"><table class="cot-itens ler"><thead><tr><th>Produto</th><th>Un</th><th class="n">Qtd</th><th class="n">Preço unit.</th>' + (lIpi ? '<th class="n">IPI</th>' : '') + '<th class="n">Total</th><th class="res">Resultado do item</th></tr></thead><tbody>' +
        l.map(function (it, i) {
          var cods = metaItem(it);
          return '<tr><td class="desc"><b>' + esc(it.descricao || it.codigo || '—') + '</b><small class="cot-it-meta" data-i="' + i + '"' + (cods ? '' : ' hidden') + '>' + esc(cods) + '</small><span class="cot-sf-box" data-sf-i="' + i + '">' + C.dicaSf(it) + '</span></td><td class="un">' + esc(it.unidade || '') + '</td>' +
            '<td class="n qtd">' + C.qtd(it.quantidade) + '</td><td class="n vu">' + (it.valorUnitario ? C.brl(it.valorUnitario) : '<span style="color:var(--cs-mut)">sem preço</span>') + '</td>' +
            (lIpi ? '<td class="n ipi">' + (C.ipiDe(it) ? C.pctIpi(C.ipiDe(it)) : '—') + '</td>' : '') +
            '<td class="n tot">' + (it.quantidade && it.valorUnitario ? C.brl(it.quantidade * it.valorUnitario) : '—') + '</td><td class="res">' + htmlResultado(c, i, rs[i]) + '</td></tr>';
        }).join('') + '</tbody><tfoot><tr><td colspan="' + (lIpi ? 5 : 4) + '" class="rot">Total cotado' + (lIpi ? ' (sem IPI)' : '') + '</td><td class="n tot">' + C.brl(c.total) + '</td><td class="res-tot">' + totRes + '</td></tr>' +
          (lIpi ? '<tr class="cot-ipi-tr"><td colspan="5" class="rot">IPI</td><td class="n tot">' + C.brl(C.totalIpi(l)) + '</td><td></td></tr>' +
            '<tr class="cot-ipi-tr"><td colspan="5" class="rot">Total com IPI</td><td class="n tot">' + C.brl((c.total || 0) + C.totalIpi(l)) + '</td><td></td></tr>' : '') + '</tfoot></table></div>'
        : '<p style="margin:0;font-size:13px;color:var(--cs-mut)">Nenhum item registrado. Clique em Editar para incluir.</p>') + '</div>';
  }
  // o IPI somado e o total com o IPI, ao lado do total (29/10/2026)
  function htmlTotIpi(its, comIpi) {
    if (!comIpi) return '<span id="cot-tot-ipi"></span>';
    var vi = C.totalIpi(its);
    return '<span id="cot-tot-ipi" class="cot-tot-ipi"><span class="tot">IPI<b>' + C.brl(vi) + '</b></span><span class="tot">Total com IPI<b>' + C.brl(totalDe(its) + vi) + '</b></span></span>';
  }
  // o RESULTADO DO ITEM: Ganho | Perdido. Sem marca, a fase da cotação diz
  // (Ganha = ganho; Perdida = perdido) e o botão
  // fica tracejado; clicar confirma. Clicar no marcado tira a marca. O
  // perdido marcado ganha o MOTIVO (opcional, a lista de motivos de perda —
  // vai para o "Por que perdi" do Analítico)
  function htmlResultado(c, i, rr) {
    var it = (c.itens || [])[i] || {};
    if (c.descartado) return rr.r ? '<span class="cot-res-chip ' + rr.r + '">' + C.RESULTADOS[rr.r] + (it.motivo ? ' · ' + esc(it.motivo) : '') + '</span>' : '<span class="cot-res-chip">—</span>';
    var bt = function (r) {
      var on = rr.r === r, nome = C.RESULTADOS[r];
      var tit = on && rr.implicito ? nome + ' pela fase da oportunidade (' + C.fase(c.fase).nome + ') — clique para confirmar'
        : on ? 'Marcado como ' + nome.toLowerCase() + (c.fase === 'pedido' || c.pedido ? '' : ' — clique de novo para tirar a marca') : 'Marcar o item como ' + nome.toLowerCase();
      return '<button type="button" class="' + r + (on ? (rr.implicito ? ' imp' : ' on') : '') + '" data-res="' + r + '" data-i="' + i + '" aria-pressed="' + (on && !rr.implicito) + '" title="' + esc(tit) + '">' + (r === 'ganho' ? IC.check : IC.x) + nome + '</button>';
    };
    var mot = '';
    if (rr.r === 'perdido' && !rr.implicito) {
      var l = ((S.cfg && S.cfg.motivosPerda) || []).slice();
      if (it.motivo && l.indexOf(it.motivo) < 0) l.unshift(it.motivo);
      mot = '<select class="cot-res-mot" data-res-mot="' + i + '" aria-label="Motivo da perda do item ' + (i + 1) + '" title="Por que este item foi perdido (opcional — vai para o Analítico)">' +
        '<option value="">Motivo da perda…</option>' + l.map(function (m) { return '<option' + (m === it.motivo ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') + '</select>';
    }
    return '<div class="cot-res" role="group" aria-label="Resultado do item ' + (i + 1) + '">' + bt('ganho') + bt('perdido') + '</div>' + mot;
  }
  // virou pedido, mas parte do que foi cotado não veio no pedido (Cotação ×
  // pedido = "não pedido"): pela fase contariam como ganhos — um clique os
  // marca como perdidos
  function naoPedidos(c) {
    var pv = c.pedido && c.pedido.previa, l = c.itens || [];
    if (c.descartado || !c.pedido || !pv || !(pv.produtos || []).length || !l.length) return [];
    return C.comparar(l, pv.produtos).linhas.filter(function (x) { return x.st === 'fora'; })
      .map(function (x) { return l.indexOf(x.cot); }).filter(function (i) { return i >= 0 && !l[i].resultado; });
  }
  function htmlNaoPedidos(c) {
    var idx = naoPedidos(c);
    if (!idx.length) return '';
    return '<div class="cot-res-aviso">' + IC.info + '<div><b>' + (idx.length === 1 ? '1 item cotado não veio no pedido' : idx.length + ' itens cotados não vieram no pedido') + '</b>' +
      'Sem marca, contam como ganhos (a oportunidade virou pedido). Se o comprador comprou de outro fornecedor, marque como perdidos.</div>' +
      '<button type="button" class="cs-btn cs-btn-xs" data-res-lote="' + idx.join(',') + '">' + IC.x + 'Marcar como perdido' + (idx.length > 1 ? 's' : '') + '</button></div>';
  }
  // grava na hora; a lista de itens que mudou em outra tela (409) recarrega o caso
  function marcarResultado(c, marcas, okTxt) {
    var its = c.itens || [];
    var corpo = { acao: 'resultado', numero: c.numero, itens: marcas.map(function (m) {
      var it = its[m.i] || {}, x = { i: m.i, codigo: it.codigo || '', descricao: it.descricao || '', resultado: m.r };
      if (m.m != null) x.motivo = m.m;
      return x;
    }) };
    acao(corpo, okTxt).then(function (j) { if (!j) renderCaso(); }).catch(function (e) {
      if (e && e.status === 409) {
        C.api('cot-casos?numero=' + encodeURIComponent(c.numero)).then(function (j) {
          if (!j || !j.caso) return;
          mesclar(j.caso); if (S.caso && S.caso.numero === j.caso.numero) S.caso = j.caso;
          renderTudo();
        }).catch(function () {});
      } else renderCaso();
    });
  }
  function totalDe(its) { return (its || []).reduce(function (s, it) { return s + (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0); }, 0); }

  var RAPIDAS = ['Cobrei o comprador sobre o resultado', 'Comprador pediu desconto', 'Enviei contraproposta no portal', 'Resultado sai em breve', 'Ajustei prazo de entrega'];
  function htmlNotas(c) {
    var l = (c.notas || []).slice().reverse();
    return '<div class="cs-card"><h5>' + IC.note + 'Tramitação · ' + l.length + ' nota(s)</h5>' +
      (l.length ? '<div class="cot-notas">' + l.map(function (n) {
        return '<div class="cot-nota">' + C.avatar(n.por && n.por.nome, n.por && n.por.email, 'p') + '<div class="bx"><small><b>' + esc((n.por && n.por.nome) || '') + '</b> · ' + esc(C.dataBR(n.em, true)) + '</small>' + esc(n.texto) + '</div></div>';
      }).join('') + '</div>' : '<p style="margin:0;font-size:13px;color:var(--cs-mut)">Registre aqui cada passo da oportunidade: contato com o comprador, contraproposta, prazo combinado…</p>') +
      (c.descartado ? '' : '<div class="cot-comp"><div class="cot-rapidas">' + RAPIDAS.map(function (r) { return '<button type="button" data-rapida="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') + '</div>' +
        '<textarea id="cot-nota" placeholder="O que aconteceu com esta oportunidade? (fica no histórico, com o seu nome)">' + esc(S.rascunho[c.numero] || '') + '</textarea>' +
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
  // a unidade de negócio: troca só para uma das unidades de quem edita (o servidor confere)
  function edUnidade(c) {
    var ops = (S.eu && S.eu.unidades) || [];
    var atual = c.unidade || '';
    var outra = ops.some(function (u) { return C.norm(u) !== C.norm(atual); });
    if (!outra || c.descartado) return atual ? esc(atual) : '<span class="vazio">sem unidade</span>';
    return ed('unidade', atual, 'lista', ops.indexOf(atual) < 0 && atual ? ops.concat([atual]) : ops);
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
    var det = '<div class="cs-card"><h5>' + IC.info + 'Detalhes da oportunidade</h5><dl class="cs-kv">' +
      '<dt>Número</dt><dd class="cs-mono">' + esc(c.numero) + '</dd>' +
      '<dt>Fase</dt><dd>' + esc(C.fase(c.fase).nome) + ' <span class="vazio">desde ' + esc(C.dataBR(c.faseEm)) + '</span></dd>' +
      '<dt>Portal</dt><dd>' + ed('portal', c.portal, 'lista', (cfg.portais || []).concat(c.portal && (cfg.portais || []).indexOf(c.portal) < 0 ? [c.portal] : [])) + '</dd>' +
      '<dt>Nº da cotação</dt><dd class="cs-mono">' + ed('cotacaoId', c.cotacaoId) + '</dd>' +
      '<dt>Empresa</dt><dd>MSB</dd>' +
      '<dt>Unidade de negócio</dt><dd>' + edUnidade(c) + '</dd>' +
      '<dt>Equipe</dt><dd>' + ed('area', c.area) + (c.equipe ? '<br><span class="vazio" title="equipe de segurança de quem registrou">' + esc(c.equipe) + '</span>' : '') + '</dd>' +
      '<dt>Data da cotação</dt><dd>' + ed('datas.cotacao', dt.cotacao, 'data', null, C.diaBR(dt.cotacao)) + '</dd>' +
      '<dt>Data de vencimento</dt><dd>' + ed('datas.validade', dt.validade, 'data', null, C.diaBR(dt.validade)) + (dt.validade && C.venceu(dt.validade) ? ' <span class="cs-chip prazo-vencido">prazo vencido</span>' : '') + '</dd>' +
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
      // 22/10/2026: o frete (CIF ou FOB) e o prazo de entrega voltaram — saem na proposta, com a observação
      '<dt>Frete</dt><dd>' + ed('condicoes.frete', C.freteCifFob(co.frete) || co.frete, 'lista', ['CIF', 'FOB']) + '</dd>' +
      '<dt>Prazo de entrega</dt><dd>' + ed('condicoes.entrega', co.entrega) + '</dd>' +
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
    // sem o aviso "quantidade x valor ≠ total do PDF" (21/10/2026, pedido do usuário)
    var avIa = ((l && l.avisos) || []).filter(function (a) { return a.tipo !== 'total'; });
    var temPdfCot = anexos.some(function (a) { return a.tipo === 'cotacao'; });
    var ia = (l || temPdfCot) ? '<div class="cs-card cot-ia"><h5>' + IC.sparkle + 'Leitura da IA</h5>' +
      (l && l.ia ? '<p>A IA leu ' + esc(l.arquivo || 'o PDF') + ' ' + esc(C.quando(l.em)) + (l.modelo ? ' (' + esc(l.modelo) + ')' : '') + '.</p>' : (l && l.erro ? '<p>' + esc(l.erro) + '</p>' : '<p>Oportunidade preenchida à mão.</p>')) +
      (avIa.length ? '<ul>' + avIa.map(function (a) { return '<li>' + esc(a.texto) + '</li>'; }).join('') + '</ul>' : '') +
      (temPdfCot && !c.descartado ? '<button type="button" class="cs-btn cs-btn-xs" data-act="reler">' + IC.refresh + 'Ler o PDF da cotação de novo</button>' : '') + '</div>' : '';
    var hist = '<details class="cs-card tk-hist"><summary><h5>' + IC.hist + 'Histórico · ' + (c.historico || []).length + '</h5></summary>' + htmlHist(c) + '</details>';
    return det + comp + cond + anx + ia + hist +
      (c.descartado ? '' : '<button type="button" class="cs-btn cs-btn-sm cs-btn-ghost cs-btn-perigo" data-act="descartar" style="align-self:flex-start">' + IC.trash + 'Descartar (registrada por engano)</button>');
  }
  function htmlHist(c) {
    var l = (c.historico || []).slice().reverse().slice(0, 60);
    var cor = { criado: '#2C7288', fase: '#5A3BC4', nota: '#D97706', pi: '#5A3BC4', pedido: '#138A4B', anexo: '#2B6CC4', ia: '#C026D3', campo: '#83C1D4', proposta: '#1E3A8A', erp: '#0F766E', ov: '#138A4B' };
    return '<ul class="cs-hist">' + l.map(function (h) {
      var corpo = (h.tipo === 'campo' || h.tipo === 'fase')
        ? '<b>' + esc(h.campo) + '</b>: ' + (h.de ? '<span class="de">' + esc(h.de) + '</span> → ' : '') + '<span class="para">' + esc(h.para || '—') + '</span>' + (h.texto ? '<br>' + esc(h.texto) : '')
        : esc(h.texto || '');
      return '<li style="--c:' + (cor[h.tipo] || '#83C1D4') + '">' + corpo + '<small>' + esc((h.por && h.por.nome) || 'Portal') + ' · ' + esc(C.dataBR(h.em, true)) + '</small></li>';
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
        '<button type="button" class="cs-btn cs-btn-sm" data-act="voltar">' + IC.back + ({ quadro: 'Quadro', historico: 'Histórico' }[S.deAba] || 'Oportunidades') + '</button>' +
        (pos >= 0 ? '<span class="tk-nav"><button type="button" class="cs-btn cs-btn-sm cs-ico-btn" data-nav="-1" title="Anterior (K)"' + (pos <= 0 ? ' disabled' : '') + '>' + IC.chevL + '</button>' +
          '<span>' + (pos + 1) + ' de ' + l.length + '</span><button type="button" class="cs-btn cs-btn-sm cs-ico-btn" data-nav="1" title="Próxima (J)"' + (pos >= l.length - 1 ? ' disabled' : '') + '>' + IC.chevR + '</button></span>' : '') +
        '<div class="tk-acoes">' + (c.descartado ? '' :
          (c.dono ? (meu ? '<button type="button" class="cs-btn cs-btn-sm" data-act="liberar" title="Devolver para a fila">' + IC.userx + 'Liberar</button>' : '<button type="button" class="cs-btn cs-btn-sm" data-act="assumir">' + IC.user + 'Assumir</button>')
            : '<button type="button" class="cs-btn cs-btn-sm cs-btn-p" data-act="assumir">' + IC.user + 'Assumir</button>') +
          '<button type="button" class="cs-btn cs-btn-sm" data-act="atribuir">' + IC.users + 'Atribuir</button>' +
          (!c.pedido && c.fase !== 'pedido' && !c.amostra ? '<button type="button" class="cs-btn cs-btn-sm cs-btn-azul" data-act="virou-pedido">' + IC.trophy + 'Virou pedido</button>' : '')) +
        '</div>' +
      '</div>' +
      htmlHero(c) + htmlFim(c) +
      '<div class="tk-grid"><div class="tk-main">' + htmlFaturamento(c) + (c.fase === 'pedido' || c.pedido ? htmlPedido(c) + htmlProposta(c) : htmlProposta(c) + htmlPedido(c)) + htmlItens(c) + htmlNotas(c) + '</div>' +
      '<aside class="tk-lado">' + htmlLado(c) + '</aside></div>';
    C.quieto(box);
    // o que vai na proposta de cada item (o cadastro do Salesforce), sem redesenhar o caso
    if (!S.editandoItens && (c.itens || []).length) C.completarDoSf(c.itens, true).then(function (n) { if (n && S.caso === c) pintarSfCaso(c); }, function () {});
  }
  // a linha do item (só leitura): código, comprador, fabricante e RMS — os do
  // Salesforce quando o produto está lá (é o que vai na proposta)
  function metaItem(it) {
    var p = it._sf || {}, rms = p.rms || it.registro;
    return [it.codigo, it.codigoCliente ? 'comprador ' + it.codigoCliente : '', p.fabricante || it.marca, rms ? 'RMS ' + rms : p.isento ? 'isento de RMS' : ''].filter(Boolean).join(' · ');
  }
  function pintarSfCaso(c) {
    var box = $('cot-caso'); if (!box) return;
    (c.itens || []).forEach(function (it, i) {
      var b = box.querySelector('.cot-sf-box[data-sf-i="' + i + '"]'); if (b) b.innerHTML = C.dicaSf(it);
      var m = box.querySelector('.cot-it-meta[data-i="' + i + '"]'); if (m) { m.textContent = metaItem(it); m.hidden = !m.textContent; }
    });
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
        C.toast('Oportunidade virou pedido', j.caso.numero + ' · lendo o pedido…', 'ok');
        return lerPedido(j.caso, arq);
      });
    }).catch(function (e) {
      S.lendoPedido[numero] = false; renderTudo();
      C.toast('Não consegui anexar o pedido', e.message, 'erro');
    });
  }
  // a leitura do pedido (a IA do PI) no formato que o caso guarda (pedido.previa)
  function previaDe(d) {
    var prods = d.produtos || [];
    var total = prods.reduce(function (s, p) { return s + (Number(p.quantidade) || 0) * (Number(p.valorUnitario) || 0); }, 0);
    return {
      cnpj: d.cnpj || '', cliente: d.nomeCliente || '', oc: d.ordemDeCompra || '', itens: prods.length, total: total,
      condicao: d.condicaoPagamento || '', email: d.email || '',
      produtos: prods.slice(0, 120).map(function (p) { return { codigo: p.codigo, descricao: p.descricao, quantidade: p.quantidade, valorUnitario: p.valorUnitario }; })
    };
  }
  // virar pedido pelo PDF já lido e conferido no diálogo (22/10/2026): vai
  // junto a leitura — o servidor confere de novo (divergência = 409) e grava
  // o pedido lido, pronto para o PI; o resultado de cada item sai do confronto
  function virarPedidoPdf(c, lido, oc, ms) {
    var numero = c.numero, d = lido.dados || {};
    var resultados = ms.map(function (x, i) { var o = { i: i, resultado: x.r }; if (x.r === 'perdido' && x.m) o.motivo = x.m; return o; });
    S.lendoPedido[numero] = true; renderCaso();
    C.api('cot-casos', { acao: 'pedido', numero: numero, anexo: { nome: lido.arq.nome, tipo: 'application/pdf', base64: lido.arq.base64 }, oc: oc, resultados: resultados, previa: previaDe(d) }).then(function (j) {
      S.lendoPedido[numero] = false;
      S.leiturasPedido[numero] = { dados: d, avisos: lido.avisos || [] };
      mesclar(j.caso); if (S.caso && S.caso.numero === numero) S.caso = j.caso;
      renderTudo();
      C.toast('Pedido registrado', j.caso.numero + ' · conferido com o PDF — a oportunidade fecha como Ganha com a Ordem de Venda', 'ok');
    }).catch(function (e) {
      S.lendoPedido[numero] = false; renderTudo();
      C.toast('A oportunidade não virou pedido', e.message, 'erro');
    });
  }
  // lê o PDF do pedido com o leitor do PI (o PI recebe a leitura pronta)
  function lerPedido(c, arq) {
    var numero = c.numero;
    if (!C.leitorPronto() || (!arq && c.pedido && c.pedido.manual)) { S.lendoPedido[numero] = false; renderTudo(); return Promise.resolve(); }
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
      return C.api('cot-casos', { acao: 'pi', numero: numero, estado: 'lido', previa: previaDe(d) });
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
    if (!c || !c.pedido || c.descartado) return;
    if (c.pedido.manual || c.pedido.previa || S.lendoPedido[c.numero] || (c.pi && (c.pi.estado === 'enviado' || c.pi.estado === 'erro'))) return;
    lerPedido(c);
  }
  function registrarOv(c, forcar, valor) {
    var num = c.numero;
    var n = C.numeroOv(valor != null ? valor : (S.ovRascunho[num] || ''));
    if (!n) {
      S.ovEnvio[num] = { estado: 'erro', msg: 'Número da Ordem de Venda inválido — use OVMSB seguido dos números (ex.: OVMSB144950).' };
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
      C.toast(primeira ? 'Oportunidade fechada' : 'OV adicionada', n + (v && v.achou ? ' · conferida no Dynamics' : ' · sem conferência no Dynamics'), 'ok');
    }).catch(function (e) {
      S.enviando = false;
      // OV que não existe, de outro cliente ou já em outra cotação: a pessoa confere
      if (e.status === 409 && e.corpo && e.corpo.confirmar) { S.ovEnvio[num] = {}; S.ovRascunho[num] = n; renderCaso(); dlgConfirmarOv(c, n, e.corpo.avisos || [e.message]); return; }
      S.ovEnvio[num] = { estado: 'erro', msg: e.message }; renderCaso();
    });
  }
  function dlgConfirmarOv(c, n, avisos, refazer) {
    C.dialogo('<h3>Confira a Ordem de Venda</h3><p>Antes de fechar ' + esc(c.numero) + ' com a <b>' + esc(n) + '</b>:</p>' +
      '<ul class="cot-ov-avisos">' + avisos.map(function (a) { return '<li>' + esc(a.charAt(0).toUpperCase() + a.slice(1)) + '</li>'; }).join('') + '</ul>' +
      '<p>Se o número está certo, registre mesmo assim (fica marcado no histórico).</p>' +
      '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Corrigir o número</button><button class="cs-btn cs-btn-p" value="ok" id="dlg-ok">Registrar mesmo assim</button></div>',
      function () {
        $('dlg-ok').addEventListener('click', function () { C.fecharDialogo(); if (refazer) refazer(); else registrarOv(c, true, n); });
      });
  }
  function dlgTirarOv(c, n) {
    var ultima = (c.ovs || []).length === 1;
    C.dialogo('<h3>Tirar a ' + esc(n) + ' da oportunidade?</h3><p>Use quando o número foi registrado por engano. A saída fica no histórico' + (ultima ? ' e a oportunidade volta a aguardar a OV' : '') + '.</p>' +
      '<div class="cs-campo"><label>Motivo (opcional)</label><input id="dlg-motivo-ov" placeholder="ex.: digitei o número errado" autocomplete="off"></div>' +
      '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Voltar</button><button class="cs-btn cs-btn-perigo" value="ok" id="dlg-ok">Tirar a OV</button></div>',
      function () {
        $('dlg-ok').addEventListener('click', function () {
          var m = $('dlg-motivo-ov').value;
          C.fecharDialogo();
          acao({ acao: 'removerOv', numero: c.numero, ov: n, motivo: m }, 'OV tirada da oportunidade').catch(function () {});
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
  // a Perdida (21/10/2026: a Vencida e a Cancelada viraram motivos dela)
  function dlgPerda(c) {
    var cfg = S.cfg || {};
    var l = cfg.motivosDaPerda || [].concat(cfg.motivosPerda || [], cfg.motivosCancelamento || [], ['Proposta vencida']).filter(function (m, i, a) { return a.indexOf(m) === i; });
    var pr = C.prazoDe(resumoLocal(c), aviso()), sug = pr && pr.nivel === 2 ? 'Proposta vencida' : '';
    // a Ganha que já fechou (OV ou pedido lançado pelo PI) também pode virar
    // Perdida (21/10/2026) — a OV e o pedido saem do caso; o servidor pede o forcar
    var ovs = (c.ovs || []).map(function (o) { return o.numero; }), lancado = !!(c.pi && c.pi.estado === 'enviado');
    var fechou = !!(ovs.length || lancado);
    C.dialogo('<h3>Oportunidade perdida</h3><p>' + esc(c.numero) + ' · ' + esc(C.tituloCaso(c)) + '. O motivo alimenta o funil (por que perdemos) — inclui proposta vencida e cancelada pelo comprador.</p>' +
      (fechou ? '<div class="cot-dlg-aviso">' + IC.alert + '<div><b>Esta oportunidade está Ganha e já fechou' + (ovs.length ? ' com a' + (ovs.length > 1 ? 's OVs ' : ' OV ') + esc(ovs.join(', ')) : ' (pedido lançado no Dynamics)') + '.</b>' +
        'Ao marcar como perdida, ' + (ovs.length ? 'a OV e ' : '') + 'o pedido saem do caso — ficam registrados no histórico. Confira antes.</div></div>' : '') +
      '<div class="cs-campo"><label>Motivo *</label><select id="dlg-motivo"><option value="">Escolha…</option>' + opcoes(l, sug) + '</select></div>' +
      '<div class="cot-grade" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="cs-campo"><label>Concorrente (se souber)</label><input id="dlg-conc" placeholder="quem ganhou"></div>' +
        '<div class="cs-campo"><label>Preço do concorrente</label><input id="dlg-vconc" inputmode="decimal" placeholder="R$"></div></div>' +
      '<div class="cs-campo"><label>Observação</label><textarea id="dlg-obs" rows="2"></textarea></div>' +
      '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Voltar</button><button class="cs-btn cs-btn-perigo" value="ok" id="dlg-ok">Marcar como perdida</button></div>',
      function () {
        $('dlg-ok').addEventListener('click', function (ev) {
          var m = $('dlg-motivo').value;
          if (!m) { ev.preventDefault(); C.toast('Escolha o motivo', '', 'erro'); return; }
          C.fecharDialogo();
          acao({ acao: 'fase', numero: c.numero, fase: 'perdida', motivo: m, obs: $('dlg-obs').value, concorrente: $('dlg-conc').value, valorConcorrente: $('dlg-vconc').value, forcar: !!fechou },
            'Oportunidade marcada como perdida').catch(function () {});
        });
      });
  }
  // 21/10/2026 (pedido do usuário): virar pedido pede o RESULTADO DE CADA
  // ITEM — Ganho ou Perdido, todos, ao menos um ganho — e tem três jeitos: o
  // PDF do pedido do portal, o pedido À MÃO (sem o PDF, como o manual do PI:
  // os itens ganhos são o pedido) ou a ORDEM DE VENDA de um pedido já feito
  // antes no Dynamics (a cotação vira pedido e fecha com ela de uma vez).
  // 22/10/2026 (pedido do usuário): pelo PDF, o pedido é LIDO AQUI e cada
  // item dele é conferido com a cotação (C.comparar) — mesmo item, preço e
  // quantidade. Divergência barra (a pessoa ajusta os itens); tudo certo, o
  // item é ganho; o cotado que não veio no pedido, perdido. À mão e pela OV
  // não conferem: a pessoa marca cada item.
  function dlgPedido(c, arqInicial, modoInicial) {
    var its = c.itens || [];
    var marcas = its.map(function (it) { return { r: it.resultado || '', m: it.motivo || '' }; });
    var modo = modoInicial || 'pdf', arq = arqInicial || null, oc = '', ovTxt = '';
    // a leitura do PDF no diálogo: null | { estado: 'lendo' | 'erro' | 'ok', … }
    var lido = null, ajustando = false;
    // as OVs no Dynamics, do cliente ou TODAS (21/10/2026: "pode cotar para mim e faturar
    // para outro"): null = ainda não buscou; 'carregando'; { ovs, cliente, motivo }
    var ovEsc = 'cliente', ovListas = { cliente: null, todas: null }, ovFiltro = '';
    var MODOS = [
      ['pdf', IC.pdf, 'PDF do pedido', 'o pedido do portal — conferido item a item com a oportunidade'],
      ['manual', IC.edit, 'À mão, sem o PDF', 'os itens ganhos são o pedido — como o manual do PI'],
      ['ov', IC.tag, 'Já tenho a Ordem de Venda', 'o pedido já foi feito no Dynamics: amarra a OV e fecha como Ganha']
    ];
    C.dialogo('<h3>A oportunidade virou pedido</h3><p>' + esc(c.numero) + ' · ' + esc(C.tituloCaso(c)) + '. Diga como veio o pedido: pelo PDF, os itens são conferidos com a oportunidade; à mão ou pela Ordem de Venda, marque o resultado de cada item. O pedido fica <b>registrado</b> e a oportunidade fecha como <b>Ganha</b> com a Ordem de Venda (a do fluxo do PI ou a informada) — só "Já tenho a Ordem de Venda" fecha na hora.</p>' +
      '<div class="cot-fases-ini cot-ped-modos">' + MODOS.map(function (m) {
        return '<button type="button" class="cot-fase-ini' + (m[0] === modo ? ' on' : '') + '" data-modo="' + m[0] + '"><b>' + m[1] + esc(m[2]) + '</b><small>' + esc(m[3]) + '</small></button>';
      }).join('') + '</div>' +
      '<div id="dlg-modo"></div>' +
      (its.length ? '<div class="cot-dlg-itens"><div class="cot-dlg-itens-h"><b id="dlg-itens-tt">Resultado de cada item <i>*</i></b><span id="dlg-itens-sub">todos marcados · ao menos um ganho</span>' +
        '<button type="button" class="cs-btn cs-btn-xs" id="dlg-todos-g">' + IC.check + 'Todos ganhos</button></div>' +
        '<div class="cot-dlg-tw"><table><tbody id="dlg-itens"></tbody></table></div></div>' : '') +
      '<p class="cot-dlg-falta" id="dlg-falta"></p>' +
      '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Voltar</button><button class="cs-btn cs-btn-azul" value="ok" id="dlg-ok">' + IC.trophy + 'Virou pedido</button></div>',
      function (dlg) {
        function pintarModo() {
          var h;
          if (modo === 'pdf') {
            h = '<label class="cot-drop" id="dlg-drop" style="min-height:110px"><input type="file" id="dlg-arq" accept="application/pdf,.pdf" hidden><span class="ic">' + IC.upload + '</span><b id="dlg-arq-nome">' + esc(arq ? arq.name : 'Escolher o PDF do pedido') + '</b><small>.pdf do portal</small></label>' +
              '<div class="cs-campo" style="margin-top:12px"><label>Nº da ordem de compra (opcional — o portal lê do PDF)</label><input id="dlg-oc" value="' + esc(oc) + '" autocomplete="off"></div>';
          } else if (modo === 'manual') {
            h = '<div class="cs-campo"><label>Nº da ordem de compra (opcional)</label><input id="dlg-oc" value="' + esc(oc) + '" autocomplete="off"></div>' +
              '<p class="cot-dlg-nota">Sem o PDF: os itens marcados como <b>Ganho</b> são o pedido. Depois, <b>Abrir no PI · Pedido</b> leva o comprador e os itens prontos para lançar no Dynamics.</p>';
          } else {
            h = '<div class="cs-campo"><label>Número da Ordem de Venda *</label><input id="dlg-ov" value="' + esc(ovTxt) + '" placeholder="OVMSB144950 — ou escolha abaixo" autocomplete="off" spellcheck="false" maxlength="24"></div>' +
              '<div class="cot-ov-escolha" id="dlg-ovs"></div>' +
              '<p class="cot-dlg-nota">O pedido já foi lançado no Dynamics: a oportunidade vira pedido e <b>fecha com esta OV</b>. O portal confere a OV no Dynamics (cliente, OC, itens) antes de gravar.</p>';
          }
          $('dlg-modo').innerHTML = h;
          Array.prototype.forEach.call(dlg.querySelectorAll('[data-modo]'), function (b) { b.classList.toggle('on', b.getAttribute('data-modo') === modo); });
          if (modo === 'ov') { if (ovListas[ovEsc] == null) carregarOvs(); else pintarOvs(); }
          var tt = $('dlg-itens-tt'), sub = $('dlg-itens-sub'), tg = $('dlg-todos-g');
          if (tt) tt.innerHTML = modo === 'pdf' ? 'Oportunidade × pedido' : 'Resultado de cada item <i>*</i>';
          if (sub) sub.textContent = modo === 'pdf' ? 'igual no pedido = ganho · não veio no pedido = perdido · diferente = ajuste' : 'todos marcados · ao menos um ganho';
          if (tg) tg.style.display = modo === 'pdf' ? 'none' : '';
          var ok = $('dlg-ok'); if (ok) ok.innerHTML = IC.trophy + (modo === 'ov' ? 'Fechar como Ganha' : 'Registrar o pedido');
          if (modo === 'pdf' && arq && !lido) lerPdf();
          pintarItens(); checar();
        }
        // lê o PDF escolhido (o leitor do PI + a IA) e confere com a cotação
        function lerPdf() {
          var f = arq; if (!f) return;
          lido = { estado: 'lendo' };
          var a64 = null;
          var fim = function (x) { if (arq !== f) return; lido = x; pintarItens(); checar(); };
          if (!/\.pdf$/i.test(f.name || '') && !/pdf/i.test(f.type || '')) { fim({ estado: 'erro', msg: 'O pedido precisa ser o PDF que o portal gerou.' }); return; }
          if (!C.leitorPronto()) { fim({ estado: 'erro', msg: 'O leitor de PDF não carregou — recarregue a página (F5) e tente de novo.' }); return; }
          C.lerArquivo(f).then(function (a) { a64 = a; return C.textoDoPdf(a.buffer); }).then(function (texto) {
            if (!texto || texto.trim().length < 40) throw new Error('o PDF parece escaneado (imagem, sem texto) e os itens não podem ser conferidos — registre à mão');
            return C.lerComIA(texto, a64.nome);
          }).then(function (r) {
            var d = (r && r.dados) || {};
            var prods = (d.produtos || []).filter(function (p) { return p && (p.descricao || p.codigo); });
            if (!prods.length) throw new Error('não achei os itens no PDF — confira se é o pedido do portal');
            // o item do pedido sem o nosso código ganha o do item da cotação que é o mesmo produto
            return C.codigosDoPedido(its, prods).then(function (ps) {
              fim({ estado: 'ok', arq: a64, dados: Object.assign({}, d, { produtos: ps }), avisos: (r && r.avisos) || [], prods: ps, cmp: C.comparar(its, ps) });
            });
          }).catch(function (e) { fim({ estado: 'erro', msg: 'Não consegui conferir o pedido: ' + (e.message || e) + '.' }); });
        }
        // põe na cotação o que o pedido diz (as linhas ks do confronto): a quantidade e o
        // preço do item diferente; o item fora da cotação entra no fim (o código nosso
        // em Cód. Biomedical; o do comprador em Cód. comprador). Grava e reconfere
        // com a mesma leitura (sem ler o PDF de novo)
        function ajustar(ks) {
          if (!lido || lido.estado !== 'ok' || ajustando || !ks.length) return;
          var novos = its.map(function (it) { var x = Object.assign({}, it); delete x._cod; delete x._sf; return x; });
          var extras = [], n = 0;
          ks.forEach(function (k) {
            var l = lido.cmp.linhas[k]; if (!l) return;
            if (l.st === 'dif') { var i = its.indexOf(l.cot); if (i < 0) return; novos[i].quantidade = Number(l.ped.quantidade) || 0; novos[i].valorUnitario = Number(l.ped.valorUnitario) || 0; n++; }
            else if (l.st === 'extra') extras.push(l.ped);
          });
          ajustando = true; pintarItens(); checar();
          var cods = extras.map(function (p) { return p.codigo; }).filter(Boolean);
          (cods.length ? C.produtosSf(cods).catch(function () { return {}; }) : Promise.resolve({})).then(function (sf) {
            extras.forEach(function (p) {
              var nosso = p.codigo && (sf[C.normCod(p.codigo)] || (C.produtoDoCodigo(p.codigo) && C.produtoDoCodigo(p.codigo).nome));
              novos.push({ codigo: nosso ? C.normCod(p.codigo) : '', codigoCliente: nosso ? (p.codigoPedido || '') : (p.codigo || p.codigoPedido || ''), descricao: p.descricao || '', marca: '', registro: '', unidade: '',
                quantidade: Number(p.quantidade) || 0, valorUnitario: Number(p.valorUnitario) || 0 });
              n++;
            });
            return C.api('cot-casos', { acao: 'itens', numero: c.numero, itens: novos });
          }).then(function (j) {
            ajustando = false;
            if (j && j.caso) { mesclar(j.caso); if (S.caso && S.caso.numero === c.numero) S.caso = j.caso; c = j.caso; }
            its = (c.itens || []);
            marcas = its.map(function (it, i) { return { r: it.resultado || '', m: (marcas[i] && marcas[i].m) || it.motivo || '' }; });
            lido.cmp = C.comparar(its, lido.prods);
            pintarItens(); checar(); renderCaso();
            C.toast('Oportunidade ajustada pelo pedido', n + (n === 1 ? ' item ajustado' : ' itens ajustados') + ' — o histórico registra a mudança', 'ok');
          }).catch(function (e) {
            ajustando = false; pintarItens(); checar();
            C.toast('Não consegui ajustar a oportunidade', e.message, 'erro');
          });
        }
        // as marcas que o confronto dá: igual = ganho; não veio no pedido = perdido
        function marcasPdf() {
          var m = its.map(function (x, i) { return { r: '', m: marcas[i].m }; });
          if (lido && lido.estado === 'ok') lido.cmp.linhas.forEach(function (l) {
            var i = its.indexOf(l.cot); if (i < 0) return;
            if (l.st === 'ok') { m[i].r = 'ganho'; m[i].m = ''; } else if (l.st === 'fora') m[i].r = 'perdido';
          });
          return m;
        }
        function linhasConfronto() {
          var linha = function (cls, d, s, r) { return '<tr class="' + cls + '"><td class="d"><b>' + esc(d) + '</b>' + (s ? '<small>' + s + '</small>' : '') + '</td><td class="r">' + r + '</td></tr>'; };
          var qp = function (x) { return C.qtd(x.quantidade) + ' × ' + (x.valorUnitario ? C.brl(x.valorUnitario) : 'sem preço'); };
          var nome = function (x, i) { return (x && (x.descricao || x.codigo)) || 'Item ' + (i + 1); };
          if (!arq) return linha('', 'Escolha o PDF do pedido', 'cada item dele é conferido com a oportunidade: o mesmo item, o mesmo preço e a mesma quantidade', '');
          if (!lido || lido.estado === 'lendo') return linha('', 'Lendo o pedido…', 'e conferindo item a item com a oportunidade', '<span class="cs-spin"></span>');
          if (lido.estado === 'erro') return linha('div', 'Não deu para conferir', esc(lido.msg), '<span class="cot-res-chip perdido">' + IC.alert + 'PDF</span>');
          var mots = ((S.cfg && S.cfg.motivosPerda) || []).slice();
          return lido.cmp.linhas.map(function (l, k) {
            var i = l.cot ? its.indexOf(l.cot) : -1;
            if (l.st === 'ok') return linha('', nome(l.cot, i), esc(qp(l.cot)) + ' · igual no pedido', '<span class="cot-res-chip ganho">' + IC.check + 'Ganho</span>');
            if (l.st === 'fora') {
              var x = marcas[i] || { m: '' }, lm = mots.slice(); if (x.m && lm.indexOf(x.m) < 0) lm.unshift(x.m);
              return linha('', nome(l.cot, i), esc(qp(l.cot)) + ' · não veio no pedido', '<span class="cot-res-chip perdido">' + IC.x + 'Perdido</span>' +
                '<select class="cot-res-mot" data-dlg-mot="' + i + '" aria-label="Motivo da perda do item ' + (i + 1) + '"><option value="">Motivo (opcional)…</option>' +
                lm.map(function (m) { return '<option' + (m === x.m ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') + '</select>');
            }
            // 22/10/2026 (pedido do usuário): "Ajustar" põe o item do pedido na cotação
            var bt = function (tit) { return '<button type="button" class="cs-btn cs-btn-xs cot-ajustar" data-ajustar="' + k + '" title="' + esc(tit) + '"' + (ajustando ? ' disabled' : '') + '>' + IC.edit + 'Ajustar</button>'; };
            if (l.st === 'extra') return linha('div', nome(l.ped, k), 'no pedido: ' + esc(qp(l.ped)) + (l.ped.codigo ? ' · cód. ' + esc(l.ped.codigo) : '') + ' · <b>não está na oportunidade</b>', bt('Incluir este item na oportunidade, como veio no pedido'));
            var o = [!l.mesmaQtd ? 'quantidade' : '', !l.mesmoPreco ? 'preço' : ''].filter(Boolean).join(' e ');
            return linha('div', nome(l.cot, i), 'cotado ' + esc(qp(l.cot)) + ' · no pedido ' + esc(qp(l.ped)) + ' · <b>' + esc(o) + ' diferente</b>', bt('Deixar a ' + o + ' da oportunidade igual à do pedido'));
          }).join('');
        }
        // 21/10/2026 (pedido do usuário: "a pessoa pode errar o número"): as
        // Ordens de Venda do cliente no Dynamics, para escolher com um clique
        function carregarOvs() {
          var e0 = ovEsc;
          ovListas[e0] = 'carregando'; pintarOvs();
          C.api('cot-casos?ovsDe=' + encodeURIComponent(c.numero) + (e0 === 'todas' ? '&todas=1' : ''))
            .then(function (j) { ovListas[e0] = j || { ovs: [] }; if (ovEsc === e0) pintarOvs(); })
            .catch(function (e) { ovListas[e0] = { ovs: [], motivo: 'Não consegui buscar as Ordens de Venda (' + e.message + ') — digite o número.' }; if (ovEsc === e0) pintarOvs(); });
        }
        // o cabeçalho (Do cliente | Todas as OVs, e o filtro nas todas) e a lista
        function pintarOvs() {
          var el = $('dlg-ovs'); if (!el) return;
          var Lc = ovListas.cliente, cod = (Lc && Lc !== 'carregando' && Lc.cliente) || (c.cliente && c.cliente.codigo) || '';
          el.innerHTML = '<div class="cot-ov-esc-h"><div class="cot-ov-esc-seg" role="group" aria-label="Quais Ordens de Venda">' +
              '<button type="button" data-ov-esc="cliente" class="' + (ovEsc === 'cliente' ? 'on' : '') + '">Do cliente' + (cod ? ' <b>' + esc(cod) + '</b>' : '') + '</button>' +
              '<button type="button" data-ov-esc="todas" class="' + (ovEsc === 'todas' ? 'on' : '') + '">Todas as OVs</button></div>' +
              '<span>' + (ovEsc === 'todas' ? 'as mais novas da MSB — o pedido pode ter sido faturado para outro cliente' : 'clique para escolher') + '</span></div>' +
            (ovEsc === 'todas' ? '<input id="dlg-ov-filtro" class="cot-ov-filtro" value="' + esc(ovFiltro) + '" placeholder="Filtrar por número, código ou nome do cliente…" autocomplete="off" spellcheck="false">' : '') +
            '<div id="dlg-ovs-l"></div>';
          pintarOvsLista();
        }
        function pintarOvsLista() {
          var el = $('dlg-ovs-l'); if (!el) return;
          var L = ovListas[ovEsc];
          if (L == null || L === 'carregando') { el.innerHTML = '<p class="cot-ov-esc-msg"><span class="cs-spin"></span>&nbsp; Buscando as Ordens de Venda ' + (ovEsc === 'todas' ? 'da BIO' : 'do cliente') + ' no Dynamics…</p>'; return; }
          // o cliente da cotação: o da lista "do cliente" (que acha pelo CNPJ) serve às "todas"
          var Lc = ovListas.cliente, cod = L.cliente || (Lc && Lc !== 'carregando' && Lc.cliente) || '';
          var tudo = L.ovs || [], sel = C.numeroOv(ovTxt), f = ovEsc === 'todas' ? C.norm(ovFiltro).trim() : '';
          if (!tudo.length) { el.innerHTML = '<p class="cot-ov-esc-msg">' + IC.info + esc(L.motivo || 'Nenhuma Ordem de Venda encontrada — digite o número.') + '</p>'; return; }
          var l = tudo.filter(function (o) { return !f || C.norm([o.numero, o.cliente, o.nome, o.oc].join(' ')).indexOf(f) >= 0; });
          if (!l.length) { el.innerHTML = '<p class="cot-ov-esc-msg">' + IC.info + esc('Nenhuma entre as ' + tudo.length + ' mais novas com “' + ovFiltro + '” — digite o número completo acima.') + '</p>'; return; }
          el.innerHTML = '<div class="cot-ov-esc-l">' + l.map(function (o) {
            var outro = ovEsc === 'todas' && o.cliente && cod && o.cliente !== cod;
            var info = [o.criadaEm ? C.dataBR(o.criadaEm) : '', ovEsc === 'todas' ? [o.cliente, o.nome].filter(Boolean).join(' · ') : '', o.oc ? 'OC ' + o.oc : '', o.situacao].filter(Boolean).join(' · ');
            return '<button type="button" class="cot-ov-opc' + (o.numero === sel ? ' on' : '') + (o.emOutra ? ' usada' : '') + '" data-ov-opc="' + esc(o.numero) + '"' + (o.emOutra ? ' title="Esta OV já fechou a oportunidade ' + esc(o.emOutra) + '"' : outro ? ' title="OV de outro cliente — o portal pede confirmação ao gravar"' : '') + '>' +
              '<b class="cs-mono">' + esc(o.numero) + '</b><span>' + esc(info || '—') + '</span>' + (o.emOutra ? '<em>já na ' + esc(o.emOutra) + '</em>' : outro ? '<em class="outro">outro cliente</em>' : '') + (o.numero === sel ? IC.check : '') + '</button>';
          }).join('') + '</div>';
        }
        function pintarItens() {
          var tb = $('dlg-itens'); if (!tb) return;
          if (modo === 'pdf') { tb.innerHTML = linhasConfronto(); return; }
          var mots = ((S.cfg && S.cfg.motivosPerda) || []).slice();
          tb.innerHTML = its.map(function (it, i) {
            var x = marcas[i];
            var bt = function (r) { return '<button type="button" class="' + r + (x.r === r ? ' on' : '') + '" data-dlg-res="' + r + '" data-i="' + i + '" aria-pressed="' + (x.r === r) + '">' + (r === 'ganho' ? IC.check : IC.x) + C.RESULTADOS[r] + '</button>'; };
            var l = mots.slice(); if (x.m && l.indexOf(x.m) < 0) l.unshift(x.m);
            var mot = x.r === 'perdido' ? '<select class="cot-res-mot" data-dlg-mot="' + i + '" aria-label="Motivo da perda do item ' + (i + 1) + '"><option value="">Motivo (opcional)…</option>' +
              l.map(function (m) { return '<option' + (m === x.m ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') + '</select>' : '';
            var num = [it.codigo, C.qtd(it.quantidade) + ' × ' + (it.valorUnitario ? C.brl(it.valorUnitario) : 'sem preço'), it.quantidade && it.valorUnitario ? '= ' + C.brl(it.quantidade * it.valorUnitario) : ''].filter(Boolean).join(' ');
            return '<tr class="' + (x.r ? '' : 'sem') + '"><td class="d"><b>' + esc(it.descricao || it.codigo || 'Item ' + (i + 1)) + '</b><small>' + esc(num) + '</small></td>' +
              '<td class="r"><div class="cot-res" role="group" aria-label="Resultado do item ' + (i + 1) + '">' + bt('ganho') + bt('perdido') + '</div>' + mot + '</td></tr>';
          }).join('');
        }
        function falta() {
          if (modo === 'pdf') {
            if (!arq) return 'Escolha o PDF do pedido.';
            if (!lido || lido.estado === 'lendo') return 'Lendo o pedido e conferindo com a oportunidade…';
            if (lido.estado === 'erro') return lido.msg;
            var nd = lido.cmp.dif + lido.cmp.extra;
            if (nd) return 'O pedido não bate com a oportunidade em ' + (nd > 1 ? nd + ' itens' : '1 item') + ' — ajuste os itens da oportunidade (ou confira o PDF) antes de virar pedido.';
            if (!lido.cmp.ok) return 'Nenhum item do pedido está na oportunidade — confira se o PDF é o pedido desta oportunidade.';
            return '';
          }
          var sem = marcas.filter(function (x) { return !x.r; }).length;
          if (modo === 'ov' && !C.numeroOv(ovTxt)) return ovTxt ? 'Número da Ordem de Venda inválido — OVMSB e os números (ou só os números).' : 'Informe o número da Ordem de Venda.';
          if (sem) return 'Marque cada item como Ganho ou Perdido — falta' + (sem > 1 ? 'm ' + sem + ' itens' : ' 1 item') + '.';
          if (its.length && !marcas.some(function (x) { return x.r === 'ganho'; })) return 'Nenhum item ganho — se nada foi ganho, a oportunidade é Perdida.';
          return '';
        }
        function checar() {
          var f = falta(), g = 0, vg = 0, ms = modo === 'pdf' ? marcasPdf() : marcas;
          its.forEach(function (it, i) { if (ms[i].r === 'ganho') { g++; vg += (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0); } });
          var el = $('dlg-falta');
          var ajustar = modo === 'pdf' && lido && lido.estado === 'ok' && (lido.cmp.dif || lido.cmp.extra);
          el.className = 'cot-dlg-falta' + (f ? '' : ' ok') + (modo === 'pdf' && lido && lido.estado === 'lendo' ? ' lendo' : '');
          el.innerHTML = f ? IC.alert + '<span>' + esc(f) + '</span>' + (ajustar ? '<span class="cot-dlg-falta-bts"><button type="button" class="cs-btn cs-btn-xs cs-btn-p" id="dlg-ajustar"' + (ajustando ? ' disabled' : '') + '>' + IC.edit + (ajustando ? 'Ajustando…' : 'Ajustar todos pelo pedido') + '</button>' +
              '<button type="button" class="cs-btn cs-btn-xs" id="dlg-editar" title="Fechar e editar os itens da oportunidade">Editar à mão</button></span>' : '')
            : IC.checkc + esc(g + ' item(ns) ganho(s)' + (vg ? ' · ' + C.brl(vg) : '') + (its.length - g ? ' · ' + (its.length - g) + ' perdido(s)' : '') + (modo === 'pdf' ? ' — conferido com o PDF' : ''));
          $('dlg-ok').disabled = !!f;
        }
        dlg.addEventListener('click', function (ev) {
          var m = ev.target.closest('[data-modo]');
          if (m) { ev.preventDefault(); modo = m.getAttribute('data-modo'); pintarModo(); var foco = $('dlg-ov') || null; if (foco) foco.focus(); return; }
          var r = ev.target.closest('[data-dlg-res]');
          if (r) { ev.preventDefault(); var i = Number(r.getAttribute('data-i')); marcas[i].r = r.getAttribute('data-dlg-res'); if (marcas[i].r !== 'perdido') marcas[i].m = ''; pintarItens(); checar(); return; }
          if (ev.target.closest('#dlg-todos-g')) { ev.preventDefault(); marcas.forEach(function (x) { x.r = 'ganho'; x.m = ''; }); pintarItens(); checar(); return; }
          // 22/10/2026: "Ajustar" (a linha) e "Ajustar todos" põem o pedido na cotação
          var aj = ev.target.closest('[data-ajustar]');
          if (aj) { ev.preventDefault(); ajustar([Number(aj.getAttribute('data-ajustar'))]); return; }
          if (ev.target.closest('#dlg-ajustar')) {
            ev.preventDefault();
            ajustar(lido && lido.estado === 'ok' ? lido.cmp.linhas.map(function (l, k) { return l.st === 'dif' || l.st === 'extra' ? k : -1; }).filter(function (k) { return k >= 0; }) : []);
            return;
          }
          // ou fecha e abre a edição dos itens da cotação
          if (ev.target.closest('#dlg-editar')) {
            ev.preventDefault(); C.fecharDialogo();
            var be = D.querySelector('#cot-caso [data-act="itens-editar"]');
            if (be) { be.click(); var card = D.querySelector('#cot-caso .cot-itens'); if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
            C.toast('Ajuste os itens da oportunidade', 'Deixe item, quantidade e preço iguais aos do pedido, salve e vire pedido de novo.', '');
            return;
          }
          var oe = ev.target.closest('[data-ov-esc]');
          if (oe) { ev.preventDefault(); ovEsc = oe.getAttribute('data-ov-esc'); if (ovListas[ovEsc] == null) carregarOvs(); else pintarOvs(); var fi = $('dlg-ov-filtro'); if (fi) fi.focus(); return; }
          var op = ev.target.closest('[data-ov-opc]');
          if (op) { ev.preventDefault(); ovTxt = op.getAttribute('data-ov-opc'); var iv = $('dlg-ov'); if (iv) iv.value = ovTxt; pintarOvsLista(); checar(); }
        });
        dlg.addEventListener('input', function (ev) {
          if (ev.target.id === 'dlg-oc') oc = ev.target.value;
          if (ev.target.id === 'dlg-ov') { ovTxt = ev.target.value; pintarOvsLista(); checar(); }
          if (ev.target.id === 'dlg-ov-filtro') { ovFiltro = ev.target.value; pintarOvsLista(); }
        });
        dlg.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') ev.preventDefault(); });
        dlg.addEventListener('change', function (ev) {
          var t = ev.target;
          if (t.id === 'dlg-arq') { if (t.files && t.files[0]) { arq = t.files[0]; $('dlg-arq-nome').textContent = arq.name; lido = null; lerPdf(); pintarItens(); checar(); } return; }
          if (t.matches('[data-dlg-mot]')) marcas[Number(t.getAttribute('data-dlg-mot'))].m = t.value;
        });
        dlg.addEventListener('dragover', function (ev) { var d = ev.target.closest && ev.target.closest('#dlg-drop'); if (d) { ev.preventDefault(); d.classList.add('drag'); } });
        dlg.addEventListener('dragleave', function (ev) { var d = ev.target.closest && ev.target.closest('#dlg-drop'); if (d) d.classList.remove('drag'); });
        dlg.addEventListener('drop', function (ev) {
          var d = ev.target.closest && ev.target.closest('#dlg-drop'); if (!d) return;
          ev.preventDefault(); d.classList.remove('drag');
          var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
          if (f) { arq = f; $('dlg-arq-nome').textContent = f.name; lido = null; lerPdf(); pintarItens(); checar(); }
        });
        $('dlg-ok').addEventListener('click', function (ev) {
          if (falta()) { ev.preventDefault(); checar(); return; }
          if (modo === 'pdf') { C.fecharDialogo(); virarPedidoPdf(c, lido, oc.trim(), marcasPdf()); return; }
          var resultados = marcas.map(function (x, i) {
            var it = its[i], o = { i: i, codigo: it.codigo || '', descricao: it.descricao || '', resultado: x.r };
            if (x.r === 'perdido' && x.m) o.motivo = x.m;
            return o;
          });
          C.fecharDialogo();
          if (modo === 'manual') acao({ acao: 'pedido', numero: c.numero, manual: true, oc: oc.trim(), resultados: resultados }, 'Pedido registrado (à mão) — a oportunidade fecha como Ganha com a Ordem de Venda').catch(function () {});
          else ovDireta(c, C.numeroOv(ovTxt), resultados, false);
        });
        pintarModo(); pintarItens(); checar();
      }, 'cot-dlg-largo');
  }
  // a OV de um pedido feito antes: a cotação vira pedido e fecha de uma vez
  // (OV que não existe, de outro cliente ou já em outra cotação: confirma)
  function ovDireta(c, n, resultados, forcar) {
    C.toast('Conferindo a ' + n + ' no Dynamics…', '', '');
    C.api('cot-casos', { acao: 'ov', numero: c.numero, ov: n, virarPedido: true, resultados: resultados, forcar: !!forcar }).then(function (j) {
      if (j && j.caso) { mesclar(j.caso); if (S.caso && S.caso.numero === c.numero) S.caso = j.caso; }
      renderTudo();
      var o = j && j.caso && (j.caso.ovs || []).filter(function (x) { return x.numero === n; })[0], v = o && o.dynamics;
      C.toast('Oportunidade virou pedido e fechou', n + (v && v.achou ? ' · conferida no Dynamics' : ' · sem conferência no Dynamics'), 'ok');
    }).catch(function (e) {
      if (e.status === 409 && e.corpo && e.corpo.confirmar) { dlgConfirmarOv(c, n, e.corpo.avisos || [e.message], function () { ovDireta(c, n, resultados, true); }); return; }
      C.toast('Não consegui registrar a Ordem de Venda', e.message, 'erro');
    });
  }
  // reabrir: a cotação volta para Cotada (a única fase aberta desde 21/10/2026)
  function dlgReabrir(c) {
    C.dialogo('<h3>Reabrir a oportunidade</h3><p>' + esc(c.numero) + ' volta para <b>Cotada</b>, aguardando o resultado' + (c.perda && c.perda.motivo ? ' (sai o motivo da perda: ' + esc(c.perda.motivo) + ')' : '') + '.</p>' +
      '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Voltar</button><button class="cs-btn cs-btn-p" value="ok" id="dlg-ok">Reabrir</button></div>',
      function () { $('dlg-ok').addEventListener('click', function () { C.fecharDialogo(); acao({ acao: 'fase', numero: c.numero, fase: 'cotada' }, 'Oportunidade reaberta').catch(function () {}); }); });
  }
  function dlgAtribuir(c) {
    C.dialogo('<h3>Atribuir ' + esc(c.numero) + '</h3><p>Quem vai acompanhar esta oportunidade até o fim?</p>' +
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
          acao({ acao: 'atribuir', numero: c.numero, para: { email: b.getAttribute('data-email'), nome: b.getAttribute('data-nome') } }, 'Oportunidade atribuída').catch(function () {});
        });
        $('dlg-ok').addEventListener('click', function (ev) {
          ev.preventDefault();
          var e = q.value.trim().toLowerCase();
          if (!/^[^@\s]+@biomedical\.com\.br$/.test(e)) { C.toast('E-mail inválido', 'Use um e-mail @biomedical.com.br.', 'erro'); return; }
          C.fecharDialogo();
          acao({ acao: 'atribuir', numero: c.numero, para: { email: e, nome: C.nomeDoEmail(e) } }, 'Oportunidade atribuída').catch(function () {});
        });
        pintar(); q.focus();
        if (!S.pessoas) C.api('pessoas').then(function (j) { S.pessoas = j.pessoas || []; pintar(); }).catch(function () { S.pessoas = []; });
      });
  }
  function dlgDescartar(c) {
    C.dialogo('<h3>Descartar ' + esc(c.numero) + '?</h3><p>Use quando a oportunidade foi registrada por engano ou em dobro. Ela sai das filas e do funil (dá para restaurar depois).</p>' +
      '<div class="cs-campo"><label>Motivo</label><input id="dlg-mot" value="Registrada por engano"></div>' +
      '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Voltar</button><button class="cs-btn cs-btn-perigo" value="ok" id="dlg-ok">Descartar</button></div>',
      function () { $('dlg-ok').addEventListener('click', function () { C.fecharDialogo(); acao({ acao: 'descartar', numero: c.numero, descartado: true, motivo: $('dlg-mot').value }, 'Oportunidade descartada').catch(function () {}); }); });
  }
  // 23/10/2026 (pedido do usuário): a Perdida vira AMOSTRA — uma cópia, com
  // número próprio, para a gestão; a original continua Perdida e a amostra
  // não conta nas cotadas, nos valores, no funil nem no analítico
  function dlgAmostra(c, forcar) {
    if (!c) return;
    if (c.amostra) { C.toast('Esta oportunidade já é uma amostra', c.amostra.de ? 'de ' + c.amostra.de : '', ''); return; }
    var ja = (c.amostras || []).map(function (a) { return a.numero; });
    C.dialogo('<h3>' + IC.amostra + ' Criar a amostra de ' + esc(c.numero) + '?</h3>' +
      '<p>Vou criar uma <b>cópia</b> desta oportunidade como <b>amostra</b>, com número próprio: os mesmos itens, cliente e anexos, sem data de vencimento. ' +
      'A original <b>continua Perdida</b>' + (c.perda && c.perda.motivo ? ' (' + esc(c.perda.motivo) + ')' : '') + '.</p>' +
      '<p>A amostra é para a gestão: <b>não conta nas cotadas, nos valores, nas filas, no funil nem no analítico</b> — fica no cartão e na coluna Amostra.</p>' +
      (ja.length ? '<div class="cot-dlg-aviso">' + IC.alert + '<div><b>Esta oportunidade já tem a amostra ' + esc(ja.join(', ')) + '.</b>Confirme para criar outra.</div></div>' : '') +
      '<div class="cs-campo"><label>Observação (opcional — vira a primeira nota da amostra)</label><textarea id="dlg-am-obs" rows="3" placeholder="Ex.: 2 unidades enviadas ao comprador para avaliação"></textarea></div>' +
      '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Voltar</button><button class="cs-btn cs-btn-p" value="ok" id="dlg-ok">' + IC.amostra + (ja.length ? 'Criar outra amostra' : 'Criar a amostra') + '</button></div>',
      function () {
        $('dlg-ok').addEventListener('click', function (ev) {
          ev.preventDefault();
          var obs = $('dlg-am-obs').value;
          C.fecharDialogo();
          if (S.enviando) return;
          S.enviando = true;
          C.api('cot-casos', { acao: 'amostra', numero: c.numero, obs: obs, forcar: !!(forcar || ja.length) }).then(function (j) {
            S.enviando = false;
            if (j.original) mesclar(j.original);
            if (j.caso) mesclar(j.caso);
            C.toast('Amostra ' + j.caso.numero + ' criada', 'A ' + c.numero + ' continua Perdida · a amostra fica fora das contas', 'ok');
            abrirCaso(j.caso.numero);
          }).catch(function (e) {
            S.enviando = false;
            if (e.status === 409 && e.corpo && e.corpo.confirmar && !forcar) { c.amostras = (c.amostras || []).concat([{ numero: e.corpo.amostra }]); dlgAmostra(c, true); return; }
            C.toast('Não criei a amostra', e.message, 'erro');
          });
        });
      });
  }

  /* ── a tramitação ao passar o mouse (23/10/2026) ─────────────── */
  // Pedido do usuário: passar o mouse na cotação (linha da lista ou cartão do
  // quadro) que tem tramitação abre um modalzinho com as notas — as mais novas
  // em cima. O caso é lido uma vez por versão (atualizadoEm).
  var tramCache = {}, tramEl = null, tramTimer = 0, tramAgenda = null, MAX_NOTAS = 4;
  function tramPop() {
    var p = $('cot-tram-pop');
    if (!p) { p = D.createElement('div'); p.id = 'cot-tram-pop'; p.className = 'cot-tram-pop'; p.setAttribute('role', 'tooltip'); p.hidden = true; D.body.appendChild(p); }
    return p;
  }
  function tramEsconder() {
    clearTimeout(tramTimer); tramEl = null;
    if (tramAgenda) { tramAgenda.removeAttribute('data-tram-agenda'); tramAgenda = null; }
    var p = $('cot-tram-pop'); if (p) p.hidden = true;
  }
  function tramPosicionar(p, el) {
    var r = el.getBoundingClientRect(), w = Math.min(360, W.innerWidth - 24), h = p.offsetHeight || 160;
    var x, y;
    if (r.width < 520) {
      // o cartão do quadro: ao lado (direita; sem espaço, esquerda)
      x = r.right + 10 + w <= W.innerWidth - 8 ? r.right + 10 : r.left - 10 - w;
      y = r.top;
    } else {
      // a linha da lista: embaixo (sem espaço, em cima), na altura do cliente
      x = r.left + Math.min(200, r.width / 4);
      y = r.bottom + 6 + h <= W.innerHeight - 8 ? r.bottom + 6 : r.top - 6 - h;
    }
    x = Math.max(8, Math.min(x, W.innerWidth - w - 8));
    y = Math.max(8, Math.min(y, W.innerHeight - h - 8));
    p.style.width = w + 'px'; p.style.left = Math.round(x) + 'px'; p.style.top = Math.round(y) + 'px';
  }
  function tramMostrar(el) {
    var num = el.getAttribute('data-num'), r = S.porNumero[num];
    if (!r || !(r.nNotas > 0) || !el.isConnected) return;
    tramEl = el;
    var chave = num + '|' + r.atualizadoEm, p = tramPop();
    var pintar = function (notas, erro) {
      if (tramEl !== el) return;
      var l = (notas || []).slice().reverse();
      p.innerHTML = '<div class="cot-tram-h">' + IC.chat + '<b>Tramitação</b><span>' + esc(num) + ' · ' + r.nNotas + ' nota' + (r.nNotas > 1 ? 's' : '') + '</span></div>' +
        (erro ? '<p class="cot-tram-e">Não consegui ler as notas: ' + esc(erro) + '</p>'
          : !notas ? '<div class="cot-tram-c"><span class="cs-spin"></span> Lendo a tramitação…</div>'
          : l.slice(0, MAX_NOTAS).map(function (n) {
              var t = String(n.texto || '');
              return '<div class="cot-tram-n">' + C.avatar(n.por && n.por.nome, n.por && n.por.email, 'mini') + '<div><small><b>' + esc((n.por && n.por.nome) || '') + '</b> · ' + esc(C.dataBR(n.em, true)) + '</small>' +
                esc(t.length > 320 ? t.slice(0, 320) + '…' : t) + '</div></div>';
            }).join('') + (l.length > MAX_NOTAS ? '<div class="cot-tram-mais">+ ' + (l.length - MAX_NOTAS) + ' nota(s) mais antiga(s) — abra a oportunidade</div>' : ''));
      p.hidden = false;
      tramPosicionar(p, el);
    };
    pintar(tramCache[chave] || null);
    if (!tramCache[chave]) {
      C.api('cot-casos?numero=' + encodeURIComponent(num)).then(function (j) {
        tramCache[chave] = (j.caso && j.caso.notas) || [];
        if (j.caso) { var x = S.porNumero[num]; if (x && x.atualizadoEm === j.caso.atualizadoEm) x.nNotas = tramCache[chave].length; }
        pintar(tramCache[chave]);
      }).catch(function (e) { pintar(null, e.message); });
    }
  }
  function ligarTramitacao(app) {
    // mousemove (não mouseover): depois de rolar a coluna (que esconde), mexer o mouse reabre
    app.addEventListener('mousemove', function (ev) {
      var el = ev.target.closest && ev.target.closest('#cot-tabela .cot-row, #cot-kanban .cs-kcard, #cot-hist .cot-hrow');
      if (el === tramEl || (el && el.getAttribute('data-tram-agenda'))) return;
      if (!el) { if (tramEl) tramEsconder(); return; }
      tramEsconder();
      var r = S.porNumero[el.getAttribute('data-num')];
      if (!r || !(r.nNotas > 0)) return;
      el.setAttribute('data-tram-agenda', '1'); tramAgenda = el;
      tramTimer = setTimeout(function () { el.removeAttribute('data-tram-agenda'); tramAgenda = null; tramMostrar(el); }, 260);
    });
    app.addEventListener('mouseout', function (ev) {
      var el = ev.target.closest && ev.target.closest('#cot-tabela .cot-row, #cot-kanban .cs-kcard, #cot-hist .cot-hrow');
      if (!el || (ev.relatedTarget && el.contains(ev.relatedTarget))) return;
      el.removeAttribute('data-tram-agenda');
      tramEsconder();
    });
    W.addEventListener('scroll', tramEsconder, true);
    app.addEventListener('mousedown', tramEsconder);
  }

  function mudarFase(c, alvo) {
    if (!alvo || alvo === c.fase) return;
    if (c.amostra) { faseAmostra(c, alvo); return; }
    // 26/10/2026 (pedido do usuário): A faturar é à mão — "ainda nada
    // aconteceu". Entre as abertas (Cotada <-> A faturar) só a fase muda, sem
    // diálogo (o "Virou pedido" é só da Ganha); o pedido registrado fica
    // 26/10/2026 (2º pedido): a A faturar pede os dados do paciente e o lote — o
    // formulário deles (não o "Virou pedido")
    if (alvo === 'faturar') {
      if ((c.ovs || []).length) { C.toast('A oportunidade já fechou com a OV', 'Para voltar a A faturar, tire a Ordem de Venda no cartão Pedido.', ''); return; }
      dlgFaturar(c, true);
      return;
    }
    if (C.aberta(c.fase) && C.aberta(alvo)) {
      acao({ acao: 'fase', numero: c.numero, fase: alvo }, 'A oportunidade voltou para ' + C.fase(alvo).nome).catch(function () {});
      return;
    }
    // 22/10/2026 (pedido do usuário): Ganha só com a Ordem de Venda
    if (alvo === 'pedido') {
      if (!c.pedido) { dlgPedido(c); return; }
      C.toast('Falta a Ordem de Venda', 'A oportunidade fecha como Ganha com a OV — informe o número no cartão Pedido (ou espere a OV voltar do fluxo do PI).', '');
      var io = $('cot-ov-num'); if (io) { if (io.scrollIntoView) io.scrollIntoView({ behavior: 'smooth', block: 'center' }); io.focus(); }
      return;
    }
    if (alvo === 'perdida') { dlgPerda(c); return; }
    voltarCotada(c, alvo);
  }
  // 26/10/2026 (pedido do usuário): a amostra tem as fases dela — Envio de
  // amostra, Ganha e Perdida —, sem pedido nem OV. Ganha ou perdida, ela fica
  // na Amostra (fora das Ganhas e das Perdidas), só com a cor verde ou vermelha
  function faseAmostra(c, alvo) {
    if (alvo === 'amostra_perdida') { dlgPerdaAmostra(c); return; }
    var ok = alvo === 'amostra_ganha' ? 'Amostra ganha — fica na Amostra, fora das Ganhas' : 'A amostra voltou para Envio de amostra';
    acao({ acao: 'fase', numero: c.numero, fase: alvo }, ok).catch(function () {});
  }
  function dlgPerdaAmostra(c) {
    var cfg = S.cfg || {};
    var l = cfg.motivosDaPerda || [].concat(cfg.motivosPerda || [], cfg.motivosCancelamento || []).filter(function (m, i, a) { return a.indexOf(m) === i; });
    C.dialogo('<h3>' + IC.amostra + ' Amostra perdida</h3><p>' + esc(c.numero) + ' · ' + esc(C.tituloCaso(c)) + '. A amostra fica na <b>Amostra</b>, em vermelho — não entra nas Perdidas nem em nenhuma conta.</p>' +
      '<div class="cs-campo"><label>Motivo (opcional)</label><select id="dlg-motivo"><option value="">—</option>' + opcoes(l, '') + '</select></div>' +
      '<div class="cs-campo"><label>Observação</label><textarea id="dlg-obs" rows="2" placeholder="Ex.: o cliente testou e não aprovou"></textarea></div>' +
      '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Voltar</button><button class="cs-btn cs-btn-perigo" value="ok" id="dlg-ok">Marcar a amostra como perdida</button></div>',
      function () {
        $('dlg-ok').addEventListener('click', function () {
          C.fecharDialogo();
          acao({ acao: 'fase', numero: c.numero, fase: 'amostra_perdida', motivo: $('dlg-motivo').value, obs: $('dlg-obs').value }, 'Amostra perdida — fica na Amostra, fora das Perdidas').catch(function () {});
        });
      });
  }
  // voltar para Cotada (ou desfazer o pedido registrado): 22/10/2026 (pedido do
  // usuário) — a cotação volta a como foi cadastrada: sem o pedido, sem a OV e
  // sem o resultado dos itens; código, quantidade e preço ficam
  // 26/10/2026: ou reabrir em A faturar (alvo), do mesmo jeito
  function voltarCotada(c, alvo) {
    alvo = alvo === 'faturar' ? 'faturar' : 'cotada';
    var nome = C.fase(alvo).nome;
    var temRes = (c.itens || []).some(function (it) { return it.resultado; });
    var ovs = (c.ovs || []).map(function (o) { return o.numero; }), lancado = !!(c.pi && c.pi.estado === 'enviado');
    var fechou = !!(ovs.length || lancado);
    if (!c.pedido && !temRes && c.fase !== 'perdida' && c.fase !== 'pedido') return;
    var sai = [c.pedido ? 'o pedido (o PDF continua nos anexos)' : '', ovs.length ? 'a' + (ovs.length > 1 ? 's Ordens de Venda ' : ' Ordem de Venda ') + ovs.join(', ') : '',
      temRes ? 'o resultado de cada item (Ganho/Perdido)' : '', c.fase === 'perdida' ? 'o motivo da perda' : ''].filter(Boolean);
    C.dialogo('<h3>Voltar a oportunidade para ' + esc(nome) + '?</h3>' +
      (fechou ? '<div class="cot-dlg-aviso">' + IC.alert + '<div><b>Esta oportunidade já fechou' + (ovs.length ? ' com a' + (ovs.length > 1 ? 's OVs ' : ' OV ') + esc(ovs.join(', ')) : ' (pedido lançado no Dynamics)') + '.</b>Confira antes — fica tudo no histórico.</div></div>' : '') +
      '<p>A oportunidade volta a como foi cadastrada' + (sai.length ? ': sai ' + esc(sai.join('; ')) : '') + '. O código, a quantidade e o preço dos itens não mudam.</p>' +
      '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Voltar</button><button class="cs-btn cs-btn-p" value="ok" id="dlg-ok">Voltar para ' + esc(nome) + '</button></div>',
      function () { $('dlg-ok').addEventListener('click', function () { C.fecharDialogo(); acao({ acao: 'fase', numero: c.numero, fase: alvo, forcar: fechou }, 'A oportunidade voltou para ' + nome).catch(function () {}); }); });
  }
  // 26/10/2026 (pedido do usuário): "pra esses casos de A faturar, preciso
  // inserir os dados de paciente (nome, data da cirurgia, convênio, nome do
  // médico) e o lote do material que foi utilizado — somente se for para A
  // faturar". Ao passar para A faturar (mudar) e para editar, só nela. Tudo
  // obrigatório; o item marcado Perdido não pede o lote.
  // 29/10/2026 (pedido do usuário): "a opção de importar o PDF que vem do
  // cliente ou digitar manualmente; tenho que validar o LOTE e verificar se ele
  // de fato existe, com base no PRODUTO da cotação". O PDF (a autorização /
  // relação de materiais da cirurgia) é lido pela IA no perfil 'consignado' e
  // preenche o que estiver vazio — os lotes por item (COT.lotesDoPdf) — e vai
  // para os anexos. Cada lote é conferido no Dynamics enquanto a pessoa digita
  // (acao 'lotes': existe para o Cód. Biomedical do item?); o que não existe
  // não passa (o servidor confere de novo ao gravar).
  // 29/10/2026 (2º pedido): "um checkbox para inserir NÃO INFORMADO em todos os
  // campos, menos o lote" — cada dado do paciente tem o seu "Não informado"
  // (a data da cirurgia também); o lote segue obrigatório
  var NAO_INF = 'NÃO INFORMADO';
  function naoInformado(v) { return C.norm(v).replace(/\s+/g, ' ').trim() === 'nao informado'; }
  function dlgFaturar(c, mudar) {
    var fa = c.faturamento || {}, its = c.itens || [];
    // reabrir (da Perdida ou da Ganha) zera o resultado dos itens: todos pedem o lote
    var zera = mudar && !C.aberta(c.fase);
    var fechou = !!((c.ovs || []).length || (c.pi && c.pi.estado === 'enviado'));
    var arqPdf = null, conf = {}, timers = {};
    var campo = function (id, rot, val, tipo, ph) {
      var ni = naoInformado(val);
      return '<div class="cs-campo' + (ni ? ' ni' : '') + '"><div class="cot-ni-rot"><label for="' + id + '">' + rot + ' *</label>' +
        '<label class="cot-ni" title="O cliente não informou — grava NÃO INFORMADO"><input type="checkbox" data-ni="' + id + '" data-tipo="' + (tipo || 'text') + '"' + (ni ? ' checked' : '') + '>Não informado</label></div>' +
        '<input id="' + id + '" type="' + (ni ? 'text' : tipo || 'text') + '" value="' + esc(ni ? NAO_INF : val || '') + '"' + (ni ? ' readonly' : '') + (ph ? ' placeholder="' + esc(ph) + '"' : '') + ' maxlength="160" autocomplete="off"></div>';
    };
    var lotes = its.map(function (it, i) {
      if (!zera && it.resultado === 'perdido') return '';
      return '<div class="cs-campo cot-fat-lote"><label for="dlg-lote-' + i + '"><b>' + esc(it.descricao || it.codigo || 'Item ' + (i + 1)) + '</b><small>' + esc([it.codigo || 'sem Cód. Biomedical', it.quantidade ? C.qtd(it.quantidade) + ' ' + (it.unidade || 'un') : ''].filter(Boolean).join(' · ')) + '</small></label>' +
        '<input id="dlg-lote-' + i + '" data-lote-i="' + i + '" value="' + esc(it.lote || '') + '" placeholder="Lote (mais de um: separe com vírgula)" maxlength="60" autocomplete="off" spellcheck="false">' +
        '<small class="cot-lote-st" id="dlg-lote-st-' + i + '"></small></div>';
    }).join('');
    C.dialogo('<h3>' + IC.cart + ' ' + (mudar ? 'Passar para A faturar' : 'Dados para faturar') + '</h3>' +
      '<p>' + esc(c.numero) + ' · ' + esc(C.tituloCaso(c)) + '. O paciente e o lote do material usado — ficam no caso e no histórico.' +
        (zera ? ' A oportunidade reabre: sai ' + (c.fase === 'perdida' ? 'o motivo da perda' : 'o pedido') + ' e o resultado dos itens.' : '') + '</p>' +
      '<label class="cot-fat-imp" id="dlg-fat-imp" tabindex="0"><input type="file" id="dlg-fat-pdf" accept="application/pdf,.pdf" hidden>' +
        '<span class="ic">' + IC.upload + '</span><span class="tx"><b>Importar o PDF do cliente</b><small id="dlg-fat-imp-st">a autorização de faturamento / relação de materiais da cirurgia — a IA preenche o paciente e os lotes. Ou digite à mão, abaixo.</small></span></label>' +
      '<div class="cot-grade" style="grid-template-columns:repeat(2,minmax(0,1fr))">' + campo('dlg-pac', 'Nome do paciente', fa.paciente) + campo('dlg-cir', 'Data da cirurgia', naoInformado(fa.cirurgia) ? fa.cirurgia : C.paraInput(fa.cirurgia), 'date') +
        campo('dlg-conv', 'Convênio', fa.convenio, '', 'ex.: Unimed, Bradesco, particular') + campo('dlg-med', 'Nome do médico', fa.medico) + '</div>' +
      (lotes ? '<h4 class="cot-fat-h">Lote do material usado * <small>conferido no Dynamics pelo produto de cada item</small></h4><div class="cot-fat-lotes">' + lotes + '</div>' : '') +
      '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Voltar</button><button class="cs-btn cs-btn-p" value="ok" id="dlg-ok">' + IC.check + (mudar ? 'Passar para A faturar' : 'Salvar') + '</button></div>',
      function () {
        var stImp = function (html, tipo) { var e = $('dlg-fat-imp-st'), w = $('dlg-fat-imp'); if (e) e.innerHTML = html; if (w) w.className = 'cot-fat-imp' + (tipo ? ' ' + tipo : ''); };
        var stLote = function (i, cls, html) { var e = $('dlg-lote-st-' + i); if (e) { e.className = 'cot-lote-st' + (cls ? ' ' + cls : ''); e.innerHTML = html || ''; } var inp = $('dlg-lote-' + i); if (inp) inp.closest('.cs-campo').classList.toggle('invalido', cls === 'nao'); };
        var separar = function (v) { return String(v || '').split(/[,;]+/).map(function (x) { return x.trim().toUpperCase(); }).filter(function (x, k, l) { return x && l.indexOf(x) === k; }); };
        // confere os lotes de um item no Dynamics: conf[i] = { valor, st: 'ok'|'nao'|'sem'|'checando', msg }
        var conferirLote = function (i) {
          var inp = $('dlg-lote-' + i), it = its[i] || {}; if (!inp) return Promise.resolve();
          var valor = inp.value.trim(), ls = separar(valor);
          if (!ls.length) { conf[i] = { valor: valor, st: '' }; stLote(i, '', ''); return Promise.resolve(); }
          var marca = conf[i] = { valor: valor, st: 'checando' };
          stLote(i, 'checando', '<span class="cs-spin"></span> conferindo no Dynamics…');
          return C.api('cot-casos', { acao: 'lotes', itens: ls.map(function (l) { return { codigo: it.codigo || '', lote: l }; }) }).then(function (j) {
            if (conf[i] !== marca) return;
            var rs = (j && j.lotes) || [], nao = rs.filter(function (r) { return r.existe === false; });
            if (!it.codigo && j.configurado) { marca.st = 'nao'; stLote(i, 'nao', IC.x + 'o item não tem o Cód. Biomedical — corrija o item (Itens cotados › Editar) para conferir o lote'); return; }
            if (nao.length) { marca.st = 'nao'; stLote(i, 'nao', IC.x + 'não existe no Dynamics para o produto ' + esc(it.codigo) + ': <b>' + esc(nao.map(function (r) { return r.lote; }).join(', ')) + '</b>'); return; }
            if (rs.length && rs.every(function (r) { return r.existe === true; })) {
              var vs = rs.map(function (r) { return r.validade ? C.diaBR(r.validade) : ''; }).filter(Boolean);
              marca.st = 'ok'; stLote(i, 'ok', IC.check + 'existe no Dynamics' + (vs.length ? ' · validade ' + esc(vs.join(', ')) : '')); return;
            }
            var er = (rs.filter(function (r) { return r.erro; })[0] || {}).erro || 'o Dynamics não respondeu';
            marca.st = 'sem'; stLote(i, 'sem', IC.alert + 'não deu para conferir agora (' + esc(er) + ') — entra sem a conferência');
          }).catch(function (e) {
            if (conf[i] !== marca) return;
            marca.st = 'sem'; stLote(i, 'sem', IC.alert + 'não deu para conferir agora (' + esc(e.message) + ') — entra sem a conferência');
          });
        };
        Array.prototype.forEach.call(D.querySelectorAll('#cs-dlg [data-lote-i]'), function (inp) {
          var i = Number(inp.getAttribute('data-lote-i'));
          if (inp.value.trim()) conferirLote(i);
          inp.addEventListener('input', function () {
            clearTimeout(timers[i]); conf[i] = null; stLote(i, 'checando', '');
            timers[i] = setTimeout(function () { conferirLote(i); }, 600);
          });
        });
        // o "Não informado" de cada dado do paciente: o campo trava com NÃO INFORMADO
        // (a data vira texto); desmarcar devolve o que estava digitado
        var guardado = {};
        var marcarNi = function (cb, on) {
          var id = cb.getAttribute('data-ni'), inp = $(id), cp = inp.closest('.cs-campo');
          cb.checked = on;
          if (on) { if (!naoInformado(inp.value)) guardado[id] = inp.value; inp.type = 'text'; inp.value = NAO_INF; inp.readOnly = true; }
          else { inp.readOnly = false; inp.type = cb.getAttribute('data-tipo') || 'text'; inp.value = guardado[id] || ''; }
          cp.classList.toggle('ni', on); cp.classList.remove('invalido');
        };
        Array.prototype.forEach.call(D.querySelectorAll('#cs-dlg [data-ni]'), function (cb) {
          cb.addEventListener('change', function () { marcarNi(cb, cb.checked); if (!cb.checked) $(cb.getAttribute('data-ni')).focus(); });
        });
        // importar o PDF do cliente: a IA lê (perfil consignado) e preenche o que estiver
        // vazio (ou marcado Não informado, quando o PDF traz o dado)
        var dataIso = function (v) { var m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(v || '')); return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : ''; };
        var importar = function (file) {
          if (!file) return;
          if (!C.ehPdf({ nome: file.name, tipo: file.type })) { stImp('Escolha um PDF.', 'erro'); return; }
          if (file.size > 10 * 1048576) { stImp('O PDF é grande demais (o limite é 10 MB).', 'erro'); return; }
          if (!C.leitorPronto()) { stImp('O leitor de PDF não carregou nesta página — recarregue (F5) ou digite à mão.', 'erro'); return; }
          stImp('<span class="cs-spin"></span> Lendo ' + esc(file.name) + ' com a IA…', 'lendo');
          C.lerArquivo(file).then(function (arq) {
            arqPdf = arq;
            return C.textoDoPdf(arq.buffer).then(function (t) {
              if (!t || String(t).replace(/\s+/g, '').length < 30) throw new Error('o PDF não tem texto (é escaneado?)');
              return C.lerComIA(t, arq.nome, 'consignado');
            });
          }).then(function (j) {
            var dd = (j && j.dados) || {}, n = 0;
            var por = function (id, v) {
              var el = $(id), cb = D.querySelector('#cs-dlg [data-ni="' + id + '"]'); if (!el || !v || naoInformado(v)) return;
              if (cb && cb.checked) marcarNi(cb, false);
              if (!el.value.trim()) { el.value = v; n++; el.closest('.cs-campo').classList.remove('invalido'); }
            };
            por('dlg-pac', String(dd.paciente || '').trim()); por('dlg-cir', dataIso(dd.dataCirurgia)); por('dlg-conv', String(dd.convenio || '').trim());
            por('dlg-med', String(dd.medicoCirurgico || dd.medicoAtendimento || '').trim());
            var porItem = C.lotesDoPdf(its, dd.produtos || []), nl = 0;
            porItem.forEach(function (ls, i) { var el = $('dlg-lote-' + i); if (el && ls.length && !el.value.trim()) { el.value = ls.join(', ').slice(0, 60); nl++; conferirLote(i); } });
            stImp(IC.check + '<b>' + esc(arqPdf.nome) + '</b> lido: ' + n + ' dado(s) do paciente e ' + nl + ' lote(s) preenchido(s) — confira. O que já estava preenchido ficou; o PDF vai para os anexos da oportunidade.', 'ok');
          }).catch(function (e) {
            stImp('Não consegui ler o PDF (' + esc(e.message) + ') — preencha à mão.' + (arqPdf ? ' O PDF vai para os anexos da oportunidade.' : ''), 'erro');
          });
        };
        $('dlg-fat-pdf').addEventListener('change', function (ev) { var f = ev.target.files && ev.target.files[0]; ev.target.value = ''; importar(f); });
        var imp = $('dlg-fat-imp');
        imp.addEventListener('dragover', function (ev) { ev.preventDefault(); imp.classList.add('drag'); });
        imp.addEventListener('dragleave', function () { imp.classList.remove('drag'); });
        imp.addEventListener('drop', function (ev) { ev.preventDefault(); imp.classList.remove('drag'); importar(ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]); });
        $('dlg-ok').addEventListener('click', function (ev) {
          ev.preventDefault();
          var f = { paciente: $('dlg-pac').value.trim(), cirurgia: $('dlg-cir').value, convenio: $('dlg-conv').value.trim(), medico: $('dlg-med').value.trim() };
          var ls = Array.prototype.map.call(D.querySelectorAll('#cs-dlg [data-lote-i]'), function (el) {
            var i = Number(el.getAttribute('data-lote-i')), it = its[i] || {};
            return { i: i, codigo: it.codigo || '', descricao: it.descricao || '', lote: el.value.trim() };
          });
          var falta = [['dlg-pac', f.paciente, 'nome do paciente'], ['dlg-cir', f.cirurgia, 'data da cirurgia'], ['dlg-conv', f.convenio, 'convênio'], ['dlg-med', f.medico, 'nome do médico']].filter(function (x) { return !x[1]; });
          var semLote = ls.filter(function (l) { return !l.lote; });
          Array.prototype.forEach.call(D.querySelectorAll('#cs-dlg .cs-campo'), function (x) { if (!x.querySelector('[data-lote-i]') || !(conf[x.querySelector('[data-lote-i]').getAttribute('data-lote-i')] || {}).st) x.classList.remove('invalido'); });
          falta.forEach(function (x) { $(x[0]).closest('.cs-campo').classList.add('invalido'); });
          semLote.forEach(function (l) { $('dlg-lote-' + l.i).closest('.cs-campo').classList.add('invalido'); });
          if (falta.length || semLote.length) {
            C.toast('Falta preencher', falta.map(function (x) { return x[2]; }).concat(semLote.length ? ['o lote de ' + (semLote.length > 1 ? semLote.length + ' itens' : '1 item')] : []).join(', '), 'erro');
            var prim = falta.length ? $(falta[0][0]) : $('dlg-lote-' + semLote[0].i); if (prim) prim.focus();
            return;
          }
          // os lotes ainda sem a conferência (digitados agora): confere antes de gravar
          var b = $('dlg-ok'); b.disabled = true;
          Promise.all(ls.filter(function (l) { var x = conf[l.i]; return !x || x.valor !== l.lote || x.st === 'checando'; }).map(function (l) { clearTimeout(timers[l.i]); return conferirLote(l.i); })).then(function () {
            b.disabled = false;
            var ruins = ls.filter(function (l) { return (conf[l.i] || {}).st === 'nao'; });
            if (ruins.length) {
              C.toast('Lote não encontrado no Dynamics', ruins.length > 1 ? ruins.length + ' itens com lote que não existe para o produto — confira.' : 'Confira o lote do item ' + (ruins[0].i + 1) + '.', 'erro');
              var el = $('dlg-lote-' + ruins[0].i); if (el) el.focus();
              return;
            }
            C.fecharDialogo();
            var pdf = arqPdf;
            acao(mudar ? { acao: 'fase', numero: c.numero, fase: 'faturar', faturamento: f, lotes: ls, forcar: fechou } : { acao: 'faturamento', numero: c.numero, faturamento: f, lotes: ls },
              mudar ? 'A oportunidade foi para A faturar' : 'Dados para faturar salvos').then(function (j) {
              // o PDF do cliente vai para os anexos da cotação
              if (!j || !pdf) return;
              return C.api('cot-casos', { acao: 'anexo', numero: c.numero, tipo: 'outro', anexo: { nome: pdf.nome, tipo: pdf.tipo || 'application/pdf', base64: pdf.base64 } })
                .then(function (k) { if (k && k.caso) { mesclar(k.caso); renderTudo(); } C.toast('PDF do cliente anexado', pdf.nome, 'ok'); }, function (e) { C.toast('Não anexei o PDF do cliente', e.message, 'erro'); });
            }).catch(function () {});
          });
        });
      }, 'cot-dlg-largo');
  }
  // o cartão dos dados da A faturar: na A faturar (com Editar) e, depois, na Ganha (só leitura)
  function htmlFaturamento(c) {
    if (c.amostra || c.descartado) return '';
    var naFase = c.fase === 'faturar', fa = c.faturamento;
    if (!naFase && !(fa && c.fase === 'pedido')) return '';
    fa = fa || {};
    var its = (c.itens || []).filter(function (it) { return it.resultado !== 'perdido'; });
    var faltam = [['paciente', 'nome do paciente'], ['cirurgia', 'data da cirurgia'], ['convenio', 'convênio'], ['medico', 'nome do médico']].filter(function (x) { return !fa[x[0]]; }).map(function (x) { return x[1]; });
    var semLote = its.filter(function (it) { return !it.lote; }).length;
    if (semLote) faltam.push('o lote de ' + (semLote > 1 ? semLote + ' itens' : '1 item'));
    var d = function (k, v) { return '<dt>' + k + '</dt><dd>' + (naoInformado(v) ? '<span class="ni">' + NAO_INF + '</span>' : v ? esc(v) : '<span class="vazio">—</span>') + '</dd>'; };
    return '<div class="cs-card cot-fat-card"><h5>' + IC.cart + 'A faturar · paciente e lote' +
        (naFase ? '<button type="button" class="cs-btn cs-btn-xs" data-act="fat-editar">' + IC.edit + (fa.paciente ? 'Editar' : 'Preencher') + '</button>' : '') + '</h5>' +
      (naFase && faltam.length ? '<div class="cot-dlg-aviso">' + IC.alert + '<div><b>Faltam dados para faturar</b>' + esc(faltam.join(', ')) + '.</div></div>' : '') +
      '<dl class="cot-fat-dl">' + d('Paciente', fa.paciente) + d('Data da cirurgia', fa.cirurgia ? C.diaBR(fa.cirurgia) || fa.cirurgia : '') + d('Convênio', fa.convenio) + d('Médico', fa.medico) + '</dl>' +
      (its.length ? '<table class="cot-fat-tab"><thead><tr><th>Material</th><th class="n">Qtd</th><th>Lote</th></tr></thead><tbody>' + its.map(function (it) {
        // 29/10/2026: o lote conferido no Dynamics (e a validade) ou sem a conferência
        var lc = it.loteConf, vs = lc && (lc.validade || []).filter(Boolean).map(function (v) { return C.diaBR(v); });
        var stc = !it.lote ? '' : lc && lc.ok ? '<small class="cot-lote-st ok" title="' + esc('conferido no Dynamics em ' + C.dataBR(lc.em, true)) + '">' + IC.check + 'conferido no Dynamics' + (vs && vs.length ? ' · validade ' + esc(vs.join(', ')) : '') + '</small>'
          : '<small class="cot-lote-st sem" title="' + esc((lc && lc.erro) || 'gravado antes da conferência') + '">' + IC.alert + 'sem a conferência no Dynamics' + (naFase ? ' — salve de novo para conferir' : '') + '</small>';
        return '<tr><td><b>' + esc(it.descricao || it.codigo || '') + '</b>' + (it.codigo ? '<small>' + esc(it.codigo) + '</small>' : '') + '</td><td class="n">' + (it.quantidade ? esc(C.qtd(it.quantidade)) : '—') + '</td><td><span class="cs-mono">' + (it.lote ? esc(it.lote) : '<span class="vazio">—</span>') + '</span>' + stc + '</td></tr>';
      }).join('') + '</tbody></table>' : '') +
      (fa.por ? '<p class="cot-fat-por">Preenchido por ' + esc(fa.por.nome || fa.por.email || '') + (fa.em ? ' · ' + esc(C.dataBR(fa.em, true)) : '') + '</p>' : '') + '</div>';
  }
  // desfazer o pedido registrado (22/10/2026): sai o pedido e o resultado dos
  // itens; a cotação segue na fase aberta em que está (Cotada ou A faturar)
  function desfazerPedido(c) {
    var nome = C.fase(c.fase).nome;
    C.dialogo('<h3>Desfazer o pedido?</h3><p>Sai o pedido (o PDF continua nos anexos) e o resultado de cada item (Ganho/Perdido); a oportunidade segue <b>' + esc(nome) + '</b>. O código, a quantidade e o preço dos itens não mudam.</p>' +
      '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Voltar</button><button class="cs-btn cs-btn-p" value="ok" id="dlg-ok">Desfazer o pedido</button></div>',
      function () { $('dlg-ok').addEventListener('click', function () { C.fecharDialogo(); acao({ acao: 'fase', numero: c.numero, fase: c.fase }, 'Pedido desfeito').catch(function () {}); }); });
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
  // 21/10/2026 (pedido do usuário): as três fases, como os cartões — Cotada (o
  // prazo em dia), Perdida (TODAS: as perdidas e as abertas com o prazo
  // vencido) e Ganha; sem o corte de 30 dias.
  // 23/10/2026 (pedido do usuário): a coluna da Cotada se chama "Em andamento";
  // cada coluna é uma PILHA — em cima, a última a mudar de fase — agrupada por
  // MÊS (Outubro, Setembro…; a setinha abre e fecha; o mês mais novo abre
  // sozinho, e com filtro abrem todos); e a quarta coluna, Amostra (a cópia da
  // perdida, fora das contas — soltar uma Perdida nela cria a amostra)
  // 26/10/2026 (pedido do usuário): a coluna A faturar, depois de Em andamento;
  // na Amostra, a ganha fica verde e a perdida vermelha (sem sair dela)
  var COLUNAS = [
    { id: 'cotada', visao: 'andamento', nome: 'Em andamento' },
    { id: 'faturar', visao: 'faturar' },
    { id: 'perdida', visao: 'perdidas' },
    { id: 'pedido', visao: 'pedido' },
    { id: 'amostra', visao: 'amostras', nome: 'Amostra', cor: COR_AMOSTRA, aberta: true, desc: 'Nenhuma amostra. Solte aqui uma oportunidade Perdida (ou abra a perdida) para criar a amostra — ela não conta nas cotadas nem nos valores.' }
  ];
  var MESES_NOME = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  function faseDaColuna(col) {
    var f = C.fase(col.id);
    return col.id === 'amostra' ? { id: 'amostra', nome: col.nome, cor: col.cor, aberta: true, desc: col.desc } : Object.assign({}, f, { nome: col.nome || f.nome });
  }
  // quando a cotação entrou na coluna: a última mudança de fase; a aberta com o
  // prazo vencido (que conta em Perdida) entrou no vencimento. { t, mes }
  function entrou(c, col) {
    if (col.visao === 'perdidas' && C.aberta(c.fase) && c.validade) { var v = String(c.validade).slice(0, 10); return { t: C.ms(v + 'T23:59:00-03:00'), mes: v.slice(0, 7) }; }
    var t = C.ms(c.faseEm) || C.ms(c.criadoEm);
    return { t: t, mes: t ? new Date(t - 3 * 3600e3).toISOString().slice(0, 7) : '' };
  }
  function nomeMes(ym) {
    if (!ym) return 'Sem data';
    var ano = ym.slice(0, 4), agora = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 4);
    return MESES_NOME[+ym.slice(5, 7) - 1] + (ano !== agora ? ' ' + ano : '');
  }
  function valorNoQuadro(c) { return c.fase === 'pedido' || c.fase === 'faturar' ? (c.totalPedido || c.total || 0) : (c.total || 0); }
  function cartaoHtml(c, f, quando) {
    // o código do cliente no Dynamics vem primeiro na linha (não some no corte)
    var cod = (c.cliente && c.cliente.codigo) || '', tit = C.tituloCaso(c);
    var dq = quando ? new Date(quando).toISOString() : c.criadoEm;
    return '<div class="cs-kcard' + (c.amostra ? ' amostra' : '') + '" draggable="' + (c.amostra ? 'false' : 'true') + '" data-num="' + esc(c.numero) + '" style="--c:' + (c.amostra ? C.fase(c.fase).cor : f.cor) + '">' +
      '<div class="q"><span class="cs-mono">' + esc(c.numero) + '</span><span>·</span><span title="' + esc((f.id === 'cotada' ? 'Em andamento' : 'Entrou em ' + f.nome) + ' ' + C.dataBR(dq, true)) + '">' + esc(C.quando(dq)) + '</span>' + chipTram(c) + '</div>' +
      '<div class="cli">' + esc((c.cliente && c.cliente.nome) || 'Cliente não informado') + '</div>' +
      '<div class="sub" title="' + esc((cod ? 'Cód. ' + cod + ' · ' : '') + tit + (c.amostraDe ? ' · amostra de ' + c.amostraDe : '')) + '">' + (cod ? 'cód. <b class="cot-cod-cli">' + esc(cod) + '</b> · ' : '') + esc(tit) + '</div>' +
      '<div class="r"><span class="val">' + C.brlCurto(valorNoQuadro(c)) + '</span>' + (c.amostra ? (c.fase !== 'amostra' ? chipAmostra(c) : '') : C.chipPrazo(c, aviso()) + C.chipPi(c)) + (c.dono ? C.avatar(c.dono.nome, c.dono.email, 'p') : '') + '</div></div>';
  }
  function renderQuadro() {
    var el = $('cot-kanban'); if (!el) return;
    // 23/10/2026 (pedido do usuário): o quadro também filtra — portal, unidade,
    // responsável, "Possui tramitação" e a busca (o código do cliente no
    // Dynamics, o nome, o nº…), os mesmos da lista
    renderFiltros(true);
    var base = filtrados('', true), filtro = algumFiltro();
    var cab = $('cot-cab-q');
    // (as amostras à parte: não contam)
    var nAm = base.filter(function (c) { return c.amostra; }).length;
    if (cab) cab.innerHTML = '<span><b>' + (S.carregou ? C.int(base.length - nAm) : '–') + '</b> oportunidade(s) no quadro' + (nAm ? ' · ' + nAm + ' amostra' + (nAm > 1 ? 's' : '') + ' (fora das contas)' : '') + textoFiltros() + ' · a última a mudar de fase em cima</span>' +
      (filtro ? '<button type="button" class="cs-btn cs-btn-xs cs-btn-ghost" id="cot-limpar-q">Limpar filtros</button>' : '');
    var MAX = 60;
    el.innerHTML = COLUNAS.map(function (col) {
      var f = faseDaColuna(col);
      var l = base.filter(function (c) { return passa(c, col.visao); }).map(function (c) { var e = entrou(c, col); return { c: c, t: e.t, mes: e.mes }; });
      l.sort(function (a, b) { return b.t - a.t || C.ms(b.c.criadoEm) - C.ms(a.c.criadoEm); });
      var v = l.reduce(function (s, x) { return s + valorNoQuadro(x.c); }, 0);
      var venc = col.visao === 'perdidas' ? l.filter(function (x) { return C.aberta(x.c.fase); }).length : 0;
      var amG = col.id === 'amostra' ? l.filter(function (x) { return x.c.fase === 'amostra_ganha'; }).length : 0, amP = col.id === 'amostra' ? l.filter(function (x) { return x.c.fase === 'amostra_perdida'; }).length : 0;
      // os meses, do mais novo ao mais velho (a pilha já está nessa ordem)
      var meses = [], porMes = {};
      l.forEach(function (x) { if (!porMes[x.mes]) { porMes[x.mes] = []; meses.push(x.mes); } porMes[x.mes].push(x); });
      var corpo = meses.map(function (m, i) {
        var k = col.id + '|' + m, ls = porMes[m];
        var aberto = k in S.mesAberto ? S.mesAberto[k] : (i === 0 || filtro);
        var vm = ls.reduce(function (s, x) { return s + valorNoQuadro(x.c); }, 0);
        return '<div class="cot-mes' + (aberto ? ' aberto' : '') + '">' +
          '<button type="button" class="cot-mes-h" data-mes="' + esc(k) + '" aria-expanded="' + (aberto ? 'true' : 'false') + '" title="' + (aberto ? 'Fechar' : 'Mostrar as oportunidades de') + ' ' + esc(nomeMes(m)) + '">' +
            IC.chevD + '<b>' + esc(nomeMes(m)) + '</b><span class="n">' + ls.length + '</span>' + (col.id === 'amostra' ? '' : '<span class="v">' + C.brlCurto(vm) + '</span>') + '</button>' +
          (aberto ? '<div class="cot-mes-b">' + ls.slice(0, MAX).map(function (x) { return cartaoHtml(x.c, f, x.t); }).join('') +
            (ls.length > MAX ? '<div class="cs-vazio" style="padding:8px">+' + (ls.length - MAX) + ' neste mês — refine a busca</div>' : '') + '</div>' : '') +
        '</div>';
      }).join('');
      return '<div class="cs-col' + (f.aberta ? '' : ' fechada') + (col.id === 'amostra' ? ' cot-col-amostra' : '') + '" data-col="' + f.id + '"><div class="cs-col-h"><span class="bol" style="background:' + f.cor + '"></span><span>' + esc(f.nome) +
        '<span class="v">' + (col.id === 'amostra' ? 'fora das contas' : C.brlCurto(v)) + '</span></span><span class="n">' + l.length + (venc ? ' · ' + venc + ' prazo vencido' : '') + (amG ? ' · ' + amG + ' ganha' + (amG > 1 ? 's' : '') : '') + (amP ? ' · ' + amP + ' perdida' + (amP > 1 ? 's' : '') : '') + '</span></div><div class="cs-col-b">' +
        corpo + (l.length ? '' : '<div class="cs-vazio" style="padding:18px 8px;font-size:12px">' + esc(filtro ? 'Nenhuma oportunidade com este filtro.' : f.desc) + '</div>') +
        '</div></div>';
    }).join('');
    C.quieto(el);
  }

  /* ── histórico do cliente (23/10/2026) ───────────────────────── */
  // Pedido do usuário: a aba HISTÓRICO — digita o código do cliente e aparecem
  // todas as cotações dele, em andamento, ganhas e perdidas (as amostras à
  // parte, fora das contas), com os valores e o PREÇO COTADO de cada item:
  // quando, a que preço, o que ganhou e o que perdeu. Sai do índice (o
  // servidor já mandou só as cotações da(s) unidade(s) da pessoa).
  function codCli(s) { return String(s || '').trim().toUpperCase().replace(/\s+/g, ''); }
  function digCnpj(s) { return String(s || '').replace(/\D/g, ''); }
  // 23/10/2026 (pedido do usuário): também o CLIENTE NOVO (sem código no
  // Dynamics), pelo CNPJ. A chave do cliente: o código; sem ele, o código de
  // outra cotação com o mesmo CNPJ (o cliente que ganhou código depois), senão
  // 'J:<CNPJ>' e, sem CNPJ, 'N:<nome>'
  function chavesDoIndice() {
    var porCnpj = {};
    S.casos.forEach(function (c) { var k = codCli(c.cliente && c.cliente.codigo), j = digCnpj(c.cliente && c.cliente.cnpj); if (k && j && !porCnpj[j]) porCnpj[j] = k; });
    return function (c) {
      var cli = c.cliente || {}, k = codCli(cli.codigo), j = digCnpj(cli.cnpj);
      return k || (j && porCnpj[j]) || (j ? 'J:' + j : cli.nome ? 'N:' + C.norm(cli.nome).trim() : '');
    };
  }
  // todos os clientes com cotação, em ordem CRESCENTE do código (os clientes
  // novos, sem código, no fim, pelo nome)
  function clientesDoIndice(chave) {
    var m = {};
    chave = chave || chavesDoIndice();
    S.casos.forEach(function (c) {
      var k = !c.descartado && chave(c); if (!k) return;
      var novo = /^[JN]:/.test(k);
      var x = m[k] || (m[k] = { k: k, cod: novo ? '' : k, nome: '', cnpj: '', n: 0, ult: 0, novo: novo });
      var t = dataDaCotacao(c);
      x.n++;
      if (t >= x.ult) { x.ult = t; x.nome = (c.cliente && c.cliente.nome) || x.nome; x.cnpj = digCnpj(c.cliente && c.cliente.cnpj) || x.cnpj; }
    });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) {
      return (a.novo - b.novo) || (a.novo ? String(a.nome).localeCompare(String(b.nome), 'pt-BR') : a.cod.localeCompare(b.cod, 'pt-BR', { numeric: true }));
    });
  }
  // o que vai no campo para chegar ao cliente: o código, o CNPJ ou o nome
  function valorDoCliente(x) { return x.cod || (x.cnpj ? C.cnpjMask(x.cnpj) : x.nome); }
  // o cliente do que foi digitado: o código, o CNPJ (14 dígitos — ou 11, CPF) ou o nome exato
  function clienteDoCampo(txt, clis) {
    var cod = codCli(txt), dig = digCnpj(txt), t = C.norm(txt).trim();
    if (!cod) return null;
    return clis.filter(function (x) { return x.cod && x.cod === cod; })[0] ||
      (dig.length >= 11 ? clis.filter(function (x) { return x.cnpj === dig; })[0] : null) ||
      clis.filter(function (x) { return x.nome && C.norm(x.nome).trim() === t; })[0] || null;
  }
  function dataDaCotacao(c) { return (c.dataCotacao && C.ms(String(c.dataCotacao).slice(0, 10) + 'T12:00:00-03:00')) || C.ms(c.criadoEm); }
  function diaDe(t) { return t ? C.dataBR(new Date(t).toISOString()) : '—'; }
  function sitHist(c) { return c.amostra ? 'amostra' : passa(c, 'pedido') ? 'gan' : passa(c, 'perdidas') ? 'per' : 'and'; }
  function precoUn(x) { return x[2] ? x[3] / x[2] : 0; }
  // a busca da lista para o cliente do Histórico (o código; o cliente novo, o CNPJ)
  function histBusca() { var x = clienteDoCampo(S.histCod, clientesDoIndice()); return x ? (x.cod || x.cnpj || x.nome) : codCli(S.histCod); }
  function histIr(cod) { S.histCod = cod; var i = $('cot-hist-cod'); if (i) i.value = cod; if (S.aba !== 'historico') irAba('historico'); else renderHistorico(); }
  function chipsClientes(l) {
    return '<div class="cot-hist-clis">' + l.map(function (x) {
      return '<button type="button" class="cot-hist-cli' + (x.novo ? ' novo' : '') + '" data-hist-cod="' + esc(valorDoCliente(x)) + '">' + (x.novo ? '<b class="cot-hist-novo">Cliente novo</b>' : '<b class="cot-cod-cli">' + esc(x.cod) + '</b>') +
        '<span>' + esc(x.nome || 'Cliente') + '</span><small>' + (x.novo && x.cnpj ? '<span class="cs-mono">' + esc(C.cnpjMask(x.cnpj)) + '</span> · ' : '') + x.n + (x.n > 1 ? ' oportunidades' : ' oportunidade') + '</small></button>';
    }).join('') + '</div>';
  }
  function renderHistorico() {
    var el = $('cot-hist-res'); if (!el) return;
    var chave = chavesDoIndice(), clis = clientesDoIndice(chave);
    var dl = $('cot-hist-dl');
    if (dl && dl.getAttribute('data-n') !== String(clis.length) + '|' + S.rev) {
      dl.setAttribute('data-n', String(clis.length) + '|' + S.rev);
      dl.innerHTML = clis.map(function (x) { return '<option value="' + esc(valorDoCliente(x)) + '">' + esc((x.novo ? 'Cliente novo · ' : '') + (x.nome || 'Cliente') + ' · ' + x.n + ' oportunidade(s)') + '</option>'; }).join('');
    }
    if (!S.carregou) { el.innerHTML = '<div class="cs-esqueleto"></div><div class="cs-esqueleto"></div>'; return; }
    var cod = codCli(S.histCod);
    // 23/10/2026 (pedido do usuário): TODOS os clientes, em ordem crescente do código
    if (!cod) {
      var nNovos = clis.filter(function (x) { return x.novo; }).length;
      el.innerHTML = '<div class="cs-card cot-hist-vazio"><h4>' + IC.hist + 'Todos os clientes com oportunidade <span class="cot-hist-n">' + clis.length + '</span></h4><p>Em ordem crescente do código' + (nNovos ? '; os ' + nNovos + ' cliente(s) novo(s), sem código, no fim — busque pelo CNPJ' : '') + '. Digite acima ou escolha um cliente:</p>' +
        (clis.length ? chipsClientes(clis) : '<p class="tk-vazio">Nenhuma oportunidade registrada ainda.</p>') + '</div>';
      C.quieto(el); return;
    }
    var alvo = clienteDoCampo(S.histCod, clis);
    var l = alvo ? S.casos.filter(function (c) { return !c.descartado && chave(c) === alvo.k; }) : [];
    if (!l.length) {
      var t = C.norm(S.histCod).trim(), dg = digCnpj(S.histCod);
      var sug = clis.filter(function (x) { return (x.cod && x.cod.indexOf(cod) >= 0) || (t.length >= 3 && C.norm(x.nome).indexOf(t) >= 0) || (dg.length >= 4 && String(x.cnpj).indexOf(dg) >= 0); });
      el.innerHTML = '<div class="cs-card cot-hist-vazio"><h4>' + IC.search + 'Nenhum cliente com ' + esc(S.histCod.trim()) + '</h4>' +
        (sug.length ? '<p>Parecidos (código, nome ou CNPJ) · ' + sug.length + ':</p>' + chipsClientes(sug) : '<p>Confira o código do cliente no Dynamics (ex.: C004512) ou o CNPJ do cliente novo. Só aparecem as oportunidades das suas unidades de negócio.</p>') + '</div>';
      C.quieto(el); return;
    }
    l.sort(function (a, b) { return dataDaCotacao(b) - dataDaCotacao(a) || C.ms(b.criadoEm) - C.ms(a.criadoEm); });
    var cli = l[0].cliente || {}, conta = l.filter(function (c) { return !c.amostra; }), ams = l.length - conta.length;
    var g = { and: [], gan: [], per: [] };
    conta.forEach(function (c) { g[sitHist(c)].push(c); });
    var soma = function (ls, ped) { return ls.reduce(function (s, c) { return s + ((ped && c.totalPedido) || c.total || 0); }, 0); };
    var datas = conta.map(dataDaCotacao).filter(Boolean);
    var tile = function (n, rot, sub, cor) { return '<div class="cot-hist-k" style="--k:' + cor + '"><b>' + n + '</b><span>' + esc(rot) + '</span><small>' + esc(sub) + '</small></div>'; };
    var h = '<div class="cs-card cot-hist-cab"><div class="cot-hist-id">' + (alvo.novo ? '<span class="cot-hist-novo">Cliente novo · sem código no Dynamics</span>' : '<span class="cot-cod-cli">' + esc(alvo.cod) + '</span>') + '<h3>' + esc(cli.nome || 'Cliente') + '</h3>' +
        '<p>' + [cli.cnpj ? '<span class="cs-mono">' + esc(C.cnpjMask(cli.cnpj)) + '</span>' : '', [cli.cidade, cli.uf].filter(Boolean).map(esc).join('/'),
          datas.length ? conta.length + (conta.length > 1 ? ' oportunidades' : ' oportunidade') + ' de ' + diaDe(Math.min.apply(null, datas)) + ' a ' + diaDe(Math.max.apply(null, datas)) : ''].filter(Boolean).join(' · ') + '</p></div>' +
        '<button type="button" class="cs-btn cs-btn-sm" data-hist-lista="1">' + IC.list + 'Ver na lista</button></div>' +
      '<div class="cot-hist-ks">' +
        tile(C.int(conta.length), 'Oportunidades', C.brlCurto(soma(conta)) + ' cotados', '#324C57') +
        tile(C.int(g.and.length), 'Em andamento', C.brlCurto(soma(g.and)), '#2C7288') +
        tile(C.int(g.gan.length), 'Ganhas', C.brlCurto(soma(g.gan, true)) + ' em pedidos', '#138A4B') +
        tile(C.int(g.per.length), 'Perdidas', C.brlCurto(soma(g.per)), '#CF3434') +
        tile(conta.length ? C.pct(g.gan.length / conta.length, 0) : '—', 'Conversão', 'ganhas ÷ oportunidades', '#2B6CC4') +
        (ams ? tile(C.int(ams), 'Amostras', 'fora das contas', COR_AMOSTRA) : '') +
      '</div>';
    // as cotações (a setinha abre os itens com o preço)
    h += '<div class="cs-card cot-hist-tab"><h4>' + IC.list + 'Oportunidades do cliente <span>' + l.length + '</span></h4>' +
      '<div class="cot-hth"><span></span><span>Oportunidade</span><span>Portal</span><span>Fase</span><span class="n">Itens</span><span class="n">Valor</span><span>Responsável</span></div>' +
      l.map(function (c) {
        var aberto = !!S.histAberto[c.numero], sit = sitHist(c);
        var linha = '<div class="cot-hrow' + (aberto ? ' aberto' : '') + '" data-num="' + esc(c.numero) + '" style="--c:' + C.fase(c.fase).cor + '">' +
          '<button type="button" class="cot-hrow-x" data-hist-abrir="' + esc(c.numero) + '" aria-expanded="' + aberto + '" title="' + (aberto ? 'Fechar os itens' : 'Ver os itens e os preços') + '">' + IC.chevD + '</button>' +
          '<span><b class="cs-mono">' + esc(c.numero) + '</b><small>' + diaDe(dataDaCotacao(c)) + '</small></span>' +
          '<span class="cot-hrow-p">' + esc(C.tituloCaso(c)) + '</span>' +
          '<span>' + (c.amostra ? chipAmostra(c) : C.chipFase(c.fase)) + chipTram(c) + '</span>' +
          '<span class="n">' + (c.nItens || (c.itensRes || []).length) + '</span>' +
          '<span class="n"><b>' + C.brl(sit === 'gan' && c.totalPedido ? c.totalPedido : c.total) + '</b>' + (sit === 'gan' && c.totalPedido ? '<small>pedido</small>' : c.amostra ? '<small>amostra</small>' : '<small>cotado</small>') + '</span>' +
          '<span class="cot-hrow-d">' + (c.dono ? C.avatar(c.dono.nome, c.dono.email, 'p') + esc(C.primeiroNome(c.dono.nome) || c.dono.email) : '<span class="tk-sem">Sem responsável</span>') + '</span></div>';
        if (!aberto) return linha;
        var its = c.itensRes || [];
        return linha + '<div class="cot-hrow-its">' + (its.length ? '<table class="cot-hist-its"><thead><tr><th>Código</th><th>Descrição</th><th class="n">Qtd.</th><th class="n">Preço un.</th><th class="n">Total</th><th>Resultado</th></tr></thead><tbody>' +
          its.map(function (x) {
            var rr = C.resultadoItem(x[4] === 'g' ? 'ganho' : x[4] === 'p' ? 'perdido' : '', c.fase);
            return '<tr><td class="cs-mono">' + esc(x[0] || '—') + '</td><td>' + esc(x[1] || '') + '</td><td class="n">' + C.qtd(x[2] || 0) + '</td><td class="n">' + (x[2] ? C.brl(precoUn(x)) : '—') + '</td><td class="n">' + C.brl(x[3] || 0) + '</td>' +
              '<td>' + (c.amostra ? '<span class="tk-vazio">amostra</span>' : rr.r ? '<span class="cot-hres ' + rr.r + '">' + (rr.r === 'ganho' ? 'Ganho' : 'Perdido') + (x[5] ? ' · ' + esc(x[5]) : '') + '</span>' : '<span class="tk-vazio">em aberto</span>') + '</td></tr>';
          }).join('') + '</tbody></table>' + ((c.nItens || 0) > its.length ? '<p class="tk-vazio">Mostrando ' + its.length + ' de ' + c.nItens + ' itens — abra a oportunidade para ver todos.</p>' : '') : '<p class="tk-vazio">Oportunidade sem itens.</p>') + '</div>';
      }).join('') + '</div>';
    // o preço de cada produto ao longo das cotações (sem as amostras)
    var prod = {}, ordem = [];
    conta.forEach(function (c) {
      var t = dataDaCotacao(c);
      (c.itensRes || []).forEach(function (x) {
        var k = x[0] ? 'c:' + C.normCod(x[0]) : 'd:' + C.norm(x[1]);
        var p = prod[k]; if (!p) { p = prod[k] = { k: k, cod: x[0] || '', desc: x[1] || '', linhas: [] }; ordem.push(k); }
        if (!p.desc && x[1]) p.desc = x[1];
        p.linhas.push({ c: c, t: t, x: x, rr: C.resultadoItem(x[4] === 'g' ? 'ganho' : x[4] === 'p' ? 'perdido' : '', c.fase) });
      });
    });
    var ps = ordem.map(function (k) { return prod[k]; }).map(function (p) {
      p.linhas.sort(function (a, b) { return b.t - a.t; });
      var com = p.linhas.filter(function (y) { return y.x[2] > 0; }), un = com.map(function (y) { return precoUn(y.x); });
      var q = com.reduce(function (s, y) { return s + y.x[2]; }, 0), v = com.reduce(function (s, y) { return s + y.x[3]; }, 0);
      p.qtd = q; p.medio = q ? v / q : 0; p.min = un.length ? Math.min.apply(null, un) : 0; p.max = un.length ? Math.max.apply(null, un) : 0;
      p.ult = com[0] || null; p.gan = p.linhas.filter(function (y) { return y.rr.r === 'ganho'; }).length; p.per = p.linhas.filter(function (y) { return y.rr.r === 'perdido'; }).length;
      return p;
    }).sort(function (a, b) { return b.linhas.length - a.linhas.length || (b.ult ? b.ult.t : 0) - (a.ult ? a.ult.t : 0); });
    if (ps.length) {
      h += '<div class="cs-card cot-hist-tab"><h4>' + IC.tag + 'Preços cotados por produto <span>' + ps.length + '</span></h4><p class="cot-hist-nota">Preço unitário = valor do item ÷ quantidade, em cada oportunidade (sem as amostras). A setinha mostra oportunidade por oportunidade.</p>' +
        '<div class="cot-hist-prods"><table class="cot-hist-its"><thead><tr><th></th><th>Código</th><th>Produto</th><th class="n">Oportunidades</th><th class="n">Qtd. total</th><th class="n">Último preço</th><th class="n">Médio</th><th class="n">Menor · maior</th><th>Ganhos · perdidos</th></tr></thead><tbody>' +
        ps.slice(0, 150).map(function (p) {
          var kk = 'p|' + p.k, aberto = !!S.histAberto[kk];
          var tr = '<tr class="cot-hprod' + (aberto ? ' aberto' : '') + '"><td><button type="button" class="cot-hrow-x" data-hist-abrir="' + esc(kk) + '" aria-expanded="' + aberto + '" title="Ver oportunidade por oportunidade">' + IC.chevD + '</button></td>' +
            '<td class="cs-mono">' + esc(p.cod || '—') + '</td><td>' + esc(p.desc) + '</td><td class="n">' + p.linhas.length + '</td><td class="n">' + C.qtd(p.qtd) + '</td>' +
            '<td class="n">' + (p.ult ? '<b>' + C.brl(precoUn(p.ult.x)) + '</b><small>' + diaDe(p.ult.t) + '</small>' : '—') + '</td><td class="n">' + (p.medio ? C.brl(p.medio) : '—') + '</td>' +
            '<td class="n">' + (p.min ? C.brl(p.min) + (p.max !== p.min ? ' · ' + C.brl(p.max) : '') : '—') + '</td>' +
            '<td>' + (p.gan ? '<span class="cot-hres ganho">' + p.gan + ' ganho' + (p.gan > 1 ? 's' : '') + '</span>' : '') + (p.per ? '<span class="cot-hres perdido">' + p.per + ' perdido' + (p.per > 1 ? 's' : '') + '</span>' : '') + (!p.gan && !p.per ? '<span class="tk-vazio">em aberto</span>' : '') + '</td></tr>';
          if (!aberto) return tr;
          return tr + p.linhas.map(function (y) {
            return '<tr class="cot-hprod-l"><td></td><td colspan="2"><button type="button" class="cot-link" data-abrir="' + esc(y.c.numero) + '">' + esc(y.c.numero) + '</button> · ' + diaDe(y.t) + ' · ' + esc(C.tituloCaso(y.c)) + '</td>' +
              '<td class="n">' + C.chipFase(y.c.fase) + '</td><td class="n">' + C.qtd(y.x[2] || 0) + '</td><td class="n">' + (y.x[2] ? C.brl(precoUn(y.x)) : '—') + '</td><td class="n" colspan="2">' + C.brl(y.x[3] || 0) + ' no item</td>' +
              '<td>' + (y.rr.r ? '<span class="cot-hres ' + y.rr.r + '">' + (y.rr.r === 'ganho' ? 'Ganho' : 'Perdido') + (y.x[5] ? ' · ' + esc(y.x[5]) : '') + '</span>' : '<span class="tk-vazio">em aberto</span>') + '</td></tr>';
          }).join('');
        }).join('') + '</tbody></table></div>' + (ps.length > 150 ? '<p class="tk-vazio">Mostrando 150 de ' + ps.length + ' produtos.</p>' : '') + '</div>';
    }
    el.innerHTML = h;
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
    var arm = d.armazenamento ? 'Container próprio das oportunidades da MSB (COT_MSB_BLOB_URL).' : 'Sem armazenamento: configure o COT_MSB_BLOB_URL (SAS do container das oportunidades com Read + Create + Write).';
    el.innerHTML =
      '<div class="cs-card larga"><h3>Situação</h3><p>O que o módulo usa hoje no servidor.</p><div class="cot-diag">' +
        '<div class="' + (d.armazenamento ? 'ok' : 'nao') + '">' + (d.armazenamento ? IC.checkc : IC.alert) + '<span><b>Armazenamento</b>' + esc(arm) + '</span></div>' +
        '<div class="' + (d.ia ? 'ok' : 'nao') + '">' + (d.ia ? IC.checkc : IC.alert) + '<span><b>Leitura por IA</b>' + (d.ia ? 'Azure OpenAI do portal (o mesmo do PI · Pedido).' : 'Sem AOAI_ENDPOINT/AOAI_KEY: o agente abre o formulário vazio para preencher à mão.') + '</span></div>' +
        '<div class="ok">' + IC.info + '<span><b>Anexos</b>Até ' + (d.anexoMaxMB || 10) + ' MB por arquivo · PDF, imagem, planilha, documento, e-mail e ZIP.</span></div>' +
        '<div class="ok">' + IC.lock + '<span><b>Acesso</b>Quem tem a área Comercial do portal (grupos do Entra). As configurações abaixo, só o dono do módulo altera.</span></div>' +
      '</div></div>' +
      (dono ? '' : '<div class="cs-faixa larga">' + IC.lock + '<div>Só o dono do portal altera as configurações. Você vê o que está valendo.</div></div>') +
      bloco('cfg-portais', 'Portais de cotação', 'A lista do campo Portal (um por linha). A leitura da IA é encaixada nestes nomes — o funil agrupa por eles.', c.portais, 8) +
      bloco('cfg-perda', 'Motivos de perda', 'Obrigatório ao marcar "Perdida". Alimenta o funil: por que perdemos.', c.motivosPerda, 8) +
      bloco('cfg-cancel', 'Motivos de cancelamento', 'Também aparecem como motivo da Perdida (desde 21/10/2026 a Cancelada é uma Perdida; "Proposta vencida" entra sempre).', c.motivosCancelamento, 8) +
      '<div class="cs-card"><h3>Empresa e unidade de negócio</h3><p>A oportunidade é sempre da <b>MSB</b>, empresa e unidade de negócio (o CRM da MSB não tem submódulos). ' +
        'Quem tem a área Comercial do portal vê todas as oportunidades da MSB; as da BIO ficam no portal da BIO.' +
        (S.eu && S.eu.area ? ' A equipe do Entra (<b>' + esc(S.eu.area) + '</b>) segue no caso como informação.' : '') + '</p></div>' +
      '<div class="cs-card"><h3>Aviso de vencimento</h3><p>Quantos dias antes da data de vencimento a oportunidade entra em "Prazo vencendo". Passou da data sem resultado, o portal passa a oportunidade para Perdida sozinho, com o motivo "Comprador não informou o motivo" — dá para reabrir (ela não é marcada de novo) ou virar pedido.</p><div class="cs-campo"><input id="cfg-aviso" type="number" min="0" max="30" value="' + (c.avisoDias != null ? c.avisoDias : 2) + '"' + dis + '></div></div>' +
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
    // o menu lateral acende Cotações ou Quadro (replaceState não dispara hashchange)
    if (typeof W.bmSidebarAba === 'function') W.bmSidebarAba();
    renderTudo();
  }
  function renderTudo(chegaram) {
    renderKpis();
    if (S.aba === 'lista') { if (S.caso) renderCaso(); else renderLista(chegaram); }
    if (S.aba === 'quadro') renderQuadro();
    if (S.aba === 'historico') renderHistorico();
    if (S.aba === 'config') renderConfig();
  }

  /* ── dados e tempo real ─────────────────────────────────────── */
  function aplicar(j) {
    var antes = S.conhecidos, chegaram = {};
    S.eu = j.eu || S.eu; S.cfg = j.cfg || S.cfg; S.configurado = j.configurado !== false; S.rev = j.rev;
    if (S.cfg && S.cfg.fases) C.FASES.forEach(function (f) { var s = S.cfg.fases.filter(function (x) { return x.id === f.id; })[0]; if (s) { f.nome = s.nome; f.desc = s.desc || f.desc; } });
    // o submódulo do CRM (Venda Recorrente / BIO.ID): só as da unidade dele
    S.casos = C.doSubmodulo(j.casos || []).map(function (c) { c.fase = C.faseDe(c); return c; });
    C.guardarPessoa(S.eu);
    S.porNumero = {}; S.casos.forEach(function (c) { S.porNumero[c.numero] = c; });
    S.conhecidos = {}; S.casos.forEach(function (c) { S.conhecidos[c.numero] = 1; if (antes && !antes[c.numero]) chegaram[c.numero] = 1; });
    // os responsáveis da tela, cada um com a sua cor (23/10/2026)
    C.coresDistintas(S.casos.map(function (c) { return c.dono && c.dono.email; }).concat([S.eu && S.eu.email]));
    S.carregou = true;
    pintarLive('ok', 'Ao vivo · ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    S.multiUnidade = S.casos.map(function (c) { return c.unidade || ''; }).filter(function (u, i, l) { return l.indexOf(u) === i; }).length > 1;
    faixa(S.configurado ? faixaUnidade() : '<b>Armazenamento não configurado.</b> As oportunidades só começam a ser guardadas depois que o dono do portal configurar o <b>COT_MSB_BLOB_URL</b>.', 'alerta');
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
    ligarTramitacao(app);
    D.addEventListener('click', function (ev) {
      var a = ev.target.closest('#cot-abas [data-aba]'), aba = a && a.getAttribute('data-aba');
      // o menu lateral: Cotações (#lista) e Quadro (#quadro) são abas DESTA
      // página — troca sem recarregar (Ctrl/⌘/Shift: o navegador abre outra aba)
      var sb = !a && ev.target.closest('.area-sidebar a[data-sb-aba]');
      if (sb && !(ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey)) {
        var m = /comercial-cot-casos\.html(?:#(lista|quadro|historico|config))?$/.exec(sb.getAttribute('href') || '');
        if (m) aba = m[1] || 'lista';
      }
      if (!aba) return;
      ev.preventDefault();
      if (S.caso) { S.caso = null; S.abrindo = ''; S.deAba = ''; mostrarCaso(false); try { history.replaceState(null, '', location.pathname); } catch (e) {} }
      irAba(aba);
    });
    // voltar/avançar do navegador entre #lista, #quadro e #config
    W.addEventListener('hashchange', function () {
      var h = (location.hash || '').replace('#', '');
      if (['lista', 'quadro', 'historico', 'config'].indexOf(h) < 0 || h === S.aba) return;
      if (S.caso) { S.caso = null; S.abrindo = ''; S.deAba = ''; mostrarCaso(false); }
      irAba(h, true);
    });
    app.addEventListener('click', function (ev) {
      var t = ev.target;
      var k = t.closest('[data-visao]');
      if (k) { S.visao = k.getAttribute('data-visao'); if (S.caso) fecharCaso(); if (S.aba !== 'lista') irAba('lista'); else renderTudo(); return; }
      var p = t.closest('[data-portal]');
      if (p) { S.portal = p.getAttribute('data-portal'); refiltrar(); return; }
      var un = t.closest('[data-unidade]');
      if (un) { S.unidade = un.getAttribute('data-unidade'); refiltrar(); return; }
      var dn = t.closest('[data-dono]');
      if (dn) { S.dono = dn.getAttribute('data-dono'); refiltrar(); return; }
      if (t.closest('[data-tram]')) { S.tramitacao = !S.tramitacao; refiltrar(); return; }
      var mh = t.closest('[data-mes]');
      if (mh) { var mk = mh.getAttribute('data-mes'); S.mesAberto[mk] = mh.getAttribute('aria-expanded') !== 'true'; renderQuadro(); return; }
      var ab = t.closest('[data-abrir]');
      if (ab) { abrirCaso(ab.getAttribute('data-abrir')); return; }
      if (t.closest('#cot-limpar, #cot-limpar-q')) { S.portal = ''; S.unidade = ''; S.dono = ''; S.tramitacao = false; S.busca = ''; ['cot-busca', 'cot-busca-q'].forEach(function (id) { if ($(id)) $(id).value = ''; }); refiltrar(); return; }
      var hc = t.closest('[data-hist-cod]');
      if (hc) { histIr(hc.getAttribute('data-hist-cod')); return; }
      var ha = t.closest('[data-hist-abrir]');
      if (ha) { var hk = ha.getAttribute('data-hist-abrir'); S.histAberto[hk] = !S.histAberto[hk]; renderHistorico(); return; }
      if (t.closest('[data-hist-lista]')) { S.visao = 'todas'; S.portal = ''; S.unidade = ''; S.dono = ''; S.tramitacao = false; S.busca = histBusca(); ['cot-busca', 'cot-busca-q'].forEach(function (id) { if ($(id)) $(id).value = S.busca; }); irAba('lista'); return; }
      var row = t.closest('.cot-row, .cs-kcard, .cot-hrow');
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
      // o resultado do item: clicar no marcado tira a marca; no tracejado (o da fase), confirma.
      // Na cotação que virou pedido o item fica sempre Ganho ou Perdido (21/10/2026)
      var rb = t.closest('[data-res]');
      if (rb && c) {
        var ri = Number(rb.getAttribute('data-i')), rr = rb.getAttribute('data-res'), marca = ((c.itens || [])[ri] || {}).resultado || '';
        if (marca === rr && (c.fase === 'pedido' || c.pedido)) return;
        rb.classList.add('pend');
        marcarResultado(c, [{ i: ri, r: marca === rr ? '' : rr }]);
        return;
      }
      var rl = t.closest('[data-res-lote]');
      if (rl && c) {
        var lote = rl.getAttribute('data-res-lote').split(',').map(Number);
        rl.disabled = true;
        marcarResultado(c, lote.map(function (i) { return { i: i, r: 'perdido' }; }), lote.length === 1 ? 'Item marcado como perdido' : lote.length + ' itens marcados como perdidos');
        return;
      }
      var edt = t.closest('.cs-edit');
      if (edt) { editarCampo(edt); return; }
      var tx = t.closest('[data-tirar-extra]');
      if (tx && c) { extrasDe(c).arquivos.splice(Number(tx.getAttribute('data-tirar-extra')), 1); pintarExtras(c); return; }
      if (t.closest('#cot-copiar') && c) {
        var link = location.origin + location.pathname + '?caso=' + encodeURIComponent(c.numero);
        try { navigator.clipboard.writeText(c.numero + ' — ' + link); C.toast('Copiado', c.numero + ' e o link do caso', 'ok'); } catch (e) {}
        return;
      }
      var b = t.closest('[data-act]'); if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'voltar') { fecharCaso(); return; }
      if (act === 'cfg-salvar') { salvarConfig(); return; }
      if (act === 'pbi-conectar') { conectarPbi(); return; }
      if (!c) return;
      if (act === 'assumir' || act === 'liberar') { acao({ acao: act, numero: c.numero }, act === 'assumir' ? 'Você assumiu a oportunidade' : 'Oportunidade devolvida para a fila').catch(function () {}); return; }
      if (act === 'atribuir') { dlgAtribuir(c); return; }
      if (act === 'virou-pedido') { dlgPedido(c); return; }
      if (act === 'ped-manual') { dlgPedido(c, null, 'manual'); return; }
      if (act === 'ped-ov') { dlgPedido(c, null, 'ov'); return; }
      if (act === 'reabrir') { dlgReabrir(c); return; }
      if (act === 'amostra') { dlgAmostra(c); return; }
      if (act === 'descartar') { dlgDescartar(c); return; }
      if (act === 'restaurar') { acao({ acao: 'descartar', numero: c.numero, descartado: false }, 'Oportunidade restaurada').catch(function () {}); return; }
      if (act === 'abrir-pi') { abrirPI(c); return; }
      if (act === 'ler-pedido') { lerPedido(c); return; }
      if (act === 'ov-fechar') { registrarOv(c, false); return; }
      if (act === 'ov-mais') { S.ovMais[c.numero] = true; renderCaso(); var oi = $('cot-ov-num'); if (oi) oi.focus(); return; }
      if (act === 'ov-mais-x') { S.ovMais[c.numero] = false; S.ovEnvio[c.numero] = {}; renderCaso(); return; }
      if (act === 'nota') { enviarNota(c); return; }
      if (act === 'itens-editar') {
        S.editandoItens = true; S.ipiEdicao = false; S.itensRascunho = JSON.parse(JSON.stringify(c.itens || [])); if (!S.itensRascunho.length) S.itensRascunho.push(novoItem()); renderCaso();
        // o fabricante e o RMS do cadastro do Salesforce (o que vai na proposta) — gravam ao salvar
        var rasc = S.itensRascunho;
        C.completarDoSf(rasc).then(function (n) { if (n && S.itensRascunho === rasc) pintarSfRascunho(); }, function () {});
        return;
      }
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
      if (act === 'ped-desfazer') { desfazerPedido(c); return; }
      if (act === 'fat-editar') { dlgFaturar(c, false); return; }
    });
    app.addEventListener('input', function (ev) {
      var t = ev.target;
      // a busca é uma só: a da lista e a do quadro andam juntas
      if (t.id === 'cot-hist-cod') { S.histCod = t.value; buscarHist(); return; }
      if (t.id === 'cot-busca' || t.id === 'cot-busca-q') { S.busca = t.value; var outra = $(t.id === 'cot-busca' ? 'cot-busca-q' : 'cot-busca'); if (outra) outra.value = t.value; buscar(); return; }
      if (t.id === 'cot-nota' && S.caso) { S.rascunho[S.caso.numero] = t.value; return; }
      if (t.id === 'cot-prop-para' && S.caso) { S.propPara[S.caso.numero] = t.value; return; }
      if (t.id === 'cot-prop-nome' && S.caso) { S.propNome[S.caso.numero] = t.value; return; }
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
        it[f] = (f === 'quantidade' || f === 'valorUnitario' || f === 'ipi') ? C.num(t.value) : t.value;
        if (f === 'ipi') { t.classList.toggle('invalido', Number(it.ipi) > 100); var ti = $('cot-tot-ipi'); if (ti) ti.outerHTML = htmlTotIpi(S.itensRascunho, true); }
        if (f === 'codigo' && it._cod) { it._cod = null; tr.classList.remove('cod-nao', 'cod-ok'); var st = tr.querySelector('.cod-st-box'); if (st) st.innerHTML = ''; }
        if (f === 'codigo') sfRascunho(it);
        if (f === 'quantidade' || f === 'valorUnitario') {
          var cel = app.querySelector('[data-tot="' + i + '"]'); if (cel) cel.textContent = it.quantidade && it.valorUnitario ? C.brl(it.quantidade * it.valorUnitario) : '—';
          var tt = $('cot-itens-total'); if (tt) tt.textContent = C.brl(totalDe(S.itensRascunho));
          var tj = $('cot-tot-ipi'); if (tj) tj.outerHTML = htmlTotIpi(S.itensRascunho, S.ipiEdicao || C.temIpi(S.itensRascunho));
        }
      }
    });
    app.addEventListener('change', function (ev) {
      var t = ev.target, c = S.caso;
      if (t.id === 'cot-ordem') { S.ordem = t.value; C.gravarLocal('cot-ordem', t.value); renderLista(); return; }
      // o "Tem IPI?" na edição dos itens (29/10/2026): desmarcar tira o IPI de todos
      if (t.id === 'cot-ipi' && S.itensRascunho) {
        S.ipiEdicao = t.checked;
        if (!t.checked) S.itensRascunho.forEach(function (it) { delete it.ipi; });
        renderCaso();
        if (t.checked) { var pi = D.querySelector('#cot-caso table.cot-itens input[data-f="ipi"]'); if (pi) pi.focus(); }
        return;
      }
      if (t.id === 'cot-arq-ped' && c) { var fp = t.files && t.files[0]; t.value = ''; if (c.pedido) anexarPedido(c, fp); else if (fp) dlgPedido(c, fp); return; }
      if (t.id === 'cot-arq-outro' && c) { anexarOutro(c, t.files && t.files[0]); t.value = ''; return; }
      // os outros arquivos da proposta (22/10/2026)
      if (t.matches('#cot-prop-extras input[data-extras]') && c) {
        var fs = Array.prototype.slice.call(t.files || []), cc = c; t.value = '';   // a cópia: limpar o campo esvazia o t.files
        C.lerExtras(fs).then(function (l) { var ex = extrasDe(cc); ex.arquivos = ex.arquivos.concat(l); pintarExtras(cc); }, function (e) { C.toast('Não consegui ler o arquivo', e.message, 'erro'); });
        return;
      }
      if (t.matches('[data-extra-caso]') && c) { extrasDe(c).doCaso[t.getAttribute('data-extra-caso')] = t.checked; pintarExtras(c); return; }
      // o motivo do item perdido (opcional): grava na hora
      if (t.matches('[data-res-mot]') && c) { t.disabled = true; marcarResultado(c, [{ i: Number(t.getAttribute('data-res-mot')), r: 'perdido', m: t.value }], t.value ? 'Motivo da perda gravado' : ''); return; }
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
      if (d.id === 'cot-drop-ped') { if (S.caso.pedido) anexarPedido(S.caso, f); else if (f) dlgPedido(S.caso, f); } else anexarOutro(S.caso, f);
    });
    // quadro: arrastar muda a fase
    var arrastando = '';
    app.addEventListener('dragstart', function (ev) { var k = ev.target.closest && ev.target.closest('.cs-kcard'); if (!k) return; tramEsconder(); arrastando = k.getAttribute('data-num'); k.classList.add('arrastando'); try { ev.dataTransfer.setData('text/plain', arrastando); } catch (e) {} });
    app.addEventListener('dragend', function (ev) { var k = ev.target.closest && ev.target.closest('.cs-kcard'); if (k) k.classList.remove('arrastando'); Array.prototype.forEach.call(D.querySelectorAll('.cs-col.alvo'), function (x) { x.classList.remove('alvo'); }); });
    app.addEventListener('dragover', function (ev) { var col = ev.target.closest && ev.target.closest('#cot-kanban .cs-col'); if (col && arrastando) { ev.preventDefault(); col.classList.add('alvo'); } });
    app.addEventListener('dragleave', function (ev) { var col = ev.target.closest && ev.target.closest('#cot-kanban .cs-col'); if (col && !col.contains(ev.relatedTarget)) col.classList.remove('alvo'); });
    app.addEventListener('drop', function (ev) {
      var col = ev.target.closest && ev.target.closest('#cot-kanban .cs-col'); if (!col || !arrastando) return;
      ev.preventDefault(); col.classList.remove('alvo');
      var num = arrastando, alvo = col.getAttribute('data-col'); arrastando = '';
      var r = S.porNumero[num]; if (!r || r.amostra) return;
      if (alvo === 'amostra') {
        if (C.faseAtual(r.fase) !== 'perdida') { C.toast('Só a oportunidade Perdida vira amostra', 'Marque como Perdida (com o motivo) e depois crie a amostra.', ''); return; }
        C.api('cot-casos?numero=' + encodeURIComponent(num)).then(function (j) { dlgAmostra(j.caso); }).catch(function (e) { C.toast('Não abriu a oportunidade', e.message, 'erro'); });
        return;
      }
      if (r.fase === alvo) return;
      C.api('cot-casos?numero=' + encodeURIComponent(num)).then(function (j) { mudarFase(j.caso, alvo); }).catch(function (e) { C.toast('Não abriu a oportunidade', e.message, 'erro'); });
    });
    // o PI avisa quando lançou o pedido no Dynamics
    if (W.CSPI) W.CSPI.ouvir(function (m) {
      if (!m || m.tipo !== 'pi-enviado' || !/^COT-/.test(m.numero || '')) return;
      C.toast('Pedido lançado no Dynamics', m.numero + ' · o PI registrou na oportunidade', 'ok');
      carregar(true);
      if (S.caso && S.caso.numero === m.numero) C.api('cot-casos?numero=' + encodeURIComponent(m.numero)).then(function (j) { S.caso = j.caso; mesclar(j.caso); renderTudo(); });
    });
    D.addEventListener('visibilitychange', function () { if (!D.hidden) carregar(); });
  }
  // o filtro mudou: redesenha a aba à vista (o quadro ou a lista)
  function refiltrar() { if (S.aba === 'quadro') renderQuadro(); else if (S.aba === 'historico') renderHistorico(); else renderLista(); }
  var buscar = C.debounce(refiltrar, 160);
  var buscarHist = C.debounce(function () { renderHistorico(); }, 200);
  // o produto no Salesforce no editor de itens (21/10/2026): o código digitado
  // traz o fabricante e o RMS do cadastro e a dica "Na proposta" — sem
  // redesenhar (o foco fica)
  function pintarSfRascunho() {
    var its = S.itensRascunho || [];
    var app = $('cot-app'); if (!app) return;
    Array.prototype.forEach.call(app.querySelectorAll('table.cot-itens:not(.ler) tr[data-i]'), function (tr) {
      var it = its[Number(tr.getAttribute('data-i'))]; if (!it) return;
      ['marca', 'registro'].forEach(function (f) { var el = tr.querySelector('[data-f="' + f + '"]'); if (el && el !== D.activeElement && el.value !== (it[f] || '')) el.value = it[f] || ''; });
      var b = tr.querySelector('.cot-sf-box'); if (b) b.innerHTML = C.dicaSf(it);
    });
  }
  var sfRascunho = C.debounce(function (it) {
    C.completarDoSf([it]).then(function (n) { if (n && S.itensRascunho && S.itensRascunho.indexOf(it) >= 0) pintarSfRascunho(); }, function () {});
  }, 600);
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
        return acao({ acao: 'leitura', numero: c.numero, dados: C.dadosDaLeitura(r && r.dados), leitura: { modelo: (r && (r.model || r.deployment)) || '', avisos: ((r && r.avisos) || []).filter(function (a) { return a.tipo !== 'total'; }) } }, 'A IA leu de novo');
      })
      .catch(function (e) { C.toast('A IA não conseguiu ler', e.message, 'erro'); renderCaso(); });
  }

  /* ── início ─────────────────────────────────────────────────── */
  function iniciar() {
    ligar();
    var aba = (location.hash || '').replace('#', '');
    if (['lista', 'quadro', 'historico', 'config'].indexOf(aba) >= 0) irAba(aba, true); else irAba('lista', true);
    // ?cliente=C004512 abre o Histórico daquele cliente
    var qc = new URLSearchParams(location.search).get('cliente');
    if (qc) { S.histCod = qc; var hi = $('cot-hist-cod'); if (hi) hi.value = qc; irAba('historico', true); }
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
