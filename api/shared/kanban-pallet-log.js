// ================================================================
// api/shared/kanban-pallet-log.js — QUANDO cada carga foi para o PALLET
//
// Pedido do dono (11/11/2026): "a mudança para o Pallet é mostrar somente as
// que mudaram no DIA para o PALLET, não importando a data da OV". O D365 grava
// só ENVIARPALLET_CUSTOM = Sim na carga — sem a data. O botão "Enviar para o
// Pallet" do Kanban é a única escrita do portal no Dynamics, então ELE anota a
// data: cada envio vira UMA linha JSON num APPEND BLOB mensal
// ("kanban-pallet-AAAA-MM.jsonl"), como o log de acessos (acesso-log.js):
//
//   { ts: "2026-11-11T14:03:00.000Z", carga: "LD-…", ov: "OV…", por: "…", entidade }
//
// Container: KANBAN_BLOB_URL (SAS de CONTAINER, sr=c, Read + Create + Write);
// sem ela, o mesmo container do log de acessos (LOG_PORTAL_BLOB_URL). Sem as
// duas: configured() = false, registrar() não faz nada e lerPeriodo() devolve
// null (o quadro avisa). Tudo best-effort, com timeout curto: o registro NUNCA
// derruba o envio ao Pallet nem a leitura do quadro.
// ================================================================

const BASE = () => String(process.env.KANBAN_BLOB_URL || process.env.LOG_PORTAL_BLOB_URL || '').trim();
const TIMEOUT_MS = 4000;
const PREFIXO = 'kanban-pallet-';

function configured() { return !!BASE(); }
function arquivoDoMes(iso) { return PREFIXO + String(iso).slice(0, 7) + '.jsonl'; }
function blobUrl(arquivo) {
  const url = BASE(), q = url.indexOf('?');
  const base = q < 0 ? url : url.slice(0, q), sas = q < 0 ? '' : url.slice(q);
  return base.replace(/\/+$/, '') + '/' + arquivo + sas;
}
const comAppend = (url) => url + (url.indexOf('?') >= 0 ? '&' : '?') + 'comp=appendblock';
function fetchT(url, opts, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms || TIMEOUT_MS);
  return fetch(url, Object.assign({ signal: ac.signal }, opts || {})).finally(() => clearTimeout(t));
}

// registrar({ carga, ov, por, entidade }): anota o envio AGORA. Nunca lança.
async function registrar(evt) {
  try {
    if (!configured()) return false;
    const ts = new Date().toISOString();
    const linha = JSON.stringify({ ts, carga: String(evt.carga || ''), ov: String(evt.ov || '').slice(0, 40), por: String(evt.por || ''), entidade: evt.entidade || '' }) + '\n';
    const url = blobUrl(arquivoDoMes(ts));
    let r = await fetchT(comAppend(url), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: linha });
    if (r.status === 404) {
      // 1ª vez no mês: cria o append blob (409/412 = outro criou antes) e reenvia
      const c = await fetchT(url, { method: 'PUT', headers: { 'x-ms-blob-type': 'AppendBlob', 'If-None-Match': '*' }, body: '' });
      if (!c.ok && c.status !== 409 && c.status !== 412) return false;
      r = await fetchT(comAppend(url), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: linha });
    }
    return r.ok;
  } catch (e) { return false; }
}

// os meses ("AAAA-MM") de [de, ate]
function meses(de, ate) {
  const out = []; let [a, m] = String(de).slice(0, 7).split('-').map(Number);
  const [a2, m2] = String(ate).slice(0, 7).split('-').map(Number);
  while ((a < a2 || (a === a2 && m <= m2)) && out.length < 14) {
    out.push(a + '-' + String(m).padStart(2, '0'));
    if (++m > 12) { m = 1; a++; }
  }
  return out;
}

// lerPeriodo(de, ate) -> { por: { LOADID: ts do envio mais RECENTE }, erro }
// Lê os arquivos dos meses do período (e o do mês anterior ao início: o dia em
// Brasília começa às 03:00 UTC). null = não configurado.
async function lerPeriodo(de, ate) {
  if (!configured()) return null;
  const ini = new Date(String(de).slice(0, 10) + 'T00:00:00Z'); ini.setUTCDate(ini.getUTCDate() - 1);
  const por = {}; let erro = null;
  await Promise.all(meses(ini.toISOString(), ate).map(async (mes) => {
    try {
      const r = await fetchT(blobUrl(PREFIXO + mes + '.jsonl'), { method: 'GET' }, 8000);
      if (r.status === 404) return;
      if (!r.ok) { erro = 'leitura ' + r.status; return; }
      (await r.text()).split('\n').forEach(l => {
        const s = l.trim(); if (!s) return;
        try {
          const j = JSON.parse(s), k = String(j.carga || '').toUpperCase();
          if (k && j.ts && (!por[k] || j.ts > por[k])) por[k] = j.ts;
        } catch (e) { /* linha corrompida: ignora */ }
      });
    } catch (e) { erro = String(e.message || e).slice(0, 120); }
  }));
  return { por, erro };
}

module.exports = { configured, registrar, lerPeriodo, arquivoDoMes, _meses: meses };
