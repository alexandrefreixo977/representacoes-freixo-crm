import { useEffect, useRef, useState } from "react";
import { BRAND_GROUPS, brandGroup, groupedBrands, type BrandGroupId } from "./brands";
import { Icon } from "./components";
import { go, useApp } from "./state";

/**
 * Barra de navegação por marcas, por baixo do cabeçalho (como nas lojas online):
 * - computador: um botão por grupo (EPI / Equipamentos e consumíveis) que abre um painel com as marcas desse grupo;
 * - telemóvel: um botão "Marcas" que abre a lista completa, agrupada.
 */
export function BrandBar() {
  const { catalog, route } = useApp();
  const [open, setOpen] = useState<BrandGroupId | "all" | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const groups = groupedBrands(catalog);
  const slug = route.page === "" ? route.params.get("m") : null;
  const current = catalog?.manufacturers.find((m) => m.slug === slug);
  const currentGroup = current ? brandGroup(current) : null;

  useEffect(() => setOpen(null), [route]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(null);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  if (!groups.length) return null;
  const familiesOf = (id: string) => catalog!.families.filter((f) => f.manufacturerId === id).length;
  const shown = open === "all" ? groups : groups.filter((g) => g.id === open);

  return (
    <div className="brandbar" ref={ref}>
      <div className="brandbar-inner">
        <button className="brandbar-btn only-sm" aria-expanded={open === "all"} onClick={() => setOpen(open === "all" ? null : "all")}>
          <Icon name="menu" size={18} /> Marcas
          {current && <span className="brandbar-current">· {current.name}</span>}
          <Icon name="chevron" size={18} />
        </button>
        <button className={`brandbar-btn only-lg ${route.page === "" && !slug ? "on" : ""}`} onClick={() => go("")}>
          Todas as marcas
        </button>
        {groups.map((g) => (
          <button
            key={g.id}
            className={`brandbar-btn only-lg ${currentGroup === g.id ? "on" : ""}`}
            aria-expanded={open === g.id}
            onClick={() => setOpen(open === g.id ? null : g.id)}
          >
            {g.label === "EPI" ? "EPI · Proteção individual" : g.long}
            <Icon name="chevron" size={18} />
          </button>
        ))}
        <button className="brandbar-btn only-lg end" onClick={() => go("", { novidades: "1" })}>Novidades</button>
      </div>

      {open && (
        <div className="megamenu" role="dialog" aria-label="Marcas">
          <div className={`megamenu-inner cols-${shown.length}`}>
            {shown.map((g) => (
              <section key={g.id}>
                <header>
                  <h3>{g.long}</h3>
                  <p>{g.hint}</p>
                </header>
                <ul>
                  {g.brands.map((m) => (
                    <li key={m.id}>
                      <button className={current?.id === m.id ? "on" : ""} onClick={() => go("", { m: m.slug })}>
                        <span>{m.name}</span>
                        {familiesOf(m.id) > 0 && <small>{familiesOf(m.id)} famílias</small>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="megamenu-foot">
            <button className="link" onClick={() => go("")}>Ver todos os artigos</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Montra de marcas na página inicial: dois blocos (EPI / Equipamentos e consumíveis) com uma ficha por marca. */
export function BrandShowcase() {
  const { catalog } = useApp();
  const groups = groupedBrands(catalog);
  if (!groups.length) return null;
  return (
    <section className="showcase" aria-label="Comprar por marca">
      {groups.map((g) => (
        <div key={g.id} className={`showcase-group g-${g.id}`}>
          <div className="showcase-head">
            <span className="eyebrow">{g.id === "epi" ? "EPI" : "Indústria"}</span>
            <h2>{g.long}</h2>
            <p>{g.hint}</p>
          </div>
          <div className="showcase-grid">
            {g.brands.map((m) => (
              <button key={m.id} className="brand-tile" onClick={() => go("", { m: m.slug })}>
                {m.logoUrl ? <img src={m.logoUrl} alt={m.name} /> : <strong>{m.name}</strong>}
                <span>
                  Ver artigos <Icon name="arrow" size={14} />
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

export const groupLabel = (id: BrandGroupId) => BRAND_GROUPS.find((g) => g.id === id)!.long;
