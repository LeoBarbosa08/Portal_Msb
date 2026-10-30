// ================================================================
// /api/alertas — "Para você" da home: aprovações, pendências e novidades
// da PESSOA logada.
//
//   GET /api/alertas   -> { ok, papel, resumo, itens:[…], diagnostico }
//
// É um AGREGADOR SÓ-LEITURA: não escreve em blob nenhum, não chama o
// Dynamics e não provoca e-mail. Cada fonte continua tendo o seu endpoint,
// que é o dono da regra; aqui só se CONTA o que está esperando a pessoa,
// para a home poder dizer "você tem uma nova aprovação".
//
// DOIS PORTÕES, e o motivo de serem dois:
//   area   — a pendência é do DEPARTAMENTO (fila da LICI, Vigia do
//            Estoque, prazos da Cobrança). Vale a lista de
//            auth.authorizedAreas, que já respeita AREAS_RESERVADAS.
//   papel  — a pendência é de uma ALÇADA nominal (quem aprova remessa no
//            PI, quem aprova a comissão). Quem decide é o grupo do Entra
//            das envs daquele módulo, IMPORTADAS do endpoint dono da regra
//            (`_papeis`) — nunca recopiadas para cá, senão a lista de
//            aprovadores passaria a viver em dois lugares.
//
// Item de alçada exige id token VALIDADO: com AUTH_ENFORCE off a
// identidade vem de header, e header se forja — aí o alerta de aprovação
// (justamente o que revela que existe remessa/comissão esperando alguém)
// apareceria para quem escrevesse o e-mail certo. Área RESERVADA
// (AREAS_RESERVADAS) segue a mesma trava, igual ao requireArea.
//
// NUNCA DERRUBA A HOME: cada coletor roda isolado e com prazo
// (Promise.allSettled + relógio de ALERTAS_TIMEOUT_MS). Blob fora do ar,
// env que falta ou fila corrompida = aquele coletor não devolve nada, o
// motivo vai em `diagnostico` e os outros seguem. O front trata erro/401
// como "sem alertas" e não mostra a faixa.
//
// O QUE SAI DAQUI: contagem e rótulo curto. Nada de linha de pedido, de
// valor por comissionado ou de carteira de cliente — para isso a pessoa
// abre o módulo, onde está o gate de verdade. A home fica em tela
// compartilhada e projetor; alerta não é lugar de dinheiro por pessoa.
//
//   Envs (todas opcionais)
//     ALERTAS_TIMEOUT_MS   prazo de cada coletor (default 4000)
//     ALERTAS_JANELA_DIAS  o que conta como "novidade" (default 7)
// ================================================================

const auth = require('../shared/auth');
const http = require('../shared/http');

const VERSAO = 'alertas/1';

const PRAZO = Math.max(500, Number(process.env.ALERTAS_TIMEOUT_MS || 4000));
const JANELA = Math.max(1, Number(process.env.ALERTAS_JANELA_DIAS || 7));
const MS_DIA = 86400000;
const MAX_ITENS = 12;

// rótulo amigável da área (espelha o AREA_LABEL do /api/avisos)
const AREA_LABEL = {
  comercial: 'Comercial', financeiro: 'Financeiro', logistica: 'Logística',
  marketing: 'Marketing', estoque: 'Estoque', contabil: 'Contábil',
  licitacao: 'Licitações', administrativo: 'Administrativo', produtos: 'Produtos',
  pessoas: 'Pessoas & Cultura', qualidade: 'Qualidade & Regulatório',
  ti: 'TI & Sistemas', diretoria: 'Diretoria'
};

const ORDEM_PRIO = { alta: 0, media: 1, baixa: 2 };

// ── utilidades ───────────────────────────────────────────────────
function plural(n, um, muitos) { return n === 1 ? um : muitos; }

