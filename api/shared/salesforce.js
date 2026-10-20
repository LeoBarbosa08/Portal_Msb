// ================================================================
// api/shared/salesforce.js — helper de acesso ao Salesforce (REST)
// Autenticação OAuth 2.0 Client Credentials (token em cache) + SOQL.
// SOMENTE LEITURA. Espelha o shared/d365.js (que lê o Dynamics).
//
// DUAS ORGS (28/08/2026). A Biomedical tem mais de uma org e elas NÃO
// compartilham credencial nem dado:
//   • crm        (envs SF_*)      — a que a LICI e o BioLeads usam
//                                   (Account por CNPJ, picklists da
//                                   Negociação, Product2 do catálogo);
//   • importacao (envs SF_IMP_*)  — a org de IMPORTAÇÃO.
// Cada org tem token, cache de describe e My Domain próprios. Quem não
// escolhe org continua falando com a `crm` — todo o código que já
// existia (SF.soql, SF.describe, SF.CONFIGURED...) segue idêntico.
//
//   const SF  = require('../shared/salesforce');
//   SF.soql(...)                 -> org crm (como sempre foi)
//   SF.org('importacao').soql()  -> org de importação (cai na crm se a
//                                   SF_IMP_* não estiver configurada)
//
// Requer, em CADA org, um Connected App com o "Client Credentials Flow"
// habilitado e um usuário de execução (run-as) com API Enabled e leitura
// nos objetos consultados. Passo a passo: docs/bioleads-salesforce.md
// (org do CRM) e docs/salesforce-importacao.md (org de importação).
// ================================================================

// escapa aspas simples para strings SOQL (\' = uma aspa literal)
function soqlStr(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

// só os dígitos (para casar CNPJ/CPF independentemente da máscara)
function digits(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }

// lê um campo por vários nomes possíveis (case-insensitive)
function pick(obj, names) {
  if (!obj) return null;
  for (var i = 0; i < names.length; i++) if (obj[names[i]] != null) return obj[names[i]];
  var keys = Object.keys(obj);
  for (var n = 0; n < names.length; n++) {
    var t = names[n].toLowerCase();
    for (var k = 0; k < keys.length; k++) if (keys[k].toLowerCase() === t) return obj[keys[k]];
  }
  return null;
}

// ── uma conexão por org ────────────────────────────────────────────
// prefixo = prefixo das envs ('SF_' ou 'SF_IMP_'). O estado (token,
// instance_url, cache de describe) é DA INSTÂNCIA: misturar token de uma
// org com a instance_url de outra devolveria 401 sem explicação.
function criarOrg(nome, rotulo, prefixo, padroes) {
  padroes = padroes || {};
  const LOGIN  = String(process.env[prefixo + 'LOGIN_URL'] || padroes.login || 'https://login.salesforce.com').replace(/\/$/, '');
  const CLIENT = process.env[prefixo + 'CLIENT_ID'];
  const SECRET = process.env[prefixo + 'CLIENT_SECRET'];
  const APIVER = process.env[prefixo + 'API_VERSION'] || padroes.apiver || 'v64.0';
  const CONFIGURED = !!(CLIENT && SECRET);

  let _tok = null, _inst = null, _tokExp = 0;
  async function getToken() {
    var now = Date.now();
    if (_tok && now < _tokExp - 60000) return { token: _tok, instance: _inst };
    if (!CONFIGURED) throw new Error('Salesforce (' + rotulo + ') sem credencial: defina ' + prefixo + 'CLIENT_ID e ' + prefixo + 'CLIENT_SECRET.');
    var url = LOGIN + '/services/oauth2/token';
    var body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT,
      client_secret: SECRET
    });
    var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body });
    var txt = await r.text();
    // o rótulo da org vai no erro: com duas orgs, "SF token 401" sozinho
    // não diz qual credencial está errada.
    if (!r.ok) throw new Error('SF token (' + rotulo + ') ' + r.status + ': ' + txt.slice(0, 200));
    var j = JSON.parse(txt);
    _tok  = j.access_token;
    _inst = (j.instance_url || LOGIN).replace(/\/$/, '');
    // client_credentials não devolve expires_in; assume ~2h e revalida na falha
    _tokExp = now + (110 * 60 * 1000);
    return { token: _tok, instance: _inst };
  }

  // executa uma query SOQL e devolve o array de records (segue paginação via
  // nextRecordsUrl). maxPages = trava de segurança (0/omitido = ilimitado).
  async function soql(query, maxPages) {
    var auth = await getToken();
    var url = auth.instance + '/services/data/' + APIVER + '/query/?q=' + encodeURIComponent(query);
    // teto padrão anti-DoS: sem maxPages explícito, NÃO pagina infinito.
    var out = [], pages = 0, cap = maxPages || Number(process.env.SF_DEFAULT_MAX_PAGES || 50);
    while (url) {
      var r = await fetch(url, { headers: { Authorization: 'Bearer ' + auth.token, Accept: 'application/json' } });
      var txt = await r.text();
      if (!r.ok) throw new Error('SF query (' + rotulo + ') ' + r.status + ': ' + txt.slice(0, 200));
      var j = JSON.parse(txt);
      if (Array.isArray(j.records)) out = out.concat(j.records);
      url = j.nextRecordsUrl ? (auth.instance + j.nextRecordsUrl) : null;
      if (cap && ++pages >= cap) break;
    }
    return out;
  }

  // describe de um sobject (lista de campos etc.), com cache por org.
  // Usado p/ auto-descobrir campos customizados (ex.: CRM do médico).
  let _desc = {};
  async function describe(sobject) {
    if (_desc[sobject]) return _desc[sobject];
    var auth = await getToken();
    var url = auth.instance + '/services/data/' + APIVER + '/sobjects/' + sobject + '/describe';
    var r = await fetch(url, { headers: { Authorization: 'Bearer ' + auth.token, Accept: 'application/json' } });
    var txt = await r.text();
    if (!r.ok) throw new Error('SF describe (' + rotulo + ') ' + r.status + ': ' + txt.slice(0, 200));
    _desc[sobject] = JSON.parse(txt);
    return _desc[sobject];
  }

  // CATÁLOGO DE OBJETOS da org (nome + rótulo), com cache. É o espelho do
  // service document do Dynamics (GET {RESOURCE}/data): serve p/ achar o nome
  // de API certo SEM abrir o Salesforce. Nome de objeto customizado varia de
  // org p/ org — chutar e cair fora é o que faz "campo sem lista".
  let _sobjs = null, _sobjsTs = 0;
  const SOBJ_TTL = 20 * 60 * 1000;
  async function sobjects() {
    var now = Date.now();
    if (_sobjs && now - _sobjsTs < SOBJ_TTL) return _sobjs;
    var auth = await getToken();
    var url = auth.instance + '/services/data/' + APIVER + '/sobjects/';
    var r = await fetch(url, { headers: { Authorization: 'Bearer ' + auth.token, Accept: 'application/json' } });
    var txt = await r.text();
    if (!r.ok) throw new Error('SF sobjects (' + rotulo + ') ' + r.status + ': ' + txt.slice(0, 200));
    var j = JSON.parse(txt);
    _sobjs = (Array.isArray(j.sobjects) ? j.sobjects : []).map(function (s) {
      return { name: s.name, label: s.label, custom: !!s.custom, queryable: !!s.queryable };
    });
    _sobjsTs = now;
    return _sobjs;
  }

  return {
    nome: nome, rotulo: rotulo, prefixo: prefixo,
    CONFIGURED: CONFIGURED, LOGIN: LOGIN, APIVER: APIVER,
    getToken: getToken, soql: soql, describe: describe, sobjects: sobjects,
    soqlStr: soqlStr, digits: digits, pick: pick
  };
}

