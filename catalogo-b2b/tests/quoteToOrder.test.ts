import { describe, expect, it } from "vitest";
import { demoApi } from "../src/data/demo-api";

describe("proposta aceite gera encomenda (demonstração)", () => {
  it("cria a encomenda com os preços da proposta e não duplica", async () => {
    await demoApi.signIn("gestao@demo.pt", "demo");
    const { products } = await demoApi.searchProducts({ offset: 0, limit: 50 });
    const p = products.find((x) => !x.sizeType)!;
    const line = { productId: p.id, reference: p.reference, designation: p.designation, salesUnit: p.salesUnit, qty: 4, listPrice: 10, discounts: [30], netPrice: 7, lineTotal: 28 };
    const { id } = await demoApi.saveQuote({ customerName: "Potencial Lda", customerNif: "509999999", status: "sent", total: 0, lines: [line] });
    await expect(demoApi.quoteToOrder(id)).rejects.toThrow(/não está aceite/);

    const q = await demoApi.getQuote(id);
    await demoApi.saveQuote({ ...q, status: "accepted" });
    const res = await demoApi.quoteToOrder(id);
    expect(res.created).toBe(true);
    const order = (await demoApi.listOrders()).find((o) => o.groupNumber === res.groupNumber)!;
    expect(order.lines[0].netPrice).toBe(7);
    expect(order.lines[0].qty).toBe(4);
    expect(order.clientName).toBe("Potencial Lda");
    expect((await demoApi.getQuote(id)).orderGroupNumber).toBe(res.groupNumber);

    const again = await demoApi.quoteToOrder(id);
    expect(again).toMatchObject({ created: false, groupNumber: res.groupNumber });
  });

  it("recusa linhas livres que não estão no catálogo", async () => {
    await demoApi.signIn("gestao@demo.pt", "demo");
    const { id } = await demoApi.saveQuote({
      customerName: "X", status: "accepted", total: 0,
      lines: [{ reference: "NAO-EXISTE", designation: "?", salesUnit: "un", qty: 1, listPrice: 1, discounts: [], netPrice: 1, lineTotal: 1 }],
    });
    await expect(demoApi.quoteToOrder(id)).rejects.toThrow(/NAO-EXISTE/);
  });
});
