// ================================================================
// api/shared/kanban-email.js — o E-MAIL DA COTAÇÃO do Kanban
//
// Pedido do dono (12/11/2026): "vou criar uma automação de envio de e-mail:
// quando o PEDIDO cair em COTAÇÃO, se na OV Solicitartransportadora_Custom =
// Sim, você vai enviar automaticamente um e-mail para o cliente" — no modelo
// abaixo (montarEmail), com as CAIXAS da carga (BioWHSContainerV1Entity: cada
// ContainerId é uma caixa; Weight, Length, Width, Height).
//
// ── ENVIO ────────────────────────────────────────────────────────
// Microsoft Graph direto (escolha do dono), com o token de APLICATIVO do portal
// (auth.getAppToken — o app do portal tem Mail.Send de aplicativo):
//   POST /users/{KANBAN_EMAIL_DE}/sendMail
// Remetente e destinatários vêm SÓ das variáveis do Azure — nunca do código (o
// repositório é público) nem da tela (ninguém escolhe para quem vai):
//   KANBAN_EMAIL_DE    a caixa que envia (da empresa, no mesmo tenant)
//   KANBAN_EMAIL_PARA  destinatário(s), separados por vírgula (o teste agora;
//                      depois, o e-mail do cliente — o dono vai definir)
//   KANBAN_EMAIL_CC    cópia (opcional)
//   KANBAN_EMAIL_AUTO  "0" desliga o envio automático (o botão da ficha segue)
//   KANBAN_EMAIL_MAX   no máximo N envios automáticos por leitura (padrão 5)
//
// ── UMA VEZ SÓ POR OV ────────────────────────────────────────────
// Uma MARCA por OV num container de blob: kanban-email-cotacao/<OV>.json,
// criada com If-None-Match:* — só UMA instância consegue criar, e só ela envia
// (sem envio em dobro, mesmo com várias pessoas com o quadro aberto).
// Container: KANBAN_BLOB_URL (SAS de CONTAINER, sr=c, Read + Create + Write);
// sem ela, o do log de acessos (LOG_PORTAL_BLOB_URL).
// 12/11/26 (dono: "não precisa de blob ainda"): SEM nenhum dos dois, o portal
// lembra dos envios só na MEMÓRIA do servidor (processarNaMemoria) — vale para o
// teste; se o servidor reiniciar (ou houver mais de uma instância), a OV que
// continuar em Cotação pode receber de novo. Para clientes: o registro em blob.
// 12/11/26 (dono: "vai ser automática, não quero botão"): SÓ automático — sem o
// botão da ficha e sem a "base": as OVs que já estão em Cotação com Solicitar
// transportadora = Sim também recebem (uma vez cada, no máximo KANBAN_EMAIL_MAX
// por leitura).
// ================================================================

const auth = require('./auth');

const txt = (v) => String(v == null ? '' : v).trim();
const lista = (v) => txt(v).split(/[,;]/).map(s => s.trim()).filter(Boolean);
const DE   = () => txt(process.env.KANBAN_EMAIL_DE);
const PARA = () => lista(process.env.KANBAN_EMAIL_PARA);
const CC   = () => lista(process.env.KANBAN_EMAIL_CC);
const BLOB = () => txt(process.env.KANBAN_BLOB_URL || process.env.LOG_PORTAL_BLOB_URL);
const AUTO = () => txt(process.env.KANBAN_EMAIL_AUTO) !== '0';
const MAX  = () => Math.max(0, Number(process.env.KANBAN_EMAIL_MAX || 5));
const PASTA = 'kanban-email-cotacao/';
const FUSO_H = 3;   // Brasília = UTC-3

// o endereço de coleta e o horário (do modelo do dono; trocáveis por env)
const COLETA = () => txt(process.env.KANBAN_EMAIL_COLETA) || 'Rua Araponga, 364, qd 01, lt 19 — Lauro de Freitas/BA — CEP 42701-330';
const HORARIO = () => lista(process.env.KANBAN_EMAIL_HORARIO).length ? lista(process.env.KANBAN_EMAIL_HORARIO)
  : ['Seg. a Qui. — 08h às 17h30', 'Sex. — 08h às 16h30'];

