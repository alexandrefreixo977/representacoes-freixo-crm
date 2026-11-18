// Cérebro do assistente de voz do Freixo CRM.
// Recebe o que foi dito, consulta o CRM com a sessão do próprio utilizador (as regras de acesso do Supabase aplicam-se)
// e devolve uma resposta falada + ações preparadas, que só são gravadas depois de o utilizador confirmar.
import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_TIMEZONE, scheduleInstant, validTimezone } from "../../notification-time";
import {
  ECRAS, RESULTADOS, TIPOS_AGENDA, TIPOS_INTERACAO, calendario, construirAcao, diaDaSemana, partesNoFuso, procurarClientes, somarDias, validarData,
  type AcaoVoz, type ClienteVoz, type ContactoVoz, type ContextoVoz, type MarcaVoz, type PerfilVoz,
} from "../../voice-core";

const DEFAULT_MODEL = "claude-opus-5-5";
const MAX_PASSOS = 8;

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function env(name: string): string {
  const value = (process.env as Record<string, string | undefined>)[name];
  if (!value) throw new Error(`Configuração em falta no servidor: ${name}`);
  return value;
}

// ---------- Dados do CRM (cache curta por utilizador, para respostas rápidas) ----------

type Dados = { clientes: ClienteVoz[]; contactos: ContactoVoz[]; marcas: MarcaVoz[]; perfis: PerfilVoz[]; nomeUtilizador: string };
const cache = new Map<string, { quando: number; dados: Dados }>();
const CACHE_MS = 3 * 60_000;

async function todas<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; de < 20000; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function carregarDados(db: SupabaseClient, userId: string): Promise<Dados> {
  const c = cache.get(userId);
  if (c && Date.now() - c.quando < CACHE_MS) return c.dados;
  const [clientes, contactos, marcas, perfis] = await Promise.all([
    todas<any>((de, ate) => db.from("clients").select("id,code,trade_name,legal_name,city").order("trade_name").range(de, ate)),
    todas<any>((de, ate) => db.from("client_contacts").select("id,client_id,first_name,last_name,job_title,active").range(de, ate)).catch(() => []),
    todas<any>((de, ate) => db.from("manufacturers").select("id,name,deleted_at").order("name").range(de, ate)).catch(() => []),
    todas<any>((de, ate) => db.from("profiles").select("id,full_name,email,active").range(de, ate)).catch(() => []),
  ]);
  const dados: Dados = {
    clientes: clientes.map((x) => ({ id: x.id, codigo: x.code ?? "", nome: x.trade_name ?? "", nomeLegal: x.legal_name, cidade: x.city })),
    contactos: contactos.filter((x) => x.active !== false).map((x) => ({ id: x.id, clienteId: x.client_id, nome: [x.first_name, x.last_name].filter(Boolean).join(" "), cargo: x.job_title })),
    marcas: marcas.filter((x) => !x.deleted_at).map((x) => ({ id: x.id, nome: x.name })),
    perfis: perfis.filter((x) => x.active !== false).map((x) => ({ id: x.id, nome: x.full_name ?? x.email ?? "", email: x.email })),
    nomeUtilizador: perfis.find((x) => x.id === userId)?.full_name ?? "",
  };
  cache.set(userId, { quando: Date.now(), dados });
  return dados;
}

// ---------- Ferramentas ----------

const P = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });
const CLIENTE = {
  cliente_codigo: P("Código EXATO do cliente (ex.: CLI0168), tirado da lista de clientes ou de procurar_cliente."),
  cliente_nome: P("Nome do cliente tal como foi dito (ajuda a validar)."),
};
const HORA = P("Hora HH:MM (24h), só se foi dita. 'às 3'/'às 3 da tarde' → 15:00; 'às 9' → 09:00; 'meio-dia' → 12:00; 'fim do dia' → 18:00; 'de manhã' sem hora → omite.");
const EXTRAS = {
  marca: P("Marca/fabricante mencionado (nome da lista de marcas), se houver."),
  contacto: P("Pessoa de contacto do cliente mencionada, se houver."),
  responsavel: P("Utilizador responsável, se for outra pessoa que não quem fala (ex.: 'Tina'). Omite para o próprio."),
  notas: P("Detalhes adicionais ditos, se houver."),
};

