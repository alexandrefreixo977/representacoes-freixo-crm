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

test("descontos do CRM: fabricantes juntam-se pela 1.ª palavra do nome", async () => {
  const { manufacturerKey, inactiveDiscountStatus } = await import("../app/b2b-link.ts");
  assert.equal(manufacturerKey("Blue-Master"), manufacturerKey("Blue Master"));
  assert.equal(manufacturerKey("RÖNTGEN"), manufacturerKey("Röntgen"));
  assert.equal(manufacturerKey("COFRA"), manufacturerKey("COFRA Vestuário"));
  assert.equal(inactiveDiscountStatus("Inactivo"), true);
  assert.equal(inactiveDiscountStatus("Inativo"), true);
  assert.equal(inactiveDiscountStatus("Ativo"), false);
});

test("descontos do CRM: plano de regras para a loja", async () => {
  const { planCrmDiscounts } = await import("../app/b2b-link.ts");
  const mfrs = [{ id: "acha", name: "ACHA Herramientas" }, { id: "cc", name: "COFRA Calçado" }, { id: "cv", name: "COFRA Vestuário" }, { id: "jsp", name: "JSP Safety" }, { id: "rx", name: "Röntgen" }];
  const shopClients = new Map([["c1", "s1"], ["c2", "s2"]]);
  const terms = [
    { relationId: "r1", crmClientId: "c1", manufacturerName: "ACHA", agreedDiscount: 0.3, status: "Ativo" },
    { relationId: "r2", crmClientId: "c1", manufacturerName: "ACHA Herramientas", agreedDiscount: "0.4000", status: "A preencher" },
    { relationId: "r3", crmClientId: "c1", manufacturerName: "COFRA", agreedDiscount: 0.4475, status: "Activo" },
    { relationId: "r4", crmClientId: "c1", manufacturerName: "JSP Safety", agreedDiscount: 0.4, status: "Inactivo" },
    { relationId: "r5", crmClientId: "c1", manufacturerName: "Dogher Tools", agreedDiscount: 0.55, status: "Ativo" },
    { relationId: "r6", crmClientId: "c9", manufacturerName: "ACHA Herramientas", agreedDiscount: 0.4, status: "Ativo" },
    { relationId: "r7", crmClientId: "c2", manufacturerName: "RÖNTGEN", agreedDiscount: 0.73, status: "Ativo" },
  ];
  const rules = [
    { id: "old-jsp", client_id: "s1", manufacturer_id: "jsp", discounts: [40], source: "crm", family_id: null, product_id: null, crm_relation_id: "r4" },
    { id: "rx-crm", client_id: "s2", manufacturer_id: "rx", discounts: [70], source: "crm", family_id: null, product_id: null, crm_relation_id: "r7" },
    { id: "rx-manual", client_id: "s2", manufacturer_id: "rx", discounts: [75], source: null, family_id: null, product_id: null },
  ];
  const plan = planCrmDiscounts(terms, shopClients, mfrs, rules);
  const ins = Object.fromEntries(plan.insert.map(r => [`${r.client_id}|${r.manufacturer_id}`, r.discounts[0]]));
  assert.deepEqual(ins, { "s1|acha": 40, "s1|cc": 44.75, "s1|cv": 44.75 });
  assert.deepEqual(plan.update, [{ id: "rx-crm", discounts: [73], crm_relation_id: "r7" }]);
  assert.deepEqual(plan.remove, ["old-jsp"]);
  assert.deepEqual(plan.conflicts, [{ client_id: "s2", manufacturer_id: "rx", crm: 73, shop: [75] }]);
  assert.deepEqual(plan.unmatched, ["Dogher Tools"]);
  // Já sincronizado → nada a fazer.
  const again = planCrmDiscounts(terms, shopClients, mfrs, [...plan.insert.map((r, i) => ({ ...r, id: `n${i}`, family_id: null, product_id: null })), { ...rules[1], discounts: [73] }, rules[2]]);
  assert.equal(again.insert.length + again.update.length + again.remove.length, 0);
});
