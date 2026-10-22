// ================================================================
// api/shared/auth.js — Identidade & Autorização do Portal (server-side)
//
// PROBLEMA que este módulo resolve: as Functions estavam confiando em
// headers/JWT NÃO validados (x-user-email, x-portal-oid/email, JWT sem
// verificação de assinatura). Qualquer um forjava a identidade.
//
// Aqui a identidade vem SEMPRE de um id token do Entra cuja ASSINATURA é
// verificada contra o JWKS do tenant (crypto nativo — sem dependência
// externa). A autorização por área (grupo AAD → áreas) também é feita aqui,
// no servidor, com token app-only (autoritativo).
//
// ROLLOUT FASEADO: enquanto AUTH_ENFORCE != "true", requireUser/requireArea
// NÃO bloqueiam — validam o token se der, mas caem no comportamento legado
// (headers) para não derrubar o portal durante o deploy. Ligue AUTH_ENFORCE
// = "true" nas App Settings quando confirmar que o token está chegando.
//
// Env vars:
//   PORTAL_TENANT_ID, PORTAL_CLIENT_ID   (default = valores atuais do app)
//   PORTAL_CLIENT_SECRET                 (app-only p/ ler grupos no Graph)
//   AUTH_ENFORCE = "true"                (liga o bloqueio real)
//   PORTAL_ALLOWED_DOMAIN = domínios EXTRAS, separados por vírgula (opcional)
// ================================================================

const crypto = require('crypto');

const TENANT         = process.env.PORTAL_TENANT_ID || 'c311c9e6-6017-42a9-b306-4057beba5786';
const CLIENT         = process.env.PORTAL_CLIENT_ID || '129978ce-ff3b-431d-98b3-66a1bcb766b1';
const AAD_SECRET     = process.env.PORTAL_CLIENT_SECRET;
const ENFORCE        = String(process.env.AUTH_ENFORCE || '').toLowerCase() === 'true';
// Domínios aceitos no login. bio-id.com entrou em 19/10/2026 (contas da
// BIO.ID no mesmo tenant); msbbrasil.com em 20/10/2026 (contas da MSB no
// Azure AD). A env SOMA domínios, não substitui: um App Setting antigo
// "biomedical.com.br" não tira os outros de volta.
// O front (auth.js da raiz) tem a mesma lista em AUTH.allowedDomains.
const ALLOWED_DOMAINS = ['biomedical.com.br', 'bio-id.com', 'msbbrasil.com']
  .concat(String(process.env.PORTAL_ALLOWED_DOMAIN || '').split(','))
  .map(d => d.trim().toLowerCase().replace(/^@/, ''))
  .filter((d, i, a) => d && a.indexOf(d) === i);
const ALLOWED_DOMAIN = ALLOWED_DOMAINS[0];   // o principal — legado de quem lia um só
function dominioPermitido(email) {
  const e = String(email || '').trim().toLowerCase();
  return ALLOWED_DOMAINS.some(d => e.endsWith('@' + d));
}
const SKEW           = 300; // tolerância de relógio (s)

const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Áreas válidas (data-area dos cards do index.html)
// RECORTE COMERCIAL + ESTOQUE: este portal só tem as duas áreas. O mapa de
// grupos (GRUPO_AREAS) continua IGUAL ao do portal completo — quem ganha
// outra área lá simplesmente não ganha nada aqui, porque toda saída passa
// por esta lista (authorizedAreas filtra por ela; os fail-open e o acesso
// full entregam exatamente ela). Assim o mapa pode ser recopiado do portal
// completo sem ajuste.
// RECORTE MSB (22/10/26): entra o Contábil, só com a Gestão de Custos SG&A
// (as páginas que não vieram estão em PAGINAS_FORA, mais abaixo).
const ALL_AREAS = ['comercial', 'estoque', 'contabil'];

// Áreas ABERTAS a qualquer pessoa autenticada — entram no allowed mesmo de
// quem cai numa regra de grupo restritiva.
// A Diretoria ERA assim (a Votação OKR nasceu como canal de toda a empresa),
// e SAIU em 02/09/2026 a pedido do dono do portal: a área virou RESERVADA
// (ver AREAS_RESERVADAS logo abaixo). Em 03/09/2026 ela passou a valer para
// quem tem ACESSO FULL — então hoje manda ideia e vota no OKR quem é admin,
// quem está em UNRESTRICTED_GROUPS e os e-mails da reserva; o resto da
// empresa, não. Reabrir para TODOS é devolver 'diretoria' aqui e tirar de
// AREAS_RESERVADAS.
const AREAS_ABERTAS = [];

// E-mails que SEMPRE veem todas as áreas (TI / diretoria), minúsculo
const ADMIN_EMAILS = ['leonardo.barbosa@biomedical.com.br'];

