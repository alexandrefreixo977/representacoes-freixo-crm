import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AccessRequest, Campaign, Catalog, Client, DiscountRule, Manufacturer, Order, OrderLine, Product, Quote, Session, StaffUser } from "../types";
import { normRef, normSearch } from "../pricing";
import { slugify } from "../slug";
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
  "b2b_order_lines(product_id, variant, reference, designation, sales_unit, qty, list_price, discounts, net_price, line_total)";

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
      variant: l.variant,
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

const mapQuote = (q: Row): Quote => ({
  id: q.id,
  number: q.number,
  ownerId: q.owner_id,
  ownerName: q.owner_name,
  ownerEmail: q.owner_email,
  clientId: q.client_id,
  customerName: q.customer_name,
  customerNif: q.customer_nif,
  customerEmail: q.customer_email,
  customerPhone: q.customer_phone,
  customerAddress: q.customer_address,
  contactName: q.contact_name,
  status: q.status,
  validUntil: q.valid_until,
  deliveryTerms: q.delivery_terms,
  paymentTerms: q.payment_terms,
  notes: q.notes,
  internalNote: q.internal_note,
  total: num(q.total),
  createdAt: q.created_at,
  updatedAt: q.updated_at,
  lines: [...(q.b2b_quote_lines ?? [])]
    .sort((a: Row, b: Row) => a.position - b.position)
    .map((l: Row) => ({
      productId: l.product_id,
      manufacturerName: l.manufacturer_name,
      reference: l.reference,
      designation: l.designation,
      variant: l.variant,
      salesUnit: l.sales_unit,
      qty: num(l.qty),
      listPrice: num(l.list_price),
      discounts: nums(l.discounts),
      netPrice: num(l.net_price),
      lineTotal: num(l.line_total),
    })),
});

const PRODUCT_COLS =
  "id, manufacturer_id, family_id, reference, ean, designation, description, image_url, tech_sheet_url, sales_unit, pack_qty, moq, is_new, size_type";

const mapProduct = (r: Row): Product => ({
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
  sizeType: r.size_type,
});

/** Divide uma lista em blocos (para não fazer URLs gigantes). */
const chunks = <T,>(list: T[], size = 150) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const quoted = (values: string[]) => values.map((v) => `"${v.replace(/["\\]/g, "")}"`).join(",");

