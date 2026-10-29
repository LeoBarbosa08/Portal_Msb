// ================================================================
// BIOMEDICAL — Sidebar Navigation Engine
// Auto-detecta dept/página e reconstrói o menu lateral completo
// com active state e grupos expandidos corretamente.
// ================================================================

// ── MODO QUIOSQUE (PI) ──────────────────────────────────────────
// O quiosque é amarrado a UM e-mail (localStorage pi_kiosk_email, setado
// quando a pessoa abre pedido-inteligente.html?kiosk=1). Só ESSE usuário
// é preso no PI — os demais usuários autorizados navegam normalmente,
// mesmo no mesmo navegador. Só redireciona após confirmar o e-mail logado.
(function () {
  try {
    localStorage.removeItem('pi_kiosk');   // remove flag global antigo (por navegador)
    var dono = (localStorage.getItem('pi_kiosk_email') || '').toLowerCase();
    if (!dono) return;
    var file = (location.pathname.split('/').pop() || '').toLowerCase();
    // Páginas do ecossistema PI liberadas no quiosque (Pedido + Consignação).
    // Cada PI "recomeça" recarregando a si mesmo (window.location.reload),
    // então TODAS precisam estar aqui — senão o reload cai no Pedido.
    var PI_PAGES = ['pedido-inteligente.html', 'pi-consignacao.html', 'pi-consignacao-incompleto.html', 'pi-cotacao.html', 'pi-pedido-teste.html'];
    if (PI_PAGES.indexOf(file) >= 0) return;   // página PI permitida
    var n = 0, iv = setInterval(function () {
      var email = ((window._portalUser && window._portalUser.email) || '').toLowerCase();
      if (email) {
        clearInterval(iv);
        if (email === dono) {   // só o dono do quiosque é redirecionado
          var dest = location.pathname.indexOf('/pages/') >= 0 ? 'pedido-inteligente.html' : 'pages/pedido-inteligente.html';
          location.replace(dest);
        }
      } else if (++n > 100) { clearInterval(iv); }   // ~10s aguardando login
    }, 100);
  } catch (e) {}
})();

// ── MODO QUIOSQUE (LICI) ────────────────────────────────────────
// Mesma lógica do PI, para a LICI: amarrado a UM e-mail (localStorage
// lici_kiosk_email, setado ao abrir lici.html?kiosk=1). Só ESSE usuário
// é preso na LICI — os demais navegam normal. Redireciona só após confirmar
// o e-mail logado.
(function () {
  try {
    var dono = (localStorage.getItem('lici_kiosk_email') || '').toLowerCase();
    if (!dono) return;
    var file = (location.pathname.split('/').pop() || '').toLowerCase();
    // já está na LICI (o Relatório de Editais é a aba de relatório dela)
    if (file === 'lici.html' || file === 'lici-relatorio.html') return;
    var n = 0, iv = setInterval(function () {
      var email = ((window._portalUser && window._portalUser.email) || '').toLowerCase();
      if (email) {
        clearInterval(iv);
        if (email === dono) {   // só o dono do quiosque é redirecionado
          var dest = location.pathname.indexOf('/pages/') >= 0 ? 'lici.html' : 'pages/lici.html';
          location.replace(dest);
        }
      } else if (++n > 100) { clearInterval(iv); }   // ~10s aguardando login
    }, 100);
  } catch (e) {}
})();

// ── Auth guard: carrega auth.js em todas as páginas internas ────
if (!window._portalAuthLoaded) {
  window._portalAuthLoaded = true;
  const isPages = location.pathname.includes('/pages/');
  const authSrc = (isPages ? '../' : '') + 'auth.js?v=8';
  const s = document.createElement('script');
  s.src = authSrc;
  document.head.appendChild(s);
}

// ── PWA: carrega pwa.js (manifest + service worker) em todas as páginas ──
if (!window._portalPwaLoaded) {
  window._portalPwaLoaded = true;
  const p = document.createElement('script');
  p.src = '/pwa.js';   // caminho absoluto: vale tanto na raiz quanto em /pages/
  p.defer = true;
  (document.head || document.documentElement).appendChild(p);
}

// ── Perfil/Logout: aba "Perfil" na tab bar inferior (mobile) com o botão
//    de sair. Carrega em todas as páginas de dept (a home carrega direto). ──
if (!window._bmPerfilSheetLoaded && !window._bmPerfilSheetInjected) {
  window._bmPerfilSheetInjected = true;
  const ps = document.createElement('script');
  ps.src = '/perfil-sheet.js?v=1';   // caminho absoluto: raiz ou /pages/
  ps.defer = true;
  (document.head || document.documentElement).appendChild(ps);
}

// ================================================================
// CONTROLE DE ACESSO — módulos liberados só para um e-mail.
// Não-autorizados veem o popup "Módulo indisponível" (padrão do portal).
// O e-mail vem do auth.js (window._portalUser.email). É um gate de UX:
// os dados em si continuam protegidos pela autenticação Microsoft/Power BI.
// ================================================================
(function () {
  'use strict';
  var ALLOWED = 'leonardo.barbosa@biomedical.com.br';
  var RESTRICTED = {};
  [
    // Estoque · Gestão de Consignação — LIBERADA em 20/08/26 (pedido do usuário): saiu deste
    //   gate, que travava o módulo num único e-mail. Quem entra agora é quem tem a ÁREA do
    //   Estoque liberada para os seus grupos do Entra — o controle por área (/api/my-areas,
    //   logo abaixo neste arquivo) passa a ser o único portão do módulo. Vale p/ as 5 páginas:
    //   gestão-consignação · saldo-consignado · contagem-saldo-nota · devoluções · rastreabilidade.
    // Financeiro: LIBERADO para todos os usuários (sem popup "Módulo indisponível").
    // Comercial · Novos Negócios — LIBERADO em 25/08/26 (pedido do usuário): saiu deste
    //   gate de um único e-mail, igual à Gestão de Consignação. Quem entra agora é quem
    //   tem a ÁREA do Comercial liberada para os seus grupos do Entra — o controle por
    //   área (/api/my-areas, logo abaixo neste arquivo) é o único portão do módulo.
    //
    // 02/09/26 — a lista ficou VAZIA: os módulos que estavam aqui (Estoque · Ordens de
    //   Compra e ROI, Produtos · Fornecedores/Pesquisa/Registros e os 6 do Contábil)
    //   eram maquetes com número escrito à mão, sem fonte de dados, e foram removidos
    //   do portal. O gate por e-mail existia só para escondê-las de quem não fosse o
    //   dono. Sem as páginas, não há o que restringir.
    //
    // 01/10/26 — Comercial · Customer Service (casos do e-mail + PI) nasceu
    //   RESERVADO aqui. 08/10/26 — SAIU deste gate: virou a área própria
    //   "Canal de Atendimento" (pages/atendimento*.html), RESERVADA em
    //   AREAS_RESERVADAS do api/shared/auth.js. O portão de navegação passa a
    //   ser o controle por área (logo abaixo neste arquivo), como na Gestão de
    //   Consignação; os dados seguem com o /api/cs-*, que recusa quem não está
    //   na equipe do módulo (api/shared/cs-motor.js).
    //
    // 08/10/26 — Comercial · Cotações (a cotação do portal de compras vira
    //   caso, acompanhada até virar pedido -> PI · Pedido, e o funil de
    //   conversão) nasce RESERVADO do mesmo jeito: toda página comercial-cot-*
    //   entra junto (ver restrito() — o "comercial-cotacoes" antigo, que é só
    //   um redirecionamento, não casa). É SÓ do dono, a pedido dele: o
    //   /api/cot-* também só aceita o e-mail dele (DONO em
    //   api/shared/cot-motor.js) — não há equipe, variável nem admin que abra.
  ].forEach(function (id) { RESTRICTED[id] = 1; });

  function fileOf(href){ return String(href||'').split('/').pop().split('#')[0].split('?')[0].replace(/\.html$/i,'').toLowerCase(); }
  function email(){ return ((window._portalUser && window._portalUser.email) || '').trim().toLowerCase(); }
  function allowed(){ return email() === ALLOWED; }
  function restrito(id){ return !!RESTRICTED[id] || /^comercial-cot-/.test(id); }

  // 0) quem NÃO é o autorizado nem vê o link: some do menu lateral, dos cards
  //    do departamento e de onde mais houver âncora. Só poda com o e-mail JÁ
  //    conhecido — antes do login nada sai (senão o próprio dono perdia o link).
  function podarRestritos(){
    if (!email() || allowed() || !document.querySelectorAll) return;
    var tirou = false;
    Array.prototype.slice.call(document.querySelectorAll('a[href]')).forEach(function(a){
      if (restrito(fileOf(a.getAttribute('href')))) { a.remove(); tirou = true; }
    });
    if (!tirou) return;
    Array.prototype.slice.call(document.querySelectorAll('.area-sidebar nav .sb-group')).forEach(function(g){
      if (!g.querySelector('.sb-children a[href]')) g.remove();
    });
    if (typeof window.bmRecontarPill === 'function') window.bmRecontarPill();
  }
  window.bmPodarRestritos = podarRestritos;
  window.bmRestritoPorEmail = function(id){ return restrito(String(id||'').toLowerCase()) && !!email() && !allowed(); };
  // porta do login (auth.js): roda com o e-mail conhecido e ANTES de a tela aparecer
  (window.__bmGates = window.__bmGates || []).push(function(){ podarRestritos(); return Promise.resolve(); });
  document.addEventListener('DOMContentLoaded', function(){ setTimeout(podarRestritos, 0); });

  function modal(){
    var ov = document.getElementById('bm-ind-overlay');
    if (ov) return ov;
    ov = document.createElement('div'); ov.id = 'bm-ind-overlay';
    ov.style.cssText = 'display:none;position:fixed;inset:0;z-index:100000;background:rgba(16,24,30,.5);align-items:center;justify-content:center;font-family:Roboto,system-ui,-apple-system,sans-serif;';
    ov.innerHTML = '<div style="background:#fff;border-radius:16px;max-width:420px;width:90%;padding:28px 26px;box-shadow:0 24px 64px rgba(16,24,30,.3);text-align:center;">'
      + '<div style="width:50px;height:50px;border-radius:50%;background:#FEF3C7;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>'
      + '<h3 style="margin:0 0 8px;font-size:18px;font-weight:700;color:#10181E;">Módulo indisponível</h3>'
      + '<p style="margin:0 0 18px;font-size:14px;color:#354249;line-height:1.55;">Este módulo está disponível apenas para usuários autorizados. Em breve estará liberado no portal.</p>'
      + '<button id="bm-ind-ok" style="border:none;border-radius:8px;padding:10px 26px;font-size:14px;font-weight:600;background:#0E333C;color:#fff;cursor:pointer;">Entendi</button></div>';
    var place = function(){ (document.body || document.documentElement).appendChild(ov); };
    if (document.body) place(); else document.addEventListener('DOMContentLoaded', place);
    var redir = false;
    function hide(){ ov.style.display = 'none'; if (redir) location.href = (location.pathname.indexOf('/pages/') >= 0 ? '../index.html' : 'index.html'); }
    ov.addEventListener('click', function(e){ if (e.target === ov || (e.target.closest && e.target.closest('#bm-ind-ok'))) hide(); });
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && ov.style.display !== 'none') hide(); });
    ov._redir = function(v){ redir = v; };
    return ov;
  }
  function show(redir){ var ov = modal(); if (ov._redir) ov._redir(!!redir); ov.style.display = 'flex'; }

  // 1) clique em link para módulo restrito (sidebar, cards, etc.) quando não autorizado
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    if (restrito(fileOf(a.getAttribute('href'))) && !allowed()) { e.preventDefault(); e.stopPropagation(); show(false); }
  }, true);

  // 2) abrir direto uma página restrita: espera o e-mail (auth.js) e bloqueia se não for o autorizado.
  //    Como PORTA do login, o bloqueio entra antes de a tela aparecer (e cobre a página);
  //    o laço abaixo continua como rede para quando a porta não for chamada.
  if (restrito(fileOf(location.pathname))) {
    (window.__bmGates = window.__bmGates || []).push(function(){
      var em = email();
      if (em && em !== ALLOWED) {
        var st = document.createElement('style');
        st.textContent = 'body > *:not(#bm-ind-overlay):not(#portal-auth-screen):not(script):not(style){visibility:hidden !important}';
        (document.head || document.documentElement).appendChild(st);
        show(true);
      }
      return Promise.resolve();
    });
  }
  if (restrito(fileOf(location.pathname))) {
    var n = 0, iv = setInterval(function(){
      n++;
      var em = email();
      if (em) { clearInterval(iv); if (em !== ALLOWED) show(true); }
      else if (n > 600) { clearInterval(iv); }   // ~120s aguardando o login concluir
    }, 200);
  }
})();

