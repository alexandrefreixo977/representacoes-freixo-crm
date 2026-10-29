import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AccessRequest, Catalog, Client, DiscountRule, Order, OrderLine, Session } from "../types";
import type { Api } from "./api";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const num = (v: unknown) => (v == null ? 0 : Number(v));
const nums = (v: unknown) => (Array.isArray(v) ? v.map(Number) : []);

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

const mapClient = (c: Row): Client => ({ id: c.id, name: c.name, nif: c.nif, email: c.email, phone: c.phone, address: c.address });

const mapRule = (r: Row): DiscountRule => ({
  id: r.id,
  clientId: r.client_id,
  manufacturerId: r.manufacturer_id,
  familyId: r.family_id,
  productId: r.product_id,
  discounts: nums(r.discounts),
  specialNetPrice: r.special_net_price == null ? null : Number(r.special_net_price),
});

const ORDER_SELECT =
  "id, number, client_id, manufacturer_id, status, subtotal, internal_note, created_at, " +
  "b2b_order_groups(number, customer_ref, notes), b2b_clients(name), " +
  "b2b_order_lines(product_id, reference, designation, sales_unit, qty, list_price, discounts, net_price, line_total)";

const mapOrder = (o: Row): Order => ({
  id: o.id,
  number: o.number,
  groupNumber: o.b2b_order_groups?.number ?? "",
  clientId: o.client_id,
  clientName: o.b2b_clients?.name ?? "",
  manufacturerId: o.manufacturer_id,
  status: o.status,
  customerRef: o.b2b_order_groups?.customer_ref,
  notes: o.b2b_order_groups?.notes,
  internalNote: o.internal_note,
  subtotal: num(o.subtotal),
  createdAt: o.created_at,
  lines: (o.b2b_order_lines ?? []).map(
    (l: Row): OrderLine => ({
      productId: l.product_id,
      reference: l.reference,
      designation: l.designation,
      salesUnit: l.sales_unit,
      qty: num(l.qty),
      listPrice: num(l.list_price),
      discounts: nums(l.discounts),
      netPrice: num(l.net_price),
      lineTotal: num(l.line_total),
    })
  ),
});

