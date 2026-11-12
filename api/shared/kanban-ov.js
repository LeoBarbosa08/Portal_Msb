// ================================================================
// api/shared/kanban-ov.js — ORDENS DE VENDA DO DIA para o quadro KANBAN
//                           (D365 F&O, ao vivo, só a empresa MSB)
//
// Pedido do dono (06/11/2026): "crie uma área chamada KANBAN, conecte as
// ordens de venda (BIOSalesOrderHeaderV1, SalesOrderHeaderV3…), traga as
// ordens de venda do dia; depois vou triar o que cada status significa;
// integração realtime".
//
// SOMENTE LEITURA no Dynamics. NUNCA escreve.
//
// ── AS ENTIDADES ─────────────────────────────────────────────────
// Cabeçalho da OV em DUAS fontes, juntas pelo número da OV:
//   • a PRINCIPAL é a que define "do dia": a primeira candidata que responde
//     com o número da OV E uma coluna de data de criação;
//   • as outras que respondem (a BIO própria e a padrão) entram como
//     COMPLEMENTO, lidas pelos números das OVs do dia.
// Candidatas, na ordem: KANBAN_ENT_OV (env, lista), as Bio próprias
// (BIOSalesOrderHeaderV1 & variações de nome público), SalesOrderHeadersV3,
// SalesOrderHeadersV2, SalesOrderHeaders, e o que mais o service document
// do F&O publicar com "salesorderheader" no nome. Mesma inteligência das
// Faturas em Aberto (cobranca-d365.js do portal completo): a entidade só é
// aceita se a linha de amostra expuser o que o papel exige, e o que deu
// certo/errado volta em `diagnostico` (?diag=1 traz as colunas).
//
// ── STATUS ───────────────────────────────────────────────────────
// O dono vai decidir depois o que cada status significa. Por isso NADA de
// status é traduzido aqui: TODA coluna com cara de status, de TODAS as
// entidades, vai para a tela com os valores crus e a contagem de OVs em
// cada um — a tela agrupa o quadro pela coluna escolhida. Cada OV leva
// também os campos crus de cada entidade (sem os vazios), para conferir.
//
// ── DATA ─────────────────────────────────────────────────────────
// "Do dia" = criada no dia em Brasília (UTC-3, sem horário de verão desde
// 2019). Coluna data-hora: [dia 03:00Z, dia+1 03:00Z). Coluna só data:
// [dia 00:00Z, dia+1 00:00Z), e no formato Edm.Date se a data-hora der 400.
// ================================================================

const D = require('./d365');
const ST_NOTA = require('./fatdia-status');   // status da nota (documento fiscal / NF-e), pelo número

const EMPRESA   = String(process.env.KANBAN_EMPRESA || process.env.ESTOQUE_MSB_EMPRESA || 'msb').trim().toLowerCase();
const TTL_MS    = Number(process.env.KANBAN_TTL_MS || 15000);        // cache do dia: 15 s (a tela consulta a cada 30 s)
// o QUADRO (em aberto de qualquer data, aberto a todos) é mais pesado: 45 s de
// cache — várias pessoas com o quadro aberto viram UMA leitura no Dynamics
const TTL_QUADRO = Number(process.env.KANBAN_TTL_QUADRO_MS || 45000);
const ORCAMENTO = Number(process.env.KANBAN_ORCAMENTO_MS || 36000);  // SWA corta em ~45 s
const PROVA_MS  = Number(process.env.KANBAN_PROVA_MS || 8000);
const PRAZO_MS  = Number(process.env.KANBAN_PRAZO_MS || 20000);
const LOTE_OV   = 20;                                                 // OVs por consulta (complemento e linhas)
const ENT_TTL   = 30 * 60000;
const FOLGA_MS  = 1500;
const FUSO_H    = 3;                                                  // Brasília = UTC-3

function envLista(nome, padrao) {
  const v = String(process.env[nome] || '').trim();
  return v ? v.split(',').map(s => s.trim()).filter(Boolean) : padrao;
}

const CANDIDATAS = envLista('KANBAN_ENT_OV', []).concat([
  'BIOSalesOrderHeaderV1', 'BIOSalesOrderHeadersV1', 'BioSalesOrderHeaderV1Entities', 'BIOSalesOrderHeaderV1Entities',
  'SalesOrderHeadersV3', 'SalesOrderHeadersV2', 'SalesOrderHeaders'
]).filter((v, i, a) => a.indexOf(v) === i);
const ENT_LINHAS = envLista('KANBAN_ENT_LINHAS', ['SalesOrderLines', 'SalesOrderLinesV2', 'SalesOrderLinesV3']);

// colunas de cada informação, pelos nomes que ela tem nas entidades do F&O
const COLS = {
  numero:   envLista('KANBAN_COL_NUMERO', ['SalesOrderNumber', 'SalesId', 'SALESID', 'SalesOrderId']),
  criadaEm: envLista('KANBAN_COL_CRIADA', ['OrderCreationDateTime', 'SalesOrderCreationDateTime', 'CreatedDateTime', 'CREATEDDATETIME', 'CreatedOn', 'CreatedDate', 'CreationDate']),
  conta:    ['OrderingCustomerAccountNumber', 'CustomerAccountNumber', 'CustAccount', 'CUSTACCOUNT', 'InvoiceCustomerAccountNumber'],
  nome:     ['SalesOrderName', 'SalesName', 'SALESNAME', 'CustomerName', 'DeliveryAddressName'],
  oc:       ['CustomersOrderReference', 'CustomerRequisitionNumber', 'PurchOrderFormNum', 'CustomerRef', 'PurchaseOrderFormNumber'],
  entrega:  ['RequestedShippingDate', 'ShippingDateRequested', 'RequestedReceiptDate', 'DeliveryDate'],
  deposito: ['DefaultShippingWarehouseId', 'InventLocationId', 'ShippingWarehouseId'],
  pool:     ['SalesOrderPoolId', 'SalesPoolId'],
  criadoPor:['OrderTakerPersonnelNumber', 'CreatedBy', 'CREATEDBY', 'OrderResponsiblePersonnelNumber'],
  // 11/11/2026 (dono): "quando o pedido tiver AREADEMANDANTE (areademandante_Custom),
  // sinalizar que veio do PI Pedidos" — o PI grava a Área Demandante na OV
  // (api/pedido-enviar · Areademandante). Nome exato (sem caixa) ou o pedaço do nome.
  area:     envLista('KANBAN_COL_AREA', ['areademandante_Custom', 'AreaDemandante_Custom', 'AreaDemandante', 'Areademandante'])
};
const RE_AREA = /area_?demandante/i;
// 12/11/2026 (dono): "insira esses campos a mais nos Dados do pedido:
// Solicitartransportadora_Custom, CarrierName_InoveProjects,
// CustomerOrderNumber_Inove, Operador_Custom — preciso dessas informações".
// Lidos em qualquer entidade de OV lida (nome sem caixa), com o valor COMO VIER —
// inclusive "No" e vazio, que os campos crus (crus/VAZIOS) jogam fora. Lista
// trocável por env: KANBAN_CAMPOS_EXTRA.
const CAMPOS_EXTRA = envLista('KANBAN_CAMPOS_EXTRA', ['Solicitartransportadora_Custom', 'CarrierName_InoveProjects', 'CustomerOrderNumber_Inove', 'Operador_Custom']);
const COL_AREA_TXT = () => COLS.area[0];
function colArea(row) { const cols = colunasDe(row); return achaCol(cols, COLS.area) || cols.find(c => RE_AREA.test(c)) || null; }
// SÓ O DEPÓSITO ALMOX-PA (09/11/2026, pedido do dono: "depósito somente o que
// for ALMOX-PA, não precisa do restante"): a OV de outro depósito — ou sem
// depósito — fica fora do quadro. Pelo depósito do CABEÇALHO da OV (COLS.deposito).
// Trocável por env (lista): KANBAN_DEPOSITOS=ALMOX-PA,OUTRO; "*" = todos.
const DEPOSITOS = envLista('KANBAN_DEPOSITOS', ['ALMOX-PA']).map(s => s.toUpperCase());
const TODOS_DEPOSITOS = DEPOSITOS.indexOf('*') >= 0;
const RE_CRIADA = /creat.*(date|time)|criad/i;
// coluna com cara de status (inclusive as próprias da Bio, em português)
const RE_STATUS = /status|situa|stage|etapa|fase|workflow|libera|release|hold|bloq|credit|credito|cr[eé]dito/i;
const RE_NAO_STATUS = /date|time|data|hora|reason|motivo|user|usuario|by$|limit|amount|valor|id$|number|card|cartao/i;
const VAZIOS = /^(|0|1900-01-01T00:00:00Z|00000000-0000-0000-0000-000000000000|None|NoYes'No'|No)$/;

