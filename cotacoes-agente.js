/* ================================================================
   cotacoes-agente.js — AGENTE DE COTAÇÕES (pages/comercial-cot-nova.html)

   O "PI" das cotações: a pessoa responde a cotação no portal de compras
   (Bionexo, Apoio Cotações, GTPlan, Síntese…), baixa o PDF e solta aqui.

     1 · PDF          o arquivo (até 10 MB)
     2 · Leitura      pi-pdf-texto.js tira o texto com as COLUNAS no lugar e
                      a IA (/api/pedido-extrair, perfil 'cotacao') devolve
                      portal, nº da cotação, comprador, prazos, condições e
                      os itens com o preço cotado
     3 · Conferência  tudo editável, com o PDF do lado; a mesma cotação já
                      registrada aparece ANTES de criar (portal + nº)
     4 · Caso         /api/cot-casos {acao:'novo'} guarda o PDF e abre o caso
                      (COT-AAAA-NNNNNN) na Gestão de Cotações — e a PROPOSTA
                      no modelo da Biomedical (cotacoes-proposta.js) sai por
                      e-mail para o comprador, se a pessoa deixou marcado

   Regras de 09/10/2026: a cotação nasce SEMPRE Cotada; empresa sempre BIO;
   a área é a da equipe de segurança (Entra) de quem registra; não existe
   prazo do portal — a validade é a data da cotação + os dias de validade
   do PDF, e com ela já passada o caso nasce Vencida (descartada sozinha).

   Sem IA (ou PDF escaneado): o formulário vem vazio para preencher à mão —
   o PDF vai junto para o caso do mesmo jeito.
   ================================================================ */