// ── ÁREAS RESERVADAS ─────────────────────────────────────────────
// Área que só entrega para quem tem ACESSO FULL (ver abaixo) ou está nesta
// lista de e-mails. Vale POR ÚLTIMO, depois de qualquer outra regra:
// liberação por e-mail (EMAIL_AREAS), regra de grupo e os dois fail-open
// (grupo não mapeado / Graph indisponível) NÃO entregam área reservada. É a
// única forma de fechar de verdade — as outras listas só ADICIONAM acesso.
// Diretoria: reservada em 02/09/2026 (as duas contas do dono do portal);
// em 03/09/2026 passou a valer também para quem tem acesso full.
// Vendedor: área nova de 29/09/2026, ainda EM CONSTRUÇÃO (os 4 módulos são
// casca). Fica reservada até o dono do portal liberar: abrir para os
// vendedores = tirar 'vendedor' daqui e mapear os grupos de vendas em
// GRUPO_AREAS.
// Gerencial: área nova de 06/10/2026 (módulo Indicadores, PROTÓTIPO). Mesma
// regra do Vendedor — abrir = tirar 'gerencial' daqui e mapear os grupos.
// Canal de Atendimento: área nova de 08/10/2026 — o Customer Service saiu do
// Comercial e virou departamento. Herda a reserva que o módulo tinha (o gate
// por e-mail do nav-sidebar.js, só do dono): por isso UM e-mail só. Os dados
// continuam com a equipe do módulo (exigirEquipe em api/shared/cs-motor.js).
// Abrir para o time = pôr os e-mails em Configurações › Equipe do Customer
// Service E tirar 'atendimento' daqui (mapeando os grupos em GRUPO_AREAS).
// Compras: área nova de 14/10/2026, INDISPONÍVEL — por enquanto só uma
// visão geral com informações avulsas. Pedido do dono: "libere somente para
// mim". Por isso as duas contas dele E reserva ESTRITA (RESERVA_ESTRITA logo
// abaixo): nem o acesso full entra. Abrir para a equipe = tirar 'compras'
// daqui e de RESERVA_ESTRITA e mapear o grupo dela em GRUPO_AREAS.
const AREAS_RESERVADAS = {
  diretoria:   ['leonardo.barbosa@biomedical.com.br', 'ia@biomedical.com.br'],
  vendedor:    ['leonardo.barbosa@biomedical.com.br', 'ia@biomedical.com.br'],
  gerencial:   ['leonardo.barbosa@biomedical.com.br', 'ia@biomedical.com.br'],
  atendimento: ['leonardo.barbosa@biomedical.com.br'],
  compras:     ['leonardo.barbosa@biomedical.com.br', 'ia@biomedical.com.br']
};

// ── RESERVA ESTRITA ──────────────────────────────────────────────
// Área reservada em que o ACESSO FULL (abaixo) NÃO entra: só os e-mails da
// lista em AREAS_RESERVADAS. Quem tem acesso full passa a receber a resposta
// RESTRITA (todas as outras áreas) — é o que tira o cartão e o menu da tela
// dele, como já acontece com os dois fail-open.
const RESERVA_ESTRITA = ['compras'];

// ── ACESSO FULL ──────────────────────────────────────────────────
// 03/09/2026, pedido do dono do portal: "a área Diretoria é somente para as
// pessoas que têm acesso full hoje no sistema, sem restrição". Acesso full é
// exatamente o que o portal já chama assim: e-mail ADMIN ou grupo
// UNRESTRICTED_GROUPS (quem cai neles vê TUDO). Essa gente passa na área
// reservada (menos nas de RESERVA_ESTRITA); a lista de e-mails acima
// continua valendo como complemento.
//
// Os dois FAIL-OPEN — Graph fora do ar ('groups_unavailable') e grupo sem
// mapeamento ('no_group_match') — NÃO são acesso full: eles entregam
// ALL_AREAS por falta de informação, e área reservada segue fechada para
// eles. É o que mantém a reserva fail-closed.
const RAZOES_FULL = ['admin', 'unrestricted_group'];

// A área está liberada para este e-mail? (área não reservada -> sempre sim)
function areaLiberada(area, email, full) {
  const a = String(area || '').toLowerCase();
  const donos = AREAS_RESERVADAS[a];
  if (!donos) return true;
  // acesso full entra em toda reservada, menos nas de RESERVA_ESTRITA
  if (full === true && RESERVA_ESTRITA.indexOf(a) < 0) return true;
  return !!email && donos.indexOf(String(email).trim().toLowerCase()) >= 0;
}
function podarReservadas(areas, email, full) {
  return (areas || []).filter(a => areaLiberada(a, email, full));
}

// Saídas "sem restrição" (admin, grupo sem restrição e os dois fail-open)
// entregavam ALL_AREAS com restricted:false — e os dois fronts (area-access.js
// e nav-sidebar.js) IGNORAM a lista quando restricted é false, liberando a
// tela inteira. Então, quando a poda tira uma área reservada, a resposta passa
// a ser RESTRITA: é o único jeito de a área sumir do card e da navegação de
// quem cai nesses caminhos. Para quem é dono da reservada nada muda (a poda
// não tira nada, restricted continua false).
function todasMenosReservadas(email, reason) {
  const areas = podarReservadas(ALL_AREAS, email, RAZOES_FULL.indexOf(reason) >= 0);
  return { areas: areas, modulos: [], restricted: areas.length !== ALL_AREAS.length, reason: reason };
}

