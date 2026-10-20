// ================================================================
// /api/pedido-enviar  —  Pedido Inteligente (portal)
//
// Recebe o pedido final montado no navegador e repassa para o flow HTTP
// do Power Automate no SCHEMA EXATO que o flow espera. A URL do flow
// (que contém a assinatura secreta) fica só na env var — NUNCA no código.
//
//   POST /api/pedido-enviar   { cabecalho, produtos, totalGeral }
//   -> { ok: true }  (ou erro com detalhes)
//
// Env var necessária na Function App / Static Web App:
//   PEDIDO_FLOW_URL = URL do gatilho "Quando uma solicitação HTTP é
//                     recebida" do Power Automate.
//
// Schema enviado ao flow (top-level + Produtos[].Lotes[]):
//   Empresa, CNPJ, CondicaoPagamento, DataVencimentoPagamento, UsaDataVencimento,
//   PagamentoAntecipado (boolean, false quando não vem),
//   Frete, Observacao, Condicaodeentrega,
//   EnderecoEntrega, OrdemdeCompra, Tipovenda, Operador, ValorTotal,
//   Quantidade, NomeCliente, Areademandante, Vendedor, Email, Caso, Portal,
//   PoliticaCredito, OBSERVACAONOTA,
//   Produtos:[{ Codigo, Produto, Quantidade, ValorUnitario, ID,
//               Lotes:[{ Lote, Quantidade, PrecoLote }] }]
// ================================================================

// URL do flow do PI Pedido. Pode ser sobrescrita pela env var PEDIDO_FLOW_URL.
const auth = require('../shared/auth');
const http = require('../shared/http');

// A URL do gatilho contém a assinatura (sig) — é SEGREDO. Vem só da env var.
const FLOW_URL = process.env.PEDIDO_FLOW_URL || '';

function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

// flag Sim/Não do cabeçalho: só true/"true"/"sim" ligam — o resto (inclusive
// ausente, caso da réplica PI · Pedido (TESTE)) vai como false para o flow.
function flag(v) { return v === true || /^(true|sim|s|1)$/i.test(String(v == null ? '' : v).trim()); }
// Observação no rodapé da nota: vazia = o flow NÃO cria a nota. "N/D" era o
// preenchimento padrão da tela (e ainda chega de navegador com o JS antigo em
// cache), então conta como vazio.
function obsNota(v) { var s = String(v == null ? '' : v).trim(); return /^n\/d$/i.test(s) ? '' : s; }

// data de vencimento no formato ISO curto que o flow espera ("AAAA-MM-DD").
// Aceita o valor do <input type="date"> e o formato brasileiro; qualquer outra
// coisa vira "" — o Power Automate não recebe lixo em campo de data.
function dataISO(v) {
  var t = String(v || '').trim();
  var m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return m[0];
  m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? (m[3] + '-' + m[2] + '-' + m[1]) : '';
}

