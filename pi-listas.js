/* ================================================================
   pi-listas.js — as listas do PI · Pedido que o CRM também usa

   25/11/2026 (pedido do dono): "levar a lista do PI Pedidos para o CRM" —
   a CONDIÇÃO DE PAGAMENTO do CRM (Nova oportunidade e a oportunidade em
   andamento) deixou de ser campo aberto e passa a ser ESTA lista, a mesma
   do cabeçalho do PI. Uma fonte só para as duas telas:
     . pedido-inteligente.js      (pages/pedido-inteligente.html)
     . cotacoes-base.js → COT.COND_PAGAMENTO (as páginas do CRM)
   O servidor tem a cópia dele no prompt da IA (api/pedido-extrair ›
   CONDICOES_PAGAMENTO); scripts/test-pi-fila.js confere que as duas batem.
   26/11/2026: o FRETE também (as 3 opções do PI) — no PDF da proposta sai só
   CIF ou FOB — e a CONDIÇÃO DE ENTREGA (PADRÃO / URGENTE).
   A Transportadora não está aqui: vem do Dynamics (/api/pedido-transportadoras).

   window.PILISTAS no navegador; module.exports no Node (os testes).
   ================================================================ */
(function (raiz) {
  'use strict';
  // RECORTE MSB (05/11/2026, pedido do dono): as condições de pagamento da
  // MSB, na ordem da lista que ele mandou (linhas repetidas idênticas saíram;
  // "4 Parcelas" e "4 parcelas" ficam as duas, como vieram). O texto vai
  // como está em CondicaoPagamento para o flow.
  var COND_PAGAMENTO = [
    'CR 90/120 DIAS', 'CR A VISTA/30/60', '20/50/81/111 dias', '30/45/60/90',
    '12 VEZES DE 15 EM 15 DIAS', 'ADIANTAMENTO DE FORNECEDOR', '28 DIAS', '30 DIAS', '45 DIAS',
    '60 DIAS', '75 DIAS', '90 DIAS', 'CR 10 DIAS', 'CR 13 PARCELAS DE 15 EM 15 DIAS', 'CR 15 DIAS',
    'CR 15/30', 'CR 15/30/45/60', 'CR 15/30/45/60/75/90', 'CR 15/30/45', 'CR 15/30/45/60/75',
    'CR 15/30/45/60/75/90/105', 'CR 15/30/45/60/75/90/105/120/135',
    'CR 15/30/45/60/75/90/105/120/135/150', 'CR 15/30/45/60/75/90/105/120/135/150/165/180/195/210',
    'CR 15/75', 'CR 20 DIAS', 'CR 20 PC 15 EM 15 DIAS', 'CR 20/40', 'CR 23 PC DE 15 EM 15 DIAS',
    'CR 25% ANTECIPADO 30/60/90 DIAS', 'CR 28 DIAS', '28/42', 'CR 28/56 DIAS', 'CR 28/35/42',
    'CR 30 DIAS', 'CR 30% A VISTA 30/60 DIAS', 'CR 30/60/90/120', '30/45', 'CR 30/45/60/75',
    'CR 30/45/60/75/90/105/120/135/150', 'CR 30/45/60', 'CR 30/45/60/75/90', 'CR 30/60 DIAS',
    '30/60/90/120/150/180', 'CR 30/60/90/120/150', 'CR 34 VEZES DE 15 EM 15 DIAS', 'CR 35 DIAS',
    'CR 40 DIAS', 'CR 40/60/90', 'CR 45/60', 'CR 45/60/75/90 DIAS', 'CR 45/60/90',
    'CR 45/60/90/120', 'CR 45/90/120', 'CR 50% avista / 30 dias', 'CR 60 DIAS', 'CR 60/90/120/150',
    'CR 60/90/120', 'CR 7 PARCELAS DE 15 EM 15 DIAS', 'CR 8 PC 15 E 15 DIAS', 'CR 90 DIAS',
    'CR 90/120/150', 'CR À VISTA', 'CR A VISTA / 30 /60 / 90', 'CR A VISTA / 30 DIAS',
    'CR A VISTA/30/60/90/120', 'CR A VISTA30,0%/30/60', 'CR AVISTA/60/90/120/150',
    'CR15/30/45/60/75/90/105/120/135/150/165/180/195/210/225', 'CR 20/40/60',
    'CR30/45/60/75/90/105/120', 'CR 30/60/90', 'CR 60/90', '4 Parcelas', '4 parcelas'
  ];

  // 26/11/2026 (pedido do dono: "no FRETE, as mesmas opções do PI — a opção tem
  // que ser igual à do PI Pedidos; no PDF, CIF com ou sem valor sai como CIF"):
  // o frete do CRM é esta lista; a proposta mostra só CIF / FOB (COT.freteCifFob)
  var FRETES = ['CIF - COM VALOR', 'CIF - SEM VALOR', 'FOB - DESTINATARIO'];
  // 26/11/2026 (o dono: "faltou a condição de entrega também"): a CONDIÇÃO DE
  // ENTREGA do PI, obrigatória lá — o CRM usa a mesma (o Prazo de entrega, o
  // texto "5 dias úteis" da proposta, continua à parte)
  var COND_ENTREGA = ['PADRÃO', 'URGENTE'];

  var L = { condPagamento: COND_PAGAMENTO, fretes: FRETES, condEntrega: COND_ENTREGA };
  if (typeof module === 'object' && module.exports) module.exports = L;
  else raiz.PILISTAS = L;
})(typeof window !== 'undefined' ? window : this);
