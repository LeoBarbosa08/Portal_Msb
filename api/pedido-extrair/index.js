// ================================================================
// /api/pedido-extrair  —  Pedido Inteligente (portal)
//
// Substitui o AI Builder do Copilot Studio: recebe o TEXTO da ordem
// de compra (o navegador extrai o texto do PDF com pdf.js) e usa o
// Azure OpenAI (structured output) para devolver os campos do pedido
// em JSON. A chave do Azure OpenAI fica só aqui no backend.
//
//   POST /api/pedido-extrair   { texto: string, filename?: string, perfil? }
//   -> { dados: { cnpj, nomeCliente, ordemDeCompra, enderecoEntrega,
//                 email, condicaoPagamento, condicaoPagamentoSugerida,
//                 freteSugerido, observacao, produtos: [...] },
//        avisos: [{ item, tipo, corrigido, texto }] }
//
//   perfil 'consignado' = faturamento de consignado (PI · Consignação);
//   perfil 'cotacao'    = o PDF da cotação do portal de compras (módulo
//                         Cotações): portal, nº da cotação, comprador,
//                         prazos, condições e os itens com o preço cotado.
//
// O que a IA devolve NÃO vai cru para a tela: passa pelo
// shared/pedido-revisar.js, que confere cada item contra o texto do PDF
// e desfaz a troca de QUANTIDADE por VALOR UNITÁRIO (o erro mais comum:
// 10 x R$ 720,00 chegava como 720 x R$ 10,00) e tira do campo código o
// RMS (registro ANVISA) que a IA tenha posto lá (04/11/2026: a proposta
// da Biomedical tem as colunas Código e RMS lado a lado — 51200 virava
// 80454419010). Ver o comentário de lá e o bloco REGRAS_CODIGO abaixo.
// ================================================================

