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

export function priceFor(product: Product, pricing: Pricing | null, clientId?: string | null): PriceInfo | null {
  const listPrice = pricing?.listPrices[product.id];
  if (listPrice == null || !pricing) return null;
  const rule = pickRule(pricing.rules, product, clientId);
  if (rule?.specialNetPrice != null) {
    return { listPrice, discounts: [], netPrice: rule.specialNetPrice, special: true };
  }
  const discounts = cleanDiscounts(rule?.discounts ?? []);
  return { listPrice, discounts, netPrice: applyDiscounts(listPrice, discounts), special: false };
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
  items: { product: Product; qty: number; price: PriceInfo | null; total: number }[];
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
    const price = priceFor(product, pricing, clientId);
    const total = price ? lineTotal(price.netPrice, item.qty) : 0;
    const group = groups.get(product.manufacturerId) ?? { manufacturerId: product.manufacturerId, items: [], subtotal: 0 };
    group.items.push({ product, qty: item.qty, price, total });
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
