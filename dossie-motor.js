// ================================================================
// dossie-motor.js — Dossiê de Visita (Comercial) · MOTOR DE REGRAS PURO
//
// Recebe as linhas que a página já leu do Power BI (modelo do Comercial:
// Sales Report + Cirurgias) e devolve o objeto `dossie` que a tela desenha.
// Sem I/O, sem DOM, sem fetch — roda no navegador (pages/comercial-dossie-
// visita.html) e no Node (scripts/test-dossie-motor.js). Por isso mora na
// raiz, não em api/shared: o app de funções não é servido como estático.
//
// Mapeamento: docs/dossie-visita-mapeamento.md · chaves: docs/dossie-visita-chaves.md
//
// Entrada (montar):
//   hoje       Date | string ISO
//   chave      { cod, nome, conta, cidade, uf, tipo, cnpj }      (Q0)
//   conta      { nome, cidade, uf, telefone, dono, donoEmail } | null   (Salesforce)
//   carteira   'cliente' | 'grupo' | 'novo' | null
//   famMes     [{ fam, ano, mes, fat, qtd, notas, ult }]           (Q1: ≥ 24 meses)
//   produtos   [{ cod, prod, fam, fat, qtd }]                      (Q2: 12 meses)
//   carteiraFat[{ cod, fat }]                                      (Q3: todos os clientes, 12m — opcional)
//   cirurgias  [{ data, nome, fase, itens, conta, medico, vend, valor, fam }]  (Q7: futuras)
//   falhas     { famMes?, produtos?, carteiraFat?, cirurgias?, conta? }  (mensagem por fonte que falhou)
//
// Janela: "12m" = os 12 meses-calendário terminando no mês de `hoje`
// (inclusive); "12m anteriores" = os 12 antes desses. É janela MÓVEL, não
// ano fechado — a Comportamento de Clientes usa o ano; aqui o vendedor quer
// "de um ano para cá".
// ================================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DossieMotor = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const REGRA = {
    recRisco: 60, recDormente: 120, recPerdido: 240,
    quedaRisco: 0.30, fielRatio: 0.70, fielMin: 4,
    famAtivaMeses: 3,        // compra nos últimos 3 meses (contando o atual)
    famEsfriandoMeses: 6,    // 4..6 meses sem compra
    topFamilias: 8, topProdutos: 10, proximasCirurgias: 12,
    abc: [{ id: 'A', ate: 70 }, { id: 'B', ate: 90 }, { id: 'C', ate: 100 }],
    // fase 2
    consigParadoDias: 90,      // remessa com saldo há 90+ dias = parada (vermelho)
    loteVenceDias: 90,         // lote em consignação vencendo em até 90 dias
    oportParadaDias: 60,       // cotação/oportunidade sem mexer há 60+ dias
    ataCriticoDias: 60,        // ata vence em até 60 dias com saldo (vermelho)
    ataAtencaoDias: 90,        // 61..90 dias
    ataNuncaFaturouDias: 30,   // contrato novo demais não conta como "nunca faturou"
    ataClasses: ['vencido', 'critico', 'atencao', 'ritmo', 'ok'],
    maxLinhas: 12              // linhas mostradas por cartão da fase 2
  };

  const SEGS = {
    perdidos:    { nome: 'Perdido',     crit: 'sem compra há mais de 240 dias' },
    dormentes:   { nome: 'Dormente',    crit: 'sem compra há 121–240 dias' },
    risco:       { nome: 'Em risco',    crit: 'recência 61–120 dias ou queda ≥30% vs 12m anteriores' },
    novos:       { nome: 'Novo',        crit: '1ª compra nos últimos 12 meses' },
    fieis:       { nome: 'Fiel',        crit: 'compra em ≥70% dos últimos 12 meses e recência ≤60d' },
    recorrentes: { nome: 'Recorrente',  crit: 'compra ativa, cadência abaixo de fiel' },
    semCompra:   { nome: 'Sem compras', crit: 'nenhuma nota nos últimos 24 meses' }
  };

  const FASES_CIR = ['Negociação e Fechamento', 'Fechado e ganho', 'A Faturar'];

  // ── utilitários ────────────────────────────────────────────────
  function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
  function txt(v) { return v == null ? '' : String(v).trim(); }
  function dias(a, b) { return Math.round((b.getTime() - a.getTime()) / 86400000); }
  function utc(y, m, d) { return new Date(Date.UTC(y, m - 1, d)); }

  // aceita Date, ISO, "dd/mm/aaaa", aaaammdd (número/texto), serial OLE
  function dataDe(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : utc(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
    if (typeof v === 'number') {
      if (v >= 19000101 && v <= 29991231) { const s = String(v); return utc(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8)); }
      if (v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000);
      return null;
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return utc(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return utc(+m[3], +m[2], +m[1]);
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return utc(+m[1], +m[2], +m[3]);
    const d = new Date(s);
    return isNaN(d) ? null : utc(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  function iso(d) { return d ? d.toISOString().slice(0, 10) : null; }
  function mesIdx(ano, mes) { return num(ano) * 12 + (num(mes) - 1); }
  function idxMes(i) { return { ano: Math.floor(i / 12), mes: (i % 12) + 1 }; }
  function variacao(atual, anterior) {
    if (!(anterior > 0)) return atual > 0 ? null : 0;
    return (atual - anterior) / anterior;
  }
  function anoMesDe(v) {
    // 'Nº do mês' pode vir número (7), texto ("7"), ou nome ("jul"/"Julho")
    const n = Number(v);
    if (isFinite(n) && n >= 1 && n <= 12) return n;
    const t = txt(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().slice(0, 3);
    const M = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
    return M[t] || null;
  }

  // ── compras ────────────────────────────────────────────────────
  function compras(famMes, hoje) {
    const k = mesIdx(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1);   // mês atual
    const ini12 = k - 11, ini24 = k - 23;
    const porFam = new Map();
    const meses = new Map();           // idx -> fat (24m)
    let ultima = null, primeira = null, notas12 = new Set(), nNotas12 = 0;

    (famMes || []).forEach(function (r) {
      const mes = anoMesDe(r.mes); if (!mes) return;
      const i = mesIdx(r.ano, mes);
      if (i < ini24 || i > k) return;     // fora da janela de 24 meses
      const fat = num(r.fat), qtd = num(r.qtd), nt = num(r.notas);
      const fam = txt(r.fam) || '(sem família)';
      if (!porFam.has(fam)) porFam.set(fam, { fam: fam, fat12: 0, fat12ant: 0, qtd12: 0, meses: {}, ultima: null, primeiraIdx: null, ultimaIdx: null });
      const f = porFam.get(fam);
      if (fat !== 0 || qtd !== 0) {
        f.meses[i] = (f.meses[i] || 0) + fat;
        if (f.primeiraIdx == null || i < f.primeiraIdx) f.primeiraIdx = i;
        if (f.ultimaIdx == null || i > f.ultimaIdx) f.ultimaIdx = i;
      }
      if (i >= ini12) { f.fat12 += fat; f.qtd12 += qtd; nNotas12 += nt; }
      else f.fat12ant += fat;
      meses.set(i, (meses.get(i) || 0) + fat);
      const u = dataDe(r.ult);
      if (u) {
        if (!f.ultima || u > f.ultima) f.ultima = u;
        if (!ultima || u > ultima) ultima = u;
        if (!primeira || u < primeira) primeira = u;
      }
    });

    let fat12 = 0, fat12ant = 0, mesesAtivos12 = 0;
    for (let i = ini24; i <= k; i++) {
      const v = meses.get(i) || 0;
      if (i >= ini12) { fat12 += v; if (v > 0) mesesAtivos12++; } else fat12ant += v;
    }

    const familias = Array.from(porFam.values()).map(function (f) {
      const gap = f.ultimaIdx == null ? null : k - f.ultimaIdx;
      let status;
      if (f.ultimaIdx == null) status = 'sem-compra';
      else if (gap < REGRA.famAtivaMeses) status = (f.fat12ant === 0 && f.primeiraIdx >= ini12) ? 'nova' : 'ativa';
      else if (gap < REGRA.famEsfriandoMeses) status = 'esfriando';
      else status = 'abandonada';
      const serie = [];
      for (let i = ini12; i <= k; i++) serie.push(Math.round((f.meses[i] || 0) * 100) / 100);
      return {
        fam: f.fam, fat12: f.fat12, fat12ant: f.fat12ant, qtd12: f.qtd12,
        variacao: variacao(f.fat12, f.fat12ant),
        ultima: iso(f.ultima), mesesSemCompra: gap, status: status, serie12: serie
      };
    }).sort(function (a, b) { return (b.fat12 + b.fat12ant) - (a.fat12 + a.fat12ant); });

    const serie24 = [];
    for (let i = ini24; i <= k; i++) { const am = idxMes(i); serie24.push({ ano: am.ano, mes: am.mes, fat: Math.round((meses.get(i) || 0) * 100) / 100 }); }

    // nota com data futura (carga do DW à frente do relógio) não vira recência negativa
    const recencia = ultima ? Math.max(0, dias(ultima, hoje)) : null;
    const seg = segmento({ recencia: recencia, fat12: fat12, fat12ant: fat12ant, mesesAtivos12: mesesAtivos12, primeira: primeira, ini12: idxMes(ini12) });

    return {
      janela: { ini12: idxMes(ini12), fim: idxMes(k), ini24: idxMes(ini24) },
      fat12: fat12, fat12ant: fat12ant, variacao: variacao(fat12, fat12ant),
      nNotas12: nNotas12, ticket12: nNotas12 > 0 ? fat12 / nNotas12 : null,
      mesesAtivos12: mesesAtivos12, fatMedioMes12: fat12 / 12,
      ultimaCompra: iso(ultima), primeiraCompraJanela: iso(primeira), recenciaDias: recencia,
      segmento: seg, familias: familias, serie24: serie24,
      abandonadas: familias.filter(function (f) { return f.status === 'abandonada'; }),
      esfriando: familias.filter(function (f) { return f.status === 'esfriando'; })
    };
  }

  // mesma ordem da Comportamento de Clientes: para na 1ª que casa
  function segmento(x) {
    const r = x.recencia;
    let id;
    if (x.fat12 === 0 && x.fat12ant === 0) id = 'semCompra';
    else if (r == null) id = 'semCompra';
    else if (r > REGRA.recPerdido) id = 'perdidos';
    else if (r > REGRA.recDormente) id = 'dormentes';
    else if (r > REGRA.recRisco || (x.fat12ant > 0 && variacao(x.fat12, x.fat12ant) <= -REGRA.quedaRisco)) id = 'risco';
    else if (x.fat12ant === 0 && x.primeira && mesIdx(x.primeira.getUTCFullYear(), x.primeira.getUTCMonth() + 1) >= mesIdx(x.ini12.ano, x.ini12.mes)) id = 'novos';
    else if (x.mesesAtivos12 >= Math.max(REGRA.fielMin, Math.ceil(12 * REGRA.fielRatio)) && r <= REGRA.recRisco) id = 'fieis';
    else id = 'recorrentes';
    const motivo = id === 'risco'
      ? (r > REGRA.recRisco ? 'última compra há ' + r + ' dias' : 'queda de ' + Math.round(-variacao(x.fat12, x.fat12ant) * 100) + '% vs 12m anteriores')
      : null;
    return { id: id, nome: SEGS[id].nome, criterio: SEGS[id].crit, motivo: motivo };
  }

  // ── produtos ───────────────────────────────────────────────────
  function produtos(rows) {
    const lista = (rows || []).map(function (r) {
      return { cod: txt(r.cod), prod: txt(r.prod), fam: txt(r.fam), fat: num(r.fat), qtd: num(r.qtd) };
    }).filter(function (p) { return p.fat !== 0 || p.qtd !== 0; })
      .sort(function (a, b) { return b.fat - a.fat; });
    const total = lista.reduce(function (s, p) { return s + p.fat; }, 0);
    lista.forEach(function (p) { p.share = total > 0 ? p.fat / total : null; });
    return lista.slice(0, REGRA.topProdutos);
  }

  // ── posição na carteira (rank + classe ABC) ────────────────────
  function posicao(carteiraFat, cod) {
    if (!carteiraFat || !carteiraFat.length) return null;
    const lista = carteiraFat.map(function (r) { return { cod: txt(r.cod), fat: num(r.fat) }; })
      .filter(function (r) { return r.fat > 0; })
      .sort(function (a, b) { return b.fat - a.fat; });
    const total = lista.reduce(function (s, r) { return s + r.fat; }, 0);
    let acum = 0, pos = null, classe = null, fat = 0;
    for (let i = 0; i < lista.length; i++) {
      acum += lista[i].fat;
      const pct = total > 0 ? acum / total * 100 : 100;
      // quem CRUZA o corte entra na classe (regra da Comportamento de Clientes)
      const antes = total > 0 ? (acum - lista[i].fat) / total * 100 : 0;
      let cl = 'C';
      for (let j = 0; j < REGRA.abc.length; j++) { if (antes < REGRA.abc[j].ate) { cl = REGRA.abc[j].id; break; } }
      if (lista[i].cod === txt(cod)) { pos = i + 1; classe = cl; fat = lista[i].fat; }
      void pct;
    }
    if (pos == null) return { rank: null, de: lista.length, classe: null, share: 0, total: total };
    return { rank: pos, de: lista.length, classe: classe, share: total > 0 ? fat / total : 0, total: total };
  }

  // ── cirurgias futuras ──────────────────────────────────────────
  function cirurgias(rows, hoje) {
    const lista = (rows || []).map(function (r) {
      const d = dataDe(r.data);
      return {
        data: iso(d), diasAte: d ? dias(hoje, d) : null, nome: txt(r.nome), fase: txt(r.fase),
        itens: txt(r.itens), medico: txt(r.medico), vendedor: txt(r.vend), valor: num(r.valor), familias: txt(r.fam)
      };
    }).filter(function (c) { return c.data && c.diasAte >= 0 && (!c.fase || FASES_CIR.indexOf(c.fase) >= 0); })
      .sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : 0; });
    const porFase = {};
    lista.forEach(function (c) { porFase[c.fase || '(sem fase)'] = (porFase[c.fase || '(sem fase)'] || 0) + 1; });
    return {
      total: lista.length,
      valor: lista.reduce(function (s, c) { return s + c.valor; }, 0),
      em30dias: lista.filter(function (c) { return c.diasAte <= 30; }).length,
      proxima: lista[0] || null,
      porFase: porFase,
      proximas: lista.slice(0, REGRA.proximasCirurgias),
      todas: lista
    };
  }

  // ── consignação (fase 2) ───────────────────────────────────────
  // Uma linha por nota × produto × lote, já filtrada pelos fixos do visual
  // "Saldo por nota" (modelo 55, NF preenchida, status Aprovado, grupo de
  // depósito consignado, Exibir no BI = Sim) e com saldo ≠ 0.
  function consignacao(rows, hoje) {
    const lista = (rows || []).map(function (r) {
      const dm = dataDe(r.data), dv = dataDe(r.venc);
      return {
        nota: txt(r.nota), data: iso(dm), idadeDias: dm ? dias(dm, hoje) : null,
        cod: txt(r.cod), produto: txt(r.produto) || txt(r.cod), lote: txt(r.lote),
        vencimento: iso(dv), diasParaVencer: dv ? dias(hoje, dv) : null,
        saldo: num(r.saldo), custo: num(r.custo), aguardando: num(r.aguard)
      };
    }).filter(function (x) { return x.saldo !== 0 || x.aguardando !== 0; });

    // agrupa por nota para a leitura do vendedor ("esta remessa está parada")
    const porNota = new Map();
    lista.forEach(function (x) {
      const k = x.nota || '(sem nota)';
      if (!porNota.has(k)) porNota.set(k, { nota: k, data: x.data, idadeDias: x.idadeDias, saldo: 0, custo: 0, aguardando: 0, itens: 0, produtos: [] });
      const n = porNota.get(k);
      n.saldo += x.saldo; n.custo += x.custo; n.aguardando += x.aguardando; n.itens++;
      if (n.produtos.length < 4 && x.produto) n.produtos.push(x.produto);
      if (x.idadeDias != null && (n.idadeDias == null || x.idadeDias > n.idadeDias)) { n.idadeDias = x.idadeDias; n.data = x.data; }
    });
    const notas = Array.from(porNota.values()).sort(function (a, b) { return (b.idadeDias || 0) - (a.idadeDias || 0); });
    const paradas = notas.filter(function (n) { return n.idadeDias != null && n.idadeDias >= REGRA.consigParadoDias && n.saldo !== 0; });
    const aVencer = lista.filter(function (x) { return x.diasParaVencer != null && x.diasParaVencer <= REGRA.loteVenceDias && x.saldo !== 0; })
      .sort(function (a, b) { return a.diasParaVencer - b.diasParaVencer; });

    return {
      itens: lista.length,
      notas: notas.length,
      saldo: lista.reduce(function (s, x) { return s + x.saldo; }, 0),
      custo: lista.reduce(function (s, x) { return s + x.custo; }, 0),
      aguardando: lista.reduce(function (s, x) { return s + x.aguardando; }, 0),
      maisAntiga: notas[0] || null,
      paradas: paradas,
      custoParado: paradas.reduce(function (s, n) { return s + n.custo; }, 0),
      aVencer: aVencer.slice(0, REGRA.maxLinhas),
      topNotas: notas.slice(0, REGRA.maxLinhas),
      todas: lista
    };
  }

  // ── oportunidades e cotações vivas (fase 2) ────────────────────
  // Linhas do Salesforce (fonte principal, por conta) ou do modelo de
  // Oportunidades do Power BI (reserva). Só o Salesforce traz `diasNaFase`;
  // com ele, "parada" é tempo SEM ANDAR de fase, e não idade desde a criação.
  function oportunidades(rows, hoje) {
    const lista = (rows || []).map(function (r) {
      const dc = dataDe(r.criacao), dcir = dataDe(r.cirurgia);
      const idade = dc ? dias(dc, hoje) : null;
      const naFase = (r.diasNaFase == null || r.diasNaFase === '' || !isFinite(Number(r.diasNaFase))) ? null : Number(r.diasNaFase);
      const tempo = naFase != null ? naFase : idade;
      return {
        id: txt(r.id), tipo: txt(r.tipo), nome: txt(r.nome), fase: txt(r.fase),
        criacao: iso(dc), idadeDias: idade, diasNaFase: naFase,
        parada: tempo != null && tempo >= REGRA.oportParadaDias,
        dataCirurgia: iso(dcir), diasAteCirurgia: dcir ? dias(hoje, dcir) : null,
        vendedor: txt(r.vend), familia: txt(r.fam),
        valor: num(r.valor), qtd: num(r.qtd)
      };
    }).filter(function (o) { return o.nome || o.valor; })
      .sort(function (a, b) { return b.valor - a.valor; });

    const cotacoes = lista.filter(function (o) { return /cota/i.test(o.tipo); });
    const oport = lista.filter(function (o) { return !/cota/i.test(o.tipo); });
    const porFase = {};
    lista.forEach(function (o) { const k = o.fase || '(sem fase)'; if (!porFase[k]) porFase[k] = { n: 0, valor: 0 }; porFase[k].n++; porFase[k].valor += o.valor; });
    const soma = function (a) { return a.reduce(function (s, o) { return s + o.valor; }, 0); };

    return {
      total: lista.length, valor: soma(lista),
      cotacoes: { n: cotacoes.length, valor: soma(cotacoes) },
      oportunidades: { n: oport.length, valor: soma(oport) },
      porFase: porFase,
      paradas: lista.filter(function (o) { return o.parada; }),
      maiores: lista.slice(0, REGRA.maxLinhas),
      todas: lista
    };
  }

  // ── atas e contratos vigentes com saldo (fase 2) ───────────────
  // Grão: cliente × oportunidade × produto × vigência, já com os fixos da
  // Análise de Contratos. Classes na ordem de urgência da Sentinela.
  //
  // Leitura por ITEM (o que a gerência pediu em 08/10): cada contrato leva a
  // lista dos seus itens — inclusive os já 100% faturados, para o contrato
  // aparecer inteiro — com % faturado × % do prazo decorrido, o ritmo que
  // falta por mês e a PROJEÇÃO linear: no ritmo de hoje, quanto sobra sem
  // faturar quando a vigência acabar ("saldo em risco"). Vencido com saldo
  // = o saldo inteiro está em risco.
  const SITUACAO_ITEM = ['vencido', 'nunca', 'atrasado', 'inicio', 'semfat', 'emdia', 'concluido'];
  function fracao(a, b) { return b > 0 ? Math.max(0, Math.min(1, a / b)) : null; }

  function atas(rows, hoje) {
    const linhas = (rows || []).map(function (r) {
      const vig = dataDe(r.vig), ini = dataDe(r.ini);
      const cont = num(r.cont), fat = num(r.fat), abe = num(r.abe);
      // sem a coluna (a OLS derrubou [Valor faturado] e a página refez sem ela):
      // faturado DESCONHECIDO, não zero — nada de "nunca faturou" nem projeção
      const semFat = r.fat == null;
      const diasRestantes = vig ? dias(hoje, vig) : null;
      const diasDecorridos = ini ? dias(ini, hoje) : null;
      let classe = 'ok';
      if (diasRestantes != null && diasRestantes < 0) classe = 'vencido';
      else if (diasRestantes != null && diasRestantes <= REGRA.ataCriticoDias) classe = 'critico';
      else if (diasRestantes != null && diasRestantes <= REGRA.ataAtencaoDias) classe = 'atencao';
      const ritmoAtual = (diasDecorridos && diasDecorridos > 0) ? fat / diasDecorridos : null;
      const ritmoNecessario = (diasRestantes && diasRestantes > 0) ? abe / diasRestantes : null;
      // contrato com menos de 30 dias ainda não tem ritmo que se possa julgar
      // (nem projetar): fica "no prazo"/"início" até completar o 1º mês
      const maduro = diasDecorridos != null && diasDecorridos >= REGRA.ataNuncaFaturouDias;
      const lento = !semFat && maduro && ritmoAtual != null && ritmoNecessario != null && ritmoAtual < ritmoNecessario;
      if (classe === 'ok' && lento) classe = 'ritmo';
      const nunca = !semFat && fat === 0 && abe > 0 && diasDecorridos != null && diasDecorridos >= REGRA.ataNuncaFaturouDias;
      let situacao;
      if (abe <= 0) situacao = 'concluido';
      else if (diasRestantes != null && diasRestantes < 0) situacao = 'vencido';
      else if (semFat) situacao = 'semfat';
      else if (nunca) situacao = 'nunca';
      else if (fat === 0 && diasDecorridos != null && diasDecorridos < REGRA.ataNuncaFaturouDias) situacao = 'inicio';
      else if (lento) situacao = 'atrasado';
      else situacao = 'emdia';
      let emRisco = null;
      if (abe > 0 && diasRestantes != null) {
        if (diasRestantes < 0) emRisco = abe;
        else if (!semFat && maduro && ritmoAtual != null) emRisco = Math.max(0, abe - ritmoAtual * diasRestantes);
      }
      return {
        oportunidade: txt(r.opor), produto: txt(r.prod) || txt(r.cprod), cod: txt(r.cprod), familia: txt(r.fam),
        inicio: iso(ini), vigencia: iso(vig), diasRestantes: diasRestantes, diasDecorridos: diasDecorridos,
        contratado: cont, faturado: fat, emAberto: abe,
        pctFaturado: (!semFat && cont > 0) ? fat / cont : null,
        pctPrazo: (diasDecorridos != null && diasRestantes != null) ? fracao(diasDecorridos, diasDecorridos + diasRestantes) : null,
        ritmoAtualMes: (!semFat && ritmoAtual != null) ? ritmoAtual * 30 : null,
        semFaturado: semFat,
        ritmoNecessarioMes: ritmoNecessario != null ? ritmoNecessario * 30 : null,
        saldoEmRisco: emRisco,
        nuncaFaturou: nunca,
        situacao: situacao,
        classe: classe
      };
    }).filter(function (a) { return a.contratado > 0 || a.faturado > 0 || a.emAberto > 0; });
    const porUrgencia = function (a, b) {
      const oa = REGRA.ataClasses.indexOf(a.classe), ob = REGRA.ataClasses.indexOf(b.classe);
      if (oa !== ob) return oa - ob;
      return b.emAberto - a.emAberto;
    };
    // "itens" = os que ainda têm saldo (é o que o vendedor tem para empenhar)
    const itens = linhas.filter(function (a) { return a.emAberto > 0; }).sort(porUrgencia);

    // por contrato (o vendedor negocia o contrato, não a linha)
    const porOpor = new Map();
    linhas.forEach(function (a) {
      const k = a.oportunidade || '(sem contrato)';
      if (!porOpor.has(k)) porOpor.set(k, { oportunidade: k, inicio: null, vigencia: null, diasRestantes: null, contratado: 0, faturado: 0, emAberto: 0,
        itens: 0, itensTotal: 0, concluidos: 0, classe: 'ok', nuncaFaturou: 0, saldoEmRisco: null, semFaturado: false, familias: [], itensLista: [], _comSaldo: false });
      const o = porOpor.get(k);
      o.contratado += a.contratado; o.faturado += a.faturado; o.emAberto += a.emAberto; o.itensTotal++;
      o.itensLista.push(a);
      if (a.semFaturado) o.semFaturado = true;
      if (a.familia && o.familias.indexOf(a.familia) < 0) o.familias.push(a.familia);
      if (a.inicio && (!o.inicio || a.inicio < o.inicio)) o.inicio = a.inicio;
      if (a.saldoEmRisco != null) o.saldoEmRisco = (o.saldoEmRisco || 0) + a.saldoEmRisco;
      if (a.emAberto <= 0) { o.concluidos++; return; }
      o.itens++;
      if (a.nuncaFaturou) o.nuncaFaturou++;
      // a classe e a vigência do contrato saem do item MAIS urgente com saldo
      if (!o._comSaldo || REGRA.ataClasses.indexOf(a.classe) < REGRA.ataClasses.indexOf(o.classe)) {
        o.classe = a.classe; o.vigencia = a.vigencia; o.diasRestantes = a.diasRestantes;
      }
      o._comSaldo = true;
    });
    const todosContratos = Array.from(porOpor.values()).map(function (o) {
      o.pctFaturado = (!o.semFaturado && o.contratado > 0) ? o.faturado / o.contratado : null;
      const decorridos = (o.inicio && o.vigencia) ? dias(dataDe(o.inicio), hoje) : null;
      o.pctPrazo = (decorridos != null && o.diasRestantes != null) ? fracao(decorridos, decorridos + o.diasRestantes) : null;
      o.ritmoAtualMes = (!o.semFaturado && decorridos && decorridos > 0) ? o.faturado / decorridos * 30 : null;
      o.ritmoNecessarioMes = (o.diasRestantes && o.diasRestantes > 0) ? o.emAberto / o.diasRestantes * 30 : null;
      o.itensLista.sort(function (a, b) {
        const sa = SITUACAO_ITEM.indexOf(a.situacao), sb = SITUACAO_ITEM.indexOf(b.situacao);
        if (sa !== sb) return sa - sb;
        return b.emAberto - a.emAberto || b.contratado - a.contratado;
      });
      delete o._comSaldo;
      return o;
    });
    const contratos = todosContratos.filter(function (o) { return o.emAberto > 0; }).sort(porUrgencia);

    // saldo em aberto por família (onde está o dinheiro a empenhar)
    const fam = new Map();
    itens.forEach(function (a) {
      const k = a.familia || '(sem família)';
      if (!fam.has(k)) fam.set(k, { familia: k, contratado: 0, faturado: 0, emAberto: 0, itens: 0 });
      const f = fam.get(k); f.contratado += a.contratado; f.faturado += a.faturado; f.emAberto += a.emAberto; f.itens++;
    });

    const criticos = contratos.filter(function (o) { return o.classe === 'vencido' || o.classe === 'critico'; });
    const soma = function (lista, campo) { return lista.reduce(function (s, x) { return s + (x[campo] || 0); }, 0); };
    const contratado = soma(contratos, 'contratado'), faturado = soma(contratos, 'faturado');
    const comRisco = contratos.filter(function (o) { return o.saldoEmRisco != null; });
    const semFaturado = contratos.some(function (o) { return o.semFaturado; });
    return {
      total: contratos.length, itens: itens.length,
      contratado: contratado,
      faturado: semFaturado ? null : faturado,
      emAberto: soma(contratos, 'emAberto'),
      pctFaturado: (!semFaturado && contratado > 0) ? faturado / contratado : null,
      semFaturado: semFaturado,
      saldoEmRisco: comRisco.length ? soma(comRisco, 'saldoEmRisco') : null,
      criticos: criticos,
      emAbertoCritico: criticos.reduce(function (s, o) { return s + o.emAberto; }, 0),
      nuncaFaturou: itens.filter(function (a) { return a.nuncaFaturou; }),
      atrasados: itens.filter(function (a) { return a.situacao === 'atrasado'; }),
      porFamilia: Array.from(fam.values()).sort(function (a, b) { return b.emAberto - a.emAberto; }),
      encerrados: todosContratos.length - contratos.length,   // 100% faturados: só contam
      contratos: contratos.slice(0, REGRA.maxLinhas),
      todos: contratos
    };
  }

  // ── semáforo + destaques (determinísticos; a IA da fase 3 lê isto) ──
  function semaforo(d) {
    const motivos = [];
    let cor = 'verde';
    const c = d.compras;
    if (c) {
      if (c.segmento.id === 'perdidos') { cor = 'vermelho'; motivos.push('Sem compras há ' + c.recenciaDias + ' dias.'); }
      else if (c.segmento.id === 'dormentes') { cor = 'amarelo'; motivos.push('Sem compras há ' + c.recenciaDias + ' dias.'); }
      else if (c.segmento.id === 'risco') { cor = 'amarelo'; motivos.push('Em risco: ' + c.segmento.motivo + '.'); }
      if (c.abandonadas.length) {
        if (cor === 'verde') cor = 'amarelo';
        motivos.push(c.abandonadas.length + (c.abandonadas.length === 1 ? ' família abandonada' : ' famílias abandonadas') + ' (' +
          c.abandonadas.slice(0, 3).map(function (f) { return f.fam; }).join(', ') + (c.abandonadas.length > 3 ? '…' : '') + ').');
      }
    }
    // fase 2: consignado parado e ata vencendo com saldo são VERMELHO
    const cg = d.consignacao;
    if (cg && cg.paradas.length) {
      cor = 'vermelho';
      motivos.push(cg.paradas.length + (cg.paradas.length === 1 ? ' remessa consignada parada' : ' remessas consignadas paradas') +
        ' há mais de ' + REGRA.consigParadoDias + ' dias (' + brl0(cg.custoParado) + ' em custo).');
    } else if (cg && cg.saldo) {
      motivos.push(int(cg.saldo) + ' em consignação no cliente (' + brl0(cg.custo) + ' em custo).');
    }
    if (cg && cg.aVencer.length) {
      if (cor === 'verde') cor = 'amarelo';
      motivos.push(cg.aVencer.length + (cg.aVencer.length === 1 ? ' lote consignado vence' : ' lotes consignados vencem') + ' em até ' + REGRA.loteVenceDias + ' dias.');
    }
    const at = d.atas;
    if (at && at.criticos.length) {
      cor = 'vermelho';
      motivos.push(at.criticos.length + (at.criticos.length === 1 ? ' ata/contrato vence' : ' atas/contratos vencem') +
        ' em até ' + REGRA.ataCriticoDias + ' dias com ' + brl0(at.emAbertoCritico) + ' em aberto.');
    }
    if (at && at.nuncaFaturou.length) {
      if (cor === 'verde') cor = 'amarelo';
      motivos.push(at.nuncaFaturou.length + (at.nuncaFaturou.length === 1 ? ' item de ata nunca faturou' : ' itens de ata nunca faturaram') + '.');
    }
    if (d.cirurgias && d.cirurgias.em30dias) motivos.push(d.cirurgias.em30dias + (d.cirurgias.em30dias === 1 ? ' cirurgia' : ' cirurgias') + ' nos próximos 30 dias.');
    const op = d.oportunidades;
    if (op && op.total) motivos.push(op.total + (op.total === 1 ? ' oportunidade viva' : ' oportunidades vivas') + ' somando ' + brl0(op.valor) + '.');
    return { cor: cor, motivos: motivos };
  }

  function destaques(d) {
    const out = [];
    const c = d.compras;
    if (c) {
      if (c.variacao != null && c.variacao <= -REGRA.quedaRisco)
        out.push({ tipo: 'alerta', fonte: 'compras.variacao', texto: 'Faturamento 12m caiu ' + Math.round(-c.variacao * 100) + '% em relação aos 12 meses anteriores.' });
      if (c.variacao != null && c.variacao >= 0.20)
        out.push({ tipo: 'positivo', fonte: 'compras.variacao', texto: 'Faturamento 12m cresceu ' + Math.round(c.variacao * 100) + '% em relação aos 12 meses anteriores.' });
      c.abandonadas.slice(0, 3).forEach(function (f) {
        out.push({ tipo: 'alerta', fonte: 'compras.familias.' + f.fam,
          texto: 'Família ' + f.fam + ' sem compra há ' + f.mesesSemCompra + ' meses — comprava ' + brl0(f.fat12ant) + ' nos 12m anteriores.' });
      });
      c.esfriando.slice(0, 2).forEach(function (f) {
        out.push({ tipo: 'atencao', fonte: 'compras.familias.' + f.fam,
          texto: 'Família ' + f.fam + ' esfriando: última compra há ' + f.mesesSemCompra + ' meses.' });
      });
      const novas = c.familias.filter(function (f) { return f.status === 'nova'; });
      if (novas.length) out.push({ tipo: 'positivo', fonte: 'compras.familias', texto: 'Começou a comprar ' + novas.map(function (f) { return f.fam; }).slice(0, 3).join(', ') + ' nos últimos 12 meses.' });
    }
    if (d.posicao && d.posicao.rank)
      out.push({ tipo: 'info', fonte: 'posicao', texto: 'Cliente nº ' + d.posicao.rank + ' de ' + d.posicao.de + ' na sua carteira (classe ' + d.posicao.classe + ', ' + pctBR(d.posicao.share) + ' do faturamento 12m).' });
    if (d.cirurgias && d.cirurgias.proxima) {
      const p = d.cirurgias.proxima;
      out.push({ tipo: 'info', fonte: 'cirurgias.proxima', texto: 'Próxima cirurgia em ' + p.diasAte + ' dias (' + fmtData(p.data) + (p.medico ? ', Dr(a). ' + p.medico : '') + ') — ' + p.fase + '.' });
    }
    // fase 2
    const cg = d.consignacao;
    if (cg) {
      cg.paradas.slice(0, 3).forEach(function (n) {
        out.push({ tipo: 'alerta', fonte: 'consignacao.notas.' + n.nota,
          texto: 'Nota ' + n.nota + ' em consignação há ' + n.idadeDias + ' dias com ' + int(n.saldo) + ' em saldo (' + brl0(n.custo) + ' em custo) — cobrar consumo ou devolução.' });
      });
      if (cg.aguardando) out.push({ tipo: 'atencao', fonte: 'consignacao.aguardando', texto: int(cg.aguardando) + ' em consignação aguardando faturamento.' });
      cg.aVencer.slice(0, 2).forEach(function (x) {
        out.push({ tipo: 'atencao', fonte: 'consignacao.vencimento.' + x.lote,
          texto: 'Lote ' + (x.lote || x.cod) + ' de ' + x.produto + ' vence em ' + x.diasParaVencer + ' dias com saldo no cliente.' });
      });
    }
    const at = d.atas;
    if (at) {
      at.criticos.slice(0, 3).forEach(function (o) {
        out.push({ tipo: 'alerta', fonte: 'atas.' + o.oportunidade,
          texto: 'Contrato ' + o.oportunidade + (o.diasRestantes < 0 ? ' venceu há ' + (-o.diasRestantes) + ' dias' : ' vence em ' + o.diasRestantes + ' dias') +
            ' com ' + brl0(o.emAberto) + ' em aberto' + (o.pctFaturado != null ? ' (' + pctBR(o.pctFaturado) + ' faturado)' : '') + '.' });
      });
      at.nuncaFaturou.slice(0, 2).forEach(function (a) {
        out.push({ tipo: 'alerta', fonte: 'atas.nuncaFaturou.' + a.cod,
          texto: 'Item ' + (a.produto || a.cod) + ' do contrato ' + a.oportunidade + ' nunca foi faturado — ' + brl0(a.emAberto) + ' parados.' });
      });
      // projeção: contrato ainda no prazo, mas o ritmo de hoje não esgota o saldo
      at.contratos.filter(function (o) {
        return o.classe !== 'vencido' && o.classe !== 'critico' && o.saldoEmRisco != null && o.saldoEmRisco >= 1 && o.pctPrazo != null;
      }).sort(function (a, b) { return b.saldoEmRisco - a.saldoEmRisco; }).slice(0, 2).forEach(function (o) {
        out.push({ tipo: 'atencao', fonte: 'atas.' + o.oportunidade,
          texto: 'No ritmo atual, o contrato ' + o.oportunidade + ' termina com ' + brl0(o.saldoEmRisco) + ' sem faturar (' +
            pctBR(o.pctFaturado) + ' faturado com ' + pctBR(o.pctPrazo) + ' do prazo corrido).' });
      });
    }
    const op = d.oportunidades;
    if (op) {
      op.maiores.slice(0, 2).forEach(function (o) {
        out.push({ tipo: 'info', fonte: 'oportunidades.' + o.nome,
          texto: (/cota/i.test(o.tipo) ? 'Cotação' : 'Oportunidade') + ' ' + o.nome + ' em ' + o.fase + ' com ' + brl0(o.valor) +
            (o.diasAteCirurgia != null && o.diasAteCirurgia >= 0 ? ' — cirurgia em ' + o.diasAteCirurgia + ' dias.' : '.') });
      });
      op.paradas.slice(0, 2).forEach(function (o) {
        out.push({ tipo: 'atencao', fonte: 'oportunidades.paradas.' + o.nome,
          texto: (/cota/i.test(o.tipo) ? 'Cotação' : 'Oportunidade') + ' ' + o.nome +
            (o.diasNaFase != null ? ' há ' + o.diasNaFase + ' dias em ' + o.fase + ' sem andar' : ' aberta há ' + o.idadeDias + ' dias sem fechar') +
            ' (' + brl0(o.valor) + ').' });
      });
    }
    return out;
  }

  function brl0(v) { return 'R$ ' + Math.round(num(v)).toLocaleString('pt-BR'); }
  function int(v) { return Math.round(num(v)).toLocaleString('pt-BR'); }
  function pctBR(v) { return (num(v) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'; }
  function fmtData(s) { return s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '—'; }

  // ── montagem ───────────────────────────────────────────────────
  function montar(inp) {
    inp = inp || {};
    const hoje = dataDe(inp.hoje) || dataDe(new Date());
    const falhas = inp.falhas || {};
    const d = {
      geradoEm: new Date().toISOString(),
      hoje: iso(hoje),
      cliente: Object.assign({ carteira: inp.carteira || null }, inp.chave || {}, { salesforce: inp.conta || null }),
      compras: falhas.famMes ? null : compras(inp.famMes, hoje),
      topProdutos: falhas.produtos ? null : produtos(inp.produtos),
      posicao: falhas.carteiraFat ? null : posicao(inp.carteiraFat, inp.chave && inp.chave.cod),
      cirurgias: falhas.cirurgias ? null : cirurgias(inp.cirurgias, hoje),
      consignacao: falhas.consignacao ? null : consignacao(inp.consignacao, hoje),
      oportunidades: falhas.oportunidades ? null : oportunidades(inp.oportunidades, hoje),
      atas: falhas.atas ? null : atas(inp.atas, hoje),
      fontes: {
        compras:   falhas.famMes      ? { ok: false, erro: String(falhas.famMes) }      : { ok: true },
        produtos:  falhas.produtos    ? { ok: false, erro: String(falhas.produtos) }    : { ok: true },
        posicao:   falhas.carteiraFat ? { ok: false, erro: String(falhas.carteiraFat) } : { ok: true, disponivel: !!(inp.carteiraFat && inp.carteiraFat.length) },
        cirurgias: falhas.cirurgias   ? { ok: false, erro: String(falhas.cirurgias) }   : { ok: true },
        salesforce: falhas.conta      ? { ok: false, erro: String(falhas.conta) }       : { ok: true, disponivel: !!inp.conta },
        consignacao:   falhas.consignacao   ? { ok: false, erro: String(falhas.consignacao) }   : { ok: true },
        // `de` diz onde a lista foi buscada (Salesforce pela conta, ou Power BI
        // pelo código) — o cartão vazio precisa dizer o que foi procurado
        oportunidades: falhas.oportunidades ? { ok: false, erro: String(falhas.oportunidades) } : Object.assign({ ok: true }, inp.oportunidadesDe ? { de: inp.oportunidadesDe } : {}),
        atas:          falhas.atas          ? { ok: false, erro: String(falhas.atas) }          : { ok: true }
      }
    };
    d.semaforo = semaforo(d);
    d.destaques = destaques(d);
    return d;
  }

  return { montar, compras, segmento, produtos, posicao, cirurgias, consignacao, oportunidades, atas,
           semaforo, destaques, dataDe, anoMesDe, REGRA, SEGS, FASES_CIR, SITUACAO_ITEM };
}));
