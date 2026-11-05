/* ================================================================
   cotacoes-proposta.js — a PROPOSTA da cotação (módulo Cotações)

   window.COTPROP, usado por:
     . cotacoes-agente.js  (pages/comercial-cot-nova.html)  — ao criar o caso
     . cotacoes.js         (pages/comercial-cot-casos.html) — no caso

   1) gerar(caso, operador) -> o PDF no MODELO de proposta da MSB (05/11/2026,
      o "ACE-MSB · Gestão Comercial" que o dono mandou — ver RECORTE MSB no
      bloco do PDF). Até 04/11 era o modelo da Biomedical ("PROP SAPIRANGA",
      com as imagens de topo e rodapé). O que vai nele: Data de criação /
      Número de Proposta / Data de Validade (e a cotação do portal), o
      "Preparado por" (o OPERADOR: nome, área da equipe, telefone e e-mail do
      login — os do SETOR quando a unidade tem, COT.contatoDoSetor), o
      comprador (razão social, CNPJ, endereço; contato, e-mail e telefone), os
      dados do faturamento (A faturar), a tabela Código · Produto (com o RMS e
      o lote) · Fabricante · Qtd. · Vlr. Venda · [IPI] · Subtotal, a condição
      de pagamento, o prazo de entrega, o frete, a observação e os totais.
      21/10/2026: o Produto, o Fabricante e o RMS de cada item saem do
      CADASTRO do Salesforce (Product2, pelo Cód. Biomedical — COT.produtosSf);
      o item sem produto no Salesforce sai com o que está na cotação.
   2) enviar(caso, operador, {para, copia, assunto, mensagem}) -> manda a
      proposta com o PDF anexo pelo OUTLOOK DE QUEM ESTÁ LOGADO (Graph
      /me/sendMail, permissão delegada Mail.Send — a primeira vez pede o
      consentimento num popup) e registra no caso ({acao:'proposta'}: o PDF
      fica nos anexos e o envio no histórico). Sai da caixa da pessoa e
      fica nos Itens Enviados dela; a resposta do comprador volta para ela.
      22/10/2026: com o contato do SETOR, o e-mail sai PELA CAIXA DO SETOR
      (from — precisa da permissão "Enviar como" nela); sem a permissão, sai
      pela da pessoa com "responder para" o setor. E vão junto os ANEXOS que
      a pessoa escolher (opts.anexos: outros PDFs, catálogo, registro…) — o
      sendMail aceita até ~4 MB por envio, então o total fica em LIMITE_ANEXOS.

   Documento EXTERNO: sem link do portal, sem "mensagem automática".
   Depende do jsPDF (cdnjs, jspdf.umd 2.5.1) carregado na página.
   ================================================================ */
