import { needsVariant, normRef, normSearch, splitByManufacturer, variantLabel } from "../pricing";
import type { AccessRequest, Campaign, Catalog, Client, DiscountRule, Manufacturer, Order, Product, Quote, Session } from "../types";
import { slugify } from "../slug";
import type { Api } from "./api";
import { seedCampaigns, seedClients, seedFamilies, seedManufacturers, seedPrices, seedProducts, seedRules } from "./demo-seed";

// Modo demonstração: tudo fica guardado só neste browser (localStorage).
// Contas: cliente@demo.pt / demo, gestao@demo.pt / demo e comercial@demo.pt / demo

type DemoDb = {
  manufacturers?: Manufacturer[];
  products: Product[];
  prices: Record<string, number>;
  families: typeof seedFamilies;
  clients: Client[];
  rules: DiscountRule[];
  orders: Order[];
  requests: AccessRequest[];
  users: { email: string; password: string; role: "client" | "admin" | "comercial"; clientId?: string; name?: string }[];
  quotes?: Quote[];
  campaigns?: Campaign[];
  session: string | null;
  seq: number;
};

const KEY = "freixo-b2b-demo-v1";
const uid = () => Math.random().toString(36).slice(2, 10);

function fresh(): DemoDb {
  return {
    products: seedProducts,
    prices: seedPrices,
    families: seedFamilies,
    clients: seedClients,
    rules: seedRules,
    orders: [],
    requests: [],
    users: [
      { email: "cliente@demo.pt", password: "demo", role: "client", clientId: "cl-1" },
      { email: "gestao@demo.pt", password: "demo", role: "admin", name: "Gestão Demo" },
      { email: "comercial@demo.pt", password: "demo", role: "comercial", name: "Comercial Demo" },
    ],
    session: null,
    seq: 0,
  };
}

let memory: DemoDb | null = null;
function load(): DemoDb {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    memory = raw ? (JSON.parse(raw) as DemoDb) : fresh();
  } catch {
    memory = fresh();
  }
  return memory;
}
function save(db: DemoDb) {
  memory = db;
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* sem armazenamento: fica só em memória */
  }
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((cb) => cb());

function currentSession(db: DemoDb): Session | null {
  const user = db.users.find((u) => u.email === db.session);
  if (!user) return null;
  return {
    userId: user.email,
    email: user.email,
    role: user.role,
    name: user.name ?? null,
    client: user.clientId ? db.clients.find((c) => c.id === user.clientId) ?? null : null,
  };
}

function requireSession(db: DemoDb, role?: "admin" | "staff") {
  const s = currentSession(db);
  if (!s) throw new Error("Inicie sessão para continuar.");
  if (role === "admin" && s.role !== "admin") throw new Error("Sem permissão.");
  if (role === "staff" && s.role === "client") throw new Error("Sem permissão.");
  return s;
}

