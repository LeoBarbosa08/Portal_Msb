// ================================================================
// /api/dossie-cliente  —  Dossiê de Visita (Comercial) · SOMENTE LEITURA
//
// Recebe o CNPJ digitado pelo vendedor e devolve o que NÃO está no Power BI:
//   • a Conta do Salesforce (nome, cidade/UF, telefone, dono da conta,
//     código ERP);
//   • as cotações e oportunidades ABERTAS dessa Conta, direto do Salesforce;
//   • o status na carteira (cliente / grupo / novo) — api/shared/clientes.js.
// Nada é escrito em lugar nenhum. Os números do dossiê (compras, cirurgias…)
// o navegador lê direto do Power BI com o token do próprio vendedor (RLS).
//
// Por que as oportunidades saem daqui e não do Power BI: lá a busca cruza o
// código do cliente do modelo Comercial com o do modelo de Oportunidades, e
// quando os dois não casam o cartão sai "Nenhuma" com a oportunidade viva no
// Salesforce (08/10/2026: GF LABOR, CNPJ 02.184.266/0001-67, R$ 492 mil em
// Qualificação). Pela Conta não há chave a cruzar. O Power BI fica de reserva.
//
// Molde: api/orgao-salesforce (LICI). Área exigida: comercial. As
// oportunidades têm cliente, valor e vendedor: como em /api/comercial-funil,
// só saem com id token VALIDADO e a área comercial conferida aqui mesmo.
//   POST /api/dossie-cliente  { cnpj }
// ================================================================

const SF = require('../shared/salesforce');
const auth = require('../shared/auth');
const http = require('../shared/http');

// os mesmos dois tipos que o modelo de Oportunidades chama de
// TIPO_DE_REGISTRO "Oportunidade" e "Cotação" (DeveloperName não traduz)
const TIPOS_OPORTUNIDADE = ['Oportunidade', 'Cotacao'];

function cnpjCandidatos(d) {
  const out = [d];
  if (d.length === 14) out.push(d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12));
  return out;
}

// campo sem permissão de leitura derruba a SOQL inteira: tenta do SELECT
// mais completo ao mínimo e fica com o primeiro que responder
async function primeiraQueResponde(soql, consultas) {
  let ultimo = null;
  for (const c of consultas) {
    try { return await soql(c); } catch (e) { ultimo = e; }
  }
  throw ultimo;
}

async function conta(d) {
  if (!SF.CONFIGURED) return { configured: false, encontrado: false, conta: null };
  const cands = cnpjCandidatos(d).map(function (c) { return "'" + SF.soqlStr(c) + "'"; }).join(',');
  const onde = ' FROM Account WHERE CNPJ__c IN (' + cands + ') LIMIT 5';
  const contas = await primeiraQueResponde(SF.soql, [
    'SELECT Id, Name, CNPJ__c, BillingCity, BillingState, Phone, Owner.Name, Owner.Email, CODCFO__c' + onde,
    // Owner pode não ser legível pelo run-as: tenta sem ele antes de desistir
    'SELECT Id, Name, CNPJ__c, BillingCity, BillingState, Phone, Owner.Name, Owner.Email' + onde,
    'SELECT Id, Name, CNPJ__c, BillingCity, BillingState, Phone' + onde
  ]);
  if (!contas.length) return { configured: true, encontrado: false, conta: null };
  const c = contas[0];
  return {
    configured: true, encontrado: true,
    conta: {
      id: c.Id, nome: c.Name, cnpj: c.CNPJ__c,
      cidade: c.BillingCity || '', uf: c.BillingState || '', telefone: c.Phone || '',
      dono: (c.Owner && c.Owner.Name) || '', donoEmail: (c.Owner && c.Owner.Email) || '',
      codigoErp: c.CODCFO__c || ''
    }
  };
}

