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
  /** Calçado ou vestuário: o cliente tem de escolher o tamanho. "medida": fita à medida, o cliente indica o comprimento em mm. */
  sizeType?: "calcado" | "vestuario" | "medida" | null;
};

export type Campaign = {
  id: string;
  title: string;
  subtitle?: string | null;
  badge?: string | null;
  imageUrl?: string | null;
  manufacturerId?: string | null;
  productId?: string | null;
  /** Só para revendedores com conta (os visitantes não a veem). */
  membersOnly?: boolean;
  /** Condições da campanha, mostradas na página da campanha. */
  details?: string | null;
  /** Só na gestão. */
  startsOn?: string | null;
  endsOn?: string | null;
  active?: boolean;
  sort?: number;
};

export type Catalog = {
  manufacturers: Manufacturer[];
  families: Family[];
  /** Só os artigos das campanhas. Os restantes pedem-se ao servidor com searchProducts(). */
  products: Product[];
  campaigns: Campaign[];
};

export type ProductQuery = {
  manufacturerId?: string;
  familyId?: string;
  q?: string;
  onlyNew?: boolean;
  offset: number;
  limit: number;
};

export type ProductPage = { products: Product[]; total: number };

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
  /** Preço de uma campanha (aparece na página da campanha). */
  campaignId?: string | null;
  /** Quantidade de referência da oferta do fabricante (só informativo). */
  offerQty?: number | null;
};

export type Pricing = {
  /** Preços de tabela dos artigos já carregados (vão sendo pedidos à medida que aparecem). */
  listPrices: Record<string, number>;
  /** Fitas à medida: preço da soldadura de cada fita (o preço de tabela delas é por metro). */
  weldPrices?: Record<string, number>;
  rules: DiscountRule[];
};

export type PriceInfo = {
  listPrice: number;
  discounts: number[];
  netPrice: number;
  special: boolean;
  /** Preço de campanha. */
  campaignId?: string | null;
  offerQty?: number | null;
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
  /** admin = gestão Freixo; comercial = equipa comercial (propostas); client = revendedor. */
  role: "client" | "admin" | "comercial";
  name?: string | null;
  client?: Client | null;
};

/** variant = tamanho escolhido (só para artigos com sizeType). */
export type CartItem = { productId: string; qty: number; variant?: string };

export type OrderStatus = "pending" | "validated" | "sent" | "confirmed" | "delivered" | "cancelled";

export type OrderLine = {
  productId: string;
  variant?: string | null;
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

export type QuoteStatus = "draft" | "sent" | "accepted" | "lost";

export type QuoteLine = {
  productId?: string | null;
  manufacturerName?: string | null;
  reference: string;
  designation: string;
  variant?: string | null;
  salesUnit: string;
  qty: number;
  listPrice: number;
  discounts: number[];
  netPrice: number;
  lineTotal: number;
};

/** Proposta comercial. clientId vazio = potencial cliente (dados escritos na proposta). */
export type Quote = {
  id?: string;
  number?: string;
  ownerId?: string;
  ownerName?: string | null;
  ownerEmail?: string | null;
  clientId?: string | null;
  customerName: string;
  customerNif?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  contactName?: string | null;
  status: QuoteStatus;
  validUntil?: string | null;
  deliveryTerms?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  internalNote?: string | null;
  total: number;
  createdAt?: string;
  updatedAt?: string;
  lines: QuoteLine[];
};

/** Membro da equipa Freixo com acesso à app. */
export type StaffUser = { userId: string; email: string; name?: string | null; role: "admin" | "comercial" };
