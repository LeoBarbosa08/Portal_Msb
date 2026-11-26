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
// 26/11/26 (dono: "EU SÓ QUERO ENVIAR 1X, somente uma! por cartão da OV" — a
// OV017816 recebeu o e-mail 4 vezes em 40 min): a lembrança na MEMÓRIA não
// segura — cada instância do servidor (e cada reinício) tem a sua, e cada
// pessoa com o quadro aberto cai numa delas. Agora:
//   . o registro é SEMPRE em blob: KANBAN_BLOB_URL, LOG_PORTAL_BLOB_URL ou, sem
//     as duas, o container das Oportunidades da MSB (COT_MSB_BLOB_URL, que o
//     portal já tem) — as marcas ficam só na pasta kanban-email-cotacao/,
//     longe dos arquivos das oportunidades (indice.json, casos/, anexos/);
//   . SEM nenhum container: NÃO envia (status 'sem-registro') — sem como lembrar,
//     nenhum envio é melhor que vários;
//   . a PASSAGEM da memória para o registro (sem kanban-email-cotacao/_inicio.json):
//     as OVs em Cotação que já têm as caixas já receberam (da memória) — ganham a
//     marca "enviado antes do registro" SEM reenviar. Só então o _inicio é criado.
// ================================================================

const auth = require('./auth');

const txt = (v) => String(v == null ? '' : v).trim();
const lista = (v) => txt(v).split(/[,;]/).map(s => s.trim()).filter(Boolean);
const DE   = () => txt(process.env.KANBAN_EMAIL_DE);
const PARA = () => lista(process.env.KANBAN_EMAIL_PARA);
const CC   = () => lista(process.env.KANBAN_EMAIL_CC);
const BLOB = () => txt(process.env.KANBAN_BLOB_URL || process.env.LOG_PORTAL_BLOB_URL || process.env.COT_MSB_BLOB_URL);
const AUTO = () => txt(process.env.KANBAN_EMAIL_AUTO) !== '0';
const MAX  = () => Math.max(0, Number(process.env.KANBAN_EMAIL_MAX || 5));
const PASTA = 'kanban-email-cotacao/';
const INICIO = '_inicio';   // 26/11/26: a marca de que o registro já está em uso (a passagem da memória)
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

// por que a OV ficou na fila (a ficha mostra)
const motivoFila = (out) => out.enviados >= MAX() ? 'no máximo ' + MAX() + ' envio(s) por leitura (KANBAN_EMAIL_MAX)' : 'acabou o tempo desta leitura';
// 16/11/26: sem caixas no e-mail — "sem-caixas" só se as caixas foram LIDAS; a
// leitura que falhou/ficou sem tempo (c.semLeitura) é "pendente" (a tela tenta de novo)
const semCaixas = (c) => c.semLeitura ? { status: 'pendente', motivo: c.semLeitura } : { status: 'sem-caixas' };

