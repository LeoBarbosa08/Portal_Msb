// ================================================================
// api/shared/rastreio.js — KANBAN › RASTREIO DE ENTREGA (13/11/2026)
//
// Dono: "no rastreio de entrega crie as fases EXPEDIÇÃO, que vai trazer o
// histórico da expedição (mesmo status do kanban), AGUARDANDO REVISÃO (quando o
// robô identificar que a entrega aconteceu e colocar o anexo no pedido) e
// ENTREGUE (quando o operador avaliar o aguardando revisão e concluir a entrega)".
//
//   EXPEDIÇÃO           as OVs expedidas desde RASTREIO_DESDE (K.expedidas — a regra
//                       da coluna Expedição do quadro, de todos os dias)
//   AGUARDANDO REVISÃO  o ROBÔ (rodar) achou a NF entregue na transportadora: a OV
//                       anda sozinha, com o recebedor, a data e o COMPROVANTE (anexo)
//   ENTREGUE            o OPERADOR conferiu e concluiu (concluir) — fica quem e quando
//
// O robô consulta só as OVs em Expedição com NF; hoje só a BRIX tem integração
// (brix.js) — a NF que a Brix não conhece é de outra transportadora e fica em
// Expedição, "sem rastreio". As fases moram no blob (rastreio-store.js).
// A cada RASTREIO_INTERVALO_MIN (30): o agendamento do GitHub Actions
// (.github/workflows/rastreio.yml) e a própria tela, quando abre e a última
// rodada passou do intervalo.
// ================================================================

const K = require('./kanban-ov');
const BRIX = require('./brix');
const S = require('./rastreio-store');

const FASES = [
  { id: 'expedicao', nome: 'Expedição' },
  { id: 'revisao',   nome: 'Aguardando Revisão' },
  { id: 'entregue',  nome: 'Entregue' }
];
const MAX_EVENTOS = 40, MAX_HIST = 30;
function intervaloMin() { return Math.max(5, Number(process.env.RASTREIO_INTERVALO_MIN || 30)); }
function erroStatus(msg, st) { const e = new Error(msg); e.status = st; e.publicMessage = msg; return e; }

function dadosDe(o) {
  return { cliente: o.cliente || '', conta: o.conta || '', cidade: o.cidade || '', uf: o.uf || '', expedidaEm: o.expedidaEm || null,
    cargas: o.cargas || [], notas: (o.notas || []).map(n => ({ numero: n.numero, data: n.data || null, valor: n.valor == null ? null : n.valor })) };
}

// o rastreio da OV pelas NFs dela que a transportadora achou. Com mais de uma NF,
// a OV só está entregue quando TODAS as achadas estão; o resto mostra a mais atrasada.
const ORDEM = { cancelado: 0, transito: 1, entregue: 2 };
function juntar(achados) {
  const pior = achados.slice().sort((a, b) => ORDEM[a.situacao] - ORDEM[b.situacao])[0];
  const todas = achados.every(a => a.situacao === 'entregue');
  const r = Object.assign({}, pior, {
    situacao: todas ? 'entregue' : pior.situacao,
    entregueEm: todas ? achados.map(a => a.entregueEm).filter(Boolean).sort().pop() || null : null,
    recebedor: todas ? (achados.map(a => a.recebedor).filter(Boolean)[0] || '') : '',
    comprovantes: Array.from(new Set([].concat.apply([], achados.map(a => a.comprovantes || [])))),
    eventos: (pior.eventos || []).slice(0, MAX_EVENTOS)
  });
  if (achados.length > 1) r.envios = achados.map(a => ({ nf: a.nf, situacao: a.situacao, minuta: a.minuta, cte: a.cte, entregueEm: a.entregueEm, previsao: a.previsao }));
  return r;
}

function cartao(numero, dados, s) {
  return Object.assign({ numero }, dados || {}, {
    fase: s ? s.fase : 'expedicao', rastreio: (s && s.rastreio) || null, consultadoEm: (s && s.consultadoEm) || null,
    revisaoEm: (s && s.revisaoEm) || null, concluidoEm: (s && s.concluidoEm) || null, concluidoPor: (s && s.concluidoPor) || null,
    concluidoNome: (s && s.concluidoNome) || null, hist: (s && s.hist) || []
  });
}