const ferramentas: Anthropic.Beta.BetaTool[] = [
  {
    name: "procurar_cliente",
    description: "Procura clientes por nome aproximado, nome legal, código, cidade ou nome de uma pessoa de contacto. Tolera erros do ditado. Usa quando o nome dito não corresponde claramente a um cliente da lista.",
    input_schema: { type: "object", properties: { texto: P("O nome tal como foi ouvido.") }, required: ["texto"] },
  },
  {
    name: "consultar_agenda",
    description: "Lista visitas, tarefas, chamadas e reuniões agendadas num intervalo de datas (inclui o id de cada uma, necessário para concluir/reagendar/cancelar). Para 'atrasadas' usa de=2020-01-01 e ate=ontem.",
    input_schema: {
      type: "object",
      properties: {
        de: P("Data inicial AAAA-MM-DD."), ate: P("Data final AAAA-MM-DD (inclusive)."),
        tipo: P("tarefas | visitas | todas", { enum: ["tarefas", "visitas", "todas"] }),
        cliente_codigo: P("Filtra por cliente (opcional)."),
        de_quem: P("eu (omissão) | todos | nome de um utilizador."),
        incluir_concluidas: { type: "boolean", description: "true para incluir concluídas/canceladas." },
      },
      required: ["de", "ate"],
    },
  },
  {
    name: "consultar_cliente",
    description: "Ficha resumida de um cliente: contactos, telefone, email, morada, marcas associadas, últimas interações e próximas atividades.",
    input_schema: { type: "object", properties: { ...CLIENTE }, required: ["cliente_codigo"] },
  },
  {
    name: "consultar_oportunidades",
    description: "Lista oportunidades/propostas em aberto (opcionalmente de um cliente), com fase, valor e data prevista.",
    input_schema: { type: "object", properties: { cliente_codigo: P("Opcional.") } },
  },
  {
    name: "agendar_atividade",
    description: "Prepara o agendamento de uma atividade FUTURA na agenda: visita, reunião, chamada a fazer, apresentação, envio de proposta, follow-up ou lembrete.",
    input_schema: {
      type: "object",
      properties: {
        ...CLIENTE,
        tipo: P(`Um de: ${TIPOS_AGENDA.join(", ")}.`, { enum: [...TIPOS_AGENDA] }),
        data: P("AAAA-MM-DD, do calendário."), hora: HORA,
        assunto: P("Objetivo/assunto tal como foi dito (ex.: 'apresentar a nova coleção Cofra')."),
        lembrete_minutos: { type: "number", description: "Minutos de antecedência do lembrete, só se pedido ('avisa-me 1 hora antes' → 60)." },
        ...EXTRAS,
      },
      required: ["cliente_codigo", "tipo", "data", "assunto"],
    },
  },
  {
    name: "criar_tarefa",
    description: "Prepara uma tarefa com prazo associada a um cliente (algo a fazer: enviar proposta, ligar, preparar amostras, lembrete…).",
    input_schema: {
      type: "object",
      properties: {
        ...CLIENTE,
        titulo: P("O que há a fazer, curto e claro, com a primeira letra maiúscula (ex.: 'Enviar proposta de luvas JSP')."),
        data: P("Prazo AAAA-MM-DD. Se não foi dito, hoje."), hora: HORA,
        lembrete_minutos: { type: "number", description: "Só se pedido." },
        ...EXTRAS,
      },
      required: ["cliente_codigo", "titulo", "data"],
    },
  },
  {
    name: "registar_interacao",
    description: "Regista no histórico do cliente algo que JÁ ACONTECEU: chamada feita, visita realizada, reunião, WhatsApp, proposta/orçamento enviado, reclamação, encomenda, nota interna… Pode criar logo a tarefa de seguimento.",
    input_schema: {
      type: "object",
      properties: {
        ...CLIENTE,
        tipo: P(`Um de: ${TIPOS_INTERACAO.join(", ")}.`, { enum: [...TIPOS_INTERACAO] }),
        assunto: P("Resumo curto do que aconteceu."),
        resultado: P(`Se percetível: ${RESULTADOS.join(", ")}.`, { enum: [...RESULTADOS] }),
        data: P("AAAA-MM-DD; omite se foi hoje."), hora: P("HH:MM, só se dita."),
        proxima_acao: P("Próximo passo combinado, se houver (ex.: 'Enviar tabela de preços')."),
        proxima_acao_data: P("AAAA-MM-DD do próximo passo; com proxima_acao cria uma tarefa."),
        ...EXTRAS,
      },
      required: ["cliente_codigo", "tipo", "assunto"],
    },
  },
  {
    name: "concluir_atividade",
    description: "Prepara marcar uma tarefa/visita como concluída. Precisa do id real, obtido com consultar_agenda.",
    input_schema: { type: "object", properties: { atividade_id: P("id da atividade."), notas: P("Resultado/nota, se dito.") }, required: ["atividade_id"] },
  },
  {
    name: "reagendar_atividade",
    description: "Prepara mudar a data (e/ou hora) de uma atividade existente. Precisa do id real, obtido com consultar_agenda. Sem hora nova, mantém a hora que tinha.",
    input_schema: { type: "object", properties: { atividade_id: P("id da atividade."), data: P("Nova data AAAA-MM-DD."), hora: HORA }, required: ["atividade_id", "data"] },
  },
  {
    name: "cancelar_atividade",
    description: "Prepara cancelar uma atividade agendada. Precisa do id real, obtido com consultar_agenda.",
    input_schema: { type: "object", properties: { atividade_id: P("id da atividade.") }, required: ["atividade_id"] },
  },
  {
    name: "abrir_ecra",
    description: "Abre um ecrã do CRM ou a ficha de um cliente ('abre a ficha do X', 'mostra a agenda', 'vai às tarefas'). Executa logo, sem confirmação.",
    input_schema: { type: "object", properties: { ecra: P(`Um de: ${Object.keys(ECRAS).join(", ")}.`, { enum: Object.keys(ECRAS) }), ...CLIENTE } },
  },
];
const ACOES = new Set(["agendar_atividade", "criar_tarefa", "registar_interacao", "concluir_atividade", "reagendar_atividade", "cancelar_atividade", "abrir_ecra"]);

