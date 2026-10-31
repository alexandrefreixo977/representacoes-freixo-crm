import type { CartItem, DiscountRule, PriceInfo, Pricing, Product } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function cleanDiscounts(values: number[]) {
  return values.map(Number).filter((v) => Number.isFinite(v) && v > 0 && v <= 100);
}

/** Aplica descontos sucessivos: 100 € com 40% + 5% = 57 €. */
export function applyDiscounts(price: number, discounts: number[]) {
  return round4(cleanDiscounts(discounts).reduce((value, d) => value * (1 - d / 100), price));
}

/**
 * Escolhe a regra que se aplica a um produto para um cliente.
 * Ganha a regra mais específica: artigo > família > fabricante. No mesmo nível, a regra do cliente
 * ganha à geral. Assim uma campanha num artigo aplica-se a todos, e um preço acordado com um cliente
 * para esse artigo continua a valer para ele.
 * Tem de bater certo com a função b2b_pick_rule() no SQL.
 */
export function pickRule(rules: DiscountRule[], product: Product, clientId?: string | null) {
  const score = (r: DiscountRule) => (r.productId ? 20 : r.familyId ? 10 : 0) + (r.clientId ? 1 : 0);
  return rules
    .filter(
      (r) =>
        r.manufacturerId === product.manufacturerId &&
        (!r.clientId || r.clientId === clientId) &&
        (!r.productId || r.productId === product.id) &&
        (!r.familyId || r.familyId === product.familyId)
    )
    .sort((a, b) => score(b) - score(a))[0];
}

/** Comprimento em mm de uma fita à medida (null se não for um número válido entre 100 e 20 000 mm). */
export function lengthMm(value?: string | null) {
  const mm = Number(String(value ?? "").trim().replace(/\s|mm$/gi, ""));
  return Number.isInteger(mm) && mm >= 100 && mm <= 20000 ? mm : null;
}

/** Falta escolher o tamanho / comprimento? */
export function needsVariant(product: Product, value?: string | null) {
  if (!product.sizeType) return false;
  return product.sizeType === "medida" ? lengthMm(value) == null : !String(value ?? "").trim();
}

/**
 * Preço por unidade. Nas fitas à medida o preço de tabela é por metro: com o comprimento escolhido
 * passa a preço por fita = metros x preço/m + soldadura. Tem de bater certo com b2b_submit_order() no SQL.
 */
export function priceFor(product: Product, pricing: Pricing | null, clientId?: string | null, variant?: string | null): PriceInfo | null {
  let listPrice = pricing?.listPrices[product.id];
  if (listPrice == null || !pricing) return null;
  const mm = product.sizeType === "medida" ? lengthMm(variant) : null;
  if (mm != null) listPrice = round4(listPrice * (mm / 1000) + (pricing.weldPrices?.[product.id] ?? 0));
  const rule = pickRule(pricing.rules, product, clientId);
  if (rule?.specialNetPrice != null && mm == null) {
    return { listPrice, discounts: [], netPrice: rule.specialNetPrice, special: true, campaignId: rule.campaignId ?? null, offerQty: rule.offerQty ?? null };
  }
  const discounts = cleanDiscounts(rule?.discounts ?? []);
  return { listPrice, discounts, netPrice: applyDiscounts(listPrice, discounts), special: false, campaignId: rule?.campaignId ?? null, offerQty: rule?.offerQty ?? null };
}

/** Acerta uma quantidade para cima: pelo menos a mínima, e sempre em caixas completas. */
export function normalizeQty(product: Pick<Product, "packQty" | "moq">, qty: number) {
  const pack = Math.max(1, product.packQty || 1);
  const wanted = Math.max(qty, product.moq || pack, pack);
  return Math.ceil(wanted / pack) * pack;
}

export function lineTotal(netPrice: number, qty: number) {
  return round2(netPrice * qty);
}

