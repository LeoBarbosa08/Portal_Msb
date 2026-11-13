#!/usr/bin/env node
// ================================================================
// scripts/test-sr-dia.js — guarda da FICHA DO DIA do Sales Report
// (Comercial) · Visão Geral: o clique na barra do "Faturamento por Dia"
// (sr-dia.js), sem Power BI e sem navegador.
//
// O que ele trava:
//   1. o DAX do dia: o filtro-base do gráfico + 'Calendário'[Dia] com o
//      literal do tipo certo, os três níveis de colunas (o último é o
//      recorte da lista do Faturamento diário) e os itens da nota;
//   2. leitura das linhas do BI (chave com/sem aspas, coluna que não veio,
//      combinação zerada fora) → uma por nota e as quebras com a fatia;
//   3. filtro cruzado e busca nas notas;
//   4. o dia na série: média só dos dias com faturamento, posição,
//      vizinhos pulando dia zerado, acumulado e o ritmo da meta (dias úteis);
//   5. o diagnóstico: faixas da força do dia, meta, concentração, cliente,
//      negativos, calendário, vários meses e o dia sem nota;
//   6. o Excel (abas e colunas);
//   7. a página: carrega o módulo, o gráfico abre a ficha e entrega o MESMO
//      filtro-base do gráfico;
//   8. o RECORTE MSB: a empresa não vira quebra, selo nem linha da nota, e o
//      "Como conta" diz que é só a MSB.
//
// Veio do portal completo (b093755); o fake do Power BI daqui é o genérico
// do .claude/ (fora do git), então ele não é conferido aqui.
//
//   node scripts/test-sr-dia.js
// ================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const C = require(path.join(RAIZ, 'sr-dia.js'));

let ok = 0, falhou = 0;
function t(nome, cond, extra) {
  if (cond) { ok++; return; }
  falhou++;
  console.log('  FALHOU: ' + nome + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 300) : ''));
}
const eq = (nome, a, b) => t(nome + '  (esperado ' + JSON.stringify(b) + ')', JSON.stringify(a) === JSON.stringify(b), a);
const tem = (lista, tt) => lista.some(i => i.tt === tt);
const item = (lista, tt) => lista.filter(i => i.tt === tt)[0] || null;

// ── 1. DAX ─────────────────────────────────────────────────────────
console.log('1. o DAX do dia');
eq('dia numérico sai sem aspas', C.predDia(21, '21'), "'Calendário'[Dia] = 21");
eq('dia texto sai entre aspas', C.predDia('21', '21'), "'Calendário'[Dia] = \"21\"");
eq('sem o valor bruto: pelo rótulo', C.predDia(undefined, '7'), "'Calendário'[Dia] = 7");
eq('aspas do texto escapadas', C.predDia('a"b', 'x'), "'Calendário'[Dia] = \"a\"\"b\"");
eq('nota numérica sem aspas', C.predNota(21102), "'Faturamentos'[Número da fatura] = 21102");
eq('nota texto entre aspas (zeros à esquerda ficam)', C.predNota('000673379'), "'Faturamentos'[Número da fatura] = \"000673379\"");
const BASE = ["MONTH('Calendário'[Data]) = 10", "YEAR('Calendário'[Data]) = 2026", 'X', C.predDia(21, '21')];
const d0 = C.daxDia(BASE, 0), d1 = C.daxDia(BASE, 1), d2 = C.daxDia(BASE, 2);
t('nível 0: todas as colunas', ['Número da fatura', "'Clientes'[Cliente]", "'Famílias'[Estratégia]", "'Famílias'[Família]", 'Sales Vertical', 'Cód. do estado',
  'UNIDADE_DE_NEGOCIO', 'Código da empresa', "'Vendedores'[Vendedor]", "'Calendário'[Data]), \"Fat\""].every(c => d0.indexOf(c) >= 0), d0);
