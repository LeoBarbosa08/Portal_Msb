# Portal MSB · Comercial & Estoque

Cópia enxuta do Portal Corporativo com **só as áreas Comercial e Estoque**
(repositório `LeoBarbosa08/Portal_Msb`). Montada em 16/10/2026 e atualizada
em 20/10/2026 a partir da versão publicada do portal completo
(`origin/master` 53bb495 de `LeoBarbosa08/Claude.rep`, de 19/10). O portal
completo não foi alterado.

Usa as **mesmas fontes de dados** do portal completo: o mesmo login do Entra
(App Registration `129978ce…`), o mesmo Power BI, Dynamics 365, Salesforce,
Azure OpenAI, os mesmos fluxos do Power Automate e os **mesmos blobs** — o
que alguém faz aqui (FCA, avisos do mural) aparece
no portal completo e vice-versa. **Exceção: o CRM › Venda Recorrente**
(as cotações) tem container próprio da MSB desde 04/11/2026 — ver "CRM ›
Venda Recorrente".

## O que tem

| Área | Páginas |
|---|---|
| Comercial | Visão geral · Sales Report (6 abas) · CRM › Venda Recorrente (Funil, Analítico, Gestão, Quadro, Histórico, Nova oportunidade) · Negociações + Analítico · FCA · Sales Playbook · Materiais · Tabela de Preços |
| Comercial · agentes | Dossiê de Visita · PI · Pedido (liberado para o Comercial em 11/11 — ver "PI · Pedido liberado") · PI · Consignação · PI · Consignação (INCOMPLETO, em testes) · Agente Comercial (o Agente de Cotações virou o "Nova oportunidade" do CRM) |
| Estoque | Visão geral · Gestão de Estoque (Saldo, Ruptura, Validade Curta, Movimentações) · Gestão de Consignação (Saldo Consignado, Saldo por Nota, Devoluções, Rastreabilidade, GMROI) · Perdas · Consignado |
| Estoque · agentes | Agente de Estoque |
| Contábil | Visão geral · Gestão de Custos SG&A (só a MSB) |
| Comum | Home, busca (Ctrl+K), Central de Avisos, tema escuro, celular, PWA |

21 Functions em `api/`: `my-areas`, `alertas`, `avisos`, `pbi-query`,
`directline-token`, `chat`, `transcrever`, `comercial-funil`, `cot-casos`,
`cot-config`, `cot-ov-retorno`, `fca`, `pedido-extrair`, `pedido-enviar`, `pedido-lotes`,
`consig-lote`, `consig-faturar`, `consig-processo`, `dossie-cliente`,
`dossie-ganchos`, `dossie-agenda` (+ `pedido-transportadoras`, de 12/11/2026).

## O que mudou em relação ao portal completo

Tudo marcado no código com o comentário `RECORTE COMERCIAL + ESTOQUE`.

- `api/shared/auth.js` — `ALL_AREAS` = `comercial`, `estoque` e (desde 22/10/2026) `contabil`. O mapa de
  grupos (`GRUPO_AREAS`) ficou **igual** ao do completo: quem tem outra área lá
  não ganha nada aqui. Módulo avulso de outra área (`GRUPO_MODULOS`) não passa.
- `api/my-areas` — saíram o convite da Votação OKR e o líder dos Indicadores
  (Diretoria e Gerencial não existem aqui).
- `api/alertas` — a faixa "Para você" só tem o mural (o Vigia de Consignação
  saiu em 30/10/2026).
- `index.html` — só os cartões Comercial e Estoque; título "Portal Comercial
  & Estoque"; sugestões dos Recentes = Comercial e Estoque.
- `portal-catalogo.js` (busca Ctrl+K) e `script.js` (guia) — filtram as listas
  para as duas áreas; as listas em si ficaram iguais às do completo.
- `salesbooking-data.js` — saíram os links para PI · Cotação e Área de Licitação.
- `sw.js` — cache próprio (`bm-comest-v1`); `manifest.webmanifest` — nome
  "Portal Comercial & Estoque Biomedical" / "Bio Comercial".
- Não vieram: os redirecionamentos antigos do Customer Service (hoje área
  Canal de Atendimento), páginas órfãs (`comercial-licitacoes`, `comercial-bi`,
  `comercial-automacao-cotacoes`, `comercial-cotacoes`, `comercial-oportunidades`)
  e a versão Copilot antiga do PI (`agente-pedidos`).

### Recorte MSB (20/10/2026)

No portal da MSB o **Comercial mostra só o Sales Report (todas as abas) e a
Tabela de Preços**. O resto do Comercial está **oculto, não apagado**: as
páginas continuam nos arquivos e abrem pelo endereço direto. O **Estoque fica
inteiro** (chegou a ser ocultado e voltou no mesmo dia). Marcado no código com
`RECORTE MSB`:

- `nav-sidebar.js` — `NAV.comercial` só com Visão geral, Sales Report e Tabela
  de Preços; sem agentes, automações e atalhos (os cartões "Agentes de IA" e
  "Atalhos" da visão geral saem daí).
- `pages/comercial.html` — saíram os cartões de Negociações, Cotações, FCA,
  Sales Playbook e Materiais e Recursos.
- `portal-catalogo.js` — na busca (Ctrl+K), do Comercial só entram as páginas
  de `MSB_VISIVEIS`; o Estoque aparece completo.
- `index.html` — o card do Comercial descreve só Sales Report e Tabela de Preços.
- `sw.js` — cache `bm-comest-v2`, para o navegador não servir o menu antigo.

Para voltar um módulo: recoloque-o nesses pontos.

### Só a empresa MSB (20/10/2026)

**Todo relatório do portal mostra só a empresa MSB** — sem opção de ver a BIO
nem "Todos". A regra mora no `pbi-throttle.js` (bloco `RECORTE MSB`), por onde
passa toda consulta ao Power BI do portal (telas, listas de filtro, detalhes,
exportações e o assistente de voz): cada `EVALUATE` vira
`EVALUATE CALCULATETABLE(<consulta>, 'Empresas'[Código da empresa] IN { "MSB" })`.

- A coluna e o valor são descobertos uma vez por modelo, nesta ordem:
  `'Empresas'[Código da empresa]`, `'Empresas'[Empresa]`, `'Empresa'[Empresa]`,
  `DIM_EMPRESAS[EMPRESA]` (o modelo de Gestão de Custos SG&A);
  vale o valor `MSB` (ou, sem ele, o que tiver MSB / MEDICAL SYSTEM no nome).
  `PBIQ.recorte()` no F12 mostra o que foi achado em cada modelo.
- Modelo com a coluna mas **sem a MSB** → nenhuma consulta vai; a tela fica sem
  números e com a faixa "Este relatório não tem dados da MSB no Power BI".
- Modelo **sem tabela de empresa** → as consultas vão como estão (aviso no
  console). Tabela sem relação com `'Empresas'` no modelo (as de preço, a de
  ruptura…) também não é recortada: o filtro só desce pelas relações.
- Um filtro de outra empresa **dentro** da consulta passaria por cima do
  recorte, então nenhuma tela oferece a BIO: Sales Report e Performance de
  Vendas têm a Empresa fixa; nas outras telas a lista de Empresa vem do modelo
  já recortada (só MSB); o assistente de voz recusa DAX com `"BIO"`
  (`voz-embed.js`) e o prompt (`api/shared/comercial-schema.js`) diz que o
  portal é só da MSB.
- Fica de fora o que o portal não lê do Power BI.
- É filtro do portal, no navegador. Para o dado nem sair do Power BI, o lugar é
  uma função de RLS no modelo para as contas da MSB.

### Sales Report da MSB (20/10/2026)

`pages/comercial-sales-report.html` já não é igual ao do completo — ao trazer
novidades de lá, reaplique:

- **Sem os cards Bio e MSB** — só o consolidado de Faturamento × Meta, já
  recortado na MSB (ver "Só a empresa MSB").
- **Empresa fixa em MSB** — sem o dropdown de Empresa (BIO/MSB); a barra mostra
  o rótulo fixo "Empresa MSB" e `srFiltroEmpresa()` sempre devolve
  `'Empresas'[Código da empresa] = "MSB"`. O mesmo na Performance de Vendas
  (`pvFiltrosValor()`).
- **Regionais no banner** — à direita do número grande, Faturamento, Meta, Gap,
  % Meta e Margem das 5 regiões do Brasil, montadas pelo
  `'Estados'[Cód. do estado]` (`REGIONAIS`, `medirRegionais`,
  `pintarRegionais`). Cada medida é avaliada na regional, com os mesmos filtros
  do banner. Em tela estreita a tabela desce para baixo do número.
- **Performance por Regional** no lugar da Performance por Filial — mesmas
  linhas do banner (uma consulta só), mais "Exterior / sem UF" quando houver,
  para fechar com o TOTAL; abre em Estratégia › Família. O Excel sai como
  `Performance_Regional_<mês>_<ano>.xlsx`.
- **Regionais numa lista só** — as 5 regiões + "Exterior / sem UF" e o filtro
  de UF de cada uma moram em `sr-regional.js` (`SRRegional`); a Visão Geral
  lê `REGIONAIS`/`REG_OUTRAS`/`regFiltro` de lá.

### Abas do Sales Report (22/10/2026)

- **Saíram** Calendário Cirúrgico, Novos Negócios e Clientes Perdidos — páginas
  apagadas e tiradas das abas, do menu (`nav-sidebar.js`), da busca
  (`portal-catalogo.js`, `script.js`) e do Sales Playbook. Ficaram 6 abas:
  Visão Geral, Performance de Vendas, Análise de Vendas, Análise de Pedidos,
  Base de Notas Fiscais e Comportamento de Clientes.
- **Regional** (pela UF, `sr-regional.js`, as mesmas da Visão Geral) em três abas:
  - filtro **Regional** na barra (multi-seleção; vale para a página toda);
  - **Performance de Vendas** — tabela "Performance por Regional" (YTD/QTD/MTD,
    abre em Estratégia › Família), acima da por Filial;
  - **Análise de Vendas** — "Faturamento × Meta por Regional" (Faturamento,
    Part., Meta, Gap, % Meta, % Margem, Margem);
  - **Análise de Pedidos** — "Pedidos por Regional" (Valor, Part., Qtd de
    Pedidos, Quantidade, Ticket). Aqui a UF é `Clientes[Cód. Estado]`, a que
    chega ao fato Pedidos; nas outras é `'Estados'[Cód. do estado]`.
  - Cada tabela por Regional ignora o próprio filtro (as outras regionais
    continuam à vista, apagadas; as escolhidas em destaque). Nas duas Análises
    clicar numa regional põe/tira ela do filtro.
  - Na Análise de Vendas o campo antigo "Regional" da matriz virou
    "Regional (Sales Vertical)" — é a regional do cadastro, não a da UF.
- `sw.js` — cache `bm-comest-v5`.

### Contábil · Gestão de Custos SG&A (22/10/2026)

Entrou a área **Contábil** só com a **Gestão de Custos SG&A**, trazida do portal
completo (`origin/master` c5aa0cf de `Claude.rep`, 22/10) e recortada na MSB.
DRE, Margem de Contribuição e o Agente Contábil do completo **não vieram**.

- `pages/contabil-custos-sgna.html` — cópia do completo convertida para a marca
  (`scripts/msb-cores.js`, Roboto, logo, "· MSB"). **Empresa fixa em MSB**: na
  barra fica o rótulo "Empresa MSB" (`fixa` no `DIMS`), sem a lista; o Excel
  registra "Empresa: MSB". Quem recorta de fato é o `pbi-throttle.js`, que agora
  conhece `DIM_EMPRESAS[EMPRESA]` (ver "Só a empresa MSB"). Se esse modelo não
  tiver a MSB, a tela fica sem números, com a faixa de aviso.
- `pages/contabil.html` — visão geral com o cartão do SG&A (casca MSB da
  `estoque.html`).
- Acesso: `ALL_AREAS` ganhou `contabil` — entra quem já tem o Contábil no
  completo (os grupos do `GRUPO_AREAS`, admin e acesso full). `PAGINAS_FORA`
  barra módulo avulso das páginas que não vieram (a Margem da Coordenação de
  Compras não vira porta para o Contábil).
- `nav-sidebar.js` (`NAV.contabil` só Visão geral + SG&A), `index.html`
  (cartão Contábil), `portal-catalogo.js` (busca: Contábil só com o SG&A) e
  `script.js` (guia).
- `pbi-throttle.js?v=5` nas páginas, para nenhum navegador ficar com o recorte
  antigo.

### Sem o InventarIA e o Vigia (30/10/2026)

- **Saiu** o InventarIA (inventário de consignado em campo) — página
  `estoque-consignado-inventario.html` apagada e tirada do menu
  (`nav-sidebar.js`), do cartão de Módulos e das barras laterais do Estoque
  (`estoque.html`, `estoque-consignado.html`, `agente-estoque.html`), da busca
  (`portal-catalogo.js`, `script.js`) e da liberação por página da Equipe
  Comercial - Assistentes Venda Recorrente (`api/shared/auth.js`).
  `PAGINAS_FORA` barra módulo avulso que ainda aponte para ela. Foram junto
  os ícones `msb-simbolo*.png`, que só ela usava.
- **Saiu** o Vigia de Consignação (agente do Estoque: regras + fila de
  aprovação) — página `estoque-vigia.html` apagada e tirada da seção Agentes
  do menu, com o contador de pendentes (`nav-sidebar.js`), e da busca
  (`portal-catalogo.js`). Foram apagadas as Functions `consig-vigia-scan` e
  `consig-vigia-fila` e o que só elas usavam (`api/shared/vigia-blob.js`,
  `api/shared/consig-regras.js`); o `api/alertas` perdeu o coletor do Vigia
  (a regra pura ficou, como as do completo). A fila no blob é do portal
  completo e continua lá, intacta. `PAGINAS_FORA` ganhou `estoque-vigia`.
- `sw.js` — cache `bm-comest-v6`.

### PI · Pedido de volta, só do dono (04/11/2026)

Pedido do dono: trazer o PI · Pedido do portal completo (`LeoBarbosa08/Claude.rep`
`6eab8f9`, de 04/11) para o Comercial da MSB, visível **só para ele**.

- **Atualizado com o completo** (cores e nomes da MSB mantidos):
  `pedido-inteligente.js` (pedido registrado à mão na cotação, sem PDF, de
  21/10; endereço, e-mail, observação, condição de pagamento e frete da
  cotação nos campos vazios, de 22/10), `customer-service-pi.js` (aceita a
  entrega sem PDF), `api/pedido-extrair` + `api/shared/cot-id.js` (número da
  cotação pelo rótulo ID / Identificador do PDF) e `voz-pbi.js` (o token do
  Power BI renova sozinho — antes dava 403 depois de ~1 h na página).
  `docs/pedido-inteligente.md` veio junto, como referência.
- **No menu do Comercial**, seção Agentes, e no cartão "Agentes de IA" da
  visão geral (`nav-sidebar.js`, `agen`).
- **Só do dono** — as duas contas dele (`leonardo.barbosa@` e `ia@`):
  - `nav-sidebar.js` — `pedido-inteligente` entrou no gate por e-mail, com
    lista própria (`SO_DONO`/`DONO_PI`). Para os outros somem o link, a seção
    AGENTES vazia, o cartão e a contagem "1 agente IA"; abrir a página pelo
    endereço dá "Módulo indisponível".
  - `api/pedido-enviar` — `exigirDono`: só lança no Dynamics com id token
    validado de uma das duas contas (401/403 para o resto). `pedido-extrair` e
    `pedido-lotes` seguem por área, porque Cotações e PI · Consignação usam.
  - Fica **fora da busca** (`MSB_VISIVEIS` do `portal-catalogo.js`): a busca da
    home não conhece o gate por e-mail e mostraria o nome para todo mundo.
- Para abrir para a equipe: tirar `pedido-inteligente` do gate e do `SO_DONO`
  no `nav-sidebar.js` e o `exigirDono` do `api/pedido-enviar`.
- **Cabeçalho do PI na MSB** (04/11, pedido do dono): Empresa fixa em `MSB`,
  Área Demandante fixa em `PEDIDOINTELIGENTE (MSB)` e (05/11) Tipo de Venda
  fixo em `VENDA DIRETA` (aparecem, não se escolhe); Caso e Portal saíram da tela (seguem no JSON do flow: Caso `N/D`
  ou o nº da cotação, Portal `NAO INFORMADO` ou o da cotação). No Continuar, o
  obrigatório que falta fica em vermelho e a tela vai até ele.
- **IA da MSB**: implantação própria (`gpt-5-mini`) nas variáveis `AOAI_*` da
  Static Web App da MSB. O `/api/pedido-extrair` aceita o `AOAI_ENDPOINT` em
  qualquer formato do Foundry e a tela mostra o motivo do erro do Azure.
- **Estoque do PI na MSB** (04/11): `/api/pedido-lotes` olha a empresa `msb` e
  o depósito `ALMOX-PA` **inteiro** (o mesmo campo de sempre, Quantidade física
  disponível = `AvailPhysical`, somado por lote, com a validade). 05/11: saiu o
  filtro de localização `PA.` — a reserva entra numa linha do depósito SEM
  localização (−1 disponível) e ficava de fora, mostrando saldo a mais.
  Envs próprias, para não herdar as da BIO: `ESTOQUE_MSB_EMPRESA`,
  `ESTOQUE_MSB_DEPOSITO`, `ESTOQUE_MSB_LOCALIZACAO` (vazia = sem filtro). A
  conexão é a mesma da BIO (`D365_*`). Se a consulta falhar, a etapa Produtos
  avisa uma vez com o motivo e o 2º clique segue sem estoque. **11/11: a conta
  do lote mudou** — ver "PI · Pedido: a conta do lote".
- **Códigos do PI na MSB** (04/11): o recorte MSB do `pbi-throttle.js` sumia
  com produto do cadastro (`'Produtos'[Cód. produto]`, modelo Comercial) — o
  51200 existe na MSB e voltava "não encontrado". O que sobra da conferência é
  procurado de novo com `REMOVEFILTERS('Empresas')` por dentro (só código e
  nome, nenhum número de venda); sem achar nem assim, a mensagem mostra
  códigos parecidos do cadastro.
- **Condições de pagamento da MSB** (05/11, pedido do dono): a lista da tela
  (`COND_PAGAMENTO` no `pedido-inteligente.js`) e a do prompt da IA
  (`CONDICOES_PAGAMENTO` no `api/pedido-extrair`) passam a ser as 75 da MSB, na
  ordem que ele mandou (5 linhas repetidas idênticas saíram). A política de
  crédito (`POLITICA`) ainda é a da BIO: condição que não está nela aparece
  como "não mapeada na política".
- **PDF ao lado** (04/11): como no Agente de Oportunidades do portal da BIO, o
  PDF anexado fica à direita (pdf.js, uma página por canvas, zoom −/+, abrir em
  nova aba, ocultar/mostrar), do PDF à Revisão. Abaixo de 1180px vai para baixo
  do formulário. Pedido manual, sem PDF, não mostra nada.
- Não veio o PI · Pedido (TESTE) (`pi-pedido-teste` + `api/pi-aprovacao`, a
  alçada de aprovação de remessa): no completo ele está oculto para todos.
- `nav-sidebar.js?v=78` em todas as páginas; `sw.js` — cache `bm-comest-v7`.

### CRM › Venda Recorrente (04/11/2026)

Pedido do dono: trazer do portal da BIO (`LeoBarbosa08/Claude.rep` `ab9b478`,
de 04/11) o **módulo CRM** da área Comercial e **tudo** o que existe no
submódulo **Venda Recorrente** — **sem as cotações que já existem lá**. BIO.ID
e Venda Consultiva (os outros dois submódulos do CRM de lá) não vieram.

- **O que veio** (a Gestão de Cotações da BIO de hoje, que lá virou o
  submódulo): a casa do CRM (`pages/comercial-crm.html`), o Funil de
  Oportunidade (`comercial-cot-funil.html`, com semana a semana), o Analítico
  (`comercial-cot-analitico.html`, novo), a Gestão de Oportunidades com Quadro
  e Histórico do cliente (`comercial-cot-casos.html`) e a Nova oportunidade
  (`comercial-cot-nova.html` — o Agente de Oportunidades: lê o PDF do portal
  por IA, confere códigos/CNPJ/preço de referência, proposta por e-mail).
  Tudo o que a BIO ganhou desde 20/10: fase A faturar (com o lote conferido no
  Dynamics), Amostra, resultado item a item, Ordem de Venda conferida no F&O
  (várias por cotação, "Já tenho a OV" com a lista do cliente), retorno da OV
  pelo flow, Perdida automática no vencimento, tramitação, histórico do
  cliente, produto do Salesforce (descrição/fabricante/RMS) na proposta.
  Scripts e estilos: `cotacoes*.js` (com `cotacoes-semana.js` e
  `cotacoes-analitico.js`, novos), `cotacoes.css`, `customer-service.css`,
  `licitacao-funil-vendas.css`, `licitacao-desempenho.css` (novo) — todos
  convertidos para a marca (`scripts/msb-cores.js`, Roboto, logo, "· MSB").
  Servidor: `api/cot-casos`, `api/cot-config`, `api/cot-ov-retorno` (nova) e
  `api/shared/cot-motor.js`, `cot-erp.js`, `cot-ov.js`, `cot-lotes.js`
  (novo), `cot-produtos.js` (novo), `pbi-unidades.js` (novo, só para a
  família do Analítico). `api/pedido-extrair` + `api/shared/pedido-revisar.js`
  ganharam a regra do RMS do completo (o registro ANVISA deixa de virar o
  código), mantendo o ajuste do endpoint da IA da MSB.
