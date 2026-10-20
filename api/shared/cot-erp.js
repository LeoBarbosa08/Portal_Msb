// ================================================================
// api/shared/cot-erp.js — o COMPRADOR da cotação no Dynamics 365 (F&O)
//
// Casa o CNPJ lido do PDF com o cadastro de clientes do F&O e devolve o que
// interessa à cotação: código do cliente (ERP), razão social, empresa(s),
// grupo, condição/forma de pagamento cadastradas, endereço, contato,
// situação (bloqueado), vendedor e segmento quando a entidade expõe.
//
// SÓ LEITURA, app-only (D365_TENANT_ID/CLIENT_ID/CLIENT_SECRET — o mesmo
// acesso do /api/pedido-lotes). O OData do F&O só filtra TEXTO com eq (não
// há startswith/contains): o CNPJ vai como está gravado — tenta só dígitos
// e com máscara. Entidades: CustomersV3 (BrazilianCNPJOrCPF) e, sem ela,
// CustTables (CNPJCPFNum_BR) — as mesmas que a carteira (shared/clientes.js)
// e a Cobrança já usam em produção. COT_ERP_ENTIDADE + COT_ERP_CAMPO_CNPJ
// fixam outra. Sem $select: a linha vem inteira (são 1-3 linhas) e cada
// campo é lido por vários nomes (o que a entidade não tiver fica vazio).
// Cache por CNPJ: 6 h achado, 30 min não achado.
// ================================================================

const D = require('./d365');

const ALVOS = [];
if (process.env.COT_ERP_ENTIDADE) ALVOS.push({ entity: process.env.COT_ERP_ENTIDADE, campo: process.env.COT_ERP_CAMPO_CNPJ || 'BrazilianCNPJOrCPF' });
ALVOS.push({ entity: 'CustomersV3', campo: 'BrazilianCNPJOrCPF' }, { entity: 'CustTables', campo: 'CNPJCPFNum_BR' });

// cada informação, pelos nomes que ela tem nas entidades do F&O
const COL = {
  codigo: ['CustomerAccount', 'AccountNum'],
  nome: ['OrganizationName', 'Name'],
  fantasia: ['NameAlias', 'OrganizationAliasName', 'SearchName'],
  empresa: ['dataAreaId'],
  grupo: ['CustomerGroupId', 'CustGroup'],
  pagamento: ['PaymentTerms', 'PaymTermId'],
  formaPagamento: ['PaymentMethod', 'PaymMode'],
  rua: ['AddressStreet', 'Street'],
  numero: ['AddressStreetNumber', 'StreetNumber'],
  bairro: ['AddressDistrictName', 'DistrictName', 'District'],
  cidade: ['AddressCity', 'City'],
  uf: ['AddressState', 'State', 'AddressStateId'],
  cep: ['AddressZipCode', 'ZipCode'],
  enderecoCompleto: ['FullPrimaryAddress', 'AddressDescription'],
  email: ['PrimaryContactEmail', 'Email'],
  telefone: ['PrimaryContactPhone', 'Phone'],
  bloqueio: ['OnHoldStatus', 'CustomerOnHoldStatus', 'Blocked'],
  vendedor: ['EmployeeResponsibleNumber', 'SalesResponsiblePersonnelNumber'],
  segmento: ['SalesSegmentId', 'SegmentId'],
  limiteCredito: ['CreditLimit'],
  ie: ['StateInscription_BR', 'BrazilianStateInscription', 'StateInscription']
};
const EMPRESA_PREFERIDA = 'bio';   // a cotação é sempre da BIO
const TTL_ACHOU = 6 * 3600e3, TTL_NAO = 30 * 60e3;
const _cache = new Map();
let _alvo = null;                   // a entidade que respondeu (as próximas vão direto nela)

function digitos(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
function mascara(d) {
  if (d.length === 14) return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12);
  if (d.length === 11) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
  return d;
}
function txt(v, max) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function ler(row, campo) { const v = D.pick(row, COL[campo]); return v == null ? '' : v; }
// "No" / "Never" = livre; "All", "Invoice", "Payment"… = bloqueado para algo
function bloqueado(v) { const s = txt(v, 40); return !!s && !/^(no|never|none|nenhum|não|nao|0|false)$/i.test(s); }

