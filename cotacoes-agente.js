/* ================================================================
   cotacoes-agente.js — AGENTE DE COTAÇÕES (pages/comercial-cot-nova.html)

   25/11/2026 (pedido do usuário): SEM PDF — a oportunidade é registrada
   sempre à mão. Saíram o anexo do PDF do portal, a leitura pela IA e o
   visor do PDF; a tela já abre no formulário (o antigo "Preencher à mão"):
   uma ordem nova, sem portal e sem nº da cotação.

   25/11/2026 (pedido do usuário): sem o "Cliente novo" no Comprador (só
   pelo CNPJ ou pelo código do cliente) e, à direita do formulário, a PRÉVIA
   da proposta em PDF — refeita a cada campo preenchido (cotacoes-proposta.js
   gera, o pdf.js desenha as páginas).

     1 · Oportunidade  o formulário: comprador, condições, itens e proposta
     2 · Caso          /api/cot-casos {acao:'novo'} abre o caso
                       (COT-AAAA-NNNNNN) na Gestão de Cotações — e a PROPOSTA
                       no modelo da MSB (cotacoes-proposta.js) sai por
                       e-mail para o comprador, se a pessoa deixou marcado

   Regras de 09/10/2026: a cotação nasce SEMPRE Cotada; empresa sempre BIO;
   a UNIDADE DE NEGÓCIO (20/10/2026) é a do RLS de quem registra no Power BI
   — uma só: automática; 2+: escolhe entre as suas; nenhuma confirmada: não
   registra (o servidor confere de novo); não existe
   prazo do portal — a validade é a data da cotação + os dias de validade.
   Com ela já passada o caso nasce Cotada do mesmo jeito (20/10/2026:
   sem trava de vencida — a data é só um aviso) e a proposta pode sair.
   ================================================================ */