// ── AS 4 ETAPAS DO QUADRO (07/11/2026, definidas pelo dono) ──────
// "Quando a ordem entra no sistema ela entra como Criada, depois vai para
// Gerenciamento de Crédito, Liberado e Faturado." Pelos campos da OV:
//   SalesStatus            "Ordem em aberto" (Backorder) | Faturado | Entregue | Cancelado
//   ReleaseStatus          "Liberado" (Released) | "Abrir" (Open)
//   CredManInCreditControl marcado = em gerenciamento de crédito
// Ordem de prioridade (a da fala do dono, ajustada num ponto: OV FATURADA
// também está liberada — a OV017517 tem Faturado + Liberado —, então o
// "Liberado" só vale para a ordem ainda em aberto):
//   1) SalesStatus que não é "Ordem em aberto" -> Faturado ("o restante")
//      (cancelada não é faturamento: fica FORA do quadro, contada à parte)
//   2) CredManInCreditControl marcado          -> Gerenciamento de Crédito
//   3) ReleaseStatus = Liberado                -> Separação (id liberado)
//   4) senão                                   -> Criada
// Aceita o valor do OData (nome do enum: Backorder, Released, Yes) e o rótulo
// em português da tela do F&O. Colunas trocáveis por env: KANBAN_COL_SALESSTATUS,
// KANBAN_COL_RELEASE, KANBAN_COL_CREDITO.
// 09/11/2026 (dono): SEIS colunas — "Criada, Gerenciamento de Crédito,
// Separação (ReleaseStatus = Released), Conferência, Cotação, Faturado;
// conferência e cotação irei te mandar os campos para definição da fase".
//   • Separação = a antiga "Liberado"/"Logística": o id segue 'liberado' e a
//     regra é a mesma (ReleaseStatus = Liberado);
//   • Conferência e Cotação entram no quadro VAZIAS (pendente: true) até o
//     dono mandar os campos — nenhuma OV cai nelas por enquanto.
const ETAPAS = [
  // 09/11/2026 (dono): "insira antes de Criada o card PENDÊNCIA"; 10/11/2026: a
  // regra do lote (linhas em aberto sem lote); 11/11/2026 (dono): "deixa a
  // Pendência de lado por enquanto" — e, no mesmo dia, "volte para a Pendência
  // tudo que não tiver LOTE na linha, seguindo a lei do SPLIT": a regra do lote
  // LIGADA de novo (partesPorLinhas; KANBAN_PENDENCIA_LOTE=0 desliga)
  { id: 'pendencia',   nome: 'Pendência' },
  { id: 'criada',      nome: 'Criada' },
  { id: 'credito',     nome: 'Gerenciamento de Crédito' },
  { id: 'liberado',    nome: 'Separação' },
  // Conferência: trabalho de depósito da OV FECHADO (09/11/26 — ver TRABALHO DE DEPÓSITO)
  { id: 'conferencia', nome: 'Conferência' },
  // Cotação: vai sair das CARGAS (WHSOutboundLoadHeaderEntity) — status e
  // campos a definir pelo dono; por ora a carga só aparece na ficha
  { id: 'cotacao',     nome: 'Cotação' },
  // 09/11/2026 (dono): "insira depois da Cotação AGUARDANDO FATURAMENTO, onde
  // Carga -> Status da carga = Carregado AND Cotação realizada = Sim"
  { id: 'aguardando',  nome: 'Aguardando Faturamento' },
  { id: 'faturado',    nome: 'Faturado' },
  // 09/11/2026 (dono): "crie depois de FATURADA um card escrito REJEITADA,
  // caso a NF seja rejeitada, ou cancelada/descartada" — ver NOTAS FISCAIS
  { id: 'rejeitada',   nome: 'Rejeitada' },
  // 09/11/2026 (dono: "um card a mais que vai chamar PALLET, que vem depois do
  // rejeitado"): VAZIA até o dono mandar os campos
  { id: 'pallet',      nome: 'Pallet' },
  // 09/11/2026 (dono: "insira mais um cartão de Expedição"): depois do
  // Faturado — a mercadoria sai com a nota. VAZIA até o dono mandar os campos.
  { id: 'expedicao',   nome: 'Expedição' }
];
const COL_SALES   = envLista('KANBAN_COL_SALESSTATUS', ['SalesStatus', 'SalesOrderStatus']);
const COL_RELEASE = envLista('KANBAN_COL_RELEASE', ['ReleaseStatus', 'SalesOrderReleaseStatus']);
const COL_CREDITO = envLista('KANBAN_COL_CREDITO', ['CredManInCreditControl', 'CreditManagementInCreditControl', 'InCreditControl']);
// ── GERENCIAMENTO DE CRÉDITO PELA TABELA DA BIO (09/11/2026) ─────
// Dono: "gerenciamento de crédito vem dessa tabela (Credit management:
// BioCredManTableV1Staging -> BioCredManTableV1Entity), o campo é ACTIVE, a
// ordem é SALESID; cruzar com o nº da OV do BIOSalesOrderHeader e ver se está
// ativo". OV com um registro ATIVO na tabela -> Gerenciamento de Crédito; sem
// registro, ou só com registro inativo -> não está no crédito. A tabela vale
// ANTES do CredManInCreditControl do cabeçalho, que fica só de reserva para
// quando a entidade não responder (com aviso na tela).
// O nome PÚBLICO da entidade no OData não se sabe daqui: as candidatas abaixo
// + o que o service document publicar com "credman" no nome (KANBAN_ENT_CREDITO
// fixa outro). Colunas pelo nome, sem caixa: KANBAN_COL_CREDITO_OV (SALESID) e
// KANBAN_COL_CREDITO_ATIVO (ACTIVE).
const ENT_CREDITO = envLista('KANBAN_ENT_CREDITO', []).concat([
  'BioCredManTableV1', 'BioCredManTablesV1', 'BioCredManTableV1Entity', 'BioCredManTableV1Entities',
  'BIOCredManTableV1', 'BIOCredManTablesV1', 'BioCredManTable', 'BioCredManTables'
]).filter((v, i, a) => a.indexOf(v) === i);
const COL_CRED_OV    = envLista('KANBAN_COL_CREDITO_OV', ['SALESID', 'SalesOrderNumber', 'SalesOrderId']);
const COL_CRED_ATIVO = envLista('KANBAN_COL_CREDITO_ATIVO', ['ACTIVE', 'IsActive']);
// ── TRABALHO DE DEPÓSITO: SEPARAÇÃO -> CONFERÊNCIA (09/11/2026) ──
// Dono: "Separação será o status do ReleaseStatus e a fase é em processo;
// quando sair desse status para fechado ele vai para Conferência". A fase é a
// do TRABALHO de depósito da OV (WHSWorkTableBiEntity — o cabeçalho do
// trabalho: WorkStatus Aberto/Em processo/Fechado/Cancelado), ligado à OV
// pelo nº do pedido de origem (OrderNum). Por OV, sem os cancelados/combinados:
//   • todos os trabalhos FECHADOS            -> Conferência
//   • algum aberto ou em processo            -> Separação (mesmo sem o
//     ReleaseStatus = Liberado: parcialmente liberada, por ex.)
//   • sem trabalho                           -> segue o ReleaseStatus
// Nome público no OData e colunas: descobertos como os da tabela de crédito
// (candidatas + "worktable"/"warehousework" no service document; env
// KANBAN_ENT_TRABALHO, KANBAN_COL_TRABALHO_OV, KANBAN_COL_TRABALHO_STATUS).
const ENT_TRABALHO = envLista('KANBAN_ENT_TRABALHO', []).concat([
  'WHSWorkTableBiEntities', 'WHSWorkTableBiEntity', 'WHSWorkTableBi', 'WHSWorkTableBis',
  'WarehouseWorkHeadersBi', 'WarehouseWorkHeaders', 'WHSWorkTables', 'WarehouseWorkTables'
]).filter((v, i, a) => a.indexOf(v) === i);
const COL_TRAB = {
  numero:   envLista('KANBAN_COL_TRABALHO_OV', ['OrderNum', 'OrderNumber', 'SourceOrderNumber', 'SalesId', 'SalesOrderNumber']),
  status:   envLista('KANBAN_COL_TRABALHO_STATUS', ['WorkStatus', 'Status']),
  id:       ['WorkId'],
  tipo:     ['WorkTransType', 'WorkOrderType', 'TransType'],
  usuario:  ['LockedUser', 'WorkInProcessUserId', 'UserId'],
  inicio:   ['WorkInProcessUTCDateTime', 'WorkInProcessDateTime'],
  fim:      ['WorkClosedUTCDateTime', 'WorkClosedDateTime'],
  criado:   ['WorkCreatedDateTime', 'WorkCreatedUTCDateTime', 'CreatedDateTime'],
  onda:     ['WaveId'],
  carga:    ['LoadId'],
  remessa:  ['ShipmentId'],
  deposito: ['InventLocationId', 'WarehouseId']
};
// ── CARGAS (a futura COTAÇÃO, 09/11/2026) ─────────────────────────
// Dono: "na hora da cotação vou integrar com essa entidade de cargas,
// WHSOutboundLoadHeaderEntity, e vou definir os status e campos para que
// esteja em cotação". Por enquanto SÓ LEITURA, sem regra: a carga de cada OV
// vai para a ficha (status, transportadora, modo, datas) e para os campos
// crus — o material para o dono escolher os campos. A Cotação segue pendente.
// O cabeçalho da carga não tem a OV: a ligação é pelo LoadId dos TRABALHOS de
// depósito da OV (OV -> trabalho -> carga). Descoberta como as outras extras
// (candidatas + "outboundload"/"loadheader" no service document; env
// KANBAN_ENT_CARGA, KANBAN_COL_CARGA_ID, KANBAN_COL_CARGA_STATUS).
// 10/11/26 (dono): "work você ainda vai pegar o trabalho, porém da carga você vai
// pegar as info dessa entidade, WHSOutboundLoadHeaderEntity" — SÓ ela: os nomes
// públicos que ela pode ter no OData (OutboundLoadHeaders é o padrão do D365) e,
// do service document, só os com "outboundloadheader" no nome. Nada de outras
// entidades de carga (uma qualquer com "load" no nome já sumiu com as cargas).
// 10/11/26, depois (dono): "na verdade a entidade acho que é essa, WHSLoadTableBiEntity"
// — a BI da tabela de cargas (como a WHSWorkTableBiEntity do trabalho, que funciona)
// vem PRIMEIRO; a WHSOutboundLoadHeaderEntity fica de reserva. Entre as duas, vale
// a que tiver os campos (status, cotação, pallet).
const ENT_CARGA_BI = ['WHSLoadTableBiEntities', 'WHSLoadTableBiEntity', 'WHSLoadTableBis', 'WHSLoadTableBi'];
const ENT_CARGA_CAB = ['WHSOutboundLoadHeaderEntities', 'WHSOutboundLoadHeaderEntity', 'OutboundLoadHeaders', 'WHSOutboundLoadHeaders'];
const ENT_CARGA = envLista('KANBAN_ENT_CARGA', []).concat(ENT_CARGA_BI, ENT_CARGA_CAB).filter((v, i, a) => a.indexOf(v) === i);
const COL_CARGA = {
  numero:         envLista('KANBAN_COL_CARGA_ID', ['LoadId']),
  // 10/11/26: só LoadStatus — o "Status" genérico fazia uma entidade qualquer com
  // "load" no nome ganhar da de cargas (e as cargas da OV sumiam)
  status:         envLista('KANBAN_COL_CARGA_STATUS', ['LoadStatus']),
  transportadora: ['CarrierCode', 'ShippingCarrierId', 'CarrierId'],
  servico:        ['CarrierServiceCode', 'ModeCode', 'DeliveryModeCode', 'TransportationModeCode'],
  envio:          ['ScheduledShippingDateTime', 'LoadSchedShipUTCDateTime', 'ScheduledLoadShippingDateTime', 'ScheduledShipDateTime'],
  expedido:       ['LoadShippedUTCDateTime', 'ShippedDateTime', 'ActualShippingDateTime'],
  deposito:       ['InventLocationId', 'WarehouseId', 'ShippingWarehouseId'],
  modelo:         ['LoadTemplateId'],
  // 09/11/2026 (dono): "Cotação realizada" e "ENVIARPALLET_CUSTOM" — campos
  // próprios da carga; nomes trocáveis por env (e procurados pelo pedaço do nome)
  // 09/11/26 (dono): "cotação realizada é esse campo aqui, QuotationPerformed_InoveProjects"
  cotacao:        envLista('KANBAN_COL_CARGA_COTACAO', ['QuotationPerformed_InoveProjects', 'COTACAOREALIZADA_CUSTOM', 'CotacaoRealizada_Custom', 'CotacaoRealizada', 'QuotationDone_Custom']),
  pallet:         envLista('KANBAN_COL_CARGA_PALLET', ['ENVIARPALLET_CUSTOM', 'EnviarPallet_Custom', 'EnviarPallet']),
  // 12/11/2026 (dono): "na fase EXPEDIÇÃO, a WHSLoadTableBiEntities tem um campo
  // LoadShipConfirmUTCDateTime — leve para a Expedição se a data desse campo for hoje"
  envioConfirmado: envLista('KANBAN_COL_CARGA_ENVIO_CONFIRMADO', ['LoadShipConfirmUTCDateTime'])
};
// ── AS REGRAS DO DONO PELA CARGA E PELA NOTA (09/11/2026) ─────────
//   Separação   = status do TRABALHO = "Abrir" (Open)
//   Conferência = status da CARGA = "Em processamento" (InProcess)
//   Cotação     = CARGA "Carregado" (Loaded) E "Cotação realizada" = Não
//   Aguardando Faturamento = CARGA "Carregado" E "Cotação realizada" = Sim
//                 (QuotationPerformed_InoveProjects)
//   Faturado    = NOTA FISCAL "Aprovada"
//   Pallet      = botão "Enviar para o Pallet" (carga Carregado E cotação
//                 realizada = Sim) grava ENVIARPALLET_CUSTOM = Sim no D365
//   Rejeitada   = nota "Rejeitada" (e cancelada/descartada, pedido anterior)
//   Expedição   = status da CARGA = "Remetido" (Shipped) — 12/11/26: e o envio
//                 da carga confirmado (LoadShipConfirmUTCDateTime); o QUADRO mostra
//                 só as confirmadas HOJE, de OV de qualquer data
// Fase da carga da OV (a MENOS adiantada, se a OV tiver mais de uma carga):
//   remetido > pallet > cotado (carregado + cotação Sim) > cotacao (carregado +
//   cotação Não) > processando > outro
// Sim / Não para as mensagens (o OData devolve o enum: Yes / No)
const simNaoV = (v) => marcadoV(v) ? 'Sim' : /^(no|nao|false|0|noyes no)$/.test(normV(v)) ? 'Não' : (txt(v) || 'vazia');
const RANK_CARGA = { outro: 0, processando: 1, cotacao: 2, cotado: 3, pallet: 4, remetido: 5 };
function faseCarga(c) {
  const st = normV(c.status).replace(/ /g, '');
  if (c.envioConfirmado || /^(shipped|remetid|expedid)/.test(st)) return 'remetido';
  if (c.palletSim) return 'pallet';
  if (/^(loaded|carregad)/.test(st)) return c.cotacaoSim ? 'cotado' : 'cotacao';
  if (/^(inprocess|emprocessament|emprocess|inpacking|emembalagem)/.test(st)) return 'processando';
  return 'outro';
}
// ── NOTAS FISCAIS DA OV: o número e a REJEITADA (09/11/2026) ──────
// Dono: "crie depois de FATURADA um card escrito REJEITADA, caso a NF seja
// rejeitada, ou cancelada/descartada" e "preciso saber qual a nota fiscal".
// As notas da OV saem do DIÁRIO DE FATURAS (SalesInvoiceHeadersV2, pelo
// SalesOrderNumber — o mesmo do Faturamento do Dia) e o STATUS de cada nota,
// do documento fiscal / NF-e, PELO NÚMERO (api/shared/fatdia-status.js, a
// mesma leitura que tira a nota "Descartado" do Faturamento do Dia). Vale a
// nota MAIS RECENTE da OV com status: rejeitada / cancelada / descartada /
// denegada -> coluna Rejeitada (antes de qualquer outra regra, menos a OV
// cancelada); reemitida e aprovada -> volta a valer a regra de sempre.
const ENT_NOTA = envLista('KANBAN_ENT_NOTA', []).concat(['SalesInvoiceHeadersV2', 'SalesInvoiceHeaders', 'SalesInvoiceHeaderV4Entity'])
  .filter((v, i, a) => a.indexOf(v) === i);
const COL_NOTA = {
  numero: ['SalesOrderNumber', 'SalesId'],
  nota:   ['InvoiceNumber', 'InvoiceId'],
  data:   ['InvoiceDate', 'InvoiceDateTime'],
  valor:  ['TotalInvoiceAmount', 'InvoiceAmount', 'InvoiceTotalAmount']
};
const nfRejeitadaV = (v) => /^(rejected|rejeitad|rejection|cancel|discard|descartad|denied|denegad)/.test(normV(v).replace(/ /g, ''));
// fase de UM trabalho, pelo WorkStatus (nome do enum no OData ou rótulo da tela)
function faseTrab(v) {
  const n = normV(v);
  if (/^(closed|fechado|fechada|encerrado|encerrada)$/.test(n)) return 'fechado';
  if (/^(cancelled|canceled|cancelado|cancelada|combined|combinado|combinada)$/.test(n)) return 'ignora';
  if (/^(inprocess|in process|em processo|em processamento|processando)$/.test(n)) return 'processo';
  if (/^(open|aberto|aberta)$/.test(n)) return 'aberto';
  return 'outro';
}
const normV = (v) => String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// enum SalesStatus do F&O: None 0, Backorder 1, Delivered 2, Invoiced 3, Canceled 4
function situacaoOv(v) {
  const n = normV(v);
  if (!n) return null;
  if (/^(backorder|ordem em aberto|em aberto|aberta|aberto|1)$/.test(n)) return 'aberta';
  if (/^(canceled|cancelled|cancelado|cancelada|4)$/.test(n)) return 'cancelada';
  if (/^(delivered|entregue|2)$/.test(n)) return 'entregue';
  return 'outra';
}
const liberadoV = (v) => /^(released|liberado|liberada)$/.test(normV(v));
const marcadoV = (v) => v === true || /^(yes|sim|true|1|noyes yes)$/.test(normV(v));
// trabalho = fase do trabalho de depósito da OV ('fechado' | 'processo' |
// 'aberto' | 'nenhum' = sem trabalho | null = sem a entidade no OData)
// nota  = a nota mais recente da OV com status: 'rejeitada' | 'aprovada' |
//         'outra' (status que não é nenhum dos dois) | null (sem nota/status)
// carga = a fase da carga da OV (faseCarga) ou null (sem carga)
// Do mais adiantado para o menos (09/11/2026, as regras do dono acima); onde
// as regras do dono não falam, as anteriores ficam de reserva.
// linha = o status da LINHA da OV ('aberta' = Ordem em aberto | 'entregue' |
// 'faturada' | null = as linhas não foram lidas -> vale a situação da OV)
function etapaDe(sales, release, credito, trabalho, nota, carga, linha) {
  const sit = situacaoOv(sales);
  if (sit === 'cancelada') return 'cancelada';
  if (nota === 'rejeitada') return 'rejeitada';
  if (carga === 'remetido') return 'expedicao';
  if (carga === 'pallet') return 'pallet';
  // 11/11/26 (dono): "o FATURADO é o status da linha Faturado"
  if (linha === 'faturada') return 'faturado';
  // sem as linhas: a nota aprovada / a OV fora do aberto e do entregue (reserva)
  if (linha == null && (nota === 'aprovada' || (sit === 'outra' && nota !== 'outra'))) return 'faturado';
  const lin = linha || (sit === 'entregue' ? 'entregue' : sit === 'aberta' ? 'aberta' : null);
  // 11/11/26 (dono): Cotação = carga Carregado E linha "Ordem em aberto";
  // Aguardando Faturamento = carga Carregado E linha "Entregue"
  const carregado = carga === 'cotacao' || carga === 'cotado';
  if (carregado && lin === 'entregue') return 'aguardando';
  if (carregado && lin === 'aberta') return 'cotacao';
  // reserva: linha Entregue e a OV sem carga nenhuma (sem depósito/WMS)
  if (lin === 'entregue' && !carga) return 'aguardando';
  if (carga === 'processando') return 'conferencia';
  if (marcadoV(credito)) return 'credito';
  // 10/11/26 (dono): "a Separação só pode abranger o trabalho = Abrir! somente
  // isso" — a OV com trabalho aberto E trabalho não aberto vira 2 cartões
  // (partesPorTrabalho); aqui chega a fase de UM grupo de trabalhos
  if (trabalho === 'aberto') return 'liberado';
  // trabalho em processo / fechado e a carga ainda sem fase das regras: já saiu
  // da Separação — fica na Conferência (a próxima)
  if (trabalho === 'processo' || trabalho === 'fechado') return 'conferencia';
  // reserva: sem a entidade de trabalho no OData (trabalho null), a liberação
  if (trabalho == null && liberadoV(release)) return 'liberado';
  return 'criada';
}

// ── util ─────────────────────────────────────────────────────────
const txt = (v) => String(v == null ? '' : v).trim();
function num(v) { if (v == null || v === '') return null; const n = Number(v); return isNaN(n) ? null : n; }
function colunasDe(row) { return Object.keys(row || {}).filter(k => k.charAt(0) !== '@'); }
function restante(ate) { return ate - Date.now(); }
function prazo(ate, teto) { return Math.max(1, Math.min(teto, restante(ate) - FOLGA_MS)); }
function hojeSP() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function maisDias(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function achaCol(cols, nomes) {
  const baixo = {}; cols.forEach(c => { baixo[c.toLowerCase()] = c; });
  for (const n of nomes) { const r = baixo[String(n).toLowerCase()]; if (r) return r; }
  return null;
}
const ehDataHora = (col) => /time/i.test(col);
// dia (Brasília) de um valor da coluna de criação
function diaDe(v, col) {
  const s = txt(v);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  if (!ehDataHora(col)) return s.slice(0, 10);
  const t = Date.parse(s.length === 10 ? s + 'T00:00:00Z' : s);
  return isNaN(t) ? null : new Date(t - FUSO_H * 3600000).toISOString().slice(0, 10);
}
function chaveOv(v) { return txt(v).toUpperCase(); }

// ── descoberta: quais entidades de cabeçalho respondem (cache 30 min) ─
let _ents = null, _entsTs = 0, _servico = null, _servicoTs = 0;
async function doServico(token, ate) {
  if (_servico && Date.now() - _servicoTs < ENT_TTL) return _servico;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), prazo(ate, 8000));
    const r = await fetch(D.RESOURCE + '/data', { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('service document ' + r.status);
    const j = JSON.parse(await r.text());
    _servico = (Array.isArray(j.value) ? j.value : []).map(e => txt(e && (e.name || e.url))).filter(Boolean);
  } catch (e) { _servico = _servico || []; }
  _servicoTs = Date.now();
  return _servico;
}

async function sondar(ent, token, ate) {
  let rows = null, erro = null;
  for (const filtro of ["dataAreaId eq '" + D.odataStr(EMPRESA) + "'", null]) {
    try {
      rows = await D.odataGetComPrazo(ent, Object.assign({ top: 1, crossCompany: true }, filtro ? { filter: filtro } : {}), token, prazo(ate, PROVA_MS));
      if (rows.length) break;
    } catch (e) { erro = String(e.message || e); if (/\b404\b/.test(erro) || e.demorou) break; }
  }
  if (!rows || !rows.length) return { entidade: ent, serve: false, erro: erro ? erro.slice(0, 200) : 'sem linhas' };
  const cols = colunasDe(rows[0]);
  const numero = achaCol(cols, COLS.numero);
  const criadaEm = achaCol(cols, COLS.criadaEm) || cols.find(c => RE_CRIADA.test(c)) || null;
  const temEmpresa = cols.some(c => c.toLowerCase() === 'dataareaid');
  return { entidade: ent, serve: !!numero, numero, criadaEm, temEmpresa, colunas: cols, erro: numero ? null : 'sem coluna de número da OV' };
}

