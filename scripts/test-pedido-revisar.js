// ================================================================
// scripts/test-pedido-revisar.js — o código que QUEBROU em duas linhas
// (api/shared/pedido-revisar.js, juntarCodigosQuebrados) — 11/11/2026.
//
//   node scripts/test-pedido-revisar.js
//
// A tabela é a da OC 0003511 (Endotech) como o pi-pdf-texto.js entrega à
// IA: a coluna "Codigo Material" é estreita e o código continua na linha de
// baixo (UFGH-035 / 150RHS, USDJ-472 / 6). Cobre também o que NÃO pode
// juntar: continuação da descrição, item novo sem coluna de nº, código que
// a IA já devolveu inteiro, a 2ª linha com quantidade e o mesmo código duas vezes.
// ================================================================
'use strict';
const R = require('../api/shared/pedido-revisar');

let falhas = 0;
function t(nome, ok, extra) { console.log((ok ? '  ok  ' : '  FALHOU ') + nome + (ok || extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); if (!ok) falhas++; }

const OC3511 = [
  ' Seq    Codigo                       Descrição                       Un.       Qtde.        Pr. Unit.     Pr. Total       IPI     Pr. Entrega              Centro de Custo',
  '        Material',
  '    1 55011       BAINHA INTRODUTORA URETERAL MSB                    UN            15,00      360,00000     5.400,00       0,00%        18/11/26 8.001.008 UROLOGIA',
  '                  10.7FRX35CM DILATADOR 40CM',
  '                                                                     UN            15,00      360,00000',
  '    2 55012       BAINHA INTRODUTORA URETERAL MSB                    UN            25,00      360,00000     9.000,00       0,00%        18/11/26 8.001.008 UROLOGIA',
  '                  10.7FRX45CM DILATADOR 50CM',
  '                                                                     UN            25,00      360,00000',
  '    3 UFGH-035    FIO GUIA MSB HYDRO 0.035"X150CM RETO               UN            70,00       65,00000     4.550,00       0,00%        18/11/26 8.001.008 UROLOGIA',
  '      150RHS      HIDROFILICO STANDARD',
  '                                                                     UN            70,00       65,00000',
  '    4 USDJ-472    SONDA URETERAL DUPLO J 4.7X26                      UN            10,00       55,00000       550,00       0,00%        18/11/26 8.001.008 UROLOGIA',
  '      6',
  '                                                                     UN            10,00       55,00000',
  '    5 USDJ-602    SONDA URETERAL MSB DUPLO J 6.0X26                  UN            20,00       55,00000     1.100,00       0,00%        18/11/26 8.001.008 UROLOGIA',
  '      6',
  '                                                                     UN            20,00       55,00000',
].join('\n');

const P = (codigo, descricao, quantidade, valorUnitario, valorTotal) => ({ codigo, descricao, quantidade, valorUnitario, valorTotal });

console.log('1) OC 0003511 — a IA devolveu o código pela metade');
let r = R.revisar([
  P('55011', 'BAINHA INTRODUTORA URETERAL MSB 10.7FRX35CM DILATADOR 40CM', 15, 360, 5400),
  P('55012', 'BAINHA INTRODUTORA URETERAL MSB 10.7FRX45CM DILATADOR 50CM', 25, 360, 9000),
  P('UFGH-035', 'FIO GUIA MSB HYDRO 0.035"X150CM RETO HIDROFILICO STANDARD', 70, 65, 4550),
  P('USDJ-472', 'SONDA URETERAL DUPLO J 4.7X26', 10, 55, 550),
  P('USDJ-602', 'SONDA URETERAL MSB DUPLO J 6.0X26', 20, 55, 1100),
], OC3511);
const cods = r.produtos.map(p => p.codigo);
t('55011 e 55012 ficam (embaixo é a descrição)', cods[0] === '55011' && cods[1] === '55012', cods);
t('UFGH-035 + 150RHS = UFGH-035150RHS', cods[2] === 'UFGH-035150RHS', cods);
t('USDJ-472 + 6 = USDJ-4726', cods[3] === 'USDJ-4726', cods);
t('USDJ-602 + 6 = USDJ-6026', cods[4] === 'USDJ-6026', cods);
const av = r.avisos.filter(a => a.tipo === 'codigo-quebrado');
t('3 avisos "codigo-quebrado", corrigidos, nos itens 2, 3 e 4', av.length === 3 && av.every(a => a.corrigido) && av.map(a => a.item).join() === '2,3,4', r.avisos);
t('quantidade e valor intactos', r.produtos[2].quantidade === 70 && r.produtos[2].valorUnitario === 65, r.produtos[2]);

console.log('2) a IA já devolveu inteiro: não mexe');
r = R.revisar([P('UFGH-035150RHS', 'FIO GUIA MSB HYDRO', 70, 65, 4550), P('USDJ-4726', 'SONDA URETERAL DUPLO J 4.7X26', 10, 55, 550)], OC3511);
t('códigos inteiros ficam', r.produtos[0].codigo === 'UFGH-035150RHS' && r.produtos[1].codigo === 'USDJ-4726', r.produtos.map(p => p.codigo));
t('sem aviso', !r.avisos.some(a => a.tipo === 'codigo-quebrado'), r.avisos);

console.log('3) tabela sem coluna de nº: o item de baixo NÃO é continuação');
const SEM_SEQ = [
  'Codigo     Descricao                         Qtde     Unit      Total',
  'ABC-123    CATETER X                         10,00    5,00      50,00',
  'XYZ-456    CATETER Y                          2,00    7,00      14,00',
].join('\n');
r = R.revisar([P('ABC-123', 'CATETER X', 10, 5, 50), P('XYZ-456', 'CATETER Y', 2, 7, 14)], SEM_SEQ);
t('ABC-123 e XYZ-456 ficam separados', r.produtos[0].codigo === 'ABC-123' && r.produtos[1].codigo === 'XYZ-456', r.produtos.map(p => p.codigo));

const SEM_SEQ_INT = [
  'Codigo     Descricao                         Qtde     Unit      Total',
  'ABC-123    CATETER X                         10       5         50',
  'XYZ-456    CATETER Y                          2       7         14',
].join('\n');
r = R.revisar([P('ABC-123', 'CATETER X', 10, 5, 50), P('XYZ-456', 'CATETER Y', 2, 7, 14)], SEM_SEQ_INT);
t('idem com quantidade e valor sem vírgula', r.produtos[0].codigo === 'ABC-123' && r.produtos[1].codigo === 'XYZ-456', r.produtos.map(p => p.codigo));

console.log('4) linha de baixo com quantidade/valor: não junta');
const COM_NUM = [
  '  1 AB-10     LUVA                    UN   10,00   2,00   20,00',
  '    CX        caixa com 100           UN    1,00  20,00   20,00',
].join('\n');
r = R.revisar([P('AB-10', 'LUVA', 10, 2, 20)], COM_NUM);
t('AB-10 fica', r.produtos[0].codigo === 'AB-10', r.produtos[0].codigo);

console.log('5) o mesmo código pela metade em dois itens');
const DOIS = [
  '  1 USDJ-472    SONDA DUPLO J 4.7X26     UN   10,00   55,00   550,00',
  '    6',
  '  2 USDJ-472    SONDA DUPLO J 4.7X28     UN    5,00   55,00   275,00',
  '    8',
].join('\n');
r = R.revisar([P('USDJ-472', 'SONDA DUPLO J 4.7X26', 10, 55, 550), P('USDJ-472', 'SONDA DUPLO J 4.7X28', 5, 55, 275)], DOIS);
t('1º vira USDJ-4726 e 2º USDJ-4728', r.produtos[0].codigo === 'USDJ-4726' && r.produtos[1].codigo === 'USDJ-4728', r.produtos.map(p => p.codigo));

console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
