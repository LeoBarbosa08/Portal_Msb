// ================================================================
// api/shared/pedido-revisar.js
// Confere, CONTRA O TEXTO DO PDF, o que a IA devolveu em cada item —
// e conserta a troca de QUANTIDADE por VALOR UNITÁRIO.
//
// Por que não dá para confiar só na IA: o texto do PDF chega em
// colunas ("Qtd Compr. | Vl.Unit. | ... | Vl Total") e, quando o
// layout está apertado, o modelo troca as duas. A trava óbvia —
// quantidade x unitário = total — NÃO pega a inversão, porque a
// multiplicação é comutativa (10 x 720 = 720 x 10 = 7.200). O que
// PEGA é a POSIÇÃO: no papel, a coluna de quantidade vem antes da de
// valor unitário, e o pi-pdf-texto.js entrega a linha na ordem
// visual. Então:
//
//   cabeçalho diz  qtd ... unit   (nessa ordem)
//   linha do item  10,0000  720,0000  ...  7.200,00
//   IA devolveu    quantidade=720  valorUnitario=10
//   -> o número que ela chamou de quantidade está na coluna do
//      unitário: TROCA (e avisa).
//
// Só age com as duas âncoras na mão (cabeçalho + os dois números na
// mesma linha, sem ambiguidade). Em qualquer dúvida, não mexe: apenas
// devolve um aviso para a tela pedir conferência humana.
//
// Antes disso, tira do campo CÓDIGO o RMS (registro ANVISA) que a IA
// tenha posto lá — ver conferirCodigos(), mais abaixo (04/11/2026).
//
//   const { revisar } = require('../shared/pedido-revisar');
//   const r = revisar(dados.produtos, textoDoPdf, { codigosConhecidos });
//   // r.produtos (corrigidos) · r.avisos [{ item, tipo, texto }]
// ================================================================
'use strict';