t('nível 0: medida do relatório + o filtro-base inteiro + o dia', /"Fat", \[Faturamento\]\), MONTH\('Calendário'\[Data\]\) = 10, YEAR\('Calendário'\[Data\]\) = 2026, X, 'Calendário'\[Dia\] = 21\)$/.test(d0), d0);
t('nível 1: sem filial/empresa/vendedor/data, com estratégia', /Estratégia/.test(d1) && !/UNIDADE_DE_NEGOCIO|Código da empresa|Vendedor|SUMMARIZE\([^)]*'Calendário'\[Data\]/.test(d1), d1);
t('nível 2: sem estratégia (o recorte da lista do Faturamento diário)', !/Estratégia/.test(d2) && /'Famílias'\[Família\]/.test(d2) && /'Clientes'\[Cliente\]/.test(d2), d2);
t('os níveis começam por nota + cliente', C.NIVEIS.every(n => n[0] === 'nf' && n[1] === 'cli'));
const di = C.daxItens(BASE, '000673379', true), di2 = C.daxItens(BASE, 21102, false);
t('itens: produto + família, o filtro-base do dia + a nota', /SUMMARIZE\(Faturamentos, 'Produtos'\[Cód\. produto\], 'Produtos'\[Produto\], 'Famílias'\[Família\]\)/.test(di) &&
  /'Calendário'\[Dia\] = 21, 'Faturamentos'\[Número da fatura\] = "000673379"\)$/.test(di), di);
t('itens: quantidade só no "cheio"', /Faturamento \(quantidade\)/.test(di) && !/quantidade/.test(di2) && /= 21102\)$/.test(di2));
eq('margem: ROW das medidas com o filtro', C.daxMargem(['A', 'B'], C.MED_MG),
  'EVALUATE CALCULATETABLE(ROW("mp", [Margem de contribuição (%)], "mn", [Margem de contribuição (nota)]), A, B)');
eq('erro do Power BI resumido', C.msgErro(new Error('HTTP 400: {"error":{"pbi.error":{"details":[{"detail":{"value":"Coluna X não encontrada no modelo"}}]')), 'Coluna X não encontrada no modelo');

