// ================================================================
// api/shared/vigia-blob.js — estado do Vigia de Consignação em Azure Blob
//
// Clone deliberado do radar-blob.js, apontando para um container
// DEDICADO (não misturar com o Radar da LICI):
//
//   VIGIA_BLOB_URL = https://<conta>.blob.core.windows.net/consig-vigia/estado.json?<SAS>
//
// A SAS precisa ser de CONTAINER (sr=c) com Read + Write + Create — assim
// a MESMA URL serve para estado.json, fila.json e historico.json (urlDe()
// troca só o nome do arquivo, mantendo a assinatura).
//
// Sem a env configurada, configurado() devolve false e o Vigia degrada para
// "varredura ao vivo sem persistência": a página calcula e mostra a fila,
// mas as decisões não sobrevivem ao reload.
// ================================================================

const BLOB_URL = process.env.VIGIA_BLOB_URL || '';

function configurado() { return !!BLOB_URL; }

// URL de um blob "irmão" no mesmo container (a SAS de container vale p/ todos)
function urlDe(nome) {
  if (!BLOB_URL) return '';
  const q = BLOB_URL.indexOf('?');
  const base = q < 0 ? BLOB_URL : BLOB_URL.slice(0, q);
  const sas  = q < 0 ? '' : BLOB_URL.slice(q);
  return base.replace(/\/[^/]+$/, '/' + nome) + sas;
}

// Erro de blob carrega o STATUS e uma dica acionável. Sem isso, uma SAS errada
// vira "Erro interno." e o módulo inteiro cai — sendo que a causa quase sempre
// é uma das quatro abaixo, e nenhuma delas exige ler log no App Insights.
// A URL (que contém a assinatura) NUNCA entra na mensagem.
function erroBlob(verbo, status) {
  const dicas = {
    400: 'URL do blob malformada — confira se a SAS foi copiada inteira, com o "?" incluso.',
    401: 'SAS inválida ou expirada — gere uma nova.',
    403: 'SAS sem permissão ou de escopo errado. Precisa ser SAS de CONTAINER (sr=c) com Read + Write + Create; uma SAS de blob único (sr=b) só assina o arquivo que estava na URL.',
    404: 'Container não encontrado — confira o nome do container no meio da URL.',
    409: 'Conflito no blob — outra escrita em andamento.'
  };
  const e = new Error('blob ' + verbo + ' ' + status);
  e.blobStatus = status;
  e.blobDica = dicas[status] || ('O storage respondeu ' + status + '.');
  e.blob = true;
  return e;
}

async function lerJson(nome, vazio) {
  const url = urlDe(nome);
  if (!url) return vazio;
  let r;
  try { r = await fetch(url); }
  catch (e) { const x = erroBlob('GET', 0); x.blobDica = 'Não foi possível alcançar o storage (rede/DNS).'; throw x; }
  // 404 aqui é ambíguo: pode ser "primeiro uso" (blob ainda não existe) ou
  // container inexistente. O corpo do Azure distingue os dois.
  if (r.status === 404) {
    const corpo = await r.text().catch(() => '');
    if (/ContainerNotFound/i.test(corpo)) throw erroBlob('GET', 404);
    return vazio;                                           // primeiro uso, tudo certo
  }
  if (!r.ok) throw erroBlob('GET', r.status);
  const j = await r.json().catch(() => null);
  return j == null ? vazio : j;
}

async function gravarJson(nome, obj) {
  const url = urlDe(nome);
  if (!url) return false;
  let r;
  try {
    r = await fetch(url, {
      method: 'PUT',
      headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/json' },
      body: JSON.stringify(obj)
    });
  } catch (e) { const x = erroBlob('PUT', 0); x.blobDica = 'Não foi possível alcançar o storage (rede/DNS).'; throw x; }
  if (!r.ok) throw erroBlob('PUT', r.status);
  return true;
}

// { status, dica } de um erro de blob — ou null se o erro veio de outro lugar
function diagnostico(err) {
  return (err && err.blob) ? { status: err.blobStatus, dica: err.blobDica } : null;
}

module.exports = { configurado, urlDe, lerJson, gravarJson, diagnostico };
