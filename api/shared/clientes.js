// ================================================================
// api/shared/clientes.js — base de clientes/contas (carteira comercial)
//
// Carrega TODA a carteira e mantém em cache de módulo (instância warm
// da Function). É o gabarito de "já é cliente/conta" usado pelo agente
// Buscador de Leads (/api/leads-clientes e /api/leads-buscar).
//
// FONTE configurável pela env LEADS_SOURCE:
//   'salesforce' (padrão) — Account do Salesforce (mais contas: clientes
//                 + prospects + em negociação). Campos configuráveis por
//                 SF_ACCOUNT_NAME (Name) e SF_CNPJ_FIELD (CNPJ__c), com
//                 filtro extra opcional SF_ACCOUNT_WHERE.
//   'd365'      — CustTable do Dynamics 365 F&O (entidade descoberta:
//                 CustTables -> CustomersV3, ou D365_CUST_ENTITY).
//
// Match por CNPJ: 14 díg. exatos = 'cliente'; mesma raiz (8 díg.) =
// 'grupo' (outra filial já é conta); senão 'novo'.
// ================================================================

const D  = require('./d365');
const SF = require('./salesforce');

const CACHE_MIN = Number(process.env.LEADS_CACHE_MIN || 360);            // 6h
const SOURCE    = (process.env.LEADS_SOURCE || 'salesforce').toLowerCase();

// Salesforce — nomes de campo/objeto configuráveis (defaults do LICI)
const SF_NAME   = process.env.SF_ACCOUNT_NAME || 'Name';
const SF_CNPJ   = process.env.SF_CNPJ_FIELD   || 'CNPJ__c';
const SF_WHERE  = process.env.SF_ACCOUNT_WHERE || '';                    // ex.: "RecordType.Name = 'Cliente'"
const SF_MAXPG  = Number(process.env.LEADS_SF_MAXPAGES || 400);          // 400 págs ~ 800k contas

const CONFIGURED = SOURCE === 'salesforce' ? SF.CONFIGURED : D.CONFIGURED;
const FONTE      = SOURCE === 'salesforce' ? 'Salesforce' : 'Dynamics 365';

// só dígitos; devolve '' se não sobrar nada
function soDigitos(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }

// ── D365: descoberta da entidade de clientes ────────────────────
const D_CANDIDATOS = [];
if (process.env.D365_CUST_ENTITY) {
  D_CANDIDATOS.push({ entity: process.env.D365_CUST_ENTITY, select: process.env.D365_CUST_SELECT || '' });
}
D_CANDIDATOS.push(
  { entity: 'CustTables',  select: 'dataAreaId,AccountNum,Name,CNPJCPFNum_BR' },
  { entity: 'CustomersV3', select: 'dataAreaId,CustomerAccount,OrganizationName,BrazilianCNPJOrCPF' },
  { entity: 'CustomersV3', select: 'dataAreaId,CustomerAccount,OrganizationName' }
);
let _d365ent = null;

async function _carregarD365() {
  if (!D.CONFIGURED) throw new Error('D365 não configurado (D365_TENANT_ID/CLIENT_ID/CLIENT_SECRET).');
  const token = await D.getToken();
  if (!_d365ent) {
    let ultimo = null;
    for (const c of D_CANDIDATOS) {
      try { await D.odataGet(c.entity, { select: c.select || undefined, top: 1, crossCompany: true }, token); _d365ent = c; break; }
      catch (e) { ultimo = e; }
    }
    if (!_d365ent) throw new Error('Nenhuma entidade de clientes acessível no D365. Último erro: ' + (ultimo && ultimo.message));
  }
  const rows = await D.odataGetAll(_d365ent.entity, { select: _d365ent.select || undefined, crossCompany: true }, token);
  return {
    entidade: _d365ent.entity,
    clientes: rows.map(function (r) {
      return {
        conta:   D.pick(r, ['AccountNum', 'CustomerAccount']) || '',
        nome:    D.pick(r, ['Name', 'OrganizationName', 'NameAlias']) || '',
        cnpj:    soDigitos(D.pick(r, ['CNPJCPFNum_BR', 'BrazilianCNPJOrCPF', 'CNPJCPFNumber'])),
        empresa: D.pick(r, ['dataAreaId']) || ''
      };
    })
  };
}

// ── Salesforce: Account ─────────────────────────────────────────
async function _carregarSalesforce() {
  if (!SF.CONFIGURED) throw new Error('Salesforce não configurado (SF_CLIENT_ID/SF_CLIENT_SECRET).');
  let where = SF_CNPJ + " != null";
  if (SF_WHERE) where += ' AND (' + SF_WHERE + ')';
  const q = 'SELECT Id, ' + SF_NAME + ', ' + SF_CNPJ + ' FROM Account WHERE ' + where;
  const rows = await SF.soql(q, SF_MAXPG);
  return {
    entidade: 'Account',
    clientes: rows.map(function (r) {
      return {
        conta:   r.Id || '',
        nome:    SF.pick(r, [SF_NAME, 'Name']) || '',
        cnpj:    soDigitos(SF.pick(r, [SF_CNPJ, 'CNPJ__c'])),
        empresa: ''
      };
    })
  };
}

// ── cache + montagem dos índices ────────────────────────────────
let _cache = null;

async function getBase(force) {
  const agora = Date.now();
  if (!force && _cache && (agora - _cache.ts) < CACHE_MIN * 60000) return _cache;
  if (!CONFIGURED) throw new Error(FONTE + ' não configurado para o BioLeads (LEADS_SOURCE=' + SOURCE + ').');

  const carga = SOURCE === 'salesforce' ? await _carregarSalesforce() : await _carregarD365();

  const clientes = carga.clientes.filter(function (c) { return c.conta || c.nome || c.cnpj; });
  const cnpjSet = new Set();   // CNPJs completos (14 díg.) e CPFs (11 díg.)
  const raizSet = new Set();   // raiz do CNPJ (8 primeiros díg.) → matriz/filiais
  clientes.forEach(function (c) {
    const doc = c.cnpj;
    if (doc.length === 14) { cnpjSet.add(doc); raizSet.add(doc.slice(0, 8)); }
    else if (doc.length === 11) { cnpjSet.add(doc); }
  });

  _cache = {
    fonte: FONTE,
    source: SOURCE,
    entidade: carga.entidade,
    clientes: clientes,
    cnpjSet: cnpjSet,
    raizSet: raizSet,
    total: clientes.length,
    comCnpj: cnpjSet.size,
    carregadoEm: new Date(agora).toISOString(),
    ts: agora
  };
  return _cache;
}

// classifica um CNPJ (14 díg.) contra a base: 'cliente' | 'grupo' | 'novo'
function statusCnpj(base, cnpj) {
  const d = soDigitos(cnpj);
  if (d.length !== 14) return 'novo';
  if (base.cnpjSet.has(d)) return 'cliente';
  if (base.raizSet.has(d.slice(0, 8))) return 'grupo';
  return 'novo';
}

module.exports = { getBase, statusCnpj, soDigitos, CONFIGURED, SOURCE, FONTE };