async function entidades(token, ate, diag, comColunas) {
  if (_ents && Date.now() - _entsTs < ENT_TTL) { diag.push({ etapa: 'ov:entidades', cache: true, usadas: _ents.map(e => e.entidade) }); return _ents; }
  const servico = await doServico(token, ate);
  const existe = {}; servico.forEach(n => { existe[n.toLowerCase()] = n; });
  let alvos = CANDIDATAS.map(n => existe[n.toLowerCase()] || n);
  if (servico.length) {
    // com o service document: só as candidatas publicadas + as que ele tiver com "salesorderheader"
    alvos = alvos.filter(n => existe[n.toLowerCase()]);
    servico.filter(n => /salesorderheader/i.test(n) && alvos.indexOf(n) < 0).slice(0, 6).forEach(n => alvos.push(n));
    diag.push({ etapa: 'ov:servico', publicadas: alvos });
  }
  // em paralelo: a primeira abertura não pode gastar o orçamento testando uma a uma
  const sondas = await Promise.all(alvos.map(ent => sondar(ent, token, ate).catch(e => ({ entidade: ent, serve: false, erro: String(e.message || e).slice(0, 200) }))));
  const achadas = [];
  sondas.forEach(s => {
    const item = { etapa: 'ov:entidade', entidade: s.entidade, serve: s.serve, numero: s.numero || null, criadaEm: s.criadaEm || null, empresa: !!s.temEmpresa, erro: s.erro };
    if (comColunas && s.colunas) item.colunas = s.colunas;
    diag.push(item);
    if (s.serve) achadas.push(s);
  });
  if (achadas.length) { _ents = achadas; _entsTs = Date.now(); }
  return achadas;
}

// ── entidades EXTRAS da OV (crédito, trabalho de depósito) ────────
// Mesma descoberta para as duas: as candidatas + o que o service document
// publicar com o pedaço do nome (reNome); a que tiver as colunas obrigatórias
// na linha de amostra serve. Cache 30 min (sem ela, refaz em 5 min); o motivo
// de não servir vai para o aviso da tela.
const CFG_CREDITO = {
  chave: 'credito', candidatas: ENT_CREDITO, reNome: /credman/i, pedaco: 'credman',
  cols: { numero: COL_CRED_OV, ativo: COL_CRED_ATIVO }, obrig: ['numero', 'ativo'],
  erroCol: (p) => p === 'numero' ? 'sem a coluna da OV (' + COL_CRED_OV.join('/') + ')' : 'sem a coluna ' + COL_CRED_ATIVO.join('/')
};
const CFG_TRABALHO = {
  chave: 'trabalho', candidatas: ENT_TRABALHO, reNome: /worktable|warehousework/i, pedaco: 'worktable',
  cols: COL_TRAB, obrig: ['numero', 'status'],
  erroCol: (p) => 'sem a coluna ' + COL_TRAB[p].join('/')
};
const CFG_CARGA = {
  chave: 'carga', candidatas: ENT_CARGA, reNome: /loadtablebi|outboundloadheader/i, pedaco: 'loadtablebi / outboundloadheader',
  cols: COL_CARGA, obrig: ['numero'], prefer: ['cotacao', 'pallet', 'status'],
  // na 2ª rodada (outras entidades com "load" no nome), só troca de entidade se a
  // nova tiver a COTAÇÃO ou o PALLET que falta na original
  preferChave: ['cotacao', 'pallet'],
  // os campos _CUSTOM: se o nome exato não bater, o pedaço do nome
  // (09/11/26: apertado — "pallet" sozinho pegaria PalletQuantity e afins, e o
  // campo do pallet é GRAVADO pelo botão; "quotation" sozinho pegaria QuotationId)
  reCols: { cotacao: /quotation.?performed|cota[cç][aã]o.?realizad|cotacaorealizad/i, pallet: /enviar.?pallet/i },
  // (10/11/26: SEM a 2ª rodada em outras entidades com "load" no nome — a carga é
  // só a WHSOutboundLoadHeaderEntity, pedido do dono)
  erroCol: (p) => 'sem a coluna ' + COL_CARGA[p].join('/')
};
// ── FRETE DA OV (12/11/2026) ──────────────────────────────────────
// Dono: "preciso da informação de frete também: FreghtType_InoveProjects, que
// provavelmente está nessa entidade, BioWHSWorkLineV1". O tipo de frete vem das
// LINHAS DO TRABALHO de depósito da OV — lido só quando a ficha abre (junto das
// linhas da OV, em linhasDaOv), pelo nº da OV (OrderNum) ou, se a entidade não
// tiver o nº, pelos WorkId dos trabalhos da OV. Nome público e colunas
// descobertos como as outras extras (candidatas + "whsworkline" no service
// document; env KANBAN_ENT_FRETE e KANBAN_COL_FRETE).
const ENT_FRETE = envLista('KANBAN_ENT_FRETE', []).concat([
  'BioWHSWorkLineV1', 'BioWHSWorkLinesV1', 'BioWHSWorkLineV1Entity', 'BioWHSWorkLineV1Entities', 'BIOWHSWorkLineV1', 'BIOWHSWorkLinesV1'
]).filter((v, i, a) => a.indexOf(v) === i);
const COL_FRETE = {
  numero:   ['OrderNum', 'OrderNumber', 'SalesId', 'SalesOrderNumber'],
  trabalho: ['WorkId'],
  frete:    envLista('KANBAN_COL_FRETE', ['FreghtType_InoveProjects', 'FreightType_InoveProjects'])
};
const CFG_FRETE = {
  chave: 'frete', candidatas: ENT_FRETE, reNome: /whsworkline/i, pedaco: 'whsworkline',
  cols: COL_FRETE, obrig: ['frete'], reCols: { frete: /fre(i)?ght.?type/i },
  erroCol: () => 'sem a coluna ' + COL_FRETE.frete.join('/')
};
const CFG_NOTA = {
  chave: 'nota', candidatas: ENT_NOTA, reNome: /salesinvoiceheader/i, pedaco: 'salesinvoiceheader',
  cols: COL_NOTA, obrig: ['numero', 'nota'],
  erroCol: (p) => 'sem a coluna ' + COL_NOTA[p].join('/')
};
const _extras = {};
async function sondarExtra(cfg, ent, token, ate) {
  let rows = null, erro = null;
  for (const filtro of ["dataAreaId eq '" + D.odataStr(EMPRESA) + "'", null]) {
    try {
      rows = await D.odataGetComPrazo(ent, Object.assign({ top: 1, crossCompany: true }, filtro ? { filter: filtro } : {}), token, prazo(ate, PROVA_MS));
      if (rows.length) break;
    } catch (e) { erro = String(e.message || e); if (/\b404\b/.test(erro) || e.demorou) break; }
  }
  if (!rows || !rows.length) return { entidade: ent, serve: false, erro: erro ? erro.slice(0, 200) : 'sem linhas' };
  const cols = colunasDe(rows[0]);
  const achado = {};
  Object.keys(cfg.cols).forEach(papel => {
    achado[papel] = achaCol(cols, cfg.cols[papel]) || (cfg.reCols && cfg.reCols[papel] ? cols.find(c => cfg.reCols[papel].test(c)) || null : null);
  });
  const falta = cfg.obrig.filter(papel => !achado[papel]);
  return Object.assign({ entidade: ent, serve: !falta.length, temEmpresa: cols.some(c => c.toLowerCase() === 'dataareaid'), colunas: cols,
    erro: falta.length ? cfg.erroCol(falta[0]) : null }, achado);
}
async function entidadeExtra(cfg, token, ate, diag) {
  const c = _extras[cfg.chave];
  if (c && Date.now() - c.ts < (c.E ? ENT_TTL : 5 * 60000)) {
    diag.push({ etapa: cfg.chave + ':entidade', cache: true, entidade: c.E ? c.E.entidade : null });
    return c;
  }
  const servico = await doServico(token, ate);
  const existe = {}; servico.forEach(n => { existe[n.toLowerCase()] = n; });
  let alvos = cfg.candidatas.map(n => existe[n.toLowerCase()] || n);
  if (servico.length) {
    alvos = alvos.filter(n => existe[n.toLowerCase()]);
    servico.filter(n => cfg.reNome.test(n) && alvos.indexOf(n) < 0).slice(0, 6).forEach(n => alvos.push(n));
  }
  diag.push({ etapa: cfg.chave + ':candidatas', servico: servico.length > 0, alvos });
  const sondar = (lista) => Promise.all(lista.map(ent => sondarExtra(cfg, ent, token, ate).catch(e => ({ entidade: ent, serve: false, erro: String(e.message || e).slice(0, 200) }))));
  let sondas = await sondar(alvos);
  const pontos = (x) => (cfg.prefer || []).filter(papel => x[papel]).length;
  const melhor = () => sondas.filter(x => x.serve).sort((a, b) => pontos(b) - pontos(a))[0] || false;
  // 09/11/26: a melhor não tem todas as preferidas (ex.: OutboundLoadHeaders sem o
  // QuotationPerformed_InoveProjects) -> testa as outras com "load" no nome
  let escolhida = melhor();
  if (cfg.prefer && cfg.reNomeExtra && servico.length && (!escolhida || pontos(escolhida) < cfg.prefer.length)) {
    const ja = {}; alvos.forEach(n => { ja[n.toLowerCase()] = 1; });
    const extras = servico.filter(n => cfg.reNomeExtra.test(n) && !ja[n.toLowerCase()] && !(cfg.reNomeExtraNao && cfg.reNomeExtraNao.test(n))).slice(0, 10);
    if (extras.length) {
      diag.push({ etapa: cfg.chave + ':candidatas-extra', alvos: extras });
      const novas = await sondar(extras);
      sondas = sondas.concat(novas);
      alvos = alvos.concat(extras);
      // 10/11/26: a extra só ganha se trouxer um campo-chave que FALTA na escolhida
      // (antes ganhava por qualquer coluna — uma entidade de "load" sem as cargas da OV)
      const chave = cfg.preferChave || cfg.prefer;
      const resolve = novas.filter(x => x.serve && chave.some(papel => x[papel] && !(escolhida && escolhida[papel])))
        .sort((a, b) => pontos(b) - pontos(a))[0];
      if (resolve || !escolhida) escolhida = resolve || melhor();
    }
  }
  sondas.forEach(x => {
    const d = { etapa: cfg.chave + ':entidade', entidade: x.entidade, serve: x.serve, empresa: !!x.temEmpresa, erro: x.erro || null };
    cfg.obrig.concat(cfg.prefer || []).forEach(papel => { d[papel] = x[papel] || null; });
    diag.push(d);
  });
  // entre as que servem, a que tem MAIS das colunas preferidas (cfg.prefer) —
  // 09/11/26: o D365 pode publicar mais de uma entidade de cargas; a que tem os
  // campos _CUSTOM (COTACAOREALIZADA_CUSTOM, ENVIARPALLET_CUSTOM) é a que vale
  const E = escolhida || false;
  const motivo = E ? '' : !alvos.length
    ? 'nenhuma entidade com "' + cfg.pedaco + '" no nome está publicada no OData'
    : sondas.map(x => x.entidade + ': ' + (x.erro || 'não serve')).join('; ').slice(0, 300);
  // todas as que servem, a escolhida primeiro (as cargas: a que não trouxer
  // uma carga, a próxima procura — 10/11/26)
  const todas = E ? [E].concat(sondas.filter(x => x.serve && x !== E).sort((a, b) => pontos(b) - pontos(a))) : [];
  _extras[cfg.chave] = { E, todas, ts: Date.now(), motivo };
  return _extras[cfg.chave];
}
// crédito, por OV: quantos registros, se algum está ATIVO e o registro que
// decide (o ativo; sem ativo, o primeiro)
async function creditoDasOvs(numeros, token, ate, diag) {
  const x = await entidadeExtra(CFG_CREDITO, token, ate, diag), E = x.E;
  if (!E) return { E: null, por: {}, erro: x.motivo };
  const rows = await porNumeros(E.entidade, E.numero, numeros, token, ate, diag, 'ov:credito', null, !E.temEmpresa);
  const por = {};
  rows.forEach(r => {
    const k = chaveOv(r[E.numero]); if (!k) return;
    const o = por[k] || (por[k] = { n: 0, ativo: false, row: null });
    o.n++;
    if (marcadoV(r[E.ativo]) && !o.ativo) { o.ativo = true; o.row = r; }
    else if (!o.row) o.row = r;
  });
  return { E, por };
}

// trabalho de depósito, por OV: os trabalhos (sem os cancelados/combinados),
// quantos em cada fase e a fase da OV
const dataHora = (v) => { const t = txt(v); return /^\d{4}-\d{2}-\d{2}/.test(t) && !/^1900-01-01/.test(t) ? t : null; };
async function trabalhosDasOvs(numeros, token, ate, diag) {
  const x = await entidadeExtra(CFG_TRABALHO, token, ate, diag), E = x.E;
  if (!E) return { E: null, por: {}, erro: x.motivo };
  const rows = await porNumeros(E.entidade, E.numero, numeros, token, ate, diag, 'ov:trabalho', null, !E.temEmpresa);
  const por = {};
  const v = (r, papel) => { const col = E[papel] || achaCol(colunasDe(r), COL_TRAB[papel]); return col ? r[col] : null; };
  rows.forEach(r => {
    const k = chaveOv(r[E.numero]); if (!k) return;
    const o = por[k] || (por[k] = { fechados: 0, processo: 0, abertos: 0, outros: 0, ignorados: 0, lista: [], row: null });
    const st = txt(r[E.status]), fase = faseTrab(st);
    if (fase === 'ignora') o.ignorados++;
    else if (fase === 'fechado') o.fechados++;
    else if (fase === 'processo') o.processo++;
    else if (fase === 'aberto') o.abertos++;
    else o.outros++;
    o.lista.push({
      id: txt(v(r, 'id')), status: st, fase, tipo: txt(v(r, 'tipo')), usuario: txt(v(r, 'usuario')),
      criado: dataHora(v(r, 'criado')), inicio: dataHora(v(r, 'inicio')), fim: dataHora(v(r, 'fim')),
      onda: txt(v(r, 'onda')), carga: txt(v(r, 'carga')), remessa: txt(v(r, 'remessa')), deposito: txt(v(r, 'deposito'))
    });
    // o registro que vai para os campos crus: o em processo; senão o 1º válido
    if (fase === 'processo' || (!o.row && fase !== 'ignora')) o.row = r;
  });
  Object.keys(por).forEach(k => {
    const o = por[k], validos = o.fechados + o.processo + o.abertos + o.outros;
    o.total = validos;
    o.fase = !validos ? null : o.fechados === validos ? 'fechado' : (o.processo || o.outros || o.fechados) ? 'processo' : 'aberto';
    o.lista.sort((a, b) => String(a.criado || a.id).localeCompare(String(b.criado || b.id)));
  });
  return { E, por };
}

