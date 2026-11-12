import test from "node:test";
import assert from "node:assert/strict";
import { describeActivity, summarize, formatMinutes } from "../app/activity-describe.ts";

const base = { id: 1, user_id: "u", session_id: null, module: null, entity_table: null, entity_id: null, label: null, detail: null, created_at: "2026-11-12T10:00:00Z" };
test("frases do registo", () => {
  assert.equal(describeActivity({ ...base, kind: "create", entity_table: "activities", label: "Visita X", detail: { tipo: "Visita", cliente: "Casa Fonseca" } }).text, "Criou visita “Visita X”");
  assert.equal(describeActivity({ ...base, kind: "update", entity_table: "activities", label: "Ligar", detail: { tipo: "task", campos: ["completed_at", "status"], estado: "completed" } }).text, "Concluiu tarefa “Ligar”");
  const edit = describeActivity({ ...base, kind: "update", entity_table: "clients", label: "Casa Fonseca", detail: { campos: ["phone", "email"] } });
  assert.equal(edit.text, "Editou cliente “Casa Fonseca”");
  assert.equal(edit.extra, "Alterou: telefone, email");
  assert.equal(describeActivity({ ...base, kind: "view", entity_table: "clients", entity_id: "c1" }, { clients: new Map([["c1", "Lamarão"]]) }).text, "Abriu a ficha do cliente “Lamarão”");
  assert.equal(describeActivity({ ...base, kind: "action", label: "fonseca", detail: { tipo: "pesquisa" } }).group, "pesquisa");
  assert.equal(describeActivity({ ...base, kind: "create", entity_table: "emails", label: "Proposta" }).text, "Enviou email “Proposta”");
});

test("resumo por utilizador", () => {
  const from = Date.parse("2026-11-12T00:00:00Z"), to = Date.parse("2026-11-13T00:00:00Z"), now = Date.parse("2026-11-12T18:00:00Z");
  const sessions = [
    { id: "a", user_id: "u", started_at: "2026-11-12T09:00:00Z", last_seen_at: "2026-11-12T10:30:00Z", ended_at: "2026-11-12T10:30:00Z", end_reason: "inatividade", device: "Computador" },
    { id: "b", user_id: "u", started_at: "2026-11-12T14:00:00Z", last_seen_at: "2026-11-12T17:59:00Z", ended_at: null, end_reason: null, device: "Telemóvel" },
  ];
  const s = summarize("u", sessions, [{ ...base, kind: "view", module: "Agenda" }, { ...base, kind: "create", entity_table: "clients" }], from, to, now);
  assert.equal(s.entries, 2);
  assert.equal(s.online, true);
  assert.equal(s.firstEntry, "2026-11-12T09:00:00Z");
  assert.equal(s.lastExit, "2026-11-12T10:30:00Z");
  assert.equal(s.activeMinutes, 90 + 239);
  assert.equal(s.created, 1);
  assert.ok(s.modules.has("Agenda"));
  assert.equal(formatMinutes(329), "5 h 29 min");
});