- **Sem submódulo (05/11/2026, pedido do dono)**: o CRM abre **direto** o
  Funil de Oportunidade. No menu é um item só ("CRM", aceso em todas as
  páginas dele); o cartão da visão geral, a busca e o guia levam ao Funil; o
  caminho do topo é Comercial › CRM › Funil de Oportunidade (sem "Venda
  Recorrente"); `pages/comercial-crm.html` (a casa com os cartões) virou só um
  redirecionamento para os links antigos. O `BMCRM` segue com um único
  submódulo por dentro (o da unidade MSB).
- **Cotações próprias da MSB** — `api/shared/cot-store.js` lê e grava **só**
  em `COT_MSB_BLOB_URL` (container novo, SAS de container `sr=c` com Read +
  Create + Write). De propósito **não** cai no `COT_BLOB_URL` da BIO: sem a
  variável nova a tela avisa "armazenamento não configurado" e nada é gravado.
  Começa vazio; nada daqui aparece no portal da BIO e vice-versa.
- **Número próprio** `COT-MSB-AAAA-NNNNNN` (`NUM_PREFIXO` no motor). O flow
  do PI · Pedido é o mesmo da BIO: o portal da BIO ignora o `COT-MSB-…` (nunca
  fecha a cotação dele de mesmo número). Para a OV voltar sozinha às
  cotações da MSB, o flow precisa chamar o `/api/cot-ov-retorno` **deste**
  portal quando o Caso começar com `COT-MSB-` (com a `COT_OV_CHAVE` desta
  Static Web App); até lá a OV entra à mão no cartão.
- **Empresa MSB** em tudo (a da BIO era fixa BIO): o cliente (`cot-erp`), a OV
  (`cot-ov`, prefixo `OVMSB` — `COT_OV_PREFIXO` troca; aceita OV + letras +
  números) e o lote (`cot-lotes`) são procurados na empresa `msb` do Dynamics
  (`ESTOQUE_MSB_EMPRESA`, a mesma do `/api/pedido-lotes`). O CNPJ da MSB, para
  a IA nunca o ler como cliente, vai em `COT_CNPJS_PROPRIOS` (opcional).
- **Unidade de negócio fixa MSB** (`UNIDADE_MSB`/`comEscopo` no motor; até
  05/11/2026 era VENDA RECORRENTE — a cotação que ficou assim é lida como MSB e
  regravada como MSB na próxima ação): no completo cada um vê só as cotações da
  sua unidade no RLS do Power BI, mas o RLS põe a gente da MSB na unidade
  "MSB", que o `pbi-unidades` esconde. Aqui quem tem a área Comercial (o mesmo
  porteiro do completo, `exigirEquipe`) vê todas as cotações da MSB
  (`veCaso`). No `BMCRM` a unidade MSB é a do único submódulo. Configurações:
  só o dono, as duas contas (`DONOS`).
- **Proposta no modelo da MSB (05/11/2026, pedido do dono)** —
  `cotacoes-proposta.js` refeito no layout do PDF "ACE-MSB · Gestão Comercial"
  que o dono mandou: A4, o logo da MSB (`assets/proposta-msb-logo.png`, tirado
  do próprio PDF) com "MEDICAL SYSTEM DO BRASIL", Data de criação / Número de
  Proposta / Data de Validade à direita (+ a cotação do portal), "PROPOSTA
  COMERCIAL", os rótulos em caixa alta (Preparado por · Nome completo /
  E-mail · Razão social / CNPJ · Endereço principal), a tabela Código
  (monoespaçado) · Produto · Fabricante · Qtd. · Vlr. Venda · Subtotal sem
  fundo e com linhas finas, Subtotal / Valor Total à direita, condição e prazo
  à esquerda e "Esta proposta é válida até … · MSB Medical System do Brasil ·
  www.msbbrasil.com" no rodapé. Com tudo o que a proposta do portal já levava:
  telefones (de quem prepara e do contato), cidade/UF/CEP, dados do
  faturamento (A faturar), RMS e lote embaixo do produto, a unidade na
  quantidade, a coluna de IPI com o IPI somado e o total com IPI, frete e
  observação; várias páginas repetem o cabeçalho da tabela e numeram as
  páginas. A Helvetica do jsPDF é mais larga que a Segoe UI do modelo: a
  tabela usa 8,5 pt (`TB`) para quebrar as descrições nas mesmas linhas. O
  e-mail da proposta fala em MSB. As imagens do timbrado da Biomedical
  (`assets/proposta-topo.jpg`/`-rodape.jpg`) saíram. O contato de setor da
  Venda Recorrente da BIO (`CONTATO_SETOR` em `cotacoes-base.js`) saiu: a
  proposta sai com o e-mail e o telefone de quem está logado. A área do PI vai
  como `PEDIDOINTELIGENTE (MSB)`.
- **Nome, Fabricante e RMS do item (05/11/2026, pedido do dono)** — o
  Fabricante, o RMS e a descrição da proposta vêm do Salesforce (Product2 pelo
  código — `api/shared/cot-produtos.js`). Ajustes: (1) o `/api/cot-casos`
  responde as consultas de cadastro (`?produtos=`, `?cliente=`,
  `?codigoCliente=`) ANTES de olhar o armazenamento — sem o
  `COT_MSB_BLOB_URL` elas voltavam vazias; (2) o código conferido com a
  descrição vazia ganha o nome do cadastro do Power BI (`conferirItens`), na
  Nova oportunidade e na edição da Gestão; (3) se o Salesforce não responder,
  embaixo do item aparece o motivo ("Fabricante e RMS não vieram: …" —
  `COT.sfMotivo`); (4) o PDF nunca sai sem o nome: descrição do Salesforce →
  a do item → o nome do Power BI. Sem `SF_CLIENT_ID`/`SF_CLIENT_SECRET` na
  Static Web App da MSB, o Fabricante e o RMS não vêm — copie as do portal da
  BIO.
- **"Abrir Pedido no PI", na mesma aba (05/11/2026, pedido do dono)** — o botão
  do cartão Pedido se chama "Abrir Pedido no PI" (antes "Abrir no PI · Pedido"
  / "Abrir no PI de novo") e o PI · Pedido abre NESTA aba, sem guia nova
  (`abrirNoPI` em `cotacoes-base.js`: marca a oportunidade "aberta no PI" e só
  então troca a página). Anexar o PDF do pedido — no cartão ("Anexar o PDF do
  pedido"/"Trocar o PDF") ou no "Virou pedido" com PDF — também leva ao PI
  depois de registrar (com a leitura pronta; se a leitura falhar, o PI lê o
  PDF). O PI da MSB segue só do dono (ver "PI · Pedido de volta"; liberado
  para o Comercial em 11/11 — ver "PI · Pedido liberado").
- **Sem a coluna Un (05/11/2026, pedido do dono)** — saiu a coluna da unidade
  das tabelas de itens (Nova oportunidade, edição e leitura na Gestão). A
  unidade que a leitura do PDF trouxer fica no item e sai na proposta ao lado
  da quantidade ("30 UN", como no modelo; sem unidade, "UN").
- **"Código do produto" (05/11/2026, pedido do dono)** — no CRM o "Cód.
  Biomedical" virou "Código do produto": cabeçalho dos itens (Nova
  oportunidade e edição na Gestão), o exemplo do campo ("Código") e as
  mensagens (código que não é produto nosso, lote sem código).
- **Sem a fase A faturar (05/11/2026, pedido do dono)** — na MSB as fases são
  Cotada → Ganha / Perdida (e as da Amostra). Saíram a fase (`FASES` do
  `cot-motor.js` e do `cotacoes-base.js`), o cartão de KPI, o filtro, a coluna
  do Quadro, a faixa do Funil, o passo no caminho da oportunidade e o cartão
  "paciente e lote". A cotação que estava em A faturar é lida como Cotada
  (`FASE_ANTIGA`, nos dois lados); os dados de paciente/lote que ela tenha
  ficam guardados no caso, sem tela, e ainda saem na proposta.
- **Estoque da venda (05/11/2026, pedido do dono)** — ao digitar o código (ou a
  quantidade) dos itens, o painel "Estoque da venda" embaixo dos Itens cotados,
  na Nova oportunidade e na oportunidade em andamento (lendo e editando): o
  **mesmo estoque do PI · Pedido da MSB** (`/api/pedido-lotes` — Dynamics,
  empresa `msb`, depósito ALMOX-PA inteiro, a Quantidade física
  disponível). Agrupa pelo código: Pedido × Temos × Falta e a Situação
  (completo, parcial, sem estoque, sem consulta); verde quando tem tudo,
  âmbar quando falta. `estoqueDe`/`htmlEstoque`/`pintarEstoque` em
  `cotacoes-base.js` (cache de 2 min por código), estilos `.cot-est*` no
  `cotacoes.css`. Nada é gravado: é consulta na hora.
- **Códigos no Power BI**: como no PI, o código que some com o recorte MSB do
  `pbi-throttle.js` é procurado de novo com `REMOVEFILTERS('Empresas')` (só
  código e nome) — `validarCodigos` em `cotacoes-base.js`.
- **Menu e acesso** (`nav-sidebar.js`): o bloco `BMCRM` do completo com um
  submódulo só (`SUBS` = Venda Recorrente; sem `?sub=` a aba fica nele);
  `NAV.comercial` ganhou CRM › Venda Recorrente; as `comercial-cot-*` saíram do
  gate do dono (`restrito()`) e abrem para o Comercial. Cartão na visão geral
  (`pages/comercial.html`), na busca (`MSB_VISIVEIS` do `portal-catalogo.js`),
  no guia (`script.js`) e na home (`index.html`).
- O botão de mandar o pedido ao **PI · Pedido** leva a uma página que, na MSB,
  ainda é só do dono (ver "PI · Pedido de volta"): para a equipe, abrir o PI.
  (11/11: aberto — ver "PI · Pedido liberado".)
- `nav-sidebar.js?v=82` (a `v=79` foi a da poda do PI, da master), `customer-service.css?v=4`,
  `licitacao-funil-vendas.css?v=19` em todas as páginas; `sw.js` — cache
  `bm-comest-v16`.
- Teste local: o `cot-teste-server.js` do completo, copiado para `.claude/`
  com `COT_MSB_BLOB_URL` e os exemplos em `COT-MSB-…`:
  `node .claude/cot-teste-server.js 4260` (ou `--vazio`, `--sem-blob`).

### Identidade visual MSB (20/10/2026)

O portal usa a marca da **MSB · Medical System do Brasil** (msbbrasil.com), não
a da Biomedical:

- **Cores** — a família azul/navy da Biomedical virou o teal da MSB
  (`#56A4BB`, o do logo). A troca foi feita por `scripts/msb-cores.js`: muda o
  matiz para o teal, reduz a saturação e **mantém a luminância** de cada cor, para
  nenhum contraste mudar (o primário `#1A66D2` virou `#2C7288`, o navy
  `#0A2E5C` virou `#10323E`). Verde, âmbar, vermelho, violeta e índigo (status
  e categorias) ficaram. Nas paletas de categoria em que o azul e um teal antigo
  ficariam iguais (status das Cotações, histórico, Calendário Cirúrgico, Análise
  de Pedidos), o teal antigo virou azul (`#2B6CC4`). Tema escuro:
  `NAVY_H = 198` em `portal-tema.js` (petróleo, não navy).
- **Fonte** — Roboto (a do site da MSB) no lugar de Outfit, Manrope, Plus
  Jakarta Sans e Inter; JetBrains Mono continua nos números/códigos.
- **Logo e ícones** — `icons/logo-msb.png` (logo horizontal, teal, fundo
  transparente; em fundo escuro vira branco com `filter: brightness(0) invert(1)`),
  `logo-msb-branco.png`,
  `icon-192/512`, `apple-touch-icon` e `favicon.ico` com o "mSb" branco no teal.
  Gerados a partir do logo do site (`logo-msb-2.png`).
- **Nomes** — "Portal MSB" (título da home, PWA, manifest); as abas terminam em
  "· MSB"; rodapés "© MSB · Medical System do Brasil".
- **Login** — logo da MSB, "Tudo da MSB em um só lugar."; o BioNiko (mascote da
  Biomedical) está desligado (`MASCOTE = false` em `auth.js`) e fica o brilho em CSS.
- **Rodapé** — links do msbbrasil.com (institucional, contato, produtos,
  Instagram, LinkedIn). O site não publica telefones, então não há "Unidades".
- `sw.js` — cache `bm-comest-v3`, para o navegador não servir o visual antigo.

**Continua Biomedical, de propósito:** o
"Cód. Biomedical" dos produtos (fora do CRM, que diz "Código do produto"), os atalhos de sistemas compartilhados (Salesforce,
SharePoint BioPortal, Zendesk, e-mails @biomedical), as pastas de materiais de
marketing e o texto do Sales Playbook.

### Tela dividida (05/11/2026)

Pedido do dono: "quando eu divido a tela tá com problema na responsividade".
Com a janela entre 641 e 980px (meia tela num monitor Full HD) o menu lateral
quebrava: o cartão "Comercial · Departamento" ocupava a altura toda e a
navegação ia para uma segunda coluna, cortada atrás do conteúdo.

- **Causa** (`styles.css`): a regra antiga da "barra horizontal de tablet"
  (`@media (641px–980px)`: `.sb-card { flex-wrap: wrap }`,
  `.sb-head { flex: 1 1 100% }`) continuava valendo dentro do shell novo, em
  que a sidebar é uma coluna de altura inteira. O bloco `body.dshell` agora
  desfaz o wrap, o centro e o gap do cartão e o flex do cabeçalho.
- **Recolhe sozinho** (`nav-sidebar.js`): abaixo de 1100px a sidebar começa
  recolhida (84px, só ícones) e o conteúdo ganha o espaço; ao dividir/juntar a
  tela com a página aberta ela se ajusta na hora. Cada largura guarda a sua
  escolha (`bm-sidebar-expanded-v1` na larga, `bm-sidebar-expanded-estreita-v1`
  na estreita): abrir o menu na meia tela não muda a tela cheia.
- **Drawer do celular** (< 768px): ia só até o fim dos itens (o
  `align-self: start` da sidebar do desktop encolhia o `position: fixed`);
  agora vai de cima a baixo, com "Voltar ao portal" e a pessoa no rodapé.
- `styles.css?v=15` e `nav-sidebar.js?v=83` em todas as páginas; `sw.js` —
  cache `bm-comest-v17`.

### Análise de Pedidos · campo Operação (06/11/2026)

- **➕ Campos** da "Tabela analítica de pedidos" (`pages/comercial-clientes.html`)
  ganhou **Operação** — `'Operações'[Operação]`, logo depois de Unidade de
  Negócio. Como os outros campos, entra também como filtro na barra.
- `sw.js` — cache `bm-comest-v18`.

### Coluna Status de liberação (06/11/2026)

O filtro **Status da Liberação** da Análise de Pedidos dava
`HTTP 400 · DatasetExecuteQueriesError`: o portal pedia
`Pedidos[Status da liberação]`, mas no modelo a coluna é
**`'Pedidos'[Status de liberação]`**.

- `pages/comercial-clientes.html` — campo/filtro com o nome certo (rótulo
  "Status de Liberação").
- `sr-diario.js` — a ficha do pedido (Visão Geral › Diário) usava o mesmo nome
  errado; por isso o status da liberação nunca aparecia ali (a consulta voltava
  sem a coluna). `sr-diario.js?v=4`.
- `sw.js` — cache `bm-comest-v19`.

### Análise de Vendas · filtro Operação (06/11/2026)

- A barra de filtros da **Análise de Vendas** (`pages/comercial-vendas.html`)
  ganhou **Operação** (`'Operações'[Operação]`), logo depois de Unidade de
  Negócio. Vale para a página toda, como os outros.
- A lista do filtro traz só as operações que **geram fatura a receber**: a
  página já filtra `'Operações'[Gera Fatura a receber?] = "SIM"`, então escolher
  outra zeraria tudo. (`valoresCom` na entrada de `FILTROS`.)
- A Meta (Sales Vertical) não muda com o filtro — igual a Cliente ou Produto.
- `sw.js` — cache `bm-comest-v20`.

### Sales Report · Faturamento do Dia, só do dono (06/11/2026)

Pedido do dono: "uma aba oculta para todo mundo menos para mim no Comercial,
para visualizar o faturamento no momento em que abrir a tela" — as notas da
**MSB** faturadas **hoje**, **venda e devolução**, ao vivo do Dynamics, pela
entidade de documento fiscal, com a inteligência das Faturas em Aberto da
Cobrança Automática do portal completo.

- **Página** `pages/comercial-faturamento-hoje.html` — aba "Faturamento do Dia"
  no fim das abas do Sales Report e no menu. Abre já lendo o dia de hoje
  (Brasília): Vendas, Devoluções, Faturamento líquido e Notas no dia; tabela
  das notas (tipo, número/série, cliente com conta e CNPJ, valor), filtro
  Todas/Vendas/Devoluções e busca. Outro dia pelo seletor; o dia de hoje se
  atualiza sozinho a cada 5 min (com a aba visível) e em "Atualizar".
- **Só do dono**: as mesmas duas contas do PI · Pedido — `SO_DONO` no
  `nav-sidebar.js` (para os outros a aba some do Sales Report e do menu, e
  abrir o endereço dá "Módulo indisponível") e `DONOS` no
  `api/faturamento-hoje/index.js` (token validado obrigatório; outro e-mail é
  403). Fica fora da busca da home (não está no `MSB_VISIVEIS`).
- **API** `GET /api/faturamento-hoje[?data=AAAA-MM-DD][&atualizar=1][&diag=1]`,
  motor em `api/shared/faturamento-dia.js` (só leitura no Dynamics):
  - fonte **FiscalDocuments** — o nome público (OData) da
    FiscalDocumentHeaderEntity no F&O da Biomedical. Venda = documento de
    saída para cliente; devolução = documento de entrada de cliente. Nota de
    fornecedor (compra) fica fora; cancelada/denegada aparece riscada e fora
    da soma. Só `dataAreaId eq 'msb'`.
  - **a inteligência das Faturas em Aberto** (`cobranca-d365.js` do completo):
    entidade e colunas descobertas na hora pela linha de amostra, aceitas só
    se tiverem o que o papel exige; prazo em cada ida ao F&O; diagnóstico na
    resposta (`?diag=1` traz as colunas). Tudo fixável por env
    (`FATDIA_ENT_FISCAL`, `FATDIA_ENT_DIARIO`, `FATDIA_ENT_CLIENTES`,
    `FATDIA_COL_DATA`, `FATDIA_COL_VALOR`, `FATDIA_COL_DIRECAO`,
    `FATDIA_EMPRESA`).
  - **conferência pelo diário** (`SalesInvoiceHeadersV2`, CustInvoiceJour),
    lido junto. Em 15/10/2026 o portal completo achou a FiscalDocuments (OData)
    sem nota da MSB depois de 05/12/2023: se ela vier vazia e o diário trouxer
    notas, a tela mostra o diário e diz por quê, com a data da última nota da
    MSB na FiscalDocuments. Valor negativo no diário = devolução.
  - razão social/CNPJ pela `CustomersV3`; cache de 1 min por dia.
- Testes com o Dynamics simulado: `node scripts/test-faturamento-dia.js`.
- `nav-sidebar.js?v=84` em todas as páginas; `sw.js` — cache `bm-comest-v21`.

### Área Kanban · Ordens do Dia (06/11/2026)

Pedido do dono: "crie uma área chamada KANBAN e conecte as ordens de venda
(BIOSalesOrderHeaderV1, SalesOrderHeaderV3…); traga as ordens de venda do dia;
depois vou triar o que cada status significa; integração realtime".

- **Área nova `kanban`**, RESERVADA às duas contas do dono (e a quem tem acesso
  full), como o Vendedor/Gerencial em construção: `ALL_AREAS`,
  `AREAS_RESERVADAS` e `EMAIL_AREAS` (ia@) em `api/shared/auth.js`; `NAV.kanban`,
  `DEPT_ICON`, `AREAS` e o mapa de páginas no `nav-sidebar.js`; `AREAS_IDS` no
  `area-access.js` e no `index.html`; cartão "Kanban" na home (o
  `area-access.js` esconde de quem não tem a área); busca (`portal-catalogo.js`,
  filtrada pela área). Abrir para a equipe = tirar `kanban` de
  `AREAS_RESERVADAS` e mapear os grupos em `GRUPO_AREAS`.
- **Página** `pages/kanban.html` (Ordens do Dia): as OVs da MSB **criadas no
  dia** (Brasília), uma coluna por **valor cru** da coluna de status escolhida em
  "Agrupar por" (todas as colunas com cara de status das entidades lidas; a
  escolha fica no navegador). Cartão: OV, cliente, OC, depósito, hora de
  criação, itens e valor; coluna com a soma. Visão Lista. Clicar na OV abre o
  painel com **todos os status** e **todos os campos crus** de cada entidade —
  o material para definir o significado de cada status.
- **Tempo real**: o dia de hoje relê o Dynamics a cada **30 s** com a aba
  visível (cache de 15 s no servidor; "Atualizar" ignora o cache). OV nova
  ganha o selo "nova" e OV que mudou de status pisca.
- **API** `GET /api/kanban-ov[?data=AAAA-MM-DD][&atualizar=1][&diag=1]`
  (`requireArea('kanban')`), motor em `api/shared/kanban-ov.js`, só leitura:
  - cabeçalho em DUAS fontes juntas pelo número da OV: a **principal** é a
    candidata com número da OV, data de criação e `dataAreaId` (só `msb`); as
    outras que respondem entram como **complemento**. Candidatas:
    `KANBAN_ENT_OV` (env), `BIOSalesOrderHeaderV1` (e variações do nome
    público), `SalesOrderHeadersV3`, `SalesOrderHeadersV2`, `SalesOrderHeaders`
    e o que o service document publicar com "salesorderheader" no nome;
  - valor e itens pelas linhas (`SalesOrderLines`, soma de `LineAmount`);
  - mesma inteligência das Faturas em Aberto: entidade/coluna descobertas pela
    amostra, prazo por ida ao F&O, diagnóstico na resposta (`?diag=1` traz as
    colunas). Envs: `KANBAN_ENT_OV`, `KANBAN_ENT_LINHAS`, `KANBAN_COL_NUMERO`,
    `KANBAN_COL_CRIADA`, `KANBAN_STATUS_PADRAO` (ex.:
    `BIOSalesOrderHeaderV1.StatusPedido`), `KANBAN_EMPRESA`, `KANBAN_TTL_MS`.