// Mesma lista, exposta para os módulos decidirem PERMISSÃO DENTRO da tela —
// não só quais áreas aparecem. Ex.: só o admin altera o status das notas na
// Cobrança (/api/cobranca-notas). Sem isso cada módulo montaria a sua
// listinha de e-mails e elas divergiriam no primeiro remanejamento.
function isAdmin(email) {
  return !!email && ADMIN_EMAILS.indexOf(String(email).trim().toLowerCase()) >= 0;
}

// Mapa de GRUPOS AAD → áreas permitidas (chave: displayName OU Object ID).
const GRUPO_AREAS = {
  'ede1900e-f9a1-47c5-87c8-a7a359b7ffef': ['administrativo'],
  'fd557344-5d64-478a-951a-d70cf4ad2bda': ['administrativo'],
  '8e210dda-212d-42a1-a402-a88b2a833f8f': ['administrativo'],
  // GRP-SEG-BIO-ADMINISTRATIVO
  'bf4288ba-9b19-4993-b0fd-28e37a1ee15d': ['administrativo'],
  '5287d65c-804d-4695-a5f4-4a76ead37210': ['comercial', 'estoque'],
  'e7ee7469-7c8a-49df-a477-c7a9ad10ccbf': ['comercial', 'estoque'],
  '8a88695c-f264-4a23-97a9-a6ac308079a8': ['comercial', 'estoque'],
  '240e7cae-3921-4016-b9ec-2ce9321ffef2': ['comercial', 'estoque'],
  '6caeb9b0-f680-4723-a88d-b90d80ac0aa7': ['comercial', 'estoque'],
  'fc979a32-d829-45cf-9032-2ab8712fb514': ['comercial', 'estoque'],
  '6e7b968d-5b51-4dec-b026-72604099f185': ['comercial', 'estoque'],
  '5a68c120-ab29-4b36-9c5e-4a7ecfd4a05b': ['comercial', 'estoque'],
  'f59084e0-57d1-47b7-be5d-ca637e6ac39c': ['comercial', 'estoque'],
  '40f6df58-1bc1-4c46-9b9c-a5fbf7c1a7e3': ['comercial', 'estoque'],
  'cffaab73-de5a-485b-af61-ab6e06602dfd': ['comercial', 'estoque'],
  '459a4ffa-1e3d-4fa2-b7fb-6f5a2b61157c': ['comercial', 'estoque'],
  '38784d70-34ba-417c-8503-dd5dc0dc76b3': ['comercial', 'estoque'],
  '6f153428-a7f1-4814-8614-9b06cfd279ea': ['comercial', 'estoque'],
  '3affd97c-66f1-4873-ab72-0ee5938de5f1': ['comercial', 'estoque'],
  '8f89b5d5-e835-4b7e-8fef-cb15e1f05b92': ['comercial', 'estoque'],
  '9a337069-c0ff-4dcc-a0bc-e1632430a561': ['comercial', 'estoque'],
  '7ec7784a-6cba-4756-aaea-6fbf56e82336': ['comercial', 'estoque'],
  'f138fd4b-4206-41ea-a292-00cb3e5ebed5': ['comercial', 'estoque'],
  '2afd6d96-9493-4b6b-b2b8-01e6e7f71758': ['comercial', 'estoque'],
  'e62e21f7-66cc-4b14-a185-376a19b9a3fd': ['comercial', 'estoque'],
  'bae8fb21-9050-4131-95c1-aee79b358368': ['comercial'], // Equipe Comercial - Assistentes Venda Recorrente — Estoque só por módulo (GRUPO_MODULOS)
  'caf0c909-2196-425d-91f4-9b184ce2b39c': ['comercial', 'estoque'],
  '27a1c6b0-e0c5-486f-9062-59db653a243e': ['comercial', 'estoque'],
  'e2665a93-db91-4c16-ae10-e99fce715aec': ['comercial', 'estoque'],
  '4ce9c8ec-6c36-4873-ac66-96a1b3e65b6a': ['comercial', 'estoque'],
  '2540882c-edc6-4d43-ace7-6427f75a3896': ['comercial', 'estoque'],
  '9deb1c22-fdfa-4dbe-871d-2546cbc97f23': ['comercial', 'estoque'],
  '82fe4a02-ac8a-4130-a499-8f164e394856': ['comercial', 'estoque'],
  'c10c3060-6b38-4814-85b8-16a96ac82887': ['comercial', 'estoque'],
  'dd5b5fb5-2f42-4bc2-91af-4b8fa06df00f': ['comercial', 'estoque'],
  'efc5fa57-5c92-4442-a4ce-3c2cb515a9cc': ['comercial', 'estoque'],
  'e2137c5e-08e2-4f0c-b079-80aa1dcf4627': ['comercial', 'estoque'],
  '242ee5c0-b3e1-4ca8-b289-66538bdcdfb9': ['comercial', 'estoque'],
  'a0a60f87-1351-43ff-9910-5bb639b8092a': ['comercial', 'estoque'],
  '92084dbd-c7e2-4465-9bc0-a247f5447eb8': ['comercial', 'estoque'],
  '725ce41b-d240-4ae8-a144-e99bfea0006d': ['comercial', 'estoque'],
  '137f5ecc-6903-455c-9213-32e6fea40044': ['comercial', 'estoque'],
  '492acc26-0ac5-4299-8573-5b92228c1cbc': ['comercial', 'estoque'],
  '8b4c33cb-6f6c-449d-9b22-8665ea7d12e9': ['comercial', 'estoque'],
  'c55f24e0-92e2-4301-a856-09ec5f7a6bea': ['comercial', 'estoque'],
  'f9620640-bdab-4061-9a83-ea120ba7b9b4': ['comercial', 'estoque'],
  '6988b1b2-6d18-476a-950b-e8487ad4da87': ['comercial', 'estoque'],
  '737183bd-38de-4b5e-bfc7-da204b963f2d': ['comercial', 'estoque'],
  '6f386e3d-82ca-4633-8e04-1a79b53510c2': ['comercial', 'estoque'],
  '93a7e333-fb12-447d-b1d5-f62a130f603b': ['comercial', 'estoque'],
  '002a30b5-4b0d-47eb-a307-8143f6ed8864': ['comercial', 'estoque'],
  'c6f53bec-b20c-4c69-8f9e-482cba135e69': ['comercial', 'estoque'],
  '857ce4ff-944e-4d2b-a57e-b215cb76dec6': ['comercial', 'estoque'],
  '64631fb9-998e-47bf-8597-104b8ec39a55': ['comercial', 'estoque'],
  '7f62463d-b01a-4a38-bc7b-a3f20ccda596': ['comercial', 'estoque'],
  '66cd4ad7-d776-40bc-915f-f4694332f106': ['comercial', 'estoque'],
  '353fe652-fa09-4828-b095-9393900a784d': ['comercial', 'estoque'],
  'bd9a53c8-91d4-4f94-adca-c5a6caf89916': ['comercial', 'estoque'],
  'f3ddab21-a879-4447-9586-7f57d8f40276': ['comercial', 'estoque'],
  '3aeb4ee9-2139-43a6-ba75-c935b0a57bef': ['comercial', 'estoque'],
  '50a5bcaa-c25a-4eca-9e42-5fe440830daa': ['contabil'],
  '02fb288a-53f1-4754-bee1-c14cb237e868': ['contabil'],
  '57430cac-19ed-4f59-ac6f-44b6eec1243a': ['contabil'],
  'd2836472-6580-4b30-8429-abb9f6034bf1': ['contabil'],
  '239d43d8-7f05-405e-a1ba-479a1b5485ba': ['contabil'],
  '5de0d97f-eb1a-4313-ae26-dc911bd3aa5a': ['qualidade'],
  'bede6632-b519-42c4-93f8-d162ed4fd208': ['qualidade'],
  '2c4210bf-c483-423a-9ab1-187dc2091a38': ['qualidade'],
  '2a436624-8bab-4c55-aa33-026941f75d45': ['estoque', 'comercial'],
  '1c07bb87-e5c2-4d04-b0d9-ef1280b442dd': ['estoque', 'comercial'],
  '4c93532c-04a3-454a-bb7d-fae6b128845f': ['estoque', 'comercial'],
  '2ce79101-0437-48b3-aa01-dbebd1dbe93d': ['estoque', 'comercial', 'licitacao'], // Equipe de compras e estoque - Coordenacao
  'd7649bf4-e7d5-43d8-95b7-8b95569afdcf': ['estoque', 'comercial'],
  'dd89d89b-aab4-4b8b-996c-aab9101e6dad': ['comercial', 'estoque'],
  '5a8806d5-5082-49db-8edc-efa0aad9871d': ['comercial', 'estoque'],
  '87d92d3f-08f7-4f0f-9f6f-c05e0503c7b8': ['pessoas', 'comercial'],
  '193b2550-8625-42ab-acf3-b35f62d8e3ab': ['pessoas', 'comercial'],
  '68b46d43-759c-414e-bc04-be0fb8f8cfb7': ['pessoas', 'comercial'],
  '4f46431f-86b8-4ea8-8b68-adda6b999959': ['licitacao'], // Equipe de licitações - Analistas — só Licitação
  'b328fdca-d379-4ad2-8384-3eeeb7c2a205': ['licitacao'], // Equipe de licitações - Assistentes — só Licitação
  '949ac6e2-f00c-49d1-915d-1375528b84c7': ['licitacao'], // Equipe de licitações - Coordenação — só Licitação
  '1911242e-25dc-4a98-8088-882af6a6411a': ['logistica'],
  '91323a5c-bd04-474a-88aa-4ca18daddd61': ['logistica'],
  'cee2b759-3d29-4f81-b872-bc0fec0df259': ['logistica'],
  '2b708ffe-34c5-4417-abb2-ba65b124ddd3': ['marketing'],
  '0d864abf-a728-4f1a-9828-564d21e79685': ['marketing'],
  '45cea106-e77d-4017-99a7-4ea52e31856d': ['marketing'],
  '7761e6f5-603f-4a14-bc1d-6a9ba9b3ce3f': ['financeiro'],
  '11c68801-b0c7-47d7-b9a6-f6ef5d0dbcb2': ['financeiro'],
  '00249508-d0ee-4e6c-9ba9-c58c0078890a': ['financeiro'], // Equipe Financeira - Coordenação (EF) — só financeiro
  '2710f474-561c-4498-a42f-792ad9a914fc': ['financeiro'], // Equipe Financeira - Analista — só financeiro
};

