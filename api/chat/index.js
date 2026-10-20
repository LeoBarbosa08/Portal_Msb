// ================================================================
// /api/chat  —  Portal Biomedical  (agente conversacional do Comercial)
//
// Relay leve entre o navegador e o Azure OpenAI. Faz text-to-DAX:
// o LLM decide a consulta DAX (via ferramenta run_dax); o NAVEGADOR é
// quem executa o DAX com o token do usuário (RLS, funciona no PPU).
// A chave do Azure OpenAI fica só aqui no backend.
//
// Protocolo (stateless — o navegador guarda o histórico):
//   POST /api/chat  { messages: [ {role, content, ...} ] }
//   -> devolve a "assistant message" do modelo. Se ela tiver tool_calls,
//      o navegador executa cada run_dax, adiciona as tool messages e
//      chama /api/chat de novo até vir uma resposta final em texto.
// ================================================================

const { SYSTEM_PROMPT } = require('../shared/comercial-schema');
const { NEGOCIACOES_BASE } = require('../shared/negociacoes-schema');
const auth = require('../shared/auth');
const http = require('../shared/http');

const AOAI_ENDPOINT   = process.env.AOAI_ENDPOINT;   // https://<recurso>.openai.azure.com/
const AOAI_KEY        = process.env.AOAI_KEY;
const AOAI_DEPLOYMENT = process.env.AOAI_DEPLOYMENT || 'gpt-4o-mini';
const AOAI_APIVER     = process.env.AOAI_APIVER || '2025-01-01-preview';
// gpt-5 (reasoning) consome tokens de raciocínio do mesmo orçamento da resposta:
// precisa de folga, senão a resposta sai vazia. Ajustável por env.
const MAXTOK          = Number(process.env.AOAI_MAXTOKENS || 4000);
const REASONING       = process.env.AOAI_REASONING || 'minimal';  // minimal|low|medium|high ('' = não enviar)

const TOOLS = [{
  type: 'function',
  function: {
    name: 'run_dax',
    description: 'Executa uma consulta DAX no modelo Power BI Comercial e retorna as linhas. Use para obter QUALQUER número. Sempre aplique os filtros base.',
    parameters: {
      type: 'object',
      properties: { dax: { type: 'string', description: 'Consulta DAX válida começando com EVALUATE.' } },
      required: ['dax']
    }
  }
}, {
  type: 'function',
  function: {
    name: 'mostrar_grafico',
    description: 'Desenha um gráfico na tela para o usuário. Use quando ele pedir gráfico/visual. Chame DEPOIS de obter os dados com run_dax, passando os rótulos e valores reais.',
    parameters: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['bar', 'line'], description: 'bar = ranking/comparação por categoria; line = evolução no tempo (meses/anos).' },
        titulo: { type: 'string', description: 'Título curto do gráfico.' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Rótulos do eixo (ex.: meses, anos, nomes).' },
        valores: { type: 'array', items: { type: 'number' }, description: 'Valores numéricos, na mesma ordem dos labels.' },
        formato: { type: 'string', enum: ['money', 'int', 'pct'], description: 'money = R$, int = número, pct = porcentagem.' }
      },
      required: ['tipo', 'labels', 'valores']
    }
  }
}];

module.exports = async function (context, req) {
  const cors = http.cors(req);
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: cors }; return; }

  try {
    await auth.requireUser(req);

    if (!AOAI_ENDPOINT || !AOAI_KEY) { const e = new Error('AOAI não configurado'); e.status = 500; throw e; }

    const clientMsgs = (req.body && req.body.messages) || [];
    if (!Array.isArray(clientMsgs) || !clientMsgs.length) throw http.badRequest('Faltou "messages" no body.');
    // limites anti-abuso de custo (generosos — não atrapalham o uso real)
    if (clientMsgs.length > 300) throw http.badRequest('Conversa longa demais.');
    const _tot = clientMsgs.reduce(function (s, m) { return s + String((m && m.content) || '').length; }, 0);
    if (_tot > 400000) throw http.badRequest('Mensagem grande demais.');

    // contexto de data (para "esse ano/mês") + system prompt
    const now = new Date();
    const ctx = `\n\nCONTEXTO: hoje é ${now.toISOString().slice(0,10)}. Ano atual = ${now.getFullYear()}, mês atual = ${now.getMonth()+1}.`;

    // perfil do agente: 'comercial' (default) ou 'negociacoes' (dataset de
    // Negociações — o navegador manda os metadados reais do modelo em "schema")
    const perfil = (req.body && req.body.perfil) === 'negociacoes' ? 'negociacoes' : 'comercial';
    let sys = SYSTEM_PROMPT;
    if (perfil === 'negociacoes') {
      const schema = (req.body && req.body.schema) ? String(req.body.schema).slice(0, 24000) : '';
      sys = NEGOCIACOES_BASE + (schema
        ? '\n\nMODELO DE NEGOCIAÇÕES (metadados REAIS do dataset — use exatamente estes nomes):\n' + schema
        : '\n\n(Metadados do modelo não fornecidos — descubra as tabelas/colunas com EVALUATE COLUMNSTATISTICS() e os valores com VALUES antes de filtrar.)');
    }
    const messages = [{ role: 'system', content: sys + ctx }].concat(clientMsgs);

    const url = AOAI_ENDPOINT.replace(/\/$/, '') +
      '/openai/deployments/' + AOAI_DEPLOYMENT + '/chat/completions?api-version=' + AOAI_APIVER;

    // gpt-5 usa max_completion_tokens e não aceita temperature != 1 (por isso omitida)
    const payload = { messages, tools: TOOLS, tool_choice: 'auto', max_completion_tokens: MAXTOK };
    if (REASONING) payload.reasoning_effort = REASONING;

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'api-key': AOAI_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await r.text();
    if (!r.ok) { const e = new Error('Azure OpenAI ' + r.status); e.status = 502; throw e; }
    const j = JSON.parse(text);
    const choice = (j.choices || [])[0] || {};
    const msg = choice.message || { role: 'assistant', content: null };
    // diagnóstico: se veio vazio (sem texto e sem tool_calls), mostra o motivo (ex.: length)
    if (!msg.content && !(msg.tool_calls && msg.tool_calls.length)) {
      msg.content = '(sem conteúdo — motivo: ' + (choice.finish_reason || '?') +
        (choice.finish_reason === 'length' ? '. Aumente AOAI_MAXTOKENS.' : '') + ')';
    }

    // devolve tb o modelo real que respondeu (diagnóstico) + o deployment configurado
    context.res = { status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
      body: { message: msg, model: j.model || null, deployment: AOAI_DEPLOYMENT } };
  } catch (err) {
    http.sendError(context, req, 'chat', err);
  }
};
