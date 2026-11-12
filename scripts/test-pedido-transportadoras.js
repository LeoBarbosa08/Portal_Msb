// ================================================================
// scripts/test-pedido-transportadoras.js — o campo Transportadora do
// PI · Pedido (api/pedido-transportadoras) contra um F&O SIMULADO.
//
//   node scripts/test-pedido-transportadoras.js
//
// Cobre: os nomes (CarrierName) da empresa msb, sem repetidos/vazios e em
// ordem alfabética; a entidade que não existe (404) cai na próxima; a
// entidade sem dataAreaId é lida sem o filtro (com aviso); o cache; o erro do
// Dynamics volta em `erro` (200); sem credenciais = configured:false; e o
// /api/pedido-enviar leva a Transportadora ao flow ("" quando não escolhida).
// ================================================================

process.env.D365_TENANT_ID = 't'; process.env.D365_CLIENT_ID = 'c'; process.env.D365_CLIENT_SECRET = 's';
process.env.D365_RESOURCE_URL = 'https://fo.teste';
process.env.PEDIDO_FLOW_URL = 'https://flow.teste/gatilho';

let falhas = 0;
function t(nome, ok, extra) { console.log((ok ? '  ok  ' : '  FALHOU ') + nome + (ok || extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); if (!ok) falhas++; }

// CEN[entidade] = linhas | 404 | { semEmpresa: linhas } | { erro: status }
let CEN = {};
let chamadas = [];
let flowBody = null;
const corpo = (j, st) => ({ ok: (st || 200) < 400, status: st || 200, text: async () => (typeof j === 'string' ? j : JSON.stringify(j)) });
global.fetch = async (url, init) => {
  url = String(url);
  if (/login\.microsoftonline/.test(url)) return corpo({ access_token: 'tok', expires_in: 3600 });
  if (/flow\.teste/.test(url)) { flowBody = JSON.parse(init.body); return corpo({}); }
  const u = new URL(url);
  const ent = u.pathname.replace('/data/', '');
  const f = u.searchParams.get('$filter') || '';
  chamadas.push({ ent, f });
  const c = CEN[ent];
  if (c === undefined || c === 404) return corpo({ error: { message: "Resource not found for the segment '" + ent + "'." } }, 404);
  if (c.erro) return corpo({ error: { message: 'falha' } }, c.erro);
  if (c.semEmpresa) {
    if (/dataAreaId/.test(f)) return corpo({ error: { message: "Could not find a property named 'dataAreaId' on type 'X'." } }, 400);
    return corpo({ value: c.semEmpresa });
  }
  const emp = (f.match(/dataAreaId eq '([^']+)'/) || [])[1];
  return corpo({ value: c.filter(r => !emp || r.dataAreaId === emp) });
};

const auth = require('../api/shared/auth');
auth.requireArea = async () => ({ user: { email: 'fulano@biomedical.com.br' }, validated: true });
const fn = require('../api/pedido-transportadoras/index.js');

async function chama(query) {
  const ctx = { log: { warn() {}, error() {} } };
  await fn(ctx, { method: 'GET', headers: {}, query: query || {} });
  return ctx.res;
}
const C = (o) => Object.assign({ dataAreaId: 'msb', CarrierName: '', CnpjOrCpf: '', Vendor: '', AddressCity: 'Porto Alegre' }, o);

(async () => {
  console.log('1) os nomes da msb, sem repetidos, em ordem');
  CEN = {
    SalesCarrierEntity: [
      C({ CarrierName: 'TNT MERCURIO', CnpjOrCpf: '95.592.077/0001-04', Vendor: 'F000123' }),
      C({ CarrierName: 'Braspress' }),
      C({ CarrierName: 'JADLOG' }),
      C({ CarrierName: 'jadlog' }),                 // repetido (sem caixa)
      C({ CarrierName: '   ' }),                    // vazio
      C({ dataAreaId: 'bio', CarrierName: 'SÓ DA BIO' })
    ]
  };
  fn._limparCache(); chamadas = [];
  let r = await chama();
  let b = r.body;
  t('200 e configured', r.status === 200 && b.configured === true, r);
  t('empresa msb', b.empresa === 'msb', b.empresa);
  t('entidade SalesCarrierEntity, campo CarrierName', b.entidade === 'SalesCarrierEntity' && b.campo === 'CarrierName', b);
  t('nomes em ordem alfabética, sem repetidos/vazios/outra empresa',
    JSON.stringify(b.transportadoras.map(x => x.nome)) === JSON.stringify(['Braspress', 'JADLOG', 'TNT MERCURIO']), b.transportadoras);
  t('traz CNPJ e fornecedor', b.transportadoras[2].cnpj === '95.592.077/0001-04' && b.transportadoras[2].fornecedor === 'F000123', b.transportadoras[2]);
  t('filtro OData pela empresa, cross-company', chamadas.length === 1 && chamadas[0].f === "dataAreaId eq 'msb'", chamadas);
  t('sem aviso', !b.aviso, b.aviso);

  console.log('2) o cache de 10 min e o ?atualizar=1');
  chamadas = [];
  await chama();
  t('2ª chamada vem do cache (sem ir ao Dynamics)', chamadas.length === 0, chamadas);
  await chama({ atualizar: '1' });
  t('?atualizar=1 vai ao Dynamics', chamadas.length === 1, chamadas);

  console.log('3) a entidade que não existe cai na próxima');
  CEN = { SalesCarriers: [C({ CarrierName: 'RODONAVES' })] };
  fn._limparCache(); chamadas = [];
  b = (await chama()).body;
  t('achou em SalesCarriers', b.entidade === 'SalesCarriers' && b.transportadoras.length === 1 && b.transportadoras[0].nome === 'RODONAVES', b);
  t('tentou SalesCarrierEntity antes', chamadas.map(c => c.ent).join(',') === 'SalesCarrierEntity,SalesCarriers', chamadas);
  chamadas = [];
  await chama({ atualizar: '1' });
  t('guarda a entidade que respondeu (vai direto nela)', chamadas.map(c => c.ent).join(',') === 'SalesCarriers', chamadas);

  console.log('4) entidade sem dataAreaId: lê sem o filtro, com aviso');
  CEN = { SalesCarrierEntity: { semEmpresa: [{ CarrierName: 'AZUL CARGO' }] } };
  fn._limparCache(); chamadas = [];
  b = (await chama()).body;
  t('lista sem filtro', b.transportadoras.length === 1 && b.transportadoras[0].nome === 'AZUL CARGO', b);
  t('com aviso', /dataAreaId/.test(b.aviso || ''), b.aviso);

  console.log('5) erros do Dynamics');
  CEN = {};
  fn._limparCache();
  r = await chama();
  t('nenhuma entidade: 200 com erro que manda conferir a env', r.status === 200 && /D365_TRANSPORTADORA_ENTITY/.test(r.body.erro || '') && r.body.transportadoras.length === 0, r.body);
  CEN = { SalesCarrierEntity: { erro: 500 } };
  fn._limparCache();
  r = await chama();
  t('500 do F&O: 200 com o motivo', r.status === 200 && /F&O 500/.test(r.body.erro || ''), r.body);
  CEN = { SalesCarrierEntity: [C({ CarrierName: 'OK' })] };
  b = (await chama()).body;
  t('erro não ficou em cache', !b.erro && b.transportadoras.length === 1, b);
  CEN = { SalesCarrierEntity: [{ dataAreaId: 'msb', Vendor: 'F1' }] };
  fn._limparCache();
  b = (await chama()).body;
  t('tabela sem CarrierName: erro com o motivo', /CarrierName/.test(b.erro || ''), b);

  console.log('6) /api/pedido-enviar leva a Transportadora ao flow');
  auth.flowAuthHeader = async () => ({});
  const enviar = require('../api/pedido-enviar/index.js');
  const prod = [{ codigo: 'P1', produto: 'X', quantidade: 1, valorUnitario: 10, lotes: [] }];
  const ctx = { log: { warn() {}, error() {} } };
  await enviar(ctx, { method: 'POST', headers: {}, body: { cabecalho: { empresa: 'MSB', transportadora: ' JADLOG ' }, produtos: prod, totalGeral: 10 } });
  t('Transportadora = o nome escolhido', ctx.res.status === 200 && flowBody && flowBody.Transportadora === 'JADLOG', flowBody && flowBody.Transportadora);
  await enviar(ctx, { method: 'POST', headers: {}, body: { cabecalho: { empresa: 'MSB' }, produtos: prod, totalGeral: 10 } });
  t('sem transportadora: ""', flowBody.Transportadora === '', flowBody.Transportadora);

  console.log('7) sem credenciais do Dynamics');
  delete require.cache[require.resolve('../api/pedido-transportadoras/index.js')];
  delete require.cache[require.resolve('../api/shared/d365')];
  delete process.env.D365_CLIENT_SECRET;
  const fn2 = require('../api/pedido-transportadoras/index.js');
  const ctx2 = {};
  await fn2(ctx2, { method: 'GET', headers: {}, query: {} });
  t('configured:false', ctx2.res.status === 200 && ctx2.res.body.configured === false, ctx2.res.body);

  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
