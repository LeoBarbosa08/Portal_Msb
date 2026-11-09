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
| Comercial · agentes | Dossiê de Visita · PI · Pedido (no menu, só para o dono — ver "PI · Pedido de volta") · PI · Consignação · PI · Consignação (INCOMPLETO, em testes) · Agente Comercial (o Agente de Cotações virou o "Nova oportunidade" do CRM) |
| Estoque | Visão geral · Gestão de Estoque (Saldo, Ruptura, Validade Curta, Movimentações) · Gestão de Consignação (Saldo Consignado, Saldo por Nota, Devoluções, Rastreabilidade, GMROI) · Perdas · Consignado |
| Estoque · agentes | Agente de Estoque |
| Contábil | Visão geral · Gestão de Custos SG&A (só a MSB) |
| Comum | Home, busca (Ctrl+K), Central de Avisos, tema escuro, celular, PWA |

21 Functions em `api/`: `my-areas`, `alertas`, `avisos`, `pbi-query`,
`directline-token`, `chat`, `transcrever`, `comercial-funil`, `cot-casos`,
`cot-config`, `cot-ov-retorno`, `fca`, `pedido-extrair`, `pedido-enviar`, `pedido-lotes`,
`consig-lote`, `consig-faturar`, `consig-processo`, `dossie-cliente`,
`dossie-ganchos`, `dossie-agenda`.

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
  avisa uma vez com o motivo e o 2º clique segue sem estoque.
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
  PDF). O PI da MSB segue só do dono (ver "PI · Pedido de volta").
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
