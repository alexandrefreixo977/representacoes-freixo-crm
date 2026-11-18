// Envio (do lado do browser) da confirmação de visita ao cliente; usado na Agenda, em Visitas e no assistente de voz.
import type { Session } from "@supabase/supabase-js";
import { toast } from "./ui-feedback";

export const visitConfirmationOpen = (status: string) => ["scheduled", "rescheduled"].includes(status);

export async function sendVisitConfirmation(session: Pick<Session, "access_token">, activityId: string, mode: "confirm" | "reschedule") {
  try {
    const res = await fetch("/api/visits/confirmation", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ activityId, mode }) });
    const data = await res.json().catch(() => ({})) as { ok?: boolean; to?: string; warning?: string; reason?: string; error?: string };
    if (res.ok && data.ok) { const msg = data.warning ?? `${mode === "reschedule" ? "Reagendamento" : "Confirmação"} da visita enviado por email a ${data.to}.`; toast(msg); return { ok: true as const, message: msg }; }
    const msg = data.reason ?? data.error ?? "Não foi possível enviar a confirmação da visita ao cliente.";
    toast(msg, { tone: "error" }); return { ok: false as const, message: msg };
  } catch {
    const msg = "Não foi possível enviar a confirmação da visita ao cliente.";
    toast(msg, { tone: "error" }); return { ok: false as const, message: msg };
  }
}