function configurado() { return !!(DE() && PARA().length); }
function comRegistro() { return !!BLOB(); }

// ── o texto ──────────────────────────────────────────────────────
function saudacao(agora) {
  const h = new Date((agora || new Date()).getTime() - FUSO_H * 3600000).getUTCHours();
  return h < 12 ? 'bom dia' : h < 18 ? 'boa tarde' : 'boa noite';
}
const num = (v) => { const n = Number(v); return v == null || v === '' || isNaN(n) ? null : n; };
const fmt = (v, casas) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const fmtReal = (v) => 'R$ ' + fmt(v, 2);

// as caixas iguais juntas: o mesmo tipo e as mesmas medidas
function agruparCaixas(caixas) {
  const g = new Map();
  (caixas || []).forEach(c => {
    const tipo = txt(c.tipo) || 'Caixa', desc = txt(c.descricao) || tipo;
    const C = num(c.comprimento), L = num(c.largura), A = num(c.altura);
    const k = [tipo, desc, C, L, A].join('|');
    if (!g.has(k)) g.set(k, { n: 0, tipo, descricao: desc, C, L, A });
    g.get(k).n++;
  });
  return Array.from(g.values());
}
function linhaCaixa(x) {
  const med = [x.C, x.L, x.A].some(v => v != null)
    ? ' (C ' + (x.C != null ? fmt(x.C, 1) : '—') + ' x L ' + (x.L != null ? fmt(x.L, 1) : '—') + ' x A ' + (x.A != null ? fmt(x.A, 1) : '—') + ')' : '';
  return '• ' + x.n + 'x ' + x.tipo + ' — ' + x.descricao + med;
}

// d = { ov, cliente, caixas:[{ id, tipo, descricao, peso, comprimento, largura, altura }],
//       valor, cidade, uf, agora? }  ->  { assunto, texto, html, totalCaixas, pesoTotal }
function montarEmail(d) {
  const caixas = d.caixas || [];
  const grupos = agruparCaixas(caixas);
  const peso = caixas.reduce((s, c) => s + (num(c.peso) || 0), 0);
  const entrega = [txt(d.cidade), txt(d.uf)].filter(Boolean).join('/') || '—';
  const linhas = [
    'Prezados, ' + saudacao(d.agora) + '!',
    '',
    '📦 Pedido ' + d.ov + ' — pronto para faturamento e coleta',
    '👤 Cliente: ' + (txt(d.cliente) || '—'),
    '',
    '📦 Caixas:'
  ].concat(grupos.length ? grupos.map(linhaCaixa) : ['• (nenhuma caixa na carga)']).concat([
    '',
    '📊 Total: ' + caixas.length + ' caixa(s)',
    '⚖️ Peso total: ' + fmt(peso, 2) + ' kg',
    '💰 Valor do pedido: ' + (num(d.valor) != null ? fmtReal(d.valor) : '—'),
    '📍 Entrega: ' + entrega,
    '',
    '🚚 Gentileza informar qual transportadora fará a coleta, para que possamos programar a retirada e emitir a nota fiscal.',
    '',
    '📍 Coleta no nosso endereço:',
    COLETA(),
    '',
    '🕒 Horário de funcionamento:'
  ], HORARIO(), [
    '',
    'Permanecemos à disposição.'
  ]);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = '<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.45;color:#1f2328;">'
    + linhas.map(l => l === '' ? '<br>' : esc(l) + '<br>').join('') + '</div>';
  return { assunto: 'Pedido ' + d.ov + ' — pronto para faturamento e coleta', texto: linhas.join('\n'), html, totalCaixas: caixas.length, pesoTotal: Math.round(peso * 100) / 100 };
}

