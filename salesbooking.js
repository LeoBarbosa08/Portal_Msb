/* ================================================================
   salesbooking.js — motor do Sales Playbook (Comercial)
   ----------------------------------------------------------------
   Uma página, três telas, roteadas por query string:
     (sem parâmetro)  → hub (trilhas + capítulos + artigos)
     ?c=<capitulo>    → lista de artigos do capítulo
     ?a=<artigo>      → leitura do artigo
     ?q=<termo>       → resultados da busca
   O conteúdo vem de salesbooking-data.js (window.SALESBOOKING).
   Progresso de leitura fica em localStorage (por navegador).
   ================================================================ */
(function () {
  'use strict';

  var DB = window.SALESBOOKING;
  if (!DB) return;

  var LIDOS_KEY = 'sb_lidos';
  var view, elBusca, elBreadcrumb, elSubtitulo, elPills;

  /* ── utilitários ─────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function slug(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function qs(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }
  function artigo(id) {
    for (var i = 0; i < DB.artigos.length; i++) if (DB.artigos[i].id === id) return DB.artigos[i];
    return null;
  }
  function capitulo(id) {
    for (var i = 0; i < DB.capitulos.length; i++) if (DB.capitulos[i].id === id) return DB.capitulos[i];
    return null;
  }
  function doCapitulo(capId) {
    return DB.artigos.filter(function (a) { return a.capitulo === capId; });
  }
  function dataBr(iso) {
    var p = String(iso || '').split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : '';
  }

  /* ── progresso de leitura ────────────────────────────────────── */
  function lidos() {
    try { return JSON.parse(localStorage.getItem(LIDOS_KEY) || '[]') || []; }
    catch (e) { return []; }
  }
  function foiLido(id) { return lidos().indexOf(id) >= 0; }
  function marcar(id, on) {
    var L = lidos(), i = L.indexOf(id);
    if (on && i < 0) L.push(id);
    if (!on && i >= 0) L.splice(i, 1);
    try { localStorage.setItem(LIDOS_KEY, JSON.stringify(L)); } catch (e) {}
  }

  /* ── ícones ──────────────────────────────────────────────────── */
  var IC = {
    grafico:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    ferramenta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    arquivo:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
    livro:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    seta:       '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
    volta:      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    lupa:       '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    ext:        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    interno:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    check:      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    info:       '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    alerta:     '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    ok:         '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    relogio:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    livroPill:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>'
  };

  /* ── navegação ───────────────────────────────────────────────── */
  function ir(query, push) {
    var url = location.pathname + (query ? '?' + query : '');
    if (push !== false) history.pushState({}, '', url);
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
    var main = document.querySelector('.dept-main');
    if (main) main.scrollTop = 0;
  }

  /* ── blocos do artigo ────────────────────────────────────────── */
  function renderBloco(b) {
    switch (b.t) {
      case 'h2':
        return '<h2 id="sec-' + slug(b.x) + '">' + esc(b.x) + '</h2>';
      case 'p':
        return '<p>' + esc(b.x) + '</p>';
      case 'ul':
        return '<ul>' + b.x.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
      case 'ol':
        return '<ol>' + b.x.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ol>';
      case 'passos':
        return '<div class="sbk-passos">' + b.x.map(function (p, i) {
          return '<div class="sbk-passo"><div class="sbk-passo-n">' + (i + 1) + '</div>' +
            '<div><div class="sbk-passo-t">' + esc(p.titulo) + '</div>' +
            '<div class="sbk-passo-x">' + esc(p.texto) + '</div></div></div>';
        }).join('') + '</div>';
      case 'nota':
        var tom = b.tom || 'info';
        return '<div class="sbk-nota" data-tom="' + esc(tom) + '">' + (IC[tom] || IC.info) +
          '<div><div class="sbk-nota-t">' + esc(b.titulo) + '</div>' +
          '<div class="sbk-nota-x">' + esc(b.x) + '</div></div></div>';
      case 'tabela':
        return '<div class="sbk-tblwrap"><table><thead><tr>' +
          b.head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
          '</tr></thead><tbody>' +
          b.rows.map(function (r) {
            return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody></table></div>';
      case 'links':
        return '<div class="sbk-links">' + b.x.map(function (l) {
          var ext = !!l.ext;
          return '<a class="sbk-link" href="' + esc(l.href) + '"' +
            (ext ? ' target="_blank" rel="noopener"' : '') + '><span>' + esc(l.label) + '</span>' +
            (ext ? IC.ext : IC.interno) + '</a>';
        }).join('') + '</div>';
      case 'termos':
        return '<dl class="sbk-termos">' + b.x.map(function (t) {
          return '<div class="sbk-termo" id="t-' + slug(t.termo) + '"><dt>' + esc(t.termo) + '</dt>' +
            '<dd>' + esc(t.def) + '</dd></div>';
        }).join('') + '</dl>';
      default:
        return '';
    }
  }

  /* texto puro de um artigo — usado pela busca */
  function textoDe(a) {
    var out = [a.titulo, a.resumo, (a.tags || []).join(' ')];
    (a.blocos || []).forEach(function (b) {
      if (typeof b.x === 'string') out.push(b.x);
      else if (Array.isArray(b.x)) {
        b.x.forEach(function (i) {
          if (typeof i === 'string') out.push(i);
          else if (i && i.titulo) out.push(i.titulo + ' ' + (i.texto || ''));
          else if (i && i.termo) out.push(i.termo + ' ' + (i.def || ''));
          else if (i && i.label) out.push(i.label);
        });
      }
      if (b.titulo) out.push(b.titulo);
      if (b.head) out.push(b.head.join(' '));
      if (b.rows) b.rows.forEach(function (r) { out.push(r.join(' ')); });
    });
    return out.join(' · ');
  }

  /* ── peças reutilizáveis ─────────────────────────────────────── */
  function selo(a) {
    var s = '';
    if (a.status === 'rascunho') s += '<span class="sbk-tag-rasc">Rascunho</span>';
    if (foiLido(a.id)) s += '<span class="sbk-lido">' + IC.check + 'Lido</span>';
    return s;
  }

  function itemArtigo(a, n, mostrarCapitulo) {
    var cap = capitulo(a.capitulo);
    return '<a class="sbk-item" href="?a=' + esc(a.id) + '" data-nav="1">' +
      (n ? '<span class="sbk-item-n">' + (n < 10 ? '0' + n : n) + '</span>' : '') +
      '<span class="sbk-item-body">' +
        '<span class="sbk-item-t">' + esc(a.titulo) + selo(a) + '</span>' +
        '<span class="sbk-item-s">' + esc(a.resumo) + '</span>' +
      '</span>' +
      '<span class="sbk-item-r">' +
        (mostrarCapitulo && cap ? '<span class="sbk-item-cap">' + esc(cap.titulo) + '</span>' : '') +
        '<span class="sbk-min">' + a.minutos + ' min</span>' + IC.seta +
      '</span></a>';
  }

  function bannerRascunho() {
    var n = DB.artigos.filter(function (a) { return a.status === 'rascunho'; }).length;
    if (!n) return '';
    return '<div class="sbk-banner">' + IC.alerta +
      '<div><b>Conteúdo em validação.</b> ' + n + ' artigo' + (n > 1 ? 's estão' : ' está') +
      ' marcado' + (n > 1 ? 's' : '') + ' como rascunho: são um modelo inicial, escrito para dar forma ao módulo. ' +
      'Valide o texto com a coordenação antes de tratar como norma do time.</div></div>';
  }

  /* ── TELA · HUB ──────────────────────────────────────────────── */
  function telaHub() {
    var h = '';

    h += bannerRascunho();

    /* trilhas */
    h += '<section><div class="sbk-sec-head sbk-sec-stack"><h2>Trilhas de treinamento</h2>' +
      '<span class="sbk-sec-hint">Comece por aqui se você é novo no time</span></div>' +
      '<div class="sbk-trilhas">';
    DB.trilhas.forEach(function (t) {
      var total = t.aulas.length;
      var feitas = t.aulas.filter(foiLido).length;
      var pct = total ? Math.round(feitas / total * 100) : 0;
      var primeira = t.aulas.filter(function (id) { return !foiLido(id); })[0] || t.aulas[0];
      h += '<a class="sbk-trilha" href="?a=' + esc(primeira) + '" data-nav="1">' +
        '<div class="sbk-tr-top"><span class="sbk-tr-nivel">' + esc(t.nivel) + '</span>' +
        '<span class="sbk-tr-pct"' + (pct ? '' : ' data-zero="1"') + '>' + pct + '%</span></div>' +
        '<h3>' + esc(t.titulo) + '</h3>' +
        '<div class="sbk-tr-desc">' + esc(t.desc) + '</div>' +
        '<div class="sbk-bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="sbk-tr-aulas">' + feitas + ' de ' + total + ' aulas</div></a>';
    });
    h += '</div></section>';

    /* capítulos */
    h += '<section><div class="sbk-sec-head sbk-sec-stack"><h2>Capítulos</h2>' +
      '<span class="sbk-sec-hint">Documentação do Comercial</span></div>' +
      '<div class="sbk-caps">';
    DB.capitulos.forEach(function (c) {
      var n = doCapitulo(c.id).length;
      h += '<a class="sbk-cap" href="?c=' + esc(c.id) + '" data-nav="1">' +
        '<div class="sbk-cap-top"><span class="sbk-ic" data-tom="' + esc(c.tom) + '">' + (IC[c.icone] || IC.livro) + '</span>' +
        '<span class="sbk-count">' + n + (n === 1 ? ' artigo' : ' artigos') + '</span></div>' +
        '<h3>' + esc(c.titulo) + '</h3>' +
        '<div class="sbk-cap-desc">' + esc(c.desc) + '</div></a>';
    });
    h += '</div></section>';

    /* atualizados recentemente */
    var recentes = DB.artigos.slice().sort(function (a, b) {
      return String(b.atualizado).localeCompare(String(a.atualizado));
    }).slice(0, 5);
    h += '<section><div class="sbk-sec-head sbk-sec-stack"><h2>Atualizados recentemente</h2>' +
      '<span class="sbk-sec-hint">Última revisão do conteúdo</span></div><div class="sbk-list">' +
      recentes.map(function (a) { return itemArtigo(a, 0, true); }).join('') + '</div></section>';

    return h;
  }

  /* ── TELA · CAPÍTULO ─────────────────────────────────────────── */
  function telaCapitulo(c) {
    var arts = doCapitulo(c.id);
    return '<a class="sbk-back" href="?" data-nav="1">' + IC.volta + ' Voltar ao Sales Playbook</a>' +
      '<div class="sbk-cap-head"><span class="sbk-ic" data-tom="' + esc(c.tom) + '">' +
      (IC[c.icone] || IC.livro) + '</span><div><h2>' + esc(c.titulo) + '</h2><p>' + esc(c.desc) + '</p></div></div>' +
      (arts.length
        ? '<div class="sbk-list">' + arts.map(function (a, i) { return itemArtigo(a, i + 1, false); }).join('') + '</div>'
        : '<div class="sbk-empty">Nenhum artigo publicado neste capítulo ainda.</div>');
  }

  /* ── TELA · ARTIGO ───────────────────────────────────────────── */
  function telaArtigo(a) {
    var cap = capitulo(a.capitulo);
    var irmaos = doCapitulo(a.capitulo);
    var idx = irmaos.map(function (x) { return x.id; }).indexOf(a.id);
    var prox = idx >= 0 && idx < irmaos.length - 1 ? irmaos[idx + 1] : null;

    var secoes = (a.blocos || []).filter(function (b) { return b.t === 'h2'; });
    var toc = secoes.length
      ? '<aside class="sbk-toc"><div class="sbk-toc-t">Neste artigo</div>' +
        secoes.map(function (s) {
          return '<a href="#sec-' + slug(s.x) + '" data-toc="sec-' + slug(s.x) + '">' + esc(s.x) + '</a>';
        }).join('') + '</aside>'
      : '';

    var lido = foiLido(a.id);

    var corpo = '<article class="sbk-art">' +
      '<a class="sbk-back" href="?c=' + esc(a.capitulo) + '" data-nav="1">' + IC.volta + ' ' +
        esc(cap ? cap.titulo : 'Sales Playbook') + '</a>' +
      '<h1>' + esc(a.titulo) + '</h1>' +
      '<div class="sbk-art-meta">' +
        esc(cap ? cap.titulo : '') + ' · leitura de ' + a.minutos + ' min · atualizado em ' + dataBr(a.atualizado) +
        (a.status === 'rascunho' ? ' <span class="sbk-tag-rasc">Rascunho</span>' : '') +
      '</div>' +
      (a.blocos || []).map(renderBloco).join('') +
      '<div class="sbk-art-foot">' +
        '<button type="button" class="sbk-btn" id="sbk-marcar" data-on="' + (lido ? '1' : '0') + '">' +
          IC.check + '<span>' + (lido ? 'Lido' : 'Marcar como lido') + '</span></button>' +
        (prox ? '<a class="sbk-next" href="?a=' + esc(prox.id) + '" data-nav="1">Próximo: ' +
          esc(prox.titulo) + ' ' + IC.seta + '</a>' : '') +
      '</div></article>';

    return '<div class="sbk-art-grid">' + corpo + toc + '</div>';
  }

  /* ── TELA · BUSCA ────────────────────────────────────────────── */
  function telaBusca(q) {
    var termo = norm(q).trim();
    if (termo.length < 2) {
      return '<div class="sbk-empty">Digite pelo menos duas letras para buscar.</div>';
    }
    var partes = termo.split(/\s+/);
    var achados = DB.artigos.map(function (a) {
      var alvo = norm(a.titulo + ' ' + a.resumo + ' ' + (a.tags || []).join(' '));
      var corpo = norm(textoDe(a));
      var pontos = 0, todas = true;
      partes.forEach(function (p) {
        if (alvo.indexOf(p) >= 0) pontos += 3;
        else if (corpo.indexOf(p) >= 0) pontos += 1;
        else todas = false;
      });
      return todas ? { a: a, pontos: pontos } : null;
    }).filter(Boolean).sort(function (x, y) { return y.pontos - x.pontos; });

    var cab = '<div class="sbk-sec-head"><h2>' + achados.length +
      (achados.length === 1 ? ' resultado' : ' resultados') + ' para "' + esc(q) + '"</h2>' +
      '<a class="sbk-back" href="?" data-nav="1">' + IC.volta + ' Voltar ao Sales Playbook</a></div>';

    if (!achados.length) {
      return cab + '<div class="sbk-empty">Nada encontrado. Tente o termo em outra forma — ' +
        'a busca cobre título, resumo e o texto completo dos artigos.</div>';
    }
    return cab + '<div class="sbk-list">' +
      achados.map(function (r) { return itemArtigo(r.a, 0, true); }).join('') + '</div>';
  }

  /* ── render ──────────────────────────────────────────────────── */
  function render() {
    var q = qs('q'), cid = qs('c'), aid = qs('a');
    var bc = [{ t: 'Portal', h: '../index.html' }, { t: 'Comercial', h: 'comercial.html' }];
    var sub = 'O dicionário do Comercial — como vender, como usar as ferramentas, como executar cada processo.';

    if (q) {
      view.innerHTML = telaBusca(q);
      document.title = 'Busca: ' + q + ' · Sales Playbook · Biomedical';
      bc.push({ t: 'Sales Playbook', h: '?' });
      bc.push({ t: 'Busca' });
    } else if (aid && artigo(aid)) {
      var a = artigo(aid);
      view.innerHTML = telaArtigo(a);
      document.title = a.titulo + ' · Sales Playbook · Biomedical';
      bc.push({ t: 'Sales Playbook', h: '?' });
      var cA = capitulo(a.capitulo);
      if (cA) bc.push({ t: cA.titulo, h: '?c=' + cA.id });
      bc.push({ t: a.titulo });
      ligarArtigo(a);
    } else if (cid && capitulo(cid)) {
      var c = capitulo(cid);
      view.innerHTML = telaCapitulo(c);
      document.title = c.titulo + ' · Sales Playbook · Biomedical';
      bc.push({ t: 'Sales Playbook', h: '?' });
      bc.push({ t: c.titulo });
    } else {
      view.innerHTML = telaHub();
      document.title = 'Sales Playbook · Comercial · Biomedical';
      bc.push({ t: 'Sales Playbook' });
    }

    if (elBusca && elBusca.value !== q) elBusca.value = q;
    pintarBreadcrumb(bc);
    if (elSubtitulo) elSubtitulo.textContent = sub;
    pintarPills();
  }

  function pintarBreadcrumb(itens) {
    if (!elBreadcrumb) return;
    var sep = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
    elBreadcrumb.innerHTML = itens.map(function (i, n) {
      var el = i.h ? '<a href="' + esc(i.h) + '"' + (/^\?/.test(i.h) ? ' data-nav="1"' : '') + '>' + esc(i.t) + '</a>'
                   : '<span>' + esc(i.t) + '</span>';
      return (n ? sep : '') + el;
    }).join('');
  }

  function pintarPills() {
    if (!elPills) return;
    var n = DB.artigos.length;
    var l = DB.artigos.filter(function (a) { return foiLido(a.id); }).length;
    elPills.innerHTML =
      '<span class="dv-hero-pill">' + IC.livroPill + n + (n === 1 ? ' artigo' : ' artigos') + '</span>' +
      (l ? '<span class="dv-hero-pill"><span class="dv-dot"></span>' + l + ' lido' + (l > 1 ? 's' : '') + '</span>' : '');
  }

  /* ── interações do artigo: marcar lido + índice ativo ────────── */
  function ligarArtigo(a) {
    var btn = document.getElementById('sbk-marcar');
    if (btn) {
      btn.addEventListener('click', function () {
        var on = btn.getAttribute('data-on') !== '1';
        marcar(a.id, on);
        btn.setAttribute('data-on', on ? '1' : '0');
        btn.querySelector('span').textContent = on ? 'Lido' : 'Marcar como lido';
        pintarPills();
      });
    }

    var links = [].slice.call(document.querySelectorAll('.sbk-toc a'));
    if (!links.length) return;

    links.forEach(function (l) {
      l.addEventListener('click', function (e) {
        e.preventDefault();
        var alvo = document.getElementById(l.getAttribute('data-toc'));
        if (!alvo) return;
        var main = document.querySelector('.dept-main');
        if (main && main.scrollHeight > main.clientHeight) {
          main.scrollTo({ top: alvo.offsetTop - 20, behavior: 'smooth' });
        } else {
          alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });

    var secoes = links.map(function (l) { return document.getElementById(l.getAttribute('data-toc')); });
    var scroller = document.querySelector('.dept-main');
    function ativo() {
      var topo = (scroller && scroller.scrollHeight > scroller.clientHeight)
        ? scroller.scrollTop + 120
        : (window.pageYOffset || document.documentElement.scrollTop) + 140;
      var atual = 0;
      secoes.forEach(function (s, i) { if (s && s.offsetTop <= topo) atual = i; });
      links.forEach(function (l, i) { l.classList.toggle('on', i === atual); });
    }
    (scroller || window).addEventListener('scroll', ativo, { passive: true });
    ativo();
  }

  /* ── boot ────────────────────────────────────────────────────── */
  function boot() {
    view         = document.getElementById('sbk-view');
    elBusca      = document.getElementById('sbk-q');
    elBreadcrumb = document.querySelector('.area-header .breadcrumb');
    elSubtitulo  = document.getElementById('sbk-sub');
    if (!view) return;

    /* pills no hero (contagem de artigos) */
    var top = document.querySelector('.area-header .area-header-top');
    if (top && !top.querySelector('.dv-hero-pills')) {
      elPills = document.createElement('div');
      elPills.className = 'dv-hero-pills';
      top.appendChild(elPills);
    } else if (top) {
      elPills = top.querySelector('.dv-hero-pills');
    }

    /* navegação interna sem recarregar a página */
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[data-nav="1"]');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      e.preventDefault();
      var href = a.getAttribute('href') || '?';
      ir(href.replace(/^\?/, ''));
    });

    window.addEventListener('popstate', function () { render(); });

    /* busca */
    if (elBusca) {
      var t;
      elBusca.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(function () {
          var v = elBusca.value.trim();
          ir(v ? 'q=' + encodeURIComponent(v) : '');
          if (elBusca !== document.activeElement) elBusca.focus();
        }, 220);
      });
      elBusca.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { elBusca.value = ''; ir(''); }
      });
    }
    var limpar = document.getElementById('sbk-limpar');
    if (limpar) {
      limpar.addEventListener('click', function () {
        if (elBusca) elBusca.value = '';
        ir('');
      });
    }

    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