// ── 2. linhas → notas e quebras ────────────────────────────────────
console.log('2. linhas do BI → notas e quebras');
const ROWS = [
  { 'Faturamentos[Número da fatura]': '000673379', 'Clientes[Cliente]': 'AMIL', 'Famílias[Estratégia]': 'ELETROFISIOLOGIA', 'Famílias[Família]': 'LLD', 'Sales Vertical[Sales Vertical]': 'HEART',
    'Estados[Cód. do estado]': 'SP', 'DIM_UNIDADE_DE_NEGOCIO_V2[UNIDADE_DE_NEGOCIO]': 'FILIAL-SP', 'Empresas[Código da empresa]': 'BIO', 'Vendedores[Vendedor]': 'JOAO',
    'Calendário[Data]': '2026-10-21T00:00:00', '[Fat]': 17000 },
  { "'Faturamentos'[Número da fatura]": '000673388', "'Clientes'[Cliente]": 'ABSOLUTA', "'Famílias'[Estratégia]": 'NEFROLOGIA', "'Famílias'[Família]": 'CATETER HD',
    "'Sales Vertical'[Sales Vertical]": 'GENERAL SALES', "'Estados'[Cód. do estado]": 'RS', '[Fat]': 15600 },
  { 'Faturamentos[Número da fatura]': '000673388', 'Clientes[Cliente]': 'ABSOLUTA', 'Famílias[Estratégia]': 'INTENSIVE CARE', 'Famílias[Família]': 'CVC',
    'Sales Vertical[Sales Vertical]': 'GENERAL SALES', 'Estados[Cód. do estado]': 'RS', '[Fat]': 4500 },
  { 'Faturamentos[Número da fatura]': 21102, 'Clientes[Cliente]': 'BEVIMED', 'Famílias[Estratégia]': 'UROLOGIA', 'Famílias[Família]': 'SONDA',
    'Sales Vertical[Sales Vertical]': 'UROLOGIA', 'Estados[Cód. do estado]': 'CE', '[Fat]': -500 },
  { 'Faturamentos[Número da fatura]': '999', 'Clientes[Cliente]': 'ZERO', 'Famílias[Família]': 'NADA', '[Fat]': null }      // combinação sem faturamento: fora
];
const L = C.lerLinhas(ROWS);
eq('4 linhas (a zerada sai)', L.length, 4);
eq('chave com e sem aspas', [L[0].cli, L[1].cli], ['AMIL', 'ABSOLUTA']);
eq('colunas do nível 0 lidas', [L[0].fil, L[0].emp, L[0].vend, L[0].data], ['FILIAL-SP', 'BIO', 'JOAO', '2026-10-21']);
eq('coluna que não veio fica null', [L[1].fil, L[1].emp, L[1].vend, L[1].data], [null, null, null, null]);
t('nº numérico guarda o tipo (o DAX dos itens sai sem aspas)', L[3].raw === 21102 && L[3].nf === '21102', L[3]);
t('"[Cliente]" não pega "[Cód. Cliente]"', C.lerLinhas([{ 'Clientes[Cód. Cliente]': 'C1', 'Faturamentos[Número da fatura]': '1', '[Fat]': 1 }])[0].cli === null);
const NF = C.notasDe(L);
eq('uma por nota, da maior para a menor', NF.map(n => [n.id, n.v]), [['000673388', 20100], ['000673379', 17000], ['21102', -500]]);
eq('a nota junta as famílias com estratégia e vertical', NF[0].fams, [{ fam: 'CATETER HD', est: 'NEFROLOGIA', vert: 'GENERAL SALES', v: 15600 }, { fam: 'CVC', est: 'INTENSIVE CARE', vert: 'GENERAL SALES', v: 4500 }]);
eq('dados da nota', [NF[1].cli, NF[1].uf, NF[1].vend, NF[1].fil, NF[1].emp, NF[1].data], ['AMIL', 'SP', 'JOAO', 'FILIAL-SP', 'BIO', '2026-10-21']);
const GE = C.agrupar(L, 'est');
eq('estratégia: valor e nº de notas', GE.map(g => [g.k, g.v, g.n]), [['ELETROFISIOLOGIA', 17000, 1], ['NEFROLOGIA', 15600, 1], ['INTENSIVE CARE', 4500, 1], ['UROLOGIA', -500, 1]]);
t('fatia sobre o total das linhas', Math.abs(GE[0].p - 17000 / 36600) < 1e-9, GE[0].p);
eq('estratégia → famílias embaixo', GE[1].subs, ['CATETER HD']);
eq('família → estratégia embaixo', C.agrupar(L, 'fam')[0].subs, ['ELETROFISIOLOGIA']);
const GC = C.agrupar(L, 'cli');
eq('cliente: as 2 linhas da nota viram 1 nota', GC.map(g => [g.k, g.v, g.n, g.subs[0]]), [['ABSOLUTA', 20100, 1, 'RS'], ['AMIL', 17000, 1, 'SP'], ['BEVIMED', -500, 1, 'CE']]);
const GF = C.agrupar(L, 'fil');
eq('valor sem a coluna vira o grupo "null"', GF.map(g => g.k), [null, 'FILIAL-SP']);

