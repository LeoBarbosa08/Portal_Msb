// ================================================================
// /api/fca — FCA · Fichas de Atividade Comercial (Comercial)
//
// As fichas saíram do localStorage (cada navegador tinha a sua cópia, o
// gerente não via as do time e o "Forecast (FCA)" da filial só somava o que
// estava digitado naquela máquina). Agora moram no blob — ver
// shared/fca-store: um arquivo JSON por mês de competência.
//
//   GET  /api/fca?ano=2026&mes=9       -> fichas visíveis + forecast por unidade
//   POST /api/fca { op:'criar',    ano, mes, cliente, valor, unidade, acao, data, status, valorFaturado? }
//   POST /api/fca { op:'editar',   ano, mes, id, <campos que mudaram> }
//   POST /api/fca { op:'importar', ano, mes, fichas:[...] }   (legado do navegador)
//   (NÃO há remoção — ver abaixo)
//   Todo POST devolve a mesma visão do GET, já atualizada.
//
// QUEM VÊ O QUÊ (regra aprovada em 28/09/2026):
//   • o vendedor vê e edita SÓ as fichas dele;
//   • o forecast de cada filial soma as fichas de TODOS daquela unidade;
//   • quem o Power BI mostra com 2+ unidades (o perfil gerencial — o mesmo
//     critério que já fazia a tela exibir a tabela "Todas as filiais") vê
//     a lista de todas as fichas das unidades dele, sem editar as dos outros.
//
// DE ONDE VEM A UNIDADE DA PESSOA: o modelo do Comercial tem RLS e o Service
// Principal NÃO entra nele (toma 401). Então a página manda o token DELEGADO
// do Power BI que ela já usa (header x-pbi-token) e o servidor roda, com ele,
// o mesmo VALUES(unidade) da tela — o RLS é o da própria pessoa. Antes de
// usar, confere que o token é do Power BI e da MESMA conta do id token
// validado (oid/upn); quem aceita ou recusa a assinatura é o Power BI. Sem
// token, ou se o Power BI falhar, a pessoa cai no modo mais fechado: vê só as
// próprias fichas e não consegue lançar em unidade que não foi confirmada.
//
// FICHA NÃO SE APAGA (regra de 29/09/2026): o FCA é o registro do que o time
// fez no mês e alimenta o forecast da filial — apagar uma ficha reescreve esse
// histórico. Quem errou edita (o que muda fica no hist) ou conclui a ficha. O
// op:'remover' foi desativado e responde 400; as fichas removidas ANTES dessa
// regra continuam marcadas (f.removida) e seguem fora da lista e das somas.
//
// CANCELADO (regra de 29/09/2026): como a ficha não se apaga, o status
// 'Cancelado' é a saída para a que não vai acontecer — ela fica na lista, com
// o histórico, e não soma em NADA (nem forecast, nem faturado). Só pode ser
// posto na ficha do MÊS ABERTO (a competência corrente, no fuso de Brasília):
// forecast de mês já fechado não muda depois. Quem já está cancelada segue
// editável em qualquer mês — a trava é sobre CANCELAR, não sobre a ficha.
//
// FORECAST x CONCLUÍDA (regra de 29/09/2026): ficha CONCLUÍDA sai do forecast
// — o que ela vendeu já entrou no Faturamento Real do Power BI, e somar de
// novo contaria duas vezes. Em troca ela carrega `valorFaturado`, o valor de
// FATO faturado, obrigatório ao concluir (na criação ou na edição) e devolvido
// em forecast.faturadoPorUnidade. Pendente e Em andamento seguem somando por
// `valor`, como sempre. Voltar o status para uma delas limpa o valorFaturado
// e devolve a ficha ao forecast.
//
// SEGURANÇA: exige id token VALIDADO (não só o fallback de header do
// AUTH_ENFORCE off — a autoria é o produto do histórico e não pode ser
// forjável) + área 'comercial'. CORS travado, erro sanitizado.
// ================================================================

const crypto = require('crypto');
const auth   = require('../shared/auth');
const http   = require('../shared/http');
const store  = require('../shared/fca-store');

// Marcador de build: BUMPAR a cada alteração.
const VERSAO = 'fca/4';