- Testes com o Dynamics simulado: `node scripts/test-kanban-ov.js`.
- `nav-sidebar.js?v=85` em todas as páginas; `area-access.js?v=21` e
  `portal-catalogo.js?v=21`; `sw.js` — cache `bm-comest-v22`.

### Faturamento do Dia · só as operações de faturamento (06/11/2026)

Pedido do dono: no Faturamento do Dia contam **só** estes tipos de operação
(`OperationDescription` da nota); no Kanban continuam **todas** as ordens.

| OperationDescription | Conta como |
|---|---|
| Venda de produção do estabelecimento | Venda |
| Venda de produção do estabelecimento, destinada a não contribuinte | Venda |
| Venda prod estab remet ant consignação mercantil | Venda |
| Dev venda merc adquirida ou receb terceiros | Devolução |

- A operação decide venda/devolução (antes era a direção da nota). Qualquer
  outra (remessa em consignação, bonificação, compra…) fica **fora da soma** e
  a tela mostra quantas e quais (`foraPorOperacao` na resposta).
- Lista trocável sem deploy: `FATDIA_OP_VENDA` / `FATDIA_OP_DEVOLUCAO`
  (separadas por `;`); a coluna, por `FATDIA_COL_OPERACAO`.
- `sw.js` — cache `bm-comest-v23`.
- **07/11/2026 — regra ESTRITA** (a nota 000021466 entrou sem ser de nenhuma
  das operações): a descrição tem que ser **igual** a um item da lista (só
  maiúsculas, acentos, pontuação e espaços são ignorados) — a 1ª versão
  aceitava "começa com", e "Venda de produção do estabelecimento" engolia
  outras operações que começam igual. Nota **sem** OperationDescription não
  conta mais (antes caía na regra da direção da nota): fica fora como
  "(sem tipo de operação)". Notas do diário de faturas recebem a operação da
  FiscalDocuments pelo número da nota; sem ela, ficam fora. O diagnóstico da
  tela lista cada nota que ficou fora da soma e a operação dela
  (`foraNotas`). `sw.js` — cache `bm-comest-v24`.

### Kanban e Faturamento do Dia ocultos (07/11/2026)

Pedido do dono: "oculte o kanban e o faturamento diário". Nada foi apagado —
as duas páginas e as APIs continuam, **só pelo endereço direto** e **só para
as duas contas do dono**:

- **Faturamento do Dia** (`pages/comercial-faturamento-hoje.html`): saiu das
  abas das 6 páginas do Sales Report e do `NAV.comercial`. O gate `SO_DONO` e o
  `DONOS` da API continuam.
- **Kanban** (`pages/kanban.html`): saiu o cartão da home e a linha da busca
  (`portal-catalogo.js`). A área entrou na `RESERVA_ESTRITA` (como Compras):
  nem quem tem acesso full entra — só as contas do dono. O `NAV.kanban` fica (é
  o menu lateral dentro da página).
- Para mostrar de novo: recolocar a aba/o item do menu (Faturamento) e o
  cartão/a linha da busca (Kanban); para abrir o Kanban ao acesso full, tirar
  `kanban` da `RESERVA_ESTRITA`.
- `nav-sidebar.js?v=86`, `portal-catalogo.js?v=22`; `sw.js` — cache
  `bm-comest-v25`.

### Kanban em 4 colunas + faturamento líquido no banner (07/11/2026)

**Kanban** — pedido do dono: "quando a ordem entra no sistema ela entra como
Criada, depois vai para Gerenciamento de Crédito, Liberado e Faturado; deixa
esses 4 quadrados apenas". O "Agrupar por" saiu; a etapa é calculada no
servidor (`etapaDe` em `api/shared/kanban-ov.js`) pelos campos da OV:

| Ordem | Regra | Coluna |
|---|---|---|
| 1 | `SalesStatus` diferente de "Ordem em aberto" (faturado, entregue…) | Faturado |
| 2 | `CredManInCreditControl` marcado | Gerenciamento de Crédito |
| 3 | `ReleaseStatus` = Liberado | Liberado |
| 4 | o resto | Criada |

- Ajuste na ordem que o dono falou: OV faturada também está liberada (a
  OV017517: Faturado + Liberado), então "Liberado" só vale para a ordem ainda
  em aberto — senão nada chegaria em Faturado.
- Cancelada não é faturamento: fica fora do quadro, com aviso da quantidade.
- Aceita o valor do OData (Backorder, Released, Yes) e o rótulo em português
  (Ordem em aberto, Liberado, Sim). Colunas trocáveis: `KANBAN_COL_SALESSTATUS`,
  `KANBAN_COL_RELEASE`, `KANBAN_COL_CREDITO`. A Lista e o painel da OV mostram
  os três campos e de qual entidade vieram.

**Banner do Comercial** — pedido do dono: "coloque aqui o valor do
faturamento diário, líquido, somente para mim". `pages/comercial.html` ganhou
o selo "Faturamento hoje · R$ … líquido" (vendas − devoluções, só as
operações de faturamento; o mesmo número do Faturamento do Dia, que o selo
abre), relido a cada 5 min. Só as contas do dono: o gate é o `SO_DONO` do
`nav-sidebar.js` — para os outros o selo não nasce e a API nem é chamada.

- `sw.js` — cache `bm-comest-v26`.

### Faturamento do Dia · todas as notas por tipo de operação (07/11/2026)

Pedido do dono, para conferir o líquido (e porque, depois da regra estrita,
"não veio nada"): a página ganhou o quadro **"Todas as notas do dia por tipo de
operação"** — cada OperationDescription do dia com quantidade, valor e se conta
como Venda, Devolução ou fica Fora (inclusive "(sem tipo de operação)"). Vem em
`porOperacao` na resposta; `foraNotas` passou a trazer o valor de cada nota fora
da soma. `sw.js` — cache `bm-comest-v27`.

### Faturamento do Dia · de volta sem os tipos de operação (07/11/2026)

Com a regra das operações o Faturamento do Dia zerou, e o print do dono mostrou
o porquê: "Última nota da MSB na FiscalDocuments: 05/12/2023" — a
FiscalDocuments (OData) segue sem nota da MSB desde 2023 (o mesmo que o
portal completo achou em 15/10/2026), então os valores vêm do **diário de
faturas** (`SalesInvoiceHeadersV2`), que não tem OperationDescription; com a
regra estrita todas as notas ficavam fora. Pedido do dono: "volta como estava
antes, ignora aqueles tipos de operação". `api/shared/faturamento-dia.js`,
`pages/comercial-faturamento-hoje.html` e `scripts/test-faturamento-dia.js`
voltaram à versão de `5f1ca37` (venda/devolução pela direção na fiscal e pelo
sinal do valor no diário). As seções acima sobre as operações ("só as
operações de faturamento", "regra estrita", "por tipo de operação") ficam
como histórico — nada daquilo está mais no código. `sw.js` — cache
`bm-comest-v28`.

### Tipo de operação de cada nota (09/11/2026)

Pedido do dono: "traga as notas fiscais e o tipo de operação de cada uma". Daqui
não se alcança o Dynamics, e no próprio D365 a operação das notas de 2026 não
tem fonte conhecida (o diário não tem; a FiscalDocuments parou na MSB em
2023). Duas frentes:

- **Base de Notas Fiscais** (`pages/comercial-base-notas-fiscais.html`, Power
  BI): coluna **Operação** (`'Operações'[Operação]`) ao lado da Classificação, e
  filtro "Operação" na barra. Vale o que o modelo tiver (a nota de hoje só
  depois da atualização).
- **Sonda no D365** (`api/shared/fatdia-sonda.js`, `GET
  /api/faturamento-hoje?sondar=1`, só do dono): testa as entidades de
  nota/fatura conhecidas e as que o service document publicar com
  invoice/fiscal/cfop/nfe/operation no nome; em cada uma, as colunas com cara de
  operação e a linha mais recente da MSB. "Serve" = coluna de operação
  preenchida numa nota de 2026. Na página do Faturamento do Dia, quadro "Tipo
  de operação no Dynamics": "Procurar no Dynamics" e "Copiar resultado" (o dono
  manda o resultado e a entidade que servir é ligada ao Faturamento do Dia).
  Testes: `node scripts/test-fatdia-sonda.js`.
- `sw.js` — cache `bm-comest-v29`.

### Kanban · ficha da OV no molde do Sales Report (09/11/2026)

Pedido do dono: "no kanban, melhore o modal à direita, se baseie muito no
salesreport, pedido em andamento". O painel que abria com a lista de campos
crus virou a **ficha da OV**, no mesmo desenho da ficha de pedido em andamento
do Sales Report (`sr-diario.css`/`.sd-dw`), com prefixo próprio (`.kb-dw`) no
`<style>` de `pages/kanban.html`:

- **Cabeçalho**: "Ordem de venda · etapa", nº da OV, cliente · conta ·
  cidade/UF, selo da etapa na cor da coluna, "nova"/"mudou de etapa",
  depósito, OC e pool; ‹ › andam pelas OVs na ordem do quadro (coluna a
  coluna; na Lista, a lista) e as setas do teclado também; Esc fecha e o foco
  volta ao cartão. Rodapé com **Copiar nº** e "lido às · n de N".
- **Números-chave**: valor da OV (itens e % do valor do dia), hora de criação
  ("há 47 min") e entrega solicitada (avisa quando já passou).
- **Onde está o pedido**: as 4 etapas do quadro como linha do tempo (Criada →
  Gerenciamento de Crédito → Liberado → Faturado → entrega solicitada), cada
  uma explicada pelo valor do campo que a decide; cancelada aparece como tal.
- **Por que está em <etapa>**: os três campos da regra (situação, liberação,
  crédito) em português, com o valor cru e a coluna, e o que decidiu marcado;
  "não veio" quando o Dynamics não trouxe o campo.
- **Linhas da OV**: produto, código, quantidade × preço, desconto, status e
  entrega de cada linha, agrupadas por status quando há mais de um — lidas
  **só quando a ficha abre**: `GET /api/kanban-ov?ov=OV017525`
  (`linhasDaOv` em `api/shared/kanban-ov.js`, `SalesOrderLines` sem
  `$select`, só `msb`, cache de 15 s). O quadro, que relê a cada 30 s,
  continua pedindo só o valor das linhas.
- **Dados do pedido** com nome de gente (criado por, atendente, conta, OC,
  site, depósito, modo de entrega, condição de pagamento, endereço de
  entrega…), tirados dos campos crus de todas as entidades.
- Recolhidos: **Campos do Dynamics** (status lidos + todos os campos de cada
  entidade, com filtro — o material para triar os status) e **Como a etapa é
  decidida**. A releitura de 30 s repinta a ficha aberta sem fechar o que está
  aberto nem pular o scroll; OV que mudou de etapa relê as linhas.
- Testes: `node scripts/test-kanban-ov.js` (linhas de uma OV e `?ov=`
  inválido). `sw.js` — cache `bm-comest-v30`.

### Faturamento do Dia · tipo de operação pela OV (09/11/2026)

Pedido do dono: "nessa entidade não tem tipo de operação? caso não tiver, puxe
das sales order com base na OV". Só para **mostrar** (não filtra nem muda
valor — a regra das operações saiu em 07/11):

- O diário de faturas (`SalesInvoiceHeadersV2`) ganhou o campo `natureza`
  (OperationDescription, SalesPurchOperationType_BR, OperationType, CFOP… ou o
  que tiver cara de operação; `FATDIA_COL_OPERACAO_DIARIO` fixa). Se a nota
  trouxer, vale a da nota.
- Sem ela, a operação vem da **ordem de venda** da nota (a coluna OV):
  `operacoesDasOvs()` em `api/shared/kanban-ov.js` reaproveita a descoberta das
  entidades de OV do Kanban (BIOSalesOrderHeaderV1, SalesOrderHeadersV3/V2…),
  pega as colunas com cara de tipo de operação e lê pelos números das OVs (só
  a MSB). A tela mostra na coluna "Operação", com "pela OV" embaixo; a origem
  vai em `operacaoFonte` e o resumo em `operacaoOv` (diagnóstico).
- Se nem as entidades de OV tiverem a coluna, a tela avisa e pede a sonda
  ("Procurar no Dynamics").
- `sw.js` — cache `bm-comest-v31` (o v30 ficou com a ficha da OV do Kanban, de outra sessão no mesmo dia).

### Faturamento do Dia · o dado cru de cada nota (09/11/2026)

O dono achou a **000021098** como "Devolução −R$ 5.999,40" no portal, e no D365
ela é uma venda de R$ 18.000,00 (300 × R$ 60,00). Daqui não se vê o Dynamics,
então antes de mexer na regra o portal passou a mostrar o dado cru: **clicar
numa nota** abre um painel com tudo o que o D365 devolve para aquele número na
MSB — os registros do diário de faturas (o que a lista usa: TotalInvoiceAmount
& cia.), as linhas da fatura (`SalesInvoiceLines`, com a soma do LineAmount) e o
documento fiscal —, com "Copiar". `GET /api/faturamento-hoje?nota=…` (só do
dono), `detalheNota()` em `api/shared/faturamento-dia.js`. `sw.js` — cache
`bm-comest-v32` (junção com a ficha da OV do Kanban, que entrou no master por
outra sessão).

### Kanban · só o ALMOX-PA e a coluna Logística (09/11/2026)

Pedidos do dono: "depósito somente o que for ALMOX-PA, não precisa do
restante" e "troque esse nome de LIBERADO para LOGÍSTICA".

- **Só o depósito ALMOX-PA** (`api/shared/kanban-ov.js`): pelo depósito do
  cabeçalho da OV (`DefaultShippingWarehouseId`…), a OV de outro depósito — ou
  sem depósito — sai do quadro ANTES de contar status, etapas e valores; a
  resposta traz `depositos` e `foraDeposito` (no Diagnóstico da página). Sem
  nenhuma OV com depósito, o quadro fica vazio e vem um aviso. Trocável por
  env: `KANBAN_DEPOSITOS` (lista; `*` = todos). Na tela, o subtítulo diz
  "MSB · ALMOX-PA" e o chip do depósito nos cartões e na ficha só aparece se
  for diferente do filtro (seria igual em todos).
- **Coluna "Liberado" → "Logística"**: só o nome (quadro, lista, ficha e
  avisos); o id segue `liberado` e a regra é a mesma (`ReleaseStatus` =
  Liberado).
- Testes: `node scripts/test-kanban-ov.js` (filtro do depósito e o nome da
  coluna). `sw.js` — cache `bm-comest-v33` (junto com o item abaixo).

### Kanban de volta na home, só para o dono (09/11/2026)

Pedido do dono: "traga a área kanban, porém somente para mim". Desfaz a parte
"oculto" de 07/11 — o acesso continua igual:

- **Cartão "Kanban"** de volta na grade de Departamentos do `index.html`
  (`data-area="kanban"`, "1 módulo") e a área + o módulo **Ordens do Dia** de
  volta no `portal-catalogo.js` (a busca).
- **Só as contas do dono** (`ia@` e `leonardo.barbosa@`): a área segue em
  `AREAS_RESERVADAS` e na `RESERVA_ESTRITA` (`api/shared/auth.js`) — nem quem
  tem acesso full recebe a área no `/api/my-areas`, e o `area-access.js`
  esconde o cartão e tira o Kanban da busca de quem não tem.
- `portal-catalogo.js?v=23` (`index.html` e `script.js`); `sw.js` — cache
  `bm-comest-v33` (as v31/v32 foram da outra sessão, no master).

### Faturamento do Dia · número repetido no diário: vale o registro 1 (09/11/2026)

