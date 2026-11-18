// Núcleo do assistente de voz: reconhecimento tolerante de nomes, datas e validação das ações.
// Funções puras (sem rede), para poderem ser testadas em tests/voice-core.test.mjs.

export type ClienteVoz = { id: string; codigo: string; nome: string; nomeLegal?: string | null; cidade?: string | null };
export type ContactoVoz = { id: string; clienteId: string; nome: string; cargo?: string | null };
export type MarcaVoz = { id: string; nome: string };
export type PerfilVoz = { id: string; nome: string; email?: string | null };

export type Operacao =
  | { tabela: "activities"; op: "insert"; valores: Record<string, unknown> }
  | { tabela: "activities"; op: "update"; id: string; valores: Record<string, unknown> };
export type AcaoVoz = { tipo: string; resumo: string; operacoes: Operacao[]; destino?: string };

export type ContextoVoz = {
  userId: string;
  timezone: string;
  hoje: string; // AAAA-MM-DD no fuso do utilizador
  agoraISO: string;
  clientes: ClienteVoz[];
  contactos: ContactoVoz[];
  marcas: MarcaVoz[];
  perfis: PerfilVoz[];
  /** Converte data + hora locais (no fuso) num instante ISO. Lança erro se a hora não existir (mudança de hora). */
  instante: (data: string, hora: string) => string;
  /** Atividades que o assistente já viu nesta conversa (para concluir/reagendar só registos reais). */
  atividadesConhecidas?: Map<string, { titulo: string; temHora: boolean; hora?: string | null }>;
};

const SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

// ---------- Texto ----------

export function normalizar(texto: string): string {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " e ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim().replace(/\s+/g, " ");
}

/** Aproximação fonética para português: junta o que o ditado costuma trocar (ç/s/z/ss, ch/x, v/b, h mudo, letras dobradas…). */
export function fonetico(texto: string): string {
  return normalizar(texto)
    .split(" ")
    .map((p) => p
      .replace(/ph/g, "f").replace(/th/g, "t")
      .replace(/sch|ch|sh/g, "x")
      .replace(/lh/g, "li").replace(/nh/g, "ni")
      .replace(/qu(?=[ei])/g, "k").replace(/gu(?=[ei])/g, "g").replace(/qu/g, "k")
      .replace(/c(?=[ei])/g, "s").replace(/c/g, "k").replace(/q/g, "k")
      .replace(/g(?=[ei])/g, "j")
      .replace(/z/g, "s").replace(/w/g, "v").replace(/y/g, "i").replace(/v/g, "b")
      .replace(/h/g, "")
      .replace(/(.)\1+/g, "$1")
      .replace(/(?<=.)[eo]$/g, (m) => (m === "o" ? "u" : "i")))
    .join(" ");
}

const IGNORAR = new Set(["lda", "limitada", "unipessoal", "sa", "s", "a", "o", "os", "as", "de", "da", "do", "das", "dos", "e", "em", "cliente", "empresa", "firma", "loja", "sociedade", "comercial", "comercio", "filhos", "irmaos", "cia", "companhia", "sr", "senhor", "senhora", "dona", "d", "ao", "aos", "na", "no"]);

function tokens(texto: string): string[] {
  return normalizar(texto).split(" ").filter((t) => t && !IGNORAR.has(t));
}

