import test from "node:test";
import assert from "node:assert/strict";
import { buildVisitConfirmation, visitRecipient, clientAddress, publicVisitType, visitWhen } from "../app/visit-confirmation.ts";

const base = { mode: "confirm", clientName: "Ferragens <Lamarão>", contactName: "Ana Sousa", startAt: "2026-11-20T09:30:00Z", endAt: "2026-11-20T10:30:00Z", timezone: "Europe/Lisbon", visitType: "Visita técnica", address: "Rua A, 4900-000 Viana do Castelo", commercialName: "Alexandre Freixo", commercialEmail: "comercial@example.com", commercialPhone: "+351 900 000 000", activityId: "abc" };

test("data e hora no fuso do cliente", () => {
  const w = visitWhen(base.startAt, base.endAt, "Europe/Lisbon");
  assert.equal(w.date, "Sexta-feira, 20 de novembro de 2026");
  assert.equal(w.time, "09:30 – 10:30");
  assert.equal(visitWhen("2026-07-01T08:00:00Z", null, "Europe/Lisbon").time, "09:00");
});

test("email de confirmação", () => {
  const m = buildVisitConfirmation(base);
  assert.match(m.subject, /^Confirmação de visita · sexta-feira, 20 de novembro de 2026, 09:30/);
  assert.match(m.html, /Olá Ana,/);
  assert.match(m.html, /Ferragens &lt;Lamarão&gt;/);
  assert.match(m.html, /Visita técnica/);
  assert.match(m.text, /Local: Rua A, 4900-000 Viana do Castelo/);
  assert.match(m.ics, /UID:visita-abc@representacoesfreixo.com/);
  assert.match(m.ics, /DTSTART:20261120T093000Z/);
  assert.match(m.ics, /SEQUENCE:0/);
});

test("reagendamento e notas internas", () => {
  const m = buildVisitConfirmation({ ...base, mode: "reschedule", visitType: "Cobrar fatura em atraso", contactName: "" });
  assert.match(m.subject, /^Visita reagendada/);
  assert.match(m.html, /Caro\(a\) Cliente,/);
  assert.doesNotMatch(m.html, /Cobrar/);
  assert.equal(publicVisitType("demonstração"), "Demonstração");
  assert.doesNotMatch(m.ics, /SEQUENCE:0\r/);
});

test("destinatário e morada", () => {
  const contacts = [{ email: "a@x.pt", is_primary: false, first_name: "A" }, { email: "b@x.pt", is_primary: true, first_name: "Bruno", last_name: "Lima" }];
  assert.deepEqual(visitRecipient({ email: "c@x.pt", first_name: "Carla" }, contacts, "geral@x.pt"), { email: "c@x.pt", name: "Carla" });
  assert.deepEqual(visitRecipient(null, contacts, "geral@x.pt"), { email: "b@x.pt", name: "Bruno Lima" });
  assert.deepEqual(visitRecipient(null, [contacts[0], { ...contacts[0], email: "d@x.pt" }], "geral@x.pt"), { email: "geral@x.pt", name: "" });
  assert.equal(visitRecipient({ email: "" }, [], "sem-email"), null);
  assert.equal(clientAddress({ address: "Rua A", postal_code: "4900-000", city: "Viana" }), "Rua A, 4900-000 Viana");
});
