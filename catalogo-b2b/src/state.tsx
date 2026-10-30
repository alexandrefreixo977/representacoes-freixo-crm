import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./data";
import { normalizeQty, priceFor } from "./pricing";
import type { CartItem, Catalog, PriceInfo, Pricing, Product, Session } from "./types";

type Route = { page: string; params: URLSearchParams };

function readRoute(): Route {
  const raw = location.hash.replace(/^#\/?/, "");
  const [page, query] = raw.split("?");
  return { page: page || "", params: new URLSearchParams(query ?? "") };
}

export function go(page: string, params?: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([k, v]) => v && q.set(k, v));
  const qs = q.toString();
  location.hash = `#/${page}${qs ? `?${qs}` : ""}`;
}

type Ctx = {
  route: Route;
  catalog: Catalog | null;
  catalogError: string | null;
  session: Session | null;
  pricing: Pricing | null;
  cart: CartItem[];
  /** Artigos já carregados (pesquisas, carrinho, encomendas). */
  productsById: Map<string, Product>;
  remember: (products: Product[]) => void;
  /** Garante que estes artigos estão carregados e devolve-os. */
  ensureProducts: (ids: string[]) => Promise<Product[]>;
  price: (p: Product) => PriceInfo | null;
  setQty: (productId: string, qty: number, variant?: string) => void;
  addToCart: (product: Product, qty: number, variant?: string) => void;
  clearCart: () => void;
  cartCount: number;
  toast: (msg: string) => void;
  toastMsg: string | null;
  refreshCatalog: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

const CART_KEY = "freixo-b2b-cart";
function loadCart(): CartItem[] {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState(readRoute);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [cart, setCart] = useState<CartItem[]>(loadCart);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [productsById, setProductsById] = useState<Map<string, Product>>(() => new Map());
  const knownIds = useRef(new Set<string>());
  const pricedIds = useRef(new Set<string>());

  useEffect(() => {
    const onHash = () => {
      setRoute(readRoute());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const remember = useCallback((products: Product[]) => {
    const fresh = products.filter((p) => !knownIds.current.has(p.id));
    if (!fresh.length) return;
    fresh.forEach((p) => knownIds.current.add(p.id));
    setProductsById((m) => {
      const next = new Map(m);
      fresh.forEach((p) => next.set(p.id, p));
      return next;
    });
  }, []);

  const ensureProducts = useCallback(
    async (ids: string[]) => {
      const missing = [...new Set(ids)].filter((id) => !knownIds.current.has(id));
      const loaded = missing.length ? await api.getProducts(missing) : [];
      remember(loaded);
      const all = new Map(productsById);
      loaded.forEach((p) => all.set(p.id, p));
      return ids.map((id) => all.get(id)).filter((p): p is Product => !!p);
    },
    [productsById, remember]
  );

  const refreshCatalog = useCallback(async () => {
    try {
      const c = await api.getCatalog();
      remember(c.products);
      setCatalog(c);
      setCatalogError(null);
    } catch (e) {
      setCatalogError((e as Error).message);
    }
  }, [remember]);

  const refreshSession = useCallback(async () => {
    const s = await api.getSession().catch(() => null);
    pricedIds.current = new Set();
    setSession(s);
    setPricing(s ? await api.getPricing().catch(() => null) : null);
  }, []);

  // Pede os preços de tabela dos artigos que vão aparecendo (só com sessão iniciada).
  useEffect(() => {
    if (!session || !pricing) return;
    const missing = [...productsById.keys()].filter((id) => !pricedIds.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => pricedIds.current.add(id));
    api
      .getPrices(missing)
      .then((prices) =>
        setPricing((p) =>
          p ? { ...p, listPrices: { ...p.listPrices, ...prices.listPrices }, weldPrices: { ...p.weldPrices, ...prices.weldPrices } } : p
        )
      )
      .catch(() => missing.forEach((id) => pricedIds.current.delete(id)));
  }, [productsById, session, pricing]);

  // O carrinho fica guardado no browser: carrega os artigos dele ao abrir a app.
  useEffect(() => {
    if (!cart.length) return;
    ensureProducts(cart.map((i) => i.productId))
      .then((found) => {
        // Artigos que deixaram de existir saem do carrinho.
        const ok = new Set(found.map((p) => p.id));
        setCart((c) => c.filter((i) => ok.has(i.productId)));
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshCatalog();
    refreshSession();
    return api.onSessionChange(() => refreshSession());
  }, [refreshCatalog, refreshSession]);

  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      /* ignora */
    }
  }, [cart]);

  const price = useCallback((p: Product) => priceFor(p, pricing, session?.client?.id), [pricing, session]);

  const same = (i: CartItem, productId: string, variant?: string) => i.productId === productId && (i.variant ?? "") === (variant ?? "");
  const setQty = useCallback(
    (productId: string, qty: number, variant?: string) =>
      setCart((c) => (qty <= 0 ? c.filter((i) => !same(i, productId, variant)) : c.map((i) => (same(i, productId, variant) ? { ...i, qty } : i)))),
    []
  );

  const addToCart = useCallback(
    (product: Product, qty: number, variant?: string) => {
      remember([product]);
      const productId = product.id;
      const v = variant?.trim() || undefined;
      setCart((c) => {
        const existing = c.find((i) => same(i, productId, v));
        const total = normalizeQty(product, (existing?.qty ?? 0) + qty);
        return existing ? c.map((i) => (same(i, productId, v) ? { ...i, qty: total } : i)) : [...c, { productId, qty: total, variant: v }];
      });
    },
    [remember]
  );

  const toastTimer = useRef<number | undefined>(undefined);
  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2600);
  }, []);

  const value: Ctx = {
    route,
    catalog,
    catalogError,
    session,
    pricing,
    cart,
    productsById,
    remember,
    ensureProducts,
    price,
    setQty,
    addToCart,
    clearCart: () => setCart([]),
    cartCount: cart.length,
    toast,
    toastMsg,
    refreshCatalog,
    refreshSession,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
