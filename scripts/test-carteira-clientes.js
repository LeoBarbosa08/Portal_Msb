// ================================================================
// scripts/test-carteira-clientes.js — a CARTEIRA DE CLIENTES da MSB,
// ESPELHO SÓ DE CONSULTA (27/11/2026)
//
// Confere o RECORTE MSB da Carteira trazida do portal completo:
//   1. a rota /api/carteira-clientes LÊ (lista, Atualizar, ficha, busca,
//      arquivo da conta, diag) e NÃO ESCREVE: todo POST é 405, as leituras
//      que só servem aos formulários de escrita (?conta, ?modeloConta, ?cep,
//      ?modeloContato, ?erpConferir) são 403 — e nada chega ao Salesforce
//      nem ao registro dos pedidos de cadastro no ERP;
//   2. o histórico dos pedidos de cadastro no ERP feitos no completo aparece
//      (só leitura do erp-pedidos.json no blob da carteira);
//   3. a trava: token validado e a área Comercial;
//   4. a TELA só aponta para o que existe no portal da MSB (nenhum link para
//      o Dossiê oculto, a área Vendedor, a visão 360 ou o Salesforce) e está
//      registrada no menu, na busca, no guia e na visão geral do Comercial.
//
// O Dynamics e o Salesforce são os DUBLÊS do completo (.claude/cc-fake.js —
// fora do git, como todo o .claude/ deste portal; copie de lá se faltar).
//
//   node scripts/test-carteira-clientes.js
// ================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const RAIZ = path.resolve(__dirname, '..');

const FAKE = path.join(RAIZ, '.claude', 'cc-fake.js');
if (!fs.existsSync(FAKE)) {
  console.error('Falta o dublê .claude/cc-fake.js (fora do git). Copie do portal completo: .claude/cc-fake.js de Claude.rep.');
  process.exit(2);
}

// o blob da carteira simulado: a carteira montada e o registro dos pedidos de ERP
process.env.CARTEIRA_BLOB_URL = 'https://blob.teste/carteira?sig=x';
delete process.env.RADAR_BLOB_URL; delete process.env.CARTEIRA_ERP_BLOB_URL;
const BLOB = {}, PUTS = [];
const fetchReal = global.fetch;
global.fetch = async (url, opts) => {
  const u = new URL(String(url));
  if (u.hostname !== 'blob.teste') return fetchReal(url, opts);
  const nome = u.pathname.replace(/^\/carteira\//, ''), metodo = (opts && opts.method) || 'GET';
  const resp = (st, corpo, h) => ({ ok: st < 400, status: st, headers: { get: (k) => (h || {})[String(k).toLowerCase()] || null },
    text: async () => String(corpo || ''), json: async () => JSON.parse(String(corpo)), arrayBuffer: async () => corpo });
  if (metodo === 'PUT') { PUTS.push(nome); BLOB[nome] = opts.body; return resp(201); }
  return BLOB[nome] == null ? resp(404) : resp(200, BLOB[nome], { etag: '"e1"' });
};

const fake = require(FAKE);
let AUTH = { validated: true, areas: ['comercial'] };
let AREAS_PEDIDAS = null;
require.cache[require.resolve(path.join(RAIZ, 'api', 'shared', 'd365.js'))] = { exports: fake.d365, loaded: true, id: 'd365' };
require.cache[require.resolve(path.join(RAIZ, 'api', 'shared', 'salesforce.js'))] = { exports: fake.sf, loaded: true, id: 'sf' };
require.cache[require.resolve(path.join(RAIZ, 'api', 'shared', 'auth.js'))] = { exports: {
  requireArea: async (req, areas) => { AREAS_PEDIDAS = areas; return { validated: AUTH.validated, user: { email: 'teste@biomedical.com.br', oid: 'x' } }; },
  authorizedAreas: async () => ({ areas: AUTH.areas, restricted: true })
}, loaded: true, id: 'auth' };
const C = require(path.join(RAIZ, 'api', 'shared', 'carteira-clientes.js'));
const ERP = require(path.join(RAIZ, 'api', 'shared', 'carteira-erp-leitura.js'));
const handler = require(path.join(RAIZ, 'api', 'carteira-clientes', 'index.js'));

let ok = 0, falhou = 0;
function t(nome, cond, extra) {
  if (cond) ok++;
  else { falhou++; console.log('  FALHOU: ' + nome + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 300) : '')); }
}
async function chamar(query, metodo, body) {
  const ctx = { res: null, log: Object.assign(() => {}, { error: () => {} }) };
  await handler(ctx, { method: metodo || 'GET', query: query || {}, headers: {}, body: body || null });
  return ctx.res;
}
function decodificar(p) {
  const c = {}; p.cols.forEach((k, i) => { c[k] = i; });
  return p.rows.map((r) => {
    const o = {};
    p.cols.forEach((k) => { const v = r[c[k]]; o[k] = p.dic[k] ? (v < 0 ? '' : p.dic[k][v]) : v; });
    o.k = o.k || o.doc;
    return o;
  });
}
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

