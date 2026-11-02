// Datas legíveis para a equipa comercial: "Hoje", "Amanhã", "Ontem", "29 out", "há 12 dias".
const DAY = 86400000;
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
function parse(value: string | Date): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (!value) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}
/** Diferença em dias de calendário (positivo = futuro). */
export function daysFromToday(value: string | Date, now = new Date()): number | null {
  const d = parse(value);
  return d ? Math.round((dayStart(d) - dayStart(now)) / DAY) : null;
}
export function friendlyDay(value: string | Date, now = new Date()): string {
  const d = parse(value);
  if (!d) return "—";
  const diff = daysFromToday(d, now)!;
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  if (diff === -1) return "Ontem";
  if (diff > 1 && diff < 7) return WEEKDAYS[d.getDay()];
  const label = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? label : `${label} ${d.getFullYear()}`;
}
/** "há 3 dias", "há 2 meses" — para o último contacto. */
export function timeAgo(value: string | Date, now = new Date()): string {
  const diff = daysFromToday(value, now);
  if (diff === null) return "—";
  const days = -diff;
  if (days <= 0) return "Hoje";
  if (days === 1) return "Ontem";
  if (days < 30) return `há ${days} dias`;
  const months = Math.round(days / 30);
  if (months < 12) return months === 1 ? "há 1 mês" : `há ${months} meses`;
  const years = Math.round(days / 365);
  return years === 1 ? "há 1 ano" : `há ${years} anos`;
}