// notas fiscais por OV (diário de faturas): OV -> [{ numero, data, valor }]
async function notasDasOvs(numeros, token, ate, diag) {
  const x = await entidadeExtra(CFG_NOTA, token, ate, diag), E = x.E;
  if (!E) return { E: null, por: {}, erro: x.motivo };
  const rows = await porNumeros(E.entidade, E.numero, numeros, token, ate, diag, 'ov:nota', null, !E.temEmpresa);
  const por = {};
  const v = (r, papel) => { const col = E[papel] || achaCol(colunasDe(r), COL_NOTA[papel]); return col ? r[col] : null; };
  rows.forEach(r => {
    const k = chaveOv(r[E.numero]), nf = txt(r[E.nota]); if (!k || !nf) return;
    const l = por[k] || (por[k] = []);
    if (l.some(n => n.numero === nf)) return;
    l.push({ numero: nf, data: (dataHora(v(r, 'data')) || '').slice(0, 10) || null, valor: num(v(r, 'valor')) });
  });
  // a mais recente primeiro (data; empate: o número)
  Object.keys(por).forEach(k => por[k].sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')) || String(b.numero).localeCompare(String(a.numero))));
  return { E, por };
}

// cargas pelos LoadId (os dos trabalhos das OVs): LoadId -> { carga, row, E }
// 10/11/26 (dono: "as cargas sumiram"): com a WHSLoadTableBiEntity na frente as
// cargas não vinham — a carga que uma entidade não trouxer (ou se ela falhar) é
// procurada na próxima que serve (a WHSOutboundLoadHeaderEntity). Cada carga
// guarda a entidade de onde veio; os campos de cotação/pallet são opcionais.
async function cargasPorId(ids, token, ate, diag) {
  const x = await entidadeExtra(CFG_CARGA, token, ate, diag), E = x.E;
  if (!E) return { E: null, por: {}, erro: x.motivo };
  const lista = x.todas && x.todas.length ? x.todas : [E];
  const por = {}, usadas = [];
  let falta = ids.slice(), erro = null;
  for (const Ei of lista) {
    if (!falta.length) break;
    if (usadas.length && restante(ate) < FOLGA_MS + 3000) break;
    let rows;
    try { rows = await porNumeros(Ei.entidade, Ei.numero, falta, token, ate, diag, 'ov:carga', null, !Ei.temEmpresa); }
    catch (e) { erro = Ei.entidade + ': ' + String(e.message || e).slice(0, 160); usadas.push({ entidade: Ei.entidade, cargas: 0, erro }); continue; }
    let n = 0;
    rows.forEach(r => { if (addCarga(por, Ei, r)) n++; });
    usadas.push({ entidade: Ei.entidade, cargas: n });
    diag.push({ etapa: 'ov:carga:fonte', entidade: Ei.entidade, procuradas: falta.length, achadas: n });
    falta = falta.filter(id => !por[id.toUpperCase()]);
  }
  // nenhuma entidade respondeu: é falha de leitura (vira aviso), não "sem carga"
  if (!usadas.some(u => !u.erro)) { const e = new Error(erro || 'a leitura das cargas falhou'); throw e; }
  // a "principal" = a que trouxe mais cargas (as colunas da ficha e dos avisos)
  const principal = usadas.filter(u => u.cargas).sort((a, b) => b.cargas - a.cargas)[0];
  const Ep = principal ? lista.find(L => L.entidade === principal.entidade) : E;
  return { E: Ep, por, usadas, lista, erro };
}
function addCarga(por, E, r) {
  const v = (papel) => { const col = E[papel] || achaCol(colunasDe(r), COL_CARGA[papel]); return col ? r[col] : null; };
  const id = txt(r[E.numero]); if (!id || por[id.toUpperCase()]) return false;
  const cot = v('cotacao'), pal = v('pallet');
  const carga = {
    id, status: txt(v('status')), transportadora: txt(v('transportadora')), servico: txt(v('servico')),
    envio: dataHora(v('envio')), expedido: dataHora(v('expedido')), envioConfirmado: dataHora(v('envioConfirmado')), deposito: txt(v('deposito')), modelo: txt(v('modelo')),
    cotacao: cot == null ? null : txt(cot), cotacaoSim: marcadoV(cot), pallet: pal == null ? null : txt(pal), palletSim: marcadoV(pal),
    fonte: E.entidade
  };
  carga.fase = faseCarga(carga);
  // o botão "Enviar para o Pallet": carga Carregado E cotação realizada = Sim (e ainda não enviada)
  carga.podePallet = carga.fase === 'cotado' && !!E.pallet;
  // e o porquê de NÃO poder (a ficha mostra o botão desativado com o motivo)
  carga.motivoPallet = carga.podePallet ? '' : !E.pallet ? 'não achei o campo ' + COL_CARGA.pallet[0] + ' na carga'
    : carga.palletSim ? 'a carga já foi enviada para o Pallet'
    : carga.fase === 'remetido' ? 'a carga já foi remetida'
    : !/^(loaded|carregad)/.test(normV(carga.status).replace(/ /g, '')) ? 'a carga está "' + (carga.status || 'sem status') + '" — precisa estar Carregado'
    : !E.cotacao ? 'não achei o campo ' + COL_CARGA.cotacao[0] + ' na carga'
    : 'a cotação realizada está "' + simNaoV(carga.cotacao) + '" — precisa estar Sim';
  por[id.toUpperCase()] = { row: r, carga, E };
  return true;
}

// a OV em PARTES pelo lote: as linhas EM ABERTO sem lote -> parte em Pendência;
// as outras -> a parte que segue a etapa da OV. Cada parte = um cartão, com o
// valor e os itens só dela (chave própria: OV~semlote / OV~comlote). Sem lote em
// todas -> a OV inteira em Pendência. Não divide depois do faturamento.
// 10/11/26 (dono): "se não tiver linha vai para Criada" — a OV cujas linhas
// foram lidas e não tem nenhuma fica em Criada (antes do faturamento).
const NAO_DIVIDE = ['faturado', 'rejeitada', 'pallet', 'expedicao', 'cancelada'];
const linhaAberta = (st) => { const n = normV(st).replace(/ /g, ''); return !n || /^(backorder|emaberto|ordememaberto|open|none|nenhum)$/.test(n); };
const linhaCancelada = (st) => /^cancel/.test(normV(st));
// 11/11/2026 (dono): "Cotação = carga Carregado E status da linha = Ordem em
// aberto; Aguardando Faturamento = carga Carregado E status da linha = Entregue;
// Faturado = status da linha Faturado". O status é da LINHA: cada linha ganha a
// sua etapa (etapaDe com o status dela) e as linhas com a mesma etapa ficam no
// mesmo cartão (chave OV~<etapa>; a parte sem lote: OV~semlote). Uma etapa só:
// a OV inteira, um cartão. As linhas canceladas não contam.
const statusLinha = (st) => {
  const n = normV(st).replace(/ /g, '');
  if (/^cancel/.test(n)) return 'cancelada';
  if (/^(invoiced|faturad)/.test(n)) return 'faturada';
  if (/^(delivered|entregue)$/.test(n)) return 'entregue';
  return 'aberta';
};
const POS_NOTA = ['faturado', 'rejeitada', 'pallet', 'expedicao', 'cancelada'];
// 11/11/26 (dono): "volte para a Pendência tudo que não tiver LOTE na linha" — a
// regra do lote LIGADA de novo; KANBAN_PENDENCIA_LOTE=0 desliga
const pendenciaPorLote = () => String(process.env.KANBAN_PENDENCIA_LOTE || '').trim() !== '0';
function partesPorLinhas(o, ls, lida, comLote, comStatus) {
  o.chave = o.numero; o.valorOv = o.valor; o.itensOv = o.itens; o._abertas = true;
  if (!ls || !ls.length) {
    if (lida && NAO_DIVIDE.indexOf(o.etapa) < 0) { o.etapaOv = o.etapa; o.etapa = 'criada'; o.semLinhas = true; }
    return [o];
  }
  const c = o._ctx;
  const st = (l) => comStatus ? statusLinha(l.status) : null;
  const vivas = ls.filter(l => st(l) !== 'cancelada');
  if (!vivas.length) return [o];
  const abertas = vivas.filter(l => st(l) === 'aberta' || st(l) == null);
  if (comLote) o.lotes = { linhas: abertas.length, semLote: abertas.filter(l => !l.lote).length };
  const etapaDaLinha = (s2) => c ? etapaDe(c.sa, c.re, c.cr, c.trab, c.nota, c.carga, s2) : o.etapa;
  const grupos = new Map();
  vivas.forEach(l => {
    const s2 = st(l);
    let e = etapaDaLinha(s2), semlote = false, destino = null;
    // a linha em aberto sem lote vai para Pendência (antes do faturamento)
    if (comLote && pendenciaPorLote() && (s2 === 'aberta' || s2 == null) && !l.lote && POS_NOTA.indexOf(e) < 0) { destino = e; e = 'pendencia'; semlote = true; }
    if (!grupos.has(e)) grupos.set(e, { etapa: e, ls: [], status: [], semlote, destino });
    const g = grupos.get(e); g.ls.push(l); if (s2 && g.status.indexOf(s2) < 0) g.status.push(s2);
  });
  const gs = Array.from(grupos.values());
  const soma = (arr) => Math.round(arr.reduce((t, l) => t + (l.valor || 0), 0) * 100) / 100;
  const ident = (l) => l.linha != null ? l.linha : l.item;
  const total = vivas.length;
  const parteDe = (g) => ({ id: g.semlote ? 'semlote' : 'linhas', status: g.status, linhas: g.ls.map(ident), n: g.ls.length, de: total });
  const temAberta = (g) => g.ls.some(l => st(l) === 'aberta' || st(l) == null) && !g.semlote;
  // as linhas por status (a ficha mostra quantas em aberto / entregues / faturadas)
  const contar = (arr) => { const x = {}; arr.forEach(l => { const k = st(l) || '?'; x[k] = (x[k] || 0) + 1; }); return x; };
  if (gs.length === 1) {
    const g = gs[0];
    if (g.etapa !== o.etapa) o.etapaOv = o.etapa;
    o.etapa = g.etapa; o.linhasSt = contar(g.ls); o._abertas = temAberta(g) || !comStatus;
    if (g.semlote) { o.parte = Object.assign(parteDe(g), { inteira: true }); o.podePallet = false; o.etapaOv = g.destino; }
    return [o];
  }
  return gs.map(g => Object.assign({}, o, {
    chave: o.numero + '~' + (g.semlote ? 'semlote' : g.etapa), etapa: g.etapa, valor: soma(g.ls), itens: g.ls.length,
    podePallet: g.semlote ? false : o.podePallet, parte: parteDe(g), linhasSt: contar(g.ls), _abertas: temAberta(g)
  }, g.semlote ? { etapaOv: g.destino } : {}));
}

// ── A OV EM PARTES PELOS TRABALHOS (10/11/2026) ───────────────────
// Dono: "a Separação só pode abranger o trabalho = Abrir; se tiver dois
// trabalhos, 1 Abrir e 1 Fechado, tem que fazer um split no card: inserir essa
// OV na Separação e também em outro lugar com base no outro trabalho ou na
// carga". Os trabalhos válidos (sem cancelado/combinado) em 2 grupos: os
// ABERTOS -> um cartão em Separação; os outros (em processo / fechado) -> um
// cartão na etapa que as cargas DELES (e a nota) decidem. Cada cartão leva só
// os seus trabalhos e cargas; o valor da parte não se sabe pelo trabalho (vai
// vazio; a ficha mostra o da OV). Chaves: <chave>~abrir / <chave>~outros.
function faseTrabDe(ws) {
  if (!ws.length) return 'nenhum';
  if (ws.every(w => w.fase === 'fechado')) return 'fechado';
  if (ws.every(w => w.fase === 'aberto')) return 'aberto';
  return 'processo';
}
function resumoTrab(ws, base) {
  if (!base) return base;
  return Object.assign({}, base, { fase: ws.length ? faseTrabDe(ws) : null, total: ws.length, fechados: ws.filter(w => w.fase === 'fechado').length,
    processo: ws.filter(w => w.fase === 'processo').length, abertos: ws.filter(w => w.fase === 'aberto').length, ignorados: 0 });
}
function partesPorTrabalho(p, cargasDe, faseCargasDe) {
  const t = p._trab;
  if (!t || !t.misto || p.etapa === 'cancelada') return [p];
  const de = t.abertos.length + t.outros.length;
  const mk = (ws, id, etapa) => {
    const cs = cargasDe(ws);
    return Object.assign({}, p, { chave: p.chave + '~' + id, etapa, valor: null, itens: null,
      trabalhos: ws, cargas: cs, cargaFase: faseCargasDe(cs), podePallet: cs.some(c => c.podePallet),
      regra: Object.assign({}, p.regra, { trabalho: resumoTrab(ws, p.regra.trabalho) }),
      parteTrab: { id, trabalhos: ws.map(w => w.id), n: ws.length, de } });
  };
  const sep = mk(t.abertos, 'abrir', 'liberado'), resto = mk(t.outros, 'outros', p.etapa);
  sep.podePallet = false;
  sep.parteTrab.outra = { chave: resto.chave, etapa: resto.etapa, n: resto.parteTrab.n };
  resto.parteTrab.outra = { chave: sep.chave, etapa: 'liberado', n: sep.parteTrab.n };
  return [sep, resto];
}

// ── leituras ─────────────────────────────────────────────────────
async function ovsDoDia(E, dia, token, ate, diag) {
  const c = E.criadaEm;
  const dh = ehDataHora(c);
  const ini = dh ? dia + 'T0' + FUSO_H + ':00:00Z' : dia + 'T00:00:00Z';
  const fim = dh ? maisDias(dia, 1) + 'T0' + FUSO_H + ':00:00Z' : maisDias(dia, 1) + 'T00:00:00Z';
  const formas = [{ f: c + ' ge ' + ini + ' and ' + c + ' lt ' + fim, rot: 'data-hora' }];
  if (!dh) formas.push({ f: c + ' ge ' + dia + ' and ' + c + ' lt ' + maisDias(dia, 1), rot: 'data' });
  let ultimo = null;
  for (const fo of formas) {
    try {
      const rows = await D.odataGetComPrazo(E.entidade, { crossCompany: true, filter: (E.temEmpresa ? "dataAreaId eq '" + D.odataStr(EMPRESA) + "' and " : '') + fo.f }, token, prazo(ate, PRAZO_MS));
      diag.push({ etapa: 'ov:dia', entidade: E.entidade, coluna: c, forma: fo.rot, linhas: rows.length });
      return rows.filter(r => diaDe(r[c], c) === dia);
    } catch (e) {
      ultimo = e;
      diag.push({ etapa: 'ov:dia', entidade: E.entidade, coluna: c, forma: fo.rot, erro: String(e.message || e).slice(0, 220) });
      if (!/\b400\b/.test(String(e.message))) break;
    }
  }
  throw ultimo || new Error('sem tempo para ler as OVs do dia');
}

// ── O QUADRO SEM O "DO DIA" (09/11/2026) ──────────────────────────
// Dono: "somente aplique o filtro de data para os cards Faturado, Rejeitado,
// Pallet e Expedição, um filtro de quando até quando ele quer ver; os
// restantes dos cards têm que pegar toda a vida da empresa". Então o quadro lê:
//   • as OVs EM ABERTO (SalesStatus = Ordem em aberto), de QUALQUER data —
//     Criada, Crédito, Separação, Conferência e Cotação;
//   • as OVs com NOTA no período (diário de faturas pela InvoiceDate) —
//     Faturado e Rejeitada (e, quando tiverem regra, Pallet e Expedição).
// Depois da etapa calculada, as colunas DATADAS só ficam com a OV cuja data
// (a da nota mais recente; sem nota, a de criação) cai no período.
// 10/11/2026 (dono: "o HOJE não precisa ter no card Faturado, pode deixar
// histórico que nem os demais"): Faturado SAIU das datadas — mostra toda OV que
// está em Faturado agora, de qualquer data (ovsDeCargasCarregadas, abaixo).
// 11/11/2026 (dono, depois de pedir o Pallet "só as que mudaram hoje": "NÃO
// PRECISA DE DATA DO PALLET, pode trazer TUDO"): o Pallet também SAIU das
// datadas — mostra toda OV que está no Pallet agora (carga ainda Carregado com
// ENVIARPALLET_CUSTOM = Sim), de qualquer data; sai quando a carga é Remetida.
// 12/11/2026 (dono): a EXPEDIÇÃO também saiu do período — mostra as OVs cuja
// carga teve o envio confirmado HOJE (LoadShipConfirmUTCDateTime), de qualquer
// data (expedidaEmDe, abaixo). O período fica só para a Rejeitada.
// 12/11/2026, depois (dono: "remove o período, não preciso disso, tem que mostrar
// TUDO"): SEM período — nenhuma coluna filtra por data (a Rejeitada também mostra
// tudo); só a Expedição é "hoje", pela confirmação do envio.
const DATADAS = [];
// quando a carga da OV foi expedida: a confirmação de envio MAIS RECENTE das
// cargas remetidas dela (a OV só vai para a Expedição com todas lá); null = sem
function expedidaEmDe(cargas) {
  const ds = (cargas || []).filter(c => c.fase === 'remetido' && c.envioConfirmado).map(c => c.envioConfirmado);
  return ds.length ? ds.reduce((m, x) => x > m ? x : m) : null;
}
// o dia em Brasília (UTC-3) de uma data-hora UTC
function diaSP(iso) { const t = Date.parse(iso); return isNaN(t) ? null : new Date(t - FUSO_H * 3600000).toISOString().slice(0, 10); }
const JANELA_DIAS = Number(process.env.KANBAN_JANELA_DIAS || 365);  // reserva, se o filtro pelo status não passar
const MAX_COMPL_QUADRO = Number(process.env.KANBAN_MAX_COMPL || 3); // complementos no quadro (V3, V2, SalesOrderHeaders)
async function ovsAbertas(E, token, ate, diag, avisos) {
  const cSt = achaCol(E.colunas || [], COL_SALES);
  const cDep = achaCol(E.colunas || [], COLS.deposito);
  const emp = E.temEmpresa ? "dataAreaId eq '" + D.odataStr(EMPRESA) + "' and " : '';
  // o depósito já no filtro, quando a principal tem a coluna (menos linhas do F&O)
  const dep = !TODOS_DEPOSITOS && cDep ? '(' + DEPOSITOS.map(d => cDep + " eq '" + D.odataStr(d) + "'").join(' or ') + ') and ' : '';
  const formas = cSt ? [
    // 11/11/26: + as Entregues (romaneio sem nota) -> Aguardando Faturamento
    { f: '(' + cSt + " eq Microsoft.Dynamics.DataEntities.SalesStatus'Backorder' or " + cSt + " eq Microsoft.Dynamics.DataEntities.SalesStatus'Delivered')", rot: 'enum' },
    { f: '(' + cSt + " eq 'Backorder' or " + cSt + " eq 'Delivered')", rot: 'texto' }
  ] : [];
  for (const fo of formas) {
    if (restante(ate) < FOLGA_MS + 2000) break;
    try {
      const rows = await D.odataGetComPrazo(E.entidade, { crossCompany: true, filter: emp + dep + fo.f }, token, prazo(ate, PRAZO_MS));
      diag.push({ etapa: 'ov:abertas', entidade: E.entidade, coluna: cSt, forma: fo.rot, deposito: !!dep, linhas: rows.length });
      return rows.filter(r => situacaoOv(r[cSt]) === 'aberta' || situacaoOv(r[cSt]) === 'entregue');
    } catch (e) {
      diag.push({ etapa: 'ov:abertas', entidade: E.entidade, coluna: cSt, forma: fo.rot, erro: String(e.message || e).slice(0, 220) });
      if (!/\b400\b/.test(String(e.message))) break;
    }
  }
  // reserva: as criadas nos últimos JANELA_DIAS dias, e o "em aberto" na memória
  avisos.push('Não deu para filtrar as OVs em aberto pelo status' + (cSt ? '' : ' (a ' + E.entidade + ' não tem ' + COL_SALES.join('/') + ')') +
    ': o quadro mostra as em aberto criadas nos últimos ' + JANELA_DIAS + ' dias.');
  const c = E.criadaEm, hoje = hojeSP(), ini = maisDias(hoje, -JANELA_DIAS);
  const rows = await D.odataGetComPrazo(E.entidade, { crossCompany: true, filter: emp + dep + c + ' ge ' + ini + 'T00:00:00Z' }, token, prazo(ate, PRAZO_MS));
  diag.push({ etapa: 'ov:abertas', entidade: E.entidade, forma: 'janela ' + JANELA_DIAS + ' dias', linhas: rows.length });
  return rows.filter(r => !cSt || situacaoOv(r[cSt]) === 'aberta' || situacaoOv(r[cSt]) === 'entregue');
}
// OVs com nota no período [de, ateDia]: pelo diário de faturas (InvoiceDate)
async function ovsComNotaNoPeriodo(de, ateDia, token, ate, diag) {
  const x = await entidadeExtra(CFG_NOTA, token, ate, diag), E = x.E;
  if (!E) return { numeros: [], erro: x.motivo };
  const c = E.data;
  if (!c) return { numeros: [], erro: 'a ' + E.entidade + ' não tem ' + COL_NOTA.data.join('/') };
  const emp = E.temEmpresa ? "dataAreaId eq '" + D.odataStr(EMPRESA) + "' and " : '';
  const prox = maisDias(ateDia, 1);
  const formas = [{ f: c + ' ge ' + de + 'T00:00:00Z and ' + c + ' lt ' + prox + 'T00:00:00Z', rot: 'data-hora' }, { f: c + ' ge ' + de + ' and ' + c + ' lt ' + prox, rot: 'data' }];
  let ultimo = null;
  for (const fo of formas) {
    try {
      const rows = await D.odataGetComPrazo(E.entidade, { crossCompany: true, filter: emp + fo.f, select: [E.numero, E.nota, c].join(',') }, token, prazo(ate, PRAZO_MS));
      diag.push({ etapa: 'ov:periodo', entidade: E.entidade, forma: fo.rot, de, ate: ateDia, linhas: rows.length });
      const nums = rows.filter(r => { const d = (dataHora(r[c]) || '').slice(0, 10); return d >= de && d <= ateDia; }).map(r => chaveOv(r[E.numero])).filter(Boolean);
      return { numeros: Array.from(new Set(nums)) };
    } catch (e) {
      ultimo = e;
      diag.push({ etapa: 'ov:periodo', entidade: E.entidade, forma: fo.rot, erro: String(e.message || e).slice(0, 220) });
      if (!/\b400\b/.test(String(e.message))) break;
    }
  }
  return { numeros: [], erro: String((ultimo && ultimo.message) || ultimo || 'sem tempo').slice(0, 160) };
}

// ── FATURADO E PALLET SEM DATA (10/11 e 11/11/2026) ────────────────
// A OV totalmente faturada sai do "em aberto" (SalesStatus = Faturado), e ler o
// diário de faturas da vida toda não cabe no tempo. Mas a faturada fica com a
// carga CARREGADO até ser Remetida (regras do dono) — então: as cargas Carregado
// (em todas as entidades de cargas) -> os trabalhos dessas cargas -> as OVs.
// 11/11/26: COM as já no Pallet (antes ficavam de fora e a OV sumia do quadro).
// Junto com as em aberto e as com nota no período, as colunas Faturado e Pallet
// ficam com toda OV que está nelas agora, de qualquer data.
// 12/11/26: + as cargas com o envio CONFIRMADO HOJE (LoadShipConfirmUTCDateTime),
// para a Expedição trazer a OV de qualquer data (faturada há semanas, inclusive).
const MAX_CARGAS_FAT = Number(process.env.KANBAN_MAX_CARGAS_FAT || 400);
async function ovsDeCargasCarregadas(token, ate, diag) {
  const [xc, xt] = await Promise.all([entidadeExtra(CFG_CARGA, token, ate, diag), entidadeExtra(CFG_TRABALHO, token, ate, diag)]);
  if (!xc.E || !xt.E || !xt.E.carga) return { numeros: [], semFonte: true };
  // 12/11/26 (dono: "essa carga está confirmada hoje e não apareceu em Expedição"):
  // as cargas com o envio confirmado HOJE ficam à parte (idsHoje) e vão PRIMEIRO —
  // antes, entravam no fim da lista e o teto de MAX_CARGAS_FAT (ou o tempo) as cortava
  const ids = {}, idsHoje = {};
  for (const E of (xc.todas && xc.todas.length ? xc.todas : [xc.E]).filter(L => L.status)) {
    // 12/11/26: só as cargas do depósito do quadro (ALMOX-PA), quando a entidade tem
    // a coluna — sem isso vinham as de todos os depósitos (EMB-SEC…) e o teto cortava
    const emp = (E.temEmpresa ? "dataAreaId eq '" + D.odataStr(EMPRESA) + "' and " : '') +
      (E.deposito && !TODOS_DEPOSITOS ? '(' + DEPOSITOS.map(d => E.deposito + " eq '" + D.odataStr(d) + "'").join(' or ') + ') and ' : '');
    const sel = [E.numero, E.status].join(',');
    const formas = [{ f: E.status + " eq Microsoft.Dynamics.DataEntities.WHSLoadStatus'Loaded'", rot: 'enum' }, { f: E.status + " eq 'Loaded'", rot: 'texto' }];
    for (const fo of formas) {
      if (restante(ate) < FOLGA_MS + 2000) break;
      try {
        const rows = await D.odataGetComPrazo(E.entidade, { crossCompany: true, filter: emp + fo.f, select: sel }, token, prazo(ate, PRAZO_MS));
        let n = 0;
        rows.forEach(r => {
          const id = txt(r[E.numero]);
          if (!id || !/^(loaded|carregad)/.test(normV(r[E.status]).replace(/ /g, ''))) return;
          ids[id.toUpperCase()] = id; n++;
        });
        diag.push({ etapa: 'fat:cargas', entidade: E.entidade, forma: fo.rot, linhas: rows.length, carregadas: n });
        break;
      } catch (e) {
        diag.push({ etapa: 'fat:cargas', entidade: E.entidade, forma: fo.rot, erro: String(e.message || e).slice(0, 200) });
        if (!/\b400\b/.test(String(e.message))) break;
      }
    }
    if (E.envioConfirmado && restante(ate) > FOLGA_MS + 2000) {
      const hoje = hojeSP(), c = E.envioConfirmado;
      const f = c + ' ge ' + hoje + 'T0' + FUSO_H + ':00:00Z and ' + c + ' lt ' + maisDias(hoje, 1) + 'T0' + FUSO_H + ':00:00Z';
      try {
        const rows = await D.odataGetComPrazo(E.entidade, { crossCompany: true, filter: emp + f, select: [E.numero, c].join(',') }, token, prazo(ate, PRAZO_MS));
        let n = 0;
        rows.forEach(r => { const id = txt(r[E.numero]); if (id && diaSP(r[c]) === hoje) { idsHoje[id.toUpperCase()] = id; n++; } });
        diag.push({ etapa: 'exp:cargas', entidade: E.entidade, coluna: c, linhas: rows.length, hoje: n, cargas: rows.map(r => txt(r[E.numero])).slice(0, 40) });
      } catch (e) {
        diag.push({ etapa: 'exp:cargas', entidade: E.entidade, coluna: c, erro: String(e.message || e).slice(0, 200) });
      }
    }
  }
  const hojeL = Object.keys(idsHoje).map(k => idsHoje[k]);
  let carregadas = Object.keys(ids).filter(k => !idsHoje[k]).map(k => ids[k]);
  if (!hojeL.length && !carregadas.length) return { numeros: [], numerosHoje: [], cargas: 0 };
  const total = carregadas.length;
  // o teto vale só para as Carregado; as confirmadas hoje vão todas, na frente
  if (carregadas.length > MAX_CARGAS_FAT) carregadas = carregadas.slice(0, MAX_CARGAS_FAT);
  const lista = hojeL.concat(carregadas);
  const T = xt.E, sel = [T.numero, T.carga].concat(T.tipo ? [T.tipo] : []).join(',');
  const rows = await porNumeros(T.entidade, T.carga, lista, token, ate, diag, 'fat:trabalho', sel, !T.temEmpresa);
  // só trabalho de VENDA (a carga também leva transferência)
  const venda = rows.filter(r => !T.tipo || !txt(r[T.tipo]) || /^(sales|venda)/.test(normV(r[T.tipo])));
  const deHoje = venda.filter(r => idsHoje[txt(r[T.carga]).toUpperCase()]).map(r => chaveOv(r[T.numero])).filter(Boolean);
  const nums = venda.map(r => chaveOv(r[T.numero])).filter(Boolean);
  return { numeros: Array.from(new Set(nums)), numerosHoje: Array.from(new Set(deHoje)), cargas: total, cargasHoje: hojeL.length, corte: total > carregadas.length ? total : 0 };
}

// linhas de uma entidade pelos números das OVs (em lotes; 2 lotes por vez —
// o quadro de aberto tem centenas de OVs)
const PARALELO = 2;
async function porNumeros(ent, colNum, numeros, token, ate, diag, etapa, select, semEmpresa) {
  const lotes = [];
  for (let i = 0; i < numeros.length; i += LOTE_OV) lotes.push(numeros.slice(i, i + LOTE_OV));
  const res = new Array(lotes.length);
  let prox = 0, semTempo = 0, falha = null;
  async function trabalhador() {
    while (prox < lotes.length && !falha) {
      const i = prox++;
      if (restante(ate) < FOLGA_MS + 1000) { semTempo += lotes[i].length; continue; }
      const filtro = (semEmpresa ? '' : "dataAreaId eq '" + D.odataStr(EMPRESA) + "' and ") + '(' + lotes[i].map(n => colNum + " eq '" + D.odataStr(n) + "'").join(' or ') + ')';
      try {
        res[i] = await D.odataGetComPrazo(ent, Object.assign({ crossCompany: true, filter: filtro }, select ? { select } : {}), token, prazo(ate, 12000));
      } catch (e) { falha = e; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALELO, lotes.length) }, trabalhador));
  if (falha) { diag.push({ etapa, entidade: ent, erro: String(falha.message || falha).slice(0, 200) }); throw falha; }
  if (semTempo) diag.push({ etapa, entidade: ent, erro: 'sem tempo: ' + semTempo + ' OV(s) sem ' + etapa.split(':')[1] });
  const out = [].concat.apply([], res.filter(Boolean));
  diag.push({ etapa, entidade: ent, linhas: out.length });
  // os números que foram de fato consultados (lote sem tempo fica de fora):
  // "sem linha" só vale para a OV cujas linhas foram lidas
  out.cobertos = new Set();
  lotes.forEach((l, i) => { if (res[i]) l.forEach(n => out.cobertos.add(n)); });
  return out;
}