const AOAI_ENDPOINT   = process.env.AOAI_ENDPOINT;
// 04/11/2026 (MSB): o endereço do recurso vale venha como vier do Foundry — a
// "URI de destino" inteira (/openai/deployments/...), o endpoint v1
// (/openai/v1/) ou o do PROJETO (.services.ai.azure.com/api/projects/...):
// fica só https://<recurso>.<domínio>; o do projeto vira o .openai.azure.com
// do mesmo recurso (o caminho /openai/deployments/... é desse domínio)
function baseAOAI(ep) {
  const s = String(ep || '').trim();
  const m = /^(https?:\/\/[^\/?#\s]+)/i.exec(s);
  return (m ? m[1] : s.replace(/\/+$/, '')).replace(/\.services\.ai\.azure\.com$/i, '.openai.azure.com');
}
// o motivo que o Azure devolve no corpo do erro ({ error: { code, message } })
function motivoAzure(texto) {
  try {
    const e = (JSON.parse(texto) || {}).error || {};
    return [e.code, e.message].filter(Boolean).join(': ').substring(0, 220);
  } catch (x) { return String(texto || '').trim().substring(0, 220); }
}
const AOAI_KEY        = String(process.env.AOAI_KEY || '').trim();
const AOAI_DEPLOYMENT = String(process.env.AOAI_DEPLOYMENT || 'gpt-4o-mini').trim();
const AOAI_APIVER     = String(process.env.AOAI_APIVER || '2025-01-01-preview').trim();
// max_completion_tokens inclui os tokens de RACIOCÍNIO — por isso ele é maior
// que a resposta em si. Mas CUIDADO: o Azure usa esse número para ESTIMAR o
// custo do request contra a cota TPM do deployment, então um teto folgado
// demais faz uma única extração "reservar" a janela inteira e voltar 429.
// 09/09 subiu para 16000 e deu 429 na tela; 10/09 desceu para 6000 com
// reasoning 'low' (com o texto já vindo em colunas, o modelo não precisa
// pensar tanto — ver pi-pdf-texto.js).
const MAXTOK          = Number(process.env.PEDIDO_MAXTOKENS || 6000);
// Quanto do PDF entra no prompt. Era 30.000 fixo, e o texto agora chega com
// as colunas alinhadas por espaços (o dobro de caracteres do texto corrido),
// então o teto subiu junto — senão um consignado de várias páginas perderia
// itens no corte. Quando corta, a tela avisa (aviso 'texto-cortado').
const MAXCHARS        = Number(process.env.PEDIDO_MAXCHARS || 80000);
// Env PRÓPRIA, de propósito — o AOAI_REASONING geral é 'minimal' e era ele que
// deixava a leitura da tabela no piloto automático. 'low' já basta agora que o
// texto chega em COLUNAS alinhadas; 'medium' cabe se voltar a errar coluna
// (mas pesa mais na cota — ver MAXTOK acima).
const REASONING       = process.env.PEDIDO_REASONING || 'low';

const CONDICOES_PAGAMENTO = [
  '07 DIAS', '10 DIAS', '120 DIAS', '20 DIAS', '28 DIAS', '30 DIAS',
  '30/45 DIAS', '30/45/60 DIAS', '30/45/60/75/90 DIAS', '30/60 DIAS',
  '30/60/90 DIAS', '30/60/90/120 DIAS', '30/60/90/120/150/180 DIAS',
  '45 DIAS', '45/60 DIAS', '50,0% A VISTA + 50,0% 30 DIAS', '60 DIAS',
  '60/90/120 DIAS', '70 DIAS', '75DIAS', '90 DIAS', 'À VISTA',
  'A VISTA /30/60/90 DIAS', 'A VISTA/30 DIAS', 'CR 15 DIAS', 'CR 40 DIAS',
  'CR 50,0% À VISTA 30/60 DIA'
];

// ── Como ler a tabela de itens ────────────────────────────────────
// Este bloco é o coração do conserto de 09/09/2026: a IA trocava
// quantidade por valor unitário. O texto agora chega com as COLUNAS
// ALINHADAS (pi-pdf-texto.js reconstrói o layout), então dá para exigir
// que ela ancore cada número no rótulo do cabeçalho em vez de adivinhar.
const REGRAS_TABELA = `COMO LER A TABELA DE ITENS (leia com atenção — é aqui que se erra):
O texto preserva o LAYOUT do PDF: cada linha de item é uma linha de texto e as colunas estão alinhadas por espaços com o CABEÇALHO da tabela. Use isso.
1. ACHE PRIMEIRO A LINHA DE CABEÇALHO (ex.: "Produto  Fabricante  Lote  Qt. Cons.  Unidade  Qtd Compr.  Vl.Unit.  Vl Desc.  %Des  Vl IMP  Vl Total") e memorize a POSIÇÃO de cada coluna.
2. Para cada linha de item, pegue cada número pela coluna em que ele está — o número que está debaixo de "Qtd Compr." é a quantidade; o que está debaixo de "Vl.Unit." é o valor unitário. NUNCA decida pelo tamanho do número.
3. Rótulos de QUANTIDADE: "Qtd", "Qtde", "Qt", "Quant", "Quantidade", "Qtd Compr.", "Qt. Cons.", "Qtd Solicitada", "Qtd Aut". Rótulos de VALOR UNITÁRIO: "Vl.Unit.", "Vl Unit", "Vlr Unitário", "Valor Unitário", "Preço Unitário", "Unitário", "Preço Unit", "Valor de Venda". Rótulos de TOTAL DO ITEM: "Vl Total", "Valor Total", "Total do Item", "Total", "Subtotal".
4. Se houver DUAS colunas de quantidade (ex.: "Qt. Cons." e "Qtd Compr."), a quantidade do pedido é a de COMPRA/SOLICITADA.
5. CONFIRA SEMPRE: quantidade x valorUnitario tem de dar o valorTotal daquela linha. Se não der, você trocou as colunas — releia a linha.
6. Sinais de que quantidade e valor estão trocados: quantidade com casas decimais de dinheiro (ex.: 720,00) enquanto o "valor unitário" é um número redondo pequeno (ex.: 10); ou o "valor unitário" ser um número muito maior que o total dividido pela quantidade. Em material médico-hospitalar a quantidade é uma CONTAGEM DE PEÇAS (quase sempre inteira e pequena: 1, 2, 5, 10, 100) e o valor unitário é DINHEIRO (costuma ter centavos e ser maior).
7. valorTotal: copie o total DAQUELA LINHA como está no PDF (não calcule). Se a linha não tiver coluna de total, mande 0.`;

// ── O código do produto NÃO é o RMS (04/11/2026) ──────────────────
// A proposta da própria Biomedical (portal ou Salesforce), que o cliente
// devolve como pedido, tem a coluna RMS — o registro ANVISA, 11 dígitos —
// ao lado da coluna do código, e a IA devolvia o RMS como código (51200
// virava 80454419010, e o mesmo RMS em três produtos virava o mesmo
// "código" três vezes). A conferência pela posição, que pega quando a IA
// erra mesmo assim, fica no shared/pedido-revisar.js; aqui é a regra.
const REGRAS_CODIGO = `O CÓDIGO DO PRODUTO NUNCA É O RMS (registro ANVISA):
1. "RMS", "Registro ANVISA", "Reg. ANVISA", "Registro MS", "Reg. M.S." e "Notificação ANVISA" são o REGISTRO DO PRODUTO NA ANVISA (Ministério da Saúde): um número de 11 dígitos, sem letras (ex.: 80454419010, 10256400049), que costuma se REPETIR em produtos diferentes. Ele vai em registroAnvisa — NUNCA em codigo.
2. Quando a linha do item tem um código e um RMS, o codigo sai de onde a regra do campo codigo manda (a coluna do código do produto ou os parênteses na descrição) — nunca da coluna RMS, mesmo que o código seja curto (ex.: "51200") e o RMS pareça mais "oficial".
3. Rótulo de cabeçalho pode vir QUEBRADO em duas linhas ("Código do" em cima e "produto" embaixo; "Valor de" / "Venda"): é um rótulo só, na mesma posição de coluna.
4. A PROPOSTA DA PRÓPRIA BIOMEDICAL que o cliente devolve como pedido (tem "Número de Proposta", "Preparado por" e a tabela "Código do produto | Produto. | Fabricante | RMS | Quantidade | Valor de Venda | Subtotal"): codigo = "Código do produto", registroAnvisa = "RMS", quantidade = "Quantidade", valorUnitario = "Valor de Venda", valorTotal = "Subtotal". Ex.: a linha «51200   FIO GUIA T MSB 0.035"X150CM, J3MM, TEFLONADO   MSB   80454419010   50   R$ 30,00   R$ 1.500,00» vira codigo "51200", registroAnvisa "80454419010", quantidade 50, valorUnitario 30, valorTotal 1500.`;

const SYSTEM_PROMPT = `Você extrai dados de ORDENS DE COMPRA (pedidos) recebidas pela BIOMEDICAL PRODUTOS CIENTIFICOS MEDICOS HOSPITALARES (a FORNECEDORA). O texto foi extraído de um PDF preservando o layout (colunas alinhadas por espaços).

REGRAS DE EXTRAÇÃO:
- cnpj: o CNPJ do CLIENTE (quem COMPRA, quem emitiu a ordem). NUNCA o da Biomedical (19.848.316/0001-66) — ela aparece no documento como fornecedor. Devolva no formato encontrado.
- nomeCliente: razão social do cliente comprador (nunca a Biomedical).
- ordemDeCompra: o número da ordem de compra/pedido. Devolva só o número principal, sem pontos de milhar (ex.: "Número 84.938" -> "84938"). O nome do arquivo, quando informado, costuma confirmar esse número.
- enderecoEntrega: endereço de entrega completo (logradouro, bairro, cidade, UF). Se houver um local de entrega (ex.: "ALMOXARIFADO CENTRAL"), inclua no início.
- email: e-mail de contato do cliente ("" se não houver).
- condicaoPagamento: a condição de pagamento como está escrita no PDF ("" se não houver).
- condicaoPagamentoSugerida: a opção da LISTA DE CONDIÇÕES abaixo que melhor corresponde à condição do PDF; "" se nenhuma corresponder com segurança.
- freteSugerido: exatamente uma destas opções — "CIF - COM VALOR", "CIF - SEM VALOR", "FOB - DESTINATARIO" — a que melhor corresponde ao frete do PDF; "" se não der para saber. (CIF = frete por conta do fornecedor; FOB = por conta do destinatário/cliente. Se for CIF sem valor de frete destacado, use "CIF - SEM VALOR".)
- observacao: observações/instruções do pedido ("" se não houver).
- produtos: um item por linha de produto do pedido:
    · codigo: o CÓDIGO DO PRODUTO BIOMEDICAL — muito comum vir ENTRE PARÊNTESES dentro da descrição (ex.: "PULSEIRA IDENTIFICACAO PACIENTES BRANCA (7024S11PDH)" -> codigo "7024S11PDH"). Se houver código do cliente E código Biomedical, prefira o que está na descrição entre parênteses. NUNCA o RMS / registro ANVISA (ver O CÓDIGO DO PRODUTO NUNCA É O RMS). "" se não houver.
    · registroAnvisa: o RMS / registro ANVISA do produto, só os dígitos (ex.: "80454419010"). "" se não houver.
    · descricao: a descrição do produto SEM o código entre parênteses.
    · quantidade: numérico (converta formato brasileiro: "500,00" -> 500).
    · valorUnitario: numérico, o valor UNITÁRIO (não o total do item). Converta vírgula decimal: "1,9100" -> 1.91.
    · valorTotal: numérico, o total DAQUELA LINHA como está no PDF (0 se a tabela não tiver essa coluna).
- NÃO invente valores: campo não encontrado = "" (produtos ausentes = lista vazia).

${REGRAS_TABELA}

${REGRAS_CODIGO}

LISTA DE CONDIÇÕES: ${CONDICOES_PAGAMENTO.join(' | ')}`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cnpj', 'nomeCliente', 'ordemDeCompra', 'enderecoEntrega', 'email',
             'condicaoPagamento', 'condicaoPagamentoSugerida', 'freteSugerido',
             'observacao', 'produtos'],
  properties: {
    cnpj:                      { type: 'string' },
    nomeCliente:               { type: 'string' },
    ordemDeCompra:             { type: 'string' },
    enderecoEntrega:           { type: 'string' },
    email:                     { type: 'string' },
    condicaoPagamento:         { type: 'string' },
    condicaoPagamentoSugerida: { type: 'string' },
    freteSugerido:             { type: 'string' },
    observacao:                { type: 'string' },
    produtos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['codigo', 'registroAnvisa', 'descricao', 'quantidade', 'valorUnitario', 'valorTotal'],
        properties: {
          codigo:        { type: 'string' },
          registroAnvisa: { type: 'string' },
          descricao:     { type: 'string' },
          quantidade:    { type: 'number' },
          valorUnitario: { type: 'number' },
          valorTotal:    { type: 'number' }
        }
      }
    }
  }
};

