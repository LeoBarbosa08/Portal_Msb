/* ================================================================
   comercial-carteira-clientes.js — CARTEIRA DE CLIENTES do Comercial
   (pages/comercial-carteira-clientes.html)

   Uma tela para achar o cliente e ver tudo dele, com os dois sistemas
   lado a lado. Os dados vêm de /api/carteira-clientes, que cruza o
   cadastro de clientes do Dynamics 365 com as Contas do Salesforce pelo
   CNPJ (só os dígitos — as máscaras dos dois não batem).

   1. BUSCA — tudo do cliente (18/11/2026). Na hora, no que a lista tem:
      nome, fantasia, CNPJ/CPF (com ou sem máscara), código do Dynamics,
      Código ERP e Id da conta do SF (ou o link dela), cidade, UF, rede.
      Logo depois, no servidor (?busca=): e-mail, telefone, IE, CEP,
      endereço, Identificador… dos dois cadastros e os CONTATOS, a conta e
      as oportunidades no Salesforce — esses entram no fim da lista com
      "onde achou". CNPJ completo + Enter abre a ficha direto, mesmo com a
      carteira ainda carregando.
   2. NÚMEROS — total, nos dois sistemas, só no Dynamics, só no
      Salesforce e pendências de cadastro. Clicar filtra.
   3. AGRUPAR POR — UF, dono da conta, tipo de cliente, unidade, grupo do
      Dynamics, empresa e pendência; cada barra mostra quanto de cada
      grupo está nos dois sistemas. Clicar filtra.
   4. LISTA — uma linha por cliente; clique abre a FICHA: o mesmo campo
      nos dois sistemas lado a lado (diferença marcada), a conta do SF,
      e os contatos.
   5. PEDIR CADASTRO NO ERP (18/11/2026) — na ficha de quem só está no
      Salesforce: e-mail da caixa de quem pede, com os dados da conta, a
      Receita, os contatos e os arquivos escolhidos (POST { erp }). A lista
      marca "pedido em dd/mm".

   ?cliente=<chave> na URL abre a ficha (link para mandar a um colega).

   ESPELHO NA ÁREA VENDEDOR (19/11/2026): pages/vendedor-carteira-clientes.html
   carrega ESTE arquivo com <body data-cc-espelho> — a mesma carteira (busca,
   números, agrupar por, lista e ficha), SÓ PARA CONSULTA: sem nova conta,
   criar conta no CRM, pedido de cadastro no ERP, novo contato, anexar
   arquivo nem incluir descrição. Ler o arquivo da conta, o Dossiê de Cliente
   e copiar o link continuam. O servidor confere de novo: a área Vendedor só
   faz GET de leitura (api/carteira-clientes).
   20/11/2026: o espelho também mora DENTRO da Minha carteira (aba Clientes ›
   Carteira de Clientes, vendedor-carteira.js) — o contêiner leva o
   data-cc-espelho, e os cliques que este arquivo ouve na página inteira valem
   só dentro da área dele (.cc-raiz, a ficha e o modal), para não pegar os
   cliques das outras telas da página.

   RECORTE MSB (27/11/2026) — trazido do portal completo (origin/master
   e6ac11c de Claude.rep) a pedido do dono: "a carteira de clientes toda,
   só que eles não podem criar conta: é apenas um espelho" e "só pode
   apontar para coisas que existem no portal da MSB". Ao trazer novidades de
   lá, copie este arquivo e reaplique os trechos marcados RECORTE MSB:
   - ESPELHO sempre ligado (abaixo): sem nova conta, criar conta no CRM,
     pedir cadastro no ERP, novo contato, anexar arquivo nem incluir
     descrição. O /api/carteira-clientes daqui nem aceita POST;
   - a ficha sem o botão do Dossiê de Cliente (a página está oculta no
     portal da MSB desde o recorte de 20/10/2026) e sem a visão 360 do
     portal-elo.js (que não existe aqui);
   - a mensagem do 403 fala só da área Comercial (não há área Vendedor).
   ================================================================ */
