// ================================================================
// api/shared/avisos-store.js — persistência dos Avisos em Azure Blob
//
// Um ÚNICO blob JSON com { atualizadoEm, seeded, purge, itens:[...] }, num
// container/blob DEDICADO — separado do Radar (sem mistura). Acesso por
// SAS URL (sem SDK, sem dependência npm).
//
//   AVISOS_BLOB_URL = SAS do container "avisos" OU do blob "avisos.json".
//     • container:  https://<conta>.blob.core.windows.net/avisos?<SAS>
//     • blob:       https://<conta>.blob.core.windows.net/avisos/avisos.json?<SAS>
//   A SAS precisa de permissões Read + Create + Write.
//   Se a URL apontar p/ o container (último segmento sem "."), o código
//   anexa "/avisos.json" automaticamente. O arquivo gravado é avisos.json.
//
// Sem a env → configured() = false: o /api/avisos responde configured:false
// no GET e o front cai no cache localStorage. NUNCA usa outro container.
// ================================================================

const AVISOS_URL = process.env.AVISOS_BLOB_URL || '';
const FILE = 'avisos.json';
const VAZIO = { atualizadoEm: null, seeded: false, purge: null, itens: [] };

function configured() { return !!AVISOS_URL; }

// Normaliza a SAS URL para apontar SEMPRE no blob avisos.json:
//  - se já termina num arquivo (último segmento do path tem "."), usa como está;
//  - se aponta p/ o container (sem arquivo — nomes de container não têm ponto),
//    insere "/avisos.json" antes da query string do SAS.
function blobUrl() {
  const u = AVISOS_URL;
  const q = u.indexOf('?');
  const base = q < 0 ? u : u.slice(0, q);
  const sas = q < 0 ? '' : u.slice(q);
  const last = (base.split('/').pop() || '');
  if (last.indexOf('.') >= 0) return u;                    // já é um blob (ex.: .../avisos.json?sas)
  return base.replace(/\/+$/, '') + '/' + FILE + sas;      // container → .../avisos/avisos.json?sas
}

// `purge` = marca da limpeza do mural (ver /api/avisos). Tem de sobreviver ao
// normaliza: sem ela o backend acharia que nunca limpou e zeraria de novo.
function normaliza(j) {
  if (!j || typeof j !== 'object' || !Array.isArray(j.itens)) return { atualizadoEm: null, seeded: false, purge: null, itens: [] };
  return { atualizadoEm: j.atualizadoEm || null, seeded: !!j.seeded, purge: j.purge || null, itens: j.itens };
}

async function read() {
  if (!AVISOS_URL) return Object.assign({}, VAZIO);
  const r = await fetch(blobUrl());
  if (r.status === 404) return Object.assign({}, VAZIO);   // primeiro uso: blob ainda não existe
  if (!r.ok) throw new Error('avisos blob GET ' + r.status + ': ' + (await r.text().catch(() => '')).slice(0, 200));
  const j = await r.json().catch(() => null);
  return normaliza(j);
}

async function write(obj) {
  if (!AVISOS_URL) return false;
  const r = await fetch(blobUrl(), {
    method: 'PUT',
    headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  });
  if (!r.ok) throw new Error('avisos blob PUT ' + r.status + ': ' + (await r.text().catch(() => '')).slice(0, 200));
  return true;
}

module.exports = { configured, read, write };