function promptFixo(d: Dados): string {
  const clientes = d.clientes.map((c) => `${c.codigo} | ${c.nome}${c.cidade ? ` | ${c.cidade}` : ""}`).join("\n");
  const marcas = d.marcas.map((m) => m.nome).join(", ");
  const perfis = d.perfis.map((p) => p.nome).join(", ");
  return `És o assistente de voz do CRM da Representações Freixo (Viana do Castelo): representação e distribuição B2B de EPI, abrasivos, ferramentas e consumíveis industriais. Quem fala é um comercial da empresa, normalmente ao volante ou entre visitas. Falas português de Portugal, de forma breve, natural e direta (as respostas são lidas em voz alta: frases curtas, sem listas compridas, sem markdown, sem emojis, sem códigos CLI nem ids).

O TEXTO VEM DE DITADO AUTOMÁTICO e tem erros: nomes próprios e marcas mal ouvidos ("cofre" = Cofra, "jota esse pê"/"j s p" = JSP, "júnior"/"único" = Unior, "rontgen"/"rongen" = Röntgen, "blue máster" = Blue Master, "agaça"/"agasa" = Aghasa Turis, "jomiba"/"jo mi ba" = Jomiba, "acha"/"achá" = ACHA), números por extenso, palavras coladas ou separadas, pontuação ausente. Interpreta pela intenção e pelo som, não pela grafia. Se o ditado der alternativas, considera-as.

COMO AGIR
- Percebe o pedido completo: pode haver várias ações numa só frase ("liguei ao X, ficou de encomendar, marca-me visita para dia 25") → prepara TODAS.
- Clientes: escolhe da lista abaixo pelo som/significado (nome incompleto, abreviado, sem "Lda", com a cidade, ou pelo nome de um contacto). Se houver dúvida real, usa procurar_cliente. Só perguntas se continuarem dois ou mais igualmente prováveis — nesse caso diz os nomes e as cidades para o utilizador escolher. Nunca inventes clientes nem códigos.
- Datas: usa SEMPRE o calendário dado na mensagem (não faças contas de cabeça). "sexta" = a próxima sexta (se hoje é sexta, é hoje só se disser "hoje"/"esta sexta"); "para a semana"/"na próxima semana" sem dia = segunda da próxima semana; "sexta da próxima semana"/"sexta que vem" = sexta da semana seguinte; "daqui a N dias/semanas" conta a partir de hoje; "dia 25" = próximo dia 25; "fim do mês" = último dia útil do mês; "início do mês" = primeiro dia útil.
- Horas: horário de trabalho. "às 1…6" sem "manhã" = tarde (13:00–18:00); "às 7…12" = manhã; "e meia" = :30; "e um quarto" = :15; "menos um quarto" = :45.
- Passado vs futuro: o que já aconteceu ("liguei", "estive", "visitei", "enviei", "ele disse") → registar_interacao. O que vai acontecer ("marca", "agenda", "tenho de", "lembra-me", "amanhã vou") → agendar_atividade ou criar_tarefa ("lembra-me de…"/"tenho de…" → criar_tarefa).
- Concluir, reagendar ou cancelar algo existente: usa consultar_agenda para encontrar o id e depois a ação. Se houver várias que encaixam, pergunta qual.
- Perguntas ("o que tenho amanhã?", "quando visitei o X?", "qual é o telefone do Y?", "que tarefas estão atrasadas?") → consulta e responde em 1 a 3 frases.
- Todas as ações de gravar ficam PREPARADAS e o utilizador confirma no ecrã ou dizendo "confirma". Por isso age com decisão: não peças confirmação de detalhes, não perguntes o que é um produto, regista os assuntos tal como foram ditos (corrige só nomes de marcas/clientes e a gramática).
- Se uma ferramenta devolver erro, corrige e tenta de novo; se for impossível, explica numa frase o que falta.
- No fim responde com uma frase curta: o que preparaste (ex.: "Preparei a visita à Ferragens Lima na sexta às 10h. Confirma?") ou a resposta à pergunta. Se só abriste um ecrã, diz apenas "Feito."

UTILIZADORES: ${perfis || "(sem lista)"}
MARCAS/FABRICANTES: ${marcas || "(sem lista)"}

CLIENTES (código | nome | cidade):
${clientes}`;
}

