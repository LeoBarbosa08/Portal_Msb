// ================================================================
// /api/cot-casos — as cotações do módulo Cotações (Comercial)
//
//   GET  /api/cot-casos                        -> { ok, eu, configurado, rev, casos:[resumo], cfg }
//   GET  /api/cot-casos?rev=12                 -> { ok, mudou:false, rev } quando nada mudou
//                                                 (a tela consulta a cada 20 s — barato)
//   GET  /api/cot-casos?numero=COT-…           -> { ok, caso }   (o caso inteiro)
//   GET  /api/cot-casos?numero=COT-…&anexo=ID  -> { ok, nome, tipo, tamanho, base64 }
//                                                 (só anexo REGISTRADO no caso — é o
//                                                 que a tela abre e o PI recebe)
//   GET  /api/cot-casos?cliente=<CNPJ>          -> { ok, erp } o comprador no Dynamics
//                                                 (código ERP, grupo, cond. pag., endereço,
//                                                 bloqueio — shared/cot-erp.js)
//   GET  /api/cot-casos?duplicado=1&portal=…&cotacao=…
//                                              -> { ok, caso: resumo | null }
//   POST /api/cot-casos {acao:'novo', dados, anexo?, leitura?, fase?, nota?, forcar?}
//        (o Agente de Cotações: a cotação lida do PDF vira caso; a mesma
//         cotação de novo -> 409 { duplicado:'COT-…' } sem forcar)
//   POST /api/cot-casos {acao, numero, …}
//        acao = assumir | atribuir{para} | liberar | fase{fase,motivo,obs,concorrente,valorConcorrente}
//             | campos{campos} | itens{itens,total} | nota{texto} | anexo{anexo,tipo}
//             | removerAnexo{id} | pedido{anexo|anexoId,oc,data,total,obs}
//             | pi{estado,previa,enviado,erro} | leitura{dados,leitura,sobrescrever}
//             | descartar{descartado,motivo} | vencer | erp (busca o CNPJ no Dynamics de novo)
//             | ov{ov, obs?, forcar?}  (a cotação FECHA com a Ordem de Venda do
//               Dynamics — conferida no F&O; OV que não existe, já está em outra
//               cotação ou é de outro cliente -> 409 { confirmar:true, avisos }
//               sem forcar) | removerOv{ov, motivo?}
//             | proposta{anexo(PDF), para, copia?, assunto, canal}  (a proposta
//               no modelo da Biomedical foi enviada ao comprador — registra)
//
// O GET da lista também VENCE as cotações abertas com a validade passada
// (motor.varrerVencidas) e devolve em `eu` a equipe de segurança (área) e o
// telefone/cargo de quem está logado — o "Preparado por" da proposta.
//
// Portão: SÓ o dono do portal, com id token VALIDADO (cot-motor.exigirEquipe).
// Cada ação grava QUEM fez, com a identidade do login.
// ================================================================

const motor = require('../shared/cot-motor');
const store = require('../shared/cot-store');
const H = require('../shared/cot-http');

function cfgParaTela(cfg) {
  return {
    fases: motor.FASES, portais: cfg.portais, motivosPerda: cfg.motivosPerda, motivosCancelamento: cfg.motivosCancelamento,
    empresas: cfg.empresas, areas: cfg.areas, avisoDias: cfg.avisoDias
  };
}

module.exports = async function (context, req) {
  if (H.preflight(context, req)) return;
  try {
    const quem = await motor.exigirEquipe(req);
    const eu = { email: quem.email, nome: quem.nome, admin: quem.admin };
    // a equipe de segurança (área do caso) e o contato que vai na proposta
    const comPerfil = async function () { return Object.assign(eu, await motor.perfilDe(quem)); };

    if (!store.configurado()) {
      return H.ok(context, req, { ok: true, configurado: false, eu: await comPerfil(), rev: 0, casos: [], cfg: cfgParaTela(quem.cfg) });
    }

    if (req.method === 'GET') {
      const q = req.query || {};
      // o comprador no Dynamics, pelo CNPJ (o agente consulta ao ler o PDF)
      if (q.cliente) {
        let v;
        try { v = await motor.consultarErp(String(q.cliente), true); }
        catch (e) { return H.ok(context, req, { ok: true, erp: { achou: false, erro: e.publicMessage || e.message } }); }
        return H.ok(context, req, { ok: true, erp: v || { achou: false, desligado: true } });
      }
      if (q.duplicado) {
        return H.ok(context, req, { ok: true, caso: await motor.duplicado(String(q.portal || ''), String(q.cotacao || ''), quem.cfg) });
      }
      if (q.numero && q.anexo) {
        return H.ok(context, req, Object.assign({ ok: true }, await motor.arquivo(String(q.numero), String(q.anexo))));
      }
      if (q.numero) {
        const c = await motor.obter(String(q.numero));
        if (!c) { const e = new Error('nao encontrado'); e.status = 404; e.publicMessage = 'Cotação não encontrada.'; throw e; }
        return H.ok(context, req, { ok: true, caso: c });
      }
      let ix = await motor.listar();
      // a cotação aberta com a validade passada vira "Vencida" sozinha
      if (await motor.varrerVencidas(ix)) ix = await motor.listar();
      if (q.rev != null && q.rev !== '' && Number(q.rev) === Number(ix.rev || 0)) {
        return H.ok(context, req, { ok: true, mudou: false, rev: ix.rev || 0 });
      }
      return H.ok(context, req, {
        ok: true, configurado: true, eu: await comPerfil(), rev: ix.rev || 0, seq: ix.seq || 0, atualizadoEm: ix.atualizadoEm || null,
        casos: ix.casos || [], cfg: cfgParaTela(quem.cfg)
      });
    }

    const b = req.body || {};
    if (b.acao === 'novo') {
      const c = await motor.novo(b, quem);
      return H.ok(context, req, { ok: true, caso: c });
    }
    const c = await motor.agir(String(b.numero || ''), b, quem);
    return H.ok(context, req, { ok: true, caso: c });
  } catch (err) {
    H.falhar(context, req, 'cot-casos', err);
  }
};
