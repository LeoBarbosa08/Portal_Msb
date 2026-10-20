// ================================================================
// /api/dossie-ganchos  —  Dossiê de Visita (Comercial) · SOMENTE LEITURA
//
// Recebe o dossiê COMPACTO que a página montou (números já calculados pelo
// dossie-motor.js) e devolve 3 ganchos de conversa + um resumo de uma linha.
// Não consulta Power BI, não consulta Salesforce, não grava nada.
//
// A IA NÃO INVENTA NÚMERO — três defesas:
//   1. o prompt recebe só o JSON do dossiê (sem catálogo: é ele que custa
//      96% dos tokens da LICI) e a lista fechada de `fonte` válidas;
//   2. `json_schema` estrito obriga cada gancho a citar uma `fonte`;
//   3. o SERVIDOR descarta gancho cuja `fonte` não existe no payload — mesmo
//      espírito do `codigoNoCatalogo` do /api/licitacao-analisar.
//
//   POST /api/dossie-ganchos  { dossie: {...} }
//   -> { resumo, ganchos:[{titulo, fala, fonte, tipo}], descartados, model }
//
// Env: AOAI_ENDPOINT, AOAI_KEY, AOAI_DEPLOYMENT, AOAI_APIVER,
//      AOAI_REASONING, DOSSIE_MAXTOKENS (default 3000),
//      DOSSIE_POLITICA (frase de política comercial, opcional).
// ================================================================

const auth = require('../shared/auth');
const http = require('../shared/http');

const AOAI_ENDPOINT   = process.env.AOAI_ENDPOINT;
const AOAI_KEY        = process.env.AOAI_KEY;
const AOAI_DEPLOYMENT = process.env.AOAI_DEPLOYMENT || 'gpt-4o-mini';
const AOAI_APIVER     = process.env.AOAI_APIVER || '2025-01-01-preview';
const MAXTOK          = Number(process.env.DOSSIE_MAXTOKENS || 3000);
const REASONING       = process.env.AOAI_REASONING || 'minimal';
const POLITICA        = process.env.DOSSIE_POLITICA || '';
const MAX_CHARS       = 24000;   // teto do payload que vai ao modelo

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['resumo', 'ganchos'],
  properties: {
    resumo: { type: 'string', description: 'Uma frase sobre a situação do cliente, no máximo 200 caracteres.' },
    ganchos: {
      type: 'array', minItems: 1, maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titulo', 'fala', 'fonte', 'tipo'],
        properties: {
          titulo: { type: 'string', description: 'Rótulo curto do assunto, até 60 caracteres.' },
          fala:   { type: 'string', description: 'Como puxar o assunto na visita, 1 a 2 frases, na voz do vendedor.' },
          fonte:  { type: 'string', description: 'A fonte EXATA da lista de fontes permitidas que sustenta este gancho.' },
          tipo:   { type: 'string', enum: ['oportunidade', 'risco', 'relacionamento'] }
        }
      }
    }
  }
};

function systemPrompt(fontes) {
  return [
    'Você prepara vendedores da BIOMEDICAL (dispositivos médico-hospitalares: vascular, cardiologia intervencionista, extração de eletrodos, UTI, hemodiálise, fios-guia e pulseiras Bio.ID) para uma VISITA presencial a um cliente.',
    '',
    'Você recebe um dossiê em JSON com números JÁ CALCULADOS. Devolva no máximo 3 ganchos de conversa e um resumo de uma frase.',
    '',
    'REGRAS QUE NÃO SE NEGOCIAM:',
    '1. NÃO INVENTE NADA. Todo número, nome de família, produto, nota fiscal, contrato ou data que você escrever tem de estar literalmente no JSON recebido.',
    '2. Cada gancho DEVE citar, no campo "fonte", um valor EXATO desta lista (copie sem alterar):',
    fontes.map(function (f) { return '   - ' + f; }).join('\n'),
    '3. Escolha os 3 assuntos MAIS ACIONÁVEIS. Priorize, nesta ordem: consignado parado, ata/contrato vencendo com saldo, família abandonada, queda de faturamento, oportunidade parada, cirurgia próxima.',
    '4. "fala" é o que o vendedor diz ao cliente: 1 ou 2 frases, tom profissional e direto, em português do Brasil, sem saudação e sem promessa comercial.',
    '5. Não sugira desconto, prazo de pagamento, condição especial nem qualquer compromisso que dependa de aprovação.',
    '6. Não trate assunto financeiro de cobrança: títulos vencidos estão fora deste dossiê.',
    POLITICA ? '7. Política da empresa: ' + POLITICA : '',
    '',
    'Escreva em português do Brasil. Valores em reais como aparecem no JSON.'
  ].filter(Boolean).join('\n');
}

