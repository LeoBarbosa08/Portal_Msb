// ================================================================
// /api/cot-ov-retorno — o flow do PI · Pedido devolve a ORDEM DE VENDA
//
// O PI manda o pedido ao Power Automate com o campo Caso = COT-… (a cotação
// de onde ele veio). O flow cria a OV no Dynamics na MESMA execução e, no
// fim, chama esta porta — a cotação fecha sozinha com a OV (conferida no
// Dynamics, como a digitada no cartão; ver cot-motor.retornoDoFlow).
//
//   POST { Caso: 'COT-MSB-AAAA-NNNNNN', OrdemVenda: 'OVMSB144950' }
//        OrdemVenda também aceita lista ['OVMSB…', …] ou "OVMSB…, OVMSB…"
//   cabeçalho x-portal-chave: <COT_OV_CHAVE>
//
//   200 { ok, caso, ovs, fase }         a OV entrou (repetida = idempotente)
//   200 { ok, ignorado:true, motivo }   o Caso não é cotação (Customer
//                                       Service, PI avulso "N/D"): nada a fazer
//   400 OrdemVenda inválida · 401 chave ausente/errada · 404 cotação não existe
//   409 cotação descartada ou sem o PDF do pedido · 503 COT_OV_CHAVE não configurada
//
// RECORTE MSB (04/11/2026): aqui a cotação é COT-MSB-AAAA-NNNNNN e a OV é a
// da MSB (OVMSB…). O flow do PI · Pedido é o mesmo da BIO: para a OV voltar
// sozinha às cotações da MSB, o flow precisa chamar ESTA porta (a do portal
// da MSB) quando o Caso começar com COT-MSB-, com a COT_OV_CHAVE desta Static
// Web App. Sem isso, a OV entra à mão no cartão ("Já tenho a OV") — e o
// portal da BIO ignora o COT-MSB-…, nunca o confunde com uma cotação dele.
//
// É o ÚNICO endpoint do módulo sem login (quem chama é o Power Automate).
// Por isso só age com a chave certa (fail-closed: sem a variável, 503) e
// não devolve dado da cotação além do número, das OVs e da fase.
// ================================================================

const motor = require('../shared/cot-motor');
const H = require('../shared/cot-http');

function corpo(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  try { return JSON.parse(String(b || '{}')); } catch (e) { return {}; }
}

module.exports = async function (context, req) {
  if (H.preflight(context, req)) return;
  try {
    if (req.method !== 'POST') { const e = new Error('metodo'); e.status = 400; e.publicMessage = 'Use POST.'; throw e; }
    motor.exigirChaveDoFlow(req);
    const b = corpo(req);
    const r = await motor.retornoDoFlow(b.Caso || b.caso, b.OrdemVenda || b.ordemVenda || b.OV || b.ov);
    H.ok(context, req, Object.assign({ ok: true }, r));
  } catch (err) {
    H.falhar(context, req, 'cot-ov-retorno', err);
  }
};