// Data de HOJE no fuso de São Paulo (UTC-3) como 'AAAA-MM-DD'. É o mesmo
// formato em que a Cobrança guarda o prazo de retorno — comparar string
// com string evita o clássico "o dia voltou um" de converter para Date.
function hojeSP() {
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

function diasDesde(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  return isNaN(t) ? null : (Date.now() - t) / MS_DIA;
}

function recente(iso, dias) {
  const d = diasDesde(iso);
  return d != null && d <= (dias == null ? JANELA : dias);
}

function limpa(v, max) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s.slice(0, max || 120);
}

function emailDe(o) { return String((o && o.email) || '').trim().toLowerCase(); }

// Prazo por coletor: fonte lenta (blob de outra região, SAS expirada
// pendurando a conexão) não pode fazer a home esperar.
function comPrazo(promessa, ms, rotulo) {
  let t = null;
  const relogio = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error('tempo esgotado (' + ms + 'ms) em ' + rotulo)), ms);
    if (t && t.unref) t.unref();
  });
  return Promise.race([promessa, relogio]).then(
    (v) => { if (t) clearTimeout(t); return v; },
    (e) => { if (t) clearTimeout(t); throw e; }
  );
}

// ── o item de alerta ─────────────────────────────────────────────
// `id` é ESTÁVEL por tipo de pendência (não por registro): é a chave que o
// front usa para lembrar o que a pessoa já dispensou. Contagem muda, id não.
function item(o) {
  return {
    id: String(o.id),
    tipo: o.tipo || 'pendencia',          // aprovacao | pendencia | insight | aviso
    prioridade: o.prioridade || 'media',  // alta | media | baixa
    area: o.area || null,
    areaRotulo: o.area ? (AREA_LABEL[o.area] || o.area) : (o.areaRotulo || ''),
    modulo: limpa(o.modulo, 60),
    titulo: limpa(o.titulo, 90),
    texto: limpa(o.texto, 220),
    contagem: Number(o.contagem) || 0,
    cta: limpa(o.cta || 'Abrir', 28),
    href: String(o.href || ''),
    gate: o.gate === 'papel' ? 'papel' : 'area',
    quando: o.quando || null,
    icone: o.icone || 'sino',
    dispensavel: o.dispensavel === true
  };
}

