import type {
  AccessRequest,
  CartItem,
  Catalog,
  Client,
  DiscountRule,
  ImportResult,
  Manufacturer,
  Order,
  OrderStatus,
  PriceImportRow,
  Pricing,
  Product,
  ProductPage,
  ProductQuery,
  Session,
} from "../types";

export type SubmitResult = { groupNumber: string; orders: Order[] };

/** Tudo o que a app pede aos dados. Há duas implementações: demonstração (browser) e Supabase. */
export interface Api {
  mode: "demo" | "supabase";
  getSession(): Promise<Session | null>;
  signIn(email: string, password: string): Promise<Session>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  /** Define a palavra-passe da conta com sessão iniciada (depois de um convite ou recuperação). */
  setPassword(password: string): Promise<void>;
  onSessionChange(cb: () => void): () => void;

  /** Público: sem preços. */
  getCatalog(): Promise<Catalog>;
  /** Pesquisa paginada no servidor. A pesquisa ignora maiúsculas e acentos. */
  searchProducts(query: ProductQuery): Promise<ProductPage>;
  getProducts(ids: string[]): Promise<Product[]>;
  /** Procura por referência (ignora espaços, pontos, hífenes e barras) ou EAN. */
  findProducts(refs: string[], manufacturerId?: string): Promise<Product[]>;
  requestAccess(req: Omit<AccessRequest, "id" | "createdAt">): Promise<void>;

  /** Só com sessão iniciada. getPricing traz as regras; os preços de tabela pedem-se com getPrices. */
  getPricing(): Promise<Pricing>;
  getPrices(productIds: string[]): Promise<{ listPrices: Record<string, number>; weldPrices: Record<string, number> }>;
  submitOrder(items: CartItem[], customerRef: string, notes: string): Promise<SubmitResult>;
  listMyOrders(): Promise<Order[]>;

  /** Só gestão (Freixo). */
  listOrders(): Promise<Order[]>;
  setOrderStatus(orderId: string, status: OrderStatus, internalNote?: string): Promise<void>;
  listManufacturers(): Promise<Manufacturer[]>;
  saveManufacturer(m: Omit<Manufacturer, "id" | "slug"> & { id?: string }): Promise<void>;
  listClients(): Promise<Client[]>;
  saveClient(client: Omit<Client, "id"> & { id?: string }): Promise<Client>;
  inviteClientUser(clientId: string, email: string): Promise<string>;
  listRules(): Promise<DiscountRule[]>;
  saveRule(rule: Omit<DiscountRule, "id"> & { id?: string }): Promise<void>;
  deleteRule(id: string): Promise<void>;
  importPriceList(manufacturerId: string, rows: PriceImportRow[]): Promise<ImportResult>;
  listAccessRequests(): Promise<AccessRequest[]>;
}