// ---------- Execução das consultas ----------

type Ctx = { db: SupabaseClient; dados: Dados; userId: string; tz: string; hoje: string; conhecidas: NonNullable<ContextoVoz["atividadesConhecidas"]>; memoria: string[] };

const horaLocal = (iso: string, tz: string) => partesNoFuso(new Date(iso), tz).hora;
const diaLocal = (iso: string, tz: string) => partesNoFuso(new Date(iso), tz).data;
const ESTADOS: Record<string, string> = { scheduled: "agendada", in_progress: "em curso", completed: "concluída", cancelled: "cancelada", rescheduled: "reagendada", open: "aberta", sent: "enviado" };

function clientePorCodigo(ctx: Ctx, codigo: unknown): ClienteVoz | null {
  const c = String(codigo ?? "").trim().toLowerCase();
  return ctx.dados.clientes.find((x) => x.codigo.toLowerCase() === c) ?? null;
}

async function consultarAgenda(ctx: Ctx, i: Record<string, any>): Promise<string> {
  const de = validarData(i.de) ?? ctx.hoje;
  const ate = validarData(i.ate) ?? de;
  const inicio = scheduleInstant(de, "00:00", ctx.tz);
  const fim = scheduleInstant(somarDias(ate, 1), "00:00", ctx.tz);
  let q = ctx.db.from("activities")
    .select("id,title,summary,kind,interaction_type,status,start_at,due_date,has_time,assigned_to,clients(code,trade_name)")
    .or(`and(has_time.eq.false,due_date.gte.${de},due_date.lte.${ate}),and(has_time.eq.true,start_at.gte.${inicio},start_at.lt.${fim})`)
    .order("start_at", { ascending: true, nullsFirst: false }).limit(80);
  const tipo = String(i.tipo ?? "todas");
  q = tipo === "tarefas" ? q.eq("kind", "task") : tipo === "visitas" ? q.eq("kind", "visit") : q.in("kind", ["task", "visit", "call", "meeting", "note", "proposal"]);
  if (!i.incluir_concluidas) q = q.not("status", "in", "(completed,cancelled)");
  const cliente = i.cliente_codigo ? clientePorCodigo(ctx, i.cliente_codigo) : null;
  if (i.cliente_codigo && !cliente) return "Cliente não encontrado: use o código exato.";
  if (cliente) q = q.eq("client_id", cliente.id);
  const quem = String(i.de_quem ?? "eu").trim();
  if (!quem || /^(eu|minha|minhas|meu|meus)$/i.test(quem)) q = q.eq("assigned_to", ctx.userId);
  else if (!/^tod/i.test(quem)) {
    const p = ctx.dados.perfis.find((x) => x.nome.toLowerCase().includes(quem.toLowerCase()));
    if (p) q = q.eq("assigned_to", p.id);
  }
  const { data, error } = await q;
  if (error) return `Erro ao ler a agenda: ${error.message}`;
  if (!data?.length) return `Sem atividades entre ${de} e ${ate}.`;
  const linhas = data.map((a: any) => {
    const temHora = a.has_time !== false && !!a.start_at;
    const dia = temHora ? diaLocal(a.start_at, ctx.tz) : a.due_date;
    const hora = temHora ? horaLocal(a.start_at, ctx.tz) : null;
    const titulo = a.title || a.summary || a.interaction_type;
    ctx.conhecidas.set(a.id, { titulo: `${titulo}${a.clients?.trade_name ? ` — ${a.clients.trade_name}` : ""}`, temHora, hora });
    const resp = a.assigned_to !== ctx.userId ? ` · resp.: ${ctx.dados.perfis.find((p) => p.id === a.assigned_to)?.nome ?? "outro"}` : "";
    return `id=${a.id} | ${dia} ${diaDaSemana(dia ?? ctx.hoje)}${hora ? ` ${hora}` : " (sem hora)"} | ${a.interaction_type ?? a.kind} | ${titulo} | ${a.clients?.trade_name ?? "—"} | ${ESTADOS[a.status] ?? a.status}${resp}`;
  });
  ctx.memoria.push(...linhas.slice(0, 30));
  return `${data.length} atividade(s):\n${linhas.join("\n")}`;
}

