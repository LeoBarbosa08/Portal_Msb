// ================================================================
// /api/avisos — Portal Biomedical · Central de Avisos (server-side)
//
// GET    -> lista os avisos (qualquer usuário autenticado)
// POST   { assunto, corpo, cat, anexos? } -> publica um aviso. O AUTOR é o
//          E-MAIL da identidade VALIDADA (auth.requireUser) — nunca vem do
//          cliente. O "setor" vem do GRUPO DE SEGURANÇA (auth.authorizedAreas).
// DELETE  ?id=... -> exclui um aviso. Só o AUTOR ou quem é diretoria/TI/BI
//          (grupo sem restrição / admin) pode excluir.
//
// Persistência: api/shared/avisos-store.js (Azure Blob via SAS). Sem blob
// configurado, o GET responde configured:false e o front cai no localStorage.
//
// Identidade/autorização: api/shared/auth.js (valida o id token do Entra e
// resolve os grupos AAD via app-only). Segue o rollout faseado do AUTH_ENFORCE.
// ================================================================

const store = require('../shared/avisos-store');
const auth  = require('../shared/auth');
const http  = require('../shared/http');

const MAX = 500;
const CATS = ['diretoria', 'pessoas', 'eventos', 'qualidade', 'ti', 'comercial', 'financeiro', 'logistica', 'estoque'];

// área (data-area do AAD) → rótulo amigável p/ o "setor" do aviso
const AREA_LABEL = {
  comercial: 'Comercial', financeiro: 'Financeiro', logistica: 'Logística',
  marketing: 'Marketing', estoque: 'Estoque', contabil: 'Contábil',
  licitacao: 'Licitações', administrativo: 'Administrativo', produtos: 'Produtos',
  pessoas: 'Pessoas & Cultura', qualidade: 'Qualidade & Regulatório', ti: 'TI & Sistemas'
};

// O mural NÃO tem mais avisos de demonstração. Em 03/09/26 o portal zerou o
// quadro (os 6 seeds 's1'..'s6' + os avisos de teste publicados): nada ali era
// comunicado de verdade. A limpeza roda UMA vez no blob — a marca `purge` fica
// gravada junto com os itens e, a partir dela, só existe o que gente publicar.
const PURGE = '2026-09-03';

function initials(s) {
  var n = String(s || '').trim();
  if (!n) return 'US';
  if (n.indexOf('@') > -1) n = n.split('@')[0].replace(/[._\-]+/g, ' ');
  if (n.indexOf(',') > -1) n = (n.split(',')[1] || n).trim();
  var p = n.split(/\s+/).filter(Boolean);
  var a = (p[0] || '')[0] || '';
  var b = p.length > 1 ? (p[p.length - 1][0] || '') : '';
  return ((a + b).toUpperCase() || (n[0] || '').toUpperCase()) || 'US';
}

