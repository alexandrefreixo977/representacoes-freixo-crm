import { Temporal } from '@js-temporal/polyfill';

export const DEFAULT_TIMEZONE = 'Europe/Lisbon';
export function validTimezone(value: string): boolean {
  try { new Intl.DateTimeFormat('pt-PT', { timeZone: value }).format(); return true; } catch { return false; }
}
export function localDate(instant: string | number | Date, timezone: string): string {
  return Temporal.Instant.from(new Date(instant).toISOString()).toZonedDateTimeISO(timezone).toPlainDate().toString();
}
export function localTime(instant: string | number | Date, timezone: string): string {
  return Temporal.Instant.from(new Date(instant).toISOString()).toZonedDateTimeISO(timezone).toPlainTime().toString({ smallestUnit: 'minute' });
}
export function scheduleInstant(date: string, time: string, timezone: string): string {
  // Reject ambiguous/nonexistent daylight-saving times instead of silently moving appointments.
  return Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(timezone, { disambiguation: 'reject' }).toInstant().toString();
}
export type AlertSchedule = { category: 'task' | 'agenda'; starts_at: string | null; due_date: string | null; has_time: boolean; origin?:string };
export function alertGroup(item: AlertSchedule, timezone: string, now = Date.now()): 'overdue' | 'today' | 'upcoming' | null {
  const today = localDate(now, timezone);
  const day = item.has_time && item.starts_at ? localDate(item.starts_at, timezone) : item.due_date;
  if (!day) return item.origin==='lead_profile'?'upcoming':null;
  if (item.category === 'task' && (item.has_time && item.starts_at ? Date.parse(item.starts_at) < now : day < today)) return 'overdue';
  if (day === today) return 'today';
  if (day > today && day <= Temporal.PlainDate.from(today).add({ days: 7 }).toString()) return 'upcoming';
  return null;
}
export function reminderOffsets(value: string): number[] | null {
  if (value === 'default') return null;
  if (value === 'none') return [];
  const values = [...new Set(value.split(',').map(v => Number(v.trim())))];
  if (!values.length || values.length > 8 || values.some(v => !Number.isInteger(v) || v < 0 || v > 43200)) throw new Error('Escolha até 8 lembretes entre 0 e 43200 minutos.');
  return values.sort((a, b) => b - a);
}
