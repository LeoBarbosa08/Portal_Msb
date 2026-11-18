// ================================================================
// api/shared/nf-status-fluxo.js — o STATUS DA NOTA que o POWER AUTOMATE manda
// (18/11/2026)
//
// O dono: a 000021638 aparece "Sem status" no Kanban; o status está no BANCO
// (o que alimenta o BI), não no OData do Dynamics. Ninguém pode precisar de
// licença do Power BI para ver. Então um fluxo do Power Automate lê o status
// no banco (conector SQL, pelo gateway se o banco for da empresa) e MANDA
// para o portal (/api/nf-status, com a chave KANBAN_NF_CHAVE). O portal
// guarda e usa como RESERVA: o status do Dynamics (OData) vale primeiro; o do
// fluxo entra só quando o Dynamics não trouxer status para a nota (ver
// statusDaNota em fatdia-status.js). Serve o Kanban e o Faturamento do Dia.
//
//   receber(corpo)            -> grava/atualiza as notas; { recebidas, gravadas,
//                                novas, alteradas, ignoradas, motivos, total }
//   consultar(numeros, ate)   -> { porNum: { '21638': [{ status, data,
//                                entidade, coluna, reserva:true }] }, total,
//                                atualizadoEm, ligado }
//   exigirChave(req)          -> lança 503 (sem chave) / 401 (chave errada)
//
// O corpo aceita: { notas: [...] }, [...], { value: [...] } ou o resultado
// do "Executar uma consulta SQL (V2)" ({ ResultSets: { Table1: [...] } }).
// Cada linha: número, status (em TEXTO: Aprovada, Cancelada…), data de
// emissão e, se tiver, a empresa — cada um por vários nomes de coluna.
//
// Onde mora: <container>/kanban-nf-status/<empresa>.json, no container do
// Kanban (KANBAN_BLOB_URL; sem ela, LOG_PORTAL_BLOB_URL — a regra do
// rastreio). Sem nenhum dos dois: só na MEMÓRIA do servidor (teste).
// Gravação com ETag: duas chamadas ao mesmo tempo não se apagam.
// ================================================================

const crypto = require('crypto');

const txt = (v) => String(v == null ? '' : v).trim();
const EMPRESA = () => txt(process.env.FATDIA_EMPRESA || process.env.ESTOQUE_MSB_EMPRESA || 'msb').toLowerCase();
const BLOB = () => txt(process.env.KANBAN_BLOB_URL || process.env.LOG_PORTAL_BLOB_URL);
const CHAVE = () => String(process.env.KANBAN_NF_CHAVE || '');
const CHAVE_MIN = 24;
const RETEM_DIAS = () => Number(process.env.KANBAN_NF_RETEM_DIAS || 400);
const CACHE_MS = () => Number(process.env.KANBAN_NF_CACHE_MS || 60000);
const MAX_LINHAS = 20000;     // por chamada
const MAX_NOTAS = 30000;      // no arquivo (as mais antigas saem antes)
const POR_NUMERO = 3;         // o mesmo número em datas diferentes (anos atrás)
const TENTATIVAS = 4;

const ENTIDADE = 'Power Automate (banco)', COLUNA = 'status';

// os nomes aceitos de cada campo (sem diferenciar maiúscula)
const CAMPOS = {
  numero:  ['numero', 'numeronf', 'numero_nf', 'nf', 'nota', 'numeronota', 'numero_nota', 'notafiscal', 'nota_fiscal',
            'fiscaldocumentnumber', 'documentnumber', 'invoicenumber', 'invoiceid', 'nfenumber'],
  status:  ['status', 'statusnf', 'status_nf', 'statusnota', 'status_nota', 'situacao', 'fiscaldocumentstatus',
            'documentstatus', 'efdocstatus', 'nfestatus'],
  data:    ['data', 'dataemissao', 'data_emissao', 'emissao', 'datanota', 'data_nota', 'fiscaldocumentdate',
            'invoicedate', 'documentdate', 'issuedate', 'accountingdate'],
  empresa: ['empresa', 'dataareaid', 'company', 'companyid']
};

function numNorm(v) { return txt(v).replace(/\D/g, '').replace(/^0+(?=.)/, ''); }
function isoD(v) {
  if (v == null || v === '') return null;
  const s = txt(v);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);                    // dd/mm/aaaa
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  return undefined;                                           // veio, mas não é data
}
function campo(linha, nomes) {
  const ks = Object.keys(linha || {});
  for (const n of nomes) {
    const k = ks.find(x => x.toLowerCase() === n);
    if (k != null && linha[k] != null && txt(linha[k]) !== '') return linha[k];
  }
  return null;
}

// ── a chave do fluxo (fail-closed, como o /api/cot-ov-retorno) ──
function erro(st, msg) { const e = new Error(msg); e.status = st; e.publicMessage = msg; return e; }
function ligado() { return CHAVE().length >= CHAVE_MIN; }
function exigirChave(req) {
  const certa = CHAVE();
  if (certa.length < CHAVE_MIN) throw erro(503, 'Recebimento do status das notas desligado (KANBAN_NF_CHAVE não configurada).');
  const h = (req && req.headers) || {};
  const veio = String(h['x-portal-chave'] || h['X-Portal-Chave'] || '');
  const hash = (v) => crypto.createHash('sha256').update(v).digest();
  if (!veio || !crypto.timingSafeEqual(hash(veio), hash(certa))) throw erro(401, 'Chave do fluxo ausente ou errada.');
}