// ── O LOTE DAS LINHAS -> PENDÊNCIA (10/11/2026) ───────────────────
// Dono: "você vai trazer o lote dos itens aqui também, o InventBatch; caso algum
// dos itens não tenha lote, parte dessa OV tem que estar em Pendência enquanto a
// outra vai andando". O lote é a dimensão de lote da LINHA da OV (ItemBatchNumber
// na SalesOrderLines = o InventBatchId). As colunas da entidade de linhas saem de
// uma linha de amostra (o nome do lote varia); sem a coluna, a regra fica
// desligada, com aviso. Env: KANBAN_COL_LOTE.
const COL_LOTE = envLista('KANBAN_COL_LOTE', ['ItemBatchNumber', 'InventBatchId', 'BatchNumber', 'BatchId']);
let _colsLinhas = null;
async function colunasLinhas(ent, token, ate) {
  if (_colsLinhas && _colsLinhas.ent === ent) return _colsLinhas;
  const rows = await D.odataGetComPrazo(ent, { top: 1, crossCompany: true, filter: "dataAreaId eq '" + D.odataStr(EMPRESA) + "'" }, token, prazo(ate, PROVA_MS));
  const cols = rows.length ? colunasDe(rows[0]) : [];
  const C = { ent, lote: achaCol(cols, COL_LOTE), linha: achaCol(cols, COLS_LINHA.linha), item: achaCol(cols, COLS_LINHA.item),
    qtd: achaCol(cols, COLS_LINHA.qtd), status: achaCol(cols, COLS_LINHA.status), amostra: rows.length > 0 };
  // sem linha de amostra não dá para saber as colunas: não guarda (tenta de novo)
  if (C.amostra) _colsLinhas = C;
  return C;
}
// valor, nº de itens e as linhas (lote, status) da OV
let _entLinhas = null;
async function linhas(numeros, token, ate, diag) {
  const alvos = _entLinhas ? [_entLinhas] : ENT_LINHAS;
  for (const ent of alvos) {
    try {
      const C = await colunasLinhas(ent, token, ate);
      const sel = ['SalesOrderNumber', 'LineAmount', 'dataAreaId'].concat([C.lote, C.linha, C.item, C.qtd, C.status].filter(Boolean));
      const rows = await porNumeros(ent, 'SalesOrderNumber', numeros, token, ate, diag, 'ov:linhas', Array.from(new Set(sel)).join(','));
      _entLinhas = ent;
      const por = {};
      rows.forEach(r => {
        const k = chaveOv(r.SalesOrderNumber);
        const o = por[k] || (por[k] = { valor: 0, itens: 0, linhas: [] });
        o.itens++; o.valor += Number(r.LineAmount) || 0;
        const lt = C.lote ? txt(r[C.lote]) : '';
        o.linhas.push({ linha: C.linha ? num(r[C.linha]) : null, item: C.item ? txt(r[C.item]) : '', valor: Math.round((Number(r.LineAmount) || 0) * 100) / 100,
          qtd: C.qtd ? num(r[C.qtd]) : null, lote: VAZIOS.test(lt) ? '' : lt, status: C.status ? txt(r[C.status]) : '' });
      });
      Object.keys(por).forEach(k => { por[k].valor = Math.round(por[k].valor * 100) / 100; });
      // as OVs cujas linhas foram lidas (com ou sem linha)
      Object.defineProperty(por, '_lidas', { value: rows.cobertos || new Set(), enumerable: false });
      return por;
    } catch (e) {
      if (!/\b(400|404)\b/.test(String(e.message))) return {};
    }
  }
  return {};
}

// campos crus de uma linha, sem os vazios (o painel da OV mostra tudo)
function crus(row) {
  const o = {};
  colunasDe(row).forEach(k => {
    const v = row[k];
    if (v == null || typeof v === 'object') return;
    const s = txt(v);
    if (VAZIOS.test(s)) return;
    o[k] = typeof v === 'number' || typeof v === 'boolean' ? v : s.slice(0, 300);
  });
  return o;
}

