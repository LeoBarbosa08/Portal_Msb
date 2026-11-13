// ================================================================
// api/shared/brix.js — rastreio na transportadora BRIX (sistema Brudam)
//
// 13/11/2026 (dono): "esse SCRIPT ir no site da transportadora e verificar se
// o pedido foi entregue com sucesso". A Brix tem API (docs:
// https://brix.ws.brudam.com.br/docs/clientes) — nada de abrir o site:
//
//   GET {BRIX_URL}/tracking/integracao/{token}/notas/{nf1},{nf2},…
//   -> { status: 1, message: 'OK', data: [ { minuta, cte, cteSerie,
//        codigoRastreio (= o NÚMERO DA NF da MSB, sem zeros à esquerda),
//        codigoEvento, cnpjEmpresa, datahoraEvento ('12/11/2026 11:20:44'),
//        responsavel (quem recebeu), status, previsao_entrega ('16/11/2026 23:59:00'),
//        eventos: [ { data '2026-11-12', hora, codigoEvento, descricao,
//                     comprovante (link da foto do canhoto) } ] } ] }
//
// Visto com os dados reais da MSB em 13/11/2026 (19 envios de 1º a 13/11):
//   status 6  = ENTREGUE — todos com o evento 1 "ENTREGA REALIZADA NORMALMENTE",
//               o recebedor e o comprovante (o evento 105 "COMPROVANTE DE
//               ENTREGA - RECEBIDO" e o 493 "EVENTO DE ENTREGA REGISTRADO NA
//               SEFAZ" vêm depois)
//   status 13 = CT-e cancelado ("137 CTE CANCELADO NO SEFAZ")
//   status 1 / 3 = a caminho (aguardando conexão, saída para entrega…)
// ENTREGUE = status BRIX_STATUS_ENTREGUE (6) OU um evento BRIX_EVENTO_ENTREGA (1).
// A NF que a Brix não devolve não é dela (outra transportadora): fica sem rastreio.
//
// Configuração (Azure › Static Web App › Configuration):
//   BRIX_TOKEN  o token do portal do cliente da Brix (Dados Cadastrais). SEGREDO:
//               o repositório é público — o token NUNCA vai para o código, e
//               nenhuma mensagem de erro ou log o repete (limpo()).
//   BRIX_URL    (opcional) padrão https://brix.ws.brudam.com.br
// ================================================================

const txt = (v) => String(v == null ? '' : v).trim();
const TOKEN = () => txt(process.env.BRIX_TOKEN);
const BASE = () => (txt(process.env.BRIX_URL) || 'https://brix.ws.brudam.com.br').replace(/\/+$/, '');
const lista = (v, padrao) => { const l = txt(v).split(/[,;]/).map(s => s.trim()).filter(Boolean); return l.length ? l : padrao; };
const ST_ENTREGUE = () => lista(process.env.BRIX_STATUS_ENTREGUE, ['6']);
const ST_CANCELADO = () => lista(process.env.BRIX_STATUS_CANCELADO, ['13']);
const EV_ENTREGA = () => lista(process.env.BRIX_EVENTO_ENTREGA, ['1']);
const POR_CHAMADA = 40;      // NFs por consulta (a URL fica curta)
const PRAZO_MS = 15000;

function configurado() { return !!TOKEN(); }

// o número da NF como a Brix guarda: só dígitos, sem zeros à esquerda ('000021519' -> '21519')
function nfNorm(v) { const d = txt(v).replace(/\D/g, '').replace(/^0+/, ''); return d || ''; }

// a mensagem sem o token (ele vai no caminho da URL)
function limpo(s) { const t = TOKEN(); let m = String(s == null ? '' : s); if (t) m = m.split(t).join('***'); return m.slice(0, 300); }

// '12/11/2026 11:20:44' -> '2026-11-12T11:20:44' (hora de Brasília, sem fuso)
function dataBr(v) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?/.exec(txt(v));
  return m ? m[3] + '-' + m[2] + '-' + m[1] + (m[4] ? 'T' + (m[4].length === 5 ? m[4] + ':00' : m[4]) : '') : null;
}
function quando(e) { const d = txt(e.data), h = txt(e.hora); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d + (h ? 'T' + h : '') : (dataBr(d) || ''); }