// ── 3. filtro cruzado e busca ──────────────────────────────────────
console.log('3. filtro cruzado e busca');
const LF = C.filtrarLinhas(L, { dim: 'vert', k: 'GENERAL SALES' });
eq('filtro por vertical: só as linhas dela', LF.map(l => l.fam), ['CATETER HD', 'CVC']);
eq('nota no filtro vale só a parte filtrada', C.notasDe(C.filtrarLinhas(L, { dim: 'est', k: 'NEFROLOGIA' })).map(n => [n.id, n.v]), [['000673388', 15600]]);
eq('filtro pelo grupo "sem filial"', C.filtrarLinhas(L, { dim: 'fil', k: null }).length, 3);
t('sem filtro: tudo', C.filtrarLinhas(L, null) === L);
eq('busca sem acento e por vários termos', C.buscarNotas(NF, 'eletrofisiologia joao').map(n => n.id), ['000673379']);
eq('busca por estratégia acha a nota', C.buscarNotas(NF, 'intensive').map(n => n.id), ['000673388']);
eq('busca vazia: todas', C.buscarNotas(NF, '  ').length, 3);

// ── 4. o dia na série ──────────────────────────────────────────────
console.log('4. o dia na série do gráfico');
const SERIE = { labels: ['1', '2', '3', '4', '5'], valores: [100, 0, 300, 0, 200] };
const P3 = C.contexto(SERIE, '3');
eq('média só dos dias com faturamento', P3.media, 200);
eq('posição, nº de dias, acumulado, total', [P3.rank, P3.n, P3.acum, P3.tot], [1, 3, 400, 600]);
eq('vizinhos pulam o dia zerado', [P3.ant && P3.ant.l, P3.prox && P3.prox.l], ['1', '5']);
const P2 = C.contexto(SERIE, '2');
eq('dia zerado: sem posição, vizinhos dos dois lados', [P2.v, P2.rank, P2.ant.l, P2.prox.l], [0, null, '1', '3']);
eq('rótulo fora da série', C.contexto(SERIE, '9').i, -1);
eq('outubro/2026 tem 22 dias úteis', C.diasUteis(2026, 10).length, 22);
eq('31/09 não existe; 21/10/2026', [C.isoDia(2026, 9, 31), C.isoDia(2026, 10, 21)], [null, '2026-10-21']);
const PR = C.contexto({ labels: ['20', '21'], valores: [400, 600] }, '21');
const R = C.ritmo(PR, 2026, 10, '21', 2200);
eq('ritmo: 15 de 22 dias úteis até 21/10, acumulado e o que falta', [R.ate, R.uteis, R.restam, R.acum, R.falta], [15, 22, 7, 1000, 1200]);
t('ritmo: por dia útil e o que o dia fez', Math.abs(R.porDia - 100) < 1e-9 && Math.abs(R.doDia - 6) < 1e-9 && Math.abs(R.precisa - 1200 / 7) < 1e-9, R);
eq('sem meta (OLS) ou vários meses: sem ritmo', [C.ritmo(PR, 2026, 10, '21', null), C.ritmo(PR, null, null, '21', 2200)], [null, null]);

// ── 5. diagnóstico ─────────────────────────────────────────────────
console.log('5. o diagnóstico');
const linha = (nf, cli, est, fam, v, extra) => Object.assign({ nf, raw: nf, cli, est, fam, vert: 'V', uf: 'SP', fil: null, emp: null, vend: null, data: null, v }, extra || {});
const serieCom = (v21) => ({ labels: ['19', '20', '21', '22'], valores: [100000, 100000, v21, 100000] });
const muitas = (total, n) => Array.from({ length: n }, (_, i) => linha(String(1000 + i), 'CLI' + (i % 9), 'E' + (i % 3), 'F' + (i % 5), total / n));
const forca = v => C.modelo('21', muitas(v, 10), serieCom(v), { mes: 10, ano: 2026 }).diag.itens[0].tt;
eq('faixas da força do dia', [forca(200000), forca(115000), forca(100000), forca(80000), forca(60000)],
  ['Dia forte', 'Dia acima da média', 'Dia na média', 'Dia abaixo da média', 'Dia fraco']);
