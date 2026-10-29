import { normRef, splitByManufacturer } from "../pricing";
import type { AccessRequest, Catalog, Client, DiscountRule, Order, Product, Session } from "../types";
import type { Api } from "./api";
import { seedCampaigns, seedClients, seedFamilies, seedManufacturers, seedPrices, seedProducts, seedRules } from "./demo-seed";

// Modo demonstração: tudo fica guardado só neste browser (localStorage).
// Contas: cliente@demo.pt / demo  e  gestao@demo.pt / demo

type DemoDb = {
  products: Product[];
  prices: Record<string, number>;
  families: typeof seedFamilies;
  clients: Client[];
  rules: DiscountRule[];
  orders: Order[];
  requests: AccessRequest[];
  users: { email: string; password: string; role: "client" | "admin"; clientId?: string }[];
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
      { email: "gestao@demo.pt", password: "demo", role: "admin" },
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
    client: user.clientId ? db.clients.find((c) => c.id === user.clientId) ?? null : null,
  };
}

function requireSession(db: DemoDb, role?: "admin") {
  const s = currentSession(db);
  if (!s) throw new Error("Inicie sessão para continuar.");
  if (role === "admin" && s.role !== "admin") throw new Error("Sem permissão.");
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
  async resetPassword() {
    /* demonstração: nada a fazer */
  },
  onSessionChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },

  async getCatalog(): Promise<Catalog> {
    const db = load();
    return { manufacturers: seedManufacturers, families: db.families, products: db.products, campaigns: seedCampaigns };
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
      rules: db.rules.filter((r) => s.role === "admin" || !r.clientId || r.clientId === s.client?.id),
    };
  },
  async submitOrder(items, customerRef, notes) {
    const db = load();
    const s = requireSession(db);
    if (!s.client) throw new Error("Esta conta não está associada a um cliente.");
    const pricing = { listPrices: db.prices, rules: db.rules };
    const groups = splitByManufacturer(items, db.products, pricing, s.client.id);
    if (!groups.length) throw new Error("O carrinho está vazio.");
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
      lines: g.items.map(({ product, qty, price, total }) => ({
        productId: product.id,
        reference: product.reference,
        designation: product.designation,
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
  async listClients() {
    const db = load();
    requireSession(db, "admin");
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
  async listAccessRequests() {
    const db = load();
    requireSession(db, "admin");
    return db.requests;
  },
};

// Usado pelos testes e pelo botão "repor dados de demonstração".
export function resetDemo() {
  save(fresh());
  notify();
}
