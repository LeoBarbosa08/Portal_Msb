// ================================================================
// api/shared/cot-store.js — persistência do módulo Cotações (Comercial)
// em Azure Blob, por SAS de CONTAINER (sem SDK, sem npm). Mesmo molde do
// cs-store.js do Customer Service.
//
//   COT_BLOB_URL = https://<conta>.blob.core.windows.net/cotacoes?<SAS>
//
// Container PRÓPRIO, só das cotações: o módulo nunca grava no container de
// outro módulo. Sem COT_BLOB_URL fica "sem armazenamento" (configurado:false):
// a tela avisa, a lista vem vazia e nenhum caso é gravado.
//
// A SAS precisa ser de CONTAINER (sr=c) com Read + Create + Write: o módulo
// grava vários arquivos (um por caso e um por PDF anexado).
//
//   indice.json           o resumo de cada caso (lista, quadro e funil leem
//                         só ele), o contador do número (seq), a revisão
//                         (rev, que a tela consulta barato) e o mapa de
//                         duplicidade (chaves: "portal|nº da cotação" -> caso)
//   casos/<numero>.json   o caso inteiro: itens, anexos, pedido, PI,
//                         notas e o histórico campo a campo
//   anexos/<AAAA-MM>/<id>.<ext>
//                         o ARQUIVO (PDF da cotação, PDF do pedido, outros) —
//                         binário, com o tipo certo: abre direto no Storage
//   config.json           equipe, portais, motivos de perda, empresas, áreas
//
// GRAVAÇÃO CONDICIONAL AO ETAG em todo JSON (duas pessoas mexendo no mesmo
// caso não se atropelam: atualizar() relê, reaplica e repete). Arquivo
// anexado é gravado UMA vez (If-None-Match:*) e nunca reescrito — a SAS não
// tem Delete, então "remover anexo" só o esconde no caso.
// ================================================================

const BLOB_URL = process.env.COT_BLOB_URL || '';

const INDICE = 'indice.json';
const CONFIG = 'config.json';
function arquivoDoCaso(numero) { return 'casos/' + String(numero || '').replace(/[^A-Za-z0-9-]/g, '') + '.json'; }

function configurado() { return !!BLOB_URL; }
// de onde vem o armazenamento (a tela de Configurações mostra)
function origem() { return BLOB_URL ? 'COT_BLOB_URL' : ''; }

// Aceita a env com OU sem um arquivo no fim (…/cotacoes?SAS ou
// …/cotacoes/indice.json?SAS): o nome pedido substitui o arquivo, ou é
// acrescentado ao container. Mesma regra dos outros stores do portal.
function urlDe(nome) {
  if (!BLOB_URL) return '';
  const q = BLOB_URL.indexOf('?');
  const base = (q < 0 ? BLOB_URL : BLOB_URL.slice(0, q)).replace(/\/+$/, '');
  const sas = q < 0 ? '' : BLOB_URL.slice(q);
  const segs = base.replace(/^https?:\/\/[^/]+/, '').split('/').filter(Boolean);
  const caminho = String(nome).split('/').map(encodeURIComponent).join('/');
  if (segs.length <= 1 || !/\.json$/i.test(segs[segs.length - 1])) return base + '/' + caminho + sas;
  return base.replace(/\/[^/]+$/, '/' + caminho) + sas;
}

// A URL (que carrega a assinatura) NUNCA entra na mensagem de erro.
function erroBlob(verbo, status) {
  const dicas = {
    400: 'URL do blob malformada — confira se a SAS foi copiada inteira, com o "?" incluso.',
    401: 'SAS inválida ou expirada — gere uma nova.',
    403: 'SAS sem permissão ou de escopo errado. Precisa ser SAS de CONTAINER (sr=c) com Read + Create + Write.',
    404: 'Container não encontrado — confira o nome do container no meio da URL.'
  };
  const e = new Error('blob ' + verbo + ' ' + status);
  e.blob = true;
  e.blobStatus = status;
  e.blobDica = dicas[status] || ('O storage respondeu ' + status + '.');
  return e;
}
function semRede(verbo) { const x = erroBlob(verbo, 0); x.blobDica = 'Não foi possível alcançar o storage (rede/DNS).'; return x; }

