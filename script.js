// ================================================================
// BIOMEDICAL — Portal Corporativo · Script Global
// ================================================================

// ---- CATÁLOGO DO PORTAL ----------------------------------------
// portal-catalogo.js é a fonte única da busca global (áreas, módulos,
// automações e agentes de IA). A home já o carrega por <script>; nas
// páginas internas quem injeta é este arquivo, que todas carregam.
if (!window.PORTAL_CATALOGO && !window._bmCatalogoPronto) {
  window._bmCatalogoPronto = new Promise(function (pronto) {
    var s = document.createElement('script');
    s.src = (location.pathname.indexOf('/pages/') >= 0 ? '../' : '') + 'portal-catalogo.js?v=19';
    s.onload = pronto; s.onerror = pronto;
    (document.head || document.documentElement).appendChild(s);
  });
}

// Ano no rodapé
document.addEventListener('DOMContentLoaded', () => {
  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
});

// ================================================================
// RECENTES — registra a visita da página atual (áreas e módulos)
// Compartilha a chave 'bm_recentes' com a faixa de Recentes da home.
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  const KEY = 'bm_recentes';
  const MAX = 6;

  // Só registra em páginas internas (que têm cabeçalho de área)
  const h1 = document.querySelector('.area-header h1');
  if (!h1) return;

  const file = (location.pathname.split('/').pop() || '').trim();
  if (!file || file === 'index.html') return;

  // hrefs da home apontam para a pasta pages/
  const href = 'pages/' + file;
  // data-recente: nome do atalho quando o h1 sozinho é ambíguo — os módulos da
  // área Vendedor se chamam Comercial, Licitação…, e um atalho "Comercial"
  // levaria ao módulo do Vendedor, não ao departamento.
  const name = (h1.getAttribute('data-recente') || h1.textContent).trim();

  // meta: se houver um departamento-pai no breadcrumb, usa ele (é um módulo);
  // senão, é a própria home do departamento.
  const crumbs = [...document.querySelectorAll('.breadcrumb a')]
    .map(a => a.textContent.trim())
    .filter(t => t && t.toLowerCase() !== 'portal');
  const meta = crumbs.length ? crumbs[crumbs.length - 1] : 'Departamento';

  // ícone: reaproveita o da sidebar (home de depto) ou usa um genérico de módulo
  const sbIc = document.querySelector('.area-sidebar .sb-ic svg');
  const iconHTML = sbIc
    ? sbIc.outerHTML
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>';

  let arr;
  try { arr = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { arr = []; }
  arr = arr.filter(x => x.href !== href);
  arr.unshift({ name, meta, href, ext: false, iconHTML, ts: Date.now() });
  arr = arr.slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) {}
});

// ================================================================
// SIDEBAR — grupos expansíveis (submódulos)
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.area-sidebar .sb-parent').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.sb-group').classList.toggle('open');
    });
  });
});

// ================================================================
// BUSCA GLOBAL (Ctrl+K) — palette compartilhado em todas as páginas
// Não roda na home (index.html já tem o palette inline com #cmdk-overlay).
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('cmdk-overlay')) return;            // home já tem o seu
  const header = document.querySelector('.site-header .container');
  if (!header) return;
  // O índice sai do CATÁLOGO ÚNICO (portal-catalogo.js), injetado no topo
  // deste arquivo — não existe mais lista de módulos/agentes/automações
  // duplicada aqui, que era o que deixava a busca cheia de módulo velho.
  (window._bmCatalogoPronto || Promise.resolve()).then(() => montarBusca(header));
});