// ================================================================
// CONTROLE DE ACESSO POR AREA (grupo do Entra) - bloqueia a pagina
// inteira se a AREA dela nao estiver liberada para os grupos da pessoa.
// Fonte da verdade: /api/my-areas (o mesmo do index).
//
// FAIL-CLOSED (20/08/26, reforcado em 21/08/26). Antes qualquer incerteza
// LIBERAVA - o que, somado ao fail-open do index, dava a brecha de ver/abrir
// area alheia. Hoje:
//   . a decisao roda como PORTA (window.__bmGates): a tela de login do
//     auth.js so sai depois dela, entao a pagina nunca pisca aberta;
//   . sem decisao = BLOQUEIA, com mensagem propria de "nao confirmado";
//   . TODA pagina de /pages/ passa pelo portao. Antes o guard so reconhecia
//     paginas com PREFIXO de area (comercial-*, financeiro-*, ...) e deixava
//     23 modulos SEM prefixo 100% abertos - bastava a URL direta, o card de
//     "Sistemas & Links", a busca do portal ou um link colado no Teams:
//     cobranca-automatica (Financeiro), lici (Licitacao), pedido-inteligente
//     e pi-* (Comercial), os agente-* de cada dept, inventario (Estoque).
//     Estao no MAPA abaixo; pagina que sobrar SEM classificacao e' bloqueada
//     para quem tem restricao de area (quem nao tem restricao - TI, diretoria,
//     ADMIN_EMAILS - continua entrando, e o console avisa a TI).
//   . o token vem do broker do auth.js (silent -> ssoSilent -> redirect),
//     nunca de popup - no celular nao aparece mais aviso de pop-up.
// ================================================================
(function () {
  'use strict';
  if (location.pathname.indexOf('/pages/') < 0) return;   // so paginas internas

  var AREAS = ['comercial', 'financeiro', 'logistica', 'marketing', 'estoque',
    'contabil', 'licitacao', 'administrativo', 'produtos', 'pessoas', 'qualidade', 'ti',
    'diretoria', 'vendedor', 'gerencial', 'atendimento', 'compras'];

  // Paginas cujo NOME DE ARQUIVO nao comeca pela area. Mais de uma area =
  // "qualquer uma serve" (mesmo any-of do requireArea do backend).
  // MANTENHA IGUAL ao mapa EXTRA do area-access.js (o do index.html).
  var MAPA = {
    'cobranca-automatica':       ['financeiro'],
    'cobranca-notas':            ['financeiro'],
    'lici':                      ['licitacao'],
    'lici-relatorio':            ['licitacao'],
    'pedido-inteligente':        ['comercial'],
    'pi-pedido-teste':           ['comercial'],
    'pi-cotacao':                ['comercial', 'licitacao'],
    'pi-consignacao':            ['comercial', 'estoque'],
    'pi-consignacao-incompleto': ['comercial', 'estoque'],
    'inventario':                ['estoque'],
    'agente-administrativo':     ['administrativo'],
    'agente-chat':               ['comercial'],
    'agente-comercial':          ['comercial'],
    'agente-contabil':           ['contabil'],
    'agente-estoque':            ['estoque'],
    'agente-financeiro':         ['financeiro'],
    'agente-licitacao':          ['licitacao'],
    'agente-logistica':          ['logistica'],
    'agente-marketing':          ['marketing'],
    'agente-pedidos':            ['comercial'],
    'agente-produtos':           ['produtos'],
    'agente-qualidade':          ['qualidade'],
    'agente-rh':                 ['pessoas'],
    'agente-ti':                 ['ti'],
    'agente-voz':                ['financeiro'],
    // endereços antigos do Customer Service (hoje só redirecionam p/ atendimento*)
    'comercial-customer-service': ['atendimento'],
    'comercial-cs-casos':        ['atendimento']
  };

  function file() { return String(location.pathname).split('/').pop().split('#')[0].split('?')[0].replace(/\.html$/i, '').toLowerCase(); }
  function areasDoId(f) {
    if (MAPA[f]) return MAPA[f];
    for (var i = 0; i < AREAS.length; i++) { var a = AREAS[i]; if (f === a || f.indexOf(a + '-') === 0) return [a]; }
    return null;
  }
  function areasDaPagina() {
    return areasDoId(file());   // sem classificacao -> fail-closed p/ quem tem restricao
  }

  // ── MODULOS AVULSOS (mapa GRUPO_MODULOS do api/shared/auth.js) ──
  // Grant cirurgico: a pessoa NAO tem a area, mas pode abrir estas paginas
  // (ex.: Coordenacao de Compras/Estoque so na Margem de Contribuicao, que e'
  // do Contabil). Vem em /api/my-areas -> j.modulos.
  // A VISAO GERAL do departamento (contabil.html) passa junto, como porta de
  // entrada — e' podada logo depois, sobrando so' o modulo liberado.
  function moduloLibera(f, acc) {
    var mods = (acc && acc.modulos) || [];
    if (!mods.length || !f) return false;
    if (mods.indexOf(f) >= 0) return true;
    for (var i = 0; i < mods.length; i++) {
      var a = areasDoId(mods[i]);
      if (a && a.indexOf(f) >= 0) return true;   // f e' a visao geral do dept
    }
    return false;
  }
  var areas  = areasDaPagina();
  var rotulo = areas ? areas.join(' ou ') : '';
  window.bmAreasDaPagina = areas;   // leitura p/ outros scripts da pagina

  // esconde o conteudo enquanto nao houver decisao (a tela de login do auth.js
  // cobre a pagina, mas em navegacao interna ela nao reaparece)
  var veu = null;
  function velar() {
    if (veu || !document.documentElement) return;
    veu = document.createElement('style');
    veu.textContent = 'body > *:not(#portal-auth-screen):not(#bm-area-block):not(script):not(style){visibility:hidden !important}';
    document.head.appendChild(veu);
  }
  function desvelar() { if (veu && veu.parentNode) { veu.parentNode.removeChild(veu); veu = null; } }
  velar();

  function bloquear(motivo) {
    // o veu FICA: assim o conteudo da pagina nao aparece atras do aviso
    // translucido durante os 6s antes de voltar ao portal.
    velar();
    var titulo, texto;
    // sessao Microsoft vencida (sem token / 401): renova ali mesmo e volta
    // para ESTA pagina. Antes caia no "Acesso nao confirmado" e a pessoa so
    // saia dele com logout.
    var sessao = (/^token:/.test(motivo) || motivo === 'HTTP 401') && typeof window.portalReauth === 'function';
    if (sessao) {
      titulo = 'Sessão expirada';
      texto  = 'Sua sessão com a Microsoft precisa ser renovada para abrir esta página. '
             + 'Clique em <strong>Entrar novamente</strong> — você volta para cá, sem precisar sair do portal.';
    } else if (motivo === 'sem-area') {
      titulo = 'Área restrita';
      texto  = 'Você não tem acesso a este módulo. Ele pertence à área de <strong>'
             + rotulo + '</strong>, que não está liberada no seu perfil de acesso. '
             + 'Se você precisa dele, fale com a TI. Voltando ao portal…';
    } else if (motivo === 'nao-classificada') {
      titulo = 'Módulo não liberado';
      texto  = 'Este módulo ainda não foi classificado por área, então o acesso não foi '
             + 'liberado para o seu perfil. Se você precisa dele, avise a TI.';
    } else {
      titulo = 'Acesso não confirmado';
      texto  = 'Não foi possível confirmar seu perfil de acesso, então a página não foi liberada. '
             + 'Volte ao portal e tente de novo; se continuar, avise a TI.';
    }
    var ov = document.createElement('div');
    ov.id = 'bm-area-block';
    ov.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(16,24,30,.55);display:flex;align-items:center;justify-content:center;font-family:Roboto,system-ui,-apple-system,sans-serif;';
    ov.innerHTML = '<div style="background:#fff;border-radius:16px;max-width:440px;width:90%;padding:28px 26px;box-shadow:0 24px 64px rgba(16,24,30,.3);text-align:center;">'
      + '<div style="width:50px;height:50px;border-radius:50%;background:#FEF3C7;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>'
      + '<h3 style="margin:0 0 8px;font-size:18px;font-weight:700;color:#10181E;">' + titulo + '</h3>'
      + '<p style="margin:0 0 18px;font-size:14px;color:#354249;line-height:1.55;">' + texto + '</p>'
      + (sessao ? '<button id="bm-area-reauth" style="border:none;border-radius:8px;padding:10px 26px;font-size:14px;font-weight:600;background:#0E333C;color:#fff;cursor:pointer;margin:0 6px 8px;">Entrar novamente</button>' : '')
      + '<button id="bm-area-ok" style="border-radius:8px;padding:10px 26px;font-size:14px;font-weight:600;cursor:pointer;margin:0 6px 8px;'
      + (sessao ? 'border:1px solid #CBD5DB;background:#fff;color:#0E333C;' : 'border:none;background:#0E333C;color:#fff;') + '">Voltar ao portal</button></div>';
    function go() { location.href = '../index.html'; }
    function renovar(btn) {
      btn.disabled = true;
      btn.textContent = 'Abrindo a Microsoft…';
      // o MSAL recusou antes de sair da pagina: recarregar limpa o estado
      window.portalReauth(['openid', 'profile']).catch(function () { location.reload(); });
    }
    var put = function () {
      (document.body || document.documentElement).appendChild(ov);
      ov.addEventListener('click', function (e) {
        var re = e.target.closest && e.target.closest('#bm-area-reauth');
        if (re) { if (!re.disabled) renovar(re); return; }
        if ((e.target === ov && !sessao) || (e.target.closest && e.target.closest('#bm-area-ok'))) go();
      });
    };
    if (document.body) put(); else document.addEventListener('DOMContentLoaded', put);
    if (!sessao) setTimeout(go, 6000);   // volta sozinho apos 6s (sessao: espera a pessoa renovar)
    console.error('[AreaGuard] BLOQUEADO em "' + (rotulo || file()) + '" -> ' + motivo);
  }

  function liberar(motivo) {
    desvelar();
    console.log('[AreaGuard] liberado em "' + (rotulo || file()) + '" -> ' + motivo);
  }

  // decide a partir do mapa de acesso; devolve true se resolveu.
  //
  // `soLibera` = "esta fonte pode LIBERAR, mas nao pode BARRAR". E' como o
  // cache de sessao entra: ele vale 30 min e envelhece mal quando o acesso
  // NASCE nesse meio tempo (foi o caso do convite da Votacao OKR — a pessoa
  // era convidada e, com o cache de antes, levava "Voce nao tem acesso" na
  // cara ate' o cache expirar). Barrar alguem e' a decisao cara: exige
  // resposta FRESCA do /api/my-areas. Liberar pelo cache continua valendo —
  // e' o que mantem a navegacao instantanea.
  function decidir(acc, origem, soLibera) {
    if (!acc) return false;
    publicar(acc);
    if (!acc.restricted) { liberar(origem + ' / sem restricao'); return true; }
    if (moduloLibera(file(), acc)) { podar(); liberar(origem + ' / modulo avulso'); return true; }
    if (!areas) { if (soLibera) return false; bloquear('nao-classificada'); return true; }
    var ok = acc.allowed || [];
    for (var i = 0; i < areas.length; i++) {
      if (ok.indexOf(areas[i]) >= 0) { podar(); liberar(origem + ' / area liberada (' + areas[i] + ')'); return true; }
    }
    if (soLibera) return false;                 // confirma na rede antes de barrar
    bloquear('sem-area');
    return true;
  }

  // decisao visivel p/ o resto da pagina (menu lateral, cards de modulo)
  function publicar(acc) {
    window._portalAccess   = acc;
    window._allowedAreas   = acc.restricted ? new Set(acc.allowed || []) : null;
    window._allowedModulos = new Set(acc.restricted ? (acc.modulos || []) : []);
    if (acc.restricted) velarGrade();
  }

  // veu SO' da grade de modulos: com decisao em cache ela seria pintada
  // inteira e podada logo depois — o card proibido piscava na tela.
  function velarGrade() {
    if (!document.head || !document.getElementById || document.getElementById('bm-poda-veu')) return;
    var st = document.createElement('style');
    st.id = 'bm-poda-veu';
    st.textContent = '.modulos-grid{visibility:hidden !important}';
    document.head.appendChild(st);
  }
  function desvelarGrade() {
    var st = document.getElementById && document.getElementById('bm-poda-veu');
    if (st && st.parentNode) st.parentNode.removeChild(st);
  }

  // ── PODA: tira da tela o que a pessoa nao consegue abrir ────────
  // Sem isto, quem entra por modulo avulso cai na visao geral do
  // departamento vendo TODOS os cards do dept — clicaria e levaria o
  // bloqueio na cara. Mexe so' em link CLASSIFICADO (com area conhecida):
  // pagina sem area, link externo e "voltar ao portal" ficam intactos.
  function podeAbrir(href) {
    var acc = window._portalAccess;
    if (!acc || !acc.restricted) return true;
    var h = String(href || '');
    if (!h || h.charAt(0) === '#' || /^(https?:|mailto:|tel:)/i.test(h)) return true;
    var f = h.split('/').pop().split('#')[0].split('?')[0].replace(/\.html$/i, '').toLowerCase();
    if (!f) return true;
    if (typeof window.bmRestritoPorEmail === 'function' && window.bmRestritoPorEmail(f)) return false;
    var as = areasDoId(f);
    if (!as) return true;                       // pagina sem area: nao mexemos
    var ok = acc.allowed || [];
    for (var i = 0; i < as.length; i++) if (ok.indexOf(as[i]) >= 0) return true;
    return moduloLibera(f, acc);
  }
  window.bmPodeAbrir = podeAbrir;

  function podar() {
    // módulo reservado a um e-mail sai primeiro — vale até para quem não tem
    // restrição de área (TI/diretoria entram em toda área, mas não nele)
    if (typeof window.bmPodarRestritos === 'function') window.bmPodarRestritos();
    var acc = window._portalAccess;
    if (!acc || !acc.restricted || !document.body || !document.querySelectorAll) return;
    // cards de modulo (grade do dept + barra de sub-modulos do nav-sidebar)
    Array.prototype.slice.call(document.querySelectorAll('a.modulo-card')).forEach(function (a) {
      if (!podeAbrir(a.getAttribute('href'))) a.remove();
    });
    // rodapé do dept (a coluna com as páginas da área): mesma regra — senão o
    // líder de área, que só abre os Indicadores Setoriais, via "Globais" ali
    Array.prototype.slice.call(document.querySelectorAll('.site-footer .bm-footer-col li > a[href]')).forEach(function (a) {
      if (!podeAbrir(a.getAttribute('href'))) a.parentNode.remove();
    });
    // abas do relatório (.fx-tabs: Saldo | Ruptura | Validade…) e blocos que
    // resumem outro módulo dentro da página (data-bm-modulo — o cartão da
    // Ruptura na Visão Geral da Gestão de Estoque): quem tem o Estoque por
    // módulo, sem a Ruptura, não vê nem a aba nem o resumo dela.
    var tirouAba = false;
    Array.prototype.slice.call(document.querySelectorAll('.fx-tabs a[href]')).forEach(function (a) {
      if (!podeAbrir(a.getAttribute('href'))) { a.remove(); tirouAba = true; }
    });
    // a pílula da aba ativa (portal-motion.js) se reposiciona no resize
    if (tirouAba) { try { window.dispatchEvent(new Event('resize')); } catch (e) {} }
    Array.prototype.slice.call(document.querySelectorAll('[data-bm-modulo]')).forEach(function (el) {
      if (!podeAbrir(el.getAttribute('data-bm-modulo'))) el.remove();
    });
    // menu lateral: links e grupos que ficaram sem filho
    var sb = document.querySelector('.area-sidebar nav');
    if (!sb) return;
    Array.prototype.slice.call(sb.querySelectorAll('a[href]')).forEach(function (a) {
      if (!podeAbrir(a.getAttribute('href'))) a.remove();
    });
    Array.prototype.slice.call(sb.querySelectorAll('.sb-group')).forEach(function (g) {
      if (!g.querySelector('.sb-children a[href]')) g.remove();
    });
    recontarPill();
    desvelarGrade();
  }

  // o pill "N modulos" do hero e' montado com a grade inteira; se a poda tirou
  // card, a conta fica mentindo ("8 modulos" com 1 na tela). O de agentes
  // também: agente reservado a um e-mail (o de Cotações) sai do menu na poda.
  function contarAgentes() {
    var n = 0;
    Array.prototype.slice.call(document.querySelectorAll('.sb-card .sb-section')).forEach(function (s) {
      if (!/agentes/i.test(s.textContent)) return;
      var el = s.nextElementSibling;
      while (el && !el.classList.contains('sb-section') && !el.classList.contains('sb-divider')) {
        if (el.tagName === 'A') n++;
        el = el.nextElementSibling;
      }
    });
    return n;
  }
  function recontarPill() {
    var pills = document.querySelector('.dv-hero-pills');
    if (!pills) return;
    var nMod = document.querySelectorAll('.modulos-grid .modulo-card').length;
    var nAg = contarAgentes();
    Array.prototype.slice.call(pills.querySelectorAll('.dv-hero-pill')).forEach(function (p) {
      var dot = p.querySelector('.dv-dot');
      if (dot) {                                       // esse e' o pill de agentes
        if (!nAg) { p.remove(); return; }
        p.textContent = nAg + (nAg === 1 ? ' agente IA' : ' agentes IA');
        p.insertBefore(dot, p.firstChild);
        return;
      }
      if (!nMod) { p.remove(); return; }
      var svg = p.querySelector('svg');
      p.textContent = nMod + (nMod === 1 ? ' módulo' : ' módulos');
      if (svg) p.insertBefore(svg, p.firstChild);
    });
  }
  // o menu lateral e os sub-modulos so' existem depois do DOMContentLoaded;
  // quem monta chama de novo (window.bmPodarNavegacao).
  window.bmPodarNavegacao = podar;
  window.bmRecontarPill = recontarPill;   // a poda por e-mail (gate do topo) tambem recontar
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () { podar(); desvelarGrade(); }, 0);   // a grade nunca fica velada
  });

  async function resolver() {
    // 1) cache de sessao (gravado no index por area-access.js). So' LIBERA:
    //    se o cache diria "nao", ele cai para a consulta abaixo — ver decidir().
    var cacheNegou = false;
    try {
      var c = JSON.parse(sessionStorage.getItem('portal_access') || 'null');
      if (c && (Date.now() - c.t) < 1800000) {                        // < 30 min
        if (decidir(c, 'cache', true)) return;
        cacheNegou = true;
      }
    } catch (e) {}

    // 2) sem cache (entrou direto na pagina) -> consulta o backend
    if (window._portalAuthReady) await window._portalAuthReady;
    var inst = window._msalAuth;
    var acct = inst && ((inst.getActiveAccount && inst.getActiveAccount())
            || (inst.getAllAccounts && inst.getAllAccounts()[0]));
    if (!acct) { bloquear('sem conta logada'); return; }

    var tok;
    try {
      // openid/profile: o backend so precisa IDENTIFICAR a pessoa (os grupos
      // ele consulta app-only). Escopo minimo = o silent acerta quase sempre.
      // portalIdToken (auth.js novo) ja renova o id token do cache vencendo
      if (typeof window.portalIdToken === 'function') {
        tok = await window.portalIdToken();
      } else if (typeof window.portalToken === 'function') {
        var r = await window.portalToken(['openid', 'profile'], { noPopup: true });
        tok = r && r.idToken;
      } else {
        var r2 = await inst.acquireTokenSilent({ scopes: ['openid', 'profile'], account: acct });
        tok = r2 && r2.idToken;
      }
      if (!tok) throw new Error('sem idToken');
    } catch (e) { bloquear('token: ' + ((e && (e.errorCode || e.message)) || 'erro')); return; }

    var j = null, err = '';
    for (var i = 0; i < 2; i++) {
      try {
        var ctrl = ('AbortController' in window) ? new AbortController() : null;
        var t = ctrl && setTimeout(function () { ctrl.abort(); }, 12000);
        // O SWA descarta o Authorization; a identidade vai em headers CUSTOM
        // (x-portal-idtoken/oid/email), que o SWA repassa.
        // fresh=1 quando estamos a um passo de BARRAR: manda o backend
        // ignorar o cache curto dele (a lista de convidados da Votacao OKR),
        // senao um convite feito ha' segundos ainda daria bloqueio.
        var res = await fetch('/api/my-areas' + (cacheNegou ? '?fresh=1' : ''), {
          signal: ctrl ? ctrl.signal : undefined,
          headers: {
            'x-portal-idtoken': tok,
            'x-portal-oid': (acct.idTokenClaims && acct.idTokenClaims.oid) || '',
            'x-portal-email': acct.username || ''
          }
        });
        if (t) clearTimeout(t);
        if (!res.ok) { err = 'HTTP ' + res.status; if (res.status < 500 && res.status !== 429) break; continue; }
        var body = await res.json();
        if (!body || body.ok !== true) { err = 'payload invalido'; continue; }
        j = body; break;
      } catch (e) { err = (e && e.name === 'AbortError') ? 'tempo esgotado' : ((e && e.message) || 'erro de rede'); }
    }
    if (!j) { bloquear(err || 'falha em /api/my-areas'); return; }

    var acc = { restricted: !!j.restricted, allowed: j.areas || [], modulos: j.modulos || [], t: Date.now() };
    try { sessionStorage.setItem('portal_access', JSON.stringify(acc)); } catch (e) {}
    decidir(acc, 'api');
  }

  // Porta de acesso: o auth.js so tira a tela de login depois desta promise.
  var _p = null;
  function porta() {
    if (_p) return _p;
    // teto duro: sem decisao em 22s a pagina NAO fica em branco nem aberta - bloqueia
    var teto = new Promise(function (res) { setTimeout(function () { if (veu) bloquear('tempo esgotado'); res(); }, 22000); });
    _p = Promise.race([resolver().catch(function (e) { bloquear('erro inesperado: ' + (e && e.message)); }), teto]);
    return _p;
  }
  (window.__bmGates = window.__bmGates || []).push(porta);
  // rede de seguranca: se a porta nao for chamada (auth.js velho em cache),
  // decide sozinho assim que o login sair.
  if (window._portalAuthReady) window._portalAuthReady.then(porta);
  else setTimeout(function () { if (window._portalAuthReady) window._portalAuthReady.then(porta); else porta(); }, 4000);
})();

