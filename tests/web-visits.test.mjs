import test from "node:test";
import assert from "node:assert/strict";
import { lastDays } from "../app/friendly-date.ts";

test("últimos dias terminam hoje, por ordem", () => {
  const d = lastDays(3, new Date(2026, 10, 1));
  assert.deepEqual(d, ["2026-10-30", "2026-10-31", "2026-11-01"]);
});