// ═════════════════════════════════════════════════════════════════
// REGRAS PURAS — recebem os dados JÁ LIDOS e devolvem os itens. Ficam
// separadas da leitura para o guard (scripts/test-alertas.js) poder
// rodar cada cenário sem blob, sem Entra e sem rede.
// ═════════════════════════════════════════════════════════════════
const regras = {

  // ── PI · alçada de remessa ─────────────────────────────────────
  // Dois papéis na mesma fila: quem DECIDE (Coordenação) e quem ESPERA
  // (o operador que mandou o pedido). O operador precisa saber que foi
  // liberado justamente porque a aprovação é de uso único: sem voltar e
  // terminar o pedido, ela vira nada.
  piRemessa(fila, ctx) {
    const out = [];
    const HREF = 'pages/pi-pedido-teste.html#aprovacoes';

    if (ctx.piAprovador) {
      const pend = fila.filter((i) => i && i.status === 'pendente');
      if (pend.length) {
        const ultimo = pend[0] || {};
        out.push(item({
          id: 'pi-remessa-pendentes', tipo: 'aprovacao', prioridade: 'alta',
          area: 'estoque', modulo: 'PI · Alçada de remessa', icone: 'aprovacao',
          titulo: pend.length === 1 ? 'Uma nova aprovação de remessa'
                                    : pend.length + ' aprovações de remessa esperando você',
          texto: 'Cliente sem pasta de termo assinado no SharePoint. ' +
                 (pend.length === 1
                   ? 'Solicitado por ' + (limpa((ultimo.operador && (ultimo.operador.nome || ultimo.operador.email)) || '', 40) || 'um operador') + '.'
                   : 'A fila espera a decisão da Coordenação de Compras e Estoque.'),
          contagem: pend.length, cta: 'Decidir', href: HREF, gate: 'papel',
          quando: ultimo.criadoEm || null
        }));
      }
    }

    const minhas = fila.filter((i) => i && emailDe(i.operador) === ctx.email);

    const liberadas = minhas.filter((i) => i.status === 'aprovado');
    if (liberadas.length) {
      const l = liberadas[0];
      out.push(item({
        id: 'pi-remessa-liberada', tipo: 'aprovacao', prioridade: 'alta',
        area: 'comercial', modulo: 'PI · Alçada de remessa', icone: 'liberado',
        titulo: liberadas.length === 1 ? 'Sua remessa foi liberada'
                                       : liberadas.length + ' remessas suas foram liberadas',
        texto: 'A liberação é de USO ÚNICO: volte ao PI e termine o pedido de ' +
               (limpa((l.cliente && (l.cliente.nome || l.cliente.codigo)) || '', 60) || 'consignação') + '.',
        contagem: liberadas.length, cta: 'Terminar pedido', href: HREF, gate: 'papel',
        quando: (l.decisao && l.decisao.em) || l.criadoEm || null
      }));
    }

    const negadas = minhas.filter((i) => i.status === 'reprovado' && recente(i.decisao && i.decisao.em));
    if (negadas.length) {
      const n = negadas[0];
      out.push(item({
        id: 'pi-remessa-reprovada', tipo: 'pendencia', prioridade: 'media',
        area: 'comercial', modulo: 'PI · Alçada de remessa', icone: 'negado',
        titulo: negadas.length === 1 ? 'Sua remessa foi reprovada'
                                     : negadas.length + ' remessas suas foram reprovadas',
        texto: limpa((n.decisao && n.decisao.motivo) || 'Veja o motivo na aba Aprovações.', 160),
        contagem: negadas.length, cta: 'Ver motivo', href: HREF, gate: 'papel',
        quando: (n.decisao && n.decisao.em) || null, dispensavel: true
      }));
    }

    return out;
  },

  // ── Diretoria · pagamento de comissão ──────────────────────────
  // Sem R$ no alerta: a home fica aberta em tela compartilhada, e comissão
  // por pessoa é dado de dinheiro. Aqui só a competência e a contagem.
  comissao(pendentes, ctx) {
    const out = [];
    if (!pendentes.length) return out;
    const HREF = 'pages/diretoria-comissao.html';
    const p = pendentes[0] || {};
    const rotulo = limpa((p.periodo && p.periodo.rotulo) || p.chave, 24);

    if (ctx.comissaoAprovador) {
      out.push(item({
        id: 'comissao-aguarda-aprovacao', tipo: 'aprovacao', prioridade: 'alta',
        area: 'diretoria', modulo: 'Pagamento de Comissão', icone: 'dinheiro',
        titulo: pendentes.length === 1 ? 'Comissão de ' + rotulo + ' aguardando sua aprovação'
                                       : pendentes.length + ' competências aguardando sua aprovação',
        texto: 'Enviada por ' + (limpa(p.por || p.porEmail, 40) || 'quem paga') +
               '. O valor congela no momento em que você aprovar.',
        contagem: pendentes.length, cta: 'Conferir e aprovar', href: HREF, gate: 'papel',
        quando: p.at || null
      }));
      return out;
    }

    // Quem ENVIOU vê o próprio envio parado — é o que evita o mês ficar
    // esquecido esperando um aval que ninguém sabe que está pendente.
    const minhas = pendentes.filter((x) => String(x.porEmail || '').toLowerCase() === ctx.email);
    if (minhas.length) {
      const m = minhas[0];
      out.push(item({
        id: 'comissao-minha-solicitacao', tipo: 'pendencia', prioridade: 'media',
        area: 'diretoria', modulo: 'Pagamento de Comissão', icone: 'relogio',
        titulo: 'Comissão de ' + limpa((m.periodo && m.periodo.rotulo) || m.chave, 24) + ' esperando o Diretor Comercial',
        texto: 'Você enviou para aprovação e a competência segue aberta. Nada congelou ainda.',
        contagem: minhas.length, cta: 'Ver competência', href: HREF, gate: 'papel',
        quando: m.at || null
      }));
    }
    return out;
  },

  // ── LICI · fila de aprovações do Radar ─────────────────────────
  liciFila(fila, ctx) {
    const out = [];
    const HREF = 'pages/lici.html#aprovacoes';
    const pend = fila.filter((e) => e && (e.status === 'pendente' || e.status === 'erro'));

    if (pend.length) {
      // Edital tem data de encerramento: o que fecha em 3 dias é outra
      // urgência do que o que fecha em 3 semanas, e é isso que decide a cor.
      const agora = Date.now();
      const urgentes = pend.filter((e) => {
        const t = e.encerramento ? Date.parse(e.encerramento) : NaN;
        return !isNaN(t) && t >= agora && (t - agora) <= 3 * MS_DIA;
      }).length;
      out.push(item({
        id: 'lici-fila-pendentes', tipo: 'aprovacao',
        prioridade: urgentes ? 'alta' : 'media',
        area: 'licitacao', modulo: 'LICI · Aprovações', icone: 'aprovacao',
        titulo: pend.length === 1 ? 'Um edital aguardando aprovação'
                                  : pend.length + ' editais aguardando aprovação',
        texto: urgentes
          ? urgentes + ' ' + plural(urgentes, 'encerra', 'encerram') + ' nos próximos 3 dias — decida antes de perder o prazo.'
          : 'Captados automaticamente e analisados pela IA, esperando aprovar ou descartar.',
        contagem: pend.length, cta: 'Abrir fila', href: HREF, gate: 'area',
        quando: (pend[0] && (pend[0].analisadoEm || pend[0].decididoEm)) || null
      }));
    }

    // Aprovado é compromisso assumido: se encerra amanhã e ninguém montou a
    // proposta, o alerta é o único lugar onde isso aparece sem abrir a tela.
    const agora = Date.now();
    const fechando = fila.filter((e) => {
      if (!e || e.status !== 'aprovado') return false;
      const t = e.encerramento ? Date.parse(e.encerramento) : NaN;
      return !isNaN(t) && t >= agora && (t - agora) <= 3 * MS_DIA;
    });
    if (fechando.length) {
      out.push(item({
        id: 'lici-aprovados-encerrando', tipo: 'insight', prioridade: 'alta',
        area: 'licitacao', modulo: 'LICI · Aprovações', icone: 'relogio',
        titulo: fechando.length === 1 ? 'Um edital aprovado encerra em até 3 dias'
                                      : fechando.length + ' editais aprovados encerram em até 3 dias',
        texto: limpa((fechando[0] && (fechando[0].orgao || fechando[0].objeto)) || 'Confira a fila de aprovados.', 150),
        contagem: fechando.length, cta: 'Ver editais', href: HREF, gate: 'area',
        quando: (fechando[0] && fechando[0].decididoEm) || null, dispensavel: true
      }));
    }

    return out;
  },

  // ── Vigia de Consignação (Estoque) ─────────────────────────────
  vigia(fila, ctx) {
    const pend = fila.filter((x) => x && x.status === 'pendente');
    if (!pend.length) return [];
    const vencidos = pend.filter((x) => x.classe === 'vencido').length;
    return [item({
      id: 'vigia-pendentes', tipo: 'aprovacao', prioridade: vencidos ? 'alta' : 'media',
      area: 'estoque', modulo: 'Vigia de Consignação', icone: 'caixa',
      titulo: pend.length === 1 ? 'Um item do Vigia aguardando decisão'
                                : pend.length + ' itens do Vigia aguardando decisão',
      texto: vencidos
        ? vencidos + ' ' + plural(vencidos, 'já venceu', 'já venceram') + ' no cliente. Nenhum item vira ação sem alguém aprovar.'
        : 'Consignado parado no cliente. Nenhum item vira ação sem alguém aprovar.',
      contagem: pend.length, cta: 'Revisar fila', href: 'pages/estoque-vigia.html', gate: 'area',
      quando: (pend[0] && pend[0].detectadoEm) || null
    })];
  },

  // ── Sentinela de Atas e Contratos (Licitação) ──────────────────
  // Recebe o PLANO gravado pela última varredura (só o resumo interessa).
  // Três avisos: a faixa de alerta (vencidos + até 60 dias) com saldo, os
  // itens que nunca faturaram e — enquanto o cron não existe — a própria
  // varredura ficando velha. R$ só o TOTAL do departamento, nunca por
  // pessoa: a home fica em projetor.
  sentinela(plano, ctx) {
    if (!plano || !plano.resumo) return [];
    const out = [];
    const HREF = 'pages/licitacao-sentinela.html';
    const r = plano.resumo, pc = r.porClasse || {};
    const dias = (r.alerta && r.alerta.dias) || 60;
    const vencidos = (pc.vencido && pc.vencido.itens) || 0;
    const criticos = (pc.critico && pc.critico.itens) || 0;
    const brl = (v) => 'R$ ' + Math.round(Number(v) || 0).toLocaleString('pt-BR');
    const idade = diasDesde(plano.geradoEm);

    if (vencidos + criticos > 0) {
      const abe = ((pc.vencido && pc.vencido.abe) || 0) + ((pc.critico && pc.critico.abe) || 0);
      const n = vencidos + criticos;
      out.push(item({
        id: 'sentinela-faixa-alerta', tipo: 'pendencia', prioridade: vencidos ? 'alta' : 'media',
        area: 'licitacao', modulo: 'Sentinela de Atas e Contratos', icone: 'relogio',
        titulo: n === 1 ? 'Um item de contrato com saldo vence em até ' + dias + ' dias'
                        : n + ' itens de contrato com saldo vencem em até ' + dias + ' dias',
        texto: brl(abe) + ' em aberto na faixa de alerta'
          + (vencidos ? ' — ' + vencidos + ' ' + plural(vencidos, 'já venceu', 'já venceram') + ' com saldo.' : '.')
          + ' O plano por órgão e responsável está na Sentinela.',
        contagem: n, cta: 'Ver plano', href: HREF, gate: 'area', quando: plano.geradoEm || null
      }));
    }

    const nf = r.nuncaFaturou || {};
    if (nf.itens > 0) {
      out.push(item({
        id: 'sentinela-nunca-faturou', tipo: 'insight', prioridade: 'media',
        area: 'licitacao', modulo: 'Sentinela de Atas e Contratos', icone: 'caixa',
        titulo: nf.itens === 1 ? 'Um item contratado nunca teve faturamento'
                               : nf.itens + ' itens contratados nunca tiveram faturamento',
        texto: brl(nf.abe) + ' ganhos e ainda sem uma nota — o caso mais caro e mais silencioso.',
        contagem: nf.itens, cta: 'Ver itens', href: HREF, gate: 'area',
        quando: plano.geradoEm || null, dispensavel: true
      }));
    }

    // Até o cron da fase 4, "semanal" é alguém abrir a página. Passou de
    // 10 dias, a home cobra.
    if (idade != null && idade > 10) {
      out.push(item({
        id: 'sentinela-varredura-velha', tipo: 'pendencia', prioridade: 'baixa',
        area: 'licitacao', modulo: 'Sentinela de Atas e Contratos', icone: 'relogio',
        titulo: 'Sentinela sem varredura há ' + Math.floor(idade) + ' dias',
        texto: 'O plano de contratos é da varredura de ' + limpa(String(plano.hoje || plano.geradoEm || '').slice(0, 10), 10) + '. Abra a Sentinela e clique em "Varrer agora".',
        contagem: 0, cta: 'Varrer agora', href: HREF, gate: 'area', quando: plano.geradoEm || null, dispensavel: true
      }));
    }
    return out;
  },

  // ── Cobrança · prazo de retorno (Financeiro) ───────────────────
  // O prazo é TEXTO 'AAAA-MM-DD' (é o que o <input type=date> entrega),
  // então a comparação é de string, sem Date no meio.
  cobranca(itens, ctx) {
    const out = [];
    const HREF = 'pages/cobranca-notas.html';
    const hoje = hojeSP();
    const chaves = Object.keys(itens || {});
    const tratativas = chaves
      .map((k) => Object.assign({ nota: k }, itens[k] || {}))
      .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(String(t.prazoRetorno || '')));

    const vencidos = tratativas.filter((t) => t.prazoRetorno < hoje);
    const hojeVence = tratativas.filter((t) => t.prazoRetorno === hoje);

    if (vencidos.length) {
      out.push(item({
        id: 'cobranca-prazo-vencido', tipo: 'pendencia', prioridade: 'alta',
        area: 'financeiro', modulo: 'Cobrança · Notas em Aberto', icone: 'relogio',
        titulo: vencidos.length === 1 ? 'Uma tratativa com prazo de retorno vencido'
                                      : vencidos.length + ' tratativas com prazo de retorno vencido',
        texto: 'O prazo combinado com o cliente passou e a nota segue em aberto.',
        contagem: vencidos.length, cta: 'Abrir cobrança', href: HREF, gate: 'area',
        quando: null
      }));
    }
    if (hojeVence.length) {
      out.push(item({
        id: 'cobranca-prazo-hoje', tipo: 'pendencia', prioridade: 'media',
        area: 'financeiro', modulo: 'Cobrança · Notas em Aberto', icone: 'agenda',
        titulo: hojeVence.length === 1 ? 'Uma tratativa com retorno marcado para hoje'
                                       : hojeVence.length + ' tratativas com retorno marcado para hoje',
        texto: 'Prazo de retorno vence hoje — hora de falar com o cliente.',
        contagem: hojeVence.length, cta: 'Abrir cobrança', href: HREF, gate: 'area',
        quando: null
      }));
    }
    return out;
  },

  // ── Diretoria · Votação OKR ────────────────────────────────────
  okr(dados, ctx, convidado) {
    const ciclo = dados.ciclo || {};
    // Convidado não tem a área: o acesso dele é NOMINAL, e o gate do item
    // acompanha isso (é o que a home usa para saber por que ele pode abrir).
    const gate = convidado ? 'papel' : 'area';

    // FASE 1 — para o convidado, esta faixa É o aviso do convite. Quem tem a
    // Diretoria já vê o módulo no menu; o convidado não vê nada em lugar
    // nenhum, e só saberia que foi chamado se alguém contasse por fora.
    if (ciclo.fase === 'inclusao') {
      if (!convidado) return [];
      const meu = (dados.ideias || []).some(function (i) {
        return i && i.autor && String(i.autor.email || '').toLowerCase() === ctx.email;
      });
      if (meu) return [];                      // já mandou ideia: não cobra de novo
      const conv = ((ciclo.convidados) || []).filter(c => c && c.email === ctx.email)[0];
      return [item({
        id: 'okr-convite', tipo: 'aprovacao', prioridade: 'media',
        area: 'diretoria', modulo: 'Votação OKR', icone: 'voto',
        titulo: 'Você foi convidado para o ciclo de OKR',
        texto: (ciclo.nome ? ciclo.nome + ' · ' : '') + 'Envie a sua ideia antes de a votação abrir.',
        contagem: 1, cta: 'Enviar ideia', href: 'pages/diretoria-votacao-okr.html', gate: gate,
        quando: (conv && conv.em) || ciclo.criadoEm || null
      })];
    }

    if (ciclo.fase !== 'votacao') return [];
    const sel = (dados.ideias || []).filter((i) => i && i.selecionada);
    if (!sel.length) return [];
    const pessoa = (dados.pessoas || {})[ctx.email] || {};
    if (pessoa.votouEm) return [];             // já concluiu: não cobra mais
    const meus = (dados.votos || {})[ctx.email] || {};
    const falta = sel.filter((i) => !(meus[i.id] && meus[i.id].imp && meus[i.id].urg)).length;
    if (!falta) return [];
    return [item({
      id: 'okr-votacao-aberta', tipo: 'pendencia', prioridade: 'media',
      area: 'diretoria', modulo: 'Votação OKR', icone: 'voto',
      titulo: 'Votação OKR aberta',
      texto: 'Faltam ' + falta + ' ' + plural(falta, 'ideia', 'ideias') + ' para você dar nota de Importância e Urgência.',
      contagem: falta, cta: 'Votar', href: 'pages/diretoria-votacao-okr.html', gate: gate,
      quando: ciclo.liberadoEm || null
    })];
  },

  // ── Mural de avisos ────────────────────────────────────────────
  // Só o que foi PUBLICADO por gente (id 'u…') — o mural não tem mais avisos
  // de demonstração ('s1'..'s6'), zerados em 03/09/26. A data do aviso é o
  // `ts` (epoch ms) gravado pelo /api/avisos: sem convertê-lo para ISO, o
  // recente() recebia undefined e NENHUM aviso novo chegava ao "Para você".
  avisos(lista, ctx) {
    const quandoDe = (a) => {
      if (a && a.criadoEm) return a.criadoEm;
      if (a && a.at) return a.at;
      const t = Number(a && a.ts);
      return t ? new Date(t).toISOString() : null;
    };
    const novos = (lista || [])
      .filter((a) => a && /^u/.test(String(a.id || '')) && recente(quandoDe(a)))
      .sort((a, b) => String(quandoDe(b) || '').localeCompare(String(quandoDe(a) || '')));
    if (!novos.length) return [];
    const a = novos[0];
    return [item({
      id: 'avisos-novos-' + String(a.id),   // muda a cada aviso: dispensar um não esconde o próximo
      tipo: 'aviso', prioridade: 'baixa',
      areaRotulo: limpa(a.setor, 40) || 'Mural', modulo: 'Central de Avisos', icone: 'mural',
      titulo: novos.length === 1 ? limpa(a.assunto, 80)
                                 : limpa(a.assunto, 60) + ' · +' + (novos.length - 1) + ' ' + plural(novos.length - 1, 'aviso', 'avisos'),
      texto: limpa(a.corpo, 180),
      contagem: novos.length, cta: 'Ler no mural', href: 'central-avisos.html', gate: 'area',
      quando: quandoDe(a), dispensavel: true
    })];
  },

  // Alta primeiro, depois o mais recente. Empate resolvido pelo id para a
  // ordem não dançar entre dois carregamentos iguais.
  ordenar(itens) {
    // `alta` vale 0, e 0 é falsy: com `|| 9` a prioridade mais urgente ia
    // para o fim da lista. Comparação explícita com null.
    const peso = (p) => (ORDEM_PRIO[p] == null ? 9 : ORDEM_PRIO[p]);
    return itens.slice().sort((a, b) => {
      const p = peso(a.prioridade) - peso(b.prioridade);
      if (p) return p;
      const q = String(b.quando || '').localeCompare(String(a.quando || ''));
      if (q) return q;
      return String(a.id).localeCompare(String(b.id));
    });
  }
};

