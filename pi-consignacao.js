/* ================================================================
   pi-consignacao.js — PI Consignação NATIVO no portal
   (substitui o agente do Copilot Studio de FATURAMENTO DE CONSIGNADO)

   Fluxo: PDF -> texto (pdf.js) -> /api/pedido-extrair (perfil
   "consignado", Azure OpenAI) -> cabeçalho médico (paciente, convênio,
   médicos, senha...) -> ITENS POR LOTE: o operador informa o LOTE de
   cada material e o portal identifica o PRODUTO no estoque (Dynamics
   F&O, via /api/consig-lote), pedindo em seguida quantidade e preço ->
   revisão -> /api/consig-faturar (flow HTTP do Power Automate).

   Requer na página: msal-browser, auth.js, voz-pbi.js, pdf.js (CDN).
   ================================================================ */
(function () {
  'use strict';

  // ── Listas fixas (do agente do Copilot Studio) ─────────────────
  var COND_PAGAMENTO = [
    '07 DIAS', '10 DIAS', '120 DIAS', '20 DIAS', '28 DIAS', '30 DIAS',
    '30/45 DIAS', '30/45/60 DIAS', '30/45/60/75/90 DIAS', '30/60 DIAS',
    '30/60/90 DIAS', '30/60/90/120 DIAS', '30/60/90/120/150/180 DIAS',
    '45 DIAS', '45/60 DIAS', '50,0% A VISTA + 50,0% 30 DIAS', '60 DIAS',
    '60/90/120 DIAS', '70 DIAS', '75DIAS', '90 DIAS', 'À VISTA',
    'A VISTA /30/60/90 DIAS', 'A VISTA/30 DIAS', 'CR 15 DIAS', 'CR 40 DIAS',
    'CR 50,0% À VISTA 30/60 DIA'
  ];
  var FRETES       = ['CIF - COM VALOR', 'CIF - SEM VALOR', 'FOB - DESTINATARIO'];
  var COND_ENTREGA = ['PADRÃO', 'URGENTE'];
  var TIPOS_VENDA  = ['FATURAMENTO CONSIGNADO'];   // consignação: tipo de venda único
  var AREAS        = ['PEDIDOINTELIGENTE (BIO.ID)', 'PEDIDOINTELIGENTE (VENDA RECORRENTE)', 'PEDIDOINTELIGENTE (VENDA CONSULTIVA)'];
  // Empresa emissora do faturamento (grupo Biomedical): escolhida pelo operador.
  var EMPRESAS     = ['BIO', 'MSB', 'BIO.ID'];
  // Vendedores (mesma lista do PI Pedido) — só aparece em VENDA CONSULTIVA.
  var VENDEDORES = [
    { t: 'ANTONIO SIQUEIRA JARDIM',              v: 'VENDAANTONIO' },
    { t: 'BRUNO MURILLO',                        v: 'VENDBRUNO' },
    { t: 'CAROLINE NAIDON COELHO',               v: 'VENCAROLINE' },
    { t: 'COREPACE',                             v: 'COREPACE' },
    { t: 'DOUGLAS KRUSCINSCKI SILVA',            v: 'VEDOUGLASK' },
    { t: 'FABIO TADEU MARTINS',                  v: 'VENDFABIOT' },
    { t: 'LEONARDO BRAGA IVANOFF',               v: 'LEONARDO BRAGA IVANOFF' },
    { t: 'MARIA AUXILIADORA BITENCOURT MOREIRA', v: 'VEMARIAAUX' },
    { t: 'NIXON LUCIANO DE SOUZA PINTO',         v: 'VENIXON' },
    { t: 'PATRÍCIA DENISE DA SILVA MENDES',      v: 'VENPATRICI' },
    { t: 'SEM COMISSIONAMENTO',                  v: 'VENDSEMCOM' }
  ];

  // ── Estado ──────────────────────────────────────────────────────
  var S = {
    pdf: null,        // { filename, base64 }
    ext: null,        // resultado da extração por IA
    cliente: { cnpj: '', codigo: '', nome: '' },
    cab: null,        // cabeçalho confirmado
    itens: [],        // { lote, codigo, descricaoPdf, produto, quantidade, valorUnitario, disponivel, expDate, dias, categoria, ok }
    avisos: [],       // conferência da leitura do PDF (ver api/shared/pedido-revisar.js)
    biCols: null      // colunas descobertas da tabela Clientes do BI
  };

  // ── Helpers ─────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function parseNum(v) {
    if (typeof v === 'number') return v;
    var s = String(v || '').trim().replace(/\s/g, '');
    if (!s) return NaN;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    return parseFloat(s);
  }
  function fmtMoney(n) { return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function fmtQtd(n) { return (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }); }
  function fmtPreco(n) { return (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }); }
  function bufToB64(buf) {
    var bytes = new Uint8Array(buf), bin = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }
  function getOperador() { return (window._portalUser && window._portalUser.name) || ''; }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  function msg(step, texto, tipo) {
    var el = $('st-' + step + '-msg');
    if (!el) return;
    if (!texto) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'block';
    el.className = 'pi-msg' + (tipo === 'err' ? ' pi-msg-err' : tipo === 'ok' ? ' pi-msg-ok' : '');
    el.innerHTML = (tipo === 'busy' ? '<span class="pi-spin"></span> ' : '') + texto;
  }

  // ── Navegação entre etapas ──────────────────────────────────────
  var STEPS = ['up', 'cli', 'cab', 'itens', 'rev', 'ok'];
  function goStep(id) {
    STEPS.forEach(function (s) { var sec = $('st-' + s); if (sec) sec.hidden = (s !== id); });
    var idx = STEPS.indexOf(id);
    document.querySelectorAll('.pi-step').forEach(function (el) {
      var i = STEPS.indexOf(el.getAttribute('data-st'));
      el.classList.toggle('atual', el.getAttribute('data-st') === id);
      el.classList.toggle('feito', i >= 0 && i < idx);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Etapa 1 · PDF ───────────────────────────────────────────────
  // O "PDF -> texto" vive no pi-pdf-texto.js (fonte única das 5 telas de
  // PI): ele ordena cada linha pelo X e reconstrói as COLUNAS do
  // documento. É isso que impede a IA de ler a coluna errada e trocar
  // QUANTIDADE por VALOR UNITÁRIO.
  async function pdfParaTexto(buf) {
    if (!window.PIPDF) throw new Error('pi-pdf-texto.js não carregou');
    return await PIPDF.texto(buf);
  }

  async function handleFile(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) { msg('up', 'Envie um arquivo <strong>PDF</strong>.', 'err'); return; }
    try {
      msg('up', 'Lendo o PDF…', 'busy');
      var buf = await file.arrayBuffer();
      S.pdf = { filename: file.name, base64: bufToB64(buf) };

      var texto = '';
      try { texto = await pdfParaTexto(buf.slice(0)); } catch (e) { console.warn('[consig] pdf.js:', e); }
      if (!texto || texto.trim().length < 40) {
        msg('up', 'Este PDF parece ser <strong>escaneado</strong> (imagem, sem texto). Use o preenchimento manual — o PDF ainda será anexado ao faturamento.', 'err');
        $('up-btn-manual-mesmo').style.display = 'inline-flex';
        return;
      }

      msg('up', 'Extraindo os dados com IA…', 'busy');
      var r = await fetch('/api/pedido-extrair', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: texto, filename: file.name, perfil: 'consignado' })
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        msg('up', 'Não consegui extrair com IA: ' + esc(j.error || ('HTTP ' + r.status)) +
          '<br>Você pode seguir com o preenchimento manual (o PDF vai anexado mesmo assim).', 'err');
        $('up-btn-manual-mesmo').style.display = 'inline-flex';
        return;
      }

      S.ext = j.dados || {};
      S.avisos = Array.isArray(j.avisos) ? j.avisos : [];
      aplicarExtracao();
      msg('up', '');
      goStep('cli');
      if (S.cliente.cnpj) validarCNPJ();   // valida direto no BI
    } catch (e) {
      console.error('[consig] handleFile:', e);
      msg('up', 'Erro ao processar o PDF: ' + esc(e.message || e), 'err');
    }
  }

  function novoItem() {
    return { lote: '', codigo: '', descricaoPdf: '', produto: '', quantidade: 1, valorUnitario: 0, disponivel: undefined, expDate: null, dias: null, categoria: null, ok: false };
  }

  // ── Conferência da leitura do PDF ───────────────────────────────
  // O backend confere item por item contra o texto do PDF: desfaz a troca
  // de quantidade x valor unitário e aponta o que ficou duvidoso (total
  // que não fecha, número que não deu para ler). Aqui a gente mostra —
  // corrigir na surdina seria pior do que errar na cara do operador.
  function avisosDoItem(i) {
    return (S.avisos || []).filter(function (a) { return a.item === i; });
  }

  function renderAvisos() {
    var el = $('st-itens-avisos');
    if (!el) return;
    var av = S.avisos || [];
    if (!av.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    var corrigidos = av.filter(function (a) { return a.corrigido; }).length;
    el.style.display = 'block';
    el.className = 'pi-msg pi-msg-warn';
    el.innerHTML = '<strong>' +
      (corrigidos ? 'Ajustei ' + corrigidos + (corrigidos > 1 ? ' itens' : ' item') + ' na leitura do PDF — confira:'
                  : 'Confira a leitura do PDF:') + '</strong>' +
      '<ul class="pi-avisos">' + av.map(function (a) {
        return '<li>' + esc(a.texto) + '</li>';
      }).join('') + '</ul>';
  }

  // marca o input como "NAO INFORMADO" (valor + checkbox marcado + desabilita)
  function marcarNaoInformado(inpId, chkId) {
    var inp = $(inpId), chk = chkId ? $(chkId) : null;
    if (inp) { inp.value = 'NAO INFORMADO'; inp.disabled = true; }
    if (chk) chk.checked = true;
  }

  function aplicarExtracao() {
    var e = S.ext || {};
    function set(id, v) { $(id).value = v || ''; }
    // CNPJ vai pra etapa Cliente (validação no BI); o nome vem da validação
    $('cli-cnpj').value = e.cnpj || '';

    set('cb-oc', e.ordemDeCompra); set('cb-endereco', e.enderecoEntrega); set('cb-email', e.email);
    // Condição de Pagamento e Frete NÃO são pré-preenchidos (operador escolhe)
    set('cb-medatend', e.medicoAtendimento); set('cb-medcir', e.medicoCirurgico);
    set('cb-paciente', e.paciente); set('cb-convenio', e.convenio);
    set('cb-datacir', e.dataCirurgia); set('cb-dataatend', e.dataAtendimento);
    set('cb-prontuario', e.prontuario); set('cb-beneficiario', e.beneficiario);
    set('cb-senha', e.senha); set('cb-obs', e.observacao);

    // TUDO QUE NÃO FOI ACHADO -> "NAO INFORMADO". Os campos com botão
    // (OC, E-mail, Data Cirurgia, Data Atendimento) também marcam o checkbox.
    [['cb-oc', 'cb-oc-ni'], ['cb-email', 'cb-email-ni'], ['cb-datacir', 'cb-datacir-ni'], ['cb-dataatend', 'cb-dataatend-ni']]
      .forEach(function (par) { if (!$(par[0]).value.trim()) marcarNaoInformado(par[0], par[1]); });
    ['cb-endereco', 'cb-medatend', 'cb-medcir', 'cb-paciente', 'cb-convenio', 'cb-prontuario', 'cb-beneficiario', 'cb-senha']
      .forEach(function (id) { if (!$(id).value.trim()) $(id).value = 'NAO INFORMADO'; });

    S.itens = (e.produtos || []).map(function (p) {
      return {
        lote: String(p.lote || '').trim(),
        codigo: String(p.codigo || '').trim(),
        descricaoPdf: String(p.descricao || '').trim(),
        produto: '',
        quantidade: Number(p.quantidade) || 0,
        valorUnitario: Number(p.valorUnitario) || 0,
        disponivel: undefined, expDate: null, dias: null, categoria: null, ok: false
      };
    });
    if (!S.itens.length) S.itens.push(novoItem());
  }

  function iniciarManual() { S.ext = null; S.itens = [novoItem()]; goStep('cli'); }

  // ── Etapa 2 · Cliente (CNPJ no BI) ──────────────────────────────
  async function colunasClientes() {
    if (S.biCols) return S.biCols;
    var rows = await VOZPBI.query("EVALUATE TOPN(1, 'Clientes')");
    var cols = rows.length ? Object.keys(rows[0]) : [];
    var cnpj = cols.find(function (c) { return /cnpj/i.test(c); }) ||
               cols.find(function (c) { return /cpf/i.test(c); });
    var cod  = cols.find(function (c) { return norm(c).indexOf('[cod') >= 0; });
    var nome = (cols.indexOf('Clientes[Cliente]') >= 0) ? 'Clientes[Cliente]' :
               cols.find(function (c) { return /cliente|nome|raz/i.test(norm(c)); });
    S.biCols = { cnpj: cnpj || null, cod: cod || null, nome: nome || null, todas: cols };
    return S.biCols;
  }
  function daxRef(key) { var i = key.indexOf('['); return "'" + key.substring(0, i) + "'" + key.substring(i); }

  async function validarCNPJ() {
    var raw = $('cli-cnpj').value.trim();
    var dig = raw.replace(/\D/g, '');
    $('cli-res').style.display = 'none';
    $('cli-continuar').disabled = true;
    if (dig.length !== 14) { msg('cli', 'CNPJ inválido — precisa ter <strong>14 dígitos</strong>.', 'err'); return; }
    try {
      msg('cli', 'Consultando o CNPJ na base…', 'busy');
      await VOZPBI.connect();
      var cols = await colunasClientes();
      if (!cols.cnpj) {
        msg('cli', 'Não encontrei uma coluna de CNPJ na tabela <strong>Clientes</strong> do BI. Avise a TI — sem essa coluna não é possível validar o cliente.', 'err');
        return;
      }
      var ref = daxRef(cols.cnpj), rows;
      try {
        rows = await VOZPBI.query(
          "EVALUATE FILTER('Clientes', SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(" + ref +
          ", \".\", \"\"), \"/\", \"\"), \"-\", \"\"), \" \", \"\") = \"" + dig + "\")");
      } catch (e) {
        var fmt = dig.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
        rows = await VOZPBI.query(
          "EVALUATE FILTER('Clientes', " + ref + " IN {\"" + dig + "\", \"" + fmt + "\", \"" + raw.replace(/"/g, '""') + "\"})");
      }
      if (!rows || !rows.length) {
        msg('cli', '<strong>CNPJ não encontrado</strong> na base de clientes. Confira o número e valide de novo. Se o cliente ainda não estiver cadastrado, faça o cadastro antes de seguir.', 'err');
        return;
      }
      var row = rows[0];
      S.cliente = {
        cnpj: raw,
        codigo: cols.cod ? String(row[cols.cod] == null ? '' : row[cols.cod]) : '',
        nome:   cols.nome ? String(row[cols.nome] == null ? '' : row[cols.nome]) : ''
      };
      msg('cli', '');
      $('cli-res').style.display = 'flex';
      $('cli-res').innerHTML =
        '<div class="pi-cli-ok">✅ Cliente encontrado</div>' +
        '<div><strong>Código:</strong> ' + esc(S.cliente.codigo || '—') + '</div>' +
        '<div><strong>Nome:</strong> ' + esc(S.cliente.nome || '—') + '</div>';
      $('cli-continuar').disabled = false;
    } catch (e) {
      console.error('[consig] validarCNPJ:', e);
      msg('cli', 'Erro ao consultar o BI: ' + esc(e.message || e), 'err');
    }
  }

  // ── Etapa 2 · Cabeçalho ─────────────────────────────────────────
  function popularSelect(id, lista, placeholder) {
    $(id).innerHTML = '<option value="">' + esc(placeholder || 'Selecione…') + '</option>' +
      lista.map(function (o) {
        var t = typeof o === 'string' ? o : o.t;
        var v = typeof o === 'string' ? o : o.v;
        return '<option value="' + esc(v) + '">' + esc(t) + '</option>';
      }).join('');
  }

  function confirmarCabecalho() {
    var obrig = [['cb-empresa', 'Empresa'], ['cb-condpag', 'Condição de Pagamento'], ['cb-frete', 'Frete'], ['cb-condent', 'Condição de Entrega'],
                 ['cb-tipovenda', 'Tipo de Venda'], ['cb-area', 'Área Demandante'], ['cb-operador', 'Operador']];
    var falta = obrig.filter(function (f) { return !$(f[0]).value.trim(); }).map(function (f) { return f[1]; });
    var consultiva = $('cb-area').value === 'PEDIDOINTELIGENTE (VENDA CONSULTIVA)';
    if (consultiva && !$('cb-vendedor').value) falta.push('Vendedor');
    if (falta.length) { msg('cab', 'Preencha: <strong>' + esc(falta.join(', ')) + '</strong>.', 'err'); return; }
    S.cab = {
      empresa: $('cb-empresa').value,
      cnpj: S.cliente.cnpj || 'NAO INFORMADO',
      codCliente: S.cliente.codigo || 'NAO INFORMADO',
      nomeCliente: S.cliente.nome || 'NAO INFORMADO',
      ordemDeCompra: $('cb-oc').value.trim() || 'NAO INFORMADO',
      enderecoEntrega: $('cb-endereco').value.trim() || 'NAO INFORMADO',
      email: $('cb-email').value.trim() || 'NAO INFORMADO',
      condicaoPagamento: $('cb-condpag').value,
      condicaoEntrega: $('cb-condent').value,
      frete: $('cb-frete').value,
      tipoVenda: $('cb-tipovenda').value,
      areaDemandante: $('cb-area').value,
      vendedor: consultiva ? $('cb-vendedor').value : 'NAO INFORMADO',
      medicoAtendimento: $('cb-medatend').value.trim() || 'NAO INFORMADO',
      medicoCirurgico: $('cb-medcir').value.trim() || 'NAO INFORMADO',
      paciente: $('cb-paciente').value.trim() || 'NAO INFORMADO',
      convenio: $('cb-convenio').value.trim() || 'NAO INFORMADO',
      dataCirurgia: $('cb-datacir').value.trim() || 'NAO INFORMADO',
      dataAtendimento: $('cb-dataatend').value.trim() || 'NAO INFORMADO',
      prontuario: $('cb-prontuario').value.trim() || 'NAO INFORMADO',
      beneficiario: $('cb-beneficiario').value.trim() || 'NAO INFORMADO',
      senha: $('cb-senha').value.trim() || 'NAO INFORMADO',
      observacao: $('cb-obs').value.trim() || 'NAO INFORMADO',
      operador: $('cb-operador').value.trim()
    };
    msg('cab', '');
    renderItens();
    goStep('itens');
  }

  // ── Etapa 3 · Itens (LOTE → PRODUTO) ────────────────────────────
  function catInfo(k) {
    var m = {
      vencido:     { l: 'Vencido',                 c: '#b91c1c', b: '#fef2f2' },
      proximo:     { l: 'Próximo do venc. (≤30d)', c: '#dc2626', b: '#fef2f2' },
      muito_curta: { l: 'Muito curta (1–3 meses)', c: '#ea580c', b: '#fff7ed' },
      curta:       { l: 'Curta (≤6 meses)',        c: '#b45309', b: '#fffbeb' },
      normal:      { l: 'Normal (≤1 ano)',         c: '#2c7591', b: '#f0f7fa' },
      boa:         { l: 'Boa (>1 ano)',            c: '#16a34a', b: '#f0fdf4' },
      muito_boa:   { l: 'Muito boa (>2 anos)',     c: '#0d9488', b: '#f0fdfa' },
      sem_data:    { l: 'Sem validade',            c: '#67757d', b: '#f8fafc' }
    };
    return m[k] || m.sem_data;
  }

  function itemTotal(p) { return (Number(p.quantidade) || 0) * (Number(p.valorUnitario) || 0); }
  function totalGeral() { return S.itens.reduce(function (t, p) { return t + itemTotal(p); }, 0); }

  function renderItens() {
    var tb = $('itens-tbody');
    tb.innerHTML = S.itens.map(function (p, i) {
      var status = p.ok
        ? '<span class="pi-prod-ok" title="Lote validado no estoque">✓</span>'
        : (p.produto === null
          ? '<span class="pi-prod-nok" title="Lote não encontrado">✗</span>'
          : '<span class="pi-prod-pend" title="Aguardando validação do lote">•</span>');
      var nomeCell = p.ok
        ? esc(p.produto)
        : (p.produto === null
          ? '<span class="pi-prod-nok">— lote não encontrado —</span>'
          : '<span class="pi-prod-dim">' + esc(p.descricaoPdf || '(valide o lote)') + '</span>');
      var codCell = p.codigo ? esc(p.codigo) : '<span class="pi-prod-dim">—</span>';
      var dispCell;
      if (p.disponivel === undefined) dispCell = '<span class="pi-prod-dim">—</span>';
      else if (p.disponivel === null) dispCell = '<span class="pi-prod-dim" title="Sem retorno do ERP">n/d</span>';
      else dispCell = '<span class="pi-prod-ok">' + fmtQtd(p.disponivel) + '</span>';
      var valCell = '';
      if (p.expDate) {
        var ci = catInfo(p.categoria);
        var val = new Date(p.expDate).toLocaleDateString('pt-BR');
        var dias = (p.dias != null) ? (p.dias < 0 ? ('vencido há ' + (-p.dias) + 'd') : ('faltam ' + p.dias + 'd')) : '';
        valCell = '<div class="pi-lote-dim" style="margin-top:3px;"><span class="pi-cat" style="color:' + ci.c + ';background:' + ci.b + ';">' + esc(ci.l) + '</span> ' + val + ' ' + esc(dias) + '</div>';
      }
      var cls = p.produto === null ? 'pi-row-nok' : (avisosDoItem(i).length ? 'pi-row-warn' : '');
      return '<tr class="' + cls + '">' +
        '<td class="pi-td-st">' + status + '</td>' +
        '<td><input class="pi-in" data-i="' + i + '" data-f="lote" value="' + esc(p.lote) + '" placeholder="Lote"></td>' +
        '<td>' + codCell + '</td>' +
        '<td class="pi-td-nome">' + nomeCell + valCell + '</td>' +
        '<td class="pi-td-disp">' + dispCell + '</td>' +
        '<td><input class="pi-in pi-in-num" data-i="' + i + '" data-f="quantidade" value="' + esc(fmtQtd(p.quantidade)) + '"></td>' +
        '<td><input class="pi-in pi-in-num" data-i="' + i + '" data-f="valorUnitario" value="' + esc(fmtPreco(p.valorUnitario)) + '"></td>' +
        '<td class="pi-td-tot">' + fmtMoney(itemTotal(p)) + '</td>' +
        '<td class="pi-td-x"><button class="pi-x" data-del="' + i + '" title="Remover item">×</button></td>' +
        '</tr>';
    }).join('');
    $('itens-total').textContent = fmtMoney(totalGeral());
    renderAvisos();

    tb.querySelectorAll('input.pi-in').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var i = Number(inp.getAttribute('data-i')), f = inp.getAttribute('data-f');
        // mexeu no item = conferiu: o aviso da leitura do PDF sai de cena
        if (S.avisos && S.avisos.length) {
          S.avisos = S.avisos.filter(function (a) { return a.item !== i; });
          renderAvisos();
          inp.closest('tr').classList.remove('pi-row-warn');
        }
        if (f === 'lote') {
          S.itens[i].lote = inp.value.trim();
          S.itens[i].ok = false; S.itens[i].produto = ''; S.itens[i].codigo = '';
          S.itens[i].disponivel = undefined; S.itens[i].expDate = null; S.itens[i].dias = null; S.itens[i].categoria = null;
        } else {
          var n = parseNum(inp.value);
          S.itens[i][f] = isNaN(n) ? 0 : n;
          var tr = inp.closest('tr');
          tr.querySelector('.pi-td-tot').textContent = fmtMoney(itemTotal(S.itens[i]));
          $('itens-total').textContent = fmtMoney(totalGeral());
        }
      });
    });
    tb.querySelectorAll('button.pi-x').forEach(function (btn) {
      btn.addEventListener('click', function () {
        S.itens.splice(Number(btn.getAttribute('data-del')), 1);
        if (!S.itens.length) S.itens.push(novoItem());
        renderItens();
      });
    });
  }

  // consulta lote -> produto no ERP (via /api/consig-lote)
  async function fetchLotes(lotes) {
    try {
      var r = await fetch('/api/consig-lote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lotes: lotes, cliente: (S.cliente && S.cliente.codigo) || '' })
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) { console.warn('[consig] lote:', j.error); return { configured: false, error: j.error }; }
      return j;
    } catch (e) { console.warn('[consig] lote falhou:', e); return { configured: false, error: (e && e.message) || String(e) }; }
  }

  // busca os NOMES oficiais dos produtos no BI (mesma base do PI Pedido)
  async function nomesPorCodigo(codigos) {
    var out = {};
    var lista = codigos.filter(function (c, i) { return c && codigos.indexOf(c) === i; });
    if (!lista.length) return out;
    try {
      await VOZPBI.connect();
      var inList = lista.map(function (c) { return '"' + String(c).toUpperCase().replace(/"/g, '""') + '"'; }).join(', ');
      var rows = await VOZPBI.query(
        'EVALUATE FILTER(SELECTCOLUMNS(\'Produtos\', "cod", UPPER(\'Produtos\'[Cód. produto]), "nome", \'Produtos\'[Produto]), [cod] IN {' + inList + '})');
      (rows || []).forEach(function (r) { out[String(r['[cod]'])] = String(r['[nome]'] || ''); });
    } catch (e) { console.warn('[consig] nomes BI:', e); }
    return out;
  }

  async function validarItensEContinuar() {
    // validações básicas
    for (var i = 0; i < S.itens.length; i++) {
      var p = S.itens[i];
      if (!p.lote) { msg('itens', 'Item ' + (i + 1) + ': informe o <strong>lote</strong>.', 'err'); return; }
      if (!(Number(p.quantidade) > 0)) { msg('itens', 'Lote <strong>' + esc(p.lote) + '</strong>: quantidade deve ser maior que zero.', 'err'); return; }
      if (!(Number(p.valorUnitario) >= 0)) { msg('itens', 'Lote <strong>' + esc(p.lote) + '</strong>: valor unitário inválido.', 'err'); return; }
    }

    try {
      msg('itens', 'Identificando os produtos pelos lotes no estoque…', 'busy');
      var lotes = S.itens.map(function (p) { return p.lote; });
      var est = await fetchLotes(lotes);
      if (est.configured === false) {
        msg('itens', 'Conexão com o Dynamics ainda não configurada' + (est.error ? ' (' + esc(est.error) + ')' : '') + '. Não é possível identificar os produtos pelos lotes.', 'err');
        return;
      }
      var achados = est.itens || {};

      // aplica itemId + disponível + validade de cada lote
      S.itens.forEach(function (p) {
        var e = achados[p.lote] || achados[String(p.lote).toUpperCase()];
        p.motivo = null;
        if (e && e.itemId) {
          p.codigo = e.itemId;
          p.disponivel = (typeof e.disponivel === 'number') ? e.disponivel : null;
          p.expDate = e.expDate || null; p.dias = (e.dias != null ? e.dias : null); p.categoria = e.categoria || null;
        } else {
          p.codigo = ''; p.produto = null; p.ok = false; p.disponivel = null;
          p.motivo = (e && e.motivo) || 'nao_encontrado';
        }
      });

      // nomes oficiais no BI para os códigos encontrados
      msg('itens', 'Buscando os nomes dos produtos no BI…', 'busy');
      var nomes = await nomesPorCodigo(S.itens.filter(function (p) { return p.codigo; }).map(function (p) { return p.codigo; }));
      S.itens.forEach(function (p) {
        if (!p.codigo) { p.produto = null; p.ok = false; return; }
        var nome = nomes[String(p.codigo).toUpperCase()];
        p.produto = nome || p.descricaoPdf || p.codigo;
        p.ok = true;
      });
      renderItens();

      var foraCli = S.itens.filter(function (p) { return !p.codigo && p.motivo === 'fora_deposito_cliente'; });
      var naoEnc  = S.itens.filter(function (p) { return !p.codigo && p.motivo !== 'fora_deposito_cliente'; });
      if (foraCli.length || naoEnc.length) {
        var partes = [];
        if (foraCli.length) {
          var depTxt = (S.cliente && S.cliente.codigo) ? ' (<strong>' + esc(S.cliente.codigo) + '.CD</strong>)' : '';
          partes.push('<strong>' + foraCli.length + ' lote(s)</strong> não estão no depósito de consignação do cliente' + depTxt +
            ': ' + foraCli.map(function (p) { return esc(p.lote); }).join(', ') +
            '. Confira se o <strong>lote</strong> e o <strong>cliente</strong> estão corretos.');
        }
        if (naoEnc.length) {
          partes.push('<strong>' + naoEnc.length + ' lote(s)</strong> não encontrado(s) no estoque: ' +
            naoEnc.map(function (p) { return esc(p.lote); }).join(', ') + '.');
        }
        msg('itens', partes.join('<br>') + '<br>Linhas em vermelho — corrija e valide de novo.', 'err');
        return;
      }
      msg('itens', '');
      renderRevisao();
      goStep('rev');
    } catch (e) {
      console.error('[consig] validarItens:', e);
      msg('itens', 'Erro ao validar os lotes: ' + esc(e.message || e), 'err');
    }
  }

  // ── Etapa 4 · Revisão e envio ───────────────────────────────────
  function renderRevisao() {
    var c = S.cab;
    var linhas = [
      ['Empresa', c.empresa],
      ['CNPJ', c.cnpj], ['Código do Cliente', c.codCliente], ['Cliente', c.nomeCliente], ['Ordem de Compra', c.ordemDeCompra],
      ['Endereço de Entrega', c.enderecoEntrega], ['E-mail', c.email],
      ['Cond. Pagamento', c.condicaoPagamento], ['Frete', c.frete], ['Cond. Entrega', c.condicaoEntrega],
      ['Tipo de Venda', c.tipoVenda], ['Área Demandante', c.areaDemandante], ['Vendedor', c.vendedor],
      ['Médico Atendimento', c.medicoAtendimento], ['Médico Cirúrgico', c.medicoCirurgico],
      ['Paciente', c.paciente], ['Convênio', c.convenio],
      ['Data Cirurgia', c.dataCirurgia], ['Data Atendimento', c.dataAtendimento],
      ['Prontuário', c.prontuario], ['Beneficiário', c.beneficiario], ['Senha', c.senha],
      ['Observação', c.observacao || '—'], ['Operador', c.operador],
      ['PDF anexado', S.pdf ? S.pdf.filename : '(sem PDF — manual)']
    ];
    $('rev-cab').innerHTML = linhas.map(function (l) {
      return '<div class="pi-rev-item"><span>' + esc(l[0]) + '</span><strong>' + esc(l[1]) + '</strong></div>';
    }).join('');

    $('rev-itens').innerHTML = S.itens.map(function (p) {
      var valTxt = p.expDate ? '<div class="pi-lote-dim">val. ' + new Date(p.expDate).toLocaleDateString('pt-BR') + '</div>' : '';
      return '<tr><td>' + esc(p.lote) + valTxt + '</td><td>' + esc(p.codigo) + '</td><td>' + esc(p.produto) + '</td>' +
        '<td class="pi-num">' + fmtQtd(p.quantidade) + '</td>' +
        '<td class="pi-num">' + fmtMoney(p.valorUnitario) + '</td>' +
        '<td class="pi-num">' + fmtMoney(itemTotal(p)) + '</td></tr>';
    }).join('');
    $('rev-total').textContent = fmtMoney(totalGeral());
  }

  function montarResumo() {
    var c = S.cab, out = [];
    out.push('FATURAMENTO DE CONSIGNADO — OC ' + (c.ordemDeCompra || 'N/D'));
    out.push('Empresa: ' + (c.empresa || 'N/D'));
    out.push('Cliente: ' + c.nomeCliente + ' — CNPJ ' + c.cnpj);
    out.push('Paciente: ' + c.paciente + ' | Convênio: ' + c.convenio + ' | Senha: ' + c.senha);
    out.push('Médico atendimento: ' + c.medicoAtendimento + ' | Cirúrgico: ' + c.medicoCirurgico);
    out.push('Cirurgia: ' + c.dataCirurgia + ' | Atendimento: ' + c.dataAtendimento + ' | Prontuário: ' + c.prontuario + ' | Beneficiário: ' + c.beneficiario);
    out.push('Cond. Pagamento: ' + c.condicaoPagamento + ' | Frete: ' + c.frete + ' | Entrega: ' + c.condicaoEntrega);
    out.push('Tipo de Venda: ' + c.tipoVenda + ' | Área: ' + c.areaDemandante + ' | Vendedor: ' + c.vendedor);
    out.push('');
    out.push('MATERIAIS (por lote):');
    S.itens.forEach(function (p, ix) {
      out.push((ix + 1) + '. Lote ' + p.lote + ' — ' + p.codigo + ' ' + p.produto +
        ' | Qtd: ' + fmtQtd(p.quantidade) + ' | Vl. Unit: ' + fmtMoney(p.valorUnitario) + ' | Total: ' + fmtMoney(itemTotal(p)) +
        (p.expDate ? ' | Val.: ' + new Date(p.expDate).toLocaleDateString('pt-BR') : ''));
    });
    out.push('');
    out.push('TOTAL GERAL: ' + fmtMoney(totalGeral()));
    out.push('Operador: ' + c.operador);
    return out.join('\n');
  }

  // ── Upload do PDF no SharePoint (Graph, token do usuário) ───────
  var SP_HOST = 'tibiomedical.sharepoint.com';
  var SP_PATH = '/sites/EquipeIntelignciaeDados';
  var SP_FOLDER = 'Ordens de Compra PDF';
  var SP_SCOPE = 'https://graph.microsoft.com/Sites.ReadWrite.All';
  var _spSiteId = null;

  async function spToken() {
    var inst = window._msalAuth;
    if (!inst) throw new Error('login não está pronto');
    var acct = (inst.getActiveAccount && inst.getActiveAccount()) || (inst.getAllAccounts && inst.getAllAccounts()[0]);
    try { var r = await inst.acquireTokenSilent({ scopes: [SP_SCOPE], account: acct }); return r.accessToken; }
    catch (e) { var r2 = await inst.acquireTokenPopup({ scopes: [SP_SCOPE], account: acct }); return r2.accessToken; }
  }
  async function spResolveSite(tok) {
    if (_spSiteId) return _spSiteId;
    var r = await fetch('https://graph.microsoft.com/v1.0/sites/' + SP_HOST + ':' + SP_PATH, { headers: { Authorization: 'Bearer ' + tok } });
    if (!r.ok) throw new Error('site ' + r.status + ': ' + (await r.text()).slice(0, 150));
    _spSiteId = (await r.json()).id;
    return _spSiteId;
  }
  async function uploadPdfSharePoint() {
    if (!S.pdf) return null;
    var tok = await spToken();
    var siteId = await spResolveSite(tok);
    var bin = atob(S.pdf.base64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var url = 'https://graph.microsoft.com/v1.0/sites/' + siteId + '/drive/root:/' +
      encodeURIComponent(SP_FOLDER) + '/' + encodeURIComponent(S.pdf.filename) +
      ':/content?@microsoft.graph.conflictBehavior=rename';
    var r = await fetch(url, { method: 'PUT', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/pdf' }, body: bytes });
    if (!r.ok) throw new Error('upload ' + r.status + ': ' + (await r.text()).slice(0, 150));
    var item = await r.json();
    var sp = { id: item.id, name: item.name, webUrl: item.webUrl || '', listItemId: null, pathSite: '', pathLib: '' };
    try {
      var g = await fetch('https://graph.microsoft.com/v1.0/sites/' + siteId + '/drive/items/' + item.id + '?$select=id,name,webUrl,sharepointIds', { headers: { Authorization: 'Bearer ' + tok } });
      if (g.ok) { var gj = await g.json(); sp.listItemId = (gj.sharepointIds && gj.sharepointIds.listItemId) || null; sp.webUrl = gj.webUrl || sp.webUrl; }
    } catch (e) {}
    try {
      var full = decodeURIComponent(new URL(sp.webUrl).pathname);
      sp.pathSite = full.replace(SP_PATH, '') || full;
    } catch (e) { sp.pathSite = '/Shared Documents/' + SP_FOLDER + '/' + (sp.name || S.pdf.filename); }
    sp.pathLib = '/' + SP_FOLDER + '/' + (sp.name || S.pdf.filename);
    return sp;
  }

  async function enviar() {
    var btn = $('rev-enviar');
    btn.disabled = true;
    try {
      var sp = null;
      if (S.pdf) {
        try { msg('rev', 'Salvando o PDF no SharePoint…', 'busy'); sp = await uploadPdfSharePoint(); }
        catch (e) {
          console.error('[consig] sharepoint:', e);
          msg('rev', 'Falha ao salvar o PDF no SharePoint: ' + esc(e.message || e) + ' — o faturamento NÃO foi enviado.', 'err');
          btn.disabled = false; return;
        }
      }

      msg('rev', 'Enviando o faturamento…', 'busy');
      var payload = {
        cabecalho: S.cab,
        itens: S.itens.map(function (p) {
          return {
            lote: p.lote, codigo: p.codigo, produto: p.produto,
            quantidade: Number(p.quantidade) || 0,
            valorUnitario: Number(p.valorUnitario) || 0,
            total: itemTotal(p),
            expDate: p.expDate || null
          };
        }),
        totalGeral: totalGeral(),
        resumo: montarResumo(),
        sharepoint: sp
      };
      var r = await fetch('/api/consig-faturar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        msg('rev', 'Falha no envio: ' + esc(j.error || ('HTTP ' + r.status)) + (j.details ? '<br><small>' + esc(j.details) + '</small>' : ''), 'err');
        btn.disabled = false; return;
      }
      msg('rev', '');
      goStep('ok');
    } catch (e) {
      console.error('[consig] enviar:', e);
      msg('rev', 'Erro ao enviar: ' + esc(e.message || e), 'err');
      btn.disabled = false;
    }
  }

  // ── Bootstrap ───────────────────────────────────────────────────
  function init() {
    popularSelect('cb-empresa', EMPRESAS, 'Escolha a empresa');
    popularSelect('cb-condpag', COND_PAGAMENTO, 'Escolha a condição de pagamento');
    popularSelect('cb-frete', FRETES, 'Escolha o frete');
    popularSelect('cb-condent', COND_ENTREGA, 'Escolha a condição de entrega');
    popularSelect('cb-area', AREAS, 'Escolha a área demandante');
    popularSelect('cb-vendedor', VENDEDORES, 'Escolha o vendedor');
    // Tipo de Venda é ÚNICO ("FATURAMENTO CONSIGNADO") — sem placeholder, fixo
    $('cb-tipovenda').innerHTML = '<option value="FATURAMENTO CONSIGNADO">FATURAMENTO CONSIGNADO</option>';
    $('cb-tipovenda').value = 'FATURAMENTO CONSIGNADO';

    var tent = 0, timer = setInterval(function () {
      var op = getOperador();
      if (op && !$('cb-operador').value) $('cb-operador').value = op;
      if (op || ++tent > 40) clearInterval(timer);
    }, 500);

    // checkbox "Não informado" (OC, E-mail, Data Cirurgia, Data Atendimento)
    function bindNaoInformado(chkId, inpId) {
      var chk = $(chkId), inp = $(inpId);
      if (!chk || !inp) return;
      chk.addEventListener('change', function () {
        if (chk.checked) { inp.value = 'NAO INFORMADO'; inp.disabled = true; }
        else { if (inp.value === 'NAO INFORMADO') inp.value = ''; inp.disabled = false; inp.focus(); }
      });
    }
    bindNaoInformado('cb-oc-ni', 'cb-oc');
    bindNaoInformado('cb-email-ni', 'cb-email');
    bindNaoInformado('cb-datacir-ni', 'cb-datacir');
    bindNaoInformado('cb-dataatend-ni', 'cb-dataatend');

    // vendedor só aparece em VENDA CONSULTIVA (mesma lógica do PI Pedido)
    $('cb-area').addEventListener('change', function () {
      $('cb-vendedor-wrap').style.display =
        (this.value === 'PEDIDOINTELIGENTE (VENDA CONSULTIVA)') ? 'block' : 'none';
    });

    // upload
    var dz = $('up-drop'), fi = $('up-file');
    dz.addEventListener('click', function () { fi.click(); });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('drag'); });
    dz.addEventListener('drop', function (e) { e.preventDefault(); dz.classList.remove('drag'); handleFile(e.dataTransfer.files && e.dataTransfer.files[0]); });
    fi.addEventListener('change', function () { handleFile(fi.files && fi.files[0]); fi.value = ''; });
    $('up-btn-manual').addEventListener('click', iniciarManual);
    $('up-btn-manual-mesmo').addEventListener('click', function () { S.ext = null; S.itens = [novoItem()]; goStep('cli'); });

    // cliente (CNPJ)
    $('cli-validar').addEventListener('click', validarCNPJ);
    $('cli-cnpj').addEventListener('keydown', function (e) { if (e.key === 'Enter') validarCNPJ(); });
    $('cli-voltar').addEventListener('click', function () { goStep('up'); });
    $('cli-continuar').addEventListener('click', function () {
      $('cb-cliente-info').textContent = (S.cliente.nome || '—') + (S.cliente.codigo ? ' (' + S.cliente.codigo + ')' : '') + (S.cliente.cnpj ? ' · ' + S.cliente.cnpj : '');
      goStep('cab');
    });

    // navegação / ações
    $('cab-voltar').addEventListener('click', function () { goStep('cli'); });
    $('cab-continuar').addEventListener('click', confirmarCabecalho);
    $('itens-add').addEventListener('click', function () { S.itens.push(novoItem()); renderItens(); });
    $('itens-voltar').addEventListener('click', function () { goStep('cab'); });
    $('itens-continuar').addEventListener('click', validarItensEContinuar);
    $('rev-voltar').addEventListener('click', function () { goStep('itens'); });
    $('rev-enviar').addEventListener('click', enviar);
    $('ok-novo').addEventListener('click', function () { window.location.reload(); });

    goStep('up');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
