/* ================================================================
   cotacoes-proposta.js — a PROPOSTA da cotação (módulo Cotações)

   window.COTPROP, usado por:
     . cotacoes-agente.js  (pages/comercial-cot-nova.html)  — ao criar o caso
     . cotacoes.js         (pages/comercial-cot-casos.html) — no caso

   1) gerar(caso, operador) -> o PDF no MODELO de proposta da Biomedical
      (o "PROP SAPIRANGA.pdf" que o Salesforce gera — 09/10/2026): faixa e
      logo no topo, Data de criação / Número de Proposta / Data de validade,
      a empresa, o "Preparado por" (o OPERADOR: nome, departamento =
      área da equipe, telefone e e-mail do login), o comprador (razão
      social, CNPJ, endereço; contato, e-mail e telefone), a tabela
      Código · Produto · Fabricante · RMS · Quantidade · Valor de Venda ·
      Subtotal, Condição de Pagamento (como veio no PDF), Valor total e o
      rodapé com as filiais. (Nome do Médico, Frete e Prazo de entrega do
      modelo saíram em 09/10/2026, a pedido.) 22/10/2026 (pedido do usuário):
      voltam o FRETE (CIF ou FOB) e o PRAZO DE ENTREGA, e a OBSERVAÇÃO sai no
      PDF; o e-mail e o telefone do "Preparado por" são os do SETOR (a
      unidade de negócio da cotação — COT.contatoDoSetor) quando ele tem um.
      21/10/2026: o Produto, o Fabricante e o RMS de cada item saem do
      CADASTRO do Salesforce (Product2, pelo Cód. Biomedical — COT.produtosSf):
      a descrição + o complemento "para ser impresso na proposta", o
      fabricante e o RMS (ou "Isento"). O item sem produto no Salesforce (ou
      com o Salesforce fora do ar) sai com o que está na cotação.
      As imagens do topo e do rodapé são as do modelo (assets/proposta-*.jpg).
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

  var EMPRESA = { razao: 'BIOMEDICAL PRODUTOS CIENTÍFICOS MÉDICOS E HOSPITALARES SA', cnpj: '19.848.316/0001-66' };
  var IMG = { topo: '/assets/proposta-topo.jpg', rodape: '/assets/proposta-rodape.jpg' };

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
  // o nome do arquivo: "Proposta COT-2026-000003 - SOCIEDADE BENEFICENTE.pdf"
  function nomeArquivo(c) {
    var cli = String((c.cliente && c.cliente.nome) || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    return ('Proposta ' + (c.numero || 'Biomedical') + (cli ? ' - ' + cli : '')).replace(/\s+/g, ' ') + '.pdf';
  }

  /* ── as imagens do modelo (topo e rodapé), uma vez por página ── */
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
      _imgs = Promise.all([dataUrl(IMG.topo), dataUrl(IMG.rodape)])
        .then(function (l) { return { topo: l[0], rodape: l[1] }; })
        .catch(function () { _imgs = null; return { topo: null, rodape: null }; });   // sem imagem, a proposta sai sem a faixa
    }
    return _imgs;
  }
  function pronto() { return !!(W.jspdf && W.jspdf.jsPDF); }

  /* ── 1) o PDF ───────────────────────────────────────────────── */
  // Medidas em pontos, tiradas do modelo (Carta, 612 × 792).
  var X = { esq: 45, val: 120, dir2: 313, val2: 388, fim: 567 };
  var COLS_BASE = [ // [título, x0, x1, alinhamento]
    ['Código do produto', 45, 116, 'l'], ['Produto.', 116, 276, 'l'], ['Fabricante', 276, 362, 'l'], ['RMS', 362, 418, 'l'],
    ['Quantidade', 418, 466, 'r'], ['Valor de Venda', 466, 525, 'r'], ['Subtotal', 525, 567, 'r']
  ];
  // 26/10/2026 (pedido do usuário): o código do produto cabe numa linha — a
  // coluna estica até o código mais largo e o espaço sai do Produto (que fica
  // com pelo menos PRODUTO_MIN); o que nem assim couber diminui a fonte
  // 29/10/2026 (pedido do usuário): com IPI, a coluna IPI entre o Valor de
  // Venda e o Subtotal (que segue sem o IPI) — o espaço sai do Produto, do
  // Fabricante e do RMS; o IPI somado e o total com IPI vão embaixo
  var COLS_IPI = [
    ['Código do produto', 45, 116, 'l'], ['Produto.', 116, 258, 'l'], ['Fabricante', 258, 334, 'l'], ['RMS', 334, 388, 'l'],
    ['Quantidade', 388, 440, 'r'], ['Valor de Venda', 440, 494, 'r'], ['IPI', 494, 524, 'r'], ['Subtotal', 524, 567, 'r']
  ];
  var PRODUTO_MIN = 110;
  function colunas(largCodigo, comIpi) {
    var c = (comIpi ? COLS_IPI : COLS_BASE).map(function (x) { return x.slice(); });
    var x1 = Math.min(c[1][2] - PRODUTO_MIN, Math.max(c[0][2], c[0][1] + Math.ceil(largCodigo)));
    c[0][2] = x1; c[1][1] = x1;
    return c;
  }
  var TAM = 8.2;                 // a fonte do modelo (Roboto 8,2 pt ~ Helvetica 8,2 pt)
  var LH = 11.5;                 // entrelinha
  var LIMITE_Y = 690;            // acima do rodapé
  var COR = { rot: [33, 33, 33], val: [70, 70, 70], emp: [85, 85, 85], cab: [115, 115, 115], zebra: [240, 240, 240], linha: [190, 190, 190] };

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
      var doc = new W.jspdf.jsPDF({ unit: 'pt', format: 'letter', compress: true });
      doc.setProperties({ title: 'Proposta ' + (c.numero || ''), subject: 'Proposta comercial', author: op.nome || 'Biomedical', creator: 'Portal Biomedical' });
      var cli = c.cliente || {}, ct = c.contato || {}, dt = c.datas || {}, co = c.condicoes || {};
      doc.setFont('helvetica', 'normal'); doc.setFontSize(TAM);
      var comIpi = (c.itens || []).some(function (it) { return ipiDe(it) > 0; });
      var COLS = colunas(Math.max.apply(null, [0].concat((c.itens || []).map(function (it) { return doc.getTextWidth(String(it.codigo || '').trim()); }))) + 7, comIpi);

      function moldura() {
        if (img.topo) doc.addImage(img.topo, 'JPEG', 110.25, 11.25, 375, 78, 'topo', 'FAST');
        if (img.rodape) doc.addImage(img.rodape, 'JPEG', 110.25, 702.75, 375, 78, 'rodape', 'FAST');
      }
      function fonte(tam, cor, negrito) { doc.setFont('helvetica', negrito ? 'bold' : 'normal'); doc.setFontSize(tam); doc.setTextColor(cor[0], cor[1], cor[2]); }
      function linhas(txt, larg) { var t = String(txt == null ? '' : txt).trim(); return t ? doc.splitTextToSize(t, larg) : ['']; }
      // rótulo + valor (que pode quebrar em várias linhas); devolve a última linha usada
      function par(rot, valor, x, xv, y, larg) {
        fonte(TAM, COR.rot); var lr = linhas(rot, xv - x - 3); doc.text(lr, x, y, { lineHeightFactor: LH / TAM });
        fonte(TAM, COR.val); var lv = linhas(valor, larg); doc.text(lv, xv, y, { lineHeightFactor: LH / TAM });
        return y + (Math.max(lr.length, lv.length) - 1) * LH;
      }

      moldura();

      // Data de criação / Número de Proposta / Data de validade (à direita)
      [['Data de criação', diaBR(dt.cotacao) || diaBR(hoje())], ['Número de Proposta', c.numero || '(definido ao criar o caso)'], ['Data de validade', diaBR(dt.validade) || '—']]
        .forEach(function (l, i) {
          var y = 102 + i * 15.25;
          fonte(TAM, COR.rot); doc.text(l[0], 376, y, { align: 'right' });
          fonte(TAM, COR.val); doc.text(String(l[1]), X.fim - 11, y, { align: 'right' });
        });

      // a empresa
      fonte(TAM, COR.emp); doc.text(EMPRESA.razao, X.esq, 170.5);
      fonte(TAM, COR.emp); doc.text('CNPJ: ' + EMPRESA.cnpj, X.esq, 189.5);

      // Preparado por (o operador)
      var y = 213.5;
      [['Preparado por', op.nome || ''], ['Departamento', op.area || op.departamento || ''], ['Telefone', op.telefone || ''], ['Email', op.email || '']]
        .forEach(function (l) { y = par(l[0], l[1], X.esq, X.val, y, 250) + 15.25; });

      // o comprador: razão social, CNPJ e endereço à esquerda; contato à direita
      var yE = 289.5, yD = 289.5;
      yE = par('Razão Social', cli.nome || '', X.esq, X.val, yE, 175) + 15.5;
      yE = par('CNPJ', cnpjMask(cli.cnpj), X.esq, X.val, yE, 175) + 15.5;
      var end = [cli.endereco, [cli.cidade, cli.uf].filter(Boolean).join('-'), cepMask(cli.cep), (cli.endereco || cli.cidade || cli.cep) ? 'BRASIL' : ''].filter(Boolean).join('\n');
      yE = par('Endereço principal', end, X.esq, X.val, yE, 175);
      yD = par('Nome completo', ct.nome || '', X.dir2, X.val2, yD, X.fim - X.val2) + 15.25;
      yD = par('Email', ct.email || '', X.dir2, X.val2, yD, X.fim - X.val2) + 15.25;
      yD = par('Telefone', ct.telefone || '', X.dir2, X.val2, yD, X.fim - X.val2);
      var topo = Math.max(yE, yD) + 20;

      // 29/10/2026 (pedido do usuário): a cotação que passou pela A faturar leva no
      // PDF o que foi preenchido na mudança de fase — o paciente, a data da
      // cirurgia, o convênio e o médico aqui; o lote embaixo de cada produto
      var fa = c.faturamento || {};
      if (fa.paciente || fa.cirurgia || fa.convenio || fa.medico) {
        var yF = topo + 4;
        fonte(TAM, COR.rot, true); doc.text('Dados do faturamento', X.esq, yF);
        doc.setDrawColor(COR.linha[0], COR.linha[1], COR.linha[2]); doc.setLineWidth(0.6); doc.line(X.esq, yF + 5, X.fim, yF + 5);
        yF += 20;
        var yFE = par('Paciente', fa.paciente || '—', X.esq, X.val, yF, X.dir2 - X.val - 12) + 15.25;
        var yFD = par('Data da cirurgia', diaBR(fa.cirurgia) || fa.cirurgia || '—', X.dir2, X.val2, yF, X.fim - X.val2) + 15.25;
        yFE = par('Convênio', fa.convenio || '—', X.esq, X.val, yFE, X.dir2 - X.val - 12);
        yFD = par('Médico', fa.medico || '—', X.dir2, X.val2, yFD, X.fim - X.val2);
        topo = Math.max(yFE, yFD) + 20;
      }

      // a tabela dos itens
      function cabecalho(t) {
        doc.setFillColor(COR.cab[0], COR.cab[1], COR.cab[2]); doc.rect(X.esq, t, X.fim - X.esq, 29, 'F');
        fonte(TAM, [255, 255, 255]);
        COLS.forEach(function (col) {
          var l = linhas(col[0], col[2] - col[1] - 5), yy = t + 29 / 2 + 3.2 - (l.length - 1) * LH / 2;
          doc.text(l, col[3] === 'r' ? col[2] - 3 : col[1] + 3, yy, { align: col[3] === 'r' ? 'right' : 'left', lineHeightFactor: LH / TAM });
        });
        return t + 29;
      }
      y = cabecalho(topo);
      var itens = (c.itens || []).filter(function (it) { return it.descricao || it.codigo; });
      // número (RMS, quantidade, R$) e o código do produto não quebram no meio: "R$" numa linha e o
      // valor na outra, como no modelo; se nem assim couber, a fonte DAQUELA
      // célula diminui até caber
      function celNumero(v, larg) {
        fonte(TAM, COR.val);
        if (doc.getTextWidth(v) <= larg) return { l: [v], tam: TAM };
        var l = /^R\$ /.test(v) ? ['R$', v.slice(3)] : [v];
        var w = Math.max.apply(null, l.map(function (x) { return doc.getTextWidth(x); }));
        return { l: l, tam: w <= larg ? TAM : Math.max(5.5, TAM * larg / w) };
      }
      itens.forEach(function (it, i) {
        fonte(TAM, COR.val);
        var vu = Number(it.valorUnitario) || 0, q = Number(it.quantidade) || 0;
        // o produto do cadastro (Salesforce) ganha do que veio no PDF
        var p = sfDe(it);
        var desc = (p && W.COT.descricaoSf(p)) || it.descricao || '';
        var fab = (p && p.fabricante) || it.marca || '';
        var rms = (p && p.rms) || it.registro || (p && p.isento ? 'Isento' : '');
        var cel = [it.codigo || '', desc, fab, rms, q ? qtd(q) : '', vu ? brl(vu) : '—'].concat(comIpi ? [ipiDe(it) ? pctIpi(ipiDe(it)) : '—'] : [], [vu && q ? brl(vu * q) : '—'])
          .map(function (v, k) {
            var larg = COLS[k][2] - COLS[k][1] - 5;
            if (k >= 3 || k === 0) return celNumero(String(v).trim(), larg);
            // o lote do material (A faturar) embaixo do produto
            return { l: k === 1 && it.lote ? linhas(v, larg).concat(linhas('Lote: ' + it.lote, larg)) : linhas(v, larg), tam: TAM };
          });
        var n = Math.max.apply(null, cel.map(function (x) { return x.l.length; }));
        var h = n * LH + 6;
        if (y + h > LIMITE_Y) { doc.addPage(); moldura(); y = cabecalho(100); }
        if (i % 2 === 1) { doc.setFillColor(COR.zebra[0], COR.zebra[1], COR.zebra[2]); doc.rect(X.esq, y, X.fim - X.esq, h, 'F'); }
        doc.setDrawColor(COR.linha[0], COR.linha[1], COR.linha[2]); doc.setLineWidth(0.6);
        COLS.slice(1).forEach(function (col) { doc.line(col[1], y, col[1], y + h); });
        cel.forEach(function (x, k) {
          var col = COLS[k], l = x.l;
          fonte(x.tam, COR.val);
          // texto de uma linha fica no meio da linha da tabela; o que quebra começa no alto
          var yy = l.length === 1 ? y + h / 2 + 3.2 : y + 11.5 + (n - l.length) * LH / 2;
          doc.text(l, col[3] === 'r' ? col[2] - 3 : col[1] + 3, yy, { align: col[3] === 'r' ? 'right' : 'left', lineHeightFactor: LH / x.tam });
        });
        y += h;
      });
      if (!itens.length) { fonte(TAM, COR.val); doc.text('Nenhum item.', X.esq + 4, y + 16); y += 24; }

      // condição, total, frete e prazo de entrega (22/10/26: o frete e o prazo
      // voltaram) e a observação, que pode ter várias linhas
      if (y + (comIpi ? 120 : 110) > LIMITE_Y) { doc.addPage(); moldura(); y = 90; }
      y += 30.5;
      var vTot = totalDe(itens) || c.total || 0, vIpi = comIpi ? ipiTotal(itens) : 0;
      var y1 = par('Condição de Pagamento', co.pagamento || '', X.esq, X.val, y, X.dir2 - X.val - 12);
      var y2 = par(comIpi ? 'Valor sem IPI' : 'Valor total', brl(vTot), X.dir2, X.val2, y, X.fim - X.val2);
      // com IPI: o IPI somado e o total com ele (29/10/2026)
      if (comIpi) {
        y2 = par('IPI', brl(vIpi), X.dir2, X.val2, y2 + 15.25, X.fim - X.val2);
        y2 = par('Valor total com IPI', brl(vTot + vIpi), X.dir2, X.val2, y2 + 15.25, X.fim - X.val2);
      }
      y = Math.max(y1, y2) + 15.25;
      y1 = par('Frete', freteDe(co) || '—', X.esq, X.val, y, X.dir2 - X.val - 12);
      y2 = par('Prazo de entrega', String(co.entrega || '').trim() || '—', X.dir2, X.val2, y, X.fim - X.val2);
      y = Math.max(y1, y2) + 15.25;
      var obs = String(co.observacao || '').trim();
      if (obs) {
        fonte(TAM, COR.val);
        var lo = doc.splitTextToSize(obs, X.fim - X.val), rot = 'Observação';
        // quebra de página no meio da observação longa
        while (lo.length) {
          var cabe = Math.max(1, Math.floor((LIMITE_Y - y) / LH));
          if (cabe < 2 && lo.length > 1) { doc.addPage(); moldura(); y = 100; continue; }
          var parte = lo.slice(0, cabe); lo = lo.slice(cabe);
          fonte(TAM, COR.rot); doc.text(rot, X.esq, y);
          fonte(TAM, COR.val); doc.text(parte, X.val, y, { lineHeightFactor: LH / TAM });
          y += parte.length * LH; rot = '';
          if (lo.length) { doc.addPage(); moldura(); y = 100; }
        }
      }

      var buf = doc.output('arraybuffer');
      var blob = new Blob([buf], { type: 'application/pdf' });
      return { nome: nomeArquivo(c), base64: b64(buf), blob: blob, tamanho: buf.byteLength };
    });
  }

  /* ── 2) o e-mail ────────────────────────────────────────────── */
  function rotuloCotacao(c) { return [c.portal, c.cotacaoId ? 'nº ' + c.cotacaoId : ''].filter(Boolean).join(' '); }
  function assuntoPadrao(c) {
    return ['Proposta Biomedical ' + (c.numero || ''), rotuloCotacao(c) ? 'Cotação ' + rotuloCotacao(c) : '', (c.cliente && c.cliente.nome) || ''].filter(Boolean).join(' · ');
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
      'Segue em anexo a proposta comercial da Biomedical nº ' + (c.numero || '') + (rotuloCotacao(c) ? ', referente à cotação ' + rotuloCotacao(c) : '') + '.\n\n' +
      linhasCond.join('\n') + '\n\n' +
      'Ficamos à disposição para qualquer esclarecimento.\n\n' +
      'Atenciosamente,\n' + (op.nome || '') + (op.area ? '\n' + op.area : '') + '\nBiomedical Produtos Científicos Médicos e Hospitalares S.A.' +
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
