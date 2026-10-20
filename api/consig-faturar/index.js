// ================================================================
// /api/consig-faturar  —  PI Consignação (portal)
//
// Recebe o FATURAMENTO DE CONSIGNADO montado no navegador (fluxo por PDF,
// itens identificados por LOTE) e repassa para o flow HTTP do Power
// Automate no schema que o flow espera. A URL do flow (com a assinatura)
// fica só na env var.
//
//   POST /api/consig-faturar   { cabecalho, itens, totalGeral, sharepoint }
//   -> { ok:true }  (ou erro com detalhes)
//
// Env: CONSIG_FATURAR_FLOW_URL (preferida) — gatilho HTTP do flow de
//   faturamento de consignado por PDF. Se ausente, cai em CONSIG_FLOW_URL.
//
// Schema enviado (top-level + Produtos[]):
//   Empresa, CNPJ, NomeCliente, OrdemdeCompra, EnderecoEntrega, Email,
//   CondicaoPagamento, Condicaodeentrega, Frete, Tipovenda, Areademandante, Vendedor,
//   MedicoAtendimento, MedicoCirurgico, Paciente, Convenio, DataCirurgia,
//   DataAtendimento, Prontuario, Beneficiario, Senha, Observacao, Operador,
//   ValorTotal, Quantidade, (dados do PDF no SharePoint), Resumo,
//   Produtos:[{ Codigo, Produto, Lote, Quantidade, ValorUnitario, Validade }]
// ================================================================

// URL do flow de faturamento de consignado. Pode ser sobrescrita por env.
const auth = require('../shared/auth');
const http = require('../shared/http');

// A URL do gatilho contém a assinatura (sig) — é SEGREDO. Vem só da env var.
const FLOW_URL = process.env.CONSIG_FATURAR_FLOW_URL || '';

function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

// identificador de arquivo do conector SharePoint (Power Automate):
// caminho relativo ao site -> barra vira %252f e espaço vira %2b
function spFileId(pathSite) {
  if (!pathSite) return '';
  return String(pathSite).replace(/\//g, '%252f').replace(/ /g, '%2b');
}

function montarSchema(cab, itens, totalGeral, sp, resumo) {
  cab = cab || {};
  sp = sp || {};
  var qtdTotal = itens.reduce(function (s, p) { return s + num(p.quantidade); }, 0);
  var valorTotal = (totalGeral != null) ? num(totalGeral) : itens.reduce(function (s, p) { return s + num(p.quantidade) * num(p.valorUnitario); }, 0);
  return {
    Origem:            'portal-pi-consignacao',
    Empresa:           cab.empresa || '',
    CNPJ:              cab.cnpj || '',
    NomeCliente:       cab.nomeCliente || '',
    OrdemdeCompra:     cab.ordemDeCompra || '',
    EnderecoEntrega:   cab.enderecoEntrega || '',
    Email:             cab.email || '',
    CondicaoPagamento: cab.condicaoPagamento || '',
    Condicaodeentrega: cab.condicaoEntrega || '',
    Frete:             cab.frete || '',
    Tipovenda:         cab.tipoVenda || 'FATURAMENTO CONSIGNADO',
    Areademandante:    cab.areaDemandante || '',
    Vendedor:          cab.vendedor || '',
    MedicoAtendimento: cab.medicoAtendimento || '',
    MedicoCirurgico:   cab.medicoCirurgico || '',
    Paciente:          cab.paciente || '',
    Convenio:          cab.convenio || '',
    DataCirurgia:      cab.dataCirurgia || '',
    DataAtendimento:   cab.dataAtendimento || '',
    Prontuario:        cab.prontuario || '',
    Beneficiario:      cab.beneficiario || '',
    Senha:             cab.senha || '',
    Observacao:        cab.observacao || '',
    Operador:          cab.operador || '',
    ValorTotal:        valorTotal,
    Quantidade:        qtdTotal,
    // arquivo no SharePoint (mesmo padrão do PI Pedido)
    ID:                spFileId(sp.pathSite) || sp.id || '',
    IdPDF:             spFileId(sp.pathSite) || sp.id || '',
    CaminhoPDF:        sp.pathSite || '',
    CaminhoBiblioteca: sp.pathLib || '',
    NomePDF:           sp.name || '',
    NomePdf:           sp.name || '',
    UrlPDF:            sp.webUrl || '',
    ListItemIdPDF:     (sp.listItemId != null ? String(sp.listItemId) : ''),
    IdDriveItem:       sp.id || '',
    Resumo:            (resumo || ''),
    Produtos: (itens || []).map(function (p) {
      return {
        Codigo:        p.codigo || '',
        Produto:       p.produto || '',
        Lote:          p.lote || '',
        Quantidade:    num(p.quantidade),
        ValorUnitario: num(p.valorUnitario),
        Validade:      p.expDate || ''
      };
    })
  };
}

module.exports = async function (context, req) {
  const cors = http.cors(req);
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: cors }; return; }

  try {
    await auth.requireArea(req, ['comercial', 'estoque']); // 401/403 quando AUTH_ENFORCE ligado

    if (!FLOW_URL) { const e = new Error('CONSIG_FATURAR_FLOW_URL ausente'); e.status = 500; throw e; }

    const b = req.body || {};
    if (!b.cabecalho || !Array.isArray(b.itens) || !b.itens.length) {
      throw http.badRequest('Faturamento incompleto: faltou cabeçalho ou itens.');
    }
    if (b.sharepoint && b.sharepoint.pathSite && /\.\.|\\/.test(String(b.sharepoint.pathSite))) {
      throw http.badRequest('Caminho de arquivo inválido.');
    }

    const payload = montarSchema(b.cabecalho, b.itens, b.totalGeral, b.sharepoint, b.resumo);

    const _flowAuth = await auth.flowAuthHeader('CONSIG_FATURAR');
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
    http.sendError(context, req, 'consig-faturar', err);
  }
};
