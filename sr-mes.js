/* ================================================================
   sr-mes.js — Sales Report (Comercial) · Visão Geral: a FICHA DO MÊS.

   Clicar numa coluna do gráfico "Evolução Mensal" (o de cima: os 12 meses
   do ano, com a linha da meta) abre, à direita, TUDO o que foi faturado
   naquele mês — fechado ou em andamento — no MESMO painel da ficha do dia
   (sr-dia.js tem o motor: SRDia.ficha, e o núcleo: SRDia.core). Dentro dela:
     • os números do mês: faturado (e % do ano), notas, clientes, a meta
       do mês (atingimento), o mês contra a média dos meses fechados e a
       margem do mês contra a do ano;
     • o DIAGNÓSTICO do mês, escrito a partir dos números: a força do mês,
       a meta (fechado: batida ou o que faltou; em andamento: o ritmo por
       dia útil e a projeção do fechamento), o acumulado do ano contra a
       meta acumulada, os dias do mês (em quantos faturou, o melhor dia), a
       concentração, o cliente, o que puxou, a margem e os negativos;
     • as quebras (estratégia, família, cliente e as outras — a Data são os
       dias do mês) com o filtro cruzado, as notas fiscais com busca e os
       itens, ‹ › entre os meses com faturamento e o Excel do mês.
   A consulta é a do gráfico + YEAR = ano e MONTH = mês: a ficha soma
   igual à barra.

   A página chama:
     SRMes.serie({ labels: ['1'…'12'], valores }, { filtros, query, ano, metas, sufixo, marcar })
       filtros = o MESMO filtro-base do gráfico (filtrosMensal), sem o ano
       e o mês; ano = o ano do gráfico; metas = a meta dos 12 meses (a
       linha); marcar(rotulo|null) destaca a coluna do mês aberto
     SRMes.abrir('11', origem)     — o clique na coluna (mês 1–12)
   F12: SRMes.estado()
   No Node (scripts/test-sr-mes.js) exporta só o núcleo puro do mês.
   Carrega DEPOIS do sr-dia.js. Desenho: o mesmo sr-dia.css (.sdd).
   ================================================================ */
