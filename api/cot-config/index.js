// ================================================================
// /api/cot-config — Configurações do módulo Cotações (Comercial)
//
//   GET  /api/cot-config            -> { ok, eu, config, padrao, diagnostico }
//   POST { acao:'salvar', config }  portais, motivos de perda e de
//                                   cancelamento, empresas, áreas e o aviso de
//                                   prazo (dias)
//
// O módulo é SÓ do dono do portal (cot-motor.exigirEquipe): não há equipe.
//
// diagnostico: se o armazenamento (o container próprio, COT_BLOB_URL) e a
// IA estão configurados e o tamanho máximo de anexo.
// ================================================================

const motor = require('../shared/cot-motor');
const H = require('../shared/cot-http');

function soDono(quem) {
  if (quem.admin) return;
  const e = new Error('so dono'); e.status = 403; e.publicMessage = 'Só o dono do módulo altera as configurações.'; throw e;
}

module.exports = async function (context, req) {
  if (H.preflight(context, req)) return;
  try {
    const quem = await motor.exigirEquipe(req);
    const eu = { email: quem.email, nome: quem.nome, admin: quem.admin };

    if (req.method === 'GET') {
      return H.ok(context, req, {
        ok: true, eu: eu, config: quem.cfg, diagnostico: motor.diagnostico(),
        padrao: { portais: motor.PORTAIS_PADRAO, motivosPerda: motor.MOTIVOS_PERDA_PADRAO, motivosCancelamento: motor.MOTIVOS_CANCEL_PADRAO,
          empresas: motor.EMPRESAS_PADRAO, areas: motor.AREAS_PADRAO }
      });
    }

    const b = req.body || {};
    if (b.acao === 'salvar') {
      soDono(quem);
      const cfg = await motor.salvarConfig(b.config || {}, quem);
      return H.ok(context, req, { ok: true, config: cfg });
    }
    const e = new Error('acao'); e.status = 400; e.publicMessage = 'Ação desconhecida.'; throw e;
  } catch (err) {
    H.falhar(context, req, 'cot-config', err);
  }
};
