import { useEffect, useMemo, useState } from "react";
import { Icon, ProductCard, ProductModal } from "../components";
import { api } from "../data";
import { go, useApp } from "../state";
import type { Product } from "../types";
import { brandGroup } from "../brands";
import { BrandShowcase, groupLabel } from "../BrandMenu";

const PAGE = 48;

export function CatalogPage() {
  const { catalog, catalogError, route, session, remember } = useApp();
  const slug = route.params.get("m") ?? "";
  const q = route.params.get("q") ?? "";
  const familyId = route.params.get("f") ?? "";
  const onlyNew = route.params.get("novidades") === "1";
  const [open, setOpen] = useState<Product | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);

  const manufacturer = catalog?.manufacturers.find((m) => m.slug === slug);
  const manufacturerId = manufacturer?.id;
  const ready = !!catalog && (!slug || !!manufacturer);

  async function fetchPage(offset: number) {
    setLoading(true);
    try {
      const page = await api.searchProducts({ manufacturerId, familyId: familyId || undefined, q, onlyNew, offset, limit: PAGE });
      remember(page.products);
      setResults((r) => (offset ? [...r, ...page.products] : page.products));
      setTotal(page.total);
      setSearchError(null);
    } catch (e) {
      setSearchError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!ready) return;
    let stale = false;
    setLoading(true);
    api
      .searchProducts({ manufacturerId, familyId: familyId || undefined, q, onlyNew, offset: 0, limit: PAGE })
      .then((page) => {
        if (stale) return;
        remember(page.products);
        setResults(page.products);
        setTotal(page.total);
        setSearchError(null);
      })
      .catch((e) => !stale && setSearchError((e as Error).message))
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
  }, [ready, manufacturerId, familyId, q, onlyNew, remember]);
  const families = useMemo(
    () => (catalog?.families ?? []).filter((f) => !manufacturer || f.manufacturerId === manufacturer.id),
    [catalog, manufacturer]
  );

  const setParam = (patch: Record<string, string | undefined>) =>
    go("", { m: slug || undefined, q: q || undefined, f: familyId || undefined, novidades: onlyNew ? "1" : undefined, ...patch });

  if (catalogError || searchError) return <div className="empty">Não foi possível carregar o catálogo. {catalogError ?? searchError}</div>;
  if (!catalog) return <div className="empty">A carregar o catálogo…</div>;

  const home = !manufacturer && !q && !familyId && !onlyNew;
  const campaigns = catalog.campaigns.filter((c) => !manufacturer || !c.manufacturerId || c.manufacturerId === manufacturer.id);

  return (
    <>
      {manufacturer && (
        <nav className="crumbs" aria-label="Caminho">
          <button className="link" onClick={() => go("")}>Início</button>
          <span>›</span>
          <span>{groupLabel(brandGroup(manufacturer))}</span>
          <span>›</span>
          <strong>{manufacturer.name}</strong>
        </nav>
      )}

      {home && campaigns.length > 0 && <Campaigns onOpen={setOpen} />}

      {!session && (
        <div className="notice">
          <Icon name="lock" size={18} />
          <p>
            É revendedor? <a href="#/entrar">Entre na sua conta</a> para ver os seus preços e encomendar, ou{" "}
            <a href="#/pedir-acesso">peça acesso</a>.
          </p>
        </div>
      )}

      {home && <BrandShowcase />}

      {manufacturer && families.length > 1 && <FamilyChips families={families} value={familyId} onPick={(f) => setParam({ f })} />}

      <div className="results-bar">
        <h1>
          {familyId ? families.find((f) => f.id === familyId)?.name ?? "Artigos" : manufacturer?.name ?? (onlyNew ? "Novidades" : q ? "Resultados" : "Todos os produtos")}
          <small>{loading && !results.length ? "a procurar…" : `${total.toLocaleString("pt-PT")} artigos`}</small>
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

      {results.length === 0 && loading ? (
        <div className="empty">A procurar…</div>
      ) : results.length === 0 ? (
        <div className="empty">
          Nenhum artigo encontrado{q ? ` para "${q}"` : ""}.{" "}
          {q && <button className="link" onClick={() => setParam({ q: undefined })}>Limpar pesquisa</button>}
        </div>
      ) : (
        <div className="grid">
          {results.map((p) => (
            <ProductCard key={p.id} product={p} onOpen={() => setOpen(p)} />
          ))}
        </div>
      )}
      {total > results.length && (
        <div className="more">
          <button className="btn ghost" disabled={loading} onClick={() => fetchPage(results.length)}>
            {loading ? "A carregar…" : `Ver mais artigos (${(total - results.length).toLocaleString("pt-PT")})`}
          </button>
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

const CHIP_LIMIT = 14;

/** Famílias da marca escolhida, como botões (as primeiras 14; o resto com "ver todas"). */
function FamilyChips({ families, value, onPick }: { families: { id: string; name: string }[]; value: string; onPick: (f?: string) => void }) {
  const [all, setAll] = useState(false);
  const list = all ? families : families.slice(0, CHIP_LIMIT);
  return (
    <div className="family-chips" aria-label="Famílias">
      <button className={!value ? "on" : ""} onClick={() => onPick(undefined)}>Todas</button>
      {list.map((f) => (
        <button key={f.id} className={value === f.id ? "on" : ""} onClick={() => onPick(f.id)}>{f.name}</button>
      ))}
      {families.length > CHIP_LIMIT && (
        <button className="more-chip" onClick={() => setAll((v) => !v)}>{all ? "Ver menos" : `Ver todas (${families.length})`}</button>
      )}
    </div>
  );
}