const Ef = C.modelo('21', muitas(200000, 10), serieCom(200000), { mes: 10, ano: 2026 });
t('forte: maior dia e contra o dia anterior', /É o maior dia do período\./.test(Ef.diag.itens[0].ds) && /Contra o dia 20 \(R\$ 100 mil\): \+R\$ 100 mil \(\+100%\)/.test(Ef.diag.itens[0].ds), Ef.diag.itens[0].ds);
t('manchete: força + o que puxou', /^Dia forte \(\+60% vs a média\), puxado por E0/.test(Ef.diag.manchete), Ef.diag.manchete);
eq('na média: a manchete não repete o %', C.modelo('21', muitas(100000, 10), serieCom(100000), {}).diag.manchete.split(',')[0], 'Dia na média');
t('pulverizado (10 notas iguais)', tem(Ef.diag.itens, 'Dia pulverizado'), Ef.diag.itens.map(i => i.tt));
const Em = C.modelo('21', muitas(200000, 10), serieCom(200000), { mes: 10, ano: 2026, resumo: { meta: 2200000 } });
t('ritmo da meta atrás: quanto falta por dia útil', tem(Em.diag.itens, 'Atrás do ritmo da meta') && /Faltam R\$ 1,80 Mi: R\$ 257 mil por dia útil nos 7 que restam/.test(item(Em.diag.itens, 'Atrás do ritmo da meta').ds),
  Em.diag.itens.map(i => i.tt + ': ' + i.ds));
t('meta batida', tem(C.modelo('21', muitas(200000, 10), serieCom(200000), { mes: 10, ano: 2026, resumo: { meta: 400000 } }).diag.itens, 'Meta do mês batida'));
t('vários meses: sem ritmo da meta', !C.modelo('21', muitas(200000, 10), serieCom(200000), { resumo: { meta: 400000 } }).diag.itens.some(i => /meta/i.test(i.tt)));
const Eu = C.modelo('21', [linha('1', 'A', 'E', 'F', 50000)], serieCom(50000), {});
t('uma nota só', tem(Eu.diag.itens, 'Uma nota só') && /numa nota só/.test(Eu.diag.manchete), Eu.diag);
const Ec = C.modelo('21', [linha('1', 'A', 'E1', 'F', 80000), linha('2', 'B', 'E2', 'F', 10000), linha('3', 'C', 'E2', 'F', 5000), linha('4', 'D', 'E2', 'F', 5000)], serieCom(100000), {});
t('concentrado: a maior nota e o peso do cliente', tem(Ec.diag.itens, 'Dia concentrado') && tem(Ec.diag.itens, 'Peso de um cliente') && /concentrado em poucas notas/.test(Ec.diag.manchete), Ec.diag);
t('as 3 maiores com 4 notas', /As 3 maiores notas fazem 95% do dia; a maior, NF 1 \(A\), sozinha 80%/.test(item(Ec.diag.itens, 'Dia concentrado').ds), item(Ec.diag.itens, 'Dia concentrado'));
const E1c = C.modelo('21', [linha('1', 'A', 'E', 'F', 40000), linha('2', 'A', 'E', 'F', 30000), linha('3', 'A', 'E', 'G', 30000)], serieCom(100000), {});
t('um cliente só', tem(E1c.diag.itens, 'Um cliente só'), E1c.diag.itens.map(i => i.tt));
t('até 3 notas: não diz "as 3 maiores fazem 100%"', !/fazem 100%/.test(JSON.stringify(E1c.diag)) && /O dia tem só 3 notas/.test(JSON.stringify(E1c.diag)));
const En = C.modelo('21', muitas(100000, 10).concat([linha('9', 'X', 'E0', 'F0', -2300)]), serieCom(97700), {});
t('valores negativos', tem(En.diag.itens, 'Valores negativos') && /1 linha negativa \(em 1 nota\) soma −R\$ 2\.300,00 e abate o dia/.test(item(En.diag.itens, 'Valores negativos').ds), item(En.diag.itens, 'Valores negativos'));
const Eg = C.modelo('21', muitas(100000, 10), serieCom(100000), {}, { mp: 0.25 });
eq('margem sem a do período', item(Eg.diag.itens, 'Margem do dia').ds, 'Margem de contribuição do dia: 25,0%.');
const Eg2 = C.modelo('21', muitas(100000, 10), serieCom(100000), { resumo: { margemPct: 0.302 } }, { mp: 0.25 });
t('margem abaixo do período em p.p.', item(Eg2.diag.itens, 'Margem abaixo do período') && /contra 30,2% no período \(−5,2 p\.p\.\)/.test(item(Eg2.diag.itens, 'Margem abaixo do período').ds), Eg2.diag.itens);
const Ew = C.modelo('18', muitas(1000, 3), { labels: ['16', '18'], valores: [5000, 1000] }, { mes: 10, ano: 2026 });
t('fim de semana (18/10/2026 = domingo)', tem(Ew.diag.itens, 'Fim de semana') && /domingo/.test(item(Ew.diag.itens, 'Fim de semana').ds), Ew.diag.itens);
const Ev = C.modelo('15', [linha('1', 'A', 'E', 'F', 600, { data: '2026-03-15' }), linha('2', 'B', 'E', 'F', 400, { data: '2026-04-15' })], { labels: ['15'], valores: [1000] }, { ano: 2026 });
t('vários meses: a data que mais pesou', Ev.multi && /a que mais pesou foi 15\/03\/2026 \(R\$ 600, 60%\)/.test(item(Ev.diag.itens, 'Vários meses no mesmo dia').ds), Ev.diag.itens);
t('único dia com faturamento', tem(Ev.diag.itens, 'Único dia com faturamento'));
const E0 = C.modelo('3', [], SERIE, {});
eq('dia sem nota', [E0.diag.manchete, E0.diag.itens[0].tt], ['Sem faturamento neste dia.', 'Nenhuma nota no dia']);
t('dia sem nota aponta o anterior com faturamento', /O dia anterior com faturamento foi o dia 1/.test(C.modelo('2', [], SERIE, {}).diag.itens[0].ds));
eq('o total do dia é o da barra; as fatias, das linhas', [Ef.total, Ef.soma], [200000, 200000]);

