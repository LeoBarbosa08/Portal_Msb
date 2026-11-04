# Pedido Inteligente — versão nativa no portal

Migração do agente **PI (Pedidos)** do Copilot Studio para código no portal.
Página: `pages/pedido-inteligente.html` · JS: `pedido-inteligente.js` ·
Backend: `api/pedido-extrair` e `api/pedido-enviar`.

## Arquitetura

```
Operador (navegador, logado via Entra — auth.js)
  │
  ├─ 1. Anexa o PDF da OC
  │      pdf.js + pi-pdf-texto.js extraem o TEXTO COM AS COLUNAS no navegador
  │      └─> POST /api/pedido-extrair { texto, filename }
  │            ├─> Azure OpenAI (structured output) → JSON com os campos
  │            └─> shared/pedido-revisar.js confere item por item contra o
  │                texto do PDF → corrige quantidade x valor e devolve avisos
  │
  ├─ 2. Valida CNPJ ─────────┐
  ├─ 4. Valida produtos ─────┤ DAX no dataset COMERCIAL via voz-pbi.js
  │                          └ (token do USUÁRIO → RLS ok, funciona no PPU)
  │
  └─ 5. Confirma o envio
         └─> POST /api/pedido-enviar { cabecalho, produtos, totalGeral, resumo, pdf }
               └─> Power Automate (gatilho HTTP) → envia o pedido no sistema
                                                  → salva o PDF no SharePoint
```

O que era ~12 AI Builder models + 7 flows no Copilot Studio virou:
**1 chamada de LLM** (extração do PDF) + JavaScript determinístico + 2 consultas DAX + 1 flow.

**Chegando de outro módulo** (PDF e leitura já prontos, entregues por IndexedDB via
`customer-service-pi.js`; o PI pula o upload e a IA e, ao enviar, registra no caso de origem —
`ORIGENS_PI` em `pedido-inteligente.js`):

* `?cs=CS-…` — caso do Customer Service (ver `docs/customer-service.md`);
* `?cot=COT-…` — cotação que virou pedido no módulo Cotações; o PI já preenche portal, área
  demandante, empresa e OC com o que está no caso (ver `docs/cotacoes.md`).

O `/api/pedido-extrair` também atende o perfil `cotacao` (a leitura do PDF da cotação no Agente
de Cotações), com prompt e JSON Schema próprios; os perfis `pedido` e `consignado` não mudaram.

## Leitura do PDF: por que ela trocava QUANTIDADE por VALOR (conserto de 09/09/2026)

O sintoma: a OC 8036 do Hospital Nossa Senhora das Graças (SOULMV) trazia
`Qtd Compr. 10,0000` e `Vl.Unit. 720,0000`, e a tela mostrava **720 x R$ 10,00**.
Valia para o PI Pedido e para o PI Consignação — os dois usam o mesmo endpoint.

Três causas, em camadas, e o que cada uma virou:

1. **O texto chegava embaralhado.** Cada página tinha sua cópia de
   `pdfParaTexto()`, que percorria `tc.items` na ordem em que o PDF DESENHA o
   texto — e o ERP desenha a célula do valor unitário antes da de quantidade.
   A IA recebia `MSB 720,0000 7.200,00 10,0000 UNIDADE` e lia o primeiro número
   como quantidade. Agora existe **um** `pi-pdf-texto.js` (`window.PIPDF`), que
   ordena cada linha por X e reconstrói as colunas numa grade de caracteres —
   o número cai debaixo do rótulo dele. Testes: `node .claude/pi-pdf-testes.js`.
2. **O prompt não ensinava a ler tabela.** Ganhou o bloco `REGRAS_TABELA`
   (ancore no cabeçalho; rótulos de qtd e de unitário; qtd x unit = total;
   quantidade é contagem de peças, valor unitário é dinheiro) e o campo
   `valorTotal` por item. O `reasoning_effort` deste endpoint saiu de `minimal`
   para `low` (`PEDIDO_REASONING`) — com o texto já vindo em colunas, o modelo
   não precisa pensar muito; o teto de tokens acompanha, porque o raciocínio
   sai do mesmo orçamento (ver a nota do 429 abaixo).
3. **Ninguém conferia a resposta.** `api/shared/pedido-revisar.js` confere cada
   item contra o texto: a trava `qtd x unit = total` não pega inversão (a
   multiplicação é comutativa), então quem pega é a **posição** — se o número
   que a IA chamou de quantidade está na coluna do unitário, ele troca e avisa.
   Só age com cabeçalho identificado e os dois números sem ambiguidade na linha;
   na dúvida, não mexe e só avisa. Testes: `node .claude/pi-revisar-testes.js`.

