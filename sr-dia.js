/* ================================================================
   sr-dia.js — Sales Report (Comercial) · Visão Geral: a FICHA DO DIA.

   Clicar numa barra do gráfico "Faturamento por Dia" abre, à direita,
   TUDO o que foi faturado naquele dia — no molde da ficha das listas
   Pedidos em andamento / Faturamento diário (sr-diario.js): o mesmo
   painel, os mesmos números-chave e os mesmos cartões. Dentro dela:
     • os números do dia: faturado, notas, clientes, ticket médio e o dia
       contra a média dos dias com faturamento do período (com um mês só,
       também contra o ritmo da meta);
     • o DIAGNÓSTICO do dia, escrito a partir dos números: a força do dia,
       o ritmo da meta no mês, a concentração (notas e cliente), o que
       puxou (estratégia, família, empresa), a margem do dia, valores
       negativos e o calendário (fim de semana, hoje, vários meses);
     • a quebra por ESTRATÉGIA, FAMÍLIA, CLIENTE e as outras (vertical,
       filial, UF, vendedor, empresa, data) — clicar numa linha filtra o
       resto da ficha por ela, como o filtro cruzado do Power BI (o
       diagnóstico fica sempre sobre o dia inteiro);
     • as NOTAS FISCAIS do dia: busca, e clicar abre a nota com as
       famílias e, lidos na hora no Power BI, os itens;
     • ‹ › anda para o dia anterior / seguinte com faturamento e o Excel
       leva as linhas, as notas e o diagnóstico.
   A consulta é a do gráfico + 'Calendário'[Dia] = N: a ficha soma igual
   à barra. Com mais de um mês no período, o dia N junta o dia N de cada
   mês — igual à barra.

   A página chama:
     SRDia.serie({ labels, valores, brutos }, { filtros, query, periodo, mes, ano, resumo, marcar })
       labels/valores/brutos = medirFaturamentoDiario (brutos = o valor de
       'Calendário'[Dia] como veio, para o literal sair do tipo certo);
       filtros = o MESMO filtro-base do gráfico; mes/ano = só quando o
       período é um mês só; resumo = o consolidado do período (meta,
       margem); marcar(rotulo|null) destaca a barra do dia aberto
     SRDia.abrir(rotulo)            — o clique na barra
   F12: SRDia.estado()
   No Node (scripts/test-sr-dia.js) o arquivo exporta só o núcleo puro —
   ler as linhas, agrupar, diagnosticar, montar o DAX e o Excel — sem DOM.
   Desenho: sr-dia.css, em cima do .sd-dw do sr-diario.css.

   O painel é um MOTOR comum (ficha(K)): a ficha do dia é uma
   especificação (DIA, no fim do arquivo) e a do MÊS — clique na coluna do
   gráfico Evolução Mensal — é outra, no sr-mes.js (SRDia.ficha, SRDia.core).

   Veio do portal completo (b093755, 23/10/2026). RECORTE MSB: aqui só
   existe a empresa MSB (o pbi-throttle.js recorta toda consulta), então a
   empresa não vira quebra, nem selo no cabeçalho, nem linha da nota; a
   coluna continua na consulta e no Excel.
   ================================================================ */