O painel da 000021098 mostrou **dois** documentos com esse número no diário
de faturas da MSB: a venda de R$ 18.000,00 (07/10, OV017088 — o "registro 1")
e outro de −R$ 5.999,40 (o "registro 2"), que aparecia na lista como
devolução. Decisão do dono: **vale o registro 1**. `originaisDoDiario()` em
`api/shared/faturamento-dia.js`: para as notas do dia, busca no diário todos
os documentos com o mesmo número (qualquer data); o original é o 1º pela data
(empate: a ordem do D365, a mesma do painel). A linha do dia só fica se for o
original; as outras saem da lista e da soma, com aviso ("000021098 de dd/mm
(−R$ 5.999,40); o original é de 07/10 (R$ 18.000,00)") e em `repetidas`.
Falha da consulta mantém tudo. `sw.js` — cache `bm-comest-v34` (o v33 ficou com o Kanban de outra sessão).

### Kanban · Gerenciamento de Crédito pela tabela da Bio (09/11/2026)

Pedido do dono (print do Gerenciamento de dados: entidade **Credit management**,
preparo `BioCredManTableV1Staging`, destino `BioCredManTableV1Entity`):
"gerenciamento de crédito vem dessa tabela, o campo é ACTIVE, a ordem é
SALESID; cruzar com o número da OV do BIOSalesOrderHeader e ver se está ativo".

- **Regra** (`api/shared/kanban-ov.js`): a OV com um registro **ativo** na
  tabela (`ACTIVE` = Sim/Yes/1, pela OV no `SALESID`) vai para
  **Gerenciamento de Crédito**; sem registro, ou só com registro inativo, não
  está no crédito. A tabela vale antes do `CredManInCreditControl` do
  cabeçalho, que fica só de reserva. A ordem das regras não mudou: situação
  fora de "Ordem em aberto" → Faturado vem primeiro.
- **A entidade no OData**: o nome público não se sabe daqui — o motor testa
  `BioCredManTableV1`, `BioCredManTablesV1`, `BioCredManTableV1Entity`… e o que
  o service document publicar com **"credman"** no nome (cache de 30 min; sem
  ela, refaz em 5 min). Colunas pelo nome, sem diferenciar caixa. Lida pelos
  números das OVs do dia, só `msb`, em paralelo com o complemento e as linhas.
- **Sem a entidade no OData** (não pública, ou sem `SALESID`/`ACTIVE`): aviso
  na tela dizendo o porquê (o Diagnóstico mostra as candidatas testadas), e o
  crédito volta ao `CredManInCreditControl` do cabeçalho. Para publicar: a
  entidade precisa de **IsPublic = Sim** e de um nome público no AOT; fixar o
  nome: `KANBAN_ENT_CREDITO` (e `KANBAN_COL_CREDITO_OV` / `KANBAN_COL_CREDITO_ATIVO`
  se as colunas tiverem outro nome).
- **Ficha da OV**: o quadro "Crédito · tabela" mostra **Ativo · retida /
  Inativo / Sem registro** com o `ACTIVE` cru; a linha do tempo e "Dados do
  pedido" falam da tabela; o registro de crédito entra em "Campos do
  Dynamics". Na Lista, a coluna "Crédito" no lugar do CredManInCreditControl.
- Testes: `node scripts/test-kanban-ov.js` (ativo/inativo/sem registro, dois
  registros, a tabela antes do cabeçalho, faturada, tabela fora do OData e sem
  a coluna ACTIVE). `sw.js` — cache `bm-comest-v35`.

### Faturamento do Dia · Exportar Excel (09/11/2026)

Pedido do dono: "coloca um botão de export para Excel para eu fazer uma
validação". Botão **Exportar Excel** na barra (ao lado de Atualizar), com a
mesma biblioteca da Base de Notas Fiscais (SheetJS `xlsx@0.18.5`). O arquivo
`Faturamento_do_Dia_MSB_AAAA-MM-DD.xlsx` traz TODAS as notas do dia (não só o
filtro da tela) em três abas:

- **Notas** — data, tipo, nota, série, cancelada, cliente, conta, CNPJ, OV,
  operação (e de onde veio), status e valor (devolução NEGATIVA), com filtro
  automático e a linha do total líquido (sem canceladas).
- **Fora da soma** — as notas que a regra do registro 1 tirou, com o original
  ao lado (data, valor, OV).
- **Resumo** — vendas, devoluções, líquido, canceladas, número repetido,
  fonte, hora e os avisos.

Junto: a coluna Operação deixou de mostrar **"DoesNotApply"** (o enum "não se
aplica" de uma coluna da OV aparecia como operação em toda nota) — valores
desse tipo contam como vazios. `sw.js` — cache `bm-comest-v36` (o v35 ficou com o crédito do Kanban, de outra sessão).

### Faturamento do Dia · tipo de operação = FiscalDocumentOperationTypeId da OV (09/11/2026)

O dono achou, na ficha da OV do Kanban, o campo do tipo de operação da nota
ligada à OV: **`FiscalDocumentOperationTypeId`** (ex.: "S.LIC.002"). O
Faturamento do Dia já buscava a operação na OV da nota (pelo número da OV,
nas mesmas entidades de OV do Kanban), mas escolhia a 1ª coluna com cara de
operação — e saía o "DoesNotApply" do `FiscalOperationPresenceType`. Agora
`operacoesDasOvs()` (`api/shared/kanban-ov.js`) dá prioridade ao
`FiscalDocumentOperationTypeId` (`KANBAN_COL_OPERACAO` troca a lista); as outras
colunas só valem quando ele não vem. A coluna Operação e o Excel mostram o
código, com "pela OV". `sw.js` — cache `bm-comest-v37`.

### Faturamento do Dia · só os tipos de operação aceitos (09/11/2026)

Decisão do dono: "só posso aceitar esses tipos de OP no faturamento diário":
**S.VEN.006 · E.CON.002 · S.CON.004 · S.LIC.002 · E.VEN.002** — o
`FiscalDocumentOperationTypeId` da OV de cada nota (`OPS_ACEITAS` em
`api/shared/faturamento-dia.js`; `FATDIA_OPS_ACEITAS` troca a lista).

- Nota de outro tipo, ou sem tipo (sem OV / OV sem o campo), fica **fora da
  soma**: aviso com os tipos e quantidades, `foraOperacao` na resposta e a
  aba "Fora da soma" do Excel (com o motivo).
- **Não zera por erro de leitura** (o que aconteceu em 07/11): se não der para
  ler o tipo de NENHUMA nota (entidade fora, sem tempo), o filtro NÃO é
  aplicado e a tela avisa em vermelho que os valores incluem todas as notas
  (`filtroOperacao.aplicado = false`).
- Venda/devolução continua pelo sinal do valor (E.* vem negativo).
- As notas que a regra do registro 1 tirou também recebem o tipo de operação
  (aviso e Excel), para o dono ver se são devoluções E.VEN.002.
- Excel: "Fora da soma" com Motivo (tipo não aceito / número repetido) e tipo
  de operação; "Resumo" com os tipos aceitos e se o filtro foi aplicado.
- `sw.js` — cache `bm-comest-v38`.

### Kanban em 6 colunas: Separação, Conferência e Cotação (09/11/2026)

Pedido do dono: "Criada, Gerenciamento de Crédito, Separação (ReleaseStatus =
Released), Conferência, Cotação, Faturado; conferência e cotação irei te mandar
os campos para definição da fase".

- **Separação** é a antiga "Liberado"/"Logística": o id segue `liberado` e a
  regra é a mesma (`ReleaseStatus` = Liberado/Released).
- **Conferência** e **Cotação** entram no quadro (`ETAPAS` em
  `api/shared/kanban-ov.js`, com `pendente: true`) **vazias**, com "aguardando
  os campos da fase", até o dono mandar os campos — nenhuma OV cai nelas por
  enquanto. Quando chegarem: regra em `etapaDe()` e tirar o `pendente`.
- Ordem das regras sem mudança: situação fora de "Ordem em aberto" → Faturado;
  crédito ativo → Gerenciamento de Crédito; liberada → Separação; senão Criada.
- Tela: o quadro tem uma coluna por etapa (`--kb-n`), lado a lado — cabe em
  1440 px; abaixo disso rola na horizontal em vez de quebrar em duas linhas; o
  nome comprido da coluna quebra a linha em vez de cortar. Na ficha, a linha do
  tempo tem as 6 etapas (Conferência e Cotação "a definir").
- Testes: `node scripts/test-kanban-ov.js` (6 colunas na ordem, nomes,
  Conferência/Cotação vazias e pendentes). `sw.js` — cache `bm-comest-v39` (a v38 foi da outra sessão, no master).

### Faturamento do Dia · só nota com status Aprovado (09/11/2026)

Decisão do dono: "o status da nota tem que estar Aprovado" — a 000021478
está "Descartado" na tela Nota fiscal do D365 e aparecia no portal. O diário
não traz esse status; ele mora no documento fiscal / NF-e. Novo
`api/shared/fatdia-status.js`: busca o status **pelo número** em todas as
entidades de documento fiscal / NF-e publicadas (as candidatas
`FiscalDocuments`, `EFDocumentsBR`, `NFeHeadersBR`… + as do service document com
efdoc/nfe/electronic/fiscaldocument no nome), cada uma provada pela amostra
(tem número e status?), só a MSB, em lote. Fica só "Aprovado" (Approved,
Aprovada, Autorizada…); Descartado, Cancelado, Rejeitado e "(sem status)" saem
da soma (`foraStatus`, aviso, Excel "Fora da soma" com o motivo). Mesma
proteção do filtro de operação: se nenhuma nota tiver status lido, o filtro
NÃO é aplicado e o aviso em vermelho diz isso. A sonda "Procurar no Dynamics"
passou a mostrar também as colunas de status (`servemStatus`). Envs:
`FATDIA_ENT_STATUS`, `FATDIA_COL_STATUS`, `FATDIA_COL_STATUS_DIARIO`.
`sw.js` — cache `bm-comest-v40` (o v39 ficou com o Kanban de 6 colunas, de outra sessão).

### Kanban · Separação e Conferência pelo trabalho de depósito (09/11/2026)

Pedido do dono: "Separação será o status do ReleaseStatus e a fase é em
processo; quando sair desse status para fechado ele vai para Conferência" — a
fase é a do **trabalho de depósito** da OV (`WHSWorkTableBiEntity`, o
cabeçalho do trabalho: `WorkStatus` Aberto / Em processo / Fechado / Cancelado).

- **Regra** (`etapaDe()` em `api/shared/kanban-ov.js`), por OV, sem os
  trabalhos cancelados/combinados, ligados pelo nº do pedido (`OrderNum`):
  todos **fechados** → **Conferência**; algum aberto ou **em processo** →
  **Separação** (vale também para a parcialmente liberada); sem trabalho →
  segue o `ReleaseStatus` (Released → Separação). Ordem: Faturado → Crédito →
  Conferência → Separação → Criada. Cotação continua à espera dos campos.
- **A entidade no OData**: descoberta como a de crédito — a descoberta virou
  uma só (`entidadeExtra`, com `CFG_CREDITO` e `CFG_TRABALHO`): candidatas
  (`WHSWorkTableBiEntities`, `WHSWorkTableBiEntity`, `WarehouseWorkHeaders`…) +
  o que o service document publicar com "worktable"/"warehousework". Colunas
  pelo nome, sem caixa (`OrderNum`, `WorkStatus`, `WorkId`, `LockedUser`,
  `WorkInProcessUTCDateTime`, `WorkClosedUTCDateTime`, `WaveId`, `LoadId`,
  `ShipmentId`…). Envs: `KANBAN_ENT_TRABALHO`, `KANBAN_COL_TRABALHO_OV`,
  `KANBAN_COL_TRABALHO_STATUS`. Sem a entidade no OData: aviso na tela, a
  Conferência fica vazia e a Separação segue só o `ReleaseStatus`.
- **Ficha da OV**: quadro "Trabalho no depósito" na regra (Em processo /
  Fechado / Aberto · não iniciado / Sem trabalho, com a contagem), seção
  **Trabalho no depósito** com cada trabalho (nº, status, quem, início, fim,
  duração, onda, carga, remessa) e a linha do tempo dizendo quem está
  separando e quando fechou. O trabalho entra em "Campos do Dynamics" (o
  material para analisar os campos da entidade). Na Lista, a coluna "Trabalho".
- Testes: `node scripts/test-kanban-ov.js` (em processo, fechado, cancelado
  não conta, parcial, sem trabalho, faturada/crédito antes, entidade fora do
  OData). `sw.js` — cache `bm-comest-v41`.

### Kanban · coluna Expedição (09/11/2026)

Pedido do dono: "insira mais um cartão de Expedição". Sétima coluna, **depois
do Faturado** (a mercadoria sai com a nota): Criada → Gerenciamento de Crédito
→ Separação → Conferência → Cotação → Faturado → **Expedição**. Entra como a
Cotação: `pendente: true` em `ETAPAS`, vazia e com "aguardando os campos da
fase" até o dono mandar os campos (aí: regra em `etapaDe()` e tirar o
`pendente`). Na ficha, a linha do tempo tem a Expedição "a definir" depois do
Faturado. O quadro continua cabendo em 1440 px (coluna mínima de 145 px; o
nome comprido quebra com hífen). Testes: 7 colunas na ordem e a Expedição
pendente. `sw.js` — cache `bm-comest-v42`.

### Kanban · sem a linha embaixo do título (09/11/2026)

Pedido do dono: "remova essa escrita" — a linha "MSB · ALMOX-PA · N ordem(ns)
de venda criada(s) em … · R$ … · BioSalesOrderHeadersV1 + … (as entidades
lidas)" saiu de `pages/kanban.html`. As entidades continuam no "Diagnóstico da
leitura no Dynamics", no rodapé; quantidade e valor estão nas colunas.
`sw.js` — cache `bm-comest-v43`.

### Faturamento do Dia · status só de documento com data perto da nota (09/11/2026)

A sonda do dono mostrou que o `Status` da `FiscalDocuments` é o campo certo
(Approved / Cancelled / Discarded…), mas a entidade para na MSB em 05/12/2023.
Como a busca do status é PELO NÚMERO, um documento antigo com o mesmo número
poderia emprestar o status ("Cancelled") para a nota de hoje e tirá-la da
soma. `api/shared/fatdia-status.js` agora lê também a data do documento
(FiscalDocumentDate, AccountingDate…) e o status só vale se ela estiver a até
7 dias da data da nota (`FATDIA_STATUS_DIAS`); fora disso, conta como "não
achado". `sw.js` — cache `bm-comest-v44`.

### Sonda · os nomes das colunas (09/11/2026)

Pedido do dono: "me mostre as colunas dessas duas" (SalesInvoiceHeadersV2 e
SalesInvoiceHeaders, na sonda). A sonda passou a devolver `nomesColunas` de
cada entidade; na tela, clicar no número de colunas abre a lista. (As do
diário também aparecem no painel da nota — todos os campos do registro.)
`sw.js` — cache `bm-comest-v45`.

### Kanban · a carga da OV na ficha (a futura Cotação) (09/11/2026)

Pedido do dono: "na hora da cotação vou integrar com essa entidade de cargas,
WHSOutboundLoadHeaderEntity, e vou definir os status e campos para que esteja
em cotação". Por enquanto **só leitura, sem regra** — a Cotação segue
"aguardando os campos da fase":

- **Ligação**: o cabeçalho da carga não tem a OV; vale o `LoadId` dos
  **trabalhos de depósito** da OV (OV → trabalho → carga). As cargas do dia são
  lidas de uma vez pelos `LoadId`, só `msb`, depois do lote paralelo (e só se
  algum trabalho tiver carga). Descoberta como as outras extras (`CFG_CARGA`:
  candidatas `WHSOutboundLoadHeaderEntities`… + "outboundload"/"loadheader" no
  service document; envs `KANBAN_ENT_CARGA`, `KANBAN_COL_CARGA_ID`,
  `KANBAN_COL_CARGA_STATUS`).
- **Na resposta**: `ovs[].cargas` (`id`, `status` = LoadStatus, transportadora,
  serviço, envio previsto, expedida, depósito, modelo) e `cargaFonte`; o
  registro da carga entra nos campos crus da OV.
- **Na ficha**: seção **Carga** (status em português + o cru, transportadora,
  serviço, datas) e a etapa Cotação da linha do tempo mostra a carga. O
  material para o dono escolher os status/campos; quando chegarem: regra em
  `etapaDe()` e tirar o `pendente` da Cotação.
- **Sem a entidade no OData**: aviso (só quando há carga para procurar); a ficha
  mostra só o número da carga.
- Testes: `node scripts/test-kanban-ov.js` (carga pelo LoadId, uma por OV,
  trabalho sem carga, só leitura, entidade fora do OData, sem LoadId nem
  procura). `sw.js` — cache `bm-comest-v46`.


### Faturamento do Dia liberado para o Comercial (09/11/2026)

Pedido do dono: "libera o faturamento diário para todo mundo". A página
`pages/comercial-faturamento-hoje.html` passa a abrir para quem tem a **área
Comercial**, como as outras abas do Sales Report:

- a aba "Faturamento do Dia" voltou nas 6 páginas do Sales Report, o item
  voltou no `NAV.comercial` e a página entrou na busca da home
  (`portal-catalogo.js`, `MSB_VISIVEIS`);
- `/api/faturamento-hoje` exige `requireArea('comercial')` (era só as contas
  do dono); o painel da nota (`?nota=`) e o Excel valem para todos;
- continuam **só do dono**: a sonda "Procurar no Dynamics" (`?sondar=1` com
  `exigirDono`; o quadro só aparece para ele) e o selo do faturamento no
  banner do Comercial — o gate deles é o id `comercial-faturamento-dono` no
  `SO_DONO` do `nav-sidebar.js` (não é página).
- `nav-sidebar.js?v=87` em todas as páginas, `portal-catalogo.js?v=24`;
  `sw.js` — cache `bm-comest-v47`.

### Kanban liberado para todo mundo (09/11/2026)

Pedido do dono: "libera o kanban para todo mundo". Em `api/shared/auth.js`, a
área `kanban` saiu de `AREAS_RESERVADAS` e de `RESERVA_ESTRITA` e entrou em
`AREAS_ABERTAS` (a lista que estava vazia): qualquer pessoa autenticada do
domínio recebe a área no `/api/my-areas` — quem é só de um grupo (Comercial,
Administrativo…), quem não tem grupo mapeado e o acesso full. Com isso o
cartão "Kanban" da home, a busca, o menu e o `/api/kanban-ov` valem para
todos. Compras segue só do dono. Conferido simulando o Graph (grupo do
Comercial, grupo de outra área, sem grupo, admin: todos veem o Kanban).
`sw.js` — cache `bm-comest-v48` (a v47 foi da outra sessão, no master).

### Kanban · a nota fiscal da OV e a coluna Rejeitada (09/11/2026)

Pedidos do dono: "crie depois de FATURADA um card escrito REJEITADA, caso a NF
seja rejeitada, ou cancelada/descartada" e "preciso saber qual a nota fiscal".

- **As notas da OV**: do **diário de faturas** (`SalesInvoiceHeadersV2`, pelo
  `SalesOrderNumber` — o mesmo do Faturamento do Dia; descoberta `CFG_NOTA`,
  env `KANBAN_ENT_NOTA`), lidas em paralelo com crédito/trabalho/linhas. O
  **status** de cada nota sai do documento fiscal / NF-e **pelo número**,
  reaproveitando `api/shared/fatdia-status.js` (a mesma leitura que tira a nota
  "Descartado" do Faturamento do Dia; status só de documento com data perto da
  nota).
- **Coluna Rejeitada** (logo depois de Faturado): vale a nota **mais recente**
  da OV com status — rejeitada / cancelada / descartada / denegada →
  Rejeitada (antes de qualquer outra regra, menos a OV cancelada, que segue fora
  do quadro). Reemitida e aprovada → volta a valer a regra de sempre (Faturado).
  Ordem das colunas: Criada → Crédito → Separação → Conferência → Cotação →
  Faturado → **Rejeitada** → Expedição.
- **Na tela**: chip **NF 000021470** no cartão (vermelho, com o status, quando
  rejeitada); coluna NF na Lista; na ficha, seção **Nota fiscal** (número,
  emissão, valor, status em português + o cru), o quadro "Nota fiscal" na regra
  e a nota no passo Faturado / "Agora: Rejeitada" da linha do tempo.
- **Sem o diário no OData**: aviso, sem número e sem Rejeitada. **Sem o status
  da nota**: aviso; o número aparece, a Rejeitada fica vazia.
- Quadro com 8 colunas: cabe na tela larga do dono; em 1440 px rola na
  horizontal. Testes: `node scripts/test-kanban-ov.js` (aprovada, rejeitada,
  cancelada, descartada com a OV em aberto, reemitida e aprovada, sem status, OV
  cancelada, sem o status no OData). `sw.js` — cache `bm-comest-v49`.

### Kanban · coluna Pallet (09/11/2026)

Pedido do dono: "um card a mais que vai chamar PALLET, que vem depois do
rejeitado". Nona coluna, entre Rejeitada e Expedição: Criada → Crédito →
Separação → Conferência → Cotação → Faturado → Rejeitada → **Pallet** →
Expedição. Entra como Cotação e Expedição: `pendente: true` em `ETAPAS`, vazia
e com "aguardando os campos da fase" até o dono mandar os campos. Cor nova (a
9ª, madeira) em `TONS`/`TONS_ESC`; na ficha, Pallet "a definir" na linha do
tempo. As 9 colunas cabem na tela larga do dono; em 1440 px o quadro rola na
horizontal. Testes: 9 colunas na ordem e a Pallet pendente. `sw.js` — cache
`bm-comest-v50`.

### Kanban cabe na tela + status da nota pela FiscalDocumentBioEntity (09/11/2026)

Pedidos do dono: "consegue criar um layout para caber tudo na tela? não
precisar ficar arrastando para o lado" e "tá com nota fiscal sem status,
FiscalDocumentBioEntity verifica nessa entidade, porque ela tá aprovada" (a
000021497, "Aprovado" na tela Nota fiscal do D365).

- **Layout** (`pages/kanban.html`): a largura de cada coluna sai do que ela tem
  (`--kb-cols`, montado no `render()`): com OV, uma fração inteira (mín. 112
  px); **vazia, meia fração** (mín. 64 px). Cada coluna é um *container*: em
  coluna estreita (≤ 175 px) o cartão se reorganiza (o cliente desce para a
  linha de baixo, valor à direita, "Gerenciamento de Crédito" vira "Crédito",
  "aguardando os campos da fase" vira "a definir"); coluna vazia bem estreita
  (≤ 110 px) fica **recolhida** — a contagem em cima e o nome na vertical. As 9
  colunas cabem sem rolar de 1280 px a 1920 px (conferido); só abaixo disso o
  quadro rola.
- **Status da nota** (`api/shared/fatdia-status.js`, que serve o Kanban e o
  Faturamento do Dia): a entidade de documento fiscal própria da Bio
  (`FiscalDocumentBioEntities`, `FiscalDocumentBioEntity`… — as variações do
  nome público) vem **primeiro** nas candidatas, e, do service document, os
  nomes com "bio" entram antes dos outros (o corte de 8 extras deixava a da Bio
  de fora). Teste: a 000021497 sem status na `FiscalDocuments` (só um documento
  de 2023 com o mesmo número) sai **Aprovada** pela da Bio — sem a correção, a
  entidade da Bio nem era consultada.
- `sw.js` — cache `bm-comest-v51`.

### Kanban · em aberto de qualquer data + período só nas colunas finais (09/11/2026)

Pedido do dono: "somente aplique o filtro de data para os cards Faturado,
Rejeitado, Pallet e Expedição, um filtro de quando até quando ele quer ver; os
restantes dos cards têm que pegar toda a vida da empresa".

- **Motor** (`quadro()` em `api/shared/kanban-ov.js`; o modo antigo, as OVs
  criadas no dia, segue em `ordensDoDia()` / `?modo=dia`): lê, em paralelo,
  - as OVs **em aberto** (SalesStatus = Ordem em aberto) de **qualquer data** —
    filtro pelo status no OData (`SalesOrderStatus eq
    Microsoft.Dynamics.DataEntities.SalesStatus'Backorder'`; se o F&O recusar, o
    mesmo em texto; se nada passar, as criadas nos últimos `KANBAN_JANELA_DIAS`
    = 365 dias, com aviso) e pelo depósito ALMOX-PA já no filtro;
  - as OVs com **nota no período** (diário de faturas pela `InvoiceDate`, de
    `de` até `ate` inclusive), lidas pelos números.
  Depois da etapa calculada, as colunas **datadas** (Faturado, Rejeitada, Pallet,
  Expedição) só ficam com a OV cuja data — a da nota mais recente; sem nota, a de
  criação — cai no período (`foraPeriodo` conta as que saíram). Para aguentar
  centenas de OVs: as leituras por número vão 2 lotes por vez, o quadro usa só
  os 3 primeiros complementos (`KANBAN_MAX_COMPL`) e o cache é de 45 s
  (`KANBAN_TTL_QUADRO_MS`) — várias pessoas com o quadro aberto viram UMA
  leitura no Dynamics.
- **API**: `GET /api/kanban-ov?de=AAAA-MM-DD&ate=AAAA-MM-DD` (padrão: hoje; no
  máximo 1 ano; `?data=` vale como de = até).
- **Tela**: "Faturados de … até …" com os atalhos **Hoje / 7 dias / Mês** no
  lugar da data única; as colunas datadas mostram o período embaixo do valor;
  o cartão mostra a data de criação quando não é de hoje ("10/03/25"); o quadro
  é sempre ao vivo (a cada 60 s).
- Testes: `node scripts/test-kanban-ov.js` — o simulador do F&O agora avalia o
  `$filter` de verdade (e/ou, enum, intervalos); o quadro: em aberto de 2025,
  faturada e rejeitada dentro/fora do período, cancelada, outro depósito, cache
  por período, de/até trocados, o F&O recusando o enum; a rota (período > 1 ano
  e data inválida → 400). `sw.js` — cache `bm-comest-v52`.

### Kanban · as regras do dono pela carga e pela nota + "Enviar para o Pallet" (09/11/2026)

Pedido do dono (os status de cada coluna):

| Coluna | Regra |
|---|---|
| Separação | status do **trabalho** = "Abrir" |
| Conferência | status da **carga** = "Em processamento" |
| Cotação | carga "Carregado" **e** "Cotação realizada" = Não |
| Faturado | **nota fiscal** "Aprovada" |
| Pallet | botão **Enviar para o Pallet** (carga "Carregado" e cotação realizada = Sim) grava `ENVIARPALLET_CUSTOM` = Sim no D365 |
| Rejeitada | nota "Rejeitado" (e cancelada/descartada, pedido anterior) |
| Expedição | status da carga = "Remetido" |

- **Regra** (`etapaDe()` em `api/shared/kanban-ov.js`), do mais adiantado para o
  menos: Rejeitada → Expedição → Pallet → Faturado → Cotação → Conferência →
  Crédito → Separação → Criada. Onde as regras do dono não falam, as anteriores
  ficam de reserva (OV que saiu do aberto sem status de nota → Faturado; todos os
  trabalhos fechados sem a carga em processamento → Conferência; trabalho em
  processo ou OV liberada sem trabalho → Separação). Carga "Carregado" com a
  cotação já realizada e a nota ainda não aprovada fica em Cotação (com o botão).
  Fase da carga (`faseCarga`): Remetido > Pallet > Carregado+cotação Sim >
  Carregado > Em processamento (e "Em embalagem") > outro; OV com mais de uma
  carga = a **menos** adiantada.