async function consultarCliente(ctx: Ctx, i: Record<string, any>): Promise<string> {
  const c = clientePorCodigo(ctx, i.cliente_codigo);
  if (!c) {
    const cands = procurarClientes(String(i.cliente_nome ?? i.cliente_codigo ?? ""), ctx.dados.clientes, ctx.dados.contactos, 4);
    return `Cliente não encontrado pelo código. Candidatos: ${cands.map((x) => `${x.cliente.codigo} ${x.cliente.nome}`).join("; ") || "nenhum"}.`;
  }
  const agoraIso = new Date().toISOString();
  const [ficha, historico, proximas, marcas] = await Promise.all([
    ctx.db.from("clients").select("*").eq("id", c.id).maybeSingle(),
    ctx.db.from("activities").select("interaction_type,title,subject,result,occurred_at,next_action,next_action_date").eq("client_id", c.id).neq("kind", "task").lte("occurred_at", agoraIso).order("occurred_at", { ascending: false }).limit(5),
    ctx.db.from("activities").select("id,interaction_type,title,start_at,due_date,has_time,status").eq("client_id", c.id).not("status", "in", "(completed,cancelled)").or(`start_at.gte.${agoraIso},due_date.gte.${ctx.hoje}`).order("start_at", { ascending: true, nullsFirst: false }).limit(5),
    ctx.db.from("client_manufacturers").select("discount_status,manufacturers(name)").eq("client_id", c.id),
  ]);
  const f: any = ficha.data ?? {};
  const contactos = ctx.dados.contactos.filter((x) => x.clienteId === c.id).map((x) => `${x.nome}${x.cargo ? ` (${x.cargo})` : ""}`);
  const linhas = [
    `${f.trade_name ?? c.nome} (${c.codigo})${f.legal_name ? ` — ${f.legal_name}` : ""}`,
    [f.address, f.postal_code, f.city ?? c.cidade].filter(Boolean).join(", "),
    f.phone ? `Telefone: ${f.phone}` : "", f.email ? `Email: ${f.email}` : "",
    f.status ? `Estado: ${f.status}` : "", f.visit_frequency ? `Frequência de visita: ${f.visit_frequency}` : "",
    f.next_action ? `Próxima ação na ficha: ${f.next_action}${f.next_action_date ? ` (${f.next_action_date})` : ""}` : "",
    contactos.length ? `Contactos: ${contactos.join(", ")}` : "Sem contactos registados.",
    (marcas.data ?? []).length ? `Marcas associadas: ${(marcas.data ?? []).map((m: any) => m.manufacturers?.name).filter(Boolean).join(", ")}` : "",
    (historico.data ?? []).length ? `Últimas interações:\n${(historico.data ?? []).map((h: any) => `- ${diaLocal(h.occurred_at, ctx.tz)} ${h.interaction_type}: ${h.subject || h.title || ""}${h.result ? ` (${h.result})` : ""}${h.next_action ? ` → ${h.next_action}${h.next_action_date ? ` até ${h.next_action_date}` : ""}` : ""}`).join("\n")}` : "Sem interações registadas.",
    (proximas.data ?? []).length ? `Próximas atividades:\n${(proximas.data ?? []).map((a: any) => {
      const temHora = a.has_time !== false && !!a.start_at;
      ctx.conhecidas.set(a.id, { titulo: `${a.title ?? a.interaction_type} — ${c.nome}`, temHora, hora: temHora ? horaLocal(a.start_at, ctx.tz) : null });
      return `- id=${a.id} | ${temHora ? `${diaLocal(a.start_at, ctx.tz)} ${horaLocal(a.start_at, ctx.tz)}` : a.due_date} | ${a.interaction_type}: ${a.title ?? ""}`;
    }).join("\n")}` : "Sem atividades futuras.",
  ].filter(Boolean);
  return linhas.join("\n");
}