// Mapa de GRUPOS AAD -> MÓDULOS avulsos (chave: displayName OU Object ID).
// Libera UMA PÁGINA de outro departamento SEM abrir a área inteira — dar a
// área entregaria junto todos os outros módulos dela. O valor é o id da
// página (nome do arquivo, sem .html).
// A "visão geral" do departamento (contabil.html, comercial.html...) é
// liberada automaticamente para servir de porta de entrada, já filtrada:
// o front (area-access.js / nav-sidebar.js) poda os cards e o menu lateral,
// deixando à vista só os módulos desta lista.
// LIMITE: o grant é de NAVEGAÇÃO. As Functions continuam exigindo ÁREA
// (requireArea), então o grupo precisa ter alguma área aceita pela API que a
// página chama — a Coordenação de Compras e Estoque abaixo já tem
// estoque/comercial, e o /api/pbi-query aceita as duas.
const GRUPO_MODULOS = {
  // Equipe de compras e estoque - Coordenação -> só Margem de Contribuição (Contábil)
  '2ce79101-0437-48b3-aa01-dbebd1dbe93d': [
    'contabil-margem', 'contabil-margem-analitico', 'contabil-margem-nf'
  ],
  // Equipe Financeira - Contas a Pagar -> SÓ o Contas a Pagar do Financeiro
  // (09/10/2026). Sem a área: Contas a Receber, Inadimplência, Baixas,
  // Cobrança e Agente Financeiro ficam fora. Grupo SEM área nenhuma: as
  // páginas abaixo não chamam Function (gravam no SharePoint pelo Graph
  // delegado, no navegador), então o grant de navegação basta.
  // Automação nova do Contas a Pagar = acrescentar a página aqui.
  'c27f1fc2-fafe-4ae6-8d06-627fa4550ae7': [
    'financeiro-contas-pagar', 'financeiro-contas-pagar-comprovantes'
  ],
  // Equipe Comercial - Assistentes Venda Recorrente (19/10/2026): Comercial
  // inteiro (área, acima) + o Estoque MENOS a Ruptura de Estoque e o Vigia de
  // Consignação. Por isso a área estoque saiu do grupo e as páginas vêm uma a
  // uma. Todas leem o Power BI pelo /api/pbi-query, que aceita comercial.
  // Página nova do Estoque NÃO entra sozinha: acrescentar aqui.
  'bae8fb21-9050-4131-95c1-aee79b358368': [
    'estoque-gestao', 'estoque-saldo', 'estoque-validade-curta', 'estoque-movimentacoes',
    'estoque-gestao-consignacao', 'estoque-saldo-consignado', 'estoque-contagem-saldo-nota',
    'estoque-devolucoes-faturamento', 'estoque-rastreabilidade', 'estoque-gmroi',
    'estoque-perdas', 'estoque-consignado-inventario'
  ],
};