// ── a automação ──────────────────────────────────────────────────
// candidatos = [{ ov, pronto (tem caixas), semLeitura (motivo: as caixas não foram
// lidas — vira "pendente", não "sem-caixas"), email (montarEmail) }] — as OVs em
// Cotação com Solicitar transportadora = Sim. -> { porOv: { OV: { status, em,
// para, erro } }, base: bool, enviados: n, erro }
// status: 'enviado' | 'sem-caixas' | 'pendente' (fica para a próxima leitura) |
// 'erro' | 'nao-configurado' | 'desligado' | 'sem-registro' (26/11/26: sem blob, não
// envia). antesDoRegistro: true = enviado da memória, antes do registro (não reenvia)
async function processar(candidatos, opts) {
  opts = opts || {};
  const porOv = {}, out = { porOv, enviados: 0, erro: null };
  const tempo = typeof opts.temTempo === 'function' ? opts.temTempo : () => true;
  if (!candidatos.length) return out;
  const marca = (st) => candidatos.forEach(c => { porOv[c.ov] = { status: st }; });
  if (!configurado()) { marca('nao-configurado'); return out; }
  if (!comRegistro()) return semRegistro(candidatos, out);
  try {
    // as marcas de cada OV (o que já foi feito)
    // 13/11/26: a marca ilegível deixa o MOTIVO (antes, "pendente" calado para sempre)
    const falha = (e) => ({ _falha: String((e && e.name === 'AbortError') ? 'sem resposta em 6 s' : (e && e.message) || e).slice(0, 120) });
    const inicio = await lerMarca(INICIO).catch(falha);
    if (inicio && inicio._falha) { candidatos.forEach(c => { porOv[c.ov] = { status: 'pendente', motivo: 'não deu para ler o registro dos envios (' + inicio._falha + ')' }; }); return out; }
    const marcas = await Promise.all(candidatos.map(c => lerMarca(nomeOv(c.ov)).catch(falha)));
    // 26/11/26: a 1ª leitura com o registro — as que já receberam da memória não recebem de novo
    if (!inicio) await abrirRegistro(candidatos, marcas, porOv);
    for (let i = 0; i < candidatos.length; i++) {
      const c = candidatos[i], m = marcas[i];
      if (porOv[c.ov]) continue;
      if (m && m._falha) { porOv[c.ov] = { status: 'pendente', motivo: 'não deu para ler o registro dos envios (' + m._falha + ')' }; continue; }
      if (m) { porOv[c.ov] = m; continue; }
      if (!c.pronto) { porOv[c.ov] = semCaixas(c); continue; }
      if (!AUTO()) { porOv[c.ov] = { status: 'desligado' }; continue; }
      if (out.enviados >= MAX() || !tempo()) { porOv[c.ov] = { status: 'pendente', motivo: motivoFila(out) }; continue; }
      const nome = nomeOv(c.ov);
      if (!(await reivindicar(nome, { status: 'enviando', ts: new Date().toISOString() }))) { porOv[c.ov] = { status: 'pendente', motivo: 'outra leitura está enviando esta OV' }; continue; }
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

// 26/11/26: a PASSAGEM da memória para o registro (ainda sem o _inicio). Até
// aqui o portal enviava lembrando só na memória: as OVs em Cotação que já têm as
// caixas já receberam (várias vezes) — ganham a marca "enviado antes do
// registro" SEM enviar. Se alguma OV já tem marca de envio de verdade, o
// registro já estava em uso: não marca nada. O _inicio é criado POR ÚLTIMO (uma
// leitura ao mesmo tempo também só marca, nunca envia) e só se todas as marcas
// foram lidas (a OV de marca ilegível tentaria de novo sem a passagem).
async function abrirRegistro(candidatos, marcas, porOv) {
  const emUso = marcas.some(m => m && !m._falha && !m.antesDoRegistro);
  if (!emUso) {
    for (let i = 0; i < candidatos.length; i++) {
      const c = candidatos[i];
      if (marcas[i] || !c.pronto) continue;
      const reg = { status: 'enviado', antesDoRegistro: true, marcadoEm: new Date().toISOString(), assunto: c.email.assunto, caixas: c.email.totalCaixas };
      porOv[c.ov] = (await reivindicar(nomeOv(c.ov), reg)) ? reg : ((await lerMarca(nomeOv(c.ov))) || reg);
    }
  }
  if (marcas.some(m => m && m._falha)) return;
  await reivindicar(INICIO, { em: new Date().toISOString(), emUso, marcadas: Object.keys(porOv).length });
}

// SEM nenhum container de blob (26/11/26): o portal não tem onde lembrar do envio
// — NÃO envia (antes, lembrava na memória e repetia a cada reinício/instância)
function semRegistro(candidatos, out) {
  candidatos.forEach(c => { out.porOv[c.ov] = !c.pronto ? semCaixas(c) : !AUTO() ? { status: 'desligado' } : { status: 'sem-registro' }; });
  return out;
}

// envio já, fora da automação (12/11/26: sem uso — a ficha não tem botão e a rota
// recusa; fica para um reenvio manual futuro): envia e grava a marca
async function enviarAgora(c, por) {
  if (!comRegistro()) { const e = new Error('Sem o registro dos envios (blob), o portal não envia: não teria como saber que já enviou.'); e.status = 409; e.publicMessage = e.message; throw e; }
  const r = await enviar(c.email);
  const reg = { status: 'enviado', em: new Date().toISOString(), para: r.para, cc: r.cc, assunto: c.email.assunto, caixas: c.email.totalCaixas, manual: true, por: por || '' };
  await gravarMarca(nomeOv(c.ov), reg).catch(() => {});
  return reg;
}

module.exports = { configurado, comRegistro, montarEmail, agruparCaixas, saudacao, enviar, processar, enviarAgora, _blobUrl: blobUrl };
