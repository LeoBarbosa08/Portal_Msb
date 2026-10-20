/* ================================================================
   dw-pill.js — pill "DW atualizado · dd/mm, hh:mm" no cabeçalho
   ----------------------------------------------------------------
   Mesmo indicador que a área Comercial usa (pages/comercial-funil.html),
   aqui num arquivo só para não repetir CSS + markup + query em cada página.

   Como usar numa página:
     1) carregar este arquivo:  <script src="../dw-pill.js?v=4"></script>
     2) entregar token+workspace+dataset em `window.bmDwInfo()` e, quando o
        código da página vive dentro de um IIFE, a consulta DAX em
        `window.bmDwQuery` (fora de IIFE ele acha `window.pbiQuery` sozinho).

   DOIS MARKUPS convivem no portal e os dois são atendidos:
     a) a página JÁ TEM a pill com um vão p/ a data — <span id="lr-dw">—</span>,
        <span id="sr-dw-update">—</span> ou qualquer [data-dw-valor]: aqui só se
        escreve a data no vão (o "DW atualizado ·" é markup da página);
     b) a página não tem nada: a pill é criada e pendurada no .fx-head-right.

   De onde vem a data, na ordem:
     1) REFRESH DO DATASET na API do Power BI (/datasets/{id}/refreshes) — é a
        resposta certa p/ "quando o BI atualizou". Precisa de token+workspace+
        dataset, que a página expõe em `window.bmDwInfo()`; o escopo já usado
        pelas páginas (Dataset.Read.All) cobre esse endpoint.
     2) reserva: uma COLUNA DE CARGA do modelo. Candidatas: as bem pontuadas no
        catálogo (INFO.VIEW.COLUMNS) mais as duas conhecidas do portal
        ('Atualizações DW'[Última atualização] e 'FAT_CARGAS'[DATA_HORA_FIN]).
        Cada uma é testada com MAX() até uma devolver data — é por isso que este
        arquivo não precisa saber o nome da tabela de carga de cada modelo.
   Nada respondeu = a pill criada aqui não aparece e o vão da página fica como
   estava. É indicador: não pode quebrar a página nem virar rajada de consultas
   (429). Daí a diferença entre ESPERAR (o login do Power BI ainda não passou:
   fica em silêncio, sem gastar consulta) e TENTAR (no máximo 5 vezes, com
   espera crescente, e para logo se o modelo respondeu que não tem a data).
   ================================================================ */
