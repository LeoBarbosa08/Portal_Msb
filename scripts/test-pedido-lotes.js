// ================================================================
// scripts/test-pedido-lotes.js — a conta do lote do PI · Pedido
// (api/pedido-lotes) contra um F&O SIMULADO (fetch falso).
//
//   node scripts/test-pedido-lotes.js
//
// A conta (11/11/2026, pedido do dono), no depósito ALMOX-PA:
//   saldo do lote = PhysicalInvent das localizações "PA."
//                 − ReservPhysical das linhas do lote SEM localização
// Cobre: físico fora de "PA." não soma; reserva com localização não desconta;
// lote zerado/negativo fora da lista e sem comer o total; FEFO; o filtro
// OData; e a tabela sem a Localização vira aviso.
// ================================================================

process.env.D365_TENANT_ID = 't'; process.env.D365_CLIENT_ID = 'c'; process.env.D365_CLIENT_SECRET = 's';
process.env.D365_RESOURCE_URL = 'https://fo.teste';

let falhas = 0;
function t(nome, ok, extra) { console.log((ok ? '  ok  ' : '  FALHOU ') + nome + (ok || extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); if (!ok) falhas++; }

let CEN = {};
const filtros = [];
const corpo = (j, st) => ({ ok: (st || 200) < 400, status: st || 200, text: async () => JSON.stringify(j) });
global.fetch = async (url) => {
  url = String(url);
  if (/login\.microsoftonline/.test(url)) return corpo({ access_token: 'tok', expires_in: 3600 });
  const u = new URL(url);
  const ent = u.pathname.replace('/data/', '');
  const f = u.searchParams.get('$filter') || '';
  filtros.push({ ent, f });
  const item = (f.match(/[Ii]temId eq '([^']+)'/) || [])[1];
  return corpo({ value: (CEN[ent] || []).filter(r => (r.ItemId || r.itemId) === item) });
};

const auth = require('../api/shared/auth');
auth.requireArea = async () => ({ user: { email: 'fulano@biomedical.com.br' }, validated: true });
const fn = require('../api/pedido-lotes/index.js');

async function chama(codigos) {
  const ctx = {};
  await fn(ctx, { method: 'POST', headers: {}, body: { codigos } });
  return ctx.res.body;
}
const L = (o) => Object.assign({ dataAreaId: 'msb', InventLocationId: 'ALMOX-PA', ItemId: 'P1', InventBatchId: '', wMSLocationId: '', PhysicalInvent: 0, ReservPhysical: 0 }, o);
const em = (dias) => new Date(Date.now() + dias * 86400000).toISOString();

(async () => {
  console.log('1) a conta do lote');
  CEN = {
    BioInventSums: [
      // LOTE-A: físico 5 + 3 em PA. (minúscula conta), 10 fora de PA., reserva 2 sem localização, reserva 1 COM localização
      L({ InventBatchId: 'LOTE-A', wMSLocationId: 'PA.01.01', PhysicalInvent: 5 }),
      L({ InventBatchId: 'LOTE-A', wMSLocationId: 'pa.02.03', PhysicalInvent: 3 }),
      L({ InventBatchId: 'LOTE-A', wMSLocationId: 'RECEB', PhysicalInvent: 10 }),
      L({ InventBatchId: 'LOTE-A', wMSLocationId: 'PA.01.01', ReservPhysical: 1 }),
      L({ InventBatchId: 'LOTE-A', wMSLocationId: '', PhysicalInvent: -2, ReservPhysical: 2 }),
      // LOTE-B: o caso de 05/11 — 1 em PA., 1 reservado sem localização = 0
      L({ InventBatchId: 'LOTE-B', wMSLocationId: 'PA.03', PhysicalInvent: 1 }),
      L({ InventBatchId: 'LOTE-B', wMSLocationId: '', ReservPhysical: 1 }),
      // LOTE-C: reserva sem físico em PA. (o físico está fora) = −2, não come o total
      L({ InventBatchId: 'LOTE-C', wMSLocationId: 'EXPED', PhysicalInvent: 2 }),
      L({ InventBatchId: 'LOTE-C', wMSLocationId: '', ReservPhysical: 2 }),
      // LOTE-D: vence antes do A (FEFO)
      L({ InventBatchId: 'LOTE-D', wMSLocationId: 'PA.09', PhysicalInvent: 4 }),
    ],
    BioInventItemBatchV3: [
      { dataAreaId: 'msb', itemId: 'P1', inventBatchId: 'LOTE-A', expDate: em(400) },
      { dataAreaId: 'msb', itemId: 'P1', inventBatchId: 'LOTE-D', expDate: em(60) },
    ],
  };
  filtros.length = 0;
  let r = await chama(['P1']);
  const p1 = r.itens.P1;
  const lote = (b) => p1.lotes.find(l => l.batch === b);
  t('LOTE-A = 5 + 3 (PA.) − 2 (reserva sem localização) = 6', lote('LOTE-A') && lote('LOTE-A').disponivel === 6, lote('LOTE-A'));
  t('LOTE-A mostra físico 8 e reserva 2', lote('LOTE-A') && lote('LOTE-A').fisico === 8 && lote('LOTE-A').reserva === 2, lote('LOTE-A'));
  t('LOTE-B (1 − 1 = 0) fora da lista', !lote('LOTE-B'), p1.lotes);
  t('LOTE-C (0 − 2) fora da lista', !lote('LOTE-C'), p1.lotes);
  t('total = 6 + 4 = 10 (o −2 do LOTE-C não desconta)', p1.disponivel === 10, p1.disponivel);
  t('FEFO: LOTE-D (60 d) antes do LOTE-A (400 d)', p1.lotes.map(l => l.batch).join(',') === 'LOTE-D,LOTE-A', p1.lotes.map(l => l.batch));
  const fs = filtros.find(x => x.ent === 'BioInventSums');
  t('filtro: msb, ALMOX-PA, PhysicalInvent ou ReservPhysical',
    fs && /dataAreaId eq 'msb'/.test(fs.f) && /InventLocationId eq 'ALMOX-PA'/.test(fs.f) && /\(PhysicalInvent ne 0 or ReservPhysical ne 0\)/.test(fs.f), fs);
  t('resposta diz localizações PA.*', r.localizacao === 'PA.*' && r.deposito === 'ALMOX-PA', { localizacao: r.localizacao, deposito: r.deposito });

  console.log('2) produto só com reserva / sem nada');
  CEN.BioInventSums = [L({ ItemId: 'P2', InventBatchId: 'X', wMSLocationId: '', ReservPhysical: 3 })];
  r = await chama(['P2', 'P3']);
  t('P2 só reserva: disponível 0, sem lotes', r.itens.P2.disponivel === 0 && r.itens.P2.lotes.length === 0, r.itens.P2);
  t('P3 sem linhas: disponível 0, sem lotes', r.itens.P3.disponivel === 0 && r.itens.P3.lotes.length === 0, r.itens.P3);

  console.log('3) tabela sem a Localização');
  CEN.BioInventSums = [{ dataAreaId: 'msb', InventLocationId: 'ALMOX-PA', ItemId: 'P4', InventBatchId: 'Y', PhysicalInvent: 5, ReservPhysical: 0 }];
  r = await chama(['P4']);
  t('vira erro do item e aviso para a tela', r.itens.P4.disponivel === null && /Localiza/.test(r.itens.P4.erro || '') && /Localiza/.test(r.aviso || ''), r);

  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
