// ================================================================
// alertas.js — "Para você" na HOME do Portal Biomedical
//
// Lê /api/alertas e desenha a faixa de alertas da PESSOA logada: nova
// aprovação de remessa, comissão esperando o diretor, fila da LICI, Vigia
// do consignado, prazo de cobrança vencido, votação OKR aberta e aviso
// novo no mural. Quem decide O QUE cada um vê é o BACKEND (área do grupo
// do Entra + alçada) — aqui não existe regra de acesso, só desenho.
//
// TRÊS CUIDADOS que explicam o formato do código:
//   1. ALERTA É ENFEITE. Nada aqui pode quebrar a home: falha de rede,
//      401, JSON estranho → a seção simplesmente não aparece.
//   2. SEGUNDO PORTÃO no clique. Item de ÁREA passa pelo
//      window.bmHrefPermitido() do area-access.js antes de ser desenhado:
//      se a pessoa não pode abrir a página, o cartão não existe. Item de
//      ALÇADA (gate:'papel') não passa por aí de propósito — quem libera é
//      o grupo do Entra, e a página tem gate próprio.
//   3. DISPENSAR é por OCORRÊNCIA, não por tipo: a chave guardada é
//      id+quando. Aviso novo do mural volta a aparecer; aprovação
//      pendente não é dispensável (só sai quando for decidida).
//
// Espera o `areaaccess:ready` (identidade resolvida + bmHrefPermitido
// pronto). Cache de 2 min em sessionStorage para trocar de página e
// voltar não bater na API de novo.
// ================================================================
(function () {
  'use strict';

  var API = '/api/alertas';
  var KEY = 'bm-alertas-v1';        // cache da resposta (sessão)
  var KEY_OFF = 'bm-alertas-off';   // o que a pessoa dispensou (permanente)
  var TTL = 2 * 60 * 1000;
  var RECARGA = 5 * 60 * 1000;

  // Quantos cartões ficam à vista antes do "Ver todos". Sem teto, quem tem
  // muitas áreas (TI/diretoria) empurrava os Departamentos uns 700px para
  // baixo — a faixa deixava de ser um aviso e virava a home.
  var TETO = { desktop: 6, mobile: 3 };
  var MQ_MOBILE = '(max-width: 767.98px)';

  var sec = null, grid = null, cont = null, bell = null, bellDot = null, tg = null;

  // ── ícones (Lucide-style, 20px) ────────────────────────────────
  var SVG = {
    aprovacao: '<path d="M9 12l2 2 4-4"/><path d="M12 3a2.5 2.5 0 0 1 2.1 1.15A2.5 2.5 0 0 1 17.6 6.4a2.5 2.5 0 0 1 0 4.2A2.5 2.5 0 0 1 14.1 14a2.5 2.5 0 0 1-4.2 0A2.5 2.5 0 0 1 6.4 11.6a2.5 2.5 0 0 1 0-4.2A2.5 2.5 0 0 1 9.9 4.15A2.5 2.5 0 0 1 12 3Z"/><path d="M8.5 14.5 6 22l6-3 6 3-2.5-7.5"/>',
    liberado:  '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/><path d="M9.5 16.5l1.7 1.7 3.3-3.3"/>',
    negado:    '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/>',
    dinheiro:  '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    relogio:   '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    agenda:    '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M8 3v3M16 3v3M3 10h18"/><path d="M12 14v4M10 16h4"/>',
    caixa:     '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    voto:      '<path d="M6 20V10M12 20V4M18 20v-7"/>',
    mural:     '<path d="M3 11v3a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M14.5 8.5a5 5 0 0 1 0 7"/><path d="M17.5 6a8 8 0 0 1 0 12"/>',
    sino:      '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    ok:        '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.2 2.2 4.8-4.8"/>'
  };
  function icone(k) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
           'stroke-linecap="round" stroke-linejoin="round">' + (SVG[k] || SVG.sino) + '</svg>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // "agora", "há 12 min", "há 3 h", "há 2 dias" — data absoluta acima de 7 dias
  function quando(iso) {
    if (!iso) return '';
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var m = Math.floor((Date.now() - t) / 60000);
    if (m < 1) return 'agora';
    if (m < 60) return 'há ' + m + ' min';
    var h = Math.floor(m / 60);
    if (h < 24) return 'há ' + h + ' h';
    var d = Math.floor(h / 24);
    if (d <= 7) return 'há ' + d + (d === 1 ? ' dia' : ' dias');
    return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }

  // ── dispensados (localStorage) ─────────────────────────────────
  function lerOff() {
    try { return JSON.parse(localStorage.getItem(KEY_OFF) || '{}') || {}; }
    catch (e) { return {}; }
  }
  // A chave é id + OCORRÊNCIA (a data do fato), não o id sozinho: dispensar
  // o aviso de hoje não pode esconder o de amanhã. Vai no NOME da chave, e
  // não no valor, porque item sem data ('') tem de ser dispensável do mesmo
  // jeito — comparando valores, o `quando` nulo nunca casava e o cartão
  // voltava no recarregamento seguinte.
  function chaveOff(it) { return it.id + '@' + (it.quando || ''); }
  function marcarOff(it) {
    var o = lerOff();
    o[chaveOff(it)] = Date.now();
    // não deixa crescer para sempre: mantém as 60 dispensas mais recentes
    var ks = Object.keys(o);
    if (ks.length > 60) {
      ks.sort(function (a, b) { return (Number(o[a]) || 0) - (Number(o[b]) || 0); })
        .slice(0, ks.length - 60)
        .forEach(function (k) { delete o[k]; });
    }
    try { localStorage.setItem(KEY_OFF, JSON.stringify(o)); } catch (e) {}
  }
  function dispensado(it) {
    if (!it.dispensavel) return false;
    return Object.prototype.hasOwnProperty.call(lerOff(), chaveOff(it));
  }

  // ── cache de sessão ────────────────────────────────────────────
  // AMARRADO À PESSOA: o sessionStorage sobrevive a logout+login na mesma
  // aba (e máquina compartilhada é rotina em filial e almoxarifado). Sem
  // conferir de quem é a resposta, quem entrasse depois veria por até 2
  // minutos as pendências de quem saiu. A resposta carrega `papel.email`;
  // se não for o mesmo do login atual, o cache é jogado fora.
  function euSou() {
    return String((window._portalUser && window._portalUser.email) || '').trim().toLowerCase();
  }
  function lerCache() {
    try {
      var c = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (!c || Date.now() - c.em >= TTL) return null;
      var eu = euSou();
      var dono = String((c.r && c.r.papel && c.r.papel.email) || '').toLowerCase();
      if (eu && dono && eu !== dono) { sessionStorage.removeItem(KEY); return null; }
      return c.r;
    } catch (e) { return null; }
  }
  function gravarCache(r) {
    try { sessionStorage.setItem(KEY, JSON.stringify({ em: Date.now(), r: r })); } catch (e) {}
  }

  // ── desenho ────────────────────────────────────────────────────
  function esqueleto() {
    grid.innerHTML = '<div class="al-skel"></div><div class="al-skel"></div><div class="al-skel"></div>';
    sec.hidden = false;
  }

  function vazio() {
    if (cont) cont.textContent = '';     // senão fica "1 item" ao lado de "nada pendente"
    grid.innerHTML =
      '<div class="al-card al-vazio">' +
        '<span class="al-ic t-ok">' + icone('ok') + '</span>' +
        '<div class="al-body"><h3>Nada pendente para você</h3>' +
        '<p>Aprovações, prazos e novidades das suas áreas aparecem aqui.</p></div>' +
      '</div>';
  }

  // Uma LINHA da lista. A ordem dos filhos é a ordem de leitura no desktop:
  //   ícone · título+resumo · (nº) · área·módulo · quando · CTA
  // No mobile o CSS remonta isso em duas alturas (procedência em cima,
  // título embaixo). As classes com-badge/com-x existem porque o desenho
  // muda com elas: sem número entra a seta, e o × precisa de espaço
  // reservado — decidir isso no CSS exigiria :has() em toda a base.
  function cartao(it) {
    var temBadge = it.contagem > 1;
    var badge = temBadge
      ? '<span class="al-badge">' + (it.contagem > 99 ? '99+' : it.contagem) + '</span>' : '';
    var chip = [it.areaRotulo, it.modulo].filter(Boolean).map(esc).join(' <span class="al-sep">·</span> ');
    var w = quando(it.quando);
    var x = it.dispensavel
      ? '<button type="button" class="al-x" title="Dispensar" aria-label="Dispensar alerta">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
        '<path d="M18 6 6 18M6 6l12 12"/></svg></button>' : '';

    return '<article class="al-card p-' + esc(it.prioridade) + ' t-' + esc(it.tipo) +
        (temBadge ? ' com-badge' : '') + (it.dispensavel ? ' com-x' : '') +
        '" data-id="' + esc(it.id) + '">' +
      '<span class="al-ic">' + icone(it.icone) + '</span>' +
      '<div class="al-body">' +
        '<h3>' + esc(it.titulo) + '</h3>' +
        (it.texto ? '<p>' + esc(it.texto) + '</p>' : '') +
      '</div>' +
      badge +
      '<div class="al-meta"><span class="al-chip">' + chip + '</span>' +
        (w ? '<span class="al-when">' + esc(w) + '</span>' : '') + '</div>' +
      '<a class="al-cta" href="' + esc(it.href) + '">' + esc(it.cta) +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></a>' +
      x +
    '</article>';
  }

  function pintar(r) {
    var itens = (r && r.itens) || [];

    // 2º portão: item de ÁREA que aponta para página que esta pessoa não
    // abre não é desenhado (o backend já filtrou; aqui é cinto e suspensório).
    if (typeof window.bmHrefPermitido === 'function') {
      itens = itens.filter(function (it) {
        return it.gate === 'papel' || window.bmHrefPermitido(it.href, false);
      });
    }
    itens = itens.filter(function (it) { return !dispensado(it); });

    if (!itens.length) { vazio(); marcarExtras(); sinalizar(0); sec.hidden = false; avisarPintura(itens); return; }

    grid.innerHTML = itens.map(cartao).join('');
    marcarExtras();
    if (cont) {
      var acoes = itens.filter(function (i) { return i.tipo === 'aprovacao'; }).length;
      cont.textContent = acoes
        ? acoes + (acoes === 1 ? ' aprovação' : ' aprovações') + (itens.length > acoes ? ' · ' + itens.length + ' no total' : '')
        : itens.length + (itens.length === 1 ? ' item' : ' itens');
    }
    sinalizar(itens.filter(function (i) { return i.tipo === 'aprovacao' || i.prioridade === 'alta'; }).length);
    sec.hidden = false;
    avisarPintura(itens);

    // dispensar (delegado — os cartões são redesenhados a cada leitura)
    Array.prototype.forEach.call(grid.querySelectorAll('.al-x'), function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var card = b.closest('.al-card');
        var id = card && card.getAttribute('data-id');
        var it = itens.filter(function (x) { return x.id === id; })[0];
        if (it) marcarOff(it);
        if (card) {
          card.classList.add('al-saindo');
          setTimeout(function () {
            card.remove();
            if (!grid.querySelector('.al-card')) { vazio(); sinalizar(0); }
            marcarExtras();   // dispensar um cartão pode aposentar o "Ver todos"
          }, 180);
        }
      });
    });
  }

  // ── teto de cartões à vista ("Ver todos") ─────────────────────
  // Roda no render E na troca de faixa (girar o celular, redimensionar):
  // o teto do mobile é menor, e sem reavaliar a pessoa ficava com 6 cartões
  // empilhados ou com o botão prometendo o que já estava à mostra.
  function marcarExtras() {
    var cards = grid.querySelectorAll('.al-card:not(.al-vazio)');
    if (!cards.length) { if (tg) tg.hidden = true; return; }
    var mobile = !!(window.matchMedia && window.matchMedia(MQ_MOBILE).matches);
    var teto = mobile ? TETO.mobile : TETO.desktop;
    Array.prototype.forEach.call(cards, function (c, i) {
      c.classList.toggle('al-extra', i >= teto);
    });
    if (!tg) return;
    var sobra = cards.length - teto;
    tg.hidden = sobra <= 0;
    if (sobra > 0) {
      // o botão fecha a caixa: no desktop ele diz o que FALTA ver, no
      // celular (onde só cabem 3) diz o total — é a pergunta que se faz
      // ao chegar no fim da lista
      tg.textContent = document.body.classList.contains('al-aberto') ? 'Ver menos'
        : mobile ? 'Ver os ' + cards.length + ' alertas →'
        : sobra === 1 ? 'Mostrar mais 1 alerta'
        : 'Mostrar os outros ' + sobra + ' alertas';
    } else {
      document.body.classList.remove('al-aberto');
    }
  }

  // sino do cabeçalho
  function sinalizar(n) {
    if (!bell) return;
    bell.classList.toggle('tem', n > 0);
    if (bellDot) {
      bellDot.textContent = n > 9 ? '9+' : String(n || '');
      bellDot.hidden = !n;
    }
    bell.title = n ? n + (n === 1 ? ' alerta esperando você' : ' alertas esperando você') : 'Nenhum alerta';
  }

  // ── leitura ────────────────────────────────────────────────────
  var lendo = false;
  function carregar(forcar) {
    if (lendo) return;
    var c = forcar ? null : lerCache();
    if (c) { pintar(c); return; }
    lendo = true;
    if (!grid.querySelector('.al-card')) esqueleto();
    fetch(API, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        lendo = false;
        if (!j || !j.ok) { silenciar(); return; }
        gravarCache(j);
        pintar(j);
      })
      .catch(function () { lendo = false; silenciar(); });
  }

  // Sem resposta boa (401, API fora, deploy antigo): a faixa some. Alerta
  // que não pode ser confirmado não vira "não há nada" — vira nada.
  function silenciar() {
    if (grid) grid.innerHTML = '';
    if (sec) sec.hidden = true;
    sinalizar(0);
    avisarPintura(null);
  }

  // Layout v3: o "Resumo de hoje" do hero e o filtro por área (home-v3.js)
  // leem os MESMOS itens que esta faixa desenhou — já filtrados pelo acesso
  // e pelo que a pessoa dispensou. `null` = não deu para confirmar ("—").
  function avisarPintura(itens) {
    var d = itens ? {
      total: itens.length,
      aprovacoes: itens.filter(function (i) { return i.tipo === 'aprovacao'; }).length,
      itens: itens.map(function (i) { return { areaRotulo: i.areaRotulo, prioridade: i.prioridade, tipo: i.tipo }; })
    } : null;
    try { document.dispatchEvent(new CustomEvent('alertas:pintado', { detail: d })); } catch (e) {}
  }

  function init() {
    sec = document.getElementById('alertas');
    grid = document.getElementById('al-grid');
    if (!sec || !grid) return;                 // não é a home
    cont = document.getElementById('al-count');
    bell = document.getElementById('hv-bell');
    bellDot = document.getElementById('hv-bell-dot');

    tg = document.getElementById('al-toggle');

    var btn = document.getElementById('al-refresh');
    if (btn) btn.addEventListener('click', function () { carregar(true); });
    if (tg) tg.addEventListener('click', function () {
      document.body.classList.toggle('al-aberto');
      marcarExtras();
    });
    if (window.matchMedia) {
      var mq = window.matchMedia(MQ_MOBILE);
      if (mq.addEventListener) mq.addEventListener('change', marcarExtras);
      else if (mq.addListener) mq.addListener(marcarExtras);
    }
    if (bell) bell.addEventListener('click', function () {
      if (sec.hidden) { carregar(true); return; }
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // o acesso decidido é o gatilho: aí a identidade existe e o
    // bmHrefPermitido já sabe responder
    document.addEventListener('areaaccess:ready', function () { carregar(false); });
    if (typeof window._allowedAreas !== 'undefined') carregar(false);
    else setTimeout(function () { if (!grid.innerHTML) carregar(false); }, 6000);  // rede de segurança

    // volta para a aba / passou o tempo → relê (é assim que "aprovaram o
    // seu pedido" chega em quem deixou a home aberta)
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && !lerCache()) carregar(false);
    });
    setInterval(function () {
      if (document.visibilityState === 'visible') carregar(true);
    }, RECARGA);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
