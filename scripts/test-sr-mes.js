#!/usr/bin/env node
// ================================================================
// scripts/test-sr-mes.js — guarda da FICHA DO MÊS do Sales Report
// (Comercial) · Visão Geral: o clique na coluna do gráfico "Evolução
// Mensal" (sr-mes.js, em cima do motor do sr-dia.js), sem Power BI e sem
// navegador. "Hoje" fixo em 13/11/2026 (sexta): outubro fechado, novembro
// em andamento, dezembro por vir.
//
// O que ele trava:
//   1. o DAX do mês: o filtro-base do gráfico + YEAR/MONTH (sem o Dia), a
//      margem do mês com a do ano ("mpa") só quando a margem é visível;
//   2. a situação do mês, a meta (fechado: batida/faltou; em andamento:
//      dias úteis, quanto falta por dia útil, a projeção), o acumulado do
//      ano e a média só dos meses fechados;
//   3. o diagnóstico (força, meta, acumulado, dias do mês, margem contra o
//      ano, mês em andamento, mês sem nota / por vir) e a manchete;
//   4. o Excel (abas e colunas) e a especificação da ficha (consulta,
//      arquivo, margem lida, "Como conta" com o recorte MSB);
//   5. a página: carrega sr-mes.js depois do sr-dia.js, a coluna abre a
//      ficha com o nº do mês e entrega o MESMO filtro-base do gráfico;
//   6. o motor: sr-dia.js expõe SRDia.ficha / SRDia.core e uma ficha fecha
//      a outra.
//
//   node scripts/test-sr-mes.js
// ================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const C = require(path.join(RAIZ, 'sr-dia.js'));
const M = require(path.join(RAIZ, 'sr-mes.js'));
const HOJE = '2026-11-13';

let ok = 0, falhou = 0;
function t(nome, cond, extra) {
  if (cond) { ok++; return; }
  falhou++;
  console.log('  FALHOU: ' + nome + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : ''));
}
const eq = (nome, a, b) => t(nome + '  (esperado ' + JSON.stringify(b) + ')', JSON.stringify(a) === JSON.stringify(b), a);
const tem = (lista, tt) => lista.some(i => i.tt === tt);
const item = (lista, tt) => lista.filter(i => i.tt === tt)[0] || null;
const perto = (a, b) => Math.abs(a - b) < 1e-6;

// ── 1. DAX ─────────────────────────────────────────────────────────
console.log('1. o DAX do mês');
eq('predicado do mês', M.predMes(2026, '10'), ["YEAR('Calendário'[Data]) = 2026", "MONTH('Calendário'[Data]) = 10"]);
const BASE = ["'X'[y] = \"NÃO\"", "'Empresas'[Código da empresa] = \"MSB\""].concat(M.predMes(2026, 10));
const dm = C.daxDia(BASE, 0);
t('consulta do mês: SUMMARIZE do dia + o filtro do gráfico + ano e mês, sem o Dia',
  /SUMMARIZE\(Faturamentos, 'Faturamentos'\[Número da fatura\], 'Clientes'\[Cliente\]/.test(dm) && /YEAR\('Calendário'\[Data\]\) = 2026, MONTH\('Calendário'\[Data\]\) = 10\)$/.test(dm) && !/\[Dia\]/.test(dm), dm);
t('a consulta do mês traz a Data (os dias do mês)', /'Calendário'\[Data\]\), "Fat"/.test(dm), dm);
const mg = M.daxMargemMes(['A', 'B'], C.MED_MG, 2026);
eq('margem do mês com a do ano', mg,
  'EVALUATE CALCULATETABLE(ROW("mp", [Margem de contribuição (%)], "mn", [Margem de contribuição (nota)], "mpa", CALCULATE([Margem de contribuição (%)], FILTER(ALL(\'Calendário\'), YEAR(\'Calendário\'[Data]) = 2026))), A, B)');
t('sem a margem % (OLS): sem "mpa"', !/mpa/.test(M.daxMargemMes(['A'], [['mn', '[Margem de contribuição (nota)]']], 2026)));

// ── 2. o mês no ano ────────────────────────────────────────────────
console.log('2. situação, meta, acumulado e média');
eq('situação do mês', [M.situacao(2026, 10, HOJE), M.situacao(2026, 11, HOJE), M.situacao(2026, 12, HOJE), M.situacao(2025, 12, HOJE), M.situacao(2027, 1, HOJE)],
  ['fechado', 'andamento', 'futuro', 'fechado', 'futuro']);