// Área "dona" de um id de página pelo PREFIXO do arquivo (contabil-margem ->
// contabil). Serve para não repetir no payload um módulo cuja área a pessoa
// já tem inteira.
// RECORTE MSB: páginas de área DESTE portal que não vieram do completo (o
// Contábil daqui tem só a Gestão de Custos SG&A). Módulo avulso apontando
// para elas é tratado como de outra área: não entra no payload.
const PAGINAS_FORA = ['contabil-dre', 'contabil-margem', 'contabil-margem-analitico', 'contabil-margem-nf', 'agente-contabil'];
function areaDoModulo(id) {
  const f = String(id || '').toLowerCase();
  if (PAGINAS_FORA.indexOf(f) >= 0) return null;
  for (const a of ALL_AREAS) if (f === a || f.indexOf(a + '-') === 0) return a;
  return null;
}

// Grupos cuja ÚNICA área no portal é `area` (ex.: os três grupos que só
// entregam a Licitação). É daqui que a Gestão de Desempenho da Licitação
// tira QUEM avaliar — grupo que dá a área junto de outras (a Coordenação de
// Compras e Estoque tem estoque+comercial+licitação) fica de fora. Um grupo
// novo mapeado só com a área entra na avaliação sem mexer no módulo.
function gruposSoDaArea(area) {
  const a = String(area || '').toLowerCase();
  return Object.keys(GRUPO_AREAS).filter(g => {
    const v = GRUPO_AREAS[g] || [];
    return v.length === 1 && v[0] === a && !UNRESTRICTED_GROUPS.has(g);
  });
}