const PBI_WS     = process.env.FCA_PBI_WORKSPACE_ID || '8535f0a1-8dc6-4da0-93ce-bf20c1c14e27';
const PBI_REPORT = process.env.FCA_PBI_REPORT_ID    || '10a505aa-759e-4f20-a130-98c0736ba42d';
const COL_UNID   = "'DIM_UNIDADE_DE_NEGOCIO_V2'[UNIDADE_DE_NEGOCIO]";
// mesmas unidades que a tela esconde do painel/tabela/totais
const EXCLUI_UNIDADES = ['NOVA TECNOLOGIA', 'NÃO CLASSIFICADO', 'MSB-EXPORT', 'MSB'];
const STATUS = ['Pendente', 'Em andamento', 'Concluído', 'Cancelado'];
const CAMPOS = ['cliente', 'valor', 'unidade', 'acao', 'data', 'status', 'valorFaturado'];

const ESCOPO_TTL_MS   = 10 * 60 * 1000;
const MAX_FICHAS_MES  = 5000;   // teto anti-abuso por arquivo de mês
const MAX_IMPORTAR    = 300;
const MAX_HIST        = 60;
const MAX_TENTATIVAS  = 4;

function erroPublico(status, msg) { const e = new Error(msg); e.status = status; e.publico = msg; return e; }
function norm(u) { return String(u == null ? '' : u).trim().toUpperCase(); }
function limpa(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max); }
// 'Concluída' (grafia antiga do navegador) também conta como concluída.
function ehConcluida(s) { return /^CONCLU/.test(norm(s)); }
function ehCancelada(s) { return /^CANCEL/.test(norm(s)); }

// Mês ABERTO = a competência corrente no fuso de Brasília. O servidor roda em
// UTC e, nas últimas 3h do último dia do mês, UTC já virou — é a diferença
// entre a pessoa ainda poder cancelar em setembro ou não.
const TZ_BR = 'America/Sao_Paulo';
function mesCorrente() {
  try {
    const partes = new Intl.DateTimeFormat('en-US', { timeZone: TZ_BR, year: 'numeric', month: 'numeric' }).formatToParts(new Date());
    const ano = Number((partes.find(x => x.type === 'year') || {}).value);
    const mes = Number((partes.find(x => x.type === 'month') || {}).value);
    if (ano >= 2024 && mes >= 1 && mes <= 12) return { ano: ano, mes: mes };
  } catch (e) {}
  const d = new Date();
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
}
function mesAberto(p) { const c = mesCorrente(); return p.ano === c.ano && p.mes === c.mes; }
const MESES_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function erroMesFechado() {
  const c = mesCorrente();
  return erroPublico(400, 'Só dá para cancelar ficha do mês aberto (' + MESES_PT[c.mes - 1] + '/' + c.ano + ').');
}

function periodo(src) {
  const ano = parseInt(src && src.ano, 10), mes = parseInt(src && src.mes, 10);
  if (!(ano >= 2024 && ano <= 2035) || !(mes >= 1 && mes <= 12)) throw erroPublico(400, 'Informe ano e mês válidos.');
  return { ano: ano, mes: mes };
}

// ── escopo da pessoa no Power BI (token delegado, RLS dela) ──────────
const _escopoCache = new Map();          // chave (oid|email) -> { unidades, exp }
let _ds = null;                          // { id, ws } do dataset do Sales Report

