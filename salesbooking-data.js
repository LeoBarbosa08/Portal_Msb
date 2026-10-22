/* ================================================================
   salesbooking-data.js — CONTEÚDO do Sales Playbook (Comercial)
   ----------------------------------------------------------------
   Este arquivo é a ÚNICA fonte de conteúdo do módulo. Para publicar
   um artigo novo, basta acrescentar um objeto em ARTIGOS — o hub, a
   busca, os capítulos e as trilhas se atualizam sozinhos.

   Blocos aceitos em `blocos`:
     {t:'h2',     x:'Título da seção'}          → vira item do índice "Neste artigo"
     {t:'p',      x:'parágrafo'}
     {t:'ul',     x:['item','item']}
     {t:'ol',     x:['item','item']}
     {t:'passos', x:[{titulo:'', texto:''}]}    → passo a passo numerado
     {t:'nota',   tom:'info'|'alerta'|'ok', titulo:'', x:'texto'}
     {t:'tabela', head:['A','B'], rows:[['1','2']]}
     {t:'links',  x:[{label:'', href:'', ext:true}]}
     {t:'termos', x:[{termo:'', def:''}]}

   STATUS: 'rascunho' mostra o selo "Rascunho" e o aviso de validação.
   Troque para 'publicado' quando a coordenação validar o texto.
   ================================================================ */