// ── 6. Excel ───────────────────────────────────────────────────────
console.log('6. o Excel do dia');
const Ex = C.modelo('21', L, { labels: ['21'], valores: [36100] }, { mes: 10, ano: 2026 });
const PL = C.planilhas(Ex, '21/10/2026 · quarta-feira');
eq('aba Linhas: cabeçalho', PL.linhas[0], ['Data', 'Dia', 'Nota fiscal', 'Cliente', 'UF', 'Estratégia', 'Família', 'Sales Vertical', 'Filial', 'Empresa', 'Vendedor', 'Faturamento']);
eq('aba Linhas: uma por linha do BI, maior primeiro', [PL.linhas.length, PL.linhas[1][2], PL.linhas[1][11], PL.linhas[1][0]], [5, '000673379', 17000, '21/10/2026']);
eq('aba Notas: uma por nota com as estratégias', [PL.notas.length, PL.notas[1][0], PL.notas[1][8], PL.notas[1][9]], [4, '000673388', 'NEFROLOGIA · INTENSIVE CARE', 20100]);
eq('aba Diagnóstico: resumo e um ponto por linha', [PL.diag[1][1], PL.diag.length], [Ex.diag.manchete, 4 + Ex.diag.itens.length]);
eq('esc() do desenho', C.esc('<b x="1">\'&'), '&lt;b x=&quot;1&quot;&gt;&#39;&amp;');