// ── o motor ──────────────────────────────────────────────────────
const _cache = new Map();
// modo "do dia" (o original: as OVs CRIADAS no dia) — ?modo=dia e os testes
async function ordensDoDia(opts) {
  opts = opts || {};
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.data || '')) ? String(opts.data) : hojeSP();
  return montar(opts, { chave: 'dia|' + dia, dia });
}
// o QUADRO (09/11/2026): em aberto de qualquer data + as com nota no período
// 12/11/26 (dono: "remove o período, não preciso disso, tem que mostrar tudo"):
// o quadro não tem mais período — de/ate são ignorados. As notas lidas pelo
// diário de faturas são as de HOJE (o Faturado/Rejeitada do dia sem carga); o resto
// vem das OVs em aberto e das cargas, de qualquer data.
async function quadro(opts) {
  opts = opts || {};
  const hoje = hojeSP();
  return montar(opts, { chave: 'quadro|' + hoje, quadro: true, de: hoje, ateDia: hoje, dia: hoje });
}
async function montar(opts, modo) {
  const dia = modo.dia;
  const c = _cache.get(modo.chave);
  if (!opts.atualizar && !opts.diag && c && Date.now() - c.ts < (modo.quadro ? TTL_QUADRO : TTL_MS)) return Object.assign({}, c.r, { cache: true });

  const ate = Date.now() + ORCAMENTO;
  const diag = [], avisos = [];
  const token = await D.getToken();
  const ents = await entidades(token, ate, diag, !!opts.diag);
  const base = { ok: true, configured: true, empresa: EMPRESA, data: dia, hoje: hojeSP(), geradoEm: new Date().toISOString() };
  if (modo.quadro) Object.assign(base, { modo: 'quadro', de: modo.de, ate: modo.ateDia, datadas: DATADAS.filter(x => x !== 'cancelada') });
  if (!ents.length) {
    return Object.assign(base, { fontes: [], etapas: ETAPAS.map(e => Object.assign({ qtd: 0, valor: 0 }, e)), canceladas: 0, statusCols: [], statusPadrao: null, ovs: [],
      avisos: ['Nenhuma entidade de ordem de venda respondeu no Dynamics (testadas: ' + CANDIDATAS.join(', ') + '). Veja o diagnóstico.'], diagnostico: diag });
  }

  const principal = ents.find(e => e.criadaEm && e.temEmpresa) || ents.find(e => e.criadaEm);
  if (principal && !principal.temEmpresa) avisos.push('A ' + principal.entidade + ' não tem a coluna de empresa (dataAreaId): não deu para garantir que só venham OVs da MSB.');
  if (!principal) {
    return Object.assign(base, { fontes: ents.map(e => ({ entidade: e.entidade, papel: 'sem data' })), etapas: ETAPAS.map(e => Object.assign({ qtd: 0, valor: 0 }, e)), canceladas: 0, statusCols: [], statusPadrao: null, ovs: [],
      avisos: ['As entidades de ordem de venda responderam, mas nenhuma tem coluna de data de criação para separar as OVs do dia (' + ents.map(e => e.entidade).join(', ') + '). Fixe a coluna em KANBAN_COL_CRIADA.'], diagnostico: diag });
  }

  let rows;
  if (modo.quadro) {
    // em aberto (qualquer data) + as com nota no período, em paralelo
    // (10/11/26: + as faturadas com a carga ainda Carregado, de qualquer data)
    const [abertas, per, fat] = await Promise.all([
      ovsAbertas(principal, token, ate, diag, avisos),
      ovsComNotaNoPeriodo(modo.de, modo.ateDia, token, ate, diag).catch(e => ({ numeros: [], erro: String(e.message || e).slice(0, 160) })),
      ovsDeCargasCarregadas(token, ate, diag).catch(e => ({ numeros: [], erro: String(e.message || e).slice(0, 160) }))
    ]);
    if (per.erro) avisos.push('Não deu para ler as notas de hoje no diário de faturas (' + per.erro + '): o Faturado e a Rejeitada de hoje podem ficar incompletos.');
    if (fat.erro) avisos.push('Não deu para ler as cargas Carregado e as expedidas hoje (' + fat.erro + '): no Faturado, no Pallet e na Expedição, as OVs faturadas antes do período podem faltar.');
    if (fat.corte) avisos.push(fat.corte + ' cargas Carregado no Dynamics: o Faturado olhou só ' + MAX_CARGAS_FAT + ' delas (KANBAN_MAX_CARGAS_FAT).');
    diag.push({ etapa: 'fat:ovs', cargas: fat.cargas || 0, ovs: (fat.numeros || []).length, cargasHoje: fat.cargasHoje || 0, ovsHoje: (fat.numerosHoje || []).slice(0, 40) });
    const ja = {}; abertas.forEach(r => { ja[chaveOv(r[principal.numero])] = 1; });
    // 12/11/26: as OVs das cargas confirmadas hoje primeiro (Expedição), depois as
    // das cargas Carregado e por último as das notas — se o tempo acabar, faltam estas
    const faltam = Array.from(new Set((fat.numerosHoje || []).concat(fat.numeros || [], per.numeros))).filter(n => !ja[n]);
    let faturadas = [];
    if (faltam.length) {
      try { faturadas = await porNumeros(principal.entidade, principal.numero, faltam, token, ate, diag, 'ov:faturadas', null, !principal.temEmpresa); }
      catch (e) { avisos.push('Não deu para ler as OVs faturadas: ' + String(e.message || e).slice(0, 160)); }
    }
    rows = abertas.concat(faturadas);
  } else {
    rows = await ovsDoDia(principal, dia, token, ate, diag);
  }
  const numeros = Array.from(new Set(rows.map(r => chaveOv(r[principal.numero])).filter(Boolean)));
  const fontes = [{ entidade: principal.entidade, papel: 'principal', colunaData: principal.criadaEm, linhas: rows.length }];

  // registro por OV: { ent: row }
  const reg = {};
  rows.forEach(r => { const k = chaveOv(r[principal.numero]); if (k) (reg[k] = reg[k] || {})[principal.entidade] = r; });

  // complemento (as outras entidades) e linhas, em paralelo
  // no quadro (centenas de OVs) só os primeiros complementos (V3, V2, SalesOrderHeaders)
  const complementos = ents.filter(e => e !== principal).slice(0, modo.quadro ? MAX_COMPL_QUADRO : 99);
  const [compl, porLinha, CRED, TRAB, NOTAS] = await Promise.all([
    Promise.all(complementos.map(async E => {
      if (!numeros.length) return { E, rows: [] };
      try { return { E, rows: await porNumeros(E.entidade, E.numero, numeros, token, ate, diag, 'ov:complemento', null, !E.temEmpresa) }; }
      catch (e) { avisos.push('Complemento ' + E.entidade + ': ' + String(e.message || e).slice(0, 160)); return { E, rows: [] }; }
    })),
    numeros.length ? linhas(numeros, token, ate, diag) : Promise.resolve({}),
    // gerenciamento de crédito: a tabela da Bio (BioCredManTableV1), pelo SALESID
    numeros.length
      ? creditoDasOvs(numeros, token, ate, diag).catch(e => ({ E: null, por: {}, erro: String(e.message || e).slice(0, 160) }))
      : Promise.resolve({ E: null, por: {} }),
    // trabalho de depósito (WHSWorkTableBiEntity), pelo nº da OV: Separação/Conferência
    numeros.length
      ? trabalhosDasOvs(numeros, token, ate, diag).catch(e => ({ E: null, por: {}, erro: String(e.message || e).slice(0, 160) }))
      : Promise.resolve({ E: null, por: {} }),
    // notas fiscais da OV (diário de faturas): o número na tela e a Rejeitada
    numeros.length
      ? notasDasOvs(numeros, token, ate, diag).catch(e => ({ E: null, por: {}, erro: String(e.message || e).slice(0, 160) }))
      : Promise.resolve({ E: null, por: {} })
  ]);
  // o status de cada nota (documento fiscal / NF-e, pelo número)
  const nfs = Array.from(new Set([].concat.apply([], Object.keys(NOTAS.por).map(k => NOTAS.por[k].map(n => n.numero)))));
  let STN = { porNum: {}, fontes: [], vazio: true };
  if (nfs.length) {
    try { STN = await ST_NOTA.statusPorNumero(nfs, ate); (STN.diag || []).forEach(d => diag.push(d)); }
    catch (e) { STN = { porNum: {}, fontes: [], erro: String(e.message || e).slice(0, 160) }; }
    Object.keys(NOTAS.por).forEach(k => NOTAS.por[k].forEach(n => {
      const st = ST_NOTA.statusDaNota(STN.porNum[ST_NOTA.numNorm(n.numero)], n.data);
      n.status = st ? st.status : ''; n.statusFonte = st ? st.entidade + '.' + st.coluna : '';
      n.rejeitada = !!(st && nfRejeitadaV(st.status)); n.aprovada = !!(st && ST_NOTA.aprovado(st.status));
    }));
  }
  if (NOTAS.E) fontes.push({ entidade: NOTAS.E.entidade, papel: 'notas', colunas: NOTAS.E.numero + ' + ' + NOTAS.E.nota, notas: nfs.length, status: STN.fontes || [] });
  // cargas: só se a entidade de trabalho respondeu e algum trabalho tem LoadId
  const idsCarga = TRAB.E ? Array.from(new Set([].concat.apply([], Object.keys(TRAB.por).map(k => TRAB.por[k].lista.map(w => w.carga))).filter(Boolean))) : [];
  const CARGA = idsCarga.length
    ? await cargasPorId(idsCarga, token, ate, diag).catch(e => ({ E: null, por: {}, erro: String(e.message || e).slice(0, 160) }))
    : { E: null, por: {}, semIds: true };
  if (CARGA.E) diag.push({ etapa: 'carga:colunas', entidade: CARGA.E.entidade, colunas: CARGA.E.colunas || [] });
  if (CARGA.E) (CARGA.usadas || [{ entidade: CARGA.E.entidade, cargas: Object.keys(CARGA.por).length }]).forEach(u => {
    const Eu = (CARGA.lista || []).find(L => L.entidade === u.entidade) || CARGA.E;
    fontes.push({ entidade: u.entidade, papel: 'carga', colunas: Eu.numero + (Eu.status ? ' + ' + Eu.status : ''), cargas: u.cargas, erro: u.erro || undefined });
  });
  if (TRAB.E) fontes.push({ entidade: TRAB.E.entidade, papel: 'trabalho', colunas: TRAB.E.numero + ' + ' + TRAB.E.status, trabalhos: Object.keys(TRAB.por).reduce((s2, k) => s2 + TRAB.por[k].lista.length, 0) });
  if (CRED.E) fontes.push({ entidade: CRED.E.entidade, papel: 'crédito', colunas: CRED.E.numero + ' + ' + CRED.E.ativo, registros: Object.keys(CRED.por).reduce((s2, k) => s2 + CRED.por[k].n, 0) });
  compl.forEach(({ E, rows: rs }) => {
    fontes.push({ entidade: E.entidade, papel: 'complemento', linhas: rs.length });
    rs.forEach(r => { const k = chaveOv(r[E.numero]); if (reg[k]) reg[k][E.entidade] = r; });
  });

  // a Área Demandante (PI Pedidos): em qualquer entidade de OV lida; viuColArea =
  // alguma delas tem o campo (sem ele em nenhuma: aviso)
  let viuColArea = false;
  const pegaArea = (k) => {
    for (const ent of Object.keys(reg[k])) {
      const row = reg[k][ent], col = colArea(row);
      if (!col) continue;
      viuColArea = true;
      const v = txt(row[col]);
      if (v && !VAZIOS.test(v)) return { valor: v, coluna: ent + '.' + col };
    }
    return null;
  };
  // 12/11/26: os campos extras do dono — o valor da 1ª entidade que o tiver
  // preenchido; senão o da 1ª que tiver a coluna (vazio/"No"); senão nada
  const pegaExtra = (k, nome) => {
    let achou = null;
    for (const ent of Object.keys(reg[k])) {
      const row = reg[k][ent], col = achaCol(colunasDe(row), [nome]);
      if (!col) continue;
      const v = row[col] == null ? '' : txt(row[col]);
      if (v) return { nome, coluna: ent + '.' + col, valor: v };
      if (!achou) achou = { nome, coluna: ent + '.' + col, valor: '' };
    }
    return achou || { nome, coluna: null, valor: null };
  };
  const pega = (k, campo) => {
    for (const ent of Object.keys(reg[k])) { const col = achaCol(colunasDe(reg[k][ent]), COLS[campo]); if (col && txt(reg[k][ent][col]) && !VAZIOS.test(txt(reg[k][ent][col]))) return txt(reg[k][ent][col]); }
    return '';
  };

  // só as OVs do depósito do quadro (DEPOSITOS): as outras saem ANTES de
  // contar status, etapas e valores — contadas à parte em foraDeposito
  let foraDeposito = 0, semDeposito = 0;
  if (!TODOS_DEPOSITOS) {
    Object.keys(reg).forEach(k => {
      const dep = pega(k, 'deposito').toUpperCase();
      if (!dep) semDeposito++;
      if (DEPOSITOS.indexOf(dep) < 0) { delete reg[k]; foraDeposito++; }
    });
    if (numeros.length && semDeposito === numeros.length) {
      avisos.push('Nenhuma OV do dia trouxe o depósito (' + COLS.deposito.join(', ') + '): o quadro mostra só ' + DEPOSITOS.join(', ') + ' e ficou vazio.');
    }
  }

  // colunas de status de todas as entidades (valores crus + contagem)
  const statusMap = {};
  Object.keys(reg).forEach(k => {
    Object.keys(reg[k]).forEach(ent => {
      const r = reg[k][ent];
      colunasDe(r).forEach(col => {
        if (!RE_STATUS.test(col) || RE_NAO_STATUS.test(col.replace(/status/ig, ''))) return;
        const v = r[col];
        if (v != null && typeof v === 'object') return;
        const chave = ent + '.' + col;
        const s = statusMap[chave] || (statusMap[chave] = { chave, entidade: ent, coluna: col, valores: {} });
        const val = txt(v) || '(vazio)';
        s.valores[val] = (s.valores[val] || 0) + 1;
      });
    });
  });
  const statusCols = Object.values(statusMap).sort((a, b) => {
    const pa = /^bio/i.test(a.entidade) ? 0 : 1, pb = /^bio/i.test(b.entidade) ? 0 : 1;
    return pa - pb || a.chave.localeCompare(b.chave);
  });
  // padrão: env; senão a 1ª coluna de status da entidade Bio; senão SalesOrderStatus
  const envPadrao = txt(process.env.KANBAN_STATUS_PADRAO);
  const statusPadrao = (envPadrao && statusMap[envPadrao] ? envPadrao : null)
    // da Bio, o status do PEDIDO antes de qualquer outro status (liberação, crédito…)
    || (statusCols.find(s => /^bio/i.test(s.entidade) && /status/i.test(s.coluna) && /pedido|order|ordem|^ov|venda/i.test(s.coluna)) || {}).chave
    || (statusCols.find(s => /^bio/i.test(s.entidade) && /status/i.test(s.coluna)) || {}).chave
    || (statusCols.find(s => /^SalesOrderStatus$/i.test(s.coluna)) || {}).chave
    || (statusCols[0] || {}).chave || null;

  // valor cru de um campo da regra: o 1º NOME da lista que existir em qualquer
  // entidade (o nome que o dono deu — SalesStatus — ganha do equivalente)
  const cru = (k, nomes) => {
    for (const nome of nomes) {
      for (const ent of Object.keys(reg[k])) {
        const col = achaCol(colunasDe(reg[k][ent]), [nome]);
        if (col && reg[k][ent][col] != null && txt(reg[k][ent][col]) !== '') return { valor: reg[k][ent][col], coluna: ent + '.' + col };
      }
    }
    return null;
  };
  const achou = { sales: 0, release: 0, credito: 0 };
  // as cargas de uma lista de trabalhos e a fase delas (a menos adiantada)
  const cargasDe = (ws) => Array.from(new Set(ws.map(w => w.carga).filter(Boolean)))
    .map(id => CARGA.por[id.toUpperCase()] ? CARGA.por[id.toUpperCase()].carga : { id, status: '', naoAchada: !!CARGA.E });
  const faseCargasDe = (cs) => { const c = cs.filter(x => x.fase); return c.length ? c.reduce((m, x) => RANK_CARGA[x.fase] < RANK_CARGA[m] ? x.fase : m, 'remetido') : null; };
  const todas = Object.keys(reg).map(k => {
    const sa = cru(k, COL_SALES), re = cru(k, COL_RELEASE);
    // crédito: a tabela da Bio decide (registro ATIVO pelo SALESID); sem a
    // tabela no OData, o CredManInCreditControl do cabeçalho
    let cr = null, crAtivo = null, crFonte = null, crN = null;
    const cd = CRED.E ? (CRED.por[k] || null) : null;
    if (CRED.E) {
      crFonte = 'tabela'; crN = cd ? cd.n : 0; crAtivo = !!(cd && cd.ativo);
      cr = { valor: cd && cd.row ? cd.row[CRED.E.ativo] : null, coluna: CRED.E.entidade + '.' + CRED.E.ativo };
    } else {
      cr = cru(k, COL_CREDITO);
      if (cr) { crFonte = 'cabecalho'; crAtivo = marcadoV(cr.valor); }
    }
    if (sa) achou.sales++; if (re) achou.release++; if (crFonte) achou.credito++;
    const tb = TRAB.E ? (TRAB.por[k] || null) : null;
    // notas da OV (a mais recente primeiro); vale a mais recente com status
    const nts = NOTAS.E ? (NOTAS.por[k] || []) : [];
    const nVale = nts.find(n => n.status) || null;
    // cargas da OV (pelos LoadId dos trabalhos dela) e a fase: a menos adiantada
    const idsOv = tb ? Array.from(new Set(tb.lista.map(w => w.carga).filter(Boolean))) : [];
    const cargasOv = cargasDe(tb ? tb.lista : []);
    // 10/11/26: trabalho ABERTO = Separação; os outros (em processo / fechado)
    // seguem a carga deles. Com os dois tipos, a OV vira 2 cartões (abaixo).
    const validos = tb ? tb.lista.filter(w => w.fase !== 'ignora') : [];
    const abertosW = validos.filter(w => w.fase === 'aberto'), outrosW = validos.filter(w => w.fase !== 'aberto');
    const misto = abertosW.length > 0 && outrosW.length > 0;
    // a fase da carga: só a das cargas dos trabalhos que NÃO estão abertos (a do
    // trabalho aberto é a Separação, mesmo com a carga já em processamento)
    const faseOv = faseCargasDe(cargasDe(outrosW));
    const notaFase = nVale ? (nVale.rejeitada ? 'rejeitada' : nVale.aprovada ? 'aprovada' : 'outra') : null;
    const trabFase = TRAB.E ? faseTrabDe(misto ? outrosW : validos) : null;
    const etapa = etapaDe(sa && sa.valor, re && re.valor, crAtivo, trabFase, notaFase, faseOv, null);
    const status = {};
    statusCols.forEach(s => { const r = reg[k][s.entidade]; status[s.chave] = r ? (txt(r[s.coluna]) || '(vazio)') : null; });
    const campos = {};
    Object.keys(reg[k]).forEach(ent => { campos[ent] = crus(reg[k][ent]); });
    if (cd && cd.row) campos[CRED.E.entidade] = crus(cd.row);
    if (tb && tb.row) campos[TRAB.E.entidade] = crus(tb.row);
    // o registro da carga nos campos crus
    const cg0 = idsOv.map(id => CARGA.por[id.toUpperCase()]).filter(Boolean)[0] || null;
    const EC = cg0 ? cg0.E : CARGA.E;   // a entidade de onde veio a carga da OV
    if (cg0) campos[EC.entidade] = crus(cg0.row);
    const l = porLinha[k] || null;
    const area = pegaArea(k);
    return {
      numero: k,
      // 11/11/26: veio do PI Pedidos (a OV tem a Área Demandante)
      origemPi: !!area, areaDemandante: area ? area.valor : null, areaCol: area ? area.coluna : null,
      // 12/11/26: os campos extras pedidos pelo dono (a ficha mostra em "Dados do pedido")
      extras: CAMPOS_EXTRA.map(nome => pegaExtra(k, nome)),
      cliente: pega(k, 'nome'), conta: pega(k, 'conta'), oc: pega(k, 'oc'),
      criadaEm: txt(reg[k][principal.entidade][principal.criadaEm]),
      entrega: pega(k, 'entrega'), deposito: pega(k, 'deposito'), pool: pega(k, 'pool'), criadoPor: pega(k, 'criadoPor'),
      valor: l ? l.valor : null, itens: l ? l.itens : null,
      etapa,
      // os três campos que decidiram a etapa (valor cru + de onde veio)
      regra: {
        salesStatus: sa ? txt(sa.valor) : null, salesStatusCol: sa ? sa.coluna : null,
        releaseStatus: re ? txt(re.valor) : null, releaseStatusCol: re ? re.coluna : null,
        credito: cr && cr.valor != null ? txt(cr.valor) : null, creditoCol: cr ? cr.coluna : null,
        // de onde veio o crédito ('tabela' = BioCredManTableV1; 'cabecalho' =
        // CredManInCreditControl), se está ativo e quantos registros a OV tem
        creditoFonte: crFonte, creditoAtivo: crFonte ? crAtivo : null, creditoRegistros: crN,
        creditoOv: CRED.E ? CRED.E.numero : null,
        // trabalho de depósito: a fase da OV e a contagem (null = entidade fora do OData)
        trabalho: TRAB.E ? { fase: tb ? tb.fase : null, total: tb ? tb.total : 0, fechados: tb ? tb.fechados : 0, processo: tb ? tb.processo : 0,
          abertos: tb ? tb.abertos : 0, ignorados: tb ? tb.ignorados : 0, coluna: TRAB.E.entidade + '.' + TRAB.E.status, colOv: TRAB.E.numero } : null
      },
      trabalhos: tb ? tb.lista : [],
      // notas fiscais da OV (o número vai para o cartão) e a que decide a Rejeitada
      notas: nts, nota: nts.length ? { numero: (nVale || nts[0]).numero, status: nVale ? nVale.status : '', rejeitada: !!(nVale && nVale.rejeitada),
        aprovada: !!(nVale && nVale.aprovada), fonte: nVale ? nVale.statusFonte : '' } : null, notaFonte: NOTAS.E ? NOTAS.E.entidade : null,
      // cargas (WHSOutboundLoadHeaderEntity): Conferência, Cotação, Pallet e Expedição
      cargas: cargasOv, cargaFase: faseOv, cargaFonte: EC ? EC.entidade + (EC.status ? '.' + EC.status : '') : null,
      cargaCols: EC ? { status: EC.status || null, cotacao: EC.cotacao || null, pallet: EC.pallet || null, envioConfirmado: EC.envioConfirmado || null } : null,
      // pode enviar para o Pallet: alguma carga Carregado + cotação Sim, ainda não enviada
      podePallet: cargasOv.some(c => c.podePallet),
      status, campos,
      // para a divisão pelos trabalhos (sai antes da resposta)
      _trab: { abertos: abertosW, outros: outrosW, misto },
      // para a etapa de cada LINHA (partesPorLinhas)
      _ctx: { sa: sa && sa.valor, re: re && re.valor, cr: crAtivo, trab: trabFase, nota: notaFase, carga: faseOv }
    };
  }).sort((a, b) => b.criadaEm.localeCompare(a.criadaEm) || b.numero.localeCompare(a.numero));
  // 10/11/26: a OV em partes pelo lote das linhas (Pendência x o resto)
  const colLote = _colsLinhas && _colsLinhas.lote;
  const partes = [];
  const lidas = porLinha._lidas || new Set();
  // 1º o lote (a parte sem lote vai para Pendência); 2º os trabalhos, na parte
  // que anda (trabalho aberto = Separação; os outros, onde a carga mandar)
  const colStatus = _colsLinhas && _colsLinhas.status;
  todas.forEach(o => partesPorLinhas(o, (porLinha[o.numero] || {}).linhas || null, lidas.has(o.numero), !!colLote, !!colStatus).forEach(p => {
    // os trabalhos só dividem a parte com linhas em aberto (a do trabalho aberto)
    if (!p._abertas) partes.push(p);
    else partesPorTrabalho(p, cargasDe, faseCargasDe).forEach(q => partes.push(q));
  }));
  partes.forEach(p => { delete p._trab; delete p._ctx; delete p._abertas; });
  // os outros cartões da mesma OV (a ficha lista todos e leva de um ao outro)
  const porNum = {};
  partes.forEach(p => { (porNum[p.numero] = porNum[p.numero] || []).push(p); });
  Object.keys(porNum).forEach(n => {
    const g = porNum[n]; if (g.length < 2) return;
    g.forEach(p => { p.irmas = g.filter(x => x !== p).map(x => ({ chave: x.chave, etapa: x.etapa, valor: x.valor })); });
  });
  if (todas.length && !viuColArea) {
    avisos.push('O campo da Área Demandante (' + COL_AREA_TXT() + ') não está em nenhuma das entidades de OV lidas (' +
      fontes.filter(f => f.papel === 'principal' || f.papel === 'complemento').map(f => f.entidade).join(', ') +
      '): o selo "PI Pedidos" não aparece. Se o campo estiver em outra entidade, ela precisa estar entre as lidas (ou fixe o nome em KANBAN_COL_AREA).');
  }
  if (!colLote && pendenciaPorLote() && Object.keys(porLinha).length) {
    avisos.push('As linhas da OV (' + (_entLinhas || 'SalesOrderLines') + ') não trazem o lote (' + COL_LOTE.join(' / ') + '): a Pendência por item sem lote fica desligada. Fixe o nome em KANBAN_COL_LOTE.');
  }
  // 12/11/26: quando a carga foi expedida (a ficha mostra; o quadro filtra)
  partes.forEach(o => { if (o.etapa === 'expedicao') o.expedidaEm = expedidaEmDe(o.cargas); });
  // quadro (12/11/26): sem período — só a EXPEDIÇÃO filtra, pela OV cuja carga
  // teve o envio confirmado HOJE, de qualquer data
  const hoje = hojeSP();
  const foraPeriodo = 0;
  let expedicaoOutroDia = 0, expedicaoSemData = 0;
  const ovs = !modo.quadro ? partes : partes.filter(o => {
    if (o.etapa !== 'expedicao') return true;
    if (!o.expedidaEm) { expedicaoSemData++; return false; }
    o.dataPeriodo = diaSP(o.expedidaEm);
    if (o.dataPeriodo !== hoje) { expedicaoOutroDia++; return false; }
    return true;
  });
  if (modo.quadro && CARGA.E && !(CARGA.lista || [CARGA.E]).some(L => L.envioConfirmado)) {
    avisos.push('Não achei o campo ' + COL_CARGA.envioConfirmado[0] + ' nas entidades de cargas (' + (CARGA.lista || [CARGA.E]).map(L => L.entidade).join(', ') +
      '): a Expedição, que mostra as cargas com o envio confirmado hoje, fica vazia. Fixe o nome em KANBAN_COL_CARGA_ENVIO_CONFIRMADO.');
  }

  // as 4 colunas, na ordem do fluxo, com contagem e valor
  const etapas = ETAPAS.map(e => {
    const lista = ovs.filter(o => o.etapa === e.id);
    return { id: e.id, nome: e.nome, pendente: !!e.pendente, qtd: lista.length, valor: Math.round(lista.reduce((s2, o) => s2 + (o.valor || 0), 0) * 100) / 100 };
  });
  const canceladas = ovs.filter(o => o.etapa === 'cancelada').length;
  if (ovs.length) {
    const falta = [];
    if (!achou.sales) falta.push(COL_SALES[0]);
    if (!achou.release) falta.push(COL_RELEASE[0]);
    // o crédito que faltar já sai no aviso da tabela de crédito, logo abaixo
    if (!TRAB.E) {
      avisos.push('A entidade de trabalho de depósito (WHSWorkTableBiEntity) não respondeu no OData' + (TRAB.erro ? ' (' + TRAB.erro + ')' : '') +
        '. Sem ela, a Conferência fica vazia e a Separação segue só o ReleaseStatus. Se a entidade não for pública no OData, é preciso publicá-la (ou fixar o nome em KANBAN_ENT_TRABALHO).');
    }
    if (!NOTAS.E) {
      avisos.push('A entidade de notas fiscais (SalesInvoiceHeadersV2) não respondeu no OData' + (NOTAS.erro ? ' (' + NOTAS.erro + ')' : '') +
        '. Sem ela, o número da nota não aparece e a coluna Rejeitada fica vazia.');
    } else if (nfs.length && !(STN.fontes || []).length) {
      avisos.push('Não achei o status da nota fiscal (documento fiscal / NF-e) no OData' + (STN.erro ? ' (' + STN.erro + ')' : '') +
        ': o número da nota aparece, mas a coluna Rejeitada fica vazia.');
    }
    if (CARGA.E && (!CARGA.E.cotacao || !CARGA.E.pallet || !CARGA.E.status)) {
      const falta = [!CARGA.E.status ? 'o status da carga (' + COL_CARGA.status[0] + ')' : '', !CARGA.E.cotacao ? '"Cotação realizada" (' + COL_CARGA.cotacao[0] + ')' : '',
        !CARGA.E.pallet ? COL_CARGA.pallet[0] : ''].filter(Boolean);
      // os campos da entidade que parecem ser o que falta — para o dono apontar o nome
      const parecidos = (CARGA.E.colunas || []).filter(cn => /status|quot|cota|pallet|realiz/i.test(cn)).slice(0, 12);
      avisos.push('Na entidade de cargas (' + CARGA.E.entidade + ') não achei ' + falta.join(', nem ') + '.' +
        (!CARGA.E.cotacao ? ' Carga Carregado fica em Cotação.' : '') + (!CARGA.E.pallet ? ' O botão "Enviar para o Pallet" não aparece.' : '') +
        (parecidos.length ? ' Campos parecidos nessa entidade: ' + parecidos.join(', ') + '.' : '') +
        ' Fixe os nomes em KANBAN_COL_CARGA_STATUS / KANBAN_COL_CARGA_COTACAO / KANBAN_COL_CARGA_PALLET.');
    }
    if (CARGA.E && idsCarga.length) {
      const naoAchadas = idsCarga.filter(id => !CARGA.por[id.toUpperCase()]);
      if (naoAchadas.length) avisos.push(naoAchadas.length + ' de ' + idsCarga.length + ' carga(s) dos trabalhos de depósito não estão na' + ((CARGA.lista || []).length > 1 ? 's entidades de cargas ' + CARGA.lista.map(L => L.entidade).join(' / ') : ' entidade de cargas ' + CARGA.E.entidade) +
        ' (ex.: ' + naoAchadas.slice(0, 3).join(', ') + '): sem o status delas, essas OVs não entram em Conferência, Cotação, Pallet nem Expedição.');
    }
    if (!CARGA.E && !CARGA.semIds) {
      avisos.push('A entidade de cargas (WHSLoadTableBiEntity / WHSOutboundLoadHeaderEntity) não respondeu no OData' + (CARGA.erro ? ' (' + CARGA.erro + ')' : '') +
        '. As cargas não aparecem na ficha — e a Cotação vai depender dela. Se a entidade não for pública no OData, é preciso publicá-la (ou fixar o nome em KANBAN_ENT_CARGA).');
    }
    if (!CRED.E) {
      avisos.push('A tabela de gerenciamento de crédito (Credit management · BioCredManTableV1Entity) não respondeu no OData' +
        (CRED.erro ? ' (' + CRED.erro + ')' : '') +
        '. Sem ela, o crédito sai do ' + COL_CREDITO[0] + ' do cabeçalho' + (achou.credito ? '' : ', que também não veio') +
        '. Se a entidade não for pública no OData, é preciso publicá-la (ou fixar o nome em KANBAN_ENT_CREDITO).');
    }
    if (falta.length) avisos.push('Não achei ' + falta.join(', ') + ' nas entidades lidas (' + fontes.map(f => f.entidade).join(', ') + '): as etapas dependem desses campos. Veja os campos de cada OV no painel.');
    else if (achou.sales < ovs.length) avisos.push((ovs.length - achou.sales) + ' OV(s) sem SalesStatus: ficaram em Criada, Gerenciamento de Crédito ou Separação pelos outros campos.');
  }
  const r = Object.assign(base, { fontes, etapas, canceladas, depositos: TODOS_DEPOSITOS ? null : DEPOSITOS, foraDeposito, foraPeriodo, expedicaoDia: modo.quadro ? hoje : undefined, expedicaoOutroDia, expedicaoSemData, statusCols, statusPadrao, ovs, avisos, diagnostico: diag });
  if (!opts.diag) _cache.set(modo.chave, { ts: Date.now(), r });
  return r;
}