function montarBusca(header) {
  const CAT = window.PORTAL_CATALOGO;
  if (!CAT) { console.warn('[busca] portal-catalogo.js não carregou; palette desligado'); return; }
  if (document.getElementById('cmdk-overlay')) return;

  const inPages = location.pathname.indexOf('/pages/') !== -1;
  const P = inPages ? '' : 'pages/';                              // prefixo das páginas

  const ic        = CAT.ic;                                       // ícones do catálogo
  const catalogo  = CAT.build(P);
  const index     = catalogo.itens;                               // Áreas, Sistemas, Módulos, Automações, Agentes de IA
  const areaDrill = catalogo.drill;                               // drill-down por área

  // ---- injeta botão no header + overlay ----
  if (!header.querySelector('.header-spacer')) {
    const sp = document.createElement('span'); sp.className = 'header-spacer'; header.appendChild(sp);
  }
  const trigger = document.createElement('button');
  trigger.className = 'header-search'; trigger.id = 'search-trigger'; trigger.setAttribute('aria-label', 'Buscar (Ctrl+K)');
  trigger.innerHTML = ic.search + '<span class="ph">Buscar sistemas, áreas…</span><span class="kbd">Ctrl K</span>';
  header.appendChild(trigger);

  const overlay = document.createElement('div');
  overlay.className = 'cmdk-overlay'; overlay.id = 'cmdk-overlay';
  overlay.innerHTML =
    '<div class="cmdk" role="dialog" aria-modal="true" aria-label="Busca global">' +
      '<div class="cmdk-input-wrap">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
        '<input type="text" class="cmdk-input" id="cmdk-input" placeholder="Buscar sistemas, áreas e ferramentas…" autocomplete="off">' +
        '<span class="cmdk-esc">ESC</span>' +
      '</div>' +
      '<div class="cmdk-results" id="cmdk-results"></div>' +
    '</div>';
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#cmdk-input');
  const results = overlay.querySelector('#cmdk-results');
  let active = 0, filtered = index.slice(), view = null;

  function sourceList() {
    if (!view) return index;
    const d = areaDrill[view];
    const back = { group: '', name: '← Todas as áreas e sistemas', cat: 'Voltar', href: '#', back: true, iconHTML: ic.back };
    const openArea = { group: view, name: 'Abrir ' + view + ' · visão geral', cat: 'Departamento', href: d.page, ext: false, iconHTML: ic.grid };
    const marca = (arr, g) => (arr || []).map(m => Object.assign({ group: g + ' · ' + view, ext: false }, m));
    return [back, openArea]
      .concat(marca(d.items, 'Módulos'))
      .concat(marca(d.automacoes, 'Automações'))
      .concat(marca(d.agentes, 'Agentes de IA'));
  }
  function render() {
    if (!filtered.length) { results.innerHTML = '<div class="cmdk-empty">Nenhum resultado encontrado.</div>'; return; }
    let html = '', lastGroup = '\u0000';
    filtered.forEach((item, i) => {
      if (item.group !== lastGroup) { if (item.group) html += '<div class="cmdk-group-label">' + item.group + '</div>'; lastGroup = item.group; }
      const arrow = item.back ? '<polyline points="15 18 9 12 15 6"/>' : (item.ext ? '<path d="M7 17L17 7"/><polyline points="7 7 17 7 17 17"/>' : '<polyline points="9 18 15 12 9 6"/>');
      html += '<div class="cmdk-item ' + (i === active ? 'active' : '') + '" data-i="' + i + '">' +
        '<span class="ci-icon">' + item.iconHTML + '</span>' +
        '<div class="ci-body"><div class="ci-name">' + item.name + '</div><div class="ci-cat">' + item.cat + '</div></div>' +
        '<svg class="ci-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + arrow + '</svg>' +
        '</div>';
    });
    results.innerHTML = html;
  }
  function filter(q) {
    q = String(q || '').trim();
    // Mesmo portão das páginas: não lista o que a pessoa não pode abrir.
    // nav-sidebar.js publica bmPodeAbrir (páginas internas); sem ele não
    // filtra nada — a própria página já passou pelo guard.
    const podeVer = it => it.ext || it.back ||
      (typeof window.bmPodeAbrir === 'function' ? window.bmPodeAbrir(it.href) : true);
    if (!view) {
      filtered = index.filter(it => podeVer(it) && CAT.casa(it, q));
      active = 0;
    } else {
      const src = sourceList(), back = src[0];
      const f = src.slice(1).filter(it => podeVer(it) && CAT.casa(it, q));
      filtered = [back].concat(f);
      active = filtered.length > 1 ? 1 : 0;
    }
    render();
  }
  function go(item) {
    if (!item) return;
    if (item.back) { view = null; input.value = ''; filter(''); input.focus(); return; }
    if (item.drillKey) { view = item.drillKey; input.value = ''; filter(''); input.focus(); return; }
    closeP();
    if (item.ext) window.open(item.href, '_blank', 'noopener'); else window.location.href = item.href;
  }
  function openP() { overlay.classList.add('open'); view = null; input.value = ''; filter(''); setTimeout(() => input.focus(), 30); }
  function closeP() { overlay.classList.remove('open'); view = null; }

  trigger.addEventListener('click', openP);
  input.addEventListener('input', () => filter(input.value));
  results.addEventListener('click', e => { const el = e.target.closest('.cmdk-item'); if (el) go(filtered[parseInt(el.dataset.i, 10)]); });
  results.addEventListener('mousemove', e => { const el = e.target.closest('.cmdk-item'); if (el) { active = parseInt(el.dataset.i, 10); render(); } });
  overlay.addEventListener('click', e => { if (e.target === overlay) closeP(); });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); overlay.classList.contains('open') ? closeP() : openP(); return; }
    if (!overlay.classList.contains('open')) return;
    if (e.key === 'Escape') { if (view) { view = null; input.value = ''; filter(''); } else { closeP(); } }
    else if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); render(); scrollActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); scrollActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(filtered[active]); }
  });
  function scrollActive() { const el = results.querySelector('.cmdk-item.active'); if (el) el.scrollIntoView({ block: 'nearest' }); }
}