const MF = M.metaMes(12000000, 10000000, 2026, 10, HOJE);
t('mês fechado acima da meta', MF.sit === 'fechado' && perto(MF.pm, 1.2) && MF.sobra === 2000000 && MF.falta === 0 && MF.ate === undefined, MF);
const MA = M.metaMes(5000000, 10500000, 2026, 11, HOJE);
eq('novembro/2026: 21 dias úteis, 10 corridos até 13/11, 11 restam', [MA.uteis, MA.ate, MA.restam], [21, 10, 11]);
t('em andamento: falta por dia útil e a projeção', perto(MA.precisa, 5500000 / 11) && perto(MA.proj, 5000000 / 10 * 21) && perto(MA.pu, 10 / 21) && perto(MA.porDia, 500000), MA);
eq('sem meta: sem leitura de meta', [M.metaMes(1, 0, 2026, 10, HOJE), M.metaMes(1, null, 2026, 10, HOJE)], [null, null]);
const SERIE = { labels: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
  valores: [100, 200, 0, 300, 200, 200, 200, 200, 200, 600, 900, 0] };
const METAS = [150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150];
const AC = M.acumulado(SERIE, METAS, 3);
eq('acumulado jan–mar', [AC.fat, AC.meta, AC.ate], [300, 450, 3]);
eq('sem meta no ano: sem acumulado', M.acumulado(SERIE, [], 3), null);
const P10 = M.contextoMes(SERIE, '10', 2026, HOJE), P11 = M.contextoMes(SERIE, '11', 2026, HOJE);
eq('média só dos meses fechados com faturamento (novembro fora)', [P10.fechados.n, P10.fechados.media], [9, 2200 / 9]);
eq('outubro é o maior dos fechados; novembro (em andamento) sem posição', [P10.fechados.rank, P11.fechados.rank], [1, null]);
eq('vizinhos do gráfico continuam (novembro conta)', [P10.ant.l, P10.prox.l], ['9', '11']);
const LD = [{ nf: '1', data: '2026-10-21', v: 300 }, { nf: '2', data: '2026-10-05', v: 100 }, { nf: '3', data: '2026-10-21', v: 200 }, { nf: '4', data: null, v: 50 }]
  .map(l => Object.assign({ raw: l.nf, cli: 'A', est: 'E', fam: 'F', vert: 'V', uf: 'SP', fil: null, emp: 'MSB', vend: null }, l));
eq('os dias do mês em ordem, com a soma', M.porDia(LD).map(d => [d.k, d.v, d.n]), [['2026-10-05', 100, 1], ['2026-10-21', 500, 2]]);

// ── 3. diagnóstico ─────────────────────────────────────────────────
console.log('3. o diagnóstico do mês');
const linha = (nf, cli, est, fam, v, data) => ({ nf, raw: nf, cli, est, fam, vert: 'V', uf: 'SP', fil: null, emp: 'MSB', vend: null, data: data || null, v });
// n notas iguais, espalhadas em dias úteis de outubro/2026
const muitas = (total, n, mes) => Array.from({ length: n }, (_, i) => linha(String(1000 + i), 'CLI' + (i % 9), 'E' + (i % 3), 'F' + (i % 5), total / n,
  '2026-' + String(mes || 10).padStart(2, '0') + '-' + String(5 + (i % 15)).padStart(2, '0')));
const serieCom = (v10, v11) => ({ labels: SERIE.labels, valores: [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, v10, v11 == null ? 500 : v11, 0] });
const metas = v => Array(12).fill(v);
const E10 = M.modeloMes('10', muitas(1500, 20), serieCom(1500), { ano: 2026, metas: metas(1250) }, { mp: 0.33, mpa: 0.30 }, HOJE);
eq('outubro forte, meta batida, ano acima da meta', E10.diag.itens.slice(0, 3).map(i => i.tt), ['Mês forte', 'Meta do mês batida', 'Ano abaixo da meta acumulada']);
t('força: média dos 10 meses fechados e o mês anterior', /43% acima da média dos 10 meses fechados com faturamento no ano \(R\$ 1,1 mil\)/.test(E10.diag.itens[0].ds) &&
  /É o maior mês do ano\./.test(E10.diag.itens[0].ds) && /Contra Setembro \(R\$ 1 mil\): \+R\$ 500 \(\+50%\)/.test(E10.diag.itens[0].ds), E10.diag.itens[0].ds);
