// ================================================================
// api/shared/fatdia-status.js — STATUS DA NOTA (aprovada, descartada…)
//
// Decisão do dono (09/11/2026): no Faturamento do Dia "o status da nota tem
// que estar Aprovado" — a 000021478 está "Descartado" na tela Nota fiscal do
// D365 e aparecia no portal. O diário de faturas (SalesInvoiceHeadersV2) não
// traz esse status; ele mora no DOCUMENTO FISCAL / NF-e. A FiscalDocuments
// (OData) não devolveu nota da MSB depois de 2023 na leitura por data — por
// isso aqui a busca é PELO NÚMERO, em todas as entidades de documento fiscal /
// NF-e que o D365 publicar (as conhecidas + as do service document com
// efdoc/nfe/electronic/fiscaldocument no nome), cada uma provada pela linha de
// amostra (tem número e status?). Mesma inteligência das Faturas em Aberto.
//
// -> statusPorNumero(numeros, ate) = { porNum: { '21478': [{ status, entidade,
//    coluna }] }, fontes: [...], diag: [...] }
// Envs: FATDIA_ENT_STATUS (entidades), FATDIA_COL_STATUS (colunas de status).
// SOMENTE LEITURA.
// ================================================================

const D = require('./d365');

const EMPRESA = String(process.env.FATDIA_EMPRESA || process.env.ESTOQUE_MSB_EMPRESA || 'msb').trim().toLowerCase();
function envLista(nome, padrao) {
  const v = String(process.env[nome] || '').trim();
  return v ? v.split(',').map(s => s.trim()).filter(Boolean) : padrao;
}
const CANDIDATAS = envLista('FATDIA_ENT_STATUS', ['FiscalDocuments', 'FiscalDocumentHeaders', 'EFDocumentsBR', 'EFDocuments', 'NFeHeadersBR', 'ElectronicFiscalDocuments']);
const RE_ENT  = /efdoc|nfe|electronic|fiscaldocument/i;
const RE_ENT_NAO = /line|linha|tax|imposto|item/i;           // linhas/impostos não têm o status da nota
const NUMS    = ['FiscalDocumentNumber', 'DocumentNumber', 'NFeNumber', 'Number', 'InvoiceNumber', 'InvoiceId'];
const STATUS  = envLista('FATDIA_COL_STATUS', ['Status', 'FiscalDocumentStatus', 'DocumentStatus', 'EFDocStatus', 'NFeStatus', 'ElectronicDocumentStatus']);
const RE_STATUS = /^(?!.*(date|time|reason|motivo|message|mensagem)).*status/i;
const ENT_TTL = 30 * 60000, LOTE = 10, FOLGA = 1500;

const txt = (v) => String(v == null ? '' : v).trim();
const numNorm = (v) => txt(v).replace(/\D/g, '').replace(/^0+(?=.)/, '');
const restante = (ate) => ate - Date.now();
const prazo = (ate, teto) => Math.max(1, Math.min(teto, restante(ate) - FOLGA));
function colunasDe(row) { return Object.keys(row || {}).filter(k => k.charAt(0) !== '@'); }
function achaCol(cols, nomes) { const b = {}; cols.forEach(c => { b[c.toLowerCase()] = c; }); for (const n of nomes) if (b[n.toLowerCase()]) return b[n.toLowerCase()]; return null; }

