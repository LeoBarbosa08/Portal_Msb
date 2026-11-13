// ================================================================
// scripts/test-rastreio.js — testes do KANBAN › RASTREIO DE ENTREGA
// (api/shared/kanban-ov.js expedidas, brix.js, rastreio-store.js, rastreio.js
// e a rota /api/rastreio) contra um F&O, uma Brix e um Azure Blob SIMULADOS.
//
//   node scripts/test-rastreio.js
// ================================================================

process.env.D365_TENANT_ID = 't'; process.env.D365_CLIENT_ID = 'c'; process.env.D365_CLIENT_SECRET = 's';
process.env.D365_RESOURCE_URL = 'https://fo.teste';
process.env.RASTREIO_DESDE = '2026-11-11';
const TOKEN_BRIX = 'tok-brix-SEGREDO-123';
process.env.BRIX_URL = 'https://brix.teste';
process.env.KANBAN_BLOB_URL = 'https://blob.teste/kanban?sig=assinatura';
delete process.env.LOG_PORTAL_BLOB_URL;
delete process.env.RASTREIO_CHAVE;

let falhas = 0;
function t(nome, ok, extra) { console.log((ok ? '  ok  ' : '  FALHOU ') + nome + (ok || extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); if (!ok) falhas++; }
const corpo = (j, st, headers) => ({ ok: (st || 200) < 400, status: st || 200, headers: { get: (k) => (headers || {})[String(k).toLowerCase()] || null },
  text: async () => typeof j === 'string' ? j : JSON.stringify(j), json: async () => j });

// ── F&O simulado (o mesmo avaliador de $filter do test-kanban-ov.js) ──
let CEN = {}, SERVICO = [];
const chamadas = [];
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
function fo(u) {
  if (u.pathname === '/data') return corpo({ value: SERVICO.map(n => ({ name: n, url: n })) });
  const ent = u.pathname.replace('/data/', '');
  const q = { filter: u.searchParams.get('$filter') || '', top: u.searchParams.get('$top'), select: u.searchParams.get('$select') };
  chamadas.push({ ent, q });
  const E = CEN[ent];
  if (!E) return corpo({ error: { message: 'not found' } }, 404);
  if (q.top === '1') return corpo({ value: E.linhas.slice(0, 1) });
  return corpo({ value: q.filter ? E.linhas.filter(r => avalia(q.filter, r)) : E.linhas });
}

// ── Brix simulada: /tracking/integracao/{token}/notas/{nf,…} ──
let BRIX = {}, brixPedidos = [], brixFalha = 0;
function brix(u) {
  const m = /^\/tracking\/integracao\/([^/]+)\/notas\/([^/]+)\/?$/.exec(u.pathname);
  brixPedidos.push(decodeURIComponent(u.pathname));
  if (brixFalha) { brixFalha--; return corpo('erro interno em ' + u.pathname, 500); }
  if (!m) return corpo({ status: 0, message: 'rota' }, 404);
  if (decodeURIComponent(m[1]) !== TOKEN_BRIX) return corpo({ status: 0, message: 'Token inválido', data: [] });
  const data = m[2].split(',').filter(n => BRIX[n]).map(n => BRIX[n]);
  return corpo({ status: 1, message: 'OK', data });
}
const ev = (data, hora, cod, desc, comp) => ({ data, hora, codigoEvento: cod, descricao: desc, comprovante: comp || '' });
const envio = (nf, status, eventos, extra) => Object.assign({ minuta: '78' + nf, cte: '35' + nf.slice(-3), cteSerie: '1', codigoRastreio: nf, codigoEvento: status === '6' ? '999' : '',
  cnpjEmpresa: '06167295000171', datahoraEvento: status === '6' ? '12/11/2026 11:20:44' : '', responsavel: status === '6' ? 'MARIA RECEBEDORA' : '', status,
  previsao_entrega: '16/11/2026 23:59:00', eventos }, extra || {});

// ── Azure Blob simulado, com ETag ──
const BLOBS = {}; let etagSeq = 0, conflitoNaProxima = 0, putsBlob = 0;
function blob(u, opts) {
  const nome = decodeURIComponent(u.pathname.replace(/^\/kanban\//, '')), metodo = (opts && opts.method) || 'GET', h = (opts && opts.headers) || {};
  if (u.searchParams.get('sig') !== 'assinatura') return corpo('sem SAS', 403);
  if (metodo === 'GET') return BLOBS[nome] ? corpo(BLOBS[nome].body, 200, { etag: BLOBS[nome].etag }) : corpo('', 404);
  if (metodo === 'PUT') {
    putsBlob++;
    if (conflitoNaProxima) {   // outro gravou entre a leitura e esta gravação
      conflitoNaProxima--;
      const d = BLOBS[nome] ? JSON.parse(BLOBS[nome].body) : { versao: 1, ovs: {} };
      d.outro = (d.outro || 0) + 1;
      BLOBS[nome] = { body: JSON.stringify(d), etag: '"e' + (++etagSeq) + '"' };
    }
    const atual = BLOBS[nome];
    if (h['If-None-Match'] === '*' && atual) return corpo('', 409);
    if (h['If-Match'] && (!atual || atual.etag !== h['If-Match'])) return corpo('', 412);
    BLOBS[nome] = { body: String(opts.body || ''), etag: '"e' + (++etagSeq) + '"' };
    return corpo('', 201);
  }
  return corpo('', 400);
}

global.fetch = async (url, opts) => {
  const u = new URL(String(url));
  if (/login\.microsoftonline/.test(u.hostname)) return corpo({ access_token: 'tok', expires_in: 3600 });
  if (u.hostname === 'fo.teste') return fo(u);
  if (u.hostname === 'brix.teste') return brix(u);
  if (u.hostname === 'blob.teste') return blob(u, opts);
  throw new Error('fetch inesperado: ' + u.hostname);
};

const K = require('../api/shared/kanban-ov');
const B = require('../api/shared/brix');
const S = require('../api/shared/rastreio-store');
const R = require('../api/shared/rastreio');

// o cenário: 2 OVs expedidas desde 11/11 (uma Brix, uma de outra transportadora) e o que não entra
const v2 = (n, nome) => ({ dataAreaId: 'msb', SalesOrderNumber: n, OrderCreationDateTime: '2026-11-10T12:00:00Z', SalesOrderStatus: 'Invoiced', SalesOrderName: nome,
  OrderingCustomerAccountNumber: 'C' + n.slice(-3), DeliveryAddressCity: 'Salvador', DeliveryAddressStateId: 'BA', DefaultShippingWarehouseId: 'ALMOX-PA' });
const w = (ov, id, carga, tipo) => ({ dataAreaId: 'msb', OrderNum: ov, WorkId: id, WorkStatus: 'Closed', WorkTransType: tipo || 'Sales', LoadId: carga });
const ld = (id, conf, dep, transp) => ({ dataAreaId: 'msb', LoadId: id, LoadStatus: conf ? 'Shipped' : 'Loaded', LoadShipConfirmUTCDateTime: conf || '1900-01-01T00:00:00Z',
  InventLocationId: dep || 'ALMOX-PA', CarrierCode: transp || '' });
const nf = (ov, n, data) => ({ dataAreaId: 'msb', SalesOrderNumber: ov, InvoiceNumber: n, InvoiceDate: data + 'T12:00:00Z', TotalInvoiceAmount: 100 });
function cenario() {
  SERVICO = ['SalesOrderHeadersV2', 'WHSWorkTableBiEntities', 'WHSLoadTableBiEntities', 'SalesInvoiceHeadersV2'];
  CEN = {
    SalesOrderHeadersV2: { linhas: [v2('OV017501', 'HOSPITAL UM'), v2('OV017502', 'CLINICA DOIS'), v2('OV017503', 'TRES'), v2('OV017504', 'QUATRO')] },
    WHSWorkTableBiEntities: { linhas: [
      w('OV017501', 'W1', 'LD-A'), w('OV017502', 'W2', 'LD-B'),
      w('OV017503', 'W3', 'LD-A', 'TransferIssue'),   // transferência na mesma carga: não é OV de venda
      w('OV017504', 'W4', 'LD-C')                      // carga expedida antes de 11/11
    ] },
    WHSLoadTableBiEntities: { linhas: [
      ld('LD-A', '2026-11-12T14:00:00Z', 'ALMOX-PA', 'BRIX'),
      ld('LD-B', '2026-11-13T10:00:00Z', 'ALMOX-PA', 'OUTRA'),
      ld('LD-C', '2026-11-10T15:00:00Z'),               // antes do corte
      ld('LD-F', '2026-11-11T02:00:00Z'),               // 10/11 23:00 em Brasília: antes do corte
      ld('LD-D', '2026-11-12T14:00:00Z', 'EMB-SEC'),    // outro depósito
      ld('LD-E', null)                                  // Carregado, sem envio confirmado
    ] },
    SalesInvoiceHeadersV2: { linhas: [nf('OV017501', '000021509', '2026-11-12'), nf('OV017502', '000099001', '2026-11-13'), nf('OV017504', '000021400', '2026-11-10')] }
  };
  BRIX = {
    '21509': envio('21509', '6', [
      ev('2026-11-12', '08:00:00', '100', 'EMISSAO REALIZADA'),
      ev('2026-11-12', '11:20:44', '1', 'ENTREGA REALIZADA NORMALMENTE', 'https://s3.brudam.com.br/comprovantes/x.jpg'),
      ev('2026-11-12', '11:21:26', '493', 'EVENTO DE ENTREGA REGISTRADO NA SEFAZ')
    ])
  };
}

(async () => {
  console.log('1) expedidas: as cargas com o envio confirmado desde 11/11, do ALMOX-PA, OV pelo trabalho de venda');
  cenario(); K._limparCache(); chamadas.length = 0;
  let e = await K.expedidas({});
  t('2 OVs (OV017502, a mais recente, primeiro)', e.ovs.map(o => o.numero).join() === 'OV017502,OV017501', e.ovs.map(o => o.numero));
  const o1 = e.ovs.find(o => o.numero === 'OV017501');
  t('cliente, cidade, NF e carga da OV', o1 && o1.cliente === 'HOSPITAL UM' && o1.cidade === 'Salvador' && o1.uf === 'BA' && o1.notas[0].numero === '000021509'
    && o1.cargas[0].id === 'LD-A' && o1.cargas[0].transportadora === 'BRIX' && o1.expedidaEm === '2026-11-12T14:00:00Z', o1);
  t('sem transferência, sem carga antes de 11/11, sem outro depósito', !e.ovs.some(o => ['OV017503', 'OV017504'].indexOf(o.numero) >= 0), e.ovs.map(o => o.numero));
  const qc = chamadas.find(c => c.ent === 'WHSLoadTableBiEntities' && /LoadShipConfirmUTCDateTime ge/.test(c.q.filter));
  t('filtro das cargas: envio confirmado desde 11/11 00:00 de Brasília, só ALMOX-PA', qc && /LoadShipConfirmUTCDateTime ge 2026-11-11T03:00:00Z/.test(qc.q.filter) && /InventLocationId eq 'ALMOX-PA'/.test(qc.q.filter), qc && qc.q.filter);
  const n0 = chamadas.length; await K.expedidas({});
  t('cache: a 2ª leitura não vai ao Dynamics', chamadas.length === n0, chamadas.length - n0);

  console.log('2) Brix: normalização');
  process.env.BRIX_TOKEN = TOKEN_BRIX;
  const nE = B._interno.normalizar(BRIX['21509']);
  t('status 6 + evento 1 = entregue, com a hora do evento, o recebedor e o comprovante', nE.situacao === 'entregue' && nE.entregueEm === '2026-11-12T11:20:44'
    && nE.recebedor === 'MARIA RECEBEDORA' && nE.comprovantes.length === 1 && nE.eventos[0].codigo === '493' && nE.previsao === '2026-11-16T23:59:00', nE);
  const nT = B._interno.normalizar(envio('21510', '3', [ev('2026-11-13', '08:51:09', '103', 'SAIDA EFETIVA DA CARGA PARA COLETA/ENTREGA')]));
  t('status 3 = a caminho, sem recebedor', nT.situacao === 'transito' && !nT.recebedor && !nT.entregueEm && nT.ultimo.codigo === '103', nT);
  const nC = B._interno.normalizar(envio('21511', '13', [ev('2026-11-10', '10:00:00', '137', 'CTE CANCELADO NO SEFAZ')]));
  t('status 13 = cancelado', nC.situacao === 'cancelado', nC.situacao);
  const nE2 = B._interno.normalizar(envio('21512', '3', [ev('2026-11-13', '09:00:00', '1', 'ENTREGA REALIZADA NORMALMENTE')]));
  t('evento 1 sem o status 6 também é entregue', nE2.situacao === 'entregue' && nE2.entregueEm === '2026-11-13T09:00:00', nE2);
  t('a mesma NF cancelada e refeita: vale a entregue', B._interno.melhor(nC, nE).situacao === 'entregue' && B._interno.melhor(nE, nC).situacao === 'entregue');
  t('nfNorm tira os zeros e o que não é número', B.nfNorm('000021509') === '21509' && B.nfNorm('NF 000077001') === '77001' && B.nfNorm('') === '');
  t('as mensagens nunca levam o token', B._interno.limpo('falhou em /x/' + TOKEN_BRIX + '/notas') === 'falhou em /x/***/notas');

  console.log('3) o robô: consulta a Brix pelas NFs e move a entregue para Aguardando Revisão');
  brixPedidos = []; putsBlob = 0;
  let r = await R.rodar({ por: 'teste' });
  t('uma chamada à Brix com as 2 NFs, sem zeros', brixPedidos.length === 1 && /\/notas\/(21509,99001|99001,21509)$/.test(brixPedidos[0]), brixPedidos);
  t('rodada: 2 OVs, 2 NFs, 1 achada, 1 para a revisão', r.ok && r.brix && r.rodada.ovs === 2 && r.rodada.nfs === 2 && r.rodada.achadas === 1 && r.rodada.novasRevisao === 1 && !r.rodada.erros.length, r.rodada);
  let est = JSON.parse(BLOBS[S.NOME].body);
  t('OV017501 em revisão, com o comprovante e o recebedor', est.ovs.OV017501 && est.ovs.OV017501.fase === 'revisao' && est.ovs.OV017501.rastreio.comprovantes[0] === 'https://s3.brudam.com.br/comprovantes/x.jpg'
    && est.ovs.OV017501.rastreio.recebedor === 'MARIA RECEBEDORA' && est.ovs.OV017501.hist[0].para === 'revisao', est.ovs.OV017501);
  t('OV017502 (outra transportadora) não entra no registro', !est.ovs.OV017502, Object.keys(est.ovs));
  brixPedidos = [];
  r = await R.rodar({});
  t('2ª rodada: a OV em revisão não é consultada de novo', brixPedidos.length === 1 && /\/notas\/99001$/.test(brixPedidos[0]) && r.rodada.nfs === 1, brixPedidos);

  console.log('4) o quadro: as três fases');
  let q = await R.quadro({});
  const fase = (n) => (q.ovs.find(o => o.numero === n) || {}).fase;
  t('Expedição 1 (OV017502), Aguardando Revisão 1 (OV017501), Entregue 0', q.fases.map(f => f.id + ':' + f.qtd).join() === 'expedicao:1,revisao:1,entregue:0' && fase('OV017502') === 'expedicao' && fase('OV017501') === 'revisao', q.fases);
  t('sem avisos (Brix e blob configurados)', q.brix && q.registro === 'blob' && !q.avisos.length, q.avisos);
  t('a OV em revisão traz o rastreio', q.ovs.find(o => o.numero === 'OV017501').rastreio.situacao === 'entregue', q.ovs.find(o => o.numero === 'OV017501').rastreio);

  console.log('5) o operador: concluir e reabrir');
  const quem = { email: 'Operador@Biomedical.com.br', nome: 'Operador' };
  let erro = null;
  try { await R.concluir('OV017502', quem); } catch (x) { erro = x; }
  t('concluir uma OV que está em Expedição -> 404 (não está no registro)', erro && erro.status === 404, erro && erro.message);
  erro = null;
  try { await R.reabrir('OV017501', quem); } catch (x) { erro = x; }
  t('reabrir uma OV que não está em Entregue -> 409', erro && erro.status === 409, erro && erro.message);
  r = await R.concluir('ov017501', quem);
  t('concluir: Entregue, com quem e quando (e-mail em minúsculas)', r.ov.fase === 'entregue' && r.ov.concluidoPor === 'operador@biomedical.com.br' && r.ov.concluidoEm && r.ov.hist.length === 2, r.ov);
  r = await R.reabrir('OV017501', quem);
  t('reabrir: volta para Aguardando Revisão, sem o concluído', r.ov.fase === 'revisao' && !r.ov.concluidoPor && r.ov.hist.length === 3, r.ov);
  conflitoNaProxima = 1;
  r = await R.concluir('OV017501', quem);
  est = JSON.parse(BLOBS[S.NOME].body);
  t('outro gravou no meio: relê e grava sem perder a gravação do outro', r.ov.fase === 'entregue' && est.outro === 1 && est.ovs.OV017501.fase === 'entregue', { outro: est.outro });
  erro = null;
  try { await R.concluir("OV1' or 1 eq 1", quem); } catch (x) { erro = x; }
  t('nº de OV inválido -> 400', erro && erro.status === 400);

  console.log('6) a Brix falhando: a rodada registra o erro sem o token');
  brixFalha = 1;
  r = await R.rodar({});
  t('erro registrado, sem o token', r.rodada.erros.length === 1 && r.rodada.erros[0].indexOf(TOKEN_BRIX) < 0, r.rodada.erros);

  console.log('7) a rota /api/rastreio');
  const auth = require('../api/shared/auth');
  const fn = require('../api/rastreio/index.js');
  const orig = auth.requireArea;
  let pediu = null;
  auth.requireArea = async (req, area) => { pediu = area; const x = new Error('forbidden'); x.status = 403; throw x; };
  const ctx = { log: Object.assign(() => {}, { error() {} }) };
  await fn(ctx, { method: 'GET', headers: {}, query: {} });
  t('sem a área kanban -> 403', ctx.res.status === 403 && pediu === 'kanban', ctx.res.status);
  await fn(ctx, { method: 'POST', headers: { 'x-rastreio-chave': 'qualquer' }, query: {}, body: { acao: 'consultar' } });
  t('agendamento sem RASTREIO_CHAVE configurada -> 403', ctx.res.status === 403, ctx.res.status);
  process.env.RASTREIO_CHAVE = 'chave-do-agendamento-1234567890';
  await fn(ctx, { method: 'POST', headers: { 'x-rastreio-chave': 'errada' }, query: {}, body: { acao: 'consultar' } });
  t('chave errada -> 403', ctx.res.status === 403, ctx.res.status);
  pediu = null;
  await fn(ctx, { method: 'POST', headers: { 'x-rastreio-chave': 'chave-do-agendamento-1234567890' }, query: {}, body: JSON.stringify({ acao: 'consultar' }) });
  t('chave certa: o robô roda sem login', ctx.res.status === 200 && ctx.res.body.rodada && ctx.res.body.rodada.por === 'agendamento' && pediu === null, ctx.res.body);
  await fn(ctx, { method: 'POST', headers: { 'x-rastreio-chave': 'chave-do-agendamento-1234567890' }, query: {}, body: { acao: 'concluir', ov: 'OV017501' } });
  t('a chave não serve para concluir -> 403', ctx.res.status === 403, ctx.res.status);
  auth.requireArea = async () => ({ user: { email: 'fulano@biomedical.com.br', name: 'Fulano' }, validated: true });
  await fn(ctx, { method: 'GET', headers: {}, query: {} });
  t('GET com login: o quadro', ctx.res.status === 200 && ctx.res.body.fases.length === 3 && ctx.res.body.ovs.length === 2, ctx.res.status);
  await fn(ctx, { method: 'POST', headers: {}, query: {}, body: { acao: 'reabrir', ov: 'OV017501' } });
  t('POST reabrir com login -> 200', ctx.res.status === 200 && ctx.res.body.ov.fase === 'revisao', ctx.res.body);
  await fn(ctx, { method: 'POST', headers: {}, query: {}, body: { acao: 'concluir', ov: 'OV017502' } });
  t('concluir o que não está em revisão -> 404 com a mensagem', ctx.res.status === 404 && /não está no rastreio/.test(ctx.res.body.error), ctx.res.body);
  await fn(ctx, { method: 'POST', headers: {}, query: {}, body: { acao: 'apagar' } });
  t('ação desconhecida -> 400', ctx.res.status === 400, ctx.res.status);
  auth.requireArea = orig;

  console.log('8) sem o BRIX_TOKEN e sem o blob');
  delete process.env.BRIX_TOKEN; delete process.env.KANBAN_BLOB_URL; S._limpar(); K._limparCache();
  brixPedidos = [];
  r = await R.rodar({});
  t('sem o token: não consulta a Brix', r.brix === false && !brixPedidos.length, r);
  q = await R.quadro({});
  t('o quadro avisa (token e memória) e tudo fica em Expedição', q.registro === 'memoria' && q.avisos.some(a => /BRIX_TOKEN/.test(a)) && q.avisos.some(a => /memória/.test(a))
    && q.fases.map(f => f.qtd).join() === '2,0,0', { avisos: q.avisos, fases: q.fases });
  process.env.BRIX_TOKEN = TOKEN_BRIX;
  r = await R.rodar({});
  q = await R.quadro({});
  t('na memória: o robô move e o quadro mostra', r.rodada.novasRevisao === 1 && q.fases.map(f => f.qtd).join() === '1,1,0', q.fases);

  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\ntudo ok');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
