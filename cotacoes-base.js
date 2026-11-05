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
  var PALETA = ['#2C7288', '#5A3BC4', '#2B6CC4', '#138A4B', '#D97706', '#CF3434', '#C026D3', '#49565C', '#4F46E5', '#0F766E',
    '#DB2777', '#4D7C0F', '#92400E', '#204453'];
  // 23/10/2026 (pedido do usuário): cada responsável com a SUA cor — o hash
  // sozinho repetia (Jonas e Luana saíam os dois laranja). As pessoas da tela
  // (coresDistintas, com os donos das cotações) ficam com cores diferentes: na
  // ordem do e-mail, cada uma pega a do hash se estiver livre, senão a próxima
  // livre. Fora da lista (ou com mais gente que cores), vale o hash.
  var _cores = {};
  function chaveCor(s) { return String(s || '').trim().toLowerCase(); }
  function hashCor(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % PALETA.length; }
  function coresDistintas(lista) {
    var vistos = {}, usadas = {};
    _cores = {};
    (lista || []).map(chaveCor).filter(function (k) { if (!k || vistos[k]) return false; vistos[k] = 1; return true; }).sort().forEach(function (k) {
      var i = hashCor(k), n = 0;
      while (usadas[i] && n < PALETA.length) { i = (i + 1) % PALETA.length; n++; }
      usadas[i] = 1; _cores[k] = PALETA[i];
    });
  }
  function corDe(s) { var k = chaveCor(s); return _cores[k] || PALETA[hashCor(k)]; }
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
    lock: svg('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
    // a tramitação (as notas) e a amostra — 23/10/2026
    chat: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="13" y2="13"/>'),
    amostra: svg('<path d="M9 3h6"/><path d="M10 3v6.5L4.6 18.6A1.6 1.6 0 0 0 6 21h12a1.6 1.6 0 0 0 1.4-2.4L14 9.5V3"/><line x1="7.2" y1="15" x2="16.8" y2="15"/>'),
    chevD: svg('<polyline points="6 9 12 15 18 9"/>')
  };

  /* ── fases ──────────────────────────────────────────────────── */
  // a mesma ordem e os mesmos nomes do api/shared/cot-motor.js (a API manda
  // cfg.fases — esta cópia só vale até ela chegar). 21/10/2026 (pedido do
  // usuário): SÓ TRÊS FASES — Cotada, Perdida e Ganha (virou pedido). As
  // antigas são lidas assim: Em cotação / Em negociação = Cotada; Vencida /
  // Cancelada = Perdida (o motivo da perda diz "Proposta vencida", "Cancelada…")
  // 26/10/2026 (pedido do usuário): + A FATURAR, depois de Cotada — à mão,
  // "ainda nada aconteceu" (sem pedido nem OV); fecha como Ganha com a OV
  var FASES = [
    { id: 'cotada', nome: 'Cotada', curto: 'Cotada', cor: '#2C7288', aberta: true, desc: 'proposta enviada no portal, aguardando o resultado' },
    { id: 'perdida', nome: 'Perdida', curto: 'Perdida', cor: '#CF3434', perdida: true, desc: 'não virou pedido — o motivo diz por quê (preço, prazo, vencida, cancelada…)' },
    { id: 'pedido', nome: 'Ganha (virou pedido)', curto: 'Ganha', cor: '#138A4B', ganha: true, desc: 'virou pedido — o pedido (PDF, à mão ou a OV) está no caso' }
  ];
  // 26/10/2026 (pedido do usuário): as fases da AMOSTRA — Envio de amostra,
  // Ganha e Perdida. Ganha ou perdida, ela fica na Amostra (fora das Ganhas e
  // das Perdidas), só com a cor verde ou vermelha
  var FASES_AMOSTRA = [
    { id: 'amostra', nome: 'Envio de amostra', curto: 'Envio de amostra', cor: '#7C3AED', aberta: true, amostra: true, desc: 'a amostra foi para o cliente, aguardando o resultado' },
    { id: 'amostra_ganha', nome: 'Ganha', curto: 'Ganha', cor: '#138A4B', ganha: true, amostra: true, desc: 'o cliente aprovou a amostra — fica na Amostra, fora das Ganhas' },
    { id: 'amostra_perdida', nome: 'Perdida', curto: 'Perdida', cor: '#CF3434', perdida: true, amostra: true, desc: 'o cliente não aprovou a amostra — fica na Amostra, fora das Perdidas' }
  ];
  // RECORTE MSB (05/11/2026, pedido do dono): sem a fase A faturar na MSB — a que
  // estava nela é lida como Cotada (como no servidor, api/shared/cot-motor.js)
  var FASE_ANTIGA = { em_cotacao: 'cotada', negociacao: 'cotada', vencida: 'perdida', cancelada: 'perdida', faturar: 'cotada' };
  function faseAtual(id) { return FASE_ANTIGA[id] || id; }
  function fase(id) { id = faseAtual(id); return FASES.concat(FASES_AMOSTRA).filter(function (f) { return f.id === id; })[0] || { id: id, nome: id, curto: id, cor: '#95A4AB' }; }
  // a fase como vale hoje (a mesma regra do servidor — faseDe): a amostra
  // Cotada (as de antes das fases dela) é Envio de amostra. c = o caso ou o
  // resumo da lista
  function faseDe(c) {
    if (!c) return '';
    var id = faseAtual(c.fase);
    return c.amostra && id === 'cotada' ? 'amostra' : id;
  }
  function aberta(id) { return !!fase(id).aberta; }
  function chipFase(id) { id = faseAtual(id); return '<span class="cs-chip f-' + esc(id) + '"><span class="bol"></span>' + esc(fase(id).curto) + '</span>'; }

  // o prazo da cotação aberta = a DATA DE VENCIMENTO (o "Vencimento" do PDF
  // ou a data da cotação + os dias de validade). O dado é c.validade
  // (datas.validade no caso) — o nome ficou do começo do módulo.
  // nivel: 0 ok · 1 vence em breve (avisoDias) · 2 a data já passou (só o
  // aviso: a cotação segue aberta — 20/10/26; o chip diz "Prazo vencido",
  // a data fica na dica — 21/10/26)
  function prazoDe(c, avisoDias) {
    // (A faturar: o vencimento da proposta não conta mais — não perde pelo prazo)
    if (!c || !aberta(c.fase) || c.descartado || fase(c.fase).faturar) return null;
    var aviso = (avisoDias == null ? 2 : avisoDias) * 86400e3, agora = Date.now();
    var venc = dataPortal(c.validade);
    if (!venc) return { nivel: 0, txt: 'Sem data de vencimento', curto: 'sem vencimento', cls: 'prazo-ok', semData: true };
    var t = venc.getTime(), v = t < agora ? 2 : (t - agora <= aviso ? 1 : 0), dv = diaBR(c.validade, true);
    var CLS = ['prazo-ok', 'prazo-alerta', 'prazo-vencido'];
    // txt = a frase inteira (o caso); curto = o chip da lista
    return { nivel: v, quando: venc, cls: CLS[v], txt: (v === 2 ? 'Prazo vencido em ' : 'Vence em ') + dv, curto: v === 2 ? 'Prazo vencido' : 'Vence ' + dv };
  }
  function chipPrazo(c, avisoDias) {
    var p = prazoDe(c, avisoDias);
    return p && !p.semData ? '<span class="cs-chip ' + p.cls + '" title="' + esc(p.txt) + '">' + IC.alarm + esc(p.curto) + '</span>' : '';
  }
  function chipPi(c) {
    // 22/10/2026: o pedido registrado (PDF ou à mão) deixa a cotação aberta até a OV
    if (c.fase !== 'pedido') return (c.temPedido || c.pedido) && !c.descartado ? '<span class="cs-chip pi-aguarda-ov" title="O pedido está registrado — a oportunidade fecha como Ganha com a Ordem de Venda (do fluxo do PI ou informada no cartão)">' + IC.tag + 'Pedido · aguardando OV</span>' : '';
    // fechou com a Ordem de Venda: o número dela (e quantas mais)
    var ovs = c.ovs || [];
    if (ovs.length) return '<span class="cs-chip pi-lancado" title="' + esc(ovs.join(', ')) + '">' + IC.checkc + esc(ovs[0]) + (ovs.length > 1 ? ' +' + (ovs.length - 1) : '') + '</span>';
    // 21/10/2026 (pedido do usuário): "Aguardando PI" não existe mais — a
    // cotação que virou pedido é Ganha (o chip da fase já diz)
    return c.pi === 'enviado' ? '<span class="cs-chip pi-aguarda-ov" title="O pedido está no Dynamics — falta informar a Ordem de Venda">' + IC.tag + 'Aguardando OV</span>' : '';
  }
  // o número da Ordem de Venda como o Dynamics grava (a mesma regra do
  // api/shared/cot-ov.js): "ovmsb 144950" -> "OVMSB144950"; só os números
  // -> "OVMSB" + números (RECORTE MSB: a cotação é sempre da MSB; aceita
  // OV + letras + números, como o servidor). '' = não é OV.
  function numeroOv(v) {
    var s = String(v == null ? '' : v).toUpperCase().replace(/\s+/g, '');
    if (/^\d{4,10}$/.test(s)) s = 'OVMSB' + s;
    return /^OV[A-Z]{2,6}\d{4,10}$/.test(s) ? s : '';
  }
  function tituloCaso(c) {
    var p = [c.portal, c.cotacaoId ? 'nº ' + c.cotacaoId : ''].filter(Boolean).join(' ');
    return p || 'Oportunidade';
  }

  /* ── API do portal ──────────────────────────────────────────── */
  // O token DELEGADO do Power BI vai junto (x-pbi-token): o RLS dele diz ao
  // servidor as UNIDADES DE NEGÓCIO da pessoa — a cotação é da unidade de
  // quem registra e cada um vê só as das suas. Pedido em silêncio, pelo login
  // do portal (sem popup fora de clique); sem ele o servidor não confirma a
  // unidade e a pessoa não vê nenhuma cotação.
  var PBI_SCOPES = ['https://analysis.windows.net/powerbi/api/Dataset.Read.All', 'https://analysis.windows.net/powerbi/api/Report.Read.All'];
  var _pbiTok = '', _pbiTokAte = 0;
  function tokenPbi() {
    var m = W._msalAuth;
    if (_pbiTok && Date.now() < _pbiTokAte) return Promise.resolve(_pbiTok);
    if (!m || !m.getAllAccounts) return Promise.resolve('');
    var conta = (m.getActiveAccount && m.getActiveAccount()) || (m.getAllAccounts() || [])[0];
    if (!conta) return Promise.resolve('');
    return Promise.resolve(m.acquireTokenSilent({ scopes: PBI_SCOPES, account: conta })).then(function (r) {
      var t = (r && r.accessToken) || '';
      if (t) { _pbiTok = t; _pbiTokAte = Date.now() + 5 * 60e3; }
      return t;
    }).catch(function () { return ''; });
  }
  function esquecerTokenPbi() { _pbiTok = ''; _pbiTokAte = 0; }
  function api(caminho, corpo, metodo) {
    return tokenPbi().then(function (pbi) {
      var h = corpo ? { 'Content-Type': 'application/json' } : {};
      if (pbi) h['x-pbi-token'] = pbi;
      return fetch('/api/' + caminho, {
        method: metodo || (corpo ? 'POST' : 'GET'),
        headers: h,
        body: corpo ? JSON.stringify(corpo) : undefined,
        cache: 'no-store'
      });
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
  // cls: uma classe a mais no <dialog> só desta vez (ex.: o "Virou pedido", mais largo)
  // o fechar espera um quadro (requestAnimationFrame): um diálogo aberto logo
  // em seguida (ex.: a confirmação da OV que volta rápido) cancela esse fechar
  var fechando = 0;
  function dialogo(html, aoAbrir, cls) {
    var dlg = $('cs-dlg'); if (!dlg) return null;
    if (fechando) { cancelAnimationFrame(fechando); fechando = 0; }
    dlg.className = 'cs-dlg' + (cls ? ' ' + cls : '');
    dlg.innerHTML = '<form method="dialog">' + html + '</form>';
    if (!dlg.open) { try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); } }
    if (aoAbrir) aoAbrir(dlg);
    return dlg;
  }
  function fecharDialogo() { var dlg = $('cs-dlg'); if (dlg) fechando = requestAnimationFrame(function () { fechando = 0; if (dlg.open) dlg.close(); else dlg.removeAttribute('open'); }); }

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
    if (janela) { try { janela.document.title = a.nome || 'Anexo'; janela.document.body.innerHTML = '<p style="font:15px system-ui;padding:40px;color:#0F2831">Abrindo ' + esc(a.nome || 'o anexo') + '…</p>'; } catch (e) {} }
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

  // o NÚMERO DA COTAÇÃO pelo rótulo do PDF — quase sempre o ID /
  // Identificador dela ("ID: 668804034", "Nº da cotação", "Cotação nº",
  // "Cotação:"). A mesma busca de api/shared/cot-id.js (lá ela confere o que
  // a IA leu); aqui vale quando a IA não respondeu. '' se não achar.
  var ROT_ID = [
    [3, '(?:Identificador|Identifica[cç][aã]o|ID|N[º°o]\\.?|N[uú]mero|C[oó]digo)[ \\t]*(?:d[aeo][ \\t]+)?(?:pedido[ \\t]+de[ \\t]+)?cota[cç][aã]o'],
    [3, '(?:pedido[ \\t]+de[ \\t]+)?cota[cç][aã]o[ \\t]*(?:n[º°o]\\.?|n[uú]mero|ID|#)'],
    [2, '(?:Identificador|Identifica[cç][aã]o|ID)'],
    [2, '(?:pedido[ \\t]+de[ \\t]+)?cota[cç][aã]o']
  ];
  function idDaCotacao(texto) {
    var s = String(texto || '').slice(0, 200000), melhor = null;
    ROT_ID.forEach(function (r) {
      var re = new RegExp('(?:^|[^A-Za-zÀ-ÿ])(' + r[1] + ')[ \\t:#=\\-–]*([A-Z]{0,5}[-/]?\\d[\\d./-]*\\d|\\d)', 'gim'), m;
      while ((m = re.exec(s))) {
        var v = m[2].replace(/[-/.]+$/, ''), d = v.replace(/\D/g, '');
        if (d.length < 3 || d.length > 20 || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(v) || /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(v) || /^\d{5}-\d{3}$/.test(v)) continue;
        if (!melhor || r[0] > melhor.f || (r[0] === melhor.f && m.index < melhor.pos)) melhor = { f: r[0], pos: m.index, v: v.replace(/[.\s]/g, '') };
      }
    });
    return melhor ? melhor.v : '';
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
  /* ── frete e o contato do setor na proposta (22/10/2026) ──────── */
  // Pedido do usuário: o frete é CIF ou FOB (o que o PDF disser, se disser)
  function freteCifFob(v) { var s = norm(v); return /\bcif\b/.test(s) ? 'CIF' : /\bfob\b/.test(s) ? 'FOB' : ''; }
  // e a proposta sai com o e-mail e o telefone do SETOR (a unidade de negócio
  // da cotação), não os de quem está logado — o e-mail também sai pela caixa
  // dele. As unidades fora desta lista seguem com os da pessoa, como antes
  // RECORTE MSB: o e-mail e o telefone de setor acima são os da BIO (Venda
  // Recorrente e BIO.ID) — na MSB a proposta sai com os de quem está logado.
  // Para a MSB ter o contato do setor: vendarecorrente: { setor, email, telefone }
  var CONTATO_SETOR = {};
  function contatoDoSetor(unidade) { return CONTATO_SETOR[chave(unidade)] || null; }
  // os OUTROS ARQUIVOS que vão junto com a proposta (22/10/2026, pedido do
  // usuário: "anexar outros PDFs e anexos no geral"): os escolhidos no
  // computador (lista: {nome, tamanho, base64}) e, no caso, os que já estão
  // nele para marcar (doCaso: {id, nome, tamanho, on}). O envio confere o total
  function htmlExtras(lista, doCaso) {
    lista = lista || []; doCaso = doCaso || [];
    var tot = lista.reduce(function (s, a) { return s + (Number(a.tamanho) || 0); }, 0) +
      doCaso.reduce(function (s, a) { return s + (a.on ? Number(a.tamanho) || 0 : 0); }, 0);
    var n = lista.length + doCaso.filter(function (a) { return a.on; }).length;
    return '<div class="cot-extras">' +
      (doCaso.length ? '<div class="cot-extras-caso"><small>Da oportunidade:</small>' + doCaso.map(function (a) {
        return '<label class="cot-extra' + (a.on ? ' on' : '') + '"><input type="checkbox" data-extra-caso="' + esc(a.id) + '"' + (a.on ? ' checked' : '') + '>' + IC.clip + '<b title="' + esc(a.nome) + '">' + esc(a.nome) + '</b>' + (a.tamanho ? '<small>' + bytes(a.tamanho) + '</small>' : '') + '</label>';
      }).join('') + '</div>' : '') +
      '<div class="cot-extras-l">' + lista.map(function (a, i) {
        return '<span class="cot-extra on">' + IC.clip + '<b title="' + esc(a.nome) + '">' + esc(a.nome) + '</b><small>' + bytes(a.tamanho) + '</small><button type="button" data-tirar-extra="' + i + '" title="Tirar" aria-label="Tirar ' + esc(a.nome) + '">' + IC.x + '</button></span>';
      }).join('') +
      '<label class="cs-btn cs-btn-xs cot-extra-add">' + IC.plus + 'Anexar arquivos<input type="file" data-extras multiple hidden></label></div>' +
      '<small class="cot-extra-tot">' + (n ? n + ' arquivo(s) junto com a proposta · ' + bytes(tot) : 'outros PDFs, catálogo, registro… vão no mesmo e-mail') + ' (até ~2,5 MB no total)</small></div>';
  }
  // como a proposta saiu (o retorno do COTPROP.enviar): pela caixa do setor ou
  // pela da pessoa, com as respostas indo para o setor
  function comoSaiu(r) {
    if (!r || !r.setor) return '';
    return r.pelo === 'setor' ? 'Saiu pela caixa ' + r.setor.email + '.'
      : 'Saiu pelo seu e-mail (você não tem o "Enviar como" na caixa ' + r.setor.email + ') — as respostas do comprador vão para ela.';
  }
  // os arquivos escolhidos -> [{nome, tipo, tamanho, base64}]
  function lerExtras(files) {
    return Promise.all(Array.prototype.slice.call(files || []).map(function (f) {
      return lerArquivo(f).then(function (a) { return { nome: a.nome, tipo: a.tipo || 'application/octet-stream', tamanho: a.tamanho, base64: a.base64 }; });
    }));
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
      condicoes: { pagamento: d.condicaoPagamento || '', entrega: d.prazoEntrega || '', frete: freteCifFob(d.frete), validade: d.validadeProposta || '', medico: '', observacao: d.observacao || '' },
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
      }).then(function () {
        // RECORTE MSB (como no PI · Pedido): o pbi-throttle.js embrulha a consulta
        // em CALCULATETABLE(…, 'Empresas'[…] IN {"MSB"}) e, pelas relações do
        // modelo, isso some com produto do cadastro — o código existe e voltava
        // "não é produto". O que sobrou é procurado de novo com
        // REMOVEFILTERS('Empresas') POR DENTRO: só código e nome, nenhum número.
        var falta2 = l.filter(function (c) { return !_cods[c]; });
        if (falta2.length) return W.VOZPBI.query('EVALUATE CALCULATETABLE(' + dax("UPPER(TRIM(SUBSTITUTE('Produtos'[Cód. produto], UNICHAR(160), \" \")))", falta2).replace(/^EVALUATE /, '') + ", REMOVEFILTERS('Empresas'))")
          .then(anotar, function (e) { if (W.console) console.warn('[cotacoes] código sem o recorte MSB:', e); });
      });
    }, Promise.resolve()).then(function () { cods.forEach(function (c) { if (!_cods[c]) _cods[c] = false; }); });
  }
  /* ── o preço de referência: a MÉDIA DE FATURAMENTO do item no cliente ──
     23/10/2026 (pedido do usuário): na hora de digitar o preço da cotação, o
     histórico de faturamento daquele item naquele cliente — a média dos
     últimos 6 meses (faturamento ÷ quantidade). A tabela 'Faturamentos' do
     modelo do Comercial no Power BI (a mesma do Dossiê de Visita, com os
     mesmos filtros-base: sem intercompany, só o que gera fatura a receber,
     sem a NF 667708), com o token da pessoa (o RLS dela vale). Cache por
     cliente|código na página. Devolve { COD: { fat, qtd, notas, ult, media } |
     false (sem faturamento no período) }. */
  var _fat = {};   // 'CLI|COD' -> { fat, qtd, notas, ult, media } | false
  var MESES_FAT = 6;
  function codCliente(s) { return String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, ''); }
  function inicioFaturamento() { var h = new Date(); return new Date(h.getFullYear(), h.getMonth() - MESES_FAT, h.getDate()); }
  function faturamentoDoCliente(cliente, codigos) {
    var cli = codCliente(cliente), r = {};
    var cods = (codigos || []).map(normCod).filter(function (c, i, l) { return c && l.indexOf(c) === i; });
    if (!cli || !cods.length) return Promise.resolve(r);
    var falta = cods.filter(function (c) { return !((cli + '|' + c) in _fat); });
    var junta = function () { cods.forEach(function (c) { r[c] = _fat[cli + '|' + c]; }); return r; };
    if (!falta.length) return Promise.resolve(junta());
    if (!W.VOZPBI) return Promise.reject(new Error('a consulta ao Power BI (voz-pbi.js) não carregou — recarregue a página'));
    var q = function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; };
    var ini = inicioFaturamento(), dia = 'DATE(' + ini.getFullYear() + ', ' + (ini.getMonth() + 1) + ', ' + ini.getDate() + ')';
    var dax = function (l) {
      return "EVALUATE SELECTCOLUMNS(CALCULATETABLE(ADDCOLUMNS(SUMMARIZE('Faturamentos', 'Produtos'[Cód. produto]), " +
        "\"fat\", CALCULATE(SUM('Faturamentos'[Faturamento])), \"qtd\", [Faturamento (quantidade)], " +
        "\"notas\", CALCULATE(DISTINCTCOUNT('Faturamentos'[Número da fatura])), " +
        "\"ult\", CALCULATE(MAXX(SUMMARIZE('Faturamentos', 'Calendário'[Data]), 'Calendário'[Data]))), " +
        // o código do cliente pode ser número no modelo: compara como texto
        "FILTER(ALL('Clientes'[Cód. Cliente]), UPPER(TRIM('Clientes'[Cód. Cliente] & \"\")) = " + q(cli) + "), " +
        "FILTER(ALL('Produtos'[Cód. produto]), UPPER(TRIM(SUBSTITUTE('Produtos'[Cód. produto], UNICHAR(160), \" \"))) IN {" + l.map(q).join(', ') + "}), " +
        "'DIM_UNIDADE_DE_NEGOCIO_V2'[UNIDADE_DE_NEGOCIO] <> \"INTERCOMPANY\", 'Operações'[Gera Fatura a receber?] = \"SIM\", " +
        "FILTER(ALL('Faturamentos'[Número da fatura]), NOT(('Faturamentos'[Número da fatura] & \"\") IN {\"667708\"})), " +
        "'Calendário'[Data] >= " + dia + "), " +
        "\"cod\", 'Produtos'[Cód. produto], \"fat\", [fat], \"qtd\", [qtd], \"notas\", [notas], \"ult\", [ult])";
    };
    var lotes = []; for (var i = 0; i < falta.length; i += 100) lotes.push(falta.slice(i, i + 100));
    return lotes.reduce(function (p, l) {
      return p.then(function () { return W.VOZPBI.query(dax(l)); }).then(function (rows) {
        var acc = {};
        (rows || []).forEach(function (x) {
          var c = normCod(x['[cod]']); if (!c) return;
          // o mesmo código com grafias diferentes no cadastro: soma
          var o = acc[c] || (acc[c] = { fat: 0, qtd: 0, notas: 0, ult: '' }), u = String(x['[ult]'] || '').slice(0, 10);
          o.fat += Number(x['[fat]']) || 0; o.qtd += Number(x['[qtd]']) || 0; o.notas += Number(x['[notas]']) || 0;
          if (u > o.ult) o.ult = u;
        });
        l.forEach(function (c) {
          var o = acc[c];
          if (o) o.media = o.qtd > 0 ? Math.round(o.fat / o.qtd * 100) / 100 : 0;
          _fat[cli + '|' + c] = o && o.qtd > 0 ? o : false;
        });
      });
    }, Promise.resolve()).then(junta);
  }
  /* ── a TABELA DE PREÇOS do item (23/10/2026) ──────────────────
     Pedido do usuário: além da média, o preço da Tabela de Preços — Venda
     Direta (VD) e Venda Futura (VF) —, a mesma da página Tabela de Preços do
     portal: 'Tabela de preços (Salesforce)' do modelo do Comercial no Power BI,
     com o preço lista e os mínimos (supervisor, gerente) de cada canal. Não
     depende do cliente. Cache por código. Devolve
     { COD: { vd: { lista, sup, ger }, vf: { … } } | false (fora da tabela) }. */
  var _tab = {};
  var T_TAB = "'Tabela de preços (Salesforce)'";
  function tabelaDePrecos(codigos) {
    var cods = (codigos || []).map(normCod).filter(function (c, i, l) { return c && l.indexOf(c) === i; }), r = {};
    var junta = function () { cods.forEach(function (c) { r[c] = _tab[c]; }); return r; };
    var falta = cods.filter(function (c) { return !(c in _tab); });
    if (!falta.length) return Promise.resolve(junta());
    if (!W.VOZPBI) return Promise.reject(new Error('a consulta ao Power BI (voz-pbi.js) não carregou — recarregue a página'));
    var q = function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; };
    var col = function (c) { return T_TAB + '[' + c + ']'; };
    var dax = function (l) {
      return 'EVALUATE SELECTCOLUMNS(FILTER(' + T_TAB + ', UPPER(TRIM(SUBSTITUTE(' + col('Código do produto') + ' & "", UNICHAR(160), " "))) IN {' + l.map(q).join(', ') + '}), ' +
        '"cod", ' + col('Código do produto') + ', "vdl", ' + col('VD - Preço lista') + ', "vds", ' + col('VD - Mínimo supervisor') + ', "vdg", ' + col('VD - Mínimo gerente') + ', ' +
        '"vfl", ' + col('VF - Preço lista') + ', "vfs", ' + col('VF - Mínimo supervisor') + ', "vfg", ' + col('VF - Mínimo gerente') + ')';
    };
    var n = function (v) { return v == null || v === '' || isNaN(Number(v)) || !(Number(v) > 0) ? 0 : Math.round(Number(v) * 100) / 100; };
    var lotes = []; for (var i = 0; i < falta.length; i += 100) lotes.push(falta.slice(i, i + 100));
    return lotes.reduce(function (p, l) {
      return p.then(function () { return W.VOZPBI.query(dax(l)); }).then(function (rows) {
        var acc = {};
        (rows || []).forEach(function (x) {
          var c = normCod(x['[cod]']); if (!c) return;
          // mais de uma linha do mesmo código: fica o primeiro valor de cada preço
          var o = acc[c] || (acc[c] = { vd: { lista: 0, sup: 0, ger: 0 }, vf: { lista: 0, sup: 0, ger: 0 } });
          [['vd', 'vdl', 'vds', 'vdg'], ['vf', 'vfl', 'vfs', 'vfg']].forEach(function (k) {
            o[k[0]].lista = o[k[0]].lista || n(x['[' + k[1] + ']']); o[k[0]].sup = o[k[0]].sup || n(x['[' + k[2] + ']']); o[k[0]].ger = o[k[0]].ger || n(x['[' + k[3] + ']']);
          });
        });
        l.forEach(function (c) { var o = acc[c]; _tab[c] = o && (o.vd.lista || o.vf.lista || o.vd.sup || o.vf.sup || o.vd.ger || o.vf.ger) ? o : false; });
      });
    }, Promise.resolve()).then(junta);
  }
  // o preço do item ACIMA das referências (23/10/2026): a média dos 6 meses de
  // faturamento e o preço lista da tabela (VD e VF) — [{ k, nome, ref, pct }]
  function acimaDasReferencias(it) {
    var p = Number(it && it.valorUnitario) || 0, r = [];
    if (!(p > 0)) return r;
    var add = function (k, nome, ref) { if (ref > 0 && p > ref + 0.005) r.push({ k: k, nome: nome, ref: ref, pct: p / ref - 1 }); };
    var f = it._fat && it._fat.st === 'ok' && it._fat.v; if (f) add('media', 'da média dos 6 meses', f.media);
    var t = it._tab && it._tab.st === 'ok' && it._tab.v;
    if (t) { add('vd', 'da tabela Venda Direta', t.vd && t.vd.lista); add('vf', 'da tabela Venda Futura', t.vf && t.vf.lista); }
    return r;
  }
  function pctAcima(x) { return '+' + pct(x, x < 0.1 ? 1 : 0); }
  function juntarE(l) { return l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1]; }
  function textoAcima(l) { return juntarE(l.map(function (a) { return a.nome + ' (' + pctAcima(a.pct) + ')'; })); }
  // as referências de preço do item, embaixo da linha (o agente marca it._fat e
  // it._tab: { st: 'buscando'|'ok'|'nada'|'erro', v?, erro?, auto? }); cli = o
  // código do cliente da tela (sem ele, não há média)
  function refsPreco(it, i, cli) {
    if (!it || !it.codigo) return '';
    var f = it._fat, t = it._tab, p = Number(it.valorUnitario) || 0;
    var usar = function (k, v) { return Math.abs(p - v) < 0.005 ? '' : ' <button type="button" class="cot-ref-usar" data-usar-ref="' + i + '|' + k + '" title="Usar ' + esc(brl(v)) + ' como o preço do item">usar</button>'; };
    var mut = function (t0, tit) { return '<span class="cot-ref-v mut"' + (tit ? ' title="' + esc(tit) + '"' : '') + '>' + esc(t0) + '</span>'; };
    var m;
    if (!cli) m = mut('informe o código do cliente');
    else if (!f || f.st === 'buscando') m = mut('buscando…');
    else if (f.st === 'erro') m = mut('indisponível agora', f.erro);
    else if (f.st === 'nada' || !f.v || !f.v.media) m = mut('sem faturamento deste item no cliente');
    else {
      var v = f.v, tit = qtd(v.qtd) + ' un faturadas, ' + brl(v.fat) + ' em ' + v.notas + ' nota(s)' + (v.ult ? ' · última em ' + diaBR(v.ult) : '');
      m = '<b class="cot-ref-v" title="' + esc(tit) + '">' + brl(v.media) + '</b>' + (f.auto && Math.abs(p - v.media) < 0.005 ? ' <span class="cot-ref-tag">usada</span>' : usar('media', v.media));
    }
    var canal = function (nome, c, k) {
      if (!c || !(c.lista > 0)) return nome + ': ' + mut('—');
      var tit = 'Preço lista ' + brl(c.lista) + (c.sup ? ' · mínimo supervisor ' + brl(c.sup) : '') + (c.ger ? ' · mínimo gerente ' + brl(c.ger) : '');
      return nome + ': <b class="cot-ref-v" title="' + esc(tit) + '">' + brl(c.lista) + '</b>' + usar(k, c.lista);
    };
    var tb;
    if (!t || t.st === 'buscando') tb = mut('buscando…');
    else if (t.st === 'erro') tb = mut('indisponível agora', t.erro);
    else if (t.st === 'nada') tb = mut('o item não está na tabela de preços');
    else tb = canal('Venda Direta', t.v.vd, 'vd') + '<span class="cot-ref-sep">·</span>' + canal('Venda Futura', t.v.vf, 'vf');
    var acima = acimaDasReferencias(it);
    return '<span class="cot-ref-i">' + IC.hist + '<span class="cot-ref-k">Média dos 6 meses de faturamento:</span>' + m + '</span>' +
      '<span class="cot-ref-i">' + IC.tag + '<span class="cot-ref-k">Tabela de preço —</span>' + tb + '</span>' +
      (acima.length ? '<span class="cot-ref-alerta">' + IC.alert + '<span><b>' + esc(brl(p)) + ' está acima ' + esc(textoAcima(acima)) + '.</b> Você está passando da referência — confira.</span></span>' : '');
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
        // 05/11/2026 (RECORTE MSB): o código digitado com a descrição vazia
        // ganha o nome do cadastro (o do Power BI) — o item nunca fica sem nome
        if (p && !String(it.descricao || '').trim() && p.nome) it.descricao = p.nome;
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
    if (s.st === 'nao') return '<small class="cod-st nao">não é produto nosso</small>';
    if (s.st === 'vazio') return Number(it.valorUnitario) > 0 ? '<small class="cod-st nao">informe o código</small>' : '';
    return '';
  }

  /* ── o produto no Salesforce (21/10/2026) ──────────────────────
     A descrição, o fabricante e o RMS do CADASTRO (Product2) pelo Cód.
     Biomedical — é o que vai na PROPOSTA (cotacoes-proposta.js), não só o
     que a IA leu do PDF. /api/cot-casos?produtos=… (com cache no servidor);
     aqui, cache da página: código já consultado não volta ao servidor. */
  var _sf = {};   // COD -> produto | false (não está no Salesforce)
  // 05/11/2026 (RECORTE MSB): por que o Salesforce não trouxe o produto — a
  // tela mostra embaixo do item (o Fabricante e o RMS vêm dele): '' = respondeu
  var _sfMotivo = '';
  function sfMotivo() { return _sfMotivo; }
  function produtosSf(lista) {
    var cods = (lista || []).map(normCod).filter(function (c, i, l) { return c && c.length <= 60 && l.indexOf(c) === i; });
    var falta = cods.filter(function (c) { return !(c in _sf); }), lotes = [];
    for (var i = 0; i < falta.length; i += 80) lotes.push(falta.slice(i, i + 80));
    return Promise.all(lotes.map(function (l) {
      return api('cot-casos?produtos=' + encodeURIComponent(l.join(','))).then(function (j) {
        var ps = (j && j.produtos) || {};
        // resposta pela metade (Salesforce fora do ar ou sem configurar): só guarda o que veio
        var inteira = !!(j && j.produtos && j.configurado !== false && !j.erro);
        _sfMotivo = inteira ? '' : !j || !j.produtos ? 'o portal não respondeu a consulta ao Salesforce'
          : j.configurado === false ? 'o Salesforce não está configurado no portal (SF_CLIENT_ID e SF_CLIENT_SECRET)' : String(j.erro || 'o Salesforce não respondeu');
        l.forEach(function (c) { if (ps[c]) _sf[c] = ps[c]; else if (inteira) _sf[c] = false; });
      }, function (e) { _sfMotivo = 'a consulta ao Salesforce falhou: ' + ((e && e.message) || e); });
    })).then(function () { var out = {}; cods.forEach(function (c) { if (_sf[c]) out[c] = _sf[c]; }); return out; });
  }
  // o texto do produto na proposta: a descrição do cadastro e o complemento
  // (o campo do Salesforce "para ser impresso na proposta em PDF")
  function descricaoSf(p) { return p ? [p.descricao, p.complemento].filter(Boolean).join(' — ') : ''; }
  // os itens com produto no Salesforce: it._sf = o produto (a dica "Na
  // proposta") e, sem soDica, o fabricante e o RMS do cadastro entram no
  // item no lugar do que a IA leu. Devolve quantos itens mudaram.
  function completarDoSf(itens, soDica) {
    var com = (itens || []).filter(function (it) { return it.codigo || it._sf; });
    if (!com.length) return Promise.resolve(0);
    return produtosSf(com.map(function (it) { return it.codigo; })).then(function (ps) {
      var n = 0;
      com.forEach(function (it) {
        var p = (it.codigo && ps[normCod(it.codigo)]) || null;
        var antes = [it.marca, it.registro, it._sf ? it._sf.id : ''].join('|');
        it._sf = p;
        if (p && !soDica) { if (p.fabricante) it.marca = p.fabricante.slice(0, 80); if (p.rms) it.registro = p.rms; }
        if ([it.marca, it.registro, p ? p.id : ''].join('|') !== antes) n++;
      });
      return n;
    });
  }
  // a dica embaixo da descrição do item: o que vai na proposta
  function dicaSf(it) {
    var p = it && it._sf;
    // RECORTE MSB: o código é nosso, mas o Salesforce não respondeu — diz por quê
    if (!p) return it && it.codigo && it._cod && it._cod.st === 'ok' && _sfMotivo && !(normCod(it.codigo) in _sf)
      ? '<small class="cot-sf cot-sf-falha" title="O Fabricante e o RMS vêm do cadastro do Salesforce">Fabricante e RMS não vieram: ' + esc(_sfMotivo) + '</small>' : '';
    var t = descricaoSf(p);
    var tudo = t + (p.fabricante ? ' · ' + p.fabricante : '') + (p.rms ? ' · RMS ' + p.rms : p.isento ? ' · isento de RMS' : '');
    return '<small class="cot-sf" title="' + esc('Do cadastro do Salesforce — vai assim na proposta: ' + tudo) + '"><b>Na proposta</b>' + esc(t) + '</small>';
  }

  /* ── cotação × pedido ───────────────────────────────────────── */
  // casa cada item do pedido com um item da cotação: 1º pelo código
  // (Biomedical ou do comprador), 2º pela descrição (palavras em comum).
  // st: ok (mesma qtd e preço) · dif (preço ou qtd diferente) · fora (cotado,
  // não pedido) · extra (pedido sem estar na cotação). 22/10/2026: o preço é
  // igual até 1 centavo (era 0,5%) — virar pedido pelo PDF barra a diferença;
  // a mesma regra do confrontar do servidor (api/shared/cot-motor.js)
  function palavras(s) { return norm(s).replace(/[^a-z0-9.]+/g, ' ').split(' ').filter(function (w) { return w.length > 1; }); }
  function parecido(a, b) {
    if (chave(a) && chave(a) === chave(b)) return 1;   // a mesma descrição (até a curtinha)
    var A = palavras(a), B = palavras(b); if (!A.length || !B.length) return 0;
    var comum = A.filter(function (w) { return B.indexOf(w) >= 0; }).length;
    return comum / Math.max(A.length, B.length);
  }
  // 22/10/2026 (pedido do usuário: "não comparou o código do pedido com o
  // código da cotação e sim o nome — esses dois são a mesma coisa"): o item
  // do PEDIDO sem o código Biomedical (só o nome, ou o código do comprador)
  // ganha o código do item da COTAÇÃO que é o mesmo produto: o código aparece
  // na linha do pedido, ou o nome do pedido bate com o do CADASTRO do código
  // (o Salesforce; sem ele, o nome do BI) ou com o da cotação. O código do
  // pedido que já casa fica. Devolve os produtos do pedido (cópias) com o
  // código — o que o pedido trazia vai em codigoPedido. O servidor confere
  // pelo código, então tela e servidor seguem iguais.
  function casarCodigos(cotados, pedidos, nomesDe) {
    var mesmo = function (a, b) { var x = chave(a); return !!x && x === chave(b); };
    var doItem = function (p, it) { return mesmo(p.codigo, it.codigo) || mesmo(p.codigo, it.codigoCliente); };
    // o código na linha do pedido: um "pedaço" igual a ele (TR03, (AM0301)…) ou, o
    // código comprido, dentro do texto
    var naLinha = function (p, cod) {
      var k = chave(cod); if (k.length < 4) return false;
      var txt = String(p.descricao || '') + ' ' + String(p.codigo || '');
      return txt.split(/[\s(),;:\/\[\]]+/).some(function (t) { return chave(t) === k; }) || (k.length >= 8 && chave(txt).indexOf(k) >= 0);
    };
    var usados = {}, out = (pedidos || []).map(function (p) { return Object.assign({}, p); });
    out.forEach(function (p) { (cotados || []).forEach(function (it, i) { if (doItem(p, it)) usados[i] = 1; }); });
    out.forEach(function (p) {
      if ((cotados || []).some(function (it) { return doItem(p, it); })) return;
      var alvo = -1, melhor = 0;
      (cotados || []).forEach(function (it, i) {
        if (usados[i] || !it.codigo) return;
        var sc = naLinha(p, it.codigo) ? 2 : Math.max.apply(null, [0].concat((nomesDe ? nomesDe(it) : [it.descricao]).map(function (nm) { return parecido(nm, p.descricao); })));
        if (sc > melhor && sc >= 0.5) { melhor = sc; alvo = i; }
      });
      if (alvo >= 0) { usados[alvo] = 1; if (p.codigo) p.codigoPedido = p.codigo; p.codigo = cotados[alvo].codigo; }
    });
    return out;
  }
  // o mesmo, buscando o nome do cadastro de cada código da cotação no Salesforce
  // (a consulta do servidor, sem o Power BI) — fora do ar, segue com o que tiver
  function codigosDoPedido(cotados, pedidos) {
    var cods = (cotados || []).map(function (it) { return it.codigo; }).filter(Boolean);
    return (cods.length ? produtosSf(cods).catch(function () { return {}; }) : Promise.resolve({})).then(function (sf) {
      return casarCodigos(cotados, pedidos, function (it) {
        var p = sf[normCod(it.codigo)] || it._sf, n = produtoDoCodigo(it.codigo);
        return [it.descricao, p ? descricaoSf(p) : '', p ? p.descricao : '', n && n.nome ? n.nome : ''].filter(Boolean);
      });
    });
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
      var mesmoPreco = Math.abs((Number(c.valorUnitario) || 0) - (Number(p.valorUnitario) || 0)) <= 0.010001;
      linhas.push({ st: mesmaQtd && mesmoPreco ? 'ok' : 'dif', cot: c, ped: p, mesmaQtd: mesmaQtd, mesmoPreco: mesmoPreco });
    });
    (cotados || []).forEach(function (c, i) { if (!usados[i]) linhas.push({ st: 'fora', cot: c }); });
    var conta = function (s) { return linhas.filter(function (l) { return l.st === s; }).length; };
    return { linhas: linhas, ok: conta('ok'), dif: conta('dif'), fora: conta('fora'), extra: conta('extra') };
  }

  // 29/10/2026: os LOTES que o PDF do cliente traz (a relação de materiais da
  // cirurgia, lida pelo perfil 'consignado'), por item da cotação — o mesmo
  // casamento do comparar (o código, senão a descrição parecida); o mesmo
  // produto em mais de uma linha (lotes diferentes) junta: [[lotes do item 0], …]
  function lotesDoPdf(cotados, produtos) {
    var out = (cotados || []).map(function () { return []; });
    (produtos || []).forEach(function (p) {
      var lote = String(p.lote || '').trim().toUpperCase(); if (!lote) return;
      var cp = chave(p.codigo), alvo = -1;
      if (cp) (cotados || []).some(function (c, i) { if (chave(c.codigo) === cp || chave(c.codigoCliente) === cp) { alvo = i; return true; } return false; });
      if (alvo < 0) { var melhor = 0; (cotados || []).forEach(function (c, i) { var s = parecido(c.descricao, p.descricao); if (s > melhor && s >= 0.5) { melhor = s; alvo = i; } }); }
      if (alvo >= 0 && out[alvo].indexOf(lote) < 0) out[alvo].push(lote);
    });
    return out;
  }

  /* ── o IPI dos itens (29/10/2026) ────────────────────────────────── */
  // Pedido do usuário: "um checkbox ao lado de total, falando TEM IPI? — a
  // pessoa clica e insere o IPI do produto; essa informação sai no PDF da
  // proposta quando houver". it.ipi = a alíquota em % (0 a 100); o total
  // cotado segue SEM o IPI (o funil, os valores) — o IPI soma por fora
  function ipiDe(it) { var p = Number(it && it.ipi) || 0; return p > 0 && p <= 100 ? p : 0; }
  function temIpi(itens) { return (itens || []).some(function (it) { return ipiDe(it) > 0; }); }
  function valorIpi(it) { return (Number(it && it.quantidade) || 0) * (Number(it && it.valorUnitario) || 0) * ipiDe(it) / 100; }
  function totalIpi(itens) { return (itens || []).reduce(function (s, it) { return s + valorIpi(it); }, 0); }
  function pctIpi(p) { return (Number(p) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%'; }

  /* ── o resultado de cada item (20/10/2026) ──────────────────────── */
  // ganho ou perdido, marcado item a item (acao 'resultado'). Sem a marca,
  // vale o da cotação (implicito) — a régua do Funil de Vendas da Licitação:
  // Virou pedido -> ganho; Perdida, Vencida ou Cancelada (não virou) ->
  // perdido; em aberto, o item segue sem resultado (em andamento).
  // r: 'ganho' | 'perdido' | ''
  var RESULTADOS = { ganho: 'Ganho', perdido: 'Perdido' };
  function resultadoItem(marca, faseCaso) {
    if (marca === 'ganho' || marca === 'perdido') return { r: marca, implicito: false };
    var f = fase(faseCaso);
    if (f && f.ganha) return { r: 'ganho', implicito: true };
    if (f && f.perdida) return { r: 'perdido', implicito: true };
    return { r: '', implicito: false };
  }

  /* ── ponte com o PI · Pedido ─────────────────────────────────── */
  // mesmo caminho do Customer Service: o PDF (e a leitura, se já houver)
  // vai por IndexedDB (customer-service-pi.js) e o PI abre com ?cot=COT-…
  // RECORTE MSB: o PI da MSB tem a área demandante fixa PEDIDOINTELIGENTE (MSB)
  var AREA_PI = { 'venda recorrente': 'PEDIDOINTELIGENTE (MSB)', 'venda consultiva': 'PEDIDOINTELIGENTE (MSB)', 'bio.id': 'PEDIDOINTELIGENTE (MSB)', 'bioid': 'PEDIDOINTELIGENTE (MSB)' };
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
    // o pedido à mão (21/10/2026): sem PDF — o PI chega com o comprador e os
    // itens GANHOS da cotação no lugar da leitura do PDF
    var manual = !!c.pedido.manual;
    // RECORTE MSB (05/11/2026, pedido do dono): o PI · Pedido abre NESTA aba —
    // sem guia nova; a oportunidade é marcada "aberta no PI" antes de sair
    toast('Abrindo o PI · Pedido', 'Preparando o pedido da oportunidade ' + c.numero + '…', '');
    var destino = new URL('pedido-inteligente.html?cot=' + encodeURIComponent(c.numero), location.href).href;
    return (manual ? Promise.resolve(null) : baixarAnexo(c.numero, c.pedido.anexoId)).then(function (arq) {
      var ganhos = (c.itens || []).filter(function (it) { return it.resultado === 'ganho'; });
      // 22/10/2026 (pedido do usuário: "no pedido à mão, aproveitar as informações
      // da cotação — itens, quantidade, valor, CNPJ… tudo o que o PI usa"): o
      // endereço de entrega, o e-mail, a condição de pagamento, o frete e a
      // observação da cotação também vão; o PI preenche só o que estiver vazio
      var cli = c.cliente || {}, co = c.condicoes || {};
      var endereco = [cli.endereco, [cli.cidade, cli.uf].filter(Boolean).join('/'), cli.cep ? 'CEP ' + formatar('cep', cli.cep) : ''].filter(Boolean).join(' - ');
      var obs = ['Cotação ' + c.numero + (c.cotacaoId ? ' · ' + (c.portal || '') + ' nº ' + c.cotacaoId : ''), String(co.observacao || '').trim()].filter(Boolean).join(' · ');
      var lidaAMao = manual ? { dados: {
        cnpj: cli.cnpj || '', nomeCliente: cli.nome || '', ordemDeCompra: c.pedido.oc || '',
        enderecoEntrega: endereco, email: (c.contato && c.contato.email) || '', observacao: obs, condicaoPagamento: co.pagamento || '',
        produtos: ganhos.map(function (it) { return { codigo: it.codigo || '', descricao: it.descricao || '', quantidade: it.quantidade || 0, valorUnitario: it.valorUnitario || 0 }; })
      }, avisos: [] } : null;
      return W.CSPI.guardar({
        numero: c.numero, origem: 'cotacao', manual: manual,
        arquivo: arq ? arq.nome : '', tipo: arq ? (arq.tipo || 'application/pdf') : '', base64: arq ? arq.base64 : '',
        contato: { nome: (c.contato && c.contato.nome) || '', email: (c.contato && c.contato.email) || '' },
        assunto: 'Cotação ' + tituloCaso(c) + (c.cliente && c.cliente.nome ? ' · ' + c.cliente.nome : ''),
        conta: c.cliente ? { nome: c.cliente.nome || '', cnpj: c.cliente.cnpj || '', codigo: c.cliente.codigo || '', uf: c.cliente.uf || '' } : null,
        portal: c.portal || '', empresa: c.empresa || 'MSB', areaPI: areaPI(c),
        oc: (c.pedido && c.pedido.oc) || '',
        // o que a cotação sabe do pedido (o PI completa os campos vazios)
        cotacao: { endereco: endereco, email: (c.contato && c.contato.email) || '', observacao: obs, pagamento: co.pagamento || '', frete: freteCifFob(co.frete) || co.frete || '', entrega: co.entrega || '' },
        extracao: lidaAMao || (extracao && extracao.dados ? { dados: extracao.dados, avisos: extracao.avisos || [] } : null)
      });
    }).then(function () {
      return api('cot-casos', { acao: 'pi', numero: c.numero, estado: 'em_andamento' }).catch(function () { return null; });
    }).then(function (j) {
      W.location.href = destino;
      return j;
    }).catch(function (e) {
      toast('Não consegui preparar o pedido', e.message, 'erro');
      return false;
    });
  }

  /* ── o ESTOQUE DA VENDA (05/11/2026, RECORTE MSB — pedido do dono) ── */
  // "Na hora de digitar o código na oportunidade, ele trazer o estoque — o
  // mesmo que o PI · Pedido do portal da MSB usa": o /api/pedido-lotes (o
  // Dynamics, empresa msb, depósito ALMOX-PA inteiro (05/11: sem filtro de localização), a
  // Quantidade física disponível somada). O painel agrupa os itens pelo
  // código: PEDIDO (a soma das quantidades) × TEMOS (o disponível) × FALTA e a
  // SITUAÇÃO (completo, parcial, sem estoque). Cache por código: 2 min.
  var _est = {}, _estMeta = null, EST_TTL = 2 * 60e3;
  function codsDe(itens) {
    var l = [];
    (itens || []).forEach(function (it) { var k = normCod(it && it.codigo); if (k && l.indexOf(k) < 0) l.push(k); });
    return l;
  }
  function estoqueFresco(k) { return !!(_est[k] && Date.now() - _est[k].t < EST_TTL); }
  // { configurado, deposito, localizacao, aviso, em, itens: { COD: { disponivel: Number|null, erro } } }
  function estoqueDe(codigos) {
    var cods = codsDe((codigos || []).map(function (c) { return { codigo: c }; }));
    var falta = cods.filter(function (k) { return !estoqueFresco(k); });
    var p = !falta.length ? Promise.resolve() : api('pedido-lotes', { codigos: falta }).then(function (j) {
      if (!j || j.configured === false) { _estMeta = { configurado: false }; return; }
      _estMeta = { configurado: true, deposito: j.deposito || j.location || '', localizacao: j.localizacao || '', aviso: j.aviso || '', em: Date.now() };
      var it = j.itens || {};
      falta.forEach(function (k) {
        var x = it[k];
        _est[k] = { t: Date.now(), disponivel: x && x.disponivel != null ? Number(x.disponivel) : null, erro: (x && x.erro) || (x ? '' : 'sem resposta do Dynamics') };
      });
    });
    return p.then(function () {
      var out = {};
      cods.forEach(function (k) { out[k] = _est[k] || { disponivel: null, erro: 'sem resposta' }; });
      return Object.assign({ itens: out }, _estMeta || { configurado: true });
    });
  }
  var IC_EST = svg('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>');
  var SIT_EST = { ok: 'completo', parcial: 'parcial', zero: 'sem estoque', livre: 'disponível', nd: 'sem consulta' };
  // est = null: consultando; erro = a consulta falhou
  function htmlEstoque(itens, est, erro) {
    var linhas = [], por = {};
    (itens || []).forEach(function (it) {
      var k = normCod(it && it.codigo); if (!k) return;
      if (!por[k]) { por[k] = { cod: k, desc: '', pedido: 0 }; linhas.push(por[k]); }
      por[k].pedido += Number(it.quantidade) || 0;
      if (!por[k].desc) por[k].desc = String(it.descricao || (produtoDoCodigo(k) || {}).nome || '').trim();
    });
    var h = '<h5 class="cot-est-h">' + IC_EST + 'Estoque da venda</h5>';
    if (!linhas.length) return h + '<div class="cot-est neutro"><p class="cot-est-msg">Digite o código do produto nos itens para ver o estoque.</p></div>';
    if (erro) return h + '<div class="cot-est alerta"><p class="cot-est-msg">' + IC.alert + 'Não consegui consultar o estoque: ' + esc(erro) + '</p></div>';
    if (!est) return h + '<div class="cot-est neutro"><p class="cot-est-msg"><span class="cs-spin"></span> Consultando o estoque no Dynamics…</p></div>';
    if (est.configurado === false) return h + '<div class="cot-est neutro"><p class="cot-est-msg">' + IC.info + 'A consulta ao estoque (Dynamics) não está ligada no portal.</p></div>';
    var n = { ok: 0, ruim: 0, nd: 0 };
    var corpo = linhas.map(function (l) {
      var e = est.itens[l.cod] || {}, temos = e.disponivel, sit;
      if (temos == null) sit = 'nd';
      else if (!(l.pedido > 0)) sit = temos > 0 ? 'livre' : 'zero';
      else sit = temos >= l.pedido ? 'ok' : temos > 0 ? 'parcial' : 'zero';
      if (sit === 'ok' || sit === 'livre') n.ok++; else if (sit === 'nd') n.nd++; else n.ruim++;
      var falta = temos == null || !(l.pedido > 0) ? 0 : Math.max(0, l.pedido - temos);
      return '<tr class="s-' + sit + '"><td class="it"><b>' + esc(l.cod) + '</b>' + (l.desc ? '<small title="' + esc(l.desc) + '">' + esc(l.desc) + '</small>' : '') + '</td>' +
        '<td class="n">' + (l.pedido > 0 ? qtd(l.pedido) : '—') + '</td>' +
        '<td class="n temos">' + (temos == null ? '<span title="' + esc(e.erro || '') + '">—</span>' : qtd(temos)) + '</td>' +
        '<td class="n falta">' + (falta > 0 ? qtd(falta) : '—') + '</td>' +
        '<td class="sit"><span class="cot-est-chip s-' + sit + '">' + SIT_EST[sit] + '</span></td></tr>';
    }).join('');
    var cls = n.ruim ? 'alerta' : n.nd ? 'neutro' : 'ok';
    var tit = n.ruim ? 'Estoque insuficiente para ' + n.ruim + ' de ' + linhas.length + ' item(ns)'
      : n.nd ? (n.ok ? 'Estoque suficiente para ' + n.ok + ' item(ns) — ' : '') + 'sem consulta para ' + n.nd + ' item(ns)'
      : 'Estoque suficiente para toda a venda';
    var onde = ['Dynamics · empresa MSB', est.deposito ? 'depósito ' + est.deposito : '', est.localizacao ? 'localizações ' + est.localizacao : ''].filter(Boolean).join(' · ');
    return h + '<div class="cot-est ' + cls + '"><div class="cot-est-top"><b>' + IC_EST + esc(tit) + '</b><span title="' + esc(onde) + '">estoque de ' + esc(dataBR(new Date().toISOString())) + '</span></div>' +
      '<table class="cot-est-t"><thead><tr><th>Item</th><th class="n">Pedido</th><th class="n">Temos</th><th class="n">Falta</th><th>Situação</th></tr></thead><tbody>' + corpo + '</tbody></table>' +
      (est.aviso ? '<p class="cot-est-aviso">' + esc(est.aviso) + '</p>' : '') + '</div>';
  }
  // pinta o painel em `el` com o estoque dos `itens` (a última chamada ganha)
  function pintarEstoque(el, itens) {
    if (!el) return Promise.resolve();
    var seq = (el._estSeq || 0) + 1; el._estSeq = seq;
    var cods = codsDe(itens);
    if (!cods.length) { el.innerHTML = htmlEstoque(itens); return Promise.resolve(); }
    // o que ainda não está no cache mostra "consultando" (sem piscar o que já está na tela)
    if (!cods.every(estoqueFresco) && !el.querySelector('.cot-est-t')) el.innerHTML = htmlEstoque(itens, null);
    return estoqueDe(cods).then(function (est) { if (el._estSeq === seq) el.innerHTML = htmlEstoque(itens, est); },
      function (e) { if (el._estSeq === seq) el.innerHTML = htmlEstoque(itens, null, (e && e.message) || String(e)); });
  }

  /* ── o SUBMÓDULO do CRM (04/11/2026) ─────────────────────────── */
  // As telas das oportunidades (estas páginas) são as do CRM do Comercial:
  // Venda Recorrente e BIO.ID usam as MESMAS páginas, cada uma presa à sua
  // unidade de negócio pelo ?sub= (window.BMCRM, nav-sidebar.js — guardado
  // na aba). Aqui: o filtro da lista (sem submódulo, tudo o que a pessoa vê,
  // como antes), o nome do submódulo no cabeçalho e os links entre as
  // páginas levando o ?sub=. Quem decide o que a pessoa vê segue sendo o
  // servidor (a unidade do RLS).
  function crm() { return W.BMCRM || null; }
  function subAtual() { var M = crm(), id = M ? M.atual() : ''; return id ? M.porId(id) : null; }
  function doSubmodulo(casos) { var M = crm(); return M ? M.filtrar(casos || []) : (casos || []); }
  // a pessoa não é da unidade do submódulo (o servidor não manda nada dela):
  // a faixa diz, em vez de a tela parecer vazia por defeito
  function foraDoSubmodulo(eu) {
    var M = crm(), s = subAtual();
    if (!M || !s || !eu || eu.admin || eu.full || !eu.unidadeConfirmada) return '';
    return M.temSub(eu, s.id) ? '' : 'Você não é da unidade <b>' + esc(s.rotulo) + '</b> no Power BI — aqui só aparecem as oportunidades dela. <a href="comercial-cot-funil.html">Voltar ao CRM</a>';
  }
  function guardarPessoa(eu) { var M = crm(); if (M && eu && eu.email) { M.guardarPessoa(eu.email, eu); if (typeof W.bmPodarCrm === 'function') W.bmPodarCrm(eu.email); } }
  function comSub(href) { var M = crm(); return M ? M.comSub(href) : href; }
  function marcarSubmodulo() {
    var s = subAtual();
    // RECORTE MSB (05/11/2026, pedido do dono): o CRM da MSB não tem submódulo
    // — abre direto no Funil. O nome "Venda Recorrente" não entra no caminho
    // nem no título (fica o "Funil de Oportunidade" do HTML); por dentro, a
    // unidade da cotação continua VENDA RECORRENTE.
    if (s) D.body.setAttribute('data-crm-sub', s.id);
    // os links entre as páginas das oportunidades levam o submódulo (abrir em
    // outra aba também): os do HTML agora, os desenhados depois no mousedown
    Array.prototype.forEach.call(D.querySelectorAll('a[href*="comercial-cot-"]'), function (a) {
      if (!a.closest('.area-sidebar')) a.setAttribute('href', comSub(a.getAttribute('href')));
    });
  }
  if (W.BMCRM) {
    D.addEventListener('mousedown', function (ev) {
      var a = ev.target.closest && ev.target.closest('a[href*="comercial-cot-"]');
      if (a && !a.closest('.area-sidebar')) a.setAttribute('href', comSub(a.getAttribute('href')));
    }, true);
    if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', marcarSubmodulo); else marcarSubmodulo();
  }

  W.COT = {
    subAtual: subAtual, doSubmodulo: doSubmodulo, foraDoSubmodulo: foraDoSubmodulo, guardarPessoa: guardarPessoa, comSub: comSub,
    $: $, esc: esc, norm: norm, chave: chave, ms: ms, pad: pad, dataBR: dataBR, dataPortal: dataPortal, diaBR: diaBR, paraInput: paraInput,
    quando: quando, chegada: chegada, num: num, brl: brl, brlCurto: brlCurto, int: int, pct: pct, qtd: qtd, bytes: bytes, cnpjMask: cnpjMask,
    UFS: UFS, digitos: digitos, cnpjValido: cnpjValido, cpfValido: cpfValido, emailValido: emailValido, foneDigitos: foneDigitos, ufDoCep: ufDoCep,
    formatar: formatar, validar: validar, avisoCepUf: avisoCepUf, mascarar: mascarar,
    corDe: corDe, coresDistintas: coresDistintas, avatar: avatar, primeiroNome: primeiroNome, nomeDoEmail: nomeDoEmail, debounce: debounce, lerLocal: lerLocal, gravarLocal: gravarLocal, quieto: quieto,
    lotesDoPdf: lotesDoPdf, ipiDe: ipiDe, temIpi: temIpi, valorIpi: valorIpi, totalIpi: totalIpi, pctIpi: pctIpi,
    IC: IC, svg: svg, FASES: FASES, FASES_AMOSTRA: FASES_AMOSTRA, faseAtual: faseAtual, faseDe: faseDe, fase: fase, aberta: aberta, chipFase: chipFase, prazoDe: prazoDe, chipPrazo: chipPrazo, chipPi: chipPi, numeroOv: numeroOv, tituloCaso: tituloCaso, tokenPbi: tokenPbi, esquecerTokenPbi: esquecerTokenPbi,
    api: api, aguardarLogin: aguardarLogin, toast: toast, dialogo: dialogo, fecharDialogo: fecharDialogo,
    lerArquivo: lerArquivo, ehPdf: ehPdf, bytesParaB64: bytesParaB64, b64ParaBytes: b64ParaBytes, baixarAnexo: baixarAnexo, urlDoArquivo: urlDoArquivo, abrirAnexo: abrirAnexo,
    leitorPronto: leitorPronto, textoDoPdf: textoDoPdf, lerComIA: lerComIA, dadosDaLeitura: dadosDaLeitura, freteCifFob: freteCifFob, contatoDoSetor: contatoDoSetor, htmlExtras: htmlExtras, lerExtras: lerExtras, comoSaiu: comoSaiu, idDaCotacao: idDaCotacao, dataDoTexto: dataDoTexto, validadeDe: validadeDe,
    hojeIso: hojeIso, venceu: venceu,
    normCod: normCod, validarCodigos: validarCodigos, produtoDoCodigo: produtoDoCodigo, codigosNaDescricao: codigosNaDescricao,
    faturamentoDoCliente: faturamentoDoCliente, tabelaDePrecos: tabelaDePrecos, acimaDasReferencias: acimaDasReferencias, textoAcima: textoAcima, refsPreco: refsPreco, MESES_FAT: MESES_FAT,
    conferirItens: conferirItens, itensComCodigoRuim: itensComCodigoRuim, statusCodigo: statusCodigo,
    produtosSf: produtosSf, descricaoSf: descricaoSf, sfMotivo: sfMotivo, completarDoSf: completarDoSf, dicaSf: dicaSf,
    codigosDoTexto: codigosDoTexto, codigosNossosNoTexto: codigosNossosNoTexto, casarPeloTexto: casarPeloTexto,
    estoqueDe: estoqueDe, htmlEstoque: htmlEstoque, pintarEstoque: pintarEstoque,
    comparar: comparar, parecido: parecido, casarCodigos: casarCodigos, codigosDoPedido: codigosDoPedido, RESULTADOS: RESULTADOS, resultadoItem: resultadoItem, abrirNoPI: abrirNoPI
  };
})();
