# Portal MSB · Comercial & Estoque

Cópia enxuta do Portal Corporativo com **só as áreas Comercial e Estoque**
(repositório `LeoBarbosa08/Portal_Msb`). Montada em 16/10/2026 e atualizada
em 20/10/2026 a partir da versão publicada do portal completo
(`origin/master` 53bb495 de `LeoBarbosa08/Claude.rep`, de 19/10). O portal
completo não foi alterado.

Usa as **mesmas fontes de dados** do portal completo: o mesmo login do Entra
(App Registration `129978ce…`), o mesmo Power BI, Dynamics 365, Salesforce,
Azure OpenAI, os mesmos fluxos do Power Automate e os **mesmos blobs** — o
que alguém faz aqui (FCA, Cotações, fila do Vigia, avisos do mural) aparece
no portal completo e vice-versa.

## O que tem

| Área | Páginas |
|---|---|
| Comercial | Visão geral · Sales Report (6 abas) · Negociações + Analítico · Cotações (reservado ao dono, como no completo) · FCA · Sales Playbook · Materiais · Tabela de Preços |
| Comercial · agentes | Dossiê de Visita · PI · Pedido · PI · Consignação · PI · Consignação (INCOMPLETO, em testes) · Agente de Cotações · Agente Comercial |
| Estoque | Visão geral · Gestão de Estoque (Saldo, Ruptura, Validade Curta, Movimentações) · Gestão de Consignação (Saldo Consignado, Saldo por Nota, Devoluções, Rastreabilidade, GMROI) · Perdas · InventarIA · Consignado |
| Estoque · agentes | Vigia de Consignação · Agente de Estoque |
| Contábil | Visão geral · Gestão de Custos SG&A (só a MSB) |
| Comum | Home, busca (Ctrl+K), Central de Avisos, tema escuro, celular, PWA |

22 Functions em `api/`: `my-areas`, `alertas`, `avisos`, `pbi-query`,
`directline-token`, `chat`, `transcrever`, `comercial-funil`, `cot-casos`,
`cot-config`, `fca`, `pedido-extrair`, `pedido-enviar`, `pedido-lotes`,
`consig-lote`, `consig-faturar`, `consig-processo`, `dossie-cliente`,
`dossie-ganchos`, `dossie-agenda`, `consig-vigia-scan`, `consig-vigia-fila`.

## O que mudou em relação ao portal completo

Tudo marcado no código com o comentário `RECORTE COMERCIAL + ESTOQUE`.

- `api/shared/auth.js` — `ALL_AREAS` = `comercial`, `estoque` e (desde 22/10/2026) `contabil`. O mapa de
  grupos (`GRUPO_AREAS`) ficou **igual** ao do completo: quem tem outra área lá
  não ganha nada aqui. Módulo avulso de outra área (`GRUPO_MODULOS`) não passa.
- `api/my-areas` — saíram o convite da Votação OKR e o líder dos Indicadores
  (Diretoria e Gerencial não existem aqui).
- `api/alertas` — a faixa "Para você" só tem o Vigia de Consignação e o mural.
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
- Ficam de fora o InventarIA (planilha enviada pela pessoa, sem coluna de
  empresa) e o que o portal não lê do Power BI.
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
  `logo-msb-branco.png`, `msb-simbolo*.png` (só o "mSb", usados pelo InventarIA),
  `icon-192/512`, `apple-touch-icon` e `favicon.ico` com o "mSb" branco no teal.
  Gerados a partir do logo do site (`logo-msb-2.png`).
- **Nomes** — "Portal MSB" (título da home, PWA, manifest); as abas terminam em
  "· MSB"; rodapés "© MSB · Medical System do Brasil".
- **Login** — logo da MSB, "Tudo da MSB em um só lugar."; o BioNiko (mascote da
  Biomedical) está desligado (`MASCOTE = false` em `auth.js`) e fica o brilho em CSS.
- **Rodapé** — links do msbbrasil.com (institucional, contato, produtos,
  Instagram, LinkedIn). O site não publica telefones, então não há "Unidades".
- `sw.js` — cache `bm-comest-v3`, para o navegador não servir o visual antigo.

**Continua Biomedical, de propósito:** a proposta comercial em PDF
(`cotacoes-proposta.js` + `assets/proposta-*.jpg`, timbrado e razão social), o
"Cód. Biomedical" dos produtos, os atalhos de sistemas compartilhados (Salesforce,
SharePoint BioPortal, Zendesk, e-mails @biomedical), as pastas de materiais de
marketing e o texto do Sales Playbook.

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
   `.gitignore` já impede que subam). O filtro deixa só as variáveis que as 22
   Functions leem (PORTAL_*, PBI_*, D365_*, SF_*, AOAI_*, PEDIDO_*, COT_*,
   VIGIA_*, FCA_*, os blobs, os fluxos e o Direct Line) e troca
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
