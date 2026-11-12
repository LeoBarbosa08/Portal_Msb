// ================================================================
// scripts/test-faturamento-dia.js — testes do motor do Faturamento do Dia
// (api/shared/faturamento-dia.js) contra um F&O SIMULADO (fetch falso).
//
//   node scripts/test-faturamento-dia.js
//
// Cobre: venda/devolução pela FiscalDocuments (compra de fornecedor e nota
// cancelada fora da soma), a queda para o diário quando a fiscal vem vazia
// (o caso de 2023), o 400 da data-hora (coluna Edm.Date), o "é cliente?"
// pelo cadastro quando a fiscal não traz o tipo da conta e só a MSB no filtro.
// ================================================================

process.env.D365_TENANT_ID = 't'; process.env.D365_CLIENT_ID = 'c'; process.env.D365_CLIENT_SECRET = 's';
process.env.D365_RESOURCE_URL = 'https://fo.teste';

let falhas = 0;
function t(nome, ok, extra) { console.log((ok ? '  ok  ' : '  FALHOU ') + nome + (ok || extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); if (!ok) falhas++; }

// ── cenário do F&O falso ─────────────────────────────────────────
let CEN = {};
const chamadas = [];
const corpo = (j, st) => ({ ok: (st || 200) < 400, status: st || 200, text: async () => JSON.stringify(j) });
global.fetch = async (url) => {
  url = String(url);
  if (/login\.microsoftonline/.test(url)) return corpo({ access_token: 'tok', expires_in: 3600 });
  const u = new URL(url);
  const ent = u.pathname.replace('/data/', '');
  const q = { filter: u.searchParams.get('$filter') || '', top: u.searchParams.get('$top'), orderby: u.searchParams.get('$orderby'), select: u.searchParams.get('$select') };
  chamadas.push({ ent, q });
  const E = CEN[ent];
  if (!E) return corpo({ error: { message: 'not found' } }, 404);
  if (q.orderby) return corpo({ value: E.ultima ? [{ [E.colData]: E.ultima }] : [] });
  if (q.top === '1') return corpo({ value: E.amostra ? [E.amostra] : [] });
  if (E.so400DataHora && /T00:00:00Z/.test(q.filter)) return corpo({ error: { innererror: { message: 'type mismatch Edm.Date' } } }, 400);
  if (E.porConta) {   // cadastro de clientes: devolve só as contas pedidas
    const pedidas = (q.filter.match(/'([^']+)'/g) || []).map(s => s.slice(1, -1));
    return corpo({ value: E.linhas.filter(r => pedidas.indexOf(r.CustomerAccount) >= 0) });
  }
  // busca por número de nota (o painel da nota: ?nota=)
  if (E.doDia && / ge /.test(q.filter)) return corpo({ value: E.doDia });   // a leitura do dia
  const nums = [...q.filter.matchAll(/(InvoiceNumber|FiscalDocumentNumber) eq '([^']+)'/g)];
  if (nums.length && E.porNumero) return corpo({ value: (E.linhas || []).filter(r => nums.some(m => r[m[1]] === m[2])) });
  return corpo({ value: E.linhas || [] });
};

const FD = require('../api/shared/faturamento-dia');
const DIA = '2026-11-06';
const fd = (o) => Object.assign({ dataAreaId: 'msb', FiscalDocumentDate: DIA + 'T00:00:00Z', FiscalDocumentSeries: '1', AccessKey: '', Status: 'Approved', ThirdPartyName: '' }, o);
const AMOSTRA_FISCAL = fd({ FiscalDocumentNumber: '000000001', Direction: 'Outgoing', FiscalDocumentAccountType: 'Cust', FiscalDocumentAccountNum: 'C1', TotalAmount: 1 });
const DIARIO = (linhas) => ({ amostra: { dataAreaId: 'msb', InvoiceNumber: 'X', InvoiceDate: DIA + 'T00:00:00Z', InvoiceCustomerAccountNumber: 'C1', TotalInvoiceAmount: 1, SalesOrderNumber: 'OV1', CurrencyCode: 'BRL' }, linhas: linhas || [] });
const CLIENTES = { porConta: true, amostra: { dataAreaId: 'msb', CustomerAccount: 'C1', OrganizationName: 'X', BrazilianCNPJOrCPF: '1' },
  linhas: [{ dataAreaId: 'msb', CustomerAccount: 'C1', OrganizationName: 'HOSPITAL UM', BrazilianCNPJOrCPF: '11' },
           { dataAreaId: 'msb', CustomerAccount: 'C2', OrganizationName: 'CLINICA DOIS', BrazilianCNPJOrCPF: '22' }] };

(async () => {
  console.log('1) FiscalDocuments com venda, devolução, compra e cancelada');
  FD._limparCache(); chamadas.length = 0;
  CEN = {
    FiscalDocuments: { amostra: AMOSTRA_FISCAL, linhas: [
      fd({ FiscalDocumentNumber: '000011774', Direction: 'Outgoing', FiscalDocumentAccountType: 'Cust', FiscalDocumentAccountNum: 'C1', TotalAmount: 1000, ThirdPartyName: 'HOSPITAL UM' }),
      fd({ FiscalDocumentNumber: '000011775', Direction: 'Outgoing', FiscalDocumentAccountType: 'Cust', FiscalDocumentAccountNum: 'C2', TotalAmount: 500.5 }),
      fd({ FiscalDocumentNumber: '000000310', Direction: 'Incoming', FiscalDocumentAccountType: 'Cust', FiscalDocumentAccountNum: 'C2', TotalAmount: 200 }),
      fd({ FiscalDocumentNumber: '000099999', Direction: 'Incoming', FiscalDocumentAccountType: 'Vend', FiscalDocumentAccountNum: 'F9', TotalAmount: 9999 }),
      fd({ FiscalDocumentNumber: '000011776', Direction: 'Outgoing', FiscalDocumentAccountType: 'Cust', FiscalDocumentAccountNum: 'C1', TotalAmount: 300, Status: 'Canceled' }),
      fd({ FiscalDocumentNumber: '000011700', Direction: 'Outgoing', FiscalDocumentAccountType: 'Cust', FiscalDocumentAccountNum: 'C1', TotalAmount: 7, FiscalDocumentDate: '2026-11-05T00:00:00Z' })
    ] },
    SalesInvoiceHeadersV2: DIARIO([{ InvoiceNumber: '000011774', InvoiceDate: DIA + 'T00:00:00Z', InvoiceCustomerAccountNumber: 'C1', TotalInvoiceAmount: 1000 }]),
    CustomersV3: CLIENTES
  };
  let r = await FD.notasDoDia({ data: DIA });
  t('fonte = FiscalDocuments', r.fonte && r.fonte.entidade === 'FiscalDocuments', r.fonte);
  t('2 vendas válidas = 1.500,50', r.resumo.venda.qtd === 2 && r.resumo.venda.valor === 1500.5, r.resumo.venda);
  t('1 devolução = 200', r.resumo.devolucao.qtd === 1 && r.resumo.devolucao.valor === 200, r.resumo.devolucao);
  t('líquido = 1.300,50', r.resumo.liquido === 1300.5, r.resumo.liquido);
  t('cancelada listada e fora da soma', r.resumo.canceladas === 1 && r.notas.some(n => n.numero === '000011776' && n.cancelada));
  t('compra de fornecedor fora', !r.notas.some(n => n.numero === '000099999') && r.foraDaConta.fornecedor === 1, r.foraDaConta);
  t('nota de outro dia descartada', !r.notas.some(n => n.numero === '000011700'));
  t('nome vem do cadastro quando a fiscal não traz', (r.notas.find(n => n.numero === '000011775') || {}).cliente === 'CLINICA DOIS', r.notas);
  t('toda leitura filtra a MSB', chamadas.filter(c => c.q.filter && !/^\(/.test(c.q.filter)).every(c => /dataAreaId eq 'msb'/.test(c.q.filter)), chamadas.map(c => c.q.filter));
  t('conferência pelo diário', r.conferencia && r.conferencia.entidade === 'SalesInvoiceHeadersV2' && r.conferencia.venda.qtd === 1, r.conferencia);
  t('ordem: número maior primeiro', r.notas[0].numero === '000011776', r.notas.map(n => n.numero));

  console.log('2) FiscalDocuments vazia, diário com notas (o caso de 2023)');
  FD._limparCache(); chamadas.length = 0;
  CEN.FiscalDocuments = { amostra: AMOSTRA_FISCAL, linhas: [], ultima: '2023-12-05T00:00:00Z', colData: 'FiscalDocumentDate' };
  CEN.SalesInvoiceHeadersV2 = DIARIO([
    { InvoiceNumber: '000011774', InvoiceDate: DIA + 'T00:00:00Z', InvoiceCustomerAccountNumber: 'C1', TotalInvoiceAmount: 1000, SalesOrderNumber: 'OV017456' },
    { InvoiceNumber: '000011780', InvoiceDate: DIA + 'T00:00:00Z', InvoiceCustomerAccountNumber: 'C2', TotalInvoiceAmount: -150 }
  ]);
  r = await FD.notasDoDia({ data: DIA });
  t('fonte = diário', r.fonte && r.fonte.papel === 'diario', r.fonte);
  t('aviso diz a última nota (05/12/2023)', r.avisos.some(a => /05\/12\/2023/.test(a)), r.avisos);
  t('valor negativo = devolução', r.resumo.devolucao.qtd === 1 && r.resumo.devolucao.valor === 150, r.resumo);
  t('venda 1.000', r.resumo.venda.valor === 1000, r.resumo.venda);
  t('razão social pelo cadastro', r.notas.find(n => n.numero === '000011774').cliente === 'HOSPITAL UM');

  console.log('2b) tipo de operação pela OV (o diário não tem) — 09/11/2026');
  const K = require('../api/shared/kanban-ov');
  FD._limparCache(); K._limparCache(); chamadas.length = 0;
  // AFiscalOperationType = 'DoesNotApply' (o que saía na tela do dono): não é operação, cede para a real
  // + FiscalDocumentOperationTypeId (o campo que o dono achou na ficha da OV): ele VENCE as outras
  CEN.BIOSalesOrderHeaderV1 = { amostra: { dataAreaId: 'msb', SalesOrderNumber: 'OV1', AFiscalOperationType: 'DoesNotApply', SalesPurchOperationType_BR: 'VENDA', FiscalDocumentOperationTypeId: 'S.LIC.001', SalesStatus: 'Invoiced', CreatedDateTime: '2026-11-06T10:00:00Z' },
    linhas: [{ dataAreaId: 'msb', SalesOrderNumber: 'OV017456', AFiscalOperationType: 'DoesNotApply', SalesPurchOperationType_BR: 'VENDA', FiscalDocumentOperationTypeId: 'S.LIC.002' }] };
  r = await FD.notasDoDia({ data: DIA });
  let nOv = r.notas.find(x => x.numero === '000011774');
  t('operação vem da OV: o FiscalDocumentOperationTypeId', nOv.operacao === 'S.LIC.002' && /^OV · BIOSalesOrderHeaderV1\.FiscalDocumentOperationTypeId$/.test(nOv.operacaoFonte), nOv);
  t('nota sem OV: sem tipo de operação, fora da soma', !r.notas.find(x => x.numero === '000011780') && r.foraOperacao.some(x => x.numero === '000011780' && x.operacao === '(sem tipo de operação)' && x.valor === -150), r.foraOperacao);
  t('S.LIC.002 é aceito: venda 1.000, sem devolução', r.resumo.venda.valor === 1000 && r.resumo.devolucao.qtd === 0 && r.filtroOperacao.aplicado, r.resumo);
  t('operacaoOv no diagnóstico', r.operacaoOv && r.operacaoOv.achadas === 1, r.operacaoOv);
  t('"DoesNotApply" não vira operação', !r.notas.some(x => /DoesNotApply/i.test(x.operacao || '')), r.notas.map(x => x.operacao));
  t('leu a OV pelo número, só a MSB', chamadas.some(c => c.ent === 'BIOSalesOrderHeaderV1' && /SalesOrderNumber eq 'OV017456'/.test(c.q.filter) && /dataAreaId eq 'msb'/.test(c.q.filter)));

  console.log('2c) o diário com a operação na própria nota: não vai à OV');
  FD._limparCache(); K._limparCache(); chamadas.length = 0;
  CEN.SalesInvoiceHeadersV2 = { amostra: { dataAreaId: 'msb', InvoiceNumber: 'X', InvoiceDate: DIA + 'T00:00:00Z', InvoiceCustomerAccountNumber: 'C1', TotalInvoiceAmount: 1, SalesOrderNumber: 'OV1', CurrencyCode: 'BRL', OperationDescription: 'Venda' },
    linhas: [{ InvoiceNumber: '000011790', InvoiceDate: DIA + 'T00:00:00Z', InvoiceCustomerAccountNumber: 'C1', TotalInvoiceAmount: 500, SalesOrderNumber: 'OV017456', OperationDescription: 'Venda de produção do estabelecimento' }] };
  r = await FD.notasDoDia({ data: DIA });
  nOv = r.foraOperacao.find(x => x.numero === '000011790');
  t('operação da própria nota (fora da lista aceita: fica fora)', nOv && nOv.operacao === 'Venda de produção do estabelecimento' && !r.notas.length, r.foraOperacao);
  t('não consultou a OV', !chamadas.some(c => c.ent === 'BIOSalesOrderHeaderV1'), chamadas.map(c => c.ent));
  delete CEN.BIOSalesOrderHeaderV1;

  console.log('3) as duas vazias: diz a última nota da fiscal');
  FD._limparCache();
  CEN.FiscalDocuments = { amostra: AMOSTRA_FISCAL, linhas: [], ultima: '2026-11-05T00:00:00Z', colData: 'FiscalDocumentDate' };
  CEN.SalesInvoiceHeadersV2 = DIARIO([]);
  r = await FD.notasDoDia({ data: DIA });
  t('0 notas, fonte fiscal, última = 05/11', r.notas.length === 0 && r.fonte.papel === 'fiscal' && r.ultimaFiscal === '2026-11-05', r);

  console.log('4) coluna de data Edm.Date (400 na data-hora) e sem tipo de conta');
  FD._limparCache(); chamadas.length = 0;
  const semTipo = (o) => { const x = fd(o); return x; };
  const amostra = Object.assign({}, AMOSTRA_FISCAL); delete amostra.FiscalDocumentAccountType;
  CEN.FiscalDocuments = { so400DataHora: true, amostra, linhas: [
    semTipo({ FiscalDocumentNumber: '000000311', Direction: 'Incoming', FiscalDocumentAccountNum: 'C1', TotalAmount: 80 }),   // cliente: devolução
    semTipo({ FiscalDocumentNumber: '000000777', Direction: 'Incoming', FiscalDocumentAccountNum: 'F1', TotalAmount: 5000 }), // não é cliente: compra
    semTipo({ FiscalDocumentNumber: '000011790', Direction: 'Outgoing', FiscalDocumentAccountNum: 'C2', TotalAmount: 120 })
  ].map(x => { delete x.FiscalDocumentAccountType; return x; }) };
  CEN.SalesInvoiceHeadersV2 = DIARIO([]);
  r = await FD.notasDoDia({ data: DIA });
  const dias = chamadas.filter(c => c.ent === 'FiscalDocuments' && /ge /.test(c.q.filter));
  t('tentou data-hora e caiu na data', dias.length === 2 && /T00:00:00Z/.test(dias[0].q.filter) && !/T00/.test(dias[1].q.filter), dias.map(d => d.q.filter));
  t('entrada de cliente = devolução', r.notas.some(n => n.numero === '000000311' && n.tipo === 'devolucao'), r.notas);
  t('entrada de não-cliente = compra, fora', !r.notas.some(n => n.numero === '000000777') && r.foraDaConta.fornecedor === 1, r.foraDaConta);
  t('venda 120', r.resumo.venda.valor === 120, r.resumo);

  console.log('5) rota: a área Comercial (09/11/2026: liberado para todo mundo do Comercial); a sonda só do dono');
  FD._limparCache();
  const auth = require('../api/shared/auth');
  const fn = require('../api/faturamento-hoje/index.js');
  const origArea = auth.requireArea, origUser = auth.requireUser;
  // temArea: a pessoa tem a área Comercial? (requireArea simulado)
  const chama = async (email, temArea, query) => {
    let pediu = null;
    auth.requireArea = async (req, area) => { pediu = area; if (!temArea) { const e = new Error('forbidden'); e.status = 403; throw e; } return { user: { email }, validated: true }; };
    auth.requireUser = async () => ({ user: { email }, validated: true });
    const ctx = { log: { error() {} } }; await fn(ctx, { method: 'GET', headers: {}, query: query || {} });
    ctx.res.pediu = pediu; return ctx.res;
  };
  let res = await chama('fulano@biomedical.com.br', false);
  t('sem a área Comercial -> 403 (e pediu a área comercial)', res.status === 403 && res.pediu === 'comercial', res.status);
  res = await chama('fulano@biomedical.com.br', true, { data: '06/11/2026' });
  t('data inválida -> 400', res.status === 400, res.status);
  res = await chama('fulano@biomedical.com.br', true, { data: DIA });
  t('qualquer um do Comercial -> 200 com notas', res.status === 200 && res.body.ok && Array.isArray(res.body.notas), res.status);
  res = await chama('fulano@biomedical.com.br', true, { sondar: '1' });
  t('sonda: do Comercial mas não é o dono -> 403', res.status === 403, res.status);
  auth.requireArea = origArea; auth.requireUser = origUser;

  console.log('6) o dado cru de uma nota (?nota=) — o caso da 000021098');
  FD._limparCache(); chamadas.length = 0;
  CEN = {
    FiscalDocuments: { amostra: AMOSTRA_FISCAL, linhas: [], porNumero: true },
    SalesInvoiceHeadersV2: Object.assign(DIARIO([
      { dataAreaId: 'msb', InvoiceNumber: '000021098', InvoiceDate: '2026-09-30T00:00:00Z', InvoiceCustomerAccountNumber: 'C006154', TotalInvoiceAmount: -5999.40, SalesOrderNumber: 'OV016900' },
      { dataAreaId: 'msb', InvoiceNumber: '000021099', InvoiceDate: '2026-09-30T00:00:00Z', InvoiceCustomerAccountNumber: 'C1', TotalInvoiceAmount: 10 }
    ]), { porNumero: true }),
    SalesInvoiceLines: { porNumero: true, linhas: [{ dataAreaId: 'msb', InvoiceNumber: '000021098', ItemNumber: 'X', InvoicedQuantity: 300, SalesPrice: 60, LineAmount: 18000 }] }
  };
  const d = await FD.detalheNota('000021098');
  t('diário: só os registros desse número, crus', d.diario && d.diario.entidade === 'SalesInvoiceHeadersV2' && d.diario.linhas.length === 1 && d.diario.linhas[0].TotalInvoiceAmount === -5999.40, d.diario);
  t('linhas da fatura, cruas', d.linhasFatura && d.linhasFatura.entidade === 'SalesInvoiceLines' && d.linhasFatura.linhas[0].LineAmount === 18000, d.linhasFatura);
  t('documento fiscal: nenhum registro', d.fiscal && d.fiscal.linhas.length === 0, d.fiscal);
  t('toda busca filtra a MSB', chamadas.filter(c => /'000021098'/.test(c.q.filter)).every(c => /dataAreaId eq 'msb'/.test(c.q.filter)), chamadas.map(c => c.q.filter));
  {
    const auth = require('../api/shared/auth');
    const fn = require('../api/faturamento-hoje/index.js');
    const origArea = auth.requireArea;
    const chama = async (temArea, query) => { auth.requireArea = async () => { if (!temArea) { const e = new Error('forbidden'); e.status = 403; throw e; } return {}; }; const ctx = { log: { error() {} } }; await fn(ctx, { method: 'GET', headers: {}, query }); return ctx.res; };
    let res = await chama(false, { nota: '000021098' });
    t('nota: sem a área Comercial -> 403', res.status === 403, res.status);
    res = await chama(true, { nota: "x' or 1 eq 1" });
    t('nota: número inválido -> 400', res.status === 400, res.status);
    res = await chama(true, { nota: '000021098' });
    t('nota: do Comercial -> 200 com o diário', res.status === 200 && res.body.diario && res.body.diario.linhas.length === 1, res.status);
    res = await chama(true, { nota: '000021098', data: '06/11/2026' });
    t('nota: data inválida -> 400', res.status === 400, res.status);
    auth.requireArea = origArea;
  }

  console.log('6b) a ficha da nota: cabeçalho, itens, tipo de venda da OV e cliente (12/11/2026)');
  FD._limparCache(); require('../api/shared/kanban-ov')._limparCache(); chamadas.length = 0;
  const cab524 = (o) => Object.assign({ dataAreaId: 'msb', InvoiceNumber: '000021524', InvoiceCustomerAccountNumber: 'C1', SalesOrderNumber: 'OV017550', CurrencyCode: 'BRL',
    TotalChargeAmount: 0, TotalDiscountAmount: 0, TotalTaxAmount: 0, PaymentTermsName: 'CR 30', DeliveryTermsCode: 'PADRÃO', LedgerVoucher: 'MSB-10013756',
    SalesOrderResponsiblePersonnelNumber: '00154', InvoiceAddressCity: 'Guarulhos', InvoiceAddressState: 'SP', InvoiceAddressStreet: 'Rua X', InvoiceAddressStreetNumber: '736',
    InvoiceAddressZipCode: '07020001', InvoiceAddressCountryRegionISOCode: 'BR' }, o);
  const lin524 = (o) => Object.assign({ dataAreaId: 'msb', InvoiceNumber: '000021524', CurrencyCode: 'BRL', SalesUnitSymbol: 'UN', ItemNumber: '' }, o);
  CEN = {
    FiscalDocuments: { amostra: AMOSTRA_FISCAL, linhas: [], porNumero: true },
    SalesInvoiceHeadersV2: Object.assign(DIARIO([
      cab524({ InvoiceDate: '2026-11-12T12:00:00Z', TotalInvoiceAmount: 28000 }),
      cab524({ InvoiceDate: '2026-10-01T12:00:00Z', TotalInvoiceAmount: -999, SalesOrderNumber: 'OV000001' })   // registro repetido mais antigo
    ]), { porNumero: true }),
    SalesInvoiceLines: { porNumero: true, linhas: [
      lin524({ InvoiceDate: '2026-11-12T12:00:00Z', LineCreationSequenceNumber: 2, ProductNumber: '51204', ProductName: 'KIT B', InvoicedQuantity: 50, SalesPrice: 160, LineAmount: 8000, LineTotalDiscountAmount: 0 }),
      lin524({ InvoiceDate: '2026-11-12T12:00:00Z', LineCreationSequenceNumber: 1, ProductNumber: '51203', ProductName: 'KIT A', LineDescription: 'KIT A 30ML', InvoicedQuantity: 250, SalesPrice: 80, LineAmount: 20000, LineTotalDiscountAmount: 0 }),
      lin524({ InvoiceDate: '2026-10-01T12:00:00Z', LineCreationSequenceNumber: 1, ProductNumber: '99999', ProductName: 'DO OUTRO REGISTRO', InvoicedQuantity: -1, SalesPrice: 999, LineAmount: -999 })
    ] },
    BIOSalesOrderHeaderV1: { amostra: { dataAreaId: 'msb', SalesOrderNumber: 'OV0', FiscalDocumentOperationTypeId: 'S.VEN.006', SalesPurchOperationType_BR: 'VENDA', CreatedDateTime: '2026-11-06T10:00:00Z' },
      linhas: [{ dataAreaId: 'msb', SalesOrderNumber: 'OV017550', FiscalDocumentOperationTypeId: 'S.VEN.006', SalesPurchOperationType_BR: 'VENDA' }] },
    CustomersV3: CLIENTES
  };
  const f = await FD.detalheNota('000021524', { data: '2026-11-12' });
  t('cabeçalho do dia pedido (não o registro mais antigo)', f.nota && f.nota.valor === 28000 && f.nota.data === '2026-11-12' && f.nota.ordem === 'OV017550' && f.nota.registros === 2, f.nota);
  t('cabeçalho limpo: pagamento, entrega, responsável, lançamento, endereço', f.nota.pagamento === 'CR 30' && f.nota.entrega === 'PADRÃO' && f.nota.responsavel === '00154'
    && f.nota.lancamento === 'MSB-10013756' && f.nota.endereco.cidade === 'Guarulhos' && f.nota.endereco.uf === 'SP' && f.nota.endereco.cep === '07020001', f.nota);
  t('itens: só os do registro do dia, na ordem da linha', f.itens && f.itens.length === 2 && f.itens[0].codigo === '51203' && f.itens[1].codigo === '51204', f.itens);
  t('item: código (ItemNumber vazio cede ao ProductNumber), produto, qtd × preço, valor, un', f.itens[0].produto === 'KIT A' && f.itens[0].descricao === 'KIT A 30ML'
    && f.itens[0].qtd === 250 && f.itens[0].preco === 80 && f.itens[0].valor === 20000 && f.itens[0].un === 'UN' && f.itens[1].descricao === '', f.itens[0]);
  t('tipo de operação e tipo de venda da OV', f.operacao && f.operacao.valor === 'S.VEN.006' && Object.keys(f.operacao.todos).some(k => /SalesPurchOperationType_BR$/.test(k) && f.operacao.todos[k] === 'VENDA'), f.operacao);
  t('cliente pelo cadastro', f.cliente && f.cliente.nome === 'HOSPITAL UM' && f.cliente.cnpj === '11', f.cliente);
  t('o cru continua na resposta', f.diario.linhas.length === 2 && f.linhasFatura.linhas.length === 3, f.diario);
  const f2 = await FD.detalheNota('000021524');
  t('sem data: vale o registro 1 (o mais antigo)', f2.nota && f2.nota.valor === -999 && f2.itens.length === 1 && f2.itens[0].codigo === '99999', f2.nota);

  console.log('7) número repetido no diário: vale o registro 1 (o caso da 000021098)');
  const orig98 = { dataAreaId: 'msb', InvoiceNumber: '000021098', InvoiceDate: '2026-10-07T12:00:00Z', InvoiceCustomerAccountNumber: 'C006154', TotalInvoiceAmount: 18000, SalesOrderNumber: 'OV017088' };
  const dup98  = { dataAreaId: 'msb', InvoiceNumber: '000021098', InvoiceDate: DIA + 'T12:00:00Z', InvoiceCustomerAccountNumber: 'C006154', TotalInvoiceAmount: -5999.40, SalesOrderNumber: 'OV017540' };
  const n470   = { dataAreaId: 'msb', InvoiceNumber: '000021470', InvoiceDate: DIA + 'T12:00:00Z', InvoiceCustomerAccountNumber: 'C1', TotalInvoiceAmount: 2231.10, SalesOrderNumber: 'OV017512' };
  FD._limparCache(); require('../api/shared/kanban-ov')._limparCache(); chamadas.length = 0;
  CEN = {
    FiscalDocuments: { amostra: AMOSTRA_FISCAL, linhas: [], ultima: '2023-12-05T00:00:00Z', colData: 'FiscalDocumentDate' },
    SalesInvoiceHeadersV2: Object.assign(DIARIO([orig98, dup98, n470]), { porNumero: true, doDia: [dup98, n470] }),
    CustomersV3: CLIENTES
  };
  r = await FD.notasDoDia({ data: DIA });
  t('o −5.999,40 (registro 2) sai da lista', !r.notas.some(n => n.numero === '000021098'), r.notas.map(n => n.numero + ' ' + n.valor));
  t('e da soma: só a 000021470', r.resumo.venda.qtd === 1 && r.resumo.venda.valor === 2231.10 && r.resumo.devolucao.qtd === 0, r.resumo);
  t('repetidas traz o original ao lado', r.repetidas.length === 1 && r.repetidas[0].valor === -5999.40 && r.repetidas[0].original.valor === 18000 && r.repetidas[0].original.data === '2026-10-07', r.repetidas);
  t('aviso diz qual ficou fora e o original', r.avisos.some(a => /000021098 de 06\/11\/2026/.test(a) && /original é de 07\/10\/2026/.test(a)), r.avisos);
  t('buscou todos os registros do número, só a MSB', chamadas.some(c => c.ent === 'SalesInvoiceHeadersV2' && /InvoiceNumber eq '000021098'/.test(c.q.filter) && /dataAreaId eq 'msb'/.test(c.q.filter) && !/ ge /.test(c.q.filter)));

  FD._limparCache(); chamadas.length = 0;
  CEN.SalesInvoiceHeadersV2 = Object.assign(DIARIO([orig98, dup98, n470]), { porNumero: true, doDia: [orig98] });
  r = await FD.notasDoDia({ data: '2026-10-07' });
  t('em 07/10 a venda original (R$ 18.000) fica', r.notas.length === 1 && r.notas[0].numero === '000021098' && r.notas[0].valor === 18000 && r.notas[0].tipo === 'venda' && r.repetidas.length === 0, r.notas);

  console.log('8) só os tipos de operação aceitos (S.VEN.006, E.CON.002, S.CON.004, S.LIC.002, E.VEN.002)');
  const K8 = require('../api/shared/kanban-ov');
  const jl8 = (n, ov, v) => ({ dataAreaId: 'msb', InvoiceNumber: n, InvoiceDate: DIA + 'T12:00:00Z', InvoiceCustomerAccountNumber: 'C1', TotalInvoiceAmount: v, SalesOrderNumber: ov });
  const ov8 = (n, op) => ({ dataAreaId: 'msb', SalesOrderNumber: n, FiscalDocumentOperationTypeId: op, FiscalOperationPresenceType: 'DoesNotApply' });
  FD._limparCache(); K8._limparCache(); chamadas.length = 0;
  CEN = {
    FiscalDocuments: { amostra: AMOSTRA_FISCAL, linhas: [], ultima: '2023-12-05T00:00:00Z', colData: 'FiscalDocumentDate' },
    SalesInvoiceHeadersV2: Object.assign(DIARIO([jl8('000021500', 'OV1', 1000), jl8('000021501', 'OV2', -150), jl8('000021502', 'OV3', 500), jl8('000021503', 'OV4', 300), jl8('000021504', 'OV5', 200)]), { porNumero: true }),
    BIOSalesOrderHeaderV1: { amostra: ov8('OV0', 'S.VEN.006'), linhas: [ov8('OV1', 'S.VEN.006'), ov8('OV2', 'e.ven.002'), ov8('OV3', 'S.REM.001'), ov8('OV5', 'S.LIC.002')] },
    CustomersV3: CLIENTES
  };
  r = await FD.notasDoDia({ data: DIA });
  t('S.VEN.006 e S.LIC.002 contam como venda', r.resumo.venda.qtd === 2 && r.resumo.venda.valor === 1200, r.resumo.venda);
  t('E.VEN.002 conta como devolução (maiúscula/minúscula tanto faz)', r.resumo.devolucao.qtd === 1 && r.resumo.devolucao.valor === 150, r.resumo.devolucao);
  t('líquido = 1.050', r.resumo.liquido === 1050, r.resumo.liquido);
  t('S.REM.001 fica fora', r.foraOperacao.some(x => x.numero === '000021502' && x.operacao === 'S.REM.001' && x.valor === 500), r.foraOperacao);
  t('OV sem tipo fica fora como "(sem tipo de operação)"', r.foraOperacao.some(x => x.numero === '000021503' && x.operacao === '(sem tipo de operação)'), r.foraOperacao);
  t('aviso com os tipos que ficaram fora', r.avisos.some(a => /2 nota\(s\) fora do faturamento pelo tipo de operação/.test(a) && /S\.REM\.001 \(1\)/.test(a)), r.avisos);
  t('filtro aplicado', r.filtroOperacao && r.filtroOperacao.aplicado === true && r.filtroOperacao.fora === 2, r.filtroOperacao);

  console.log('8b) a leitura dos tipos falha: NÃO filtra e avisa (não zera)');
  FD._limparCache(); K8._limparCache(); chamadas.length = 0;
  delete CEN.BIOSalesOrderHeaderV1;   // nenhuma entidade de OV responde
  r = await FD.notasDoDia({ data: DIA });
  t('sem tipos lidos, todas as notas ficam', r.notas.length === 5 && r.resumo.liquido === 1850, r.resumo);
  t('aviso em destaque: filtro NÃO aplicado', /NÃO foi aplicado/.test(r.avisos[0]) && r.filtroOperacao && r.filtroOperacao.aplicado === false, r.avisos);

  console.log('9) só nota com status Aprovado (o caso da 000021478 "Descartado")');
  const ST9 = require('../api/shared/fatdia-status');
  FD._limparCache(); K8._limparCache(); ST9._limparCache(); chamadas.length = 0;
  const ef = (n, st, dt) => ({ dataAreaId: 'msb', FiscalDocumentNumber: n, Status: st, FiscalDocumentDate: (dt || DIA) + 'T00:00:00Z' });
  CEN = {
    FiscalDocuments: { amostra: AMOSTRA_FISCAL, linhas: [], ultima: '2023-12-05T00:00:00Z', colData: 'FiscalDocumentDate' },
    SalesInvoiceHeadersV2: Object.assign(DIARIO([jl8('000021500', 'OV1', 1000), jl8('000021501', 'OV2', -150), jl8('000021478', 'OV1', 777), jl8('000021506', 'OV1', 333)]), { porNumero: true }),
    BIOSalesOrderHeaderV1: { amostra: ov8('OV0', 'S.VEN.006'), linhas: [ov8('OV1', 'S.VEN.006'), ov8('OV2', 'E.VEN.002')] },
    // + documentos ANTIGOS (2023) com os mesmos números: não podem emprestar o status
    EFDocumentsBR: { porNumero: true, amostra: ef('1', 'Approved'), linhas: [ef('000021500', 'Aprovado'), ef('000021501', 'Cancelled', '2023-05-02'), ef('000021501', 'Approved'), ef('000021478', 'Discarded'), ef('000021506', 'Cancelled', '2023-12-05')] },
    CustomersV3: CLIENTES
  };
  r = await FD.notasDoDia({ data: DIA });
  t('aprovadas ficam (Aprovado e Approved)', r.resumo.venda.qtd === 1 && r.resumo.venda.valor === 1000 && r.resumo.devolucao.valor === 150, r.resumo);
  t('000021478 "Discarded" fica fora', r.foraStatus.some(x => x.numero === '000021478' && x.status === 'Discarded' && x.valor === 777), r.foraStatus);
  t('nota sem status fica fora como "(sem status)" — o "Cancelled" de 2023 com o mesmo número não vale', r.foraStatus.some(x => x.numero === '000021506' && x.status === '(sem status)'), r.foraStatus);
  t('o "Cancelled" de 2023 da 000021501 não derruba a devolução aprovada de hoje', r.resumo.devolucao.qtd === 1, r.resumo);
  t('aviso com os status que ficaram fora', r.avisos.some(a => /2 nota\(s\) fora do faturamento por não estarem com status Aprovado/.test(a) && /Discarded \(1\)/.test(a)), r.avisos);
  t('filtro do status aplicado', r.filtroStatus && r.filtroStatus.aplicado === true && r.filtroStatus.fora === 2, r.filtroStatus);
  t('status buscado pelo número, só a MSB', chamadas.some(c => c.ent === 'EFDocumentsBR' && /FiscalDocumentNumber eq '000021478'/.test(c.q.filter) && /dataAreaId eq 'msb'/.test(c.q.filter)), chamadas.filter(c => c.ent === 'EFDocumentsBR').map(c => c.q.filter));

  console.log('9b) nenhuma entidade traz o status: NÃO filtra e avisa (não zera)');
  FD._limparCache(); K8._limparCache(); ST9._limparCache(); chamadas.length = 0;
  delete CEN.EFDocumentsBR;
  r = await FD.notasDoDia({ data: DIA });
  t('sem status lido, as notas da operação aceita ficam', r.notas.length === 4 && r.filtroStatus && r.filtroStatus.aplicado === false, r.notas.length);
  t('aviso em vermelho: filtro do status NÃO aplicado', r.avisos.some(a => /filtro "status Aprovado" NÃO foi aplicado/.test(a)), r.avisos);

  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\ntudo ok');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
