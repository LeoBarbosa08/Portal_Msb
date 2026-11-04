// ================================================================
// shared/cot-id.js — o NÚMERO DA COTAÇÃO no texto do PDF do portal
// (21/10/2026)
//
// O número da cotação quase sempre vem rotulado como o ID / IDENTIFICADOR
// dela ("ID: 668804034" no relatório da Bionexo), "Nº / Número / ID da
// cotação", "Cotação nº 99812" ou "Cotação: 128734552".
//   candidatos(texto) -> [{ valor, rotulo, forca }] — os rótulos achados,
//                        o mais forte (e o primeiro no texto) antes
//   escolher(lido, texto) -> { numero, aviso? } — confere o que a IA leu:
//                        vazio, ou diferente do rótulo mais forte, vira o
//                        do rótulo (com um aviso para a pessoa conferir)
// A tela (cotacoes-base.js, idDaCotacao) tem a mesma busca para quando a
// IA não responde.
// ================================================================
'use strict';

const SEP = '[ \\t:#=\\-–]*';
const VAL = '([A-Z]{0,5}[-/]?\\d[\\d./-]*\\d|\\d)';
const ROTULOS = [
  // "ID da cotação", "Identificador da cotação", "Nº / Número / Código da cotação", "Número do pedido de cotação"
  { forca: 3, rot: '(?:Identificador|Identifica[cç][aã]o|ID|N[º°o]\\.?|N[uú]mero|C[oó]digo)[ \\t]*(?:d[aeo][ \\t]+)?(?:pedido[ \\t]+de[ \\t]+)?cota[cç][aã]o' },
  // "Cotação nº 99812", "Pedido de cotação Nº: 123", "Cotação ID 123", "Cotação #123"
  { forca: 3, rot: '(?:pedido[ \\t]+de[ \\t]+)?cota[cç][aã]o[ \\t]*(?:n[º°o]\\.?|n[uú]mero|ID|#)' },
  // "ID: 668804034", "Identificador 123" — sozinho, o do cabeçalho
  { forca: 2, rot: '(?:Identificador|Identifica[cç][aã]o|ID)' },
  // "Cotação: 128734552", "Pedido de cotação 99812"
  { forca: 2, rot: '(?:pedido[ \\t]+de[ \\t]+)?cota[cç][aã]o' }
];
const RES = ROTULOS.map(function (r) { return { forca: r.forca, re: new RegExp('(?:^|[^A-Za-zÀ-ÿ])(' + r.rot + ')' + SEP + VAL, 'gim') }; });

function digitos(s) { return String(s || '').replace(/\D/g, ''); }
// o número como o caso guarda (sem pontos de milhar nem espaços)
function norm(s) { return String(s == null ? '' : s).replace(/[.\s]/g, '').trim(); }
// o que tem cara de número mas não é o da cotação: data, CNPJ, CEP
function valido(v) {
  const d = digitos(v);
  if (d.length < 3 || d.length > 20) return false;
  if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(v)) return false;
  if (/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(v)) return false;
  if (/^\d{5}-\d{3}$/.test(v)) return false;
  return true;
}

function candidatos(texto) {
  const s = String(texto || '').slice(0, 200000), achados = {};
  RES.forEach(function (r) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(s))) {
      const bruto = m[2].replace(/[-/.]+$/, '');
      if (!valido(bruto)) continue;
      const valor = norm(bruto), pos = m.index;
      const ja = achados[valor];
      if (!ja || r.forca > ja.forca || (r.forca === ja.forca && pos < ja.pos)) {
        achados[valor] = { valor: valor, rotulo: m[1].replace(/\s+/g, ' ').trim(), forca: r.forca, pos: pos };
      }
    }
  });
  return Object.keys(achados).map(function (k) { return achados[k]; })
    .sort(function (a, b) { return b.forca - a.forca || a.pos - b.pos; })
    .map(function (c) { return { valor: c.valor, rotulo: c.rotulo, forca: c.forca }; });
}

function escolher(lido, texto) {
  const ia = norm(lido), cs = candidatos(texto);
  if (!cs.length) return { numero: ia };
  const top = cs[0], doIa = cs.filter(function (c) { return c.valor === ia; })[0];
  if (doIa && doIa.forca >= top.forca) return { numero: ia };
  if (!ia) return { numero: top.valor, aviso: 'O número da cotação (' + top.valor + ') veio do "' + top.rotulo + '" do PDF — confira.' };
  return { numero: top.valor, aviso: 'Número da cotação: usei o "' + top.rotulo + '" do PDF (' + top.valor + '); a IA tinha lido ' + ia + ' — confira.' };
}

// a dica para a IA: os rótulos achados no texto
function dica(texto) {
  const cs = candidatos(texto).slice(0, 5);
  return cs.length ? 'ID DA COTAÇÃO — rótulos achados no texto (o número da cotação quase sempre é o ID / Identificador dela): ' +
    cs.map(function (c) { return '"' + c.rotulo + '" ' + c.valor; }).join(' · ') + '\n\n' : '';
}

module.exports = { candidatos, escolher, dica, norm };