(function (root) {
  'use strict';
  var NODE = typeof module === 'object' && module.exports;
  var C = NODE ? require('./sr-dia.js') : (root.SRDia && root.SRDia.core);
  if (!C) { try { root.console.warn('[SRMes] sr-dia.js não carregou: a ficha do mês fica de fora'); } catch (e) { } return; }
  var esc = C.esc, fMi = C.fMi, fMiS = C.fMiS, fBRL = C.fBRL, fBRLp = C.fBRLp, fInt = C.fInt, fPct = C.fPct, fVar = C.fVar,
    fPct1 = C.fPct1, fPP = C.fPP, plural = C.plural, pctAbs = C.pctAbs, nomeNota = C.nomeNota, fData = C.fData, diaSem = C.diaSem,
    num = C.num, numOu = C.numOu, kp = C.kp;

  var MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  function nomeMes(m) { return MESES[Number(m) - 1] || 'Mês ' + m; }

  // ══════════════════════════════════════════════════════════════
  // CONSULTAS (DAX)
  // ══════════════════════════════════════════════════════════════
  function predMes(ano, mes) { return ["YEAR('Calendário'[Data]) = " + Number(ano), "MONTH('Calendário'[Data]) = " + Number(mes)]; }
  // a margem do mês e, junto, a do ano inteiro (o mesmo filtro, sem o mês)
  function daxMargemMes(base, meds, ano) {
    var cols = meds.map(function (m) { return '"' + m[0] + '", ' + m[1]; });
    meds.forEach(function (m) {
      if (m[0] === 'mp') cols.push('"mpa", CALCULATE(' + m[1] + ", FILTER(ALL('Calendário'), YEAR('Calendário'[Data]) = " + Number(ano) + '))');
    });
    return 'EVALUATE CALCULATETABLE(ROW(' + cols.join(', ') + '), ' + base.join(', ') + ')';
  }

  // ══════════════════════════════════════════════════════════════
  // O MÊS NO ANO
  // ══════════════════════════════════════════════════════════════
  // fechado | andamento | futuro, contra o dia de hoje ('aaaa-mm-dd', Brasília)
  function situacao(ano, mes, hoje) {
    var a = Number(hoje.slice(0, 4)), m = Number(hoje.slice(5, 7));
    ano = Number(ano); mes = Number(mes);
    return ano < a || (ano === a && mes < m) ? 'fechado' : ano === a && mes === m ? 'andamento' : 'futuro';
  }
  // a meta do mês: fechado → batida ou o que faltou; em andamento → o ritmo
  // (dias úteis seg–sex corridos até hoje), quanto falta por dia útil e a
  // projeção do fechamento no ritmo de hoje
  function metaMes(fat, meta, ano, mes, hoje) {
    if (!(Number(meta) > 0)) return null;
    meta = Number(meta); fat = num(fat);
    var o = { sit: situacao(ano, mes, hoje), meta: meta, fat: fat, pm: fat / meta, falta: Math.max(0, meta - fat), sobra: Math.max(0, fat - meta) };
    if (o.sit !== 'andamento') return o;
    var u = C.diasUteis(Number(ano), Number(mes)), dh = Number(hoje.slice(8, 10));
    o.uteis = u.length; o.ate = u.filter(function (x) { return x <= dh; }).length; o.restam = o.uteis - o.ate;
    o.pu = o.uteis ? o.ate / o.uteis : 0; o.porDia = o.uteis ? meta / o.uteis : null;
    o.precisa = o.restam > 0 ? o.falta / o.restam : null;
    o.proj = o.ate > 0 ? fat / o.ate * o.uteis : null;
    return o;
  }
  // o acumulado do ano de janeiro até o mês: faturado (as colunas) e meta (a linha)
  function acumulado(serie, metas, mes) {
    var f = 0, m = 0, k = Number(mes);
    for (var i = 1; i <= k; i++) {
      var j = serie.labels.indexOf(String(i));
      f += j >= 0 ? num(serie.valores[j]) : 0;
      m += num(metas && metas[i - 1]);
    }
    return m > 0 ? { fat: f, meta: m, pm: f / m, ate: k } : null;
  }
  // a posição do mês: a do gráfico (vizinhos, % do ano) e a entre os meses
  // FECHADOS com faturamento — o mês corrente, pela metade, não entra na média
  function contextoMes(serie, rotulo, ano, hoje) {
    var P = C.contexto(serie, rotulo);
    var vals = serie.valores.map(function (v, i) { return situacao(ano, serie.labels[i], hoje) === 'fechado' ? v : 0; });
    var F = C.contexto({ labels: serie.labels, valores: vals }, rotulo);
    P.fechados = { n: F.n, media: F.media, rank: situacao(ano, rotulo, hoje) === 'fechado' ? F.rank : null };
    return P;
  }
  // os dias do mês (a coluna Data), em ordem
  function porDia(linhas) {
    return C.agrupar(linhas, 'data').filter(function (g) { return g.k != null; }).sort(function (a, b) { return a.k < b.k ? -1 : a.k > b.k ? 1 : 0; });
  }

  // ══════════════════════════════════════════════════════════════
  // DIAGNÓSTICO DO MÊS — escrito a partir dos números
  // ══════════════════════════════════════════════════════════════
  // E = modeloMes(): { rotulo, mes, ano, nome, sit, total (a coluna), soma
  // (as linhas), linhas, notas, grupos{est,fam,cli}, pos (com .fechados),
  // meta (metaMes), acum, dias, temData, mg, mpAno }
  function diagnosticoMes(E) {
    var it = [], P = E.pos || {}, F = P.fechados || {}, tot = E.total, soma = E.soma, M = E.meta;
    var forca = null, conc = null, puxou = null, metaTxt = null;

    if (!E.linhas.length) {
      var ds0 = E.sit === 'futuro' ? nomeMes(E.mes) + ' ainda não começou.' : 'Nenhuma nota fiscal deste mês entra no faturamento do relatório.';
      if (M) ds0 += ' A meta do mês é ' + fMi(M.meta) + '.';
      if (P.ant) ds0 += ' O mês anterior com faturamento foi ' + nomeMes(P.ant.l) + ' (' + fMi(P.ant.v) + ').';
      return { manchete: E.sit === 'futuro' ? 'Mês ainda por vir.' : 'Sem faturamento neste mês.', itens: [{ tom: 'neutro', tt: 'Nenhuma nota no mês', ds: ds0 }] };
    }

    // 1. força: o mês fechado contra a média dos meses fechados
    if (E.sit === 'fechado' && F.media && F.n > 1 && tot > 0) {
      // faixas: ±10% é a média; até ±25% acima/abaixo; além disso forte/fraco
      var r = tot / F.media - 1;
      var rot = r >= 0.25 ? 'Mês forte' : r >= 0.1 ? 'Mês acima da média' : r <= -0.25 ? 'Mês fraco' : r <= -0.1 ? 'Mês abaixo da média' : 'Mês na média';
      var ds = fMi(tot) + (Math.abs(r) < 0.005 ? ', igual à' : ', ' + pctAbs(r) + (r > 0 ? ' acima da' : ' abaixo da')) +
        ' média dos ' + F.n + ' meses fechados com faturamento no ano (' + fMi(F.media) + ').';
      ds += F.rank === 1 ? ' É o maior mês do ano.' : F.rank === F.n ? ' É o menor dos ' + F.n + '.' : ' É o ' + F.rank + 'º maior de ' + F.n + '.';
      if (P.ant) { var dv = tot - P.ant.v; ds += ' Contra ' + nomeMes(P.ant.l) + ' (' + fMi(P.ant.v) + '): ' + fMiS(dv) + ' (' + fVar(P.ant.v ? dv / P.ant.v : null) + ').'; }
      it.push({ tom: r >= 0.1 ? 'bom' : r <= -0.25 ? 'atencao' : 'neutro', tt: rot, ds: ds });
      forca = Math.abs(r) < 0.1 ? rot : rot + ' (' + fVar(r) + ' vs a média)';
    } else if (E.sit === 'fechado' && F.n === 1 && tot > 0) {
      it.push({ tom: 'neutro', tt: 'Único mês fechado com faturamento', ds: 'É o único mês fechado com faturamento no ano — ainda não há média para comparar.' });
    } else if (tot <= 0) {
      it.push({ tom: 'atencao', tt: 'Mês negativo', ds: 'O mês soma ' + fBRL(tot) + ': as devoluções e estornos passaram o faturado.' });
    }

    // 2. a meta do mês
    if (M && tot > 0) {
      var tt2, tom2, ds2;
      if (M.sit === 'andamento') {
        var base2 = 'Até hoje o mês soma ' + fMi(M.fat) + ' — ' + pctAbs(M.pm) + ' da meta de ' + fMi(M.meta);
        if (M.pm >= 1) { tt2 = 'Meta do mês já batida'; tom2 = 'bom'; ds2 = base2 + '.'; }
        else {
          var atras = M.pu - M.pm;
          tt2 = atras <= 0 ? 'À frente do ritmo da meta' : atras > 0.05 ? 'Atrás do ritmo da meta' : 'Perto do ritmo da meta';
          tom2 = atras <= 0 ? 'bom' : atras > 0.05 ? 'atencao' : 'neutro';
          ds2 = base2 + ', com ' + M.ate + ' de ' + M.uteis + ' dias úteis (' + pctAbs(M.pu) + ') corridos.';
          ds2 += M.restam > 0
            ? ' Faltam ' + fMi(M.falta) + ': ' + fMi(M.precisa) + ' por dia útil nos ' + M.restam + ' que restam.'
            : ' Não há mais dias úteis no mês: faltam ' + fMi(M.falta) + '.';
          if (M.proj != null && M.restam > 0) ds2 += ' No ritmo de hoje, o mês fecha perto de ' + fMi(M.proj) + ' (' + pctAbs(M.proj / M.meta) + ' da meta).';
        }
        metaTxt = pctAbs(M.pm) + ' da meta até hoje';
      } else if (M.pm >= 1) {
        tt2 = 'Meta do mês batida'; tom2 = 'bom';
        ds2 = fMi(M.fat) + ' contra a meta de ' + fMi(M.meta) + ': ' + pctAbs(M.pm) + ' (' + fMiS(M.sobra) + ' acima).';
        metaTxt = 'meta batida (' + pctAbs(M.pm) + ')';
      } else {
        tt2 = M.pm >= 0.9 ? 'Perto da meta' : 'Abaixo da meta'; tom2 = M.pm >= 0.9 ? 'neutro' : 'atencao';
        ds2 = fMi(M.fat) + ' contra a meta de ' + fMi(M.meta) + ': ' + pctAbs(M.pm) + '. Faltaram ' + fMi(M.falta) + ' (' + pctAbs(1 - M.pm) + ' da meta).';
        metaTxt = pctAbs(M.pm) + ' da meta';
      }
      it.push({ tom: tom2, tt: tt2, ds: ds2 });
    }

    // 3. o acumulado do ano até o mês (no mês corrente, até o último fechado:
    //    o mês pela metade contra a meta inteira dele puxaria o ano para baixo)
    var A = E.acum;
    if (A && A.ate > 1) {
      it.push({ tom: A.pm >= 1 ? 'bom' : A.pm >= 0.9 ? 'neutro' : 'atencao', tt: A.pm >= 1 ? 'Ano acima da meta acumulada' : 'Ano abaixo da meta acumulada',
        ds: 'De Janeiro a ' + nomeMes(A.ate) + (E.sit === 'andamento' ? ' (o último mês fechado)' : '') + ' o ano soma ' + fMi(A.fat) + ' — ' + pctAbs(A.pm) + ' da meta acumulada de ' + fMi(A.meta) +
          (A.pm < 1 ? ' (faltam ' + fMi(A.meta - A.fat) + ').' : A.fat - A.meta >= 0.5 ? ' (' + fMiS(A.fat - A.meta) + ').' : ' — exatamente a meta.') });
    }

    // 4. os dias do mês
    if (E.dias.length && soma > 0) {
      var top = E.dias.slice().sort(function (a, b) { return b.v - a.v; })[0], nd = E.dias.length;
      var pesou = top.p >= 0.3 && nd > 3;
      var dsD = 'Faturou em ' + plural(nd, 'dia', 'dias') + (E.sit === 'fechado' ? ' (o mês tem ' + C.diasUteis(E.ano, E.mes).length + ' dias úteis)' : '') +
        '; o melhor foi ' + fData(top.k) + ' · ' + diaSem(top.k, true) + ' (' + fMi(top.v) + ', ' + pctAbs(top.p) + ' do mês). Média por dia com faturamento: ' + fMi(soma / nd) + '.';
      it.push({ tom: pesou ? 'atencao' : 'neutro', tt: pesou ? 'Um dia pesou no mês' : 'Os dias do mês', ds: dsD });
    }

    // 5. concentração: as maiores notas
    var N = E.notas, nN = N.length, nCli = E.grupos.cli.filter(function (g) { return g.k != null; }).length;
    if (soma > 0 && nN === 1) {
      it.push({ tom: 'atencao', tt: 'Uma nota só', ds: 'Todo o faturamento do mês veio da ' + nomeNota(N[0]) + ': ' + fBRL(N[0].v) + '.' });
      conc = 'numa nota só';
    } else if (soma > 0 && nN > 1) {
      var t1 = N[0].v / soma, k3 = Math.min(3, nN), t3 = N.slice(0, k3).reduce(function (s, n) { return s + n.v; }, 0) / soma;
      var maiores = (nN <= 3 ? 'O mês tem só ' + plural(nN, 'nota', 'notas') : 'As ' + k3 + ' maiores notas fazem ' + pctAbs(t3) + ' do mês') +
        '; a maior, ' + nomeNota(N[0]) + ', sozinha ' + pctAbs(t1) + '.';
      var mais = nN > 3 ? ' ' + plural(nN, 'nota', 'notas') + ' para ' + plural(nCli, 'cliente', 'clientes') + ' no mês.' : '';
      if ((nN >= 3 && t3 >= 0.6) || t1 >= 0.4) { it.push({ tom: 'atencao', tt: 'Mês concentrado', ds: maiores + mais }); conc = 'concentrado em poucas notas'; }
      else if (nN >= 8 && t1 <= 0.15) it.push({ tom: 'bom', tt: 'Mês pulverizado', ds: plural(nN, 'nota', 'notas') + ' para ' + plural(nCli, 'cliente', 'clientes') + '; a maior, ' + nomeNota(N[0]) + ', pesa só ' + pctAbs(t1) + ' do mês.' });
      else it.push({ tom: 'neutro', tt: 'Concentração moderada', ds: maiores + mais });
    }

    // 6. o cliente que mais pesou
    var c0 = E.grupos.cli[0];
    if (soma > 0 && nN > 1 && c0 && c0.k != null) {
      if (nCli === 1) it.push({ tom: 'atencao', tt: 'Um cliente só', ds: 'Todas as ' + plural(nN, 'nota', 'notas') + ' do mês são de ' + c0.k + '.' });
      else if (c0.p >= 0.3) it.push({ tom: 'atencao', tt: 'Peso de um cliente', ds: c0.k + ' fez ' + pctAbs(c0.p) + ' do mês (' + fMi(c0.v) + ' em ' + plural(c0.n, 'nota', 'notas') + ').' });
      else {
        var c3 = E.grupos.cli.slice(0, 3).reduce(function (s, g) { return s + g.v; }, 0) / soma;
        it.push({ tom: 'neutro', tt: 'Maior cliente', ds: c0.k + ': ' + fMi(c0.v) + ' (' + pctAbs(c0.p) + ') em ' + plural(c0.n, 'nota', 'notas') + '. Os 3 maiores clientes somam ' + pctAbs(c3) + ' do mês.' });
      }
    }

    // 7. o que puxou: estratégia e família
    var ests = E.grupos.est.filter(function (g) { return g.k != null; }), fams = E.grupos.fam.filter(function (g) { return g.k != null; });
    var partes = [];
    if (soma > 0 && ests.length) {
      partes.push('A estratégia ' + ests[0].k + ' puxou o mês: ' + fMi(ests[0].v) + ' (' + pctAbs(ests[0].p) + ')' +
        (ests[1] ? ', seguida de ' + ests[1].k + ' (' + pctAbs(ests[1].p) + ')' : '') + '.');
      puxou = ests[0].k;
    }
    if (soma > 0 && fams.length) partes.push('Família de maior valor: ' + fams[0].k + ' (' + fMi(fams[0].v) + ', ' + pctAbs(fams[0].p) + ').');
    if (fams.length) partes.push(plural(fams.length, 'família', 'famílias') + (ests.length ? ' de ' + plural(ests.length, 'estratégia', 'estratégias') : '') + ' no mês.');
    if (partes.length) it.push({ tom: 'neutro', tt: 'O que puxou o mês', ds: partes.join(' ') });

    // 8. margem do mês contra a do ano
    if (E.mg && E.mg.mp != null) {
      var mp = E.mg.mp, ma = E.mpAno;
      if (ma != null) {
        var dm = mp - ma;
        it.push({ tom: dm <= -0.02 ? 'atencao' : dm >= 0.02 ? 'bom' : 'neutro',
          tt: dm <= -0.02 ? 'Margem abaixo do ano' : dm >= 0.02 ? 'Margem acima do ano' : 'Margem em linha com o ano',
          ds: 'Margem de contribuição do mês: ' + fPct1(mp) + ', contra ' + fPct1(ma) + ' no ano (' + fPP(dm) + ').' });
      } else it.push({ tom: 'neutro', tt: 'Margem do mês', ds: 'Margem de contribuição do mês: ' + fPct1(mp) + '.' });
    }

    // 9. valores negativos (devolução, estorno, ajuste)
    var neg = E.linhas.filter(function (l) { return l.v < 0; });
    if (neg.length) {
      var nfNeg = {}; neg.forEach(function (l) { nfNeg[l.nf || '—'] = 1; });
      it.push({ tom: 'atencao', tt: 'Valores negativos', ds: plural(neg.length, 'linha negativa', 'linhas negativas') + ' (em ' + plural(Object.keys(nfNeg).length, 'nota', 'notas') + ') ' +
        (neg.length === 1 ? 'soma' : 'somam') + ' −' + fBRL(Math.abs(C.totalDe(neg))) + ' e ' + (neg.length === 1 ? 'abate' : 'abatem') + ' o mês — devolução, estorno ou ajuste.' });
    }

    // 10. o mês corrente
    if (E.sit === 'andamento') it.push({ tom: 'neutro', tt: 'Mês em andamento', ds: 'É o mês corrente: o DW atualiza ao longo do dia e estes números ainda mudam.' });

    var resto = [];
    if (puxou) resto.push('puxado por ' + puxou);
    if (conc) resto.push(conc);
    var manchete = (forca || (fMi(tot) + (E.sit === 'andamento' ? ' até hoje' : ' faturados'))) + (metaTxt ? ' — ' + metaTxt : '') +
      (resto.length ? ', ' + resto.join(' e ') : '') + '.';
    return { manchete: manchete, itens: it };
  }

  // tudo o que a ficha pinta e o diagnóstico lê, a partir das linhas
  // c = o contexto da página ({ ano, metas }); mg = a margem do mês (e a do ano)
  function modeloMes(rotulo, linhas, serie, c, mg, hoje) {
    c = c || {}; hoje = hoje || C.hojeISO();
    var mes = Number(rotulo), ano = Number(c.ano), P = contextoMes(serie, rotulo, ano, hoje), sit = situacao(ano, mes, hoje);
    var tot = P.i >= 0 ? P.v : C.totalDe(linhas);
    var E = {
      rotulo: String(rotulo), mes: mes, ano: ano, nome: nomeMes(mes), sit: sit,
      total: tot, soma: C.totalDe(linhas), linhas: linhas, notas: C.notasDe(linhas),
      grupos: { est: C.agrupar(linhas, 'est'), fam: C.agrupar(linhas, 'fam'), cli: C.agrupar(linhas, 'cli') },
      pos: P, meta: metaMes(tot, c.metas ? c.metas[mes - 1] : null, ano, mes, hoje),
      acum: acumulado(serie, c.metas, sit === 'andamento' ? mes - 1 : mes),
      dias: porDia(linhas), mg: mg || null, mpAno: mg && mg.mpa != null ? mg.mpa : null
    };
    E.diag = diagnosticoMes(E);
    return E;
  }

  // ── Excel: as notas, as linhas, os dias e o diagnóstico ─────────
  function planilhasMes(E, nome) {
    var linhas = [['Data', 'Nota fiscal', 'Cliente', 'UF', 'Estratégia', 'Família', 'Sales Vertical', 'Filial', 'Empresa', 'Vendedor', 'Faturamento']];
    E.linhas.slice().sort(function (a, b) { return (a.data || '') < (b.data || '') ? -1 : (a.data || '') > (b.data || '') ? 1 : b.v - a.v; }).forEach(function (l) {
      linhas.push([l.data ? fData(l.data) : '', l.nf || '', l.cli || '', l.uf || '', l.est || '', l.fam || '', l.vert || '', l.fil || '', l.emp || '', l.vend || '', Math.round(l.v * 100) / 100]);
    });
    var notas = [['Nota fiscal', 'Data', 'Cliente', 'UF', 'Vendedor', 'Filial', 'Empresa', 'Famílias', 'Estratégias', 'Faturamento', '% do mês']];
    E.notas.forEach(function (n) {
      var ests = []; n.fams.forEach(function (f) { if (f.est && ests.indexOf(f.est) < 0) ests.push(f.est); });
      notas.push([n.id, n.data ? fData(n.data) : '', n.cli || '', n.uf || '', n.vend || '', n.fil || '', n.emp || '',
        n.fams.map(function (f) { return f.fam || '—'; }).join(' · '), ests.join(' · '), Math.round(n.v * 100) / 100, E.soma ? Math.round(n.v / E.soma * 10000) / 10000 : '']);
    });
    var dias = [['Data', 'Dia da semana', 'Notas', 'Faturamento', '% do mês']];
    E.dias.forEach(function (d) { dias.push([fData(d.k), diaSem(d.k, true), d.n, Math.round(d.v * 100) / 100, Math.round(d.p * 10000) / 10000]); });
    var diag = [['Faturamento do mês', nome], ['Resumo', E.diag.manchete], []].concat([['Ponto', 'Leitura', 'Tom']]).concat(
      E.diag.itens.map(function (i) { return [i.tt, i.ds, i.tom === 'bom' ? 'positivo' : i.tom === 'atencao' ? 'atenção' : 'neutro']; }));
    return { linhas: linhas, notas: notas, dias: dias, diag: diag };
  }

  // ══════════════════════════════════════════════════════════════
  // O QUE A FICHA DO MÊS PINTA (o motor é o do sr-dia.js)
  // ══════════════════════════════════════════════════════════════
  function cabMes(rot, c, P, E, serie) {
    var mes = Number(rot), hoje = C.hojeISO(), sit = situacao(c.ano, mes, hoje), tags = [];
    if (sit === 'andamento') tags.push('<span class="sd-dw-tag vd">Mês em andamento</span>');
    var PM = serie ? contextoMes(serie, rot, c.ano, hoje) : null;
    if (PM && PM.fechados.rank === 1 && PM.fechados.n > 1) tags.push('<span class="sd-dw-tag az">Maior mês do ano</span>');
    var M = metaMes(P.v, c.metas ? c.metas[mes - 1] : null, c.ano, mes, hoje);
    if (M && M.sit === 'fechado' && P.v > 0) tags.push(M.pm >= 1 ? '<span class="sd-dw-tag vd">Meta batida · ' + esc(pctAbs(M.pm)) + '</span>' : '<span class="sd-dw-tag">' + esc(pctAbs(M.pm)) + ' da meta</span>');
    return {
      k: 'Faturamento do mês' + (sit === 'andamento' ? ' · em andamento' : sit === 'fechado' ? ' · fechado' : ''),
      tt: nomeMes(mes) + ' ' + c.ano,
      sub: (sit === 'fechado' ? 'Mês fechado' : sit === 'andamento' ? 'Até hoje, ' + fData(hoje) : 'Ainda não começou') + (c.sufixo || ''),
      tags: tags
    };
  }
  function kpisMes(P, E, c, rot, serie) {
    var mes = Number(rot), hoje = C.hojeISO(), tot = P.v, h = '<div class="sd-dw-kpis">';
    var pAno = P.tot ? tot / P.tot : null;
    h += kp('Faturado no mês', fBRLp(tot), pAno != null ? esc(fPct(pAno) + ' do ano') : '', 'destaque');
    if (E && E.linhas.length) {
      var nN = E.notas.length, nCli = E.grupos.cli.filter(function (g) { return g.k != null; }).length;
      h += kp('Notas fiscais', esc(fInt(nN)), esc('ticket médio ' + fMi(nN ? E.soma / nN : 0)));
      h += kp('Clientes', esc(fInt(nCli)), E.grupos.cli[0] && E.grupos.cli[0].k ? esc('maior: ' + E.grupos.cli[0].k) : '', 'sdd-kp-cli');
    } else if (!E) {
      h += kp('Notas fiscais', '…', '', '', 'z') + kp('Clientes', '…', '', '', 'z');
    }
    var M = E ? E.meta : metaMes(tot, c.metas ? c.metas[mes - 1] : null, c.ano, mes, hoje);
    if (M && tot > 0) {
      if (M.sit === 'andamento') h += kp('Meta até hoje', esc(fPct(M.pm)), esc('de ' + fMi(M.meta) + ' · ' + M.ate + '/' + M.uteis + ' dias úteis'), '', M.pm >= M.pu ? 'bom' : 'warn');
      else h += kp('Meta do mês', esc(fPct(M.pm)), esc('meta de ' + fMi(M.meta)), '', M.pm >= 1 ? 'bom' : 'warn');
    }
    var F = (E ? E.pos : serie ? contextoMes(serie, rot, c.ano, hoje) : P).fechados;
    if (F && F.rank != null && F.media && F.n > 1 && tot > 0) {
      var r = tot / F.media - 1;
      h += kp('Contra a média', esc(fVar(r)), esc('média de ' + fMi(F.media) + ' em ' + F.n + ' meses'), '', r >= 0 ? 'bom' : 'warn');
    }
    if (E && E.mg && E.mg.mp != null) h += kp('Margem do mês', esc(fPct1(E.mg.mp)), E.mpAno != null ? esc(fPP(E.mg.mp - E.mpAno) + ' vs o ano') : '');
    return h + '</div>';
  }
  function comoContaMes(rot, c, nivel) {
    return '<details class="sd-dw-card sd-dw-mais"><summary><h5>Como conta</h5></summary>'
      + '<p class="sd-dw-p">Entram as notas fiscais com data em <b>' + esc(nomeMes(rot) + ' de ' + c.ano) + '</b>, com as mesmas regras do gráfico Evolução Mensal: fora intercompany, só operações que geram fatura a receber e sem as notas ocultadas pelo negócio. Só a empresa <b>MSB</b>; o filtro de <b>Tipo de Cliente</b> vale aqui — a ficha soma igual à barra. O filtro de período não muda o gráfico nem a ficha: os dois mostram sempre os 12 meses do ano.</p>'
      + '<p class="sd-dw-p">O <b>diagnóstico</b> é sempre do mês inteiro. Clicar numa linha das quebras filtra as outras quebras e as notas por ela (clique de novo ou em “limpar” para tirar). Em <b>Outras quebras › Data</b> ficam os dias do mês.</p>'
      + '<p class="sd-dw-p"><b>Meta</b>: a do mês (a linha do gráfico). No mês em andamento, o <b>ritmo</b> compara o que já entrou com os dias úteis corridos (segunda a sexta, sem descontar feriados) e projeta o fechamento. <b>Contra a média</b>: o mês contra a média dos meses fechados com faturamento no ano. <b>Margem</b>: a do mês contra a do ano.</p>'
      + (nivel ? '<p class="sd-dw-p">O seu usuário não tem acesso a todas as colunas no Power BI: ' + (nivel >= 2 ? 'estratégia, ' : '') + 'filial, vendedor e data ficam de fora (e, com a data, os dias do mês).</p>' : '')
      + '</details>';
  }
  var MES = {
    id: 'sdm', chave: 'mes',
    t: { un: 'mês', doUn: 'do mês', uns: 'meses', ant: 'Mês anterior com faturamento', prox: 'Próximo mês com faturamento', xls: 'Excel do mês' },
    // a consulta do gráfico + o ano e o mês
    base: function (c, serie, rot) { return (c.filtros || []).concat(predMes(c.ano, rot)); },
    modelo: function (rot, linhas, serie, c, mg) { return modeloMes(rot, linhas, serie, c, mg); },
    cab: cabMes, kpis: kpisMes, comoConta: comoContaMes,
    mostraData: function () { return true; },
    // o rodapé: a posição entre os meses FECHADOS; o mês corrente não entra no ranking
    posicao: function (P, rot, c, serie) {
      var hoje = C.hojeISO(), sit = situacao(c.ano, rot, hoje);
      if (sit === 'andamento') return 'mês em andamento';
      var F = contextoMes(serie, rot, c.ano, hoje).fechados;
      return sit === 'fechado' && F.rank != null ? F.rank + 'º de ' + F.n + ' meses fechados' : '';
    },
    margem: function (base, meds, c) { return daxMargemMes(base, meds, c.ano); },
    lerMargem: function (r) { return { mp: numOu(C.campo(r, '[mp]')), mn: numOu(C.campo(r, '[mn]')), mpa: numOu(C.campo(r, '[mpa]')) }; },
    nome: function (rot, c) { return nomeMes(rot) + ' ' + c.ano + (c.sufixo || ''); },
    abas: function (E, nome) { var P = planilhasMes(E, nome); return [['Notas', P.notas], ['Linhas', P.linhas], ['Por dia', P.dias], ['Diagnóstico', P.diag]]; },
    arquivo: function (rot, c) { return 'Faturamento_' + c.ano + '-' + String(rot).padStart(2, '0') + '.xlsx'; }
  };

  // ── núcleo puro: no Node (teste) o arquivo para aqui ────────────
  var CORE = {
    MESES: MESES, nomeMes: nomeMes, predMes: predMes, daxMargemMes: daxMargemMes, situacao: situacao, metaMes: metaMes,
    acumulado: acumulado, contextoMes: contextoMes, porDia: porDia, diagnosticoMes: diagnosticoMes, modeloMes: modeloMes,
    planilhasMes: planilhasMes, cabMes: cabMes, kpisMes: kpisMes, comoContaMes: comoContaMes, MES: MES
  };
  if (NODE) { module.exports = CORE; return; }
  if (root.SRMes || !root.SRDia || !root.SRDia.ficha) return;
  root.SRMes = root.SRDia.ficha(MES);
})(typeof window !== 'undefined' ? window : this);
