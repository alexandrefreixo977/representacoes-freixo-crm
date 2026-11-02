import { describe, expect, it } from "vitest";
import { demoApi } from "../src/data/demo-api";

describe("encomenda em nome de cliente (demonstração)", () => {
  it("a gestão encomenda para um cliente escolhido na pesquisa do CRM", async () => {
    await demoApi.signIn("gestao@demo.pt", "demo");
    const [hit] = await demoApi.searchCrmClients("");
    const client = await demoApi.clientFromCrm(hit.crmId);
    const { products } = await demoApi.searchProducts({ offset: 0, limit: 20 });
    const p = products.find((x) => !x.sizeType)!;
    const res = await demoApi.submitOrder([{ productId: p.id, qty: 1 }], "REF-1", "", { clientId: client.id, notifyClient: false });
    expect(res.orders[0].clientId).toBe(client.id);
    expect(res.orders[0].clientName).toBe(client.name);
  });

  it("um cliente não pode encomendar em nome de outro", async () => {
    await demoApi.signIn("cliente@demo.pt", "demo");
    const { products } = await demoApi.searchProducts({ offset: 0, limit: 20 });
    const p = products.find((x) => !x.sizeType)!;
    await expect(demoApi.submitOrder([{ productId: p.id, qty: 1 }], "", "", { clientId: "outro", notifyClient: false })).rejects.toThrow(/equipa Freixo/);
  });
});
