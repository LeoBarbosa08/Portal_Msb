/* ================================================================
   pbi-modelo.js — Portal Biomedical
   Acha o MODELO (dataset) do Power BI que tem a tabela que a tela lê e,
   quando não acha, diz o MOTIVO de verdade.

   O PROBLEMA (Estoque, 16/10/2026)
   As telas do Estoque descobriam o modelo assim: listavam os datasets do
   workspace do portal e mandavam "EVALUATE TOPN(1, 'Tabela')" para cada um
   pela URL COM o workspace, engolindo TODO erro. Daí:
     - modelo republicado em OUTRO workspace (relatório "fino" no portal,
       modelo noutro lugar) não aparece na lista, e a URL com o workspace do
       portal responde 404 — a tela dizia "não encontrado no workspace";
     - sem permissão, RLS, capacidade pausada, limite de consultas, token
       vencido… tudo virava o mesmo "não encontrado no workspace", e ninguém
       sabia o que consertar.

   16/10/2026, à tarde — a causa de verdade: a coluna CALCULADA
   'Movimentações de estoque'[Cidade do cliente (OV)] quebrou no modelo
   ("does not hold any data because evaluation of one of the rows caused an
   error"). O teste "TOPN(1, 'Tabela')" devolve TODAS as colunas, então uma
   coluna quebrada que nenhuma tela usa derrubava a descoberta do modelo
   inteiro. O teste agora é PBIModelo.sonda(): conta linhas, não lê coluna.

   O QUE ESTE ARQUIVO FAZ
     PBIModelo.sonda(tabela)
        A consulta que prova que o modelo tem a tabela e o usuário a lê:
        EVALUATE ROW("n", COUNTROWS('Tabela')) — não toca em coluna nenhuma.
     PBIModelo.post(ws, dsId, init)
        POST no executeQueries. Se a URL com o workspace recusar (401/403/404),
        tenta a URL SEM grupo — o Power BI acha o modelo onde ele morar (a
        mesma queda que Comercial, Licitação e o api/shared/pbi-core.js já
        usam) — e lembra a escolha para as próximas consultas.
     PBIModelo.candidatos(ws, token)
        Datasets do workspace + os modelos por trás dos RELATÓRIOS do
        workspace (o datasetId do relatório fino aponta para o outro
        workspace).
     PBIModelo.motivo(tabela, falhas)
        O Error que vai para a faixa vermelha: o erro real do Power BI
        traduzido (permissão, RLS, capacidade, limite, token), ou — quando
        todos responderam "essa tabela não existe aqui" — que a tabela não
        está em nenhum modelo que o usuário enxerga.

   Sem dependências; o pbi-throttle.js continua freando tudo (o fetch daqui
   passa por ele).
   ================================================================ */