// Grupos "SEM RESTRIÇÃO" (diretoria/BI/TI): quem cai em qualquer um vê TUDO.
const UNRESTRICTED_GROUPS = new Set([
  '7d98f1bd-72a1-4601-b72c-c115c25b5c4d',
  'b7b7a922-33b8-4e04-b5d2-671acd89660d',
  'd6fe6f6d-2234-4f57-b423-5dca928278cc',
  '333a7480-edd5-4258-8ce5-d12fee2b5658',
  'cc0950a9-e0dd-4372-8645-f2616fc1d5d5',
  '981681d9-23a0-4baa-8c70-42ac9dfc8ef5',
  'bb3e1031-0a2a-462c-a064-b790255e95c1',
  'edec7e0e-fe6d-4732-a741-28aa51eb0fc8',
  '6ccfa256-e202-420b-8332-a69409904b46',
  '39481de7-3e35-42af-a0ca-1f50bfda160c',
  'bf581209-e3b1-4e7d-8a7e-cf95f3ffa270',
  'd0369aaf-d754-47b9-8cd3-1aaf6d0b1dbe',
  '1cd451b5-ec2b-4867-a57e-c70ba902bbd5',
]);

// Liberação EXTRA por e-mail (minúsculo).
const EMAIL_AREAS = { 'ia@biomedical.com.br': ['licitacao', 'administrativo', 'diretoria', 'vendedor', 'gerencial', 'compras'] };

// ── base64url ────────────────────────────────────────────────
function b64urlToBuf(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return Buffer.from(s + pad, 'base64');
}
function decodeSeg(s) { return JSON.parse(b64urlToBuf(s).toString('utf8')); }

function authErr(msg) { const e = new Error('auth: ' + msg); e.status = 401; e.auth = true; return e; }

// ── JWKS do Entra (cache) ────────────────────────────────────
let _jwks = { keys: null, exp: 0 };
async function getJwks(force) {
  const now = Date.now();
  if (!force && _jwks.keys && now < _jwks.exp) return _jwks.keys;
  const url = 'https://login.microsoftonline.com/' + TENANT + '/discovery/v2.0/keys';
  const r = await fetch(url);
  if (!r.ok) throw new Error('JWKS ' + r.status);
  const j = await r.json();
  _jwks = { keys: (j && j.keys) || [], exp: now + 12 * 3600 * 1000 };
  return _jwks.keys;
}
async function keyForKid(kid) {
  let keys = await getJwks(false);
  let jwk = keys.find(k => k.kid === kid);
  if (!jwk) { keys = await getJwks(true); jwk = keys.find(k => k.kid === kid); } // rotação de chave
  if (!jwk) return null;
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

// ── verifica um id token do Entra (assinatura + claims) ──────
async function verifyIdToken(token) {
  if (!token || typeof token !== 'string') throw authErr('missing token');
  const parts = token.split('.');
  if (parts.length !== 3) throw authErr('malformed token');
  let header, payload;
  try { header = decodeSeg(parts[0]); payload = decodeSeg(parts[1]); }
  catch (e) { throw authErr('undecodable token'); }
  if (header.alg !== 'RS256') throw authErr('unexpected alg');
  const key = await keyForKid(header.kid);
  if (!key) throw authErr('unknown signing key');
  const ok = crypto.createVerify('RSA-SHA256').update(parts[0] + '.' + parts[1]).verify(key, b64urlToBuf(parts[2]));
  if (!ok) throw authErr('bad signature');

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > Number(payload.exp) + SKEW) throw authErr('expired');
  if (payload.nbf && now < Number(payload.nbf) - SKEW) throw authErr('not yet valid');
  if (String(payload.aud) !== CLIENT) throw authErr('aud mismatch');
  if (payload.tid && String(payload.tid) !== TENANT) throw authErr('tid mismatch');
  const iss = String(payload.iss || '');
  if (iss.indexOf('login.microsoftonline.com/' + TENANT) < 0 && iss.indexOf('sts.windows.net/' + TENANT) < 0) {
    throw authErr('iss mismatch');
  }
  const email = String(payload.preferred_username || payload.upn || payload.email || '').toLowerCase();
  return { oid: String(payload.oid || payload.sub || ''), email: email, name: payload.name || '' };
}

function tokenFromReq(req) {
  const h = (req && req.headers) || {};
  const auth = h.authorization || h.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return String(h['x-portal-idtoken'] || (m ? m[1] : '') || '');
}

// requireUser: identidade validada. Com AUTH_ENFORCE on, lança 401 se inválida.
// Com enforce off (janela de rollout), cai no legado (headers) sem bloquear.
async function requireUser(req) {
  const token = tokenFromReq(req);
  try {
    const user = await verifyIdToken(token);
    if (user.email && !dominioPermitido(user.email)) throw authErr('domain');
    return { user: user, validated: true, enforced: ENFORCE };
  } catch (e) {
    if (ENFORCE) throw e;
    // Fallback legado (janela de rollout): mesmas fontes que os endpoints
    // aceitavam antes (header X-User-Email/x-portal-*, body.userEmail e query
    // ?userEmail=) — para NÃO quebrar chamadores atuais (ex.: agente de voz).
    const h = (req && req.headers) || {};
    const q = (req && req.query) || {};
    const email = String(h['x-portal-email'] || h['x-user-email'] || (req.body && req.body.userEmail) || q.userEmail || '').toLowerCase();
    const oid = String(h['x-portal-oid'] || '');
    return { user: { oid: oid, email: email, name: '' }, validated: false, enforced: false };
  }
}