// ================================================================
// AGENTE-GUIA — "Bio", o guia do portal (base de conhecimento local)
// Substitui o antigo iframe do Copilot. 100% no navegador, sem custo.
// Gancho de IA (LLM) pronto em GUIDE_LLM — desligado por padrão.
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Guia flutuante "Bio" desativado em TODAS as páginas (a pedido).
  // Para reativar, remova o return abaixo.
  // ATENÇÃO: a base de conhecimento deste guia (AREAS/MODULES abaixo) é
  // CÓDIGO MORTO e está desatualizada. Se algum dia religar o guia, troque
  // essas listas pelo catálogo único (window.PORTAL_CATALOGO, portal-catalogo.js)
  // em vez de manter uma terceira cópia dos módulos do portal.
  return;

  // ---- caminhos relativos (funciona da raiz e de /pages/) ----
  const inPages = location.pathname.indexOf('/pages/') !== -1;
  const P = inPages ? '' : 'pages/';

  // ---- gancho de IA (futuro) — quando ligar, plugue o endpoint ----
  // Ex.: webhook do Power Automate ou Azure Function que recebe
  // { question, context } e devolve { answer }.
  const GUIDE_LLM = {
    enabled:  false,
    endpoint: '',
    async ask(question, context) {
      const r = await fetch(this.endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ question, context })
      });
      if (!r.ok) throw new Error('LLM HTTP ' + r.status);
      const d = await r.json();
      return d.answer || d.text || '';
    }
  };

  // ---- BASE DE CONHECIMENTO DO PORTAL ----------------------------
  // Áreas (departamentos)
  const AREAS = [
    ['Comercial','comercial.html','Vendas, cotações, clientes, funil e processos comerciais.','vendas venda faturamento comercial cliente clientes cotacao cotacoes proposta funil oportunidade oportunidades negociacao negociacoes fca sales report receita pedido pedidos'],
    ['Financeiro','financeiro.html','Contas a receber, inadimplência, baixas e cartas de cobrança.','financeiro financas cobranca cobrancas inadimplencia titulos vencidos a vencer contas pagar receber dre boleto fatura recebimento pagamento fluxo de caixa'],
    ['Logística','logistica.html','Fluxo logístico, relatórios de distribuição e cotação de frete.','logistica distribuicao carga cargas expedicao rotas entregas transporte fornecedor fornecedores frete cotacao transportadora'],
    ['Marketing','marketing.html','Captação de leads, formulários e materiais institucionais.','marketing campanha campanhas evento eventos redes sociais instagram formularios materiais comunicacao midia'],
    ['Estoque','estoque.html','Saldo, ruptura, validade curta, consignação e InventarIA.','estoque consignado saldo inventario ordens de compra roi armazem deposito produto material'],
    ['Contábil','contabil.html','Margem de contribuição e gestão de custos SG&A.','contabil contabilidade fiscal imposto impostos obrigacoes acessorias fechamento patrimonio inventario nota fiscal escrituracao'],
    ['Licitação','licitacao.html','Editais, Sales Report da Licitação e Comitê de Produto.','licitacao licitacoes edital editais pregao pregoes contrato contratos publico governo orgao publico compra publica'],
    ['Administrativo','administrativo.html','Requisições de compra, lançamento de faturas no Dynamics e pagamento de comissão dos vendedores PJ.','administrativo requisicao requisicoes compra compras oc ordem de compra comissao comissionado fatura lancamento diario'],
    ['Produtos','produtos.html','Linhas, estratégias e famílias de produtos, e cadastro de novos SKUs.','produtos produto familia familias estrategia registro registros anvisa regulatorio portfolio fornecedor pesquisa mercado'],
    ['Pessoas','pessoas.html','RH, recrutamento, treinamento, folha, benefícios e clima.','pessoas rh recursos humanos recrutamento selecao treinamento desenvolvimento folha pagamento salario beneficio beneficios clima saude seguranca ferias'],
    ['Qualidade','qualidade.html','POPs, avaliação de fornecedores e condições das filiais.','qualidade documento pop nao conformidade conformidades auditoria auditorias regulatorio anvisa certificacao iso'],
    ['TI & Sistemas','ti.html','Chamados, sistemas, infraestrutura e Microsoft Azure.','ti tecnologia informatica sistema sistemas infra infraestrutura chamado chamados suporte azure nuvem servidor vm firewall internet automacao integracao']
  ];

  // Módulos / subpáginas [nome, arquivo, área, palavras-chave]
  const MODULES = [
    ['Sales Report','comercial-sales-report.html','Comercial','relatorio vendas faturamento indicadores dashboard'],
    ['Análise de Vendas','comercial-vendas.html','Comercial','analise vendas faturamento desempenho'],
    ['Comportamento de Clientes','comercial-comportamento-clientes.html','Comercial','comportamento cliente clientes curva abc pareto ciclo de vida fiel fieis recorrente em risco dormente perdido recencia carteira matriz familia mes recompra ticket medio'],
    ['Base de Notas Fiscais','comercial-base-notas-fiscais.html','Comercial','base notas fiscais nf faturamento item nota detalhado exportar excel'],
    ['Análise de Clientes','comercial-clientes.html','Comercial','analise clientes carteira'],
    ['Novos Negócios','comercial-novos-negocios.html','Comercial','novos negocios prospeccao'],
    ['Funil de Oportunidades','comercial-funil.html','Comercial','funil pipeline etapas negociacao negociacoes oportunidade oportunidades'],
    ['FCA','comercial-fca.html','Comercial','fca ficha atividade comercial visita'],
    ['Materiais e Recursos','comercial-materiais.html','Comercial','materiais recursos apoio'],
    ['Cobrança Automática','cobranca-automatica.html','Financeiro','cobranca carta vencidos titulos boleto inadimplencia cobrar enviar pdf sharepoint cartas de cobranca'],
    ['Cobrança · Notas em Aberto','cobranca-notas.html','Financeiro','cobranca notas em aberto faturas dynamics custtransopen nao liquidado sinief tipo de cliente responsavel status power automate selecionar notas'],
    ['Inadimplência','financeiro-inadimplencia.html','Financeiro','inadimplencia atraso devedor'],
    ['Contas a Receber','financeiro-contas-receber.html','Financeiro','contas a receber cliente recebimento'],
    ['Fluxo Logístico','logistica-fluxo-logistico.html','Logística','fluxo logistico expedicao sla tempo por etapa frete trabalhos uf dashboard power bi'],
    ['Fluxo Logístico · Relatórios','logistica-fluxo-relatorios.html','Logística','fluxo logistico relatorio relatorios ov ot analitico csv exportar'],
    ['Cotação de Frete','logistica-cotacao-frete.html','Logística','cotacao cotar frete transportadora peso cubagem volume valor nf prazo rodoviario aereo calcular'],
    ['Formulários','marketing-formularios.html','Marketing','formulario formularios lead'],
    ['Materiais e Recursos (Marketing)','marketing-materiais.html','Marketing','materiais recursos arte'],
    ['Consignado','estoque-consignado.html','Estoque','consignado material em poder de terceiros'],
    ['Inventário de Consignado','estoque-consignado-inventario.html','Estoque','inventario consignado contagem'],
    ['Saldo de Estoque','estoque-saldo.html','Estoque','saldo estoque disponibilidade'],
    ['Requisições','administrativo-requisicoes.html','Administrativo','requisicao requisicoes compra demanda dynamics oc ordem de compra'],
    ['Lançamentos Administrativos','administrativo-lancamentos.html','Administrativo','lancamento lancamentos fatura faturas nota fiscal boleto diario de faturas dynamics d365 contas a pagar fornecedor pdf'],
    ['Pagamento de Comissão','administrativo-comissao.html','Administrativo','comissao comissoes comissionado pj vendedor pagamento 2% faturamento email'],
    ['Estratégias & Famílias','produtos-familias.html','Produtos','familia familias linha produto'],
    ['Recrutamento & Seleção','pessoas-recrutamento.html','Pessoas','recrutamento selecao vaga contratacao'],
    ['Treinamento e Desenvolvimento','pessoas-treinamento.html','Pessoas','treinamento desenvolvimento capacitacao'],
    ['Clima Organizacional','pessoas-clima.html','Pessoas','clima organizacional pesquisa'],
    ['Folha de Pagamento','pessoas-folha.html','Pessoas','folha pagamento salario holerite'],
    ['Saúde & Segurança','pessoas-saude.html','Pessoas','saude seguranca trabalho sst'],
    ['Benefícios','pessoas-beneficios.html','Pessoas','beneficio beneficios vale plano'],
    ['POPs','qualidade-pops.html','Qualidade','pop pops procedimento operacional padrao'],
    ['Qualificação e Avaliação de Fornecedores','qualidade-fornecedores.html','Qualidade','qualificacao avaliacao fornecedor fornecedores dossie'],
    ['Condições Gerais das Filiais','qualidade-filiais.html','Qualidade','condicoes gerais filiais alvara licenca afe certidao'],
    ['Central de Chamados','ti-chamados.html','TI & Sistemas','chamado chamados suporte ticket'],
    ['Sistemas & Infra','ti-sistemas.html','TI & Sistemas','sistema infra infraestrutura'],
    ['Internet','ti-sistemas-internet.html','TI & Sistemas','internet link banda'],
    ["VM's",'ti-sistemas-vms.html','TI & Sistemas','vm maquina virtual servidor'],
    ['Firewalls','ti-sistemas-firewalls.html','TI & Sistemas','firewall seguranca rede'],
    ['Microsoft Azure','ti-azure.html','TI & Sistemas','azure nuvem cloud microsoft'],
    ['Licenciamento Azure','ti-azure-licenciamento.html','TI & Sistemas','licenca licenciamento azure'],
    ['Custo Azure','ti-azure-custo.html','TI & Sistemas','custo gasto azure'],
    ['Usuários Ativos','ti-azure-usuarios.html','TI & Sistemas','usuarios ativos azure'],
    ['Agentes de IA','ti-azure-agentes.html','TI & Sistemas','agente agentes ia inteligencia artificial']
  ];

  // RECORTE COMERCIAL + ESTOQUE: as duas listas acima ficam iguais às do
  // portal completo; aqui sai o que é das outras áreas, que não existem
  // neste portal (o guia levaria a página que não abre).
  const AREAS_DESTE_PORTAL = ['Comercial', 'Estoque'];
  for (let i = AREAS.length - 1; i >= 0; i--) if (AREAS_DESTE_PORTAL.indexOf(AREAS[i][0]) < 0) AREAS.splice(i, 1);
  for (let i = MODULES.length - 1; i >= 0; i--) if (AREAS_DESTE_PORTAL.indexOf(MODULES[i][2]) < 0) MODULES.splice(i, 1);

  // Sistemas externos [nome, url, palavras-chave]
  const SYSTEMS = [
    ['Dynamics 365','https://mlb.operations.dynamics.com/','erp dynamics fo financas operacoes nota fiscal pedido faturamento'],
    ['Salesforce','https://biomedical.lightning.force.com/lightning/page/home','crm salesforce comercial cliente oportunidade'],
    ['Outlook · E-mail','https://outlook.cloud.microsoft/mail/','email outlook correio mensagem microsoft'],
    ['BioPortal · Intranet','https://tibiomedical.sharepoint.com/sites/BioPortal','intranet bioportal sharepoint comunicados'],
    ['Power BI','https://app.powerbi.com/home?experience=power-bi','power bi dados relatorio dashboard bi'],
    ['Chamados TI · Zendesk','https://biomedical.zendesk.com/hc/pt-br/requests/new','chamado zendesk suporte ti ticket'],
    ['Flash · Ponto & DP','https://hros.flashapp.com.br/','flash ponto dp folha beneficio cartao'],
    ['Feedz','https://app.feedz.com.br/','feedz feedback rh desempenho'],
    ['Site Biomedical','https://biomedical.com.br/','site institucional biomedical']
  ];

  // ---- Índice unificado + normalização -----------------------------
  const norm = s => (s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  const KB = [];
  AREAS.forEach(a => KB.push({
    name: a[0], href: P + a[1], ext: false, type: 'Área', area: a[0],
    desc: a[2], blob: norm(a[0] + ' ' + a[2] + ' ' + a[3])
  }));
  MODULES.forEach(m => KB.push({
    name: m[0], href: P + m[1], ext: false, type: 'Módulo · ' + m[2], area: m[2],
    desc: '', blob: norm(m[0] + ' ' + m[2] + ' ' + m[3])
  }));
  SYSTEMS.forEach(s => KB.push({
    name: s[0], href: s[1], ext: true, type: 'Sistema externo', area: 'Sistemas',
    desc: '', blob: norm(s[0] + ' ' + s[2])
  }));

  const STOP = new Set('o a os as de da do das dos e que para por com no na nos nas em um uma onde como qual quais quero preciso fazer ver vejo achar encontrar abrir ir ao a tem ha onde esta sobre me da pra'.split(' '));

  function search(q) {
    const nq = norm(q);
    const terms = nq.split(' ').filter(t => t.length > 1 && !STOP.has(t));
    if (!terms.length) return [];
    return KB.map(item => {
      let score = 0;
      const nname = norm(item.name);
      if (nname === nq) score += 100;
      if (nname.includes(nq) && nq.length > 2) score += 40;
      terms.forEach(t => {
        if (nname.includes(t)) score += 12;
        else if (item.blob.includes(t)) score += 5;
      });
      return { item, score };
    }).filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map(r => r.item);
  }

  // ---- UI ----------------------------------------------------------
  const widget = document.createElement('div');
  widget.id = 'cp-widget';
  widget.innerHTML = `
    <div id="cp-panel" aria-label="Bio — guia do portal">
      <div class="cp-header">
        <div class="cp-header-left">
          <span class="cp-avatar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </span>
          <div>
            <div class="cp-name">Bio · Guia do Portal</div>
            <div class="cp-status"><span class="cp-online-dot"></span>Online · pergunte onde fica algo</div>
          </div>
        </div>
        <div class="cp-header-actions">
          <button class="cp-expand" id="cp-expand" title="Expandir">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
              <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
          </button>
          <button class="cp-close-btn" id="cp-close" title="Fechar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="cp-body">
        <div class="cp-msgs" id="cp-msgs"></div>
        <form class="cp-input-row" id="cp-form" autocomplete="off">
          <input type="text" id="cp-input" class="cp-input"
                 placeholder="Pergunte: onde vejo os títulos vencidos?" aria-label="Mensagem">
          <button type="submit" class="cp-send" id="cp-send" aria-label="Enviar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </form>
      </div>
    </div>
    <button id="cp-btn" aria-label="Abrir guia do portal">
      <span class="cp-btn-icon cp-icon-chat">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </span>
      <span class="cp-btn-icon cp-icon-close" style="display:none">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </span>
      <span class="cp-tooltip">Guia do portal</span>
    </button>
  `;
  document.body.appendChild(widget);

  const btn       = document.getElementById('cp-btn');
  const panel     = document.getElementById('cp-panel');
  const closeBtn  = document.getElementById('cp-close');
  const expandBtn = document.getElementById('cp-expand');
  const msgs      = document.getElementById('cp-msgs');
  const form      = document.getElementById('cp-form');
  const input     = document.getElementById('cp-input');
  let isOpen = false, greeted = false;

  const esc = s => (s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

  function scrollBottom() { msgs.scrollTop = msgs.scrollHeight; }

  function addUser(text) {
    const el = document.createElement('div');
    el.className = 'cp-msg cp-msg-user';
    el.innerHTML = `<div class="cp-bubble">${esc(text)}</div>`;
    msgs.appendChild(el); scrollBottom();
  }

  function addBot(html) {
    const el = document.createElement('div');
    el.className = 'cp-msg cp-msg-bot';
    el.innerHTML =
      `<span class="cp-bot-avatar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
       </span>
       <div class="cp-bubble">${html}</div>`;
    msgs.appendChild(el); scrollBottom();
    return el;
  }

  // monta cartões de resultado (clicáveis → navegam)
  function resultCards(items) {
    return '<div class="cp-cards">' + items.map(it =>
      `<a class="cp-card" href="${it.href}"${it.ext ? ' target="_blank" rel="noopener"' : ''}>
        <span class="cp-card-name">${esc(it.name)}${it.ext ? ' ↗' : ''}</span>
        <span class="cp-card-cat">${esc(it.type)}</span>
      </a>`
    ).join('') + '</div>';
  }

  // chips de sugestão (preenchem o input e enviam)
  function chips(list) {
    return '<div class="cp-chips">' + list.map(t =>
      `<button class="cp-chip" data-q="${esc(t)}">${esc(t)}</button>`
    ).join('') + '</div>';
  }

  function greet() {
    if (greeted) return;
    greeted = true;
    addBot(
      'Olá! 👋 Sou o <b>Bio</b>, seu guia aqui no portal. Me diga o que procura e eu te levo até lá.<br><br>' +
      'Experimente perguntar:' +
      chips(['Onde vejo os títulos vencidos?', 'Como faço a cobrança automática?', 'Estoque consignado', 'Power BI', 'Folha de pagamento'])
    );
  }

  async function handle(qRaw) {
    const q = (qRaw || '').trim();
    if (!q) return;
    addUser(q);
    const nq = norm(q);

    // saudações / agradecimentos / ajuda
    if (/^(oi|ola|opa|bom dia|boa tarde|boa noite|eai|e ai|hello|hi)\b/.test(nq)) {
      addBot('Oi! 😊 É só me dizer o que precisa encontrar no portal — ex.: <i>"onde vejo as cotações?"</i> ou <i>"folha de pagamento"</i>.');
      return;
    }
    if (/(obrigad|valeu|vlw|thanks|brigad)/.test(nq)) {
      addBot('Disponha! 🙌 Qualquer outra coisa, é só chamar.');
      return;
    }
    if (/(o que voce|quem e voce|o que voce faz|ajuda|help|como funciona)/.test(nq)) {
      addBot('Eu conheço todas as áreas e módulos do portal. Pergunte <b>onde fica</b> alguma coisa ou <b>como fazer</b> algo, que eu mostro o caminho e te levo até a página.' +
        chips(['Áreas do portal', 'Cobrança automática', 'Sales Report']));
      return;
    }
    if (/(area|areas|modulos|departamento|menu|tudo)/.test(nq) && nq.length < 22) {
      addBot('O portal tem estas áreas — clique para abrir:' +
        resultCards(KB.filter(k => k.type === 'Área')));
      return;
    }

    // busca na base
    const found = search(q);

    // gancho de IA (futuro): se a base não achou nada e a IA estiver ligada
    if (!found.length && GUIDE_LLM.enabled) {
      const pending = addBot('<span class="cp-typing"><i></i><i></i><i></i></span>');
      try {
        const ctx = KB.map(k => `${k.name} (${k.type})`).join('; ');
        const ans = await GUIDE_LLM.ask(q, ctx);
        pending.querySelector('.cp-bubble').innerHTML = esc(ans).replace(/\n/g, '<br>');
      } catch (e) {
        pending.querySelector('.cp-bubble').innerHTML = 'Não consegui responder agora. Tente reformular ou use a busca <b>Ctrl + K</b>.';
      }
      return;
    }

    if (found.length) {
      const top = found[0];
      addBot(
        `Encontrei isto sobre <b>${esc(q)}</b>:` +
        resultCards(found) +
        (top.type === 'Área'
          ? `<div class="cp-hint">💡 Dica: dentro de <b>${esc(top.name)}</b> você acha os módulos relacionados.</div>`
          : '')
      );
    } else {
      addBot(
        `Não encontrei nada exato para <b>${esc(q)}</b>. 🤔<br>Talvez seja uma destas áreas:` +
        resultCards(KB.filter(k => k.type === 'Área').slice(0, 6)) +
        `<div class="cp-hint">Você também pode usar a busca global <b>Ctrl + K</b> no topo da página.</div>`
      );
    }
  }

  // ---- eventos -----------------------------------------------------
  form.addEventListener('submit', e => { e.preventDefault(); const v = input.value; input.value = ''; handle(v); });
  msgs.addEventListener('click', e => {
    const chip = e.target.closest('.cp-chip');
    if (chip) { handle(chip.getAttribute('data-q')); }
  });

  function open() {
    isOpen = true;
    panel.classList.add('open');
    btn.classList.add('active');
    btn.querySelector('.cp-icon-chat').style.display = 'none';
    btn.querySelector('.cp-icon-close').style.display = '';
    greet();
    setTimeout(() => input.focus(), 120);
  }
  function close() {
    isOpen = false;
    panel.classList.remove('open', 'expanded');
    btn.classList.remove('active');
    btn.querySelector('.cp-icon-chat').style.display = '';
    btn.querySelector('.cp-icon-close').style.display = 'none';
  }

  btn.addEventListener('click', () => isOpen ? close() : open());
  closeBtn.addEventListener('click', close);
  expandBtn.addEventListener('click', () => panel.classList.toggle('expanded'));
});

