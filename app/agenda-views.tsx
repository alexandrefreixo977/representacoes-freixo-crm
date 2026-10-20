"use client";
import "./agenda-views.css";

// Vistas da agenda: dia, semana, 15 dias e mês.
export type AgendaView = "day" | "week" | "fortnight" | "month";

export const AGENDA_VIEWS: Array<{ id: AgendaView; label: string }> = [
  { id: "day", label: "Dia" },
  { id: "week", label: "Semana" },
  { id: "fortnight", label: "15 dias" },
  { id: "month", label: "Mês" },
];

export const isAgendaView = (value: unknown): value is AgendaView =>
  value === "day" || value === "week" || value === "fortnight" || value === "month";

export const agendaDayKey = (value: Date | string) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const atNoon = (value: Date) => { const d = new Date(value); d.setHours(12, 0, 0, 0); return d; };
const addDays = (value: Date, amount: number) => { const d = atNoon(value); d.setDate(d.getDate() + amount); return d; };
// Semana começa à segunda-feira.
const startOfWeek = (value: Date) => { const d = atNoon(value); return addDays(d, -((d.getDay() + 6) % 7)); };

/** Dias abrangidos pela vista (início incluído, fim excluído). */
export function agendaRange(view: AgendaView, anchor: Date): { start: Date; days: number } {
  if (view === "day") return { start: atNoon(anchor), days: 1 };
  if (view === "week") return { start: startOfWeek(anchor), days: 7 };
  if (view === "fortnight") return { start: atNoon(anchor), days: 15 };
  const first = atNoon(anchor); first.setDate(1);
  const last = new Date(first); last.setMonth(last.getMonth() + 1, 0);
  return { start: first, days: last.getDate() };
}

export function agendaInRange(view: AgendaView, anchor: Date, value: string) {
  const { start, days } = agendaRange(view, anchor);
  const key = agendaDayKey(value);
  return key >= agendaDayKey(start) && key <= agendaDayKey(addDays(start, days - 1));
}

/** Avança/recua um período inteiro da vista atual. */
export function agendaMove(view: AgendaView, anchor: Date, direction: 1 | -1) {
  if (view === "month") { const d = atNoon(anchor); d.setDate(1); d.setMonth(d.getMonth() + direction); return d; }
  return addDays(anchor, direction * (view === "day" ? 1 : view === "week" ? 7 : 15));
}

const fmt = (options: Intl.DateTimeFormatOptions, value: Date) => new Intl.DateTimeFormat("pt-PT", options).format(value);

const shortMonth = (value: Date) => fmt({ month: "short" }, value);

export function agendaTitle(view: AgendaView, anchor: Date) {
  if (view === "day") return fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }, anchor);
  if (view === "month") { const t = fmt({ month: "long", year: "numeric" }, anchor); return t.charAt(0).toUpperCase() + t.slice(1); }
  const { start, days } = agendaRange(view, anchor);
  const end = addDays(start, days - 1);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  return sameMonth
    ? `${start.getDate()} – ${fmt({ day: "numeric", month: "long", year: "numeric" }, end)}`
    : `${start.getDate()} ${shortMonth(start)}${start.getFullYear() !== end.getFullYear() ? ` ${start.getFullYear()}` : ""} – ${end.getDate()} ${shortMonth(end)} ${end.getFullYear()}`;
}

export function AgendaViewSwitcher({ view, onChange }: { view: AgendaView; onChange: (view: AgendaView) => void }) {
  return <div className="agenda-view-switch" role="tablist" aria-label="Vista da agenda">
    {AGENDA_VIEWS.map(v => <button key={v.id} type="button" role="tab" aria-selected={view === v.id} className={view === v.id ? "active" : ""} onClick={() => onChange(v.id)}>{v.label}</button>)}
  </div>;
}

type GridItem = { id: string; startAt: string; type: string; client: string; assigned: string };
const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const typeClass = (type: string) => `type-${type.toLowerCase().replace(/[^a-z]+/g, "-")}`;
const hasTime = (value: string) => { const d = new Date(value); return d.getHours() !== 0 || d.getMinutes() !== 0; };

/** Grelha de vários dias (semana, 15 dias, mês). Clicar no dia abre a vista diária. */
export function AgendaMultiDay<T extends GridItem>({ view, anchor, items, onSelect, onOpenDay }: {
  view: Exclude<AgendaView, "day">; anchor: Date; items: T[]; onSelect: (item: T) => void; onOpenDay: (day: Date) => void;
}) {
  const { start, days } = agendaRange(view, anchor);
  const lead = (start.getDay() + 6) % 7; // alinhar à coluna de segunda-feira
  const total = Math.ceil((lead + days) / 7) * 7;
  const today = agendaDayKey(new Date());
  const anchorMonth = atNoon(anchor).getMonth();
  const byDay = new Map<string, T[]>();
  for (const item of [...items].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    const key = agendaDayKey(item.startAt);
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }
  const limit = view === "week" ? 12 : view === "fortnight" ? 6 : 4;
  const cells = Array.from({ length: total }, (_, i) => {
    const date = addDays(start, i - lead);
    const inRange = i >= lead && i < lead + days;
    return { date, key: agendaDayKey(date), inRange };
  });

  return <div className={`agenda-grid view-${view}`}>
    <div className="agenda-grid-weekdays" aria-hidden="true">{WEEKDAYS.map(d => <span key={d}>{d}</span>)}</div>
    <div className="agenda-grid-days">
      {cells.map(cell => {
        const list = cell.inRange ? byDay.get(cell.key) ?? [] : [];
        const other = view === "month" ? cell.date.getMonth() !== anchorMonth : !cell.inRange;
        return <div key={cell.key} className={`agenda-day${other ? " is-outside" : ""}${cell.key === today ? " is-today" : ""}${list.length ? "" : " is-empty"}`}>
          <button type="button" className="agenda-day-head" onClick={() => onOpenDay(cell.date)} aria-label={`Abrir ${fmt({ weekday: "long", day: "numeric", month: "long" }, cell.date)}`}>
            <span className="agenda-day-weekday">{WEEKDAYS[(cell.date.getDay() + 6) % 7]}</span>
            <strong>{cell.date.getDate()}</strong>
            {cell.date.getDate() === 1 && <em>{fmt({ month: "short" }, cell.date)}</em>}
            {list.length > 0 && <b>{list.length}</b>}
          </button>
          {list.slice(0, limit).map(item => <button type="button" key={item.id} className={`agenda-chip ${typeClass(item.type)}`} onClick={() => onSelect(item)} title={`${item.type} · ${item.client} · ${item.assigned}`}>
            <time>{hasTime(item.startAt) ? new Date(item.startAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }) : "—"}</time>
            <span>{item.type} · {item.client}</span>
          </button>)}
          {list.length > limit && <button type="button" className="agenda-more" onClick={() => onOpenDay(cell.date)}>+{list.length - limit} mais</button>}
        </div>;
      })}
    </div>
  </div>;
}