Os avisos voltam em `avisos: [{ item, tipo, corrigido, texto }]` e a tela mostra
uma faixa âmbar na etapa de itens, com a linha destacada; mexer no item tira o
aviso. Tipos: `invertido`, `total`, `sem-quantidade`, `sem-valor`,
`texto-cortado`.

Para ver rodando, com uma IA falsa que erra de propósito:

```bash
node .claude/pi-pdf-gerar-caso.js && node .claude/pit-teste-server.js
```

e em http://localhost:4200/pages/pi-pedido-teste.html?fake=1 suba o
`.claude/stub/oc-8036.pdf` (`--ia-certa` faz a IA falsa acertar, para conferir
que a revisão não estraga o que já estava certo).

### "Azure OpenAI 429" na tela (10/09/2026)

O recurso do Foundry é **compartilhado por 8 endpoints** do portal
(`chat`, `licitacao-analisar`, `licitacao-radar-scan`, `leads-analisar`,
`leads-medicos-analisar`, `dossie-ganchos`, `transcrever`, `pedido-extrair`), e
a LICI sozinha é ~96% do consumo. Quando o PI cai numa janela ocupada, o Azure
responde 429 e a extração morria ali, mostrando o código cru na tela.

Duas coisas, nessa ordem:

1. **O teto de tokens conta na cota.** O Azure ESTIMA o custo do request
   somando os tokens do prompt com o `max_completion_tokens` que você pediu —
   não com o que a resposta realmente gastou. O teto de `16000` que entrou em
   09/09 fazia uma extração reservar a janela quase inteira e voltar 429. Desceu
   para `6000` com `reasoning: low`. **Se for subir `PEDIDO_MAXTOKENS`, lembre
   que isso reduz quantas extrações cabem por minuto.**
2. **429 agora tem retry.** `chamarAOAI()` respeita o header `retry-after` do
   Azure e tenta de novo (`PEDIDO_RETRIES`, default 2), desistindo se a espera
   pedida passar de `PEDIDO_ESPERA_MAX` (20s) para não pendurar o operador. O
   que sobra vira mensagem em português com quantos segundos esperar. Testes:
   `node .claude/pi-retry-testes.js` (fetch de mentira, nada sai da máquina).

Se o 429 virar rotina mesmo assim, o caminho é cota: pedir TPM maior para o
deployment ou um deployment separado para a LICI.

## Variáveis de ambiente (Configuração da Static Web App / Function App)

| Variável | Uso | Status |
|---|---|---|
| `AOAI_ENDPOINT` | Azure OpenAI (mesmo do /api/chat) | ⏳ TI provisionar |
| `AOAI_KEY` | idem | ⏳ TI provisionar |
| `AOAI_DEPLOYMENT` | ex.: `gpt-4o-mini` | ⏳ TI provisionar |
| `PEDIDO_REASONING` | esforço de raciocínio da extração (default `low`; vazio = não envia o parâmetro) | opcional |
| `PEDIDO_MAXTOKENS` | teto de tokens da resposta, raciocínio incluído (default `6000`) — **subir isso pesa na cota TPM, ver abaixo** | opcional |
| `PEDIDO_MAXCHARS` | quanto do texto do PDF entra no prompt (default `80000`) | opcional |
| `PEDIDO_RETRIES` | quantas vezes tentar de novo quando o Azure devolve 429 (default `2`) | opcional |
| `PEDIDO_ESPERA_MAX` | espera máxima aceita do header `retry-after`, em segundos (default `20`) | opcional |
| `PEDIDO_FLOW_URL` | URL do gatilho "Quando uma solicitação HTTP é recebida" do flow de envio | ⏳ criar flow e colar a URL |
| `D365_TENANT_ID` | tenant do Entra (GUID) | ⏳ TI / App Registration |
| `D365_CLIENT_ID` | Application (client) ID do App Registration | ⏳ TI / App Registration |
| `D365_CLIENT_SECRET` | segredo do App Registration | ⏳ TI / App Registration |
| `D365_RESOURCE_URL` | `https://mlb.operations.dynamics.com` (default) | opcional |
| `D365_ENTITY` | entidade de saldo `BioInventSums` (default) | opcional |
| `D365_BATCH_ENTITY` | entidade de validade `BioInventItemBatchV3` (default) | opcional |
| `ESTOQUE_LOCATION` | depósito padrão consultado (default `BCD`) | opcional |
| `ESTOQUE_EMPRESA` | empresa/dataAreaId (default `bio`; vazio = todas) | opcional |

Sem `AOAI_*`: a página avisa e oferece preenchimento manual (o resto funciona).
Sem `PEDIDO_FLOW_URL`: tudo funciona até a revisão; o envio retorna erro claro.

## Contrato do JSON enviado ao Power Automate

O `/api/pedido-enviar` faz POST deste corpo no `PEDIDO_FLOW_URL`:

