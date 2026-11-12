// ================================================================
// /api/pedido-transportadoras  —  PI · Pedido (12/11/2026)
//
// Pedido do dono: "um campo novo no PI chamado TRANSPORTADORA, que puxa os
// dados da tabela SalesCarrierEntity e pega o nome da transportadora". Lê as
// transportadoras da empresa MSB direto do Dynamics F&O (OData, sem Power
// Automate) e devolve a lista de nomes para o select do cabeçalho do PI.
// O campo NÃO é obrigatório.
//
//   GET /api/pedido-transportadoras
//   -> { configured:true, empresa, entidade, campo, aviso,
//        transportadoras:[ { nome, cnpj, fornecedor } ] }   (ordem alfabética)
//   -> { configured:false }   (sem credenciais D365)
//   -> { configured:true, transportadoras:[], erro }   (o Dynamics falhou)
//   GET /api/pedido-transportadoras?atualizar=1  -> ignora o cache de 10 min
//
// A entidade (SalesCarrierEntity, "Sales Carrier") traz o NOME em
// CarrierName — é a chave da transportadora no Dynamics; vem também o
// CNPJ/CPF (CnpjOrCpf) e o fornecedor (Vendor).
//
// Env vars: as do shared/d365.js (D365_*) +
//   D365_TRANSPORTADORA_ENTITY  — nome da entidade no OData, se não for um dos
//                                 padrões abaixo (SalesCarrierEntity, SalesCarriers)
//   TRANSPORTADORA_EMPRESA      — empresa (dataAreaId), padrão "msb"
// ================================================================

const D = require('../shared/d365');
const auth = require('../shared/auth');
const http = require('../shared/http');

const EMPRESA = String(process.env.TRANSPORTADORA_EMPRESA || 'msb').trim();

// o nome da entidade no OData do F&O é o "public collection name" — pode não
// ser igual ao nome da entidade. Tenta o da env, depois os padrões; a 1ª que
// responder fica guardada.
const ENTIDADES = [process.env.D365_TRANSPORTADORA_ENTITY, 'SalesCarrierEntity', 'SalesCarriers']
  .map(function (s) { return String(s || '').trim(); })
  .filter(function (s, i, a) { return s && a.indexOf(s) === i; });

// o nome da transportadora na linha (CarrierName; os outros, por garantia)
const CAMPOS_NOME = ['CarrierName', 'Name', 'CarrierDescription', 'Description'];

const CACHE_MS = 10 * 60 * 1000;
const PRAZO_MS = 20000;
let _cache = null, _cacheEm = 0, _entidadeOk = null;

function txt(v) { return String(v == null ? '' : v).trim(); }

function campoNome(row) {
  const ks = Object.keys(row || {});
  for (let i = 0; i < CAMPOS_NOME.length; i++) {
    const k = ks.find(function (x) { return x.toLowerCase() === CAMPOS_NOME[i].toLowerCase(); });
    if (k) return k;
  }
  return null;
}

// entidade que não existe: o F&O responde 404 ("Resource not found for the segment")
function naoExiste(e) { return /F&O 404|not found for the segment/i.test((e && e.message) || ''); }
// filtro por dataAreaId numa entidade sem esse campo: 400
function semEmpresa(e) { return /F&O 400/.test((e && e.message) || '') && /dataAreaId/i.test((e && e.message) || ''); }

// lê as linhas da entidade na empresa (se ela não tiver dataAreaId, lê tudo)
async function lerEntidade(ent, token) {
  try {
    return { rows: await D.odataGetComPrazo(ent, { crossCompany: true, filter: "dataAreaId eq '" + D.odataStr(EMPRESA) + "'" }, token, PRAZO_MS), porEmpresa: true };
  } catch (e) {
    if (!semEmpresa(e)) throw e;
    return { rows: await D.odataGetComPrazo(ent, { crossCompany: true }, token, PRAZO_MS), porEmpresa: false };
  }
}

async function buscar(token) {
  const ordem = _entidadeOk ? [_entidadeOk].concat(ENTIDADES.filter(function (x) { return x !== _entidadeOk; })) : ENTIDADES;
  let ultimoErro = null;
  for (let i = 0; i < ordem.length; i++) {
    const ent = ordem[i];
    let lido;
    try { lido = await lerEntidade(ent, token); }
    catch (e) { ultimoErro = e; if (naoExiste(e)) continue; throw e; }
    _entidadeOk = ent;

    const rows = lido.rows;
    const campo = rows.length ? campoNome(rows[0]) : 'CarrierName';
    if (rows.length && !campo) {
      const e = new Error('a tabela ' + ent + ' do Dynamics não traz o nome da transportadora (CarrierName)');
      e.semNome = true;
      throw e;
    }
    // um nome por transportadora (sem repetidos, sem vazios), em ordem alfabética
    const vistos = {};
    const lista = [];
    rows.forEach(function (r) {
      const nome = txt(r[campo]);
      if (!nome || vistos[nome.toUpperCase()]) return;
      vistos[nome.toUpperCase()] = 1;
      lista.push({ nome: nome, cnpj: txt(D.pick(r, ['CnpjOrCpf'])), fornecedor: txt(D.pick(r, ['Vendor'])) });
    });
    lista.sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }); });
    return {
      entidade: ent, campo: campo, transportadoras: lista,
      aviso: lido.porEmpresa ? '' : 'a tabela ' + ent + ' não tem empresa (dataAreaId): a lista traz as transportadoras de todas as empresas'
    };
  }
  const e = new Error('nenhuma entidade de transportadoras encontrada no Dynamics (' + ordem.join(', ') + ')' +
    (ultimoErro ? ': ' + ultimoErro.message : '') + ' — confira o nome em D365_TRANSPORTADORA_ENTITY');
  e.semEntidade = true;
  throw e;
}

module.exports = async function (context, req) {
  const cors = http.cors(req);
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: cors }; return; }
  const json = function (status, body) {
    context.res = { status: status, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, cors), body: body };
  };

  try {
    await auth.requireArea(req, ['comercial', 'estoque']);   // as mesmas áreas do /api/pedido-enviar

    if (!D.CONFIGURED) { json(200, { configured: false }); return; }

    const atualizar = /^(1|true|sim)$/i.test(String((req.query && req.query.atualizar) || ''));
    if (!atualizar && _cache && Date.now() - _cacheEm < CACHE_MS) { json(200, _cache); return; }

    // erro do Dynamics vai na resposta (200, `erro`), como o aviso do
    // /api/pedido-lotes: a tela mostra o motivo embaixo do campo e o pedido
    // segue sem transportadora (o campo é opcional). Erro não fica em cache.
    let r;
    try {
      r = await buscar(await D.getToken());
    } catch (e) {
      context.log && context.log.warn && context.log.warn('[pedido-transportadoras]', (e && e.message) || e);
      json(200, { configured: true, empresa: EMPRESA, transportadoras: [], erro: (e && e.message) || String(e) });
      return;
    }
    _cache = Object.assign({ configured: true, empresa: EMPRESA }, r);
    _cacheEm = Date.now();
    json(200, _cache);
  } catch (err) {
    http.sendError(context, req, 'pedido-transportadoras', err);
  }
};

// para o teste (scripts/test-pedido-transportadoras.js)
module.exports._limparCache = function () { _cache = null; _cacheEm = 0; _entidadeOk = null; };