// ── números no formato do documento ──────────────────────────────
// "7.200,00" -> 7200   "1,9100" -> 1.91   "720" -> 720   "7.200" -> 7200
function paraNumero(txt) {
  var s = String(txt).trim();
  if (!s) return NaN;
  if (s.indexOf(',') >= 0) {                       // tem vírgula: ela é o decimal
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {    // 7.200 / 1.234.567 = milhar
    s = s.replace(/\./g, '');
  }
  var n = Number(s);
  return isFinite(n) ? n : NaN;
}

var RE_NUM = /-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+,\d+|-?\d+(?:\.\d+)?/g;

// todos os números de uma linha, com onde cada um começa
function numerosDaLinha(linha) {
  var out = [];
  var m;
  RE_NUM.lastIndex = 0;
  while ((m = RE_NUM.exec(linha)) !== null) {
    var v = paraNumero(m[0]);
    if (!isNaN(v)) out.push({ txt: m[0], valor: v, pos: m.index });
  }
  return out;
}

// ── rótulos de coluna ────────────────────────────────────────────
// "Qtd Compr.", "Qtde", "Quant.", "Qt. Cons.", "QTD"
var RE_CAB_QTD  = /\b(?:qtd|qtde|qte|qty|quant|quantidade|qt)\b\.?/gi;
// "Vl.Unit.", "Valor Unitário", "Preço Unit.", "Vlr Unit", "Unitário"
var RE_CAB_UNIT = /\b(?:vl|vlr|v|valor|pre[çc]o|prc)\b\.?\s*unit\w*|\bunit[áa]rio\b/gi;

/* Acha, no texto todo, a linha de CABEÇALHO da tabela de itens e diz
   se a coluna de quantidade vem antes da de valor unitário.
   -> { qtdAntes: bool, colQtd, colUnit, linha } ou null */
function cabecalhoDaTabela(texto) {
  var linhas = String(texto || '').split(/\r?\n/);
  for (var i = 0; i < linhas.length; i++) {
    var L = linhas[i];
    RE_CAB_UNIT.lastIndex = 0;
    var mu = RE_CAB_UNIT.exec(L);
    if (!mu) continue;

    // o rótulo de quantidade que interessa é o ÚLTIMO antes do unitário
    // (num "Qt. Cons. ... Qtd Compr. ... Vl.Unit." é o "Qtd Compr.")
    RE_CAB_QTD.lastIndex = 0;
    var mq, ultimoAntes = null, algumDepois = null;
    while ((mq = RE_CAB_QTD.exec(L)) !== null) {
      if (mq.index < mu.index) ultimoAntes = mq.index;
      else if (algumDepois === null) algumDepois = mq.index;
    }
    if (ultimoAntes === null && algumDepois === null) continue;

    return {
      qtdAntes: ultimoAntes !== null,
      colQtd: ultimoAntes !== null ? ultimoAntes : algumDepois,
      colUnit: mu.index,
      linha: L
    };
  }
  return null;
}

// ── achar a linha do item no texto ───────────────────────────────
function normaliza(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

/* Procura a linha que corresponde ao item.

   Não basta achar o código: quando a descrição quebra em várias linhas
   (é o normal em OC de hospital), o código costuma cair numa linha SEM
   número nenhum —

     Outros Cateter Eletrodo Temporario 6FR x MSB 2 Pc 1,00 700,00 0,0 1.400,00
            110cm/125cm (Cabo eletrodo) Ref.
            VCET-6110CK1 (NEUROMEDEX)          <- o código está AQUI

   — e ancorar nela é o mesmo que não achar nada. Então a busca é por
   PONTOS: quem tem o código, as palavras da descrição e o total do item
   pontua, e só entram no páreo linhas com pelo menos dois números (a
   linha do item sempre tem quantidade e valor). */
function linhaDoItem(linhas, prod) {
  var cod = normaliza(prod.codigo);
  var palavras = normaliza(prod.descricao).split(' ')
    .filter(function (p) { return p.length >= 4; }).slice(0, 4);
  var total = Number(prod.valorTotal);

  var melhor = '', melhorPonto = 0;
  for (var i = 0; i < linhas.length; i++) {
    var linha = linhas[i];
    var nums = numerosDaLinha(linha);
    if (nums.length < 2) continue;                 // linha de texto solto

    var n = normaliza(linha);
    var ponto = 0;
    if (cod && cod.length >= 4 && n.indexOf(cod) >= 0) ponto += 3;
    for (var p = 0; p < palavras.length; p++) {
      if (n.indexOf(palavras[p]) >= 0) ponto += 1;
    }
    if (!ponto) continue;                          // nada a ver com este item
    if (isFinite(total) && total > 0 &&
        nums.some(function (x) { return mesmoNumero(x.valor, total); })) ponto += 2;
    if (nums.length >= 3) ponto += 1;              // cara de linha de tabela

    if (ponto > melhorPonto) { melhorPonto = ponto; melhor = linha; }
  }
  return melhor;
}

// quase-igualdade tolerante (o texto pode ter 2 ou 4 decimais)
function mesmoNumero(a, b) {
  if (!isFinite(a) || !isFinite(b)) return false;
  var d = Math.abs(a - b);
  return d < 0.005 || d / Math.max(Math.abs(a), Math.abs(b), 1) < 0.0005;
}

var PERTO = 25;   // colunas de tolerância para dizer "está nessa coluna"

/* Ocorrências de um valor numa linha. Quando há mais de uma, só resolve o
   empate se uma delas estiver perto da coluna esperada (do cabeçalho) —
   fora disso devolve null, e quem chamou não mexe em nada. */
function acharValor(nums, valor, colEsperada) {
  var hits = nums.filter(function (n) { return mesmoNumero(n.valor, valor); });
  if (!hits.length) return null;
  if (hits.length === 1) return hits[0];
  if (typeof colEsperada !== 'number') return null;
  var maisPerto = hits.slice().sort(function (a, b) {
    return Math.abs(a.pos - colEsperada) - Math.abs(b.pos - colEsperada);
  })[0];
  return Math.abs(maisPerto.pos - colEsperada) <= PERTO ? maisPerto : null;
}

// ================================================================
// O RMS NO LUGAR DO CÓDIGO (conserto de 04/11/2026)
//
// A proposta da própria Biomedical — a que o portal (Cotações) e o
// Salesforce geram e o cliente devolve como pedido — traz, na mesma
// linha do item, o CÓDIGO DO PRODUTO e o RMS, o registro do produto na
// ANVISA (11 dígitos). Do jeito que o pi-pdf-texto.js entrega:
//
//    Código do                                             Valor de
//              Produto.      Fabricante  RMS          Quantidade      Subtotal
//    produto                                               Venda
//              FIO GUIA T MSB 0.035"X150CM, J3MM,                        R$
//    51200                   MSB         80454419010     50  R$ 30,00
//              TEFLONADO                                            1.500,00
//
// e a IA devolvia codigo "80454419010". RMS nunca é código: ele se
// REPETE em produtos diferentes (o 80454419011 vale para três fios-guia
// na proposta do HOSP. BOM JESUS) e não existe na base de produtos.
//
// O conserto é pela POSIÇÃO, como o da quantidade: o cabeçalho diz onde
// ficam as colunas de código e de RMS; a linha do item é a que tem
// aquele RMS na coluna do RMS (quando ele se repete, a que tem também a
// quantidade e o preço daquele item); o código é o que está debaixo de
// "Código" nessa linha. Sem coluna de código, ou na dúvida, o código
// fica VAZIO e a tela pede — o RMS no campo do código nunca é melhor do
// que o campo vazio. O número vai para `registroAnvisa`.
//
// Só age com evidência de que o "código" é um RMS: 11 dígitos começando
// por 1 ou 8 (o formato do registro de produto para saúde) que aparecem
// num documento que fala em RMS / ANVISA / Registro MS — ou a própria
// IA ter posto o mesmo número em registroAnvisa. Código de 11 dígitos
// num documento sem nada disso fica como está.
// ================================================================

// "RMS", "R.M.S.", "ANVISA", "Reg. MS", "Registro M.S.", "Registro no Ministério da Saúde"
var RE_ROT_RMS = /\bR\.?M\.?S\.?(?![A-Za-z0-9])|\bANVISA\b|\bREG(?:ISTRO)?\.?\s*(?:N[º°O]?\.?\s*)?(?:NO\s+|DO\s+)?M\.?\s?S\.?(?![A-Za-z0-9])|MINIST[ÉE]RIO\s+DA\s+SA[ÚU]DE/i;
// "Código", "Cód.", "Cod", "Ref.", "Referência"
var RE_ROT_COD = /\bC[ÓO]D(?:IGO|\.)?(?![A-Za-z])|\bREF(?:ER[ÊE]NCIA|\.)?(?![A-Za-z])/gi;
// código de OUTRO cadastro (do cliente, de barras, fiscal…): não é o da Biomedical
var RE_COD_ALHEIO = /CLI|HOSP|COMPRAD|INTEGR|PACIENT|BARRA|EAN|NCM|TUSS|SIMPRO|BRAS[IÍ]NDICE/;
// as outras colunas de uma tabela de itens — é o que diz que a linha do
// rótulo "RMS" é um CABEÇALHO, e não um "RMS" solto num texto
var RE_ROT_TABELA = [
  /\b(?:QTD|QTDE|QTE|QUANT|QUANTIDADE|QT)\b/i,
  /\b(?:VL|VLR|VALOR|PRE[ÇC]O|UNIT[ÁA]RIO|TOTAL|SUBTOTAL)\b/i,
  /\b(?:PRODUTO|DESCRI[ÇC][ÃA]O|MATERIAL|ITEM)\b/i,
  /\b(?:FABRICANTE|MARCA)\b/i
];

function soDigitos(s) { return String(s == null ? '' : s).replace(/\D+/g, ''); }

/* O registro que está em `codigo`, se `codigo` for um RMS ("80454419010",
   "8045441-9010", "RMS 80454419010") — senão ''. */
function rmsDoCodigo(codigo) {
  var s = String(codigo == null ? '' : codigo).trim()
    .replace(/^(?:R\.?M\.?S\.?|ANVISA|REG(?:ISTRO)?\.?\s*(?:ANVISA|M\.?\s?S\.?)?)\s*[:#\-]?\s*/i, '');
  if (!s || !/^[\d.\-\/ ]+$/.test(s)) return '';
  var d = soDigitos(s);
  return /^[18]\d{10}$/.test(d) ? d : '';
}

// as palavras de uma linha com onde cada uma começa e termina
function pedacos(L) {
  var out = [], m, re = /\S+/g;
  while ((m = re.exec(L)) !== null) out.push({ txt: m[0], ini: m.index, fim: m.index + m[0].length });
  return out;
}
function sobrepoe(a, b, folga) {
  folga = folga || 0;
  return a.ini < b.fim + folga && b.ini < a.fim + folga;
}
// o rótulo vai até o primeiro vão de 2+ espaços ("Código do   Produto.")
function vaoDoRotulo(L, ini) {
  var g = /^\S+(?: \S+)*/.exec(L.slice(ini));
  return { ini: ini, fim: ini + Math.min(g ? g[0].length : 1, 18) };
}

/* Cara de código de produto: letras/números/traço/ponto/barra, com pelo
   menos um dígito — e não é dinheiro ("30,00"), nem outro RMS. */
function caraDeCodigo(t) {
  var s = String(t || '');
  if (s.length < 2 || s.length > 40) return '';
  if (!/^[A-Za-z0-9][A-Za-z0-9.\-\/_]*$/.test(s) || !/\d/.test(s)) return '';
  if (/^\d{1,3}(?:\.\d{3})*,\d+$|^\d+,\d+$/.test(s)) return '';
  if (rmsDoCodigo(s)) return '';
  return s;
}

/* As linhas de CABEÇALHO que têm a coluna do RMS, com a posição dela e a
   da coluna do código: [{ linha, rms: {ini,fim}, cod: {ini,fim}|null }].
   O rótulo do código pode estar QUEBRADO em duas linhas ("Código do" em
   cima, "produto" embaixo, os outros rótulos no meio) — por isso ele é
   procurado também nas duas linhas de cima e de baixo, pela posição: o
   pi-pdf-texto.js mantém a coluna de uma linha para a outra. */
function cabecalhosDoRms(linhas) {
  var out = [];
  for (var i = 0; i < linhas.length; i++) {
    var L = linhas[i];
    var m = RE_ROT_RMS.exec(L);
    if (!m) continue;
    if (/\d{6,}/.test(L)) continue;               // com registro/CNPJ na linha, não é cabeçalho
    var bloco = [linhas[i - 1] || '', L, linhas[i + 1] || ''].join('   ');
    if (RE_ROT_TABELA.filter(function (re) { return re.test(bloco); }).length < 2) continue;

    var cod = null, prioridade = 9;
    for (var k = Math.max(0, i - 2); k <= Math.min(linhas.length - 1, i + 2); k++) {
      var Lk = linhas[k], mc;
      RE_ROT_COD.lastIndex = 0;
      while ((mc = RE_ROT_COD.exec(Lk)) !== null) {
        var rot = Lk.slice(mc.index, mc.index + 28).toUpperCase();
        if (RE_COD_ALHEIO.test(rot)) continue;
        // "Cód. Fornecedor" é o código da Biomedical (a fornecedora); "Ref." só na falta de outro
        var p = /FORN/.test(rot) ? 0 : /^REF/.test(rot) ? 2 : 1;
        if (p < prioridade) { prioridade = p; cod = vaoDoRotulo(Lk, mc.index); }
      }
    }
    out.push({ linha: i, rms: vaoDoRotulo(L, m.index), cod: cod });
  }
  return out;
}

/* Acha o código do item cujo "codigo" a IA leu do RMS -> { codigo, linha }
   ou null. `usadas` = linhas de item já dadas a itens anteriores (o mesmo
   RMS em vários itens: cada linha serve um item só). */
function codigoPeloRms(linhas, cabs, prod, rms, usadas) {
  function cabDe(i) {                             // o cabeçalho que vale para a linha: o último acima dela
    var c = null;
    for (var k = 0; k < cabs.length; k++) if (cabs[k].linha < i) c = cabs[k];
    return c;
  }
  function rmsNaColuna(L, cab) {                  // as palavras da linha que estão na coluna do RMS
    return pedacos(L).filter(function (p) {
      return /^[\d.\-\/]+$/.test(p.txt) && rmsDoCodigo(p.txt) && sobrepoe(p, cab.rms, 2);
    });
  }

  var cands = [];
  for (var i = 0; i < linhas.length; i++) {
    var cab = cabDe(i);
    if (!cab || !cab.cod) continue;
    var noRms = rmsNaColuna(linhas[i], cab).filter(function (p) { return soDigitos(p.txt) === rms; });
    if (noRms.length) cands.push({ i: i, cab: cab, rmsPos: noRms[0] });
  }
  if (!cands.length) return null;

  // RMS repetido: ganha a linha com a quantidade, o preço e as palavras do item
  var q = Number(prod.quantidade), v = Number(prod.valorUnitario);
  var palavras = normaliza(prod.descricao).split(' ')
    .filter(function (p, k, a) { return p.length >= 2 && a.indexOf(p) === k; });
  function temPalavras(L) {
    var n = ' ' + normaliza(L) + ' ';
    return palavras.filter(function (p) { return n.indexOf(' ' + p + ' ') >= 0; }).length;
  }
  cands.forEach(function (cd) {
    var nums = numerosDaLinha(linhas[cd.i]).filter(function (x) {
      return !(x.pos >= cd.rmsPos.ini && x.pos < cd.rmsPos.fim);
    });
    var pts = 0;
    if (q > 0 && nums.some(function (x) { return mesmoNumero(x.valor, q); })) pts += 3;
    if (v > 0 && nums.some(function (x) { return mesmoNumero(x.valor, v); })) pts += 3;
    pts += 2 * temPalavras(linhas[cd.i]);
    pts += temPalavras(linhas[cd.i - 1] || '') + temPalavras(linhas[cd.i + 1] || '');
    cd.pts = pts;
  });
  // empate: a linha ainda livre, e depois a ordem do documento
  cands.sort(function (a, b) {
    return (b.pts - a.pts) || ((usadas[a.i] ? 1 : 0) - (usadas[b.i] ? 1 : 0)) || (a.i - b.i);
  });
  var melhor = cands[0];

  function codigoNaLinha(k) {
    var ps = pedacos(linhas[k] || '').filter(function (p) { return sobrepoe(p, melhor.cab.cod, 1); });
    return ps.length ? caraDeCodigo(ps[0].txt) : '';
  }
  var cod = codigoNaLinha(melhor.i);
  // a célula do código quebrou: tenta as linhas vizinhas, se não forem de outro item
  [melhor.i - 1, melhor.i + 1].forEach(function (k) {
    if (cod || k < 0 || k >= linhas.length) return;
    if (rmsNaColuna(linhas[k], melhor.cab).length) return;
    cod = codigoNaLinha(k);
  });
  if (!cod || soDigitos(cod) === rms) return null;
  return { codigo: cod, linha: melhor.i };
}

/* conferirCodigos(produtos, linhas, texto, opts) -> { produtos, avisos }
   O RMS que a IA pôs em `codigo` sai de lá: vira o código da coluna de
   código daquela linha (corrigido, com aviso) ou fica vazio (aviso pedindo
   o código). opts.codigosConhecidos (perfil cotação: os códigos do PDF que
   existem no cadastro) — quando vem, o código achado tem de estar nela. */
function conferirCodigos(lista, linhas, texto, opts) {
  var avisos = [];
  var doc = String(texto || '');
  var falaDeRms = RE_ROT_RMS.test(doc);
  var conhecidos = (opts && Array.isArray(opts.codigosConhecidos) ? opts.codigosConhecidos : [])
    .map(function (c) { return normaliza(c); }).filter(Boolean);
  var cabs = null;                                // só monta se algum item precisar
  var usadas = {};

  var out = lista.map(function (p, idx) {
    var prod = Object.assign({}, p);
    var rms = rmsDoCodigo(prod.codigo);
    if (!rms) return prod;
    var daIa = soDigitos(prod.registroAnvisa) === rms;
    var noTexto = new RegExp('(?:^|\\D)' + rms + '(?!\\d)').test(doc);
    if (!(daIa || (falaDeRms && noTexto))) return prod;    // sem evidência: não mexe

    if (cabs === null) cabs = cabecalhosDoRms(linhas);
    var achado = cabs.length ? codigoPeloRms(linhas, cabs, prod, rms, usadas) : null;
    if (achado) {
      var n = normaliza(achado.codigo);
      if (prod.codigoCliente && normaliza(prod.codigoCliente) === n) achado = null;   // é o do comprador
      else if (conhecidos.length && conhecidos.indexOf(n) < 0) achado = null;         // fora do cadastro
    }

    prod.registroAnvisa = rms;
    if (achado) {
      usadas[achado.linha] = true;
      prod.codigo = achado.codigo;
      avisos.push({ item: idx, tipo: 'rms-codigo', corrigido: true,
        texto: achado.codigo + ': o código tinha vindo como ' + rms + ', que é o RMS (registro ANVISA) — ' +
               'corrigi para o código do produto que está no PDF. Confira.' });
    } else {
      var d = String(prod.descricao || '').trim();
      var quem = d ? (d.length > 45 ? d.slice(0, 44) + '…' : d) : 'item ' + (idx + 1);
      prod.codigo = '';
      avisos.push({ item: idx, tipo: 'rms-codigo', corrigido: false,
        texto: quem + ': ' + rms + ' é o RMS (registro ANVISA), não o código do produto — informe o código Biomedical.' });
    }
    return prod;
  });
  return { produtos: out, avisos: avisos };
}

// ── O CÓDIGO QUE QUEBROU EM DUAS LINHAS (11/11/2026) ──────────────
// Coluna de código estreita: o código não cabe e continua na linha de
// baixo, na MESMA coluna (OC 0003511 da Endotech) —
//
//     3 UFGH-035    FIO GUIA MSB HYDRO 0.035"X150CM RETO     UN   70,00 …
//       150RHS      HIDROFILICO STANDARD
//     4 USDJ-472    SONDA URETERAL DUPLO J 4.7X26            UN   10,00 …
//       6
//
// — e a IA devolvia só o pedaço de cima ("UFGH-035", "USDJ-472"). Junta,
// sem espaço, quando TUDO isto vale:
//   . o código da IA está numa linha de item (2+ números), como palavra;
//   . a linha de baixo só tem espaço ANTES da coluna do código (não é um
//     item novo, que teria o nº do item ou o próprio código ali) e começa,
//     nessa coluna (±1), um pedaço com cara de código;
//   . o pedaço termina antes da coluna seguinte (a da descrição) e a linha
//     de baixo não tem quantidade nem valor (número com vírgula/ponto, ou
//     dois números ou mais depois do pedaço).
// Código que a IA já devolveu inteiro não casa como palavra: não mexe.
function posPalavra(linha, cod) {
  var L = linha.toUpperCase(), c = cod.toUpperCase(), de = 0, i;
  while ((i = L.indexOf(c, de)) >= 0) {
    var antes = i === 0 ? ' ' : L.charAt(i - 1), depois = L.charAt(i + c.length) || ' ';
    if (/\s/.test(antes) && /\s/.test(depois)) return i;
    de = i + 1;
  }
  return -1;
}
var RE_PEDACO_COD = /^[A-Za-z0-9][A-Za-z0-9.\-\/_]{0,14}$/;
var RE_NUM_DECIMAL = /\d[.,]\d/;
function juntarCodigosQuebrados(lista, linhas) {
  var avisos = [], usadas = {};
  var out = lista.map(function (p, idx) {
    var prod = Object.assign({}, p);
    var cod = String(prod.codigo || '').trim();
    if (cod.length < 3 || /\s/.test(cod)) return prod;
    for (var i = 0; i < linhas.length - 1; i++) {
      if (usadas[i]) continue;
      var L = linhas[i], col = posPalavra(L, cod);
      if (col < 0 || numerosDaLinha(L).length < 2) continue;
      var resto = L.slice(col + cod.length).search(/\S/);
      var limite = resto < 0 ? Infinity : col + cod.length + resto;   // onde começa a coluna seguinte
      var B = linhas[i + 1] || '';
      var ini = -1;
      for (var s = Math.max(0, col - 1); s <= col + 1; s++) {
        if (B.charAt(s) && /\S/.test(B.charAt(s)) && !B.slice(0, s).trim()) { ini = s; break; }
      }
      if (ini < 0) continue;
      var pedaco = (/^\S+/.exec(B.slice(ini)) || [''])[0];
      var depois = B.slice(ini + pedaco.length);
      if (!RE_PEDACO_COD.test(pedaco) || ini + pedaco.length > limite) continue;
      if (RE_NUM_DECIMAL.test(depois) || numerosDaLinha(depois).length >= 2) continue;   // linha de baixo é item (qtd/valor)
      usadas[i] = true;
      prod.codigo = cod + pedaco;
      avisos.push({ item: idx, tipo: 'codigo-quebrado', corrigido: true,
        texto: prod.codigo + ': o código estava quebrado em duas linhas no PDF (' + cod + ' + ' + pedaco + ') — juntei. Confira.' });
      break;
    }
    return prod;
  });
  return { produtos: out, avisos: avisos };
}

// ================================================================
// revisar(produtos, texto, opts) -> { produtos, avisos }
// ================================================================
function revisar(produtos, texto, opts) {
  var lista = Array.isArray(produtos) ? produtos : [];
  var avisos = [];
  if (!lista.length) return { produtos: lista, avisos: avisos };

  var linhas = String(texto || '').split(/\r?\n/);

  // ── 0. o RMS (registro ANVISA) que a IA pôs no lugar do código ──
  // (antes de tudo: as conferências abaixo acham a linha do item pelo código)
  try {
    var cc = conferirCodigos(lista, linhas, texto, opts);
    lista = cc.produtos;
    avisos = cc.avisos;
  } catch (e) { /* conferir nunca derruba a leitura */ }

  var cab = cabecalhoDaTabela(texto);

  // soma dos itens como a IA os leu — serve para reconhecer o total DO
  // PEDIDO copiado por engano na linha de um item
  var somaDosItens = lista.reduce(function (t, p) {
    var a = Number(p.quantidade), b = Number(p.valorUnitario);
    return t + ((isFinite(a) ? a : 0) * (isFinite(b) ? b : 0));
  }, 0);

  var out = lista.map(function (p, idx) {
    var prod = Object.assign({}, p);
    var q = Number(prod.quantidade);
    var v = Number(prod.valorUnitario);
    var total = Number(prod.valorTotal);
    if (!isFinite(q)) q = 0;
    if (!isFinite(v)) v = 0;

    var rotulo = (prod.codigo || prod.descricao || ('item ' + (idx + 1))).toString().slice(0, 40);
    var linha = linhaDoItem(linhas, prod);
    var nums = linha ? numerosDaLinha(linha) : [];

    // ── 1. inversão de quantidade x valor unitário ───────────────
    if (cab && linha && q > 0 && v > 0 && !mesmoNumero(q, v)) {
      var alvoQtd  = cab.qtdAntes ? cab.colQtd : cab.colUnit;
      var alvoUnit = cab.qtdAntes ? cab.colUnit : cab.colQtd;
      var tQ = acharValor(nums, q, alvoQtd);
      var tV = acharValor(nums, v, alvoUnit);

      if (tQ && tV && tQ.pos !== tV.pos) {
        var qtdVemAntes = tQ.pos < tV.pos;
        if (qtdVemAntes !== cab.qtdAntes) {
          // o número que a IA chamou de quantidade está na coluna do
          // unitário (e vice-versa): troca.
          prod.quantidade = v;
          prod.valorUnitario = q;
          var tmp = q; q = v; v = tmp;
          avisos.push({
            item: idx, tipo: 'invertido', corrigido: true,
            texto: rotulo + ': quantidade e valor unitário estavam trocados no PDF — ' +
                   'corrigi para ' + prod.quantidade + ' x ' + prod.valorUnitario + '. Confira.'
          });
        }
      }
    }

    // ── 2. quantidade x unitário tem de dar o total do item ──────
    // (quando a IA copia o total DO PEDIDO na linha do item, ignora: seria
    //  um alarme falso em todo pedido de mais de um item)
    if (isFinite(total) && total > 0 && q > 0 && v > 0 && !(lista.length > 1 && mesmoNumero(total, somaDosItens))) {
      var calc = q * v;
      if (Math.abs(calc - total) > Math.max(0.05, total * 0.005)) {
        avisos.push({
          item: idx, tipo: 'total', corrigido: false,
          texto: rotulo + ': ' + q + ' x ' + v + ' = ' + calc.toFixed(2) +
                 ', mas o PDF traz total ' + total.toFixed(2) + '. Confira quantidade e valor.'
        });
      }
    }

    // ── 3. o item ficou sem um dos dois números ──────────────────
    if (q <= 0) {
      avisos.push({ item: idx, tipo: 'sem-quantidade', corrigido: false,
        texto: rotulo + ': não consegui ler a quantidade. Preencha.' });
    }
    if (v <= 0) {
      avisos.push({ item: idx, tipo: 'sem-valor', corrigido: false,
        texto: rotulo + ': não consegui ler o valor unitário. Preencha.' });
    }

    delete prod.valorTotal;      // o total é sempre recalculado na tela
    return prod;
  });

  // ── 4. o código que quebrou em duas linhas (depois das conferências
  //       acima, que acham a linha do item pelo código como a IA leu) ──
  try {
    var jq = juntarCodigosQuebrados(out, linhas);
    out = jq.produtos;
    avisos = avisos.concat(jq.avisos);
  } catch (e) { /* conferir nunca derruba a leitura */ }

  return { produtos: out, avisos: avisos };
}

module.exports = {
  revisar: revisar,
  // expostos para os testes
  paraNumero: paraNumero,
  numerosDaLinha: numerosDaLinha,
  cabecalhoDaTabela: cabecalhoDaTabela,
  linhaDoItem: linhaDoItem,
  rmsDoCodigo: rmsDoCodigo,
  cabecalhosDoRms: cabecalhosDoRms,
  conferirCodigos: conferirCodigos,
  juntarCodigosQuebrados: juntarCodigosQuebrados
};