```json
{
  "origem": "portal-pedido-inteligente",
  "enviadoEm": "2026-07-03T14:00:00.000Z",
  "cabecalho": {
    "cnpj": "67.185.694/0001-50",
    "codCliente": "C00123",
    "nomeCliente": "GRUPO DE APOIO ...",
    "ordemDeCompra": "84938",
    "enderecoEntrega": "ALMOXARIFADO CENTRAL — R Pedro de Toledo, Vila Clementino, São Paulo SP",
    "email": "comprador@cliente.org.br",
    "condicaoPagamento": "30 DIAS",
    "dataVencimento": "",
    "usaDataVencimento": false,
    "frete": "CIF - SEM VALOR",
    "condicaoEntrega": "PADRÃO",
    "tipoVenda": "VENDA DIRETA",
    "areaDemandante": "PEDIDOINTELIGENTE (VENDA RECORRENTE)",
    "vendedor": "NAO INFORMADO",
    "caso": "N/D",
    "portal": "NAO INFORMADO",
    "observacao": "",
    "observacaoNota": "",
    "operador": "Fulano de Tal"
  },
  "produtos": [
    { "codigo": "7024S11PDH", "produto": "PULSEIRA IDENTIFICACAO ...", "quantidade": 500, "valorUnitario": 1.91, "total": 955 }
  ],
  "totalGeral": 955,
  "resumo": "PEDIDO — ORDEM DE COMPRA 84938\n... (texto pronto p/ Teams/e-mail)",
  "pdf": { "filename": "OC 84938.pdf", "base64": "JVBERi0xLj..." }
}
```

O `/api/pedido-enviar` monta esse JSON exato a partir do cabeçalho + produtos
(mapeamento em `montarSchema`). Na etapa de Lotes cada produto pode ter parte em
lote(s) e parte **sem lote** (campo de quantidade "Sem lote" na tabela) — a soma
(lotes + sem lote) tem de bater com a quantidade do produto. A parte sem lote vai
como uma entrada em `Lotes[]` com `Lote: ""`. Cada lote tem **preço próprio**
(coluna "Preço unit." na tabela, default = valor unitário do produto, editável) —
esse preço vai em `PrecoLote`, e o `ValorTotal` do pedido é recalculado como a soma
de `quantidade × PrecoLote` de todos os lotes. `Quantidade` (top-level) = soma das
quantidades; `PoliticaCredito`/`ID` = "" (não coletados ainda).

### Data de Vencimento do Pagamento (flag)

No cabeçalho existe a caixinha **"Data de vencimento"** ao lado de *Condição de
Pagamento*. Ligada, ela abre o campo **Data de Vencimento do Pagamento** e a
condição de pagamento deixa de ser obrigatória (o select é limpo e desabilitado).
Desligada, nada muda: o fluxo é exatamente o de hoje.

No JSON que chega ao Power Automate (schema em `docs/pedido-fluxo-schema.json`):

| Campo | Flag DESLIGADA (hoje) | Flag LIGADA |
|---|---|---|
| `CondicaoPagamento` | a condição escolhida | `""` (vazia) |
| `DataVencimentoPagamento` | `""` (vazia) | `"AAAA-MM-DD"` |
| `UsaDataVencimento` | `false` | `true` |

No flow, ramificar com `triggerBody()?['UsaDataVencimento']` (ou
`empty(triggerBody()?['DataVencimentoPagamento'])`). A data vai em **ISO curto**
(`2026-09-30`); para o formato brasileiro use
`formatDateTime(triggerBody()?['DataVencimentoPagamento'], 'dd/MM/yyyy')`.
O `/api/pedido-enviar` normaliza a data e força `CondicaoPagamento` vazia quando
a flag está ligada — o flow nunca recebe os dois preenchidos.

A **política de crédito** é uma tabela indexada pela condição de pagamento; sem
condição não há o que validar, então `PoliticaCredito` vai com o aviso
"Pagamento por data de vencimento — sem condição de pagamento para validar na
política de crédito".

### Montagem do flow (Fase 1 — reaproveita a lógica atual)

1. Novo flow com gatilho **"Quando uma solicitação HTTP é recebida"** (método POST).
   Cole o JSON acima em "Usar carga de exemplo para gerar o esquema".
2. **Criar arquivo** (SharePoint) — mesma biblioteca usada hoje pelo agente:
   `Nome` = `triggerBody()?['pdf']?['filename']`,
   `Conteúdo` = `base64ToBinary(triggerBody()?['pdf']?['base64'])`.
   (Colocar dentro de uma condição `pdf != null` — pedido manual não tem PDF.)
3. Reaproveitar as ações do flow atual de envio (o que hoje recebe o texto do
   Copilot), alimentando com `triggerBody()?['resumo']` e/ou os campos
   estruturados de `cabecalho`/`produtos` — agora não precisa mais parsear texto.
