import { describe, expect, it } from "vitest";
import { detectColumns, mapRows, parseNumber } from "../src/importer";

describe("importação de tabelas Excel", () => {
  const sheet = [
    ["Tabela de preços 2026", null, null, null, null],
    [],
    ["Código", "Descrição", "Cód. Barras", "Emb.", "PVP 2026 (€)"],
    ["AB-1", "Disco 115", "5600000000001", 25, "1,10 €"],
    ["AB-2", "Disco 125", "", "25", 1.25],
    ["", "linha vazia", "", "", ""],
  ];
  it("encontra o cabeçalho e as colunas", () => {
    const { headerRow, map } = detectColumns(sheet);
    expect(headerRow).toBe(2);
    expect(map).toMatchObject({ reference: 0, designation: 1, ean: 2, packQty: 3, listPrice: 4 });
  });
  it("converte as linhas", () => {
    const { headerRow, map } = detectColumns(sheet);
    const rows = mapRows(sheet, map, headerRow);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ reference: "AB-1", listPrice: 1.1, packQty: 25, ean: "5600000000001" });
    expect(rows[1].listPrice).toBe(1.25);
  });
  it("lê números em formato português e inglês", () => {
    expect(parseNumber("1.234,56 €")).toBe(1234.56);
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("")).toBeUndefined();
  });
});