(function () {
  'use strict';

  // RECORTE MSB: no portal da MSB a Carteira é SEMPRE o espelho (só consulta)
  var ESPELHO = true;
  // a área da Carteira (a página que não tem .cc-raiz é a de antes: vale a página toda)
  var ESCOPO = document.querySelector('.cc-raiz') ? '.cc-raiz, #cc-ficha, #cc-ov, #cc-nova, #cc-toast' : null;
  var API = '/api/carteira-clientes';
  var POR_PAG = 25;   // 25 por página (27/11/2026): a lista desenha menos e a troca de página é leve
  // um comparador só para a ordenação (o localeCompare com 'pt-BR' monta um a cada chamada: pesado em 12 mil clientes)
  var COLL = new Intl.Collator('pt-BR');
  var COR = { erp: '#22A061', ambos: '#22A061', d365: '#287A8E', sf: '#D9822B' };
  var IC_ERP = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>';
  var IC_MAIS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  // tudo é cliente: o que importa é se ele tem cadastro no ERP (Dynamics) ou não
  var SIT = { erp: 'Com cadastro no ERP', sf: 'Sem cadastro no ERP' };
  function ladoSit(sit) { return sit === 'sf' ? 'sf' : 'erp'; }
  var DIMS = [
    { id: 'uf', rot: 'UF', campo: 'uf' },
    { id: 'dono', rot: 'Dono da conta', campo: 'dono', vazio: '(sem conta no CRM)' },
    { id: 'tipo', rot: 'Tipo de cliente', campo: 'tipo', vazio: '(sem tipo)' },
    { id: 'unid', rot: 'Unidade', campo: 'unid', vazio: '(sem unidade)' },
    { id: 'grupo', rot: 'Grupo (Dynamics)', campo: 'grupo', vazio: '(fora do Dynamics)' },
    { id: 'emp', rot: 'Empresa', campo: 'empresasL', multi: true, vazio: '(fora do Dynamics)' },
    { id: 'al', rot: 'Pendências', campo: 'alertas', multi: true, soAlertas: true }
  ];
  // cópia em ordem alfabética do rótulo para os botões do "Agrupar por" (o
  // DIMS acima segue na ordem de sempre: UF continua a dimensão padrão)
  var DIMS_SEG = DIMS.slice().sort(function (a, b) { return a.rot.localeCompare(b.rot, 'pt-BR', { sensitivity: 'base', numeric: true }); });

  var ST = {
    todos: [], alertas: {}, resumo: null, fontes: null, eu: '', sfInst: null,
    q: '', qB: null, fundo: null, sit: null, pend: false, minha: false, sel: {}, dim: 'uf',
    ord: { c: 'nome', d: 1 }, pag: 0, filtrados: [], seq: 0, fichaSeq: 0, fichaK: null, tentativas: 0
  };
  DIMS.forEach(function (d) { ST.sel[d.id] = new Set(); });

  // ── utilitários ─────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function dorme(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function dig(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
  function fINT(v) { return v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
  function fBRL(v) { return v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); }
  function fPct(p) { return !isFinite(p) ? '—' : (p * 100).toLocaleString('pt-BR', { maximumFractionDigits: p < 0.1 ? 1 : 0 }) + '%'; }
  function fData(d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '—'; }
  function fDoc(d) {
    d = dig(d);
    if (d.length === 14) return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12);
    if (d.length === 11) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
    return d || '—';
  }
  function linkSf(id, obj) { return ST.sfInst && id ? ST.sfInst.replace(/\/$/, '') + '/lightning/r/' + (obj || 'Account') + '/' + encodeURIComponent(id) + '/view' : null; }
  function selo(sit) { var l = ladoSit(sit); return '<span class="cc-sit ' + (l === 'erp' ? 'ambos' : 'sf') + '"><i></i>' + esc(SIT[l]) + '</span>'; }
  function seloAlerta(a) {
    var c = ST.alertas[a] || { tipo: 'cadastro', rot: a };
    var forte = a === 'bloqueado' || a === 'restricao';
    return '<span class="cc-al ' + c.tipo + (forte ? ' forte' : '') + '" title="' + esc(c.desc || '') + '">' + esc(c.rot) + '</span>';
  }
  function ehPendencia(a) { var c = ST.alertas[a]; return !!c && c.tipo === 'cadastro'; }
  // pendência de cadastro só conta onde há dados no ERP (Dynamics); só no Salesforce fica de fora
  function temPendencia(c) { return c.sit !== 'sf' && c.alertas.some(ehPendencia); }
  var _toastT = null;
  // 17/11/2026: o arquivo da conta vem pelo fetch da página (que leva o login
  // do portal — um link puro chegaria sem ele e daria "Não autenticado") e
  // abre numa aba nova; o que o navegador não mostra (Excel, Word…) baixa.
  async function abrirArquivo(url, rotulo) {
    var w = null;
    try { w = window.open('', '_blank'); } catch (e) { w = null; }   // aberta já no clique: o navegador não barra
    if (w) { try { w.document.title = 'Abrindo…'; w.document.body.innerHTML = '<p style="font:14px sans-serif;color:#374951;padding:24px">Abrindo ' + esc(rotulo || 'o arquivo') + '…</p>'; } catch (e) { } }
    try {
      await esperaAuth();
      var r = await fetch(url);
      if (r.status === 401) { await dorme(1500); r = await fetch(url); }
      if (!r.ok) {
        var msg = 'HTTP ' + r.status;
        try { var j = JSON.parse(await r.text()); msg = j.error || msg; } catch (e) { }
        throw new Error(msg);
      }
      var cd = r.headers.get('content-disposition') || '';
      var m = /filename\*=UTF-8''([^;]+)/i.exec(cd), m2 = /filename="([^"]+)"/i.exec(cd);
      var nome = m ? decodeURIComponent(m[1]) : m2 ? m2[1] : (rotulo || 'arquivo');
      var tipo = (r.headers.get('content-type') || '').toLowerCase();
      var b = await r.blob();
      // a nota do Salesforce vem em HTML: vira texto puro (HTML num blob rodaria com a origem do portal)
      if (/text\/html/.test(tipo)) {
        var div = new DOMParser().parseFromString((await b.text()).replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, '\n'), 'text/html').body;   // DOMParser = inerte, nada roda
        b = new Blob([div.textContent || ''], { type: 'text/plain;charset=utf-8' }); tipo = 'text/plain'; nome = nome.replace(/\.html$/i, '.txt');
      } else b = new Blob([b], { type: tipo || 'application/octet-stream' });
      var obj = URL.createObjectURL(b);
      setTimeout(function () { URL.revokeObjectURL(obj); }, 120000);
      if (/^inline/i.test(cd) && w) { w.location.href = obj; return; }
      if (w) { try { w.close(); } catch (e) { } }
      var a = document.createElement('a'); a.href = obj; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
      toast('Baixando ' + nome);
    } catch (e) {
      if (w) { try { w.close(); } catch (e2) { } }
      toast('Não consegui abrir o arquivo: ' + (e.message || e));
    }
  }

  function toast(t) {
    var el = $('cc-toast'); if (!el) return;
    el.textContent = t; el.classList.add('on');
    clearTimeout(_toastT); _toastT = setTimeout(function () { el.classList.remove('on'); }, 1800);
  }
  function copiar(t, rot) {
    var ok = function () { toast((rot || 'Copiado') + ': ' + t); };
    try { navigator.clipboard.writeText(t).then(ok, function () { toast('Não consegui copiar'); }); } catch (e) { toast('Não consegui copiar'); }
  }

  // ══════════════════════════════════════════════════════════════
  // CARGA
  // ══════════════════════════════════════════════════════════════
  async function esperaAuth() {
    for (var i = 0; i < 150 && !window._portalAuthReady; i++) await dorme(100);
    if (window._portalAuthReady) { try { await Promise.race([window._portalAuthReady, dorme(15000)]); } catch (e) { } }
  }
  async function getJson(url) {
    await esperaAuth();
    var r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (r.status === 401) { await dorme(1500); r = await fetch(url, { headers: { Accept: 'application/json' } }); }
    var js = null;
    try { js = JSON.parse(await r.text()); } catch (e) { js = null; }
    return { r: r, js: js };
  }
  function banner(html, tipo) {
    var b = $('cc-banner'); if (!b) return;
    if (!html) { b.hidden = true; return; }
    b.hidden = false;
    b.className = 'cc-banner' + (tipo ? ' ' + tipo : '');
    b.innerHTML = html;
  }
  function msgErro(r, js) {
    if (!r) return 'Não consegui falar com o portal.';
    if (r.status === 401) return 'Sua sessão não foi confirmada — entre de novo no portal.';
    // RECORTE MSB: aqui não há área Vendedor — a Carteira é do Comercial
    if (r.status === 403) return (js && js.espelho && js.error) || 'A Carteira de Clientes é da área Comercial e a sua conta não tem essa área.';
    return (js && js.error ? js.error + (js.detalhe ? ' — ' + js.detalhe : '') : 'O portal respondeu ' + r.status + '.');
  }

  async function carregar(fresco) {
    var seq = ++ST.seq;
    if (!ST.todos.length) pintarCarregando();
    var res = null;
    try { res = await getJson(API + (fresco ? '?fresh=1' : '')); } catch (e) { res = null; }
    if (seq !== ST.seq) return;
    var r = res && res.r, js = res && res.js;
    if (!r || !r.ok || !js || !js.ok) {
      banner('<span>' + esc(msgErro(r, js)) + '</span><button type="button" class="cc-btn" id="cc-tentar" style="margin-left:auto;">Tentar de novo</button>', 'erro');
      $('cc-tentar').onclick = function () { carregar(true); };
      if (!ST.todos.length) pintarVazio('Sem a carteira por enquanto. A busca por CNPJ completo continua funcionando.');
      return;
    }
    if (js.configured === false) {
      banner('A leitura do Dynamics e do CRM ainda não está ligada no portal.', 'erro');
      pintarVazio('Sem fonte configurada.');
      return;
    }
    if (js.carregando) {
      ST.tentativas++;
      var seg = Math.max(0, Math.round((Date.now() - new Date(js.desde).getTime()) / 1000));
      banner('<span class="cc-spin"></span><span>Montando a carteira: lendo todos os clientes do Dynamics e todas as contas do CRM' +
        (seg > 5 ? ' (há ' + seg + ' s)' : '') + '. Na primeira vez do dia isso leva um ou dois minutos — a busca por CNPJ completo já funciona.</span>');
      if (ST.tentativas < 60) { await dorme(5000); if (seq === ST.seq) carregar(false); return; }
      ST.tentativas = 0;
      banner('<span>A carteira está demorando mais do que o normal para montar. A busca por CNPJ completo continua funcionando.</span><button type="button" class="cc-btn" id="cc-tentar" style="margin-left:auto;">Tentar de novo</button>', 'erro');
      $('cc-tentar').onclick = function () { carregar(false); };
      return;
    }
    ST.tentativas = 0;
    receber(js);
    if (js.atualizando) setTimeout(function () { if (seq === ST.seq) carregar(false); }, 20000);
  }

  // o pacote vem em colunas + dicionário: vira um objeto por cliente
  function decodificar(p) {
    var c = {}; (p.cols || []).forEach(function (k, i) { c[k] = i; });
    var dic = p.dic || {};
    var g = function (row, k) {
      var v = row[c[k]];
      if (dic[k]) return v == null || v < 0 ? '' : (dic[k][v] == null ? '' : dic[k][v]);
      return v;
    };
    return (p.rows || []).map(function (row) {
      var doc = g(row, 'doc') || '';
      var o = {
        k: g(row, 'k') || doc, doc: doc, sit: g(row, 'sit'), nome: g(row, 'nome') || '', fantasia: g(row, 'fantasia') || '',
        uf: g(row, 'uf'), cidade: g(row, 'cidade'), codigos: g(row, 'codigos') || '', empresas: g(row, 'empresas'),
        grupo: g(row, 'grupo'), bloq: g(row, 'bloq') === 1, sfId: g(row, 'sfId') || '', nSf: Number(g(row, 'nSf')) || 0,
        dono: g(row, 'dono'), donoEmail: g(row, 'donoEmail'), tipo: g(row, 'tipo'), unid: g(row, 'unid'),
        ativo: g(row, 'ativo') === 1 ? true : g(row, 'ativo') === 0 ? false : null, msb: g(row, 'msb') === 1,
        rede: g(row, 'rede'), orgao: g(row, 'orgao'), codErp: g(row, 'codErp') || '', ultAtiv: g(row, 'ultAtiv') || '',
        alertas: g(row, 'alertas') || []
      };
      return completarLinha(o);
    });
  }
  function completarLinha(o) {
    o.empresasL = o.empresas ? o.empresas.split(' · ') : [];
    // os textos em que a busca procura (sem acento, caixa baixa): _t = o que
    // identifica o cliente (vem primeiro na lista), _t2 = onde ele fica;
    // _d = os números, cada um separado (o termo não emenda dois campos)
    o._t = norm([o.nome, o.fantasia, o.codigos, o.codErp, o.doc, o.sfId].join(' '));
    o._t2 = norm([o.cidade, o.uf, o.rede].join(' '));
    o._d = ' ' + [o.doc, dig(o.codErp)].concat(o.codigos ? String(o.codigos).split(' · ').map(dig) : []).filter(Boolean).join(' ');
    return o;
  }

  // ?nome=<razão social> (âncora do portal, portal-elo.js, 24/11/2026): quem veio
  // sem CNPJ (o nome no Power BI/CRM) cai na ficha do cliente de MESMO nome; com
  // mais de um ou nenhum, a busca já vem preenchida com o nome
  function abrirPeloNome() {
    var n = ST.nomePedido; if (!n || !ST.todos.length) return;
    ST.nomePedido = null;
    var alvo = norm(n), achados = ST.todos.filter(function (c) { return norm(c.nome) === alvo || (c.fantasia && norm(c.fantasia) === alvo); });
    var docs = uniq(achados.map(function (c) { return c.k; }));
    if (docs.length === 1) { abrirFicha(docs[0]); return; }
    $('cc-q').value = n; definirBusca(n); $('cc-busca').classList.add('tem');
  }

  function receber(js) {
    ST.todos = decodificar(js.pacote || {});
    if (ST.nomePedido) setTimeout(abrirPeloNome, 0);
    ST.alertas = js.alertas || {};
    ST.erpPed = js.erpPedidos || ST.erpPed || {};
    ST.resumo = js.resumo || null;
    ST.fontes = js.fontes || {};
    ST.eu = String(js.eu || (window._portalUser && window._portalUser.email) || '').toLowerCase();
    ST.sfInst = js.sfInstance || null;

    // aviso de fonte fora (o cruzamento fica incompleto — dizer qual)
    var f = ST.fontes, avisos = [];
    if (f.d365 && !f.d365.ok) avisos.push('o <b>Dynamics</b> ' + (f.d365.configurado === false ? 'não está configurado' : 'não respondeu' + (f.d365.erro ? ' (' + esc(f.d365.erro) + ')' : '')));
    if (f.sf && !f.sf.ok) avisos.push('o <b>CRM</b> ' + (f.sf.configurado === false ? 'não está configurado' : 'não respondeu' + (f.sf.erro ? ' (' + esc(f.sf.erro) + ')' : '')));
    if (f.d365 && f.d365.ok && f.d365.semCnpj) avisos.push('a entidade de clientes do Dynamics não expõe o CNPJ — só dá para cruzar pelo código');
    if (avisos.length) banner('<span>Cruzamento incompleto: ' + avisos.join('; ') + '. Quem aparece como "só" num sistema pode estar no outro.</span><button type="button" class="cc-btn" id="cc-tentar" style="margin-left:auto;">Tentar de novo</button>', 'aviso');
    else banner(null);
    var bt = $('cc-tentar'); if (bt) bt.onclick = function () { carregar(true); };

    var pill = $('cc-dw');
    if (pill && js.geradoEm) {
      var d = new Date(js.geradoEm);
      // a carteira guardada abre na hora; se está vencida, a releitura corre por trás
      $('cc-dw-txt').textContent = 'Dynamics + CRM · lido ' + d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ', ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) +
        (js.atualizando ? ' · atualizando…' : '');
      pill.classList.toggle('parcial', !!js.parcial);
      pill.hidden = false;
    }
    var temMinha = ST.eu && ST.todos.some(function (c) { return c.donoEmail === ST.eu; });
    $('cc-minha').hidden = !temMinha;
    $('cc-atualizar').disabled = false;
    pintar();
  }

  // ══════════════════════════════════════════════════════════════
  // FILTROS
  // ══════════════════════════════════════════════════════════════
  function valoresDim(c, d) {
    var v = c[d.campo];
    if (d.soAlertas) return c.sit === 'sf' ? [] : (v || []).filter(ehPendencia);
    if (d.multi) return v && v.length ? v : [''];
    return [v || ''];
  }
  // ── a busca ──
  // pontuação em volta da palavra não conta; @ . - _ / no meio ficam (e-mail, site, código)
  function palavras(s) {
    return String(s || '').split(' ').map(function (p) { return p.replace(/^[()[\]{},;:"'!?]+|[()[\]{},;:"'!?]+$/g, ''); }).filter(Boolean);
  }
  // o termo: palavras (em qualquer ordem) ou só números — CNPJ, telefone, CEP,
  // código, com ou sem máscara. Link de conta do Salesforce colado = o Id dela.
  function lerBusca(s) {
    s = String(s || '').trim();
    var mId = /(?:^|[^A-Za-z0-9])(001[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?)(?![A-Za-z0-9])/.exec(s);
    if (mId && (mId.index === 0 || /salesforce|force\.com/i.test(s))) s = mId[1];
    var d = dig(s);
    var soNum = !!d && d.length === s.replace(/[\s.\-/()+]/g, '').length;
    var B = { s: s, soNum: soNum, ps: soNum ? [] : palavras(norm(s)),
      digs: soNum ? ((d.length === 12 || d.length === 13) && d.slice(0, 2) === '55' ? [d, d.slice(2)] : [d]) : [] };   // telefone com o +55
    return soNum || B.ps.length ? B : null;
  }
  // 0 = no nome/documento/códigos · 1 = com a cidade/UF/rede · -1 = não casa aqui
  function nivelBusca(c, B) {
    var i;
    if (B.soNum) {
      for (i = 0; i < B.digs.length; i++) if (c._d.indexOf(B.digs[i]) >= 0) return 0;
      return -1;
    }
    var p1 = true;
    for (i = 0; i < B.ps.length; i++) if (c._t.indexOf(B.ps[i]) < 0) { p1 = false; break; }
    if (p1) return 0;
    for (i = 0; i < B.ps.length; i++) if (c._t.indexOf(B.ps[i]) < 0 && c._t2.indexOf(B.ps[i]) < 0) return -1;
    return 1;
  }
  function fundoAtual() { return ST.fundo && ST.fundo.q === ST.q ? ST.fundo : null; }
  // `exceto` = a dimensão que está sendo contada (o agrupamento mostra as
  // outras opções dela, não só a escolhida)
  function filtrar(exceto) {
    var B = ST.qB, f = fundoAtual(), fks = f && f.ks.size ? f.ks : null;
    return ST.todos.filter(function (c) {
      if (ST.sit && ladoSit(c.sit) !== ST.sit) return false;
      if (ST.pend && !temPendencia(c)) return false;
      if (ST.minha && c.donoEmail !== ST.eu) return false;
      if (B) {
        // 2 = achado pelo servidor no resto do cliente (e-mail, telefone, contato…)
        var nv = nivelBusca(c, B);
        if (nv < 0 && fks && fks.has(c.k)) nv = 2;
        if (nv < 0) return false;
        c._nv = nv;
      }
      for (var i = 0; i < DIMS.length; i++) {
        var d = DIMS[i], s = ST.sel[d.id];
        if (d.id === exceto || !s.size) continue;
        var vs = valoresDim(c, d), ok = false;
        for (var j = 0; j < vs.length; j++) if (s.has(vs[j])) { ok = true; break; }
        if (!ok) return false;
      }
      return true;
    });
  }
  function temFiltro() {
    return !!(ST.q || ST.sit || ST.pend || ST.minha || DIMS.some(function (d) { return ST.sel[d.id].size; }));
  }
  function limparTudo() {
    definirBusca(''); ST.sit = null; ST.pend = false; ST.minha = false;
    DIMS.forEach(function (d) { ST.sel[d.id].clear(); });
    $('cc-q').value = ''; $('cc-minha-in').checked = false;
    $('cc-busca').classList.remove('tem');
    ST.pag = 0; pintar();
  }

  // ══════════════════════════════════════════════════════════════
  // PINTURA
  // ══════════════════════════════════════════════════════════════
  function pintarCarregando() {
    $('cc-kpis').innerHTML = ['total', '', '', '', ''].map(function (k) {
      return '<div class="cc-kpi ' + k + '"><div class="cc-sk" style="width:60%"></div><div class="cc-sk" style="height:24px;width:40%"></div></div>';
    }).join('');
    $('cc-grupos').innerHTML = '<div class="cc-sk"></div><div class="cc-sk"></div><div class="cc-sk"></div>';
    $('cc-body').innerHTML = '<tr><td colspan="5" class="cc-vz">Carregando a carteira…</td></tr>';
  }
  function pintarVazio(t) {
    $('cc-kpis').innerHTML = '';
    $('cc-grupos').innerHTML = '<div class="fx-empty">—</div>';
    $('cc-body').innerHTML = '<tr><td colspan="5" class="cc-vz">' + esc(t) + '</td></tr>';
  }

  function pintar() {
    ST.filtrados = filtrar(null);
    pintarKpis();
    pintarAtivos();
    pintarGrupos();
    pintarLista();
  }

  function pintarKpis() {
    // os números respeitam a busca e os agrupamentos, mas não o próprio filtro de situação
    var salva = ST.sit, salvaP = ST.pend;
    ST.sit = null; ST.pend = false;
    var base = filtrar(null);
    ST.sit = salva; ST.pend = salvaP;
    var n = { erp: 0, sf: 0 };
    base.forEach(function (c) { n[ladoSit(c.sit)]++; });
    var tot = base.length || 0;
    var bar = '<div class="cc-barra">' + ['erp', 'sf'].map(function (s) {
      return tot ? '<span style="width:' + (n[s] / tot * 100) + '%;background:' + COR[s] + '"></span>' : '';
    }).join('') + '</div>';
    var fora = ST.resumo && ST.resumo.foraSf ? ' · ' + fINT(ST.resumo.foraSf) + ' fornecedores do CRM fora' : '';
    var k = function (id, cls, cor, rot, v, sub, extra) {
      var on = (id === 'total' && !ST.sit && !ST.pend) || (id === ST.sit) || (id === 'pend' && ST.pend);
      return '<button type="button" class="cc-kpi ' + cls + (on ? ' on' : '') + '" data-kpi="' + id + '" aria-pressed="' + on + '">' +
        '<div class="k">' + (cor ? '<i style="background:' + cor + '"></i>' : '') + esc(rot) + '</div>' +
        '<div class="v">' + fINT(v) + '</div><div class="s">' + sub + '</div>' + (extra || '') + '</button>';
    };
    $('cc-kpis').innerHTML =
      k('total', 'total', null, 'Clientes na carteira', tot, (temFiltro() ? 'no recorte atual' : 'Dynamics ∪ CRM') + esc(fora), bar) +
      k('erp', '', COR.erp, 'Com cadastro no ERP', n.erp, tot ? fPct(n.erp / tot) + ' da carteira · dados do Dynamics' : '—') +
      k('sf', '', COR.sf, 'Sem cadastro no ERP', n.sf, tot ? fPct(n.sf / tot) + ' da carteira · só no CRM' : '—');
  }

  function pintarAtivos() {
    var chips = [];
    if (ST.q) chips.push(['q', null, 'Busca', ST.q]);
    if (ST.sit) chips.push(['sit', null, 'Cadastro', SIT[ST.sit]]);
    if (ST.pend) chips.push(['pend', null, 'Com', 'pendência de cadastro']);
    if (ST.minha) chips.push(['minha', null, 'Só', 'a minha carteira']);
    DIMS.forEach(function (d) {
      ST.sel[d.id].forEach(function (v) { chips.push(['dim', d.id + '|' + v, d.rot, d.soAlertas ? ((ST.alertas[v] || {}).rot || v) : (v || d.vazio || '(vazio)')]); });
    });
    var el = $('cc-ativos');
    el.hidden = !chips.length;
    el.innerHTML = chips.map(function (c) {
      return '<span class="cc-chip"><small>' + esc(c[2]) + ':</small> ' + esc(c[3]) +
        '<button type="button" data-tira="' + esc(c[0]) + '"' + (c[1] != null ? ' data-v="' + esc(c[1]) + '"' : '') + ' aria-label="Tirar filtro">✕</button></span>';
    }).join('') + (chips.length ? '<button type="button" class="cc-limpar" id="cc-limpar">Limpar tudo</button>' : '');
  }

  function pintarGrupos() {
    var d = DIMS.filter(function (x) { return x.id === ST.dim; })[0] || DIMS[0];
    // as dimensões (os filtros) em ordem alfabética do rótulo
    $('cc-seg').innerHTML = DIMS_SEG.map(function (x) {
      var n = ST.sel[x.id].size;
      return '<button type="button" data-dim="' + x.id + '" class="' + (x.id === d.id ? 'on' : '') + '">' + esc(x.rot) + (n ? ' (' + n + ')' : '') + '</button>';
    }).join('');
    var base = filtrar(d.id);
    var g = new Map();
    base.forEach(function (c) {
      valoresDim(c, d).forEach(function (v) {
        var x = g.get(v); if (!x) { x = { v: v, n: 0, erp: 0, sf: 0 }; g.set(v, x); }
        x.n++; x[ladoSit(c.sit)]++;
      });
    });
    var arr = Array.from(g.values()).sort(function (a, b) { return b.n - a.n || COLL.compare(String(a.v), String(b.v)); });
    var max = arr.length ? arr[0].n : 1;
    var desc = d.soAlertas ? '<div class="cc-g-desc">O que o cruzamento achou de diferente entre os dois cadastros — passe o mouse para ver o que é cada uma.</div>' : '';
    $('cc-grupos').innerHTML = desc + (arr.length ? arr.slice(0, 300).map(function (x) {
      var rot = d.soAlertas ? ((ST.alertas[x.v] || {}).rot || x.v) : (x.v || d.vazio || '(vazio)');
      var tit = d.soAlertas ? ((ST.alertas[x.v] || {}).desc || '') : rot;
      var on = ST.sel[d.id].has(x.v);
      var w = x.n / max * 100;
      return '<button type="button" class="cc-g' + (on ? ' on' : '') + '" data-g="' + esc(x.v) + '" title="' + esc(tit) + '">' +
        '<span class="n">' + esc(rot) + '</span><span class="q">' + fINT(x.n) + '</span>' +
        '<span class="b" style="width:' + Math.max(w, 2) + '%">' + ['erp', 'sf'].map(function (s) {
          return x[s] ? '<span style="width:' + (x[s] / x.n * 100) + '%;background:' + COR[s] + '" title="' + esc(SIT[s]) + ': ' + fINT(x[s]) + '"></span>' : '';
        }).join('') + '</span></button>';
    }).join('') : '<div class="fx-empty">' + (d.soAlertas ? 'Nenhuma pendência no recorte.' : 'Nada no recorte.') + '</div>');
  }

  var COLS = [
    { c: 'nome', rot: 'Cliente' },
    { c: 'doc', rot: 'CNPJ / CPF' },
    { c: 'codigos', rot: 'Dynamics', x: true },
    { c: 'dono', rot: 'CRM', x: true },
    { c: 'sit', rot: 'Cadastro no ERP' }
  ];
  // a lista ordenada fica guardada: trocar de página não reordena tudo de novo
  // (o pintar() troca o ST.filtrados a cada filtro/busca, e aí reordena)
  var _ordMemo = null;
  function ordenar(arr) {
    var o = ST.ord, ordSit = { ambos: 0, d365: 0, sf: 1 }, B = ST.qB;
    var m = _ordMemo;
    if (m && m.arr === arr && m.c === o.c && m.d === o.d && m.B === B) return m.out;
    var out = arr.slice().sort(function (a, b) {
      // com busca: primeiro quem casou pelo nome/documento/código, depois pelo resto
      if (B && (a._nv || 0) !== (b._nv || 0)) return (a._nv || 0) - (b._nv || 0);
      var va = o.c === 'sit' ? ordSit[a.sit] : a[o.c] || '', vb = o.c === 'sit' ? ordSit[b.sit] : b[o.c] || '';
      if (va === vb) return COLL.compare(a.nome, b.nome);
      if (va === '') return 1; if (vb === '') return -1;
      return (typeof va === 'number' ? va - vb : COLL.compare(String(va), String(vb))) * o.d;
    });
    _ordMemo = { arr: arr, c: o.c, d: o.d, B: B, out: out };
    return out;
  }
  function pintarLista() {
    $('cc-head').innerHTML = '<tr>' + COLS.map(function (k) {
      var ord = ST.ord.c === k.c ? '<span class="ord">' + (ST.ord.d > 0 ? '▲' : '▼') + '</span>' : '';
      return '<th data-ord="' + k.c + '"' + (k.x ? ' class="col-x"' : '') + '>' + esc(k.rot) + ord + '</th>';
    }).join('') + '</tr>';
    var arr = ordenar(ST.filtrados);
    var tot = arr.length, ini = ST.pag * POR_PAG;
    if (ini >= tot) { ST.pag = 0; ini = 0; }
    var pag = arr.slice(ini, ini + POR_PAG);
    var f = ST.qB ? fundoAtual() : null, sub = '';
    if (f && f.estado === 'buscando') sub = ' · procurando também em e-mails, telefones, endereços e contatos…';
    else if (f && f.estado === 'erro') sub = ' · não consegui procurar em e-mails, telefones e contatos agora';
    else if (f && f.estado === 'ok') {
      var n2 = arr.filter(function (c) { return c._nv === 2; }).length;
      if (n2) sub = ' · ' + fINT(n2) + (n2 === 1 ? ' achado' : ' achados') + ' em e-mail, telefone, endereço ou contato' + (f.mais ? ' (os primeiros)' : '');
      if (f.sf && f.sf.ligado && f.sf.ok === false) sub += ' · o CRM não respondeu à busca de contatos';
    }
    $('cc-lista-sub').textContent = fINT(tot) + ' cliente' + (tot === 1 ? '' : 's') + (temFiltro() ? ' no recorte' : '') + sub + ' · clique para abrir a ficha';
    if (!pag.length) {
      $('cc-body').innerHTML = '<tr><td colspan="5" class="cc-vz">' + (ST.todos.length ? (f && f.estado === 'buscando' ? '<span class="cc-spin"></span>Procurando em e-mails, telefones, endereços e contatos…' : 'Ninguém com esse recorte.') +
        (dig(ST.q).length === 14 || dig(ST.q).length === 11 ? ' <button type="button" class="cc-btn" data-ficha="' + esc(dig(ST.q)) + '" style="margin-left:8px">Procurar o CNPJ direto nas fontes</button>' +
          (ESPELHO ? '' : ' <button type="button" class="cc-btn" data-nova="' + esc(dig(ST.q)) + '" style="margin-left:4px">' + IC_MAIS + 'Cadastrar conta nova</button>') : '') : 'Carregando…') + '</td></tr>';
    } else {
      $('cc-body').innerHTML = pag.map(function (c) {
        var al = c.alertas.length ? '<div class="al">' + c.alertas.map(seloAlerta).join('') + '</div>' : '';
        var onde = [c.cidade, c.uf].filter(Boolean).join(' · ');
        var emp = c.empresas ? '<span class="sub">' + esc(c.empresas) + (c.grupo ? ' · ' + esc(c.grupo) : '') + '</span>' : '';
        var sf = c.sfId ? '<span class="dn">' + esc(c.dono || '(sem dono)') + '</span><span class="sub">' + esc(c.codErp ? 'Cód. ERP ' + c.codErp : 'sem Código ERP') + (c.nSf > 1 ? ' · ' + c.nSf + ' contas' : '') + '</span>' +
          (c.tipo ? '<span class="sub">' + esc(c.tipo) + '</span>' : '') : '<span class="sub">—</span>';
        return '<tr tabindex="0" data-k="' + esc(c.k) + '">' +
          '<td class="nm">' + esc(c.nome || '(sem nome)') + (c.fantasia && norm(c.fantasia) !== norm(c.nome) ? '<small>' + esc(c.fantasia) + '</small>' : '') +
            (onde ? '<small class="onde">' + esc(onde) + '</small>' : '') + dicaBusca(c) + al + '</td>' +
          '<td class="mono">' + (c.doc ? esc(fDoc(c.doc)) : '<span class="sub">sem CNPJ</span>') + '</td>' +
          '<td class="col-x">' + (c.codigos ? '<span class="mono">' + esc(c.codigos) + '</span>' + emp : '<span class="sub">—</span>') + '</td>' +
          '<td class="col-x">' + sf + '</td>' +
          '<td>' + selo(c.sit) + (c.sit === 'sf' && ST.erpPed && ST.erpPed[c.k] ? '<span class="sub erp-ped" title="Cadastro no ERP pedido por ' + esc(ST.erpPed[c.k].por || '') + '">ERP pedido em ' + esc(fDiaMes(ST.erpPed[c.k].em)) + '</span>' : '') + '</td></tr>';
      }).join('');
    }
    var fim = Math.min(ini + POR_PAG, tot), nPag = Math.ceil(tot / POR_PAG);
    var bt = function (p, rot, tit, ok) {
      return '<button type="button" class="cc-btn" data-pag="' + p + '" title="' + tit + '"' + (ok ? '' : ' disabled') + '>' + rot + '</button>';
    };
    $('cc-pag').innerHTML = tot > POR_PAG ? '<span>' + fINT(ini + 1) + '–' + fINT(fim) + ' de ' + fINT(tot) + '</span><span class="bts">' +
      bt(0, '«', 'Primeira página', ST.pag > 0) +
      bt(ST.pag - 1, '‹ Anterior', 'Página anterior', ST.pag > 0) +
      '<span class="pg">Página ' + fINT(ST.pag + 1) + ' de ' + fINT(nPag) + '</span>' +
      bt(ST.pag + 1, 'Próxima ›', 'Próxima página', fim < tot) +
      bt(nPag - 1, '»', 'Última página', fim < tot) + '</span>' : '';
  }

  // onde a busca achou quem não casou pelo nome (e-mail, telefone, contato…)
  function dicaBusca(c) {
    if (!ST.qB || !c._nv) return '';
    var f = fundoAtual(), itens = (f && f.ks.get(c.k)) || [];
    if (!itens.length && c.rede) {
      // a rede não aparece na linha: diz que foi por ela
      var nr = norm(c.rede);
      if (ST.qB.ps.some(function (p) { return nr.indexOf(p) >= 0 && c._t.indexOf(p) < 0; })) itens = [{ rot: 'Rede', val: c.rede }];
    }
    if (!itens.length) return '';
    return '<div class="cc-achou" title="Onde a busca achou este cliente">' + itens.slice(0, 2).map(function (o) {
      return '<span><b>' + esc(o.rot) + ':</b> ' + marcar(o.val) + '</span>';
    }).join('') + '</div>';
  }
  // o valor com o que foi buscado em destaque (sem acento/caixa; só números
  // casam também com a máscara: 3333-4444 dentro de (31) 3333-4444)
  function marcar(v) {
    v = String(v == null ? '' : v);
    var B = ST.qB; if (!B) return esc(v);
    var alvos = B.soNum ? B.digs : B.ps, m = '', pos = [];
    for (var i = 0; i < v.length; i++) {
      var ch = B.soNum ? (/\d/.test(v[i]) ? v[i] : '') : norm(v[i]) || (v[i] === ' ' ? ' ' : '');
      for (var j = 0; j < ch.length; j++) { m += ch[j]; pos.push(i); }
    }
    var on = new Array(v.length + 1).join('0').split('');
    alvos.forEach(function (a) {
      if (!a) return;
      for (var k = m.indexOf(a); k >= 0; k = m.indexOf(a, k + 1)) for (var z = 0; z < a.length; z++) on[pos[k + z]] = '1';
    });
    var out = '', dentro = false;
    for (var x = 0; x < v.length; x++) {
      if (on[x] === '1' && !dentro) { out += '<mark>'; dentro = true; }
      if (on[x] !== '1' && dentro) { out += '</mark>'; dentro = false; }
      out += esc(v[x]);
    }
    return out + (dentro ? '</mark>' : '');
  }

  // a busca no SERVIDOR: o resto do cliente (e-mail, telefone, IE, CEP,
  // endereço, Identificador…) e os contatos/oportunidades do Salesforce
  var _fT = null;
  function definirBusca(v) {
    ST.q = String(v || '').trim();
    ST.qB = ST.q ? lerBusca(ST.q) : null;
    agendarFundo();
  }
  function agendarFundo() {
    clearTimeout(_fT);
    var B = ST.qB;
    var curto = !B || (B.soNum ? B.digs[B.digs.length - 1].length < 4 : B.ps.join('').replace(/[^a-z0-9@]/g, '').length < 3);
    if (curto) { ST.fundo = null; return; }
    if (ST.fundo && ST.fundo.q === ST.q) return;      // já tem (ou já está procurando)
    var q = ST.q;
    ST.fundo = { q: q, ks: new Map(), estado: 'buscando' };
    _fT = setTimeout(function () { buscarFundo(q, B.s); }, 300);
  }
  async function buscarFundo(q, termo) {
    var res = null;
    try { res = await getJson(API + '?busca=' + encodeURIComponent(termo)); } catch (e) { res = null; }
    var f = ST.fundo;
    if (!f || f.q !== q) return;                      // a busca mudou enquanto isso
    var js = res && res.js;
    if (!res || !res.r.ok || !js || !js.ok) { f.estado = 'erro'; pintarLista(); return; }
    (js.achados || []).forEach(function (a) { if (a && a.k) f.ks.set(a.k, a.onde || []); });
    f.estado = 'ok'; f.mais = !!js.mais; f.sf = js.sf || null;
    pintar();
  }

  // ══════════════════════════════════════════════════════════════
  // FICHA
  // ══════════════════════════════════════════════════════════════
  function abrirFicha(k) {
    if (!k) return;
    var seq = ++ST.fichaSeq;
    ST.fichaK = k; ST.fichaJs = null; ST.fichaChave = null; ST.erp = null;
    var c = ST.todos.filter(function (x) { return x.k === k; })[0];
    $('cc-ov').classList.add('on');
    var f = $('cc-ficha'); f.classList.add('on'); f.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    try { var u = new URL(location.href); u.searchParams.set('cliente', k); history.replaceState(null, '', u); } catch (e) { }
    $('cc-fh').innerHTML = cabecalho(c || { k: k, doc: /^\d+$/.test(k) ? k : '', nome: 'Procurando…', alertas: [] }, null);
    $('cc-fb').innerHTML = '<div class="cc-sec"><div class="cc-sk"></div><div class="cc-sk" style="width:70%"></div><div class="cc-sk" style="width:50%"></div></div>' +
      '<div class="cc-sec"><div class="cc-sk"></div><div class="cc-sk" style="width:80%"></div></div>';
    $('cc-fechar').focus();
    getJson(API + '?ficha=' + encodeURIComponent(k)).then(function (res) {
      if (seq !== ST.fichaSeq) return;
      var js = res.js;
      if (!res.r.ok || !js || !js.ok) {
        $('cc-fb').innerHTML = '<div class="cc-sec"><div class="erro">' + esc(msgErro(res.r, js)) + '</div></div>';
        return;
      }
      if (js.alertas) ST.alertas = js.alertas;
      if (js.sf && js.sf.instance) ST.sfInst = ST.sfInst || js.sf.instance;
      ST.fichaChave = js.chave;
      pintarFicha(js, c);
    }, function () {
      if (seq !== ST.fichaSeq) return;
      $('cc-fb').innerHTML = '<div class="cc-sec"><div class="erro">Não consegui falar com o portal.</div></div>';
    });
  }
  function fecharFicha() {
    ST.fichaSeq++; ST.fichaK = null; ST.erp = null; ST.erpPendente = false; ST.ds = null;
    $('cc-ov').classList.remove('on');
    var f = $('cc-ficha'); f.classList.remove('on'); f.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    try { var u = new URL(location.href); u.searchParams.delete('cliente'); history.replaceState(null, '', u); } catch (e) { }
  }

  function cabecalho(c, js) {
    var tags = [];
    if (c.sit) tags.push(selo(c.sit));
    if (c.tipo) tags.push('<span class="tag">' + esc(c.tipo) + '</span>');
    if (c.uf || c.cidade) tags.push('<span class="tag">' + esc([c.cidade, c.uf].filter(Boolean).join(' · ')) + '</span>');
    if (c.dono) tags.push('<span class="tag">Dono: ' + esc(c.dono) + '</span>');
    var acoes = [];
    // 17/11/2026: quem usa a Carteira não tem acesso ao Salesforce — sem "Abrir no Salesforce"
    // cliente do Dynamics sem conta no Salesforce: a conta nasce daqui, com o cadastro dele
    // (o espelho do Vendedor é só consulta: nem esta, nem o pedido de cadastro no ERP)
    if (!ESPELHO && !c.sfId && c.sit === 'd365' && c.doc) acoes.push('<button type="button" data-nova="' + esc(c.doc) + '">' + IC_MAIS + 'Criar conta no CRM</button>');
    // só no Salesforce: pede o cadastro no ERP por e-mail (18/11/2026)
    if (!ESPELHO && c.sit === 'sf' && (!js || erpPode(js))) acoes.push('<button type="button" data-erp-abrir="1">' + IC_ERP + 'Pedir cadastro no ERP</button>');
    // RECORTE MSB: sem o botão "Dossiê de Cliente (compras)" — a página está
    // oculta no portal da MSB (recorte de 20/10/2026); a ficha só aponta para
    // o que existe aqui
    acoes.push('<button type="button" class="sec" data-link="1"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>Copiar link</button>');
    return '<button type="button" class="fechar" id="cc-fechar" aria-label="Fechar a ficha"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
      '<div class="k">Ficha do cliente</div><h2>' + esc(c.nome || '(sem nome)') + '</h2>' +
      (c.fantasia && norm(c.fantasia) !== norm(c.nome) ? '<div class="fant">' + esc(c.fantasia) + '</div>' : '') +
      '<div class="meta">' + (c.doc ? '<button type="button" class="doc" data-copiar="' + esc(fDoc(c.doc)) + '" title="Copiar">' + esc(fDoc(c.doc)) + '</button>' : '<span class="tag">sem CNPJ</span>') + tags.join('') + '</div>' +
      '<div class="acoes">' + acoes.join('') + '</div>';
  }

  function kv(pares) {
    return '<div class="cc-kv">' + pares.map(function (p) {
      var v = p[1];
      var vazio = v == null || v === '' || v === '—';
      return '<div><div class="l">' + esc(p[0]) + '</div><div class="v' + (vazio ? ' vz' : '') + '">' + (vazio ? '—' : (p[2] ? v : esc(v))) + '</div></div>';
    }).join('') + '</div>';
  }
  function simNao(v) { return v === true ? 'Sim' : v === false ? 'Não' : '—'; }
  function secErro(titulo, x) {
    return '<div class="cc-sec"><h3>' + titulo + '</h3><div class="erro">' + esc((x && x.erro) || 'Fonte indisponível.') + '</div></div>';
  }

  function pintarFicha(js, cLista) {
    var c = js.cliente || cLista || { k: js.chave, doc: '', nome: '(não encontrado)', alertas: [] };
    if (js.cliente && cLista) { c.dono = c.dono || cLista.dono; }
    $('cc-fh').innerHTML = cabecalho(c, js);
    var dL = (js.d365 && js.d365.linhas) || [], sL = (js.sf && js.sf.contas) || [];
    var h = [];

    if (!js.achou) {
      h.push('<div class="cc-sec"><h3>Nada encontrado</h3><div class="nada">Nenhum cliente com ' + esc(/^\d+$/.test(js.chave) ? fDoc(js.chave) : js.chave) +
        ' no Dynamics nem no CRM' + ((js.d365 && js.d365.ok === false) || (js.sf && js.sf.ok === false) ? ' — e uma das fontes não respondeu (abaixo)' : '') + '.</div>' +
        (!ESPELHO && /^\d{11}(\d{3})?$/.test(js.chave) ? '<button type="button" class="cc-btn prim" data-nova="' + esc(js.chave) + '" style="margin-top:12px">' + IC_MAIS + 'Cadastrar como conta nova no CRM</button>' : '') + '</div>');
    }

    // ── o que o cruzamento diz ──
    var al = c.alertas || [];
    if (al.length) {
      h.push('<div class="cc-sec"><h3>O que o cruzamento achou</h3><div class="cc-alertas">' + al.map(function (a) {
        var x = ST.alertas[a] || { rot: a, desc: '' };
        return '<div>' + seloAlerta(a) + '<span>' + esc(x.desc) + detalheAlerta(a, dL, sL) + '</span></div>';
      }).join('') + '</div></div>');
    }

    // ── cadastro do cliente: com cadastro no ERP vale o ERP; sem ele, tudo o que a conta do SF tem ──
    var s0 = sL[0] || {};
    var tabela = function (linhas) {
      return '<table class="cc-lado"><tbody>' + linhas.map(function (l) {
        var v = l[1];
        return '<tr><td class="c">' + esc(l[0]) + '</td><td>' + (v ? (l[2] ? v : esc(v)) : '<span class="vz">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table>';
    };
    if (dL.length) {
      var d0 = dL[0];
      h.push('<div class="cc-sec"><h3><span class="cc-sit ambos"><i></i>Com cadastro no ERP</span><small>dados do Dynamics 365' + (d0.empresa ? ' · ' + esc(d0.empresa) : '') + '</small></h3>' +
        tabela([
          ['Razão social', d0.nome],
          ['Nome fantasia', d0.fantasia],
          ['CNPJ / CPF', d0.doc ? fDoc(d0.doc) : d0.docBruto],
          ['Código do cliente', uniq(dL.map(function (x) { return x.codigo; })).join(' · ')],
          ['Tipo de cliente', d0.tipo || (d0.segmento ? 'Segmento ' + d0.segmento : '')],
          ['UF', d0.uf],
          ['Cidade', d0.cidade],
          ['Endereço', [d0.endereco, d0.bairro, d0.cep].filter(Boolean).join(' · ')],
          ['Telefone', d0.telefone],
          ['E-mail', d0.email],
          ['Inscrição estadual', d0.ie]
        ]) + '</div>');
    } else {
      if (js.d365 && js.d365.ok === false && js.d365.configurado !== false) h.push(secErro('Dynamics 365', js.d365));
      if (js.sf && js.sf.ok === false && js.sf.configurado !== false) h.push(secErro('CRM', js.sf));
      else if (sL.length) {
        var pares = [
          ['Razão social', s0.nome],
          ['Nome fantasia', s0.fantasia],
          ['CNPJ / CPF', s0.doc ? fDoc(s0.doc) : s0.docBruto],
          ['Código ERP', s0.codErp],
          ['Tipo de cliente', s0.tipo],
          ['Pessoa', s0.pessoa],
          ['UF', s0.uf],
          ['Cidade', s0.cidade],
          ['Endereço', [s0.endereco, s0.bairro, s0.cep].filter(Boolean).join(' · ')],
          ['Telefone', s0.telefone],
          ['E-mail', s0.email],
          ['Inscrição estadual', s0.ie],
          ['Inscrição municipal', s0.im],
          ['Dono da conta', s0.dono],
          ['Unidade', s0.unidade],
          ['Rede hospitalar', s0.rede],
          ['Órgão público', s0.orgao],
          ['Cliente MSB', s0.msb ? 'Sim' : ''],
          ['Conta ativa', s0.ativo === true ? 'Sim' : s0.ativo === false ? 'Não' : ''],
          ['Setor', s0.setor],
          ['Site', s0.site],
          ['Endereço de entrega', s0.entrega],
          ['Telefone de entrega', s0.telefoneEntrega],
          ['Conta pai', s0.paiNome],
          ['Potencial de faturamento', s0.potencial ? fBRL(s0.potencial) : ''],
          ['Último lançamento', s0.ultimoLancamento ? fBRL(s0.ultimoLancamento) : ''],
          ['Último documento', s0.ultimoDocumento],
          ['Última atividade', s0.ultimaAtividade ? fData(s0.ultimaAtividade) : ''],
          ['Conta criada em', s0.criado ? fData(s0.criado) : ''],
          ['Tipo de registro', s0.registro]
        ].filter(function (l) { return l[1]; });
        h.push('<div class="cc-sec"><h3><span class="cc-sit sf"><i></i>Sem cadastro no ERP</span><small>dados do CRM' + (sL.length > 1 ? ' · ' + sL.length + ' contas com este CNPJ (a principal)' : '') + '</small></h3>' +
          tabela(pares) +
          (s0.restricao && s0.motivoRestricao ? '<div class="cc-al situacao forte" style="margin-top:10px;white-space:normal">Motivo da restrição: ' + esc(s0.motivoRestricao) + '</div>' : '') + '</div>');
      }
    }

    // ── TUDO do cliente no portal (24/11/2026, portal-elo.js): notas, pedidos,
    // oportunidades, cotações, licitações, títulos, consignação e produtos — cada
    // linha abre a ficha dela por cima desta, com "‹ voltar" ──
    // RECORTE MSB: o portal-elo.js não existe aqui — a ficha não abre a visão 360
    var elo360 = false && js.achou && window.Elo && window.Elo.embutir
      ? { cnpj: c.doc || null, cod: c.doc ? null : ((dL[0] && dL[0].codigo) || s0.codErp || null), nome: c.nome || (dL[0] && dL[0].nome) || s0.nome || null } : null;
    if (elo360 && (elo360.cnpj || elo360.cod || elo360.nome)) {
      h.push('<div class="elo-emb-h"><b>Tudo do cliente no portal</b><span>notas fiscais, pedidos, oportunidades, cotações, licitações, títulos e consignação · Power BI · clique para ver cada um</span></div><div id="cc-elo360"></div>');
    } else elo360 = null;

    // ── pedir o cadastro no ERP (só no Salesforce) ──
    ST.fichaJs = js;
    ST.erp = null;
    h.push(htmlErp(js));

    // ── contatos, notas e anexos e a descrição: o portal também ESCREVE (17 e 19/11/2026) ──
    ST.fichaJs = js; ST.fichaC = cLista || null;
    ST.ct = null; ST.ax = { fila: [] }; ST.ds = null; ST.dsNovo = null;

    // ── descrição da conta (CRM): "Incluir descrição" põe texto no fim ──
    h.push(htmlDescricao(js));

    if (!ESPELHO && sL.length && !ST.ctModelo) ctCarregarModelo();
    h.push(htmlContatos(js));
    h.push(htmlAnexos(js));

    $('cc-fb').innerHTML = h.join('');
    if (elo360) { try { window.Elo.embutir($('cc-elo360'), elo360); } catch (e) { console.warn('[Carteira] visão 360:', e.message); } }
    // veio do botão do cabeçalho (ou da "Conta criada") antes de a ficha chegar
    if (ST.erpPendente) { ST.erpPendente = false; if (erpPode(js)) erpAbrir(); }
  }

  // ══════════════════════════════════════════════════════════════
  // PEDIR O CADASTRO NO ERP (18/11/2026)
  // e-mail da caixa de quem pede (Azure AD) para quem cadastra no Dynamics,
  // com tudo o que a conta do Salesforce já tem — o servidor relê a ficha
  // nas fontes e monta o e-mail; daqui vão só a observação e os arquivos
  // ══════════════════════════════════════════════════════════════
  function erpPode(js) {
    // o espelho do Vendedor só mostra o histórico dos pedidos (htmlErp), não pede
    if (ESPELHO) return false;
    var sL = (js && js.sf && js.sf.contas) || [], dL = (js && js.d365 && js.d365.linhas) || [];
    return !!(js && js.erp && js.erp.ligado && sL.length && !dL.length && js.d365 && js.d365.ok !== false);
  }
  function erpArquivos() {
    var ax = (ST.fichaJs && ST.fichaJs.anexos && ST.fichaJs.anexos.linhas) || [];
    return ax.filter(function (x) { return x.tipo === 'arquivo' && x.conta && x.id; });
  }
  function fDiaMes(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); }
  function fTam(n) { return !n ? '' : n >= 1048576 ? (n / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function fDataHora(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  // histórico dos envios (19/11/2026): cada e-mail de pedido de cadastro, do mais novo ao mais antigo
  function htmlErpHist(ps, titulo) {
    if (!ps.length) return '';
    return '<div class="cc-erp-hist"><div class="l">' + titulo + '</div><ol>' + ps.slice().reverse().map(function (x) {
      return '<li><div class="q"><b>' + esc(fDataHora(x.em)) + '</b> · por ' + esc(x.por || x.porEmail || '—') + '</div>' +
        '<div class="d">E-mail da caixa ' + esc(x.de || x.porEmail || '—') + (x.via === 'reserva' ? ' (caixa reserva)' : '') +
          ((x.para || []).length ? ' para ' + esc(x.para.join(', ')) : '') + '</div>' +
        (x.anexos && x.anexos.length ? '<div class="d">' + (x.anexos.length > 1 ? x.anexos.length + ' anexos: ' : 'Anexo: ') + esc(x.anexos.join(', ')) + '</div>' : '') +
        (x.conf ? '<div class="d"><span class="conf' + (x.diferencas ? ' dif' : '') + '">' + esc(x.conf.charAt(0).toUpperCase() + x.conf.slice(1)) + (x.diferencas ? ' (confirmado por quem pediu)' : '') + '</span></div>' : '') +
        (x.obs ? '<div class="obs">' + esc(x.obs) + '</div>' : '') + '</li>';
    }).join('') + '</ol></div>';
  }
  function htmlErp(js) {
    if (!erpPode(js)) {
      // o cliente já entrou no ERP (ou o pedido está fora): fica o histórico do que foi pedido
      var psH = (js && js.erp && js.erp.pedidos) || [];
      if (!psH.length) return '<div id="cc-sec-erp"></div>';
      var dH = (js.d365 && js.d365.linhas) || [];
      var cods = uniq(dH.map(function (x) { return x.codigo; }));
      return '<div class="cc-sec cc-erp" id="cc-sec-erp"><h3>Pedidos de cadastro no ERP <small>' + psH.length + (psH.length > 1 ? ' envios' : ' envio') + '</small></h3>' +
        (dH.length ? '<div class="cc-erp-st feito"><b>✓ Cadastrado no ERP</b> — o cliente já está no Dynamics' + (cods.length ? ' (código ' + esc(cods.join(', ')) + ')' : '') + '.</div>' : '') +
        htmlErpHist(psH, 'Histórico de envios') + '</div>';
    }
    var e = js.erp, ps = e.pedidos || [], ult = ps[ps.length - 1], f = ST.erp;
    var para = (e.para || []).join(', ');
    var bt = !f ? '<button type="button" class="cc-btn cc-btn-sec' + (ult ? '' : ' prim') + '" data-erp-abrir="1">' + IC_ERP + (ult ? 'Pedir de novo' : 'Pedir cadastro no ERP') + '</button>' : '';
    var st = ult
      ? '<div class="cc-erp-st ok"><b>Cadastro pedido em ' + esc(fDataHora(ult.em)) + '</b> por ' + esc(ult.por || ult.porEmail) +
        ' — e-mail ' + (ult.via === 'reserva' ? 'da caixa ' + esc(ult.de) + ' (a sua não deixou)' : 'da caixa ' + esc(ult.de)) + ' para ' + esc((ult.para || []).join(', ')) +
        (ult.anexos && ult.anexos.length ? ', com ' + ult.anexos.length + (ult.anexos.length > 1 ? ' arquivos' : ' arquivo') : '') + '.' +
        (ult.conf ? ' <span class="conf' + (ult.diferencas ? ' dif' : '') + '">' + esc(ult.conf.charAt(0).toUpperCase() + ult.conf.slice(1)) + (ult.diferencas ? ' (confirmado por quem pediu)' : '') + '</span>' : '') +
        (ult.obs ? '<div class="obs">' + esc(ult.obs) + '</div>' : '') +
        '<div class="ant">Quando o cliente for cadastrado no Dynamics com este CNPJ, ele passa sozinho para "Com cadastro no ERP".</div></div>' +
        htmlErpHist(ps.slice(0, -1), 'Envios anteriores (' + (ps.length - 1) + ')')
      : '<div class="cc-erp-st">Este cliente ainda não tem cadastro no Dynamics. O pedido vai por e-mail, <b>da sua caixa</b>, para <b>' + esc(para) + '</b>, com os dados da conta, o que a Receita diz do CNPJ, os contatos e os arquivos que você escolher.</div>';
    return '<div class="cc-sec cc-erp" id="cc-sec-erp"><h3>Cadastro no ERP <small>Dynamics</small>' + bt + '</h3>' + st + (f ? htmlErpForm(js) : '') + '</div>';
  }
  function htmlErpForm(js) {
    var f = ST.erp, e = js.erp, s0 = ((js.sf && js.sf.contas) || [])[0] || {}, cts = (js.contatos && js.contatos.linhas) || [];
    var eu = ST.eu || (window._portalUser && window._portalUser.email) || 'você';
    var vai = [
      ['CNPJ / CPF', s0.doc ? fDoc(s0.doc) : s0.docBruto], ['Tipo de cliente', s0.tipo], ['IE', s0.ie],
      ['Telefone', s0.telefone], ['E-mail', s0.email]
    ];
    var falta = vai.filter(function (x) { return !x[1]; }).map(function (x) { return x[0]; });
    var arqs = erpArquivos(), max = (e.anexoMaxKb || 2800) * 1024, soma = 0;
    arqs.forEach(function (a) { if (f.ax[a.id]) soma += a.tamanho || 0; });
    return '<div class="cc-form" id="cc-erp-form">' +
      '<div class="cc-form-t">' + (f.reenviar ? 'Pedir o cadastro no ERP de novo' : 'Pedir o cadastro no ERP') +
        '<small>sai da sua caixa (' + esc(eu) + ') para ' + esc((e.para || []).join(', ')) + (e.teste ? ' — modo de teste: não envia' : '') + '</small></div>' +
      '<div class="cc-erp-vai"><div class="l">Vai no e-mail</div>' + vai.filter(function (x) { return x[1]; }).map(function (x) {
        return '<span><b>' + esc(x[0]) + ':</b> ' + esc(x[1]) + '</span>'; }).join('') +
        '<span><b>Contatos:</b> ' + (cts.length ? cts.length : 'nenhum') + '</span><span><b>Dados da conta:</b> todos</span>' +
        (falta.length ? '<div class="falta">Sem ' + esc(falta.join(', ').toLowerCase()) + ' na conta — se souber, escreva na observação.</div>' : '') + '</div>' +
      '<div class="cc-erp-conf" id="cc-erp-conf">' + htmlErpConf() + '</div>' +
      '<div class="nc-campo"><label for="cc-erp-obs">Observação <small style="font-weight:600;color:#97A8AE">(opcional)</small></label>' +
        '<textarea id="cc-erp-obs" data-erp-obs="1" maxlength="2000" placeholder="Ex.: cliente quer faturar já nesta semana; condição de pagamento combinada 28 DDL; e-mail para NF: …">' + esc(f.obs) + '</textarea></div>' +
      (arqs.length ? '<div class="cc-erp-ax"><div class="l">Anexar arquivos da conta <small>até ' + fTam(max) + ' no total</small></div>' + arqs.map(function (a) {
        return '<label><input type="checkbox" data-erp-ax="' + esc(a.id) + '"' + (f.ax[a.id] ? ' checked' : '') + '><span class="nm">' + esc(a.titulo) + (a.ext && !new RegExp('\\.' + a.ext + '$', 'i').test(a.titulo) ? '.' + esc(a.ext) : '') + '</span><span class="tm">' + esc(fTam(a.tamanho)) + '</span></label>';
      }).join('') + '<div class="falta" id="cc-erp-ax-av"' + (soma > max ? '' : ' hidden') + '>' + (soma > max ? erpAvisoTam(soma) : '') + '</div></div>'
        : '<div class="cc-erp-ax"><div class="l">Arquivos</div><div class="nada">A conta não tem arquivos. Precisa mandar o cartão CNPJ ou outro documento? Anexe em "Notas e anexos" (abaixo) e ele aparece aqui.</div></div>') +
      '<div class="cc-form-msg' + (f.msgTipo ? ' ' + f.msgTipo : '') + '" id="cc-erp-msg"' + (f.msg ? '' : ' hidden') + '>' + (f.msg || '') + '</div>' +
      '<div class="cc-form-pe"><button type="button" class="cc-btn" data-erp-cancelar="1"' + (f.enviando ? ' disabled' : '') + '>Cancelar</button>' +
        '<button type="button" class="cc-btn prim" data-erp-enviar="1"' + (erpBloqueio(soma, max) ? ' disabled' : '') + '>' +
        (f.enviando ? '<span class="cc-spin"></span>Enviando o e-mail…' : IC_ERP + (f.reenviar ? 'Enviar de novo' : 'Enviar o pedido')) + '</button></div></div>';
  }
  // ── a conferência com a Receita (o cartão CNPJ), antes de enviar ──
  var ST_CONF = { igual: ['ok', '✓ confere'], diferente: ['dif', '≠ diferente'], falta: ['fal', 'falta na conta'] };
  function erpPrecisa() { var c = ST.erp && ST.erp.conf; return !!(c && c.estado === 'ok' && c.precisaConfirmar); }
  function erpBloqueio(soma, max) {
    var f = ST.erp; if (!f) return true;
    return !!(f.enviando || soma > max || (f.conf && f.conf.estado === 'buscando') || (erpPrecisa() && !f.ciente));
  }
  function htmlErpConf() {
    var f = ST.erp, c = f && f.conf;
    if (!c || c.estado === 'buscando') return '<div class="l">Conferência com a Receita Federal</div><div class="cc-erp-cst"><span class="cc-spin"></span>Conferindo a conta com a Receita (o cartão CNPJ)…</div>';
    if (c.estado === 'erro') return '<div class="l">Conferência com a Receita Federal</div><div class="cc-erp-cst">Não consegui conferir agora (' + esc(c.msg || '') + ') — o portal confere de novo no envio.</div>';
    var cf = c.conferencia || {};
    if (!cf.ok) return '<div class="l">Conferência com a Receita Federal</div><div class="cc-erp-cst">Não dá para conferir: ' + esc(cf.motivo || '') + '</div>';
    var cab = cf.ativa === false
      ? '<div class="cc-erp-cst dif"><b>O CNPJ está ' + esc(cf.situacao || 'irregular') + ' na Receita</b>' + (cf.dataSituacao ? ' desde ' + esc(fData(cf.dataSituacao)) : '') + (cf.motivoSituacao ? ' (' + esc(cf.motivoSituacao) + ')' : '') + '. Confira com o cliente.</div>'
      : cf.diferencas
        ? '<div class="cc-erp-cst dif"><b>A conta tem ' + cf.diferencas + (cf.diferencas > 1 ? ' diferenças' : ' diferença') + ' com a Receita.</b> O e-mail vai com este quadro e com a orientação de cadastrar no ERP com os dados da Receita. Se a conta estiver errada, peça a correção no CRM.</div>'
        : '<div class="cc-erp-cst ok"><b>✓ A conta confere com a Receita</b> — razão social, endereço, CEP, município e UF.' + (cf.faltas ? ' Faltam na conta: ' + esc(cf.linhas.filter(function (l) { return l.st === 'falta'; }).map(function (l) { return l.campo.toLowerCase(); }).join(', ')) + ' (vão os da Receita).' : '') + '</div>';
    return '<div class="l">Conferência com a Receita Federal <small>situação ' + esc(cf.situacao || '—') + '</small></div>' + cab +
      '<table class="cc-erp-tb"><thead><tr><th>Campo</th><th>Na conta (CRM)</th><th>Na Receita</th><th></th></tr></thead><tbody>' + cf.linhas.map(function (l) {
        var x = ST_CONF[l.st] || ST_CONF.falta;
        return '<tr class="' + x[0] + '"><td class="c">' + esc(l.campo) + '</td><td>' + (l.sf ? esc(l.sf) : '<span class="vz">—</span>') + '</td><td>' + esc(l.receita) + '</td><td><span class="st">' + x[1] + '</span></td></tr>';
      }).join('') + '</tbody></table>' +
      (c.precisaConfirmar ? '<label class="cc-erp-ciente"><input type="checkbox" data-erp-ciente="1"' + (f.ciente ? ' checked' : '') + '><span>Conferi ' +
        (cf.ativa === false ? 'a situação do CNPJ' : cf.diferencas > 1 ? 'as diferenças' : 'a diferença') + ' e quero enviar assim — o cadastro no ERP deve seguir a Receita.</span></label>' : '') +
      '<div class="cc-erp-ie">A inscrição estadual não está na Receita Federal (é da SEFAZ).</div>';
  }
  function erpPintarConf() { var el = $('cc-erp-conf'); if (el) el.innerHTML = htmlErpConf(); erpAtualizarBotao(); }
  function erpConferir() {
    var f = ST.erp, js = ST.fichaJs; if (!f || !js) return;
    var k = (js.cliente && js.cliente.k) || js.chave;
    f.conf = { estado: 'buscando' };
    getJson(API + '?erpConferir=' + encodeURIComponent(k)).then(function (res) {
      if (ST.erp !== f) return;
      var r = res.js || {};
      f.conf = res.r.ok && r.ok ? { estado: 'ok', conferencia: r.conferencia, precisaConfirmar: !!r.precisaConfirmar } : { estado: 'erro', msg: r.error || ('o portal respondeu ' + res.r.status) };
      erpPintarConf();
    }, function () { if (ST.erp !== f) return; f.conf = { estado: 'erro', msg: 'sem resposta do portal' }; erpPintarConf(); });
  }
  function erpAvisoTam(soma) { return 'Os arquivos marcados somam ' + fTam(soma) + ' — passa do limite de um e-mail.'; }
  // marcar/desmarcar arquivo: só o total e o botão (a seção não é redesenhada)
  function erpAtualizarBotao() {
    var f = ST.erp, js = ST.fichaJs; if (!f || !js) return;
    var max = ((js.erp && js.erp.anexoMaxKb) || 2800) * 1024, soma = 0;
    erpArquivos().forEach(function (a) { if (f.ax[a.id]) soma += a.tamanho || 0; });
    var av = $('cc-erp-ax-av'); if (av) { av.hidden = soma <= max; av.textContent = soma > max ? erpAvisoTam(soma) : ''; }
    var bt = document.querySelector('[data-erp-enviar]'); if (bt) bt.disabled = erpBloqueio(soma, max);
  }
  function erpRepintar() {
    var el = $('cc-sec-erp'); if (!el || !ST.fichaJs) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = htmlErp(ST.fichaJs);
    el.replaceWith(tmp.firstChild);
  }
  function erpAbrir() {
    if (ESPELHO) return;
    var js = ST.fichaJs;
    // a ficha ainda está carregando: abre quando ela chegar
    if (!js || js.chave !== ST.fichaChave) { ST.erpPendente = true; return; }
    if (!erpPode(js)) { toast(js.erp && js.erp.ligado === false ? 'O pedido de cadastro no ERP está desligado no portal.' : 'Este cliente não está "só no CRM" — não há cadastro no ERP a pedir.'); return; }
    var ps = js.erp.pedidos || [];
    ST.erp = { obs: '', ax: {}, enviando: false, msg: '', msgTipo: '', reenviar: ps.length > 0, ciente: false, conf: { estado: 'buscando' } };
    erpRepintar();
    erpConferir();
    var sec = $('cc-sec-erp'); if (sec) sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
    var t = $('cc-erp-obs'); if (t) setTimeout(function () { try { t.focus({ preventScroll: true }); } catch (e) { t.focus(); } }, 250);
  }
  function erpFechar() { if (ST.erp && ST.erp.enviando) return; ST.erp = null; erpRepintar(); }
  function erpMsg(html, tipo) {
    if (!ST.erp) return;
    ST.erp.msg = html; ST.erp.msgTipo = tipo || '';
    var el = $('cc-erp-msg'); if (el) { el.innerHTML = html || ''; el.className = 'cc-form-msg' + (tipo ? ' ' + tipo : ''); el.hidden = !html; }
  }
  function erpEnviar() {
    var f = ST.erp, js = ST.fichaJs; if (!f || f.enviando || !js) return;
    var k = (js.cliente && js.cliente.k) || js.chave;
    var ids = Object.keys(f.ax).filter(function (id) { return f.ax[id]; });
    f.enviando = true; f.msg = ''; f.msgTipo = ''; erpRepintar();
    postJson(API, { erp: { k: k, observacao: f.obs, anexos: ids, reenviar: !!f.reenviar, ciente: !!f.ciente } }).then(function (res) {
      if (ST.erp !== f) return;
      f.enviando = false;
      var st = res.r.status, r = res.js || {};
      if (st === 201 && r.pedido) {
        js.erp.pedidos = (js.erp.pedidos || []).concat([r.pedido]);
        ST.erpPed = ST.erpPed || {}; ST.erpPed[r.chave || k] = { em: r.pedido.em, por: r.pedido.por };
        ST.erp = null; erpRepintar(); pintarLista();
        toast('Pedido enviado para ' + (r.pedido.para || []).join(', '));
        if (!r.registrado) { var el = $('cc-sec-erp'); if (el) el.insertAdjacentHTML('beforeend', '<div class="cc-form-msg erro">O e-mail saiu, mas não consegui registrar o pedido no portal (' + esc(r.erroRegistro || '') + ') — a ficha pode não mostrar que foi pedido.</div>'); }
        return;
      }
      erpRepintar();
      if (st === 200 && r.teste) {
        erpMsg('<b>Modo de teste — o e-mail NÃO saiu.</b> Iria de ' + esc(r.email.de) + ' para ' + esc((r.email.para || []).join(', ')) + ': <i>' + esc(r.email.assunto) + '</i>' +
          (r.email.anexos && r.email.anexos.length ? ' · anexos: ' + esc(r.email.anexos.join(', ')) : ''));
        return;
      }
      if (st === 409 && r.conferencia) {
        f.conf = { estado: 'ok', conferencia: r.conferencia, precisaConfirmar: true }; f.ciente = false; erpPintarConf();
        erpMsg('<b>' + esc(r.error) + '</b> Veja o quadro da conferência e marque a confirmação para enviar.', 'erro');
        return;
      }
      if (st === 409 && r.jaPedido) {
        f.reenviar = true; erpRepintar();
        erpMsg('<b>' + esc(r.error) + '</b> Se precisa mandar de novo (faltou algo, mudou o cadastro), clique em "Enviar de novo".', 'erro');
        return;
      }
      erpMsg('<b>' + esc(r.error || ('O portal respondeu ' + st + '.')) + '</b>', 'erro');
    }, function () {
      if (ST.erp !== f) return;
      f.enviando = false; erpRepintar();
      erpMsg('<b>Não consegui falar com o portal.</b> O e-mail pode ter saído — confira nos seus Itens Enviados antes de tentar de novo.', 'erro');
    });
  }

  // ══════════════════════════════════════════════════════════════
  // CONTATO e ARQUIVO novos na conta do Salesforce (17/11/2026)
  // quem usa a Carteira não entra no SF: o portal grava com o usuário de
  // integração, na conta PRINCIPAL do CNPJ (a primeira da ficha)
  // ══════════════════════════════════════════════════════════════
  var CT_LISTAS = {
    tratamento: ['Sr.', 'Sra.', 'Dr.', 'Prof.', 'Enf.'],
    depto: ['Administrativo', 'Almoxarifado', 'Bloco Cirúrgico', 'Comissão de Padronização', 'Compras', 'Enfermagem', 'Farmácia', 'Financeiro', 'Hemodinâmica', 'Médico', 'OPME', 'TI'],
    cargo: ['Auxiliar/Assistente', 'Diretor(a)', 'Gerente', 'Médico(a)', 'Proprietario(a)', 'Supervisor(a)', 'Técnico', 'Enfermeiro(a)']
  };
  var CT_CAMPOS = [
    { k: 'tratamento', rot: 'Tratamento', cls: 's1', lista: 'tratamento' },
    { k: 'nome', rot: 'Nome', obrig: true, cls: 's1', max: 40 },
    { k: 'sobrenome', rot: 'Sobrenome', obrig: true, cls: 's2', max: 80 },
    { k: 'email', rot: 'E-mail', obrig: true, cls: 's2', max: 80, mask: 'email', ph: 'nome@hospital.com.br' },
    { k: 'depto', rot: 'Departamento', obrig: true, cls: 's1', lista: 'depto' },
    { k: 'cargo', rot: 'Cargo', obrig: true, cls: 's1', lista: 'cargo' },
    { k: 'telefone', rot: 'Telefone', cls: 's1', mask: 'fone', ph: '(00) 0000-0000' },
    { k: 'celular', rot: 'Celular', cls: 's1', mask: 'fone', ph: '(00) 90000-0000' },
    { k: 'crm', rot: 'CRM', cls: 's1', max: 60, medico: true, ph: 'CRM/UF 000000' },
    { k: 'especialidade', rot: 'Especialidade', cls: 's1', max: 255, medico: true },
    { k: 'obs', rot: 'Observação', cls: 's4', max: 2000, area: true }
  ];
  var AX_TIPOS = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'txt', 'csv', 'rtf', 'xml', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'zip', 'msg', 'eml'];
  function ctListas() { return (ST.ctModelo && ST.ctModelo.listas) || CT_LISTAS; }
  function axMaxMb() { return (ST.ctModelo && ST.ctModelo.anexoMaxMb) || 10; }
  function ctCampo(k) { return CT_CAMPOS.filter(function (c) { return c.k === k; })[0] || { k: k, rot: k }; }
  function ctMedico(d) { return norm(d.depto) === 'medico' || /^medico/.test(norm(d.cargo)); }
  function contaPrincipal() { var c = ST.fichaJs && ST.fichaJs.sf && ST.fichaJs.sf.contas; return c && c.length ? c[0] : null; }
  function ctCarregarModelo() {
    if (ST.ctModeloP) return ST.ctModeloP;
    ST.ctModeloP = getJson(API + '?modeloContato=1').then(function (res) {
      if (res.r.ok && res.js && res.js.ok) ST.ctModelo = res.js;
      else ST.ctModeloP = null;
      return ST.ctModelo;
    }, function () { ST.ctModeloP = null; return null; });
    return ST.ctModeloP;
  }

  function ctMotivo(k, v, d) {
    v = String(v == null ? '' : v).trim();
    var c = ctCampo(k);
    if (!v) return c.obrig ? 'Campo obrigatório' : '';
    if (c.max && v.length > c.max) return 'No máximo ' + c.max + ' caracteres';
    if ((k === 'nome' || k === 'sobrenome') && /[0-9@]/.test(v)) return 'Só letras (sem números ou e-mail)';
    if (k === 'email') return ncEmailOk(v.replace(/\s+/g, '')) ? '' : 'E-mail inválido — use nome@dominio.com.br';
    if (k === 'telefone' || k === 'celular') {
      if (/[a-z]/i.test(v)) return 'Aceita só números';
      var f = ncFoneDig(v);
      if (k === 'telefone' && /^0[3589]00/.test(f)) return f.length === 11 ? '' : 'Número 0800 incompleto';
      if (f.length < 10) return 'Incompleto — DDD + número';
      if (NC_DDDS.indexOf(f.slice(0, 2)) < 0) return 'DDD ' + f.slice(0, 2) + ' não existe';
      if (k === 'celular' && (f.length !== 11 || f[2] !== '9')) return 'Celular tem 11 números, com o 9 depois do DDD';
      if (f.length === 11 && f[2] !== '9') return 'Celular tem o 9 depois do DDD';
      if (f.length === 10 && !/[2-5]/.test(f[2])) return 'Fixo começa com 2, 3, 4 ou 5';
    }
    return '';
  }
  function ctValidar(d) {
    var e = {};
    CT_CAMPOS.forEach(function (c) { if (c.medico && !ctMedico(d)) return; var m = ctMotivo(c.k, d[c.k], d); if (m) e[c.k] = m; });
    return e;
  }

  function htmlCtCampo(c, f) {
    var v = f.d[c.k] || '', id = 'ct-' + c.k, ctl;
    if (c.lista) {
      var ops = ctListas()[c.lista] || [];
      if (v && ops.indexOf(v) < 0) ops = [v].concat(ops);
      ctl = '<select id="' + id + '" data-ct="' + c.k + '"><option value="">' + (c.obrig ? 'Escolha…' : '—') + '</option>' +
        ops.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    } else if (c.area) {
      ctl = '<textarea id="' + id + '" data-ct="' + c.k + '" rows="2" maxlength="' + c.max + '" placeholder="o que vale saber deste contato (opcional)">' + esc(v) + '</textarea>';
    } else {
      var modo = c.mask === 'fone' ? 'tel' : c.mask === 'email' ? 'email' : 'text';
      ctl = '<input type="text" id="' + id + '" data-ct="' + c.k + '" value="' + esc(v) + '" inputmode="' + modo + '" autocomplete="off" spellcheck="false"' +
        (c.max ? ' maxlength="' + c.max + '"' : c.mask === 'fone' ? ' maxlength="16"' : '') + (c.ph ? ' placeholder="' + esc(c.ph) + '"' : '') + '>';
    }
    var err = f.erros[c.k] || '';
    return '<div class="nc-campo ' + c.cls + (err ? ' inval' : '') + '" data-ctc="' + c.k + '"' + (c.medico && !ctMedico(f.d) ? ' hidden' : '') + '>' +
      '<label for="' + id + '">' + esc(c.rot) + (c.obrig ? '<b class="req">*</b>' : '') + '</label>' + ctl + '<small class="nc-err">' + esc(err) + '</small></div>';
  }
  function htmlCtForm() {
    var f = ST.ct, cp = contaPrincipal(), n = ((ST.fichaJs && ST.fichaJs.sf && ST.fichaJs.sf.contas) || []).length;
    return '<div class="cc-form" id="cc-ct-form">' +
      '<div class="cc-form-t">Novo contato <small>vai para a conta ' + esc((cp && cp.nome) || '') + (n > 1 ? ' (a principal das ' + n + ' com este CNPJ)' : '') + ' no CRM</small></div>' +
      '<div class="nc-grade">' + CT_CAMPOS.map(function (c) { return htmlCtCampo(c, f); }).join('') + '</div>' +
      '<div class="cc-form-msg' + (f.msgTipo ? ' ' + f.msgTipo : '') + '" id="cc-ct-msg"' + (f.msg ? '' : ' hidden') + '>' + (f.msg || '') + '</div>' +
      '<div class="cc-form-pe"><button type="button" class="cc-btn" data-ct-cancelar="1"' + (f.enviando ? ' disabled' : '') + '>Cancelar</button>' +
        '<button type="button" class="cc-btn prim" data-ct-salvar="1"' + (f.enviando ? ' disabled' : '') + '>' + (f.enviando ? '<span class="cc-spin"></span>Salvando no CRM…' : IC_MAIS + 'Salvar contato') + '</button></div></div>';
  }

  function htmlContatos(js) {
    var ct = js.contatos || {}, sL = (js.sf && js.sf.contas) || [];
    if (ct.ok === false) return '<div id="cc-sec-ct">' + secErro('Contatos', ct) + '</div>';
    if (!sL.length) return '<div id="cc-sec-ct"></div>';
    var cs = ct.linhas || [], ligado = !ESPELHO && (!ST.ctModelo || ST.ctModelo.contato !== false);
    var bt = ligado && !ST.ct ? '<button type="button" class="cc-btn cc-btn-sec" data-ct-novo="1">' + IC_MAIS + 'Novo contato</button>' : '';
    return '<div class="cc-sec" id="cc-sec-ct"><h3>Contatos <small>' + (cs.length ? cs.length + ' no CRM' : '') + '</small>' + bt + '</h3>' +
      (ST.ct ? htmlCtForm() : '') +
      (cs.length ? '<div class="cc-contatos">' + cs.map(function (p) {
        return '<div class="cc-ct' + (p.novo ? ' novo' : '') + '"><b>' + esc(p.nome) + '</b><div class="cg">' + esc([p.cargo, p.depto].filter(Boolean).join(' · ') || '—') + '</div>' +
          (p.email ? '<div><a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a></div>' : '') +
          (p.telefone ? '<div><a href="tel:' + esc(dig(p.telefone)) + '">' + esc(p.telefone) + '</a></div>' : '') +
          (p.celular ? '<div><a href="tel:' + esc(dig(p.celular)) + '">' + esc(p.celular) + '</a> (cel.)</div>' : '') + '</div>';
      }).join('') + '</div>' : (ST.ct ? '' : '<div class="nada">Nenhum contato cadastrado na conta.</div>')) + '</div>';
  }

  function htmlAnexos(js) {
    var ax = js.anexos || {}, sL = (js.sf && js.sf.contas) || [];
    if (ax.ok === false) return '<div id="cc-sec-ax">' + secErro('Notas e anexos', ax) + '</div>';
    if (!sL.length) return '<div id="cc-sec-ax"></div>';
    var la = ax.linhas || [], fila = (ST.ax && ST.ax.fila) || [], ligado = !ESPELHO && (!ST.ctModelo || ST.ctModelo.anexo !== false);
    // o arquivo abre PELO PORTAL (usuário de integração): ninguém precisa entrar no Salesforce
    var linkAx = function (x) {
      if (!x.id || !x.conta || x.obj === 'Note') return null;
      return '/api/carteira-clientes?arquivo=' + encodeURIComponent(x.id) + '&pai=' + encodeURIComponent(x.conta);
    };
    var tam = function (n) { return !n ? '' : n >= 1048576 ? (n / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; };
    var bt = ligado ? '<button type="button" class="cc-btn cc-btn-sec" data-ax-novo="1">' + IC_MAIS + 'Anexar arquivo</button>' +
      '<input type="file" id="cc-ax-in" multiple hidden accept="' + AX_TIPOS.map(function (x) { return '.' + x; }).join(',') + '">' : '';
    return '<div class="cc-sec' + (ESPELHO ? '' : ' cc-ax-zona') + '" id="cc-sec-ax"><h3>Notas e anexos <small>' + (la.length ? la.length + (la.length > 1 ? ' itens' : ' item') : '') + '</small>' + bt + '</h3>' +
      (ligado ? '<div class="cc-ax-dica">Arraste arquivos para cá ou use <b>Anexar arquivo</b> — PDF, imagem, Office, e-mail ou ZIP, até ' + axMaxMb() + ' MB cada. Vão para a conta no CRM.</div>' : '') +
      (fila.length ? '<div class="cc-ax-fila">' + fila.map(function (q) {
        return '<div class="cc-ax-it ' + q.estado + '">' + (q.estado === 'enviando' ? '<span class="cc-spin"></span>' : q.estado === 'ok' ? '<span class="ok">✓</span>' : '<span class="x">!</span>') +
          '<span class="nm">' + esc(q.nome) + '</span><span class="st">' + esc(q.estado === 'enviando' ? 'enviando…' : q.estado === 'ok' ? 'no CRM' : q.msg || 'não foi') + '</span></div>';
      }).join('') + '</div>' : '') +
      (la.length ? '<div style="overflow:auto"><table class="cc-mini"><thead><tr><th>Nome</th><th>Tipo</th><th>Modificado</th><th>Por</th></tr></thead><tbody>' +
        la.map(function (x) {
          var lk = linkAx(x);
          var nome = esc(x.titulo || '(sem título)');
          return '<tr' + (x.novo ? ' class="novo"' : '') + '><td>' + (lk ? '<a href="' + esc(lk) + '" data-arq="' + esc(lk) + '">' + nome + '</a>' : nome) +
            (x.texto ? '<div style="font-size:11px;color:#5F727A;white-space:normal;max-width:520px">' + esc(x.texto) + '</div>' : '') + '</td>' +
            '<td>' + esc(x.tipo === 'nota' ? 'Nota' : 'Arquivo' + (x.ext ? ' · ' + x.ext.toUpperCase() : '') + (x.tamanho ? ' · ' + tam(x.tamanho) : '')) + '</td>' +
            '<td>' + fData(String(x.data || '').slice(0, 10)) + '</td><td>' + esc(x.autor || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="nada">Nenhuma nota ou anexo na conta.</div>') + '</div>';
  }

  function repintarSec(qual) {
    var id = qual === 'ct' ? 'cc-sec-ct' : qual === 'ds' ? 'cc-sec-ds' : 'cc-sec-ax', el = $(id);
    if (!el || !ST.fichaJs) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = qual === 'ct' ? htmlContatos(ST.fichaJs) : qual === 'ds' ? htmlDescricao(ST.fichaJs) : htmlAnexos(ST.fichaJs);
    el.replaceWith(tmp.firstChild);
  }

  // ── contato ──
  function ctAbrir() {
    if (ESPELHO || !contaPrincipal()) return;
    var abre = function () {
      ST.ct = { d: {}, erros: {}, enviando: false, msg: '', msgTipo: '' };
      repintarSec('ct');
      var el = $('ct-nome'); if (el) el.focus();
    };
    if (ST.ctModelo) { abre(); return; }
    var b = document.querySelector('[data-ct-novo]'); if (b) { b.disabled = true; b.innerHTML = '<span class="cc-spin"></span>Abrindo…'; }
    ctCarregarModelo().then(abre, abre);
  }
  function ctFechar() { if (ST.ct && ST.ct.enviando) return; ST.ct = null; repintarSec('ct'); }
  function ctMsg(html, tipo) { if (!ST.ct) return; ST.ct.msg = html; ST.ct.msgTipo = tipo || ''; var el = $('cc-ct-msg'); if (el) { el.innerHTML = html || ''; el.className = 'cc-form-msg' + (tipo ? ' ' + tipo : ''); el.hidden = !html; } }
  // o aviso "confira" some quando não sobra campo com erro
  function ctLimparMsg() { if (ST.ct && ST.ct.msgTipo === 'erro' && !Object.keys(ST.ct.erros).length) ctMsg(''); }
  function ctPintarErro(k) {
    var w = document.querySelector('#cc-ct-form [data-ctc="' + k + '"]'); if (!w) return;
    var e = (ST.ct && ST.ct.erros[k]) || '';
    w.classList.toggle('inval', !!e);
    var s = w.querySelector('.nc-err'); if (s) s.textContent = e;
  }
  function ctSalvar() {
    var f = ST.ct, cp = contaPrincipal(); if (!f || f.enviando || !cp) return;
    f.erros = ctValidar(f.d);
    CT_CAMPOS.forEach(function (c) { ctPintarErro(c.k); });
    var ks = Object.keys(f.erros);
    if (ks.length) {
      ctMsg('<b>Confira antes de salvar:</b> ' + ks.map(function (k) { return esc(ctCampo(k).rot) + ' — ' + esc(f.erros[k].toLowerCase()); }).join(' · '), 'erro');
      var el = $('ct-' + ks[0]); if (el) el.focus();
      return;
    }
    var contato = {};
    CT_CAMPOS.forEach(function (c) { if (c.medico && !ctMedico(f.d)) return; contato[c.k] = String(f.d[c.k] || '').trim(); });
    var fichaSeq = ST.fichaSeq;
    f.enviando = true; f.msg = ''; repintarSec('ct');
    postJson(API, { contaId: cp.id, contato: contato }).then(function (res) {
      if (fichaSeq !== ST.fichaSeq || ST.ct !== f) return;
      f.enviando = false;
      var js = res.js || {}, st = res.r.status;
      if (st === 201 && js.ok) {
        var lista = (ST.fichaJs.contatos = ST.fichaJs.contatos || { ok: true, linhas: [] });
        lista.linhas = [Object.assign({ novo: true }, js.contato)].concat(lista.linhas || []);
        ST.ct = null; repintarSec('ct');
        toast('Contato salvo no CRM: ' + js.contato.nome);
        return;
      }
      if (st === 400 && js.erros) { f.erros = js.erros; repintarSec('ct'); ctMsg('<b>O portal recusou:</b> ' + Object.keys(js.erros).map(function (k) { return esc(ctCampo(k).rot) + ' — ' + esc(String(js.erros[k]).toLowerCase()); }).join(' · '), 'erro'); return; }
      if (st === 409 && js.duplicado) { f.erros = { email: 'Já é de ' + ((js.contato && js.contato.nome) || 'outro contato') + ' nesta conta' }; repintarSec('ct'); ctMsg(esc(js.error || 'Este e-mail já é de um contato desta conta.'), 'erro'); return; }
      repintarSec('ct'); ctMsg('<b>Nada foi salvo.</b> ' + esc(msgErro(res.r, js)), 'erro');
    }, function () {
      if (ST.ct !== f) return;
      f.enviando = false; repintarSec('ct');
      ctMsg('<b>Não consegui falar com o portal.</b> Confira a lista de contatos antes de tentar de novo.', 'erro');
    });
  }

  // ══════════════════════════════════════════════════════════════
  // DESCRIÇÃO da conta do CRM (19/11/2026)
  // "Incluir descrição": o texto entra NO FIM da descrição da conta
  // principal, num parágrafo "[data · quem escreveu]" — o servidor relê a
  // conta na hora de gravar; o que já estava lá não muda
  // ══════════════════════════════════════════════════════════════
  function dsMax() { return (ST.ctModelo && ST.ctModelo.descricaoMax) || 4000; }
  function dsLigado() { return !ESPELHO && (!ST.ctModelo || ST.ctModelo.descricao !== false); }
  function dsQuem() { var u = window._portalUser || {}; return u.name || u.email || ST.eu || 'você'; }
  function dsHoje() { return new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  function htmlDescricao(js) {
    var sL = (js && js.sf && js.sf.contas) || [];
    if (!sL.length) return '<div id="cc-sec-ds"></div>';
    var s0 = sL[0], d = s0.descricao || '', f = ST.ds;
    var bt = dsLigado() && !f ? '<button type="button" class="cc-btn cc-btn-sec" data-ds-novo="1">' + IC_MAIS + (d ? 'Incluir na descrição' : 'Incluir descrição') + '</button>' : '';
    var corpo = '';
    if (d) {
      // o parágrafo que acabou de entrar fica destacado
      var n = ST.dsNovo && ST.dsNovo.conta === s0.id && ST.dsNovo.de >= 0 && ST.dsNovo.de < d.length ? ST.dsNovo.de : -1;
      corpo = '<div class="cc-ds">' + (n < 0 ? esc(d) : esc(d.slice(0, n).replace(/\n+$/, '')) + '<mark class="novo">' + esc(d.slice(n)) + '</mark>') + '</div>';
    } else if (!f) corpo = '<div class="nada">Sem descrição na conta.</div>';
    return '<div class="cc-sec" id="cc-sec-ds"><h3>Descrição <small>do CRM</small>' + bt + '</h3>' + corpo + (f ? htmlDsForm(s0, sL.length) : '') + '</div>';
  }
  function htmlDsForm(s0, n) {
    var f = ST.ds, max = dsMax();
    return '<div class="cc-form" id="cc-ds-form">' +
      '<div class="cc-form-t">' + (s0.descricao ? 'Incluir na descrição' : 'Incluir descrição') +
        '<small>entra no fim da descrição da conta ' + esc(s0.nome || '') + (n > 1 ? ' (a principal das ' + n + ' com este CNPJ)' : '') +
        ' no CRM, abaixo de <b>[' + esc(dsHoje()) + ' · ' + esc(dsQuem()) + ']</b> — o que já está lá não muda</small></div>' +
      '<div class="nc-campo' + (f.erro ? ' inval' : '') + '" id="cc-ds-campo"><label for="cc-ds-txt">Texto<b class="req">*</b></label>' +
        '<textarea id="cc-ds-txt" rows="4" maxlength="' + max + '"' + (f.enviando ? ' disabled' : '') +
        ' placeholder="Ex.: comprador novo desde novembro (Maria, compras); prefere contato por WhatsApp; entrega pela portaria lateral.">' + esc(f.texto) + '</textarea>' +
        '<div class="cc-ds-pe"><small class="nc-err" id="cc-ds-err">' + esc(f.erro || '') + '</small><small class="cc-ds-cont" id="cc-ds-cont">' + dsContagem() + '</small></div></div>' +
      '<div class="cc-form-msg' + (f.msgTipo ? ' ' + f.msgTipo : '') + '" id="cc-ds-msg"' + (f.msg ? '' : ' hidden') + '>' + (f.msg || '') + '</div>' +
      '<div class="cc-form-pe"><button type="button" class="cc-btn" data-ds-cancelar="1"' + (f.enviando ? ' disabled' : '') + '>Cancelar</button>' +
        '<button type="button" class="cc-btn prim" data-ds-salvar="1"' + (f.enviando ? ' disabled' : '') + '>' +
        (f.enviando ? '<span class="cc-spin"></span>Salvando no CRM…' : IC_MAIS + 'Incluir no CRM') + '</button></div></div>';
  }
  function dsContagem() { var n = ST.ds ? String(ST.ds.texto || '').trim().length : 0; return n.toLocaleString('pt-BR') + ' de ' + dsMax().toLocaleString('pt-BR'); }
  function dsAbrir() {
    if (!contaPrincipal() || !dsLigado()) return;
    ST.ds = { texto: '', erro: '', enviando: false, msg: '', msgTipo: '' }; ST.dsNovo = null;
    repintarSec('ds');
    var el = $('cc-ds-txt'); if (el) el.focus();
  }
  function dsFechar() { if (ST.ds && ST.ds.enviando) return; ST.ds = null; repintarSec('ds'); }
  function dsMsg(html, tipo) { if (!ST.ds) return; ST.ds.msg = html; ST.ds.msgTipo = tipo || ''; var el = $('cc-ds-msg'); if (el) { el.innerHTML = html || ''; el.className = 'cc-form-msg' + (tipo ? ' ' + tipo : ''); el.hidden = !html; } }
  function dsPintarErro() {
    var w = $('cc-ds-campo'), e = (ST.ds && ST.ds.erro) || ''; if (!w) return;
    w.classList.toggle('inval', !!e);
    var s = $('cc-ds-err'); if (s) s.textContent = e;
  }
  function dsSalvar() {
    var f = ST.ds, cp = contaPrincipal(); if (!f || f.enviando || !cp) return;
    var texto = String(f.texto || '').trim();
    f.erro = !texto ? 'Escreva o texto que vai para a descrição' : texto.length > dsMax() ? 'No máximo ' + dsMax().toLocaleString('pt-BR') + ' caracteres' : '';
    if (f.erro) { dsPintarErro(); var el = $('cc-ds-txt'); if (el) el.focus(); return; }
    var fichaSeq = ST.fichaSeq;
    f.enviando = true; f.msg = ''; f.msgTipo = ''; repintarSec('ds');
    postJson(API, { contaId: cp.id, descricao: { texto: texto } }).then(function (res) {
      if (fichaSeq !== ST.fichaSeq || ST.ds !== f) return;
      f.enviando = false;
      var js = res.js || {}, st = res.r.status;
      if (st === 200 && js.ok) {
        cp.descricao = js.descricao || cp.descricao;
        ST.dsNovo = { conta: cp.id, de: js.incluido && js.incluido.inicio != null ? Number(js.incluido.inicio) : -1 };
        ST.ds = null; repintarSec('ds');
        toast('Descrição incluída no CRM');
        return;
      }
      if (st === 400 && js.erros && js.erros.texto) f.erro = js.erros.texto;
      repintarSec('ds');
      // 403 do CRM (sem permissão de editar a conta) não é falta da área Comercial
      dsMsg('<b>Nada foi salvo.</b> ' + esc(st === 403 && js.error && !/Área restrita/.test(js.error) ? js.error : msgErro(res.r, js)), 'erro');
      var t = $('cc-ds-txt'); if (t) t.focus();
    }, function () {
      if (ST.ds !== f) return;
      f.enviando = false; repintarSec('ds');
      dsMsg('<b>Não consegui falar com o portal.</b> Feche e abra a ficha para conferir a descrição antes de tentar de novo.', 'erro');
    });
  }

  // ── arquivos ──
  function axEscolher() { var i = $('cc-ax-in'); if (i) { i.value = ''; i.click(); } }
  function axLer(arq) {
    return new Promise(function (ok, falha) {
      var fr = new FileReader();
      fr.onload = function () { ok(String(fr.result || '').replace(/^data:[^,]*,/, '')); };
      fr.onerror = function () { falha(new Error('não consegui ler o arquivo')); };
      fr.readAsDataURL(arq);
    });
  }
  async function axEnviar(arquivos) {
    if (ESPELHO) return;
    var cp = contaPrincipal(); if (!cp || !arquivos || !arquivos.length) return;
    if (!ST.ctModelo) await ctCarregarModelo();
    var fichaSeq = ST.fichaSeq, ax = ST.ax = ST.ax || { fila: [] }, max = axMaxMb() * 1048576;
    var itens = Array.prototype.slice.call(arquivos, 0, 20).map(function (a) {
      var m = /\.([A-Za-z0-9]{1,5})$/.exec(a.name || ''), ext = m ? m[1].toLowerCase() : '';
      var q = { nome: a.name || 'arquivo', estado: 'enviando', arq: a };
      if (AX_TIPOS.indexOf(ext) < 0) { q.estado = 'erro'; q.msg = 'tipo não aceito (' + (ext ? '.' + ext : 'sem extensão') + ')'; }
      else if (!a.size) { q.estado = 'erro'; q.msg = 'arquivo vazio'; }
      else if (a.size > max) { q.estado = 'erro'; q.msg = 'passa de ' + axMaxMb() + ' MB'; }
      return q;
    });
    ax.fila = ax.fila.filter(function (q) { return q.estado === 'enviando'; }).concat(itens);
    repintarSec('ax');
    var nOk = 0;
    for (var i = 0; i < itens.length; i++) {
      var q = itens[i];
      if (q.estado !== 'enviando') continue;
      try {
        var b64 = await axLer(q.arq);
        var res = await postJson(API, { contaId: cp.id, anexo: { nome: q.nome, base64: b64 } });
        var js = res.js || {};
        if (res.r.status === 201 && js.ok) {
          q.estado = 'ok'; nOk++;
          if (fichaSeq === ST.fichaSeq) {
            var lista = (ST.fichaJs.anexos = ST.fichaJs.anexos || { ok: true, linhas: [] });
            lista.linhas = [Object.assign({ novo: true }, js.anexo)].concat(lista.linhas || []);
          }
        } else { q.estado = 'erro'; q.msg = res.r.status === 413 ? (js.error || 'grande demais') : msgErro(res.r, js); }
      } catch (e) { q.estado = 'erro'; q.msg = 'não consegui enviar — confira a lista antes de tentar de novo'; }
      delete q.arq;
      if (fichaSeq === ST.fichaSeq) repintarSec('ax');
    }
    if (fichaSeq !== ST.fichaSeq) return;
    // os enviados já estão na tabela: some da fila; os que falharam ficam com o motivo
    ax.fila = ax.fila.filter(function (q) { return q.estado !== 'ok'; });
    repintarSec('ax');
    if (nOk) toast(nOk === 1 ? 'Arquivo salvo no CRM' : nOk + ' arquivos salvos no CRM');
  }

  function ligarFicha() {
    var fb = $('cc-fb'); if (!fb) return;
    fb.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target : null; if (!t) return;
      if (t.closest('[data-ct-novo]')) { ctAbrir(); return; }
      if (t.closest('[data-ct-cancelar]')) { ctFechar(); return; }
      if (t.closest('[data-ct-salvar]')) { ctSalvar(); return; }
      if (t.closest('[data-ax-novo]')) { axEscolher(); return; }
      if (t.closest('[data-ds-novo]')) { dsAbrir(); return; }
      if (t.closest('[data-ds-cancelar]')) { dsFechar(); return; }
      if (t.closest('[data-ds-salvar]')) { dsSalvar(); return; }
      if (t.closest('[data-erp-cancelar]')) { erpFechar(); return; }
      if (t.closest('[data-erp-enviar]')) { erpEnviar(); return; }
    });
    fb.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.id === 'cc-ax-in') { axEnviar(t.files); return; }
      if (t && t.hasAttribute && t.hasAttribute('data-erp-ax') && ST.erp) { ST.erp.ax[t.getAttribute('data-erp-ax')] = t.checked; erpAtualizarBotao(); return; }
      if (t && t.hasAttribute && t.hasAttribute('data-erp-ciente') && ST.erp) { ST.erp.ciente = t.checked; erpAtualizarBotao(); return; }
      var k = t && t.getAttribute && t.getAttribute('data-ct'); if (!k || !ST.ct) return;
      if (k === 'email') t.value = t.value.replace(/\s+/g, '').toLowerCase();
      ST.ct.d[k] = t.value;
      if (k === 'depto' || k === 'cargo') {
        document.querySelectorAll('#cc-ct-form [data-ctc]').forEach(function (w) { var c = ctCampo(w.getAttribute('data-ctc')); if (c.medico) w.hidden = !ctMedico(ST.ct.d); });
      }
      var m = ctMotivo(k, t.value, ST.ct.d);
      if (t.value && m) { ST.ct.erros[k] = m; ctPintarErro(k); }
      else if (ST.ct.erros[k] && !m) { delete ST.ct.erros[k]; ctPintarErro(k); }
      ctLimparMsg();
    });
    fb.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'cc-erp-obs' && ST.erp) { ST.erp.obs = e.target.value; return; }
      if (e.target && e.target.id === 'cc-ds-txt' && ST.ds) {
        ST.ds.texto = e.target.value;
        var cn = $('cc-ds-cont'); if (cn) cn.textContent = dsContagem();
        if (ST.ds.erro && e.target.value.trim()) { ST.ds.erro = ''; dsPintarErro(); }
        return;
      }
      var t = e.target, k = t && t.getAttribute && t.getAttribute('data-ct'); if (!k || !ST.ct) return;
      var c = ctCampo(k), v = t.value;
      if (c.mask === 'fone') { var f = ncFoneMasc(v); if (f !== v) t.value = v = f; }
      ST.ct.d[k] = v;
      if (ST.ct.erros[k] && !ctMotivo(k, v, ST.ct.d)) { delete ST.ct.erros[k]; ctPintarErro(k); }
      ctLimparMsg();
    });
    fb.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && ST.ct && e.target && e.target.matches && e.target.matches('#cc-ct-form input')) { e.preventDefault(); ctSalvar(); }
      // a descrição tem várias linhas: Enter quebra a linha, Ctrl+Enter salva
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ST.ds && e.target && e.target.id === 'cc-ds-txt') { e.preventDefault(); dsSalvar(); }
    });
    // arrastar arquivos para "Notas e anexos"
    var zona = function (e) { return e.target && e.target.closest ? e.target.closest('.cc-ax-zona') : null; };
    var temArq = function (e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; };
    fb.addEventListener('dragover', function (e) { var z = zona(e); if (!z || !temArq(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; z.classList.add('sobre'); });
    fb.addEventListener('dragleave', function (e) { var z = zona(e); if (z && !z.contains(e.relatedTarget)) z.classList.remove('sobre'); });
    fb.addEventListener('drop', function (e) {
      var z = zona(e); if (!z || !temArq(e)) return;
      e.preventDefault(); z.classList.remove('sobre');
      axEnviar(e.dataTransfer.files);
    });
  }

  function uniq(a) { return a.filter(function (v, i, l) { return v && l.indexOf(v) === i; }); }
  // o mesmo dado escrito de jeitos diferentes não é diferença
  function mesmo(a, b, tipo) {
    if (tipo === 'doc' || tipo === 'tel' || tipo === 'dig') { var da = dig(a), db = dig(b); return tipo === 'tel' ? da.slice(-8) === db.slice(-8) : da.replace(/^0+/, '') === db.replace(/^0+/, ''); }
    if (tipo === 'cod') { var la = a.split(' · '), lb = b.split(' · '); return lb.every(function (x) { return la.indexOf(x) >= 0; }); }
    if (tipo === 'livre') return true;   // endereço e e-mail: cada sistema guarda o seu, não é erro
    var na = norm(a).replace(/[^a-z0-9 ]/g, '').replace(/\b(ltda|me|epp|s a|sa|eireli)\b/g, '').replace(/\s+/g, ' ').trim();
    var nb = norm(b).replace(/[^a-z0-9 ]/g, '').replace(/\b(ltda|me|epp|s a|sa|eireli)\b/g, '').replace(/\s+/g, ' ').trim();
    return na === nb;
  }
  function detalheAlerta(a, dL, sL) {
    var cods = uniq(dL.map(function (x) { return x.codigo; })), codsSf = uniq(sL.map(function (x) { return x.codErp; }));
    if (a === 'cod-diverge') return ' <b>Dynamics: ' + esc(cods.join(', ') || '—') + ' · CRM: ' + esc(codsSf.join(', ') || '—') + '</b>';
    if (a === 'cod-outro' || a === 'cod-orfao') return codsSf.length ? ' <b>Código ERP no CRM: ' + esc(codsSf.join(', ')) + '</b>' : '';
    if (a === 'sf-dup') return ' <b>' + sL.length + ' contas: ' + esc(sL.map(function (x) { return x.docBruto; }).join(' · ')) + '</b>';
    return '';
  }

  // ══════════════════════════════════════════════════════════════
  // EXCEL (o recorte de agora)
  // ══════════════════════════════════════════════════════════════
  function excel() {
    if (!window.XLSX) { toast('A biblioteca do Excel ainda está carregando'); return; }
    var arr = ordenar(ST.filtrados);
    var linhas = arr.map(function (c) {
      return {
        'Cliente': c.nome, 'Nome fantasia': c.fantasia, 'CNPJ/CPF': c.doc ? fDoc(c.doc) : '', 'Cadastro no ERP': c.sit === 'sf' ? 'Não' : 'Sim',
        'Código(s) no Dynamics': c.codigos, 'Empresas (Dynamics)': c.empresas, 'Grupo (Dynamics)': c.grupo, 'Bloqueado no Dynamics': c.bloq ? 'Sim' : '',
        'Código ERP (CRM)': c.codErp, 'Dono da conta (CRM)': c.dono, 'Tipo de cliente': c.tipo, 'Unidade (CRM)': c.unid,
        'Rede hospitalar': c.rede, 'Órgão público': c.orgao, 'Conta ativa (CRM)': c.sfId ? simNao(c.ativo) : '', 'Cliente MSB': c.msb ? 'Sim' : '',
        'UF': c.uf, 'Cidade': c.cidade, 'Última atividade (CRM)': c.ultAtiv ? fData(c.ultAtiv) : '',
        'Pendências / marcas': c.alertas.map(function (a) { return (ST.alertas[a] || {}).rot || a; }).join('; '),
        'Link no CRM': linkSf(c.sfId) || ''
      };
    });
    var ws = XLSX.utils.json_to_sheet(linhas);
    ws['!cols'] = [{ wch: 44 }, { wch: 28 }, { wch: 20 }, { wch: 16 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 24 }, { wch: 20 }, { wch: 14 },
      { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 6 }, { wch: 20 }, { wch: 12 }, { wch: 40 }, { wch: 60 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Carteira');
    var h = new Date();
    XLSX.writeFile(wb, 'carteira-de-clientes-' + h.getFullYear() + String(h.getMonth() + 1).padStart(2, '0') + String(h.getDate()).padStart(2, '0') + '.xlsx');
  }

  // ══════════════════════════════════════════════════════════════
  // NOVA CONTA no Salesforce (06/11/2026)
  // O "Cliente novo" saiu do Agente de Cotações: cliente novo é cadastrado
  // AQUI, como Conta do Salesforce, antes de virar oportunidade. O CNPJ é
  // conferido nas duas fontes — já tem conta no SF? não cria outra; está
  // no Dynamics? o cadastro dele preenche o formulário. O servidor
  // (api/shared/carteira-conta-nova.js) confere tudo de novo e cria a
  // conta com quem cadastrou de dono. As regras abaixo são as dele.
  // ══════════════════════════════════════════════════════════════
  var NC_UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
  var NC_DDDS = ('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 ' +
    '61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99').split(' ');
  var NC_CEP_UF = [[1000, 19999, 'SP'], [20000, 28999, 'RJ'], [29000, 29999, 'ES'], [30000, 39999, 'MG'], [40000, 48999, 'BA'], [49000, 49999, 'SE'],
    [50000, 56999, 'PE'], [57000, 57999, 'AL'], [58000, 58999, 'PB'], [59000, 59999, 'RN'], [60000, 63999, 'CE'], [64000, 64999, 'PI'],
    [65000, 65999, 'MA'], [66000, 68899, 'PA'], [68900, 68999, 'AP'], [69000, 69299, 'AM'], [69300, 69399, 'RR'], [69400, 69899, 'AM'],
    [69900, 69999, 'AC'], [70000, 72799, 'DF'], [72800, 72999, 'GO'], [73000, 73699, 'DF'], [73700, 76799, 'GO'], [76800, 76999, 'RO'],
    [77000, 77999, 'TO'], [78000, 78899, 'MT'], [79000, 79999, 'MS'], [80000, 87999, 'PR'], [88000, 89999, 'SC'], [90000, 99999, 'RS']];
  // a Unidade de Negócio que o Salesforce calcula pela UF (fórmula da Conta)
  var NC_UNID = { SP: 'Bio SP', RJ: 'Bio RJ', ES: 'Bio RJ', PR: 'Bio SUL', SC: 'Bio SUL', RS: 'Bio SUL', MG: 'Bio MG', GO: 'Bio MG', DF: 'Bio MG', MT: 'Bio MG', MS: 'Bio MG', TO: 'Bio MG' };
  // listas de reserva (o servidor manda as da org em ?modeloConta=1)
  var NC_LISTAS = { tipo: ['Hospital Particular', 'Órgão Público', 'Convênio', 'Distribuidor', 'Pessoa Física'], rede: ['DASA', "REDE D'OR", 'UHG_AMIL'], orgao: ['Federal', 'Estadual', 'Municipal'] };
  var NC_CAMPOS = [
    { sec: 'Conta' },
    { k: 'nome', rot: 'Razão social', obrig: true, cls: 's4', max: 255 },
    { k: 'fantasia', rot: 'Nome fantasia', cls: 's2', max: 255 },
    { k: 'tipo', rot: 'Tipo de cliente', obrig: true, cls: 's2', lista: 'tipo' },
    { k: 'orgao', rot: 'Esfera do órgão público', cls: 's2', lista: 'orgao', soOrgao: true },
    { k: 'rede', rot: 'Rede hospitalar', cls: 's2', lista: 'rede', dica: 'em branco se não for de rede' },
    { k: 'codErp', rot: 'Código ERP', cls: 's1', max: 8, ph: 'C004512' },
    { k: 'ie', rot: 'Inscrição estadual', cls: 's1', max: 20, ph: 'números ou ISENTO' },
    { sec: 'Endereço' },
    { k: 'cep', rot: 'CEP', obrig: true, cls: 's1', mask: 'cep', ph: '00000-000' },
    { k: 'uf', rot: 'UF', obrig: true, cls: 's1', lista: 'uf' },
    { k: 'cidade', rot: 'Cidade', obrig: true, cls: 's2', max: 40 },
    { k: 'rua', rot: 'Endereço (rua e número)', obrig: true, cls: 's3', max: 255, ph: 'Av. Brasil, 1200' },
    { k: 'bairro', rot: 'Bairro', cls: 's1', max: 255 },
    { sec: 'Contato' },
    { k: 'telefone', rot: 'Telefone', cls: 's2', mask: 'fone', ph: '(00) 0000-0000' },
    { k: 'email', rot: 'E-mail', cls: 's2', mask: 'email', max: 80, ph: 'compras@hospital.com.br' },
    { k: 'msb', rot: 'Cliente MSB', cls: 's4', bool: true, dica: 'a conta é da carteira MSB' }
  ];
  var NC = { d: {}, dyn: {}, erros: {}, de: '', prev: null, prevSeq: 0, prevDoc: '', enviando: false, fim: null, modelo: null,
    cepDoc: '', cepSeq: 0, cepSt: null };
  // o dono de toda conta nova (o servidor confirma em ?modeloConta=1)
  var NC_DONO = { nome: 'TI Projetos', email: 'servicos.ti@biomedical.com.br' };
  function ncDono() { var d = NC.modelo && NC.modelo.dono; return { nome: (d && d.nome) || NC_DONO.nome, email: (d && d.email) || NC_DONO.email }; }
  // a marca do campo pela fonte que o preencheu
  function ncClasseFonte(f) { return f === 'rf' ? 'rf' : f === 'cep' ? 'cep' : f ? 'dyn' : ''; }

  function ncDv(d, p1, p2) {
    var dv = function (p) { var s = 0; for (var i = 0; i < p.length; i++) s += Number(d[i]) * p[i]; var r = s % 11; return r < 2 ? 0 : 11 - r; };
    return dv(p1) === Number(d[p1.length]) && dv(p2) === Number(d[p2.length]);
  }
  function ncCnpjOk(d) { return d.length === 14 && !/^(\d)\1+$/.test(d) && ncDv(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); }
  function ncCpfOk(d) {
    if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
    var dv = function (n) { var s = 0; for (var i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); var r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
  }
  function ncDocOk(d) { return d.length === 14 ? ncCnpjOk(d) : d.length === 11 ? ncCpfOk(d) : false; }
  // 00.000.000/0000-00 montado aos poucos (CPF válido de 11 vira 000.000.000-00)
  function ncCnpjMasc(v) {
    var d = dig(v).slice(0, 14);
    if (d.length === 11 && ncCpfOk(d)) return fDoc(d);
    return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4').replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5');
  }
  function ncCepMasc(v) { var d = dig(v).slice(0, 8); return d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d; }
  function ncUfDoCep(v) {
    var d = dig(v); if (d.length !== 8) return '';
    var n = Number(d.slice(0, 5));
    for (var i = 0; i < NC_CEP_UF.length; i++) if (n >= NC_CEP_UF[i][0] && n <= NC_CEP_UF[i][1]) return NC_CEP_UF[i][2];
    return '';
  }
  function ncFoneDig(v) {
    var d = dig(v);
    if ((d.length === 12 || d.length === 13) && d.slice(0, 2) === '55') d = d.slice(2);
    if ((d.length === 11 || d.length === 12) && d[0] === '0' && !/^0[3589]00/.test(d)) d = d.slice(1);
    return d.slice(0, 11);
  }
  function ncFoneMasc(v) {
    var d = dig(v).slice(0, 11);
    if (!d) return '';
    if (d[0] === '0') return d.replace(/^(\d{4})(\d)/, '$1 $2').replace(/^(\d{4}) (\d{3})(\d)/, '$1 $2 $3');
    if (d.length <= 2) return '(' + d;
    var n = d.slice(2);
    return '(' + d.slice(0, 2) + ') ' + (n.length <= 4 ? n : n.length <= 8 ? n.slice(0, 4) + '-' + n.slice(4) : n.slice(0, 5) + '-' + n.slice(5));
  }
  function ncEmailOk(e) { return /^[a-z0-9._%+-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(e) && !/^\.|\.\.|\.@/.test(e); }
  function ncListas() { return (NC.modelo && NC.modelo.listas) || NC_LISTAS; }
  function ncCampoDef(k) { return NC_CAMPOS.filter(function (c) { return c.k === k; })[0] || (k === 'cnpj' ? { k: 'cnpj', rot: 'CNPJ / CPF', obrig: true } : { k: k, rot: k }); }

  // '' = ok; senão o motivo (as regras do servidor)
  function ncMotivo(k, v) {
    v = String(v == null ? '' : v).trim();
    var c = ncCampoDef(k);
    if (c.bool) return '';
    if (!v) return c.obrig ? 'Campo obrigatório' : '';
    if (c.max && v.length > c.max) return 'No máximo ' + c.max + ' caracteres (tem ' + v.length + ')';
    var d = dig(v);
    if (k === 'cnpj') {
      if (/[a-z]/i.test(v)) return 'CNPJ aceita só números';
      if (d.length !== 14 && d.length !== 11) return 'CNPJ incompleto — são 14 números (CPF, 11)';
      return ncDocOk(d) ? '' : (d.length === 11 ? 'CPF' : 'CNPJ') + ' inválido — o dígito verificador não confere';
    }
    if (k === 'cep') return /[a-z]/i.test(v) ? 'CEP aceita só números' : (d.length !== 8 || /^0+$/.test(d)) ? 'CEP incompleto — são 8 números' : '';
    if (k === 'uf') return NC_UFS.indexOf(v.toUpperCase()) >= 0 ? '' : 'UF inválida';
    if (k === 'telefone') {
      if (/[a-z]/i.test(v)) return 'Telefone aceita só números';
      var f = ncFoneDig(v);
      if (/^0[3589]00/.test(f)) return f.length === 11 ? '' : 'Número 0800 incompleto — 0800 000 0000';
      if (f.length < 10) return 'Telefone incompleto — DDD + número';
      if (NC_DDDS.indexOf(f.slice(0, 2)) < 0) return 'DDD ' + f.slice(0, 2) + ' não existe';
      if (f.length === 11 && f[2] !== '9') return 'Celular tem o 9 depois do DDD';
      if (f.length === 10 && !/[2-5]/.test(f[2])) return 'Fixo começa com 2, 3, 4 ou 5 — celular tem o 9 na frente';
      return '';
    }
    if (k === 'email') return ncEmailOk(v.replace(/\s+/g, '')) ? '' : 'E-mail inválido — use nome@dominio.com.br';
    if (k === 'codErp') return /^[A-Z0-9]{1,8}$/i.test(v.replace(/\s+/g, '')) ? '' : 'Letras e números, até 8 (ex.: C004512)';
    if (k === 'ie') return /^(ISENTO|[0-9./-]{2,20})$/i.test(v) ? '' : 'Só números (ou ISENTO)';
    if (k === 'tipo') {
      var cpf = dig(NC.d.cnpj).length === 11, pf = norm(v) === 'pessoa fisica';
      if (ncDocOk(dig(NC.d.cnpj)) && cpf && !pf) return 'Com CPF, o tipo de cliente é Pessoa Física';
      if (ncDocOk(dig(NC.d.cnpj)) && !cpf && pf) return 'Pessoa Física tem CPF, não CNPJ';
    }
    return '';
  }
  function ncValidar() {
    var e = {};
    ['cnpj'].concat(NC_CAMPOS.filter(function (c) { return c.k && !(c.soOrgao && NC.d.tipo !== 'Órgão Público'); }).map(function (c) { return c.k; }))
      .forEach(function (k) { var m = ncMotivo(k, NC.d[k]); if (m) e[k] = m; });
    return e;
  }

  function ncCampo(c) {
    var v = NC.d[c.k], id = 'nc-' + c.k;
    var lab = '<label for="' + id + '">' + esc(c.rot) + (c.obrig ? '<b class="req">*</b>' : '') + '</label>';
    var ctl;
    if (c.bool) {
      ctl = '<label class="nc-chk"><input type="checkbox" id="' + id + '" data-nc="' + c.k + '"' + (v ? ' checked' : '') + '>' + esc(c.dica || c.rot) + '</label>';
      lab = '<label>' + esc(c.rot) + '</label>';
    } else if (c.lista) {
      var ops = c.lista === 'uf' ? NC_UFS : (ncListas()[c.lista] || []);
      if (v && ops.indexOf(v) < 0) ops = [v].concat(ops);
      ctl = '<select id="' + id + '" data-nc="' + c.k + '"><option value="">' + (c.obrig ? 'Escolha…' : '—') + '</option>' +
        ops.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    } else {
      var modo = c.mask === 'cep' ? 'numeric' : c.mask === 'fone' ? 'tel' : c.mask === 'email' ? 'email' : 'text';
      ctl = '<input type="text" id="' + id + '" data-nc="' + c.k + '" value="' + esc(v || '') + '" inputmode="' + modo + '" autocomplete="off" spellcheck="false"' +
        (c.max ? ' maxlength="' + c.max + '"' : c.mask === 'cep' ? ' maxlength="9"' : c.mask === 'fone' ? ' maxlength="16"' : '') + (c.ph ? ' placeholder="' + esc(c.ph) + '"' : '') + '>';
    }
    return '<div class="nc-campo ' + c.cls + (NC.dyn[c.k] ? ' ' + ncClasseFonte(NC.dyn[c.k]) : '') + '" data-campo="' + c.k + '"' + (c.soOrgao && NC.d.tipo !== 'Órgão Público' ? ' hidden' : '') + '>' +
      lab + ctl + '<small class="nc-err"></small>' + (c.dica && !c.bool ? '<small class="nc-dica">' + esc(c.dica) + '</small>' : '') + '</div>';
  }

  function ncHtmlForm() {
    var h = [];
    if (NC.de === 'cotacao') h.push('<div class="nc-aviso">Você veio do <b>Agente de Cotações</b>: crie a conta aqui e volte para a aba da cotação — o comprador é conferido de novo quando você voltar.</div>');
    h.push('<div class="nc-sec"><h4>Documento</h4><div class="nc-grade">' +
      '<div class="nc-campo s2 nc-doc" data-campo="cnpj"><label for="nc-cnpj">CNPJ / CPF<b class="req">*</b></label><div class="nc-busca">' +
        '<input type="text" id="nc-cnpj" data-nc="cnpj" value="' + esc(NC.d.cnpj || '') + '" inputmode="numeric" maxlength="18" autocomplete="off" spellcheck="false" placeholder="00.000.000/0000-00">' +
        '<button type="button" class="cc-btn prim" id="nc-buscar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16" y2="16"/></svg>Buscar</button></div>' +
        '<small class="nc-err"></small></div>' +
      '<div class="s2 nc-st" id="nc-st"></div></div></div>');
    var sec = null, buf = [];
    var fecha = function () { if (sec) h.push('<div class="nc-sec"><h4>' + esc(sec) + '</h4><div class="nc-grade">' + buf.join('') + '</div>' + (sec === 'Endereço' ? '<div class="nc-unid" id="nc-unid"></div>' : '') + '</div>'); buf = []; };
    NC_CAMPOS.forEach(function (c) { if (c.sec) { fecha(); sec = c.sec; } else buf.push(ncCampo(c)); });
    fecha();
    return h.join('');
  }

  function ncAbrir(o) {
    if (ESPELHO) return;
    o = o || {};
    NC.d = { cnpj: o.doc ? ncCnpjMasc(o.doc) : '' }; NC.dyn = {}; NC.erros = {}; NC.prev = null; NC.prevDoc = ''; NC.prevSeq++;
    NC.enviando = false; NC.fim = null; NC.de = o.de || '';
    NC.cepDoc = ''; NC.cepSt = null; NC.cepSeq++;
    var m = $('cc-nova');
    m.innerHTML = '<div class="cc-mod-c" role="dialog" aria-modal="true" aria-labelledby="nc-tt">' +
      '<div class="cc-mod-h"><button type="button" class="fechar" id="nc-fechar" aria-label="Fechar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
        '<div class="k">Nova conta no CRM</div><h2 id="nc-tt">Cadastrar cliente</h2>' +
        '<p>Cliente novo entra aqui antes de virar oportunidade. Os campos com <b>*</b> são obrigatórios; o dono da conta é a ' + esc(ncDono().nome) + '.</p></div>' +
      '<div class="cc-mod-b" id="nc-b">' + ncHtmlForm() + '</div>' +
      '<div class="cc-mod-f" id="nc-f"></div></div>';
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    ncPintarStatus(); ncPintarRodape(); ncPintarUnid();
    try { var u = new URL(location.href); u.searchParams.set('novaConta', dig(o.doc || '') || '1'); history.replaceState(null, '', u); } catch (e) { }
    var alvo = $('nc-cnpj'); if (alvo) setTimeout(function () { (NC.d.cnpj ? $('nc-nome') : alvo).focus(); }, 30);
    if (!NC.modelo) ncCarregarModelo();
    if (NC.d.cnpj) ncBuscar(o.preencher === true);
  }
  function ncFechar() {
    if (NC.enviando) return;
    $('cc-nova').hidden = true; $('cc-nova').innerHTML = '';
    if (!ST.fichaK) document.body.style.overflow = '';
    NC.prevSeq++;
    try { var u = new URL(location.href); u.searchParams.delete('novaConta'); u.searchParams.delete('de'); history.replaceState(null, '', u); } catch (e) { }
  }
  function ncAberto() { var m = $('cc-nova'); return !!m && !m.hidden; }

  function ncCarregarModelo() {
    getJson(API + '?modeloConta=1').then(function (res) {
      if (!res.r.ok || !res.js || !res.js.ok) return;
      NC.modelo = res.js;
      // as listas da org: repinta os selects que ainda não foram escolhidos
      ['tipo', 'rede', 'orgao'].forEach(function (k) {
        var w = document.querySelector('#nc-b [data-campo="' + k + '"]'); if (!w) return;
        var tmp = document.createElement('div'); tmp.innerHTML = ncCampo(ncCampoDef(k)); w.replaceWith(tmp.firstChild);
      });
      ncPintarRodape();
    }, function () { });
  }

  // o CNPJ nas três fontes: explicito = o "Buscar" (o Dynamics PREENCHE por
  // cima); digitando, só completa o que está vazio. A Receita (BrasilAPI)
  // vem depois do Dynamics e nunca troca o que o ERP trouxe.
  function ncBuscar(explicito) {
    var d = dig(NC.d.cnpj);
    if (!ncDocOk(d)) {
      if (explicito) { NC.erros.cnpj = ncMotivo('cnpj', NC.d.cnpj) || 'Campo obrigatório'; ncPintarErro('cnpj'); }
      NC.prev = null; NC.prevDoc = ''; ncPintarStatus(); ncPintarRodape(); return;
    }
    if (!explicito && NC.prevDoc === d && NC.prev && NC.prev.estado !== 'erro') return;
    var seq = ++NC.prevSeq;
    NC.prevDoc = d; NC.prev = { estado: 'buscando' }; ncPintarStatus(); ncPintarRodape();
    getJson(API + '?conta=' + encodeURIComponent(d)).then(function (res) {
      if (seq !== NC.prevSeq) return;
      if (!res.r.ok || !res.js || !res.js.ok) { NC.prev = { estado: 'erro', msg: msgErro(res.r, res.js) }; ncPintarStatus(); ncPintarRodape(); return; }
      var p = res.js;
      NC.prev = { estado: 'ok', v: p, sobre: !!explicito };
      var temConta = p.sf && p.sf.ok && p.sf.contas && p.sf.contas.length;
      if (!temConta) {
        var dyP = p.d365 && p.d365.ok && p.d365.preencher, rf = p.receita;
        if (dyP) NC.prev.preencheu = ncPreencher(dyP, !!explicito, 'd365');
        if (rf && rf.ok && rf.achou && rf.preencher) {
          // o ERP manda: o que o Dynamics tem não é trocado pela Receita
          var doErp = dyP ? Object.keys(dyP).filter(function (k) { return dyP[k]; }) : [];
          NC.prev.preencheuRf = ncPreencher(rf.preencher, !!explicito, 'rf', doErp);
          NC.prev.tipoRf = !!(rf.preencher.tipo && NC.dyn.tipo === 'rf');
        }
        var wo = document.querySelector('#nc-b [data-campo="orgao"]'); if (wo) wo.hidden = NC.d.tipo !== 'Órgão Público';
      }
      ncPintarStatus(); ncPintarRodape();
    }, function () { if (seq === NC.prevSeq) { NC.prev = { estado: 'erro', msg: 'Não consegui falar com o portal.' }; ncPintarStatus(); ncPintarRodape(); } });
  }
  // fonte: 'd365' | 'rf' (Receita) | 'cep' — a marca do campo; proteger:
  // campos que essa fonte não pode trocar
  function ncPreencher(p, sobre, fonte, proteger) {
    var n = 0;
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (!v || (proteger && proteger.indexOf(k) >= 0) || (!sobre && NC.d[k]) || NC.d[k] === v) return;
      NC.d[k] = v; NC.dyn[k] = fonte || 'd365'; n++;
      var inp = $('nc-' + k), w = inp && inp.closest('.nc-campo');
      if (inp) {
        if (inp.tagName === 'SELECT' && !Array.prototype.some.call(inp.options, function (o) { return o.value === v; })) { var op = document.createElement('option'); op.textContent = v; inp.appendChild(op); }
        inp.value = v;
      }
      if (w) { w.classList.remove('dyn', 'rf', 'cep'); w.classList.add(ncClasseFonte(NC.dyn[k])); }
      // CEP que veio do Dynamics/Receita já tem endereço: redigitar o mesmo não busca de novo
      if (k === 'cep' && fonte !== 'cep') NC.cepDoc = dig(v);
      if (NC.erros[k]) { delete NC.erros[k]; ncPintarErro(k); }
    });
    ncPintarUnid();
    return n;
  }
  function ncJaExiste() { var v = NC.prev && NC.prev.v; return !!(v && v.sf && v.sf.ok && v.sf.contas && v.sf.contas.length); }

  function ncPintarStatus() {
    var el = $('nc-st'); if (!el) return;
    var p = NC.prev, v = p && p.v, h;
    if (!p) h = '<div class="nc-box">Digite o CNPJ: confiro se ele já tem conta no CRM e trago o cadastro do Dynamics e da Receita Federal.</div>';
    else if (p.estado === 'buscando') h = '<div class="nc-box"><span class="cc-spin"></span>Procurando o CNPJ no CRM, no Dynamics e na Receita…</div>';
    else if (p.estado === 'erro') h = '<div class="nc-box aviso"><b>Não consegui conferir o CNPJ agora</b>' + esc(p.msg || '') + ' — ao criar, o portal confere de novo.<button type="button" class="nc-link" id="nc-de-novo">Tentar de novo</button></div>';
    else if (!v.valido) h = '<div class="nc-box erro">CNPJ inválido — confira os números.</div>';
    else if (ncJaExiste()) {
      h = '<div class="nc-box erro"><b>Este ' + (v.doc.length === 11 ? 'CPF' : 'CNPJ') + ' já tem conta no CRM</b>' +
        v.sf.contas.map(function (c) {
          return '<div class="nc-conta"><span>' + esc(c.nome) + '<small>' + esc([c.dono ? 'dono: ' + c.dono : '', [c.cidade, c.uf].filter(Boolean).join(' · ')].filter(Boolean).join(' · ')) + '</small></span>' +
            '<span class="bts"><button type="button" class="cc-btn" data-ficha-nc="' + esc(v.doc) + '">Ver a ficha</button>' +
            (c.link ? '<a class="cc-btn" href="' + esc(c.link) + '" target="_blank" rel="noopener">Abrir no CRM ↗</a>' : '') + '</span></div>';
        }).join('') + '<small>Não dá para criar outra — use a conta que já existe.</small></div>';
    } else {
      var dy = v.d365 || {}, rf = v.receita || null, partes = [];
      var rfAchou = !!(rf && rf.ok && rf.achou), resto = rfAchou ? '.' : ' — preencha os dados abaixo.';
      if (v.sf && v.sf.ok === false) partes.push('<div class="nc-box aviso"><b>Não consegui conferir no CRM</b>' + esc(v.sf.erro || '') + ' — ao criar, o portal confere de novo.</div>');
      if (dy.ok && dy.achou) {
        partes.push('<div class="nc-box ok"><b>Sem conta no CRM · cliente no Dynamics (' + esc((dy.codigos || []).join(', ')) + (dy.empresas && dy.empresas.length ? ' · ' + esc(dy.empresas.join(', ')) : '') + ')</b>' +
          (p.preencheu ? (p.sobre ? 'Preenchi ' : 'Completei ') + p.preencheu + ' campo(s) com o cadastro do Dynamics (marcados "Dynamics") — confira' + (NC.d.tipo ? '.' : ' e escolha o tipo de cliente.') : 'O formulário já tem os dados do cadastro.') + '</div>');
      } else if (dy.ok) partes.push('<div class="nc-box novo"><b>CNPJ novo</b>Sem conta no CRM e sem cadastro no Dynamics' + resto + '</div>');
      else partes.push('<div class="nc-box novo"><b>Sem conta no CRM</b>O Dynamics não respondeu (' + esc(dy.erro || 'fora') + ')' + resto + '</div>');
      partes.push(ncHtmlReceita(rf, p, !!(dy.ok && dy.achou)));
      h = partes.join('');
    }
    el.innerHTML = h;
  }
  // o quadro da Receita Federal (BrasilAPI): situação cadastral, natureza e
  // o que preencheu. Sem nada quando é CPF ou a consulta está desligada; o
  // "não achou"/"fora" só aparece se o Dynamics também não tinha o cadastro.
  function ncHtmlReceita(rf, p, noErp) {
    if (!rf || rf.desligada) return '';
    if (!rf.ok) return noErp ? '' : '<div class="nc-box aviso"><b>Não consegui consultar a Receita agora</b>' + esc(rf.erro || '') + ' — preencha à mão ou clique em Buscar de novo.</div>';
    if (!rf.achou) return noErp ? '' : '<div class="nc-box"><b>A Receita ainda não tem este CNPJ</b>A base aberta da Receita é atualizada uma vez por mês: empresa aberta há pouco tempo pode não aparecer. Preencha à mão.</div>';
    var h = '';
    if (!rf.ativa) {
      h += '<div class="nc-box erro"><b>Na Receita este CNPJ está ' + esc(rf.situacao || 'irregular') + (rf.dataSituacao ? ' desde ' + fData(rf.dataSituacao) : '') + '</b>' +
        (rf.motivoSituacao ? 'Motivo: ' + esc(rf.motivoSituacao.toLowerCase()) + '. ' : '') + 'Confira com o cliente antes de criar a conta.</div>';
    }
    var info = [rf.natureza, rf.atividade, rf.matriz === true ? 'matriz' : rf.matriz === false ? 'filial' : ''].filter(Boolean).map(esc).join(' · ');
    var n = p.preencheuRf || 0, dicas = [];
    if (p.tipoRf) dicas.push('o tipo veio como Órgão Público' + (rf.esfera ? ' ' + esc(rf.esfera.toLowerCase()) : '') + ' pela natureza jurídica');
    else if (!NC.d.tipo) dicas.push('escolha o tipo de cliente');
    if (!NC.d.ie) dicas.push('a inscrição estadual não vem da Receita');
    var marcados = Object.keys(NC.dyn).filter(function (k) { return NC.dyn[k] === 'rf'; }).length;
    var corpo = n ? (p.sobre ? 'Preenchi ' : 'Completei ') + n + ' campo(s) com o cadastro da Receita (marcados "Receita") — confira.'
      : marcados ? 'Os campos marcados "Receita" vêm do cadastro dela — confira.'
      : noErp ? 'O cadastro do Dynamics vale; a Receita só confirma o CNPJ.' : 'O formulário já tem os dados da Receita.';
    return h + '<div class="nc-box rf"><b>Receita Federal · ' + esc(rf.situacao || 'cadastro') + '</b>' + (info ? '<small>' + info + '</small>' : '') + corpo +
      (dicas.length ? ' <span class="nc-rf-dica">' + dicas.join('; ').replace(/^./, function (c) { return c.toUpperCase(); }) + '.</span>' : '') + '</div>';
  }
  function ncPintarErro(k) {
    var w = document.querySelector('#nc-b [data-campo="' + k + '"]'); if (!w) return;
    var e = NC.erros[k] || '';
    w.classList.toggle('inval', !!e);
    var s = w.querySelector('.nc-err'); if (s) s.textContent = e;
  }
  function ncPintarErros() { ['cnpj'].concat(NC_CAMPOS.filter(function (c) { return c.k; }).map(function (c) { return c.k; })).forEach(ncPintarErro); }
  function ncPintarUnid() {
    var el = $('nc-unid'); if (!el) return;
    var uf = String(NC.d.uf || '').toUpperCase(), ufc = ncUfDoCep(NC.d.cep), h = [], st = NC.cepSt;
    if (st && st.estado === 'buscando') h.push('<span class="cc-spin"></span>Buscando o endereço do CEP…');
    else if (st && st.estado === 'ok' && st.n) h.push('<span class="nc-cep-ok">Endereço pelo CEP' + (NC.dyn.rua === 'cep' ? ' — complete a rua com o número' : st.semRua ? ' (CEP geral da cidade: rua e bairro à mão)' : '') + '</span>');
    if (st && st.estado === 'ok' && st.ruaDif) h.push('<span class="av">Este CEP é da ' + esc(st.ruaDif) + ' — confira a rua.</span>');
    else if (st && st.estado === 'semcep') h.push('<span class="av">CEP não encontrado — preencha o endereço à mão.</span>');
    else if (st && st.estado === 'erro') h.push('<span class="av">Não consegui buscar o CEP' + (st.msg ? ' (' + esc(st.msg) + ')' : '') + ' — preencha à mão.</span>');
    if (NC_UFS.indexOf(uf) >= 0) h.push('Unidade de negócio no CRM: <b>' + esc(NC_UNID[uf] || 'Bio NE') + '</b> (o CRM calcula pela UF)');
    if (ufc && uf && ufc !== uf) h.push('<span class="av">Este CEP é de ' + esc(ufc) + ', não de ' + esc(uf) + ' — confira.</span>');
    el.innerHTML = h.join(' · ');
    el.hidden = !h.length;
  }

  // o endereço do CEP (BrasilAPI, pelo servidor) ao completar os 8 números:
  // UF e cidade vêm sempre (o CEP manda); rua e bairro só trocam o que está
  // vazio ou veio de outra fonte — o que a pessoa digitou fica
  function ncBuscarCep(d) {
    if (NC.cepDoc === d) return;
    NC.cepDoc = d;
    var seq = ++NC.cepSeq;
    NC.cepSt = { estado: 'buscando' }; ncPintarUnid();
    getJson(API + '?cep=' + encodeURIComponent(d)).then(function (res) {
      if (seq !== NC.cepSeq || dig(NC.d.cep) !== d) return;
      var js = res.js;
      if (!res.r.ok || !js || !js.ok) { NC.cepDoc = ''; NC.cepSt = { estado: 'erro', msg: msgErro(res.r, js) }; ncPintarUnid(); return; }
      if (!js.consultou) { NC.cepDoc = ''; NC.cepSt = js.desligada ? null : { estado: 'erro', msg: js.erro }; ncPintarUnid(); return; }
      if (!js.achou) { NC.cepSt = { estado: 'semcep' }; ncPintarUnid(); return; }
      var ruaAntes = NC.d.rua;
      NC.cepSt = { estado: 'ok', n: ncEnderecoDoCep(js), semRua: !js.rua };
      // a rua que a pessoa digitou ficou, mas o CEP é de outra: avisa
      if (js.rua && ruaAntes && NC.d.rua === ruaAntes && norm(ruaAntes).indexOf(norm(js.rua)) !== 0) NC.cepSt.ruaDif = js.rua;
      ncPintarUnid();
    }, function () { if (seq === NC.cepSeq) { NC.cepDoc = ''; NC.cepSt = { estado: 'erro', msg: 'sem resposta do portal' }; ncPintarUnid(); } });
  }
  function ncEnderecoDoCep(js) {
    var p = { uf: js.uf || '', cidade: js.cidade || '', bairro: js.bairro || '', rua: js.rua || '' }, prot = [];
    Object.keys(p).forEach(function (k) {
      var atual = norm(NC.d[k] || ''), nv = norm(p[k]);
      if (!nv) { prot.push(k); return; }
      if (atual && (atual === nv || (k === 'rua' && atual.indexOf(nv) === 0))) { prot.push(k); return; }   // já está certo (com o número)
      if (atual && (k === 'rua' || k === 'bairro') && !NC.dyn[k]) prot.push(k);                          // digitado à mão
    });
    var n = ncPreencher(p, true, 'cep', prot);
    if (NC.erros.cep) { delete NC.erros.cep; ncPintarErro('cep'); }
    return n;
  }
  function ncMsg(t, tipo) {
    var el = $('nc-msg'); if (!el) return;
    el.hidden = !t; el.className = 'nc-msg' + (tipo ? ' ' + tipo : ''); el.innerHTML = t || '';
  }
  function ncPintarRodape() {
    var f = $('nc-f'); if (!f || NC.fim) return;
    var msgAntes = $('nc-msg') ? { h: $('nc-msg').innerHTML, c: $('nc-msg').className, o: $('nc-msg').hidden } : null;
    var md = NC.modelo || {}, bloq = '';
    if (md.criacao === false) bloq = 'O cadastro de conta pelo portal está desligado.';
    else if (ncJaExiste()) bloq = 'Este CNPJ já tem conta no CRM.';
    else if (NC.prev && NC.prev.estado === 'buscando') bloq = 'Conferindo o CNPJ…';
    var eu = ST.eu || String((window._portalUser && window._portalUser.email) || '').toLowerCase();
    f.innerHTML = '<div class="nc-msg" id="nc-msg" hidden></div>' +
      '<div class="nc-pe"><span class="nc-dono">' + (md.teste ? '<b class="nc-teste">MODO DE TESTE</b> nada é criado no CRM · ' : '') +
        'Dono da conta: <b>' + esc(ncDono().nome) + '</b> (' + esc(ncDono().email) + ')' + (eu ? ' · cadastrado por você' : '') + '</span>' +
      '<button type="button" class="cc-btn" id="nc-cancelar">Cancelar</button>' +
      '<button type="button" class="cc-btn prim" id="nc-criar"' + (bloq || NC.enviando ? ' disabled' : '') + (bloq ? ' title="' + esc(bloq) + '"' : '') + '>' +
        (NC.enviando ? '<span class="cc-spin"></span>Criando no CRM…' : IC_MAIS + 'Criar conta no CRM') + '</button></div>';
    if (msgAntes && !msgAntes.o) { var m = $('nc-msg'); m.innerHTML = msgAntes.h; m.className = msgAntes.c; m.hidden = false; }
    else if (md.criacao === false) ncMsg('O cadastro de conta pelo portal está desligado (CARTEIRA_CONTA_CRIAR=0).', 'erro');
  }

  function ncCriar() {
    if (NC.enviando || ncJaExiste()) return;
    NC.erros = ncValidar(); ncPintarErros();
    var ks = Object.keys(NC.erros);
    if (ks.length) {
      ncMsg('<b>Confira antes de criar:</b> ' + ks.map(function (k) { return esc(ncCampoDef(k).rot) + ' — ' + esc(NC.erros[k].toLowerCase()); }).join(' · '), 'erro');
      var el = $('nc-' + ks[0]); if (el) el.focus();
      return;
    }
    var conta = { cnpj: NC.d.cnpj };
    NC_CAMPOS.forEach(function (c) { if (c.k && !(c.soOrgao && NC.d.tipo !== 'Órgão Público')) conta[c.k] = c.bool ? !!NC.d[c.k] : (NC.d[c.k] || ''); });
    NC.enviando = true; ncMsg(null); ncPintarRodape();
    postJson(API, { conta: conta }).then(function (res) {
      NC.enviando = false;
      var js = res.js || {}, st = res.r.status;
      if ((st === 201 || st === 200) && js.ok) { NC.fim = js; if (!js.teste) ncIncluirNaLista(js); ncPintarFim(); return; }
      ncPintarRodape();
      if (st === 409 && js.duplicada) {
        NC.prev = { estado: 'ok', v: { ok: true, valido: true, doc: dig(NC.d.cnpj), sf: { ok: true, contas: js.contas || [] }, d365: (NC.prev && NC.prev.v && NC.prev.v.d365) || { ok: true } } };
        ncPintarStatus(); ncPintarRodape(); ncMsg(esc(js.error || 'Este CNPJ já tem conta no CRM.'), 'erro');
        return;
      }
      if (st === 400 && js.erros) { NC.erros = js.erros; ncPintarErros(); ncMsg('<b>O portal recusou:</b> ' + Object.keys(js.erros).map(function (k) { return esc(ncCampoDef(k).rot) + ' — ' + esc(String(js.erros[k]).toLowerCase()); }).join(' · '), 'erro'); return; }
      ncMsg('<b>Nada foi criado.</b> ' + esc(msgErro(res.r, js)), 'erro');
    }, function () { NC.enviando = false; ncPintarRodape(); ncMsg('<b>Não consegui falar com o portal.</b> Confira na busca se a conta apareceu antes de tentar de novo.', 'erro'); });
  }

  // a conta nova entra na lista na hora (o servidor manda a linha montada
  // como o cruzamento montaria; sem ela, uma linha mínima)
  function ncIncluirNaLista(js) {
    if (!ST.todos.length) return;
    var c = js.cliente, o;
    if (c) {
      o = completarLinha({ k: c.k, doc: c.doc, sit: c.sit, nome: c.nome || '', fantasia: c.fantasia || '', uf: c.uf, cidade: c.cidade,
        codigos: (c.codigos || []).join(' · '), empresas: (c.empresas || []).join(' · '), grupo: c.grupo, bloq: !!c.bloq, sfId: c.sfId || '', nSf: c.nSf || 0,
        dono: c.dono, donoEmail: c.donoEmail, tipo: c.tipo, unid: c.unid, ativo: c.ativo, msb: !!c.msb, rede: c.rede, orgao: c.orgao,
        codErp: c.codErp || '', ultAtiv: c.ultAtiv || '', alertas: c.alertas || [] });
    } else {
      var velho = ST.todos.filter(function (x) { return x.doc === js.doc; })[0] || {};
      o = completarLinha(Object.assign({}, velho, { k: js.doc, doc: js.doc, sit: velho.codigos ? 'ambos' : 'sf', nome: velho.nome || js.nome, sfId: js.id, nSf: 1,
        dono: js.dono && js.dono.achou ? js.dono.nome : '', donoEmail: js.dono && js.dono.achou ? (js.dono.email || '') : '', tipo: NC.d.tipo, unid: js.unidade,
        uf: velho.uf || NC.d.uf, cidade: velho.cidade || NC.d.cidade, codErp: String(NC.d.codErp || '').toUpperCase(), ativo: true, alertas: velho.alertas || [], codigos: velho.codigos || '', empresas: velho.empresas || '' }));
    }
    var i = -1;
    ST.todos.forEach(function (x, j) { if (x.k === o.k || (o.doc && x.doc === o.doc)) i = j; });
    if (i >= 0) ST.todos[i] = o; else ST.todos.push(o);
    pintar();
  }

  function ncPintarFim() {
    var js = NC.fim, b = $('nc-b'), f = $('nc-f');
    if (js.teste) {
      b.innerHTML = '<div class="nc-fim"><div class="ic aviso">!</div><h3>Modo de teste — nada foi criado</h3><p>' + esc(js.aviso || '') + '</p>' +
        '<pre class="nc-pre">' + esc(JSON.stringify(js.conta, null, 2)) + '</pre></div>';
      f.innerHTML = '<div class="nc-pe"><span class="nc-dono"></span><button type="button" class="cc-btn" id="nc-outra">Voltar ao formulário</button><button type="button" class="cc-btn prim" id="nc-cancelar">Fechar</button></div>';
      return;
    }
    var dono = js.dono && js.dono.achou ? esc(js.dono.nome) + (js.dono.email ? ' (' + esc(js.dono.email) + ')' : '')
      : '<span class="av">usuário de integração do portal — ' + esc((js.dono && js.dono.motivo) || '') + '</span>';
    b.innerHTML = '<div class="nc-fim"><div class="ic">✓</div><h3>Conta criada no CRM</h3>' +
      '<p class="nm">' + esc(js.nome) + '</p><p class="mono">' + esc(fDoc(js.doc)) + '</p>' +
      '<dl><dt>Unidade de negócio</dt><dd>' + esc(js.unidade || '—') + ' <small>(o CRM calcula pela UF)</small></dd><dt>Dono da conta</dt><dd>' + dono + '</dd>' +
      '<dt>Na carteira</dt><dd>' + (js.cliente ? 'já aparece na lista' : 'aparece na lista na próxima leitura (a busca pelo CNPJ já acha)') + '</dd></dl>' +
      (NC.de === 'cotacao' ? '<div class="nc-aviso">Pode voltar para a aba da cotação: o comprador é conferido de novo e já aparece como conta do CRM.</div>' : '') + '</div>';
    f.innerHTML = '<div class="nc-pe"><span class="nc-dono"></span>' +
      '<button type="button" class="cc-btn" id="nc-outra">' + IC_MAIS + 'Cadastrar outra</button>' +
      '<button type="button" class="cc-btn" data-ficha-nc="' + esc(js.doc) + '">Ver a ficha</button>' +
      '<button type="button" class="cc-btn" data-erp-nc="' + esc(js.doc) + '">' + IC_ERP + 'Pedir cadastro no ERP</button>' +
      (js.link ? '<a class="cc-btn prim" href="' + esc(js.link) + '" target="_blank" rel="noopener">Abrir no CRM ↗</a>' : '') + '</div>';
  }

  function ncLigar() {
    var m = $('cc-nova');
    m.addEventListener('input', function (e) {
      var t = e.target, k = t.getAttribute && t.getAttribute('data-nc'); if (!k) return;
      var c = ncCampoDef(k);
      if (c.bool) { NC.d[k] = t.checked; return; }
      var v = t.value;
      if (k === 'cnpj') { var f = ncCnpjMasc(v); if (f !== v) t.value = v = f; }
      else if (c.mask === 'cep') { var f2 = ncCepMasc(v); if (f2 !== v) t.value = v = f2; }
      else if (c.mask === 'fone') { var f3 = ncFoneMasc(v); if (f3 !== v) t.value = v = f3; }
      NC.d[k] = v;
      if (NC.dyn[k]) { NC.dyn[k] = false; var w = t.closest('.nc-campo'); if (w) w.classList.remove('dyn', 'rf', 'cep'); }
      if (NC.erros[k] && !ncMotivo(k, v)) { delete NC.erros[k]; ncPintarErro(k); }
      if (k === 'cnpj') {
        if (NC.prevDoc && dig(v) !== NC.prevDoc) { NC.prev = null; NC.prevDoc = ''; NC.prevSeq++; ncPintarStatus(); ncPintarRodape(); }
        if (ncDocOk(dig(v))) ncBuscar(false);
      }
      if (k === 'cep') {
        var u = ncUfDoCep(v), dc = dig(v);
        if (u && !NC.d.uf) { NC.d.uf = u; var su = $('nc-uf'); if (su) su.value = u; if (NC.erros.uf) { delete NC.erros.uf; ncPintarErro('uf'); } }
        if (dc.length === 8 && !/^0+$/.test(dc)) ncBuscarCep(dc);
        else {
          // CEP mexido: a busca em andamento não vale mais
          if (NC.cepSt && NC.cepSt.estado === 'buscando') NC.cepDoc = '';
          NC.cepSeq++; NC.cepSt = null;
        }
        ncPintarUnid();
      }
      if (k === 'uf') ncPintarUnid();
      if (k === 'tipo') {
        var wo = document.querySelector('#nc-b [data-campo="orgao"]'); if (wo) wo.hidden = v !== 'Órgão Público';
        if (NC.erros.tipo && !ncMotivo('tipo', v)) { delete NC.erros.tipo; ncPintarErro('tipo'); }
      }
    });
    m.addEventListener('change', function (e) {
      var t = e.target, k = t.getAttribute && t.getAttribute('data-nc'); if (!k) return;
      if (t.type === 'checkbox') { NC.d[k] = t.checked; return; }
      if (k === 'email') { t.value = NC.d.email = t.value.replace(/\s+/g, '').toLowerCase(); }
      if (k === 'codErp' || k === 'ie') { t.value = NC.d[k] = t.value.toUpperCase().replace(/\s+/g, k === 'codErp' ? '' : ' ').trim(); }
      if (k === 'tipo' || k === 'uf' || k === 'orgao' || k === 'rede') t.dispatchEvent(new Event('input', { bubbles: true }));
      var mo = ncMotivo(k, t.value);
      if (mo && t.value) { NC.erros[k] = mo; ncPintarErro(k); }
    });
    m.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.id === 'nc-cnpj') { e.preventDefault(); ncBuscar(true); }
    });
    m.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('button, a') : null;
      if (e.target === m && !NC.enviando) { ncFechar(); return; }     // clique fora do cartão
      if (!t) return;
      if (t.id === 'nc-fechar' || t.id === 'nc-cancelar') { ncFechar(); return; }
      if (t.id === 'nc-buscar' || t.id === 'nc-de-novo') { ncBuscar(true); return; }
      if (t.id === 'nc-criar') { ncCriar(); return; }
      if (t.id === 'nc-outra') { var era = NC.fim && NC.fim.teste ? Object.assign({}, NC.d) : null; ncAbrir({ de: NC.de }); if (era) { NC.d = era; $('nc-b').innerHTML = ncHtmlForm(); ncPintarStatus(); ncPintarUnid(); ncBuscar(false); } return; }
      if (t.hasAttribute('data-erp-nc')) { var de = t.getAttribute('data-erp-nc'); NC.enviando = false; ncFechar(); var ce = ST.todos.filter(function (x) { return x.doc === de; })[0]; ST.erpPendente = true; abrirFicha(ce ? ce.k : de); ST.erpPendente = true; return; }
      if (t.hasAttribute('data-ficha-nc')) { var dd = t.getAttribute('data-ficha-nc'); NC.enviando = false; ncFechar(); var cc = ST.todos.filter(function (x) { return x.doc === dd; })[0]; abrirFicha(cc ? cc.k : dd); return; }
    });
  }

  async function postJson(url, corpo) {
    await esperaAuth();
    var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(corpo) });
    var js = null;
    try { js = JSON.parse(await r.text()); } catch (e) { js = null; }
    return { r: r, js: js };
  }

  // ══════════════════════════════════════════════════════════════
  // EVENTOS
  // ══════════════════════════════════════════════════════════════
  var _qT = null;
  function ligar() {
    var inp = $('cc-q');
    inp.addEventListener('input', function () {
      $('cc-busca').classList.toggle('tem', !!inp.value);
      clearTimeout(_qT);
      _qT = setTimeout(function () { definirBusca(inp.value); ST.pag = 0; pintar(); }, 160);
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      clearTimeout(_qT); if (inp.value.trim() !== ST.q) definirBusca(inp.value); ST.pag = 0; pintar();
      var d = dig(inp.value);
      // CNPJ/CPF completo: abre a ficha direto (funciona com a carteira carregando)
      if ((d.length === 14 || d.length === 11) && inp.value.replace(/[\s.\-/]/g, '').length === d.length) {
        var c = ST.todos.filter(function (x) { return x.doc === d; })[0];
        abrirFicha(c ? c.k : d);
      } else if (ST.filtrados.length === 1) abrirFicha(ST.filtrados[0].k);
    });
    $('cc-limpa').addEventListener('click', function () { inp.value = ''; $('cc-busca').classList.remove('tem'); definirBusca(''); ST.pag = 0; pintar(); inp.focus(); });
    $('cc-minha-in').addEventListener('change', function (e) { ST.minha = e.target.checked; ST.pag = 0; pintar(); });
    $('cc-atualizar').addEventListener('click', function () { $('cc-atualizar').disabled = true; carregar(true); toast('Pedindo a releitura das duas fontes…'); });

    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target : null; if (!t) return;
      if (ESCOPO && !t.closest(ESCOPO)) return;   // clique de outra tela da página (Minha carteira)
      var x;
      if ((x = t.closest('[data-kpi]'))) {
        var id = x.getAttribute('data-kpi');
        if (id === 'total') { ST.sit = null; ST.pend = false; }
        else if (id === 'pend') { ST.pend = !ST.pend; }
        else ST.sit = ST.sit === id ? null : id;
        ST.pag = 0; pintar(); return;
      }
      if ((x = t.closest('[data-dim]'))) { ST.dim = x.getAttribute('data-dim'); pintarGrupos(); return; }
      if ((x = t.closest('.cc-g[data-g]'))) {
        var s = ST.sel[ST.dim], v = x.getAttribute('data-g');
        if (s.has(v)) s.delete(v); else s.add(v);
        ST.pag = 0; pintar(); return;
      }
      if ((x = t.closest('[data-tira]'))) {
        var k = x.getAttribute('data-tira');
        if (k === 'q') { definirBusca(''); $('cc-q').value = ''; $('cc-busca').classList.remove('tem'); }
        else if (k === 'sit') ST.sit = null;
        else if (k === 'pend') ST.pend = false;
        else if (k === 'minha') { ST.minha = false; $('cc-minha-in').checked = false; }
        else { var p = x.getAttribute('data-v').split('|'); ST.sel[p[0]].delete(p.slice(1).join('|')); }
        ST.pag = 0; pintar(); return;
      }
      if (t.closest('#cc-limpar')) { limparTudo(); return; }
      if ((x = t.closest('th[data-ord]'))) {
        var c = x.getAttribute('data-ord');
        ST.ord = { c: c, d: ST.ord.c === c ? -ST.ord.d : 1 }; pintarLista(); return;
      }
      if ((x = t.closest('[data-pag]'))) { ST.pag = Math.max(0, Number(x.getAttribute('data-pag')) || 0); pintarLista(); $('cc-lista').scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
      if ((x = t.closest('[data-nova]'))) { ncAbrir({ doc: x.getAttribute('data-nova'), preencher: true }); return; }
      if (t.closest('#cc-nova-btn')) { ncAbrir({}); return; }
      if ((x = t.closest('[data-ficha]'))) { abrirFicha(x.getAttribute('data-ficha')); return; }
      if (t.closest('[data-erp-abrir]')) { erpAbrir(); return; }
      if ((x = t.closest('#cc-body tr[data-k]')) || (x = t.closest('.cc-fl[data-k]'))) { abrirFicha(x.getAttribute('data-k')); return; }
      if (t.closest('#cc-fechar') || t.closest('#cc-ov')) { fecharFicha(); return; }
      if ((x = t.closest('[data-arq]'))) { e.preventDefault(); abrirArquivo(x.getAttribute('data-arq'), x.textContent); return; }
      if ((x = t.closest('[data-copiar]'))) { copiar(x.getAttribute('data-copiar'), 'CNPJ copiado'); return; }
      if (t.closest('[data-link]')) { copiar(location.href, 'Link copiado'); return; }
    });
    document.addEventListener('keydown', function (e) {
      if (ncAberto()) { if (e.key === 'Escape') ncFechar(); return; }   // o modal da nova conta vem primeiro
      if (e.key === 'Escape' && ST.fichaK && ST.ct) { ctFechar(); return; }   // o formulário de contato fecha antes da ficha
      if (e.key === 'Escape' && ST.fichaK && ST.erp) { erpFechar(); return; }
      if (e.key === 'Escape' && ST.fichaK && ST.ds) { dsFechar(); return; }
    if (e.key === 'Escape' && ST.fichaK) { fecharFicha(); return; }
      if (e.key === 'Enter' && e.target && e.target.matches && e.target.matches('#cc-body tr[data-k]')) abrirFicha(e.target.getAttribute('data-k'));
      // "/" leva para a busca (fora de campos de texto)
      if (e.key === '/' && !/input|textarea|select/i.test((e.target && e.target.tagName) || '') && $('cc-q').offsetParent) { e.preventDefault(); $('cc-q').focus(); }
    });
  }

  function iniciar() {
    // a linha da lista já abre a ficha daqui (com a visão 360 dentro): sem o botão "Ficha" do portal-elo.js
    try { document.querySelector('.cc-tb').setAttribute('data-elo-off', ''); } catch (e) { }
    ligar();
    if (!ESPELHO) ncLigar();     // o espelho não tem o modal da nova conta
    ligarFicha();
    var qs = new URLSearchParams(location.search);
    if (qs.get('q')) { $('cc-q').value = qs.get('q'); definirBusca(qs.get('q')); $('cc-busca').classList.add('tem'); }
    if (qs.get('cliente')) abrirFicha(qs.get('cliente'));
    else if (qs.get('nome')) ST.nomePedido = qs.get('nome');
    // ?novaConta=<cnpj>[&de=cotacao] — o Agente de Cotações manda o comprador sem conta para cá
    if (!ESPELHO && qs.get('novaConta')) {
      var nd = dig(qs.get('novaConta'));
      ncAbrir({ doc: nd.length >= 11 ? nd : '', de: qs.get('de') === 'cotacao' ? 'cotacao' : '', preencher: true });
    }
    carregar(false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
