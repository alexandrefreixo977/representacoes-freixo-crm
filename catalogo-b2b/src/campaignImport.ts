import { parseNumber } from "./importer";

/** Uma linha de campanha lida do ficheiro do fabricante. */
export type CampaignImportRow = {
  reference: string;
  designation?: string;
  listPrice?: number;
  netPrice?: number;
  offerQty?: number;
  imageUrl?: string;
  ean?: string;
};

export type CampaignFile = {
  rows: CampaignImportRow[];
  /** Título encontrado no topo do ficheiro (ex. "PROMOCION ESPECIAL 2026-27"). */
  title?: string;
  startsOn?: string;
  endsOn?: string;
};

const squash = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

type Field = "reference" | "designation" | "listPrice" | "netPrice" | "offerQty" | "ean";

/** Palavras dos cabeçalhos (PT, ES, EN, sem espaços nem acentos). A ordem conta: EAN e neto antes de código e preço. */
const HEADERS: [Field, string[], string[]?][] = [
  ["ean", ["ean", "codigoean", "codean", "ean13", "codigobarras", "codbarras", "barcode", "gtin"]],
  ["netPrice", ["neto", "liquido", "netprice", "net", "promocion", "promocao", "precopromo", "campanha", "oferta"]],
  ["reference", ["codigo", "cod", "sku", "referencia", "ref", "artigo", "articulo", "code", "item"], ["aduan"]],
  ["designation", ["descripcion", "descricao", "designacao", "description", "denominacion", "nome", "modelo", "produto", "producto"]],
  ["listPrice", ["pvp", "tarifa", "precio", "preco", "price", "pv"], ["aduan"]],
  ["offerQty", ["uds", "unidades", "cantidad", "quantidade", "qtd", "qty", "minimo", "lote"]],
];

const IMAGE_URL = /^https?:\/\/\S+\.(jpe?g|png|webp|gif)(\?\S*)?$/i;

/** Lê uma folha de cálculo de campanha: deteta o cabeçalho, as colunas (incluindo a das fotos) e as datas. */
export function parseCampaignSheet(sheet: unknown[][]): CampaignFile {
  let header = { row: -1, map: {} as Partial<Record<Field, number>>, hits: 0 };
  sheet.slice(0, 20).forEach((row, rowIndex) => {
    const map: Partial<Record<Field, number>> = {};
    row.forEach((cell, col) => {
      const v = squash(cell);
      if (!v || v.length > 40) return;
      for (const [field, words, not] of HEADERS) {
        if (map[field] !== undefined || not?.some((w) => v.includes(w))) continue;
        if (words.some((w) => v === w || v.startsWith(w) || (w.length > 3 && v.includes(w)))) {
          map[field] = col;
          return;
        }
      }
    });
    const hits = Object.keys(map).length;
    if (map.reference !== undefined && hits > header.hits) header = { row: rowIndex, map, hits };
  });
  if (header.row < 0) return { rows: [], ...datesAndTitle(sheet.slice(0, 5).flat().join(" ")) };

  const body = sheet.slice(header.row + 1);
  // Coluna das fotos: a que tem mais endereços de imagem.
  let imageCol: number | undefined;
  let best = 0;
  const width = Math.max(...body.slice(0, 50).map((r) => r.length), 0);
  for (let col = 0; col < width; col++) {
    const n = body.slice(0, 50).filter((r) => IMAGE_URL.test(String(r[col] ?? "").trim())).length;
    if (n > best) [best, imageCol] = [n, col];
  }

  const m = header.map;
  const get = (row: unknown[], col?: number) => (col === undefined ? undefined : row[col]);
  const rows: CampaignImportRow[] = [];
  for (const row of body) {
    const reference = String(get(row, m.reference) ?? "").trim();
    if (!reference) continue;
    const net = parseNumber(get(row, m.netPrice));
    const list = parseNumber(get(row, m.listPrice));
    const qty = parseNumber(get(row, m.offerQty));
    const text = (v: unknown) => (v == null || v === "" ? undefined : String(v).trim());
    rows.push({
      reference,
      designation: text(get(row, m.designation)),
      listPrice: list,
      // Sem coluna de neto, o preço que houver é o da campanha.
      netPrice: m.netPrice !== undefined ? net : list,
      offerQty: qty && qty > 0 && Number.isInteger(qty) ? qty : undefined,
      imageUrl: imageCol !== undefined && IMAGE_URL.test(String(row[imageCol] ?? "").trim()) ? String(row[imageCol]).trim() : undefined,
      ean: text(get(row, m.ean)),
    });
  }
  return { rows, ...datesAndTitle(sheet.slice(0, header.row).flat().filter(Boolean).join(" ")) };
}

