// ================================================================
// api/shared/cot-motor.js — o motor do módulo COTAÇÕES (Comercial)
//
// A cotação que a pessoa respondeu num PORTAL DE COMPRAS (Bionexo, Apoio
// Cotações, GTPlan, Síntese…) vira um CASO, no molde do Customer Service:
// número próprio (COT-AAAA-NNNNNN), dono, fase, notas e o histórico campo a
// campo, sempre com a pessoa do login (id token VALIDADO do Entra).
//
// O caminho da cotação (as FASES — o funil de conversão sai delas):
//
//   Cotada -> Em negociação -> Virou pedido
//                         \-> Perdida | Vencida | Cancelada  (fora do funil)
//
//   . a cotação SEMPRE nasce "Cotada" (09/10/26: o agente só recebe a
//     proposta já respondida no portal — "Em cotação" saiu; caso antigo
//     nessa fase é lido como Cotada);
//   . "Virou pedido" EXIGE o PDF do pedido anexado (acao 'pedido'): é ele
//     que segue para o PI · Pedido e prova a conversão;
//   . "Perdida" exige o motivo (lista editável em Configurações);
//   . "Vencida" é AUTOMÁTICA: a DATA DE VENCIMENTO (o "Vencimento" do PDF,
//     ou a data da cotação + os dias de validade do PDF) passou com a cotação
//     ainda aberta — o caso sai sozinho do funil (varrerVencidas, a cada
//     leitura da lista). Já nasce Vencida quando o PDF chega vencido. O dado
//     é datas.validade (o nome ficou do começo do módulo);
//   . o pedido que o PI já lançou no Dynamics não deixa a cotação sair de
//     "Virou pedido" (a venda aconteceu);
//   . a cotação FECHA com a(s) ORDEM(NS) DE VENDA do Dynamics (acao 'ov',
//     19/10/26): vale para o pedido lançado pelo PI e para o lançado à mão,
//     uma cotação pode ter mais de uma OV (pedido quebrado), e o número é
//     conferido no F&O (shared/cot-ov.js) — OV que não existe, que já está
//     em outra cotação ou de outro cliente pede confirmação. Com OV a
//     cotação também não sai de "Virou pedido" (tirar a OV destrava). Não há
//     fase nova: a fila "Aguardando OV" é a do pedido lançado sem OV.
//
// Empresa: sempre BIO. Área: a da EQUIPE de segurança (grupo do Entra) de
// quem registra — não se escolhe na tela.
//
// De onde nasce o caso: o Agente de Cotações (pages/comercial-cot-nova.html)
// lê o PDF da cotação no navegador (pi-pdf-texto.js), a IA extrai portal,
// número, cliente, prazos e itens (/api/pedido-extrair, perfil 'cotacao'),
// a pessoa confere e manda tudo para cá ({acao:'novo'}) — o PDF junto, que
// fica guardado no caso.
//
// Duplicidade: "portal + nº da cotação" é a chave (índice.chaves). A mesma
// cotação inserida duas vezes é recusada (409, com o número do caso que já
// existe) a não ser que a pessoa confirme ("criar mesmo assim").
//
// Acesso: SÓ o dono do portal (DONO, abaixo), a pedido dele (08/10/26). Não
// há equipe, variável nem admin que abra: o portão (exigirEquipe) compara o
// e-mail do id token VALIDADO com o DONO, e o nav-sidebar.js esconde menu,
// card e agente de qualquer outro login. Abrir um dia = mudar o código
// (exigirEquipe aqui + restrito() do nav-sidebar.js).
// ================================================================

const crypto = require('crypto');
const store = require('./cot-store');
const auth = require('./auth');
const erp = require('./cot-erp');
const ovD365 = require('./cot-ov');

const FASES = [
  { id: 'cotada', nome: 'Cotada', aberta: true, desc: 'proposta enviada no portal, aguardando o resultado' },
  { id: 'negociacao', nome: 'Em negociação', aberta: true, desc: 'contraproposta, ajuste de preço ou análise do comprador' },
  { id: 'pedido', nome: 'Virou pedido', ganha: true, desc: 'o portal gerou o pedido — o PDF dele está no caso' },
  { id: 'perdida', nome: 'Perdida', perdida: true, desc: 'o comprador fechou com outro fornecedor' },
  { id: 'vencida', nome: 'Vencida', perdida: true, desc: 'a data de vencimento passou sem resultado — sai sozinha do funil' },
  { id: 'cancelada', nome: 'Cancelada', perdida: true, desc: 'cancelada pelo comprador ou deserta' }
];
const FASES_INICIAIS = ['cotada'];
// "Em cotação" existiu até 09/10/26: o caso antigo nessa fase é Cotada
function faseAtual(id) { return id === 'em_cotacao' ? 'cotada' : id; }
function fase(id) { id = faseAtual(id); return FASES.filter(function (f) { return f.id === id; })[0] || null; }
function nomeFase(id) { const f = fase(id); return f ? f.nome : String(id || ''); }
function fechada(id) { const f = fase(id); return !!(f && !f.aberta); }
function aberta(id) { const f = fase(id); return !!(f && f.aberta); }
const MOTIVO_VENCIDA = 'Proposta vencida';
// quem assina o que o portal faz sozinho (a varredura das vencidas)
const SISTEMA = { email: '', nome: 'Portal (automático)', sistema: true };

// o único login que entra no módulo
const DONO = 'leonardo.barbosa@biomedical.com.br';
// Os portais que o PI · Pedido já conhece (lista PORTAIS do pedido-inteligente.js,
// que vai ao Dynamics) + GTHealth (o Customer Service vê chegar dele).
const PORTAIS_PADRAO = ['Bionexo', 'Apoio Cotações', 'GTPlan', 'Síntese', 'Smart Compras', 'Uniube',
  'VSSupply - Sta Catarina', 'VSSupply - Sta Catarina/MSB', 'GTHealth', 'Outro'];
const MOTIVOS_PERDA_PADRAO = ['Preço acima do concorrente', 'Prazo de entrega', 'Marca/produto não aceito',
  'Não atende à especificação', 'Documentação/registro', 'Sem estoque', 'Comprador não informou o motivo', 'Outro'];
const MOTIVOS_CANCEL_PADRAO = ['Cancelada pelo comprador', 'Deserta / sem resultado',
  'Não vamos fornecer (declinada)', 'Outro'];
const EMPRESAS_PADRAO = ['BIO', 'MSB', 'BIO.ID'];
// a cotação é sempre da BIO (09/10/26)
const EMPRESA_FIXA = 'BIO';
// as mesmas áreas demandantes do PI · Pedido (o caso já leva a área para o PI)
const AREAS_PADRAO = ['Venda Recorrente', 'Venda Consultiva', 'BIO.ID'];
// a Biomedical aparece no PDF como FORNECEDORA — nunca é o cliente
const CNPJS_PROPRIOS = ['19848316000166'];
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

// anexos: PDF (cotação e pedido) e o que mais o time juntar ao caso
const ANEXO_MAX = Number(process.env.COT_ANEXO_MAX_MB || 10) * 1048576;
const TIPOS_ARQUIVO = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword',
  csv: 'text/csv', txt: 'text/plain', eml: 'message/rfc822', msg: 'application/vnd.ms-outlook', zip: 'application/zip'
};

const CONFIG_VAZIA = { versao: 1, portais: null, motivosPerda: null, motivosCancelamento: null, empresas: null, areas: null, avisoDias: 2, atualizadoEm: null, atualizadoPor: '' };
const INDICE_VAZIO = { versao: 1, seq: 0, rev: 0, atualizadoEm: null, casos: [], chaves: {} };

function agora() { return new Date().toISOString(); }
function erro(status, msg, extra) { const e = new Error(msg); e.status = status; e.publicMessage = msg; if (extra) e.extra = extra; return e; }
function txt(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function texto(v, max) { return String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim().slice(0, max || 4000); }
function emailOk(e) { return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(e || '').trim()); }
// comparação tolerante: sem acento, sem caixa, só letras e números
function chaveTxt(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function anoBrasilia(iso) { return new Date((Date.parse(iso) || Date.now()) - 3 * 3600e3).getUTCFullYear(); }
// o DIA em Brasília (UTC-3): a troca de fase às 22h de segunda é de segunda
function diaBrasilia(iso) { const t = Date.parse(iso); return isNaN(t) ? '' : new Date(t - 3 * 3600e3).toISOString().slice(0, 10); }

// número em qualquer formato que a tela ou a IA mande: 1234.5 · "1.234,50" · "R$ 1.234,50"
function num(v) {
  if (typeof v === 'number') return isFinite(v) && v > 0 ? Math.min(v, 1e12) : 0;
  let s = String(v == null ? '' : v).trim().replace(/[^\d,.\-]/g, '');
  if (!s) return 0;
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return isFinite(n) && n > 0 ? Math.min(n, 1e12) : 0;
}

// data do portal (sem fuso: é a hora de Brasília escrita no documento)
// "10/10/2026" · "10/10/2026 14:30" · "2026-10-10" · "2026-10-10T14:30" -> "2026-10-10" | "2026-10-10T14:30"
function dataDe(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
  let a, me, d, h, mi;
  if (m) { a = +m[1]; me = +m[2]; d = +m[3]; h = m[4]; mi = m[5]; }
  else {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\D+(\d{1,2})[:h](\d{2}))?/.exec(s);
    if (!m) return '';
    d = +m[1]; me = +m[2]; a = +m[3]; if (a < 100) a += 2000; h = m[4]; mi = m[5];
  }
  if (a < 2000 || a > 2100 || me < 1 || me > 12 || d < 1 || d > 31) return '';
  const dia = String(a) + '-' + String(me).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  if (h == null || +h > 23 || +mi > 59) return dia;
  return dia + 'T' + String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}

