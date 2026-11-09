// ================================================================
// scripts/test-fatdia-sonda.js — testes da sonda do tipo de operação
// (api/shared/fatdia-sonda.js) contra um F&O SIMULADO.
//
//   node scripts/test-fatdia-sonda.js
//
// O caso real (09/11/2026): o diário de faturas tem as notas de 2026 mas não
// tem operação; a FiscalDocuments tem OperationDescription mas parou em 2023.
// A sonda tem que apontar a entidade que tem as DUAS coisas.
// ================================================================

process.env.D365_TENANT_ID = 't'; process.env.D365_CLIENT_ID = 'c'; process.env.D365_CLIENT_SECRET = 's';
process.env.D365_RESOURCE_URL = 'https://fo.teste';

let falhas = 0;
function t(nome, ok, extra) { console.log((ok ? '  ok  ' : '  FALHOU ') + nome + (ok || extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); if (!ok) falhas++; }

const ENT = {
  SalesInvoiceHeadersV2: [{ dataAreaId: 'msb', InvoiceNumber: '000021466', InvoiceDate: '2026-11-06T00:00:00Z', TotalInvoiceAmount: 100 }],
  FiscalDocuments: [{ dataAreaId: 'msb', FiscalDocumentNumber: '0001', FiscalDocumentDate: '2023-12-05T00:00:00Z', OperationDescription: 'Venda de produção do estabelecimento' }],
  SalesInvoiceLines: [{ dataAreaId: 'msb', InvoiceNumber: '000021466', InvoiceDate: '2026-11-06T00:00:00Z', OperationTypeDescription: 'Venda de produção do estabelecimento', OperationalSiteId: 'X' }],
  BioCustInvoiceTrans: [{ dataAreaId: 'msb', InvoiceId: '000021466', InvoiceDate: '2026-11-06T00:00:00Z', CFOP: '' }],   // coluna existe, vazia
  NFeHeadersBR: [{ dataAreaId: 'msb', DocumentNumber: '21466', CreatedDateTime: '2026-11-06T13:00:00Z', NatureOfOperation: 'VENDA' }]
};
const chamadas = [];
let EXTRA = [];   // nomes a mais no service document (caso 2)
const corpo = (j, st) => ({ ok: (st || 200) < 400, status: st || 200, text: async () => JSON.stringify(j) });
global.fetch = async (url) => {
  url = String(url);
  if (/login\.microsoftonline/.test(url)) return corpo({ access_token: 'tok', expires_in: 3600 });
  const u = new URL(url);
  if (u.pathname === '/data') return corpo({ value: Object.keys(ENT).filter(n => EXTRA.indexOf(n) < 0).concat(['Customers', 'Vendors'], EXTRA).map(n => ({ name: n })) });   // EXTRA no fim, na ordem dada
  const e = u.pathname.replace('/data/', '');
  chamadas.push({ e, f: u.searchParams.get('$filter') || '', o: u.searchParams.get('$orderby') });
  if (!ENT[e]) return corpo({ error: {} }, 404);
  return corpo({ value: ENT[e] });
};

const S = require('../api/shared/fatdia-sonda');
(async () => {
  const r = await S.sondar();
  const por = {}; r.entidades.forEach(x => { por[x.entidade] = x; });
  t('linhas de fatura servem (operação em 2026)', por.SalesInvoiceLines && por.SalesInvoiceLines.serve === true, por.SalesInvoiceLines);
  t('o que o service document publicou com "nfe" entrou e serve', por.NFeHeadersBR && por.NFeHeadersBR.serve === true, por.NFeHeadersBR);
  t('diário não serve (sem coluna de operação)', por.SalesInvoiceHeadersV2 && !por.SalesInvoiceHeadersV2.serve && por.SalesInvoiceHeadersV2.colunasOperacao.length === 0);
  t('FiscalDocuments não serve (parou em 2023)', por.FiscalDocuments && !por.FiscalDocuments.serve && por.FiscalDocuments.ultimaData === '2023-12-05', por.FiscalDocuments);
  t('coluna de operação vazia não serve', por.BioCustInvoiceTrans && !por.BioCustInvoiceTrans.serve && por.BioCustInvoiceTrans.colunasOperacao.indexOf('CFOP') >= 0, por.BioCustInvoiceTrans);
  t('OperationalSiteId não conta como operação', por.SalesInvoiceLines.colunasOperacao.indexOf('OperationalSiteId') < 0, por.SalesInvoiceLines.colunasOperacao);
  t('as que servem vêm primeiro e na lista "servem"', r.entidades[0].serve && r.servem.indexOf('SalesInvoiceLines') >= 0 && r.servem.length === 2, r.servem);
  t('não testou o que o service document não publica', !chamadas.some(c => c.e === 'SalesInvoiceHeaders'));
  t('leituras da MSB', chamadas.filter(c => c.f).every(c => /dataAreaId eq 'msb'/.test(c.f)));
  t('traz os nomes de todas as colunas', por.SalesInvoiceHeadersV2.nomesColunas.slice().sort().join(',') === 'InvoiceDate,InvoiceNumber,TotalInvoiceAmount,dataAreaId', por.SalesInvoiceHeadersV2.nomesColunas);
  t('ordenou pela data para achar a mais recente', chamadas.some(c => c.e === 'SalesInvoiceLines' && c.o === 'InvoiceDate desc'));

  console.log('2) status da nota: a entidade fiscal da Bio não pode cair no corte de MAX_ENT');
  // 09/11/26 (dono: "vê se acha algum status de alguma entidade que tem nota
  // fiscal"): 40 entidades de fatura publicadas antes da da Bio
  EXTRA = Array.from({ length: 40 }, (_, i) => 'VendInvoiceExtra' + i).concat(['FiscalDocumentLineBioEntities']);
  ENT.FiscalDocumentBioEntities = [{ dataAreaId: 'msb', FiscalDocumentNumber: '000021497', FiscalDocumentDate: '2026-11-09T12:00:00Z', Status: 'Approved' }];
  EXTRA.push('FiscalDocumentBioEntities');
  chamadas.length = 0;
  const r2 = await S.sondar();
  const bio = r2.entidades.find(x => x.entidade === 'FiscalDocumentBioEntities');
  t('a entidade fiscal da Bio foi testada mesmo com 40 de fatura antes', !!bio && bio.ok, r2.entidades.map(x => x.entidade).slice(0, 5));
  t('ela traz o status da nota de 2026 (Status = Approved)', bio && bio.serveStatus === true && bio.colunasStatus.indexOf('Status') >= 0 && bio.maisRecente.Status === 'Approved', bio);
  t('ela está em "servemStatus"', r2.servemStatus.indexOf('FiscalDocumentBioEntities') >= 0, r2.servemStatus);
  t('a de linhas da Bio não passa na frente', r2.entidades.findIndex(x => x.entidade === 'FiscalDocumentBioEntities') >= 0 && chamadas.findIndex(c => c.e === 'FiscalDocumentBioEntities') < chamadas.findIndex(c => c.e === 'FiscalDocumentLineBioEntities' || c.e === 'SalesInvoiceHeadersV2'));
  t('o limite de entidades testadas continua', new Set(chamadas.map(c => c.e)).size <= 36, new Set(chamadas.map(c => c.e)).size);
  EXTRA = []; delete ENT.FiscalDocumentBioEntities;

  // rota: a sonda é só do dono (o exigirDono vem antes)
  const auth = require('../api/shared/auth');
  const fn = require('../api/faturamento-hoje/index.js');
  const orig = auth.requireUser;
  auth.requireUser = async () => ({ user: { email: 'fulano@biomedical.com.br' }, validated: true });
  const ctx = { log: { error() {} } };
  await fn(ctx, { method: 'GET', headers: {}, query: { sondar: '1' } });
  t('sonda: outro e-mail -> 403', ctx.res.status === 403, ctx.res.status);
  auth.requireUser = async () => ({ user: { email: 'ia@biomedical.com.br' }, validated: true });
  await fn(ctx, { method: 'GET', headers: {}, query: { sondar: '1' } });
  t('sonda: dono -> 200 com entidades', ctx.res.status === 200 && Array.isArray(ctx.res.body.entidades), ctx.res.status);
  auth.requireUser = orig;

  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\ntudo ok');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
