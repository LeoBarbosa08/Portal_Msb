/* ================================================================
   pi-fila.js — a aba FILA DE APROVAÇÃO do PI · Pedido
                (pages/pedido-inteligente.html — as abas Novo pedido | Fila)

   25/11/2026 (pedido do dono): "quando virar pedido, isso vai para uma fila
   de aprovações no PI PEDIDOS para alguém dar andamento, em formato de
   lista, com tudo lá, o PDF etc." e "a pessoa do CRM que fez a proposta não
   se preocupa em fazer no PI: clica em VIRAR PEDIDO e fica Aguardando o
   pedido ser finalizado".

   . A lista: GET /api/cot-casos?fila=1 (api/shared/cot-motor.js › fila) —
     as cotações com o pedido registrado: aguardando, em andamento,
     devolvidas, e as lançadas/finalizadas dos últimos 15 dias.
   . Abrir um pedido mostra TUDO: o comprador, o vendedor, as condições (a
     condição de pagamento e a transportadora são as listas do PI), a
     observação na nota, os itens e o PDF do pedido (a proposta gerada no
     "Virou pedido") num visor ao lado; a proposta de agora também sai.
   . "Dar andamento no PI": a mesma ponte do CRM (COT.abrirNoPI — IndexedDB,
     customer-service-pi.js): o PI · Pedido abre NESTA aba com o PDF, a
     leitura pronta (os itens ganhos) e as condições da oportunidade; o
     pedido fica "em andamento" com o nome de quem abriu. Lançado, o PI marca
     a cotação e a OV volta pelo flow — a oportunidade fecha como Ganha.
   . "Devolver ao vendedor" (com o motivo) e "Voltar para a fila" (o em
     andamento que não foi lançado): POST /api/cot-casos {acao:'pi'}.

   25/11/2026 (o dono: "isso tem que estar no PI, não crie dois agentes"): a
   fila NÃO é uma página/agente à parte — é a aba "Fila de aprovação" do PI ·
   Pedido, ao lado de "Novo pedido" (o assistente). A aba lembra a última
   escolha da pessoa (localStorage); ?aba=fila (&caso=COT-…) abre nela; o PI
   vindo do CRM/da fila (?cot=…) abre sempre no assistente. Sem acesso ao CRM
   (só Estoque), as abas somem e fica só o assistente.

   26/11/2026 (o dono: "retire a opção de NOVO PEDIDO, tudo será mediante FILA
   DE APROVAÇÃO"): saiu a aba Novo pedido. A página abre SEMPRE nas
   Aprovações; o assistente só aparece com o pedido que veio da fila (Dar
   andamento -> ?cot=…), numa aba com o número dele. Sem acesso ao CRM, fica a
   fila com o aviso — não há mais pedido avulso. E ("atualiza isso
   automaticamente a cada 1m"): a lista se busca sozinha 1 min depois da
   última busca, e a tela diz isso ao lado do horário.

   Usa cotacoes-base.js (window.COT: api, toast, diálogo, ícones, formatação);
   a proposta (jsPDF + cotacoes-proposta.js) só carrega no clique.
   ================================================================ */