// ── AS LINHAS DE UMA OV (o painel da OV, 09/11/2026) ─────────────
// "No kanban, melhore o modal à direita, se baseie muito no Sales Report,
// pedido em andamento": a ficha lista as linhas da OV (produto, quantidade ×
// preço, status e entrega de cada linha). Lidas SÓ quando a ficha abre —
// o quadro, que relê a cada 30 s, continua pedindo só o valor das linhas.
// Sem $select (uma OV tem poucas linhas e cada campo é lido por vários
// nomes: o que a entidade não tiver fica vazio). Cache por OV: 15 s.
const COLS_LINHA = {
  linha:      ['LineNumber', 'LineCreationSequenceNumber'],
  item:       ['ItemNumber', 'ItemId'],
  produto:    ['LineDescription', 'ProductName', 'ItemName', 'Name'],
  qtd:        ['OrderedSalesQuantity', 'SalesQuantity', 'Quantity'],
  un:         ['SalesUnitSymbol', 'SalesUnit'],
  preco:      ['SalesPrice', 'UnitPrice'],
  desconto:   ['LineDiscountAmount'],
  descPct:    ['LineDiscountPercentage'],
  valor:      ['LineAmount', 'NetAmount'],
  status:     ['SalesOrderLineStatus', 'LineStatus', 'SalesStatus'],
  entrega:    ['RequestedShippingDate', 'RequestedReceiptDate'],
  confirmada: ['ConfirmedShippingDate', 'ConfirmedReceiptDate'],
  deposito:   ['ShippingWarehouseId', 'InventLocationId'],
  lote:       ['ItemBatchNumber', 'InventBatchId', 'BatchNumber', 'BatchId']
};
// data "vazia" do F&O (1900-01-01, em qualquer hora) = sem data
const dataLinha = (v) => { const s = txt(v); return /^\d{4}-\d{2}-\d{2}/.test(s) && !/^1900-01-01/.test(s) ? s.slice(0, 10) : null; };
const _cacheLinhas = new Map();
// o frete da OV: os tipos de frete (sem repetir) das linhas dos trabalhos dela
async function freteDaOv(n, token, ate) {
  const x = await entidadeExtra(CFG_FRETE, token, ate, []);
  const E = x.E;
  if (!E) return { entidade: null, coluna: COL_FRETE.frete[0], valores: [], erro: x.motivo || 'a entidade das linhas de trabalho não respondeu' };
  const emp = (Ent) => Ent.temEmpresa ? "dataAreaId eq '" + D.odataStr(EMPRESA) + "' and " : '';
  let filtro;
  if (E.numero) filtro = E.numero + " eq '" + D.odataStr(n) + "'";
  else {
    // sem o nº da OV nas linhas de trabalho: pelos WorkId dos trabalhos da OV
    const xt = await entidadeExtra(CFG_TRABALHO, token, ate, []);
    if (!xt.E || !E.trabalho) return { entidade: E.entidade, coluna: E.frete, valores: [], erro: 'a ' + E.entidade + ' não tem o nº da OV nem dá para ligar pelos trabalhos' };
    const ws = await D.odataGetComPrazo(xt.E.entidade, { crossCompany: true, top: 200, filter: emp(xt.E) + xt.E.numero + " eq '" + D.odataStr(n) + "'" }, token, prazo(ate, 10000));
    const ids = Array.from(new Set(ws.map(w => txt(w[xt.E.id || 'WorkId'])).filter(Boolean))).slice(0, 40);
    if (!ids.length) return { entidade: E.entidade, coluna: E.frete, valores: [], linhas: 0 };
    filtro = '(' + ids.map(id => E.trabalho + " eq '" + D.odataStr(id) + "'").join(' or ') + ')';
  }
  const rows = await D.odataGetComPrazo(E.entidade, { crossCompany: true, top: 500, filter: emp(E) + filtro }, token, prazo(ate, 12000));
  const valores = Array.from(new Set(rows.map(r => txt(r[E.frete])).filter(v => v && !/^none$/i.test(v))));
  return { entidade: E.entidade, coluna: E.frete, valores, linhas: rows.length };
}

