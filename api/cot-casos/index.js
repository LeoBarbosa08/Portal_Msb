// ================================================================
// /api/cot-casos — as cotações do módulo Cotações (Comercial)
//
//   GET  /api/cot-casos                        -> { ok, eu, configurado, rev, casos:[resumo], cfg }
//   GET  /api/cot-casos?eu=1                   -> { ok, eu }  (só quem é a pessoa: admin, full e as
//                                                 unidades do RLS — a home do CRM decide o submódulo)
//   GET  /api/cot-casos?rev=12                 -> { ok, mudou:false, rev } quando nada mudou
//                                                 (a tela consulta a cada 20 s — barato)
//   GET  /api/cot-casos?numero=COT-…           -> { ok, caso }   (o caso inteiro)
//   GET  /api/cot-casos?numero=COT-…&anexo=ID  -> { ok, nome, tipo, tamanho, base64 }
//                                                 (só anexo REGISTRADO no caso — é o
//                                                 que a tela abre e o PI recebe)
//   GET  /api/cot-casos?cliente=<CNPJ>          -> { ok, erp } o comprador no Dynamics
//                                                 (código ERP, grupo, cond. pag., endereço,
//                                                 bloqueio — shared/cot-erp.js)
//   GET  /api/cot-casos?codigoCliente=<cód.>    -> { ok, erp } o mesmo, pelo CÓDIGO do
//                                                 cliente no ERP (traz o CNPJ do cadastro)
//   GET  /api/cot-casos?familias=1             -> { ok, familias: { CÓDIGO: família }, motivo? }
//                                                 ('Produtos'[Família] do Power BI do
//                                                 Comercial, com o token da pessoa — o
//                                                 Analítico agrupa os itens por família)
//   GET  /api/cot-casos?ovsDe=COT-…              -> { ok, cliente, ovs:[{numero, criadaEm, oc, situacao, nome, emOutra?}], motivo? }
//                                                 (as Ordens de Venda do cliente da cotação no Dynamics,
//                                                 para escolher no "Já tenho a Ordem de Venda" — 21/10/26;
//                                                 &todas=1: as mais novas da BIO de todos os clientes)
//   GET  /api/cot-casos?produtos=COD1,COD2…     -> { ok, configurado, produtos: { CÓDIGO: { descricao, complemento,
//                                                 fabricante, procedencia, rms, isento, ativo, nome } }, erro? }
//                                                 (o produto no Salesforce pelo código Biomedical — o que
//                                                 vai na PROPOSTA; shared/cot-produtos.js — 21/10/26)
//   GET  /api/cot-casos?duplicado=1&portal=…&cotacao=…
//                                              -> { ok, caso: resumo | null }
//   POST /api/cot-casos {acao:'novo', dados, anexo?, leitura?, fase?, nota?, forcar?}
//        (o Agente de Cotações: a cotação lida do PDF vira caso; a mesma
//         cotação de novo -> 409 { duplicado:'COT-…' } sem forcar)
//   POST /api/cot-casos {acao, numero, …}
//        acao = assumir | atribuir{para} | liberar | fase{fase,motivo,obs,concorrente,valorConcorrente}
//             | campos{campos} | itens{itens,total} | nota{texto} | anexo{anexo,tipo}
//             | resultado{itens:[{i, codigo, descricao, resultado: ganho|perdido|'', motivo?}]}
//               (o RESULTADO DE CADA ITEM e o motivo do perdido; lista que mudou na tela -> 409)
//             | removerAnexo{id} | pedido{anexo|anexoId|manual, oc,data,total,obs, resultados}
//               (virar pedido exige TODO item marcado ganho|perdido, ao menos
//               um ganho — resultados = as marcas, no formato de 'resultado' — 21/10/26)
//             | pi{estado,previa,enviado,erro} | leitura{dados,leitura,sobrescrever}
//             | descartar{descartado,motivo} | erp (busca o CNPJ no Dynamics de novo)
//             | ov{ov, obs?, forcar?, virarPedido?, resultados?}  (a cotação FECHA com a Ordem de Venda do
//               Dynamics — conferida no F&O; OV que não existe, já está em outra
//               cotação ou é de outro cliente -> 409 { confirmar:true, avisos }
//               sem forcar) | removerOv{ov, motivo?}
//             | proposta{anexo(PDF), para, copia?, assunto, canal}  (a proposta
//               no modelo da Biomedical foi enviada ao comprador — registra)
//   POST /api/cot-casos {acao:'amostra', numero, obs?, forcar?} -> { ok, caso, original }
//        (23/10/26: a cotação PERDIDA vira uma AMOSTRA — uma cópia com número
//         próprio, fora de todas as contas; a original continua Perdida.
//         A segunda amostra da mesma perdida -> 409 { amostra, confirmar } sem forcar)
//
// O GET da lista devolve em `eu` a equipe de segurança (área), o
// telefone/cargo de quem está logado — o "Preparado por" da proposta — e as
// UNIDADES DE NEGÓCIO dela (eu.unidades, eu.unidadeConfirmada, eu.unidadeMotivo).
// Desde 22/10/2026 o GET da lista também passa para PERDIDA a cotação aberta
// com a data de vencimento passada, com o motivo "Comprador não informou o
// motivo" — uma vez só por caso (motor.perderVencidas). (De 20 a 21/10 a data
// era só um aviso e a Vencida automática voltava para Cotada.)
//
// Portão: quem tem a área Comercial, com id token VALIDADO (cot-motor.exigirEquipe).
// UNIDADE (20/10/2026): a tela manda o token delegado do Power BI em
// x-pbi-token; o RLS dele diz as unidades da pessoa (motor.comEscopo) e ela
// só vê — na lista, no caso, nos anexos e nas ações — as cotações delas. O
// dono vê todas. Cotação de outra unidade responde como inexistente (404).
// Cada ação grava QUEM fez, com a identidade do login.
// ================================================================

