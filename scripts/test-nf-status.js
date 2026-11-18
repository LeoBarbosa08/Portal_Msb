// ================================================================
// scripts/test-nf-status.js — testes do STATUS DA NOTA pelo POWER AUTOMATE
// (api/shared/nf-status-fluxo.js, a rota /api/nf-status e a reserva em
// api/shared/fatdia-status.js) contra um F&O e um Azure Blob SIMULADOS.
//
//   node scripts/test-nf-status.js
// ================================================================

process.env.D365_TENANT_ID = 't'; process.env.D365_CLIENT_ID = 'c'; process.env.D365_CLIENT_SECRET = 's';
process.env.D365_RESOURCE_URL = 'https://fo.teste';
delete process.env.KANBAN_BLOB_URL; delete process.env.LOG_PORTAL_BLOB_URL; delete process.env.KANBAN_NF_CHAVE;
delete process.env.FATDIA_EMPRESA; delete process.env.ESTOQUE_MSB_EMPRESA;

let falhas = 0;
function t(nome, ok, extra) { console.log((ok ? '  ok  ' : '  FALHOU ') + nome + (ok || extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); if (!ok) falhas++; }
const resp = (st, tx, h) => ({ ok: st < 400, status: st, headers: { get: (k) => (h || {})[String(k).toLowerCase()] || null }, text: async () => tx || '', json: async () => JSON.parse(tx || 'null') });

// ── Azure Blob simulado (com ETag) ──
const BLOBS = {}; let ETAG = 0, CONFLITOS = 0, LEITURAS = 0;
function blobFalso(u, opts) {
  const nome = decodeURIComponent(u.pathname.replace(/^\/kanban\//, '')), metodo = (opts && opts.method) || 'GET', h = (opts && opts.headers) || {};
  if (metodo === 'GET') { LEITURAS++; return BLOBS[nome] == null ? resp(404) : resp(200, BLOBS[nome].corpo, { etag: BLOBS[nome].etag }); }
  if (metodo === 'PUT') {
    if (CONFLITOS > 0) { CONFLITOS--; return resp(412); }
    if (h['If-None-Match'] === '*' && BLOBS[nome] != null) return resp(409);
    if (h['If-Match'] && (!BLOBS[nome] || BLOBS[nome].etag !== h['If-Match'])) return resp(412);
    BLOBS[nome] = { corpo: String(opts.body || ''), etag: '"e' + (++ETAG) + '"' };
    return resp(201);
  }
  return resp(400);
}

// ── F&O simulado: as entidades de documento fiscal ──
let SERVICO = [], CEN = {};
global.fetch = async (url, opts) => {
  url = String(url);
  if (/login\.microsoftonline/.test(url)) return resp(200, JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
  const u = new URL(url);
  if (u.hostname === 'blob.teste') return blobFalso(u, opts);
  if (u.pathname === '/data') return resp(200, JSON.stringify({ value: SERVICO.map(n => ({ name: n, url: n })) }));
  const ent = u.pathname.replace('/data/', ''), E = CEN[ent];
  if (!E) return resp(404, JSON.stringify({ error: { message: 'not found' } }));
  const top = u.searchParams.get('$top'), f = u.searchParams.get('$filter') || '';
  if (top === '1') return resp(200, JSON.stringify({ value: E.slice(0, 1) }));
  const nums = (f.match(/FiscalDocumentNumber eq '([^']*)'/g) || []).map(x => /'([^']*)'/.exec(x)[1]);
  return resp(200, JSON.stringify({ value: E.filter(r => nums.indexOf(r.FiscalDocumentNumber) >= 0) }));
};

const FX = require('../api/shared/nf-status-fluxo');
const ST = require('../api/shared/fatdia-status');
const fn = require('../api/nf-status/index.js');
const ctx = () => ({ log: Object.assign(() => {}, { error() {} }) });
async function chama(metodo, corpo, chave) {
  const c = ctx();
  await fn(c, { method: metodo, headers: chave ? { 'x-portal-chave': chave } : {}, body: corpo });
  return c.res;
}
const CHAVE = 'chave-do-fluxo-com-mais-de-24-caracteres';
const HOJE = new Date().toISOString().slice(0, 10);
const diaMenos = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

(async () => {
  console.log('1) a porta: sem a chave configurada, chave errada, método, corpo');
  let r = await chama('POST', { notas: [] }, CHAVE);
  t('sem KANBAN_NF_CHAVE: 503 (fail-closed)', r.status === 503 && /KANBAN_NF_CHAVE/.test(r.body.error), r);
  process.env.KANBAN_NF_CHAVE = 'curta';
  r = await chama('POST', { notas: [] }, 'curta');
  t('chave curta demais também desliga (503)', r.status === 503, r.status);
  process.env.KANBAN_NF_CHAVE = CHAVE;
  r = await chama('POST', { notas: [] });
  t('sem o cabeçalho: 401', r.status === 401, r);
  r = await chama('POST', { notas: [] }, CHAVE + 'x');
  t('chave errada: 401', r.status === 401, r);
  r = await chama('GET', null, CHAVE);
  t('GET: 400 "Use POST"', r.status === 400 && /POST/.test(r.body.error), r);
  r = await chama('POST', { qualquer: 1 }, CHAVE);
  t('corpo sem a lista: 400 explicando o formato', r.status === 400 && /notas/.test(r.body.error), r);
  r = await chama('POST', '{nao e json', CHAVE);
  t('corpo que não é JSON: 400', r.status === 400, r);

  console.log('2) os formatos do Power Automate (na memória, sem blob)');
  FX._limpar();
  r = await chama('POST', { notas: [{ numero: '000021638', status: 'Aprovada', data: '2026-11-17', empresa: 'msb' }] }, CHAVE);
  t('{ notas: [...] } grava', r.status === 200 && r.body.ok && r.body.gravadas === 1 && r.body.novas === 1 && r.body.memoria === true, r.body);
  r = await chama('POST', [{ Numero: '000021639', Status: 'Cancelada', Data: '17/11/2026' }], CHAVE);
  t('lista pura e data dd/mm/aaaa', r.status === 200 && r.body.gravadas === 1, r.body);
  r = await chama('POST', { ResultSets: { Table1: [{ NumeroNF: '21640', StatusNF: 'Rejeitada', DataEmissao: '2026-11-17T00:00:00', DATAAREAID: 'MSB' }] }, OutputParameters: {} }, CHAVE);
  t('o corpo do "Executar uma consulta SQL (V2)" (ResultSets.Table1, nomes do banco)', r.status === 200 && r.body.gravadas === 1, r.body);
  r = await chama('POST', JSON.stringify({ value: [{ FiscalDocumentNumber: '000021641', FiscalDocumentStatus: 'Approved', FiscalDocumentDate: '2026-11-17T12:00:00Z' }] }), CHAVE);
  t('{ value: [...] } em texto, com os nomes do Dynamics', r.status === 200 && r.body.gravadas === 1, r.body);
  r = await chama('POST', { notas: [
    { numero: '000021650', status: 'Aprovada', data: '2026-11-17', empresa: 'bio' },
    { numero: '000021651', status: '1', data: '2026-11-17' },
    { numero: '000021652', status: '', data: '2026-11-17' },
    { numero: '000021653', status: 'Aprovada', data: 'ontem' },
    { status: 'Aprovada' }, null
  ] }, CHAVE);
  const mot = {}; (r.body.motivos || []).forEach(m => { mot[m.motivo] = m; });
  t('nada disso entra', r.status === 200 && r.body.gravadas === 0 && r.body.ignoradas === 6, r.body);
  t('outra empresa (a BIO tem a numeração dela)', mot['de outra empresa'] && mot['de outra empresa'].exemplos[0] === '000021650 (bio)', mot);
  t('status em número: pede o texto na consulta', Object.keys(mot).some(m => /status em número/.test(m) && /Aprovada/.test(m)), Object.keys(mot));
  t('sem status, data inválida, sem número, linha vazia', mot['sem status'] && mot['data inválida'] && mot['sem o número da nota'] && mot['linha vazia'], Object.keys(mot));

  console.log('3) consultar: pelo número (com ou sem zeros), reserva marcada');
  let c = await FX.consultar(['000021638', '21639', '000099999'], Date.now() + 10000);
  t('acha a 000021638 e a 21639; a 99999 não', c.ligado && c.porNum['21638'] && c.porNum['21639'] && !c.porNum['99999'], c);
  t('vem marcada como reserva, do Power Automate', c.porNum['21638'][0].reserva === true && c.porNum['21638'][0].entidade === 'Power Automate (banco)' && c.porNum['21638'][0].status === 'Aprovada' && c.porNum['21638'][0].data === '2026-11-17', c.porNum['21638']);
  delete process.env.KANBAN_NF_CHAVE;
  c = await FX.consultar(['000021638'], Date.now() + 10000);
  t('sem a chave configurada: desligado, nada lido', c.ligado === false && !Object.keys(c.porNum).length, c);
  process.env.KANBAN_NF_CHAVE = CHAVE;

  console.log('4) atualizar: mesmo número e data troca o status; outra data é outro documento; poda');
  FX._limpar();
  await chama('POST', { notas: [{ numero: '000021638', status: 'Aprovada', data: HOJE }] }, CHAVE);
  r = await chama('POST', { notas: [{ numero: '21638', status: 'Cancelada', data: HOJE }] }, CHAVE);
  t('mesma nota, status novo: alterada (não duplica)', r.body.alteradas === 1 && r.body.novas === 0 && r.body.total === 1, r.body);
  c = await FX.consultar(['000021638'], Date.now() + 10000);
  t('vale o status novo', c.porNum['21638'].length === 1 && c.porNum['21638'][0].status === 'Cancelada', c.porNum['21638']);
  r = await chama('POST', { notas: [{ numero: '000021638', status: 'Cancelled', data: '2023-03-01' }, { numero: '000021700', status: 'Aprovada', data: diaMenos(500) }] }, CHAVE);
  c = await FX.consultar(['000021638', '000021700'], Date.now() + 10000);
  t('documento de 2023 e nota de 500 dias atrás: passaram dos 400 dias, saem na poda', c.porNum['21638'].length === 1 && !c.porNum['21700'], c.porNum);
  r = await chama('POST', { notas: [{ numero: '000021638', status: 'Aprovada', data: diaMenos(200) }] }, CHAVE);
  c = await FX.consultar(['000021638'], Date.now() + 10000);
  t('dentro dos 400 dias, outra data = outro documento (o mais novo primeiro)', c.porNum['21638'].length === 2 && c.porNum['21638'][0].data === HOJE, c.porNum['21638']);

  console.log('5) no blob (ETag): grava, relê, conflito refeito, cache');
  FX._limpar();
  process.env.KANBAN_BLOB_URL = 'https://blob.teste/kanban?sv=1&sig=SEGREDO';
  r = await chama('POST', { notas: [{ numero: '000021638', status: 'Aprovada', data: HOJE }] }, CHAVE);
  t('grava em kanban-nf-status/msb.json', r.status === 200 && BLOBS['kanban-nf-status/msb.json'] && !r.body.memoria, Object.keys(BLOBS));
  const arq = JSON.parse(BLOBS['kanban-nf-status/msb.json'].corpo);
  t('o arquivo tem a nota, a empresa e a rodada', arq.notas['21638'][0].status === 'Aprovada' && arq.empresa === 'msb' && arq.rodada.gravadas === 1, arq);
  CONFLITOS = 1;
  r = await chama('POST', { notas: [{ numero: '000021639', status: 'Rejeitada', data: HOJE }] }, CHAVE);
  t('outra gravação no meio (412): relê e refaz', r.status === 200 && r.body.total === 2 && JSON.parse(BLOBS['kanban-nf-status/msb.json'].corpo).notas['21638'], r.body);
  FX._limpar(); LEITURAS = 0;
  c = await FX.consultar(['000021639'], Date.now() + 10000);
  const c2 = await FX.consultar(['000021638'], Date.now() + 10000);
  t('lê do blob uma vez; a 2ª consulta vem do cache', c.porNum['21639'][0].status === 'Rejeitada' && c2.porNum['21638'] && LEITURAS === 1, { LEITURAS });
  CONFLITOS = 9;
  r = await chama('POST', { notas: [{ numero: '000021640', status: 'Aprovada', data: HOJE }] }, CHAVE);
  CONFLITOS = 0;
  t('conflito sem fim: 502 sem vazar a SAS', r.status === 502 && !/SEGREDO|sig=/.test(JSON.stringify(r.body)), r);

  console.log('6) a reserva no status da nota (fatdia-status): o Dynamics vale primeiro');
  FX._limpar(); ST._limparCache();
  delete process.env.KANBAN_BLOB_URL;
  await chama('POST', { notas: [
    { numero: '000021638', status: 'Aprovada', data: '2026-11-17' },     // o Dynamics não tem
    { numero: '000021639', status: 'Cancelada', data: '2026-11-17' },    // o Dynamics diz Approved
    { numero: '000021640', status: 'Rejeitada', data: '2026-11-17' }     // o Dynamics só tem um de 2023
  ] }, CHAVE);
  SERVICO = ['FiscalDocuments'];
  CEN = { FiscalDocuments: [
    { dataAreaId: 'msb', FiscalDocumentNumber: '000021639', Status: 'Approved', FiscalDocumentDate: '2026-11-17T12:00:00Z' },
    { dataAreaId: 'msb', FiscalDocumentNumber: '000021640', Status: 'Approved', FiscalDocumentDate: '2023-03-01T12:00:00Z' }
  ] };
  let s = await ST.statusPorNumero(['000021638', '000021639', '000021640'], Date.now() + 20000);
  const vale = (n) => ST.statusDaNota(s.porNum[ST.numNorm(n)], '2026-11-17');
  t('a 000021638 (sem status no Dynamics) sai Aprovada pelo fluxo', vale('000021638') && vale('000021638').status === 'Aprovada' && vale('000021638').entidade === 'Power Automate (banco)', vale('000021638'));
  t('a 000021639: vale o do Dynamics (Approved), não o do fluxo', vale('000021639') && vale('000021639').status === 'Approved' && vale('000021639').entidade === 'FiscalDocuments', vale('000021639'));
  t('a 000021640: o documento de 2023 não vale; entra o do fluxo (Rejeitada)', vale('000021640') && vale('000021640').status === 'Rejeitada', vale('000021640'));
  t('as fontes listam o fluxo e o diagnóstico tem a etapa status:fluxo', s.fontes.indexOf('Power Automate (banco).status') >= 0 && s.diag.some(d => d.etapa === 'status:fluxo' && d.achadas === 3), { fontes: s.fontes, diag: s.diag.filter(d => d.etapa === 'status:fluxo') });

  console.log('7) sem o Dynamics: o fluxo ainda serve');
  FX._limpar(); ST._limparCache();
  await chama('POST', { notas: [{ numero: '000021638', status: 'Aprovada', data: '2026-11-17' }] }, CHAVE);
  SERVICO = []; CEN = {};
  const D = require('../api/shared/d365'), tokOrig = D.getToken;
  D.getToken = async () => { throw new Error('token 401: invalid_client'); };
  s = await ST.statusPorNumero(['000021638'], Date.now() + 20000);
  D.getToken = tokOrig;
  t('o token do Dynamics falha e a nota sai pelo fluxo', ST.statusDaNota(s.porNum['21638'], '2026-11-17').status === 'Aprovada' && !s.erro, s);
  t('o erro do Dynamics fica no diagnóstico', s.diag.some(d => d.etapa === 'status:odata' && /token/.test(d.erro)), s.diag);
  FX._limpar(); ST._limparCache();
  s = await ST.statusPorNumero(['000021638'], Date.now() + 20000);
  t('sem nada no fluxo e nada no Dynamics: fontes vazias (o Kanban avisa)', !s.fontes.length && s.fluxo.ligado === true, s);

  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\ntudo ok');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