(function () {
  'use strict';
  if (window.COTPROP) return;
  var W = window, D = document;

  // RECORTE MSB (05/11/2026, pedido do dono): a proposta sai no MODELO DA MSB
  // (o "ACE-MSB · Gestão Comercial" que o dono mandou): A4, o logo da MSB e
  // "MEDICAL SYSTEM DO BRASIL" à esquerda, Data de criação / Número de Proposta
  // / Data de Validade à direita, "PROPOSTA COMERCIAL", os blocos em rótulos
  // de caixa alta (Preparado por · Nome completo / E-mail · Razão social / CNPJ
  // · Endereço principal), a tabela Código · Produto · Fabricante · Qtd. · Vlr.
  // Venda · Subtotal sem fundo, com linhas finas, os totais à direita e a frase
  // de validade no rodapé. Com TUDO o que a proposta do portal já levava: o
  // telefone de quem prepara e do contato, a cidade/UF/CEP, os dados do
  // faturamento (A faturar), o RMS e o lote embaixo do produto, a unidade na
  // quantidade, a coluna de IPI (com o IPI somado e o total com IPI), o frete,
  // o prazo de entrega, a condição de pagamento e a observação.
  // O logo (assets/proposta-msb-logo.png) foi tirado do PDF do modelo.
  var EMPRESA = { nome: 'MSB Medical System do Brasil', site: 'www.msbbrasil.com', topo: 'MEDICAL SYSTEM DO BRASIL' };
  var LOGO = { url: '/assets/proposta-msb-logo.png', w: 50, h: 50 * 281 / 480 };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hoje() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function diaBR(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
  function brl(v) { return 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  // 29/10/2026 (pedido do usuário): a quantidade sem os zeros depois da vírgula (2.400, não 2.400,00)
  function qtd(v) { return (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 }); }
  function cnpjMask(d) {
    d = String(d || '').replace(/\D/g, '');
    if (d.length === 14) return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12);
    if (d.length === 11) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
    return d;
  }
  function cepMask(c) { var d = String(c || '').replace(/\D/g, ''); return d.length === 8 ? d.slice(0, 5) + '-' + d.slice(5) : String(c || ''); }
  function totalDe(itens) { return (itens || []).reduce(function (s, it) { return s + (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0); }, 0); }
  // o IPI do item, em % (29/10/2026 — o "Tem IPI?"): a mesma regra do COT.ipiDe
  function ipiDe(it) { var p = Number(it && it.ipi) || 0; return p > 0 && p <= 100 ? p : 0; }
  function ipiTotal(itens) { return (itens || []).reduce(function (s, it) { return s + (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0) * ipiDe(it) / 100; }, 0); }
  function pctIpi(p) { return (Number(p) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%'; }
  function b64(buf) {
    var bytes = new Uint8Array(buf), bin = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }
  // o nome do arquivo: "Proposta COT-MSB-2026-000003 - SOCIEDADE BENEFICENTE.pdf"
  function nomeArquivo(c) {
    var cli = String((c.cliente && c.cliente.nome) || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    return ('Proposta ' + (c.numero || 'MSB') + (cli ? ' - ' + cli : '')).replace(/\s+/g, ' ') + '.pdf';
  }

  /* ── o logo do modelo, uma vez por página ─────────────────────── */
  var _imgs = null;
  function dataUrl(url) {
    return fetch(url, { cache: 'force-cache' }).then(function (r) {
      if (!r.ok) throw new Error('imagem ' + r.status);
      return r.blob();
    }).then(function (b) {
      return new Promise(function (ok, falha) { var fr = new FileReader(); fr.onload = function () { ok(fr.result); }; fr.onerror = falha; fr.readAsDataURL(b); });
    });
  }
  function imagens() {
    if (!_imgs) {
      _imgs = dataUrl(LOGO.url).then(function (l) { return { logo: l }; })
        .catch(function () { _imgs = null; return { logo: null }; });   // sem a imagem, sai o nome da empresa
    }
    return _imgs;
  }
  function pronto() { return !!(W.jspdf && W.jspdf.jsPDF); }

  /* ── 1) o PDF ───────────────────────────────────────────────── */
  // Medidas em pontos, tiradas do modelo (A4, 595 × 842).
  var X = { esq: 52.5, dir2: 307, fim: 543.7, meio: 297.6 };
  var PAG_H = 841.89, LIMITE_Y = 790, TOPO_PAG = 60;
  // a fonte da tabela: o modelo usa Segoe UI 9 pt; a Helvetica do jsPDF é mais
  // larga — em 8,5 pt as descrições quebram nas mesmas linhas do modelo
  var TB = 8.5;
  var COR = {
    tit: [31, 41, 55],      // #1F2937 — título, razão social, Valor Total
    txt: [55, 65, 81],      // #374151 — os valores
    rot: [107, 114, 128],   // #6B7280 — os rótulos em caixa alta
    cab: [156, 163, 175],   // #9CA3AF — o cabeçalho da tabela
    cod: [75, 85, 99],      // #4B5563 — o código (monoespaçado)
    forte: [17, 24, 39],    // #111827 — o subtotal do item
    linha: [229, 231, 235], // #E5E7EB — as linhas da tabela
    linha2: [209, 213, 219] // #D1D5DB — a linha do subtotal
  };
  // [chave, título (pode ter \n), x0, x1, alinhamento]
  var COLS_BASE = [
    ['cod', 'Código', 58.5, 120, 'l'], ['prod', 'Produto', 124.8, 283, 'l'], ['fab', 'Fabricante', 289.1, 392, 'l'],
    ['qtd', 'Qtd.', 396, 421.7, 'r'], ['vu', 'Vlr.\nVenda', 425, 473.3, 'r'], ['sub', 'Subtotal', 477, 537.7, 'r']
  ];
  // 29/10/2026 (pedido do usuário): com IPI, a coluna IPI entre o Vlr. Venda e
  // o Subtotal (que segue sem o IPI); o espaço sai do Produto e do Fabricante
  var COLS_IPI = [
    ['cod', 'Código', 58.5, 120, 'l'], ['prod', 'Produto', 124.8, 262, 'l'], ['fab', 'Fabricante', 267, 350, 'l'],
    ['qtd', 'Qtd.', 354, 381, 'r'], ['vu', 'Vlr.\nVenda', 385, 432, 'r'], ['ipi', 'IPI', 436, 466, 'r'], ['sub', 'Subtotal', 470, 537.7, 'r']
  ];

  // o operador com o e-mail e o telefone do setor (a unidade da cotação), se ele tiver
  function comSetor(c, op) {
    var s = W.COT && W.COT.contatoDoSetor ? W.COT.contatoDoSetor(c && c.unidade) : null;
    return s ? Object.assign({}, op || {}, { email: s.email, telefone: s.telefone, setor: s.setor }) : (op || {});
  }
  function freteDe(co) { return (W.COT && W.COT.freteCifFob && W.COT.freteCifFob(co.frete)) || String(co.frete || '').trim(); }
  // o produto de cada código no Salesforce ({} se não der: a proposta sai com o do item)
  function produtosDoSf(itens) {
    var C = W.COT, cods = (itens || []).map(function (it) { return it.codigo; }).filter(Boolean);
    if (!C || !C.produtosSf || !cods.length) return Promise.resolve({});
    return C.produtosSf(cods).catch(function () { return {}; });
  }
  function gerar(caso, operador) {
    if (!pronto()) return Promise.reject(new Error('A biblioteca que gera o PDF (jsPDF) não carregou — recarregue a página.'));
    var c = caso || {}, op = comSetor(c, operador);
    return Promise.all([imagens(), produtosDoSf(c.itens)]).then(function (r) {
      var img = r[0], SFP = r[1];
      var sfDe = function (it) { var k = it.codigo && W.COT && W.COT.normCod ? W.COT.normCod(it.codigo) : ''; return (k && SFP[k]) || null; };
      var doc = new W.jspdf.jsPDF({ unit: 'pt', format: 'a4', compress: true });
      doc.setProperties({ title: 'Proposta ' + (c.numero || ''), subject: 'Proposta comercial', author: op.nome || EMPRESA.nome, creator: 'Portal MSB' });
      var cli = c.cliente || {}, ct = c.contato || {}, dt = c.datas || {}, co = c.condicoes || {};
      var itens = (c.itens || []).filter(function (it) { return it.descricao || it.codigo; });
      var comIpi = itens.some(function (it) { return ipiDe(it) > 0; });
      var COLS = comIpi ? COLS_IPI : COLS_BASE;
      var col = {}; COLS.forEach(function (k) { col[k[0]] = k; });

      function fonte(tam, cor, estilo, familia) { doc.setFont(familia || 'helvetica', estilo || 'normal'); doc.setFontSize(tam); doc.setTextColor(cor[0], cor[1], cor[2]); }
      function quebra(txt, larg) { var t = String(txt == null ? '' : txt).trim(); return t ? doc.splitTextToSize(t, larg) : []; }
      function linhaH(y, x0, x1, cor, esp) { doc.setDrawColor(cor[0], cor[1], cor[2]); doc.setLineWidth(esp || 0.75); doc.line(x0, y, x1, y); }
      // rótulo em caixa alta + valor(es); devolve o y da última linha escrita
      function bloco(x, y, rotulo, valores, larg, destaque) {
        fonte(8.2, COR.rot); doc.text(rotulo.toUpperCase(), x, y);
        var l = (valores || []).filter(function (v) { return String(v || '').trim(); });
        if (!l.length) { fonte(9, COR.txt); doc.text('—', x, y + 18.5); return y + 18.5; }
        var yy = y + 18.5, prim = true;
        l.forEach(function (v) {
          var tam = prim && destaque ? 10.5 : 9;
          fonte(tam, prim && destaque === 'forte' ? COR.tit : COR.txt, prim && destaque === 'forte' ? 'bold' : 'normal');
          var q = quebra(v, larg);
          doc.text(q, x, yy, { lineHeightFactor: 12 / tam });
          yy += (q.length - 1) * 12 + (prim && destaque ? 13.8 : 12);
          prim = false;
        });
        return yy - 12;
      }

      // ── o topo: logo + MEDICAL SYSTEM DO BRASIL; as datas à direita
      if (img.logo) doc.addImage(img.logo, 'PNG', X.esq + 0.7, 59, LOGO.w, LOGO.h, 'logo-msb', 'FAST');
      else { fonte(16, [86, 164, 187], 'bold'); doc.text('MSB', X.esq, 82); }
      fonte(8.2, COR.txt); doc.text(EMPRESA.topo, X.esq, 100.3, { charSpace: 0.9 });
      var ref = [c.portal, c.cotacaoId ? 'nº ' + c.cotacaoId : ''].filter(Boolean).join(' ');
      [['Data de criação', diaBR(dt.cotacao) || diaBR(hoje())], ['Número de Proposta', c.numero || '(definido ao criar o caso)'],
        ['Data de Validade', diaBR(dt.validade) || '—']].concat(ref ? [['Cotação', ref]] : [])
        .forEach(function (l, i) {
          var y = 67.5 + i * 13.5;
          fonte(9, COR.txt); var wv = doc.getTextWidth(String(l[1]));
          doc.text(String(l[1]), X.fim, y, { align: 'right' });
          fonte(9, COR.rot); doc.text(l[0], X.fim - wv - 3.5, y, { align: 'right' });
        });
      fonte(15, COR.tit, 'bold'); doc.text('PROPOSTA COMERCIAL', X.esq, 131.5);

      // ── Preparado por (o operador) · o contato do comprador
      var LARG_E = X.dir2 - X.esq - 14, LARG_D = X.fim - X.dir2;
      var y = 162;
      var yE = bloco(X.esq, y, 'Preparado por', [op.nome || '', op.area || op.departamento || '', op.telefone || '', op.email || ''], LARG_E, 'nome');
      var yD = bloco(X.dir2, y, 'Nome completo', [ct.nome || ''], LARG_D);
      yD = bloco(X.dir2, yD + 21, 'E-mail', [ct.email || ''], LARG_D);
      if (String(ct.telefone || '').trim()) yD = bloco(X.dir2, yD + 21, 'Telefone', [ct.telefone], LARG_D);

      // ── o comprador: razão social e CNPJ · endereço principal
      y = Math.max(yE, yD) + 28;
      yE = bloco(X.esq, y, 'Razão social', [cli.nome || ''], LARG_E, 'forte');
      yE = bloco(X.esq, yE + 21, 'CNPJ', [cnpjMask(cli.cnpj)], LARG_E);
      var cidade = [cli.cidade, cli.uf].filter(Boolean).join(' - ');
      yD = bloco(X.dir2, y, 'Endereço principal', [cli.endereco || '', cidade, cli.cep ? 'CEP ' + cepMask(cli.cep) : ''], LARG_D);
      var fim = Math.max(yE, yD);

      // 29/10/2026 (pedido do usuário): a cotação que passou pela A faturar leva no
      // PDF o que foi preenchido na mudança de fase — o paciente, a data da
      // cirurgia, o convênio e o médico aqui; o lote embaixo de cada produto
      var fa = c.faturamento || {};
      if (fa.paciente || fa.cirurgia || fa.convenio || fa.medico) {
        y = fim + 28;
        yE = bloco(X.esq, y, 'Paciente', [fa.paciente || ''], LARG_E);
        yD = bloco(X.dir2, y, 'Data da cirurgia', [diaBR(fa.cirurgia) || fa.cirurgia || ''], LARG_D);
        y = Math.max(yE, yD) + 21;
        yE = bloco(X.esq, y, 'Convênio', [fa.convenio || ''], LARG_E);
        yD = bloco(X.dir2, y, 'Médico', [fa.medico || ''], LARG_D);
        fim = Math.max(yE, yD);
      }

      // ── a tabela dos itens: sem fundo, cabeçalho cinza-claro, linha fina entre os itens
      function cabecalho(t) {
        COLS.forEach(function (k) {
          var l = k[1].split('\n'), x = k[4] === 'r' ? k[3] : k[2];
          fonte(9, COR.cab);
          l.forEach(function (s, i) { doc.text(s, x, l.length === 1 ? t + 13.5 : t + 7.5 + i * 12, { align: k[4] === 'r' ? 'right' : 'left' }); });
        });
        linhaH(t + 27, X.esq, X.fim, COR.linha);
        return t + 27;
      }
      // o código não tem espaço: quebra pelo hífen (como no modelo, "UFGH-" / "035150RHS") ou pelo tamanho
      function quebraCodigo(cod, larg) {
        cod = String(cod || '').trim(); if (!cod) return [];
        fonte(8.2, COR.cod, 'normal', 'courier');
        if (doc.getTextWidth(cod) <= larg) return [cod];
        var out = [], resto = cod;
        while (resto) {
          var n = resto.length;
          while (n > 1 && doc.getTextWidth(resto.slice(0, n)) > larg) n--;
          var h = resto.slice(0, n).lastIndexOf('-');
          if (n < resto.length && h > 0) n = h + 1;
          out.push(resto.slice(0, n)); resto = resto.slice(n);
        }
        return out;
      }
      // o valor que não cabe na coluna: "R$" numa linha e o número na outra; nem assim, a fonte diminui
      function celNumero(v, larg, estilo) {
        fonte(TB, COR.txt, estilo);
        if (doc.getTextWidth(v) <= larg) return { l: [v], tam: TB };
        var l = /^R\$ /.test(v) ? ['R$', v.slice(3)] : [v];
        var w = Math.max.apply(null, l.map(function (x) { return doc.getTextWidth(x); }));
        return { l: l, tam: w <= larg ? TB : Math.max(6, TB * larg / w) };
      }
      function novaPagina() { doc.addPage(); return cabecalho(TOPO_PAG); }

      y = cabecalho(fim + 28);
      itens.forEach(function (it) {
        var vu = Number(it.valorUnitario) || 0, q = Number(it.quantidade) || 0;
        // o produto do cadastro (Salesforce) ganha do que veio no PDF
        var p = sfDe(it);
        // 05/11/2026: sem o Salesforce e sem descrição, o nome do cadastro do Power BI
        var bi = W.COT && W.COT.produtoDoCodigo && it.codigo ? W.COT.produtoDoCodigo(it.codigo) : null;
        var desc = (p && W.COT.descricaoSf(p)) || String(it.descricao || '').trim() || (bi && bi.nome) || '';
        var fab = (p && p.fabricante) || it.marca || '';
        var rms = (p && p.rms) || it.registro || (p && p.isento ? 'Isento' : '');
        var un = String(it.unidade || '').trim().toUpperCase() || 'UN';
        var lCod = quebraCodigo(it.codigo, col.cod[3] - col.cod[2] - 2);
        fonte(TB, COR.txt); var lProd = quebra(desc, col.prod[3] - col.prod[2] - 4);
        fonte(7.5, COR.rot);
        var lExtra = [].concat(rms ? quebra('RMS ' + rms, col.prod[3] - col.prod[2] - 4) : [], it.lote ? quebra('Lote: ' + it.lote, col.prod[3] - col.prod[2] - 4) : []);
        fonte(TB, COR.txt); var lFab = quebra(fab, col.fab[3] - col.fab[2] - 4);
        var tq = q ? qtd(q) : '—';
        fonte(TB, COR.txt);
        var lQtd = q && doc.getTextWidth(tq + ' ' + un) <= col.qtd[3] - col.qtd[2] ? [tq + ' ' + un] : q ? [tq, un] : ['—'];
        var cVu = celNumero(vu ? brl(vu) : '—', col.vu[3] - col.vu[2]);
        var cIpi = comIpi ? celNumero(ipiDe(it) ? pctIpi(ipiDe(it)) : '—', col.ipi[3] - col.ipi[2]) : null;
        var cSub = celNumero(vu && q ? brl(vu * q) : '—', col.sub[3] - col.sub[2], 'bold');
        var nL = Math.max(lCod.length, lProd.length + lExtra.length * 11 / 12, lFab.length, lQtd.length, cVu.l.length, cSub.l.length, cIpi ? cIpi.l.length : 1, 1);
        var h = 14 + 12 * Math.ceil(nL);
        if (y + h > LIMITE_Y) y = novaPagina();
        var b = y + 17.3;   // a 1ª linha do item
        fonte(8.2, COR.cod, 'normal', 'courier'); if (lCod.length) doc.text(lCod, col.cod[2], b, { lineHeightFactor: 12 / 8.2 });
        fonte(TB, COR.txt); if (lProd.length) doc.text(lProd, col.prod[2], b, { lineHeightFactor: 12 / TB });
        if (lExtra.length) { fonte(7.5, COR.rot); doc.text(lExtra, col.prod[2], b + lProd.length * 12 - 0.5, { lineHeightFactor: 11 / 7.5 }); }
        fonte(TB, COR.txt); if (lFab.length) doc.text(lFab, col.fab[2], b, { lineHeightFactor: 12 / TB });
        doc.text(lQtd, col.qtd[3], b, { align: 'right', lineHeightFactor: 12 / TB });
        [[cVu, col.vu, 'normal'], [cIpi, col.ipi, 'normal'], [cSub, col.sub, 'bold']].forEach(function (z) {
          if (!z[0]) return;
          fonte(z[0].tam, z[2] === 'bold' ? COR.forte : COR.txt, z[2]);
          doc.text(z[0].l, z[1][3], b, { align: 'right', lineHeightFactor: 12 / z[0].tam });
        });
        y += h;
        linhaH(y, X.esq, X.fim, COR.linha);
      });
      if (!itens.length) { fonte(9, COR.rot); doc.text('Nenhum item.', col.cod[2], y + 18); y += 26; linhaH(y, X.esq, X.fim, COR.linha); }

      // ── os totais à direita; a condição, o prazo, o frete e a observação à esquerda
      var vTot = totalDe(itens) || c.total || 0, vIpi = comIpi ? ipiTotal(itens) : 0;
      var obs = String(co.observacao || '').trim();
      fonte(9, COR.txt); var lObs = obs ? doc.splitTextToSize(obs, 288) : [];
      var altura = Math.max(comIpi ? 62 : 48, 40 + lObs.length * 12) + 70;
      if (y + altura > LIMITE_Y + 30) { doc.addPage(); y = TOPO_PAG - 10; }
      var xT = 351.7;
      var yT = y + 18.3;
      [['Subtotal', brl(vTot)]].concat(comIpi ? [['IPI', brl(vIpi)]] : []).forEach(function (l) {
        fonte(9, COR.cod); doc.text(l[0], xT, yT); doc.text(l[1], X.fim, yT, { align: 'right' });
        yT += 14;
      });
      linhaH(yT - 7.5, xT, X.fim, COR.linha2);
      fonte(13.5, COR.tit, 'bold'); doc.text('Valor Total', xT, yT + 10); doc.text(brl(vTot + vIpi), X.fim, yT + 10, { align: 'right' });
      if (comIpi) { fonte(7.5, COR.rot); doc.text('com IPI', xT, yT + 22); }
      var yL = y + 32.5;
      function linhaEsq(rot, val) {
        fonte(9, COR.txt); var w = doc.getTextWidth(rot + ' ');
        doc.text(rot, X.esq, yL);
        var lv = doc.splitTextToSize(String(val || '—'), 288 - w);
        doc.text(lv, X.esq + w, yL, { lineHeightFactor: 12 / 9 });
        yL += 13.5 + (lv.length - 1) * 12;
      }
      linhaEsq('Condição de Pagamento', String(co.pagamento || '').trim() || '—');
      linhaEsq('Prazo de entrega', String(co.entrega || '').trim() || '—');
      if (freteDe(co)) linhaEsq('Frete', freteDe(co));
      if (lObs.length) {
        yL += 4;
        fonte(8.2, COR.rot); doc.text('OBSERVAÇÃO', X.esq, yL); yL += 14;
        // quebra de página no meio da observação longa
        while (lObs.length) {
          var cabe = Math.max(1, Math.floor((LIMITE_Y + 30 - yL) / 12));
          var parte = lObs.slice(0, cabe); lObs = lObs.slice(cabe);
          fonte(9, COR.txt); doc.text(parte, X.esq, yL, { lineHeightFactor: 12 / 9 });
          yL += parte.length * 12;
          if (lObs.length) { doc.addPage(); yL = TOPO_PAG; }
        }
      }

      // ── o rodapé: a validade, a MSB e o site
      var yR = Math.max(yL, yT + 22) + 35;
      if (yR > PAG_H - 30) { doc.addPage(); yR = TOPO_PAG; }
      var val = diaBR(dt.validade);
      fonte(8.2, COR.rot);
      doc.text((val ? 'Esta proposta é válida até ' + val + ' · ' : '') + EMPRESA.nome + ' · ' + EMPRESA.site, X.meio, yR, { align: 'center' });
      // mais de uma página: o número da página e o da proposta embaixo
      var nPag = doc.getNumberOfPages();
      if (nPag > 1) for (var pg = 1; pg <= nPag; pg++) {
        doc.setPage(pg); fonte(7.5, COR.cab);
        doc.text((c.numero ? 'Proposta ' + c.numero + ' · ' : '') + 'Página ' + pg + ' de ' + nPag, X.fim, PAG_H - 24, { align: 'right' });
      }

      var buf = doc.output('arraybuffer');
      var blob = new Blob([buf], { type: 'application/pdf' });
      return { nome: nomeArquivo(c), base64: b64(buf), blob: blob, tamanho: buf.byteLength };
    });
  }

  /* ── 2) o e-mail ────────────────────────────────────────────── */
  function rotuloCotacao(c) { return [c.portal, c.cotacaoId ? 'nº ' + c.cotacaoId : ''].filter(Boolean).join(' '); }
  function assuntoPadrao(c) {
    return ['Proposta MSB ' + (c.numero || ''), rotuloCotacao(c) ? 'Cotação ' + rotuloCotacao(c) : '', (c.cliente && c.cliente.nome) || ''].filter(Boolean).join(' · ');
  }
  function mensagemPadrao(c, op) {
    op = comSetor(c, op);
    var co = c.condicoes || {}, dt = c.datas || {}, ct = c.contato || {};
    var n = (c.itens || []).filter(function (it) { return it.descricao || it.codigo; }).length;
    var vTot = totalDe(c.itens) || c.total || 0, vIpi = ipiTotal(c.itens);
    var linhasCond = [
      n + ' item(ns) · ' + (vIpi ? 'valor sem IPI ' + brl(vTot) + ' · IPI ' + brl(vIpi) + ' · valor total com IPI ' + brl(vTot + vIpi) : 'valor total ' + brl(vTot)),
      co.pagamento ? 'Condição de pagamento: ' + co.pagamento : '',
      freteDe(co) ? 'Frete: ' + freteDe(co) : '',
      String(co.entrega || '').trim() ? 'Prazo de entrega: ' + String(co.entrega).trim() : '',
      // 29/10/2026 (pedido do usuário): era "Data de vencimento"
      dt.validade ? 'Data de validade da proposta: ' + diaBR(dt.validade) : ''
    ].filter(Boolean);
    return (ct.nome ? 'Prezado(a) ' + ct.nome + ',' : 'Prezado(a),') + '\n\n' +
      'Segue em anexo a proposta comercial da MSB nº ' + (c.numero || '') + (rotuloCotacao(c) ? ', referente à cotação ' + rotuloCotacao(c) : '') + '.\n\n' +
      linhasCond.join('\n') + '\n\n' +
      'Ficamos à disposição para qualquer esclarecimento.\n\n' +
      'Atenciosamente,\n' + (op.nome || '') + (op.area ? '\n' + op.area : '') + '\n' + EMPRESA.nome + ' · ' + EMPRESA.site +
      [op.telefone, op.email].filter(Boolean).map(function (x) { return '\n' + x; }).join('');
  }
  function textoParaHtml(t) {
    return '<div style="font-family:Segoe UI,Calibri,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1F2A37">' + esc(t).replace(/\n/g, '<br>') + '</div>';
  }
  function listaEmails(v) {
    return (Array.isArray(v) ? v : String(v || '').split(/[;,\s]+/)).map(function (e) { return String(e || '').trim().toLowerCase(); })
      .filter(function (e, i, l) { return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e) && l.indexOf(e) === i; });
  }

  // token DELEGADO com Mail.Send: silencioso; senão o popup de consentimento
  // (só com clique da pessoa — o envio sempre nasce de um botão)
  function tokenEnvio() {
    var inst = W._msalAuth;
    var conta = inst && ((inst.getActiveAccount && inst.getActiveAccount()) || (inst.getAllAccounts && inst.getAllAccounts()[0]));
    var silencioso = inst && conta ? inst.acquireTokenSilent({ scopes: ['Mail.Send'], account: conta }).then(function (r) { return r.accessToken; })
      : Promise.reject(new Error('login não está pronto'));
    return silencioso.catch(function () {
      if (typeof W.portalToken !== 'function') throw new Error('O login não está pronto — recarregue a página.');
      return W.portalToken(['Mail.Send']).then(function (r) { return r.accessToken; });
    });
  }
  // o sendMail aceita até 4 MB por pedido (em base64): o PDF + os anexos
  var LIMITE_ANEXOS = 3600000;
  function tamanhoB64(l) { return (l || []).reduce(function (s, a) { return s + String((a && a.base64) || '').length; }, 0); }
  function enviarPeloOutlook(msg, de) {
    var anexos = [{ nome: msg.pdf.nome, tipo: 'application/pdf', base64: msg.pdf.base64 }].concat(msg.anexos || []);
    var m = {
      subject: msg.assunto,
      body: { contentType: 'HTML', content: msg.html },
      toRecipients: msg.para.map(function (e) { return { emailAddress: { address: e } }; }),
      ccRecipients: msg.copia.map(function (e) { return { emailAddress: { address: e } }; }),
      attachments: anexos.map(function (a) { return { '@odata.type': '#microsoft.graph.fileAttachment', name: a.nome, contentType: a.tipo || 'application/octet-stream', contentBytes: a.base64 }; })
    };
    // pela caixa do setor (de); sem ela, as respostas ainda vão para o setor
    if (de) m.from = { emailAddress: { address: de } };
    if (msg.responderPara) m.replyTo = [{ emailAddress: { address: msg.responderPara } }];
    return tokenEnvio().then(function (tok) {
      return fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: m, saveToSentItems: true })
      });
    }).then(function (r) {
      if (r.status === 202 || r.ok) return true;
      return r.text().then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
        var txt = (j && j.error && j.error.message) || ('Outlook respondeu ' + r.status);
        var e = new Error(r.status === 403 && !de ? 'Sem permissão para enviar e-mail pelo seu login (Mail.Send). ' + txt : txt);
        e.status = r.status; e.codigo = (j && j.error && j.error.code) || '';
        throw e;
      });
    });
  }
  // o setor primeiro; recusado (sem o "Enviar como" na caixa do setor), pela da pessoa
  function enviarComSetor(msg, setor) {
    if (!setor) return enviarPeloOutlook(msg, null).then(function () { return 'proprio'; });
    return enviarPeloOutlook(msg, setor.email).then(function () { return 'setor'; }, function (e) {
      if (!(e.status === 400 || e.status === 403 || /SendAs|SendOnBehalf|denied|permiss/i.test(e.codigo + ' ' + e.message))) throw e;
      return enviarPeloOutlook(Object.assign({}, msg, { responderPara: setor.email }), null).then(function () { return 'proprio'; });
    });
  }

  // gera (se não veio pronto), envia e registra no caso; devolve o caso atualizado
  function enviar(caso, operador, opts) {
    opts = opts || {};
    var para = listaEmails(opts.para), copia = listaEmails(opts.copia);
    if (!para.length) return Promise.reject(new Error('Informe o e-mail do comprador.'));
    if (!caso || !/^COT-(MSB-)?\d{4}-\d{6}$/.test(caso.numero || '')) return Promise.reject(new Error('Crie o caso antes de enviar a proposta.'));
    var assunto = String(opts.assunto || '').trim() || assuntoPadrao(caso);
    var html = textoParaHtml(String(opts.mensagem || '').trim() || mensagemPadrao(caso, operador || {}));
    var anexos = (opts.anexos || []).filter(function (a) { return a && a.base64 && a.nome; });
    var setor = W.COT && W.COT.contatoDoSetor ? W.COT.contatoDoSetor(caso.unidade) : null;
    var pdf = null, pelo = '';
    return (opts.pdf ? Promise.resolve(opts.pdf) : gerar(caso, operador)).then(function (p) {
      pdf = p;
      if (tamanhoB64([pdf].concat(anexos)) > LIMITE_ANEXOS) throw new Error('A proposta com os anexos passa do limite do Outlook por aqui (cerca de 2,5 MB no total) — tire o maior anexo e mande-o num e-mail à parte.');
      return enviarComSetor({ assunto: assunto, html: html, para: para, copia: copia, pdf: pdf, anexos: anexos }, setor);
    }).then(function (comoSaiu) {
      pelo = comoSaiu;
      return W.COT.api('cot-casos', { acao: 'proposta', numero: caso.numero, para: para, copia: copia, assunto: assunto, canal: 'outlook',
        de: pelo === 'setor' ? setor.email : '', respostas: setor && pelo !== 'setor' ? setor.email : '',
        extras: anexos.map(function (a) { return a.nome; }),
        anexo: { nome: pdf.nome, tipo: 'application/pdf', base64: pdf.base64 } })
        .then(function (j) { return { caso: j && j.caso, enviado: true, pelo: pelo, setor: setor }; })
        // o e-mail JÁ saiu: falhar o registro não pode parecer falha do envio
        .catch(function (e) { return { caso: null, enviado: true, pelo: pelo, setor: setor, erroRegistro: e.message }; });
    });
  }

  W.COTPROP = {
    // autorizar(): pega o token de envio JÁ NO CLIQUE — o popup de
    // consentimento aberto depois de esperar o servidor é barrado pelo navegador
    pronto: pronto, gerar: gerar, enviar: enviar, autorizar: tokenEnvio, assuntoPadrao: assuntoPadrao, mensagemPadrao: mensagemPadrao,
    nomeArquivo: nomeArquivo, listaEmails: listaEmails, preCarregar: imagens, comSetor: comSetor, LIMITE_ANEXOS: LIMITE_ANEXOS, tamanhoB64: tamanhoB64
  };
})();