export function createSupabaseApi(url: string, anonKey: string): Api {
  const sb: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: true } });

  async function session(): Promise<Session | null> {
    const { data } = await sb.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    const { data: link } = await sb.from("b2b_users").select("role, client_id, b2b_clients(*)").eq("user_id", user.id).maybeSingle();
    const l = link as Row | null;
    return {
      userId: user.id,
      email: user.email ?? "",
      role: l?.role === "admin" ? "admin" : "client",
      client: l?.b2b_clients ? mapClient(l.b2b_clients) : null,
    };
  }

  return {
    mode: "supabase",
    getSession: session,
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error("Email ou palavra-passe incorretos.");
      const s = await session();
      if (!s) throw new Error("Não foi possível iniciar sessão.");
      return s;
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async resetPassword(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin });
      fail(error);
    },
    async setPassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      fail(error);
    },
    onSessionChange(cb) {
      const { data } = sb.auth.onAuthStateChange(() => cb());
      return () => data.subscription.unsubscribe();
    },

    async getCatalog(): Promise<Catalog> {
      const [m, f, p, c] = await Promise.all([
        sb.from("b2b_manufacturers").select("*").eq("active", true).order("sort"),
        sb.from("b2b_families").select("*").order("name"),
        sb.from("b2b_products").select("*").eq("active", true).order("designation").range(0, 9999),
        sb.from("b2b_campaigns").select("*").eq("active", true).order("sort"),
      ]);
      fail(m.error); fail(f.error); fail(p.error); fail(c.error);
      return {
        manufacturers: (m.data ?? []).map((r: Row) => ({ id: r.id, name: r.name, slug: r.slug, logoUrl: r.logo_url, ordersEmail: r.orders_email, sort: r.sort })),
        families: (f.data ?? []).map((r: Row) => ({ id: r.id, manufacturerId: r.manufacturer_id, name: r.name })),
        products: (p.data ?? []).map((r: Row) => ({
          id: r.id,
          manufacturerId: r.manufacturer_id,
          familyId: r.family_id,
          reference: r.reference,
          ean: r.ean,
          designation: r.designation,
          description: r.description,
          imageUrl: r.image_url,
          techSheetUrl: r.tech_sheet_url,
          salesUnit: r.sales_unit,
          packQty: num(r.pack_qty),
          moq: num(r.moq),
          isNew: r.is_new,
        })),
        campaigns: (c.data ?? []).map((r: Row) => ({
          id: r.id, title: r.title, subtitle: r.subtitle, badge: r.badge, imageUrl: r.image_url, manufacturerId: r.manufacturer_id, productId: r.product_id,
        })),
      };
    },
    async requestAccess(req) {
      const { error } = await sb.from("b2b_access_requests").insert(req);
      fail(error);
    },

    async getPricing() {
      const [p, r] = await Promise.all([
        sb.from("b2b_prices").select("product_id, list_price").range(0, 9999),
        sb.from("b2b_discount_rules").select("*").eq("active", true),
      ]);
      fail(p.error); fail(r.error);
      const today = new Date().toISOString().slice(0, 10);
      return {
        listPrices: Object.fromEntries((p.data ?? []).map((x: Row) => [x.product_id, num(x.list_price)])),
        rules: (r.data ?? []).filter((x: Row) => !x.valid_until || x.valid_until >= today).map(mapRule),
      };
    },
    async submitOrder(items, customerRef, notes) {
      const { data, error } = await sb.rpc("b2b_submit_order", { p_items: items, p_customer_ref: customerRef, p_notes: notes });
      fail(error);
      const groupId = (data as Row).groupId;
      const { data: orders, error: e2 } = await sb.from("b2b_orders").select(ORDER_SELECT).eq("group_id", groupId).order("number");
      fail(e2);
      // Avisa a Freixo por email (falha no email não anula a encomenda).
      sb.functions.invoke("notify-order", { body: { groupId } }).catch(() => undefined);
      return { groupNumber: (data as Row).groupNumber, orders: (orders ?? []).map(mapOrder) };
    },
    async listMyOrders() {
      const { data, error } = await sb.from("b2b_orders").select(ORDER_SELECT).order("created_at", { ascending: false }).limit(200);
      fail(error);
      return (data ?? []).map(mapOrder);
    },

    async listOrders() {
      const { data, error } = await sb.from("b2b_orders").select(ORDER_SELECT).order("created_at", { ascending: false }).limit(500);
      fail(error);
      return (data ?? []).map(mapOrder);
    },
    async setOrderStatus(orderId, status, internalNote) {
      const { data } = await sb.auth.getUser();
      const patch: Row = { status, status_changed_at: new Date().toISOString(), status_changed_by: data.user?.id };
      if (internalNote !== undefined) patch.internal_note = internalNote;
      const { error } = await sb.from("b2b_orders").update(patch).eq("id", orderId);
      fail(error);
    },
    async listClients() {
      const { data, error } = await sb.from("b2b_clients").select("*").order("name");
      fail(error);
      return (data ?? []).map(mapClient);
    },
    async saveClient(client) {
      const { data, error } = await sb.from("b2b_clients").upsert(client).select().single();
      fail(error);
      return mapClient(data as Row);
    },
    async inviteClientUser(clientId, email) {
      const { data, error } = await sb.functions.invoke("invite-client", { body: { clientId, email } });
      if (error) throw new Error("Não foi possível enviar o convite. Confirme que a função invite-client está publicada.");
      return (data as Row)?.message ?? "Convite enviado por email.";
    },
    async listRules() {
      const { data, error } = await sb.from("b2b_discount_rules").select("*").order("created_at");
      fail(error);
      return (data ?? []).map(mapRule);
    },
    async saveRule(rule) {
      const { error } = await sb.from("b2b_discount_rules").upsert({
        id: rule.id,
        client_id: rule.clientId || null,
        manufacturer_id: rule.manufacturerId,
        family_id: rule.familyId || null,
        product_id: rule.productId || null,
        discounts: rule.discounts,
        special_net_price: rule.specialNetPrice ?? null,
      });
      fail(error);
    },
    async deleteRule(id) {
      const { error } = await sb.from("b2b_discount_rules").delete().eq("id", id);
      fail(error);
    },
    async importPriceList(manufacturerId, rows) {
      const { data, error } = await sb.rpc("b2b_import_prices", { p_manufacturer: manufacturerId, p_rows: rows });
      fail(error);
      return data as { created: number; updated: number; skipped: number };
    },
    async listAccessRequests() {
      const { data, error } = await sb.from("b2b_access_requests").select("*").order("created_at", { ascending: false });
      fail(error);
      return (data ?? []).map((r: Row): AccessRequest => ({ ...r, createdAt: r.created_at }) as AccessRequest);
    },
  };
}