(function () {
  'use strict';

  // Paginas que carregam este arquivo SO para herdar o portao de acesso
  // (auth.js + guard de area) e NAO querem menu lateral nem os ajustes
  // mobile: InventarIA, agentes avulsos, etc. Elas setam
  // window.BM_SEM_SIDEBAR = true antes de incluir o script.
  if (window.BM_SEM_SIDEBAR) return;

  /* ── SVG icons ─────────────────────────────────────────────── */
  const I = {
    grid:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    chat:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
    cloud:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>',
    bars:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    brief:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
    file:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
    dollar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    truck:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    send:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    users:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    monitor:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    tag:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    heart:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    ext:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    zap:    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    book:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="9" y1="7" x2="16" y2="7"/><line x1="9" y1="11" x2="14" y2="11"/></svg>',
    bot:    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M12 11V7"/><circle cx="12" cy="5" r="2"/><circle cx="8" cy="16" r="1" fill="currentColor"/><circle cx="16" cy="16" r="1" fill="currentColor"/></svg>',
    check:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    headset:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14v-3a9 9 0 0 1 18 0v3"/><path d="M21 15a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2z"/><path d="M3 15a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2z"/><path d="M18 17v1a3 3 0 0 1-3 3h-3"/></svg>',
    caret:  '<svg class="sb-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
  };

  /* ── Dept icons ─────────────────────────────────────────────── */
  const DEPT_ICON = {
    comercial:      '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6"/><path d="M23 11h-6"/></svg>',
    financeiro:     '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    ti:             '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    logistica:      '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    marketing:      '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>',
    estoque:        '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
    contabil:       '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
    licitacao:      '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    administrativo: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
    produtos:       '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    pessoas:        '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    qualidade:      '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>',
    diretoria:      '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    vendedor:       '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
    gerencial:      '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>',
    atendimento:    '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14v-3a9 9 0 0 1 18 0v3"/><path d="M21 15a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2z"/><path d="M3 15a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2z"/><path d="M18 17v1a3 3 0 0 1-3 3h-3"/></svg>',
    compras:        '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>'
  };

  /* ── Navigation config ──────────────────────────────────────── */
  const NAV = {
    comercial: {
      label:'Comercial',
      nav:[
        {id:'comercial',          label:'Visão geral',           href:'comercial.html',            icon:I.grid},
        {id:'comercial-sr',       label:'Sales Report',          href:'comercial-sales-report.html',icon:I.bars, children:[
          {id:'comercial-sales-report',    label:'Visão geral',       href:'comercial-sales-report.html'},
          {id:'comercial-performance-vendas', label:'Performance de Vendas', href:'comercial-performance-vendas.html'},
          {id:'comercial-vendas',          label:'Análise de Vendas',  href:'comercial-vendas.html'},
          {id:'comercial-clientes',        label:'Análise de Pedidos',href:'comercial-clientes.html'},
          {id:'comercial-base-notas-fiscais', label:'Base de Notas Fiscais', href:'comercial-base-notas-fiscais.html'},
          {id:'comercial-comportamento-clientes', label:'Comportamento de Clientes', href:'comercial-comportamento-clientes.html'},
        ]},
        // RECORTE MSB (20/10/26): no portal da MSB o Comercial mostra SÓ o
        // Sales Report e a Tabela de Preços. Saíram do menu (e, por tabela,
        // dos cartões de agentes/atalhos da visão geral, que o portal-motion.js
        // monta a partir deste menu): Negociações, Cotações, FCA, Sales
        // Playbook, Materiais e Recursos, os agentes (Dossiê de Visita,
        // PI · Pedido, PI · Consignação, PI · Consignação INCOMPLETO, Agente de
        // Cotações) e os atalhos (Salesforce, Metas & Pipeline). As páginas
        // continuam nos arquivos; para voltar, é recolocar aqui, nos cartões
        // de pages/comercial.html e no MSB_VISIVEIS do portal-catalogo.js.
        {id:'comercial-tabela-precos', label:'Tabela de Preços', href:'comercial-tabela-precos.html', icon:I.dollar},
      ],
      auto:[],
      agen:[],
      atal:[]
    },

    financeiro: {
      label:'Financeiro',
      nav:[
        {id:'financeiro',               label:'Visão geral',      href:'financeiro.html',              icon:I.grid},
        {id:'financeiro-cr',            label:'Contas a Receber',  href:'financeiro-contas-receber.html',icon:I.dollar, children:[
          {id:'financeiro-contas-receber',     label:'Visão Geral',                 href:'financeiro-contas-receber.html'},
          {id:'financeiro-inadimplencia',      label:'Inadimplência',               href:'financeiro-inadimplencia.html'},
          {id:'financeiro-baixas-cliente',     label:'Baixas por cliente',          href:'financeiro-baixas-cliente.html'},
          {id:'financeiro-detalhamento-nf',    label:'Detalhamento de nota fiscal', href:'financeiro-detalhamento-nf.html'},
        ]},
        // Contas a Pagar é um módulo de AUTOMAÇÕES: cada filho é uma rotina
        // do time (a 1ª separa o compilado de comprovantes do banco). A casa
        // (financeiro-contas-pagar.html) lista todas — automação nova entra
        // aqui, lá e no portal-catalogo.js.
        {id:'financeiro-cp',            label:'Contas a Pagar',    href:'financeiro-contas-pagar.html', icon:I.file, children:[
          {id:'financeiro-contas-pagar',              label:'Visão Geral',            href:'financeiro-contas-pagar.html'},
          {id:'financeiro-contas-pagar-comprovantes', label:'Comprovantes Bancários', href:'financeiro-contas-pagar-comprovantes.html'},
        ]},
      ],
      // Cobrança Automática oculta para todos (07/10): saiu do menu e dos
      // cartões; a página (cobranca-automatica.html) segue no ar pelo link.
      auto:['Cobrança · Notas em Aberto'],
      agen:[],
      atal:[]
    },

    ti: {
      label:'TI & Sistemas',
      nav:[
        {id:'ti',          label:'Visão geral',       href:'ti.html',          icon:I.grid},
        {id:'ti-chamados', label:'Central de Chamados',href:'ti-chamados.html', icon:I.chat},
        {id:'ti-sistemas-g',label:'Sistemas & Infra',  href:'ti-sistemas.html', icon:I.server, children:[
          {id:'ti-sistemas',          label:'Visão geral', href:'ti-sistemas.html'},
          {id:'ti-sistemas-internet', label:'Internet',    href:'ti-sistemas-internet.html'},
          {id:'ti-sistemas-vms',      label:"VM's",        href:'ti-sistemas-vms.html'},
          {id:'ti-sistemas-firewalls',label:'Firewalls',   href:'ti-sistemas-firewalls.html'},
          {id:'ti-sistemas-log-portal',label:'Log de Entradas', href:'ti-sistemas-log-portal.html'},
        ]},
        {id:'ti-azure-g',  label:'Microsoft Azure',   href:'ti-azure.html',    icon:I.cloud, children:[
          {id:'ti-azure',             label:'Visão geral',    href:'ti-azure.html'},
          {id:'ti-azure-custo',       label:'Custo Azure',    href:'ti-azure-custo.html'},
          {id:'ti-azure-colaboradores',label:'Licenciamento e Custo do Colaborador', href:'ti-azure-colaboradores.html'},
          {id:'ti-azure-licenciamento',label:'Licenciamento', href:'ti-azure-licenciamento.html'},
          {id:'ti-azure-usuarios',    label:'Usuários Ativos',href:'ti-azure-usuarios.html'},
          {id:'ti-azure-agentes',     label:'Agentes de IA',  href:'ti-azure-agentes.html'},
        ]},
        {id:'ti-nf-pdf',   label:'PDF de Nota Fiscal', href:'ti-nf-pdf.html',   icon:I.file},
      ],
      auto:['Deploy Automático','Alertas de Infraestrutura','Monitoramento Contínuo'],
      agen:[{l:'Agente de TI',h:'agente-ti.html'},{l:'Análise de Incidentes IA',h:'agente-ti.html'},{l:'Agentes Azure',h:'ti-azure-agentes.html'}],
      atal:[{l:'Monitoramento',h:'#',badge:'Online'},{l:'Base de Conhecimento',h:'https://tibiomedical.sharepoint.com/sites/BioPortal/SitePages/PROCEDIMENTOS-OPERACIONAIS-PADR%C3%83O.aspx',e:true}]
    },

    logistica: {
      label:'Logística',
      nav:[
        {id:'logistica',             label:'Visão geral',    href:'logistica.html',             icon:I.grid},
        {id:'logistica-fluxo-g',     label:'Fluxo Logístico', href:'logistica-fluxo-logistico.html', icon:I.bars, children:[
          {id:'logistica-fluxo-logistico',  label:'Visão Geral', href:'logistica-fluxo-logistico.html'},
          {id:'logistica-fluxo-relatorios', label:'Relatórios',  href:'logistica-fluxo-relatorios.html'},
        ]},
      ],
      // Cargas/Expedição/Fornecedores/Rotas e as automações/agentes antigos
      // eram maquetes e saíram do menu a pedido do usuário.
      // Cotação de Frete (16/10/2026): calcula o frete por transportadora a
      // partir de peso, cubagem, destino e valor da NF — variáveis e tabelas
      // em logistica-frete-motor.js (por enquanto, tabelas de exemplo).
      auto:['Cotação de Frete'],
      agen:[],
      atal:[]
    },

    marketing: {
      label:'Marketing',
      nav:[
        {id:'marketing',             label:'Visão geral',      href:'marketing.html',            icon:I.grid},
        {id:'marketing-formularios', label:'Formulários',      href:'marketing-formularios.html',icon:I.file},
        {id:'marketing-leads',       label:'BioLeads · Captação',href:'marketing-leads.html',    icon:I.filter},
        {id:'marketing-leads-medicos',label:'BioLeads · Médicos',href:'marketing-leads-medicos.html',icon:I.users},
      ],
      auto:[],
      agen:[{l:'BioLeads · Buscador de Leads',h:'marketing-leads.html'},{l:'BioLeads · Médicos',h:'marketing-leads-medicos.html'},{l:'Agente de Conteúdo',h:'agente-marketing.html'},{l:'Análise de Engajamento IA',h:'agente-marketing.html'}],
      atal:[]
    },

    estoque: {
      label:'Estoque',
      nav:[
        {id:'estoque',          label:'Visão geral',    href:'estoque.html',          icon:I.grid},
        {id:'estoque-gestao',   label:'Gestão de Estoque',href:'estoque-gestao.html', icon:I.bars, children:[
          {id:'estoque-saldo',           label:'Saldo de Estoque',          href:'estoque-saldo.html'},
          {id:'estoque-ruptura',         label:'Ruptura de Estoque',        href:'estoque-ruptura.html'},
          {id:'estoque-validade-curta',  label:'Produtos com Validade Curta',href:'estoque-validade-curta.html'},
          {id:'estoque-movimentacoes',   label:'Movimentações',              href:'estoque-movimentacoes.html'},
        ]},
        {id:'estoque-gestao-consignacao', label:'Gestão de Consignação',href:'estoque-gestao-consignacao.html', icon:I.server, children:[
          {id:'estoque-saldo-consignado',       label:'Saldo Consignado',                 href:'estoque-saldo-consignado.html'},
          {id:'estoque-contagem-saldo-nota',    label:'Contagem · Saldo por Nota',        href:'estoque-contagem-saldo-nota.html'},
          {id:'estoque-devolucoes-faturamento', label:'Devoluções Aguard. Aprovação',     href:'estoque-devolucoes-faturamento.html'},
          {id:'estoque-rastreabilidade',        label:'Rastreabilidade de Consignação',   href:'estoque-rastreabilidade.html'},
          {id:'estoque-gmroi',                  label:'GMROI',                            href:'estoque-gmroi.html'},
        ]},
        {id:'estoque-perdas',   label:'Análise de Perdas',href:'estoque-perdas.html', icon:I.brief},
        {id:'estoque-consignado-inventario', label:'InventarIA',href:'estoque-consignado-inventario.html', icon:I.server},
      ],
      auto:[],
      // O Vigia NAO e' submodulo de Gestao de Consignacao: ele nao mostra saldo,
      // ele DECIDE (regras + fila de aprovacao). Entra aqui como AGENTE da area,
      // no mesmo padrao do LICI na Licitacao (agente fora da arvore de modulos).
      agen:[{l:'Vigia de Consignação',h:'estoque-vigia.html'}],
      atal:[]
    },

    contabil: {
      label:'Contábil',
      nav:[
        {id:'contabil',              label:'Visão geral',          href:'contabil.html',              icon:I.grid},
        // RECORTE MSB (22/10/26): o Contábil da MSB tem só a Gestão de Custos
        // SG&A, recortada na empresa MSB. DRE e Margem de Contribuição do
        // portal completo não vieram (ver PAGINAS_FORA em api/shared/auth.js).
        {id:'contabil-custos-sgna',  label:'Gestão de Custos SG&A',href:'contabil-custos-sgna.html',  icon:I.dollar},
      ],
      auto:[],
      agen:[],
      atal:[]
    },

    licitacao: {
      label:'Licitação',
      nav:[
        {id:'licitacao',          label:'Visão geral',href:'licitacao.html',          icon:I.grid},
        {id:'licitacao-sr',       label:'Sales Report',href:'licitacao-sales-report.html', icon:I.bars, children:[
          {id:'licitacao-sales-report',           label:'Visão geral',               href:'licitacao-sales-report.html'},
          {id:'licitacao-performance-licitacoes', label:'Performance de Licitações',  href:'licitacao-performance-licitacoes.html'},
          {id:'licitacao-consignacao',            label:'Análise de Consignação',     href:'licitacao-consignacao.html'},
          {id:'licitacao-vendas',                 label:'Análise de Vendas',          href:'licitacao-vendas.html'},
          {id:'licitacao-analise-contratos',      label:'Análise de Contratos',       href:'licitacao-analise-contratos.html'},
        ]},
        {id:'licitacao-ng',       label:'Comitê de Produto',href:'licitacao-negociacoes.html', icon:I.brief, children:[
          {id:'licitacao-negociacoes',             label:'Visão geral', href:'licitacao-negociacoes.html'},
          {id:'licitacao-negociacoes-perdas',      label:'Perdas',      href:'licitacao-negociacoes-perdas.html'},
        ]},
        // Negociações (08/10/2026, era "Funil de Vendas"): UM módulo com
        // casa própria (licitacao-funil.html, um cartão por submódulo) e DOIS
        // submódulos. Funil de Captação (15/10/2026) = só o que entrou na
        // semana, pela data de criação, e dia a dia; Funil de Vendas = o que
        // entrou, foi ganho e foi perdido na semana (o antigo Funil Semanal),
        // com a aba Analítico (o que perdi e por quê, item a item; `also`: o
        // item fica aceso nas duas). O Funil de Conversão saiu do portal em
        // 15/10/2026, a pedido.
        {id:'licitacao-funil',    label:'Negociações',href:'licitacao-funil.html', icon:I.filter, children:[
          {id:'licitacao-funil-captacao',          label:'Funil de Captação',  href:'licitacao-funil-captacao.html'},
          {id:'licitacao-funil-semanal',           label:'Funil de Vendas',    href:'licitacao-funil-semanal.html', also:['licitacao-funil-semanal-analitico']},
        ]},
        {id:'licitacao-tabela-precos', label:'Tabela de Preços', href:'licitacao-tabela-precos.html', icon:I.dollar},
        {id:'licitacao-desempenho',    label:'Gestão de Desempenho', href:'licitacao-desempenho.html', icon:I.users},
      ],
      auto:[],
      // Sentinela: a casa (…-inicio) tem um cartão por análise — Plano de
      // Saldo, Contratos a Vencer, Vencidos e Gerenciamento de Adesões
      // LICI: p 'lici-' acende o agente também no Relatório de Editais
      // (lici-relatorio.html) — 'lici' puro casaria todo licitacao-*
      agen:[{l:'LICI · Análise de Editais',h:'lici.html',p:'lici-'},{l:'Sentinela de Atas e Contratos',h:'licitacao-sentinela-inicio.html',p:'licitacao-sentinela'}],
      atal:[{l:'PNCP',h:'https://pncp.gov.br/',e:true},{l:'Comprasnet',h:'https://compras.gov.br/',e:true}]
    },

    administrativo: {
      label:'Administrativo',
      nav:[
        {id:'administrativo',             label:'Visão geral',href:'administrativo.html',             icon:I.grid},
        {id:'administrativo-requisicoes', label:'Requisições',href:'administrativo-requisicoes.html', icon:I.tag},
        {id:'administrativo-lancamentos', label:'Lançamentos Administrativos',href:'administrativo-lancamentos.html', icon:I.file},
      ],
      // Requisições é o módulo do dia a dia; Pagamento de Comissão é a AUTOMAÇÃO
      // (calcula a comissão do mês no BI e dispara o e-mail de cada comissionado).
      // Lançamentos Administrativos (16/10/2026): lê a fatura (PDF/imagem) ou
      // recebe à mão e cria o diário de faturas no Dynamics — estilo PI.
      // Contratos/Compliance/Indicadores/Documentos eram maquetes e saíram do menu.
      auto:['Pagamento de Comissão'],
      agen:[],
      atal:[]
    },

    produtos: {
      label:'Produtos',
      nav:[
        {id:'produtos-fam-g',    label:'Estratégias & Famílias', href:'produtos-familias.html', icon:I.filter, children:[
          {id:'produtos-familias',                label:'Todas as Estratégias',  href:'produtos-familias.html'},
          {id:'produtos-estrategia-vascular',     label:'Vascular',              href:'produtos-estrategia-vascular.html'},
          {id:'produtos-estrategia-extracao',     label:'Extração',              href:'produtos-estrategia-extracao.html'},
          {id:'produtos-estrategia-seguranca',    label:'Segurança do Paciente', href:'produtos-estrategia-seguranca.html'},
          {id:'produtos-estrategia-recorrente',   label:'Venda Recorrente',      href:'produtos-estrategia-recorrente.html'},
          {id:'produtos-estrategia-coronario',    label:'Coronário',             href:'produtos-estrategia-coronario.html'},
          {id:'produtos-estrategia-urologia',     label:'Urologia',              href:'produtos-estrategia-urologia.html'},
        ]},
        {id:'produtos-cadastro', label:'Cadastro de Produto', href:'produtos-cadastro.html', icon:I.file},
      ],
      auto:[],
      agen:[],
      atal:[]
    },

    pessoas: {
      label:'Pessoas',
      nav:[
        {id:'pessoas',            label:'Visão geral',               href:'pessoas.html',           icon:I.grid},
        {id:'pessoas-recrutamento',label:'Recrutamento & Seleção',   href:'pessoas-recrutamento.html',icon:I.users},
        {id:'pessoas-trein-g',    label:'Treinamento & Desenvolvimento',href:'pessoas-treinamento.html',icon:I.monitor, children:[
          {id:'pessoas-treinamento',   label:'Visão geral',   href:'pessoas-treinamento.html'},
          {id:'pessoas-desenvolvimento',label:'Desenvolvimento',href:'pessoas-desenvolvimento.html'},
        ]},
        {id:'pessoas-clima',      label:'Clima Organizacional',     href:'pessoas-clima.html',      icon:I.users},
        {id:'pessoas-folha',      label:'Folha de Pagamento',       href:'pessoas-folha.html',      icon:I.dollar},
        {id:'pessoas-saude',      label:'Saúde & Segurança',        href:'pessoas-saude.html',      icon:I.shield},
        {id:'pessoas-beneficios', label:'Benefícios',               href:'pessoas-beneficios.html', icon:I.heart},
      ],
      auto:[],
      agen:[{l:'Agente de RH',h:'agente-rh.html'},{l:'Análise de Clima IA',h:'agente-rh.html'}],
      atal:[{l:'Flash · Ponto & DP',h:'https://hros.flashapp.com.br/',e:true},{l:'Feedz',h:'https://app.feedz.com.br/',e:true}]
    },

    qualidade: {
      label:'Qualidade',
      nav:[
        {id:'qualidade',                   label:'Visão geral',        href:'qualidade.html',                   icon:I.grid},
        {id:'qualidade-pops',              label:'POPs',               href:'qualidade-pops.html',              icon:I.book},
        {id:'qualidade-fornecedores',      label:'Fornecedores',       href:'qualidade-fornecedores.html',      icon:I.brief},
        {id:'qualidade-filiais',           label:'Condições das Filiais',href:'qualidade-filiais.html',         icon:I.shield},
      ],
      auto:[],
      agen:[],
      atal:[]
    },

    diretoria: {
      label:'Diretoria',
      nav:[
        {id:'diretoria',              label:'Visão geral',          href:'diretoria.html',              icon:I.grid},
        {id:'diretoria-votacao-okr',  label:'Votação OKR',          href:'diretoria-votacao-okr.html',  icon:I.check},
        {id:'diretoria-comissao',     label:'Pagamento de Comissão',href:'diretoria-comissao.html',     icon:I.dollar},
      ],
      // A área é RESERVADA desde 02/09/2026 (AREAS_RESERVADAS no
      // api/shared/auth.js): só os e-mails do dono do portal recebem
      // 'diretoria' no /api/my-areas, então para todo mundo mais o card, o
      // menu e a busca são podados e as páginas ficam bloqueadas.
      auto:[],
      agen:[],
      atal:[]
    },

    vendedor: {
      label:'Vendedor',
      nav:[
        // A visão geral é a "Minha carteira" (meta + Agir hoje/Oportunidades/
        // Clientes/Faturamento), no molde do protótipo de 30/09/2026.
        {id:'vendedor',            label:'Minha carteira', href:'vendedor.html',         icon:I.grid},
        // Os dois submódulos do Comercial são ABAS da mesma página (cada um
        // lê um modelo semântico diferente); o #hash abre direto na aba.
        {id:'vendedor-comercial',  label:'Comercial',   href:'vendedor-comercial.html',  icon:I.users, children:[
          {id:'vendedor-comercial',            label:'Sales Report',   href:'vendedor-comercial.html#salesreport'},
          {id:'vendedor-comercial-oportunidades', label:'Oportunidades', href:'vendedor-comercial.html#oportunidades'},
        ]},
        {id:'vendedor-licitacao',  label:'Licitação',   href:'vendedor-licitacao.html',  icon:I.file},
        {id:'vendedor-estoque',    label:'Estoque',     href:'vendedor-estoque.html',    icon:I.server},
        {id:'vendedor-financeiro', label:'Financeiro',  href:'vendedor-financeiro.html', icon:I.dollar},
      ],
      // Área nova (29/09/2026). Cada módulo lê o modelo semântico da SUA
      // área: Comercial (Sales Report + Oportunidades), Licitação, Estoque e
      // Financeiro — tudo recortado no vendedor logado (vendedor-bi.js).
      // RESERVADA como a Diretoria (AREAS_RESERVADAS do api/shared/auth.js)
      // até ser liberada para os grupos de vendas. O prefixo 'vendedor-' é
      // o que classifica as páginas: vendedor-comercial é da área Vendedor,
      // não do Comercial — ter o Comercial NÃO abre este módulo.
      // Os agentes são os do Comercial que o vendedor usa na rua (mesmas
      // páginas; link que a pessoa não pode abrir sai do menu no podar()).
      // PI · Cotação oculto para todos (07/10), como no Comercial; PI · Pedido
      // saiu da área em 14/10 a pedido do usuário (segue no Comercial).
      auto:[],
      agen:[{l:'Dossiê de Visita',h:'comercial-dossie-visita.html'}],
      atal:[{l:'Salesforce',h:'https://biomedical.lightning.force.com/lightning/page/home',e:true}]
    },

    gerencial: {
      label:'Gerencial',
      nav:[
        {id:'gerencial',              label:'Visão geral',  href:'gerencial.html',              icon:I.grid},
        // Indicadores: DOIS submódulos no mesmo motor (gerencial-indicadores.js):
        // Globais (a empresa inteira, com painel de análise) e Setoriais (cada
        // área). O pai abre o grupo; o href dele é o primeiro filho.
        {id:'gerencial-ind',          label:'Indicadores',  href:'gerencial-indicadores-globais.html',  icon:I.bars, children:[
          {id:'gerencial-indicadores-globais', label:'Globais',   href:'gerencial-indicadores-globais.html'},
          {id:'gerencial-indicadores',         label:'Setoriais', href:'gerencial-indicadores.html'},
        ]},
      ],
      // Área nova (06/10/2026): indicadores das pessoas e da gestão, com a
      // parametrização e as metas/resultados mês a mês na MESMA tela (o que
      // no Salesforce são o Indicador e os registros de Meta e Resultado).
      // PROTÓTIPO e RESERVADA (AREAS_RESERVADAS do api/shared/auth.js).
      auto:[],
      agen:[],
      atal:[{l:'Salesforce',h:'https://biomedical.lightning.force.com/lightning/page/home',e:true}]
    },

    // Canal de Atendimento (08/10/2026): o Customer Service, que era módulo do
    // Comercial, virou departamento. NÃO tem módulos nem visão geral de cards:
    // a casa da área (atendimento.html) JÁ É a tela do Customer Service, e a
    // Gestão de Casos (atendimento-casos.html) abre pelas abas dela — `also`
    // mantém o item aceso lá também. RESERVADA (AREAS_RESERVADAS do
    // api/shared/auth.js); os dados, só para a equipe (api/shared/cs-motor.js).
    atendimento: {
      label:'Canal de Atendimento',
      nav:[
        {id:'atendimento',            label:'Customer Service', href:'atendimento.html',         icon:I.headset, also:['atendimento-casos']},
      ],
      auto:[],
      agen:[],
      atal:[]
    },

    // Compras (14/10/2026): área nova, INDISPONÍVEL — por enquanto só a visão
    // geral, com informações avulsas e os módulos previstos (sem página). É
    // RESERVA ESTRITA no api/shared/auth.js: só as contas do dono, nem o
    // acesso full entra. Os atalhos são módulos de outras áreas ligados a
    // compras; quem não pode abrir algum deles não vê o link (podar()).
    compras: {
      label:'Compras',
      nav:[
        {id:'compras',                label:'Visão geral',  href:'compras.html',                icon:I.grid},
      ],
      auto:[],
      agen:[],
      atal:[{l:'Requisições (D365)',h:'administrativo-requisicoes.html'},{l:'Fornecedores · Qualidade',h:'qualidade-fornecedores.html'},{l:'Ruptura de Estoque',h:'estoque-ruptura.html'},{l:'Validade Curta',h:'estoque-validade-curta.html'}]
    }
  };

  /* ── Dept detection from filename ───────────────────────────── */
  function detectDept(pid) {
    if (!pid) return null;
    const map = [
      [/^comercial/,      'comercial'],
      // Agentes PI do Comercial (Pedido, Consignação, Consignação incompleto, Cotação):
      // herdam o menu lateral completo do Comercial (submódulos + agentes).
      [/^pedido-inteligente|^pi-pedido-teste|^pi-consignacao|^pi-cotacao/, 'comercial'],
      [/^financeiro|^cobranca-automatica|^cobranca-notas/, 'financeiro'],
      [/^ti/,             'ti'],
      [/^logistica/,      'logistica'],
      [/^marketing/,      'marketing'],
      [/^estoque/,        'estoque'],
      [/^contabil/,       'contabil'],
      [/^licitacao/,      'licitacao'],
      [/^lici(\.|-|$)/,   'licitacao'],
      [/^administrativo/, 'administrativo'],
      [/^produtos/,       'produtos'],
      [/^pessoas/,        'pessoas'],
      [/^qualidade/,      'qualidade'],
      [/^diretoria/,      'diretoria'],
      [/^vendedor/,       'vendedor'],
      [/^gerencial/,      'gerencial'],
      [/^atendimento/,    'atendimento'],
      [/^compras/,        'compras'],
      [/^agente-comercial/,      'comercial'],
      [/^agente-financeiro/,     'financeiro'],
      [/^agente-ti/,             'ti'],
      [/^agente-logistica/,      'logistica'],
      [/^agente-marketing/,      'marketing'],
      [/^agente-estoque/,        'estoque'],
      [/^agente-contabil/,       'contabil'],
      [/^agente-licitacao/,      'licitacao'],
      [/^agente-administrativo/, 'administrativo'],
      [/^agente-produtos/,       'produtos'],
      [/^agente-rh/,             'pessoas'],
      [/^agente-qualidade/,      'qualidade'],
    ];
    for (const [re, d] of map) { if (re.test(pid)) return d; }
    return null;
  }

  /* ── Build sidebar HTML ─────────────────────────────────────── */
  function buildSidebar(cfg, pageId, deptId) {
    let navHtml = '<div class="sb-section">Navegação</div>';

    function isActive(id) { return id === pageId; }
    // item ou submódulo com mais de uma página (abas): `also` = os ids das outras
    function childActive(c) { return isActive(c.id) || (c.also || []).some(isActive); }
    function groupHasActive(item) {
      return item.children && item.children.some(childActive);
    }

    for (const item of cfg.nav) {
      if (item.children) {
        const pActive = isActive(item.id) || isActive(item.href.replace('.html',''));
        const cActive = groupHasActive(item);
        const open    = pActive || cActive;
        const children = item.children.map(c => {
          const cls = childActive(c) ? ' class="active"' : '';
          return `<a href="${c.href}"${cls}><span class="sb-lbl">${c.label}</span></a>`;
        }).join('');
        navHtml += `<div class="sb-group${open?' open':''}">
          <button type="button" class="sb-parent" title="${item.label}">${item.icon}<span class="sb-lbl">${item.label}</span>${I.caret}</button>
          <div class="sb-children">${children}</div>
        </div>`;
      } else {
        const cls = childActive(item) ? ' class="active"' : '';
        navHtml += `<a href="${item.href}"${cls} title="${item.label}">${item.icon}<span class="sb-lbl">${item.label}</span></a>`;
      }
    }

    // AUTOMAÇÕES
    if (cfg.auto && cfg.auto.length) {
      const autoIcons = [I.zap,
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>'
      ];
      navHtml += '<div class="sb-divider"></div><div class="sb-section">AUTOMAÇÕES</div>';
      const AUTO_HREF = { 'Automação de Cotações':'comercial-automacao-cotacoes.html', 'Cobrança Automática':'cobranca-automatica.html', 'Cobrança · Notas em Aberto':'cobranca-notas.html', 'Pagamento de Comissão':'administrativo-comissao.html', 'Cotação de Frete':'logistica-cotacao-frete.html' };
      cfg.auto.forEach((a, i) => {
        const href = AUTO_HREF[a] || '#';
        const cls = isActive(href.replace('.html','')) ? ' class="active"' : '';
        navHtml += `<a href="${href}"${cls} title="${a}">${autoIcons[i % autoIcons.length]}<span class="sb-lbl">${a}</span></a>`;
      });
    }

    // AGENTES
    if (cfg.agen && cfg.agen.length) {
      navHtml += '<div class="sb-divider"></div><div class="sb-section">AGENTES</div>';
      cfg.agen.forEach(a => {
        // p = prefixo das páginas do agente (fica aceso em todas elas)
        const cls = (isActive(a.h.replace('.html','')) || (a.p && String(pageId || '').indexOf(a.p) === 0)) ? ' class="active"' : '';
        navHtml += `<a href="${a.h}"${cls} title="${a.l}">${I.bot}<span class="sb-lbl">${a.l}</span><span class="sb-badge sb-badge-ia">IA</span></a>`;
      });
    }

    // ATALHOS
    if (cfg.atal && cfg.atal.length) {
      navHtml += '<div class="sb-divider"></div><div class="sb-section">Atalhos</div>';
      cfg.atal.forEach(a => {
        const extA = a.e ? ' target="_blank" rel="noopener"' : '';
        const badge = a.badge ? `<span class="sb-badge" style="margin-left:auto;">${a.badge}</span>` : '';
        navHtml += `<a href="${a.h}"${extA} title="${a.l}">${I.ext}<span class="sb-lbl">${a.l}</span>${badge}</a>`;
      });
    }

    // Rodapé só com a pessoa (sem botão de sair): o logout fica no menu do
    // avatar, no canto superior direito (portal-motion.js), e na aba Perfil
    // do celular (perfil-sheet.js) — no celular o avatar do cabeçalho some.
    return `<div class="sb-head">
      <span class="sb-ic">${DEPT_ICON[deptId]||''}</span>
      <div class="sb-id"><div class="sb-tt">${cfg.label}</div><div class="sb-st">Departamento</div></div>
      <button type="button" class="sb-toggle" id="sb-toggle" title="Recolher menu" aria-label="Recolher menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <button type="button" class="sb-close" id="sb-close" title="Fechar menu" aria-label="Fechar menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <nav>${navHtml}</nav>
    <a href="../index.html" class="sb-back-in" title="Voltar ao portal">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M11 18l-6-6 6-6"/></svg>
      <span class="sb-lbl">Voltar ao portal</span>
    </a>
    <div class="sb-user-footer" id="sb-user-footer">
      <div class="sb-user-row">
        <div class="sb-user-avatar" id="sb-avatar">?</div>
        <div class="sb-user-info">
          <div class="sb-user-name" id="sb-username">Carregando…</div>
          <div class="sb-user-email" id="sb-email"></div>
        </div>
      </div>
    </div>`;
  }

  /* ── Main: detect page + inject sidebar ─────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    const aside = document.querySelector('.area-sidebar');
    if (!aside) return;

    const pid     = location.pathname.split('/').pop().replace(/\.html$/i, '') || '';
    const deptId  = detectDept(pid);
    if (!deptId || !NAV[deptId]) return;

    const sbCard = aside.querySelector('.sb-card');
    if (!sbCard) return;

    sbCard.innerHTML = buildSidebar(NAV[deptId], pid, deptId);
    // tira do menu o que a pessoa nao pode abrir (grant por MODULO avulso)
    if (typeof window.bmPodarNavegacao === 'function') window.bmPodarNavegacao();

    /* ── ALERTA do Vigia de Consignacao no menu ────────────────────
       Contador de itens PENDENTES no proprio item de menu. So roda se o
       link existir na sidebar (ou seja: e' Estoque e a pessoa pode abrir).
       Usa /api/consig-vigia-fila?resumo=1 — so os contadores, nunca a fila
       inteira, que carrega carteira e valor por cliente.
       Cache em sessionStorage (10 min) para nao bater na API a cada pagina. */
    window.bmVigiaBadge = (function () {
      var KEY = 'bm-vigia-resumo-v1', TTL = 10 * 60 * 1000;
      function pintar(r) {
        var a = document.querySelector('.area-sidebar nav a[href$="estoque-vigia.html"]');
        if (!a || !r || !r.configured) return;
        var b = a.querySelector('.sb-vigia');
        // o item ja' carrega o selo "IA" (secao AGENTES). Com contador, o selo
        // sai de cena: em 248px de sidebar dois pills comem o rotulo inteiro.
        var ia = a.querySelector('.sb-badge-ia');
        if (!r.pendentes) { if (b) b.remove(); if (ia) ia.style.display = ''; return; }
        if (ia) ia.style.display = 'none';
        if (!b) { b = document.createElement('span'); b.className = 'sb-badge sb-vigia'; b.style.marginLeft = 'auto'; a.appendChild(b); }
        var urgente = r.vencidos > 0;
        b.textContent = r.pendentes > 99 ? '99+' : String(r.pendentes);
        b.style.background = urgente ? '#DC2626' : '#F59E0B';
        b.style.color = '#fff';
        a.title = r.pendentes + ' item(ns) aguardando decisao'
                + (r.vencidos ? ' · ' + r.vencidos + ' ja vencido(s) no cliente' : '');
      }
      function ler() { try { var c = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return (c && Date.now() - c.em < TTL) ? c.r : null; } catch (e) { return null; } }
      return function (forcar) {
        if (!document.querySelector('.area-sidebar nav a[href$="estoque-vigia.html"]')) return;
        var c = forcar ? null : ler();
        if (c) { pintar(c); return; }
        fetch('/api/consig-vigia-fila?resumo=1')
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) {
            if (!j || !j.ok) return;
            try { sessionStorage.setItem(KEY, JSON.stringify({ em: Date.now(), r: j })); } catch (e) {}
            pintar(j);
          })
          .catch(function () {});   // alerta e' enfeite: falhar aqui nao pode quebrar o menu
      };
    })();
    window.bmVigiaBadge();

    /* ── Recolher/expandir a sidebar (248px ↔ 64px) ───────────────
       Estado persistido em localStorage. Em telas estreitas (<1100px)
       inicia recolhida por padrão. Só vale no desktop (>980px); em
       tablet/mobile a sidebar tem comportamento próprio. */
    (function () {
      var KEY = 'bm-sidebar-expanded-v1';
      function isDesktop() { return window.matchMedia('(min-width: 981px)').matches; }
      function apply(expanded) {
        document.body.classList.toggle('sb-collapsed', !expanded);
        var t = document.getElementById('sb-toggle');
        if (t) t.title = expanded ? 'Recolher menu' : 'Expandir menu';
      }
      var saved = null;
      try { saved = localStorage.getItem(KEY); } catch (e) {}
      var expanded;
      if (saved !== null) expanded = (saved === '1');
      else expanded = window.matchMedia('(min-width: 1100px)').matches; // notebooks estreitos iniciam recolhidos
      apply(expanded);

      var toggle = document.getElementById('sb-toggle');
      if (toggle) toggle.addEventListener('click', function () {
        expanded = !expanded;
        apply(expanded);
        try { localStorage.setItem(KEY, expanded ? '1' : '0'); } catch (e) {}
      });
    })();

    /* ── App shell (Claude Design): sidebar full-height à esquerda +
       main com scroll próprio. Reparenta hero/corpo/rodapé para dentro
       de <main class="dept-main"> e a sidebar para <div class="dept-shell">.
       Só roda nas páginas de departamento (deptId detectado). ── */
    (function buildShell() {
      if (document.querySelector('.dept-shell')) return;
      const header = document.querySelector('.site-header');
      const hero   = document.querySelector('.area-header');
      const abody  = document.querySelector('.area-body');
      const footer = document.querySelector('.site-footer');
      if (!abody) return;

      const shell = document.createElement('div');
      shell.className = 'dept-shell';
      const main = document.createElement('main');
      main.className = 'dept-main';

      if (hero)   main.appendChild(hero);
      main.appendChild(abody);
      if (footer) main.appendChild(footer);

      shell.appendChild(aside);   // sai do .area-grid e vira coluna própria
      shell.appendChild(main);
      if (header && header.parentNode === document.body) {
        document.body.insertBefore(shell, header.nextSibling);
      } else {
        document.body.insertBefore(shell, document.body.firstChild);
      }
      document.body.classList.add('dshell');
      if (pid === deptId) document.body.classList.add('dept-home');
    })();

    /* ── Header global: pill "Áreas" ativa nas páginas de departamento ── */
    document.querySelectorAll('.site-header .header-nav a').forEach(function (a) {
      if (/#areas$/.test(a.getAttribute('href') || '')) a.classList.add('active');
    });

    /* ── Ícone do departamento no hero (mobile + desktop, Claude Design) ── */
    (function () {
      const top = document.querySelector('.area-header .area-header-top');
      if (top && !top.querySelector('.area-hero-ic')) {
        const ic = document.createElement('div');
        ic.className = 'area-hero-ic';
        ic.innerHTML = DEPT_ICON[deptId] || '';
        top.insertBefore(ic, top.firstChild);
      }
    })();

    /* ── Pills do hero na home do departamento: "N módulos" + "N agentes IA"
       (Claude Design). Conta os cards de módulo e os links da seção AGENTES. ── */
    (function () {
      if (!document.body.classList.contains('dept-home')) return;
      const top = document.querySelector('.area-header .area-header-top');
      if (!top || top.querySelector('.dv-hero-pills')) return;
      const nMod = document.querySelectorAll('.modulos-grid .modulo-card').length;
      let nAg = 0;
      document.querySelectorAll('.sb-card .sb-section').forEach(function (s) {
        if (!/agentes/i.test(s.textContent)) return;
        let el = s.nextElementSibling;
        while (el && !el.classList.contains('sb-section') && !el.classList.contains('sb-divider')) {
          if (el.tagName === 'A') nAg++;
          el = el.nextElementSibling;
        }
      });
      if (!nMod && !nAg) return;
      const MON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
      const pills = document.createElement('div');
      pills.className = 'dv-hero-pills';
      pills.innerHTML =
        (nMod ? '<span class="dv-hero-pill">' + MON + nMod + (nMod === 1 ? ' módulo' : ' módulos') + '</span>' : '') +
        (nAg ? '<span class="dv-hero-pill"><span class="dv-dot"></span>' + nAg + (nAg === 1 ? ' agente IA' : ' agentes IA') + '</span>' : '');
      top.appendChild(pills);
    })();

    injectSubstrip(pid + '.html');

    /* ── Mobile (<768px): drawer + app bar + tab bar (Claude Design) ── */
    (function mobileChrome() {
      // overlay do drawer
      let overlay = document.querySelector('.sb-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'sb-overlay';
        document.body.appendChild(overlay);
      }
      function setDrawer(open) {
        aside.classList.toggle('sb-open', open);
        document.body.classList.toggle('sb-drawer-open', open);
        if (burger) burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      // botão hambúrguer no app bar (só visível no mobile via CSS)
      const hcont = document.querySelector('.site-header .container');
      let burger = hcont ? hcont.querySelector('.hd-burger') : null;
      if (hcont && !burger) {
        burger = document.createElement('button');
        burger.type = 'button';
        burger.className = 'hd-burger';
        burger.setAttribute('aria-label', 'Abrir menu do departamento');
        burger.setAttribute('aria-expanded', 'false');
        burger.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';
        hcont.insertBefore(burger, hcont.firstChild);
      }
      if (burger) burger.addEventListener('click', function () { setDrawer(!aside.classList.contains('sb-open')); });
      overlay.addEventListener('click', function () { setDrawer(false); });
      const closeBtn = document.getElementById('sb-close');
      if (closeBtn) closeBtn.addEventListener('click', function () { setDrawer(false); });
      // fecha ao navegar (links; os botões de grupo continuam abrindo submenu)
      aside.addEventListener('click', function (e) {
        if (e.target.closest('a')) setDrawer(false);
      });

      // tab bar inferior (Início · Áreas · Sistemas · Avisos)
      if (!document.querySelector('.bm-tabbar')) {
        const tb = document.createElement('nav');
        tb.className = 'bm-tabbar';
        tb.setAttribute('aria-label', 'Navegação do portal');
        tb.innerHTML =
          '<a href="../index.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg><span>Início</span></a>' +
          '<a href="../index.html#areas" class="active"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg><span>Áreas</span></a>' +
          '<a href="../index.html#sistemas"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg><span>Sistemas</span></a>' +
          '<a href="../index.html#avisos"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg><span>Avisos</span></a>';
        document.body.appendChild(tb);
      }
    })();

    // Re-attach group toggle handlers
    sbCard.querySelectorAll('.sb-parent').forEach(btn => {
      btn.addEventListener('click', function () {
        this.closest('.sb-group').classList.toggle('open');
      });
    });

    // Função global para preencher usuário após MSAL autenticar.
    // Iniciais = 1º e último nome, as mesmas do avatar do cabeçalho
    // (antes eram as duas primeiras palavras: "Leonardo Said Barbosa" dava LS
    // aqui e LB lá em cima). A foto do Azure AD, quando há, cobre as iniciais
    // pelo CSS do auth.js.
    window.setSidebarUser = function(name, email) {
      const p = String(name || '').trim().split(/\s+/).filter(Boolean);
      const initials = ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
      const elN = document.getElementById('sb-username');
      const elE = document.getElementById('sb-email');
      const elA = document.getElementById('sb-avatar');
      if (elN) elN.textContent = name || 'Usuário';
      if (elE) elE.textContent = email || '';
      if (elA) elA.textContent = initials;
    };
  });

  // ── Faixa de sub-módulos (estilo Comercial) — injetada no topo da área principal ──
  function injectSubstrip(file){
    file = String(file||'').toLowerCase();
    const GRID  = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>';
    const BOX   = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';
    const ALERT = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    const CLOCK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    const TRUCK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>';
    const UNDO  = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
    const SEARCH= '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    const DOLLAR= '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>';
    const CHECK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    const FILE  = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>';
    const ARROW ='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
    const GROUPS = {
      'Gestão de Estoque': [
        {f:'estoque-gestao.html',         n:'Visão Geral',                 d:'Sub-módulos da gestão de estoque.', tone:'receber', svg:GRID},
        {f:'estoque-saldo.html',          n:'Saldo de Estoque',            d:'Posição, giro, lotes e validades.', tone:'dre',     svg:BOX},
        {f:'estoque-ruptura.html',        n:'Ruptura de Estoque',          d:'Itens em ruptura e valor de ruptura.', tone:'inadim', svg:ALERT},
        {f:'estoque-validade-curta.html', n:'Produtos com Validade Curta', d:'Lotes próximos do vencimento.',     tone:'pagar',   svg:CLOCK},
        {f:'estoque-movimentacoes.html',  n:'Movimentações',               d:'Consulta analítica das movimentações.', tone:'dre', svg:SEARCH}
      ],
      'Contas a Receber': [
        {f:'financeiro-contas-receber.html', n:'Visão Geral',                 d:'Resumo consolidado de contas a receber.',   tone:'receber', svg:GRID},
        {f:'financeiro-inadimplencia.html',  n:'Inadimplência',               d:'Vencidos, em aberto e faixas de atraso.',   tone:'inadim',  svg:DOLLAR},
        {f:'financeiro-baixas-cliente.html', n:'Baixas por cliente',          d:'Recebimentos e baixas de títulos.',         tone:'dre',     svg:CHECK},
        {f:'financeiro-detalhamento-nf.html',n:'Detalhamento de nota fiscal', d:'Notas fiscais e faturamento por NF.',       tone:'pagar',   svg:FILE}
      ],
      'Gestão de Consignação': [
        {f:'estoque-gestao-consignacao.html',  n:'Visão Geral',                   d:'Sub-módulos da gestão de consignação.',          tone:'receber', svg:GRID},
        {f:'estoque-saldo-consignado.html',    n:'Saldo Consignado',              d:'Materiais consignados em campo por cliente.',    tone:'dre',     svg:TRUCK},
        {f:'estoque-contagem-saldo-nota.html', n:'Contagem · Saldo por Nota',      d:'Saldo por nota com a última contagem do depósito.', tone:'receber', svg:CHECK},
        {f:'estoque-devolucoes-faturamento.html', n:'Devoluções Aguard. Aprovação', d:'Devoluções de consignado pendentes de aprovação.', tone:'pagar', svg:UNDO},
        {f:'estoque-rastreabilidade.html',     n:'Rastreabilidade de Consignação', d:'Rastreio de lotes e movimentações.',            tone:'inadim',  svg:SEARCH},
        {f:'estoque-gmroi.html',               n:'GMROI',                          d:'Retorno da margem sobre o estoque consignado.', tone:'dre',     svg:CHECK}
      ]
    };
    let groupName=null, items=null;
    for (const g in GROUPS){ if (GROUPS[g].some(i=>i.f===file)){ groupName=g; items=GROUPS[g]; break; } }
    if (!items) return;
    const main = document.querySelector('.area-main'); if (!main) return;
    const cards = items.map(i=>{
      const cur = i.f===file;
      const st = 'min-height:0;padding:16px 18px;' + (cur?'pointer-events:none;border:1.5px solid var(--bm-blue-600);background:var(--bm-blue-50);':'');
      return '<a href="'+i.f+'" class="modulo-card" data-tone="'+i.tone+'" style="'+st+'">'
        + '<div class="mc-top"><span class="mc-icon">'+i.svg+'</span></div>'
        + '<div class="mc-name" style="font-size:13.5px;">'+i.n+'</div>'
        + '<div class="mc-desc">'+i.d+'</div>'
        + '<div class="mc-open" style="font-size:12px;">'+(cur?'Você está aqui':'Ver')+' '+ARROW+'</div></a>';
    }).join('');
    const sec = document.createElement('section');
    sec.style.cssText = 'padding:24px 0 0;';
    sec.innerHTML = '<div class="container"><div class="fin-subhead" style="margin-bottom:16px;"><h2 style="font-size:18px;">Sub-módulos · '+groupName+'</h2><span class="sub">Selecione um módulo</span></div>'
      + '<div class="modulos-grid" style="grid-template-columns:repeat(4,1fr);gap:12px;">'+cards+'</div></div>';
    main.insertBefore(sec, main.firstChild);
  }

  /* ── Mobile (≤640px): tabelas roláveis + grids largas em 1 coluna ──
     Roda APENAS no celular. No desktop/tablet nada é alterado. ── */
  function isPhone(){ return window.matchMedia('(max-width: 640px)').matches; }

  const KNOWN_TBL_WRAP = /(^|\s)(table-wrap|av-tbl-wrap|sr-tbl-wrap|fn-tbl-wrap|cx-tbl-wrap|tbl-wrap)(\s|$)/;

  function enhanceMobileTables(){
    if (!isPhone()) return;
    document.querySelectorAll('table').forEach(function(t){
      const p = t.parentElement;
      if (!p || p.classList.contains('mtbl-scroll')) return;
      if (KNOWN_TBL_WRAP.test(p.className)) {
        p.style.overflowX = 'auto';
        p.style.WebkitOverflowScrolling = 'touch';
        return;
      }
      const w = document.createElement('div');
      w.className = 'mtbl-scroll';
      p.insertBefore(w, t);
      w.appendChild(t);
    });
  }

  function collapseWideGridsMobile(){
    if (!isPhone()) return;
    document.querySelectorAll('section, div, ul, ol').forEach(function(el){
      if (el.closest('.area-sidebar, .site-header, .site-footer, #cp-widget, .modulo-card')) return;
      const cs = window.getComputedStyle(el);
      if (cs.display !== 'grid') return;
      // layouts intencionais por áreas (ex.: card compacto) não são colapsados
      if (cs.gridTemplateAreas && cs.gridTemplateAreas !== 'none') return;
      const tmpl = cs.gridTemplateColumns;
      if (!tmpl || tmpl === 'none') return;
      // nº de trilhas de coluna que o navegador resolveu
      const cols = tmpl.split(' ').filter(Boolean).length;
      if (cols >= 3) {
        el.dataset.mforce = '1';
        el.style.gridTemplateColumns = '1fr';
      }
    });
  }

  // ── Card de filtros INTEIRO recolhido atrás de "Filtros" (padrão único) ──
  // Junta período (Mês/Ano/Tri/Sem) + dropdowns + botões num só colapso.
  const FLT_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>';
  const FLT_CARET = '<svg class="flt-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

  const PERIOD_BTN_SEL = '.av-btn, .sr-btn, .fn-btn, .pv-btn, .cx-fbtn';
  const PERIOD_ROW_SEL = '.av-row, .sr-row, .fn-row-f, .pv-row, .cx-prow';
  const PERIOD_LBL_SEL = '.av-label, .sr-label, .fn-label, .pv-label, .cx-plabel';

  // assinatura do estado dos botões de período (p/ re-sincronizar os selects)
  function periodSig(body){
    return Array.prototype.map.call(body.querySelectorAll(PERIOD_BTN_SEL), function(b){
      return b.textContent.trim() + (b.className.indexOf('active') >= 0 ? '*' : '');
    }).join('|');
  }

  function inferPeriodLabel(btns){
    const t = ((btns[1] || btns[0]).textContent || '').trim();
    if (/sem/i.test(t)) return 'Semestre';
    if (/tri/i.test(t)) return 'Trimestre';
    if (/^\d{4}$/.test(t)) return 'Ano';
    if (/^(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|todos)/i.test(t)) return 'Mês';
    return 'Período';
  }

  // Converte as fileiras de chips (Mês/Ano/Tri/Sem/Empresa...) em LISTAS
  // SUSPENSAS — uma linha "Rótulo [select]" por grupo. O select aciona o
  // clique do botão original correspondente (a lógica da página não muda).
  function buildPeriodSelects(card, body){
    const rows = Array.prototype.filter.call(body.querySelectorAll(PERIOD_ROW_SEL), function(r){
      // Barra de SLICERS (#av-toolbar-filtros e afins) tem classe .av-row mas
      // não é faixa de período: os chips são dropdowns .av-dd. Convertê-la em
      // <select> marcava a barra com [data-fltp-hidden] e ESCONDIA todos os
      // filtros de modelo no celular, deixando só um select "Período" falso
      // com o botão Limpar dentro.
      if (r.querySelector('.av-dd')) return false;
      return r.querySelector(PERIOD_BTN_SEL);
    });
    if (!rows.length) return;
    // só linhas de topo (fn tem linhas aninhadas)
    const topRows = rows.filter(function(r){
      return !rows.some(function(o){ return o !== r && o.contains(r); });
    });
    const groups = [];
    topRows.forEach(function(row){
      let g = null;
      (function walk(el){
        Array.prototype.forEach.call(el.children, function(c){
          if (c.matches && c.matches(PERIOD_LBL_SEL)) { g = { label: c.textContent.trim(), btns: [] }; groups.push(g); }
          else if (c.matches && c.matches(PERIOD_BTN_SEL)) { if (!g) { g = { label: '', btns: [] }; groups.push(g); } g.btns.push(c); }
          else if (/divider/.test(c.className || '')) { g = null; }
          else if (c.children && c.children.length) walk(c);
        });
      })(row);
      row.setAttribute('data-fltp-hidden', '1');
    });
    body.querySelectorAll('.fltp-row').forEach(function(x){ x.remove(); });
    const frag = document.createDocumentFragment();
    groups.forEach(function(g){
      if (!g.btns.length) return;
      if (!g.label) g.label = inferPeriodLabel(g.btns);
      const wrap = document.createElement('label'); wrap.className = 'fltp-row';
      const sp = document.createElement('span'); sp.className = 'fltp-l'; sp.textContent = g.label;
      const sel = document.createElement('select'); sel.className = 'fltp-select';
      g.btns.forEach(function(b, i){
        const o = document.createElement('option');
        o.value = String(i); o.textContent = b.textContent.trim();
        if (/(^|\s)active(-green)?(\s|$)/.test(b.className)) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function(){ const b = g.btns[+sel.value]; if (b) b.click(); });
      wrap.appendChild(sp); wrap.appendChild(sel);
      frag.appendChild(wrap);
    });
    body.insertBefore(frag, body.firstChild);
    card.dataset.fltpSig = periodSig(body);
  }

  function collapseFilterCard(card){
    if (card.querySelector(':scope > .fltc-body')) { card.dataset.fltCard = '1'; return; }
    card.dataset.fltCard = '1';
    // desfaz colapsos internos anteriores (toolbar já recolhida) e impede novos
    card.querySelectorAll('.flt-toggle').forEach(function(b){ b.remove(); });
    card.querySelectorAll('.flt-collapsed').forEach(function(t){ t.classList.remove('flt-collapsed'); });
    card.querySelectorAll('.av-toolbar, .fca-toolbar, #av-toolbar-filtros, #cx-toolbar').forEach(function(t){ t.dataset.fltInit = '1'; });

    const body = document.createElement('div');
    body.className = 'fltc-body flt-collapsed';
    while (card.firstChild) body.appendChild(card.firstChild);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'flt-toggle fltc-toggle';
    btn.innerHTML = '<span class="flt-l">' + FLT_ICON + 'Filtros</span>' + FLT_CARET;
    btn.addEventListener('click', function(){
      const collapsed = body.classList.toggle('flt-collapsed');
      btn.classList.toggle('open', !collapsed);
    });
    card.appendChild(btn);
    card.appendChild(body);
    try { buildPeriodSelects(card, body); } catch(e){}
  }

  function setupMobileFilterCards(){
    if (!isPhone()) return;
    document.querySelectorAll('.av-row, .sr-row, .fn-row-f, .pv-row, .cx-period').forEach(function(r){
      // Período dentro de um dropdown próprio (.fxdd-panel do Sales Report):
      // esse layout já trata o mobile por CSS (empilha + accordion). Não
      // desmontar seus botões em <select> — quebrava o dropdown no celular.
      // (Barras antigas sem .fxdd — ex.: Funil com .fn-row-f — seguem no card.)
      if (r.closest('.fxdd-panel')) return;
      // só linhas com botões de filtro/período de verdade
      const isPeriod = r.classList.contains('cx-period')
        || r.querySelector('.av-btn, .sr-btn, .fn-btn, .pv-btn, .cx-fbtn');
      if (!isPeriod) return;
      // acha o card que embrulha os filtros (com classe conhecida ou não)
      let card = r.closest('.av-card, .fn-card, .pv-card, .cx-card, .ng-card, .sr-card');
      if (!card) {
        card = r.parentElement;
        // sobe por linhas aninhadas E pelo corpo já criado (trava a recursão)
        while (card && (/(^|\s)(av-row|sr-row|fn-row-f|pv-row)(\s|$)/.test(card.className)
          || (card.classList && card.classList.contains('fltc-body')))) card = card.parentElement;
      }
      if (!card || card.dataset.fltCard) return;
      // segurança: não colapsa containers com conteúdo além de filtros
      if (card.querySelector('canvas, table')) return;
      collapseFilterCard(card);
    });
    // re-sincroniza os selects quando a página recria/atualiza os botões
    document.querySelectorAll('[data-flt-card]').forEach(function(card){
      const body = card.querySelector(':scope > .fltc-body');
      if (!body) return;
      if (card.dataset.fltpSig !== periodSig(body)) {
        try { buildPeriodSelects(card, body); } catch(e){}
      }
    });
  }

  // Filtros recolhíveis: 8+ dropdowns empilhados ocupam meia tela no celular.
  // No mobile escondemos a toolbar atrás de um botão "Filtros" (com contador).
  function setupMobileFilters(){
    if (!isPhone()) return;
    document.querySelectorAll('.av-toolbar, .fca-toolbar, #av-toolbar-filtros, #cx-toolbar').forEach(function(tb){
      if (tb.dataset.fltInit) return;

      // dropdowns (.av-dd) sempre recolhem; sem dropdowns, só recolhe
      // barras realmente altas. Toolbar ainda vazia (conteúdo chega após o
      // login Power BI) fica sem decisão — reavaliada nas próximas passadas.
      const hasDD = !!tb.querySelector('.av-dd');
      if (!hasDD) {
        if (!tb.children.length) return;               // vazia: decide depois
        if (tb.offsetHeight && tb.offsetHeight < 90) { tb.dataset.fltInit = '1'; return; }
      }
      tb.dataset.fltInit = '1';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'flt-toggle';
      btn.innerHTML =
        '<span class="flt-l">'
        + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>'
        + 'Filtros</span>'
        + '<span class="flt-badge" style="display:none">0</span>'
        + '<svg class="flt-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      tb.parentNode.insertBefore(btn, tb);
      tb.classList.add('flt-collapsed');

      function updateBadge(){
        const n = tb.querySelectorAll('.av-dd-btn.has').length;
        const badge = btn.querySelector('.flt-badge');
        if (n > 0) { badge.style.display = 'inline-block'; badge.textContent = n; }
        else { badge.style.display = 'none'; }
      }
      btn.addEventListener('click', function(){
        const collapsed = tb.classList.toggle('flt-collapsed');
        btn.classList.toggle('open', !collapsed);
      });
      // atualiza o contador conforme o usuário marca/desmarca filtros
      tb.addEventListener('click', function(){ setTimeout(updateBadge, 0); });
      updateBadge();
    });
  }

  // Gráficos (Chart.js): normaliza a altura do container para tamanho de
  // celular — cobre TODOS os módulos/submódulos, inclusive wrappers próprios
  // de cada página (.av-cw, .ng-cw, divs com height inline etc.).
  // Gráficos altos (listas horizontais top-N) ficam com 320px; demais 235px.
  // Sparklines/miniaturas (menos de 160px) não são tocadas.
  function tuneMobileCharts(){
    if (!isPhone()) return;
    document.querySelectorAll('canvas').forEach(function(cv){
      const p = cv.parentElement;
      if (!p || p.dataset.mchart) return;
      if (p.closest('#cp-widget, .site-header, .site-footer')) return;
      const h = p.getBoundingClientRect().height;
      if (!h || h < 160) return;
      p.dataset.mchart = '1';
      if (window.getComputedStyle(p).position === 'static') p.style.position = 'relative';
      p.style.setProperty('height', (h >= 330 ? 320 : 235) + 'px', 'important');
      p.style.setProperty('min-height', '0', 'important');
      p.style.maxWidth = '100%';
    });
  }

  function runMobileEnhancements(){
    try { enhanceMobileTables(); } catch(e){}
    try { collapseWideGridsMobile(); } catch(e){}
    try { setupMobileFilterCards(); } catch(e){}
    try { setupMobileFilters(); } catch(e){}
    try { tuneMobileCharts(); } catch(e){}
  }

  function scheduleMobileEnhancements(){
    runMobileEnhancements();
    // conteúdo carregado de forma assíncrona (gráficos/tabelas via fetch)
    setTimeout(runMobileEnhancements, 700);
    setTimeout(runMobileEnhancements, 2000);
    // gráficos/filtros do Power BI chegam depois do login/queries — revisita por 30s
    if (isPhone()) {
      const iv = setInterval(function(){ try { tuneMobileCharts(); enhanceMobileTables(); setupMobileFilterCards(); setupMobileFilters(); } catch(e){} }, 1500);
      setTimeout(function(){ clearInterval(iv); }, 30000);
    }
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', scheduleMobileEnhancements);
  else
    scheduleMobileEnhancements();

  const _mq = window.matchMedia('(max-width: 640px)');
  const _onMq = function(){ runMobileEnhancements(); };
  if (_mq.addEventListener) _mq.addEventListener('change', _onMq);
  else if (_mq.addListener) _mq.addListener(_onMq);

})();