// ── Perfil CONSIGNADO: documento de faturamento de consignado (hospitalar) ──
const CONSIG_PROMPT = `Você extrai dados de documentos de FATURAMENTO DE CONSIGNADO recebidos pela BIOMEDICAL (fornecedora de materiais médico-hospitalares). O texto veio de um PDF (autorização de faturamento / relação de materiais consumidos em cirurgia) preservando o layout (colunas alinhadas por espaços).

REGRAS DE EXTRAÇÃO:
- cnpj / nomeCliente: SEMPRE do CLIENTE (hospital/clínica que compra) — NUNCA da Biomedical (19.848.316/0001-66), que aparece como fornecedora.
- ordemDeCompra: número da OC/autorização, sem pontos de milhar ("" se não houver).
- enderecoEntrega: endereço de entrega/faturamento do cliente ("" se não houver).
- email: e-mail de contato ("" se não houver).
- condicaoPagamento / condicaoPagamentoSugerida / freteSugerido: mesmas regras — sugerida deve ser exatamente uma opção da LISTA DE CONDIÇÕES; freteSugerido uma de "CIF - COM VALOR" | "CIF - SEM VALOR" | "FOB - DESTINATARIO"; "" se incerto.
- paciente: nome do paciente da cirurgia.
- convenio: convênio/plano de saúde.
- medicoAtendimento: médico do atendimento/solicitante.
- medicoCirurgico: médico que operou (cirurgião). Se só houver um médico, use-o nos dois campos.
- dataCirurgia e dataAtendimento: datas no formato DD/MM/AAAA ("" se não houver).
- prontuario: número do prontuário. beneficiario: nome/código do beneficiário. senha: senha de autorização do convênio.
- observacao: observações do documento ("" se não houver).
- produtos: um item por material consumido: codigo (código Biomedical — muito comum entre parênteses na descrição; NUNCA o RMS / registro ANVISA), registroAnvisa (o RMS / registro ANVISA, só os dígitos, "" se não houver), descricao (sem o código), lote (número do LOTE do material, "" se não houver), quantidade, valorUnitario e valorTotal numéricos (vírgula decimal brasileira: "1,91" -> 1.91).
- ATENÇÃO ao LOTE: lote é um CÓDIGO de rastreio (letras+números, ex.: "L2291A", "23F0071"), não é quantidade nem valor. Não confunda a coluna de lote com as colunas numéricas.
- NÃO invente: campo não encontrado = "" (produtos ausentes = []).

${REGRAS_TABELA}

${REGRAS_CODIGO}

LISTA DE CONDIÇÕES: ${CONDICOES_PAGAMENTO.join(' | ')}`;