function claimsDe(jwt) {
  try {
    const p = String(jwt).split('.')[1] || '';
    return JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch (e) { return null; }
}

function erroPbi(etapa, status) { const e = new Error('pbi ' + etapa + ' ' + status); e.pbiStatus = status; return e; }

async function datasetDoRelatorio(token) {
  if (_ds) return _ds;
  const H = { Authorization: 'Bearer ' + token };
  let r = await fetch('https://api.powerbi.com/v1.0/myorg/groups/' + PBI_WS + '/reports/' + PBI_REPORT, { headers: H });
  if (!r.ok) r = await fetch('https://api.powerbi.com/v1.0/myorg/reports/' + PBI_REPORT, { headers: H });
  if (!r.ok) throw erroPbi('report', r.status);
  const j = await r.json().catch(() => null);
  if (!j || !j.datasetId) throw erroPbi('report', 'sem-dataset');
  _ds = { id: j.datasetId, ws: j.datasetWorkspaceId || PBI_WS };
  return _ds;
}

async function unidadesNoPbi(token, jaTentou) {
  const ds = await datasetDoRelatorio(token);
  const body = JSON.stringify({ queries: [{ query: 'EVALUATE VALUES(' + COL_UNID + ')' }], serializerSettings: { includeNulls: true } });
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  let r = await fetch('https://api.powerbi.com/v1.0/myorg/groups/' + ds.ws + '/datasets/' + ds.id + '/executeQueries', { method: 'POST', headers: H, body: body });
  if (r.status === 401 || r.status === 403 || r.status === 404) {
    r = await fetch('https://api.powerbi.com/v1.0/myorg/datasets/' + ds.id + '/executeQueries', { method: 'POST', headers: H, body: body });
  }
  if (r.status === 404 && !jaTentou) { _ds = null; return unidadesNoPbi(token, true); }   // dataset republicado
  if (!r.ok) throw erroPbi('executeQueries', r.status);
  const j = await r.json().catch(() => null);
  const t = j && j.results && j.results[0] && j.results[0].tables && j.results[0].tables[0];
  const rows = (t && t.rows) || [];
  const vistos = {}, out = [];
  rows.forEach(row => {
    const k = Object.keys(row || {})[0];
    const u = k ? String(row[k] == null ? '' : row[k]).trim() : '';
    if (!u || EXCLUI_UNIDADES.indexOf(norm(u)) >= 0 || vistos[norm(u)]) return;
    vistos[norm(u)] = true; out.push(u);
  });
  return out.sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

async function escopoDe(user, pbiToken) {
  const email = String(user.email || '').toLowerCase();
  const chave = (user.oid || '') + '|' + email;
  const fecha = (fonte, extra) => Object.assign({ conhecido: false, gerencial: false, unidades: [], fonte: fonte }, extra || {});
  const hit = _escopoCache.get(chave);
  if (hit && hit.exp > Date.now()) return { conhecido: true, gerencial: hit.unidades.length >= 2, unidades: hit.unidades, fonte: 'pbi' };
  if (!pbiToken) return fecha('sem-token');

  const c = claimsDe(pbiToken);
  if (!c || !/analysis\.windows\.net\/powerbi\/api/i.test(String(c.aud || ''))) return fecha('token-invalido');
  if (c.exp && Number(c.exp) * 1000 < Date.now()) return fecha('token-expirado');
  // o token tem de ser DA MESMA pessoa do id token validado
  const donoOid = String(c.oid || '');
  const donoEmail = String(c.upn || c.unique_name || c.preferred_username || c.email || '').trim().toLowerCase();
  const mesma = (user.oid && donoOid) ? (donoOid === user.oid) : (!!donoEmail && donoEmail === email);
  if (!mesma) return fecha('token-de-outra-conta');

  try {
    const unidades = await unidadesNoPbi(pbiToken);
    _escopoCache.set(chave, { unidades: unidades, exp: Date.now() + ESCOPO_TTL_MS });
    return { conhecido: true, gerencial: unidades.length >= 2, unidades: unidades, fonte: 'pbi' };
  } catch (e) {
    return fecha('pbi-falhou', { status: e.pbiStatus || null });
  }
}

// unidade canônica (grafia do Power BI) se ela estiver no escopo; senão ''
function unidadeDoEscopo(u, esc) {
  const n = norm(u);
  if (!n) return '';
  const achou = (esc.unidades || []).find(x => norm(x) === n);
  return achou || '';
}

// ── validação dos campos da ficha ────────────────────────────────────
function dataValida(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
function valorValido(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(',', '.'));
  if (!isFinite(n) || n < 0 || n > 1e11) return null;
  return Math.round(n * 100) / 100;
}

// Lê do body só os campos presentes (editar é parcial). Lança 400 com a
// mensagem que a tela mostra.
function camposDoBody(b, parcial) {
  const out = {};
  const tem = k => Object.prototype.hasOwnProperty.call(b, k);
  if (!parcial || tem('cliente')) {
    const c = limpa(b.cliente, 160).trim();
    if (!c) throw erroPublico(400, 'Informe o cliente.');
    out.cliente = c;
  }
  if (!parcial || tem('valor')) {
    const v = valorValido(b.valor);
    if (v == null) throw erroPublico(400, 'Valor inválido.');
    out.valor = v;
  }
  if (!parcial || tem('unidade')) out.unidade = limpa(b.unidade, 80).trim();
  if (!parcial || tem('acao')) out.acao = limpa(b.acao, 4000).trim();
  if (!parcial || tem('data')) {
    const d = String(b.data || '').trim();
    if (!dataValida(d)) throw erroPublico(400, 'Data inválida.');
    out.data = d;
  }
  if (!parcial || tem('status')) {
    const s = String(b.status || '').trim();
    if (STATUS.indexOf(s) < 0) throw erroPublico(400, 'Status inválido.');
    out.status = s;
  }
  // ausente ou '' = NÃO informado (null) — diferente de zero. Quem exige o
  // valor numa ficha concluída é o ajustaFaturado(), que vê o status final.
  if (!parcial || tem('valorFaturado')) {
    const bruto = b.valorFaturado;
    if (bruto == null || String(bruto).trim() === '') out.valorFaturado = null;
    else {
      const vf = valorValido(bruto);
      if (vf == null) throw erroPublico(400, 'Valor faturado inválido.');
      out.valorFaturado = vf;
    }
  }
  return out;
}

// A regra do faturado: ficha CONCLUÍDA sai do forecast e passa a valer pelo
// que foi DE FATO faturado — por isso esse valor é obrigatório nela. Voltar
// para Pendente/Em andamento devolve a ficha ao forecast e limpa o faturado.
// `atual` é o que já está gravado na ficha (null na criação); o que veio no
// body manda, inclusive para apagar.
function ajustaFaturado(c, statusFinal, atual) {
  if (!ehConcluida(statusFinal)) { c.valorFaturado = null; return; }
  const v = Object.prototype.hasOwnProperty.call(c, 'valorFaturado')
    ? c.valorFaturado
    : (atual == null ? null : Number(atual));
  if (v == null) throw erroPublico(400, 'Ficha concluída: informe o valor de fato faturado.');
  c.valorFaturado = v;
}

function diff(antes, depois) {
  const ch = [];
  CAMPOS.forEach(k => {
    if (!Object.prototype.hasOwnProperty.call(depois, k)) return;
    let a = antes[k], b = depois[k];
    if (k === 'valor') { a = Number(a) || 0; b = Number(b) || 0; }
    // o faturado distingue "não informado" (null) de zero
    else if (k === 'valorFaturado') { a = a == null ? '' : Number(a).toFixed(2); b = b == null ? '' : Number(b).toFixed(2); }
    if (String(a == null ? '' : a) !== String(b == null ? '' : b)) ch.push({ field: k, from: antes[k] == null ? '' : antes[k], to: depois[k] });
  });
  return ch;
}

function pushHist(f, h) {
  const hist = Array.isArray(f.hist) ? f.hist.slice() : [];
  hist.push(h);
  while (hist.length > MAX_HIST) hist.shift();
  f.hist = hist;
}

function codigoFicha(ano, mes, seq) {
  return 'FCA-' + String(ano).slice(2) + String(mes).padStart(2, '0') + '-' + String(seq).padStart(3, '0');
}

// ── visão devolvida à tela ───────────────────────────────────────────
function visao(dados, p, eu, esc) {
  const email = eu.email;
  const noEscopo = {};
  (esc.unidades || []).forEach(u => { noEscopo[norm(u)] = u; });
  const vivas = (dados.fichas || []).filter(f => !f.removida);

  const visiveis = vivas.filter(f => {
    if (f.autorEmail === email) return true;
    if (!esc.gerencial) return false;
    return !norm(f.unidade) || !!noEscopo[norm(f.unidade)];
  });

  // Forecast por unidade. Com o escopo confirmado, a filial soma as fichas de
  // TODOS daquela unidade; sem ele, só as da própria pessoa (modo fechado).
  // CONCLUÍDA não entra no forecast (já está no Faturamento Real do Power BI):
  // ela soma no faturado, pelo valor de fato faturado informado na conclusão.
  // CANCELADA não soma em nada — ela continua na lista só como registro.
  const porUnidade = {}, faturadoPorUnidade = {};
  let fora = 0, foraFaturado = 0;
  const contabiliza = (f, unidade) => {
    if (ehCancelada(f.status)) return;
    const fim = ehConcluida(f.status);
    const v = fim ? (Number(f.valorFaturado) || 0) : (Number(f.valor) || 0);
    if (unidade) { const m = fim ? faturadoPorUnidade : porUnidade; m[unidade] = (m[unidade] || 0) + v; }
    else if (fim) foraFaturado += v;
    else fora += v;
  };
  if (esc.conhecido) {
    vivas.forEach(f => { const u = noEscopo[norm(f.unidade)]; if (u) contabiliza(f, u); });
    visiveis.forEach(f => { if (!noEscopo[norm(f.unidade)]) contabiliza(f, ''); });
  } else {
    visiveis.forEach(f => contabiliza(f, String(f.unidade || '').trim()));
  }
  [porUnidade, faturadoPorUnidade].forEach(m => Object.keys(m).forEach(u => { m[u] = Math.round(m[u] * 100) / 100; }));

  return {
    ok: true, versao: VERSAO, armazenamento: true,
    ano: p.ano, mes: p.mes, atualizadoEm: dados.atualizadoEm || null,
    eu: { email: email, nome: eu.nome },
    escopo: { conhecido: esc.conhecido, gerencial: esc.gerencial, unidades: esc.unidades || [], fonte: esc.fonte, status: esc.status || null },
    fichas: visiveis.map(f => ({
      id: f.id, ficha: f.ficha, cliente: f.cliente, valor: Number(f.valor) || 0,
      valorFaturado: f.valorFaturado == null ? null : Number(f.valorFaturado),
      unidade: f.unidade || '', acao: f.acao || '', data: f.data || '', status: f.status,
      autorNome: f.autorNome || '', autorEmail: f.autorEmail || '',
      criadoEm: f.criadoEm || null, modBy: f.modBy || '', modAt: f.modAt || null,
      importada: !!f.importada, hist: Array.isArray(f.hist) ? f.hist : [],
      minha: f.autorEmail === email
    })),
    forecast: {
      porUnidade: porUnidade, foraDasUnidades: Math.round(fora * 100) / 100,
      faturadoPorUnidade: faturadoPorUnidade, faturadoForaDasUnidades: Math.round(foraFaturado * 100) / 100
    }
  };
}

// ── operações (cada uma recebe o arquivo do mês e o altera no lugar) ─
// Devolvem { resultado } ou lançam erroPublico.
function opCriar(dados, b, p, eu, esc) {
  const c = camposDoBody(b, false);
  if (!esc.conhecido) throw erroPublico(409, 'Não deu para confirmar no Power BI as suas unidades de negócio. Recarregue a página e tente de novo.');
  const u = unidadeDoEscopo(c.unidade, esc);
  if (!u) throw erroPublico(400, c.unidade ? 'Unidade de negócio fora das suas unidades no Power BI.' : 'Selecione a unidade de negócio.');
  c.unidade = u;
  if (ehCancelada(c.status) && !mesAberto(p)) throw erroMesFechado();
  ajustaFaturado(c, c.status, null);
  if ((dados.fichas || []).length >= MAX_FICHAS_MES) throw erroPublico(400, 'Limite de fichas do mês atingido.');
  const agora = new Date().toISOString();
  dados.seq = (Number(dados.seq) || 0) + 1;
  const f = Object.assign({
    id: crypto.randomBytes(8).toString('hex'),
    ficha: codigoFicha(p.ano, p.mes, dados.seq)
  }, c, {
    autorEmail: eu.email, autorNome: eu.nome, criadoEm: agora,
    modBy: eu.nome, modAt: agora, hist: []
  });
  pushHist(f, { by: eu.nome, email: eu.email, at: agora, action: 'create' });
  dados.fichas.push(f);
  return { id: f.id, ficha: f.ficha };
}

function fichaDoAutor(dados, id, eu, verbo) {
  const f = (dados.fichas || []).find(x => x.id === String(id || ''));
  if (!f || f.removida) throw erroPublico(404, 'Ficha não encontrada (pode ter sido removida).');
  if (f.autorEmail !== eu.email) throw erroPublico(403, 'Só quem incluiu a ficha pode ' + verbo + '.');
  return f;
}

function opEditar(dados, b, p, eu, esc) {
  const f = fichaDoAutor(dados, b.id, eu, 'editá-la');
  const c = camposDoBody(b, true);
  if (Object.prototype.hasOwnProperty.call(c, 'unidade') && norm(c.unidade) !== norm(f.unidade)) {
    if (!esc.conhecido) throw erroPublico(409, 'Não deu para confirmar no Power BI as suas unidades de negócio. Recarregue a página e tente de novo.');
    const u = unidadeDoEscopo(c.unidade, esc);
    if (!u) throw erroPublico(400, c.unidade ? 'Unidade de negócio fora das suas unidades no Power BI.' : 'Selecione a unidade de negócio.');
    c.unidade = u;
  } else if (Object.prototype.hasOwnProperty.call(c, 'unidade')) {
    c.unidade = f.unidade || '';            // mesma unidade (só grafia): mantém
  }
  const statusFinal = Object.prototype.hasOwnProperty.call(c, 'status') ? c.status : f.status;
  // trava só a TRANSIÇÃO para cancelada: quem já está cancelada continua
  // editável em qualquer mês (e destravar também, como qualquer outra edição)
  if (ehCancelada(statusFinal) && !ehCancelada(f.status) && !mesAberto(p)) throw erroMesFechado();
  ajustaFaturado(c, statusFinal, f.valorFaturado);
  const mudancas = diff(f, c);
  if (!mudancas.length) return { semMudanca: true, id: f.id };
  Object.assign(f, c);
  const agora = new Date().toISOString();
  f.modBy = eu.nome; f.modAt = agora;
  pushHist(f, { by: eu.nome, email: eu.email, at: agora, action: 'edit', changes: mudancas });
  return { id: f.id };
}

// Ficha do FCA não é apagada (ver o cabeçalho). Segue na lista de operações,
// e não some dela, para que a tela antiga que ficou no cache de alguém receba
// o motivo em vez de um genérico "Operação inválida.".
function opRemover() {
  throw erroPublico(400, 'Fichas do FCA não podem ser removidas — edite a ficha ou conclua-a.');
}

// Fichas que estavam no localStorage do navegador desta pessoa. A tela manda
// uma vez por mês; `origem` (hash do conteúdo) impede duplicar se repetir.
function opImportar(dados, b, p, eu, esc) {
  if (!esc.conhecido) throw erroPublico(409, 'Não deu para confirmar no Power BI as suas unidades de negócio. A importação fica para a próxima abertura.');
  const lista = Array.isArray(b.fichas) ? b.fichas.slice(0, MAX_IMPORTAR) : [];
  const jaTem = {};
  (dados.fichas || []).forEach(f => { if (f.origem) jaTem[f.origem] = true; });
  let importadas = 0, jaExistiam = 0, invalidas = 0;
  const agora = new Date().toISOString();
  lista.forEach(x => {
    if (!x || typeof x !== 'object') { invalidas++; return; }
    const cliente = limpa(x.cliente, 160).trim();
    const valor = valorValido(x.valor);
    if (!cliente || valor == null) { invalidas++; return; }
    const data = dataValida(x.data) ? String(x.data) : '';
    const status = STATUS.indexOf(String(x.status || '')) >= 0 ? String(x.status) : 'Pendente';
    const histLocal = Array.isArray(x.hist) ? x.hist.slice(-MAX_HIST) : [];
    const criadoLocal = (histLocal[0] && histLocal[0].at) || x.modAt || '';
    const origem = crypto.createHash('sha1')
      .update([eu.email, x.ficha || '', cliente, valor, data, criadoLocal].join('|')).digest('hex');
    if (jaTem[origem]) { jaExistiam++; return; }
    if ((dados.fichas || []).length >= MAX_FICHAS_MES) { invalidas++; return; }
    dados.seq = (Number(dados.seq) || 0) + 1;
    const f = {
      id: crypto.randomBytes(8).toString('hex'),
      ficha: codigoFicha(p.ano, p.mes, dados.seq),
      fichaAntiga: limpa(x.ficha, 20),
      cliente: cliente, valor: valor,
      // o legado do navegador não tinha "valor faturado": as concluídas entram
      // sem ele — ficam fora do forecast e com faturado 0 até alguém editá-las
      valorFaturado: null,
      unidade: unidadeDoEscopo(x.unidade, esc),
      acao: limpa(x.acao, 4000).trim(), data: data, status: status,
      autorEmail: eu.email, autorNome: eu.nome,
      criadoEm: dataValida(String(criadoLocal).slice(0, 10)) ? criadoLocal : agora,
      modBy: limpa(x.modBy, 120) || eu.nome, modAt: x.modAt || agora,
      importada: true, origem: origem,
      // o histórico local vem do navegador (não verificável): entra como veio,
      // e a importação é registrada com a identidade VALIDADA
      hist: histLocal.map(h => ({
        by: limpa(h && h.by, 120), at: (h && h.at) || '', action: limpa(h && h.action, 20) || 'edit',
        changes: Array.isArray(h && h.changes) ? h.changes.slice(0, 10).map(c => ({
          field: limpa(c && c.field, 20), from: limpa(c && c.from, 500), to: limpa(c && c.to, 500)
        })) : undefined
      }))
    };
    pushHist(f, { by: eu.nome, email: eu.email, at: agora, action: 'import' });
    dados.fichas.push(f);
    jaTem[origem] = true;
    importadas++;
  });
  // nada novo -> não regrava o arquivo do mês
  return { semMudanca: importadas === 0, importadas: importadas, jaExistiam: jaExistiam, invalidas: invalidas };
}

const OPS = { criar: opCriar, editar: opEditar, remover: opRemover, importar: opImportar };

// ── handler ──────────────────────────────────────────────────────────
module.exports = async function (context, req) {
  const reply = (status, body) => {
    context.res = { status, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, http.cors(req)), body };
  };
  if (req.method === 'OPTIONS') { context.res = http.preflight(req); return; }

  try {
    const { user, validated } = await auth.requireArea(req, 'comercial');
    const email = String((user && user.email) || '').trim().toLowerCase();
    if (!validated || !email) { reply(401, { ok: false, versao: VERSAO, error: 'Não autenticado.' }); return; }
    const eu = { email: email, nome: String((user && user.name) || email).trim(), oid: String((user && user.oid) || '') };

    if (req.method !== 'GET' && req.method !== 'POST') { reply(405, { ok: false, error: 'Método não suportado.' }); return; }
    const b = (req.method === 'POST' ? req.body : null) || {};
    const p = periodo(req.method === 'POST' ? b : (req.query || {}));

    if (!store.configured()) {
      reply(200, { ok: true, versao: VERSAO, armazenamento: false, ano: p.ano, mes: p.mes,
        error: 'Armazenamento das fichas não configurado. Defina FCA_BLOB_URL nas App Settings.' });
      return;
    }

    const h = req.headers || {};
    const esc = await escopoDe({ email: email, oid: eu.oid }, String(h['x-pbi-token'] || '').trim());

    if (req.method === 'GET') {
      const dados = await store.read(p.ano, p.mes);
      reply(200, visao(dados, p, eu, esc));
      return;
    }

    const fn = OPS[String(b.op || '')];
    if (!fn) { reply(400, { ok: false, versao: VERSAO, error: 'Operação inválida.' }); return; }

    // Gravação com repetição em conflito: cada volta relê o mês, reaplica ESTA
    // operação e grava condicionada à versão lida (ver fca-store.write).
    for (let tentativa = 1; ; tentativa++) {
      const dados = await store.read(p.ano, p.mes);
      const etag = dados.etag;
      const resultado = fn(dados, b, p, eu, esc);
      if (resultado && resultado.semMudanca) {
        reply(200, Object.assign(visao(dados, p, eu, esc), { resultado: resultado }));
        return;
      }
      dados.atualizadoEm = new Date().toISOString();
      if (await store.write(p.ano, p.mes, dados, etag)) {
        reply(200, Object.assign(visao(dados, p, eu, esc), { resultado: resultado, tentativas: tentativa }));
        return;
      }
      if (tentativa >= MAX_TENTATIVAS) {
        reply(409, { ok: false, versao: VERSAO, error: 'Outra pessoa salvou neste mês ao mesmo tempo. Recarregue e repita a alteração.' });
        return;
      }
    }
  } catch (e) {
    if (e && e.publico) { reply(e.status || 400, { ok: false, versao: VERSAO, error: e.publico }); return; }
    const diag = store.diagnostico(e);
    if (diag) {
      http.logError(context, 'fca', e);
      reply(502, { ok: false, versao: VERSAO, armazenamento: true, error: 'Falha no armazenamento das fichas: ' + diag.dica, blob: diag });
      return;
    }
    http.sendError(context, req, 'fca', e);
  }
};