// { dados, etag } — etag null = o arquivo ainda não existe (primeiro uso).
async function ler(nome, vazio) {
  const url = urlDe(nome);
  if (!url) return { dados: clonar(vazio), etag: null };
  let r;
  try { r = await fetch(url, { headers: { 'x-ms-version': '2021-08-06' } }); }
  catch (e) { throw semRede('GET'); }
  if (r.status === 404) {
    const corpo = await r.text().catch(() => '');
    if (/ContainerNotFound/i.test(corpo)) throw erroBlob('GET', 404);
    return { dados: clonar(vazio), etag: null };
  }
  if (!r.ok) throw erroBlob('GET', r.status);
  const etag = r.headers.get('etag') || null;
  const j = await r.json().catch(() => null);
  return { dados: j == null ? clonar(vazio) : j, etag: etag };
}

// etag string -> If-Match (só grava se ninguém mexeu desde a leitura)
// etag null   -> If-None-Match:* (só grava se o arquivo ainda não existe)
// devolve false em conflito (412/409) — quem chama relê e repete.
async function gravar(nome, obj, etag) {
  const url = urlDe(nome);
  if (!url) return false;
  const headers = { 'x-ms-blob-type': 'BlockBlob', 'x-ms-version': '2021-08-06', 'Content-Type': 'application/json; charset=utf-8' };
  if (typeof etag === 'string' && etag) headers['If-Match'] = etag;
  else if (etag === null) headers['If-None-Match'] = '*';
  let r;
  try { r = await fetch(url, { method: 'PUT', headers: headers, body: JSON.stringify(obj) }); }
  catch (e) { throw semRede('PUT'); }
  if (r.status === 412 || r.status === 409) return false;
  if (!r.ok) throw erroBlob('PUT', r.status);
  return true;
}

// Lê, aplica `mudar(dados)` e grava condicionado ao ETag, repetindo em
// conflito. `mudar` pode devolver false para NÃO gravar (nada mudou).
// Devolve { dados, gravou }.
async function atualizar(nome, vazio, mudar, tentativas) {
  const max = tentativas || 8;
  for (let i = 0; i < max; i++) {
    const { dados, etag } = await ler(nome, vazio);
    const r = await mudar(dados);
    if (r === false) return { dados: dados, gravou: false };
    if (await gravar(nome, dados, etag)) return { dados: dados, gravou: true };
    await new Promise(res => setTimeout(res, 60 + Math.random() * 160 * (i + 1)));
  }
  const e = new Error('conflito de gravação persistente em ' + nome);
  e.status = 409;
  e.publicMessage = 'Muita gente mexendo neste caso ao mesmo tempo — tente de novo.';
  throw e;
}

// ── arquivos (PDF da cotação, do pedido…) ─────────────────────────
// Gravado uma vez só: nome novo a cada anexo, If-None-Match:*.
async function gravarArquivo(nome, bytes, tipo) {
  const url = urlDe(nome);
  if (!url) return false;
  let r;
  try {
    r = await fetch(url, { method: 'PUT', body: bytes, headers: {
      'x-ms-blob-type': 'BlockBlob', 'x-ms-version': '2021-08-06', 'If-None-Match': '*',
      'Content-Type': tipo || 'application/octet-stream'
    } });
  } catch (e) { throw semRede('PUT'); }
  if (r.status === 412 || r.status === 409) return false;
  if (!r.ok) throw erroBlob('PUT', r.status);
  return true;
}
// Buffer, ou null se o arquivo não existe
async function lerArquivo(nome) {
  const url = urlDe(nome);
  if (!url) return null;
  let r;
  try { r = await fetch(url, { headers: { 'x-ms-version': '2021-08-06' } }); }
  catch (e) { throw semRede('GET'); }
  if (r.status === 404) return null;
  if (!r.ok) throw erroBlob('GET', r.status);
  return Buffer.from(await r.arrayBuffer());
}

function clonar(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

function diagnostico(err) {
  return (err && err.blob) ? { status: err.blobStatus, dica: err.blobDica } : null;
}

module.exports = { INDICE, CONFIG, arquivoDoCaso, configurado, origem, urlDe, ler, gravar, atualizar, gravarArquivo, lerArquivo, diagnostico };