const CONSIG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cnpj', 'nomeCliente', 'ordemDeCompra', 'enderecoEntrega', 'email',
             'condicaoPagamento', 'condicaoPagamentoSugerida', 'freteSugerido', 'observacao',
             'paciente', 'convenio', 'medicoAtendimento', 'medicoCirurgico',
             'dataCirurgia', 'dataAtendimento', 'prontuario', 'beneficiario', 'senha', 'produtos'],
  properties: {
    cnpj: { type: 'string' }, nomeCliente: { type: 'string' }, ordemDeCompra: { type: 'string' },
    enderecoEntrega: { type: 'string' }, email: { type: 'string' },
    condicaoPagamento: { type: 'string' }, condicaoPagamentoSugerida: { type: 'string' },
    freteSugerido: { type: 'string' }, observacao: { type: 'string' },
    paciente: { type: 'string' }, convenio: { type: 'string' },
    medicoAtendimento: { type: 'string' }, medicoCirurgico: { type: 'string' },
    dataCirurgia: { type: 'string' }, dataAtendimento: { type: 'string' },
    prontuario: { type: 'string' }, beneficiario: { type: 'string' }, senha: { type: 'string' },
    produtos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['codigo', 'registroAnvisa', 'descricao', 'lote', 'quantidade', 'valorUnitario', 'valorTotal'],
        properties: {
          codigo: { type: 'string' }, registroAnvisa: { type: 'string' }, descricao: { type: 'string' }, lote: { type: 'string' },
          quantidade: { type: 'number' }, valorUnitario: { type: 'number' },
          valorTotal: { type: 'number' }
        }
      }
    }
  }
};