function novoId() {
  return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function dataBR(now) {
  try {
    return now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' }).toUpperCase();
  } catch (e) {
    return now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  }
}

// "setor" a partir do grupo de segurança (autoritativo). Cai no nome da
// pessoa (ou "Biomedical") quando não é restrito por área ou o Graph falha.
async function setorDe(user) {
  try {
    const az = await auth.authorizedAreas(user);
    // acesso full também volta RESTRITO quando uma reserva estrita (Compras)
    // é podada dele — mas segue sem "setor": as primeiras áreas da lista não
    // dizem nada sobre quem é.
    const full = az && (az.reason === 'admin' || az.reason === 'unrestricted_group');
    if (az && az.restricted && !full && Array.isArray(az.areas) && az.areas.length) {
      return az.areas.map(a => AREA_LABEL[a] || a).slice(0, 2).join(' · ');
    }
  } catch (e) { /* fail-open p/ o nome */ }
  const nome = (user && user.name) || '';
  return (nome && nome !== (user && user.email)) ? nome : 'Biomedical';
}

async function ehPrivilegiado(user) {
  try {
    const az = await auth.authorizedAreas(user);
    return !!(az && (az.reason === 'admin' || az.reason === 'unrestricted_group'));
  } catch (e) { return false; }
}

// Grava a lista SEMPRE com a marca `purge` — sem ela a limpeza rodaria de novo
// no GET seguinte e levaria junto o aviso recém-publicado.
async function salvar(itens) {
  const data = { atualizadoEm: new Date().toISOString(), seeded: true, purge: PURGE, itens };
  await store.write(data);
  return data;
}

// Zera o mural uma única vez (marca `purge` persistida no blob). Depois disso
// devolve o que está lá, sem tocar em nada.
async function ensureLimpo() {
  const data = await store.read();
  if (data.purge === PURGE) return data;
  return salvar([]);
}

module.exports = async function (context, req) {
  const reply = (status, body) => {
    context.res = { status, headers: Object.assign({ 'Content-Type': 'application/json' }, http.cors(req)), body };
  };
  if (req.method === 'OPTIONS') { context.res = http.preflight(req); return; }

  try {
    const { user } = await auth.requireUser(req);
    const email = ((user && user.email) || '').toLowerCase();

    // Sem blob configurado: GET degrada (o front usa localStorage); escrita não tem onde ir.
    if (!store.configured()) {
      if (req.method === 'GET') { reply(200, { ok: true, configured: false, atualizadoEm: null, itens: [] }); return; }
      reply(400, { ok: false, error: 'Armazenamento de avisos não configurado. Defina AVISOS_BLOB_URL (ou reutilize RADAR_BLOB_URL).' });
      return;
    }

    const data = await ensureLimpo();
    const itens = data.itens || [];

    // ── GET: lista ──────────────────────────────────────────────
    if (req.method === 'GET') {
      reply(200, { ok: true, configured: true, atualizadoEm: data.atualizadoEm, itens });
      return;
    }

    // ── POST: publica ───────────────────────────────────────────
    if (req.method === 'POST') {
      if (!email) { reply(401, { ok: false, error: 'Não autenticado.' }); return; }
      const b = req.body || {};
      const assunto = String(b.assunto || '').trim().slice(0, 180);
      const corpo = String(b.corpo || '').trim().slice(0, 5000);
      let cat = String(b.cat || '').trim().toLowerCase();
      if (!assunto) { reply(400, { ok: false, error: 'Informe o assunto.' }); return; }
      if (!corpo) { reply(400, { ok: false, error: 'A mensagem não pode ficar em branco.' }); return; }
      if (CATS.indexOf(cat) < 0) cat = 'diretoria';
      const anexos = Array.isArray(b.anexos)
        ? b.anexos.map(x => String((x && x.name) || x || '').slice(0, 200)).filter(Boolean).slice(0, 20)
        : [];

      const now = new Date();
      const novo = {
        id: novoId(),
        cat: cat,
        autor: email,                       // AUTOR = e-mail da identidade validada
        email: email,
        setor: await setorDe(user),         // "setor" do grupo de segurança
        sigla: initials((user && user.name) || email),
        assunto: assunto,
        corpo: corpo,
        data: dataBR(now),
        ts: now.getTime(),
        anexos: anexos,
        unread: false
      };

      itens.unshift(novo);
      while (itens.length > MAX) itens.pop();
      await salvar(itens);
      reply(200, { ok: true, aviso: novo, total: itens.length });
      return;
    }

    // ── DELETE: exclui (autor ou diretoria/TI) ──────────────────
    if (req.method === 'DELETE') {
      const id = String((req.query && req.query.id) || (req.body && req.body.id) || '').trim();
      if (!id) { reply(400, { ok: false, error: 'Informe o id do aviso.' }); return; }
      const idx = itens.findIndex(a => a && a.id === id);
      if (idx < 0) { reply(404, { ok: false, error: 'Aviso não encontrado.' }); return; }

      const isAuthor = String((itens[idx].email || '')).toLowerCase() === email && !!email;
      if (!isAuthor && !(await ehPrivilegiado(user))) {
        reply(403, { ok: false, error: 'Somente o autor ou a diretoria/TI podem excluir este aviso.' });
        return;
      }
      itens.splice(idx, 1);
      await salvar(itens);
      reply(200, { ok: true, total: itens.length });
      return;
    }

    reply(405, { ok: false, error: 'Método não suportado.' });
  } catch (e) {
    http.sendError(context, req, 'avisos', e);
  }
};
