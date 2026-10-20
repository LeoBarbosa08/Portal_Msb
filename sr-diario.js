/* ================================================================
   sr-diario.js — Sales Report (Comercial) · Visão Geral:
   PEDIDOS EM ANDAMENTO + FATURAMENTO DIÁRIO e a ficha à direita.

   No molde da lista das Negociações (Licitação › Funil de Vendas):
     • em cima, o TOTALIZADOR (faixa navy): valor, contagem, clientes,
       ticket médio e a divisão por status (pedidos) ou por vertical
       (notas) — a legenda é filtro: clicar mostra só aquele grupo;
     • a lista: busca, cabeçalho que ordena, célula de duas linhas,
       selo de status, total fixo no rodapé e "Mostrar mais";
     • clicar (ou Enter) numa linha abre a FICHA à direita: números-chave,
       a explicação de onde o pedido está (ou do que compõe a nota), e,
       lidos na hora no Power BI, os itens e os dados do documento. No
       pedido a ficha lê a OV INTEIRA (todas as linhas, em qualquer
       status, com a liberação e a previsão de cada uma) e diz quais
       a lista conta — a lista só soma as linhas em andamento.
   As linhas que o Power BI devolve vêm por documento × vertical ×
   família; aqui viram UMA linha por pedido / por nota (a contagem da
   lista bate com a do totalizador).

   A página chama:
     SRDiario.carregando()                          — antes de refazer as consultas
     SRDiario.pedidos(dados, totais, { filtros, query })
     SRDiario.faturados(dados, { filtros, dia, query })
   dados = { rows, qtd, total, erro } (medirPedidosDetalhe / medirFaturados),
   filtros = o MESMO filtro-base da consulta da lista (a ficha soma igual).

   F12: SRDiario.estado()
   No Node (scripts/test-sr-diario.js) o arquivo exporta só o núcleo puro —
   agrupar, dividir, filtrar, ordenar, montar o DAX da ficha — sem DOM.
   ================================================================ */
