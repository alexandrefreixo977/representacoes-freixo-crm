// Dossier do cliente: depois de gravar o desconto de um fabricante, passa-o logo para a loja B2B.
import { B2BError, b2bError, crmAdmin, crmSession, json, linkedShopClient, shopAdmin, type CrmClient } from "../server";
import { syncCrmDiscounts } from "../discounts";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { db } = await crmSession(request);
    const body = await request.json().catch(() => ({})) as { id?: string };
    if (!body.id || !/^[0-9a-f-]{36}$/i.test(body.id)) throw new B2BError(400, "Cliente inválido.");
    const { data, error } = await db.from("clients").select("id,trade_name,tax_id,email,phone,address,postal_code,city").eq("id", body.id).maybeSingle();
    if (error || !data) throw new B2BError(404, "Cliente não encontrado ou sem permissão.");
    const shop = shopAdmin();
    const linked = await linkedShopClient(shop, data as CrmClient);
    if (!linked) return json({ linked: false });
    return json({ linked: true, ...(await syncCrmDiscounts(shop, crmAdmin(), [body.id])) });
  } catch (error) { return b2bError(error); }
}