4. Copiar a **URL HTTP POST** do gatilho e salvar como `PEDIDO_FLOW_URL` na
   configuração da Static Web App.

## Validações no BI (Fase 1)

- **Produtos:** `'Produtos'[Cód. produto]` / `'Produtos'[Produto]` (nomes confirmados
  no modelo Comercial).
- **Clientes:** a página descobre as colunas em runtime (`EVALUATE TOPN(1,'Clientes')`)
  e procura CNPJ (`/cnpj/i`), código (`/[cod/`) e nome. Se o dataset Comercial não
  tiver CNPJ/código do cliente, o console mostra as colunas encontradas e a página
  permite informar código/nome manualmente. Nesse caso: adicionar as colunas na
  dim Clientes do dataset OU apontar a validação para outro dataset.

## Validação de ESTOQUE + LOTES — Dynamics 365 Finance & Operations (OData direto)

**Sem Power Automate.** A Function `api/pedido-lotes` (helper `api/shared/d365.js`)
fala OData direto com o F&O: autentica no Entra por client-credentials (token em
cache) e cruza DUAS entidades por código de produto:
- `BioInventSums` → lotes (`InventBatchId`) com `AvailPhysical > 0` no depósito;
- `BioInventItemBatchV3` → validade (`expDate`) de cada lote.

Classifica cada lote pela proximidade do vencimento e devolve a lista **ordenada
por validade (FEFO)**:

| Categoria | Faixa |
|---|---|
| Vencido | dias < 0 |
| Próximo do vencimento | ≤ 30 dias |
| Muito curta | 1 a 3 meses |
| Curta | ≤ 6 meses |
| Normal | ≤ 1 ano |
| Boa | > 1 ano |
| Muito boa | > 2 anos |

Fluxo: etapa de Produtos → `/api/pedido-lotes { codigos:[...] }` → a coluna
**Disponível** preenche (soma dos lotes) e abre a etapa **Lotes**, onde o operador
escolhe quanto tirar de cada lote (badge de validade colorido) **e/ou** quanto vai
**sem lote** (linha "Sem lote" na tabela) — um mesmo item pode ser parte em lote e
parte sem lote. O botão **Auto (FEFO)** preenche dos lotes que vencem primeiro e
joga o que sobrar (além do estoque de lotes) para "Sem lote". A soma (lotes + sem
lote) precisa bater com a quantidade. As alocações vão no payload
(`produtos[].lotes`, com `batch:""` para a parte sem lote) e no resumo. Se faltar
estoque total, avisa e deixa prosseguir no 2º clique (consignação/backorder).

### O que a TI precisa provisionar (uma vez)

1. **App Registration** no Entra (Azure AD): criar o app, gerar um **client
   secret**. Anotar Tenant ID, Client ID e o secret.
2. **Registrar o Client ID DENTRO do F&O** — passo obrigatório e o que mais
   causa 401: em `Administração do sistema > Configuração > Aplicativos do
   Microsoft Entra ID`, adicionar o Client ID, associá-lo a um **usuário de
   serviço** e a uma **função de segurança** com leitura de estoque.
3. Salvar na configuração da Static Web App: `D365_TENANT_ID`, `D365_CLIENT_ID`,
   `D365_CLIENT_SECRET` (e, se diferentes dos defaults, `D365_RESOURCE_URL`,
   `D365_ENTITY`, `ESTOQUE_LOCATION`, `ESTOQUE_EMPRESA`).

Sem as 3 variáveis de credencial: o portal não mostra a coluna de estoque
(coluna fica "—") e o pedido segue normal.

### Chamadas OData usadas (referência)

```
# 1) lotes com saldo
GET {resource}/data/BioInventSums?cross-company=true
    &$filter=dataAreaId eq 'bio' and InventLocationId eq 'BCD'
             and ItemId eq '7024S11PDH' and AvailPhysical gt 0
# campos usados: InventBatchId, AvailPhysical

# 2) validade dos lotes do item
GET {resource}/data/BioInventItemBatchV3?cross-company=true
    &$filter=dataAreaId eq 'bio' and itemId eq '7024S11PDH'
# campos usados: inventBatchId, expDate

Authorization: Bearer <token client-credentials, scope {resource}/.default>
```

> Se os nomes de campo forem diferentes na sua `BioInventSums`/`BioInventItemBatchV3`,
> o backend lê de forma tolerante a maiúsc./minúsc.; ajuste em `api/pedido-lotes`
> se preciso.

## Fase 2 (futuro)

- Trocar o flow de envio por chamada direta à API do ERP (ou MCP), eliminando o
  Power Automate.
- PDFs escaneados (imagem): hoje caem no preenchimento manual. Adicionar OCR via
  Azure Document Intelligence (prebuilt purchase order) no `/api/pedido-extrair`.
