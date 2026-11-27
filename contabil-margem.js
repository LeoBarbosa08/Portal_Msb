/* ================================================================
   contabil-margem.js — Módulo Contábil · Margem de Contribuição
   Engine ÚNICA dos 3 submódulos (mesmo desenho do produtos-estrategia.js:
   HTML fino + motor compartilhado). A página escolhe a visão em
   `window.MG_VIEW` ANTES de carregar este arquivo:

     'geral'     → Visão Geral   (réplica do dashboard: hero, KPIs, evolução,
                                  cascata, tributos, filiais e matriz)
     'analitico' → Analítico     (matriz/tabular com todas as dimensões e
                                  todas as medidas + Excel)
     'nf'        → Analítico por NF (o mesmo, com 'Número da fatura' fixado
                                  como 1ª dimensão)

   ── MODELO (Power BI) ─────────────────────────────────────────────
   Mesmo dataset do Comercial (Sales Report / Novos Negócios): o relatório
   10a505aa-… resolve o datasetId. Campos e medidas vêm da lista passada
   pelo negócio:

     dimensões  'DIM_UNIDADE_DE_NEGOCIO_V2'[UNIDADE_DE_NEGOCIO]
                'Clientes'[Tipo de cliente] · 'Produtos'[Produto]
                'Famílias'[Família] · 'Famílias'[Estratégia] · 'Linhas'[Linha]
                'Calendário'[Ano] · 'Calendário'[Mês (nome abreviado)]
     colunas    SOMA de 'Faturamentos'[Faturamento]      (= receita bruta)
                SOMA de 'Faturamentos'[Receita líquida]
                SOMA de 'Faturamentos'[Margem item]      (= margem em R$)
     medidas    [Margem de contribuição (%)]   → vem em FRAÇÃO (×100)
                [Margem de contribuição (nota)]          (índice 0–10)
                [Margem - Custo produto] · [Impostos]
                [Margem - Desconto] · [Margem - Frete]
                [Margem - Imp. PIS/COFINS/IPI/ICMS/ICMSST/DIFAL]

   ── GRAFIA DOS NOMES ──────────────────────────────────────────────
   Nome errado em DAX não dá "medida não existe": dá erro de COLUNA e
   derruba a query inteira. Por isso a grafia real sai do CATÁLOGO do
   modelo (INFO.VIEW.COLUMNS / INFO.VIEW.MEASURES), com o literal como
   último recurso — igual às páginas irmãs do portal.

   ── FILTROS-BASE ──────────────────────────────────────────────────
   Ver MG_BASE, logo abaixo: por ser relatório CONTÁBIL, nada é escondido
   por padrão além do filtro de operação que gera fatura. Os dois outros
   filtros que o Sales Report aplica ficam disponíveis, mas DESLIGADOS.

   ── RECORTE MSB (27/11/2026) ──────────────────────────────────────
   Veio do portal completo (LeoBarbosa08/Claude.rep, origin/master
   e6ac11c) com as cores da MSB (scripts/msb-cores.js) e a fonte Roboto.
   Empresa NÃO é escolha aqui: a barra mostra o rótulo fixo "Empresa MSB"
   (fixa no DIMS) e toda consulta leva 'Empresas'[Código da empresa] = MSB
   (dimFilters). O pbi-throttle.js recorta de novo cada EVALUATE na MSB.
   ================================================================ */
