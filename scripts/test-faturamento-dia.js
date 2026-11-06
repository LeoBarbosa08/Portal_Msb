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

  console.log('5) rota: só o dono');
  FD._limparCache();
  const auth = require('../api/shared/auth');
  const fn = require('../api/faturamento-hoje/index.js');
  const orig = auth.requireUser;
  const chama = async (email, validated, query) => { auth.requireUser = async () => ({ user: { email }, validated }); const ctx = { log: { error() {} } }; await fn(ctx, { method: 'GET', headers: {}, query: query || {} }); return ctx.res; };
  let res = await chama('fulano@biomedical.com.br', true);
  t('outro e-mail -> 403', res.status === 403, res.status);
  res = await chama('ia@biomedical.com.br', false);
  t('token não validado -> 401', res.status === 401, res.status);
  res = await chama('ia@biomedical.com.br', true, { data: '06/11/2026' });
  t('data inválida -> 400', res.status === 400, res.status);
  res = await chama('IA@biomedical.com.br', true, { data: DIA });
  t('dono -> 200 com notas', res.status === 200 && res.body.ok && Array.isArray(res.body.notas), res.status);
  auth.requireUser = orig;

  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\ntudo ok');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
