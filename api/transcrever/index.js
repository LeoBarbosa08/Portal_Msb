// ================================================================
// /api/transcrever  —  fala → texto (Azure OpenAI Whisper)
//
// Fallback de microfone para navegadores onde o Web Speech API não
// transcreve (Edge desktop, iPhone/Safari). O navegador grava o
// áudio com MediaRecorder e manda aqui em base64; a function repassa
// ao deployment de transcrição do Azure OpenAI e devolve { text }.
//
// Envs: AOAI_ENDPOINT + AOAI_KEY   (os mesmos do /api/chat)
//       AOAI_STT_DEPLOYMENT        (default 'whisper')
//       AOAI_STT_APIVER            (default '2024-06-01')
// ================================================================

const AOAI_ENDPOINT   = process.env.AOAI_ENDPOINT;
const AOAI_KEY        = process.env.AOAI_KEY;
const STT_DEPLOYMENT  = process.env.AOAI_STT_DEPLOYMENT || 'whisper';
const STT_APIVER      = process.env.AOAI_STT_APIVER || '2024-06-01';

const EXT = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav' };

const auth = require('../shared/auth');
const http = require('../shared/http');

module.exports = async function (context, req) {
  const cors = http.cors(req);
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: cors }; return; }

  try {
    await auth.requireUser(req);

    if (!AOAI_ENDPOINT || !AOAI_KEY) { const e = new Error('AOAI não configurado'); e.status = 500; throw e; }
    const b64 = req.body && req.body.audio;
    if (!b64 || typeof b64 !== 'string') {
      context.res = { status: 400, headers: cors, body: { error: 'Faltou "audio" (base64) no body.' } };
      return;
    }
    if (b64.length > 14000000) {   // ~10 MB de áudio — muito além dos 30 s gravados
      context.res = { status: 413, headers: cors, body: { error: 'Áudio muito grande.' } };
      return;
    }
    const mime = String((req.body && req.body.mime) || 'audio/webm').split(';')[0];
    const buf = Buffer.from(b64, 'base64');

    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: mime }), 'fala.' + (EXT[mime] || 'webm'));
    fd.append('language', 'pt');
    fd.append('response_format', 'json');

    const url = AOAI_ENDPOINT.replace(/\/$/, '') +
      '/openai/deployments/' + STT_DEPLOYMENT + '/audio/transcriptions?api-version=' + STT_APIVER;
    const r = await fetch(url, { method: 'POST', headers: { 'api-key': AOAI_KEY }, body: fd });
    const text = await r.text();
    if (!r.ok) {
      const hint = r.status === 404
        ? ' Crie um deployment de transcrição (ex.: "whisper") no recurso Azure OpenAI ou defina AOAI_STT_DEPLOYMENT com o nome do deployment existente.'
        : '';
      context.res = { status: r.status, headers: cors, body: { error: 'Azure OpenAI ' + r.status + '.' + hint, details: text.substring(0, 300) } };
      return;
    }
    const j = JSON.parse(text);
    context.res = { status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: { text: String(j.text || '').trim() } };
  } catch (err) {
    http.sendError(context, req, 'transcrever', err);
  }
};
