import type { CampaignImportRow } from "../campaignImport";
import type {
  AccessRequest,
  Campaign,
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
  Quote,
  Session,
  StaffUser, CampaignImportResult } from "../types";

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
  listCampaigns(): Promise<Campaign[]>;
  /** Devolve o id da campanha. */
  saveCampaign(c: Omit<Campaign, "id"> & { id?: string }): Promise<string>;
  /** Grava os preços de campanha lidos do ficheiro do fabricante (replace = apaga os anteriores). */
  importCampaign(campaignId: string, rows: CampaignImportRow[], replace: boolean): Promise<CampaignImportResult>;
  deleteCampaign(id: string): Promise<void>;
  listStaff(): Promise<StaffUser[]>;
  inviteStaff(email: string, name: string): Promise<string>;
  removeStaff(userId: string): Promise<void>;

  /** Equipa Freixo (gestão e comercial). O comercial só vê as suas propostas; a gestão vê todas. */
  listQuotes(): Promise<Quote[]>;
  getQuote(id: string): Promise<Quote>;
  saveQuote(quote: Quote): Promise<{ id: string; number: string }>;
  deleteQuote(id: string): Promise<void>;
}
