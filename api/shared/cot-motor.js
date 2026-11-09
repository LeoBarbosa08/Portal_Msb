// ================================================================
// api/shared/cot-motor.js — o motor do módulo COTAÇÕES (Comercial)
//
// A cotação que a pessoa respondeu num PORTAL DE COMPRAS (Bionexo, Apoio
// Cotações, GTPlan, Síntese…) vira um CASO, no molde do Customer Service:
// número próprio (COT-AAAA-NNNNNN; na MSB, COT-MSB-AAAA-NNNNNN), dono, fase, notas e o histórico campo a
// campo, sempre com a pessoa do login (id token VALIDADO do Entra).
//
// O caminho da cotação (as FASES — o funil de conversão sai delas):
//
//   Cotada -> Ganha (virou pedido)
//         \-> Perdida  (o motivo: preço, prazo, proposta vencida, cancelada…)
//   22/10/26 (pedido do usuário): registrar o pedido (PDF ou à mão) NÃO fecha
//   como Ganha — a cotação fica aberta, aguardando a Ordem de Venda; a OV (do
//   fluxo do PI, digitada no cartão ou o "Já tenho a OV") é que fecha como
//   Ganha. Voltar para Cotada zera o resultado dos itens e tira o pedido e as
//   OVs (código, quantidade e preço ficam).
//   21/10/26: só essas três; "Em negociação" é lida como Cotada e
//   "Vencida"/"Cancelada" como Perdida (FASE_ANTIGA)
//   26/10/26 (pedido do usuário): a fase A FATURAR, depois de Cotada
//   (Cotada -> A faturar -> Ganha). É uma fase À MÃO, aberta, em que "ainda
//   nada aconteceu": passar para ela não pede pedido nem OV (o "Virou pedido"
//   é só da Ganha) e registrar o pedido não muda a fase. Não perde pelo prazo.
//   A AMOSTRA tem as fases dela: Envio de amostra -> Ganha / Perdida, sem
//   pedido nem OV; ganha ou perdida, ela continua fora das Ganhas e das
//   Perdidas (só muda a cor na tela).
//
//   . a cotação SEMPRE nasce "Cotada" (09/10/26: o agente só recebe a
//     proposta já respondida no portal — "Em cotação" saiu; caso antigo
//     nessa fase é lido como Cotada);
//   . "Virou pedido" EXIGE o PDF do pedido anexado (acao 'pedido'): é ele
//     que segue para o PI · Pedido e prova a conversão. 21/10/26: ou o pedido
//     À MÃO (sem o PDF, como o manual do PI — os itens ganhos são o pedido),
//     ou a ORDEM DE VENDA de um pedido feito antes (acao 'ov' com
//     virarPedido: vira pedido e fecha de uma vez). Nos três, CADA ITEM tem
//     de estar marcado Ganho ou Perdido, com ao menos um ganho (as marcas vão
//     juntas em b.resultados);
//   . "Perdida" exige o motivo (lista editável em Configurações);
//   . a DATA DE VENCIMENTO (o "Vencimento" do PDF, ou a data da cotação + os
//     dias de validade do PDF — o dado é datas.validade) é só um AVISO desde
//     20/10/26 (pedido do usuário: "tira a validação da vencida, deixa lançar
//     mesmo vencida"): com ela passada a cotação nasce Cotada, não sai
//     sozinha do funil, recebe o pedido e reabre sem trocar a data. "Vencida"
//     virou uma saída marcada à mão, como Perdida e Cancelada. 22/10/26
//     (pedido do usuário: "tudo que está perdida tem que estar na fase
//     perdida… coloca automaticamente que o comprador não falou o motivo"):
//     a cotação aberta com a data de vencimento passada vira PERDIDA sozinha,
//     com o motivo "Comprador não informou o motivo" (perderVencidas) — uma
//     vez só: reaberta à mão, fica aberta. (A volta das vencidas de 21/10/26
//     saiu: a Vencida automática antiga já é Perdida e fica.)
//   . o pedido que o PI já lançou no Dynamics não deixa a cotação sair de
//     "Virou pedido" (a venda aconteceu);
//   . a cotação FECHA com a(s) ORDEM(NS) DE VENDA do Dynamics (acao 'ov',
//     19/10/26): vale para o pedido lançado pelo PI e para o lançado à mão,
//     uma cotação pode ter mais de uma OV (pedido quebrado), e o número é
//     conferido no F&O (shared/cot-ov.js) — OV que não existe, que já está
//     em outra cotação ou de outro cliente pede confirmação. Com OV a
//     cotação também não sai de "Virou pedido" (tirar a OV destrava). Não há
//     fase nova: a fila "Aguardando OV" é a do pedido lançado sem OV;
//   . a OV também VOLTA SOZINHA (20/10/26): o flow do PI · Pedido cria a OV
//     na mesma execução e chama /api/cot-ov-retorno { Caso, OrdemVenda } com
//     a chave COT_OV_CHAVE (retornoDoFlow). A OV do flow é a do próprio
//     pedido: não pede confirmação — o que a conferência no Dynamics achar
//     de estranho fica guardado como aviso na OV.
//   . o RESULTADO DE CADA ITEM (20/10/26): ganho ou perdido, marcado item a
//     item (acao 'resultado') — a cotação pode virar pedido com parte dos
//     itens perdidos. O índice leva os itens com a marca (itensRes) para a
//     análise de itens do funil.
//
// Empresa: sempre BIO (na MSB, sempre MSB). UNIDADE DE NEGÓCIO (20/10/26): a cotação é da unidade
// de quem registra — a que o Power BI mostra para a pessoa no Comercial (o
// RLS dela, shared/pbi-unidades.js); quem tem 2+ escolhe entre as suas. Sem
// unidade confirmada, não registra. CADA PESSOA VÊ SÓ AS COTAÇÕES DA(S)
// UNIDADE(S) DELA (lista, caso, anexo, ações); o dono vê todas. A Área (a
// EQUIPE de segurança do Entra) segue no caso como informação (Departamento
// da proposta, área demandante do PI).
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
// RECORTE MSB (04/11/2026, pedido do dono): este é o motor do CRM › Venda
// Recorrente do portal da MSB — o mesmo do portal completo (Claude.rep), com:
//   . armazenamento PRÓPRIO (COT_MSB_BLOB_URL, api/shared/cot-store.js): as
//     cotações da BIO não vêm e as da MSB não vão;
//   . EMPRESA fixa MSB (a da BIO era fixa BIO) e a área Venda Recorrente;
//   . número próprio COT-MSB-AAAA-NNNNNN (NUM_PREFIXO): o flow do PI · Pedido
//     é o mesmo da BIO e devolve a OV ao portal completo, que ignora o que não
//     é COT-AAAA-NNNNNN — nunca fecha a cotação da BIO de mesmo número;
//   . UNIDADE fixa MSB (05/11/26; até então VENDA RECORRENTE): não depende
//     do RLS do Power BI, que esconde a unidade MSB (comEscopo);
//   . o dono são as DUAS contas (DONOS), como no resto do portal da MSB;
//   . a Ordem de Venda da MSB (OVMSB…, api/shared/cot-ov.js) e o cliente, o
//     lote e a OV procurados na empresa msb do Dynamics.
//
// Acesso: quem tem a ÁREA Comercial (grupos do Entra, api/shared/auth.js) —
// liberado a pedido do dono em 20/10/26; até então era SÓ o dono (DONO,
// abaixo). O portão (exigirEquipe) exige id token VALIDADO e a área
// comercial confirmada pelo Graph. As CONFIGURAÇÕES seguem só do DONO.
// ================================================================

const crypto = require('crypto');
const store = require('./cot-store');
const auth = require('./auth');
const erp = require('./cot-erp');
const ovD365 = require('./cot-ov');
const pbiU = require('./pbi-unidades');
// o produto no Salesforce (fabricante, RMS e descrição da proposta — 21/10/26)
const produtosSf = require('./cot-produtos');
// o lote do material da A faturar no Dynamics (29/10/26)
const lotesD365 = require('./cot-lotes');

// 21/10/26 (pedido do usuário): SÓ TRÊS FASES — Cotada, Perdida e Ganha
// (virou pedido). O motivo da perda diz o resto (preço, prazo, proposta
// vencida, cancelada pelo comprador…). 26/10/26: + A faturar, depois de Cotada
const FASES = [
  { id: 'cotada', nome: 'Cotada', aberta: true, desc: 'proposta enviada no portal, aguardando o resultado' },
  { id: 'perdida', nome: 'Perdida', perdida: true, desc: 'não virou pedido — o motivo diz por quê (preço, prazo, vencida, cancelada…)' },
  { id: 'pedido', nome: 'Ganha (virou pedido)', ganha: true, desc: 'virou pedido — o pedido (PDF, à mão ou a OV) está no caso' }
];
// 26/10/26 (pedido do usuário): as fases da AMOSTRA — fora das contas, ganha
// ou perdida (a tela pinta de verde ou de vermelho, na coluna Amostra)
const FASES_AMOSTRA = [
  { id: 'amostra', nome: 'Envio de amostra', aberta: true, amostra: true, desc: 'a amostra foi para o cliente, aguardando o resultado' },
  { id: 'amostra_ganha', nome: 'Ganha', ganha: true, amostra: true, desc: 'o cliente aprovou a amostra — fica na Amostra, fora das Ganhas' },
  { id: 'amostra_perdida', nome: 'Perdida', perdida: true, amostra: true, desc: 'o cliente não aprovou a amostra — fica na Amostra, fora das Perdidas' }
];
const TODAS_FASES = FASES.concat(FASES_AMOSTRA);
const FASES_INICIAIS = ['cotada'];
// as fases que existiram: "Em cotação" (até 09/10/26) e "Em negociação" são
// Cotada; "Vencida" e "Cancelada" são Perdida (até 21/10/26). O caso antigo é
// lido assim, sem migrar; a primeira ação nele grava a fase nova.
// RECORTE MSB (05/11/2026, pedido do dono: "tire a fase A FATURAR"): na MSB a
// fase não existe — Cotada -> Ganha / Perdida. A cotação que estava em A
// faturar é lida como Cotada (FASE_ANTIGA); os dados de paciente/lote que ela
// tenha guardado ficam no caso, sem tela.
const FASE_ANTIGA = { em_cotacao: 'cotada', negociacao: 'cotada', vencida: 'perdida', cancelada: 'perdida', faturar: 'cotada' };
function faseAtual(id) { return FASE_ANTIGA[id] || id; }
// a fase como vale hoje (26/10/26): a amostra Cotada (as de antes das fases
// dela) é Envio de amostra
function faseDe(id, amostra) {
  id = faseAtual(id);
  return amostra && id === 'cotada' ? 'amostra' : id;
}
function faseDoCaso(c) { return faseDe(c.fase, !!c.amostra); }
function fase(id) { id = faseAtual(id); return TODAS_FASES.filter(function (f) { return f.id === id; })[0] || null; }
function nomeFase(id) { const f = fase(id); return f ? f.nome : String(id || ''); }
function fechada(id) { const f = fase(id); return !!(f && !f.aberta); }
function aberta(id) { const f = fase(id); return !!(f && f.aberta); }
const MOTIVO_VENCIDA = 'Proposta vencida';
// os motivos da Perdida: os de perda, os de cancelamento (a Cancelada virou
// Perdida) e a proposta vencida (a Vencida também) — sem repetir
function motivosDaPerda(cfg) {
  const vistos = {};
  return [].concat(cfg.motivosPerda || [], cfg.motivosCancelamento || [], [MOTIVO_VENCIDA]).filter(function (m) {
    const k = chaveTxt(m); if (!k || vistos[k]) return false; vistos[k] = 1; return true;
  });
}
const OV_SEM_PEDIDO = 'A Ordem de Venda entra quando o pedido está registrado — ou use "Virou pedido › Já tenho a Ordem de Venda".';
const AMOSTRA_SEM_PEDIDO = 'A amostra não vira pedido nem recebe Ordem de Venda — marque como Ganha ou Perdida (ela fica fora das contas).';
// 26/10/26 (pedido do usuário): "amostra não gera PDF" — sem proposta
const AMOSTRA_SEM_PROPOSTA = 'A amostra não gera a proposta (PDF) — ela é só para a gestão.';
// quem assina o que o portal faz sozinho (a Perdida do prazo vencido)
const SISTEMA = { email: '', nome: 'Portal (automático)', sistema: true };
// o motivo da Perdida que o portal marca sozinho quando o prazo vence (22/10/26)
const MOTIVO_SEM_RESPOSTA = 'Comprador não informou o motivo';

// o dono do módulo: o único que altera as configurações (admin)
const DONO = 'leonardo.barbosa@biomedical.com.br';
// RECORTE MSB: as duas contas do dono (as mesmas do PI · Pedido e das áreas reservadas)
const DONOS = [DONO, 'ia@biomedical.com.br'];
// RECORTE MSB: o número da cotação da MSB — COT-MSB-AAAA-NNNNNN
const NUM_PREFIXO = 'COT-MSB-';
// Os portais que o PI · Pedido já conhece (lista PORTAIS do pedido-inteligente.js,
// que vai ao Dynamics) + GTHealth (o Customer Service vê chegar dele).
const PORTAIS_PADRAO = ['Bionexo', 'Apoio Cotações', 'GTPlan', 'Síntese', 'Smart Compras', 'Uniube',
  'VSSupply - Sta Catarina', 'VSSupply - Sta Catarina/MSB', 'GTHealth', 'Outro'];
