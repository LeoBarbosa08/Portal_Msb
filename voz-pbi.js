/* ================================================================
   voz-pbi.js — Cliente Power BI COMERCIAL no navegador (token do usuário)
   Expõe window.VOZPBI = { connect, query }. RLS automático (funciona no PPU).
   Requer msal-browser carregado.
   ================================================================ */
(function () {
  'use strict';
  var PBI = {
    clientId: '129978ce-ff3b-431d-98b3-66a1bcb766b1',
    tenantId: 'c311c9e6-6017-42a9-b306-4057beba5786',
    workspaceId: '8535f0a1-8dc6-4da0-93ce-bf20c1c14e27',
    reportId: '10a505aa-759e-4f20-a130-98c0736ba42d',
    scopes: ['https://analysis.windows.net/powerbi/api/Dataset.Read.All',
             'https://analysis.windows.net/powerbi/api/Report.Read.All']
  };
  var _pbi = null, _token = null, _dsId = null;

  async function connect() {
    if (window._msalAuth) { _pbi = window._msalAuth; }
    else {
      _pbi = new msal.PublicClientApplication({ auth: { clientId: PBI.clientId, authority: 'https://login.microsoftonline.com/' + PBI.tenantId, redirectUri: window.location.origin + '/' }, cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: true } });
      if (_pbi.initialize) await _pbi.initialize();
      await _pbi.handleRedirectPromise().catch(function(){});
    }
    var accts = _pbi.getAllAccounts();
    try { var r = await _pbi.acquireTokenSilent({ scopes: PBI.scopes, account: accts[0] }); _token = r.accessToken; }
    catch (e) { var rr = await _pbi.loginPopup({ scopes: PBI.scopes }); _token = rr.accessToken; }
    return _token;
  }
  async function resolveDataset() {
    if (_dsId) return _dsId;
    // override por página: aponta o agente para OUTRO dataset do mesmo workspace
    // (ex.: Negociações). Definir window.VOZPBI_DATASET ANTES de carregar este script.
    if (window.VOZPBI_DATASET) { _dsId = window.VOZPBI_DATASET; return _dsId; }
    var rr = await fetch('https://api.powerbi.com/v1.0/myorg/groups/' + PBI.workspaceId + '/reports/' + PBI.reportId, { headers: { Authorization: 'Bearer ' + _token } });
    if (rr.ok) { var j = await rr.json(); if (j && j.datasetId) { _dsId = j.datasetId; return _dsId; } }
    throw new Error('Não consegui resolver o dataset do Comercial.');
  }
  async function query(dax) {
    if (!_token) await connect();
    if (!_dsId) await resolveDataset();
    var body = JSON.stringify({ queries: [{ query: dax }], serializerSettings: { includeNulls: true } });
    var headers = { Authorization: 'Bearer ' + _token, 'Content-Type': 'application/json' };
    var r = await fetch('https://api.powerbi.com/v1.0/myorg/groups/' + PBI.workspaceId + '/datasets/' + _dsId + '/executeQueries', { method: 'POST', headers: headers, body: body });
    var txt = await r.text();
    if (!r.ok) throw new Error('Power BI ' + r.status + ': ' + txt.substring(0, 200));
    var d = JSON.parse(txt);
    if (d.error) throw new Error('Power BI: ' + (d.error.message || 'erro'));
    return d.results[0].tables[0].rows;
  }

  window.VOZPBI = { connect: connect, query: query };
})();