- **Campos da carga** (`WHSOutboundLoadHeaderEntity`, pelo `LoadId` dos
  trabalhos): `LoadStatus`, "Cotação realizada" (`COTACAOREALIZADA_CUSTOM`… ou o
  1º campo com "cota" no nome; env `KANBAN_COL_CARGA_COTACAO`) e
  `ENVIARPALLET_CUSTOM` (env `KANBAN_COL_CARGA_PALLET`). Sem eles: aviso.
- **"Enviar para o Pallet"** — a única **escrita** do Kanban: `POST
  /api/kanban-ov { acao: 'enviar-pallet', carga, ov }` → `enviarParaPallet()`:
  relê a carga **na hora**, confere de novo (Carregado + cotação Sim), e só então
  `PATCH WHSOutboundLoadHeaderEntities(dataAreaId='msb',LoadId='…')?cross-company=true`
  com `ENVIARPALLET_CUSTOM = "Yes"` (booleano/número se a coluna for assim). Já
  enviada = ok sem gravar; fora da condição = 409; carga inexistente = 404. Exige
  o **login validado** e fica no log da Function (quem, carga, OV). Na tela: selo
  "p/ Pallet" no cartão e o cartão "Pronta para o Pallet" na ficha, com
  confirmação; depois de gravar, o quadro relê e a ficha diz "Enviada às HH:MM".
- Testes: `node scripts/test-kanban-ov.js` — cada regra (trabalho Abrir, carga em
  processamento, Carregado com/sem cotação, nota aprovada, pallet, remetido,
  rejeitada antes da carga, 2 cargas, reservas) e a escrita (PATCH pela chave,
  cross-company, já enviada, fora da condição, 404, 400; a rota sem login
  validado → 403, validada → grava e loga, outra ação → 400). `sw.js` — cache
  `bm-comest-v53`.

### Kanban · onde está o botão do Pallet (09/11/2026)

O dono perguntou "onde está esse botão?" e confirmou o campo
`COTACAOREALIZADA_CUSTOM` (o nome que o portal já procurava). Duas correções:

- **Entidade de cargas**: o D365 pode publicar mais de uma; a descoberta
  (`entidadeExtra`) agora escolhe, entre as que servem, a que tem **mais** das
  colunas preferidas (`prefer` do `CFG_CARGA`: `COTACAOREALIZADA_CUSTOM`,
  `ENVIARPALLET_CUSTOM`, `LoadStatus`) — antes valia a primeira com `LoadId`, e
  uma sem os `_CUSTOM` escondia a cotação e o pallet. O Diagnóstico mostra as
  colunas achadas em cada candidata. Teste: com as duas publicadas, vale a com
  os `_CUSTOM` (sem a correção, as regras quebram).
- **Botão visível**: na ficha da OV com carga (Separação, Conferência, Cotação,
  Faturado), o quadro "Enviar para o Pallet" aparece **desativado com o
  motivo** (`motivoPallet` por carga: a carga está "Em processamento" — precisa
  estar Carregado; a cotação realizada está "Não"; campo não encontrado; já
  enviada / remetida). Liberado: o botão marrom de sempre.
- `sw.js` — cache `bm-comest-v54`.

### Kanban · Conferência só pela carga (09/11/2026)

Pedido do dono: "na Conferência não precisa ter 'todos os trabalhos de separação
estão fechados', somente o Status da carga = Em processamento". Saiu a reserva
"trabalho fechado → Conferência" de `etapaDe()`: a Conferência agora é **só** a
carga "Em processamento"; o trabalho fechado com a carga ainda não em
processamento **segue em Separação**. Na ficha, a linha do tempo e "Por que está
em…" falam só da carga. Testes ajustados (trabalho fechado sem carga →
Separação). `sw.js` — cache `bm-comest-v55`.

### Kanban · Aguardando Faturamento + o campo real da cotação (09/11/2026)

Pedidos do dono: "insira depois da Cotação AGUARDANDO FATURAMENTO, onde Carga →
Status da carga = Carregado AND Cotação realizada = Sim" e "cotação realizada é
esse campo aqui, QuotationPerformed_InoveProjects".

- **Campo da cotação**: `QuotationPerformed_InoveProjects` passa a ser o 1º nome
  procurado em `COL_CARGA.cotacao` (o `COTACAOREALIZADA_CUSTOM` fica de reserva) e
  a busca pelo pedaço do nome aceita "quotation" — antes só "cota", e por isso o
  campo real não era achado (a cotação ficava sempre "Não" e o botão do Pallet
  não aparecia).
- **Coluna Aguardando Faturamento** (id `aguardando`, depois da Cotação; sem o
  filtro de período, como as outras antes do Faturado): carga **Carregado** e
  cotação realizada = **Sim** — o que antes ficava em Cotação. Cotação agora é só
  Carregado + cotação Não. Faturado (nota aprovada) continua valendo antes. O
  botão "Enviar para o Pallet" aparece nas OVs daqui (e nas faturadas com a
  mesma condição). Cor nova (a 10ª, anil); nome curto "Ag. Faturamento" na coluna
  estreita.
- **Layout**: 10 colunas — coluna com OV de no mínimo 104 px; só a coluna
  **vazia** recolhe (nome na vertical) — antes uma coluna cheia estreita também
  recolhia. Com as 10 cheias, cabe sem rolar a partir de ~1.536 px.
- Testes: 10 colunas na ordem, Aguardando = Carregado + cotação Sim, o campo
  `QuotationPerformed_InoveProjects` achado. `sw.js` — cache `bm-comest-v56`.

### Kanban · Pendência + o quadro em 4 × 4 × 3 (09/11/2026)

Pedido do dono: "insira antes de Criada o card PENDÊNCIA, e quebre também,
4 x 4 x 3, por enquanto".

- **Pendência** (id `pendencia`, a 1ª coluna): `pendente: true` em `ETAPAS` —
  vazia, "aguardando os campos da fase", até o dono mandar os campos (aí: regra em
  `etapaDe()` e tirar o `pendente`). Cor nova (a 11ª, coral). Fora da linha do
  tempo da ficha enquanto não tem regra (`ORDEM_ETAPA.pendencia = -2`).
- **Quadro em linhas** (`POR_LINHA = 4` em `pages/kanban.html`): as 11 colunas em
  4 × 4 × 3 — Pendência, Criada, Crédito, Separação / Conferência, Cotação,
  Aguardando Faturamento, Faturado / Rejeitada, Pallet, Expedição —, colunas
  largas (o cartão inteiro, sem o modo compacto) e um pouco mais baixas (56 vh).
  `POR_LINHA = 0` volta ao layout de tudo numa linha (coluna vazia estreita /
  recolhida), que segue no código.
- Testes: 11 colunas na ordem, só a Pendência pendente. `sw.js` — cache
  `bm-comest-v57`.

### Kanban · colunas da mesma altura + a cotação em outra entidade de cargas (09/11/2026)

Pedido do dono: "os cards têm que ser do mesmo tamanho; caso ele necessite ver as
outras ordens, ele desce e rola a barra". E o aviso do print: a entidade de
cargas escolhida (`OutboundLoadHeaders`) não tem o `QuotationPerformed_InoveProjects`.

- **Mesma altura**: no quadro em linhas (4 × 4 × 3), todas as colunas com a mesma
  altura — **o tamanho de 5 OVs** (360 px: cabeçalho 57 + 5 cartões de 52 + os
  espaços; ajuste seguinte do dono: "não precisa ser grande, pode ser no tamanho
  de 5 OVs"); o que não couber rola dentro da coluna. `sw.js` — `bm-comest-v59`.
- **Segurança da escrita**: a busca "pelo pedaço do nome" dos campos da carga foi
  apertada — o do pallet só aceita `enviar…pallet` (antes, qualquer campo com
  "pallet", como `PalletQuantity`, poderia ser o GRAVADO pelo botão) e o da
  cotação só `quotation…performed` / `cotação realizada` (antes, `QuotationId`).
- **Outras entidades de cargas**: se a melhor candidata não tem as colunas
  preferidas (status, cotação, pallet), o portal testa também as outras
  entidades do service document com "load" no nome (menos as de linhas) e fica
  com a que tiver mais delas.
- **Aviso mais útil**: diz o que falta (status da carga, cotação, pallet) e lista
  os campos parecidos da entidade (status / quot / cota / pallet / realiz) — para
  o dono apontar o nome certo (envs `KANBAN_COL_CARGA_STATUS`,
  `KANBAN_COL_CARGA_COTACAO`, `KANBAN_COL_CARGA_PALLET`).
- Testes: a cotação numa entidade fora das candidatas; `PalletQuantity` e
  `QuotationId` não usados; o aviso com os campos parecidos. `sw.js` — cache
  `bm-comest-v58`.

### Kanban · a entidade de cargas certa de volta (10/11/2026)

O dono mandou a ficha com as cargas "não encontradas na entidade de cargas" e
perguntou de onde elas vinham. As cargas vêm do **trabalho de depósito** da OV
(`LoadId` de cada trabalho na `WHSWorkTableBiEntity`); o portal procura cada uma
na entidade de cargas para ler status, cotação e pallet.

- **A causa** (da mudança de 09/11): na `OutboundLoadHeaders` o portal não acha
  nenhum dos campos preferidos (status, `QuotationPerformed_InoveProjects`,
  `ENVIARPALLET_CUSTOM`) — o "enviada ao Pallet: Não" de antes vinha da busca
  solta por "pallet", que pegava OUTRO campo (e o botão gravaria nele). Com a
  busca apertada, ela ficou com 0 pontos, e a 2ª rodada (outras entidades com
  "load" no nome) escolheu uma qualquer com `LoadId` e um `Status` genérico —
  onde as cargas da OV não existem.
- **A correção**: o status da carga só pelo nome `LoadStatus` (sem o `Status`
  genérico); na 2ª rodada, a outra entidade só ganha se trouxer a **cotação** ou o
  **pallet** que falta na original (`preferChave`). E um aviso novo: "N de M
  cargas dos trabalhos não estão na entidade de cargas X (ex.: …)".
- O aviso dos campos que faltam (com os "campos parecidos" da entidade) continua:
  é por ele que o dono aponta os nomes certos — ou a TI publica os campos na
  entidade de cargas.
- Teste (8d) reproduz o print: na versão anterior a entidade errada era escolhida
  e nenhuma carga era achada; agora fica a `OutboundLoadHeaders`. `sw.js` — cache
  `bm-comest-v61`.

### Kanban · a carga só da WHSOutboundLoadHeaderEntity (10/11/2026)

Pedido do dono: "work você ainda vai pegar o trabalho, porém da carga você vai
pegar as info dessa entidade, WHSOutboundLoadHeaderEntity".

- **Só ela**: `ENT_CARGA` ficou com os nomes públicos que a
  `WHSOutboundLoadHeaderEntity` pode ter no OData (`WHSOutboundLoadHeaderEntities`,
  `WHSOutboundLoadHeaderEntity`, `OutboundLoadHeaders` — o padrão do D365 —,
  `WHSOutboundLoadHeaders`) e, do service document, só os com
  **"outboundloadheader"** no nome. Saiu a 2ª rodada em outras entidades com
  "load" no nome (`reNomeExtra`) — foi ela que sumiu com as cargas. O trabalho
  continua vindo da `WHSWorkTableBiEntity` (a ligação OV → trabalho → `LoadId`).
- **Diagnóstico**: a etapa `carga:colunas` lista TODOS os campos da entidade de
  cargas escolhida — para achar o nome do status, da cotação
  (`QuotationPerformed_InoveProjects`) e do pallet (`ENVIARPALLET_CUSTOM`). Se
  eles não estiverem lá, é a TI acrescentá-los à entidade no D365 (extensão da
  `WHSOutboundLoadHeaderEntity`) para o OData publicar.
- Testes: a carga fica na `OutboundLoadHeaders` mesmo com outra entidade de "load"
  tendo os campos; o Diagnóstico com as colunas. `sw.js` — cache `bm-comest-v62`.

### Kanban · a carga pela WHSLoadTableBiEntity (10/11/2026)

O dono: "na verdade a entidade acho que é essa, WHSLoadTableBiEntity" — a BI da
tabela de cargas, como a `WHSWorkTableBiEntity` do trabalho (que funciona).

- **Leitura**: `ENT_CARGA` = a BI primeiro (`WHSLoadTableBiEntities`,
  `WHSLoadTableBiEntity`…) e a `WHSOutboundLoadHeaderEntity` de reserva
  (`OutboundLoadHeaders`…); do service document, só os nomes com "loadtablebi" ou
  "outboundloadheader". Entre elas, vale a que tiver mais dos campos (status,
  `QuotationPerformed_InoveProjects`, `ENVIARPALLET_CUSTOM`).
- **Gravação do "Enviar para o Pallet"**: entidade BI costuma ser só leitura —
  se a escolhida recusar o PATCH, a gravação vai pela `WHSOutboundLoadHeaderEntity`
  (a mesma carga, pelo `LoadId`), se ela tiver o `ENVIARPALLET_CUSTOM`; se as duas
  recusarem, o erro diz as duas.
- Testes (8e): a BI com os campos é a lida; a BI recusa a gravação e ela cai na
  `OutboundLoadHeaders`; as duas recusando. `sw.js` — cache `bm-comest-v63`.

### Kanban · as cargas de volta: a BI não traz todas (10/11/2026)

O dono: "as cargas sumiram" / "não entendi por que parte existe e parte não".
Com a `WHSLoadTableBiEntity` na frente, só PARTE das cargas dos trabalhos vinha:
a BI é uma visão de relatório (o D365 monta essas entidades com junções e
filtros próprios), e a carga que fica fora dela não aparecia — a OV perdia
Conferência, Cotação, Pallet e Expedição.

- **Leitura**: as cargas são procuradas em TODAS as entidades de cargas que
  servem, na ordem (a escolhida primeiro): a que uma não trouxer — ou se ela
  falhar — vai para a próxima (a `WHSOutboundLoadHeaderEntity`). Só as que
  faltaram são pedidas de novo. Cada carga guarda a entidade de onde veio
  (`fonte`); a ficha mostra a da carga da OV, e as colunas (status, cotação,
  pallet) são as dessa entidade. Os campos de cotação/pallet seguem opcionais.
- **Fontes / Diagnóstico**: uma linha por entidade de cargas, com quantas cargas
  cada uma trouxe (`ov:carga:fonte` = procuradas × achadas). O aviso de carga
  não encontrada só sai se ela não estiver em NENHUMA delas.
- **"Enviar para o Pallet"**: relê a carga em cada entidade até achar; grava na
  entidade da carga (se tiver o campo), senão nas outras com o
  `ENVIARPALLET_CUSTOM`, por fim na `WHSOutboundLoadHeaderEntity`.
- Testes (8f): a BI com só 2 das 10 cargas — as etapas de sempre, cada carga com
  a sua fonte, o botão do Pallet para a carga da de cabeçalho, só as que
  faltaram pedidas de novo, sem aviso; o envio grava na de cabeçalho. Só o
  servidor mudou (sem `sw.js`).

### Kanban · Faturado sem data — todo o histórico (10/11/2026)

O dono: "o HOJE não precisa ter no card Faturado, pode deixar histórico que nem
os demais". O Faturado **saiu das colunas datadas**: mostra toda OV que está em
Faturado agora, de qualquer data. O período (de/até) vale só para **Rejeitada,
Pallet e Expedição**; o rótulo virou "Período de … até".

- **De onde vêm as faturadas antigas**: a OV totalmente faturada sai do "em
  aberto", e ler o diário de faturas da vida toda não cabe no tempo da leitura.
  Pelas regras do dono, a faturada fica com a carga **Carregado** até ir para o
  Pallet — então o quadro lê as cargas `LoadStatus = Loaded` ainda sem
  `ENVIARPALLET_CUSTOM` (em todas as entidades de cargas; enum e, se recusar,
  texto), os trabalhos dessas cargas (`LoadId`, só os de venda) e daí as OVs.
  Somam-se às em aberto e às com nota no período. Teto: 400 cargas
  (`KANBAN_MAX_CARGAS_FAT`, com aviso).
- A OV em aberto com nota aprovada antiga (faturamento parcial) também aparece
  no Faturado (antes sumia por estar fora do período).
- Diagnóstico: `fat:cargas` (cargas Carregado por entidade) e `fat:ovs`
  (quantas cargas e OVs).
- Testes (7a): faturada antes do período com a carga Carregado → Faturado; em
  aberto com nota antiga → Faturado; carga no Pallet ou Remetido não entra por
  aí; trabalho de transferência na mesma carga não vira OV. `sw.js` — cache
  `bm-comest-v64`.

### Kanban · a OV em partes: Pendência pelo lote e Separação só com trabalho Abrir (10/11/2026)

O dono: "traga o lote dos itens (o InventBatch); caso algum item não tenha lote,
parte dessa OV tem que estar em Pendência enquanto a outra vai andando — divida
isso muito bem no modal"; "Pendência é só a condição do lote; se não tiver linha
vai para Criada"; "a Separação só pode abranger o trabalho = Abrir; com 1 Abrir e
1 Fechado, faça um split no card: a OV na Separação e também em outro lugar com
base no outro trabalho ou na carga".

- **O lote**: as linhas da OV vêm com o lote (`ItemBatchNumber` na
  `SalesOrderLines` = o InventBatchId; `KANBAN_COL_LOTE` troca o nome; as colunas
  saem de uma linha de amostra). A ficha mostra o lote de cada linha ("lote X" /
  "sem lote").
- **Pendência** (`partesPorLote`): as linhas EM ABERTO sem lote viram um cartão
  em Pendência, com o valor e os itens só delas (`OV~semlote`); as outras seguem
  a etapa da OV (`OV~comlote`). Sem lote em nenhuma: a OV inteira em Pendência
  (um cartão só). Não divide depois do Faturado. Sem a coluna do lote: a regra
  fica desligada, com aviso.
- **OV sem linha** (lida e sem nenhuma): **Criada**. Se as linhas não foram lidas
  (entidade fora do ar / sem tempo), não muda nada — `porNumeros` diz quais OVs
  foram de fato consultadas.
- **Separação = só trabalho Abrir** (`etapaDe`). Trabalho em processo/fechado com
  a carga ainda sem fase → Conferência; liberada sem trabalho → Criada (sem a
  entidade de trabalho no OData, a liberação ainda leva para Separação). A fase
  da carga vem só das cargas dos trabalhos que NÃO estão abertos.
- **Split pelos trabalhos** (`partesPorTrabalho`): com trabalho Abrir junto de
  trabalho em processo/fechado, dois cartões — `~abrir` em Separação e `~outros`
  na etapa que as cargas DELES e a nota decidem. Cada um leva só os seus
  trabalhos e cargas (o botão do Pallet só no que tem a carga pronta); o valor
  da parte pelo trabalho não vem do Dynamics (vazio; a ficha mostra o da OV).
  O lote vem antes: a parte sem lote não se divide pelos trabalhos.
- Cada cartão traz `irmas` (os outros cartões da mesma OV: chave, etapa, valor).
- **Tela**: o cartão de uma parte tem borda tracejada e selos ("sem lote · 1/3",
  "com lote · 2/3", "trab. aberto · 1/2", "sem linha"). Na ficha, "Este cartão é
  uma parte da OV": por que a OV se dividiu, este cartão destacado na cor da
  etapa e os outros com "Ver o cartão ›"; o valor desta parte; nas linhas, "Neste
  cartão" e "Nos outros cartões" (apagadas); a linha do tempo e o "Por que está
  aqui" com a Pendência e o tile "Lote dos itens". A identidade do cartão é a
  chave da parte; as linhas, o "Copiar nº" e o Pallet seguem pelo número da OV.
- Testes (7c, 4f, 4f2…): divisão pelo lote, OV sem linha → Criada, linhas não
  lidas não mudam nada, Separação só Abrir, split pelos trabalhos (com nota
  aprovada, na mesma carga), as irmãs. `sw.js` — cache `bm-comest-v65`.

### Kanban · linha Entregue em Aguardando Faturamento — provisório (11/11/2026)

O dono: "coloca AGUARDANDO FATURAMENTO onde o status da linha da OV é Entregue,
por enquanto; depois vamos revisar isso, porém deixa assim".

- **Pelas linhas** (`partesPorLote`, que agora divide pelo lote E pela entrega):
  as linhas com status **Entregue** (`SalesOrderLineStatus = Delivered`:
  romaneio emitido, sem nota) viram um cartão em **Aguardando Faturamento**
  (`OV~entregue`, com o valor e os itens só delas); o resto segue (`OV~resto`,
  ou `OV~comlote` quando também há a parte sem lote). Todas entregues: a OV
  inteira, um cartão. Não vale com a nota Rejeitada nem na OV cancelada; a parte
  entregue não se divide pelos trabalhos nem leva o botão do Pallet.
- **A OV Entregue entra no quadro**: o "em aberto" agora lê `SalesStatus =
  Backorder OU Delivered` (enum; se recusar, texto). Em `etapaDe`, a OV Entregue
  sem nota aprovada → Aguardando Faturamento (antes caía em Faturado pela regra
  de reserva).
- Tela: selos "entregue · 1/2" / "entregue"; na ficha, a divisão "pelo status
  das linhas", a linha do tempo e o "Por que está aqui" com a regra provisória.
- Testes (4, 7c): OV Entregue → Aguardando; linha Entregue (mesmo sem lote) vira
  cartão próprio; todas entregues → a OV inteira; as somas das colunas.
  `sw.js` — cache `bm-comest-v66`.

### Kanban · Cotação, Aguardando e Faturado pelo status da LINHA (11/11/2026)

O dono: "Cotação vai ser Status da carga = Carregado E status da linha = Ordem em
aberto; Aguardando Faturamento vai ser Status da carga = Carregado E status da
linha = Entregue; e o Faturado é o status da linha Faturado; o resto pode deixar
do jeito que está". Substitui a regra provisória da linha Entregue (logo acima).

- **`etapaDe` com o status da linha** (`aberta` / `entregue` / `faturada`):
  linha Faturado → **Faturado**; carga Carregado + linha Entregue → **Aguardando
  Faturamento**; carga Carregado + linha em aberto → **Cotação**. A "Cotação
  realizada" não decide mais Cotação x Aguardando (segue só no botão do Pallet).
  Reservas: linha Entregue sem carga nenhuma → Aguardando; sem as linhas lidas,
  vale a situação da OV (e a nota aprovada → Faturado, como antes).
- **A OV em partes pelas linhas** (`partesPorLinhas`, no lugar do
  `partesPorLote`): cada linha ganha a sua etapa; as linhas com a mesma etapa
  ficam no mesmo cartão (`OV~<etapa>`; a parte sem lote continua `OV~semlote`),
  com o valor e os itens delas e a contagem por status (`linhasSt`). Uma etapa só:
  a OV inteira. Os trabalhos (Separação só Abrir) dividem só a parte com linhas
  em aberto.
- Tela: selos "em aberto · 1/3", "entregue · 1/3", "faturado · 1/3"; na ficha, a
  divisão "pelo status das linhas", o tile "Status da linha", a linha do tempo e
  "Como a etapa é decidida" com as regras novas.
- Testes (8g e os ajustados): carga Carregado com linhas em aberto / Entregue /
  Faturada → 3 cartões; carga em processamento → Conferência, um cartão; a linha
  automática do teste segue a situação da OV. `sw.js` — cache `bm-comest-v67`.

### Kanban · a Pendência de lado, vazia (11/11/2026)

O dono: "deixa a Pendência de lado por enquanto, deixa ela sem nada que depois
vamos analisar com calma, ignora o status dela". A coluna fica no quadro, VAZIA e
à espera (`pendente: true` — "aguardando os campos da fase"); a regra do lote
(linha em aberto sem lote → Pendência) fica DESLIGADA — religa com
`KANBAN_PENDENCIA_LOTE=1`. O lote continua lido e aparece em cada linha da ficha
(só informação); o aviso de "linhas sem a coluna do lote" e o tile "Lote dos
itens" só voltam com a regra ligada. Testes: por padrão ninguém em Pendência e a
OV com item sem lote fica inteira; os da regra do lote rodam com ela ligada.
`sw.js` — cache `bm-comest-v68`.

### Kanban · a Pendência de volta: item sem lote (11/11/2026)

O dono, à tarde: "volte para a Pendência tudo que não tiver LOTE na linha,
seguindo a lei do SPLIT — parte dela vai estar em Pendência e parte nas outras
fases". A regra do lote (`partesPorLinhas`) está **LIGADA por padrão** de novo
(`KANBAN_PENDENCIA_LOTE=0` desliga) e a Pendência saiu do `pendente: true`:

- As linhas **em aberto** sem lote (`ItemBatchNumber` vazio) vão para um cartão
  em Pendência (`OV~semlote`), com o valor e os itens só delas; as outras linhas
  seguem as regras de sempre (Criada … Cotação, Aguardando, pelo status da
  linha). Nenhuma com lote: a OV inteira em Pendência. A linha Entregue ou
  Faturada, e a OV já em Faturado/Rejeitada/Pallet/Expedição, não volta para a
  Pendência; linha cancelada não conta.
- Sem a coluna do lote nas linhas: aviso no topo e nada dividido.
- Tela: "Como a etapa é decidida" com a Pendência pelo lote, o tile "Lote dos
  itens" e o "sem lote → vai para Pendência" nas linhas da ficha de volta.
- Testes (1, 7c): Pendência com regra; `=0` desliga; sem env, ligada.
  `sw.js` — cache `bm-comest-v74`.

### Kanban · a OV parada em Criada por 15 min vai para a Pendência (12/11/2026)

O dono: "quando a OV pousar no Criada e em 15 minutos nada acontecer com ela — nada
foi atualizado no sistema —, ela tem que ir para a Pendência; se for liberada, segue
o rumo dela, e depois, na medida que for mudando, vai andando sozinha".

- `parouEm` / `minutosCriada`: a OV (ou a parte dela) que cairia em **Criada** e está
  há mais de `KANBAN_CRIADA_MIN` minutos (padrão 15; `0` desliga) sem atualização vai
  para **Pendência** (`pendPorTempo`). "Atualização" = a data de alteração da OV
  (`ModifiedDateTime`, `KANBAN_COL_OV_ALTERADA`) ou, sem ela, a de criação — a mais
  recente das duas (`ultimaAtualizacao`). Vale no cálculo da OV, de cada linha e de
  cada porção (por quantidade). Crédito, Separação etc. não mudam; quando a OV anda
  (liberada, trabalho, carga…), sai da Pendência sozinha.
- Tela: o selo "parada" no cartão; na ficha, "A OV ficou parada em Criada mais de 15
  min sem nenhuma atualização (a última foi …)" e o passo "Agora: Pendência" com a
  hora. A resposta traz `criadaMin`.
- Testes (7k): criada há 1 h → Pendência; há 5 min → Criada; atualizada há 4 min →
  Criada; com crédito → Crédito; liberada → Separação; a parada, depois liberada,
  vai para Separação. Os cenários antigos rodam com a regra desligada. `sw.js` —
  cache `bm-comest-v96`.

### Kanban · sem o QtyLeftToLoad, o RemainInventPhysical (12/11/2026)

O dono: "não está achando o campo QtyLeftToLoad — se baseia nesse,
RemainInventPhysical".

- `COLS_LINHA.restante` (`RemainInventPhysical`, `RemainingInventPhysicalQuantity`…;
  ou "remain…invent…phys" no nome; `KANBAN_COL_LINHA_RESTANTE`) é a reserva do
  `QtyLeftToLoad` nas linhas da OV — e na busca em outras entidades
  (`CFG_LINHA_FALTA`). Com as duas, vale o `QtyLeftToLoad`.
- A diferença: o `RemainInventPhysical` é o que falta ENTREGAR (inclui o que já
  está na carga). Funciona como "falta carregar" porque a divisão por quantidade
  desconta antes o que está em trabalho e em carga — o que sobra e ainda falta
  entregar vai para a Pendência. Por isso, com ele, a liberação só conta pelo que
  foi visto em trabalho/carga (`liberou`): a OV "parcialmente liberada" sem
  trabalho/carga lidos não vai inteira para a Pendência (fica na fase da OV).
- Diagnóstico `linhas:falta:coluna` (a coluna e o tipo: `carga` / `restante`).
- Testes (7j): 10 restantes, 6 no trabalho com a carga → Cotação 6 e Pendência 4; a
  parcialmente liberada sem trabalho/carga fica em Criada. `sw.js` — cache
  `bm-comest-v95`.

### Kanban · os itens da carga na WHSLoadTableBiEntity, mesmo com a carga achada na outra (12/11/2026)

O dono: "a tabela WHSLoadTableBiEntity não tem? Por que ainda não apareceu?". Duas
falhas no caminho dos itens da carga:

- **A carga achada primeiro na outra entidade**: `cargasPorId` procura cada carga
  nas entidades de cargas em ordem (a que tem mais campos — cotação, pallet,
  status — primeiro) e só junta os itens da entidade onde a carga foi achada. Se a
  `WHSOutboundLoadHeaderEntity` (sem itens) achou a carga, a
  `WHSLoadTableBiEntity` nem era lida para ela. Agora, sem itens, o quadro lê os
  itens (`ItemId`, `Qty`) das entidades de cargas que TÊM essas colunas
  (`linhasNaDeCargas`), pelas cargas das OVs; só sem nenhuma, a entidade própria de
  linhas de carga.
- **O filtro pela OV**: os itens eram filtrados pelo `OrderNum` igual ao nº da OV;
  com outro formato, sumiam todos. Agora, se nenhum casar, valem todos os itens das
  cargas da OV (o casamento com a linha da OV é pelo id da transação ou pelo item).
- **Ficha**: no fim da seção "Carga", de onde vieram os itens ("Itens das cargas:
  WHSLoadTableBiEntities (ItemId · Qty)") ou por que não vieram (o motivo de cada
  entidade). A resposta do quadro traz `itensCarga`.
- Testes (7i): a carga achada na de cabeçalho, os itens na BI, o `OrderNum` em outro
  formato — falhava com o código anterior. `sw.js` — cache `bm-comest-v94`.

### Kanban · as linhas da carga e o QtyLeftToLoad de outras entidades (12/11/2026)

O dono: "não trouxe as linhas da carga (ItemId, Qty) nem o QtyLeftToLoad, que é
das linhas da OV — e esse item com 5 restantes não está em Pendência". A entidade
de cargas lida (`WHSLoadTableBiEntities`) e as linhas de OV padrão
(`SalesOrderLines`) não têm esses campos.

- **Linhas da carga** (`linhasDasCargas`, `CFG_CARGA_LINHA`): quando a entidade de
  cargas não traz os itens, a entidade própria de linhas de carga — candidatas
  (`BioWHSLoadLineV1`…, `WHSLoadLineBiEntity`…, `LoadLines`) + "loadline" no
  service document (`KANBAN_ENT_CARGA_LINHA`) —, com `LoadId`, `ItemId`, `Qty` (e
  `OrderNum`, `InventTransId`), lidas pelas cargas das OVs.
- **QtyLeftToLoad** (`faltaDasLinhas`, `CFG_LINHA_FALTA`): quando as linhas de OV
  lidas não têm a coluna, as linhas de OV da Bio (`BioSalesOrderLinesV1`…) e as
  padrão + "salesorderline"/"salesline" no service document
  (`KANBAN_ENT_LINHA_FALTA`), com o nº da OV e o `QtyLeftToLoad` (ou "left to
  load" no nome) — só das OVs com trabalho (onde a liberação começou). O valor
  entra em cada linha da OV pelo id da transação, pelo nº da linha ou pelo item.
- Sem nenhuma delas: aviso no topo, com o motivo (as entidades testadas também
  ficam no "Diagnóstico da leitura no Dynamics": `cargalinha:*`, `linhafalta:*`,
  `carga:linhas:fonte`, `linhas:falta:fonte`, `linhas:colunas`).
- Testes (7h): o QtyLeftToLoad da `BioSalesOrderLinesV1` (5 restantes → Pendência)
  e as linhas da `BioWHSLoadLineV1` (Cotação); sem as duas, os avisos. `sw.js` —
  cache `bm-comest-v93`.

### Kanban · a OV em partes por QUANTIDADE: trabalho, carga e o que falta carregar (12/11/2026)

O dono: "preciso ter essa visão (Neste cartão / Nos outros cartões) a nível de
ordem, como já tem, e também a nível de trabalho e de carga, com base em cada
trabalho e cada carga. No trabalho: ItemId, QtyWork (e o nome do item); na carga:
ItemId, Qty. Vai cair na Pendência se QtyLeftToLoad (da SalesLine) for > 0. Você
tem que se basear na liberação nas linhas do trabalho, a partir disso nas linhas a
nível da carga, antes da liberação a nível da OV"; e, quando só parte da quantidade
está na carga, "divide por quantidade".

- **Os dados**: as linhas do trabalho (`BioWHSWorkLineV1`: `ItemId`, `QtyWork`,
  `WorkType`, `InventTransId`), lidas para toda OV com trabalho; as linhas da carga
  (a própria `WHSLoadTableBiEntities`, uma linha por item: `ItemId`, `Qty`,
  `OrderNum`, `InventTransId` — `cargasPorId` agora junta todas); e o
  `QtyLeftToLoad` das linhas da OV (`COLS_LINHA.falta`, no `$select`).
- **A divisão** (`partesPorQuantidade`): cada linha da OV em aberto vira porções,
  nesta ordem — 1) o trabalho dela (`QtyWork`, só o Pick: o Put repete a
  quantidade): trabalho Abrir → Separação; em processo/fechado → a fase da carga
  do trabalho; 2) o que está na carga e ainda sem trabalho → a fase da carga (carga
  sem fase = liberada → Separação); 3) o que falta carregar (`QtyLeftToLoad`) →
  **Pendência** (com crédito ativo, Crédito) — **só quando a liberação da OV já
  começou** (alguma parte em trabalho/carga, ou a OV liberada / parcialmente
  liberada): o dono, "meu medo é tudo ir para Pendência e não para Criada" — a OV
  que ninguém liberou tem o `QtyLeftToLoad` igual à quantidade toda e fica em
  **Criada** (com crédito, Crédito); 4) o resto → a fase da OV. As porções
  da mesma fase viram um cartão (`OV~fase`) com a quantidade de cada linha
  (`parte.qtds`), o valor (quantidade × preço), e só os trabalhos/cargas dele;
  `trabalhosOv`/`cargasOv` guardam todos. Linha entregue/faturada: inteira, pelo
  status (como antes). Sem as quantidades do trabalho, sem itens na carga e sem o
  `QtyLeftToLoad`: a regra de antes (por linha / lote).