(function (root) {
  'use strict';

  var PASSO = 40;                               // notas pintadas de cada vez
  var TOPN = 6;                                 // linhas de cada quebra antes do "ver todas"
  var DS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var DSEM = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

  // colunas da consulta do dia
  var COL = {
    nf: "'Faturamentos'[Número da fatura]",
    cli: "'Clientes'[Cliente]",
    est: "'Famílias'[Estratégia]",
    fam: "'Famílias'[Família]",
    vert: "'Sales Vertical'[Sales Vertical]",
    uf: "'Estados'[Cód. do estado]",
    fil: "'DIM_UNIDADE_DE_NEGOCIO_V2'[UNIDADE_DE_NEGOCIO]",
    emp: "'Empresas'[Código da empresa]",
    vend: "'Vendedores'[Vendedor]",
    data: "'Calendário'[Data]"
  };
  // do mais completo ao mais enxuto: uma coluna recusada (OLS / fora do
  // modelo) derruba a consulta INTEIRA, então cai para o nível seguinte. O
  // último é o recorte da lista do Faturamento diário, que já se sabe que passa.
  var NIVEIS = [
    ['nf', 'cli', 'est', 'fam', 'vert', 'uf', 'fil', 'emp', 'vend', 'data'],
    ['nf', 'cli', 'est', 'fam', 'vert', 'uf'],
    ['nf', 'cli', 'fam', 'vert', 'uf']
  ];
  var MED_MG = [['mp', '[Margem de contribuição (%)]'], ['mn', '[Margem de contribuição (nota)]']];
  var COL_DIA = "'Calendário'[Dia]";
  // [rótulo, plural, "sem ..."]
  var QUEBRAS = {
    est: ['Estratégia', 'estratégias', 'Sem estratégia'], fam: ['Família', 'famílias', 'Sem família'],
    cli: ['Cliente', 'clientes', 'Sem cliente'], vert: ['Vertical', 'verticais', 'Sem vertical'],
    fil: ['Filial', 'filiais', 'Sem filial'], uf: ['UF', 'UFs', 'Sem UF'], vend: ['Vendedor', 'vendedores', 'Sem vendedor'],
    emp: ['Empresa', 'empresas', 'Sem empresa'], data: ['Data', 'datas', 'Sem data']
  };
  // RECORTE MSB: sem 'emp' — a empresa é sempre MSB (uma linha só)
  var OUTRAS = ['vert', 'fil', 'uf', 'vend', 'data'];

  // ══════════════════════════════════════════════════════════════
  // FORMATAÇÃO (a mesma régua do sr-diario.js)
  // ══════════════════════════════════════════════════════════════
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function numOu(v) { if (v == null || v === '') return null; var n = Number(v); return isFinite(n) ? n : null; }
  function txt(v) { if (v == null) return null; var s = String(v).trim(); return s || null; }
  function fBRL(v) { return v == null || !isFinite(Number(v)) ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fBRLp(v) { return v == null || !isFinite(Number(v)) ? '—' : '<small>R$</small>' + esc(Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); }
  function fMi(v) {
    v = num(v); var a = Math.abs(v);
    if (a >= 1e6) return 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Mi';
    if (a >= 1e3) return 'R$ ' + (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: a >= 1e5 ? 0 : 1 }) + ' mil';
    return 'R$ ' + Math.round(v).toLocaleString('pt-BR');
  }
  function fMiS(v) { v = num(v); return (v > 0 ? '+' : v < 0 ? '−' : '') + fMi(Math.abs(v)); }
  function fInt(v) { return v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
  function fPct(p) { if (p == null || !isFinite(p)) return '—'; var x = p * 100; return x > 0 && x < 1 ? '<1%' : Math.round(x) + '%'; }
  function fVar(p) { if (p == null || !isFinite(p)) return '—'; var x = Math.round(p * 100); return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x) + '%'; }
  function fPct1(p) { return p == null || !isFinite(p) ? '—' : (p * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'; }
  function fPP(d) { var x = d * 100; return (x > 0.05 ? '+' : x < -0.05 ? '−' : '') + Math.abs(x).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' p.p.'; }
  function plural(n, s, p) { return fInt(n) + ' ' + (Number(n) === 1 ? s : p); }
  function pad(n) { return String(n).padStart(2, '0'); }

  // data do Power BI (ISO com hora, dd/mm/aaaa, Date) → 'aaaa-mm-dd'
  function isoDe(v) {
    if (v == null || v === '') return null;
    var y, m, d;
    if (v instanceof Date) { if (isNaN(v)) return null; y = v.getFullYear(); m = v.getMonth() + 1; d = v.getDate(); }
    else {
      var s = String(v).trim(), r;
      if ((r = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) { y = +r[1]; m = +r[2]; d = +r[3]; }
      else if ((r = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s))) { y = +r[3]; m = +r[2]; d = +r[1]; }
      else return null;
    }
    if (!y || y < 2000) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  }
  function fData(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—'; }
  function hojeISO() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
    catch (e) { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  }
  function diaSem(iso, longo) { var d = new Date(iso + 'T12:00:00'); return (longo ? DSEM : DS)[d.getDay()]; }
  // a data do dia quando o período é um mês só (dia 31 em setembro não existe)
  function isoDia(ano, mes, dia) {
    ano = Number(ano); mes = Number(mes); dia = Number(dia);
    if (!ano || !mes || !dia) return null;
    var d = new Date(ano, mes - 1, dia);
    if (d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
    return ano + '-' + pad(mes) + '-' + pad(dia);
  }
  // dias úteis do mês: segunda a sexta (feriado não entra na conta)
  function diasUteis(ano, mes) {
    var out = [], n = new Date(ano, mes, 0).getDate();
    for (var d = 1; d <= n; d++) { var w = new Date(ano, mes - 1, d).getDay(); if (w > 0 && w < 6) out.push(d); }
    return out;
  }

  // ══════════════════════════════════════════════════════════════
  // CONSULTAS (DAX)
  // ══════════════════════════════════════════════════════════════
  // o literal do dia sai do TIPO que o modelo devolveu ('Calendário'[Dia]
  // número → sem aspas; texto → entre aspas). Sem o valor bruto, pelo rótulo.
  function predDia(bruto, rotulo) {
    if (typeof bruto === 'number' && isFinite(bruto)) return COL_DIA + ' = ' + bruto;
    if (typeof bruto === 'string') return COL_DIA + ' = "' + bruto.replace(/"/g, '""') + '"';
    var s = String(rotulo == null ? '' : rotulo).trim();
    return /^\d+$/.test(s) ? COL_DIA + ' = ' + Number(s) : COL_DIA + ' = "' + s.replace(/"/g, '""') + '"';
  }
  function predNota(raw) {
    return typeof raw === 'number' ? COL.nf + ' = ' + raw : COL.nf + ' = "' + String(raw).replace(/"/g, '""') + '"';
  }
  function daxDia(base, nivel) {
    var cols = NIVEIS[nivel].map(function (k) { return COL[k]; });
    return 'EVALUATE CALCULATETABLE(ADDCOLUMNS(SUMMARIZE(Faturamentos, ' + cols.join(', ') + '), "Fat", [Faturamento]), ' + base.join(', ') + ')';
  }
  function daxMargem(base, meds) {
    return 'EVALUATE CALCULATETABLE(ROW(' + meds.map(function (m) { return '"' + m[0] + '", ' + m[1]; }).join(', ') + '), ' + base.join(', ') + ')';
  }
  function daxItens(base, raw, comQt) {
    return "EVALUATE CALCULATETABLE(ADDCOLUMNS(SUMMARIZE(Faturamentos, 'Produtos'[Cód. produto], 'Produtos'[Produto], 'Famílias'[Família]), " +
      '"Fat", [Faturamento]' + (comQt ? ', "Qt", [Faturamento (quantidade)]' : '') + '), ' + base.concat(predNota(raw)).join(', ') + ')';
  }
  // o pbiQuery da página devolve "HTTP 400: <100 caracteres do JSON>"
  function msgErro(e) {
    var s = String((e && e.message) || e || 'erro');
    var m = /"value"\s*:\s*"([^"]{8,})"/.exec(s);
    if (m) return m[1].slice(0, 160);
    var h = /^HTTP (\d+)/.exec(s);
    if (h) return 'o Power BI recusou a consulta (HTTP ' + h[1] + ')';
    return s.slice(0, 160);
  }
  // valor de uma coluna na linha devolvida: casa tabela+coluna; senão só a coluna
  function campo(r, colDax) {
    var alvo = colDax.replace(/'/g, '').toLowerCase(), nome = (/\[[^\]]+\]$/.exec(colDax) || [''])[0].toLowerCase();
    var ks = Object.keys(r || {}), k = null, i;
    for (i = 0; i < ks.length && k == null; i++) if (ks[i].replace(/'/g, '').toLowerCase() === alvo) k = ks[i];
    for (i = 0; i < ks.length && k == null; i++) if (ks[i].toLowerCase().slice(-nome.length) === nome) k = ks[i];
    return k == null ? null : r[k];
  }

  // ══════════════════════════════════════════════════════════════
  // LINHAS DO BI → NOTAS E QUEBRAS
  // ══════════════════════════════════════════════════════════════
  // linha = nota × família × … com o valor; a coluna que não veio fica null
  function lerLinhas(rows) {
    return (rows || []).map(function (r) {
      var nf = campo(r, COL.nf);
      return {
        nf: nf == null || String(nf).trim() === '' ? null : String(nf).trim(), raw: nf,
        cli: txt(campo(r, COL.cli)), est: txt(campo(r, COL.est)), fam: txt(campo(r, COL.fam)), vert: txt(campo(r, COL.vert)),
        uf: txt(campo(r, COL.uf)), fil: txt(campo(r, COL.fil)), emp: txt(campo(r, COL.emp)), vend: txt(campo(r, COL.vend)),
        data: isoDe(campo(r, COL.data)), v: num(campo(r, '[Fat]'))
      };
    }).filter(function (l) { return l.v !== 0; });     // combinação sem faturamento não é linha do dia
  }
  function somaEm(o, k, v) { if (k == null || k === '') return; o[k] = (o[k] || 0) + v; }
  function porValor(o) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }); }
  function totalDe(linhas) { return linhas.reduce(function (s, l) { return s + l.v; }, 0); }

  // uma por nota: o valor, quem comprou e o que a compõe (família · estratégia · vertical)
  function notasDe(linhas) {
    var m = new Map(), out = [];
    linhas.forEach(function (l) {
      var k = l.nf || '—', d = m.get(k);
      if (!d) { d = { id: k, raw: l.raw, v: 0, _cli: {}, _uf: {}, _emp: {}, _fil: {}, _vend: {}, _data: {}, _fam: {} }; m.set(k, d); out.push(d); }
      d.v += l.v;
      var a = Math.abs(l.v);
      somaEm(d._cli, l.cli, a); somaEm(d._uf, l.uf, a); somaEm(d._emp, l.emp, a); somaEm(d._fil, l.fil, a);
      somaEm(d._vend, l.vend, a); somaEm(d._data, l.data, a);
      var fk = [l.fam || '', l.est || '', l.vert || ''].join('\u0001');
      d._fam[fk] = (d._fam[fk] || 0) + l.v;
    });
    out.forEach(function (d) {
      d.cli = porValor(d._cli)[0] || null; d.uf = porValor(d._uf)[0] || null; d.emp = porValor(d._emp)[0] || null;
      d.fil = porValor(d._fil)[0] || null; d.vend = porValor(d._vend)[0] || null; d.data = porValor(d._data)[0] || null;
      d.fams = porValor(d._fam).map(function (k) { var p = k.split('\u0001'); return { fam: p[0] || null, est: p[1] || null, vert: p[2] || null, v: d._fam[k] }; });
      d.txt = norm([d.id, d.cli, d.uf, d.vend, d.fil, d.emp, d.fams.map(function (f) { return [f.fam, f.est, f.vert].join(' '); }).join(' ')].join(' '));
      delete d._cli; delete d._uf; delete d._emp; delete d._fil; delete d._vend; delete d._data; delete d._fam;
    });
    return out.sort(function (a, b) { return b.v - a.v; });
  }
  // quebra por uma dimensão: valor, nº de notas, a fatia e o "embaixo" de
  // cada linha (estratégia → famílias; família → estratégia; cliente → UF;
  // as outras → clientes)
  function agrupar(linhas, dim) {
    var m = new Map(), out = [], tot = totalDe(linhas);
    linhas.forEach(function (l) {
      var key = l[dim] == null ? null : l[dim], kk = key == null ? '\u0000' : key, g = m.get(kk);
      if (!g) { g = { k: key, v: 0, _nf: {}, _sub: {} }; m.set(kk, g); out.push(g); }
      g.v += l.v;
      if (l.nf) g._nf[l.nf] = 1;
      var sub = dim === 'est' ? l.fam : dim === 'fam' ? l.est : dim === 'cli' ? l.uf : l.cli;
      somaEm(g._sub, sub, Math.abs(l.v));
    });
    out.forEach(function (g) {
      g.n = Object.keys(g._nf).length; g.subs = porValor(g._sub); g.p = tot ? g.v / tot : 0;
      delete g._nf; delete g._sub;
    });
    return out.sort(function (a, b) { return b.v - a.v; });
  }
  function temDim(linhas, dim) { return linhas.some(function (l) { return l[dim] != null; }); }
  // filtro cruzado: só as linhas com aquele valor naquela dimensão
  function filtrarLinhas(linhas, sel) {
    if (!sel) return linhas;
    return linhas.filter(function (l) { return (l[sel.dim] == null ? null : l[sel.dim]) === sel.k; });
  }
  function buscarNotas(notas, busca) {
    var q = norm(busca).trim();
    if (!q) return notas;
    var ps = q.split(/\s+/);
    return notas.filter(function (d) { for (var i = 0; i < ps.length; i++) if (ps[i] && d.txt.indexOf(ps[i]) < 0) return false; return true; });
  }

  // ══════════════════════════════════════════════════════════════
  // O DIA NA SÉRIE DO GRÁFICO
  // ══════════════════════════════════════════════════════════════
  // posição do dia entre os dias com faturamento, a média deles, os vizinhos
  // (anterior / seguinte com faturamento) e o acumulado até o dia
  function contexto(serie, rotulo) {
    var labels = (serie && serie.labels) || [], vals = (serie && serie.valores) || [];
    var i = labels.indexOf(String(rotulo)), v = i >= 0 ? num(vals[i]) : 0;
    var fat = [], acum = 0, tot = 0;
    labels.forEach(function (l, j) { var x = num(vals[j]); tot += x; if (i >= 0 && j <= i) acum += x; if (x > 0) fat.push({ l: l, v: x, j: j }); });
    var soma = fat.reduce(function (s, x) { return s + x.v; }, 0), n = fat.length;
    var ant = null, prox = null;
    fat.forEach(function (x) { if (x.j < i) ant = x; if (x.j > i && !prox) prox = x; });
    return {
      i: i, v: v, n: n, media: n ? soma / n : null, tot: tot, acum: acum, ant: ant, prox: prox,
      rank: v > 0 ? 1 + fat.filter(function (x) { return x.v > v; }).length : null
    };
  }
  // ritmo da meta (período = um mês): acumulado até o dia contra os dias
  // úteis corridos, e quanto falta por dia útil
  function ritmo(P, ano, mes, dia, meta) {
    if (!ano || !mes || !(Number(meta) > 0) || !P || P.i < 0) return null;
    var u = diasUteis(Number(ano), Number(mes)), d = Number(dia);
    if (!u.length || !isFinite(d)) return null;
    var ate = u.filter(function (x) { return x <= d; }).length, restam = u.length - ate;
    var falta = Math.max(0, meta - P.acum);
    return {
      meta: Number(meta), uteis: u.length, ate: ate, restam: restam, acum: P.acum,
      porDia: meta / u.length, doDia: P.v / (meta / u.length),
      pm: P.acum / meta, pu: ate / u.length, falta: falta, precisa: restam > 0 ? falta / restam : null
    };
  }

  // ══════════════════════════════════════════════════════════════
  // DIAGNÓSTICO DO DIA — escrito a partir dos números
  // ══════════════════════════════════════════════════════════════
  // E = modelo(): { rotulo, iso, hoje, multi, total (a barra), soma (as
  // linhas), linhas, notas, grupos{est,fam,cli,emp}, pos, rit, mg, mpPer }
  // → { manchete, itens: [{ tom: bom|atencao|neutro, tt, ds }] }
  function pctAbs(r) { return Math.round(Math.abs(r) * 100) + '%'; }
  function nomeNota(n) { return 'NF ' + n.id + (n.cli ? ' (' + n.cli + ')' : ''); }
  function diagnostico(E) {
    var it = [], P = E.pos || {}, tot = E.total, soma = E.soma;
    var forca = null, conc = null, puxou = null;

    if (!E.linhas.length) {
      var ds0 = 'Nenhuma nota fiscal deste dia entra no faturamento do relatório' + (E.iso ? '' : ' no período') + '.';
      if (E.iso) { var w0 = new Date(E.iso + 'T12:00:00').getDay(); if (w0 === 0 || w0 === 6) ds0 += ' O dia caiu num ' + DSEM[w0] + '.'; }
      if (P.ant) ds0 += ' O dia anterior com faturamento foi o dia ' + P.ant.l + ' (' + fMi(P.ant.v) + ').';
      return { manchete: 'Sem faturamento neste dia.', itens: [{ tom: 'neutro', tt: 'Nenhuma nota no dia', ds: ds0 }] };
    }

    // 1. força: o dia contra a média dos dias com faturamento
    if (P.media && P.n > 1 && tot > 0) {
      // faixas: ±10% é a média; até ±25% acima/abaixo; além disso forte/fraco
      var r = tot / P.media - 1;
      var rot = r >= 0.25 ? 'Dia forte' : r >= 0.1 ? 'Dia acima da média' : r <= -0.25 ? 'Dia fraco' : r <= -0.1 ? 'Dia abaixo da média' : 'Dia na média';
      var ds = fMi(tot) + (Math.abs(r) < 0.005 ? ', igual à' : ', ' + pctAbs(r) + (r > 0 ? ' acima da' : ' abaixo da')) +
        ' média dos ' + P.n + ' dias com faturamento no período (' + fMi(P.media) + ').';
      ds += P.rank === 1 ? ' É o maior dia do período.' : P.rank === P.n ? ' É o menor dos ' + P.n + '.' : ' É o ' + P.rank + 'º maior de ' + P.n + '.';
      if (P.ant) { var dv = tot - P.ant.v; ds += ' Contra o dia ' + P.ant.l + ' (' + fMi(P.ant.v) + '): ' + fMiS(dv) + ' (' + fVar(P.ant.v ? dv / P.ant.v : null) + ').'; }
      it.push({ tom: r >= 0.1 ? 'bom' : r <= -0.25 ? 'atencao' : 'neutro', tt: rot, ds: ds });
      forca = Math.abs(r) < 0.1 ? rot : rot + ' (' + fVar(r) + ' vs a média)';
    } else if (P.n === 1 && tot > 0) {
      it.push({ tom: 'neutro', tt: 'Único dia com faturamento', ds: 'É o único dia com faturamento no período até aqui — ainda não há média para comparar.' });
    } else if (tot <= 0) {
      it.push({ tom: 'atencao', tt: 'Dia negativo', ds: 'O dia fecha em ' + fBRL(tot) + ': as devoluções e estornos passaram o faturado.' });
    }

    // 2. ritmo da meta (período = um mês com meta)
    var R = E.rit;
    if (R) {
      var tt2, tom2, ds2;
      var base2 = 'Até o dia ' + E.rotulo + ' o mês soma ' + fMi(R.acum) + ' — ' + pctAbs(R.pm) + ' da meta de ' + fMi(R.meta);
      if (R.pm >= 1) { tt2 = 'Meta do mês batida'; tom2 = 'bom'; ds2 = base2 + '.'; }
      else {
        var atras = R.pu - R.pm;
        tt2 = atras <= 0 ? 'À frente do ritmo da meta' : atras > 0.05 ? 'Atrás do ritmo da meta' : 'Perto do ritmo da meta';
        tom2 = atras <= 0 ? 'bom' : atras > 0.05 ? 'atencao' : 'neutro';
        ds2 = base2 + ', com ' + R.ate + ' de ' + R.uteis + ' dias úteis (' + pctAbs(R.pu) + ') corridos.';
        ds2 += R.restam > 0
          ? ' Faltam ' + fMi(R.falta) + ': ' + fMi(R.precisa) + ' por dia útil nos ' + R.restam + ' que restam' + (tot > 0 ? ' — este dia fez ' + fMi(tot) + '.' : '.')
          : ' Não há mais dias úteis no mês: faltam ' + fMi(R.falta) + '.';
      }
      it.push({ tom: tom2, tt: tt2, ds: ds2 });
    }

    // 3. concentração: as maiores notas
    var N = E.notas, nN = N.length, nCli = E.grupos.cli.filter(function (g) { return g.k != null; }).length;
    if (soma > 0 && nN === 1) {
      it.push({ tom: 'atencao', tt: 'Uma nota só', ds: 'Todo o faturamento do dia veio da ' + nomeNota(N[0]) + ': ' + fBRL(N[0].v) + '.' });
      conc = 'numa nota só';
    } else if (soma > 0 && nN > 1) {
      var t1 = N[0].v / soma, k3 = Math.min(3, nN), t3 = N.slice(0, k3).reduce(function (s, n) { return s + n.v; }, 0) / soma;
      var maiores = (nN <= 3 ? 'O dia tem só ' + plural(nN, 'nota', 'notas') : 'As ' + k3 + ' maiores notas fazem ' + pctAbs(t3) + ' do dia') +
        '; a maior, ' + nomeNota(N[0]) + ', sozinha ' + pctAbs(t1) + '.';
      if ((nN >= 3 && t3 >= 0.6) || t1 >= 0.4) {
        it.push({ tom: 'atencao', tt: 'Dia concentrado', ds: maiores + (nN > 3 ? ' ' + plural(nN, 'nota', 'notas') + ' para ' + plural(nCli, 'cliente', 'clientes') + ' no dia.' : '') });
        conc = 'concentrado em poucas notas';
      } else if (nN >= 8 && t1 <= 0.15) {
        it.push({ tom: 'bom', tt: 'Dia pulverizado', ds: plural(nN, 'nota', 'notas') + ' para ' + plural(nCli, 'cliente', 'clientes') + '; a maior, ' + nomeNota(N[0]) + ', pesa só ' + pctAbs(t1) + ' do dia.' });
        conc = 'pulverizado';
      } else {
        it.push({ tom: 'neutro', tt: 'Concentração moderada', ds: maiores + (nN > 3 ? ' ' + plural(nN, 'nota', 'notas') + ' para ' + plural(nCli, 'cliente', 'clientes') + ' no dia.' : '') });
      }
    }

    // 4. o cliente que mais pesou
    var c0 = E.grupos.cli[0];
    if (soma > 0 && nN > 1 && c0 && c0.k != null) {
      if (nCli === 1) it.push({ tom: 'atencao', tt: 'Um cliente só', ds: 'Todas as ' + plural(nN, 'nota', 'notas') + ' do dia são de ' + c0.k + '.' });
      else if (c0.p >= 0.3) it.push({ tom: 'atencao', tt: 'Peso de um cliente', ds: c0.k + ' fez ' + pctAbs(c0.p) + ' do dia (' + fMi(c0.v) + ' em ' + plural(c0.n, 'nota', 'notas') + ').' });
      else {
        var c3 = E.grupos.cli.slice(0, 3).reduce(function (s, g) { return s + g.v; }, 0) / soma;
        it.push({ tom: 'neutro', tt: 'Maior cliente', ds: c0.k + ': ' + fMi(c0.v) + ' (' + pctAbs(c0.p) + ') em ' + plural(c0.n, 'nota', 'notas') + '. Os 3 maiores clientes somam ' + pctAbs(c3) + ' do dia.' });
      }
    }

    // 5. o que puxou: estratégia, família, empresa
    var ests = (E.grupos.est || []).filter(function (g) { return g.k != null; }), fams = E.grupos.fam.filter(function (g) { return g.k != null; });
    var partes = [];
    if (soma > 0 && ests.length) {
      partes.push('A estratégia ' + ests[0].k + ' puxou o dia: ' + fMi(ests[0].v) + ' (' + pctAbs(ests[0].p) + ')' +
        (ests[1] ? ', seguida de ' + ests[1].k + ' (' + pctAbs(ests[1].p) + ')' : '') + '.');
      puxou = ests[0].k;
    }
    if (soma > 0 && fams.length) partes.push('Família de maior valor: ' + fams[0].k + ' (' + fMi(fams[0].v) + ', ' + pctAbs(fams[0].p) + ').');
    if (fams.length) partes.push(plural(fams.length, 'família', 'famílias') + (ests.length ? ' de ' + plural(ests.length, 'estratégia', 'estratégias') : '') + ' no dia.');
    var emps = (E.grupos.emp || []).filter(function (g) { return g.k != null; });
    if (soma > 0 && emps.length > 1) partes.push(emps.map(function (g) { return g.k + ' ' + fMi(g.v) + ' (' + pctAbs(g.p) + ')'; }).join(' · ') + '.');
    if (partes.length) it.push({ tom: 'neutro', tt: 'O que puxou o dia', ds: partes.join(' ') });

    // 6. margem do dia contra a do período
    if (E.mg && E.mg.mp != null) {
      var mp = E.mg.mp, per = E.mpPer;
      if (per != null) {
        var dm = mp - per;
        it.push({ tom: dm <= -0.02 ? 'atencao' : dm >= 0.02 ? 'bom' : 'neutro',
          tt: dm <= -0.02 ? 'Margem abaixo do período' : dm >= 0.02 ? 'Margem acima do período' : 'Margem em linha com o período',
          ds: 'Margem de contribuição do dia: ' + fPct1(mp) + ', contra ' + fPct1(per) + ' no período (' + fPP(dm) + ').' });
      } else it.push({ tom: 'neutro', tt: 'Margem do dia', ds: 'Margem de contribuição do dia: ' + fPct1(mp) + '.' });
    }

    // 7. valores negativos (devolução, estorno, ajuste)
    var neg = E.linhas.filter(function (l) { return l.v < 0; });
    if (neg.length) {
      var nfNeg = {}; neg.forEach(function (l) { nfNeg[l.nf || '—'] = 1; });
      it.push({ tom: 'atencao', tt: 'Valores negativos', ds: plural(neg.length, 'linha negativa', 'linhas negativas') + ' (em ' + plural(Object.keys(nfNeg).length, 'nota', 'notas') + ') ' +
        (neg.length === 1 ? 'soma' : 'somam') + ' −' + fBRL(Math.abs(totalDe(neg))) + ' e ' + (neg.length === 1 ? 'abate' : 'abatem') + ' o dia — devolução, estorno ou ajuste.' });
    }

    // 8. calendário
    if (E.iso) {
      var w = new Date(E.iso + 'T12:00:00').getDay();
      if (w === 0 || w === 6) it.push({ tom: 'neutro', tt: 'Fim de semana', ds: 'O dia caiu num ' + DSEM[w] + ' — fora dos dias úteis do ritmo da meta.' });
      if (E.hoje) it.push({ tom: 'neutro', tt: 'Dia em andamento', ds: 'É hoje: o DW atualiza ao longo do dia e estes números ainda mudam.' });
    }
    if (E.multi) {
      var datas = agrupar(E.linhas, 'data').filter(function (g) { return g.k != null; });
      it.push({ tom: 'neutro', tt: 'Vários meses no mesmo dia', ds: 'Com mais de um mês no período, o dia ' + E.rotulo + ' junta o dia ' + E.rotulo + ' de cada mês' +
        (datas.length ? ' (' + plural(datas.length, 'data', 'datas') + '); a que mais pesou foi ' + fData(datas[0].k) + ' (' + fMi(datas[0].v) + ', ' + pctAbs(datas[0].p) + ').' : ' — igual à barra do gráfico.') });
    }

    var resto = [];
    if (puxou) resto.push('puxado por ' + puxou);
    if (conc) resto.push(conc);
    var manchete = (forca || (fMi(tot) + ' faturados')) + (resto.length ? ', ' + resto.join(' e ') : '') + '.';
    return { manchete: manchete, itens: it };
  }

  // tudo o que a ficha pinta e o diagnóstico lê, a partir das linhas
  // c = o contexto da página ({ mes, ano, resumo }); mg = a margem do dia
  function modelo(rotulo, linhas, serie, c, mg) {
    c = c || {};
    var P = contexto(serie, rotulo);
    var iso = c.mes && c.ano ? isoDia(c.ano, c.mes, rotulo) : null;
    var grupos = { est: agrupar(linhas, 'est'), fam: agrupar(linhas, 'fam'), cli: agrupar(linhas, 'cli'), emp: agrupar(linhas, 'emp') };
    var meta = c.resumo && c.resumo.meta != null ? Number(c.resumo.meta) : null;
    var E = {
      rotulo: String(rotulo), iso: iso, hoje: !!iso && iso === hojeISO(), multi: !(c.mes && c.ano),
      total: P.i >= 0 ? P.v : totalDe(linhas), soma: totalDe(linhas), linhas: linhas, notas: notasDe(linhas), grupos: grupos, pos: P,
      rit: c.mes && c.ano ? ritmo(P, c.ano, c.mes, rotulo, meta) : null,
      mg: mg || null, mpPer: c.resumo && c.resumo.margemPct != null ? Number(c.resumo.margemPct) : null
    };
    E.diag = diagnostico(E);
    return E;
  }

  // ── Excel: as linhas, uma por nota e o diagnóstico ──────────────
  function planilhas(E, rotuloDia) {
    var linhas = [['Data', 'Dia', 'Nota fiscal', 'Cliente', 'UF', 'Estratégia', 'Família', 'Sales Vertical', 'Filial', 'Empresa', 'Vendedor', 'Faturamento']];
    E.linhas.slice().sort(function (a, b) { return b.v - a.v; }).forEach(function (l) {
      linhas.push([l.data ? fData(l.data) : (E.iso ? fData(E.iso) : ''), Number(E.rotulo) || E.rotulo, l.nf || '', l.cli || '', l.uf || '', l.est || '', l.fam || '',
        l.vert || '', l.fil || '', l.emp || '', l.vend || '', Math.round(l.v * 100) / 100]);
    });
    var notas = [['Nota fiscal', 'Data', 'Cliente', 'UF', 'Vendedor', 'Filial', 'Empresa', 'Famílias', 'Estratégias', 'Faturamento', '% do dia']];
    E.notas.forEach(function (n) {
      var ests = []; n.fams.forEach(function (f) { if (f.est && ests.indexOf(f.est) < 0) ests.push(f.est); });
      notas.push([n.id, n.data ? fData(n.data) : (E.iso ? fData(E.iso) : ''), n.cli || '', n.uf || '', n.vend || '', n.fil || '', n.emp || '',
        n.fams.map(function (f) { return f.fam || '—'; }).join(' · '), ests.join(' · '), Math.round(n.v * 100) / 100, E.soma ? Math.round(n.v / E.soma * 10000) / 10000 : '']);
    });
    var diag = [['Faturamento do dia', rotuloDia], ['Resumo', E.diag.manchete], []].concat([['Ponto', 'Leitura', 'Tom']]).concat(
      E.diag.itens.map(function (i) { return [i.tt, i.ds, i.tom === 'bom' ? 'positivo' : i.tom === 'atencao' ? 'atenção' : 'neutro']; }));
    return { linhas: linhas, notas: notas, diag: diag };
  }

  // ── pedaços de HTML sem DOM (o desenho daqui e o da ficha do mês) ──
  function kp(k, v, s, cls, vcls, scls) {
    return '<div class="sd-dw-kp' + (cls ? ' ' + cls : '') + '"><div class="k">' + esc(k) + '</div><div class="v' + (vcls ? ' ' + vcls : '') + '">' + v + '</div>' +
      (s ? '<div class="s' + (scls ? ' ' + scls : '') + '">' + s + '</div>' : '') + '</div>';
  }
  function rotuloDia(rotulo, iso) { return iso ? fData(iso) + ' · ' + diaSem(iso, true) : 'Dia ' + rotulo; }

  // ── núcleo puro: no Node (teste) o arquivo para aqui ────────────
  // (a ficha do mês, sr-mes.js, usa o mesmo núcleo: SRDia.core no navegador)
  var CORE = {
    COL: COL, NIVEIS: NIVEIS, MED_MG: MED_MG, PASSO: PASSO, TOPN: TOPN, OUTRAS: OUTRAS, QUEBRAS: QUEBRAS, DSEM: DSEM,
    predDia: predDia, predNota: predNota, daxDia: daxDia, daxMargem: daxMargem, daxItens: daxItens, msgErro: msgErro, campo: campo,
    lerLinhas: lerLinhas, notasDe: notasDe, agrupar: agrupar, filtrarLinhas: filtrarLinhas, buscarNotas: buscarNotas, totalDe: totalDe, temDim: temDim,
    contexto: contexto, ritmo: ritmo, diagnostico: diagnostico, modelo: modelo, planilhas: planilhas,
    isoDia: isoDia, isoDe: isoDe, diasUteis: diasUteis, hojeISO: hojeISO, fData: fData, diaSem: diaSem,
    fMi: fMi, fMiS: fMiS, fBRL: fBRL, fBRLp: fBRLp, fInt: fInt, fPct: fPct, fVar: fVar, fPct1: fPct1, fPP: fPP, plural: plural,
    pctAbs: pctAbs, nomeNota: nomeNota, num: num, numOu: numOu, esc: esc, kp: kp, rotuloDia: rotuloDia
  };
  if (typeof module === 'object' && module.exports) { module.exports = CORE; return; }

  if (root.SRDia) return;
  var D = root.document;
  // memória de OLS do freio (pbi-throttle.js): a margem que o usuário não vê
  // nem entra na consulta
  var OLSM = (root.PBIQ && root.PBIQ.ols) || { vivas: function (l) { return l; }, aprender: function () { }, leque: function () { return true; } };
  var IC_X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var IC_ANT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
  var IC_PROX = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
  var IC_XLS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  var IC_BUSCA = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  var IC_SETA = '<svg class="sdd-car" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
  var FICHAS = [];                // as fichas montadas (dia, mês): abrir uma fecha as outras

  function carregandoH(t) { return '<div class="sd-dw-load"><span class="sd-spin"></span>' + esc(t) + '</div>'; }
  function erroH(t, e, acao, id) {
    return '<div class="sd-dw-err"><span>' + esc(t) + ': <b>' + esc(e) + '</b></span><button type="button" data-sdd="' + acao + '"' + (id != null ? ' data-id="' + esc(id) + '"' : '') + '>Tentar de novo</button></div>';
  }
  function nomeDe(dim, k) {
    if (k == null) return QUEBRAS[dim][2];
    if (dim === 'data') return fData(k) + ' · ' + diaSem(k);
    return k;
  }

  // ══════════════════════════════════════════════════════════════
  // A FICHA — o motor comum à do DIA (aqui, embaixo) e à do MÊS (sr-mes.js)
  // K = o que é de cada uma:
  //   id ('sdd' → ids sdd-tt, sdd-body…), chave ('dia' no estado()),
  //   t = textos { un, doUn, uns, ant, prox, xls },
  //   base(c, serie, rot)            → filtro-base + o predicado do dia/mês
  //   modelo(rot, linhas, serie, c, mg) → E (com E.diag, E.notas, E.grupos…)
  //   cab(rot, c, P, E, serie)       → { k, tt, sub, tags: [html] }
  //   kpis(P, E, c, rot, serie)      → html dos números-chave
  //   comoConta(rot, c, nivel)       → html do "Como conta"
  //   mostraData(E)                  → a quebra Data entra nas outras?
  //   posicao(P, rot, c, serie)      → (opcional) a posição no rodapé ("2º de 10 dias")
  //   margem(base, meds, c) → DAX · lerMargem(linha) → { mp, mn, … }
  //   nome(rot, c), abas(E, nome) → [[aba, linhas]], arquivo(rot, c) → o Excel
  // ══════════════════════════════════════════════════════════════
  function ficha(K) {
    var T = K.t;
    var S = { serie: null, ctx: null, rot: null, sel: null, quebra: null, busca: '', lim: PASSO, aberta: null, todos: {}, volta: null, E: null, vistas: [] };
    var CACHE = new Map();          // rótulo|filtros → { st, linhas, nivel, em, erro, mg }
    var ITENS = new Map();          // nota|filtros → { st, rows, erro }
    var NIVEL = 0;                  // o nível de colunas que o modelo aceitou da última vez
    var EL = null, OV = null, EU = null;

    function no(s) { return EL ? EL.querySelector('#' + K.id + '-' + s) : null; }
    function setTxt(s, t) { var e = no(s); if (e) e.textContent = t; }
    function setHTML(s, h) { var e = no(s); if (e) e.innerHTML = h; }

    function montar() {
      if (EL) return;
      var p = K.id + '-';
      OV = D.createElement('div'); OV.className = 'sd-dw-ov sdd-ov';
      EL = D.createElement('aside'); EL.className = 'sd-dw sdd' + (K.id !== 'sdd' ? ' ' + K.id : '');
      EL.setAttribute('role', 'dialog'); EL.setAttribute('aria-modal', 'true'); EL.setAttribute('aria-labelledby', p + 'tt');
      EL.innerHTML =
          '<div class="sd-dw-head">'
        +   '<div class="sd-dw-hl"><div class="sd-dw-k" id="' + p + 'k"></div><h2 class="sd-dw-tt" id="' + p + 'tt"></h2>'
        +   '<div class="sd-dw-sub" id="' + p + 'sub"></div><div class="sd-dw-tags" id="' + p + 'tags"></div></div>'
        +   '<div class="sd-dw-nav">'
        +     '<button type="button" class="sd-dw-pn" data-sdd="ant" aria-label="' + esc(T.ant) + '" title="' + esc(T.ant) + ' (←)">' + IC_ANT + '</button>'
        +     '<button type="button" class="sd-dw-pn" data-sdd="prox" aria-label="' + esc(T.prox) + '" title="' + esc(T.prox) + ' (→)">' + IC_PROX + '</button>'
        +     '<button type="button" class="sd-dw-x" data-sdd="fechar" aria-label="Fechar a ficha ' + esc(T.doUn) + '" title="Fechar (Esc)">' + IC_X + '</button>'
        +   '</div>'
        + '</div>'
        + '<div class="sd-dw-body" id="' + p + 'body"></div>'
        + '<div class="sd-dw-foot"><button type="button" class="sd-dw-cp" data-sdd="xlsx">' + IC_XLS + '<span id="' + p + 'xlt">' + esc(T.xls) + '</span></button>'
        +   '<span class="sd-dw-lido" id="' + p + 'lido"></span><button type="button" class="sd-dw-btn" data-sdd="fechar">Fechar</button></div>';
      D.body.appendChild(OV); D.body.appendChild(EL);
      OV.addEventListener('click', fechar);
      EL.addEventListener('click', clique);
      var tb = null;
      EL.addEventListener('input', function (e) {
        var t = e.target; if (!t || !t.matches || !t.matches('.sdd-busca input')) return;
        clearTimeout(tb);
        tb = setTimeout(function () { S.busca = t.value; S.lim = PASSO; pintarNotas(); }, 160);
      });
      D.addEventListener('keydown', function (e) {
        if (!EL.classList.contains('open')) return;
        if (e.key === 'Escape') { e.preventDefault(); fechar(); return; }
        if (e.key === 'Tab') { prender(e); return; }
        var t = e.target, digitando = t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
        if (!digitando && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); andar(e.key === 'ArrowLeft' ? -1 : 1); }
      });
    }
    // o foco não sai da ficha enquanto ela está aberta
    function prender(e) {
      var fs = Array.prototype.filter.call(EL.querySelectorAll('button, a[href], input, summary, [tabindex]:not([tabindex="-1"])'), function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!fs.length) return;
      var a = fs[0], z = fs[fs.length - 1];
      if (e.shiftKey && (D.activeElement === a || !EL.contains(D.activeElement))) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && (D.activeElement === z || !EL.contains(D.activeElement))) { e.preventDefault(); a.focus(); }
    }
    function clique(e) {
      var t = e.target; if (!t || !t.closest) return;
      var b = t.closest('[data-sdd]');
      if (b) {
        var a = b.getAttribute('data-sdd');
        if (a === 'fechar') fechar();
        else if (a === 'ant') andar(-1);
        else if (a === 'prox') andar(1);
        else if (a === 'xlsx') exportar();
        else if (a === 'limpar') { S.sel = null; S.lim = PASSO; pintar(true); }
        else if (a === 'tentar') { var ent = entrada(S.rot); ent.st = null; carregar(S.rot); }
        else if (a === 'todos') { var qq = b.getAttribute('data-q'); S.todos[qq] = !S.todos[qq]; pintar(true); }
        else if (a === 'mais') { S.lim += PASSO; pintarNotas(); }
        else if (a === 'itens') { var k = chaveItens(b.getAttribute('data-id')); ITENS.delete(k); carregarItens(b.getAttribute('data-id')); }
        return;
      }
      var s = t.closest('[data-sdd-sel]');
      if (s) {
        var dim = s.getAttribute('data-sdd-sel'), kk = s.getAttribute('data-k');
        var val = kk === '' ? null : kk;
        S.sel = S.sel && S.sel.dim === dim && S.sel.k === val ? null : { dim: dim, k: val };
        S.lim = PASSO; S.aberta = null;
        pintar(true); return;
      }
      var qb = t.closest('[data-sdd-q]');
      if (qb) { S.quebra = qb.getAttribute('data-sdd-q'); pintar(true); return; }
      var nf = t.closest('[data-sdd-nf]');
      if (nf) { var id = nf.getAttribute('data-sdd-nf'); S.aberta = S.aberta === id ? null : id; pintarNotas(); if (S.aberta) carregarItens(id); }
    }

    function abrir(rotulo, origem) {
      if (!S.serie || rotulo == null) return;
      rotulo = String(rotulo);
      if (S.serie.labels.indexOf(rotulo) < 0) return;
      montar();
      // uma ficha de cada vez: a do pedido/nota (sr-diario.js) e a outra (dia/mês) fecham
      if (root.SRDiario && root.SRDiario.fechar) { try { root.SRDiario.fechar(); } catch (e) { } }
      FICHAS.forEach(function (f) { if (f !== EU) { try { f.fechar(); } catch (e) { } } });
      if (!EL.classList.contains('open')) S.volta = origem || D.activeElement;
      OV.classList.add('open'); EL.classList.add('open');
      D.documentElement.classList.add('sd-dw-on');
      ir(rotulo);
      setTimeout(function () { try { EL.querySelector('.sd-dw-x').focus(); } catch (e) { } }, 40);
    }
    function ir(rotulo) {
      S.rot = rotulo; S.sel = null; S.busca = ''; S.lim = PASSO; S.aberta = null; S.todos = {};
      marcar(rotulo);
      pintar();
      no('body').scrollTop = 0;
      carregar(rotulo);
    }
    function fechar() {
      if (!EL || !EL.classList.contains('open')) return;
      EL.classList.remove('open'); OV.classList.remove('open');
      D.documentElement.classList.remove('sd-dw-on');
      S.rot = null; S.E = null;
      marcar(null);
      var f = S.volta; S.volta = null;
      if (f && f.focus) { try { f.focus(); } catch (e) { } }
    }
    function andar(dir) {
      if (S.rot == null) return;
      var P = contexto(S.serie, S.rot), alvo = dir < 0 ? P.ant : P.prox;
      if (alvo) ir(alvo.l);
    }
    function marcar(rotulo) { var c = S.ctx; if (c && typeof c.marcar === 'function') { try { c.marcar(rotulo); } catch (e) { } } }

    // ── leitura no Power BI ───────────────────────────────────────
    function q() {
      var c = S.ctx, fn = (c && c.query) || (root.PBIData && root.PBIData.query);
      return fn || function () { return Promise.reject(new Error('Power BI ainda não conectado')); };
    }
    function baseDe(rotulo) { return K.base(S.ctx || {}, S.serie, String(rotulo)); }
    function entrada(rotulo) {
      var k = rotulo + '|' + baseDe(rotulo).join('&'), e = CACHE.get(k);
      if (!e) { e = { st: null }; CACHE.set(k, e); if (CACHE.size > 60) CACHE.delete(CACHE.keys().next().value); }
      return e;
    }
    function carregar(rotulo) {
      var ent = entrada(rotulo);
      var pinta = function () { if (S.rot === rotulo) pintar(true); };
      if (ent.st === 'ok' || ent.st === 'carregando') return;
      // barra zerada: não houve nota (nada a perguntar ao Power BI)
      if (contexto(S.serie, rotulo).v === 0) { ent.st = 'ok'; ent.linhas = []; ent.nivel = NIVEL; ent.em = new Date(); pinta(); return; }
      var fn = q(), base = baseDe(rotulo);
      ent.st = 'carregando'; ent.mg = null; pinta();
      var tenta = function (nv) {
        fn(daxDia(base, nv)).then(function (rows) {
          ent.st = 'ok'; ent.linhas = lerLinhas(rows); ent.nivel = nv; ent.em = new Date(); pinta();
        }, function (e) {
          if (nv + 1 < NIVEIS.length && OLSM.leque(e)) {
            // recusa do MODELO (coluna fora / OLS) vale para os próximos;
            // erro de momento (5xx, tempo) não rebaixa o nível
            if (!/HTTP 5\d\d|time ?out|abort/i.test(String(e && e.message))) NIVEL = Math.max(NIVEL, nv + 1);
            tenta(nv + 1);
          } else { ent.st = 'erro'; ent.erro = msgErro(e); pinta(); }
        });
      };
      tenta(NIVEL);
      // a margem é extra: quem não a vê (OLS) não perde a ficha
      var meds = OLSM.vivas(MED_MG, function (m) { return m[1]; });
      if (meds.length) {
        fn(K.margem(base, meds, S.ctx || {})).then(function (rows) {
          ent.mg = K.lerMargem(rows && rows[0]); pinta();
        }, function () { ent.mg = { erro: true }; });
      }
    }
    function chaveItens(id) { return id + '|' + baseDe(S.rot).join('&'); }
    function carregarItens(id) {
      var k = chaveItens(id), it = ITENS.get(k);
      if (it && (it.st === 'ok' || it.st === 'carregando')) return;
      var n = null; (S.E ? S.E.notas : []).forEach(function (x) { if (x.id === id) n = x; });
      if (!n || n.id === '—') return;
      var fn = q(), base = baseDe(S.rot), rot = S.rot;
      it = { st: 'carregando' }; ITENS.set(k, it);
      if (ITENS.size > 200) ITENS.delete(ITENS.keys().next().value);
      var pinta = function () { if (S.rot === rot && S.aberta === id) pintarNotas(); };
      var achou = function (rows) {
        it.st = 'ok';
        it.rows = (rows || []).map(function (r) {
          return { cod: campo(r, "'Produtos'[Cód. produto]"), prod: campo(r, "'Produtos'[Produto]"), fam: campo(r, "'Famílias'[Família]"),
            v: num(campo(r, '[Fat]')), qt: numOu(campo(r, '[Qt]')) };
        }).filter(function (o) { return o.prod != null || o.cod != null || o.v; }).sort(function (a, b) { return b.v - a.v; });
        pinta();
      };
      var falhou = function (e) { it.st = 'erro'; it.erro = msgErro(e); pinta(); };
      // a medida de quantidade pode não existir: sem ela, o resto
      fn(daxItens(base, n.raw, true)).then(achou, function () { fn(daxItens(base, n.raw, false)).then(achou, falhou); });
      pinta();
    }

    // ── desenho ───────────────────────────────────────────────────
    // keep = mantém a rolagem (filtro, aba, "ver todas")
    function pintar(keep) {
      if (!EL || S.rot == null) return;
      var body = no('body'), top = keep ? body.scrollTop : 0;
      var rot = S.rot, c = S.ctx || {}, ent = entrada(rot), P = contexto(S.serie, rot);
      var ok = ent.st === 'ok';
      var E = ok ? K.modelo(rot, ent.linhas, S.serie, c, ent.mg && !ent.mg.erro ? ent.mg : null) : null;
      S.E = E;

      var cab = K.cab(rot, c, P, E, S.serie);
      setTxt('k', cab.k); setTxt('tt', cab.tt); setTxt('sub', cab.sub); setHTML('tags', (cab.tags || []).join(''));
      EL.querySelector('[data-sdd="ant"]').disabled = !P.ant;
      EL.querySelector('[data-sdd="prox"]').disabled = !P.prox;
      EL.querySelector('[data-sdd="xlsx"]').disabled = !(E && E.linhas.length);
      var pos = K.posicao ? K.posicao(P, rot, c, S.serie) : (P.n ? (P.v > 0 ? P.rank + 'º de ' + P.n + ' ' + T.uns : P.n + ' ' + T.uns + ' com faturamento') : '');
      setTxt('lido', ent.em ? 'lido às ' + ent.em.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + (pos ? ' · ' + pos : '') : '');

      var h = K.kpis(P, E, c, rot, S.serie);
      if (!ok) {
        h += ent.st === 'erro'
          ? '<section class="sd-dw-card"><h5>O que foi faturado</h5>' + erroH('Não deu para ler o ' + T.un, ent.erro, 'tentar') + '</section>'
          : '<section class="sd-dw-card"><h5>Diagnóstico ' + esc(T.doUn) + '</h5>' + carregandoH('Lendo as notas ' + T.doUn + ' no Power BI…') + '</section>';
        h += K.comoConta(rot, c, null);
        body.innerHTML = h; body.scrollTop = top; return;
      }
      h += secDiag(E);
      if (!E.linhas.length) { h += K.comoConta(rot, c, ent.nivel); body.innerHTML = h; body.scrollTop = top; return; }

      // filtro cruzado: as quebras (menos a da própria seleção) e as notas
      // olham só as linhas escolhidas; o diagnóstico fica no todo
      var sel = S.sel, LF = filtrarLinhas(E.linhas, sel);
      var g = function (dim) { return agrupar(sel && sel.dim !== dim ? LF : E.linhas, dim); };
      if (sel) {
        var sv = totalDe(LF);
        h += '<div class="sdd-fxbar" role="status"><span>Filtrando por <b>' + esc(QUEBRAS[sel.dim][0] + ': ' + nomeDe(sel.dim, sel.k)) + '</b> · ' + esc(fMi(sv)) +
          ' (' + esc(fPct(E.soma ? sv / E.soma : null) + ' ' + T.doUn) + ')</span><button type="button" data-sdd="limpar">✕ limpar</button></div>';
      }
      if (temDim(E.linhas, 'est')) h += secQuebra('est', g('est'), 'Por estratégia');
      h += secQuebra('fam', g('fam'), 'Por família');
      h += secQuebra('cli', g('cli'), 'Por cliente');
      var dims = OUTRAS.filter(function (d) { return d === 'data' ? K.mostraData(E) && temDim(E.linhas, 'data') : temDim(E.linhas, d); });
      if (dims.length) {
        if (dims.indexOf(S.quebra) < 0) S.quebra = dims[0];
        h += secQuebra(S.quebra, g(S.quebra), 'Outras quebras', dims);
      }
      S.vistas = notasDe(LF);
      var p = K.id + '-';
      h += '<section class="sd-dw-card" id="' + p + 'nfs-card"><h5>Notas fiscais <small id="' + p + 'nfs-n"></small></h5>'
        + '<div class="sdd-bar"><label class="sdd-busca">' + IC_BUSCA + '<input type="search" placeholder="Buscar nota, cliente, família, vendedor…" autocomplete="off" aria-label="Buscar nas notas ' + esc(T.doUn) + '" value="' + esc(S.busca) + '"></label>'
        + '<span class="sdd-info" id="' + p + 'nfs-info"></span></div><div class="sdd-nfs" id="' + p + 'nfs"></div></section>';
      h += K.comoConta(rot, c, ent.nivel);
      body.innerHTML = h;
      pintarNotas();
      body.scrollTop = top;
    }

    function secDiag(E) {
      var d = E.diag;
      return '<section class="sd-dw-card sdd-diag"><h5>Diagnóstico ' + esc(T.doUn) + '</h5><p class="sdd-man">' + esc(d.manchete) + '</p><ul class="sdd-dg">' +
        d.itens.map(function (i) {
          return '<li class="' + i.tom + '"><span class="dot" aria-hidden="true"></span><div><b>' + esc(i.tt) + '</b><span>' + esc(i.ds) + '</span></div></li>';
        }).join('') + '</ul></section>';
    }

    // uma quebra: linhas clicáveis (filtro cruzado); abas = as outras quebras
    function secQuebra(dim, grupos, titulo, abas) {
      var todos = !!S.todos[dim], lista = todos ? grupos : grupos.slice(0, TOPN);
      var outra = S.sel && S.sel.dim !== dim;
      var h = '<section class="sd-dw-card sdd-q"><h5>' + esc(titulo) + ' <small>' + esc(fInt(grupos.length)) + '</small>' + (outra ? '<em>no filtro</em>' : '') + '</h5>';
      if (abas) {
        h += '<div class="sdd-tabs" role="group" aria-label="Escolher a quebra">' + abas.map(function (d) {
          var on = d === dim;
          return '<button type="button" data-sdd-q="' + d + '" aria-pressed="' + on + '"' + (on ? ' class="on"' : '') + '>' + esc(QUEBRAS[d][0]) + '</button>';
        }).join('') + '</div>';
      }
      if (!grupos.length) return h + '<div class="sd-dw-nada">Nada neste recorte.</div></section>';
      h += '<div class="sdd-rows">' + lista.map(function (gr) {
        var on = !!S.sel && S.sel.dim === dim && S.sel.k === gr.k, nome = nomeDe(dim, gr.k);
        var sub;
        if (dim === 'est') sub = plural(gr.n, 'nota', 'notas') + ' · ' + plural(gr.subs.length, 'família', 'famílias');
        else if (dim === 'fam') sub = [gr.subs[0] || null, plural(gr.n, 'nota', 'notas')].filter(Boolean).join(' · ');
        else if (dim === 'cli') sub = [gr.subs[0] || null, plural(gr.n, 'nota', 'notas')].filter(Boolean).join(' · ');
        else sub = plural(gr.n, 'nota', 'notas') + ' · ' + plural(gr.subs.length, 'cliente', 'clientes');
        var w = Math.max(0, Math.min(1, gr.p)) * 100;
        return '<button type="button" class="sdd-r' + (on ? ' on' : '') + '" data-sdd-sel="' + dim + '" data-k="' + esc(gr.k == null ? '' : gr.k) + '" aria-pressed="' + on + '" title="' +
          esc(on ? 'tirar o filtro' : 'filtrar a ficha por ' + nome) + '"><span class="t">' + esc(nome) + '<small>' + esc(sub) + '</small></span>' +
          '<span class="v">' + esc(fBRL(gr.v)) + '<small>' + esc(fPct(gr.p)) + '</small></span><span class="tr" aria-hidden="true"><span style="--p:' + w.toFixed(1) + '%"></span></span></button>';
      }).join('') + '</div>';
      if (grupos.length > TOPN) {
        h += '<button type="button" class="sdd-todos" data-sdd="todos" data-q="' + dim + '">' +
          (todos ? 'Mostrar só ' + (dim === 'cli' || dim === 'vend' ? 'os' : 'as') + ' ' + TOPN + ' maiores' : 'Ver ' + (dim === 'cli' || dim === 'vend' ? 'todos' : 'todas') + ' (' + fInt(grupos.length) + ')') + '</button>';
      }
      return h + '</section>';
    }

    // a lista de notas (só ela repinta na busca: o campo não perde o foco)
    function pintarNotas() {
      var box = no('nfs'); if (!box || !S.E) return;
      var todas = S.vistas || [], lista = buscarNotas(todas, S.busca), vis = lista.slice(0, S.lim);
      var somaL = lista.reduce(function (s, n) { return s + n.v; }, 0), soma = S.E.soma;
      setTxt('nfs-n', fInt(todas.length));
      setHTML('nfs-info', '<b>' + esc(lista.length !== todas.length ? fInt(lista.length) + ' de ' + plural(todas.length, 'nota', 'notas') : plural(lista.length, 'nota', 'notas')) + '</b> · ' + esc(fMi(somaL)));
      if (!lista.length) { box.innerHTML = '<div class="sd-dw-nada">' + (S.busca.trim() ? 'Nada com “' + esc(S.busca.trim()) + '”.' : 'Nenhuma nota neste recorte.') + '</div>'; return; }
      var inteiras = {}; S.E.notas.forEach(function (n) { inteiras[n.id] = n.v; });
      var h = vis.map(function (n) {
        var on = S.aberta === n.id, f0 = n.fams[0];
        var fam = f0 ? (f0.fam || '—') + (n.fams.length > 1 ? ' +' + (n.fams.length - 1) : '') : '';
        var parte = S.sel && Math.abs((inteiras[n.id] || 0) - n.v) > 0.005;
        return '<div class="sdd-nf' + (on ? ' open' : '') + '"><button type="button" class="sdd-nf-h" data-sdd-nf="' + esc(n.id) + '" aria-expanded="' + on + '">' +
          '<span class="id"><b>' + esc(n.id === '—' ? 'sem nº' : 'NF ' + n.id) + '</b><small>' + esc(soma ? fPct(n.v / soma) + ' ' + T.doUn : '') + '</small></span>' +
          '<span class="cli"><b>' + esc(n.cli || '—') + '</b><small>' + esc([fam, n.uf].filter(Boolean).join(' · ')) + '</small></span>' +
          '<span class="v"><b>' + esc(fBRL(n.v)) + '</b>' + (parte ? '<small>de ' + esc(fBRL(inteiras[n.id])) + '</small>' : '') + '</span>' + IC_SETA + '</button>' +
          (on ? notaAberta(n) : '') + '</div>';
      }).join('');
      var resto = lista.length - vis.length;
      if (resto > 0) h += '<button type="button" class="sdd-todos" data-sdd="mais">Mostrar mais ' + esc(fInt(Math.min(PASSO, resto))) + ' <span>faltam ' + esc(fInt(resto)) + '</span></button>';
      box.innerHTML = h;
    }
    function notaAberta(n) {
      var pares = [];
      if (n.data) pares.push(['Emissão', fData(n.data) + ' · ' + diaSem(n.data, true)]);
      if (n.vend) pares.push(['Vendedor', n.vend]);
      if (n.fil) pares.push(['Filial', n.fil]);
      // RECORTE MSB: sem a linha Empresa (é sempre MSB)
      var h = '<div class="sdd-nf-x">';
      if (pares.length) h += '<dl class="sd-dw-dl">' + pares.map(function (p) { return '<div><dt>' + esc(p[0]) + '</dt><dd>' + esc(p[1]) + '</dd></div>'; }).join('') + '</dl>';
      h += '<div class="sdd-sub">O que compõe a nota</div><div class="sd-cmp">' + n.fams.map(function (f) {
        var p = n.v ? f.v / n.v : 0;
        var sub = [f.est, f.vert].filter(function (x, i, a) { return x && a.indexOf(x) === i; }).join(' · ');
        return '<div class="sd-cmp-r"><span class="t">' + esc(f.fam || 'Sem família') + '<small>' + esc(sub) + '</small></span>' +
          '<span class="v">' + esc(fBRL(f.v)) + '<small>' + esc(fPct(p)) + '</small></span><span class="tr" aria-hidden="true"><span style="--p:' + (Math.max(0, Math.min(1, p)) * 100).toFixed(1) + '%"></span></span></div>';
      }).join('') + '</div>';
      h += '<div class="sdd-sub">Itens da nota</div>' + itensH(n);
      return h + '</div>';
    }
    function itensH(n) {
      if (n.id === '—') return '<div class="sd-dw-nada">Linha sem nº de nota: não dá para ler os itens.</div>';
      var it = ITENS.get(chaveItens(n.id));
      if (!it || it.st === 'carregando') return carregandoH('Lendo os itens no Power BI…');
      if (it.st === 'erro') return erroH('Não deu para ler os itens', it.erro, 'itens', n.id);
      if (!it.rows.length) return '<div class="sd-dw-nada">O Power BI não trouxe itens para esta nota.</div>';
      // com filtro cruzado de família/estratégia/vertical a lista de itens
      // continua da nota inteira (o filtro é das linhas, não do item)
      return '<div class="sd-its">' + it.rows.map(function (r, i) {
        var meta = [r.cod ? 'cód. ' + r.cod : null, r.fam].filter(Boolean).join(' · ');
        var qx = r.qt != null ? r.qt.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + (r.qt === 1 ? ' unidade' : ' unidades') : '';
        return '<div class="sd-it"><div class="n">' + (i + 1) + '</div><div class="c"><div class="t">' + esc(r.prod || 'Produto sem nome') + '</div>' +
          (meta ? '<div class="s">' + esc(meta) + '</div>' : '') + '</div><div class="v"><b>' + esc(fBRL(r.v)) + '</b>' + (qx ? '<span>' + esc(qx) + '</span>' : '') + '</div></div>';
      }).join('') + '</div>';
    }

    // ── Excel ─────────────────────────────────────────────────────
    function exportar() {
      var E = S.E; if (!E || !E.linhas.length) return;
      var X = root.XLSX;
      if (!X) { try { root.alert('A biblioteca do Excel não carregou.'); } catch (e) { } return; }
      var c = S.ctx || {}, wb = X.utils.book_new();
      K.abas(E, K.nome(S.rot, c)).forEach(function (a) { X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(a[1]), a[0]); });
      X.writeFile(wb, K.arquivo(S.rot, c));
      var t = no('xlt'); if (t) { t.textContent = 'Baixado'; clearTimeout(exportar._t); exportar._t = setTimeout(function () { t.textContent = T.xls; }, 1600); }
    }

    EU = {
      // a série nova do gráfico (filtro trocado): a ficha aberta relê o mesmo rótulo
      serie: function (dados, ctx) {
        dados = dados || {};
        S.serie = { labels: (dados.labels || []).map(String), valores: (dados.valores || []).slice(), brutos: dados.brutos ? dados.brutos.slice() : null };
        S.ctx = ctx || null;
        if (S.rot != null && EL && EL.classList.contains('open')) {
          if (S.serie.labels.indexOf(S.rot) >= 0) ir(S.rot); else fechar();
        }
      },
      abrir: function (rotulo, origem) { abrir(rotulo, origem); },
      fechar: fechar,
      estado: function () {
        var o = { rotulo: S.rot, filtro: S.sel, quebra: S.quebra, busca: S.busca, nivel: NIVEL, cache: CACHE.size, itens: ITENS.size,
          rotulos: S.serie ? S.serie.labels.length : 0, diagnostico: S.E ? S.E.diag : null };
        o[K.chave] = S.rot;
        return o;
      }
    };
    FICHAS.push(EU);
    return EU;
  }

  // ══════════════════════════════════════════════════════════════
  // A FICHA DO DIA
  // ══════════════════════════════════════════════════════════════
  function isoDoDia(c, rot) { return c.mes && c.ano ? isoDia(c.ano, c.mes, rot) : null; }
  function kpisDia(P, E) {
    var tot = P.v, h = '<div class="sd-dw-kpis">';
    var pPer = P.tot ? tot / P.tot : null;
    h += kp('Faturado no dia', fBRLp(tot), pPer != null ? esc(fPct(pPer) + ' do período') : '', 'destaque');
    if (E && E.linhas.length) {
      var nN = E.notas.length, nCli = E.grupos.cli.filter(function (g) { return g.k != null; }).length;
      h += kp('Notas fiscais', esc(fInt(nN)), esc('ticket médio ' + fMi(nN ? E.soma / nN : 0)));
      h += kp('Clientes', esc(fInt(nCli)), E.grupos.cli[0] && E.grupos.cli[0].k ? esc('maior: ' + E.grupos.cli[0].k) : '', 'sdd-kp-cli');
    } else if (!E) {
      h += kp('Notas fiscais', '…', '', '', 'z') + kp('Clientes', '…', '', '', 'z');
    }
    if (P.media && P.n > 1 && tot > 0) {
      var r = tot / P.media - 1;
      h += kp('Contra a média', esc(fVar(r)), esc('média de ' + fMi(P.media) + ' em ' + P.n + ' dias'), '', r >= 0 ? 'bom' : 'warn');
    }
    var R = E ? E.rit : null;
    if (R && tot > 0) h += kp('Ritmo da meta', esc(fPct(R.doDia)), esc(fMi(R.porDia) + ' por dia útil'), '', R.doDia >= 1 ? 'bom' : 'warn');
    if (E && E.mg && E.mg.mp != null) h += kp('Margem do dia', esc(fPct1(E.mg.mp)), E.mpPer != null ? esc(fPP(E.mg.mp - E.mpPer) + ' vs período') : '');
    return h + '</div>';
  }
  function comoContaDia(iso, rot, nivel) {
    return '<details class="sd-dw-card sd-dw-mais"><summary><h5>Como conta</h5></summary>'
      + '<p class="sd-dw-p">' + (iso ? 'Entram as notas fiscais com data de <b>' + esc(fData(iso)) + '</b>' : 'Entram as notas fiscais com data no <b>dia ' + esc(rot) + '</b> de cada mês do período')
      + ', com as mesmas regras do gráfico: fora intercompany, só operações que geram fatura a receber e sem as notas ocultadas pelo negócio. Só a empresa <b>MSB</b>; o filtro de <b>Tipo de Cliente</b> vale aqui — a ficha soma igual à barra.</p>'
      + '<p class="sd-dw-p">O <b>diagnóstico</b> é sempre do dia inteiro. Clicar numa linha das quebras filtra as outras quebras e as notas por ela (clique de novo ou em “limpar” para tirar).</p>'
      + '<p class="sd-dw-p"><b>Contra a média</b>: o dia contra a média dos dias com faturamento do período. <b>Ritmo da meta</b> (com um mês só): a meta do mês ÷ os dias úteis (segunda a sexta, sem descontar feriados).</p>'
      + (nivel ? '<p class="sd-dw-p">O seu usuário não tem acesso a todas as colunas no Power BI: ' + (nivel >= 2 ? 'estratégia, ' : '') + 'filial, vendedor e data ficam de fora.</p>' : '')
      + '</details>';
  }
  var DIA = {
    id: 'sdd', chave: 'dia',
    t: { un: 'dia', doUn: 'do dia', uns: 'dias', ant: 'Dia anterior com faturamento', prox: 'Próximo dia com faturamento', xls: 'Excel do dia' },
    // a consulta do gráfico + 'Calendário'[Dia] = N, com o literal do tipo que o modelo devolveu
    base: function (c, serie, rot) {
      var i = serie ? serie.labels.indexOf(String(rot)) : -1;
      var bruto = i >= 0 && serie.brutos ? serie.brutos[i] : undefined;
      return (c.filtros || []).concat(predDia(bruto, rot));
    },
    modelo: modelo,
    cab: function (rot, c, P) {
      var iso = isoDoDia(c, rot), hoje = !!iso && iso === hojeISO(), tags = [];
      if (hoje) tags.push('<span class="sd-dw-tag vd">Hoje · em andamento</span>');
      if (P.rank === 1 && P.n > 1) tags.push('<span class="sd-dw-tag az">Maior dia do período</span>');
      if (iso) { var w = new Date(iso + 'T12:00:00').getDay(); if (w === 0 || w === 6) tags.push('<span class="sd-dw-tag">Fim de semana</span>'); }
      // RECORTE MSB: sem o selo por empresa (BIO · R$ … / MSB · R$ …) — só há a MSB
      return { k: 'Faturamento do dia' + (hoje ? ' · hoje' : ''), tt: rotuloDia(rot, iso), sub: (iso ? '' : 'O dia ' + rot + ' de cada mês · ') + (c.periodo || ''), tags: tags };
    },
    kpis: kpisDia,
    comoConta: function (rot, c, nivel) { return comoContaDia(isoDoDia(c, rot), rot, nivel); },
    mostraData: function (E) { return E.multi; },
    margem: function (base, meds) { return daxMargem(base, meds); },
    lerMargem: function (r) { return { mp: numOu(campo(r, '[mp]')), mn: numOu(campo(r, '[mn]')) }; },
    nome: function (rot, c) { var iso = isoDoDia(c, rot); return rotuloDia(rot, iso) + (c.periodo && !iso ? ' · ' + c.periodo : ''); },
    abas: function (E, nome) { var P = planilhas(E, nome); return [['Notas', P.notas], ['Linhas', P.linhas], ['Diagnóstico', P.diag]]; },
    arquivo: function (rot, c) {
      var iso = isoDoDia(c, rot);
      return 'Faturamento_' + (iso ? iso.split('-').reverse().join('-') : 'dia-' + rot + (c.ano ? '-' + [].concat(c.ano).join('+') : '')) + '.xlsx';
    }
  };

  // ══════════════════════════════════════════════════════════════
  // API — SRDia é a ficha do dia; SRDia.ficha e SRDia.core servem o mês
  // ══════════════════════════════════════════════════════════════
  root.SRDia = ficha(DIA);
  root.SRDia.ficha = ficha;
  root.SRDia.core = CORE;
})(typeof window !== 'undefined' ? window : this);