(function () {
  'use strict';

  var VIEW = window.MG_VIEW || 'geral';

  // ── meta de margem (linha de referência do dashboard) ──
  var META = window.MG_META != null ? Number(window.MG_META) : 58;   // em %
  var AMBER_BAND = 8;   // meta-8% .. meta → âmbar; abaixo → vermelho

  // ── filtros-base do módulo ────────────────────────────────────────
  // geraFatura:      só operações que geram fatura a receber (filtro do
  //                  relatório de faturamento inteiro no portal).
  // semIntercompany: OFF — a INTERCOMPANY aparece no dashboard replicado.
  // semNfOculta:     OFF de propósito. Ocultar NF é decisão do módulo
  //                  comercial (Sales Report); num relatório contábil,
  //                  sumir com uma nota fiscal falsearia o número.
  var MG_BASE = window.MG_BASE || { geraFatura: true, semIntercompany: false, semNfOculta: false };
  var NF_OCULTAS = ['667708'];

  var PBI_CFG = {
    clientId: '129978ce-ff3b-431d-98b3-66a1bcb766b1',
    tenantId: 'c311c9e6-6017-42a9-b306-4057beba5786',
    workspaceId: '8535f0a1-8dc6-4da0-93ce-bf20c1c14e27',
    reportId: '10a505aa-759e-4f20-a130-98c0736ba42d',
    scopes: ['https://analysis.windows.net/powerbi/api/Dataset.Read.All',
             'https://analysis.windows.net/powerbi/api/Report.Read.All']
  };
  var FATO = "'Faturamentos'";

  var _pbi = null, _token = null, _dsId = null, _ready = false;
  var _colCat = null, _meaCat = null, _naoConfirmados = [];

  /* ============================================================
     1. HELPERS
     ============================================================ */
  var escH = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  var avEsc = function (s) { return String(s == null ? '' : s).replace(/"/g, '&quot;'); };
  var avDax = function (s) { return String(s == null ? '' : s).replace(/"/g, '""'); };
  var _norm = function (s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); };
  var _numN = function (x) { return (x == null || x === '' || x === '-' || isNaN(Number(x))) ? null : Number(x); };
  var setTxt = function (id, t) { var el = document.getElementById(id); if (el) el.textContent = t; };
  var setHTML = function (id, h) { var el = document.getElementById(id); if (el) el.innerHTML = h; };
  var _v = function (r, re) { var k = Object.keys(r || {}).find(function (x) { return re.test(x); }); return k ? r[k] : null; };
  var abs = function (v) { return v == null ? null : Math.abs(Number(v)); };

  var fBRL0 = function (v) { return v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); };
  var fBRL2 = function (v) { return v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  function fMi(v) {
    if (v == null) return '—';
    var a = Math.abs(v);
    if (a >= 1e6) return 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Mi';
    return fBRL0(v);
  }
  var fMiF = function (v) { return v == null ? '—' : 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Mi'; };
  var fK = function (v) { return v == null ? '' : 'R$' + Math.round(v / 1000).toLocaleString('pt-BR') + 'k'; };
  var fPct = function (v) { return v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'; };
  var fNum2 = function (v) { return v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var fINT = function (v) { return v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); };
  var cls = function (pct) { return pct == null ? '' : (pct >= META ? 'mg-gr' : (pct >= META - AMBER_BAND ? 'mg-am' : 'mg-rd')); };
  var barColor = function (pct) { return pct == null ? '#CDDCE3' : (pct >= META ? '#2FBF71' : (pct >= META - AMBER_BAND ? '#E8A33D' : '#DC6B6B')); };

  function parseDW(raw) {
    if (raw == null || raw === '') return null;
    if (raw instanceof Date) return isNaN(raw) ? null : raw;
    var s = String(raw).trim(), m;
    if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) { var du = new Date(s); if (!isNaN(du)) return du; }
    m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    m = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
    var d = new Date(s); return isNaN(d) ? null : d;
  }

  /* ============================================================
     2. CONEXÃO / QUERY
     ============================================================ */
  async function pbiConnect() {
    if (window._msalAuth) { _pbi = window._msalAuth; }
    else {
      _pbi = new msal.PublicClientApplication({
        auth: { clientId: PBI_CFG.clientId, authority: 'https://login.microsoftonline.com/' + PBI_CFG.tenantId, redirectUri: window.location.origin + '/' },
        cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: true }
      });
      if (_pbi.initialize) await _pbi.initialize();
      await _pbi.handleRedirectPromise().catch(function () {});
    }
    var accounts = _pbi.getAllAccounts();
    try { var r = await _pbi.acquireTokenSilent({ scopes: PBI_CFG.scopes, account: accounts[0] }); _token = r.accessToken; }
    catch (e) { var r2 = await _pbi.loginPopup({ scopes: PBI_CFG.scopes }); _token = r2.accessToken; }
    var acc = _pbi.getAllAccounts()[0];
    if (acc && typeof window.setSidebarUser === 'function') window.setSidebarUser(acc.name || acc.username, acc.username);
  }

  async function pbiDataset() {
    if (_dsId) return _dsId;
    var r = await fetch('https://api.powerbi.com/v1.0/myorg/groups/' + PBI_CFG.workspaceId + '/reports/' + PBI_CFG.reportId, { headers: { Authorization: 'Bearer ' + _token } });
    if (r.ok) { var j = await r.json(); if (j.datasetId) { _dsId = j.datasetId; return _dsId; } }
    r = await fetch('https://api.powerbi.com/v1.0/myorg/reports/' + PBI_CFG.reportId, { headers: { Authorization: 'Bearer ' + _token } });
    if (r.ok) { var j2 = await r.json(); if (j2.datasetId) { _dsId = j2.datasetId; return _dsId; } }
    throw new Error('Não foi possível encontrar o dataset. Verifique a permissão de Build no Power BI.');
  }

  function _pbiErr(text) {
    try {
      var j = JSON.parse(text), e = j.error || {}, pe = e['pbi.error'] || {};
      var det = (pe.details || []).map(function (d) { return d.detail && d.detail.value; }).filter(Boolean).join(' | ');
      return det || e.message || pe.code || text.substring(0, 200);
    } catch (x) { return text.substring(0, 200); }
  }

  async function q(dax) {
    var dsId = await pbiDataset();
    var u1 = 'https://api.powerbi.com/v1.0/myorg/groups/' + PBI_CFG.workspaceId + '/datasets/' + dsId + '/executeQueries';
    var u2 = 'https://api.powerbi.com/v1.0/myorg/datasets/' + dsId + '/executeQueries';
    var body = JSON.stringify({ queries: [{ query: dax }], serializerSettings: { includeNulls: true } });
    var headers = { Authorization: 'Bearer ' + _token, 'Content-Type': 'application/json' };
    var r = await fetch(u1, { method: 'POST', headers: headers, body: body });
    if (r.status === 401 || r.status === 403) r = await fetch(u2, { method: 'POST', headers: headers, body: body });
    if (r.status === 401 || r.status === 403) {
      try { var a = _pbi.getAllAccounts()[0]; var t = await _pbi.acquireTokenSilent({ scopes: PBI_CFG.scopes, account: a, forceRefresh: true }); _token = t.accessToken; }
      catch (e) { try { var t2 = await _pbi.loginPopup({ scopes: PBI_CFG.scopes }); _token = t2.accessToken; } catch (e2) {} }
      var h2 = { Authorization: 'Bearer ' + _token, 'Content-Type': 'application/json' };
      r = await fetch(u1, { method: 'POST', headers: h2, body: body });
      if (r.status === 401 || r.status === 403) r = await fetch(u2, { method: 'POST', headers: h2, body: body });
    }
    var text = await r.text();
    if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + _pbiErr(text));
    var d = JSON.parse(text);
    if (d.error) throw new Error(_pbiErr(text));
    return d.results[0].tables[0].rows;
  }
  window.PBIData = { connect: pbiConnect, query: q };
  window.bmDwQuery = q;
  window.bmDwInfo = function () { return { token: _token, ws: PBI_CFG.workspaceId, ds: _dsId }; };

  /* ============================================================
     3. DIMENSÕES E MEDIDAS
     ============================================================ */
  // cands = [[tabela, coluna], …] — o catálogo resolve a grafia do modelo.
  //
  // A ORDEM desta lista é a ordem das colunas na tabela (ordemDim) — ela segue
  // a sequência que o negócio pediu para o relatório da aba "Analítico por NF".
  // Mexer na ordem aqui muda a ordem do relatório.
  var DIMS = [
    { id: 'codcliente', label: 'Cód. Cliente',       short: 'Cód. cli.',   cands: [['Clientes', 'Cód. Cliente'], ['Clientes', 'Cód. cliente'], ['Clientes', 'Código do cliente']] },
    { id: 'cliente',    label: 'Cliente',            short: 'Cliente',     cands: [['Clientes', 'Cliente'], ['Clientes', 'Nome do cliente'], ['Clientes', 'Razão social']] },
    { id: 'codclifat',  label: 'Cód. cliente (Fat.)', short: 'Cód. cli. fat.', cands: [['Faturamentos', 'Cód. cliente (Faturamento)'], ['Faturamentos', 'Cod. cliente (Faturamento)']] },
    { id: 'clifat',     label: 'Cliente (Faturamento)', short: 'Cliente fat.', cands: [['Faturamentos', 'Cliente (Faturamento)']] },
    { id: 'grupocli',   label: 'Grupo de clientes',  short: 'Grupo cli.',  cands: [['Clientes', 'Grupo de clientes']] },
    { id: 'tipocli',    label: 'Tipo de Cliente',    short: 'Tipo cli.',   cands: [['Clientes', 'Tipo de cliente'], ['Clientes', 'Tipo de cliente (Revisado)']] },
    { id: 'cnpj',       label: 'CNPJ',               short: 'CNPJ',        cands: [['Clientes', 'CNPJ']] },
    { id: 'estado',     label: 'Cód. Estado',        short: 'UF',          cands: [['Clientes', 'Cód. Estado'], ['Clientes', 'Cod. Estado']] },
    { id: 'salesvert',  label: 'Sales Vertical',     short: 'Sales vert.', cands: [['Famílias', 'Sales Vertical'], ['Familias', 'Sales Vertical']] },
    { id: 'classif',    label: 'Classificação',      short: 'Classif.',    cands: [['Operações', 'Classificação'], ['Operacoes', 'Classificacao']] },
    { id: 'linha',      label: 'Linha',              short: 'Linha',       cands: [['Linhas', 'Linha']] },
    { id: 'unidade',    label: 'Unidade de Negócio', short: 'Unidade',     cands: [['DIM_UNIDADE_DE_NEGOCIO_V2', 'UNIDADE_DE_NEGOCIO']] },
    { id: 'estrategia', label: 'Estratégia',         short: 'Estratégia',  cands: [['Famílias', 'Estratégia'], ['Familias', 'Estrategia']] },
    { id: 'familia',    label: 'Família',            short: 'Família',     cands: [['Famílias', 'Família'], ['Familias', 'Familia']] },
    { id: 'grupoitens', label: 'Grupo de itens',     short: 'Grupo itens', cands: [['Produtos', 'Grupo de itens']] },
    { id: 'vendedor',   label: 'Vendedor',           short: 'Vendedor',    cands: [['Vendedores', 'Vendedor']] },
    { id: 'idtransac',  label: 'Ident. transação estoque', short: 'Ident. transação', cands: [['Faturamentos', 'Identificador transação estoque'], ['Faturamentos', 'Identificador transacao estoque']] },
    { id: 'nf',         label: 'Número da fatura',   short: 'NF',          cands: [['Faturamentos', 'Número da fatura'], ['Faturamentos', 'Numero da fatura']] },
    { id: 'motivodev',  label: 'Motivo da devolução', short: 'Motivo dev.', cands: [['Faturamentos', 'Motivo da devolução'], ['Faturamentos', 'Motivo da devolucao']] },
    { id: 'sinief',     label: 'Texto Sinief',       short: 'Sinief',      cands: [['Faturamentos', 'Texto Sinief']] },
    { id: 'seqitem',    label: 'Número seq. item fat.', short: 'Seq. item', cands: [['Faturamentos', 'Número seq. item fat.'], ['Faturamentos', 'Numero seq. item fat.']] },
    { id: 'datafat',    label: 'Data do faturamento', short: 'Data fat.',  cands: [['Faturamentos', 'Data do faturamento (formatada)']] },
    // ── daqui para baixo: campos que não estão no relatório por NF, mas seguem
    //    disponíveis em Campos e na barra de filtros das 3 abas ──
    // Empresa é a MESMA do Comercial: 'Empresas'[Código da empresa], valores BIO / MSB
    // (é a coluna de segmento do Sales Report, no mesmo dataset)
    // RECORTE MSB: fixa = 'MSB' — sem lista na barra, e a MSB vai em toda consulta.
    { id: 'empresa',    label: 'Empresa',            short: 'Empresa',     fixa: 'MSB', cands: [['Empresas', 'Código da empresa'], ['Empresas', 'Empresa'], ['Empresas', 'Codigo da empresa']] },
    { id: 'produto',    label: 'Produto',            short: 'Produto',     cands: [['Produtos', 'Produto']] },
    { id: 'codproduto', label: 'Cód. do produto',    short: 'Cód. prod.',  cands: [['Produtos', 'Cód. produto'], ['Produtos', 'Cód. do produto'], ['Produtos', 'Código do produto']] },
    { id: 'ano',        label: 'Ano',                short: 'Ano',         cands: [['Calendário', 'Ano'], ['Calendario', 'Ano']] },
    { id: 'mes',        label: 'Mês',                short: 'Mês',         cands: [['Calendário', 'Mês (nome abreviado)'], ['Calendario', 'Mes (nome abreviado)']] }
  ];
  var dimById = function (id) { return DIMS.filter(function (d) { return d.id === id; })[0]; };

  // Medidas do dashboard. kind: 'col' = SOMA de coluna · 'mea' = medida do modelo
  //   fmt: mi | brl | pct | nota | int
  //   ded: true → é dedução (mostra em módulo, cor âmbar)
  //
  // ── TRANSIÇÃO DE CONTEXTO (bug queimado em 21/08/26) ──
  // Toda expressão de COLUNA (SUM/COUNTROWS) entra embrulhada em CALCULATE.
  // Sem isso, dentro de ADDCOLUMNS(SUMMARIZE(...)) a soma NÃO enxerga a linha
  // do grupo — ela devolve o TOTAL GERAL em todas as linhas (a matriz mostrava
  // a mesma "R$ 62,45 Mi" em cada unidade). MEDIDA do modelo não sofre disso:
  // medida já traz CALCULATE implícito — foi por isso que Impostos/Frete/Custo
  // variavam e só Receita bruta e Margem R$ repetiam.
  var MEAS = [
    // receita bruta = MEDIDA [Faturamento] do modelo (confirmada pelo negócio)
    { id: 'rb',     key: 'rb', label: 'Receita bruta',    kind: 'mea', fmt: 'mi',   cands: ['Faturamento'] },
    { id: 'rl',     key: 'rl', label: 'Receita líquida',  kind: 'col', fmt: 'mi',   cands: [['Faturamentos', 'Receita líquida'], ['Faturamentos', 'Receita liquida']] },
    { id: 'imp',    key: 'im', label: 'Impostos',         kind: 'mea', fmt: 'mi',   ded: true,  cands: ['Impostos'] },
    { id: 'frete',  key: 'fr', label: 'Frete',            kind: 'mea', fmt: 'brl',  ded: true,  cands: ['Margem - Frete'] },
    { id: 'desc',   key: 'ds', label: 'Descontos',        kind: 'mea', fmt: 'brl',  ded: true,  cands: ['Margem - Desconto'] },
    { id: 'custo',  key: 'cp', label: 'Custo produto',    kind: 'mea', fmt: 'mi',   ded: true,  cands: ['Margem - Custo produto'] },
    { id: 'margem', key: 'mg', label: 'Margem R$',        kind: 'col', fmt: 'mi',   cands: [['Faturamentos', 'Margem item']] },
    { id: 'pct',    key: 'mp', label: '% Margem',         kind: 'mea', fmt: 'pct',  x100: true, cands: ['Margem de contribuição (%)', 'Margem de contribuicao (%)'] },
    { id: 'nota',   key: 'nt', label: 'Nota',             kind: 'mea', fmt: 'nota', cands: ['Margem de contribuição (nota)', 'Margem de contribuicao (nota)'] },
    { id: 'itens',  key: 'it', label: 'Itens faturados',  kind: 'raw', fmt: 'int',  expr: 'COUNTROWS(' + FATO + ')' },
    // detalhamento de impostos (fora do conjunto padrão da matriz)
    { id: 'pis',    key: 'pis', label: 'PIS',     kind: 'mea', fmt: 'brl', ded: true, trib: 'PIS',     cands: ['Margem - Imp. PIS'] },
    { id: 'cofins', key: 'cof', label: 'COFINS',  kind: 'mea', fmt: 'brl', ded: true, trib: 'COFINS',  cands: ['Margem - Imp. COFINS'] },
    { id: 'ipi',    key: 'ipi', label: 'IPI',     kind: 'mea', fmt: 'brl', ded: true, trib: 'IPI',     cands: ['Margem - Imp. IPI'] },
    { id: 'icms',   key: 'ic',  label: 'ICMS',    kind: 'mea', fmt: 'brl', ded: true, trib: 'ICMS',    cands: ['Margem - Imp. ICMS'] },
    { id: 'icmsst', key: 'ist', label: 'ICMS-ST', kind: 'mea', fmt: 'brl', ded: true, trib: 'ICMS-ST', cands: ['Margem - Imp. ICMSST'] },
    { id: 'difal',  key: 'dif', label: 'DIFAL',   kind: 'mea', fmt: 'brl', ded: true, trib: 'DIFAL',   cands: ['Margem - Imp. DIFAL'] },
    // ── reforma tributária: CBS / IBS / IBS-M são COLUNAS somadas (não medidas) ──
    { id: 'cbs',    key: 'cbs', label: 'CBS',     kind: 'col', fmt: 'brl', ded: true, trib: 'CBS',     cands: [['Faturamentos', 'TAX_CBS']] },
    { id: 'ibs',    key: 'ibs', label: 'IBS',     kind: 'col', fmt: 'brl', ded: true, trib: 'IBS',     cands: [['Faturamentos', 'TAX_IBS']] },
    { id: 'ibsm',   key: 'ibm', label: 'IBS-M',   kind: 'col', fmt: 'brl', ded: true, trib: 'IBS-M',   cands: [['Faturamentos', 'TAX_IBSM']] },
    // ── colunas do relatório por NF ──
    { id: 'preco',  key: 'pu',  label: 'Preço unitário', kind: 'col', fmt: 'brl2', cands: [['Faturamentos', 'Preço unitário'], ['Faturamentos', 'Preco unitario']] },
    { id: 'qtd',    key: 'qt',  label: 'Quantidade',     kind: 'col', fmt: 'int',  cands: [['Faturamentos', 'Quantidade']] },
    { id: 'basecalc', key: 'bc', label: 'Base de cálculo', kind: 'col', fmt: 'mi', cands: [['Faturamentos', 'Margem - Base de cálculo'], ['Faturamentos', 'Margem - Base de calculo']] },
    // medida própria de % do modelo (≠ [Margem de contribuição (%)]); a escala
    // (fração ou já em %) é calibrada em tempo de execução — ver calibrarPctm()
    { id: 'pctm',   key: 'pm2', label: 'Margem Percentual', kind: 'mea', fmt: 'pct', cands: ['Margem Percentual'] },
    // códigos da reforma: TEXTO. agg 'txt' → CALCULATE(MAX(col)), que no grão do
    // item devolve o próprio valor (SUM em texto derrubaria a query inteira)
    { id: 'codcbs',  key: 'ccb', label: 'CÓDIGO_CBS',  kind: 'col', agg: 'txt', fmt: 'txt', cands: [['Faturamentos', 'CODIGO_CBS']] },
    { id: 'codibs',  key: 'cib', label: 'CÓDIGO_IBS',  kind: 'col', agg: 'txt', fmt: 'txt', cands: [['Faturamentos', 'CODIGO_IBS']] },
    { id: 'codibsm', key: 'cim', label: 'CÓDIGO_IBSM', kind: 'col', agg: 'txt', fmt: 'txt', cands: [['Faturamentos', 'CODIGO_IBSM']] }
  ];
  var meaById = function (id) { return MEAS.filter(function (m) { return m.id === id; })[0]; };
  var TRIBUTOS = ['cofins', 'difal', 'ipi', 'pis', 'icms', 'icmsst', 'cbs', 'ibs', 'ibsm'];
  var TRIB_COLOR = { cofins: '#287A8E', difal: '#4695AA', ipi: '#6FACBD', pis: '#97C3CF', icms: '#C2D9E1', icmsst: '#DCE8EE',
                     cbs: '#7A4BC4', ibs: '#A98BE0', ibsm: '#CFC0EE' };

  // conjunto padrão de medidas da matriz (a mesma ordem do dashboard)
  var MEAS_DEFAULT = ['rb', 'imp', 'frete', 'desc', 'custo', 'margem', 'pct', 'nota'];
  var MEAS_ANALITICO = ['rb', 'rl', 'imp', 'frete', 'desc', 'custo', 'margem', 'pct', 'nota'];
  // Relatório da aba "Analítico por NF": a ordem EXATA pedida pelo negócio.
  // A aba abre com TODOS estes campos e medidas (o que o catálogo do modelo não
  // confirmar sai da abertura e vai avisado no banner — ver defaultsNF()).
  var NF_DIMS = ['codcliente', 'cliente', 'codclifat', 'clifat', 'grupocli', 'tipocli', 'cnpj', 'estado',
                 'salesvert', 'classif', 'linha', 'unidade', 'estrategia', 'familia', 'grupoitens', 'vendedor',
                 'idtransac', 'nf', 'motivodev', 'sinief', 'seqitem', 'datafat'];
  var NF_MEAS = ['preco', 'qtd', 'rb', 'basecalc', 'custo', 'pis', 'cofins', 'ipi', 'icms', 'icmsst', 'difal',
                 'desc', 'frete', 'rl', 'margem', 'pctm', 'cbs', 'ibs', 'ibsm', 'codcbs', 'codibs', 'codibsm'];

  function fmtMea(m, v) {
    if (v == null || v === '') return '—';
    // texto vem do modelo: escapa, porque isto entra em innerHTML
    if (m.fmt === 'txt') return escH(String(v));
    if (m.fmt === 'pct') return fPct(v);
    if (m.fmt === 'nota') return fNum2(v);
    if (m.fmt === 'int') return fINT(v);
    if (m.fmt === 'brl2') return fBRL2(m.ded ? abs(v) : v);
    if (m.fmt === 'brl') return fBRL0(m.ded ? abs(v) : v);
    return fMi(m.ded ? abs(v) : v);
  }
  function tdClass(m) {
    if (m.fmt === 'txt') return 'txt';
    if (m.ded) return 'ded';
    if (m.id === 'margem') return 'mrg';
    if (m.id === 'rl') return 'soft';
    return '';
  }

  /* ============================================================
     4. CATÁLOGO — grafia EXATA do modelo
     ============================================================ */
  function _setRef(c, t, n) { c._t = t; c._n = n; c._ref = "'" + t + "'[" + n + "]"; c._out = t + '[' + n + ']'; }
  function resolveCol(c) {
    c._t = c._n = c._ref = c._out = null;
    if (_colCat) {
      for (var i = 0; i < c.cands.length; i++) {
        var t = c.cands[i][0], n = c.cands[i][1], tb = _colCat[_norm(t)];
        if (tb && tb[_norm(n)]) { _setRef(c, t, tb[_norm(n)]); return true; }
      }
      // fuzzy: todos os tokens da coluna aparecem no nome real
      for (var j = 0; j < c.cands.length; j++) {
        var t2 = c.cands[j][0], n2 = c.cands[j][1], tb2 = _colCat[_norm(t2)];
        if (!tb2) continue;
        var toks = _norm(n2).split(' ').filter(function (w) { return w.length > 2; });
        if (!toks.length) continue;
        var best = null;
        for (var nn in tb2) { if (toks.every(function (w) { return nn.indexOf(w) >= 0; })) { if (best === null || nn.length < best.length) best = nn; } }
        if (best !== null) { _setRef(c, t2, tb2[best]); return true; }
      }
    }
    // o catálogo pode vir incompleto — tentar o 1º candidato é melhor que descartar
    _setRef(c, c.cands[0][0], c.cands[0][1]);
    return false;
  }
  function resolveMea(m) {
    m._ref = null;
    if (_meaCat) {
      for (var i = 0; i < m.cands.length; i++) { var h = _meaCat[_norm(m.cands[i])]; if (h) { m._ref = '[' + h + ']'; return true; } }
      // fuzzy: mesma "assinatura" alfanumérica
      var alvo = _norm(m.cands[0]).replace(/[^a-z0-9]/g, '');
      for (var k in _meaCat) { if (_norm(k).replace(/[^a-z0-9]/g, '') === alvo) { m._ref = '[' + _meaCat[k] + ']'; return true; } }
    }
    m._ref = '[' + m.cands[0] + ']';
    return false;
  }

  async function carregarCatalogo() {
    try {
      var rows = await q('EVALUATE SELECTCOLUMNS(INFO.VIEW.COLUMNS(), "T",[Table], "N",[Name])');
      if (rows && rows.length) {
        _colCat = {};
        rows.forEach(function (r) {
          var t = _v(r, /\[T\]$/), n = _v(r, /\[N\]$/);
          if (t == null || n == null) return;
          var tn = _norm(t); (_colCat[tn] = _colCat[tn] || {})[_norm(n)] = String(n);
        });
      }
    } catch (e) { console.warn('[MARGEM] INFO.VIEW.COLUMNS:', e.message); }
    if (!_colCat) {
      try {
        var rows2 = await q('EVALUATE SELECTCOLUMNS(COLUMNSTATISTICS(), "T",[Table Name], "N",[Column Name])');
        if (rows2 && rows2.length) {
          _colCat = {};
          rows2.forEach(function (r) {
            var t = _v(r, /\[T\]$/), n = _v(r, /\[N\]$/);
            if (t == null || n == null) return;
            var tn = _norm(t); (_colCat[tn] = _colCat[tn] || {})[_norm(n)] = String(n);
          });
        }
      } catch (e) { console.warn('[MARGEM] COLUMNSTATISTICS:', e.message); }
    }
    var carregarMedidas = async function (fn) {
      var rows = await q('EVALUATE SELECTCOLUMNS(' + fn + '(), "N",[Name])');
      if (!rows || !rows.length) return false;
      _meaCat = {};
      rows.forEach(function (r) { var n = _v(r, /\[N\]$/); if (n != null) _meaCat[_norm(n)] = String(n); });
      return true;
    };
    try { await carregarMedidas('INFO.VIEW.MEASURES'); } catch (e) { console.warn('[MARGEM] INFO.VIEW.MEASURES:', e.message); }
    if (!_meaCat) { try { await carregarMedidas('INFO.MEASURES'); } catch (e) { console.warn('[MARGEM] INFO.MEASURES:', e.message); } }

    _naoConfirmados = [];
    // _ok = o catálogo CONFIRMOU o nome. Sem catálogo (a query de INFO falhou)
    // ninguém é reprovado: o literal é o melhor palpite que existe.
    DIMS.forEach(function (d) {
      var ok = resolveCol(d);
      d._ok = ok || !_colCat;
      if (!ok && _colCat) _naoConfirmados.push(d.label);
    });
    MEAS.forEach(function (m) {
      if (m.kind === 'raw') { m._ref = 'CALCULATE(' + m.expr + ')'; m._src = m.expr; m._ok = true; return; }
      var ok = (m.kind === 'col') ? resolveCol(m) : resolveMea(m);
      // _src = grafia LIMPA (sem o embrulho de CALCULATE) para mostrar na tela;
      // é ela que aparece na referência do painel de filiais.
      m._src = m._ref;
      // CALCULATE obrigatório: é ele que faz a transição de contexto (ver o
      // comentário no topo de MEAS). Sem ele a coluna soma o total em toda linha.
      // agg 'txt' usa MAX: no grão do item devolve o próprio valor da coluna.
      if (m.kind === 'col') m._ref = 'CALCULATE(' + (m.agg === 'txt' ? 'MAX(' : 'SUM(') + m._ref + '))';
      m._ok = ok || !(m.kind === 'col' ? _colCat : _meaCat);
      if (!ok && (m.kind === 'col' ? !!_colCat : !!_meaCat)) _naoConfirmados.push(m.label);
    });
  }
  // diagnóstico no console: exatamente o que a página vai mandar pro DAX
  window.mgCampos = function () {
    return {
      dataset: _dsId,
      dims: DIMS.map(function (d) { return d.label + ' = ' + d._ref; }),
      medidas: MEAS.map(function (m) { return m.label + ' = ' + m._ref; }),
      base: baseFilters()
    };
  };

  /* ============================================================
     5. ESTADO DOS FILTROS
     ============================================================ */
  // filtros da barra do topo (o Ano/Mês têm painel próprio)
  // TODO campo do módulo também filtra na barra do topo (Ano/Mês têm o painel de
  // Período à parte). A lista de opções de cada um é carregada SÓ quando o
  // dropdown abre — por isso cabem dimensões grandes (cliente, produto, NF) sem
  // pesar no carregamento da página. Na aba por NF a própria NF entra na barra.
  var FILTROS = ['empresa', 'unidade', 'tipocli', 'cliente', 'estrategia', 'familia', 'linha', 'produto', 'codproduto'];
  if (VIEW === 'nf') FILTROS = FILTROS.concat('nf');
  var _sel = {}; DIMS.forEach(function (d) { _sel[d.id] = new Set(); });
  var _anos = [], _meses = [];           // seleção de período
  var _anosOpc = [], _mesesOpc = [];     // opções carregadas do modelo
  var MES_NUM = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
  var mesNum = function (s) { return MES_NUM[String(s || '').toLowerCase().slice(0, 3)] || 99; };
  // O valor que vai pro DAX é sempre o do modelo (verbatim); `cap` é só rótulo:
  // o modelo grava "jan" e o dashboard mostra "Jan".
  var cap = function (s) { s = String(s == null ? '' : s); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };

  function baseFilters() {
    var f = [];
    if (MG_BASE.geraFatura) f.push("'Operações'[Gera Fatura a receber?] = \"SIM\"");
    if (MG_BASE.semIntercompany) f.push("'DIM_UNIDADE_DE_NEGOCIO_V2'[UNIDADE_DE_NEGOCIO] <> \"INTERCOMPANY\"");
    if (MG_BASE.semNfOculta) {
      f.push("FILTER(ALL('Faturamentos'[Número da fatura]), NOT(('Faturamentos'[Número da fatura] & \"\") IN { "
        + NF_OCULTAS.map(function (n) { return '"' + n + '"'; }).join(', ') + ' }))');
    }
    return f;
  }
  function periodFilters() {
    var f = [], dAno = dimById('ano'), dMes = dimById('mes');
    if (_anos.length && dAno._ref) f.push(_anos.length === 1 ? dAno._ref + ' = ' + Number(_anos[0]) : dAno._ref + ' IN { ' + _anos.map(Number).join(', ') + ' }');
    if (_meses.length && dMes._ref) f.push(dMes._ref + ' IN { ' + _meses.map(function (m) { return '"' + avDax(m) + '"'; }).join(', ') + ' }');
    return f;
  }
  function dimFilters(skipId) {
    var f = [];
    DIMS.forEach(function (d) {
      if (d.id === 'ano' || d.id === 'mes') return;
      // RECORTE MSB: a empresa fixa entra SEMPRE (nem o skipId das listas a tira)
      var vals = d.fixa ? [d.fixa] : Array.from(_sel[d.id]);
      if (d.id === skipId && !d.fixa) return;
      if (vals.length && d._ref) f.push('TREATAS({ ' + vals.map(function (v) { return '"' + avDax(v) + '"'; }).join(', ') + ' }, ' + d._ref + ')');
    });
    return f;
  }
  // filtro de um valor exato para o caminho da matriz.
  // `col & ""` compara em TEXTO: vale se a coluna do modelo for número (NF, Ano)
  // OU texto — TREATAS com string numa coluna numérica derrubaria a query.
  function pathFilter(dim, valor) {
    if (!dim || !dim._ref || valor == null || valor === '') return null;
    return 'FILTER(VALUES(' + dim._ref + '), ' + dim._ref + ' & "" = "' + avDax(valor) + '")';
  }
  function allFilters(extra, skipId) {
    return baseFilters().concat(periodFilters(), dimFilters(skipId), extra || []);
  }
  function ct(expr, extra, skipId) {
    var f = allFilters(extra, skipId);
    return f.length ? 'CALCULATETABLE(' + expr + ', ' + f.join(', ') + ')' : expr;
  }
  var measExpr = function (ids) { return ids.map(function (id) { var m = meaById(id); return '"' + m.key + '", ' + m._ref; }).join(', '); };
  var readMea = function (row, id) {
    var m = meaById(id), raw = _v(row, new RegExp('\\[' + m.key + '\\]$'));
    // medida de TEXTO (códigos da reforma) não passa por _numN, senão vira null
    if (m.fmt === 'txt') return (raw == null || raw === '') ? null : String(raw);
    var v = _numN(raw);
    return (v != null && m.x100) ? v * 100 : v;
  };

  /* ============================================================
     6. BANNER
     ============================================================ */
  function banner(kind, html) {
    var b = document.getElementById('mg-banner'); if (!b) return;
    b.className = 'mg-banner' + (kind ? ' ' + kind : '');
    b.innerHTML = html;
  }
  var IC_OK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  var IC_WARN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  var IC_ERR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

  // nome do dataset + última atualização (igual ao print: "…· atualizado dd/mm/aaaa hh:mm")
  async function bannerConectado() {
    var nome = '', dt = null;
    try {
      var r = await fetch('https://api.powerbi.com/v1.0/myorg/groups/' + PBI_CFG.workspaceId + '/datasets/' + _dsId, { headers: { Authorization: 'Bearer ' + _token } });
      if (r.ok) { var j = await r.json(); nome = j.name || ''; }
    } catch (e) {}
    try {
      var r2 = await fetch('https://api.powerbi.com/v1.0/myorg/groups/' + PBI_CFG.workspaceId + '/datasets/' + _dsId + '/refreshes?$top=5', { headers: { Authorization: 'Bearer ' + _token } });
      if (r2.ok) {
        var j2 = await r2.json(), it = (j2.value || []).filter(function (x) { return x && x.status === 'Completed' && (x.endTime || x.startTime); })[0];
        if (it) dt = parseDW(it.endTime || it.startTime);
      }
    } catch (e) {}
    if (!dt) {  // reserva: coluna de carga do modelo (o mesmo campo do Comercial)
      try {
        var rows = await q("EVALUATE ROW(\"u\", MAX('FAT_CARGAS'[DATA_HORA_FIN]))");
        if (rows && rows[0]) dt = parseDW(Object.values(rows[0])[0]);
      } catch (e) {}
    }
    var partes = ['Conectado ao Power BI'];
    var html = IC_OK + ' <span><b>Conectado ao Power BI</b></span>';
    if (nome) html += ' <code>' + escH(nome) + '</code>';
    if (dt) html += ' <span style="opacity:.85;">· atualizado ' + dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '</span>';
    if (_nfFaltando.length) {
      banner('warn', IC_WARN + ' Conectado — <b>' + _nfFaltando.length + '</b> campo(s) da lista do relatório não existem com esse nome no modelo e ficaram FORA da abertura: <b>'
        + escH(_nfFaltando.slice(0, 8).join(', ')) + '</b>. Os demais abriram normalmente; cada um segue disponível em <b>Campos</b>/<b>Medidas</b>.');
      return;
    }
    if (_naoConfirmados.length) {
      banner('warn', IC_WARN + ' Conectado — campos não confirmados no catálogo do modelo: <b>' + escH(_naoConfirmados.slice(0, 6).join(', ')) + '</b>. A página segue com o nome literal; se algum número vier vazio, é aqui.');
      return;
    }
    banner('ok', html);
  }

  /* ============================================================
     7. BARRA DE FILTROS
     ============================================================ */
  function ddPanel(label) {
    var wrap = document.createElement('div'); wrap.className = 'av-dd';
    var btn = document.createElement('button'); btn.className = 'av-dd-btn'; btn.type = 'button';
    var panel = document.createElement('div'); panel.className = 'av-dd-panel';
    wrap.appendChild(btn); wrap.appendChild(panel);
    return { wrap: wrap, btn: btn, panel: panel };
  }
  var CARET = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#81939B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

  function makeDropdown(o) {
    var d = ddPanel(o.label);
    d.panel.innerHTML = '<div class="av-dd-search"><input type="text" placeholder="Buscar…"></div><div class="av-dd-list"></div>'
      + '<div class="av-dd-foot"><button type="button" data-act="limpar">Limpar</button><button type="button" data-act="fechar">Fechar</button></div>';
    var list = d.panel.querySelector('.av-dd-list'), search = d.panel.querySelector('input');
    var loaded = false, options = [];
    function refresh() {
      var n = o.getSelected().length;
      d.btn.classList.toggle('has', n > 0);
      d.btn.innerHTML = '<span class="fx-fk">' + escH(o.label) + '</span>'
        + (n ? '<span class="cnt">' + n + '</span>' : '<span>Todos</span>') + CARET;
    }
    function renderList() {
      var qq = (search.value || '').toLowerCase(), sel = new Set(o.getSelected());
      var items = options.filter(function (x) { return !qq || String(x.label).toLowerCase().indexOf(qq) >= 0; }).slice(0, 800);
      list.innerHTML = items.length
        ? items.map(function (x) { return '<label class="av-dd-opt"><input type="checkbox" value="' + avEsc(x.value) + '" ' + (sel.has(x.value) ? 'checked' : '') + '>' + escH(x.label) + '</label>'; }).join('')
        : '<div style="padding:8px;color:#97A8AE;font-size:12px;">nenhum</div>';
    }
    async function ensure() {
      if (loaded) return;
      list.innerHTML = '<div style="padding:10px;color:#97A8AE;font-size:12px;">Carregando…</div>';
      try { options = await o.getOptions(); } catch (e) { list.innerHTML = '<div style="padding:10px;color:#B54545;font-size:12px;">erro: ' + escH(e.message.substring(0, 70)) + '</div>'; return; }
      loaded = true; renderList();
    }
    d.btn.addEventListener('click', async function (e) {
      e.stopPropagation();
      var open = d.wrap.classList.contains('open');
      document.querySelectorAll('.av-dd.open').forEach(function (x) { x.classList.remove('open'); });
      if (!open) { d.wrap.classList.add('open'); await ensure(); search.focus(); }
    });
    d.panel.addEventListener('click', function (e) { e.stopPropagation(); });
    list.addEventListener('change', function (e) { if (e.target.matches('input[type=checkbox]')) { o.setSelected(e.target.value, e.target.checked); refresh(); o.onChange(); } });
    search.addEventListener('input', renderList);
    d.panel.querySelector('[data-act=limpar]').addEventListener('click', function () { o.setSelected(null, false, true); renderList(); refresh(); o.onChange(); });
    d.panel.querySelector('[data-act=fechar]').addEventListener('click', function () { d.wrap.classList.remove('open'); });
    refresh();
    return d.wrap;
  }
  document.addEventListener('click', function () { document.querySelectorAll('.av-dd.open').forEach(function (x) { x.classList.remove('open'); }); });

  async function valoresDe(d) {
    if (!d._ref) return [];
    // só os valores que existem sob os filtros atuais (menos o dele mesmo)
    var dax = 'EVALUATE ' + ct('VALUES(' + d._ref + ')', [], d.id);
    var rows;
    try { rows = await q(dax); } catch (e) { rows = await q('EVALUATE VALUES(' + d._ref + ')'); }
    if (!rows || !rows.length) return [];
    var key = Object.keys(rows[0])[0];
    return rows.map(function (r) { return r[key]; }).filter(function (v) { return v != null && v !== ''; })
      .map(function (v) { return { value: String(v), label: String(v) }; })
      .sort(function (a, b) { return a.label.localeCompare(b.label, 'pt-BR', { numeric: true }); });
  }

  function periodoLabel() {
    var a = _anos.length ? (_anos.length === 1 ? String(_anos[0]) : _anos.length + ' anos') : 'Todos';
    var m = '';
    if (_meses.length === 1) m = cap(_meses[0]);
    else if (_meses.length > 1) {
      var ord = _meses.slice().sort(function (x, y) { return mesNum(x) - mesNum(y); });
      m = cap(ord[0]) + '–' + cap(ord[ord.length - 1]);
    }
    setTxt('mg-periodo-lbl', m ? a + ' · ' + m : a);
  }
  function pintarPeriodo() {
    document.querySelectorAll('#mg-anos button').forEach(function (b) {
      var v = b.dataset.v || '';
      b.classList.toggle('active', v === '' ? !_anos.length : _anos.indexOf(v) >= 0);
    });
    document.querySelectorAll('#mg-meses button').forEach(function (b) {
      var v = b.dataset.v || '';
      b.classList.toggle('active', v === '' ? !_meses.length : _meses.indexOf(v) >= 0);
    });
    periodoLabel();
  }
  function toggleVal(arr, v, multi) {
    if (v === '' || v == null) return [];
    if (!multi) return [v];
    var i = arr.indexOf(v);
    return i >= 0 ? arr.filter(function (x) { return x !== v; }) : arr.concat(v);
  }
  function montarPeriodo() {
    var ca = document.getElementById('mg-anos'), cm = document.getElementById('mg-meses');
    if (ca) {
      ca.innerHTML = '';
      var mk = function (lbl, v) {
        var b = document.createElement('button'); b.type = 'button'; b.dataset.v = v; b.textContent = lbl;
        b.addEventListener('click', function (e) { _anos = toggleVal(_anos, v, e.ctrlKey || e.metaKey); pintarPeriodo(); aplicar(); });
        return b;
      };
      ca.appendChild(mk('Todos', ''));
      _anosOpc.forEach(function (a) { ca.appendChild(mk(String(a), String(a))); });
    }
    if (cm) {
      cm.innerHTML = '';
      var mk2 = function (lbl, v) {
        var b = document.createElement('button'); b.type = 'button'; b.dataset.v = v; b.textContent = lbl;
        b.addEventListener('click', function (e) { _meses = toggleVal(_meses, v, e.ctrlKey || e.metaKey); pintarPeriodo(); aplicar(); });
        return b;
      };
      cm.appendChild(mk2('Todos', ''));
      _mesesOpc.forEach(function (m) { cm.appendChild(mk2(cap(m), String(m))); });
    }
    pintarPeriodo();
  }
  function montarFiltros() {
    var tb = document.getElementById('mg-filtros'); if (!tb) return;
    tb.innerHTML = '';
    FILTROS.forEach(function (id) {
      var d = dimById(id); if (!d) return;
      // RECORTE MSB: Empresa é rótulo fixo, com o mesmo visual do dropdown, sem abrir
      if (d.fixa) {
        tb.insertAdjacentHTML('beforeend', '<div class="av-dd av-dd-fixa"><span class="av-dd-btn has" title="Neste portal todos os relatórios são da MSB">'
          + '<span class="fx-fk">' + escH(d.label) + '</span><span class="fixo">' + escH(d.fixa) + '</span></span></div>');
        return;
      }
      tb.appendChild(makeDropdown({
        label: d.label,
        getOptions: function () { return valoresDe(d); },
        getSelected: function () { return Array.from(_sel[d.id]); },
        setSelected: function (v, ck, clr) { var s = _sel[d.id]; if (clr) { s.clear(); return; } if (ck) s.add(v); else s.delete(v); },
        onChange: aplicar
      }));
    });
    var limpar = document.createElement('button');
    limpar.className = 'fx-flimpar'; limpar.type = 'button';
    limpar.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Limpar filtros';
    limpar.addEventListener('click', function () {
      DIMS.forEach(function (d) { _sel[d.id].clear(); });
      _anos = []; _meses = [];
      pintarPeriodo(); montarFiltros(); aplicar();
    });
    tb.appendChild(limpar);
  }
  (function ligarPeriodo() {
    document.addEventListener('DOMContentLoaded', function () {
      var dd = document.getElementById('mg-periodo'), btn = document.getElementById('mg-periodo-btn');
      if (!dd || !btn) return;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = dd.classList.contains('open');
        document.querySelectorAll('.av-dd.open').forEach(function (x) { x.classList.remove('open'); });
        if (!open) dd.classList.add('open');
      });
      var p = dd.querySelector('.av-dd-panel'); if (p) p.addEventListener('click', function (e) { e.stopPropagation(); });
    });
  })();

  // Anos/meses do painel: só os que TÊM faturamento (senão o modelo lista o
  // calendário inteiro, com anos futuros vazios).
  async function valoresComDados(dim) {
    var base = baseFilters();
    var calc = base.length ? 'CALCULATE(' + meaById('rb')._ref + ', ' + base.join(', ') + ')' : meaById('rb')._ref;
    var rows;
    try { rows = await q('EVALUATE FILTER(ADDCOLUMNS(VALUES(' + dim._ref + '), "@v", ' + calc + '), [@v] <> 0)'); }
    catch (e) { console.warn('[MARGEM] ' + dim.id + ' com dados falhou, usando VALUES:', e.message); rows = await q('EVALUATE VALUES(' + dim._ref + ')'); }
    if (!rows || !rows.length) return [];
    return rows.map(function (r) { return valorDim(r, dim); }).filter(function (v) { return v != null && v !== ''; });
  }
  async function carregarPeriodoOpcoes() {
    var dAno = dimById('ano'), dMes = dimById('mes');
    try {
      _anosOpc = (await valoresComDados(dAno)).map(Number).filter(function (v) { return !isNaN(v); })
        .sort(function (a, b) { return b - a; }).slice(0, 12);
    } catch (e) { console.warn('[MARGEM] anos:', e.message); }
    try {
      _mesesOpc = (await valoresComDados(dMes)).map(String).sort(function (a, b) { return mesNum(a) - mesNum(b); });
    } catch (e) { console.warn('[MARGEM] meses:', e.message); }
    // padrão: o ano mais recente, todos os meses (é o "2026 · Jan–Ago" do dashboard)
    if (_anosOpc.length) _anos = [String(_anosOpc[0])];
  }

  /* ============================================================
     8. QUERIES DO DASHBOARD
     ============================================================ */
  var TOT_IDS = ['rb', 'rl', 'imp', 'frete', 'desc', 'custo', 'margem', 'pct', 'nota', 'itens'];

  // Totais. Se a query combinada falhar (um nome de medida errado derruba a
  // query INTEIRA), refaz medida por medida para o dashboard não morrer todo.
  async function qTotais(extraIds) {
    var ids = TOT_IDS.slice();
    (extraIds || []).forEach(function (id) { if (ids.indexOf(id) < 0 && meaById(id)) ids.push(id); });
    var out = {};
    try {
      var rows = await q('EVALUATE ' + ct('ROW(' + measExpr(ids) + ')'));
      var r = rows && rows[0] ? rows[0] : {};
      ids.forEach(function (id) { out[id] = readMea(r, id); });
      return out;
    } catch (e) { console.warn('[MARGEM] totais combinados falharam, medindo uma a uma:', e.message); }
    await Promise.all(ids.map(async function (id) {
      try { var rows = await q('EVALUATE ' + ct('ROW(' + measExpr([id]) + ')')); out[id] = readMea(rows && rows[0] ? rows[0] : {}, id); }
      catch (e2) { out[id] = null; console.warn('[MARGEM] medida ' + id + ':', e2.message); }
    }));
    return out;
  }

  async function qTributos() {
    var out = {};
    try {
      var rows = await q('EVALUATE ' + ct('ROW(' + measExpr(TRIBUTOS) + ')'));
      var r = rows && rows[0] ? rows[0] : {};
      TRIBUTOS.forEach(function (id) { out[id] = abs(readMea(r, id)); });
      return out;
    } catch (e) { console.warn('[MARGEM] tributos combinados falharam:', e.message); }
    await Promise.all(TRIBUTOS.map(async function (id) {
      try { var rows = await q('EVALUATE ' + ct('ROW(' + measExpr([id]) + ')')); out[id] = abs(readMea(rows && rows[0] ? rows[0] : {}, id)); }
      catch (e2) { out[id] = null; }
    }));
    return out;
  }

  // evolução por Ano+Mês (SUMMARIZE na própria 'Calendário', com a grafia do modelo)
  async function qEvolucao() {
    var dAno = dimById('ano'), dMes = dimById('mes');
    if (!dAno._ref || !dMes._ref) return [];
    var tabCal = "'" + dAno._t + "'";
    var expr = 'FILTER(ADDCOLUMNS(SUMMARIZE(' + tabCal + ', ' + dAno._ref + ', ' + dMes._ref + '), '
      + measExpr(['rb', 'custo', 'pct']) + '), NOT ISBLANK([rb]))';
    var rows = await q('EVALUATE ' + ct(expr));
    return rows.map(function (r) {
      return {
        ano: _numN(valorDim(r, dAno)),
        mesLbl: valorDim(r, dMes),
        rb: readMea(r, 'rb'), cp: abs(readMea(r, 'custo')), mp: readMea(r, 'pct')
      };
    }).filter(function (x) { return x.mesLbl != null && x.mesLbl !== ''; })
      .sort(function (a, b) { return ((a.ano || 0) - (b.ano || 0)) || (mesNum(a.mesLbl) - mesNum(b.mesLbl)); });
  }

  // um nível da matriz (também usado pelo painel de filiais)
  async function qNivel(dim, ids, extra, top, sortKey) {
    if (!dim || !dim._ref) return [];
    var expr = 'FILTER(ADDCOLUMNS(SUMMARIZE(' + FATO + ', ' + dim._ref + '), ' + measExpr(ids) + '), NOT ISBLANK([rb]) || NOT ISBLANK([mg]))';
    // ordena pela chave da medida pedida; ela PRECISA estar em ids, senão a
    // coluna não existe no ADDCOLUMNS e a query inteira cai
    var sk = '[' + meaById(ids.indexOf(sortKey) >= 0 ? sortKey : 'rb').key + ']';
    var dax = 'EVALUATE TOPN(' + (top || 3000) + ', ' + ct(expr, extra) + ', ' + sk + ', DESC)\nORDER BY ' + sk + ' DESC';
    var rows = await q(dax);
    return rows.map(function (r) {
      var o = { nome: valorDim(r, dim) };
      ids.forEach(function (id) { o[id] = readMea(r, id); });
      return o;
    });
  }
  function valorDim(row, dim) {
    if (dim._out in row) return row[dim._out];
    var k = Object.keys(row).find(function (x) { return _norm(x) === _norm(dim._out); });
    return k === undefined ? null : row[k];
  }

  /* ============================================================
     9. VISÃO GERAL — render
     ============================================================ */
  // "2026 · Jan–Ago": o intervalo vem dos meses que REALMENTE têm dados no
  // período filtrado (preenchido pela query de evolução), não do calendário
  // inteiro — senão a pílula diria Jan–Dez num ano em curso.
  var _mesesComDados = [];
  function pillPeriodo() {
    var a = _anos.length === 1 ? String(_anos[0]) : (_anos.length ? _anos.length + ' anos' : 'Todos os anos');
    var faixa = function (arr) {
      var o = arr.slice().sort(function (x, y) { return mesNum(x) - mesNum(y); });
      return o.length === 1 ? cap(o[0]) : cap(o[0]) + '–' + cap(o[o.length - 1]);
    };
    var m = '';
    if (_meses.length) m = faixa(_meses);
    else if (_mesesComDados.length) m = faixa(_mesesComDados);
    else if (_mesesOpc.length) m = faixa(_mesesOpc);
    return m ? a + ' · ' + m : a;
  }

  function renderHero(t) {
    var rb = t.rb, rl = t.rl, mg = t.margem, pct = t.pct;
    var custo = abs(t.custo) || 0, imp = abs(t.imp) || 0, fr = abs(t.frete) || 0, ds = abs(t.desc) || 0;
    var ded = imp + fr + ds;
    var base = (custo + ded + (mg || 0)) || 1;
    var p = function (x) { return (x / base * 100).toFixed(2) + '%'; };
    setTxt('mg-hero-pill', pillPeriodo());
    setTxt('mg-hero-pct', pct == null ? '—' : fPct(pct));
    setTxt('mg-hero-rs', fMi(mg));
    setHTML('mg-hero-bar',
      '<span style="width:' + p(custo) + ';background:#4896AC;"></span>'
      + '<span style="width:' + p(ded) + ';background:#E8A33D;"></span>'
      + '<span style="width:' + p(mg || 0) + ';background:#2FBF71;"></span>');
    setTxt('mg-hero-nota', fNum2(t.nota));
    setTxt('mg-hero-meta', fPct(META));
    // gap vs meta, em R$: (margem% − meta%) × receita líquida
    var gap = (pct == null || rl == null) ? null : (pct - META) / 100 * rl;
    var el = document.getElementById('mg-hero-gap');
    if (el) {
      el.className = 'v ' + (gap == null ? '' : (gap >= 0 ? 'gr' : 'rd'));
      // sempre em Mi (o gap costuma ficar abaixo de 1 Mi e "R$ 679.704" não
      // se compara de bate-pronto com a margem em Mi logo acima)
      el.textContent = gap == null ? '—' : (gap >= 0 ? '▲ ' : '▼ ') + fMiF(Math.abs(gap));
    }
  }

  function renderResumo(t) {
    var rb = t.rb, rl = t.rl, itens = t.itens;
    var imp = abs(t.imp) || 0, fr = abs(t.frete) || 0, ds = abs(t.desc) || 0, ded = imp + fr + ds;
    setTxt('mg-rb-v', fMi(rb));
    setTxt('mg-rb-rl', fMi(rl));
    setTxt('mg-rb-cp', fMi(abs(t.custo)));
    setTxt('mg-rb-tk', (rb != null && itens) ? fBRL0(rb / itens) : '—');
    setTxt('mg-ded-v', fMi(ded));
    setTxt('mg-ded-note', rb ? (ded / rb * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '% da receita bruta' : '—');
    setTxt('mg-ded-imp', fMi(imp));
    setTxt('mg-ded-fr', fMi(fr));
    setTxt('mg-ded-ds', fMi(ds));
  }

  function renderKpis(t) {
    var rb = t.rb, rl = t.rl, mg = t.margem, pct = t.pct;
    var custo = abs(t.custo), fr = abs(t.frete) || 0, ds = abs(t.desc) || 0;
    setTxt('mg-k-rb', fMi(rb));   setTxt('mg-k-rb-s', t.itens != null ? fINT(t.itens) + ' itens faturados' : '—');
    setTxt('mg-k-rl', fMi(rl));   setTxt('mg-k-rl-s', (rl != null && rb) ? fPct(rl / rb * 100) + ' da receita bruta' : '—');
    setTxt('mg-k-cp', fMi(custo)); setTxt('mg-k-cp-s', (custo != null && rl) ? fPct(custo / rl * 100) + ' da receita líquida' : '—');
    setTxt('mg-k-mg', fMi(mg));   setTxt('mg-k-mg-s', pct == null ? '—' : fPct(pct) + ' de margem');
    setTxt('mg-k-fd', fMi(fr + ds)); setTxt('mg-k-fd-s', 'Frete ' + fMi(fr) + ' · Desc. ' + fMi(ds));
  }

  // ── cascata ──
  function renderCascata(t) {
    var rb = t.rb || 0, mg = t.margem || 0;
    var imp = abs(t.imp) || 0, fr = abs(t.frete) || 0, ds = abs(t.desc) || 0, cp = abs(t.custo) || 0;
    var host = document.getElementById('mg-wf'); if (!host) return;
    if (!rb) { host.innerHTML = '<div class="fx-empty" style="width:100%;">Sem dados no período.</div>'; return; }
    var max = Math.max(rb, mg) || 1;
    var passos = [
      { lab: 'Receita bruta',            de: 0,   ate: rb,  val: rb,   cor: '#4695AA', total: true },
      { lab: '(−) Impostos',             val: -imp, cor: '#E8A33D' },
      { lab: '(−) Frete',                val: -fr,  cor: '#E8A33D' },
      { lab: '(−) Descontos',            val: -ds,  cor: '#E8A33D' },
      { lab: '(−) Custo produto',        val: -cp,  cor: '#7A4BC4' },
      { lab: 'Margem de contribuição',   de: 0,   ate: mg,  val: mg,   cor: '#2FBF71', total: true }
    ];
    var run = rb, html = '';
    passos.forEach(function (p, i) {
      var de, ate;
      if (p.total) { de = 0; ate = p.ate; }
      else { ate = run; de = run + p.val; run = de; }
      var lo = Math.min(de, ate), hi = Math.max(de, ate);
      var h = (hi - lo) / max * 100, b = lo / max * 100;
      var thin = h < 1.2;
      var lbl = p.total ? fMi(p.val) : (Math.abs(p.val) >= 1e6 ? '−' + fMi(Math.abs(p.val)) : '−' + fMiF(Math.abs(p.val)));
      html += '<div class="mg-wf-col">'
        + '<div class="mg-wf-bar' + (thin ? ' thin' : '') + '" style="bottom:' + b.toFixed(2) + '%;height:' + Math.max(h, 0.35).toFixed(2) + '%;background:' + p.cor + (thin ? ';box-shadow:0 0 0 1px ' + p.cor : '') + ';"></div>'
        + '<div class="mg-wf-val' + (p.total ? '' : ' neg') + '" style="bottom:calc(' + (b + Math.max(h, 0.35)).toFixed(2) + '% + 6px);">' + lbl + '</div>'
        + '<div class="mg-wf-lab">' + escH(p.lab) + '</div>'
        + '</div>';
    });
    host.innerHTML = html + '<div class="mg-wf-axis"></div>';
  }

  // ── impostos por tributo ──
  function renderTributos(trib, t) {
    var rb = t.rb, impTotal = abs(t.imp);
    var itens = TRIBUTOS.map(function (id) { return { id: id, label: meaById(id).trib, v: trib[id] || 0 }; })
      .sort(function (a, b) { return b.v - a.v; });
    var soma = itens.reduce(function (s, x) { return s + x.v; }, 0);
    var denom = soma || impTotal || 1;
    setTxt('mg-trib-tot', fMi(impTotal != null ? impTotal : soma));
    // CBS/IBS/IBS-M são colunas novas (reforma) e podem NÃO estar dentro da
    // medida [Impostos]: quando a soma dos tributos listados diverge do total
    // da medida, a página diz isso em vez de deixar o leitor conciliando sozinho
    var sub = rb ? fPct((impTotal != null ? impTotal : soma) / rb * 100) + ' da receita' : '—';
    if (impTotal != null && Math.abs(soma - impTotal) > Math.max(1, impTotal * 0.01)) {
      sub += ' · tributos listados somam ' + fMi(soma);
    }
    setTxt('mg-trib-sub', sub);
    var stack = document.getElementById('mg-trib-stack');
    if (stack) {
      stack.innerHTML = itens.filter(function (x) { return x.v > 0; }).map(function (x) {
        return '<span style="width:' + (x.v / denom * 100).toFixed(2) + '%;background:' + TRIB_COLOR[x.id] + ';"></span>';
      }).join('') || '<span style="width:100%;background:#E5EAED;"></span>';
    }
    var maxV = itens.length ? itens[0].v : 0;
    setHTML('mg-trib-rows', itens.map(function (x) {
      var w = maxV ? (x.v / maxV * 100) : 0;
      return '<div class="mg-trib-row">'
        + '<span class="mg-trib-tag">' + escH(x.label) + '</span>'
        + '<div class="mg-trib-track"><div class="mg-trib-fill" style="width:' + w.toFixed(2) + '%;background:' + TRIB_COLOR[x.id] + ';"></div></div>'
        + '<div class="mg-trib-v">' + fMi(x.v) + '</div>'
        + '<div class="mg-trib-p">' + (denom ? fPct(x.v / denom * 100) : '—') + '</div>'
        + '</div>';
    }).join(''));
  }

  // ── margem por filial ──
  // As 4 colunas de número não tinham cabeçalho: só a legenda do painel dizia,
  // em prosa, o que era cada uma. Agora cada coluna é nomeada no cabeçalho e a
  // faixa do rodapé traz a REFERÊNCIA da medida/coluna do modelo que gerou o
  // número — a grafia sai do catálogo (m._src), igual ao painel de período,
  // que já mostra "Ano · 'Calendário'[Ano]".
  //   cl = classe da célula · k = rótulo curto · id = medida em MEAS
  var FIL_COLS = [
    { id: 'pct',    cl: 'mg-fpct',  k: '% Margem' },
    { id: 'margem', cl: 'mg-fval',  k: 'Margem R$' },
    { id: 'rb',     cl: 'mg-frec',  k: 'Receita bruta' },
    { id: 'nota',   cl: 'mg-fnota', k: 'Nota' }
  ];
  // 'col' do modelo entra somada; 'mea' já é medida (traz CALCULATE implícito)
  function refMea(id) {
    var m = meaById(id); if (!m) return '';
    var s = m._src || (m.kind === 'col' ? "'" + m.cands[0][0] + "'[" + m.cands[0][1] + ']' : '[' + m.cands[0] + ']');
    return m.kind === 'col' ? 'SOMA de ' + s : s;
  }
  function filHeader() {
    var dim = dimById('unidade'), dref = dim && dim._ref ? dim._ref : "'DIM_UNIDADE_DE_NEGOCIO_V2'[UNIDADE_DE_NEGOCIO]";
    return '<div class="mg-fhead">'
      + '<div title="' + avEsc(dref) + '">Filial / unidade</div>'
      + '<div class="bar">Barra = % de margem · marca = meta de ' + fPct(META) + '</div>'
      + FIL_COLS.map(function (c) { return '<div class="n" title="' + avEsc(c.k + ' = ' + refMea(c.id)) + '">' + escH(c.k) + '</div>'; }).join('')
      + '</div>';
  }
  function filRef() {
    var dim = dimById('unidade'), dref = dim && dim._ref ? dim._ref : "'DIM_UNIDADE_DE_NEGOCIO_V2'[UNIDADE_DE_NEGOCIO]";
    var itens = [{ k: 'Filial / unidade', v: dref }]
      .concat(FIL_COLS.map(function (c) { return { k: c.k, v: refMea(c.id) }; }))
      // a meta NÃO é medida do modelo: é constante desta página (MG_META)
      .concat([{ k: 'Meta', v: fPct(META) + ' · constante da página, não é medida do modelo' }]);
    return '<div class="mg-fref"><span class="mg-fref-k">De onde vem cada número</span>'
      + itens.map(function (i) { return '<span class="mg-fref-i"><b>' + escH(i.k) + '</b> = <code>' + escH(i.v) + '</code></span>'; }).join('')
      + '</div>';
  }
  function renderFiliais(rows) {
    var host = document.getElementById('mg-fil'); if (!host) return;
    var itens = rows.filter(function (r) { return r.nome != null && (r.rb || r.margem); })
      .sort(function (a, b) { return (b.pct || -1e9) - (a.pct || -1e9); });
    if (!itens.length) { host.innerHTML = '<div class="fx-empty">Sem dados no período.</div>'; return; }
    setTxt('mg-fil-meta', 'Linha de meta: ' + fPct(META));
    host.innerHTML = filHeader() + itens.map(function (r) {
      var pct = r.pct, w = pct == null ? 0 : Math.max(0, Math.min(100, pct));
      return '<div class="mg-frow">'
        + '<div class="mg-fname" title="' + avEsc(r.nome) + '">' + escH(r.nome) + '</div>'
        + '<div class="mg-ftrack"><div class="mg-ffill" style="width:' + w.toFixed(2) + '%;background:' + barColor(pct) + ';"></div>'
        + '<div class="mg-fmeta" style="left:' + META.toFixed(2) + '%;"></div></div>'
        + '<div class="mg-fnums">'
        + '<div class="mg-fpct ' + cls(pct) + '" data-k="' + avEsc(FIL_COLS[0].k) + '">' + fPct(pct) + '</div>'
        + '<div class="mg-fval" data-k="' + avEsc(FIL_COLS[1].k) + '">' + fMi(r.margem) + '</div>'
        + '<div class="mg-frec" data-k="' + avEsc(FIL_COLS[2].k) + '">' + fMi(r.rb) + '</div>'
        + '<div class="mg-fnota ' + cls(pct) + '" data-k="' + avEsc(FIL_COLS[3].k) + '">' + fNum2(r.nota) + '</div>'
        + '</div></div>';
    }).join('') + filRef();
  }

  // ── evolução (Chart.js: barras de receita/custo + linha de % de margem) ──
  var _chart = null;
  function renderEvolucao(pts) {
    var el = document.getElementById('mg-chart-cv');
    if (!el || typeof Chart === 'undefined') return;
    var labels = pts.map(function (p) { return cap(p.mesLbl); });
    var rb = pts.map(function (p) { return p.rb || 0; });
    var cp = pts.map(function (p) { return p.cp || 0; });
    var mp = pts.map(function (p) { return p.mp; });
    var maxRb = Math.max.apply(null, rb.concat([1]));
    var mpVals = mp.filter(function (v) { return v != null; });
    var pMin = (mpVals.length ? Math.min.apply(null, mpVals) : 0) - 6;
    var pMax = (mpVals.length ? Math.max.apply(null, mpVals) : 100) + 6;

    var rotulos = {
      id: 'mgRotulos',
      afterDatasetsDraw: function (c) {
        var x = c.ctx;
        x.save();
        x.font = '700 9.5px "Roboto", system-ui, sans-serif';
        x.textAlign = 'center';
        // valor no topo da barra de receita
        var b = c.getDatasetMeta(0);
        x.fillStyle = '#374951';
        b.data.forEach(function (pt, i) { if (rb[i]) x.fillText(fK(rb[i]), pt.x, pt.y - 6); });
        // valor no topo da barra de custo (era o plugin global quem desenhava)
        var k = c.getDatasetMeta(1);
        x.fillStyle = '#81939B';
        k.data.forEach(function (pt, i) { if (cp[i]) x.fillText(fK(cp[i]), pt.x, pt.y - 6); });
        // % da linha
        var l = c.getDatasetMeta(2);
        x.fillStyle = '#C77E22';
        l.data.forEach(function (pt, i) { if (mp[i] != null) x.fillText(fPct(mp[i]), pt.x, pt.y - 9); });
        x.restore();
      }
    };

    var data = {
      labels: labels,
      datasets: [
        { label: 'Receita bruta', data: rb, backgroundColor: '#4695AA', borderRadius: 3, order: 3, yAxisID: 'y' },
        { label: 'Custo produto', data: cp, backgroundColor: '#C2D9E1', borderRadius: 3, order: 4, yAxisID: 'y' },
        { label: '% Margem', data: mp, type: 'line', yAxisID: 'y1', order: 1, borderColor: '#E8A33D', backgroundColor: '#fff',
          borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#fff', pointBorderColor: '#E8A33D', pointBorderWidth: 2, tension: .25, spanGaps: true }
      ]
    };
    var opts = {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 18 } },
      plugins: {
        legend: { display: false },
        // O script.js registra um plugin GLOBAL (bmValueLabels) que rotula TODO
        // dataset usando o formatador do eixo da ESQUERDA. Numa linha de % isso
        // virava "R$0k" (fK(60,27)) em cima do rótulo bom, e ainda repetia o
        // valor do custo. Este gráfico desenha os próprios rótulos (mgRotulos),
        // então o global fica desligado só aqui.
        bmValueLabels: false,
        tooltip: {
          callbacks: {
            label: function (c) {
              if (c.dataset.yAxisID === 'y1') return c.dataset.label + ': ' + fPct(c.raw);
              return c.dataset.label + ': ' + fBRL0(c.raw);
            }
          }
        }
      },
      scales: {
        y: { beginAtZero: true, suggestedMax: maxRb * 1.18, grid: { color: '#F1F5F7' },
             ticks: { callback: function (v) { return fK(v); }, font: { size: 10 }, color: '#97A8AE' } },
        y1: { position: 'right', display: false, min: pMin, max: pMax, grid: { display: false } },
        x: { grid: { display: false }, ticks: { font: { size: 11, weight: '600' }, color: '#5F727A' } }
      }
    };
    if (_chart) { _chart.data = data; _chart.options = opts; _chart.update(); return; }
    _chart = new Chart(el.getContext('2d'), { type: 'bar', data: data, options: opts, plugins: [rotulos] });
  }

  /* ============================================================
     9b. ANALÍTICO — visuais por dimensão
     Mesma régua de cor do módulo (barColor/cls contra META) e as MESMAS
     medidas da matriz: nada aqui recalcula margem no navegador — o % e a
     nota saem das medidas do modelo, por linha do agrupamento.
     ============================================================ */
  var _anProd = [], _anCli = [];
  var AN_CLI_TOP = 50, AN_FAM_TOP = 40, AN_TIPO_TOP = 30, AN_PROD_TOP = 60;

  // dimensão vazia no modelo virava barra SEM rótulo nenhum (apareceu em
  // "tipo de cliente"): melhor dizer que é sem informação do que sumir com a
  // linha, senão a soma dos visuais não fecha com o total dos KPIs
  var nomeDim = function (v) { var t = String(v == null ? '' : v).trim(); return t || '(não informado)'; };

  // lista ranqueada (clientes, produtos): nº + nome + barra de receita + margem
  //   opt.sub → mostra a coluna do subrótulo (a unidade de negócio do cliente)
  //   opt.two → duas colunas (o Top de produtos)
  function renderRank(hostId, rows, opt) {
    var host = document.getElementById(hostId); if (!host) return;
    opt = opt || {};
    host.className = 'mg-rk' + (opt.sub ? ' sub' : '') + (opt.two ? ' two' : '');
    if (!rows || !rows.length) { host.innerHTML = '<div class="fx-empty">Sem dados no período.</div>'; return; }
    var maxRb = Math.max.apply(null, rows.map(function (r) { return r.rb || 0; }).concat([1]));
    // cabeçalho na MESMA grade da linha (duas vezes quando a lista é em duas
    // colunas: a grade preenche na horizontal, então um cabeçalho por coluna)
    var head = '<div class="mg-rk-row hd">'
      + '<div></div><div>' + escH(opt.dim || 'Item') + '</div>'
      + (opt.sub ? '<div class="n sub">' + escH(opt.subLabel || 'Unidade') + '</div>' : '')
      + '<div class="n rb">Receita</div><div class="n">Margem R$</div><div class="n">% Margem</div>'
      + '</div>';
    host.innerHTML = (opt.two ? head + head : head) + rows.map(function (r, i) {
      var pct = r.pct, w = Math.max(1.5, (r.rb || 0) / maxRb * 100), nome = nomeDim(r.nome);
      return '<div class="mg-rk-row">'
        + '<div class="mg-rk-n">' + ('0' + (i + 1)).slice(-2) + '</div>'
        + '<div class="mg-rk-mid">'
        +   '<div class="mg-rk-name" title="' + avEsc((r.cod ? r.cod + ' · ' : '') + nome) + '">'
        +     (r.cod ? '<span class="mg-rk-cod">' + escH(r.cod) + '</span> ' : '') + escH(nome) + '</div>'
        +   '<div class="mg-rk-track"><div class="mg-rk-fill" style="width:' + w.toFixed(2) + '%;background:' + barColor(pct) + ';"></div></div>'
        + '</div>'
        + (opt.sub ? '<div class="mg-rk-sub" title="' + avEsc(r.sub || '') + '">' + escH(r.sub || '') + '</div>' : '')
        + '<div class="mg-rk-rb">' + fMi(r.rb) + '</div>'
        + '<div class="mg-rk-v">' + fMi(r.margem) + '</div>'
        + '<div class="mg-rk-p ' + cls(pct) + '">' + fPct(pct) + '</div>'
        + '</div>';
    }).join('');
  }

  // barras simples (tipo de cliente, família): rótulo em cima, barra e valores
  function renderBarList(hostId, rows, dimLabel) {
    var host = document.getElementById(hostId); if (!host) return;
    if (!rows || !rows.length) { host.innerHTML = '<div class="fx-empty">Sem dados no período.</div>'; return; }
    var maxRb = Math.max.apply(null, rows.map(function (r) { return r.rb || 0; }).concat([1]));
    var head = '<div class="mg-bl-row hd"><div>' + escH(dimLabel || 'Item') + '</div>'
      + '<div class="n rb">Receita</div><div class="n">Margem R$</div><div class="n">% Margem</div></div>';
    host.innerHTML = head + rows.map(function (r) {
      var pct = r.pct, w = Math.max(1.5, (r.rb || 0) / maxRb * 100), nome = nomeDim(r.nome);
      return '<div class="mg-bl-row">'
        + '<div class="mg-bl-mid">'
        +   '<div class="mg-bl-name" title="' + avEsc(nome) + '">' + escH(nome) + '</div>'
        +   '<div class="mg-bl-track"><div class="mg-bl-fill" style="width:' + w.toFixed(2) + '%;background:' + barColor(pct) + ';"></div></div>'
        + '</div>'
        + '<div class="mg-bl-rb">' + fMi(r.rb) + '</div>'
        + '<div class="mg-bl-v">' + fMi(r.margem) + '</div>'
        + '<div class="mg-bl-p ' + cls(pct) + '">' + fPct(pct) + '</div>'
        + '</div>';
    }).join('');
  }

  // estratégia de venda: faixa de participação na receita + colunas de % de margem
  var ESTR_COR = ['#287A8E', '#4695AA', '#6FACBD', '#7A4BC4', '#A98BE0', '#97C3CF', '#C2D9E1'];
  function renderEstrategia(rows) {
    var band = document.getElementById('mg-an-estr-band');
    var colsEl = document.getElementById('mg-an-estr-cols');
    var list = document.getElementById('mg-an-estr-rows');
    if (!list) return;
    rows = (rows || []).filter(function (r) { return r.nome != null && (r.rb || r.margem); });
    if (!rows.length) {
      list.innerHTML = '<div class="fx-empty">Sem dados no período.</div>';
      if (band) band.innerHTML = ''; if (colsEl) colsEl.innerHTML = '';
      return;
    }
    var soma = rows.reduce(function (s, r) { return s + (r.rb || 0); }, 0) || 1;
    var maxPct = Math.max.apply(null, rows.map(function (r) { return r.pct || 0; }).concat([1]));
    rows.forEach(function (r, i) { r._cor = ESTR_COR[i % ESTR_COR.length]; r._part = (r.rb || 0) / soma * 100; });
    if (band) band.innerHTML = rows.map(function (r) {
      // estrategia com receita NEGATIVA (existe: CATH LAB) daria largura < 0 e a
      // faixa ignoraria o valor: entra com 0 e o numero na tabela conta a historia
      return '<span title="' + avEsc(nomeDim(r.nome) + ' · ' + fPct(r._part)) + '" style="width:' + Math.max(0, r._part).toFixed(2) + '%;background:' + r._cor + ';"></span>';
    }).join('');
    if (colsEl) colsEl.innerHTML = rows.map(function (r) {
      var h = Math.max(6, (r.pct || 0) / maxPct * 100);
      return '<div class="mg-st-col" title="' + avEsc(nomeDim(r.nome) + ' · ' + fPct(r.pct)) + '">'
        + '<div class="mg-st-bar" style="height:' + h.toFixed(2) + '%;background:' + r._cor + ';"></div></div>';
    }).join('');
    list.innerHTML = '<div class="mg-st-row hd"><span></span><span>Estratégia</span><span>Receita</span><span>Margem R$</span>'
      + '<span title="Participação desta estratégia na receita bruta do período — a soma das linhas dá 100%">% receita</span>'
      + '<span title="Margem de contribuição sobre a receita líquida desta estratégia — meta ' + fPct(META) + '">% margem</span></div>'
      + rows.map(function (r) {
        return '<div class="mg-st-row">'
          + '<span class="mg-st-dot" style="background:' + r._cor + ';"></span>'
          + '<span class="mg-st-n" title="' + avEsc(nomeDim(r.nome)) + '">' + escH(nomeDim(r.nome)) + '</span>'
          + '<span class="mg-st-rb">' + fMi(r.rb) + '</span>'
          + '<span class="mg-st-v">' + fMi(r.margem) + '</span>'
          + '<span class="mg-st-part">' + fPct(r._part) + '</span>'
          + '<span class="mg-st-p ' + cls(r.pct) + '">' + fPct(r.pct) + '</span>'
          + '</div>';
      }).join('');
  }

  // receita × margem por família (bolha = porte de receita)
  var _chartFam = null;
  function renderScatterFamilia(rows) {
    var el = document.getElementById('mg-an-fam-cv');
    if (!el || typeof Chart === 'undefined') return;
    var pts = (rows || []).filter(function (r) { return r.rb && r.pct != null; }).slice(0, 14);
    var maxRb = Math.max.apply(null, pts.map(function (p) { return p.rb; }).concat([1]));
    var dados = pts.map(function (p) {
      return { x: p.rb, y: p.pct, r: 6 + Math.sqrt((p.rb || 0) / maxRb) * 13, nome: nomeDim(p.nome) };
    });
    var cores = pts.map(function (p) { return barColor(p.pct); });
    var ys = pts.map(function (p) { return p.pct; });
    var yMin = (ys.length ? Math.min.apply(null, ys) : 0) - 8;
    var yMax = (ys.length ? Math.max.apply(null, ys) : 100) + 8;

    // nome da família acima da bolha: o plugin global do portal (script.js) só
    // rotula barra/linha, então aqui o rótulo é nosso
    var nomes = {
      id: 'mgFamNomes',
      afterDatasetsDraw: function (c) {
        var x = c.ctx, meta = c.getDatasetMeta(0);
        x.save();
        x.font = '700 9px "Roboto", system-ui, sans-serif';
        x.textAlign = 'center';
        meta.data.forEach(function (pt, i) {
          if (!dados[i]) return;
          var t = dados[i].nome, r = dados[i].r;
          x.lineWidth = 3; x.lineJoin = 'round'; x.strokeStyle = 'rgba(255,255,255,.92)';
          x.strokeText(t, pt.x, pt.y - r - 5);
          x.fillStyle = '#5F727A';
          x.fillText(t, pt.x, pt.y - r - 5);
        });
        x.restore();
      }
    };

    var data = {
      datasets: [{
        label: 'Família', data: dados,
        backgroundColor: cores.map(function (c) { return c + '4D'; }),
        borderColor: cores, borderWidth: 1.6, hoverBorderWidth: 2
      }]
    };
    var opts = {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 22, right: 16, left: 2 } },
      plugins: {
        legend: { display: false },
        bmValueLabels: false,
        tooltip: {
          callbacks: {
            label: function (c) {
              var d = c.raw || {};
              return (d.nome || '') + ' · ' + fMi(d.x) + ' · ' + fPct(d.y);
            }
          }
        }
      },
      scales: {
        x: { title: { display: true, text: 'RECEITA BRUTA →', color: '#97A8AE', font: { size: 9, weight: '800' } },
             grid: { color: '#F7FAFD' }, ticks: { display: false } },
        y: { min: yMin, max: yMax, grid: { color: '#F1F5F7' },
             ticks: { callback: function (v) { return Math.round(v) + '%'; }, font: { size: 10 }, color: '#97A8AE' } }
      }
    };
    if (_chartFam) { _chartFam.data = data; _chartFam.options = opts; _chartFam.update(); return; }
    _chartFam = new Chart(el.getContext('2d'), { type: 'bubble', data: data, options: opts, plugins: [nomes] });
  }

  // Excel do Top de produtos (a matriz tem o seu próprio, com todas as medidas)
  function exportarProdutos() {
    if (typeof XLSX === 'undefined' || !_anProd.length) return;
    var aoa = [['#', 'Cód. produto', 'Produto', 'Receita bruta', 'Margem R$', '% Margem']];
    _anProd.forEach(function (r, i) { aoa.push([i + 1, r.cod, r.nome, r.rb, r.margem, r.pct]); });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Top produtos');
    XLSX.writeFile(wb, 'margem-top-produtos-msb.xlsx');
  }

  // unidade de negócio de cada cliente do Top (a de maior receita do cliente)
  async function qUnidadeDoCliente(nomes) {
    var dCli = dimById('cliente'), dUni = dimById('unidade');
    if (!dCli || !dCli._ref || !dUni._ref || !nomes.length) return {};
    var filtro = 'TREATAS({ ' + nomes.map(function (n) { return '"' + avDax(n) + '"'; }).join(', ') + ' }, ' + dCli._ref + ')';
    var expr = 'ADDCOLUMNS(SUMMARIZE(' + FATO + ', ' + dCli._ref + ', ' + dUni._ref + '), ' + measExpr(['rb']) + ')';
    var rows = await q('EVALUATE ' + ct(expr, [filtro]));
    var melhor = {};
    rows.forEach(function (r) {
      var c = valorDim(r, dCli), u = valorDim(r, dUni), v = readMea(r, 'rb') || 0;
      if (c == null || u == null) return;
      if (!melhor[c] || v > melhor[c].v) melhor[c] = { u: u, v: v };
    });
    var out = {};
    Object.keys(melhor).forEach(function (k) { out[k] = melhor[k].u; });
    return out;
  }

  // duas dimensões no mesmo agrupamento (Top de produtos: código + descrição).
  // A ordenação final é em JS: TOPN já trouxe as 10 maiores.
  async function qNivelPar(dimA, dimB, ids, extra, top, sortKey) {
    if (!dimA || !dimA._ref || !dimB || !dimB._ref) return [];
    var expr = 'FILTER(ADDCOLUMNS(SUMMARIZE(' + FATO + ', ' + dimA._ref + ', ' + dimB._ref + '), '
      + measExpr(ids) + '), NOT ISBLANK([rb]) || NOT ISBLANK([mg]))';
    var sk = '[' + meaById(ids.indexOf(sortKey) >= 0 ? sortKey : 'rb').key + ']';
    var rows = await q('EVALUATE TOPN(' + (top || 200) + ', ' + ct(expr, extra) + ', ' + sk + ', DESC)');
    var out = rows.map(function (r) {
      var o = { cod: valorDim(r, dimA), nome: valorDim(r, dimB) };
      ids.forEach(function (id) { o[id] = readMea(r, id); });
      return o;
    });
    var k = ids.indexOf(sortKey) >= 0 ? sortKey : 'rb';
    return out.sort(function (a, b) { return (b[k] == null ? -1e18 : b[k]) - (a[k] == null ? -1e18 : a[k]); });
  }

  // dispara os painéis do Analítico. Cada um se resolve sozinho: uma dimensão
  // que falhe no modelo não derruba os outros painéis.
  function carregarAnalitico(meu, ehAtual) {
    var falha = function (id) {
      return function (e) {
        console.warn('[MARGEM] ' + id + ':', e.message);
        setHTML(id, '<div class="fx-empty">Indisponível: ' + escH(String(e.message).substring(0, 110)) + '</div>');
      };
    };
    var M = ['rb', 'margem', 'pct'];

    var OPT_CLI = { sub: true, dim: 'Cliente', subLabel: 'Unidade' };
    qNivel(dimById('cliente'), M, [], AN_CLI_TOP, 'margem').then(function (all) {
      if (!ehAtual(meu)) return;
      // o TOPN já corta no DAX; o slice é cinto e suspensório para a altura do
      // painel não depender do que o modelo devolver
      var rs = all.slice(0, AN_CLI_TOP);
      _anCli = rs;
      renderRank('mg-an-cli', rs, OPT_CLI);
      setTxt('mg-an-cli-hint', 'Top ' + rs.length + ' por margem R$');
      return qUnidadeDoCliente(rs.map(function (r) { return r.nome; })).then(function (mapa) {
        if (!ehAtual(meu)) return;
        rs.forEach(function (r) { r.sub = mapa[r.nome] || ''; });
        renderRank('mg-an-cli', rs, OPT_CLI);
      }).catch(function (e) { console.warn('[MARGEM] unidade do cliente:', e.message); });
    }).catch(falha('mg-an-cli'));

    qNivel(dimById('familia'), M, [], 120).then(function (rs) {
      if (!ehAtual(meu)) return;
      var lista = rs.slice(0, AN_FAM_TOP);
      renderBarList('mg-an-fam', lista, 'Família');
      setTxt('mg-an-fam-hint', 'Top ' + lista.length + ' por receita');
      renderScatterFamilia(rs);
    }).catch(falha('mg-an-fam'));

    qNivel(dimById('tipocli'), M, [], 30).then(function (rs) {
      if (!ehAtual(meu)) return;
      renderBarList('mg-an-tipo', rs.slice(0, AN_TIPO_TOP), 'Tipo de cliente');
    }).catch(falha('mg-an-tipo'));

    qNivel(dimById('estrategia'), M, [], 20).then(function (rs) {
      if (!ehAtual(meu)) return;
      renderEstrategia(rs);
    }).catch(falha('mg-an-estr-rows'));

    qNivelPar(dimById('codproduto'), dimById('produto'), M, [], AN_PROD_TOP, 'margem').then(function (rs) {
      if (!ehAtual(meu)) return;
      _anProd = rs.slice(0, AN_PROD_TOP);
      renderRank('mg-an-prod', _anProd, { two: true, dim: 'Produto' });
      setTxt('mg-an-prod-sub', 'Top ' + _anProd.length + ' por margem R$ · barra = receita bruta relativa');
    }).catch(falha('mg-an-prod'));
  }

  /* ============================================================
     10. TABELA (matriz + tabular) — usada nas 3 visões
     ============================================================ */
  var _dims = [];            // ids das dimensões visíveis, na ordem
  var _meas = [];            // ids das medidas visíveis, na ordem
  var _mode = 'matriz';
  // _paths guarda o caminho do drill; _rowData guarda a LINHA CRUA de cada <tr>
  // (o Excel exporta o número do modelo, não o texto formatado da tela)
  var _pathSeq = 0, _paths = {}, _rowData = {};
  var _lastRows = [], _lastTotal = null;
  var PIN = (VIEW === 'nf') ? 'nf' : null;   // dimensão que não pode sair

  var selDims = function () { return _dims.map(dimById).filter(function (d) { return d && d._ref; }); };
  var selMeas = function () { return _meas.map(meaById).filter(Boolean); };

  function thead() {
    var ds = selDims(), ms = selMeas();
    var titulo = _mode === 'matriz'
      ? (ds.length ? ds.map(function (d) { return d.label; }).join(' › ') : 'Dimensão')
      : null;
    var h = '<tr>';
    if (_mode === 'matriz') h += '<th class="dim">' + escH(titulo) + '</th>';
    else h += ds.map(function (d) { return '<th class="dim">' + escH(d.label) + '</th>'; }).join('');
    h += ms.map(function (m) { return '<th' + (m.fmt === 'txt' ? ' class="txt"' : '') + '>' + escH(m.label) + '</th>'; }).join('') + '</tr>';
    return h;
  }
  function cells(o, total) {
    return selMeas().map(function (m) {
      var v = o[m.id], extra = '';
      if (m.fmt === 'pct' || m.fmt === 'nota') extra = ' ' + cls(o.pct);
      // código não soma: no TOTAL a célula de texto fica vazia
      if (total && m.fmt === 'txt') return '<td class="txt">—</td>';
      return '<td class="' + tdClass(m) + extra + '">' + fmtMea(m, v) + '</td>';
    }).join('');
  }
  function rowMatriz(o, level, path) {
    var ds = selDims();
    var pode = level < ds.length - 1;
    var idx = _pathSeq++; _paths[idx] = path; _rowData[idx] = o;
    var tg = pode ? '<span class="mg-tg">▶</span>' : '<span style="display:inline-block;width:14px;"></span>';
    return '<tr class="mg-mrow" data-level="' + level + '" data-pathidx="' + idx + '">'
      + '<td class="dim" style="padding-left:' + (14 + level * 18) + 'px;">' + tg + ' ' + escH(o.nome == null ? '—' : o.nome) + '</td>'
      + cells(o) + '</tr>';
  }
  function rowTotal(t) {
    var ds = selDims(), ncols = _mode === 'matriz' ? 1 : ds.length;
    var td = '<td class="dim">TOTAL</td>' + (ncols > 1 ? '<td></td>'.repeat(ncols - 1) : '');
    return '<tr class="mg-total">' + td + cells(t, true) + '</tr>';
  }
  function cardsMobile(rows, t) {
    var ms = selMeas();
    var card = function (o, total) {
      return '<div class="mg-card' + (total ? ' total' : '') + '">'
        + '<div class="mg-card-t"><div class="mg-card-n">' + escH(total ? 'TOTAL' : (o.nome == null ? '—' : o.nome)) + '</div>'
        + '<div class="mg-card-p ' + cls(o.pct) + '">' + (o.pct == null ? '—' : fPct(o.pct)) + '</div></div>'
        + '<div class="mg-card-g">' + ms.filter(function (m) { return m.fmt !== 'pct'; }).map(function (m) {
          return '<div><span class="l">' + escH(m.label) + '</span><span class="v">' + fmtMea(m, o[m.id]) + '</span></div>';
        }).join('') + '</div></div>';
    };
    return rows.map(function (o) { return card(o, false); }).join('') + (t ? card(t, true) : '');
  }

  async function renderTabela(totalPronto) {
    var thEl = document.getElementById('mg-thead'), tbEl = document.getElementById('mg-tbody');
    if (!thEl || !tbEl) return;
    var ds = selDims(), ms = selMeas();
    var ncol = (_mode === 'matriz' ? 1 : ds.length) + ms.length;
    thEl.innerHTML = thead();
    if (!ds.length || !ms.length) {
      tbEl.innerHTML = '<tr><td colspan="' + Math.max(ncol, 2) + '" style="text-align:center;color:#97A8AE;padding:20px;">Selecione ao menos um campo e uma medida.</td></tr>';
      setHTML('mg-cards', ''); setTxt('mg-tbl-info', '—');
      return;
    }
    tbEl.innerHTML = '<tr><td colspan="' + ncol + '" style="text-align:center;color:#97A8AE;padding:20px;">Carregando…</td></tr>';
    _pathSeq = 0; _paths = {}; _rowData = {};
    try {
      var ids = _meas.slice();
      if (ids.indexOf('rb') < 0) ids.push('rb');       // usada na ordenação
      if (ids.indexOf('margem') < 0) ids.push('margem');
      var rows, total = totalPronto && ms.every(function (m) { return m.id in totalPronto; }) ? totalPronto : await qTotais(_meas);
      if (_mode === 'matriz') {
        rows = await qNivel(ds[0], ids, [], 3000);
        _lastRows = rows; _lastTotal = total;
        tbEl.innerHTML = rows.length
          ? rows.map(function (r) { return rowMatriz(r, 0, [{ dim: ds[0], value: r.nome }]); }).join('') + rowTotal(total)
          : '<tr><td colspan="' + ncol + '" style="text-align:center;color:#97A8AE;padding:20px;">Sem dados no período.</td></tr>';
        setTxt('mg-tbl-info', rows.length + ' ' + (rows.length === 1 ? 'linha' : 'linhas') + ' no 1º nível');
      } else {
        var expr = 'FILTER(ADDCOLUMNS(SUMMARIZE(' + FATO + ', ' + ds.map(function (d) { return d._ref; }).join(', ') + '), '
          + measExpr(ids) + '), NOT ISBLANK([rb]) || NOT ISBLANK([mg]))';
        var raw = await q('EVALUATE TOPN(5000, ' + ct(expr) + ', [rb], DESC)\nORDER BY [rb] DESC');
        rows = raw.map(function (r) {
          var o = { _dims: ds.map(function (d) { return valorDim(r, d); }) };
          ids.forEach(function (id) { o[id] = readMea(r, id); });
          o.nome = o._dims.join(' · ');
          return o;
        });
        _lastRows = rows; _lastTotal = total;
        tbEl.innerHTML = rows.length
          ? rows.map(function (o) { return '<tr>' + o._dims.map(function (v) { return '<td class="dim">' + escH(v == null || v === '' ? '—' : v) + '</td>'; }).join('') + cells(o) + '</tr>'; }).join('') + rowTotal(total)
          : '<tr><td colspan="' + ncol + '" style="text-align:center;color:#97A8AE;padding:20px;">Sem dados no período.</td></tr>';
        setTxt('mg-tbl-info', rows.length + ' ' + (rows.length === 1 ? 'linha' : 'linhas') + (rows.length >= 5000 ? ' (limite de 5.000)' : ''));
      }
      setHTML('mg-cards', cardsMobile(_lastRows.slice(0, 60), total));
    } catch (e) {
      console.error('[MARGEM] tabela:', e.message);
      tbEl.innerHTML = '<tr><td colspan="' + ncol + '" style="text-align:center;color:#B54545;padding:20px;">Erro: ' + escH(e.message.substring(0, 200)) + '</td></tr>';
    }
  }

  // drill-down da matriz
  document.addEventListener('click', async function (ev) {
    var tg = ev.target.closest && ev.target.closest('.mg-tg'); if (!tg) return;
    var tr = tg.closest('tr'); if (!tr || !tr.classList.contains('mg-mrow')) return;
    var ds = selDims(), level = +tr.dataset.level;
    if (tr.classList.contains('open')) {
      var n = tr.nextElementSibling;
      while (n && n.dataset && n.dataset.level != null && +n.dataset.level > level) { var nx = n.nextElementSibling; n.remove(); n = nx; }
      tr.classList.remove('open'); tg.textContent = '▶'; return;
    }
    if (level >= ds.length - 1) return;
    tg.textContent = '…';
    var path = _paths[+tr.dataset.pathidx] || [];
    var extra = path.map(function (p) { return pathFilter(p.dim, p.value); }).filter(Boolean);
    var ids = _meas.slice();
    if (ids.indexOf('rb') < 0) ids.push('rb');
    if (ids.indexOf('margem') < 0) ids.push('margem');
    var filhos = [];
    try { filhos = await qNivel(ds[level + 1], ids, extra, 3000); }
    catch (e) { console.error('[MARGEM] drill:', e.message); tg.textContent = '▶'; return; }
    tg.textContent = '▼'; tr.classList.add('open');
    tr.insertAdjacentHTML('afterend', filhos.map(function (c) {
      return rowMatriz(c, level + 1, path.concat({ dim: ds[level + 1], value: c.nome }));
    }).join(''));
  });

  // Excel (.xlsx quando a lib carrega; .csv pt-BR como reserva).
  // Na MATRIZ exporta o que está na tela — inclusive os níveis já abertos —
  // lendo o DOM: os filhos do drill não vivem em _lastRows.
  function exportar() {
    var ds = selDims(), ms = selMeas();
    if (!_lastRows.length) return;
    var heads = (_mode === 'matriz' ? [ds.map(function (d) { return d.label; }).join(' › ')] : ds.map(function (d) { return d.label; }))
      .concat(ms.map(function (m) { return m.label; }));
    var num = function (o, m) {
      var v = o[m.id];
      if (v == null) return null;
      if (m.fmt === 'txt') return String(v);        // '000' não pode virar 0
      return m.ded ? Math.abs(Number(v)) : Number(v);
    };
    var aoa = [heads];
    if (_mode === 'matriz') {
      // percorre o DOM só para saber QUAIS linhas estão na tela (inclui os
      // níveis abertos); os NÚMEROS saem de _rowData, não do texto formatado.
      var tb = document.getElementById('mg-tbody'), caminho = [];
      (tb ? tb.querySelectorAll('tr.mg-mrow, tr.mg-total') : []).forEach(function (tr) {
        if (tr.classList.contains('mg-total')) {
          if (_lastTotal) aoa.push(['TOTAL'].concat(ms.map(function (m) { return num(_lastTotal, m); })));
          return;
        }
        var o = _rowData[+tr.dataset.pathidx]; if (!o) return;
        var nivel = +tr.dataset.level;
        caminho[nivel] = o.nome == null ? '' : String(o.nome); caminho.length = nivel + 1;
        aoa.push([caminho.join(' › ')].concat(ms.map(function (m) { return num(o, m); })));
      });
    } else {
      _lastRows.forEach(function (o) {
        aoa.push((o._dims || []).map(function (v) { return v == null ? '' : String(v); }).concat(ms.map(function (m) { return num(o, m); })));
      });
      if (_lastTotal) {
        var dimsTotal = ['TOTAL'];
        while (dimsTotal.length < ds.length) dimsTotal.push('');
        aoa.push(dimsTotal.concat(ms.map(function (m) { return num(_lastTotal, m); })));
      }
    }
    var nome = 'margem_contribuicao_msb_' + VIEW + '_' + _mode;
    if (typeof XLSX !== 'undefined') {
      var ws = XLSX.utils.aoa_to_sheet(aoa), wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Margem');
      XLSX.writeFile(wb, nome + '.xlsx');
      return;
    }
    var cel = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var numCsv = function (v) { return v == null ? '' : String(v).replace('.', ','); };
    var csv = aoa.map(function (r, i) {
      var nDim = _mode === 'matriz' ? 1 : ds.length;
      return r.map(function (c, j) {
        var mm = ms[j - nDim];
        return (i === 0 || j < nDim || (mm && mm.fmt === 'txt')) ? cel(c) : numCsv(c);
      }).join(';');
    }).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function montarToolbarTabela() {
    var host = document.getElementById('mg-tbl-tools'); if (!host) return;
    host.innerHTML = '';
    if (VIEW !== 'geral') {
      var seg = document.createElement('div'); seg.className = 'mg-seg';
      [['matriz', 'Matriz'], ['tabular', 'Tabular']].forEach(function (p) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = p[1];
        b.classList.toggle('active', _mode === p[0]);
        b.addEventListener('click', function () { _mode = p[0]; montarToolbarTabela(); renderTabela(); });
        seg.appendChild(b);
      });
      host.appendChild(seg);
    }
    var excel = document.createElement('button');
    excel.className = 'mg-tbtn excel'; excel.type = 'button';
    excel.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>Excel';
    excel.addEventListener('click', exportar);
    host.appendChild(excel);
    host.appendChild(makeDropdown({
      label: 'Campos',
      getOptions: function () {
        return Promise.resolve(DIMS.filter(function (d) { return d._ref; }).map(function (d) { return { value: d.id, label: d.label }; }));
      },
      getSelected: function () { return _dims.slice(); },
      setSelected: function (id, ck, clr) {
        if (clr) { _dims = PIN ? [PIN] : []; return; }
        if (id === PIN && !ck) return;                       // a NF fica fixa
        var i = _dims.indexOf(id);
        if (ck) { if (i < 0) { _dims.push(id); _dims.sort(function (a, b) { return ordemDim(a) - ordemDim(b); }); } }
        else if (i >= 0) _dims.splice(i, 1);
      },
      onChange: renderTabela
    }));
    if (VIEW !== 'geral') {
      host.appendChild(makeDropdown({
        label: 'Medidas',
        getOptions: function () { return Promise.resolve(MEAS.map(function (m) { return { value: m.id, label: m.label }; })); },
        getSelected: function () { return _meas.slice(); },
        setSelected: function (id, ck, clr) {
          if (clr) { _meas = ['rb', 'margem', 'pct']; return; }
          var i = _meas.indexOf(id);
          if (ck) { if (i < 0) { _meas.push(id); _meas.sort(function (a, b) { return ordemMea(a) - ordemMea(b); }); } }
          else if (i >= 0) _meas.splice(i, 1);
        },
        onChange: renderTabela
      }));
    }
  }
  // A NF não é mais forçada para a 1ª coluna: ela tem posição própria na ordem
  // pedida pelo negócio (PIN só impede DESMARCAR o campo).
  function ordemDim(id) { var i = DIMS.findIndex(function (d) { return d.id === id; }); return i < 0 ? 999 : i; }
  function ordemMea(id) {
    if (VIEW === 'nf') { var k = NF_MEAS.indexOf(id); if (k >= 0) return k; return 900 + MEAS.findIndex(function (m) { return m.id === id; }); }
    return MEAS.findIndex(function (m) { return m.id === id; });
  }

  /* ============================================================
     11. APLICAR (recarrega a visão inteira)
     ============================================================ */
  // Abertura da aba por NF: TODOS os campos e medidas da lista do negócio, na
  // ordem pedida. Quem o catálogo do modelo não confirmou fica FORA da abertura
  // (um nome errado derruba a query inteira, não só a coluna) e é listado no
  // banner — o campo continua disponível em Campos/Medidas para tentar à mão.
  function defaultsNF() {
    var faltando = [];
    _dims = NF_DIMS.filter(function (id) {
      var d = dimById(id);
      if (d && d._ok && d._ref) return true;
      faltando.push((d && d.label) || id); return false;
    });
    _meas = NF_MEAS.filter(function (id) {
      var m = meaById(id);
      if (m && m._ok && m._ref) return true;
      faltando.push((m && m.label) || id); return false;
    });
    if (!_dims.length) _dims = ['nf'];                 // a aba precisa de ao menos a NF
    if (!_meas.length) _meas = MEAS_ANALITICO.slice();
    _nfFaltando = faltando;
    if (faltando.length) console.warn('[MARGEM] fora da abertura por NF (não confirmados no modelo):', faltando.join(', '));
  }
  var _nfFaltando = [];

  // [Margem Percentual] pode vir em FRAÇÃO (0,6027) ou já em % (60,27) — o
  // modelo tem os dois estilos. Descobre a escala UMA vez comparando com a
  // medida que a página já conhece ([Margem de contribuição (%)], que vem em
  // fração e é ×100 aqui): razão ~100 entre as duas = a nova vem em fração.
  var _pctmCal = false;
  function calibrarPctm(t) {
    if (_pctmCal || !t) return;
    var m = meaById('pctm'); if (!m) return;
    var ref = t.pct, bruto = t.pctm;
    if (ref == null || bruto == null || bruto === 0) return;
    var razao = ref / bruto;
    if (razao > 50 && razao < 200) { m.x100 = true; t.pctm = bruto * 100; }
    _pctmCal = true;
  }

  var _pend = 0;
  async function aplicar() {
    if (!_ready) return;
    var meu = ++_pend;
    periodoLabel();
    try {
      var t = await qTotais(_meas);
      if (meu !== _pend) return;
      calibrarPctm(t);
      renderKpis(t);
      if (VIEW === 'geral') {
        renderHero(t); renderResumo(t); renderCascata(t);
        qTributos().then(function (tr) { if (meu === _pend) renderTributos(tr, t); })
          .catch(function (e) { console.warn('[MARGEM] tributos:', e.message); });
        qEvolucao().then(function (p) {
          if (meu !== _pend) return;
          _mesesComDados = p.map(function (x) { return x.mesLbl; });
          setTxt('mg-hero-pill', pillPeriodo());
          renderEvolucao(p);
        }).catch(function (e) {
          console.warn('[MARGEM] evolução:', e.message);
          setHTML('mg-chart', '<div class="fx-empty">Evolução indisponível: ' + escH(e.message.substring(0, 120)) + '</div>');
        });
        qNivel(dimById('unidade'), ['rb', 'margem', 'pct', 'nota'], [], 200)
          .then(function (r) { if (meu === _pend) renderFiliais(r); })
          .catch(function (e) { console.warn('[MARGEM] filiais:', e.message); setHTML('mg-fil', '<div class="fx-empty">Indisponível: ' + escH(e.message.substring(0, 120)) + '</div>'); });
      }
      if (VIEW === 'analitico') carregarAnalitico(meu, function (n) { return n === _pend; });
      renderTabela(t);
    } catch (e) {
      console.error('[MARGEM] aplicar:', e.message);
      banner('err', IC_ERR + ' ' + escH(e.message.substring(0, 220)));
    }
  }
  window.mgAplicar = aplicar;

  /* ============================================================
     12. BOOT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', async function () {
    // defaults da visão
    if (VIEW === 'geral') { _dims = ['unidade']; _meas = MEAS_DEFAULT.slice(); _mode = 'matriz'; }
    else if (VIEW === 'nf') { _dims = ['nf']; _meas = MEAS_ANALITICO.slice(); _mode = 'tabular'; }
    else { _dims = ['unidade', 'estrategia', 'familia']; _meas = MEAS_ANALITICO.slice(); _mode = 'matriz'; }

    montarFiltros(); montarPeriodo(); montarToolbarTabela();
    var bx = document.getElementById('mg-an-prod-xls');
    if (bx) bx.addEventListener('click', exportarProdutos);
    banner('', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Conectando ao Power BI…');
    try {
      await pbiConnect();
      await pbiDataset();
      await carregarCatalogo();
      if (VIEW === 'nf') defaultsNF();     // precisa do catálogo para saber o que existe
      await carregarPeriodoOpcoes();
      montarPeriodo(); montarFiltros(); montarToolbarTabela();
      _ready = true;
      bannerConectado();
      await aplicar();
    } catch (err) {
      console.error('[MARGEM] boot:', err);
      banner('err', IC_ERR + ' ' + escH(String(err && err.message || err).substring(0, 240)));
    }
  });
})();
