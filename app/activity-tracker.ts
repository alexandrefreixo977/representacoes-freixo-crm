"use client";
// Registo de atividade: entradas/saídas (sessões) e navegação no CRM.
// As alterações de dados são registadas pela própria base de dados (gatilhos em 014-registo-atividade.sql).
import { useEffect, useRef } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

const PING_EVERY = 60_000; // um sinal por minuto enquanto a pessoa está a usar o CRM
const IDLE_AFTER = 5 * 60_000; // sem toques/teclas/scroll há 5 minutos = parada (não conta como tempo ativo)

const storageKey = (uid: string) => `crm-activity-session:${uid}`;
const readStored = (uid: string) => { try { return window.localStorage.getItem(storageKey(uid)); } catch { return null; } };
const store = (uid: string, id: string | null) => { try { if (id) window.localStorage.setItem(storageKey(uid), id); else window.localStorage.removeItem(storageKey(uid)); } catch { /* sem armazenamento local */ } };

export function deviceLabel(ua: string, standalone = false) {
  const kind = /iPad|Tablet/i.test(ua) ? "Tablet" : /Mobi|Android|iPhone/i.test(ua) ? "Telemóvel" : "Computador";
  return standalone ? `${kind} (app)` : kind;
}

export function recordActivity(kind: "view" | "action", module: string, label?: string | null, entityTable?: string | null, entityId?: string | null, detail?: Record<string, unknown> | null) {
  void supabase.rpc("crm_activity_record", {
    p_kind: kind, p_module: module, p_label: label ?? null, p_entity_table: entityTable ?? null, p_entity_id: entityId ?? null, p_detail: detail ?? null,
  }).then(() => undefined, () => undefined);
}

/** Termina a sessão de atividade (chamar antes de terminar sessão no CRM). */
export async function endActivitySession(uid: string | undefined) {
  if (!uid) return;
  const sid = readStored(uid);
  store(uid, null);
  try { await supabase.rpc("crm_activity_end", { p_session: sid }); } catch { /* o fecho por inatividade cobre falhas */ }
}

export function useActivityTracker(session: Session | null, enabled: boolean) {
  const lastInteraction = useRef(Date.now());
  const uid = enabled ? session?.user.id : undefined;
  useEffect(() => {
    if (!uid) return;
    let stopped = false;
    const ua = navigator.userAgent;
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
    const ping = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const { data, error } = await supabase.rpc("crm_activity_ping", { p_session: readStored(uid), p_device: deviceLabel(ua, standalone), p_user_agent: ua.slice(0, 300) });
      if (!error && typeof data === "string") store(uid, data);
    };
    const touch = () => { const idle = Date.now() - lastInteraction.current > IDLE_AFTER; lastInteraction.current = Date.now(); if (idle) void ping(); };
    const timer = window.setInterval(() => { if (Date.now() - lastInteraction.current < IDLE_AFTER) void ping(); }, PING_EVERY);
    const onVisible = () => { if (document.visibilityState === "visible") { lastInteraction.current = Date.now(); void ping(); } };
    const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    events.forEach(e => window.addEventListener(e, touch, { passive: true }));
    document.addEventListener("visibilitychange", onVisible);
    lastInteraction.current = Date.now();
    void ping();
    return () => {
      stopped = true; window.clearInterval(timer);
      events.forEach(e => window.removeEventListener(e, touch));
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [uid]);
}
