// ================================================================
// api/shared/carteira-clientes.js — CARTEIRA DE CLIENTES (Comercial)
//
// Cruza o cadastro de clientes do DYNAMICS 365 F&O com as Contas do
// SALESFORCE pelo CNPJ e entrega UMA linha por cliente com o que cada
// sistema sabe dele. SOMENTE LEITURA nas duas pontas.
//
// A CHAVE é o CNPJ (ou CPF) SÓ COM OS DÍGITOS — as máscaras não batem:
//   Salesforce  Account.CNPJ__c                 12.345.678/0001-90
//   Dynamics    CustomersV3.BrazilianCNPJOrCPF  123456780001-90
// O Dynamics às vezes guarda sem o zero da esquerda (13 dígitos): o
// documento é completado com zeros quando o dígito verificador confere
// (docDe). Documento só de zeros (ou de um dígito repetido) é "sem CNPJ" —
// senão todos os cadastros com 00000000000000 virariam um cliente só.
//
// SITUAÇÃO de cada cliente: 'ambos' | 'd365' (só no Dynamics) | 'sf' (só
// no Salesforce). Conta do SF de FORNECEDOR que não é cliente no Dynamics
// fica FORA da carteira (CARTEIRA_SF_TIPOS_FORA, padrão "Fornecedor"):
// em 29/10/2026 eram ~2 mil contas que inchariam o "só no Salesforce".
//
// PENDÊNCIAS que o cruzamento revela (ALERTAS, com rótulo no catálogo):
// Código ERP do SF diferente do código do Dynamics, conta do SF sem
// Código ERP, Código ERP que aponta para outro CNPJ ou que não existe no
// Dynamics, CNPJ repetido em duas contas do SF, dígito verificador que
// não confere — e as marcas de situação (bloqueado no Dynamics, restrição
// financeira no SF).
//
// CARGA: as duas bases inteiras, em paralelo, em cache de módulo
// (CARTEIRA_CACHE_MIN, 6 h; 5 min quando uma fonte falhou). Vencido o
// cache, a resposta sai com a base que já existe e a nova carga corre por
// trás. A primeira carga de uma instância fria pode passar do corte de
// ~45 s do SWA: quem chama espera até CARTEIRA_PRAZO_MS e, se não deu,
// recebe `carregando` e pergunta de novo — a carga continua na instância.
//
// BLOB (04/11/2026): a memória some quando a instância esfria — e o SWA
// recicla as Functions o tempo todo —, então quase toda abertura pagava a
// carga inteira (um ou dois minutos de "Montando a carteira"). Agora cada
// carga COMPLETA grava a carteira montada num blob (gzip, ~1 MB) e a
// instância fria abre por ele em ~1 s; vencido, recarrega por trás.
//   CARTEIRA_BLOB_URL  SAS de container (Read + Write + Create) ou do
//                      próprio blob; sem ela, a pasta carteira-clientes/
//                      do container do Radar (RADAR_BLOB_URL), o mesmo
//                      reaproveitamento do Cérebro. Sem nenhuma: só a memória.
//
// A FICHA de um cliente (fichaCliente) NÃO depende da carga: vai direto
// às duas fontes pelo CNPJ, então a busca funciona mesmo com a carteira
// ainda carregando.
//
// BUSCA POR TUDO DO CLIENTE (18/11/2026, buscar / GET ?busca=): o que os
// dois cadastros sabem e a lista não leva (e-mail, telefone, IE, CEP,
// endereço, Identificador… — textoBusca, no cliente montado e no blob, fora
// do pacote da tela) e o Salesforce por SOSL (contatos, conta,
// oportunidades do Comercial). Ver docs/carteira-clientes.md §10.
// ================================================================

const zlib = require('zlib');
const D  = require('./d365');
const SF = require('./salesforce');

function lista(v, padrao) {
  const s = String(v == null ? '' : v).trim();
  return s ? s.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : padrao;
}

const CACHE_MIN         = Number(process.env.CARTEIRA_CACHE_MIN || 360);
const CACHE_PARCIAL_MIN = Number(process.env.CARTEIRA_CACHE_PARCIAL_MIN || 5);
const PRAZO_MS          = Number(process.env.CARTEIRA_PRAZO_MS || 36000);     // o SWA corta em ~45 s
const CARGA_MAX_MS      = Number(process.env.CARTEIRA_CARGA_MAX_MS || 300000); // fonte travada não prende a fila
const SF_CNPJ           = process.env.SF_CNPJ_FIELD || 'CNPJ__c';
const SF_COD            = process.env.CARTEIRA_SF_CODIGO || 'CODCFO__c';
const SF_WHERE          = process.env.CARTEIRA_SF_WHERE || '';
const SF_MAXPG          = Number(process.env.CARTEIRA_SF_MAXPAGES || 100);     // 2 mil contas por página
const D_MAXPG           = Number(process.env.CARTEIRA_D365_MAXPAGES || 200);
const D_FILTRO          = process.env.CARTEIRA_D365_FILTRO || '';
const TIPOS_FORA        = lista(process.env.CARTEIRA_SF_TIPOS_FORA, ['Fornecedor']);
// os mesmos tipos de registro do Dossiê de Visita: a negociação da
// Licitação não abre para o Comercial (ver /api/comercial-funil)
const TIPOS_OPORTUNIDADE = lista(process.env.CARTEIRA_TIPOS_OPORTUNIDADE, ['Oportunidade', 'Cotacao']);
const EMPRESA_PREF      = 'bio';
const BLOB_PROPRIO      = process.env.CARTEIRA_BLOB_URL || '';
const BLOB_SAS          = BLOB_PROPRIO || process.env.RADAR_BLOB_URL || '';
const BLOB_PRAZO_MS     = Number(process.env.CARTEIRA_BLOB_PRAZO_MS || 8000);
const BLOB_VERSAO       = 2;   // muda quando o formato do cliente muda: blob velho é ignorado
// 2 (18/11/2026): o cliente leva `busca` (textoBusca). O blob da versão 1
// ainda abre a tela na hora, mas vale como VENCIDO: a carga das fontes
// corre por trás e a busca por e-mail/telefone/… passa a valer quando ela
// termina — sem a pessoa pagar o "Montando a carteira" depois do deploy.
const BLOB_VERSAO_MIN   = 1;

// ── catálogo das marcas de cada cliente ───────────────────────────
// tipo 'cadastro' = pendência (algo a corrigir num dos sistemas);
// tipo 'situacao' = só informa.
const ALERTAS = {
  'cod-diverge':  { tipo: 'cadastro', rot: 'Código ERP diferente', desc: 'O Código ERP da conta do CRM não é o código do cliente no Dynamics.' },
  'sem-cod':      { tipo: 'cadastro', rot: 'CRM sem Código ERP', desc: 'O cliente existe no Dynamics, mas a conta do CRM está sem o Código ERP.' },
  'cod-outro':    { tipo: 'cadastro', rot: 'Código ERP de outro cadastro', desc: 'A conta só existe no CRM, mas o Código ERP dela é de outro cliente no Dynamics (com outro CNPJ, ou sem CNPJ).' },
  'cod-orfao':    { tipo: 'cadastro', rot: 'Código ERP inexistente', desc: 'A conta só existe no CRM e o Código ERP dela não existe no Dynamics.' },
  'sf-dup':       { tipo: 'cadastro', rot: 'CNPJ repetido no CRM', desc: 'Mais de uma conta do CRM com o mesmo CNPJ.' },
  'd365-dup':     { tipo: 'cadastro', rot: 'CNPJ repetido no Dynamics', desc: 'Mais de um código de cliente com o mesmo CNPJ na mesma empresa do Dynamics.' },
  'doc-invalido': { tipo: 'cadastro', rot: 'CNPJ/CPF inválido', desc: 'O dígito verificador do CNPJ/CPF não confere.' },
  'sem-doc':      { tipo: 'cadastro', rot: 'Sem CNPJ', desc: 'Cadastro sem CNPJ/CPF utilizável — não dá para cruzar com o outro sistema.' },
  'bloqueado':    { tipo: 'situacao', rot: 'Bloqueado no Dynamics', desc: 'Cliente com bloqueio (On hold) no Dynamics.' },
  'restricao':    { tipo: 'situacao', rot: 'Restrição financeira', desc: 'Restrição financeira marcada na conta do CRM.' },
  'sf-inativa':   { tipo: 'situacao', rot: 'Conta inativa no CRM', desc: 'A conta do CRM está marcada como inativa.' }
};

// ══════════════════════════════════════════════════════════════════
// DOCUMENTO (a chave do cruzamento)
// ══════════════════════════════════════════════════════════════════
function digitos(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }

function cnpjValido(d) {
  if (!/^\d{14}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const dv = function (base) {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < pesos.length; i++) s += Number(base[i]) * pesos[i];
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]);
}
function cpfValido(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const dv = function (n) {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

// o documento como CHAVE: só dígitos, 14 (CNPJ) ou 11 (CPF); '' = sem documento
function docDe(v) {
  const d = digitos(v);
  if (!d || /^(\d)\1*$/.test(d)) return '';
  if (d.length === 14 || d.length === 11) return d;
  if (d.length === 12 || d.length === 13) { const p = d.padStart(14, '0'); if (cnpjValido(p)) return p; }
  if (d.length === 9 || d.length === 10) { const p = d.padStart(11, '0'); if (cpfValido(p)) return p; }
  return '';
}
function tipoDoc(d) { return d.length === 14 ? 'CNPJ' : d.length === 11 ? 'CPF' : ''; }
function docValido(d) { return d.length === 14 ? cnpjValido(d) : d.length === 11 ? cpfValido(d) : false; }
function mascara(d) {
  if (d.length === 14) return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12);
  if (d.length === 11) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
  return d;
}
// as grafias em que o documento pode estar GRAVADO (o OData do F&O e o SOQL
// só filtram texto por igualdade): com máscara, só dígitos, dígitos com o
// hífen do DV (o jeito do Dynamics) e sem os zeros da esquerda
function grafias(d) {
  const out = [mascara(d), d];
  if (d.length === 14 || d.length === 11) out.push(d.slice(0, -2) + '-' + d.slice(-2));
  const semZero = d.replace(/^0+/, '');
  if (semZero !== d && semZero.length > 2) out.push(semZero, semZero.slice(0, -2) + '-' + semZero.slice(-2));
  return out.filter(function (v, i, l) { return v && l.indexOf(v) === i; });
}

// ── texto ─────────────────────────────────────────────────────────
function txt(v, max) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function norm(s) { return txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function uniq(arr) { return arr.filter(function (v, i, l) { return v && l.indexOf(v) === i; }); }
function dataIso(v) { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || '')); return m ? m[1] : ''; }
function numero(v) { if (v == null || v === '') return null; const n = Number(v); return isNaN(n) ? null : n; }

