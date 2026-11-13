// ================================================================
// api/shared/fatdia-sonda.js — SONDA: qual entidade do D365 traz o TIPO DE
// OPERAÇÃO das notas da MSB de hoje?
//
// Por que existe (09/11/2026): o Faturamento do Dia lê as notas de 2026 do
// diário de faturas (SalesInvoiceHeadersV2), que NÃO tem o tipo de operação;
// a FiscalDocuments, que tem o OperationDescription, parou na MSB em
// 05/12/2023. O dono quer a operação de cada nota, ao vivo. Daqui (o
// ambiente de desenvolvimento) não se alcança o Dynamics — então a sonda
// roda no portal, a pedido do dono, e devolve o que achou para ele mandar.
//
// O que ela faz, em cada entidade candidata (as conhecidas + as que o
// service document publicar com invoice/fiscal/cfop/nfe/operation no nome):
//   1) uma linha de amostra da MSB -> colunas;
//   2) as colunas com cara de OPERAÇÃO (operation, operação, cfop, natureza);
//   3) a linha MAIS RECENTE da MSB pela coluna de data -> diz se a entidade
//      tem nota de 2026 e se a operação vem PREENCHIDA nela.
// "serve" = tem coluna de operação + linha de 2026 com ela preenchida.
//
// SOMENTE LEITURA. Cada ida ao F&O com prazo; o todo cabe no orçamento do SWA.
// ================================================================

const D = require('./d365');

const EMPRESA   = String(process.env.FATDIA_EMPRESA || process.env.ESTOQUE_MSB_EMPRESA || 'msb').trim().toLowerCase();
const ORCAMENTO = 38000;
const PROVA_MS  = 7000;
const PARALELO  = 6;
const MAX_ENT   = 36;

const CONHECIDAS = [
  'SalesInvoiceHeadersV2', 'SalesInvoiceHeaders', 'SalesInvoiceHeaderV4Entity',
  'SalesInvoiceLines', 'SalesInvoiceV2Lines', 'SalesInvoiceLinesV2',
  'BioCustInvoiceTrans', 'BioCustInvoiceJour', 'BioBICustInvoiceJourV1Entity', 'BioBICustInvoiceTransV1Entity',
  'CustInvoiceJourBiEntities', 'CustInvoiceTransBiEntities',
  'FreeTextInvoiceHeaders', 'FreeTextInvoiceLines',
  'FiscalDocuments', 'FiscalDocumentLines', 'FiscalDocumentLinesBR', 'FiscalDocumentHeaders',
  'SalesOrderHeadersV2', 'BIOSalesOrderHeaderV1', 'SalesOrderLines',
  // 13/11/26: a nota de devolução aponta para a ordem de devolução (RMA)
  'ReturnOrderHeaders', 'ReturnOrderLines'
];
const RE_NOME = /invoice|fiscal|cfop|nfe|efdoc|electronic|operationtype|opertype|salespurchoper/i;
// 09/11/26: também o STATUS da nota (aprovado, descartado…) — o filtro "Aprovado"
const RE_ST = /^(?!.*(date|time|reason|motivo|message|mensagem)).*status/i;
const RE_OP   = /operation|opera[cç]|cfop|natur|operType/i;
const RE_NAO  = /operationalsite|operatingunit/i;          // "operation" que não é tipo de operação
const DATAS   = ['InvoiceDate', 'FiscalDocumentDate', 'AccountingDate', 'TransDate', 'DocumentDate', 'CreatedDateTime', 'CREATEDDATETIME', 'OrderCreationDateTime'];
const NUMEROS = ['InvoiceNumber', 'InvoiceId', 'FiscalDocumentNumber', 'SalesOrderNumber', 'SalesId'];

const txt = (v) => String(v == null ? '' : v).trim();
const restante = (ate) => ate - Date.now();
const prazo = (ate, teto) => Math.max(1, Math.min(teto, restante(ate) - 1200));
function colunasDe(row) { return Object.keys(row || {}).filter(k => k.charAt(0) !== '@'); }
function achaCol(cols, nomes) { const b = {}; cols.forEach(c => { b[c.toLowerCase()] = c; }); for (const n of nomes) if (b[n.toLowerCase()]) return b[n.toLowerCase()]; return null; }

async function servico(token, ate) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), prazo(ate, 9000));
    const r = await fetch(D.RESOURCE + '/data', { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return { nomes: [], erro: 'service document ' + r.status };
    const j = JSON.parse(await r.text());
    return { nomes: (Array.isArray(j.value) ? j.value : []).map(e => txt(e && (e.name || e.url))).filter(Boolean), erro: null };
  } catch (e) { return { nomes: [], erro: 'service document: ' + String(e.message || e).slice(0, 120) }; }
}

