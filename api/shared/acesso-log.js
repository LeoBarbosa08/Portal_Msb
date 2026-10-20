// ================================================================
// api/shared/acesso-log.js — Log de ENTRADAS do portal em Azure Blob
//
// Cada acesso ao portal vira UMA linha JSON (JSONL) num APPEND BLOB
// mensal, num container DEDICADO só de logs — separado de Avisos/Radar:
//
//   LOG_PORTAL_BLOB_URL = SAS de CONTAINER (sr=c) do container "log-portal":
//     https://<conta>.blob.core.windows.net/log-portal?<SAS>
//   A SAS precisa de Read + Create + Write (sp=rcw). NÃO precisa de "Add":
//   o "Append Block" é autorizado pela permissão Write (testado ao vivo).
//
// Por que APPEND BLOB (e não um JSON regravado como Avisos/Radar): o log
// só cresce e é escrito de forma CONCORRENTE (vários usuários entrando ao
// mesmo tempo). O append é atômico no lado do Azure — nunca perde linha e
// não precisa ler-modificar-regravar o arquivo inteiro. Um arquivo por mês
// ("entradas-AAAA-MM.jsonl"), lido por NOME (a SAS não tem List, e não
// precisa: o nome é determinístico).
//
// Sem a env → configured() = false e registrar() é no-op silencioso (o
// portal segue funcionando; simplesmente não há log).
//
// registrar() é BEST-EFFORT e defensivo: tudo em try/catch com timeout
// curto (AbortController) — uma falha/lentidão do blob NUNCA pode derrubar
// nem travar o /api/my-areas (que roda no carregamento das páginas).
// ================================================================

const LOG_URL         = process.env.LOG_PORTAL_BLOB_URL || '';
const TIMEOUT_MS      = 2500;    // escrita (hot path do my-areas)
const READ_TIMEOUT_MS = 15000;   // leitura (ação de admin, arquivo pode ser grande)
const MES_RE          = /^\d{4}-\d{2}$/;

function configured() { return !!LOG_URL; }

// "entradas-AAAA-MM.jsonl" a partir de um ISO (UTC) — YYYY-MM = slice(0,7)
function arquivoDoMes(iso) {
  return 'entradas-' + String(iso).slice(0, 7) + '.jsonl';
}

// Insere "/<arquivo>" antes da query do SAS de container.
//   .../log-portal?<sas>  ->  .../log-portal/entradas-2026-07.jsonl?<sas>
function blobUrl(arquivo) {
  const q = LOG_URL.indexOf('?');
  const base = q < 0 ? LOG_URL : LOG_URL.slice(0, q);
  const sas  = q < 0 ? '' : LOG_URL.slice(q);
  return base.replace(/\/+$/, '') + '/' + arquivo + sas;
}
function comAppend(url) {
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'comp=appendblock';
}

// fetch com timeout (nunca deixa o log travar a request principal)
function fetchT(url, opts, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs || TIMEOUT_MS);
  return fetch(url, Object.assign({ signal: ac.signal }, opts || {})).finally(() => clearTimeout(t));
}

// cria o append blob do mês só se não existir (If-None-Match:*).
// 409/412 = já existe (corrida entre dois primeiros acessos) → ok.
async function criaAppendBlob(url) {
  const r = await fetchT(url, {
    method: 'PUT',
    headers: { 'x-ms-blob-type': 'AppendBlob', 'If-None-Match': '*' },
    body: ''
  });
  if (r.ok || r.status === 409 || r.status === 412) return true;
  throw new Error('append blob create ' + r.status);
}

// regime normal: 1 request (append). Na 1ª vez do mês o append dá 404
// (blob ainda não existe) → cria e reenvia uma vez.
async function appendLinha(arquivo, linha) {
  const url  = blobUrl(arquivo);
  const body = linha.endsWith('\n') ? linha : linha + '\n';
  let r = await fetchT(comAppend(url), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
  if (r.status === 404) {
    await criaAppendBlob(url);
    r = await fetchT(comAppend(url), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
  }
  if (!r.ok) throw new Error('append block ' + r.status);
  return true;
}

// primeiro IP da cadeia x-forwarded-for (sem porta p/ IPv4)
function clientIp(req) {
  const h = (req && req.headers) || {};
  const xff = String(h['x-forwarded-for'] || h['x-azure-clientip'] || h['x-azure-socketip'] || '');
  const first = xff.split(',')[0].trim();
  return first.replace(/:\d+$/, '');
}

// registrar(req, evt): grava UMA entrada de acesso. Best-effort — nunca lança.
//   evt = { email, name, oid, validated, restricted, reason, areas }
async function registrar(req, evt) {
  try {
    if (!LOG_URL) return false;
    const e = evt || {};
    // sem identidade nenhuma (chamador anônimo/máquina) → não registra ruído
    if (!e.email && !e.oid) return false;
    const ts = new Date().toISOString();     // UTC
    const h  = (req && req.headers) || {};
    const linha = JSON.stringify({
      ts: ts,
      email: e.email || '',
      name: e.name || '',
      oid: e.oid || '',
      validated: !!e.validated,              // token verificado (true) vs. header legado (false)
      restricted: !!e.restricted,
      reason: e.reason || '',
      areas: Array.isArray(e.areas) ? e.areas : undefined,
      modulos: (Array.isArray(e.modulos) && e.modulos.length) ? e.modulos : undefined,
      ip: clientIp(req),
      ua: String(h['user-agent'] || '').slice(0, 300),
      ref: String(h['referer'] || h['referrer'] || '').slice(0, 300)
    });
    await appendLinha(arquivoDoMes(ts), linha);
    return true;
  } catch (e) {
    return false;   // o log NUNCA quebra o fluxo do portal
  }
}

// lerMes("AAAA-MM") → array de entradas do mês (ordem de gravação, mais
// antigo primeiro). [] se o mês ainda não tem arquivo (404). null se não
// configurado. Linhas corrompidas são ignoradas (log é append best-effort).
async function lerMes(mes) {
  if (!LOG_URL) return null;
  if (!MES_RE.test(String(mes || ''))) throw new Error('mes inválido');
  const url = blobUrl('entradas-' + mes + '.jsonl');
  const r = await fetchT(url, { method: 'GET' }, READ_TIMEOUT_MS);
  if (r.status === 404) return [];
  if (!r.ok) throw new Error('log GET ' + r.status);
  const txt = await r.text();
  const out = [];
  for (const linha of txt.split('\n')) {
    const s = linha.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch (e) { /* linha corrompida → ignora */ }
  }
  return out;
}

module.exports = { configured, registrar, lerMes, arquivoDoMes, clientIp };