t('meta batida: quanto passou', /R\$ 1,5 mil contra a meta de R\$ 1,3 mil: 120% \(\+R\$ 250 acima\)/.test(item(E10.diag.itens, 'Meta do mês batida').ds), item(E10.diag.itens, 'Meta do mês batida'));
t('acumulado jan–out contra a meta acumulada', /De Janeiro a Outubro o ano soma R\$ 10,5 mil — 84% da meta acumulada de R\$ 12,5 mil \(faltam R\$ 2 mil\)/.test(item(E10.diag.itens, 'Ano abaixo da meta acumulada').ds),
  item(E10.diag.itens, 'Ano abaixo da meta acumulada'));
t('manchete: força — meta, puxado por', /^Mês forte \(\+43% vs a média\) — meta batida \(120%\), puxado por E0/.test(E10.diag.manchete), E10.diag.manchete);
t('os dias do mês: em quantos faturou e o melhor dia', /Faturou em 15 dias \(o mês tem 22 dias úteis\); o melhor foi/.test(item(E10.diag.itens, 'Os dias do mês').ds), item(E10.diag.itens, 'Os dias do mês'));
t('margem do mês contra a do ano', /Margem de contribuição do mês: 33,0%, contra 30,0% no ano \(\+3,0 p\.p\.\)/.test(item(E10.diag.itens, 'Margem acima do ano').ds), E10.diag.itens.map(i => i.tt));
t('fechado: não diz "em andamento"', !tem(E10.diag.itens, 'Mês em andamento'));
const Eab = M.modeloMes('10', muitas(1000, 20), serieCom(1000), { ano: 2026, metas: metas(1250) }, null, HOJE);
t('abaixo da meta: o que faltou', tem(Eab.diag.itens, 'Abaixo da meta') && /80%\. Faltaram R\$ 250 \(20% da meta\)/.test(item(Eab.diag.itens, 'Abaixo da meta').ds) && /— 80% da meta/.test(Eab.diag.manchete),
  Eab.diag);
t('perto da meta (≥ 90%)', tem(M.modeloMes('10', muitas(1150, 20), serieCom(1150), { ano: 2026, metas: metas(1250) }, null, HOJE).diag.itens, 'Perto da meta'));
t('na média: sem o % na manchete', /^Mês na média — /.test(Eab.diag.manchete), Eab.diag.manchete);
const E11 = M.modeloMes('11', muitas(400, 20, 11), serieCom(1500, 400), { ano: 2026, metas: metas(1050) }, null, HOJE);
t('novembro em andamento: sem força contra a média', !E11.diag.itens.some(i => /^Mês (forte|fraco|na média|acima|abaixo)/.test(i.tt)), E11.diag.itens.map(i => i.tt));
t('ritmo: atrás, falta por dia útil e a projeção', tem(E11.diag.itens, 'Atrás do ritmo da meta') &&
  /Até hoje o mês soma R\$ 400 — 38% da meta de R\$ 1,1 mil, com 10 de 21 dias úteis \(48%\) corridos\. Faltam R\$ 650: R\$ 59 por dia útil nos 11 que restam\. No ritmo de hoje, o mês fecha perto de R\$ 840 \(80% da meta\)\./
    .test(item(E11.diag.itens, 'Atrás do ritmo da meta').ds), item(E11.diag.itens, 'Atrás do ritmo da meta'));
t('mês em andamento avisado e na manchete', tem(E11.diag.itens, 'Mês em andamento') && /^R\$ 400 até hoje — 38% da meta até hoje/.test(E11.diag.manchete), E11.diag.manchete);
t('em andamento: os dias sem "o mês tem N dias úteis"', !/o mês tem/.test(item(E11.diag.itens, 'Os dias do mês').ds));
t('em andamento: o acumulado vai só até o último mês fechado', E11.acum.ate === 10 &&
  /^De Janeiro a Outubro \(o último mês fechado\) o ano soma R\$ 10,5 mil — 100% da meta acumulada de R\$ 10,5 mil — exatamente a meta\.$/.test(item(E11.diag.itens, 'Ano acima da meta acumulada').ds),
  E11.diag.itens.filter(i => /acumulada/.test(i.tt)));