// ── Perfil COTAÇÃO: o PDF que o PORTAL DE COMPRAS gera da cotação ──
// Módulo Cotações (Comercial): a pessoa responde a cotação no portal e sobe
// o PDF; a leitura vira o CASO da cotação (api/shared/cot-motor.js). Pode
// vir a proposta da Biomedical (com preço) ou só o pedido de cotação do
// comprador (sem preço) — os dois servem: sem preço a cotação nasce
// "Em cotação".
const PORTAIS_CONHECIDOS = ['Bionexo', 'Apoio Cotações', 'GTPlan', 'GTHealth', 'Síntese', 'Smart Compras', 'Uniube', 'VSSupply', 'Plataforma Opmenexo', 'Publinexo', 'Inpart', 'ARIBA'];
const COTACAO_PROMPT = `Você extrai dados de COTAÇÕES de PORTAIS DE COMPRAS hospitalares (Bionexo, Apoio Cotações, GTPlan, Síntese e similares) em que a BIOMEDICAL PRODUTOS CIENTIFICOS MEDICOS HOSPITALARES é a FORNECEDORA. O documento é o PDF que o portal gera da cotação: o pedido de cotação do comprador e/ou a proposta que a Biomedical enviou. O texto foi extraído preservando o layout (colunas alinhadas por espaços).

REGRAS DE EXTRAÇÃO:
- portal: o nome do portal de compras que gerou o documento — pelo logotipo escrito, cabeçalho, rodapé, URL ou e-mail (ex.: "bionexo.com" -> "Bionexo"). Use o nome como na lista de PORTAIS CONHECIDOS quando for um deles. "" se não der para saber.
- numeroCotacao: o NÚMERO DA COTAÇÃO no portal — quase sempre é o ID / IDENTIFICADOR da cotação. Procure, nesta ordem: "ID da cotação", "Identificador da cotação", "Nº / Número / Código da cotação", "Cotação nº", "Pedido de cotação nº", "ID" ou "Identificador" sozinhos no cabeçalho (ex.: "ID: 668804034" no relatório da Bionexo), "Cotação:"; só sem nenhum desses, "Processo". Só o número (sem o rótulo e sem pontos de milhar). NÃO é CNPJ, CEP, telefone, data, ordem de compra, nº do item nem código de produto. Se a mensagem trouxer "ID DA COTAÇÃO — rótulos achados no texto", use um daqueles (o primeiro, salvo se o documento mostrar que é outro). "" se não houver.
- cnpj / nomeCliente: do COMPRADOR (hospital, clínica, operadora, órgão — quem pediu a cotação). NUNCA os da Biomedical (19.848.316/0001-66), que aparece como fornecedora/participante.
- cidade, uf: do comprador (uf com 2 letras). "" se não houver.
- endereco, cep: o endereço do comprador (logradouro, número, bairro — sem a cidade/UF) e o CEP ("" se não houver).
- contatoNome, email, telefone: do comprador / responsável pela cotação ("" se não houver). Nunca os da Biomedical (@biomedical.com.br). O email é para onde a proposta vai: o do comprador/responsável pela cotação; se houver vários, o do responsável.
- dataCotacao: data de abertura/emissão da cotação, DD/MM/AAAA ("" se não houver).
- dataLimite: a DATA DE VENCIMENTO da cotação como está no documento ("Vencimento", "Data de vencimento", "Data limite", "Encerramento", "Válida até"), "DD/MM/AAAA HH:MM" (ou só "DD/MM/AAAA"). NÃO é a data de criação/abertura. "" se não houver.
- validadeProposta: a validade da proposta EXATAMENTE como está escrita (ex.: "30 dias", "15 dias corridos", "10/11/2026"). "" se não houver.
- condicaoPagamento: copie EXATAMENTE como está no documento, letra por letra (ex.: "28 DDL", "30/60/90 dias", "À vista - boleto") — não resuma, não traduza, não converta. "" se não houver.
- prazoEntrega, frete: como estão no documento ("" se não houver). Prefira o que a Biomedical OFERTOU; se só houver o que o comprador pediu, use esse (vale também para a condicaoPagamento).
- observacao: observações relevantes e curtas (exigências de marca, registro ANVISA, entrega fracionada…). "" se não houver.
- produtos: um item por linha de produto da cotação:
    · codigo: o código do produto BIOMEDICAL quando aparecer ("Cód. Fornecedor", "Ref. do fornecedor", "Código ofertado", ou entre parênteses na descrição). NUNCA o código do comprador/portal, e NUNCA o RMS / registro ANVISA (vai em registroAnvisa — ver O CÓDIGO DO PRODUTO NUNCA É O RMS). No "Relatório de resposta da cotação" da Bionexo a linha "Item" é o pedido do comprador ("10105898-MANIFOLD 5 VIAS…": 10105898 é o codigoCliente) e a linha "Resposta" é o que a Biomedical OFERTOU ("AM0302 - MANIFOLD 3 PORTAS… - 1 - FABRICANTE": AM0302 é o codigo, a descrição é a da Resposta e o fabricante vai em marca). "" se não houver.
    · codigoCliente: o código do produto NO COMPRADOR / no portal ("Cód. Produto", "Código", "Cód. Hosp."). "" se não houver.
    · descricao: a descrição do produto OFERTADO pela Biomedical (a da resposta, quando houver), sem os códigos.
    · marca: a marca/fabricante OFERTADO pela Biomedical ("" se não houver).
    · registroAnvisa: o registro ANVISA / RMS do produto ofertado (só os dígitos, ex.: "10256400006"). "" se não houver.
    · unidade: a unidade de compra (UN, CX, PCT, KIT…). "" se não houver.
    · quantidade: numérico (converta o formato brasileiro: "1.000,00" -> 1000) — a quantidade que o COMPRADOR pediu. No relatório da Bionexo é a "Qntd. Solicitada" do Item; o "Qntd." da linha Resposta é a quantidade da EMBALAGEM ofertada, não a do pedido. Confira: quantidade × valorUnitario de todos os itens deve dar o "Total estimado"/total da proposta.
    · valorUnitario: numérico — o preço unitário que a Biomedical COTOU ("Preço Unit."). 0 se o documento não tiver preço (pedido de cotação ainda sem resposta).
    · valorTotal: numérico, o total DAQUELA LINHA como está no PDF (0 se não houver).
- UM item por produto pedido: não junte dois itens numa linha nem repita o mesmo item; mantenha a ordem do documento. Se o PDF tiver várias respostas para o mesmo item, use a da Biomedical.
- Se a mensagem trouxer a lista CÓDIGOS BIOMEDICAL CONFIRMADOS, ela é o gabarito: o codigo de cada item é um desses (o que aparece no trecho do item); código que não está na lista NÃO é da Biomedical — vai em codigoCliente.
- Item que a Biomedical NÃO cotou (marcado como "não cotado", "declinado", sem preço quando os outros têm): inclua com valorUnitario 0 e termine a descricao com " (não cotado)".
- valorTotal: o valor total da proposta/cotação como está no PDF (0 se não houver).
- NÃO invente valores: campo não encontrado = "" (produtos ausentes = []).

${REGRAS_TABELA}

${REGRAS_CODIGO}

PORTAIS CONHECIDOS: ${PORTAIS_CONHECIDOS.join(' | ')}`;

