// Frequência de visita dos clientes: texto guardado em clients.visit_frequency, convertido em dias.
export const visitFrequencyOptions = ["Semanal", "Quinzenal", "Mensal", "Bimestral", "Trimestral", "Semestral", "Anual"] as const;

const DAYS: Record<string, number> = { semanal: 7, quinzenal: 15, qinzenal: 15, mensal: 30, bimestral: 60, trimestral: 90, semestral: 180, anual: 365 };

export function visitFrequencyDays(value?: string | null): number | null {
  const key = String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!key) return null;
  if (DAYS[key]) return DAYS[key];
  const n = Number(key.replace(/\D/g, ""));
  return Number.isFinite(n) && n > 0 && n <= 3650 ? n : null;
}

export type VisitDue = { clientId: string; days: number; lastVisit: number | null; overdueDays: number };

// Clientes cuja última visita (já realizada) é mais antiga do que a sua frequência e sem visita futura marcada.
export function visitsDue(
  clients: Array<{ id?: string; visitFrequency?: string }>,
  visits: Array<{ clientId: string; at: number }>,
  now: number,
): VisitDue[] {
  const last = new Map<string, number>(), planned = new Set<string>();
  for (const v of visits) {
    if (!v.clientId || !Number.isFinite(v.at)) continue;
    if (v.at > now) planned.add(v.clientId);
    else last.set(v.clientId, Math.max(last.get(v.clientId) ?? 0, v.at));
  }
  const out: VisitDue[] = [];
  for (const c of clients) {
    const days = visitFrequencyDays(c.visitFrequency);
    if (!c.id || !days || planned.has(c.id)) continue;
    const lv = last.get(c.id) ?? null;
    const overdueDays = lv === null ? days : Math.floor((now - lv) / 86400000) - days;
    if (lv === null || overdueDays > 0) out.push({ clientId: c.id, days, lastVisit: lv, overdueDays });
  }
  return out.sort((a, b) => (a.lastVisit === null ? -1 : 0) - (b.lastVisit === null ? -1 : 0) || b.overdueDays - a.overdueDays);
}
