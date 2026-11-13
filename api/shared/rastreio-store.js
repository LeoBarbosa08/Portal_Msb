// ================================================================
// api/shared/rastreio-store.js — as fases do RASTREIO DE ENTREGA (13/11/2026)
//
// O Kanban só LÊ o Dynamics; o que o rastreio decide (Aguardando Revisão,
// Entregue, quem concluiu) mora num JSON só no container de blob do Kanban:
//
//   kanban-rastreio/estado.json = { versao, atualizadoEm,
//     rodada: { em, por, nfs, achadas, novasRevisao, erros:[…], ms },
//     ovs: { 'OV017550': { fase: 'expedicao'|'revisao'|'entregue',
//              dados: { cliente, conta, cidade, uf, expedidaEm, cargas, notas },
//              rastreio: { transportadora, nf, situacao, status, previsao,
//                          entregueEm, recebedor, ultimo, comprovantes, eventos },
//              consultadoEm, revisaoEm, concluidoEm, concluidoPor, hist:[…] } } }
//
// Só entra a OV que a transportadora achou (a de outra transportadora não tem o
// que guardar). Gravação com ETag (If-Match): o robô e o operador podem gravar ao
// mesmo tempo — quem perde relê e refaz a mudança (atualizar(fn), até 4 vezes).
//
// Container: KANBAN_BLOB_URL (SAS de CONTAINER, sr=c, Read + Create + Write);
// sem ela, o do log de acessos (LOG_PORTAL_BLOB_URL) — a mesma regra do e-mail
// da Cotação (kanban-email.js). SEM nenhum dos dois: só na MEMÓRIA do servidor
// (serve para teste; um reinício apaga as fases — a tela avisa).
// ================================================================

const txt = (v) => String(v == null ? '' : v).trim();
const BLOB = () => txt(process.env.KANBAN_BLOB_URL || process.env.LOG_PORTAL_BLOB_URL);
const NOME = 'kanban-rastreio/estado.json';
const TENTATIVAS = 4;

function comRegistro() { return !!BLOB(); }
function vazio() { return { versao: 1, atualizadoEm: null, rodada: null, ovs: {} }; }

function url() {
  const u = BLOB(), q = u.indexOf('?');
  const base = q < 0 ? u : u.slice(0, q), sas = q < 0 ? '' : u.slice(q);
  return base.replace(/\/+$/, '') + '/' + NOME + sas;
}
function fetchT(u, opts, ms) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms || 8000);
  return fetch(u, Object.assign({ signal: ac.signal }, opts || {})).finally(() => clearTimeout(t));
}
// o erro sem a assinatura da SAS
function erro(msg, st) { const e = new Error('registro do rastreio: ' + msg); e.status = st || 502; e.publicMessage = 'Não foi possível ler ou gravar as fases do rastreio agora.'; return e; }

// ── na memória (sem blob) ──
let _mem = null;

// -> { dados, etag } (etag null = o arquivo ainda não existe)
async function ler() {
  if (!comRegistro()) return { dados: _mem ? JSON.parse(JSON.stringify(_mem)) : vazio(), etag: null, memoria: true };
  let r;
  try { r = await fetchT(url(), { method: 'GET' }); } catch (e) { throw erro(e && e.name === 'AbortError' ? 'o blob não respondeu' : 'falha de rede'); }
  if (r.status === 404) return { dados: vazio(), etag: null };
  if (!r.ok) throw erro('leitura ' + r.status);
  let dados;
  try { dados = JSON.parse(await r.text()); } catch (e) { throw erro('o arquivo não é JSON'); }
  if (!dados || typeof dados !== 'object' || !dados.ovs) dados = Object.assign(vazio(), dados || {}, { ovs: (dados && dados.ovs) || {} });
  return { dados, etag: r.headers && r.headers.get ? r.headers.get('etag') : null };
}

// grava se ninguém gravou depois da leitura: true = gravou, false = conflito
async function gravar(dados, etag) {
  dados.atualizadoEm = new Date().toISOString();
  if (!comRegistro()) { _mem = JSON.parse(JSON.stringify(dados)); return true; }
  const h = { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/json' };
  if (etag) h['If-Match'] = etag; else h['If-None-Match'] = '*';
  let r;
  try { r = await fetchT(url(), { method: 'PUT', headers: h, body: JSON.stringify(dados) }); } catch (e) { throw erro('falha de rede ao gravar'); }
  if (r.status === 409 || r.status === 412) return false;
  if (!r.ok) throw erro('gravação ' + r.status);
  return true;
}

// lê, aplica fn(dados) e grava; se outro gravou no meio, relê e refaz.
// fn devolve o que atualizar() deve devolver (e pode lançar erro para desistir).
async function atualizar(fn) {
  for (let i = 0; i < TENTATIVAS; i++) {
    const { dados, etag } = await ler();
    const ret = await fn(dados);
    if (await gravar(dados, etag)) return { dados, ret };
  }
  throw erro('muita gente gravando ao mesmo tempo; tente de novo');
}

function _limpar() { _mem = null; }

module.exports = { comRegistro, ler, atualizar, _limpar, NOME };