export const demoApi: Api = {
  mode: "demo",
  async getSession() {
    return currentSession(load());
  },
  async signIn(email, password) {
    const db = load();
    const user = db.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.password === password);
    if (!user) throw new Error("Email ou palavra-passe incorretos.");
    save({ ...db, session: user.email });
    notify();
    return currentSession(load())!;
  },
  async signOut() {
    save({ ...load(), session: null });
    notify();
  },
  async setPassword() {
    /* demonstração: nada a fazer */
  },
  async resetPassword() {
    /* demonstração: nada a fazer */
  },
  onSessionChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },

  async getCatalog(): Promise<Catalog> {
    const db = load();
    const campaignProducts = new Set((db.campaigns ?? seedCampaigns).map((c) => c.productId));
    return {
      manufacturers: (db.manufacturers ?? seedManufacturers).filter((m) => m.active !== false).sort((a, b) => a.sort - b.sort),
      families: db.families,
      products: db.products.filter((p) => campaignProducts.has(p.id)),
      campaigns: (db.campaigns ?? seedCampaigns).filter((c) => c.active !== false && (!c.membersOnly || !!currentSession(db))),
    };
  },
  async searchProducts({ manufacturerId, familyId, q, onlyNew, includeInactive, noImage, offset, limit }) {
    const terms = normSearch(q ?? "").split(/\s+/).filter(Boolean);
    const found = load()
      .products.filter((p) => {
        if (manufacturerId && p.manufacturerId !== manufacturerId) return false;
        if (familyId && p.familyId !== familyId) return false;
        if (onlyNew && !p.isNew) return false;
        if (!includeInactive && p.active === false) return false;
        if (noImage && p.imageUrl) return false;
        const hay = normSearch(`${p.reference} ${p.designation} ${p.ean ?? ""}`);
        return terms.every((t) => hay.includes(t));
      })
      .sort((a, b) => a.designation.localeCompare(b.designation));
    return { products: found.slice(offset, offset + limit), total: found.length };
  },
  async getProducts(ids) {
    const wanted = new Set(ids);
    return load().products.filter((p) => wanted.has(p.id));
  },
  async findProducts(refs, manufacturerId) {
    const keys = new Set(refs.map(normRef));
    return load().products.filter(
      (p) => (!manufacturerId || p.manufacturerId === manufacturerId) && (keys.has(normRef(p.reference)) || (!!p.ean && keys.has(normRef(p.ean))))
    );
  },
  async requestAccess(req) {
    const db = load();
    save({ ...db, requests: [{ ...req, id: uid(), createdAt: new Date().toISOString() }, ...db.requests] });
  },

  async getPricing() {
    const db = load();
    const s = requireSession(db);
    return {
      listPrices: db.prices,
      rules: db.rules.filter((r) => s.role !== "client" || !r.clientId || r.clientId === s.client?.id),
    };
  },
  async getPrices(productIds) {
    const db = load();
    requireSession(db);
    return { listPrices: Object.fromEntries(productIds.filter((id) => db.prices[id] != null).map((id) => [id, db.prices[id]])), weldPrices: {} };
  },
  async submitOrder(items, customerRef, notes) {
    const db = load();
    const s = requireSession(db);
    if (!s.client) throw new Error("Esta conta não está associada a um cliente.");
    const pricing = { listPrices: db.prices, rules: db.rules };
    const groups = splitByManufacturer(items, db.products, pricing, s.client.id);
    if (!groups.length) throw new Error("O carrinho está vazio.");
    const unsized = groups.flatMap((g) => g.items).find((i) => needsVariant(i.product, i.variant));
    if (unsized) throw new Error(`Indique o tamanho do artigo ${unsized.product.reference}`);
    const seq = db.seq + 1;
    const groupNumber = `ENC-${new Date().getFullYear()}-${String(seq).padStart(4, "0")}`;
    const createdAt = new Date().toISOString();
    const orders: Order[] = groups.map((g, i) => ({
      id: uid(),
      number: `${groupNumber}/${i + 1}`,
      groupNumber,
      clientId: s.client!.id,
      clientName: s.client!.name,
      manufacturerId: g.manufacturerId,
      status: "pending",
      customerRef,
      notes,
      subtotal: g.subtotal,
      createdAt,
      lines: g.items.map(({ product, qty, variant, price, total }) => ({
        productId: product.id,
        variant: variant ?? null,
        reference: product.reference,
        designation: product.designation + (variant ? ` · ${variantLabel(product, variant)}` : ""),
        salesUnit: product.salesUnit,
        qty,
        listPrice: price?.listPrice ?? 0,
        discounts: price?.discounts ?? [],
        netPrice: price?.netPrice ?? 0,
        lineTotal: total,
      })),
    }));
    save({ ...db, seq, orders: [...orders, ...db.orders] });
    return { groupNumber, orders };
  },
  async listMyOrders() {
    const db = load();
    const s = requireSession(db);
    return db.orders.filter((o) => o.clientId === s.client?.id);
  },

  async listOrders() {
    const db = load();
    requireSession(db, "admin");
    return db.orders;
  },
  async setOrderStatus(orderId, status, internalNote) {
    const db = load();
    requireSession(db, "admin");
    save({
      ...db,
      orders: db.orders.map((o) => (o.id === orderId ? { ...o, status, internalNote: internalNote ?? o.internalNote } : o)),
    });
  },
  async listManufacturers() {
    const db = load();
    requireSession(db, "admin");
    return [...(db.manufacturers ?? seedManufacturers)].sort((a, b) => a.sort - b.sort);
  },
  async saveManufacturer(m) {
    const db = load();
    requireSession(db, "admin");
    const list = db.manufacturers ?? seedManufacturers;
    const saved: Manufacturer = { ...m, id: m.id ?? uid(), slug: slugify(m.name), active: m.active !== false };
    const exists = list.some((x) => x.id === saved.id);
    save({ ...db, manufacturers: exists ? list.map((x) => (x.id === saved.id ? saved : x)) : [...list, saved] });
  },
  async listClients() {
    const db = load();
    requireSession(db, "staff");
    return db.clients;
  },
  async saveClient(client) {
    const db = load();
    requireSession(db, "admin");
    const saved = { ...client, id: client.id ?? uid() } as Client;
    const exists = db.clients.some((c) => c.id === saved.id);
    save({ ...db, clients: exists ? db.clients.map((c) => (c.id === saved.id ? saved : c)) : [...db.clients, saved] });
    return saved;
  },
  async inviteClientUser(clientId, email) {
    const db = load();
    requireSession(db, "admin");
    if (db.users.some((u) => u.email === email)) throw new Error("Já existe uma conta com este email.");
    save({ ...db, users: [...db.users, { email, password: "demo", role: "client", clientId }] });
    return "Conta criada. Em modo demonstração a palavra-passe é \"demo\".";
  },
  async listRules() {
    const db = load();
    requireSession(db, "admin");
    return db.rules;
  },
  async saveRule(rule) {
    const db = load();
    requireSession(db, "admin");
    const saved = { ...rule, id: rule.id ?? uid() } as DiscountRule;
    const exists = db.rules.some((r) => r.id === saved.id);
    save({ ...db, rules: exists ? db.rules.map((r) => (r.id === saved.id ? saved : r)) : [...db.rules, saved] });
  },
  async deleteRule(id) {
    const db = load();
    requireSession(db, "admin");
    save({ ...db, rules: db.rules.filter((r) => r.id !== id) });
  },
  async importPriceList(manufacturerId, rows) {
    const db = load();
    requireSession(db, "admin");
    const products = [...db.products];
    const prices = { ...db.prices };
    const families = [...db.families];
    let created = 0, updated = 0, skipped = 0;
    for (const row of rows) {
      const existing = products.find((p) => p.manufacturerId === manufacturerId && normRef(p.reference) === normRef(row.reference));
      let familyId: string | undefined;
      if (row.family) {
        let fam = families.find((f) => f.manufacturerId === manufacturerId && f.name.toLowerCase() === row.family!.toLowerCase());
        if (!fam) {
          fam = { id: uid(), manufacturerId, name: row.family };
          families.push(fam);
        }
        familyId = fam.id;
      }
      if (existing) {
        products[products.indexOf(existing)] = {
          ...existing,
          designation: row.designation ?? existing.designation,
          salesUnit: row.salesUnit ?? existing.salesUnit,
          packQty: row.packQty ?? existing.packQty,
          familyId: familyId ?? existing.familyId,
          ean: row.ean ?? existing.ean,
        };
        if (row.listPrice != null) prices[existing.id] = row.listPrice;
        updated++;
      } else if (row.designation && row.listPrice != null) {
        const id = uid();
        products.push({
          id,
          manufacturerId,
          familyId,
          reference: row.reference,
          designation: row.designation,
          ean: row.ean,
          salesUnit: row.salesUnit ?? "un",
          packQty: row.packQty ?? 1,
          moq: row.packQty ?? 1,
          isNew: true,
        });
        prices[id] = row.listPrice;
        created++;
      } else {
        skipped++;
      }
    }
    save({ ...db, products, prices, families });
    return { created, updated, skipped };
  },
  async getProductForEdit(id) {
    const db = load();
    requireSession(db, "admin");
    const p = db.products.find((x) => x.id === id);
    if (!p) throw new Error("Artigo não encontrado.");
    return { ...p, active: p.active !== false, listPrice: db.prices[id] ?? null, weldPrice: null };
  },
  async saveProduct(edit) {
    const db = load();
    requireSession(db, "admin");
    const { listPrice, weldPrice: _w, newFamily, ...fields } = edit;
    const families = [...db.families];
    let familyId = fields.familyId || null;
    if (newFamily?.trim()) {
      let fam = families.find((f) => f.manufacturerId === fields.manufacturerId && f.name.toLowerCase() === newFamily.trim().toLowerCase());
      if (!fam) families.push((fam = { id: uid(), manufacturerId: fields.manufacturerId, name: newFamily.trim() }));
      familyId = fam.id;
    }
    const clash = db.products.find((x) => x.id !== fields.id && x.manufacturerId === fields.manufacturerId && normRef(x.reference) === normRef(fields.reference));
    if (clash) throw new Error(`Já existe um artigo ${fields.reference} nesta marca.`);
    const product = { ...fields, id: fields.id ?? uid(), familyId };
    const products = fields.id ? db.products.map((x) => (x.id === fields.id ? product : x)) : [...db.products, product];
    const prices = { ...db.prices };
    if (listPrice != null) prices[product.id] = listPrice;
    else delete prices[product.id];
    save({ ...db, products, prices, families });
    return product;
  },
  async uploadImage(file) {
    // Na demonstração a foto fica no próprio browser.
    return await new Promise<string>((ok, ko) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = () => ko(new Error("Não consegui ler a foto."));
      r.readAsDataURL(file);
    });
  },
  async renameFamily(familyId, name) {
    const db = load();
    requireSession(db, "admin");
    save({ ...db, families: db.families.map((f) => (f.id === familyId ? { ...f, name: name.trim() } : f)) });
  },
  async listAccessRequests() {
    const db = load();
    requireSession(db, "admin");
    return db.requests;
  },
  async listCampaigns() {
    const db = load();
    requireSession(db, "admin");
    return db.campaigns ?? seedCampaigns;
  },
  async saveCampaign(c) {
    const db = load();
    requireSession(db, "admin");
    const list = db.campaigns ?? seedCampaigns;
    const saved = { ...c, id: c.id ?? uid() } as Campaign;
    save({ ...db, campaigns: list.some((x) => x.id === saved.id) ? list.map((x) => (x.id === saved.id ? saved : x)) : [...list, saved] });
    return saved.id;
  },
  async importCampaign(campaignId, rows, replace) {
    const db = load();
    requireSession(db, "admin");
    const campaign = (db.campaigns ?? seedCampaigns).find((c) => c.id === campaignId);
    if (!campaign?.manufacturerId) throw new Error("Escolha a marca da campanha antes de importar");
    let rules = replace ? db.rules.filter((r) => r.campaignId !== campaignId) : db.rules;
    const missing: string[] = [];
    let applied = 0;
    for (const row of rows) {
      if (row.netPrice == null) continue;
      const product = db.products.find((p) => p.manufacturerId === campaign.manufacturerId && normRef(p.reference) === normRef(row.reference));
      if (!product) {
        missing.push(row.reference);
        continue;
      }
      rules = rules.filter((r) => !(r.campaignId === campaignId && r.productId === product.id));
      rules.push({ id: uid(), manufacturerId: product.manufacturerId, productId: product.id, discounts: [], specialNetPrice: row.netPrice, campaignId, offerQty: row.offerQty ?? null });
      applied++;
    }
    save({ ...db, rules });
    return { applied, created: 0, missing };
  },
  async deleteCampaign(id) {
    const db = load();
    requireSession(db, "admin");
    save({ ...db, campaigns: (db.campaigns ?? seedCampaigns).filter((x) => x.id !== id) });
  },
  async listStaff() {
    const db = load();
    requireSession(db, "admin");
    return db.users
      .filter((u) => u.role !== "client")
      .map((u) => ({ userId: u.email, email: u.email, name: u.name ?? null, role: u.role as "admin" | "comercial" }));
  },
  async inviteStaff(email, name) {
    const db = load();
    requireSession(db, "admin");
    if (db.users.some((u) => u.email === email)) throw new Error("Já existe uma conta com este email.");
    save({ ...db, users: [...db.users, { email, password: "demo", role: "comercial", name }] });
    return "Conta criada. Em modo demonstração a palavra-passe é \"demo\".";
  },
  async removeStaff(userId) {
    const db = load();
    requireSession(db, "admin");
    save({ ...db, users: db.users.filter((u) => !(u.email === userId && u.role === "comercial")) });
  },

  async listQuotes() {
    const db = load();
    const s = requireSession(db, "staff");
    return (db.quotes ?? []).filter((q) => s.role === "admin" || q.ownerId === s.userId);
  },
  async getQuote(id) {
    const q = (await this.listQuotes()).find((x) => x.id === id);
    if (!q) throw new Error("Proposta não encontrada.");
    return q;
  },
  async saveQuote(quote) {
    const db = load();
    const s = requireSession(db, "staff");
    if (!quote.customerName.trim()) throw new Error("Indique o cliente da proposta");
    const quotes = db.quotes ?? [];
    const old = quote.id ? quotes.find((q) => q.id === quote.id && (s.role === "admin" || q.ownerId === s.userId)) : undefined;
    if (quote.id && !old) throw new Error("Proposta não encontrada");
    const seq = db.seq + 1;
    const lines = quote.lines
      .filter((l) => l.qty > 0 && l.reference.trim())
      .map((l) => ({ ...l, lineTotal: Math.round(l.netPrice * l.qty * 100) / 100 }));
    const saved: Quote = {
      ...quote,
      id: old?.id ?? uid(),
      number: old?.number ?? `PROP-${new Date().getFullYear()}-${String(seq).padStart(4, "0")}`,
      ownerId: old?.ownerId ?? s.userId,
      ownerName: old?.ownerName ?? s.name ?? s.email,
      ownerEmail: old?.ownerEmail ?? s.email,
      createdAt: old?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lines,
      total: Math.round(lines.reduce((t, l) => t + l.lineTotal, 0) * 100) / 100,
    };
    save({ ...db, seq: old ? db.seq : seq, quotes: old ? quotes.map((q) => (q.id === old.id ? saved : q)) : [saved, ...quotes] });
    return { id: saved.id!, number: saved.number! };
  },
  async deleteQuote(id) {
    const db = load();
    const s = requireSession(db, "staff");
    save({ ...db, quotes: (db.quotes ?? []).filter((q) => !(q.id === id && (s.role === "admin" || q.ownerId === s.userId))) });
  },
};

// Usado pelos testes e pelo botão "repor dados de demonstração".
export function resetDemo() {
  save(fresh());
  notify();
}
