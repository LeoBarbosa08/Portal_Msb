// ================================================================
// api/shared/pbi-unidades.js — as UNIDADES DE NEGÓCIO que a pessoa enxerga
// no modelo do Comercial (o RLS dela no Power BI)
//
// O modelo do Comercial tem RLS e o Service Principal NÃO entra nele (toma
// 401). Então a página manda o token DELEGADO do Power BI da própria pessoa
// (header x-pbi-token) e o servidor roda, com ele,
// VALUES('DIM_UNIDADE_DE_NEGOCIO_V2'[UNIDADE_DE_NEGOCIO]) — o que voltar são
// as unidades dela. Antes de usar, confere que o token é do Power BI, não
// venceu e é da MESMA conta do id token validado (oid, ou upn/e-mail); quem
// aceita ou recusa a assinatura é o Power BI.
//
// É o mesmo caminho do /api/fca (escopoDe/unidadesNoPbi), que segue com a
// cópia dele — candidato a usar este módulo um dia. Usado hoje pelas
// Cotações (a cotação é da unidade de quem registra e cada um vê só as das
// suas unidades).
//
//   escopoDe({ email, oid }, pbiToken, { ttlMs })
//     -> { conhecido:true,  unidades:[…], gerencial: 2+ unidades, fonte:'pbi' }
//     -> { conhecido:false, unidades:[],  fonte:'sem-token' | 'token-invalido' |
//          'token-expirado' | 'token-de-outra-conta' | 'pbi-falhou', status? }
//
// Cache por pessoa (oid|e-mail): um acerto vale sem o token até vencer —
// a tela que já confirmou não perde as unidades num pedido que veio sem ele.
//
//   tokenRecusado(user, pbiToken) -> '' (serve) | a `fonte` do escopo fechado
//   executar(pbiToken, dax)       -> as linhas da consulta, com o RLS da pessoa
//     (20/10/2026: a FAMÍLIA dos produtos do Analítico das Cotações)
// ================================================================

const PBI_WS     = process.env.FCA_PBI_WORKSPACE_ID || '8535f0a1-8dc6-4da0-93ce-bf20c1c14e27';
const PBI_REPORT = process.env.FCA_PBI_REPORT_ID    || '10a505aa-759e-4f20-a130-98c0736ba42d';
const COL_UNID   = "'DIM_UNIDADE_DE_NEGOCIO_V2'[UNIDADE_DE_NEGOCIO]";
// as mesmas que o FCA e os painéis do Comercial escondem
const EXCLUI_UNIDADES = ['NOVA TECNOLOGIA', 'NÃO CLASSIFICADO', 'MSB-EXPORT', 'MSB'];
const TTL_PADRAO_MS = 10 * 60 * 1000;

const _cache = new Map();   // chave (oid|email) -> { unidades, exp }
let _ds = null;             // { id, ws } do dataset do Sales Report

function norm(u) { return String(u == null ? '' : u).trim().toUpperCase(); }

