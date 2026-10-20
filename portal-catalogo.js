// ================================================================
// BIOMEDICAL — CATALOGO DO PORTAL (fonte unica da busca global ⌘K)
// ================================================================
// Espelha a navegacao REAL de hoje: o NAV de nav-sidebar.js (modulos e
// submodulos por area), as automacoes que existem de verdade e os agentes
// de IA em producao.
//
// FICA DE FORA, de proposito:
//   . maquete (pagina estatica que nao abre nada) — ex.: contabil-fiscal,
//     licitacao-pregoes, financeiro-titulos-*, estoque-ordens/roi,
//     produtos-registros, comercial-negociacoes: sairam do menu e nao
//     deveriam continuar aparecendo na busca;
//   . automacao sem destino (href '#') — "Deploy Automatico", "Disparo de
//     Campanhas", "Onboarding Automatico" e cia.;
//   . agente-*.html generico (10 paginas apontando para o MESMO bot do
//     Copilot Studio) e agente-pedidos ("Versao Copilot (antiga)").
//
// QUEM CONSOME:
//   . index.html -> palette inline da home (Ctrl+K)
//   . script.js  -> palette das paginas internas (Ctrl+K)
//
// AO MEXER NO MENU (NAV de nav-sidebar.js), MEXA AQUI TAMBEM. O guarda
//   node scripts/verificar-catalogo-busca.js
// compara os dois e acusa divergencia (e href apontando p/ arquivo que
// nao existe).
// ================================================================
window.PORTAL_CATALOGO = (function () {
  'use strict';

  var versao = '2026-10-20-msb2';

  /* ── icones dos itens ─────────────────────────────────────────── */
  var S = ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">';
  var ic = {
    grid:    '<svg' + S + '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    bars:    '<svg' + S + '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    brief:   '<svg' + S + '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
    file:    '<svg' + S + '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
    box:     '<svg' + S + '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
    money:   '<svg' + S + '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    truck:   '<svg' + S + '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    send:    '<svg' + S + '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    users:   '<svg' + S + '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    shield:  '<svg' + S + '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>',
    monitor: '<svg' + S + '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    cloud:   '<svg' + S + '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>',
    server:  '<svg' + S + '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
    filter:  '<svg' + S + '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    tag:     '<svg' + S + '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    heart:   '<svg' + S + '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    book:    '<svg' + S + '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="9" y1="7" x2="16" y2="7"/></svg>',
    chat:    '<svg' + S + '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    zap:     '<svg' + S + '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    bot:     '<svg' + S + '<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M12 11V7"/><circle cx="12" cy="5" r="2"/><circle cx="8" cy="16" r="1" fill="currentColor"/><circle cx="16" cy="16" r="1" fill="currentColor"/></svg>',
    sub:     '<svg' + S + '<polyline points="9 18 15 12 9 6"/></svg>',
    alvo:    '<svg' + S + '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    check:   '<svg' + S + '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    bag:     '<svg' + S + '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
    gauge:   '<svg' + S + '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>',
    cart:    '<svg' + S + '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
    headset: '<svg' + S + '<path d="M3 14v-3a9 9 0 0 1 18 0v3"/><path d="M21 15a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2z"/><path d="M3 15a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2z"/><path d="M18 17v1a3 3 0 0 1-3 3h-3"/></svg>',
    back:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    search:  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
  };

  /* ── AREAS — mesmos cards da home (e na mesma ordem) ──────────── */
  // [chave, nome, descricao, arquivo, icone, palavras-chave]
  var AREAS = [
    ['comercial',      'Comercial',      'Vendas, cotações, clientes e processos comerciais.',                   'comercial.html',      'users',   'vendas venda faturamento cliente clientes cotacao proposta funil oportunidade negociacao pedido receita sales report'],
    ['vendedor',       'Vendedor',       'Comercial, Licitação, Estoque e Financeiro na visão do vendedor.',     'vendedor.html',       'bag',     'vendedor vendedores representante consultor carteira visao do vendedor comercial licitacao estoque financeiro'],
    ['financeiro',     'Financeiro',     'Cobranças, inadimplência e indicadores financeiros.',                  'financeiro.html',     'money',   'financas cobranca inadimplencia titulos vencidos contas receber boleto fatura recebimento baixa'],
    ['logistica',      'Logística',      'Suprimentos, estoque, distribuição e expedição.',                      'logistica.html',      'truck',   'logistica distribuicao carga expedicao rota entrega transporte frete cotacao transportadora sla'],
    ['marketing',      'Marketing',      'Captação de leads, formulários e materiais institucionais.',           'marketing.html',      'send',    'marketing campanha evento redes sociais instagram formulario lead leads comunicacao'],
    ['estoque',        'Estoque',        'Gestão de estoque, inventário, entradas e saídas de materiais.',       'estoque.html',        'box',     'estoque consignado consignacao saldo inventario ruptura validade movimentacao perdas armazem'],
    // Compras (14/10/26): INDISPONÍVEL, só as contas do dono (reserva estrita no
    // api/shared/auth.js). SEM módulos por enquanto — a busca leva à visão geral.
    ['compras',        'Compras',        'Fornecedores, requisições, pedidos de compra, importação e recebimento.', 'compras.html', 'cart', 'compras compra comprador suprimentos fornecedor fornecedores requisicao requisicoes pedido de compra oc ordem de compra cotacao importacao follow-up embarque recebimento reposicao lead time'],
    ['contabil',       'Contábil',       'Contabilidade, fechamentos, obrigações fiscais e demonstrativos.',     'contabil.html',       'file',    'contabil contabilidade custos sgna margem contribuicao fiscal demonstrativo'],
    ['licitacao',      'Licitação',      'Editais, propostas públicas, pregões e contratos com órgãos.',         'licitacao.html',      'file',    'licitacao edital pregao contrato empenho orgao publico pncp ata lici'],
    ['administrativo', 'Administrativo', 'Requisições de compra, lançamento de faturas no Dynamics e pagamento de comissão dos vendedores PJ.', 'administrativo.html', 'brief', 'administrativo requisicao compra ordem comissao pj comissionado fatura lancamento diario'],
    ['produtos',       'Produtos',       'Linhas, estratégias e famílias de produtos, e cadastro de novos SKUs.','produtos.html',       'tag',     'produtos produto familia familias estrategia sku cadastro portfolio ncm anvisa'],
    ['pessoas',        'Pessoas',        'Recursos humanos, equipes, benefícios e cultura.',                     'pessoas.html',        'users',   'pessoas rh recursos humanos recrutamento treinamento folha salario beneficio clima saude ferias'],
    ['qualidade',      'Qualidade',      'POPs, avaliação de fornecedores e condições das filiais.',               'qualidade.html',      'shield',  'qualidade pop procedimento fornecedor filial auditoria regulatorio anvisa iso'],
    ['ti',             'TI & Sistemas',  'Automações, integrações, suporte e infraestrutura.',                   'ti.html',             'monitor', 'ti tecnologia sistema infra infraestrutura chamado suporte azure nuvem vm firewall internet log'],
    ['diretoria',      'Diretoria',      'Priorização de ideias, votação dos OKRs e pagamento de comissão.',     'diretoria.html',      'alvo',    'diretoria okr okrs votacao voto ideia ideias priorizacao ciclo importancia urgencia gerencia de projetos comissao pagamento'],
    ['gerencial',      'Gerencial',      'Indicadores globais e setoriais, com metas e resultados mês a mês.', 'gerencial.html',   'gauge',   'gerencial gestao indicador indicadores kpi meta metas resultado resultados atingimento bsc perspectiva setorial bonus'],
    // Canal de Atendimento (08/10/26): SEM módulos — a casa da área já é a tela
    // do Customer Service (que saiu do Comercial). A busca leva direto para lá.
    ['atendimento',    'Canal de Atendimento', 'Customer Service: o e-mail do cliente vira caso, com dono, prazo e o pedido seguindo para o PI.', 'atendimento.html', 'headset', 'atendimento canal de atendimento customer service cs sac caso casos ticket tickets chamado email e-mail caixa cliente resposta sla prazo fila pedido cotacao pi quadro']
  ];

  /* ── MODULOS e SUBMODULOS — espelho do NAV de nav-sidebar.js ──── */
  // [area, nome, grupo ('' = modulo raiz), arquivo, icone, palavras-chave]
  var MODULOS = [
    // ── Comercial ─────────────────────────────────────────────────
    ['comercial', 'Sales Report',              '',             'comercial-sales-report.html',           'bars',  'relatorio vendas faturamento indicadores dashboard bi visao geral'],
    ['comercial', 'Performance de Vendas',     'Sales Report', 'comercial-performance-vendas.html',     'sub',   'performance meta atingimento vendedor ranking crescimento'],
    ['comercial', 'Análise de Vendas',         'Sales Report', 'comercial-vendas.html',                 'sub',   'analise vendas faturamento familia produto uf representante'],
    ['comercial', 'Análise de Pedidos',        'Sales Report', 'comercial-clientes.html',               'sub',   'analise pedidos pedido status intercompany ov carteira'],
    ['comercial', 'Base de Notas Fiscais',     'Sales Report', 'comercial-base-notas-fiscais.html',     'sub',   'base notas fiscais nf item nota exportar excel detalhado'],
    ['comercial', 'Novos Negócios',            'Sales Report', 'comercial-novos-negocios.html',         'sub',   'novos negocios prospeccao matriz analitica primeira compra'],
    ['comercial', 'Clientes Perdidos',         'Sales Report', 'comercial-clientes-perdidos.html',      'sub',   'clientes perdidos churn recuperacao inativo'],
    ['comercial', 'Comportamento de Clientes', 'Sales Report', 'comercial-comportamento-clientes.html', 'sub',   'comportamento cliente curva abc pareto segmento fiel recorrente em risco dormente recencia recompra ticket medio'],
    ['comercial', 'Calendário Cirúrgico',      'Sales Report', 'comercial-calendario-cirurgico.html',   'sub',   'calendario cirurgico cirurgia agenda procedimento medico hospital'],
    ['comercial', 'Negociações',               '',             'comercial-funil.html',                  'brief', 'negociacoes oportunidades pipeline salesforce funil etapa fase conversao oportunidade'],
    ['comercial', 'Analítico',                 'Negociações',  'comercial-funil-analitico.html',        'sub',   'analitico negociacoes funil oportunidades sku produto item itens por fase familia estrategia curva abc mix'],
    ['comercial', 'FCA',                       '',             'comercial-fca.html',                    'file',  'fca ficha atividade comercial visita relato'],
    ['comercial', 'Sales Playbook',            '',             'comercial-salesbooking.html',           'book',  'sales playbook salesbooking roteiro abordagem argumento treinamento'],
    ['comercial', 'Materiais e Recursos',      '',             'comercial-materiais.html',              'brief', 'materiais recursos apoio catalogo folder'],
    ['comercial', 'Tabela de Preços',          '',             'comercial-tabela-precos.html',          'money', 'tabela precos preco lista desconto'],

    // ── Vendedor (cada módulo lê o modelo do BI da sua área) ──
    // O Comercial tem dois submódulos, que são ABAS da mesma página: o #hash
    // abre direto na aba, então a busca leva a pessoa ao lugar exato.
    ['vendedor', 'Comercial',   '', 'vendedor-comercial.html',  'users', 'vendedor comercial vendas carteira clientes sales report oportunidades'],
    ['vendedor', 'Sales Report',   'Comercial', 'vendedor-comercial.html#salesreport',   'sub', 'vendedor sales report faturamento meta margem pedidos clientes'],
    ['vendedor', 'Oportunidades', 'Comercial', 'vendedor-comercial.html#oportunidades', 'sub', 'vendedor oportunidades funil pipeline cotacoes fase a faturar'],
    ['vendedor', 'Licitação',   '', 'vendedor-licitacao.html',  'file',  'vendedor licitacao edital pregao contrato empenho vigencia saldo em aberto'],
    ['vendedor', 'Estoque',     '', 'vendedor-estoque.html',    'box',   'vendedor estoque saldo disponibilidade consignado validade curta lote'],
    ['vendedor', 'Financeiro',  '', 'vendedor-financeiro.html', 'money', 'vendedor financeiro titulos inadimplencia cobranca vencidos em aberto'],

    // ── Financeiro ────────────────────────────────────────────────
    ['financeiro', 'Contas a Receber',            '',                 'financeiro-contas-receber.html',  'money', 'contas receber titulo recebimento cliente visao geral aging'],
    ['financeiro', 'Inadimplência',               'Contas a Receber', 'financeiro-inadimplencia.html',   'sub',   'inadimplencia atraso devedor vencido cobranca'],
    ['financeiro', 'Baixas por cliente',          'Contas a Receber', 'financeiro-baixas-cliente.html',  'sub',   'baixa baixas liquidacao quitacao pagamento cliente'],
    ['financeiro', 'Detalhamento de nota fiscal', 'Contas a Receber', 'financeiro-detalhamento-nf.html', 'sub',   'detalhamento nota fiscal nf titulo duplicata'],
    ['financeiro', 'Contas a Pagar',              '',                 'financeiro-contas-pagar.html',    'file',  'contas pagar fornecedor pagamento automacao automacoes'],
    ['financeiro', 'Comprovantes Bancários',      'Contas a Pagar',   'financeiro-contas-pagar-comprovantes.html', 'sub', 'comprovante comprovantes bancario banco pagamento compilado separar desmembrar pdf fornecedor pasta sharepoint automacao'],

    // ── TI & Sistemas ─────────────────────────────────────────────
    ['ti', 'Central de Chamados', '',                 'ti-chamados.html',            'chat',   'chamado chamados suporte ticket zendesk helpdesk'],
    ['ti', 'Sistemas & Infra',    '',                 'ti-sistemas.html',            'server', 'sistemas infra infraestrutura servidor rede visao geral'],
    ['ti', 'Internet',            'Sistemas & Infra', 'ti-sistemas-internet.html',   'sub',    'internet link conectividade provedor banda'],
    ['ti', "VM's",                'Sistemas & Infra', 'ti-sistemas-vms.html',        'sub',    'vm vms maquina virtual servidor hyperv'],
    ['ti', 'Firewalls',           'Sistemas & Infra', 'ti-sistemas-firewalls.html',  'sub',    'firewall seguranca rede sonicwall'],
    ['ti', 'Log de Entradas',     'Sistemas & Infra', 'ti-sistemas-log-portal.html', 'sub',    'log entradas acesso portal auditoria quem entrou'],
    ['ti', 'Microsoft Azure',     '',                 'ti-azure.html',               'cloud',  'azure nuvem cloud microsoft visao geral'],
    ['ti', 'Custo Azure',         'Microsoft Azure',  'ti-azure-custo.html',         'sub',    'custo azure gasto consumo fatura categoria licenca power bi mes atual anterior variacao'],
    ['ti', 'Licenciamento e Custo do Colaborador', 'Microsoft Azure', 'ti-azure-colaboradores.html', 'sub', 'licenca licencas licenciamento colaborador colaboradores custo m365 office 365 admin center entra id usuarios ativos assinatura renovacao sem uso desativada salario'],
    ['ti', 'Licenciamento',       'Microsoft Azure',  'ti-azure-licenciamento.html', 'sub',    'licenca licencas licenciamento m365 assinatura'],
    ['ti', 'Usuários Ativos',     'Microsoft Azure',  'ti-azure-usuarios.html',      'sub',    'usuarios ativos entra id conta login'],
    ['ti', 'Agentes de IA',       'Microsoft Azure',  'ti-azure-agentes.html',       'sub',    'agentes ia copilot bot foundry'],
    ['ti', 'PDF de Nota Fiscal',  '',                 'ti-nf-pdf.html',              'file',   'nf nfe nota notas fiscal fiscais danfe pdf chave acesso dynamics baixar'],

    // ── Logística ─────────────────────────────────────────────────
    ['logistica', 'Fluxo Logístico', '',                'logistica-fluxo-logistico.html',  'bars', 'fluxo logistico expedicao sla etapa frete uf visao geral'],
    ['logistica', 'Relatórios',      'Fluxo Logístico', 'logistica-fluxo-relatorios.html', 'sub',  'relatorio relatorios ov ot analitico csv exportar'],

    // ── Marketing ─────────────────────────────────────────────────
    ['marketing', 'Formulários',         '', 'marketing-formularios.html',   'file',   'formulario formularios forms lead'],
    ['marketing', 'BioLeads · Captação', '', 'marketing-leads.html',         'filter', 'bioleads leads captacao cnes prospeccao agente ia hospital clinica'],
    ['marketing', 'BioLeads · Médicos',  '', 'marketing-leads-medicos.html', 'users',  'bioleads medicos medico crm agente ia especialidade'],

    // ── Estoque ───────────────────────────────────────────────────
    ['estoque', 'Gestão de Estoque',              '',                      'estoque-gestao.html',                 'bars',   'gestao estoque saldo dashboard visao geral'],
    ['estoque', 'Saldo de Estoque',               'Gestão de Estoque',     'estoque-saldo.html',                  'sub',    'saldo estoque disponibilidade deposito empresa filial'],
    ['estoque', 'Ruptura de Estoque',             'Gestão de Estoque',     'estoque-ruptura.html',                'sub',    'ruptura falta stockout sem saldo'],
    ['estoque', 'Produtos com Validade Curta',    'Gestão de Estoque',     'estoque-validade-curta.html',         'sub',    'validade curta vencimento lote vencer'],
    ['estoque', 'Movimentações',                  'Gestão de Estoque',     'estoque-movimentacoes.html',          'sub',    'movimentacao movimentacoes entrada saida transferencia'],
    ['estoque', 'Gestão de Consignação',          '',                      'estoque-gestao-consignacao.html',     'server', 'gestao consignacao consignado terceiros visao geral'],
    ['estoque', 'Saldo Consignado',               'Gestão de Consignação', 'estoque-saldo-consignado.html',       'sub',    'saldo consignado nota cliente remessa'],
    ['estoque', 'Contagem · Saldo por Nota',      'Gestão de Consignação', 'estoque-contagem-saldo-nota.html',    'sub',    'contagem saldo por nota conferencia inventario'],
    ['estoque', 'Devoluções Aguard. Aprovação',   'Gestão de Consignação', 'estoque-devolucoes-faturamento.html', 'sub',    'devolucao devolucoes aguardando aprovacao faturamento'],
    ['estoque', 'Rastreabilidade de Consignação', 'Gestão de Consignação', 'estoque-rastreabilidade.html',        'sub',    'rastreabilidade remessa devolucao venda lote serie'],
    ['estoque', 'GMROI',                          'Gestão de Consignação', 'estoque-gmroi.html',                  'sub',    'gmroi roi margem giro retorno investimento'],
    ['estoque', 'Análise de Perdas',              '',                      'estoque-perdas.html',                 'brief',  'perda perdas vencido avaria descarte quebra'],
    ['estoque', 'InventarIA',                     '',                      'estoque-consignado-inventario.html',  'server', 'inventaria inventario contagem consignado importacao planilha'],

    // ── Contábil ──────────────────────────────────────────────────
    ['contabil', 'DRE',                    '',                       'contabil-dre.html',              'file',  'dre demonstrativo resultado exercicio ebitda ebit lucro liquido rol receita liquida margem gastos fixos variaveis saude financeira pecld ppr'],
    ['contabil', 'Gestão de Custos SG&A',  '',                       'contabil-custos-sgna.html',      'money', 'custo custos sgna sga despesa administrativa'],
    ['contabil', 'Margem de Contribuição', '',                       'contabil-margem.html',           'bars',  'margem contribuicao mc meta visao geral'],
    ['contabil', 'Analítico',              'Margem de Contribuição', 'contabil-margem-analitico.html', 'sub',   'margem analitico detalhado produto familia'],
    ['contabil', 'Analítico por NF',       'Margem de Contribuição', 'contabil-margem-nf.html',        'sub',   'margem nota fiscal nf analitico item'],

    // ── Licitação ─────────────────────────────────────────────────
    ['licitacao', 'Sales Report',              '',             'licitacao-sales-report.html',            'bars',  'sales report licitacao bi empenho visao geral'],
    ['licitacao', 'Performance de Licitações', 'Sales Report', 'licitacao-performance-licitacoes.html',  'sub',   'performance licitacoes ganho perdido taxa'],
    ['licitacao', 'Análise de Consignação',    'Sales Report', 'licitacao-consignacao.html',             'sub',   'analise consignacao consignado saldo contrato'],
    ['licitacao', 'Análise de Vendas',         'Sales Report', 'licitacao-vendas.html',                  'sub',   'analise vendas empenho faturamento licitacao'],
    ['licitacao', 'Análise de Contratos',      'Sales Report', 'licitacao-analise-contratos.html',       'sub',   'analise contrato contratos vigencia saldo ata'],
    ['licitacao', 'Comitê de Produto',        '',             'licitacao-negociacoes.html',             'brief', 'comite de produto negociacoes edital pregao disputa funil visao geral ganhas perdidas conversao aprovada sincronizada fechamento'],
    ['licitacao', 'Perdas',                    'Comitê de Produto', 'licitacao-negociacoes-perdas.html', 'sub',   'perda perdas motivo perdido concorrente preco comite de produto'],
    // Negociações: casa própria (um cartão por submódulo) e 2 submódulos —
    // o Funil de Captação e o Funil de Vendas, com a aba Analítico
    ['licitacao', 'Negociações',               '',             'licitacao-funil.html',                   'filter', 'negociacoes funis funil de captacao funil de vendas salesforce oportunidades licitacao'],
    ['licitacao', 'Funil de Captação',         'Negociações',  'licitacao-funil-captacao.html',          'sub', 'funil de captacao captacao entrada entrou o que entrou novas negociacoes criadas data de criacao semana por dia dia a dia diario quantidade valor negociacoes'],
    ['licitacao', 'Funil de Vendas',           'Negociações',  'licitacao-funil-semanal.html',           'sub', 'funil de vendas funil semanal semana avaliacao da semana entrou ganhou perdeu ganhas perdidas data de criacao negociacoes criadas taxa de ganho'],
    ['licitacao', 'Analítico',                 'Funil de Vendas', 'licitacao-funil-semanal-analitico.html', 'sub', 'analitico funil de vendas por que perdi motivo da perda justificativa da perda preco do concorrente lance 1o colocado vencedor itens ganhos perdidos familia resultado do item propostas perdidas ganhas'],
    ['licitacao', 'Tabela de Preços',          '',             'licitacao-tabela-precos.html',           'money', 'tabela precos preco lista minimo assistente coordenador diretoria vd vf canal aprovacao licitacao'],
    ['licitacao', 'Gestão de Desempenho',      '',             'licitacao-desempenho.html',              'users', 'gestao de desempenho performance equipe funcionarios analista nota avaliacao licitacoes analisadas participadas ganhas itens valor acumulado'],

    // ── Administrativo ────────────────────────────────────────────
    ['administrativo', 'Requisições', '', 'administrativo-requisicoes.html', 'tag', 'requisicao requisicoes compra oc d365 aprovacao tratativa'],
    ['administrativo', 'Lançamentos Administrativos', '', 'administrativo-lancamentos.html', 'file', 'lancamento lancamentos administrativos fatura faturas nota fiscal boleto conta diario de faturas dynamics d365 contas a pagar fornecedor pdf ocr ler documento'],

    // ── Produtos ──────────────────────────────────────────────────
    ['produtos', 'Estratégias & Famílias', '',                       'produtos-familias.html',              'filter', 'estrategia estrategias familia familias sku portfolio linha'],
    ['produtos', 'Vascular',               'Estratégias & Famílias', 'produtos-estrategia-vascular.html',   'sub',    'vascular estrategia sku cateter'],
    ['produtos', 'Extração',               'Estratégias & Famílias', 'produtos-estrategia-extracao.html',   'sub',    'extracao estrategia sku'],
    ['produtos', 'Segurança do Paciente',  'Estratégias & Famílias', 'produtos-estrategia-seguranca.html',  'sub',    'seguranca paciente estrategia sku'],
    ['produtos', 'Venda Recorrente',       'Estratégias & Famílias', 'produtos-estrategia-recorrente.html', 'sub',    'venda recorrente estrategia sku'],
    ['produtos', 'Coronário',              'Estratégias & Famílias', 'produtos-estrategia-coronario.html',  'sub',    'coronario estrategia sku stent'],
    ['produtos', 'Urologia',               'Estratégias & Famílias', 'produtos-estrategia-urologia.html',   'sub',    'urologia estrategia sku'],
    ['produtos', 'Cadastro de Produto',    '',                       'produtos-cadastro.html',              'file',   'cadastro produto dynamics salesforce ncm anvisa registro rms'],

    // ── Pessoas ───────────────────────────────────────────────────
    ['pessoas', 'Recrutamento & Seleção',        '',                              'pessoas-recrutamento.html',    'users',   'recrutamento selecao vaga candidato contratacao'],
    ['pessoas', 'Treinamento & Desenvolvimento', '',                              'pessoas-treinamento.html',     'monitor', 'treinamento capacitacao curso trilha visao geral'],
    ['pessoas', 'Desenvolvimento',               'Treinamento & Desenvolvimento', 'pessoas-desenvolvimento.html', 'sub',     'desenvolvimento pdi carreira competencia'],
    ['pessoas', 'Clima Organizacional',          '',                              'pessoas-clima.html',           'users',   'clima organizacional pesquisa engajamento enps'],
    ['pessoas', 'Folha de Pagamento',            '',                              'pessoas-folha.html',           'money',   'folha pagamento salario holerite encargo'],
    ['pessoas', 'Saúde & Segurança',             '',                              'pessoas-saude.html',           'shield',  'saude seguranca sst cipa aso acidente'],
    ['pessoas', 'Benefícios',                    '',                              'pessoas-beneficios.html',      'heart',   'beneficio beneficios plano vale convenio'],

    // ── Qualidade ─────────────────────────────────────────────────
    ['qualidade', 'POPs',                  '', 'qualidade-pops.html',         'book',   'pop pops procedimento operacional padrao documento sharepoint'],
    ['qualidade', 'Fornecedores',          '', 'qualidade-fornecedores.html', 'brief',  'qualificacao avaliacao fornecedor fornecedores'],
    ['qualidade', 'Condições das Filiais', '', 'qualidade-filiais.html',      'shield', 'condicoes filial filiais vistoria estrutura'],

    // ── Diretoria ─────────────────────────────────────────────────
    ['diretoria', 'Votação OKR',           '', 'diretoria-votacao-okr.html',  'check',  'votacao okr ideia ideias priorizacao importancia urgencia ciclo voto anonimo gerencia de projetos'],
    ['diretoria', 'Pagamento de Comissão', '', 'diretoria-comissao.html',     'money',  'comissao comissoes comissionado competencia pagar pagamento aprovacao aprovar diretor comercial congelar congelado faturamento fechamento mes diretoria'],

    // ── Gerencial ─────────────────────────────────────────────────
    // Indicadores tem 2 submódulos: o pai abre os Globais (1º filho, mesmo href)
    ['gerencial', 'Indicadores',           '', 'gerencial-indicadores-globais.html', 'bars', 'indicador indicadores globais global empresa resultado global painel analise relatorio kpi meta metas resultado atingimento perspectiva bsc peso bonus'],
    ['gerencial', 'Setoriais',             'Indicadores', 'gerencial-indicadores.html', 'sub', 'indicadores setoriais setorial area areas responsavel quadro geral meta resultado atingimento mes a mes formula periodicidade peso setorial bonus fca']
  ];

  /* ── AUTOMACOES — so as que existem de verdade ────────────────── */
  // [area, nome, arquivo, palavras-chave]
  var AUTOMACOES = [
    // Cobrança Automática oculta para todos (07/10) — a página segue no ar
    ['financeiro',     'Cobrança · Notas em Aberto', 'cobranca-notas.html',          'cobranca notas em aberto fatura dynamics nao liquidado responsavel'],
    ['administrativo', 'Pagamento de Comissão',      'administrativo-comissao.html', 'comissao pagamento pj vendedor comissionado email calculo'],
    ['logistica',      'Cotação de Frete',           'logistica-cotacao-frete.html', 'cotacao cotar frete fretes transportadora transportadoras peso cubagem cubado volume volumes valor nf prazo entrega rodoviario aereo simulador simular calcular']
  ];

  /* ── AGENTES DE IA — so os que estao no ar ────────────────────── */
  // [area, nome, arquivo, palavras-chave]
  var AGENTES = [
    ['comercial', 'Dossiê de Visita',              'comercial-dossie-visita.html',   'dossie visita cliente cnpj preparacao vendedor compras familia abandonada cirurgia carteira abc'],
    ['comercial', 'PI · Pedido',                   'pedido-inteligente.html',        'pedido inteligente pi pdf ocr digitacao salesforce'],
    // PI · Cotação oculto para todos (07/10); PI · Consignação (INCOMPLETO) voltou em 19/10
    ['comercial', 'PI · Consignação',              'pi-consignacao.html',            'pi consignacao lote faturamento remessa'],
    ['comercial', 'PI · Consignação (INCOMPLETO)', 'pi-consignacao-incompleto.html', 'pi consignacao incompleto nota devolucao teste'],
    ['licitacao', 'LICI · Análise de Editais',     'lici.html',                      'lici edital editais analise ia pncp catalogo aderencia fila'],
    ['licitacao', 'LICI · Relatório de Editais',   'lici-relatorio.html',            'lici relatorio editais funil fases agente manual manual lici crescimento valor oportunidades salesforce apresentacao'],
    ['licitacao', 'Sentinela de Atas e Contratos', 'licitacao-sentinela-inicio.html', 'sentinela ata atas contrato contratos analises agente vigia'],
    ['licitacao', 'Sentinela · Plano de Saldo',    'licitacao-sentinela.html',       'sentinela plano saldo em aberto ata contrato vigencia ritmo responsavel nunca faturou email'],
    ['licitacao', 'Sentinela · Contratos a Vencer', 'licitacao-sentinela.html#vencer', 'sentinela contratos a vencer vencimento 30 60 90 dias oficio contratante'],
    ['licitacao', 'Sentinela · Atas e Contratos Vencidos', 'licitacao-sentinela.html#vencidos', 'sentinela vencidos vencido vigencia encerrada saldo nao consumido perdido aditivo prorrogacao'],
    ['licitacao', 'Sentinela · Gerenciamento de Adesões', 'licitacao-sentinela-adesoes.html', 'sentinela adesao adesoes carona ata registro de precos orgao aderente negociacao da adesao limite dobro 50%'],
    ['estoque',   'Vigia de Consignação',          'estoque-vigia.html',             'vigia consignacao regra fila aprovacao dias no cliente'],
    ['marketing', 'Agente de Conteúdo',            'agente-marketing.html',          'agente conteudo copilot post texto'],
    ['ti',        'Agente de TI',                  'agente-ti.html',                 'agente ti copilot incidente suporte'],
    ['pessoas',   'Agente de RH',                  'agente-rh.html',                 'agente rh copilot pessoas duvida']
  ];

  /* ── SISTEMAS & LINKS externos — mesmos cards da home ─────────── */
  // [nome, descricao, url, dominio do favicon, palavras-chave]
  var SISTEMAS = [
    ['Dynamics 365',       'ERP · F&O',         'https://mlb.operations.dynamics.com/',                      'dynamics.com',       'erp dynamics d365 financeiro operacoes'],
    ['Salesforce',         'CRM Comercial',     'https://biomedical.lightning.force.com/lightning/page/home','salesforce.com',     'crm salesforce sf oportunidade conta'],
    ['Outlook · E-mail',   'Microsoft 365',     'https://outlook.cloud.microsoft/mail/',                     'outlook.com',        'email e-mail outlook correio agenda'],
    ['BioPortal',          'Intranet',          'https://tibiomedical.sharepoint.com/sites/BioPortal',       'sharepoint.com',     'intranet bioportal sharepoint'],
    ['Arquivos em Rede',   'SharePoint',        'https://tibiomedical.sharepoint.com/sites/BioPortal/SitePages/ArquivosEmRede.aspx', 'sharepoint.com', 'arquivos rede pasta compartilhada sharepoint'],
    ['Flash · Ponto & DP', 'Pessoas',           'https://hros.flashapp.com.br/',                             'flashapp.com.br',    'ponto flash dp folha ferias holerite'],
    ['Feedz',              'Pessoas',           'https://app.feedz.com.br/',                                 'feedz.com.br',       'feedz feedback avaliacao pdi'],
    ['Power BI',           'Dados',             'https://app.powerbi.com/home?experience=power-bi',          'powerbi.com',        'power bi dados dashboard relatorio'],
    ['Chamados TI',        'Suporte · Zendesk', 'https://biomedical.zendesk.com/hc/pt-br/requests/new',      'zendesk.com',        'chamado ti suporte zendesk ticket'],
    ['P.O.P',              'Documentos',        'https://tibiomedical.sharepoint.com/sites/BioPortal/SitePages/PROCEDIMENTOS-OPERACIONAIS-PADR%C3%83O.aspx', 'sharepoint.com', 'pop procedimento operacional padrao documento'],
    ['Site Biomedical',    'Site',              'https://biomedical.com.br/',                                'biomedical.com.br',  'site institucional biomedical'],
    ['Site MSB',           'Site',              'https://msbbrasil.com/',                                    'msbbrasil.com',      'site msb brasil']
  ];

  /* ── RECORTE COMERCIAL + ESTOQUE ──────────────────────────────── */
  // Este portal só tem as duas áreas: as listas acima ficam IGUAIS às do
  // portal completo (dá para recopiá-las de lá) e o filtro abaixo tira o que
  // é das outras áreas — senão a busca levaria a páginas que não existem aqui.
  // SISTEMAS (links externos) não tem área e fica inteiro.
  var AREAS_DESTE_PORTAL = ['comercial', 'estoque'];
  function daqui(linha) { return AREAS_DESTE_PORTAL.indexOf(linha[0]) >= 0; }
  AREAS      = AREAS.filter(daqui);
  MODULOS    = MODULOS.filter(daqui);
  AUTOMACOES = AUTOMACOES.filter(daqui);
  AGENTES    = AGENTES.filter(daqui);

  /* ── RECORTE MSB (20/10/26) ───────────────────────────────────── */
  // No portal da MSB o Comercial mostra só o Sales Report (com as abas) e a
  // Tabela de Preços: os outros módulos e os agentes do Comercial saem da
  // busca — mesmo recorte do NAV.comercial de nav-sidebar.js e dos cartões
  // de pages/comercial.html. O Estoque fica inteiro (voltou no mesmo dia).
  var MSB_VISIVEIS = [
    'comercial-sales-report.html', 'comercial-performance-vendas.html', 'comercial-vendas.html',
    'comercial-clientes.html', 'comercial-base-notas-fiscais.html', 'comercial-novos-negocios.html',
    'comercial-clientes-perdidos.html', 'comercial-comportamento-clientes.html',
    'comercial-calendario-cirurgico.html', 'comercial-tabela-precos.html'
  ];
  function msbVisivel(area, arquivo) { return area !== 'comercial' || MSB_VISIVEIS.indexOf(arquivo) >= 0; }
  AREAS      = AREAS.map(function (a) {
    return a[0] !== 'comercial' ? a : [a[0], a[1], 'Sales Report e Tabela de Preços.', a[3], a[4], a[5]];
  });
  MODULOS    = MODULOS.filter(function (m) { return msbVisivel(m[0], m[3]); });
  AUTOMACOES = AUTOMACOES.filter(function (a) { return msbVisivel(a[0], a[2]); });
  AGENTES    = AGENTES.filter(function (a) { return msbVisivel(a[0], a[2]); });

  function fav(d) {
    return '<img src="https://www.google.com/s2/favicons?domain=' + d + '&sz=64" alt="">';
  }
  function nomeDaArea(k) {
    for (var i = 0; i < AREAS.length; i++) { if (AREAS[i][0] === k) return AREAS[i][1]; }
    return k;
  }
  function juntar(base, extra) {
    var o = {}, k;
    for (k in base)  { if (Object.prototype.hasOwnProperty.call(base, k))  o[k] = base[k]; }
    for (k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k]; }
    return o;
  }

  // Monta o indice pronto para o palette.
  //   P = prefixo das paginas: '' dentro de /pages/, 'pages/' na raiz.
  // Devolve { itens, drill }:
  //   itens = lista plana (Areas, Sistemas, Modulos, Automacoes, Agentes)
  //   drill = { '<Area>': { key, page, items, automacoes, agentes } }
  function build(P) {
    P = P || '';
    var itens = [], drill = {};

    AREAS.forEach(function (a) {
      drill[a[1]] = { key: a[0], page: P + a[3], items: [], automacoes: [], agentes: [] };
      itens.push({ group: 'Áreas', name: a[1], area: a[0], cat: a[2], href: P + a[3],
        ext: false, drillKey: a[1], iconHTML: ic[a[4]] || ic.grid, kw: a[5] || '' });
    });

    SISTEMAS.forEach(function (s) {
      itens.push({ group: 'Sistemas', name: s[0], area: null, cat: s[1], href: s[2],
        ext: true, iconHTML: fav(s[3]), kw: s[4] || '' });
    });

    MODULOS.forEach(function (m) {
      var an = nomeDaArea(m[0]);
      var base = { name: m[1], area: m[0], href: P + m[3], ext: false,
        iconHTML: ic[m[4]] || ic.sub, kw: m[5] || '' };
      itens.push(juntar(base, { group: 'Módulos', cat: an + ' · ' + (m[2] || 'Módulo') }));
      if (drill[an]) drill[an].items.push(juntar(base, { cat: m[2] || 'Módulo' }));
    });

    AUTOMACOES.forEach(function (a) {
      var an = nomeDaArea(a[0]);
      var base = { name: a[1], area: a[0], href: P + a[2], ext: false, iconHTML: ic.zap, kw: a[3] || '' };
      itens.push(juntar(base, { group: 'Automações', cat: an + ' · Automação' }));
      if (drill[an]) drill[an].automacoes.push(juntar(base, { cat: 'Automação' }));
    });

    AGENTES.forEach(function (a) {
      var an = nomeDaArea(a[0]);
      var base = { name: a[1], area: a[0], href: P + a[2], ext: false, iconHTML: ic.bot, kw: a[3] || '' };
      itens.push(juntar(base, { group: 'Agentes de IA', cat: an + ' · Agente de IA' }));
      if (drill[an]) drill[an].agentes.push(juntar(base, { cat: 'Agente de IA' }));
    });

    return { itens: itens, drill: drill };
  }

  // Texto que a busca casa: nome + categoria + grupo + palavras-chave, sem
  // acento (quem digita "cotacao" acha "Cotações").
  function semAcento(s) {
    return String(s || '').toLowerCase()
      .replace(/[áàâãä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[íìîï]/g, 'i')
      .replace(/[óòôõö]/g, 'o').replace(/[úùûü]/g, 'u')
      .replace(/ç/g, 'c').replace(/ñ/g, 'n');
  }
  function texto(it) {
    if (!it._t) {
      it._t = semAcento([it.name, it.cat, it.group, it.kw].join(' '))
        .replace(/[·|]/g, ' ').replace(/\s+/g, ' ');
    }
    return it._t;
  }
  // Termo curto (1-2 letras) casa so por palavra inteira: "nf" acha a Base
  // de Notas Fiscais, mas nao "Infra"/"Internet".
  function casaTermo(t, termo) {
    if (termo.length > 2) return t.indexOf(termo) >= 0;
    var i = t.indexOf(termo);
    while (i >= 0) {
      var antes  = i === 0 ? ' ' : t.charAt(i - 1);
      var depois = t.charAt(i + termo.length) || ' ';
      if (!/[a-z0-9]/.test(antes) && !/[a-z0-9]/.test(depois)) return true;
      i = t.indexOf(termo, i + 1);
    }
    return false;
  }
  // Casa TODOS os termos digitados (ordem livre): "vendas licitacao" acha a
  // Analise de Vendas da Licitacao.
  function casa(it, q) {
    var termos = semAcento(q).split(/[^a-z0-9]+/).filter(Boolean);
    if (!termos.length) return true;
    var t = texto(it);
    for (var i = 0; i < termos.length; i++) { if (!casaTermo(t, termos[i])) return false; }
    return true;
  }

  return {
    versao: versao,
    ic: ic,
    areas: AREAS,
    modulos: MODULOS,
    automacoes: AUTOMACOES,
    agentes: AGENTES,
    sistemas: SISTEMAS,
    build: build,
    casa: casa
  };
})();
