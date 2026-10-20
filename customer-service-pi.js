/* ================================================================
   customer-service-pi.js — a ponte Customer Service -> PI · Pedido

   O caso de PEDIDO chega com a ordem de compra em PDF anexada no e-mail.
   O Customer Service baixa esse PDF (pelo servidor ou pelo login da
   pessoa), já pré-lê com o mesmo leitor do PI (pi-pdf-texto.js +
   /api/pedido-extrair) e ENTREGA tudo para o PI · Pedido por aqui:

     Customer Service                         PI · Pedido
     ─────────────────                        ───────────
     CSPI.guardar({numero, arquivo, base64,   pedido-inteligente.html?cs=CS-…
       contato, extracao, …})          ──►    CSPI.ler('CS-…') -> PDF + leitura
                                              (pula o upload e a IA se a
                                               leitura já veio pronta)
                                              … operador revisa e envia …
     ouve 'pi-enviado' e recarrega     ◄──    POST /api/cs-casos {acao:'pi',
     o caso (selo "Enviado ao Dynamics")       estado:'enviado'} + CSPI.avisar

   IndexedDB e não sessionStorage: o PDF passa de 5 MB fácil, e a aba do
   PI é OUTRA aba (sessionStorage não atravessa abas). Mesmo domínio, mesma
   base. A entrega expira em 24 h (limpeza no próprio ler/guardar).
   ================================================================ */
(function () {
  'use strict';
  if (window.CSPI) return;

  var DB = 'bm-cs-pi', ST = 'entregas', VALIDADE = 24 * 3600e3;
  var canal = null;
  try { canal = ('BroadcastChannel' in window) ? new BroadcastChannel('bm-cs') : null; } catch (e) { canal = null; }

  function abrir() {
    return new Promise(function (ok, falha) {
      if (!('indexedDB' in window)) { falha(new Error('Este navegador não tem IndexedDB.')); return; }
      var rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = function () { var db = rq.result; if (!db.objectStoreNames.contains(ST)) db.createObjectStore(ST, { keyPath: 'numero' }); };
      rq.onsuccess = function () { ok(rq.result); };
      rq.onerror = function () { falha(rq.error || new Error('IndexedDB indisponível')); };
    });
  }
  function tx(modo, fn) {
    return abrir().then(function (db) {
      return new Promise(function (ok, falha) {
        var t = db.transaction(ST, modo), s = t.objectStore(ST), out;
        try { out = fn(s); } catch (e) { falha(e); return; }
        // fn devolve o IDBRequest (get/put) ou nada; o valor é o .result dele
        t.oncomplete = function () { db.close(); ok(out && typeof out === 'object' && 'result' in out ? out.result : undefined); };
        t.onerror = function () { db.close(); falha(t.error); };
        t.onabort = function () { db.close(); falha(t.error || new Error('transação abortada')); };
      });
    });
  }
  function limpar() {
    return tx('readwrite', function (s) {
      var rq = s.openCursor();
      rq.onsuccess = function () {
        var c = rq.result; if (!c) return;
        if (!c.value || !c.value.criadoEm || Date.now() - c.value.criadoEm > VALIDADE) c.delete();
        c.continue();
      };
    }).catch(function () {});
  }

  window.CSPI = {
    guardar: function (entrega) {
      var e = Object.assign({}, entrega, { criadoEm: Date.now() });
      if (!e.numero || !e.base64) return Promise.reject(new Error('entrega sem número ou sem arquivo'));
      return limpar().then(function () { return tx('readwrite', function (s) { s.put(e); }); });
    },
    ler: function (numero) {
      return tx('readonly', function (s) { return s.get(String(numero || '')); }).then(function (v) {
        if (!v || Date.now() - (v.criadoEm || 0) > VALIDADE) return null;
        return v;
      });
    },
    apagar: function (numero) { return tx('readwrite', function (s) { s.delete(String(numero || '')); }).catch(function () {}); },
    // vai pelos DOIS caminhos (BroadcastChannel e o evento 'storage', reserva
    // de navegador sem canal) com o mesmo id — quem ouve entrega uma vez só
    avisar: function (msg) {
      var m = Object.assign({ t: Date.now(), id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }, msg);
      try { if (canal) canal.postMessage(m); } catch (e) {}
      try { localStorage.setItem('bm-cs-aviso', JSON.stringify(m)); } catch (e) {}
    },
    ouvir: function (fn) {
      var vistos = {};
      function entregar(m) {
        if (!m || typeof m !== 'object') return;
        if (m.id) { if (vistos[m.id]) return; vistos[m.id] = 1; }
        try { fn(m); } catch (e) {}
      }
      if (canal) canal.addEventListener('message', function (ev) { entregar(ev.data); });
      window.addEventListener('storage', function (ev) {
        if (ev.key !== 'bm-cs-aviso' || !ev.newValue) return;
        try { entregar(JSON.parse(ev.newValue)); } catch (e) {}
      });
    },
    b64ParaBytes: function (b64) {
      var bin = atob(String(b64 || '')), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },
    bytesParaB64: function (buf) {
      var bytes = new Uint8Array(buf), bin = '', CH = 0x8000;
      for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      return btoa(bin);
    }
  };
})();