(function () {
  'use strict';
  var W = window, D = document, C = W.COT;
  if (!C) { console.error('[pi-fila] cotacoes-base.js não carregou'); return; }
  var $ = C.$, esc = C.esc, IC = C.IC;
  var SETA = C.svg('<polyline points="6 9 12 15 18 9"/>');

  var ESTADOS = {
    aguardando: { nome: 'Aguardando', cls: 'pf-aguardando', ic: IC.alarm },
    andamento:  { nome: 'Em andamento', cls: 'pf-andamento', ic: IC.refresh },
    devolvido:  { nome: 'Devolvido ao vendedor', cls: 'pf-devolvido', ic: IC.alert },
    lancado:    { nome: 'Lançado · aguardando OV', cls: 'pf-lancado', ic: IC.checkc },
    finalizado: { nome: 'Finalizado (Ganha)', cls: 'pf-finalizado', ic: IC.trophy }
  };
  // 25/11/2026 (o dono, com o print da alçada de remessa: "algo assim, porém no
  // formato de lista"): sem filtros nem busca, em lista. E ("nem precisa me
  // mostrar esses outros"): só a FILA DE APROVAÇÃO — aguardando e em andamento,
  // o mais antigo primeiro; os devolvidos, lançados e finalizados não aparecem
  // (o servidor nem manda: /api/cot-casos?fila=1)
  var SECOES = [
    { id: 'fila', nome: 'Fila de aprovação', estados: ['aguardando', 'andamento'], vazio: 'Nada aguardando aprovação.' }
  ];
  // tentou: a última busca (deu certo ou não) — o relógio do "a cada 1 min";
  // pedido: o número aberto no assistente (?cot=/?cs=) — sem ele, não há a aba
  var S = { fila: [], dias: 15, carregou: false, erro: '', aberto: '', em: 0, tentou: 0, carregando: false, agindo: {}, pdf: {}, eu: null, pedido: '', semAcesso: false };
  var AUTO_MS = 60e3;

  function nome(p) { return (p && (p.nome || p.email)) || ''; }
  function chipEstado(it) {
    var e = ESTADOS[it.estado] || ESTADOS.aguardando;
    var txt = e.nome;
    if (it.estado === 'andamento' && it.pi.abertoPor) txt = 'Em andamento · ' + C.primeiroNome(nome(it.pi.abertoPor));
    if (it.estado === 'finalizado' && it.ovs.length) txt = 'Finalizado · ' + it.ovs[0].numero;
    return '<span class="cs-chip pf-chip ' + e.cls + '">' + e.ic + esc(txt) + '</span>';
  }

  /* ── carregar ───────────────────────────────────────────────── */
  function carregar(silencioso) {
    if (S.carregando) return Promise.resolve();
    S.carregando = true; S.tentou = Date.now();
    if (!silencioso) pintarAtual('<span class="cs-spin"></span> carregando…');
    return C.api('cot-casos?fila=1').then(function (j) {
      S.carregando = false;
      if (j && j.configurado === false) { S.erro = 'O armazenamento das cotações não está configurado (COT_MSB_BLOB_URL).'; S.fila = []; }
      else { S.erro = ''; S.fila = (j && j.fila) || []; S.dias = (j && j.dias) || 15; }
      S.carregou = true; S.em = Date.now();
      render();
    }).catch(function (e) {
      S.carregando = false; S.carregou = true;
      S.erro = (e.status === 401 || e.status === 403) ? e.message : 'Não consegui carregar a fila: ' + e.message;
      render();
    });
  }
  function pintarAtual(html) { var el = $('pf-atual'); if (el) el.innerHTML = html; }

  /* ── pintar ─────────────────────────────────────────────────── */
  function render() {
    renderLista(); pintarSelo(contar(['aguardando']));
    pintarAtual(S.em ? 'Atualizado às ' + C.dataBR(new Date(S.em).toISOString(), true).slice(11) + (S.semAcesso ? '' : ' · automático a cada 1 min') : '');
  }
  function contar(estados) { return S.fila.filter(function (it) { return estados.indexOf(it.estado) >= 0; }).length; }
  var CAB = '<div class="pf-cab" aria-hidden="true"><span>Pedido</span><span>Cliente</span><span>Vendedor</span><span>Pagamento · transportadora</span><span class="r">Valor</span><span></span></div>';
  // o pedido que EU abri no PI e ainda não lancei: o aviso no topo, com "Continuar o pedido"
  function htmlMeus() {
    var eu = S.eu && S.eu.email;
    if (!eu) return '';
    var meus = S.fila.filter(function (it) { return it.estado === 'andamento' && it.pi.abertoPor && String(it.pi.abertoPor.email || '').toLowerCase() === eu; });
    return meus.map(function (it) {
      return '<div class="pf-meu">' + IC.refresh + '<div><b>' + esc(it.numero) + ' · ' + esc(it.cliente.nome || '') + '</b> — você abriu este pedido no PI ' + esc(C.quando(it.pi.abertoEm)) +
        ' e ele ainda não foi lançado.<span>Continue de onde parou.</span></div>' +
        '<button type="button" class="cs-btn cs-btn-p" data-andamento="' + esc(it.numero) + '" data-meu="1">Continuar o pedido</button></div>';
    }).join('');
  }
  function renderLista() {
    var el = $('pf-lista'); if (!el) return;
    if (!S.carregou) { el.innerHTML = '<div class="pf-vazio"><span class="cs-spin"></span> Carregando…</div>'; return; }
    if (S.erro) { el.innerHTML = '<div class="pf-vazio erro">' + IC.alert + '<div><b>Aprovações indisponíveis</b>' + esc(S.erro) + '</div></div>'; return; }
    el.innerHTML = htmlMeus() + SECOES.map(function (sec) {
      var l = S.fila.filter(function (it) { return sec.estados.indexOf(it.estado) >= 0; });
      return '<section class="pf-sec" data-sec="' + sec.id + '"><h4>' + esc(sec.nome) + (l.length ? ' <span class="pf-sec-n">' + l.length + '</span>' : '') + '</h4>' +
        (l.length ? '<div class="pf-lista" role="list" aria-label="' + esc(sec.nome) + '">' + CAB + l.map(htmlLinha).join('') + '</div>'
          : '<p class="pf-nada">' + esc(sec.vazio) + '</p>') + '</section>';
    }).join('');
    if (S.aberto) pintarPdf(S.aberto);
  }
  function htmlLinha(it) {
    var aberto = S.aberto === it.numero, cli = it.cliente, co = it.condicoes;
    var local = [cli.cidade, cli.uf].filter(Boolean).join('/');
    var pend = it.estado === 'aguardando' || it.estado === 'andamento';
    var foraPag = co.pagamento && C.COND_PAGAMENTO.length && !C.naListaPag(co.pagamento);
    var ag = S.agindo[it.numero];
    return '<div class="pf-item' + (aberto ? ' aberto' : '') + '" role="listitem" data-num="' + esc(it.numero) + '">' +
      '<div class="pf-linha" data-abrir="' + esc(it.numero) + '" tabindex="0" role="button" aria-expanded="' + aberto + '">' +
        '<span class="pf-c pf-c-num"><b class="cs-mono">' + esc(it.numero) + '</b>' + chipEstado(it) + '</span>' +
        '<span class="pf-c pf-c-cli"><b>' + esc(cli.nome || 'Cliente não informado') + '</b><small>' + esc([cli.cnpj ? C.cnpjMask(cli.cnpj) : '', local].filter(Boolean).join(' · ')) + '</small></span>' +
        '<span class="pf-c pf-c-vend">' + (it.vendedor ? C.avatar(it.vendedor.nome, it.vendedor.email, 'p') : '') + '<span><b>' + esc(nome(it.vendedor) || '—') + '</b><small>' + esc(it.pedido.em ? 'virou pedido ' + C.quando(it.pedido.em) : '') + '</small></span></span>' +
        '<span class="pf-c pf-c-cond"><b' + (foraPag || !co.pagamento ? ' class="pf-alerta"' : '') + '>' + esc(co.pagamento || 'sem condição') + '</b><small>' + esc(co.transportadora || 'sem transportadora') + '</small></span>' +
        '<span class="pf-c pf-c-val"><b>' + C.brl(it.total) + '</b><small>' + it.nItens + (it.nItens === 1 ? ' item' : ' itens') + (it.pedido.oc ? ' · OC ' + esc(it.pedido.oc) : '') + '</small></span>' +
        '<span class="pf-c pf-c-acao">' + (pend ? '<button type="button" class="cs-btn cs-btn-sm cs-btn-p" data-andamento="' + esc(it.numero) + '"' + (ag ? ' disabled' : '') + '>' + (ag === 'andamento' ? '<span class="cs-spin"></span>' : IC.cart) + 'Dar andamento</button>' : '') +
          '<span class="pf-seta" aria-hidden="true">' + SETA + '</span></span>' +
      '</div>' +
      (aberto ? htmlDetalhe(it) : '') + '</div>';
  }
  function kv(rot, val, cls) { return '<dt>' + esc(rot) + '</dt><dd' + (cls ? ' class="' + cls + '"' : '') + '>' + (val || '<span class="vazio">—</span>') + '</dd>'; }
  function htmlDetalhe(it) {
    var cli = it.cliente, ct = it.contato, co = it.condicoes, pi = it.pi, ped = it.pedido;
    var foraPag = co.pagamento && C.COND_PAGAMENTO.length && !C.naListaPag(co.pagamento);
    var endereco = [cli.endereco, [cli.cidade, cli.uf].filter(Boolean).join('/'), cli.cep ? 'CEP ' + C.formatar('cep', cli.cep) : ''].filter(Boolean).join(' · ');
    // onde o pedido está
    var st = '';
    if (it.estado === 'aguardando') st = '<div class="pf-st">' + IC.alarm + '<div><b>Aguardando alguém dar andamento</b>na fila desde ' + esc(C.dataBR(ped.em, true)) + (ped.por ? ' · ' + esc(nome(ped.por)) + ' clicou em Virou pedido' : '') + (pi.erro ? '<br>A leitura do PDF falhou: ' + esc(pi.erro) : '') + '</div></div>';
    if (it.estado === 'andamento') st = '<div class="pf-st andamento">' + IC.refresh + '<div><b>Em andamento com ' + esc(nome(pi.abertoPor) || 'alguém') + '</b>aberto no PI ' + esc(C.quando(pi.abertoEm)) + '. Se não foi lançado, <b>Voltar para a fila</b> libera para outra pessoa.</div></div>';
    if (it.estado === 'devolvido') st = '<div class="pf-st devolvido">' + IC.alert + '<div><b>Devolvido ao vendedor por ' + esc(nome(pi.devolvido && pi.devolvido.por)) + '</b><q>' + esc((pi.devolvido && pi.devolvido.motivo) || '') + '</q>' + esc(pi.devolvido ? C.dataBR(pi.devolvido.em, true) : '') + ' — o vendedor ajusta na oportunidade e reenvia para a fila.</div></div>';
    if (it.estado === 'lancado' || it.estado === 'finalizado') {
      var e = pi.enviado || {};
      st = '<div class="pf-st ok">' + IC.checkc + '<div><b>' + (it.estado === 'finalizado' ? 'Finalizado — a oportunidade fechou como Ganha' : 'Lançado no Dynamics — aguardando a Ordem de Venda voltar') + '</b>' +
        esc([e.por ? 'lançado por ' + nome(e.por) : '', e.em ? C.dataBR(e.em, true) : '', e.oc ? 'OC ' + e.oc : ''].filter(Boolean).join(' · ')) +
        (it.ovs.length ? '<br>Ordem de Venda: <b class="cs-mono">' + it.ovs.map(function (o) { return esc(o.numero); }).join(', ') + '</b>' : '') + '</div></div>';
    }
    var itens = '<table class="pf-itens"><thead><tr><th>Código</th><th>Produto</th><th class="r">Qtd.</th><th class="r">Vlr. unit.</th><th class="r">Subtotal</th></tr></thead><tbody>' +
      (it.itens || []).map(function (x) {
        return '<tr><td class="cs-mono">' + esc(x.codigo || '—') + '</td><td>' + esc(x.descricao || '') + '</td><td class="r">' + C.qtd(x.quantidade) + '</td><td class="r">' + C.brl(x.valorUnitario) + '</td><td class="r">' + C.brl((Number(x.quantidade) || 0) * (Number(x.valorUnitario) || 0)) + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td colspan="4">Total do pedido' + (ped.lido ? '' : ' (os itens ganhos da oportunidade)') + '</td><td class="r">' + C.brl(it.total) + '</td></tr></tfoot></table>';
    var anexos = (it.anexos || []).map(function (a) {
      var rot = { pedido: 'PDF do pedido', proposta: 'proposta enviada', cotacao: 'PDF da cotação', outro: 'anexo' }[a.tipo] || 'anexo';
      return '<button type="button" class="pf-anexo" data-ver-anexo="' + esc(a.id) + '" data-num="' + esc(it.numero) + '">' + IC.pdf + '<span><b>' + esc(a.nome) + '</b><small>' + esc(rot + (a.tamanho ? ' · ' + C.bytes(a.tamanho) : '')) + '</small></span>' + IC.eye + '</button>';
    }).join('');
    var pend = it.estado === 'aguardando' || it.estado === 'andamento', ag = S.agindo[it.numero];
    var acoes = '<div class="pf-acoes">' +
      (pend ? '<button type="button" class="cs-btn cs-btn-p" data-andamento="' + esc(it.numero) + '"' + (ag ? ' disabled' : '') + '>' + IC.cart + 'Dar andamento no PI</button>' +
        '<button type="button" class="cs-btn" data-devolver="' + esc(it.numero) + '"' + (ag ? ' disabled' : '') + '>' + IC.back + 'Devolver ao vendedor</button>' : '') +
      (it.estado === 'andamento' ? '<button type="button" class="cs-btn cs-btn-ghost" data-soltar="' + esc(it.numero) + '"' + (ag ? ' disabled' : '') + '>' + IC.refresh + 'Voltar para a fila</button>' : '') +
      (it.estado === 'devolvido' ? '<button type="button" class="cs-btn cs-btn-ghost" data-soltar="' + esc(it.numero) + '"' + (ag ? ' disabled' : '') + ' title="Devolveu por engano? O pedido volta para a fila">' + IC.refresh + 'Desfazer a devolução</button>' : '') +
      '<button type="button" class="cs-btn cs-btn-ghost" data-proposta="' + esc(it.numero) + '">' + IC.file + 'Proposta (PDF)</button>' +
      '<a class="cs-btn cs-btn-ghost" href="comercial-cot-casos.html?caso=' + encodeURIComponent(it.numero) + '">' + IC.arrow + 'Abrir no CRM</a></div>';
    return '<div class="pf-det">' +
      '<div class="pf-det-l">' + st +
        '<div class="pf-blocos">' +
          '<section class="pf-bloco"><h5>' + IC.building + 'Comprador</h5><dl class="cs-kv">' +
            kv('Razão social', esc(cli.nome)) + kv('CNPJ', cli.cnpj ? '<span class="cs-mono">' + esc(C.cnpjMask(cli.cnpj)) + '</span>' : '') + kv('Código (ERP)', cli.codigo ? '<span class="cs-mono">' + esc(cli.codigo) + '</span>' : '') +
            kv('Endereço', esc(endereco)) + kv('Contato', esc([ct.nome, ct.telefone ? C.formatar('fone', ct.telefone) : ''].filter(Boolean).join(' · '))) + kv('E-mail', ct.email ? '<a href="mailto:' + esc(ct.email) + '">' + esc(ct.email) + '</a>' : '') +
          '</dl></section>' +
          '<section class="pf-bloco"><h5>' + IC.tag + 'Condições do pedido</h5><dl class="cs-kv">' +
            kv('Condição de pagamento', co.pagamento ? esc(co.pagamento) + (foraPag ? ' <span class="cs-chip prazo-alerta">fora da lista do PI</span>' : '') : '', !co.pagamento || foraPag ? 'pf-alerta' : '') +
            kv('Frete', esc(co.frete)) + kv('Transportadora', esc(co.transportadora)) + kv('Condição de entrega', esc(co.condEntrega)) + kv('Prazo de entrega', esc(co.entrega)) +
            kv('Ordem de compra', ped.oc ? '<span class="cs-mono">' + esc(ped.oc) + '</span>' : '') + kv('Observação', esc(co.observacao)) + kv('Obs. na nota', esc(co.obsNota)) +
          '</dl></section>' +
          '<section class="pf-bloco"><h5>' + IC.user + 'Oportunidade</h5><dl class="cs-kv">' +
            kv('Vendedor', esc(nome(it.vendedor))) + kv('Virou pedido', esc(ped.em ? C.dataBR(ped.em, true) + (ped.por ? ' · ' + nome(ped.por) : '') : '')) +
            kv('Portal', esc([it.portal, it.cotacaoId ? 'nº ' + it.cotacaoId : ''].filter(Boolean).join(' '))) + kv('Valor cotado', C.brl(it.totalCotado)) +
          '</dl></section>' +
        '</div>' +
        '<section class="pf-bloco pf-bloco-itens"><h5>' + IC.list + 'Itens do pedido · ' + it.nItens + '</h5>' + itens + '</section>' +
        (anexos ? '<section class="pf-bloco"><h5>' + IC.clip + 'Arquivos</h5><div class="pf-anexos">' + anexos + '</div></section>' : '') +
        acoes +
      '</div>' +
      '<aside class="pf-pdf" aria-label="PDF do pedido"><div class="pf-pdf-h">' + IC.pdf + '<b>' + esc(ped.nome || 'PDF do pedido') + '</b>' +
        (ped.anexoId ? '<button type="button" class="cs-btn cs-btn-xs" data-ver-anexo="' + esc(ped.anexoId) + '" data-num="' + esc(it.numero) + '">' + IC.eye + 'Abrir</button>' : '') + '</div>' +
        '<div class="pf-pdf-v" id="pf-pdf-' + esc(it.numero) + '">' + (ped.anexoId ? '<div class="pf-pdf-car"><span class="cs-spin"></span> Abrindo o PDF…</div>' : '<div class="pf-pdf-car">Pedido registrado à mão — sem PDF. Use <b>Proposta (PDF)</b>.</div>') + '</div></aside>' +
    '</div>';
  }

  /* ── o PDF do pedido ao lado (pdf.js, uma página por canvas) ─────── */
  function pintarPdf(num) {
    var it = S.fila.filter(function (x) { return x.numero === num; })[0];
    var box = $('pf-pdf-' + num);
    if (!it || !box || !it.pedido.anexoId) return;
    var cache = S.pdf[num];
    if (!cache || cache.id !== it.pedido.anexoId) {
      cache = S.pdf[num] = { id: it.pedido.anexoId, carga: C.baixarAnexo(num, it.pedido.anexoId).then(function (arq) { return C.b64ParaBytes(arq.base64); }) };
    }
    cache.carga.then(function (bytes) {
      var alvo = $('pf-pdf-' + num); if (!alvo) return;
      if (!cache.url) cache.url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      if (!W.pdfjsLib) { alvo.innerHTML = '<iframe src="' + cache.url + '#navpanes=0&view=FitH" title="PDF do pedido"></iframe>'; return; }
      return W.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise.then(function (doc) {
        var larg = Math.max(240, alvo.clientWidth - 24), dpr = Math.min(W.devicePixelRatio || 1, 2.5), cadeia = Promise.resolve(), limpou = false;
        for (var i = 1; i <= doc.numPages; i++) {
          (function (n) {
            cadeia = cadeia.then(function () { return doc.getPage(n); }).then(function (pg) {
              var el = $('pf-pdf-' + num); if (!el) return;
              var e1 = larg / pg.getViewport({ scale: 1 }).width, vp = pg.getViewport({ scale: e1 * dpr });
              var cv = D.createElement('canvas');
              cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
              cv.style.width = Math.floor(vp.width / dpr) + 'px';
              cv.setAttribute('aria-label', 'Página ' + n + ' de ' + doc.numPages);
              if (!limpou) { el.innerHTML = ''; limpou = true; }
              el.appendChild(cv);
              return pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
            });
          })(i);
        }
        return cadeia;
      });
    }).catch(function (e) {
      delete S.pdf[num];
      var el = $('pf-pdf-' + num); if (el) el.innerHTML = '<div class="pf-pdf-car erro">Não consegui abrir o PDF: ' + esc(e.message || e) + '</div>';
    });
  }

  /* ── ações ──────────────────────────────────────────────────── */
  function item(num) { return S.fila.filter(function (x) { return x.numero === num; })[0]; }
  function casoInteiro(num) {
    return C.api('cot-casos?numero=' + encodeURIComponent(num)).then(function (j) {
      if (!j || !j.caso) throw new Error('oportunidade não encontrada');
      return j.caso;
    });
  }
  function darAndamento(num, confirmado) {
    var it = item(num); if (!it) return;
    // alguém já abriu: pergunta antes, para não lançar duas vezes
    if (!confirmado && it.estado === 'andamento' && it.pi.abertoPor && (!S.eu || it.pi.abertoPor.email !== S.eu.email)) {
      C.dialogo('<h3>Este pedido já está em andamento</h3><p><b>' + esc(nome(it.pi.abertoPor)) + '</b> abriu o ' + esc(num) + ' no PI ' + esc(C.quando(it.pi.abertoEm)) + '. Confira com essa pessoa se ele já não foi lançado no Dynamics antes de seguir — senão o pedido pode sair duas vezes.</p>' +
        '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Voltar</button><button class="cs-btn cs-btn-p" value="ok" id="dlg-ok">' + IC.cart + 'Dar andamento mesmo assim</button></div>',
        function () { $('dlg-ok').addEventListener('click', function () { C.fecharDialogo(); darAndamento(num, true); }); });
      return;
    }
    S.agindo[num] = 'andamento'; render();
    casoInteiro(num).then(function (c) {
      // a mesma ponte do CRM: o PDF + a leitura pronta + as condições -> PI (nesta aba)
      return C.abrirNoPI(c, null, { fila: true });
    }).then(function (r) {
      if (r === false) { delete S.agindo[num]; render(); }
    }).catch(function (e) {
      delete S.agindo[num]; render();
      C.toast('Não consegui abrir no PI', e.message, 'erro');
    });
  }
  function dlgDevolver(num) {
    var it = item(num); if (!it) return;
    C.dialogo('<h3>Devolver ao vendedor</h3><p>' + esc(num) + ' · ' + esc(it.cliente.nome || '') + '. O pedido sai da fila e volta para <b>' + esc(nome(it.vendedor) || 'o vendedor') + '</b>, que vê o motivo na oportunidade, ajusta e reenvia.</p>' +
      '<div class="cs-campo"><label>O que precisa ser ajustado? *</label><textarea id="dlg-motivo" rows="4" maxlength="600" placeholder="ex.: a condição de pagamento não é a do cadastro do cliente; falta a OC; a transportadora…"></textarea></div>' +
      '<div class="cs-dlg-pe"><button class="cs-btn" value="x">Voltar</button><button class="cs-btn cs-btn-perigo" value="ok" id="dlg-ok">' + IC.back + 'Devolver</button></div>',
      function () {
        var t = $('dlg-motivo'); if (t) t.focus();
        $('dlg-ok').addEventListener('click', function (ev) {
          var m = String($('dlg-motivo').value || '').trim();
          if (!m) { ev.preventDefault(); C.toast('Diga o motivo', 'O vendedor precisa saber o que ajustar.', 'erro'); return; }
          C.fecharDialogo();
          agir(num, { acao: 'pi', numero: num, estado: 'devolvido', motivo: m }, 'Pedido devolvido ao vendedor');
        });
      });
  }
  function agir(num, corpo, ok) {
    S.agindo[num] = 'acao'; render();
    return C.api('cot-casos', corpo).then(function () {
      delete S.agindo[num];
      C.toast(ok, num, 'ok');
      return carregar(true);
    }).catch(function (e) {
      delete S.agindo[num]; render();
      C.toast('Não deu certo', e.message, 'erro');
    });
  }
  // a proposta de agora (todos os itens da oportunidade), no modelo da MSB
  function verProposta(num) {
    var it = item(num); if (!it) return;
    var janela = W.open('', '_blank');
    if (janela) { try { janela.document.title = 'Proposta ' + num; janela.document.body.innerHTML = '<p style="font:15px system-ui;padding:40px;color:#0F2831">Gerando a proposta…</p>'; } catch (e) {} }
    Promise.all([casoInteiro(num), garantirProposta()]).then(function (r) {
      var c = r[0], v = it.vendedor || {};
      if (!W.COTPROP || !W.COTPROP.pronto()) throw new Error('o gerador da proposta não carregou — recarregue a página (F5)');
      return W.COTPROP.gerar(c, { nome: v.nome || '', email: v.email || '', area: c.area || '', telefone: '' });
    }).then(function (pdf) {
      var url = URL.createObjectURL(pdf.blob);
      if (janela && !janela.closed) janela.location.href = url; else W.open(url, '_blank');
      setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
    }).catch(function (e) { if (janela && !janela.closed) janela.close(); C.toast('Não consegui gerar a proposta', e.message, 'erro'); });
  }
  function abrir(num) {
    S.aberto = S.aberto === num ? '' : num;
    renderLista();
    if (S.aberto) {
      var el = D.querySelector('.pf-item[data-num="' + S.aberto + '"]');
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /* ── as ABAS do PI: Aprovações | o pedido em andamento (só com ?cot=) ── */
  function pintarSelo(n) {
    var el = $('pi-fila-n'); if (!el) return;
    el.textContent = n; el.hidden = !n;
    var b = $('pi-aba-bt-fila'); if (b) b.title = n ? n + (n === 1 ? ' pedido esperando' : ' pedidos esperando') : 'Nenhum pedido esperando';
  }
  function abaAtual() { var f = $('pi-aba-fila'); return f && !f.hidden ? 'fila' : 'novo'; }
  function mostrarAba(id) {
    if (id === 'novo' && !S.pedido) id = 'fila';   // sem pedido da fila, não há assistente
    mostrarAbaSemCarregar(id);
    var fila = id === 'fila';
    if (fila && !S.semAcesso && (!S.carregou || Date.now() - S.em > 15e3)) carregar(S.carregou);
    // o PDF ao lado do assistente se redesenha na largura de agora
    if (!fila) { try { W.dispatchEvent(new Event('resize')); } catch (e) {} }
  }
  // sem o CRM, não há fila — e (26/11/2026) não há mais pedido avulso: fica o aviso
  function semAcesso(e) {
    S.semAcesso = true; S.carregou = true; S.fila = [];
    S.erro = 'Você não tem acesso à fila de aprovação (ela vem do CRM)' + (e && e.message ? ': ' + e.message : '') + '. Os pedidos do PI chegam só por ela — peça a liberação ao administrador do portal.';
    render();
  }
  // a proposta (jsPDF + cotacoes-proposta.js) só quando alguém pede
  var _prop = null;
  function carregarScript(src) {
    return new Promise(function (ok, falha) {
      var s = D.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { falha(new Error('não carregou ' + src)); };
      D.head.appendChild(s);
    });
  }
  function garantirProposta() {
    if (W.COTPROP && W.COTPROP.pronto()) return Promise.resolve();
    if (!_prop) {
      _prop = (W.jspdf ? Promise.resolve() : carregarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'))
        .then(function () { return W.COTPROP ? null : carregarScript('../cotacoes-proposta.js?v=12'); })
        .catch(function (e) { _prop = null; throw e; });
    }
    return _prop;
  }

  /* ── eventos ────────────────────────────────────────────────── */
  function ligar() {
    var app = $('pf-app');
    var abas = $('pi-abas');
    if (abas) abas.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-pi-aba]'); if (!b) return;
      mostrarAba(b.getAttribute('data-pi-aba'));
    });
    app.addEventListener('click', function (ev) {
      var t = ev.target;
      var b;
      if ((b = t.closest('[data-andamento]'))) { ev.preventDefault(); ev.stopPropagation(); darAndamento(b.getAttribute('data-andamento'), b.hasAttribute('data-meu')); return; }
      if ((b = t.closest('[data-devolver]'))) { ev.preventDefault(); dlgDevolver(b.getAttribute('data-devolver')); return; }
      if ((b = t.closest('[data-soltar]'))) { ev.preventDefault(); var n = b.getAttribute('data-soltar'); agir(n, { acao: 'pi', numero: n, estado: 'fila' }, 'O pedido voltou para a fila'); return; }
      if ((b = t.closest('[data-proposta]'))) { ev.preventDefault(); verProposta(b.getAttribute('data-proposta')); return; }
      if ((b = t.closest('[data-ver-anexo]'))) {
        ev.preventDefault(); ev.stopPropagation();
        var num = b.getAttribute('data-num'), it = item(num), id = b.getAttribute('data-ver-anexo');
        var a = it && (it.anexos || []).filter(function (x) { return x.id === id; })[0];
        C.abrirAnexo(num, a || { id: id, nome: 'PDF do pedido' });
        return;
      }
      if (t.closest('.pf-det')) return;
      if ((b = t.closest('[data-abrir]'))) { abrir(b.getAttribute('data-abrir')); }
    });
    app.addEventListener('keydown', function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-abrir]');
      if (b && ev.target === b && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); abrir(b.getAttribute('data-abrir')); }
    });
    $('pf-recarregar').addEventListener('click', function () { if (!S.semAcesso) carregar(); });
    // volta para a aba (ou o PI lançou noutra aba): atualiza
    D.addEventListener('visibilitychange', function () { if (!D.hidden && abaAtual() === 'fila' && S.carregou && !S.semAcesso && Date.now() - S.em > 15e3) carregar(true); });
    if (W.CSPI && W.CSPI.ouvir) W.CSPI.ouvir(function (m) { if (m && m.tipo === 'pi-enviado' && S.carregou && !S.semAcesso) carregar(true); });
    // 26/11/2026 (o dono: "atualiza isso automaticamente a cada 1m, para a pessoa
    // não ter que clicar em atualizar"): 1 min depois da última busca — o
    // Atualizar à mão zera a conta —, com a aba à vista, depois da 1ª carga e
    // sem diálogo aberto nem ação em curso (não mexe na lista no meio de um clique)
    setInterval(function () {
      var dlg = $('cs-dlg');
      if (D.hidden || abaAtual() !== 'fila' || !S.carregou || S.semAcesso || (dlg && dlg.open) || Object.keys(S.agindo).length) return;
      if (Date.now() - S.tentou >= AUTO_MS) carregar(true);
    }, 5e3);
  }

  function iniciar() {
    if (!$('pf-app')) return;
    ligar();
    var q = new URLSearchParams(location.search), alvo = q.get('caso') || '';
    // de onde abrir (26/11/2026: sem Novo pedido): o PI vindo da fila (Dar
    // andamento -> ?cot=…&fila=1; ou ?cs=) abre no assistente, numa aba com o
    // número do pedido; o resto abre SEMPRE nas Aprovações
    S.pedido = q.get('cot') || q.get('cs') || '';
    var bt = $('pi-aba-bt-novo');
    if (bt) { bt.hidden = !S.pedido; if (S.pedido) bt.textContent = 'Pedido ' + S.pedido; }
    try { W.localStorage.removeItem('pi-aba'); } catch (e) {}   // a última aba lembrada (antes de 26/11/2026)
    if (!S.pedido && (q.get('aba') || alvo)) { try { history.replaceState(null, '', location.pathname); } catch (e) {} }
    var abas = $('pi-abas'); if (abas) abas.hidden = false;
    mostrarAbaSemCarregar(S.pedido ? 'novo' : 'fila');
    render();
    C.aguardarLogin().then(function () {
      S.eu = W._portalUser ? { email: String(W._portalUser.email || '').toLowerCase(), nome: W._portalUser.name || '' } : null;
      // o selo da aba (barato: só o índice) — e quem não tem o CRM fica com o aviso
      return C.api('cot-casos?fila=conta').then(function (k) {
        pintarSelo((k && k.aguardando) || 0);
        return true;
      }, function (e) {
        if (e.status === 401 || e.status === 403) { semAcesso(e); return false; }
        return true;
      });
    }).then(function (ok) {
      if (!ok || abaAtual() !== 'fila') return;
      return carregar().then(function () {
        // ?caso=COT-MSB-…: abre aquele pedido (o "Ver na fila do PI" do CRM)
        var it = alvo && item(alvo);
        if (it) {
          S.aberto = '';
          abrir(alvo);
        } else if (alvo && S.carregou && !S.erro) {
          C.toast('Esse pedido não está na fila', alvo + ' — já foi lançado ou devolvido ao vendedor.', '');
        }
      });
    });
  }
  // a aba de abertura, sem buscar a fila ainda (o login vem antes)
  function mostrarAbaSemCarregar(id) {
    var fila = id === 'fila', pf = $('pi-aba-fila'), pn = $('pi-aba-novo');
    if (!pf || !pn) return;
    pf.hidden = !fila; pn.hidden = fila;
    ['novo', 'fila'].forEach(function (k) { var b = $('pi-aba-bt-' + k); if (b) b.setAttribute('aria-selected', String(k === id)); });
    var card = $('pi-card'); if (card) card.setAttribute('data-aba', id);
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
