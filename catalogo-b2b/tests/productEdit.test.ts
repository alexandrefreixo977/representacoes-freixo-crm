import { describe, expect, it } from "vitest";
import { demoApi } from "../src/data/demo-api";

describe("gestão de artigos (demonstração)", () => {
  it("edita designação, preço e visibilidade, e cria família nova", async () => {
    await demoApi.signIn("gestao@demo.pt", "demo");
    const { products } = await demoApi.searchProducts({ offset: 0, limit: 1 });
    const p = await demoApi.getProductForEdit(products[0].id);

    const saved = await demoApi.saveProduct({ ...p, designation: "O-ring 1510.28", listPrice: 0.84, active: false, newFamily: "Peças UNIOR" });
    expect(saved.designation).toBe("O-ring 1510.28");

    const again = await demoApi.getProductForEdit(p.id);
    expect(again.listPrice).toBe(0.84);
    expect(again.active).toBe(false);
    const fam = (await demoApi.getCatalog()).families.find((f) => f.id === again.familyId);
    expect(fam?.name).toBe("Peças UNIOR");

    // Inativo: sai da loja, mas a gestão continua a encontrá-lo.
    const shop = await demoApi.searchProducts({ q: "O-ring 1510.28", offset: 0, limit: 10 });
    expect(shop.total).toBe(0);
    const admin = await demoApi.searchProducts({ q: "O-ring 1510.28", includeInactive: true, offset: 0, limit: 10 });
    expect(admin.products.map((x) => x.id)).toEqual([p.id]);
  });

  it("não deixa repetir a referência na mesma marca", async () => {
    await demoApi.signIn("gestao@demo.pt", "demo");
    const { products } = await demoApi.searchProducts({ offset: 0, limit: 2 });
    const [a, b] = products;
    if (a.manufacturerId !== b.manufacturerId) return;
    const edit = await demoApi.getProductForEdit(b.id);
    await expect(demoApi.saveProduct({ ...edit, reference: a.reference })).rejects.toThrow(/Já existe/);
  });
});
