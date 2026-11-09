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
// exigindo a área kanban; as linhas de uma OV (?ov=) para a ficha.
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
  const nums = (q.filter.match(/(SalesOrderNumber|SalesId|SALESID) eq '([^']+)'/g) || []).map(s => s.split("'")[1]);
  if (nums.length) return corpo({ value: E.linhas.filter(r => nums.indexOf(r.SalesOrderNumber || r.SalesId || r.SALESID) >= 0) });
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

  console.log('4) as 4 etapas (regra do dono, 07/11/2026)');
  K._limparCache(); chamadas.length = 0;
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines'];
  const b4 = (n, ss, rs, cr) => ({ dataAreaId: 'msb', SalesOrderNumber: n, SalesStatus: ss, ReleaseStatus: rs, CredManInCreditControl: cr });
  CEN = {
    SalesOrderHeadersV2: { linhas: ['OV017518', 'OV017519', 'OV017520', 'OV017517', 'OV017516', 'OV017515', 'OV017514'].map((n, i) => v2(n, DIA + 'T1' + i + ':00:00Z', 'Backorder')) },
    BIOSalesOrderHeaderV1: { linhas: [
      b4('OV017518', 'Backorder', 'Open', 'No'),          // ordem em aberto, não liberada -> Criada
      b4('OV017519', 'Backorder', 'Open', 'Yes'),         // crédito marcado -> Gerenciamento de Crédito
      b4('OV017520', 'Backorder', 'Released', 'No'),      // liberada -> Logística
      b4('OV017517', 'Invoiced', 'Released', 'No'),       // faturada E liberada (o print) -> Faturado
      b4('OV017516', 'Delivered', 'Released', 'No'),      // entregue -> Faturado ("o restante")
      b4('OV017515', 'Canceled', 'Open', 'No'),           // cancelada -> fora do quadro
      b4('OV017514', 'Ordem em aberto', 'Liberado', 'Não') // rótulos em português -> Logística
    ] },
    SalesOrderLines: { linhas: [{ dataAreaId: 'msb', SalesOrderNumber: 'OV017517', LineAmount: 1000 }, { dataAreaId: 'msb', SalesOrderNumber: 'OV017519', LineAmount: 50 }] }
  };
  r = await K.ordensDoDia({ data: DIA });
  const et = {}; r.ovs.forEach(o => { et[o.numero] = o.etapa; });
  t('Criada', et.OV017518 === 'criada', et);
  t('Gerenciamento de Crédito', et.OV017519 === 'credito', et);
  t('Logística (liberada)', et.OV017520 === 'liberado' && et.OV017514 === 'liberado', et);
  t('a coluna se chama Logística', r.etapas.find(e => e.id === 'liberado').nome === 'Logística', r.etapas);
  t('faturada + liberada = Faturado (OV017517)', et.OV017517 === 'faturado', et);
  t('entregue = Faturado', et.OV017516 === 'faturado', et);
  t('cancelada fora do quadro', et.OV017515 === 'cancelada' && r.canceladas === 1, et);
  t('4 colunas na ordem do fluxo', r.etapas.map(e => e.id).join(',') === 'criada,credito,liberado,faturado', r.etapas);
  t('contagem e valor por coluna', r.etapas.find(e => e.id === 'faturado').qtd === 2 && r.etapas.find(e => e.id === 'faturado').valor === 1000 && r.etapas.find(e => e.id === 'credito').valor === 50, r.etapas);
  t('regra vem com os campos e a origem', r.ovs.find(o => o.numero === 'OV017517').regra.salesStatusCol === 'BIOSalesOrderHeaderV1.SalesStatus', r.ovs.find(o => o.numero === 'OV017517').regra);
  t('sem aviso de campo faltando', !r.avisos.some(a => /Não achei/.test(a)), r.avisos);

  console.log('4b) só o depósito ALMOX-PA');
  K._limparCache(); chamadas.length = 0;
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines'];
  CEN = {
    SalesOrderHeadersV2: { linhas: [
      v2('OV017530', DIA + 'T13:00:00Z', 'Backorder'),                                            // ALMOX-PA -> fica
      v2('OV017531', DIA + 'T14:00:00Z', 'Backorder', { DefaultShippingWarehouseId: 'RETCONSIGV' }), // outro depósito -> sai
      v2('OV017532', DIA + 'T15:00:00Z', 'Invoiced', { DefaultShippingWarehouseId: '' }),           // sem depósito -> sai
      v2('OV017533', DIA + 'T16:00:00Z', 'Backorder', { DefaultShippingWarehouseId: 'almox-pa' })    // caixa baixa -> fica
    ] },
    BIOSalesOrderHeaderV1: { linhas: [] },
    SalesOrderLines: { linhas: [{ dataAreaId: 'msb', SalesOrderNumber: 'OV017530', LineAmount: 100 }, { dataAreaId: 'msb', SalesOrderNumber: 'OV017531', LineAmount: 900 }] }
  };
  r = await K.ordensDoDia({ data: DIA });
  t('só as OVs do ALMOX-PA', r.ovs.map(o => o.numero).sort().join(',') === 'OV017530,OV017533', r.ovs.map(o => o.numero));
  t('fora do quadro contadas à parte', r.foraDeposito === 2 && r.depositos.join() === 'ALMOX-PA', { fora: r.foraDeposito, dep: r.depositos });
  t('etapas e valor sem as de outro depósito', r.etapas.find(e => e.id === 'criada').qtd === 2 && r.etapas.find(e => e.id === 'criada').valor === 100 && r.etapas.find(e => e.id === 'faturado').qtd === 0, r.etapas);
  const stv = r.statusCols.find(x => x.chave === 'SalesOrderHeadersV2.SalesOrderStatus');
  t('contagem de status sem as de outro depósito', stv && stv.valores.Backorder === 2 && !stv.valores.Invoiced, stv && stv.valores);
  t('sem aviso de depósito', !r.avisos.some(a => /depósito/.test(a)), r.avisos);
  K._limparCache();
  CEN.SalesOrderHeadersV2.linhas = CEN.SalesOrderHeadersV2.linhas.map(x => Object.assign({}, x, { DefaultShippingWarehouseId: '' }));
  r = await K.ordensDoDia({ data: DIA });
  t('nenhuma OV com depósito: quadro vazio e aviso', r.ovs.length === 0 && r.avisos.some(a => /Nenhuma OV do dia trouxe o depósito/.test(a)), r.avisos);

  console.log('4c) gerenciamento de crédito pela tabela da Bio (ACTIVE pelo SALESID)');
  K._limparCache(); chamadas.length = 0;
  // nome público fora das candidatas: achado pelo "credman" do service document
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'BioCredManTableV1Publica'];
  const cm = (n, ativo) => ({ dataAreaId: 'msb', SALESID: n, ACTIVE: ativo, CUSTACCOUNT: 'C' + n.slice(-3) });
  CEN = {
    SalesOrderHeadersV2: { linhas: ['OV017540', 'OV017541', 'OV017542', 'OV017543', 'OV017544'].map((n, i) => v2(n, DIA + 'T1' + i + ':00:00Z', 'Backorder')) },
    BIOSalesOrderHeaderV1: { linhas: [
      b4('OV017540', 'Backorder', 'Open', 'No'),         // tabela ATIVA -> crédito (o cabeçalho diz No)
      b4('OV017541', 'Backorder', 'Released', 'Yes'),    // tabela INATIVA -> Logística (o cabeçalho diz Yes: a tabela vale)
      b4('OV017542', 'Backorder', 'Released', 'No'),     // sem registro na tabela -> Logística
      b4('OV017543', 'Backorder', 'Open', 'No'),         // 2 registros, um ativo -> crédito
      b4('OV017544', 'Invoiced', 'Released', 'No')       // faturada: a situação vale antes do crédito
    ] },
    SalesOrderLines: { linhas: [] },
    BioCredManTableV1Publica: { linhas: [cm('OV017540', 'Yes'), cm('OV017541', 'No'), cm('OV017543', 'No'), cm('OV017543', 'Yes'), cm('OV017544', 'Yes')] }
  };
  r = await K.ordensDoDia({ data: DIA });
  const ec = {}; r.ovs.forEach(o => { ec[o.numero] = o.etapa; });
  t('ACTIVE ativo -> Gerenciamento de Crédito', ec.OV017540 === 'credito' && ec.OV017543 === 'credito', ec);
  t('inativo ou sem registro -> segue a liberação', ec.OV017541 === 'liberado' && ec.OV017542 === 'liberado', ec);
  t('a tabela vale antes do cabeçalho', ec.OV017541 === 'liberado' && ec.OV017540 === 'credito', ec);
  t('faturada continua Faturado', ec.OV017544 === 'faturado', ec);
  const rg40 = r.ovs.find(o => o.numero === 'OV017540').regra, rg42 = r.ovs.find(o => o.numero === 'OV017542').regra, rg43 = r.ovs.find(o => o.numero === 'OV017543').regra;
  t('regra diz a fonte, a coluna e o valor', rg40.creditoFonte === 'tabela' && rg40.creditoAtivo === true && rg40.credito === 'Yes' && rg40.creditoCol === 'BioCredManTableV1Publica.ACTIVE' && rg40.creditoOv === 'SALESID', rg40);
  t('sem registro: inativo, 0 registros', rg42.creditoFonte === 'tabela' && rg42.creditoAtivo === false && rg42.creditoRegistros === 0 && rg42.credito === null, rg42);
  t('2 registros, decide o ativo', rg43.creditoRegistros === 2 && rg43.credito === 'Yes', rg43);
  t('a tabela entra nas fontes', r.fontes.some(f => f.entidade === 'BioCredManTableV1Publica' && f.papel === 'crédito'), r.fontes);
  t('o registro de crédito vai para os campos da OV', r.ovs.find(o => o.numero === 'OV017540').campos.BioCredManTableV1Publica.SALESID === 'OV017540', r.ovs.find(o => o.numero === 'OV017540').campos);
  const lc = chamadas.find(c => c.ent === 'BioCredManTableV1Publica' && /SALESID eq/.test(c.q.filter));
  t('lê a tabela pelo SALESID, só a MSB', lc && /dataAreaId eq 'msb'/.test(lc.q.filter), lc && lc.q.filter);
  t('sem aviso de crédito', !r.avisos.some(a => /crédito|CredMan/i.test(a)), r.avisos);

  console.log('4d) tabela de crédito fora do OData: cai no cabeçalho, com aviso');
  K._limparCache();
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines'];
  delete CEN.BioCredManTableV1Publica;
  r = await K.ordensDoDia({ data: DIA });
  const ed = {}; r.ovs.forEach(o => { ed[o.numero] = o.etapa; });
  t('cabeçalho decide: OV017541 (Yes) em crédito', ed.OV017541 === 'credito' && ed.OV017540 === 'criada', ed);
  t('fonte = cabeçalho', r.ovs.find(o => o.numero === 'OV017541').regra.creditoFonte === 'cabecalho', r.ovs.find(o => o.numero === 'OV017541').regra);
  t('aviso diz que a tabela não respondeu e por quê', r.avisos.some(a => /BioCredManTableV1Entity\) não respondeu/.test(a) && /credman/.test(a)), r.avisos);
  t('sem o "Não achei CredManInCreditControl" repetido', !r.avisos.some(a => /Não achei .*CredMan/.test(a)), r.avisos);

  console.log('4e) a entidade existe mas sem a coluna ACTIVE');
  K._limparCache();
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'BioCredManTableV1'];
  CEN.BioCredManTableV1 = { linhas: [{ dataAreaId: 'msb', SALESID: 'OV017540', STATUS: 'x' }] };
  r = await K.ordensDoDia({ data: DIA });
  t('aviso diz que falta a coluna ACTIVE', r.avisos.some(a => /BioCredManTableV1: sem a coluna ACTIVE/.test(a)), r.avisos);
  delete CEN.BioCredManTableV1;

  console.log('5) linhas de uma OV (a ficha do painel)');
  K._limparCache(); chamadas.length = 0;
  CEN = {
    SalesOrderLines: { linhas: [
      { dataAreaId: 'msb', SalesOrderNumber: 'OV017525', LineNumber: 2, ItemNumber: '73172', LineDescription: 'CAT BALAO 8MM', OrderedSalesQuantity: 2, SalesUnitSymbol: 'UN',
        SalesPrice: 400, LineDiscountAmount: 0, LineAmount: 800, SalesOrderLineStatus: 'Backorder', RequestedShippingDate: '2026-11-10T12:00:00Z',
        ConfirmedShippingDate: '1900-01-01T12:00:00Z', ShippingWarehouseId: 'RETCONSIGV' },
      { dataAreaId: 'msb', SalesOrderNumber: 'OV017525', LineNumber: 1, ItemNumber: '73171', LineDescription: 'CAT BALAO 7MM', OrderedSalesQuantity: 5, SalesUnitSymbol: 'UN',
        SalesPrice: 365, LineAmount: 1825, SalesOrderLineStatus: 'Backorder', ShippingWarehouseId: 'RETCONSIGV' },
      { dataAreaId: 'msb', SalesOrderNumber: 'OV099999', LineNumber: 1, ItemNumber: 'X', LineAmount: 1 }
    ] }
  };
  r = await K.linhasDaOv('ov017525');
  t('só as linhas da OV pedida, pela ordem da linha', r.linhas.length === 2 && r.linhas[0].item === '73171' && r.linhas[1].item === '73172', r.linhas);
  const l2 = r.linhas[1];
  t('produto, qtd × preço, valor e status', l2.produto === 'CAT BALAO 8MM' && l2.qtd === 2 && l2.preco === 400 && l2.valor === 800 && l2.status === 'Backorder' && l2.un === 'UN', l2);
  t('entrega pela data; 1900 = sem data', l2.entrega === '2026-11-10' && l2.confirmada === null, l2);
  t('entidade e número normalizado', r.entidade === 'SalesOrderLines' && r.numero === 'OV017525', r);
  const cl = chamadas.find(c => c.ent === 'SalesOrderLines');
  t('filtra a MSB e o número, sem $select', cl && /dataAreaId eq 'msb' and SalesOrderNumber eq 'OV017525'/.test(cl.q.filter) && !cl.q.select, cl && cl.q);
  const n1 = chamadas.length;
  r = await K.linhasDaOv('OV017525');
  t('2ª leitura vem do cache', r.cache === true && chamadas.length === n1);

  console.log('6) rota exige a área kanban (e ?ov=)');
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
  await fn(ctx, { method: 'GET', headers: {}, query: { ov: "OV1' or 1 eq 1" } });
  t('nº de OV inválido -> 400', ctx.res.status === 400, ctx.res.status);
  await fn(ctx, { method: 'GET', headers: {}, query: { ov: 'OV017525' } });
  t('?ov= devolve as linhas', ctx.res.status === 200 && ctx.res.body.linhas && ctx.res.body.linhas.length === 2, ctx.res.status);
  auth.requireArea = orig;

  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\ntudo ok');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
