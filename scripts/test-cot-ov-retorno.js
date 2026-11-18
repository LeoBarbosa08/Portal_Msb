// ================================================================
// scripts/test-cot-ov-retorno.js — o Caso que o flow do PI devolve
// (cot-motor.casoDoFlow / retornoDoFlow e a rota /api/cot-ov-retorno).
//
//   node scripts/test-cot-ov-retorno.js
//
// 18/11/26 (dono: "veio o número sem o COT-"): o Caso vale com ou sem o
// prefixo; o "só ano + sequência" só com OV da MSB (a BIO tem a mesma
// numeração). Aqui só o que não precisa do armazenamento das cotações.
// ================================================================

delete process.env.COT_OV_CHAVE;
let falhas = 0;
function t(nome, ok, extra) { console.log((ok ? '  ok  ' : '  FALHOU ') + nome + (ok || extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); if (!ok) falhas++; }

const M = require('../api/shared/cot-motor');
const fn = require('../api/cot-ov-retorno/index.js');
async function chama(corpo, chave) {
  const c = { log: Object.assign(() => {}, { error() {} }) };
  await fn(c, { method: 'POST', headers: chave ? { 'x-portal-chave': chave } : {}, body: corpo });
  return c.res;
}

(async () => {
  console.log('1) o Caso: com ou sem o COT-');
  const MSB = ['OVMSB144950'];
  t('COT-MSB-2026-000123 (inteiro)', M.casoDoFlow('COT-MSB-2026-000123', MSB) === 'COT-MSB-2026-000123');
  t('MSB-2026-000123 (sem o COT-)', M.casoDoFlow('MSB-2026-000123', MSB) === 'COT-MSB-2026-000123');
  t('minúsculo, espaços e sem hífen: "msb 2026 000123", "MSB2026000123"', M.casoDoFlow('msb 2026 000123', MSB) === 'COT-MSB-2026-000123' && M.casoDoFlow('MSB2026000123', MSB) === 'COT-MSB-2026-000123');
  t('2026-000123 com OV da MSB', M.casoDoFlow('2026-000123', MSB) === 'COT-MSB-2026-000123');
  t('2026-000123 com OV da BIO: não (a BIO tem a mesma numeração)', M.casoDoFlow('2026-000123', ['OVBIO012345']) === '');
  t('2026-000123 com uma OV da MSB e outra da BIO: não', M.casoDoFlow('2026-000123', ['OVMSB144950', 'OVBIO012345']) === '');
  t('2026-000123 sem OV válida: não', M.casoDoFlow('2026-000123', []) === '');
  t('MSB-… vale mesmo com OV de outra empresa (o portal confere e avisa na OV)', M.casoDoFlow('MSB-2026-000123', ['OVBIO012345']) === 'COT-MSB-2026-000123');
  t('N/D, vazio, caso do Customer Service: não', M.casoDoFlow('N/D', MSB) === '' && M.casoDoFlow('', MSB) === '' && M.casoDoFlow('CS-2026-000123', MSB) === '');
  t('número curto/comprido demais: não', M.casoDoFlow('MSB-2026-123', MSB) === '' && M.casoDoFlow('MSB-2026-0001234', MSB) === '');

  console.log('2) retornoDoFlow: o que não é cotação da MSB é ignorado (antes de olhar a OV)');
  let r = await M.retornoDoFlow('N/D', 'qualquer coisa');
  t('N/D -> ignorado, sem erro de OV', r.ignorado === true && /N\/D/.test(r.motivo), r);
  r = await M.retornoDoFlow('2026-000123', 'OVBIO012345');
  t('ano + sequência com OV da BIO -> ignorado', r.ignorado === true, r);
  let erro = null;
  try { await M.retornoDoFlow('MSB-2026-000123', 'abc'); } catch (e) { erro = e; }
  t('cotação da MSB com OV inválida -> 400', erro && erro.status === 400 && /OrdemVenda inválida/.test(erro.publicMessage), erro && erro.publicMessage);

  console.log('3) a rota: chave');
  r = await chama({ Caso: 'MSB-2026-000123', OrdemVenda: 'OVMSB144950' });
  t('sem COT_OV_CHAVE: 503', r.status === 503, r);
  process.env.COT_OV_CHAVE = 'chave-do-flow-do-pi-com-24-caracteres';
  r = await chama({ Caso: 'MSB-2026-000123', OrdemVenda: 'OVMSB144950' }, 'errada');
  t('chave errada: 401', r.status === 401, r);
  r = await chama({ Caso: 'N/D', OrdemVenda: 'OVMSB144950' }, process.env.COT_OV_CHAVE);
  t('chave certa, Caso N/D: 200 ignorado', r.status === 200 && r.body.ignorado === true, r);

  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\ntudo ok');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
