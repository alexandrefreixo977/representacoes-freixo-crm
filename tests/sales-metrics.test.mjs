import test from "node:test";
import assert from "node:assert/strict";
import { periodRange, delta, deltaPoints, crmMetrics, compactMoney } from "../app/sales-metrics.ts";

const now = new Date(2026, 10, 18, 10); // quarta 18 nov 2026

test("mês até hoje compara com os mesmos dias do mês anterior", () => {
  const r = periodRange("month", now);
  assert.deepEqual([r.from, r.to, r.prevFrom, r.prevTo], ["2026-11-01", "2026-11-19", "2026-10-01", "2026-10-19"]);
});
test("semana começa à segunda", () => {
  const r = periodRange("week", now);
  assert.deepEqual([r.from, r.to, r.prevFrom, r.prevTo], ["2026-11-16", "2026-11-19", "2026-11-09", "2026-11-12"]);
});
test("ano compara com o ano anterior até à mesma data", () => {
  const r = periodRange("year", now);
  assert.deepEqual([r.from, r.prevFrom, r.prevTo], ["2026-01-01", "2025-01-01", "2025-11-19"]);
});
test("trimestre anterior não ultrapassa o início do atual", () => {
  const r = periodRange("quarter", new Date(2026, 11, 31, 10));
  assert.equal(r.from, "2026-10-01");
  assert.equal(r.prevFrom, "2026-07-01");
  assert.ok(r.prevTo <= r.from);
});
test("variações", () => {
  assert.deepEqual(delta(120, 100), { text: "+20%", tone: "up" });
  assert.deepEqual(delta(80, 100), { text: "−20%", tone: "down" });
  assert.deepEqual(delta(5, 0), { text: "novo", tone: "new" });
  assert.deepEqual(delta(0, 0), { text: "=", tone: "flat" });
  assert.equal(delta(3, 5, true).tone, "up");
  assert.deepEqual(deltaPoints(0.55, 0.4), { text: "+15 pp", tone: "up" });
});
test("valores compactos", () => {
  assert.equal(compactMoney(950), "950 €");
  assert.equal(compactMoney(12500), "12,5 mil €");
});

const opp = (o) => ({ id: "x", title: "t", client: "C", clientId: "c1", sellerId: "u1", stage: "Qualificado", stagePosition: 2, probability: 25, value: 1000, finalValue: null, outcome: "active", createdAt: "2026-11-02T10:00:00Z", closedAt: null, expectedClose: null, lastActivityAt: "2026-11-17T10:00:00Z", updatedAt: "2026-11-17T10:00:00Z", lossReason: null, manufacturer: null, ...o });

test("pipeline, ganhas, conversão e equipa", () => {
  const m = crmMetrics({
    now, owner: "all", range: periodRange("month", now),
    profiles: [{ id: "u1", name: "Lúcia", role: "commercial" }, { id: "u2", name: "Tina", role: "admin" }],
    opportunities: [
      opp({ id: "a", value: 1000, probability: 40, expectedClose: "2026-12-10" }),
      opp({ id: "b", value: 2000, probability: 80, sellerId: "u2", lastActivityAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z" }),
      opp({ id: "c", outcome: "won", stage: "Ganha", value: 500, finalValue: 600, closedAt: "2026-11-10T10:00:00Z" }),
      opp({ id: "d", outcome: "lost", stage: "Perdida", lossReason: "Preço", closedAt: "2026-11-11T10:00:00Z" }),
      opp({ id: "e", outcome: "won", stage: "Ganha", value: 300, closedAt: "2026-10-05T10:00:00Z" }),
    ],
    activities: [
      { kind: "visit", status: "completed", at: "2026-11-03T10:00:00Z", userId: "u1", clientId: "c1" },
      { kind: "visit", status: "scheduled", at: "2026-11-25T10:00:00Z", userId: "u1", clientId: "c2" },
      { kind: "visit", status: "cancelled", at: "2026-11-04T10:00:00Z", userId: "u1", clientId: "c3" },
      { kind: "call", status: "completed", at: "2026-10-03T10:00:00Z", userId: "u2", clientId: "c1" },
    ],
    proposals: [{ status: "accepted", total: 600, sentAt: "2026-11-05T10:00:00Z", acceptedAt: "2026-11-09T10:00:00Z", sellerId: "u1" }],
  });
  assert.equal(m.pipeline.count, 2);
  assert.equal(m.pipeline.value, 3000);
  assert.equal(m.pipeline.weighted, 400 + 1600);
  assert.equal(m.pipeline.stale, 1);
  assert.equal(m.current.won, 1);
  assert.equal(m.current.wonValue, 600);
  assert.equal(m.current.conversion, 0.5);
  assert.deepEqual(m.current.lossReasons, [["Preço", 1]]);
  assert.equal(m.previous.won, 1);
  assert.equal(m.current.visits, 1, "só visitas realizadas, sem futuras nem canceladas");
  assert.equal(m.previous.calls, 1);
  assert.equal(m.current.proposalsAccepted, 1);
  assert.equal(m.forecast.months[1].weighted, 400);
  assert.equal(m.forecast.noDate, 1);
  assert.equal(m.team[0].name, "Lúcia");
  assert.equal(m.team.find((t) => t.name === "Tina").stale, 1);
});
test("filtro por comercial", () => {
  const m = crmMetrics({ now, owner: "u2", range: periodRange("month", now), profiles: [{ id: "u1", name: "L", role: "commercial" }, { id: "u2", name: "T", role: "admin" }],
    opportunities: [opp({}), opp({ sellerId: "u2", value: 7 })], activities: [], proposals: [] });
  assert.equal(m.pipeline.value, 7);
  assert.equal(m.team.length, 1);
});
