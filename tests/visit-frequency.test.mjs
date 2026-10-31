import test from "node:test";
import assert from "node:assert/strict";
import { visitFrequencyDays, visitsDue } from "../app/visit-frequency.ts";

test("converte a frequência em dias", () => {
  assert.equal(visitFrequencyDays("Mensal"), 30);
  assert.equal(visitFrequencyDays("Qinzenal"), 15);
  assert.equal(visitFrequencyDays("trimestral"), 90);
  assert.equal(visitFrequencyDays(""), null);
  assert.equal(visitFrequencyDays("0"), null);
});

test("lista os clientes com visita em atraso", () => {
  const day = 86400000, now = 1000 * day;
  const clients = [
    { id: "a", visitFrequency: "Mensal" },     // última visita há 40 dias → 10 dias de atraso
    { id: "b", visitFrequency: "Mensal" },     // visitado há 10 dias → em dia
    { id: "c", visitFrequency: "Trimestral" }, // nunca visitado
    { id: "d", visitFrequency: "Mensal" },     // atrasado mas já tem visita marcada
    { id: "e" },                                // sem frequência
  ];
  const visits = [
    { clientId: "a", at: now - 40 * day },
    { clientId: "b", at: now - 10 * day },
    { clientId: "d", at: now - 90 * day },
    { clientId: "d", at: now + 2 * day },
  ];
  const due = visitsDue(clients, visits, now);
  assert.deepEqual(due.map((x) => x.clientId), ["c", "a"]);
  assert.equal(due[1].overdueDays, 10);
});