async function linhasDaOv(numero, opts) {
  opts = opts || {};
  const n = chaveOv(numero);
  const base = { ok: true, configured: true, numero: n, geradoEm: new Date().toISOString() };
  if (!n) return Object.assign(base, { linhas: [], entidade: null });
  const c = _cacheLinhas.get(n);
  if (!opts.atualizar && c && Date.now() - c.ts < TTL_MS) return Object.assign({}, c.r, { cache: true });
  const ate = Date.now() + Math.min(ORCAMENTO, 25000);
  const token = await D.getToken();
  // 12/11/26: o frete (linhas do trabalho de depósito), junto com as linhas da OV
  const pFrete = freteDaOv(n, token, ate).catch(e => ({ entidade: null, coluna: COL_FRETE.frete[0], valores: [], erro: String(e.message || e).slice(0, 160) }));
  const alvos = _entLinhas ? [_entLinhas] : ENT_LINHAS;
  let rows = null, entidade = null, ultimo = null;
  for (const ent of alvos) {
    try {
      rows = await D.odataGetComPrazo(ent, { crossCompany: true, top: 500,
        filter: "dataAreaId eq '" + D.odataStr(EMPRESA) + "' and SalesOrderNumber eq '" + D.odataStr(n) + "'" }, token, prazo(ate, 15000));
      entidade = ent; _entLinhas = _entLinhas || ent;
      break;
    } catch (e) {
      ultimo = e;
      if (!/\b(400|404)\b/.test(String(e.message))) break;
    }
  }
  if (!rows) throw ultimo || new Error('nenhuma entidade de linhas de OV respondeu (' + alvos.join(', ') + ')');
  const pk = (r, campo) => D.pick(r, COLS_LINHA[campo]);
  const linhas = rows.map(r => {
    const s = (campo) => { const v = pk(r, campo); return v == null || VAZIOS.test(txt(v)) ? '' : txt(v); };
    return {
      linha: num(pk(r, 'linha')), item: s('item'), produto: s('produto'),
      qtd: num(pk(r, 'qtd')), un: s('un'), preco: num(pk(r, 'preco')),
      desconto: num(pk(r, 'desconto')), descPct: num(pk(r, 'descPct')), valor: num(pk(r, 'valor')),
      status: s('status'), entrega: dataLinha(pk(r, 'entrega')), confirmada: dataLinha(pk(r, 'confirmada')), deposito: s('deposito'),
      lote: s('lote'), temLote: !!D.pick(r, COLS_LINHA.lote) || Object.keys(r).some(k => COLS_LINHA.lote.some(n => n.toLowerCase() === k.toLowerCase()))
    };
  }).sort((a, b) => (a.linha == null ? 1e9 : a.linha) - (b.linha == null ? 1e9 : b.linha));
  const r = Object.assign(base, { entidade, linhas, frete: await pFrete });
  _cacheLinhas.set(n, { ts: Date.now(), r });
  if (_cacheLinhas.size > 200) _cacheLinhas.delete(_cacheLinhas.keys().next().value);
  return r;
}

// ── TIPO DE OPERAÇÃO DAS OVs (09/11/2026) ─────────────────────────
// Pedido do dono: o Faturamento do Dia mostra o tipo de operação de cada
// nota; o diário de faturas não tem, então ele vem da ORDEM DE VENDA da nota.
// Reaproveita a descoberta das entidades de OV deste motor (BIO + V3/V2…):
// em cada uma, as colunas com cara de tipo de operação (operation, operação,
// CFOP, natureza, SalesPurchOperationType), lidas pelos números das OVs.
// -> { porOv: { OV: { valor, coluna, todos:{ 'Ent.Col': v } } }, colunas:[…], diag:[…] }
const RE_OPER = /operation|opera[cç]|cfop|natur|opertype|salespurchoper/i;
const RE_OPER_NAO = /operationalsite|operatingunit|date|time/i;
// enum que diz "não se aplica" não é tipo de operação (no print do dono, toda
// nota saía "DoesNotApply · pela OV")
const SEM_VALOR_OP = /^(doesnotapply|notapplicable|not applicable|none|no|nao se aplica|não se aplica|n\/a)$/i;
// 09/11/26 (o dono achou o campo na ficha da OV do Kanban): o tipo de operação
// da nota ligada à OV é o FiscalDocumentOperationTypeId (ex.: "S.LIC.002").
// Ele vence qualquer outra coluna com cara de operação. KANBAN_COL_OPERACAO
// troca/acrescenta nomes (lista, em ordem de preferência).
const COL_OPERACAO = envLista('KANBAN_COL_OPERACAO', ['FiscalDocumentOperationTypeId']);
async function operacoesDasOvs(numeros, ate) {
  const diag = [], porOv = {};
  const nums = Array.from(new Set((numeros || []).map(chaveOv).filter(Boolean)));
  if (!nums.length) return { porOv, colunas: [], diag };
  const token = await D.getToken();
  const ents = await entidades(token, ate, diag, false);
  const comOp = ents.map(E => ({ E, cols: (E.colunas || []).filter(c => RE_OPER.test(c) && !RE_OPER_NAO.test(c)) })).filter(x => x.cols.length);
  if (!comOp.length) {
    diag.push({ etapa: 'ov:operacao', erro: 'nenhuma entidade de OV tem coluna de tipo de operação', entidades: ents.map(e => e.entidade) });
    return { porOv, colunas: [], diag };
  }
  await Promise.all(comOp.map(async ({ E, cols }) => {
    try {
      const rows = await porNumeros(E.entidade, E.numero, nums, token, ate, diag, 'ov:operacao', [E.numero].concat(cols).join(','), !E.temEmpresa);
      rows.forEach(r => {
        const k = chaveOv(r[E.numero]); if (!k) return;
        const o = porOv[k] || (porOv[k] = { todos: {} });
        cols.forEach(c => { const v = txt(r[c]); if (v && !VAZIOS.test(v) && !SEM_VALOR_OP.test(v)) o.todos[E.entidade + '.' + c] = v; });
      });
    } catch (e) { /* o erro já está no diag */ }
  }));
  // o que vai para a tela: o FiscalDocumentOperationTypeId (COL_OPERACAO), se
  // alguma entidade trouxer; senão uma coluna de descrição; senão a 1ª preenchida
  const colDe = (chave) => chave.split('.').pop().toLowerCase();
  Object.keys(porOv).forEach(k => {
    const ks = Object.keys(porOv[k].todos);
    let pref = null;
    for (const nome of COL_OPERACAO) { pref = ks.find(x => colDe(x) === nome.toLowerCase()); if (pref) break; }
    pref = pref || ks.find(x => /descr|name|nome|texto|text/i.test(x)) || ks[0] || null;
    porOv[k].coluna = pref; porOv[k].valor = pref ? porOv[k].todos[pref] : '';
  });
  return { porOv, colunas: comOp.map(x => x.E.entidade + ': ' + x.cols.join(', ')), diag };
}


// ── "ENVIAR PARA O PALLET" (09/11/2026) — a ÚNICA escrita do Kanban ──
// Dono: "BOTÃO ENVIAR PARA O PALLET = Carga -> Status da carga = Carregado AND
// Cotação realizada = SIM -> ENVIARPALLET_CUSTOM = SIM (INSERIR NO D365)".
// Relê a carga NA HORA (a tela pode estar velha), confere a condição de novo e
// só então grava ENVIARPALLET_CUSTOM = Sim (PATCH na entidade de cargas, pela
// chave dataAreaId + LoadId). Já enviada = ok sem gravar de novo.
function erroStatus(msg, status) { const e = new Error(msg); e.status = status; e.publicMessage = msg; return e; }
async function enviarParaPallet(loadId) {
  const id = txt(loadId);
  if (!/^[A-Za-z0-9._\-\/]{1,40}$/.test(id)) throw erroStatus('Número de carga inválido.', 400);
  const ate = Date.now() + 25000, diag = [];
  const token = await D.getToken();
  const x = await entidadeExtra(CFG_CARGA, token, ate, diag);
  if (!x.E) throw erroStatus('A entidade de cargas não respondeu no OData' + (x.motivo ? ' (' + x.motivo + ')' : '') + '.', 409);
  // 10/11/26: a carga pode estar só numa das entidades (a BI não traz todas) —
  // procura em cada uma que serve, na ordem
  const lista = x.todas && x.todas.length ? x.todas : [x.E];
  let E = null, r = null;
  for (const Ei of lista) {
    const rows = await D.odataGetComPrazo(Ei.entidade, { crossCompany: true, top: 2,
      filter: (Ei.temEmpresa ? "dataAreaId eq '" + D.odataStr(EMPRESA) + "' and " : '') + Ei.numero + " eq '" + D.odataStr(id) + "'" }, token, prazo(ate, 12000)).catch(() => []);
    if (rows.length) { E = Ei; r = rows[0]; break; }
  }
  if (!r) throw erroStatus('A carga ' + id + ' não foi encontrada no Dynamics.', 404);
  const c = { status: E.status ? txt(r[E.status]) : '', cotacaoSim: E.cotacao ? marcadoV(r[E.cotacao]) : false, palletSim: E.pallet ? marcadoV(r[E.pallet]) : false };
  if (c.palletSim) return { ok: true, ja: true, carga: id, entidade: E.entidade, coluna: E.pallet };
  if (faseCarga(c) !== 'cotado') {
    throw erroStatus('A carga ' + id + ' não está "Carregado" com a cotação realizada (status: ' + (c.status || '—') + ', cotação realizada: ' +
      (E.cotacao ? simNaoV(r[E.cotacao]) : 'coluna não encontrada') + ').', 409);
  }
  // o valor no formato da coluna: enum NoYes ("Yes"), booleano ou número
  const atual = E.pallet ? r[E.pallet] : null;
  const valor = typeof atual === 'boolean' ? true : typeof atual === 'number' ? 1 : 'Yes';
  const gravar = (Ent, dataArea) => {
    const chave = (Ent.temEmpresa ? "dataAreaId='" + D.odataStr(dataArea || EMPRESA) + "'," : '') + Ent.numero + "='" + D.odataStr(id) + "'";
    const corpo = {}; corpo[Ent.pallet] = valor;
    return D.odataEnviar('PATCH', Ent.entidade + '(' + chave + ')?cross-company=true', corpo, token, 20000);
  };
  // onde gravar: a entidade da carga (se tiver o campo); depois as outras que
  // servem com o campo; depois a WHSOutboundLoadHeaderEntity (a BI costuma ser
  // SÓ LEITURA)
  const alvos = [E].concat(lista.filter(L => L !== E)).filter(L => L.pallet);
  const ja = (n) => alvos.some(L => L.entidade.toLowerCase() === n.toLowerCase());
  const erros = [];
  let usada = null;
  for (let k = 0; !usada; k++) {
    if (k >= alvos.length) {
      // sem mais alvos conhecidos: sonda a de cabeçalho (só uma vez)
      if (alvos._sondou) break;
      alvos._sondou = true;
      for (const nome of ENT_CARGA_CAB.filter(n => !ja(n))) {
        if (restante(ate) < FOLGA_MS + 3000) break;
        const sd = await sondarExtra(CFG_CARGA, nome, token, ate).catch(() => null);
        if (sd && sd.serve && sd.pallet) { alvos.push(sd); break; }
      }
      if (k >= alvos.length) break;
    }
    const Ent = alvos[k];
    try { await gravar(Ent, txt(r.dataAreaId)); usada = Ent; }
    catch (e) { erros.push({ ent: Ent.entidade, e }); }
  }
  if (!usada) {
    if (!erros.length) throw erroStatus('Não achei a coluna ' + COL_CARGA.pallet[0] + ' nas entidades de cargas (' + lista.map(L => L.entidade).join(', ') + '): fixe o nome em KANBAN_COL_CARGA_PALLET.', 409);
    const ult = erros[erros.length - 1].e;
    if (erros.length > 1) ult.message = erros.map(x2 => 'na ' + x2.ent + ': ' + String(x2.e.message).slice(0, 160)).join(' · ');
    throw ult;
  }
  _cache.clear();   // a próxima leitura do quadro já vem com a carga no Pallet
  // 11/11/26 (dono: "mandei para o pallet porém ele não atualizou"): relê a carga
  // na entidade de onde o QUADRO a lê (E) e confere se ela já mostra Sim — se não,
  // a tela diz onde gravou e o que a leitura mostra, em vez de esperar à toa
  const conf = await conferirPallet(E, usada, id, token, ate);
  return Object.assign({ ok: true, carga: id, entidade: usada.entidade, coluna: usada.pallet, valor }, conf);
}
async function conferirPallet(E, usada, id, token, ate) {
  const leitura = { entidade: E.entidade, coluna: E.pallet || null, valor: null };
  const mesma = usada.entidade === E.entidade;
  const gravou = 'O Dynamics aceitou a gravação na ' + usada.entidade;
  if (!E.pallet) {
    return { confirmado: false, leitura, aviso: gravou + ', mas o quadro lê a carga ' + id + ' na ' + E.entidade + ', que não tem o campo ' + COL_CARGA.pallet[0] +
      ': o cartão não vai para o Pallet. Fixe a entidade das cargas em KANBAN_ENT_CARGA.' };
  }
  const releitura = mesma ? 'a releitura' : 'a releitura na ' + E.entidade + ' (de onde o quadro lê a carga)';
  try {
    const rows = await D.odataGetComPrazo(E.entidade, { crossCompany: true, top: 2,
      filter: (E.temEmpresa ? "dataAreaId eq '" + D.odataStr(EMPRESA) + "' and " : '') + E.numero + " eq '" + D.odataStr(id) + "'" }, token, prazo(ate, 8000));
    if (!rows.length) return { confirmado: null, leitura, aviso: gravou + ', mas ' + releitura + ' não achou a carga ' + id + ' para conferir.' };
    const v = rows[0][E.pallet];
    leitura.valor = v == null ? null : txt(v);
    if (marcadoV(v)) return { confirmado: true, leitura };
    return { confirmado: false, leitura, aviso: gravou + ', mas ' + releitura + ' ainda mostra ' + E.pallet + ' = "' + simNaoV(v) +
      '": o cartão não vai para o Pallet. Confira a carga ' + id + ' no Dynamics.' };
  } catch (e) {
    return { confirmado: null, leitura, aviso: gravou + ', mas ' + releitura + ' falhou (' + String(e.message || e).slice(0, 120) + ').' };
  }
}

function _limparCache() { _cache.clear(); _cacheLinhas.clear(); _ents = null; _entsTs = 0; _servico = null; _servicoTs = 0; _entLinhas = null; Object.keys(_extras).forEach(k => { delete _extras[k]; }); ST_NOTA._limparCache(); _colsLinhas = null; }

module.exports = { ordensDoDia, quadro, linhasDaOv, enviarParaPallet, operacoesDasOvs, hojeSP, EMPRESA, CONFIGURED: D.CONFIGURED, ETAPAS, _limparCache, _interno: { diaDe, RE_STATUS, RE_NAO_STATUS, etapaDe } };