const MONTHS: Record<string, number> = {
  enero: 1, janeiro: 1, january: 1, febrero: 2, fevereiro: 2, february: 2, marzo: 3, marco: 3, march: 3, abril: 4, april: 4,
  mayo: 5, maio: 5, may: 5, junio: 6, junho: 6, june: 6, julio: 7, julho: 7, july: 7, agosto: 8, august: 8,
  septiembre: 9, setiembre: 9, setembro: 9, september: 9, octubre: 10, outubro: 10, october: 10,
  noviembre: 11, novembro: 11, november: 11, diciembre: 12, dezembro: 12, december: 12,
};

const iso = (y: number, mo: number, d: number) => `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Datas no texto ("del 1 de Octubre 2026 al 31 de Enero 2027", "hasta 26/02/2027"): a primeira é o início, a última o fim. */
export function findDates(text: string): { startsOn?: string; endsOn?: string } {
  const plain = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const found: { at: number; date: string }[] = [];
  for (const m of plain.matchAll(/(\d{1,2})\s*(?:de\s+)?([a-z]+)\s*(?:de\s+)?(\d{4})/g)) {
    const mo = MONTHS[m[2]];
    if (mo) found.push({ at: m.index ?? 0, date: iso(+m[3], mo, +m[1]) });
  }
  for (const m of plain.matchAll(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/g)) {
    if (+m[2] >= 1 && +m[2] <= 12) found.push({ at: m.index ?? 0, date: iso(+m[3], +m[2], +m[1]) });
  }
  found.sort((a, b) => a.at - b.at);
  if (!found.length) return {};
  const onlyEnd = found.length === 1 && /hasta|ate|until|valid/.test(plain.slice(0, found[0].at));
  return { startsOn: found.length > 1 ? found[0].date : undefined, endsOn: onlyEnd || found.length > 1 ? found[found.length - 1].date : found[0].date };
}

function datesAndTitle(text: string): { title?: string; startsOn?: string; endsOn?: string } {
  const clean = text.replace(/\s+/g, " ").trim();
  const title = clean
    .split(/(?:precios|preços|promoci[oó]n v[aá]lida|v[aá]lid[oa]s?|hasta|até)\b/i)[0]
    .trim()
    .replace(/[-–·:]+$/, "")
    .trim();
  return { title: title && title.length <= 80 ? title : undefined, ...findDates(clean) };
}

// ---------------------------------------------------------------- PDF

export type PdfWord = { s: string; x: number };
/** Linhas de texto do PDF: palavras da esquerda para a direita, com a posição horizontal e a página. */
export type PdfText = { lines: { page: number; words: PdfWord[] }[]; text: string };

/** Extrai o texto de um PDF, linha a linha. */
export async function readPdf(file: File): Promise<PdfText> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  return pdfLines(doc);
}

type PdfDoc = { numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }> };

/** Linhas de texto de um PDF já aberto com o pdf.js. */
export async function pdfLines(doc: PdfDoc): Promise<PdfText> {
  const lines: PdfText["lines"] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items = (content.items as { str: string; transform: number[]; width?: number }[])
      .filter((i) => i.str?.trim())
      .map((i) => ({ x: i.transform[4], y: i.transform[5], w: i.width ?? 0, s: i.str }));
    // Agrupa por linha (mesma altura, com 3 pt de tolerância), de cima para baixo.
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    let current: typeof items = [];
    const flush = () => {
      if (!current.length) return;
      current.sort((a, b) => a.x - b.x);
      const words: PdfWord[] = [];
      for (const it of current) {
        let at = 0;
        for (const part of it.s.split(/(\s+)/)) {
          if (part.trim()) words.push({ s: part, x: it.x + (it.s.length ? (at / it.s.length) * it.w : 0) });
          at += part.length;
        }
      }
      lines.push({ page: n, words });
      current = [];
    };
    for (const item of items) {
      if (current.length && Math.abs(current[0].y - item.y) > 3) flush();
      current.push(item);
    }
    flush();
  }
  return { lines, text: lines.map((l) => l.words.map((w) => w.s).join(" ")).join("\n") };
}

const PRICE = /^\d{1,3}(?:\.\d{3})+,\d{2}€?$|^\d+[.,]\d{2}€?$|^\d+€$/;
const INT = /^\d{1,4}$/;
/** Referência que não está no catálogo: letras seguidas de algarismos, ex. XP540. */
const NEW_REF = /^[A-Z]{1,4}\d{3,6}[A-Z]{0,3}$|^\d{4,6}[A-Z]{2,4}$/;
const NEW_NUMERIC = /^\d{5,6}$/;

/** Palavras que podem ser referências (têm pelo menos um algarismo e 4 caracteres). */
export function referenceCandidates(pdf: PdfText) {
  const set = new Set<string>();
  for (const line of pdf.lines) for (const { s: w } of line.words) if (/\d/.test(w) && /^[A-Za-z0-9][A-Za-z0-9.\-/]{3,19}$/.test(w)) set.add(w);
  return [...set];
}

/**
 * Lê as linhas de um PDF de campanha. Uma referência conhecida (isKnown) abre um bloco que vai até à referência seguinte;
 * o preço do bloco é o último valor com cêntimos e a quantidade o número inteiro logo antes dele. Se a linha não tiver preço,
 * procura-o nas 4 linhas seguintes, na mesma coluna. Referências que não existem no catálogo só contam com o formato XP540.
 */
export function parseCampaignPdf(pdf: PdfText, isKnown: (token: string) => boolean): CampaignFile {
  const rows = new Map<string, CampaignImportRow & { below?: boolean }>();
  const anyRef = (w: string) => isKnown(w) || NEW_REF.test(w);
  pdf.lines.forEach((line, lineIndex) => {
    const words = line.words.filter((w) => w.s !== "€" && w.s !== "*");
    // Códigos só com algarismos que não estão no catálogo (ex. 70018) contam se a linha tiver outra referência conhecida.
    const lineHasKnown = words.some((w) => isKnown(w.s));
    const isRef = (w: string) => anyRef(w) || (lineHasKnown && NEW_NUMERIC.test(w));
    const starts = words.map((w, i) => (isRef(w.s) ? i : -1)).filter((i) => i >= 0);
    starts.forEach((start, k) => {
      const ref = words[start].s;
      const known = anyRef(ref);
      const prev = rows.get(ref);
      if (prev?.netPrice !== undefined && !prev.below) return;
      const block = words.slice(start + 1, k + 1 < starts.length ? starts[k + 1] : words.length).map((w) => w.s);
      let priceAt = -1;
      block.forEach((w, i) => PRICE.test(w) && (priceAt = i));
      if (!known && (priceAt < 0 || priceAt > 2)) return;
      if (priceAt < 0) {
        if (prev) return;
        const below = priceBelow(pdf, lineIndex, words[start].x, anyRef);
        rows.set(ref, below ? { reference: ref, ...below, below: true } : { reference: ref });
        return;
      }
      const qty = priceAt > 0 && INT.test(block[priceAt - 1]) ? Number(block[priceAt - 1]) : undefined;
      const text = block.slice(0, qty !== undefined ? priceAt - 1 : priceAt).filter((w) => !PRICE.test(w));
      rows.set(ref, {
        reference: ref,
        netPrice: parseNumber(block[priceAt].replace("€", "")),
        offerQty: qty && qty > 0 ? qty : undefined,
        designation: isKnown(ref) ? undefined : text.join(" ").slice(0, 200) || undefined,
      });
    });
  });
  return {
    rows: [...rows.values()].map(({ below: _b, ...r }) => r),
    ...datesAndTitle(pdf.lines.slice(0, 3).map((l) => l.words.map((w) => w.s).join(" ")).join(" ")),
  };
}

/** Preço na mesma coluna (até 60 pt de distância, o mais próximo) nas linhas logo abaixo, antes de aparecer outra referência nessa coluna. */
function priceBelow(pdf: PdfText, lineIndex: number, x: number, isRef: (w: string) => boolean) {
  const page = pdf.lines[lineIndex].page;
  for (const line of pdf.lines.slice(lineIndex + 1, lineIndex + 5)) {
    if (line.page !== page) break;
    const near = line.words.filter((w) => Math.abs(w.x - x) <= 60);
    if (near.some((w) => isRef(w.s))) break;
    const prices = near.filter((w) => PRICE.test(w.s)).sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x));
    if (prices.length) {
      const i = line.words.indexOf(prices[0]);
      const after = line.words[i + 1]?.s;
      return { netPrice: parseNumber(prices[0].s.replace("€", "")), offerQty: after && INT.test(after) && +after > 0 ? +after : undefined };
    }
  }
  return undefined;
}
