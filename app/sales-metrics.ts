// Métricas do dashboard comercial (visão de diretor comercial): períodos comparáveis e indicadores do CRM.
// Funções puras, testadas em tests/sales-metrics.test.mjs.

export type PeriodKind = "week" | "month" | "quarter" | "year" | "12m";
export type Range = { kind: PeriodKind; from: string; to: string; prevFrom: string; prevTo: string; label: string; prevLabel: string };

const DAY = 86400000;
const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (y: number, m: number, d: number) => new Date(y, m, d, 12);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const short = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;

/** Período até hoje e o período anterior com o mesmo número de dias (comparação justa: "até à mesma data"). */
export function periodRange(kind: PeriodKind, now = new Date()): Range {
  const today = at(now.getFullYear(), now.getMonth(), now.getDate());
  const to = addDays(today, 1);
  let from: Date, prevFrom: Date, label: string, prevLabel: string;
  if (kind === "week") {
    from = addDays(today, -((today.getDay() + 6) % 7));
    prevFrom = addDays(from, -7);
    label = "Esta semana"; prevLabel = "semana passada";
  } else if (kind === "month") {
    from = at(today.getFullYear(), today.getMonth(), 1);
    prevFrom = at(today.getFullYear(), today.getMonth() - 1, 1);
    label = "Este mês"; prevLabel = `${MONTHS[prevFrom.getMonth()]} (mesmos dias)`;
  } else if (kind === "quarter") {
    from = at(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
    prevFrom = at(from.getFullYear(), from.getMonth() - 3, 1);
    label = "Este trimestre"; prevLabel = "trimestre anterior (mesmos dias)";
  } else if (kind === "year") {
    from = at(today.getFullYear(), 0, 1);
    prevFrom = at(today.getFullYear() - 1, 0, 1);
    label = `Ano ${today.getFullYear()}`; prevLabel = `${today.getFullYear() - 1} até ${short(today)}`;
  } else {
    from = addDays(to, -365);
    prevFrom = addDays(from, -365);
    label = "Últimos 12 meses"; prevLabel = "12 meses anteriores";
  }
  // Mesmo número de dias, sem passar o início do período atual.
  let prevTo = addDays(prevFrom, daysBetween(from, to));
  if (prevTo > from) prevTo = from;
  return { kind, from: ymd(from), to: ymd(to), prevFrom: ymd(prevFrom), prevTo: ymd(prevTo), label, prevLabel };
}

export type Delta = { text: string; tone: "up" | "down" | "flat" | "new" };
/** Variação face ao período anterior: "+12%", "−5%", "novo", "=". */
export function delta(current: number, previous: number, lowerIsBetter = false): Delta {
  if (!previous && !current) return { text: "=", tone: "flat" };
  if (!previous) return { text: "novo", tone: "new" };
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
  if (pct === 0) return { text: "=", tone: "flat" };
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  return { text: `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`, tone: good ? "up" : "down" };
}
/** Diferença em pontos percentuais para taxas (ex. conversão 40% → 55% = "+15 pp"). */
export function deltaPoints(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) return { text: current === null ? "—" : "novo", tone: current === null ? "flat" : "new" };
  const pp = Math.round((current - previous) * 100);
  if (pp === 0) return { text: "=", tone: "flat" };
  return { text: `${pp > 0 ? "+" : "−"}${Math.abs(pp)} pp`, tone: pp > 0 ? "up" : "down" };
}

export type MOpportunity = { id: string; title: string; client: string; clientId: string; sellerId: string; stage: string; stagePosition: number; probability: number; value: number; finalValue: number | null; outcome: string; createdAt: string; closedAt: string | null; expectedClose: string | null; lastActivityAt: string | null; updatedAt: string; lossReason: string | null; manufacturer: string | null };
export type MActivity = { kind: string; status: string; at: string; userId: string; clientId: string };
export type MProposal = { status: string; total: number; sentAt: string | null; acceptedAt: string | null; sellerId: string };
export type MProfile = { id: string; name: string; role: string };

const inRange = (iso: string | null | undefined, from: string, to: string) => {
  if (!iso) return false;
  const d = ymd(new Date(iso));
  return d >= from && d < to;
};
const won = (o: MOpportunity) => o.outcome === "won" || o.stage === "Ganha";
const lost = (o: MOpportunity) => o.outcome === "lost" || o.stage === "Perdida";
const open = (o: MOpportunity) => !won(o) && !lost(o) && o.outcome !== "archived";
const wonValue = (o: MOpportunity) => o.finalValue ?? o.value;
const closeDate = (o: MOpportunity) => o.closedAt ?? o.updatedAt;
const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + (f(x) || 0), 0);
/** Atividade que de facto aconteceu: não cancelada e concluída ou já passada. */
const happened = (a: MActivity, nowIso: string) => {
  const st = a.status.toLowerCase();
  if (["cancelled", "canceled", "cancelada"].includes(st)) return false;
  return ["completed", "done", "concluida", "concluída"].includes(st) || a.at <= nowIso;
};