(function (root) {
  'use strict';

  var PASSO = 60;                               // linhas pintadas de cada vez
  var DS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var DSEM = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  var EPL = 'EM PROCESSO LOGÍSTICO', AGF = 'AGUARDANDO FATURAMENTO';
  var OUTRAS = '__outras__';                    // vai para data-k: nada de caractere de controle (o HTML troca o \0)
  // a cor segue a ENTIDADE: os dois status de sempre têm slot fixo
  var SLOT_STATUS = {}; SLOT_STATUS[EPL] = 1; SLOT_STATUS[AGF] = 2;
  var EXPLICA = {};
  EXPLICA[EPL] = 'O pedido está na logística — separação, conferência e expedição no depósito — e ainda não tem nota fiscal.';
  EXPLICA[AGF] = 'O pedido aguarda a emissão da nota fiscal (o faturamento).';

  // campos da ficha: [chave, rótulo, coluna DAX, tipo]
  var CAMPOS = {
    ped: [
      ['oc', 'Ordem de compra do cliente', 'Pedidos[ORDEM_DE_COMPRA_CLIENTE]'],
      ['stlib', 'Status da liberação', 'Pedidos[Status da liberação]'],
      ['stov', 'Status da ordem de venda', 'Pedidos[Status da ordem de venda]'],
      ['saida', 'Status de saída', 'Pedidos[Status de saída]'],
      ['cred', 'Em gerenciamento de crédito', 'Pedidos[EM_GERENCIAMENTO_DE_CREDITO]'],
      ['transp', 'Transportadora', 'Pedidos[TRANSPORTADORA]'],
      ['cria', 'Pedido criado por', 'Pedidos[ORDEM_CRIADA_POR]'],
      ['pac', 'Paciente', 'Pedidos[NOME_PACIENTE]'],
      ['unid', 'Unidade de negócio', "'DIM_UNIDADE_DE_NEGOCIO_V2'[UNIDADE_DE_NEGOCIO]"],
      ['emp', 'Empresa', "'Empresas'[Código da empresa]"],
      ['tipo', 'Tipo de cliente', "'Clientes'[Tipo de cliente (Revisado)]"],
      ['codcli', 'Cód. do cliente', "'Clientes'[Cód. Cliente]"],
      ['cid', 'Cidade', "'Clientes'[Cidade]"]
    ],
    nf: [
      ['vend', 'Vendedor', "'Vendedores'[Vendedor]"],
      ['ov', 'Ordem de venda', "'Faturamentos'[Ordem de Venda]"],
      ['op', 'Operação', "'Operações'[Operação]"],
      ['emp', 'Empresa', "'Empresas'[Código da empresa]"],
      ['unid', 'Unidade de negócio', "'DIM_UNIDADE_DE_NEGOCIO_V2'[UNIDADE_DE_NEGOCIO]"],
      ['tipo', 'Tipo de cliente', "'Clientes'[Tipo de cliente (Revisado)]"],
      ['codcli', 'Cód. do cliente', "'Clientes'[Cód. Cliente]"],
      ['cid', 'Cidade', "'Clientes'[Cidade]"],
      ['pac', 'Paciente', "'Faturamentos'[Paciente]"],
      ['conv', 'Convênio do paciente', "'Faturamentos'[Convênio do paciente]"]
    ]
  };
  var COL_DOC = { ped: 'Pedidos[Número da ordem de venda]', nf: "'Faturamentos'[Número da fatura]" };
  // linhas da OV: além do produto, o que separa uma linha da outra — o
  // modelo não tem nº de linha, então status, liberação e previsão
  var COLS_LINHA = ['Pedidos[Status do pedido]', 'Pedidos[Data de liberação para depósito (tratada)]', 'Pedidos[DATA_PREVISAO_ENTREGA]'];
  var COL_STLIB = 'Pedidos[Status da liberação]';     // pode estar bloqueada (OLS): a consulta volta sem ela
  var FATO = { ped: 'Pedidos', nf: 'Faturamentos' };
  var NOME = { ped: ['pedido', 'pedidos'], nf: ['nota', 'notas'] };

  // colunas da lista — `o` devolve a chave de ordenação
  var COLS = {
    ped: [
      { k: 'id', l: 'Pedido', cls: 'c-id', o: function (d) { return d.id; }, dica: 'nº da ordem de venda · embaixo, quando foi criado' },
      { k: 'cli', l: 'Cliente', cls: 'c-cli', o: function (d) { return d.cliente; }, dica: 'cliente · embaixo, vertical e UF' },
      { k: 'st', l: 'Status', cls: 'c-st', o: function (d) { return d.stP; }, dica: 'status do pedido hoje · embaixo, a liberação para o depósito' },
      { k: 'prev', l: 'Previsão', cls: 'c-dt', o: function (d) { return d.prev; }, dica: 'previsão de entrega no ERP · embaixo, quanto falta' },
      { k: 'v', l: 'Valor', cls: 'c-v', num: true, o: function (d) { return d.v; } }
    ],
    nf: [
      { k: 'id', l: 'Nota fiscal', cls: 'c-id', o: function (d) { return d.id; }, dica: 'nº da nota · embaixo, quanto ela pesa no faturamento de hoje' },
      { k: 'cli', l: 'Cliente', cls: 'c-cli', o: function (d) { return d.cliente; }, dica: 'cliente · embaixo, vertical e UF' },
      { k: 'fam', l: 'Família', cls: 'c-fam', o: function (d) { return d.fams.length ? d.fams[0].fam : null; }, dica: 'família de maior valor na nota · embaixo, as demais' },
      { k: 'v', l: 'Valor', cls: 'c-v', num: true, o: function (d) { return d.v; } }
    ]
  };
  var ORD_M = {
    ped: [['v:-1', 'Maior valor'], ['v:1', 'Menor valor'], ['prev:1', 'Previsão mais próxima'], ['cli:1', 'Cliente (A–Z)'], ['id:1', 'Nº do pedido']],
    nf: [['v:-1', 'Maior valor'], ['v:1', 'Menor valor'], ['cli:1', 'Cliente (A–Z)'], ['fam:1', 'Família (A–Z)'], ['id:1', 'Nº da nota']]
  };

  // ── estado das duas listas ─────────────────────────────────────
  function novo(tipo) { return { tipo: tipo, docs: [], series: [], seg: null, busca: '', ord: null, lim: PASSO, total: null, qtd: null, ctx: null, erro: null, pronto: false, dia: null }; }
  var L = { ped: novo('ped'), nf: novo('nf') };

  // ══════════════════════════════════════════════════════════════
  // FORMATAÇÃO
  // ══════════════════════════════════════════════════════════════
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function fBRL(v) { return v == null || !isFinite(Number(v)) ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fBRLp(v) {       // o "R$" menor, para o número grande do totalizador
    return v == null || !isFinite(Number(v)) ? '—' : '<small>R$</small>' + esc(Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }
  function fMi(v) {
    v = num(v); var a = Math.abs(v);
    if (a >= 1e6) return 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Mi';
    if (a >= 1e3) return 'R$ ' + (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: a >= 1e5 ? 0 : 1 }) + ' mil';
    return 'R$ ' + Math.round(v).toLocaleString('pt-BR');
  }
  function fInt(v) { return v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
  function fQtd(v) { return v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }); }
  function fPct(p) { if (p == null || !isFinite(p)) return '—'; var x = p * 100; return x > 0 && x < 1 ? '<1%' : Math.round(x) + '%'; }
  function plural(n, nomes) { return fInt(n) + ' ' + (Number(n) === 1 ? nomes[0] : nomes[1]); }
  function frase(s) { s = String(s == null ? '' : s).trim().toLowerCase(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function setTxt(id, t) { var e = D.getElementById(id); if (e) e.textContent = t; }
  function setHTML(id, h) { var e = D.getElementById(id); if (e) e.innerHTML = h; }

  // data do Power BI (ISO com hora, dd/mm/aaaa, Date) → 'aaaa-mm-dd'.
  // Antes de 2000 é marcador de "sem data" (coluna tratada), não data.
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
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  function fData(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—'; }
  function fDM(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '—'; }
  function hojeISO() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
    catch (e) { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  }
  function difDias(a, b) { return Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86400000); }
  function diaSem(iso, longo) { var d = new Date(iso + 'T12:00:00'); return (longo ? DSEM : DS)[d.getDay()]; }
  function relDia(iso) {
    if (!iso) return '';
    var n = difDias(hojeISO(), iso);
    if (n === 0) return 'hoje'; if (n === 1) return 'amanhã'; if (n === -1) return 'ontem';
    return n > 0 ? 'em ' + fInt(n) + ' dias' : 'há ' + fInt(-n) + ' dias';
  }
  function atrasada(iso) { return !!iso && iso < hojeISO(); }

  // ══════════════════════════════════════════════════════════════
  // LINHAS DO BI → DOCUMENTOS (1 por pedido / 1 por nota)
  // ══════════════════════════════════════════════════════════════
  function soma(o, k, v) { if (k == null || k === '') return; o[k] = (o[k] || 0) + v; }
  function porValor(o) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }); }
  function menor(o) { var ks = Object.keys(o).sort(); return ks.length ? ks[0] : null; }

  function docsPedidos(rows) {
    var m = new Map();
    (rows || []).forEach(function (r) {
      var k = r.pedido == null ? '' : String(r.pedido);
      if (!k) return;
      var d = m.get(k);
      if (!d) { d = { tipo: 'ped', id: k, raw: r.pedido, v: 0, _cli: {}, _uf: {}, _vt: {}, _st: {}, _cr: {}, _lib: {}, _prev: {} }; m.set(k, d); }
      var v = num(r.valor);
      d.v += v;
      soma(d._cli, r.cliente, v); soma(d._uf, r.estado, v); soma(d._vt, r.vertical, v); soma(d._st, r.status, v);
      soma(d._cr, isoDe(r.criacao), 1); soma(d._lib, isoDe(r.liberacao), 1); soma(d._prev, isoDe(r.previsao), 1);
    });
    var out = [];
    m.forEach(function (d) {
      d.cliente = porValor(d._cli)[0] || null;
      d.uf = porValor(d._uf)[0] || null;
      d.verts = porValor(d._vt);
      d.sts = porValor(d._st);
      d.stV = d._st;                               // valor por status (o pedido pode ter itens em dois)
      d.stP = d.sts[0] || null;
      d.cria = menor(d._cr); d.lib = menor(d._lib); d.prev = menor(d._prev);
      d.txt = norm([d.id, d.cliente, d.uf, d.verts.join(' '), d.sts.join(' '), fData(d.prev), fData(d.lib)].join(' '));
      out.push(d);
    });
    return out;
  }
  function docsNotas(rows) {
    var m = new Map();
    (rows || []).forEach(function (r) {
      var k = r.nf == null ? '' : String(r.nf);
      if (!k) return;
      var d = m.get(k);
      if (!d) { d = { tipo: 'nf', id: k, raw: r.nf, v: 0, _cli: {}, _uf: {}, _vt: {}, _fam: {} }; m.set(k, d); }
      var v = num(r.fat);
      d.v += v;
      soma(d._cli, r.cliente, v); soma(d._uf, r.estado, v); soma(d._vt, r.vertical, v);
      var fk = (r.familia || '—') + '\u0001' + (r.vertical || '');
      d._fam[fk] = (d._fam[fk] || 0) + v;
    });
    var out = [];
    m.forEach(function (d) {
      d.cliente = porValor(d._cli)[0] || null;
      d.uf = porValor(d._uf)[0] || null;
      d.verts = porValor(d._vt);
      d.stV = d._vt;
      d.fams = porValor(d._fam).map(function (k) { var p = k.split('\u0001'); return { fam: p[0], vert: p[1] || null, v: d._fam[k] }; });
      d.txt = norm([d.id, d.cliente, d.uf, d.verts.join(' '), d.fams.map(function (f) { return f.fam; }).join(' ')].join(' '));
      out.push(d);
    });
    return out;
  }

  // a divisão do totalizador: status (pedidos) ou vertical (notas).
  // Até 4 grupos com cor; passou disso, os 3 maiores + "outras".
  function series(st) {
    var acc = {}, n = {};
    st.docs.forEach(function (d) {
      Object.keys(d.stV).forEach(function (k) { acc[k] = (acc[k] || 0) + d.stV[k]; n[k] = (n[k] || 0) + 1; });
    });
    var ks = porValor(acc), tot = 0;
    ks.forEach(function (k) { tot += acc[k]; });
    var out = [], livres = [1, 2, 3, 4];
    if (st.tipo === 'ped') ks.forEach(function (k) { var s = SLOT_STATUS[k]; if (s) livres.splice(livres.indexOf(s), 1); });
    var cabe = ks.length <= 4 ? ks : ks.slice(0, 3);
    cabe.forEach(function (k) {
      var slot = st.tipo === 'ped' && SLOT_STATUS[k] ? SLOT_STATUS[k] : (livres.shift() || 0);
      out.push({ k: k, nome: st.tipo === 'ped' ? frase(k) : k, slot: slot, v: acc[k], n: n[k], p: tot ? acc[k] / tot : 0 });
    });
    if (cabe.length < ks.length) {
      var resto = ks.slice(cabe.length), v = 0, docs = 0;
      resto.forEach(function (k) { v += acc[k]; });
      st.docs.forEach(function (d) { if (resto.some(function (k) { return d.stV[k] != null; })) docs++; });
      out.push({ k: OUTRAS, nome: st.tipo === 'ped' ? 'Outros status' : 'Outras verticais', slot: 0, v: v, n: docs, p: tot ? v / tot : 0, resto: resto });
    }
    return out;
  }
  function slotDe(st, k) { for (var i = 0; i < st.series.length; i++) { if (st.series[i].k === k) return st.series[i].slot; } return 0; }

  // ══════════════════════════════════════════════════════════════
  // LINHAS DA OV (ficha do pedido)
  // ══════════════════════════════════════════════════════════════
  var LINHA = ['linha', 'linhas'];
  function emAndamento(k) { return k === EPL || k === AGF; }
  function ordSt(k) { return k === EPL ? 0 : k === AGF ? 1 : 2; }
  // a OV inteira: o que a lista conta (status em andamento) e o que fica
  // fora, quanto já tem data de liberação para o depósito e os grupos por
  // status (em andamento primeiro, na ordem da lista; os outros por valor)
  function resumoLinhas(rows) {
    var R = { n: 0, v: 0, qt: 0, temQ: false, and: { n: 0, v: 0 }, fora: { n: 0, v: 0 },
      lib: { n: 0, v: 0, ini: null, fim: null }, sem: { n: 0, v: 0 }, grupos: [] };
    var g = {};
    (rows || []).forEach(function (x) {
      R.n++; R.v += x.v;
      if (x.qt != null && isFinite(x.qt)) { R.qt += x.qt; R.temQ = true; }
      var a = emAndamento(x.st) ? R.and : R.fora; a.n++; a.v += x.v;
      if (x.lib) {
        R.lib.n++; R.lib.v += x.v;
        if (!R.lib.ini || x.lib < R.lib.ini) R.lib.ini = x.lib;
        if (!R.lib.fim || x.lib > R.lib.fim) R.lib.fim = x.lib;
      } else { R.sem.n++; R.sem.v += x.v; }
      var k = x.st || '';
      if (!g[k]) { g[k] = { st: x.st || null, n: 0, v: 0, rows: [] }; R.grupos.push(g[k]); }
      g[k].n++; g[k].v += x.v; g[k].rows.push(x);
    });
    R.grupos.sort(function (a, b) { return ordSt(a.st) - ordSt(b.st) || b.v - a.v; });
    return R;
  }
  // o passo "Liberado para o depósito": com as linhas da OV lidas, conta
  // linha a linha (a liberação pode ser parcial); antes, a data da lista
  function passoLib(doc, R) {
    var tt = 'Liberado para o depósito';
    if (!R || !R.n) {
      return doc.lib
        ? { cls: 'feito', tt: tt, dt: fData(doc.lib), ds: 'Liberado ' + relDia(doc.lib) + ' para separação.' }
        : { cls: '', tt: tt, dt: 'sem data', z: true, ds: 'O ERP ainda não traz a data de liberação deste pedido.' };
    }
    var lb = R.lib;
    if (!lb.n) {
      return { cls: '', tt: tt, dt: 'sem data', z: true,
        ds: (R.n === 1 ? 'A linha da OV não tem' : 'Nenhuma das ' + plural(R.n, LINHA) + ' da OV tem') + ' data de liberação para o depósito no ERP.' };
    }
    var quando = lb.ini === lb.fim ? 'em ' + fData(lb.ini) + ', ' + relDia(lb.ini) : 'entre ' + fData(lb.ini) + ' e ' + fData(lb.fim);
    if (!R.sem.n) {
      return { cls: 'feito', tt: tt, dt: fData(lb.ini),
        ds: (R.n === 1 ? 'Liberado ' + quando + ', para separação.' : 'Todas as ' + plural(R.n, LINHA) + ' da OV liberadas ' + quando + '.') };
    }
    return { cls: 'parcial', tt: tt + ' · parcial', dt: fData(lb.ini), warn: true,
      ds: fInt(lb.n) + ' de ' + plural(R.n, LINHA) + ' (' + fBRL(lb.v) + ') liberadas ' + quando + '; ' +
        plural(R.sem.n, LINHA) + ' (' + fBRL(R.sem.v) + ') ainda sem data de liberação no ERP.' };
  }

  // ══════════════════════════════════════════════════════════════
  // TOTALIZADOR (faixa navy)
  // ══════════════════════════════════════════════════════════════
  function pintarHero(tipo) {
    var st = L[tipo], P = 'sd-' + tipo + '-';
    var docs = st.docs;
    var total = st.total != null ? st.total : docs.reduce(function (s, d) { return s + d.v; }, 0);
    var qtd = st.qtd != null ? st.qtd : docs.length;
    var clis = {}; docs.forEach(function (d) { if (d.cliente) clis[d.cliente] = 1; });
    var nCli = Object.keys(clis).length;
    if (tipo === 'nf') {
      var h = st.dia || hojeISO();
      setTxt(P + 'chip', 'hoje · ' + diaSem(h) + ' ' + fDM(h));
    }
    // lista que falhou sem medida de reserva: "—" (zero seria mentira)
    setHTML(P + 'v', st.erro && !docs.length && st.total == null ? '—' : fBRLp(total));
    setHTML(P + 'st',
      '<div><span class="k">' + (tipo === 'ped' ? 'Pedidos' : 'Notas') + '</span><span class="v">' + esc(fInt(qtd)) + '</span></div>' +
      '<div><span class="k">Clientes</span><span class="v">' + esc(fInt(nCli)) + '</span></div>' +
      '<div><span class="k">Ticket médio</span><span class="v">' + (qtd ? esc(fMi(total / qtd)) : '—') + '</span></div>');
    // barra empilhada + legenda (que é filtro)
    var sr = st.series, bar = D.getElementById(P + 'split'), leg = D.getElementById(P + 'leg');
    var tem = st.seg != null;
    if (bar) {
      bar.classList.toggle('tem-sel', tem);
      bar.innerHTML = sr.map(function (s) {
        return '<span class="c' + s.slot + (s.k === st.seg ? ' on' : '') + '" style="--w:' + Math.max(s.v, 0) + '" title="' +
          esc(s.nome + ' · ' + plural(s.n, NOME[tipo]) + ' · ' + fBRL(s.v) + ' (' + fPct(s.p) + ')') + '"></span>';
      }).join('');
      bar.hidden = !sr.length;
    }
    if (leg) {
      leg.classList.toggle('tem-sel', tem);
      leg.setAttribute('aria-label', tipo === 'ped' ? 'Filtrar a lista por status' : 'Filtrar a lista por vertical');
      leg.innerHTML = sr.map(function (s) {
        var on = s.k === st.seg;
        return '<button type="button" class="c' + s.slot + (on ? ' on' : '') + '" data-sd-seg="' + tipo + '" data-k="' + esc(s.k) + '" aria-pressed="' + on + '" title="' +
          esc((on ? 'mostrar todos' : 'mostrar só ' + s.nome) + (s.resto ? ' (' + s.resto.join(', ') + ')' : '')) + '">' +
          '<i></i><span class="n">' + esc(s.nome) + '</span><b>' + esc(fInt(s.n)) + '</b><span class="p">· ' + esc(fMi(s.v)) + '</span></button>';
      }).join('');
    }
  }

  // ══════════════════════════════════════════════════════════════
  // A LISTA
  // ══════════════════════════════════════════════════════════════
  function filtrar(st) {
    var q = norm(st.busca).trim(), sel = st.seg, serie = null;
    if (sel != null) st.series.forEach(function (s) { if (s.k === sel) serie = s; });
    return st.docs.filter(function (d) {
      if (sel != null) {
        if (serie && serie.resto) { if (!serie.resto.some(function (k) { return d.stV[k] != null; })) return false; }
        else if (d.stV[sel] == null) return false;
      }
      if (q) {
        var ps = q.split(/\s+/);
        for (var i = 0; i < ps.length; i++) if (ps[i] && d.txt.indexOf(ps[i]) < 0) return false;
      }
      return true;
    });
  }
  function ordenar(st, lista) {
    var o = st.ord || { k: 'v', d: -1 }, col = null;
    COLS[st.tipo].forEach(function (c) { if (c.k === o.k) col = c; });
    if (!col) return lista;
    return lista.slice().sort(function (a, b) {
      var x = col.o(a), y = col.o(b);
      var vx = x == null || x === '', vy = y == null || y === '';
      if (vx || vy) return vx && vy ? b.v - a.v : (vx ? 1 : -1);    // vazio vai pro fim nos dois sentidos
      if (typeof x === 'number' && typeof y === 'number') return o.d * (x - y) || b.v - a.v;
      return o.d * String(x).localeCompare(String(y), 'pt-BR', { numeric: true }) || b.v - a.v;
    });
  }
  // sub-linhas: .so-l no cartão largo, .so-n no estreito (3 colunas — o
  // status/a família e a previsão/o % do dia sobem para elas)
  function sub(txt, cls) { return txt ? '<span class="s ' + cls + '">' + txt + '</span>' : ''; }
  function pesoDia(d, st) { var tot = st.total || st.docs.reduce(function (a, x) { return a + x.v; }, 0); return tot ? fPct(d.v / tot) + ' do dia' : ''; }
  function celula(d, col, st) {
    var c = col.cls;
    switch (col.k) {
      case 'id': {
        var l, n;
        if (d.tipo === 'ped') {
          l = d.cria ? esc('criado ' + fDM(d.cria) + ' · ' + relDia(d.cria)) : '';
          n = d.stP ? '<i class="sd-dot c' + slotDe(st, d.stP) + '"></i>' + esc(frase(d.stP) + (d.sts.length > 1 ? ' +' + (d.sts.length - 1) : '')) : '';
        } else {
          l = esc(pesoDia(d, st));
          n = d.fams.length ? esc(d.fams[0].fam + (d.fams.length > 1 ? ' +' + (d.fams.length - 1) : '')) : '';
        }
        return '<td class="' + c + '"><span class="t">' + esc(d.id) + '</span>' + sub(l, 'so-l') + sub(n, 'so-n') + '</td>';
      }
      case 'cli': {
        var vu = [d.verts.slice(0, 2).join(' + ') + (d.verts.length > 2 ? ' +' + (d.verts.length - 2) : ''), d.uf].filter(Boolean).join(' · ');
        return '<td class="' + c + '" title="' + esc(d.cliente || '') + '"><span class="t">' + esc(d.cliente || '—') + '</span>' +
          (vu ? '<span class="s">' + esc(vu) + '</span>' : '') + '</td>';
      }
      case 'st': {
        var b = d.sts.map(function (k) { return badge(k, slotDe(st, k)); }).join(' ');
        return '<td class="' + c + '">' + (b || '<span class="s">—</span>') +
          (d.lib ? '<span class="s">liberado ' + esc(fDM(d.lib)) + '</span>' : '') + '</td>';
      }
      case 'prev': {
        if (!d.prev) return '<td class="' + c + ' z"><b>sem previsão</b></td>';
        var late = atrasada(d.prev);
        return '<td class="' + c + (late ? ' warn' : '') + '"><span class="k">Previsão</span><b>' + esc(fData(d.prev)) + '</b><span class="s' + (late ? ' warn' : '') + '">' +
          esc(late ? 'atrasada · ' + relDia(d.prev) : diaSem(d.prev) + ' · ' + relDia(d.prev)) + '</span></td>';
      }
      case 'fam': {
        var f = d.fams[0], resto = d.fams.slice(1).map(function (x) { return x.fam; });
        return '<td class="' + c + '" title="' + esc(d.fams.map(function (x) { return x.fam; }).join(' · ')) + '"><span class="t">' + esc(f ? f.fam : '—') + '</span>' +
          (resto.length ? '<span class="s">+ ' + esc(resto.join(' · ')) + '</span>' : '') + '</td>';
      }
      case 'v': {
        var vn = '';
        if (d.tipo === 'nf') vn = sub(esc(pesoDia(d, st)), 'so-n');
        else if (d.prev) vn = atrasada(d.prev) ? sub(esc('atrasada · prev. ' + fDM(d.prev)), 'so-n warn') : sub(esc('prev. ' + fDM(d.prev)), 'so-n');
        return '<td class="' + c + '">' + esc(fBRL(d.v)) + vn + '</td>';
      }
    }
    return '<td></td>';
  }
  function badge(k, slot) { return '<span class="sd-badge c' + (slot || 0) + '"><i></i>' + esc(frase(k)) + '</span>'; }

  function pintarLista(tipo) {
    var st = L[tipo], P = 'sd-' + tipo + '-';
    var tb = D.getElementById(P + 'tb'); if (!tb) return;
    var cols = COLS[tipo];
    var o = st.ord || { k: 'v', d: -1 };
    tb.tHead.innerHTML = '<tr>' + cols.map(function (c) {
      var on = o.k === c.k;
      return '<th class="ord ' + c.cls + (c.num ? ' num' : '') + '" data-k="' + c.k + '" tabindex="0" aria-sort="' + (on ? (o.d === 1 ? 'ascending' : 'descending') : 'none') +
        '" title="' + esc(c.dica || ('ordenar por ' + c.l.toLowerCase())) + '">' + esc(c.l) + (on ? '<span class="seta">' + (o.d === 1 ? '▲' : '▼') + '</span>' : '') + '</th>';
    }).join('') + '</tr>';
    var sel = D.getElementById(P + 'ord');
    if (sel) { var vv = o.k + ':' + o.d; sel.value = ORD_M[tipo].some(function (x) { return x[0] === vv; }) ? vv : ''; }

    var body = tb.tBodies[0], foot = tb.tFoot, mais = D.getElementById(P + 'mais');
    var lista = filtrar(st);
    var serie = null; st.series.forEach(function (s) { if (s.k === st.seg) serie = s; });
    var fx = D.getElementById(P + 'fx');
    if (fx) { fx.hidden = !serie; fx.textContent = serie ? '✕ só ' + serie.nome : ''; fx.title = serie ? 'mostrar todos' : ''; }
    var somaV = lista.reduce(function (s, d) { return s + d.v; }, 0);
    var filtrou = lista.length !== st.docs.length;
    setHTML(P + 'info', st.docs.length
      ? '<b>' + esc(filtrou ? fInt(lista.length) + ' de ' + plural(st.docs.length, NOME[tipo]) : plural(lista.length, NOME[tipo])) + '</b> · ' + esc(fMi(somaV))
      : '');

    if (st.erro && !st.docs.length) {
      body.innerHTML = '<tr class="sd-vz-r"><td class="sd-vz erro" colspan="' + cols.length + '">Não deu para ler ' + (tipo === 'ped' ? 'os pedidos' : 'as notas') +
        ' agora: <b>' + esc(String(st.erro).slice(0, 140)) + '</b></td></tr>';
      foot.innerHTML = ''; st.vistos = []; if (mais) mais.hidden = true; return;
    }
    if (!lista.length) {
      var msg = !st.docs.length
        ? (tipo === 'ped' ? 'Nenhum pedido em andamento neste recorte.' : 'Nenhuma nota fiscal emitida hoje até agora.')
        : (st.busca.trim() ? 'Nada com “' + esc(st.busca.trim()) + '”.' : (tipo === 'ped' ? 'Nenhum pedido' : 'Nenhuma nota') + ' neste grupo.');
      body.innerHTML = '<tr class="sd-vz-r"><td class="sd-vz" colspan="' + cols.length + '">' + msg + '</td></tr>';
      foot.innerHTML = ''; st.vistos = []; if (mais) mais.hidden = true; return;
    }
    var ord = ordenar(st, lista), vis = ord.slice(0, st.lim);
    st.vistos = ord;                                 // a ordem da tela: a ficha anda por ela (‹ ›)
    var aberta = DW.doc && DW.doc.tipo === tipo ? DW.doc.id : null;
    body.innerHTML = vis.map(function (d) {
      var tt = (tipo === 'ped' ? 'Pedido ' : 'Nota fiscal ') + d.id + ' — clique para abrir a ficha';
      return '<tr data-sd-doc="' + tipo + ':' + esc(encodeURIComponent(d.id)) + '" tabindex="0" title="' + esc(tt) + '"' + (d.id === aberta ? ' class="is-aberta"' : '') + '>' +
        cols.map(function (c) { return celula(d, c, st); }).join('') + '</tr>';
    }).join('');
    // o rótulo cobre nº + cliente (sempre visíveis); as colunas do meio ganham
    // célula própria — no cartão estreito elas somem e o valor segue alinhado
    foot.innerHTML = '<tr><td colspan="2">Total · ' + esc(filtrou ? fInt(lista.length) + ' de ' + plural(st.docs.length, NOME[tipo]) : plural(lista.length, NOME[tipo])) + '</td>' +
      cols.slice(2, -1).map(function (c) { return '<td class="' + c.cls + '"></td>'; }).join('') +
      '<td class="c-v">' + esc(fBRL(somaV)) + '</td></tr>';
    var resto = ord.length - vis.length;
    if (mais) {
      mais.hidden = resto <= 0;
      if (resto > 0) mais.innerHTML = 'Mostrar mais ' + esc(fInt(Math.min(PASSO, resto))) + '<span class="sd-mais-n">faltam ' + esc(fInt(resto)) + '</span>';
    }
  }
  function repintar(tipo) { pintarHero(tipo); pintarLista(tipo); }

  function receber(tipo, dados, ctx, totais) {
    var st = L[tipo];
    dados = dados || {};
    st.docs = tipo === 'ped' ? docsPedidos(dados.rows) : docsNotas(dados.rows);
    st.erro = dados.erro || null;
    st.ctx = ctx || null;
    st.dia = ctx && ctx.dia ? ctx.dia : null;
    if (tipo === 'ped') {
      st.total = totais && totais.valor != null ? totais.valor : (dados.total != null ? dados.total : null);
      st.qtd = totais && totais.qtd != null ? totais.qtd : (dados.qtd != null ? dados.qtd : null);
    } else {
      st.total = dados.total != null ? dados.total : null;
      st.qtd = dados.qtd != null ? dados.qtd : null;
    }
    st.series = series(st);
    if (st.seg != null && !st.series.some(function (s) { return s.k === st.seg; })) st.seg = null;   // o grupo sumiu com o filtro novo
    st.lim = PASSO; st.pronto = true;
    var card = D.getElementById('sd-' + tipo); if (card) card.classList.remove('is-load');
    repintar(tipo);
  }

  // ── núcleo puro: no Node (teste) o arquivo para aqui ────────────
  var CORE = {
    docsPedidos: docsPedidos, docsNotas: docsNotas, series: series, filtrar: filtrar, ordenar: ordenar,
    celula: celula, COLS: COLS, CAMPOS: CAMPOS, OUTRAS: OUTRAS, PASSO: PASSO,
    predDoc: predDoc, baseDoc: baseDoc, daxItens: daxItens, daxDet: daxDet, lerItens: lerItens, juntar: juntar, campo: campo, msgErro: msgErro,
    resumoLinhas: resumoLinhas, passoLib: passoLib, linhasH: linhasH,
    isoDe: isoDe, relDia: relDia, hojeISO: hojeISO, fMi: fMi, fPct: fPct,
    novo: function (tipo, docs) { var st = novo(tipo); st.docs = docs || []; st.series = series(st); return st; }
  };
  if (typeof module === 'object' && module.exports) { module.exports = CORE; return; }

  if (root.SRDiario) return;
  var D = root.document;
  // memória de OLS do freio (pbi-throttle.js): campo bloqueado para o usuário
  // sai da consulta combinada da ficha e ela volta a ser 1 consulta só
  var OLSM = (root.PBIQ && root.PBIQ.ols) || { vivas: function (l) { return l; }, aprender: function () { }, leque: function () { return true; } };

  // ══════════════════════════════════════════════════════════════
  // FICHA — painel à direita
  // ══════════════════════════════════════════════════════════════
  var DW = { el: null, ov: null, doc: null, volta: null };
  var CACHE = new Map();          // tipo|id|filtros → { itens, det }
  var TOK = 0;
  var IC_X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var IC_ANT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
  var IC_PROX = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
  var IC_CP = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  function montar() {
    if (DW.el) return;
    DW.ov = D.createElement('div'); DW.ov.className = 'sd-dw-ov';
    DW.el = D.createElement('aside'); DW.el.className = 'sd-dw';
    DW.el.setAttribute('role', 'dialog'); DW.el.setAttribute('aria-modal', 'true'); DW.el.setAttribute('aria-labelledby', 'sd-dw-tt');
    DW.el.innerHTML =
        '<div class="sd-dw-head">'
      +   '<div class="sd-dw-hl"><div class="sd-dw-k" id="sd-dw-k"></div><h2 class="sd-dw-tt" id="sd-dw-tt"></h2>'
      +   '<div class="sd-dw-sub" id="sd-dw-sub"></div><div class="sd-dw-tags" id="sd-dw-tags"></div></div>'
      +   '<div class="sd-dw-nav">'
      +     '<button type="button" class="sd-dw-pn" data-sd-dw="ant" aria-label="Anterior da lista" title="Anterior da lista (←)">' + IC_ANT + '</button>'
      +     '<button type="button" class="sd-dw-pn" data-sd-dw="prox" aria-label="Próximo da lista" title="Próximo da lista (→)">' + IC_PROX + '</button>'
      +     '<button type="button" class="sd-dw-x" data-sd-dw="fechar" aria-label="Fechar a ficha" title="Fechar (Esc)">' + IC_X + '</button>'
      +   '</div>'
      + '</div>'
      + '<div class="sd-dw-body" id="sd-dw-body"></div>'
      + '<div class="sd-dw-foot"><button type="button" class="sd-dw-cp" data-sd-dw="copiar">' + IC_CP + '<span id="sd-dw-cpt">Copiar nº</span></button>'
      +   '<span class="sd-dw-lido" id="sd-dw-lido"></span><button type="button" class="sd-dw-btn" data-sd-dw="fechar">Fechar</button></div>';
    D.body.appendChild(DW.ov); D.body.appendChild(DW.el);
    DW.ov.addEventListener('click', fechar);
    DW.el.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-sd-dw]') : null; if (!b) return;
      var a = b.getAttribute('data-sd-dw');
      if (a === 'fechar') fechar();
      else if (a === 'ant') andar(-1);
      else if (a === 'prox') andar(1);
      else if (a === 'copiar') copiar();
      else if (a === 'tentar') { var ent = entrada(DW.doc); if (ent) { ent.itens = null; ent.det = null; } carregar(DW.doc); }
    });
    D.addEventListener('keydown', function (e) {
      if (!DW.el.classList.contains('open')) return;
      if (e.key === 'Escape') { e.preventDefault(); fechar(); return; }
      if (e.key === 'Tab') { prender(e); return; }
      var t = e.target, digitando = t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
      if (!digitando && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); andar(e.key === 'ArrowLeft' ? -1 : 1); }
    });
  }
  // o foco não sai da ficha enquanto ela está aberta
  function prender(e) {
    var fs = Array.prototype.filter.call(DW.el.querySelectorAll('button, a[href], summary, [tabindex]:not([tabindex="-1"])'), function (x) { return !x.disabled && x.offsetParent !== null; });
    if (!fs.length) return;
    var a = fs[0], z = fs[fs.length - 1];
    if (e.shiftKey && (D.activeElement === a || !DW.el.contains(D.activeElement))) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && (D.activeElement === z || !DW.el.contains(D.activeElement))) { e.preventDefault(); a.focus(); }
  }
  function acharDoc(tipo, id) { var st = L[tipo]; for (var i = 0; i < st.docs.length; i++) if (st.docs[i].id === id) return st.docs[i]; return null; }
  function abrir(tipo, id, origem) {
    var doc = acharDoc(tipo, id); if (!doc) return;
    montar();
    DW.doc = doc; DW.volta = origem || D.activeElement;
    DW.ov.classList.add('open'); DW.el.classList.add('open');
    D.documentElement.classList.add('sd-dw-on');
    marcarAberta();
    pintarFicha();
    D.getElementById('sd-dw-body').scrollTop = 0;
    setTimeout(function () { try { DW.el.querySelector('.sd-dw-x').focus(); } catch (e) { } }, 40);
    carregar(doc);
  }
  function fechar() {
    if (!DW.el || !DW.el.classList.contains('open')) return;
    DW.el.classList.remove('open'); DW.ov.classList.remove('open');
    D.documentElement.classList.remove('sd-dw-on');
    var doc = DW.doc; DW.doc = null;
    marcarAberta();
    // o foco volta para a linha do documento que estava na ficha (andou com ‹ ›?)
    var alvo = doc ? linhaDoDoc(doc) : null;
    var f = alvo || DW.volta;
    if (f && f.focus) { try { f.focus(); } catch (e) { } }
  }
  // o atributo guarda o nº já passado por encodeURIComponent: no seletor entre
  // aspas só " e \ precisam de escape
  function linhaDoDoc(doc) {
    return D.querySelector('tr[data-sd-doc="' + doc.tipo + ':' + encodeURIComponent(doc.id).replace(/["\\]/g, '\\$&') + '"]');
  }
  function marcarAberta() {
    D.querySelectorAll('tr.is-aberta[data-sd-doc]').forEach(function (tr) { tr.classList.remove('is-aberta'); });
    if (!DW.doc) return;
    var tr = linhaDoDoc(DW.doc);
    if (tr) tr.classList.add('is-aberta');
  }
  function vizinhos() {
    var doc = DW.doc; if (!doc) return { i: -1, lista: [] };
    var lista = L[doc.tipo].vistos || [];
    return { i: lista.indexOf(doc), lista: lista };
  }
  function andar(dir) {
    var v = vizinhos(); if (v.i < 0) return;
    var nx = v.lista[v.i + dir]; if (!nx) return;
    var st = L[nx.tipo];
    // passou do que está pintado: pinta mais um bloco para a linha existir
    if (v.i + dir >= st.lim) { st.lim += PASSO; pintarLista(nx.tipo); }
    DW.doc = nx;
    marcarAberta();
    var tr = D.querySelector('tr.is-aberta[data-sd-doc]');
    if (tr && tr.scrollIntoView) { try { tr.scrollIntoView({ block: 'nearest' }); } catch (e) { } }
    pintarFicha();
    D.getElementById('sd-dw-body').scrollTop = 0;
    carregar(nx);
  }
  function copiar() {
    var doc = DW.doc; if (!doc) return;
    var b = DW.el.querySelector('.sd-dw-cp'), t = D.getElementById('sd-dw-cpt');
    var ok = function () {
      b.classList.add('ok'); t.textContent = 'Copiado';
      clearTimeout(copiar._t); copiar._t = setTimeout(function () { b.classList.remove('ok'); t.textContent = 'Copiar nº'; }, 1600);
    };
    var reserva = function () {
      try {
        var ta = D.createElement('textarea'); ta.value = doc.id; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        D.body.appendChild(ta); ta.select(); D.execCommand('copy'); D.body.removeChild(ta); ok();
      } catch (e) { }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(doc.id).then(ok, reserva); else reserva();
  }

  // ── leitura no Power BI: itens e dados do documento ────────────
  function q(tipo) {
    var c = L[tipo].ctx;
    var fn = (c && c.query) || (root.PBIData && root.PBIData.query);
    if (!fn) return function () { return Promise.reject(new Error('Power BI ainda não conectado')); };
    return fn;
  }
  function predDoc(doc) {
    var col = COL_DOC[doc.tipo];
    return typeof doc.raw === 'number' ? col + ' = ' + doc.raw : col + ' = "' + String(doc.raw).replace(/"/g, '""') + '"';
  }
  // pedido: a OV INTEIRA — só o nº, sem o filtro-base da lista (status em
  // andamento, intercompany, operação): a ficha mostra todas as linhas e diz
  // quais a lista conta. Nota: o filtro-base + o nº (soma igual à lista).
  function baseDoc(doc) {
    if (doc.tipo === 'ped') return [predDoc(doc)];
    var c = L[doc.tipo].ctx; return ((c && c.filtros) || []).concat(predDoc(doc));
  }
  function entrada(doc) {
    if (!doc) return null;
    var k = doc.tipo + '|' + doc.id + '|' + baseDoc(doc).join('&');
    var e = CACHE.get(k);
    if (!e) { e = { itens: null, det: null }; CACHE.set(k, e); if (CACHE.size > 120) CACHE.delete(CACHE.keys().next().value); }
    return e;
  }
  // o pbiQuery da página devolve "HTTP 400: <100 caracteres do JSON>" — sem
  // o detalhe do serviço, diz só que o Power BI recusou (JSON cortado não ajuda)
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
  // base = baseDoc. `cheio` = com a coluna que pode faltar ou estar bloqueada
  // (nota: a medida de quantidade; pedido: o status da liberação)
  function daxItens(doc, base, cheio) {
    var f = base.join(', ');
    if (doc.tipo === 'ped') {
      var cols = ["'Produtos'[Cód. produto]", "'Produtos'[Produto]", "'Famílias'[Família]"].concat(COLS_LINHA, cheio ? [COL_STLIB] : []);
      return 'EVALUATE CALCULATETABLE(ADDCOLUMNS(SUMMARIZE(Pedidos, ' + cols.join(', ') + '), ' +
        '"Qt", CALCULATE(SUM(Pedidos[Quantidade])), "PU", CALCULATE(AVERAGE(Pedidos[Preço unitário])), "Tot", CALCULATE(SUM(Pedidos[Preço total]))), ' + f + ')';
    }
    return "EVALUATE CALCULATETABLE(ADDCOLUMNS(SUMMARIZE(Faturamentos, 'Produtos'[Cód. produto], 'Produtos'[Produto], 'Famílias'[Família]), " +
      '"Fat", [Faturamento]' + (cheio ? ', "Qt", [Faturamento (quantidade)]' : '') + '), ' + f + ')';
  }
  function daxDet(doc, base, campos) {
    return 'EVALUATE CALCULATETABLE(SUMMARIZE(' + FATO[doc.tipo] + ', ' + campos.map(function (c) { return c[2]; }).join(', ') + '), ' + base.join(', ') + ')';
  }
  function lerItens(doc, rows) {
    return (rows || []).map(function (r) {
      var o = {
        cod: campo(r, "'Produtos'[Cód. produto]"), prod: campo(r, "'Produtos'[Produto]"), fam: campo(r, "'Famílias'[Família]"),
        qt: campo(r, '[Qt]')
      };
      if (doc.tipo === 'ped') {
        o.pu = campo(r, '[PU]'); o.v = num(campo(r, '[Tot]'));
        var s = campo(r, COLS_LINHA[0]), sl = campo(r, COL_STLIB);
        o.st = s == null || String(s).trim() === '' ? null : String(s).trim();
        o.lib = isoDe(campo(r, COLS_LINHA[1]));
        o.prev = isoDe(campo(r, COLS_LINHA[2]));
        o.stlib = sl == null || String(sl).trim() === '' ? null : String(sl).trim();
      } else o.v = num(campo(r, '[Fat]'));
      o.qt = o.qt == null || o.qt === '' ? null : Number(o.qt);
      o.pu = o.pu == null || o.pu === '' ? null : Number(o.pu);
      return o;
    }).filter(function (o) { return o.prod != null || o.cod != null || o.v; })
      .sort(function (a, b) { return b.v - a.v; });
  }
  // várias linhas (o campo varia entre os itens) → valores distintos por campo
  function juntar(rows, campos, vals) {
    vals = vals || {};
    campos.forEach(function (c) {
      var vistos = [];
      (rows || []).forEach(function (r) {
        var v = campo(r, c[2]);
        if (v == null || v === '') return;
        var s = /^Data/.test(c[1]) ? fData(isoDe(v)) : String(v).trim();
        if (s && vistos.indexOf(s) < 0) vistos.push(s);
      });
      if (vistos.length) vals[c[0]] = vistos;
    });
    return vals;
  }
  function carregar(doc) {
    var ent = entrada(doc); if (!ent) return;
    var tok = ++TOK, fn = q(doc.tipo), base = baseDoc(doc);
    ent.tok = tok;
    var pinta = function () { if (DW.doc === doc) pintarFicha(); };
    if (!ent.itens || ent.itens.st !== 'ok') {
      ent.itens = { st: 'carregando' }; pinta();
      var achou = function (rows) { if (ent.tok !== tok && ent.itens.st === 'ok') return; ent.itens = { st: 'ok', rows: lerItens(doc, rows), em: new Date() }; pinta(); };
      var falhou = function (e) { ent.itens = { st: 'erro', erro: msgErro(e) }; pinta(); };
      // a coluna opcional (nota: a medida de quantidade; pedido: o status da
      // liberação) pode não existir/estar bloqueada: sem ela, o resto. O
      // status da liberação que o freio já sabe bloqueado nem é tentado.
      var cheio = doc.tipo === 'nf' || OLSM.vivas([COL_STLIB]).length > 0;
      if (!cheio) fn(daxItens(doc, base, false)).then(achou, falhou);
      else fn(daxItens(doc, base, true)).then(achou, function () { fn(daxItens(doc, base, false)).then(achou, falhou); });
    }
    if (!ent.det || ent.det.st !== 'ok') {
      ent.det = { st: 'carregando' }; pinta();
      var todos = CAMPOS[doc.tipo], vivos = OLSM.vivas(todos, function (c) { return c[2]; });
      var lista = vivos.length ? vivos : todos;
      fn(daxDet(doc, base, lista)).then(function (rows) {
        ent.det = { st: 'ok', vals: juntar(rows, lista), fora: todos.length - lista.length }; pinta();
      }, function (e) {
        // combinado recusado (OLS/coluna fora do modelo): campo a campo — em
        // paralelo, o freio do portal dosa — e o que for do modelo vai para a
        // memória do freio (a próxima ficha já sai sem ele, em 1 consulta)
        if (!OLSM.leque(e)) { ent.det = { st: 'erro', erro: msgErro(e) }; pinta(); return; }
        Promise.all(lista.map(function (c) {
          return fn(daxDet(doc, base, [c])).then(function (rows) { return { c: c, rows: rows }; }, function (e2) { return { c: c, e: e2 }; });
        })).then(function (rs) {
          var vals = {}, falhas = [];
          rs.forEach(function (x) { if (x.e) falhas.push([x.c[2], x.e]); else juntar(x.rows, [x.c], vals); });
          var algum = falhas.length < rs.length;
          OLSM.aprender(falhas, algum);
          ent.det = algum ? { st: 'ok', vals: vals, fora: falhas.length + todos.length - lista.length } : { st: 'erro', erro: msgErro(e) };
          pinta();
        });
      });
    }
  }

  // ── desenho da ficha ───────────────────────────────────────────
  function dl(pares) {
    return '<dl class="sd-dw-dl">' + pares.map(function (p) { return '<div' + (p[2] ? ' class="' + p[2] + '"' : '') + '><dt>' + esc(p[0]) + '</dt><dd>' + p[1] + '</dd></div>'; }).join('') + '</dl>';
  }
  function kp(k, v, s, cls, vcls, scls) {
    return '<div class="sd-dw-kp' + (cls ? ' ' + cls : '') + '"><div class="k">' + esc(k) + '</div><div class="v' + (vcls ? ' ' + vcls : '') + '">' + v + '</div>' +
      (s ? '<div class="s' + (scls ? ' ' + scls : '') + '">' + s + '</div>' : '') + '</div>';
  }
  function carregandoH(txt) { return '<div class="sd-dw-load"><span class="sd-spin"></span>' + esc(txt) + '</div>'; }
  function erroH(txt, e) { return '<div class="sd-dw-err"><span>' + esc(txt) + ': <b>' + esc(e) + '</b></span><button type="button" data-sd-dw="tentar">Tentar de novo</button></div>'; }

  function pintarFicha() {
    var doc = DW.doc; if (!doc || !DW.el) return;
    var st = L[doc.tipo], ent = entrada(doc) || {};
    var tot = st.docs.reduce(function (s, d) { return s + d.v; }, 0);
    var ehPed = doc.tipo === 'ped';
    setTxt('sd-dw-k', ehPed ? 'Pedido de venda · em andamento' : 'Nota fiscal · faturamento de hoje');
    setTxt('sd-dw-tt', ehPed ? doc.id : 'NF ' + doc.id);
    setTxt('sd-dw-sub', [doc.cliente, doc.uf].filter(Boolean).join(' · '));
    var tags = [];
    if (ehPed) doc.sts.forEach(function (k) { tags.push(badge(k, slotDe(st, k))); });
    doc.verts.forEach(function (v) { tags.push('<span class="sd-dw-tag az">' + esc(v) + '</span>'); });
    if (!ehPed) tags.push('<span class="sd-dw-tag vd">Emitida hoje</span>');
    setHTML('sd-dw-tags', tags.join(''));
    var v = vizinhos();
    DW.el.querySelector('[data-sd-dw="ant"]').disabled = v.i <= 0;
    DW.el.querySelector('[data-sd-dw="prox"]').disabled = v.i < 0 || v.i >= v.lista.length - 1;
    var em = ent.itens && ent.itens.em;
    setTxt('sd-dw-lido', em ? 'lido às ' + em.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + (v.i >= 0 ? ' · ' + (v.i + 1) + ' de ' + v.lista.length : '') : (v.i >= 0 ? (v.i + 1) + ' de ' + v.lista.length : ''));

    var h = ehPed ? fichaPedido(doc, st, ent, tot) : fichaNota(doc, st, ent, tot);
    D.getElementById('sd-dw-body').innerHTML = h;
  }

  function fichaPedido(doc, st, ent, tot) {
    var hoje = hojeISO(), late = atrasada(doc.prev);
    var R = ent.itens && ent.itens.st === 'ok' && ent.itens.rows.length ? resumoLinhas(ent.itens.rows) : null;
    var maior = R && R.v - doc.v > 0.05;            // a OV tem linhas que a lista não conta
    var h = '<div class="sd-dw-kpis">'
      + kp(maior ? 'Valor em andamento' : 'Valor do pedido', esc(fBRL(doc.v)),
          maior ? esc('de ' + fBRL(R.v) + ' da OV inteira') : (tot ? esc(fPct(doc.v / tot) + ' do valor em andamento') : ''), 'destaque')
      + kp('Criado em', doc.cria ? esc(fData(doc.cria)) : '—', doc.cria ? esc(diaSem(doc.cria, true) + ' · ' + relDia(doc.cria)) : 'sem data no ERP', '', doc.cria ? '' : 'z')
      + kp('Previsão de entrega', doc.prev ? esc(fData(doc.prev)) : '—',
          doc.prev ? esc(late ? 'atrasada · ' + relDia(doc.prev) : diaSem(doc.prev, true) + ' · ' + relDia(doc.prev)) : 'sem previsão no ERP',
          '', doc.prev ? (late ? 'warn' : '') : 'z', late ? 'warn' : (doc.prev === hoje ? 'hoje' : ''))
      + '</div>';

    // onde está o pedido — a explicação do status, passo a passo
    var stP = doc.stP, outros = doc.sts.slice(1);
    var agoraDs = (EXPLICA[stP] || 'Status informado pelo ERP.') +
      (outros.length ? ' Parte dos itens está em ' + outros.map(function (k) { return '“' + frase(k) + '” (' + fBRL(doc.stV[k]) + ')'; }).join(', ') + '.' : '');
    var passos = [
      { cls: doc.cria ? 'feito' : '', tt: 'Pedido registrado', dt: doc.cria ? fData(doc.cria) : 'sem data', z: !doc.cria, ds: 'Ordem de venda criada no ERP.' },
      passoLib(doc, R),
      { cls: 'agora', tt: 'Hoje: ' + (stP ? frase(stP) : 'em andamento'), dt: '', ds: agoraDs },
      { cls: 'depois', tt: 'Nota fiscal emitida', dt: '', ds: 'Quando a nota sai, o pedido deixa esta lista e entra no Faturamento Diário — aí passa a contar no faturamento.' },
      { cls: 'depois', tt: 'Entrega', dt: doc.prev ? fData(doc.prev) : 'sem previsão', z: !doc.prev, warn: late,
        ds: doc.prev ? (late ? 'A previsão de entrega já passou (' + relDia(doc.prev) + ') e o pedido segue em andamento.' : 'Previsão de entrega informada no ERP: ' + diaSem(doc.prev, true) + ', ' + relDia(doc.prev) + '.') : 'O ERP ainda não traz previsão de entrega.' }
    ];
    h += '<section class="sd-dw-card"><h5>Onde está o pedido</h5><ol class="sd-tl">' + passos.map(function (p) {
      return '<li class="' + p.cls + '"><span class="dot">' + (p.cls === 'feito' ? '✓' : '') + '</span><span class="tt">' + esc(p.tt) + '</span>' +
        '<span class="dt' + (p.z ? ' z' : '') + (p.warn ? ' warn' : '') + '">' + esc(p.dt) + '</span><span class="ds">' + esc(p.ds) + '</span></li>';
    }).join('') + '</ol></section>';

    h += secLinhas(doc, ent, st);
    h += secDados(doc, ent, 'Dados do pedido');
    h += '<details class="sd-dw-card sd-dw-mais"><summary><h5>Como entra nesta lista</h5></summary>'
      + '<p class="sd-dw-p">Entram os pedidos com status <b>em processo logístico</b> ou <b>aguardando faturamento</b>, de qualquer data de criação: é o retrato de hoje, e não muda com o período escolhido no filtro lá em cima.</p>'
      + '<p class="sd-dw-p">Fora intercompany e só operações que geram fatura a receber. Só a empresa <b>MSB</b>; o filtro de <b>Tipo de Cliente</b> vale aqui.</p>'
      + '<p class="sd-dw-p">Esta ficha mostra a <b>OV inteira</b>: todas as linhas, em qualquer status, com a liberação para o depósito e a previsão de entrega de cada uma. O valor da lista conta só as linhas em andamento.</p></details>';
    return h;
  }

  function fichaNota(doc, st, ent, tot) {
    var dia = st.dia || hojeISO();
    var h = '<div class="sd-dw-kpis">'
      + kp('Valor da nota', esc(fBRL(doc.v)), tot ? esc(fPct(doc.v / tot) + ' do faturado hoje') : '', 'destaque')
      + kp('Emissão', esc(fData(dia)), esc(diaSem(dia, true) + ' · ' + relDia(dia)), '', '', 'hoje')
      + kp(doc.fams.length === 1 ? 'Família' : 'Famílias', esc(fInt(doc.fams.length)), esc(doc.fams.length ? doc.fams[0].fam + (doc.fams.length > 1 ? ' e mais ' + (doc.fams.length - 1) : '') : '—'))
      + '</div>';
    // composição por família: o que forma o valor da nota
    h += '<section class="sd-dw-card"><h5>O que compõe a nota <small>' + esc(fInt(doc.fams.length)) + '</small></h5><div class="sd-cmp">' + doc.fams.map(function (f) {
      var p = doc.v ? f.v / doc.v : 0;
      return '<div class="sd-cmp-r"><span class="t">' + esc(f.fam) + (f.vert ? '<small>' + esc(f.vert) + '</small>' : '') + '</span>' +
        '<span class="v">' + esc(fBRL(f.v)) + '<small>' + esc(fPct(p)) + '</small></span>' +
        '<span class="tr" aria-hidden="true"><span style="--p:' + (Math.max(0, Math.min(1, p)) * 100).toFixed(1) + '%"></span></span></div>';
    }).join('') + '</div></section>';
    h += secItens(doc, ent, 'Itens da nota');
    h += secDados(doc, ent, 'Dados da nota');
    h += '<details class="sd-dw-card sd-dw-mais"><summary><h5>Como entra nesta lista</h5></summary>'
      + '<p class="sd-dw-p">Entram as notas fiscais com data de <b>hoje</b> (horário de Brasília): a lista não muda com o período escolhido no filtro lá em cima.</p>'
      + '<p class="sd-dw-p">Fora intercompany, só operações que geram fatura a receber e sem as notas ocultadas pelo negócio — as mesmas regras do faturamento do relatório. Só a empresa <b>MSB</b>; o filtro de <b>Tipo de Cliente</b> vale aqui.</p></details>';
    return h;
  }

  function secItens(doc, ent, titulo) {
    var it = ent.itens;
    if (!it || it.st === 'carregando') return '<section class="sd-dw-card"><h5>' + esc(titulo) + '</h5>' + carregandoH('Lendo os itens no Power BI…') + '</section>';
    if (it.st === 'erro') return '<section class="sd-dw-card"><h5>' + esc(titulo) + '</h5>' + erroH('Não deu para ler os itens', it.erro) + '</section>';
    var rows = it.rows;
    if (!rows.length) return '<section class="sd-dw-card"><h5>' + esc(titulo) + '</h5><div class="sd-dw-nada">O Power BI não trouxe itens para este documento.</div></section>';
    var tv = 0, tq = 0, temQ = false;
    rows.forEach(function (r) { tv += r.v; if (r.qt != null && isFinite(r.qt)) { tq += r.qt; temQ = true; } });
    var dif = Math.abs(tv - doc.v) > 0.05;
    return '<section class="sd-dw-card"><h5>' + esc(titulo) + ' <small>' + esc(fInt(rows.length)) + '</small></h5>'
      + '<div class="sd-its-r"><span>Total dos itens <b>' + esc(fBRL(tv)) + '</b></span>' + (temQ ? '<span><b>' + esc(fQtd(tq)) + '</b> ' + (tq === 1 ? 'unidade' : 'unidades') + '</span>' : '') + '</div>'
      + '<div class="sd-its">' + rows.map(function (r, i) {
        var meta = [r.cod ? 'cód. ' + r.cod : null, r.fam].filter(Boolean).join(' · ');
        var qx = r.qt != null && isFinite(r.qt) ? fQtd(r.qt) + (r.pu != null && isFinite(r.pu) ? ' × ' + fBRL(r.pu) : ' un.') : '';
        return '<div class="sd-it"><div class="n">' + (i + 1) + '</div><div class="c"><div class="t">' + esc(r.prod || 'Produto sem nome') + '</div>' +
          (meta ? '<div class="s">' + esc(meta) + '</div>' : '') + '</div><div class="v"><b>' + esc(fBRL(r.v)) + '</b>' + (qx ? '<span>' + esc(qx) + '</span>' : '') + '</div></div>';
      }).join('') + '</div>'
      + (dif ? '<div class="sd-dw-nada" style="margin-top:8px;">Os itens somam diferente da linha da lista (' + esc(fBRL(doc.v)) + '): pode haver item sem produto cadastrado no modelo.</div>' : '')
      + '</section>';
  }
  // linhas da OV (pedido): todas, agrupadas por status, cada uma com a sua
  // liberação para o depósito e a sua previsão
  function secLinhas(doc, ent, st) {
    var it = ent.itens, titulo = 'Linhas da OV';
    if (!it || it.st === 'carregando') return '<section class="sd-dw-card"><h5>' + titulo + '</h5>' + carregandoH('Lendo as linhas da OV no Power BI…') + '</section>';
    if (it.st === 'erro') return '<section class="sd-dw-card"><h5>' + titulo + '</h5>' + erroH('Não deu para ler as linhas', it.erro) + '</section>';
    if (!it.rows.length) return '<section class="sd-dw-card"><h5>' + titulo + '</h5><div class="sd-dw-nada">O Power BI não trouxe linhas para esta OV.</div></section>';
    return '<section class="sd-dw-card"><h5>' + titulo + ' <small>' + esc(fInt(it.rows.length)) + '</small></h5>' + linhasH(doc, resumoLinhas(it.rows), st) + '</section>';
  }
  function linhasH(doc, R, st) {
    var h = '<div class="sd-its-r"><span>Total da OV <b>' + esc(fBRL(R.v)) + '</b></span>' +
      (R.temQ ? '<span><b>' + esc(fQtd(R.qt)) + '</b> ' + (R.qt === 1 ? 'unidade' : 'unidades') + '</span>' : '') + '</div>';
    if (R.fora.n) {
      h += '<p class="sd-lin-nota">A lista conta só as linhas <b>em andamento</b>: ' + esc(plural(R.and.n, LINHA) + ' · ' + fBRL(R.and.v)) + '. ' +
        (R.fora.n === 1 ? 'A outra linha' : 'As outras ' + esc(plural(R.fora.n, LINHA))) + ' (' + esc(fBRL(R.fora.v)) + ') ' +
        (R.fora.n === 1 ? 'está' : 'estão') + ' em outro status e fica' + (R.fora.n === 1 ? '' : 'm') + ' fora da lista.</p>';
    }
    var multi = R.grupos.length > 1, i = 0;
    h += '<div class="sd-its">';
    R.grupos.forEach(function (g) {
      if (multi) {
        h += '<div class="sd-lin-g">' + badge(g.st || 'sem status', g.st ? slotDe(st, g.st) : 0) +
          '<span>' + esc(plural(g.n, LINHA)) + ' · <b>' + esc(fBRL(g.v)) + '</b></span>' +
          (emAndamento(g.st) ? '' : '<em>fora da lista</em>') + '</div>';
      }
      g.rows.forEach(function (r) {
        i++;
        var meta = [r.cod ? 'cód. ' + r.cod : null, r.fam].filter(Boolean).join(' · ');
        var lib = (r.lib ? 'liberado ' + fDM(r.lib) : 'sem liberação') + (r.stlib ? ' (' + frase(r.stlib) + ')' : '');
        var prev = r.prev ? (atrasada(r.prev) && emAndamento(r.st) ? 'prev. ' + fDM(r.prev) + ' · atrasada' : 'prev. ' + fDM(r.prev)) : 'sem previsão';
        var qx = r.qt != null && isFinite(r.qt) ? fQtd(r.qt) + (r.pu != null && isFinite(r.pu) ? ' × ' + fBRL(r.pu) : ' un.') : '';
        h += '<div class="sd-it"><div class="n">' + i + '</div><div class="c"><div class="t">' + esc(r.prod || 'Produto sem nome') + '</div>' +
          (meta ? '<div class="s">' + esc(meta) + '</div>' : '') +
          '<div class="s lg"><span class="' + (r.lib ? '' : 'sem') + '">' + esc(lib) + '</span> · ' + esc(prev) + '</div></div>' +
          '<div class="v"><b>' + esc(fBRL(r.v)) + '</b>' + (qx ? '<span>' + esc(qx) + '</span>' : '') + '</div></div>';
      });
    });
    h += '</div>';
    // a lista soma esta OV pelo filtro-base (fora intercompany, só operação
    // que gera fatura): se as linhas em andamento somam outra coisa, avisa
    if (Math.abs(R.and.v - doc.v) > 0.05) {
      h += '<div class="sd-dw-nada" style="margin-top:8px;">Na lista esta OV vale ' + esc(fBRL(doc.v)) + ' e as linhas em andamento somam ' + esc(fBRL(R.and.v)) +
        ': a lista deixa de fora linhas de intercompany e de operações que não geram fatura a receber.</div>';
    }
    return h;
  }
  function secDados(doc, ent, titulo) {
    var dt = ent.det;
    if (!dt || dt.st === 'carregando') return '<section class="sd-dw-card"><h5>' + esc(titulo) + '</h5>' + carregandoH('Lendo os dados no Power BI…') + '</section>';
    if (dt.st === 'erro') return '<section class="sd-dw-card"><h5>' + esc(titulo) + '</h5>' + erroH('Não deu para ler os dados', dt.erro) + '</section>';
    var pares = [];
    CAMPOS[doc.tipo].forEach(function (c) {
      var vs = dt.vals[c[0]];
      if (!vs || !vs.length) return;
      var txt = vs.map(function (x) { return esc(c[0] === 'stlib' || c[0] === 'stov' || c[0] === 'saida' ? frase(x) : x); }).join(' · ');
      pares.push([c[1], txt, vs.join(' · ').length > 46 ? 'largo' : '']);
    });
    if (!pares.length) return '<section class="sd-dw-card"><h5>' + esc(titulo) + '</h5><div class="sd-dw-nada">Sem outros dados no Power BI para este documento.</div></section>';
    return '<section class="sd-dw-card"><h5>' + esc(titulo) + '</h5>' + dl(pares) +
      (dt.fora ? '<div class="sd-dw-nada" style="margin-top:10px;">' + esc(fInt(dt.fora)) + (dt.fora === 1 ? ' campo indisponível' : ' campos indisponíveis') + ' para o seu usuário no Power BI.</div>' : '') + '</section>';
  }

  // ══════════════════════════════════════════════════════════════
  // EVENTOS
  // ══════════════════════════════════════════════════════════════
  function linhaDe(t) { return t && t.closest ? t.closest('tr[data-sd-doc]') : null; }
  function docDaLinha(tr) {
    var a = tr.getAttribute('data-sd-doc') || '', i = a.indexOf(':');
    return { tipo: a.slice(0, i), id: decodeURIComponent(a.slice(i + 1)) };
  }
  function ordenarPor(tipo, k) {
    var st = L[tipo], col = null; COLS[tipo].forEach(function (c) { if (c.k === k) col = c; });
    if (!col) return;
    var natural = col.num ? -1 : 1, o = st.ord;
    if (o && o.k === k) st.ord = o.d === natural ? { k: k, d: -o.d } : null;
    else if (!o && k === 'v') st.ord = { k: 'v', d: 1 };          // o padrão já é Valor ▼: o 1º clique inverte
    else st.ord = { k: k, d: natural };
    st.lim = PASSO; pintarLista(tipo);
  }
  D.addEventListener('click', function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var tr = linhaDe(t);
    if (tr && !t.closest('a[href]')) { var dd = docDaLinha(tr); abrir(dd.tipo, dd.id, tr); return; }
    var th = t.closest('.sd-card th[data-k]');
    if (th) { var card = th.closest('.sd-card'); ordenarPor(card.getAttribute('data-sd'), th.getAttribute('data-k')); return; }
    var sg = t.closest('[data-sd-seg]');
    if (sg) {
      var tp = sg.getAttribute('data-sd-seg'), k = sg.getAttribute('data-k'), st = L[tp];
      st.seg = st.seg === k ? null : k; st.lim = PASSO; repintar(tp); return;
    }
    var fx = t.closest('.sd-fx');
    if (fx) { var tf = fx.closest('.sd-card').getAttribute('data-sd'); L[tf].seg = null; L[tf].lim = PASSO; repintar(tf); return; }
    var mais = t.closest('.sd-mais');
    if (mais) { var tm = mais.closest('.sd-card').getAttribute('data-sd'); L[tm].lim += PASSO; pintarLista(tm); }
  });
  D.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var t = e.target; if (!t || !t.closest) return;
    var tr = t.matches && t.matches('tr[data-sd-doc]') ? t : null;
    if (tr) { e.preventDefault(); var dd = docDaLinha(tr); abrir(dd.tipo, dd.id, tr); return; }
    var th = t.matches && t.matches('.sd-card th[data-k]') ? t : null;
    if (th) { e.preventDefault(); ordenarPor(th.closest('.sd-card').getAttribute('data-sd'), th.getAttribute('data-k')); }
  });
  var _tb = {};
  D.addEventListener('input', function (e) {
    var t = e.target; if (!t || !t.matches || !t.matches('.sd-busca input')) return;
    var tipo = t.closest('.sd-card').getAttribute('data-sd');
    clearTimeout(_tb[tipo]);
    _tb[tipo] = setTimeout(function () { L[tipo].busca = t.value; L[tipo].lim = PASSO; pintarLista(tipo); }, 160);
  });
  D.addEventListener('change', function (e) {
    var t = e.target; if (!t || !t.matches || !t.matches('.sd-ord-m select')) return;
    var tipo = t.closest('.sd-card').getAttribute('data-sd'), p = String(t.value || 'v:-1').split(':');
    L[tipo].ord = p[0] === 'v' && p[1] === '-1' ? null : { k: p[0], d: Number(p[1]) || 1 };
    L[tipo].lim = PASSO; pintarLista(tipo);
  });
  // o seletor de ordem do celular nasce com as opções de cada lista
  function montarOrdem() {
    ['ped', 'nf'].forEach(function (tipo) {
      var s = D.getElementById('sd-' + tipo + '-ord');
      if (s && !s.options.length) s.innerHTML = ORD_M[tipo].map(function (o) { return '<option value="' + o[0] + '">' + esc(o[1]) + '</option>'; }).join('');
    });
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', montarOrdem); else montarOrdem();

  // ══════════════════════════════════════════════════════════════
  // API
  // ══════════════════════════════════════════════════════════════
  root.SRDiario = {
    // refazendo as consultas: segura o que está na tela, apagado (sem "piscar")
    carregando: function () {
      ['ped', 'nf'].forEach(function (tipo) { var c = D.getElementById('sd-' + tipo); if (c && L[tipo].pronto) c.classList.add('is-load'); });
    },
    pedidos: function (dados, totais, ctx) { receber('ped', dados, ctx, totais); },
    faturados: function (dados, ctx) { receber('nf', dados, ctx); },
    abrir: function (tipo, id) { abrir(tipo, String(id)); },
    fechar: fechar,
    estado: function () {
      return {
        pedidos: { docs: L.ped.docs.length, total: L.ped.total, series: L.ped.series, filtro: L.ped.seg, busca: L.ped.busca, ord: L.ped.ord, erro: L.ped.erro },
        notas: { docs: L.nf.docs.length, total: L.nf.total, series: L.nf.series, filtro: L.nf.seg, busca: L.nf.busca, ord: L.nf.ord, erro: L.nf.erro, dia: L.nf.dia },
        ficha: DW.doc ? DW.doc.tipo + ':' + DW.doc.id : null, cache: CACHE.size
      };
    }
  };
})(typeof window !== 'undefined' ? window : this);