(function () {
  'use strict';
  var C = window.COT; if (!C) return;
  var P = window.COTPROP || null;
  var D = document, $ = C.$, esc = C.esc, IC = C.IC;

  var S = {
    passo: 'conf', cfg: null, eu: null, configurado: null, erroBoot: '',
    // texto/leitura/lidos ficam vazios (sem PDF, nada é lido pela IA)
    texto: '', leitura: null, dados: null, lidos: {},
    dup: null, forcar: false, criado: null, criando: false,
    transp: null,   // 25/11/2026: as transportadoras do PI ({ nomes, erro } — C.transportadoras)
    // o comprador: 'cnpj' | 'codigo' (o Dynamics preenche o cadastro) — sem o 'manual' (cliente novo) desde 25/11/2026
    modoCli: 'cnpj',
    // à mão (sem PDF): uma ordem nova, sem portal e sem nº da cotação — sempre, desde 25/11/2026
    semPortal: true,
    // a proposta: enviar ao criar? para quem? (o telefone fica guardado no navegador).
    // 21/10/2026 (pedido do usuário): o envio começa DESMARCADO
    prop: { enviar: false, para: '', copia: '', telefone: C.lerLocal('cot-prop-tel'), anexos: [] },
    envio: null,  // { estado: 'enviando'|'ok'|'erro', msg, para }
    // 29/10/2026 (pedido do usuário): o "Tem IPI?" — a coluna do IPI de cada item
    ipi: false
  };

  function vazio() {
    return { portal: '', cotacaoId: '', empresa: 'MSB', area: (S.eu && S.eu.area) || '', unidade: unidadeUnica(),
      cliente: { nome: '', cnpj: '', codigo: '', cidade: '', uf: '', endereco: '', cep: '' }, contato: { nome: '', email: '', telefone: '' },
      datas: { cotacao: '', validade: '' }, validadeCalculada: 0, vencimentoOrigem: '',
      condicoes: { pagamento: '', entrega: '', frete: '', validade: '', medico: '', observacao: '', transportadora: '', obsNota: '', condEntrega: '' },
      itens: [], totalPdf: 0, nota: '' };
  }
  // a unidade de negócio de quem registra, quando ela só tem uma (2+: escolhe)
  // (04/11/2026) no submódulo do CRM — Venda Recorrente ou BIO.ID — quem tem
  // 2+ unidades já vem com a do submódulo escolhida (o servidor confere)
  function unidadeUnica() {
    var us = (S.eu && S.eu.unidadeConfirmada && S.eu.unidades) || [];
    if (us.length === 1) return us[0];
    var M = window.BMCRM, sub = M && M.atual();
    return (sub && us.filter(function (u) { var d = M.daUnidade(u); return d && d.id === sub; })[0]) || '';
  }
  // a unidade da cotação: a do RLS da pessoa no Power BI (o servidor confere de novo)
  function htmlUnidade(d) {
    var eu = S.eu, us = (eu && eu.unidades) || [];
    var caixa = function (val, dica, falta) {
      return '<div class="cs-campo s2' + (falta ? ' falta' : '') + '" id="cot-unid"><label>Unidade de negócio</label><div class="cot-calc">' + val + '</div><small>' + dica + '</small></div>';
    };
    if (!eu) return caixa('…', 'confirmando no Power BI');
    if (!eu.unidadeConfirmada) return caixa('não confirmada', esc(eu.unidadeMotivo || 'o Power BI não respondeu') + ' — sem ela a oportunidade não é registrada · <a href="#" id="cot-pbi-conectar">conectar ao Power BI</a>', true);
    if (!us.length) return caixa('nenhuma', 'o Power BI não mostra unidade de negócio para você no Comercial — sem ela a oportunidade não é registrada', true);
    if (us.length === 1) return caixa(esc(us[0]), 'sempre MSB');   // RECORTE MSB: unidade fixa (o servidor manda)
    return campo('Unidade de negócio', 'unidade', { cls: 's2', lista: us, obrig: true, id: 'cot-unid', dica: 'você tem ' + us.length + ' unidades no Power BI — escolha a desta oportunidade' });
  }
  // o acesso ao Power BI pedido no clique (o popup pode abrir) e as unidades de novo
  function conectarPbi() {
    var p = window.VOZPBI && window.VOZPBI.connect ? window.VOZPBI.connect() : Promise.resolve();
    Promise.resolve(p).catch(function () {}).then(function () { C.esquecerTokenPbi(); return C.api('cot-casos'); }).then(function (j) {
      S.eu = j.eu || S.eu;
      if (S.dados && !S.dados.unidade) S.dados.unidade = unidadeUnica();
      render();
    }).catch(function (e) { msg('Não consegui falar com o Power BI: ' + esc(e.message || e), 'erro'); });
  }
  // A DATA DE VENCIMENTO (datas.validade): a data da cotação + os dias de
  // validade. Só a calculada acompanha a troca da data da cotação; a digitada
  // pela pessoa fica como está.
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
  var PASSOS = [['conf', 'Oportunidade'], ['pronto', 'Caso']];
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
      if (n) C.toast('Código do produto corrigido', n + ' item(ns): o código não era nosso — usei o nosso que está na descrição.', '');
      completarSf(d.itens);
    }).catch(function (e) {
      S.codErro = e.message || String(e);
      d.itens.forEach(function (it) { if (it._cod && it._cod.st === 'checando') it._cod = null; });
      pintarItens();
    });
  }
  function pintarItens() { var b = $('cot-itens'); if (b && S.passo === 'conf') { b.innerHTML = htmlItens(); referencias(); estoqueDepois(); previaDepois(); } }
  // o ESTOQUE DA VENDA (05/11/2026, RECORTE MSB — pedido do dono): ao digitar o
  // código (ou a quantidade), o estoque do PI · Pedido da MSB embaixo dos itens
  var estoqueDepois = C.debounce(function () { if (S.passo === 'conf' && S.dados) C.pintarEstoque($('cot-estoque'), S.dados.itens); }, 450);

  /* ── as referências de preço do item (23/10/2026) ───────────── */
  // Pedidos do usuário: na hora de digitar o preço, (1) a MÉDIA dos últimos 6
  // meses do faturamento daquele item naquele cliente (COT.faturamentoDoCliente)
  // e (2) o preço da TABELA DE PREÇOS — Venda Direta e Venda Futura (COT.
  // tabelaDePrecos) —, os dois do Power BI do Comercial com o token da pessoa;
  // e (3) um ALERTA quando o preço passa de qualquer um deles, para a pessoa ter
  // ciência (não impede: o "criar" avisa e o 2º clique cria). Aparecem na linha
  // embaixo do item; o item SEM preço (e com quantidade) já recebe a média —
  // marcada "usada", a pessoa confere —; "usar" põe a média ou o preço da tabela
  // no item. Sem o código do cliente, só a tabela (não há média).
  function textoFatDica() {
    return codigoCli() ? 'Embaixo de cada item: a média dos ' + C.MESES_FAT + ' meses de faturamento no cliente e a tabela de preço (Venda Direta e Venda Futura) — o preço acima delas fica em alerta'
      : 'Embaixo de cada item: a tabela de preço (Venda Direta e Venda Futura) — com o código do cliente, também a média dos ' + C.MESES_FAT + ' meses de faturamento';
  }
  // os itens com o preço acima de alguma referência: [{ i, it, acima }]
  function itensAcima() {
    return (S.dados ? S.dados.itens : []).map(function (it, i) { return { i: i, it: it, acima: C.acimaDasReferencias(it) }; }).filter(function (x) { return x.acima.length; });
  }
  function pintarRefs() {
    var cli = codigoCli();
    (S.dados ? S.dados.itens : []).forEach(function (it, i) {
      var tr = D.querySelector('#cot-itens tr[data-ref-i="' + i + '"]');
      if (tr) { tr.hidden = !it.codigo; var b = tr.querySelector('.cot-ref-box'); if (b) b.innerHTML = C.refsPreco(it, i, cli); }
      var row = D.querySelector('#cot-itens tr[data-i="' + i + '"]'); if (row) row.classList.toggle('preco-acima', C.acimaDasReferencias(it).length > 0);
    });
    var fx = $('cot-ref-faixa');
    if (fx) {
      var l = itensAcima();
      fx.innerHTML = !l.length ? '' : '<div class="cot-cod-faixa cot-ref-faixa">' + IC.alert + '<div><b>Preço acima da referência em ' + l.length + ' item(ns)</b>' +
        l.slice(0, 6).map(function (x) { return esc((x.it.codigo || 'item ' + (x.i + 1)) + ': ' + C.brl(x.it.valorUnitario) + ' acima ' + C.textoAcima(x.acima)); }).join(' · ') +
        (l.length > 6 ? ' · +' + (l.length - 6) : '') + '. Você está passando da média dos 6 meses ou da tabela de preço — confira antes de criar.</div></div>';
    }
    var dc = $('cot-fat-dica'); if (dc) dc.textContent = textoFatDica();
    previaDepois();
  }
  // põe no preço do item a média (k 'media') ou o preço lista da tabela ('vd' | 'vf')
  function usarRef(i, k, auto) {
    var it = S.dados && S.dados.itens[i]; if (!it) return;
    var v = k === 'media' ? it._fat && it._fat.v && it._fat.v.media : it._tab && it._tab.v && it._tab.v[k] && it._tab.v[k].lista;
    if (!(v > 0)) return;
    it.valorUnitario = v; delete it.precoZero;
    if (it._fat) it._fat.auto = !!auto && k === 'media';
    var tr = D.querySelector('#cot-itens tr[data-i="' + i + '"]');
    if (tr) {
      var inp = tr.querySelector('[data-f="valorUnitario"]'); if (inp) inp.value = it.valorUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
      var cel = tr.querySelector('[data-tot="' + i + '"]'); if (cel) cel.textContent = it.quantidade && it.valorUnitario ? C.brl(it.quantidade * it.valorUnitario) : '—';
      C.marcarQtdPreco(tr, it);
    }
    atualizarTotal();
  }
  var referencias = C.debounce(function () {
    var d = S.dados; if (!d || S.passo !== 'conf') return;
    var cli = codigoCli(), its = d.itens.filter(function (it) { return it.codigo; });
    d.itens.forEach(function (it) { if (!it.codigo) { it._fat = null; it._tab = null; } });
    if (!its.length) { pintarRefs(); return; }
    // a tabela de preços: só o código
    its.forEach(function (it) { var k = C.normCod(it.codigo); if (!it._tab || it._tab.cod !== k) it._tab = { st: 'buscando', cod: k }; });
    // a média: o código e o cliente
    if (!cli) its.forEach(function (it) { it._fat = null; });
    else its.forEach(function (it) { if (!it._fat || it._fat.cli !== cli || it._fat.cod !== C.normCod(it.codigo)) it._fat = { st: 'buscando', cli: cli, cod: C.normCod(it.codigo) }; });
    pintarRefs();
    C.tabelaDePrecos(its.map(function (it) { return it.codigo; })).then(function (r) {
      if (S.dados !== d) return;
      d.itens.forEach(function (it) {
        if (!it.codigo) return;
        var k = C.normCod(it.codigo), v = r[k];
        if (v === undefined) return;   // o código mudou enquanto isso: a próxima consulta pinta
        it._tab = v ? { st: 'ok', v: v, cod: k } : { st: 'nada', cod: k };
      });
      pintarRefs();
    }).catch(function (e) {
      its.forEach(function (it) { it._tab = { st: 'erro', erro: e.message || String(e), cod: C.normCod(it.codigo) }; });
      pintarRefs();
    });
    if (!cli) return;
    C.faturamentoDoCliente(cli, its.map(function (it) { return it.codigo; })).then(function (r) {
      if (codigoCli() !== cli || S.dados !== d) return;   // trocou o cliente (ou a cotação) enquanto isso
      var usadas = 0;
      d.itens.forEach(function (it, i) {
        if (!it.codigo) return;
        var k = C.normCod(it.codigo), v = r[k];
        if (v === undefined) return;
        var auto = !!(it._fat && it._fat.auto && it._fat.cod === k);
        it._fat = v ? { st: 'ok', v: v, cli: cli, cod: k, auto: auto } : { st: 'nada', cli: cli, cod: k };
        if (v && v.media > 0 && !C.temPreco(it) && Number(it.quantidade) > 0) { usarRef(i, 'media', true); usadas++; }   // o 0,00 digitado fica
      });
      pintarRefs();
      if (usadas) C.toast('Preço pela média de faturamento', usadas + ' item(ns) sem preço receberam a média dos últimos ' + C.MESES_FAT + ' meses deste cliente — confira.', '');
    }).catch(function (e) {
      its.forEach(function (it) { it._fat = { st: 'erro', erro: e.message || String(e), cli: cli, cod: C.normCod(it.codigo) }; });
      pintarRefs();
    });
  }, 450);
  // o produto no Salesforce (21/10/2026): o fabricante e o RMS do cadastro
  // entram no item e a descrição dele aparece como "Na proposta" — sem
  // redesenhar a tabela (o foco fica onde está)
  function pintarSf() {
    (S.dados ? S.dados.itens : []).forEach(function (it, i) {
      var tr = D.querySelector('#cot-itens tr[data-i="' + i + '"]'); if (!tr) return;
      ['marca', 'registro'].forEach(function (f) { var el = tr.querySelector('[data-f="' + f + '"]'); if (el && el !== D.activeElement && el.value !== (it[f] || '')) el.value = it[f] || ''; });
      var b = tr.querySelector('.cot-sf-box'); if (b) b.innerHTML = C.dicaSf(it);
    });
    previaDepois();
  }
  function completarSf(itens) { return C.completarDoSf(itens).then(function () { pintarSf(); }, function () { pintarSf(); }); }
  // um código digitado: confere só ele (sem redesenhar a tabela — o foco fica)
  var conferirLinha = C.debounce(function (i) {
    var it = S.dados && S.dados.itens[i]; if (!it) return;
    var linha = function () {
      var tr = D.querySelector('#cot-itens tr[data-i="' + i + '"]'); if (!tr) return;
      tr.classList.toggle('cod-nao', !!(it._cod && (it._cod.st === 'nao' || (it._cod.st === 'vazio' && C.temPreco(it)))));
      tr.classList.toggle('cod-ok', !!(it._cod && it._cod.st === 'ok'));
      var st = tr.querySelector('.cod-st-box'); if (st) st.innerHTML = C.statusCodigo(it);
      // RECORTE MSB: a descrição vazia ganhou o nome do cadastro na conferência
      var de = tr.querySelector('[data-f="descricao"]'); if (de && de !== D.activeElement && !de.value && it.descricao) de.value = it.descricao;
      pintarSf();
    };
    if (!it.codigo) { it._cod = { st: 'vazio' }; it._sf = null; it._fat = null; it._tab = null; linha(); pintarSf(); pintarRefs(); return; }
    it._cod = { st: 'checando' }; linha();
    C.conferirItens([it], false).then(linha).catch(function (e) { S.codErro = e.message || String(e); it._cod = null; linha(); });
    completarSf([it]);
    referencias();
  }, 500);

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
    if (d.outraUnidade) return '<div class="cot-dup">' + IC.copy + '<div><b>Esta oportunidade já foi registrada por outra unidade de negócio</b>Ela não aparece para você. Se for mesmo outra resposta, registre mesmo assim.</div>' +
      '<label class="cs-check" style="display:inline-flex;gap:7px;align-items:center;font-weight:700"><input type="checkbox" id="cot-forcar"' + (S.forcar ? ' checked' : '') + '> Registrar mesmo assim</label></div>';
    return '<div class="cot-dup">' + IC.copy + '<div><b>Esta oportunidade já está no portal: ' + esc(d.numero) + '</b>' +
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
  // 18/11/2026 (pedido do usuário): o "Não informado" do prazo de entrega — o
  // mesmo dos dados do paciente (cotacoes.js): o campo trava com NÃO INFORMADO
  var NAO_INF = 'NÃO INFORMADO';
  function naoInformado(v) { return C.norm(v).replace(/\s+/g, ' ').trim() === 'nao informado'; }
  function campo(rot, k, opt) {
    opt = opt || {};
    var v = opt.valor != null ? opt.valor : pegar(S.dados, k);
    if (opt.mask) v = C.formatar(opt.mask, v);
    // req (29/10/2026): obrigatório para criar — o asterisco, e marcado enquanto vazio
    var lido = S.lidos[k] ? ' lido' : '', falta = (opt.obrig || opt.req) && !v ? ' falta' : '';
    var ni = !!opt.ni && naoInformado(v);
    var input;
    if (opt.lista) {
      input = '<select data-k="' + k + '"><option value="">' + esc(opt.vazio || '—') + '</option>' + opt.lista.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    } else if (opt.area) {
      input = '<textarea data-k="' + k + '" rows="' + (opt.linhas || 2) + '" placeholder="' + esc(opt.ph || '') + '">' + esc(v) + '</textarea>';
    } else {
      input = '<input data-k="' + k + '" type="' + (opt.tipo || 'text') + '" value="' + esc(ni ? NAO_INF : opt.tipo === 'date' ? C.paraInput(v) : opt.tipo === 'datetime-local' ? C.paraInput(v, true) : v) + '"' + (ni ? ' readonly' : '') +
        (opt.lista2 ? ' list="' + opt.lista2 + '"' : '') + (opt.ph ? ' placeholder="' + esc(opt.ph) + '"' : '') + (opt.max ? ' maxlength="' + opt.max + '"' : '') + attrsMascara(opt.mask) + ' autocomplete="off">';
    }
    var rotulo = '<label>' + esc(rot) + (opt.req ? '<b class="cot-req" title="obrigatório">*</b>' : '') + (S.lidos[k] ? '<span class="ia">IA</span>' : '') + '</label>';
    if (opt.ni) {
      rotulo = '<div class="cot-ni-rot">' + rotulo + '<label class="cot-ni" title="Não veio no pedido — grava NÃO INFORMADO">' +
        '<input type="checkbox" data-ni="' + k + '"' + (ni ? ' checked' : '') + '>Não informado</label></div>';
    }
    return '<div class="cs-campo ' + (opt.cls || '') + lido + falta + (ni ? ' ni' : '') + '"' + (opt.id ? ' id="' + opt.id + '"' : '') + '>' + rotulo + input + (opt.depois || '') +
      (opt.mask || opt.erro ? '<small class="cot-erro-campo" role="alert"></small>' : '') + (opt.aviso ? '<small class="cot-aviso-campo"></small>' : '') +
      (opt.dica ? '<small>' + opt.dica + '</small>' : '') + '</div>';
  }
  var niGuardado = {};
  function marcarNi(cb, on) {
    var k = cb.getAttribute('data-ni'), cp = cb.closest('.cs-campo');
    var inp = cp && cp.querySelector('input[data-k="' + k + '"]'); if (!inp) return;
    cb.checked = on;
    if (on) {
      if (!naoInformado(inp.value)) niGuardado[k] = inp.value;
      inp.value = NAO_INF; inp.readOnly = true;
    } else {
      inp.readOnly = false; inp.value = niGuardado[k] || '';
    }
    por(S.dados, k, inp.value);
    cp.classList.toggle('ni', on);
    cp.classList.toggle('falta', !inp.value && !!cp.querySelector('.cot-req'));
    if (!on) inp.focus();
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
    if ((tipo === 'emails') && !(P && S.prop.enviar && S.dados)) return '';   // sem envio, a lista não importa
    return C.validar(tipo, el.value);
  }
  function conferirCampo(el) { var e = erroDe(el); erroNoCampo(el, e); return e; }
  // o aviso (não trava) de CEP de outro estado, embaixo do CEP
  function pintarAvisoCep() {
    var cep = D.querySelector('[data-k="cliente.cep"]'); if (!cep || !S.dados) return;
    var s = cep.closest('.cs-campo').querySelector('.cot-aviso-campo');
    if (s) s.textContent = C.avisoCepUf(S.dados.cliente.cep, S.dados.cliente.uf);
  }
  // os itens: quantidade E preço obrigatórios em cada item (25/11/2026, pedido do dono)
  function pintarQtd() {
    var its = (S.dados && S.dados.itens) || [];
    D.querySelectorAll('#cot-itens tr[data-i]').forEach(function (tr) { C.marcarQtdPreco(tr, its[Number(tr.getAttribute('data-i'))]); });
    return C.itensSemQtdPreco(its);
  }
  // o que veio preenchido (IA, Dynamics, telefone guardado) já aparece conferido
  function marcarInvalidos() {
    D.querySelectorAll('#cot-corpo [data-mask], #cot-corpo [data-k="datas.validade"]').forEach(function (el) { if (el.value) conferirCampo(el); });
    pintarAvisoCep();
  }
  // 29/10/2026 (pedido do usuário): o que é obrigatório para criar — a data da
  // cotação e a de vencimento; o comprador (o CNPJ ou o código do cliente; o
  // cliente novo, a razão social); a condição de pagamento, o frete e o prazo de
  // entrega; e ao menos 1 item cotado (com quantidade e preço). [rótulo, campo]
  // 25/11/2026: sem o "Cliente novo", o CNPJ ou o código do cliente sempre
  function faltamObrigatorios() {
    var d = S.dados || {}, cli = d.cliente || {}, co = d.condicoes || {}, dt = d.datas || {}, f = [];
    var el = function (k) { return D.querySelector('#cot-corpo [data-k="' + k + '"]'); };
    var tem = function (v) { return !!String(v == null ? '' : v).trim(); };
    if (!tem(dt.cotacao)) f.push(['Data da cotação', el('datas.cotacao')]);
    if (!tem(dt.validade)) f.push(['Data de vencimento', el('datas.validade')]);
    var temId = String(cli.cnpj || '').replace(/\D/g, '').length >= 11 || tem(cli.codigo);
    if (!temId) f.push(['o CNPJ ou o código do cliente', el(S.modoCli === 'codigo' ? 'cliente.codigo' : 'cliente.cnpj')]);
    // 25/11/2026: da lista do PI (a antiga, digitada, não passa)
    if (!tem(co.pagamento) || (C.COND_PAGAMENTO.length && !C.naListaPag(co.pagamento))) f.push(['Condição de pagamento (da lista do PI)', el('condicoes.pagamento')]);
    if (!tem(co.frete) || (C.FRETES.length && !C.naListaFrete(co.frete))) f.push(['Frete (da lista do PI)', el('condicoes.frete')]);
    if (!tem(co.condEntrega) || (C.COND_ENTREGA.length && !C.naListaEntrega(co.condEntrega))) f.push(['Condição de entrega (da lista do PI)', el('condicoes.condEntrega')]);
    if (!tem(co.entrega)) f.push(['Prazo de entrega', el('condicoes.entrega')]);
    var cotados = (d.itens || []).filter(function (it) { return (tem(it.descricao) || tem(it.codigo)) && Number(it.quantidade) > 0 && C.temPreco(it); });
    if (!cotados.length) f.push(['ao menos 1 item cotado (com quantidade e preço)', D.querySelector('#cot-itens input[data-f="valorUnitario"]') || $('cot-add-item')]);
    return f;
  }
  // tudo, antes de criar: devolve os rótulos dos campos errados
  function validarTudo() {
    var ruins = [], faltam = faltamObrigatorios();
    faltam.forEach(function (x) { var w = x[1] && x[1].closest && x[1].closest('.cs-campo'); if (w) w.classList.add('falta'); });
    D.querySelectorAll('#cot-corpo [data-mask], #cot-corpo [data-k="datas.validade"]').forEach(function (el) {
      var e = conferirCampo(el);
      // o erro já diz o campo ("CNPJ inválido…"); só a lista de e-mails da proposta leva o rótulo (Para/Cópia)
      var lb = tipoDe(el) === 'emails' && el.closest('.cs-campo').querySelector('label');
      if (e) ruins.push({ el: el, nome: lb ? lb.childNodes[0].textContent.trim() : '', erro: e });
    });
    var sem = pintarQtd();
    if (sem.length) {
      var it0 = S.dados.itens[sem[0]];
      ruins.push({ el: D.querySelector('#cot-itens tr[data-i="' + sem[0] + '"] input[data-f="' + (C.semQtd(it0) ? 'quantidade' : 'valorUnitario') + '"]'), nome: '',
        erro: sem.length + (sem.length === 1 ? ' item sem' : ' itens sem') + ' quantidade ou preço (os dois são obrigatórios — para preço zero, digite 0,00)' });
    }
    if (!ruins.length && !faltam.length) return true;
    msg((faltam.length ? '<b>Preencha antes de criar:</b> ' + faltam.map(function (x) { return esc(x[0]); }).join(' · ') + (ruins.length ? '<br>' : '') : '') +
      (ruins.length ? '<b>Corrija antes de criar:</b> ' + ruins.map(function (r) { return esc(r.nome ? r.nome + ': ' : '') + esc(r.erro); }).join(' · ') : ''), 'erro');
    var p = faltam.length ? faltam[0][1] : ruins[0].el;
    if (p) { p.scrollIntoView({ behavior: 'smooth', block: 'center' }); try { p.focus({ preventScroll: true }); } catch (e) { p.focus(); } }
    return false;
  }
  function htmlItens() {
    var d = S.dados, avisoDe = {}, comIpi = S.ipi || C.temIpi(d.itens), nCol = comIpi ? 10 : 9;   // 05/11/2026 (RECORTE MSB): sem a coluna Un
    ((S.leitura && S.leitura.avisos) || []).forEach(function (a) { if (a.item >= 0) avisoDe[a.item] = a.texto; });
    var linhas = d.itens.map(function (it, i) {
      var ruim = it._cod && (it._cod.st === 'nao' || (it._cod.st === 'vazio' && C.temPreco(it)));
      // 25/11/2026: quantidade e preço obrigatórios em cada item
      // 27/11/2026: o preço pode ser zero, mas digitado ("0,00")
      var cls = [avisoDe[i] ? 'aviso' : '', ruim ? 'cod-nao' : '', it._cod && it._cod.st === 'ok' ? 'cod-ok' : '', C.semQtd(it) ? 'qtd-falta' : '', C.semPreco(it) ? 'vu-falta' : '', C.acimaDasReferencias(it).length ? 'preco-acima' : ''].filter(Boolean).join(' ');
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + (avisoDe[i] ? ' title="' + esc(avisoDe[i]) + '"' : '') + ' data-i="' + i + '">' +
        // 25/11/2026 (pedido do dono: "preço e qtd são obrigatórios"): a Qtd e o Preço logo depois
        // da descrição — com a prévia da proposta ao lado a tabela rola, e eles ficavam escondidos
        '<td class="cod"><input data-f="codigo" value="' + esc(it.codigo) + '" placeholder="Código" autocomplete="off"><span class="cod-st-box">' + C.statusCodigo(it) + '</span></td>' +
        '<td class="desc"><input data-f="descricao" value="' + esc(it.descricao) + '" placeholder="Descrição do produto"><span class="cot-sf-box">' + C.dicaSf(it) + '</span></td>' +
        '<td class="qtd n"><input data-f="quantidade" data-mask="num" inputmode="decimal" value="' + esc(it.quantidade ? C.qtd(it.quantidade) : '') + '"></td>' +
        '<td class="vu n"><input data-f="valorUnitario" data-mask="num" inputmode="decimal" value="' + esc(C.precoCampo(it)) + '" placeholder="0,00" title="Obrigatório — para preço zero, digite 0,00"></td>' +
        (comIpi ? '<td class="ipi n"><input data-f="ipi" data-mask="num" inputmode="decimal" value="' + esc(it.ipi ? String(it.ipi).replace('.', ',') : '') + '" placeholder="%" title="O IPI do item, em %"></td>' : '') +
        '<td class="vt tot" data-tot="' + i + '">' + (it.quantidade && it.valorUnitario ? C.brl(it.quantidade * it.valorUnitario) : '—') + '</td>' +
        '<td class="codc"><input data-f="codigoCliente" value="' + esc(it.codigoCliente) + '" placeholder="Comprador"></td>' +
        '<td class="marca"><input data-f="marca" value="' + esc(it.marca) + '" placeholder="Fabricante"></td>' +
        '<td class="rms"><input data-f="registro" data-mask="digitos" value="' + esc(it.registro) + '" placeholder="ANVISA" inputmode="numeric" maxlength="15"></td>' +
        '<td class="x"><button type="button" class="cs-btn cs-btn-xs cs-btn-ghost" data-tirar="' + i + '" title="Tirar o item">' + IC.x + '</button></td></tr>' +
        // as referências de preço (a média e a tabela) e o alerta — 23/10/2026
        '<tr class="cot-ref-tr" data-ref-i="' + i + '"' + (it.codigo ? '' : ' hidden') + '><td colspan="' + nCol + '"><div class="cot-ref-box">' + C.refsPreco(it, i, codigoCli()) + '</div></td></tr>';
    }).join('');
    var ruins = C.itensComCodigoRuim(d.itens).filter(function (it) { return it._cod && it._cod.st !== 'checando'; }).length;
    var topo = S.codErro ? '<div class="cot-cod-faixa erro">' + IC.alert + '<div><b>Não consegui conferir os códigos no BI</b>' + esc(S.codErro) + '</div><button type="button" class="cs-btn cs-btn-xs" id="cot-cod-reconferir">' + IC.refresh + 'Conferir de novo</button></div>'
      : ruins ? '<div class="cot-cod-faixa">' + IC.alert + '<div><b>' + ruins + ' item(ns) sem código do produto</b>O Código do produto tem de ser um produto nosso (o cadastro do BI do Comercial). Corrija as linhas em vermelho.</div></div>' : '';
    return topo + '<div id="cot-ref-faixa"></div><div class="cot-itens-w"><table class="cot-itens cot-itens-nova"><thead><tr><th class="cod">Código do produto</th><th class="desc">Descrição</th><th class="qtd n">Qtd<b class="cot-req" title="obrigatório">*</b></th><th class="vu n" title="Obrigatório. Embaixo de cada item: a média dos ' + C.MESES_FAT + ' meses de faturamento no cliente e a tabela de preço (Venda Direta e Venda Futura)">Preço unit.<b class="cot-req">*</b></th>' + (comIpi ? '<th class="ipi n" title="O IPI de cada item, em % — sai na proposta">IPI %</th>' : '') + '<th class="vt n">Total</th><th class="codc">Cód. comprador</th><th class="marca">Fabricante</th><th class="rms">RMS</th><th class="x"></th></tr></thead>' +
      '<tbody>' + (linhas || '<tr><td colspan="' + nCol + '" style="padding:16px;text-align:center;color:var(--cs-mut)">Nenhum item — adicione abaixo.</td></tr>') + '</tbody></table></div>' +
      '<div class="cot-itens-pe"><button type="button" class="cs-btn cs-btn-sm" id="cot-add-item">' + IC.plus + 'Item</button>' +
      '<span>' + d.itens.length + ' item(ns)' + (d.totalPdf ? ' · total no PDF ' + C.brl(d.totalPdf) : '') + '</span>' +
      '<span class="cot-fat-dica" id="cot-fat-dica">' + textoFatDica() + '</span>' +
      (d.totalPdf && Math.abs(totalItens(d.itens) - d.totalPdf) > Math.max(0.05, d.totalPdf * 0.005) ? '<span class="cot-tot-dif">' + IC.alert + 'não bate com o total do PDF — confira as quantidades</span>' : '') +
      '<span class="cot-tot-grp"><label class="cot-ipi-chk" title="Marque para informar o IPI de cada item (em %) — sai na proposta"><input type="checkbox" id="cot-ipi"' + (comIpi ? ' checked' : '') + '> Tem IPI?</label>' +
      '<span class="tot">Total cotado<b id="cot-total">' + C.brl(totalItens(d.itens)) + '</b></span>' + htmlTotIpi(d.itens, comIpi) + '</span></div>';
  }
  // o IPI somado e o total com o IPI, ao lado do total cotado (29/10/2026)
  function htmlTotIpi(itens, comIpi) {
    if (!comIpi) return '<span id="cot-tot-ipi"></span>';
    var vi = C.totalIpi(itens);
    return '<span id="cot-tot-ipi" class="cot-tot-ipi"><span class="tot">IPI<b>' + C.brl(vi) + '</b></span><span class="tot">Total com IPI<b>' + C.brl(totalItens(itens) + vi) + '</b></span></span>';
  }
  // de onde veio a DATA DE VENCIMENTO (a dica embaixo do campo) — redesenhada
  // a cada tecla, sem perder o foco. A data passada é só um aviso (20/10/2026)
  function htmlVencDica() {
    var d = S.dados, v = d.datas.validade, o = d.vencimentoOrigem;
    var txt = !v ? 'informe a data' : o === 'calc' ? 'data da cotação + ' + d.validadeCalculada + ' dia(s) de validade' : 'informada por você';
    return (C.venceu(v) ? '<b class="venc">prazo vencido · </b>' : '') + esc(txt);
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
      '<small>' + (n != null && n < 0 ? 'vencimento antes da data da cotação?' : 'vencimento − data da cotação') + '</small>';
  }
  function pintarValidade() {
    var a = $('cot-venc-dica'); if (a) a.innerHTML = htmlVencDica();
    var dd = $('cot-val-dias'); if (dd) dd.innerHTML = htmlDias();
    var w = $('cot-venc-campo');
    // vencimento antes da cotação: o erro some assim que as datas ficam certas
    var vi = w && w.querySelector('input'); if (vi && w.classList.contains('invalido')) conferirCampo(vi);
    var cr = $('cot-criar'); if (cr && !S.criando) cr.innerHTML = rotuloCriar();
    var pr = $('cot-prop-box'); if (pr) pr.innerHTML = htmlProposta();
  }
  function pintarExtras() { var el = $('cot-prop-extras'); if (el) el.innerHTML = C.htmlExtras(S.prop.anexos); }
  function rotuloCriar() {
    return IC.checkc + (podeEnviar() ? 'Criar o caso e enviar a proposta' : 'Criar o caso da oportunidade');
  }
  // vai mandar a proposta ao criar? (marcado e com e-mail — mesmo com a data
  // de vencimento passada: ela é só um aviso, 20/10/2026)
  function podeEnviar() {
    return !!(P && S.prop.enviar && S.dados && P.listaEmails(S.prop.para).length);
  }
  function htmlProposta() {
    var op = operador(), setor = C.contatoDoSetor((S.dados && S.dados.unidade) || '');
    if (!P) return '<p class="cot-ag-sub" style="margin:0">O gerador da proposta não carregou nesta página — recarregue.</p>';
    var semEmail = !P.listaEmails(S.prop.para).length;
    return '<div class="cot-prop">' +
      '<div class="cot-prop-l">' +
        '<label class="cot-prop-chk"><input type="checkbox" id="cot-prop-enviar"' + (S.prop.enviar ? ' checked' : '') + '> ' +
          '<span><b>Enviar a proposta por e-mail ao criar o caso</b><small>O PDF no modelo da MSB, com os dados desta oportunidade e os seus — a descrição, o fabricante e o RMS de cada item vêm do cadastro do Salesforce —, ' +
            (setor ? 'sai pela caixa ' + esc(setor.email) + ' (sem a permissão nela, pelo seu Outlook, com as respostas indo para ela).' : 'sai pelo seu Outlook (fica nos seus Itens Enviados).') + '</small></span></label>' +
        '<div class="cot-grade">' +
          // 29/10/2026 (pedido do usuário): o nome do comprador — o mesmo "Contato" do
          // Comprador: sai no PDF ("Nome completo") e no "Prezado(a)" do e-mail
          '<div class="cs-campo s4"><label>Nome do comprador</label><input id="cot-prop-nome" type="text" value="' + esc((S.dados && S.dados.contato && S.dados.contato.nome) || '') + '" placeholder="quem recebe a proposta" autocomplete="off"></div>' +
          '<div class="cs-campo s2' + (semEmail && S.prop.enviar ? ' falta' : '') + '"><label>Para (e-mail do comprador)</label><input id="cot-prop-para" type="text" value="' + esc(S.prop.para) + '" placeholder="compras@hospital.com.br" autocomplete="off"' + attrsMascara('emails') + '><small class="cot-erro-campo" role="alert"></small></div>' +
          '<div class="cs-campo s2"><label>Cópia (opcional)</label><input id="cot-prop-copia" type="text" value="' + esc(S.prop.copia) + '" placeholder="separe com ;" autocomplete="off"' + attrsMascara('emails') + '><small class="cot-erro-campo" role="alert"></small></div>' +
        '</div>' +
        // 25/11/2026: sobrava um </div> aqui — o "Preparado por" caía fora da grade da proposta
        '<div class="cs-campo s4"><label>Outros arquivos (opcional)</label><div id="cot-prop-extras">' + C.htmlExtras(S.prop.anexos) + '</div></div>' +
      '</div>' +
      // 22/10/2026: a unidade com contato do setor (Venda Recorrente, BIO.ID): o
      // e-mail e o telefone dele na proposta e o envio pela caixa dele
      (setor
        ? '<div class="cot-prop-r"><small>Preparado por</small><b>' + esc(op.nome || '—') + '</b>' +
          '<span>' + esc(op.area || 'sem área') + '</span>' +
          '<div class="cot-prop-setor"><small>Contato do setor · ' + esc(setor.setor) + '</small><b>' + esc(setor.email) + '</b><span>' + esc(setor.telefone) + '</span><em>sai na proposta e o e-mail sai por esta caixa</em></div>'
        : '<div class="cot-prop-r"><small>Preparado por</small><b>' + esc(op.nome || '—') + '</b>' +
          '<span>' + esc(op.area || 'sem área') + ' · ' + esc(op.email || '') + '</span>' +
          '<div class="cs-campo" style="margin-top:8px"><label>Seu telefone na proposta</label><input id="cot-prop-tel" value="' + esc(op.telefone) + '" placeholder="(31) 9…" autocomplete="off"' + attrsMascara('fone') + '><small class="cot-erro-campo" role="alert"></small></div>') +
        '<button type="button" class="cs-btn cs-btn-sm" id="cot-prop-ver">' + IC.eye + 'Ver a proposta (PDF)</button></div>' +
    '</div>';
  }
  /* ── o comprador: CNPJ ou código do cliente ─────────────────────────
     Dois jeitos de preencher (20/10/2026): PELO CNPJ ou PELO CÓDIGO do
     cliente no ERP o Dynamics preenche o cadastro (/api/cot-casos?cliente=
     CNPJ | ?codigoCliente=COD — shared/cot-erp.js, só leitura: razão social,
     código, CNPJ, endereço, grupo, condição de pagamento, BLOQUEADO). O CLIENTE
     NOVO (23/10/2026) saiu em 25/11/2026 (pedido do usuário). Pelo CNPJ, digitar já consulta e completa só o
     que está VAZIO (o que veio do PDF fica); o botão "Buscar" preenche com o
     cadastro (campos marcados "Dynamics"). O servidor completa de novo ao criar. */
  var MODOS_CLI = [['cnpj', 'Pelo CNPJ'], ['codigo', 'Pelo código do cliente']];
  var DICA_MODO = {
    cnpj: 'Digite o CNPJ e clique em Buscar: razão social, código e endereço vêm do cadastro do Dynamics.',
    codigo: 'Digite o código do cliente no ERP (ex.: C004512) e clique em Buscar: CNPJ, razão social e endereço vêm do Dynamics.'
  };
  function htmlModoCli() {
    return '<div class="cot-modo-cli" role="radiogroup" aria-label="Como preencher o comprador">' + MODOS_CLI.map(function (m) {
      return '<button type="button" role="radio" aria-checked="' + (S.modoCli === m[0]) + '" class="' + (S.modoCli === m[0] ? 'on' : '') + '" data-modo-cli="' + m[0] + '">' + esc(m[1]) + '</button>';
    }).join('') + '</div><p class="cot-modo-dica">' + esc(DICA_MODO[S.modoCli]) + '</p>';
  }
  function btnBuscarCli(por) { return '<button type="button" class="cs-btn cs-btn-sm cs-btn-p" data-buscar-cli="' + por + '">' + IC.search + 'Buscar</button>'; }
  function cnpjDigitos() { return String((S.dados && S.dados.cliente.cnpj) || '').replace(/\D/g, ''); }
  function codigoCli() { return String((S.dados && S.dados.cliente.codigo) || '').trim().toUpperCase().replace(/\s+/g, ''); }
  function buscarCli(por) { if (por === 'codigo') buscarPorCodigo(); else buscarErp(true); }
  // explicito = o botão "Buscar" (preenche com o cadastro); sem ele = digitando (só o vazio)
  function buscarErp(explicito) {
    var d = cnpjDigitos();
    // só CNPJ/CPF válido vai ao Dynamics (o inválido daria "não encontrado" — parece cliente novo)
    if ((d.length !== 14 && d.length !== 11) || C.validar('cnpj', d)) {
      S.erp = explicito === true ? { estado: 'falta', msg: 'Digite um CNPJ válido para buscar no Dynamics.' } : null; pintarErp(); return;
    }
    // digitando o MESMO CNPJ que já foi (ou está sendo) consultado: não consulta de novo
    if (explicito !== true && S.erp && S.erp.por === 'cnpj' && S.erp.cnpj === d && S.erp.estado !== 'erro') return;
    S.erp = { estado: 'buscando', por: 'cnpj', cnpj: d }; pintarErp();
    C.api('cot-casos?cliente=' + encodeURIComponent(d)).then(function (j) {
      if (cnpjDigitos() !== d) return;          // a pessoa trocou o CNPJ enquanto isso
      var v = (j && j.erp) || {};
      if (v.desligado) { S.erp = explicito === true ? { estado: 'falta', msg: 'A consulta ao Dynamics não está ligada no portal — preencha à mão.' } : null; }
      else if (v.erro) { S.erp = { estado: 'erro', msg: v.erro, por: 'cnpj', cnpj: d }; }
      else if (v.achou) { S.erp = { estado: 'ok', v: v, por: 'cnpj', cnpj: d, sobre: explicito === true, completou: completarDoErp(v, explicito === true) }; }
      else { S.erp = { estado: 'nao', por: 'cnpj', cnpj: d }; }
      pintarErp();
    }).catch(function (e) { if (cnpjDigitos() === d) { S.erp = { estado: 'erro', msg: e.message, por: 'cnpj' }; pintarErp(); } });
  }
  function buscarPorCodigo() {
    var cod = codigoCli();
    if (!cod) { S.erp = { estado: 'falta', msg: 'Digite o código do cliente para buscar no Dynamics.' }; pintarErp(); var ic = D.querySelector('[data-k="cliente.codigo"]'); if (ic) ic.focus(); return; }
    S.erp = { estado: 'buscando', por: 'codigo' }; pintarErp();
    C.api('cot-casos?codigoCliente=' + encodeURIComponent(cod)).then(function (j) {
      if (codigoCli() !== cod) return;          // trocou o código enquanto isso
      var v = (j && j.erp) || {};
      if (v.desligado) { S.erp = { estado: 'falta', msg: 'A consulta ao Dynamics não está ligada no portal — preencha à mão.' }; }
      else if (v.erro) { S.erp = { estado: 'erro', msg: v.erro, por: 'codigo' }; }
      else if (v.achou) { S.erp = { estado: 'ok', v: v, por: 'codigo', sobre: true, completou: completarDoErp(v, true) }; }
      else { S.erp = { estado: 'nao', por: 'codigo', motivo: v.motivo || '' }; }
      pintarErp();
    }).catch(function (e) { if (codigoCli() === cod) { S.erp = { estado: 'erro', msg: e.message, por: 'codigo' }; pintarErp(); } });
  }
  var buscarErpDepois = C.debounce(buscarErp, 700);
  // sobre = o "Buscar": o cadastro do Dynamics PREENCHE (troca o que estiver lá);
  // sem ele (digitando o CNPJ) só completa o vazio. Contato: só se estiver vazio.
  function completarDoErp(v, sobre) {
    var cli = S.dados.cliente, ct = S.dados.contato, feitos = [];
    var por = function (alvo, k, val, campoK) {
      if (!val || (!sobre && alvo[k]) || alvo[k] === val) return;
      alvo[k] = val; feitos.push(k);
      var inp = D.querySelector('[data-k="' + campoK + '"]');
      if (inp) { inp.value = val; var w = inp.closest('.cs-campo'); if (w) { w.classList.add('erp'); w.classList.remove('falta', 'invalido'); } }
    };
    por(cli, 'codigo', v.codigo, 'cliente.codigo');
    if (v.cnpj) por(cli, 'cnpj', C.formatar('cnpj', v.cnpj), 'cliente.cnpj');
    por(cli, 'nome', v.nome, 'cliente.nome');
    por(cli, 'endereco', [v.endereco, v.bairro].filter(Boolean).join(' - '), 'cliente.endereco');
    por(cli, 'cidade', v.cidade, 'cliente.cidade'); por(cli, 'uf', C.formatar('uf', v.uf), 'cliente.uf'); por(cli, 'cep', C.formatar('cep', v.cep), 'cliente.cep');
    if (!ct.email && v.email) por(ct, 'email', v.email, 'contato.email');
    if (!ct.telefone && v.telefone && !C.validar('fone', v.telefone)) por(ct, 'telefone', C.formatar('fone', v.telefone), 'contato.telefone');
    pintarAvisoCep();
    if (feitos.indexOf('codigo') >= 0) referencias();
    return feitos.length;
  }
  function htmlErp() {
    var e = S.erp;
    if (!e) return '';
    var pelo = e.por === 'codigo' ? 'o código' : 'o CNPJ';
    if (e.estado === 'falta') return '<div class="cot-erp aviso">' + IC.info + '<div><b>' + esc(e.msg) + '</b></div></div>';
    if (e.estado === 'buscando') return '<div class="cot-erp">' + '<span class="cs-spin"></span><div><b>Procurando ' + pelo + ' no Dynamics…</b></div></div>';
    if (e.estado === 'erro') return '<div class="cot-erp aviso">' + IC.alert + '<div><b>Não consegui consultar o Dynamics agora</b>' + esc(e.msg || '') + '</div><button type="button" class="cs-btn cs-btn-xs" id="cot-erp-de-novo">' + IC.refresh + 'Tentar de novo</button></div>';
    if (e.estado === 'nao') return e.por === 'codigo'
      ? '<div class="cot-erp novo">' + IC.info + '<div><b>Código não encontrado no Dynamics</b>' + (e.motivo ? esc(e.motivo) + ' — ' : '') + 'confira o código, busque pelo CNPJ ou preencha à mão.</div></div>'
      : '<div class="cot-erp novo">' + IC.info + '<div><b>CNPJ não encontrado no Dynamics</b>Cliente novo — o cadastro no ERP é pedido quando a oportunidade virar pedido (PI).</div></div>';
    var v = e.v, pag = S.dados.condicoes.pagamento;
    var linhas = [
      ['Código do cliente', v.codigo], ['Empresa', (v.empresas || []).join(', ') || v.empresa], ['Grupo', v.grupo],
      ['Cond. pagamento cadastrada', v.pagamento + (pag && v.pagamento && C.norm(pag).indexOf(C.norm(v.pagamento)) < 0 ? ' (informada: ' + pag + ')' : '')],
      ['Forma de pagamento', v.formaPagamento], ['Segmento', v.segmento], ['Vendedor', v.vendedor],
      ['Limite de crédito', v.limiteCredito ? C.brl(v.limiteCredito) : ''], ['E-mail no cadastro', v.email], ['Telefone no cadastro', v.telefone]
    ].filter(function (l) { return l[1]; });
    return '<div class="cot-erp ok' + (v.bloqueado ? ' bloq' : '') + '">' + (v.bloqueado ? IC.ban : IC.checkc) + '<div><b>Cliente no Dynamics' + (v.nome ? ' · ' + esc(v.nome) : '') + '</b>' +
      (v.bloqueado ? '<span class="cot-erp-bloq">BLOQUEADO no Dynamics (' + esc(v.bloqueio) + ')</span>' : '') +
      '<dl>' + linhas.map(function (l) { return '<dt>' + esc(l[0]) + '</dt><dd>' + esc(l[1]) + '</dd>'; }).join('') + '</dl>' +
      (e.completou ? '<small>' + (e.sobre ? 'Preenchi ' + e.completou + ' campo(s) com o cadastro' : 'Completei ' + e.completou + ' campo(s) vazio(s) com o cadastro') + ' (marcados "Dynamics") — dá para corrigir.</small>' : '') + '</div></div>';
  }
  function pintarErp() { var b = $('cot-erp-box'); if (b) b.innerHTML = htmlErp(); previaDepois(); }

  // CNPJ e código do cliente: o do modo vem primeiro, com o "Buscar"
  function htmlCamposId() {
    var m = S.modoCli;
    // o CNPJ com o "Buscar" do lado precisa de 3/4 da linha (o código cabe em 1/4)
    // 29/10/2026: obrigatório o CNPJ ou o código (o asterisco no do modo)
    var cnpj = campo('CNPJ', 'cliente.cnpj', { cls: m === 'cnpj' ? 's3 cot-busca' : 's2', mask: 'cnpj', ph: '00.000.000/0000-00', req: m === 'cnpj', depois: m === 'cnpj' ? btnBuscarCli('cnpj') : '' });
    var cod = campo(m === 'cnpj' ? 'Código (ERP)' : 'Código do cliente (ERP)', 'cliente.codigo', { cls: m === 'codigo' ? 's2 cot-busca' : m === 'cnpj' ? 'cot-cod' : 's2', ph: 'ex.: C004512', max: 30, req: m === 'codigo', depois: m === 'codigo' ? btnBuscarCli('codigo') : '' });
    return m === 'codigo' ? cod + cnpj : cnpj + cod;
  }
  // o PORTAL (21/10/2026, pedido do usuário: "possibilite alterar o portal
  // quando o operador quiser"): uma lista com os portais das Configurações —
  // o que a IA leu entra nela, escolhido — e "Outro (digitar)…" para um nome
  // que não está na lista. Trocar é só escolher outro.
  function htmlPortal() {
    var v = S.dados.portal || '', l = ((S.cfg && S.cfg.portais) || []).slice();
    var ia = S.lidos.portal ? '<span class="ia">IA</span>' : '', falta = !v ? ' falta' : '';
    var input, dica;
    if (S.portalLivre) {
      input = '<input data-k="portal" value="' + esc(v) + '" placeholder="nome do portal" autocomplete="off" maxlength="60">';
      dica = '<button type="button" class="cot-link" id="cot-portal-lista">escolher da lista</button>';
    } else {
      var sel = l.filter(function (p) { return C.norm(p) === C.norm(v); })[0] || v;
      var ops = (sel && l.indexOf(sel) < 0 ? [sel] : []).concat(l);
      input = '<select id="cot-portal-sel" aria-label="Portal"><option value="">Escolha o portal…</option>' +
        ops.map(function (o) { return '<option' + (o === sel ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') +
        '<option value="__outro">Outro (digitar)…</option></select>';
      dica = S.lidos.portal ? 'lido do PDF — troque se não for este' : 'onde a oportunidade foi respondida';
    }
    return '<div class="cs-campo s2' + falta + '" id="cot-portal-campo"><label>Portal' + ia + '</label>' + input + '<small>' + dica + '</small></div>';
  }
  function repintarPortal(foco) {
    var w = $('cot-portal-campo'); if (!w) return;
    w.outerHTML = htmlPortal();
    var el = foco && D.querySelector('#cot-portal-campo input, #cot-portal-campo select'); if (el) el.focus();
  }
  // a TRANSPORTADORA (25/11/2026): a lista do PI (Dynamics) chega depois — o
  // campo é refeito quando ela chega (repintarTransp)
  function htmlTransp() {
    var v = ((S.dados && S.dados.condicoes) || {}).transportadora || '', tr = S.transp;
    var dica = !tr ? 'carregando a lista do Dynamics…' : tr.erro ? 'lista do Dynamics indisponível (' + esc(tr.erro) + ') · opcional' : 'a lista do PI · Pedido · opcional';
    return campo('Transportadora', 'condicoes.transportadora', { cls: 's2', id: 'cot-transp-campo', lista: C.listaCom(tr ? tr.nomes : [], v), vazio: 'Não informar', dica: dica });
  }
  function repintarTransp() { var w = $('cot-transp-campo'); if (w) w.outerHTML = htmlTransp(); }
  function htmlConf() {
    var d = S.dados, cfg = S.cfg || {};
    return '<div class="cot-conf-tit"><h3>Dados da oportunidade</h3>' +
      // 25/11/2026 (pedido do dono): a prévia pode ser ocultada (como o "Ocultar PDF" do PI)
      '<button type="button" class="cs-btn cs-btn-sm" id="cot-previa-mostrar"' + (PV.oculta ? '' : ' hidden') + '>' + IC.eye + 'Mostrar prévia da proposta</button></div>' +
      '<p class="cot-ag-sub">Os campos com <b class="cot-req">*</b> são obrigatórios para criar, e ao menos 1 item cotado (com quantidade e preço); o resto dá para completar depois, no caso.</p>' +
      '<div id="cot-dup">' + htmlDup() + '</div>' +
      '<div class="cot-conf cot-conf-previa' + (PV.oculta ? ' sem-previa' : '') + '" id="cot-conf"><div class="cot-conf-form">' +
        '<div class="cot-sec"><h5>' + IC.inbox + (S.semPortal ? 'Oportunidade' : 'Cotação no portal') + ' <span class="cs-chip f-cotada" style="margin-left:auto"><span class="bol"></span>Entra como Cotada</span></h5><div class="cot-grade">' +
          // à mão (sem PDF) é uma ordem nova: não há portal nem nº da cotação (23/10/2026)
          (S.semPortal ? '' : htmlPortal() +
          campo('Nº da cotação (ID)', 'cotacaoId', { cls: 's2', obrig: true, ph: 'o ID / identificador no portal' })) +
          campo('Data da cotação', 'datas.cotacao', { tipo: 'date', cls: 's2', req: true }) +
          campo('Data de vencimento', 'datas.validade', { tipo: 'date', cls: 's2 cot-venc', id: 'cot-venc-campo', req: true, erro: true, dica: '<span id="cot-venc-dica">' + htmlVencDica() + '</span>' }) +
          '<div class="cs-campo s1" id="cot-val-dias">' + htmlDias() + '</div>' +
          '<div class="cs-campo s1"><label>Empresa</label><div class="cot-calc">MSB</div><small>sempre MSB</small></div>' +
          htmlUnidade(d) +
        '</div></div>' +
        '<div class="cot-sec"><h5>' + IC.building + 'Comprador</h5>' + htmlModoCli() + '<div id="cot-erp-box">' + htmlErp() + '</div><div class="cot-grade">' +
          htmlCamposId() +
          campo('Cliente (razão social)', 'cliente.nome', { cls: 's4', obrig: true }) +
          campo('Endereço', 'cliente.endereco', { cls: 's4', ph: 'rua, número, bairro' }) +
          campo('CEP', 'cliente.cep', { mask: 'cep', ph: '00000-000', aviso: true }) +
          campo('Cidade', 'cliente.cidade', { cls: 's2' }) +
          campo('UF', 'cliente.uf', { lista: C.UFS }) +
          campo('Contato', 'contato.nome', { cls: 's2' }) +
          campo('Telefone', 'contato.telefone', { cls: 's2', mask: 'fone', ph: '(00) 00000-0000' }) +
          campo('E-mail do comprador', 'contato.email', { cls: 's4', mask: 'email', ph: 'nome@hospital.com.br', dica: 'é para ele que a proposta vai' }) +
        '</div></div>' +
        '<div class="cot-sec"><h5>' + IC.tag + 'Condições ofertadas</h5><div class="cot-grade">' +
          // 25/11/2026 (pedido do dono): a condição de pagamento é a LISTA do PI ·
          // Pedido (era campo aberto); a TRANSPORTADORA, a mesma lista do PI (o
          // Dynamics, opcional); e a OBSERVAÇÃO NA NOTA. Tudo sai na proposta e vai
          // para o PI pela fila de aprovação quando a oportunidade virar pedido
          campo('Condição de pagamento', 'condicoes.pagamento', { cls: 's2', req: true, lista: C.listaCom(C.COND_PAGAMENTO, d.condicoes.pagamento), vazio: 'Escolha a condição…', dica: 'a lista do PI · Pedido · sai na proposta' }) +
          htmlTransp() +
          // 22/10/2026: o frete e o prazo de entrega voltaram (saem na proposta)
          // 26/11/2026: o frete com as opções do PI (no PDF sai só CIF ou FOB)
          campo('Frete', 'condicoes.frete', { cls: 's2', req: true, lista: C.listaCom(C.FRETES, d.condicoes.frete), vazio: 'Escolha o frete…', dica: 'a lista do PI · Pedido · no PDF sai CIF ou FOB' }) +
          // 26/11/2026: a condição de entrega do PI (PADRÃO / URGENTE); o prazo é o texto da proposta
          campo('Condição de entrega', 'condicoes.condEntrega', { cls: 's2', req: true, lista: C.listaCom(C.COND_ENTREGA, d.condicoes.condEntrega), vazio: 'Escolha a condição…', dica: 'a lista do PI · Pedido · sai na proposta' }) +
          campo('Prazo de entrega', 'condicoes.entrega', { cls: 's4', req: true, ni: true, ph: 'ex.: 5 dias úteis após o pedido', max: 120 }) +
          campo('Observação', 'condicoes.observacao', { cls: 's4', area: true, linhas: 2, dica: 'sai no PDF da proposta' }) +
          campo('Observação na nota', 'condicoes.obsNota', { cls: 's4', area: true, linhas: 2, ph: 'Opcional — deixe em branco se não houver observação na nota fiscal', dica: 'vai para o rodapé da nota fiscal (PI · Pedido) e sai no PDF da proposta' }) +
        '</div></div>' +
      '<div class="cot-sec cot-sec-larga"><h5>' + IC.list + 'Itens cotados' + (S.lidos.itens ? ' <span class="cs-chip" style="height:18px;font-size:10px;color:#5A3BC4">IA</span>' : '') + '</h5><div id="cot-itens">' + htmlItens() + '</div>' +
        // o estoque da venda (05/11/2026, RECORTE MSB): o mesmo do PI · Pedido da MSB
        '<div id="cot-estoque" class="cot-est-box"></div></div>' +
      '<div class="cot-sec cot-sec-larga"><h5>' + IC.pdf + 'Proposta para o comprador</h5><div id="cot-prop-box">' + htmlProposta() + '</div></div>' +
      '<div class="cot-sec cot-sec-larga"><h5>' + IC.note + 'Nota para o time (opcional)</h5>' +
        campo('', 'nota', { area: true, linhas: 3, ph: 'O que você combinou, o que está pendente, quem acompanha…' }) + '</div>' +
      '<div class="cot-acoes-pe"><button type="button" class="cs-btn" id="cot-voltar">' + IC.back + 'Recomeçar</button>' +
        '<div class="dir"><button type="button" class="cs-btn cs-btn-p" id="cot-criar"' + (S.configurado === false ? ' disabled title="Armazenamento não configurado"' : '') + '>' + rotuloCriar() + '</button></div></div>' +
      '<div class="cot-msg" id="cot-msg"></div>' +
      '</div>' + htmlPrevia() + '</div>';
  }

  /* ── a PRÉVIA da proposta (25/11/2026, pedido do usuário) ──────────
     À direita do formulário, o PDF da proposta no modelo da MSB (o mesmo
     COTPROP.gerar do envio), refeito ~0,6 s depois de cada mudança: só gera
     de novo quando os dados da proposta mudaram (a assinatura), e as páginas
     novas (pdf.js, na largura do painel) só entram no lugar das antigas
     depois de desenhadas — sem piscar. Sem o pdf.js, um <iframe>. */
  // 25/11/2026 (pedido do dono: "deixe a opção para ocultar o PDF aqui também"): o
  // "Ocultar" no cabeçalho da prévia some com o painel (o formulário fica com a
  // largura toda) e o "Mostrar prévia da proposta" no topo traz de volta; oculta,
  // a prévia nem é gerada. A escolha fica no navegador (cot-previa-oculta).
  var PV = { assin: '', vez: 0, des: 0, doc: null, url: '', st: '', erro: '', oculta: C.lerLocal('cot-previa-oculta') === '1' };
  function ocultarPrevia(sim) {
    PV.oculta = !!sim;
    C.gravarLocal('cot-previa-oculta', sim ? '1' : '0');
    var g = $('cot-conf'), bt = $('cot-previa-mostrar');
    if (g) g.classList.toggle('sem-previa', PV.oculta);
    if (bt) bt.hidden = !PV.oculta;
    if (PV.oculta) return;
    // de volta: as páginas que já existiam na hora e, se os dados mudaram, a nova
    if (PV.doc || PV.url) desenharPrevia().catch(function () {});
    previaDepois();
  }
  function htmlPrevia() {
    return '<aside class="cot-previa" id="cot-previa" aria-label="Prévia da proposta">' +
      '<div class="cot-previa-h">' + IC.pdf + '<b>Prévia da proposta</b><span class="st" id="cot-previa-st">' + htmlStPrevia() + '</span>' +
        '<button type="button" class="cs-btn cs-btn-xs" id="cot-previa-abrir" title="Abrir a proposta numa aba nova">' + IC.eye + 'Abrir</button>' +
        '<button type="button" class="cs-btn cs-btn-xs" id="cot-previa-ocultar" title="Ocultar a prévia — o formulário fica com a largura toda">' + IC.x + 'Ocultar</button></div>' +
      '<div class="cot-previa-v" id="cot-previa-v"><div class="cot-previa-pags" id="cot-previa-pags"><div class="cot-previa-car"><span class="cs-spin"></span> Montando a proposta…</div></div></div>' +
    '</aside>';
  }
  function htmlStPrevia() {
    if (!P) return 'o gerador não carregou';
    if (PV.st === 'gerando') return '<span class="cs-spin"></span> atualizando…';
    if (PV.st === 'erro') return '<span class="erro" title="' + esc(PV.erro) + '">não consegui gerar</span>';
    if (PV.st === 'ok') return 'atualiza enquanto você preenche';
    return '';
  }
  function stPrevia(st, erro) { PV.st = st; PV.erro = erro || ''; var el = $('cot-previa-st'); if (el) el.innerHTML = htmlStPrevia(); }
  // o caso como vai na proposta (o número só existe depois de criar)
  function casoDaPrevia() { var c = casoDaTela(); c.numero = ''; return c; }
  function previa() {
    if (S.passo !== 'conf' || !S.dados || !P || !P.pronto() || !$('cot-previa') || PV.oculta) return;
    var caso = casoDaPrevia(), op = operador();
    var assin = JSON.stringify([caso, op]);
    if (assin === PV.assin) return;
    PV.assin = assin;
    var vez = ++PV.vez;
    stPrevia('gerando');
    P.gerar(caso, op).then(function (pdf) {
      if (vez !== PV.vez) return;
      if (PV.url) URL.revokeObjectURL(PV.url);
      PV.url = URL.createObjectURL(pdf.blob);
      if (!window.pdfjsLib) { previaIframe(); stPrevia('ok'); return; }
      return pdf.blob.arrayBuffer().then(function (buf) {
        return window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      }).then(function (doc) {
        if (vez !== PV.vez) { doc.destroy(); return; }
        var velho = PV.doc; PV.doc = doc;
        return desenharPrevia().then(function () {
          if (velho) { try { velho.destroy(); } catch (e) {} }
          if (vez === PV.vez) stPrevia('ok');
        });
      });
    }).catch(function (e) {
      if (vez !== PV.vez) return;
      PV.assin = '';   // a próxima mudança tenta de novo
      stPrevia('erro', (e && e.message) || String(e));
    });
  }
  var previaDepois = C.debounce(previa, 600);
  function previaIframe() {
    var b = $('cot-previa-pags'); if (!b || !PV.url) return;
    b.innerHTML = '<iframe src="' + PV.url + '#toolbar=0&navpanes=0&view=FitH" title="Prévia da proposta"></iframe>';
  }
  // as páginas do PDF na largura do painel; as novas só entram depois de prontas
  function desenharPrevia() {
    var box = $('cot-previa-pags'), doc = PV.doc;
    if (!box) return Promise.resolve();
    if (!doc) { if (PV.url && !window.pdfjsLib) previaIframe(); return Promise.resolve(); }
    var vez = ++PV.des, larg = Math.max(200, box.clientWidth - 24), dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cvs = [], cadeia = Promise.resolve();
    for (var n = 1; n <= doc.numPages; n++) {
      (function (n) {
        cadeia = cadeia.then(function () { return vez === PV.des ? doc.getPage(n) : null; }).then(function (pg) {
          if (!pg || vez !== PV.des) return;
          var vp = pg.getViewport({ scale: (larg / pg.getViewport({ scale: 1 }).width) * dpr });
          var cv = D.createElement('canvas');
          cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
          cvs.push(cv);
          return pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        });
      })(n);
    }
    return cadeia.then(function () {
      var b = $('cot-previa-pags');
      if (vez !== PV.des || !b || !cvs.length) return;
      var topo = b.parentNode ? b.parentNode.scrollTop : 0;
      b.replaceChildren.apply(b, cvs);
      if (b.parentNode) b.parentNode.scrollTop = topo;
    }).catch(function (e) { if (vez === PV.des) throw e; });
  }
  function abrirPrevia() {
    if (PV.url && PV.st === 'ok') { window.open(PV.url, '_blank'); return; }
    verProposta(casoDaPrevia());
  }

  /* ── 4 · pronto ─────────────────────────────────────────────── */
  function htmlEnvio() {
    var e = S.envio;
    if (!P) return '';
    if (e && e.estado === 'enviando') return '<div class="cot-envio">' + '<span class="cs-spin"></span><div><b>Enviando a proposta para ' + esc(e.para) + '…</b>Gerando o PDF no modelo da MSB e mandando pelo seu Outlook.</div></div>';
    if (e && e.estado === 'ok') return '<div class="cot-envio ok">' + IC.checkc + '<div><b>Proposta enviada para ' + esc(e.para) + '</b>' + esc(e.msg || 'O PDF ficou no caso e o envio está no histórico.') + '</div>' +
      '<button type="button" class="cs-btn cs-btn-sm" id="cot-prop-ver2">' + IC.eye + 'Ver a proposta</button></div>';
    var erro = e && e.estado === 'erro';
    return '<div class="cot-envio' + (erro ? ' erro' : '') + '">' + (erro ? IC.alert : IC.pdf) + '<div><b>' + (erro ? 'A proposta não foi enviada' : 'A proposta está pronta') + '</b>' +
      (erro ? esc(e.msg) : 'No modelo da MSB, com os dados da oportunidade e os seus. Confira e mande para o comprador.') + '</div>' +
      '<div class="cot-envio-bts"><input id="cot-prop-para2" value="' + esc(S.prop.para) + '" placeholder="e-mail do comprador" autocomplete="off">' +
      '<button type="button" class="cs-btn cs-btn-sm" id="cot-prop-ver2">' + IC.eye + 'Ver</button>' +
      '<button type="button" class="cs-btn cs-btn-sm cs-btn-p" id="cot-prop-mandar">' + IC.arrow + (erro ? 'Tentar de novo' : 'Enviar proposta') + '</button></div></div>';
  }
  function htmlPronto() {
    var c = S.criado || {};
    return '<div class="cot-pronto"><span class="ic">' + C.svg('<polyline points="20 6 9 17 4 12"/>', 34) + '</span>' +
      '<h3>Oportunidade registrada</h3><span class="num">' + esc(c.numero) + '</span>' +
      '<p>' + esc(C.tituloCaso(c)) + (c.cliente && c.cliente.nome ? ' · ' + esc(c.cliente.nome) : '') + ' · ' + esc(C.fase(c.fase).nome) +
        (c.total ? ' · ' + C.brl(c.total) : '') + (c.itens ? ' · ' + c.itens.length + ' item(ns)' : '') +
        '. Acompanhe no caso — quando ' + (S.semPortal ? 'o cliente mandar o pedido' : 'o portal gerar o pedido') + ', anexe o PDF dele lá e mande para o PI.' + '</p>' +
      '<div id="cot-envio-box">' + htmlEnvio() + '</div>' +
      '<div class="bts"><a class="cs-btn cs-btn-p" href="comercial-cot-casos.html?caso=' + encodeURIComponent(c.numero || '') + '">' + IC.arrow + 'Abrir o caso</a>' +
        '<button type="button" class="cs-btn" id="cot-outra">' + IC.plus + 'Registrar outra oportunidade</button></div></div>';
  }
  function pintarEnvio() { var b = $('cot-envio-box'); if (b) b.innerHTML = htmlEnvio(); }

  // a proposta do caso criado: gera, manda pelo Outlook e registra no caso
  function enviarProposta(caso) {
    var para = P.listaEmails(S.prop.para);
    if (!para.length) { S.envio = { estado: 'erro', msg: 'Informe o e-mail do comprador.' }; pintarEnvio(); return Promise.resolve(); }
    S.envio = { estado: 'enviando', para: para.join(', ') };
    pintarEnvio();
    return P.enviar(caso, operador(), { para: para, copia: S.prop.copia, anexos: S.prop.anexos }).then(function (r) {
      if (r.caso) S.criado = r.caso;
      S.envio = { estado: 'ok', para: para.join(', '), msg: r.erroRegistro ? 'O e-mail saiu, mas não consegui registrar no caso (' + r.erroRegistro + ') — anote no caso.' : C.comoSaiu(r) };
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
    d.itens.forEach(function (it) { if (it.codigo) it.codigo = C.normCod(it.codigo); delete it._cod; delete it._sf; delete it._fat; delete it._tab; });
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
    if (S.passo === 'conf' && !S.dados) S.dados = vazio();
    el.innerHTML = S.passo === 'conf' ? htmlConf() : htmlPronto();
    C.quieto(el);
    if (S.passo === 'conf') {
      marcarInvalidos(); referencias(); estoqueDepois();
      // o render refaz o painel: as páginas que já estavam voltam na hora
      if (PV.doc || PV.url) desenharPrevia().catch(function () {});
      previaDepois();
    }
  }
  function msg(html, tipo) {
    var m = $('cot-msg'); if (!m) return;
    m.className = 'cot-msg' + (html ? ' on' : '') + (tipo ? ' ' + tipo : '');
    m.innerHTML = html || '';
  }
  function recomecar() {
    S.passo = 'conf'; S.texto = ''; S.leitura = null; S.dados = null; S.lidos = {}; S.dup = null; S.forcar = false;
    S.criado = null; S.envio = null; PV.assin = ''; S.codErro = ''; S.criarSemConferir = false; S.erp = null; S.modoCli = 'cnpj';
    S.prop.enviar = false; S.prop.para = ''; S.prop.copia = ''; S.prop.anexos = []; S.portalLivre = false; S.semPortal = true; S.ipi = false;
    render();
  }
  function atualizarTotal() {
    var t = $('cot-total'); if (t) t.textContent = C.brl(totalItens(S.dados.itens));
    var ti = $('cot-tot-ipi'); if (ti) ti.outerHTML = htmlTotIpi(S.dados.itens, S.ipi || C.temIpi(S.dados.itens));
  }

  function criar() {
    if (S.criando) return;
    // sem a unidade de negócio confirmada no Power BI a cotação não é registrada
    var eu = S.eu || {}, us = eu.unidades || [];
    if (!eu.unidadeConfirmada || !us.length) {
      msg('Sem a sua unidade de negócio confirmada no Power BI a oportunidade não é registrada' + (eu.unidadeMotivo ? ' (' + esc(eu.unidadeMotivo) + ')' : '') + '. Use "conectar ao Power BI" no campo Unidade de negócio.', 'erro');
      var cu = $('cot-unid'); if (cu) cu.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (us.length > 1 && !(S.dados && S.dados.unidade)) {
      msg('Escolha a unidade de negócio da oportunidade.', 'erro');
      var su = D.querySelector('[data-k="unidade"]'); if (su) { su.scrollIntoView({ behavior: 'smooth', block: 'center' }); su.focus(); }
      return;
    }
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
          msg('<b>' + ruins.length + ' item(ns) sem código do produto</b>: ' + ruins.slice(0, 5).map(function (it) { return esc(it.codigo || '(sem código)') + ' — ' + esc((it.descricao || '').slice(0, 40)); }).join('; ') + '. Corrija o Código do produto (linhas em vermelho).', 'erro');
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
    if (!d.cliente.nome && !d.cotacaoId && !d.itens.length) { msg(S.semPortal ? 'Informe ao menos o cliente ou um item.' : 'Informe ao menos o cliente, o número da cotação ou um item.', 'erro'); return; }
    if (d.contato.email && !emailOk(d.contato.email)) { msg('O e-mail do comprador não parece válido.', 'erro'); return; }
    if (S.dup && !S.forcar) { msg(S.dup.outraUnidade ? 'Esta oportunidade já foi registrada por outra unidade — marque "Registrar mesmo assim" se for mesmo outra resposta.' : 'Esta oportunidade já tem caso (' + esc(S.dup.numero) + '). Abra o caso — ou marque "Registrar mesmo assim".', 'alerta'); var dp = $('cot-dup'); if (dp) dp.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    // 19/11/2026 (pedido do usuário): o preço acima da média dos 6 meses ou da
    // tabela de preço é só alerta visual (a faixa e a linha em destaque) — não
    // segura o criar
    var enviar = podeEnviar();
    if (P && S.prop.enviar && !enviar) { msg('Para enviar a proposta, informe o e-mail do comprador (em "Proposta para o comprador") — ou desmarque o envio.', 'erro'); var pp = $('cot-prop-para'); if (pp) pp.focus(); return; }
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
        anexo: null, leitura: null
      }).then(function (j) { return { j: j, aut: aut }; });
    }).then(function (r) {
      var j = r.j;
      S.criando = false;
      if (!j || !j.caso) {
        if (b) { b.disabled = false; b.innerHTML = rotuloCriar(); }
        msg('O armazenamento das Oportunidades não está configurado — o caso não foi gravado. Avise o dono do portal (COT_MSB_BLOB_URL).', 'erro');
        return;
      }
      S.criado = j.caso; S.passo = 'pronto';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // o fluxo da proposta: caso criado e Cotada -> o PDF sai para o comprador
      if (enviar && r.aut === true) enviarProposta(j.caso);
    }).catch(function (e) {
      S.criando = false;
      if (b) { b.disabled = false; b.innerHTML = rotuloCriar(); }
      // o servidor não confirmou a unidade (o Power BI mudou desde que a tela abriu)
      if (e.corpo && (e.corpo.semUnidade || e.corpo.escolherUnidade)) {
        if (e.corpo.unidades && S.eu) S.eu.unidades = e.corpo.unidades;
        if (e.corpo.semUnidade && S.eu) { S.eu.unidadeConfirmada = false; S.eu.unidadeMotivo = e.message; }
        render();
        msg(esc(e.message), 'erro');
        return;
      }
      if (e.status === 409 && e.corpo && e.corpo.outraUnidade) { msg(esc(e.message) + ' Ela não aparece para você.', 'alerta'); return; }
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
    // 24/11/2026 (pedido do usuário): o autocomplete do Código do produto — os
    // códigos do catálogo aparecem enquanto digita (COT.autocompletarCodigos),
    // o mesmo do Portal Biomedical
    C.autocompletarCodigos(corpo);
    corpo.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.id === 'cot-forcar') { S.forcar = t.checked; msg(''); return; }
      if (t.id === 'cot-prop-enviar') { S.prop.enviar = t.checked; msg(''); pintarValidade(); return; }
      // o "Não informado" (prazo de entrega): marcar trava o campo com NÃO INFORMADO;
      // desmarcar devolve o que estava digitado
      if (t.matches && t.matches('input[data-ni]')) { marcarNi(t, t.checked); return; }
      // o "Tem IPI?" (29/10/2026): desmarcar tira o IPI de todos os itens
      if (t.id === 'cot-ipi') {
        S.ipi = t.checked;
        if (!t.checked) S.dados.itens.forEach(function (it) { delete it.ipi; });
        pintarItens();
        if (t.checked) { var pi = D.querySelector('#cot-itens input[data-f="ipi"]'); if (pi) pi.focus(); }
        return;
      }
      // os outros arquivos que vão junto com a proposta (22/10/2026)
      if (t.matches && t.matches('input[data-extras]')) {
        var fs = Array.prototype.slice.call(t.files || []); t.value = '';   // a cópia: limpar o campo esvazia o t.files
        C.lerExtras(fs).then(function (l) { S.prop.anexos = S.prop.anexos.concat(l); pintarExtras(); }, function (e) { C.toast('Não consegui ler o arquivo', e.message, 'erro'); });
        return;
      }
      if (t.id === 'cot-portal-sel') {
        if (t.value === '__outro') { S.portalLivre = true; S.dados.portal = ''; repintarPortal(true); return; }
        S.dados.portal = t.value; repintarPortal(); checarDup(); return;
      }
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
        if (k === 'cliente.codigo' && t.value !== t.value.toUpperCase()) { var pc = t.selectionStart; t.value = t.value.toUpperCase(); try { t.setSelectionRange(pc, pc); } catch (e2) {} }
        por(S.dados, k, k === 'cliente.uf' ? t.value.toUpperCase() : t.value);
        var wrap = t.closest('.cs-campo');
        if (wrap && wrap.classList.contains('falta') && t.value) wrap.classList.remove('falta');
        if (k === 'portal' || k === 'cotacaoId') checarDup();
        if (k === 'unidade') { var pb = $('cot-prop-box'); if (pb) pb.innerHTML = htmlProposta(); }
        if (k === 'cliente.cnpj' && S.modoCli === 'cnpj') buscarErpDepois();
        if (k === 'cliente.codigo') referencias();
        // CEP completo e UF vazia: a UF sai do CEP
        if (k === 'cliente.cep' && !S.dados.cliente.uf && C.ufDoCep(t.value)) {
          S.dados.cliente.uf = C.ufDoCep(t.value);
          var su = D.querySelector('[data-k="cliente.uf"]'); if (su) su.value = S.dados.cliente.uf;
        }
        if (k === 'cliente.cep' || k === 'cliente.uf') pintarAvisoCep();
        if (k === 'contato.nome') { var pn = $('cot-prop-nome'); if (pn && pn !== t) pn.value = t.value; }
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
      // o nome do comprador da proposta = o Contato do Comprador (os dois andam juntos)
      if (t.id === 'cot-prop-nome' && S.dados) {
        S.dados.contato = S.dados.contato || {}; S.dados.contato.nome = t.value;
        var cn = D.querySelector('[data-k="contato.nome"]'); if (cn) cn.value = t.value;
        return;
      }
      if (t.id === 'cot-prop-tel') { S.prop.telefone = t.value; C.gravarLocal('cot-prop-tel', t.value.trim()); return; }
      if (t.matches('[data-f]')) {
        var tr = t.closest('tr'), i = Number(tr.getAttribute('data-i')), f = t.getAttribute('data-f');
        var it = S.dados.itens[i]; if (!it) return;
        if (f === 'valorUnitario') C.lerPreco(it, t.value);   // o 0,00 digitado vale como preço
        else it[f] = (f === 'quantidade' || f === 'ipi') ? C.num(t.value) : t.value;
        if (f === 'codigo') { it._cod = null; conferirLinha(i); }
        if (f === 'codigo' || f === 'quantidade') estoqueDepois();
        if (f === 'valorUnitario') { if (it._fat) it._fat.auto = false; pintarRefs(); }
        if (f === 'ipi') { t.classList.toggle('invalido', Number(it.ipi) > 100); atualizarTotal(); }
        if (f === 'quantidade' || f === 'valorUnitario') {
          var cel = corpo.querySelector('[data-tot="' + i + '"]');
          if (cel) cel.textContent = it.quantidade && C.temPreco(it) ? C.brl(it.quantidade * it.valorUnitario) : '—';
          atualizarTotal();
          C.marcarQtdPreco(tr, it);
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
      if (t.id === 'cot-pbi-conectar') { ev.preventDefault(); conectarPbi(); return; }
      if (t.id === 'cot-portal-lista') { ev.preventDefault(); S.portalLivre = false; repintarPortal(true); return; }
      if (t.hasAttribute('data-tirar-extra')) { ev.preventDefault(); S.prop.anexos.splice(Number(t.getAttribute('data-tirar-extra')), 1); pintarExtras(); return; }
      if (t.id === 'cot-erp-de-novo') { buscarCli((S.erp && S.erp.por) || S.modoCli); return; }
      if (t.hasAttribute('data-modo-cli')) {
        S.modoCli = t.getAttribute('data-modo-cli') === 'codigo' ? 'codigo' : 'cnpj';
        if (S.erp && S.erp.estado !== 'ok') S.erp = null;
        render();
        var alvo = D.querySelector(S.modoCli === 'codigo' ? '[data-k="cliente.codigo"]' : '[data-k="cliente.cnpj"]'); if (alvo) alvo.focus();
        return;
      }
      if (t.hasAttribute('data-buscar-cli')) { buscarCli(t.getAttribute('data-buscar-cli')); return; }
      if (t.id === 'cot-prop-ver') { verProposta(casoDaPrevia()); return; }
      if (t.id === 'cot-previa-abrir') { abrirPrevia(); return; }
      if (t.id === 'cot-previa-ocultar') { ocultarPrevia(true); return; }
      if (t.id === 'cot-previa-mostrar') { ocultarPrevia(false); return; }
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
        C.dialogo('<h3>Recomeçar?</h3><p>O que foi preenchido aqui se perde (nada foi gravado ainda).</p><div class="cs-dlg-pe"><button class="cs-btn" value="x">Continuar aqui</button><button class="cs-btn cs-btn-p" value="ok" id="dlg-ok">Recomeçar</button></div>',
          function () { $('dlg-ok').addEventListener('click', function () { C.fecharDialogo(); recomecar(); }); });
        return;
      }
      if (t.id === 'cot-criar') { criar(); return; }
      if (t.id === 'cot-cod-reconferir') { conferirCodigos(true); return; }
      if (t.id === 'cot-outra') { recomecar(); return; }
      if (t.id === 'cot-add-item') {
        S.dados.itens.push({ codigo: '', codigoCliente: '', descricao: '', marca: '', registro: '', unidade: '', quantidade: 0, valorUnitario: 0 });
        $('cot-itens').innerHTML = htmlItens();
        // 24/11/2026: o foco vai para o Código do produto (o autocomplete); a
        // descrição vazia ganha o nome do cadastro na conferência
        var ins = $('cot-itens').querySelectorAll('tbody tr[data-i] input[data-f="codigo"]'); if (ins.length) ins[ins.length - 1].focus();
        return;
      }
      if (t.hasAttribute('data-usar-ref')) { ev.preventDefault(); var ur = t.getAttribute('data-usar-ref').split('|'); usarRef(Number(ur[0]), ur[1], false); pintarRefs(); return; }
      if (t.hasAttribute('data-tirar')) {
        S.dados.itens.splice(Number(t.getAttribute('data-tirar')), 1);
        if (S.leitura) S.leitura.avisos = (S.leitura.avisos || []).filter(function (a) { return a.item < 0; });
        $('cot-itens').innerHTML = htmlItens(); estoqueDepois();
        return;
      }
    });
    // a prévia da proposta: depois de cada mudança (o debounce espera a pessoa parar)
    ['input', 'change', 'click'].forEach(function (tipo) { corpo.addEventListener(tipo, function () { if (S.passo === 'conf') previaDepois(); }); });
    window.addEventListener('resize', C.debounce(function () { if (S.passo === 'conf' && PV.doc && !PV.oculta) desenharPrevia().catch(function () {}); }, 250));
    corpo.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && ev.target.closest && ev.target.closest('.cot-busca')) {
        var k = ev.target.getAttribute('data-k');
        if (k === 'cliente.codigo' || k === 'cliente.cnpj') { ev.preventDefault(); buscarCli(k === 'cliente.codigo' ? 'codigo' : 'cnpj'); }
      }
    });
  }

  function iniciar() {
    if (!$('cot-corpo')) return;
    ligar();
    render();
    C.aguardarLogin().then(function () {
      // 25/11/2026: as transportadoras do PI (Dynamics) — não seguram a tela
      C.transportadoras().then(function (l) { S.transp = l; repintarTransp(); });
      return C.api('cot-casos');
    }).then(function (j) {
      S.cfg = j.cfg || {}; S.eu = j.eu || null; S.configurado = j.configurado !== false;
      if (S.dados && !S.dados.area && S.eu && S.eu.area) S.dados.area = S.eu.area;
      if (S.dados && !S.dados.unidade) S.dados.unidade = unidadeUnica();
      if (P) P.preCarregar();
      if (P && !P.pronto()) faixa('<b>O gerador da proposta (jsPDF) não carregou.</b> Recarregue a página — sem ele o caso é criado, mas a proposta não sai.', 'alerta');
      if (S.cfg.fases) C.FASES.forEach(function (f) { var s = S.cfg.fases.filter(function (x) { return x.id === f.id; })[0]; if (s) { f.nome = s.nome; f.desc = s.desc || f.desc; } });
      if (!S.configurado) faixa('<b>Armazenamento não configurado.</b> Dá para preencher, mas o caso só é gravado depois que o dono do portal configurar o COT_MSB_BLOB_URL.', 'alerta');
      render();
    }).catch(function (e) {
      if (e.status === 401 || e.status === 403) { S.erroBoot = e.message; render(); return; }
      faixa('<b>Não consegui falar com o servidor.</b> ' + esc(e.message) + ' — tente criar o caso em instantes.', 'erro');
    });
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
