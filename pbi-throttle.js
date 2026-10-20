/* ================================================================
   pbi-throttle.js — Portal Biomedical
   Freio ÚNICO de consultas ao Power BI, para TODAS as páginas de BI.

   O PROBLEMA
   O executeQueries do Power BI permite 120 consultas por MINUTO por
   USUÁRIO — contando todos os datasets e todas as abas abertas
   (docs: "There's a limit of 120 query requests per minute per user,
   regardless of the dataset that's queried"). Cada aplicação de filtro
   nas nossas páginas dispara de 6 a 18 consultas em paralelo, e o
   <input type="date"> emite 'change' a cada pedaço digitado. Filtrando
   num ritmo NORMAL a pessoa estoura o teto em segundos e o serviço
   devolve HTTP 429 — que nas páginas aparece como "erro/retry" ou,
   pior, como "sem dados".
   Datasets com RLS sofrem mais: a consulta é avaliada por identidade
   (não reaproveita o cache do serviço) e Service Principal não é
   permitido em modelo com RLS, então TODA a carga vai no token da
   própria pessoa — o mesmo balde de 120/min.

   O QUE ESTE ARQUIVO FAZ (sem tocar na lógica das páginas)
   Ele embrulha o window.fetch e trata só os POST de executeQueries e
   /api/pbi-query:
     1. CACHE por DAX (3 min, por identidade) — voltar a um filtro já
        visto é instantâneo e custa ZERO requisição;
     2. JUNTA consultas idênticas em voo numa só requisição;
     3. FILA com concorrência limitada + teto de 100/min compartilhado
        entre as abas (localStorage) — a requisição espera em vez de
        tomar 429;
     4. DESCARTA rajada superada: se a pessoa mexe no filtro de novo, as
        consultas da rajada anterior que ainda estão na fila (mesma
        FORMA de DAX, geração mais velha) são abandonadas — só o último
        estado vai à rede;
     5. 429 deixa de ser erro: lê o Retry-After, mostra faixa com
        contagem regressiva, espera e repete sozinho (até 4 tentativas).
        O freio é compartilhado entre abas e sobrevive ao F5.
     6. MEMÓRIA DE OLS (PBIQ.ols) — ver o bloco "OLS" mais abaixo: medida
        que já se sabe bloqueada para o usuário sai do bundle, e o bundle
        volta a ser 1 consulta em vez de 1 + uma por medida.
     7. TRAVA DE ACESSO (PBIQ.trava) — ver o bloco "TRAVA" mais abaixo: quem
        não está em nenhum grupo de segurança (RLS) do modelo ou não tem
        Build não vê NADA da tela de BI, só o aviso com o motivo.
     8. RECORTE MSB (PBIQ.recorte) — ver o bloco "RECORTE MSB" mais abaixo:
        TODA consulta sai filtrada na empresa MSB, em qualquer tela.

   F12:  PBIQ.stats()   → fila, cache, descartadas, 429, OLS, trava
         PBIQ.trava()   → estado da trava de acesso
         PBIQ.recorte() → coluna e filtro de empresa de cada modelo
         PBIQ.limpar()  → esvazia o cache e a memória de OLS (força dados novos)
         PBIQ.solta()   → libera o freio de 429 na mão
   ================================================================ */