const UFS = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE', 'distrito federal': 'DF',
  'espirito santo': 'ES', goias: 'GO', maranhao: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
  'minas gerais': 'MG', para: 'PA', paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI',
  'rio de janeiro': 'RJ', 'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO',
  roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO'
};
function ufDe(v) {
  const s = txt(v, 40);
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const m = /^([A-Za-z]{2})\s*-/.exec(s);          // "MG - Minas Gerais"
  if (m) return m[1].toUpperCase();
  return UFS[norm(s)] || s.toUpperCase().slice(0, 20);
}

// ══════════════════════════════════════════════════════════════════
// DYNAMICS — cada informação pelos nomes que ela tem nas entidades
// (CustomersV3 e, sem ela, CustTables — as mesmas da Cotação/Cobrança)
// ══════════════════════════════════════════════════════════════════
const D_ENTIDADES = lista(process.env.CARTEIRA_D365_ENTIDADE, ['CustomersV3', 'CustTables']);
const COL_D = {
  codigo:         ['CustomerAccount', 'AccountNum'],
  empresa:        ['dataAreaId'],
  nome:           ['OrganizationName', 'Name'],
  fantasia:       ['NameAlias', 'OrganizationAliasName', 'SearchName'],
  cnpj:           ['BrazilianCNPJOrCPF', 'CNPJCPFNum_BR', 'CNPJCPFNumber'],
  ie:             ['BrazilianStateInscription', 'StateInscription_BR', 'BrazilianIE', 'StateInscription'],
  grupo:          ['CustomerGroupId', 'CustGroup'],
  tipoParte:      ['PartyType'],
  cidade:         ['AddressCity', 'City'],
  uf:             ['AddressState', 'State', 'AddressStateId'],
  cep:            ['AddressZipCode', 'ZipCode'],
  rua:            ['AddressStreet', 'Street'],
  numero:         ['AddressStreetNumber', 'StreetNumber'],
  bairro:         ['AddressDistrictName', 'DistrictName', 'District'],
  endereco:       ['FullPrimaryAddress', 'AddressDescription'],
  email:          ['PrimaryContactEmail', 'Email'],
  telefone:       ['PrimaryContactPhone', 'Phone'],
  pagamento:      ['PaymentTerms', 'PaymTermId'],
  formaPagamento: ['PaymentMethod', 'PaymMode'],
  limiteCredito:  ['CreditLimit'],
  bloqueio:       ['OnHoldStatus', 'CustomerOnHoldStatus', 'Blocked'],
  vendedor:       ['EmployeeResponsibleNumber', 'SalesResponsiblePersonnelNumber'],
  comissao:       ['CommissionSalesGroupId', 'CommissionGroup'],
  segmento:       ['SalesSegmentId', 'SegmentId'],
  distrito:       ['SalesDistrict', 'SalesDistrictId']
};
// o que vem na carga da carteira inteira (a ficha lê a linha completa).
// E-mail, telefone, IE, CEP e endereço (18/11/2026) não vão para a tela:
// alimentam a busca por "tudo do cliente" (textoBusca / buscar)
const CAMPOS_D_LISTA = ['codigo', 'empresa', 'nome', 'fantasia', 'cnpj', 'grupo', 'cidade', 'uf', 'bloqueio', 'segmento',
  'ie', 'cep', 'rua', 'numero', 'bairro', 'email', 'telefone'];

// Segmento do cliente no Dynamics (SegmentId) = o tipo de cliente
const SEGMENTOS = { '1': 'Hospital Particular', '2': 'Órgão Público', '3': 'Convênio', '4': 'Distribuidor',
  '5': 'Pessoa Física', '6': 'Outros', '7': 'Fornecedor' };
function tipoSegmento(v) { const s = txt(v, 40); return SEGMENTOS[s.replace(/^0+(?=\d)/, '')] || ''; }

// resolve cada campo numa coluna real (sem repetir coluna entre campos)
function mapaColunas(cols, defs) {
  const baixo = {};
  cols.forEach(function (c) { baixo[String(c).toLowerCase()] = c; });
  const usadas = {}, mapa = {};
  Object.keys(defs).forEach(function (campo) {
    mapa[campo] = null;
    const cands = defs[campo] || [];
    for (let i = 0; i < cands.length; i++) {
      const real = baixo[String(cands[i]).toLowerCase()];
      if (real && !usadas[real]) { mapa[campo] = real; usadas[real] = 1; break; }
    }
  });
  return mapa;
}

// "No" / "Never" = livre; "All", "Invoice", "Payment"… = bloqueado para algo
function bloqueado(v) { const s = txt(v, 40); return !!s && !/^(no|never|none|nenhum|não|nao|0|false)$/i.test(s); }

function linhaD365(r, col) {
  const g = function (c) { return col[c] ? r[col[c]] : null; };
  const rua = txt(g('rua'), 160), num = txt(g('numero'), 20);
  return {
    codigo: txt(g('codigo'), 30).toUpperCase(),
    empresa: txt(g('empresa'), 10).toUpperCase(),
    nome: txt(g('nome'), 160),
    fantasia: txt(g('fantasia'), 120),
    doc: docDe(g('cnpj')),
    docBruto: txt(g('cnpj'), 30),
    ie: txt(g('ie'), 30),
    grupo: txt(g('grupo'), 30),
    tipoParte: txt(g('tipoParte'), 30),
    cidade: txt(g('cidade'), 80),
    uf: ufDe(g('uf')),
    cep: txt(g('cep'), 12),
    endereco: [rua, num].filter(Boolean).join(', ') || txt(g('endereco'), 200).split(/\n/)[0],
    bairro: txt(g('bairro'), 80),
    email: txt(g('email'), 200).toLowerCase(),
    telefone: txt(g('telefone'), 40),
    pagamento: txt(g('pagamento'), 60),
    formaPagamento: txt(g('formaPagamento'), 40),
    limiteCredito: numero(g('limiteCredito')),
    bloqueio: txt(g('bloqueio'), 40),
    bloqueado: bloqueado(g('bloqueio')),
    vendedor: txt(g('vendedor'), 40),
    comissao: txt(g('comissao'), 40),
    segmento: txt(g('segmento'), 40),
    tipo: tipoSegmento(g('segmento')),
    distrito: txt(g('distrito'), 40)
  };
}

function comPrazo(promessa, ms, rotulo) {
  let t;
  return Promise.race([
    promessa,
    new Promise(function (_, rej) { t = setTimeout(function () { rej(new Error(rotulo + ' não respondeu em ' + Math.round(ms / 1000) + ' s')); }, ms); })
  ]).finally(function () { clearTimeout(t); });
}

// a entidade de clientes que responde e as colunas dela (uma vez por instância)
let _entD = null;
async function entidadeD365(token) {
  if (_entD) return _entD;
  const sondas = [];
  let ultimo = null;
  for (const ent of D_ENTIDADES) {
    try {
      const rows = await D.odataGet(ent, { top: 1, crossCompany: true }, token);
      const cols = rows.length ? Object.keys(rows[0]).filter(function (k) { return k.charAt(0) !== '@'; }) : [];
      const col = mapaColunas(cols, COL_D);
      const pontos = Object.keys(col).filter(function (k) { return col[k]; }).length + (col.cnpj ? 10 : 0);
      sondas.push({ entidade: ent, col: col, pontos: pontos, serve: !!(col.codigo && col.nome) });
    } catch (e) { ultimo = e; }
  }
  const boas = sondas.filter(function (s) { return s.serve; }).sort(function (a, b) { return b.pontos - a.pontos; });
  if (!boas.length) throw ultimo || new Error('nenhuma entidade de clientes do Dynamics expõe código e nome');
  _entD = boas[0];
  return _entD;
}

async function carregarD365() {
  if (!D.CONFIGURED) return { configurado: false, linhas: [] };
  const t0 = Date.now();
  const token = await D.getToken();
  const E = await entidadeD365(token);
  const sel = uniq(CAMPOS_D_LISTA.map(function (c) { return E.col[c]; })).join(',');
  const opts = { select: sel, crossCompany: true };
  if (D_FILTRO) opts.filter = D_FILTRO;
  const rows = await D.odataGetAll(E.entidade, opts, token, D_MAXPG);
  return {
    configurado: true, entidade: E.entidade, ms: Date.now() - t0,
    colunas: E.col, semCnpj: !E.col.cnpj,
    linhas: rows.map(function (r) { return linhaD365(r, E.col); }).filter(function (l) { return l.codigo || l.doc; })
  };
}

// ══════════════════════════════════════════════════════════════════
// SALESFORCE — Account (org do CRM)
// ══════════════════════════════════════════════════════════════════
// a segunda linha (18/11/2026) é só para a busca por "tudo do cliente":
// não vai para a tela (textoBusca). Campo que a org não tem cai no describe.
const SF_LISTA = ['Id', 'Name', SF_CNPJ, SF_COD, 'Nome_Fantasia__c', 'Tipo_de_cliente__c', 'BillingCity', 'BillingState',
  'Unidade_de_Negocio__c', 'Ativo__c', 'Cliente_MSB__c', 'Rede_Hospitalar__c', 'ORGAOPUBLICO__c', 'Restri_o_Financeira__c',
  'LastActivityDate', 'LastModifiedDate',
  'Phone', 'Email__c', 'Website', 'BillingStreet', 'BillingPostalCode', 'Bairro_Principal__c', 'Inscr_Estadual__c', 'Inscr_Municipal__c',
  'Telefone_de_Entrega__c', 'Identificador__c', 'IDCFO__c', 'PersonEmail', 'PersonMobilePhone'];
const SF_DETALHE = SF_LISTA.concat(['Type', 'Industry', 'Pessoa_Fisica_ou_Juridica__c', 'Motivo_Restri_o_Financeira__c',
  'Faturamento_Potencial_Total__c', 'Valor_do_Ultimo_Lancamento__c', 'Ultimo_Documento__c', 'Opp_s__c', 'CreatedDate',
  'Rua_de_Entrega__c', 'Cidade_de_entrega__c', 'Estado_de_Entrega__c', 'CEP_de_Entrega__c', 'Telefone_de_Entrega__c', 'Description',
  'Usuario_Criacao__c']);
