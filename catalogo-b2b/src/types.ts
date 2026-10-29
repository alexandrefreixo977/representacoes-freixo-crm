export type Manufacturer = {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  ordersEmail?: string | null;
  sort: number;
  active?: boolean;
};

export type Family = { id: string; manufacturerId: string; name: string };

export type Product = {
  id: string;
  manufacturerId: string;
  familyId?: string | null;
  reference: string;
  ean?: string | null;
  designation: string;
  description?: string | null;
  imageUrl?: string | null;
  techSheetUrl?: string | null;
  salesUnit: string;
  /** Unidades por caixa/embalagem. A quantidade encomendada é sempre múltipla deste valor. */
  packQty: number;
  /** Encomenda mínima (em unidades). */
  moq: number;
  isNew: boolean;
};

export type Campaign = {
  id: string;
  title: string;
  subtitle?: string | null;
  badge?: string | null;
  imageUrl?: string | null;
  manufacturerId?: string | null;
  productId?: string | null;
};

export type Catalog = {
  manufacturers: Manufacturer[];
  families: Family[];
  products: Product[];
  campaigns: Campaign[];
};

/** Regra comercial. client_id vazio = regra geral para todos os clientes. */
export type DiscountRule = {
  id: string;
  clientId?: string | null;
  manufacturerId: string;
  familyId?: string | null;
  productId?: string | null;
  /** Descontos sucessivos, ex. [40, 5] = 40% + 5%. */
  discounts: number[];
  /** Preço líquido especial: substitui os descontos. */
  specialNetPrice?: number | null;
};

export type Pricing = {
  listPrices: Record<string, number>;
  rules: DiscountRule[];
};

export type PriceInfo = {
  listPrice: number;
  discounts: number[];
  netPrice: number;
  special: boolean;
};

export type Client = {
  id: string;
  name: string;
  nif?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
};

export type Session = {
  userId: string;
  email: string;
  role: "client" | "admin";
  client?: Client | null;
};

export type CartItem = { productId: string; qty: number };

export type OrderStatus = "pending" | "validated" | "sent" | "confirmed" | "delivered" | "cancelled";

export type OrderLine = {
  productId: string;
  reference: string;
  designation: string;
  salesUnit: string;
  qty: number;
  listPrice: number;
  discounts: number[];
  netPrice: number;
  lineTotal: number;
};

export type Order = {
  id: string;
  number: string;
  groupNumber: string;
  clientId: string;
  clientName: string;
  manufacturerId: string;
  status: OrderStatus;
  customerRef?: string | null;
  notes?: string | null;
  internalNote?: string | null;
  subtotal: number;
  createdAt: string;
  lines: OrderLine[];
};

export type AccessRequest = {
  id: string;
  company: string;
  nif?: string;
  name: string;
  email: string;
  phone?: string;
  message?: string;
  createdAt: string;
};

export type PriceImportRow = {
  reference: string;
  designation?: string;
  listPrice?: number;
  salesUnit?: string;
  packQty?: number;
  family?: string;
  ean?: string;
};

export type ImportResult = { created: number; updated: number; skipped: number };
