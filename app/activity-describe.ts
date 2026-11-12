// Transforma os registos de atividade em frases legíveis e calcula os resumos por utilizador.

export type ActivityLog = {
  id: number; user_id: string; session_id: string | null; kind: string; module: string | null;
  entity_table: string | null; entity_id: string | null; label: string | null; detail: Record<string, any> | null; created_at: string;
};
export type ActivitySession = { id: string; user_id: string; started_at: string; last_seen_at: string; ended_at: string | null; end_reason: string | null; device: string | null };

const nouns: Record<string, string> = {
  clients: "cliente", client_contacts: "contacto", client_manufacturers: "fabricante na ficha do cliente",
  tasks: "tarefa", visits: "visita", opportunities: "oportunidade", emails: "email",
  manufacturers: "fabricante", manufacturer_contacts: "contacto do fabricante", manufacturer_commercial_terms: "condições do fabricante",
  manufacturer_family_discounts: "desconto por família", manufacturer_logistics: "logística do fabricante", manufacturer_commissions: "comissão do fabricante",
  catalog_orders: "documento comercial", catalog_document_events: "documento comercial", route_plans: "rota", route_stops: "paragem de rota",
  profiles: "utilizador", role_permissions: "permissão",
};
const activityNouns: Record<string, string> = { visit: "visita", visita: "visita", task: "tarefa", tarefa: "tarefa", call: "chamada", chamada: "chamada", meeting: "reunião", "reunião": "reunião", note: "nota", nota: "nota", email: "email" };

export const fieldLabels: Record<string, string> = {
  trade_name: "nome", legal_name: "nome legal", tax_id: "NIF", phone: "telefone", email: "email", address: "morada", postal_code: "código postal",
  city: "localidade", region: "região", country: "país", status: "estado", notes: "notas", owner_id: "comercial responsável", commercial_name: "comercial",
  visit_frequency: "frequência de visita", next_action: "próxima ação", next_contact_at: "próximo contacto", growth_plan: "plano de crescimento",
  segment: "segmento", potential: "potencial", priority_label: "prioridade", title: "título", summary: "resumo", description: "descrição",
  start_at: "data/hora", end_at: "fim", due_date: "data", due_at: "data", assigned_to: "responsável", assignee_id: "responsável", completed_at: "conclusão",
  first_name: "nome", last_name: "apelido", job_title: "cargo", is_primary: "contacto principal", active: "ativo", estimated_value: "valor",
  probability: "probabilidade", stage_id: "fase", outcome: "resultado", agreed_discount: "desconto", manufacturer_client_code: "código no fabricante",
  reminder_offsets: "lembrete", interaction_type: "tipo", role: "perfil", full_name: "nome", allowed: "permitido", archived_at: "arquivo",
};

const statusWords: Record<string, string> = { completed: "concluída", done: "concluída", cancelled: "cancelada", canceled: "cancelada", in_progress: "em curso", scheduled: "agendada", open: "aberta" };
const docEvents: Record<string, string> = { created: "Criou", approved: "Aprovou", email_accepted: "Enviou por email", email_failed: "Tentou enviar (falhou)", email_uncertain: "Enviou por email (sem confirmação)", converted: "Converteu em encomenda" };

const quote = (s: string | null | undefined) => (s ? `“${s}”` : "");

function noun(log: ActivityLog) {
  const t = log.entity_table ?? "";
  if (t === "activities") return activityNouns[String(log.detail?.tipo ?? "").toLowerCase()] ?? "atividade";
  if (t === "catalog_orders") return log.detail?.tipo === "proposal" ? "proposta" : log.detail?.tipo === "order" ? "encomenda" : "documento comercial";
  return nouns[t] ?? t.replace(/_/g, " ");
}

