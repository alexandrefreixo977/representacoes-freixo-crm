// Envio (do lado do browser) da confirmação de visita ao cliente; usado na Agenda, em Visitas e no assistente de voz.
import type { Session } from "@supabase/supabase-js";
import { toast } from "./ui-feedback";
import { recordActivity } from "./activity-tracker";

export const visitConfirmationOpen = (status: string) => ["scheduled", "rescheduled"].includes(status);

// Cada tentativa fica no registo de atividade (Administração › Atividade), para se saber porque um email não saiu.
const logAttempt = (activityId: string, mode: string, ok: boolean, message: string, status?: number) =>
  recordActivity("action", "visitas", ok ? "Confirmação de visita enviada" : "Confirmação de visita não enviada", "activities", activityId, { tipo: "confirmacao_visita", modo: mode, resultado: ok ? "enviado" : "falhou", mensagem: message.slice(0, 300), ...(status ? { http: status } : {}) });

export async function sendVisitConfirmation(session: Pick<Session, "access_token">, activityId: string, mode: "confirm" | "reschedule") {
  let status: number | undefined;
  try {
    const res = await fetch("/api/visits/confirmation", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ activityId, mode }) });
    status = res.status;
    const data = await res.json().catch(() => ({})) as { ok?: boolean; to?: string; warning?: string; reason?: string; error?: string };
    if (res.ok && data.ok) { const msg = data.warning ?? `${mode === "reschedule" ? "Reagendamento" : "Confirmação"} da visita enviado por email a ${data.to}.`; toast(msg); logAttempt(activityId, mode, true, `Para ${data.to}`); return { ok: true as const, message: msg }; }
    const msg = data.reason ?? data.error ?? "Não foi possível enviar a confirmação da visita ao cliente.";
    toast(msg, { tone: "error" }); logAttempt(activityId, mode, false, msg, status); return { ok: false as const, message: msg };
  } catch (error) {
    const msg = "Não foi possível enviar a confirmação da visita ao cliente.";
    toast(msg, { tone: "error" }); logAttempt(activityId, mode, false, `${msg} ${error instanceof Error ? error.message : ""}`.trim(), status); return { ok: false as const, message: msg };
  }
}