// ── oportunidades abertas da Conta ───────────────────────────────
function soqlOportunidades(contaId) {
  const tipos = TIPOS_OPORTUNIDADE.map(function (t) { return "'" + SF.soqlStr(t) + "'"; }).join(',');
  const onde = ' FROM Opportunity WHERE AccountId = \'' + SF.soqlStr(contaId) + '\' AND IsClosed = false' +
    ' AND RecordType.DeveloperName IN (' + tipos + ') ORDER BY Amount DESC NULLS LAST LIMIT 200';
  const base = 'SELECT Id, Name, StageName, RecordType.Name, Amount, CreatedDate, CloseDate, LastStageChangeInDays';
  return [
    base + ', Owner.Name, Data_da_Cirurgia__c, Vendedor_Representante__r.Name' + onde,
    base + ', Owner.Name' + onde,
    base + onde
  ];
}

// uma linha no formato que o dossie-motor.js já lê (o mesmo da Q8 do BI)
function linhaOportunidade(r) {
  const vend = (r.Vendedor_Representante__r && r.Vendedor_Representante__r.Name) || (r.Owner && r.Owner.Name) || '';
  return {
    id: r.Id, tipo: (r.RecordType && r.RecordType.Name) || '', nome: r.Name || '', fase: r.StageName || '',
    criacao: r.CreatedDate || null, fechamento: r.CloseDate || null, cirurgia: r.Data_da_Cirurgia__c || null,
    vend: vend, valor: r.Amount == null ? 0 : Number(r.Amount) || 0,
    diasNaFase: r.LastStageChangeInDays == null ? null : Number(r.LastStageChangeInDays)
  };
}

async function oportunidades(soql, contaId) {
  const recs = await primeiraQueResponde(soql, soqlOportunidades(contaId));
  return { disponivel: true, linhas: recs.map(linhaOportunidade) };
}

// mesma trava do /api/comercial-funil: token validado + área comercial
async function podeVerOportunidades(sess) {
  if (!sess || sess.validated !== true) return 'sessão sem token validado';
  const az = await auth.authorizedAreas(sess.user);
  if (!az || (az.areas || []).indexOf('comercial') < 0) return 'sem a área comercial';
  return null;
}

async function carteira(d, context) {
  let CL;
  try { CL = require('../shared/clientes'); } catch (e) { return { disponivel: false }; }
  if (!CL.CONFIGURED) return { disponivel: false };
  try {
    const base = await CL.getBase();
    return { disponivel: true, fonte: base.fonte || CL.FONTE, status: CL.statusCnpj(base, d) };
  } catch (e) {
    http.logError(context, 'dossie-cliente/carteira', e);
    return { disponivel: false, erro: 'carteira indisponível' };
  }
}

module.exports = async function (context, req) {
  const cors = http.cors(req);
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: cors }; return; }
  const json = function (status, body) {
    context.res = { status: status, headers: Object.assign({ 'Content-Type': 'application/json' }, cors), body: body };
  };

  try {
    const sess = await auth.requireArea(req, 'comercial');

    const d = SF.digits((req.body && req.body.cnpj) || '');
    if (d.length !== 14) throw http.badRequest('CNPJ inválido — precisa ter 14 dígitos.');

    // as duas fontes rodam juntas e falham sozinhas
    const [rc, rk] = await Promise.allSettled([conta(d), carteira(d, context)]);
    const sf = rc.status === 'fulfilled' ? rc.value : { configured: SF.CONFIGURED, encontrado: false, conta: null, erro: 'Salesforce indisponível' };
    if (rc.status === 'rejected') http.logError(context, 'dossie-cliente/salesforce', rc.reason);
    const ct = rk.status === 'fulfilled' ? rk.value : { disponivel: false };

    // sem as oportunidades daqui, a página cai no modelo do Power BI
    if (sf.encontrado && sf.conta && sf.conta.id) {
      try {
        const veto = await podeVerOportunidades(sess);
        sf.oportunidades = veto ? { disponivel: false, motivo: veto } : await oportunidades(SF.soql, sf.conta.id);
      } catch (e) {
        http.logError(context, 'dossie-cliente/oportunidades', e);
        sf.oportunidades = { disponivel: false, motivo: 'não consegui ler as oportunidades no Salesforce' };
      }
    }

    json(200, { ok: true, cnpj: d, salesforce: sf, carteira: ct });
  } catch (err) {
    http.sendError(context, req, 'dossie-cliente', err);
  }
};

module.exports._interno = { soqlOportunidades, linhaOportunidade, oportunidades, primeiraQueResponde, TIPOS_OPORTUNIDADE };
