/* ================================================================
   pi-consignacao-incompleto.js — PI · Consignação (INCOMPLETO)
   Refeita em 19/10/2026: o agente começa com DOIS caminhos.

   1. CRIAR processo de consignação
      Pergunta antes: existe ordem de devolução?
        · SIM → PDF do consignado (/api/pedido-extrair, perfil
          'consignado') → cliente pelo CNPJ no Dynamics → todas as
          DEVOLUÇÕES EM ABERTO do cliente → marca sozinho os itens e
          lotes que estão no PDF → para aí (resumo da seleção).
        · NÃO → PDF → cliente → monta o CABEÇALHO e as LINHAS da ordem
          de devolução → cria no Dynamics (ou simula, com a escrita
          desligada no servidor) → para aí.
   2. FATURAR processo de consignação
      CNPJ → código do cliente no Dynamics → as ORDENS DE VENDA EM
      ABERTO dele (com as linhas de cada uma, no clique).

   Backend: /api/consig-processo (shared/consig-d365.js). O console
   mostra o "diagnóstico do Dynamics" (os nomes reais das colunas) —
   é o que acerta as envs no 1º teste real.
   Requer na página: auth.js (token), pdf.js (CDN), pi-pdf-texto.js.
   ================================================================ */
(function () {
  'use strict';

  var API = '/api/consig-processo';
  var TRILHAS = {
    sim: [['inicio', 'Opção'], ['pergunta', 'Ordem de devolução?'], ['pdf', 'PDF'], ['dados', 'Dados do PDF'], ['devolucoes', 'Devoluções em aberto'], ['fim', 'Seleção']],
    nao: [['inicio', 'Opção'], ['pergunta', 'Ordem de devolução?'], ['pdf', 'PDF'], ['dados', 'Dados do PDF'], ['criar', 'Ordem de devolução'], ['fim', 'Resultado']],
    fat: [['inicio', 'Opção'], ['cnpj', 'Cliente'], ['ovs', 'Ordens de venda']]
  };
  var ETAPAS = ['inicio', 'pergunta', 'pdf', 'dados', 'devolucoes', 'criar', 'fim', 'cnpj', 'ovs'];

  var S = {
    caminho: null, etapa: 'inicio', estado: null,
    ext: null, arquivo: '', cliente: null, itens: [],
    devolucoes: [], totalDoCliente: 0, situacoes: [], avisosDev: [], sel: {}, marcaPdf: {}, casamento: [],
    plano: null, confirmar: false, resultado: null,
    ovs: [], ovAberta: {}, ovLinhas: {}
  };

  // ── utilidades ──────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
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
  function fmtData(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '—';
  }
  function digitos(s) { return String(s || '').replace(/\D/g, ''); }
  function mascaraCnpj(s) {
    var d = digitos(s);
    if (d.length === 14) return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12);
    if (d.length === 11) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
    return String(s || '');
  }
  // código/lote comparáveis: maiúsculo, sem espaço, ponto, traço ou barra
  function chave(s) { return String(s || '').toUpperCase().replace(/[\s.\-\/]/g, ''); }

  function msg(step, texto, tipo) {
    var el = $('st-' + step + '-msg');
    if (!el) return;
    if (!texto) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'block';
    el.className = 'pi-msg' + (tipo === 'err' ? ' pi-msg-err' : tipo === 'ok' ? ' pi-msg-ok' : tipo === 'warn' ? ' pi-msg-warn' : '');
    el.innerHTML = (tipo === 'busy' ? '<span class="pi-spin"></span> ' : '') + texto;
  }

  async function api(corpo) {
    var r = await fetch(API, corpo
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }
      : { method: 'GET' });
    var j = await r.json().catch(function () { return {}; });
    if (j && j.diagnostico) console.log('[consig] diagnóstico do Dynamics (' + ((corpo && corpo.acao) || 'estado') + '):', j.diagnostico);
    if (!r.ok) {
      var e = new Error(j.error || ('HTTP ' + r.status));
      e.dados = j; e.status = r.status;
      throw e;
    }
    return j;
  }

  // ── trilha de etapas ────────────────────────────────────────────
  function renderTrilha() {
    var t = S.caminho ? TRILHAS[S.caminho] : [['inicio', 'Escolha o caminho']];
    var idx = -1;
    t.forEach(function (x, i) { if (x[0] === S.etapa) idx = i; });
    $('cs-trilha').innerHTML = t.map(function (x, i) {
      var cls = i === idx ? ' atual' : (i < idx ? ' feito' : '');
      return '<span class="pi-step' + cls + '">' + (i + 1) + ' · ' + esc(x[1]) + '</span>';
    }).join('');
    $('cs-subtitulo').textContent = !S.caminho ? 'Criar ou faturar um processo de consignação'
      : S.caminho === 'fat' ? 'Faturar processo · ordens de venda em aberto'
      : S.caminho === 'sim' ? 'Criar processo · já existe ordem de devolução'
      : 'Criar processo · sem ordem de devolução';
    $('cs-reiniciar').hidden = S.etapa === 'inicio';
  }
  function ir(etapa) {
    S.etapa = etapa;
    ETAPAS.forEach(function (s) { var sec = $('st-' + s); if (sec) sec.hidden = (s !== etapa); });
    renderTrilha();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function reiniciar() {
    S.caminho = null; S.ext = null; S.arquivo = ''; S.cliente = null; S.itens = [];
    S.devolucoes = []; S.sel = {}; S.marcaPdf = {}; S.casamento = []; S.plano = null; S.confirmar = false; S.resultado = null;
    S.ovs = []; S.ovAberta = {}; S.ovLinhas = {};
    $('cnpj-num').value = ''; $('cnpj-cliente').innerHTML = ''; $('cnpj-manual').hidden = true;
    ['pdf', 'dados', 'devolucoes', 'criar', 'fim', 'cnpj', 'ovs'].forEach(function (s) { msg(s, ''); });
    ir('inicio');
  }

  // ── 0 · escolha do caminho ──────────────────────────────────────
  function escolher(op) {
    if (op === 'fat') { S.caminho = 'fat'; ir('cnpj'); setTimeout(function () { $('cnpj-num').focus(); }, 50); return; }
    S.caminho = 'sim';            // até a resposta da pergunta
    ir('pergunta');
  }
  function responder(existe) {
    S.caminho = existe ? 'sim' : 'nao';
    $('pdf-titulo').textContent = existe ? 'PDF do consignado' : 'PDF do consignado — nova ordem de devolução';
    $('pdf-sub').innerHTML = existe
      ? 'Anexe o documento do consignado. A IA lê cliente, paciente, convênio, médicos e os <strong>itens com lote</strong>; depois o agente busca as devoluções em aberto do cliente e marca o que está no PDF.'
      : 'Anexe o documento do consignado. A IA lê cliente, paciente, convênio, médicos e os <strong>itens com lote</strong>; com eles o agente monta o cabeçalho e as linhas da ordem de devolução.';
    ir('pdf');
  }

  // ── 1 · PDF ─────────────────────────────────────────────────────
  async function handleFile(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) { msg('pdf', 'Envie um arquivo <strong>PDF</strong>.', 'err'); return; }
    try {
      msg('pdf', 'Lendo o PDF…', 'busy');
      var buf = await file.arrayBuffer();
      var texto = '';
      try {
        if (!window.PIPDF) throw new Error('pi-pdf-texto.js não carregou');
        texto = await PIPDF.texto(buf);
      } catch (e) { console.warn('[consig] pdf.js:', e); }
      if (!texto || texto.trim().length < 40) {
        msg('pdf', 'Este PDF parece <strong>escaneado</strong> (sem texto). Use "Preencher manualmente".', 'err');
        return;
      }
      msg('pdf', 'Extraindo os dados com IA…', 'busy');
      var r = await fetch('/api/pedido-extrair', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: texto, filename: file.name, perfil: 'consignado' })
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) { msg('pdf', 'Não consegui extrair: ' + esc(j.error || ('HTTP ' + r.status)) + ' — tente de novo ou preencha manualmente.', 'err'); return; }
      S.arquivo = file.name;
      aplicarExtracao(j.dados || {}, j.avisos || []);
      msg('pdf', '');
      ir('dados');
      if (S.ext.cnpj) buscarCliente(S.ext.cnpj, 'dados');
    } catch (e) {
      msg('pdf', 'Erro ao processar o PDF: ' + esc(e.message || e), 'err');
    }
  }

  function aplicarExtracao(e, avisos) {
    S.ext = e || {};
    S.cliente = null;
    S.itens = (S.ext.produtos || []).map(function (p) {
      return { codigo: String(p.codigo || '').trim(), descricao: p.descricao || '', lote: String(p.lote || '').trim(),
               quantidade: Number(p.quantidade) || 0, valorUnitario: Number(p.valorUnitario) || 0 };
    });
    if (!S.itens.length) S.itens.push(itemVazio());
    $('dd-cnpj').value = mascaraCnpj(S.ext.cnpj || '');
    renderDados();
    var av = (avisos || []).filter(function (a) { return a && a.texto; });
    msg('dados', av.length ? '<strong>Confira:</strong> ' + av.map(function (a) { return esc(a.texto); }).join(' · ') : '', av.length ? 'warn' : '');
  }
  function itemVazio() { return { codigo: '', descricao: '', lote: '', quantidade: 1, valorUnitario: 0 }; }
  function preencherManual() {
    S.arquivo = '';
    aplicarExtracao({}, []);
    ir('dados');
    setTimeout(function () { $('dd-cnpj').focus(); }, 50);
  }

  // ── cliente pelo CNPJ (Dados do PDF e Faturar) ─────────────────
  async function buscarCliente(cnpj, onde) {
    var d = digitos(cnpj);
    var caixa = onde === 'dados' ? $('dd-cliente') : $('cnpj-cliente');
    var manual = onde === 'dados' ? $('dd-manual') : $('cnpj-manual');
    S.cliente = null;
    if (d.length !== 14 && d.length !== 11) {
      caixa.innerHTML = '<div class="cs-cli cs-cli-err">Informe o CNPJ do cliente (14 dígitos).</div>';
      manual.hidden = false;
      if (onde === 'dados') renderAcoesDados();
      return null;
    }
    caixa.innerHTML = '<div class="cs-cli"><span class="pi-spin"></span> Procurando o CNPJ ' + esc(mascaraCnpj(d)) + ' no cadastro do Dynamics…</div>';
    if (onde === 'dados') renderAcoesDados();
    try {
      var j = await api({ acao: 'cliente', cnpj: d });
      if (j.configurado === false) throw new Error(j.error || 'Conexão com o Dynamics não configurada.');
      if (!j.achou) {
        caixa.innerHTML = '<div class="cs-cli cs-cli-err">CNPJ <strong>' + esc(mascaraCnpj(d)) + '</strong> não encontrado no cadastro de clientes do Dynamics. Digite o código do cliente abaixo.</div>';
        manual.hidden = false;
      } else {
        S.cliente = { codigo: j.codigo, nome: j.nome, cnpj: d, empresa: j.empresa, empresas: j.empresas || [], bloqueado: !!j.bloqueado, bloqueio: j.bloqueio || '' };
        manual.hidden = true;
        renderCliente(caixa);
      }
    } catch (e) {
      caixa.innerHTML = '<div class="cs-cli cs-cli-err">Não consegui consultar o Dynamics: ' + esc(e.message || e) + '. Digite o código do cliente abaixo.</div>';
      manual.hidden = false;
    }
    if (onde === 'dados') renderAcoesDados();
    return S.cliente;
  }
  function renderCliente(caixa) {
    var c = S.cliente;
    var foraBio = c.empresa && c.empresa !== 'BIO';
    caixa.innerHTML = '<div class="cs-cli cs-cli-ok">' +
      '<div class="cs-cli-nome">' + esc(c.nome || '(cliente)') + '</div>' +
      '<div class="cs-cli-meta"><span class="cs-chip">Código ' + esc(c.codigo) + '</span>' +
      (c.cnpj ? '<span>CNPJ ' + esc(mascaraCnpj(c.cnpj)) + '</span>' : '') +
      (c.empresa ? '<span>Empresa ' + esc(c.empresa) + '</span>' : '') +
      (c.manual ? '<span class="cs-chip cs-chip-warn">código digitado</span>' : '') +
      (c.bloqueado ? '<span class="cs-chip cs-chip-err">bloqueado: ' + esc(c.bloqueio) + '</span>' : '') + '</div>' +
      (foraBio ? '<div class="cs-cli-aviso">⚠ Este CNPJ não tem conta na BIO no Dynamics (achei na ' + esc(c.empresa) + ').</div>' : '') +
      '</div>';
  }
  function usarCodigo(onde) {
    var inp = onde === 'dados' ? $('dd-codigo') : $('cnpj-codigo');
    var cod = String(inp.value || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9][A-Z0-9._\-]{1,29}$/.test(cod)) { inp.focus(); return null; }
    var cnpj = digitos(onde === 'dados' ? $('dd-cnpj').value : $('cnpj-num').value);
    S.cliente = { codigo: cod, nome: (onde === 'dados' && S.ext && S.ext.nomeCliente) || '', cnpj: cnpj, empresa: '', manual: true };
    renderCliente(onde === 'dados' ? $('dd-cliente') : $('cnpj-cliente'));
    (onde === 'dados' ? $('dd-manual') : $('cnpj-manual')).hidden = true;
    if (onde === 'dados') renderAcoesDados();
    return S.cliente;
  }

  // ── 2 · Dados do PDF ────────────────────────────────────────────
  function renderDados() {
    var e = S.ext || {};
    var info = [
      ['Cliente (PDF)', e.nomeCliente], ['Ordem de compra / autorização', e.ordemDeCompra], ['Paciente', e.paciente], ['Convênio', e.convenio],
      ['Médico atendimento', e.medicoAtendimento], ['Médico cirúrgico', e.medicoCirurgico], ['Data da cirurgia', e.dataCirurgia],
      ['Data do atendimento', e.dataAtendimento], ['Prontuário', e.prontuario], ['Beneficiário', e.beneficiario], ['Senha', e.senha]
    ].filter(function (x) { return x[1]; });
    $('dd-arquivo').textContent = S.arquivo ? 'Lido de: ' + S.arquivo : 'Preenchimento manual';
    $('dd-info').innerHTML = info.length ? info.map(function (x) {
      return '<div class="pi-rev-item"><span>' + esc(x[0]) + '</span><strong>' + esc(x[1]) + '</strong></div>';
    }).join('') : '<div class="pi-lote-dim">Sem dados do documento — preencha o CNPJ e os itens.</div>';
    if (!S.cliente) { $('dd-cliente').innerHTML = ''; $('dd-manual').hidden = true; }
    renderItens();
    renderAcoesDados();
  }
  function renderItens() {
    $('dd-tbody').innerHTML = S.itens.map(function (it, i) {
      function inp(k, cls, ph) {
        var v = k === 'quantidade' ? fmtQtd(it[k]) : k === 'valorUnitario' ? (it[k] ? Number(it[k]).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '') : it[k];
        return '<input class="pi-in ' + (cls || '') + ' cs-it" data-i="' + i + '" data-k="' + k + '" value="' + esc(v) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + ' aria-label="' + esc(ph || k) + ' do item ' + (i + 1) + '">';
      }
      return '<tr>' +
        '<td class="pi-td-st">' + (i + 1) + '</td>' +
        '<td>' + inp('codigo', '', 'Código') + '</td>' +
        '<td class="pi-td-nome">' + inp('descricao', '', 'Descrição') + '</td>' +
        '<td>' + inp('lote', '', 'Lote') + '</td>' +
        '<td style="width:96px;">' + inp('quantidade', 'pi-in-num', 'Qtd') + '</td>' +
        '<td style="width:120px;">' + inp('valorUnitario', 'pi-in-num', '0,00') + '</td>' +
        '<td class="pi-td-st"><button type="button" class="cs-x" data-rm="' + i + '" title="Tirar o item" aria-label="Tirar o item ' + (i + 1) + '">×</button></td>' +
        '</tr>';
    }).join('');
    $('dd-tbody').querySelectorAll('.cs-it').forEach(function (el) {
      el.addEventListener('input', function () {
        var it = S.itens[+el.getAttribute('data-i')], k = el.getAttribute('data-k');
        if (k === 'quantidade' || k === 'valorUnitario') { var n = parseNum(el.value); it[k] = isNaN(n) || n < 0 ? 0 : n; }
        else it[k] = el.value.trim();
      });
    });
    $('dd-tbody').querySelectorAll('[data-rm]').forEach(function (b) {
      b.addEventListener('click', function () {
        S.itens.splice(+b.getAttribute('data-rm'), 1);
        if (!S.itens.length) S.itens.push(itemVazio());
        renderItens();
      });
    });
  }
  function renderAcoesDados() {
    var b = $('dd-continuar');
    b.textContent = S.caminho === 'nao' ? 'Montar ordem de devolução →' : 'Buscar devoluções em aberto →';
    b.disabled = !S.cliente;
  }
  function itensValidos() {
    var bons = S.itens.filter(function (it) { return it.codigo || it.lote || it.descricao; });
    for (var i = 0; i < bons.length; i++) {
      if (!bons[i].codigo && (S.caminho === 'nao' || !bons[i].lote)) return { erro: 'Item ' + (i + 1) + ': falta o <strong>código</strong> do produto.' };
      if (!(Number(bons[i].quantidade) > 0)) return { erro: 'Item ' + (i + 1) + ' (' + esc(bons[i].codigo || bons[i].lote) + '): a <strong>quantidade</strong> deve ser maior que zero.' };
    }
    if (!bons.length) return { erro: 'Informe pelo menos <strong>um item</strong>.' };
    return { itens: bons };
  }
  async function continuarDados() {
    if (!S.cliente) { msg('dados', 'Falta o <strong>cliente</strong>: busque pelo CNPJ ou digite o código do Dynamics.', 'err'); return; }
    var v = itensValidos();
    if (v.erro) { msg('dados', v.erro, 'err'); return; }
    S.itens = v.itens;
    renderItens();
    if (S.caminho === 'nao') return planejar();
    return buscarDevolucoes();
  }

  // ── 3a · Devoluções em aberto (caminho SIM) ─────────────────────
  async function buscarDevolucoes() {
    var b = $('dd-continuar');
    b.disabled = true;
    msg('dados', 'Buscando as devoluções em aberto de <strong>' + esc(S.cliente.codigo) + '</strong> no Dynamics…', 'busy');
    try {
      var j = await api({ acao: 'devolucoes', cliente: S.cliente.codigo });
      if (j.configurado === false) throw new Error(j.error || 'Conexão com o Dynamics não configurada.');
      S.devolucoes = j.devolucoes || [];
      S.totalDoCliente = j.totalDoCliente || 0;
      S.avisosDev = j.avisos || [];
      S.situacoes = j.situacoes || [];
      casar();
      msg('dados', '');
      renderDevolucoes();
      ir('devolucoes');
    } catch (e) {
      msg('dados', 'Não consegui buscar as devoluções: ' + esc(e.message || e), 'err');
    } finally { b.disabled = !S.cliente; }
  }
  function chaveLinha(d, l, i) { return d.numero + '#' + (l.linha || ('i' + i)); }

  // marca, para cada item do PDF, as linhas de devolução do MESMO item e
  // MESMO lote (sem lote de um dos lados: só pelo item) até cobrir a qtd
  function casar() {
    var todas = [];
    S.devolucoes.forEach(function (d) { (d.linhas || []).forEach(function (l, i) { todas.push({ key: chaveLinha(d, l, i), d: d, l: l, usada: false }); }); });
    S.sel = {}; S.marcaPdf = {};
    S.casamento = S.itens.map(function (p, ip) {
      var cod = chave(p.codigo), lote = chave(p.lote), qtd = Number(p.quantidade) || 0;
      var mesmas = todas.filter(function (x) { return !x.usada && (cod ? chave(x.l.codigo) === cod : (lote && chave(x.l.lote) === lote)); });
      var porLote = lote ? mesmas.filter(function (x) { return chave(x.l.lote) === lote; }) : [];
      var semLote = mesmas.filter(function (x) { return !x.l.lote; });
      var cands = [], nivel = 'nao';
      if (porLote.length) { cands = porLote; nivel = 'lote'; }
      else if (mesmas.length && (!lote || semLote.length)) { cands = lote ? semLote : mesmas; nivel = 'item'; }
      else if (mesmas.length) nivel = 'outro-lote';
      var pegou = [], soma = 0;
      for (var k = 0; k < cands.length && soma < qtd; k++) { cands[k].usada = true; pegou.push(cands[k]); soma += Number(cands[k].l.quantidade) || 0; }
      pegou.forEach(function (x) { S.sel[x.key] = true; S.marcaPdf[x.key] = ip; });
      var status = !pegou.length ? (nivel === 'outro-lote' ? 'outro-lote' : 'nao') : (soma === qtd ? 'ok' : soma > qtd ? 'mais' : 'menos');
      return {
        ip: ip, item: p, status: status, nivel: nivel, soma: soma,
        linhas: pegou.map(function (x) { return { numero: x.d.numero, rma: x.d.rma, lote: x.l.lote, quantidade: x.l.quantidade }; }),
        outrosLotes: nivel === 'outro-lote' ? mesmas.map(function (x) { return x.l.lote; }).filter(Boolean) : []
      };
    });
  }

  function renderDevolucoes() {
    var c = S.cliente, devs = S.devolucoes;
    var nLin = devs.reduce(function (s, d) { return s + (d.linhas || []).length; }, 0);
    $('dv-resumo').innerHTML = '<strong>' + devs.length + '</strong> devolução(ões) em aberto de <strong>' + esc(c.nome || c.codigo) + '</strong> (' + esc(c.codigo) + ')' +
      ' · ' + nLin + ' linha(s)' + (S.totalDoCliente ? ' <span class="pi-lote-dim">— de ' + S.totalDoCliente + ' devolução(ões) do cliente no Dynamics</span>' : '') +
      // quantas em cada situação: mostra na hora quando a regra de "em aberto" não bate com o Dynamics
      (S.situacoes.length ? '<span class="cs-situacoes">Situação das devoluções do cliente: ' + S.situacoes.map(function (x) {
        return esc(x.rotulo || x.valor) + (x.rotulo && x.rotulo !== x.valor ? ' <span class="pi-lote-dim">(' + esc(x.valor) + ')</span>' : '') + ' <strong>' + x.n + '</strong>';
      }).join(' · ') + '</span>' : '');
    $('dv-avisos').innerHTML = S.avisosDev.length ? '<div class="pi-msg pi-msg-warn" style="display:block;">' + S.avisosDev.map(esc).join('<br>') + '</div>' : '';

    if (!devs.length) {
      $('dv-lista').innerHTML = '<div class="cs-vazio"><strong>Nenhuma devolução em aberto</strong> para este cliente no Dynamics.<br>' +
        '<span class="pi-lote-dim">Se a ordem de devolução ainda não existe, volte ao início e responda <strong>Não</strong> — o agente cria a ordem a partir do PDF.</span></div>';
    } else {
      $('dv-lista').innerHTML = devs.map(function (d) {
        var linhas = (d.linhas || []).map(function (l, i) {
          var k = chaveLinha(d, l, i), sel = !!S.sel[k], ip = S.marcaPdf[k];
          return '<tr class="' + (sel ? 'cs-row-sel' : '') + '">' +
            '<td class="pi-td-st"><input type="checkbox" class="cs-sel" data-k="' + esc(k) + '"' + (sel ? ' checked' : '') + ' aria-label="Selecionar ' + esc(l.codigo) + '"></td>' +
            '<td>' + esc(l.codigo) + '</td>' +
            '<td class="pi-td-nome">' + esc(l.descricao || '—') + (l.lotId ? '<div class="pi-lote-dim">Return lot ID: ' + esc(l.lotId) + '</div>' : '') + '</td>' +
            '<td>' + (l.lote ? esc(l.lote) : '<span class="pi-lote-dim">—</span>') + '</td>' +
            '<td class="pi-num">' + fmtQtd(l.quantidade) + '</td>' +
            '<td>' + (l.situacao ? '<span class="cs-chip">' + esc(l.situacao) + '</span>' : '<span class="pi-lote-dim">—</span>') + '</td>' +
            '<td>' + (ip != null ? '<span class="cs-chip cs-chip-ok">PDF item ' + (ip + 1) + '</span>' : '<span class="pi-lote-dim">—</span>') + '</td>' +
            '</tr>';
        }).join('');
        return '<div class="cs-dev">' +
          '<div class="cs-dev-head"><strong>' + esc(d.rma || d.numero) + '</strong>' +
          (d.rma ? '<span>Ordem ' + esc(d.numero) + '</span>' : '') +
          '<span class="cs-chip cs-chip-ok">' + esc(d.situacao || 'Em aberto') + '</span>' +
          (d.referencia ? '<span>Ref.: ' + esc(d.referencia) + '</span>' : '') +
          (d.prazo ? '<span>Prazo: ' + esc(fmtData(d.prazo)) + '</span>' : '') +
          (d.motivo ? '<span>Motivo: ' + esc(d.motivo) + '</span>' : '') + '</div>' +
          (linhas ? '<div class="pi-table-wrap"><table class="pi-table"><thead><tr><th></th><th>Código</th><th>Produto</th><th>Lote</th><th style="text-align:right;">Qtd</th><th>Situação</th><th>No PDF</th></tr></thead><tbody>' + linhas + '</tbody></table></div>'
                  : '<div class="pi-lote-dim" style="padding:10px 14px;">Sem linhas.</div>') +
          '</div>';
      }).join('');
      $('dv-lista').querySelectorAll('.cs-sel').forEach(function (chk) {
        chk.addEventListener('change', function () {
          var k = chk.getAttribute('data-k');
          if (chk.checked) S.sel[k] = true; else delete S.sel[k];
          chk.closest('tr').classList.toggle('cs-row-sel', chk.checked);
          contarSelecao();
        });
      });
    }
    renderConferencia();
    contarSelecao();
  }

  function textoCasamento(c) {
    var p = c.item, alvo = c.linhas.map(function (l) { return (l.rma || l.numero) + (l.lote ? ' (lote ' + l.lote + ')' : ''); }).join(', ');
    if (c.status === 'ok') return { cls: 'ok', ic: '✓', t: 'em ' + alvo + (c.nivel === 'item' ? ' — lote não conferido' : '') };
    if (c.status === 'mais') return { cls: 'warn', ic: '⚠', t: 'em ' + alvo + ' — a devolução tem ' + fmtQtd(c.soma) + ', o PDF tem ' + fmtQtd(p.quantidade) };
    if (c.status === 'menos') return { cls: 'warn', ic: '⚠', t: 'só ' + fmtQtd(c.soma) + ' de ' + fmtQtd(p.quantidade) + ' em devoluções em aberto (' + alvo + ')' };
    if (c.status === 'outro-lote') return { cls: 'err', ic: '✗', t: 'o item está em devolução em aberto, mas com outro lote (' + (c.outrosLotes.join(', ') || 'sem lote') + ')' };
    return { cls: 'err', ic: '✗', t: 'não está em nenhuma devolução em aberto deste cliente' };
  }
  function renderConferencia() {
    var ok = S.casamento.filter(function (c) { return c.status === 'ok'; }).length;
    $('dv-conf-tt').textContent = 'Itens do PDF · ' + ok + ' de ' + S.casamento.length + ' conferem';
    $('dv-conf').innerHTML = S.casamento.map(function (c) {
      var t = textoCasamento(c);
      return '<li class="cs-conf-' + t.cls + '"><span class="cs-conf-ic">' + t.ic + '</span><span><strong>' + (c.ip + 1) + '. ' + esc(c.item.codigo || '(sem código)') + '</strong>' +
        (c.item.lote ? ' · lote ' + esc(c.item.lote) : '') + ' · qtd ' + fmtQtd(c.item.quantidade) + ' — ' + esc(t.t) + '</span></li>';
    }).join('');
  }
  function selecionadas() {
    var out = [];
    S.devolucoes.forEach(function (d) { (d.linhas || []).forEach(function (l, i) { var k = chaveLinha(d, l, i); if (S.sel[k]) out.push({ d: d, l: l, k: k, ip: S.marcaPdf[k] }); }); });
    return out;
  }
  function contarSelecao() {
    var n = selecionadas().length;
    $('dv-contador').textContent = n + ' linha(s) selecionada(s)';
    $('dv-concluir').disabled = !n;
  }
  function concluirSelecao() {
    var sel = selecionadas();
    if (!sel.length) { msg('devolucoes', 'Selecione pelo menos <strong>uma linha</strong>.', 'err'); return; }
    msg('devolucoes', '');
    var faltam = S.casamento.filter(function (c) { return c.status === 'nao' || c.status === 'outro-lote'; });
    var porDev = {};
    sel.forEach(function (x) { (porDev[x.d.numero] = porDev[x.d.numero] || { d: x.d, linhas: [] }).linhas.push(x); });
    var html = '<div class="cs-fim-tt"><span class="cs-fim-ic">✓</span><div><h3>Seleção concluída</h3>' +
      '<p class="pi-sub" style="margin:0;">' + sel.length + ' linha(s) de ' + Object.keys(porDev).length + ' devolução(ões) em aberto de <strong>' + esc(S.cliente.nome || S.cliente.codigo) + '</strong> (' + esc(S.cliente.codigo) + ').</p></div></div>' +
      '<div class="pi-table-wrap"><table class="pi-table"><thead><tr><th>Devolução</th><th>Código</th><th>Produto</th><th>Lote</th><th style="text-align:right;">Qtd</th><th>Return lot ID</th><th>No PDF</th></tr></thead><tbody>' +
      sel.map(function (x) {
        return '<tr><td><strong>' + esc(x.d.rma || x.d.numero) + '</strong>' + (x.d.rma ? '<div class="pi-lote-dim">' + esc(x.d.numero) + '</div>' : '') + '</td><td>' + esc(x.l.codigo) + '</td><td class="pi-td-nome">' + esc(x.l.descricao || '—') + '</td>' +
          '<td>' + esc(x.l.lote || '—') + '</td><td class="pi-num">' + fmtQtd(x.l.quantidade) + '</td><td>' + esc(x.l.lotId || '—') + '</td>' +
          '<td>' + (x.ip != null ? 'item ' + (x.ip + 1) : '<span class="pi-lote-dim">marcado à mão</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (faltam.length ? '<div class="pi-msg pi-msg-err" style="display:block;"><strong>' + faltam.length + ' item(ns) do PDF sem devolução em aberto:</strong> ' +
        faltam.map(function (c) { return esc((c.item.codigo || '(sem código)') + (c.item.lote ? ' · lote ' + c.item.lote : '')); }).join(' · ') + '</div>' : '') +
      '<div class="pi-msg" style="display:block;">Por enquanto o agente <strong>para aqui</strong>: a seleção fica na tela (copie o resumo se precisar). O faturamento a partir dela entra na próxima etapa.</div>';
    S.resultado = { tipo: 'selecao', texto: resumoSelecao(sel, faltam) };
    $('fim-conteudo').innerHTML = html;
    $('fim-copiar').hidden = false;
    $('fim-voltar').hidden = false;
    ir('fim');
  }
  function resumoSelecao(sel, faltam) {
    var e = S.ext || {}, out = [];
    out.push('PROCESSO DE CONSIGNAÇÃO — devoluções em aberto selecionadas');
    out.push('Cliente: ' + (S.cliente.nome || '') + ' (' + S.cliente.codigo + ')' + (S.cliente.cnpj ? ' — CNPJ ' + mascaraCnpj(S.cliente.cnpj) : ''));
    if (e.paciente) out.push('Paciente: ' + e.paciente + (e.convenio ? ' | Convênio: ' + e.convenio : '') + (e.senha ? ' | Senha: ' + e.senha : ''));
    if (e.ordemDeCompra) out.push('OC/Autorização: ' + e.ordemDeCompra);
    out.push('');
    sel.forEach(function (x, i) {
      out.push((i + 1) + '. ' + (x.d.rma || x.d.numero) + ' | ' + x.l.codigo + ' — ' + (x.l.descricao || '') + ' | Lote: ' + (x.l.lote || '—') + ' | Qtd: ' + fmtQtd(x.l.quantidade) + (x.l.lotId ? ' | Return lot ID: ' + x.l.lotId : ''));
    });
    if (faltam.length) { out.push(''); out.push('Sem devolução em aberto: ' + faltam.map(function (c) { return (c.item.codigo || '?') + (c.item.lote ? ' (lote ' + c.item.lote + ')' : ''); }).join(', ')); }
    return out.join('\n');
  }

  // ── 3b · Criar a ordem de devolução (caminho NÃO) ───────────────
  function corpoDevolucao(acao) {
    return {
      acao: acao, cliente: S.cliente.codigo, referencia: (S.ext && S.ext.ordemDeCompra) || '',
      itens: S.itens.map(function (it) { return { codigo: it.codigo, descricao: it.descricao, lote: it.lote, quantidade: it.quantidade }; })
    };
  }
  async function planejar() {
    var b = $('dd-continuar');
    b.disabled = true;
    msg('dados', 'Montando a ordem de devolução com as colunas do Dynamics…', 'busy');
    try {
      var j = await api(corpoDevolucao('planejar'));
      if (j.configurado === false) throw new Error(j.error || 'Conexão com o Dynamics não configurada.');
      S.plano = j; S.confirmar = false;
      msg('dados', '');
      renderPlano();
      ir('criar');
    } catch (e) {
      msg('dados', 'Não consegui montar a ordem de devolução: ' + esc(e.message || e), 'err');
    } finally { b.disabled = !S.cliente; }
  }
  function tabelaMapa(mapa) {
    if (!mapa || !mapa.length) return '<div class="pi-lote-dim">—</div>';
    return '<table class="cs-map"><tbody>' + mapa.map(function (m) {
      return '<tr><td>' + esc(m.papel) + '</td><td><code>' + esc(m.coluna) + '</code></td><td>' + esc(m.valor) + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  function renderPlano() {
    var p = S.plano, grava = p.escrita && p.podeGravar;
    $('cr-modo').className = 'cs-modo ' + (grava ? 'cs-modo-grava' : p.escrita ? 'cs-modo-bloq' : 'cs-modo-sim');
    $('cr-modo').innerHTML = grava
      ? '<strong>Gravação ligada.</strong> O botão abaixo cria a ordem de devolução no Dynamics (empresa ' + esc(p.empresa) + ').'
      : p.escrita
        ? '<strong>Você não pode gravar no Dynamics:</strong> ' + esc(p.motivoNaoGrava || '') + ' — dá para simular.'
        : '<strong>Modo simulação.</strong> Nada é gravado no Dynamics: o servidor está com a escrita desligada (<code>CONSIG_D365_ESCRITA</code>). O botão mostra exatamente o que seria enviado.';
    var qtdNeg = (p.requisicoes || []).slice(1).some(function (r) { return Object.keys(r.corpo).some(function (k) { return typeof r.corpo[k] === 'number' && r.corpo[k] < 0; }); });
    $('cr-cab').innerHTML = [
      ['Cliente', (S.cliente.nome ? S.cliente.nome + ' · ' : '') + S.cliente.codigo],
      ['Empresa', p.empresa], ['Referência (OC/autorização)', (S.ext && S.ext.ordemDeCompra) || '—'], ['Linhas', String((p.linhas.itens || []).length)]
    ].map(function (x) { return '<div class="pi-rev-item"><span>' + esc(x[0]) + '</span><strong>' + esc(x[1]) + '</strong></div>'; }).join('');
    $('cr-tbody').innerHTML = (p.linhas.itens || []).map(function (it, i) {
      return '<tr><td class="pi-td-st">' + (i + 1) + '</td><td>' + esc(it.codigo) + '</td><td class="pi-td-nome">' + esc(it.descricao || '—') + '</td><td>' + esc(it.lote || '—') + '</td>' +
        '<td class="pi-num">' + fmtQtd(it.quantidade) + '</td></tr>';
    }).join('');
    $('cr-nota-qtd').hidden = !qtdNeg;
    var av = (p.avisos || []), er = (p.erros || []);
    $('cr-avisos').innerHTML = (er.length ? '<div class="pi-msg pi-msg-err" style="display:block;"><strong>Não dá para criar:</strong><br>' + er.map(esc).join('<br>') + '</div>' : '') +
      (av.length ? '<div class="pi-msg pi-msg-warn" style="display:block;">' + av.map(esc).join('<br>') + '</div>' : '');
    $('cr-map-cab').innerHTML = '<div class="cs-map-tt">Cabeçalho → <code>' + esc(p.cabecalho.entidade) + '</code>' + (p.cabecalho.sondado ? '' : ' <span class="pi-lote-dim">(colunas não conferidas)</span>') + '</div>' + tabelaMapa(p.cabecalho.mapeamento);
    $('cr-map-lin').innerHTML = '<div class="cs-map-tt">Cada linha → <code>' + esc(p.linhas.entidade) + '</code>' + (p.linhas.sondado ? '' : ' <span class="pi-lote-dim">(colunas não conferidas)</span>') + '</div>' + tabelaMapa(p.linhas.mapeamento);
    $('cr-json').textContent = JSON.stringify(p.requisicoes || [], null, 2);
    var b = $('cr-criar');
    b.disabled = !!er.length;
    b.textContent = grava ? '✅ Criar ordem de devolução no Dynamics' : '▶ Simular a criação';
    msg('criar', '');
  }
  async function criar() {
    var p = S.plano, grava = p.escrita && p.podeGravar, b = $('cr-criar');
    if (grava && !S.confirmar) {
      S.confirmar = true;
      msg('criar', 'Confirma criar no Dynamics a ordem de devolução de <strong>' + esc(S.cliente.codigo) + '</strong> com <strong>' + (p.linhas.itens || []).length + ' linha(s)</strong>? Clique de novo para confirmar.', 'warn');
      b.textContent = '✅ Confirmar: criar no Dynamics';
      return;
    }
    b.disabled = true;
    msg('criar', grava ? 'Criando a ordem de devolução no Dynamics…' : 'Simulando…', 'busy');
    try {
      var j = await api(corpoDevolucao('criar'));
      S.resultado = { tipo: j.gravado ? 'criada' : 'simulacao', dados: j };
      msg('criar', '');
      renderResultadoCriacao(j);
      ir('fim');
    } catch (e) {
      var d = e.dados || {};
      var extra = '';
      if (d.numero && d.desfeito === true) extra = '<br>A ordem <strong>' + esc(d.numero) + '</strong> que tinha sido aberta foi <strong>apagada</strong> — nada ficou no Dynamics.';
      if (d.numero && d.desfeito === false) extra = '<br><strong>Atenção:</strong> a ordem <strong>' + esc(d.numero) + '</strong> ficou no Dynamics com ' + (d.linhasGravadas || 0) + ' linha(s) — confira e apague lá antes de tentar de novo.';
      msg('criar', 'Não criei: ' + esc(e.message || e) + extra, 'err');
      S.confirmar = false;
      b.disabled = false;
      b.textContent = grava ? '✅ Criar ordem de devolução no Dynamics' : '▶ Simular a criação';
    }
  }
  function renderResultadoCriacao(j) {
    var html;
    if (j.gravado) {
      html = '<div class="cs-fim-tt"><span class="cs-fim-ic">✓</span><div><h3>Ordem de devolução criada no Dynamics</h3>' +
        '<p class="pi-sub" style="margin:0;"><strong>' + esc(j.rma || j.numero) + '</strong>' + (j.rma ? ' · ordem ' + esc(j.numero) : '') + ' · ' + (j.linhas || []).length + ' linha(s) · cliente ' + esc(S.cliente.codigo) +
        (j.repetido ? ' <span class="cs-chip cs-chip-warn">já tinha sido criada agora há pouco — não criei outra</span>' : '') + '</p></div></div>' +
        '<div class="pi-table-wrap"><table class="pi-table"><thead><tr><th>#</th><th>Código</th><th>Lote</th><th style="text-align:right;">Qtd</th></tr></thead><tbody>' +
        (j.linhas || []).map(function (l, i) { return '<tr><td class="pi-td-st">' + (i + 1) + '</td><td>' + esc(l.codigo) + '</td><td>' + esc(l.lote || '—') + '</td><td class="pi-num">' + fmtQtd(l.quantidade) + '</td></tr>'; }).join('') +
        '</tbody></table></div>' +
        '<div class="pi-msg" style="display:block;">Por enquanto o agente <strong>para aqui</strong>. A ordem fica no Dynamics para a próxima etapa (amarrar à remessa e faturar).</div>';
    } else {
      html = '<div class="cs-fim-tt"><span class="cs-fim-ic cs-fim-ic-sim">▶</span><div><h3>Simulação concluída — nada foi gravado</h3>' +
        '<p class="pi-sub" style="margin:0;">Estas são as ' + (j.requisicoes || []).length + ' requisições que o portal faria no Dynamics (1 cabeçalho + ' + ((j.requisicoes || []).length - 1) + ' linha(s)).</p></div></div>' +
        '<pre class="cs-json">' + esc(JSON.stringify(j.requisicoes || [], null, 2)) + '</pre>' +
        '<div class="pi-msg" style="display:block;">Para criar de verdade, a TI liga <code>CONSIG_D365_ESCRITA=true</code> nas configurações da Static Web App (e o usuário de serviço do Dynamics precisa de permissão para criar ordem de devolução).</div>';
    }
    $('fim-conteudo').innerHTML = html;
    $('fim-copiar').hidden = true;
    $('fim-voltar').hidden = !!j.gravado;
  }

  // ── Faturar: CNPJ → ordens de venda em aberto ───────────────────
  async function buscarFaturar() {
    msg('cnpj', '');
    var c = await buscarCliente($('cnpj-num').value, 'cnpj');
    if (c) carregarOvs();
  }
  async function carregarOvs() {
    if (!S.cliente) { msg('cnpj', 'Falta o <strong>cliente</strong>.', 'err'); return; }
    var naTela = S.etapa === 'ovs' ? 'ovs' : 'cnpj';
    msg(naTela, 'Buscando as ordens de venda em aberto de <strong>' + esc(S.cliente.codigo) + '</strong>…', 'busy');
    try {
      var j = await api({ acao: 'ovs', cliente: S.cliente.codigo });
      if (j.configurado === false) throw new Error(j.error || 'Conexão com o Dynamics não configurada.');
      S.ovs = j.ovs || []; S.ovAberta = {}; S.ovLinhas = {};
      msg(naTela, '');
      renderOvs(j.avisos || []);
      ir('ovs');
    } catch (e) {
      msg(naTela, 'Não consegui buscar as ordens de venda: ' + esc(e.message || e), 'err');
    }
  }
  function renderOvs(avisos) {
    var c = S.cliente;
    $('ov-resumo').innerHTML = '<strong>' + S.ovs.length + '</strong> ordem(ns) de venda em aberto de <strong>' + esc(c.nome || c.codigo) + '</strong> (' + esc(c.codigo) + ')';
    if (avisos) $('ov-avisos').innerHTML = avisos.length ? '<div class="pi-msg pi-msg-warn" style="display:block;">' + avisos.map(esc).join('<br>') + '</div>' : '';
    if (!S.ovs.length) {
      $('ov-tbody').innerHTML = '<tr><td colspan="8"><div class="cs-vazio"><strong>Nenhuma ordem de venda em aberto</strong> para este cliente no Dynamics.</div></td></tr>';
      return;
    }
    $('ov-tbody').innerHTML = S.ovs.map(function (o, i) {
      var aberta = !!S.ovAberta[o.numero];
      var lin = '';
      if (aberta) {
        var L = S.ovLinhas[o.numero];
        lin = '<tr class="cs-ov-lin"><td colspan="8">' + (!L ? '<span class="pi-spin"></span> Lendo as linhas…'
          : L.erro ? '<span class="cs-txt-err">Não consegui ler as linhas: ' + esc(L.erro) + '</span>'
          : !L.linhas.length ? '<span class="pi-lote-dim">Sem linhas.</span>'
          : '<table class="cs-mini"><thead><tr><th>Código</th><th>Produto</th><th>Lote</th><th style="text-align:right;">Qtd</th><th style="text-align:right;">Preço</th><th style="text-align:right;">Valor</th><th>Situação</th></tr></thead><tbody>' +
            L.linhas.map(function (l) {
              return '<tr><td>' + esc(l.codigo) + '</td><td>' + esc(l.descricao || '—') + '</td><td>' + esc(l.lote || '—') + '</td><td class="pi-num">' + fmtQtd(l.quantidade) + '</td>' +
                '<td class="pi-num">' + fmtMoney(l.preco) + '</td><td class="pi-num">' + fmtMoney(l.valor) + '</td><td>' + esc(l.situacao || '—') + '</td></tr>';
            }).join('') + '<tr class="cs-mini-tot"><td colspan="5">Total da ordem</td><td class="pi-num">' + fmtMoney(L.total) + '</td><td></td></tr></tbody></table>') + '</td></tr>';
      }
      return '<tr>' +
        '<td><strong>' + esc(o.numero) + '</strong></td><td>' + esc(fmtData(o.criadaEm)) + '</td><td>' + esc(o.oc || '—') + '</td>' +
        '<td>' + esc(o.entrega ? fmtData(o.entrega) : '—') + '</td><td>' + esc(o.deposito || '—') + '</td><td>' + esc(o.pool || '—') + '</td>' +
        '<td><span class="cs-chip cs-chip-ok">' + esc(o.situacao || 'Em aberto') + '</span></td>' +
        '<td style="text-align:right;"><button type="button" class="pi-btn pi-btn-ghost cs-btn-sm" data-ov="' + i + '" aria-expanded="' + aberta + '">' + (aberta ? 'Fechar ▴' : 'Itens ▾') + '</button></td>' +
        '</tr>' + lin;
    }).join('');
    $('ov-tbody').querySelectorAll('[data-ov]').forEach(function (b) {
      b.addEventListener('click', function () { alternarOv(S.ovs[+b.getAttribute('data-ov')].numero); });
    });
  }
  async function alternarOv(numero) {
    S.ovAberta[numero] = !S.ovAberta[numero];
    renderOvs();
    if (!S.ovAberta[numero] || S.ovLinhas[numero]) return;
    try {
      var j = await api({ acao: 'ovLinhas', ov: numero });
      S.ovLinhas[numero] = { linhas: j.linhas || [], total: j.total || 0 };
    } catch (e) {
      S.ovLinhas[numero] = { erro: e.message || String(e), linhas: [] };
    }
    renderOvs();
  }

  // ── fim ──────────────────────────────────────────────────────────
  async function copiarResumo() {
    var t = (S.resultado && S.resultado.texto) || '';
    try { await navigator.clipboard.writeText(t); msg('fim', 'Resumo copiado.', 'ok'); }
    catch (e) { msg('fim', 'Não consegui copiar automaticamente — selecione o texto abaixo.<pre class="cs-json">' + esc(t) + '</pre>', 'warn'); }
  }

  // ── início ───────────────────────────────────────────────────────
  async function carregarEstado() {
    try {
      S.estado = await api();
      if (S.estado.configurado === false) {
        $('in-aviso').innerHTML = '<div class="pi-msg pi-msg-err" style="display:block;">Conexão com o Dynamics ainda não configurada (credenciais D365 na Static Web App) — as consultas não vão funcionar.</div>';
      }
    } catch (e) { console.warn('[consig] estado:', e); }
  }

  function init() {
    document.querySelectorAll('[data-caminho]').forEach(function (b) {
      b.addEventListener('click', function () { escolher(b.getAttribute('data-caminho')); });
    });
    $('cs-reiniciar').addEventListener('click', reiniciar);
    $('pg-sim').addEventListener('click', function () { responder(true); });
    $('pg-nao').addEventListener('click', function () { responder(false); });
    $('pg-voltar').addEventListener('click', reiniciar);

    var dz = $('pdf-drop'), fi = $('pdf-file');
    dz.addEventListener('click', function () { fi.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('drag'); });
    dz.addEventListener('drop', function (e) { e.preventDefault(); dz.classList.remove('drag'); handleFile(e.dataTransfer.files && e.dataTransfer.files[0]); });
    fi.addEventListener('change', function () { handleFile(fi.files && fi.files[0]); fi.value = ''; });
    $('pdf-manual').addEventListener('click', preencherManual);
    $('pdf-voltar').addEventListener('click', function () { ir('pergunta'); });

    $('dd-buscar').addEventListener('click', function () { buscarCliente($('dd-cnpj').value, 'dados'); });
    $('dd-cnpj').addEventListener('keydown', function (e) { if (e.key === 'Enter') buscarCliente($('dd-cnpj').value, 'dados'); });
    $('dd-cnpj').addEventListener('blur', function () { $('dd-cnpj').value = mascaraCnpj($('dd-cnpj').value); });
    $('dd-usar').addEventListener('click', function () { usarCodigo('dados'); });
    $('dd-codigo').addEventListener('keydown', function (e) { if (e.key === 'Enter') usarCodigo('dados'); });
    $('dd-add').addEventListener('click', function () { S.itens.push(itemVazio()); renderItens(); });
    $('dd-voltar').addEventListener('click', function () { ir('pdf'); });
    $('dd-continuar').addEventListener('click', continuarDados);

    $('dv-voltar').addEventListener('click', function () { ir('dados'); });
    $('dv-concluir').addEventListener('click', concluirSelecao);
    $('dv-remarcar').addEventListener('click', function () { casar(); renderDevolucoes(); });

    $('cr-voltar').addEventListener('click', function () { ir('dados'); });
    $('cr-criar').addEventListener('click', criar);

    $('cnpj-buscar').addEventListener('click', buscarFaturar);
    $('cnpj-num').addEventListener('keydown', function (e) { if (e.key === 'Enter') buscarFaturar(); });
    $('cnpj-num').addEventListener('blur', function () { $('cnpj-num').value = mascaraCnpj($('cnpj-num').value); });
    $('cnpj-usar').addEventListener('click', function () { if (usarCodigo('cnpj')) carregarOvs(); });
    $('cnpj-codigo').addEventListener('keydown', function (e) { if (e.key === 'Enter' && usarCodigo('cnpj')) carregarOvs(); });
    $('cnpj-voltar').addEventListener('click', reiniciar);
    $('ov-voltar').addEventListener('click', function () { ir('cnpj'); });
    $('ov-atualizar').addEventListener('click', carregarOvs);

    $('fim-copiar').addEventListener('click', copiarResumo);
    $('fim-voltar').addEventListener('click', function () { ir(S.caminho === 'nao' ? 'criar' : 'devolucoes'); });
    $('fim-novo').addEventListener('click', reiniciar);

    ir('inicio');
    carregarEstado();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
