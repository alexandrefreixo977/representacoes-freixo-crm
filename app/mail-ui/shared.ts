import type { LiveMessage } from "../mail-matching";
import { mailRequest } from "../mail-client";

export type Folder = { id: string; displayName: string; parentFolderId?: string; childFolderCount?: number; unreadItemCount?: number; totalItemCount?: number; wellKnown?: string; depth?: number };
export type Msg = LiveMessage & { deleted?: boolean };
export type Category = { displayName: string; color: string };
export type MailFilter = "all" | "unread" | "flagged" | "attachments" | "important";
export type Action = "read" | "unread" | "flag" | "unflag" | "complete" | "categorize" | "move" | "delete" | "purge";
export type ComposeState = { key: number; mode: "new" | "reply" | "replyAll" | "forward"; source?: Msg; draftId?: string; to?: string[] };

export const FILTER_LABELS: Record<MailFilter, string> = { all: "Todos", unread: "Não lidos", flagged: "Sinalizados", attachments: "Com anexos", important: "Importância alta" };

// Outlook category presets (preset0…preset24) mapped to readable colours.
const PRESETS = ["#d13438", "#e97548", "#8e562e", "#d9b100", "#4c9a2a", "#00a7a7", "#7a7b3c", "#2b79d0", "#8764b8", "#c0306b", "#6e8aa6", "#4a5b6e", "#8a8886", "#5c5b5a", "#2b2b2b", "#a4262c", "#ca5010", "#6d4422", "#a88a00", "#2a6a1a", "#006b6b", "#55561e", "#1c4f8f", "#5c2e91", "#8f1f4a"];
export const categoryColor = (categories: Category[], name: string) => {
  const preset = categories.find(item => item.displayName === name)?.color;
  const index = preset && /^preset\d+$/.test(preset) ? Number(preset.slice(6)) : -1;
  return PRESETS[index] ?? "#8a7a55";
};

export const messageDate = (message: Msg) => (message.isDraft ? message.lastModifiedDateTime : message.direction === "out" ? message.sentDateTime : message.receivedDateTime) || message.receivedDateTime || message.sentDateTime || message.lastModifiedDateTime || "";

export function listDate(value: string) {
  if (!value) return "";
  const date = new Date(value), now = new Date();
  const days = Math.floor((startOfDay(now) - startOfDay(date)) / 86400000);
  if (days === 0) return date.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "Ontem";
  if (days < 7) return date.toLocaleDateString("pt-PT", { weekday: "short" }).replace(".", "") + " " + date.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("pt-PT", date.getFullYear() === now.getFullYear() ? { day: "2-digit", month: "2-digit" } : { day: "2-digit", month: "2-digit", year: "numeric" });
}
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export function dateGroup(value: string) {
  if (!value) return "Sem data";
  const now = new Date(), date = new Date(value);
  const days = Math.floor((startOfDay(now) - startOfDay(date)) / 86400000);
  const weekday = (now.getDay() + 6) % 7;
  if (days <= 0) return "Hoje";
  if (days === 1) return "Ontem";
  if (days <= weekday) return "Esta semana";
  if (days <= weekday + 7) return "Semana passada";
  if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) return "Este mês";
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString("pt-PT", { month: "long" }).replace(/^./, letter => letter.toUpperCase());
  return "Mais antigos";
}

export const fullDate = (value?: string) => value ? new Date(value).toLocaleString("pt-PT", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

export const personName = (party?: { emailAddress?: { name?: string; address?: string } }) => party?.emailAddress?.name || party?.emailAddress?.address || "Sem endereço";
export const initials = (name: string) => name.replace(/[<>"'@].*$/, "").split(/[\s.\-_]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?";
const AVATAR = ["#8a6512", "#4f6b58", "#7a4e3a", "#3f5c78", "#6b4f80", "#806d2a", "#4a6f73", "#8a4a55"];
export const avatarColor = (seed: string) => AVATAR[[...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR.length];

export const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} MB`;

export const postJson = (path: string, body: unknown, method = "POST") => mailRequest(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const mailAction = (action: Action, ids: string[], extra: Record<string, unknown> = {}) => postJson("/api/mail/actions", { action, ids, ...extra }) as Promise<{ ok: boolean; failed: string[]; folderId?: string }>;

export const readStore = <T,>(key: string, fallback: T): T => { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };
export const writeStore = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };

export const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