// ── o quadro: as expedidas + as fases guardadas ──
async function quadro(opts) {
  opts = opts || {};
  const [exp, est] = await Promise.all([K.expedidas({ atualizar: !!opts.atualizar }), S.ler()]);
  const d = est.dados, vistas = new Set();
  const ovs = (exp.ovs || []).map(o => { vistas.add(o.numero); return cartao(o.numero, dadosDe(o), d.ovs[o.numero]); });
  // a OV que já andou (revisão/entregue) continua no quadro mesmo fora da leitura de hoje
  Object.keys(d.ovs).forEach(n => { const s = d.ovs[n]; if (!vistas.has(n) && s.fase !== 'expedicao') ovs.push(cartao(n, s.dados, s)); });
  const avisos = (exp.avisos || []).slice();
  if (!BRIX.configurado()) avisos.push('A consulta à Brix está desligada: falta o BRIX_TOKEN nas configurações do site (Azure). As OVs ficam em Expedição.');
  if (!S.comRegistro()) avisos.push('Sem o registro em blob (KANBAN_BLOB_URL ou LOG_PORTAL_BLOB_URL): as fases ficam só na memória do servidor e se perdem num reinício.');
  return {
    ok: true, configured: true, desde: exp.desde, geradoEm: new Date().toISOString(), cache: !!exp.cache,
    fases: FASES.map(f => Object.assign({ qtd: ovs.filter(o => o.fase === f.id).length }, f)),
    ovs, rodada: d.rodada || null, intervaloMin: intervaloMin(),
    brix: BRIX.configurado(), registro: S.comRegistro() ? 'blob' : 'memoria',
    avisos, diagnostico: opts.diag ? exp.diagnostico : undefined
  };
}

// ── o ROBÔ: consulta a transportadora e move para Aguardando Revisão ──
async function rodar(opts) {
  opts = opts || {};
  const t0 = Date.now(), ate = t0 + Number(process.env.RASTREIO_ORCAMENTO_TOTAL_MS || 38000);
  if (!BRIX.configurado()) return { ok: true, brix: false, rodada: null, aviso: 'BRIX_TOKEN não configurado: nada foi consultado.' };
  const exp = await K.expedidas({});
  const { dados: antes } = await S.ler();
  const candidatas = (exp.ovs || []).filter(o => (o.notas || []).length && !(antes.ovs[o.numero] && antes.ovs[o.numero].fase !== 'expedicao'));
  const nfs = Array.from(new Set([].concat.apply([], candidatas.map(o => o.notas.map(n => BRIX.nfNorm(n.numero)))).filter(Boolean)));
  const B = await BRIX.consultarNotas(nfs, { temTempo: () => ate - Date.now() > 6000 });
  const agora = new Date().toISOString(), por = opts.por || 'robô';
  const r = await S.atualizar(d => {
    let achadas = 0, novas = 0;
    candidatas.forEach(o => {
      const ach = o.notas.map(n => B.porNf[BRIX.nfNorm(n.numero)]).filter(Boolean);
      if (!ach.length) return;
      achadas++;
      const s = d.ovs[o.numero] || { fase: 'expedicao', hist: [] };
      if (s.fase !== 'expedicao') return;   // alguém andou com ela entre a leitura e a gravação
      s.dados = dadosDe(o); s.rastreio = juntar(ach); s.consultadoEm = agora;
      if (s.rastreio.situacao === 'entregue') {
        s.fase = 'revisao'; s.revisaoEm = agora; novas++;
        s.hist = (s.hist || []).concat({ em: agora, por: 'robô', de: 'expedicao', para: 'revisao' }).slice(-MAX_HIST);
      }
      d.ovs[o.numero] = s;
    });
    d.rodada = { em: agora, por, ovs: candidatas.length, nfs: nfs.length, achadas, novasRevisao: novas, chamadas: B.chamadas, erros: B.erros.slice(0, 5), ms: Date.now() - t0 };
    return d.rodada;
  });
  return { ok: true, brix: true, rodada: r.ret };
}

// ── o OPERADOR: Aguardando Revisão -> Entregue (e o desfazer) ──
async function mover(numero, de, para, quem) {
  const n = String(numero || '').trim().toUpperCase();
  if (!/^[A-Z0-9._-]{3,40}$/.test(n)) throw erroStatus('Número de OV inválido.', 400);
  const r = await S.atualizar(d => {
    const s = d.ovs[n];
    if (!s) throw erroStatus('A ' + n + ' não está no rastreio.', 404);
    if (s.fase !== de) throw erroStatus('A ' + n + ' não está em ' + FASES.find(f => f.id === de).nome + ' (está em ' + (FASES.find(f => f.id === s.fase) || { nome: s.fase }).nome + ').', 409);
    const agora = new Date().toISOString(), email = String((quem && quem.email) || '').toLowerCase();
    s.fase = para;
    if (para === 'entregue') { s.concluidoEm = agora; s.concluidoPor = email; s.concluidoNome = (quem && quem.nome) || ''; }
    else { s.concluidoEm = null; s.concluidoPor = null; s.concluidoNome = null; }
    s.hist = (s.hist || []).concat({ em: agora, por: email || '?', de, para }).slice(-MAX_HIST);
    return cartao(n, s.dados, s);
  });
  return { ok: true, ov: r.ret };
}
const concluir = (numero, quem) => mover(numero, 'revisao', 'entregue', quem);
const reabrir  = (numero, quem) => mover(numero, 'entregue', 'revisao', quem);

module.exports = { quadro, rodar, concluir, reabrir, FASES, intervaloMin, _interno: { juntar } };
