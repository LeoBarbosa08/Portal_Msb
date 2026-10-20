// ================================================================
// /api/consig-processo — PI · Consignação (INCOMPLETO), versão de 19/10/2026
//
// O agente tem dois caminhos (a tela é pages/pi-consignacao-incompleto.html):
//   1. CRIAR processo de consignação — lê o PDF do consignado
//      (/api/pedido-extrair, perfil 'consignado'), acha o cliente pelo CNPJ e:
//        · existe ordem de devolução → lista as devoluções EM ABERTO do
//          cliente para marcar os itens/lotes do PDF (e para por aí);
//        · não existe → cria o cabeçalho e as linhas da ordem de devolução.
//   2. FATURAR processo de consignação — CNPJ → código do cliente → as
//      ordens de venda EM ABERTO dele.
//
//   GET  /api/consig-processo                  -> estado (D365, escrita on/off, quem pode gravar)
//   POST { acao:'cliente', cnpj }              -> cliente no cadastro do D365 (CustomersV3)
//   POST { acao:'devolucoes', cliente }        -> devoluções em aberto + linhas
//   POST { acao:'planejar', cliente, itens, referencia }  -> o que iria para o Dynamics
//   POST { acao:'criar', cliente, itens, referencia }     -> cria a devolução (ou simula)
//   POST { acao:'ovs', cliente }               -> ordens de venda em aberto
//   POST { acao:'ovLinhas', ov }               -> linhas de uma OV
//
// SÓ LEITURA, exceto 'criar' — e 'criar' só grava com CONSIG_D365_ESCRITA=true;
// sem ela SIMULA (devolve as requisições exatas, nada é gravado). Gravar de
// verdade exige token VALIDADO (com AUTH_ENFORCE off a identidade pode vir de
// header, e isso não basta para escrever no ERP) e a área Comercial ou
// Estoque — ou estar em CONSIG_AUTORIZADOS, quando a lista existe.
//
// Dynamics: shared/consig-d365.js (entidades, colunas, envs) · cliente pelo
// CNPJ: shared/cot-erp.js (o mesmo das Cotações).
// ================================================================
'use strict';

const D    = require('../shared/d365');
const auth = require('../shared/auth');
const http = require('../shared/http');
const ERP  = require('../shared/cot-erp');
const K    = require('../shared/consig-d365');

const VERSAO = '2026-10-19';
const CFG = K.config(process.env);

// Pode GRAVAR no Dynamics? (só importa com a escrita ligada)
async function podeGravar(base) {
  if (!CFG.escrita || !D.CONFIGURED) return { ok: false, simulacao: true, motivo: 'Modo simulação: nada é gravado no Dynamics.' };
  if (!base.validated) return { ok: false, motivo: 'Para gravar no Dynamics é preciso o login validado. Saia e entre de novo no portal.' };
  const email = String((base.user && base.user.email) || '').trim().toLowerCase();
  if (CFG.autorizados.length) {
    return CFG.autorizados.indexOf(email) >= 0 ? { ok: true }
      : { ok: false, motivo: 'Seu usuário não está entre os que podem criar devolução no Dynamics (CONSIG_AUTORIZADOS).' };
  }
  const areas = base.areas || (await auth.authorizedAreas(base.user)).areas;
  return areas.indexOf('comercial') >= 0 || areas.indexOf('estoque') >= 0
    ? { ok: true } : { ok: false, motivo: 'Sem acesso às áreas Comercial ou Estoque.' };
}