// ── 7. a página ────────────────────────────────────────────────────
console.log('7. a página');
const pg = fs.readFileSync(path.join(RAIZ, 'pages', 'comercial-sales-report.html'), 'utf8');
t('carrega sr-dia.js e sr-dia.css', /<script src="\.\.\/sr-dia\.js\?v=\d+"><\/script>/.test(pg) && /<link rel="stylesheet" href="\.\.\/sr-dia\.css\?v=\d+">/.test(pg));
t('sr-dia.js vem depois do sr-diario.js (a ficha do pedido/nota fecha ao abrir a do dia)', pg.indexOf('../sr-diario.js') < pg.indexOf('../sr-dia.js'));
t('o gráfico abre a ficha no clique da coluna', /interaction:\{ mode:'index', intersect:false \}/.test(pg) && /onClick:\(evt, els, ch\) => \{ if\(els && els\.length && window\.SRDia\) window\.SRDia\.abrir\(ch\.data\.labels\[els\[0\]\.index\], el\); \}/.test(pg));
t('teclado: Enter no gráfico abre o último dia com faturamento', /el\.addEventListener\('keydown'/.test(pg) && /id="sr-chart-daily" tabindex="0"/.test(pg));
t('a barra do dia aberto fica marcada', /window\.srDiaMarcar = function/.test(pg) && /marcar: window\.srDiaMarcar/.test(pg));
t('medirFaturamentoDiario devolve o Calendário[Dia] bruto', /out\.brutos  = dados\.map\(x => x\.bruto\)/.test(pg));
t('a ficha recebe o MESMO filtro-base do gráfico', /medirFaturamentoDiario\(filtrosDia\)/.test(pg) && /window\.SRDia\.serie\(diario, \{\s*filtros: filtrosDia, query: pbiQuery/.test(pg));
t('mês/ano só quando o período é um mês só; o consolidado vai para o diagnóstico',
  /mes: meses\.length === 1 && anos\.length === 1 && !f\.tri && !f\.sem \? meses\[0\] : null/.test(pg) && /resumo: msbio/.test(pg));
const js = fs.readFileSync(path.join(RAIZ, 'sr-dia.js'), 'utf8');
t('não usa as classes que o sr-diario.js escuta no documento', !/class="[^"]*\bsd-(busca|mais|fx|ord-m)\b/.test(js) && !/data-sd-(doc|seg)/.test(js));
t('a página continua com a Empresa fixa em MSB (o filtro-base da ficha a leva)', /const filtrosDia = empresaFiltro \? base\.concat\(empresaFiltro\)/.test(pg) &&
  /const srFiltroEmpresa = \(\) => `\$\{MEDIDAS\.segCol\} = "\$\{MEDIDAS\.segMsb\}"`/.test(pg));
t('a barra do dia aberto no petróleo da MSB (não o navy da BIO)', /rgba\(26,81,96,\.92\)/.test(pg) && !/rgba\(14,74,138/.test(pg));

// ── 8. recorte MSB ─────────────────────────────────────────────────
console.log('8. recorte MSB');
t('Outras quebras sem a empresa', C.OUTRAS.indexOf('emp') < 0 && C.OUTRAS.indexOf('vert') >= 0, C.OUTRAS);
t('sem selo por empresa no cabeçalho', !/E\.grupos\.emp\.forEach/.test(js));
t('sem a linha Empresa na nota aberta', !/pares\.push\(\['Empresa'/.test(js));
t('"Como conta": só a MSB, o Tipo de Cliente vale', /Só a empresa <b>MSB<\/b>; o filtro de <b>Tipo de Cliente<\/b> vale aqui/.test(js) && !/filtros de <b>Empresa<\/b>/.test(js));
const css = fs.readFileSync(path.join(RAIZ, 'sr-dia.css'), 'utf8');
t('sr-dia.css já convertido para o teal (sem o navy/azul da BIO)', !/#0E4A8A|#1B5E9E|#CFE0F2|rgba\(18,114,196/i.test(css) && /#1A5160/i.test(css));

console.log(`\n${ok + falhou} verificações · ${falhou ? falhou + ' FALHARAM' : 'tudo ok'}`);
process.exit(falhou ? 1 : 0);