// ================================================================
// BOTÕES FLUTUANTES — Voltar ao Portal + Voltar ao topo (TODAS as páginas)
// Canto inferior direito (o copiloto "Bio" fica no inferior esquerdo).
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('.fab-stack')) return;

  // CSS injetado inline — não depende do styles.css (que pode vir do cache antigo).
  if (!document.getElementById('bm-fab-style')) {
    const st = document.createElement('style');
    st.id = 'bm-fab-style';
    st.textContent =
      '.fab-stack{position:fixed;right:22px;bottom:24px;z-index:8900;display:flex;flex-direction:column-reverse;align-items:center;gap:12px;}' +
      '.fab-btn{width:50px;height:50px;border-radius:50%;background:#002E5D;color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;text-decoration:none;box-shadow:0 6px 20px rgba(0,46,93,.40);transition:opacity .2s ease,transform .2s ease,background .15s,box-shadow .15s;}' +
      '.fab-btn:hover{background:#0A4FA0;color:#fff;transform:translateY(-3px);box-shadow:0 10px 26px rgba(0,46,93,.48);}' +
      '.fab-top{opacity:0;visibility:hidden;pointer-events:none;transform:translateY(8px);}' +
      '.fab-top.show{opacity:1;visibility:visible;pointer-events:auto;transform:translateY(0);}' +
      '@media(max-width:640px){.fab-stack{right:14px;bottom:14px;gap:10px;}.fab-btn{width:46px;height:46px;}}';
    document.head.appendChild(st);
  }

  const path   = location.pathname.toLowerCase();
  const file   = path.split('/').pop() || '';
  const isHome = file === '' || file === 'index.html' || path.endsWith('/');
  const inPages = path.indexOf('/pages/') !== -1;
  const homeHref = inPages ? '../index.html' : 'index.html';

  const stack = document.createElement('div');
  stack.className = 'fab-stack';

  // Voltar ao Portal — sempre visível (exceto na própria home). Fica embaixo (âncora).
  if (!isHome) {
    const portal = document.createElement('a');
    portal.className = 'fab-btn fab-portal';
    portal.href = homeHref;
    portal.setAttribute('aria-label', 'Voltar ao Portal');
    portal.title = 'Voltar ao Portal';
    portal.innerHTML = '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';
    stack.appendChild(portal);
  }

  // Voltar ao topo — aparece ao rolar. Fica acima do "Voltar ao Portal".
  const top = document.createElement('button');
  top.type = 'button';
  top.className = 'fab-btn fab-top';
  top.setAttribute('aria-label', 'Voltar ao topo');
  top.title = 'Voltar ao topo';
  top.innerHTML = '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="6"/><polyline points="5 13 12 6 19 13"/></svg>';
  top.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  stack.appendChild(top);

  document.body.appendChild(stack);

  const onScroll = () => {
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    top.classList.toggle('show', y > 320);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
});