function claimsDe(jwt) {
  try {
    const p = String(jwt).split('.')[1] || '';
    return JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch (e) { return null; }
}

function erroPbi(etapa, status, codigo) { const e = new Error('pbi ' + etapa + ' ' + status + (codigo ? ' ' + codigo : '')); e.pbiStatus = status; e.pbiEtapa = etapa; e.pbiCodigo = codigo || ''; return e; }
// a etapa que falhou e o código do Power BI (PowerBIEntityNotFound…): 22/10/2026 —
// o "não respondeu (404)" sem dizer onde não deixava ver que é falta de acesso
async function erroDaResposta(etapa, r) {
  let codigo = '';
  try { const j = await r.json(); codigo = String((j && j.error && (j.error.code || (j.error['pbi.error'] && j.error['pbi.error'].code))) || '').slice(0, 60); } catch (e) { /* sem corpo */ }
  return erroPbi(etapa, r.status, codigo);
}

async function datasetDoRelatorio(token) {
  if (_ds) return _ds;
  const H = { Authorization: 'Bearer ' + token };
  let r = await fetch('https://api.powerbi.com/v1.0/myorg/groups/' + PBI_WS + '/reports/' + PBI_REPORT, { headers: H });
  if (!r.ok) r = await fetch('https://api.powerbi.com/v1.0/myorg/reports/' + PBI_REPORT, { headers: H });
  if (!r.ok) throw await erroDaResposta('report', r);
  const j = await r.json().catch(() => null);
  if (!j || !j.datasetId) throw erroPbi('report', 'sem-dataset');
  _ds = { id: j.datasetId, ws: j.datasetWorkspaceId || PBI_WS };
  return _ds;
}

// uma consulta DAX no modelo do Comercial, com o token DELEGADO da pessoa
// (o RLS dela vale) -> as linhas da 1ª tabela
async function executar(token, dax, jaTentou) {
  const ds = await datasetDoRelatorio(token);
  const body = JSON.stringify({ queries: [{ query: dax }], serializerSettings: { includeNulls: true } });
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  let r = await fetch('https://api.powerbi.com/v1.0/myorg/groups/' + ds.ws + '/datasets/' + ds.id + '/executeQueries', { method: 'POST', headers: H, body: body });
  if (r.status === 401 || r.status === 403 || r.status === 404) {
    r = await fetch('https://api.powerbi.com/v1.0/myorg/datasets/' + ds.id + '/executeQueries', { method: 'POST', headers: H, body: body });
  }
  if (r.status === 404 && !jaTentou) { _ds = null; return executar(token, dax, true); }   // dataset republicado
  if (!r.ok) throw await erroDaResposta('executeQueries', r);
  const j = await r.json().catch(() => null);
  const t = j && j.results && j.results[0] && j.results[0].tables && j.results[0].tables[0];
  return (t && t.rows) || [];
}

async function unidadesNoPbi(token) {
  const rows = await executar(token, 'EVALUATE VALUES(' + COL_UNID + ')');
  const vistos = {}, out = [];
  rows.forEach(row => {
    const k = Object.keys(row || {})[0];
    const u = k ? String(row[k] == null ? '' : row[k]).trim() : '';
    if (!u || EXCLUI_UNIDADES.indexOf(norm(u)) >= 0 || vistos[norm(u)]) return;
    vistos[norm(u)] = true; out.push(u);
  });
  return out.sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// o token do Power BI serve? '' = sim; senão o motivo (a `fonte` do escopo
// fechado): é do Power BI, não venceu e é DA MESMA pessoa do id token validado
function tokenRecusado(user, pbiToken) {
  if (!pbiToken) return 'sem-token';
  const email = String((user && user.email) || '').toLowerCase();
  const oid = String((user && user.oid) || '');
  const c = claimsDe(pbiToken);
  if (!c || !/analysis\.windows\.net\/powerbi\/api/i.test(String(c.aud || ''))) return 'token-invalido';
  if (c.exp && Number(c.exp) * 1000 < Date.now()) return 'token-expirado';
  const donoOid = String(c.oid || '');
  const donoEmail = String(c.upn || c.unique_name || c.preferred_username || c.email || '').trim().toLowerCase();
  const mesma = (oid && donoOid) ? (donoOid === oid) : (!!donoEmail && donoEmail === email);
  return mesma ? '' : 'token-de-outra-conta';
}

async function escopoDe(user, pbiToken, opts) {
  const ttl = (opts && opts.ttlMs) || TTL_PADRAO_MS;
  const email = String((user && user.email) || '').toLowerCase();
  const oid = String((user && user.oid) || '');
  const chave = oid + '|' + email;
  const fecha = (fonte, extra) => Object.assign({ conhecido: false, gerencial: false, unidades: [], fonte: fonte }, extra || {});
  const hit = _cache.get(chave);
  if (hit && hit.exp > Date.now()) return { conhecido: true, gerencial: hit.unidades.length >= 2, unidades: hit.unidades.slice(), fonte: 'pbi' };
  const ruim = tokenRecusado(user, pbiToken);
  if (ruim) return fecha(ruim);

  try {
    const unidades = await unidadesNoPbi(pbiToken);
    _cache.set(chave, { unidades: unidades, exp: Date.now() + ttl });
    return { conhecido: true, gerencial: unidades.length >= 2, unidades: unidades.slice(), fonte: 'pbi' };
  } catch (e) {
    return fecha('pbi-falhou', { status: e.pbiStatus || null, etapa: e.pbiEtapa || '', codigo: e.pbiCodigo || '' });
  }
}

// a unidade na grafia do Power BI, se ela estiver no escopo; senão ''
function unidadeDoEscopo(u, esc) {
  const n = norm(u);
  if (!n) return '';
  return ((esc && esc.unidades) || []).find(x => norm(x) === n) || '';
}

// o motivo do escopo fechado, em português, para a tela
function motivoFechado(esc) {
  const f = (esc && esc.fonte) || '';
  return f === 'sem-token' ? 'a página não mandou o acesso ao Power BI'
    : f === 'token-expirado' ? 'o acesso ao Power BI venceu'
    : f === 'token-de-outra-conta' ? 'o acesso ao Power BI é de outra conta'
    : f === 'token-invalido' ? 'o acesso ao Power BI não é válido'
    : f === 'pbi-falhou' ? motivoDaFalha(esc)
    : 'não deu para consultar o Power BI';
}
// 401/403/404 com o token da própria pessoa = a conta dela não tem acesso (quem
// vê o Sales Report só pelo Aplicativo, sem o workspace nem o Build no modelo)
function motivoDaFalha(esc) {
  const st = esc.status, semAcesso = st === 401 || st === 403 || st === 404;
  const cod = esc.codigo ? ', ' + esc.codigo : '';
  if (semAcesso && esc.etapa === 'report') return 'a sua conta não enxerga o relatório do Comercial (Sales Report) no Power BI (' + st + cod + ') — peça ao administrador do Power BI acesso ao workspace do Comercial (Visualizador) com a permissão de Build no modelo';
  if (semAcesso && esc.etapa === 'executeQueries') return 'a sua conta não tem permissão para consultar o modelo do Comercial no Power BI (' + st + cod + ') — peça ao administrador do Power BI a permissão de Build no modelo do Sales Report';
  return 'o Power BI não respondeu' + (st ? ' (' + st + cod + ')' : '');
}

module.exports = { escopoDe, unidadeDoEscopo, motivoFechado, tokenRecusado, executar, norm, COL_UNID, EXCLUI_UNIDADES, _zerar: function () { _cache.clear(); _ds = null; } };
