/* ================================================================
   pedido-inteligente.js — Pedido Inteligente NATIVO no portal
   (substitui o agente do Copilot Studio)

   Fluxo: PDF -> texto (pdf.js no navegador) -> /api/pedido-extrair
   (Azure OpenAI, structured output) -> validação de CNPJ e produtos
   direto no BI Comercial (VOZPBI, token do usuário — RLS/PPU ok) ->
   revisão -> /api/pedido-enviar (flow HTTP do Power Automate).

   Requer na página: msal-browser, auth.js, voz-pbi.js, pdf.js (CDN).
   ================================================================ */
(function () {
  'use strict';

  // ── Listas fixas (idênticas às do agente do Copilot Studio) ────
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
  var TIPOS_VENDA  = ['VENDA DIRETA', 'REMESSA EM CONSIGNAÇÃO - PERMANENTE', 'REMESSA EM CONSIGNAÇÃO - TEMPORÁRIA'];
  var AREAS        = ['PEDIDOINTELIGENTE (BIO.ID)', 'PEDIDOINTELIGENTE (VENDA RECORRENTE)', 'PEDIDOINTELIGENTE (VENDA CONSULTIVA)'];
  var PORTAIS      = ['APOIO COTACOES', 'BIONEXO', 'GTPLAN', 'NAO INFORMADO', 'SINTESE',
                      'SMART COMPRAS', 'UNIUBE', 'VSSUPPLY -STA CATARINA', 'VSSUPPLY -STA CATARINA/MSB'];
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
  // Empresa emissora do pedido (grupo Biomedical): escolhida pelo operador.
  var EMPRESAS = ['BIO', 'MSB', 'BIO.ID'];

  // ── Estado ──────────────────────────────────────────────────────
  var S = {
    pdf: null,        // { filename, base64 }
    ext: null,        // resultado da extração por IA
    cliente: { cnpj: '', codigo: '', nome: '', tipo: '' },
    cab: null,        // cabeçalho confirmado
    produtos: [],     // { codigo, descricaoPdf, produto, quantidade, valorUnitario, ok }
    avisos: [],       // conferencia da leitura do PDF (ver api/shared/pedido-revisar.js)
    biCols: null      // colunas descobertas da tabela Clientes do BI
  };

  // ── Customer Service -> PI (pedido-inteligente.html?cs=CS-AAAA-NNNNNN) ──
  // O caso de pedido do Customer Service (Comercial) entrega o PDF que veio
  // no e-mail — e, quando já leu, a extração — por customer-service-pi.js.
  // Aqui o PI só consome: pula o upload, preenche "Caso" e o e-mail do
  // contato e, ao enviar, registra no caso que o pedido foi para o Dynamics.
  // O módulo COTAÇÕES usa a mesma ponte (?cot=COT-AAAA-NNNNNN): a cotação
  // que virou pedido entrega o PDF do pedido do portal, e o PI já chega com
  // portal, área demandante e empresa da cotação; ao enviar, registra na
  // cotação (/api/cot-casos) em vez do caso do Customer Service.
  // Sem ?cs= nem ?cot= na URL, nada disto roda.
  var CS = null;
  // de onde veio o pedido: o caso do Customer Service ou a cotação
  var ORIGENS_PI = {
    cs:  { api: '/api/cs-casos',  volta: 'atendimento-casos.html',  rotulo: 'do caso', modulo: 'Customer Service', icone: '📨' },
    cot: { api: '/api/cot-casos', volta: 'comercial-cot-casos.html', rotulo: 'da cotação', modulo: 'Cotações', icone: '🧾' }
  };
  function origemPI() { return ORIGENS_PI[(CS && CS.origemPI) || 'cs']; }

  // ── Helpers ─────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  // STENT FARMACOLOGICO não passa por seleção de lote (vai direto pra revisão).
  // Testa qualquer texto (família OU nome do produto): a família nem sempre chega
  // do BI — a query com RELATED('Famílias'[Família]) pode cair no fallback sem
  // família —, então o nome do produto é a rede de segurança para a detecção.
  function isStentFam(txt) { return norm(txt).indexOf('stent farmacologico') >= 0; }
  // EXCEÇÃO TEMPORÁRIA (07/10/2026): famílias que o PI NÃO deixa pedir por
  // enquanto quando o cliente é DISTRIBUIDOR (Clientes[Tipo de cliente
  // (Revisado)] no BI). Órgão público e privado seguem normalmente. O código
  // valida no BI, mas a linha fica vermelha e o pedido não passa da etapa
  // Produtos (nem é enviado). Para liberar, tirar a família da lista. Compara
  // pela família do BI — a da validação (RELATED) ou a de 'Produtos'[Família]
  // (carregarFamiliaBloqueio) — e basta ter todas as palavras da família
  // ("CATETER SONICO" casa "CATETER IVL SONICO"). Sem família de nenhuma das
  // duas fontes, o nome do produto é a rede de segurança.
  var FAMILIAS_BLOQUEADAS = ['CATETER SONICO'];
  function normFam(s) { return norm(s).replace(/[^a-z0-9]+/g, ' ').trim(); }
  function temPalavras(txt, alvo) {
    var t = ' ' + normFam(txt) + ' ';
    return normFam(alvo).split(' ').every(function (w) { return t.indexOf(' ' + w + ' ') >= 0; });
  }
  function clienteDistribuidor() { return /^distribuidor/.test(normFam(S.cliente && S.cliente.tipo)); }
  function familiaBloqueada(p) {
    if (!p || !p.ok || !clienteDistribuidor()) return '';
    var fams = [p.familia, p.familiaProd].filter(function (f) { return normFam(f); });
    for (var k = 0; k < FAMILIAS_BLOQUEADAS.length; k++) {
      var b = FAMILIAS_BLOQUEADAS[k];
      var casa = fams.length ? fams.some(function (f) { return temPalavras(f, b); }) : temPalavras(p.produto, b);
      if (casa) return b;
    }
    return '';
  }
  function msgFamiliaBloqueada(bloq) {
    var fams = bloq.map(familiaBloqueada).filter(function (f, i, a) { return a.indexOf(f) === i; });
    return '<strong>Pedido bloqueado.</strong> Produtos da família <strong>' + fams.map(esc).join(', ') +
      '</strong> não podem ser pedidos pelo PI para cliente <strong>DISTRIBUIDOR</strong> por enquanto: ' +
      bloq.map(function (p) { return '<strong>' + esc(p.codigo) + '</strong>'; }).join(', ') +
      '. Retire ' + (bloq.length > 1 ? 'esses itens' : 'esse item') + ' para seguir com o pedido.';
  }
  // normaliza CÓDIGO de produto p/ comparação tolerante: remove caracteres
  // invisíveis (zero-width/BOM), troca NBSP por espaço, uniformiza variações de
  // traço, colapsa espaços, TRIM e caixa alta. Usado SÓ no fallback de validação
  // de produto — NÃO participa do match exato que já funciona.
  function normCod(s) {
    return String(s == null ? '' : s)
      .replace(/[\u200B-\u200D\uFEFF]/g, '')  // zero-width / BOM
      .replace(/\u00A0/g, ' ')                // NBSP -> espaço
      .replace(/[\u2010-\u2015\u2212]/g, '-') // variações de traço -> hífen
      .replace(/\s+/g, ' ')                   // colapsa espaços
      .trim()
      .toUpperCase();
  }
  function parseNum(v) {
    if (typeof v === 'number') return v;
    var s = String(v || '').trim().replace(/\s/g, '');
    if (!s) return NaN;
    // formato brasileiro: 1.234,56 -> 1234.56 ; mas 1.91 (ponto decimal) fica 1.91
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    return parseFloat(s);
  }
  function fmtMoney(n) {
    return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  function fmtQtd(n) {
    return (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  }
  function fmtData(iso) { // "2026-09-30" -> "30/09/2026"
    var d = String(iso || '').split('-');
    return (d.length === 3) ? (d[2] + '/' + d[1] + '/' + d[0]) : String(iso || '');
  }
  function bufToB64(buf) {
    var bytes = new Uint8Array(buf), bin = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }
  function getOperador() {
    return (window._portalUser && window._portalUser.name) || '';
  }

  // mensagens de status por etapa (id do div = st-<etapa>-msg)
  function msg(step, texto, tipo) { // tipo: err | ok | busy | '' (limpa)
    var el = $('st-' + step + '-msg');
    if (!el) return;
    if (!texto) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'block';
    el.className = 'pi-msg' + (tipo === 'err' ? ' pi-msg-err' : tipo === 'ok' ? ' pi-msg-ok' : '');
    el.innerHTML = (tipo === 'busy' ? '<span class="pi-spin"></span> ' : '') + texto;
  }

  // ── Navegação entre etapas ──────────────────────────────────────
  var STEPS = ['up', 'cli', 'cab', 'prod', 'lotes', 'rev', 'ok'];
  function goStep(id) {
    STEPS.forEach(function (s) {
      var sec = $('st-' + s);
      if (sec) sec.hidden = (s !== id);
    });
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
      try { texto = await pdfParaTexto(buf.slice(0)); } catch (e) { console.warn('[pedido] pdf.js:', e); }
      if (!texto || texto.trim().length < 40) {
        msg('up', 'Este PDF parece ser <strong>escaneado</strong> (imagem, sem texto). Por enquanto, use o preenchimento manual — o PDF ainda será anexado ao pedido.', 'err');
        $('up-btn-manual-mesmo').style.display = 'inline-flex';
        return;
      }

      msg('up', 'Extraindo os dados com IA…', 'busy');
      var r = await fetch('/api/pedido-extrair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: texto, filename: file.name })
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
      msg('up', '');
      aplicarExtracao();
      goStep('cli');
      if (S.cliente.cnpj) validarCNPJ(); // já valida direto no BI
    } catch (e) {
      console.error('[pedido] handleFile:', e);
      msg('up', 'Erro ao processar o PDF: ' + esc(e.message || e), 'err');
    }
  }

  function aplicarExtracao() {
    var ext = S.ext || {};
    S.cliente = { cnpj: ext.cnpj || '', codigo: '', nome: '', tipo: '' };
    $('cli-cnpj').value = S.cliente.cnpj;

    S.produtos = (ext.produtos || []).map(function (p) {
      return {
        codigo: String(p.codigo || '').trim(),
        descricaoPdf: String(p.descricao || '').trim(),
        produto: '',
        quantidade: Number(p.quantidade) || 0,
        valorUnitario: Number(p.valorUnitario) || 0,
        ok: false
      };
    });
    if (!S.produtos.length) S.produtos.push(novoProduto());

    // pré-preenche o cabeçalho
    $('cab-oc').value       = ext.ordemDeCompra || '';
    $('cab-endereco').value = ext.enderecoEntrega || '';
    $('cab-email').value    = ext.email || '';
    $('cab-obs').value      = ext.observacao || '';
    // Condição de Pagamento e Frete NÃO são pré-preenchidos — o operador
    // escolhe manualmente. Se o PDF trouxe a condição, a dica fica EMBAIXO do
    // próprio campo (e não some quando a etapa mostra "Preencha: …").
    dicaCondPag(ext.condicaoPagamento);
  }

  function dicaCondPag(txt) {
    var d = $('cab-condpag-dica');
    if (!d) return;
    txt = String(txt || '').trim();
    d.innerHTML = txt ? 'Condição de pagamento no PDF: <strong>' + esc(txt) + '</strong> — selecione a opção correspondente.' : '';
    d.hidden = !txt;
  }

  function iniciarManual() {
    S.ext = null;
    dicaCondPag('');
    S.avisos = [];
    S.produtos = [novoProduto()];
    goStep('cli');
  }

  // ── Etapa 2 · Cliente (CNPJ no BI) ──────────────────────────────
  async function colunasClientes() {
    if (S.biCols) return S.biCols;
    var rows = await VOZPBI.query("EVALUATE TOPN(1, 'Clientes')");
    var cols = rows.length ? Object.keys(rows[0]) : [];
    console.log('[pedido] colunas de Clientes no BI:', cols);
    var cnpj = cols.find(function (c) { return /cnpj/i.test(c); }) ||
               cols.find(function (c) { return /cpf/i.test(c); });
    var cod  = cols.find(function (c) { return norm(c).indexOf('[cod') >= 0; });
    var nome = (cols.indexOf('Clientes[Cliente]') >= 0) ? 'Clientes[Cliente]' :
               cols.find(function (c) { return /cliente|nome|raz/i.test(norm(c)); });
    var tipo = (cols.indexOf('Clientes[Tipo de cliente (Revisado)]') >= 0) ? 'Clientes[Tipo de cliente (Revisado)]' :
               cols.find(function (c) { return norm(c).indexOf('tipo de cliente') >= 0; });
    var tipo2 = cols.find(function (c) { return c !== tipo && norm(c).indexOf('tipo de cliente') >= 0; });
    S.biCols = { cnpj: cnpj || null, cod: cod || null, nome: nome || null, tipo: tipo || null, tipo2: tipo2 || null, todas: cols };
    return S.biCols;
  }
  function daxRef(key) { // "Clientes[CNPJ]" -> 'Clientes'[CNPJ]
    var i = key.indexOf('[');
    return "'" + key.substring(0, i) + "'" + key.substring(i);
  }

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
        msg('cli', 'Não encontrei uma coluna de CNPJ na tabela <strong>Clientes</strong> do BI (colunas: ' +
          esc(cols.todas.join(', ')) + '). Avise a TI — sem essa coluna não é possível validar o cliente.', 'err');
        return;
      }

      var ref = daxRef(cols.cnpj), rows;
      try {
        rows = await VOZPBI.query(
          "EVALUATE FILTER('Clientes', SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(" + ref +
          ", \".\", \"\"), \"/\", \"\"), \"-\", \"\"), \" \", \"\") = \"" + dig + "\")");
      } catch (e) {
        // fallback: coluna pode não ser texto — tenta igualdade com os formatos usuais
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
        nome:   cols.nome ? String(row[cols.nome] == null ? '' : row[cols.nome]) : '',
        // Revisado primeiro; vazio, cai no "Tipo de cliente" original
        tipo:   [cols.tipo, cols.tipo2].map(function (c) { return c && row[c] != null ? String(row[c]).trim() : ''; })
                  .filter(Boolean)[0] || ''
      };
      console.info('[pedido] tipo do cliente:', S.cliente.tipo || '(vazio)', '— colunas:', cols.tipo, cols.tipo2);
      msg('cli', '');
      $('cli-res').style.display = 'block';
      $('cli-res').innerHTML =
        '<div class="pi-cli-ok">✅ Cliente encontrado</div>' +
        '<div><strong>Código:</strong> ' + esc(S.cliente.codigo || '—') + '</div>' +
        '<div><strong>Nome:</strong> ' + esc(S.cliente.nome || '—') + '</div>' +
        (cols.tipo ? '<div><strong>Tipo:</strong> ' + esc(S.cliente.tipo || '—') + '</div>' : '');
      $('cli-continuar').disabled = false;
    } catch (e) {
      console.error('[pedido] validarCNPJ:', e);
      msg('cli', 'Erro ao consultar o BI: ' + esc(e.message || e), 'err');
    }
  }

  // ── Etapa 3 · Cabeçalho ─────────────────────────────────────────
  function popularSelect(id, lista, placeholder) {
    var sel = $(id);
    sel.innerHTML = '<option value="">' + esc(placeholder || 'Selecione…') + '</option>' +
      lista.map(function (o) {
        var t = typeof o === 'string' ? o : o.t;
        var v = typeof o === 'string' ? o : o.v;
        return '<option value="' + esc(v) + '">' + esc(t) + '</option>';
      }).join('');
  }

  function confirmarCabecalho() {
    // flag "Data de Vencimento do Pagamento": ligada, o operador informa a DATA e
    // não escolhe condição de pagamento (que vai VAZIA no JSON do flow).
    var usaVenc = $('cab-venc-flag').checked;
    var obrig = [
      ['cab-empresa',   'Empresa'],
      ['cab-condpag',   'Condição de Pagamento'],
      ['cab-frete',     'Frete'],
      ['cab-condent',   'Condição de Entrega'],
      ['cab-tipovenda', 'Tipo de Venda'],
      ['cab-area',      'Área Demandante'],
      ['cab-portal',    'Portal'],
      ['cab-operador',  'Operador']
    ];
    if (usaVenc) obrig[1] = ['cab-venc', 'Data de Vencimento do Pagamento'];
    var faltando = obrig.filter(function (f) { return !$(f[0]).value.trim(); }).map(function (f) { return f[1]; });
    var consultiva = $('cab-area').value === 'PEDIDOINTELIGENTE (VENDA CONSULTIVA)';
    if (consultiva && !$('cab-vendedor').value) faltando.push('Vendedor');
    if (faltando.length) { msg('cab', 'Preencha: <strong>' + esc(faltando.join(', ')) + '</strong>.', 'err'); return; }

    S.cab = {
      empresa:         $('cab-empresa').value,
      cnpj:            S.cliente.cnpj,
      codCliente:      S.cliente.codigo,
      nomeCliente:     S.cliente.nome,
      ordemDeCompra:   $('cab-oc').value.trim() || 'NAO INFORMADO',
      enderecoEntrega: $('cab-endereco').value.trim() || 'NAO INFORMADO',
      email:           $('cab-email').value.trim() || 'NAO INFORMADO',
      condicaoPagamento: usaVenc ? '' : $('cab-condpag').value,
      dataVencimento:    usaVenc ? $('cab-venc').value : '',
      usaDataVencimento: usaVenc,
      pagamentoAntecipado: $('cab-pagant').checked,
      frete:           $('cab-frete').value,
      condicaoEntrega: $('cab-condent').value,
      tipoVenda:       $('cab-tipovenda').value,
      areaDemandante:  $('cab-area').value,
      vendedor:        consultiva ? $('cab-vendedor').value : 'NAO INFORMADO',
      caso:            $('cab-caso').value.trim() || 'N/D',
      portal:          $('cab-portal').value,
      observacao:      $('cab-obs').value.trim(),
      observacaoNota:  $('cab-obsnota').value.trim(), // vazia = o flow não cria a nota
      operador:        $('cab-operador').value.trim()
    };
    msg('cab', '');
    renderProdutos();
    goStep('prod');
  }

  // ── Etapa 4 · Produtos ──────────────────────────────────────────
  function novoProduto() {
    return { codigo: '', descricaoPdf: '', produto: '', familia: '', stent: false, quantidade: 1, valorUnitario: 0, ok: false, lotes: [], lotesSelecionados: [], semLoteQtd: 0, semLotePreco: 0 };
  }

  // ── Conferência da leitura do PDF ─────────────────────
  // O backend confere item por item contra o texto do PDF: desfaz a troca
  // de quantidade x valor unitário e aponta o que ficou duvidoso (total
  // que não fecha, número que não deu para ler). Aqui a gente mostra —
  // corrigir na surdina seria pior do que errar na cara do operador.
  function avisosDoItem(i) {
    return (S.avisos || []).filter(function (a) { return a.item === i; });
  }

  function renderAvisos() {
    var el = $('st-prod-avisos');
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

  function renderProdutos() {
    var tb = $('prod-tbody');
    tb.innerHTML = S.produtos.map(function (p, i) {
      var famBloq = familiaBloqueada(p);
      var status = famBloq
        ? '<span class="pi-prod-nok" title="Família bloqueada para distribuidor">✗</span>'
        : p.ok
        ? '<span class="pi-prod-ok" title="Código validado no BI">✓</span>'
        : (p.produto === null
          ? '<span class="pi-prod-nok" title="Não encontrado">✗</span>'
          : '<span class="pi-prod-pend" title="Aguardando validação">•</span>');
      var nomeCell = p.ok
        ? esc(p.produto) + (famBloq ? '<br><span class="pi-prod-nok">Família ' + esc(famBloq) + ' — bloqueada para DISTRIBUIDOR</span>' : '')
        : (p.produto === null
          ? '<span class="pi-prod-nok">— não encontrado —</span>'
          : '<span class="pi-prod-dim">' + esc(p.descricaoPdf || '(valide para buscar o nome)') + '</span>');
      // coluna Disponível (estoque do ERP): undefined=não checado, null=n/d, número=saldo
      var dispCell;
      if (p.disponivel === undefined) dispCell = '<span class="pi-prod-dim">—</span>';
      else if (p.disponivel === null) dispCell = '<span class="pi-prod-dim" title="Sem retorno do ERP">n/d</span>';
      else {
        var falta = Number(p.quantidade) > p.disponivel;
        dispCell = '<span class="' + (falta ? 'pi-prod-nok' : 'pi-prod-ok') + '" title="' + (falta ? 'Estoque insuficiente' : 'Estoque suficiente') + '">' + fmtQtd(p.disponivel) + '</span>';
      }
      var cls = (p.produto === null || famBloq) ? 'pi-row-nok' : (avisosDoItem(i).length ? 'pi-row-warn' : '');
      return '<tr class="' + cls + '">' +
        '<td class="pi-td-st">' + status + '</td>' +
        '<td><input class="pi-in" data-i="' + i + '" data-f="codigo" value="' + esc(p.codigo) + '" placeholder="Código"></td>' +
        '<td class="pi-td-nome">' + nomeCell + '</td>' +
        '<td><input class="pi-in pi-in-num" data-i="' + i + '" data-f="quantidade" value="' + esc(fmtQtd(p.quantidade)) + '"></td>' +
        '<td class="pi-td-disp">' + dispCell + '</td>' +
        '<td><input class="pi-in pi-in-num" data-i="' + i + '" data-f="valorUnitario" value="' + esc((Number(p.valorUnitario) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })) + '"></td>' +
        '<td class="pi-td-tot">' + fmtMoney((Number(p.quantidade) || 0) * (Number(p.valorUnitario) || 0)) + '</td>' +
        '<td class="pi-td-x"><button class="pi-x" data-del="' + i + '" title="Remover produto">×</button></td>' +
        '</tr>';
    }).join('');
    $('prod-total').textContent = fmtMoney(totalGeral());
    renderAvisos();

    // liga os inputs
    tb.querySelectorAll('input.pi-in').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var i = Number(inp.getAttribute('data-i')), f = inp.getAttribute('data-f');
        S.estoqueAvisado = false;   // qualquer edição exige re-checar o estoque
        // mexeu no item = conferiu: o aviso da leitura do PDF sai de cena
        if (S.avisos && S.avisos.length) {
          S.avisos = S.avisos.filter(function (a) { return a.item !== i; });
          renderAvisos();
          inp.closest('tr').classList.remove('pi-row-warn');
        }
        if (f === 'codigo') {
          S.produtos[i].codigo = inp.value.trim();
          S.produtos[i].ok = false;
          S.produtos[i].produto = '';
          S.produtos[i].familia = '';
          S.produtos[i].familiaProd = '';
          S.produtos[i].stent = false;
          S.produtos[i].disponivel = undefined;
          S.produtos[i].lotes = [];
          S.produtos[i].lotesSelecionados = [];
          S.produtos[i].semLoteQtd = 0;
        } else {
          var n = parseNum(inp.value);
          S.produtos[i][f] = isNaN(n) ? 0 : n;
          // atualiza só o total da linha e o geral (sem re-render p/ não perder o foco)
          var tr = inp.closest('tr');
          tr.querySelector('.pi-td-tot').textContent =
            fmtMoney((Number(S.produtos[i].quantidade) || 0) * (Number(S.produtos[i].valorUnitario) || 0));
          $('prod-total').textContent = fmtMoney(totalGeral());
        }
      });
    });
    tb.querySelectorAll('button.pi-x').forEach(function (btn) {
      btn.addEventListener('click', function () {
        S.produtos.splice(Number(btn.getAttribute('data-del')), 1);
        if (!S.produtos.length) S.produtos.push(novoProduto());
        renderProdutos();
      });
    });
  }

  // total de um produto: se já há lotes escolhidos, soma qtd×preço de cada lote
  // (cada lote pode ter preço negociado); senão, quantidade × valor unitário
  function produtoTotal(p) {
    if (p.lotesSelecionados && p.lotesSelecionados.length) {
      return p.lotesSelecionados.reduce(function (s, l) { return s + (Number(l.quantidade) || 0) * (Number(l.preco) || 0); }, 0);
    }
    return (Number(p.quantidade) || 0) * (Number(p.valorUnitario) || 0);
  }
  function totalGeral() {
    return S.produtos.reduce(function (t, p) { return t + produtoTotal(p); }, 0);
  }

  async function validarProdutosEContinuar() {
    // validações básicas
    for (var i = 0; i < S.produtos.length; i++) {
      var p = S.produtos[i];
      if (!p.codigo) { msg('prod', 'Produto ' + (i + 1) + ': informe o <strong>código</strong>.', 'err'); return; }
      if (!(Number(p.quantidade) > 0)) { msg('prod', 'Produto <strong>' + esc(p.codigo) + '</strong>: quantidade deve ser maior que zero.', 'err'); return; }
      if (!(Number(p.valorUnitario) >= 0)) { msg('prod', 'Produto <strong>' + esc(p.codigo) + '</strong>: valor unitário inválido.', 'err'); return; }
    }

    try {
      msg('prod', 'Validando os códigos no BI…', 'busy');
      await VOZPBI.connect();
      var codes = S.produtos.map(function (p) { return p.codigo.toUpperCase(); });
      var lista = codes.filter(function (c, i) { return codes.indexOf(c) === i; })
        .map(function (c) { return '"' + c.replace(/"/g, '""') + '"'; }).join(', ');
      var dax = function (comFamilia) {
        return 'EVALUATE FILTER(SELECTCOLUMNS(\'Produtos\', "cod", UPPER(\'Produtos\'[Cód. produto]), "nome", \'Produtos\'[Produto]'
          + (comFamilia ? ', "familia", RELATED(\'Famílias\'[Família])' : '')
          + '), [cod] IN {' + lista + '})';
      };
      var rows;
      try { rows = await VOZPBI.query(dax(true)); }
      catch (e) { console.warn('[pedido] família indisponível, seguindo sem:', e); rows = await VOZPBI.query(dax(false)); }

      var achados = {};
      (rows || []).forEach(function (r) { achados[String(r['[cod]'])] = { nome: String(r['[nome]'] || ''), familia: String(r['[familia]'] == null ? '' : r['[familia]']) }; });

      var invalidos = 0;
      S.produtos.forEach(function (p) {
        var a = achados[p.codigo.toUpperCase()];
        if (a && a.nome) { p.ok = true; p.produto = a.nome; p.familia = a.familia; p.stent = isStentFam(a.familia) || isStentFam(a.nome); }
        else { p.ok = false; p.produto = null; p.familia = ''; p.stent = false; invalidos++; }  // null = "não encontrado"
      });

      // FALLBACK aditivo (NÃO altera o match exato acima): há códigos que existem
      // no BI mas cujo cadastro tem espaço à direita / NBSP / caractere invisível
      // — o [cod] IN {...} exato falha embora a tabela do BI mostre igual. Aqui só
      // os que NÃO casaram são reconsultados, com TRIM/SUBSTITUTE no lado do BI e
      // comparação normalizada (normCod). Os que já casaram ficam intocados.
      if (invalidos) {
        try {
          var pend = S.produtos.filter(function (p) { return p.produto === null; });
          var pcodes = pend.map(function (p) { return normCod(p.codigo); });
          var uniq = pcodes.filter(function (c, i) { return c && pcodes.indexOf(c) === i; })
            .map(function (c) { return '"' + c.replace(/"/g, '""') + '"'; }).join(', ');
          if (uniq) {
            var codBI = 'UPPER(TRIM(SUBSTITUTE(\'Produtos\'[Cód. produto], UNICHAR(160), " ")))';
            var dax2 = function (comFamilia) {
              return 'EVALUATE FILTER(SELECTCOLUMNS(\'Produtos\', "cod", ' + codBI + ', "nome", \'Produtos\'[Produto]'
                + (comFamilia ? ', "familia", RELATED(\'Famílias\'[Família])' : '')
                + '), [cod] IN {' + uniq + '})';
            };
            var rows2;
            try { rows2 = await VOZPBI.query(dax2(true)); }
            catch (e2) { console.warn('[pedido] fallback família indisponível:', e2); rows2 = await VOZPBI.query(dax2(false)); }
            var ach2 = {};
            (rows2 || []).forEach(function (r) { ach2[normCod(r['[cod]'])] = { nome: String(r['[nome]'] || ''), familia: String(r['[familia]'] == null ? '' : r['[familia]']) }; });
            S.produtos.forEach(function (p) {
              if (p.produto !== null) return;                 // já resolvido no match exato — não mexe
              var a2 = ach2[normCod(p.codigo)];
              if (a2 && a2.nome) { p.ok = true; p.produto = a2.nome; p.familia = a2.familia; p.stent = isStentFam(a2.familia) || isStentFam(a2.nome); invalidos--; }
            });
          }
        } catch (eFb) { console.warn('[pedido] fallback validação de produto:', eFb); }
      }
      renderProdutos();

      if (invalidos) {
        msg('prod', '<strong>' + invalidos + ' código(s) não encontrado(s)</strong> na base de produtos (linhas em vermelho). Corrija e valide de novo.', 'err');
        return;
      }

      // EXCEÇÃO TEMPORÁRIA: família bloqueada não segue (sem 2º clique)
      await carregarFamiliaBloqueio();
      var bloqueados = S.produtos.filter(familiaBloqueada);
      if (bloqueados.length) { renderProdutos(); msg('prod', msgFamiliaBloqueada(bloqueados), 'err'); return; }

      // valida ESTOQUE + LOTES no ERP (Dynamics F&O, OData direto) — best-effort
      msg('prod', 'Consultando estoque e lotes no ERP…', 'busy');
      var est = await fetchLotes();
      if (est && est.configured && est.itens) {
        S.produtos.forEach(function (p) {
          var e = est.itens[p.codigo] || est.itens[p.codigo.toUpperCase()];
          if (e) {
            p.disponivel = (typeof e.disponivel === 'number') ? e.disponivel : null;
            var precoBase = Number(p.valorUnitario) || 0;
            // STENT FARMACOLOGICO não passa por seleção de lote — vai direto pra revisão
            p.lotes = p.stent ? [] : (e.lotes || []).map(function (l) { return Object.assign({ sel: 0, preco: precoBase }, l); });
            p.semLotePreco = precoBase;
          } else { p.disponivel = null; p.lotes = []; }
        });
        renderProdutos();
        var faltantes = S.produtos.filter(function (p) { return typeof p.disponivel === 'number' && Number(p.quantidade) > p.disponivel; });
        if (faltantes.length && !S.estoqueAvisado) {
          S.estoqueAvisado = true;   // 1º clique avisa; 2º clique prossegue mesmo assim
          msg('prod', '<strong>Estoque insuficiente</strong> em: ' +
            faltantes.map(function (p) { return esc(p.codigo) + ' (disp. ' + fmtQtd(p.disponivel) + ', pedido ' + fmtQtd(p.quantidade) + ')'; }).join('; ') +
            '. Ajuste as quantidades ou clique novamente para prosseguir mesmo assim.', 'err');
          return;
        }
      }

      msg('prod', '');
      // produtos sem lote rastreado (ex.: disponível 0) → quantidade total lançada
      // automaticamente como "Sem lote" (exceto área BIO.ID, que passa direto)
      aplicarSemLoteAutomatico();
      // se algum produto tem lotes rastreados, abre a etapa de seleção de lotes
      var temLotes = S.produtos.some(function (p) { return p.lotes && p.lotes.length; });
      if (temLotes) { renderLotes(); goStep('lotes'); }
      else { montarLotesSelecionados(); renderRevisao(); goStep('rev'); }
    } catch (e) {
      console.error('[pedido] validarProdutos:', e);
      msg('prod', 'Erro ao consultar o BI: ' + esc(e.message || e), 'err');
    }
  }

  // EXCEÇÃO TEMPORÁRIA: no modelo do Comercial a família mora em
  // 'Produtos'[Família] (é a que o Sales Report usa); o RELATED('Famílias')
  // da validação pode cair no fallback sem família. Consulta à parte, só para
  // cliente distribuidor — não mexe na validação nem na detecção do stent.
  async function carregarFamiliaBloqueio() {
    if (!clienteDistribuidor()) return;
    var cods = S.produtos.filter(function (p) { return p.ok; }).map(function (p) { return normCod(p.codigo); });
    var lista = cods.filter(function (c, i) { return c && cods.indexOf(c) === i; })
      .map(function (c) { return '"' + c.replace(/"/g, '""') + '"'; }).join(', ');
    if (lista) {
      try {
        var rows = await VOZPBI.query('EVALUATE FILTER(SELECTCOLUMNS(\'Produtos\', "cod", UPPER(TRIM(SUBSTITUTE(\'Produtos\'[Cód. produto], UNICHAR(160), " "))), '
          + '"fam", \'Produtos\'[Família]), [cod] IN {' + lista + '})');
        var fam = {};
        (rows || []).forEach(function (r) { fam[normCod(r['[cod]'])] = String(r['[fam]'] == null ? '' : r['[fam]']); });
        S.produtos.forEach(function (p) { if (p.ok) p.familiaProd = fam[normCod(p.codigo)] || ''; });
      } catch (e) { console.warn('[pedido] trava temporária: sem \'Produtos\'[Família], seguindo com a da validação/nome:', e); }
    }
    console.info('[pedido] trava temporária — cliente:', S.cliente.tipo, S.produtos.map(function (p) {
      return { codigo: p.codigo, produto: p.produto, familia: p.familia, familiaProd: p.familiaProd, bloqueado: familiaBloqueada(p) || false };
    }));
  }

  // consulta estoque + lotes de todos os produtos no ERP (via /api/pedido-lotes)
  async function fetchLotes() {
    var codes = S.produtos.map(function (p) { return p.codigo; }).filter(Boolean);
    try {
      var r = await fetch('/api/pedido-lotes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigos: codes })
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) { console.warn('[pedido] lotes:', j.error); return { configured: false }; }
      return j;
    } catch (e) { console.warn('[pedido] lotes falhou:', e); return { configured: false }; }
  }

  // DOUBLE-CHECK no envio: re-consulta o estoque AGORA e confere se cada lote
  // escolhido ainda tem a quantidade pedida (evita corrida entre 2 operadores
  // pedindo o mesmo lote). Atualiza os saldos em p.lotes e limita as seleções
  // que passaram do disponível. Devolve a lista de problemas.
  async function revalidarLotes() {
    var est = await fetchLotes();
    if (!est || !est.configured || !est.itens) return { semDados: true, problemas: [] };
    var problemas = [];
    S.produtos.forEach(function (p) {
      var e = est.itens[p.codigo] || est.itens[(p.codigo || '').toUpperCase()];
      var lotesAtuais = (e && e.lotes) ? e.lotes : [];
      // atualiza o disponível atual nos lotes do produto (p/ re-render na volta)
      (p.lotes || []).forEach(function (l) {
        var atual = lotesAtuais.find(function (x) { return String(x.batch).toUpperCase() === String(l.batch).toUpperCase(); });
        l.disponivel = atual ? Number(atual.disponivel) : 0;
        if (Number(l.sel) > l.disponivel + 1e-6) l.sel = l.disponivel;   // clampa a alocação
      });
      // confere as seleções JÁ confirmadas (lotesSelecionados) contra o saldo atual
      (p.lotesSelecionados || []).forEach(function (sel) {
        if (!sel.batch) return;   // "sem lote" não tem saldo de lote p/ validar
        var atual = lotesAtuais.find(function (x) { return String(x.batch).toUpperCase() === String(sel.batch).toUpperCase(); });
        var disp = atual ? Number(atual.disponivel) : 0;
        if (Number(sel.quantidade) > disp + 1e-6) {
          problemas.push({ codigo: p.codigo, produto: p.produto, batch: sel.batch, pedido: Number(sel.quantidade), disponivel: disp });
        }
      });
    });
    return { problemas: problemas };
  }

  // ── Etapa 4.5 · Seleção de lotes ────────────────────────────────
  function catInfo(k) {
    var m = {
      vencido:     { l: 'Vencido',                    c: '#b91c1c', b: '#fef2f2' },
      proximo:     { l: 'Próximo do venc. (≤30d)',    c: '#dc2626', b: '#fef2f2' },
      muito_curta: { l: 'Muito curta (1–3 meses)',    c: '#ea580c', b: '#fff7ed' },
      curta:       { l: 'Curta (≤6 meses)',           c: '#b45309', b: '#fffbeb' },
      normal:      { l: 'Normal (≤1 ano)',            c: '#2c7591', b: '#f0f7fa' },
      boa:         { l: 'Boa (>1 ano)',               c: '#16a34a', b: '#f0fdf4' },
      muito_boa:   { l: 'Muito boa (>2 anos)',        c: '#0d9488', b: '#f0fdfa' },
      sem_data:    { l: 'Sem validade',               c: '#67757d', b: '#f8fafc' }
    };
    return m[k] || m.sem_data;
  }
  function somaLotes(p) { return (p.lotes || []).reduce(function (s, l) { return s + (Number(l.sel) || 0); }, 0); }
  function somaSel(p) { return somaLotes(p) + (Number(p.semLoteQtd) || 0); }   // lotes + sem-lote

  // área demandante BIO.ID: passa direto (não força lançamento como "Sem lote")
  function isBioId() {
    var a = (S.cab && S.cab.areaDemandante) || ($('cab-area') && $('cab-area').value) || '';
    return /BIO\.?\s*ID/i.test(a);
  }
  // Produtos SEM lote rastreado (ex.: disponível 0) E o STENT FARMACOLOGICO: a
  // quantidade toda é lançada automaticamente como "Sem lote", com a QUANTIDADE e o
  // PREÇO UNITÁRIO originais do produto. O STENT nunca passa por seleção de lote —
  // vai direto como sem-lote. Exceção: área BIO.ID, que segue direto sem linha de lote.
  function aplicarSemLoteAutomatico() {
    S.produtos.forEach(function (p) {
      if (p.lotes && p.lotes.length) return;   // tem lote rastreado → tratado na etapa de lotes
      if (isBioId()) { p.semLoteQtd = 0; return; }   // BIO.ID segue direto, sem linha de lote
      p.semLoteQtd = Number(p.quantidade) || 0;                                       // quantidade original
      if (!(Number(p.semLotePreco) > 0)) p.semLotePreco = Number(p.valorUnitario) || 0;   // preço unitário original
    });
  }
  // Consolida a seleção de cada produto em p.lotesSelecionados (lotes escolhidos +
  // eventual quantidade "Sem lote"). Usado tanto na etapa de lotes quanto no atalho
  // direto pra revisão (quando nenhum produto tem lote rastreado).
  function montarLotesSelecionados() {
    S.produtos.forEach(function (p) {
      var sel = (p.lotes || []).filter(function (l) { return Number(l.sel) > 0; })
        .map(function (l) { return { batch: l.batch, quantidade: Number(l.sel), preco: Number(l.preco) || 0, expDate: l.expDate, categoria: l.categoria }; });
      if (Number(p.semLoteQtd) > 0) sel.push({ batch: '', quantidade: Number(p.semLoteQtd), preco: Number(p.semLotePreco) || 0, expDate: null, categoria: 'sem_lote' });
      p.lotesSelecionados = sel;
    });
  }
  function atualizaSel(pi) {
    var p = S.produtos[pi], el = document.querySelector('.pi-lote-sel[data-pi="' + pi + '"]');
    if (!el) return;
    var s = somaSel(p), q = Number(p.quantidade) || 0;
    el.textContent = fmtQtd(s);
    el.style.color = (Math.abs(s - q) < 1e-6) ? '#16a34a' : '#b45309';
  }
  function autoFEFO(pi) {
    var p = S.produtos[pi], restante = Number(p.quantidade) || 0;
    (p.lotes || []).forEach(function (l) {     // já ordenados FEFO pelo backend
      var take = Math.min(l.disponivel, restante);
      l.sel = take > 0 ? take : 0; restante -= (take > 0 ? take : 0);
    });
    p.semLoteQtd = restante > 0 ? restante : 0;   // o que os lotes não cobrem vai p/ sem-lote
    renderLotes();
  }
  function renderLotes() {
    var cont = $('lotes-cont'), html = '';
    S.produtos.forEach(function (p, pi) {
      var temLote = !!(p.lotes && p.lotes.length);
      html += '<div class="pi-lote-card">';
      html += '<div class="pi-lote-head"><div><strong>' + esc(p.codigo) + '</strong> · ' + esc(p.produto || '') + '</div>';
      if (temLote) {
        html += '<div class="pi-lote-req">Pedido: <strong>' + fmtQtd(p.quantidade) + '</strong> · Selecionado: ' +
          '<span class="pi-lote-sel" data-pi="' + pi + '">0</span>' +
          ' <button type="button" class="pi-btn pi-btn-ghost pi-lote-auto" data-pi="' + pi + '" style="padding:5px 10px;font-size:12px;">Auto (FEFO)</button></div>';
      }
      html += '</div>';
      if (!temLote) {
        html += '<div class="pi-lote-nolote">' + (p.stent
          ? 'STENT FARMACOLÓGICO — lançado automaticamente como <strong>SEM LOTE</strong> (quantidade ' + fmtQtd(p.quantidade) + ').'
          : (isBioId()
              ? 'BIO.ID — sem lote rastreado, segue direto (quantidade ' + fmtQtd(p.quantidade) + ').'
              : 'Sem estoque/lote disponível — lançado automaticamente como <strong>SEM LOTE</strong> (quantidade ' + fmtQtd(p.quantidade) + ').')) + '</div></div>';
        return;
      }
      html += '<div class="pi-table-wrap"><table class="pi-table pi-lote-tb"><thead><tr>' +
        '<th>Validade</th><th>Lote</th><th style="text-align:right;">Disponível</th><th style="text-align:right;">Quantidade</th><th style="text-align:right;">Preço unit.</th></tr></thead><tbody>';
      p.lotes.forEach(function (l, li) {
        var ci = catInfo(l.categoria);
        var val = l.expDate ? new Date(l.expDate).toLocaleDateString('pt-BR') : '—';
        var dias = (l.dias != null) ? (l.dias < 0 ? ('vencido há ' + (-l.dias) + 'd') : ('faltam ' + l.dias + 'd')) : '';
        html += '<tr>' +
          '<td><span class="pi-cat" style="color:' + ci.c + ';background:' + ci.b + ';">' + esc(ci.l) + '</span>' +
            '<div class="pi-lote-val">' + val + ' <span class="pi-lote-dim">' + dias + '</span></div></td>' +
          '<td>' + esc(l.batch) + '</td>' +
          '<td class="pi-td-disp">' + fmtQtd(l.disponivel) + '</td>' +
          '<td><input class="pi-in pi-in-num pi-lote-q" data-pi="' + pi + '" data-li="' + li + '" value="' + esc(fmtQtd(l.sel || 0)) + '"></td>' +
          '<td><input class="pi-in pi-in-num pi-lote-p" data-pi="' + pi + '" data-li="' + li + '" value="' + esc((Number(l.preco) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })) + '"></td>' +
          '</tr>';
      });
      // linha "Sem lote" — parte da quantidade sem rastreio de lote
      html += '<tr class="pi-semlote-row">' +
        '<td colspan="2"><strong>Sem lote</strong> <span class="pi-lote-dim">(quantidade sem rastreio)</span></td>' +
        '<td class="pi-td-disp pi-lote-dim">—</td>' +
        '<td><input class="pi-in pi-in-num pi-semlote-q" data-pi="' + pi + '" value="' + esc(fmtQtd(p.semLoteQtd || 0)) + '"></td>' +
        '<td><input class="pi-in pi-in-num pi-semlote-p" data-pi="' + pi + '" value="' + esc((Number(p.semLotePreco) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })) + '"></td>' +
        '</tr>';
      html += '</tbody></table></div></div>';
    });
    cont.innerHTML = html || '<div class="pi-sub">Nenhum produto para exibir.</div>';

    cont.querySelectorAll('input.pi-lote-q').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var pi = +inp.getAttribute('data-pi'), li = +inp.getAttribute('data-li');
        var n = parseNum(inp.value); if (isNaN(n) || n < 0) n = 0;
        var max = S.produtos[pi].lotes[li].disponivel;
        if (n > max) { n = max; inp.value = fmtQtd(n); }
        S.produtos[pi].lotes[li].sel = n;
        atualizaSel(pi);
      });
    });
    cont.querySelectorAll('input.pi-semlote-q').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var pi = +inp.getAttribute('data-pi');
        var n = parseNum(inp.value); if (isNaN(n) || n < 0) n = 0;
        var max = Number(S.produtos[pi].quantidade) || 0;
        if (n > max) { n = max; inp.value = fmtQtd(n); }
        S.produtos[pi].semLoteQtd = n;
        atualizaSel(pi);
      });
    });
    cont.querySelectorAll('input.pi-lote-p').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var pi = +inp.getAttribute('data-pi'), li = +inp.getAttribute('data-li');
        var n = parseNum(inp.value); if (isNaN(n) || n < 0) n = 0;
        S.produtos[pi].lotes[li].preco = n;
      });
    });
    cont.querySelectorAll('input.pi-semlote-p').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var pi = +inp.getAttribute('data-pi');
        var n = parseNum(inp.value); if (isNaN(n) || n < 0) n = 0;
        S.produtos[pi].semLotePreco = n;
      });
    });
    cont.querySelectorAll('.pi-lote-auto').forEach(function (btn) {
      btn.addEventListener('click', function () { autoFEFO(+btn.getAttribute('data-pi')); });
    });
    S.produtos.forEach(function (p, pi) { if (p.lotes && p.lotes.length) atualizaSel(pi); });
  }
  function validarLotesEContinuar() {
    for (var i = 0; i < S.produtos.length; i++) {
      var p = S.produtos[i];
      if (!p.lotes || !p.lotes.length) continue;   // sem lotes rastreados: quantidade toda sem lote
      var s = somaSel(p), q = Number(p.quantidade) || 0;
      if (Math.abs(s - q) > 1e-6) {
        msg('lotes', 'Produto <strong>' + esc(p.codigo) + '</strong>: você distribuiu <strong>' + fmtQtd(s) + '</strong> de <strong>' + fmtQtd(q) + '</strong> (lotes + sem lote). Ajuste as quantidades, use "Auto (FEFO)" ou coloque o restante em <strong>Sem lote</strong>.', 'err');
        return;
      }
    }
    montarLotesSelecionados();
    msg('lotes', '');
    renderRevisao();
    goStep('rev');
  }

  // ── Política de crédito (regra determinística sobre cond. pagto + total) ──
  var POLITICA = {
    semValidacao: ['20 DIAS', '28 DIAS', '30 DIAS', 'À VISTA', 'A VISTA/30 DIAS'],
    limite: {
      '30/45 DIAS': 10000, '30/45/60 DIAS': 20000.1, '30/45/60/75/90 DIAS': 20000.1,
      '30/60 DIAS': 8000.1, '30/60/90 DIAS': 20000.1, '30/60/90/120 DIAS': 70000.1,
      '45 DIAS': 12000, '45/60 DIAS': 8000.1, 'A VISTA /30/60/90 DIAS': 20000.1,
      'CR 40 DIAS': 8000.1, 'CR 50,0% À VISTA 30/60 DIA': 20000.1
    },
    aprovacao: ['07 DIAS', '10 DIAS', '120 DIAS', '30/60/90/120/150/180 DIAS',
      '50,0% A VISTA + 50,0% 30 DIAS', '60 DIAS', '70 DIAS', '75DIAS', '90 DIAS', 'CR 15 DIAS']
  };
  var POL_OK  = '✅ A condição de pagamento está em conformidade com a política de crédito';
  var POL_NOK = '🔴 A condição de pagamento não está em conformidade com a política de crédito';
  var POL_APR = '🔴 A condição de pagamento requer aprovação do departamento financeiro';
  var POL_VENC = '⚠️ Pagamento por data de vencimento — sem condição de pagamento para validar na política de crédito';
  function avaliarPolitica(cond, total) {
    if (POLITICA.semValidacao.indexOf(cond) >= 0) return { cls: 'ok', texto: POL_OK };
    if (Object.prototype.hasOwnProperty.call(POLITICA.limite, cond)) {
      return (Number(total) < POLITICA.limite[cond]) ? { cls: 'nok', texto: POL_NOK } : { cls: 'ok', texto: POL_OK };
    }
    if (POLITICA.aprovacao.indexOf(cond) >= 0) return { cls: 'nok', texto: POL_APR };
    return { cls: 'warn', texto: '⚠️ Condição de pagamento não mapeada na política — verifique com o financeiro' };
  }

  // ── Etapa 5 · Revisão e envio ───────────────────────────────────
  function renderRevisao() {
    var c = S.cab;
    // avalia a política de crédito com o TOTAL final e grava em PoliticaCredito
    var pol = c.usaDataVencimento ? { cls: 'warn', texto: POL_VENC }
                                  : avaliarPolitica(c.condicaoPagamento, totalGeral());
    c.politicaCredito = pol.texto;
    var pe = $('rev-politica');
    if (pe) { pe.style.display = 'block'; pe.className = 'pi-politica ' + pol.cls; pe.textContent = pol.texto; }
    var linhas = [
      ['Empresa', c.empresa],
      ['CNPJ', c.cnpj], ['Código do Cliente', c.codCliente], ['Cliente', c.nomeCliente],
      ['Ordem de Compra', c.ordemDeCompra || '—'], ['Endereço de Entrega', c.enderecoEntrega || '—'],
      ['E-mail', c.email || '—'],
      ['Condição de Pagamento', c.usaDataVencimento ? '—' : c.condicaoPagamento],
      ['Data de Vencimento do Pagamento', c.usaDataVencimento ? fmtData(c.dataVencimento) : '—'],
      ['Pagamento Antecipado', c.pagamentoAntecipado ? 'Sim' : 'Não'],
      ['Frete', c.frete], ['Condição de Entrega', c.condicaoEntrega],
      ['Tipo de Venda', c.tipoVenda], ['Área Demandante', c.areaDemandante],
      ['Vendedor', c.vendedor], ['Caso', c.caso], ['Portal', c.portal],
      ['Observação', c.observacao || '—'], ['Observação na Nota', c.observacaoNota || '—'],
      ['Operador', c.operador],
      ['PDF anexado', S.pdf ? S.pdf.filename : '(sem PDF — pedido manual)']
    ];
    $('rev-cab').innerHTML = linhas.map(function (l) {
      return '<div class="pi-rev-item"><span>' + esc(l[0]) + '</span><strong>' + esc(l[1]) + '</strong></div>';
    }).join('');

    $('rev-prod').innerHTML = S.produtos.map(function (p) {
      var lotesTxt = '';
      if (p.lotesSelecionados && p.lotesSelecionados.length) {
        lotesTxt = '<div class="pi-lote-dim" style="margin-top:3px;">Lotes: ' +
          p.lotesSelecionados.map(function (l) { return (l.batch ? esc(l.batch) : 'sem lote') + ' (' + fmtQtd(l.quantidade) + ' × ' + fmtMoney(l.preco) + (l.expDate ? ' · val. ' + new Date(l.expDate).toLocaleDateString('pt-BR') : '') + ')'; }).join(', ') + '</div>';
      }
      var temLoteSel = p.lotesSelecionados && p.lotesSelecionados.length;
      return '<tr><td>' + esc(p.codigo) + '</td><td>' + esc(p.produto) + lotesTxt + '</td>' +
        '<td class="pi-num">' + fmtQtd(p.quantidade) + '</td>' +
        '<td class="pi-num">' + (temLoteSel ? '<span class="pi-lote-dim">por lote</span>' : fmtMoney(p.valorUnitario)) + '</td>' +
        '<td class="pi-num">' + fmtMoney(produtoTotal(p)) + '</td></tr>';
    }).join('');
    $('rev-total').textContent = fmtMoney(totalGeral());
  }

  function montarResumo() {
    var c = S.cab, out = [];
    out.push('PEDIDO — ORDEM DE COMPRA ' + (c.ordemDeCompra || 'N/D'));
    out.push('Empresa: ' + (c.empresa || 'N/D'));
    out.push('Cliente: ' + c.nomeCliente + ' (' + c.codCliente + ') — CNPJ ' + c.cnpj);
    out.push('Endereço de Entrega: ' + (c.enderecoEntrega || 'N/D'));
    out.push('E-mail: ' + (c.email || 'N/D'));
    out.push('Cond. Pagamento: ' + (c.usaDataVencimento ? 'vencimento em ' + fmtData(c.dataVencimento) : c.condicaoPagamento) +
      ' | Frete: ' + c.frete + ' | Entrega: ' + c.condicaoEntrega);
    out.push('Pagamento Antecipado: ' + (c.pagamentoAntecipado ? 'Sim' : 'Não'));
    out.push('Tipo de Venda: ' + c.tipoVenda + ' | Área: ' + c.areaDemandante + ' | Vendedor: ' + c.vendedor);
    out.push('Caso: ' + c.caso + ' | Portal: ' + c.portal);
    out.push('Observação: ' + (c.observacao || 'N/D'));
    out.push('Observação na Nota: ' + (c.observacaoNota || 'N/D'));
    out.push('');
    out.push('PRODUTOS:');
    S.produtos.forEach(function (p, i) {
      out.push((i + 1) + '. ' + p.codigo + ' — ' + p.produto +
        ' | Qtd: ' + fmtQtd(p.quantidade) +
        ' | Total: ' + fmtMoney(produtoTotal(p)));
      if (p.lotesSelecionados && p.lotesSelecionados.length) {
        out.push('   Lotes: ' + p.lotesSelecionados.map(function (l) {
          return (l.batch || 'sem lote') + ' x' + fmtQtd(l.quantidade) + ' @ ' + fmtMoney(l.preco) + (l.expDate ? ' (val. ' + new Date(l.expDate).toLocaleDateString('pt-BR') + ')' : '');
        }).join(', '));
      }
    });
    out.push('');
    out.push('TOTAL GERAL: ' + fmtMoney(totalGeral()));
    if (c.politicaCredito) out.push('Política de Crédito: ' + c.politicaCredito);
    out.push('Operador: ' + c.operador);
    return out.join('\n');
  }

  // ── Upload do PDF no SharePoint (Graph, token do usuário) ───────
  // Sobe pra pasta "Ordens de Compra PDF" e devolve { id, name, listItemId,
  // webUrl } — o flow usa o ID + nome pra buscar o arquivo e enviar por e-mail.
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
    // caminho do arquivo p/ o conector do SharePoint (Get file content using path):
    //  pathSite = relativo ao SITE  (/Shared Documents/Ordens de Compra PDF/<nome>)
    //  pathLib  = relativo à BIBLIOTECA (/Ordens de Compra PDF/<nome>)
    try {
      var full = decodeURIComponent(new URL(sp.webUrl).pathname);   // /sites/EquipeIntelignciaeDados/Shared Documents/.../<nome>
      sp.pathSite = full.replace(SP_PATH, '') || full;
    } catch (e) { sp.pathSite = '/Shared Documents/' + SP_FOLDER + '/' + (sp.name || S.pdf.filename); }
    sp.pathLib = '/' + SP_FOLDER + '/' + (sp.name || S.pdf.filename);
    return sp;
  }

  async function enviarPedido() {
    var btn = $('rev-enviar');
    // EXCEÇÃO TEMPORÁRIA: rede de segurança — família bloqueada nunca é enviada
    var bloqueados = S.produtos.filter(familiaBloqueada);
    if (bloqueados.length) {
      renderProdutos();
      goStep('prod');
      msg('prod', msgFamiliaBloqueada(bloqueados), 'err');
      return;
    }
    btn.disabled = true;
    try {
      // 0) DOUBLE-CHECK dos lotes: re-valida o estoque AGORA (evita corrida entre
      //    operadores pedindo o mesmo lote). Só faz sentido se há lotes escolhidos.
      var temLoteEscolhido = S.produtos.some(function (p) { return (p.lotesSelecionados || []).some(function (l) { return l.batch; }); });
      if (temLoteEscolhido) {
        msg('rev', 'Revalidando os lotes no estoque…', 'busy');
        var chk = await revalidarLotes();
        if (chk.problemas && chk.problemas.length) {
          renderLotes();   // reflete os saldos atualizados
          goStep('lotes');
          msg('lotes', '<strong>O estoque mudou enquanto você revisava</strong> (outro pedido pode ter consumido o lote). ' +
            'Estes lotes não têm mais a quantidade pedida:<br>' +
            chk.problemas.map(function (x) {
              return '• <strong>' + esc(x.codigo) + '</strong> — lote ' + esc(x.batch) + ': pedido <strong>' + fmtQtd(x.pedido) + '</strong>, disponível agora <strong>' + fmtQtd(x.disponivel) + '</strong>';
            }).join('<br>') +
            '<br>Ajuste as quantidades (ou use "Auto (FEFO)") e confirme de novo.', 'err');
          btn.disabled = false;
          return;
        }
      }

      // 1) sobe o PDF no SharePoint (se houver) — o flow precisa do ID + nome
      var sp = null;
      if (S.pdf) {
        try { msg('rev', 'Salvando o PDF no SharePoint…', 'busy'); sp = await uploadPdfSharePoint(); }
        catch (e) {
          console.error('[pedido] sharepoint:', e);
          msg('rev', 'Falha ao salvar o PDF no SharePoint: ' + esc(e.message || e) + ' — o pedido NÃO foi enviado.', 'err');
          btn.disabled = false; return;
        }
      }

      msg('rev', 'Enviando o pedido…', 'busy');
      var payload = {
        cabecalho: S.cab,
        produtos: S.produtos.map(function (p) {
          return {
            codigo: p.codigo, produto: p.produto,
            quantidade: Number(p.quantidade) || 0,
            valorUnitario: Number(p.valorUnitario) || 0,
            total: produtoTotal(p),
            lotes: (p.lotesSelecionados || []).map(function (l) {
              return { batch: l.batch, quantidade: Number(l.quantidade) || 0, precoLote: Number(l.preco) || 0, expDate: l.expDate || null };
            })
          };
        }),
        totalGeral: totalGeral(),
        resumo: montarResumo(),
        sharepoint: sp
      };
      var r = await fetch('/api/pedido-enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        msg('rev', 'Falha no envio: ' + esc(j.error || ('HTTP ' + r.status)) +
          (j.details ? '<br><small>' + esc(j.details) + '</small>' : ''), 'err');
        btn.disabled = false;
        return;
      }
      msg('rev', '');
      goStep('ok');
      notificarCS();
    } catch (e) {
      console.error('[pedido] enviar:', e);
      msg('rev', 'Erro ao enviar: ' + esc(e.message || e), 'err');
      btn.disabled = false;
    }
  }

  // ── Customer Service ────────────────────────────────────────────
  function bannerCS(html, tipo) {
    var b = $('pi-cs-banner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'pi-cs-banner';
      b.style.cssText = 'display:flex;gap:12px;align-items:flex-start;padding:12px 14px;margin:0 0 14px;border-radius:14px;font-size:13.5px;line-height:1.5;';
      var corpo = document.querySelector('.pi-body');
      if (!corpo) return;
      corpo.insertBefore(b, corpo.firstChild);
    }
    var cor = { info: ['#EEF5F9', '#225E72'], ok: ['#DDF5E7', '#0F7A43'], err: ['#FDE7E7', '#A82424'] }[tipo || 'info'];
    b.style.background = cor[0];
    b.style.color = cor[1];
    b.innerHTML = html;
  }

  async function iniciarDoCS() {
    var q = new URLSearchParams(location.search);
    var tipo = q.get('cot') ? 'cot' : 'cs';
    var numero = q.get(tipo);
    if (!numero) return;
    var O = ORIGENS_PI[tipo];
    $('cab-caso').value = numero;
    if (!window.CSPI) {
      bannerCS('<div>Este pedido veio ' + O.rotulo + ' <strong>' + esc(numero) + '</strong> (' + O.modulo + '), mas a ponte não carregou. Anexe o PDF manualmente.</div>', 'err');
      CS = { numero: numero, origemPI: tipo };
      return;
    }
    var e = null;
    try { e = await CSPI.ler(numero); } catch (err) { console.warn('[pedido] CSPI.ler:', err); }
    if (!e) {
      bannerCS('<div>' + (tipo === 'cot' ? 'Cotação' : 'Caso') + ' <strong>' + esc(numero) + '</strong> (' + O.modulo + '): não encontrei o PDF entregue (a entrega vale 24 h, neste navegador). ' +
        'Volte ' + (tipo === 'cot' ? 'à cotação' : 'ao caso') + ' e clique em "Abrir no PI" de novo — ou anexe o PDF aqui.</div>', 'err');
      CS = { numero: numero, origemPI: tipo };
      return;
    }
    CS = e;
    CS.origemPI = tipo;
    var c = e.contato || {};
    bannerCS('<span style="font-size:18px;line-height:1.2">' + O.icone + '</span><div><strong>Pedido ' + O.rotulo + ' ' + esc(e.numero) + '</strong> · ' + O.modulo + '<br>' +
      esc(c.nome || c.email || (e.conta && e.conta.nome) || 'cliente') + (c.nome && c.email ? ' &lt;' + esc(c.email) + '&gt;' : '') + (e.assunto ? ' · ' + esc(e.assunto) : '') +
      '<br><span style="opacity:.8">Anexo: ' + esc(e.arquivo || '') + (e.extracao ? ' · já lido ' + (tipo === 'cot' ? 'na Gestão de Cotações' : 'no Customer Service') : '') + '</span></div>', 'info');
    var file = new File([CSPI.b64ParaBytes(e.base64)], e.arquivo || 'pedido.pdf', { type: e.tipo || 'application/pdf' });
    if (e.extracao && e.extracao.dados) {
      // a leitura já foi feita no caso (mesmo leitor de PDF + mesma IA): não paga de novo
      S.pdf = { filename: file.name, base64: e.base64 };
      S.ext = e.extracao.dados;
      S.avisos = Array.isArray(e.extracao.avisos) ? e.extracao.avisos : [];
      msg('up', '');
      aplicarExtracao();
      goStep('cli');
      if (S.cliente.cnpj) validarCNPJ();
    } else {
      await handleFile(file);
    }
    var em = $('cab-email');
    if (c.email && em && (!em.value || em.value === 'NAO INFORMADO')) em.value = c.email;
    if (tipo === 'cot') preencherDaCotacao(e);
  }

  // a cotação já sabe o portal, a área demandante, a empresa e a OC: o
  // operador só confere (escolhe por cima se estiver errado)
  function escolherOpcao(id, valor) {
    var sel = $(id); if (!sel || !valor) return;
    var alvo = String(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    for (var i = 0; i < sel.options.length; i++) {
      var o = sel.options[i];
      var k = String(o.value || o.text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (k && k === alvo) { sel.value = o.value; sel.dispatchEvent(new Event('change')); return; }
    }
  }
  function preencherDaCotacao(e) {
    escolherOpcao('cab-portal', e.portal);
    escolherOpcao('cab-area', e.areaPI);
    escolherOpcao('cab-empresa', e.empresa);
    var oc = $('cab-oc');
    if (e.oc && oc && !oc.value) oc.value = e.oc;
  }

  // pedido enviado: o caso fica sabendo (e a aba do Customer Service ou da
  // Gestão de Cotações, se aberta, recarrega)
  function notificarCS() {
    if (!CS || !CS.numero) return;
    var numero = CS.numero, cab = S.cab || {}, O = origemPI();
    var corpo = { acao: 'pi', numero: numero, estado: 'enviado', enviado: {
      oc: cab.ordemDeCompra && cab.ordemDeCompra !== 'NAO INFORMADO' ? cab.ordemDeCompra : '',
      cliente: cab.nomeCliente || S.cliente.nome || '', codigoCliente: cab.codCliente || S.cliente.codigo || '',
      cnpj: cab.cnpj || S.cliente.cnpj || '', total: totalGeral(), itens: S.produtos.length, empresa: cab.empresa || ''
    } };
    fetch(O.api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); })
      .then(function () {
        if (window.CSPI) { CSPI.avisar({ tipo: 'pi-enviado', numero: numero }); CSPI.apagar(numero); }
        bannerCS('<span style="font-size:18px;line-height:1.2">✓</span><div><strong>' + (O === ORIGENS_PI.cot ? 'Cotação ' : 'Caso ') + esc(numero) + ' atualizad' + (O === ORIGENS_PI.cot ? 'a' : 'o') + '</strong> — ' +
          (O === ORIGENS_PI.cot ? 'a Gestão de Cotações já mostra o pedido como lançado no Dynamics. ' : 'o Customer Service já mostra o pedido como enviado ao Dynamics. ') +
          '<a href="' + O.volta + '?caso=' + encodeURIComponent(numero) + '" style="color:inherit;font-weight:700">' + (O === ORIGENS_PI.cot ? 'Voltar à cotação' : 'Voltar ao caso') + '</a></div>', 'ok');
      })
      .catch(function (e) {
        console.warn('[pedido] ' + O.api + ':', e);
        bannerCS('<div>O pedido foi enviado, mas não consegui atualizar ' + (O === ORIGENS_PI.cot ? 'a cotação' : 'o caso') + ' <strong>' + esc(numero) + '</strong> em ' + O.modulo + ' (' + esc(e.message) + '). Marque lá à mão.</div>', 'err');
      });
    try { history.replaceState(null, '', location.pathname); } catch (e) {}   // "Registrar novo pedido" não reabre o caso
    CS = null;
  }

  // ── Bootstrap ───────────────────────────────────────────────────
  function init() {
    // selects do cabeçalho
    popularSelect('cab-empresa',   EMPRESAS,       'Escolha a empresa');
    popularSelect('cab-condpag',   COND_PAGAMENTO, 'Escolha a condição de pagamento');
    popularSelect('cab-frete',     FRETES,         'Escolha o frete');
    popularSelect('cab-condent',   COND_ENTREGA,   'Escolha a condição de entrega');
    popularSelect('cab-tipovenda', TIPOS_VENDA,    'Escolha o tipo de venda');
    popularSelect('cab-area',      AREAS,          'Escolha a área demandante');
    popularSelect('cab-portal',    PORTAIS,        'Escolha o portal');
    popularSelect('cab-vendedor',  VENDEDORES,     'Escolha o vendedor');
    $('cab-caso').value = 'N/D';
    $('cab-obsnota').value = '';

    // operador = usuário logado no portal (preenche quando o auth resolver)
    var tent = 0, timer = setInterval(function () {
      var op = getOperador();
      if (op || ++tent > 40) {
        if (op && !$('cab-operador').value) $('cab-operador').value = op;
        if (op) clearInterval(timer);
        if (tent > 40) clearInterval(timer);
      }
    }, 500);

    // checkbox "Não informado" ao lado de Ordem de Compra e E-mail
    function bindNaoInformado(chkId, inpId) {
      var chk = $(chkId), inp = $(inpId);
      if (!chk || !inp) return;
      chk.addEventListener('change', function () {
        if (chk.checked) { inp.value = 'NAO INFORMADO'; inp.disabled = true; }
        else { if (inp.value === 'NAO INFORMADO') inp.value = ''; inp.disabled = false; inp.focus(); }
      });
    }
    bindNaoInformado('cab-oc-ni', 'cab-oc');
    bindNaoInformado('cab-email-ni', 'cab-email');

    // flag "Data de Vencimento do Pagamento": abre o campo de data e dispensa
    // (e limpa) a condição de pagamento — que vai vazia para o Power Automate.
    $('cab-venc-flag').addEventListener('change', function () {
      var on = this.checked;
      $('cab-venc-wrap').style.display = on ? 'flex' : 'none';
      $('cab-condpag').disabled = on;
      $('cab-condpag-req').style.display = on ? 'none' : '';
      if (on) { $('cab-condpag').value = ''; $('cab-venc').focus(); }
      else { $('cab-venc').value = ''; }
    });

    // "Pagamento Antecipado": chave Sim/Não que começa SEMPRE em Não — o
    // navegador pode restaurar o formulário no "Registrar novo pedido" (reload).
    var pagAnt = $('cab-pagant');
    function rotuloPagAnt() { $('cab-pagant-txt').textContent = pagAnt.checked ? 'Sim' : 'Não'; }
    pagAnt.checked = false;
    rotuloPagAnt();
    pagAnt.addEventListener('change', rotuloPagAnt);

    // vendedor só aparece em VENDA CONSULTIVA
    $('cab-area').addEventListener('change', function () {
      $('cab-vendedor-wrap').style.display =
        (this.value === 'PEDIDOINTELIGENTE (VENDA CONSULTIVA)') ? 'block' : 'none';
    });

    // upload
    var dz = $('up-drop'), fi = $('up-file');
    dz.addEventListener('click', function () { fi.click(); });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('drag'); });
    dz.addEventListener('drop', function (e) {
      e.preventDefault(); dz.classList.remove('drag');
      handleFile(e.dataTransfer.files && e.dataTransfer.files[0]);
    });
    fi.addEventListener('change', function () { handleFile(fi.files && fi.files[0]); fi.value = ''; });
    $('up-btn-manual').addEventListener('click', iniciarManual);
    $('up-btn-manual-mesmo').addEventListener('click', function () { S.ext = null; S.produtos = [novoProduto()]; goStep('cli'); });

    // navegação / ações
    $('cli-validar').addEventListener('click', validarCNPJ);
    $('cli-cnpj').addEventListener('keydown', function (e) { if (e.key === 'Enter') validarCNPJ(); });
    $('cli-voltar').addEventListener('click', function () { goStep('up'); });
    $('cli-continuar').addEventListener('click', function () { goStep('cab'); });
    $('cab-voltar').addEventListener('click', function () { goStep('cli'); });
    $('cab-continuar').addEventListener('click', confirmarCabecalho);
    $('prod-add').addEventListener('click', function () { S.produtos.push(novoProduto()); renderProdutos(); });
    $('prod-voltar').addEventListener('click', function () { goStep('cab'); });
    $('prod-continuar').addEventListener('click', validarProdutosEContinuar);
    $('lotes-voltar').addEventListener('click', function () { goStep('prod'); });
    $('lotes-continuar').addEventListener('click', validarLotesEContinuar);
    $('rev-voltar').addEventListener('click', function () { goStep(S.produtos.some(function (p) { return p.lotes && p.lotes.length; }) ? 'lotes' : 'prod'); });
    $('rev-enviar').addEventListener('click', enviarPedido);
    $('ok-novo').addEventListener('click', function () { window.location.reload(); });

    goStep('up');
    iniciarDoCS().catch(function (e) { console.warn('[pedido] Customer Service:', e); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
