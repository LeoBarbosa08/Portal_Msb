/* ================================================================
   sw.js — Service Worker do Portal MSB (PWA)
   Estratégia:
   - Navegações (HTML): network-first → cache → offline.html
   - Assets estáticos: cache-first com atualização em background
   - Ignora outras origens (MSAL/Power BI/CDN) e rotas /api e /.auth
   ================================================================ */
const VERSION = 'bm-comest-v79';   // portal Comercial + Estoque (cache próprio) · v2 = recorte MSB · v3 = identidade visual MSB · v4 = recorte de empresa MSB (20/10/26) · v5 = Regional nas abas do Sales Report, sem Calendário/Novos Negócios/Clientes Perdidos (22/10/26) · v6 = sem o InventarIA e o Vigia de Consignação (30/10/26) · v7 = PI · Pedido de volta, só do dono (04/11/26) · v8 = CRM › Venda Recorrente (04/11/26) · v9 = CRM sem submódulo (05/11/26) · v10 = unidade MSB (05/11/26) · v11 = proposta MSB + estoque da venda (05/11/26) · v12 = sem a fase A faturar (05/11/26) · v13 = Código do produto (05/11/26) · v14 = nome do item e motivo do Salesforce (05/11/26) · v15 = sem a coluna Un (05/11/26) · v16 = PI na mesma aba (05/11/26) · v17 = menu lateral na tela dividida (05/11/26) · v18 = Análise de Pedidos · campo Operação (06/11/26) · v19 = coluna Status de liberação (06/11/26) · v20 = filtro Operação na Análise de Vendas (06/11/26) · v21 = Faturamento do Dia, só do dono (06/11/26) · v22 = área Kanban (06/11/26) · v23 = operações do Faturamento do Dia (06/11/26) · v24 = regra estrita das operações (07/11/26) · v25 = Kanban e Faturamento do Dia ocultos (07/11/26) · v26 = Kanban em 4 colunas + faturamento no banner (07/11/26) · v27 = notas por tipo de operação (07/11/26) · v28 = Faturamento do Dia sem os tipos de operação (07/11/26) · v29 = Operação na Base de Notas + sonda (09/11/26) · v30 = ficha da OV no Kanban (09/11/26) · v31 = operação pela OV + dado cru da nota (09/11/26) · v32 = junção das duas sessões (09/11/26) · v33 = Kanban só ALMOX-PA + coluna Logística + cartão de volta só do dono (09/11/26) · v34 = Faturamento do Dia: número repetido, vale o registro 1 (09/11/26) · v35 = crédito do Kanban pela tabela BioCredManTableV1 (09/11/26) · v36 = Exportar Excel no Faturamento do Dia (09/11/26) · v37 = operação = FiscalDocumentOperationTypeId da OV (09/11/26) · v38 = só os tipos de operação aceitos (09/11/26) · v39 = Kanban em 6 colunas: Separação, Conferência e Cotação (09/11/26) · v40 = Faturamento do Dia: só nota com status Aprovado (09/11/26) · v41 = Kanban: Separação/Conferência pelo trabalho de depósito (09/11/26) · v42 = Kanban: coluna Expedição (09/11/26) · v43 = Kanban sem a linha embaixo do título (09/11/26) · v44 = status só de documento com data perto da nota (09/11/26) · v45 = sonda mostra as colunas (09/11/26) · v46 = Kanban: carga da OV na ficha (09/11/26) · v47 = Faturamento do Dia liberado para o Comercial (09/11/26) · v48 = Kanban liberado para todo mundo (09/11/26) · v49 = Kanban: nota fiscal da OV e coluna Rejeitada (09/11/26) · v50 = Kanban: coluna Pallet (09/11/26) · v51 = Kanban cabe na tela + status da nota pela FiscalDocumentBioEntity (09/11/26) · v52 = Kanban: em aberto de qualquer data + período em Faturado/Rejeitada/Pallet/Expedição (09/11/26) · v53 = Kanban: regras do dono pela carga/nota + Enviar para o Pallet (09/11/26) · v54 = Kanban: entidade de cargas com os _CUSTOM + botão do Pallet com o motivo (09/11/26) · v55 = Kanban: Conferência só pela carga em processamento (09/11/26) · v56 = Kanban: Aguardando Faturamento + cotação pelo QuotationPerformed_InoveProjects (09/11/26) · v57 = Kanban: Pendência + quadro em 4 x 4 x 3 (09/11/26) · v58 = Kanban: colunas da mesma altura + entidade de cargas com a cotação (09/11/26) · v59 = Kanban: coluna do tamanho de 5 OVs (09/11/26) · v60 = Kanban: lista agrupada por etapa (10/11/26) · v61 = Kanban: a entidade de cargas certa de volta (10/11/26) · v62 = Kanban: carga só da WHSOutboundLoadHeaderEntity (10/11/26) · v63 = Kanban: carga pela WHSLoadTableBiEntity (10/11/26) · v64 = Kanban: Faturado sem data, todo o histórico (10/11/26) · v65 = Kanban: Pendência pelo lote + Separação só trabalho Abrir, a OV em partes (10/11/26) · v66 = Kanban: linha Entregue em Aguardando Faturamento (11/11/26) · v67 = Kanban: Cotação/Aguardando/Faturado pelo status da linha (11/11/26) · v68 = Kanban: Pendência de lado, vazia (11/11/26) · v69 = PI · Pedido liberado para o Comercial (11/11/26) · v70 = PI: endereço do cadastro do Dynamics (11/11/26) · v71 = PI: PDF no site Pedidos MSB, pasta PDF PI (11/11/26) · v72 = Kanban: selo PI Pedidos pela Área Demandante (11/11/26) · v73 = PI: endereço do cadastro só como informação (11/11/26) · v74 = Kanban: Pendência de volta, item sem lote (11/11/26) · v75 = Kanban: Pallet sem data, todas as cargas no botão e a conferência depois de gravar (11/11/26) · v76 = Kanban: Pallet = as que foram para o Pallet hoje (11/11/26) · v77 = Kanban: sem o botão Enviar para o Pallet (11/11/26) · v78 = Kanban: Pallet sem data, todas as OVs no Pallet (11/11/26) · v79 = Kanban: sem o período, Expedição só a expedida hoje (12/11/26)
const STATIC_CACHE  = VERSION + '-static';
const RUNTIME_CACHE = VERSION + '-runtime';

const PRECACHE = [
  '/index.html',
  '/styles.css',
  '/nav-sidebar.js',
  '/portal-catalogo.js',
  '/perfil-sheet.js',
  '/pwa.js',
  '/manifest.webmanifest',
  '/offline.html',
  '/icons/icon-512.png',
  '/icons/icon-192.png',
  '/icons/apple-touch-icon.png',
  '/icons/logo-msb.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf(VERSION) !== 0).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // só intercepta a própria origem; deixa MSAL/Power BI/CDN passarem direto
  if (url.origin !== self.location.origin) return;
  // nunca interfere em autenticação/API
  if (url.pathname.startsWith('/.auth') || url.pathname.startsWith('/api')) return;

  // Navegações (páginas HTML): rede primeiro, cai pro cache, depois offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/offline.html')))
    );
    return;
  }

  // Assets estáticos: cache primeiro, revalida em background
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