function retrato(linhas, fonte) {
  const prefer = linhas.filter(function (r) { return String(ler(r, 'empresa')).toLowerCase() === EMPRESA_PREFERIDA; })[0] || linhas[0];
  const r = prefer;
  const rua = txt(ler(r, 'rua'), 160), numero = txt(ler(r, 'numero'), 20);
  return {
    achou: true, fonte: fonte,
    codigo: txt(ler(r, 'codigo'), 30), nome: txt(ler(r, 'nome'), 160), fantasia: txt(ler(r, 'fantasia'), 120),
    empresa: txt(ler(r, 'empresa'), 10).toUpperCase(),
    empresas: linhas.map(function (x) { return txt(ler(x, 'empresa'), 10).toUpperCase(); }).filter(function (e, i, l) { return e && l.indexOf(e) === i; }),
    grupo: txt(ler(r, 'grupo'), 30), pagamento: txt(ler(r, 'pagamento'), 60), formaPagamento: txt(ler(r, 'formaPagamento'), 40),
    endereco: [rua, numero].filter(Boolean).join(', ') || txt(ler(r, 'enderecoCompleto'), 200).split('\n')[0],
    bairro: txt(ler(r, 'bairro'), 80), cidade: txt(ler(r, 'cidade'), 80), uf: txt(ler(r, 'uf'), 2).toUpperCase(), cep: txt(ler(r, 'cep'), 12),
    email: txt(ler(r, 'email'), 200).toLowerCase(), telefone: txt(ler(r, 'telefone'), 40),
    bloqueio: txt(ler(r, 'bloqueio'), 40), bloqueado: bloqueado(ler(r, 'bloqueio')),
    vendedor: txt(ler(r, 'vendedor'), 40), segmento: txt(ler(r, 'segmento'), 40), ie: txt(ler(r, 'ie'), 30),
    limiteCredito: Number(ler(r, 'limiteCredito')) || 0,
    em: new Date().toISOString()
  };
}

async function procurar(d) {
  const token = await D.getToken();
  const valores = [d, mascara(d)].filter(function (v, i, l) { return l.indexOf(v) === i; });
  const alvos = _alvo ? [_alvo] : ALVOS;
  let ultimo = null;
  for (const a of alvos) {
    try {
      for (const v of valores) {
        const rows = await D.odataGet(a.entity, { filter: a.campo + " eq '" + D.odataStr(v) + "'", crossCompany: true, top: 10 }, token);
        _alvo = a;   // a entidade respondeu: é ela
        if (rows.length) return retrato(rows, a.entity);
      }
      return { achou: false, fonte: a.entity };
    } catch (e) { ultimo = e; }
  }
  throw ultimo || new Error('nenhuma entidade de clientes respondeu no Dynamics');
}

// { configurado:false } | { achou:false } | { achou:true, codigo, … } — erro lança
async function clientePorCnpj(cnpj, opts) {
  const d = digitos(cnpj);
  if (d.length !== 14 && d.length !== 11) return { achou: false, motivo: 'CNPJ incompleto' };
  if (!D.CONFIGURED) return { configurado: false, achou: false };
  const c = _cache.get(d);
  if (c && Date.now() - c.em < (c.v.achou ? TTL_ACHOU : TTL_NAO)) return c.v;
  const limite = (opts && opts.timeoutMs) || 15000;
  const v = await Promise.race([procurar(d), new Promise(function (_, falha) { setTimeout(function () { falha(new Error('o Dynamics demorou mais de ' + Math.round(limite / 1000) + ' s')); }, limite); })]);
  _cache.set(d, { em: Date.now(), v: v });
  return v;
}

module.exports = { clientePorCnpj, CONFIGURADO: D.CONFIGURED, _zerar: function () { _cache.clear(); _alvo = null; } };