// ── o envio (Graph) ──────────────────────────────────────────────
async function enviar(email) {
  if (!configurado()) { const e = new Error('Falta configurar KANBAN_EMAIL_DE e KANBAN_EMAIL_PARA no Azure.'); e.status = 409; e.publicMessage = e.message; throw e; }
  const de = DE(), para = PARA(), cc = CC();
  const corpo = JSON.stringify({ message: {
    subject: email.assunto, body: { contentType: 'HTML', content: email.html },
    toRecipients: para.map(a => ({ emailAddress: { address: a } })),
    ccRecipients: cc.map(a => ({ emailAddress: { address: a } }))
  }, saveToSentItems: true });
  const url = 'https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(de) + '/sendMail';
  let r = null;
  for (const novo of [false, true]) {
    const tok = await auth.getAppToken(novo);
    if (!tok) { const e = new Error('O portal não tem o segredo do app (PORTAL_CLIENT_SECRET) para o Graph.'); e.status = 409; e.publicMessage = e.message; throw e; }
    r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: corpo });
    if (r.status !== 401) break;   // 401: token velho — tenta um novo uma vez
  }
  if (r.status !== 202 && !r.ok) {
    let det = ''; try { const j = JSON.parse(await r.text()); det = (j.error && (j.error.message || j.error.code)) || ''; } catch (e) {}
    const dica = r.status === 403 ? ' — o app do portal precisa da permissão Mail.Send de aplicativo (e acesso à caixa ' + de + ')' : '';
    const e = new Error('O Graph recusou o envio (' + r.status + (det ? ': ' + String(det).slice(0, 200) : '') + ')' + dica + '.');
    e.status = 502; e.publicMessage = e.message; throw e;
  }
  return { de, para, cc };
}

