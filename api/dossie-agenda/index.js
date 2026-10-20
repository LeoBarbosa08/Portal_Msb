// ================================================================
// /api/dossie-agenda  —  Dossiê de Visita (Comercial) · SOMENTE LEITURA
//
// "Quem eu visito amanhã?" — lê a AGENDA do próprio usuário no Outlook
// (Microsoft Graph, calendarView) e tenta casar cada compromisso com um
// cliente da carteira, para o vendedor abrir o dossiê de cada visita do dia
// sem digitar CNPJ. Não escreve nada, não cria nem altera compromisso.
//
//   GET /api/dossie-agenda?dias=1        (0 = hoje, 1 = amanhã, padrão 1)
//   -> { ok, disponivel, motivo?, dia, eventos:[{ inicio, fim, assunto,
//        local, organizador, cliente:{cnpj,nome}|null, confianca }] }
//
// PERMISSÃO (o que falta para isto funcionar de verdade):
//   o app do portal (PORTAL_CLIENT_ID) usa Graph app-only com `.default`, e
//   hoje esse grant cobre Users/Groups/Sites/Mail.Send — NÃO cobre agenda.
//   É preciso conceder **Calendars.Read** de APLICATIVO com consentimento do
//   admin. Sem isso o Graph devolve 403 e este endpoint responde
//   `disponivel:false` com o motivo — a página mostra o recado, e nada quebra.
//   Opcional: `DOSSIE_AGENDA_ESCOPO` limita a leitura a um grupo de e-mails
//   (lista separada por vírgula); vazio = só a agenda de quem chamou.
//
// O casamento com a carteira é por NOME (assunto/local do compromisso), com
// normalização e exigência de um token forte — nunca por adivinhação solta.
// A confiança vem junto ('alta' | 'media') e a página deixa o vendedor
// confirmar antes de abrir o dossiê.
// ================================================================

const auth = require('../shared/auth');
const http = require('../shared/http');

const GRAPH = 'https://graph.microsoft.com/v1.0';
const MAX_EVENTOS = Number(process.env.DOSSIE_AGENDA_MAX || 25);
const ESCOPO = String(process.env.DOSSIE_AGENDA_ESCOPO || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// sufixo societário não ajuda a identificar e some do nome no compromisso
const SUFIXO = new Set(['LTDA', 'SA', 'EIRELI', 'ME', 'EPP', 'S', 'A', 'CIA', 'EPPS']);
// palavras comuns a MUITOS clientes: casar SÓ por elas seria chute
const GENERICO = new Set(['HOSPITAL', 'CLINICA', 'INSTITUTO', 'CENTRO', 'SANTA', 'SANTO', 'SAO',
  'MEDICO', 'MEDICA', 'SAUDE', 'MUNICIPAL', 'ESTADUAL', 'FUNDACAO', 'ASSOCIACAO', 'CASA', 'DE', 'DA', 'DO', 'DOS', 'DAS']);

function norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokensDoNome(nome) {
  return norm(nome).split(' ').filter(w => w.length >= 3 && !SUFIXO.has(w));
}

// Casa o texto do compromisso com a carteira. Exige que TODAS as palavras do
// nome do cliente (menos o sufixo societário) apareçam no texto, e que pelo
// menos uma delas NÃO seja genérica — senão "Visita hospital" casaria com o
// primeiro hospital da lista. Empate: vence o nome mais específico.
function casar(texto, clientes) {
  const t = ' ' + norm(texto) + ' ';
  if (t.length < 5) return null;
  let melhor = null, melhorPeso = -1, melhorToks = 0;
  for (const c of clientes) {
    const toks = tokensDoNome(c.nome);
    if (!toks.length) continue;
    const proprios = toks.filter(w => !GENERICO.has(w));
    if (!proprios.length) continue;                       // nome só de palavra comum: não arrisca
    if (!toks.every(w => t.indexOf(' ' + w) >= 0)) continue;
    const peso = proprios.join('').length;
    if (peso > melhorPeso) { melhorPeso = peso; melhor = c; melhorToks = toks.length; }
  }
  if (!melhor) return null;
  // nome com 2+ palavras casadas = alta; uma palavra só = média (confirmar)
  return { cnpj: melhor.cnpj, nome: melhor.nome, confianca: melhorToks >= 2 ? 'alta' : 'media' };
}

function diaDe(offset) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  const fim = new Date(d.getTime() + 86400000);
  return { ini: d.toISOString(), fim: fim.toISOString(), dia: d.toISOString().slice(0, 10) };
}

