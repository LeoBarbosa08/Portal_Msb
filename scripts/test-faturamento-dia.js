// ================================================================
// scripts/test-faturamento-dia.js — testes do motor do Faturamento do Dia
// (api/shared/faturamento-dia.js) contra um F&O SIMULADO (fetch falso).
//
//   node scripts/test-faturamento-dia.js
//
// Regra (dono, 06-07/11/2026): só contam as notas cujo OperationDescription
// é IGUAL a um item da lista (venda/devolução); qualquer outra, ou sem
// operação, fica fora da soma. Cobre também: nota cancelada, outro dia,
// nome pelo cadastro, só a MSB, o diário (operação buscada na fiscal pelo
// número), o 400 da data-hora e a rota só do dono.
// ================================================================

process.env.D365_TENANT_ID = 't'; process.env.D365_CLIENT_ID = 'c'; process.env.D365_CLIENT_SECRET = 's';
process.env.D365_RESOURCE_URL = 'https://fo.teste';

let falhas = 0;
function t(nome, ok, extra) { console.log((ok ? '  ok  ' : '  FALHOU ') + nome + (ok || extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); if (!ok) falhas++; }

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
  if (q.orderby) return corpo({ value: E.ultima ? [{ FiscalDocumentDate: E.ultima }] : [] });
  if (q.top === '1') return corpo({ value: E.amostra ? [E.amostra] : [] });
  if (E.so400DataHora && /T00:00:00Z/.test(q.filter)) return corpo({ error: { innererror: { message: 'type mismatch Edm.Date' } } }, 400);
  if (E.porConta) {
    const pedidas = (q.filter.match(/'([^']+)'/g) || []).map(s => s.slice(1, -1));
    return corpo({ value: E.linhas.filter(r => pedidas.indexOf(r.CustomerAccount) >= 0) });
  }
  // busca da operação pelo número da nota (notas do diário)
  if (/FiscalDocumentNumber eq/.test(q.filter)) {
    const pedidos = (q.filter.match(/FiscalDocumentNumber eq '([^']+)'/g) || []).map(s => s.split("'")[1]);
    return corpo({ value: (E.porNumero || []).filter(r => pedidos.indexOf(r.FiscalDocumentNumber) >= 0) });
  }
  return corpo({ value: E.linhas || [] });
};

const FD = require('../api/shared/faturamento-dia');
const DIA = '2026-11-06';
const OPV = 'Venda de produção do estabelecimento';
const OPNC = 'Venda de produção do estabelecimento, destinada a não contri';
const OPCONS = 'Venda prod estab remet ant consignação mercantil';
const OPDEV = 'Dev venda merc adquirida ou receb terceiros';
const fd = (n, op, v, o) => Object.assign({ dataAreaId: 'msb', FiscalDocumentNumber: n, FiscalDocumentDate: DIA + 'T00:00:00Z', FiscalDocumentSeries: '1', Status: 'Approved',
  ThirdPartyName: '', Direction: 'Outgoing', FiscalDocumentAccountType: 'Cust', FiscalDocumentAccountNum: 'C1', TotalAmount: v, OperationDescription: op }, o || {});
const AMOSTRA = fd('000000001', OPV, 1);
const DIARIO = (linhas) => ({ amostra: { dataAreaId: 'msb', InvoiceNumber: 'X', InvoiceDate: DIA + 'T00:00:00Z', InvoiceCustomerAccountNumber: 'C1', TotalInvoiceAmount: 1, SalesOrderNumber: 'OV1', CurrencyCode: 'BRL' }, linhas: linhas || [] });
const jl = (n, conta, v) => ({ InvoiceNumber: n, InvoiceDate: DIA + 'T00:00:00Z', InvoiceCustomerAccountNumber: conta, TotalInvoiceAmount: v });
const CLIENTES = { porConta: true, amostra: { dataAreaId: 'msb', CustomerAccount: 'C1', OrganizationName: 'X', BrazilianCNPJOrCPF: '1' },
  linhas: [{ CustomerAccount: 'C1', OrganizationName: 'HOSPITAL UM', BrazilianCNPJOrCPF: '11' }, { CustomerAccount: 'C2', OrganizationName: 'CLINICA DOIS', BrazilianCNPJOrCPF: '22' }] };

