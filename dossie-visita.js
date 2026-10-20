// ================================================================
// dossie-visita.js — Dossiê de Visita (Comercial) · front
//
// O vendedor digita o CNPJ; a página lê o modelo do Comercial (Sales Report +
// Cirurgias) com o token MSAL DELE (RLS do serviço), chama /api/dossie-cliente
// (Conta do Salesforce + status na carteira) e monta o dossiê com o motor
// puro dossie-motor.js. Nada é escrito em lugar nenhum.
//
// Regras herdadas das páginas irmãs (ver docs/dossie-visita-chaves.md):
//  • grafia das colunas resolvida no boot por INFO.VIEW.COLUMNS/MEASURES
//    (cands em ordem de preferência; ausente = seção em cinza, nunca tela branca);
//  • filtro-base do Sales Report em toda consulta ao fato Faturamentos;
//  • ≤ 6 consultas por cliente (limite de 120/min por usuário; pbi-throttle.js
//    faz cache de 3 min por DAX);
//  • cada fonte falha SOZINHA (Promise.allSettled) — cartão cinza com o motivo;
//  • esperaAuth() antes da 1ª chamada a /api (corrida do auth.js).
// ================================================================
(function () {
  'use strict';

  const PBI_CFG = {
    clientId:    '129978ce-ff3b-431d-98b3-66a1bcb766b1',
    tenantId:    'c311c9e6-6017-42a9-b306-4057beba5786',
    workspaceId: '8535f0a1-8dc6-4da0-93ce-bf20c1c14e27',
    reportId:    '10a505aa-759e-4f20-a130-98c0736ba42d',
    scopes:      ['https://analysis.windows.net/powerbi/api/Dataset.Read.All',
                  'https://analysis.windows.net/powerbi/api/Report.Read.All']
  };
  const NF_OCULTAS = ['667708'];
  const API_CLIENTE = '/api/dossie-cliente';
  const API_GANCHOS = '/api/dossie-ganchos';
  const API_AGENDA  = '/api/dossie-agenda';
  const M = window.DossieMotor;

  // ── os 4 modelos que o dossiê lê (docs/dossie-visita-chaves.md) ──
  // Todos no mesmo workspace e com o mesmo token; o que muda é como se
  // resolve o dataset e a convenção de nomes das tabelas.
  const MODELOS = {
    comercial:  { id:'comercial',  nome:'Comercial',     reportId:'10a505aa-759e-4f20-a130-98c0736ba42d' },
    consig:     { id:'consig',     nome:'Consignação',   datasetId:'960d8415-9844-40aa-a502-07a8b3eea240' },
    oport:      { id:'oport',      nome:'Oportunidades', datasetId:'a34b4911-4bd9-4891-b87c-1e624f3d9c8a' },
    licitacao:  { id:'licitacao',  nome:'Licitação',
                  cands:['73c25a9b-dcd5-4740-b6e3-bdc72092b0da','6541bd87-b045-4689-b5a7-6b6ba2feda4a'],
                  sonda:'EVALUATE ROW("t", [Valor faturado mês])' }
  };

  // ── campos do modelo (grafia resolvida no boot) ──────────────────
  //  ess = essencial: sem ele a seção não roda; opt = entra se existir
  const F = {
    // Clientes (Q0)
    cnpj:    { h:'CNPJ',              kind:'col', ess:true,  cands:[['Clientes','CNPJ'],['Clientes','CNPJ/CPF'],['Clientes','CNPJ do cliente']] },
    codcli:  { h:'Cód. Cliente',      kind:'col', ess:true,  cands:[['Clientes','Cód. Cliente'],['Clientes','Cod. Cliente'],['Clientes','Código do cliente'],['Clientes','Cód. do Cliente']] },
    cliente: { h:'Cliente',           kind:'col', ess:true,  cands:[['Clientes','Cliente']] },
    conta:   { h:'Conta',             kind:'col', opt:true,  cands:[['Clientes','Conta']] },
    cidade:  { h:'Cidade',            kind:'col', opt:true,  cands:[['Clientes','Cidade']] },
    uf:      { h:'Cód. Estado',       kind:'col', opt:true,  cands:[['Clientes','Cód. Estado'],['Clientes','Cod. Estado']] },
    tipocli: { h:'Tipo de cliente',   kind:'col', opt:true,  cands:[['Clientes','Tipo de cliente (Revisado)'],['Clientes','Tipo de cliente']] },
    grupo:   { h:'Grupo de clientes', kind:'col', opt:true,  cands:[['Clientes','Grupo de clientes']] },
    // Faturamentos (Q1/Q2/Q3)
    fatCol:  { h:'Faturamento',       kind:'col', ess:true,  cands:[['Faturamentos','Faturamento']] },
    nfCol:   { h:'Número da fatura',  kind:'col', opt:true,  cands:[['Faturamentos','Número da fatura'],['Faturamentos','Numero da fatura']] },
    calData: { h:'Data (calendário)', kind:'col', ess:true,  cands:[['Calendário','Data'],['Calendario','Data']] },
    calAno:  { h:'Ano',               kind:'col', ess:true,  cands:[['Calendário','Ano'],['Calendario','Ano']] },
    calMes:  { h:'Nº do mês',         kind:'col', ess:true,  cands:[['Calendário','Nº do mês'],['Calendário','N° do mês'],['Calendario','No do mes'],['Calendário','Número do mês'],['Calendário','Mês (nome abreviado)'],['Calendário','Mês (nome)'],['Calendário','Mês']] },
    familia: { h:'Família',           kind:'col', ess:true,  cands:[['Famílias','Família'],['Familias','Familia']] },
    codprod: { h:'Cód. produto',      kind:'col', opt:true,  cands:[['Produtos','Cód. produto'],['Produtos','Cod. produto'],['Produtos','Código do produto']] },
    produto: { h:'Produto',           kind:'col', opt:true,  cands:[['Produtos','Produto']] },
    unidade: { h:'Unidade de Negócio',kind:'col', opt:true,  cands:[['DIM_UNIDADE_DE_NEGOCIO_V2','UNIDADE_DE_NEGOCIO']] },
    geraFat: { h:'Gera Fatura a receber?', kind:'col', opt:true, cands:[['Operações','Gera Fatura a receber?'],['Operacoes','Gera Fatura a receber?']] },
    qtd:     { h:'Faturamento (quantidade)', kind:'mea', opt:true, cands:['Faturamento (quantidade)'] },
    // Cirurgias (Q7)
    cirData: { h:'DATA_CIRURGIA',     kind:'col', ess:true,  cands:[['Cirurgias_Agrupadas','DATA_CIRURGIA'],['Cirurgias_Agrupadas','Data da cirurgia']] },
    cirFase: { h:'Fase',              kind:'col', ess:true,  cands:[['Cirurgias_Agrupadas','Fase']] },
    cirItens:{ h:'ItensConcatenados', kind:'col', ess:true,  cands:[['Cirurgias_Agrupadas','ItensConcatenados']] },
    cirPreco:{ h:'PrecoTotal',        kind:'col', ess:true,  cands:[['Cirurgias_Agrupadas','PrecoTotal'],['Cirurgias_Agrupadas','Preco Total'],['Cirurgias_Agrupadas','Preço Total']] },
    cirNome: { h:'Nome',              kind:'col', opt:true,  cands:[['Cirurgias_Agrupadas','Nome']] },
    medico:  { h:'Médico',            kind:'col', opt:true,  cands:[['Médicos','Médico'],['Medicos','Medico']] },
    vend:    { h:'Vendedor',          kind:'col', opt:true,  cands:[['Vendedores','Vendedor']] },
    inter:   { h:'É intercompany?',   kind:'col', opt:true,  cands:[['Faturamentos','É intercompany?'],['Faturamentos','E intercompany?'],['Faturamentos','É intercompany'],['Faturamentos','É Intercompany?']] }
  };
  const FASES_CIR = M.FASES_CIR;

  // ── FASE 2 · campos do modelo de CONSIGNAÇÃO (estoque-saldo-consignado) ──
  const FC = {
    codcli:  { h:'Cód. do Cliente',  kind:'col', ess:true,  cands:[['Clientes','Cód. do Cliente'],['Clientes','Cód. Cliente'],['Clientes','Cód. do cliente'],['Clientes','Código do cliente']] },
    cliente: { h:'Cliente',          kind:'col', opt:true,  cands:[['Clientes','Cliente']] },
    nota:    { h:'Nota fiscal',      kind:'col', ess:true,  cands:[['Consignação - Remessas','Nota fiscal'],['Consignação - Remessas','Nota Fiscal']] },
    datamov: { h:'Data do movimento',kind:'col', ess:true,  cands:[['Consignação - Remessas','Data do movimento']] },
    codprod: { h:'Cód. do produto',  kind:'col', opt:true,  cands:[['Produtos','Cód. do produto'],['Produtos','Cód. produto'],['Produtos','Código do produto']] },
    produto: { h:'Produto',          kind:'col', opt:true,  cands:[['Produtos','Produto']] },
    lote:    { h:'Lote',             kind:'col', opt:true,  cands:[['Lotes','Lote']] },
    datavenc:{ h:'Data de vencimento',kind:'col',opt:true,  cands:[['Lotes','Data de vencimento'],['Lotes','Data de vencimento (tratada)']] },
    // filtros fixos do visual "Saldo por nota" (lista ditada pelo dono em 20/08;
    // NÃO incluir o filtro das 7 operações — ele zera a medida do saldo)
    modelo:  { h:'Nota fiscal (modelo)', kind:'col', opt:true, cands:[['Consignação - Remessas','Nota fiscal (modelo)'],['Consignação - Remessas','Nota fiscal modelo']] },
    statusnf:{ h:'Nota fiscal (status)', kind:'col', opt:true, cands:[['Consignação - Remessas','Nota fiscal (status)'],['Consignação - Remessas','Nota fiscal status']] },
    grupodep:{ h:'Grupo de depósitos',   kind:'col', opt:true, cands:[['Depósitos','Grupo de depósitos'],['Depósitos','Grupo de depósito'],['Depósitos','Grupo depósitos']] },
    exibir:  { h:'Exibir no BI',         kind:'col', opt:true, cands:[['Consignação - Remessas','Exibir no BI']] },
    saldo:   { h:'Consignado - Saldo de remessas',         kind:'mea', ess:true, cands:['Consignado - Saldo de remessas'] },
    custo:   { h:'Consignado - Saldo de remessas (custo)', kind:'mea', opt:true, cands:['Consignado - Saldo de remessas (custo)'] },
    aguard:  { h:'Aguardando faturamento',                 kind:'mea', opt:true, cands:['Aguardando faturamento'] }
  };

  // ── FASE 2 · campos do modelo de OPORTUNIDADES (caixa alta, sem acento) ──
  const FO = {
    codcli:  { h:'CODIGO_CLIENTE_FORNECEDOR', kind:'col', ess:true, cands:[['DIM_CLIENTES','CODIGO_CLIENTE_FORNECEDOR']] },
    cliente: { h:'CLIENTE_FORNECEDOR', kind:'col', opt:true, cands:[['DIM_CLIENTES','CLIENTE_FORNECEDOR']] },
    tipo:    { h:'TIPO_DE_REGISTRO',   kind:'col', ess:true, cands:[['FAT_OPORTUNIDADES_COTACOES','TIPO_DE_REGISTRO']] },
    fase:    { h:'FASE',               kind:'col', ess:true, cands:[['FAT_OPORTUNIDADES_COTACOES','FASE']] },
    nome:    { h:'NOME',               kind:'col', opt:true, cands:[['FAT_OPORTUNIDADES_COTACOES','NOME']] },
    criacao: { h:'DATA_DE_CRIACAO',    kind:'col', opt:true, cands:[['FAT_OPORTUNIDADES_COTACOES','DATA_DE_CRIACAO']] },
    cirurgia:{ h:'DATA_CIRURGIA',      kind:'col', opt:true, cands:[['FAT_OPORTUNIDADES_COTACOES','DATA_CIRURGIA']] },
    vend:    { h:'VENDEDOR',           kind:'col', opt:true, cands:[['DIM_VENDEDORES','VENDEDOR']] },
    familia: { h:'FAMILIA',            kind:'col', opt:true, cands:[['DIM_FAMILIAS','FAMILIA']] },
    valor:   { h:'Preco total oportunidades', kind:'mea', ess:true, cands:['Preco total oportunidades'] },
    qtd:     { h:'quantidade oportunidades',  kind:'mea', opt:true, cands:['quantidade oportunidades'] }
  };
  const FASES_FECHADAS = ['Fechado e ganho', 'Fechado e perdido', 'Finalizado pelo sistema'];

  // ── FASE 2 · campos do modelo da LICITAÇÃO (Análise de Contratos) ──
  const FL = {
    codcli:  { h:'Código do cliente', kind:'col', ess:true, cands:[['Clientes','Código do cliente'],['Clientes','Codigo do cliente'],['Clientes','Cód. Cliente']] },
    cliente: { h:'Cliente',           kind:'col', opt:true, cands:[['Clientes','Cliente']] },
    opor:    { h:'Nome da oportunidade', kind:'col', ess:true, cands:[['Licitações','Nome da oportunidade'],['Licitacoes','Nome da oportunidade']] },
    vig:     { h:'Vigência do Contrato', kind:'col', ess:true, cands:[['Licitações','Vigência do Contrato'],['Licitacoes','Vigencia do Contrato']] },
    ini:     { h:'Início do contrato',   kind:'col', opt:true, cands:[['Licitações','Início do contrato'],['Licitacoes','Inicio do contrato']] },
    cprod:   { h:'Código do produto',    kind:'col', opt:true, cands:[['Produtos','Código do produto'],['Produtos','Codigo do produto']] },
    prod:    { h:'Produto',              kind:'col', opt:true, cands:[['Produtos','Produto']] },
    familia: { h:'Família',              kind:'col', opt:true, cands:[['Famílias','Família'],['Familias','Familia']] },
    vitem:   { h:'Valor do item',        kind:'col', ess:true, cands:[['Licitações','Valor do item'],['Licitacoes','Valor do item']] },
    // fixos da Análise de Contratos (os literais são LIDOS do modelo no boot)
    sinc:    { h:'Proposta sincronizada', kind:'col', opt:true, cands:[['Licitações','Proposta sincronizada'],['Licitacoes','Proposta sincronizada']] },
    res:     { h:'Resultado do item',     kind:'col', opt:true, cands:[['Licitações','Resultado do item'],['Licitacoes','Resultado do item']] },
    sta:     { h:'Status da proposta',    kind:'col', opt:true, cands:[['Licitações','Status da proposta'],['Licitacoes','Status da proposta']] },
    faseop:  { h:'Fase da oportunidade',  kind:'col', opt:true, cands:[['Licitações','Fase da oportunidade'],['Licitacoes','Fase da oportunidade'],['Licitações','Fase']] },
    mfat:    { h:'Valor faturado',        kind:'mea', opt:true, cands:['Valor faturado','Valor faturado mês','Valor faturado mes'] },
    mabe:    { h:'Valor em aberto dashboard', kind:'mea', ess:true, cands:['Valor em aberto dashboard','Valor em aberto (dashboard)','Valor em aberto'] }
  };

  // ── helpers ─────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const daxS = s => String(s == null ? '' : s).replace(/"/g, '""');
  const _norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const n0 = x => (x == null ? 0 : Number(x)) || 0;
  const brl = v => 'R$ ' + n0(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const brl0 = v => 'R$ ' + Math.round(n0(v)).toLocaleString('pt-BR');
  const int = v => n0(v).toLocaleString('pt-BR',{maximumFractionDigits:0});
  const pct = v => (v == null || !isFinite(v)) ? '—' : (v >= 0 ? '+' : '') + (v*100).toLocaleString('pt-BR',{maximumFractionDigits:1}) + '%';
  const dataBR = s => !s ? '—' : (String(s).slice(8,10) + '/' + String(s).slice(5,7) + '/' + String(s).slice(0,4));
  const MES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const mesAno = (am) => MES[am.mes-1] + '/' + String(am.ano).slice(2);
  const cnpjFmt = d => d.length === 14 ? d.slice(0,2)+'.'+d.slice(2,5)+'.'+d.slice(5,8)+'/'+d.slice(8,12)+'-'+d.slice(12) : d;
  const soDigitos = s => String(s || '').replace(/\D/g, '');
  const _v = (r, re) => { const k = Object.keys(r).find(x => re.test(x)); return k ? r[k] : null; };
  const val = (r, alias) => _v(r, new RegExp('\\[' + alias + '\\]$'));

  // ── conexão Power BI (igual às abas irmãs) ──────────────────────
  let _pbi = null, _token = null, _datasetId = null;
  async function pbiConnect(){
    if (window._msalAuth) { _pbi = window._msalAuth; }
    else {
      _pbi = new msal.PublicClientApplication({ auth:{ clientId:PBI_CFG.clientId, authority:'https://login.microsoftonline.com/' + PBI_CFG.tenantId, redirectUri:window.location.origin + '/' }, cache:{ cacheLocation:'localStorage', storeAuthStateInCookie:true } });
      if (_pbi.initialize) await _pbi.initialize();
      await _pbi.handleRedirectPromise().catch(()=>{});
    }
    const accounts = _pbi.getAllAccounts();
    try { const r = await _pbi.acquireTokenSilent({ scopes:PBI_CFG.scopes, account:accounts[0] }); _token = r.accessToken; }
    catch (e) { const r = await _pbi.loginPopup({ scopes:PBI_CFG.scopes }); _token = r.accessToken; }
    const acc = _pbi.getAllAccounts()[0];
    if (acc && typeof window.setSidebarUser === 'function') window.setSidebarUser(acc.name || acc.username, acc.username);
    return _token;
  }
  // Resolve o dataset de UM modelo. `mod` é uma entrada de MODELOS:
  //  • reportId  → pergunta ao relatório qual é o dataset (o id do dataset muda
  //    a cada republicação; o do relatório não) — Comercial;
  //  • datasetId → id fixo — Oportunidades e Consignação (o workspace tem
  //    cópias "(N)" do mesmo modelo, então o id fixado é a única âncora);
  //  • cands + sonda → tenta cada id rodando a medida-assinatura — Licitação.
  async function pbiGetDatasetId(mod){
    if (mod._ds) return mod._ds;
    const cache = 'bio_ds_dv_' + mod.id;
    const guardado = (function(){ try { return localStorage.getItem(cache); } catch (e) { return null; } })();
    const grava = id => { mod._ds = id; try { localStorage.setItem(cache, id); } catch (e) {} return id; };

    if (mod.reportId){
      let r = await fetch('https://api.powerbi.com/v1.0/myorg/groups/' + PBI_CFG.workspaceId + '/reports/' + mod.reportId, { headers:{ Authorization:'Bearer ' + _token } });
      if (r.ok){ const j = await r.json(); if (j.datasetId) return grava(j.datasetId); }
      r = await fetch('https://api.powerbi.com/v1.0/myorg/reports/' + mod.reportId, { headers:{ Authorization:'Bearer ' + _token } });
      if (r.ok){ const j = await r.json(); if (j.datasetId) return grava(j.datasetId); }
      throw new Error('Dataset de ' + mod.nome + ' não encontrado (verifique a permissão Build).');
    }
    if (mod.datasetId) return grava(mod.datasetId);
    // por sonda: o id guardado primeiro, depois os candidatos
    const tentar = (guardado ? [guardado] : []).concat(mod.cands.filter(x => x !== guardado));
    let ultimo = null;
    for (const id of tentar){
      try { await execDax(id, mod.sonda); return grava(id); }
      catch (e) { ultimo = e; }
    }
    throw new Error('Dataset de ' + mod.nome + ' não encontrado' + (ultimo ? ': ' + ultimo.message : '') + '.');
  }

  async function pbiQuery(dax, mod){
    const dsId = await pbiGetDatasetId(mod || MODELOS.comercial);
    return execDax(dsId, dax);
  }

  async function execDax(dsId, dax){
    const urlWs  = 'https://api.powerbi.com/v1.0/myorg/groups/' + PBI_CFG.workspaceId + '/datasets/' + dsId + '/executeQueries';
    const urlDir = 'https://api.powerbi.com/v1.0/myorg/datasets/' + dsId + '/executeQueries';
    const body = JSON.stringify({ queries:[{ query:dax }], serializerSettings:{ includeNulls:true } });
    let headers = { Authorization:'Bearer ' + _token, 'Content-Type':'application/json' };
    let r = await fetch(urlWs, { method:'POST', headers, body });
    if (r.status === 401 || r.status === 403) r = await fetch(urlDir, { method:'POST', headers, body });
    if (r.status === 401 || r.status === 403){
      try { const a = _pbi.getAllAccounts()[0]; const t = await _pbi.acquireTokenSilent({ scopes:PBI_CFG.scopes, account:a, forceRefresh:true }); _token = t.accessToken; }
      catch (e) { try { const t = await _pbi.loginPopup({ scopes:PBI_CFG.scopes }); _token = t.accessToken; } catch (e2) {} }
      headers = { Authorization:'Bearer ' + _token, 'Content-Type':'application/json' };
      r = await fetch(urlWs, { method:'POST', headers, body });
      if (r.status === 401 || r.status === 403) r = await fetch(urlDir, { method:'POST', headers, body });
    }
    const text = await r.text();
    if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + msgDoErro(text));
    const d = JSON.parse(text);
    if (d.error) throw new Error(msgDoErro(text));
    return d.results[0].tables[0].rows;
  }
  // o serviço devolve o motivo dentro de um JSON aninhado; o cartão cinza
  // mostra esse texto ao vendedor, então nada de despejar o JSON cru
  function msgDoErro(text){
    try {
      let e = JSON.parse(text).error;
      while (e && e.pbi && e.pbi.error) e = e.pbi.error;
      const det = e && e['pbi.error'] && e['pbi.error'].details;
      if (det && det.length && det[0].detail && det[0].detail.value) return String(det[0].detail.value).substring(0, 200);
      if (e && e.message) return String(e.message).substring(0, 200);
      if (e && e.code) return String(e.code);
    } catch (x) {}
    return String(text || '').substring(0, 160);
  }
  if (new URLSearchParams(location.search).has('debug')) window.DV_DEBUG = true;
  async function q(rotulo, dax, mod){
    if (window.DV_DEBUG) console.log('[DV] ' + rotulo + ' @ ' + ((mod || MODELOS.comercial).nome) + '\n' + dax);
    return pbiQuery(dax, mod);
  }

  // ── catálogo: grafia exata de CADA modelo ────────────────────────
  // Um catálogo por dataset (os modelos têm convenções diferentes:
  // 'Famílias'[Família] no Comercial, DIM_FAMILIAS[FAMILIA] nas Oportunidades).
  const _cat = {};   // id do modelo -> { col, mea }
  let _faltando = [];

  async function carregarCatalogo(mod, campos){
    const cat = { col: null, mea: null };
    const ler = async (dax) => {
      const rows = await pbiQuery(dax, mod); const c = {};
      (rows || []).forEach(r => { const t = _v(r,/\[T\]$/), n = _v(r,/\[N\]$/); if (t == null || n == null) return; const tn = _norm(t); (c[tn] = c[tn] || {})[_norm(n)] = String(n); });
      return Object.keys(c).length ? c : null;
    };
    try { cat.col = await ler('EVALUATE SELECTCOLUMNS(INFO.VIEW.COLUMNS(), "T",[Table], "N",[Name])'); } catch (e) { console.warn('[DV] ' + mod.nome + ' INFO.VIEW.COLUMNS:', e.message); }
    if (!cat.col) { try { cat.col = await ler('EVALUATE SELECTCOLUMNS(COLUMNSTATISTICS(), "T",[Table Name], "N",[Column Name])'); } catch (e) { console.warn('[DV] ' + mod.nome + ' COLUMNSTATISTICS:', e.message); } }
    const medidas = async fn => {
      const rows = await pbiQuery('EVALUATE SELECTCOLUMNS(' + fn + '(), "N",[Name])', mod);
      if (!rows || !rows.length) return false;
      cat.mea = {}; rows.forEach(r => { const n = _v(r,/\[N\]$/); if (n != null) cat.mea[_norm(n)] = String(n); });
      return true;
    };
    try { await medidas('INFO.VIEW.MEASURES'); } catch (e) { console.warn('[DV] ' + mod.nome + ' INFO.VIEW.MEASURES:', e.message); }
    if (!cat.mea) { try { await medidas('INFO.MEASURES'); } catch (e) { console.warn('[DV] ' + mod.nome + ' INFO.MEASURES:', e.message); } }
    _cat[mod.id] = cat;

    Object.keys(campos).forEach(k => {
      const c = campos[k];
      const ok = c.kind === 'mea' ? resolveMea(c, cat) : resolveCol(c, cat);
      const tinhaCat = c.kind === 'mea' ? !!cat.mea : !!cat.col;
      c._ok = ok || !tinhaCat;
      if (!ok && tinhaCat) { c._ref = null; _faltando.push(mod.nome + ' · ' + c.h); }
    });
  }
  function resolveCol(c, cat){
    c._ref = null;
    // modelo sem acento e em caixa alta (Oportunidades) não leva aspas na tabela
    const set = (t,n) => { c._ref = (/^[A-Z0-9_]+$/.test(t) ? t : "'" + t + "'") + '[' + n + ']'; c._t = t; c._n = n; };
    if (cat && cat.col){
      for (const [t,n] of c.cands){ const tb = cat.col[_norm(t)]; if (tb && tb[_norm(n)]){ set(t, tb[_norm(n)]); return true; } }
      for (const [t,n] of c.cands){
        const tb = cat.col[_norm(t)]; if (!tb) continue;
        const toks = _norm(n).split(' ').filter(w => w.length > 2); if (!toks.length) continue;
        let best = null;
        for (const nn in tb){ if (toks.every(w => nn.indexOf(w) >= 0)){ if (best === null || nn.length < best.length) best = nn; } }
        if (best !== null){ set(t, tb[best]); return true; }
      }
      return false;
    }
    set(c.cands[0][0], c.cands[0][1]);
    return false;
  }
  function resolveMea(c, cat){
    c._ref = null;
    if (cat && cat.mea){
      for (const nome of c.cands){ const h = cat.mea[_norm(nome)]; if (h){ c._ref = '[' + h + ']'; return true; } }
      return false;
    }
    c._ref = '[' + c.cands[0] + ']';
    return false;
  }
  const ref = k => F[k]._ref;
  const exige = (...ks) => { const falta = ks.filter(k => !F[k]._ref).map(k => F[k].h); if (falta.length) throw new Error('O modelo não tem: ' + falta.join(', ')); };
  // versão para os campos da fase 2 (cada bloco tem o seu dicionário)
  const rf = (G, k) => G[k] && G[k]._ref;
  const exigeG = (G, nome, ...ks) => { const falta = ks.filter(k => !rf(G, k)).map(k => G[k].h); if (falta.length) throw new Error('O modelo de ' + nome + ' não tem: ' + falta.join(', ')); };

  // ── filtro-base do Sales Report ─────────────────────────────────
  function baseFiltros(){
    const b = [];
    if (ref('unidade')) b.push(ref('unidade') + ' <> "INTERCOMPANY"'); else b.push("'DIM_UNIDADE_DE_NEGOCIO_V2'[UNIDADE_DE_NEGOCIO] <> \"INTERCOMPANY\"");
    if (ref('geraFat')) b.push(ref('geraFat') + ' = "SIM"'); else b.push("'Operações'[Gera Fatura a receber?] = \"SIM\"");
    if (ref('nfCol')) b.push('FILTER(ALL(' + ref('nfCol') + '), NOT((' + ref('nfCol') + ' & "") IN { ' + NF_OCULTAS.map(n => '"' + n + '"').join(', ') + ' }))');
    return b;
  }
  // código do cliente pode ser número no modelo: compara como texto
  const fCod = cod => 'FILTER(ALL(' + ref('codcli') + '), (' + ref('codcli') + ' & "") = "' + daxS(cod) + '")';
  const fConta = conta => 'FILTER(ALL(' + ref('conta') + '), (' + ref('conta') + ' & "") = "' + daxS(conta) + '")';

  // ── consultas ───────────────────────────────────────────────────
  function janela(){
    const h = new Date(); const y = h.getFullYear(), m = h.getMonth() + 1;
    const k = y * 12 + (m - 1);
    const i12 = k - 11, i24 = k - 23;
    return { ini12:{ ano:Math.floor(i12/12), mes:(i12%12)+1 }, ini24:{ ano:Math.floor(i24/12), mes:(i24%12)+1 } };
  }
  const dataDe = am => 'DATE(' + am.ano + ', ' + am.mes + ', 1)';

  // Q0 — chave: CNPJ → código, nome, conta… (compara pelos DÍGITOS, qualquer máscara)
  async function q0Chave(cnpj){
    exige('cnpj','codcli','cliente');
    const dig = 'SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(' + ref('cnpj') + ' & "", ".", ""), "/", ""), "-", ""), " ", "")';
    const semZero = cnpj.replace(/^0+/, '');
    const cols = [['cod','codcli'],['nome','cliente'],['conta','conta'],['cidade','cidade'],['uf','uf'],['tipo','tipocli'],['grupo','grupo'],['cnpj','cnpj']]
      .filter(([a,k]) => ref(k)).map(([a,k]) => '"' + a + '", ' + ref(k)).join(', ');
    const dax = 'EVALUATE TOPN(5, SELECTCOLUMNS(FILTER(\'' + F.codcli._t + '\', ' + dig + ' = "' + cnpj + '" || ' + dig + ' = "' + semZero + '"), ' + cols + '))';
    const rows = await q('Q0 chave', dax);
    if (!rows || !rows.length) return null;
    // se o CNPJ tem mais de um código (filiais no mesmo cadastro), fica o 1º e avisa
    const r = rows[0];
    return { cod: String(val(r,'cod')), nome: val(r,'nome'), conta: val(r,'conta'), cidade: val(r,'cidade'), uf: val(r,'uf'), tipo: val(r,'tipo'), grupo: val(r,'grupo'),
             cnpj: cnpj, outrosCodigos: rows.slice(1).map(x => String(val(x,'cod'))) };
  }

  // Q1 — família × mês, 24 meses
  async function q1FamMes(cod){
    exige('fatCol','calData','calAno','calMes','familia');
    const J = janela();
    const ext = ['"fat", CALCULATE(SUM(' + ref('fatCol') + '))'];
    if (ref('qtd')) ext.push('"qtd", ' + ref('qtd'));
    if (ref('nfCol')) ext.push('"notas", CALCULATE(DISTINCTCOUNT(' + ref('nfCol') + '))');
    ext.push('"ult", CALCULATE(MAXX(SUMMARIZE(\'Faturamentos\', ' + ref('calData') + '), ' + ref('calData') + '))');
    const dax = 'EVALUATE SELECTCOLUMNS(CALCULATETABLE(ADDCOLUMNS(SUMMARIZE(\'Faturamentos\', ' + ref('familia') + ', ' + ref('calAno') + ', ' + ref('calMes') + '), ' + ext.join(', ') + '), '
      + fCod(cod) + ', ' + baseFiltros().join(', ') + ', ' + ref('calData') + ' >= ' + dataDe(J.ini24) + '), '
      + '"fam", ' + ref('familia') + ', "ano", ' + ref('calAno') + ', "mes", ' + ref('calMes') + ', "fat", [fat]' + (ref('qtd') ? ', "qtd", [qtd]' : '') + (ref('nfCol') ? ', "notas", [notas]' : '') + ', "ult", [ult])';
    const rows = await q('Q1 família × mês', dax);
    return (rows || []).map(r => ({ fam: val(r,'fam'), ano: val(r,'ano'), mes: val(r,'mes'), fat: val(r,'fat'), qtd: val(r,'qtd'), notas: val(r,'notas'), ult: val(r,'ult') }));
  }

  // Q2 — top 10 produtos, 12 meses
  async function q2Produtos(cod){
    exige('fatCol','calData','familia');
    if (!ref('produto') && !ref('codprod')) throw new Error('O modelo não tem Produtos.');
    const J = janela();
    const grao = [ref('codprod'), ref('produto'), ref('familia')].filter(Boolean).join(', ');
    const ext = '"fat", CALCULATE(SUM(' + ref('fatCol') + '))' + (ref('qtd') ? ', "qtd", ' + ref('qtd') : '');
    const dax = 'EVALUATE SELECTCOLUMNS(TOPN(10, CALCULATETABLE(ADDCOLUMNS(SUMMARIZE(\'Faturamentos\', ' + grao + '), ' + ext + '), '
      + fCod(cod) + ', ' + baseFiltros().join(', ') + ', ' + ref('calData') + ' >= ' + dataDe(J.ini12) + '), [fat], DESC), '
      + (ref('codprod') ? '"cod", ' + ref('codprod') + ', ' : '') + (ref('produto') ? '"prod", ' + ref('produto') + ', ' : '') + '"fam", ' + ref('familia') + ', "fat", [fat]' + (ref('qtd') ? ', "qtd", [qtd]' : '') + ')';
    const rows = await q('Q2 top produtos', dax);
    return (rows || []).map(r => ({ cod: val(r,'cod'), prod: val(r,'prod') || val(r,'cod'), fam: val(r,'fam'), fat: val(r,'fat'), qtd: val(r,'qtd') }));
  }

  // Q3 — faturamento 12m de TODOS os clientes (posição na carteira + ABC)
  async function q3Carteira(){
    exige('fatCol','calData','codcli');
    const J = janela();
    const dax = 'EVALUATE SELECTCOLUMNS(CALCULATETABLE(ADDCOLUMNS(SUMMARIZE(\'Faturamentos\', ' + ref('codcli') + '), "fat", CALCULATE(SUM(' + ref('fatCol') + '))), '
      + baseFiltros().join(', ') + ', ' + ref('calData') + ' >= ' + dataDe(J.ini12) + '), "cod", ' + ref('codcli') + ', "fat", [fat])';
    const rows = await q('Q3 carteira', dax);
    return (rows || []).map(r => ({ cod: String(val(r,'cod')), fat: val(r,'fat') }));
  }

  // Q7 — cirurgias futuras da conta (grão do Calendário Cirúrgico)
  async function q7Cirurgias(conta){
    exige('cirData','cirFase','cirItens','cirPreco');
    if (!ref('conta')) throw new Error('O modelo não tem a coluna Conta do cliente.');
    const grao = [ref('cirData'), ref('cirNome'), ref('cirFase'), ref('cirItens'), ref('conta'), ref('medico'), ref('vend')].filter(Boolean).join(', ');
    const montar = (comInter) => {
      const filtros = [
        fConta(conta),
        'NOT(ISBLANK(' + ref('cirData') + '))',
        ref('cirData') + ' >= TODAY()',
        ref('cirFase') + ' IN { ' + FASES_CIR.map(f => '"' + f + '"').join(', ') + ' }',
        'FILTER(ALL(' + ref('cirItens') + '), NOT(ISBLANK(' + ref('cirItens') + ')) && TRIM(SUBSTITUTE(' + ref('cirItens') + ', ",", "")) <> "")'
      ];
      if (comInter && ref('inter')) filtros.push(ref('inter') + ' = "NÃO"');
      const ext = '"valor", CALCULATE(SUM(' + ref('cirPreco') + '))' + (ref('familia') ? ', "fam", CALCULATE(CONCATENATEX(VALUES(' + ref('familia') + '), ' + ref('familia') + ', ", "))' : '');
      return 'EVALUATE SELECTCOLUMNS(TOPN(200, CALCULATETABLE(ADDCOLUMNS(SUMMARIZE(\'Cirurgias_Agrupadas\', ' + grao + '), ' + ext + '), ' + filtros.join(', ') + '), ' + ref('cirData') + ', ASC), '
        + '"data", ' + ref('cirData') + (ref('cirNome') ? ', "nome", ' + ref('cirNome') : '') + ', "fase", ' + ref('cirFase') + ', "itens", ' + ref('cirItens')
        + (ref('medico') ? ', "medico", ' + ref('medico') : '') + (ref('vend') ? ', "vend", ' + ref('vend') : '') + ', "valor", [valor]' + (ref('familia') ? ', "fam", [fam]' : '') + ')';
    };
    let rows;
    try { rows = await q('Q7 cirurgias', montar(true)); }
    catch (e) { if (!ref('inter')) throw e; console.warn('[DV] Q7 com intercompany falhou, tentando sem:', e.message); rows = await q('Q7 cirurgias (sem intercompany)', montar(false)); }
    return (rows || []).map(r => ({ data: val(r,'data'), nome: val(r,'nome'), fase: val(r,'fase'), itens: val(r,'itens'), medico: val(r,'medico'), vend: val(r,'vend'), valor: val(r,'valor'), fam: val(r,'fam') }));
  }

  // ══════════════════════════════════════════════════════════════════
  //  FASE 2 — consignação, oportunidades e atas (3 datasets a mais)
  // ══════════════════════════════════════════════════════════════════

  // valor no TIPO do modelo: número, texto ou booleano. Os fixos da Análise
  // de Contratos são lidos do próprio modelo porque "Proposta sincronizada"
  // pode estar guardada como 1, "1" ou TRUE.
  async function literalDoModelo(campo, alvo, mod){
    if (!campo._ref) return null;
    if (campo._lit !== undefined && campo._litAlvo === alvo) return campo._lit;
    campo._litAlvo = alvo;
    try {
      const rows = await pbiQuery('EVALUATE TOPN(300, VALUES(' + campo._ref + '))', mod);
      const key = rows && rows.length ? Object.keys(rows[0])[0] : null;
      const alvoN = _norm(alvo);
      for (const r of (rows || [])){
        const v = r[key];
        if (v == null) continue;
        if (_norm(v) === alvoN || (alvoN === '1' && (v === 1 || v === true || _norm(v) === 'true'))){
          campo._lit = (typeof v === 'number') ? String(v) : (typeof v === 'boolean' ? (v ? 'TRUE()' : 'FALSE()') : '"' + daxS(v) + '"');
          return campo._lit;
        }
      }
    } catch (e) { console.warn('[DV] literal de ' + campo.h + ':', e.message); }
    campo._lit = null;      // valor não existe na coluna: o filtro fica FORA
    return null;
  }

  // Q6 — saldo consignado por nota (SUMMARIZECOLUMNS + TREATAS, como a página irmã)
  async function q6Consignacao(cod){
    exigeG(FC, 'Consignação', 'codcli', 'nota', 'saldo');
    const dims = [rf(FC,'nota'), rf(FC,'datamov'), rf(FC,'codprod'), rf(FC,'produto'), rf(FC,'lote'), rf(FC,'datavenc')].filter(Boolean);
    const filtros = ['TREATAS({"' + daxS(cod) + '"}, ' + rf(FC,'codcli') + ')'];
    // os 5 fixos do visual "Saldo por nota" — o que o modelo não tiver, sai
    if (rf(FC,'modelo'))   filtros.push('TREATAS({"55"}, ' + rf(FC,'modelo') + ')');
    if (rf(FC,'statusnf')) filtros.push('TREATAS({"Aprovado"}, ' + rf(FC,'statusnf') + ')');
    if (rf(FC,'grupodep')) filtros.push('TREATAS({"ESTOQUE CONSIGNADO/COMODATO"}, ' + rf(FC,'grupodep') + ')');
    if (rf(FC,'exibir'))   filtros.push('TREATAS({"Sim"}, ' + rf(FC,'exibir') + ')');
    if (rf(FC,'nota'))     filtros.push('FILTER(ALL(' + rf(FC,'nota') + '), NOT(ISBLANK(' + rf(FC,'nota') + ')))');
    const meds = ['"saldo", ' + rf(FC,'saldo')];
    if (rf(FC,'custo'))  meds.push('"custo", ' + rf(FC,'custo'));
    if (rf(FC,'aguard')) meds.push('"aguard", ' + rf(FC,'aguard'));
    // SELECTCOLUMNS por fora dá alias previsível a cada coluna (o nome real
    // muda de modelo para modelo). SUMMARIZECOLUMNS não pode entrar em
    // CALCULATETABLE, mas dentro de FILTER/TOPN/SELECTCOLUMNS é válido.
    const saida = ['"nota", ' + rf(FC,'nota')];
    if (rf(FC,'datamov')) saida.push('"data", ' + rf(FC,'datamov'));
    if (rf(FC,'codprod')) saida.push('"cod", ' + rf(FC,'codprod'));
    if (rf(FC,'produto')) saida.push('"produto", ' + rf(FC,'produto'));
    if (rf(FC,'lote'))    saida.push('"lote", ' + rf(FC,'lote'));
    if (rf(FC,'datavenc'))saida.push('"venc", ' + rf(FC,'datavenc'));
    saida.push('"saldo", [saldo]');
    if (rf(FC,'custo'))  saida.push('"custo", [custo]');
    if (rf(FC,'aguard')) saida.push('"aguard", [aguard]');
    const dax = 'EVALUATE SELECTCOLUMNS(TOPN(300, FILTER(SUMMARIZECOLUMNS(' + dims.join(', ') + ', ' + filtros.join(', ') + ', ' + meds.join(', ') + '), [saldo] <> 0), ABS([saldo]), DESC), ' + saida.join(', ') + ')';
    const rows = await q('Q6 consignação', dax, MODELOS.consig);
    return (rows || []).map(r => ({
      nota: val(r,'nota'), data: val(r,'data'), cod: val(r,'cod'), produto: val(r,'produto'),
      lote: val(r,'lote'), venc: val(r,'venc'), saldo: val(r,'saldo'), custo: val(r,'custo'), aguard: val(r,'aguard')
    }));
  }

  // Q8 — cotações e oportunidades vivas (modelo em CAIXA ALTA). É a RESERVA:
  // a fonte principal é o Salesforce pela Conta (/api/dossie-cliente), que
  // não depende de o código do cliente casar entre dois modelos.
  async function q8Oportunidades(cods){
    exigeG(FO, 'Oportunidades', 'codcli', 'tipo', 'fase', 'valor');
    // vendedor e família FORA do grão: uma oportunidade com 3 famílias viraria
    // 3 registros (a armadilha da Q7). SUMMARIZE no fato respeita o filtro da
    // linha; VALUES da dimensão não (o filtro não sobe do fato para ela).
    const grao = [rf(FO,'tipo'), rf(FO,'nome'), rf(FO,'fase'), rf(FO,'criacao'), rf(FO,'cirurgia')].filter(Boolean).join(', ');
    const junta = c => 'CALCULATE(CONCATENATEX(SUMMARIZE(FAT_OPORTUNIDADES_COTACOES, ' + c + '), ' + c + ', ", "))';
    const ext = ['"valor", ' + rf(FO,'valor')];
    if (rf(FO,'qtd'))     ext.push('"qtd", ' + rf(FO,'qtd'));
    if (rf(FO,'vend'))    ext.push('"vend", ' + junta(rf(FO,'vend')));
    if (rf(FO,'familia')) ext.push('"fam", ' + junta(rf(FO,'familia')));
    // todos os códigos do CNPJ (filiais no mesmo cadastro) e o código ERP do Salesforce
    const filtros = [
      'FILTER(ALL(' + rf(FO,'codcli') + '), (' + rf(FO,'codcli') + ' & "") IN { ' + cods.map(c => '"' + daxS(c) + '"').join(', ') + ' })',
      rf(FO,'tipo') + ' IN { "Cotação", "Oportunidade" }',
      'NOT(' + rf(FO,'fase') + ' IN { ' + FASES_FECHADAS.map(f => '"' + f + '"').join(', ') + ' })'
    ];
    const dax = 'EVALUATE SELECTCOLUMNS(TOPN(200, CALCULATETABLE(ADDCOLUMNS(SUMMARIZE(FAT_OPORTUNIDADES_COTACOES, ' + grao + '), ' + ext.join(', ') + '), ' + filtros.join(', ') + '), [valor], DESC), '
      + '"tipo", ' + rf(FO,'tipo') + (rf(FO,'nome') ? ', "nome", ' + rf(FO,'nome') : '') + ', "fase", ' + rf(FO,'fase')
      + (rf(FO,'criacao') ? ', "criacao", ' + rf(FO,'criacao') : '') + (rf(FO,'cirurgia') ? ', "cirurgia", ' + rf(FO,'cirurgia') : '')
      + (rf(FO,'vend') ? ', "vend", [vend]' : '') + (rf(FO,'familia') ? ', "fam", [fam]' : '')
      + ', "valor", [valor]' + (rf(FO,'qtd') ? ', "qtd", [qtd]' : '') + ')';
    const rows = await q('Q8 oportunidades', dax, MODELOS.oport);
    return (rows || []).map(r => ({ tipo: val(r,'tipo'), nome: val(r,'nome'), fase: val(r,'fase'), criacao: val(r,'criacao'),
      cirurgia: val(r,'cirurgia'), vend: val(r,'vend'), fam: val(r,'fam'), valor: val(r,'valor'), qtd: val(r,'qtd') }));
  }

  // Q9 — atas e contratos com saldo (fixos da Análise de Contratos)
  async function q9Atas(cod){
    exigeG(FL, 'Licitação', 'codcli', 'opor', 'vig', 'vitem', 'mabe');
    // literais no tipo do modelo; o que não existir na coluna fica fora do filtro
    const fixos = [];
    const par = [[FL.sinc, '1'], [FL.res, 'Ganho'], [FL.sta, 'Ganha'], [FL.faseop, 'Aguardando Empenho']];
    for (const [campo, alvo] of par){
      const lit = await literalDoModelo(campo, alvo, MODELOS.licitacao);
      if (lit) fixos.push('FILTER(ALL(' + campo._ref + '), ' + campo._ref + ' = ' + lit + ')');
    }
    fixos.push('FILTER(ALL(' + rf(FL,'vig') + '), NOT(ISBLANK(' + rf(FL,'vig') + ')))');
    const dims = [rf(FL,'opor'), rf(FL,'ini'), rf(FL,'vig'), rf(FL,'cprod'), rf(FL,'prod'), rf(FL,'familia')].filter(Boolean);
    const meds = ['"cont", CALCULATE(SUM(' + rf(FL,'vitem') + '))', '"abe", ' + rf(FL,'mabe')];
    if (rf(FL,'mfat')) meds.push('"fat", ' + rf(FL,'mfat'));
    const saida = ['"opor", ' + rf(FL,'opor'), '"vig", ' + rf(FL,'vig')];
    if (rf(FL,'ini'))     saida.push('"ini", ' + rf(FL,'ini'));
    if (rf(FL,'cprod'))   saida.push('"cprod", ' + rf(FL,'cprod'));
    if (rf(FL,'prod'))    saida.push('"prod", ' + rf(FL,'prod'));
    if (rf(FL,'familia')) saida.push('"fam", ' + rf(FL,'familia'));
    saida.push('"cont", [cont]', '"abe", [abe]');
    const montar = (comFat) => {
      const m = comFat ? meds : meds.filter(x => x.indexOf('"fat"') !== 0);
      const s = comFat && rf(FL,'mfat') ? saida.concat(['"fat", [fat]']) : saida;
      return 'EVALUATE SELECTCOLUMNS(TOPN(300, SUMMARIZECOLUMNS(' + dims.join(', ') + ', '
        + 'TREATAS({"' + daxS(cod) + '"}, ' + rf(FL,'codcli') + '), ' + fixos.join(', ') + ', ' + m.join(', ') + '), [abe], DESC), ' + s.join(', ') + ')';
    };
    let rows;
    try { rows = await q('Q9 atas', montar(true), MODELOS.licitacao); }
    catch (e) {
      // OLS derruba a query INTEIRA (HTTP 400), não só a medida bloqueada
      if (!rf(FL,'mfat')) throw e;
      console.warn('[DV] Q9 com [Valor faturado] falhou, refazendo sem:', e.message);
      rows = await q('Q9 atas (sem faturado)', montar(false), MODELOS.licitacao);
    }
    return (rows || []).map(r => ({
      opor: val(r,'opor'), ini: val(r,'ini'), vig: val(r,'vig'),
      cprod: val(r,'cprod'), prod: val(r,'prod'), fam: val(r,'fam'),
      cont: val(r,'cont'), fat: val(r,'fat'), abe: val(r,'abe')
    }));
  }

  // ── FASE 3 · busca do cliente por NOME (no BI, com a RLS do vendedor) ──
  // Sem isto o vendedor precisa do CNPJ na mão. A busca roda no modelo do
  // Comercial, então ele só acha os clientes que já enxerga no Sales Report.
  async function buscarPorNome(termo){
    exige('cnpj','codcli','cliente');
    const t = daxS(String(termo || '').trim());
    if (t.length < 3) return [];
    const cols = [['cod','codcli'],['nome','cliente'],['cnpj','cnpj'],['cidade','cidade'],['uf','uf']]
      .filter(([a,k]) => ref(k)).map(([a,k]) => '"' + a + '", ' + ref(k)).join(', ');
    const dax = 'EVALUATE TOPN(12, SELECTCOLUMNS(FILTER(\'' + F.codcli._t + '\', SEARCH("' + t + '", ' + ref('cliente') + ', 1, 0) > 0 && NOT(ISBLANK(' + ref('cnpj') + '))), ' + cols + '), "nome", ASC)';
    const rows = await q('Busca por nome', dax);
    return (rows || []).map(r => ({ cod: String(val(r,'cod')), nome: val(r,'nome'), cnpj: soDigitos(val(r,'cnpj')), cidade: val(r,'cidade'), uf: val(r,'uf') }))
      .filter(x => x.cnpj.length === 14);
  }

  // ── FASE 3 · ganchos de conversa (IA no servidor, com guard de fonte) ──
  async function pedirGanchos(d){
    await esperaAuth();
    const r = await fetch(API_GANCHOS, { method:'POST', headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
      body: JSON.stringify({ dossie: enxugar(d) }) });
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {}
    if (r.status === 401) throw new Error('Sua sessão não foi reconhecida pelo servidor. Recarregue a página (F5).');
    if (!r.ok || !j) throw new Error((j && j.error) || ('HTTP ' + r.status));
    if (j.ok === false) throw new Error(j.error || 'Não consegui gerar os ganchos.');
    return j;
  }
  // manda só o que sustenta um gancho (o servidor compacta de novo, mas não
  // faz sentido subir 24 meses de série pela rede)
  function enxugar(d){
    const c = d.compras;
    return {
      hoje: d.hoje, cliente: d.cliente, semaforo: d.semaforo, destaques: d.destaques,
      compras: c && { fat12:c.fat12, fat12ant:c.fat12ant, variacao:c.variacao, ultimaCompra:c.ultimaCompra,
        recenciaDias:c.recenciaDias, segmento:c.segmento,
        familias:(c.familias||[]).map(f => ({ fam:f.fam, status:f.status, fat12:f.fat12, fat12ant:f.fat12ant, mesesSemCompra:f.mesesSemCompra })) },
      posicao: d.posicao, topProdutos: d.topProdutos,
      cirurgias: d.cirurgias && { total:d.cirurgias.total, em30dias:d.cirurgias.em30dias, proximas:d.cirurgias.proximas },
      consignacao: d.consignacao && { itens:d.consignacao.itens, saldo:d.consignacao.saldo, custo:d.consignacao.custo,
        aguardando:d.consignacao.aguardando, paradas:d.consignacao.paradas, aVencer:d.consignacao.aVencer, topNotas:d.consignacao.topNotas },
      oportunidades: d.oportunidades && { total:d.oportunidades.total, valor:d.oportunidades.valor,
        maiores:d.oportunidades.maiores, paradas:d.oportunidades.paradas },
      atas: d.atas && { total:d.atas.total, emAberto:d.atas.emAberto, faturado:d.atas.faturado,
        // sem a lista de itens de cada contrato: o servidor só lê o resumo
        contratos:(d.atas.contratos || []).map(o => ({ oportunidade:o.oportunidade, classe:o.classe, diasRestantes:o.diasRestantes,
          emAberto:o.emAberto, pctFaturado:o.pctFaturado, pctPrazo:o.pctPrazo, saldoEmRisco:o.saldoEmRisco })),
        nuncaFaturou:d.atas.nuncaFaturou }
    };
  }

  // ── FASE 4 · agenda do dia (Outlook via Graph, no servidor) ──────
  async function lerAgenda(dias){
    await esperaAuth();
    const r = await fetch(API_AGENDA + '?dias=' + (dias == null ? 1 : dias), { headers:{ 'Accept':'application/json' } });
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {}
    if (r.status === 401) throw new Error('Sua sessão não foi reconhecida pelo servidor. Recarregue a página (F5).');
    if (!r.ok || !j || j.ok !== true) throw new Error((j && j.error) || ('HTTP ' + r.status));
    return j;
  }

  // ── /api/dossie-cliente (Salesforce + carteira) ──────────────────
  async function esperaAuth(){
    for (let i = 0; i < 150 && !window._portalAuthReady; i++) await new Promise(r => setTimeout(r, 100));
    if (window._portalAuthReady) { try { await window._portalAuthReady; } catch (e) {} }
  }
  async function apiCliente(cnpj){
    await esperaAuth();
    const r = await fetch(API_CLIENTE, { method:'POST', headers:{ 'Content-Type':'application/json', 'Accept':'application/json' }, body: JSON.stringify({ cnpj }) });
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {}
    if (r.status === 401) throw new Error('Sua sessão não foi reconhecida pelo servidor. Recarregue a página (F5).');
    if (!r.ok || !j || j.ok !== true) throw new Error((j && j.error) || ('HTTP ' + r.status));
    return j;
  }

  // ── estado + fluxo ──────────────────────────────────────────────
  const ST = { pronto:false, catComercial:false, rodando:false, dossie:null, cnpj:null };

  async function gerar(cnpjRaw){
    const cnpj = soDigitos(cnpjRaw);
    if (cnpj.length !== 14) { msg('Digite um CNPJ com 14 dígitos.', 'erro'); return; }
    if (ST.rodando) return;
    ST.rodando = true; ST.cnpj = cnpj; ST.dossie = null;
    $('dv-btn').disabled = true;
    $('dv-out').hidden = true;
    limparPapel();          // o PDF nunca pode sair com o cliente anterior
    msg('Procurando o cliente no modelo do Comercial…', 'busy');
    try {
      if (!ST.pronto) {
        await pbiConnect();
        _faltando = [];
        // O catálogo do Comercial é obrigatório (é ele que resolve a chave).
        // Se a busca por nome já o carregou, não repete.
        if (!ST.catComercial) { await carregarCatalogo(MODELOS.comercial, F); ST.catComercial = true; }
        // Os 3 da fase 2 são opcionais: se o dataset não abrir (sem permissão,
        // republicado, 429), a seção correspondente vira cartão cinza e o
        // resto do dossiê continua inteiro.
        const extras = [[MODELOS.consig, FC, 'consignacao'], [MODELOS.oport, FO, 'oportunidades'], [MODELOS.licitacao, FL, 'atas']];
        const res = await Promise.allSettled(extras.map(([mod, campos]) => carregarCatalogo(mod, campos)));
        ST.semModelo = {};
        res.forEach((r, i) => { if (r.status === 'rejected') ST.semModelo[extras[i][2]] = 'modelo de ' + extras[i][0].nome + ' indisponível: ' + r.reason.message; });
        ST.pronto = true;
      }
      const [rChave, rApi] = await Promise.allSettled([q0Chave(cnpj), apiCliente(cnpj)]);
      const chave = rChave.status === 'fulfilled' ? rChave.value : null;
      const api = rApi.status === 'fulfilled' ? rApi.value : null;
      const falhas = {};
      if (rChave.status === 'rejected') falhas.chave = rChave.reason.message;
      if (rApi.status === 'rejected') falhas.conta = rApi.reason.message;

      // oportunidades: o Salesforce pela Conta é a fonte; o Power BI só entra
      // quando o SF não respondeu (o motivo vai para o cartão)
      const sfApi = api && api.salesforce;
      const opSF = sfApi && sfApi.oportunidades && sfApi.oportunidades.disponivel ? sfApi.oportunidades : null;
      const motivoSemSF = opSF ? null
        : (sfApi && sfApi.oportunidades && sfApi.oportunidades.motivo) || (!sfApi ? 'Salesforce não respondeu'
          : sfApi.configured === false ? 'Salesforce não configurado' : sfApi.encontrado === false ? 'conta não encontrada no Salesforce por este CNPJ' : 'Salesforce indisponível');

      if (!chave) {
        // sem código no BI não há compras nem cirurgias — mostra o que o SF souber
        // (as oportunidades vêm pela Conta: cliente sem faturamento pode ter cotação viva)
        const conta = sfApi && sfApi.conta;
        const d = M.montar({ hoje: new Date(), chave: { cnpj, cod: null, nome: conta ? conta.nome : null, cidade: conta ? conta.cidade : null, uf: conta ? conta.uf : null },
          conta: conta || null, carteira: api && api.carteira && api.carteira.status || null,
          oportunidades: opSF ? opSF.linhas : null, oportunidadesDe: opSF ? { fonte: 'salesforce', conta: conta && conta.nome } : null,
          falhas: Object.assign({ famMes: falhas.chave || 'CNPJ não encontrado no modelo do Comercial', produtos: 'sem código no BI', carteiraFat: 'sem código no BI', cirurgias: 'sem código no BI',
            consignacao: 'sem código no BI', atas: 'sem código no BI' }, opSF ? {} : { oportunidades: 'sem código no BI e ' + motivoSemSF }, falhas.conta ? { conta: falhas.conta } : {}) });
        d.semChave = true;
        ST.dossie = d; render(d);
        msg(conta ? 'Cliente sem faturamento no modelo do Comercial — mostrando o cadastro do Salesforce.' : 'CNPJ não encontrado no modelo do Comercial nem no Salesforce.', 'aviso');
        return;
      }

      msg('Lendo compras, cirurgias, consignação, oportunidades e atas de ' + (chave.nome || chave.cod) + '…', 'busy');
      const conta = chave.conta || chave.nome;
      const semMod = ST.semModelo || {};
      // uma promessa por seção; modelo que nem abriu já entra recusado
      const recusa = m => Promise.reject(new Error(m));
      // na reserva do BI: todos os códigos do CNPJ + o código ERP da Conta
      const codsOp = [chave.cod].concat(chave.outrosCodigos || [], sfApi && sfApi.conta && sfApi.conta.codigoErp ? [sfApi.conta.codigoErp] : [])
        .map(String).filter((c, i, a) => c && a.indexOf(c) === i);
      const [r1, r2, r3, r7, r6, r8, r9] = await Promise.allSettled([
        q1FamMes(chave.cod), q2Produtos(chave.cod), q3Carteira(), q7Cirurgias(conta),
        semMod.consignacao   ? recusa(semMod.consignacao)   : q6Consignacao(chave.cod),
        opSF                 ? Promise.resolve(opSF.linhas)
          : semMod.oportunidades ? recusa(semMod.oportunidades + ' (e ' + motivoSemSF + ')') : q8Oportunidades(codsOp),
        semMod.atas          ? recusa(semMod.atas)          : q9Atas(chave.cod)
      ]);
      const pega = (r, k) => { if (r.status === 'fulfilled') return r.value; falhas[k] = r.reason.message; return null; };
      const inp = {
        hoje: new Date(), chave,
        conta: api && api.salesforce && api.salesforce.conta || null,
        carteira: api && api.carteira && api.carteira.status || null,
        famMes: pega(r1,'famMes'), produtos: pega(r2,'produtos'), carteiraFat: pega(r3,'carteiraFat'), cirurgias: pega(r7,'cirurgias'),
        consignacao: pega(r6,'consignacao'), oportunidades: pega(r8,'oportunidades'), atas: pega(r9,'atas'),
        oportunidadesDe: opSF ? { fonte: 'salesforce', conta: sfApi.conta && sfApi.conta.nome }
          : { fonte: 'powerbi', codigos: codsOp, semSF: motivoSemSF },
        falhas
      };
      const d = M.montar(inp);
      d.api = api; d.faltando = _faltando.slice();
      ST.dossie = d; render(d);
      const nFalhas = Object.keys(falhas).filter(k => k !== 'chave').length;
      msg(nFalhas ? nFalhas + (nFalhas === 1 ? ' fonte não respondeu' : ' fontes não responderam') + ' — as seções em cinza dizem o motivo.' : 'Dossiê pronto.', nFalhas ? 'aviso' : 'ok');
      // troca só o cnpj e PRESERVA o resto da URL (?debug e afins)
      const qs = new URLSearchParams(location.search); qs.set('cnpj', cnpj);
      history.replaceState(null, '', location.pathname + '?' + qs.toString());
    } catch (err) {
      console.error(err);
      msg(err.message || String(err), 'erro');
    } finally {
      ST.rodando = false; $('dv-btn').disabled = false;
    }
  }

  function msg(texto, tipo){
    const el = $('dv-msg'); if (!el) return;
    el.hidden = !texto; el.className = 'dv-msg dv-msg-' + (tipo || 'info'); el.textContent = texto || '';
  }

  // ── render ──────────────────────────────────────────────────────
  // A MESMA montagem desenha a tela e o papel: cada seção é uma função que
  // devolve HTML e recebe P (true = papel). No papel sai o que é interativo
  // (botões, <details>, navegação) e tudo vem aberto. O papel mora num nó
  // próprio, #dv-papel, filho direto do <body>: na impressão só ele aparece
  // (@media print da página), então nada do shell do portal — corpo de 100vh
  // com overflow escondido, menu, "Minha conta", botões flutuantes — vaza
  // para o PDF. Cor sempre por CLASSE (nunca inline): o tema escuro converte.
  const SEM = { verde:'Sem alertas', amarelo:'Atenção', vermelho:'Alerta' };
  const STATUS_FAM = { ativa:['Ativa','green'], nova:['Nova','violet'], esfriando:['Esfriando','amber'], abandonada:['Abandonada','red'], 'sem-compra':['Sem compra','gray'] };
  const BARRA_FAM = { ativa:'', nova:' dv-bar--violet', esfriando:' dv-bar--amber', abandonada:' dv-bar--red', 'sem-compra':' dv-bar--gray' };
  const SEG_TOM = { fieis:'green', recorrentes:'blue', novos:'violet', risco:'amber', dormentes:'gray', perdidos:'red', semCompra:'gray' };
  const CLASSE_ATA = { vencido:['Vencido','red'], critico:['Vence em ' + M.REGRA.ataCriticoDias + 'd','red'], atencao:['Vence em ' + M.REGRA.ataAtencaoDias + 'd','amber'], ritmo:['Ritmo baixo','cyan'], ok:['No prazo','green'] };
  const SIT_ITEM = { vencido:['Vencido','red'], nunca:['Nunca faturou','red'], atrasado:['Ritmo baixo','amber'], inicio:['Início','blue'], semfat:['Sem faturado','gray'], emdia:['Em dia','green'], concluido:['Concluído','gray'] };
  const FASE_CIR_TOM = { 'Fechado e ganho':'green', 'A Faturar':'violet', 'Negociação e Fechamento':'blue' };
  const TIPO_GANCHO = ['risco', 'oportunidade', 'relacionamento'];

  // ícones de traço (24×24), um por frente do dossiê
  const IC = {
    compras:  '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    familias: '<path d="m12 2 10 5-10 5L2 7l10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
    produtos: '<path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/>',
    cirurgias:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>',
    consig:   '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
    oport:    '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    atas:     '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/>',
    carteira: '<circle cx="12" cy="8" r="6"/><path d="M15.5 13 17 22l-5-3-5 3 1.5-9"/>',
    pontos:   '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
    ganchos:  '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M5 3v4M3 5h4M19 17v4M17 19h4"/>',
    alerta:   '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    relogio:  '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    check:    '<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="m9 11 3 3L22 4"/>',
    info:     '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    user:     '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    fone:     '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    nuvem:    '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z"/>',
    cal:      '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    ritmo:    '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    print:    '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    chev:     '<path d="m6 9 6 6 6-6"/>'
  };
  const ico = (k, cls) => '<svg class="' + (cls || 'dv-ic') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[k] || '') + '</svg>';
  const tag = (t, tom) => '<span class="dv-tag dv-tag--' + (tom || 'gray') + '">' + esc(t) + '</span>';
  const pctN = (v, casas) => (v == null || !isFinite(v)) ? '—' : (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: casas == null ? 0 : casas }) + '%';
  const larg = v => Math.max(0, Math.min(100, n0(v) * 100)).toFixed(1) + '%';
  const plural = (n, um, varios) => int(n) + ' ' + (n === 1 ? um : varios);
  const brlK = v => {
    const x = n0(v), a = Math.abs(x);
    if (a >= 1e6) return 'R$ ' + (x / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
    if (a >= 1e4) return 'R$ ' + Math.round(x / 1e3).toLocaleString('pt-BR') + ' mil';
    return brl0(x);
  };
  const reduzido = () => (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) || document.documentElement.classList.contains('bm3-reduce');

  // seção = cartão com ícone, título, linha de apoio e um canto à direita.
  // `sub` e `extra` já chegam em HTML (quem chama escapa o que é dado).
  function sec(id, ic, titulo, sub, extra, corpo, P, cls){
    return '<section class="dv-sec' + (cls ? ' ' + cls : '') + '"' + (P ? '' : ' id="dv-s-' + id + '" data-sec="' + id + '"') + '>'
      + '<header class="dv-sec-h"><span class="dv-sec-ic">' + ico(ic) + '</span><div class="dv-sec-t"><h3>' + esc(titulo) + '</h3>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>'
      + (extra ? '<div class="dv-sec-x">' + extra + '</div>' : '') + '</header>' + corpo + '</section>';
  }
  function cinza(id, ic, titulo, motivo, P){
    return sec(id, ic, titulo, null, tag('fonte indisponível', 'gray'), '<p class="dv-off-p">' + esc(motivo || 'sem resposta') + '</p>', P, 'dv-sec--off');
  }
  // KPI: texto puro (escapado aqui); `sCls` pinta só a linha de baixo (alta/queda)
  function kpi(l, v, s, tom, sCls){
    return '<div class="dv-kpi' + (tom ? ' dv-kpi--' + tom : '') + '"><div class="dv-kpi-l">' + esc(l) + '</div><div class="dv-kpi-v">' + esc(v) + '</div>'
      + (s ? '<div class="dv-kpi-s' + (sCls ? ' ' + sCls : '') + '">' + esc(s) + '</div>' : '') + '</div>';
  }
  function barra(v, tomCls){ return '<div class="dv-bar' + (tomCls || '') + '"><i style="width:' + larg(v) + '"></i></div>'; }
  function barrasH(linhas){
    return '<div class="dv-hb">' + linhas.map(l => '<div class="dv-hb-r"><div class="dv-hb-l"><b>' + esc(l.rot) + '</b><span>' + esc(l.dir) + '</span></div>' + barra(l.v, l.cls) + '</div>').join('') + '</div>';
  }
  function sparkSvg(serie){
    const max = Math.max.apply(null, serie.concat([1])), bw = 96 / serie.length;
    return '<svg class="dv-spark" viewBox="0 0 96 24" width="96" height="24" aria-hidden="true">' + serie.map((v, i) => {
      const bh = Math.max(1.5, v / max * 22);
      return '<rect x="' + (i * bw + 1).toFixed(1) + '" y="' + (24 - bh).toFixed(1) + '" width="' + (bw - 2).toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="1.5"' + (v > 0 ? ' class="on"' : '') + '/>';
    }).join('') + '</svg>';
  }

  function render(d){
    const out = $('dv-out'); out.hidden = false;
    out.innerHTML = montarDoc(d, false);
    ligarTela(d);
    montarPapel(d);
    out.scrollIntoView({ behavior: reduzido() ? 'auto' : 'smooth', block:'start' });
  }

  function montarDoc(d, P){
    let h = '';
    if (P) h += topoPapel(d);
    h += secHero(d, P);
    if (!P) h += navSecoes(d);
    h += secVisao(d, P);
    h += secPontos(d, P);
    h += secGanchos(d, P);
    h += secCompras(d, P);
    h += secFamilias(d, P);
    h += '<div class="dv-cols">' + secProdutos(d, P) + secCirurgias(d, P) + '</div>';
    h += secConsignacao(d, P);
    h += secOportunidades(d, P);
    h += secAtas(d, P);
    h += rodape(d);
    return '<div class="dv-doc ' + (P ? 'dv-doc--papel' : 'dv-doc--tela') + '">' + h + '</div>';
  }

  // cabeçalho só do papel: marca, quem gerou e quando
  function topoPapel(d){
    const u = window._portalUser || {};
    return '<div class="dv-topo"><div class="dv-topo-m"><img src="/icons/icon-192.png" alt=""><div><b>Biomedical</b><br><span>Dossiê de visita · Comercial</span></div></div>'
      + '<div class="dv-topo-d">Gerado em ' + esc(new Date(d.geradoEm).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' }))
      + (u.name || u.email ? '<br>por ' + esc(u.name || u.email) : '') + '<br>Uso interno · dados lidos com o login de quem gerou</div></div>';
  }

  function secHero(d, P){
    const c = d.cliente, sf = c.salesforce, cor = d.semaforo.cor;
    const chips = [];
    const chip = (rot, val) => chips.push('<span class="dv-chip" style="--i:' + chips.length + '">' + (rot ? '<small>' + esc(rot) + '</small>' : '') + '<b>' + esc(val) + '</b></span>');
    chip('CNPJ', cnpjFmt(c.cnpj || ''));
    if (c.cod) chip('Código', c.cod);
    if (c.cidade || c.uf) chip(null, [c.cidade, c.uf].filter(Boolean).join(' / '));
    if (c.tipo) chip(null, c.tipo);
    if (c.grupo) chip('Grupo', c.grupo);
    if (c.carteira) chip(null, { cliente:'Na carteira', grupo:'Grupo da carteira', novo:'Fora da carteira' }[c.carteira] || c.carteira);
    let sfh = '';
    if (sf) {
      const it = [];
      if (sf.dono) it.push('<span>' + ico('user') + 'Dono da conta <b>' + esc(sf.dono) + '</b></span>');
      if (sf.telefone) it.push('<span>' + ico('fone') + esc(sf.telefone) + '</span>');
      it.push('<span>' + ico('nuvem') + (sf.nome && sf.nome !== c.nome ? 'Salesforce: ' + esc(sf.nome) : 'Conta no Salesforce') + '</span>');
      sfh = '<div class="dv-hero-sf">' + it.join('') + '</div>';
    }
    else if (d.fontes.salesforce && d.fontes.salesforce.ok === false) sfh = '<div class="dv-hero-av">Salesforce indisponível: ' + esc(d.fontes.salesforce.erro) + '</div>';
    else if (d.api && d.api.salesforce && d.api.salesforce.configured === false) sfh = '<div class="dv-hero-av">Salesforce não configurado neste ambiente.</div>';
    else if (d.api && d.api.salesforce && d.api.salesforce.encontrado === false) sfh = '<div class="dv-hero-av">Conta não encontrada no Salesforce por este CNPJ.</div>';
    if (c.outrosCodigos && c.outrosCodigos.length) sfh += '<div class="dv-hero-av">Este CNPJ tem mais de um código no modelo (' + esc(c.outrosCodigos.join(', ')) + ') — o dossiê usa o primeiro.</div>';
    // código do BI ≠ código ERP da Conta: as seções lidas por código podem sair vazias
    const erp = sf && sf.codigoErp ? String(sf.codigoErp).trim() : '';
    if (erp && c.cod && [String(c.cod)].concat(c.outrosCodigos || []).indexOf(erp) < 0)
      sfh += '<div class="dv-hero-av">Código no Power BI: ' + esc(c.cod) + ' · código ERP na conta do Salesforce: ' + esc(erp) + '. Consignação e atas são buscadas pelo código do BI.</div>';
    const seg = d.compras && d.compras.segmento;
    const mot = d.semaforo.motivos;
    const st = '<aside class="dv-st dv-st--' + cor + '"><div class="dv-st-h"><span class="dv-st-pill"><i></i>' + SEM[cor] + '</span>'
      + (seg ? '<div class="dv-st-seg">segmento<b>' + esc(seg.nome) + '</b></div>' : '') + '</div>'
      + (mot.length ? '<ul>' + mot.map(m => '<li>' + esc(m) + '</li>').join('') + '</ul>' : '<div class="dv-st-ok">Nenhum sinal de risco nas fontes lidas.</div>') + '</aside>';
    return '<section class="dv-hero"' + (P ? '' : ' id="dv-s-visao" data-sec="visao"') + '><div>'
      + '<div class="dv-hero-k"><i></i>Dossiê de visita · ' + esc(dataBR(d.hoje)) + '</div>'
      + '<h2 class="dv-nome">' + esc(c.nome || (sf && sf.nome) || 'Cliente') + '</h2>'
      + '<div class="dv-chips">' + chips.join('') + '</div>' + sfh + '</div>' + st + '</section>';
  }

  // barra de atalhos (fica presa no topo enquanto rola; a pílula acompanha a leitura)
  function navSecoes(d){
    const n = (v, al) => v ? '<span class="n' + (al ? ' al' : '') + '">' + int(v) + '</span>' : '';
    const cg = d.consignacao, at = d.atas;
    const it = [
      ['visao', 'Visão geral', ''],
      ['compras', 'Compras', ''],
      ['familias', 'Famílias', d.compras && d.compras.abandonadas.length ? n(d.compras.abandonadas.length, true) : ''],
      ['produtos', 'Produtos', ''],
      ['cirurgias', 'Cirurgias', d.cirurgias ? n(d.cirurgias.total) : ''],
      ['consignacao', 'Consignação', cg ? (cg.paradas.length ? n(cg.paradas.length, true) : n(cg.notas)) : ''],
      ['oportunidades', 'Oportunidades', d.oportunidades ? n(d.oportunidades.total) : ''],
      ['atas', 'Atas e contratos', at ? n(at.total, at.criticos.length > 0) : '']
    ];
    return '<nav class="dv-nav" aria-label="Seções do dossiê"><div class="dv-nav-l">'
      + it.map(x => '<a href="#dv-s-' + x[0] + '" data-ir="' + x[0] + '">' + esc(x[1]) + x[2] + '</a>').join('') + '</div>'
      + '<button type="button" class="dv-btn sec" data-acao="imprimir" title="Imprimir ou salvar em PDF">' + ico('print') + 'Imprimir / PDF</button></nav>';
  }

  // Visão 360: uma frente por cartão, com a cor do que pede atenção
  function secVisao(d, P){
    const t = [];
    const tile = (alvo, ic, rot, v, s, nivel) => {
      const el = P ? 'div' : 'a';
      t.push('<' + el + ' class="dv-p dv-p--' + nivel + (P ? '' : ' bm3-tilt-me') + '"' + (P ? '' : ' href="#dv-s-' + alvo + '" data-ir="' + alvo + '"') + '>'
        + '<div class="dv-p-h"><span class="dv-p-ic">' + ico(ic) + '</span>' + esc(rot) + '</div>'
        + '<div class="dv-p-v">' + esc(v) + '</div><div class="dv-p-s">' + s + '</div></' + el + '>');
    };
    const off = (alvo, ic, rot) => tile(alvo, ic, rot, '—', 'fonte indisponível', 'off');

    const c = d.compras;
    if (c) {
      const sid = c.segmento.id;
      const nivel = sid === 'perdidos' ? 'alerta' : (sid === 'dormentes' || sid === 'risco') ? 'atencao' : sid === 'semCompra' ? 'vazio' : 'ok';
      tile('compras', 'compras', 'Compras 12m', brl0(c.fat12),
        (c.variacao != null ? '<b>' + esc(pct(c.variacao)) + '</b> vs 12m anteriores' : 'sem 12m anteriores') + ' · ' + esc(c.segmento.nome), nivel);
    } else off('compras', 'compras', 'Compras 12m');

    const po = d.posicao;
    if (po && po.rank) tile('compras', 'carteira', 'Na carteira', po.rank + 'º de ' + int(po.de), 'classe <b>' + esc(po.classe) + '</b> · ' + esc(pctN(po.share, 1)) + ' do faturamento', 'info');
    else if (po || (d.fontes.posicao && d.fontes.posicao.ok)) tile('compras', 'carteira', 'Na carteira', '—', 'sem faturamento nos últimos 12 meses', 'vazio');
    else off('compras', 'carteira', 'Na carteira');

    const ci = d.cirurgias;
    if (ci) tile('cirurgias', 'cirurgias', 'Cirurgias', ci.total ? plural(ci.total, 'agendada', 'agendadas') : 'Nenhuma',
      ci.total ? esc(brl0(ci.valor)) + (ci.proxima ? ' · próxima ' + (ci.proxima.diasAte === 0 ? '<b>hoje</b>' : 'em <b>' + ci.proxima.diasAte + 'd</b>') : '') : 'nada agendado nas fases ativas', ci.total ? 'info' : 'vazio');
    else off('cirurgias', 'cirurgias', 'Cirurgias');

    const cg = d.consignacao;
    if (cg) {
      if (!cg.itens) tile('consignacao', 'consig', 'Consignação', 'R$ 0', 'nada consignado no cliente', 'vazio');
      else tile('consignacao', 'consig', 'Consignação', brl0(cg.custo),
        (cg.paradas.length ? '<b>' + plural(cg.paradas.length, 'remessa parada', 'remessas paradas') + '</b> +' + M.REGRA.consigParadoDias + 'd' : plural(cg.notas, 'nota', 'notas') + ' · no prazo')
        + (cg.aVencer.length ? ' · ' + plural(cg.aVencer.length, 'lote vencendo', 'lotes vencendo') : ''),
        cg.paradas.length ? 'alerta' : cg.aVencer.length ? 'atencao' : 'ok');
    } else off('consignacao', 'consig', 'Consignação');

    const op = d.oportunidades;
    if (op) tile('oportunidades', 'oport', 'Oportunidades', op.total ? brl0(op.valor) : 'R$ 0',
      op.total ? plural(op.total, 'aberta', 'abertas') + (op.paradas.length ? ' · <b>' + plural(op.paradas.length, 'parada', 'paradas') + '</b>' : '') : 'nada aberto', op.paradas.length ? 'atencao' : op.total ? 'info' : 'vazio');
    else off('oportunidades', 'oport', 'Oportunidades');

    const at = d.atas;
    if (at) {
      if (!at.total) tile('atas', 'atas', 'Atas e contratos', 'R$ 0', 'sem saldo em contrato', 'vazio');
      else tile('atas', 'atas', 'Atas e contratos', brl0(at.emAberto),
        'em aberto · ' + plural(at.total, 'contrato', 'contratos') + (at.criticos.length ? ' · <b>' + plural(at.criticos.length, 'vencendo', 'vencendo') + '</b>' : at.nuncaFaturou.length ? ' · <b>' + plural(at.nuncaFaturou.length, 'item nunca faturou', 'itens nunca faturaram') + '</b>' : ''),
        at.criticos.length ? 'alerta' : (at.nuncaFaturou.length || at.atrasados.length) ? 'atencao' : 'ok');
    } else off('atas', 'atas', 'Atas e contratos');

    return '<div class="dv-360">' + t.join('') + '</div>';
  }

  // destaques (sem IA) agrupados pelo que pedem do vendedor
  function secPontos(d, P){
    const G = [['alerta', 'Alertas', 'alerta'], ['atencao', 'Atenção', 'relogio'], ['positivo', 'A favor', 'check'], ['info', 'Contexto', 'info']];
    const by = {};
    d.destaques.forEach(x => { (by[x.tipo] = by[x.tipo] || []).push(x); });
    const gs = G.filter(g => by[g[0]] && by[g[0]].length);
    const corpo = gs.length
      ? '<div class="dv-pts">' + gs.map(g => '<div class="dv-pts-g dv-pts--' + g[0] + '"><h4>' + ico(g[2]) + g[1] + '<span>' + by[g[0]].length + '</span></h4><ul>'
          + by[g[0]].map(x => '<li>' + esc(x.texto) + '</li>').join('') + '</ul></div>').join('') + '</div>'
      : '<p class="dv-vazio">Nenhum ponto de atenção calculado para este cliente.</p>';
    return sec('pontos', 'pontos', 'O que importa nesta visita', 'calculado dos números deste dossiê, sem IA', '', corpo, P);
  }

  function ganchosHtml(j){
    return (j.resumo ? '<p class="dv-gan-r">' + esc(j.resumo) + '</p>' : '')
      + '<div class="dv-gan">' + j.ganchos.map(g => '<div class="dv-gan-c' + (TIPO_GANCHO.indexOf(g.tipo) >= 0 ? ' ' + g.tipo : '') + '">'
          + '<div class="dv-gan-t">' + esc(g.titulo) + '</div><div class="dv-gan-f">' + esc(g.fala) + '</div><div class="dv-gan-o">fonte: ' + esc(g.fonte) + '</div></div>').join('') + '</div>'
      + '<p class="dv-gan-o">Sugestões de IA sobre os números desta página'
      + (j.descartados ? ' · ' + j.descartados + (j.descartados === 1 ? ' sugestão descartada por não citar fonte válida' : ' sugestões descartadas por não citarem fonte válida') : '')
      + '. Confira antes de usar.</p>';
  }
  function secGanchos(d, P){
    const j = d.ganchos, tem = j && j.ganchos && j.ganchos.length;
    const sub = 'sugeridos por IA a partir dos números deste dossiê · cada um cita a fonte';
    if (P) return tem ? sec('ganchos', 'ganchos', 'Ganchos de conversa', sub, '', ganchosHtml(j), true) : '';
    const corpo = '<div id="dv-gan-box">' + (tem
      ? ganchosHtml(j) + '<button id="dv-gan-btn" class="dv-btn sec dv-gan-acao" type="button">' + ico('ganchos') + 'Gerar de novo</button>'
      : '<div class="dv-gan-vazio"><button id="dv-gan-btn" class="dv-btn" type="button">' + ico('ganchos') + 'Sugerir 3 ganchos de conversa</button>'
        + '<p>A IA lê só este dossiê, não a internet, e o servidor descarta qualquer sugestão que não aponte para um número desta página.</p></div>') + '</div>';
    return sec('ganchos', 'ganchos', 'Ganchos de conversa', sub, '', corpo, false);
  }

  function secCompras(d, P){
    const cp = d.compras;
    if (!cp) return cinza('compras', 'compras', 'O que compra', d.fontes.compras.erro, P);
    const s = cp.segmento, po = d.posicao;
    const k = '<div class="dv-kpis">'
      + kpi('Faturamento 12m', brl0(cp.fat12), cp.variacao == null ? 'sem 12m anteriores para comparar' : pct(cp.variacao) + ' vs ' + brl0(cp.fat12ant), null, cp.variacao == null ? '' : cp.variacao < 0 ? 'dv-dn' : 'dv-up')
      + kpi('Média mensal', brl0(cp.fatMedioMes12), cp.mesesAtivos12 + ' de 12 meses com compra')
      + kpi('Notas 12m', int(cp.nNotas12), cp.ticket12 != null ? 'ticket médio ' + brl0(cp.ticket12) : '—')
      + kpi('Última compra', dataBR(cp.ultimaCompra), cp.recenciaDias != null ? 'há ' + cp.recenciaDias + ' dias' : '—')
      + kpi('Segmento', s.nome, s.motivo || s.criterio, SEG_TOM[s.id])
      + (po && po.rank ? kpi('Na sua carteira', po.rank + 'º de ' + int(po.de), 'classe ' + po.classe + ' · ' + pctN(po.share, 1) + ' do faturamento', 'blue')
         : d.fontes.posicao && d.fontes.posicao.ok === false ? kpi('Na sua carteira', '—', d.fontes.posicao.erro, 'gray') : '')
      + '</div>';
    const fams = cp.familias.filter(f => f.fat12 > 0).sort((a, b) => b.fat12 - a.fat12);
    const tot = fams.reduce((s2, f) => s2 + f.fat12, 0);
    let mix;
    if (!fams.length) mix = '<p class="dv-vazio">Sem compras nos últimos 12 meses.</p>';
    else {
      const ls = fams.slice(0, 6).map(f => ({ rot: f.fam, dir: brlK(f.fat12) + ' · ' + pctN(f.fat12 / tot), v: f.fat12 / tot, cls: BARRA_FAM[f.status] || '' }));
      const resto = fams.slice(6);
      if (resto.length) { const r = resto.reduce((s2, f) => s2 + f.fat12, 0); ls.push({ rot: 'Outras ' + resto.length + ' famílias', dir: brlK(r) + ' · ' + pctN(r / tot), v: r / tot, cls: ' dv-bar--gray' }); }
      mix = barrasH(ls);
    }
    const corpo = k + '<div class="dv-cols dv-cols-21"><div>' + grafico24(cp) + '</div>'
      + '<div class="dv-mix-cx"><div class="dv-sub dv-sub--topo">Mix por família · 12m</div>' + mix + '</div></div>';
    return sec('compras', 'compras', 'O que compra',
      'últimos 12 meses (' + esc(mesAno(cp.janela.ini12)) + ' a ' + esc(mesAno(cp.janela.fim)) + ') contra os 12 anteriores · filtro-base do Sales Report', '', corpo, P);
  }
  // 24 meses em barras HTML (o portal-motion as faz crescer na tela; no papel
  // as cores vão por print-color-adjust) + a linha da média dos últimos 12
  function grafico24(cp){
    const se = cp.serie24, max = Math.max.apply(null, se.map(x => x.fat).concat([1]));
    const media = cp.fat12 / 12;
    let h = '<div class="dv-ch"><div class="dv-ch-leg"><span><i></i>12m anteriores <b>' + esc(brl0(cp.fat12ant)) + '</b></span>'
      + '<span><i class="b"></i>últimos 12m <b>' + esc(brl0(cp.fat12)) + '</b></span>'
      + (media > 0 ? '<span><i class="m"></i>média 12m <b>' + esc(brlK(media)) + '/mês</b></span>' : '') + '</div><div class="dv-ch-plot">';
    if (media > 0) h += '<div class="dv-ch-avg" style="bottom:' + Math.min(100, media / max * 100).toFixed(1) + '%"></div>';
    h += se.map((x, i) => '<div class="dv-ch-c' + (i >= 12 ? ' cur' : '') + '" title="' + esc(mesAno(x) + ': ' + brl(x.fat)) + '"><i style="height:' + Math.max(1.5, x.fat / max * 100).toFixed(1) + '%"></i></div>').join('');
    h += '</div><div class="dv-ch-x">' + se.map((x, i) => {
      const ano = x.mes === 1 || i === 0;
      // o 1º rótulo (mês que não é janeiro) some no celular para não encavalar no ano seguinte
      return '<span' + (ano ? ' class="y' + (x.mes !== 1 ? ' p' : '') + '"' : '') + '>' + (ano ? mesAno(x) : MES[x.mes - 1].charAt(0).toUpperCase()) + '</span>';
    }).join('') + '</div></div>';
    return h;
  }

  function secFamilias(d, P){
    const cp = d.compras;
    if (!cp) return '';
    const cont = {};
    cp.familias.forEach(f => { cont[f.status] = (cont[f.status] || 0) + 1; });
    const ROT = { abandonada:['abandonada', 'abandonadas'], esfriando:['esfriando', 'esfriando'], nova:['nova', 'novas'] };
    const extra = Object.keys(ROT).filter(k => cont[k]).map(k => tag(plural(cont[k], ROT[k][0], ROT[k][1]), STATUS_FAM[k][1])).join('');
    let corpo;
    if (!cp.familias.length) corpo = '<p class="dv-vazio">Sem faturamento nos últimos 24 meses.</p>';
    else corpo = '<div class="dv-tw"><table class="dv-t"><thead><tr><th>Família</th><th>Status</th><th class="r">12m</th><th class="r">12m ant.</th><th class="r">Var.</th><th>Tendência 12m</th><th>Última compra</th></tr></thead><tbody>'
      + cp.familias.map(f => {
        const st = STATUS_FAM[f.status] || [f.status, 'gray'];
        return '<tr class="' + (f.status === 'abandonada' ? 'dv-tr--red' : f.status === 'esfriando' ? 'dv-tr--amber' : '') + '"><td><b>' + esc(f.fam) + '</b></td><td>' + tag(st[0], st[1]) + '</td>'
          + '<td class="r">' + brl0(f.fat12) + '</td><td class="r">' + brl0(f.fat12ant) + '</td>'
          + '<td class="r ' + (f.variacao == null ? '' : f.variacao < 0 ? 'dv-dn' : 'dv-up') + '">' + pct(f.variacao) + '</td>'
          + '<td>' + sparkSvg(f.serie12) + '</td><td>' + dataBR(f.ultima) + (f.mesesSemCompra != null && f.mesesSemCompra > 0 ? '<small>' + f.mesesSemCompra + (f.mesesSemCompra === 1 ? ' mês' : ' meses') + ' sem compra</small>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    return sec('familias', 'familias', 'Famílias: o que compra e o que parou de comprar',
      'ativa = comprou nos últimos 3 meses · esfriando = 4 a 6 meses sem compra · abandonada = 6+ meses sem compra tendo comprado antes', extra, corpo, P);
  }

  function secProdutos(d, P){
    const tp = d.topProdutos;
    if (!tp) return cinza('produtos', 'produtos', 'Top produtos · 12m', d.fontes.produtos.erro, P);
    const corpo = !tp.length ? '<p class="dv-vazio">Sem produtos faturados no período.</p>'
      : '<div class="dv-tw"><table class="dv-t"><thead><tr><th></th><th>Produto</th><th class="r">Qtd</th><th class="r">Faturado</th><th>Part.</th></tr></thead><tbody>'
        + tp.map((p, i) => '<tr><td><span class="dv-rank">' + (i + 1) + '</span></td><td><b>' + esc(p.prod) + '</b><small>' + esc([p.cod && p.cod !== p.prod ? p.cod : '', p.fam].filter(Boolean).join(' · ')) + '</small></td>'
          + '<td class="r">' + int(p.qtd) + '</td><td class="r"><b>' + brl0(p.fat) + '</b></td>'
          + '<td><div class="dv-pc dv-pc--curta">' + barra(p.share) + '<span>' + pctN(p.share) + '</span></div></td></tr>').join('') + '</tbody></table></div>';
    return sec('produtos', 'produtos', 'Top produtos · 12m', 'os 10 mais faturados · participação entre eles', '', corpo, P);
  }

  function secCirurgias(d, P){
    const ci = d.cirurgias;
    if (!ci) return cinza('cirurgias', 'cirurgias', 'Cirurgias agendadas', d.fontes.cirurgias.erro, P);
    const extra = ci.total ? tag(plural(ci.total, 'cirurgia', 'cirurgias'), 'blue') + (ci.em30dias ? tag(ci.em30dias + ' em 30 dias', 'violet') : '') : '';
    let corpo;
    if (!ci.total) corpo = '<p class="dv-vazio">Nenhuma cirurgia futura nas fases ' + esc(FASES_CIR.join(', ')) + '.</p>';
    else corpo = '<ol class="dv-tl">' + ci.proximas.map(x => {
      const meta = [x.diasAte === 0 ? 'hoje' : 'em ' + x.diasAte + (x.diasAte === 1 ? ' dia' : ' dias'), x.medico ? 'Dr(a). ' + x.medico : '', x.familias, x.valor ? brl0(x.valor) : ''].filter(Boolean);
      return '<li' + (x.diasAte <= 7 ? ' class="breve"' : '') + '><div class="dv-tl-d"><b>' + esc(String(x.data).slice(8, 10)) + '</b><span>' + esc(MES[+String(x.data).slice(5, 7) - 1] || '') + '</span></div>'
        + '<div class="dv-tl-b"><div class="dv-tl-t"><b>' + esc(x.nome || x.itens.slice(0, 60)) + '</b>' + tag(x.fase || '—', FASE_CIR_TOM[x.fase] || 'blue') + '</div>'
        + '<div class="dv-tl-m">' + esc(meta.join(' · ')) + '</div>'
        + (x.itens ? '<div class="dv-tl-i">' + esc(x.itens.length > 160 ? x.itens.slice(0, 160) + '…' : x.itens) + '</div>' : '') + '</div></li>';
    }).join('') + '</ol>' + (ci.total > ci.proximas.length ? '<p class="dv-vazio">+ ' + plural(ci.total - ci.proximas.length, 'cirurgia mais adiante', 'cirurgias mais adiante') + '.</p>' : '');
    return sec('cirurgias', 'cirurgias', 'Cirurgias agendadas', ci.total ? esc(brl0(ci.valor)) + ' em cirurgias futuras' : 'nada agendado', extra, corpo, P);
  }

  function secConsignacao(d, P){
    const cg = d.consignacao, R = M.REGRA;
    if (!cg) return cinza('consignacao', 'consig', 'Consignação no cliente', d.fontes.consignacao.erro, P);
    if (!cg.itens) return sec('consignacao', 'consig', 'Consignação no cliente', 'saldo por nota do modelo de Consignação', '', '<p class="dv-vazio">Nenhuma remessa com saldo em aberto neste cliente.</p>', P);
    const k = '<div class="dv-kpis">'
      + kpi('Custo em consignação', brl0(cg.custo), plural(cg.notas, 'nota', 'notas') + ' · ' + plural(cg.itens, 'item', 'itens'))
      + kpi('Saldo (qtd)', int(cg.saldo), 'unidades no cliente')
      + kpi('Parado há +' + R.consigParadoDias + 'd', brl0(cg.custoParado), cg.paradas.length ? plural(cg.paradas.length, 'remessa', 'remessas') + ' — cobrar consumo ou devolução' : 'tudo dentro do prazo', cg.paradas.length ? 'red' : 'green')
      + (cg.aguardando ? kpi('Aguardando faturamento', int(cg.aguardando), 'já consumido, a faturar', 'amber') : '')
      + kpi('Lotes vencendo', int(cg.aVencer.length), 'em até ' + R.loteVenceDias + ' dias', cg.aVencer.length ? 'amber' : null)
      + '</div>';
    const tb = '<div class="dv-tw"><table class="dv-t"><thead><tr><th>Nota</th><th>Remessa</th><th>Idade</th><th class="r">Saldo</th><th class="r">Custo</th><th>Produtos</th></tr></thead><tbody>'
      + cg.topNotas.map(n => {
        const id = n.idadeDias == null ? 0 : n.idadeDias, parada = id >= R.consigParadoDias;
        return '<tr class="' + (parada ? 'dv-tr--red' : '') + '"><td><b>' + esc(n.nota) + '</b></td><td>' + dataBR(n.data) + '</td>'
          + '<td><div class="dv-age">' + barra(Math.min(1, id / (R.consigParadoDias * 2)), parada ? ' dv-bar--red' : id >= R.consigParadoDias * 2 / 3 ? ' dv-bar--amber' : ' dv-bar--green') + '<span class="' + (parada ? 'dv-dn' : '') + '">' + int(id) + 'd</span></div></td>'
          + '<td class="r">' + int(n.saldo) + '</td><td class="r"><b>' + brl0(n.custo) + '</b></td>'
          + '<td><small>' + esc(n.produtos.join(', ') + (n.itens > n.produtos.length ? ' +' + (n.itens - n.produtos.length) : '')) + '</small></td></tr>';
      }).join('') + '</tbody></table></div>';
    const lotes = cg.aVencer.length ? '<div class="dv-lotes"><span>Lotes vencendo em até ' + R.loteVenceDias + ' dias:</span>'
      + cg.aVencer.slice(0, 8).map(x => tag((x.lote || x.cod) + ' · ' + (x.produto || '').slice(0, 28) + ' · ' + x.diasParaVencer + 'd', x.diasParaVencer <= 30 ? 'red' : 'amber')).join('') + '</div>' : '';
    return sec('consignacao', 'consig', 'Consignação no cliente',
      'saldo por nota do modelo de Consignação · a barra mede a idade da remessa até ' + (R.consigParadoDias * 2) + ' dias; o traço marca ' + R.consigParadoDias + ' dias (parada)',
      cg.paradas.length ? tag(plural(cg.paradas.length, 'remessa parada', 'remessas paradas'), 'red') : tag('no prazo', 'green'), k + tb + lotes, P);
  }

  // de onde a lista veio — o cartão vazio diz o que foi procurado, para
  // "nenhuma" nunca esconder uma busca que não achou o cliente
  function origemOport(de){
    if (!de) return { sub: 'cotações e oportunidades em aberto', vazio: 'Nenhuma cotação ou oportunidade aberta para este cliente.' };
    if (de.fonte === 'salesforce') return { sub: 'direto do Salesforce, pela conta ' + (de.conta || 'do CNPJ'),
      vazio: 'Nenhuma cotação ou oportunidade aberta no Salesforce para a conta ' + (de.conta || 'deste CNPJ') + '.' };
    const cods = (de.codigos || []).join(', ');
    return { sub: 'modelo de Oportunidades do Power BI, pelo código ' + cods + (de.semSF ? ' (Salesforce fora: ' + de.semSF + ')' : ''),
      vazio: 'Nenhuma cotação ou oportunidade aberta no Power BI para o código ' + cods + '. O Salesforce não foi lido (' + (de.semSF || 'indisponível') + ') — confira lá antes da visita.' };
  }
  function secOportunidades(d, P){
    const op = d.oportunidades, R = M.REGRA;
    if (!op) return cinza('oportunidades', 'oport', 'Oportunidades e cotações vivas', d.fontes.oportunidades.erro, P);
    const org = origemOport(d.fontes.oportunidades.de);
    if (!op.total) return sec('oportunidades', 'oport', 'Oportunidades e cotações vivas', org.sub, '', '<p class="dv-vazio">' + esc(org.vazio) + '</p>', P);
    const k = '<div class="dv-kpis">'
      + kpi('Valor em aberto', brl0(op.valor), plural(op.total, 'registro', 'registros'))
      + kpi('Cotações', int(op.cotacoes.n), brl0(op.cotacoes.valor), 'violet')
      + kpi('Oportunidades', int(op.oportunidades.n), brl0(op.oportunidades.valor), 'blue')
      + kpi('Paradas', int(op.paradas.length), (op.todas.some(o => o.diasNaFase != null) ? 'há +' + R.oportParadaDias + ' dias na mesma fase' : 'abertas há +' + R.oportParadaDias + ' dias'), op.paradas.length ? 'amber' : null)
      + '</div>';
    const tb = '<div class="dv-tw"><table class="dv-t"><thead><tr><th>Registro</th><th>Fase</th><th class="r">Valor</th><th class="r">Aberta há</th><th>Cirurgia</th></tr></thead><tbody>'
      + op.maiores.map(o => {
        const parada = o.parada;
        return '<tr class="' + (parada ? 'dv-tr--amber' : '') + '"><td><b>' + esc(o.nome || '—') + '</b><small>' + esc([o.tipo, o.familia, o.vendedor].filter(Boolean).join(' · ')) + '</small></td>'
          + '<td>' + esc(o.fase) + (o.diasNaFase != null ? '<small>há ' + int(o.diasNaFase) + ' d nesta fase</small>' : '') + '</td><td class="r"><b>' + brl0(o.valor) + '</b></td>'
          + '<td class="r ' + (parada ? 'dv-dn' : '') + '">' + (o.idadeDias != null ? int(o.idadeDias) + ' d' : '—') + '</td>'
          + '<td>' + (o.dataCirurgia ? dataBR(o.dataCirurgia) + (o.diasAteCirurgia != null && o.diasAteCirurgia >= 0 ? '<small>em ' + o.diasAteCirurgia + ' d</small>' : '') : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    const fases = Object.keys(op.porFase).map(f => ({ f, n: op.porFase[f].n, v: op.porFase[f].valor })).sort((a, b) => b.v - a.v);
    const maxF = Math.max.apply(null, fases.map(x => x.v).concat([1]));
    const porFase = barrasH(fases.map(x => ({ rot: x.f, dir: plural(x.n, 'reg.', 'reg.') + ' · ' + brlK(x.v), v: x.v / maxF, cls: ' dv-bar--violet' })));
    return sec('oportunidades', 'oport', 'Oportunidades e cotações vivas', org.sub + ' · em laranja, paradas há +' + R.oportParadaDias + ' dias',
      op.paradas.length ? tag(plural(op.paradas.length, 'parada', 'paradas'), 'amber') : '',
      k + '<div class="dv-cols dv-cols-21"><div>' + tb + '</div><div><div class="dv-sub dv-sub--topo">Valor por fase</div>' + porFase + '</div></div>', P);
  }

  // ── atas e contratos: contrato → itens, prazo × faturado, ritmo e projeção ──
  function secAtas(d, P){
    const at = d.atas, R = M.REGRA;
    const sub = 'ganhos com saldo, pelos filtros da Análise de Contratos · a barra de cada contrato compara o que já foi faturado com o tempo de contrato que já passou (o traço é hoje)';
    if (!at) return cinza('atas', 'atas', 'Atas e contratos', d.fontes.atas.erro, P);
    const enc = at.encerrados ? '<p class="dv-enc">+ ' + plural(at.encerrados, 'contrato deste cliente já está 100% faturado e fica fora da lista.', 'contratos deste cliente já estão 100% faturados e ficam fora da lista.') + '</p>' : '';
    if (!at.total) return sec('atas', 'atas', 'Atas e contratos', sub, '', '<p class="dv-vazio">Nenhuma ata ou contrato ganho com saldo em aberto.</p>' + enc, P);
    const k = '<div class="dv-kpis">'
      + kpi('Contratado', brl0(at.contratado), plural(at.total, 'contrato', 'contratos') + ' com saldo')
      + (at.semFaturado ? kpi('Faturado', '—', 'o modelo não liberou o valor faturado para o seu login', 'gray')
         : kpi('Faturado', brl0(at.faturado), pctN(at.pctFaturado) + ' do contratado', 'green'))
      + kpi('Em aberto', brl0(at.emAberto), plural(at.itens, 'item a empenhar', 'itens a empenhar'), 'blue')
      + (at.saldoEmRisco != null ? kpi('Saldo em risco', brl0(at.saldoEmRisco), 'sobra no ritmo atual até o fim da vigência', at.saldoEmRisco >= 1 ? 'amber' : 'green') : '')
      + kpi('Vencendo', int(at.criticos.length), at.criticos.length ? brl0(at.emAbertoCritico) + ' em até ' + R.ataCriticoDias + ' dias' : 'nada vence em ' + R.ataCriticoDias + ' dias', at.criticos.length ? 'red' : null)
      + kpi('Nunca faturou', int(at.nuncaFaturou.length), at.nuncaFaturou.length ? 'itens sem uma única nota' : 'todo item já faturou', at.nuncaFaturou.length ? 'red' : null)
      + '</div>';
    const base = n0(at.faturado) + at.emAberto;
    const cons = at.semFaturado ? '<div class="dv-cons"><div class="dv-cons-t"><span>Faturado × em aberto</span><b>—</b></div><p class="dv-vazio">Sem o valor faturado (segurança do modelo da Licitação) não dá para medir o consumo nem projetar o ritmo — o em aberto segue valendo.</p></div>'
      : '<div class="dv-cons"><div class="dv-cons-t"><span>Faturado × em aberto</span><b>' + pctN(at.pctFaturado) + ' do contratado</b></div>'
      + '<div class="dv-cons-bar"><i class="f" style="width:' + larg(base > 0 ? at.faturado / base : 0) + '"></i><i class="a" style="width:' + larg(base > 0 ? at.emAberto / base : 0) + '"></i></div>'
      + '<div class="dv-cons-leg"><span><i class="f"></i>Faturado <b>' + brl0(at.faturado) + '</b></span><span><i class="a"></i>Em aberto <b>' + brl0(at.emAberto) + '</b></span><span>Contratado <b>' + brl0(at.contratado) + '</b></span></div></div>';
    const maxFam = Math.max.apply(null, at.porFamilia.map(f => f.emAberto).concat([1]));
    const fam = barrasH(at.porFamilia.slice(0, 6).map(f => ({ rot: f.familia, dir: brlK(f.emAberto) + ' · ' + plural(f.itens, 'item', 'itens'), v: f.emAberto / maxFam, cls: ' dv-bar--amber' })));
    const lista = at.todos.map((o, i) => contratoHtml(o, P, i < 2 || o.classe === 'vencido' || o.classe === 'critico')).join('');
    const extra = P ? '' : '<div class="dv-ct-tools"><button type="button" class="dv-btn sec" data-acao="ct-todos">Abrir todos os itens</button></div>';
    return sec('atas', 'atas', 'Atas e contratos', sub, extra,
      k + '<div class="dv-cols dv-cols-21">' + cons + '<div><div class="dv-sub dv-sub--topo">Saldo em aberto por família</div>' + fam + '</div></div>'
      + '<div class="dv-sub">Contratos e itens</div><div class="dv-cts">' + lista + '</div>' + enc, P);
  }

  function contratoHtml(o, P, aberto){
    const cl = CLASSE_ATA[o.classe] || ['—', 'gray'];
    const atras = o.pctPrazo != null && o.pctFaturado != null && o.pctFaturado + 0.05 < o.pctPrazo;
    const grave = atras && (o.classe === 'vencido' || o.classe === 'critico');
    const pz = '<div class="dv-pz' + (grave ? ' dv-pz--grave' : atras ? ' dv-pz--atras' : '') + '">'
      + '<div class="dv-pz-tr"><i style="width:' + larg(Math.min(1, o.pctFaturado || 0)) + '"></i>'
      + (o.pctPrazo != null ? '<span class="dv-pz-hj" style="left:' + larg(o.pctPrazo) + '" title="hoje"></span>' : '') + '</div>'
      + '<div class="dv-pz-lg"><span><b>' + pctN(o.pctFaturado) + '</b> faturado</span>' + (o.pctPrazo != null ? '<span><b>' + pctN(o.pctPrazo) + '</b> do prazo</span>' : '<span>sem data de início</span>') + '</div></div>';
    const meta = [plural(o.itens, 'item com saldo', 'itens com saldo')];
    if (o.concluidos) meta.push(plural(o.concluidos, 'concluído', 'concluídos'));
    if (o.nuncaFaturou) meta.push(o.nuncaFaturou + ' nunca faturou');
    const lentos = o.itensLista.filter(a => a.situacao === 'atrasado').length;
    if (lentos) meta.push(plural(lentos, 'em ritmo baixo', 'em ritmo baixo'));
    if (o.familias.length) meta.push(o.familias.slice(0, 3).join(', ') + (o.familias.length > 3 ? '…' : ''));
    const cab = '<div class="dv-ct-n"><b>' + esc(o.oportunidade) + '</b>' + tag(cl[0], cl[1]) + '<small>' + esc(meta.join(' · ')) + '</small></div>' + pz
      + '<div class="dv-ct-v"><div><small>Contratado</small><b>' + brl0(o.contratado) + '</b></div>'
      + '<div><small>Faturado</small><b>' + (o.semFaturado ? '—' : brl0(o.faturado)) + '</b></div>'
      + '<div><small>Em aberto</small><b class="ab">' + brl0(o.emAberto) + '</b></div></div>';
    const fx = [];
    fx.push('<span class="dv-fx">' + ico('cal') + 'Vigência ' + (o.inicio ? '<b>' + dataBR(o.inicio) + '</b> a ' : 'até ') + '<b>' + dataBR(o.vigencia) + '</b>'
      + (o.diasRestantes != null ? ' · ' + (o.diasRestantes < 0 ? 'venceu há ' + (-o.diasRestantes) + ' dias' : o.diasRestantes === 0 ? 'vence hoje' : 'faltam ' + o.diasRestantes + ' dias') : '') + '</span>');
    if (o.ritmoNecessarioMes != null) fx.push('<span class="dv-fx' + (atras ? ' dv-fx--amber' : '') + '">' + ico('ritmo') + 'Precisa faturar <b>' + brl0(o.ritmoNecessarioMes) + '/mês</b>'
      + (o.ritmoAtualMes != null ? ' · ritmo de hoje ' + brl0(o.ritmoAtualMes) + '/mês' : '') + '</span>');
    if (o.saldoEmRisco != null) fx.push(o.diasRestantes != null && o.diasRestantes < 0
      ? '<span class="dv-fx dv-fx--red">' + ico('alerta') + 'Venceu com <b>' + brl0(o.saldoEmRisco) + '</b> sem faturar</span>'
      : o.saldoEmRisco >= 1 ? '<span class="dv-fx dv-fx--red">' + ico('alerta') + 'No ritmo de hoje sobram <b>' + brl0(o.saldoEmRisco) + '</b> no fim</span>'
      : '<span class="dv-fx dv-fx--green">' + ico('check') + 'No ritmo de hoje o saldo <b>se esgota no prazo</b></span>');
    const itens = '<div class="dv-tw"><table class="dv-t"><thead><tr><th>Item</th><th class="r">Contratado</th><th class="r">Faturado</th><th class="r">Em aberto</th><th>% faturado</th><th>Situação</th></tr></thead><tbody>'
      + o.itensLista.map(a => {
        const si = SIT_ITEM[a.situacao] || ['—', 'gray'];
        const vermelho = a.situacao === 'vencido' || a.situacao === 'nunca';
        const tr = vermelho ? 'dv-tr--red' : a.situacao === 'atrasado' ? 'dv-tr--amber' : a.situacao === 'concluido' ? 'dv-tr--off' : '';
        const bt = a.situacao === 'concluido' ? ' dv-bar--gray' : vermelho ? ' dv-bar--red' : a.situacao === 'atrasado' ? ' dv-bar--amber' : ' dv-bar--green';
        const det = [a.cod && a.cod !== a.produto ? a.cod : '', a.familia, a.vigencia && a.vigencia !== o.vigencia ? 'vigência ' + dataBR(a.vigencia) : ''].filter(Boolean).join(' · ');
        return '<tr class="' + tr + '"><td><b>' + esc(a.produto || a.cod || '—') + '</b>' + (det ? '<small>' + esc(det) + '</small>' : '') + '</td>'
          + '<td class="r">' + brl0(a.contratado) + '</td><td class="r">' + (a.semFaturado ? '—' : brl0(a.faturado)) + '</td>'
          + '<td class="r"><b>' + brl0(a.emAberto) + '</b>' + (a.situacao === 'atrasado' && a.saldoEmRisco >= 1 ? '<small>sobram ' + esc(brlK(a.saldoEmRisco)) + ' no ritmo</small>' : '') + '</td>'
          + '<td><div class="dv-pc">' + barra(Math.min(1, a.pctFaturado || 0), bt) + '<span>' + pctN(a.pctFaturado) + '</span></div></td>'
          + '<td>' + tag(si[0], si[1]) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    const corpo = '<div class="dv-ct-body"><div class="dv-ct-fx">' + fx.join('') + '</div>' + itens + '</div>';
    if (P) return '<div class="dv-ct dv-ct--' + o.classe + '"><div class="dv-ct-h">' + cab + '</div>' + corpo + '</div>';
    return '<details class="dv-ct dv-ct--' + o.classe + '"' + (aberto ? ' open' : '') + '><summary class="dv-ct-h">' + cab + ico('chev', 'dv-ct-chev') + '</summary>' + corpo + '</details>';
  }

  // rodapé: de onde vem cada número
  function rodape(d){
    return '<footer class="dv-foot">Fontes no Power BI, lidas com o login de quem gerou (RLS): <b>Comercial</b> (Sales Report — fato Faturamentos com o filtro-base: sem INTERCOMPANY, Gera Fatura a receber = SIM, NF ' + NF_OCULTAS.join(', ') + ' oculta; Calendário Cirúrgico — fato Cirurgias_Agrupadas), '
      + '<b>Consignação</b> (Saldo por Nota: modelo 55, NF preenchida, status Aprovado, grupo de depósito consignado, Exibir no BI = Sim), '
      + '<b>Oportunidades</b> (só quando o Salesforce não responde: cotações e oportunidades fora das fases fechadas, pelo código do cliente) e <b>Licitação</b> (Análise de Contratos: proposta sincronizada, item ganho, proposta ganha, aguardando empenho, com vigência; a projeção de saldo em risco estende o ritmo médio de faturamento desde o início do contrato até o fim da vigência). Salesforce, só leitura: Conta por CNPJ e as cotações e oportunidades abertas dessa Conta. '
      + (d.faltando && d.faltando.length ? 'Campos que os modelos não têm: ' + esc(d.faltando.join(' · ')) + '. ' : '') + 'Nenhum dado é gravado. Gerado em ' + esc(new Date(d.geradoEm).toLocaleString('pt-BR')) + '.</footer>';
  }

  // ── tela: atalhos, ganchos, abrir/fechar contratos, pílula que acompanha ──
  function ligarTela(d){
    const out = $('dv-out');
    out.querySelectorAll('[data-ir]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      const alvo = $('dv-s-' + a.dataset.ir);
      if (alvo) alvo.scrollIntoView({ behavior: reduzido() ? 'auto' : 'smooth', block:'start' });
    }));
    out.querySelectorAll('[data-acao="imprimir"]').forEach(b => b.addEventListener('click', imprimir));
    const tg = out.querySelector('[data-acao="ct-todos"]');
    if (tg) tg.addEventListener('click', () => {
      const ds = Array.from(out.querySelectorAll('details.dv-ct'));
      const abrir = ds.some(x => !x.open);
      ds.forEach(x => { x.open = abrir; });
      tg.textContent = abrir ? 'Recolher os itens' : 'Abrir todos os itens';
    });
    const gb = $('dv-gan-btn');
    if (gb) gb.addEventListener('click', () => ganchos(d));
    espiar(out);
  }
  // pílula da seção que está sendo lida: a ÚLTIMA seção cujo topo já passou
  // logo abaixo da barra. Rola dentro do .dept-main (shell) ou da janela
  // (celular): o 'scroll' é ouvido na captura, pega os dois.
  let _espia = null;
  function espiar(out){
    if (_espia) document.removeEventListener('scroll', _espia, true);
    const links = {};
    out.querySelectorAll('.dv-nav a[data-ir]').forEach(a => { links[a.dataset.ir] = a; });
    const secs = Array.from(out.querySelectorAll('[data-sec]')).filter(x => links[x.dataset.sec]);
    const nav = out.querySelector('.dv-nav'), trilho = out.querySelector('.dv-nav-l');
    let pend = false, atual = null;
    const calc = () => {
      pend = false;
      if (out.hidden || !secs.length) return;
      const lim = (nav ? nav.getBoundingClientRect().bottom : 0) + 48;
      let ativa = secs[0].dataset.sec;
      secs.forEach(x => { if (x.getBoundingClientRect().top <= lim) ativa = x.dataset.sec; });
      if (ativa === atual) return;
      atual = ativa;
      Object.keys(links).forEach(k => links[k].classList.toggle('on', k === ativa));
      const a = links[ativa];
      if (a && trilho && (a.offsetLeft < trilho.scrollLeft || a.offsetLeft + a.offsetWidth > trilho.scrollLeft + trilho.clientWidth))
        trilho.scrollTo({ left: a.offsetLeft - 12, behavior: reduzido() ? 'auto' : 'smooth' });
    };
    _espia = () => { if (!pend) { pend = true; requestAnimationFrame(calc); } };
    document.addEventListener('scroll', _espia, true);
    calc();
  }

  // ── papel: o dossiê redesenhado num nó só dele, pronto para o Ctrl+P ──
  function montarPapel(d){
    let el = document.getElementById('dv-papel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dv-papel'; el.className = 'bm-tema-claro'; el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    }
    el.innerHTML = montarDoc(d, true);
    document.body.classList.add('dv-com-papel');
    // rodapé de cada folha (caixas de margem do @page; quem não suporta ignora)
    let st = document.getElementById('dv-papel-pagina');
    if (!st) { st = document.createElement('style'); st.id = 'dv-papel-pagina'; document.head.appendChild(st); }
    const cssTxt = s => '"' + String(s).replace(/[\\"]/g, '').replace(/[\r\n]+/g, ' ') + '"';
    const nome = d.cliente.nome || (d.cliente.salesforce && d.cliente.salesforce.nome) || 'Cliente';
    const fonte = 'font-family:Manrope,"Segoe UI",sans-serif;font-size:7.5pt;color:#8C99AD;';
    st.textContent = '@media print{@page{'
      + '@bottom-left{content:' + cssTxt('Dossiê de Visita · ' + nome + ' · ' + dataBR(d.hoje)) + ';' + fonte + '}'
      + '@bottom-right{content:"página " counter(page) " de " counter(pages);' + fonte + '}}}';
  }
  function limparPapel(){
    const el = document.getElementById('dv-papel');
    if (el) el.remove();
    document.body.classList.remove('dv-com-papel');
  }
  function imprimir(){
    if (!ST.dossie) { msg('Gere um dossiê antes de imprimir.', 'aviso'); return; }
    montarPapel(ST.dossie);
    window.print();
  }
  // o nome do PDF salvo sai do título da página
  window.addEventListener('beforeprint', () => {
    if (!ST.dossie || ST._titulo) return;
    ST._titulo = document.title;
    document.title = 'Dossiê de Visita - ' + (ST.dossie.cliente.nome || 'Cliente') + ' - ' + dataBR(ST.dossie.hoje).replace(/\//g, '-');
  });
  window.addEventListener('afterprint', () => { if (ST._titulo) { document.title = ST._titulo; ST._titulo = null; } });

  // ── ganchos: pede à IA e desenha (fase 3) ───────────────────────
  async function ganchos(d){
    const box = $('dv-gan-box'); if (!box) return;
    box.innerHTML = '<div class="dv-gan-vazio"><p>Lendo o dossiê e escrevendo os ganchos…</p></div>';
    const botao = rot => '<button id="dv-gan-btn" class="dv-btn sec dv-gan-acao" type="button">' + ico('ganchos') + rot + '</button>';
    try {
      const j = await pedirGanchos(d);
      if (!j.ganchos || !j.ganchos.length){
        box.innerHTML = '<p class="dv-vazio">' + (j.semDados ? 'Sem dados suficientes para sugerir ganchos.' : 'A IA não trouxe nenhuma sugestão sustentada pelos números — nada foi inventado.') + '</p>' + botao('Tentar de novo');
      } else {
        d.ganchos = j;
        box.innerHTML = ganchosHtml(j) + botao('Gerar de novo');
        if (ST.dossie === d) montarPapel(d);        // o papel passa a levar os ganchos
      }
    } catch (err) {
      box.innerHTML = '<p class="dv-off-p">' + esc(err.message || String(err)) + '</p>' + botao('Tentar de novo');
    }
    const gb = $('dv-gan-btn');
    if (gb) gb.addEventListener('click', () => ganchos(d));
  }

  // ── agenda de amanhã (fase 4) ───────────────────────────────────
  async function agenda(dias){
    const box = $('dv-agenda-box'); if (!box) return;
    box.hidden = false;
    box.innerHTML = '<p class="dv-vazio">Lendo a sua agenda…</p>';
    try {
      const j = await lerAgenda(dias == null ? 1 : dias);
      const titulo = '<h4>Agenda de ' + (dias === 0 ? 'hoje' : 'amanhã') + ' · ' + dataBR(j.dia) + '</h4>';
      if (!j.disponivel){
        box.innerHTML = titulo + '<div class="dv-ag-off"><b>Agenda ainda não ligada.</b><br>' + esc(j.motivo || '') + '</div>';
        return;
      }
      if (!j.eventos.length){ box.innerHTML = titulo + '<p class="dv-vazio">Nenhum compromisso nesse dia.</p>'; return; }
      box.innerHTML = titulo + '<ul>' + j.eventos.map(e => {
        const hora = e.inicio ? String(e.inicio).slice(11,16) : '—';
        const cli = e.cliente
          ? '<button class="dv-btn" data-cnpj="' + esc(e.cliente.cnpj) + '" type="button">Dossiê' + (e.confianca === 'media' ? ' (confirmar)' : '') + '</button>'
          : '';
        return '<li><span class="h">' + esc(hora) + '</span><span class="a">' + esc(e.assunto)
          + '<small>' + esc([e.local, e.cliente ? 'cliente: ' + e.cliente.nome : 'sem cliente reconhecido'].filter(Boolean).join(' · ')) + '</small></span>' + cli + '</li>';
      }).join('') + '</ul>'
        + '<p class="dv-gan-o" style="margin-top:8px">' + j.comCliente + ' de ' + j.eventos.length + ' compromissos casaram com um cliente da carteira, pelo nome no assunto ou no local.</p>';
      box.querySelectorAll('button[data-cnpj]').forEach(b => b.addEventListener('click', () => {
        $('dv-cnpj').value = cnpjFmt(b.dataset.cnpj);
        gerar(b.dataset.cnpj);
      }));
    } catch (err) {
      box.innerHTML = '<div class="dv-ag-off">' + esc(err.message || String(err)) + '</div>';
    }
  }

  // ── busca por nome com sugestões (fase 3) ────────────────────────
  let _tBusca = null;
  function fecharSug(){ const s = $('dv-sug'); if (s){ s.hidden = true; s.innerHTML = ''; } }
  async function sugerir(termo){
    const cx = $('dv-sug'); if (!cx) return;
    cx.hidden = false;
    cx.innerHTML = '<div class="dv-sug-vazio">Procurando…</div>';
    try {
      // a busca só precisa do modelo do Comercial; os outros 3 ficam para o
      // dossiê (ST.pronto continua false para o boot completo acontecer lá)
      if (!ST.catComercial) { await pbiConnect(); await carregarCatalogo(MODELOS.comercial, F); ST.catComercial = true; }
      const lista = await buscarPorNome(termo);
      if (!lista.length){ cx.innerHTML = '<div class="dv-sug-vazio">Nenhum cliente com esse nome no seu acesso.</div>'; return; }
      cx.innerHTML = lista.map(x => '<button type="button" data-cnpj="' + esc(x.cnpj) + '" role="option">'
        + '<b>' + esc(x.nome) + '</b><small>' + esc([cnpjFmt(x.cnpj), [x.cidade, x.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ')) + '</small></button>').join('');
      cx.querySelectorAll('button[data-cnpj]').forEach(b => b.addEventListener('click', () => {
        $('dv-cnpj').value = cnpjFmt(b.dataset.cnpj); fecharSug(); gerar(b.dataset.cnpj);
      }));
    } catch (err) {
      cx.innerHTML = '<div class="dv-sug-vazio">' + esc(err.message || String(err)) + '</div>';
    }
  }

  // ── boot ────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const inp = $('dv-cnpj');
    // o campo aceita CNPJ ou nome: se for só dígito, formata como CNPJ;
    // se for texto, sugere clientes do BI (respeitando a RLS do vendedor)
    inp.addEventListener('input', () => {
      const bruto = inp.value;
      const dig = soDigitos(bruto);
      const soNumero = /^[\d.\-/ ]*$/.test(bruto);
      if (soNumero){
        fecharSug();
        inp.value = dig.length === 14 ? cnpjFmt(dig) : dig;
        return;
      }
      clearTimeout(_tBusca);
      const termo = bruto.trim();
      if (termo.length < 3){ fecharSug(); return; }
      _tBusca = setTimeout(() => sugerir(termo), 350);
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter'){
        const prim = $('dv-sug') && !$('dv-sug').hidden && $('dv-sug').querySelector('button[data-cnpj]');
        if (prim) prim.click(); else acionar(inp.value);
      }
      if (e.key === 'Escape') fecharSug();
    });
    document.addEventListener('click', e => { if (!e.target.closest('.dv-busca')) fecharSug(); });
    $('dv-btn').addEventListener('click', () => acionar(inp.value));
    $('dv-agenda').addEventListener('click', () => agenda(1));
    $('dv-print').addEventListener('click', imprimir);
    const url = new URLSearchParams(location.search).get('cnpj');
    if (url && soDigitos(url).length === 14) { inp.value = cnpjFmt(soDigitos(url)); gerar(url); }
  });
  // botão/Enter: dígito vira dossiê, texto vira busca
  function acionar(v){
    const dig = soDigitos(v);
    if (dig.length === 14) { fecharSug(); gerar(dig); return; }
    const termo = String(v || '').trim();
    if (termo.length >= 3 && !/^[\d.\-/ ]+$/.test(termo)) { sugerir(termo); return; }
    msg('Digite o CNPJ com 14 dígitos ou pelo menos 3 letras do nome do cliente.', 'erro');
  }
  window.DV = { gerar, agenda, ganchos: () => ST.dossie && ganchos(ST.dossie), buscar: sugerir,
                estado: ST, campos: () => window.dvCampos && window.dvCampos() };
})();
