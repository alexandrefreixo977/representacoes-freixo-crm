import type {
  AccessRequest,
  CartItem,
  Catalog,
  Client,
  DiscountRule,
  ImportResult,
  Order,
  OrderStatus,
  PriceImportRow,
  Pricing,
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
  onSessionChange(cb: () => void): () => void;

  /** Público: sem preços. */
  getCatalog(): Promise<Catalog>;
  requestAccess(req: Omit<AccessRequest, "id" | "createdAt">): Promise<void>;

  /** Só com sessão iniciada. */
  getPricing(): Promise<Pricing>;
  submitOrder(items: CartItem[], customerRef: string, notes: string): Promise<SubmitResult>;
  listMyOrders(): Promise<Order[]>;

  /** Só gestão (Freixo). */
  listOrders(): Promise<Order[]>;
  setOrderStatus(orderId: string, status: OrderStatus, internalNote?: string): Promise<void>;
  listClients(): Promise<Client[]>;
  saveClient(client: Omit<Client, "id"> & { id?: string }): Promise<Client>;
  inviteClientUser(clientId: string, email: string): Promise<string>;
  listRules(): Promise<DiscountRule[]>;
  saveRule(rule: Omit<DiscountRule, "id"> & { id?: string }): Promise<void>;
  deleteRule(id: string): Promise<void>;
  importPriceList(manufacturerId: string, rows: PriceImportRow[]): Promise<ImportResult>;
  listAccessRequests(): Promise<AccessRequest[]>;
}
