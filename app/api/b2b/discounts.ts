// Descontos das fichas dos clientes do CRM (Fabricantes / Marcas → Desconto) → regras da loja B2B (source = 'crm').
// Corre no servidor com as chaves de serviço das duas bases. Só mexe nas regras que vieram do CRM.
import type { SupabaseClient } from "@supabase/supabase-js";
import { planCrmDiscounts, type CrmTerm, type ShopRule } from "../../b2b-link";
import { B2BError } from "./server";

export type DiscountSyncResult = { created: number; updated: number; removed: number; conflicts: number; unmatched: string[] };

/** Sincroniza todos os clientes da loja ligados ao CRM, ou só os destes clientes do CRM. */
export async function syncCrmDiscounts(shop: SupabaseClient, crm: SupabaseClient, crmClientIds?: string[]): Promise<DiscountSyncResult> {
  let clientsQuery = shop.from("b2b_clients").select("id,crm_client_id").not("crm_client_id", "is", null);
  if (crmClientIds) clientsQuery = clientsQuery.in("crm_client_id", crmClientIds.length ? crmClientIds : ["00000000-0000-0000-0000-000000000000"]);
  const clients = await clientsQuery;
  if (clients.error) throw new B2BError(502, clients.error.message);
  const shopClients = new Map((clients.data ?? []).map((c: any) => [c.crm_client_id as string, c.id as string]));
  const empty = { created: 0, updated: 0, removed: 0, conflicts: 0, unmatched: [] };
  if (!shopClients.size) return empty;
  const ids = [...shopClients.keys()];
  const shopIds = [...shopClients.values()];
  const [terms, manufacturers, rules] = await Promise.all([
    crm.from("client_manufacturers").select("id,client_id,agreed_discount,discount_status,manufacturers(name)").in("client_id", ids),
    shop.from("b2b_manufacturers").select("id,name"),
    shop.from("b2b_discount_rules").select("id,client_id,manufacturer_id,discounts,source,family_id,product_id,crm_relation_id").in("client_id", shopIds),
  ]);
  for (const r of [terms, manufacturers, rules]) if (r.error) throw new B2BError(502, r.error.message);
  const plan = planCrmDiscounts(
    (terms.data ?? []).map((t: any): CrmTerm => ({ relationId: t.id, crmClientId: t.client_id, manufacturerName: t.manufacturers?.name ?? "", agreedDiscount: t.agreed_discount, status: t.discount_status })),
    shopClients,
    (manufacturers.data ?? []) as Array<{ id: string; name: string }>,
    (rules.data ?? []) as ShopRule[],
  );
  if (plan.insert.length) {
    const r = await shop.from("b2b_discount_rules").insert(plan.insert);
    if (r.error) throw new B2BError(502, r.error.message);
  }
  for (const u of plan.update) {
    const r = await shop.from("b2b_discount_rules").update({ discounts: u.discounts, crm_relation_id: u.crm_relation_id, active: true }).eq("id", u.id);
    if (r.error) throw new B2BError(502, r.error.message);
  }
  if (plan.remove.length) {
    const r = await shop.from("b2b_discount_rules").delete().in("id", plan.remove).eq("source", "crm");
    if (r.error) throw new B2BError(502, r.error.message);
  }
  return { created: plan.insert.length, updated: plan.update.length, removed: plan.remove.length, conflicts: plan.conflicts.length, unmatched: plan.unmatched };
}