const COTACAO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['portal', 'numeroCotacao', 'cnpj', 'nomeCliente', 'cidade', 'uf', 'endereco', 'cep', 'contatoNome', 'email', 'telefone',
             'dataCotacao', 'dataLimite', 'validadeProposta', 'condicaoPagamento', 'prazoEntrega', 'frete',
             'observacao', 'valorTotal', 'produtos'],
  properties: {
    portal: { type: 'string' }, numeroCotacao: { type: 'string' },
    cnpj: { type: 'string' }, nomeCliente: { type: 'string' }, cidade: { type: 'string' }, uf: { type: 'string' },
    endereco: { type: 'string' }, cep: { type: 'string' },
    contatoNome: { type: 'string' }, email: { type: 'string' }, telefone: { type: 'string' },
    dataCotacao: { type: 'string' }, dataLimite: { type: 'string' }, validadeProposta: { type: 'string' },
    condicaoPagamento: { type: 'string' }, prazoEntrega: { type: 'string' }, frete: { type: 'string' },
    observacao: { type: 'string' }, valorTotal: { type: 'number' },
    produtos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['codigo', 'codigoCliente', 'descricao', 'marca', 'registroAnvisa', 'unidade', 'quantidade', 'valorUnitario', 'valorTotal'],
        properties: {
          codigo: { type: 'string' }, codigoCliente: { type: 'string' }, descricao: { type: 'string' },
          marca: { type: 'string' }, registroAnvisa: { type: 'string' }, unidade: { type: 'string' },
          quantidade: { type: 'number' }, valorUnitario: { type: 'number' }, valorTotal: { type: 'number' }
        }
      }
    }
  }
};

const auth    = require('../shared/auth');
// o número da cotação pelo rótulo ID / Identificador / Nº da cotação (21/10/26)
const cotId   = require('../shared/cot-id');
const http    = require('../shared/http');
const revisar = require('../shared/pedido-revisar');