// ═════════════════════════════════════════════════════════════════
// COLETORES — a parte que toca I/O. `require` é LAZY de propósito: um
// módulo com env faltando ou erro de carga derruba só o próprio coletor,
// não o endpoint inteiro.
//
// RECORTE COMERCIAL + ESTOQUE: este portal só tem as duas áreas, então só
// fica o coletor do mural, que é de todos. Os do portal completo (alçada do
// PI de teste, comissão, LICI, Sentinela, Cobrança e Votação OKR) apontavam
// para páginas que não existem aqui; o do Vigia do Estoque saiu no RECORTE
// MSB (30/10/26). As regras puras deles, acima, ficaram como estavam — sem
// coletor, não rodam.
// ═════════════════════════════════════════════════════════════════
const COLETORES = [
  {
    id: 'avisos', rotulo: 'Mural de avisos',
    async coletar(ctx) {
      // O mural já é de todo mundo autenticado (é a regra do /api/avisos).
      const store = require('../shared/avisos-store');
      if (!store.configured()) return [];
      const d = await store.read();
      return regras.avisos(Array.isArray(d.itens) ? d.itens : [], ctx);
    }
  }
];

// ═════════════════════════════════════════════════════════════════
module.exports = async function (context, req) {
  const reply = (status, body) => {
    context.res = {
      status,
      headers: Object.assign(
        { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        http.cors(req)
      ),
      body
    };
  };
  if (req.method === 'OPTIONS') { context.res = http.preflight(req); return; }

  try {
    const { user, validated } = await auth.requireUser(req);
    const email = String((user && user.email) || '').trim().toLowerCase();
    if (!email) { reply(401, { ok: false, versao: VERSAO, error: 'Não autenticado.' }); return; }

    const az = await auth.authorizedAreas(user).catch(() => ({ areas: [], modulos: [], restricted: true, reason: 'erro' }));
    const areas = new Set(az.areas || []);

    const ctx = {
      user, email, validated: validated === true,
      nome: String((user && (user.name || user.email)) || '').trim(),
      areas,
      // Área RESERVADA (hoje: diretoria) só com token verificado — com o
      // enforce off o e-mail vem de header, e header se forja. Mesma trava
      // do requireArea; sem ela a "área fechada" seria decorativa aqui.
      temArea(a) {
        if (!areas.has(a)) return false;
        const reservada = Object.prototype.hasOwnProperty.call(auth.AREAS_RESERVADAS || {}, a);
        return reservada ? (validated === true && auth.areaLiberada(a, email)) : true;
      }
    };

    const resultados = await Promise.allSettled(
      COLETORES.map((c) => comPrazo(Promise.resolve().then(() => c.coletar(ctx)), PRAZO, c.id))
    );

    let itens = [];
    const colheu = [];
    const falhou = [];
    resultados.forEach((r, i) => {
      const c = COLETORES[i];
      if (r.status === 'fulfilled') {
        const lista = Array.isArray(r.value) ? r.value.filter(Boolean) : [];
        if (lista.length) colheu.push({ fonte: c.id, itens: lista.length });
        itens = itens.concat(lista);
      } else {
        // Fonte quebrada é diagnóstico, não erro de tela: a home mostra o
        // resto e o motivo fica registrado (log do servidor + resposta).
        http.logError(context, 'alertas/' + c.id, r.reason);
        falhou.push({ fonte: c.id, motivo: String((r.reason && r.reason.message) || r.reason).slice(0, 160) });
      }
    });

    itens = regras.ordenar(itens).slice(0, MAX_ITENS);
    const acoes = itens.filter((i) => i.tipo === 'aprovacao').length;

    reply(200, {
      ok: true, versao: VERSAO,
      papel: { email: email, nome: ctx.nome, validado: ctx.validated },
      resumo: {
        total: itens.length,
        acoes: acoes,
        pendencias: itens.filter((i) => i.tipo === 'pendencia').length,
        novidades: itens.filter((i) => i.tipo === 'insight' || i.tipo === 'aviso').length
      },
      itens: itens,
      diagnostico: {
        areas: Array.from(areas).sort(),
        restricted: az.restricted === true,
        reason: az.reason || null,
        colheu: colheu, falhou: falhou
      }
    });
  } catch (err) {
    http.sendError(context, req, 'alertas', err);
  }
};

// As regras puras ficam expostas para o guard (scripts/test-alertas.js):
// "o que conta como pendência desta pessoa" é decisão de negócio e o
// portão de área/alçada não pode regredir sem alguém perceber.
module.exports._regras = regras;
module.exports._util = { hojeSP, recente, item, AREA_LABEL, PRAZO, JANELA };