const motor = require('../shared/cot-motor');
const store = require('../shared/cot-store');
const H = require('../shared/cot-http');

function cfgParaTela(cfg) {
  return {
    fases: motor.FASES, fasesAmostra: motor.FASES_AMOSTRA, portais: cfg.portais, motivosPerda: cfg.motivosPerda, motivosCancelamento: cfg.motivosCancelamento,
    // os motivos da Perdida, juntos (perda + cancelamento + proposta vencida — 21/10/26)
    motivosDaPerda: motor.motivosDaPerda(cfg),
    empresas: cfg.empresas, areas: cfg.areas, avisoDias: cfg.avisoDias
  };
}

module.exports = async function (context, req) {
  if (H.preflight(context, req)) return;
  try {
    const quem = await motor.comEscopo(req, await motor.exigirEquipe(req));
    const esc = quem.escopo || {};
    const eu = { email: quem.email, nome: quem.nome, admin: quem.admin,
      // acesso full (admin / grupo sem restrição): escolhe o submódulo do CRM
      full: !!quem.full,
      // as unidades de negócio da pessoa no Power BI (o RLS dela)
      unidades: esc.unidades || [], unidadeConfirmada: !!esc.conhecido, unidadeMotivo: esc.conhecido ? '' : motor.motivoUnidade(esc) };
    // a equipe de segurança (área do caso) e o contato que vai na proposta
    const comPerfil = async function () { return Object.assign(eu, await motor.perfilDe(quem)); };

    // o CRM do Comercial (04/11/2026): só QUEM é a pessoa — acesso full e as
    // unidades do RLS —, sem a lista, para a home do CRM abrir o submódulo
    // dela (Venda Recorrente, BIO.ID ou Venda Consultiva)
    if (req.method === 'GET' && (req.query || {}).eu) {
      return H.ok(context, req, { ok: true, eu: eu });
    }

    // 05/11/2026 (RECORTE MSB): as consultas de CADASTRO — o comprador no
    // Dynamics e o produto no Salesforce (a descrição, o fabricante e o RMS) —
    // não dependem do armazenamento das cotações: respondem mesmo sem ele
    // (antes, sem o container, o Fabricante e o RMS não vinham)
    if (req.method === 'GET') {
      const q = req.query || {};
      // o comprador no Dynamics, pelo CNPJ (o agente consulta ao ler o PDF)
      if (q.cliente) {
        let v;
        try { v = await motor.consultarErp(String(q.cliente), true); }
        catch (e) { return H.ok(context, req, { ok: true, erp: { achou: false, erro: e.publicMessage || e.message } }); }
        return H.ok(context, req, { ok: true, erp: v || { achou: false, desligado: true } });
      }
      // o comprador pelo código do cliente (o Agente: "buscar pelo código")
      if (q.codigoCliente) {
        let v;
        try { v = await motor.consultarErpCodigo(String(q.codigoCliente), true); }
        catch (e) { return H.ok(context, req, { ok: true, erp: { achou: false, erro: e.publicMessage || e.message } }); }
        return H.ok(context, req, { ok: true, erp: v || { achou: false, desligado: true } });
      }
      // o produto no Salesforce (a descrição, o fabricante e o RMS da proposta)
      if (q.produtos) {
        return H.ok(context, req, Object.assign({ ok: true }, await motor.produtosSf(String(q.produtos).split(','))));
      }
    }

    if (!store.configurado()) {
      return H.ok(context, req, { ok: true, configurado: false, eu: await comPerfil(), rev: 0, casos: [], cfg: cfgParaTela(quem.cfg) });
    }

    if (req.method === 'GET') {
      const q = req.query || {};
      // a FAMÍLIA dos produtos das cotações que a pessoa vê (o Analítico),
      // no Power BI com o token dela
      if (q.familias) {
        const ixF = await motor.listar(), cods = [];
        (ixF.casos || []).forEach(function (r) {
          if (!r.descartado && motor.veCaso(quem, r)) (r.itensRes || []).forEach(function (x) { if (x && x[0]) cods.push(x[0]); });
        });
        const f = await motor.familias(cods, quem, String((req.headers || {})['x-pbi-token'] || ''));
        return H.ok(context, req, Object.assign({ ok: true }, f));
      }
      // as Ordens de Venda do cliente da cotação no Dynamics (o "Já tenho a OV" — 21/10/26)
      if (q.ovsDe) {
        return H.ok(context, req, Object.assign({ ok: true }, await motor.ovsDaCotacao(String(q.ovsDe), quem, q.todas === '1' || q.todas === 'true')));
      }
      if (q.duplicado) {
        return H.ok(context, req, { ok: true, caso: await motor.duplicado(String(q.portal || ''), String(q.cotacao || ''), quem.cfg, quem) });
      }
      if (q.numero && q.anexo) {
        return H.ok(context, req, Object.assign({ ok: true }, await motor.arquivo(String(q.numero), String(q.anexo), quem)));
      }
      if (q.numero) {
        const c = await motor.obter(String(q.numero), quem);
        if (!c) { const e = new Error('nao encontrado'); e.status = 404; e.publicMessage = 'Cotação não encontrada.'; throw e; }
        return H.ok(context, req, { ok: true, caso: c });
      }
      let ix = await motor.listar();
      // a cotação aberta com o prazo vencido vira Perdida (22/10/26)
      if (await motor.perderVencidas(ix)) ix = await motor.listar();
      // o resumo antigo ganha os itens com o resultado (a análise de itens do funil)
      if (await motor.completarResumos(ix)) ix = await motor.listar();
      if (q.rev != null && q.rev !== '' && Number(q.rev) === Number(ix.rev || 0)) {
        return H.ok(context, req, { ok: true, mudou: false, rev: ix.rev || 0 });
      }
      return H.ok(context, req, {
        ok: true, configurado: true, eu: await comPerfil(), rev: ix.rev || 0, seq: ix.seq || 0, atualizadoEm: ix.atualizadoEm || null,
        // só as cotações das unidades da pessoa (o dono vê todas)
        casos: (ix.casos || []).filter(function (r) { return motor.veCaso(quem, r); }), cfg: cfgParaTela(quem.cfg)
      });
    }

    const b = req.body || {};
    if (b.acao === 'novo') {
      const c = await motor.novo(b, quem);
      return H.ok(context, req, { ok: true, caso: c });
    }
    // o lote da A faturar no Dynamics (29/10/26): existe para o produto? — a tela
    // confere enquanto a pessoa digita; o motor confere de novo ao gravar
    if (b.acao === 'lotes') {
      return H.ok(context, req, Object.assign({ ok: true }, await motor.conferirLotes(b.itens)));
    }
    // a amostra (23/10/26): a cópia da perdida, com número próprio — devolve as duas
    if (b.acao === 'amostra') {
      return H.ok(context, req, Object.assign({ ok: true }, await motor.criarAmostra(String(b.numero || ''), b, quem)));
    }
    const c = await motor.agir(String(b.numero || ''), b, quem);
    return H.ok(context, req, { ok: true, caso: c });
  } catch (err) {
    H.falhar(context, req, 'cot-casos', err);
  }
};
