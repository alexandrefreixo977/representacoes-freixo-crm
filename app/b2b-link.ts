// Regras da ligação entre o CRM e a loja B2B (b2b.representacoesfreixo.com).
export const B2B_SHOP_URL = "https://b2b.representacoesfreixo.com";

/** NIF só com algarismos e letras, sem prefixo PT, para comparar clientes entre as duas bases. */
export function normalizeNif(value: string | null | undefined): string {
  const clean = String(value ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return clean.startsWith("PT") && clean.length > 2 ? clean.slice(2) : clean;
}

export type QuoteStatus = "draft" | "sent" | "accepted" | "lost";
/** Fase da oportunidade que corresponde ao estado da proposta da loja. Rascunhos não entram no CRM. */
export function stageForQuote(status: string): "Proposta enviada" | "Ganha" | "Perdida" | null {
  if (status === "sent") return "Proposta enviada";
  if (status === "accepted") return "Ganha";
  if (status === "lost") return "Perdida";
  return null;
}

export const orderStatusLabel: Record<string, string> = {
  pending: "Por validar", validated: "Validada", sent: "Enviada ao fabricante", confirmed: "Confirmada", delivered: "Entregue", cancelled: "Cancelada",
};
export const quoteStatusLabel: Record<string, string> = { draft: "Rascunho", sent: "Enviada", accepted: "Aceite", lost: "Perdida" };

/** Data (AAAA-MM-DD) para acompanhar a proposta: 7 dias depois de criada, nunca no passado. */
export function followUpDate(createdAt: string, now = new Date()): string {
  const due = new Date(new Date(createdAt).getTime() + 7 * 86400000);
  return (due < now ? now : due).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- descontos do CRM → loja
/** Chave para juntar o fabricante do CRM ao da loja: 1.ª palavra do nome, sem acentos ("Blue-Master" = "Blue Master" = "blue"). */
export function manufacturerKey(name: string | null | undefined): string {
  return String(name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ")[0] ?? "";
}
/** Estados da ficha que dizem que o desconto já não vale. */
export const inactiveDiscountStatus = (status: string | null | undefined) => /^in(activ|ativ)/i.test(String(status ?? "").trim());

export type CrmTerm = { relationId: string; crmClientId: string; manufacturerName: string; agreedDiscount: number | string | null; status: string | null };
export type ShopRule = { id: string; client_id: string; manufacturer_id: string; discounts: number[]; source: string | null; family_id: string | null; product_id: string | null; crm_relation_id?: string | null };
export type DiscountPlan = {
  insert: Array<{ client_id: string; manufacturer_id: string; discounts: number[]; source: "crm"; crm_relation_id: string }>;
  update: Array<{ id: string; discounts: number[]; crm_relation_id: string }>;
  remove: string[];
  /** Cliente+fabricante com regra feita à mão na loja: essa continua a valer. */
  conflicts: Array<{ client_id: string; manufacturer_id: string; crm: number; shop: number[] }>;
  /** Fabricantes do CRM com desconto que não existem na loja. */
  unmatched: string[];
};

/**
 * O que mudar na loja para refletir os descontos das fichas do CRM (fração 0,40 = 40%).
 * Uma regra por cliente da loja e fabricante, para o fabricante inteiro. COFRA no CRM vale para COFRA Calçado e COFRA Vestuário.
 * Sem desconto, desconto 0 ou estado inativo → a regra do CRM sai. `shopClients` mapeia cliente do CRM → cliente da loja.
 */
export function planCrmDiscounts(
  terms: CrmTerm[],
  shopClients: Map<string, string>,
  shopManufacturers: Array<{ id: string; name: string }>,
  rules: ShopRule[],
): DiscountPlan {
  const byKey = new Map<string, string[]>();
  for (const m of shopManufacturers) {
    const key = manufacturerKey(m.name);
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), m.id]);
  }
  const wanted = new Map<string, { client_id: string; manufacturer_id: string; pct: number; relationId: string; exact: boolean }>();
  const unmatched = new Set<string>();
  for (const t of terms) {
    const client = shopClients.get(t.crmClientId);
    const pct = Math.round(Number(t.agreedDiscount) * 10000) / 100;
    if (!client || t.agreedDiscount == null || !(pct > 0 && pct <= 100) || inactiveDiscountStatus(t.status)) continue;
    const ids = byKey.get(manufacturerKey(t.manufacturerName));
    if (!ids) { unmatched.add(t.manufacturerName); continue; }
    for (const id of ids) {
      const exact = shopManufacturers.find(m => m.id === id)?.name.toLowerCase() === t.manufacturerName.toLowerCase();
      const k = `${client}|${id}`;
      const prev = wanted.get(k);
      // "ACHA" e "ACHA Herramientas" no CRM: ganha o fabricante com o nome igual ao da loja.
      if (!prev || (exact && !prev.exact)) wanted.set(k, { client_id: client, manufacturer_id: id, pct, relationId: t.relationId, exact });
    }
  }
  const plan: DiscountPlan = { insert: [], update: [], remove: [], conflicts: [], unmatched: [...unmatched].sort() };
  const crmRules = new Map(rules.filter(r => r.source === "crm").map(r => [`${r.client_id}|${r.manufacturer_id}`, r]));
  const manual = new Map(rules.filter(r => r.source !== "crm" && r.client_id && !r.family_id && !r.product_id).map(r => [`${r.client_id}|${r.manufacturer_id}`, r]));
  for (const [k, w] of wanted) {
    const own = manual.get(k);
    if (own) plan.conflicts.push({ client_id: w.client_id, manufacturer_id: w.manufacturer_id, crm: w.pct, shop: own.discounts.map(Number) });
    const current = crmRules.get(k);
    if (!current) plan.insert.push({ client_id: w.client_id, manufacturer_id: w.manufacturer_id, discounts: [w.pct], source: "crm", crm_relation_id: w.relationId });
    else if (current.discounts.length !== 1 || Number(current.discounts[0]) !== w.pct || current.crm_relation_id !== w.relationId) plan.update.push({ id: current.id, discounts: [w.pct], crm_relation_id: w.relationId });
  }
  for (const [k, r] of crmRules) if (!wanted.has(k)) plan.remove.push(r.id);
  return plan;
}