// HOJE em Brasília (UTC-3): a Function roda em UTC e, das 21h à meia-noite,
// o dia UTC já é o seguinte
function hojeBR() { return new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); }
// a validade vale o dia inteiro: "válida até 23/10" vence em 24/10
function venceu(validade, hoje) { const v = String(validade || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(v) && v < (hoje || hojeBR()); }
// a VALIDADE em dias = data de vencimento − data da cotação ("15 dias")
function diasEntre(a, b) {
  const x = String(a || '').slice(0, 10), y = String(b || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x) || !/^\d{4}-\d{2}-\d{2}$/.test(y)) return null;
  return Math.round((Date.parse(y + 'T12:00:00Z') - Date.parse(x + 'T12:00:00Z')) / 86400e3);
}
function textoDias(n) { return n == null ? '' : n + (Math.abs(n) === 1 ? ' dia' : ' dias'); }
// A data em que a proposta vence: a validade como está no PDF ("30 dias",
// "15 dias corridos") somada à DATA DA COTAÇÃO; se o PDF trouxer a data
// ("válida até 23/10/2026"), vale ela. '' quando não dá para saber.
function validadeCalculada(textoValidade, dataCotacao) {
  const s = String(textoValidade || '');
  const m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) return dataDe(m[0]).slice(0, 10);
  const d = /(\d{1,3})\s*(?:dias?\b|d\b)/i.exec(s);
  const base = String(dataCotacao || '').slice(0, 10);
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(base)) return '';
  const t = new Date(base + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + Number(d[1]));
  return t.toISOString().slice(0, 10);
}

function cnpjDe(v) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  if (CNPJS_PROPRIOS.indexOf(d) >= 0) return '';
  if (d.length === 14 || d.length === 11) return d;
  return txt(v, 20);
}
function ufDe(v) { const u = txt(v, 2).toUpperCase(); return UFS.indexOf(u) >= 0 ? u : ''; }

// as mesmas regras da tela (cotacoes-base.js, 19/10/2026): CNPJ/CPF com o
// dígito verificador, CEP de 8 números, telefone com DDD que existe
const DDDS = ('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 ' +
  '61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99').split(' ');
