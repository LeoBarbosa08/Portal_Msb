// ================================================================
// shared/cot-produtos.js — o PRODUTO no Salesforce (Product2) pelo código
// Biomedical do item da cotação (21/10/2026). Só leitura.
//
// A proposta que vai ao comprador sai com a descrição, o fabricante e o RMS
// do CADASTRO — não só o que a IA leu do PDF:
//   descrição   = Description (sem ela, Name) e o Complemento__c ("complemento
//                 da descrição do produto para ser impresso na proposta em PDF")
//   fabricante  = Fabricante__c · procedência = Procedencia__c
//   rms         = RMS__c ("RMS Atual"; sem ele, RMS_Registro__c, o do
//                 registro/renovação) · isento = Isento_de_RMS__c = 'Sim'
// Casa pelo ProductCode ou pelo Cod_Produto_int__c (como o /api/produto-
// salesforce da LICI); o produto ATIVO ganha do inativo. Cache por código
// (6 h; o código que não está no Salesforce: 1 h). A org sem algum campo
// customizado (INVALID_FIELD) segue com os campos padrão do Product2.
// Sem o Salesforce configurado (SF_CLIENT_ID/SF_CLIENT_SECRET): configurado:false.
// ================================================================
'use strict';
const SF = require('./salesforce');

const CAMPOS = ['Id', 'Name', 'ProductCode', 'Cod_Produto_int__c', 'Description', 'Complemento__c', 'Fabricante__c', 'Procedencia__c',
  'RMS__c', 'RMS_Registro__c', 'Isento_de_RMS__c', 'IsActive'];
const BASICOS = ['Id', 'Name', 'ProductCode', 'Description', 'IsActive'];
const MAX = 300, LOTE = 100;
const _cache = new Map();   // CÓDIGO -> { v: produto | null, exp }
let _basico = false;

// o código como a tela normaliza (normCod): sem espaço invisível, hífen comum, maiúsculo
function cod(c) {
  return String(c == null ? '' : c).replace(/[​-‍﻿]/g, '').replace(/ /g, ' ')
    .replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim().toUpperCase();
}
function limpo(v, max) {
  return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
function rmsDe(v) { const d = String(v == null ? '' : v).replace(/\D/g, ''); return d.length >= 7 && d.length <= 15 ? d : ''; }
function produtoDe(r) {
  return {
    id: r.Id || '', nome: limpo(r.Name, 255),
    descricao: limpo(r.Description, 600) || limpo(r.Name, 255), complemento: limpo(r.Complemento__c, 255),
    fabricante: limpo(r.Fabricante__c, 120), procedencia: limpo(r.Procedencia__c, 60),
    rms: rmsDe(r.RMS__c) || rmsDe(r.RMS_Registro__c),
    isento: String(r.Isento_de_RMS__c || '').trim().toLowerCase() === 'sim',
    ativo: !!r.IsActive
  };
}
function consultar(lote, campos) {
  const lista = lote.map(function (c) { return "'" + SF.soqlStr(c) + "'"; }).join(',');
  return SF.soql('SELECT ' + campos.join(', ') + ' FROM Product2 WHERE ProductCode IN (' + lista + ')' +
    (campos.indexOf('Cod_Produto_int__c') >= 0 ? ' OR Cod_Produto_int__c IN (' + lista + ')' : ''), 5);
}

// { configurado, produtos: { CÓDIGO: produto }, consultados?, erro? } — o
// código que não está no Salesforce não aparece em `produtos`
async function porCodigos(codigos) {
  const cods = [];
  (Array.isArray(codigos) ? codigos : []).forEach(function (c) { const k = cod(c); if (k && k.length <= 60 && cods.indexOf(k) < 0 && cods.length < MAX) cods.push(k); });
  const produtos = {}, falta = [];
  cods.forEach(function (k) { const h = _cache.get(k); if (h && h.exp > Date.now()) { if (h.v) produtos[k] = h.v; } else falta.push(k); });
  if (!SF.CONFIGURED) return { configurado: false, produtos: produtos };
  if (!falta.length) return { configurado: true, produtos: produtos, consultados: 0 };
  try {
    for (let i = 0; i < falta.length; i += LOTE) {
      const lote = falta.slice(i, i + LOTE);
      let recs;
      try { recs = await consultar(lote, _basico ? BASICOS : CAMPOS); }
      catch (e) {
        if (_basico || !/INVALID_FIELD|No such column/i.test(String(e.message))) throw e;
        _basico = true;
        recs = await consultar(lote, BASICOS);
      }
      const achou = {};
      const anota = function (c, r) { const k = cod(c); if (!k || lote.indexOf(k) < 0) return; const a = achou[k]; if (!a || (!a.IsActive && r.IsActive)) achou[k] = r; };
      (recs || []).forEach(function (r) { anota(r.ProductCode, r); anota(r.Cod_Produto_int__c, r); });
      lote.forEach(function (k) {
        const v = achou[k] ? produtoDe(achou[k]) : null;
        _cache.set(k, { v: v, exp: Date.now() + (v ? 6 : 1) * 3600e3 });
        if (v) produtos[k] = v;
      });
    }
  } catch (e) {
    const st = /\s(\d{3}):/.exec(String(e.message));
    return { configurado: true, produtos: produtos, erro: 'o Salesforce não respondeu' + (st ? ' (' + st[1] + ')' : '') };
  }
  return { configurado: true, produtos: produtos, consultados: falta.length };
}

// ao criar a cotação: o fabricante e o RMS que ficaram VAZIOS vêm do
// cadastro (a tela já trocou pelos do Salesforce; o que a pessoa escreveu
// fica). Não segura a criação: no máximo `ms` esperando o Salesforce.
async function completarItens(itens, ms) {
  const cods = (itens || []).filter(function (it) { return it.codigo && (!it.marca || !it.registro); }).map(function (it) { return it.codigo; });
  if (!cods.length || !SF.CONFIGURED) return 0;
  let r;
  try {
    r = await Promise.race([porCodigos(cods), new Promise(function (ok) { setTimeout(function () { ok(null); }, ms || 5000).unref(); })]);
  } catch (e) { return 0; }
  if (!r || !r.produtos) return 0;
  let n = 0;
  itens.forEach(function (it) {
    const p = it.codigo && r.produtos[cod(it.codigo)];
    if (!p) return;
    if (!it.marca && p.fabricante) { it.marca = p.fabricante.slice(0, 80); n++; }
    if (!it.registro && p.rms) { it.registro = p.rms; n++; }
  });
  return n;
}

module.exports = { porCodigos, completarItens, cod, _zerar: function () { _cache.clear(); _basico = false; } };
