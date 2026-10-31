import { describe, expect, it } from "vitest";
import { findDates, parseCampaignPdf, parseCampaignSheet, type PdfText } from "../src/campaignImport";

describe("importar campanha", () => {
  it("lê as colunas de um Excel de campanha", () => {
    const sheet = [
      [null, null, "PROMOCION ESPECIAL 2026-27   Precios validos hasta 26 de febrero 2027"],
      [],
      ["Código/SKU", "DESCRIPCION", "P.V.P. 2026-27", "NETO PROMOCION DISTRIBUIDOR", "Tarifa aduanera", "Codigo EAN", "Link Fotografia Artículo"],
      [600061, "Llave fija 6 x 7", 4.43, 1.99, 82041100, 3838909000619, "https://x.com/a.jpg"],
      [600064, "Llave fija 8 x 9", "4,56", "2,05", 82041100, 3838909000640, "https://x.com/b.jpg"],
    ];
    const r = parseCampaignSheet(sheet);
    expect(r.title).toBe("PROMOCION ESPECIAL 2026-27");
    expect(r.endsOn).toBe("2027-02-26");
    expect(r.rows).toEqual([
      { reference: "600061", designation: "Llave fija 6 x 7", listPrice: 4.43, netPrice: 1.99, offerQty: undefined, imageUrl: "https://x.com/a.jpg", ean: "3838909000619" },
      { reference: "600064", designation: "Llave fija 8 x 9", listPrice: 4.56, netPrice: 2.05, offerQty: undefined, imageUrl: "https://x.com/b.jpg", ean: "3838909000640" },
    ]);
  });
  it("encontra o início e o fim da promoção", () => {
    expect(findDates("Promoción válida del 1 de Octubre 2026 al 31 de Enero 2027")).toEqual({ startsOn: "2026-10-01", endsOn: "2027-01-31" });
    expect(findDates("válida até 15/03/2027")).toEqual({ startsOn: undefined, endsOn: "2027-03-15" });
  });
  it("lê referências e preços netos de um PDF", () => {
    const line = (...w: [string, number][]) => ({ page: 1, words: w.map(([s, x]) => ({ s, x })) });
    const pdf: PdfText = {
      text: "",
      lines: [
        line(["OFERTA", 10], ["2026", 60]),
        line(["29092D", 10], ["8", 60], ["m", 70], ["x", 80], ["25", 90], ["mm", 100], ["4", 140], ["15,31", 170], ["€", 200], ["29201D", 300], ["5", 350], ["m", 360], ["8", 400], ["10,92", 430], ["€", 460]),
        line(["XP540", 10], ["Vitrina", 60], ["1", 140], ["1348,74", 170], ["€", 200]),
        line(["50322", 10], ["UDS.", 60], ["54332", 300]),
        line(["49,89€", 12], ["1", 50], ["10,19€", 302]),
      ],
    };
    const known = new Set(["29092D", "29201D", "50322", "54332"]);
    const r = parseCampaignPdf(pdf, (t) => known.has(t));
    expect(r.rows).toEqual([
      { reference: "29092D", netPrice: 15.31, offerQty: 4, designation: undefined },
      { reference: "29201D", netPrice: 10.92, offerQty: 8, designation: undefined },
      { reference: "XP540", netPrice: 1348.74, offerQty: 1, designation: "Vitrina" },
      { reference: "50322", netPrice: 49.89, offerQty: 1 },
      { reference: "54332", netPrice: 10.19, offerQty: undefined },
    ]);
  });
});