(async () => {
  console.log('1) só as operações da lista, IGUAIS (o caso da 000021466)');
  FD._limparCache(); chamadas.length = 0;
  CEN = {
    FiscalDocuments: { amostra: AMOSTRA, linhas: [
      fd('000021460', OPV, 1000, { ThirdPartyName: 'HOSPITAL UM' }),
      fd('000021461', OPNC, 300, { FiscalDocumentAccountNum: 'C2' }),               // cortada como o Dynamics grava
      fd('000021462', 'VENDA PROD ESTAB REMET ANT CONSIGNACAO MERCANTIL', 200),       // maiúscula/sem acento
      fd('000000501', OPDEV, 150, { Direction: 'Incoming', FiscalDocumentAccountNum: 'C2' }),
      fd('000021466', 'Venda de produção do estabelecimento em operação com produto sujeito ao regime de ST', 5000),
      fd('000021467', 'Remessa em consignação mercantil', 9000),
      fd('000021468', 'Remessa em consignação mercantil', 1000),
      fd('000021469', '', 70),                                                          // sem operação
      fd('000090001', 'Compra para comercialização', 9999, { Direction: 'Incoming', FiscalDocumentAccountType: 'Vend', FiscalDocumentAccountNum: 'F9' }),
      fd('000021470', OPV, 400, { Status: 'Canceled' }),
      fd('000021400', OPV, 7, { FiscalDocumentDate: '2026-11-05T00:00:00Z' })
    ] },
    SalesInvoiceHeadersV2: DIARIO([jl('000021460', 'C1', 1000), jl('000021467', 'C1', 9000)]),
    CustomersV3: CLIENTES
  };
  let r = await FD.notasDoDia({ data: DIA });
  t('fonte = FiscalDocuments', r.fonte && r.fonte.entidade === 'FiscalDocuments', r.fonte);
  t('000021466 (só começa igual) fica FORA', !r.notas.some(n => n.numero === '000021466') && r.foraNotas.some(n => n.numero === '000021466'), r.foraNotas);
  t('3 vendas da lista = 1.500', r.resumo.venda.qtd === 3 && r.resumo.venda.valor === 1500, r.resumo.venda);
  t('1 devolução = 150', r.resumo.devolucao.qtd === 1 && r.resumo.devolucao.valor === 150, r.resumo.devolucao);
  t('sem operação fica fora, com aviso', !r.notas.some(n => n.numero === '000021469') && r.foraPorOperacao['(sem tipo de operação)'] === 1 && r.avisos.some(a => /sem tipo de operação/.test(a)), r.avisos);
  t('remessa e compra fora, contadas', r.foraPorOperacao['Remessa em consignação mercantil'] === 2 && r.foraPorOperacao['Compra para comercialização'] === 1, r.foraPorOperacao);
  t('cancelada listada e fora da soma', r.resumo.canceladas === 1 && r.notas.some(n => n.numero === '000021470' && n.cancelada));
  t('nota de outro dia descartada', !r.notas.some(n => n.numero === '000021400'));
  t('nome pelo cadastro quando a nota não traz', (r.notas.find(n => n.numero === '000021461') || {}).cliente === 'CLINICA DOIS', r.notas);
  t('toda leitura filtra a MSB', chamadas.filter(c => c.q.filter && !/^\(/.test(c.q.filter)).every(c => /dataAreaId eq 'msb'/.test(c.q.filter)), chamadas.map(c => c.q.filter));
  t('OperationDescription no $select', chamadas.some(c => c.ent === 'FiscalDocuments' && /OperationDescription/.test(c.q.select || '')));
  const po = {}; (r.porOperacao || []).forEach(o => { po[o.operacao] = o; });
  t('por operação: as que contam, com valor', po[OPV] && po[OPV].conta === 'venda' && po[OPV].qtd === 1 && po[OPV].valor === 1000 && po[OPV].canceladas === 1 && po[OPDEV].conta === 'devolucao' && po[OPDEV].valor === 150, r.porOperacao);
  t('por operação: as de fora, com valor', po['Remessa em consignação mercantil'].conta === 'fora' && po['Remessa em consignação mercantil'].qtd === 2 && po['Remessa em consignação mercantil'].valor === 10000 && po['(sem tipo de operação)'].valor === 70, r.porOperacao);
  t('por operação: a 000021466 aparece com a operação dela', (r.porOperacao || []).some(o => /sujeito ao regime de ST/.test(o.operacao) && o.conta === 'fora' && o.valor === 5000));
  t('fora da soma traz o valor de cada nota', r.foraNotas.some(n => n.numero === '000021466' && n.valor === 5000), r.foraNotas);
  t('conferência: o diário com a operação da fiscal', r.conferencia && r.conferencia.venda.qtd === 1 && r.conferencia.venda.valor === 1000, r.conferencia);

  console.log('2) fiscal vazia no dia: diário, com a operação buscada na fiscal pelo número');
  FD._limparCache(); chamadas.length = 0;
  CEN.FiscalDocuments = { amostra: AMOSTRA, linhas: [], ultima: '2023-12-05T00:00:00Z', porNumero: [
    fd('000021480', OPV, 0), fd('000021481', 'Remessa em consignação mercantil', 0), fd('21482', OPDEV, 0, { FiscalDocumentAccountNum: 'C2' })
  ] };
  CEN.SalesInvoiceHeadersV2 = DIARIO([jl('000021480', 'C1', 1000), jl('000021481', 'C1', 9000), jl('000021482', 'C2', -150), jl('000021483', 'C1', 500)]);
  r = await FD.notasDoDia({ data: DIA });
  t('fonte = diário', r.fonte && r.fonte.papel === 'diario', r.fonte);
  t('aviso diz a última nota (05/12/2023)', r.avisos.some(a => /05\/12\/2023/.test(a)), r.avisos);
  t('buscou a operação na fiscal pelo número', chamadas.some(c => c.ent === 'FiscalDocuments' && /FiscalDocumentNumber eq '000021480'/.test(c.q.filter)));
  t('venda pela operação achada', r.resumo.venda.qtd === 1 && r.resumo.venda.valor === 1000, r.resumo.venda);
  t('devolução achada pelo número sem zeros', r.resumo.devolucao.qtd === 1 && r.resumo.devolucao.valor === 150, r.resumo.devolucao);
  t('remessa e nota sem operação achada ficam fora', r.foraPorOperacao['Remessa em consignação mercantil'] === 1 && r.foraPorOperacao['(sem tipo de operação)'] === 1, r.foraPorOperacao);

  console.log('3) as duas vazias: diz a última nota da fiscal');
  FD._limparCache();
  CEN.FiscalDocuments = { amostra: AMOSTRA, linhas: [], ultima: '2026-11-05T00:00:00Z' };
  CEN.SalesInvoiceHeadersV2 = DIARIO([]);
  r = await FD.notasDoDia({ data: DIA });
  t('0 notas, fonte fiscal, última = 05/11', r.notas.length === 0 && r.fonte.papel === 'fiscal' && r.ultimaFiscal === '2026-11-05', r);

  console.log('4) coluna de data Edm.Date (400 na data-hora)');
  FD._limparCache(); chamadas.length = 0;
  CEN.FiscalDocuments = { so400DataHora: true, amostra: AMOSTRA, linhas: [fd('000021490', OPV, 120)] };
  r = await FD.notasDoDia({ data: DIA });
  const dias = chamadas.filter(c => c.ent === 'FiscalDocuments' && / ge /.test(c.q.filter));
  t('tentou data-hora e caiu na data', dias.length === 2 && /T00:00:00Z/.test(dias[0].q.filter) && !/T00/.test(dias[1].q.filter), dias.map(d => d.q.filter));
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