// ================================================================
// RÓTULOS DE VALOR EM TODOS OS GRÁFICOS (Chart.js) — todas as áreas
// Plugin global: desenha o valor de cada barra/ponto, sem precisar passar o mouse.
// O formato segue o eixo de valor do próprio gráfico (R$, %, número…) quando possível.
// ================================================================
(function(){
  if (window._bmValueLabels) return; window._bmValueLabels = true;
  function fmtCompact(v){
    const a=Math.abs(v);
    if(a>=1e9) return (v/1e9).toLocaleString('pt-BR',{maximumFractionDigits:1})+' Bi';
    if(a>=1e6) return (v/1e6).toLocaleString('pt-BR',{maximumFractionDigits:1})+' Mi';
    if(a>=1e3) return (v/1e3).toLocaleString('pt-BR',{maximumFractionDigits:1})+'k';
    return v.toLocaleString('pt-BR',{maximumFractionDigits:2});
  }
  const plugin = {
    id:'bmValueLabels',
    afterDatasetsDraw(chart){
      const type = chart.config && chart.config.type;
      if(type!=='bar' && type!=='line') return;       // só barras e linhas
      const area = chart.chartArea; if(!area) return;
      const horizontal = chart.options.indexAxis==='y';
      const valScale = horizontal ? chart.scales.x : chart.scales.y;
      const fmt = (v)=>{
        try{ const cb = valScale && valScale.options && valScale.options.ticks && valScale.options.ticks.callback;
             if(typeof cb==='function'){ const s=cb.call(valScale, v); if(s!=null && s!=='') return String(s); } }catch(e){}
        return fmtCompact(v);
      };
      const ctx = chart.ctx; ctx.save();
      ctx.font='700 10.5px Manrope, "Segoe UI", system-ui, -apple-system, sans-serif';
      // barras 3D do layout v3 (portal-motion.js): o rótulo sobe/afasta o
      // tanto da tampa/face lateral, senão encosta no volume
      const lift = (el)=>{
        if(!chart.$bm3 || type!=='bar') return 0;
        const t = horizontal ? (el.height||0) : (el.width||0);
        return t < 5 ? 0 : Math.max(3, Math.min(10, t*0.3));
      };
      (chart.data.datasets||[]).forEach((ds,di)=>{
        const meta = chart.getDatasetMeta(di);
        if(meta.hidden) return;
        const pts = meta.data || [];
        if(pts.length > 40) return;                    // não polui gráficos muito densos
        // celular: em séries com muitos pontos os números se sobrepõem — deixa só o tooltip
        if(chart.width && chart.width < 520 && pts.length > 8) return;
        pts.forEach((el,i)=>{
          if(!el || el.skip || isNaN(el.x) || isNaN(el.y)) return;
          let raw = ds.data[i];
          let v = (raw && typeof raw==='object') ? (raw.y!=null?raw.y:raw.x) : raw;
          v = Number(v);
          if(isNaN(v) || v===0) return;
          const label = fmt(v); if(!label) return;
          if(type==='bar' && horizontal){
            ctx.textBaseline='middle';
            const w = ctx.measureText(label).width, d = lift(el);
            if(el.x + 6 + d + w <= area.right){ ctx.textAlign='left';  ctx.fillStyle='#334155'; ctx.fillText(label, el.x+6+d, el.y); }
            else                              { ctx.textAlign='right'; ctx.fillStyle='#ffffff'; ctx.fillText(label, el.x-6, el.y); }
          } else if(type==='bar'){
            ctx.textAlign='center';
            const up = lift(el)*0.62, dx = lift(el)/2;
            if(ds.bmLabelInBar){
              // número DENTRO da coluna, próximo ao topo (branco); se a barra for muito baixa, joga acima
              const base = (el.base!=null ? el.base : area.bottom);
              if(el.y + 16 <= base){ ctx.textBaseline='top'; ctx.fillStyle='#ffffff'; ctx.fillText(label, el.x, el.y+5); }
              else                 { ctx.textBaseline='bottom'; ctx.fillStyle='#334155'; ctx.fillText(label, el.x+dx, el.y-4-up); }
            } else if(el.y - 14 - up >= area.top){ ctx.textBaseline='bottom'; ctx.fillStyle='#334155'; ctx.fillText(label, el.x+dx, el.y-4-up); }
            else                                 { ctx.textBaseline='top';    ctx.fillStyle='#ffffff'; ctx.fillText(label, el.x, el.y+4); }
          } else { // line
            ctx.textAlign='center';
            const below = ds.bmLabelPos==='below';
            ctx.textBaseline = below ? 'top' : 'bottom';
            const ly = below ? el.y+7 : el.y-6;
            // halo branco p/ o número ficar legível mesmo sobre barras coloridas
            ctx.lineWidth=3; ctx.lineJoin='round'; ctx.strokeStyle='rgba(255,255,255,.9)';
            ctx.strokeText(label, el.x, ly);
            ctx.fillStyle = ds.bmLabelColor || (typeof ds.borderColor==='string' ? ds.borderColor : '#1e293b');
            ctx.fillText(label, el.x, ly);
          }
        });
      });
      ctx.restore();
    }
  };
  function register(){
    if(!(window.Chart && typeof Chart.register==='function')) return false;
    try{ Chart.register(plugin); }catch(e){}
    try{ const inst=Chart.instances||{}; Object.keys(inst).forEach(k=>{ try{ inst[k].update(); }catch(e){} }); }catch(e){}
    return true;
  }
  if(!register()){
    let n=0; const iv=setInterval(()=>{ if(register() || ++n>150) clearInterval(iv); }, 40);
  }
})();