// ── as marcas (uma por OV) ───────────────────────────────────────
function blobUrl(nome) {
  const url = BLOB(), q = url.indexOf('?');
  const base = q < 0 ? url : url.slice(0, q), sas = q < 0 ? '' : url.slice(q);
  return base.replace(/\/+$/, '') + '/' + PASTA + encodeURIComponent(nome) + '.json' + sas;
}
const nomeOv = (ov) => String(ov || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
function fetchT(url, opts, ms) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms || 6000);
  return fetch(url, Object.assign({ signal: ac.signal }, opts || {})).finally(() => clearTimeout(t));
}
async function lerMarca(nome) {
  const r = await fetchT(blobUrl(nome), { method: 'GET' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('registro ' + r.status);
  try { return JSON.parse(await r.text()); } catch (e) { return { status: '?' }; }
}
// cria a marca só se ela NÃO existe: true = esta instância ficou com ela
async function reivindicar(nome, obj) {
  const r = await fetchT(blobUrl(nome), { method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob', 'If-None-Match': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  if (r.status === 409 || r.status === 412) return false;
  if (!r.ok) throw new Error('registro ' + r.status);
  return true;
}
async function gravarMarca(nome, obj) {
  const r = await fetchT(blobUrl(nome), { method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  if (!r.ok) throw new Error('registro ' + r.status);
}

// ── a automação ──────────────────────────────────────────────────
// candidatos = [{ ov, pronto (tem caixas), email (montarEmail) }] — as OVs em
// Cotação com Solicitar transportadora = Sim. -> { porOv: { OV: { status, em,
// para, erro } }, base: bool, enviados: n, erro }
// status: 'enviado' | 'sem-caixas' | 'pendente' (fica para a próxima leitura) |
// 'erro' | 'nao-configurado' | 'desligado' (memoria: true = sem o registro em blob)
async function processar(candidatos, opts) {
  opts = opts || {};
  const porOv = {}, out = { porOv, enviados: 0, erro: null };
  const tempo = typeof opts.temTempo === 'function' ? opts.temTempo : () => true;
  if (!candidatos.length) return out;
  const marca = (st) => candidatos.forEach(c => { porOv[c.ov] = { status: st }; });
  if (!configurado()) { marca('nao-configurado'); return out; }
  if (!comRegistro()) return processarNaMemoria(candidatos, tempo, out);
  try {
    // as marcas de cada OV (o que já foi feito)
    const marcas = await Promise.all(candidatos.map(c => lerMarca(nomeOv(c.ov)).catch(() => undefined)));
    for (let i = 0; i < candidatos.length; i++) {
      const c = candidatos[i], m = marcas[i];
      if (m) { porOv[c.ov] = m; continue; }
      if (m === undefined) { porOv[c.ov] = { status: 'pendente' }; continue; }   // não deu para ler a marca
      if (!c.pronto) { porOv[c.ov] = { status: 'sem-caixas' }; continue; }
      if (!AUTO()) { porOv[c.ov] = { status: 'desligado' }; continue; }
      if (out.enviados >= MAX() || !tempo()) { porOv[c.ov] = { status: 'pendente' }; continue; }
      const nome = nomeOv(c.ov);
      if (!(await reivindicar(nome, { status: 'enviando', ts: new Date().toISOString() }))) { porOv[c.ov] = { status: 'pendente' }; continue; }
      try {
        const r = await enviar(c.email);
        const reg = { status: 'enviado', em: new Date().toISOString(), para: r.para, cc: r.cc, assunto: c.email.assunto, caixas: c.email.totalCaixas, auto: true };
        await gravarMarca(nome, reg).catch(() => {});
        porOv[c.ov] = reg; out.enviados++;
      } catch (e) {
        const reg = { status: 'erro', em: new Date().toISOString(), erro: String(e.message || e).slice(0, 300) };
        await gravarMarca(nome, reg).catch(() => {});
        porOv[c.ov] = reg;
      }
    }
  } catch (e) {
    out.erro = String(e.message || e).slice(0, 200);
    candidatos.forEach(c => { if (!porOv[c.ov]) porOv[c.ov] = { status: 'pendente' }; });
  }
  return out;
}

// SEM o registro em blob (12/11/26, "não precisa de blob ainda"): a lembrança
// dos envios fica na memória do servidor — marca ANTES de enviar (duas leituras
// ao mesmo tempo na mesma instância não mandam dois); erro não tenta de novo
const _memoria = new Map();
async function processarNaMemoria(candidatos, tempo, out) {
  const porOv = out.porOv;
  for (const c of candidatos) {
    const k = nomeOv(c.ov), m = _memoria.get(k);
    if (m) { porOv[c.ov] = m; continue; }
    if (!c.pronto) { porOv[c.ov] = { status: 'sem-caixas' }; continue; }
    if (!AUTO()) { porOv[c.ov] = { status: 'desligado' }; continue; }
    if (out.enviados >= MAX() || !tempo()) { porOv[c.ov] = { status: 'pendente' }; continue; }
    _memoria.set(k, { status: 'enviando', memoria: true });
    try {
      const r = await enviar(c.email);
      const reg = { status: 'enviado', em: new Date().toISOString(), para: r.para, cc: r.cc, assunto: c.email.assunto, caixas: c.email.totalCaixas, auto: true, memoria: true };
      _memoria.set(k, reg); porOv[c.ov] = reg; out.enviados++;
    } catch (e) {
      const reg = { status: 'erro', em: new Date().toISOString(), erro: String(e.message || e).slice(0, 300), memoria: true };
      _memoria.set(k, reg); porOv[c.ov] = reg;
    }
  }
  if (_memoria.size > 2000) _memoria.delete(_memoria.keys().next().value);
  return out;
}

// envio já, fora da automação (12/11/26: sem uso — a ficha não tem botão e a rota
// recusa; fica para um reenvio manual futuro): envia e grava a marca
async function enviarAgora(c, por) {
  const r = await enviar(c.email);
  const reg = { status: 'enviado', em: new Date().toISOString(), para: r.para, cc: r.cc, assunto: c.email.assunto, caixas: c.email.totalCaixas, manual: true, por: por || '' };
  if (comRegistro()) await gravarMarca(nomeOv(c.ov), reg).catch(() => {});
  else _memoria.set(nomeOv(c.ov), Object.assign({ memoria: true }, reg));
  return reg;
}

module.exports = { configurado, comRegistro, montarEmail, agruparCaixas, saudacao, enviar, processar, enviarAgora, _blobUrl: blobUrl, _limparMemoria: () => _memoria.clear() };