const MOTIVOS_PERDA_PADRAO = ['Preço acima do concorrente', 'Prazo de entrega', 'Marca/produto não aceito',
  'Não atende à especificação', 'Documentação/registro', 'Sem estoque', 'Comprador não informou o motivo', 'Outro'];
const MOTIVOS_CANCEL_PADRAO = ['Cancelada pelo comprador', 'Deserta / sem resultado',
  'Não vamos fornecer (declinada)', 'Outro'];
// RECORTE MSB: a cotação é sempre da MSB (no portal completo, sempre da BIO)
const EMPRESAS_PADRAO = ['MSB'];
const EMPRESA_FIXA = 'MSB';
// RECORTE MSB: o CRM da MSB tem só a Venda Recorrente
const AREAS_PADRAO = ['Venda Recorrente'];
// a unidade de negócio de toda cotação da MSB (ver comEscopo) — 05/11/26,
// pedido do dono: "a unidade de negócio é MSB" (antes era VENDA RECORRENTE;
// a que tiver ficado assim é lida como MSB: listar/obterBruto)
const UNIDADE_MSB = 'MSB';
// o grupo aparece no PDF como FORNECEDOR — nunca é o cliente (a Biomedical;
// o CNPJ da MSB entra em COT_CNPJS_PROPRIOS, separados por vírgula)
const CNPJS_PROPRIOS = ['19848316000166'].concat(String(process.env.COT_CNPJS_PROPRIOS || '').split(/[,;\s]+/)
  .map(function (v) { return v.replace(/\D/g, ''); }).filter(function (v) { return v.length === 14; }));
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
  if (!store.configurado()) throw erro(409, 'Armazenamento não configurado (COT_MSB_BLOB_URL).');
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
// identidade legada vem de header, e header qualquer um escreve) e com a
// área COMERCIAL confirmada (20/10/26 — antes era só o DONO). Vale a mesma
// regra das áreas do portal (auth.authorizedAreas, grupos lidos pelo oid do
// token): grupo do Comercial, acesso full (admin/sem restrição) ou módulo
// avulso comercial-cot-*. Os dois fail-open do portal NÃO abrem aqui: Graph
// fora do ar (groups_unavailable) e pessoa sem grupo mapeado
// (no_group_match) recebem 403 — o módulo grava caso de cliente.
// Configurações: só o DONO (admin). (O nome "exigirEquipe" fica: é o
// porteiro que o scripts/test-api-guard.js conhece.)
const RAZOES_COM_REGRA = ['admin', 'unrestricted_group', 'group_rule'];
async function exigirEquipe(req) {
  const r = await auth.requireUser(req);
  const email = String((r.user && r.user.email) || '').trim().toLowerCase();
  if (!r.validated || !email) throw erro(401, 'Entre com a sua conta Microsoft para usar o módulo Cotações.');
  const dono = DONOS.indexOf(email) >= 0;
  // ACESSO FULL (04/11/2026, o CRM do Comercial): admin ou grupo sem
  // restrição — a mesma régua do auth.js (RAZOES_FULL), lida da resposta que
  // o portão já pediu (nenhuma consulta a mais ao Graph). É quem ESCOLHE o
  // submódulo do CRM; quem não tem cai direto no da sua unidade de negócio.
  let full = dono;
  if (!dono) {
    let az = null;
    try { az = await auth.authorizedAreas(r.user); } catch (e) { az = null; }
    const temRegra = !!(az && RAZOES_COM_REGRA.indexOf(az.reason) >= 0);
    const comercial = temRegra && ((az.areas || []).indexOf('comercial') >= 0 ||
      (az.modulos || []).some(function (m) { return /^comercial-(cot-|crm$)/.test(String(m)); }));
    // 09/11/26: o MOTIVO e a CONTA vão na mensagem — o "não foi confirmado"
    // sozinho não dizia se a pessoa estava fora dos grupos, logada com outra
    // conta (a @msbbrasil.com no lugar da @biomedical.com.br, ou o contrário)
    // ou se o Graph não respondeu.
    if (!comercial) {
      const motivo = !az ? 'a consulta dos seus grupos no Entra falhou — tente de novo em instantes'
        : az.reason === 'groups_unavailable' ? 'o Microsoft Graph não respondeu a consulta dos seus grupos'
          + (az.falhaGrupos ? ' (' + az.falhaGrupos + ')' : '') + ' — tente de novo em instantes'
        : az.reason === 'no_group_match' ? 'a conta ' + email + ' não está em nenhum grupo de segurança liberado no portal'
          + (typeof az.gruposLidos === 'number' ? ' (o Entra devolveu ' + az.gruposLidos + ' grupo' + (az.gruposLidos === 1 ? '' : 's') + ' para ela)' : '')
        : 'os grupos da conta ' + email + ' não liberam o Comercial';
      throw erro(403, 'O CRM é do Comercial — o seu acesso ao Comercial não foi confirmado: ' + motivo + '.',
        { motivoAcesso: az ? az.reason : 'erro', conta: email });
    }
    full = !!(az && (az.reason === 'admin' || az.reason === 'unrestricted_group'));
  }
  const cfg = await lerConfig();
  return { email: email, nome: (r.user && r.user.name) || email, oid: (r.user && r.user.oid) || '', admin: dono, full: full, cfg: cfg };
}
function pessoa(quem) { return { email: quem.email, nome: quem.nome || quem.email }; }

// ── a UNIDADE DE NEGÓCIO (o RLS do Power BI) ──────────────────────
// A tela manda o token delegado do Power BI em x-pbi-token; o escopo fica
// em cache por 1 h (um pedido que vier sem o token — o PI, por exemplo —
// ainda acha as unidades confirmadas pela tela).
const ESCOPO_TTL_MS = 60 * 60e3;
// RECORTE MSB: o CRM da MSB não tem submódulo e o RLS do Power BI põe a gente
// da MSB na unidade "MSB", que o pbi-unidades esconde — então a unidade é
// FIXA: toda cotação daqui é da unidade MSB e quem passou pelo exigirEquipe
// (área Comercial confirmada) vê todas (veCaso). O token do
// Power BI continua servindo à FAMÍLIA dos produtos do Analítico (familias).
async function comEscopo(req, quem) {
  quem.escopo = { conhecido: true, gerencial: false, unidades: [UNIDADE_MSB], fonte: 'msb' };
  return quem;
}
// a pessoa só vê a cotação da(s) unidade(s) dela; o dono e o portal (varredura,
// flow do PI) veem todas. Sem unidade confirmada não vê nenhuma; cotação sem
// unidade (anterior a 20/10/26) só o dono vê.
function veCaso(quem, c) {
  if (!c) return false;
  if (!quem || quem.admin || quem.sistema) return true;
  const esc = quem.escopo || {};
  // RECORTE MSB: o container só tem cotações da MSB — quem tem o Comercial vê todas
  if (esc.fonte === 'msb') return true;
  return !!(c.unidade && esc.conhecido && pbiU.unidadeDoEscopo(c.unidade, esc));
}
// a unidade da cotação nova: a única da pessoa, ou a que ela escolheu entre as dela
function unidadeParaRegistrar(quem, pedida) {
  const esc = quem.escopo || {};
  if (!esc.conhecido) throw erro(409, 'Não consegui confirmar a sua unidade de negócio no Power BI (' + pbiU.motivoFechado(esc) + ') — sem ela a cotação não é registrada. Recarregue a página e tente de novo.', { semUnidade: true });
  if (!esc.unidades.length) throw erro(403, 'O Power BI não mostra nenhuma unidade de negócio para você no Comercial — sem unidade a cotação não é registrada.', { semUnidade: true });
  if (esc.unidades.length === 1) return esc.unidades[0];
  const u = pbiU.unidadeDoEscopo(pedida, esc);
  if (!u) throw erro(400, pedida ? 'A unidade "' + txt(pedida, 80) + '" não está entre as suas no Power BI.' : 'Escolha a unidade de negócio da cotação.', { escolherUnidade: true, unidades: esc.unidades });
  return u;
}
// a cotação que a pessoa não vê é, para ela, uma cotação que não existe
async function obterVisivel(numero, quem) {
  const c = await obterBruto(numero);
  if (!c || !veCaso(quem, c)) throw erro(404, 'Cotação não encontrada.');
  return c;
}

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
// o resultado do item: 'ganho' | 'perdido' | '' (sem resultado)
function resultadoDe(v) { const k = chaveTxt(v); return k === 'ganho' || k === 'perdido' ? k : ''; }
function itensDe(l) {
  return (Array.isArray(l) ? l : []).slice(0, 400).map(function (it) {
    it = it || {};
    const o = {
      codigo: txt(it.codigo, 40), codigoCliente: txt(it.codigoCliente, 40), descricao: txt(it.descricao, 300),
      // marca = o FABRICANTE da proposta; registro = o RMS (registro ANVISA)
      marca: txt(it.marca, 80), registro: txt(it.registro, 30), unidade: txt(it.unidade, 12),
      quantidade: num(it.quantidade), valorUnitario: num(it.valorUnitario)
    };
    // só quando marcado: o item sem resultado continua igual ao de antes; o
    // perdido pode dizer o motivo (a lista de motivos de perda, ou o escrito)
    const r = resultadoDe(it.resultado);
    if (r) o.resultado = r;
    if (r === 'perdido' && txt(it.motivo, 80)) o.motivo = txt(it.motivo, 80);
    // o lote do material usado (os dados da A faturar — 26/10/26)
    if (txt(it.lote, 60)) o.lote = txt(it.lote, 60);
    // o IPI do item, em % (29/10/26: o "Tem IPI?" — sai na proposta)
    const ipi = num(it.ipi);
    if (ipi > 0 && ipi <= 100) o.ipi = r2(ipi);
    return o;
  }).filter(function (it) { return it.descricao || it.codigo || it.codigoCliente; });
}
function somaItens(itens) { return r2((itens || []).reduce(function (s, it) { return s + (it.quantidade || 0) * (it.valorUnitario || 0); }, 0)); }
// "3 item(ns) · R$ 5.219,00 · 2 ganho(s) · 1 perdido(s)" (o histórico)
function textoItens(itens, total) {
  const g = (itens || []).filter(function (it) { return it.resultado === 'ganho'; }).length;
  const p = (itens || []).filter(function (it) { return it.resultado === 'perdido'; }).length;
  return (itens || []).length + ' item(ns) · ' + brl(total) + (g ? ' · ' + g + ' ganho(s)' : '') + (p ? ' · ' + p + ' perdido(s)' : '');
}

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
    // a unidade que a tela escolheu (quem tem 2+); novo() confere no escopo
    unidade: txt(d.unidade, 80),
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

// a versão do resumo: o resumo gravado com uma versão mais velha é refeito
// na leitura da lista (completarResumos) — 2 = itensRes + concorrente (20/10/26)
// 3 = a fase A faturar e as da amostra (26/10/26)
const RESUMO_V = 3;
function resumoDe(c) {
  const ped = c.pedido || null;
  const previa = ped && ped.previa;
  return {
    rv: RESUMO_V,
    numero: c.numero, fase: faseDoCaso(c), portal: c.portal || '', cotacaoId: c.cotacaoId || '',
    cliente: { nome: (c.cliente && c.cliente.nome) || '', cnpj: (c.cliente && c.cliente.cnpj) || '', codigo: (c.cliente && c.cliente.codigo) || '', uf: (c.cliente && c.cliente.uf) || '', cidade: (c.cliente && c.cliente.cidade) || '' },
    empresa: c.empresa || '', area: c.area || '', unidade: c.unidade || '',
    dono: c.dono ? { email: c.dono.email, nome: c.dono.nome } : null,
    total: r2(c.total), nItens: (c.itens || []).length,
    totalPedido: ped ? r2((previa && previa.total) || ped.total || 0) : 0,
    oc: ped ? (ped.oc || (previa && previa.oc) || '') : '',
    validade: (c.datas && c.datas.validade) || '', dataCotacao: (c.datas && c.datas.cotacao) || '',
    criadoEm: c.criadoEm, atualizadoEm: c.atualizadoEm, faseEm: c.faseEm || c.criadoEm, fechadoEm: c.fechadoEm || null,
    // o caminho de fases, curto: o funil mede até onde cada cotação chegou
    fases: (c.fases || []).slice(-12).map(function (f) { return [faseDe(f.fase, !!c.amostra), diaBrasilia(f.em)]; }),
    // a proposta foi para o comprador? (última)
    proposta: c.proposta ? { em: c.proposta.em, para: (c.proposta.para || []).join(', ') } : null,
    pi: c.pi ? c.pi.estado || '' : '',
    // as Ordens de Venda com que a cotação fechou (a fila "Aguardando OV")
    ovs: (c.ovs || []).map(function (o) { return o.numero; }),
    perda: c.perda ? c.perda.motivo || '' : '',
    // o portal já marcou Perdida pelo prazo vencido (uma vez só — perderVencidas)
    perdaAuto: !!c.perdaAuto,
    // o pedido registrado (22/10/26: a cotação aberta com pedido aguarda a OV)
    temPedido: !!c.pedido,
    // o concorrente que levou e o preço dele (a "distância do concorrente" do Analítico)
    concorrente: (c.perda && c.perda.concorrente) || '', valorConcorrente: (c.perda && r2(c.perda.valorConcorrente)) || 0,
    // a AMOSTRA (23/10/26): a cópia da perdida — fora de todas as contas da
    // tela — diz de qual veio; a original lista as amostras que gerou
    amostra: !!c.amostra, amostraDe: (c.amostra && c.amostra.de) || '',
    amostras: (c.amostras || []).map(function (a) { return a.numero; }),
    // o paciente da A faturar (26/10/26 — a busca acha por ele)
    paciente: (c.faturamento && c.faturamento.paciente) || '',
    nAnexos: (c.anexos || []).filter(function (a) { return !a.removido; }).length,
    nNotas: (c.notas || []).length,
    descartado: !!c.descartado,
    // para a busca achar pelo produto
    itensTxt: (c.itens || []).slice(0, 6).map(function (i) { return i.descricao || i.codigo; }).join(' · ').slice(0, 240),
    // a análise de itens (Funil › Analítico): [código, descrição curta,
    // quantidade, valor cotado, 'g' ganho | 'p' perdido | '' sem marca,
    // motivo do perdido (só quando dito)]
    itensRes: itensResDe(c.itens)
  };
}
function itensResDe(itens) {
  return (itens || []).slice(0, 60).map(function (i) {
    const x = [i.codigo || '', String(i.descricao || '').slice(0, 70), i.quantidade || 0, r2((i.quantidade || 0) * (i.valorUnitario || 0)),
      i.resultado === 'ganho' ? 'g' : i.resultado === 'perdido' ? 'p' : ''];
    if (i.resultado === 'perdido' && i.motivo) x.push(i.motivo);
    return x;
  });
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
  o.fase = faseDoCaso(c);
  if (Array.isArray(c.fases)) o.fases = c.fases.map(function (f) { return Object.assign({}, f, { fase: faseDe(f && f.fase, !!c.amostra) }); });
  o.anexos = (c.anexos || []).map(anexoPublico);
  return o;
}

