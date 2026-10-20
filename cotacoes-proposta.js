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
      modelo saíram em 09/10/2026, a pedido.)
      As imagens do topo e do rodapé são as do modelo (assets/proposta-*.jpg).
   2) enviar(caso, operador, {para, copia, assunto, mensagem}) -> manda a
      proposta com o PDF anexo pelo OUTLOOK DE QUEM ESTÁ LOGADO (Graph
      /me/sendMail, permissão delegada Mail.Send — a primeira vez pede o
      consentimento num popup) e registra no caso ({acao:'proposta'}: o PDF
      fica nos anexos e o envio no histórico). Sai da caixa da pessoa e
      fica nos Itens Enviados dela; a resposta do comprador volta para ela.

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
  function qtd(v) { return (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 }); }
  function cnpjMask(d) {
    d = String(d || '').replace(/\D/g, '');
    if (d.length === 14) return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12);
    if (d.length === 11) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
    return d;
  }
  function cepMask(c) { var d = String(c || '').replace(/\D/g, ''); return d.length === 8 ? d.slice(0, 5) + '-' + d.slice(5) : String(c || ''); }
  function totalDe(itens) { return (itens || []).reduce(function (s, it) { return s + (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0); }, 0); }
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
  var COLS = [ // [título, x0, x1, alinhamento]
    ['Código do produto', 45, 116, 'l'], ['Produto.', 116, 276, 'l'], ['Fabricante', 276, 362, 'l'], ['RMS', 362, 418, 'l'],
    ['Quantidade', 418, 466, 'r'], ['Valor de Venda', 466, 525, 'r'], ['Subtotal', 525, 567, 'r']
  ];
  var TAM = 8.2;                 // a fonte do modelo (Roboto 8,2 pt ~ Helvetica 8,2 pt)
  var LH = 11.5;                 // entrelinha
  var LIMITE_Y = 690;            // acima do rodapé
  var COR = { rot: [33, 33, 33], val: [70, 70, 70], emp: [85, 85, 85], cab: [115, 115, 115], zebra: [240, 240, 240], linha: [190, 190, 190] };

  function gerar(caso, operador) {
    if (!pronto()) return Promise.reject(new Error('A biblioteca que gera o PDF (jsPDF) não carregou — recarregue a página.'));
    var c = caso || {}, op = operador || {};
    return imagens().then(function (img) {
      var doc = new W.jspdf.jsPDF({ unit: 'pt', format: 'letter', compress: true });
      doc.setProperties({ title: 'Proposta ' + (c.numero || ''), subject: 'Proposta comercial', author: op.nome || 'Biomedical', creator: 'Portal Biomedical' });
      var cli = c.cliente || {}, ct = c.contato || {}, dt = c.datas || {}, co = c.condicoes || {};

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

      // a tabela dos itens
      var topo = Math.max(yE, yD) + 20;
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
      // número (RMS, quantidade, R$) não quebra no meio: "R$" numa linha e o
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
        var cel = [it.codigo || '', it.descricao || '', it.marca || '', it.registro || '', q ? qtd(q) : '', vu ? brl(vu) : '—', vu && q ? brl(vu * q) : '—']
          .map(function (v, k) { var larg = COLS[k][2] - COLS[k][1] - 5; return k >= 3 ? celNumero(String(v), larg) : { l: linhas(v, larg), tam: TAM }; });
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

      // condição e total (09/10/26: sem Nome do Médico, Frete e Prazo de entrega)
      if (y + 80 > LIMITE_Y) { doc.addPage(); moldura(); y = 90; }
      y += 30.5;
      par('Condição de Pagamento', co.pagamento || '', X.esq, X.val, y, X.dir2 - X.val - 12);
      par('Valor total', brl(totalDe(itens) || c.total || 0), X.dir2, X.val2, y, X.fim - X.val2);

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
    var co = c.condicoes || {}, dt = c.datas || {}, ct = c.contato || {};
    var n = (c.itens || []).filter(function (it) { return it.descricao || it.codigo; }).length;
    var linhasCond = [
      n + ' item(ns) · valor total ' + brl(totalDe(c.itens) || c.total || 0),
      co.pagamento ? 'Condição de pagamento: ' + co.pagamento : '',
      dt.validade ? 'Data de vencimento: ' + diaBR(dt.validade) : ''
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
  function enviarPeloOutlook(msg) {
    return tokenEnvio().then(function (tok) {
      return fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject: msg.assunto,
            body: { contentType: 'HTML', content: msg.html },
            toRecipients: msg.para.map(function (e) { return { emailAddress: { address: e } }; }),
            ccRecipients: msg.copia.map(function (e) { return { emailAddress: { address: e } }; }),
            attachments: [{ '@odata.type': '#microsoft.graph.fileAttachment', name: msg.pdf.nome, contentType: 'application/pdf', contentBytes: msg.pdf.base64 }]
          },
          saveToSentItems: true
        })
      });
    }).then(function (r) {
      if (r.status === 202 || r.ok) return true;
      return r.text().then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
        var m = (j && j.error && j.error.message) || ('Outlook respondeu ' + r.status);
        throw new Error(r.status === 403 ? 'Sem permissão para enviar e-mail pelo seu login (Mail.Send). ' + m : m);
      });
    });
  }

  // gera (se não veio pronto), envia e registra no caso; devolve o caso atualizado
  function enviar(caso, operador, opts) {
    opts = opts || {};
    var para = listaEmails(opts.para), copia = listaEmails(opts.copia);
    if (!para.length) return Promise.reject(new Error('Informe o e-mail do comprador.'));
    if (!caso || !/^COT-\d{4}-\d{6}$/.test(caso.numero || '')) return Promise.reject(new Error('Crie o caso antes de enviar a proposta.'));
    var assunto = String(opts.assunto || '').trim() || assuntoPadrao(caso);
    var html = textoParaHtml(String(opts.mensagem || '').trim() || mensagemPadrao(caso, operador || {}));
    var pdf = null;
    return (opts.pdf ? Promise.resolve(opts.pdf) : gerar(caso, operador)).then(function (p) {
      pdf = p;
      return enviarPeloOutlook({ assunto: assunto, html: html, para: para, copia: copia, pdf: pdf });
    }).then(function () {
      return W.COT.api('cot-casos', { acao: 'proposta', numero: caso.numero, para: para, copia: copia, assunto: assunto, canal: 'outlook',
        anexo: { nome: pdf.nome, tipo: 'application/pdf', base64: pdf.base64 } })
        .then(function (j) { return { caso: j && j.caso, enviado: true }; })
        // o e-mail JÁ saiu: falhar o registro não pode parecer falha do envio
        .catch(function (e) { return { caso: null, enviado: true, erroRegistro: e.message }; });
    });
  }

  W.COTPROP = {
    // autorizar(): pega o token de envio JÁ NO CLIQUE — o popup de
    // consentimento aberto depois de esperar o servidor é barrado pelo navegador
    pronto: pronto, gerar: gerar, enviar: enviar, autorizar: tokenEnvio, assuntoPadrao: assuntoPadrao, mensagemPadrao: mensagemPadrao,
    nomeArquivo: nomeArquivo, listaEmails: listaEmails, preCarregar: imagens
  };
})();