- **Ficha**: "Trabalho no depósito" e "Carga" mostram TODOS os trabalhos/cargas da
  OV, cada um com os itens (código, nome — das linhas da OV — e quantidade),
  marcando "neste cartão" / "outro cartão"; nas linhas da OV, "6 de 10 un neste
  cartão", o valor da parte e "falta carregar N". O cartão da Pendência por
  quantidade explica que é o que ainda não entrou em carga.
- Testes (7g): 10 de A (6 no trabalho fechado com a carga Carregado, 4 faltando
  carregar), 5 de B no trabalho aberto, 3 de C na carga sem trabalho → Cotação (A 6
  + C 3 = R$ 900), Pendência (A 4 = R$ 400) e Separação (B 5 = R$ 250), somando a
  OV; o Put não conta em dobro; tudo na mesma carga → um cartão só; a OV não
  liberada (`QtyLeftToLoad` = tudo) fica inteira em Criada (com crédito, Crédito);
  a parcialmente liberada manda só o que falta para a Pendência. `sw.js` — cache
  `bm-comest-v92`.

### Kanban · o teto de 400 cargas fica com as MAIS RECENTES (12/11/2026)

O dono: "só está carregando 400 ordens?" — o aviso dizia "2055 cargas Carregado
no Dynamics: o Faturado olhou só 400 delas".

- **Não são 400 ordens**: as OVs em aberto vêm todas. O teto
  (`KANBAN_MAX_CARGAS_FAT`, 400) vale só para as **cargas Carregado**, de onde
  saem as OVs já faturadas (Faturado e Pallet).
- **O problema**: o Dynamics devolve as cargas Carregado pela ordem do `LoadId`
  — as mais antigas primeiro (cargas que ficaram Carregado e nunca foram
  remetidas). O corte ficava com as 400 mais velhas, e o Faturado/Pallet só
  mostram de 11/11/2026 em diante: as cargas recentes, as que importam, eram as
  cortadas.
- **Agora** (`ovsDeCargasCarregadas`): as cargas Carregado são ordenadas pelo
  número do fim do `LoadId` (CG013641 → 13641), da maior para a menor, antes do
  teto — ficam as 400 mais recentes, e são lidas primeiro (se o tempo acabar,
  faltam as antigas). O aviso diz "olharam só as 400 mais recentes — as OVs em
  aberto vêm todas"; diagnóstico `fat:corte` (total, lidas, da mais recente até
  qual).
- Testes (7e): 450 cargas antigas na frente — a OV de 11/11 segue no Faturado e
  a de 12/11 no Pallet, e os trabalhos das recentes são lidos primeiro (falhava
  com o código anterior).

### Kanban · menos alertas falsos: o teto de cargas e as cargas "não achadas" (13/11/2026)

O dono: "ainda está mostrando esses alertas...".

- **O teto de 400 cargas** só avisa quando pode ter tirado OV do quadro. Com o
  corte de data ligado (`KANBAN_DESDE`, 11/11/2026), o quadro olha as OVs das
  cargas MAIS ANTIGAS que foram lidas (a borda: 10% das lidas, no mínimo 20): se
  nenhuma delas chega ao Faturado/Pallet/Rejeitada, as cortadas — ainda mais
  antigas — também não chegariam, e o aviso não aparece. Se a borda ainda tem OV
  no quadro, o aviso aparece e manda aumentar o `KANBAN_MAX_CARGAS_FAT`. Sem o
  corte de data (`KANBAN_DESDE=0`), avisa sempre, como antes. Diagnóstico:
  `fat:corte:borda`.
- **"N cargas dos trabalhos não estão nas entidades de cargas"**: agora conta só
  as cargas dos trabalhos VÁLIDOS — a de trabalho cancelado/combinado (que pode
  nem existir mais no Dynamics) não decide a fase da OV e não entra; e a carga
  que não deu tempo de consultar não é mais contada como "não achada" (tem aviso
  próprio, "Não deu tempo de ler N carga(s)"). Diagnóstico `carga:nao-achadas`
  (as não achadas, quantas sem tempo e as só de trabalhos cancelados).
- **"Cotação realizada" não achada** (`QuotationPerformed_InoveProjects` na
  `WHSLoadTableBiEntities`): segue — é o campo que falta na entidade publicada
  no Dynamics, não dá para resolver no portal. Com o nome certo do campo (ou a
  entidade que o tem), fixe em `KANBAN_COL_CARGA_COTACAO` / `KANBAN_ENT_CARGA`.
- Testes (7e, 8d): a borda sem OV de 11/11 → sem aviso; com uma OV de 12/11
  numa carga da borda → aviso; a carga só de trabalho cancelado fora da entidade
  → sem aviso (o diagnóstico lista).

### Kanban · liberação parcial por linha + o frete FOB no e-mail da Cotação (12/11/2026)

O dono: "lembrando que pode haver liberação parcial das linhas: parte fica em
Pendência e parte tem trabalho"; e "o frete vem em inglês — o Kanban vai entender
que ChargeFreight é FOB? Para disparar o e-mail ao cliente sobre a cubagem: deve
disparar se for Sim E se for FOB (FOB - Destinatário)".

- **As linhas do trabalho no quadro** (`linhasTrabalhoDasOvs`, a
  `BioWHSWorkLineV1` — a mesma do frete — pelo `OrderNum`), só das OVs que
  precisam: a com linha em aberto sem lote E trabalho, e a com Solicitar
  transportadora = Sim. Cada linha do trabalho se liga à linha da OV pelo id da
  transação (`InventTransId` = `InventoryLotId` da linha da OV, agora no `$select`
  das linhas) ou, sem ele, pelo item.
- **Pendência por linha** (`partesPorLinhas` + `o._trabLinha`): a linha em aberto
  sem lote que NÃO tem trabalho dela não herda a fase do trabalho/carga das outras
  linhas — vale o contexto só dela (não liberada, sem trabalho, sem carga) e, sem
  outra fase, vai para Pendência; a parte liberada segue (Separação…). Com
  trabalho mas sem as linhas do trabalho lidas (ou sem a entidade): não se sabe —
  vale a regra de antes (a fase da OV).
- **O frete** (`o.frete = { valores, fob }`): `KANBAN_FRETE_FOB` (padrão
  `ChargeFreight`, `FOB`, `Destinatario`) diz o que é FOB. **O e-mail da Cotação só
  sai com Solicitar transportadora = Sim E frete FOB.** Na ficha, "Tipo de frete"
  em português ("FOB - Destinatário (ChargeFreight)"); o "E-mail da cotação" diz
  quando o frete não é FOB (ou não veio).
- Testes (7f, 10): a linha sem lote e sem trabalho em Pendência e a liberada em
  Separação; a sem lote com trabalho dela em Separação; sem as linhas do trabalho,
  a regra de antes; Sim + FOB recebe, Sim + CIF não. `sw.js` — cache
  `bm-comest-v91`.

### Kanban · Pendência só quando nenhuma outra fase é atendida (12/11/2026)

O dono: "a fase PENDÊNCIA: só vão as ordens para ela se NENHUMA das outras fases
for atendida — se está sem lote está em Pendência, porém se tiver trabalho ou carga
que atende os outros status, ela tem que ir para a outra fase".

- `partesPorLinhas`: a linha em aberto sem lote só vai para Pendência quando a
  etapa dela seria **Criada** (a de quando nada mais bate). Com crédito ativo,
  trabalho (Separação/Conferência) ou carga (Cotação, Aguardando, Faturado,
  Pallet, Expedição), a linha vai para essa fase mesmo sem lote — e a OV não se
  divide por causa do lote. Saiu o `POS_NOTA` (sem uso).
- Ficha: "Como a etapa é decidida" — a última regra virou "Nenhuma das
  anteriores: itens em aberto sem lote → Pendência; os outros → Criada".
- Testes (7c): a OV não liberada com item sem lote divide (Pendência + Criada); a
  liberada (Separação) com item sem lote fica inteira em Separação. `sw.js` —
  cache `bm-comest-v90`.

### Kanban · Faturado, Rejeitada e Pallet só de 11/11/2026 em diante (12/11/2026)

O dono: "as fases FATURADO, REJEITADO e PALLET, quero somente que seja do dia
11/11/2026 para frente".

- **Corte fixo** (`desde()`, no filtro do quadro): nas colunas Faturado, Rejeitada
  e Pallet fica só a OV cuja **nota fiscal mais recente** é de 11/11/2026 em diante
  — a data do faturamento (uma OV criada em 09/11 e faturada em 11/11 fica); sem
  nota, a data de criação. As outras colunas não mudam (em aberto de qualquer
  data; Expedição = envio confirmado hoje). `KANBAN_DESDE` troca a data (`0`
  desliga); `KANBAN_DESDE_ETAPAS`, as colunas. A resposta traz `desde`,
  `desdeEtapas` e `antesDoCorte` (quantas saíram).