(function () {
  'use strict';
  if (window.__bmDwPill) return;            // uma vez por página
  window.__bmDwPill = 1;

  var CSS = '.fx-dw{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;'
    + 'background:#EAF8F0;border:1px solid #CFEEDD;font-size:11.5px;font-weight:700;color:#22794C;white-space:nowrap;}'
    + '.fx-dw[hidden]{display:none;}'   /* sem isto o display:inline-flex vence o [hidden] e a pill aparece sem data */
    + '.fx-dw i{width:7px;height:7px;border-radius:999px;background:#2FBF71;display:inline-block;}'
    + '@media(max-width:767.98px){.fx-dw{order:-1;margin-left:auto;}}';

  // Onde escrever a data. Quando a página já traz a pill, NÃO se cria outra nem
  // se injeta CSS — o visual continua sendo o da própria página.
  var _alvo = null;
  function alvo() {
    if (_alvo && _alvo.txt && document.body.contains(_alvo.txt)) return _alvo;
    var vao = document.querySelector('[data-dw-valor]')
           || document.getElementById('lr-dw')
           || document.getElementById('sr-dw-update');
    if (vao) return (_alvo = { txt: vao, pill: vao.closest('.fx-dw'), proprio: false });

    var host = document.querySelector('.fx-head-right');
    if (!host) return null;
    var pill = document.getElementById('fx-dw');
    if (!pill) {
      var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
      pill = document.createElement('span');
      pill.className = 'fx-dw'; pill.id = 'fx-dw'; pill.hidden = true;
      pill.innerHTML = '<i></i><span id="fx-dw-txt">DW atualizado</span>';
      host.insertBefore(pill, host.firstChild);   // antes das abas
    }
    return (_alvo = { txt: document.getElementById('fx-dw-txt'), pill: pill, proprio: true });
  }

  // aceita '2026-08-20T14:32:00', '20/08/2026 14:32' e o que o Date() entender
  function parseDW(raw) {
    if (raw == null || raw === '') return null;
    if (raw instanceof Date) return isNaN(raw) ? null : raw;
    var s = String(raw).trim(), m;
    // com fuso explícito (o 'Z' da API de refresh) deixa o Date converter p/ local —
    // montar na mão a partir das partes daria a hora UTC e erraria em 3h no Brasil
    if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) { var du = new Date(s); if (!isNaN(du)) return du; }
    m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
    var d = new Date(s); return isNaN(d) ? null : d;
  }

  var COMBINANTES = new RegExp('[\\u0300-\\u036f]', 'g');
  var norm = function (x) {
    return String(x == null ? '' : x).normalize('NFD').replace(COMBINANTES, '').toLowerCase();
  };
  var val = function (row, re) { var k = Object.keys(row).find(function (x) { return re.test(x); }); return k ? row[k] : null; };

  // pontua candidatos: quanto maior, mais parece "fim da última carga do DW"
  function pontuar(tabela, coluna) {
    var t = norm(tabela), c = norm(coluna), p = 0;
    if (/carga/.test(t)) p += 6;
    if (/atualiza|refresh|etl|processa/.test(t)) p += 4;
    if (/data.?hora.?fin/.test(c)) p += 8;
    if (/(^|[^a-z])fim([^a-z]|$)|final|fin\b/.test(c)) p += 3;
    if (/data|hora|date|time/.test(c)) p += 2;
    if (/ultima.*atualiza|atualiza.*ultima|last.?refresh/.test(c)) p += 7;
    if (/inicio|ini\b|start/.test(c)) p -= 4;                     // início de carga não serve
    return p;
  }

  // as duas colunas de carga já conhecidas no portal (modelo do Comercial) —
  // entram no fim da fila p/ cobrir modelo cujo catálogo não pontuou nada
  var CONHECIDAS = ["'Atualizações DW'[Última atualização]", "'FAT_CARGAS'[DATA_HORA_FIN]"];

  // devolve { fila, respondeu } — respondeu diz se o catálogo foi lido de fato
  // (importante p/ separar "modelo sem coluna de carga" de "login ainda não passou")
  async function acharCampos(q) {
    var rows = null, respondeu = false;
    try { rows = await q('EVALUATE SELECTCOLUMNS(INFO.VIEW.COLUMNS(), "T",[Table], "N",[Name])'); respondeu = true; }
    catch (e) { rows = null; }
    var lista = [];
    (rows || []).forEach(function (r) {
      var t = val(r, /\[T\]$/), c = val(r, /\[N\]$/);
      if (t == null || c == null) return;
      lista.push({ ref: "'" + t + "'[" + c + "]", p: pontuar(t, c) });
    });
    lista.sort(function (a, b) { return b.p - a.p; });
    var fila = lista.filter(function (x) { return x.p >= 8; }).slice(0, 3).map(function (x) { return x.ref; });
    // nada convincente no catálogo: mostra os melhores palpites p/ alguém apontar o campo
    if (!fila.length && lista.length) {
      console.warn('[DW] nenhuma coluna de carga clara neste modelo. Melhores candidatos:',
        lista.slice(0, 10).map(function (x) { return x.ref + ' (' + x.p + ')'; }).join(' | '));
    }
    CONHECIDAS.forEach(function (ref) { if (fila.indexOf(ref) < 0) fila.push(ref); });
    return { fila: fila, respondeu: respondeu };
  }

  // ── 1ª fonte: histórico de refresh do dataset (API do Power BI) ──
  //   Pega o refresh CONCLUÍDO mais recente (o topo da lista pode estar em andamento).
  //   Devolve { quando, tipo } ou { respondeu } — quem chama precisa saber se a
  //   API foi ouvida (403 é resposta: essa fonte não serve neste dataset).
  async function refreshDoDataset() {
    var f = window.bmDwInfo; if (typeof f !== 'function') return { respondeu: false };
    var i; try { i = f(); } catch (e) { return { respondeu: false }; }
    if (!i || !i.token || !i.ws || !i.ds) return { respondeu: false };
    var r;
    try {
      r = await fetch('https://api.powerbi.com/v1.0/myorg/groups/' + i.ws + '/datasets/' + i.ds + '/refreshes?$top=5',
        { headers: { Authorization: 'Bearer ' + i.token } });
    } catch (e) { return { respondeu: false }; }
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) console.warn('[DW] sem permissão p/ ler o histórico de refresh (HTTP ' + r.status + ') — usando a coluna de carga do modelo');
      return { respondeu: r.status !== 401 };      // 401 = token vencido: vale insistir
    }
    var j; try { j = await r.json(); } catch (e) { return { respondeu: true }; }
    var itens = (j && j.value) || [];
    for (var k = 0; k < itens.length; k++) {
      var it = itens[k];
      if (it && it.status === 'Completed' && (it.endTime || it.startTime))
        return { quando: it.endTime || it.startTime, tipo: it.refreshType || '', respondeu: true };
    }
    return { respondeu: true };
  }

  var _campos = null;   // guarda os campos achados, p/ não varrer o catálogo em cada tentativa
  // 'ok' = preencheu · 'nada' = a API respondeu e não tem data · 'espera' = ninguém respondeu ainda
  async function rodar(q) {
    var a = alvo(); if (!a || !a.txt) return 'espera';
    var dt = null, titulo = '', respondeu = false;

    // 1) refresh do dataset
    var ref = await refreshDoDataset();
    if (ref.respondeu) respondeu = true;
    if (ref.quando) {
      dt = parseDW(ref.quando);
      if (dt) titulo = 'Último refresh do modelo no Power BI'
        + (ref.tipo ? ' (' + ref.tipo + ')' : '') + ' · concluído em '
        + dt.toLocaleString('pt-BR');
    }

    // 2) reserva: coluna de carga do próprio modelo (uma candidata por vez)
    if (!dt && typeof q === 'function') {
      if (!_campos) {
        var achado = await acharCampos(q);
        _campos = achado.fila;
        if (achado.respondeu) respondeu = true;
      }
      for (var k = 0; _campos && k < _campos.length && !dt; k++) {
        var rows = null;
        try { rows = await q('EVALUATE ROW("u", MAX(' + _campos[k] + '))'); respondeu = true; }
        catch (e) { continue; }                                  // campo não existe neste modelo
        dt = parseDW(rows && rows[0] ? Object.values(rows[0])[0] : null);
        if (dt) titulo = 'Última carga do Data Warehouse · ' + _campos[k];
      }
    }
    if (!dt) return respondeu ? 'nada' : 'espera';

    var quando = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ', '
      + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    a.txt.textContent = a.proprio ? ('DW atualizado · ' + quando) : quando;
    if (a.pill) { a.pill.hidden = false; a.pill.title = titulo; }
    window.bmDwUltima = dt;                  // p/ conferir no console
    return 'ok';
  }

  // A função de consulta existe desde o parse, mas só RESPONDE depois do login do
  // Power BI: enquanto não há token exposto, aqui só se espera (sem consulta).
  var ESPERAS = [3000, 5000, 10000, 25000, 60000];   // espera antes de cada tentativa
  var MAX_TENTATIVAS = 5, MAX_TICKS = 40;
  function esperar() {
    alvo();
    var ticks = 0, tentativas = 0, vazias = 0;
    (function tick() {
      setTimeout(async function () {
        ticks++;
        var q = window.bmDwQuery || window.pbiQuery;
        var info = null;
        try { info = (typeof window.bmDwInfo === 'function') ? window.bmDwInfo() : null; } catch (e) {}
        // sem token exposto e sem consulta: nem tenta (o login do Power BI ainda não passou)
        var pronto = (info && info.token) || (typeof window.bmDwInfo !== 'function' && typeof q === 'function');
        if (!pronto) { if (ticks <= MAX_TICKS) tick(); return; }
        tentativas++;
        var st = 'espera';
        try { st = await rodar(typeof q === 'function' ? q : null); } catch (e) {}
        if (st === 'ok') return;
        if (st === 'nada' && ++vazias >= 2) { console.warn('[DW] não achei a data de atualização deste modelo (nem refresh do dataset, nem coluna de carga).'); return; }
        if (tentativas >= MAX_TENTATIVAS || ticks > MAX_TICKS) return;
        tick();
      }, ESPERAS[Math.min(tentativas, ESPERAS.length - 1)]);
    })();
  }
  window.bmDwAgora = function () { return rodar(window.bmDwQuery || window.pbiQuery); };  // console
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', esperar);
  else esperar();
})();