// as fontes válidas saem do PRÓPRIO dossiê: é a lista fechada que o modelo
// pode citar e contra a qual o servidor confere a resposta
function fontesValidas(d) {
  const out = [];
  const add = function (f) { if (f && out.indexOf(f) < 0) out.push(f); };
  (d.destaques || []).forEach(function (x) { add(x.fonte); });
  const c = d.compras;
  if (c) {
    add('compras.resumo');
    if (c.variacao != null) add('compras.variacao');
    (c.familias || []).forEach(function (f) { add('compras.familias.' + f.fam); });
    add('compras.segmento');
  }
  if (d.posicao && d.posicao.rank) add('posicao');
  (d.topProdutos || []).forEach(function (p) { add('produtos.' + (p.cod || p.prod)); });
  if (d.cirurgias && d.cirurgias.total) {
    add('cirurgias.resumo');
    (d.cirurgias.proximas || []).forEach(function (x) { add('cirurgias.' + (x.nome || x.data)); });
  }
  if (d.consignacao && d.consignacao.itens) {
    add('consignacao.resumo');
    (d.consignacao.topNotas || []).forEach(function (n) { add('consignacao.notas.' + n.nota); });
    (d.consignacao.aVencer || []).forEach(function (x) { add('consignacao.vencimento.' + (x.lote || x.cod)); });
    if (d.consignacao.aguardando) add('consignacao.aguardando');
  }
  if (d.oportunidades && d.oportunidades.total) {
    add('oportunidades.resumo');
    (d.oportunidades.maiores || []).forEach(function (o) { add('oportunidades.' + o.nome); });
    (d.oportunidades.paradas || []).forEach(function (o) { add('oportunidades.paradas.' + o.nome); });
  }
  if (d.atas && d.atas.total) {
    add('atas.resumo');
    (d.atas.contratos || []).forEach(function (o) { add('atas.' + o.oportunidade); });
    (d.atas.nuncaFaturou || []).forEach(function (a) { add('atas.nuncaFaturou.' + (a.cod || a.produto)); });
  }
  return out;
}

// versão enxuta do dossiê: só o que sustenta um gancho. Sem séries mensais,
// sem listas longas — o prompt tem de caber em poucos milhares de tokens.
function compactar(d) {
  const cli = d.cliente || {};
  const o = {
    cliente: { nome: cli.nome, cidade: cli.cidade, uf: cli.uf, tipo: cli.tipo, carteira: cli.carteira },
    hoje: d.hoje,
    semaforo: d.semaforo && { cor: d.semaforo.cor, motivos: d.semaforo.motivos },
    destaques: (d.destaques || []).map(function (x) { return { fonte: x.fonte, tipo: x.tipo, texto: x.texto }; })
  };
  const c = d.compras;
  if (c) o.compras = {
    fat12: Math.round(c.fat12), fat12ant: Math.round(c.fat12ant),
    variacaoPct: c.variacao == null ? null : Math.round(c.variacao * 100),
    ultimaCompra: c.ultimaCompra, recenciaDias: c.recenciaDias,
    segmento: c.segmento && c.segmento.nome, motivoSegmento: c.segmento && c.segmento.motivo,
    familias: (c.familias || []).slice(0, 10).map(function (f) {
      return { fam: f.fam, status: f.status, fat12: Math.round(f.fat12), fat12ant: Math.round(f.fat12ant), mesesSemCompra: f.mesesSemCompra };
    })
  };
  if (d.posicao && d.posicao.rank) o.posicao = { rank: d.posicao.rank, de: d.posicao.de, classe: d.posicao.classe };
  if (d.topProdutos) o.topProdutos = d.topProdutos.slice(0, 5).map(function (p) { return { cod: p.cod, produto: p.prod, fat: Math.round(p.fat) }; });
  if (d.cirurgias && d.cirurgias.total) o.cirurgias = {
    total: d.cirurgias.total, em30dias: d.cirurgias.em30dias,
    proximas: (d.cirurgias.proximas || []).slice(0, 4).map(function (x) {
      return { nome: x.nome, data: x.data, diasAte: x.diasAte, fase: x.fase, medico: x.medico, valor: Math.round(x.valor), familias: x.familias };
    })
  };
  if (d.consignacao && d.consignacao.itens) o.consignacao = {
    saldo: d.consignacao.saldo, custo: Math.round(d.consignacao.custo), aguardando: d.consignacao.aguardando,
    notasParadas: (d.consignacao.paradas || []).slice(0, 5).map(function (n) { return { nota: n.nota, idadeDias: n.idadeDias, saldo: n.saldo, custo: Math.round(n.custo), produtos: n.produtos }; }),
    lotesAVencer: (d.consignacao.aVencer || []).slice(0, 5).map(function (x) { return { lote: x.lote, cod: x.cod, produto: x.produto, diasParaVencer: x.diasParaVencer }; })
  };
  if (d.oportunidades && d.oportunidades.total) o.oportunidades = {
    total: d.oportunidades.total, valor: Math.round(d.oportunidades.valor),
    maiores: (d.oportunidades.maiores || []).slice(0, 5).map(function (x) { return { nome: x.nome, tipo: x.tipo, fase: x.fase, valor: Math.round(x.valor), idadeDias: x.idadeDias, diasNaFase: x.diasNaFase, diasAteCirurgia: x.diasAteCirurgia }; })
  };
  if (d.atas && d.atas.total) o.atas = {
    total: d.atas.total, emAberto: Math.round(d.atas.emAberto), faturado: Math.round(d.atas.faturado),
    contratos: (d.atas.contratos || []).slice(0, 5).map(function (x) { return { oportunidade: x.oportunidade, classe: x.classe, diasRestantes: x.diasRestantes, emAberto: Math.round(x.emAberto), pctFaturado: x.pctFaturado == null ? null : Math.round(x.pctFaturado * 100) }; }),
    nuncaFaturou: (d.atas.nuncaFaturou || []).slice(0, 5).map(function (a) { return { cod: a.cod, produto: a.produto, contrato: a.oportunidade, emAberto: Math.round(a.emAberto) }; })
  };
  return o;
}