const CRM        = criarOrg('crm', 'CRM', 'SF_');
// a org de importação herda só a versão de API do CRM (o My Domain é dela)
const IMPORTACAO = criarOrg('importacao', 'Importação', 'SF_IMP_',
                            { apiver: process.env.SF_API_VERSION });

const ORGS = { crm: CRM, importacao: IMPORTACAO };

// aceita 'crm' | 'importacao' | 'importação' | 'imp' (sem acento, sem caixa).
// Org pedida mas não configurada CAI NA CRM em vez de estourar: lista faltando
// é ruim, endpoint quebrado é pior — e o diagnóstico mostra qual respondeu.
function org(nome) {
  var n = String(nome == null ? '' : nome).toLowerCase().trim();
  if (n === 'imp' || n === 'importacao' || n === 'importação') return IMPORTACAO.CONFIGURED ? IMPORTACAO : CRM;
  return CRM;
}

// quais orgs estão configuradas (p/ diagnóstico, sem vazar credencial)
function orgsConfiguradas() {
  return Object.keys(ORGS).map(function (k) {
    return { org: k, rotulo: ORGS[k].rotulo, prefixo: ORGS[k].prefixo,
             configurada: ORGS[k].CONFIGURED, login: ORGS[k].CONFIGURED ? ORGS[k].LOGIN : null };
  });
}

module.exports = {
  // superfície ANTIGA (org do CRM) — nada do que já existia muda
  CONFIGURED: CRM.CONFIGURED, LOGIN: CRM.LOGIN, APIVER: CRM.APIVER,
  getToken: CRM.getToken, soql: CRM.soql, describe: CRM.describe, sobjects: CRM.sobjects,
  soqlStr: soqlStr, digits: digits, pick: pick,
  // multi-org
  org: org, ORGS: ORGS, CRM: CRM, IMPORTACAO: IMPORTACAO, orgsConfiguradas: orgsConfiguradas
};
