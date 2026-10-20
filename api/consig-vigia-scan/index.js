// ================================================================
// /api/consig-vigia-scan — Vigia de Consignação · varredura
//
// Recebe as linhas já lidas do modelo de Estoque, roda o MOTOR DE REGRAS
// (api/shared/consig-regras.js) e mescla o resultado na fila de aprovação.
//
// DOIS CHAMADORES, o mesmo motor:
//   1) NAVEGADOR (hoje) — pages/estoque-vigia.html lê o Power BI com o token
//      MSAL do próprio operador (as páginas de Estoque já fazem isso, e é essa
//      a fonte validada) e faz POST { dados }. Auth: requireArea('estoque').
//   2) CRON (quando o Service Principal puder executar DAX no workspace do
//      Estoque) — o GitHub Actions faz POST { dados } com header x-vigia-key,
//      sem usuário. Auth: chave compartilhada, no molde do Radar da LICI, para
//      seguir funcionando mesmo com AUTH_ENFORCE ligado.
//
// A troca de (1) para (2) NÃO mexe neste arquivo nem no motor: muda só quem
// lê o DAX. É o ponto do plano — a fila e as regras nascem independentes.
//
// Env: VIGIA_BLOB_URL (persistência), VIGIA_KEY (chamada do cron).
//      Sem blob, a varredura é calculada e devolvida, mas não persiste.
// ================================================================

const blob   = require('../shared/vigia-blob');
const regras = require('../shared/consig-regras');
const auth   = require('../shared/auth');
const http   = require('../shared/http');

const FILA = 'fila.json';
const HIST = 'historico.json';

// Teto de segurança do request. Acima disso a varredura é recusada com uma
// instrução clara, em vez de estourar em silêncio no meio do processamento.
const MAX_LINHAS = 60000;

function tabelaOk(t, nome) {
  if (!t) return { cols: [], rows: [] };
  if (!Array.isArray(t.cols) || !Array.isArray(t.rows)) throw http.badRequest('tabela "' + nome + '" inválida: esperado { cols:[], rows:[[]] }.');
  return t;
}

module.exports = async function (context, req) {
  const reply = (status, body) => {
    context.res = { status, headers: Object.assign({ 'Content-Type': 'application/json' }, http.cors(req)), body };
  };
  if (req.method === 'OPTIONS') { context.res = http.preflight(req); return; }
  if (req.method !== 'POST') { reply(405, { ok: false, error: 'Use POST.' }); return; }

  try {
    // ── autenticação: chave do cron OU usuário com a área de Estoque ──
    const chave = String((req.headers && (req.headers['x-vigia-key'] || req.headers['X-Vigia-Key'])) || '');
    const esperada = String(process.env.VIGIA_KEY || '');
    const viaCron = !!(esperada && chave && chave === esperada);
    let operador = 'cron';
    if (!viaCron) {
      const sess = await auth.requireArea(req, 'estoque');
      operador = (sess && sess.user && (sess.user.email || sess.user.name)) || 'navegador';
    }

    const b = req.body || {};
    const dados = b.dados || b;
    const saldo = tabelaOk(dados.saldo, 'saldo');
    if (!saldo.rows.length) { reply(400, { ok: false, error: 'A varredura não trouxe nenhuma linha de saldo.' }); return; }
    if (saldo.rows.length > MAX_LINHAS) {
      reply(400, { ok: false, error: 'Varredura com ' + saldo.rows.length + ' linhas (teto ' + MAX_LINHAS + '). Reduza o limite da consulta.' });
      return;
    }
    tabelaOk(dados.giro90, 'giro90');
    tabelaOk(dados.giro180, 'giro180');
    tabelaOk(dados.devol, 'devol');

    // ── motor determinístico ──
    const resultado = regras.classificar(dados);

    // ── mescla com a fila (decisão do operador é preservada) ──
    // Blob quebrado NÃO invalida a varredura: ela já foi calculada e vale ser
    // vista. Degrada para "sem persistência" e devolve o motivo, em vez de 500.
    let blobErro = null;
    let antiga = { atualizadoEm: null, itens: [] };
    if (blob.configurado()) {
      try { antiga = await blob.lerJson(FILA, antiga); }
      catch (e) {
        const d = blob.diagnostico(e); if (!d) throw e;
        blobErro = d; http.logError(context, 'consig-vigia-scan/ler', e);
      }
    }
    const fila = regras.mesclar(antiga, resultado);
    fila.origem = viaCron ? 'cron' : 'navegador';
    fila.operador = operador;

    let persistido = false;
    if (blob.configurado() && !blobErro) {
      try {
        await blob.gravarJson(FILA, fila);
        persistido = true;
        // histórico das varreduras (KPIs da Fase 4: R$ recolhido, perda evitada,
        // dias entre detectar e recolher). Só o resumo, não os itens.
        const h = await blob.lerJson(HIST, { execucoes: [] });
        h.execucoes = (h.execucoes || []).concat([Object.assign({ em: fila.atualizadoEm, origem: fila.origem, operador: operador }, fila.resumo)]).slice(-400);
        await blob.gravarJson(HIST, h);
      } catch (e) {
        const d = blob.diagnostico(e); if (!d) throw e;
        blobErro = d; http.logError(context, 'consig-vigia-scan/gravar', e);
      }
    }

    reply(200, {
      ok: true,
      configured: blob.configurado() && !blobErro,
      persistido,
      blobErro,
      atualizadoEm: fila.atualizadoEm,
      resumo: fila.resumo,
      itens: fila.itens
    });
  } catch (err) {
    http.sendError(context, req, 'consig-vigia-scan', err);
  }
};