// ── 429 do Azure OpenAI: esperar e tentar de novo ────────────────
// O recurso do Foundry é COMPARTILHADO por 8 endpoints do portal (a LICI
// sozinha é ~96% do consumo), então o PI leva 429 quando pega a janela
// ocupada. O Azure manda quantos segundos esperar no header retry-after;
// respeitá-lo resolve o caso transitório, que é a maioria. Aqui é uma
// tela interativa: o operador espera 5 segundos, não espera 5 minutos.
const RETRIES     = Number(process.env.PEDIDO_RETRIES || 2);
const ESPERA_MAX  = Number(process.env.PEDIDO_ESPERA_MAX || 20);   // segundos

function dorme(seg) { return new Promise(function (r) { setTimeout(r, seg * 1000); }); }

async function chamarAOAI(url, payload, log) {
  let r, texto, espera = 0;
  for (let tentativa = 0; tentativa <= RETRIES; tentativa++) {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'api-key': AOAI_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    texto = await r.text();
    if (r.status !== 429) return { r: r, texto: texto, espera: 0 };

    // quanto o próprio Azure mandou esperar (segundos)
    espera = Number(r.headers.get('retry-after') || r.headers.get('x-ratelimit-reset-requests') || 0);
    if (!(espera > 0)) espera = 5 * (tentativa + 1);          // sem header: 5s, 10s
    if (tentativa === RETRIES || espera > ESPERA_MAX) break;   // não pendura a tela
    if (log) log('[pedido-extrair] 429 — esperando ' + espera + 's e tentando de novo (' + (tentativa + 1) + '/' + RETRIES + ')');
    await dorme(espera);
  }
  return { r: r, texto: texto, espera: espera };
}