(function () {
  'use strict';
  if (window.PBIQ) return;                       // já instalado nesta página
  if (typeof window.fetch !== 'function') return;

  var CFG = {
    conc:     6,          // consultas simultâneas
    perMin:   100,        // teto por minuto (o do Power BI é 120/usuário)
    ttl:      180000,     // validade do cache (3 min)
    maxBytes: 24 * 1024 * 1024,
    tent:     6,          // tentativas quando toma 429
    espMin:   4,          // espera mínima do 429 (s)
    espMax:   65,         // espera máxima do 429 (s)
    olsTtl:   1800000,    // memória de medida bloqueada por OLS (30 min)
    trava:    true,       // fecha a tela de BI de quem não tem acesso ao modelo
    travaEsp: 2500        // espera a página terminar de tentar antes de fechar (ms)
  };
  try { if (window.__PBIQ_CFG) for (var k in window.__PBIQ_CFG) CFG[k] = window.__PBIQ_CFG[k]; } catch (e) {}
  // tela que não é de BI (agente, cotação, PI, comissão…) sai da trava no
  // próprio <script>: <script src="../pbi-throttle.js?v=3" data-bi-trava="off">
  try {
    var _cs = document.currentScript;
    if (_cs && _cs.getAttribute && _cs.getAttribute('data-bi-trava') === 'off') CFG.trava = false;
  } catch (e) {}

  var _fetch  = window.fetch.bind(window);
  var K_HITS  = 'pbiq.hits', K_COOL = 'pbiq.cool', K_OLS = 'pbiq.ols', K_QUEM = 'pbiq.quem';
  var _fila   = [], _ativas = 0, _timer = null, _gen = 0, _segurando = false, _rodando = new Set();
  // Concorrência ADAPTATIVA: depois de um 429 volta a 1 e sobe de novo a cada
  // sucesso. Sem isso, no fim de cada espera o freio soltava as 6 de uma vez
  // e as 6 tomavam 429 outra vez — a punição se renovava sozinha.
  var _conc   = CFG.conc;
  var _cache  = new Map(), _bytes = 0, _voo = new Map(), _ids = new Map(), _idAtual = null, _emAtual = '';
  var _st     = { pedidos: 0, rede: 0, cache: 0, juntadas: 0, descartadas: 0, r429: 0, ols: 0 };

  // ── ritmo compartilhado entre as abas ──────────────────────────
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function hits() {
    var a; try { a = JSON.parse(lsGet(K_HITS, '[]')); } catch (e) { a = null; }
    if (!a || typeof a.length !== 'number') a = [];
    var lim = Date.now() - 60000, out = [];
    for (var i = 0; i < a.length; i++) if (a[i] > lim) out.push(a[i]);
    return out;
  }
  function baterPonto() {
    var a = hits(); a.push(Date.now());
    if (a.length > 300) a = a.slice(-300);
    lsSet(K_HITS, JSON.stringify(a));
  }
  function freio() { return Number(lsGet(K_COOL, 0)) || 0; }
  function porFreio(seg) {
    seg = Math.max(CFG.espMin, Math.min(CFG.espMax, Number(seg) || 20));
    var ate = Date.now() + seg * 1000;
    if (ate > freio()) lsSet(K_COOL, String(ate));
    pintar();
  }
  function segDoTexto(txt) {
    var m = /retry in (\d+)/i.exec(String(txt || ''));
    return m ? Number(m[1]) : 20;
  }

  // ── faixa de aviso ─────────────────────────────────────────────
  var _bar = null, _barT = null;
  function faixa(html) {
    if (!html) { if (_bar) _bar.style.display = 'none'; return; }
    if (!_bar) {
      _bar = document.createElement('div');
      _bar.id = 'pbiq-faixa';
      _bar.setAttribute('role', 'status');
      _bar.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:9600;' +
        'pointer-events:none;max-width:92vw;padding:8px 16px;border-radius:999px;background:#FEF3C7;' +
        'border:1px solid #FDE68A;color:#92400E;text-align:center;box-shadow:0 6px 20px rgba(0,0,0,.14);' +
        'font:600 13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
      (document.body || document.documentElement).appendChild(_bar);
    }
    _bar.innerHTML = html;
    _bar.style.display = 'block';
  }
  function pintar() {
    if (_barT) { clearTimeout(_barT); _barT = null; }
    if (_tv && _tv.fechada) { faixa(''); return; }  // tela trancada: a faixa da fila não diz nada
    var falta = Math.ceil((freio() - Date.now()) / 1000);
    if (falta > 0) {
      faixa('<b>O Power BI limitou o ritmo das consultas.</b> Retomando em ' + falta +
            's — os números voltam sozinhos, não precisa mexer no filtro.');
      _barT = setTimeout(pintar, 1000);
      return;
    }
    if (_segurando && _fila.length) {
      faixa('Muitas consultas de uma vez — <b>' + _fila.length + '</b> na fila para não estourar o limite do Power BI.');
      _barT = setTimeout(pintar, 1000);
      return;
    }
    faixa(_rcAviso);   // sem fila: só o aviso do recorte MSB, quando houver
  }

  // ── identidade (o cache NÃO pode cruzar usuário: tem RLS) ──────
  function authDe(init) {
    try {
      var h = init && init.headers;
      if (h) return (typeof h.get === 'function') ? (h.get('Authorization') || h.get('authorization'))
                                                  : (h.Authorization || h.authorization);
    } catch (e) {}
    return null;
  }
  function claimsDe(a) {
    var p = String(a).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    while (p.length % 4) p += '=';
    return JSON.parse(atob(p));
  }
  function idDe(init) {
    var a = authDe(init);
    if (!a) { var pu = window._portalUser; return 'sp:' + ((pu && pu.email) || 'anon'); }
    if (_ids.has(a)) return _ids.get(a);
    var id = 'tok';
    try {
      var j = claimsDe(a);
      id = j.oid || j.sub || j.upn || j.unique_name || 'tok';
    } catch (e) {}
    if (_ids.size > 8) _ids.clear();
    _ids.set(a, id);
    return id;
  }

  // DAX do corpo (executeQueries usa queries[0].query; /api/pbi-query usa dax)
  function daxDe(body) {
    try {
      var o = JSON.parse(body);
      if (o && o.queries && o.queries[0] && o.queries[0].query) return String(o.queries[0].query);
      if (o && o.dax) return String(o.dax);
    } catch (e) {}
    return '';
  }
  // FORMA = DAX sem os literais. Duas consultas da MESMA forma são o mesmo
  // visual com filtro diferente — é o que permite descartar a rajada velha.
  function forma(dax) {
    return String(dax).replace(/"[^"]*"/g, '"@"').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  }

  // ── cache ──────────────────────────────────────────────────────
  function guardar(key, o) {
    var velho = _cache.get(key);
    if (velho) { _bytes -= velho.len; _cache.delete(key); }
    var len = o.text.length;
    _cache.set(key, { t: Date.now(), status: 200, statusText: o.statusText, text: o.text, ctype: o.ctype, len: len });
    _bytes += len;
    while (_bytes > CFG.maxBytes && _cache.size > 1) {
      var k1 = _cache.keys().next().value, v1 = _cache.get(k1);
      _cache.delete(k1); _bytes -= (v1 ? v1.len : 0);
    }
  }
  function resposta(o) {
    var h = { 'Content-Type': o.ctype || 'application/json' };
    if (o.retry) h['Retry-After'] = String(o.retry);
    var vazio = (o.status === 204 || o.status === 205 || o.status === 304);
    return new Response(vazio ? null : o.text, { status: o.status, statusText: o.statusText || '', headers: h });
  }

  // ── fila ───────────────────────────────────────────────────────
  function enfileirar(t) {
    for (var i = 0; i < _fila.length; i++) {
      var q = _fila[i];
      if (!q.morta && !q.fixa && q.gen < t.gen && q.key !== t.key && q.forma === t.forma) {
        q.morta = true; _st.descartadas++; _voo['delete'](q.key);
        // de propósito: a promessa da rajada superada NÃO resolve — a página
        // não repinta um estado que a pessoa já trocou (é o mesmo efeito do
        // "seq !== _seq" das páginas que já tratavam isso na mão).
      }
    }
    _fila.push(t);
    bombear();
  }
  function proxima() {
    while (_fila.length) { var t = _fila.shift(); if (!t.morta) return t; }
    return null;
  }
  function agendar(ms) {
    if (_timer) return;
    _timer = setTimeout(function () { _timer = null; bombear(); }, ms);
  }
  function bombear() {
    while (_ativas < _conc && _fila.length) {
      var agora = Date.now(), f = freio();
      if (f > agora) { agendar(Math.min(1000, f - agora + 60)); pintar(); return; }
      var h = hits();
      if (h.length >= CFG.perMin) {
        _segurando = true; pintar();
        agendar(Math.max(250, 60000 - (agora - h[0]) + 60));
        return;
      }
      var t = proxima();
      if (!t) break;
      _segurando = false;
      _ativas++; baterPonto(); rodar(t);
    }
    pintar();
  }
  function liberar() { _ativas = Math.max(0, _ativas - 1); bombear(); }

  function rodar(t) {
    _st.rede++;
    _rodando.add(t);
    _fetch(t.url, t.init).then(function (r) {
      var ra = (r.headers && r.headers.get) ? r.headers.get('Retry-After') : null;
      var ct = (r.headers && r.headers.get) ? r.headers.get('Content-Type') : null;
      return r.text().then(function (txt) {
        return { status: r.status, statusText: r.statusText, text: txt, ctype: ct, retry: ra };
      });
    }).then(function (o) {
      _rodando['delete'](t);
      if (o.status === 429) {
        _st.r429++; _conc = 1;
        porFreio(Number(o.retry) || segDoTexto(o.text));
        if (t.tent < CFG.tent) { t.tent++; _fila.unshift(t); liberar(); return; }
      } else if (o.status === 200 && _conc < CFG.conc) {
        _conc++;                                  // passou: solta mais uma vaga
      }
      // não cacheia resposta com erro do modelo (medida inexistente, OLS etc.)
      if (o.status === 200 && t.cacheavel && o.text.indexOf('"error"') < 0) guardar(t.key, o);
      observar(t, o);
      t.ok(o); liberar();
    })['catch'](function (e) { _rodando['delete'](t); t.erro(e); liberar(); });
  }

  // ── OLS: memória de medida bloqueada ───────────────────────────
  // Quem não tem direito a uma medida (OLS — p.ex. o operador sem margem) não
  // recebe a medida em branco: o Power BI devolve HTTP 400 na consulta
  // INTEIRA. As páginas então refazem medida a medida (olsBundle e afins) e 1
  // consulta vira 1 + N. Sem memória isso se repetia em TODO clique: na
  // Análise de Vendas o operador gastava 25 consultas por filtro contra 8 de
  // quem vê tudo, e com 4 cliques no minuto batia o teto de 100/min — a faixa
  // "Muitas consultas de uma vez" que só ele via.
  // Aqui fica o que JÁ se sabe bloqueado, por usuário e por página, por
  // CFG.olsTtl e compartilhado entre as abas. A página tira essas medidas do
  // bundle antes de mandar, e o bundle volta a passar de primeira.
  //   PBIQ.ols.vivas(lista[, txt])  → a lista sem as já bloqueadas; txt(item)
  //                                   devolve o texto da medida (padrão: o item)
  //   PBIQ.ols.aprender(falhas, ok) → fim da rodada medida a medida: falhas =
  //                                   [[medida, erro], ...]; ok = alguma passou
  //   PBIQ.ols.leque(erro)          → false quando abrir medida a medida só
  //                                   multiplicaria requisições (429, rede)
  // Só vira "bloqueada" a medida que caiu enquanto OUTRA da mesma rodada passou
  // (o erro é dela, não do filtro) e com erro do MODELO: 429, 5xx, rede, tempo
  // e tamanho são de momento e não entram na memória.
  var RX_MOMENTO = /\b429\b|HTTP 5\d\d|failed to fetch|networkerror|load failed|abort|time ?out|too (?:many|large|big)|exceed|excede|result ?set|memory|mem[óo]ria/i;
  function emailPortal() { var pu = window._portalUser; return String((pu && pu.email) || '').toLowerCase(); }
  // A página pede a lista ANTES da 1ª consulta (o token ainda não passou por
  // aqui): vale a última identidade vista neste navegador, desde que seja a
  // MESMA pessoa logada no portal — senão o F5 reaprendia tudo e só a troca de
  // aba do Sales Report já gastava o minuto inteiro.
  function quem() {
    if (_idAtual) return _idAtual;
    var u, em = emailPortal();
    try { u = JSON.parse(lsGet(K_QUEM, 'null')); } catch (e) { u = null; }
    if (u && u.id && (!em || u.em === em)) return u.id;
    return 'sp:' + (em || 'anon');
  }
  function olsEscopo() { return quem() + '|' + ((window.location && window.location.pathname) || ''); }
  function olsLer() {
    var o; try { o = JSON.parse(lsGet(K_OLS, '{}')); } catch (e) { o = null; }
    return (o && typeof o === 'object') ? o : {};
  }
  function olsMapa() {                            // { medida: quando } do escopo, só o que vale
    var m = olsLer()[olsEscopo()] || {}, lim = Date.now() - CFG.olsTtl, out = {};
    for (var k in m) if (m[k] > lim) out[k] = m[k];
    return out;
  }
  // a medida pela FORMA: medida montada com o filtro dentro (CALCULATE(...,
  // ano = 2026)) continua sendo a mesma quando o filtro muda. Diferente da
  // forma() da fila, o número DENTRO de [Medida] e 'Tabela' fica: [Meta 2025]
  // e [Meta 2026] são objetos diferentes para o OLS.
  function olsNorm(s) {
    return String(s == null ? '' : s).replace(/"[^"]*"/g, '"@"').split(/(\[[^\]]*\]|'[^']*')/)
      .map(function (p, i) { return i % 2 ? p : p.replace(/\d+/g, '#'); }).join('').replace(/\s+/g, ' ').trim();
  }
  function olsMsg(e) { return String((e && (e.message || e)) || ''); }
  var OLS = {
    vivas: function (lista, txt) {
      if (!lista || !lista.length) return lista || [];
      var m = olsMapa(), out = [];
      for (var i = 0; i < lista.length; i++) if (!m[olsNorm(txt ? txt(lista[i]) : lista[i])]) out.push(lista[i]);
      return out;
    },
    aprender: function (falhas, ok) {
      if (!ok || !falhas || !falhas.length) return;
      var novas = [];
      for (var i = 0; i < falhas.length; i++) {
        var f = falhas[i];
        if (!f || RX_MOMENTO.test(olsMsg(f[1]))) continue;
        var t = olsNorm(f[0]); if (t) novas.push(t);
      }
      if (!novas.length) return;
      var tudo = olsLer(), agora = Date.now(), lim = agora - CFG.olsTtl;
      for (var e in tudo) {                       // poda o que venceu, de todos os escopos
        var mm = tudo[e], vivo = false;
        for (var k in mm) { if (mm[k] > lim) vivo = true; else delete mm[k]; }
        if (!vivo) delete tudo[e];
      }
      var meu = tudo[olsEscopo()] || (tudo[olsEscopo()] = {});
      for (var j = 0; j < novas.length; j++) meu[novas[j]] = agora;
      lsSet(K_OLS, JSON.stringify(tudo));
      _st.ols += novas.length;
      try { console.info('[PBIQ] OLS: ' + novas.length + ' medida(s) bloqueada(s) para este usuário — fora do bundle por ' +
                         Math.round(CFG.olsTtl / 60000) + ' min:', novas); } catch (e2) {}
    },
    leque: function (e) { return !/\b429\b|failed to fetch|networkerror|load failed/i.test(olsMsg(e)); },
    lista: function () { return Object.keys(olsMapa()); }
  };

  // ── TRAVA: sem grupo de segurança ou sem Build, a tela de BI fecha ──
  // 19/10/2026, pedido do dono do portal: "se a pessoa não tá em nenhum
  // grupo de segurança ou não tem Build, ela não consegue visualizar nada".
  // O Power BI já recusa os dados nesses dois casos, mas a tela abria assim
  // mesmo: layout, "—", zeros e às vezes o banner "Conectado". Agora o
  // conteúdo da .area-main some e fica só o aviso com o motivo.
  // Fechar a tela de quem TEM acesso é o erro caro, então só fecha com prova:
  //   1. a falha tem cara de acesso negado (401/403, ou permissão/RLS na
  //      mensagem). Erro de DAX, OLS, 404, 429, 5xx, capacidade, token
  //      vencido e rede não contam;
  //   2. a SONDA confirma: EVALUATE ROW("n", 1) com o MESMO token, na URL
  //      direta e na do workspace. Se uma passar, era porta errada ou token
  //      velho, coisa que a página resolve sozinha. A exceção é a mensagem
  //      que já diz RLS com todas as letras: a conexão abre e o modelo nega;
  //   3. nenhuma consulta da página passou e não sobrou consulta pendente de
  //      outro modelo. A tela que varre vários modelos até achar o certo
  //      (pbi-modelo.js) segue normal.
  // Fechada, a página que insiste no modelo negado recebe a mesma recusa na
  // hora. Se uma consulta de outro modelo passar, a tela reabre; quando o TI
  // liberar o acesso, é só recarregar a página.
  var RX_MOMENTO_T = /TokenExpired|expired|capacit|capacity|throttl|\b429\b|unavailable|time ?out/i;
  var RX_RLS       = /row.?level security|\bRLS\b|member of (?:a |any )?(?:security )?role|fun[çc][ãa]o de seguran/i;
  var RX_NEGADO    = /PowerBINotAuthorized|not ?authorized|unauthorized|forbidden|does ?n[o']t have (?:access|permission)|n[ãa]o tem (?:acesso|permiss)|insufficient (?:privileges|permissions)|permission/i;
  var SONDA_T      = JSON.stringify({ queries: [{ query: 'EVALUATE ROW("n", 1)' }], serializerSettings: { includeNulls: true } });
  // negados: modelo que a SONDA confirmou negado -> a última recusa dele. Com
  // a tela fechada, a página que insiste recebe essa resposta na hora, sem
  // gastar o teto de 100/min que é de TODAS as abas da pessoa. O RLS
  // explícito com a sonda passando NÃO entra aqui: a conexão abre, e outra
  // consulta do mesmo modelo ainda pode passar.
  var _tv = { ok: false, negado: null, fechada: false, sondas: {}, negados: {}, timer: null, esperas: 0 };

  function dsDe(url) { return (/\/datasets\/([^/?#]+)\//i.exec(url) || [])[1] || url; }
  // ainda há consulta de um modelo que NÃO foi negado? (a varredura do
  // pbi-modelo.js pode achar o certo). As do modelo negado não contam: a
  // página repete a mesma recusa (grupo, direta, token novo) por segundos.
  function outroModeloPendente() {
    var tem = false;
    function ve(t) { if (!tem && t && !t.morta && t.url.indexOf('/executeQueries') > -1 && !_tv.negados[dsDe(t.url)]) tem = true; }
    _fila.forEach(ve);
    _rodando.forEach(ve);
    return tem;
  }

  // 'build' = o Power BI recusou a chamada; 'rls' = a chamada entrou e o
  // MODELO negou; 'momento' = não dá para concluir; '' = não é acesso
  function classe(status, txt) {
    var s = String(txt || '');
    if (RX_MOMENTO_T.test(s) || status === 429 || status >= 500) return 'momento';
    if (status === 401 || status === 403) return 'build';
    if ((status === 200 || status === 400) && (RX_RLS.test(s) || RX_NEGADO.test(s))) return 'rls';
    return '';
  }
  function resumo(txt) {
    var s = String(txt || '');
    try {
      var e = (JSON.parse(s) || {}).error || {}, pe = e['pbi.error'] || {};
      var det = (pe.details || []).map(function (d) { return d && d.detail && d.detail.value; }).filter(Boolean).join(' · ');
      s = [e.code || pe.code, det || e.message].filter(Boolean).join(': ') || s;
    } catch (x) {}
    return s.replace(/<\/?oii>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  }
  function venceu(auth) {
    try { var exp = claimsDe(auth).exp; return !!exp && exp * 1000 < Date.now() + 30000; }
    catch (e) { return false; }
  }

  // resolve { classe:'ok' } | { classe:'build'|'rls', detalhe } | null (inconclusivo)
  function sondar(url, auth) {
    var direta = url.replace(/\/groups\/[^/]+(\/datasets\/)/i, '$1');
    var urls = direta === url ? [url] : [direta, url];
    var H = { Authorization: auth, 'Content-Type': 'application/json' };
    var pior = null;
    function uma(i) {
      if (i >= urls.length) return Promise.resolve(pior);
      baterPonto();
      return _fetch(urls[i], { method: 'POST', headers: H, body: SONDA_T }).then(function (r) {
        return r.text().then(function (txt) {
          if (r.status === 200 && txt.indexOf('"error"') < 0) return { classe: 'ok' };
          var c = classe(r.status, txt);
          if (c === 'momento') return null;
          if (c && (!pior || c === 'build')) pior = { classe: c, detalhe: 'HTTP ' + r.status + ' · ' + resumo(txt) };
          return uma(i + 1);
        });
      }, function () { return null; });
    }
    return uma(0);
  }

  function observar(t, o) {
    if (!CFG.trava || t.url.indexOf('/executeQueries') < 0) return;
    if (o.status === 200 && o.text.indexOf('"error"') < 0) { acessoOk(); return; }
    if (_tv.ok) return;                           // a página já leu o BI: a falha é da consulta, não do acesso
    var c = classe(o.status, o.text);
    if (!c || c === 'momento') return;
    var auth = authDe(t.init);
    if (!auth || venceu(auth)) return;            // token vencido: a página renova e tenta de novo
    var ds = dsDe(t.url);
    // uma sonda por modelo de cada vez (a página tenta grupo e direta em
    // seguida) e no máximo 3 por modelo; confirmado, não sonda mais
    var sd = _tv.sondas[ds] || (_tv.sondas[ds] = { n: 0, voo: false, fim: false });
    if (sd.voo || sd.fim || ++sd.n > 3) return;
    sd.voo = true;
    var rlsExplicito = RX_RLS.test(o.text);
    var original = 'HTTP ' + o.status + ' · ' + resumo(o.text);
    var recusa = { status: o.status, statusText: o.statusText, text: o.text, ctype: o.ctype };
    sondar(t.url, auth).then(function (s) {
      sd.voo = false;
      if (!s) return;
      if (s.classe === 'ok') { if (rlsExplicito) negar(null, null, 'rls', original); return; }
      sd.fim = true;
      negar(ds, recusa, s.classe, s.detalhe);
    }, function () { sd.voo = false; });
  }
  // ds/recusa só quando a sonda confirmou (ver _tv.negados)
  function negar(ds, recusa, c, detalhe) {
    if (_tv.ok) return;
    if (ds) _tv.negados[ds] = recusa;
    if (!_tv.negado || c === 'build') _tv.negado = { classe: c, detalhe: detalhe };
    decidirTrava();
  }
  function decidirTrava() {
    if (_tv.timer) return;
    _tv.timer = setTimeout(function () {
      _tv.timer = null;
      if (_tv.ok || !_tv.negado || _tv.fechada) return;
      // a página ainda está tentando OUTRO modelo: espera, mas não para
      // sempre — tela que consulta sem parar fecha em ~15 s
      if (outroModeloPendente() && ++_tv.esperas < 6) { decidirTrava(); return; }
      fecharTela();
    }, CFG.travaEsp);
  }
  function acessoOk() {
    _tv.ok = true; _tv.negado = null;
    if (_tv.fechada) abrirTela();
  }

  var TXT_TRAVA = {
    build: 'O Power BI recusou o seu usuário no modelo desta tela: falta a <b>permissão de Build</b> no modelo semântico.',
    rls:   'O seu usuário não está em nenhum <b>grupo de segurança</b> (função RLS) do modelo desta tela no Power BI.'
  };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fecharTela() {
    if (_tv.fechada || !document.body) return;
    _tv.fechada = true;
    var n = _tv.negado || {};
    var alvo = document.querySelector('.area-main');
    var veu = document.createElement('style');
    veu.id = 'pbiq-trava-veu';
    veu.textContent = alvo
      ? '.area-main > *:not(#pbiq-trava){display:none !important}'
      : 'body > *:not(#pbiq-trava):not(#portal-auth-screen):not(script):not(style){visibility:hidden !important}';
    (document.head || document.documentElement).appendChild(veu);
    var box = document.createElement('div');
    box.id = 'pbiq-trava';
    box.setAttribute('role', 'alert');
    box.style.cssText = alvo ? 'padding:48px 16px;'
      : 'position:fixed;inset:0;z-index:9500;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--bmt-page,#F4F7FB);';
    box.innerHTML = '<div style="max-width:540px;margin:0 auto;padding:30px 26px;border-radius:16px;text-align:center;' +
        'background:var(--bmt-card,#fff);border:1px solid var(--bmt-line,#E5EAED);box-shadow:0 12px 36px rgba(16,24,30,.10);' +
        'color:var(--bmt-ink,#10181E);font:14px/1.55 Roboto,system-ui,-apple-system,\'Segoe UI\',sans-serif;">' +
      '<div style="width:50px;height:50px;border-radius:50%;background:#FEF3C7;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">' +
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>' +
      '<h3 style="margin:0 0 8px;font-size:18px;font-weight:700;">Sem acesso aos dados do Power BI</h3>' +
      '<p style="margin:0 0 10px;">' + (TXT_TRAVA[n.classe] || TXT_TRAVA.build) + ' Por segurança, nada desta tela é exibido.</p>' +
      '<p style="margin:0 0 18px;font-size:13px;color:var(--bmt-muted,#5F727A);">Para liberar, o TI / admin do Power BI precisa pôr você num grupo de segurança do modelo e dar a permissão de Build. Depois é só recarregar a página.</p>' +
      '<button type="button" id="pbiq-trava-retry" style="border:none;border-radius:8px;padding:10px 26px;font-size:14px;font-weight:600;background:#0E333C;color:#fff;cursor:pointer;">Tentar de novo</button>' +
      (n.detalhe ? '<div style="margin-top:14px;font-size:11.5px;color:var(--bmt-muted,#81939B);word-break:break-word;">Detalhe: ' + esc(n.detalhe) + '</div>' : '') +
      '</div>';
    if (alvo) alvo.insertBefore(box, alvo.firstChild); else document.body.appendChild(box);
    var b = document.getElementById('pbiq-trava-retry');
    if (b) b.addEventListener('click', function () { location.reload(); });
    _cache.clear(); _bytes = 0;
    // o que está na fila para o modelo negado leva a mesma recusa agora
    _fila.forEach(function (q) {
      var rq = !q.morta && _tv.negados[dsDe(q.url)];
      if (!rq) return;
      q.morta = true; _voo['delete'](q.key); q.ok(rq);
    });
    pintar();
    try { console.error('[PBIQ] 🔒 sem acesso ao BI (' + n.classe + ') — conteúdo da tela fechado. ' + (n.detalhe || '')); } catch (e) {}
  }
  function abrirTela() {
    _tv.fechada = false;
    ['pbiq-trava-veu', 'pbiq-trava'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    pintar();
    try { console.info('[PBIQ] acesso ao BI confirmado — tela reaberta'); } catch (e) {}
  }
  function estadoTrava() {
    return { ativa: !!CFG.trava, fechada: _tv.fechada, leuBI: _tv.ok, negado: _tv.negado };
  }

  // ── RECORTE MSB ────────────────────────────────────────────────
  // 20/10/2026, pedido do dono do portal: "todos os relatórios, todos mesmos,
  // só podem ser empresa MSB". O filtro de Empresa de cada tela não basta:
  // são mais de 20 telas, cada uma com o seu motor, e listas de opção,
  // detalhes de pedido e telas sem filtro de Empresa nem passavam por ele.
  // Por isso o recorte mora AQUI, por onde passa toda consulta do portal ao
  // Power BI (telas, listas, detalhes, exportações e o assistente de voz):
  // cada EVALUATE vira
  //     EVALUATE CALCULATETABLE(<consulta>, 'Empresas'[Código da empresa] IN { "MSB" })
  // A coluna e o valor são descobertos uma vez por modelo: a primeira coluna
  // de RC.cols que existe no modelo e, nela, o valor "MSB" (ou, sem ele, o
  // que tiver MSB / MEDICAL SYSTEM no nome).
  //   - modelo com a coluna mas sem a MSB → a consulta NÃO vai e volta erro:
  //     melhor tela vazia do que número de outra empresa;
  //   - modelo sem tabela de empresa → a consulta vai como está (não há o
  //     que recortar) e aparece em PBIQ.recorte();
  //   - tabela sem relação com 'Empresas' (preços, ruptura…) não é recortada:
  //     no Power BI o filtro só desce pelas relações do modelo.
  // Fica de fora só metadado (INFO.*, COLUMNSTATISTICS), que não tem empresa.
  // Um filtro de empresa POR DENTRO da consulta (CALCULATE(…, "BIO")) passa
  // por cima do recorte — por isso nenhuma tela oferece outra empresa.
  var RC = {
    cols:  ["'Empresas'[Código da empresa]", "'Empresas'[Empresa]", "'Empresa'[Empresa]"],
    valor: 'MSB',
    nome:  /\bMSB\b|MEDICAL\s+SYSTEM/i
  };
  var RX_META = /\b(?:INFO(?:\.[A-Z]+)+|COLUMNSTATISTICS)\s*\(/i;
  var _rc = {}, _rcVisto = {};   // modelo -> Promise / último resultado (PBIQ.recorte)
  var _rcAviso = '';             // faixa fixa quando um modelo da tela não tem a MSB

  // EVALUATE <x> [ORDER BY …] [START AT …] → EVALUATE CALCULATETABLE(<x>, filtro) …
  // Pula texto, nomes entre aspas ou colchetes e comentários; só o nível 0
  // (fora de parênteses e chaves) delimita a consulta.
  function embrulhar(dax, filtro) {
    var s = String(dax), n = s.length, out = [], i = 0, nivel = 0, ini = -1, ult = 0;
    function eh(k) {
      return s.substr(i, k.length).toUpperCase() === k &&
             !/[\w.]/.test(s.charAt(i - 1)) && !/[\w.]/.test(s.charAt(i + k.length));
    }
    function fecha(fim) {
      if (ini < 0) return;
      while (fim > ini && /\s/.test(s.charAt(fim - 1))) fim--;
      // o filtro vai na linha de baixo: um "-- comentário" no fim não o engole
      out.push(s.slice(ult, ini), 'CALCULATETABLE(', s.slice(ini, fim), '\n, ', filtro, ')');
      ult = fim; ini = -1;
    }
    while (i < n) {
      var c = s.charAt(i), d = s.charAt(i + 1);
      if (c === '"' || c === "'" || c === '[') {
        var f = c === '[' ? ']' : c;            // "" '' ]] são o próprio caractere
        for (i++; i < n; i++) { if (s.charAt(i) === f) { if (s.charAt(i + 1) !== f) break; i++; } }
        i++; continue;
      }
      if ((c === '/' && d === '/') || (c === '-' && d === '-')) { while (i < n && s.charAt(i) !== '\n') i++; continue; }
      if (c === '/' && d === '*') { var e = s.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
      if (c === '(' || c === '{') { nivel++; i++; continue; }
      if (c === ')' || c === '}') { nivel--; i++; continue; }
      if (nivel === 0 && /[A-Za-z]/.test(c)) {
        if (eh('EVALUATE')) { fecha(i); i += 8; while (i < n && /\s/.test(s.charAt(i))) i++; ini = i; continue; }
        if (ini >= 0 && (eh('ORDER') || eh('START'))) fecha(i);
        while (i < n && /[\w.]/.test(s.charAt(i))) i++;
        continue;
      }
      i++;
    }
    fecha(n);
    out.push(s.slice(ult));
    return out.join('');
  }

  function modeloDe(u) { return /\/api\/pbi-query/.test(u) ? 'api' : dsDe(u); }
  // o mesmo pedido da página, com outro DAX (executeQueries: queries[0].query; /api/pbi-query: dax)
  function comDax(init, dax) {
    var o = JSON.parse(init.body), novo = {};
    if (o.queries && o.queries[0]) o.queries[0].query = dax; else o.dax = dax;
    for (var k in init) novo[k] = init[k];
    novo.body = JSON.stringify(o);
    return novo;
  }
  function linhasDe(txt) {
    try {
      var j = JSON.parse(txt);
      if (j && j.data && j.data.results) j = j.data;   // /api/pbi-query embrulha em { ok, data }
      return j.results[0].tables[0].rows || null;
    } catch (e) { return null; }
  }
  function recusaRC(col, vals) {
    var msg = 'Recorte MSB: o modelo do Power BI desta tela não tem a empresa MSB em ' + col +
              ' (valores: ' + (vals.slice(0, 6).join(', ') || 'nenhum') + '). Neste portal nenhum relatório mostra outra empresa.';
    return { status: 400, statusText: 'Recorte MSB', ctype: 'application/json',
             text: JSON.stringify({ error: { code: 'RecorteMSB', message: msg } }) };
  }
  // resolve { filtro } | { semEmpresa } | { recusa } (modelo sem a MSB) | { momento } (acesso, 429, rede…)
  function descobrir(u, init, i) {
    if (i >= RC.cols.length) return Promise.resolve({ semEmpresa: true });
    var col = RC.cols[i];
    var dax = 'EVALUATE SELECTCOLUMNS(VALUES(' + col + '), "v", ' + col + ')';
    return enviar(u, comDax(init, dax), dax, true).then(function (o) {
      var rows = (o.status === 200 && o.text.indexOf('"error"') < 0) ? linhasDe(o.text) : null;
      if (rows) {
        var vals = rows.map(function (r) { return r && r['[v]']; })
                       .filter(function (v) { return v != null; }).map(String);
        var msb = vals.filter(function (v) { return v.trim().toUpperCase() === RC.valor; });
        if (!msb.length) msb = vals.filter(function (v) { return RC.nome.test(v); });
        if (!msb.length) return { col: col, recusa: recusaRC(col, vals) };
        return { col: col, filtro: col + ' IN { ' + msb.map(function (v) { return '"' + v.replace(/"/g, '""') + '"'; }).join(', ') + ' }' };
      }
      // erro do MODELO (a coluna não existe aqui) → tenta a próxima; o resto
      // (acesso negado, 429 esgotado, 5xx, 404 da URL errada) volta para a
      // página como veio e a descoberta recomeça na consulta seguinte
      if ((o.status === 400 || o.status === 200) && !classe(o.status, o.text)) return descobrir(u, init, i + 1);
      return { momento: o };
    });
  }
  function recorteDe(u, init) {
    var m = modeloDe(u);
    if (!_rc[m]) {
      _rc[m] = descobrir(u, init, 0);
      _rc[m].then(function (r) {
        if (r.momento) { delete _rc[m]; return; }
        _rcVisto[m] = r.filtro ? { filtro: r.filtro } : r.recusa ? { semMSB: r.col } : { semEmpresa: true };
        if (!r.filtro) console.warn('[PBIQ] recorte MSB · modelo ' + m + ': ' + (r.recusa ? 'sem a MSB em ' + r.col + ' — consultas recusadas' : 'sem tabela de empresa — consultas vão sem recorte'));
        if (r.recusa) {
          _rcAviso = '<b>Este relatório não tem dados da MSB no Power BI.</b> Neste portal nada de outra empresa aparece, então a tela fica sem números.';
          pintar();
        }
      }, function () { delete _rc[m]; });
    }
    return _rc[m];
  }
  function recortar(u, init, dax) {
    return recorteDe(u, init).then(function (rc) {
      if (rc.recusa || rc.momento) return resposta(rc.recusa || rc.momento);
      if (!rc.filtro) return despachar(u, init, dax);
      var d2 = embrulhar(dax, rc.filtro);
      return despachar(u, comDax(init, d2), d2);
    });
  }

  // ── entrada ────────────────────────────────────────────────────
  // fixa: consulta do próprio freio (descoberta do recorte) — nenhuma rajada a descarta
  function enviar(u, init, dax, fixa) {
    _st.pedidos++;
    // tela trancada: o modelo negado responde a mesma recusa, sem ir à rede
    var negada = _tv.fechada && u.indexOf('/executeQueries') > -1 && _tv.negados[dsDe(u)];
    if (negada) return Promise.resolve(negada);
    var id = idDe(init), em = emailPortal();
    if (id !== _idAtual || em !== _emAtual) { _idAtual = id; _emAtual = em; lsSet(K_QUEM, JSON.stringify({ id: id, em: em })); }
    var key = id + '|' + u + '|' + dax;
    var fresco = false;
    try {
      var h = init.headers;
      if (h) fresco = !!((typeof h.get === 'function') ? h.get('X-PBIQ-Fresh') : h['X-PBIQ-Fresh']);
    } catch (e) {}

    if (!fresco) {
      var c = _cache.get(key);
      if (c && (Date.now() - c.t) < CFG.ttl) {
        _st.cache++;
        if (u.indexOf('/executeQueries') > -1) acessoOk();   // só guarda 200 sem erro
        return Promise.resolve(c);
      }
      if (c) { _cache['delete'](key); _bytes -= c.len; }
      var v = _voo.get(key);
      if (v) { _st.juntadas++; return v; }
    }

    var t = { url: u, init: init, key: key, forma: forma(dax), gen: _gen, tent: 1, cacheavel: !fresco, morta: false, fixa: !!fixa };
    var p = new Promise(function (res, rej) { t.ok = res; t.erro = rej; });
    _voo.set(key, p);
    var solta = function () { if (_voo.get(key) === p) _voo['delete'](key); };
    p.then(solta, solta);
    enfileirar(t);
    return p;
  }
  function despachar(u, init, dax) { return enviar(u, init, dax).then(resposta); }

  window.fetch = function (url, init) {
    var u, dax;
    try {
      u = (typeof url === 'string') ? url : (url && url.url) || '';
      var m = String((init && init.method) || (url && url.method) || 'GET').toUpperCase();
      if (m !== 'POST' || !u) return _fetch(url, init);
      var alvo = (u.indexOf('/executeQueries') > -1) || /\/api\/pbi-query(\?|$)/.test(u);
      if (!alvo || !init || typeof init.body !== 'string') return _fetch(url, init);
      dax = daxDe(init.body);
      if (!dax) return _fetch(url, init);
      if (RX_META.test(dax)) return despachar(u, init, dax);
    } catch (e) { return _fetch(url, init); }
    // daqui em diante uma falha NUNCA cai no fetch cru: sem recorte, não vai
    return Promise.resolve().then(function () { return recortar(u, init, dax); });
  };

  // Cada interação abre uma GERAÇÃO nova: o que ficou na fila da geração
  // anterior com a mesma forma de DAX é rajada superada e pode ir pro lixo.
  // 'click' entra na lista porque clique disparado por código (o próprio
  // portal faz isso em alguns filtros) não passa por 'pointerdown'.
  ['pointerdown', 'click', 'keydown', 'change'].forEach(function (ev) {
    document.addEventListener(ev, function () { _gen++; }, true);
  });

  window.PBIQ = {
    cfg: CFG,
    stats: function () {
      return { pedidos: _st.pedidos, rede: _st.rede, cache: _st.cache, juntadas: _st.juntadas,
               descartadas: _st.descartadas, r429: _st.r429, fila: _fila.length, ativas: _ativas,
               noCache: _cache.size, mb: +(_bytes / 1048576).toFixed(1), geracao: _gen, conc: _conc,
               noMinuto: hits().length, freioAte: freio() ? new Date(freio()).toLocaleTimeString('pt-BR') : null,
               olsAprendidas: _st.ols, olsBloqueadas: OLS.lista(), trava: estadoTrava() };
    },
    trava:  estadoTrava,
    recorte: function () { return JSON.parse(JSON.stringify(_rcVisto)); },
    limpar: function () { _cache.clear(); _bytes = 0; lsSet(K_OLS, '{}'); return 'cache do BI e memória de OLS limpos'; },
    ols:    OLS,
    solta:  function () { lsSet(K_COOL, '0'); pintar(); return 'freio liberado'; },
    bruto:  _fetch
  };
  console.log('[PBIQ] freio de consultas ativo — ' + CFG.conc + ' simultâneas, ' + CFG.perMin +
              '/min, cache ' + (CFG.ttl / 1000) + 's. PBIQ.stats() para ver.');
})();
