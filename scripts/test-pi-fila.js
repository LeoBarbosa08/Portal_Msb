// ================================================================
// scripts/test-pi-fila.js — a FILA DE APROVAÇÃO do PI · Pedido e os campos
// do PI no CRM (25/11/2026, pedido do dono).
//
//   node scripts/test-pi-fila.js
//
// O dono: "levar a lista e as informações do PI PEDIDOS para o CRM —
// condição de pagamento (a mesma lista do PI), transportadora (a mesma
// lista), observação na nota — e isso tem que estar no PDF. Quando virar
// pedido, vai para uma fila de aprovações no PI PEDIDOS para alguém dar
// andamento, em lista, com tudo lá, o PDF etc." E: "o vendedor não se
// preocupa em fazer no PI — clica em VIRAR PEDIDO e fica Aguardando o
// pedido ser finalizado".
//
// Aqui: a lista de condições do navegador (pi-listas.js) = a do prompt da
// IA (api/pedido-extrair); a transportadora e a observação na nota no caso
// (dadosDe e a ação 'campos'); os estados novos do PI (devolvido, fila);
// o item da fila e a rota GET ?fila (com o armazenamento simulado).
// ================================================================

const fs = require('fs');
const path = require('path');
let falhas = 0;
function t(nome, ok, extra) { console.log((ok ? '  ok  ' : '  FALHOU ') + nome + (ok || extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); if (!ok) falhas++; }

// o armazenamento das cotações, em memória (antes de carregar o motor)
const store = require('../api/shared/cot-store');
const MEM = {};
store.configurado = () => true;
store.ler = async (k, vazio) => ({ dados: MEM[k] !== undefined ? JSON.parse(JSON.stringify(MEM[k])) : vazio, etag: '1' });
store.lerArquivo = async () => Buffer.from('%PDF-1.4 teste');

const M = require('../api/shared/cot-motor');
const QUEM = { email: 'vendedor@biomedical.com.br', nome: 'Vendedor Teste', admin: true, cfg: M.montarConfig({}) };
const FILA_P = { email: 'fila@biomedical.com.br', nome: 'Pessoa da Fila' };

function casoBase(numero, extra) {
  return Object.assign({
    numero: numero, fase: 'cotada', portal: 'BIONEXO', cotacaoId: '123', empresa: 'MSB', unidade: 'MSB',
    cliente: { nome: 'HOSPITAL TESTE', cnpj: '11222333000181', codigo: 'C001', cidade: 'Fortaleza', uf: 'CE', endereco: 'Rua A, 1', cep: '60000000' },
    contato: { nome: 'Natália', email: 'natalia@teste.com', telefone: '' },
    datas: { cotacao: '2026-11-20', validade: '2026-12-20' },
    condicoes: { pagamento: 'CR 15/30/45/60/75/90', frete: 'CIF', entrega: '5 dias', transportadora: 'BRIX LOGISTICA', obsNota: '5 unidades em doação', observacao: '' },
    itens: [
      { codigo: 'UAMB-14120', descricao: 'Item A', quantidade: 10, valorUnitario: 100, resultado: 'ganho' },
      { codigo: 'RP-1', descricao: 'Item B', quantidade: 2, valorUnitario: 50, resultado: 'perdido' }
    ],
    total: 1100, fases: [], anexos: [{ id: 'a1', nome: 'pedido.pdf', tipo: 'pedido', caminho: 'x', tamanho: 10 }], notas: [], historico: [],
    dono: { email: 'vendedor@biomedical.com.br', nome: 'Vendedor Teste' },
    pedido: { manual: false, anexoId: 'a1', nome: 'pedido.pdf', oc: 'OC-9', total: 1000, em: '2026-11-24T10:00:00-03:00', por: { email: 'vendedor@biomedical.com.br', nome: 'Vendedor Teste' }, previa: null },
    pi: { estado: 'disponivel' }, ovs: [], criadoEm: '2026-11-20T10:00:00-03:00', atualizadoEm: '2026-11-24T10:00:00-03:00'
  }, extra || {});
}

(async () => {
  console.log('1) a lista de condições de pagamento: a do CRM/PI (pi-listas.js) = a da IA (pedido-extrair)');
  const L = require('../pi-listas.js');
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'pedido-extrair', 'index.js'), 'utf8');
  const m = /const CONDICOES_PAGAMENTO = (\[[\s\S]*?\]);/.exec(src);
  // eslint-disable-next-line no-new-func
  const doServidor = m ? Function('return ' + m[1])() : [];
  t('75 condições no pi-listas.js', L.condPagamento.length === 75, L.condPagamento.length);
  t('mesma lista, na mesma ordem, do prompt da IA', JSON.stringify(L.condPagamento) === JSON.stringify(doServidor),
    { soNoNavegador: L.condPagamento.filter(x => doServidor.indexOf(x) < 0), soNoServidor: doServidor.filter(x => L.condPagamento.indexOf(x) < 0) });
  const pi = fs.readFileSync(path.join(__dirname, '..', 'pedido-inteligente.js'), 'utf8');
  t('o PI lê a lista do pi-listas.js (sem cópia própria)', /PILISTAS\.condPagamento/.test(pi) && !/'CR 90\/120 DIAS'/.test(pi));
  const pag = ['pages/pedido-inteligente.html', 'pages/comercial-cot-nova.html', 'pages/comercial-cot-casos.html'];
  pag.forEach(function (p) {
    const h = fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    const iL = h.indexOf('pi-listas.js'), iD = Math.max(h.indexOf('pedido-inteligente.js?'), h.indexOf('cotacoes-base.js?'));
    t(p + ': carrega o pi-listas.js antes de quem usa', iL > 0 && iL < iD);
  });

  // 25/11/26 (o dono: "tem que estar no PI, não crie dois agentes"): a fila é uma aba do PI
  const htmlPi = fs.readFileSync(path.join(__dirname, '..', 'pages', 'pedido-inteligente.html'), 'utf8');
  const nav = fs.readFileSync(path.join(__dirname, '..', 'nav-sidebar.js'), 'utf8');
  t('a fila é uma ABA do PI (Novo pedido | Fila de aprovação), com o pi-fila.js', /data-pi-aba="novo"/.test(htmlPi) && /data-pi-aba="fila"/.test(htmlPi) && /id="pf-app"/.test(htmlPi) && /pi-fila\.js\?v=/.test(htmlPi));
  const jsFila = fs.readFileSync(path.join(__dirname, '..', 'pi-fila.js'), 'utf8');
  t('as abas ficam DENTRO do cartão do PI (Novo pedido | Aprovações), como na alçada de remessa',
    /id="pi-card"[\s\S]*id="pi-abas"[\s\S]*id="pi-aba-novo"[\s\S]*id="pi-aba-fila"/.test(htmlPi) && />Aprovações <span class="n" id="pi-fila-n"/.test(htmlPi));
  t('a aba Aprovações é só a lista da Fila de aprovação ("nem precisa me mostrar esses outros"): sem Já decididos, filtros nem busca',
    /nome: 'Fila de aprovação'/.test(jsFila) && !/nome: 'Já decididos'/.test(jsFila) && !/pf-busca|pf-visoes/.test(htmlPi + jsFila));
  t('a fila é só uma lista: sem os cartões nem a introdução ("não precisa desses cards")', !/id="pf-kpis"/.test(htmlPi) && !/pf-intro/.test(htmlPi) &&
    !/renderKpis/.test(fs.readFileSync(path.join(__dirname, '..', 'pi-fila.js'), 'utf8')));
  t('sem página nem agente à parte (nada de pi-fila.html no menu, na busca ou no disco)', !/pi-fila\.html/.test(nav) && !/pi-fila\.html/.test(fs.readFileSync(path.join(__dirname, '..', 'portal-catalogo.js'), 'utf8')) &&
    !fs.existsSync(path.join(__dirname, '..', 'pages', 'pi-fila.html')));

  console.log('2) a transportadora e a observação na nota no caso');
  const d = M.dadosDe({ condicoes: { pagamento: 'CR 30 DIAS', transportadora: '  BRIX  ', obsNota: 'linha 1\nlinha 2' } }, QUEM.cfg);
  t('dadosDe guarda a transportadora (sem espaço sobrando)', d.condicoes.transportadora === 'BRIX', d.condicoes);
  t('dadosDe guarda a observação na nota (com a quebra de linha)', d.condicoes.obsNota === 'linha 1\nlinha 2', d.condicoes.obsNota);
  let c = casoBase('COT-MSB-2026-000001', { condicoes: { pagamento: '30 DIAS' } });
  M.aplicar(c, 'campos', { campos: { condicoes: { transportadora: 'JADLOG', obsNota: 'Doação de 5 un.', pagamento: 'CR 30 DIAS' } } }, QUEM, QUEM.cfg, {});
  t('campos: troca a transportadora, a observação na nota e a condição', c.condicoes.transportadora === 'JADLOG' && c.condicoes.obsNota === 'Doação de 5 un.' && c.condicoes.pagamento === 'CR 30 DIAS', c.condicoes);
  t('campos: o histórico registra as três', ['Transportadora', 'Observação na nota', 'Condição de pagamento'].every(n => c.historico.some(h => h.campo === n)), c.historico.map(h => h.campo));

  console.log('3) a fila: devolver ao vendedor e reenviar');
  c = casoBase('COT-MSB-2026-000002');
  t('pedido registrado = aguardando', M.estadoFila(c) === 'aguardando');
  M.aplicar(c, 'pi', { estado: 'em_andamento' }, FILA_P, QUEM.cfg, {});
  t('aberto no PI = andamento (e o responsável continua o vendedor)', M.estadoFila(c) === 'andamento' && c.dono.email === 'vendedor@biomedical.com.br' && c.pi.abertoPor.nome === 'Pessoa da Fila');
  let erro = null;
  try { M.aplicar(c, 'pi', { estado: 'devolvido', motivo: '  ' }, FILA_P, QUEM.cfg, {}); } catch (e) { erro = e; }
  t('devolver sem motivo: 400', erro && erro.status === 400, erro && erro.publicMessage);
  M.aplicar(c, 'pi', { estado: 'devolvido', motivo: 'Falta a OC do cliente' }, FILA_P, QUEM.cfg, {});
  t('devolvido, com o motivo e quem devolveu', M.estadoFila(c) === 'devolvido' && c.pi.devolvido.motivo === 'Falta a OC do cliente' && c.pi.devolvido.por.nome === 'Pessoa da Fila');
  t('o histórico diz que foi devolvido', /devolvido ao vendedor.*Falta a OC/.test(c.historico[c.historico.length - 1].texto));
  M.aplicar(c, 'pi', { estado: 'fila' }, QUEM, QUEM.cfg, {});
  t('reenviar: volta para a fila (sem leitura = disponivel), sem o motivo antigo', c.pi.estado === 'disponivel' && !c.pi.devolvido && M.estadoFila(c) === 'aguardando');
  c.pedido.previa = { produtos: [{ codigo: 'UAMB-14120', descricao: 'Item A', quantidade: 10, valorUnitario: 100 }], total: 1000 };
  M.aplicar(c, 'pi', { estado: 'em_andamento' }, FILA_P, QUEM.cfg, {});
  M.aplicar(c, 'pi', { estado: 'fila' }, FILA_P, QUEM.cfg, {});
  t('"em andamento" que não foi lançado volta para a fila (com leitura = lido)', c.pi.estado === 'lido' && M.estadoFila(c) === 'aguardando');
  t('reenviar o que já está na fila não muda nada', M.aplicar(c, 'pi', { estado: 'fila' }, QUEM, QUEM.cfg, {}) === false);
  M.aplicar(c, 'pi', { estado: 'enviado', enviado: { oc: 'OC-9', total: 1000, itens: 1 } }, FILA_P, QUEM.cfg, {});
  t('lançado pelo PI = lancado', M.estadoFila(c) === 'lancado');
  erro = null;
  try { M.aplicar(c, 'pi', { estado: 'devolvido', motivo: 'x' }, FILA_P, QUEM.cfg, {}); } catch (e) { erro = e; }
  t('devolver o que já foi lançado: 409', erro && erro.status === 409, erro && erro.publicMessage);
  t('o lançado não volta para a fila', M.aplicar(c, 'pi', { estado: 'fila' }, FILA_P, QUEM.cfg, {}) === false && c.pi.estado === 'enviado');
  c.ovs = [{ numero: 'OV017760' }]; c.fase = 'pedido';
  t('fechou com a OV = finalizado', M.estadoFila(c) === 'finalizado');

  console.log('4) o item da fila: tudo o que a pessoa precisa para dar andamento');
  c = casoBase('COT-MSB-2026-000003');
  let it = M.itemDaFila(c);
  t('sem a leitura do PDF: os itens GANHOS da oportunidade', it.itens.length === 1 && it.itens[0].codigo === 'UAMB-14120' && it.total === 1000, it.itens);
  t('as condições do CRM: pagamento, frete, entrega, transportadora e observação na nota',
    it.condicoes.pagamento === 'CR 15/30/45/60/75/90' && it.condicoes.transportadora === 'BRIX LOGISTICA' && it.condicoes.obsNota === '5 unidades em doação' && it.condicoes.frete === 'CIF', it.condicoes);
  t('o vendedor, o cliente, o PDF do pedido e os anexos', it.vendedor.nome === 'Vendedor Teste' && it.cliente.cnpj === '11222333000181' && it.pedido.anexoId === 'a1' && it.anexos.length === 1 && !('caminho' in it.anexos[0]));
  c.pedido.previa = { oc: 'OC-PDF', total: 2000, produtos: [{ codigo: 'UAMB-14120', descricao: 'Item A', quantidade: 20, valorUnitario: 100 }] };
  c.pedido.oc = '';
  it = M.itemDaFila(c);
  t('com a leitura do PDF: os itens e o total do pedido lido, e a OC dele', it.itens[0].quantidade === 20 && it.total === 2000 && it.pedido.oc === 'OC-PDF' && it.pedido.lido === true, it);

  console.log('5) a rota GET /api/cot-casos?fila (armazenamento simulado)');
  const agora = new Date().toISOString();
  const casos = {
    'COT-MSB-2026-000010': casoBase('COT-MSB-2026-000010', { pedido: Object.assign(casoBase('x').pedido, { em: '2026-11-24T09:00:00-03:00' }) }),
    'COT-MSB-2026-000011': casoBase('COT-MSB-2026-000011', { pedido: Object.assign(casoBase('x').pedido, { em: '2026-11-23T09:00:00-03:00' }) }),
    'COT-MSB-2026-000012': casoBase('COT-MSB-2026-000012', { pi: { estado: 'em_andamento', abertoPor: FILA_P, abertoEm: agora } }),
    'COT-MSB-2026-000013': casoBase('COT-MSB-2026-000013', { pi: { estado: 'devolvido', devolvido: { motivo: 'Sem OC', por: FILA_P, em: agora } } }),
    'COT-MSB-2026-000014': casoBase('COT-MSB-2026-000014', { pi: { estado: 'enviado', enviado: { em: agora, por: FILA_P } }, atualizadoEm: agora }),
    'COT-MSB-2026-000015': casoBase('COT-MSB-2026-000015', { pi: { estado: 'enviado', enviado: { em: '2026-01-01T00:00:00Z' } }, atualizadoEm: '2026-01-01T00:00:00Z' }),
    'COT-MSB-2026-000016': casoBase('COT-MSB-2026-000016', { pedido: null, pi: null }),
    'COT-MSB-2026-000017': casoBase('COT-MSB-2026-000017', { descartado: { motivo: 'engano' } }),
    'COT-MSB-2026-000018': casoBase('COT-MSB-2026-000018', { fase: 'perdida' })
  };
  Object.keys(casos).forEach(function (n) { MEM[store.arquivoDoCaso(n)] = casos[n]; });
  MEM[store.INDICE] = { rev: 1, seq: 18, casos: Object.keys(casos).map(n => M.resumoDe(casos[n])) };
  const r = await M.fila(QUEM);
  const nums = r.fila.map(x => x.numero.slice(-2) + ':' + x.estado);
  t('?fila=1: só os que esperam alguém — aguardando (o mais antigo primeiro) e em andamento; fora: devolvido, lançado, sem pedido, descartada, perdida',
    JSON.stringify(nums) === JSON.stringify(['11:aguardando', '10:aguardando', '12:andamento']), nums);
  const rTodos = await M.fila(QUEM, false, true);
  const numsT = rTodos.fila.map(x => x.numero.slice(-2) + ':' + x.estado);
  t('?fila=todos: também o devolvido e o lançado dos últimos 15 dias (o lançado de janeiro, não)',
    JSON.stringify(numsT) === JSON.stringify(['11:aguardando', '10:aguardando', '12:andamento', '13:devolvido', '14:lancado']), numsT);
  const k = await M.fila(QUEM, true);
  t('?fila=conta: 2 aguardando, 1 em andamento', k.aguardando === 2 && k.andamento === 1, k);
  const fn = require('../api/cot-casos/index.js');
  const auth = require('../api/shared/auth');
  auth.requireUser = async () => ({ validated: true, user: { email: 'leonardo.barbosa@biomedical.com.br', name: 'Dono' } });
  const ctx = { log: Object.assign(() => {}, { error() {}, warn() {} }) };
  await fn(ctx, { method: 'GET', headers: {}, query: { fila: '1' } });
  t('a rota responde 200 com a fila', ctx.res && ctx.res.status !== 500 && ctx.res.body && Array.isArray(ctx.res.body.fila) && ctx.res.body.fila.length === 3, ctx.res && ctx.res.body);

  console.log('6) "Virou pedido" pelo PDF da PROPOSTA (sem anexar, sem confronto com outro PDF)');
  c = casoBase('COT-MSB-2026-000020', { pedido: null, pi: null, anexos: [], itens: [
    { codigo: 'UAMB-14120', descricao: 'Item A', quantidade: 10, valorUnitario: 100 },
    { codigo: 'RP-1', descricao: 'Item B', quantidade: 2, valorUnitario: 50 }
  ] });
  const pdfProposta = { id: 'p1', nome: 'Pedido COT-MSB-2026-000020 - HOSPITAL TESTE.pdf', tipo: 'pedido', caminho: 'x', tamanho: 100 };
  erro = null;
  try { M.aplicar(c, 'pedido', { proposta: true, resultados: [] }, QUEM, QUEM.cfg, { arquivo: pdfProposta }); } catch (e) { erro = e; }
  t('sem marcar os itens: 400 (todo item Ganho ou Perdido)', erro && erro.status === 400, erro && erro.publicMessage);
  c.anexos = [];
  M.aplicar(c, 'pedido', { proposta: true, oc: 'OC-77', resultados: [{ i: 0, codigo: 'UAMB-14120', descricao: 'Item A', resultado: 'ganho' }, { i: 1, codigo: 'RP-1', descricao: 'Item B', resultado: 'perdido', motivo: 'Preço' }] },
    QUEM, QUEM.cfg, { arquivo: pdfProposta });
  t('o PDF da proposta é o PDF do pedido (anexo tipo pedido)', c.pedido.proposta === true && c.pedido.anexoId === 'p1' && c.anexos.length === 1, c.pedido);
  t('a leitura sai do caso: só os itens ganhos, a OC e a condição de pagamento', c.pedido.previa.produtos.length === 1 && c.pedido.previa.produtos[0].codigo === 'UAMB-14120' &&
    c.pedido.previa.total === 1000 && c.pedido.previa.oc === 'OC-77' && c.pedido.previa.condicao === 'CR 15/30/45/60/75/90', c.pedido.previa);
  t('vai para a fila já lido (aguardando) e a oportunidade segue aberta (Aguardando pedido ser finalizado)', c.pi.estado === 'lido' && M.estadoFila(c) === 'aguardando' && c.fase === 'cotada');
  t('o histórico diz que foi para a fila do PI', /fila de aprovação do PI/.test(c.historico[c.historico.length - 1].texto), c.historico[c.historico.length - 1].texto);
  M.aplicar(c, 'pi', { estado: 'devolvido', motivo: 'Trocar a transportadora' }, FILA_P, QUEM.cfg, {});
  c.condicoes.transportadora = 'JADLOG';
  M.aplicar(c, 'pedido', { proposta: true, oc: 'OC-77' }, QUEM, QUEM.cfg, { arquivo: Object.assign({}, pdfProposta, { id: 'p2' }) });
  t('reenviar o devolvido: o PDF refeito troca o do pedido e volta para a fila', c.pedido.anexoId === 'p2' && c.pi.estado === 'lido' && !c.pi.devolvido && M.estadoFila(c) === 'aguardando', c.pi);
  const crm = fs.readFileSync(path.join(__dirname, '..', 'cotacoes.js'), 'utf8');
  t('o CRM não tem mais o pedido à mão nem o PDF anexado no "Virou pedido"', !/data-act="ped-manual"/.test(crm) && !/cot-drop-ped/.test(crm) && !/'manual', IC\.edit, 'À mão/.test(crm) && /\['proposta', IC\.pdf, 'Pelo PDF da proposta'/.test(crm));
  t('o CRM não abre mais o PI (o pedido vai para a fila)', !/data-act="abrir-pi"/.test(crm) && /Aguardando pedido ser finalizado/.test(crm));

  console.log('7) quantidade e preço obrigatórios em cada item');
  c = casoBase('COT-MSB-2026-000021');
  erro = null;
  try { M.aplicar(c, 'itens', { itens: [{ codigo: 'A1', descricao: 'x', quantidade: 2, valorUnitario: 0 }, { codigo: 'B2', descricao: 'y', quantidade: 0, valorUnitario: 10 }] }, QUEM, QUEM.cfg, {}); } catch (e) { erro = e; }
  t('editar os itens com item sem preço / sem quantidade: 400, dizendo quais', erro && erro.status === 400 && /item 1 \(A1\) sem preço/.test(erro.publicMessage) && /item 2 \(B2\) sem quantidade/.test(erro.publicMessage), erro && erro.publicMessage);
  M.aplicar(c, 'itens', { itens: [{ codigo: 'A1', descricao: 'x', quantidade: 2, valorUnitario: 5 }, { codigo: '', descricao: '', quantidade: 0, valorUnitario: 0 }] }, QUEM, QUEM.cfg, {});
  t('com quantidade e preço passa (a linha vazia some)', c.itens.length === 1 && c.total === 10, c.itens);
  erro = null;
  try { await M.novo({ dados: { cliente: { nome: 'X' }, itens: [{ codigo: 'A1', descricao: 'x', quantidade: 1 }] } }, QUEM); } catch (e) { erro = e; }
  t('criar a oportunidade com item sem preço: 400', erro && erro.status === 400 && /sem preço/.test(erro.publicMessage), erro && erro.publicMessage);

  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\ntudo ok');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