// um envio da Brix -> o que o rastreio guarda
function normalizar(x) {
  const eventos = (Array.isArray(x.eventos) ? x.eventos : []).map(e => ({
    em: quando(e), codigo: txt(e.codigoEvento != null ? e.codigoEvento : e.codigo), descricao: txt(e.descricao != null ? e.descricao : e.evento),
    comprovante: /^https?:\/\//i.test(txt(e.comprovante)) ? txt(e.comprovante) : ''
  })).sort((a, b) => a.em < b.em ? 1 : a.em > b.em ? -1 : 0);   // o mais recente primeiro
  const status = txt(x.status);
  const evEntrega = eventos.filter(e => EV_ENTREGA().indexOf(e.codigo) >= 0).sort((a, b) => a.em < b.em ? -1 : 1)[0] || null;
  const entregue = ST_ENTREGUE().indexOf(status) >= 0 || !!evEntrega;
  const cancelado = !entregue && ST_CANCELADO().indexOf(status) >= 0;
  const comprovantes = Array.from(new Set(eventos.map(e => e.comprovante).filter(Boolean)));
  return {
    transportadora: 'Brix', nf: nfNorm(x.codigoRastreio), minuta: txt(x.minuta), cte: txt(x.cte), cteSerie: txt(x.cteSerie), status,
    situacao: entregue ? 'entregue' : cancelado ? 'cancelado' : 'transito',
    entregueEm: entregue ? ((evEntrega && evEntrega.em) || dataBr(x.datahoraEvento) || null) : null,
    recebedor: entregue ? txt(x.responsavel) : '',
    previsao: dataBr(x.previsao_entrega),
    ultimo: eventos[0] ? { em: eventos[0].em, codigo: eventos[0].codigo, descricao: eventos[0].descricao } : null,
    comprovantes, eventos
  };
}

// a mesma NF em mais de um envio (CT-e cancelado e refeito): vale o entregue, depois
// o a caminho, por último o cancelado; empate: a minuta mais nova
const PESO = { entregue: 3, transito: 2, cancelado: 1 };
function melhor(a, b) {
  if (!a) return b;
  if (PESO[b.situacao] !== PESO[a.situacao]) return PESO[b.situacao] > PESO[a.situacao] ? b : a;
  return Number(b.minuta) > Number(a.minuta) ? b : a;
}

async function getJson(url) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), PRAZO_MS);
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: ac.signal });
    const corpo = await r.text();
    if (!r.ok) throw new Error('HTTP ' + r.status);
    try { return JSON.parse(corpo); } catch (e) { throw new Error('resposta que não é JSON'); }
  } catch (e) {
    throw new Error(e && e.name === 'AbortError' ? 'a Brix não respondeu em ' + (PRAZO_MS / 1000) + ' s' : limpo(e && e.message));
  } finally { clearTimeout(t); }
}

// as NFs (números, com ou sem zeros) -> { porNf: { '21519': envio }, consultadas, chamadas, erros:[...] }
// A NF que não está em porNf não foi achada na Brix (ou a chamada dela falhou: erros).
async function consultarNotas(nfs, opts) {
  opts = opts || {};
  const tempo = typeof opts.temTempo === 'function' ? opts.temTempo : () => true;
  const out = { porNf: {}, consultadas: 0, chamadas: 0, erros: [] };
  if (!configurado()) { out.erros.push('BRIX_TOKEN não configurado'); return out; }
  const unicas = Array.from(new Set((nfs || []).map(nfNorm).filter(Boolean)));
  for (let i = 0; i < unicas.length; i += POR_CHAMADA) {
    if (!tempo()) { out.erros.push('o tempo acabou: ' + (unicas.length - i) + ' NF(s) ficaram para a próxima rodada'); break; }
    const lote = unicas.slice(i, i + POR_CHAMADA);
    out.chamadas++;
    try {
      const j = await getJson(BASE() + '/tracking/integracao/' + encodeURIComponent(TOKEN()) + '/notas/' + lote.join(','));
      if (!j || Number(j.status) !== 1) {
        // "nenhum registro" não é erro: só não há envio dessas NFs na Brix
        const msg = limpo(j && j.message);
        if (!/nenhum|nao encontr|não encontr|sem regist/i.test(msg)) out.erros.push('a Brix recusou a consulta: ' + (msg || 'status ' + (j && j.status)));
        else out.consultadas += lote.length;
        continue;
      }
      out.consultadas += lote.length;
      const pedidas = new Set(lote);
      (Array.isArray(j.data) ? j.data : Object.values(j.data || {})).forEach(x => {
        const n = normalizar(x || {});
        if (!n.nf || !pedidas.has(n.nf)) return;
        out.porNf[n.nf] = melhor(out.porNf[n.nf], n);
      });
    } catch (e) { out.erros.push(limpo(e.message)); }
  }
  return out;
}

module.exports = { configurado, consultarNotas, nfNorm, _interno: { normalizar, dataBr, melhor, limpo } };