// ── autorização por área (grupo AAD → áreas), app-only ───────
let _appTok = { t: null, exp: 0 };
// novo = ignora o guardado (permissão recém-concedida só entra num token novo)
async function getAppToken(novo) {
  if (!AAD_SECRET) return null;
  const now = Date.now();
  if (!novo && _appTok.t && now < _appTok.exp - 60000) return _appTok.t;
  const url = 'https://login.microsoftonline.com/' + TENANT + '/oauth2/v2.0/token';
  const body = new URLSearchParams({
    grant_type: 'client_credentials', client_id: CLIENT, client_secret: AAD_SECRET,
    scope: 'https://graph.microsoft.com/.default'
  });
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error('app token ' + r.status);
  const j = await r.json();
  _appTok = { t: j.access_token, exp: now + (j.expires_in ? j.expires_in * 1000 : 3300000) };
  return _appTok.t;
}

async function listGroups(oid) {
  if (!GUID.test(String(oid || ''))) return null; // nunca concatena não-GUID na URL do Graph
  const tok = await getAppToken();
  if (!tok) return null;
  const url = 'https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(oid) +
    '/transitiveMemberOf/microsoft.graph.group?$select=id,displayName&$top=999';
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok } });
  if (!r.ok) return null;
  return (((await r.json()).value) || []).map(g => ({ id: g.id, name: g.displayName }));
}

// Tem acesso full? Para quem NÃO passou por authorizedAreas — o requireArea e
// os módulos que decidem permissão dentro da tela. Graph fora do ar responde
// FALSE (fail-closed): aqui a resposta abre porta, não fecha.
async function temAcessoFull(user) {
  const email = String((user && user.email) || '').trim().toLowerCase();
  if (email && ADMIN_EMAILS.indexOf(email) >= 0) return true;
  const groups = await listGroups(user && user.oid).catch(() => null);
  if (!groups) return false;
  return groups.some(g => UNRESTRICTED_GROUPS.has(g.id) || UNRESTRICTED_GROUPS.has(g.name));
}

async function authorizedAreas(user) {
  const email = ((user && user.email) || '').toLowerCase();
  // TODA saída desta função passa por podarReservadas(): área reservada não
  // escapa por admin, por grupo sem restrição nem pelos dois fail-open.
  if (email && ADMIN_EMAILS.indexOf(email) >= 0) return todasMenosReservadas(email, 'admin');
  const groups = await listGroups(user && user.oid);
  if (!groups) return todasMenosReservadas(email, 'groups_unavailable');
  const allowed = new Set();
  const modulos = new Set();
  let matched = false, unrestricted = false;
  groups.forEach(g => {
    if (UNRESTRICTED_GROUPS.has(g.id) || UNRESTRICTED_GROUPS.has(g.name)) { unrestricted = true; return; }
    const areas = GRUPO_AREAS[g.id] || GRUPO_AREAS[g.name];
    if (areas) { matched = true; areas.forEach(a => allowed.add(a)); }
    // módulo avulso TAMBÉM é regra: quem cai aqui deixa de ser "sem
    // mapeamento" e não volta a cair no fail-open de no_group_match.
    const mods = GRUPO_MODULOS[g.id] || GRUPO_MODULOS[g.name];
    if (mods) { matched = true; mods.forEach(m => modulos.add(String(m).toLowerCase())); }
  });
  if (unrestricted) return todasMenosReservadas(email, 'unrestricted_group');
  if (!matched) return todasMenosReservadas(email, 'no_group_match');
  (EMAIL_AREAS[email] || []).forEach(a => allowed.add(a));
  AREAS_ABERTAS.forEach(a => allowed.add(a));   // hoje vazio (ver AREAS_ABERTAS)
  return {
    areas: podarReservadas(ALL_AREAS.filter(a => allowed.has(a)), email),
    // módulo de área já liberada é redundante — sai do payload; módulo de
    // área RESERVADA também sai (senão a página avulsa abriria a porta)
    modulos: Array.from(modulos)
      // só módulo de área DESTE portal (areaDoModulo devolve null para as
      // páginas das outras áreas, que não existem aqui)
      .filter(m => areaDoModulo(m) !== null)
      .filter(m => !allowed.has(areaDoModulo(m)))
      .filter(m => areaLiberada(areaDoModulo(m), email)),
    restricted: true,
    reason: 'group_rule'
  };
}

