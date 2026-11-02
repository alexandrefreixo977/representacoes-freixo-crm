import { describe, expect, it } from "vitest";
import { clientTerms, effectiveDiscount, ruleText } from "../src/pricing";
import type { DiscountRule } from "../src/types";

describe("validação de encomendas", () => {
  it("calcula o desconto equivalente", () => {
    expect(effectiveDiscount(100, 57)).toBe(43);
    expect(effectiveDiscount(0, 5)).toBe(0);
  });
  const rules: DiscountRule[] = [
    { id: "g", manufacturerId: "m1", discounts: [10] },
    { id: "c", clientId: "c1", manufacturerId: "m1", discounts: [40, 5] },
    { id: "cp", clientId: "c1", manufacturerId: "m1", productId: "p", discounts: [], specialNetPrice: 2 },
    { id: "camp", manufacturerId: "m2", discounts: [30], campaignId: "x" },
  ];
  it("mostra a condição do cliente, ou a geral, ou nenhuma", () => {
    expect(clientTerms(rules, "c1", "m1")).toMatchObject({ source: "client", specific: 1 });
    expect(ruleText(clientTerms(rules, "c1", "m1").rule)).toBe("40% + 5%");
    expect(clientTerms(rules, "c2", "m1")).toMatchObject({ source: "general", specific: 0 });
    expect(clientTerms(rules, "c1", "m2").source).toBeUndefined();
    expect(ruleText(undefined)).toBe("sem desconto");
  });
});