module.exports = async function (context, req) {
  const reply = (status, body) => {
    context.res = { status, headers: Object.assign({ 'Content-Type': 'application/json' }, http.cors(req)), body };
  };
  if (req.method === 'OPTIONS') { context.res = http.preflight(req); return; }

  try {
    const base = await auth.requireArea(req, ['comercial', 'estoque']);
    const quem = String((base.user && (base.user.name || base.user.email)) || '').trim() || 'desconhecido';

    if (req.method === 'GET') {
      const perm = await podeGravar(base);
      reply(200, {
        ok: true, versao: VERSAO, configurado: D.CONFIGURED, escrita: CFG.escrita, empresa: CFG.empresa.toUpperCase(),
        podeGravar: perm.ok === true, motivoNaoGrava: perm.ok ? '' : perm.motivo,
        entidades: { devolucao: [CFG.entDevCab[0], CFG.entDevLin[0]], ordemVenda: [CFG.entOvCab[0], CFG.entOvLin[0]] }
      });
      return;
    }
    if (req.method !== 'POST') { reply(405, { ok: false, error: 'Método não suportado.' }); return; }

    const b = req.body || {};
    const acao = String(b.acao || '');
    if (!D.CONFIGURED) { reply(200, { ok: true, configurado: false, error: 'Conexão com o Dynamics não configurada (credenciais D365_* na Static Web App).' }); return; }

    if (acao === 'cliente') {
      const r = await ERP.clientePorCnpj(b.cnpj, { timeoutMs: 15000 });
      reply(200, Object.assign({ ok: true, configurado: true }, r));
      return;
    }

    const token = await D.getToken();

    if (acao === 'devolucoes') {
      const r = await K.devolucoesAbertas(b.cliente, CFG, token);
      reply(200, Object.assign({ ok: true, configurado: true }, r));
      return;
    }

    if (acao === 'ovs') {
      const r = await K.ovsAbertas(b.cliente, CFG, token);
      reply(200, Object.assign({ ok: true, configurado: true }, r));
      return;
    }

    if (acao === 'ovLinhas') {
      const r = await K.linhasOv(b.ov, CFG, token);
      reply(200, Object.assign({ ok: true, configurado: true }, r));
      return;
    }

    if (acao === 'planejar' || acao === 'criar') {
      const dados = { cliente: b.cliente, itens: b.itens, referencia: b.referencia };
      const plano = await K.planoDevolucao(dados, CFG, token);
      const perm = await podeGravar(base);
      const resumo = {
        cliente: plano.cliente, empresa: CFG.empresa.toUpperCase(),
        cabecalho: { entidade: plano.cabecalho.entidade, mapeamento: plano.cabecalho.mapeamento, sondado: plano.cabecalho.sondado },
        linhas: { entidade: plano.linhas.entidade, mapeamento: plano.linhas.mapeamento, sondado: plano.linhas.sondado,
                  itens: plano.linhas.itens.map(l => l.item) },
        requisicoes: K.requisicoesDoPlano(plano),
        avisos: plano.avisos, erros: plano.erros,
        escrita: CFG.escrita, podeGravar: perm.ok === true, motivoNaoGrava: perm.ok ? '' : perm.motivo
      };
      if (acao === 'planejar') { reply(200, Object.assign({ ok: true }, resumo)); return; }

      if (plano.erros.length) { reply(400, Object.assign({ ok: false, error: plano.erros[0] }, resumo)); return; }
      if (!perm.ok) {
        // simulação (escrita desligada) ou sem permissão: não grava nada
        reply(perm.simulacao ? 200 : 403, Object.assign({ ok: !!perm.simulacao, simulacao: !!perm.simulacao, gravado: false,
          error: perm.simulacao ? undefined : perm.motivo }, resumo));
        return;
      }
      const repetida = K.jaCriada(plano);
      if (repetida) { reply(200, Object.assign({ ok: true, gravado: true, repetido: true }, resumo, repetida)); return; }
      const feito = await K.gravar(plano, CFG, token);
      K.lembrar(plano, feito);
      context.log && context.log('[consig-processo] devolução criada', feito.numero, 'cliente', plano.cliente, 'por', quem, '·', feito.linhas.length, 'linha(s)');
      reply(200, Object.assign({ ok: true, gravado: true }, resumo, feito));
      return;
    }

    reply(400, { ok: false, error: 'Ação desconhecida.' });
  } catch (err) {
    if (err && err.publico) {
      http.logError(context, 'consig-processo', err);
      reply(err.statusHttp || 502, Object.assign({ ok: false, error: err.message }, err.extra || {}));
      return;
    }
    // erro do F&O sem tratamento (permissão, prazo): o motivo legível vai à tela
    if (err && /^(F&O \d{3}|o Dynamics não respondeu)/.test(String(err.message || ''))) {
      http.logError(context, 'consig-processo', err);
      reply(502, { ok: false, error: 'Dynamics: ' + K.motivoFO(err) });
      return;
    }
    http.sendError(context, req, 'consig-processo', err);
  }
};