// ── as linhas do corpo, nos formatos que o Power Automate costuma mandar ──
function linhasDo(corpo) {
  let b = corpo;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { throw erro(400, 'O corpo não é JSON.'); } }
  if (Array.isArray(b)) return b;
  if (!b || typeof b !== 'object') return null;
  if (b.body && typeof b.body === 'object' && !Array.isArray(b.notas)) b = b.body;
  for (const k of ['notas', 'value', 'Table1', 'rows', 'linhas']) if (Array.isArray(b[k])) return b[k];
  const rs = b.ResultSets || b.resultSets || b.resultsets;
  if (rs && typeof rs === 'object') {
    const arr = Object.keys(rs).map(k => rs[k]).find(Array.isArray);
    if (arr) return arr;
  }
  return null;
}

// -> { validas: [{ k, numero, status, data }], ignoradas: [{ numero, motivo }] }
function normalizar(corpo) {
  const linhas = linhasDo(corpo);
  if (!linhas) throw erro(400, 'Não achei a lista de notas no corpo: mande { "notas": [ { "numero", "status", "data" } ] } ou o resultado da consulta SQL.');
  if (linhas.length > MAX_LINHAS) throw erro(413, 'Notas demais numa chamada (' + linhas.length + '; o máximo é ' + MAX_LINHAS + '). Mande só as dos últimos dias.');
  const emp = EMPRESA(), validas = [], ignoradas = [];
  linhas.forEach(l => {
    if (!l || typeof l !== 'object') { ignoradas.push({ numero: '', motivo: 'linha vazia' }); return; }
    const numero = txt(campo(l, CAMPOS.numero)), status = txt(campo(l, CAMPOS.status));
    const dataV = campo(l, CAMPOS.data), empresa = txt(campo(l, CAMPOS.empresa)).toLowerCase();
    const k = numNorm(numero);
    if (!k || /^0+$/.test(k)) { ignoradas.push({ numero, motivo: 'sem o número da nota' }); return; }
    if (empresa && empresa !== emp) { ignoradas.push({ numero, motivo: 'de outra empresa', valor: empresa }); return; }
    if (!status) { ignoradas.push({ numero, motivo: 'sem status' }); return; }
    if (/^-?\d+$/.test(status)) { ignoradas.push({ numero, motivo: 'status em número: converta para o texto (Aprovada, Cancelada…) na consulta', valor: status }); return; }
    const data = isoD(dataV);
    if (data === undefined) { ignoradas.push({ numero, motivo: 'data inválida', valor: txt(dataV).slice(0, 30) }); return; }
    validas.push({ k, numero: numero.slice(0, 30), status: status.slice(0, 60), data });
  });
  return { recebidas: linhas.length, validas, ignoradas };
}

// ── o arquivo no blob (ou na memória) ──
function vazio() { return { versao: 1, empresa: EMPRESA(), atualizadoEm: null, rodada: null, notas: {} }; }
function url() {
  const u = BLOB(), q = u.indexOf('?');
  const base = q < 0 ? u : u.slice(0, q), sas = q < 0 ? '' : u.slice(q);
  return base.replace(/\/+$/, '') + '/kanban-nf-status/' + encodeURIComponent(EMPRESA()) + '.json' + sas;
}
function fetchT(u, opts, ms) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), Math.max(1, ms || 8000));
  return fetch(u, Object.assign({ signal: ac.signal }, opts || {})).finally(() => clearTimeout(t));
}
// o erro sem a assinatura da SAS
function erroBlob(msg) { return erro(502, 'Não foi possível ler ou gravar o status das notas agora (' + msg + ').'); }

let _mem = null;
let _cache = null, _cacheTs = 0;

