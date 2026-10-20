// ================================================================
// avisos-data.js — Portal Biomedical
// Camada de dados dos Avisos: usa o backend /api/avisos (compartilhado
// entre todos os usuários) e cai no localStorage como cache/offline.
//
//   window.bmAvisos.list()            -> { source:'api'|'local', itens:[] }
//   window.bmAvisos.create(payload)   -> { source, aviso } | { error }
//   window.bmAvisos.remove(id)        -> { ok, source } | { error }
//
// payload = { assunto, corpo, cat, anexos:[nomes] }. Na API, o AUTOR e o
// setor são definidos NO SERVIDOR (identidade validada + grupo de segurança);
// os campos de autoria enviados pelo cliente são ignorados lá.
//
// O auth.js injeta o x-portal-idtoken em toda chamada a /api/*.
// ================================================================
(function () {
  'use strict';
  if (window.bmAvisos) return;

  // v3: o mural foi zerado em 03/09/26 (demonstração + testes). A chave nova
  // garante que nenhum navegador continue pintando o cache antigo antes do GET
  // responder — e o cache velho é descartado de vez.
  var LS_KEY = 'bm_avisos_v3';
  try { localStorage.removeItem('bm_avisos_v2'); localStorage.removeItem('bm_avisos_seeded'); } catch (e) {}
  var API = '/api/avisos';

  function loadLocal() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch (e) { return []; } }
  function saveLocal(list) { try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch (e) {} }

  var api = {
    _lastSource: null,   // 'api' quando o GET confirmou o backend configurado

    // Lista: tenta a API; se configurada, espelha no cache local e devolve.
    // Senão, devolve o cache local (comportamento offline/legado).
    async list() {
      try {
        var r = await fetch(API, { headers: { 'Accept': 'application/json' } });
        if (r.ok) {
          var j = await r.json();
          if (j && j.ok && j.configured && Array.isArray(j.itens)) {
            api._lastSource = 'api';
            saveLocal(j.itens);
            return { source: 'api', itens: j.itens };
          }
          if (j && j.ok && j.configured === false) api._lastSource = 'local';
        }
      } catch (e) { /* rede/serviço fora — usa cache */ }
      return { source: api._lastSource === 'api' ? 'api' : 'local', itens: loadLocal() };
    },

    // Cria: POST na API. Sucesso -> usa o aviso retornado (autoria do servidor).
    // Erro 4xx -> propaga a mensagem. Falha de rede/5xx:
    //   - se sabemos que a API está configurada, NÃO grava local escondido
    //     (evita "publiquei mas ninguém vê") e devolve erro p/ tentar de novo;
    //   - caso contrário (sem backend), cria localmente como antes.
    async create(payload) {
      var body = {
        assunto: payload.assunto, corpo: payload.corpo, cat: payload.cat,
        anexos: (payload.anexos || []).slice()
      };
      var apiConfigured = api._lastSource === 'api';
      try {
        var r = await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (r.ok) {
          var j = await r.json();
          if (j && j.ok && j.aviso) {
            api._lastSource = 'api';
            var cur = loadLocal(); cur.unshift(j.aviso); saveLocal(cur);
            return { source: 'api', aviso: j.aviso };
          }
        }
        if (r.status >= 400 && r.status < 500) {
          var je = await r.json().catch(function () { return {}; });
          return { error: (je && je.error) || ('Falha ao publicar (HTTP ' + r.status + ').') };
        }
        // 5xx com backend configurado → não esconde local
        if (apiConfigured) return { error: 'Não foi possível publicar agora. Tente novamente em instantes.' };
      } catch (e) {
        if (apiConfigured) return { error: 'Sem conexão com o servidor. Tente novamente em instantes.' };
      }
      // Fallback local (sem backend configurado): monta com a identidade do login.
      var p = (window.bmAvisoUser ? await window.bmAvisoUser() : null) || {};
      if (!p.email) return { error: 'Não foi possível identificar seu usuário. Recarregue a página e tente novamente.' };
      var now = new Date();
      var aviso = {
        id: 'u' + now.getTime(),
        cat: payload.cat, assunto: payload.assunto, corpo: payload.corpo,
        autor: p.email, email: p.email, setor: p.setor, sigla: p.sigla,
        data: now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase(),
        ts: now.getTime(), anexos: (payload.anexos || []).slice(), unread: false
      };
      var cur2 = loadLocal(); cur2.unshift(aviso); saveLocal(cur2);
      return { source: 'local', aviso: aviso };
    },

    // Remove: DELETE na API. 403/404 -> propaga. Sucesso ou sem backend -> reflete no cache.
    async remove(id) {
      var apiConfigured = api._lastSource === 'api';
      var okApi = false;
      try {
        var r = await fetch(API + '?id=' + encodeURIComponent(id), { method: 'DELETE' });
        if (r.ok) {
          var j = await r.json().catch(function () { return {}; });
          okApi = !!(j && j.ok);
        } else if (r.status === 403 || r.status === 404 || r.status === 401) {
          var je = await r.json().catch(function () { return {}; });
          return { ok: false, error: (je && je.error) || ('Não foi possível excluir (HTTP ' + r.status + ').') };
        } else if (apiConfigured) {
          return { ok: false, error: 'Não foi possível excluir agora. Tente novamente.' };
        }
      } catch (e) {
        if (apiConfigured) return { ok: false, error: 'Sem conexão com o servidor. Tente novamente.' };
      }
      var cur = loadLocal().filter(function (a) { return a && a.id !== id; });
      saveLocal(cur);
      return { ok: true, source: okApi ? 'api' : 'local' };
    }
  };

  window.bmAvisos = api;
})();