module.exports = async function (context, req) {
  const cors = http.cors(req);
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: cors }; return; }
  const json = function (status, body) {
    context.res = { status: status, headers: Object.assign({ 'Content-Type': 'application/json' }, cors), body: body };
  };

  try {
    await auth.requireArea(req, 'comercial');

    if (!AOAI_ENDPOINT || !AOAI_KEY) {
      json(200, { ok: false, configurado: false,
        error: 'Os ganchos de conversa precisam do Azure OpenAI. Defina AOAI_ENDPOINT e AOAI_KEY na Function App do portal.' });
      return;
    }

    const d = (req.body && req.body.dossie) || null;
    if (!d || typeof d !== 'object') throw http.badRequest('Envie "dossie" (o objeto que a página montou).');

    const fontes = fontesValidas(d);
    if (!fontes.length) {
      json(200, { ok: true, resumo: '', ganchos: [], descartados: 0, semDados: true });
      return;
    }

    let corpo = JSON.stringify(compactar(d));
    if (corpo.length > MAX_CHARS) corpo = corpo.substring(0, MAX_CHARS);

    const url = AOAI_ENDPOINT.replace(/\/$/, '') +
      '/openai/deployments/' + AOAI_DEPLOYMENT + '/chat/completions?api-version=' + AOAI_APIVER;
    const payload = {
      messages: [
        { role: 'system', content: systemPrompt(fontes) },
        { role: 'user',   content: 'DOSSIÊ DO CLIENTE (JSON):\n' + corpo }
      ],
      max_completion_tokens: MAXTOK,
      response_format: { type: 'json_schema', json_schema: { name: 'ganchos_de_visita', strict: true, schema: SCHEMA } }
    };
    if (REASONING) payload.reasoning_effort = REASONING;

    const r = await fetch(url, { method: 'POST', headers: { 'api-key': AOAI_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const text = await r.text();
    if (!r.ok) { json(502, { ok: false, error: 'Azure OpenAI ' + r.status + ' — tente de novo em alguns instantes.' }); http.logError(context, 'dossie-ganchos/aoai', new Error(text.substring(0, 400))); return; }

    const j = JSON.parse(text);
    const choice = (j.choices || [])[0] || {};
    const content = choice.message && choice.message.content;
    if (!content) { json(502, { ok: false, error: 'A resposta veio vazia (motivo: ' + (choice.finish_reason || '?') + ').' }); return; }

    let dados;
    try { dados = JSON.parse(content); }
    catch (e) { json(502, { ok: false, error: 'A IA devolveu um JSON inválido. Tente de novo.' }); return; }

    // GUARD: gancho com fonte que não existe no dossiê é DESCARTADO
    const ok = [];
    let descartados = 0;
    (dados.ganchos || []).forEach(function (g) {
      const f = String(g.fonte || '').trim();
      if (fontes.indexOf(f) < 0) { descartados++; return; }
      ok.push({
        titulo: String(g.titulo || '').substring(0, 80),
        fala: String(g.fala || '').substring(0, 400),
        fonte: f,
        tipo: ['oportunidade', 'risco', 'relacionamento'].indexOf(g.tipo) >= 0 ? g.tipo : 'relacionamento'
      });
    });

    json(200, {
      ok: true,
      resumo: String(dados.resumo || '').substring(0, 240),
      ganchos: ok.slice(0, 3),
      descartados: descartados,
      model: j.model || null, deployment: AOAI_DEPLOYMENT
    });
  } catch (err) {
    http.sendError(context, req, 'dossie-ganchos', err);
  }
};

module.exports._interno = { fontesValidas, compactar, SCHEMA };