(function () {
  'use strict';

  var CAPITULOS = [
    {
      id: 'como-vender',
      titulo: 'Como vender',
      desc: 'Abordagem, qualificação, proposta e fechamento no dia a dia do Comercial.',
      icone: 'grafico',
      tom: 'azul'
    },
    {
      id: 'ferramentas',
      titulo: 'Ferramentas',
      desc: 'Salesforce, Portal, Power BI e planilhas oficiais — onde e como usar cada uma.',
      icone: 'ferramenta',
      tom: 'roxo'
    },
    {
      id: 'processos',
      titulo: 'Processos',
      desc: 'FCA, cotação, licitação, consignação e devolução, passo a passo.',
      icone: 'arquivo',
      tom: 'vermelho'
    },
    {
      id: 'dicionario',
      titulo: 'Dicionário',
      desc: 'O que cada sigla e termo quer dizer aqui dentro — sem depender de quem está por perto.',
      icone: 'livro',
      tom: 'verde'
    }
  ];

  var TRILHAS = [
    {
      id: 'nivel-1',
      nivel: 'Nível 1',
      titulo: 'Fundamentos da venda Biomedical',
      desc: 'Quem somos, o que vendemos e para quem.',
      aulas: ['abordagem-inicial', 'qualificacao', 'dicionario-comercial', 'dicionario-status-salesforce', 'salesforce-basico']
    },
    {
      id: 'nivel-2',
      nivel: 'Nível 2',
      titulo: 'Ferramentas do dia a dia',
      desc: 'Portal, Salesforce e Sales Report na prática.',
      aulas: ['salesforce-basico', 'sales-report', 'tabela-precos', 'pi-cotacao']
    },
    {
      id: 'nivel-3',
      nivel: 'Nível 3',
      titulo: 'Processos sem retrabalho',
      desc: 'FCA, cotação, licitação e consignação.',
      aulas: ['processo-fca', 'processo-cotacao', 'processo-consignacao', 'processo-licitacao']
    },
    {
      id: 'nivel-4',
      nivel: 'Nível 4',
      titulo: 'Negociação avançada',
      desc: 'Margem, alçadas e contratos longos.',
      aulas: ['proposta-comercial', 'negociacao-desconto', 'fechamento-follow-up', 'pos-venda-recompra']
    }
  ];

  /* ── ARTIGOS ─────────────────────────────────────────────────── */
  var ARTIGOS = [

    /* ══════════════ CAPÍTULO · COMO VENDER ══════════════ */
    {
      id: 'abordagem-inicial',
      capitulo: 'como-vender',
      titulo: 'Abordagem inicial: os 5 minutos que definem a venda',
      resumo: 'Como abrir uma conversa com comprador, enfermagem e corpo clínico.',
      minutos: 6,
      atualizado: '2026-08-13',
      status: 'rascunho',
      tags: ['abordagem', 'primeira visita', 'comprador', 'enfermagem', 'médico'],
      blocos: [
        { t: 'h2', x: 'Para que serve' },
        { t: 'p', x: 'A primeira conversa não é para vender: é para descobrir quem decide, o que hoje é usado e o que incomoda. Quem sai da primeira visita com essas três respostas volta para fechar. Quem sai só com um cartão volta para começar de novo.' },

        { t: 'h2', x: 'Quando usar' },
        { t: 'ul', x: [
          'Conta nova, sem histórico de compra na filial.',
          'Conta antiga que parou de comprar (recuperação).',
          'Cliente que já compra uma linha e você quer abrir outra.',
          'Indicação de médico ou proctor para um hospital onde ainda não temos cadastro.'
        ]},

        { t: 'h2', x: 'Antes de entrar' },
        { t: 'p', x: 'Cinco minutos de preparo evitam uma visita perdida. Faça isso ainda no carro:' },
        { t: 'passos', x: [
          { titulo: 'Confira o histórico', texto: 'Abra a conta no Salesforce e veja compras, oportunidades abertas e a última atividade registrada. Se nunca comprou, veja se existe FCA ou cadastro em andamento.' },
          { titulo: 'Veja os números', texto: 'No Sales Report, olhe o que a região comprou nos últimos 12 meses e quais famílias estão zeradas nessa conta. Família zerada é pauta pronta.' },
          { titulo: 'Cheque pendências', texto: 'Título vencido, devolução em aberto ou consignação sem acerto mudam completamente a conversa. Descobrir isso na frente do comprador é o pior cenário.' },
          { titulo: 'Defina um objetivo único', texto: 'Uma visita, um objetivo: abrir cadastro, agendar um teste, cotar uma família ou marcar uma proctoria. Visita sem objetivo vira café.' }
        ]},

        { t: 'h2', x: 'Os três interlocutores' },
        { t: 'p', x: 'Em hospital, quase nunca decide uma pessoa só. Cada um responde a uma pergunta diferente — e cada um exige um argumento diferente:' },
        { t: 'tabela', head: ['Quem', 'O que ele quer saber', 'Como abrir'], rows: [
          ['Corpo clínico', 'Se o produto funciona bem na mão dele', 'Fale de desempenho, tamanhos disponíveis, experiência de outros serviços e proctoria.'],
          ['Enfermagem / centro cirúrgico', 'Se vai ter o produto na hora do procedimento', 'Fale de disponibilidade, consignação, prazo de reposição e rastreabilidade de lote.'],
          ['Compras / suprimentos', 'Se o custo fecha e o fornecedor cumpre', 'Fale de preço, condição, prazo de entrega, registro ANVISA e regularidade fiscal.']
        ]},
        { t: 'nota', tom: 'alerta', titulo: 'Erro clássico', x: 'Levar argumento de preço para o médico e argumento técnico para o comprador. Os dois desligam, e a visita acaba ali.' },

        { t: 'h2', x: 'Passo a passo da conversa' },
        { t: 'passos', x: [
          { titulo: 'Apresente-se em uma frase', texto: 'Nome, Biomedical, e a linha que você atende naquele serviço. Sem monólogo institucional.' },
          { titulo: 'Pergunte o que usam hoje', texto: '"Qual marca vocês estão usando nessa linha?" Anote a marca e o motivo. Se ninguém souber o motivo, existe abertura.' },
          { titulo: 'Pergunte o que incomoda', texto: 'Falta de produto, tamanho que não tem, atraso de entrega, dificuldade com consignação. A dor é o que ancora a proposta depois.' },
          { titulo: 'Ofereça uma coisa concreta', texto: 'Uma amostra, um teste acompanhado, uma proctoria ou uma cotação de uma família. Não ofereça "o portfólio inteiro".' },
          { titulo: 'Combine o próximo passo com data', texto: '"Te mando a cotação até quinta e te ligo sexta." Sem data, não houve avanço.' }
        ]},

        { t: 'h2', x: 'Depois da visita' },
        { t: 'p', x: 'A visita só existe se estiver registrada. No mesmo dia:' },
        { t: 'ul', x: [
          'Registre a atividade no Salesforce, com quem você falou e o que ficou combinado.',
          'Crie ou atualize a oportunidade, com valor estimado e data prevista.',
          'Se o cadastro não existe, abra a FCA já — cadastro parado trava a primeira venda.',
          'Se ficou pendência de outra área (crédito, logística, regulatório), abra a pendência no mesmo dia.'
        ]},
        { t: 'nota', tom: 'info', titulo: 'Regra prática', x: 'Se a conversa não gerou nem uma atividade nem uma oportunidade no CRM, ela não vai gerar venda. Registre antes de sair do estacionamento.' },

        { t: 'h2', x: 'Onde fazer' },
        { t: 'links', x: [
          { label: 'Salesforce — contas, oportunidades e atividades', href: 'https://biomedical.lightning.force.com/lightning/page/home', ext: true },
          { label: 'Sales Report — histórico da conta e da região', href: 'comercial-sales-report.html' },
          { label: 'FCA — abertura de cadastro', href: 'comercial-fca.html' },
          { label: 'Materiais e Recursos — catálogos e proctoria', href: 'comercial-materiais.html' }
        ]},

        { t: 'h2', x: 'Quem procurar' },
        { t: 'ul', x: [
          'Dúvida de produto ou indicação clínica: especialista da linha.',
          'Cadastro travado ou documento faltando: responsável pela FCA na filial.',
          'Crédito, limite ou título vencido: Financeiro.',
          'Disponibilidade e prazo: Logística / Estoque.'
        ]}
      ]
    },

    {
      id: 'qualificacao',
      capitulo: 'como-vender',
      titulo: 'Qualificação: quando a oportunidade é real',
      resumo: 'Critérios de orçamento, decisor, urgência e concorrência.',
      minutos: 5,
      atualizado: '2026-08-13',
      status: 'rascunho',
      tags: ['qualificação', 'funil', 'oportunidade', 'pipeline'],
      blocos: [
        { t: 'h2', x: 'Para que serve' },
        { t: 'p', x: 'Funil cheio de oportunidade sem lastro é pior do que funil vazio: consome tempo, distorce a previsão e faz a coordenação planejar em cima de um número que não existe. Qualificar é decidir, cedo, o que merece esforço.' },

        { t: 'h2', x: 'As quatro perguntas' },
        { t: 'p', x: 'Uma oportunidade só sobe de etapa quando você consegue responder as quatro. Não precisa ser bonito — precisa ser verdade.' },
        { t: 'tabela', head: ['Pergunta', 'O que confirma', 'Sinal de alerta'], rows: [
          ['Tem verba?', 'Orçamento aprovado, contrato vigente ou processo licitatório publicado.', '"Vamos ver no ano que vem."'],
          ['Quem decide?', 'Nome e cargo de quem assina, e de quem pode vetar.', 'Só falamos com quem usa, nunca com quem compra.'],
          ['Qual o prazo?', 'Data de procedimento, de abertura do edital ou de fim do contrato atual.', 'Não existe data nenhuma.'],
          ['Contra quem?', 'Marca concorrente, preço praticado e por que ela está lá.', 'Ninguém sabe dizer o que usam hoje.']
        ]},

        { t: 'h2', x: 'Como registrar' },
        { t: 'passos', x: [
          { titulo: 'Crie a oportunidade no Salesforce', texto: 'Conta, produto/família, valor estimado e data prevista de fechamento. Valor chutado com data chutada não ajuda ninguém — estime com base em consumo real.' },
          { titulo: 'Coloque na etapa certa', texto: 'Etapa é fotografia do que já aconteceu, não do que você espera. Se a proposta não saiu, não é "proposta enviada".' },
          { titulo: 'Anote o concorrente', texto: 'Quem está lá hoje e a que preço. Sem isso, a negociação de desconto vira adivinhação.' },
          { titulo: 'Reveja toda semana', texto: 'Oportunidade sem atividade há mais de 30 dias ou é reaquecida ou é encerrada como perdida, com o motivo real.' }
        ]},
        { t: 'nota', tom: 'alerta', titulo: 'Perdido não é derrota', x: 'Fechar como perdido com o motivo correto vale mais que arrastar por seis meses. O motivo é o que permite corrigir preço, portfólio ou prazo na próxima.' },

        { t: 'h2', x: 'Quando desqualificar' },
        { t: 'ul', x: [
          'Não há verba nem previsão de verba no exercício.',
          'O produto exigido não existe no nosso portfólio e não há equivalente aceito.',
          'A conta está bloqueada por crédito e não há solução no horizonte.',
          'Exigência técnica do edital direciona para marca única e não somos ela.'
        ]},

        { t: 'h2', x: 'Onde acompanhar' },
        { t: 'links', x: [
          { label: 'Funil de Oportunidades — pipeline por etapa', href: 'comercial-funil.html' }
        ]}
      ]
    },

    {
      id: 'proposta-comercial',
      capitulo: 'como-vender',
      titulo: 'Montando a proposta comercial',
      resumo: 'Estrutura, anexos obrigatórios e prazos de validade.',
      minutos: 8,
      atualizado: '2026-08-13',
      status: 'rascunho',
      tags: ['proposta', 'cotação', 'preço', 'validade'],
      blocos: [
        { t: 'h2', x: 'Para que serve' },
        { t: 'p', x: 'A proposta é o documento que o cliente vai comparar com a do concorrente — e o que a auditoria dele vai arquivar. Proposta incompleta volta para correção e você perde o prazo; proposta sem validade vira preço eterno.' },

        { t: 'h2', x: 'O que toda proposta precisa ter' },
        { t: 'ul', x: [
          'Razão social, CNPJ e endereço do cliente, exatamente como no cadastro.',
          'Item a item: código, descrição, quantidade, preço unitário e total.',
          'Condição de pagamento e prazo de entrega.',
          'Validade da proposta, com data.',
          'Registro ANVISA dos produtos, quando exigido.',
          'Dados do emitente: nome, e-mail e telefone de quem responde por ela.'
        ]},
        { t: 'nota', tom: 'info', titulo: 'Preço vem da fonte oficial', x: 'Preço se pega na Tabela de Preços do portal ou no Salesforce — nunca de uma proposta antiga salva no computador. Tabela desatualizada é a origem mais comum de venda com margem errada.' },

        { t: 'h2', x: 'Passo a passo' },
        { t: 'passos', x: [
          { titulo: 'Confirme o cadastro', texto: 'Cliente ativo, sem bloqueio, com dados fiscais corretos. Se não estiver, resolva a FCA antes — proposta aceita com cadastro travado não vira pedido.' },
          { titulo: 'Monte o escopo', texto: 'Só o que o cliente pediu, mais o que ele vai precisar de fato (acessório, tamanho complementar). Não infle a lista para "engordar" o valor.' },
          { titulo: 'Puxe os preços', texto: 'Use a tabela vigente para o tipo de cliente e convênio. Anote qualquer condição especial que dependa de aprovação.' },
          { titulo: 'Aplique desconto dentro da alçada', texto: 'Se passar da sua alçada, peça aprovação ANTES de enviar. Desconto prometido e depois recuado queima a relação.' },
          { titulo: 'Gere o documento', texto: 'Use o modelo oficial. Para cotações do Salesforce, gere o PDF pelo próprio CRM para manter itens, totais e numeração consistentes.' },
          { titulo: 'Envie e registre', texto: 'Anexe a proposta na oportunidade e registre a data de envio. O que não está anexado, para efeito de histórico, não foi enviado.' }
        ]},

        { t: 'h2', x: 'Validade e reajuste' },
        { t: 'p', x: 'Toda proposta tem data de validade explícita. Vencida, ela não é renovada por telefone: gere uma nova versão com preço atual. Se o cliente comprar em cima de uma proposta vencida, o pedido pode travar no faturamento por divergência de preço.' },

        { t: 'h2', x: 'Erros que mais voltam' },
        { t: 'tabela', head: ['Erro', 'Consequência'], rows: [
          ['Código de produto trocado', 'Pedido entra errado e gera devolução.'],
          ['Quantidade em caixa vs. unidade', 'Cliente compara com concorrente em base diferente e acha caro.'],
          ['Sem prazo de entrega', 'Compras engaveta até perguntar — perde-se uma semana.'],
          ['Sem validade', 'Cliente cobra o preço meses depois.'],
          ['Desconto acima da alçada', 'Proposta é recusada internamente e precisa ser refeita.']
        ]},

        { t: 'h2', x: 'Onde fazer' },
        { t: 'links', x: [
          { label: 'Tabela de Preços — preço vigente por cliente e convênio', href: 'comercial-tabela-precos.html' }
          // PI · Cotação saiu (recorte Comercial + Estoque): página oculta, fora deste portal
        ]}
      ]
    },

    {
      id: 'negociacao-desconto',
      capitulo: 'como-vender',
      titulo: 'Negociação de desconto sem queimar margem',
      resumo: 'Ordem das concessões e o que pedir em troca.',
      minutos: 7,
      atualizado: '2026-08-13',
      status: 'rascunho',
      tags: ['desconto', 'margem', 'alçada', 'negociação'],
      blocos: [
        { t: 'h2', x: 'Para que serve' },
        { t: 'p', x: 'Desconto é a concessão mais cara que existe e quase sempre a primeira a ser oferecida. Este artigo define a ordem em que as concessões devem ser feitas e o que exigir em troca de cada uma.' },

        { t: 'h2', x: 'Ordem das concessões' },
        { t: 'p', x: 'Comece pelo que custa pouco para a empresa e vale muito para o cliente. Preço é o último recurso, não o primeiro.' },
        { t: 'ol', x: [
          'Prazo de entrega e reposição garantida.',
          'Consignação ou estoque local, quando faz sentido para o giro.',
          'Treinamento, acompanhamento de caso e proctoria.',
          'Condição de pagamento (prazo maior, parcelamento).',
          'Preço — sempre por último, sempre com contrapartida.'
        ]},

        { t: 'h2', x: 'O que pedir em troca' },
        { t: 'p', x: 'Concessão sem contrapartida ensina o cliente a pedir de novo. Toda vez que o preço cair, algo tem que subir:' },
        { t: 'ul', x: [
          'Volume maior ou compromisso de consumo por período.',
          'Exclusividade da linha no serviço.',
          'Prazo de pagamento menor.',
          'Pedido fechado agora, em vez de "vamos ver".',
          'Abertura de outra família de produtos no mesmo cliente.'
        ]},
        { t: 'nota', tom: 'ok', titulo: 'Frase que funciona', x: '"Consigo chegar nesse preço se fecharmos o volume do trimestre inteiro." Você não recusou — condicionou.' },

        { t: 'h2', x: 'Alçada' },
        { t: 'p', x: 'Cada nível de desconto tem um aprovador. Peça a aprovação antes de comunicar o preço ao cliente, com três informações: preço praticado hoje, preço do concorrente e o que ganhamos em troca. Pedido de exceção sem esses três dados costuma voltar sem resposta.' },
        { t: 'nota', tom: 'alerta', titulo: 'Confirme a sua alçada', x: 'Os percentuais e os aprovadores variam por linha e por tipo de cliente. Confirme os seus com a coordenação — e não use como referência o que foi aprovado para outro vendedor em outra conta.' },

        { t: 'h2', x: 'Quando não dar desconto' },
        { t: 'ul', x: [
          'Cliente com título vencido: primeiro regulariza, depois negocia.',
          'Pedido pequeno e pontual, sem perspectiva de recorrência.',
          'Item de baixo giro em que a margem já está no piso.',
          '"Desconto para conhecer o produto" — para isso existe teste acompanhado, não preço.'
        ]},

        { t: 'h2', x: 'Onde consultar' },
        { t: 'links', x: [
          { label: 'Tabela de Preços', href: 'comercial-tabela-precos.html' },
          { label: 'Análise de Vendas — margem e histórico por cliente', href: 'comercial-vendas.html' }
        ]}
      ]
    },

    {
      id: 'fechamento-follow-up',
      capitulo: 'como-vender',
      titulo: 'Fechamento e follow-up: o que fazer depois do sim',
      resumo: 'Do aceite ao pedido faturado, sem pontas soltas.',
      minutos: 5,
      atualizado: '2026-08-13',
      status: 'rascunho',
      tags: ['fechamento', 'pedido', 'follow-up'],
      blocos: [
        { t: 'h2', x: 'Para que serve' },
        { t: 'p', x: 'Entre o "pode mandar" e a nota faturada existe uma sequência que costuma quebrar: ordem de compra que não chega, cadastro travado, item sem estoque. O acompanhamento é parte da venda.' },

        { t: 'h2', x: 'Checklist do aceite' },
        { t: 'passos', x: [
          { titulo: 'Aceite por escrito', texto: 'E-mail, ordem de compra ou empenho. "Falei com o comprador" não é aceite.' },
          { titulo: 'Confira contra a proposta', texto: 'Código, quantidade, preço e condição. Divergência encontrada agora custa um e-mail; encontrada no faturamento custa uma devolução.' },
          { titulo: 'Cheque o crédito', texto: 'Cliente com limite estourado ou título vencido não fatura. Acione o Financeiro antes de prometer a data.' },
          { titulo: 'Confirme a disponibilidade', texto: 'Veja saldo e prazo antes de confirmar a entrega. Se o item for de reposição, informe o prazo real.' },
          { titulo: 'Registre o fechamento', texto: 'Atualize a oportunidade para fechada/ganha com o valor efetivo, não com o valor da proposta.' }
        ]},

        { t: 'h2', x: 'Follow-up depois do pedido' },
        { t: 'ul', x: [
          'No dia do faturamento: confirme com o cliente que a nota saiu.',
          'Na entrega: confirme o recebimento e se o material chegou completo.',
          'Uma semana depois: pergunte como foi o uso. É aqui que aparece a próxima venda.'
        ]},
        { t: 'nota', tom: 'info', titulo: 'Por que isso importa', x: 'O cliente não distingue Comercial, Logística e Financeiro — para ele, tudo é "a Biomedical". Quem acompanha até a entrega evita que um atraso vire uma troca de fornecedor.' },

        { t: 'h2', x: 'Onde acompanhar' },
        { t: 'links', x: [
          { label: 'Análise de Pedidos', href: 'comercial-clientes.html' },
          { label: 'Sales Report — faturamento', href: 'comercial-sales-report.html' }
        ]}
      ]
    },

    {
      id: 'pos-venda-recompra',
      capitulo: 'como-vender',
      titulo: 'Pós-venda e recompra: como o cliente volta',
      resumo: 'Recorrência, cliente parado e recuperação de conta.',
      minutos: 6,
      atualizado: '2026-08-13',
      status: 'rascunho',
      tags: ['pós-venda', 'recompra', 'cliente perdido', 'recorrência'],
      blocos: [
        { t: 'h2', x: 'Para que serve' },
        { t: 'p', x: 'Cliente que já comprou é o lead mais barato que existe. A maior parte da queda de faturamento não vem de cliente perdido para o concorrente — vem de cliente que simplesmente parou de ser procurado.' },

        { t: 'h2', x: 'Rotina de recorrência' },
        { t: 'passos', x: [
          { titulo: 'Descubra o ciclo do cliente', texto: 'De quanto em quanto tempo ele compra cada família. O intervalo médio é o seu alarme.' },
          { titulo: 'Ligue antes do intervalo vencer', texto: 'Contato de reposição funciona melhor antes da falta, não depois.' },
          { titulo: 'Olhe o que sumiu da cesta', texto: 'Cliente que comprava três famílias e agora compra uma perdeu duas para alguém. Pergunte diretamente.' },
          { titulo: 'Registre o motivo', texto: 'Preço, falta de produto, troca de equipe, problema de entrega. Sem motivo registrado, o mesmo cliente se perde de novo no ano seguinte.' }
        ]},

        { t: 'h2', x: 'Cliente parado: como reabrir' },
        { t: 'ul', x: [
          'Cheque se existe pendência financeira ou devolução em aberto antes de ligar.',
          'Descubra se a equipe mudou — comprador novo geralmente não conhece a gente.',
          'Leve novidade concreta: item novo, prazo melhor, condição de consignação.',
          'Reabra com um pedido pequeno. Recuperação começa com volume baixo e entrega impecável.'
        ]},

        { t: 'h2', x: 'Onde olhar os números' },
        { t: 'links', x: [
          { label: 'Análise de Vendas — cesta por cliente', href: 'comercial-vendas.html' }
        ]}
      ]
    },

    /* ══════════════ CAPÍTULO · FERRAMENTAS ══════════════ */
    {
      id: 'salesforce-basico',
      capitulo: 'ferramentas',
      titulo: 'Salesforce: o mínimo que precisa estar em dia',
      resumo: 'Conta, oportunidade, atividade e cotação — o que registrar e quando.',
      minutos: 7,
      atualizado: '2026-08-13',
      status: 'rascunho',
      tags: ['salesforce', 'crm', 'oportunidade', 'conta', 'atividade'],
      blocos: [
        { t: 'h2', x: 'Para que serve' },
        { t: 'p', x: 'O Salesforce é o registro oficial do que está acontecendo com cada cliente. Tudo o que o portal mostra de pipeline, cotação e negociação nasce do que foi digitado lá. CRM vazio não é "vendedor ocupado" — é previsão errada para a empresa inteira.' },

        { t: 'h2', x: 'Os quatro objetos que você usa todo dia' },
        { t: 'tabela', head: ['Objeto', 'O que é', 'Quando mexer'], rows: [
          ['Conta', 'O cliente (hospital, clínica, distribuidor).', 'Ao abrir cadastro e sempre que mudar dado fiscal ou contato.'],
          ['Oportunidade / Negociação', 'Uma venda em andamento, com valor e data.', 'Ao identificar a chance e a cada avanço de etapa.'],
          ['Atividade', 'Visita, ligação, e-mail, reunião.', 'No mesmo dia do contato.'],
          ['Cotação', 'A proposta formal, item a item.', 'Ao montar o preço e ao enviar ao cliente.']
        ]},

        { t: 'h2', x: 'Regras de higiene' },
        { t: 'ul', x: [
          'Uma oportunidade por negócio real — não uma por produto conversado.',
          'Data de fechamento sempre no futuro e sempre plausível.',
          'Etapa reflete o que já aconteceu, não a expectativa.',
          'Oportunidade sem atividade há 30 dias: reaqueça ou feche como perdida.',
          'Proposta enviada fica anexada na oportunidade.'
        ]},
        { t: 'nota', tom: 'alerta', titulo: 'Cuidado com a duplicata', x: 'Antes de criar uma conta, pesquise pelo CNPJ. Conta duplicada quebra o histórico de compra, o limite de crédito e todos os relatórios do cliente.' },

        { t: 'h2', x: 'Como isso aparece no portal' },
        { t: 'p', x: 'O Funil de Oportunidades (módulo Negociações) do portal lê os dados do CRM. Se um número parece errado no dashboard, o lugar de corrigir é o Salesforce — o portal só reflete.' },

        { t: 'h2', x: 'Onde fazer' },
        { t: 'links', x: [
          { label: 'Salesforce', href: 'https://biomedical.lightning.force.com/lightning/page/home', ext: true },
          { label: 'Funil de Oportunidades', href: 'comercial-funil.html' }
        ]}
      ]
    },

    {
      id: 'sales-report',
      capitulo: 'ferramentas',
      titulo: 'Sales Report: leia seus números antes da reunião',
      resumo: 'Filtros, período e as visões que respondem as perguntas mais comuns.',
      minutos: 6,
      atualizado: '2026-08-13',
      status: 'rascunho',
      tags: ['sales report', 'power bi', 'faturamento', 'dashboard', 'relatório'],
      blocos: [
        { t: 'h2', x: 'Para que serve' },
        { t: 'p', x: 'O Sales Report é o faturamento oficial: o que saiu em nota, por cliente, produto, região e período. É a fonte para meta, comissão e discussão de resultado — e é a mesma base que a coordenação enxerga.' },

        { t: 'h2', x: 'As visões e o que cada uma responde' },
        { t: 'tabela', head: ['Submódulo', 'Pergunta que responde'], rows: [
          ['Visão geral', 'Como está o faturamento no período, contra o período anterior.'],
          ['Análise de Vendas', 'Quem comprou o quê, com que valor e margem.'],
          ['Análise de Pedidos', 'O que foi pedido e como está o comportamento de compra.'],
          ['Performance de Vendas', 'Como está cada vendedor e cada região contra a meta.']
        ]},

        { t: 'h2', x: 'Como filtrar sem se enganar' },
        { t: 'passos', x: [
          { titulo: 'Comece pelo período', texto: 'Ano e mês primeiro. A maior parte das divergências entre duas pessoas olhando o mesmo painel é período diferente.' },
          { titulo: 'Depois recorte a base', texto: 'Empresa, filial, região, vendedor. Cada filtro aplicado vale para todos os visuais da aba.' },
          { titulo: 'Compare sempre com referência', texto: 'Valor sozinho não diz nada. Olhe contra o mesmo mês do ano anterior ou contra a meta.' },
          { titulo: 'Limpe os filtros ao trocar de pergunta', texto: 'Filtro esquecido é a causa nº 1 de "o número não bate".' }
        ]},
        { t: 'nota', tom: 'info', titulo: 'Faturamento ≠ pipeline', x: 'Sales Report mostra o que já virou nota. Oportunidade em aberto está no Funil, não aqui. Comparar os dois como se fossem a mesma coisa gera discussão sem fim.' },

        { t: 'h2', x: 'Antes da reunião de resultado' },
        { t: 'ul', x: [
          'Seu número do mês e a variação contra o mês anterior.',
          'As três contas que mais cresceram e as três que mais caíram.',
          'Uma explicação para cada queda relevante — e o que já foi feito.',
          'O que está no funil para o mês seguinte.'
        ]},

        { t: 'h2', x: 'Onde abrir' },
        { t: 'links', x: [
          { label: 'Sales Report — visão geral', href: 'comercial-sales-report.html' },
          { label: 'Análise de Vendas', href: 'comercial-vendas.html' },
          { label: 'Performance de Vendas', href: 'comercial-performance-vendas.html' }
        ]}
      ]
    },

    {
      id: 'pi-cotacao',
      capitulo: 'ferramentas',
      titulo: 'PI · Cotação: da solicitação do cliente à cotação no CRM',
      resumo: 'Envie o PDF, revise os campos e crie a negociação sem digitar tudo de novo.',
      minutos: 5,
      atualizado: '2026-08-13',
      status: 'rascunho',
      tags: ['pi', 'cotação', 'pedido inteligente', 'automação', 'ia'],
      blocos: [
        { t: 'h2', x: 'Para que serve' },
        { t: 'p', x: 'O PI · Cotação lê o documento que o cliente mandou, extrai os itens e monta a cotação, em vez de você redigitar item por item. O ganho é tempo e, principalmente, menos erro de digitação de código e quantidade.' },

        { t: 'h2', x: 'Passo a passo' },
        { t: 'passos', x: [
          { titulo: 'Envie o arquivo', texto: 'PDF da solicitação, do pedido ou da planilha do cliente.' },
          { titulo: 'Confira o que foi extraído', texto: 'Cliente, itens, códigos e quantidades. Esta é a etapa que não pode ser pulada: a leitura automática acerta a maior parte, não a totalidade.' },
          { titulo: 'Complete o que faltar', texto: 'Campos obrigatórios da negociação que não estavam no documento.' },
          { titulo: 'Gere a cotação', texto: 'Confirme e deixe o sistema criar o registro no Salesforce.' },
          { titulo: 'Revise no CRM', texto: 'Abra a cotação criada e confira preço e condição antes de enviar ao cliente.' }
        ]},
        { t: 'nota', tom: 'alerta', titulo: 'A conferência é sua', x: 'A extração automática é apoio, não substituto. Item com quantidade errada que passa da conferência vira pedido errado, e o retrabalho volta para o Comercial.' },

        { t: 'h2', x: 'Quando não usar' },
        { t: 'ul', x: [
          'Documento ilegível, foto torta ou digitalização de baixa qualidade — digite manualmente.',
          'Cotação com condição comercial complexa que exige negociação item a item.',
          'Licitação: o caminho é o módulo de Licitações, não o PI.'
        ]},

        { t: 'h2', x: 'Onde abrir' },
        { t: 'links', x: [
          // PI · Cotação saiu (recorte Comercial + Estoque): página oculta, fora deste portal
          { label: 'PI · Pedido', href: 'pedido-inteligente.html' }
        ]}
      ]
    },

    {
      id: 'tabela-precos',
      capitulo: 'ferramentas',
      titulo: 'Tabela de Preços: qual preço vale para este cliente',
      resumo: 'Preço vigente por convênio e tipo de cliente, com busca.',
      minutos: 4,
      atualizado: '2026-08-13',
      status: 'rascunho',
      tags: ['preço', 'tabela', 'convênio'],
      blocos: [
        { t: 'h2', x: 'Para que serve' },
        { t: 'p', x: 'Existe mais de uma tabela: o preço muda conforme o tipo de cliente e o convênio. A Tabela de Preços do portal mostra o valor vigente, com busca por código e por descrição.' },

        { t: 'h2', x: 'Como consultar' },
        { t: 'passos', x: [
          { titulo: 'Busque pelo código', texto: 'Código é sempre mais confiável que descrição — descrição parecida entre itens diferentes é comum no nosso portfólio.' },
          { titulo: 'Selecione a tabela certa', texto: 'Confirme o convênio ou o tipo de cliente antes de copiar o valor.' },
          { titulo: 'Confira a vigência', texto: 'Preço tem data. Se a proposta vai demorar a ser enviada, revalide no dia do envio.' }
        ]},
        { t: 'nota', tom: 'alerta', titulo: 'Nunca reaproveite proposta antiga', x: 'Copiar preço de uma proposta salva no computador é a causa mais frequente de venda abaixo da margem. Sempre volte à fonte.' },

        { t: 'h2', x: 'Onde abrir' },
        { t: 'links', x: [
          { label: 'Tabela de Preços', href: 'comercial-tabela-precos.html' }
        ]}
      ]
    },

    /* ══════════════ CAPÍTULO · PROCESSOS ══════════════ */
    {
      id: 'processo-fca',
      capitulo: 'processos',
      titulo: 'FCA: abrir cadastro e acompanhar',
      resumo: 'O que a FCA resolve, quais documentos são exigidos e como não travar.',
      minutos: 5,
      atualizado: '2026-08-13',
      status: 'rascunho',
      tags: ['fca', 'cadastro', 'cliente novo', 'crédito'],
      blocos: [
        { t: 'h2', x: 'Para que serve' },
        { t: 'p', x: 'A FCA é o caminho oficial para cadastrar um cliente novo e para pedir alteração em cadastro existente. Sem cadastro aprovado não existe pedido, não existe nota e não existe venda — por isso ela é a primeira coisa a abrir, não a última.' },

        { t: 'h2', x: 'Quando abrir' },
        { t: 'ul', x: [
          'Cliente novo, antes de qualquer promessa de prazo de entrega.',
          'Mudança de razão social, endereço de entrega ou dados de faturamento.',
          'Pedido de aumento de limite de crédito.',
          'Reativação de cliente inativo há muito tempo.'
        ]},

        { t: 'h2', x: 'Passo a passo' },
        { t: 'passos', x: [
          { titulo: 'Reúna a documentação antes de abrir', texto: 'Solicitação incompleta fica parada esperando anexo — e o prazo corre do mesmo jeito.' },
          { titulo: 'Confira o CNPJ', texto: 'Verifique se já existe cadastro ou conta no CRM. Duplicidade cria cliente fantasma e quebra o histórico.' },
          { titulo: 'Abra a solicitação', texto: 'Preencha com o nome fiscal exato, não com o nome popular do hospital.' },
          { titulo: 'Acompanhe', texto: 'Cadastro passa por análise (inclusive de crédito). Acompanhe em vez de esperar aviso.' },
          { titulo: 'Confirme antes de vender', texto: 'Só prometa entrega depois que o cadastro estiver aprovado e com limite definido.' }
        ]},
        { t: 'nota', tom: 'info', titulo: 'Dica de prazo', x: 'Abra a FCA no dia da primeira visita, mesmo antes do pedido existir. Quando a compra aparecer, o cadastro já estará pronto.' },

        { t: 'h2', x: 'Onde fazer' },
        { t: 'links', x: [
          { label: 'FCA no portal', href: 'comercial-fca.html' }
        ]}
      ]
    },

    {
      id: 'processo-cotacao',
      capitulo: 'processos',
      titulo: 'Da cotação ao pedido: o caminho oficial',
      resumo: 'Sequência completa, quem responde por cada etapa e onde costuma travar.',
      minutos: 7,
      atualizado: '2026-08-13',
      status: 'rascunho',
      tags: ['cotação', 'pedido', 'processo', 'faturamento'],
      blocos: [
        { t: 'h2', x: 'Para que serve' },
        { t: 'p', x: 'Este é o fluxo padrão da venda direta. Ele existe para que qualquer pessoa do time execute do mesmo jeito, em qualquer filial, e para que o pedido não pare no meio do caminho.' },

        { t: 'h2', x: 'O fluxo' },
        { t: 'passos', x: [
          { titulo: '1. Solicitação do cliente', texto: 'Chega por e-mail, portal do hospital ou visita. Guarde o documento original — ele é a referência de tudo.' },
          { titulo: '2. Cadastro conferido', texto: 'Cliente ativo, sem bloqueio. Se não estiver, abre-se a FCA.' },
          { titulo: '3. Cotação montada', texto: 'Itens, preço da tabela vigente, condição e prazo. Registrada no CRM.' },
          { titulo: '4. Aprovação de desconto', texto: 'Se houver exceção de preço, aprovação antes do envio.' },
          { titulo: '5. Envio ao cliente', texto: 'Proposta enviada e anexada na oportunidade, com data de validade.' },
          { titulo: '6. Aceite', texto: 'Ordem de compra, e-mail de aprovação ou empenho. Sempre por escrito.' },
          { titulo: '7. Pedido', texto: 'Pedido gerado a partir da cotação aceita, conferido item a item.' },
          { titulo: '8. Faturamento e entrega', texto: 'Acompanhe até a nota sair e o material chegar.' }
        ]},

        { t: 'h2', x: 'Onde costuma travar' },
        { t: 'tabela', head: ['Trava', 'Como evitar'], rows: [
          ['Cadastro incompleto', 'FCA aberta na primeira visita, não no dia do pedido.'],
          ['Crédito bloqueado', 'Checar títulos em aberto antes de confirmar a data de entrega.'],
          ['Divergência de preço', 'Pedido conferido contra a cotação antes de entrar.'],
          ['Item sem saldo', 'Confirmar disponibilidade antes de prometer prazo.'],
          ['Ordem de compra com dado errado', 'Conferir CNPJ, código e quantidade no aceite.']
        ]},
        { t: 'nota', tom: 'ok', titulo: 'Regra de ouro', x: 'Todo pedido nasce de uma cotação registrada. Pedido que aparece sem cotação é onde mora a divergência de preço.' }
      ]
    },

    {
      id: 'processo-consignacao',
      capitulo: 'processos',
      titulo: 'Consignação: remessa, uso, faturamento e devolução',
      resumo: 'Como funciona o material que fica no hospital antes de ser vendido.',
      minutos: 8,
      atualizado: '2026-08-13',
      status: 'rascunho',
      tags: ['consignação', 'remessa', 'devolução', 'lote', 'estoque'],
      blocos: [
        { t: 'h2', x: 'Para que serve' },
        { t: 'p', x: 'Na consignação o material fica no hospital e só é faturado quando é usado. É o que viabiliza o procedimento sem espera — e é também o processo com maior risco de perda quando o controle falha: material vencido, lote sem baixa e devolução que nunca volta.' },

        { t: 'h2', x: 'O ciclo' },
        { t: 'passos', x: [
          { titulo: '1. Remessa', texto: 'O material sai com nota de remessa (não é venda). A partir daí ele é nosso, mas está fisicamente no cliente.' },
          { titulo: '2. Uso no procedimento', texto: 'O hospital consome o item. É aqui que a informação precisa chegar rápido ao Comercial — com lote e quantidade.' },
          { titulo: '3. Faturamento do consumo', texto: 'O que foi usado vira venda. É esta etapa que reconhece a receita.' },
          { titulo: '4. Reposição', texto: 'O consumo dispara a reposição para o estoque consignado não zerar.' },
          { titulo: '5. Devolução', texto: 'O que não foi usado, ou está próximo do vencimento, retorna com nota de devolução.' }
        ]},

        { t: 'h2', x: 'O que o Comercial acompanha' },
        { t: 'ul', x: [
          'Saldo consignado por cliente: o que está lá e há quanto tempo.',
          'Validade curta: item parado perto do vencimento tem que girar ou voltar.',
          'Consumo sem faturamento: usado e não faturado é receita não reconhecida.',
          'Rastreabilidade de lote: exigência regulatória, não burocracia.'
        ]},
        { t: 'nota', tom: 'alerta', titulo: 'Consignação não é depósito', x: 'Material consignado é ativo da empresa parado no cliente. Saldo alto e sem giro é custo — e cobra explicação na revisão de estoque.' },

        { t: 'h2', x: 'Onde acompanhar' },
        { t: 'links', x: [
          { label: 'Saldo consignado', href: 'estoque-saldo-consignado.html' },
          { label: 'Devoluções e faturamento', href: 'estoque-devolucoes-faturamento.html' },
          { label: 'Rastreabilidade', href: 'estoque-rastreabilidade.html' },
          { label: 'PI · Consignação', href: 'pi-consignacao.html' }
        ]}
      ]
    },

    {
      id: 'processo-licitacao',
      capitulo: 'processos',
      titulo: 'Licitação: o que o Comercial faz em cada etapa',
      resumo: 'Do edital captado à entrega, com o papel de cada área.',
      minutos: 6,
      atualizado: '2026-08-13',
      status: 'rascunho',
      tags: ['licitação', 'edital', 'pregão', 'pncp', 'lici'],
      blocos: [
        { t: 'h2', x: 'Para que serve' },
        { t: 'p', x: 'Em licitação o prazo manda: perdeu a data, perdeu o negócio, por melhor que seja o preço. Este artigo separa o que é do Comercial e o que é do time de Licitações, para nada ficar sem dono.' },

        { t: 'h2', x: 'As etapas' },
        { t: 'passos', x: [
          { titulo: '1. Captação do edital', texto: 'Editais chegam pelos portais públicos e pelo radar do portal. Edital que você recebeu do cliente também precisa entrar no fluxo.' },
          { titulo: '2. Análise de aderência', texto: 'Item a item: o que temos, o que não temos e o que é equivalente. É aqui que se decide se vale participar.' },
          { titulo: '3. Decisão de participar', texto: 'Considere preço-teto, quantidade, prazo de entrega, exigência de marca e condição de pagamento.' },
          { titulo: '4. Documentação e proposta', texto: 'Habilitação, certidões e proposta no formato exigido. Formato errado desclassifica antes de olhar o preço.' },
          { titulo: '5. Disputa', texto: 'Lances dentro do limite aprovado. Limite se define antes, não no calor da sessão.' },
          { titulo: '6. Resultado e contrato', texto: 'Ganhou: contrato, empenho e cronograma de entrega. Perdeu: registre o preço vencedor — é informação de mercado.' }
        ]},
        { t: 'nota', tom: 'info', titulo: 'Quantidade vem do edital oficial', x: 'A quantidade do item é a do edital publicado, não a de um resumo ou de uma leitura rápida do PDF. Divergência de quantidade em proposta pública é problema sério.' }
        // RECORTE COMERCIAL + ESTOQUE: o "Onde acompanhar" (link para a Área de
        // Licitação) saiu — a área não existe neste portal.
      ]
    },

    /* ══════════════ CAPÍTULO · DICIONÁRIO ══════════════ */
    {
      id: 'dicionario-comercial',
      capitulo: 'dicionario',
      titulo: 'Dicionário do Comercial: siglas e termos de A a Z',
      resumo: 'O vocabulário que aparece nas reuniões, nos sistemas e nos e-mails.',
      minutos: 9,
      atualizado: '2026-08-13',
      status: 'rascunho',
      tags: ['glossário', 'siglas', 'dicionário', 'termos'],
      blocos: [
        { t: 'h2', x: 'Como usar' },
        { t: 'p', x: 'Termos que aparecem no dia a dia do Comercial. Use a busca do Sales Playbook para chegar direto no termo — ela procura também dentro deste artigo.' },

        { t: 'h2', x: 'Termos' },
        { t: 'termos', x: [
          { termo: 'Alçada', def: 'Limite de desconto ou condição que cada nível pode aprovar sozinho. Acima dela, precisa de aprovação formal antes de comunicar o cliente.' },
          { termo: 'Cesta do cliente', def: 'Conjunto de famílias que o cliente compra. Cesta que encolhe é sinal de perda de espaço para o concorrente.' },
          { termo: 'Comodato', def: 'Equipamento cedido ao cliente sem custo de aquisição, geralmente vinculado ao consumo de material. Tem contrato e obrigações de acompanhamento.' },
          { termo: 'Consignação', def: 'Material que fica no cliente e só é faturado quando usado. A remessa não é venda; o faturamento acontece no consumo.' },
          { termo: 'Cotação', def: 'A proposta formal, item a item, registrada no CRM. É de onde o pedido deve nascer.' },
          { termo: 'Devolução', def: 'Retorno de material — por não uso em consignação, por validade curta ou por divergência de pedido. Toda devolução tem nota.' },
          { termo: 'Empenho', def: 'Documento do órgão público que reserva a verba. Em venda pública, é o equivalente à ordem de compra.' },
          { termo: 'FCA', def: 'Ficha de Cadastro e Atividade: o processo oficial de cadastrar cliente novo e alterar cadastro existente.' },
          { termo: 'Funil / pipeline', def: 'Conjunto de oportunidades em aberto, distribuídas por etapa. Mostra o futuro; o Sales Report mostra o passado.' },
          { termo: 'Lead', def: 'Contato ou instituição com potencial ainda não qualificado. Vira oportunidade só depois de qualificado.' },
          { termo: 'Licitação / pregão', def: 'Processo de compra pública. Regras, prazos e formato de proposta são definidos no edital.' },
          { termo: 'Lote', def: 'Identificação do fabricante que permite rastrear o material até o paciente. Exigência regulatória em consignação e cirurgia.' },
          { termo: 'Margem', def: 'O que sobra depois do custo do produto. Desconto sai direto daqui — por isso desconto é a concessão mais cara.' },
          { termo: 'Negociação', def: 'No CRM, o registro da venda em andamento (oportunidade), com valor, etapa e data prevista.' },
          { termo: 'OPME', def: 'Órteses, Próteses e Materiais Especiais. Categoria com regras próprias de autorização, glosa e rastreabilidade.' },
          { termo: 'Ordem de compra (OC)', def: 'Documento do cliente que autoriza a venda. É o aceite formal na venda privada.' },
          { termo: 'Pedido', def: 'O registro que gera a nota fiscal. Deve espelhar exatamente a cotação aceita.' },
          { termo: 'PNCP', def: 'Portal Nacional de Contratações Públicas — onde os editais e seus itens são publicados oficialmente.' },
          { termo: 'Proctoria', def: 'Acompanhamento de um médico proctor em procedimento, para apoiar a equipe na adoção da técnica ou do produto.' },
          { termo: 'Registro ANVISA', def: 'Autorização sanitária do produto. Sem registro válido não se vende, e a maioria dos editais exige o número.' },
          { termo: 'Remessa', def: 'Nota de saída de material sem venda — o caso típico é a consignação.' },
          { termo: 'Reposição', def: 'Envio que recompõe o estoque consignado depois do consumo.' },
          { termo: 'Ruptura', def: 'Falta do item quando ele é necessário. Em centro cirúrgico, ruptura custa a conta inteira.' },
          { termo: 'Sales Report', def: 'O painel de faturamento realizado: o que virou nota, por cliente, produto, região e período.' },
          { termo: 'Título vencido', def: 'Fatura não paga no prazo. Trava faturamento novo e precisa de tratativa com o Financeiro antes de negociar.' },
          { termo: 'Validade curta', def: 'Item próximo do vencimento. Em consignação, precisa girar ou voltar antes de virar perda.' }
        ]}
      ]
    },

    {
      id: 'dicionario-status-salesforce',
      capitulo: 'dicionario',
      titulo: 'Etapas da negociação: o que cada fase significa',
      resumo: 'Quando mover a oportunidade e o que precisa estar pronto em cada etapa.',
      minutos: 4,
      atualizado: '2026-08-13',
      status: 'rascunho',
      tags: ['etapa', 'funil', 'status', 'oportunidade', 'crm'],
      blocos: [
        { t: 'h2', x: 'Para que serve' },
        { t: 'p', x: 'Etapa é linguagem comum: quando você diz "está em negociação", todo mundo tem que entender a mesma coisa. Etapa inflada estraga a previsão do mês inteiro.' },

        { t: 'h2', x: 'A régua' },
        { t: 'tabela', head: ['Etapa', 'Só entra aqui quando', 'Não é'], rows: [
          ['Prospecção', 'Existe um contato e um interesse identificado.', 'Uma lista de hospitais para visitar.'],
          ['Qualificação', 'Verba, decisor, prazo e concorrente estão respondidos.', '"O médico gostou."'],
          ['Proposta enviada', 'A proposta saiu, com data e validade, e está anexada.', 'A proposta está sendo montada.'],
          ['Negociação', 'O cliente respondeu e discute preço ou condição.', 'Você mandou e ficou sem resposta.'],
          ['Fechada — ganha', 'Existe aceite por escrito.', 'O comprador disse que vai comprar.'],
          ['Fechada — perdida', 'Está decidido, com motivo registrado.', 'Sumiu e ninguém retorna — isso também se fecha, com motivo.']
        ]},
        { t: 'nota', tom: 'info', titulo: 'Sobre o motivo da perda', x: 'Preço, prazo, portfólio, relacionamento, exigência técnica. O motivo real é o que permite corrigir a próxima disputa — motivo genérico não ensina nada.' },

        { t: 'h2', x: 'Onde ver' },
        { t: 'links', x: [
          { label: 'Funil de Oportunidades', href: 'comercial-funil.html' },
        ]}
      ]
    }
  ];

  window.SALESBOOKING = {
    versao: '1.0',
    atualizado: '2026-08-13',
    capitulos: CAPITULOS,
    trilhas: TRILHAS,
    artigos: ARTIGOS
  };
})();