// "aprovado" em qualquer grafia do D365 (enum do OData ou rótulo pt-BR)
function aprovado(v) {
  const n = txt(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return /^(approved|aprovad[oa]|authorized|autorizad[oa]|autorizado o uso.*|uso autorizado.*)$/.test(n);
}

let _fontes = null, _fontesTs = 0;
async function descobrir(token, ate, diag) {
  if (_fontes && Date.now() - _fontesTs < ENT_TTL) { diag.push({ etapa: 'status:fontes', cache: true, fontes: _fontes.map(f => f.entidade) }); return _fontes; }
  let nomes = [];
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), prazo(ate, 8000));
    const r = await fetch(D.RESOURCE + '/data', { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: ctl.signal });
    clearTimeout(t);
    if (r.ok) { const j = JSON.parse(await r.text()); nomes = (Array.isArray(j.value) ? j.value : []).map(e => txt(e && (e.name || e.url))).filter(Boolean); }
  } catch (e) { /* sem service document: só as candidatas */ }
  const existe = {}; nomes.forEach(n => { existe[n.toLowerCase()] = n; });
  let alvos = CANDIDATAS.filter(n => !nomes.length || existe[n.toLowerCase()]).map(n => existe[n.toLowerCase()] || n);
  nomes.filter(n => RE_ENT.test(n) && !RE_ENT_NAO.test(n) && alvos.indexOf(n) < 0).slice(0, 8).forEach(n => alvos.push(n));
  const provas = await Promise.all(alvos.map(async ent => {
    for (const filtro of ["dataAreaId eq '" + D.odataStr(EMPRESA) + "'", null]) {
      try {
        const rows = await D.odataGetComPrazo(ent, Object.assign({ top: 1, crossCompany: true }, filtro ? { filter: filtro } : {}), token, prazo(ate, 7000));
        if (!rows.length) continue;
        const cols = colunasDe(rows[0]);
        const num = achaCol(cols, NUMS);
        const st = achaCol(cols, STATUS) || cols.find(c => RE_STATUS.test(c)) || null;
        return { entidade: ent, num, status: st, temEmpresa: !!filtro && cols.some(c => c.toLowerCase() === 'dataareaid'), serve: !!(num && st) };
      } catch (e) { if (/\b404\b/.test(String(e.message)) || e.demorou) break; }
    }
    return { entidade: ent, serve: false };
  }));
  provas.forEach(p => diag.push({ etapa: 'status:entidade', entidade: p.entidade, serve: p.serve, numero: p.num || null, status: p.status || null }));
  const servem = provas.filter(p => p.serve);
  if (servem.length) { _fontes = servem; _fontesTs = Date.now(); }
  return servem;
}

async function statusPorNumero(numeros, ate) {
  const diag = [], porNum = {};
  const lista = Array.from(new Set((numeros || []).map(txt).filter(Boolean)));
  if (!lista.length) return { porNum, fontes: [], diag };
  const token = await D.getToken();
  const fontes = await descobrir(token, ate, diag);
  await Promise.all(fontes.map(async F => {
    for (let i = 0; i < lista.length; i += LOTE) {
      if (restante(ate) < FOLGA + 1000) { diag.push({ etapa: 'status:leitura', entidade: F.entidade, erro: 'sem tempo: ' + (lista.length - i) + ' nota(s)' }); break; }
      const formas = [];
      lista.slice(i, i + LOTE).forEach(n => { const d = numNorm(n); [n, d, ('000000000' + d).slice(-9)].forEach(f => { if (f && formas.indexOf(f) < 0) formas.push(f); }); });
      const filtro = (F.temEmpresa ? "dataAreaId eq '" + D.odataStr(EMPRESA) + "' and " : '') + '(' + formas.map(f => F.num + " eq '" + D.odataStr(f) + "'").join(' or ') + ')';
      try {
        const rows = await D.odataGetComPrazo(F.entidade, { crossCompany: true, filter: filtro, select: [F.num, F.status].join(',') }, token, prazo(ate, 10000));
        rows.forEach(r => {
          const k = numNorm(r[F.num]); const s = txt(r[F.status]);
          if (k && s) (porNum[k] = porNum[k] || []).push({ status: s, entidade: F.entidade, coluna: F.status });
        });
        diag.push({ etapa: 'status:leitura', entidade: F.entidade, numeros: lista.slice(i, i + LOTE).length, linhas: rows.length });
      } catch (e) {
        diag.push({ etapa: 'status:leitura', entidade: F.entidade, erro: String(e.message || e).slice(0, 200) });
        break;
      }
    }
  }));
  return { porNum, fontes: fontes.map(f => f.entidade + '.' + f.status), diag };
}

// o status que vale para a nota: o aprovado, se algum documento com o número
// estiver aprovado; senão o 1º encontrado
function statusDaNota(lista) {
  if (!lista || !lista.length) return null;
  return lista.find(x => aprovado(x.status)) || lista[0];
}

function _limparCache() { _fontes = null; _fontesTs = 0; }

module.exports = { statusPorNumero, statusDaNota, aprovado, numNorm, _limparCache };
