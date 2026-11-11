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
global.fetch = async (url, opts) => {
  url = String(url);
  if (/login\.microsoftonline/.test(url)) return corpo({ access_token: 'tok', expires_in: 3600 });
  const u = new URL(url);
  if (u.pathname === '/data') return corpo({ value: SERVICO.map(n => ({ name: n, url: n })) });
  // escrita: PATCH Entidade(chave='x',...) -> grava no cenário
  if (opts && opts.method === 'PATCH') {
    const m = /^\/data\/(\w+)\((.*)\)$/.exec(decodeURIComponent(u.pathname));
    const chave = {}; (m ? m[2] : '').split(',').forEach(p => { const k = /(\w+)='([^']*)'/.exec(p); if (k) chave[k[1]] = k[2]; });
    const corpoReq = JSON.parse(opts.body || '{}');
    chamadas.push({ ent: m && m[1], metodo: 'PATCH', chave, corpo: corpoReq, cross: u.searchParams.get('cross-company') });
    const E = m && CEN[m[1]];
    if (E && E.somenteLeitura) return corpo({ error: { message: 'The entity is read-only' } }, 405);
    const alvo = E && E.linhas.find(r => Object.keys(chave).every(k => String(r[k]) === chave[k]));
    if (!alvo) return corpo({ error: { message: 'not found' } }, 404);
    Object.assign(alvo, corpoReq);
    return { ok: true, status: 204, text: async () => '', json: async () => null };
  }
  const ent = u.pathname.replace('/data/', '');
  const q = { filter: u.searchParams.get('$filter') || '', top: u.searchParams.get('$top'), select: u.searchParams.get('$select') };
  chamadas.push({ ent, q });
  const E = CEN[ent];
  if (!E) return corpo({ error: { message: 'not found' } }, 404);
  // linhas automáticas (10/11/26: OV sem linha vai para Criada): cada OV pedida
  // sem linha no cenário ganha 1 linha com lote, valor 0
  if (E.auto) {
    if (q.top === '1') return corpo({ value: E.linhas.length ? E.linhas.slice(0, 1) : [linhaAuto('OV000000')] });
    const pedidas = (q.filter.match(/SalesOrderNumber eq '[^']*'/g) || []).map(x => /'([^']*)'/.exec(x)[1]);
    const reais = E.linhas.filter(r => avalia(q.filter, r)), tem = new Set(reais.map(r => r.SalesOrderNumber));
    return corpo({ value: reais.concat(pedidas.filter(n => !tem.has(n)).map(linhaAuto)) });
  }
  if (q.top === '1') return corpo({ value: E.linhas.slice(0, 1) });
  // a entidade que não aceita o filtro de enum do OData (para testar a reserva)
  if (E.recusaEnum && /Microsoft\.Dynamics/.test(q.filter)) return corpo({ error: { message: 'enum' } }, 400);
  // o $filter avaliado de verdade: "e" / "ou" com parênteses, eq (texto e enum), ge/gt/le/lt
  if (q.filter) return corpo({ value: E.linhas.filter(r => avalia(q.filter, r)) });
  return corpo({ value: E.linhas });
};
// a linha automática segue a situação da OV (BIO ou V2): faturada -> linha Faturada etc.
const linhaAuto = (n) => {
  const h = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2'].map(e => CEN[e] && CEN[e].linhas.find(r => r.SalesOrderNumber === n)).filter(Boolean);
  const sit = (h.map(r => r.SalesStatus || r.SalesOrderStatus).find(v => v && v !== 'Backorder')) || 'Backorder';
  const st = /^invoiced$/i.test(sit) ? 'Invoiced' : /^delivered$/i.test(sit) ? 'Delivered' : /^cancel/i.test(sit) ? 'Canceled' : 'Backorder';
  return { dataAreaId: 'msb', SalesOrderNumber: n, LineNumber: 1, ItemNumber: 'IT-AUTO', LineAmount: 0, ItemBatchNumber: 'LT-AUTO', SalesOrderLineStatus: st };
};
function divide(s, sep) {
  const out = []; let nivel = 0, ini = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') nivel++; else if (s[i] === ')') nivel--;
    else if (!nivel && s.startsWith(sep, i)) { out.push(s.slice(ini, i)); ini = i + sep.length; i += sep.length - 1; }
  }
  out.push(s.slice(ini)); return out;
}
function avalia(f, r) {
  return divide(f, ' and ').every(p => {
    p = p.trim();
    if (p[0] === '(' && p[p.length - 1] === ')') return divide(p.slice(1, -1), ' or ').some(x => avalia(x, r));
    let m;
    if ((m = /^(\w+) eq Microsoft\.Dynamics\.DataEntities\.\w+'([^']*)'$/.exec(p))) return String(r[m[1]]) === m[2];
    if ((m = /^(\w+) eq '([^']*)'$/.exec(p))) return String(r[m[1]]) === m[2];
    if ((m = /^(\w+) (ge|gt|le|lt) (\S+)$/.exec(p))) {
      const v = String(r[m[1]] == null ? '' : r[m[1]]);
      return m[2] === 'ge' ? v >= m[3] : m[2] === 'gt' ? v > m[3] : m[2] === 'le' ? v <= m[3] : v < m[3];
    }
    return true;
  });
}

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
      b4('OV017520', 'Backorder', 'Released', 'No'),      // liberada -> Separação
      b4('OV017517', 'Invoiced', 'Released', 'No'),       // faturada E liberada (o print) -> Faturado
      b4('OV017516', 'Delivered', 'Released', 'No'),      // entregue -> Faturado ("o restante")
      b4('OV017515', 'Canceled', 'Open', 'No'),           // cancelada -> fora do quadro
      b4('OV017514', 'Ordem em aberto', 'Liberado', 'Não') // rótulos em português -> Separação
    ] },
    SalesOrderLines: { linhas: [{ dataAreaId: 'msb', SalesOrderNumber: 'OV017517', LineAmount: 1000 }, { dataAreaId: 'msb', SalesOrderNumber: 'OV017519', LineAmount: 50 }], auto: true }
  };
  r = await K.ordensDoDia({ data: DIA });
  const et = {}; r.ovs.forEach(o => { et[o.numero] = o.etapa; });
  t('Criada', et.OV017518 === 'criada', et);
  t('Gerenciamento de Crédito', et.OV017519 === 'credito', et);
  t('Separação (liberada)', et.OV017520 === 'liberado' && et.OV017514 === 'liberado', et);
  t('a coluna se chama Separação', r.etapas.find(e => e.id === 'liberado').nome === 'Separação', r.etapas);
  t('faturada + liberada = Faturado (OV017517)', et.OV017517 === 'faturado', et);
  t('entregue (romaneio, sem nota) = Aguardando Faturamento (11/11/26, provisório)', et.OV017516 === 'aguardando', et);
  t('cancelada fora do quadro', et.OV017515 === 'cancelada' && r.canceladas === 1, et);
  const ids = r.etapas.map(e => e.id), col = (id) => r.etapas.find(e => e.id === id);
  t('11 colunas na ordem do fluxo', ids.join(',') === 'pendencia,criada,credito,liberado,conferencia,cotacao,aguardando,faturado,rejeitada,pallet,expedicao', ids);
  t('Pendência antes de Criada, com regra (o lote) e vazia aqui', ids[0] === 'pendencia' && !col('pendencia').pendente && col('pendencia').qtd === 0 && col('pendencia').nome === 'Pendência', col('pendencia'));
  t('Aguardando Faturamento logo depois da Cotação', ids.indexOf('aguardando') === ids.indexOf('cotacao') + 1 && col('aguardando').nome === 'Aguardando Faturamento' && !col('aguardando').pendente, col('aguardando'));
  t('Rejeitada logo depois do Faturado, com regra', ids.indexOf('rejeitada') === ids.indexOf('faturado') + 1 && !col('rejeitada').pendente, col('rejeitada'));
  t('Pallet logo depois da Rejeitada, com regra', ids.indexOf('pallet') === ids.indexOf('rejeitada') + 1 && !col('pallet').pendente, col('pallet'));
  t('Expedição no fim, com regra', ids[ids.length - 1] === 'expedicao' && !col('expedicao').pendente, col('expedicao'));
  t('nenhuma coluna à espera de campos (11/11/26: a Pendência voltou, pelo lote)', !r.etapas.some(e => e.pendente), r.etapas.filter(e => e.pendente));
  t('linhas sem a coluna do lote: aviso e nada dividido', r.avisos.some(a => /não trazem o lote/.test(a)) && !r.ovs.some(o => o.parte), r.avisos);
  t('nomes das 11 colunas', r.etapas.map(e => e.nome).join('|') === 'Pendência|Criada|Gerenciamento de Crédito|Separação|Conferência|Cotação|Aguardando Faturamento|Faturado|Rejeitada|Pallet|Expedição', r.etapas.map(e => e.nome));
  t('contagem e valor por coluna', r.etapas.find(e => e.id === 'faturado').qtd === 1 && r.etapas.find(e => e.id === 'faturado').valor === 1000 && r.etapas.find(e => e.id === 'aguardando').qtd === 1 && r.etapas.find(e => e.id === 'credito').valor === 50, r.etapas);
  t('regra vem com os campos e a origem', r.ovs.find(o => o.numero === 'OV017517').regra.salesStatusCol === 'BIOSalesOrderHeaderV1.SalesStatus', r.ovs.find(o => o.numero === 'OV017517').regra);
  t('sem aviso de campo faltando', !r.avisos.some(a => /Não achei/.test(a)), r.avisos);

  console.log('4a) 11/11/26 veio do PI Pedidos: a OV com a Área Demandante (areademandante_Custom)');
  K._limparCache(); chamadas.length = 0;
  const guarda4a = CEN, serv4a = SERVICO;
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines'];
  CEN = {
    SalesOrderHeadersV2: { linhas: [v2('OV017601', DIA + 'T10:00:00Z', 'Backorder'), v2('OV017602', DIA + 'T11:00:00Z', 'Backorder'), v2('OV017603', DIA + 'T12:00:00Z', 'Backorder')] },
    BIOSalesOrderHeaderV1: { linhas: [
      Object.assign(b4('OV017601', 'Backorder', 'Open', 'No'), { AREADEMANDANTE_Custom: 'PEDIDOINTELIGENTE (VENDA RECORRENTE)' }),   // do PI (o nome sem caixa)
      Object.assign(b4('OV017602', 'Backorder', 'Open', 'No'), { AREADEMANDANTE_Custom: '' }),                                      // vazio: não é do PI
      Object.assign(b4('OV017603', 'Backorder', 'Open', 'No'), { AREADEMANDANTE_Custom: 'LICITACAO' })
    ] },
    SalesOrderLines: { linhas: [], auto: true }
  };
  r = await K.ordensDoDia({ data: DIA });
  const a4 = (n) => r.ovs.find(o => o.numero === n);
  t('com a Área Demandante -> veio do PI Pedidos, com o valor e a coluna', a4('OV017601').origemPi === true && a4('OV017601').areaDemandante === 'PEDIDOINTELIGENTE (VENDA RECORRENTE)'
    && a4('OV017601').areaCol === 'BIOSalesOrderHeaderV1.AREADEMANDANTE_Custom' && a4('OV017603').origemPi === true, a4('OV017601'));
  t('vazia -> não veio do PI', a4('OV017602').origemPi === false && a4('OV017602').areaDemandante === null, a4('OV017602').origemPi);
  t('com o campo nas entidades: sem aviso', !r.avisos.some(a => /Área Demandante/.test(a)), r.avisos);
  CEN.BIOSalesOrderHeaderV1.linhas.forEach(x => { delete x.AREADEMANDANTE_Custom; });
  K._limparCache(); r = await K.ordensDoDia({ data: DIA });
  t('sem o campo em nenhuma entidade: aviso, e ninguém marcado', r.avisos.some(a => /Área Demandante \(areademandante_Custom\) não está/.test(a)) && !r.ovs.some(o => o.origemPi), r.avisos);
  CEN = guarda4a; SERVICO = serv4a;

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
    SalesOrderLines: { linhas: [{ dataAreaId: 'msb', SalesOrderNumber: 'OV017530', LineAmount: 100 }, { dataAreaId: 'msb', SalesOrderNumber: 'OV017531', LineAmount: 900 }], auto: true }
  };
  r = await K.ordensDoDia({ data: DIA });
  t('só as OVs do ALMOX-PA', r.ovs.map(o => o.numero).sort().join(',') === 'OV017530,OV017533', r.ovs.map(o => o.numero));
  t('fora do quadro contadas à parte', r.foraDeposito === 2 && r.depositos.join() === 'ALMOX-PA', { fora: r.foraDeposito, dep: r.depositos });
  t('etapas e valor sem as de outro depósito', r.etapas.find(e => e.id === 'criada').qtd === 2 && r.etapas.find(e => e.id === 'criada').valor === 100 && r.etapas.find(e => e.id === 'faturado').qtd === 0, r.etapas);
  const stv = r.statusCols.find(x => x.chave === 'SalesOrderHeadersV2.SalesOrderStatus');
  t('contagem de status sem as de outro depósito', stv && stv.valores.Backorder === 2 && !stv.valores.Invoiced, stv && stv.valores);
  t('sem aviso de depósito', !r.avisos.some(a => /trouxe o depósito/.test(a)), r.avisos);
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
      b4('OV017541', 'Backorder', 'Released', 'Yes'),    // tabela INATIVA -> Separação (o cabeçalho diz Yes: a tabela vale)
      b4('OV017542', 'Backorder', 'Released', 'No'),     // sem registro na tabela -> Separação
      b4('OV017543', 'Backorder', 'Open', 'No'),         // 2 registros, um ativo -> crédito
      b4('OV017544', 'Invoiced', 'Released', 'No')       // faturada: a situação vale antes do crédito
    ] },
    SalesOrderLines: { linhas: [], auto: true },
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

  console.log('4f) Separação e Conferência pelo trabalho de depósito (WorkStatus)');
  K._limparCache(); chamadas.length = 0;
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'WHSWorkTableBiEntities'];
  const w = (ov, id, st, extra) => Object.assign({ dataAreaId: 'msb', OrderNum: ov, WorkId: id, WorkStatus: st, WorkTransType: 'Sales', LockedUser: 'joao',
    WorkInProcessUTCDateTime: '2026-11-06T14:00:00Z', WorkClosedUTCDateTime: st === 'Closed' ? '2026-11-06T15:00:00Z' : '1900-01-01T00:00:00Z', WaveId: 'WAV1', LoadId: 'LD1' }, extra || {});
  const ovsW = ['OV017550', 'OV017551', 'OV017552', 'OV017553', 'OV017554', 'OV017555', 'OV017556', 'OV017557', 'OV017558'];
  CEN = {
    SalesOrderHeadersV2: { linhas: ovsW.map((n, i) => v2(n, DIA + 'T1' + i + ':00:00Z', 'Backorder')) },
    BIOSalesOrderHeaderV1: { linhas: [
      b4('OV017550', 'Backorder', 'Released', 'No'),        // trabalho em processo -> Conferência (10/11: Separação é só Abrir)
      b4('OV017551', 'Backorder', 'Released', 'No'),        // trabalho fechado -> Conferência
      b4('OV017552', 'Backorder', 'Released', 'No'),        // fechado + cancelado -> Conferência (cancelado não conta)
      b4('OV017553', 'Backorder', 'Released', 'No'),        // fechado + aberto -> 2 cartões: Separação + Conferência
      b4('OV017554', 'Backorder', 'Open', 'No'),            // não liberada, sem trabalho -> Criada
      b4('OV017555', 'Invoiced', 'Released', 'No'),         // faturada -> Faturado (mesmo com trabalho fechado)
      b4('OV017556', 'Backorder', 'Released', 'Yes'),       // crédito marcado -> Crédito (antes do trabalho)
      b4('OV017557', 'Backorder', 'Released', 'No'),        // liberada, sem trabalho ainda -> Criada (10/11)
      b4('OV017558', 'Backorder', 'PartialReleased', 'No')  // parcialmente liberada, trabalho aberto -> Separação
    ] },
    SalesOrderLines: { linhas: [], auto: true },
    WHSWorkTableBiEntities: { linhas: [
      w('OV017550', 'W1', 'InProcess'), w('OV017551', 'W2', 'Closed'), w('OV017552', 'W3', 'Closed'), w('OV017552', 'W4', 'Cancelled'),
      w('OV017553', 'W5', 'Closed'), w('OV017553', 'W6', 'Open'), w('OV017555', 'W7', 'Closed'), w('OV017556', 'W8', 'Closed'), w('OV017558', 'W9', 'Open')
    ] }
  };
  r = await K.ordensDoDia({ data: DIA });
  const ew = {}; r.ovs.forEach(o => { ew[o.chave || o.numero] = o.etapa; });
  // 10/11/26 (dono): "a Separação só pode abranger o trabalho = Abrir"
  t('em processo -> já não é Separação: Conferência', ew.OV017550 === 'conferencia', ew);
  t('trabalho fechado, carga sem fase -> Conferência', ew.OV017551 === 'conferencia', ew);
  t('fechado + cancelado, sem carga -> Conferência', ew.OV017552 === 'conferencia', ew);
  t('fechado + aberto -> 2 cartões: Separação (o aberto) e Conferência (o fechado)', ew['OV017553~abrir'] === 'liberado' && ew['OV017553~outros'] === 'conferencia' && !ew.OV017553, ew);
  t('não liberada, sem trabalho -> Criada', ew.OV017554 === 'criada', ew);
  t('faturada vale antes do trabalho', ew.OV017555 === 'faturado', ew);
  t('crédito vale antes do trabalho', ew.OV017556 === 'credito', ew);
  t('liberada SEM trabalho -> Criada (Separação é só trabalho Abrir)', ew.OV017557 === 'criada', ew);
  t('parcialmente liberada com trabalho aberto -> Separação', ew.OV017558 === 'liberado', ew);
  const o53a = r.ovs.find(o => o.chave === 'OV017553~abrir'), o53b = r.ovs.find(o => o.chave === 'OV017553~outros'), o52 = r.ovs.find(o => o.numero === 'OV017552');
  t('cada cartão com SÓ os seus trabalhos e a contagem deles', o53a.trabalhos.map(x => x.id).join() === 'W6' && o53b.trabalhos.map(x => x.id).join() === 'W5'
    && o53a.regra.trabalho.fase === 'aberto' && o53a.regra.trabalho.abertos === 1 && o53b.regra.trabalho.fase === 'fechado' && o53b.regra.trabalho.fechados === 1 && o53b.regra.trabalho.coluna === 'WHSWorkTableBiEntities.WorkStatus', [o53a.regra.trabalho, o53b.regra.trabalho]);
  t('as partes se apontam; valor da parte vazio (o da OV fica)', o53a.parteTrab.outra.chave === 'OV017553~outros' && o53a.parteTrab.outra.etapa === 'conferencia' && o53b.parteTrab.outra.etapa === 'liberado'
    && o53a.parteTrab.n === 1 && o53a.parteTrab.de === 2 && o53a.valor === null && o53a.valorOv === 0 && o53a.podePallet === false, o53a.parteTrab);
  t('cancelado contado à parte', o52.regra.trabalho.total === 1 && o52.regra.trabalho.ignorados === 1 && o52.regra.trabalho.fase === 'fechado', o52.regra.trabalho);
  const tw = r.ovs.find(o => o.numero === 'OV017551').trabalhos[0];
  t('lista de trabalhos da OV: id, status, quem, início/fim, onda, carga', tw.id === 'W2' && tw.status === 'Closed' && tw.usuario === 'joao' && tw.inicio === '2026-11-06T14:00:00Z' && tw.fim === '2026-11-06T15:00:00Z' && tw.onda === 'WAV1' && tw.carga === 'LD1', tw);
  t('data vazia (1900) do trabalho = sem data', r.ovs.find(o => o.numero === 'OV017550').trabalhos[0].fim === null, r.ovs.find(o => o.numero === 'OV017550').trabalhos[0]);
  t('o trabalho entra nos campos da OV', r.ovs.find(o => o.numero === 'OV017550').campos.WHSWorkTableBiEntities.WorkId === 'W1', Object.keys(r.ovs.find(o => o.numero === 'OV017550').campos));
  t('sem trabalho: fase nula, total 0', r.ovs.find(o => o.numero === 'OV017557').regra.trabalho.fase === null && r.ovs.find(o => o.numero === 'OV017557').trabalhos.length === 0);
  t('a entidade entra nas fontes', r.fontes.some(f => f.entidade === 'WHSWorkTableBiEntities' && f.papel === 'trabalho'), r.fontes);
  const lw = chamadas.find(c => c.ent === 'WHSWorkTableBiEntities' && /OrderNum eq/.test(c.q.filter));
  t('lê pelo OrderNum, só a MSB', lw && /dataAreaId eq 'msb'/.test(lw.q.filter), lw && lw.q.filter);
  t('sem aviso de trabalho', !r.avisos.some(a => /trabalho de depósito/.test(a)), r.avisos);
  t('Conferência: os 3 sem trabalho aberto + a parte fechada da OV017553', r.etapas.find(e => e.id === 'conferencia').qtd === 4 && r.etapas.find(e => e.id === 'liberado').qtd === 2, r.etapas.filter(e => e.qtd))

  console.log('4f2) 10/11/26 o split pelos trabalhos: 1 Abrir + 1 fechado já faturado / carregado');
  K._limparCache(); chamadas.length = 0;
  const guarda4f2 = CEN, serv4f2 = SERVICO;
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'WHSWorkTableBiEntities', 'WHSOutboundLoadHeaderEntities', 'SalesInvoiceHeadersV2', 'FiscalDocuments'];
  const nf2 = (ov, n) => ({ dataAreaId: 'msb', SalesOrderNumber: ov, InvoiceNumber: n, InvoiceDate: DIA + 'T12:00:00Z', TotalInvoiceAmount: 100 });
  const fd2 = (n, st) => ({ dataAreaId: 'msb', FiscalDocumentNumber: n, Status: st, FiscalDocumentDate: DIA + 'T12:00:00Z' });
  CEN = {
    SalesOrderHeadersV2: { linhas: ['OV017570', 'OV017571', 'OV017572'].map((n, i) => v2(n, DIA + 'T1' + i + ':00:00Z', 'Backorder')) },
    BIOSalesOrderHeaderV1: { linhas: ['OV017570', 'OV017571', 'OV017572'].map(n => b4(n, 'Backorder', 'Released', 'No')) },
    // OV017570: 1 linha FATURADA + 1 em aberto (a do trabalho aberto e a do fechado)
    SalesOrderLines: { linhas: [
      { dataAreaId: 'msb', SalesOrderNumber: 'OV017570', LineNumber: 1, ItemNumber: 'IT-1', LineAmount: 700, ItemBatchNumber: 'LT-1', SalesOrderLineStatus: 'Invoiced' },
      { dataAreaId: 'msb', SalesOrderNumber: 'OV017570', LineNumber: 2, ItemNumber: 'IT-2', LineAmount: 300, ItemBatchNumber: 'LT-2', SalesOrderLineStatus: 'Backorder' }
    ], auto: true },
    WHSWorkTableBiEntities: { linhas: [
      w('OV017570', 'W70A', 'Open', { LoadId: 'LD-70A' }), w('OV017570', 'W70B', 'Closed', { LoadId: 'LD-70B' }),   // 1 aberto + 1 fechado (carga Carregado + cotação Sim, NF aprovada)
      w('OV017571', 'W71A', 'Open', { LoadId: 'LD-71' }), w('OV017571', 'W71B', 'Closed', { LoadId: 'LD-71' }),    // os dois na MESMA carga, Em processamento
      w('OV017572', 'W72', 'Open', { LoadId: 'LD-71' })                                                           // só aberto, carga já em processamento (por outra OV)
    ] },
    WHSOutboundLoadHeaderEntities: { linhas: [
      { dataAreaId: 'msb', LoadId: 'LD-70A', LoadStatus: 'Waved', QuotationPerformed_InoveProjects: 'No', ENVIARPALLET_CUSTOM: 'No' },
      { dataAreaId: 'msb', LoadId: 'LD-70B', LoadStatus: 'Loaded', QuotationPerformed_InoveProjects: 'Yes', ENVIARPALLET_CUSTOM: 'No' },
      { dataAreaId: 'msb', LoadId: 'LD-71', LoadStatus: 'InProcess', QuotationPerformed_InoveProjects: 'No', ENVIARPALLET_CUSTOM: 'No' }
    ] },
    SalesInvoiceHeadersV2: { linhas: [nf2('OV017570', '000077001')] },
    FiscalDocuments: { linhas: [fd2('000077001', 'Approved')] }
  };
  r = await K.ordensDoDia({ data: DIA });
  const e2 = {}; r.ovs.forEach(o => { e2[o.chave] = o; });
  // 11/11/26: a linha FATURADA -> Faturado; a em aberto: trabalho aberto -> Separação, o fechado
  // (carga Carregado + linha em aberto) -> Cotação
  const a70 = e2['OV017570~cotacao~abrir'], o70 = e2['OV017570~cotacao~outros'], f70 = e2['OV017570~faturado'];
  t('linha Faturada -> Faturado; a em aberto: Separação (trabalho Abrir) + Cotação (carga Carregado)', f70 && f70.etapa === 'faturado' && f70.valor === 700 && a70 && a70.etapa === 'liberado' && o70 && o70.etapa === 'cotacao', Object.keys(e2).map(k => k + '=' + e2[k].etapa));
  t('cada parte com as suas cargas; o Pallet só na parte carregada', a70.cargas.map(c => c.id).join() === 'LD-70A' && o70.cargas.map(c => c.id).join() === 'LD-70B'
    && a70.podePallet === false && o70.podePallet === true, [a70.cargas, o70.podePallet]);
  t('a mesma carga em processamento: Separação (o aberto) + Conferência (o fechado)', e2['OV017571~abrir'] && e2['OV017571~abrir'].etapa === 'liberado' && e2['OV017571~outros'].etapa === 'conferencia', Object.keys(e2));
  t('só trabalho aberto, mesmo com a carga em processamento: Separação, 1 cartão', e2.OV017572 && e2.OV017572.etapa === 'liberado' && !e2.OV017572.parteTrab, e2.OV017572 && e2.OV017572.etapa);
  t('o campo interno da divisão não vai na resposta', !r.ovs.some(o => '_trab' in o));
  t('cada cartão lista os outros cartões da OV (os 3)', a70.irmas.length === 2 && a70.irmas.map(x => x.chave).sort().join() === 'OV017570~cotacao~outros,OV017570~faturado' && !e2.OV017572.irmas, a70.irmas);
  CEN = guarda4f2; SERVICO = serv4f2;

  console.log('4g) entidade de trabalho fora do OData: Separação pelo ReleaseStatus, com aviso');
  K._limparCache();
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines'];
  delete CEN.WHSWorkTableBiEntities;
  r = await K.ordensDoDia({ data: DIA });
  const eg = {}; r.ovs.forEach(o => { eg[o.numero] = o.etapa; });
  t('sem a entidade: liberada -> Separação; ninguém em Conferência', eg.OV017551 === 'liberado' && eg.OV017558 === 'criada' && !r.ovs.some(o => o.etapa === 'conferencia'), eg);
  t('aviso diz que a entidade não respondeu', r.avisos.some(a => /WHSWorkTableBiEntity\) não respondeu/.test(a) && /worktable/.test(a)), r.avisos);
  t('regra.trabalho nulo', r.ovs.every(o => o.regra.trabalho === null && o.trabalhos.length === 0));

  console.log('4h) cargas (WHSOutboundLoadHeaderEntity) pelo LoadId dos trabalhos — só leitura');
  K._limparCache(); chamadas.length = 0;
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'WHSWorkTableBiEntities', 'WHSOutboundLoadHeaderEntities'];
  CEN = {
    SalesOrderHeadersV2: { linhas: ['OV017560', 'OV017561', 'OV017562'].map((n, i) => v2(n, DIA + 'T1' + i + ':00:00Z', 'Backorder')) },
    BIOSalesOrderHeaderV1: { linhas: [b4('OV017560', 'Backorder', 'Released', 'No'), b4('OV017561', 'Backorder', 'Released', 'No'), b4('OV017562', 'Backorder', 'Released', 'No')] },
    SalesOrderLines: { linhas: [], auto: true },
    WHSWorkTableBiEntities: { linhas: [
      w('OV017560', 'W1', 'Closed', { LoadId: 'LD-100' }), w('OV017560', 'W2', 'Closed', { LoadId: 'LD-100' }),   // a mesma carga, 2 trabalhos
      w('OV017561', 'W3', 'InProcess', { LoadId: 'LD-200' }),
      w('OV017562', 'W4', 'Open', { LoadId: '' })                                                                    // trabalho sem carga
    ] },
    WHSOutboundLoadHeaderEntities: { linhas: [
      { dataAreaId: 'msb', LoadId: 'LD-100', LoadStatus: 'Loaded', CarrierCode: 'TRANSP-SUL', CarrierServiceCode: 'RODO', LoadSchedShipUTCDateTime: '2026-11-07T12:00:00Z', InventLocationId: 'ALMOX-PA' },
      { dataAreaId: 'msb', LoadId: 'LD-200', LoadStatus: 'Open', CarrierCode: '', InventLocationId: 'ALMOX-PA' }
    ] }
  };
  r = await K.ordensDoDia({ data: DIA });
  const c60 = r.ovs.find(o => o.numero === 'OV017560'), c61 = r.ovs.find(o => o.numero === 'OV017561'), c62 = r.ovs.find(o => o.numero === 'OV017562');
  t('a carga da OV pelo LoadId dos trabalhos (uma só, mesmo com 2 trabalhos)', c60.cargas.length === 1 && c60.cargas[0].id === 'LD-100' && c60.cargas[0].status === 'Loaded', c60.cargas);
  t('transportadora, serviço, envio previsto e depósito', c60.cargas[0].transportadora === 'TRANSP-SUL' && c60.cargas[0].servico === 'RODO' && c60.cargas[0].envio === '2026-11-07T12:00:00Z' && c60.cargas[0].deposito === 'ALMOX-PA', c60.cargas[0]);
  t('outra OV, outra carga', c61.cargas.length === 1 && c61.cargas[0].id === 'LD-200' && c61.cargas[0].status === 'Open', c61.cargas);
  t('trabalho sem carga: nenhuma carga', c62.cargas.length === 0, c62.cargas);
  t('a carga entra nos campos crus da OV', c60.campos.WHSOutboundLoadHeaderEntities && c60.campos.WHSOutboundLoadHeaderEntities.LoadId === 'LD-100', Object.keys(c60.campos));
  t('fonte da carga e na lista de fontes', c60.cargaFonte === 'WHSOutboundLoadHeaderEntities.LoadStatus' && r.fontes.some(f => f.papel === 'carga' && f.cargas === 2), r.fontes);
  const lcg = chamadas.find(c => c.ent === 'WHSOutboundLoadHeaderEntities' && /LoadId eq/.test(c.q.filter));
  t('lê as cargas pelo LoadId, só a MSB, de uma vez', lcg && /dataAreaId eq 'msb'/.test(lcg.q.filter) && /LD-100/.test(lcg.q.filter) && /LD-200/.test(lcg.q.filter), lcg && lcg.q.filter);
  t('carga Carregado (sem a coluna de cotação) -> Cotação; trabalho em processo com a carga Aberta -> Conferência (não é mais Separação)', c60.etapa === 'cotacao' && c61.etapa === 'conferencia' && c62.etapa === 'liberado', { c60: c60.etapa, c61: c61.etapa, c62: c62.etapa });
  t('aviso: sem as colunas de cotação e de pallet', r.avisos.some(a => /não achei "Cotação realizada".*ENVIARPALLET_CUSTOM/.test(a)), r.avisos);
  t('sem o botão do pallet (sem a coluna)', c60.podePallet === false, c60.podePallet);

  console.log('4i) entidade de cargas fora do OData: aviso só quando há carga para procurar');
  K._limparCache();
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'WHSWorkTableBiEntities'];
  delete CEN.WHSOutboundLoadHeaderEntities;
  r = await K.ordensDoDia({ data: DIA });
  t('aviso diz que a entidade de cargas não respondeu', r.avisos.some(a => /WHSOutboundLoadHeaderEntity\) não respondeu/.test(a) && /outboundload/.test(a)), r.avisos);
  t('a carga aparece só com o LoadId (sem status)', r.ovs.find(o => o.numero === 'OV017560').cargas[0].id === 'LD-100' && r.ovs.find(o => o.numero === 'OV017560').cargaFonte === null);
  K._limparCache();
  CEN.WHSWorkTableBiEntities.linhas = CEN.WHSWorkTableBiEntities.linhas.map(x => Object.assign({}, x, { LoadId: '' }));
  r = await K.ordensDoDia({ data: DIA });
  t('sem LoadId nos trabalhos: nem procura a entidade, nem avisa', !r.avisos.some(a => /cargas/.test(a)) && !r.diagnostico.some(d => /^carga:/.test(d.etapa)), r.avisos);

  console.log('4j) notas fiscais da OV e a coluna Rejeitada (NF rejeitada / cancelada / descartada)');
  K._limparCache(); chamadas.length = 0;
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'SalesInvoiceHeadersV2', 'FiscalDocuments'];
  const ovsN = ['OV017570', 'OV017571', 'OV017572', 'OV017573', 'OV017574', 'OV017575', 'OV017576'];
  const nf = (ov, n, data) => ({ dataAreaId: 'msb', SalesOrderNumber: ov, InvoiceNumber: n, InvoiceDate: data + 'T12:00:00Z', TotalInvoiceAmount: 100 });
  const fd = (n, st, data) => ({ dataAreaId: 'msb', FiscalDocumentNumber: n, Status: st, FiscalDocumentDate: data + 'T12:00:00Z' });
  CEN = {
    SalesOrderHeadersV2: { linhas: ovsN.map((n, i) => v2(n, DIA + 'T1' + i + ':00:00Z', 'Backorder')) },
    BIOSalesOrderHeaderV1: { linhas: [
      b4('OV017570', 'Invoiced', 'Released', 'No'),   // NF aprovada -> Faturado (com o número)
      b4('OV017571', 'Invoiced', 'Released', 'No'),   // NF rejeitada -> Rejeitada
      b4('OV017572', 'Invoiced', 'Released', 'No'),   // NF cancelada -> Rejeitada
      b4('OV017573', 'Backorder', 'Released', 'No'),  // NF descartada (a OV voltou a "em aberto") -> Rejeitada
      b4('OV017574', 'Invoiced', 'Released', 'No'),   // 1ª rejeitada, reemitida e aprovada -> Faturado
      b4('OV017575', 'Invoiced', 'Released', 'No'),   // nota sem status no documento fiscal -> Faturado
      b4('OV017576', 'Canceled', 'Open', 'No')        // OV cancelada: fica cancelada (fora do quadro)
    ] },
    SalesOrderLines: { linhas: [], auto: true },
    SalesInvoiceHeadersV2: { linhas: [
      nf('OV017570', '000021470', DIA), nf('OV017571', '000021471', DIA), nf('OV017572', '000021472', DIA), nf('OV017573', '000021473', DIA),
      nf('OV017574', '000021474', DIA), nf('OV017574', '000021480', DIA.slice(0, 8) + '07'), nf('OV017575', '000021475', DIA), nf('OV017576', '000021476', DIA)
    ] },
    FiscalDocuments: { linhas: [
      fd('000021470', 'Approved', DIA), fd('000021471', 'Rejected', DIA), fd('000021472', 'Cancelled', DIA), fd('000021473', 'Discarded', DIA),
      fd('000021474', 'Rejected', DIA), fd('000021480', 'Approved', DIA.slice(0, 8) + '07'), fd('000021476', 'Cancelled', DIA)
    ] }
  };
  r = await K.ordensDoDia({ data: DIA });
  const en = {}; r.ovs.forEach(o => { en[o.numero] = o.etapa; });
  t('NF aprovada -> Faturado', en.OV017570 === 'faturado', en);
  t('NF rejeitada -> Rejeitada', en.OV017571 === 'rejeitada', en);
  t('NF cancelada -> Rejeitada', en.OV017572 === 'rejeitada', en);
  t('NF descartada -> Rejeitada (mesmo com a OV em aberto)', en.OV017573 === 'rejeitada', en);
  t('reemitida e aprovada (a mais recente vale) -> Faturado', en.OV017574 === 'faturado', en);
  t('nota sem status -> Faturado', en.OV017575 === 'faturado', en);
  t('OV cancelada continua fora do quadro', en.OV017576 === 'cancelada', en);
  const n70 = r.ovs.find(o => o.numero === 'OV017570'), n71 = r.ovs.find(o => o.numero === 'OV017571'), n74 = r.ovs.find(o => o.numero === 'OV017574');
  t('o número da nota vai para a OV', n70.nota && n70.nota.numero === '000021470' && n70.nota.aprovada === true && n70.nota.status === 'Approved', n70.nota);
  t('a nota rejeitada diz o status e a fonte', n71.nota.rejeitada === true && n71.nota.status === 'Rejected' && n71.nota.fonte === 'FiscalDocuments.Status', n71.nota);
  t('duas notas: a mais recente primeiro, e é ela que vale', n74.notas.length === 2 && n74.notas[0].numero === '000021480' && n74.nota.numero === '000021480' && n74.notas[1].rejeitada === true, n74.notas);
  t('a nota sem status também mostra o número', r.ovs.find(o => o.numero === 'OV017575').nota.numero === '000021475');
  t('Rejeitada conta na coluna', r.etapas.find(e => e.id === 'rejeitada').qtd === 3, r.etapas);
  t('notas e status nas fontes', r.fontes.some(f => f.papel === 'notas' && f.notas === 8 && f.status.indexOf('FiscalDocuments.Status') >= 0), r.fontes);
  const ln = chamadas.find(c => c.ent === 'SalesInvoiceHeadersV2' && /SalesOrderNumber eq/.test(c.q.filter));
  t('lê as notas pelo nº da OV, só a MSB', ln && /dataAreaId eq 'msb'/.test(ln.q.filter), ln && ln.q.filter);
  t('sem aviso de nota', !r.avisos.some(a => /nota fiscal|notas fiscais/.test(a)), r.avisos);

  console.log('4k) sem o status da nota no OData: o número aparece, a Rejeitada fica vazia, com aviso');
  K._limparCache();
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'SalesInvoiceHeadersV2'];
  delete CEN.FiscalDocuments;
  r = await K.ordensDoDia({ data: DIA });
  t('ninguém em Rejeitada; o número continua', !r.ovs.some(o => o.etapa === 'rejeitada') && r.ovs.find(o => o.numero === 'OV017571').nota.numero === '000021471', r.ovs.map(o => o.etapa));
  t('aviso do status da nota', r.avisos.some(a => /Não achei o status da nota fiscal/.test(a)), r.avisos);

  console.log('4l) status da nota pela FiscalDocumentBioEntity (a 000021497 "sem status", aprovada no D365)');
  K._limparCache(); chamadas.length = 0;
  // 9 entidades fiscais publicadas antes da da Bio: o corte de 8 não pode deixá-la de fora
  const extras = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map(x => 'FiscalDocumentExtra' + x);
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'SalesInvoiceHeadersV2', 'FiscalDocuments'].concat(extras, ['FiscalDocumentBioV2Entities']);
  CEN = {
    SalesOrderHeadersV2: { linhas: [v2('OV017526', DIA + 'T13:00:00Z', 'Backorder')] },
    BIOSalesOrderHeaderV1: { linhas: [b4('OV017526', 'Invoiced', 'Released', 'No')] },
    SalesOrderLines: { linhas: [], auto: true },
    SalesInvoiceHeadersV2: { linhas: [nf('OV017526', '000021497', DIA)] },
    // a FiscalDocuments só tem um documento de 2023 com o mesmo número (não vale: data longe)
    FiscalDocuments: { linhas: [fd('000021497', 'Cancelled', '2023-03-01')] },
    FiscalDocumentBioV2Entities: { linhas: [{ dataAreaId: 'msb', FiscalDocumentNumber: '000021497', Status: 'Approved', FiscalDocumentDate: DIA + 'T12:00:00Z' }] }
  };
  r = await K.ordensDoDia({ data: DIA });
  const n97 = r.ovs.find(o => o.numero === 'OV017526');
  t('a nota sai Aprovada pela entidade da Bio', n97.nota && n97.nota.status === 'Approved' && n97.nota.aprovada === true && n97.nota.fonte === 'FiscalDocumentBioV2Entities.Status', n97.nota);
  t('o documento antigo (2023) da FiscalDocuments não empresta o "Cancelled"', n97.etapa === 'faturado' && !n97.nota.rejeitada, n97.etapa);
  t('a entidade da Bio foi testada mesmo com 9 fiscais antes dela', chamadas.some(c => c.ent === 'FiscalDocumentBioV2Entities'), chamadas.map(c => c.ent).filter((x, i, a) => a.indexOf(x) === i));

  console.log('7) o QUADRO: em aberto de qualquer data + Faturado/Rejeitada só no período');
  K._limparCache(); chamadas.length = 0;
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'SalesInvoiceHeadersV2', 'FiscalDocuments'];
  const DE = '2026-11-01', ATE = '2026-11-06';
  CEN = {
    SalesOrderHeadersV2: { linhas: [
      v2('OV018001', '2025-03-10T13:00:00Z', 'Backorder'),                                            // aberta há mais de 1 ano -> Criada
      v2('OV018002', '2026-10-01T13:00:00Z', 'Backorder'),                                            // aberta e liberada -> Separação
      v2('OV018003', '2025-01-01T13:00:00Z', 'Backorder', { DefaultShippingWarehouseId: 'RETCONSIGV' }), // outro depósito -> fora
      v2('OV018004', '2026-10-20T13:00:00Z', 'Invoiced'),                                             // nota em 05/11 (no período) -> Faturado
      v2('OV018005', '2026-09-01T13:00:00Z', 'Invoiced'),                                             // nota em 15/10 (fora) -> não vem
      v2('OV018006', '2026-11-02T13:00:00Z', 'Backorder'),                                            // nota rejeitada em 03/11 -> Rejeitada
      v2('OV018007', '2026-08-01T13:00:00Z', 'Backorder'),                                            // nota rejeitada em 01/10 -> fora do período
      v2('OV018008', '2024-12-12T13:00:00Z', 'Canceled')                                              // cancelada, sem nota -> não vem
    ] },
    BIOSalesOrderHeaderV1: { linhas: [
      b4('OV018001', 'Backorder', 'Open', 'No'), b4('OV018002', 'Backorder', 'Released', 'No'), b4('OV018004', 'Invoiced', 'Released', 'No'),
      b4('OV018006', 'Backorder', 'Released', 'No'), b4('OV018007', 'Backorder', 'Released', 'No')
    ] },
    SalesOrderLines: { linhas: [], auto: true },
    SalesInvoiceHeadersV2: { linhas: [nf('OV018004', '000030004', '2026-11-05'), nf('OV018005', '000030005', '2026-10-15'), nf('OV018006', '000030006', '2026-11-03'), nf('OV018007', '000030007', '2026-10-01')] },
    FiscalDocuments: { linhas: [fd('000030004', 'Approved', '2026-11-05'), fd('000030005', 'Approved', '2026-10-15'), fd('000030006', 'Rejected', '2026-11-03'), fd('000030007', 'Rejected', '2026-10-01')] }
  };
  r = await K.quadro({ de: DE, ate: ATE });
  const eq = {}; r.ovs.forEach(o => { eq[o.numero] = o.etapa; });
  t('modo quadro com o período', r.modo === 'quadro' && r.de === DE && r.ate === ATE && r.datadas.join() === 'rejeitada,expedicao', { modo: r.modo, de: r.de, ate: r.ate, datadas: r.datadas });
  t('em aberto de QUALQUER data (até de 2025)', eq.OV018001 === 'criada' && eq.OV018002 === 'liberado', eq);
  t('faturada com nota no período -> Faturado', eq.OV018004 === 'faturado', eq);
  t('rejeitada com nota no período -> Rejeitada', eq.OV018006 === 'rejeitada', eq);
  t('faturada fora do período, rejeitada fora do período, cancelada e outro depósito: fora', !eq.OV018005 && !eq.OV018007 && !eq.OV018008 && !eq.OV018003, eq);
  t('rejeitada fora do período contada à parte', r.foraPeriodo === 1, r.foraPeriodo);
  const lab = chamadas.find(c => c.ent === 'SalesOrderHeadersV2' && /Backorder/.test(c.q.filter));
  t('em aberto: filtro pelo status (enum) e pelo depósito, SEM data', lab && /SalesOrderStatus eq Microsoft\.Dynamics\.DataEntities\.SalesStatus'Backorder'/.test(lab.q.filter) && /DefaultShippingWarehouseId eq 'ALMOX-PA'/.test(lab.q.filter) && !/OrderCreationDateTime/.test(lab.q.filter), lab && lab.q.filter);
  const lper = chamadas.find(c => c.ent === 'SalesInvoiceHeadersV2' && / ge /.test(c.q.filter));
  t('período: o diário pela InvoiceDate, de 01/11 até 06/11 inclusive', lper && /InvoiceDate ge 2026-11-01T00:00:00Z and InvoiceDate lt 2026-11-07T00:00:00Z/.test(lper.q.filter), lper && lper.q.filter);
  const nq = chamadas.length;
  r = await K.quadro({ de: DE, ate: ATE });
  t('2ª leitura do mesmo período vem do cache', r.cache === true && chamadas.length === nq);
  r = await K.quadro({ de: '2026-10-01', ate: ATE });
  const eq2 = {}; r.ovs.forEach(o => { eq2[o.numero] = o.etapa; });
  t('período maior traz a faturada de 15/10 e a rejeitada de 01/10', eq2.OV018005 === 'faturado' && eq2.OV018007 === 'rejeitada' && eq2.OV018001 === 'criada', eq2);
  r = await K.quadro({ de: ATE, ate: DE });
  t('de/até trocados são acertados', r.de === DE && r.ate === ATE, { de: r.de, ate: r.ate });

  console.log('7a) 10/11/26 Faturado SEM data: as faturadas com a carga Carregado, de qualquer data');
  K._limparCache(); chamadas.length = 0;
  const guarda7a = CEN, serv7a = SERVICO;
  const ldF = (id, st, cot, pal) => ({ dataAreaId: 'msb', LoadId: id, LoadStatus: st, QuotationPerformed_InoveProjects: cot, ENVIARPALLET_CUSTOM: pal });
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'SalesInvoiceHeadersV2', 'FiscalDocuments', 'WHSWorkTableBiEntities', 'WHSOutboundLoadHeaderEntities'];
  CEN = {
    SalesOrderHeadersV2: { linhas: [
      v2('OV018301', '2026-09-10T13:00:00Z', 'Invoiced'),    // nota de 20/10 (antes do período), carga Carregado -> Faturado
      v2('OV018302', '2026-09-11T13:00:00Z', 'Invoiced'),    // nota de 21/10, carga Carregado + Pallet Sim -> Pallet (11/11/26: sem data)
      v2('OV018303', '2026-09-12T13:00:00Z', 'Invoiced'),    // nota de 22/10, carga Remetido -> não vem
      v2('OV018304', '2026-08-01T13:00:00Z', 'Backorder'),   // em aberto com 1 linha FATURADA (parcial) -> essa parte em Faturado (antes sumia)
      v2('OV018305', '2026-11-02T13:00:00Z', 'Backorder')    // em aberto, carga Carregado, sem nota -> Cotação
    ] },
    BIOSalesOrderHeaderV1: { linhas: [b4('OV018301', 'Invoiced', 'Released', 'No'), b4('OV018302', 'Invoiced', 'Released', 'No'), b4('OV018303', 'Invoiced', 'Released', 'No'),
      b4('OV018304', 'Backorder', 'Released', 'No'), b4('OV018305', 'Backorder', 'Released', 'No')] },
    SalesOrderLines: { linhas: [
      { dataAreaId: 'msb', SalesOrderNumber: 'OV018304', LineNumber: 1, ItemNumber: 'IT-1', LineAmount: 500, ItemBatchNumber: 'LT-1', SalesOrderLineStatus: 'Invoiced' },
      { dataAreaId: 'msb', SalesOrderNumber: 'OV018304', LineNumber: 2, ItemNumber: 'IT-2', LineAmount: 100, ItemBatchNumber: 'LT-2', SalesOrderLineStatus: 'Backorder' }
    ], auto: true },
    WHSWorkTableBiEntities: { linhas: [
      w('OV018301', 'WF1', 'Closed', { LoadId: 'LD-F1' }), w('OV018302', 'WF2', 'Closed', { LoadId: 'LD-F2' }), w('OV018303', 'WF3', 'Closed', { LoadId: 'LD-F3' }),
      w('OV018305', 'WF5', 'Closed', { LoadId: 'LD-F5' }), w('TR000777', 'WF9', 'Closed', { LoadId: 'LD-F1', WorkTransType: 'TransferIssue' })
    ] },
    WHSOutboundLoadHeaderEntities: { linhas: [ldF('LD-F1', 'Loaded', 'Yes', 'No'), ldF('LD-F2', 'Loaded', 'Yes', 'Yes'), ldF('LD-F3', 'Shipped', 'Yes', 'Yes'), ldF('LD-F5', 'Loaded', 'No', 'No')] },
    SalesInvoiceHeadersV2: { linhas: [nf('OV018301', '000038301', '2026-10-20'), nf('OV018302', '000038302', '2026-10-21'), nf('OV018303', '000038303', '2026-10-22'), nf('OV018304', '000038304', '2026-10-01')] },
    FiscalDocuments: { linhas: [fd('000038301', 'Approved', '2026-10-20'), fd('000038302', 'Approved', '2026-10-21'), fd('000038303', 'Approved', '2026-10-22'), fd('000038304', 'Approved', '2026-10-01')] }
  };
  r = await K.quadro({ de: DE, ate: ATE });
  const e7a = {}; r.ovs.forEach(o => { e7a[o.chave] = o.etapa; });
  t('Faturado não é mais coluna datada', r.datadas.indexOf('faturado') < 0, r.datadas);
  t('faturada ANTES do período, carga Carregado -> Faturado', e7a.OV018301 === 'faturado', e7a);
  t('em aberto com 1 linha Faturada (parcial) -> essa parte em Faturado (não some mais); o resto segue', e7a['OV018304~faturado'] === 'faturado' && e7a['OV018304~criada'] === 'criada', e7a);
  // 11/11/26 ("mandei para o pallet porém ele não atualizou"): o Pallet também sem data
  // 11/11/26 (dono: "não precisa de data do Pallet, pode trazer tudo")
  t('Pallet não é coluna datada', r.datadas.indexOf('pallet') < 0, r.datadas);
  t('carga Carregado + Pallet, nota ANTES do período -> Pallet (todas, sem data)', e7a.OV018302 === 'pallet', e7a);
  t('carga Remetido: não vem pelas cargas Carregado (o período decide a Expedição)', !e7a.OV018303, e7a);
  t('em aberto com a carga Carregado segue em Cotação', e7a.OV018305 === 'cotacao', e7a);
  const lc7a = chamadas.find(c => c.ent === 'WHSOutboundLoadHeaderEntities' && /LoadStatus eq/.test(c.q.filter || ''));
  t('cargas Carregado pelo status (enum), sem data', lc7a && /LoadStatus eq Microsoft\.Dynamics\.DataEntities\.WHSLoadStatus'Loaded'/.test(lc7a.q.filter), lc7a && lc7a.q.filter);
  const lt7a = chamadas.find(c => c.ent === 'WHSWorkTableBiEntities' && /LoadId eq/.test(c.q.filter || ''));
  t('os trabalhos das cargas Carregado, com e sem Pallet (a Remetida não)', lt7a && /LD-F1/.test(lt7a.q.filter) && /LD-F2/.test(lt7a.q.filter) && /LD-F5/.test(lt7a.q.filter) && !/LD-F3/.test(lt7a.q.filter), lt7a && lt7a.q.filter);
  t('trabalho de transferência na mesma carga não vira OV', !chamadas.some(c => c.ent === 'SalesOrderHeadersV2' && /TR000777/.test(c.q.filter || '')), chamadas.filter(c => /TR000777/.test(c.q.filter || '')).map(c => c.ent));
  const d7a = r.diagnostico.find(d => d.etapa === 'fat:ovs');
  t('o diagnóstico diz quantas cargas e OVs', d7a && d7a.cargas === 3 && d7a.ovs === 3, d7a);
  t('sem aviso do Faturado', !r.avisos.some(a => /Carregado/.test(a)), r.avisos);
  // a OV faturada antes do período, no Faturado, vai para o Pallet (gravado no D365)
  const rp7a = await K.enviarParaPallet('LD-F1');
  t('a gravação confere no Dynamics (confirmado)', rp7a.ok && rp7a.confirmado === true && !rp7a.aviso && rp7a.leitura.valor === 'Yes', rp7a);
  r = await K.quadro({ de: DE, ate: ATE });
  const e7b = {}; r.ovs.forEach(o => { e7b[o.chave] = o.etapa; });
  t('depois, a OV faturada antes do período aparece no Pallet (não some do quadro)', e7b.OV018301 === 'pallet' && r.etapas.find(e => e.id === 'pallet').qtd === 2, e7b);
  CEN = guarda7a; SERVICO = serv7a;

  console.log('7b) o F&O recusa o filtro de enum: vai pelo texto');
  K._limparCache(); chamadas.length = 0;
  CEN.SalesOrderHeadersV2.recusaEnum = true;
  r = await K.quadro({ de: DE, ate: ATE });
  t('mesmo resultado pelo filtro de texto', r.ovs.map(o => o.numero).sort().join() === 'OV018001,OV018002,OV018004,OV018006', r.ovs.map(o => o.numero));
  t('o diagnóstico diz a forma usada', r.diagnostico.some(d => d.etapa === 'ov:abertas' && d.forma === 'texto' && d.linhas >= 1), r.diagnostico.filter(d => d.etapa === 'ov:abertas'));
  delete CEN.SalesOrderHeadersV2.recusaEnum;

  console.log('7c) o lote das linhas (10/11/2026): item SEM lote -> essa parte da OV em Pendência, o resto anda');
  K._limparCache(); chamadas.length = 0;
  const lnL = (ov, n, item, valor, lote, st) => ({ dataAreaId: 'msb', SalesOrderNumber: ov, LineNumber: n, ItemNumber: item, LineAmount: valor,
    OrderedSalesQuantity: 2, ItemBatchNumber: lote, SalesOrderLineStatus: st || 'Backorder' });
  CEN = {
    SalesOrderHeadersV2: { linhas: [
      v2('OV018101', '2026-11-03T13:00:00Z', 'Backorder'),   // 3 linhas, 1 sem lote -> 2 cartões
      v2('OV018102', '2026-11-03T14:00:00Z', 'Backorder'),   // nenhuma com lote -> a OV inteira em Pendência
      v2('OV018103', '2026-11-03T15:00:00Z', 'Backorder'),   // todas com lote -> não divide
      v2('OV018104', '2026-11-01T13:00:00Z', 'Invoiced'),    // faturada (nota no período) -> não divide
      v2('OV018105', '2026-11-03T16:00:00Z', 'Backorder'),   // a sem lote está cancelada -> não divide
      v2('OV018106', '2026-11-03T17:00:00Z', 'Backorder'),   // a sem lote já foi entregue -> não divide
      v2('OV018107', '2026-11-03T18:00:00Z', 'Backorder'),   // liberada, mas SEM linha nenhuma -> Criada
      v2('OV018108', '2026-10-20T18:00:00Z', 'Delivered')    // entregue (romaneio, sem nota) -> Aguardando Faturamento
    ] },
    BIOSalesOrderHeaderV1: { linhas: ['OV018101', 'OV018102', 'OV018103', 'OV018105', 'OV018106', 'OV018107'].map(n => b4(n, 'Backorder', 'Released', 'No')).concat([b4('OV018104', 'Invoiced', 'Released', 'No'), b4('OV018108', 'Delivered', 'Released', 'No')]) },
    SalesOrderLines: { linhas: [
      lnL('OV018101', 1, 'IT-A', 100, 'LT-A1'), lnL('OV018101', 2, 'IT-B', 40, ''), lnL('OV018101', 3, 'IT-C', 60, 'LT-C3'),
      lnL('OV018102', 1, 'IT-A', 70, ''), lnL('OV018102', 2, 'IT-B', 30, ''),
      lnL('OV018103', 1, 'IT-A', 500, 'LT-A9'),
      lnL('OV018104', 1, 'IT-A', 900, '', 'Invoiced'),
      lnL('OV018105', 1, 'IT-A', 10, 'LT-1'), lnL('OV018105', 2, 'IT-B', 20, '', 'Canceled'),
      lnL('OV018106', 1, 'IT-A', 10, 'LT-1'), lnL('OV018106', 2, 'IT-B', 20, '', 'Delivered'),
      lnL('OV018108', 1, 'IT-A', 100, 'LT-8', 'Delivered'), lnL('OV018108', 2, 'IT-C', 200, 'LT-9', 'Delivered')
    ] },
    SalesInvoiceHeadersV2: { linhas: [nf('OV018104', '000030104', '2026-11-05')] },
    FiscalDocuments: { linhas: [fd('000030104', 'Approved', '2026-11-05')] }
  };
  // KANBAN_PENDENCIA_LOTE=0 desliga a regra do lote (ficou de lado de manhã, 11/11/26)
  process.env.KANBAN_PENDENCIA_LOTE = '0';
  r = await K.quadro({ de: DE, ate: ATE });
  let pc = (ch) => r.ovs.find(o => o.chave === ch);
  t('KANBAN_PENDENCIA_LOTE=0: ninguém em Pendência; a OV com item sem lote fica inteira', !r.ovs.some(o => o.etapa === 'pendencia') && pc('OV018101') && pc('OV018101').etapa === 'liberado' && !pc('OV018101').parte,
    r.ovs.filter(o => /OV01810[12]/.test(o.numero)).map(o => o.chave + '=' + o.etapa));
  t('desligada, o lote continua lido (a ficha mostra)', pc('OV018101').lotes && pc('OV018101').lotes.semLote === 1, pc('OV018101').lotes);
  // 11/11/26 (dono): "volte para a Pendência tudo que não tiver LOTE na linha" — LIGADA por padrão
  delete process.env.KANBAN_PENDENCIA_LOTE;
  K._limparCache(); chamadas.length = 0;
  r = await K.quadro({ de: DE, ate: ATE });
  t('por padrão a regra do lote está ligada (sem env)', r.ovs.some(o => o.etapa === 'pendencia') && !r.etapas.find(e => e.id === 'pendencia').pendente, r.ovs.filter(o => o.etapa === 'pendencia').map(o => o.chave));
  const p1 = pc('OV018101~semlote'), p2 = pc('OV018101~liberado');
  t('OV com 1 linha sem lote vira 2 cartões', p1 && p2 && r.ovs.filter(o => o.numero === 'OV018101').length === 2, r.ovs.filter(o => o.numero === 'OV018101').map(o => o.chave));
  t('a parte sem lote em Pendência, com o valor e os itens só dela', p1 && p1.etapa === 'pendencia' && p1.valor === 40 && p1.itens === 1 && p1.parte.id === 'semlote' && p1.parte.linhas.join() === '2' && p1.parte.n === 1 && p1.parte.de === 3, p1 && { e: p1.etapa, v: p1.valor, parte: p1.parte });
  t('a outra parte segue a etapa da OV (Separação), com o resto', p2 && p2.etapa === 'liberado' && p2.valor === 160 && p2.itens === 2 && p2.parte.linhas.join() === '1,3', p2 && { e: p2.etapa, v: p2.valor, parte: p2.parte });
  t('cada parte aponta a outra e guarda o total da OV', p1 && p2 && p1.irmas[0].chave === p2.chave && p1.irmas[0].etapa === 'liberado' && p2.irmas[0].chave === p1.chave && p1.valorOv === 200 && p2.valorOv === 200 && p1.etapaOv === 'liberado', p1 && { i1: p1.irmas, vOv: p1.valorOv });
  const p3 = pc('OV018102');
  t('nenhuma linha com lote: a OV INTEIRA em Pendência (1 cartão, chave = número)', p3 && p3.etapa === 'pendencia' && p3.parte && p3.parte.inteira === true && p3.valor === 100 && r.ovs.filter(o => o.numero === 'OV018102').length === 1, p3 && { e: p3.etapa, parte: p3.parte });
  t('todas com lote: não divide', pc('OV018103') && pc('OV018103').etapa === 'liberado' && !pc('OV018103').parte && pc('OV018103').lotes.semLote === 0, pc('OV018103'));
  t('faturada: não divide (a nota já saiu)', pc('OV018104') && pc('OV018104').etapa === 'faturado' && !pc('OV018104').parte, pc('OV018104') && pc('OV018104').etapa);
  t('linha sem lote cancelada: não divide', pc('OV018105') && !pc('OV018105').parte && pc('OV018105').etapa === 'liberado', pc('OV018105') && pc('OV018105').etapa);
  // 11/11/26 (dono, provisório): linha ENTREGUE -> Aguardando Faturamento
  // 11/11/26: linha Entregue sem carga nenhuma -> Aguardando Faturamento (reserva); a em aberto segue
  const e6 = pc('OV018106~aguardando'), r6 = pc('OV018106~liberado');
  t('linha Entregue (mesmo sem lote) vira um cartão em Aguardando Faturamento; o resto anda', e6 && e6.etapa === 'aguardando' && e6.valor === 20 && e6.parte.status.join() === 'entregue'
    && r6 && r6.etapa === 'liberado' && r6.valor === 10 && e6.irmas && e6.irmas[0].chave === 'OV018106~liberado', [e6 && e6.etapa, r6 && r6.etapa]);
  const p8 = pc('OV018108');
  t('OV Entregue (todas as linhas): entra no quadro e vai inteira para Aguardando Faturamento', p8 && p8.etapa === 'aguardando' && !p8.parte && p8.linhasSt.entregue === 2 && p8.valor === 300, p8 && { e: p8.etapa, st: p8.linhasSt });
  const cPend = r.etapas.find(e => e.id === 'pendencia'), cSep = r.etapas.find(e => e.id === 'liberado');
  const cAg = r.etapas.find(e => e.id === 'aguardando');
  t('colunas somam as PARTES (Pendência = 40 + 100; Separação = 160 + 500 + 30 + 10; Aguardando = 20 + 300)', cPend.qtd === 2 && cPend.valor === 140 && cSep.qtd === 4 && cSep.valor === 700 && cAg.qtd === 2 && cAg.valor === 320, { pend: cPend, sep: cSep, ag: cAg });
  const lsel = chamadas.find(c => c.ent === 'SalesOrderLines' && c.q.select);
  t('as linhas pedem o lote (ItemBatchNumber), o status e o número da linha', lsel && /ItemBatchNumber/.test(lsel.q.select) && /SalesOrderLineStatus/.test(lsel.q.select) && /LineNumber/.test(lsel.q.select), lsel && lsel.q.select);
  t('sem aviso do lote', !r.avisos.some(a => /lote/.test(a)), r.avisos);
  const p7 = pc('OV018107');
  t('OV SEM linha nenhuma -> Criada (não Pendência), guardando a etapa de antes', p7 && p7.etapa === 'criada' && p7.semLinhas === true && p7.etapaOv === 'liberado' && !p7.parte, p7 && { e: p7.etapa, sem: p7.semLinhas, antes: p7.etapaOv });
  // as linhas não foram lidas (entidade fora do ar): ninguém vai para Criada por "falta de linha"
  K._limparCache(); chamadas.length = 0;
  const lin7c = CEN.SalesOrderLines; delete CEN.SalesOrderLines;
  r = await K.quadro({ de: DE, ate: ATE });
  t('linhas não lidas: a OV sem linha segue a etapa dela', pc('OV018107') && pc('OV018107').etapa === 'liberado' && !pc('OV018107').semLinhas && pc('OV018101') && pc('OV018101').etapa === 'liberado', pc('OV018107') && pc('OV018107').etapa);
  CEN.SalesOrderLines = lin7c;

  console.log('8) as regras do dono pela carga e pela nota (Separação … Expedição)');
  K._limparCache(); chamadas.length = 0;
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'WHSWorkTableBiEntities', 'WHSOutboundLoadHeaderEntities', 'SalesInvoiceHeadersV2', 'FiscalDocuments'];
  const ovs8 = ['OV019001', 'OV019002', 'OV019003', 'OV019004', 'OV019005', 'OV019006', 'OV019007', 'OV019008', 'OV019009', 'OV019010'];
  const ld = (id, st, cot, pal) => ({ dataAreaId: 'msb', LoadId: id, LoadStatus: st, QuotationPerformed_InoveProjects: cot, ENVIARPALLET_CUSTOM: pal, CarrierCode: 'TRANSP' });
  CEN = {
    SalesOrderHeadersV2: { linhas: ovs8.map((n, i) => v2(n, DIA + 'T1' + i + ':00:00Z', 'Backorder')) },
    // 11/11/26: a linha (automática) segue a situação: OV019004 Entregue, OV019005 Faturada
    BIOSalesOrderHeaderV1: { linhas: ovs8.map(n => b4(n, n === 'OV019004' ? 'Delivered' : n === 'OV019005' ? 'Invoiced' : 'Backorder', 'Released', 'No')) },
    SalesOrderLines: { linhas: [], auto: true },
    WHSWorkTableBiEntities: { linhas: [
      w('OV019001', 'W1', 'Open', { LoadId: '' }),                 // trabalho Abrir, sem carga -> Separação
      w('OV019002', 'W2', 'Closed', { LoadId: 'LD-2' }),           // carga Em processamento -> Conferência
      w('OV019003', 'W3', 'Closed', { LoadId: 'LD-3' }),           // Carregado + cotação Não -> Cotação
      w('OV019004', 'W4', 'Closed', { LoadId: 'LD-4' }),           // Carregado + cotação Sim, sem nota -> Cotação (pode ir para o Pallet)
      w('OV019005', 'W5', 'Closed', { LoadId: 'LD-5' }),           // Carregado + cotação Sim + nota Aprovada -> Faturado (pode ir para o Pallet)
      w('OV019006', 'W6', 'Closed', { LoadId: 'LD-6' }),           // ENVIARPALLET = Sim -> Pallet
      w('OV019007', 'W7', 'Closed', { LoadId: 'LD-7' }),           // Remetido -> Expedição
      w('OV019008', 'W8', 'Closed', { LoadId: 'LD-8' }),           // nota Rejeitada vale antes da carga -> Rejeitada
      w('OV019009', 'W9', 'Closed', { LoadId: 'LD-9A' }), w('OV019009', 'W9B', 'Closed', { LoadId: 'LD-9B' }),  // 2 cargas: a menos adiantada
      w('OV019010', 'W10', 'InProcess', { LoadId: 'LD-10' })       // trabalho em processo, carga em onda -> Conferência (10/11: Separação é só Abrir)
    ] },
    WHSOutboundLoadHeaderEntities: { linhas: [
      ld('LD-2', 'InProcess', 'No', 'No'), ld('LD-3', 'Loaded', 'No', 'No'), ld('LD-4', 'Loaded', 'Yes', 'No'), ld('LD-5', 'Loaded', 'Yes', 'No'),
      ld('LD-6', 'Loaded', 'Yes', 'Yes'), ld('LD-7', 'Shipped', 'Yes', 'Yes'), ld('LD-8', 'Shipped', 'Yes', 'Yes'),
      ld('LD-9A', 'Shipped', 'Yes', 'Yes'), ld('LD-9B', 'InProcess', 'No', 'No'), ld('LD-10', 'Waved', 'No', 'No')
    ] },
    SalesInvoiceHeadersV2: { linhas: [nf('OV019005', '000040005', DIA), nf('OV019006', '000040006', DIA), nf('OV019007', '000040007', DIA), nf('OV019008', '000040008', DIA)] },
    FiscalDocuments: { linhas: [fd('000040005', 'Approved', DIA), fd('000040006', 'Approved', DIA), fd('000040007', 'Approved', DIA), fd('000040008', 'Rejected', DIA)] }
  };
  r = await K.ordensDoDia({ data: DIA });
  const e8 = {}; r.ovs.forEach(o => { e8[o.numero] = o.etapa; });
  const o8 = (n) => r.ovs.find(o => o.numero === n);
  t('Separação = trabalho "Abrir"', e8.OV019001 === 'liberado', e8);
  t('Conferência = carga "Em processamento"', e8.OV019002 === 'conferencia' && o8('OV019002').cargaFase === 'processando', e8);
  // 11/11/26 (dono): Cotação = Carregado + linha em aberto; Aguardando = Carregado + linha Entregue; Faturado = linha Faturado
  t('Cotação = carga "Carregado" + linha "Ordem em aberto"', e8.OV019003 === 'cotacao' && o8('OV019003').podePallet === false, e8);
  t('Aguardando Faturamento = carga Carregado + linha Entregue (com o botão do pallet)', e8.OV019004 === 'aguardando' && o8('OV019004').podePallet === true, { e: e8.OV019004, pode: o8('OV019004').podePallet });
  t('Faturado = linha Faturado (com o botão do pallet)', e8.OV019005 === 'faturado' && o8('OV019005').podePallet === true, { e: e8.OV019005, pode: o8('OV019005').podePallet });
  t('Pallet = ENVIARPALLET_CUSTOM Sim (sem o botão)', e8.OV019006 === 'pallet' && o8('OV019006').podePallet === false, e8);
  t('Expedição = carga "Remetido"', e8.OV019007 === 'expedicao', e8);
  t('Rejeitada vale antes da carga', e8.OV019008 === 'rejeitada', e8);
  t('2 cargas: vale a menos adiantada', e8.OV019009 === 'conferencia', e8);
  t('trabalho em processo, carga em onda -> Conferência (Separação é só trabalho Abrir)', e8.OV019010 === 'conferencia', e8);
  t('colunas da carga achadas: QuotationPerformed_InoveProjects e ENVIARPALLET_CUSTOM', o8('OV019004').cargaCols.cotacao === 'QuotationPerformed_InoveProjects' && o8('OV019004').cargaCols.pallet === 'ENVIARPALLET_CUSTOM', o8('OV019004').cargaCols);
  t('sem aviso das colunas da carga', !r.avisos.some(a => /Cotação realizada/.test(a)), r.avisos);

  t('motivo de não poder ir para o Pallet', /cotação realizada está "Não"/.test(o8('OV019003').cargas[0].motivoPallet) && /precisa estar Carregado/.test(o8('OV019002').cargas[0].motivoPallet) && o8('OV019004').cargas[0].motivoPallet === '', [o8('OV019003').cargas[0].motivoPallet, o8('OV019002').cargas[0].motivoPallet]);

  console.log('8b) duas entidades de cargas: vale a que tem os campos _CUSTOM');
  K._limparCache();
  // a 1ª candidata (WHSOutboundLoadHeaderEntities) sem os _CUSTOM; a OutboundLoadHeaders com eles
  const semCustom = CEN.WHSOutboundLoadHeaderEntities.linhas.map(x => ({ dataAreaId: 'msb', LoadId: x.LoadId, LoadStatus: x.LoadStatus }));
  CEN.OutboundLoadHeaders = { linhas: CEN.WHSOutboundLoadHeaderEntities.linhas };
  CEN.WHSOutboundLoadHeaderEntities = { linhas: semCustom };
  SERVICO = SERVICO.concat(['OutboundLoadHeaders']);
  r = await K.ordensDoDia({ data: DIA });
  t('escolhe a OutboundLoadHeaders (com QuotationPerformed_InoveProjects e ENVIARPALLET_CUSTOM)', r.fontes.some(f => f.papel === 'carga' && f.entidade === 'OutboundLoadHeaders'), r.fontes.filter(f => f.papel === 'carga'));
  t('e as regras continuam: Cotação, Pallet, Expedição', r.ovs.find(o => o.numero === 'OV019003').etapa === 'cotacao' && r.ovs.find(o => o.numero === 'OV019006').etapa === 'pallet' && r.ovs.find(o => o.numero === 'OV019007').etapa === 'expedicao');
  CEN.WHSOutboundLoadHeaderEntities = CEN.OutboundLoadHeaders; delete CEN.OutboundLoadHeaders;
  SERVICO = SERVICO.filter(x => x !== 'OutboundLoadHeaders');
  K._limparCache(); r = await K.ordensDoDia({ data: DIA });

  console.log('8c) carga SÓ da WHSOutboundLoadHeaderEntity; "pallet" sozinho não serve');
  K._limparCache();
  const base8c = CEN.WHSOutboundLoadHeaderEntities.linhas;
  // a candidata (OutboundLoadHeaders) sem a cotação, e com um campo QUALQUER de pallet (não pode ser usado)
  CEN.OutboundLoadHeaders = { linhas: base8c.map(x => ({ dataAreaId: 'msb', LoadId: x.LoadId, LoadStatus: x.LoadStatus, PalletQuantity: 3, QuotationId: 'Q1' })) };
  // a que tem os campos está publicada com outro nome ("load" no nome, fora das candidatas)
  CEN.InoveLoadTables = { linhas: base8c };
  const guarda = CEN.WHSOutboundLoadHeaderEntities; delete CEN.WHSOutboundLoadHeaderEntities;
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'WHSWorkTableBiEntities', 'SalesInvoiceHeadersV2', 'FiscalDocuments', 'OutboundLoadHeaders', 'InoveLoadTables', 'OutboundLoadLines'];
  r = await K.ordensDoDia({ data: DIA });
  t('fica na OutboundLoadHeaders (a WHSOutboundLoadHeaderEntity), mesmo com outra entidade de "load" com os campos', r.fontes.some(f => f.papel === 'carga' && f.entidade === 'OutboundLoadHeaders') && !chamadas.some(c => c.ent === 'InoveLoadTables'), r.fontes.filter(f => f.papel === 'carga'));
  const dcol = r.diagnostico.find(d => d.etapa === 'carga:colunas');
  t('o Diagnóstico lista TODOS os campos da entidade de cargas', dcol && dcol.entidade === 'OutboundLoadHeaders' && ['LoadId', 'LoadStatus', 'PalletQuantity', 'QuotationId'].every(c => dcol.colunas.indexOf(c) >= 0), dcol);
  // só a candidata sem os campos: o PalletQuantity e o QuotationId NÃO podem virar pallet / cotação
  K._limparCache();
  delete CEN.InoveLoadTables;
  SERVICO = SERVICO.filter(x => x !== 'InoveLoadTables');
  r = await K.ordensDoDia({ data: DIA });
  const o3 = r.ovs.find(o => o.numero === 'OV019004');
  t('"PalletQuantity" e "QuotationId" não são usados', o3.cargaCols.pallet === null && o3.cargaCols.cotacao === null && o3.podePallet === false, o3.cargaCols);
  t('aviso diz o que falta e mostra os campos parecidos', r.avisos.some(a => /não achei "Cotação realizada".*ENVIARPALLET_CUSTOM/.test(a) && /Campos parecidos nessa entidade: .*PalletQuantity/.test(a)), r.avisos);
  delete CEN.OutboundLoadHeaders; CEN.WHSOutboundLoadHeaderEntities = guarda;
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'WHSWorkTableBiEntities', 'WHSOutboundLoadHeaderEntities', 'SalesInvoiceHeadersV2', 'FiscalDocuments'];
  K._limparCache(); r = await K.ordensDoDia({ data: DIA });

  console.log('8d) uma entidade qualquer com "load" e "Status" não ganha da de cargas');
  K._limparCache();
  const base8d = CEN.WHSOutboundLoadHeaderEntities.linhas;
  const guarda8d = CEN.WHSOutboundLoadHeaderEntities; delete CEN.WHSOutboundLoadHeaderEntities;
  // a de cargas (OutboundLoadHeaders) como no print do dono: as cargas da OV, mas
  // NENHUM dos campos preferidos (sem LoadStatus, sem cotação, sem ENVIARPALLET_CUSTOM)
  CEN.OutboundLoadHeaders = { linhas: base8d.map(x => ({ dataAreaId: 'msb', LoadId: x.LoadId, LoadPalletCount: 2 })) };
  // outra com "load" no nome, LoadId e um Status genérico — mas sem as cargas da OV
  CEN.TMSLoadBuildStrategies = { linhas: [{ dataAreaId: 'msb', LoadId: 'OUTRA-1', Status: 'Active' }] };
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'WHSWorkTableBiEntities', 'SalesInvoiceHeadersV2', 'FiscalDocuments', 'OutboundLoadHeaders', 'TMSLoadBuildStrategies'];
  r = await K.ordensDoDia({ data: DIA });
  t('fica com a OutboundLoadHeaders (o "Status" genérico da outra não conta)', r.fontes.some(f => f.papel === 'carga' && f.entidade === 'OutboundLoadHeaders'), r.fontes.filter(f => f.papel === 'carga'));
  t('as cargas da OV são encontradas', !r.ovs.some(o => (o.cargas || []).some(c => c.naoAchada)), r.ovs.map(o => (o.cargas || []).map(c => c.id + (c.naoAchada ? '?' : '')).join()));
  t('sem aviso de carga não encontrada', !r.avisos.some(a => /não estão na entidade de cargas/.test(a)), r.avisos);
  // e quando a carga do trabalho não está na entidade: aviso
  K._limparCache();
  CEN.OutboundLoadHeaders.linhas = CEN.OutboundLoadHeaders.linhas.filter(x => x.LoadId !== 'LD-2');
  r = await K.ordensDoDia({ data: DIA });
  t('carga do trabalho fora da entidade: aviso com o nº', r.avisos.some(a => /1 de \d+ carga\(s\) dos trabalhos de depósito não estão na entidade de cargas OutboundLoadHeaders \(ex\.: LD-2\)/.test(a)), r.avisos);
  delete CEN.OutboundLoadHeaders; delete CEN.TMSLoadBuildStrategies; CEN.WHSOutboundLoadHeaderEntities = guarda8d;
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'WHSWorkTableBiEntities', 'WHSOutboundLoadHeaderEntities', 'SalesInvoiceHeadersV2', 'FiscalDocuments'];
  K._limparCache(); r = await K.ordensDoDia({ data: DIA });

  console.log('8e) WHSLoadTableBiEntity primeiro; a gravação cai na WHSOutboundLoadHeaderEntity se a BI recusar');
  K._limparCache(); chamadas.length = 0;
  const base8e = CEN.WHSOutboundLoadHeaderEntities.linhas;
  const guarda8e = CEN.WHSOutboundLoadHeaderEntities; delete CEN.WHSOutboundLoadHeaderEntities;
  // a BI com tudo (status, cotação, pallet) — só leitura; a de cabeçalho só com o pallet
  CEN.WHSLoadTableBiEntities = { linhas: base8e.map(x => Object.assign({}, x)), somenteLeitura: true };
  CEN.OutboundLoadHeaders = { linhas: base8e.map(x => ({ dataAreaId: 'msb', LoadId: x.LoadId, ENVIARPALLET_CUSTOM: x.ENVIARPALLET_CUSTOM })) };
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'WHSWorkTableBiEntities', 'SalesInvoiceHeadersV2', 'FiscalDocuments', 'WHSLoadTableBiEntities', 'OutboundLoadHeaders'];
  r = await K.ordensDoDia({ data: DIA });
  t('lê a carga da WHSLoadTableBiEntities (a que tem os campos)', r.fontes.some(f => f.papel === 'carga' && f.entidade === 'WHSLoadTableBiEntities'), r.fontes.filter(f => f.papel === 'carga'));
  t('regras pela BI (Aguardando, Pallet, Expedição)', r.ovs.find(o => o.numero === 'OV019004').etapa === 'aguardando' && r.ovs.find(o => o.numero === 'OV019006').etapa === 'pallet' && r.ovs.find(o => o.numero === 'OV019007').etapa === 'expedicao');
  chamadas.length = 0;
  let r8e = await K.enviarParaPallet('LD-4');
  const pts = chamadas.filter(c => c.metodo === 'PATCH');
  t('a BI recusa a gravação e ela vai para a OutboundLoadHeaders', pts.length === 2 && pts[0].ent === 'WHSLoadTableBiEntities' && pts[1].ent === 'OutboundLoadHeaders' && r8e.entidade === 'OutboundLoadHeaders'
    && CEN.OutboundLoadHeaders.linhas.find(x => x.LoadId === 'LD-4').ENVIARPALLET_CUSTOM === 'Yes', { pts: pts.map(p => p.ent), r8e });
  // 11/11/26: aqui a BI é uma cópia à parte (no D365 as duas leem a mesma tabela) —
  // a releitura pega o caso "gravou numa, o quadro lê na outra e não mudou"
  t('a releitura na BI (de onde o quadro lê) não mostra Sim: não confirmado, com o aviso', r8e.confirmado === false && r8e.leitura.entidade === 'WHSLoadTableBiEntities'
    && /OutboundLoadHeaders/.test(r8e.aviso) && /WHSLoadTableBiEntities/.test(r8e.aviso) && /ainda mostra ENVIARPALLET_CUSTOM = "Não"/.test(r8e.aviso), r8e);
  // sem entidade para gravar: o erro do Dynamics volta
  CEN.OutboundLoadHeaders.somenteLeitura = true;
  let e8e = null; try { await K.enviarParaPallet('LD-5'); } catch (e) { e8e = e; }
  t('as duas recusam: o erro diz as duas entidades', e8e && /WHSLoadTableBiEntities/.test(e8e.message) && /OutboundLoadHeaders/.test(e8e.message), e8e && e8e.message);
  delete CEN.WHSLoadTableBiEntities; delete CEN.OutboundLoadHeaders; CEN.WHSOutboundLoadHeaderEntities = guarda8e;
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'WHSWorkTableBiEntities', 'WHSOutboundLoadHeaderEntities', 'SalesInvoiceHeadersV2', 'FiscalDocuments'];
  K._limparCache(); r = await K.ordensDoDia({ data: DIA });

  console.log('8f) 10/11/26 "as cargas sumiram / parte existe, parte não": a BI traz só parte; o resto vem da de cabeçalho');
  K._limparCache(); chamadas.length = 0;
  const guarda8f = CEN.WHSOutboundLoadHeaderEntities;
  CEN.WHSOutboundLoadHeaderEntities = { linhas: guarda8f.linhas.map(x => Object.assign({}, x)) };
  // a BI com os MESMOS campos (ganha no empate), mas só com 2 das 10 cargas
  CEN.WHSLoadTableBiEntities = { linhas: guarda8f.linhas.filter(x => x.LoadId === 'LD-2' || x.LoadId === 'LD-3').map(x => Object.assign({}, x)), somenteLeitura: true };
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'WHSWorkTableBiEntities', 'WHSLoadTableBiEntities', 'WHSOutboundLoadHeaderEntities', 'SalesInvoiceHeadersV2', 'FiscalDocuments'];
  r = await K.ordensDoDia({ data: DIA });
  const e8f = {}; r.ovs.forEach(o => { e8f[o.numero] = o.etapa; });
  t('as etapas de sempre (nenhuma carga sumiu)', e8f.OV019002 === 'conferencia' && e8f.OV019003 === 'cotacao' && e8f.OV019004 === 'aguardando' && e8f.OV019006 === 'pallet' && e8f.OV019007 === 'expedicao' && e8f.OV019009 === 'conferencia', e8f);
  const o8f = (n) => r.ovs.find(o => o.numero === n);
  t('cada carga diz de onde veio', o8f('OV019002').cargas[0].fonte === 'WHSLoadTableBiEntities' && o8f('OV019004').cargas[0].fonte === 'WHSOutboundLoadHeaderEntities' && !o8f('OV019004').cargas[0].naoAchada, o8f('OV019004').cargas);
  t('a ficha mostra a entidade da carga da OV', /^WHSOutboundLoadHeaderEntities/.test(o8f('OV019004').cargaFonte) && /^WHSLoadTableBiEntities/.test(o8f('OV019002').cargaFonte), [o8f('OV019004').cargaFonte, o8f('OV019002').cargaFonte]);
  t('o botão do Pallet vale para a carga que veio da de cabeçalho', o8f('OV019004').podePallet === true, o8f('OV019004').podePallet);
  const fc8f = r.fontes.filter(f => f.papel === 'carga');
  t('as duas entidades nas fontes, com quantas cargas cada', fc8f.length === 2 && fc8f.find(f => f.entidade === 'WHSLoadTableBiEntities').cargas === 2 && fc8f.find(f => f.entidade === 'WHSOutboundLoadHeaderEntities').cargas === 8, fc8f);
  const pc8f = chamadas.filter(c => c.ent === 'WHSOutboundLoadHeaderEntities' && /LoadId eq/.test(c.q.filter || ''));
  t('na de cabeçalho só as que faltaram', pc8f.length && !pc8f.some(c => /LD-2'|LD-3'/.test(c.q.filter)), pc8f.map(c => c.q.filter));
  t('sem aviso de carga não encontrada', !r.avisos.some(a => /não estão na/.test(a)), r.avisos);
  chamadas.length = 0;
  const r8f = await K.enviarParaPallet('LD-4');
  const pt8f = chamadas.filter(c => c.metodo === 'PATCH');
  t('"Enviar para o Pallet" acha a carga na de cabeçalho e grava lá', r8f.ok && pt8f.length === 1 && pt8f[0].ent === 'WHSOutboundLoadHeaderEntities' && CEN.WHSOutboundLoadHeaderEntities.linhas.find(x => x.LoadId === 'LD-4').ENVIARPALLET_CUSTOM === 'Yes', { r8f, pts: pt8f.map(p => p.ent) });
  delete CEN.WHSLoadTableBiEntities; CEN.WHSOutboundLoadHeaderEntities = guarda8f;
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'WHSWorkTableBiEntities', 'WHSOutboundLoadHeaderEntities', 'SalesInvoiceHeadersV2', 'FiscalDocuments'];
  K._limparCache(); r = await K.ordensDoDia({ data: DIA });

  console.log('8g) 11/11/26 as regras pelo status da LINHA: Cotação / Aguardando / Faturado');
  K._limparCache(); chamadas.length = 0;
  const guarda8g = CEN, serv8g = SERVICO;
  SERVICO = ['BIOSalesOrderHeaderV1', 'SalesOrderHeadersV2', 'SalesOrderLines', 'WHSWorkTableBiEntities', 'WHSOutboundLoadHeaderEntities'];
  const l8 = (ov, n, v, st) => ({ dataAreaId: 'msb', SalesOrderNumber: ov, LineNumber: n, ItemNumber: 'IT-' + n, LineAmount: v, ItemBatchNumber: 'LT-' + n, SalesOrderLineStatus: st });
  CEN = {
    SalesOrderHeadersV2: { linhas: ['OV019101', 'OV019102'].map((n, i) => v2(n, DIA + 'T1' + i + ':00:00Z', 'Backorder')) },
    BIOSalesOrderHeaderV1: { linhas: ['OV019101', 'OV019102'].map(n => b4(n, 'Backorder', 'Released', 'No')) },
    SalesOrderLines: { linhas: [
      l8('OV019101', 1, 100, 'Backorder'), l8('OV019101', 2, 200, 'Delivered'), l8('OV019101', 3, 300, 'Invoiced'),   // carga Carregado
      l8('OV019102', 1, 50, 'Delivered'), l8('OV019102', 2, 70, 'Backorder')                                        // carga Em processamento
    ] },
    WHSWorkTableBiEntities: { linhas: [w('OV019101', 'W91', 'Closed', { LoadId: 'LD-91' }), w('OV019102', 'W92', 'Closed', { LoadId: 'LD-92' })] },
    WHSOutboundLoadHeaderEntities: { linhas: [
      { dataAreaId: 'msb', LoadId: 'LD-91', LoadStatus: 'Loaded', QuotationPerformed_InoveProjects: 'No', ENVIARPALLET_CUSTOM: 'No' },
      { dataAreaId: 'msb', LoadId: 'LD-92', LoadStatus: 'InProcess', QuotationPerformed_InoveProjects: 'No', ENVIARPALLET_CUSTOM: 'No' }
    ] }
  };
  r = await K.ordensDoDia({ data: DIA });
  const g8 = {}; r.ovs.forEach(o => { g8[o.chave] = o; });
  t('carga Carregado: linha em aberto -> Cotação, Entregue -> Aguardando, Faturada -> Faturado (3 cartões, cada um com o seu valor)',
    g8['OV019101~cotacao'] && g8['OV019101~cotacao'].valor === 100 && g8['OV019101~aguardando'] && g8['OV019101~aguardando'].valor === 200 && g8['OV019101~faturado'] && g8['OV019101~faturado'].valor === 300
    && g8['OV019101~faturado'].parte.status.join() === 'faturada' && g8['OV019101~cotacao'].irmas.length === 2, Object.keys(g8));
  t('carga Em processamento: linha Entregue e em aberto -> Conferência, um cartão só', g8.OV019102 && g8.OV019102.etapa === 'conferencia' && !g8.OV019102.parte && g8.OV019102.linhasSt.entregue === 1 && g8.OV019102.linhasSt.aberta === 1, g8.OV019102 && g8.OV019102.etapa);
  t('a cotação realizada não decide mais Cotação x Aguardando', g8['OV019101~aguardando'].cargas[0].cotacao === 'No');
  CEN = guarda8g; SERVICO = serv8g;

  console.log('9) "Enviar para o Pallet": grava ENVIARPALLET_CUSTOM = Sim no D365');
  chamadas.length = 0;
  let rp = await K.enviarParaPallet('LD-4');
  const patch = chamadas.find(c => c.metodo === 'PATCH');
  t('grava na carga, pela chave dataAreaId + LoadId, cross-company', patch && patch.ent === 'WHSOutboundLoadHeaderEntities' && patch.chave.dataAreaId === 'msb' && patch.chave.LoadId === 'LD-4' && patch.cross === 'true', patch);
  t('ENVIARPALLET_CUSTOM = "Yes"', patch && patch.corpo.ENVIARPALLET_CUSTOM === 'Yes' && Object.keys(patch.corpo).length === 1 && rp.ok && rp.coluna === 'ENVIARPALLET_CUSTOM', patch && patch.corpo);
  t('relê a carga depois de gravar: confirmado, sem aviso', rp.confirmado === true && !rp.aviso && rp.leitura.entidade === 'WHSOutboundLoadHeaderEntities', rp);

  r = await K.ordensDoDia({ data: DIA });
  t('depois de gravar, a OV vai para o Pallet (o cache foi limpo)', r.ovs.find(o => o.numero === 'OV019004').etapa === 'pallet', r.ovs.find(o => o.numero === 'OV019004').etapa);
  chamadas.length = 0;
  rp = await K.enviarParaPallet('LD-6');
  t('já enviada: ok, sem gravar de novo', rp.ok && rp.ja === true && !chamadas.some(c => c.metodo === 'PATCH'), rp);
  let erro = null; try { await K.enviarParaPallet('LD-3'); } catch (e) { erro = e; }
  t('cotação não realizada: recusa (409) sem gravar', erro && erro.status === 409 && /cotação realizada: Não/.test(erro.message) && !chamadas.some(c => c.metodo === 'PATCH'), erro && erro.message);
  erro = null; try { await K.enviarParaPallet('LD-NAO'); } catch (e) { erro = e; }
  t('carga que não existe: 404', erro && erro.status === 404, erro && erro.message);
  erro = null; try { await K.enviarParaPallet("LD' or 1"); } catch (e) { erro = e; }
  t('número de carga inválido: 400', erro && erro.status === 400, erro && erro.message);

  console.log('5) linhas de uma OV (a ficha do painel)');
  K._limparCache(); chamadas.length = 0;
  CEN = {
    SalesOrderLines: { linhas: [
      { dataAreaId: 'msb', SalesOrderNumber: 'OV017525', LineNumber: 2, ItemNumber: '73172', LineDescription: 'CAT BALAO 8MM', OrderedSalesQuantity: 2, SalesUnitSymbol: 'UN',
        SalesPrice: 400, LineDiscountAmount: 0, LineAmount: 800, SalesOrderLineStatus: 'Backorder', RequestedShippingDate: '2026-11-10T12:00:00Z',
        ConfirmedShippingDate: '1900-01-01T12:00:00Z', ShippingWarehouseId: 'RETCONSIGV', ItemBatchNumber: 'LT-77' },
      { dataAreaId: 'msb', SalesOrderNumber: 'OV017525', LineNumber: 1, ItemNumber: '73171', LineDescription: 'CAT BALAO 7MM', OrderedSalesQuantity: 5, SalesUnitSymbol: 'UN',
        SalesPrice: 365, LineAmount: 1825, SalesOrderLineStatus: 'Backorder', ShippingWarehouseId: 'RETCONSIGV', ItemBatchNumber: '' },
      { dataAreaId: 'msb', SalesOrderNumber: 'OV099999', LineNumber: 1, ItemNumber: 'X', LineAmount: 1 }
    ] }
  };
  r = await K.linhasDaOv('ov017525');
  t('só as linhas da OV pedida, pela ordem da linha', r.linhas.length === 2 && r.linhas[0].item === '73171' && r.linhas[1].item === '73172', r.linhas);
  const l2 = r.linhas[1];
  t('produto, qtd × preço, valor e status', l2.produto === 'CAT BALAO 8MM' && l2.qtd === 2 && l2.preco === 400 && l2.valor === 800 && l2.status === 'Backorder' && l2.un === 'UN', l2);
  t('entrega pela data; 1900 = sem data', l2.entrega === '2026-11-10' && l2.confirmada === null, l2);
  t('o lote de cada linha (e se a entidade traz o lote)', l2.lote === 'LT-77' && r.linhas[0].lote === '' && l2.temLote && r.linhas[0].temLote, r.linhas.map(x => [x.lote, x.temLote]));
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
  K._limparCache();
  CEN = { WHSOutboundLoadHeaderEntities: { linhas: [{ dataAreaId: 'msb', LoadId: 'LD-50', LoadStatus: 'Loaded', QuotationPerformed_InoveProjects: 'Yes', ENVIARPALLET_CUSTOM: 'No' }] } };
  SERVICO = ['WHSOutboundLoadHeaderEntities'];
  const logs = []; const ctxL = { log: Object.assign((...a) => logs.push(a.join(' ')), { error() {} }) };
  // 11/11/26 (dono: "retira o BOTÃO ENVIAR PARA O PALLET"): por padrão o envio está DESLIGADO
  auth.requireArea = async () => ({ user: { email: 'fulano@biomedical.com.br' }, validated: true });
  await fn(ctxL, { method: 'POST', headers: {}, query: {}, body: { acao: 'enviar-pallet', carga: 'LD-50', ov: 'OV1' } });
  t('envio ao Pallet desligado (padrão): 410 e não grava no Dynamics', ctxL.res.status === 410 && /desativado/.test(ctxL.res.body.error) && CEN.WHSOutboundLoadHeaderEntities.linhas[0].ENVIARPALLET_CUSTOM === 'No'
    && !chamadas.some(c => c.metodo === 'PATCH' && c.chave.LoadId === 'LD-50'), { st: ctxL.res.status, body: ctxL.res.body });
  // religado (KANBAN_PALLET_BOTAO=1): as regras de antes
  process.env.KANBAN_PALLET_BOTAO = '1';
  auth.requireArea = async () => ({ user: { email: 'fulano@biomedical.com.br' }, validated: false });
  await fn(ctxL, { method: 'POST', headers: {}, query: {}, body: { acao: 'enviar-pallet', carga: 'LD-50', ov: 'OV1' } });
  t('POST sem o login validado -> 403 e não grava', ctxL.res.status === 403 && CEN.WHSOutboundLoadHeaderEntities.linhas[0].ENVIARPALLET_CUSTOM === 'No', ctxL.res.status);
  auth.requireArea = async () => ({ user: { email: 'fulano@biomedical.com.br' }, validated: true });
  await fn(ctxL, { method: 'POST', headers: {}, query: {}, body: JSON.stringify({ acao: 'enviar-pallet', carga: 'LD-50', ov: 'OV1' }) });
  t('POST validado -> 200, grava e fica no log com quem fez', ctxL.res.status === 200 && CEN.WHSOutboundLoadHeaderEntities.linhas[0].ENVIARPALLET_CUSTOM === 'Yes' && logs.some(l => /enviar-pallet/.test(l) && /fulano@/.test(l) && /LD-50/.test(l)), { st: ctxL.res.status, logs });
  await fn(ctxL, { method: 'POST', headers: {}, query: {}, body: { acao: 'apagar-tudo' } });
  t('POST com outra ação -> 400', ctxL.res.status === 400, ctxL.res.status);
  delete process.env.KANBAN_PALLET_BOTAO;
  await fn(ctx, { method: 'GET', headers: {}, query: { de: '2025-01-01', ate: '2026-11-06' } });
  t('período de mais de 1 ano -> 400', ctx.res.status === 400, ctx.res.status);
  await fn(ctx, { method: 'GET', headers: {}, query: { de: '01/11/2026' } });
  t('data de período inválida -> 400', ctx.res.status === 400, ctx.res.status);
  auth.requireArea = orig;

  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\ntudo ok');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