// ── leitura ───────────────────────────────────────────────────────
async function listar() {
  const ix = (await store.ler(store.INDICE, INDICE_VAZIO)).dados;
  (ix.casos || []).forEach(function (r) {
    if (r.unidade) r.unidade = UNIDADE_MSB;   // RECORTE MSB: toda cotação daqui é da unidade MSB
    r.fase = faseDe(r.fase, !!r.amostra);
    if (Array.isArray(r.fases)) r.fases = r.fases.map(function (f) { return [faseDe(f[0], !!r.amostra), f[1]]; });
  });
  return ix;
}
function numeroOk(numero) { return /^COT-MSB-\d{4}-\d{6}$/.test(String(numero || '')); }
async function obterBruto(numero) {
  if (!numeroOk(numero)) throw erro(400, 'Número de cotação inválido.');
  const c = (await store.ler(store.arquivoDoCaso(numero), null)).dados;
  if (c) c.fase = faseDoCaso(c);
  if (c && c.unidade) c.unidade = UNIDADE_MSB;   // RECORTE MSB: a próxima gravação já sai com MSB
  return c;
}
async function obter(numero, quem) {
  const c = await obterBruto(numero);
  return c && quem && !veCaso(quem, c) ? null : casoPublico(c);
}
async function arquivo(numero, id, quem) {
  const c = await obterBruto(numero);
  if (!c || (quem && !veCaso(quem, c))) throw erro(404, 'Cotação não encontrada.');
  const a = (c.anexos || []).filter(function (x) { return x.id === String(id || ''); })[0];
  if (!a) throw erro(404, 'Anexo não encontrado nesta cotação.');
  const bytes = await store.lerArquivo(a.caminho);
  if (!bytes) throw erro(404, 'O arquivo deste anexo não está mais no armazenamento.');
  return { nome: a.nome, tipo: a.mime, tamanho: bytes.length, base64: bytes.toString('base64') };
}
// a mesma cotação já virou caso? (o Agente pergunta antes de criar)
async function duplicado(portal, cotacaoId, cfg, quem) {
  const k = chaveDe(portalDe(portal, cfg), cotacaoId);
  if (!k || !store.configurado()) return null;
  const ix = await listar();
  const num = (ix.chaves || {})[k];
  const res = num && (ix.casos || []).filter(function (c) { return c.numero === num; })[0];
  if (!res || res.descartado) return null;
  // de outra unidade: só avisa que existe (sem número nem dados)
  return quem && !veCaso(quem, res) ? { numero: '', outraUnidade: true, fase: res.fase, unidade: res.unidade || '' } : res;
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
    // (a amostra não ocupa a chave: a mesma cotação é a original)
    const k = c.descartado || c.amostra ? '' : chaveDe(c.portal, c.cotacaoId);
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
// o comprador pelo CÓDIGO do cliente no ERP (o Agente: "buscar pelo código")
async function consultarErpCodigo(codigo, lancar) {
  if (!erp.codigoDe(codigo)) return { achou: false, motivo: 'código inválido' };
  try {
    const v = await erp.clientePorCodigo(codigo, { timeoutMs: 8000 });
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
  const de = o.origem === 'flow' ? ' (devolvida pelo flow do PI)' : o.origem === 'pi' ? ' (pedido do PI)' : ' (lançada fora do PI)';
  return 'Ordem de Venda ' + o.numero + de + ' · ' + conf + ((o.avisos || []).length ? ' · aviso: ' + o.avisos.join('; ') : '');
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

// ── a OV que o flow do PI devolve (/api/cot-ov-retorno) ────────────
// Sem login (quem chama é o Power Automate): a porta só age com a chave
// secreta COT_OV_CHAVE no cabeçalho x-portal-chave. Fail-closed: sem a
// variável (ou curta demais) a porta responde 503 e não faz nada.
const FLOW_PI = { email: '', nome: 'Power Automate (PI · Pedido)', sistema: true, flow: true };
const CHAVE_MIN = 24;
function exigirChaveDoFlow(req) {
  const certa = String(process.env.COT_OV_CHAVE || '');
  if (certa.length < CHAVE_MIN) throw erro(503, 'Retorno da OV desligado (COT_OV_CHAVE não configurada).');
  const h = (req && req.headers) || {};
  const veio = String(h['x-portal-chave'] || h['X-Portal-Chave'] || '');
  const hash = function (v) { return crypto.createHash('sha256').update(v).digest(); };
  if (!veio || !crypto.timingSafeEqual(hash(veio), hash(certa))) throw erro(401, 'Chave do flow ausente ou errada.');
}
// { Caso, OrdemVenda } do flow -> a OV entra na cotação (uma ou várias)
async function retornoDoFlow(caso, ovs) {
  const numero = txt(caso, 40).toUpperCase();
  // o mesmo flow recebe pedido do Customer Service e do PI avulso: não é cotação, não é com a gente
  if (!numeroOk(numero)) return { ignorado: true, motivo: 'Caso não é uma cotação (' + (numero || 'vazio') + ')' };
  const brutos = (Array.isArray(ovs) ? ovs : String(ovs == null ? '' : ovs).split(/[,;\r\n]+/)).map(function (v) { return txt(v, 30); }).filter(Boolean);
  const lista = brutos.map(ovD365.numeroOv);
  const ruins = brutos.filter(function (v, i) { return !lista[i]; });
  if (!brutos.length || ruins.length) throw erro(400, 'OrdemVenda inválida' + (ruins.length ? ' (' + ruins.join(', ') + ')' : '') + ' — use ' + ovD365.PREFIXO + ' seguido dos números.');
  const quem = Object.assign({ cfg: await lerConfig() }, FLOW_PI);
  let c = null;
  for (const n of lista.filter(function (v, i, l) { return l.indexOf(v) === i; })) c = await agir(numero, { acao: 'ov', ov: n, doFlow: true }, quem);
  return { caso: numero, ovs: (c.ovs || []).map(function (o) { return o.numero; }), fase: c.fase };
}

// ── o RESULTADO DE CADA ITEM ao virar pedido (21/10/26) ───────────
// Pedido do usuário: "quando virar pedido, obrigatoriamente a pessoa tem que
// marcar se o item foi ganho ou perdido, todos os itens". Vale para o PDF do
// pedido, o pedido à mão e a OV direta; quem vira pedido manda as marcas junto
// (b.resultados, no formato da ação 'resultado').
// marcas = [{ i, codigo?, descricao?, resultado, motivo? }]; devolve quantos mudaram
function aplicarResultados(c, marcas, cfg, eu) {
  const its = c.itens || [];
  const pedidos = (Array.isArray(marcas) ? marcas : []).slice(0, 400);
  if (!pedidos.length) throw erro(400, 'Informe o item e o resultado.');
  const mudou = 'Os itens desta cotação mudaram — atualize a tela e marque de novo.';
  const noPedido = faseAtual(c.fase) === 'pedido' || !!c.pedido;
  const muda = [];
  pedidos.forEach(function (p) {
    p = p || {};
    const i = Number(p.i), it = Number.isInteger(i) ? its[i] : null;
    if (!it) throw erro(409, mudou);
    if ((p.codigo != null && String(p.codigo) !== (it.codigo || '')) || (p.descricao != null && String(p.descricao) !== (it.descricao || ''))) throw erro(409, mudou);
    const r = resultadoDe(p.resultado);
    if (p.resultado && !r) throw erro(400, 'Resultado inválido — use ganho ou perdido.');
    if (!r && noPedido) throw erro(400, 'Na cotação que virou pedido cada item fica Ganho ou Perdido — escolha um dos dois.');
    const motAntes = it.motivo || '';
    const mot = r !== 'perdido' ? '' : p.motivo == null ? (it.resultado === 'perdido' ? motAntes : '') : (daLista(p.motivo, cfg.motivosPerda) || txt(p.motivo, 80));
    if (((it.resultado || '') !== r || motAntes !== mot) && !muda.some(function (m) { return m.i === i; })) {
      muda.push({ i: i, it: it, de: it.resultado || '', para: r, deMot: motAntes, paraMot: mot });
    }
  });
  if (!muda.length) return 0;
  const nome = function (r, m) { return (r === 'ganho' ? 'Ganho' : r === 'perdido' ? 'Perdido' : '(sem resultado)') + (m ? ' · ' + m : ''); };
  muda.forEach(function (m) {
    if (m.para) m.it.resultado = m.para; else delete m.it.resultado;
    if (m.paraMot) m.it.motivo = m.paraMot; else delete m.it.motivo;
  });
  if (muda.length <= 5) {
    muda.forEach(function (m) {
      const d = m.it.descricao || m.it.codigo || '';
      hist(c, { por: eu, tipo: 'campo', campo: 'Resultado do item', de: nome(m.de, m.deMot), para: nome(m.para, m.paraMot),
        texto: 'Item ' + (m.i + 1) + (d ? ' · ' + (d.length > 100 ? d.slice(0, 100) + '…' : d) : '') });
    });
  } else {
    const g = muda.filter(function (m) { return m.para === 'ganho'; }).length, pe = muda.filter(function (m) { return m.para === 'perdido'; }).length;
    hist(c, { por: eu, tipo: 'campo', campo: 'Resultado dos itens', de: '', para: [g && g + ' ganho(s)', pe && pe + ' perdido(s)', muda.length - g - pe && (muda.length - g - pe) + ' sem resultado'].filter(Boolean).join(' · '),
      texto: muda.length + ' itens marcados de uma vez' });
  }
  return muda.length;
}
// o que falta para virar pedido: todo item marcado e ao menos um ganho. As
// marcas que vêm no mesmo pedido (b.resultados) contam — assim a conferência
// roda antes de subir o PDF. '' = pode virar.
function faltaResultado(c, marcas) {
  const rs = (c.itens || []).map(function (it) { return it.resultado || ''; });
  if (!rs.length) return '';
  (Array.isArray(marcas) ? marcas : []).forEach(function (m) {
    const i = Number(m && m.i);
    if (Number.isInteger(i) && i >= 0 && i < rs.length) rs[i] = resultadoDe(m.resultado);
  });
  const sem = rs.filter(function (r) { return r !== 'ganho' && r !== 'perdido'; }).length;
  if (sem) return 'Para virar pedido, marque cada item como Ganho ou Perdido — falta' + (sem > 1 ? 'm ' + sem + ' itens' : ' 1 item') + '.';
  if (rs.indexOf('ganho') < 0) return 'Nenhum item foi marcado como Ganho — para virar pedido, ao menos um tem de ser ganho (se nada foi ganho, a cotação é Perdida).';
  return '';
}
// ── os DADOS DA A FATURAR (26/10/26) ──────────────────────────────
// Pedido do usuário: "pra esses casos de A faturar, preciso inserir os dados
// de paciente (nome, data da cirurgia, convênio, nome do médico) e o lote do
// material que foi utilizado — somente se for para A faturar". Ficam em
// c.faturamento e no lote de cada item (itens[].lote); são exigidos ao passar
// para A faturar (fase{faturar, faturamento, lotes}) e só se editam nela
// (acao 'faturamento'). O item marcado Perdido não pede o lote.
const CAMPOS_FAT = [['paciente', 'Nome do paciente', 160], ['cirurgia', 'Data da cirurgia', 0], ['convenio', 'Convênio', 120], ['medico', 'Nome do médico', 120]];
// 29/10/26 (pedido do usuário): "um checkbox para inserir NÃO INFORMADO em todos
// os campos, menos o lote" — o dado que o cliente não mandou entra assim (a data
// da cirurgia também); o lote segue obrigatório
const NAO_INFORMADO = 'NÃO INFORMADO';
function naoInformado(v) { return String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase() === 'nao informado'; }
// grava o que veio (b.faturamento, b.lotes) com o histórico; devolve quantos campos mudaram.
// 29/10/26 (pedido do usuário: "tenho que validar o LOTE e verificar se ele de
// fato existe, com base no PRODUTO da cotação"): cada lote novo vem conferido
// no Dynamics (ctx.lotes, consultado em agir antes da gravação) — o que não
// existe para o Cód. Biomedical do item recusa tudo (400); com o Dynamics fora
// (ou desligado), entra sem a conferência, marcado (itens[].loteConf.ok null)
function aplicarFaturamento(c, b, eu, ctx) {
  const f = b.faturamento || {}, its = c.itens || [];
  const fa = Object.assign({}, c.faturamento || {});
  const muda = [];
  CAMPOS_FAT.forEach(function (x) {
    if (f[x[0]] == null) return;
    const v = naoInformado(f[x[0]]) ? NAO_INFORMADO : x[0] === 'cirurgia' ? diaValido(dataDe(f.cirurgia).slice(0, 10)) : txt(f[x[0]], x[2]);
    if (x[0] === 'cirurgia' && f.cirurgia && !v) throw erro(400, 'Data da cirurgia: data inválida.');
    if ((fa[x[0]] || '') === v) return;
    muda.push([x[1], x[0] === 'cirurgia' ? rotuloData(fa[x[0]]) : fa[x[0]] || '', x[0] === 'cirurgia' ? rotuloData(v) : v]);
    fa[x[0]] = v;
  });
  const mudou = 'Os itens desta cotação mudaram — atualize a tela e preencha o lote de novo.';
  const lotes = [], reconf = [];
  (Array.isArray(b.lotes) ? b.lotes : []).slice(0, 400).forEach(function (p) {
    p = p || {};
    const i = Number(p.i), it = Number.isInteger(i) ? its[i] : null;
    if (!it) throw erro(409, mudou);
    if ((p.codigo != null && String(p.codigo) !== (it.codigo || '')) || (p.descricao != null && String(p.descricao) !== (it.descricao || ''))) throw erro(409, mudou);
    // um ou mais lotes ("L1, L2" — o item que usou mais de um), em maiúsculas
    const v = lotesD365.separar(p.lote).join(', ').slice(0, 60);
    if ((it.lote || '') !== v) lotes.push({ i: i, it: it, de: it.lote || '', para: v });
    // o mesmo lote, gravado antes sem a conferência: confere agora (sem histórico)
    else if (v && !(it.loteConf && it.loteConf.ok)) reconf.push({ i: i, it: it, de: v, para: v });
  });
  // a conferência no Dynamics: o lote que não existe para o produto barra tudo
  const conf = (ctx && ctx.lotes) || null, naoAchou = [];
  lotes.concat(reconf).forEach(function (l) {
    if (!l.para) { l.conf = null; return; }
    // (sem o Dynamics ligado no portal não há o que conferir: entra marcado)
    if (!l.it.codigo && ctx && ctx.lotesConfigurado) throw erro(400, 'O item ' + (l.i + 1) + ' (' + (l.it.descricao || 'sem descrição').slice(0, 60) + ') não tem o Código do produto — corrija o item (Itens cotados › Editar) para conferir o lote.');
    const rs = lotesD365.separar(l.para).map(function (x) {
      return (conf && conf[String(l.it.codigo).toUpperCase() + '|' + x]) || { existe: null, validade: '', erro: 'sem a conferência' };
    });
    rs.forEach(function (r, k) { if (r.existe === false) naoAchou.push(lotesD365.separar(l.para)[k] + ' (cód. ' + l.it.codigo + ' · ' + (l.it.descricao || '').slice(0, 50) + ')'); });
    const ok = rs.every(function (r) { return r.existe === true; });
    l.conf = { ok: ok ? true : null, validade: rs.map(function (r) { return r.validade || ''; }), em: agora(), erro: ok ? '' : (rs.filter(function (r) { return r.erro; })[0] || {}).erro || '' };
  });
  if (naoAchou.length) throw erro(400, 'Lote não encontrado no Dynamics para o produto da cotação: ' + naoAchou.join('; ') + ' — confira o lote.', { lotesNaoEncontrados: naoAchou });
  lotes.concat(reconf).forEach(function (l) {
    if (l.para) { l.it.lote = l.para; l.it.loteConf = l.conf; } else { delete l.it.lote; delete l.it.loteConf; }
  });
  if (muda.length) { fa.em = agora(); fa.por = eu; c.faturamento = fa; }
  muda.forEach(function (m) { hist(c, { por: eu, tipo: 'campo', campo: m[0], de: m[1], para: m[2] }); });
  if (lotes.length && lotes.length <= 5) {
    lotes.forEach(function (l) {
      const d = l.it.descricao || l.it.codigo || '';
      hist(c, { por: eu, tipo: 'campo', campo: 'Lote do item', de: l.de, para: l.para, texto: 'Item ' + (l.i + 1) + (d ? ' · ' + (d.length > 100 ? d.slice(0, 100) + '…' : d) : '') });
    });
  } else if (lotes.length) {
    hist(c, { por: eu, tipo: 'campo', campo: 'Lote dos itens', de: '', para: lotes.length + ' item(ns)', texto: lotes.slice(0, 12).map(function (l) { return 'Item ' + (l.i + 1) + ': ' + (l.para || '(sem lote)'); }).join(' · ') });
  }
  return muda.length + lotes.length;
}
// 'AAAA-MM-DD' que existe no calendário (31/02 não) — '' se não
function diaValido(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); if (!m) return '';
  const x = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return x.getUTCFullYear() === +m[1] && x.getUTCMonth() === +m[2] - 1 && x.getUTCDate() === +m[3] ? d : '';
}
// o que falta para a A faturar: '' = está tudo
function faltaFaturamento(c) {
  const fa = c.faturamento || {};
  const falta = CAMPOS_FAT.filter(function (x) { return !fa[x[0]]; }).map(function (x) { return x[1]; });
  const sem = (c.itens || []).filter(function (it) { return it.resultado !== 'perdido' && !it.lote; }).length;
  if (sem) falta.push('o lote de ' + (sem > 1 ? sem + ' itens' : '1 item'));
  return falta.length ? 'Para passar para A faturar, preencha: ' + falta.join(', ') + '.' : '';
}

// voltar para Cotada (22/10/26): o resultado e o motivo de cada item saem —
// código, quantidade e preço ficam. Devolve quantos itens tinham marca
function zerarResultados(c) {
  let n = 0;
  (c.itens || []).forEach(function (it) { if (it.resultado || it.motivo) { n++; delete it.resultado; delete it.motivo; } });
  return n;
}
// o valor dos itens ganhos: o total do pedido à mão
function somaGanhos(c) {
  return r2((c.itens || []).reduce(function (s, it) { return s + (it.resultado === 'ganho' ? (it.quantidade || 0) * (it.valorUnitario || 0) : 0); }, 0));
}

// ── o PDF do pedido × a cotação (22/10/26) ────────────────────────
// Pedido do usuário: virar pedido pelo PDF tem de dar MATCH dos itens do
// pedido com os da cotação — mesmo item, mesmo preço e mesma quantidade.
// Divergência barra (a pessoa ajusta); tudo certo, o item é ganho direto; o
// cotado que não veio no pedido é perdido. (À mão e pela OV não confrontam:
// a pessoa marca cada item.) Casa cada item do pedido com um da cotação — 1º
// pelo código (Biomedical ou do comprador), 2º pela descrição (metade das
// palavras em comum) —, a MESMA regra do C.comparar da tela (o teste confere
// as duas). st: ok (mesma qtd; preço até 1 centavo) · dif (preço ou qtd
// diferente) · fora (cotado, não pedido) · extra (no pedido, fora da cotação)
function palavrasDe(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').split(' ').filter(function (w) { return w.length > 1; }); }
function parecido(a, b) {
  if (chaveTxt(a) && chaveTxt(a) === chaveTxt(b)) return 1;   // a mesma descrição (até a curtinha)
  const A = palavrasDe(a), B = palavrasDe(b); if (!A.length || !B.length) return 0;
  return A.filter(function (w) { return B.indexOf(w) >= 0; }).length / Math.max(A.length, B.length);
}
function confrontar(cotados, pedidos) {
  const usados = {}, linhas = [];
  cotados = cotados || [];
  (pedidos || []).forEach(function (p) {
    const cp = chaveTxt(p.codigo);
    let alvo = -1;
    if (cp) cotados.some(function (c, i) { if (!usados[i] && (chaveTxt(c.codigo) === cp || chaveTxt(c.codigoCliente) === cp)) { alvo = i; return true; } return false; });
    if (alvo < 0) {
      let melhor = 0;
      cotados.forEach(function (c, i) { if (usados[i]) return; const s = parecido(c.descricao, p.descricao); if (s > melhor && s >= 0.5) { melhor = s; alvo = i; } });
    }
    if (alvo < 0) { linhas.push({ st: 'extra', ped: p }); return; }
    usados[alvo] = 1;
    const c = cotados[alvo];
    const mesmaQtd = Math.abs((Number(c.quantidade) || 0) - (Number(p.quantidade) || 0)) < 1e-6;
    const mesmoPreco = Math.abs((Number(c.valorUnitario) || 0) - (Number(p.valorUnitario) || 0)) <= 0.010001;
    linhas.push({ st: mesmaQtd && mesmoPreco ? 'ok' : 'dif', i: alvo, cot: c, ped: p, mesmaQtd: mesmaQtd, mesmoPreco: mesmoPreco });
  });
  cotados.forEach(function (c, i) { if (!usados[i]) linhas.push({ st: 'fora', i: i, cot: c }); });
  const conta = function (s) { return linhas.filter(function (l) { return l.st === s; }).length; };
  return { linhas: linhas, ok: conta('ok'), dif: conta('dif'), fora: conta('fora'), extra: conta('extra') };
}
// as divergências que barram, em texto (no máximo 6)
function divergencias(cmp) {
  const nome = function (x) { return txt((x && (x.descricao || x.codigo)) || 'item sem descrição', 60); };
  const q = function (n) { return String(Math.round((Number(n) || 0) * 1000) / 1000).replace('.', ','); };
  return cmp.linhas.filter(function (l) { return l.st === 'dif' || l.st === 'extra'; }).slice(0, 6).map(function (l) {
    if (l.st === 'extra') return nome(l.ped) + ': está no pedido (' + q(l.ped.quantidade) + ' × ' + brl(l.ped.valorUnitario) + ') e não na cotação';
    return nome(l.cot) + ': ' + [!l.mesmaQtd ? 'quantidade ' + q(l.cot.quantidade) + ' na cotação e ' + q(l.ped.quantidade) + ' no pedido' : '',
      !l.mesmoPreco ? 'preço ' + brl(l.cot.valorUnitario) + ' na cotação e ' + brl(l.ped.valorUnitario) + ' no pedido' : ''].filter(Boolean).join('; ');
  });
}
// virar pedido pelo PDF: a leitura (previa.produtos) tem de bater com a
// cotação. Devolve as marcas (igual = ganho; não veio = perdido, com o motivo
// que a tela mandou) e o confronto; divergência = 409 com a lista
function conferirPedidoPdf(c, previa, marcas) {
  const prods = (previa && Array.isArray(previa.produtos)) ? previa.produtos.slice(0, 120) : [];
  if (!prods.length) throw erro(400, 'Leia o PDF do pedido antes de virar pedido: os itens dele são conferidos com os da cotação. PDF sem texto (escaneado)? Registre à mão.');
  const cmp = confrontar(c.itens || [], prods);
  const div = divergencias(cmp);
  if (div.length) throw erro(409, 'O pedido não bate com a cotação — ajuste os itens da cotação (ou confira o PDF) antes de virar pedido: ' + div.join(' · ') + '.', { divergencias: div });
  if (!cmp.ok) throw erro(409, 'Nenhum item do pedido está na cotação — confira se o PDF é o pedido desta cotação.', { divergencias: [] });
  const mot = {};
  (Array.isArray(marcas) ? marcas : []).forEach(function (m) { if (m && m.motivo) mot[Number(m.i)] = m.motivo; });
  const resultados = cmp.linhas.filter(function (l) { return l.st === 'ok' || l.st === 'fora'; }).map(function (l) {
    if (l.st === 'ok') return { i: l.i, resultado: 'ganho' };
    return mot[l.i] ? { i: l.i, resultado: 'perdido', motivo: mot[l.i] } : { i: l.i, resultado: 'perdido' };
  });
  return { cmp: cmp, resultados: resultados };
}
// a leitura do PDF do pedido como o caso guarda (pedido.previa)
function previaDe(p, eu) {
  p = p || {};
  return {
    cnpj: cnpjDe(p.cnpj), cliente: txt(p.cliente, 160), oc: txt(p.oc, 60), itens: Math.max(0, Math.round(Number(p.itens) || 0)),
    total: num(p.total), condicao: txt(p.condicao, 80), email: emailOk(p.email) ? txt(p.email, 200).toLowerCase() : '',
    produtos: (Array.isArray(p.produtos) ? p.produtos : []).slice(0, 120).map(function (x) {
      x = x || {};
      return { codigo: txt(x.codigo, 40), descricao: txt(x.descricao, 200), quantidade: num(x.quantidade), valorUnitario: num(x.valorUnitario) };
    }),
    lidoEm: agora(), lidoPor: eu
  };
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
  if (!store.configurado()) throw erro(409, 'Armazenamento não configurado (COT_MSB_BLOB_URL).');
  const cfg = quem.cfg;
  b = b || {};
  // CNPJ, CEP, UF, telefone e e-mail como a tela confere (nada inválido entra calado)
  const inval = invalidosDe(b.dados && b.dados.cliente, b.dados && b.dados.contato);
  if (inval.length) throw erro(400, 'Corrija antes de criar: ' + inval.join(', ') + (inval.length > 1 ? ' inválidos.' : ' inválido.'));
  const d = dadosDe(b.dados, cfg);
  if (!d.cliente.nome && !d.cotacaoId && !d.itens.length) throw erro(400, 'Informe ao menos o cliente, o número da cotação ou um item.');
  // a unidade de negócio de quem registra (RLS do Power BI): sem ela, não registra
  d.unidade = unidadeParaRegistrar(quem, d.unidade);
  // a área é a da equipe de segurança de quem registra (a tela só manda a
  // área quando o Entra não devolveu equipe nenhuma)
  const perfil = await perfilDe(quem);
  if (perfil.area) d.area = perfil.area;
  // o comprador no Dynamics, pelo CNPJ: código do cliente e o endereço que o
  // PDF não trouxe (o agente já consultou — aqui vem do cache)
  const erpV = await consultarErp(d.cliente.cnpj);
  if (erpV && erpV.achou) completarDoErp(d.cliente, erpV);
  // o fabricante e o RMS que ficaram vazios: os do cadastro do Salesforce
  await produtosSf.completarItens(d.itens);
  // sempre Cotada — mesmo com a data de vencimento já passada (20/10/26: a
  // data é só um aviso; quem decide se a cotação venceu é a pessoa)
  const jaPassou = venceu(d.datas.validade);
  const faseIni = 'cotada';
  const k = chaveDe(d.portal, d.cotacaoId);

  // antes de gastar o upload: a mesma cotação já existe?
  if (k && !b.forcar) {
    const ja = await duplicado(d.portal, d.cotacaoId, cfg, quem);
    if (ja && ja.outraUnidade) throw erro(409, 'Esta cotação já foi registrada por outra unidade de negócio.', { duplicado: '', outraUnidade: true });
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
    criadoEm: criadoEm, criadoPor: eu, atualizadoEm: criadoEm, fechadoEm: null,
    leitura: anexo || l.modelo ? {
      ia: !!l.ia, em: criadoEm, arquivo: anexo ? anexo.nome : '', modelo: txt(l.modelo, 60),
      avisos: (Array.isArray(l.avisos) ? l.avisos : []).slice(0, 30).map(function (a) { return { tipo: txt(a && a.tipo, 30), texto: txt(a && a.texto, 300) }; }),
      erro: txt(l.erro, 300)
    } : null,
    anexos: anexo ? [anexo] : [],
    pedido: null, pi: null, descartado: null, proposta: null, propostas: [],
    perda: null,
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
    numero = NUM_PREFIXO + anoBrasilia(criadoEm) + '-' + String(ix.seq).padStart(6, '0');
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
    ' · fase ' + nomeFase(faseIni) + ' · unidade ' + c.unidade + (c.total ? ' · ' + brl(c.total) : '') + (b.forcar && k ? ' · registrada de novo de propósito (a mesma cotação já tinha caso)' : '') +
    (jaPassou ? ' · a data de vencimento já tinha passado (' + rotuloData(c.datas.validade) + ') — registrada como Cotada mesmo assim' : '') });
  if (erpV && erpV.achou) c.historico.push({ em: criadoEm, por: eu, tipo: 'erp', texto: textoErp(erpV) });
  if (nota) c.historico.push({ em: criadoEm, por: eu, tipo: 'nota', texto: nota.length > 140 ? nota.slice(0, 140) + '…' : nota });
  if (!(await store.gravar(store.arquivoDoCaso(numero), c, null))) {
    // não deveria acontecer (o número saiu do índice sob ETag): não sobrescreve
    throw erro(409, 'O número ' + numero + ' já estava em uso — tente de novo.');
  }
  return casoPublico(c);
}

// ── a cotação da LOJA BIOMEDICAL (E-commerce, /loja) ──────────────
// 01/11/2026, pedido do dono: o pedido de cotação feito na loja abre DIRETO
// na Gestão de Cotações (antes virava e-mail na caixa do atendimento).
// Quem registra é o PORTAL, sem pessoa logada: não passa por exigirEquipe
// nem pela unidade do Power BI. A cotação entra:
//   . no portal 'E-commerce', com o protocolo da loja como nº da cotação;
//   . SEM UNIDADE DE NEGÓCIO e sem responsável — pela regra de veCaso, só o
//     dono vê (e quem ele atribuir); a filial que a loja sugeriu pela UF fica
//     na nota de abertura, para ele distribuir;
//   . com o comprador no Dynamics pelo CNPJ (código, endereço), como o Agente.
// `cot` é a cotação JÁ validada por shared/loja-motor.validar (CNPJ e e-mail
// obrigatórios). opts.previa = e-mail do dono que testou pela prévia do
// portal (a loja ainda fechada ao público) — fica no histórico.
const LOJA = { email: '', nome: 'Loja Biomedical (E-commerce)', sistema: true };
const PORTAL_LOJA = 'E-commerce';
function dataBRDe(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
function notaDaLoja(cot) {
  const inst = cot.instituicao || {}, ct = cot.contato || {}, cp = cot.compra || {}, fi = cot.filial || {};
  const cliente = { sim: 'sim', nao: 'não', naosei: 'não sabe' }[inst.jaECliente] || 'não informou';
  const l = ['Pedido de cotação da Loja Biomedical (E-commerce) · protocolo ' + cot.protocolo];
  if (fi.nome) l.push('Filial sugerida pela UF (' + (inst.uf || '?') + '): ' + fi.nome + (fi.email ? ' · ' + fi.email : '') + (fi.fone ? ' · ' + fi.fone : ''));
  l.push('Instituição: ' + (inst.tipo || '—') + ' · já é cliente: ' + cliente);
  if (ct.cargo) l.push('Contato: ' + ct.nome + ' · ' + ct.cargo);
  l.push('Modalidade: ' + (cp.modalidadeTexto || cp.modalidade || '—') + (cp.processo ? ' · processo ' + cp.processo : '') + (cp.dataSessao ? ' · sessão em ' + dataBRDe(cp.dataSessao) : ''));
  l.push('Previsão de compra: ' + (cp.previsao || '—') + (cp.recorrencia ? ' · recorrência: ' + cp.recorrencia : '') + (cp.pagamento ? ' · pagamento: ' + cp.pagamento : ''));
  const sob = (cot.itens || []).filter(function (it) { return !it.codigo; }).length;
  if (sob) l.push(sob + (sob === 1 ? ' item sem código (medida sob consulta)' : ' itens sem código (medida sob consulta)') + ': confira a medida na descrição');
  (cot.pedidos || []).forEach(function (p) { l.push('Também pediu, de ' + p.produto + ': ' + (p.itens || []).join(', ')); });
  if (cp.observacoes) l.push('Observações do comprador: ' + cp.observacoes);
  const utm = cot.utm || {};
  const campanha = Object.keys(utm).map(function (k) { return k + '=' + utm[k]; }).join(' · ');
  if (campanha) l.push('Campanha: ' + campanha);
  if (cot.consentimentos && cot.consentimentos.novidades) l.push('Aceitou receber novidades.');
  return l.join('\n');
}
async function novoDaLoja(cot, opts) {
  if (!store.configurado()) throw erro(503, 'Armazenamento das cotações não configurado (COT_MSB_BLOB_URL).');
  cot = cot || {}; opts = opts || {};
  const cfg = await lerConfig();
  const inst = cot.instituicao || {}, ct = cot.contato || {}, cp = cot.compra || {};
  const d = dadosDe({
    portal: PORTAL_LOJA, cotacaoId: cot.protocolo,
    cliente: { nome: inst.razaoSocial, cnpj: inst.cnpj, cidade: inst.cidade, uf: inst.uf, endereco: inst.endereco, cep: inst.cep },
    contato: { nome: ct.nome, email: ct.email, telefone: ct.telefone },
    datas: { cotacao: hojeBR() },
    condicoes: { pagamento: cp.pagamento, observacao: cp.observacoes },
    // a medida (e a observação do comprador) vão na descrição; o fabricante
    // e o registro ANVISA, nos campos da proposta. Sem código = sob consulta.
    itens: (cot.itens || []).map(function (it) {
      return {
        codigo: it.codigo, unidade: 'UN', quantidade: it.quantidade, marca: it.fabricante, registro: it.anvisa,
        descricao: [it.produto, it.medida].filter(Boolean).join(' — ') + (!it.codigo ? ' (medida sob consulta)' : '') + (it.observacao ? ' · obs.: ' + it.observacao : '')
      };
    })
  }, cfg);
  // CNPJ (14 dígitos, com o dígito verificador) e e-mail são obrigatórios na loja
  if (digitos(d.cliente.cnpj).length !== 14 || !documentoValido(d.cliente.cnpj)) throw erro(400, 'CNPJ inválido.');
  if (!d.contato.email) throw erro(400, 'E-mail inválido.');
  d.unidade = '';          // só o dono vê (veCaso) até atribuir
  const erpV = await consultarErp(d.cliente.cnpj);
  if (erpV && erpV.achou) completarDoErp(d.cliente, erpV);
  const k = chaveDe(d.portal, d.cotacaoId);
  const criadoEm = agora();
  const faseIni = 'cotada';
  const c = Object.assign({ versao: 1, numero: '' }, d, {
    equipe: '', erp: erpV,
    fase: faseIni, faseEm: criadoEm,
    fases: [{ fase: faseIni, em: criadoEm, por: pessoa(LOJA) }],
    dono: null,
    criadoEm: criadoEm, criadoPor: pessoa(LOJA), atualizadoEm: criadoEm, fechadoEm: null,
    leitura: null, anexos: [],
    pedido: null, pi: null, descartado: null, proposta: null, propostas: [],
    perda: null, notas: [], historico: [],
    // de onde veio (o protocolo que o comprador recebeu, a filial sugerida)
    origem: { tipo: 'loja', protocolo: txt(cot.protocolo, 40), filial: txt(cot.filial && cot.filial.nome, 60), previa: txt(opts.previa, 200) }
  });
  const nota = texto(notaDaLoja(cot), 4000);
  c.notas.push({ em: criadoEm, por: pessoa(LOJA), texto: nota });

  let numero = '';
  await store.atualizar(store.INDICE, INDICE_VAZIO, function (ix) {
    ix.casos = ix.casos || []; ix.chaves = ix.chaves || {};
    ix.seq = (ix.seq || 0) + 1;
    numero = NUM_PREFIXO + anoBrasilia(criadoEm) + '-' + String(ix.seq).padStart(6, '0');
    c.numero = numero;
    if (k) ix.chaves[k] = numero;
    ix.casos.unshift(resumoDe(c));
    ix.rev = (ix.rev || 0) + 1;
    ix.atualizadoEm = agora();
  });
  c.historico.push({ em: criadoEm, por: pessoa(LOJA), tipo: 'criado', texto:
    'Cotação recebida da Loja Biomedical (E-commerce) · protocolo ' + d.cotacaoId + ' · ' + d.itens.length + (d.itens.length === 1 ? ' item' : ' itens') +
    ' · sem unidade de negócio (só o dono vê até atribuir)' + (c.origem.filial ? ' · filial sugerida: ' + c.origem.filial : '') +
    (c.origem.previa ? ' · enviada pela prévia do portal (' + c.origem.previa + ')' : '') });
  if (erpV && erpV.achou) c.historico.push({ em: criadoEm, por: pessoa(LOJA), tipo: 'erp', texto: textoErp(erpV) });
  if (!(await store.gravar(store.arquivoDoCaso(numero), c, null))) {
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
  c.fase = faseDoCaso(c);   // a gravada pode ser uma das antigas ('vencida', a amostra Cotada…)
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
      // 26/10/26: a amostra tem as fases dela (Envio de amostra, Ganha, Perdida)
      const f = (c.amostra ? FASES_AMOSTRA : FASES).filter(function (x) { return x.id === nova; })[0];
      if (!f) throw erro(400, c.amostra ? 'Fase inválida — na amostra, as fases são Envio de amostra, Ganha e Perdida.' : 'Fase inválida — as fases são Cotada, Perdida e Ganha (virou pedido).');
      // a fase aberta de agora (Cotada / A faturar) COM o pedido registrado =
      // desfazer o pedido (22/10/26)
      const desfazer = !c.amostra && nova === c.fase && f.aberta && !!c.pedido;
      if (nova === c.fase && !desfazer) return false;
      if (c.descartado) throw erro(409, 'Esta cotação foi descartada — restaure antes de mudar a fase.');
      if (c.amostra) {
        // sem pedido nem OV: ganha ou perdida, a amostra segue fora das contas.
        // O motivo da perdida é opcional
        let extra = '';
        if (f.perdida) {
          const motivo = daLista(b.motivo, motivosDaPerda(cfg)) || txt(b.motivo, 80);
          c.perda = { motivo: motivo, obs: texto(b.obs, 1000), concorrente: '', valorConcorrente: 0, em: agora(), por: eu };
          extra = [motivo && 'Motivo: ' + motivo, c.perda.obs].filter(Boolean).join(' · ');
        }
        mudarFase(nova, [extra, f.aberta ? '' : 'a amostra fica fora das ' + (f.ganha ? 'Ganhas' : 'Perdidas')].filter(Boolean).join(' · '));
        break;
      }
      // 26/10/26 (pedido do usuário): A faturar é à mão — "ainda nada aconteceu".
      // Entre as abertas (Cotada <-> A faturar) só a fase muda: o pedido
      // registrado, as marcas dos itens e o resto ficam. Da Ganha com a OV, é
      // tirar a OV (o cartão Pedido)
      if (nova === 'faturar' && c.ovs && c.ovs.length) throw erro(409, 'Esta cotação já fechou com a Ordem de Venda ' + c.ovs.map(function (o) { return o.numero; }).join(', ') + ' — para voltar a A faturar, tire a OV no cartão Pedido.');
      if (!desfazer && f.aberta && aberta(c.fase)) {
        // a A faturar pede os dados do paciente e o lote (26/10/26)
        if (nova === 'faturar') { aplicarFaturamento(c, b, eu, ctx); const falta = faltaFaturamento(c); if (falta) throw erro(400, falta); }
        mudarFase(nova, '');
        break;
      }
      // 22/10/26 (pedido do usuário): Ganha só com a Ordem de Venda
      if (nova === 'pedido' && !(c.ovs && c.ovs.length)) throw erro(400, 'A cotação fecha como Ganha com a Ordem de Venda — registre o pedido (PDF ou à mão) e informe a OV, ou use "Já tenho a Ordem de Venda".');
      if (nova === 'pedido') { const falta = faltaResultado(c); if (falta) throw erro(400, falta); }
      // a que já fechou (OV registrada ou pedido lançado pelo PI) pode passar para
      // Perdida (21/10/26) ou voltar para Cotada (22/10/26), com a confirmação
      // (forcar): a OV e o pedido saem do caso e ficam no histórico
      const fechou = travada(c);
      if (fechou && !b.forcar) throw erro(409, fechou + ' — confirme para ' + (f.perdida ? 'marcar como perdida' : 'voltar para Cotada') + ' (a OV e o pedido saem do caso).', { confirmar: true });
      let extra = '';
      if (f.perdida) {
        const motivo = daLista(b.motivo, motivosDaPerda(cfg)) || txt(b.motivo, 80);
        if (!motivo) throw erro(400, 'Informe o motivo da perda.');
        c.perda = { motivo: motivo, obs: texto(b.obs, 1000), concorrente: txt(b.concorrente, 120), valorConcorrente: num(b.valorConcorrente), em: agora(), por: eu };
        extra = [motivo && 'Motivo: ' + motivo, c.perda.concorrente && 'Concorrente: ' + c.perda.concorrente,
          c.perda.valorConcorrente && 'Preço do concorrente: ' + brl(c.perda.valorConcorrente), c.perda.obs].filter(Boolean).join(' · ');
      }
      if (c.pedido && nova !== 'pedido') {
        // a cotação voltou atrás (ou perdeu): o pedido sai do caso (o PDF fica nos
        // anexos); a que tinha fechado também solta a(s) OV(s) e o "lançado no
        // Dynamics" — e o resultado dos itens, que era o do pedido, zera
        const ovs = (c.ovs || []).map(function (o) { return o.numero; });
        const lancado = !!(c.pi && c.pi.estado === 'enviado');
        c.pedido = null; c.pi = null;
        if (ovs.length) c.ovs = [];
        const zerou = zerarResultados(c);
        extra = ['Pedido desvinculado — o PDF continua nos anexos', ovs.length ? 'Ordem(ns) de Venda desvinculada(s): ' + ovs.join(', ') : '',
          lancado ? 'o pedido tinha sido lançado no Dynamics pelo PI' : '', zerou ? 'resultado dos itens zerado' : '', extra].filter(Boolean).join(' · ');
      }
      // 22/10/26 (pedido do usuário): voltar para Cotada (de Perdida ou Ganha) volta
      // a cotação a como estava cadastrada — o resultado de cada item sai (26/10/26:
      // reabrir em A faturar também)
      if (f.aberta) { const z = zerarResultados(c); if (z && extra.indexOf('resultado dos itens zerado') < 0) extra = [extra, 'resultado dos itens zerado'].filter(Boolean).join(' · '); }
      if (desfazer) { hist(c, { por: eu, tipo: 'pedido', texto: 'Pedido desfeito — ' + (extra || 'a cotação segue ' + nomeFase(c.fase)) }); assumeSeSemDono(); break; }
      // (reabrir em A faturar também pede os dados do paciente e o lote)
      if (nova === 'faturar') { aplicarFaturamento(c, b, eu, ctx); const falta = faltaFaturamento(c); if (falta) throw erro(400, falta); }
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
      if (f.unidade != null) {
        // só para uma das unidades de quem edita (o caso sai da vista de quem não é dela)
        const u = pbiU.unidadeDoEscopo(f.unidade, quem.escopo);
        if (!u) throw erro(400, 'Escolha uma das suas unidades de negócio no Power BI.');
        setar('Unidade de negócio', c.unidade, u, function (v) { c.unidade = v; });
      }
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
      // o lote que já estava conferido no Dynamics segue conferido (mesmo produto e lote)
      itens.forEach(function (it) {
        if (!it.lote) return;
        const o = (c.itens || []).filter(function (x) { return x.lote === it.lote && (x.codigo || '') === (it.codigo || '') && x.loteConf; })[0];
        if (o) it.loteConf = o.loteConf;
      });
      const antes = JSON.stringify(c.itens || []);
      if (antes === JSON.stringify(itens)) return false;
      const deTxt = textoItens(c.itens, c.total || 0);
      c.itens = itens;
      const soma = somaItens(itens);
      c.total = soma > 0 ? soma : (b.total != null ? num(b.total) : (c.totalPdf || 0));
      hist(c, { por: eu, tipo: 'campo', campo: 'Itens', de: deTxt, para: textoItens(itens, c.total) });
      break;
    }

    // o RESULTADO DO ITEM: ganho, perdido ou '' (tira a marca) — um ou vários
    // de uma vez: { itens: [{ i, codigo, descricao, resultado, motivo? }] }. O
    // item vai pela posição E pelo código + descrição: se a lista mudou (outra
    // pessoa editou os itens), recusa em vez de marcar o item errado. O
    // perdido pode dizer o MOTIVO (a lista de motivos de perda, ou o escrito):
    // sem `motivo` no pedido fica o que já estava; '' tira.
    case 'resultado': {
      if (c.descartado) throw erro(409, 'Esta cotação foi descartada — restaure antes de marcar o resultado dos itens.');
      if (!aplicarResultados(c, b.itens, cfg, eu)) return false;
      // a cotação que virou pedido (ou tem o pedido registrado) não fica sem nenhum item ganho
      if ((faseAtual(c.fase) === 'pedido' || c.pedido) && (c.itens || []).length && (c.itens || []).every(function (it) { return it.resultado === 'perdido'; })) {
        throw erro(400, 'Com todos os itens perdidos a cotação não virou pedido — deixe ao menos um Ganho, ou volte a fase (Perdida).');
      }
      break;
    }

    // os dados da A faturar (26/10/26): o paciente, a cirurgia, o convênio, o
    // médico e o lote de cada item — só na A faturar, e completos
    case 'faturamento': {
      if (c.descartado) throw erro(409, 'Esta cotação foi descartada — restaure antes de mexer nos dados do faturamento.');
      if (c.amostra || c.fase !== 'faturar') throw erro(409, 'Os dados do paciente e o lote são da fase A faturar — passe a cotação para A faturar.');
      const n = aplicarFaturamento(c, b, eu, ctx);
      const falta = faltaFaturamento(c); if (falta) throw erro(400, falta.replace('Para passar para A faturar, preencha', 'Preencha'));
      if (!n) return false;
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
      // o portal gerou o pedido: o PDF dele entra no caso e a cotação vira
      // pedido. 21/10/26: ou o pedido À MÃO (b.manual — sem o PDF, como o
      // manual do PI): os itens ganhos da cotação são o pedido. Virar pedido
      // exige cada item marcado Ganho ou Perdido (b.resultados marca junto)
      if (c.descartado) throw erro(409, 'Esta cotação foi descartada — restaure antes de registrar o pedido.');
      if (c.amostra) throw erro(409, AMOSTRA_SEM_PEDIDO);
      if (travada(c)) throw erro(409, travada(c) + '.');
      const manual = !!b.manual, jaTinha = !!c.pedido;
      // 22/10/26: registrar o pedido pelo PDF exige a LEITURA dele (b.previa, os
      // itens do pedido) e o match com a cotação: divergência barra; o
      // resultado de cada item sai do confronto (só o motivo do perdido vem
      // da tela). Trocar o PDF do pedido já registrado não confronta.
      let res = Array.isArray(b.resultados) ? b.resultados : [], conferido = '';
      if (!manual && !jaTinha) {
        const k = conferirPedidoPdf(c, b.previa, res);
        res = k.resultados;
        conferido = ' · conferido com a cotação: ' + k.cmp.ok + ' item(ns) igual(is), ganho(s)' + (k.cmp.fora ? ' · ' + k.cmp.fora + ' não veio(vieram) no pedido, perdido(s)' : '');
      }
      if (res.length) aplicarResultados(c, res, cfg, eu);
      let a = manual ? null : ctx.arquivo;
      if (!manual && !a && b.anexoId) {
        a = c.anexos.filter(function (x) { return x.id === String(b.anexoId) && !x.removido; })[0];
        if (!a) throw erro(404, 'Anexo não encontrado nesta cotação.');
        if (extDe(a.nome) !== 'pdf') throw erro(400, 'O pedido precisa ser o PDF que o portal gerou.');
        a.tipo = 'pedido';
      }
      if (!manual && !a) throw erro(400, 'Anexe o PDF do pedido — ou registre o pedido à mão.');
      if (!jaTinha && c.fase !== 'pedido') { const falta = faltaResultado(c); if (falta) throw erro(400, falta); }
      if (a && ctx.arquivo) c.anexos.push(a);
      const trocou = jaTinha;
      c.pedido = manual
        ? { manual: true, anexoId: '', nome: '', oc: txt(b.oc, 60), data: dataDe(b.data), total: num(b.total) || somaGanhos(c), obs: texto(b.obs, 1000), em: agora(), por: eu, previa: null }
        : { anexoId: a.id, nome: a.nome, oc: txt(b.oc, 60), data: dataDe(b.data), total: num(b.total), obs: texto(b.obs, 1000), em: agora(), por: eu, previa: null };
      c.pi = { estado: 'disponivel' };
      // a leitura que já veio junto (o confronto): o PI recebe o pedido lido
      if (!manual && b.previa && Array.isArray(b.previa.produtos) && b.previa.produtos.length) {
        c.pedido.previa = previaDe(b.previa, eu);
        if (!c.pedido.oc && c.pedido.previa.oc) c.pedido.oc = c.pedido.previa.oc;
        c.pi.estado = 'lido';
      }
      hist(c, { por: eu, tipo: 'pedido', texto: (manual
        ? 'Pedido registrado à mão (sem o PDF)' + (c.pedido.oc ? ' · OC ' + c.pedido.oc : '') + (c.pedido.total ? ' · ' + brl(c.pedido.total) : '')
        : (trocou ? 'Trocou o PDF do pedido: ' : 'Pedido anexado: ') + a.nome + (c.pedido.oc ? ' · OC ' + c.pedido.oc : '') + conferido) +
        (!jaTinha && c.fase !== 'pedido' ? ' · a cotação fecha como Ganha com a Ordem de Venda' : '') });
      // 22/10/26 (pedido do usuário): registrar o pedido não fecha como Ganha —
      // a cotação fica aberta aguardando a OV (na Cotada ou na A faturar, 26/10/26);
      // a Perdida reabre
      if (faseAtual(c.fase) === 'perdida') mudarFase('cotada', 'Pedido registrado — a cotação reabre, aguardando a Ordem de Venda');
      break;
    }

    case 'pi': {
      const est = String(b.estado || '');
      if (['lido', 'em_andamento', 'enviado', 'erro', 'disponivel'].indexOf(est) < 0) throw erro(400, 'Estado do PI inválido.');
      if (!c.pedido) throw erro(409, 'Esta cotação ainda não tem o PDF do pedido.');
      c.pi = c.pi || { estado: 'disponivel' };
      const antes = c.pi.estado;
      if (est === 'lido') {
        c.pedido.previa = previaDe(b.previa, eu);
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
      if (c.amostra) throw erro(409, AMOSTRA_SEM_PEDIDO);
      // 21/10/26 (pedido do usuário): o pedido já foi feito antes, direto no
      // Dynamics — a OV entra aqui mesmo (b.virarPedido): a cotação vira
      // pedido (à mão, sem PDF) e fecha com ela de uma vez
      // 22/10/26: a cotação com o pedido registrado (aberta) fecha como Ganha aqui
      const virar = !c.pedido;
      if (virar && !b.virarPedido) throw erro(409, OV_SEM_PEDIDO);
      if (!virar && faseAtual(c.fase) !== 'pedido' && !(b.doFlow && quem.flow)) { const falta = faltaResultado(c); if (falta) throw erro(400, falta); }
      if (virar) {
        if (travada(c)) throw erro(409, travada(c) + '.');
        if (Array.isArray(b.resultados) && b.resultados.length) aplicarResultados(c, b.resultados, cfg, eu);
        const falta = faltaResultado(c); if (falta) throw erro(400, falta);
      }
      const n = ctx.ovNumero;
      c.ovs = c.ovs || [];
      if (c.ovs.some(function (o) { return o.numero === n; })) return false;
      if (c.ovs.length >= 20) throw erro(400, 'Esta cotação já tem 20 Ordens de Venda — o limite do caso.');
      const v = ctx.ov || null;
      // o código ERP do cliente da cotação: o do caso, o que o PI mandou ou o do
      // CNPJ no Dynamics (consultado antes do laço, quando o caso não tinha)
      const meuCliente = (c.cliente && c.cliente.codigo) || (c.pi && c.pi.enviado && c.pi.enviado.codigoCliente) || ctx.ovCodigoCnpj || '';
      let clienteBateu = true;
      // a OV que o próprio flow do PI criou (só a porta com a chave marca quem.flow)
      const doFlow = !!(b.doFlow && quem.flow);
      let avisos = [];
      if (!b.forcar) {
        // o que pede um "confere?" antes de fechar (a tela pergunta e reenvia com forcar)
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
        if (avisos.length && !doFlow) throw erro(409, 'Confira antes de fechar: ' + avisos.join('; ') + '.', { confirmar: true, avisos: avisos });
      }
      const o = {
        numero: n, em: agora(), por: eu,
        origem: doFlow ? 'flow' : c.pi && c.pi.estado === 'enviado' ? 'pi' : 'manual',
        obs: txt(b.obs, 200), confirmada: !!b.forcar, avisos: doFlow ? avisos : [],
        dynamics: v ? {
          achou: !!v.achou, erro: txt(v.erro, 200), empresa: txt(v.empresa, 10), cliente: txt(v.cliente, 30), nome: txt(v.nome, 160),
          oc: txt(v.oc, 60), situacao: txt(v.situacao, 30), criadaEm: txt(v.criadaEm, 30),
          itens: v.itens == null ? null : v.itens, total: v.total == null ? null : r2(v.total), fonte: txt(v.fonte, 60), em: v.em || agora()
        } : null
      };
      if (virar) {
        c.pedido = { manual: true, viaOv: true, anexoId: '', nome: '', oc: txt(b.oc, 60), data: null, total: somaGanhos(c), obs: '', em: agora(), por: eu, previa: null };
        c.pi = { estado: 'disponivel' };
        hist(c, { por: eu, tipo: 'pedido', texto: 'Pedido já lançado no Dynamics — registrado pela Ordem de Venda ' + n + (c.pedido.total ? ' · ' + brl(c.pedido.total) + ' ganhos' : '') });
      }
      if (faseAtual(c.fase) !== 'pedido') mudarFase('pedido', virar ? 'Pedido já lançado no Dynamics (' + n + ')' : 'Fechou com a Ordem de Venda ' + n + (doFlow ? ' (devolvida pelo fluxo do PI)' : ''));
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
      // 26/10/26: sem nenhuma OV, a Ganha volta para a fase aberta de antes
      // (Cotada ou A faturar) — o pedido fica, aguardando a OV
      if (!c.ovs.length && c.fase === 'pedido' && c.pedido) {
        const antes = (c.fases || []).slice(0, -1).reverse().map(function (x) { return faseAtual(x && x.fase); }).filter(function (x) { return x === 'cotada' || x === 'faturar'; })[0] || 'cotada';
        mudarFase(antes, 'Sem Ordem de Venda — a cotação volta para ' + nomeFase(antes));
      }
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

    case 'proposta': {
      // a proposta (o PDF no modelo da Biomedical) foi enviada ao comprador:
      // o PDF fica no caso e o envio entra no histórico
      if (c.amostra) throw erro(409, AMOSTRA_SEM_PROPOSTA);
      const a = ctx.arquivo;
      if (!a) throw erro(400, 'Anexe o PDF da proposta.');
      const emails = function (v) {
        return (Array.isArray(v) ? v : String(v || '').split(/[;,\s]+/)).map(function (e) { return txt(e, 200).toLowerCase(); })
          .filter(function (e, i, l) { return emailOk(e) && l.indexOf(e) === i; }).slice(0, 10);
      };
      const para = emails(b.para), copia = emails(b.copia);
      if (!para.length) throw erro(400, 'Informe o e-mail do comprador.');
      c.anexos.push(a);
      // 22/10/26: a caixa do setor por onde saiu (ou para onde vão as respostas) e
      // os outros arquivos que foram junto (só os nomes)
      const de = emailOk(b.de) ? txt(b.de, 200).toLowerCase() : '', respostas = emailOk(b.respostas) ? txt(b.respostas, 200).toLowerCase() : '';
      const extras = (Array.isArray(b.extras) ? b.extras : []).map(function (n) { return txt(n, 160); }).filter(Boolean).slice(0, 20);
      const reg = { em: agora(), por: eu, para: para, copia: copia, assunto: txt(b.assunto, 250), anexoId: a.id, nome: a.nome, canal: txt(b.canal, 20) || 'outlook', de: de, respostas: respostas, extras: extras };
      c.propostas = (c.propostas || []).concat([reg]).slice(-30);
      c.proposta = reg;
      hist(c, { por: eu, tipo: 'proposta', texto: (c.propostas.length > 1 ? 'Proposta reenviada para ' : 'Proposta enviada para ') + para.join(', ') + (copia.length ? ' (cópia: ' + copia.join(', ') + ')' : '') + ' · ' + a.nome +
        (extras.length ? ' + ' + extras.join(', ') : '') + (de ? ' · saiu pela caixa ' + de : respostas ? ' · respostas para ' + respostas : '') });
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

    // a cotação aberta com o prazo vencido vira Perdida (perderVencidas,
    // 22/10/26): o comprador não deu o resultado. Uma vez só por caso
    // (perdaAuto) — a reaberta à mão fica aberta. Só o portal chama — para
    // quem está na tela, a ação não existe.
    case 'perderVencida': {
      if (!quem.sistema) throw erro(400, 'Ação desconhecida.');
      const v = c.datas && c.datas.validade;
      if (c.descartado || c.amostra || c.perdaAuto || c.pedido || !aberta(c.fase) || c.fase === 'faturar' || !venceu(v)) return false;
      c.perda = { motivo: MOTIVO_SEM_RESPOSTA, obs: 'Prazo vencido em ' + rotuloData(v) + ' sem resposta do comprador', concorrente: '', valorConcorrente: 0, automatica: true, em: agora(), por: eu };
      c.perdaAuto = { em: c.perda.em, validade: v };
      mudarFase('perdida', 'Prazo vencido em ' + rotuloData(v) + ' — o portal marcou como Perdida · Motivo: ' + MOTIVO_SEM_RESPOSTA);
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
  if (!store.configurado()) throw erro(409, 'Armazenamento não configurado (COT_MSB_BLOB_URL).');
  b = b || {};
  const tipo = String(b.acao || '');
  if (!numeroOk(numero)) throw erro(400, 'Número de cotação inválido.');
  const cfg = quem.cfg || await lerConfig();
  const ctx = {};
  // o arquivo sobe ANTES (fora do laço do ETag): o caso só guarda a referência
  if (tipo === 'erp') {
    const existe = await obterVisivel(numero, quem);
    ctx.erp = (existe.cliente && existe.cliente.cnpj) ? await consultarErp(existe.cliente.cnpj, true) : null;
  }
  // os lotes da A faturar (29/10/26): conferidos no Dynamics ANTES do laço do
  // ETag — só os que mudaram; o resultado vai por produto|lote
  if (((tipo === 'fase' && b.fase === 'faturar') || tipo === 'faturamento') && Array.isArray(b.lotes) && b.lotes.length) {
    const existe = await obterVisivel(numero, quem);
    const pares = [];
    b.lotes.slice(0, 400).forEach(function (p) {
      const it = (existe.itens || [])[Number(p && p.i)];
      if (!it || !it.codigo) return;
      const novo = lotesD365.separar(p.lote);
      if (novo.join(', ') === (it.lote || '') && it.loteConf && it.loteConf.ok) return;
      novo.forEach(function (l) { pares.push({ codigo: it.codigo, lote: l }); });
    });
    ctx.lotes = {}; ctx.lotesConfigurado = lotesD365.configurado();
    if (pares.length) ((await lotesD365.conferir(pares)).lotes || []).forEach(function (r) { ctx.lotes[r.codigo + '|' + r.lote] = r; });
  }
  if (tipo === 'ov') {
    // o número e a conferência no Dynamics saem ANTES do laço do ETag
    const n = ovD365.numeroOv(b.ov);
    if (!n) throw erro(400, 'Número da Ordem de Venda inválido — use ' + ovD365.PREFIXO + ' seguido dos números (ex.: ' + ovD365.PREFIXO + '144950).');
    ctx.ovNumero = n;
    const existe = await obterVisivel(numero, quem);
    if (existe.amostra) throw erro(409, AMOSTRA_SEM_PEDIDO);
    if (!existe.pedido) {
      if (!b.virarPedido) throw erro(409, OV_SEM_PEDIDO);
      if (existe.descartado) throw erro(409, 'Esta cotação foi descartada — restaure antes de registrar a Ordem de Venda.');
      const falta = faltaResultado(existe, b.resultados); if (falta) throw erro(400, falta);
    }
    if (!(existe.ovs || []).some(function (o) { return o.numero === n; })) {
      ctx.ov = await conferirOv(n);
      // o caso sem código ERP: o do CNPJ no Dynamics, para conferir o cliente da OV
      const cli = existe.cliente || {};
      if (ctx.ov && ctx.ov.achou && !cli.codigo && !(existe.pi && existe.pi.enviado && existe.pi.enviado.codigoCliente) && cli.cnpj) {
        const e = await consultarErp(cli.cnpj);
        ctx.ovCodigoCnpj = e && e.achou ? e.codigo : '';
      }
      const outra = ((await listar()).casos || []).filter(function (r) { return r.numero !== numero && !r.descartado && (r.ovs || []).indexOf(n) >= 0; })[0];
      ctx.ovOutra = !outra ? '' : veCaso(quem, outra) ? outra.numero : 'de outra unidade';
    }
  }
  if ((tipo === 'anexo' || tipo === 'pedido' || tipo === 'proposta') && b.anexo && b.anexo.base64) {
    const existe = await obterVisivel(numero, quem);
    if (tipo === 'pedido' && existe.amostra) throw erro(409, AMOSTRA_SEM_PEDIDO);
    if (tipo === 'proposta' && existe.amostra) throw erro(409, AMOSTRA_SEM_PROPOSTA);
    if (tipo === 'pedido' && travada(existe)) throw erro(409, travada(existe) + '.');
    // o PDF que não bate com a cotação não vira pedido: confere ANTES de guardar o PDF
    if (tipo === 'pedido' && !existe.pedido) conferirPedidoPdf(existe, b.previa, b.resultados);
    const qual = tipo === 'pedido' ? 'pedido' : tipo === 'proposta' ? 'proposta' : (b.tipo === 'cotacao' ? 'cotacao' : 'outro');
    ctx.arquivo = await guardarArquivo(b.anexo, qual, quem);
  }
  let chaveAntes = '';
  const r = await store.atualizar(store.arquivoDoCaso(numero), null, function (c) {
    if (!c || !veCaso(quem, c)) throw erro(404, 'Cotação não encontrada.');
    chaveAntes = c.descartado || c.amostra ? '' : chaveDe(c.portal, c.cotacaoId);
    return aplicar(c, tipo, b, quem, cfg, ctx);
  });
  if (r.gravou) await sincronizar(r.dados, chaveAntes);
  return casoPublico(r.dados);
}

// ── a AMOSTRA (23/10/26) ──────────────────────────────────────────
// Pedido do usuário: toda cotação PERDIDA pode virar uma cotação de AMOSTRA —
// uma CÓPIA, com número próprio, para a gestão. A original continua Perdida,
// como estava (ganha só a referência e a linha no histórico); a cópia nasce
// em Envio de amostra (26/10/26; era Cotada), sem data de vencimento (não perde pelo prazo), sem pedido, OV,
// proposta, perda nem o resultado dos itens, com os mesmos anexos, e não
// conta em nada: a tela a tira das cotadas, das filas, dos valores, do funil e
// do analítico (o `amostra` do resumo) e ela não ocupa a chave de duplicidade
// (portal + nº). Uma amostra por perdida: a segunda pede forcar.
async function criarAmostra(numero, b, quem) {
  if (!store.configurado()) throw erro(409, 'Armazenamento não configurado (COT_MSB_BLOB_URL).');
  b = b || {};
  const o = await obterVisivel(numero, quem);
  if (o.amostra) throw erro(409, 'Esta cotação já é uma amostra (de ' + (o.amostra.de || 'outra cotação') + ').');
  if (o.descartado) throw erro(409, 'Esta cotação foi descartada — restaure antes de criar a amostra.');
  if (faseAtual(o.fase) !== 'perdida') throw erro(400, 'Só a cotação Perdida vira amostra.');
  const ja = (o.amostras || []).map(function (a) { return a.numero; });
  if (ja.length && !b.forcar) throw erro(409, 'Esta cotação já tem a amostra ' + ja.join(', ') + '.', { amostra: ja[ja.length - 1], confirmar: true });
  const eu = pessoa(quem), em = agora();
  const obs = texto(b.obs, 1000);
  const copia = function (v) { return v == null ? v : JSON.parse(JSON.stringify(v)); };
  const c = {
    versao: 1, numero: '',
    portal: o.portal || '', cotacaoId: o.cotacaoId || '', empresa: o.empresa || EMPRESA_FIXA, area: o.area || '', unidade: o.unidade || '',
    cliente: copia(o.cliente) || {}, contato: copia(o.contato) || {},
    datas: Object.assign({}, o.datas || {}, { validade: '' }),
    condicoes: copia(o.condicoes) || {},
    itens: (o.itens || []).map(function (it) { const x = Object.assign({}, it); delete x.resultado; delete x.motivo; return x; }),
    total: o.total || 0, totalPdf: o.totalPdf || 0,
    equipe: o.equipe || '', erp: copia(o.erp) || null,
    amostra: { de: o.numero, em: em, por: eu, motivo: (o.perda && o.perda.motivo) || '', obs: obs },
    fase: 'amostra', faseEm: em, fases: [{ fase: 'amostra', em: em, por: eu }],
    dono: o.dono || eu,
    criadoEm: em, criadoPor: eu, atualizadoEm: em, fechadoEm: null,
    leitura: copia(o.leitura) || null,
    anexos: (o.anexos || []).filter(function (a) { return !a.removido; }).map(copia),
    pedido: null, pi: null, ovs: [], descartado: null, proposta: null, propostas: [],
    perda: null, perdaAuto: null,
    notas: obs ? [{ em: em, por: eu, texto: obs }] : [],
    historico: []
  };
  let novoNum = '';
  await store.atualizar(store.INDICE, INDICE_VAZIO, function (ix) {
    ix.casos = ix.casos || [];
    ix.seq = (ix.seq || 0) + 1;
    novoNum = NUM_PREFIXO + anoBrasilia(em) + '-' + String(ix.seq).padStart(6, '0');
    c.numero = novoNum;
    ix.casos.unshift(resumoDe(c));
    ix.rev = (ix.rev || 0) + 1;
    ix.atualizadoEm = agora();
  });
  c.historico.push({ em: em, por: eu, tipo: 'criado', texto: 'Amostra criada a partir da cotação Perdida ' + o.numero +
    (c.amostra.motivo ? ' (motivo: ' + c.amostra.motivo + ')' : '') + ' · não conta nas cotadas nem nos valores' + (c.total ? ' · ' + brl(c.total) : '') });
  if (obs) c.historico.push({ em: em, por: eu, tipo: 'nota', texto: obs.length > 140 ? obs.slice(0, 140) + '…' : obs });
  if (!(await store.gravar(store.arquivoDoCaso(novoNum), c, null))) throw erro(409, 'O número ' + novoNum + ' já estava em uso — tente de novo.');
  // a original: só a referência (a fase e o resto ficam como estavam)
  const r = await store.atualizar(store.arquivoDoCaso(o.numero), null, function (x) {
    if (!x) return false;
    x.amostras = (x.amostras || []).concat([{ numero: novoNum, em: em, por: eu }]);
    hist(x, { por: eu, tipo: 'amostra', texto: 'Virou amostra: ' + novoNum + ' — esta cotação continua Perdida' });
    x.atualizadoEm = agora();
  });
  if (r.gravou) await sincronizar(r.dados, '');
  return { caso: casoPublico(c), original: r.dados ? casoPublico(r.dados) : null };
}

// ── as OVs do cliente da cotação (21/10/26) ───────────────────────
// O "Já tenho a Ordem de Venda" mostra as OVs do cliente no Dynamics para a
// pessoa escolher (sem digitar o número). O cliente: o código do caso, o que
// o PI mandou ou o do CNPJ no Dynamics. A OV que já fechou outra cotação vem
// marcada (emOutra). Sem Dynamics ou sem cliente: lista vazia e o motivo — a
// pessoa digita.
// todas (21/10/26: "pode cotar para mim e faturar para outro"): as OVs mais
// novas da BIO de todos os clientes, com o cliente de cada uma
async function ovsDaCotacao(numero, quem, todas) {
  const c = await obterVisivel(numero, quem);
  let cod = (c.cliente && c.cliente.codigo) || (c.pi && c.pi.enviado && c.pi.enviado.codigoCliente) || '';
  if (!cod && !todas && c.cliente && c.cliente.cnpj) { const e = await consultarErp(c.cliente.cnpj); cod = e && e.achou ? e.codigo || '' : ''; }
  const base = { cliente: cod, todas: !!todas };
  if (!cod && !todas) return Object.assign(base, { ovs: [], motivo: 'A cotação não tem o código do cliente (nem um CNPJ que o Dynamics conheça) — veja todas as OVs ou digite o número.' });
  let r;
  try { r = await ovD365.ovsDoCliente(cod, { todas: !!todas }); } catch (e) { return Object.assign(base, { ovs: [], motivo: 'O Dynamics não respondeu agora (' + txt(e.message, 120) + ') — digite o número da OV.' }); }
  if (r.configurado === false) return Object.assign(base, { ovs: [], desligado: true, motivo: 'A consulta ao Dynamics não está ligada no portal — digite o número da OV.' });
  const usadas = {};
  ((await listar()).casos || []).forEach(function (x) {
    if (x.numero === c.numero || x.descartado) return;
    (x.ovs || []).forEach(function (n) { usadas[n] = veCaso(quem, x) ? x.numero : 'de outra unidade'; });
  });
  return Object.assign(base, { fonte: r.fonte, ovs: r.ovs.map(function (o) { return usadas[o.numero] ? Object.assign({}, o, { emOutra: usadas[o.numero] }) : o; }),
    motivo: r.ovs.length ? '' : todas ? 'Nenhuma Ordem de Venda da BIO no Dynamics — digite o número da OV.' : 'Nenhuma Ordem de Venda do cliente ' + cod + ' no Dynamics — veja todas as OVs ou digite o número.' });
}

// ── o prazo vencido vira Perdida (22/10/26) ───────────────────────
// A cotação aberta com a data de vencimento passada (o dia inteiro, em
// Brasília — venceu) passa para Perdida com o motivo "Comprador não informou
// o motivo", assinada "Portal (automático)". Roda na leitura da lista: só as
// que o ÍNDICE mostra abertas e vencidas, até 40 por vez, no máximo 1×/min
// por instância. A que já passou por isso (perdaAuto) e foi reaberta à mão
// não volta; a que o caso recusa é lida uma vez por instância
// (_vencidasVistas). Devolve quantas viraram Perdida.
let _perdeuEm = 0;
const _vencidasVistas = new Set();
async function perderVencidas(ix) {
  if (!store.configurado() || Date.now() - _perdeuEm < 60e3) return 0;
  const hoje = hojeBR();
  // (a cotação com o pedido registrado aguarda a OV, e a A faturar — 26/10/26 — já
  // passou da proposta: não perdem pelo prazo)
  const alvo = ((ix && ix.casos) || []).filter(function (r) { return !r.descartado && !r.amostra && !r.perdaAuto && !r.temPedido && aberta(r.fase) && r.fase !== 'faturar' && venceu(r.validade, hoje) && !_vencidasVistas.has(r.numero); }).slice(0, 40);
  if (!alvo.length) return 0;
  _perdeuEm = Date.now();
  const quem = Object.assign({ cfg: await lerConfig() }, SISTEMA);
  let n = 0;
  for (const r of alvo) {
    try {
      const c = await agir(r.numero, { acao: 'perderVencida' }, quem);
      if (c && faseAtual(c.fase) === 'perdida') n++;
      else _vencidasVistas.add(r.numero);
    } catch (e) { /* tenta de novo na próxima leitura */ }
  }
  return n;
}

// ── o resumo de uma versão mais velha (RESUMO_V) ──────────────────
// O Funil e o Analítico leem só o ÍNDICE; o resumo gravado antes de um campo
// novo (os itens com o resultado, o concorrente — 20/10/26) não o tem. A
// leitura da lista refaz aos poucos, relendo o caso: até 40 por vez, no
// máximo 1×/5 min por instância. Devolve quantos refez.
let _completouEm = 0;
function resumoVelho(r) { return (Number(r && r.rv) || 1) < RESUMO_V; }
async function completarResumos(ix) {
  if (!store.configurado() || Date.now() - _completouEm < 300e3) return 0;
  const falta = ((ix && ix.casos) || []).filter(resumoVelho).slice(0, 40);
  if (!falta.length) return 0;
  _completouEm = Date.now();
  const novos = {};
  for (const r of falta) {
    try { const c = await obterBruto(r.numero); if (c) novos[c.numero] = resumoDe(c); } catch (e) { /* fica para a próxima */ }
  }
  let n = 0;
  try {
    await store.atualizar(store.INDICE, INDICE_VAZIO, function (x) {
      n = 0;
      // o que já foi sincronizado nesse meio-tempo (resumo novo) fica como está
      (x.casos || []).forEach(function (r, i) { if (novos[r.numero] && resumoVelho(r)) { x.casos[i] = novos[r.numero]; n++; } });
      if (!n) return false;
      x.rev = (x.rev || 0) + 1;
      x.atualizadoEm = agora();
    });
  } catch (e) { return 0; /* a lista sai do mesmo jeito; completa na próxima */ }
  return n;
}

// ── a FAMÍLIA dos produtos (o Analítico: itens por família → SKU) ──
// 'Produtos'[Família] do modelo do Comercial no Power BI — a mesma do Sales
// Report —, consultada com o token DELEGADO da pessoa (o da unidade de
// negócio, x-pbi-token). Só os códigos das cotações que ela vê; cache por
// código (12 h; código sem família: 2 h). Sem token ou com o BI fora do ar,
// devolve o que estiver no cache e o motivo.
const _familias = new Map();   // CÓDIGO -> { fam, exp }
function codFam(c) { return String(c == null ? '' : c).replace(/ /g, ' ').trim().toUpperCase(); }
async function familias(codigos, quem, pbiToken) {
  const cods = [];
  (codigos || []).forEach(function (c) { const k = codFam(c); if (k && k.length <= 40 && cods.indexOf(k) < 0) cods.push(k); });
  const out = {}, falta = [];
  cods.forEach(function (k) { const h = _familias.get(k); if (h && h.exp > Date.now()) { if (h.fam) out[k] = h.fam; } else falta.push(k); });
  if (!falta.length) return { familias: out, consultados: 0 };
  const ruim = pbiU.tokenRecusado({ email: quem.email, oid: quem.oid }, pbiToken);
  if (ruim) return { familias: out, consultados: 0, motivo: pbiU.motivoFechado({ fonte: ruim }) };
  const q = function (c) { return '"' + c.replace(/"/g, '""') + '"'; };
  try {
    for (let i = 0; i < falta.length && i < 1200; i += 150) {
      const lote = falta.slice(i, i + 150), achou = {};
      const rows = await pbiU.executar(pbiToken, "EVALUATE FILTER(SELECTCOLUMNS('Produtos', \"cod\", UPPER(TRIM(SUBSTITUTE('Produtos'[Cód. produto], UNICHAR(160), \" \"))), " +
        "\"fam\", 'Produtos'[Família]), [cod] IN {" + lote.map(q).join(', ') + '})');
      rows.forEach(function (r) { const k = codFam(r['[cod]']), f = txt(r['[fam]'], 80); if (k && f && !achou[k]) achou[k] = f; });
      lote.forEach(function (k) {
        _familias.set(k, { fam: achou[k] || '', exp: Date.now() + (achou[k] ? 12 : 2) * 3600e3 });
        if (achou[k]) out[k] = achou[k];
      });
    }
  } catch (e) {
    return { familias: out, consultados: falta.length, motivo: 'o Power BI não respondeu' + (e.pbiStatus ? ' (' + e.pbiStatus + ')' : '') };
  }
  return { familias: out, consultados: falta.length };
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
  FASES, FASES_AMOSTRA, FASES_INICIAIS, nomeFase, PORTAIS_PADRAO, MOTIVOS_PERDA_PADRAO, MOTIVOS_CANCEL_PADRAO, EMPRESAS_PADRAO, AREAS_PADRAO, DONO, DONOS, NUM_PREFIXO, UNIDADE_MSB, EMPRESA_FIXA,
  lerConfig, salvarConfig, montarConfig, exigirEquipe, perfilDe, exigirChaveDoFlow, retornoDoFlow, comEscopo, veCaso, motivoUnidade: pbiU.motivoFechado,
  novoDaLoja, PORTAL_LOJA,
  motivosDaPerda, ovsDaCotacao, conferirLotes: lotesD365.conferir, listar, obter, arquivo, duplicado, novo, agir, criarAmostra, perderVencidas, completarResumos, familias, resumoDe, diagnostico, consultarErp, consultarErpCodigo,
  produtosSf: produtosSf.porCodigos,
  // para os testes
  dataDe, num, chaveDe, portalDe, dadosDe, validadeCalculada, diasEntre, venceu, equipeDosGrupos, confrontar, numeroOv: ovD365.numeroOv,
  _zerarCaches: function () { _completouEm = 0; _perdeuEm = 0; _vencidasVistas.clear(); _perfis.clear(); _familias.clear(); produtosSf._zerar(); lotesD365._zerar(); }
};
