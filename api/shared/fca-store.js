// ================================================================
// api/shared/fca-store.js — fichas do FCA (Comercial) em Azure Blob
//
// Até 28/09/2026 as fichas moravam no localStorage de cada navegador: o
// gerente não via as do time e o "Forecast (FCA)" da filial só somava o que
// estava digitado naquela máquina. Agora é UM blob JSON POR MÊS de
// competência, num container DEDICADO (sem mistura com avisos/radar):
//
//   fca-2026-09.json = { versao, ano, mes, atualizadoEm, seq,
//                        fichas: [ { id, ficha, cliente, valor, unidade, acao,
//                                    data, status, autorEmail, autorNome,
//                                    criadoEm, modBy, modAt, hist:[...],
//                                    removida?, origem?, importada? } ] }
//
// Um arquivo por mês mantém cada leitura pequena (a tela sempre abre UM mês)
// e isola a concorrência: dois vendedores gravando em meses diferentes nunca
// disputam o mesmo ETag.
//
//   FCA_BLOB_URL = SAS de CONTAINER (sr=c) com Read + Create + Write.
//     • container: https://<conta>.blob.core.windows.net/fca?<SAS>
//     • ou a URL de qualquer blob dele: .../fca/fca-2026-09.json?<SAS>
//   (o nome do arquivo é trocado por mês mantendo a assinatura — por isso
//    uma SAS de blob único (sr=b) NÃO serve: ela só assina aquele arquivo.)
//
// Sem a env → configured() = false e o /api/fca responde armazenamento:false;
// a tela avisa e não grava em lugar nenhum. NUNCA cai em outro container.
// ================================================================

const URL_SAS = process.env.FCA_BLOB_URL || '';

function configured() { return !!URL_SAS; }

function nomeDoMes(ano, mes) {
  return 'fca-' + ano + '-' + String(mes).padStart(2, '0') + '.json';
}

// URL do blob do mês. Mesma regra do requisicoes-store: nome de container não
// tem ponto, nome de blob tem — então a env pode vir das duas formas.
function urlDe(nome) {
  const u = URL_SAS;
  const q = u.indexOf('?');
  const base = q < 0 ? u : u.slice(0, q);
  const sas = q < 0 ? '' : u.slice(q);
  const last = (base.split('/').pop() || '');
  const pasta = last.indexOf('.') >= 0 ? base.replace(/\/[^/]*$/, '') : base.replace(/\/+$/, '');
  return pasta + '/' + nome + sas;
}

function vazio(ano, mes) {
  return { versao: 1, ano: ano, mes: mes, atualizadoEm: null, seq: 0, fichas: [] };
}

function normaliza(j, ano, mes) {
  const v = vazio(ano, mes);
  if (!j || typeof j !== 'object') return v;
  v.atualizadoEm = j.atualizadoEm || null;
  v.seq = Number(j.seq) || 0;
  v.fichas = Array.isArray(j.fichas) ? j.fichas.filter(f => f && typeof f === 'object' && f.id) : [];
  return v;
}

// Erro de blob com STATUS e dica acionável (a URL, que tem a assinatura,
// NUNCA entra na mensagem). Sem isso uma SAS errada vira "Erro interno.".
function erroBlob(verbo, status) {
  const dicas = {
    0:   'Não foi possível alcançar o storage (rede/DNS).',
    400: 'URL do blob malformada — confira se a SAS foi copiada inteira, com o "?" incluso.',
    401: 'SAS inválida ou expirada — gere uma nova.',
    403: 'SAS sem permissão ou de escopo errado. Precisa ser SAS de CONTAINER (sr=c) com Read + Create + Write; uma SAS de blob único (sr=b) só assina o arquivo que estava na URL.',
    404: 'Container não encontrado — confira o nome do container no meio da URL.'
  };
  const e = new Error('fca blob ' + verbo + ' ' + status);
  e.blob = true;
  e.blobStatus = status;
  e.blobDica = dicas[status] || ('O storage respondeu ' + status + '.');
  return e;
}

// Devolve também o etag da versão lida (null = mês ainda sem arquivo), que é o
// que permite ao write() gravar sem pisar em quem salvou no meio.
async function read(ano, mes) {
  if (!URL_SAS) { const v = vazio(ano, mes); v.etag = null; return v; }
  let r;
  try { r = await fetch(urlDe(nomeDoMes(ano, mes))); }
  catch (e) { throw erroBlob('GET', 0); }
  if (r.status === 404) {
    // 404 é ambíguo: mês sem fichas (normal) ou container inexistente.
    const corpo = await r.text().catch(() => '');
    if (/ContainerNotFound/i.test(corpo)) throw erroBlob('GET', 404);
    const v = vazio(ano, mes); v.etag = null; return v;
  }
  if (!r.ok) throw erroBlob('GET', r.status);
  const j = await r.json().catch(() => null);
  const out = normaliza(j, ano, mes);
  out.etag = r.headers.get('etag') || null;
  return out;
}

// Gravação CONDICIONAL (o arquivo do mês tem a lista inteira; sem isso duas
// pessoas salvando juntas se sobrescreviam e a ficha da 1ª sumia sem erro).
//   etag string -> If-Match        : grava só se o blob não mudou desde o read
//   etag null   -> If-None-Match:* : grava só se o blob ainda não existe
// 412/409 = alguém gravou primeiro: devolve false p/ o chamador reler e repetir.
async function write(ano, mes, obj, etag) {
  if (!URL_SAS) return false;
  const headers = { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/json' };
  if (typeof etag === 'string' && etag) headers['If-Match'] = etag;
  else if (etag === null) headers['If-None-Match'] = '*';
  const corpo = Object.assign({}, obj);
  delete corpo.etag;
  let r;
  try { r = await fetch(urlDe(nomeDoMes(ano, mes)), { method: 'PUT', headers: headers, body: JSON.stringify(corpo) }); }
  catch (e) { throw erroBlob('PUT', 0); }
  if (r.status === 412 || r.status === 409) return false;
  if (!r.ok) throw erroBlob('PUT', r.status);
  return true;
}

// { status, dica } de um erro de blob — ou null se o erro veio de outro lugar
function diagnostico(err) {
  return (err && err.blob) ? { status: err.blobStatus, dica: err.blobDica } : null;
}

module.exports = { configured, read, write, vazio, nomeDoMes, urlDe, diagnostico };