async function lerAgenda(email, janela) {
  const tok = await auth.getAppToken();
  if (!tok) return { disponivel: false, motivo: 'O portal não tem segredo de aplicativo configurado (PORTAL_CLIENT_SECRET).' };
  const url = GRAPH + '/users/' + encodeURIComponent(email) + '/calendarView' +
    '?startDateTime=' + encodeURIComponent(janela.ini) + '&endDateTime=' + encodeURIComponent(janela.fim) +
    '&$select=subject,start,end,location,organizer,isCancelled,showAs&$orderby=start/dateTime&$top=' + MAX_EVENTOS;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok, Prefer: 'outlook.timezone="E. South America Standard Time"' } });
  if (r.status === 403) return { disponivel: false, motivo: 'O app do portal ainda não tem a permissão Calendars.Read de aplicativo (precisa de consentimento do administrador no Entra).' };
  if (r.status === 404) return { disponivel: false, motivo: 'Caixa de e-mail não encontrada para ' + email + '.' };
  if (!r.ok) return { disponivel: false, motivo: 'Microsoft Graph respondeu ' + r.status + '.' };
  const j = await r.json();
  return { disponivel: true, eventos: (j.value || []) };
}

module.exports = async function (context, req) {
  const cors = http.cors(req);
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: cors }; return; }
  const json = function (status, body) {
    context.res = { status: status, headers: Object.assign({ 'Content-Type': 'application/json' }, cors), body: body };
  };

  try {
    await auth.requireArea(req, 'comercial');
    const { user } = await auth.requireUser(req);
    const q = (req.query || {});

    // a agenda lida é SEMPRE a de quem chamou, salvo lista explícita em env
    let alvo = String(user.email || '').toLowerCase();
    const pedido = String(q.email || '').toLowerCase();
    if (pedido && pedido !== alvo) {
      if (!ESCOPO.length || ESCOPO.indexOf(pedido) < 0) throw http.badRequest('Você só pode ler a sua própria agenda.');
      alvo = pedido;
    }
    if (!alvo) throw http.badRequest('Não consegui identificar o seu e-mail para ler a agenda.');

    const dias = Math.max(0, Math.min(7, Number(q.dias == null ? 1 : q.dias) || 0));
    const janela = diaDe(dias);

    const ag = await lerAgenda(alvo, janela);
    if (!ag.disponivel) { json(200, { ok: true, disponivel: false, motivo: ag.motivo, dia: janela.dia, eventos: [] }); return; }

    // carteira para o casamento (mesma base do BioLeads; falha sozinha)
    let clientes = [];
    try {
      const CL = require('../shared/clientes');
      if (CL.CONFIGURED) {
        const base = await CL.getBase();
        clientes = (base.clientes || []).filter(c => c.nome && c.cnpj);
      }
    } catch (e) { http.logError(context, 'dossie-agenda/carteira', e); }

    const eventos = ag.eventos
      .filter(e => !e.isCancelled)
      .map(function (e) {
        const local = (e.location && e.location.displayName) || '';
        const cli = clientes.length ? casar((e.subject || '') + ' ' + local, clientes) : null;
        return {
          inicio: e.start && e.start.dateTime, fim: e.end && e.end.dateTime,
          assunto: e.subject || '(sem assunto)', local: local,
          organizador: (e.organizer && e.organizer.emailAddress && e.organizer.emailAddress.name) || '',
          cliente: cli ? { cnpj: cli.cnpj, nome: cli.nome } : null,
          confianca: cli ? cli.confianca : null
        };
      });

    json(200, { ok: true, disponivel: true, dia: janela.dia, agenda: alvo,
      carteira: clientes.length, eventos: eventos,
      comCliente: eventos.filter(e => e.cliente).length });
  } catch (err) {
    http.sendError(context, req, 'dossie-agenda', err);
  }
};

module.exports._interno = { casar, norm, diaDe };