// requireArea: exige usuário + (quando enforce) que ele tenha a área.
// `area` aceita string OU array (any-of): passa se o usuário tiver QUALQUER
// uma das áreas — necessário para endpoints multi-área (ex.: pbi-query,
// pedido/consig servem comercial E estoque). Sob AUTH_ENFORCE off não bloqueia.
async function requireArea(req, area) {
  const base = await requireUser(req);
  const need = Array.isArray(area) ? area : (area ? [area] : []);

  // ÁREA RESERVADA não espera o AUTH_ENFORCE: fecha agora, e fecha
  // fail-closed. Com enforce off a identidade legada vem de HEADER (qualquer
  // um forja o e-mail do dono), então aqui só passa token VALIDADO com
  // e-mail na lista. Endpoint multi-área continua valendo pelo "any-of":
  // basta UMA área liberada — a reservada é que não conta sem a lista.
  const reservadas = need.filter(a => !!AREAS_RESERVADAS[String(a || '').toLowerCase()]);
  if (reservadas.length) {
    const email = ((base.user && base.user.email) || '').toLowerCase();
    let liberado = base.validated && reservadas.some(a => areaLiberada(a, email));
    // quem tem ACESSO FULL também entra (regra de 03/09/2026), menos nas de
    // RESERVA_ESTRITA. Continua exigindo token VALIDADO: com o enforce off a
    // identidade vem de header, e aí qualquer um forjaria o e-mail — o grupo
    // é lido do oid do token.
    const abreComFull = reservadas.some(a => RESERVA_ESTRITA.indexOf(String(a || '').toLowerCase()) < 0);
    if (!liberado && base.validated && abreComFull) liberado = await temAcessoFull(base.user);
    const outras = need.filter(a => reservadas.indexOf(a) < 0);
    if (!liberado && !outras.length) { const e = new Error('forbidden'); e.status = 403; throw e; }
  }

  if (!base.enforced) return Object.assign({ areas: null }, base); // rollout: não bloqueia
  const az = await authorizedAreas(base.user);
  if (need.length && !need.some(a => az.areas.indexOf(a) >= 0)) {
    const e = new Error('forbidden'); e.status = 403; throw e;
  }
  return Object.assign({ areas: az.areas }, base);
}

// ── Auth do BACKEND -> Fluxo do Power Automate (Passo 1 / Opcao B) ──────────
// Quando FLOW_AUTH=true, o backend acompanha as chamadas aos fluxos com um
// token do Azure AD (client credentials). Isso permite tirar o gatilho do
// "Anyone" e matar o risco do sig vazado. Enquanto FLOW_AUTH != true, NAO
// manda token e o comportamento e o de hoje (fluxo em "Anyone" aceita).
// O scope/audience e configuravel (a config exata do gatilho varia por tenant).
const FLOW_SCOPE  = process.env.FLOW_AUTH_SCOPE || 'https://service.flow.microsoft.com/.default';
const FLOW_CLIENT = process.env.FLOW_CLIENT_ID || CLIENT;
const FLOW_SECRET = process.env.FLOW_CLIENT_SECRET || AAD_SECRET;

let _flowTok = { t: null, exp: 0 };
async function getFlowToken() {
  if (!FLOW_SECRET) return null;
  const now = Date.now();
  if (_flowTok.t && now < _flowTok.exp - 60000) return _flowTok.t;
  const url = 'https://login.microsoftonline.com/' + TENANT + '/oauth2/v2.0/token';
  const body = new URLSearchParams({
    grant_type: 'client_credentials', client_id: FLOW_CLIENT, client_secret: FLOW_SECRET, scope: FLOW_SCOPE
  });
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error('flow token ' + r.status);
  const j = await r.json();
  _flowTok = { t: j.access_token, exp: now + (j.expires_in ? j.expires_in * 1000 : 3300000) };
  return _flowTok.t;
}

// Header de auth p/ chamar o fluxo, habilitado POR FLUXO via FLOW_AUTH_<KEY>=true
// (ex.: FLOW_AUTH_NEGOCIACAO). IMPORTANTE: um fluxo em "Anyone" REJEITA o header
// com 401 — então só ligue o flag do fluxo que JÁ foi trocado para
// "Any user in my tenant". {} quando desligado ou se o token falhar (nunca
// impede a chamada; assim os outros fluxos, ainda em "Anyone", seguem normais).
async function flowAuthHeader(flowKey) {
  const on = String(process.env['FLOW_AUTH_' + String(flowKey || '').toUpperCase()] || '').toLowerCase() === 'true';
  if (!on) return {};
  try { const t = await getFlowToken(); return t ? { Authorization: 'Bearer ' + t } : {}; }
  catch (e) { return {}; }
}

module.exports = {
  ENFORCE, ALLOWED_DOMAIN, ALLOWED_DOMAINS, dominioPermitido, ALL_AREAS, AREAS_RESERVADAS, RESERVA_ESTRITA,
  verifyIdToken, requireUser, requireArea, authorizedAreas, isAdmin, areaLiberada, temAcessoFull,
  getAppToken, listGroups, flowAuthHeader, isGuid: (s) => GUID.test(String(s || '')), gruposSoDaArea,
};
