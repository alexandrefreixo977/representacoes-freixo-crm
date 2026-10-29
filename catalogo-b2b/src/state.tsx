import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  productsById: Map<string, Product>;
  price: (p: Product) => PriceInfo | null;
  setQty: (productId: string, qty: number) => void;
  addToCart: (productId: string, qty: number) => void;
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

  useEffect(() => {
    const onHash = () => {
      setRoute(readRoute());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const refreshCatalog = useCallback(async () => {
    try {
      setCatalog(await api.getCatalog());
      setCatalogError(null);
    } catch (e) {
      setCatalogError((e as Error).message);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    const s = await api.getSession().catch(() => null);
    setSession(s);
    setPricing(s ? await api.getPricing().catch(() => null) : null);
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

  const productsById = useMemo(() => new Map((catalog?.products ?? []).map((p) => [p.id, p])), [catalog]);

  const price = useCallback((p: Product) => priceFor(p, pricing, session?.client?.id), [pricing, session]);

  const setQty = useCallback(
    (productId: string, qty: number) =>
      setCart((c) => (qty <= 0 ? c.filter((i) => i.productId !== productId) : c.map((i) => (i.productId === productId ? { ...i, qty } : i)))),
    []
  );

  const addToCart = useCallback(
    (productId: string, qty: number) => {
      const product = productsById.get(productId);
      if (!product) return;
      setCart((c) => {
        const existing = c.find((i) => i.productId === productId);
        const total = normalizeQty(product, (existing?.qty ?? 0) + qty);
        return existing ? c.map((i) => (i.productId === productId ? { ...i, qty: total } : i)) : [...c, { productId, qty: total }];
      });
    },
    [productsById]
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