export type CartGroup = {
  manufacturerId: string;
  items: { product: Product; qty: number; variant?: string; price: PriceInfo | null; total: number }[];
  subtotal: number;
};

/** Divide o carrinho numa encomenda por fabricante. */
export function splitByManufacturer(
  cart: CartItem[],
  products: Product[],
  pricing: Pricing | null,
  clientId?: string | null
): CartGroup[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const groups = new Map<string, CartGroup>();
  for (const item of cart) {
    const product = byId.get(item.productId);
    if (!product || item.qty <= 0) continue;
    const price = priceFor(product, pricing, clientId, item.variant);
    const total = price ? lineTotal(price.netPrice, item.qty) : 0;
    const group = groups.get(product.manufacturerId) ?? { manufacturerId: product.manufacturerId, items: [], subtotal: 0 };
    group.items.push({ product, qty: item.qty, variant: item.variant, price, total });
    group.subtotal = round2(group.subtotal + total);
    groups.set(product.manufacturerId, group);
  }
  return [...groups.values()];
}

/**
 * Lê uma lista colada pelo cliente, uma linha por artigo: "REF 10", "REF;10", "REF x10", ou só "REF".
 */
export function parseQuickOrder(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.+?)[\s;,\t]+x?\s*(\d+(?:[.,]\d+)?)\s*$/i);
      if (!match) return { reference: line, qty: 1 };
      return { reference: match[1].trim(), qty: Number(match[2].replace(",", ".")) };
    });
}

/** Tamanhos propostos na loja (o cliente pode escrever outro). */
export const SIZES: Record<"calcado" | "vestuario" | "medida", string[]> = {
  calcado: Array.from({ length: 14 }, (_, i) => String(35 + i)),
  vestuario: ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"],
  medida: ["1440", "1638", "2085", "2360", "2450", "2750", "2950", "3160", "3660", "4115"],
};

const LETTER_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"];

/** Tamanhos a sugerir: os da faixa escrita na designação ("Tam. 48 a 66", "Tam. 4XL e 5XL"), senão os habituais. */
export function sizesFor(product: Product): string[] {
  if (!product.sizeType) return [];
  const m = product.designation.match(/Tam\. (\w+) (a|e) (\w+)/);
  if (m && product.sizeType !== "medida") {
    const [from, to] = [m[1].toUpperCase().replace(/^2XL$/, "XXL"), m[3].toUpperCase().replace(/^2XL$/, "XXL")];
    if (m[2] === "e") return [from, to];
    if (/^\d+$/.test(from) && /^\d+$/.test(to)) {
      const out: string[] = [];
      for (let n = Number(from); n <= Number(to); n += 2) out.push(String(n));
      return out;
    }
    const a = LETTER_SIZES.indexOf(from), b = LETTER_SIZES.indexOf(to);
    if (a >= 0 && b >= a) return LETTER_SIZES.slice(a, b + 1);
  }
  return SIZES[product.sizeType];
}

/** Texto para pesquisa: minúsculas e sem acentos (igual à coluna search_text no SQL). */
export const normSearch = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export const normRef = (ref: string) => ref.toUpperCase().replace(/[\s.\-_/]/g, "");

const eur = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const formatEur = (n: number) => eur.format(n);
export const formatDiscounts = (values: number[]) =>
  cleanDiscounts(values)
    .map((v) => `${new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 2 }).format(v)}%`)
    .join(" + ");
export function parseDiscounts(value: string) {
  return cleanDiscounts(value.split(/[+;]/).map((s) => Number(s.trim().replace("%", "").replace(",", "."))));
}

/** Texto do tamanho/comprimento escolhido, para o carrinho e para as encomendas. */
export function variantLabel(product: Pick<Product, "sizeType">, variant?: string | null) {
  if (!variant) return "";
  return product.sizeType === "medida" ? `Comprimento ${variant} mm` : `Tam. ${variant}`;
}