const E12 = M.modeloMes('12', [], serieCom(1500), { ano: 2026, metas: metas(1250) }, null, HOJE);
eq('dezembro por vir', [E12.diag.manchete, E12.diag.itens[0].tt], ['Mês ainda por vir.', 'Nenhuma nota no mês']);
t('mês por vir: a meta e o mês anterior com faturamento', /Dezembro ainda não começou\. A meta do mês é R\$ 1,3 mil\. O mês anterior com faturamento foi Novembro/.test(E12.diag.itens[0].ds), E12.diag.itens[0].ds);
eq('mês fechado sem nota', M.modeloMes('3', [], { labels: SERIE.labels, valores: SERIE.valores }, { ano: 2026 }, null, HOJE).diag.manchete, 'Sem faturamento neste mês.');
const Eu = M.modeloMes('1', muitas(100, 4, 1), { labels: SERIE.labels, valores: [100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, { ano: 2026 }, null, HOJE);
t('único mês fechado com faturamento', tem(Eu.diag.itens, 'Único mês fechado com faturamento'), Eu.diag.itens.map(i => i.tt));
const En = M.modeloMes('10', muitas(1500, 10).concat([linha('9', 'X', 'E0', 'F0', -200, '2026-10-07')]), serieCom(1300), { ano: 2026 }, null, HOJE);
t('valores negativos abatem o mês', /1 linha negativa \(em 1 nota\) soma −R\$ 200,00 e abate o mês/.test(item(En.diag.itens, 'Valores negativos').ds), item(En.diag.itens, 'Valores negativos'));
eq('o total do mês é o da coluna; as fatias, das linhas', [E10.total, E10.soma], [1500, 1500]);

// ── 4. Excel e a especificação ─────────────────────────────────────
console.log('4. o Excel do mês e a especificação da ficha');
const PL = M.planilhasMes(E10, 'Outubro 2026 · MSB');
eq('aba Linhas: com a Data, sem o "Dia"', PL.linhas[0], ['Data', 'Nota fiscal', 'Cliente', 'UF', 'Estratégia', 'Família', 'Sales Vertical', 'Filial', 'Empresa', 'Vendedor', 'Faturamento']);
t('aba Linhas em ordem de data', PL.linhas[1][0] === '05/10/2026', PL.linhas[1]);
eq('aba Por dia: um por dia com faturamento', [PL.dias[0], PL.dias.length], [['Data', 'Dia da semana', 'Notas', 'Faturamento', '% do mês'], 16]);
eq('aba Notas: % do mês', PL.notas[0][10], '% do mês');
eq('aba Diagnóstico', [PL.diag[0], PL.diag[1][1]], [['Faturamento do mês', 'Outubro 2026 · MSB'], E10.diag.manchete]);
const K = M.MES, CTX = { ano: 2026, filtros: ['F1', 'F2'], sufixo: ' · MSB' };
eq('a consulta: o filtro do gráfico + o ano e o mês', K.base(CTX, SERIE, '7'), ['F1', 'F2', "YEAR('Calendário'[Data]) = 2026", "MONTH('Calendário'[Data]) = 7"]);
eq('arquivo e nome do Excel', [K.arquivo('7', CTX), K.nome('7', CTX)], ['Faturamento_2026-07.xlsx', 'Julho 2026 · MSB']);
eq('abas do Excel', K.abas(E10, 'x').map(a => a[0]), ['Notas', 'Linhas', 'Por dia', 'Diagnóstico']);
eq('margem lida (com a do ano)', K.lerMargem({ '[mp]': 0.31, '[mn]': 7, '[mpa]': 0.3 }), { mp: 0.31, mn: 7, mpa: 0.3 });
// o rodapé lê o dia de hoje de verdade: o mês corrente e um ano inteiro fechado
const HJ = C.hojeISO(), ANO_H = +HJ.slice(0, 4), MES_H = String(+HJ.slice(5, 7));
eq('rodapé: o mês corrente fora do ranking', K.posicao(C.contexto(SERIE, MES_H), MES_H, { ano: ANO_H }, SERIE), 'mês em andamento');
eq('rodapé: mês fechado entre os fechados', K.posicao(C.contexto(SERIE, '10'), '10', { ano: ANO_H - 1 }, SERIE), '2º de 10 meses fechados');
t('ids próprios (sdm-) e os textos do mês', K.id === 'sdm' && K.chave === 'mes' && K.t.xls === 'Excel do mês' && K.t.uns === 'meses' && K.mostraData() === true);
const cc = M.comoContaMes('10', CTX, 2);
t('"Como conta": o mês, só a MSB, o Tipo de Cliente vale, o período não muda', /data em <b>Outubro de 2026<\/b>/.test(cc) && /Só a empresa <b>MSB<\/b>; o filtro de <b>Tipo de Cliente<\/b> vale aqui/.test(cc) &&
  /O filtro de período não muda o gráfico nem a ficha/.test(cc) && /estratégia, filial, vendedor e data ficam de fora/.test(cc), cc);
t('"Como conta" sem a Empresa como filtro', !/filtros de <b>Empresa<\/b>/.test(cc));

// ── 5. a página ────────────────────────────────────────────────────
console.log('5. a página');
const pg = fs.readFileSync(path.join(RAIZ, 'pages', 'comercial-sales-report.html'), 'utf8');
t('carrega sr-mes.js depois do sr-dia.js', /<script src="\.\.\/sr-mes\.js\?v=\d+"><\/script>/.test(pg) && pg.indexOf('../sr-dia.js') < pg.indexOf('../sr-mes.js'));
t('a coluna do mês abre a ficha com o nº do mês', /onClick:\(evt, els\) => \{ if\(els && els\.length && window\.SRMes\) window\.SRMes\.abrir\(String\(els\[0\]\.index \+ 1\), el\); \}/.test(pg));
t('o gráfico mensal pega a coluna inteira (index, sem intersect)', /id="sr-chart-mensal" tabindex="0"/.test(pg) && (pg.match(/interaction:\{ mode:'index', intersect:false \}/g) || []).length === 2);
t('teclado: Enter abre o último mês com faturamento', /window\.SRMes\.abrir\(String\(i \+ 1\), el\)/.test(pg));
t('a coluna do mês aberto fica marcada (petróleo)', /window\.srMesMarcar = function/.test(pg) && /String\(i\+1\) === _mesMarcado\) return 'rgba\(26,81,96,\.92\)'/.test(pg) && /marcar: window\.srMesMarcar/.test(pg));
t('o gráfico e a meta usam o filtrosMensal', (pg.match(/const extra = filtrosMensal\(extraArr\);/g) || []).length === 2);
t('a ficha recebe o MESMO filtro-base do gráfico, o ano dele e a meta',
  /window\.SRMes\.serie\(\{ labels: evol\.map\(\(_, i\) => String\(i \+ 1\)\), valores: evol \}, \{\s*filtros: filtrosMensal\(empresaFiltro \? \[empresaFiltro\] : \[\]\), query: pbiQuery, ano: srAnoMensal\(\),\s*metas: metaEvol/.test(pg) &&
  /medirEvolucaoMensal\(empresaFiltro \? \[empresaFiltro\] : \[\]\)/.test(pg));
t('o ano do gráfico é o maior ano escolhido', /const srAnoMensal = \(\) => Math\.max\.apply\(null, \[\]\.concat\(window\.filtroAtual\.ano\)\);/.test(pg) && /YEAR\('Calendário'\[Data\]\) = \$\{Math\.max\.apply\(null, \[\]\.concat\(f\.ano\)\)\}/.test(pg));

// ── 6. o motor ─────────────────────────────────────────────────────
console.log('6. o motor (sr-dia.js)');
const js = fs.readFileSync(path.join(RAIZ, 'sr-dia.js'), 'utf8'), jm = fs.readFileSync(path.join(RAIZ, 'sr-mes.js'), 'utf8');
t('sr-dia.js expõe o motor e o núcleo', /function ficha\(K\)/.test(js) && /root\.SRDia\.ficha = ficha;/.test(js) && /root\.SRDia\.core = CORE;/.test(js));
t('a ficha do dia continua com os ids sdd-', /id: 'sdd', chave: 'dia'/.test(js) && /'#' \+ K\.id \+ '-' \+ s/.test(js));
t('uma ficha fecha a outra (e a do pedido/nota)', /FICHAS\.forEach\(function \(f\) \{ if \(f !== EU\)/.test(js) && /root\.SRDiario\.fechar\(\)/.test(js));
t('sr-mes.js monta a ficha pelo motor', /root\.SRMes = root\.SRDia\.ficha\(MES\);/.test(jm));
t('sr-mes.js não usa as classes que o sr-diario.js escuta no documento', !/class="[^"]*\bsd-(busca|mais|fx|ord-m)\b/.test(jm) && !/data-sd-(doc|seg)/.test(jm));
t('sr-mes.js sem selo/quebra de empresa (RECORTE MSB)', !/grupos\.emp/.test(jm) && !/pares\.push\(\['Empresa'/.test(jm));

console.log(`\n${ok + falhou} verificações · ${falhou ? falhou + ' FALHARAM' : 'tudo ok'}`);
process.exit(falhou ? 1 : 0);