// identificador de arquivo do conector SharePoint (Power Automate):
// caminho relativo ao site -> barra vira %252f e espaço vira %2b
// ex.: /Shared Documents/Ordens de Compra PDF/OC 113221 (1).pdf
//   -> %252fShared%2bDocuments%252fOrdens%2bde%2bCompra%2bPDF%252fOC%2b113221%2b(1).pdf
function spFileId(pathSite) {
  if (!pathSite) return '';
  return String(pathSite).replace(/\//g, '%252f').replace(/ /g, '%2b');
}

// monta o corpo no formato exato do flow a partir do cabeçalho + produtos
function montarSchema(cab, produtos, totalGeral, sp) {
  cab = cab || {};
  sp = sp || {};
  var qtdTotal = produtos.reduce(function (s, p) { return s + num(p.quantidade); }, 0);
  // flag "Data de Vencimento do Pagamento": ligada, o pedido vai COM a data e
  // SEM condição de pagamento (CondicaoPagamento vazia — o flow decide pela data).
  var usaVenc = !!cab.usaDataVencimento;
  return {
    Empresa:           cab.empresa || '',
    CNPJ:              cab.cnpj || '',
    CondicaoPagamento: usaVenc ? '' : (cab.condicaoPagamento || ''),
    DataVencimentoPagamento: usaVenc ? dataISO(cab.dataVencimento) : '',
    UsaDataVencimento:       usaVenc,
    PagamentoAntecipado:     flag(cab.pagamentoAntecipado),
    Frete:             cab.frete || '',
    Observacao:        cab.observacao || '',
    Condicaodeentrega: cab.condicaoEntrega || '',
    EnderecoEntrega:   cab.enderecoEntrega || '',
    OrdemdeCompra:     cab.ordemDeCompra || '',
    Tipovenda:         cab.tipoVenda || '',
    Operador:          cab.operador || '',
    ValorTotal:        num(totalGeral),
    Quantidade:        qtdTotal,
    NomeCliente:       cab.nomeCliente || '',
    Areademandante:    cab.areaDemandante || '',
    Vendedor:          cab.vendedor || '',
    Email:             cab.email || '',
    Caso:              cab.caso || 'N/D',
    Portal:            cab.portal || '',
    PoliticaCredito:   cab.politicaCredito || '',
    OBSERVACAONOTA:    obsNota(cab.observacaoNota),
    // arquivo no SharePoint. O conector "Obter conteúdo do arquivo" identifica
    // pelo IDENTIFICADOR CODIFICADO (barra -> %252f, espaço -> %2b), NÃO pelo
    // caminho legível. ID/IdPDF trazem esse token (o caminho legível fica em
    // CaminhoPDF, p/ a ação "usando o caminho").
    ID:                spFileId(sp.pathSite) || sp.id || '',
    IdPDF:             spFileId(sp.pathSite) || sp.id || '',
    CaminhoPDF:        sp.pathSite || '',
    CaminhoBiblioteca: sp.pathLib || '',
    NomePDF:           sp.name || '',
    NomePdf:           sp.name || '',
    UrlPDF:            sp.webUrl || '',
    ListItemIdPDF:     (sp.listItemId != null ? String(sp.listItemId) : ''),
    IdDriveItem:       sp.id || '',
    Produtos: (produtos || []).map(function (p) {
      return {
        Codigo:        p.codigo || '',
        Produto:       p.produto || '',
        Quantidade:    num(p.quantidade),
        ValorUnitario: num(p.valorUnitario),
        ID:            p.id || '',
        Lotes: (p.lotes || []).map(function (l) {
          return {
            Lote:      l.batch || l.Lote || '',
            Quantidade: num(l.quantidade),
            PrecoLote:  num(l.precoLote != null ? l.precoLote : p.valorUnitario)
          };
        })
      };
    })
  };
}

module.exports = async function (context, req) {
  const cors = http.cors(req);
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: cors }; return; }

  try {
    await auth.requireArea(req, ['comercial', 'estoque']); // 401/403 quando AUTH_ENFORCE ligado

    if (!FLOW_URL) { const e = new Error('PEDIDO_FLOW_URL ausente'); e.status = 500; throw e; }

    const b = req.body || {};
    if (!b.cabecalho || !Array.isArray(b.produtos) || !b.produtos.length) {
      throw http.badRequest('Pedido incompleto: faltou cabeçalho ou produtos.');
    }
    // flag ligada sem data válida deixaria o pedido SEM condição de pagamento e
    // SEM vencimento — o flow não teria por onde cobrar.
    if (b.cabecalho.usaDataVencimento && !dataISO(b.cabecalho.dataVencimento)) {
      throw http.badRequest('Data de vencimento do pagamento inválida ou não informada.');
    }
    // anti path-traversal no identificador do arquivo do SharePoint
    if (b.sharepoint && b.sharepoint.pathSite && /\.\.|\\/.test(String(b.sharepoint.pathSite))) {
      throw http.badRequest('Caminho de arquivo inválido.');
    }

    const payload = montarSchema(b.cabecalho, b.produtos, b.totalGeral, b.sharepoint);

    const _flowAuth = await auth.flowAuthHeader('PEDIDO');
    const r = await fetch(FLOW_URL, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, _flowAuth),
      body: JSON.stringify(payload)
    });
    await r.text();
    if (!r.ok) {
      context.res = { status: 502, headers: cors, body: { ok: false, error: 'Power Automate respondeu ' + r.status } };
      return;
    }

    context.res = { status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, cors),
      body: { ok: true, flowStatus: r.status } };
  } catch (err) {
    http.sendError(context, req, 'pedido-enviar', err);
  }
};
