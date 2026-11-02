import test from "node:test";
import assert from "node:assert/strict";
import { daysFromToday, friendlyDay, timeAgo } from "../app/friendly-date.ts";

const now = new Date("2026-10-31T10:00:00");
test("dias próximos com nome", () => {
  assert.equal(friendlyDay("2026-10-31", now), "Hoje");
  assert.equal(friendlyDay("2026-11-01", now), "Amanhã");
  assert.equal(friendlyDay("2026-10-30", now), "Ontem");
  assert.equal(friendlyDay("2026-10-15", now), "15 out");
  assert.equal(friendlyDay("2025-03-02", now), "2 mar 2025");
  assert.equal(friendlyDay("", now), "—");
});
test("há quanto tempo", () => {
  assert.equal(timeAgo("2026-10-19T09:00:00", now), "há 12 dias");
  assert.equal(timeAgo("2026-07-31T09:00:00", now), "há 3 meses");
  assert.equal(daysFromToday("2026-11-03", now), 3);
});