(async () => {
  // ── 1. a trava ────────────────────────────────────────────────────
  fake.setFlags({});
  AUTH = { validated: false, areas: ['comercial'] };
  t('sem token validado: 401', (await chamar({})).status === 401);
  AUTH = { validated: true, areas: ['estoque'] };
  t('sem a área Comercial: 403', (await chamar({})).status === 403);
  AUTH = { validated: true, areas: ['vendedor'] };
  t('a área Vendedor não existe aqui: 403', (await chamar({})).status === 403);
  AUTH = { validated: true, areas: ['comercial'] };
  await chamar({});
  t('a rota pede só a área Comercial', JSON.stringify(AREAS_PEDIDAS) === '"comercial"', AREAS_PEDIDAS);

  // ── 2. o registro de pedidos de ERP do completo, no blob ──────────
  C._zerar(); ERP._zerar();
  let r = await chamar({});
  const b1 = r.body;
  t('lista: 200, espelho e as duas fontes ok', r.status === 200 && b1.ok && b1.espelho === true && b1.fontes.d365.ok && b1.fontes.sf.ok, b1 && b1.fontes);
  t('lista: sem link para o Salesforce (sfInstance nulo)', b1.sfInstance === null);
  const lista = decodificar(b1.pacote);
  t('lista: a carteira inteira (as duas empresas, BIO · MSB)', lista.length > 100 && lista.some((c) => c.empresas === 'BIO · MSB'), lista.length);
  const soSf = lista.filter((c) => c.sit === 'sf' && c.doc)[0];
  t('há cliente só no CRM para o histórico do ERP', !!soSf);
  BLOB['erp-pedidos.json'] = JSON.stringify({ atualizadoEm: '2026-11-18T17:02:00Z', pedidos: { [soSf.k]: [
    { em: '2026-11-18T17:02:00Z', por: 'Fulano de Tal', porEmail: 'fulano@biomedical.com.br', de: 'fulano@biomedical.com.br', via: 'caixa', para: ['compras@biomedical.com.br'], obs: 'urgente', anexos: [], conf: 'confere com a Receita', diferencas: 0 }
  ] } });
  ERP._zerar();
  r = await chamar({});
  t('lista: marca "ERP pedido" do completo', r.body.erpPedidos && r.body.erpPedidos[soSf.k] && r.body.erpPedidos[soSf.k].por === 'Fulano de Tal', r.body.erpPedidos);

  // a carga completa grava a carteira montada no MESMO blob (como o completo)
  await new Promise((res) => setTimeout(res, 30));
  t('a carteira montada vai para carteira.json.gz', PUTS.indexOf('carteira.json.gz') >= 0, PUTS);
  const gz = BLOB['carteira.json.gz'];
  t('o blob gravado é o formato do completo (versão 2)', gz && JSON.parse(zlib.gunzipSync(Buffer.from(gz)).toString('utf8')).versao === 2);

  // ── 3. o que LÊ ──────────────────────────────────────────────────
  r = await chamar({ ficha: soSf.doc });
  t('ficha: achou, só no CRM', r.status === 200 && r.body.achou && r.body.cliente.sit === 'sf' && r.body.espelho === true, r.body && r.body.cliente);
  t('ficha: pedido de ERP desligado e o histórico do completo', r.body.erp && r.body.erp.ligado === false && r.body.erp.pedidos.length === 1 && r.body.erp.pedidos[0].por === 'Fulano de Tal', r.body.erp);
  const ambos = lista.filter((c) => c.sit === 'ambos' && c.doc)[0];
  r = await chamar({ ficha: ambos.doc });
  const fi = r.body;
  t('ficha: cliente nos dois, com contatos e anexos', r.status === 200 && fi.achou && fi.cliente.sit === 'ambos' && fi.contatos && fi.anexos, fi.cliente);
  const comAnexo = lista.filter((c) => c.sit === 'ambos' && c.doc).map((c) => c.doc);
  let arq = null;
  for (const d of comAnexo.slice(0, 40)) {
    const f = (await chamar({ ficha: d })).body;
    arq = (f.anexos && f.anexos.linhas || []).find((x) => x.tipo === 'arquivo' && x.conta);
    if (arq) break;
  }
  if (arq) {
    const ra = await chamar({ arquivo: arq.id, pai: arq.conta });
    t('arquivo da conta abre pelo portal', ra.status === 200 && ra.isRaw && Buffer.isBuffer(ra.body), ra.status);
  } else t('achou um arquivo de conta no dublê para abrir', false);
  r = await chamar({ busca: 'Gertrudes Valadares' });
  t('busca por tudo do cliente (contato no CRM)', r.status === 200 && r.body.ok && (r.body.achados || []).length >= 1, r.body);
  r = await chamar({ fresh: '1' });
  t('Atualizar (fresh=1) responde com a base', r.status === 200 && r.body.ok && !!r.body.pacote);
  r = await chamar({ diag: '1' });
  t('diag: lê e diz que é espelho', r.status === 200 && r.body.espelho === true && r.body.blob && r.body.blob.configurado === true, r.body && r.body.blob);

  // ── 4. o que NÃO escreve ─────────────────────────────────────────
  const antes = { contas: fake.CRIADAS.length, contatos: fake.CONTATOS_CRIADOS.length, arquivos: fake.ARQUIVOS.length, edicoes: fake.ATUALIZADAS.length, emails: fake.EMAILS.length };
  const putsAntes = PUTS.length;
  const POSTS = [
    ['nova conta', { conta: { cnpj: fake.cnpj('99880001', '0001'), nome: 'HOSPITAL NOVO', tipo: 'Hospital Particular', uf: 'MG', cidade: 'Belo Horizonte', endereco: 'Rua A, 1', cep: '30130000' } }],
    ['novo contato', { contaId: '001FAKE00000000002', contato: { FirstName: 'Ana', LastName: 'Souza', Email: 'ana@x.com' } }],
    ['anexar arquivo', { contaId: '001FAKE00000000002', anexo: { nome: 'a.pdf', base64: Buffer.from('%PDF-1.4').toString('base64') } }],
    ['incluir descrição', { contaId: '001FAKE00000000002', descricao: { texto: 'teste' } }],
    ['pedir cadastro no ERP', { erp: { k: soSf.k, observacao: 'x' } }]
  ];
  for (const p of POSTS) {
    const rp = await chamar({}, 'POST', p[1]);
    t('POST ' + p[0] + ': 405 (espelho)', rp.status === 405 && rp.body.espelho === true, rp.status);
  }
  for (const m of ['PUT', 'PATCH', 'DELETE']) t(m + ': 405', (await chamar({}, m)).status === 405);
  const SO_FORM = [{ conta: fake.cnpj('99880001', '0001') }, { modeloConta: '1' }, { cep: '30130000' }, { modeloContato: '1' }, { erpConferir: soSf.k }, { novaConta: '1' }];
  for (const q of SO_FORM) {
    const rq = await chamar(q);
    t('GET ' + Object.keys(q)[0] + ': 403 (só do completo)', rq.status === 403 && rq.body.espelho === true, rq.status);
  }
  t('nada chegou ao Salesforce nem ao e-mail', fake.CRIADAS.length === antes.contas && fake.CONTATOS_CRIADOS.length === antes.contatos &&
    fake.ARQUIVOS.length === antes.arquivos && fake.ATUALIZADAS.length === antes.edicoes && fake.EMAILS.length === antes.emails, antes);
  t('nada gravado no registro dos pedidos de ERP', PUTS.slice(putsAntes).indexOf('erp-pedidos.json') < 0 && PUTS.indexOf('erp-pedidos.json') < 0, PUTS);
  const fn = JSON.parse(ler('api/carteira-clientes/function.json'));
  t('function.json: só GET e OPTIONS', JSON.stringify(fn.bindings[0].methods) === '["get","options"]', fn.bindings[0].methods);
  t('os módulos de escrita do completo não vieram', !fs.existsSync(path.join(RAIZ, 'api/shared/carteira-conta-nova.js')) &&
    !fs.existsSync(path.join(RAIZ, 'api/shared/carteira-contato-anexo.js')) && !fs.existsSync(path.join(RAIZ, 'api/shared/carteira-erp.js')));
  const sfSrc = ler('api/shared/salesforce.js');
  t('salesforce.js segue só leitura (sem criar/atualizar)', !/async function (criar|atualizar)\b/.test(sfSrc) && /async function search\b/.test(sfSrc));

  // ── 5. a TELA só aponta para o que existe no portal da MSB ────────
  // a página sem os comentários (eles explicam o recorte e citam o que saiu)
  const pag = ler('pages/comercial-carteira-clientes.html').replace(/<!--[\s\S]*?-->/g, ''), js = ler('comercial-carteira-clientes.js');
  t('página: espelho (data-cc-espelho) e selo "Só consulta"', /<body[^>]*data-cc-espelho/.test(pag) && /Só consulta/.test(pag));
  t('página: sem "Nova conta" e sem o modal da conta nova', !/Nova conta/.test(pag) && !/id="cc-nova"/.test(pag));
  t('motor da tela: ESPELHO fixo', /var ESPELHO = true;/.test(js));
  const hrefs = (pag + '\n' + js).match(/href="([^"#?]+\.html)/g) || [];
  const quebrados = hrefs.map((h) => h.slice(6)).filter((h) => {
    const alvo = h.startsWith('../') ? path.join(RAIZ, h.slice(3)) : path.join(RAIZ, 'pages', h);
    return !fs.existsSync(alvo);
  });
  t('todo link .html da tela existe neste portal', quebrados.length === 0, quebrados);
  const proibidos = ['comercial-dossie-visita', 'vendedor', 'portal-elo', 'lightning', 'comercial-cot-nova'];
  const achados = proibidos.filter((p) => new RegExp('href=["\'][^"\']*' + p).test(pag + js) || new RegExp("['\"]" + p + "\\.html").test(js) || new RegExp('src="[^"]*' + p).test(pag));
  t('nenhum link para o Dossiê oculto, Vendedor, visão 360, Salesforce ou Agente', achados.length === 0, achados);
  const visiveis = /var MSB_VISIVEIS = \[([\s\S]*?)\];/.exec(ler('portal-catalogo.js'));
  t('busca (Ctrl+K): no MSB_VISIVEIS e no catálogo', visiveis && /comercial-carteira-clientes\.html/.test(visiveis[1]) && /'Carteira de Clientes'/.test(ler('portal-catalogo.js')));
  t('menu do Comercial', /id:'comercial-carteira-clientes'/.test(ler('nav-sidebar.js')));
  t('cartão na visão geral do Comercial', /href="comercial-carteira-clientes\.html" class="modulo-card"/.test(ler('pages/comercial.html')));
  t('guia do portal (script.js)', /'comercial-carteira-clientes\.html','Comercial'/.test(ler('script.js')));

  console.log((falhou ? 'FALHOU: ' + falhou + ' de ' + (ok + falhou) : 'ok: ' + ok + ' verificações') + ' — Carteira de Clientes (espelho MSB)');
  process.exit(falhou ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
