import { useEffect, useMemo, useState } from "react";
import { Icon, ProductCard, ProductModal } from "../components";
import { go, useApp } from "../state";
import type { Product } from "../types";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const PAGE = 48;

export function CatalogPage() {
  const { catalog, catalogError, route, session } = useApp();
  const slug = route.params.get("m") ?? "";
  const q = route.params.get("q") ?? "";
  const familyId = route.params.get("f") ?? "";
  const onlyNew = route.params.get("novidades") === "1";
  const [open, setOpen] = useState<Product | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => setLimit(PAGE), [slug, q, familyId, onlyNew]);

  const manufacturer = catalog?.manufacturers.find((m) => m.slug === slug);
  const families = useMemo(
    () => (catalog?.families ?? []).filter((f) => !manufacturer || f.manufacturerId === manufacturer.id),
    [catalog, manufacturer]
  );

  const results = useMemo(() => {
    if (!catalog) return [];
    const terms = norm(q).split(/\s+/).filter(Boolean);
    const mfrNames = new Map(catalog.manufacturers.map((m) => [m.id, m.name]));
    return catalog.products.filter((p) => {
      if (manufacturer && p.manufacturerId !== manufacturer.id) return false;
      if (familyId && p.familyId !== familyId) return false;
      if (onlyNew && !p.isNew) return false;
      if (!terms.length) return true;
      const hay = norm(`${p.reference} ${p.designation} ${p.ean ?? ""} ${mfrNames.get(p.manufacturerId) ?? ""}`);
      return terms.every((t) => hay.includes(t));
    });
  }, [catalog, manufacturer, familyId, onlyNew, q]);

  const setParam = (patch: Record<string, string | undefined>) =>
    go("", { m: slug || undefined, q: q || undefined, f: familyId || undefined, novidades: onlyNew ? "1" : undefined, ...patch });

  if (catalogError) return <div className="empty">Não foi possível carregar o catálogo. {catalogError}</div>;
  if (!catalog) return <div className="empty">A carregar o catálogo…</div>;

  const campaigns = catalog.campaigns.filter((c) => !manufacturer || !c.manufacturerId || c.manufacturerId === manufacturer.id);

  return (
    <>
      <nav className="brands" aria-label="Fabricantes">
        <button className={!manufacturer ? "active" : ""} onClick={() => go("", { q: q || undefined })}>Todos</button>
        {catalog.manufacturers.map((m) => (
          <button key={m.id} className={manufacturer?.id === m.id ? "active" : ""} onClick={() => go("", { m: m.slug, q: q || undefined })}>
            {m.logoUrl ? <img src={m.logoUrl} alt={m.name} /> : m.name}
          </button>
        ))}
      </nav>

      {!q && !familyId && campaigns.length > 0 && <Campaigns onOpen={setOpen} />}

      {!session && (
        <div className="notice">
          <Icon name="lock" size={18} />
          <p>
            É revendedor? <a href="#/entrar">Entre na sua conta</a> para ver os seus preços e encomendar, ou{" "}
            <a href="#/pedir-acesso">peça acesso</a>.
          </p>
        </div>
      )}

      <div className="results-bar">
        <h1>
          {manufacturer?.name ?? "Todos os produtos"}
          <small>{results.length} artigos</small>
        </h1>
        <button className={`btn ghost ${familyId || onlyNew ? "on" : ""}`} onClick={() => setShowFilters((v) => !v)}>
          Filtros{familyId || onlyNew ? " ●" : ""}
        </button>
      </div>

      {showFilters && (
        <div className="filters">
          <label>
            Família
            <select value={familyId} onChange={(e) => setParam({ f: e.target.value || undefined })}>
              <option value="">Todas</option>
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {!manufacturer ? ` · ${catalog.manufacturers.find((m) => m.id === f.manufacturerId)?.name}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={onlyNew} onChange={(e) => setParam({ novidades: e.target.checked ? "1" : undefined })} />
            Só novidades
          </label>
          {(familyId || onlyNew) && (
            <button className="btn ghost" onClick={() => setParam({ f: undefined, novidades: undefined })}>Limpar filtros</button>
          )}
        </div>
      )}

      {results.length === 0 ? (
        <div className="empty">
          Nenhum artigo encontrado{q ? ` para "${q}"` : ""}.{" "}
          {q && <button className="link" onClick={() => setParam({ q: undefined })}>Limpar pesquisa</button>}
        </div>
      ) : (
        <div className="grid">
          {results.slice(0, limit).map((p) => (
            <ProductCard key={p.id} product={p} onOpen={() => setOpen(p)} />
          ))}
        </div>
      )}
      {results.length > limit && (
        <div className="more">
          <button className="btn ghost" onClick={() => setLimit((l) => l + PAGE)}>Ver mais artigos</button>
        </div>
      )}

      {open && <ProductModal product={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Campaigns({ onOpen }: { onOpen: (p: Product) => void }) {
  const { catalog, productsById } = useApp();
  const [i, setI] = useState(0);
  const list = catalog!.campaigns;
  useEffect(() => {
    if (list.length < 2) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % list.length), 6000);
    return () => window.clearInterval(t);
  }, [list.length]);
  const c = list[i % list.length];
  const product = c.productId ? productsById.get(c.productId) : undefined;
  const mfr = catalog!.manufacturers.find((m) => m.id === c.manufacturerId);
  return (
    <section className="hero" style={c.imageUrl ? { backgroundImage: `url(${c.imageUrl})` } : undefined}>
      <div className="hero-text">
        <span className="eyebrow">Campanha{mfr ? ` · ${mfr.name}` : ""}</span>
        <h2>{c.title}</h2>
        {c.subtitle && <p>{c.subtitle}</p>}
        {product && (
          <button className="btn accent" onClick={() => onOpen(product)}>
            Ver artigo
          </button>
        )}
      </div>
      {c.badge && <div className="hero-badge">{c.badge}</div>}
      {list.length > 1 && (
        <div className="dots">
          {list.map((x, n) => (
            <button key={x.id} className={n === i % list.length ? "on" : ""} onClick={() => setI(n)} aria-label={`Campanha ${n + 1}`} />
          ))}
        </div>
      )}
    </section>
  );
}
