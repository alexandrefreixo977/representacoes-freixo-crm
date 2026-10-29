import { describe, expect, it } from "vitest";
import { applyDiscounts, normalizeQty, parseDiscounts, parseQuickOrder, pickRule, priceFor, splitByManufacturer } from "../src/pricing";
import type { DiscountRule, Product } from "../src/types";

const prod = (id: string, manufacturerId: string, familyId = "f1", packQty = 1): Product => ({
  id, manufacturerId, familyId, reference: id.toUpperCase(), designation: id, salesUnit: "un", packQty, moq: packQty, isNew: false,
});

describe("descontos", () => {
  it("aplica descontos sucessivos", () => {
    expect(applyDiscounts(100, [40, 5])).toBe(57);
    expect(applyDiscounts(100, [])).toBe(100);
  });
  it("lê descontos escritos à mão", () => {
    expect(parseDiscounts("40 + 5%")).toEqual([40, 5]);
    expect(parseDiscounts("2,5")).toEqual([2.5]);
  });
});

describe("escolha da regra", () => {
  const p = prod("a", "m1");
  const rules: DiscountRule[] = [
    { id: "geral-fab", manufacturerId: "m1", discounts: [10] },
    { id: "geral-prod", manufacturerId: "m1", productId: "a", discounts: [20] },
    { id: "cli-fab", clientId: "c1", manufacturerId: "m1", discounts: [30] },
    { id: "cli-fam", clientId: "c1", manufacturerId: "m1", familyId: "f1", discounts: [35] },
    { id: "outro-cli", clientId: "c2", manufacturerId: "m1", productId: "a", discounts: [90] },
    { id: "outro-fab", manufacturerId: "m2", discounts: [50] },
  ];
  it("mais específico primeiro; no mesmo nível, cliente antes de geral", () => {
    expect(pickRule(rules, p, "c1")?.id).toBe("geral-prod");
    expect(pickRule(rules, prod("b", "m1"), "c1")?.id).toBe("cli-fam");
    expect(pickRule(rules, prod("b", "m1", "f9"), "c1")?.id).toBe("cli-fab");
    expect(pickRule([...rules, { id: "cli-prod", clientId: "c1", manufacturerId: "m1", productId: "a", discounts: [5] }], p, "c1")?.id).toBe("cli-prod");
    expect(pickRule(rules, p, "c3")?.id).toBe("geral-prod");
    expect(pickRule(rules, prod("b", "m1"), null)?.id).toBe("geral-fab");
    expect(pickRule(rules, prod("z", "m3"), "c1")).toBeUndefined();
  });
  it("preço especial substitui descontos", () => {
    const pricing = { listPrices: { a: 10 }, rules: [{ id: "x", clientId: "c1", manufacturerId: "m1", productId: "a", discounts: [50], specialNetPrice: 7.5 }] };
    expect(priceFor(p, pricing, "c1")).toEqual({ listPrice: 10, discounts: [], netPrice: 7.5, special: true });
    expect(priceFor(p, pricing, "c2")?.netPrice).toBe(10);
    expect(priceFor(p, null, "c1")).toBeNull();
  });
});

describe("quantidades e carrinho", () => {
  it("arredonda a caixas completas", () => {
    expect(normalizeQty({ packQty: 12, moq: 12 }, 1)).toBe(12);
    expect(normalizeQty({ packQty: 12, moq: 12 }, 13)).toBe(24);
    expect(normalizeQty({ packQty: 1, moq: 5 }, 2)).toBe(5);
  });
  it("divide por fabricante com subtotais", () => {
    const products = [prod("a", "m1"), prod("b", "m2"), prod("c", "m1")];
    const pricing = { listPrices: { a: 10, b: 5, c: 2 }, rules: [{ id: "r", manufacturerId: "m1", discounts: [50] }] };
    const groups = splitByManufacturer([{ productId: "a", qty: 2 }, { productId: "b", qty: 3 }, { productId: "c", qty: 10 }], products, pricing, null);
    expect(groups.map((g) => [g.manufacturerId, g.items.length, g.subtotal])).toEqual([["m1", 2, 20], ["m2", 1, 15]]);
  });
  it("lê a encomenda rápida", () => {
    expect(parseQuickOrder("AT-1 50\nPP-2;12\nTM 3 x4\n\nSOLTA")).toEqual([
      { reference: "AT-1", qty: 50 }, { reference: "PP-2", qty: 12 }, { reference: "TM 3", qty: 4 }, { reference: "SOLTA", qty: 1 },
    ]);
  });
});
