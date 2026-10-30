import { useEffect, useState, type FormEvent } from "react";
import { BrandBar } from "./BrandMenu";
import logoSymbol from "./assets/logo-simbolo.png";
import logoText from "./assets/logo-texto.png";
import { Icon } from "./components";
import { api, authLink } from "./data";
import { AccessRequestPage, LoginPage, SetPasswordPage } from "./pages/Account";
import { AdminPage } from "./pages/Admin";
import { CartPage } from "./pages/Cart";
import { CatalogPage } from "./pages/Catalog";
import { OrdersPage } from "./pages/Orders";
import { QuickOrderPage } from "./pages/QuickOrder";
import { AppProvider, go, useApp } from "./state";

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const { route, toastMsg } = useApp();
  // Convite ou recuperação: depois de o Supabase validar a ligação, pede a nova palavra-passe.
  useEffect(() => {
    if (authLink.error) go("entrar", { erro: "ligacao" });
    else if (authLink.type === "invite" || authLink.type === "recovery") api.getSession().then(() => go("definir-senha"));
  }, []);
  const page = route.page;
  return (
    <>
      <InstallBanner />
      <Header />
      <main className="main">
        {page === "" && <CatalogPage />}
        {page === "rapida" && <QuickOrderPage />}
        {page === "carrinho" && <CartPage />}
        {page === "encomendas" && <OrdersPage />}
        {page === "entrar" && <LoginPage />}
        {page === "pedir-acesso" && <AccessRequestPage />}
        {page === "gestao" && <AdminPage />}
        {page === "definir-senha" && <SetPasswordPage />}
      </main>
      <footer className="footer">
        <strong>Representações Freixo</strong>
        <span>EPI · Abrasivos · Ferramentas · Consumíveis industriais</span>
        <span>Viana do Castelo · Portugal · Preços sem IVA</span>
        {api.mode === "demo" && <span className="demo-flag">Modo demonstração: dados fictícios guardados só neste browser</span>}
      </footer>
      <BottomNav />
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </>
  );
}

function Header() {
  const { route, cartCount, session } = useApp();
  const [q, setQ] = useState(route.params.get("q") ?? "");
  useEffect(() => setQ(route.params.get("q") ?? ""), [route]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const m = route.page === "" ? route.params.get("m") ?? undefined : undefined;
    go("", { m, q: q.trim() || undefined });
  };
  return (
    <header className="header">
      <div className="header-inner">
        <a className="logo" href="#/" aria-label="Representações Freixo, início">
          <img className="logo-symbol" src={logoSymbol} alt="" height={40} />
          <span>
            <img className="logo-text" src={logoText} alt="Representações Freixo" height={28} />
            <small>Catálogo profissional</small>
          </span>
        </a>
        <form className="search" onSubmit={submit} role="search">
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar referência, produto ou marca" aria-label="Procurar" />
        </form>
        <nav className="header-actions">
          <a href="#/rapida" className="hide-sm"><Icon name="bolt" size={18} /> Encomenda rápida</a>
          {session?.role === "admin" && <a href="#/gestao" className="hide-sm"><Icon name="gear" size={18} /> Gestão</a>}
          <a href="#/entrar" className="hide-sm" title={session?.email}>
            <Icon name="user" size={18} /> {session ? session.client?.name.split(/[ ,]/)[0] ?? "Conta" : "Entrar"}
          </a>
          <a href="#/carrinho" className="cart-btn" aria-label={`Carrinho, ${cartCount} artigos`}>
            <Icon name="cart" size={20} />
            {cartCount > 0 && <span className="badge">{cartCount}</span>}
          </a>
        </nav>
      </div>
      <BrandBar />
    </header>
  );
}

function BottomNav() {
  const { route, cartCount, session } = useApp();
  const items: [string, string, string][] = [
    ["", "home", "Catálogo"],
    ["rapida", "bolt", "Rápida"],
    ["carrinho", "cart", "Carrinho"],
    ["encomendas", "list", "Encomendas"],
    [session?.role === "admin" ? "gestao" : "entrar", session?.role === "admin" ? "gear" : "user", session?.role === "admin" ? "Gestão" : "Conta"],
  ];
  return (
    <nav className="bottom-nav" aria-label="Navegação">
      {items.map(([page, icon, label]) => (
        <a key={page} href={`#/${page}`} className={route.page === page ? "active" : ""}>
          <Icon name={icon} size={20} />
          <span>{label}</span>
          {page === "carrinho" && cartCount > 0 && <i className="badge">{cartCount}</i>}
        </a>
      ))}
    </nav>
  );
}

type InstallEvent = Event & { prompt: () => Promise<void> };

function InstallBanner() {
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("freixo-b2b-install-hidden") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setEvt(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", on);
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);
  if (!evt || hidden) return null;
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem("freixo-b2b-install-hidden", "1");
    } catch {
      /* ignora */
    }
  };
  return (
    <div className="install">
      <span>Instale o catálogo no ecrã principal para encomendar mais rápido</span>
      <button className="btn accent sm" onClick={async () => { await evt.prompt(); hide(); }}>Instalar</button>
      <button className="link" onClick={hide} aria-label="Fechar">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
