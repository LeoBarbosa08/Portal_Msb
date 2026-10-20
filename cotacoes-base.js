/* ================================================================
   cotacoes-base.js — o núcleo das telas do módulo COTAÇÕES (Comercial)

   window.COT, usado por:
     . cotacoes-agente.js  pages/comercial-cot-nova.html   (Agente de Cotações)
     . cotacoes.js         pages/comercial-cot-casos.html  (Gestão de Cotações)
     . cotacoes-funil.js   pages/comercial-cot-funil.html  (Funil de conversão)

   Aqui: formatação (R$, datas do portal, CNPJ), ícones, as FASES e as cores
   delas, o prazo de cada cotação, a chamada à API (/api/cot-*), avisos e
   diálogo, a leitura do PDF (pi-pdf-texto.js + /api/pedido-extrair — o
   mesmo leitor do PI), a comparação cotação × pedido e a ponte com o
   PI · Pedido (customer-service-pi.js, IndexedDB).

   Quem fez o quê: o backend grava a pessoa do id token validado em toda
   ação; as telas não mandam nome nem e-mail de ninguém.
   ================================================================ */
(function () {
  'use strict';
  if (window.COT) return;
  var D = document, W = window;

  /* ── utilidades ─────────────────────────────────────────────── */
  function $(id) { return D.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function chave(s) { return norm(s).replace(/[^a-z0-9]+/g, ''); }
  function ms(iso) { var t = Date.parse(iso); return isNaN(t) ? 0 : t; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function mesmoDia(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function hora(iso) { var d = new Date(ms(iso)); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  // carimbo do sistema (ISO com fuso) -> "08/10/2026 14:30"
  function dataBR(iso, comHora) {
    var t = ms(iso); if (!t) return '—';
    var d = new Date(t);
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + (comHora ? ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : '');
  }
  // data DO PORTAL, sem fuso ("2026-10-10" | "2026-10-10T15:00") -> Date local
  // (a data sozinha vale até o fim do dia: o prazo é "até 10/10")
  function dataPortal(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(s || ''));
    if (!m) return null;
    return m[4] != null ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59);
  }
  function diaBR(s, curto) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec(String(s || ''));
    if (!m) return '';
    return m[3] + '/' + m[2] + (curto ? '' : '/' + m[1]) + (m[4] ? ' ' + m[4] : '');
  }
  // "2026-10-10T15:00" -> valor de <input type=date|datetime-local>
  function paraInput(s, comHora) {
    var m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(String(s || ''));
    if (!m) return '';
    return comHora ? m[1] + 'T' + (m[2] || '23:59') : m[1];
  }
  function quando(iso) {
    var t = ms(iso); if (!t) return '';
    var d = Date.now() - t, futuro = d < 0, a = Math.abs(d);
    if (a < 60e3) return futuro ? 'em instantes' : 'agora';
    if (a < 3600e3) return (futuro ? 'em ' : 'há ') + Math.round(a / 60e3) + ' min';
    if (a < 86400e3) return (futuro ? 'em ' : 'há ') + Math.round(a / 3600e3) + ' h';
    var dias = Math.round(a / 86400e3);
    if (dias === 1) return futuro ? 'amanhã' : 'ontem';
    if (dias < 45) return (futuro ? 'em ' : 'há ') + dias + ' dias';
    return dataBR(iso);
  }
  function chegada(iso) {
    var t = ms(iso); if (!t) return '—';
    var d = new Date(t), h = new Date(), diff = Date.now() - t;
    if (diff >= 0 && diff < 3600e3) return diff < 60e3 ? 'agora' : 'há ' + Math.round(diff / 60e3) + ' min';
    if (mesmoDia(d, h)) return 'hoje ' + hora(iso);
    var ontem = new Date(h); ontem.setDate(h.getDate() - 1);
    if (mesmoDia(d, ontem)) return 'ontem ' + hora(iso);
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + (d.getFullYear() !== h.getFullYear() ? '/' + d.getFullYear() : '') + ' ' + hora(iso);
  }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v == null ? '' : v).trim().replace(/[^\d,.\-]/g, '');
    if (!s) return 0;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    var n = Number(s);
    return isFinite(n) ? n : 0;
  }
  function brl(v) { return 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function brlCurto(v) {
    v = Number(v) || 0; var a = Math.abs(v);
    if (a >= 1e6) return 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' Mi';
    if (a >= 1e4) return 'R$ ' + (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
    return 'R$ ' + v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }
  function int(n) { return (Number(n) || 0).toLocaleString('pt-BR'); }
  function pct(x, casas) { return isFinite(x) ? (x * 100).toLocaleString('pt-BR', { maximumFractionDigits: casas == null ? 1 : casas }) + '%' : '—'; }
  function qtd(v) { return (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 }); }
  function bytes(n) { n = Number(n) || 0; if (n < 1024) return n + ' B'; if (n < 1048576) return Math.round(n / 1024) + ' KB'; return (n / 1048576).toFixed(1).replace('.', ',') + ' MB'; }
  function cnpjMask(d) {
    d = String(d || '').replace(/\D/g, '');
    if (d.length === 14) return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12);
    if (d.length === 11) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
    return d;
  }

  /* ── máscaras e validação dos campos do comprador (19/10/2026) ──
     CNPJ, CEP e telefone aceitam SÓ números e a máscara se monta enquanto
     a pessoa digita; UF é a lista das 27; e-mail precisa de
     nome@dominio.ext. As mesmas regras valem no Agente (o formulário) e na
     Gestão (a edição em linha do caso) — e o servidor confere de novo. */
  var UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
  // os DDDs que existem (Anatel)
  var DDDS = ('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 ' +
    '61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99').split(' ');
  // a faixa de CEP de cada UF (5 primeiros dígitos) — só para AVISAR quando o CEP é de outro estado
  var CEP_UF = [[1000, 19999, 'SP'], [20000, 28999, 'RJ'], [29000, 29999, 'ES'], [30000, 39999, 'MG'], [40000, 48999, 'BA'], [49000, 49999, 'SE'],
    [50000, 56999, 'PE'], [57000, 57999, 'AL'], [58000, 58999, 'PB'], [59000, 59999, 'RN'], [60000, 63999, 'CE'], [64000, 64999, 'PI'],
    [65000, 65999, 'MA'], [66000, 68899, 'PA'], [68900, 68999, 'AP'], [69000, 69299, 'AM'], [69300, 69399, 'RR'], [69400, 69899, 'AM'],
    [69900, 69999, 'AC'], [70000, 72799, 'DF'], [72800, 72999, 'GO'], [73000, 73699, 'DF'], [73700, 76799, 'GO'], [76800, 76999, 'RO'],
    [77000, 77999, 'TO'], [78000, 78899, 'MT'], [79000, 79999, 'MS'], [80000, 87999, 'PR'], [88000, 89999, 'SC'], [90000, 99999, 'RS']];
  function digitos(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
  // dígitos verificadores (módulo 11) do CNPJ e, para pessoa física, do CPF
  function dvOk(d, pesos1, pesos2) {
    var dv = function (pesos) {
      var s = 0; for (var i = 0; i < pesos.length; i++) s += Number(d[i]) * pesos[i];
      var r = s % 11; return r < 2 ? 0 : 11 - r;
    };
    return dv(pesos1) === Number(d[pesos1.length]) && dv(pesos2) === Number(d[pesos2.length]);
  }
  function cnpjValido(v) {
    var d = digitos(v);
    return d.length === 14 && !/^(\d)\1+$/.test(d) && dvOk(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  }
  function cpfValido(v) {
    var d = digitos(v);
    return d.length === 11 && !/^(\d)\1+$/.test(d) && dvOk(d, [10, 9, 8, 7, 6, 5, 4, 3, 2], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  }
  // 00.000.000/0000-00 montada aos poucos (CPF de 11 dígitos válido fica 000.000.000-00)
  function cnpjDigitando(v) {
    var d = digitos(v).slice(0, 14);
    if (d.length === 11 && cpfValido(d)) return cnpjMask(d);
    return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4').replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5');
  }
  function cepMask(v) { var d = digitos(v).slice(0, 8); return d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d; }
  function ufDoCep(v) {
    var d = digitos(v); if (d.length !== 8) return '';
    var n = Number(d.slice(0, 5));
    for (var i = 0; i < CEP_UF.length; i++) if (n >= CEP_UF[i][0] && n <= CEP_UF[i][1]) return CEP_UF[i][2];
    return '';
  }
  // o telefone em dígitos: sem o +55 e sem o 0 da operadora ("031…"); 0800/0300 ficam
  function foneDigitos(v) {
    var d = digitos(v);
    if ((d.length === 12 || d.length === 13) && d.slice(0, 2) === '55') d = d.slice(2);
    if ((d.length === 11 || d.length === 12) && d[0] === '0' && !/^0[3589]00/.test(d)) d = d.slice(1);
    return d.slice(0, 11);
  }
  // (31) 3333-4444 · (31) 99999-8888 · 0800 123 4567 — montada aos poucos
  function foneMask(v, digitando) {
    var d = digitando ? digitos(v).slice(0, 11) : foneDigitos(v);
    if (!d) return '';
    if (d[0] === '0') return d.replace(/^(\d{4})(\d)/, '$1 $2').replace(/^(\d{4}) (\d{3})(\d)/, '$1 $2 $3');
    if (d.length <= 2) return '(' + d;
    var n = d.slice(2);
    return '(' + d.slice(0, 2) + ') ' + (n.length <= 4 ? n : n.length <= 8 ? n.slice(0, 4) + '-' + n.slice(4) : n.slice(0, 5) + '-' + n.slice(5));
  }
  function emailValido(e) {
    e = String(e || '').trim();
    return /^[a-z0-9._%+-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(e) && !/^\.|\.\.|\.@/.test(e);
  }
  // a lista do "Para"/"Cópia" (separada por ; , ou espaço): os endereços que não valem
  function emailsInvalidos(v) {
    return String(v || '').split(/[;,\s]+/).filter(function (x) { return x && !emailValido(x); });
  }
  // o valor no formato da máscara (o que veio da IA, do Dynamics ou do caso);
  // o que não dá para formatar fica como veio — a validação aponta
  function formatar(tipo, v) {
    v = v == null ? '' : String(v).trim();
    if (!v) return '';
    if (tipo === 'cnpj') return cnpjDigitando(v);
    if (tipo === 'cep') return digitos(v).length === 8 ? cepMask(v) : v;
    if (tipo === 'fone') { var f = foneDigitos(v); return f.length >= 10 ? foneMask(f) : v; }
    if (tipo === 'email') return v.replace(/\s+/g, '').toLowerCase();
    if (tipo === 'uf') { var u = v.toUpperCase(); return UFS.indexOf(u) >= 0 ? u : ''; }
    return v;
  }
  // '' = ok; senão o motivo (vazio é ok — obrigatório é outra regra)
  function validar(tipo, v) {
    v = v == null ? '' : String(v).trim();
    if (!v) return '';
    var d = digitos(v);
    if (tipo === 'cnpj') {
      if (/[a-z]/i.test(v)) return 'CNPJ aceita só números';
      if (d.length === 11) return cpfValido(d) ? '' : 'CPF inválido — confira os números';
      if (d.length !== 14) return 'CNPJ incompleto — são 14 números';
      return cnpjValido(d) ? '' : 'CNPJ inválido — o dígito verificador não confere';
    }
    if (tipo === 'cep') return /[a-z]/i.test(v) ? 'CEP aceita só números' : d.length !== 8 ? 'CEP incompleto — são 8 números' : /^0+$/.test(d) ? 'CEP inválido' : '';
    if (tipo === 'fone') {
      if (/[a-z]/i.test(v)) return 'Telefone aceita só números';
      var f = foneDigitos(v);
      if (/^0[3589]00/.test(f)) return f.length === 11 ? '' : 'Número 0800 incompleto — 0800 000 0000';
      if (f.length < 10) return 'Telefone incompleto — DDD + número';
      if (DDDS.indexOf(f.slice(0, 2)) < 0) return 'DDD ' + f.slice(0, 2) + ' não existe';
      if (f.length === 11 && f[2] !== '9') return 'Celular tem o 9 depois do DDD';
      if (f.length === 10 && !/[2-5]/.test(f[2])) return 'Fixo começa com 2, 3, 4 ou 5 — celular tem o 9 na frente';
      return '';
    }
    if (tipo === 'email') return emailValido(v) ? '' : v.indexOf('@') < 0 ? 'E-mail sem @ — use nome@dominio.com.br' : 'E-mail inválido — use nome@dominio.com.br';
    if (tipo === 'emails') { var ruins = emailsInvalidos(v); return ruins.length ? 'E-mail inválido: ' + ruins.slice(0, 3).join(', ') : ''; }
    if (tipo === 'uf') return UFS.indexOf(v.toUpperCase()) >= 0 ? '' : 'UF inválida — escolha uma das 27';
    return '';
  }
  // o aviso (não trava) de CEP de outro estado
  function avisoCepUf(cep, uf) {
    var u = ufDoCep(cep); uf = String(uf || '').toUpperCase();
    return u && uf && u !== uf ? 'Este CEP é de ' + u + ', não de ' + uf : '';
  }
  // a máscara aplicada enquanto a pessoa digita ou cola, com o cursor depois
  // do mesmo número em que estava (editar no meio não joga o cursor para o fim)
  function mascarar(el, tipo) {
    var v = el.value, pos = el.selectionStart == null ? v.length : el.selectionStart;
    var conta = /\d/, novo;
    if (tipo === 'email') { novo = v.replace(/\s+/g, '').toLowerCase(); conta = /\S/; }
    else if (tipo === 'emails') { novo = v.toLowerCase(); conta = /[\s\S]/; }
    else if (tipo === 'num') { novo = v.replace(/[^\d.,]/g, ''); conta = /[\d.,]/; }
    else if (tipo === 'digitos') novo = digitos(v);
    else if (tipo === 'cnpj') novo = cnpjDigitando(v);
    else if (tipo === 'cep') novo = cepMask(v);
    // colou "+55 (31) 3333-4444"? normaliza como telefone; digitando, só os números
    else if (tipo === 'fone') novo = foneMask(v, digitos(v).length <= 11);
    else return v;
    if (novo === v) return v;
    var antes = v.slice(0, pos).split('').filter(function (ch) { return conta.test(ch); }).length;
    el.value = novo;
    var p = 0, vistos = 0;
    while (p < novo.length && vistos < antes) { if (conta.test(novo[p])) vistos++; p++; }
    try { el.setSelectionRange(p, p); } catch (e) {}
    return novo;
  }
  var PALETA = ['#1A66D2', '#5A3BC4', '#0891B2', '#138A4B', '#D97706', '#CF3434', '#C026D3', '#475569', '#4F46E5', '#0F766E'];
  function corDe(s) { var h = 0; s = String(s || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return PALETA[h % PALETA.length]; }
  function iniciais(nome, email) {
    var n = String(nome || '').trim() || String(email || '').split('@')[0].replace(/[._-]+/g, ' ');
    var p = n.split(/\s+/).filter(Boolean);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }
  function avatar(nome, email, cls) {
    return '<span class="cs-av ' + (cls || '') + '" style="background:' + corDe(email || nome) + '" title="' + esc(nome || email || '') + '">' + esc(iniciais(nome, email)) + '</span>';
  }
  function primeiroNome(n) { var p = String(n || '').trim().split(/\s+/)[0] || ''; return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : ''; }
  function nomeDoEmail(e) { return String(e || '').split('@')[0].split(/[._-]+/).filter(Boolean).map(function (p) { return p[0].toUpperCase() + p.slice(1); }).join(' '); }
  function debounce(fn, t) { var h; return function () { var a = arguments, s = this; clearTimeout(h); h = setTimeout(function () { fn.apply(s, a); }, t); }; }
  function lerLocal(k) { try { return W.localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function gravarLocal(k, v) { try { W.localStorage.setItem(k, v); } catch (e) {} }
  // conteúdo dinâmico com cara de cartão: o portal-motion.js animaria de novo a cada redesenho
  function quieto(el) { if (el) { el.__bm3card = 1; Array.prototype.forEach.call(el.querySelectorAll ? el.querySelectorAll('*') : [], function (x) { x.__bm3card = 1; }); } return el; }

  /* ── ícones (traço do portal) ───────────────────────────────── */
  function svg(p, w) { return '<svg viewBox="0 0 24 24" width="' + (w || 16) + '" height="' + (w || 16) + '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; }
  var IC = {
    file: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'),
    pdf: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h1.5a1.5 1.5 0 0 1 0 3H9v-3zm0 3v2"/><path d="M14 13v5"/>'),
    upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'),
    down: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
    eye: svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
    sparkle: svg('<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
    bot: svg('<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M12 11V7"/><circle cx="12" cy="5" r="2"/><circle cx="8" cy="16" r="1" fill="currentColor"/><circle cx="16" cy="16" r="1" fill="currentColor"/>'),
    check: svg('<polyline points="20 6 9 17 4 12"/>'),
    checkc: svg('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
    alert: svg('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
    info: svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
    x: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    plus: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
    back: svg('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>'),
    arrow: svg('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>'),
    user: svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    users: svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    userx: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="8" x2="22" y2="13"/><line x1="22" y1="8" x2="17" y2="13"/>'),
    alarm: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/>'),
    cart: svg('<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>'),
    trophy: svg('<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3"/><path d="M7 5H4v2a3 3 0 0 0 3 3"/>'),
    xc: svg('<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'),
    ban: svg('<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>'),
    inbox: svg('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
    layers: svg('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>'),
    search: svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
    refresh: svg('<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'),
    copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    note: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>'),
    clip: svg('<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'),
    hist: svg('<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>'),
    building: svg('<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>'),
    calendar: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
    list: svg('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'),
    tag: svg('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
    funnel: svg('<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>'),
    chevL: svg('<polyline points="15 18 9 12 15 6"/>'),
    chevR: svg('<polyline points="9 18 15 12 9 6"/>'),
    trash: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
    edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    lock: svg('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>')
  };

  /* ── fases ──────────────────────────────────────────────────── */
  // a mesma ordem e os mesmos nomes do api/shared/cot-motor.js (a API manda
  // cfg.fases — esta cópia só vale até ela chegar)
  // A cotação nasce SEMPRE Cotada (09/10/26: "Em cotação" saiu — caso antigo
  // nessa fase é lido como Cotada). Vencida é automática: a validade passou.
  var FASES = [
    { id: 'cotada', nome: 'Cotada', curto: 'Cotada', cor: '#1A66D2', aberta: true, desc: 'proposta enviada no portal, aguardando o resultado' },
    { id: 'negociacao', nome: 'Em negociação', curto: 'Negociação', cor: '#5A3BC4', aberta: true, desc: 'contraproposta, ajuste de preço ou análise do comprador' },
    { id: 'pedido', nome: 'Virou pedido', curto: 'Virou pedido', cor: '#138A4B', ganha: true, desc: 'o portal gerou o pedido — o PDF dele está no caso' },
    { id: 'perdida', nome: 'Perdida', curto: 'Perdida', cor: '#CF3434', perdida: true, desc: 'o comprador fechou com outro fornecedor' },
    { id: 'vencida', nome: 'Vencida', curto: 'Vencida', cor: '#B45309', perdida: true, desc: 'a data de vencimento passou sem resultado — sai sozinha do funil' },
    { id: 'cancelada', nome: 'Cancelada', curto: 'Cancelada', cor: '#8394A8', perdida: true, desc: 'cancelada pelo comprador ou deserta' }
  ];
  function faseAtual(id) { return id === 'em_cotacao' ? 'cotada' : id; }
  function fase(id) { id = faseAtual(id); return FASES.filter(function (f) { return f.id === id; })[0] || { id: id, nome: id, curto: id, cor: '#94A3B8' }; }
  function aberta(id) { return !!fase(id).aberta; }
  function chipFase(id) { id = faseAtual(id); return '<span class="cs-chip f-' + esc(id) + '"><span class="bol"></span>' + esc(fase(id).curto) + '</span>'; }

  // o prazo da cotação aberta = a DATA DE VENCIMENTO (o "Vencimento" do PDF
  // ou a data da cotação + os dias de validade). O dado é c.validade
  // (datas.validade no caso) — o nome ficou do começo do módulo.
  // nivel: 0 ok · 1 vence em breve (avisoDias) · 2 vencido (o servidor a
  // passa para Vencida na próxima leitura)
  function prazoDe(c, avisoDias) {
    if (!c || !aberta(c.fase) || c.descartado) return null;
    var aviso = (avisoDias == null ? 2 : avisoDias) * 86400e3, agora = Date.now();
    var venc = dataPortal(c.validade);
    if (!venc) return { nivel: 0, txt: 'Sem data de vencimento', curto: 'sem vencimento', cls: 'prazo-ok', semData: true };
    var t = venc.getTime(), v = t < agora ? 2 : (t - agora <= aviso ? 1 : 0), dv = diaBR(c.validade, true);
    var CLS = ['prazo-ok', 'prazo-alerta', 'prazo-vencido'];
    // txt = a frase inteira (o caso); curto = o chip da lista
    return { nivel: v, quando: venc, cls: CLS[v], txt: (v === 2 ? 'Venceu em ' : 'Vence em ') + dv, curto: (v === 2 ? 'Vencida ' : 'Vence ') + dv };
  }
  function chipPrazo(c, avisoDias) {
    var p = prazoDe(c, avisoDias);
    return p && !p.semData ? '<span class="cs-chip ' + p.cls + '" title="' + esc(p.txt) + '">' + IC.alarm + esc(p.curto) + '</span>' : '';
  }
  function chipPi(c) {
    if (c.fase !== 'pedido') return '';
    // fechou com a Ordem de Venda: o número dela (e quantas mais)
    var ovs = c.ovs || [];
    if (ovs.length) return '<span class="cs-chip pi-lancado" title="' + esc(ovs.join(', ')) + '">' + IC.checkc + esc(ovs[0]) + (ovs.length > 1 ? ' +' + (ovs.length - 1) : '') + '</span>';
    return c.pi === 'enviado' ? '<span class="cs-chip pi-aguarda-ov" title="O pedido está no Dynamics — falta informar a Ordem de Venda">' + IC.tag + 'Aguardando OV</span>' : '<span class="cs-chip pi-aguarda">' + IC.cart + 'Aguardando PI</span>';
  }
  // o número da Ordem de Venda como o Dynamics grava (a mesma regra do
  // api/shared/cot-ov.js): "ovbio 144950" -> "OVBIO144950"; só os números
  // -> "OVBIO" + números (a cotação é sempre da BIO). '' = não é OV.
  function numeroOv(v) {
    var s = String(v == null ? '' : v).toUpperCase().replace(/\s+/g, '');
    if (/^\d{4,10}$/.test(s)) s = 'OVBIO' + s;
    return /^OVBIO\d{4,10}$/.test(s) ? s : '';
  }
  function tituloCaso(c) {
    var p = [c.portal, c.cotacaoId ? 'nº ' + c.cotacaoId : ''].filter(Boolean).join(' ');
    return p || 'Cotação';
  }

  /* ── API do portal ──────────────────────────────────────────── */
  function api(caminho, corpo, metodo) {
    return fetch('/api/' + caminho, {
      method: metodo || (corpo ? 'POST' : 'GET'),
      headers: corpo ? { 'Content-Type': 'application/json' } : {},
      body: corpo ? JSON.stringify(corpo) : undefined,
      cache: 'no-store'
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok) {
          var e = new Error((j && j.error) || ('HTTP ' + r.status));
          e.status = r.status; e.corpo = j;
          throw e;
        }
        return j;
      });
    });
  }
  // o auth.js está no <head> (bloqueante): a promise do login já existe aqui
  function aguardarLogin() {
    return new Promise(function (ok) {
      var n = 0;
      (function espera() {
        if (W._portalAuthReady) { W._portalAuthReady.then(function () { ok(); }); return; }
        if (++n > 200) { ok(); return; }
        setTimeout(espera, 50);
      })();
    });
  }

  /* ── avisos e diálogo (os do Customer Service: .cs-toast / .cs-dlg) ── */
  function toast(titulo, texto, tipo, botao) {
    var box = $('cs-toasts'); if (!box) return;
    var t = D.createElement('div');
    t.className = 'cs-toast ' + (tipo || '');
    t.innerHTML = '<div class="tx"><b>' + esc(titulo) + '</b>' + (texto ? esc(texto) : '') + '</div>' + (botao ? '<button type="button" class="cs-btn cs-btn-sm">' + esc(botao.txt) + '</button>' : '');
    if (botao) t.querySelector('button').addEventListener('click', function () { botao.fn(); sair(); });
    box.appendChild(t);
    function sair() { t.classList.add('sai'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320); }
    setTimeout(sair, tipo === 'erro' ? 9000 : 5200);
  }
  function dialogo(html, aoAbrir) {
    var dlg = $('cs-dlg'); if (!dlg) return null;
    dlg.innerHTML = '<form method="dialog">' + html + '</form>';
    if (!dlg.open) { try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); } }
    if (aoAbrir) aoAbrir(dlg);
    return dlg;
  }
  function fecharDialogo() { var dlg = $('cs-dlg'); if (dlg) requestAnimationFrame(function () { if (dlg.open) dlg.close(); else dlg.removeAttribute('open'); }); }

  /* ── arquivos ───────────────────────────────────────────────── */
  function bytesParaB64(buf) {
    var bytes = new Uint8Array(buf), bin = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }
  function b64ParaBytes(b64) {
    var bin = atob(String(b64 || '')), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // File -> { nome, tipo, tamanho, base64, buffer }
  function lerArquivo(file) {
    return new Promise(function (ok, falha) {
      if (!file) { falha(new Error('Nenhum arquivo.')); return; }
      var fr = new FileReader();
      fr.onload = function () { var buf = fr.result; ok({ nome: file.name, tipo: file.type || '', tamanho: file.size, base64: bytesParaB64(buf), buffer: buf }); };
      fr.onerror = function () { falha(fr.error || new Error('Não consegui ler o arquivo.')); };
      fr.readAsArrayBuffer(file);
    });
  }
  function ehPdf(arq) { return /\.pdf$/i.test(arq.nome || '') || /pdf/i.test(arq.tipo || ''); }
  // o anexo registrado no caso, pelo servidor
  function baixarAnexo(numero, id) {
    return api('cot-casos?numero=' + encodeURIComponent(numero) + '&anexo=' + encodeURIComponent(id));
  }
  function urlDoArquivo(arq) {
    var blob = new Blob([b64ParaBytes(arq.base64)], { type: arq.tipo || 'application/octet-stream' });
    return URL.createObjectURL(blob);
  }
  // abre o PDF numa aba (a janela abre NO CLIQUE, senão o bloqueador barra)
  function abrirAnexo(numero, a) {
    var janela = W.open('', '_blank');
    if (janela) { try { janela.document.title = a.nome || 'Anexo'; janela.document.body.innerHTML = '<p style="font:15px system-ui;padding:40px;color:#0A2447">Abrindo ' + esc(a.nome || 'o anexo') + '…</p>'; } catch (e) {} }
    return baixarAnexo(numero, a.id).then(function (arq) {
      var url = urlDoArquivo(arq);
      var pdf = /pdf/i.test(arq.tipo || '');
      if (janela && !janela.closed && pdf) { janela.location.href = url; return; }
      if (janela && !janela.closed) janela.close();
      var l = D.createElement('a'); l.href = url; l.download = arq.nome || 'anexo'; D.body.appendChild(l); l.click(); l.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }).catch(function (e) {
      if (janela && !janela.closed) janela.close();
      toast('Não consegui abrir o anexo', e.message, 'erro');
    });
  }

  /* ── leitura do PDF (o mesmo leitor do PI) ──────────────────── */
  function leitorPronto() { return !!(W.PIPDF && W.pdfjsLib); }
  function textoDoPdf(buffer) {
    if (!leitorPronto()) return Promise.reject(new Error('O leitor de PDF não carregou nesta página (pdf.js). Recarregue a página.'));
    return W.PIPDF.texto(buffer.slice ? buffer.slice(0) : buffer);
  }
  // { dados, avisos, model } — perfil 'cotacao' ou o pedido do PI (sem perfil)
  // codigos (perfil cotação): os códigos Biomedical do PDF já conferidos no cadastro
  function lerComIA(texto, nome, perfil, codigos) {
    return api('pedido-extrair', { texto: texto, filename: nome || '', perfil: perfil || undefined, codigosBiomedical: codigos && codigos.length ? codigos : undefined });
  }

  // a leitura da IA (perfil cotacao) no formato do caso
  function dataDoTexto(s) {
    var m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\D+(\d{1,2})[:h](\d{2}))?/.exec(String(s || ''));
    if (!m) return /^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? String(s).slice(0, 16) : '';
    var a = +m[3]; if (a < 100) a += 2000;
    var d = a + '-' + pad(+m[2]) + '-' + pad(+m[1]);
    return m[4] != null ? d + 'T' + pad(+m[4]) + ':' + m[5] : d;
  }
  // A data em que a proposta vence = DATA DA COTAÇÃO + a validade do PDF
  // ("30 dias", "15 dias corridos"); se o PDF trouxer a data, vale ela.
  // (a mesma conta do validadeCalculada do api/shared/cot-motor.js)
  function validadeDe(txt, base) {
    var s = String(txt || '');
    var md = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
    if (md) return { data: dataDoTexto(md[0]).slice(0, 10), calculada: false };
    var m = /(\d{1,3})\s*(?:dias?\b|d\b)/i.exec(s);
    var b = dataPortal(base);
    if (!m || !b) return { data: '', calculada: false, dias: m ? Number(m[1]) : 0 };
    var v = new Date(b.getFullYear(), b.getMonth(), b.getDate() + Number(m[1]));
    return { data: v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate()), calculada: true, dias: Number(m[1]) };
  }
  // HOJE (data local "AAAA-MM-DD") e a validade que já passou
  function hojeIso() { var h = new Date(); return h.getFullYear() + '-' + pad(h.getMonth() + 1) + '-' + pad(h.getDate()); }
  function venceu(validade) { var v = String(validade || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(v) && v < hojeIso(); }
  // A DATA DE VENCIMENTO da leitura: o "Vencimento" escrito no PDF (Bionexo:
  // "Vencimento 08/10/2026 - 14:00") vale ele; sem ele, a validade do PDF
  // (data, ou dias somados à data da cotação)
  function vencimentoDe(d, dataCot) {
    var lido = dataDoTexto(d.dataLimite).slice(0, 10);
    if (lido) return { data: lido, origem: 'pdf', dias: 0 };
    var val = validadeDe(d.validadeProposta, dataCot);
    return { data: val.data, origem: val.data ? (val.calculada ? 'calc' : 'pdf') : '', dias: val.calculada ? val.dias : 0 };
  }
  function dadosDaLeitura(d) {
    d = d || {};
    var dataCot = dataDoTexto(d.dataCotacao);
    var val = vencimentoDe(d, dataCot);
    return {
      portal: d.portal || '', cotacaoId: String(d.numeroCotacao || '').replace(/[.\s]/g, ''),
      // CNPJ, CEP e telefone já na máscara; UF só se for uma das 27
      cliente: { nome: d.nomeCliente || '', cnpj: formatar('cnpj', d.cnpj), cidade: d.cidade || '', uf: formatar('uf', d.uf), endereco: d.endereco || '', cep: formatar('cep', d.cep) },
      contato: { nome: d.contatoNome || '', email: /@biomedical\.com\.br$/i.test(d.email || '') ? '' : formatar('email', d.email), telefone: formatar('fone', d.telefone) },
      datas: { cotacao: dataCot.slice(0, 10), validade: val.data },
      validadeCalculada: val.dias, vencimentoOrigem: val.origem,
      condicoes: { pagamento: d.condicaoPagamento || '', entrega: d.prazoEntrega || '', frete: d.frete || '', validade: d.validadeProposta || '', medico: '', observacao: d.observacao || '' },
      itens: (d.produtos || []).map(function (p) {
        return { codigo: p.codigo || '', codigoCliente: p.codigoCliente || '', descricao: p.descricao || '', marca: p.marca || '', registro: String(p.registroAnvisa || '').replace(/\D/g, ''),
          unidade: p.unidade || '', quantidade: Number(p.quantidade) || 0, valorUnitario: Number(p.valorUnitario) || 0 };
      }),
      totalPdf: Number(d.valorTotal) || 0
    };
  }

  /* ── o Cód. Biomedical tem de ser um produto NOSSO ──────────────
     A mesma consulta do PI · Pedido (validarProdutosEContinuar): a tabela
     'Produtos' do modelo do Comercial no Power BI, com o token da pessoa
     (voz-pbi.js). Exato primeiro; o que não casar é reconsultado com
     TRIM/NBSP no lado do BI (cadastro com espaço invisível). Cache por
     página: código já consultado não volta ao BI. */
  function normCod(s) {
    return String(s == null ? '' : s).replace(/[​-‍﻿]/g, '').replace(/ /g, ' ')
      .replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim().toUpperCase();
  }
  var _cods = {};   // COD -> { nome } | false (não é nosso)
  function produtoDoCodigo(c) { var k = normCod(c); return k ? _cods[k] : undefined; }
  function validarCodigos(lista) {
    var cods = (lista || []).map(normCod).filter(function (c, i, l) { return c && l.indexOf(c) === i && !(c in _cods); });
    if (!cods.length) return Promise.resolve();
    if (!W.VOZPBI) return Promise.reject(new Error('o validador de produtos (voz-pbi.js) não carregou — recarregue a página'));
    var q = function (c) { return '"' + c.replace(/"/g, '""') + '"'; };
    var dax = function (expr, l) { return "EVALUATE FILTER(SELECTCOLUMNS('Produtos', \"cod\", " + expr + ", \"nome\", 'Produtos'[Produto]), [cod] IN {" + l.map(q).join(', ') + '})'; };
    var anotar = function (rows) { (rows || []).forEach(function (r) { var k = normCod(r['[cod]']); if (k && r['[nome]'] != null) _cods[k] = { nome: String(r['[nome]']) }; }); };
    var lotes = []; for (var i = 0; i < cods.length; i += 150) lotes.push(cods.slice(i, i + 150));
    return lotes.reduce(function (p, l) {
      return p.then(function () { return W.VOZPBI.query(dax("UPPER('Produtos'[Cód. produto])", l)); }).then(anotar).then(function () {
        var falta = l.filter(function (c) { return !_cods[c]; });
        if (falta.length) return W.VOZPBI.query(dax("UPPER(TRIM(SUBSTITUTE('Produtos'[Cód. produto], UNICHAR(160), \" \")))", falta)).then(anotar);
      });
    }, Promise.resolve()).then(function () { cods.forEach(function (c) { if (!_cods[c]) _cods[c] = false; }); });
  }
  // o código Biomedical escrito na DESCRIÇÃO ("AM0302 - MANIFOLD 3 PORTAS…",
  // "CATETER GUIA (7024S11PDH)") — a IA às vezes deixa o nosso código ali e
  // põe o do comprador no campo
  function codigosNaDescricao(desc) {
    var s = String(desc || ''), l = [], m;
    if ((m = /^\s*([A-Z0-9][A-Z0-9.\-\/]{2,30})\s+[-–]\s+\S/i.exec(s))) l.push(m[1]);
    var re = /\(([A-Z0-9][A-Z0-9.\-\/]{2,30})\)/gi;
    while ((m = re.exec(s))) l.push(m[1]);
    return l.map(normCod).filter(function (c, i, a) { return /[0-9]/.test(c) && a.indexOf(c) === i; });
  }
  function semCodigoNaDescricao(desc, cod) {
    var s = String(desc || ''), k = normCod(cod);
    var m = /^\s*([A-Z0-9][A-Z0-9.\-\/]{2,30})\s+[-–]\s+/i.exec(s);
    if (m && normCod(m[1]) === k) s = s.slice(m[0].length);
    return s.replace(new RegExp('\\s*\\(' + k.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&') + '\\)', 'i'), '').trim();
  }
  // confere os itens: marca it._cod = { st: 'ok'|'nao'|'vazio', nome, de } e,
  // com corrigir, troca o código que não é nosso pelo nosso da descrição
  function conferirItens(itens, corrigir) {
    var cods = [];
    (itens || []).forEach(function (it) { if (it.codigo) cods.push(it.codigo); if (corrigir) cods = cods.concat(codigosNaDescricao(it.descricao)); });
    return validarCodigos(cods).then(function () {
      var corrigidos = 0;
      (itens || []).forEach(function (it) {
        var p = it.codigo ? produtoDoCodigo(it.codigo) : null;
        if (p) { it._cod = { st: 'ok', nome: p.nome, de: it._cod && it._cod.de }; return; }
        if (corrigir) {
          var cand = codigosNaDescricao(it.descricao).filter(function (c) { return produtoDoCodigo(c); })[0];
          if (cand) {
            var de = it.codigo;
            if (de && !it.codigoCliente) it.codigoCliente = de;
            it.codigo = cand; it.descricao = semCodigoNaDescricao(it.descricao, cand) || it.descricao;
            it._cod = { st: 'ok', nome: produtoDoCodigo(cand).nome, de: de || '' };
            corrigidos++;
            return;
          }
        }
        it._cod = { st: it.codigo ? 'nao' : 'vazio' };
      });
      return { corrigidos: corrigidos };
    });
  }
  // os tokens do texto do PDF com cara de código de produto (letras/números,
  // com ou sem - . /): é daqui que sai o gabarito conferido no BI
  function codigosDoTexto(texto) {
    var vistos = {}, out = [];
    var add = function (c) {
      c = normCod(c).replace(/^[-./]+|[-./]+$/g, '');
      if (c.length < 3 || c.length > 30 || vistos[c] || !/[0-9]/.test(c)) return;
      if (/^\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?$/.test(c)) return;            // data
      if (/^\d{2}\.\d{3}\.\d{3}/.test(c) || /^\d{5}-\d{3}$/.test(c)) return;  // CNPJ, CEP
      if (/^\d{1,4}$/.test(c)) return;                                       // número curto (qtd, item)
      vistos[c] = 1; out.push(c);
    };
    (String(texto || '').match(/[A-Za-z0-9][A-Za-z0-9.\-\/]{1,40}/g) || []).forEach(function (tk) {
      add(tk);
      if (/[-/]/.test(tk)) tk.split(/[-/]+/).forEach(add);                     // "10105898-MANIFOLD" -> 10105898
    });
    return out.slice(0, 600);
  }
  // os códigos NOSSOS que aparecem no PDF (conferidos no BI) — [] se o BI falhar
  function codigosNossosNoTexto(texto) {
    var cands = codigosDoTexto(texto);
    return validarCodigos(cands).then(function () { return cands.filter(function (c) { return produtoDoCodigo(c); }); }, function () { return []; });
  }
  // o item que ficou sem código nosso: procura um código nosso na LINHA do
  // texto do PDF onde o item está (pela descrição ou pelo código do comprador)
  // e nas duas de baixo; só usa quando há exatamente UM candidato
  function simples(s) { return ' ' + norm(s).replace(/[^a-z0-9]+/g, ' ').trim() + ' '; }
  function casarPeloTexto(itens, texto) {
    var linhas = String(texto || '').split(/\r?\n/), casados = 0;
    var linhasS = linhas.map(simples);
    // a "assinatura" de cada item: as 4 primeiras palavras da descrição
    var chaves = (itens || []).map(function (it) { var k = simples(it.descricao).trim().split(' ').slice(0, 4).join(' '); return k.length >= 6 ? ' ' + k + ' ' : ''; });
    var deOutro = function (j, eu) { return chaves.some(function (k, n) { return n !== eu && k && linhasS[j].indexOf(k) >= 0; }); };
    var nossos = function (l, it) { return codigosDoTexto(l).filter(function (c) { return produtoDoCodigo(c) && normCod(c) !== normCod(it.codigoCliente); }); };
    (itens || []).forEach(function (it, idx) {
      if (it._cod && it._cod.st === 'ok') return;
      var cli = it.codigoCliente ? simples(it.codigoCliente) : '';
      var achados = {};
      linhasS.forEach(function (ln, i) {
        if (!((chaves[idx] && ln.indexOf(chaves[idx]) >= 0) || (cli.trim() && ln.indexOf(cli) >= 0))) return;
        // a linha do item; sem código nela, as de baixo — parando na linha de outro item
        for (var j = i; j < Math.min(linhas.length, i + 3); j++) {
          if (j > i && deOutro(j, idx)) break;
          var cs = nossos(linhas[j], it);
          if (cs.length) { cs.forEach(function (c) { achados[c] = 1; }); break; }
        }
      });
      var l = Object.keys(achados);
      if (l.length === 1) {
        var de = it.codigo;
        if (de && !it.codigoCliente && !produtoDoCodigo(de)) it.codigoCliente = de;
        it.codigo = l[0];
        it._cod = { st: 'ok', nome: produtoDoCodigo(l[0]).nome, de: de || '' };
        casados++;
      }
    });
    return casados;
  }
  // o item cotado (com preço) precisa de um código NOSSO; o "não cotado" (sem
  // preço) pode ficar sem código, mas se tiver, tem de ser nosso
  function itensComCodigoRuim(itens) {
    return (itens || []).filter(function (it) {
      if (!(it.descricao || it.codigo || it.codigoCliente)) return false;
      if (!it.codigo) return Number(it.valorUnitario) > 0;
      return !produtoDoCodigo(it.codigo);
    });
  }
  // a célula do código: o status embaixo do campo
  function statusCodigo(it) {
    var s = it && it._cod;
    if (!s) return '';
    if (s.st === 'checando') return '<small class="cod-st chk">conferindo…</small>';
    if (s.st === 'ok') return '<small class="cod-st ok" title="' + esc(s.nome) + '">' + (s.de ? 'corrigido (era ' + esc(s.de) + ') · ' : '✓ ') + esc(s.nome) + '</small>';
    if (s.st === 'nao') return '<small class="cod-st nao">não é produto Biomedical</small>';
    if (s.st === 'vazio') return Number(it.valorUnitario) > 0 ? '<small class="cod-st nao">informe o código</small>' : '';
    return '';
  }

  /* ── cotação × pedido ───────────────────────────────────────── */
  // casa cada item do pedido com um item da cotação: 1º pelo código
  // (Biomedical ou do comprador), 2º pela descrição (palavras em comum).
  // st: ok (mesma qtd e preço) · dif (preço ou qtd diferente) · fora (cotado,
  // não pedido) · extra (pedido sem estar na cotação)
  function palavras(s) { return norm(s).replace(/[^a-z0-9.]+/g, ' ').split(' ').filter(function (w) { return w.length > 1; }); }
  function parecido(a, b) {
    var A = palavras(a), B = palavras(b); if (!A.length || !B.length) return 0;
    var comum = A.filter(function (w) { return B.indexOf(w) >= 0; }).length;
    return comum / Math.max(A.length, B.length);
  }
  function comparar(cotados, pedidos) {
    var usados = {}, linhas = [];
    (pedidos || []).forEach(function (p) {
      var cp = chave(p.codigo), alvo = -1;
      if (cp) (cotados || []).some(function (c, i) { if (usados[i]) return false; if (cp && (chave(c.codigo) === cp || chave(c.codigoCliente) === cp)) { alvo = i; return true; } return false; });
      if (alvo < 0) {
        var melhor = 0;
        (cotados || []).forEach(function (c, i) { if (usados[i]) return; var s = parecido(c.descricao, p.descricao); if (s > melhor && s >= 0.5) { melhor = s; alvo = i; } });
      }
      if (alvo < 0) { linhas.push({ st: 'extra', ped: p }); return; }
      usados[alvo] = 1;
      var c = cotados[alvo];
      var mesmaQtd = Math.abs((Number(c.quantidade) || 0) - (Number(p.quantidade) || 0)) < 1e-6;
      var mesmoPreco = Math.abs((Number(c.valorUnitario) || 0) - (Number(p.valorUnitario) || 0)) <= 0.005 * Math.max(1, Number(c.valorUnitario) || 0);
      linhas.push({ st: mesmaQtd && mesmoPreco ? 'ok' : 'dif', cot: c, ped: p, mesmaQtd: mesmaQtd, mesmoPreco: mesmoPreco });
    });
    (cotados || []).forEach(function (c, i) { if (!usados[i]) linhas.push({ st: 'fora', cot: c }); });
    var conta = function (s) { return linhas.filter(function (l) { return l.st === s; }).length; };
    return { linhas: linhas, ok: conta('ok'), dif: conta('dif'), fora: conta('fora'), extra: conta('extra') };
  }

  /* ── ponte com o PI · Pedido ─────────────────────────────────── */
  // mesmo caminho do Customer Service: o PDF (e a leitura, se já houver)
  // vai por IndexedDB (customer-service-pi.js) e o PI abre com ?cot=COT-…
  var AREA_PI = { 'venda recorrente': 'PEDIDOINTELIGENTE (VENDA RECORRENTE)', 'venda consultiva': 'PEDIDOINTELIGENTE (VENDA CONSULTIVA)', 'bio.id': 'PEDIDOINTELIGENTE (BIO.ID)', 'bioid': 'PEDIDOINTELIGENTE (BIO.ID)' };
  // a área do caso é a da equipe ("Comercial"); a área demandante do PI sai
  // do nome do grupo quando ele diz ("Equipe Comercial - Gerente Venda Recorrente")
  function areaPI(c) {
    var porArea = AREA_PI[norm(c.area)]; if (porArea) return porArea;
    var g = norm(c.equipe);
    return /consultiva/.test(g) ? AREA_PI['venda consultiva'] : /recorrente/.test(g) ? AREA_PI['venda recorrente'] : /bio\.?\s?id/.test(g) ? AREA_PI['bio.id'] : '';
  }
  function abrirNoPI(c, extracao) {
    if (!W.CSPI) { toast('A ponte com o PI não carregou', 'Recarregue a página.', 'erro'); return Promise.resolve(false); }
    if (!c.pedido) { toast('Sem o PDF do pedido', 'Anexe o pedido do portal primeiro.', 'erro'); return Promise.resolve(false); }
    var janela = W.open('', '_blank');
    if (janela) { try { janela.opener = null; janela.document.title = 'Abrindo o PI…'; janela.document.body.innerHTML = '<p style="font:15px system-ui;padding:40px;color:#0A2447">Preparando o pedido da cotação ' + esc(c.numero) + '…</p>'; } catch (e) {} }
    var destino = new URL('pedido-inteligente.html?cot=' + encodeURIComponent(c.numero), location.href).href;
    return baixarAnexo(c.numero, c.pedido.anexoId).then(function (arq) {
      return W.CSPI.guardar({
        numero: c.numero, origem: 'cotacao', arquivo: arq.nome, tipo: arq.tipo || 'application/pdf', base64: arq.base64,
        contato: { nome: (c.contato && c.contato.nome) || '', email: (c.contato && c.contato.email) || '' },
        assunto: 'Cotação ' + tituloCaso(c) + (c.cliente && c.cliente.nome ? ' · ' + c.cliente.nome : ''),
        conta: c.cliente ? { nome: c.cliente.nome || '', cnpj: c.cliente.cnpj || '', codigo: c.cliente.codigo || '', uf: c.cliente.uf || '' } : null,
        portal: c.portal || '', empresa: c.empresa || 'BIO', areaPI: areaPI(c),
        oc: (c.pedido && c.pedido.oc) || '',
        extracao: extracao && extracao.dados ? { dados: extracao.dados, avisos: extracao.avisos || [] } : null
      });
    }).then(function () {
      if (janela && !janela.closed) janela.location.href = destino; else W.location.href = destino;
      return api('cot-casos', { acao: 'pi', numero: c.numero, estado: 'em_andamento' }).catch(function () { return null; });
    }).catch(function (e) {
      if (janela && !janela.closed) janela.close();
      toast('Não consegui preparar o pedido', e.message, 'erro');
      return false;
    });
  }

  W.COT = {
    $: $, esc: esc, norm: norm, chave: chave, ms: ms, pad: pad, dataBR: dataBR, dataPortal: dataPortal, diaBR: diaBR, paraInput: paraInput,
    quando: quando, chegada: chegada, num: num, brl: brl, brlCurto: brlCurto, int: int, pct: pct, qtd: qtd, bytes: bytes, cnpjMask: cnpjMask,
    UFS: UFS, digitos: digitos, cnpjValido: cnpjValido, cpfValido: cpfValido, emailValido: emailValido, foneDigitos: foneDigitos, ufDoCep: ufDoCep,
    formatar: formatar, validar: validar, avisoCepUf: avisoCepUf, mascarar: mascarar,
    corDe: corDe, avatar: avatar, primeiroNome: primeiroNome, nomeDoEmail: nomeDoEmail, debounce: debounce, lerLocal: lerLocal, gravarLocal: gravarLocal, quieto: quieto,
    IC: IC, svg: svg, FASES: FASES, faseAtual: faseAtual, fase: fase, aberta: aberta, chipFase: chipFase, prazoDe: prazoDe, chipPrazo: chipPrazo, chipPi: chipPi, numeroOv: numeroOv, tituloCaso: tituloCaso,
    api: api, aguardarLogin: aguardarLogin, toast: toast, dialogo: dialogo, fecharDialogo: fecharDialogo,
    lerArquivo: lerArquivo, ehPdf: ehPdf, bytesParaB64: bytesParaB64, b64ParaBytes: b64ParaBytes, baixarAnexo: baixarAnexo, urlDoArquivo: urlDoArquivo, abrirAnexo: abrirAnexo,
    leitorPronto: leitorPronto, textoDoPdf: textoDoPdf, lerComIA: lerComIA, dadosDaLeitura: dadosDaLeitura, dataDoTexto: dataDoTexto, validadeDe: validadeDe,
    hojeIso: hojeIso, venceu: venceu,
    normCod: normCod, validarCodigos: validarCodigos, produtoDoCodigo: produtoDoCodigo, codigosNaDescricao: codigosNaDescricao,
    conferirItens: conferirItens, itensComCodigoRuim: itensComCodigoRuim, statusCodigo: statusCodigo,
    codigosDoTexto: codigosDoTexto, codigosNossosNoTexto: codigosNossosNoTexto, casarPeloTexto: casarPeloTexto,
    comparar: comparar, abrirNoPI: abrirNoPI
  };
})();