export function createSupabaseApi(url: string, anonKey: string): Api {
  const sb: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: true } });

  async function session(): Promise<Session | null> {
    const { data } = await sb.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    const { data: link } = await sb.from("b2b_users").select("role, name, client_id, b2b_clients(*)").eq("user_id", user.id).maybeSingle();
    const l = link as Row | null;
    return {
      userId: user.id,
      email: user.email ?? "",
      role: l?.role === "admin" || l?.role === "comercial" ? l.role : "client",
      name: l?.name ?? null,
      client: l?.b2b_clients ? mapClient(l.b2b_clients) : null,
    };
  }

  const self: Api = {
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
      const [m, f, c] = await Promise.all([
        sb.from("b2b_manufacturers").select("*").eq("active", true).order("sort"),
        sb.from("b2b_families").select("*").order("name"),
        sb.from("b2b_campaigns").select("*").eq("active", true).order("sort"),
      ]);
      fail(m.error); fail(f.error); fail(c.error);
      const campaignProducts = (c.data ?? []).map((r: Row) => r.product_id).filter(Boolean);
      return {
        manufacturers: (m.data ?? []).map((r: Row) => ({ id: r.id, name: r.name, slug: r.slug, logoUrl: r.logo_url, ordersEmail: r.orders_email, sort: r.sort })),
        families: (f.data ?? []).map((r: Row) => ({ id: r.id, manufacturerId: r.manufacturer_id, name: r.name })),
        products: campaignProducts.length ? await self.getProducts(campaignProducts) : [],
        campaigns: (c.data ?? []).filter((r: Row) => {
          const today = new Date().toISOString().slice(0, 10);
          return (!r.starts_on || r.starts_on <= today) && (!r.ends_on || r.ends_on >= today);
        }).map((r: Row) => ({
          id: r.id, title: r.title, subtitle: r.subtitle, badge: r.badge, imageUrl: r.image_url, manufacturerId: r.manufacturer_id, productId: r.product_id,
        })),
      };
    },
    async searchProducts({ manufacturerId, familyId, q, onlyNew, offset, limit }) {
      let query = sb.from("b2b_products").select(PRODUCT_COLS, { count: "exact" }).eq("active", true);
      if (manufacturerId) query = query.eq("manufacturer_id", manufacturerId);
      if (familyId) query = query.eq("family_id", familyId);
      if (onlyNew) query = query.eq("is_new", true);
      for (const term of normSearch(q ?? "").split(/\s+/).filter(Boolean)) {
        query = query.like("search_text", `%${term.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`);
      }
      const { data, error, count } = await query.order("designation").order("id").range(offset, offset + limit - 1);
      fail(error);
      return { products: (data ?? []).map(mapProduct), total: count ?? 0 };
    },
    async getProducts(ids) {
      const unique = [...new Set(ids)];
      const pages = await Promise.all(chunks(unique).map((part) => sb.from("b2b_products").select(PRODUCT_COLS).in("id", part)));
      pages.forEach((p) => fail(p.error));
      return pages.flatMap((p) => (p.data ?? []).map(mapProduct));
    },
    async findProducts(refs, manufacturerId) {
      const keys = [...new Set(refs.map(normRef).filter(Boolean))];
      const pages = await Promise.all(
        chunks(keys, 100).map((part) => {
          let query = sb.from("b2b_products").select(PRODUCT_COLS).eq("active", true).or(`ref_norm.in.(${quoted(part)}),ean.in.(${quoted(part)})`);
          if (manufacturerId) query = query.eq("manufacturer_id", manufacturerId);
          return query.limit(1000);
        })
      );
      pages.forEach((p) => fail(p.error));
      return pages.flatMap((p) => (p.data ?? []).map(mapProduct));
    },
    async requestAccess(req) {
      const { error } = await sb.from("b2b_access_requests").insert(req);
      fail(error);
    },

    async getPricing() {
      const { data, error } = await sb.from("b2b_discount_rules").select("*").eq("active", true);
      fail(error);
      const today = new Date().toISOString().slice(0, 10);
      return { listPrices: {}, rules: (data ?? []).filter((x: Row) => !x.valid_until || x.valid_until >= today).map(mapRule) };
    },
    async getPrices(productIds) {
      const pages = await Promise.all(chunks([...new Set(productIds)]).map((part) => sb.from("b2b_prices").select("product_id, list_price, weld_price").in("product_id", part)));
      pages.forEach((p) => fail(p.error));
      const rows = pages.flatMap((p) => p.data ?? []) as Row[];
      return {
        listPrices: Object.fromEntries(rows.map((x) => [x.product_id, num(x.list_price)])),
        weldPrices: Object.fromEntries(rows.filter((x) => x.weld_price != null).map((x) => [x.product_id, num(x.weld_price)])),
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
    async listManufacturers() {
      const { data, error } = await sb.from("b2b_manufacturers").select("*").order("sort");
      fail(error);
      return (data ?? []).map((r: Row): Manufacturer => ({
        id: r.id, name: r.name, slug: r.slug, logoUrl: r.logo_url, ordersEmail: r.orders_email, sort: r.sort, active: r.active,
      }));
    },
    async saveManufacturer(m) {
      const row = { name: m.name.trim(), slug: slugify(m.name), logo_url: m.logoUrl || null, orders_email: m.ordersEmail || null, sort: m.sort, active: m.active !== false };
      const { error } = m.id
        ? await sb.from("b2b_manufacturers").update(row).eq("id", m.id)
        : await sb.from("b2b_manufacturers").insert(row);
      if (error?.code === "23505") throw new Error("Já existe um fabricante com este nome.");
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
    async listCampaigns() {
      const { data, error } = await sb.from("b2b_campaigns").select("*").order("sort").order("title");
      fail(error);
      return (data ?? []).map((r: Row): Campaign => ({
        id: r.id, title: r.title, subtitle: r.subtitle, badge: r.badge, imageUrl: r.image_url, manufacturerId: r.manufacturer_id,
        productId: r.product_id, startsOn: r.starts_on, endsOn: r.ends_on, active: r.active, sort: r.sort,
      }));
    },
    async saveCampaign(c) {
      const row = {
        title: c.title.trim(), subtitle: c.subtitle || null, badge: c.badge || null, image_url: c.imageUrl || null,
        manufacturer_id: c.manufacturerId || null, product_id: c.productId || null, starts_on: c.startsOn || null,
        ends_on: c.endsOn || null, active: c.active !== false, sort: c.sort ?? 100,
      };
      const { error } = c.id ? await sb.from("b2b_campaigns").update(row).eq("id", c.id) : await sb.from("b2b_campaigns").insert(row);
      fail(error);
    },
    async deleteCampaign(id) {
      const { error } = await sb.from("b2b_campaigns").delete().eq("id", id);
      fail(error);
    },
    async listStaff() {
      const { data, error } = await sb.from("b2b_users").select("user_id, email, name, role").in("role", ["admin", "comercial"]).order("role");
      fail(error);
      return (data ?? []).map((r: Row): StaffUser => ({ userId: r.user_id, email: r.email ?? "", name: r.name, role: r.role }));
    },
    async inviteStaff(email, name) {
      const { data, error } = await sb.functions.invoke("invite-client", { body: { email, name, role: "comercial" } });
      if (error) throw new Error("Não foi possível enviar o convite. Confirme que a função invite-client está publicada.");
      return (data as Row)?.message ?? "Convite enviado por email.";
    },
    async removeStaff(userId) {
      const { error } = await sb.from("b2b_users").delete().eq("user_id", userId).eq("role", "comercial");
      fail(error);
    },

    async listQuotes() {
      const { data, error } = await sb.from("b2b_quotes").select("*").order("created_at", { ascending: false }).limit(500);
      fail(error);
      return (data ?? []).map((q: Row) => mapQuote({ ...q, b2b_quote_lines: [] }));
    },
    async getQuote(id) {
      const { data, error } = await sb.from("b2b_quotes").select("*, b2b_quote_lines(*)").eq("id", id).single();
      fail(error);
      return mapQuote(data as Row);
    },
    async saveQuote(q) {
      const { data, error } = await sb.rpc("b2b_save_quote", {
        p_quote: {
          id: q.id ?? "",
          clientId: q.clientId ?? "",
          customerName: q.customerName,
          customerNif: q.customerNif ?? "",
          customerEmail: q.customerEmail ?? "",
          customerPhone: q.customerPhone ?? "",
          customerAddress: q.customerAddress ?? "",
          contactName: q.contactName ?? "",
          status: q.status,
          validUntil: q.validUntil ?? "",
          deliveryTerms: q.deliveryTerms ?? "",
          paymentTerms: q.paymentTerms ?? "",
          notes: q.notes ?? "",
          internalNote: q.internalNote ?? "",
        },
        p_lines: q.lines,
      });
      fail(error);
      return data as { id: string; number: string };
    },
    async deleteQuote(id) {
      const { error } = await sb.from("b2b_quotes").delete().eq("id", id);
      fail(error);
    },
  };
  return self;
}