async function sondarUma(ent, token, ate) {
  const out = { entidade: ent, ok: false, serve: false, serveStatus: false, erro: null, colunas: 0, empresa: false, colunasOperacao: [], colunasStatus: [], dataCol: null, ultimaData: null, maisRecente: null, amostra: null };
  let rows = null, erro = null;
  for (const filtro of ["dataAreaId eq '" + D.odataStr(EMPRESA) + "'", null]) {
    if (restante(ate) < 2500) { erro = 'sem tempo'; break; }
    try {
      rows = await D.odataGetComPrazo(ent, Object.assign({ top: 1, crossCompany: true }, filtro ? { filter: filtro } : {}), token, prazo(ate, PROVA_MS));
      if (rows.length) { out.empresa = !!filtro; break; }
    } catch (e) { erro = String(e.message || e); if (/\b404\b/.test(erro) || e.demorou) break; }
  }
  if (!rows || !rows.length) { out.erro = erro ? erro.slice(0, 200) : 'sem linhas'; return out; }
  out.ok = true;
  const cols = colunasDe(rows[0]);
  out.colunas = cols.length;
  out.nomesColunas = cols.slice().sort((a, b) => a.localeCompare(b));   // 09/11/26: o dono quer ver as colunas
  out.colunasOperacao = cols.filter(c => RE_OP.test(c) && !RE_NAO.test(c));
  out.colunasStatus = cols.filter(c => RE_ST.test(c));
  const num = achaCol(cols, NUMEROS);
  out.amostra = {};
  out.colunasOperacao.concat(out.colunasStatus, num ? [num] : []).forEach(c => { out.amostra[c] = rows[0][c]; });
  // a linha mais recente da MSB: tem nota de 2026? a operação vem preenchida?
  out.dataCol = achaCol(cols, DATAS) || cols.find(c => /date/i.test(c)) || null;
  if (out.dataCol && restante(ate) > 2500) {
    try {
      const sel = [out.dataCol].concat(out.colunasOperacao, out.colunasStatus, num ? [num] : []).filter((v, i, a) => a.indexOf(v) === i).join(',');
      const rec = await D.odataGetComPrazo(ent, Object.assign({ top: 1, crossCompany: true, orderby: out.dataCol + ' desc', select: sel },
        out.empresa ? { filter: "dataAreaId eq '" + D.odataStr(EMPRESA) + "'" } : {}), token, prazo(ate, PROVA_MS));
      if (rec.length) {
        out.ultimaData = txt(rec[0][out.dataCol]).slice(0, 10) || null;
        out.maisRecente = {};
        Object.keys(rec[0]).filter(k => k.charAt(0) !== '@').forEach(k => { out.maisRecente[k] = rec[0][k]; });
      }
    } catch (e) { out.erro = 'ordenar por ' + out.dataCol + ': ' + String(e.message || e).slice(0, 160); }
  }
  const opPreenchida = out.maisRecente && out.colunasOperacao.some(c => txt(out.maisRecente[c]) !== '' && txt(out.maisRecente[c]) !== '0');
  out.serve = !!(out.colunasOperacao.length && out.ultimaData && out.ultimaData >= '2026-01-01' && opPreenchida);
  const stPreenchido = out.maisRecente && out.colunasStatus.some(c => txt(out.maisRecente[c]) !== '');
  out.serveStatus = !!(num && out.colunasStatus.length && out.ultimaData && out.ultimaData >= '2026-01-01' && stPreenchido);
  return out;
}

async function sondar() {
  const ate = Date.now() + ORCAMENTO;
  const token = await D.getToken();
  const sv = await servico(token, ate);
  const existe = {}; sv.nomes.forEach(n => { existe[n.toLowerCase()] = n; });
  let alvos = CONHECIDAS.filter(n => !sv.nomes.length || existe[n.toLowerCase()]).map(n => existe[n.toLowerCase()] || n);
  const doServico = sv.nomes.filter(n => RE_NOME.test(n) && alvos.indexOf(n) < 0);
  alvos = alvos.concat(doServico).slice(0, MAX_ENT);
  const res = [];
  for (let i = 0; i < alvos.length; i += PARALELO) {
    if (restante(ate) < 3000) { alvos.slice(i).forEach(ent => res.push({ entidade: ent, ok: false, serve: false, erro: 'não testada: o tempo da consulta acabou' })); break; }
    const lote = await Promise.all(alvos.slice(i, i + PARALELO).map(ent => sondarUma(ent, token, ate).catch(e => ({ entidade: ent, ok: false, serve: false, erro: String(e.message || e).slice(0, 200) }))));
    lote.forEach(x => res.push(x));
  }
  res.sort((a, b) => (b.serve - a.serve) || ((b.colunasOperacao || []).length ? 1 : 0) - ((a.colunasOperacao || []).length ? 1 : 0) || String(b.ultimaData || '').localeCompare(String(a.ultimaData || '')));
  return {
    ok: true, empresa: EMPRESA, geradoEm: new Date().toISOString(),
    servicoDocumento: sv.erro || ('ok · ' + sv.nomes.length + ' entidades publicadas · ' + doServico.length + ' com invoice/fiscal/cfop/nfe/operation no nome'),
    servem: res.filter(x => x.serve).map(x => x.entidade),
    servemStatus: res.filter(x => x.serveStatus).map(x => x.entidade),
    entidades: res
  };
}

module.exports = { sondar, _interno: { sondarUma, RE_OP, RE_NOME } };