- **Tela**: "desde 11/11" no cabeçalho das 3 colunas (e na lista); "Como a etapa é
  decidida" explica o corte.
- Testes (7e): nota de 11/11 criada em 09/11 fica; 30/10, 2025 e 03/11 saem (nas 3
  colunas); a em aberto de 2025 não tem corte; `KANBAN_DESDE=0` desliga. Os
  cenários antigos rodam com o corte desligado. `sw.js` — cache `bm-comest-v89`.

### Kanban · o campo extra com nome parecido (12/11/2026)

O dono: "Solicitar transportadora está Sim no Dynamics e não está sinalizando" — a
ficha mostrava "Solicitartransportadora_Custom · não veio do Dynamics": nenhuma
entidade de OV lida tem a coluna com esse nome exato.

- `pegaExtra` procura em 3 passos: o nome exato (sem caixa); um nome PARECIDO — o
  miolo do nome sem `_Custom`/`_InoveProjects`/`_Inove` e sem "_" (ex.:
  `SolicitarTransportadora`), ou as abreviações conhecidas (`SolicitarTransp…`)
  —, marcado `aproximado`; sem nada, as colunas parecidas que existem nas
  entidades lidas vão em `parecidos` (ex.: com "transp"/"solicit").
- Ficha: o nome da coluna achada embaixo do valor; sem o campo, "não veio do
  Dynamics · parecidos: …" (ou "nenhuma coluna parecida nas tabelas lidas") — a
  pista para fixar o nome certo (`KANBAN_CAMPOS_EXTRA`).
- O e-mail da Cotação usa o mesmo valor (Solicitar transportadora = Sim).
- Testes (4a): o nome parecido achado; a pista sem o campo. `sw.js` — cache
  `bm-comest-v88`.

### Kanban · o e-mail automático da Cotação (12/11/2026)

O dono: "quando o PEDIDO cair em COTAÇÃO, se na OV Solicitartransportadora_Custom
= Sim, envie automaticamente um e-mail para o cliente" — no modelo dele (📦 Pedido
… pronto para faturamento e coleta, 👤 Cliente, 📦 Caixas, 📊 Total, ⚖️ Peso, 💰
Valor, 📍 Entrega, 🚚 pedido da transportadora, 📍 coleta e 🕒 horário). "As caixas
são os containers: cada ContainerId da BioWHSContainerV1Entity é uma caixa,
ligada à carga; Weight, Length, Width, Height."

- **O e-mail** (`api/shared/kanban-email.js` · `montarEmail`): o texto do modelo,
  com a saudação pela hora de Brasília (bom dia / boa tarde / boa noite); as
  caixas iguais (tipo + medidas) juntas — "• 2x Caixa Dreno — Caixa Dreno (C 45,0
  x L 43,0 x A 28,0)"; o total, o peso somado, o valor da OV e a cidade/UF de
  entrega (`DeliveryAddressCity` / `DeliveryAddressStateId`). O endereço de
  coleta e o horário são do modelo (`KANBAN_EMAIL_COLETA`, `KANBAN_EMAIL_HORARIO`
  trocam). Assunto: "Pedido OV… — pronto para faturamento e coleta".
- **As caixas** (`caixasDasCargas`): a `BioWHSContainerV1Entity` (nome público
  descoberto: candidatas + "whscontainer"; `KANBAN_ENT_CAIXA`), pelas cargas da
  OV; com o `ShipmentId`, só as caixas das remessas da OV (uma carga pode levar
  outra OV).
- **O envio**: Microsoft Graph direto (`POST /users/{remetente}/sendMail`) com o
  token de aplicativo do portal (`auth.getAppToken` — o app tem Mail.Send). Sai
  da caixa `KANBAN_EMAIL_DE` para `KANBAN_EMAIL_PARA` (lista; `KANBAN_EMAIL_CC`
  opcional) — **só pelas variáveis do Azure**, nunca pelo código (o repositório é
  público) nem pela tela.
- **A automação** (`processar`, a cada leitura do quadro) — **SÓ automática**
  (dono: "vai ser automática, não quero botão"): as OVs em Cotação com Solicitar
  transportadora = Sim, inclusive as que já estavam lá (sem "base"). **Uma vez só
  por OV**: uma marca `kanban-email-cotacao/<OV>.json` no blob, criada com
  `If-None-Match:*` — só uma instância consegue e só ela envia. Container:
  `KANBAN_BLOB_URL` (SAS de container, Read + Create + Write) ou, sem ela, o do log
  de acessos (`LOG_PORTAL_BLOB_URL`). **Sem nenhum** (dono: "não precisa de blob
  ainda"), o portal lembra dos envios só na MEMÓRIA do servidor
  (`processarNaMemoria`): serve para o teste, mas se o servidor reiniciar (ou
  houver mais de uma instância) a OV que continuar em Cotação pode receber de novo
  — a ficha avisa. Para mandar para clientes, configurar o registro. Sem
  caixas na carga: espera. No máximo `KANBAN_EMAIL_MAX` (5) envios por leitura — as
  outras ficam na fila para a próxima; `KANBAN_EMAIL_AUTO=0` desliga.
- **Ficha** (OV em Cotação): "E-mail da cotação", só informativo — a situação
  (enviado em … para …, aguardando as caixas, na fila, falhou, falta configurar)
  e a prévia do e-mail. Sem botão. Rota `POST /api/kanban-ov { acao:
  'email-cotacao', ov }` devolve só a prévia; com `enviar: true` responde 410.
- Testes (10): o texto igual ao modelo, linha a linha; a que já está em Cotação
  recebe; a que cai em Cotação recebe (uma vez); só as caixas da remessa da OV;
  sem caixas espera; o teto por leitura e a fila; a prévia; a rota (410 no
  envio); sem configuração, avisa; sem blob, na memória (não repete na leitura
  seguinte; repete se a memória zerar). `sw.js` — cache `bm-comest-v87`.

### Kanban · o tipo de frete na ficha (12/11/2026)

O dono: "preciso da informação de frete também: FreghtType_InoveProjects, que
provavelmente está nessa entidade, BioWHSWorkLineV1".

- **Servidor** (`freteDaOv`, chamado por `linhasDaOv` — a leitura que a ficha
  faz ao abrir; o quadro não fica mais pesado): as LINHAS DO TRABALHO de
  depósito da OV na `BioWHSWorkLineV1` (nome público descoberto como as outras
  extras: candidatas + "whsworkline" no service document; `KANBAN_ENT_FRETE`),
  pelo nº da OV (`OrderNum`) ou, se a entidade não tiver o nº, pelos `WorkId`
  dos trabalhos da OV. Coluna `FreghtType_InoveProjects` (`KANBAN_COL_FRETE`;
  ou o pedaço "freight type"). A resposta de `?ov=` traz `frete: { entidade,
  coluna, valores, linhas, erro }` — os tipos de frete sem repetir.
- **Ficha**: "Tipo de frete" em "Dados do pedido", logo depois dos 4 campos
  extras: "lendo…" enquanto as linhas chegam, o(s) valor(es), "—" sem valor, e
  "não veio do Dynamics" quando a entidade não respondeu.
- Testes (5): sem a entidade publicada; pelo `OrderNum`; pelos `WorkId` dos
  trabalhos. `sw.js` — cache `bm-comest-v84`.

### Kanban · 4 campos a mais nos "Dados do pedido" (12/11/2026)

O dono: "insira esses campos a mais aqui: Solicitartransportadora_Custom,
CarrierName_InoveProjects, CustomerOrderNumber_Inove, Operador_Custom — preciso
dessas informações".

- **Servidor** (`CAMPOS_EXTRA`, `KANBAN_CAMPOS_EXTRA` troca a lista): cada OV
  traz `extras: [{ nome, coluna, valor }]`, procurados em todas as entidades de
  OV lidas, pelo nome sem caixa. Vale o 1º valor preenchido; senão o da 1ª
  entidade que tem a coluna (vazio ou "No" — que os campos crus jogam fora); sem
  a coluna em nenhuma, `valor: null`.
- **Ficha**: no topo de "Dados do pedido", sempre os 4 — "Solicitar
  transportadora" (Sim/Não), "Transportadora", "Nº do pedido do cliente" e
  "Operador" —, com o nome da coluna embaixo; "—" quando vazio, e "não veio do
  Dynamics" quando nenhuma entidade lida tem o campo.
- Testes (4a): preenchidos (nome sem caixa, o preenchido ganha do vazio), "No"
  e vazio, sem a coluna. `sw.js` — cache `bm-comest-v83`.

### Kanban · sem período + a carga confirmada hoje que não aparecia (12/11/2026)

O dono: "remove o período, não preciso disso, tem que mostrar tudo — olha essa
carga, ela está confirmada hoje e não apareceu em Expedição" (CG011509, ALMOX-PA,
confirmada 12/11 10:42) — e, com o período de 07/02/2025 a hoje, o erro
"Período grande demais: no máximo 1 ano".

- **Sem período**: saíram da tela os campos "Período de / até" e os botões Hoje,
  7 dias e Mês; a tela pede só `/api/kanban-ov`. No servidor, `quadro()` ignora
  `de`/`ate` (`DATADAS = []`): nenhuma coluna filtra por data — a Rejeitada também
  mostra tudo — e o diário de faturas é lido só de HOJE. A rota não valida mais
  período (uma página antiga em cache que mande `de`/`ate` não dá erro); o
  `?modo=dia&data=` segue validando a data. Só a Expedição é "hoje".
- **A carga confirmada hoje que sumia** — duas causas, as duas corrigidas em
  `ovsDeCargasCarregadas`/`montar`:
  1. as cargas confirmadas hoje entravam NO FIM da lista, depois das Carregado
     de todos os depósitos, e o teto `MAX_CARGAS_FAT` (400) as cortava. Agora vão
     à parte (`idsHoje`), na frente e sem teto; os trabalhos delas são lidos
     primeiro e as OVs delas também (`numerosHoje`, antes das Carregado e das
     notas).
  2. as cargas eram lidas de TODOS os depósitos (EMB-SEC…): agora só do
     depósito do quadro (`InventLocationId eq 'ALMOX-PA'`), quando a entidade de
     cargas tem a coluna.
  Diagnóstico: `exp:cargas` lista as cargas confirmadas hoje; `fat:ovs`, as OVs
  delas (`ovsHoje`).
- Testes (7, 7c, 7d, 6): quadro sem período (de/ate = hoje, nada datado, a
  Rejeitada antiga aparece, o diário só de hoje, de/ate da URL ignorados); 450
  cargas Carregado na fila e a confirmada hoje na Expedição (falhava com o código
  anterior); as cargas só do ALMOX-PA; a rota sem o 400 do período. `sw.js` —
  cache `bm-comest-v82`.

### Kanban · Expedição = envio da carga confirmado HOJE (12/11/2026)

O dono: "na fase EXPEDIÇÃO, a entidade WHSLoadTableBiEntities tem um campo
chamado LoadShipConfirmUTCDateTime que você vai ter que levar para Expedição se
a data desse campo for hoje".

- **Regra** (`faseCarga`): carga com `LoadShipConfirmUTCDateTime` preenchido
  (ou `LoadStatus` = Remetido, como antes) → fase `remetido` → **Expedição**.
  Coluna da carga: `COL_CARGA.envioConfirmado` (`KANBAN_COL_CARGA_ENVIO_CONFIRMADO`
  troca o nome).
- **A coluna Expedição** mostra só as OVs cuja carga teve o envio confirmado
  **hoje** (dia de Brasília), de OV de qualquer data, e **não segue o período**
  da tela — que fica só para a Rejeitada (`DATADAS`). A data da OV é a
  confirmação mais recente das cargas remetidas dela (`expedidaEmDe`); confirmada
  em outro dia ou remetida sem a data → fora, contadas em `expedicaoOutroDia` /
  `expedicaoSemData`; `expedicaoDia` = hoje. Sem o campo na entidade de cargas:
  aviso no topo (a Expedição fica vazia).
- **Leitura** (`ovsDeCargasCarregadas`): além das cargas Carregado, as cargas
  com `LoadShipConfirmUTCDateTime` de hoje (`ge` hoje 03:00Z e `lt` amanhã
  03:00Z) → os trabalhos → as OVs, para a faturada há semanas aparecer na
  Expedição no dia em que sai. Diagnóstico `exp:cargas`.
- **Tela**: "expedidas hoje" no cabeçalho da coluna (e na lista); o passo
  "Agora: Expedição" da ficha com a data e a hora da confirmação; "envio
  confirmado" nas datas de cada carga; "Como a etapa é decidida" e o título do
  período atualizados.
- Testes (7d): confirmada hoje (OV de setembro, nota de outubro, período sem
  hoje) → Expedição; confirmada há 2 dias e remetida sem data → fora, contadas;
  o filtro pelo dia de Brasília; sem o campo → aviso. `sw.js` — cache
  `bm-comest-v81` (a v79 e a v80 foram do PI e do Faturamento do Dia, em paralelo).

### Kanban · Pallet sem data: TODAS as OVs no Pallet (11/11/2026)

O dono: "NÃO PRECISA DE DATA DO PALLET, pode trazer TUDO". Substitui o "Pallet =
as que foram para o Pallet hoje" e a parte de data da entrada do botão (abaixo):

- A coluna **Pallet** mostra toda OV que está no Pallet agora (carga Carregado
  com `ENVIARPALLET_CUSTOM = Sim`), **de qualquer data**, como o Faturado; sai
  quando a carga é Remetida (Expedição). O período fica só para Rejeitada e
  Expedição (`DATADAS`). As cargas Carregado entram com ou sem o Pallet
  (`ovsDeCargasCarregadas`), então a OV no Pallet é lida mesmo antiga.
- Saiu toda a data do Pallet: `api/shared/kanban-pallet-log.js` (o registro do
  botão no blob — `KANBAN_BLOB_URL` não é mais usado), `datarPallet`/
  `palletEmDe`, as colunas `palletData`/`alterada` da carga, os campos
  `palletDia`/`palletSemData`/`palletOutroDia` da resposta, os avisos, o
  "mudaram hoje" da coluna e a data no passo "Agora: Pallet" da ficha.
- Testes (7a): a OV no Pallet com nota antes do período aparece no Pallet; a
  faturada antes do período, gravada no Pallet, também. `sw.js` — cache
  `bm-comest-v78`.

### Kanban · sem o botão "Enviar para o Pallet" (11/11/2026)

O dono: "retira o BOTÃO ENVIAR PARA O PALLET". O Pallet passa a ser marcado só
no Dynamics (`ENVIARPALLET_CUSTOM = Sim` na carga) e o Kanban volta a ser SÓ
LEITURA:

- **Tela** (`pages/kanban.html`): saiu a seção do botão da ficha (pronta /
  enviada / ainda não dá), as funções `enviarPallet`/`postPallet`/
  `cargasPallet`, o `estado.enviadas` e o CSS `.kb-acao*`. O selo "p/ Pallet" do
  cartão fica (carga Carregado + cotação realizada), agora dizendo para marcar
  no Dynamics; o passo Pallet da ficha e "Como a etapa é decidida" também.
- **Servidor** (`api/kanban-ov`): o POST `enviar-pallet` responde **410**
  ("desativado") e não grava nada; `KANBAN_PALLET_BOTAO=1` religa (com o botão de
  volta na tela). O `enviarParaPallet` do motor fica, sem uso.
- **A data da mudança** para a coluna Pallet ("mudaram hoje"): os envios que o
  botão anotou continuam valendo; os novos, marcados no Dynamics, vêm de um campo
  de data do Pallet na carga (`KANBAN_COL_CARGA_PALLET_DATA`) ou da data de
  **alteração** da carga (`ModifiedDateTime`, aproximada). Sem nenhum dos dois na
  entidade de cargas, aviso no topo: a coluna Pallet fica vazia. Saiu o aviso do
  `KANBAN_BLOB_URL` (só o botão escrevia no registro).
- Testes (6): POST desligado → 410 sem gravar; religado, as regras de antes.
  `sw.js` — cache `bm-comest-v77`.

### Kanban · Pallet = as OVs que foram para o Pallet HOJE (11/11/2026)

O dono: "a mudança para o Pallet é mostrar somente as que mudaram no DIA para o
PALLET, não importando a data da OV" — "não no dia escolhido, e sim NA DATA
ATUAL: se eu tenho uma OV de 4 semanas atrás e ela mudou hoje para o Pallet, ela
tem que aparecer no Pallet". (Substitui o "Pallet sem data" da entrada abaixo.)

- **A coluna Pallet** mostra só as OVs cuja carga foi para o Pallet **hoje**
  (Brasília), de OV de qualquer data, e **não segue o período** da tela (que
  fica para Rejeitada e Expedição). Cabeçalho "mudaram hoje"; a resposta traz
  `palletDia`, `palletSemData` e `palletOutroDia`.
- **A data da mudança** (`datarPallet` / `palletEmDe`; a da OV é a da última
  carga dela que foi): 1º um campo de data do Pallet na carga, se o D365 tiver
  (`KANBAN_COL_CARGA_PALLET_DATA`, ou o pedaço do nome "pallet…data"); 2º **o
  registro do botão** — o D365 só grava `ENVIARPALLET_CUSTOM = Sim`, sem data,
  então o `/api/kanban-ov` (POST) anota cada envio num append blob mensal
  (`api/shared/kanban-pallet-log.js`, `kanban-pallet-AAAA-MM.jsonl`: carga, OV,
  quem, quando); 3º a data de **alteração** da carga (`ModifiedDateTime`), se a
  entidade expuser — aproximada, para a marcada direto no Dynamics.
- **Configuração**: `KANBAN_BLOB_URL` = SAS de CONTAINER (`sr=c`, Read + Create
  + Write); sem ela, usa o container do log de acessos (`LOG_PORTAL_BLOB_URL`).
  Sem as duas (e sem campo de data na carga), o botão grava no Dynamics mas
  avisa que a data não foi anotada, e o quadro avisa no topo.
- Na ficha, o passo "Agora: Pallet" diz quando foi e de onde veio a data. OV no
  Pallet sem data nenhuma fica fora da coluna, com aviso.
- Testes (7a, 9): com um Azure Blob falso — a OV de setembro enviada hoje
  aparece no Pallet com o período sem hoje; o registro (1 linha); o botão vale
  mais que a alteração; sem registro, a alteração de hoje vale e a de 3 dias
  atrás não; sem `KANBAN_BLOB_URL`, grava e avisa. `sw.js` — cache
  `bm-comest-v76`.

### Kanban · "mandei para o Pallet, porém não atualizou" (11/11/2026)

Três causas no caminho do botão "Enviar para o Pallet":

- **O Pallet era coluna DATADA** (só a OV com nota — ou, sem nota, a criação —
  no período, padrão hoje). Depois do botão, a OV faturada antes do período, ou
  a em Cotação/Aguardando criada antes, **sumia do quadro** (e a ficha fechava);
  e a carga já no Pallet nem era lida (`ovsDeCargasCarregadas` deixava de fora
  as com `ENVIARPALLET_CUSTOM = Sim`). Agora o Pallet sai das datadas, como o
  Faturado em 10/11: as cargas **Carregado** entram com ou sem o Pallet, e a
  coluna mostra toda OV que está nela agora, de qualquer data; sai quando a
  carga é Remetida (Expedição). O período fica só para Rejeitada e Expedição.
- **OV com mais de uma carga pronta**: o botão mandava só a 1ª e travava em
  "Enviada… aguardando o Dynamics" — a OV só vai para o Pallet com todas as
  cargas lá (vale a menos adiantada). Agora envia todas, uma de cada vez
  ("Enviar as N cargas"); a que faltar, o botão continua oferecendo.
- **Conferência depois de gravar** (`conferirPallet`): o servidor relê a carga na
  entidade de onde o QUADRO a lê (a 1ª que tem a carga: `WHSLoadTableBiEntity`,
  depois `WHSOutboundLoadHeaderEntity`) e devolve `confirmado` (true / false /
  null), `leitura` ({ entidade, coluna, valor }) e `aviso`. Se gravou numa e a
  leitura não mostra Sim, a ficha diz onde gravou e o que a leitura mostra, em
  vez de "aguardando" para sempre. O log da gravação leva `entidade`,
  `confirmado` e `leitura`.
- Testes (7, 7a, 8e, 9): Pallet fora das datadas; a OV faturada antes do período
  vai para o Pallet pelo botão (antes sumia); a releitura confirma; gravou na de
  cabeçalho e a BI não mostra Sim → `confirmado: false` com o aviso. Conferido
  no navegador com a API simulada (2 cargas, uma não confirmada).
  `sw.js` — cache `bm-comest-v75`.

### Kanban · selo "PI Pedidos" pela Área Demandante (11/11/2026)

O dono: "quando o pedido tiver AREADEMANDANTE (areademandante_Custom), sinalizar
que veio do PI Pedidos". O PI grava a Área Demandante na OV
(`api/pedido-enviar` · `Areademandante`); o Kanban procura o campo em todas as
entidades de OV que lê (principal + complementos: `SalesOrderHeadersV2`,
`BIOSalesOrderHeaderV1`…) — pelo nome sem caixa (`areademandante_Custom`,
`AreaDemandante_Custom`…, `KANBAN_COL_AREA`) ou pelo pedaço do nome
("area…demandante").

- Preenchido → `origemPi: true`, `areaDemandante` (o valor) e `areaCol`
  (entidade.coluna). Vazio → não é do PI.
- Tela: selo verde **PI Pedidos** no cartão e na lista (o título traz a área); na
  ficha, a etiqueta "Veio do PI Pedidos" e a "Área demandante" nos dados do
  pedido; a busca acha por "pi" e pela área.
- Sem o campo em nenhuma entidade lida: aviso no topo (o selo não aparece).
- Testes (4a): com a área → PI (e a coluna); vazia → não; sem o campo → aviso.
  `sw.js` — cache `bm-comest-v72` (a v69–v71 foram do PI, em paralelo).