async function consultarOportunidades(ctx: Ctx, i: Record<string, any>): Promise<string> {
  let q = ctx.db.from("opportunities").select("title,estimated_value,expected_close,next_action,updated_at,opportunity_stages(name,terminal),clients(code,trade_name)").order("updated_at", { ascending: false }).limit(40);
  if (i.cliente_codigo) {
    const c = clientePorCodigo(ctx, i.cliente_codigo);
    if (!c) return "Cliente não encontrado: use o código exato.";
    q = q.eq("client_id", c.id);
  }
  const { data, error } = await q;
  if (error) return `Erro ao ler oportunidades: ${error.message}`;
  const abertas = (data ?? []).filter((o: any) => !o.opportunity_stages?.terminal);
  if (!abertas.length) return "Sem oportunidades em aberto.";
  return abertas.map((o: any) => `${o.clients?.trade_name ?? "—"} | ${o.title} | ${o.opportunity_stages?.name ?? ""} | ${Number(o.estimated_value ?? 0).toLocaleString("pt-PT")} € | fecho previsto ${o.expected_close ?? "—"}${o.next_action ? ` | próxima ação: ${o.next_action}` : ""}`).join("\n");
}

async function garantirConhecida(ctx: Ctx, id: string) {
  if (!id || ctx.conhecidas.has(id)) return;
  const { data } = await ctx.db.from("activities").select("id,title,interaction_type,start_at,has_time,clients(trade_name)").eq("id", id).maybeSingle();
  if (!data) return;
  const a: any = data;
  const temHora = a.has_time !== false && !!a.start_at;
  ctx.conhecidas.set(a.id, { titulo: `${a.title ?? a.interaction_type}${a.clients?.trade_name ? ` — ${a.clients.trade_name}` : ""}`, temHora, hora: temHora ? horaLocal(a.start_at, ctx.tz) : null });
}

