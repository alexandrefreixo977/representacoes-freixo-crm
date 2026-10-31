import { describe, expect, it } from "vitest";
import { applyDiscounts, lengthMm, needsVariant, normalizeQty, parseDiscounts, parseQuickOrder, pickRule, priceFor, sizesFor, splitByManufacturer } from "../src/pricing";
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
  it("preço de campanha indica a campanha", () => {
    const pricing = { listPrices: { a: 10 }, rules: [{ id: "x", manufacturerId: "m1", productId: "a", discounts: [], specialNetPrice: 6, campaignId: "camp", offerQty: 4 }] };
    expect(priceFor(p, pricing, "c1")).toEqual({ listPrice: 10, discounts: [], netPrice: 6, special: true, campaignId: "camp", offerQty: 4 });
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

describe("fita à medida", () => {
  const fita: Product = { ...prod("fita", "m1"), sizeType: "medida", salesUnit: "m" };
  const pricing = { listPrices: { fita: 21.42 }, weldPrices: { fita: 8.15 }, rules: [{ id: "r", manufacturerId: "m1", discounts: [10] }] as DiscountRule[] };
  it("preço por fita = metros x preço/m + soldadura, depois o desconto", () => {
    // 2,45 m x 21,42 + 8,15 = 60,629 -> -10% = 54,5661
    const p = priceFor(fita, pricing, null, "2450")!;
    expect(p.listPrice).toBeCloseTo(60.629, 4);
    expect(p.netPrice).toBeCloseTo(54.5661, 4);
  });
  it("sem comprimento mostra o preço por metro", () => {
    expect(priceFor(fita, pricing, null)!.listPrice).toBe(21.42);
  });
  it("só aceita comprimentos válidos em mm", () => {
    expect(lengthMm("2450")).toBe(2450);
    expect(lengthMm("2,45")).toBeNull();
    expect(lengthMm("50")).toBeNull();
    expect(needsVariant(fita, "")).toBe(true);
    expect(needsVariant(fita, "3160")).toBe(false);
  });
  it("o carrinho calcula cada comprimento à parte", () => {
    const groups = splitByManufacturer([{ productId: "fita", qty: 2, variant: "2450" }, { productId: "fita", qty: 1, variant: "3160" }], [fita], pricing, null);
    expect(groups[0].items.map((i) => i.total)).toEqual([109.13, 68.25]);
  });
});

describe("tamanhos sugeridos", () => {
  const base = { id: "v", manufacturerId: "m", reference: "R", salesUnit: "un", packQty: 1, moq: 1, isNew: false } as Product;
  it("usa a faixa escrita na designação", () => {
    expect(sizesFor({ ...base, sizeType: "vestuario", designation: "Calças · Tam. 38 a 46" })).toEqual(["38", "40", "42", "44", "46"]);
    expect(sizesFor({ ...base, sizeType: "vestuario", designation: "Polo · Tam. S a XL" })).toEqual(["S", "M", "L", "XL"]);
    expect(sizesFor({ ...base, sizeType: "vestuario", designation: "Polo · Tam. 4XL e 5XL" })).toEqual(["4XL", "5XL"]);
    expect(sizesFor({ ...base, sizeType: "vestuario", designation: "Polo" })).toContain("XXL");
  });
});