// relação → campo que precisa existir no Account para a relação valer
const SF_REL = { 'Owner.Name': 'OwnerId', 'Owner.Email': 'OwnerId', 'RecordType.Name': 'RecordTypeId', 'Parent.Name': 'ParentId' };

// campo sem permissão de leitura derruba a SOQL inteira: o describe diz o
// que existe e o resto cai em cascata (completo → sem relações → mínimo)
async function camposSf(lista, rels) {
  let existe = null;
  try {
    const desc = await SF.describe('Account');
    existe = new Set((desc.fields || []).map(function (f) { return String(f.name).toLowerCase(); }));
  } catch (e) { existe = null; }
  const tem = function (c) { return !existe || existe.has(String(c).toLowerCase()); };
  return {
    campos: uniq(lista.filter(tem)),
    rels: (rels || []).filter(function (r) { return tem(SF_REL[r]); })
  };
}

async function primeiraQueResponde(consultas, maxPages) {
  let ultimo = null;
  for (const q of consultas) {
    try { return await SF.soql(q, maxPages); } catch (e) { ultimo = e; }
  }
  throw ultimo;
}

function consultasConta(c, onde) {
  const base = c.campos.join(', ');
  const out = [];
  if (c.rels.length) out.push('SELECT ' + base + ', ' + c.rels.join(', ') + ' FROM Account WHERE ' + onde);
  out.push('SELECT ' + base + ' FROM Account WHERE ' + onde);
  out.push('SELECT ' + uniq(['Id', 'Name', SF_CNPJ, SF_COD]).join(', ') + ' FROM Account WHERE ' + onde);
  return out;
}

function boolOuNulo(v) { return v === true ? true : v === false ? false : null; }

function linhaSf(r) {
  const own = r.Owner || {};
  return {
    id: txt(r.Id, 18),
    nome: txt(r.Name, 255),
    fantasia: txt(r.Nome_Fantasia__c, 255),
    doc: docDe(r[SF_CNPJ]),
    docBruto: txt(r[SF_CNPJ], 30),
    codErp: txt(r[SF_COD], 30).toUpperCase(),
    tipo: txt(r.Tipo_de_cliente__c, 60),
    cidade: txt(r.BillingCity, 80),
    uf: ufDe(r.BillingState),
    unidade: txt(r.Unidade_de_Negocio__c, 60),
    ativo: boolOuNulo(r.Ativo__c),
    msb: r.Cliente_MSB__c === true,
    rede: txt(r.Rede_Hospitalar__c, 60),
    orgao: txt(r.ORGAOPUBLICO__c, 40),
    restricao: r.Restri_o_Financeira__c === true,
    dono: txt(own.Name, 120),
    donoEmail: txt(own.Email, 160).toLowerCase(),
    ultimaAtividade: dataIso(r.LastActivityDate),
    modificado: txt(r.LastModifiedDate, 30),
    // contato e endereço (a ficha mostra; a busca procura)
    telefone: txt(r.Phone, 40), email: txt(r.Email__c, 120).toLowerCase(), site: txt(r.Website, 200),
    endereco: txt(r.BillingStreet, 200), cep: txt(r.BillingPostalCode, 12), bairro: txt(r.Bairro_Principal__c, 80),
    ie: txt(r.Inscr_Estadual__c, 30), im: txt(r.Inscr_Municipal__c, 40), telefoneEntrega: txt(r.Telefone_de_Entrega__c, 40),
    identificador: txt(r.Identificador__c, 30), idcfo: txt(r.IDCFO__c, 40),
    emailPessoa: txt(r.PersonEmail, 120).toLowerCase(), celular: txt(r.PersonMobilePhone, 40)
  };
}

// os campos a mais da ficha (o que não entra na lista da carteira)
function detalheSf(r) {
  const l = linhaSf(r);
  return Object.assign(l, {
    tipoConta: txt(r.Type, 60), setor: txt(r.Industry, 60), registro: txt(r.RecordType && r.RecordType.Name, 80),
    pessoa: txt(r.Pessoa_Fisica_ou_Juridica__c, 20),
    motivoRestricao: txt(r.Motivo_Restri_o_Financeira__c, 600),
    potencial: numero(r.Faturamento_Potencial_Total__c), ultimoLancamento: numero(r.Valor_do_Ultimo_Lancamento__c),
    ultimoDocumento: txt(r.Ultimo_Documento__c, 60), nOportunidades: numero(r.Opp_s__c),
    criado: dataIso(r.CreatedDate), paiId: txt(r.ParentId, 18), paiNome: txt(r.Parent && r.Parent.Name, 160),
    entrega: [txt(r.Rua_de_Entrega__c, 160), txt(r.Cidade_de_entrega__c, 80), txt(r.Estado_de_Entrega__c, 2), txt(r.CEP_de_Entrega__c, 10)].filter(Boolean).join(' · '),
    // 19/11/2026: inteira e com as quebras de linha (a ficha inclui texto nela)
    descricao: String(r.Description == null ? '' : r.Description).replace(/\r\n?/g, '\n').trim().slice(0, 32000),
    criadoPor: txt(r.Usuario_Criacao__c, 120)
  });
}

async function carregarSf() {
  if (!SF.CONFIGURED) return { configurado: false, linhas: [] };
  const t0 = Date.now();
  const c = await camposSf(SF_LISTA, ['Owner.Name', 'Owner.Email']);
  let onde = SF_CNPJ + ' != null';
  if (SF_WHERE) onde += ' AND (' + SF_WHERE + ')';
  const rows = await primeiraQueResponde(consultasConta(c, onde), SF_MAXPG);
  return { configurado: true, ms: Date.now() - t0, campos: c.campos.concat(c.rels), linhas: rows.map(linhaSf) };
}

// ══════════════════════════════════════════════════════════════════
// CRUZAMENTO (puro — testado em scripts/test-carteira-clientes.js)
// ══════════════════════════════════════════════════════════════════
function chaveD(l) { return l.doc || (l.codigo ? 'D:' + l.codigo : ''); }
function chaveS(l) { return l.doc || (l.id ? 'S:' + l.id : ''); }

// ── o resto do cliente, para a busca (18/11/2026) ──────────────────
// Pedido do dono do portal: a busca da Carteira tem de achar o cliente por
// TUDO o que se sabe dele — e-mail, telefone, código… Fica aqui o que os
// dois cadastros sabem e a lista não mostra: e-mail, telefone, IE/IM, CEP,
// endereço, bairro, site, Identificador e IDCFO do SF, a razão social /
// fantasia / cidade do outro sistema (e das contas repetidas), o Código ERP
// e o Id dessas contas. Vai no blob, mas NÃO no pacote da tela (seriam MB a
// mais para 20 mil clientes): a tela pergunta ao servidor (?busca=, buscar).
// Formato enxuto: "<tipo><valor>|<tipo><valor>…", tipo = 1 letra de BUSCA_ROT.
const BUSCA_ROT = {
  n: 'Razão social', f: 'Nome fantasia', g: 'Cidade', e: 'E-mail', t: 'Telefone', i: 'Inscrição estadual',
  m: 'Inscrição municipal', c: 'CEP', a: 'Endereço', b: 'Bairro', w: 'Site', x: 'Identificador (CRM)', y: 'IDCFO (CRM)',
  o: 'Código ERP (outra conta do CRM)', s: 'Conta do CRM'
};
const BUSCA_NUM = 'tcimxyos';     // tipos que valem na busca só por números
function textoBusca(cli, d, s) {
  const itens = [], vistos = new Set();
  const naLista = new Set([normLivre(cli.nome), normLivre(cli.fantasia), normLivre(cli.cidade)]);
  const add = function (tipo, v) {
    v = txt(v, 160).replace(/\|/g, ' ').trim();
    if (!v) return;
    const n = normLivre(v);
    if ('nfg'.indexOf(tipo) >= 0 && naLista.has(n)) return;      // já está na linha da lista
    if (vistos.has(tipo + n)) return;
    vistos.add(tipo + n); itens.push(tipo + v);
  };
  const fone = function (v) { const x = digitos(v); if (x.length >= 8) add('t', x); };
  const cep = function (v) { const x = digitos(v); if (x.length >= 5) add('c', x); };
  (d || []).forEach(function (l) {
    add('n', l.nome); add('f', l.fantasia); add('g', l.cidade);
    add('e', l.email); fone(l.telefone); add('i', l.ie); cep(l.cep); add('a', l.endereco); add('b', l.bairro);
  });
  (s || []).forEach(function (l) {
    add('n', l.nome); add('f', l.fantasia); add('g', l.cidade);
    add('e', l.email); add('e', l.emailPessoa); fone(l.telefone); fone(l.celular); fone(l.telefoneEntrega);
    add('i', l.ie); add('m', l.im); cep(l.cep); add('a', l.endereco); add('b', l.bairro); add('w', l.site);
    add('x', l.identificador); add('y', l.idcfo);
    if (l.codErp && l.codErp !== cli.codErp) add('o', l.codErp);
    if (l.id && l.id !== cli.sfId) add('s', l.id);
  });
  return itens.join('|');
}
// norm sem o corte de 200 caracteres do txt (o texto da busca é longo)
function normLivre(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }

// UM cliente a partir das linhas de cada sistema com a mesma chave.
// `ctx.porCodigo` (código do Dynamics → chaves) acende as pendências do
// Código ERP de quem só está no Salesforce; sem ele elas ficam de fora.
function montarCliente(k, d, s, ctx) {
  ctx = ctx || {};
  const doc = /^\d+$/.test(k) ? k : '';
  const sit = d.length && s.length ? 'ambos' : d.length ? 'd365' : 'sf';
  // conta principal do SF: ativa primeiro, depois a mexida por último
  const sOrd = s.slice().sort(function (a, b) {
    return (b.ativo === true) - (a.ativo === true) || String(b.modificado || '').localeCompare(String(a.modificado || ''));
  });
  const sp = sOrd[0] || null;
  const dp = d.filter(function (x) { return x.empresa.toLowerCase() === EMPRESA_PREF; })[0] || d[0] || null;
  const codigos = uniq(d.map(function (x) { return x.codigo; }));
  const empresas = uniq(d.map(function (x) { return x.empresa; })).sort();

  const al = [];
  if (!doc) al.push('sem-doc');
  else if (!docValido(doc)) al.push('doc-invalido');
  if (sit === 'ambos') {
    const codsSf = uniq(s.map(function (x) { return x.codErp; }));
    if (!codsSf.length) al.push('sem-cod');
    else if (codsSf.some(function (c) { return codigos.indexOf(c) < 0; })) al.push('cod-diverge');
  }
  if (sit === 'sf' && ctx.porCodigo) {
    const cods = uniq(s.map(function (x) { return x.codErp; }));
    if (cods.some(function (c) { const ks = ctx.porCodigo.get(c); return ks && !ks.has(k); })) al.push('cod-outro');
    else if (cods.length && cods.every(function (c) { return !ctx.porCodigo.has(c); })) al.push('cod-orfao');
  }
  if (s.length > 1) al.push('sf-dup');
  const porEmp = {};
  d.forEach(function (x) { (porEmp[x.empresa] = porEmp[x.empresa] || new Set()).add(x.codigo); });
  if (Object.keys(porEmp).some(function (e) { return porEmp[e].size > 1; })) al.push('d365-dup');
  if (d.some(function (x) { return x.bloqueado; })) al.push('bloqueado');
  if (s.some(function (x) { return x.restricao; })) al.push('restricao');
  if (sp && sp.ativo === false) al.push('sf-inativa');

  const cli = {
    k: k, doc: doc, tipoDoc: tipoDoc(doc), raiz: doc.length === 14 ? doc.slice(0, 8) : '', sit: sit,
    // com cadastro no ERP vale o ERP; o Salesforce só completa
    nome: (dp && dp.nome) || (sp && sp.nome) || '',
    fantasia: (dp && dp.fantasia) || (sp && sp.fantasia) || '',
    uf: (dp && dp.uf) || (sp && sp.uf) || '',
    cidade: (dp && dp.cidade) || (sp && sp.cidade) || '',
    codigos: codigos, empresas: empresas,
    grupo: dp ? dp.grupo : '',
    bloq: d.some(function (x) { return x.bloqueado; }),
    sfId: sp ? sp.id : '', nSf: s.length,
    dono: sp ? sp.dono : '', donoEmail: sp ? sp.donoEmail : '',
    tipo: (dp && dp.tipo) || (sp ? sp.tipo : ''), unid: sp ? sp.unidade : '',
    ativo: sp ? sp.ativo : null, msb: s.some(function (x) { return x.msb; }),
    rede: sp ? sp.rede : '', orgao: sp ? sp.orgao : '',
    codErp: sp ? sp.codErp : '', ultAtiv: sp ? sp.ultimaAtividade : '',
    alertas: al
  };
  cli.busca = textoBusca(cli, d, s);
  return cli;
}

function cruzar(dLinhas, sLinhas, opts) {
  opts = opts || {};
  const fora = (opts.tiposFora || TIPOS_FORA).map(norm);
  const grupos = new Map();
  const porCodigo = new Map();
  const g = function (k) { let x = grupos.get(k); if (!x) { x = { d: [], s: [] }; grupos.set(k, x); } return x; };
  (dLinhas || []).forEach(function (l) {
    const k = chaveD(l); if (!k) return;
    g(k).d.push(l);
    if (l.codigo) { if (!porCodigo.has(l.codigo)) porCodigo.set(l.codigo, new Set()); porCodigo.get(l.codigo).add(k); }
  });
  (sLinhas || []).forEach(function (l) { const k = chaveS(l); if (k) g(k).s.push(l); });

  const clientes = [];
  let foraSf = 0;
  grupos.forEach(function (x, k) {
    // conta do SF de fornecedor (e só isso) que não é cliente no Dynamics: fora
    if (!x.d.length && fora.length && x.s.every(function (l) { return fora.indexOf(norm(l.tipo)) >= 0; })) { foraSf++; return; }
    clientes.push(montarCliente(k, x.d, x.s, { porCodigo: porCodigo }));
  });
  clientes.sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });

  const conta = function (f) { return clientes.filter(f).length; };
  const cadastro = function (c) { return c.alertas.some(function (a) { return ALERTAS[a] && ALERTAS[a].tipo === 'cadastro'; }); };
  return {
    clientes: clientes,
    porCodigo: porCodigo,
    resumo: {
      total: clientes.length,
      ambos: conta(function (c) { return c.sit === 'ambos'; }),
      d365: conta(function (c) { return c.sit === 'd365'; }),
      sf: conta(function (c) { return c.sit === 'sf'; }),
      pendencias: conta(cadastro),
      foraSf: foraSf,
      tiposFora: opts.tiposFora || TIPOS_FORA,
      linhasD365: (dLinhas || []).length,
      linhasSf: (sLinhas || []).length
    }
  };
}

// ── transporte enxuto: colunas + dicionário para o que se repete ──
// (~20 mil clientes; dono, cidade, tipo… viram índices)
const COLS = ['k', 'doc', 'sit', 'nome', 'fantasia', 'uf', 'cidade', 'codigos', 'empresas', 'grupo', 'bloq', 'sfId', 'nSf',
  'dono', 'donoEmail', 'tipo', 'unid', 'ativo', 'msb', 'rede', 'orgao', 'codErp', 'ultAtiv', 'alertas'];
const DIC = { sit: 1, uf: 1, cidade: 1, empresas: 1, grupo: 1, dono: 1, donoEmail: 1, tipo: 1, unid: 1, rede: 1, orgao: 1 };
function compactar(clientes) {
  const dic = {}, idx = {};
  Object.keys(DIC).forEach(function (c) { dic[c] = []; idx[c] = new Map(); });
  const rows = clientes.map(function (cl) {
    return COLS.map(function (c) {
      let v = cl[c];
      if (c === 'k') return v === cl.doc ? '' : v;      // a chave quase sempre é o próprio documento
      if (c === 'codigos') return (v || []).join(' · ');
      if (c === 'empresas') v = (v || []).join(' · ');
      if (DIC[c]) {
        if (v == null || v === '') return -1;
        let i = idx[c].get(v);
        if (i == null) { i = dic[c].length; dic[c].push(v); idx[c].set(v, i); }
        return i;
      }
      if (v === true) return 1;
      if (v === false) return 0;
      return v == null ? '' : v;
    });
  });
  return { cols: COLS, dic: dic, rows: rows };
}

// ══════════════════════════════════════════════════════════════════
// BASE EM CACHE + carga em segundo plano
// ══════════════════════════════════════════════════════════════════
let _base = null, _carga = null, _cargaDesde = 0, _erro = null;
let _frio = null, _blobVisto = false, _atualizando = null;
let _blob = { lido: null, gravado: null, erro: null };
// contas criadas pelo portal nesta instância (doc → { ts, cliente }): uma base
// que chega depois (carga das fontes lida antes da criação, blob de outra
// instância) não pode "desfazer" a conta nova na lista — aplicarCriadas()
let _criadas = new Map();

// 19/11/2026: na tela o Salesforce se chama "CRM" — inclusive nos erros que vêm de shared/salesforce.js
function erroCurto(e) { return txt(e && e.message ? e.message : e, 240).replace(/Salesforce|\bSF\b/g, 'CRM'); }

// a base em memória a partir dos clientes montados — a mesma para a carga
// das fontes e para o blob (os índices não vão para o blob: refazê-los
// custa menos que guardá-los)
function montarBase(m, clientes, origem) {
  const porChave = new Map(), porRaiz = new Map(), porCodigo = new Map();
  clientes.forEach(function (c) {
    porChave.set(c.k, c);
    if (c.raiz) { if (!porRaiz.has(c.raiz)) porRaiz.set(c.raiz, []); porRaiz.get(c.raiz).push(c); }
    // código do Dynamics → chaves: o mesmo mapa do cruzar (todo grupo com
    // linha do Dynamics vira cliente, e c.codigos são os códigos dessas linhas)
    (c.codigos || []).forEach(function (cod) { if (!porCodigo.has(cod)) porCodigo.set(cod, new Set()); porCodigo.get(cod).add(c.k); });
  });
  return {
    ts: m.ts, desde: m.desde || null, geradoEm: m.geradoEm, msCarga: m.msCarga, parcial: m.parcial, fontes: m.fontes, origem: origem,
    clientes: clientes, resumo: m.resumo, porChave: porChave, porRaiz: porRaiz, porCodigo: porCodigo,
    pacote: compactar(clientes)
  };
}

// ── a carteira montada no blob ────────────────────────────────────
// URL do blob dentro do container da SAS. A SAS do Radar aponta para um
// arquivo (.../<container>/lici-radar.json?sas): o container é a pasta dele.
// `nome` (18/11/2026): outro arquivo na mesma pasta — o registro dos pedidos
// de cadastro no ERP (carteira-erp.js). Com SAS de um blob só não dá: ''.
function urlBlob(nome) {
  if (!BLOB_SAS) return '';
  const q = BLOB_SAS.indexOf('?');
  let base = (q < 0 ? BLOB_SAS : BLOB_SAS.slice(0, q)).replace(/\/+$/, '');
  const sas = q < 0 ? '' : BLOB_SAS.slice(q);
  const arquivo = (base.split('/').pop() || '').indexOf('.') >= 0;
  if (BLOB_PROPRIO && arquivo) return nome ? '' : BLOB_SAS;     // SAS do próprio blob
  if (arquivo) base = base.replace(/\/[^/]+$/, '');
  return base + '/' + (BLOB_PROPRIO ? '' : 'carteira-clientes/') + (nome || 'carteira.json.gz') + sas;
}

