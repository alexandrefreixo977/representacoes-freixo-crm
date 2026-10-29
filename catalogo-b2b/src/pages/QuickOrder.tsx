import { useEffect, useMemo, useState } from "react";
import { PriceTag } from "../components";
import { api } from "../data";
import { normRef, normalizeQty, parseQuickOrder } from "../pricing";
import { go, useApp } from "../state";
import type { Product } from "../types";

/** Encomenda rápida: o cliente cola ou escreve "referência quantidade", uma por linha. */
export function QuickOrderPage() {
  const { catalog, addToCart, toast, session, remember } = useApp();
  const [text, setText] = useState("");
  const [matches, setMatches] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);

  const parsed = useMemo(() => parseQuickOrder(text), [text]);
  const refsKey = parsed.map((l) => normRef(l.reference)).join("|");

  // Procura as referências no servidor meio segundo depois de parar de escrever.
  useEffect(() => {
    const refs = refsKey.split("|").filter(Boolean);
    if (!refs.length || !session) return setMatches([]);
    setSearching(true);
    let stale = false;
    const t = window.setTimeout(() => {
      api
        .findProducts(refs)
        .then((found) => {
          if (stale) return;
          remember(found);
          setMatches(found);
        })
        .catch(() => undefined)
        .finally(() => !stale && setSearching(false));
    }, 500);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [refsKey, session, remember]);

  const index = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of matches) {
      for (const key of [normRef(p.reference), p.ean ? normRef(p.ean) : ""]) {
        if (!key) continue;
        map.set(key, [...(map.get(key) ?? []), p]);
      }
    }
    return map;
  }, [matches]);

  const lines = useMemo(
    () =>
      parsed.map((l) => {
        const matches = index.get(normRef(l.reference)) ?? [];
        const product = matches.length === 1 ? matches[0] : undefined;
        if (product?.sizeType) return { ...l, product: undefined, ambiguous: false, sized: true };
        return { ...l, product, ambiguous: matches.length > 1, sized: false };
      }),
    [parsed, index]
  );
  const found = lines.filter((l) => l.product);

  if (!session) {
    return (
      <div className="panel">
        <h1>Encomenda rápida</h1>
        <p>Escreva ou cole as referências e quantidades, e passa tudo para o carrinho de uma vez. Disponível para clientes com conta.</p>
        <button className="btn primary" onClick={() => go("entrar", { voltar: "rapida" })}>Entrar</button>
      </div>
    );
  }

  return (
    <div className="panel wide">
      <h1>Encomenda rápida</h1>
      <p className="hint">
        Uma linha por artigo: referência (ou EAN) e quantidade. Pode colar diretamente de uma folha de Excel.
        <br />
        Exemplo: <code>AT-INOX-125 50</code>
      </p>
      <textarea
        className="quick-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"PP-NIT-09 24\nAT-INOX-125 50\nTM-FITA-8 6"}
        rows={8}
        autoFocus
      />
      {lines.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Referência</th>
              <th>Artigo</th>
              <th>Qtd.</th>
              <th>Preço</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className={l.product ? "" : "bad"}>
                <td>{l.reference}</td>
                <td>
                  {l.product
                    ? `${l.product.designation} · ${catalog?.manufacturers.find((m) => m.id === l.product!.manufacturerId)?.name}`
                    : l.sized
                      ? "Artigo com tamanhos: adicione pelo catálogo para escolher o tamanho"
                      : l.ambiguous
                      ? "Referência existe em mais de um fabricante: adicione pelo catálogo"
                      : searching
                        ? "A procurar…"
                        : "Referência não encontrada"}
                </td>
                <td>
                  {l.product ? normalizeQty(l.product, l.qty) : l.qty}
                  {l.product && normalizeQty(l.product, l.qty) !== l.qty && <small className="muted"> (cx. de {l.product.packQty})</small>}
                </td>
                <td>{l.product && <PriceTag product={l.product} compact />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        <button
          className="btn primary"
          disabled={!found.length || searching}
          onClick={() => {
            found.forEach((l) => addToCart(l.product!, l.qty));
            toast(`${found.length} artigo(s) adicionados ao carrinho`);
            go("carrinho");
          }}
        >
          Adicionar {found.length || ""} ao carrinho
        </button>
        {lines.length > found.length && <span className="muted">{lines.length - found.length} linha(s) ignoradas</span>}
      </div>
    </div>
  );
}
