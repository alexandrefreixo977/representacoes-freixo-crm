import type { PriceImportRow } from "./types";

/** Nomes de coluna habituais nas tabelas dos fabricantes (PT, EN, ES). */
const HEADERS: Record<keyof PriceImportRow, string[]> = {
  // EAN primeiro, para "Cód. barras" não ser confundido com a referência.
  ean: ["ean", "ean13", "codigo barras", "cod barras", "barcode", "gtin"],
  reference: ["referencia", "ref", "codigo", "cod", "artigo", "reference", "code", "item", "sku", "part number", "codigo articulo"],
  designation: ["designacao", "descricao", "description", "designation", "nome", "produto", "descripcion", "denominacion"],
  listPrice: ["preco", "pvp", "preco tabela", "preco de tabela", "pv", "price", "list price", "precio", "precio tarifa", "tarifa", "eur"],
  salesUnit: ["unidade", "un", "unid", "unit", "uom", "unidad"],
  packQty: ["embalagem", "emb", "cx", "caixa", "qtd caixa", "qtd emb", "pack", "box", "packaging", "embalaje", "unidades caixa"],
  family: ["familia", "categoria", "family", "category", "gama", "subfamilia"],
};

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export type ColumnMap = Partial<Record<keyof PriceImportRow, number>>;

/** Procura a linha de cabeçalho (nas primeiras 15) e devolve que coluna corresponde a cada campo. */
export function detectColumns(rows: unknown[][]): { headerRow: number; map: ColumnMap } {
  let best = { headerRow: 0, map: {} as ColumnMap, hits: 0 };
  rows.slice(0, 15).forEach((row, rowIndex) => {
    const map: ColumnMap = {};
    row.forEach((cell, col) => {
      const value = norm(cell);
      if (!value) return;
      for (const [field, names] of Object.entries(HEADERS) as [keyof PriceImportRow, string[]][]) {
        if (map[field] !== undefined) continue;
        if (names.some((n) => value === n || value.startsWith(n + " "))) {
          map[field] = col;
          break;
        }
      }
    });
    const hits = Object.keys(map).length;
    if (hits > best.hits) best = { headerRow: rowIndex, map, hits };
  });
  return { headerRow: best.headerRow, map: best.map };
}

/** Converte "1.234,56 €", "1234.56" ou 1234.56 em número. */
export function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  let s = String(value ?? "").replace(/[^\d,.-]/g, "");
  if (!s) return undefined;
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function mapRows(rows: unknown[][], map: ColumnMap, headerRow: number): PriceImportRow[] {
  const get = (row: unknown[], field: keyof PriceImportRow) => (map[field] === undefined ? undefined : row[map[field]!]);
  const out: PriceImportRow[] = [];
  for (const row of rows.slice(headerRow + 1)) {
    const reference = String(get(row, "reference") ?? "").trim();
    if (!reference) continue;
    const text = (f: keyof PriceImportRow) => {
      const v = get(row, f);
      return v == null || v === "" ? undefined : String(v).trim();
    };
    const pack = parseNumber(get(row, "packQty"));
    out.push({
      reference,
      designation: text("designation"),
      listPrice: parseNumber(get(row, "listPrice")),
      salesUnit: text("salesUnit"),
      packQty: pack && pack > 0 ? pack : undefined,
      family: text("family"),
      ean: text("ean"),
    });
  }
  return out;
}

/** Lê .xlsx ou .csv no browser e devolve as linhas em bruto. */
export async function readSpreadsheet(file: File): Promise<unknown[][]> {
  if (/\.csv$/i.test(file.name)) {
    const text = await file.text();
    const sep = (text.split("\n")[0].match(/;/g)?.length ?? 0) >= (text.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
    return text.split(/\r?\n/).map((line) => line.split(sep).map((c) => c.replace(/^"|"$/g, "")));
  }
  const { readSheet } = await import("read-excel-file/browser");
  return (await readSheet(file)) as unknown[][];
}