function periodStats(opps: MOpportunity[], acts: MActivity[], props: MProposal[], from: string, to: string, nowIso: string) {
  const wonList = opps.filter((o) => won(o) && inRange(closeDate(o), from, to));
  const lostList = opps.filter((o) => lost(o) && inRange(closeDate(o), from, to));
  const created = opps.filter((o) => inRange(o.createdAt, from, to));
  const periodActs = acts.filter((a) => inRange(a.at, from, to) && happened(a, nowIso));
  const visits = periodActs.filter((a) => a.kind === "visit");
  const sent = props.filter((p) => inRange(p.sentAt, from, to));
  const accepted = props.filter((p) => p.status === "accepted" && inRange(p.acceptedAt, from, to));
  const decided = wonList.length + lostList.length;
  return {
    won: wonList.length, wonValue: sum(wonList, wonValue),
    lost: lostList.length, lostValue: sum(lostList, (o) => o.value),
    conversion: decided ? wonList.length / decided : null,
    avgDeal: wonList.length ? sum(wonList, wonValue) / wonList.length : 0,
    cycleDays: wonList.length ? Math.round(sum(wonList, (o) => daysBetween(new Date(o.createdAt), new Date(closeDate(o)))) / wonList.length) : null,
    created: created.length, createdValue: sum(created, (o) => o.value),
    visits: visits.length, clientsVisited: new Set(visits.map((a) => a.clientId).filter(Boolean)).size,
    calls: periodActs.filter((a) => a.kind === "call").length,
    emails: periodActs.filter((a) => a.kind === "email").length,
    contacts: periodActs.filter((a) => ["visit", "call", "email", "note"].includes(a.kind)).length,
    proposalsSent: sent.length, proposalsSentValue: sum(sent, (p) => p.total),
    proposalsAccepted: accepted.length, proposalsAcceptedValue: sum(accepted, (p) => p.total),
    lossReasons: Object.entries(lostList.reduce<Record<string, number>>((m, o) => { const k = (o.lossReason || "Sem motivo indicado").trim(); m[k] = (m[k] ?? 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 4),
  };
}
export type PeriodStats = ReturnType<typeof periodStats>;

/** Indicadores do CRM para o período e o período anterior comparável, já filtrados pelo comercial (owner) quando indicado. */
export function crmMetrics(input: { opportunities: MOpportunity[]; activities: MActivity[]; proposals: MProposal[]; profiles: MProfile[]; range: Range; owner: string; now?: Date }) {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const mine = (id: string) => input.owner === "all" || id === input.owner;
  const opps = input.opportunities.filter((o) => mine(o.sellerId));
  const acts = input.activities.filter((a) => mine(a.userId));
  const props = input.proposals.filter((p) => mine(p.sellerId));
  const { from, to, prevFrom, prevTo } = input.range;
  const openOpps = opps.filter(open);
  const stale = (o: MOpportunity) => now.getTime() - new Date(o.lastActivityAt ?? o.updatedAt).getTime() > 15 * DAY;

  const stages = new Map<string, { stage: string; position: number; count: number; value: number; weighted: number; stale: number }>();
  for (const o of openOpps) {
    const s = stages.get(o.stage) ?? { stage: o.stage, position: o.stagePosition, count: 0, value: 0, weighted: 0, stale: 0 };
    s.count++; s.value += o.value; s.weighted += (o.value * o.probability) / 100; if (stale(o)) s.stale++;
    stages.set(o.stage, s);
  }
  const funnel = [...stages.values()].sort((a, b) => a.position - b.position);

  const months = Array.from({ length: 3 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); return { key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: MONTHS[d.getMonth()], value: 0, weighted: 0, count: 0 }; });
  let overdueClose = 0, overdueCloseValue = 0, overdueWeighted = 0, noDate = 0, noDateValue = 0, noDateWeighted = 0;
  const today = ymd(now);
  for (const o of openOpps) {
    if (!o.expectedClose) { noDate++; noDateValue += o.value; noDateWeighted += (o.value * o.probability) / 100; continue; }
    if (o.expectedClose < today) { overdueClose++; overdueCloseValue += o.value; overdueWeighted += (o.value * o.probability) / 100; continue; }
    const m = months.find((x) => o.expectedClose!.startsWith(x.key));
    if (m) { m.count++; m.value += o.value; m.weighted += (o.value * o.probability) / 100; }
  }

  const team = input.profiles.filter((p) => input.owner === "all" || p.id === input.owner).map((p) => {
    const s = periodStats(opps.filter((o) => o.sellerId === p.id), acts.filter((a) => a.userId === p.id), props.filter((x) => x.sellerId === p.id), from, to, nowIso);
    const po = openOpps.filter((o) => o.sellerId === p.id);
    return { id: p.id, name: p.name, visits: s.visits, calls: s.calls, emails: s.emails, proposals: s.proposalsSent, won: s.won, wonValue: s.wonValue, conversion: s.conversion, pipeline: sum(po, (o) => o.value), openCount: po.length, stale: po.filter(stale).length };
  }).sort((a, b) => b.wonValue - a.wonValue || b.pipeline - a.pipeline || b.visits - a.visits);

  const hot = [...openOpps].sort((a, b) => (b.value * b.probability) - (a.value * a.probability)).slice(0, 5);

  return {
    current: periodStats(opps, acts, props, from, to, nowIso),
    previous: periodStats(opps, acts, props, prevFrom, prevTo, nowIso),
    pipeline: { count: openOpps.length, value: sum(openOpps, (o) => o.value), weighted: sum(openOpps, (o) => (o.value * o.probability) / 100), stale: openOpps.filter(stale).length },
    funnel, forecast: { months, overdue: overdueClose, overdueValue: overdueCloseValue, overdueWeighted, noDate, noDateValue, noDateWeighted }, team, hot,
  };
}
export type CrmMetrics = ReturnType<typeof crmMetrics>;

/** Valores compactos para KPIs: 1 250 € / 12,5 mil € / 1,2 M€. */
export function compactMoney(value: number): string {
  const v = Math.round(value);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} M€`;
  if (Math.abs(v) >= 10_000) return `${(v / 1000).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} mil €`;
  return `${v.toLocaleString("pt-PT")} €`;
}
export const percent = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
export const monthLabel = (key: string) => { const [y, m] = key.split("-").map(Number); return `${MONTHS[m - 1]}${m === 1 ? ` ${String(y).slice(2)}` : ""}`; };
