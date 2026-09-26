// Cerebro da camada de voz (Fase 2.1) — Freixo CRM.
//
// Recebe um comando em TEXTO e a lista de clientes do utilizador, pergunta a
// API do Claude o que fazer, e devolve uma acao estruturada (registar visita)
// ou uma pergunta de esclarecimento. A execucao (gravar na base de dados) e
// feita no cliente, so apos confirmacao — este endpoint nunca grava nada.
//
// Variaveis de ambiente necessarias no alojamento:
//   ANTHROPIC_API_KEY  = a chave da API do Claude (sk-ant-...)
//   ANTHROPIC_MODEL    = (opcional) o modelo a usar; se ausente usa um por defeito
//   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (ja existem)

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-3-5-sonnet-latest";

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function env(name: string): string {
  const value = (process.env as Record<string, string | undefined>)[name];
  if (!value) throw new Error(`Configuracao em falta no servidor: ${name}`);
  return value;
}

// Confirma sessao Supabase valida.
async function authenticated(jwt: string): Promise<boolean> {
  const res = await fetch(`${env("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      apikey: env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    },
  });
  return res.ok;
}

const registarVisita = {
  name: "registar_visita",
  description:
    "Regista uma visita comercial a um cliente. Usa apenas quando o comando pede claramente para registar ou marcar uma visita E consegues identificar o cliente na lista fornecida.",
  input_schema: {
    type: "object",
    properties: {
      cliente_id: { type: "string", description: "O id EXATO do cliente, escolhido da lista fornecida." },
      cliente_nome: { type: "string", description: "O nome do cliente tal como aparece na lista." },
      data: { type: "string", description: "Data da visita em formato AAAA-MM-DD. Resolve 'hoje', 'amanha', dias da semana." },
      objetivo: { type: "string", description: "O objetivo ou assunto da visita." },
      notas: { type: "string", description: "Notas adicionais, se existirem." },
    },
    required: ["cliente_id", "cliente_nome", "data", "objetivo"],
  },
};

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = request.headers.get("authorization") || "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (!jwt || !(await authenticated(jwt))) {
      return json(401, { error: "Sessao invalida. Volte a iniciar sessao." });
    }

    const body = (await request.json()) as {
      comando: string;
      clientes?: Array<{ id: string; nome: string; codigo?: string }>;
      hoje?: string;
    };

    const hoje = body.hoje || new Date().toISOString().slice(0, 10);
    const lista = (body.clientes || [])
      .map((c) => `- ${c.nome} (id: ${c.id}${c.codigo ? ", codigo: " + c.codigo : ""})`)
      .join("\n");

    const system =
      `Es o assistente comercial da Representacoes Freixo. Interpretas comandos em portugues de Portugal e transforma-los em acoes no CRM. Hoje e ${hoje}.\n\n` +
      `So podes registar visitas a clientes desta lista (usa o id EXATO):\n${lista}\n\n` +
      `Regras: se nao identificares o cliente com confianca, ou se faltar informacao essencial (cliente, data ou objetivo), NAO uses a ferramenta — responde com uma pergunta curta a pedir o que falta. Se houver dois clientes parecidos, pergunta qual. Resolve datas relativas para AAAA-MM-DD.`;

    const payload = {
      model: (process.env.ANTHROPIC_MODEL as string) || DEFAULT_MODEL,
      max_tokens: 600,
      system,
      tools: [registarVisita],
      messages: [{ role: "user", content: String(body.comando || "") }],
    };

    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": env("ANTHROPIC_API_KEY"),
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, string> }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      return json(res.status, { error: data?.error?.message || "A API do Claude recusou o pedido." });
    }

    const toolUse = (data.content || []).find((b) => b.type === "tool_use");
    if (toolUse && toolUse.input) {
      const i = toolUse.input;
      const resumo =
        `Registar visita ao cliente ${i.cliente_nome}, em ${i.data}, objetivo: ${i.objetivo}` +
        (i.notas ? ` (${i.notas})` : "") + ".";
      return json(200, { tipo: "acao", acao: "registar_visita", input: i, resumo });
    }

    const texto = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    return json(200, { tipo: "pergunta", texto: texto || "Nao percebi o comando. Pode reformular?" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel interpretar o comando.";
    return json(500, { error: message });
  }
}

