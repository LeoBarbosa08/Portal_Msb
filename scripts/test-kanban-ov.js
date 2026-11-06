// ================================================================
// scripts/test-kanban-ov.js — testes do motor do Kanban (OVs do dia)
// (api/shared/kanban-ov.js) contra um F&O SIMULADO (fetch falso).
//
//   node scripts/test-kanban-ov.js
//
// Cobre: descoberta pelo service document (BIO + V2, V3 ausente), a
// principal é a que tem data de criação, "do dia" no fuso de Brasília,
// complemento da BIO juntado pelo número da OV, status crus das duas
// entidades, valor/itens pelas linhas, só a MSB nos filtros e a rota
// exigindo a área kanban.
// ================================================================

process.env.D365_TENANT_ID = 't'; process.env.D365_CLIENT_ID = 'c'; process.env.D365_CLIENT_SECRET = 's';
process.env.D365_RESOURCE_URL = 'https://fo.teste';

let falhas = 0;
function t(nome, ok, extra) { console.log((ok ? '  ok  ' : '  FALHOU ') + nome + (ok || extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); if (!ok) falhas++; }

const DIA = '2026-11-06';
let CEN = {}, SERVICO = [];
const chamadas = [];
const corpo = (j, st) => ({ ok: (st || 200) < 400, status: st || 200, text: async () => JSON.stringify(j), json: async () => j });
global.fetch = async (url) => {
  url = String(url);
  if (/login\.microsoftonline/.test(url)) return corpo({ access_token: 'tok', expires_in: 3600 });
  const u = new URL(url);
  if (u.pathname === '/data') return corpo({ value: SERVICO.map(n => ({ name: n, url: n })) });
  const ent = u.pathname.replace('/data/', '');
  const q = { filter: u.searchParams.get('$filter') || '', top: u.searchParams.get('$top'), select: u.searchParams.get('$select') };
  chamadas.push({ ent, q });
  const E = CEN[ent];
  if (!E) return corpo({ error: { message: 'not found' } }, 404);
  if (q.top === '1') return corpo({ value: E.linhas.slice(0, 1) });
  // filtro por número de OV (complemento / linhas)
  const nums = (q.filter.match(/(SalesOrderNumber|SalesId) eq '([^']+)'/g) || []).map(s => s.split("'")[1]);
  if (nums.length) return corpo({ value: E.linhas.filter(r => nums.indexOf(r.SalesOrderNumber || r.SalesId) >= 0) });
  // filtro por data de criação: devolve o que cai no intervalo pedido
  const m = /ge (\S+) and \S+ lt (\S+)/.exec(q.filter);
  if (m) return corpo({ value: E.linhas.filter(r => r.OrderCreationDateTime >= m[1] && r.OrderCreationDateTime < m[2]) });
  return corpo({ value: E.linhas });
};

const K = require('../api/shared/kanban-ov');
const v2 = (n, criada, st, extra) => Object.assign({ dataAreaId: 'msb', SalesOrderNumber: n, OrderCreationDateTime: criada, SalesOrderStatus: st,
  OrderingCustomerAccountNumber: 'C' + n.slice(-3), SalesOrderName: 'CLIENTE ' + n.slice(-3), CustomersOrderReference: 'OC-' + n.slice(-3),
  RequestedShippingDate: '2026-11-10T12:00:00Z', DefaultShippingWarehouseId: 'ALMOX-PA', SalesOrderPoolId: '', CreditCardNumber: '' }, extra || {});
const bio = (n, st, lib) => ({ dataAreaId: 'msb', SalesOrderNumber: n, StatusPedido: st, StatusLiberacao: lib, EmGerenciamentoCredito: 'Não' });

(async () => {
  console.log('1) BIO + V2: principal com data, complemento, status e valor');
  K._limparCache(); chamadas.length = 0;
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'Customers'];
  CEN = {
    SalesOrderHeadersV2: { linhas: [
      v2('OV017521', DIA + 'T13:10:00Z', 'Backorder'),
      v2('OV017522', DIA + 'T18:45:00Z', 'Backorder'),
      v2('OV017523', '2026-11-07T01:30:00Z', 'Invoiced'),     // 06/11 22:30 em Brasília: É do dia
      v2('OV017500', DIA + 'T02:00:00Z', 'Backorder')         // 05/11 23:00 em Brasília: NÃO é
    ] },
    BIOSalesOrderHeaderV1: { linhas: [
      bio('OV017521', 'CRIADA', 'Pendente'), bio('OV017522', 'EM PROCESSO LOGÍSTICO', 'Liberado'), bio('OV017523', 'FATURADA', 'Liberado'), bio('OV017500', 'CRIADA', 'Pendente')
    ] },
    SalesOrderLines: { linhas: [
      { dataAreaId: 'msb', SalesOrderNumber: 'OV017521', LineAmount: 1000 }, { dataAreaId: 'msb', SalesOrderNumber: 'OV017521', LineAmount: 250.5 },
      { dataAreaId: 'msb', SalesOrderNumber: 'OV017522', LineAmount: 960 }
    ] }
  };
  let r = await K.ordensDoDia({ data: DIA });
  t('principal = SalesOrderHeadersV2 (tem data de criação)', r.fontes[0] && r.fontes[0].entidade === 'SalesOrderHeadersV2' && r.fontes[0].papel === 'principal', r.fontes);
  t('BIO entrou como complemento', r.fontes.some(f => f.entidade === 'BIOSalesOrderHeaderV1' && f.papel === 'complemento' && f.linhas === 3), r.fontes);
  t('3 OVs do dia (fuso de Brasília)', r.ovs.length === 3 && !r.ovs.some(o => o.numero === 'OV017500') && r.ovs.some(o => o.numero === 'OV017523'), r.ovs.map(o => o.numero));
  t('a mais recente primeiro', r.ovs[0].numero === 'OV017523', r.ovs.map(o => o.numero));
  const chaves = r.statusCols.map(s => s.chave);
  t('status das duas entidades', chaves.indexOf('BIOSalesOrderHeaderV1.StatusPedido') >= 0 && chaves.indexOf('SalesOrderHeadersV2.SalesOrderStatus') >= 0 && chaves.indexOf('BIOSalesOrderHeaderV1.StatusLiberacao') >= 0, chaves);
  t('número de cartão não vira status', chaves.indexOf('SalesOrderHeadersV2.CreditCardNumber') < 0, chaves);
  t('padrão = status da BIO', r.statusPadrao === 'BIOSalesOrderHeaderV1.StatusPedido', r.statusPadrao);
  const s = r.statusCols.find(x => x.chave === 'BIOSalesOrderHeaderV1.StatusPedido');
  t('contagem crua por valor', s && s.valores['CRIADA'] === 1 && s.valores['FATURADA'] === 1 && s.valores['EM PROCESSO LOGÍSTICO'] === 1, s && s.valores);
  const o21 = r.ovs.find(o => o.numero === 'OV017521');
  t('valor e itens pelas linhas', o21.valor === 1250.5 && o21.itens === 2, o21);
  t('cliente, conta e OC', o21.cliente === 'CLIENTE 521' && o21.conta === 'C521' && o21.oc === 'OC-521', o21);
  t('status da OV por coluna', o21.status['BIOSalesOrderHeaderV1.StatusPedido'] === 'CRIADA' && o21.status['SalesOrderHeadersV2.SalesOrderStatus'] === 'Backorder', o21.status);
  t('campos crus das duas entidades, sem vazios', o21.campos.BIOSalesOrderHeaderV1 && o21.campos.SalesOrderHeadersV2 && !('SalesOrderPoolId' in o21.campos.SalesOrderHeadersV2), Object.keys(o21.campos));
  t('OV sem linhas: valor nulo', r.ovs.find(o => o.numero === 'OV017523').valor === null);
  const dia = chamadas.find(c => c.ent === 'SalesOrderHeadersV2' && /ge /.test(c.q.filter));
  t('intervalo do dia em Brasília (03:00Z)', dia && /ge 2026-11-06T03:00:00Z and OrderCreationDateTime lt 2026-11-07T03:00:00Z/.test(dia.q.filter), dia && dia.q.filter);
  t('toda leitura filtra a MSB', chamadas.filter(c => c.q.filter).every(c => /dataAreaId eq 'msb'/.test(c.q.filter)), chamadas.map(c => c.q.filter));
  t('não testou o que o service document não publica', !chamadas.some(c => c.ent === 'SalesOrderHeadersV3'));

  console.log('2) cache de 15 s e ?atualizar=1');
  const antes = chamadas.length;
  r = await K.ordensDoDia({ data: DIA });
  t('2ª chamada vem do cache', r.cache === true && chamadas.length === antes);
  r = await K.ordensDoDia({ data: DIA, atualizar: true });
  t('atualizar=1 vai ao Dynamics', !r.cache && chamadas.length > antes);

  console.log('3) nenhuma entidade responde');
  K._limparCache(); SERVICO = ['Customers']; CEN = {};
  r = await K.ordensDoDia({ data: DIA });
  t('aviso e quadro vazio', r.ovs.length === 0 && r.avisos.length === 1 && /Nenhuma entidade/.test(r.avisos[0]), r.avisos);

  console.log('4) rota exige a área kanban');
  K._limparCache();
  const auth = require('../api/shared/auth');
  const fn = require('../api/kanban-ov/index.js');
  const orig = auth.requireArea;
  let pediu = null;
  auth.requireArea = async (req, area) => { pediu = area; const e = new Error('forbidden'); e.status = 403; throw e; };
  const ctx = { log: { error() {} } };
  await fn(ctx, { method: 'GET', headers: {}, query: {} });
  t('sem a área -> 403', ctx.res.status === 403 && pediu === 'kanban', ctx.res.status);
  auth.requireArea = async () => ({ user: { email: 'ia@biomedical.com.br' }, validated: true });
  await fn(ctx, { method: 'GET', headers: {}, query: { data: 'hoje' } });
  t('data inválida -> 400', ctx.res.status === 400, ctx.res.status);
  auth.requireArea = orig;

  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\ntudo ok');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