async function ler(ms) {
  if (!BLOB()) return { dados: _mem ? JSON.parse(JSON.stringify(_mem)) : vazio(), etag: null, memoria: true };
  let r;
  try { r = await fetchT(url(), { method: 'GET' }, ms); } catch (e) { throw erroBlob(e && e.name === 'AbortError' ? 'o blob não respondeu' : 'falha de rede'); }
  if (r.status === 404) return { dados: vazio(), etag: null };
  if (!r.ok) throw erroBlob('leitura ' + r.status);
  let dados;
  try { dados = JSON.parse(await r.text()); } catch (e) { throw erroBlob('o arquivo não é JSON'); }
  if (!dados || typeof dados !== 'object' || !dados.notas || typeof dados.notas !== 'object') dados = Object.assign(vazio(), dados || {}, { notas: {} });
  return { dados, etag: r.headers && r.headers.get ? r.headers.get('etag') : null };
}
async function gravar(dados, etag) {
  if (!BLOB()) { _mem = JSON.parse(JSON.stringify(dados)); return true; }
  const h = { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/json' };
  if (etag) h['If-Match'] = etag; else h['If-None-Match'] = '*';
  let r;
  try { r = await fetchT(url(), { method: 'PUT', headers: h, body: JSON.stringify(dados) }); } catch (e) { throw erroBlob('falha de rede ao gravar'); }
  if (r.status === 409 || r.status === 412) return false;
  if (!r.ok) throw erroBlob('gravação ' + r.status);
  return true;
}

// tira as notas mais antigas que RETEM_DIAS e, passado o teto, as mais antigas
function podar(notas, hojeMs) {
  const corte = new Date(hojeMs - RETEM_DIAS() * 86400000).toISOString().slice(0, 10);
  let todas = [];
  Object.keys(notas).forEach(k => {
    notas[k] = (notas[k] || []).filter(x => !x.data || x.data >= corte);
    if (!notas[k].length) delete notas[k];
    else notas[k].forEach(x => todas.push({ k, x }));
  });
  if (todas.length > MAX_NOTAS) {
    todas.sort((a, b) => String(a.x.data || a.x.recebidoEm || '').localeCompare(String(b.x.data || b.x.recebidoEm || '')));
    todas.slice(0, todas.length - MAX_NOTAS).forEach(({ k, x }) => {
      notas[k] = notas[k].filter(y => y !== x);
      if (!notas[k].length) delete notas[k];
    });
  }
}

async function receber(corpo) {
  const N = normalizar(corpo);
  const agora = new Date().toISOString();
  let res = null;
  for (let i = 0; i < TENTATIVAS && !res; i++) {
    const { dados, etag } = await ler();
    let novas = 0, alteradas = 0;
    N.validas.forEach(v => {
      const lista = dados.notas[v.k] = dados.notas[v.k] || [];
      const igual = lista.find(x => (x.data || null) === (v.data || null));
      if (igual) {
        if (igual.status !== v.status) { alteradas++; igual.antes = igual.status; igual.status = v.status; igual.mudouEm = agora; }
        igual.numero = v.numero; igual.recebidoEm = agora;
      } else {
        novas++;
        lista.push({ numero: v.numero, status: v.status, data: v.data, recebidoEm: agora });
      }
      lista.sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
      if (lista.length > POR_NUMERO) lista.length = POR_NUMERO;
    });
    podar(dados.notas, Date.now());
    dados.atualizadoEm = agora;
    dados.rodada = { em: agora, recebidas: N.recebidas, gravadas: N.validas.length, novas, alteradas, ignoradas: N.ignoradas.length };
    if (await gravar(dados, etag)) res = { dados, novas, alteradas };
  }
  if (!res) throw erroBlob('outra gravação ao mesmo tempo; tente de novo');
  _cache = res.dados; _cacheTs = Date.now();
  // os motivos agrupados (o fluxo vê no histórico da execução o que não entrou)
  const porMotivo = {};
  N.ignoradas.forEach(x => { (porMotivo[x.motivo] = porMotivo[x.motivo] || []).push((x.numero || '?') + (x.valor ? ' (' + x.valor + ')' : '')); });
  return {
    empresa: EMPRESA(), recebidas: N.recebidas, gravadas: N.validas.length, novas: res.novas, alteradas: res.alteradas,
    ignoradas: N.ignoradas.length,
    motivos: Object.keys(porMotivo).map(m => ({ motivo: m, notas: porMotivo[m].length, exemplos: porMotivo[m].slice(0, 5) })),
    total: Object.keys(res.dados.notas).length, memoria: !BLOB() || undefined, atualizadoEm: agora
  };
}

// ── a leitura do Kanban / Faturamento do Dia (com cache curto) ──
async function consultar(numeros, ate) {
  const porNum = {};
  if (!ligado()) return { porNum, ligado: false, total: 0, atualizadoEm: null };
  const ms = ate ? Math.min(5000, ate - Date.now() - 1000) : 5000;
  if (!_cache || Date.now() - _cacheTs > CACHE_MS()) {
    if (ms < 300) return { porNum, ligado: true, total: 0, atualizadoEm: null, erro: 'sem tempo para ler o arquivo' };
    _cache = (await ler(ms)).dados; _cacheTs = Date.now();
  }
  const notas = _cache.notas || {};
  (numeros || []).forEach(n => {
    const k = numNorm(n);
    if (k && notas[k] && !porNum[k]) porNum[k] = notas[k].map(x => ({ status: x.status, data: x.data || null, entidade: ENTIDADE, coluna: COLUNA, reserva: true, recebidoEm: x.recebidoEm }));
  });
  return { porNum, ligado: true, total: Object.keys(notas).length, atualizadoEm: _cache.atualizadoEm || null, memoria: !BLOB() || undefined };
}

// testes: _limparCache esquece só a leitura em cache; _limpar também o que
// está na memória (o "arquivo" de quando não há blob)
function _limparCache() { _cache = null; _cacheTs = 0; }
function _limpar() { _mem = null; _limparCache(); }

module.exports = { receber, consultar, exigirChave, ligado, normalizar, ENTIDADE, _limpar, _limparCache };