(function () {
  'use strict';
  var C = window.COT; if (!C) return;
  var P = window.COTPROP || null;
  var D = document, $ = C.$, esc = C.esc, IC = C.IC;
  var MAX_MB = 10;

  var S = {
    passo: 'pdf', cfg: null, eu: null, configurado: null, erroBoot: '',
    arq: null, url: '', texto: '', leitura: null, dados: null, lidos: {},
    dup: null, forcar: false, criado: null, etapas: {}, criando: false, erroIA: '',
    // a proposta: enviar ao criar? para quem? (o telefone fica guardado no navegador)
    prop: { enviar: true, para: '', copia: '', telefone: C.lerLocal('cot-prop-tel') },
    envio: null   // { estado: 'enviando'|'ok'|'erro', msg, para }
  };

  function vazio() {
    return { portal: '', cotacaoId: '', empresa: 'BIO', area: (S.eu && S.eu.area) || '',
      cliente: { nome: '', cnpj: '', codigo: '', cidade: '', uf: '', endereco: '', cep: '' }, contato: { nome: '', email: '', telefone: '' },
      datas: { cotacao: '', validade: '' }, validadeCalculada: 0, vencimentoOrigem: '',
      condicoes: { pagamento: '', entrega: '', frete: '', validade: '', medico: '', observacao: '' },
      itens: [], totalPdf: 0, nota: '' };
  }
  // A DATA DE VENCIMENTO (datas.validade): o "Vencimento" do PDF, ou a data da
  // cotação + os dias de validade do PDF. Só a calculada acompanha a troca da
  // data da cotação; a lida do PDF ou digitada pela pessoa fica como está.
  function recalcularVencimento() {
    var d = S.dados; if (!d || d.vencimentoOrigem !== 'calc') return false;
    var v = C.validadeDe(d.condicoes.validade, d.datas.cotacao);
    if (!v.data) return false;
    d.datas.validade = v.data;
    d.validadeCalculada = v.calculada ? v.dias : 0;
    var inp = D.querySelector('[data-k="datas.validade"]'); if (inp) inp.value = v.data;
    return true;
  }
  // quem assina a proposta ("Preparado por")
  function operador() {
    var eu = S.eu || {}, d = S.dados || {};
    return { nome: eu.nome || '', email: eu.email || '', area: d.area || eu.area || eu.departamento || '', telefone: C.formatar('fone', S.prop.telefone || eu.telefone || '') };
  }
  function pegar(o, caminho) { return caminho.split('.').reduce(function (a, k) { return a == null ? '' : a[k]; }, o); }
  function por(o, caminho, v) { var ks = caminho.split('.'), last = ks.pop(); ks.reduce(function (a, k) { return (a[k] = a[k] || {}); }, o)[last] = v; }
  function emailOk(e) { return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(e || '').trim()); }
  function totalItens(itens) { return (itens || []).reduce(function (s, it) { return s + (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0); }, 0); }

  /* ── passos e faixa ─────────────────────────────────────────── */
  var PASSOS = [['pdf', 'PDF'], ['lendo', 'Leitura'], ['conf', 'Conferência'], ['pronto', 'Caso']];
  function pintarPassos() {
    var i = PASSOS.findIndex(function (p) { return p[0] === S.passo; });
    $('cot-passos').innerHTML = PASSOS.map(function (p, k) {
      return '<span class="cot-passo' + (k < i ? ' feito' : k === i ? ' atual' : '') + '"><i>' + (k < i ? '✓' : k + 1) + '</i>' + esc(p[1]) + '</span>';
    }).join('');
  }
  function faixa(html, tipo) {
    var f = $('cot-faixa'); if (!f) return;
    f.innerHTML = html ? '<div class="cs-faixa ' + (tipo || '') + '">' + (tipo === 'erro' ? IC.alert : IC.info) + '<div>' + html + '</div></div>' : '';
  }

  /* ── 1 · PDF ────────────────────────────────────────────────── */
  function htmlPdf() {
    return '<h3>Anexar a cotação do portal</h3>' +
      '<p class="cot-ag-sub">Solte aqui o PDF que o portal gerou da cotação — a proposta que você enviou ou o pedido de cotação do comprador. A IA lê o documento e preenche tudo para você conferir.</p>' +
      '<label class="cot-drop" id="cot-drop" tabindex="0"><input type="file" id="cot-arquivo" accept="application/pdf,.pdf" hidden>' +
        '<span class="ic">' + C.svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>', 28) + '</span>' +
        '<b>Clique para escolher ou arraste o PDF da cotação</b><small>Somente .pdf · até ' + MAX_MB + ' MB</small></label>' +
      '<div class="cot-drop-pe"><button type="button" class="cs-btn cs-btn-sm" id="cot-manual">' + IC.edit + 'Preencher à mão (sem PDF)</button><span>Cotação por telefone, e-mail ou PDF escaneado.</span></div>' +
      '<div class="cot-dicas">' +
        '<div class="cot-dica">' + IC.sparkle + '<div><b>A IA lê por você</b>Portal, nº da cotação, comprador, prazo, condições e cada item com o preço cotado.</div></div>' +
        '<div class="cot-dica">' + IC.copy + '<div><b>Sem cotação em dobro</b>Se a mesma cotação (portal + nº) já estiver no portal, o agente avisa antes de criar.</div></div>' +
        '<div class="cot-dica">' + IC.cart + '<div><b>Virou pedido? Vai para o PI</b>No caso, anexe o PDF do pedido do portal e mande para o PI · Pedido com um clique.</div></div>' +
      '</div>';
  }

  function receberArquivo(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name || '') && !/pdf/i.test(file.type || '')) { C.toast('Só PDF', 'Escolha o PDF que o portal gerou da cotação.', 'erro'); return; }
    if (file.size > MAX_MB * 1048576) { C.toast('Arquivo grande demais', 'O limite é ' + MAX_MB + ' MB.', 'erro'); return; }
    C.lerArquivo(file).then(function (arq) {
      if (S.url) URL.revokeObjectURL(S.url);
      S.arq = arq;
      S.url = URL.createObjectURL(new Blob([arq.buffer], { type: 'application/pdf' }));
      ler();
    }).catch(function (e) { C.toast('Não consegui abrir o arquivo', e.message, 'erro'); });
  }

  /* ── 2 · leitura ────────────────────────────────────────────── */
  var ETAPAS = [['texto', 'Lendo o texto do PDF'], ['ia', 'A IA está lendo a cotação — portal, nº, comprador, prazos e itens'], ['conf', 'Conferindo itens, valores e se a cotação já existe']];
  function htmlLendo() {
    return '<div class="cot-lendo"><span class="cot-lendo-ic">' + C.svg('<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>', 32) + '</span>' +
      '<b>Lendo ' + esc(S.arq ? S.arq.nome : 'a cotação') + '…</b>' +
      '<div class="cot-lendo-passos">' + ETAPAS.map(function (e) {
        var st = S.etapas[e[0]] || '';
        return '<div class="' + st + '">' + (st === 'on' ? '<span class="cs-spin"></span>' : st === 'ok' ? IC.checkc : IC.info) + esc(e[1]) + '</div>';
      }).join('') + '</div></div>';
  }
  function etapa(id, st) { S.etapas[id] = st; if (S.passo === 'lendo') render(); }

  function ler() {
    S.passo = 'lendo'; S.etapas = {}; S.leitura = null; S.erroIA = ''; S.dup = null; S.forcar = false; S.lidos = {};
    S.dados = vazio();
    render();
    etapa('texto', 'on');
    C.textoDoPdf(S.arq.buffer).then(function (texto) {
      S.texto = texto || '';
      etapa('texto', 'ok');
      if (S.texto.trim().length < 40) {
        S.leitura = { ia: false, avisos: [], erro: 'O PDF parece escaneado (imagem, sem texto) — preencha à mão. O PDF vai junto para o caso.' };
        return null;
      }
      return lerIA();
    }).catch(function (e) {
      S.leitura = { ia: false, avisos: [], erro: 'Não consegui ler o texto do PDF: ' + (e.message || e) };
      return null;
    }).then(function () {
      etapa('conf', 'on');
      return checarDupAgora();
    }).then(function () {
      etapa('conf', 'ok');
      S.passo = 'conf';
      render();
      conferirCodigos(true);
      buscarErp();
    });
  }
  // o Cód. Biomedical de cada item tem de ser um produto NOSSO (a tabela de
  // Produtos do BI do Comercial — a mesma conferência do PI · Pedido). Com
  // corrigir, o código que não é nosso é trocado pelo nosso da descrição
  // ("AM0302 - MANIFOLD…") e o antigo vai para o Cód. comprador.
  function conferirCodigos(corrigir) {
    var d = S.dados; if (!d || !d.itens.length) return Promise.resolve();
    S.codErro = '';
    d.itens.forEach(function (it) { if (it.codigo || corrigir) it._cod = { st: 'checando' }; });
    pintarItens();
    return C.conferirItens(d.itens, corrigir).then(function (r) {
      var pelaLinha = corrigir && S.texto ? C.casarPeloTexto(d.itens, S.texto) : 0;
      pintarItens();
      var n = ((r && r.corrigidos) || 0) + pelaLinha;
      if (n) C.toast('Código Biomedical corrigido', n + ' item(ns): o código lido não era nosso — usei o nosso que está no PDF.', '');
    }).catch(function (e) {
      S.codErro = e.message || String(e);
      d.itens.forEach(function (it) { if (it._cod && it._cod.st === 'checando') it._cod = null; });
      pintarItens();
    });
  }
  function pintarItens() { var b = $('cot-itens'); if (b && S.passo === 'conf') b.innerHTML = htmlItens(); }
  // um código digitado: confere só ele (sem redesenhar a tabela — o foco fica)
  var conferirLinha = C.debounce(function (i) {
    var it = S.dados && S.dados.itens[i]; if (!it) return;
    var linha = function () {
      var tr = D.querySelector('#cot-itens tr[data-i="' + i + '"]'); if (!tr) return;
      tr.classList.toggle('cod-nao', !!(it._cod && (it._cod.st === 'nao' || (it._cod.st === 'vazio' && Number(it.valorUnitario) > 0))));
      tr.classList.toggle('cod-ok', !!(it._cod && it._cod.st === 'ok'));
      var st = tr.querySelector('.cod-st-box'); if (st) st.innerHTML = C.statusCodigo(it);
    };
    if (!it.codigo) { it._cod = { st: 'vazio' }; linha(); return; }
    it._cod = { st: 'checando' }; linha();
    C.conferirItens([it], false).then(linha).catch(function (e) { S.codErro = e.message || String(e); it._cod = null; linha(); });
  }, 500);
  // a IA (pode ser chamada de novo pelo botão "Ler de novo")
  function lerIA() {
    etapa('ia', 'on');
    // o gabarito: os códigos do PDF que existem no nosso cadastro (BI) vão junto para a IA
    return C.codigosNossosNoTexto(S.texto).then(function (cods) {
      S.codigosPdf = cods;
      return C.lerComIA(S.texto, S.arq && S.arq.nome, 'cotacao', cods);
    }).then(function (r) {
      var d = C.dadosDaLeitura(r && r.dados);
      d.nota = (S.dados && S.dados.nota) || '';
      d.empresa = 'BIO';
      d.area = (S.dados && S.dados.area) || (S.eu && S.eu.area) || '';
      S.dados = d;
      S.lidos = {};
      ['portal', 'cotacaoId', 'cliente.nome', 'cliente.cnpj', 'cliente.cidade', 'cliente.uf', 'cliente.endereco', 'cliente.cep', 'contato.nome', 'contato.email', 'contato.telefone',
        'datas.cotacao', 'datas.validade', 'condicoes.pagamento', 'condicoes.observacao']
        .forEach(function (k) { if (pegar(d, k)) S.lidos[k] = 1; });
      if (d.itens.length) S.lidos.itens = 1;
      S.leitura = { ia: true, modelo: (r && (r.model || r.deployment)) || '', avisos: (r && r.avisos) || [], erro: '' };
      S.erroIA = '';
      // a proposta vai para o e-mail do comprador que veio no PDF
      S.prop.para = d.contato.email || S.prop.para;
      etapa('ia', 'ok');
    }).catch(function (e) {
      S.erroIA = e.status === 429 ? (e.message || 'O serviço de IA está ocupado agora.') : 'A IA não conseguiu ler: ' + (e.message || e);
      S.leitura = { ia: false, avisos: [], erro: S.erroIA };
      etapa('ia', 'erro');
    });
  }

  /* ── duplicidade (portal + nº da cotação) ───────────────────── */
  function checarDupAgora() {
    var d = S.dados || {};
    if (!d.cotacaoId || !S.configurado) { S.dup = null; return Promise.resolve(); }
    return C.api('cot-casos?duplicado=1&portal=' + encodeURIComponent(d.portal || '') + '&cotacao=' + encodeURIComponent(d.cotacaoId))
      .then(function (j) { S.dup = (j && j.caso) || null; }).catch(function () { S.dup = null; });
  }
  var checarDup = C.debounce(function () { checarDupAgora().then(pintarDup); }, 450);
  function htmlDup() {
    var d = S.dup;
    if (!d) return '';
    return '<div class="cot-dup">' + IC.copy + '<div><b>Esta cotação já está no portal: ' + esc(d.numero) + '</b>' +
      esc(C.tituloCaso(d)) + (d.cliente && d.cliente.nome ? ' · ' + esc(d.cliente.nome) : '') + ' · ' + esc(C.fase(d.fase).nome) +
      (d.dono ? ' · com ' + esc(d.dono.nome) : ' · sem responsável') + '</div>' +
      '<a class="cs-btn cs-btn-sm" href="comercial-cot-casos.html?caso=' + encodeURIComponent(d.numero) + '">Abrir o caso</a>' +
      '<label class="cs-check" style="display:inline-flex;gap:7px;align-items:center;font-weight:700"><input type="checkbox" id="cot-forcar"' + (S.forcar ? ' checked' : '') + '> Registrar mesmo assim</label></div>';
  }
  function pintarDup() { var el = $('cot-dup'); if (el) el.innerHTML = htmlDup(); }

  /* ── 3 · conferência ────────────────────────────────────────── */
  // os campos com máscara: só números (CNPJ, CEP, telefone) ou e-mail; a
  // máscara se monta ao digitar e o erro aparece ao sair do campo
  var MASCARA = {
    cnpj: { modo: 'numeric', max: 18 }, cep: { modo: 'numeric', max: 9 }, fone: { modo: 'tel', max: 15 },
    email: { modo: 'email', max: 200 }, emails: { modo: 'email', max: 600 }
  };
  function attrsMascara(tipo) {
    var m = MASCARA[tipo]; if (!m) return '';
    return ' data-mask="' + tipo + '" inputmode="' + m.modo + '" maxlength="' + m.max + '" spellcheck="false"';
  }
  function campo(rot, k, opt) {
    opt = opt || {};
    var v = opt.valor != null ? opt.valor : pegar(S.dados, k);
    if (opt.mask) v = C.formatar(opt.mask, v);
    var lido = S.lidos[k] ? ' lido' : '', falta = opt.obrig && !v ? ' falta' : '';
    var input;
    if (opt.lista) {
      input = '<select data-k="' + k + '"><option value="">—</option>' + opt.lista.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    } else if (opt.area) {
      input = '<textarea data-k="' + k + '" rows="' + (opt.linhas || 2) + '" placeholder="' + esc(opt.ph || '') + '">' + esc(v) + '</textarea>';
    } else {
      input = '<input data-k="' + k + '" type="' + (opt.tipo || 'text') + '" value="' + esc(opt.tipo === 'date' ? C.paraInput(v) : opt.tipo === 'datetime-local' ? C.paraInput(v, true) : v) + '"' +
        (opt.lista2 ? ' list="' + opt.lista2 + '"' : '') + (opt.ph ? ' placeholder="' + esc(opt.ph) + '"' : '') + (opt.max ? ' maxlength="' + opt.max + '"' : '') + attrsMascara(opt.mask) + ' autocomplete="off">';
    }
    return '<div class="cs-campo ' + (opt.cls || '') + lido + falta + '"' + (opt.id ? ' id="' + opt.id + '"' : '') + '><label>' + esc(rot) + (S.lidos[k] ? '<span class="ia">IA</span>' : '') + '</label>' + input +
      (opt.mask || opt.erro ? '<small class="cot-erro-campo" role="alert"></small>' : '') + (opt.aviso ? '<small class="cot-aviso-campo"></small>' : '') +
      (opt.dica ? '<small>' + opt.dica + '</small>' : '') + '</div>';
  }

  /* ── validação dos campos (19/10/2026) ──────────────────────────
     O erro do campo aparece ao SAIR dele (digitando, só some quando fica
     certo); "Criar o caso" confere tudo antes de qualquer outra coisa e
     leva ao primeiro campo errado. O que veio da IA já chega conferido. */
  function erroNoCampo(el, txt) {
    var w = el && el.closest('.cs-campo'); if (!w) return;
    w.classList.toggle('invalido', !!txt);
    var s = w.querySelector('.cot-erro-campo'); if (s) s.textContent = txt || '';
    el.setAttribute('aria-invalid', txt ? 'true' : 'false');
  }
  // o tipo da validação de um input (os da proposta não têm data-k)
  function tipoDe(el) { return el.getAttribute('data-mask') || (el.getAttribute('data-k') === 'datas.validade' ? 'vencimento' : ''); }
  function erroDe(el) {
    var tipo = tipoDe(el);
    if (tipo === 'vencimento') {
      var n = S.dados && diasDeValidade(S.dados);
      return n != null && n < 0 ? 'A data de vencimento é antes da data da cotação' : '';
    }
    if ((tipo === 'emails') && !(P && S.prop.enviar && S.dados && !C.venceu(S.dados.datas.validade))) return '';   // sem envio, a lista não importa
    return C.validar(tipo, el.value);
  }
  function conferirCampo(el) { var e = erroDe(el); erroNoCampo(el, e); return e; }
  // o aviso (não trava) de CEP de outro estado, embaixo do CEP
  function pintarAvisoCep() {
    var cep = D.querySelector('[data-k="cliente.cep"]'); if (!cep || !S.dados) return;
    var s = cep.closest('.cs-campo').querySelector('.cot-aviso-campo');
    if (s) s.textContent = C.avisoCepUf(S.dados.cliente.cep, S.dados.cliente.uf);
  }
  // os itens: com preço, a quantidade tem de ser > 0
  function itensSemQtd() {
    return ((S.dados && S.dados.itens) || []).map(function (it, i) { return Number(it.valorUnitario) > 0 && !(Number(it.quantidade) > 0) ? i : -1; }).filter(function (i) { return i >= 0; });
  }
  function pintarQtd() {
    var sem = itensSemQtd();
    D.querySelectorAll('#cot-itens tr[data-i]').forEach(function (tr) { tr.classList.toggle('qtd-falta', sem.indexOf(Number(tr.getAttribute('data-i'))) >= 0); });
    return sem;
  }
  // o que veio preenchido (IA, Dynamics, telefone guardado) já aparece conferido
  function marcarInvalidos() {
    D.querySelectorAll('#cot-corpo [data-mask], #cot-corpo [data-k="datas.validade"]').forEach(function (el) { if (el.value) conferirCampo(el); });
    pintarAvisoCep();
  }
  // tudo, antes de criar: devolve os rótulos dos campos errados
  function validarTudo() {
    var ruins = [];
    D.querySelectorAll('#cot-corpo [data-mask], #cot-corpo [data-k="datas.validade"]').forEach(function (el) {
      var e = conferirCampo(el);
      // o erro já diz o campo ("CNPJ inválido…"); só a lista de e-mails da proposta leva o rótulo (Para/Cópia)
      var lb = tipoDe(el) === 'emails' && el.closest('.cs-campo').querySelector('label');
      if (e) ruins.push({ el: el, nome: lb ? lb.childNodes[0].textContent.trim() : '', erro: e });
    });
    var sem = pintarQtd();
    if (sem.length) ruins.push({ el: D.querySelector('#cot-itens tr[data-i="' + sem[0] + '"] input[data-f="quantidade"]'), nome: '', erro: sem.length + ' item(ns) com preço e sem quantidade' });
    if (!ruins.length) return true;
    msg('<b>Corrija antes de criar:</b> ' + ruins.map(function (r) { return esc(r.nome ? r.nome + ': ' : '') + esc(r.erro); }).join(' · '), 'erro');
    var p = ruins[0].el;
    if (p) { p.scrollIntoView({ behavior: 'smooth', block: 'center' }); try { p.focus({ preventScroll: true }); } catch (e) { p.focus(); } }
    return false;
  }
  function htmlItens() {
    var d = S.dados, avisoDe = {};
    ((S.leitura && S.leitura.avisos) || []).forEach(function (a) { if (a.item >= 0) avisoDe[a.item] = a.texto; });
    var linhas = d.itens.map(function (it, i) {
      var ruim = it._cod && (it._cod.st === 'nao' || (it._cod.st === 'vazio' && Number(it.valorUnitario) > 0));
      var semQtd = Number(it.valorUnitario) > 0 && !(Number(it.quantidade) > 0);
      var cls = [avisoDe[i] ? 'aviso' : '', ruim ? 'cod-nao' : '', it._cod && it._cod.st === 'ok' ? 'cod-ok' : '', semQtd ? 'qtd-falta' : ''].filter(Boolean).join(' ');
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + (avisoDe[i] ? ' title="' + esc(avisoDe[i]) + '"' : '') + ' data-i="' + i + '">' +
        '<td class="cod"><input data-f="codigo" value="' + esc(it.codigo) + '" placeholder="Biomedical" autocomplete="off"><span class="cod-st-box">' + C.statusCodigo(it) + '</span></td>' +
        '<td class="codc"><input data-f="codigoCliente" value="' + esc(it.codigoCliente) + '" placeholder="Comprador"></td>' +
        '<td><input data-f="descricao" value="' + esc(it.descricao) + '" placeholder="Descrição do produto"></td>' +
        '<td class="marca"><input data-f="marca" value="' + esc(it.marca) + '" placeholder="Fabricante"></td>' +
        '<td class="rms"><input data-f="registro" data-mask="digitos" value="' + esc(it.registro) + '" placeholder="ANVISA" inputmode="numeric" maxlength="15"></td>' +
        '<td class="un"><input data-f="unidade" value="' + esc(it.unidade) + '"></td>' +
        '<td class="qtd n"><input data-f="quantidade" data-mask="num" inputmode="decimal" value="' + esc(it.quantidade ? C.qtd(it.quantidade) : '') + '"></td>' +
        '<td class="vu n"><input data-f="valorUnitario" data-mask="num" inputmode="decimal" value="' + esc(it.valorUnitario ? it.valorUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '') + '"></td>' +
        '<td class="vt tot" data-tot="' + i + '">' + (it.quantidade && it.valorUnitario ? C.brl(it.quantidade * it.valorUnitario) : '—') + '</td>' +
        '<td class="x"><button type="button" class="cs-btn cs-btn-xs cs-btn-ghost" data-tirar="' + i + '" title="Tirar o item">' + IC.x + '</button></td></tr>';
    }).join('');
    var ruins = C.itensComCodigoRuim(d.itens).filter(function (it) { return it._cod && it._cod.st !== 'checando'; }).length;
    var topo = S.codErro ? '<div class="cot-cod-faixa erro">' + IC.alert + '<div><b>Não consegui conferir os códigos no BI</b>' + esc(S.codErro) + '</div><button type="button" class="cs-btn cs-btn-xs" id="cot-cod-reconferir">' + IC.refresh + 'Conferir de novo</button></div>'
      : ruins ? '<div class="cot-cod-faixa">' + IC.alert + '<div><b>' + ruins + ' item(ns) sem código de produto Biomedical</b>O Cód. Biomedical tem de ser um produto nosso (o cadastro do BI do Comercial). Corrija as linhas em vermelho.</div></div>' : '';
    return topo + '<div class="cot-itens-w"><table class="cot-itens"><thead><tr><th class="cod">Cód. Biomedical</th><th class="codc">Cód. comprador</th><th>Descrição</th><th class="marca">Fabricante</th><th class="rms">RMS</th><th class="un">Un</th><th class="qtd n">Qtd</th><th class="vu n">Preço unit.</th><th class="vt n">Total</th><th class="x"></th></tr></thead>' +
      '<tbody>' + (linhas || '<tr><td colspan="10" style="padding:16px;text-align:center;color:var(--cs-mut)">Nenhum item — adicione abaixo.</td></tr>') + '</tbody></table></div>' +
      '<div class="cot-itens-pe"><button type="button" class="cs-btn cs-btn-sm" id="cot-add-item">' + IC.plus + 'Item</button>' +
      '<span>' + d.itens.length + ' item(ns)' + (d.totalPdf ? ' · total no PDF ' + C.brl(d.totalPdf) : '') + '</span>' +
      (d.totalPdf && Math.abs(totalItens(d.itens) - d.totalPdf) > Math.max(0.05, d.totalPdf * 0.005) ? '<span class="cot-tot-dif">' + IC.alert + 'não bate com o total do PDF — confira as quantidades</span>' : '') +
      '<span class="tot">Total cotado<b id="cot-total">' + C.brl(totalItens(d.itens)) + '</b></span></div>';
  }
  function htmlAvisos() {
    var l = S.leitura || {};
    var avisos = (l.avisos || []);
    var h = '';
    if (l.erro) {
      h += '<div class="cot-avisos"><b>' + (S.erroIA ? 'A leitura da IA não veio' : 'Preencha à mão') + '</b>' + esc(l.erro) +
        (S.erroIA && S.texto ? ' <button type="button" class="cs-btn cs-btn-xs" id="cot-reler" style="margin-left:6px">' + IC.refresh + 'Tentar ler de novo</button>' : '') + '</div>';
    }
    if (avisos.length) {
      h += '<div class="cot-avisos"><b>Confira antes de criar</b><ul>' + avisos.slice(0, 12).map(function (a) { return '<li>' + esc(a.texto) + '</li>'; }).join('') + '</ul></div>';
    }
    return h;
  }
  // de onde veio a DATA DE VENCIMENTO (a dica embaixo do campo) e o aviso de
  // cotação já vencida — redesenhados a cada tecla, sem perder o foco
  function htmlVencDica() {
    var d = S.dados, v = d.datas.validade, o = d.vencimentoOrigem;
    var txt = !v ? 'o PDF não trouxe — informe a data' : o === 'pdf' ? 'lida do PDF (Vencimento)' : o === 'calc' ? 'data da cotação + ' + d.validadeCalculada + ' dia(s) de validade' : 'informada por você';
    return (C.venceu(v) ? '<b class="venc">já passou · </b>' : '') + esc(txt);
  }
  function htmlVencida() {
    var v = S.dados && S.dados.datas.validade;
    if (!C.venceu(v)) return '';
    return '<div class="cot-vencida">' + IC.alarm + '<div><b>A data de vencimento desta cotação já passou (' + esc(C.diaBR(v)) + ')</b>Ao registrar, o caso entra direto como <b>Vencida</b> — descartado sozinho, fora do funil. Se a data estiver errada, corrija a Data de vencimento.</div></div>';
  }
  // a VALIDADE em dias = data de vencimento − data da cotação
  function diasDeValidade(d) {
    var a = C.dataPortal(d.datas.cotacao), b = C.dataPortal(d.datas.validade);
    if (!a || !b) return null;
    return Math.round((b.getTime() - a.getTime()) / 86400e3);
  }
  function textoDias(n) { return n == null ? '' : n === 1 || n === -1 ? n + ' dia' : n + ' dias'; }
  function htmlDias() {
    var n = diasDeValidade(S.dados);
    return '<label>Validade (dias)</label><div class="cot-calc' + (n != null && n < 0 ? ' vencida' : '') + '">' + (n == null ? '—' : esc(textoDias(n))) + '</div>' +
      '<small>' + (n != null && n < 0 ? 'vencimento antes da cotação?' : 'vencimento − data da cotação') + '</small>';
  }
  function pintarValidade() {
    var a = $('cot-venc-dica'); if (a) a.innerHTML = htmlVencDica();
    var dd = $('cot-val-dias'); if (dd) dd.innerHTML = htmlDias();
    var w = $('cot-venc-campo'); if (w) w.classList.toggle('vencida', C.venceu(S.dados && S.dados.datas.validade));
    // vencimento antes da cotação: o erro some assim que as datas ficam certas
    var vi = w && w.querySelector('input'); if (vi && w.classList.contains('invalido')) conferirCampo(vi);
    var b = $('cot-vencida-box'); if (b) b.innerHTML = htmlVencida();
    var cr = $('cot-criar'); if (cr && !S.criando) cr.innerHTML = rotuloCriar();
    var pr = $('cot-prop-box'); if (pr) pr.innerHTML = htmlProposta();
  }
  function rotuloCriar() {
    if (S.dados && C.venceu(S.dados.datas.validade)) return IC.ban + 'Registrar como vencida';
    return IC.checkc + (podeEnviar() ? 'Criar o caso e enviar a proposta' : 'Criar o caso da cotação');
  }
  // vai mandar a proposta ao criar? (marcado, com e-mail, sem estar vencida)
  function podeEnviar() {
    return !!(P && S.prop.enviar && S.dados && !C.venceu(S.dados.datas.validade) && P.listaEmails(S.prop.para).length);
  }
  function htmlProposta() {
    var d = S.dados, venc = C.venceu(d.datas.validade), op = operador();
    if (!P) return '<p class="cot-ag-sub" style="margin:0">O gerador da proposta não carregou nesta página — recarregue.</p>';
    var semEmail = !P.listaEmails(S.prop.para).length;
    return '<div class="cot-prop">' +
      '<div class="cot-prop-l">' +
        '<label class="cot-prop-chk"><input type="checkbox" id="cot-prop-enviar"' + (S.prop.enviar && !venc ? ' checked' : '') + (venc ? ' disabled' : '') + '> ' +
          '<span><b>Enviar a proposta por e-mail ao criar o caso</b><small>' + (venc ? 'Proposta vencida não é enviada.' :
            'O PDF no modelo da Biomedical, com os dados desta cotação e os seus, sai pelo seu Outlook (fica nos seus Itens Enviados).') + '</small></span></label>' +
        '<div class="cot-grade">' +
          '<div class="cs-campo s2' + (semEmail && S.prop.enviar && !venc ? ' falta' : '') + '"><label>Para (e-mail do comprador)</label><input id="cot-prop-para" type="text" value="' + esc(S.prop.para) + '" placeholder="compras@hospital.com.br" autocomplete="off"' + attrsMascara('emails') + '><small class="cot-erro-campo" role="alert"></small></div>' +
          '<div class="cs-campo s2"><label>Cópia (opcional)</label><input id="cot-prop-copia" type="text" value="' + esc(S.prop.copia) + '" placeholder="separe com ;" autocomplete="off"' + attrsMascara('emails') + '><small class="cot-erro-campo" role="alert"></small></div>' +
        '</div>' +
      '</div>' +
      '<div class="cot-prop-r"><small>Preparado por</small><b>' + esc(op.nome || '—') + '</b>' +
        '<span>' + esc(op.area || 'sem área') + ' · ' + esc(op.email || '') + '</span>' +
        '<div class="cs-campo" style="margin-top:8px"><label>Seu telefone na proposta</label><input id="cot-prop-tel" value="' + esc(op.telefone) + '" placeholder="(31) 9…" autocomplete="off"' + attrsMascara('fone') + '><small class="cot-erro-campo" role="alert"></small></div>' +
        '<button type="button" class="cs-btn cs-btn-sm" id="cot-prop-ver">' + IC.eye + 'Ver a proposta (PDF)</button></div>' +
    '</div>';
  }
  /* ── o comprador no Dynamics (pelo CNPJ) ──────────────────────────
     /api/cot-casos?cliente=CNPJ (shared/cot-erp.js, só leitura): o código
     do cliente, grupo, condição de pagamento cadastrada, endereço e se está
     BLOQUEADO. O que estiver VAZIO no formulário é completado (marcado
     "Dynamics"); o que veio do PDF fica. O servidor completa de novo ao criar. */
  function cnpjDigitos() { return String((S.dados && S.dados.cliente.cnpj) || '').replace(/\D/g, ''); }
  function buscarErp() {
    var d = cnpjDigitos();
    // só CNPJ/CPF válido vai ao Dynamics (o inválido daria "não encontrado" — parece cliente novo)
    if ((d.length !== 14 && d.length !== 11) || C.validar('cnpj', d)) { S.erp = null; pintarErp(); return; }
    S.erp = { estado: 'buscando', cnpj: d }; pintarErp();
    C.api('cot-casos?cliente=' + encodeURIComponent(d)).then(function (j) {
      if (cnpjDigitos() !== d) return;          // a pessoa trocou o CNPJ enquanto isso
      var v = (j && j.erp) || {};
      if (v.desligado) { S.erp = null; }
      else if (v.erro) { S.erp = { estado: 'erro', msg: v.erro }; }
      else if (v.achou) { S.erp = { estado: 'ok', v: v, completou: completarDoErp(v) }; }
      else { S.erp = { estado: 'nao' }; }
      pintarErp();
    }).catch(function (e) { if (cnpjDigitos() === d) { S.erp = { estado: 'erro', msg: e.message }; pintarErp(); } });
  }
  var buscarErpDepois = C.debounce(buscarErp, 700);
  function completarDoErp(v) {
    var cli = S.dados.cliente, feitos = [];
    cli.codigo = v.codigo || cli.codigo || '';
    var por = function (k, val) {
      if (!val || cli[k]) return;
      cli[k] = val; feitos.push(k);
      var inp = D.querySelector('[data-k="cliente.' + k + '"]');
      if (inp) { inp.value = val; var w = inp.closest('.cs-campo'); if (w) w.classList.add('erp'); }
    };
    por('nome', v.nome);
    por('endereco', [v.endereco, v.bairro].filter(Boolean).join(' - '));
    por('cidade', v.cidade); por('uf', C.formatar('uf', v.uf)); por('cep', C.formatar('cep', v.cep));
    pintarAvisoCep();
    return feitos.length;
  }
  function htmlErp() {
    var e = S.erp;
    if (!e) return '';
    if (e.estado === 'buscando') return '<div class="cot-erp">' + '<span class="cs-spin"></span><div><b>Procurando o CNPJ no Dynamics…</b></div></div>';
    if (e.estado === 'erro') return '<div class="cot-erp aviso">' + IC.alert + '<div><b>Não consegui consultar o Dynamics agora</b>' + esc(e.msg || '') + '</div><button type="button" class="cs-btn cs-btn-xs" id="cot-erp-de-novo">' + IC.refresh + 'Tentar de novo</button></div>';
    if (e.estado === 'nao') return '<div class="cot-erp novo">' + IC.info + '<div><b>CNPJ não encontrado no Dynamics</b>Cliente novo — o cadastro no ERP é pedido quando a cotação virar pedido (PI).</div></div>';
    var v = e.v, pag = S.dados.condicoes.pagamento;
    var linhas = [
      ['Código do cliente', v.codigo], ['Empresa', (v.empresas || []).join(', ') || v.empresa], ['Grupo', v.grupo],
      ['Cond. pagamento cadastrada', v.pagamento + (pag && v.pagamento && C.norm(pag).indexOf(C.norm(v.pagamento)) < 0 ? ' (o PDF diz: ' + pag + ')' : '')],
      ['Forma de pagamento', v.formaPagamento], ['Segmento', v.segmento], ['Vendedor', v.vendedor],
      ['Limite de crédito', v.limiteCredito ? C.brl(v.limiteCredito) : ''], ['E-mail no cadastro', v.email], ['Telefone no cadastro', v.telefone]
    ].filter(function (l) { return l[1]; });
    return '<div class="cot-erp ok' + (v.bloqueado ? ' bloq' : '') + '">' + (v.bloqueado ? IC.ban : IC.checkc) + '<div><b>Cliente no Dynamics' + (v.nome ? ' · ' + esc(v.nome) : '') + '</b>' +
      (v.bloqueado ? '<span class="cot-erp-bloq">BLOQUEADO no Dynamics (' + esc(v.bloqueio) + ')</span>' : '') +
      '<dl>' + linhas.map(function (l) { return '<dt>' + esc(l[0]) + '</dt><dd>' + esc(l[1]) + '</dd>'; }).join('') + '</dl>' +
      (e.completou ? '<small>Completei ' + e.completou + ' campo(s) vazio(s) com o cadastro (marcados "Dynamics").</small>' : '') + '</div></div>';
  }
  function pintarErp() { var b = $('cot-erp-box'); if (b) b.innerHTML = htmlErp(); }

  /* ── o PDF ao lado: visor próprio (pdf.js), ajustado à largura ─────
     O <iframe> abria o visor do navegador com as miniaturas e a 50%. Aqui
     cada página vira um canvas na largura do painel (zoom −/+; clicar no %
     volta a "ajustar") e o "⋯" do topo tem Abrir em nova aba, Baixar,
     Salvar como, Imprimir e Tela cheia. Sem pdf.js, volta o <iframe>. */
  var V = { doc: null, de: null, zoom: 0, escala: 1, vez: 0 };   // zoom 0 = ajustar à largura
  var IC_PDF = {
    dots: C.svg('<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>'),
    print: C.svg('<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'),
    save: C.svg('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>'),
    full: C.svg('<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>'),
    novo: C.svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>')
  };
  function htmlVisor() {
    var item = function (id, ic, txt) { return '<button type="button" role="menuitem" data-pdf="' + id + '">' + ic + '<span>' + esc(txt) + '</span></button>'; };
    return '<div class="cot-pdf-h">' + IC.pdf + '<span class="nm" title="' + esc(S.arq.nome) + '">' + esc(S.arq.nome) + ' · ' + C.bytes(S.arq.tamanho) + '</span>' +
      '<div class="cot-pdf-zoom"><button type="button" data-pdf="menos" title="Diminuir">−</button><button type="button" data-pdf="ajustar" class="pct" id="cot-pdf-pct" title="Ajustar à largura">100%</button><button type="button" data-pdf="mais" title="Aumentar">+</button></div>' +
      '<div class="cot-pdf-mais"><button type="button" class="cot-pdf-dots" data-pdf="menu" aria-haspopup="menu" aria-expanded="false" title="Mais opções">' + IC_PDF.dots + '</button>' +
        '<div class="cot-pdf-menu" id="cot-pdf-menu" role="menu" hidden>' +
          item('abrir', IC_PDF.novo, 'Abrir em nova aba') + item('baixar', IC.down, 'Baixar (download)') + item('salvar', IC_PDF.save, 'Salvar como…') +
          item('imprimir', IC_PDF.print, 'Imprimir') + item('cheia', IC_PDF.full, 'Tela cheia') +
        '</div></div></div>' +
      '<div class="cot-pdf-v" id="cot-pdf-v"><div class="cot-pdf-pags" id="cot-pdf-pags"><div class="cot-pdf-car"><span class="cs-spin"></span> Abrindo o PDF…</div></div></div>';
  }
  function visorIframe() { var v = $('cot-pdf-v'); if (v) v.innerHTML = '<iframe src="' + S.url + '#navpanes=0&view=FitH" title="PDF da cotação"></iframe>'; }
  function montarVisor() {
    if (!$('cot-pdf-pags') || !S.arq) return;
    if (!window.pdfjsLib) { visorIframe(); return; }
    if (V.de !== S.arq) {
      if (V.doc) { try { V.doc.destroy(); } catch (e) {} }
      V.doc = null; V.de = S.arq; V.zoom = 0;
      V.carga = window.pdfjsLib.getDocument({ data: new Uint8Array(S.arq.buffer.slice(0)) }).promise.then(function (doc) { V.doc = doc; return doc; });
    }
    V.carga.then(desenharPdf).catch(visorIframe);
  }
  function desenharPdf() {
    var box = $('cot-pdf-pags'), doc = V.doc; if (!box || !doc) return;
    var vez = ++V.vez, larg = Math.max(220, box.clientWidth - 28), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var limpou = false, cadeia = Promise.resolve();
    for (var i = 1; i <= doc.numPages; i++) {
      (function (n) {
        cadeia = cadeia.then(function () { return vez === V.vez ? doc.getPage(n) : null; }).then(function (pg) {
          if (!pg || vez !== V.vez) return;
          var esc1 = V.zoom || (larg / pg.getViewport({ scale: 1 }).width);
          if (n === 1) { V.escala = esc1; var p = $('cot-pdf-pct'); if (p) p.textContent = Math.round(esc1 * 100) + '%'; }
          var vp = pg.getViewport({ scale: esc1 * dpr });
          var cv = D.createElement('canvas');
          cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
          cv.style.width = Math.floor(vp.width / dpr) + 'px'; cv.style.height = Math.floor(vp.height / dpr) + 'px';
          if (!limpou) { box.innerHTML = ''; limpou = true; }
          box.appendChild(cv);
          return pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        });
      })(i);
    }
    return cadeia;
  }
  function menuPdf(abrir) {
    var m = $('cot-pdf-menu'), b = D.querySelector('.cot-pdf-dots'); if (!m) return;
    var on = abrir == null ? m.hidden : abrir;
    m.hidden = !on; if (b) b.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  function baixarPdf() { var a = D.createElement('a'); a.href = S.url; a.download = S.arq.nome; D.body.appendChild(a); a.click(); a.remove(); }
  function acaoPdf(id) {
    if (!S.arq) return;
    if (id === 'menu') { menuPdf(); return; }
    if (id === 'mais' || id === 'menos') { V.zoom = Math.max(0.4, Math.min(4, Math.round(((V.zoom || V.escala) + (id === 'mais' ? 0.25 : -0.25)) * 4) / 4)); desenharPdf(); return; }
    if (id === 'ajustar') { V.zoom = 0; desenharPdf(); return; }
    menuPdf(false);
    if (id === 'abrir') { window.open(S.url, '_blank'); return; }
    if (id === 'baixar') { baixarPdf(); return; }
    if (id === 'salvar') {
      // "Salvar como" de verdade (Chrome/Edge escolhem a pasta); sem ele, o download
      if (!window.showSaveFilePicker) { baixarPdf(); C.toast('Baixado', 'Este navegador salva direto na pasta Downloads.', ''); return; }
      window.showSaveFilePicker({ suggestedName: S.arq.nome, types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] })
        .then(function (h) { return h.createWritable(); })
        .then(function (w) { return w.write(new Blob([S.arq.buffer], { type: 'application/pdf' })).then(function () { return w.close(); }); })
        .then(function () { C.toast('PDF salvo', S.arq.nome, 'ok'); })
        .catch(function (e) { if (e && e.name !== 'AbortError') C.toast('Não consegui salvar', e.message, 'erro'); });
      return;
    }
    if (id === 'imprimir') {
      // o PDF num iframe escondido e o print dele (o diálogo de impressão do navegador)
      var f = D.createElement('iframe');
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
      f.src = S.url;
      f.onload = function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { window.open(S.url, '_blank'); } };
      D.body.appendChild(f);
      setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 120000);
      return;
    }
    if (id === 'cheia') {
      var p = $('cot-pdf');
      if (D.fullscreenElement) D.exitFullscreen(); else if (p && p.requestFullscreen) p.requestFullscreen().catch(function () { window.open(S.url, '_blank'); });
    }
  }

  function htmlConf() {
    var d = S.dados, cfg = S.cfg || {}, eu = S.eu || {};
    var areaDaEquipe = !!eu.area;
    return '<h3>' + (S.leitura && S.leitura.ia ? 'Confira o que a IA leu' : 'Dados da cotação') + '</h3>' +
      '<p class="cot-ag-sub">' + (S.leitura && S.leitura.ia ? 'Os campos com <b style="color:#5A3BC4">IA</b> vieram do PDF. Corrija o que precisar — o caso guarda exatamente o que estiver aqui.' : 'Preencha o que souber; dá para completar depois, no caso.') + '</p>' +
      '<div id="cot-dup">' + htmlDup() + '</div>' + htmlAvisos() + '<div id="cot-vencida-box">' + htmlVencida() + '</div>' +
      '<div class="cot-conf"><div class="cot-conf-form">' +
        '<div class="cot-sec"><h5>' + IC.inbox + 'Cotação no portal <span class="cs-chip f-cotada" style="margin-left:auto"><span class="bol"></span>Entra como Cotada</span></h5><div class="cot-grade">' +
          campo('Portal', 'portal', { cls: 's2', lista2: 'cot-portais', obrig: true, ph: 'Bionexo, Apoio Cotações…' }) +
          campo('Nº da cotação', 'cotacaoId', { cls: 's2', obrig: true, ph: 'número no portal' }) +
          campo('Data da cotação', 'datas.cotacao', { tipo: 'date', cls: 's2' }) +
          campo('Data de vencimento', 'datas.validade', { tipo: 'date', cls: 's2 cot-venc' + (C.venceu(d.datas.validade) ? ' vencida' : ''), id: 'cot-venc-campo', erro: true, dica: '<span id="cot-venc-dica">' + htmlVencDica() + '</span>' }) +
          '<div class="cs-campo s1" id="cot-val-dias">' + htmlDias() + '</div>' +
          '<div class="cs-campo s1"><label>Empresa</label><div class="cot-calc">BIO</div><small>sempre BIO</small></div>' +
          (areaDaEquipe
            ? '<div class="cs-campo s2"><label>Área</label><div class="cot-calc">' + esc(d.area || eu.area) + '</div><small title="' + esc(eu.equipe || '') + '">pela sua equipe no Entra' + (eu.equipe ? ': ' + esc(eu.equipe) : '') + '</small></div>'
            : campo('Área', 'area', { cls: 's2', ph: 'ex.: Comercial', dica: 'sua equipe de segurança não veio do Entra — informe a área' })) +
        '</div><datalist id="cot-portais">' + (cfg.portais || []).map(function (p) { return '<option value="' + esc(p) + '">'; }).join('') + '</datalist></div>' +
        '<div class="cot-sec"><h5>' + IC.building + 'Comprador</h5><div id="cot-erp-box">' + htmlErp() + '</div><div class="cot-grade">' +
          campo('Cliente (razão social)', 'cliente.nome', { cls: 's4', obrig: true }) +
          campo('CNPJ', 'cliente.cnpj', { cls: 's2', mask: 'cnpj', ph: '00.000.000/0000-00' }) +
          campo('CEP', 'cliente.cep', { cls: 's2', mask: 'cep', ph: '00000-000', aviso: true }) +
          campo('Endereço', 'cliente.endereco', { cls: 's4', ph: 'rua, número, bairro' }) +
          campo('Cidade', 'cliente.cidade', { cls: 's2' }) +
          campo('UF', 'cliente.uf', { lista: C.UFS }) +
          '<div></div>' +
          campo('Contato', 'contato.nome', { cls: 's2' }) +
          campo('Telefone', 'contato.telefone', { cls: 's2', mask: 'fone', ph: '(00) 00000-0000' }) +
          campo('E-mail do comprador', 'contato.email', { cls: 's4', mask: 'email', ph: 'nome@hospital.com.br', dica: 'é para ele que a proposta vai' }) +
        '</div></div>' +
        '<div class="cot-sec"><h5>' + IC.tag + 'Condições ofertadas</h5><div class="cot-grade">' +
          campo('Condição de pagamento', 'condicoes.pagamento', { cls: 's4', dica: 'exatamente como veio no PDF' }) +
          campo('Observação', 'condicoes.observacao', { cls: 's4', area: true, linhas: 2 }) +
        '</div></div>' +
      '</div>' +
      '<div class="cot-pdf" id="cot-pdf">' + (S.arq
        ? htmlVisor()
        :'<div class="cs-vazio"><div class="ic">' + C.svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>', 30) + '</div><h3>Sem PDF</h3>Cotação registrada à mão. Se tiver o PDF, anexe no caso depois.</div>') +
      '</div></div>' +
      '<div class="cot-sec cot-sec-larga"><h5>' + IC.list + 'Itens cotados' + (S.lidos.itens ? ' <span class="cs-chip" style="height:18px;font-size:10px;color:#5A3BC4">IA</span>' : '') + '</h5><div id="cot-itens">' + htmlItens() + '</div></div>' +
      '<div class="cot-sec cot-sec-larga"><h5>' + IC.pdf + 'Proposta para o comprador</h5><div id="cot-prop-box">' + htmlProposta() + '</div></div>' +
      '<div class="cot-sec cot-sec-larga"><h5>' + IC.note + 'Nota para o time (opcional)</h5>' +
        campo('', 'nota', { area: true, linhas: 3, ph: 'O que você combinou, o que está pendente, quem acompanha…' }) + '</div>' +
      '<div class="cot-acoes-pe"><button type="button" class="cs-btn" id="cot-voltar">' + IC.back + 'Recomeçar</button>' +
        '<div class="dir"><button type="button" class="cs-btn cs-btn-p" id="cot-criar"' + (S.configurado === false ? ' disabled title="Armazenamento não configurado"' : '') + '>' + rotuloCriar() + '</button></div></div>' +
      '<div class="cot-msg" id="cot-msg"></div>';
  }

  /* ── 4 · pronto ─────────────────────────────────────────────── */
  function htmlEnvio() {
    var c = S.criado || {}, e = S.envio;
    if (c.fase === 'vencida') return '';
    if (!P) return '';
    if (e && e.estado === 'enviando') return '<div class="cot-envio">' + '<span class="cs-spin"></span><div><b>Enviando a proposta para ' + esc(e.para) + '…</b>Gerando o PDF no modelo da Biomedical e mandando pelo seu Outlook.</div></div>';
    if (e && e.estado === 'ok') return '<div class="cot-envio ok">' + IC.checkc + '<div><b>Proposta enviada para ' + esc(e.para) + '</b>' + esc(e.msg || 'O PDF ficou no caso e o envio está no histórico.') + '</div>' +
      '<button type="button" class="cs-btn cs-btn-sm" id="cot-prop-ver2">' + IC.eye + 'Ver a proposta</button></div>';
    var erro = e && e.estado === 'erro';
    return '<div class="cot-envio' + (erro ? ' erro' : '') + '">' + (erro ? IC.alert : IC.pdf) + '<div><b>' + (erro ? 'A proposta não foi enviada' : 'A proposta está pronta') + '</b>' +
      (erro ? esc(e.msg) : 'No modelo da Biomedical, com os dados da cotação e os seus. Confira e mande para o comprador.') + '</div>' +
      '<div class="cot-envio-bts"><input id="cot-prop-para2" value="' + esc(S.prop.para) + '" placeholder="e-mail do comprador" autocomplete="off">' +
      '<button type="button" class="cs-btn cs-btn-sm" id="cot-prop-ver2">' + IC.eye + 'Ver</button>' +
      '<button type="button" class="cs-btn cs-btn-sm cs-btn-p" id="cot-prop-mandar">' + IC.arrow + (erro ? 'Tentar de novo' : 'Enviar proposta') + '</button></div></div>';
  }
  function htmlPronto() {
    var c = S.criado || {}, venc = c.fase === 'vencida';
    return '<div class="cot-pronto' + (venc ? ' vencida' : '') + '"><span class="ic">' + (venc ? C.svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/>', 34) : C.svg('<polyline points="20 6 9 17 4 12"/>', 34)) + '</span>' +
      '<h3>' + (venc ? 'Cotação registrada como vencida' : 'Cotação registrada') + '</h3><span class="num">' + esc(c.numero) + '</span>' +
      '<p>' + esc(C.tituloCaso(c)) + (c.cliente && c.cliente.nome ? ' · ' + esc(c.cliente.nome) : '') + ' · ' + esc(C.fase(c.fase).nome) +
        (c.total ? ' · ' + C.brl(c.total) : '') + (c.itens ? ' · ' + c.itens.length + ' item(ns)' : '') +
        (venc ? '. A validade já tinha passado (' + esc(C.diaBR(c.datas && c.datas.validade)) + ') — o caso saiu do funil sozinho.'
          : '. Acompanhe no caso — quando o portal gerar o pedido, anexe o PDF dele lá e mande para o PI.') + '</p>' +
      '<div id="cot-envio-box">' + htmlEnvio() + '</div>' +
      '<div class="bts"><a class="cs-btn cs-btn-p" href="comercial-cot-casos.html?caso=' + encodeURIComponent(c.numero || '') + '">' + IC.arrow + 'Abrir o caso</a>' +
        '<button type="button" class="cs-btn" id="cot-outra">' + IC.plus + 'Registrar outra cotação</button></div></div>';
  }
  function pintarEnvio() { var b = $('cot-envio-box'); if (b) b.innerHTML = htmlEnvio(); }

  // a proposta do caso criado: gera, manda pelo Outlook e registra no caso
  function enviarProposta(caso) {
    var para = P.listaEmails(S.prop.para);
    if (!para.length) { S.envio = { estado: 'erro', msg: 'Informe o e-mail do comprador.' }; pintarEnvio(); return Promise.resolve(); }
    S.envio = { estado: 'enviando', para: para.join(', ') };
    pintarEnvio();
    return P.enviar(caso, operador(), { para: para, copia: S.prop.copia }).then(function (r) {
      if (r.caso) S.criado = r.caso;
      S.envio = { estado: 'ok', para: para.join(', '), msg: r.erroRegistro ? 'O e-mail saiu, mas não consegui registrar no caso (' + r.erroRegistro + ') — anote no caso.' : '' };
      pintarEnvio();
      C.toast('Proposta enviada', para.join(', '), 'ok');
    }).catch(function (e) {
      S.envio = { estado: 'erro', msg: e.message || String(e) };
      pintarEnvio();
    });
  }
  // a prévia do PDF (antes de criar, o número do caso ainda não existe)
  function verProposta(caso) {
    if (!P) return;
    var janela = window.open('', '_blank');
    if (janela) { try { janela.document.title = 'Proposta'; janela.document.body.innerHTML = '<p style="font:15px system-ui;padding:40px;color:#0F2831">Gerando a proposta…</p>'; } catch (e) {} }
    P.gerar(caso, operador()).then(function (pdf) {
      var url = URL.createObjectURL(pdf.blob);
      if (janela && !janela.closed) janela.location.href = url; else window.open(url, '_blank');
      setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
    }).catch(function (e) {
      if (janela && !janela.closed) janela.close();
      C.toast('Não consegui gerar a proposta', e.message, 'erro');
    });
  }
  function casoDaTela() {
    var d = JSON.parse(JSON.stringify(S.dados));
    d.itens = d.itens.filter(function (it) { return it.descricao || it.codigo || it.codigoCliente; });
    d.total = totalItens(d.itens) || d.totalPdf || 0;
    // o código como está no cadastro (maiúsculas, sem espaço invisível)
    d.itens.forEach(function (it) { if (it.codigo) it.codigo = C.normCod(it.codigo); delete it._cod; });
    // a validade em dias (vencimento − data da cotação) fica registrada no caso
    var n = diasDeValidade(d); if (n != null) d.condicoes.validade = textoDias(n);
    delete d.vencimentoOrigem;
    return d;
  }

  /* ── render e eventos ───────────────────────────────────────── */
  function render() {
    pintarPassos();
    var el = $('cot-corpo');
    if (S.erroBoot) { el.innerHTML = '<div class="cs-vazio"><div class="ic">' + C.svg('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', 30) + '</div><h3>Sem acesso</h3>' + esc(S.erroBoot) + '</div>'; return; }
    el.innerHTML = S.passo === 'pdf' ? htmlPdf() : S.passo === 'lendo' ? htmlLendo() : S.passo === 'conf' ? htmlConf() : htmlPronto();
    C.quieto(el);
    if (S.passo === 'conf') { montarVisor(); marcarInvalidos(); }
  }
  function msg(html, tipo) {
    var m = $('cot-msg'); if (!m) return;
    m.className = 'cot-msg' + (html ? ' on' : '') + (tipo ? ' ' + tipo : '');
    m.innerHTML = html || '';
  }
  function recomecar() {
    if (S.url) URL.revokeObjectURL(S.url);
    S.passo = 'pdf'; S.arq = null; S.url = ''; S.texto = ''; S.leitura = null; S.dados = null; S.lidos = {}; S.dup = null; S.forcar = false;
    S.criado = null; S.erroIA = ''; S.envio = null; S.codErro = ''; S.criarSemConferir = false; S.erp = null;
    S.prop.enviar = true; S.prop.para = ''; S.prop.copia = '';
    render();
  }
  function atualizarTotal() {
    var t = $('cot-total'); if (t) t.textContent = C.brl(totalItens(S.dados.itens));
  }

  function criar() {
    if (S.criando) return;
    // CNPJ, CEP, telefone, e-mails, datas e quantidades — antes de ir ao BI
    if (!S.codConferido && !validarTudo()) return;
    // o Cód. Biomedical de todo item cotado tem de ser um produto nosso
    if (!S.codConferido) {
      var bc = $('cot-criar'); if (bc) { bc.disabled = true; bc.innerHTML = '<span class="cs-spin"></span> Conferindo os códigos…'; }
      C.conferirItens(S.dados.itens, false).then(function () {
        S.codErro = '';
        var ruins = C.itensComCodigoRuim(S.dados.itens);
        if (bc) { bc.disabled = false; bc.innerHTML = rotuloCriar(); }
        pintarItens();
        if (ruins.length) {
          msg('<b>' + ruins.length + ' item(ns) sem código de produto Biomedical</b>: ' + ruins.slice(0, 5).map(function (it) { return esc(it.codigo || '(sem código)') + ' — ' + esc((it.descricao || '').slice(0, 40)); }).join('; ') + '. Corrija o Cód. Biomedical (linhas em vermelho).', 'erro');
          var tb = $('cot-itens'); if (tb) tb.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        S.codConferido = true; criar(); S.codConferido = false;
      }).catch(function (e) {
        if (bc) { bc.disabled = false; bc.innerHTML = rotuloCriar(); }
        S.codErro = e.message || String(e); pintarItens();
        // BI fora do ar: o 2º clique cria sem a conferência (como o estoque do PI)
        if (S.criarSemConferir) { S.criarSemConferir = false; S.codConferido = true; criar(); S.codConferido = false; return; }
        S.criarSemConferir = true;
        msg('Não consegui conferir os códigos no BI (' + esc(S.codErro) + '). Tente "Conferir de novo" — ou clique em criar outra vez para registrar sem a conferência.', 'alerta');
      });
      return;
    }
    var d = casoDaTela();
    if (!d.cliente.nome && !d.cotacaoId && !d.itens.length) { msg('Informe ao menos o cliente, o número da cotação ou um item.', 'erro'); return; }
    if (d.contato.email && !emailOk(d.contato.email)) { msg('O e-mail do comprador não parece válido.', 'erro'); return; }
    if (S.dup && !S.forcar) { msg('Esta cotação já tem caso (' + esc(S.dup.numero) + '). Abra o caso — ou marque "Registrar mesmo assim".', 'alerta'); var dp = $('cot-dup'); if (dp) dp.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    var enviar = podeEnviar();
    if (P && S.prop.enviar && !C.venceu(d.datas.validade) && !enviar) { msg('Para enviar a proposta, informe o e-mail do comprador (em "Proposta para o comprador") — ou desmarque o envio.', 'erro'); var pp = $('cot-prop-para'); if (pp) pp.focus(); return; }
    var nota = d.nota; delete d.nota; delete d.validadeCalculada;
    S.criando = true; S.envio = null;
    var b = $('cot-criar'); if (b) { b.disabled = true; b.innerHTML = '<span class="cs-spin"></span> ' + (enviar ? 'Autorizando o envio pelo Outlook…' : 'Criando o caso…'); }
    msg('');
    // o token de e-mail sai AGORA, ainda no clique (o popup de consentimento
    // da primeira vez não pode esperar o servidor criar o caso)
    var autorizado = enviar ? P.autorizar().then(function () { return true; }, function (e) { return e; }) : Promise.resolve(false);
    autorizado.then(function (aut) {
      if (enviar && aut !== true) {
        S.envio = { estado: 'erro', msg: 'Não deu para autorizar o envio pelo seu Outlook (' + ((aut && aut.message) || 'sem permissão') + '). O caso foi criado — envie a proposta por aqui depois.' };
      }
      if (b) b.innerHTML = '<span class="cs-spin"></span> Criando o caso…';
      return C.api('cot-casos', {
        acao: 'novo', fase: 'cotada', forcar: !!(S.dup && S.forcar), dados: d, nota: nota,
        anexo: S.arq ? { nome: S.arq.nome, tipo: 'application/pdf', base64: S.arq.base64 } : null,
        leitura: S.leitura ? { ia: !!S.leitura.ia, modelo: S.leitura.modelo || '', avisos: (S.leitura.avisos || []).map(function (a) { return { tipo: a.tipo, texto: a.texto }; }), erro: S.leitura.erro || '' } : null
      }).then(function (j) { return { j: j, aut: aut }; });
    }).then(function (r) {
      var j = r.j;
      S.criando = false;
      if (!j || !j.caso) {
        if (b) { b.disabled = false; b.innerHTML = rotuloCriar(); }
        msg('O armazenamento das Cotações não está configurado — o caso não foi gravado. Avise o dono do portal (COT_BLOB_URL).', 'erro');
        return;
      }
      S.criado = j.caso; S.passo = 'pronto';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // o fluxo da proposta: caso criado e Cotada -> o PDF sai para o comprador
      if (enviar && r.aut === true && j.caso.fase !== 'vencida') enviarProposta(j.caso);
    }).catch(function (e) {
      S.criando = false;
      if (b) { b.disabled = false; b.innerHTML = rotuloCriar(); }
      if (e.status === 409 && e.corpo && e.corpo.duplicado) {
        S.dup = { numero: e.corpo.duplicado, fase: 'cotada', portal: d.portal, cotacaoId: d.cotacaoId };
        checarDupAgora().then(pintarDup);
        pintarDup();
        msg(esc(e.message), 'alerta');
        return;
      }
      msg('Não consegui criar o caso: ' + esc(e.message), 'erro');
    });
  }

  function ligar() {
    var corpo = $('cot-corpo');
    corpo.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.id === 'cot-arquivo') { receberArquivo(t.files && t.files[0]); t.value = ''; return; }
      if (t.id === 'cot-forcar') { S.forcar = t.checked; msg(''); return; }
      if (t.id === 'cot-prop-enviar') { S.prop.enviar = t.checked; msg(''); pintarValidade(); return; }
      if (t.matches('select[data-k], input[type=date][data-k], input[type=datetime-local][data-k]')) {
        por(S.dados, t.getAttribute('data-k'), t.value);
        var kk = t.getAttribute('data-k');
        if (kk === 'datas.cotacao') { recalcularVencimento(); pintarValidade(); }
        if (kk === 'datas.validade') { S.dados.vencimentoOrigem = 'manual'; pintarValidade(); }
      }
    });
    corpo.addEventListener('input', function (ev) {
      var t = ev.target;
      var mk = t.getAttribute && t.getAttribute('data-mask');
      if (mk) {
        C.mascarar(t, mk);
        // digitando, o erro só some quando o valor fica certo (aparece ao sair do campo)
        var wv = t.closest('.cs-campo');
        if (wv && wv.classList.contains('invalido') && !erroDe(t)) erroNoCampo(t, '');
      }
      if (t.matches('[data-k]')) {
        var k = t.getAttribute('data-k');
        var antes = pegar(S.dados, k);
        por(S.dados, k, k === 'cliente.uf' ? t.value.toUpperCase() : t.value);
        var wrap = t.closest('.cs-campo');
        if (wrap && wrap.classList.contains('falta') && t.value) wrap.classList.remove('falta');
        if (k === 'portal' || k === 'cotacaoId') checarDup();
        if (k === 'cliente.cnpj') buscarErpDepois();
        // CEP completo e UF vazia: a UF sai do CEP
        if (k === 'cliente.cep' && !S.dados.cliente.uf && C.ufDoCep(t.value)) {
          S.dados.cliente.uf = C.ufDoCep(t.value);
          var su = D.querySelector('[data-k="cliente.uf"]'); if (su) su.value = S.dados.cliente.uf;
        }
        if (k === 'cliente.cep' || k === 'cliente.uf') pintarAvisoCep();
        if (k === 'datas.cotacao') { recalcularVencimento(); pintarValidade(); }
        if (k === 'datas.validade') { S.dados.vencimentoOrigem = 'manual'; pintarValidade(); }
        // o e-mail do comprador é o destino da proposta (enquanto a pessoa não trocar lá)
        if (k === 'contato.email' && (!S.prop.para || S.prop.para === antes)) {
          S.prop.para = t.value; var pp = $('cot-prop-para'); if (pp) pp.value = t.value;
          var cr = $('cot-criar'); if (cr && !S.criando) cr.innerHTML = rotuloCriar();
        }
        return;
      }
      if (t.id === 'cot-prop-para' || t.id === 'cot-prop-para2') {
        S.prop.para = t.value;
        var w = t.closest('.cs-campo'); if (w) w.classList.remove('falta');
        var cb = $('cot-criar'); if (cb && !S.criando) cb.innerHTML = rotuloCriar();
        return;
      }
      if (t.id === 'cot-prop-copia') { S.prop.copia = t.value; return; }
      if (t.id === 'cot-prop-tel') { S.prop.telefone = t.value; C.gravarLocal('cot-prop-tel', t.value.trim()); return; }
      if (t.matches('[data-f]')) {
        var tr = t.closest('tr'), i = Number(tr.getAttribute('data-i')), f = t.getAttribute('data-f');
        var it = S.dados.itens[i]; if (!it) return;
        it[f] = (f === 'quantidade' || f === 'valorUnitario') ? C.num(t.value) : t.value;
        if (f === 'codigo') { it._cod = null; conferirLinha(i); }
        if (f === 'quantidade' || f === 'valorUnitario') {
          var cel = corpo.querySelector('[data-tot="' + i + '"]');
          if (cel) cel.textContent = it.quantidade && it.valorUnitario ? C.brl(it.quantidade * it.valorUnitario) : '—';
          atualizarTotal();
          tr.classList.toggle('qtd-falta', Number(it.valorUnitario) > 0 && !(Number(it.quantidade) > 0));
        }
        tr.classList.remove('aviso');
      }
    });
    // ao sair do campo: a máscara final (telefone sem o 0/+55) e o erro, se houver
    corpo.addEventListener('focusout', function (ev) {
      var t = ev.target;
      if (!t.matches || !t.matches('[data-mask], [data-k="datas.validade"]')) return;
      var mk = t.getAttribute('data-mask');
      if (mk && mk !== 'num' && mk !== 'digitos' && mk !== 'emails') {
        var f = C.formatar(mk, t.value);
        if (f !== t.value) { t.value = f; t.dispatchEvent(new Event('input', { bubbles: true })); }
      }
      conferirCampo(t);
    });
    corpo.addEventListener('click', function (ev) {
      var t = ev.target.closest('button, a'); if (!t) return;
      if (t.hasAttribute('data-pdf')) { acaoPdf(t.getAttribute('data-pdf')); return; }
      if (t.id === 'cot-manual') { S.dados = vazio(); S.leitura = null; S.lidos = {}; S.erp = null; S.passo = 'conf'; render(); return; }
      if (t.id === 'cot-erp-de-novo') { buscarErp(); return; }
      if (t.id === 'cot-prop-ver') { var prev = casoDaTela(); prev.numero = ''; verProposta(prev); return; }
      if (t.id === 'cot-prop-ver2') { verProposta(S.criado); return; }
      if (t.id === 'cot-prop-mandar') {
        if (!P.listaEmails(S.prop.para).length) { S.envio = { estado: 'erro', msg: 'Informe o e-mail do comprador.' }; pintarEnvio(); return; }
        t.disabled = true;
        // o token no clique (consentimento da primeira vez), depois o envio
        P.autorizar().then(function () { return enviarProposta(S.criado); }, function (e) {
          S.envio = { estado: 'erro', msg: 'Não deu para autorizar o envio pelo seu Outlook: ' + (e.message || e) }; pintarEnvio();
        });
        return;
      }
      if (t.id === 'cot-voltar') {
        C.dialogo('<h3>Recomeçar?</h3><p>O que foi lido e editado aqui se perde (nada foi gravado ainda).</p><div class="cs-dlg-pe"><button class="cs-btn" value="x">Continuar aqui</button><button class="cs-btn cs-btn-p" value="ok" id="dlg-ok">Recomeçar</button></div>',
          function () { $('dlg-ok').addEventListener('click', function () { C.fecharDialogo(); recomecar(); }); });
        return;
      }
      if (t.id === 'cot-criar') { criar(); return; }
      if (t.id === 'cot-cod-reconferir') { conferirCodigos(true); return; }
      if (t.id === 'cot-outra') { recomecar(); return; }
      if (t.id === 'cot-add-item') {
        S.dados.itens.push({ codigo: '', codigoCliente: '', descricao: '', marca: '', registro: '', unidade: '', quantidade: 0, valorUnitario: 0 });
        $('cot-itens').innerHTML = htmlItens();
        var ins = $('cot-itens').querySelectorAll('tbody tr:last-child input[data-f="descricao"]'); if (ins[0]) ins[0].focus();
        return;
      }
      if (t.hasAttribute('data-tirar')) {
        S.dados.itens.splice(Number(t.getAttribute('data-tirar')), 1);
        if (S.leitura) S.leitura.avisos = (S.leitura.avisos || []).filter(function (a) { return a.item < 0; });
        $('cot-itens').innerHTML = htmlItens();
        return;
      }
      if (t.id === 'cot-reler') {
        t.disabled = true; t.innerHTML = '<span class="cs-spin"></span> Lendo…';
        lerIA().then(checarDupAgora).then(function () { render(); conferirCodigos(true); });
      }
    });
    // arrastar e soltar o PDF
    corpo.addEventListener('dragover', function (ev) { var d = ev.target.closest && ev.target.closest('#cot-drop'); if (d) { ev.preventDefault(); d.classList.add('drag'); } });
    corpo.addEventListener('dragleave', function (ev) { var d = ev.target.closest && ev.target.closest('#cot-drop'); if (d) d.classList.remove('drag'); });
    corpo.addEventListener('drop', function (ev) {
      var d = ev.target.closest && ev.target.closest('#cot-drop'); if (!d) return;
      ev.preventDefault(); d.classList.remove('drag');
      receberArquivo(ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]);
    });
    corpo.addEventListener('keydown', function (ev) {
      if (ev.target.id === 'cot-drop' && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); $('cot-arquivo').click(); }
    });
    // o visor do PDF: o menu fecha clicando fora / Esc; ajustado à largura acompanha a janela e a tela cheia
    D.addEventListener('click', function (ev) { var m = $('cot-pdf-menu'); if (m && !m.hidden && !(ev.target.closest && ev.target.closest('.cot-pdf-mais'))) menuPdf(false); });
    D.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') menuPdf(false); });
    window.addEventListener('resize', C.debounce(function () { if (S.passo === 'conf' && !V.zoom && V.doc) desenharPdf(); }, 200));
    D.addEventListener('fullscreenchange', function () { if (S.passo === 'conf' && V.doc) { V.zoom = 0; setTimeout(desenharPdf, 60); } });
    // o PDF solto em qualquer lugar da tela, no passo 1
    D.addEventListener('dragover', function (ev) { if (S.passo === 'pdf') ev.preventDefault(); });
    D.addEventListener('drop', function (ev) {
      if (S.passo !== 'pdf' || (ev.target.closest && ev.target.closest('#cot-drop'))) return;
      ev.preventDefault();
      receberArquivo(ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]);
    });
  }

  function iniciar() {
    if (!$('cot-corpo')) return;
    ligar();
    render();
    C.aguardarLogin().then(function () { return C.api('cot-casos'); }).then(function (j) {
      S.cfg = j.cfg || {}; S.eu = j.eu || null; S.configurado = j.configurado !== false;
      if (S.dados && !S.dados.area && S.eu && S.eu.area) S.dados.area = S.eu.area;
      if (P) P.preCarregar();
      if (P && !P.pronto()) faixa('<b>O gerador da proposta (jsPDF) não carregou.</b> Recarregue a página — sem ele o caso é criado, mas a proposta não sai.', 'alerta');
      if (S.cfg.fases) C.FASES.forEach(function (f) { var s = S.cfg.fases.filter(function (x) { return x.id === f.id; })[0]; if (s) { f.nome = s.nome; f.desc = s.desc || f.desc; } });
      if (!S.configurado) faixa('<b>Armazenamento não configurado.</b> A leitura funciona, mas o caso só é gravado depois que o dono do portal configurar o COT_BLOB_URL.', 'alerta');
      if (!C.leitorPronto()) faixa('<b>O leitor de PDF não carregou.</b> Recarregue a página — sem ele, dá para registrar a cotação à mão.', 'alerta');
      render();
    }).catch(function (e) {
      if (e.status === 401 || e.status === 403) { S.erroBoot = e.message; render(); return; }
      faixa('<b>Não consegui falar com o servidor.</b> ' + esc(e.message) + ' — a leitura funciona, tente criar o caso em instantes.', 'erro');
    });
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