// null = não tem (ou é de outro formato); erro lança
async function lerBlob() {
  const ctl = new AbortController();
  const t = setTimeout(function () { ctl.abort(); }, BLOB_PRAZO_MS);
  try {
    const r = await fetch(urlBlob(), { headers: { 'x-ms-version': '2021-08-06' }, signal: ctl.signal });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('blob GET ' + r.status);
    const j = JSON.parse(zlib.gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8'));
    if (!j || !(j.versao >= BLOB_VERSAO_MIN && j.versao <= BLOB_VERSAO) || !j.ts || !Array.isArray(j.clientes)) return null;
    if (j.versao < BLOB_VERSAO) j.ts = 1;     // formato anterior: abre, mas recarrega por trás
    return j;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('o blob não respondeu em ' + Math.round(BLOB_PRAZO_MS / 1000) + ' s');
    throw e;
  } finally { clearTimeout(t); }
}

// a última carteira montada (null = não tem, não deu ou blob desligado)
async function doBlob() {
  if (!urlBlob()) return null;
  try {
    const j = await lerBlob();
    _blob.lido = j ? j.geradoEm : null; _blob.erro = null;
    return j;
  } catch (e) { _blob.erro = erroCurto(e); return null; }
}

async function gravarBlob(b) {
  if (!urlBlob()) return;
  const corpo = zlib.gzipSync(JSON.stringify({
    versao: BLOB_VERSAO, ts: b.ts, desde: b.desde, geradoEm: b.geradoEm, msCarga: b.msCarga, parcial: b.parcial,
    fontes: b.fontes, resumo: b.resumo, clientes: b.clientes
  }));
  const r = await fetch(urlBlob(), {
    method: 'PUT',
    headers: { 'x-ms-blob-type': 'BlockBlob', 'x-ms-version': '2021-08-06', 'Content-Type': 'application/gzip' },
    body: corpo
  });
  if (!r.ok) throw new Error('blob PUT ' + r.status);
}

function carregar() {
  if (_carga) return _carga;
  _cargaDesde = Date.now();
  const p = (async function () {
    const r = await Promise.allSettled([
      comPrazo(carregarD365(), CARGA_MAX_MS, 'o Dynamics'),
      comPrazo(carregarSf(), CARGA_MAX_MS, 'o CRM')
    ]);
    const d = r[0].status === 'fulfilled' ? r[0].value : null;
    const s = r[1].status === 'fulfilled' ? r[1].value : null;
    if ((!d || !d.configurado) && (!s || !s.configurado)) {
      if (!d && !s) throw new Error('Dynamics: ' + erroCurto(r[0].reason) + ' · CRM: ' + erroCurto(r[1].reason));
      const e = new Error('nenhuma das fontes está configurada'); e.naoConfigurado = true; throw e;
    }
    const fontes = {
      d365: d ? { ok: d.configurado, configurado: d.configurado, entidade: d.entidade || null, linhas: d.linhas.length, ms: d.ms || 0, semCnpj: !!d.semCnpj, colunas: d.colunas || null }
              : { ok: false, configurado: D.CONFIGURED, erro: erroCurto(r[0].reason) },
      sf: s ? { ok: s.configurado, configurado: s.configurado, linhas: s.linhas.length, ms: s.ms || 0, campos: s.campos || null }
            : { ok: false, configurado: SF.CONFIGURED, erro: erroCurto(r[1].reason) }
    };
    const x = cruzar(d ? d.linhas : [], s ? s.linhas : []);
    return aplicarCriadas(montarBase({
      ts: Date.now(), desde: _cargaDesde, geradoEm: new Date().toISOString(), msCarga: Date.now() - _cargaDesde,
      parcial: !(fontes.d365.ok && fontes.sf.ok), fontes: fontes, resumo: x.resumo
    }, x.clientes, 'fontes'));
  })();
  _carga = p;
  p.then(function (b) {
    _base = b; _erro = null;
    // só a carga completa vai para o blob: a parcial não apaga a última boa
    if (!b.parcial) gravarBlob(b).then(function () { _blob.gravado = b.geradoEm; }, function (e) { _blob.erro = erroCurto(e); });
  }, function (e) { _erro = { em: Date.now(), e: e }; })
    .then(function () { if (_carga === p) _carga = null; });
  return p;
}

// base vencida: outra instância pode já ter recarregado (o blob mais novo
// poupa as duas fontes); senão, a carga das fontes, por trás
function atualizar(forcar) {
  if (_carga || _atualizando) return;
  const p = (async function () {
    if (!forcar) {
      const j = await doBlob();
      if (j && _base && j.ts > _base.ts && Date.now() - j.ts < CACHE_MIN * 60000) { _base = aplicarCriadas(montarBase(j, j.clientes, 'blob')); return; }
    }
    await carregar();
  })();
  _atualizando = p;
  p.catch(function () { }).then(function () { if (_atualizando === p) _atualizando = null; });
}

function dorme(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// { base, atualizando } | { carregando: true, desde } — erro lança
async function obterBase(o) {
  o = o || {};
  // instância fria: a última carteira montada, do blob (uma leitura só,
  // para todos que chegarem juntos), em vez de esperar as duas fontes
  if (!_base && !_blobVisto) {
    if (!_frio) {
      _frio = doBlob().then(function (j) { if (j && !_base) _base = aplicarCriadas(montarBase(j, j.clientes, 'blob')); })
        .catch(function (e) { _blob.erro = erroCurto(e); })
        .then(function () { _blobVisto = true; _frio = null; });
    }
    await _frio;
  }
  const agora = Date.now();
  if (_base) {
    const ttl = (_base.parcial ? CACHE_PARCIAL_MIN : CACHE_MIN) * 60000;
    if (o.forcar || agora - _base.ts >= ttl) atualizar(!!o.forcar);
    return { base: _base, atualizando: !!(_carga || _atualizando) };
  }
  // falhou há pouco e ninguém pediu de novo: não martela as duas fontes
  if (_erro && !_carga && !o.forcar && agora - _erro.em < 30000) throw _erro.e;
  const p = carregar();
  const prazo = o.prazoMs != null ? o.prazoMs : PRAZO_MS;
  const r = await Promise.race([
    p.then(function (b) { return { base: b }; }, function (e) { return { erro: e }; }),
    dorme(prazo).then(function () { return null; })
  ]);
  if (!r) return { carregando: true, desde: new Date(_cargaDesde).toISOString() };
  if (r.erro) throw r.erro;
  return { base: r.base, atualizando: false };
}

function baseAtual() { return _base; }

// ── conta criada pelo portal (06/11/2026) ─────────────────────────
// A carteira em cache tem até 6 h: sem isto, a conta nova só apareceria na
// lista na próxima carga. registrarConta relê o cliente nas duas fontes,
// monta a linha como o cruzamento montaria e a põe na base (e no blob, para
// a instância fria também ver). Base que chega depois e foi LIDA antes da
// criação (carga que começou antes, blob de outra instância) recebe a linha
// de novo em aplicarCriadas; a que começou depois já traz a conta.
function resumoDe(clientes, antigo) {
  const conta = function (f) { return clientes.filter(f).length; };
  return Object.assign({}, antigo || {}, {
    total: clientes.length,
    ambos: conta(function (c) { return c.sit === 'ambos'; }),
    d365: conta(function (c) { return c.sit === 'd365'; }),
    sf: conta(function (c) { return c.sit === 'sf'; }),
    pendencias: conta(function (c) { return c.alertas.some(function (a) { return ALERTAS[a] && ALERTAS[a].tipo === 'cadastro'; }); })
  });
}
function aplicarCriadas(b) {
  if (!b || !_criadas.size) return b;
  const inicio = b.desde || (b.ts - (b.msCarga || 0));
  const pend = [];
  _criadas.forEach(function (x, doc) {
    if (inicio > x.ts) _criadas.delete(doc);      // a base foi lida depois: já traz a conta
    else pend.push(x.cliente);
  });
  if (!pend.length) return b;
  const porK = new Map();
  b.clientes.forEach(function (c) { porK.set(c.k, c); });
  pend.forEach(function (c) { porK.set(c.k, c); });
  const clientes = Array.from(porK.values()).sort(function (a, c) { return a.nome.localeCompare(c.nome, 'pt-BR'); });
  return montarBase({ ts: b.ts, desde: b.desde, geradoEm: b.geradoEm, msCarga: b.msCarga, parcial: b.parcial, fontes: b.fontes,
    resumo: resumoDe(clientes, b.resumo) }, clientes, b.origem);
}
// o cliente montado (o mesmo formato da lista) ou null quando não deu para
// reler as duas fontes — aí a conta aparece na lista na próxima carga
async function registrarConta(doc) {
  const ch = { tipo: 'doc', valor: doc, k: doc };
  const par = await Promise.all([
    comPrazo(fichaD365(ch), 15000, 'o Dynamics').catch(function () { return null; }),
    comPrazo(fichaSf(ch), 15000, 'o CRM').catch(function () { return null; })
  ]);
  const d = par[0], s = par[1];
  if (!d || !d.ok || !s || !s.ok || !(s.contas || []).length) return null;
  const cliente = montarCliente(doc, d.linhas || [], s.contas, _base ? { porCodigo: _base.porCodigo } : {});
  _criadas.set(doc, { ts: Date.now(), cliente: cliente });
  if (!_base) { try { await obterBase({ prazoMs: 2500 }); } catch (e) { /* a lista chega depois */ } }
  if (_base) {
    _base = aplicarCriadas(_base);
    if (!_base.parcial) gravarBlob(_base).then(function () { _blob.gravado = _base.geradoEm; }, function (e) { _blob.erro = erroCurto(e); });
  }
  return cliente;
}

// o estado do blob para o ?diag=1 (sem a SAS)
function estadoBlob() {
  return {
    configurado: !!urlBlob(), proprio: !!BLOB_PROPRIO, origemDaBase: _base ? _base.origem : null,
    lido: _blob.lido, gravado: _blob.gravado, erro: _blob.erro
  };
}

// ══════════════════════════════════════════════════════════════════
// BUSCA POR TUDO DO CLIENTE (18/11/2026) — GET ?busca=<termo>
// ══════════════════════════════════════════════════════════════════
// A tela procura sozinha no que a lista tem (nome, fantasia, CNPJ, códigos,
// cidade, UF, rede); aqui vem o resto:
//   1. o que os dois cadastros sabem e a lista não leva (textoBusca:
//      e-mail, telefone, IE, CEP, endereço, Identificador…), na carteira
//      em memória;
//   2. o Salesforce por SOSL, em qualquer campo: CONTATOS (nome, e-mail,
//      telefone, celular), a conta (descrição e o resto) e oportunidades /
//      cotações do Comercial — a negociação da Licitação não, como na ficha.
// Devolve só a chave de cada cliente e ONDE achou ("E-mail: compras@…",
// "Contato: Ana Souza · ana@…"); a tela junta com o que ela já achou.
const BUSCA_MAX      = Number(process.env.CARTEIRA_BUSCA_MAX || 1000);
const BUSCA_SF       = String(process.env.CARTEIRA_BUSCA_SF || '1') !== '0';
const BUSCA_CACHE_MS = 2 * 60000;
let _buscaCache = new Map();

function fFone(d) {
  if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
  return d;
}
function mostrarItem(tipo, v) {
  if (tipo === 't') return fFone(v);
  if (tipo === 'c' && v.length === 8) return v.slice(0, 5) + '-' + v.slice(5);
  return v;
}

// o termo: palavras (sem acento, caixa baixa, em qualquer ordem) ou só
// números — CNPJ, telefone, CEP, IE, com ou sem máscara
function lerTermo(termo) {
  const bruto = txt(termo, 120);
  const dig = digitos(bruto);
  const soNumero = !!dig && dig.length === bruto.replace(/[\s.\-/()+]/g, '').length;
  // telefone colado com o +55 do país
  const digs = soNumero ? ((dig.length === 12 || dig.length === 13) && dig.slice(0, 2) === '55' ? [dig, dig.slice(2)] : [dig]) : [];
  return { bruto: bruto, soNumero: soNumero, dig: dig, digs: digs, palavras: soNumero ? [] : palavrasDe(normLivre(bruto)) };
}
// pontuação em volta da palavra não conta ("(sp)", "silva,"); @ . - _ / no
// meio ficam (e-mail, site, PER-0001, código)
function palavrasDe(s) {
  return String(s || '').split(' ').map(function (p) { return p.replace(/^[()[\]{},;:"'!?]+|[()[\]{},;:"'!?]+$/g, ''); }).filter(Boolean);
}
function termoCurto(t) { return t.soNumero ? t.dig.length < 4 : t.palavras.join('').replace(/[^a-z0-9@]/g, '').length < 3; }

// o índice da base, montado na primeira busca (a base nova monta o dela)
function indiceBusca(b) {
  if (b._busca) return b._busca;
  const porSf = new Map();
  const idx = b.clientes.map(function (c) {
    const itens = String(c.busca || '').split('|').filter(Boolean).map(function (x) { return { t: x.charAt(0), v: x.slice(1) }; });
    if (c.sfId) porSf.set(c.sfId, c.k);
    itens.forEach(function (it) { if (it.t === 's') porSf.set(it.v, c.k); });
    // cada número separado por espaço: o termo não "casa" emendando dois campos.
    // tl/dl = o que a LINHA da lista mostra (a tela acha sozinha)
    const numsL = [c.doc, c.codErp].concat(c.codigos || []).map(digitos).filter(Boolean);
    const nums = numsL.concat(itens.filter(function (it) { return BUSCA_NUM.indexOf(it.t) >= 0; }).map(function (it) { return digitos(it.v); })).filter(Boolean);
    const tl = normLivre([c.nome, c.fantasia, c.cidade, c.uf, c.doc, (c.codigos || []).join(' '), c.codErp, c.sfId, c.rede].join(' '));
    return {
      c: c, itens: itens, d: ' ' + nums.join(' '), dl: ' ' + numsL.join(' '), tl: tl,
      t: tl + ' ' + normLivre(itens.map(function (it) { return it.v; }).join(' '))
    };
  });
  b._busca = { idx: idx, porSf: porSf };
  return b._busca;
}
// `faltam` = as palavras que a linha da lista não explica
function casaItem(it, t, faltam) {
  if (t.soNumero) { const d = digitos(it.v); return BUSCA_NUM.indexOf(it.t) >= 0 && t.digs.some(function (x) { return d.indexOf(x) >= 0; }); }
  const n = normLivre(it.v);
  return faltam.some(function (p) { return n.indexOf(p) >= 0; });
}
function buscarNaBase(b, t) {
  const I = indiceBusca(b), out = [];
  let mais = false;
  for (let i = 0; i < I.idx.length; i++) {
    const x = I.idx[i];
    let faltam = [];
    if (t.soNumero) {
      if (!t.digs.some(function (d) { return x.d.indexOf(d) >= 0; })) continue;
      if (t.digs.some(function (d) { return x.dl.indexOf(d) >= 0; })) continue;     // CNPJ/código: a tela acha sozinha
    } else {
      if (!t.palavras.every(function (p) { return x.t.indexOf(p) >= 0; })) continue;
      faltam = t.palavras.filter(function (p) { return x.tl.indexOf(p) < 0; });
      if (!faltam.length) continue;          // tudo no que a linha mostra: a tela acha sozinha
    }
    const onde = x.itens.filter(function (it) { return casaItem(it, t, faltam); }).slice(0, 2)
      .map(function (it) { return { rot: BUSCA_ROT[it.t] || '', val: mostrarItem(it.t, it.v) }; });
    if (!onde.length) continue;
    if (out.length >= BUSCA_MAX) { mais = true; break; }
    out.push({ k: x.c.k, onde: onde });
  }
  return { achados: out, mais: mais };
}

// SOSL: as palavras como vieram (o SF ignora acento e caixa), os caracteres
// reservados escapados e a última palavra como prefixo (busca enquanto digita)
// (palavra de 1 letra fica de fora: o SOSL recusa); AND explícito entre elas
function soslDe(t) {
  const pal = (t.soNumero ? [t.digs[t.digs.length - 1]] : palavrasDe(t.bruto))
    .filter(function (p) { return p.length >= 2 && /[0-9A-Za-zÀ-ÿ]/.test(p); });
  if (!pal.length) return '';
  const esc = pal.map(function (p) { return p.replace(/[?&|!{}[\]()^~*:\\"'+\-]/g, '\\$&'); });
  if (pal[pal.length - 1].length >= 3) esc[esc.length - 1] += '*';
  return esc.join(' AND ');
}
async function buscarSf(t, b) {
  const termo = soslDe(t);
  if (!termo) return [];
  const consulta = function (comRelacao) {
    return 'FIND {' + termo + '} IN ALL FIELDS RETURNING ' + [
      'Contact(Id, Name, Email, Phone, MobilePhone, AccountId' + (comRelacao ? ', Account.' + SF_CNPJ : '') + ' WHERE AccountId != null LIMIT 100)',
      'Account(Id, Name, ' + SF_CNPJ + ' LIMIT 100)'
    ].concat(comRelacao ? ['Opportunity(Id, Name, AccountId, RecordType.DeveloperName WHERE AccountId != null LIMIT 60)'] : []).join(', ');
  };
  let recs;
  // sem as relações, a oportunidade fica de fora: sem o tipo de registro não
  // dá para tirar a negociação da Licitação
  try { recs = await SF.search(consulta(true)); } catch (e) { recs = await SF.search(consulta(false)); }
  const I = b ? indiceBusca(b) : null;
  const chaveDe = function (accId, cnpj) {
    if (I && I.porSf.has(accId)) return I.porSf.get(accId);
    const doc = docDe(cnpj);
    if (b) return doc && b.porChave.has(doc) ? doc : null;      // fornecedor fora da carteira etc.
    return doc || (accId ? 'S:' + accId : null);
  };
  const tiposOpp = TIPOS_OPORTUNIDADE.map(function (x) { return x.toLowerCase(); });
  const casa = function (v, todas) {
    if (!v) return false;
    if (t.soNumero) { const d = digitos(v); return t.digs.some(function (x) { return d.indexOf(x) >= 0; }); }
    const n = normLivre(v), f = function (p) { return n.indexOf(p) >= 0; };
    return todas ? t.palavras.every(f) : t.palavras.some(f);
  };
  const out = [];
  (recs || []).forEach(function (r) {
    const tipo = r.attributes && r.attributes.type;
    if (tipo === 'Contact') {
      const k = chaveDe(r.AccountId, r.Account && r.Account[SF_CNPJ]);
      if (!k) return;
      const extras = [txt(r.Email, 120).toLowerCase(), txt(r.Phone, 40), txt(r.MobilePhone, 40)].filter(casa);
      const val = [txt(r.Name, 120)].concat(extras.length ? extras : [txt(r.Email, 120).toLowerCase()]).filter(Boolean).join(' · ');
      out.push({ k: k, onde: { rot: 'Contato', val: val } });
    } else if (tipo === 'Opportunity') {
      const rt = String((r.RecordType && r.RecordType.DeveloperName) || '').toLowerCase();
      if (tiposOpp.indexOf(rt) < 0) return;
      const k = chaveDe(r.AccountId, null);
      if (k) out.push({ k: k, onde: { rot: 'Oportunidade', val: txt(r.Name, 160) } });
    } else if (tipo === 'Account') {
      if (casa(r.Name + ' ' + r[SF_CNPJ], true)) return;     // achou pelo nome: a tela acha sozinha
      const k = chaveDe(r.Id, r[SF_CNPJ]);
      if (k) out.push({ k: k, conta: true, onde: { rot: 'CRM', val: 'outro campo da conta (descrição, observações…)' } });
    }
  });
  return out;
}

// { ok, termo, achados: [{ k, onde: [{ rot, val }] }], mais, base, sf: { ok, ligado, erro? } }
async function buscar(termo, logErro) {
  const t = lerTermo(termo);
  if (termoCurto(t)) return { ok: true, termo: t.bruto, curto: true, achados: [], mais: false };
  const chave = t.soNumero ? '#' + t.dig : t.palavras.join(' ');
  const tsBase = _base ? _base.ts : 0;
  const c0 = _buscaCache.get(chave);
  if (c0 && Date.now() - c0.em < BUSCA_CACHE_MS && c0.ts === tsBase) return c0.r;

  let b = _base;
  if (!b) { try { b = (await obterBase({ prazoMs: 3000 })).base || null; } catch (e) { b = null; } }
  const porK = new Map();
  const junta = function (k, onde, soSeVazio) {
    let l = porK.get(k);
    if (!l) { l = []; porK.set(k, l); }
    if (soSeVazio && l.length) return;
    if (l.length < 3 && !l.some(function (o) { return o.rot === onde.rot && o.val === onde.val; })) l.push(onde);
  };
  let mais = false;
  if (b) {
    const r1 = buscarNaBase(b, t);
    mais = r1.mais;
    r1.achados.forEach(function (a) { a.onde.forEach(function (o) { junta(a.k, o); }); });
  }
  let sf = { ok: true, ligado: BUSCA_SF && !!SF.CONFIGURED };
  if (sf.ligado) {
    try {
      const r2 = await comPrazo(buscarSf(t, b), 12000, 'o CRM');
      r2.filter(function (a) { return !a.conta; }).forEach(function (a) { junta(a.k, a.onde); });
      // a conta achada "em outro campo" só explica quem não tem nada melhor
      r2.filter(function (a) { return a.conta; }).forEach(function (a) { junta(a.k, a.onde, true); });
    } catch (e) {
      if (logErro) logErro('busca-sf', e);
      sf = { ok: false, ligado: true, erro: erroCurto(e) };
    }
  }
  const achados = [];
  porK.forEach(function (onde, k) { achados.push({ k: k, onde: onde }); });
  const r = { ok: true, termo: t.bruto, base: !!b, achados: achados, mais: mais, sf: sf };
  if (sf.ok) {
    _buscaCache.set(chave, { em: Date.now(), ts: b ? b.ts : 0, r: r });
    if (_buscaCache.size > 100) _buscaCache.delete(_buscaCache.keys().next().value);
  }
  return r;
}

// ══════════════════════════════════════════════════════════════════
// FICHA de um cliente — direto nas fontes, pelo CNPJ (ou código / Id)
// ══════════════════════════════════════════════════════════════════
// chave: 14/11 dígitos (com ou sem máscara) | "D:<código do Dynamics>" | "S:<Id da conta>"
function lerChave(v) {
  const s = txt(v, 60);
  const m = /^([DS]):(.+)$/i.exec(s);
  if (m) {
    const val = m[2].trim();
    if (m[1].toUpperCase() === 'D' && /^[A-Za-z0-9._-]{1,30}$/.test(val)) return { tipo: 'codigo', valor: val.toUpperCase(), k: 'D:' + val.toUpperCase() };
    if (m[1].toUpperCase() === 'S' && /^[A-Za-z0-9]{15,18}$/.test(val)) return { tipo: 'sf', valor: val, k: 'S:' + val };
    return null;
  }
  const d = docDe(s);
  return d ? { tipo: 'doc', valor: d, k: d } : null;
}

async function fichaD365(ch) {
  if (!D.CONFIGURED) return { ok: false, configurado: false, linhas: [] };
  const token = await D.getToken();
  const E = await entidadeD365(token);
  let filtro;
  if (ch.tipo === 'doc') {
    if (!E.col.cnpj) return { ok: false, configurado: true, linhas: [], erro: 'a entidade de clientes do Dynamics não expõe o CNPJ' };
    filtro = grafias(ch.valor).map(function (v) { return E.col.cnpj + " eq '" + D.odataStr(v) + "'"; }).join(' or ');
  } else if (ch.tipo === 'codigo') {
    filtro = E.col.codigo + " eq '" + D.odataStr(ch.valor) + "'";
  } else return { ok: true, configurado: true, linhas: [], entidade: E.entidade };
  const rows = await D.odataGetComPrazo(E.entidade, { filter: filtro, crossCompany: true, top: 50 }, token, 15000);
  // a linha vem INTEIRA (sem $select): resolve as colunas da ficha nela
  const col = rows.length ? mapaColunas(Object.keys(rows[0]), COL_D) : E.col;
  const linhas = rows.map(function (r) { return linhaD365(r, col); })
    .sort(function (a, b) { return (b.empresa.toLowerCase() === EMPRESA_PREF) - (a.empresa.toLowerCase() === EMPRESA_PREF) || a.empresa.localeCompare(b.empresa); });
  return { ok: true, configurado: true, entidade: E.entidade, linhas: linhas };
}

async function fichaSf(ch, d365) {
  if (!SF.CONFIGURED) return { ok: false, configurado: false, contas: [] };
  const c = await camposSf(SF_DETALHE, ['Owner.Name', 'Owner.Email', 'RecordType.Name', 'Parent.Name']);
  let onde;
  if (ch.tipo === 'sf') onde = "Id = '" + SF.soqlStr(ch.valor) + "'";
  else if (ch.tipo === 'doc') onde = SF_CNPJ + ' IN (' + grafias(ch.valor).map(function (v) { return "'" + SF.soqlStr(v) + "'"; }).join(',') + ')';
  else {
    // cliente do Dynamics sem CNPJ: a conta do SF só se acha pelo Código ERP
    const cods = uniq([ch.valor].concat((d365 || []).map(function (l) { return l.codigo; })));
    onde = SF_COD + ' IN (' + cods.map(function (v) { return "'" + SF.soqlStr(v) + "'"; }).join(',') + ')';
  }
  const rows = await primeiraQueResponde(consultasConta(c, onde + ' LIMIT 10'));
  let instance = null;
  try { instance = (await SF.getToken()).instance || null; } catch (e) { instance = null; }
  return { ok: true, configurado: true, contas: rows.map(detalheSf), instance: instance };
}

function inLista(ids) { return '(' + ids.map(function (v) { return "'" + SF.soqlStr(v) + "'"; }).join(',') + ')'; }

async function fichaOportunidades(ids) {
  const tipos = inLista(TIPOS_OPORTUNIDADE);
  const onde = ' FROM Opportunity WHERE AccountId IN ' + inLista(ids) + ' AND RecordType.DeveloperName IN ' + tipos;
  const base = 'SELECT Id, Name, StageName, Amount, CreatedDate, CloseDate, LastStageChangeInDays, RecordType.Name';
  const abertas = await primeiraQueResponde([
    base + ', Owner.Name, Vendedor_Representante__r.Name' + onde + ' AND IsClosed = false ORDER BY Amount DESC NULLS LAST LIMIT 100',
    base + ', Owner.Name' + onde + ' AND IsClosed = false ORDER BY Amount DESC NULLS LAST LIMIT 100',
    base + onde + ' AND IsClosed = false ORDER BY Amount DESC NULLS LAST LIMIT 100'
  ]);
  let fechadas = null;
  try {
    const ag = await SF.soql('SELECT IsWon, COUNT(Id) n, SUM(Amount) v' + onde +
      ' AND IsClosed = true AND CloseDate = LAST_N_DAYS:365 GROUP BY IsWon');
    fechadas = { ganhas: { n: 0, v: 0 }, perdidas: { n: 0, v: 0 } };
    ag.forEach(function (r) {
      const alvo = r.IsWon === true ? fechadas.ganhas : fechadas.perdidas;
      alvo.n += Number(r.n) || 0; alvo.v += Number(r.v) || 0;
    });
  } catch (e) { fechadas = null; }
  return {
    ok: true,
    abertas: abertas.map(function (r) {
      const vend = (r.Vendedor_Representante__r && r.Vendedor_Representante__r.Name) || (r.Owner && r.Owner.Name) || '';
      return {
        id: r.Id, nome: txt(r.Name, 200), fase: txt(r.StageName, 80), tipo: txt(r.RecordType && r.RecordType.Name, 60),
        valor: Number(r.Amount) || 0, criacao: dataIso(r.CreatedDate), fechamento: dataIso(r.CloseDate),
        diasNaFase: r.LastStageChangeInDays == null ? null : Number(r.LastStageChangeInDays), vend: txt(vend, 120)
      };
    }),
    fechadas12m: fechadas
  };
}

// cargo e departamento: as LISTAS da org (Cargo__c, Tipo_de_Contato__c —
// 99,7% preenchidas); Title/Department (texto, quase vazios) são a reserva
async function fichaContatos(ids) {
  const onde = ' FROM Contact WHERE AccountId IN ' + inLista(ids) + ' ORDER BY LastModifiedDate DESC LIMIT 30';
  const rows = await primeiraQueResponde([
    'SELECT Id, Name, Title, Department, Cargo__c, Tipo_de_Contato__c, Email, Phone, MobilePhone' + onde,
    'SELECT Id, Name, Title, Department, Email, Phone, MobilePhone' + onde,
    'SELECT Id, Name, Email, Phone' + onde
  ]);
  return {
    ok: true,
    linhas: rows.map(function (r) {
      return { id: r.Id, nome: txt(r.Name, 120), cargo: txt(r.Cargo__c || r.Title, 80), depto: txt(r.Tipo_de_Contato__c || r.Department, 80),
        email: txt(r.Email, 120).toLowerCase(), telefone: txt(r.Phone, 40), celular: txt(r.MobilePhone, 40) };
    })
  };
}

// "Enviado por <nome> pela Carteira de Clientes" (carteira-contato-anexo.js)
function enviadoPor(desc) { const m = /^Enviado por (.+?) pela Carteira de Clientes/.exec(String(desc || '')); return m ? m[1] : ''; }

// "Notas e anexos" da conta: Arquivos (ContentDocumentLink, inclui as notas
// novas), anexos e notas clássicos (Attachment / Note). Cada um falha sozinho.
async function fichaAnexos(ids) {
  const em = inLista(ids);
  const lista = [];
  let erros = 0;
  const tenta = async function (consultas, mapa) {
    try { (await primeiraQueResponde(consultas)).forEach(function (r) { lista.push(mapa(r)); }); } catch (e) { erros++; }
  };
  const doc = 'ContentDocument.Title, ContentDocument.FileExtension, ContentDocument.FileType, ContentDocument.ContentSize, ContentDocument.LastModifiedDate';
  await Promise.all([
    tenta([
      'SELECT ContentDocumentId, LinkedEntityId, ' + doc + ', ContentDocument.Description, ContentDocument.Owner.Name FROM ContentDocumentLink WHERE LinkedEntityId IN ' + em + ' LIMIT 100',
      'SELECT ContentDocumentId, LinkedEntityId, ' + doc + ', ContentDocument.Owner.Name FROM ContentDocumentLink WHERE LinkedEntityId IN ' + em + ' LIMIT 100',
      'SELECT ContentDocumentId, LinkedEntityId, ' + doc + ' FROM ContentDocumentLink WHERE LinkedEntityId IN ' + em + ' LIMIT 100'
    ], function (r) {
      const d = r.ContentDocument || {};
      const nota = String(d.FileType || '').toUpperCase() === 'SNOTE';
      return { id: txt(r.ContentDocumentId, 18), obj: 'ContentDocument', conta: txt(r.LinkedEntityId, 18), tipo: nota ? 'nota' : 'arquivo', titulo: txt(d.Title, 200),
        ext: txt(d.FileExtension, 10).toLowerCase(), tamanho: numero(d.ContentSize), data: txt(d.LastModifiedDate, 30),
        // arquivo que entrou pelo portal: o dono é a TI Projetos, quem enviou está na descrição
        autor: txt(enviadoPor(d.Description) || (d.Owner && d.Owner.Name), 120) };
    }),
    tenta([
      'SELECT Id, ParentId, Name, BodyLength, LastModifiedDate, Owner.Name FROM Attachment WHERE ParentId IN ' + em + ' ORDER BY LastModifiedDate DESC LIMIT 100',
      'SELECT Id, ParentId, Name, BodyLength, LastModifiedDate FROM Attachment WHERE ParentId IN ' + em + ' ORDER BY LastModifiedDate DESC LIMIT 100'
    ], function (r) {
      const m = /\.([a-z0-9]{1,6})$/i.exec(r.Name || '');
      return { id: txt(r.Id, 18), obj: 'Attachment', conta: txt(r.ParentId, 18), tipo: 'arquivo', titulo: txt(r.Name, 200), ext: m ? m[1].toLowerCase() : '',
        tamanho: numero(r.BodyLength), data: txt(r.LastModifiedDate, 30), autor: txt(r.Owner && r.Owner.Name, 120) };
    }),
    tenta([
      'SELECT Id, Title, Body, LastModifiedDate, Owner.Name FROM Note WHERE ParentId IN ' + em + ' ORDER BY LastModifiedDate DESC LIMIT 100',
      'SELECT Id, Title, Body, LastModifiedDate FROM Note WHERE ParentId IN ' + em + ' ORDER BY LastModifiedDate DESC LIMIT 100'
    ], function (r) {
      return { id: txt(r.Id, 18), obj: 'Note', tipo: 'nota', titulo: txt(r.Title, 200), texto: txt(r.Body, 600),
        data: txt(r.LastModifiedDate, 30), autor: txt(r.Owner && r.Owner.Name, 120) };
    })
  ]);
  if (erros === 3) throw new Error('não consegui ler as notas e anexos');
  const vistos = new Set();
  return {
    ok: true,
    linhas: lista.filter(function (x) { if (!x.id || vistos.has(x.id)) return false; vistos.add(x.id); return true; })
      .sort(function (a, b) { return String(b.data).localeCompare(String(a.data)); })
  };
}

// 17/11/2026: o CONTEÚDO de um arquivo/nota da conta, lido pelo portal com o
// usuário de integração (TI Projetos) — quem usa a Carteira não tem acesso ao
// Salesforce. Trava: o Id tem de ser de uma CONTA (001…) e o arquivo ligado a
// ELA; Id de fora é 404. Teto: CARTEIRA_ARQUIVO_MAX_MB (25).
const RX_CONTA = /^001[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;
const RX_ARQ_C = /^(069|00P)[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;
const MIME_C = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', snote: 'text/html; charset=utf-8',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip', xml: 'application/xml', msg: 'application/vnd.ms-outlook', eml: 'message/rfc822'
};
const INLINE_C = { pdf: 1, png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1, bmp: 1, txt: 1, snote: 1 };
function erroArqC(status, msg) { const e = new Error(msg); e.status = status; e.publicMessage = msg; return e; }
function extArq(nome) { const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(nome || '')); return m ? m[1].toLowerCase() : ''; }
async function restBin(caminho) {
  if (typeof SF.restBin === 'function') return SF.restBin(caminho);   // dublê de teste
  const a = await SF.getToken();
  const r = await fetch(a.instance + '/services/data/' + SF.APIVER + caminho, { headers: { Authorization: 'Bearer ' + a.token } });
  if (!r.ok) { const t = await r.text(); throw new Error('SF ' + r.status + ': ' + t.slice(0, 160)); }
  return { buf: Buffer.from(await r.arrayBuffer()) };
}
async function arquivoConta(contaId, arqId) {
  contaId = String(contaId || '').trim(); arqId = String(arqId || '').trim();
  if (!RX_CONTA.test(contaId)) throw erroArqC(400, 'Conta inválida.');
  if (!RX_ARQ_C.test(arqId)) throw erroArqC(400, 'Arquivo inválido.');
  const naoArq = function () { return erroArqC(404, 'Arquivo não encontrado nesta conta.'); };
  let nome, ext, tam, caminho;
  if (arqId.slice(0, 3) === '069') {
    const rs = await SF.soql("SELECT ContentDocumentId, LinkedEntityId, ContentDocument.Title, ContentDocument.FileExtension, ContentDocument.ContentSize, ContentDocument.LatestPublishedVersionId FROM ContentDocumentLink WHERE LinkedEntityId IN ('" + contaId + "') AND ContentDocumentId = '" + arqId + "' LIMIT 1");
    const r0 = rs.filter(function (r) { const x = String(r.ContentDocumentId || ''); return x.length === 18 && arqId.length === 18 ? x === arqId : x.slice(0, 15) === arqId.slice(0, 15); })[0];
    const d = r0 ? r0.ContentDocument || {} : null;
    if (!d || !d.LatestPublishedVersionId) throw naoArq();
    ext = d.FileExtension ? String(d.FileExtension).toLowerCase() : '';
    nome = String(d.Title || 'arquivo');
    if (ext && ext !== 'snote' && extArq(nome) !== ext) nome += '.' + ext;
    if (ext === 'snote') nome += '.html';
    tam = d.ContentSize != null ? Number(d.ContentSize) : null;
    caminho = '/sobjects/ContentVersion/' + d.LatestPublishedVersionId + '/VersionData';
  } else {
    const rs = await SF.soql("SELECT Id, ParentId, Name, BodyLength FROM Attachment WHERE Id = '" + arqId + "' AND ParentId IN ('" + contaId + "') LIMIT 1");
    if (!rs.length) throw naoArq();
    nome = String(rs[0].Name || 'anexo'); ext = extArq(nome);
    tam = rs[0].BodyLength != null ? Number(rs[0].BodyLength) : null;
    caminho = '/sobjects/Attachment/' + rs[0].Id + '/Body';
  }
  const maxMb = Math.max(1, Number(process.env.CARTEIRA_ARQUIVO_MAX_MB) || 25), max = maxMb * 1048576;
  const grande = function (b) { return erroArqC(413, 'O arquivo tem ' + (b / 1048576).toFixed(1).replace('.', ',') + ' MB — grande demais para abrir pelo portal (até ' + maxMb + ' MB).'); };
  if (tam != null && tam > max) throw grande(tam);
  const bin = await restBin(caminho);
  if (bin.buf.length > max) throw grande(bin.buf.length);
  return { nome: nome, ext: ext, buf: bin.buf, tipo: MIME_C[ext] || 'application/octet-stream', inline: !!INLINE_C[ext] };
}

function resumoFilial(c) { return { k: c.k, doc: c.doc, nome: c.nome, uf: c.uf, cidade: c.cidade, sit: c.sit, codigos: c.codigos }; }

// { ok, chave, cliente, d365, sf, anexos, contatos, filiais } — cada
// seção falha sozinha ({ ok:false, erro }); chave inválida lança 400
// opts.leve: só o cadastro (Dynamics + contas do SF) — a busca do comprador
// do Agente de Cotações; sem notas e anexos, contatos e filiais.
// opts.contatos (19/11/2026, com o leve): e os CONTATOS das contas do SF — o
// campo Contato da Nova oportunidade lista os contatos do cliente para escolher
async function fichaCliente(valor, logErro, opts) {
  opts = opts || {};
  const ch = lerChave(valor);
  if (!ch) { const e = new Error('chave inválida'); e.status = 400; e.publicMessage = 'Informe um CNPJ (14 dígitos), um CPF (11) ou um cliente da lista.'; throw e; }
  const falha = function (secao) { return function (e) { if (logErro) logErro(secao, e); return { ok: false, erro: erroCurto(e) }; }; };

  const lerD = function (c) { return comPrazo(fichaD365(c), 20000, 'o Dynamics').catch(falha('d365')); };
  const lerS = function (c, linhasD) { return comPrazo(fichaSf(c, linhasD), 20000, 'o CRM').catch(falha('salesforce')); };
  let d365, sf;
  if (ch.tipo === 'doc') {
    const par = await Promise.all([lerD(ch), lerS(ch)]);
    d365 = par[0]; sf = par[1];
  } else if (ch.tipo === 'codigo') {
    d365 = await lerD(ch);
    sf = await lerS(ch, d365.linhas);
  } else {
    // pelo Id da conta: o Dynamics vem pelo CNPJ dela (ou pelo Código ERP)
    sf = await lerS(ch);
    const c0 = (sf.contas || [])[0];
    const ch2 = c0 && c0.doc ? { tipo: 'doc', valor: c0.doc, k: c0.doc } : c0 && c0.codErp ? { tipo: 'codigo', valor: c0.codErp, k: 'D:' + c0.codErp } : null;
    d365 = ch2 ? await lerD(ch2) : { ok: true, configurado: D.CONFIGURED, linhas: [] };
  }
  const ids = (sf.contas || []).map(function (c) { return c.id; }).filter(Boolean).slice(0, 10);
  const comAnexos = !opts.leve && ids.length, comContatos = (!opts.leve || !!opts.contatos) && ids.length;
  const vazio = { ok: true, abertas: [], linhas: [], fechadas12m: null };
  const extras = await Promise.all([
    comAnexos ? comPrazo(fichaAnexos(ids), 20000, 'o CRM').catch(falha('anexos')) : Promise.resolve(vazio),
    comContatos ? comPrazo(fichaContatos(ids), 20000, 'o CRM').catch(falha('contatos')) : Promise.resolve(vazio)
  ]);

  // a mesma montagem da carteira, com as linhas frescas da ficha
  const k = ch.tipo === 'sf' ? (((sf.contas || [])[0] || {}).doc || ch.k) : ch.k;
  const ctx = _base ? { porCodigo: _base.porCodigo } : {};
  const dL = d365.linhas || [], sL = sf.contas || [];
  const cliente = (dL.length || sL.length) ? montarCliente(k, dL, sL, ctx) : null;

  // matriz e filiais: a mesma raiz de CNPJ (8 dígitos), da carteira carregada
  let filiais = { ok: true, disponivel: !!_base, linhas: [] };
  const raiz = /^\d{14}$/.test(k) ? k.slice(0, 8) : '';
  if (_base && raiz) {
    filiais.linhas = (_base.porRaiz.get(raiz) || []).filter(function (c) { return c.k !== k; })
      .sort(function (a, b) { return a.doc.localeCompare(b.doc); }).slice(0, 60).map(resumoFilial);
  }

  return {
    ok: true, chave: ch.k, achou: !!cliente, cliente: cliente,
    d365: d365, sf: sf, anexos: extras[0], contatos: extras[1], filiais: filiais,
    alertas: ALERTAS, geradoEm: new Date().toISOString()
  };
}

module.exports = {
  ALERTAS, COLS, BUSCA_ROT,
  obterBase, baseAtual, estadoBlob, fichaCliente, fichaD365, fichaSf, registrarConta, buscar, urlBlob,
  // puros (testes)
  digitos, docDe, docValido, cnpjValido, cpfValido, mascara, grafias, ufDe, lerChave,
  linhaD365, linhaSf, detalheSf, mapaColunas, montarCliente, cruzar, compactar, COL_D, tipoSegmento, fichaAnexos, arquivoConta,
  textoBusca, lerTermo, soslDe,
  _zerar: function () {
    _base = null; _carga = null; _erro = null; _entD = null;
    _frio = null; _blobVisto = false; _atualizando = null; _blob = { lido: null, gravado: null, erro: null }; _criadas = new Map();
    _buscaCache = new Map();
  }
};