function bigramas(s: string): string[] {
  const t = ` ${s} `;
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

export function semelhanca(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigramas(a), B = bigramas(b);
  const contagem = new Map<string, number>();
  for (const x of A) contagem.set(x, (contagem.get(x) ?? 0) + 1);
  let comuns = 0;
  for (const x of B) { const n = contagem.get(x) ?? 0; if (n > 0) { comuns++; contagem.set(x, n - 1); } }
  return (2 * comuns) / (A.length + B.length);
}

function semelhancaToken(a: string, b: string): number {
  if (a === b) return 1;
  const fa = fonetico(a), fb = fonetico(b);
  if (fa === fb) return 0.95;
  if (a.length >= 3 && b.startsWith(a)) return 0.85; // nome dito incompleto: "ferrag" → "ferragens"
  return semelhanca(fa, fb);
}

/** Pontuação 0..1 entre o que foi dito e um nome (ordem das palavras irrelevante, tolera erros de ditado). */
export function pontuarNome(dito: string, nome: string): number {
  const d = tokens(dito), n = tokens(nome);
  if (!d.length || !n.length) return 0;
  const nd = normalizar(dito), nn = normalizar(nome);
  if (nd === nn) return 1;
  // Cada palavra dita procura a melhor palavra do nome.
  let soma = 0;
  for (const t of d) soma += Math.max(...n.map((x) => semelhancaToken(t, x)));
  const cobertura = soma / d.length;
  // Penaliza ligeiramente nomes muito mais longos do que o que foi dito.
  const proporcao = Math.min(1, d.length / n.length);
  const global = semelhanca(fonetico(d.join(" ")), fonetico(n.join(" ")));
  let score = 0.65 * cobertura + 0.2 * global + 0.15 * proporcao;
  if (nn.includes(nd) && nd.length >= 4) score = Math.max(score, 0.9);
  return Math.min(1, score);
}

export type Candidato = { cliente: ClienteVoz; pontuacao: number; via: string };

/** Procura clientes pelo que foi dito: nome comercial, nome legal, código (ex.: "CLI 326"), cidade ou nome de um contacto. */
export function procurarClientes(dito: string, clientes: ClienteVoz[], contactos: ContactoVoz[] = [], limite = 6): Candidato[] {
  const texto = String(dito ?? "").trim();
  if (!texto) return [];
  const melhores = new Map<string, Candidato>();
  const guardar = (c: ClienteVoz, p: number, via: string) => {
    const atual = melhores.get(c.id);
    if (!atual || p > atual.pontuacao) melhores.set(c.id, { cliente: c, pontuacao: Math.round(p * 1000) / 1000, via });
  };
  const codigo = normalizar(texto).replace(/\s+/g, "").match(/^cli0*(\d+)$/);
  for (const c of clientes) {
    if (codigo && normalizar(c.codigo).replace(/\s+/g, "").replace(/^cli0*/, "") === codigo[1]) { guardar(c, 1, "código"); continue; }
    guardar(c, pontuarNome(texto, c.nome), "nome");
    if (c.nomeLegal) guardar(c, pontuarNome(texto, c.nomeLegal) * 0.97, "nome legal");
    if (c.cidade) {
      // "Ferragens Silva de Braga": o nome + cidade
      const comCidade = pontuarNome(texto, `${c.nome} ${c.cidade}`);
      if (comCidade > 0.6) guardar(c, comCidade * 0.98, "nome e cidade");
    }
  }
  const porId = new Map(clientes.map((c) => [c.id, c]));
  for (const p of contactos) {
    const c = porId.get(p.clienteId);
    if (!c) continue;
    const s = pontuarNome(texto, p.nome);
    if (s >= 0.75) guardar(c, s * 0.9, `contacto ${p.nome}`);
  }
  return [...melhores.values()].sort((a, b) => b.pontuacao - a.pontuacao).slice(0, limite).filter((x) => x.pontuacao >= 0.35);
}

export function procurarPorNome<T extends { nome: string }>(dito: string, lista: T[], minimo = 0.6): T | null {
  let melhor: T | null = null, pontos = 0;
  for (const x of lista) { const p = pontuarNome(dito, x.nome); if (p > pontos) { pontos = p; melhor = x; } }
  return pontos >= minimo ? melhor : null;
}

// ---------- Datas e horas ----------

export function partesNoFuso(instante: Date, timezone: string): { data: string; hora: string; diaSemana: number } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(instante).map((x) => [x.type, x.value]));
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}`, diaSemana: dias[p.weekday] ?? 0 };
}

export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function diaDaSemana(data: string): string {
  return SEMANA[new Date(`${data}T12:00:00Z`).getUTCDay()];
}

/** Calendário de referência para o modelo resolver "sexta", "para a semana", "daqui a 15 dias"… sem fazer contas de cabeça. */
export function calendario(hoje: string, antes = 7, depois = 35): string {
  const linhas: string[] = [];
  for (let i = -antes; i <= depois; i++) {
    const d = somarDias(hoje, i);
    const etiqueta = i === 0 ? " ← HOJE" : i === 1 ? " (amanhã)" : i === -1 ? " (ontem)" : i === 2 ? " (depois de amanhã)" : "";
    linhas.push(`${d} ${diaDaSemana(d)}${etiqueta}`);
  }
  return linhas.join("\n");
}

export function validarData(valor: unknown): string | null {
  const s = String(valor ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

/** Aceita "9", "9h", "9h30", "09:00", "9.30", "14:5" → "HH:MM". */
export function validarHora(valor: unknown): string | null {
  const s = String(valor ?? "").trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?:\s*[:h.]\s*(\d{1,2})?)?\s*(?:h|horas)?$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

// ---------- Ações ----------

export const TIPOS_AGENDA = ["Visita", "Reunião", "Chamada", "Follow-up", "Apresentação", "Envio de proposta", "Lembrete", "Outro"] as const;
export const TIPOS_INTERACAO = ["Chamada telefónica", "WhatsApp", "Visita comercial", "Reunião", "Videoconferência", "Proposta enviada", "Orçamento enviado", "Envio de catálogo", "Envio de tabela de preços", "Pedido de cotação", "Consulta recebida", "Seguimento / Follow-up", "Reclamação", "Amostra enviada", "Encomenda", "Informação técnica", "Nota interna", "Outra interação"] as const;
export const RESULTADOS = ["Positivo", "Neutro", "Negativo", "Aguarda resposta", "Concluído", "Sem resposta"] as const;
export const ECRAS: Record<string, string> = { Dashboard: "/dashboard", Agenda: "/agenda", Clientes: "/clientes", Fabricantes: "/fabricantes", Visitas: "/visitas", Tarefas: "/tarefas", Oportunidades: "/oportunidades", Correio: "/correio", Relatórios: "/relatorios", Perfil: "/perfil" };

const kindAgenda = (tipo: string) => tipo === "Visita" ? "visit" : tipo === "Chamada" ? "call" : tipo === "Reunião" ? "meeting" : "note";
const kindInteracao = (tipo: string) => tipo === "Email" ? "email" : tipo.includes("Chamada") || tipo === "WhatsApp" ? "call" : tipo.includes("Visita") ? "visit" : tipo.includes("Reunião") || tipo.includes("Videoconferência") ? "meeting" : tipo.includes("Proposta") || tipo.includes("Orçamento") ? "proposal" : "note";

function escolher<T extends string>(valor: unknown, opcoes: readonly T[], omissao: T): T {
  const v = String(valor ?? "").trim();
  if (!v) return omissao;
  const exata = opcoes.find((o) => normalizar(o) === normalizar(v));
  if (exata) return exata;
  const aprox = procurarPorNome(v, opcoes.map((nome) => ({ nome })), 0.55);
  return (aprox?.nome as T) ?? omissao;
}

function dataPt(data: string, hoje: string): string {
  if (data === hoje) return "hoje";
  if (data === somarDias(hoje, 1)) return "amanhã";
  if (data === somarDias(hoje, -1)) return "ontem";
  const [, m, d] = data.split("-");
  return `${diaDaSemana(data)}, ${Number(d)}/${Number(m)}`;
}

type Resultado = { ok: true; acao: AcaoVoz } | { ok: false; erro: string };

function resolverCliente(input: Record<string, unknown>, ctx: ContextoVoz): ClienteVoz | string {
  const codigo = String(input.cliente_codigo ?? "").trim();
  if (codigo) {
    const exato = ctx.clientes.find((c) => c.codigo.toLowerCase() === codigo.toLowerCase());
    if (exato) return exato;
  }
  const nome = String(input.cliente_nome ?? codigo).trim();
  const cands = procurarClientes(nome, ctx.clientes, ctx.contactos, 3);
  if (cands[0] && cands[0].pontuacao >= 0.8 && (!cands[1] || cands[0].pontuacao - cands[1].pontuacao >= 0.12)) return cands[0].cliente;
  if (!cands.length) return `Não existe nenhum cliente parecido com "${nome || codigo}". Use procurar_cliente ou pergunte ao utilizador.`;
  return `Cliente ambíguo ou inexistente ("${codigo || nome}"). Candidatos: ${cands.map((c) => `${c.cliente.codigo} ${c.cliente.nome}${c.cliente.cidade ? ` (${c.cliente.cidade})` : ""}`).join("; ")}. Use o código exato ou pergunte ao utilizador qual é.`;
}

function resolverResponsavel(input: Record<string, unknown>, ctx: ContextoVoz): string | { erro: string } {
  const r = String(input.responsavel ?? "").trim();
  if (!r || /^(eu|mim|me|comigo)$/i.test(normalizar(r))) return ctx.userId;
  const p = procurarPorNome(r, ctx.perfis, 0.55) ?? ctx.perfis.find((x) => x.email && normalizar(x.email).startsWith(normalizar(r)));
  return p ? p.id : { erro: `Responsável "${r}" não encontrado. Utilizadores: ${ctx.perfis.map((x) => x.nome).join(", ")}.` };
}

function resolverExtras(input: Record<string, unknown>, ctx: ContextoVoz, clienteId: string) {
  const marcaDita = String(input.marca ?? "").trim();
  const marca = marcaDita ? procurarPorNome(marcaDita, ctx.marcas, 0.55) : null;
  const contactoDito = String(input.contacto ?? "").trim();
  const contacto = contactoDito ? procurarPorNome(contactoDito, ctx.contactos.filter((c) => c.clienteId === clienteId), 0.6) : null;
  return { marca, marcaDita, contacto, contactoDito };
}

function agenda(data: string, hora: string | null, ctx: ContextoVoz): { start_at: string | null; has_time: boolean; due_date: string; occurred_at: string; schedule_timezone: string } | string {
  let start: string | null = null;
  if (hora) {
    try { start = ctx.instante(data, hora); } catch { return `A hora ${hora} de ${data} não existe ou é ambígua (mudança de hora). Peça outra hora.`; }
  }
  return { start_at: start, has_time: !!start, due_date: data, occurred_at: start ?? ctx.agoraISO, schedule_timezone: ctx.timezone };
}

export function construirAcao(nome: string, input: Record<string, unknown>, ctx: ContextoVoz): Resultado {
  const agora = ctx.agoraISO;

  if (nome === "abrir_ecra") {
    const ecra = escolher(input.ecra, Object.keys(ECRAS), "Dashboard");
    if (input.cliente_codigo || input.cliente_nome) {
      const c = resolverCliente(input, ctx);
      if (typeof c === "string") return { ok: false, erro: c };
      return { ok: true, acao: { tipo: "navegar", resumo: `Abrir a ficha de ${c.nome}.`, operacoes: [], destino: `/clientes/${encodeURIComponent(c.id)}` } };
    }
    return { ok: true, acao: { tipo: "navegar", resumo: `Abrir ${ecra}.`, operacoes: [], destino: ECRAS[ecra] } };
  }

  if (nome === "concluir_atividade" || nome === "reagendar_atividade" || nome === "cancelar_atividade") {
    const id = String(input.atividade_id ?? "").trim();
    const conhecida = ctx.atividadesConhecidas?.get(id);
    if (!id || !conhecida) return { ok: false, erro: "atividade_id desconhecido. Use primeiro consultar_agenda para obter o id real da atividade." };
    if (nome === "concluir_atividade") {
      const notas = String(input.notas ?? "").trim();
      return { ok: true, acao: { tipo: nome, resumo: `Marcar como concluída: "${conhecida.titulo}"${notas ? ` (${notas})` : ""}.`, operacoes: [{ tabela: "activities", op: "update", id, valores: { status: "completed", completed_at: agora, completed_by: ctx.userId, ...(notas ? { result: notas } : {}), updated_at: agora } }] } };
    }
    if (nome === "cancelar_atividade") {
      return { ok: true, acao: { tipo: nome, resumo: `Cancelar: "${conhecida.titulo}".`, operacoes: [{ tabela: "activities", op: "update", id, valores: { status: "cancelled", updated_at: agora } }] } };
    }
    const data = validarData(input.data);
    if (!data) return { ok: false, erro: "Data inválida: use AAAA-MM-DD a partir do calendário." };
    const hora = input.hora ? validarHora(input.hora) : (conhecida.temHora ? conhecida.hora ?? null : null);
    if (input.hora && !hora) return { ok: false, erro: "Hora inválida: use HH:MM (24h)." };
    const quando = agenda(data, hora, ctx);
    if (typeof quando === "string") return { ok: false, erro: quando };
    return { ok: true, acao: { tipo: nome, resumo: `Reagendar "${conhecida.titulo}" para ${dataPt(data, ctx.hoje)}${hora ? ` às ${hora}` : ""}.`, operacoes: [{ tabela: "activities", op: "update", id, valores: { ...quando, status: "scheduled", updated_at: agora } }] } };
  }

  const cliente = resolverCliente(input, ctx);
  if (typeof cliente === "string") return { ok: false, erro: cliente };
  const responsavel = resolverResponsavel(input, ctx);
  if (typeof responsavel !== "string") return { ok: false, erro: responsavel.erro };
  const { marca, marcaDita, contacto, contactoDito } = resolverExtras(input, ctx, cliente.id);
  const nomeResp = responsavel === ctx.userId ? "" : ` · responsável: ${ctx.perfis.find((p) => p.id === responsavel)?.nome ?? ""}`;
  const extrasResumo = `${marca ? ` · marca: ${marca.nome}` : marcaDita ? ` · marca: ${marcaDita}` : ""}${contacto ? ` · contacto: ${contacto.nome}` : contactoDito ? ` · contacto: ${contactoDito}` : ""}${nomeResp}`;
  const notas = String(input.notas ?? "").trim();
  // Se a marca/contacto não existir na base, fica escrito nas notas para não se perder.
  const notasFinais = [notas, !marca && marcaDita ? `Marca: ${marcaDita}` : "", !contacto && contactoDito ? `Contacto: ${contactoDito}` : ""].filter(Boolean).join("\n") || null;
  const base = { client_id: cliente.id, actor_id: ctx.userId, assigned_to: responsavel, manufacturer_id: marca?.id ?? null, contact_id: contacto?.id ?? null, updated_at: agora };

  if (nome === "criar_tarefa" || nome === "agendar_atividade") {
    const data = validarData(input.data) ?? (nome === "criar_tarefa" && !input.data ? ctx.hoje : null);
    if (!data) return { ok: false, erro: "Data inválida: use AAAA-MM-DD a partir do calendário." };
    const hora = input.hora ? validarHora(input.hora) : null;
    if (input.hora && !hora) return { ok: false, erro: "Hora inválida: use HH:MM (24h)." };
    const quando = agenda(data, hora, ctx);
    if (typeof quando === "string") return { ok: false, erro: quando };
    const lembrete = input.lembrete_minutos !== undefined && input.lembrete_minutos !== null && input.lembrete_minutos !== "" ? [Math.max(0, Math.min(43200, Math.round(Number(input.lembrete_minutos) || 0)))] : null;
    const quandoTxt = `${dataPt(data, ctx.hoje)}${hora ? ` às ${hora}` : ""}`;
    if (nome === "criar_tarefa") {
      const titulo = String(input.titulo ?? "").trim();
      if (!titulo) return { ok: false, erro: "Falta o título da tarefa." };
      return { ok: true, acao: { tipo: nome, resumo: `Criar tarefa "${titulo}" para ${cliente.nome}, prazo ${quandoTxt}${extrasResumo}.`, operacoes: [{ tabela: "activities", op: "insert", valores: { ...base, ...quando, kind: "task", interaction_type: "Tarefa", title: titulo, summary: titulo, description: notasFinais, status: "scheduled", source_module: "tasks", reminder_offsets: lembrete } }] } };
    }
    const tipo = escolher(input.tipo, TIPOS_AGENDA, "Visita");
    const assunto = String(input.assunto ?? "").trim() || (tipo === "Visita" ? "Visita comercial" : tipo);
    return { ok: true, acao: { tipo: nome, resumo: `Agendar ${tipo.toLowerCase()} com ${cliente.nome}, ${quandoTxt}: ${assunto}${extrasResumo}.`, operacoes: [{ tabela: "activities", op: "insert", valores: { ...base, ...quando, kind: kindAgenda(tipo), interaction_type: tipo, title: assunto, summary: assunto, description: notasFinais, status: "scheduled", source_module: tipo === "Visita" ? "visits" : "agenda", reminder_offsets: lembrete } }] } };
  }

  if (nome === "registar_interacao") {
    const tipo = escolher(input.tipo, TIPOS_INTERACAO, "Chamada telefónica");
    const assunto = String(input.assunto ?? "").trim();
    if (!assunto) return { ok: false, erro: "Falta o assunto da interação." };
    const data = input.data ? validarData(input.data) : ctx.hoje;
    if (!data) return { ok: false, erro: "Data inválida: use AAAA-MM-DD." };
    const hora = input.hora ? validarHora(input.hora) : null;
    let quando = ctx.agoraISO;
    if (hora || data !== ctx.hoje) { try { quando = ctx.instante(data, hora ?? "12:00"); } catch { /* fica agora */ } }
    const resultado = input.resultado ? escolher(input.resultado, RESULTADOS, "Neutro") : null;
    const proxima = String(input.proxima_acao ?? "").trim();
    const proximaData = input.proxima_acao_data ? validarData(input.proxima_acao_data) : null;
    if (input.proxima_acao_data && !proximaData) return { ok: false, erro: "proxima_acao_data inválida: use AAAA-MM-DD." };
    const operacoes: Operacao[] = [{ tabela: "activities", op: "insert", valores: { ...base, assigned_to: ctx.userId, kind: kindInteracao(tipo), interaction_type: tipo, title: assunto, subject: assunto, summary: assunto, description: notasFinais, result: resultado, next_action: proxima || null, next_action_date: proximaData, occurred_at: quando, start_at: quando, status: "completed", source_module: "client" } }];
    let resumo = `Registar no histórico de ${cliente.nome}: ${tipo.toLowerCase()} (${dataPt(data, ctx.hoje)}) — ${assunto}${resultado ? ` · resultado: ${resultado}` : ""}${extrasResumo}.`;
    if (proxima && proximaData) {
      operacoes.push({ tabela: "activities", op: "insert", valores: { ...base, kind: "task", interaction_type: "Tarefa", title: proxima, summary: proxima, description: `Seguimento de: ${assunto}`, start_at: null, has_time: false, due_date: proximaData, occurred_at: agora, schedule_timezone: ctx.timezone, status: "scheduled", source_module: "tasks" } });
      resumo += ` E criar tarefa de seguimento "${proxima}" para ${dataPt(proximaData, ctx.hoje)}.`;
    }
    return { ok: true, acao: { tipo: nome, resumo, operacoes } };
  }

  return { ok: false, erro: `Ação desconhecida: ${nome}` };
}

// ---------- Confirmação por voz ----------

export function respostaDeConfirmacao(texto: string): "sim" | "nao" | null {
  const t = normalizar(texto);
  if (!t || t.split(" ").length > 6) return null;
  if (/^(nao|cancela|cancelar|esquece|anula|anular|para|parar|nao grava|nao quero)\b/.test(t)) return "nao";
  if (/^(sim|confirma|confirmo|confirmar|grava|gravar|ok|okay|pode ser|podes|avanca|avancar|esta certo|certo|isso|exato|perfeito|feito|vai|manda)\b/.test(t)) return "sim";
  return null;
}