function digitos(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
function dvOk(d, pesos1, pesos2) {
  const dv = function (pesos) { let s = 0; pesos.forEach(function (p, i) { s += Number(d[i]) * p; }); const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return dv(pesos1) === Number(d[pesos1.length]) && dv(pesos2) === Number(d[pesos2.length]);
}
function documentoValido(v) {
  const d = digitos(v);
  if (/^(\d)\1+$/.test(d)) return false;
  if (d.length === 14) return dvOk(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (d.length === 11) return dvOk(d, [10, 9, 8, 7, 6, 5, 4, 3, 2], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return false;
}
// sem o +55 e sem o 0 da operadora; 0800/0300 ficam
function foneDigitos(v) {
  let d = digitos(v);
  if ((d.length === 12 || d.length === 13) && d.slice(0, 2) === '55') d = d.slice(2);
  if ((d.length === 11 || d.length === 12) && d[0] === '0' && !/^0[3589]00/.test(d)) d = d.slice(1);
  return d;
}
function foneValido(v) {
  const f = foneDigitos(v);
  if (/^0[3589]00/.test(f)) return f.length === 11;
  if (DDDS.indexOf(f.slice(0, 2)) < 0) return false;
  return (f.length === 11 && f[2] === '9') || (f.length === 10 && /[2-5]/.test(f[2]));
}
function cepDe(v) { const d = digitos(v); return d.length === 8 ? d.slice(0, 5) + '-' + d.slice(5) : txt(v, 12); }
function foneDe(v) {
  if (!foneValido(v)) return txt(v, 40);
  const f = foneDigitos(v);
  if (f[0] === '0') return f.slice(0, 4) + ' ' + f.slice(4, 7) + ' ' + f.slice(7);
  return '(' + f.slice(0, 2) + ') ' + (f.length === 11 ? f.slice(2, 7) + '-' + f.slice(7) : f.slice(2, 6) + '-' + f.slice(6));
}
// os campos do comprador que não passam (vazio passa — obrigatório é outra regra)
function invalidosDe(cli, ct) {
  cli = cli || {}; ct = ct || {};
  const tem = function (v) { return v != null && String(v).trim() !== ''; };
  const l = [];
  if (tem(cli.cnpj) && !documentoValido(cli.cnpj)) l.push('CNPJ');
  if (tem(cli.cep) && digitos(cli.cep).length !== 8) l.push('CEP');
  if (tem(cli.uf) && !ufDe(cli.uf)) l.push('UF');
  if (tem(ct.telefone) && !foneValido(ct.telefone)) l.push('telefone');
  if (tem(ct.email) && !emailOk(ct.email)) l.push('e-mail');
  return l;
}
function lista(v, padrao, max) {
  const l = (Array.isArray(v) ? v : String(v == null ? '' : v).split(/\r?\n|;/))
    .map(function (x) { return txt(x, 80); }).filter(Boolean);
  const u = l.filter(function (x, i) { return l.findIndex(function (y) { return chaveTxt(y) === chaveTxt(x); }) === i; }).slice(0, max || 60);
  return u.length ? u : padrao.slice();
}

// o portal no nome que está na lista (para o funil agrupar certo):
// "BIONEXO" -> "Bionexo"; o que não está na lista fica como veio
function portalDe(v, cfg) {
  const s = txt(v, 60);
  if (!s) return '';
  const k = chaveTxt(s);
  const achou = ((cfg && cfg.portais) || PORTAIS_PADRAO).filter(function (p) { return chaveTxt(p) === k; })[0];
  return achou || s;
}
function daLista(v, l) { const k = chaveTxt(v); return k ? (l.filter(function (x) { return chaveTxt(x) === k; })[0] || '') : ''; }
function chaveDe(portal, cotacaoId) {
  const n = chaveTxt(cotacaoId);
  return n ? chaveTxt(portal || 'sem-portal') + '|' + n : '';
}

// ── config ────────────────────────────────────────────────────────
let _cfg = { em: 0, v: null };
function montarConfig(salva) {
  const s = salva || {};
  const c = JSON.parse(JSON.stringify(CONFIG_VAZIA));
  c.portais = lista(s.portais, PORTAIS_PADRAO);
  c.motivosPerda = lista(s.motivosPerda, MOTIVOS_PERDA_PADRAO);
  c.motivosCancelamento = lista(s.motivosCancelamento, MOTIVOS_CANCEL_PADRAO);
  c.empresas = lista(s.empresas, EMPRESAS_PADRAO, 12);
  c.areas = lista(s.areas, AREAS_PADRAO, 20);
  c.avisoDias = Math.max(0, Math.min(30, Math.round(Number(s.avisoDias != null ? s.avisoDias : 2)) || 0));
  c.atualizadoEm = s.atualizadoEm || null;
  c.atualizadoPor = s.atualizadoPor || '';
  return c;
}
async function lerConfig(forcar) {
  if (!forcar && _cfg.v && Date.now() - _cfg.em < 20000) return _cfg.v;
  let salva = null;
  if (store.configurado()) salva = (await store.ler(store.CONFIG, null)).dados;
  _cfg = { em: Date.now(), v: montarConfig(salva) };
  return _cfg.v;
}
async function salvarConfig(nova, quem) {
  if (!store.configurado()) throw erro(409, 'Armazenamento não configurado (COT_BLOB_URL).');
  const n = nova || {};
  const r = await store.atualizar(store.CONFIG, {}, function (s) {
    delete s.equipe;   // não existe mais equipe: o módulo é só do DONO
    ['portais', 'motivosPerda', 'motivosCancelamento', 'empresas', 'areas'].forEach(function (k) {
      if (n[k] != null) s[k] = lista(n[k], k === 'portais' ? PORTAIS_PADRAO : []);
    });
    if (n.avisoDias != null) s.avisoDias = n.avisoDias;
    s.atualizadoEm = agora();
    s.atualizadoPor = quem.email;
  });
  _cfg = { em: Date.now(), v: montarConfig(r.dados) };
  return _cfg.v;
}

// ── acesso ────────────────────────────────────────────────────────
// Fail-closed: só passa id token VALIDADO (com o AUTH_ENFORCE desligado a
// identidade legada vem de header, e header qualquer um escreve) e só do
// DONO — nem admin do portal (ADMIN_EMAILS), nem e-mail salvo em
// configuração, nem variável de ambiente abrem o módulo. (O nome
// "exigirEquipe" fica: é o porteiro que o scripts/test-api-guard.js conhece.)
async function exigirEquipe(req) {
  const r = await auth.requireUser(req);
  const email = String((r.user && r.user.email) || '').trim().toLowerCase();
  if (!r.validated || !email) throw erro(401, 'Entre com a sua conta Microsoft para usar o módulo Cotações.');
  if (email !== DONO) throw erro(403, 'O módulo Cotações é de acesso restrito.');
  const cfg = await lerConfig();
  return { email: email, nome: (r.user && r.user.name) || email, oid: (r.user && r.user.oid) || '', admin: true, cfg: cfg };
}
function pessoa(quem) { return { email: quem.email, nome: quem.nome || quem.email }; }

// ── quem registra: a EQUIPE de segurança e o contato (Entra) ────────
// A área do caso é a da equipe de segurança da pessoa — o grupo do Entra:
// "GRP-SEG-BIO-ADMINISTRATIVO" -> Administrativo, "Equipe Comercial -
// Gerente Venda Recorrente" -> Comercial. Mais de uma: Comercial, depois
// Licitação, depois a primeira em ordem alfabética (estável). O telefone,
// o cargo e o departamento vão para a PROPOSTA ("Preparado por").
// Graph app-only (o mesmo token do auth.listGroups); fora do ar = sem
// equipe, e a tela deixa a pessoa escrever a área.
function equipeDosGrupos(grupos) {
  const nomes = (grupos || []).map(function (g) { return String((g && g.name) || '').trim(); });
  const achados = [];
  nomes.forEach(function (n) {
    let m = /^GRP-SEG-BIO-(.+)$/i.exec(n), area = '';
    if (m) area = m[1].replace(/[-_]+/g, ' ');
    else if ((m = /^equipe\s+(.+?)(?:\s+[-–]\s+.*)?$/i.exec(n))) area = m[1].replace(/^(de|da|do)\s+/i, '');
    area = area.trim().toLowerCase().replace(/(^|\s)(\S)/g, function (x, a, b) { return a + b.toUpperCase(); })
      .replace(/\b(E|De|Da|Do|Das|Dos)\b/g, function (x) { return x.toLowerCase(); });
    if (area) achados.push({ grupo: n, area: area.charAt(0).toUpperCase() + area.slice(1) });
  });
  if (!achados.length) return null;
  const peso = function (a) { const k = chaveTxt(a.area); return k.indexOf('comercial') === 0 ? 0 : k.indexOf('licitac') === 0 ? 1 : 2; };
  achados.sort(function (a, b) { return peso(a) - peso(b) || a.grupo.localeCompare(b.grupo); });
  return achados[0];
}
const _perfis = new Map();
async function perfilDe(quem) {
  const vazio = { area: '', equipe: '', telefone: '', cargo: '', departamento: '' };
  const oid = String((quem && quem.oid) || '');
  if (!auth.isGuid(oid)) return vazio;
  const ja = _perfis.get(oid);
  if (ja && Date.now() - ja.em < 10 * 60e3) return ja.v;
  const v = Object.assign({}, vazio);
  try {
    const eq = equipeDosGrupos(await auth.listGroups(oid));
    if (eq) { v.area = eq.area; v.equipe = eq.grupo; }
  } catch (e) { /* sem grupos: a tela pede a área */ }
  try {
    const tok = await auth.getAppToken();
    if (tok) {
      const r = await fetch('https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(oid) + '?$select=mobilePhone,businessPhones,jobTitle,department',
        { headers: { Authorization: 'Bearer ' + tok } });
      if (r.ok) {
        const u = await r.json();
        v.telefone = txt(u.mobilePhone || (u.businessPhones || [])[0] || '', 40);
        v.cargo = txt(u.jobTitle, 80);
        v.departamento = txt(u.department, 80);
      }
    }
  } catch (e) { /* sem telefone na proposta */ }
  _perfis.set(oid, { em: Date.now(), v: v });
  return v;
}

// ── forma dos dados ───────────────────────────────────────────────
function itensDe(l) {
  return (Array.isArray(l) ? l : []).slice(0, 400).map(function (it) {
    it = it || {};
    return {
      codigo: txt(it.codigo, 40), codigoCliente: txt(it.codigoCliente, 40), descricao: txt(it.descricao, 300),
      // marca = o FABRICANTE da proposta; registro = o RMS (registro ANVISA)
      marca: txt(it.marca, 80), registro: txt(it.registro, 30), unidade: txt(it.unidade, 12),
      quantidade: num(it.quantidade), valorUnitario: num(it.valorUnitario)
    };
  }).filter(function (it) { return it.descricao || it.codigo || it.codigoCliente; });
}
function somaItens(itens) { return r2((itens || []).reduce(function (s, it) { return s + (it.quantidade || 0) * (it.valorUnitario || 0); }, 0)); }

// o que veio da tela (o Agente, ou a edição no caso) no formato do caso
function dadosDe(d, cfg) {
  d = d || {};
  const cli = d.cliente || {}, ct = d.contato || {}, dt = d.datas || {}, co = d.condicoes || {};
  const itens = itensDe(d.itens);
  const soma = somaItens(itens);
  const cotacao = dataDe(dt.cotacao).slice(0, 10);
  const valTxt = txt(co.validade, 60);
  const venc = dataDe(dt.validade).slice(0, 10) || validadeCalculada(valTxt, cotacao);
  const dias = diasEntre(cotacao, venc);
  return {
    portal: portalDe(d.portal, cfg),
    cotacaoId: txt(d.cotacaoId, 60),
    empresa: EMPRESA_FIXA,
    // a área vem da equipe de quem registra (novo() troca pela do Entra)
    area: txt(d.area, 60),
    cliente: { nome: txt(cli.nome, 160), cnpj: cnpjDe(cli.cnpj), codigo: txt(cli.codigo, 30), cidade: txt(cli.cidade, 80), uf: ufDe(cli.uf),
      endereco: txt(cli.endereco, 200), cep: cepDe(cli.cep) },
    contato: { nome: txt(ct.nome, 120), email: emailOk(ct.email) ? txt(ct.email, 200).toLowerCase() : '', telefone: foneDe(ct.telefone) },
    // a DATA DE VENCIMENTO: a que a tela mandou (o "Vencimento" lido do PDF ou
    // a que a pessoa conferiu) vale; sem ela, data da cotação + dias de validade
    datas: { cotacao: cotacao, validade: venc },
    // a condição de pagamento fica COMO VEIO no PDF (sem resumir)
    // a validade (texto) passa a ser os DIAS entre a cotação e o vencimento
    condicoes: { pagamento: txt(co.pagamento, 300), entrega: txt(co.entrega, 120), frete: txt(co.frete, 60), validade: dias != null ? textoDias(dias) : valTxt,
      medico: txt(co.medico, 120), observacao: texto(co.observacao, 1500) },
    itens: itens,
    // sem preço nos itens (pedido de cotação ainda sem resposta), vale o total do PDF
    total: soma > 0 ? soma : num(d.total),
    totalPdf: num(d.totalPdf != null ? d.totalPdf : d.total)
  };
}

function resumoDe(c) {
  const ped = c.pedido || null;
  const previa = ped && ped.previa;
  return {
    numero: c.numero, fase: faseAtual(c.fase), portal: c.portal || '', cotacaoId: c.cotacaoId || '',
    cliente: { nome: (c.cliente && c.cliente.nome) || '', cnpj: (c.cliente && c.cliente.cnpj) || '', codigo: (c.cliente && c.cliente.codigo) || '', uf: (c.cliente && c.cliente.uf) || '', cidade: (c.cliente && c.cliente.cidade) || '' },
    empresa: c.empresa || '', area: c.area || '',
    dono: c.dono ? { email: c.dono.email, nome: c.dono.nome } : null,
    total: r2(c.total), nItens: (c.itens || []).length,
    totalPedido: ped ? r2((previa && previa.total) || ped.total || 0) : 0,
    oc: ped ? (ped.oc || (previa && previa.oc) || '') : '',
    validade: (c.datas && c.datas.validade) || '', dataCotacao: (c.datas && c.datas.cotacao) || '',
    criadoEm: c.criadoEm, atualizadoEm: c.atualizadoEm, faseEm: c.faseEm || c.criadoEm, fechadoEm: c.fechadoEm || null,
    // o caminho de fases, curto: o funil mede até onde cada cotação chegou
    fases: (c.fases || []).slice(-12).map(function (f) { return [faseAtual(f.fase), diaBrasilia(f.em)]; }),
    // a proposta foi para o comprador? (última)
    proposta: c.proposta ? { em: c.proposta.em, para: (c.proposta.para || []).join(', ') } : null,
    pi: c.pi ? c.pi.estado || '' : '',
    // as Ordens de Venda com que a cotação fechou (a fila "Aguardando OV")
    ovs: (c.ovs || []).map(function (o) { return o.numero; }),
    perda: c.perda ? c.perda.motivo || '' : '',
    nAnexos: (c.anexos || []).filter(function (a) { return !a.removido; }).length,
    nNotas: (c.notas || []).length,
    descartado: !!c.descartado,
    // para a busca achar pelo produto
    itensTxt: (c.itens || []).slice(0, 6).map(function (i) { return i.descricao || i.codigo; }).join(' · ').slice(0, 240)
  };
}

function hist(c, entrada) {
  c.historico = c.historico || [];
  c.historico.push(Object.assign({ em: agora() }, entrada));
  if (c.historico.length > 400) c.historico = c.historico.slice(-400);
}
function brl(v) { return 'R$ ' + r2(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function rotuloData(s) { if (!s) return ''; const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec(s); return m ? m[3] + '/' + m[2] + '/' + m[1] + (m[4] ? ' ' + m[4] : '') : s; }
function tituloDe(c) { return [c.portal, c.cotacaoId ? 'nº ' + c.cotacaoId : ''].filter(Boolean).join(' ') || 'Cotação'; }

// ── anexos ────────────────────────────────────────────────────────
function extDe(nome) { const m = /\.([a-z0-9]{2,5})$/i.exec(String(nome || '')); return m ? m[1].toLowerCase() : ''; }
// valida e grava o arquivo; devolve o registro que entra no caso
async function guardarArquivo(a, tipo, quem) {
  a = a || {};
  const nome = txt(a.nome, 160).replace(/[\\/:*?"<>|]+/g, '_') || 'arquivo.pdf';
  const ext = extDe(nome) || (a.tipo === 'application/pdf' ? 'pdf' : '');
  if (!TIPOS_ARQUIVO[ext]) throw erro(400, 'Tipo de arquivo não aceito (' + (ext || 'sem extensão') + '). Use PDF, imagem, planilha, documento, e-mail ou ZIP.');
  if ((tipo === 'cotacao' || tipo === 'pedido' || tipo === 'proposta') && ext !== 'pdf') throw erro(400, tipo === 'pedido' ? 'O pedido precisa ser o PDF que o portal gerou.' : tipo === 'proposta' ? 'A proposta precisa ser um PDF.' : 'A cotação precisa ser um PDF.');
  const b64 = String(a.base64 || '').replace(/^data:[^,]*,/, '');
  if (!b64) throw erro(400, 'Arquivo vazio.');
  const bytes = Buffer.from(b64, 'base64');
  if (!bytes.length) throw erro(400, 'Arquivo vazio.');
  if (bytes.length > ANEXO_MAX) throw erro(413, 'Arquivo grande demais (' + (bytes.length / 1048576).toFixed(1).replace('.', ',') + ' MB). O limite é ' + Math.round(ANEXO_MAX / 1048576) + ' MB.');
  if (ext === 'pdf' && bytes.slice(0, 5).toString('latin1') !== '%PDF-') throw erro(400, 'O arquivo "' + nome + '" não é um PDF válido.');
  const id = Date.now().toString(36) + crypto.randomBytes(5).toString('hex');
  const caminho = 'anexos/' + new Date().toISOString().slice(0, 7) + '/' + id + '.' + ext;
  if (!(await store.gravarArquivo(caminho, bytes, TIPOS_ARQUIVO[ext]))) throw erro(409, 'Não consegui gravar o arquivo — tente de novo.');
  return {
    id: id, tipo: tipo || 'outro', nome: nome, mime: TIPOS_ARQUIVO[ext], tamanho: bytes.length,
    caminho: caminho, sha1: crypto.createHash('sha1').update(bytes).digest('hex'), em: agora(), por: pessoa(quem)
  };
}
function anexoPublico(a) {
  const o = Object.assign({}, a);
  delete o.caminho;   // o caminho no storage não sai para a tela
  return o;
}
function casoPublico(c) {
  if (!c) return c;
  const o = Object.assign({}, c);
  o.anexos = (c.anexos || []).map(anexoPublico);
  return o;
}

// ── leitura ───────────────────────────────────────────────────────
async function listar() {
  const ix = (await store.ler(store.INDICE, INDICE_VAZIO)).dados;
  (ix.casos || []).forEach(function (r) {
    r.fase = faseAtual(r.fase);
    if (Array.isArray(r.fases)) r.fases = r.fases.map(function (f) { return [faseAtual(f[0]), f[1]]; });
  });
  return ix;
}
function numeroOk(numero) { return /^COT-\d{4}-\d{6}$/.test(String(numero || '')); }
async function obterBruto(numero) {
  if (!numeroOk(numero)) throw erro(400, 'Número de cotação inválido.');
  const c = (await store.ler(store.arquivoDoCaso(numero), null)).dados;
  if (c) c.fase = faseAtual(c.fase);
  return c;
}
async function obter(numero) { return casoPublico(await obterBruto(numero)); }
async function arquivo(numero, id) {
  const c = await obterBruto(numero);
  if (!c) throw erro(404, 'Cotação não encontrada.');
  const a = (c.anexos || []).filter(function (x) { return x.id === String(id || ''); })[0];
  if (!a) throw erro(404, 'Anexo não encontrado nesta cotação.');
  const bytes = await store.lerArquivo(a.caminho);
  if (!bytes) throw erro(404, 'O arquivo deste anexo não está mais no armazenamento.');
  return { nome: a.nome, tipo: a.mime, tamanho: bytes.length, base64: bytes.toString('base64') };
}
// a mesma cotação já virou caso? (o Agente pergunta antes de criar)
async function duplicado(portal, cotacaoId, cfg) {
  const k = chaveDe(portalDe(portal, cfg), cotacaoId);
  if (!k || !store.configurado()) return null;
  const ix = await listar();
  const num = (ix.chaves || {})[k];
  const res = num && (ix.casos || []).filter(function (c) { return c.numero === num; })[0];
  return res && !res.descartado ? res : null;
}

// O índice é cópia do caso: depois de mexer no caso, o resumo volta para o
// índice — e o mapa de duplicidade acompanha a troca de portal/número e o
// descarte (cotação descartada libera a chave).
async function sincronizar(c, chaveAntes) {
  await store.atualizar(store.INDICE, INDICE_VAZIO, function (ix) {
    ix.casos = ix.casos || []; ix.chaves = ix.chaves || {};
    let mudou = false;
    const res = resumoDe(c);
    const i = ix.casos.findIndex(function (x) { return x.numero === c.numero; });
    if (i >= 0) { if (JSON.stringify(ix.casos[i]) !== JSON.stringify(res)) { ix.casos[i] = res; mudou = true; } }
    else { ix.casos.unshift(res); mudou = true; }
    const k = c.descartado ? '' : chaveDe(c.portal, c.cotacaoId);
    if (chaveAntes && chaveAntes !== k && ix.chaves[chaveAntes] === c.numero) { delete ix.chaves[chaveAntes]; mudou = true; }
    if (k && !ix.chaves[k]) { ix.chaves[k] = c.numero; mudou = true; }
    if (!mudou) return false;
    ix.rev = (ix.rev || 0) + 1;
    ix.atualizadoEm = agora();
  });
}

// ── o comprador no Dynamics (shared/cot-erp.js) ───────────────────
// { achou, codigo, … } | { achou:false } | { erro } | null (sem CNPJ / sem D365)
async function consultarErp(cnpj, lancar) {
  if (!cnpj) return null;
  try {
    const v = await erp.clientePorCnpj(cnpj, { timeoutMs: 8000 });
    return v && v.configurado === false ? null : v;
  } catch (e) {
    if (lancar) throw erro(502, 'Não consegui consultar o Dynamics agora: ' + txt(e.message, 160));
    return { achou: false, erro: txt(e.message, 200), em: agora() };
  }
}
// o Dynamics completa o que está VAZIO no caso (o que veio do PDF e a pessoa
// conferiu fica); o código do cliente (ERP) o PDF nunca traz
function completarDoErp(cli, v) {
  if (!cli.codigo && v.codigo) cli.codigo = txt(v.codigo, 30);
  if (!cli.nome && v.nome) cli.nome = txt(v.nome, 160);
  if (!cli.endereco && v.endereco) cli.endereco = txt([v.endereco, v.bairro].filter(Boolean).join(' - '), 200);
  if (!cli.cidade && v.cidade) cli.cidade = txt(v.cidade, 80);
  if (!cli.uf && v.uf) cli.uf = ufDe(v.uf);
  if (!cli.cep && v.cep) cli.cep = cepDe(v.cep);
}
function textoErp(v) {
  return 'Cliente no Dynamics: código ' + (v.codigo || '?') + (v.empresa ? ' · empresa ' + v.empresa : '') + (v.grupo ? ' · grupo ' + v.grupo : '') +
    (v.pagamento ? ' · cond. pag. ' + v.pagamento : '') + (v.bloqueado ? ' · BLOQUEADO (' + v.bloqueio + ')' : '');
}

// ── a Ordem de Venda (shared/cot-ov.js) ───────────────────────────
// o retrato da OV no Dynamics | { erro } | null (Dynamics desligado)
async function conferirOv(numero) {
  try {
    const v = await ovD365.ordemDeVenda(numero, { timeoutMs: 8000 });
    return v && v.configurado === false ? null : v;
  } catch (e) {
    return { achou: false, numero: numero, erro: txt(e.message, 200), em: agora() };
  }
}
function textoOv(o) {
  const v = o.dynamics;
  const conf = !v ? 'sem conferência (Dynamics desligado)'
    : v.erro ? 'sem conferência (' + v.erro + ')'
    : !v.achou ? 'não encontrada no Dynamics'
    : ['no Dynamics: cliente ' + (v.cliente || '?'), v.oc && 'OC ' + v.oc, v.situacao, v.total ? brl(v.total) : ''].filter(Boolean).join(' · ');
  return 'Ordem de Venda ' + o.numero + (o.origem === 'pi' ? ' (pedido do PI)' : ' (lançada fora do PI)') + ' · ' + conf;
}
// o nome do cliente sem as palavras que todo hospital tem ("HOSPITAL", "LTDA",
// "SANTA"…): o que sobra identifica. null = não dá para comparar.
const GENERICOS = ['hospital', 'hospitalar', 'hospitalares', 'clinica', 'clinicas', 'instituto', 'associacao', 'fundacao', 'santa', 'santo', 'sao',
  'casa', 'misericordia', 'irmandade', 'sociedade', 'beneficente', 'ltda', 'eireli', 'servicos', 'medicos', 'medica', 'medico', 'saude', 'centro',
  'grupo', 'comercio', 'produtos', 'das', 'dos', 'para', 'nossa', 'senhora'];
function palavrasCliente(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/)
    .filter(function (w) { return w.length >= 3 && GENERICOS.indexOf(w) < 0; });
}
function mesmoCliente(a, b) {
  const x = palavrasCliente(a), y = palavrasCliente(b);
  if (!x.length || !y.length) return null;
  return x.some(function (w) { return y.indexOf(w) >= 0; });
}

// a cotação não muda mais de fase, de PDF do pedido nem é descartada:
// o pedido já está no Dynamics (o PI lançou) ou ela já fechou com a OV
function travada(c) {
  if (c.ovs && c.ovs.length) return 'Esta cotação já fechou com a Ordem de Venda ' + c.ovs.map(function (o) { return o.numero; }).join(', ');
  if (c.pi && c.pi.estado === 'enviado') return 'O pedido desta cotação já foi lançado no Dynamics pelo PI';
  return '';
}

// ── criar (o Agente de Cotações) ──────────────────────────────────
async function novo(b, quem) {
  if (!store.configurado()) throw erro(409, 'Armazenamento não configurado (COT_BLOB_URL).');
  const cfg = quem.cfg;
  b = b || {};
  // CNPJ, CEP, UF, telefone e e-mail como a tela confere (nada inválido entra calado)
  const inval = invalidosDe(b.dados && b.dados.cliente, b.dados && b.dados.contato);
  if (inval.length) throw erro(400, 'Corrija antes de criar: ' + inval.join(', ') + (inval.length > 1 ? ' inválidos.' : ' inválido.'));
  const d = dadosDe(b.dados, cfg);
  if (!d.cliente.nome && !d.cotacaoId && !d.itens.length) throw erro(400, 'Informe ao menos o cliente, o número da cotação ou um item.');
  // a área é a da equipe de segurança de quem registra (a tela só manda a
  // área quando o Entra não devolveu equipe nenhuma)
  const perfil = await perfilDe(quem);
  if (perfil.area) d.area = perfil.area;
  // o comprador no Dynamics, pelo CNPJ: código do cliente e o endereço que o
  // PDF não trouxe (o agente já consultou — aqui vem do cache)
  const erpV = await consultarErp(d.cliente.cnpj);
  if (erpV && erpV.achou) completarDoErp(d.cliente, erpV);
  // sempre Cotada — ou já Vencida, se a validade do PDF passou
  const jaVencida = venceu(d.datas.validade);
  const faseIni = jaVencida ? 'vencida' : 'cotada';
  const k = chaveDe(d.portal, d.cotacaoId);

  // antes de gastar o upload: a mesma cotação já existe?
  if (k && !b.forcar) {
    const ja = await duplicado(d.portal, d.cotacaoId, cfg);
    if (ja) throw erro(409, 'Esta cotação já foi registrada: ' + ja.numero + '.', { duplicado: ja.numero });
  }
  const eu = pessoa(quem);
  const anexo = b.anexo && b.anexo.base64 ? await guardarArquivo(b.anexo, 'cotacao', quem) : null;
  const criadoEm = agora();
  const l = b.leitura || {};
  const c = Object.assign({ versao: 1, numero: '' }, d, {
    equipe: perfil.equipe || '',
    erp: erpV,
    fase: faseIni, faseEm: criadoEm,
    fases: [{ fase: faseIni, em: criadoEm, por: eu }],
    dono: b.semDono ? null : eu,
    criadoEm: criadoEm, criadoPor: eu, atualizadoEm: criadoEm, fechadoEm: jaVencida ? criadoEm : null,
    leitura: anexo || l.modelo ? {
      ia: !!l.ia, em: criadoEm, arquivo: anexo ? anexo.nome : '', modelo: txt(l.modelo, 60),
      avisos: (Array.isArray(l.avisos) ? l.avisos : []).slice(0, 30).map(function (a) { return { tipo: txt(a && a.tipo, 30), texto: txt(a && a.texto, 300) }; }),
      erro: txt(l.erro, 300)
    } : null,
    anexos: anexo ? [anexo] : [],
    pedido: null, pi: null, descartado: null, proposta: null, propostas: [],
    perda: jaVencida ? { motivo: MOTIVO_VENCIDA, obs: 'Registrada com a data de vencimento já passada (' + rotuloData(d.datas.validade) + ')', concorrente: '', valorConcorrente: 0, automatica: true, em: criadoEm, por: { email: SISTEMA.email, nome: SISTEMA.nome } } : null,
    notas: [],
    historico: []
  });
  const nota = texto(b.nota, 4000);
  if (nota) c.notas.push({ em: criadoEm, por: eu, texto: nota });

  let numero = '', dup = '';
  await store.atualizar(store.INDICE, INDICE_VAZIO, function (ix) {
    ix.casos = ix.casos || []; ix.chaves = ix.chaves || {};
    dup = '';
    const ja = k && ix.chaves[k];
    if (ja && !b.forcar && ix.casos.some(function (x) { return x.numero === ja && !x.descartado; })) { dup = ja; return false; }
    ix.seq = (ix.seq || 0) + 1;
    numero = 'COT-' + anoBrasilia(criadoEm) + '-' + String(ix.seq).padStart(6, '0');
    c.numero = numero;
    // "criar mesmo assim": a chave continua apontando para o primeiro caso
    if (k && !(ja && ix.casos.some(function (x) { return x.numero === ja && !x.descartado; }))) ix.chaves[k] = numero;
    ix.casos.unshift(resumoDe(c));
    ix.rev = (ix.rev || 0) + 1;
    ix.atualizadoEm = agora();
  });
  if (dup) throw erro(409, 'Esta cotação já foi registrada: ' + dup + '.', { duplicado: dup });

  c.historico.push({ em: criadoEm, por: eu, tipo: 'criado', texto:
    'Cotação registrada' + (anexo ? ' a partir do PDF ' + anexo.nome + (c.leitura && c.leitura.ia ? ' (lido pela IA)' : ' (preenchida à mão)') : ' à mão') +
    ' · fase ' + nomeFase(faseIni) + (c.total ? ' · ' + brl(c.total) : '') + (b.forcar && k ? ' · registrada de novo de propósito (a mesma cotação já tinha caso)' : '') +
    (jaVencida ? ' · a data de vencimento já tinha passado (' + rotuloData(c.datas.validade) + '): descartada como vencida' : '') });
  if (erpV && erpV.achou) c.historico.push({ em: criadoEm, por: eu, tipo: 'erp', texto: textoErp(erpV) });
  if (nota) c.historico.push({ em: criadoEm, por: eu, tipo: 'nota', texto: nota.length > 140 ? nota.slice(0, 140) + '…' : nota });
  if (!(await store.gravar(store.arquivoDoCaso(numero), c, null))) {
    // não deveria acontecer (o número saiu do índice sob ETag): não sobrescreve
    throw erro(409, 'O número ' + numero + ' já estava em uso — tente de novo.');
  }
  return casoPublico(c);
}

// ── ações ─────────────────────────────────────────────────────────
// ctx carrega o que foi feito FORA do caso antes da gravação (o arquivo
// enviado) e o que precisa acontecer depois (a chave de duplicidade).
function aplicar(c, tipo, b, quem, cfg, ctx) {
  const eu = pessoa(quem);
  c.notas = c.notas || []; c.anexos = c.anexos || []; c.fases = c.fases || [];
  c.fase = faseAtual(c.fase);
  const assumeSeSemDono = function () {
    if (c.dono || quem.sistema) return;
    c.dono = eu;
    hist(c, { por: eu, tipo: 'campo', campo: 'Responsável', de: '(sem responsável)', para: eu.nome });
  };
  const mudarFase = function (nova, extra) {
    const antes = c.fase;
    c.fase = nova;
    c.faseEm = agora();
    c.fases.push({ fase: nova, em: c.faseEm, por: eu });
    if (c.fases.length > 60) c.fases = c.fases.slice(-60);
    c.fechadoEm = fechada(nova) ? c.faseEm : null;
    if (!fase(nova).perdida) c.perda = null;
    hist(c, { por: eu, tipo: 'fase', campo: 'Fase', de: nomeFase(antes), para: nomeFase(nova), texto: extra || '' });
    assumeSeSemDono();
  };

  switch (tipo) {
    case 'assumir':
    case 'atribuir':
    case 'liberar': {
      let para = null;
      if (tipo === 'assumir') para = eu;
      if (tipo === 'atribuir') {
        const e = txt(b.para && b.para.email, 200).toLowerCase();
        if (!emailOk(e) || !/@biomedical\.com\.br$/.test(e)) throw erro(400, 'Atribua a um e-mail @biomedical.com.br.');
        para = { email: e, nome: txt(b.para.nome, 120) || e };
      }
      if ((c.dono && para && c.dono.email === para.email) || (!c.dono && !para)) return false;
      hist(c, { por: eu, tipo: 'campo', campo: 'Responsável', de: c.dono ? c.dono.nome : '(sem responsável)', para: para ? para.nome : '(sem responsável)' });
      c.dono = para;
      break;
    }

    case 'fase': {
      const nova = String(b.fase || '');
      const f = fase(nova);
      if (!f) throw erro(400, 'Fase inválida.');
      if (nova === c.fase) return false;
      if (c.descartado) throw erro(409, 'Esta cotação foi descartada — restaure antes de mudar a fase.');
      if (nova === 'pedido' && !c.pedido) throw erro(400, 'Anexe o PDF do pedido para marcar a cotação como "Virou pedido".');
      if (c.fase === 'pedido' && travada(c)) throw erro(409, travada(c) + ' — ela não pode sair de "Virou pedido".');
      // voltar para uma fase aberta com a validade passada: a varredura a
      // venceria de novo no minuto seguinte — primeiro a validade nova
      if (f.aberta && venceu(c.datas && c.datas.validade)) {
        throw erro(400, 'A data de vencimento (' + rotuloData(c.datas.validade) + ') já passou — atualize a data de vencimento (Detalhes) antes de reabrir a cotação.');
      }
      let extra = '';
      if (f.perdida) {
        const lst = nova === 'perdida' ? cfg.motivosPerda : cfg.motivosCancelamento;
        const motivo = nova === 'vencida' ? MOTIVO_VENCIDA : (daLista(b.motivo, lst) || txt(b.motivo, 80));
        if (nova === 'perdida' && !motivo) throw erro(400, 'Informe o motivo da perda.');
        c.perda = { motivo: motivo, obs: texto(b.obs, 1000), concorrente: txt(b.concorrente, 120), valorConcorrente: num(b.valorConcorrente), em: agora(), por: eu };
        extra = [motivo && 'Motivo: ' + motivo, c.perda.concorrente && 'Concorrente: ' + c.perda.concorrente,
          c.perda.valorConcorrente && 'Preço do concorrente: ' + brl(c.perda.valorConcorrente), c.perda.obs].filter(Boolean).join(' · ');
      }
      if (c.fase === 'pedido' && nova !== 'pedido') {
        // a cotação voltou atrás: o pedido sai do caso (o PDF fica nos anexos)
        c.pedido = null; c.pi = null;
        extra = ['Pedido desvinculado — o PDF continua nos anexos', extra].filter(Boolean).join(' · ');
      }
      mudarFase(nova, extra);
      break;
    }

    case 'campos': {
      const f = b.campos || {};
      const muda = [];
      const setar = function (rotulo, antigo, novo, aplicarFn) {
        if (String(antigo || '') === String(novo || '')) return;
        aplicarFn(novo); muda.push([rotulo, antigo, novo]);
      };
      c.cliente = c.cliente || {}; c.contato = c.contato || {}; c.datas = c.datas || {}; c.condicoes = c.condicoes || {};
      if (f.portal != null) setar('Portal', c.portal, portalDe(f.portal, cfg), function (v) { c.portal = v; });
      if (f.cotacaoId != null) setar('Nº da cotação', c.cotacaoId, txt(f.cotacaoId, 60), function (v) { c.cotacaoId = v; });
      // empresa: sempre BIO (não se edita); área: a da equipe, ajustável
      if (f.area != null) setar('Área', c.area, txt(f.area, 60), function (v) { c.area = v; });
      const cli = f.cliente || {};
      // CNPJ, CEP, UF e telefone com as regras da tela (o e-mail já era conferido abaixo)
      const ruins = invalidosDe({ cnpj: cli.cnpj, cep: cli.cep, uf: cli.uf }, { telefone: (f.contato || {}).telefone });
      if (ruins.length) throw erro(400, ruins.join(', ') + (ruins.length > 1 ? ' inválidos.' : ' inválido.'));
      if (cli.nome != null) setar('Cliente', c.cliente.nome, txt(cli.nome, 160), function (v) { c.cliente.nome = v; });
      if (cli.cnpj != null) setar('CNPJ', c.cliente.cnpj, cnpjDe(cli.cnpj), function (v) { c.cliente.cnpj = v; });
      if (cli.codigo != null) setar('Código do cliente', c.cliente.codigo, txt(cli.codigo, 30), function (v) { c.cliente.codigo = v; });
      if (cli.cidade != null) setar('Cidade', c.cliente.cidade, txt(cli.cidade, 80), function (v) { c.cliente.cidade = v; });
      if (cli.uf != null) setar('UF', c.cliente.uf, ufDe(cli.uf), function (v) { c.cliente.uf = v; });
      if (cli.endereco != null) setar('Endereço', c.cliente.endereco, txt(cli.endereco, 200), function (v) { c.cliente.endereco = v; });
      if (cli.cep != null) setar('CEP', c.cliente.cep, cepDe(cli.cep), function (v) { c.cliente.cep = v; });
      const ct = f.contato || {};
      if (ct.nome != null) setar('Contato', c.contato.nome, txt(ct.nome, 120), function (v) { c.contato.nome = v; });
      if (ct.email != null) {
        const e = txt(ct.email, 200).toLowerCase();
        if (e && !emailOk(e)) throw erro(400, 'E-mail do contato inválido.');
        setar('E-mail do contato', c.contato.email, e, function (v) { c.contato.email = v; });
      }
      if (ct.telefone != null) setar('Telefone do contato', c.contato.telefone, foneDe(ct.telefone), function (v) { c.contato.telefone = v; });
      const dt = f.datas || {};
      [['cotacao', 'Data da cotação'], ['validade', 'Data de vencimento']].forEach(function (x) {
        if (dt[x[0]] == null) return;
        const v = dataDe(dt[x[0]]).slice(0, 10);
        if (dt[x[0]] && !v) throw erro(400, x[1] + ': data inválida.');
        setar(x[1], rotuloData(c.datas[x[0]]), rotuloData(v), function () { c.datas[x[0]] = v; });
      });
      if ((dt.cotacao != null || dt.validade != null) && (diasEntre(c.datas.cotacao, c.datas.validade) || 0) < 0) throw erro(400, 'A data de vencimento é antes da data da cotação.');
      const co = f.condicoes || {};
      [['pagamento', 'Condição de pagamento', 300], ['entrega', 'Prazo de entrega', 120], ['frete', 'Frete', 60], ['validade', 'Validade (dias, do PDF)', 60], ['medico', 'Nome do médico', 120]].forEach(function (x) {
        if (co[x[0]] != null) setar(x[1], c.condicoes[x[0]], txt(co[x[0]], x[2]), function (v) { c.condicoes[x[0]] = v; });
      });
      if (co.observacao != null) setar('Observação', c.condicoes.observacao, texto(co.observacao, 1500), function (v) { c.condicoes.observacao = v; });
      // mudou uma das datas: a validade em dias acompanha (vencimento −
      // data da cotação). Só os dias mudaram (API): o vencimento é recalculado
      if (dt.cotacao != null || dt.validade != null) {
        const nd = diasEntre(c.datas.cotacao, c.datas.validade);
        if (nd != null) setar('Validade (dias)', c.condicoes.validade, textoDias(nd), function (v) { c.condicoes.validade = v; });
      } else if (co.validade != null) {
        const nova = validadeCalculada(c.condicoes.validade, c.datas.cotacao);
        if (nova) setar('Data de vencimento', rotuloData(c.datas.validade), rotuloData(nova), function () { c.datas.validade = nova; });
      }
      if (!muda.length) return false;
      muda.forEach(function (x) {
        const curto = function (s) { s = String(s || ''); return s.length > 120 ? s.slice(0, 120) + '…' : s; };
        hist(c, { por: eu, tipo: 'campo', campo: x[0], de: curto(x[1]), para: curto(x[2]) });
      });
      break;
    }

    case 'itens': {
      const itens = itensDe(b.itens);
      const antes = JSON.stringify(c.itens || []);
      if (antes === JSON.stringify(itens)) return false;
      const tAntes = c.total || 0, nAntes = (c.itens || []).length;
      c.itens = itens;
      const soma = somaItens(itens);
      c.total = soma > 0 ? soma : (b.total != null ? num(b.total) : (c.totalPdf || 0));
      hist(c, { por: eu, tipo: 'campo', campo: 'Itens', de: nAntes + ' item(ns) · ' + brl(tAntes), para: itens.length + ' item(ns) · ' + brl(c.total) });
      break;
    }

    case 'nota': {
      const t = texto(b.texto, 4000);
      if (!t) throw erro(400, 'Escreva a nota.');
      c.notas.push({ em: agora(), por: eu, texto: t });
      hist(c, { por: eu, tipo: 'nota', texto: t.length > 140 ? t.slice(0, 140) + '…' : t });
      break;
    }

    case 'anexo': {
      const a = ctx.arquivo;
      if (!a) throw erro(400, 'Arquivo vazio.');
      c.anexos.push(a);
      hist(c, { por: eu, tipo: 'anexo', texto: 'Anexou ' + a.nome + (a.tipo === 'cotacao' ? ' (PDF da cotação)' : '') });
      break;
    }

    case 'removerAnexo': {
      const a = c.anexos.filter(function (x) { return x.id === String(b.id || '') && !x.removido; })[0];
      if (!a) throw erro(404, 'Anexo não encontrado nesta cotação.');
      if (c.pedido && c.pedido.anexoId === a.id) throw erro(409, 'Este é o PDF do pedido da cotação — volte a fase antes de tirá-lo.');
      a.removido = { em: agora(), por: eu };
      hist(c, { por: eu, tipo: 'anexo', texto: 'Tirou o anexo ' + a.nome });
      break;
    }

    case 'pedido': {
      // o portal gerou o pedido: o PDF dele entra no caso e a cotação vira pedido
      if (c.descartado) throw erro(409, 'Esta cotação foi descartada — restaure antes de registrar o pedido.');
      if (travada(c)) throw erro(409, travada(c) + '.');
      let a = ctx.arquivo;
      if (!a && b.anexoId) {
        a = c.anexos.filter(function (x) { return x.id === String(b.anexoId) && !x.removido; })[0];
        if (!a) throw erro(404, 'Anexo não encontrado nesta cotação.');
        if (extDe(a.nome) !== 'pdf') throw erro(400, 'O pedido precisa ser o PDF que o portal gerou.');
        a.tipo = 'pedido';
      }
      if (!a) throw erro(400, 'Anexe o PDF do pedido.');
      if (ctx.arquivo) c.anexos.push(a);
      const trocou = !!c.pedido;
      c.pedido = { anexoId: a.id, nome: a.nome, oc: txt(b.oc, 60), data: dataDe(b.data), total: num(b.total), obs: texto(b.obs, 1000), em: agora(), por: eu, previa: null };
      c.pi = { estado: 'disponivel' };
      hist(c, { por: eu, tipo: 'pedido', texto: (trocou ? 'Trocou o PDF do pedido: ' : 'Pedido anexado: ') + a.nome + (c.pedido.oc ? ' · OC ' + c.pedido.oc : '') });
      if (c.fase !== 'pedido') mudarFase('pedido', 'O portal gerou o pedido');
      break;
    }

    case 'pi': {
      const est = String(b.estado || '');
      if (['lido', 'em_andamento', 'enviado', 'erro', 'disponivel'].indexOf(est) < 0) throw erro(400, 'Estado do PI inválido.');
      if (!c.pedido) throw erro(409, 'Esta cotação ainda não tem o PDF do pedido.');
      c.pi = c.pi || { estado: 'disponivel' };
      const antes = c.pi.estado;
      if (est === 'lido') {
        const p = b.previa || {};
        c.pedido.previa = {
          cnpj: cnpjDe(p.cnpj), cliente: txt(p.cliente, 160), oc: txt(p.oc, 60), itens: Math.max(0, Math.round(Number(p.itens) || 0)),
          total: num(p.total), condicao: txt(p.condicao, 80), email: emailOk(p.email) ? txt(p.email, 200).toLowerCase() : '',
          produtos: (Array.isArray(p.produtos) ? p.produtos : []).slice(0, 120).map(function (x) {
            x = x || {};
            return { codigo: txt(x.codigo, 40), descricao: txt(x.descricao, 200), quantidade: num(x.quantidade), valorUnitario: num(x.valorUnitario) };
          }),
          lidoEm: agora(), lidoPor: eu
        };
        if (!c.pedido.oc && c.pedido.previa.oc) c.pedido.oc = c.pedido.previa.oc;
        if (antes === 'disponivel' || antes === 'erro' || !antes) c.pi.estado = 'lido';
        c.pi.erro = '';
        hist(c, { por: eu, tipo: 'pi', texto: 'O PI leu o pedido' + (c.pedido.previa.oc ? ' · OC ' + c.pedido.previa.oc : '') +
          (c.pedido.previa.itens ? ' · ' + c.pedido.previa.itens + ' item(ns)' : '') + (c.pedido.previa.total ? ' · ' + brl(c.pedido.previa.total) : '') });
        break;
      }
      if (est === 'em_andamento') {
        if (antes === 'enviado') return false;
        c.pi.estado = 'em_andamento'; c.pi.abertoPor = eu; c.pi.abertoEm = agora();
        assumeSeSemDono();
        hist(c, { por: eu, tipo: 'pi', texto: 'Aberto no PI · Pedido com o PDF ' + (c.pedido.nome || '') });
        break;
      }
      if (est === 'enviado') {
        const e = b.enviado || {};
        c.pi.estado = 'enviado';
        c.pi.enviado = {
          em: agora(), por: eu, oc: txt(e.oc, 60), cliente: txt(e.cliente, 160), codigoCliente: txt(e.codigoCliente, 30),
          cnpj: cnpjDe(e.cnpj), total: num(e.total), itens: Math.max(0, Math.round(Number(e.itens) || 0)), empresa: txt(e.empresa, 20)
        };
        if (!c.pedido.oc && c.pi.enviado.oc) c.pedido.oc = c.pi.enviado.oc;
        hist(c, { por: eu, tipo: 'pi', texto: 'Pedido lançado no Dynamics pelo PI' + (c.pi.enviado.oc ? ' · OC ' + c.pi.enviado.oc : '') +
          (c.pi.enviado.cliente ? ' · ' + c.pi.enviado.cliente : '') + (c.pi.enviado.total ? ' · ' + brl(c.pi.enviado.total) : '') });
        if (!c.cliente.codigo && c.pi.enviado.codigoCliente) {
          hist(c, { por: eu, tipo: 'campo', campo: 'Código do cliente', de: '', para: c.pi.enviado.codigoCliente + ' (pelo PI)' });
          c.cliente.codigo = c.pi.enviado.codigoCliente;
        }
        break;
      }
      if (est === 'erro') {
        c.pi.estado = antes === 'enviado' ? 'enviado' : 'erro';
        c.pi.erro = txt(b.erro, 300);
        hist(c, { por: eu, tipo: 'pi', texto: 'Não deu para ler o PDF do pedido: ' + c.pi.erro });
        break;
      }
      if (antes === 'enviado') return false;
      c.pi.estado = 'disponivel';
      break;
    }

    case 'ov': {
      // a cotação FECHA com a Ordem de Venda que o pedido gerou no Dynamics
      if (c.descartado) throw erro(409, 'Esta cotação foi descartada — restaure antes de registrar a Ordem de Venda.');
      if (faseAtual(c.fase) !== 'pedido' || !c.pedido) throw erro(409, 'A Ordem de Venda entra quando a cotação já virou pedido (com o PDF do pedido no caso).');
      const n = ctx.ovNumero;
      c.ovs = c.ovs || [];
      if (c.ovs.some(function (o) { return o.numero === n; })) return false;
      if (c.ovs.length >= 20) throw erro(400, 'Esta cotação já tem 20 Ordens de Venda — o limite do caso.');
      const v = ctx.ov || null;
      // o código ERP do cliente da cotação: o do caso, o que o PI mandou ou o do
      // CNPJ no Dynamics (consultado antes do laço, quando o caso não tinha)
      const meuCliente = (c.cliente && c.cliente.codigo) || (c.pi && c.pi.enviado && c.pi.enviado.codigoCliente) || ctx.ovCodigoCnpj || '';
      let clienteBateu = true;
      if (!b.forcar) {
        // o que pede um "confere?" antes de fechar (a tela pergunta e reenvia com forcar)
        const avisos = [];
        if (ctx.ovOutra) avisos.push('a ' + n + ' já está na cotação ' + ctx.ovOutra);
        if (v && !v.achou && !v.erro) avisos.push('a ' + n + ' não foi encontrada no Dynamics');
        if (v && v.achou && v.cliente && meuCliente && chaveTxt(v.cliente) !== chaveTxt(meuCliente)) {
          clienteBateu = false;
          avisos.push('o cliente da ' + n + ' no Dynamics é ' + v.cliente + (v.nome ? ' (' + v.nome + ')' : '') + ', e o desta cotação é ' + meuCliente);
        } else if (v && v.achou && !meuCliente && mesmoCliente(v.nome, c.cliente && c.cliente.nome) === false) {
          // sem código ERP dos dois lados: o nome é o que resta para conferir
          clienteBateu = false;
          avisos.push('o cliente da ' + n + ' no Dynamics é ' + (v.cliente || '?') + (v.nome ? ' (' + v.nome + ')' : '') + ', e esta cotação é do ' + c.cliente.nome);
        }
        if (v && v.achou && v.empresa && v.empresa !== EMPRESA_FIXA) avisos.push('a ' + n + ' é da empresa ' + v.empresa + ' (a cotação é da ' + EMPRESA_FIXA + ')');
        if (avisos.length) throw erro(409, 'Confira antes de fechar: ' + avisos.join('; ') + '.', { confirmar: true, avisos: avisos });
      }
      const o = {
        numero: n, em: agora(), por: eu,
        origem: c.pi && c.pi.estado === 'enviado' ? 'pi' : 'manual',
        obs: txt(b.obs, 200), confirmada: !!b.forcar,
        dynamics: v ? {
          achou: !!v.achou, erro: txt(v.erro, 200), empresa: txt(v.empresa, 10), cliente: txt(v.cliente, 30), nome: txt(v.nome, 160),
          oc: txt(v.oc, 60), situacao: txt(v.situacao, 30), criadaEm: txt(v.criadaEm, 30),
          itens: v.itens == null ? null : v.itens, total: v.total == null ? null : r2(v.total), fonte: txt(v.fonte, 60), em: v.em || agora()
        } : null
      };
      const primeira = !c.ovs.length;
      c.ovs.push(o);
      hist(c, { por: eu, tipo: 'ov', texto: (primeira ? 'Cotação fechada com a ' : 'Mais uma ') + textoOv(o) + (o.confirmada ? ' · registrada mesmo com o aviso' : '') + (o.obs ? ' · ' + o.obs : '') });
      // a OV traz o código do cliente que o caso ainda não tinha (só quando
      // nada pediu confirmação — OV "registrada mesmo assim" pode ser de outro)
      if (v && v.achou && v.cliente && c.cliente && !c.cliente.codigo && !b.forcar && clienteBateu) {
        hist(c, { por: eu, tipo: 'campo', campo: 'Código do cliente', de: '', para: v.cliente + ' (pela OV)' });
        c.cliente.codigo = v.cliente;
      }
      assumeSeSemDono();
      break;
    }

    case 'removerOv': {
      // OV registrada por engano (número errado): sai do caso, fica no histórico
      const n = ovD365.numeroOv(b.ov) || txt(b.ov, 20).toUpperCase();
      c.ovs = c.ovs || [];
      const i = c.ovs.findIndex(function (o) { return o.numero === n; });
      if (i < 0) throw erro(404, 'A Ordem de Venda ' + n + ' não está nesta cotação.');
      c.ovs.splice(i, 1);
      const motivo = txt(b.motivo, 200);
      hist(c, { por: eu, tipo: 'ov', texto: 'Tirou a Ordem de Venda ' + n + (motivo ? ' · ' + motivo : '') + (c.ovs.length ? '' : ' · a cotação volta a aguardar a OV') });
      break;
    }

    case 'leitura': {
      // a IA leu de novo o PDF da cotação (botão no caso): completa o que está
      // vazio — ou troca tudo, se a pessoa pediu
      const d = dadosDe(b.dados, cfg);
      const sobre = !!b.sobrescrever;
      const muda = [];
      const pega = function (rotulo, atual, novo, fn) { if (novo && (sobre || !atual) && String(atual || '') !== String(novo)) { fn(novo); muda.push(rotulo); } };
      c.cliente = c.cliente || {}; c.contato = c.contato || {}; c.datas = c.datas || {}; c.condicoes = c.condicoes || {};
      pega('Portal', c.portal, d.portal, function (v) { c.portal = v; });
      pega('Nº da cotação', c.cotacaoId, d.cotacaoId, function (v) { c.cotacaoId = v; });
      ['nome', 'cnpj', 'cidade', 'uf', 'endereco', 'cep'].forEach(function (k) { pega('Cliente (' + k + ')', c.cliente[k], d.cliente[k], function (v) { c.cliente[k] = v; }); });
      ['nome', 'email', 'telefone'].forEach(function (k) { pega('Contato (' + k + ')', c.contato[k], d.contato[k], function (v) { c.contato[k] = v; }); });
      ['cotacao', 'validade'].forEach(function (k) { pega('Data (' + k + ')', c.datas[k], d.datas[k], function (v) { c.datas[k] = v; }); });
      ['pagamento', 'entrega', 'frete', 'validade', 'medico', 'observacao'].forEach(function (k) { pega('Condição (' + k + ')', c.condicoes[k], d.condicoes[k], function (v) { c.condicoes[k] = v; }); });
      if (d.itens.length && (sobre || !(c.itens || []).length)) { c.itens = d.itens; c.total = d.total; muda.push('Itens'); }
      if (d.totalPdf) c.totalPdf = d.totalPdf;
      const l = b.leitura || {};
      c.leitura = Object.assign({}, c.leitura || {}, { ia: true, em: agora(), modelo: txt(l.modelo, 60), erro: '',
        avisos: (Array.isArray(l.avisos) ? l.avisos : []).slice(0, 30).map(function (a) { return { tipo: txt(a && a.tipo, 30), texto: txt(a && a.texto, 300) }; }) });
      hist(c, { por: eu, tipo: 'ia', texto: 'A IA leu de novo o PDF da cotação' + (muda.length ? ' · preencheu: ' + muda.join(', ') : ' · nada novo') });
      break;
    }

    case 'vencer': {
      // a validade passou com a cotação aberta: sai sozinha do funil
      if (c.descartado || !aberta(c.fase)) return false;
      const v = c.datas && c.datas.validade;
      if (!venceu(v)) {
        if (quem.sistema) return false;
        throw erro(409, v ? 'A data de vencimento (' + rotuloData(v) + ') ainda não passou.' : 'A cotação não tem data de vencimento.');
      }
      c.perda = { motivo: MOTIVO_VENCIDA, obs: 'Vencimento em ' + rotuloData(v) + ', sem resultado', concorrente: '', valorConcorrente: 0, automatica: !!quem.sistema, em: agora(), por: eu };
      mudarFase('vencida', 'Venceu em ' + rotuloData(v) + (quem.sistema ? ' — descartada automaticamente' : ''));
      break;
    }

    case 'proposta': {
      // a proposta (o PDF no modelo da Biomedical) foi enviada ao comprador:
      // o PDF fica no caso e o envio entra no histórico
      const a = ctx.arquivo;
      if (!a) throw erro(400, 'Anexe o PDF da proposta.');
      const emails = function (v) {
        return (Array.isArray(v) ? v : String(v || '').split(/[;,\s]+/)).map(function (e) { return txt(e, 200).toLowerCase(); })
          .filter(function (e, i, l) { return emailOk(e) && l.indexOf(e) === i; }).slice(0, 10);
      };
      const para = emails(b.para), copia = emails(b.copia);
      if (!para.length) throw erro(400, 'Informe o e-mail do comprador.');
      c.anexos.push(a);
      const reg = { em: agora(), por: eu, para: para, copia: copia, assunto: txt(b.assunto, 250), anexoId: a.id, nome: a.nome, canal: txt(b.canal, 20) || 'outlook' };
      c.propostas = (c.propostas || []).concat([reg]).slice(-30);
      c.proposta = reg;
      hist(c, { por: eu, tipo: 'proposta', texto: (c.propostas.length > 1 ? 'Proposta reenviada para ' : 'Proposta enviada para ') + para.join(', ') + (copia.length ? ' (cópia: ' + copia.join(', ') + ')' : '') + ' · ' + a.nome });
      break;
    }

    case 'erp': {
      // buscou o CNPJ no Dynamics de novo (botão no caso)
      const v = ctx.erp;
      if (!v) throw erro(400, 'Sem CNPJ do comprador para procurar no Dynamics.');
      c.cliente = c.cliente || {};
      const antes = JSON.stringify([c.erp, c.cliente]);
      c.erp = v;
      if (v.achou) completarDoErp(c.cliente, v);
      if (antes === JSON.stringify([c.erp, c.cliente])) return false;
      hist(c, { por: eu, tipo: 'erp', texto: v.achou ? textoErp(v) : (v.erro ? 'Dynamics: ' + v.erro : 'CNPJ não encontrado no Dynamics (cliente novo)') });
      break;
    }

    case 'descartar': {
      const sim = !!b.descartado;
      if (sim === !!c.descartado) return false;
      if (sim && travada(c)) throw erro(409, travada(c) + ' — ela não pode ser descartada.');
      c.descartado = sim ? { em: agora(), por: eu, motivo: txt(b.motivo, 200) } : null;
      hist(c, { por: eu, tipo: 'campo', campo: 'Descartada', de: sim ? 'não' : 'sim', para: sim ? 'sim' : 'não', texto: sim ? (txt(b.motivo, 200) || 'registrada por engano') : '' });
      break;
    }

    default:
      throw erro(400, 'Ação desconhecida.');
  }
  c.atualizadoEm = agora();
  return true;
}

async function agir(numero, b, quem) {
  if (!store.configurado()) throw erro(409, 'Armazenamento não configurado (COT_BLOB_URL).');
  b = b || {};
  const tipo = String(b.acao || '');
  if (!numeroOk(numero)) throw erro(400, 'Número de cotação inválido.');
  const cfg = quem.cfg || await lerConfig();
  const ctx = {};
  // o arquivo sobe ANTES (fora do laço do ETag): o caso só guarda a referência
  if (tipo === 'erp') {
    const existe = await obterBruto(numero);
    if (!existe) throw erro(404, 'Cotação não encontrada.');
    ctx.erp = (existe.cliente && existe.cliente.cnpj) ? await consultarErp(existe.cliente.cnpj, true) : null;
  }
  if (tipo === 'ov') {
    // o número e a conferência no Dynamics saem ANTES do laço do ETag
    const n = ovD365.numeroOv(b.ov);
    if (!n) throw erro(400, 'Número da Ordem de Venda inválido — use OVBIO seguido dos números (ex.: OVBIO144950).');
    ctx.ovNumero = n;
    const existe = await obterBruto(numero);
    if (!existe) throw erro(404, 'Cotação não encontrada.');
    if (faseAtual(existe.fase) !== 'pedido' || !existe.pedido) throw erro(409, 'A Ordem de Venda entra quando a cotação já virou pedido (com o PDF do pedido no caso).');
    if (!(existe.ovs || []).some(function (o) { return o.numero === n; })) {
      ctx.ov = await conferirOv(n);
      // o caso sem código ERP: o do CNPJ no Dynamics, para conferir o cliente da OV
      const cli = existe.cliente || {};
      if (ctx.ov && ctx.ov.achou && !cli.codigo && !(existe.pi && existe.pi.enviado && existe.pi.enviado.codigoCliente) && cli.cnpj) {
        const e = await consultarErp(cli.cnpj);
        ctx.ovCodigoCnpj = e && e.achou ? e.codigo : '';
      }
      const outra = ((await listar()).casos || []).filter(function (r) { return r.numero !== numero && !r.descartado && (r.ovs || []).indexOf(n) >= 0; })[0];
      ctx.ovOutra = outra ? outra.numero : '';
    }
  }
  if ((tipo === 'anexo' || tipo === 'pedido' || tipo === 'proposta') && b.anexo && b.anexo.base64) {
    const existe = await obterBruto(numero);
    if (!existe) throw erro(404, 'Cotação não encontrada.');
    if (tipo === 'pedido' && travada(existe)) throw erro(409, travada(existe) + '.');
    const qual = tipo === 'pedido' ? 'pedido' : tipo === 'proposta' ? 'proposta' : (b.tipo === 'cotacao' ? 'cotacao' : 'outro');
    ctx.arquivo = await guardarArquivo(b.anexo, qual, quem);
  }
  let chaveAntes = '';
  const r = await store.atualizar(store.arquivoDoCaso(numero), null, function (c) {
    if (!c) throw erro(404, 'Cotação não encontrada.');
    chaveAntes = c.descartado ? '' : chaveDe(c.portal, c.cotacaoId);
    return aplicar(c, tipo, b, quem, cfg, ctx);
  });
  if (r.gravou) await sincronizar(r.dados, chaveAntes);
  return casoPublico(r.dados);
}

// ── vencidas: a validade passou com a cotação aberta ──────────────
// Roda na leitura da lista (a tela consulta a cada 20 s; aqui no máximo uma
// vez por minuto por instância). Só toca nos casos que o ÍNDICE já mostra
// abertos e vencidos — sem nada vencido, custo zero. Devolve quantas venceu.
let _varreuEm = 0;
async function varrerVencidas(ix) {
  if (!store.configurado() || Date.now() - _varreuEm < 60e3) return 0;
  _varreuEm = Date.now();
  const hoje = hojeBR();
  const alvo = ((ix && ix.casos) || []).filter(function (r) { return !r.descartado && aberta(r.fase) && venceu(r.validade, hoje); });
  let n = 0;
  for (const r of alvo.slice(0, 40)) {
    try {
      const c = await agir(r.numero, { acao: 'vencer' }, Object.assign({ cfg: await lerConfig() }, SISTEMA));
      if (c && c.fase === 'vencida') n++;
    } catch (e) { /* tenta de novo na próxima leitura */ }
  }
  return n;
}

function diagnostico() {
  return {
    armazenamento: store.configurado(),
    origem: store.origem(),
    ia: !!(process.env.AOAI_ENDPOINT && process.env.AOAI_KEY),
    anexoMaxMB: Math.round(ANEXO_MAX / 1048576)
  };
}

module.exports = {
  FASES, FASES_INICIAIS, nomeFase, PORTAIS_PADRAO, MOTIVOS_PERDA_PADRAO, MOTIVOS_CANCEL_PADRAO, EMPRESAS_PADRAO, AREAS_PADRAO, DONO, EMPRESA_FIXA,
  lerConfig, salvarConfig, montarConfig, exigirEquipe, perfilDe,
  listar, obter, arquivo, duplicado, novo, agir, varrerVencidas, resumoDe, diagnostico, consultarErp,
  // para os testes
  dataDe, num, chaveDe, portalDe, dadosDe, validadeCalculada, diasEntre, venceu, equipeDosGrupos, numeroOv: ovD365.numeroOv,
  _zerarCaches: function () { _varreuEm = 0; _perfis.clear(); }
};