const handler = async function (context, req) {
  const cors = http.cors(req);
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: cors }; return; }

  try {
    await auth.requireArea(req, ['comercial', 'estoque']);

    if (!AOAI_ENDPOINT || !AOAI_KEY) { const e = new Error('AOAI não configurado'); e.status = 500; throw e; }
    const texto    = (req.body && req.body.texto) || '';
    const filename = (req.body && req.body.filename) || '';
    if (!texto || texto.trim().length < 30) {
      context.res = { status: 400, headers: cors, body: { error: 'Texto do PDF vazio ou curto demais. Se o PDF for escaneado (imagem), preencha o pedido manualmente.' } };
      return;
    }

    // perfil: 'pedido' (default), 'consignado' (faturamento de consignado) ou
    // 'cotacao' (o PDF do portal de compras — módulo Cotações)
    const perfil = (req.body && req.body.perfil) || '';
    const consig = perfil === 'consignado';
    const cotacao = perfil === 'cotacao';
    const sysPrompt = cotacao ? COTACAO_PROMPT : consig ? CONSIG_PROMPT : SYSTEM_PROMPT;
    const schema    = cotacao ? COTACAO_SCHEMA : consig ? CONSIG_SCHEMA : SCHEMA;

    const cortado = texto.length > MAXCHARS;
    // perfil cotação: a tela manda os códigos do PDF que JÁ conferiu no cadastro de
    // produtos (BI) — o gabarito do "codigo" de cada item
    const codigosOk = cotacao && req.body && Array.isArray(req.body.codigosBiomedical)
      ? req.body.codigosBiomedical.map(function (c) { return String(c || '').replace(/[^A-Za-z0-9.\-\/ ]/g, '').trim().slice(0, 40); }).filter(Boolean).slice(0, 300) : [];
    const dica = codigosOk.length ? 'CÓDIGOS BIOMEDICAL CONFIRMADOS (aparecem neste PDF e existem no cadastro de produtos da Biomedical): ' + codigosOk.join(', ') + '\n\n' : '';
    const userMsg = (filename ? 'NOME DO ARQUIVO: ' + filename + '\n\n' : '') + dica + (cotacao ? cotId.dica(texto) : '') +
                    (cotacao ? 'TEXTO DA COTAÇÃO DO PORTAL:\n' : consig ? 'TEXTO DO DOCUMENTO DE CONSIGNADO:\n' : 'TEXTO DA ORDEM DE COMPRA:\n') + texto.substring(0, MAXCHARS);

    const url = baseAOAI(AOAI_ENDPOINT) +
      '/openai/deployments/' + encodeURIComponent(AOAI_DEPLOYMENT) + '/chat/completions?api-version=' + encodeURIComponent(AOAI_APIVER);

    const payload = {
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user',   content: userMsg }
      ],
      max_completion_tokens: MAXTOK,
      response_format: {
        type: 'json_schema',
        json_schema: { name: cotacao ? 'cotacao_extraida' : consig ? 'consignado_extraido' : 'pedido_extraido', strict: true, schema: schema }
      }
    };
    if (REASONING) payload.reasoning_effort = REASONING;

    const chamada = await chamarAOAI(url, payload, context.log);
    const r = chamada.r;
    const text = chamada.texto;
    if (!r.ok) {
      // 429 = fila do Foundry cheia (a LICI e os outros 7 endpoints dividem o
      // mesmo recurso). Não é erro do PDF nem do pedido: é só esperar.
      if (r.status === 429) {
        const seg = chamada.espera > 0 ? Math.ceil(chamada.espera) : 30;
        context.res = { status: 429, headers: cors, body: {
          error: 'O serviço de IA está ocupado agora (limite por minuto do Azure OpenAI). ' +
                 'Tentei ' + (RETRIES + 1) + 'x. Espere ~' + seg + ' segundos e anexe o PDF de novo.',
          retryAfter: seg, details: text.substring(0, 200) } };
        return;
      }
      // a tela mostra o "error": vai com o motivo do Azure e, no 404 (não achou
      // a implantação ou o endereço), com o que o portal procurou — nada de chave
      const motivo = motivoAzure(text);
      const onde = r.status === 404 ? ' [procurei a implantação "' + AOAI_DEPLOYMENT + '" em ' + baseAOAI(AOAI_ENDPOINT) + ', api-version ' + AOAI_APIVER + ']' : '';
      context.res = { status: r.status, headers: cors, body: { error: 'Azure OpenAI ' + r.status + (motivo ? ' — ' + motivo : '') + onde, details: text.substring(0, 400) } };
      return;
    }
    const j = JSON.parse(text);
    const choice = (j.choices || [])[0] || {};
    const content = choice.message && choice.message.content;
    if (!content) {
      context.res = { status: 502, headers: cors, body: { error: 'Extração veio vazia (motivo: ' + (choice.finish_reason || '?') + '). Tente de novo ou preencha manualmente.' } };
      return;
    }

    let dados;
    try { dados = JSON.parse(content); }
    catch (e) {
      context.res = { status: 502, headers: cors, body: { error: 'A IA devolveu um JSON inválido. Tente de novo.', details: String(content).substring(0, 300) } };
      return;
    }

    // ── conferência contra o texto do PDF ────────────────────────
    // Tira o RMS do campo código, desfaz a troca de quantidade x valor
    // unitário e avisa o que ficou duvidoso. Se algo der errado aqui, a
    // extração passa como veio — conferir nunca pode derrubar o pedido.
    // (perfil cotação: o código achado no lugar do RMS tem de estar entre
    //  os códigos do PDF que a tela já conferiu no cadastro)
    let avisos = [];
    try {
      const r = revisar.revisar(dados && dados.produtos, texto, { codigosConhecidos: codigosOk });
      if (dados) dados.produtos = r.produtos;
      avisos = r.avisos;
      // cotação SEM preço nenhum é o pedido de cotação do comprador (ainda
      // não respondido): um aviso só, em vez de "sem valor" item por item
      if (cotacao && r.produtos.length && r.produtos.every(function (p) { return !(Number(p.valorUnitario) > 0); })) {
        avisos = avisos.filter(function (a) { return a.tipo !== 'sem-valor'; });
        avisos.unshift({ item: -1, tipo: 'sem-precos', corrigido: false,
          texto: 'O PDF não traz preço em nenhum item — parece o pedido de cotação do comprador, ainda sem a resposta da Biomedical.' });
      }
      // o número da cotação: o ID / Identificador rotulado no PDF ganha do
      // que a IA leu quando ela não achou ou leu outro número (com aviso)
      if (cotacao && dados) {
        const id = cotId.escolher(dados.numeroCotacao, texto);
        dados.numeroCotacao = id.numero;
        if (id.aviso) avisos.unshift({ item: -1, tipo: 'id-cotacao', corrigido: true, texto: id.aviso });
      }
      if (cortado) {
        // o corte era silencioso: item sumia do pedido sem ninguém saber por quê
        avisos.unshift({ item: -1, tipo: 'texto-cortado', corrigido: false,
          texto: 'O PDF é grande e só os primeiros ' + MAXCHARS.toLocaleString('pt-BR') +
                 ' caracteres foram lidos. Confira se todos os itens vieram.' });
      }
      if (avisos.length) context.log('[pedido-extrair] avisos: ' + avisos.map(a => a.tipo).join(', '));
    } catch (e) {
      context.log.warn('[pedido-extrair] revisão falhou: ' + (e && e.message));
    }

    context.res = { status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
      body: { dados: dados, avisos: avisos, model: j.model || null, deployment: AOAI_DEPLOYMENT } };
  } catch (err) {
    http.sendError(context, req, 'pedido-extrair', err);
  }
};

module.exports = handler;
module.exports.chamarAOAI = chamarAOAI;   // exposto para .claude/pi-retry-testes.js
