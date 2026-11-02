import test from "node:test";
import assert from "node:assert/strict";
import { followUpDate, normalizeNif, stageForQuote } from "../app/b2b-link.ts";

test("NIF compara com e sem prefixo e espaços", () => {
  assert.equal(normalizeNif("PT 501 234 567"), "501234567");
  assert.equal(normalizeNif("501.234.567"), "501234567");
  assert.equal(normalizeNif(null), "");
});

test("estado da proposta define a fase da oportunidade", () => {
  assert.equal(stageForQuote("sent"), "Proposta enviada");
  assert.equal(stageForQuote("accepted"), "Ganha");
  assert.equal(stageForQuote("lost"), "Perdida");
  assert.equal(stageForQuote("draft"), null);
});

test("follow-up 7 dias depois, nunca no passado", () => {
  const now = new Date("2026-11-01T10:00:00Z");
  assert.equal(followUpDate("2026-10-30T10:00:00Z", now), "2026-11-06");
  assert.equal(followUpDate("2026-09-01T10:00:00Z", now), "2026-11-01");
});