(function () {
  'use strict';
  if (window.PBIModelo) return;

  var API = 'https://api.powerbi.com/v1.0/myorg';
  var _semGrupo = {};       // dsId -> true: só responde pela URL sem grupo

  function sonda(tabela) { return 'EVALUATE ROW("n", COUNTROWS(' + tabela + '))'; }

  function urlGrupo(ws, dsId) { return API + '/groups/' + ws + '/datasets/' + dsId + '/executeQueries'; }
  function urlDireta(dsId)    { return API + '/datasets/' + dsId + '/executeQueries'; }

  async function post(ws, dsId, init) {
    if (!ws || _semGrupo[dsId]) return fetch(urlDireta(dsId), init);
    var r = await fetch(urlGrupo(ws, dsId), init);
    if (r.status !== 401 && r.status !== 403 && r.status !== 404) return r;
    var r2 = await fetch(urlDireta(dsId), init);
    if (r2.ok) { _semGrupo[dsId] = true; return r2; }
    // as duas portas fecharam: fica a resposta que explica mais — 404 do
    // workspace só diz "não mora aqui"; a da URL direta diz o porquê
    return r.status === 404 ? r2 : r;
  }

  async function candidatos(ws, token) {
    var H = { headers: { Authorization: 'Bearer ' + token } };
    var out = [], visto = {}, falhou = [];
    function add(id, nome) {
      if (!id || visto[id]) return;
      visto[id] = true;
      out.push({ id: id, name: nome || id });
    }
    try {
      var rd = await fetch(API + '/groups/' + ws + '/datasets', H);
      if (rd.ok) (((await rd.json()).value) || []).forEach(function (d) { add(d.id, d.name); });
      else falhou.push('datasets HTTP ' + rd.status);
    } catch (e) { falhou.push('datasets: ' + (e && e.message)); }
    try {
      var rr = await fetch(API + '/groups/' + ws + '/reports', H);
      if (rr.ok) (((await rr.json()).value) || []).forEach(function (rp) {
        if (!rp || !rp.datasetId || visto[rp.datasetId]) return;
        if (rp.datasetWorkspaceId && rp.datasetWorkspaceId !== ws) _semGrupo[rp.datasetId] = true;
        add(rp.datasetId, 'modelo do relatório ' + (rp.name || rp.id));
      });
      else falhou.push('relatórios HTTP ' + rr.status);
    } catch (e) { falhou.push('relatórios: ' + (e && e.message)); }
    if (!out.length) {
      throw new Error('Não foi possível listar os modelos do Power BI' +
        (falhou.length ? ' (' + falhou.join('; ') + ')' : '') + '. Recarregue a página (F5).');
    }
    return out;
  }

  // "Essa tabela/coluna/medida não existe neste modelo" (ou "esse modelo não
  // existe mais", 404) é o esperado ao varrer os datasets — o modelo errado
  // não tem a tabela. Qualquer OUTRO erro é o motivo de verdade.
  var RX_NAO_TEM = /cannot find table|cannot be found|cannot be determined|failed to resolve name|does ?n[o']t exist|entity ?not ?found|\b404\b|n[ãa]o (?:foi poss[íi]vel )?(?:encontr|localiz)|n[ãa]o existe/i;

  function limpa(s) {
    return String(s == null ? '' : s).replace(/<\/?oii>/g, '').replace(/[<>&]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function msgDe(e) { return limpa((e && (e.message || e)) || ''); }

  function traduz(m) {
    if (/calculated column|coluna calculada/i.test(m))
      return 'uma coluna calculada do modelo está com erro (a fórmula quebrou em alguma linha na última atualização) — quem mantém o modelo no Power BI precisa corrigir a fórmula';
    if (/token ?expired|expired|venceu|expirou/i.test(m))
      return 'o acesso ao Power BI venceu. Recarregue a página (F5)';
    if (/\b429\b|too many requests|rate limit/i.test(m))
      return 'o Power BI limitou o ritmo das consultas. Aguarde 1 minuto e recarregue a página';
    if (/capacit|capacity/i.test(m))
      return 'a capacidade do Power BI onde o modelo mora está pausada ou sobrecarregada (fale com o TI / admin do Power BI)';
    if (/row.?level|\brls\b|\brole\b|fun[çc][ãa]o de seguran/i.test(m))
      return 'o seu usuário não está em nenhuma função de segurança (RLS) do modelo (fale com o TI / admin do Power BI)';
    if (/\b40[13]\b|not ?authorized|unauthorized|forbidden|permiss|does ?n[o']t have access/i.test(m))
      return 'o Power BI recusou o acesso do seu usuário ao modelo — falta permissão de leitura/Build no modelo (fale com o TI / admin do Power BI)';
    return '';
  }
  // erro que se explica (traduz) vale mesmo se também disser "does not exist":
  // "Either the user does not have access to the database, or the database
  // does not exist" é falta de acesso, não modelo errado
  function ehReal(m) { return !!m && (!!traduz(m) || !RX_NAO_TEM.test(m)); }

  // falhas = [[nome do modelo, erro], ...] na ordem em que foram tentados
  // (fixado/cache primeiro: o erro DELE é o que mais explica)
  function motivo(tabela, falhas) {
    falhas = falhas || [];
    var real = null;
    for (var i = 0; i < falhas.length; i++) {
      var m = msgDe(falhas[i] && falhas[i][1]);
      if (ehReal(m)) { real = { nome: limpa(falhas[i][0]), msg: m }; break; }
    }
    try { console.warn('[PBIModelo] ' + tabela + ' — tentativas:', falhas.map(function (f) { return [f[0], msgDe(f[1])]; })); } catch (e) {}
    if (real) {
      var dica = traduz(real.msg);
      return new Error('Não deu para ler a tabela ' + tabela + ' no Power BI: ' +
        (dica ? dica + '. ' : '') + 'Detalhe (' + real.nome.slice(0, 60) + '): ' + real.msg.slice(0, 220));
    }
    return new Error('A tabela ' + tabela + ' não está em nenhum dos ' + falhas.length +
      ' modelos do Power BI que o seu usuário enxerga — ela pode ter sido renomeada ou o modelo pode ter saído do workspace (fale com o TI / admin do Power BI).');
  }

  window.PBIModelo = { sonda: sonda, post: post, candidatos: candidatos, motivo: motivo };
})();
