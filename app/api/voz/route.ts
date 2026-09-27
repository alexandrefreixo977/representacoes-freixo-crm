// Cerebro da camada de voz (Fase 2) — Freixo CRM.
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function env(name: string): string {
  const value = (process.env as Record<string, string | undefined>)[name];
  if (!value) throw new Error(`Configuracao em falta no servidor: ${name}`);
  return value;
}

async function authenticated(jwt: string): Promise<boolean> {
  const res = await fetch(`${env("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: env("NEXT_PUBLIC_SUPABASE_ANON_KEY") },
  });
  return res.ok;
}

const clienteProps = {
  cliente_id: { type: "string", description: "O id EXATO do cliente, escolhido da lista fornecida." },
  cliente_nome: { type: "string", description: "O nome do cliente tal como aparece na lista." },
};
const horaProp = { hora: { type: "string", description: "Hora em formato HH:MM (24h), se o utilizador a indicar (ex.: 'às 8' -> 08:00). Se nao indicar, omite." } };

const tools = [
  {
    name: "registar_visita",
    description: "Regista uma visita comercial a um cliente (fica agendada). Usa quando o comando pede para registar, marcar ou agendar uma visita a um cliente identificavel na lista.",
    input_schema: {
      type: "object",
      properties: { ...clienteProps, data: { type: "string", description: "Data da visita em formato AAAA-MM-DD. Resolve 'hoje', 'amanha', dias da semana." }, ...horaProp, objetivo: { type: "string", description: "O objetivo ou assunto da visita, tal como foi dito." }, notas: { type: "string", description: "Notas adicionais, se existirem." } },
      required: ["cliente_id", "cliente_nome", "data", "objetivo"],
    },
  },
  {
    name: "criar_tarefa",
    description: "Cria uma tarefa (com prazo) associada a um cliente. Usa quando o comando pede para criar/adicionar uma tarefa, um lembrete, ou um follow-up com data.",
    input_schema: {
      type: "object",
      properties: { ...clienteProps, titulo: { type: "string", description: "O titulo/descricao curta da tarefa (o que ha a fazer)." }, data: { type: "string", description: "Prazo da tarefa em formato AAAA-MM-DD. Resolve datas relativas. Se nao for indicada, assume hoje." }, ...horaProp },
      required: ["cliente_id", "cliente_nome", "titulo", "data"],
    },
  },
  {
    name: "registar_chamada",
    description: "Regista uma chamada telefonica ou outra interacao JA OCORRIDA com um cliente, para o historico. Usa quando o comando relata um contacto ja feito.",
    input_schema: {
      type: "object",
      properties: { ...clienteProps, assunto: { type: "string", description: "O assunto da chamada/interacao (resumo curto)." }, notas: { type: "string", description: "Detalhes ou resultado da conversa, se existirem." }, data: { type: "string", description: "Data da chamada em AAAA-MM-DD. Se nao indicada, assume hoje." } },
      required: ["cliente_id", "cliente_nome", "assunto"],
    },
  },
];

function resumoDe(nome: string, i: Record<string, string>): string {
  const q = i.hora ? `${i.data} às ${i.hora}` : i.data;
  if (nome === "registar_visita") return `Registar visita ao cliente ${i.cliente_nome}, em ${q}, objetivo: ${i.objetivo}` + (i.notas ? ` (${i.notas})` : "") + ".";
  if (nome === "criar_tarefa") return `Criar tarefa "${i.titulo}" para o cliente ${i.cliente_nome}, com prazo ${q}.`;
  if (nome === "registar_chamada") return `Registar chamada ao cliente ${i.cliente_nome}${i.data ? ` (${i.data})` : ""} — assunto: ${i.assunto}` + (i.notas ? ` (${i.notas})` : "") + ".";
  return "Acao a confirmar.";
}

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = request.headers.get("authorization") || "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (!jwt || !(await authenticated(jwt))) return json(401, { error: "Sessao invalida. Volte a iniciar sessao." });

    const body = (await request.json()) as { comando: string; clientes?: Array<{ id: string; nome: string; codigo?: string }>; hoje?: string };
    const hoje = body.hoje || new Date().toISOString().slice(0, 10);
    const lista = (body.clientes || []).map((c) => `- ${c.nome} (id: ${c.id}${c.codigo ? ", codigo: " + c.codigo : ""})`).join("\n");

    const system =
      `Es o assistente comercial da Representacoes Freixo. Interpretas comandos em portugues de Portugal e transforma-los em acoes no CRM. Hoje e ${hoje}.\n\n` +
      `Podes: registar visitas, criar tarefas e registar chamadas ja ocorridas. Em todas, o cliente TEM de estar nesta lista (usa o id EXATO):\n${lista}\n\n` +
      `AGE COM DECISAO — o utilizador confirma sempre no ecra antes de gravar, por isso NAO precisas de pedir confirmacao de detalhes:\n` +
      `- Se houver UM cliente da lista que corresponda ao mencionado (mesmo com nome incompleto, abreviado ou com pequenas diferencas), USA-O diretamente. Nao perguntes 'e este?'.\n` +
      `- Regista o objetivo/assunto/titulo TAL COMO foi dito, mesmo que seja uma so palavra ou algo que nao conhecas (ex.: 'apresentar a cofra'). NUNCA perguntes o que e um produto ou servico.\n` +
      `- Resolve datas e horas relativas (amanha, sexta, 'as 8' -> 08:00).\n` +
      `- Distingue: visita/tarefa e algo futuro; 'registar chamada' e algo que ja aconteceu.\n\n` +
      `So deves responder com uma pergunta (sem usar ferramenta) em DOIS casos: (a) nenhum cliente da lista corresponde ao mencionado, ou (b) ha dois ou mais clientes IGUALMENTE provaveis e e impossivel decidir. Em qualquer outro caso, usa sempre a ferramenta.`;

    const payload = { model: (process.env.ANTHROPIC_MODEL as string) || DEFAULT_MODEL, max_tokens: 600, system, tools, messages: [{ role: "user", content: String(body.comando || "") }] };

    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, string> }>; error?: { message?: string } };
    if (!res.ok) return json(res.status, { error: data?.error?.message || "A API do Claude recusou o pedido." });

    const toolUse = (data.content || []).find((b) => b.type === "tool_use");
    if (toolUse && toolUse.name && toolUse.input) return json(200, { tipo: "acao", acao: toolUse.name, input: toolUse.input, resumo: resumoDe(toolUse.name, toolUse.input) });

    const texto = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    return json(200, { tipo: "pergunta", texto: texto || "Nao percebi o comando. Pode reformular?" });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : "Nao foi possivel interpretar o comando." });
  }
}