### PI · Pedido liberado para o Comercial (11/11/2026)

Pedido do dono: "libera o PI PEDIDOS para todo mundo". O PI · Pedido
(`pages/pedido-inteligente.html`) deixa de ser só das duas contas do dono e
abre para quem tem a **área Comercial**, como os outros módulos do Comercial:

- `nav-sidebar.js` — `pedido-inteligente` saiu do gate por e-mail
  (`RESTRICTED`) e do `SO_DONO`: o link na seção AGENTES do menu, o cartão
  "Agentes de IA" da visão geral do Comercial e a página valem para todos com
  a área. O `SO_DONO` fica só com `comercial-faturamento-dono` (o selo e a
  sonda do Faturamento do Dia seguem do dono).
- `api/pedido-enviar` — saiu o `exigirDono` (`DONOS_PI`): o lançamento no
  Dynamics exige `requireArea(['comercial', 'estoque'])`, como o
  `/api/pedido-extrair` e o `/api/pedido-lotes`.
- `portal-catalogo.js` — o PI entrou no `MSB_VISIVEIS` (a busca da home).
- `nav-sidebar.js?v=88` em todas as páginas, `portal-catalogo.js?v=25`;
  `sw.js` — cache `bm-comest-v69`.

### PI · Pedido: a conta do lote (11/11/2026)

Pedido do dono: "vai continuar considerando o ALMOX-PA, vai pegar o estoque
físico do lote, PhysicalInvent, e analisar a localização que começa com 'PA.',
wMSLocationId, menos a reserva física do lote, ReservPhysical, que não tem
localização". No `/api/pedido-lotes`, por lote (`InventBatchId`), na empresa
`msb` e no depósito `ALMOX-PA`:

```
saldo do lote = Σ PhysicalInvent  das linhas com wMSLocationId começando com "PA."
              − Σ ReservPhysical  das linhas do mesmo lote SEM localização
```

- Saiu o `AvailPhysical` (Qtd. física disponível). Físico em localização fora
  de `PA.` não soma; reserva física de linha **com** localização não desconta.
- **Só estoque APROVADO** (11/11, pedido do dono: "InventStatusId tem que
  estar aprovado na hora de verificar o estoque"): só entram na conta — físico
  e reserva — as linhas com o status do estoque (`InventStatusId`) Aprovado.
  Quarentena, bloqueado, avariado, reprovado e status vazio ficam fora (cada
  item da resposta lista os ignorados em `foraDoStatus`). Compara sem
  maiúscula/acento e pelo começo (`ESTOQUE_MSB_STATUS`, padrão `aprov`). O
  filtro é no portal, não no OData; se a `BioInventSums` não trouxer o
  `InventStatusId`, o item volta com erro e a etapa Produtos avisa.
- **Linha `PA.` toda reservada** (11/11, pedido do dono): se numa localização
  `PA.` o `PhysicalInvent` do lote é **igual** ao `ReservPhysical`, a linha fica
  fora da conta (o físico dela não soma). Lote que só tem linha assim nem
  aparece; se o lote tiver outra localização `PA.` com saldo livre, só ela
  conta (ex.: `PA.06` 4 = 4 fora, `PA.07` 2 livre → lote com 2).
- A consulta à `BioInventSums` traz as linhas com `PhysicalInvent ne 0 or
  ReservPhysical ne 0` (antes `AvailPhysical ne 0`).
- Só lote com saldo **maior que zero** vai para a etapa Lotes (e para o Auto
  FEFO). O **disponível do produto** é a soma dos saldos positivos dos lotes: um
  lote com reserva maior que o físico em `PA.` fica em 0 e não desconta dos
  outros — assim o disponível bate com o que a etapa Lotes deixa alocar.
- Cada lote da resposta traz também `fisico` e `reserva` (a conta aberta).
- `ESTOQUE_MSB_LOCALIZACAO` agora é o prefixo da conta (padrão `PA.`; vazia
  também vale `PA.`). Se a `BioInventSums` não trouxer a Localização, o item
  volta com erro e a etapa Produtos avisa com o motivo (o 2º clique segue).
- A revalidação na hora de enviar usa a mesma API, então segue a mesma conta.
- `scripts/test-pedido-lotes.js` — a conta contra um F&O simulado (físico fora
  de `PA.`, reserva com localização, lote zerado e negativo, FEFO, filtro, tabela
  sem Localização). Só servidor: sem mudança de tela nem de cache.

### PI · Pedido: o endereço cadastrado do cliente (11/11/2026)

Pedido do dono: "trazer o endereço cadastrado do cliente igual do CRM; quando
o endereço não tá preenchido coloca NÃO INFORMADO — por enquanto quando digitar
o CNPJ e trazer as informações". Em `pedido-inteligente.js`
(`enderecoDoCadastro`), quando o CNPJ é validado:

- o PI consulta o cliente no Dynamics pela **mesma** rota do CRM (Nova
  oportunidade): `/api/cot-casos?cliente=<CNPJ>` (`shared/cot-erp.js`), e monta
  o endereço igual a ele: `endereço - bairro`;
- **é só informação** (11/11, o dono: "você tem que se basear no PDF, isso aqui
  é apenas uma informação para ele"): aparece **embaixo do Endereço de
  Entrega** do cabeçalho ("Endereço no cadastro do Dynamics: …") e nunca entra
  no campo. O campo é o do PDF (ou o da cotação); sem endereço no PDF, vai
  **NAO INFORMADO**. Cadastro sem endereço ou consulta que falhou: a linha
  embaixo diz NAO INFORMADO e o motivo. (Na 1ª versão, do mesmo dia, o endereço
  ficava no cartão "Cliente encontrado" e entrava no campo vazio.)
- não segura o Continuar: a linha embaixo aparece quando o Dynamics responder.
- `pedido-inteligente.js?v=39` (v=41 na versão "só informação"); `sw.js` —
  cache `bm-comest-v70` (v73 na versão "só informação"; a v72 foi a do selo do Kanban).

### PI · Pedido: o PDF vai para o site Pedidos MSB (11/11/2026)

Pedido do dono: o PI · Pedido salva o PDF que vai no fluxo na pasta
**PDF PI** do site **Pedidos MSB** (`/sites/PedidosMSB`, biblioteca
Documentos = `Shared Documents`). Antes ia para o site
`EquipeIntelignciaeDados`, pasta `Ordens de Compra PDF`.

- `pedido-inteligente.js` — `SP_PATH = '/sites/PedidosMSB'`,
  `SP_FOLDER = 'PDF PI'`. O identificador que vai para o flow passa a ser
  `/Shared Documents/PDF PI/<nome>` (relativo ao site novo).
- **O flow precisa acompanhar**: a ação do SharePoint do flow do
  `PEDIDO_FLOW_URL` ("Obter conteúdo do arquivo") tem o endereço do site fixo —
  tem que apontar para `https://tibiomedical.sharepoint.com/sites/PedidosMSB`.
- **Permissão**: o upload usa o login de quem está no PI (Graph, token
  delegado). Quem usa o PI precisa poder **editar** a biblioteca do Pedidos MSB;
  sem isso o upload falha e o pedido **não** é enviado (a tela diz o motivo).
- O PI · Consignação (`pi-consignacao.js`) segue na pasta antiga.
- `pedido-inteligente.js?v=40`; `sw.js` — cache `bm-comest-v71`.

### PI · Pedido: o código que quebra em duas linhas no PDF (11/11/2026)

O dono, com a OC 0003511 (Endotech): "o PI Pedido está trazendo o item pela
metade, pois houve quebra de linha". A coluna "Codigo Material" é estreita e
o código continua na linha de baixo, na mesma coluna — `UFGH-035` / `150RHS`,
`USDJ-472` / `6` —, e a IA devolvia só o pedaço de cima. Duas camadas, como
no RMS:

- **Regra para a IA** (`api/pedido-extrair`, `REGRAS_CODIGO` item 5): o pedaço
  da linha de baixo, na coluna do código, se junta sem espaço
  (`UFGH-035150RHS`, `USDJ-4726`); o da coluna da descrição continua a
  descrição.
- **Conferência contra o texto** (`api/shared/pedido-revisar.js`,
  `juntarCodigosQuebrados`, passo 4 do `revisar`): se a IA devolver o código
  pela metade, junta quando o código está numa linha de item, a linha de baixo
  só tem espaço antes da coluna dele e começa ali (±1) um pedaço com cara de
  código, que termina antes da coluna da descrição, e a linha de baixo não tem
  quantidade nem valor. Cada junção gera o aviso "o código estava quebrado em
  duas linhas no PDF (… + …) — juntei. Confira." na etapa Produtos.
- Não junta: continuação da descrição, item novo logo abaixo (tabela sem
  coluna de nº, com ou sem vírgula nos números), código que a IA já devolveu
  inteiro. O código juntado ainda passa pela validação no Power BI.
- `scripts/test-pedido-revisar.js` — a tabela da OC 0003511 exatamente como o
  `pi-pdf-texto.js` entrega à IA, e os casos que não podem juntar. Vale para
  os três perfis do extrator (pedido, consignado e cotação).

### PI · Pedido: o campo Transportadora (12/11/2026)

Pedido do dono: "um campo novo no PI chamado TRANSPORTADORA, que puxa os dados
da tabela SalesCarrierEntity e pega o nome da transportadora — não é
obrigatório".

- **Tela** (`pages/pedido-inteligente.html`): o select **Transportadora** no
  cabeçalho, depois de Condição de Entrega, **sem** asterisco — fica fora da
  conferência do Continuar. A 1ª opção é "Não informar". A revisão e o resumo
  mostram a transportadora (— / N/D quando vazia).
- **Lista** (`api/pedido-transportadoras`, novo, `GET`): lê a
  **`SalesCarrierEntity`** do Dynamics F&O (OData, as mesmas credenciais
  `D365_*`) na empresa `msb` e devolve o **nome** (`CarrierName`), sem
  repetidos, em ordem alfabética (traz também `CnpjOrCpf` e `Vendor`). Cache de
  10 min; `?atualizar=1` ignora. Mesmo acesso do envio: área Comercial ou
  Estoque.
  - O nome da entidade no OData é o "public collection name": tenta
    `SalesCarrierEntity` e depois `SalesCarriers` (404 = tenta a próxima).
    Se for outro, informar em `D365_TRANSPORTADORA_ENTITY`. Empresa:
    `TRANSPORTADORA_EMPRESA` (padrão `msb`); entidade sem `dataAreaId` é lida
    inteira, com aviso.
  - Se o Dynamics falhar, a resposta é 200 com `erro` e a tela mostra o motivo
    embaixo do campo; o pedido segue sem transportadora.
- **Flow** (`api/pedido-enviar`): campo novo **`Transportadora`** no JSON = o
  nome escolhido, ou `""` quando não escolhida. **O flow do `PEDIDO_FLOW_URL`
  precisa ler o campo** (`triggerBody()?['Transportadora']`) e gravá-lo na OV;
  enquanto não ler, o valor chega e é ignorado.
- `scripts/test-pedido-transportadoras.js` — contra um F&O simulado: nomes da
  msb em ordem, sem repetidos; entidade que não existe cai na próxima; entidade
  sem `dataAreaId`; cache; erros; e a `Transportadora` no JSON do flow.
- `pedido-inteligente.js?v=42`; `sw.js` — cache `bm-comest-v79`.

### Faturamento do Dia · ficha da nota no molde do Sales Report (12/11/2026)

Pedido do dono: "quero que o modal do faturamento diário seja parecido com o
do salesreport, com os campos que você tem na entidade: linha da NF, código,
descrição, preço, tipo de venda…". O painel com os campos crus virou a
**ficha da nota**, com o MESMO desenho da ficha do Sales Report: a página
carrega `sr-diario.css` e usa as classes `.sd-dw` (nada copiado).

- **Cabeçalho**: "Nota fiscal · venda/devolução", NF, cliente · conta ·
  cidade/UF, selos (Venda/Devolução, status, tipo de operação, tipo de venda,
  OV); ‹ › e as setas do teclado andam pela lista como está na tela; Esc
  fecha e o foco volta à linha. Rodapé com **Copiar nº** e "lido às · n de N".
- **Números-chave**: valor da nota (% das vendas — ou das devoluções — do
  dia), emissão (dia da semana · hoje/ontem) e itens/unidades.
- **Itens da nota** (`SalesInvoiceLines`): nº, produto, código, unidade,
  lote, descrição da linha (quando difere do produto), quantidade × preço,
  desconto e imposto da linha, valor.
- **Valores da nota**: soma dos itens, descontos, encargos, impostos e total;
  se a conta não fechar com o total gravado, a ficha diz a diferença.
- **Dados da nota**: OV, tipo de operação (FiscalDocumentOperationTypeId),
  **tipo de venda** (`SalesPurchOperationType_BR` da OV), status, conta ·
  CNPJ, condição de pagamento e de entrega, pedido do cliente, responsável
  (matrícula), lançamento contábil e endereço de faturamento.
- Recolhidos: **Campos do Dynamics** (o dado cru de antes — diário, linhas,
  documento fiscal, operação da OV, diagnóstico — com "Copiar tudo (JSON)") e
  **Como entra nesta lista**.
- **API**: `GET /api/faturamento-hoje?nota=…&data=AAAA-MM-DD` — `detalheNota()`
  em `api/shared/faturamento-dia.js` devolve, além do cru, `nota` (o registro
  do diário do dia pedido; sem data, o registro 1), `itens`, `operacao` (as
  colunas de operação da OV, `operacoesDasOvs` do Kanban) e `cliente`. Cada
  campo por vários nomes (`COLS_CAB`, `COLS_ITEM`); número repetido no diário:
  ficam só as linhas da data do registro escolhido.
- Testes: `node scripts/test-faturamento-dia.js` (caso 6b). `sw.js` — cache
  `bm-comest-v80` (v77–v79 foram de outras sessões no mesmo dia).

### Sales Report · ficha do dia no Faturamento por Dia (13/11/2026)

Pedido do dono: "no salesreport, quero que você implemente esse modal quando
clicar nas colunas, igual aqui do portal da bio". Veio do portal completo
(`b093755`, 23/10/2026 — depois da cópia deste portal): clicar numa coluna do
gráfico **Faturamento por Dia** (Visão Geral) abre, à direita, a **ficha do
dia**, no mesmo painel `.sd-dw` das listas Pedidos em andamento / Faturamento
diário.

- **Números do dia**: faturado (% do período), notas fiscais (ticket médio),
  clientes (o maior), contra a média dos dias com faturamento, ritmo da meta
  (só com um mês no período: meta do mês ÷ dias úteis seg–sex) e a margem do
  dia contra a do período (só para quem vê a margem — memória de OLS do freio).
- **Diagnóstico do dia**, escrito a partir dos números: força do dia, ritmo
  da meta, concentração das notas, peso do cliente, o que puxou (estratégia,
  família), margem, valores negativos, fim de semana, hoje em andamento e
  vários meses no mesmo dia.
- **Quebras** por estratégia, família, cliente e as outras (vertical, filial,
  UF, vendedor; data com vários meses) — clicar numa linha filtra o resto da
  ficha (filtro cruzado). **Notas fiscais** do dia com busca; clicar abre a
  nota com emissão, vendedor, filial, o que a compõe e os itens lidos na hora.
- ‹ › e ← → andam entre os dias com faturamento; Esc fecha; Enter no gráfico
  abre o último dia; a barra do dia aberto fica petróleo. **Excel do dia**
  (abas Notas, Linhas e Diagnóstico).
- A consulta é a do gráfico (mesmo filtro-base, com a Empresa fixa em MSB) +
  `'Calendário'[Dia] = N`: a ficha soma igual à barra.

**RECORTE MSB** (no `sr-dia.js`): a empresa não vira quebra, nem selo no
cabeçalho (o "BIO · R$ … / MSB · R$ …" do completo), nem linha da nota; o
"Como conta" diz "Só a empresa MSB". A coluna continua na consulta e no Excel.

- `sr-dia.js` + `sr-dia.css` (convertido pelo `scripts/msb-cores.js` — não
  converta de novo); `pages/comercial-sales-report.html` liga o gráfico.
- Testes: `node scripts/test-sr-dia.js` (90 verificações, com o recorte MSB).
- Teste local: o `.claude/fake-pbi-generico.js` responde o gráfico e a ficha
  do dia com notas sintéticas por dia útil (devolução no dia 5).
- `sw.js` sem troca de versão: a página é rede-primeiro e os arquivos novos
  entram com `?v=1`.

## Como colocar no ar

1. **Repositório no GitHub** — crie um repositório **privado e vazio** (sem
   README) e suba esta pasta:
   ```bash
   git init -b master
   git add .
   git commit -m "Portal Comercial & Estoque: cópia enxuta do portal corporativo"
   git remote add origin https://github.com/<conta>/<repositorio>.git
   git push -u origin master
   ```
2. **Static Web App nova** — no portal do Azure: *Criar recurso › Static Web
   App*, mesma assinatura/grupo de recursos do portal atual, plano igual ao
   dele. Em *Deployment details* escolha **Other** (não GitHub): o workflow
   já vem pronto neste repositório (`.github/workflows/deploy.yml`, com o
   `skip_app_build`/`skip_api_build` que o portal atual usa). Escolher GitHub
   faria o Azure gravar um SEGUNDO workflow.
   Depois de criada: *Overview › Manage deployment token* › copie o token. No
   GitHub, no repositório novo: *Settings › Secrets and variables › Actions ›
   New repository secret*, nome `AZURE_STATIC_WEB_APPS_API_TOKEN`, valor = o
   token. Depois: *Actions › Deploy · Portal Comercial & Estoque › Run
   workflow* (ou qualquer push na `master`).
3. **Login** — no Entra ID, *App registrations › 129978ce… › Authentication*,
   em **Single-page application**, adicione o endereço novo **com a barra no
   fim**: `https://<nome>.azurestaticapps.net/`. Só acrescenta; o portal atual
   continua igual.
4. **Variáveis de ambiente** — na Static Web App ATUAL, *Settings › Environment
   variables › Advanced edit*, copie o JSON para um arquivo local
   `variaveis-atual.json` e rode:
   ```bash
   node .claude/filtrar-variaveis.js variaveis-atual.json https://<nome>.azurestaticapps.net > variaveis-novo.json
   ```
   Cole o conteúdo de `variaveis-novo.json` no *Advanced edit* da Static Web
   App NOVA e salve. **Apague os dois arquivos** depois (têm segredos; o
   `.gitignore` já impede que subam). O filtro deixa só as variáveis que as 20
   Functions leem (PORTAL_*, PBI_*, D365_*, SF_*, AOAI_*, PEDIDO_*, COT_*,
   FCA_*, os blobs, os fluxos e o Direct Line) e troca
   `PORTAL_ALLOWED_ORIGINS` para o endereço novo.
5. **Domínio (opcional)** — ex.: `comercial.biomedical.com.br`: *Custom
   domains* na Static Web App + CNAME no DNS (TI). Se usar, cadastre também
   esse endereço no passo 3 e em `PORTAL_ALLOWED_ORIGINS`.

### Cuidados

- **Minutos do GitHub Actions**: repositório privado na mesma conta divide a
  franquia mensal com o portal completo. Cada push aqui consome do mesmo saldo.
- **Blobs compartilhados**: os dois portais escrevem nos mesmos arquivos. A
  assinatura de e-mail e as varreduras agendadas (Vigia etc.) continuam só no
  portal completo — não crie uma segunda aqui.
- **Log de entradas**: os acessos daqui vão para o mesmo log do completo
  (TI › Log de Entradas); o campo `ref` mostra o endereço do portal.
- **Grupo sem mapeamento**: como no completo, quem não cai em nenhum grupo
  mapeado vê as áreas (fail-open herdado). Para fechar, mapeie o grupo em
  `GRUPO_AREAS`.

## Trazer novidades do portal completo

**CRM › Venda Recorrente:** os `cotacoes*.js`, as `comercial-cot-*` e o
`api/shared/cot-*` têm ajustes `RECORTE MSB` (empresa, número, OV, unidade,
armazenamento) — não copie por cima; traga só o que mudou e reaplique.

Os arquivos são os mesmos do completo. Para atualizar um módulo, copie o
arquivo de lá e, se for um dos arquivos da lista "O que mudou", reaplique o
trecho `RECORTE COMERCIAL + ESTOQUE`. Página ou Function nova: confira se ela
chama outra Function ou script que ainda não está aqui.

**Atenção ao `pbi-throttle.js`:** o daqui tem o bloco `RECORTE MSB` (só a
empresa MSB). Copiar o do completo por cima apaga essa regra — traga só o que
mudou lá e mantenha o bloco. O mesmo para a Empresa fixa do Sales Report e da
Performance de Vendas, o filtro de `"BIO"` do `voz-embed.js` e a regra EMPRESA
de `api/shared/comercial-schema.js`.

O arquivo do completo chega **azul e com as fontes da Biomedical**. Depois de
copiar, converta **só os arquivos que acabaram de chegar** (rodar de novo num
arquivo já convertido acinzenta as cores):

```bash
node scripts/msb-cores.js . --write pages/arquivo-novo.html
```

e troque as fontes (`Outfit`/`Manrope`/`Plus Jakarta Sans` → `Roboto`, link do
Google Fonts `family=Roboto:wght@300..900`), o logo (`/icons/logo-msb.png`) e o
"· Biomedical" do `<title>`.

## Teste local

Pasta `.claude/` (fora do git): `node .claude/teste-server.js` e abra
`http://localhost:4321/index.html?fake=1` — login e Power BI de mentira;
`/api/my-areas` e `/api/alertas` rodam o código de verdade. O recorte MSB
responde BIO/MSB no modelo de mentira; `&empresa=sem` simula um modelo sem a
MSB e `&empresa=nenhuma` um modelo sem tabela de empresa.
