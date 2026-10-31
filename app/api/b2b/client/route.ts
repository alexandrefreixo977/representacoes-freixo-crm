// Dossier do cliente: encomendas e propostas da loja B2B, e dar acesso à loja a partir do CRM.
import { B2B_SHOP_URL, normalizeNif } from "../../../b2b-link";
import { B2BError, b2bError, crmSession, json, linkedShopClient, requirePermission, shopAdmin, type CrmClient } from "../server";
export const dynamic = "force-dynamic";

async function readClient(db: Awaited<ReturnType<typeof crmSession>>["db"], id: string | null) {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new B2BError(400, "Cliente inválido.");
  const { data, error } = await db.from("clients").select("id,trade_name,tax_id,email,phone,address,postal_code,city").eq("id", id).maybeSingle();
  if (error || !data) throw new B2BError(404, "Cliente não encontrado ou sem permissão.");
  return data as CrmClient;
}

/** Procura uma conta da loja pelo email (as listas do Supabase Auth são paginadas). */
async function findShopUser(shop: ReturnType<typeof shopAdmin>, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await shop.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new B2BError(502, error.message);
    const found = data.users.find(u => (u.email ?? "").toLowerCase() === email);
    if (found) return found.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const { db } = await crmSession(request);
    const client = await readClient(db, new URL(request.url).searchParams.get("id"));
    const shop = shopAdmin();
    const linked = await linkedShopClient(shop, client);
    const nif = normalizeNif(client.tax_id);
    const [users, orders, quotes] = await Promise.all([
      linked ? shop.from("b2b_users").select("email,name").eq("client_id", linked.id) : Promise.resolve({ data: [], error: null }),
      linked ? shop.from("b2b_orders").select("id,number,status,subtotal,created_at,b2b_manufacturers(name)").eq("client_id", linked.id).order("created_at", { ascending: false }).limit(50) : Promise.resolve({ data: [], error: null }),
      shop.from("b2b_quotes").select("id,number,status,total,created_at,valid_until,owner_name,client_id,customer_nif").order("created_at", { ascending: false }).limit(500),
    ]);
    for (const result of [users, orders, quotes]) if (result.error) throw new B2BError(502, result.error.message);
    const ownQuotes = (quotes.data ?? []).filter((q: any) => (linked && q.client_id === linked.id) || (nif && normalizeNif(q.customer_nif) === nif)).slice(0, 50);
    const ids = ownQuotes.map((q: any) => q.id);
    const opportunities = ids.length ? await db.from("opportunities").select("id,b2b_quote_id").in("b2b_quote_id", ids) : { data: [] };
    const oppByQuote = new Map((opportunities.data ?? []).map((o: any) => [o.b2b_quote_id, o.id]));
    return json({
      shopUrl: B2B_SHOP_URL,
      linked: linked ? { id: linked.id, name: linked.name, users: users.data ?? [] } : null,
      orders: (orders.data ?? []).map((o: any) => ({ id: o.id, number: o.number, status: o.status, total: Number(o.subtotal), createdAt: o.created_at, manufacturer: o.b2b_manufacturers?.name ?? "" })),
      quotes: ownQuotes.map((q: any) => ({ id: q.id, number: q.number, status: q.status, total: Number(q.total), createdAt: q.created_at, validUntil: q.valid_until, owner: q.owner_name ?? "", opportunityId: oppByQuote.get(q.id) ?? null })),
    });
  } catch (error) { return b2bError(error); }
}

/** Cria o cliente na loja (com os dados do CRM) e, se vier email, envia o convite de acesso. */
export async function POST(request: Request) {
  try {
    const { db } = await crmSession(request);
    await requirePermission(db, "clients.edit");
    const body = await request.json().catch(() => ({})) as { id?: string; email?: string };
    const client = await readClient(db, body.id ?? null);
    const email = String(body.email ?? "").trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new B2BError(400, "Email inválido.");
    const shop = shopAdmin();
    let linked = await linkedShopClient(shop, client);
    if (!linked) {
      const address = [client.address, [client.postal_code, client.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
      const created = await shop.from("b2b_clients").insert({ name: client.trade_name, nif: client.tax_id, email: client.email ?? (email || null), phone: client.phone, address, crm_client_id: client.id }).select("id,name,nif,crm_client_id").single();
      if (created.error) throw new B2BError(502, created.error.message);
      linked = created.data;
    }
    if (!email) return json({ message: "Cliente criado na loja B2B." });
    // Se o email já tiver conta na loja: só se liga a este cliente quando é uma conta sem papel (nunca rebaixa um administrador/comercial).
    const adminEmail = await shop.from("b2b_admin_emails").select("email").eq("email", email).maybeSingle();
    if (adminEmail.data) throw new B2BError(409, "Este email é de um administrador da loja. Use o email da pessoa do cliente que vai fazer as encomendas.");
    const existing = await findShopUser(shop, email);
    if (existing) {
      const role = await shop.from("b2b_users").select("role,client_id").eq("user_id", existing).maybeSingle();
      if (role.data?.role === "admin" || role.data?.role === "comercial") throw new B2BError(409, "Este email é de um administrador ou comercial da loja. Use o email da pessoa do cliente que vai fazer as encomendas.");
      if (role.data?.client_id && role.data.client_id !== linked!.id) throw new B2BError(409, "Este email já dá acesso a outro cliente da loja. Use outro email.");
      const user = await shop.from("b2b_users").upsert({ user_id: existing, client_id: linked!.id, role: "client", email, name: client.trade_name });
      if (user.error) throw new B2BError(502, user.error.message);
      return json({ message: `${email} já tinha conta na loja e passou a encomendar por este cliente.` });
    }
    const invite = await shop.auth.admin.inviteUserByEmail(email, { redirectTo: B2B_SHOP_URL });
    if (invite.error || !invite.data.user) throw new B2BError(400, `Não foi possível enviar o convite: ${invite.error?.message ?? "erro"}`);
    const user = await shop.from("b2b_users").upsert({ user_id: invite.data.user.id, client_id: linked!.id, role: "client", email, name: client.trade_name });
    if (user.error) throw new B2BError(502, user.error.message);
    return json({ message: `Convite enviado para ${email}. O cliente define a palavra-passe e passa a ver os preços na loja.` });
  } catch (error) { return b2bError(error); }
}