/** Frase principal e complemento (cliente, campos alterados…). */
export function describeActivity(log: ActivityLog, names: { clients?: Map<string, string>; manufacturers?: Map<string, string> } = {}): { text: string; extra: string; group: "acesso" | "navegação" | "alteração" | "pesquisa" } {
  const d = log.detail ?? {};
  switch (log.kind) {
    case "login": return { text: "Entrou no CRM", extra: d.dispositivo ? String(d.dispositivo) : "", group: "acesso" };
    case "logout": return { text: "Terminou sessão", extra: "", group: "acesso" };
    case "view": {
      if (log.entity_table === "clients") return { text: `Abriu a ficha do cliente ${quote(log.label ?? names.clients?.get(log.entity_id ?? "") ?? "")}`.trim(), extra: "", group: "navegação" };
      if (log.entity_table === "manufacturers") return { text: `Abriu o fabricante ${quote(log.label ?? names.manufacturers?.get(log.entity_id ?? "") ?? "")}`.trim(), extra: "", group: "navegação" };
      return { text: `Abriu ${log.module ?? "o CRM"}`, extra: "", group: "navegação" };
    }
    case "action":
      if (d.tipo === "pesquisa") return { text: `Pesquisou ${quote(log.label)}`, extra: "", group: "pesquisa" };
      return { text: log.label ?? "Ação", extra: log.module ?? "", group: "alteração" };
  }
  const n = noun(log);
  const label = quote(log.label);
  const client = d.cliente && d.cliente !== log.label ? `Cliente: ${d.cliente}` : "";
  if (log.entity_table === "catalog_document_events") {
    return { text: `${docEvents[String(d.tipo)] ?? "Atualizou"} documento comercial`, extra: client, group: "alteração" };
  }
  if (log.entity_table === "emails" && log.kind === "create") return { text: `Enviou email ${label}`.trim(), extra: client, group: "alteração" };
  if (log.kind === "create") return { text: `Criou ${n} ${label}`.trim(), extra: client, group: "alteração" };
  if (log.kind === "delete") return { text: `Apagou ${n} ${label}`.trim(), extra: client, group: "alteração" };
  const fields: string[] = Array.isArray(d.campos) ? d.campos : [];
  if (d.estado && fields.length <= 3 && ["completed", "done"].includes(String(d.estado))) return { text: `Concluiu ${n} ${label}`.trim(), extra: client, group: "alteração" };
  if (d.estado && ["cancelled", "canceled"].includes(String(d.estado))) return { text: `Cancelou ${n} ${label}`.trim(), extra: client, group: "alteração" };
  if (d.estado === "in_progress") return { text: `Iniciou ${n} ${label}`.trim(), extra: client, group: "alteração" };
  const changed = [...new Set(fields.filter(f => !["completed_by", "updated_by", "schedule_timezone", "occurred_at", "has_time"].includes(f)).map(f => fieldLabels[f] ?? f.replace(/_/g, " ")))];
  const what = changed.length ? `Alterou: ${changed.join(", ")}` : "";
  const status = d.estado ? `Estado: ${statusWords[String(d.estado)] ?? d.estado}` : "";
  return { text: `Editou ${n} ${label}`.trim(), extra: [client, what, status].filter(Boolean).join(" · "), group: "alteração" };
}

export type UserSummary = {
  userId: string; entries: number; firstEntry: string | null; lastExit: string | null; online: boolean; activeMinutes: number;
  created: number; updated: number; deleted: number; views: number; searches: number; clientsOpened: number; modules: Set<string>; devices: Set<string>;
};

export const sessionEnd = (s: ActivitySession) => s.ended_at ?? s.last_seen_at;
export const isOnline = (s: ActivitySession, now = Date.now()) => !s.ended_at && now - Date.parse(s.last_seen_at) < 3 * 60_000;

export function summarize(userId: string, sessions: ActivitySession[], logs: ActivityLog[], from: number, to: number, now = Date.now()): UserSummary {
  const mine = sessions.filter(s => s.user_id === userId);
  const myLogs = logs.filter(l => l.user_id === userId);
  let minutes = 0;
  for (const s of mine) {
    const start = Math.max(Date.parse(s.started_at), from), end = Math.min(Date.parse(sessionEnd(s)), to);
    if (end > start) minutes += (end - start) / 60000;
  }
  const starts = mine.map(s => s.started_at).filter(t => Date.parse(t) >= from && Date.parse(t) < to).sort();
  const ends = mine.filter(s => !isOnline(s, now)).map(sessionEnd).filter(t => Date.parse(t) >= from && Date.parse(t) < to).sort();
  return {
    userId, entries: starts.length, firstEntry: starts[0] ?? null, lastExit: ends.at(-1) ?? null, online: mine.some(s => isOnline(s, now)),
    activeMinutes: Math.round(minutes),
    created: myLogs.filter(l => l.kind === "create").length, updated: myLogs.filter(l => l.kind === "update").length, deleted: myLogs.filter(l => l.kind === "delete").length,
    views: myLogs.filter(l => l.kind === "view").length, searches: myLogs.filter(l => l.kind === "action" && l.detail?.tipo === "pesquisa").length,
    clientsOpened: new Set(myLogs.filter(l => l.kind === "view" && l.entity_table === "clients").map(l => l.entity_id)).size,
    modules: new Set(myLogs.filter(l => l.kind === "view").map(l => l.entity_table === "clients" ? "Clientes" : l.entity_table === "manufacturers" ? "Fabricantes" : l.module ?? "")),
    devices: new Set(mine.map(s => s.device ?? "").filter(Boolean)),
  };
}

export const formatMinutes = (m: number) => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