// ---------- Pedido ----------

type Corpo = { comando?: string; alternativas?: string[]; historico?: Array<{ papel: "utilizador" | "assistente"; texto: string }>; timezone?: string };

export async function POST(request: Request): Promise<Response> {
  try {
    const jwt = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json(401, { error: "Sessão inválida. Volte a iniciar sessão." });
    const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: u, error: authError } = await db.auth.getUser(jwt);
    if (authError || !u.user) return json(401, { error: "Sessão inválida. Volte a iniciar sessão." });
    const userId = u.user.id;

    const body = (await request.json()) as Corpo;
    const comando = String(body.comando ?? "").trim().slice(0, 2000);
    if (!comando) return json(400, { error: "Comando vazio." });
    const tz = body.timezone && validTimezone(body.timezone) ? body.timezone : DEFAULT_TIMEZONE;
    const agora = new Date();
    const { data: hoje, hora: horaAgora } = partesNoFuso(agora, tz);

    const dados = await carregarDados(db, userId);
    const ctx: Ctx = { db, dados, userId, tz, hoje, conhecidas: new Map(), memoria: [] };
    const ctxAcoes: ContextoVoz = {
      userId, timezone: tz, hoje, agoraISO: agora.toISOString(), clientes: dados.clientes, contactos: dados.contactos, marcas: dados.marcas, perfis: dados.perfis,
      instante: (d, h) => scheduleInstant(d, h, tz), atividadesConhecidas: ctx.conhecidas,
    };

    // Conversa anterior (texto simples) para perceber respostas a perguntas de esclarecimento.
    const mensagens: Anthropic.Beta.BetaMessageParam[] = [];
    for (const h of (body.historico ?? []).slice(-12)) {
      const role = h.papel === "assistente" ? "assistant" : "user";
      const texto = String(h.texto ?? "").slice(0, 4000);
      if (!texto) continue;
      if (!mensagens.length && role === "assistant") continue;
      const ultima = mensagens[mensagens.length - 1];
      if (ultima && ultima.role === role) ultima.content = `${ultima.content}\n${texto}`;
      else mensagens.push({ role, content: texto });
    }
    if (mensagens.length && mensagens[mensagens.length - 1].role === "user") mensagens.push({ role: "assistant", content: "(sem resposta)" });
    const alternativas = (body.alternativas ?? []).map((x) => String(x).trim()).filter((x) => x && x !== comando).slice(0, 3);
    mensagens.push({
      role: "user",
      content: `[Agora: ${diaDaSemana(hoje)}, ${hoje}, ${horaAgora} (${tz}). Quem fala: ${dados.nomeUtilizador || "utilizador"}.]\n[Calendário]\n${calendario(hoje)}\n\nDitado: "${comando}"${alternativas.length ? `\nO ditado também ouviu: ${alternativas.map((a) => `"${a}"`).join(" / ")}` : ""}`,
    });

    const client = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
    const model = (process.env.ANTHROPIC_MODEL as string) || DEFAULT_MODEL;
    const comFallback = /^claude-(opus-5-5|sonnet-5-5|fable-5)/.test(model);
    const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: promptFixo(dados), cache_control: { type: "ephemeral" } }];

    const acoes: Array<AcaoVoz & { id: string }> = [];
    let texto = "";
    for (let passo = 0; passo < MAX_PASSOS; passo++) {
      const resposta = await client.beta.messages.create({
        model, max_tokens: 4000, system, tools: ferramentas, messages: mensagens,
        output_config: { effort: "low" },
        ...(comFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      if (resposta.stop_reason === "refusal") { texto = "Não consegui tratar esse pedido. Pode dizê-lo de outra forma?"; break; }
      mensagens.push({ role: "assistant", content: resposta.content as Anthropic.Beta.BetaContentBlockParam[] });
      const usos = resposta.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      texto = resposta.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join(" ").trim() || texto;
      if (resposta.stop_reason !== "tool_use" || !usos.length) break;

      const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const uso of usos) {
        const input = (uso.input ?? {}) as Record<string, any>;
        let conteudo = "";
        let erro = false;
        try {
          if (uso.name === "procurar_cliente") {
            const cands = procurarClientes(String(input.texto ?? ""), dados.clientes, dados.contactos, 6);
            conteudo = cands.length ? cands.map((c) => `${c.cliente.codigo} | ${c.cliente.nome}${c.cliente.cidade ? ` | ${c.cliente.cidade}` : ""} | semelhança ${c.pontuacao} (${c.via})`).join("\n") : "Nenhum cliente parecido.";
          } else if (uso.name === "consultar_agenda") conteudo = await consultarAgenda(ctx, input);
          else if (uso.name === "consultar_cliente") conteudo = await consultarCliente(ctx, input);
          else if (uso.name === "consultar_oportunidades") conteudo = await consultarOportunidades(ctx, input);
          else if (ACOES.has(uso.name)) {
            if (input.atividade_id) await garantirConhecida(ctx, String(input.atividade_id));
            const r = construirAcao(uso.name, input, ctxAcoes);
            if (r.ok) {
              acoes.push({ ...r.acao, id: uso.id });
              conteudo = r.acao.tipo === "navegar" ? `Ecrã aberto: ${r.acao.resumo}` : `Preparado (aguarda confirmação do utilizador): ${r.acao.resumo}`;
            } else { conteudo = r.erro; erro = true; }
          } else { conteudo = `Ferramenta desconhecida: ${uso.name}`; erro = true; }
        } catch (e) {
          conteudo = e instanceof Error ? e.message : "Erro inesperado."; erro = true;
        }
        resultados.push({ type: "tool_result", tool_use_id: uso.id, content: conteudo, ...(erro ? { is_error: true } : {}) });
      }
      mensagens.push({ role: "user", content: resultados });
    }

    if (!texto) texto = acoes.length ? "Preparei o pedido. Confirma?" : "Não percebi. Pode repetir?";
    return json(200, { texto, acoes, memoria: ctx.memoria.length ? `Registos consultados:\n${ctx.memoria.join("\n")}` : "" });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return json(500, { error: "A chave da API do Claude no servidor é inválida." });
    if (error instanceof Anthropic.RateLimitError) return json(429, { error: "Muitos pedidos seguidos. Tente daqui a uns segundos." });
    if (error instanceof Anthropic.APIError) return json(502, { error: `O serviço de interpretação falhou (${error.status ?? "?"}). Tente de novo.` });
    return json(500, { error: error instanceof Error ? error.message : "Não foi possível interpretar o comando." });
  }
}
