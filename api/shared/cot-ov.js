// ================================================================
// api/shared/cot-ov.js — a ORDEM DE VENDA da cotação no Dynamics 365 (F&O)
//
// A cotação que virou pedido FECHA com o número da OV que o pedido gerou no
// Dynamics (pelo PI · Pedido ou lançado à mão). Antes de gravar, o portal
// confere a OV pelo NÚMERO: o cabeçalho (empresa, cliente, OC, situação) e
// as linhas (quantos itens, total) — a tela mostra ao lado do cotado e o
// motor pede confirmação quando o cliente não bate.
//
// SÓ LEITURA, app-only (as mesmas credenciais D365_* do /api/pedido-lotes e
// do shared/cot-erp.js). O OData do F&O só filtra TEXTO com eq: a OV vai
// como está ("OVBIO144950"). Cabeçalho em SalesOrderHeadersV2 e, sem ela,
// SalesOrderHeaders (COT_OV_ENTIDADE fixa outra); linhas em SalesOrderLines
// (COT_OV_LINHAS). Sem $select: são 1-2 linhas de cabeçalho e cada campo é
// lido por vários nomes (o que a entidade não tiver fica vazio). O usuário de
// serviço sem permissão de ler ordem de venda = erro — o motor grava a OV
// mesmo assim, sem a conferência.
// Cache por OV: 5 min (o "registrar mesmo assim" não volta ao F&O).
// ================================================================

const D = require('./d365');

const CABECALHOS = [];
if (process.env.COT_OV_ENTIDADE) CABECALHOS.push(process.env.COT_OV_ENTIDADE);
CABECALHOS.push('SalesOrderHeadersV2', 'SalesOrderHeaders');
const LINHAS = process.env.COT_OV_LINHAS || 'SalesOrderLines';

// cada informação, pelos nomes que ela tem nas entidades do F&O
const COL = {
  empresa: ['dataAreaId'],
  cliente: ['OrderingCustomerAccountNumber', 'CustomerAccountNumber', 'CustAccount', 'InvoiceCustomerAccountNumber'],
  nome: ['SalesOrderName', 'SalesName', 'DeliveryAddressName'],
  oc: ['CustomersOrderReference', 'CustomerRequisitionNumber', 'PurchaseOrderFormNumber', 'CustomerRef', 'PurchOrderFormNum'],
  situacao: ['SalesOrderStatus', 'SalesStatus'],
  criadaEm: ['OrderCreationDateTime', 'CreatedDateTime', 'SalesOrderCreationDateTime'],
  valorLinha: ['LineAmount', 'NetAmount']
};
const SITUACAO = { backorder: 'Em aberto', delivered: 'Entregue', invoiced: 'Faturada', canceled: 'Cancelada', cancelled: 'Cancelada', none: '' };
const EMPRESA_PREFERIDA = 'bio';   // a cotação é sempre da BIO
const TTL = 5 * 60e3;
const _cache = new Map();
let _alvo = null;                   // a entidade de cabeçalho que respondeu

function txt(v, max) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function ler(row, campo) { const v = D.pick(row, COL[campo]); return v == null ? '' : v; }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// o número como o Dynamics grava: "ovbio 144950" -> "OVBIO144950"; só os
// números -> "OVBIO" + números (a cotação é sempre da BIO). '' = não é OV.
function numeroOv(v) {
  let s = String(v == null ? '' : v).toUpperCase().replace(/\s+/g, '');
  if (/^\d{4,10}$/.test(s)) s = 'OVBIO' + s;
  return /^OVBIO\d{4,10}$/.test(s) ? s : '';
}

async function linhasDa(numero, empresa, token, ms) {
  try {
    const rows = (await D.odataGetComPrazo(LINHAS, { filter: "SalesOrderNumber eq '" + D.odataStr(numero) + "'", crossCompany: true, top: 500 }, token, ms))
      .filter(function (r) { return !empresa || String(ler(r, 'empresa')).toLowerCase() === empresa; });
    return { itens: rows.length, total: r2(rows.reduce(function (s, r) { return s + (Number(ler(r, 'valorLinha')) || 0); }, 0)) };
  } catch (e) { return null; }   // sem as linhas a conferência fica com o cabeçalho
}

async function procurar(numero, ms) {
  const token = await D.getToken();
  const alvos = _alvo ? [_alvo] : CABECALHOS;
  let ultimo = null;
  for (const ent of alvos) {
    let rows;
    try {
      rows = await D.odataGetComPrazo(ent, { filter: "SalesOrderNumber eq '" + D.odataStr(numero) + "'", crossCompany: true, top: 5 }, token, ms);
    } catch (e) {
      ultimo = e;
      // entidade que não existe neste F&O: tenta a próxima; o resto (permissão, prazo) para aqui
      if (/^F&O 404/.test(e.message || '')) continue;
      throw e;
    }
    _alvo = ent;
    if (!rows.length) return { achou: false, numero: numero, fonte: ent };
    const r = rows.filter(function (x) { return String(ler(x, 'empresa')).toLowerCase() === EMPRESA_PREFERIDA; })[0] || rows[0];
    const empresa = String(ler(r, 'empresa')).toLowerCase();
    const st = txt(ler(r, 'situacao'), 30);
    const lin = await linhasDa(numero, empresa, token, ms);
    return {
      achou: true, numero: numero, fonte: ent,
      empresa: empresa.toUpperCase(), cliente: txt(ler(r, 'cliente'), 30), nome: txt(ler(r, 'nome'), 160), oc: txt(ler(r, 'oc'), 60),
      situacao: SITUACAO[st.toLowerCase()] != null ? SITUACAO[st.toLowerCase()] : st,
      criadaEm: txt(ler(r, 'criadaEm'), 30).replace(/^1900-01-01.*$/, ''),
      itens: lin ? lin.itens : null, total: lin ? lin.total : null,
      em: new Date().toISOString()
    };
  }
  throw ultimo || new Error('nenhuma entidade de ordens de venda respondeu no Dynamics');
}

// { configurado:false } | { achou:false } | { achou:true, cliente, … } — erro lança
async function ordemDeVenda(v, opts) {
  const numero = numeroOv(v);
  if (!numero) return { achou: false, motivo: 'número inválido' };
  if (!D.CONFIGURED) return { configurado: false, achou: false };
  const c = _cache.get(numero);
  if (c && Date.now() - c.em < TTL) return c.v;
  const ms = (opts && opts.timeoutMs) || 8000;
  const r = await procurar(numero, ms);
  _cache.set(numero, { em: Date.now(), v: r });
  return r;
}

module.exports = { ordemDeVenda, numeroOv, _zerar: function () { _cache.clear(); _alvo = null; } };
