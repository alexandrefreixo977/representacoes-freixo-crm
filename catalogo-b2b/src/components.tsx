import { useEffect, useState, type ReactNode } from "react";
import { formatDiscounts, formatEur, needsVariant, normalizeQty, sizesFor, variantLabel } from "./pricing";
import { go, useApp } from "./state";
import type { Manufacturer, Product } from "./types";

const paths: Record<string, string> = {
  search: "M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z",
  cart: "M3 4h2l2.4 10.2A2 2 0 0 0 9.3 16H18v-2H9.3l-.3-1.2h9.6L21 6H6.2L5.7 4H3Zm6 14a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z",
  user: "M12 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 11c4.4 0 8 2 8 4.5V21H4v-2.5C4 16 7.6 14 12 14Z",
  home: "M12 3 3 10.5V21h6v-6h6v6h6V10.5L12 3Z",
  bolt: "M13 2 4 14h6l-1 8 9-12h-6l1-8Z",
  list: "M4 5h2v2H4V5Zm4 0h12v2H8V5ZM4 11h2v2H4v-2Zm4 0h12v2H8v-2Zm-4 6h2v2H4v-2Zm4 0h12v2H8v-2Z",
  gear: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.6 5-.1-3 2-1.6-2-3.4-2.4.9-2.4-1.5L15.3 2h-4l-.4 2.9-2.4 1.5-2.4-.9-2 3.4 2 1.6-.1 3-2 1.6 2 3.4 2.4-.9 2.4 1.5.4 2.9h4l.4-2.9 2.4-1.5 2.4.9 2-3.4-2-1.6Z",
  close: "m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z",
  lock: "M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1Zm2 0h6V7a3 3 0 0 0-6 0v3Z",
  doc: "M6 2h8l5 5v15H6V2Zm7 1.5V8h4.5L13 3.5ZM8 12h8v1.5H8V12Zm0 3.5h8V17H8v-1.5Z",
  chevron: "m7.4 8.6 4.6 4.6 4.6-4.6L18 10l-6 6-6-6 1.4-1.4Z",
  menu: "M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z",
  arrow: "M13.2 5.3 19.9 12l-6.7 6.7-1.4-1.4 4.3-4.3H4v-2h12.1l-4.3-4.3 1.4-1.4Z",
  download: "M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3V3ZM4 18h16v2H4v-2Z",
};

export function Icon({ name, size = 20 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d={paths[name]} />
    </svg>
  );
}

/** Imagem do artigo, ou um marcador com as iniciais do fabricante quando ainda não há foto. */
export function ProductImage({ product, manufacturer }: { product: Product; manufacturer?: Manufacturer }) {
  const [broken, setBroken] = useState(false);
  if (product.imageUrl && !broken) {
    return <img className="product-img" src={product.imageUrl} alt="" loading="lazy" onError={() => setBroken(true)} />;
  }
  const initials = (manufacturer?.name ?? "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="product-img placeholder" aria-hidden="true">
      <span>{initials}</span>
      <small>{product.reference}</small>
    </div>
  );
}

/** Escolha do tamanho (calçado/vestuário). Lista com os tamanhos habituais; aceita outro escrito à mão. */
export function SizePicker({ product, value, onChange }: { product: Product; value: string; onChange: (v: string) => void }) {
  if (!product.sizeType) return null;
  const sizes = sizesFor(product);
  const listId = `sizes-${product.id}`;
  const medida = product.sizeType === "medida";
  return (
    <label className="size-picker">
      <span>{medida ? "Comprimento (mm)" : "Tamanho"}</span>
      <input
        list={listId}
        value={value}
        inputMode={medida ? "numeric" : undefined}
        onChange={(e) => onChange(medida ? e.target.value.replace(/\D/g, "").slice(0, 5) : e.target.value.slice(0, 20))}
        placeholder={medida ? "2450" : sizes[Math.floor(sizes.length / 2)]}
        required
      />
      <datalist id={listId}>
        {sizes.map((s) => <option key={s} value={s} />)}
      </datalist>
    </label>
  );
}

export function QtyStepper({ product, value, onChange }: { product: Product; value: number; onChange: (q: number) => void }) {
  const step = Math.max(1, product.packQty);
  return (
    <div className="stepper">
      <button type="button" aria-label="Menos" onClick={() => onChange(Math.max(0, value - step))}>−</button>
      <input
        inputMode="numeric"
        aria-label="Quantidade"
        value={value}
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")) || 0)}
        onBlur={() => value > 0 && onChange(normalizeQty(product, value))}
      />
      <button type="button" aria-label="Mais" onClick={() => onChange(value + step)}>+</button>
    </div>
  );
}

export function PriceTag({ product, compact }: { product: Product; compact?: boolean }) {
  const { session, price } = useApp();
  if (!session) {
    return (
      <button className="price-locked" onClick={() => go("entrar")}>
        <Icon name="lock" size={14} /> Entre para ver preços
      </button>
    );
  }
  const p = price(product);
  if (!p) return <span className="price-na">Preço sob consulta</span>;
  const discounted = p.netPrice < p.listPrice;
  return (
    <div className={`price ${compact ? "compact" : ""}`}>
      <strong>{formatEur(p.netPrice)}</strong>
      <span className="per">/ {product.salesUnit}</span>
      {discounted && (
        <div className="price-detail">
          <s>{formatEur(p.listPrice)}</s>
          <em>{p.special ? "Preço especial" : formatDiscounts(p.discounts)}</em>
        </div>
      )}
    </div>
  );
}

export function ProductCard({ product, onOpen }: { product: Product; onOpen: () => void }) {
  const { catalog, addToCart, cart, toast, session } = useApp();
  const manufacturer = catalog?.manufacturers.find((m) => m.id === product.manufacturerId);
  const inCart = cart.filter((c) => c.productId === product.id).reduce((n, c) => n + c.qty, 0);
  const [qty, setQty] = useState(normalizeQty(product, 1));
  const [size, setSize] = useState("");
  const needsSize = needsVariant(product, size);
  return (
    <article className="card">
      <button className="card-media" onClick={onOpen} aria-label={`Ver ${product.designation}`}>
        {product.isNew && <span className="tag new">Novidade</span>}
        <ProductImage product={product} manufacturer={manufacturer} />
      </button>
      <div className="card-body">
        <button className="card-title" onClick={onOpen}>{product.designation}</button>
        <div className="card-meta">
          <span>{product.reference}</span>
          <span>{manufacturer?.name}</span>
          <span className="pack">Cx: {product.packQty} {product.salesUnit}</span>
        </div>
        <PriceTag product={product} compact />
        {session && (
          <div className="card-actions">
            <SizePicker product={product} value={size} onChange={setSize} />
            <QtyStepper product={product} value={qty} onChange={setQty} />
            <button
              className="btn primary"
              disabled={qty <= 0 || needsSize}
              title={needsSize ? (product.sizeType === "medida" ? "Indique o comprimento em mm" : "Escolha o tamanho") : undefined}
              onClick={() => {
                addToCart(product, qty, size);
                toast(`${product.reference}${size ? ` (${variantLabel(product, size)})` : ""} adicionado ao carrinho`);
              }}
            >
              <Icon name="cart" size={16} />
              {inCart ? <span className="in-cart">{inCart}</span> : null}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export function Modal({ onClose, children, title }: { onClose: () => void; children: ReactNode; title: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Fechar">
          <Icon name="close" />
        </button>
        {children}
      </div>
    </div>
  );
}

export function ProductModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { catalog, addToCart, toast, session } = useApp();
  const manufacturer = catalog?.manufacturers.find((m) => m.id === product.manufacturerId);
  const family = catalog?.families.find((f) => f.id === product.familyId);
  const [qty, setQty] = useState(normalizeQty(product, 1));
  const [size, setSize] = useState("");
  const needsSize = needsVariant(product, size);
  return (
    <Modal onClose={onClose} title={product.designation}>
      <div className="product-detail">
        <ProductImage product={product} manufacturer={manufacturer} />
        <div>
          <p className="eyebrow">{manufacturer?.name}{family ? ` · ${family.name}` : ""}</p>
          <h2>{product.designation}</h2>
          <dl className="specs">
            <div><dt>Referência</dt><dd>{product.reference}</dd></div>
            {product.ean && <div><dt>EAN</dt><dd>{product.ean}</dd></div>}
            <div><dt>Embalagem</dt><dd>{product.packQty} {product.salesUnit}</dd></div>
            <div><dt>Encomenda mínima</dt><dd>{product.moq} {product.salesUnit}</dd></div>
          </dl>
          {product.description && <p className="desc">{product.description}</p>}
          {product.techSheetUrl && (
            <a className="link" href={product.techSheetUrl} target="_blank" rel="noreferrer">
              <Icon name="doc" size={16} /> Ficha técnica
            </a>
          )}
          <div className="detail-buy">
            <PriceTag product={product} />
            {session && (
              <div className="card-actions">
                <SizePicker product={product} value={size} onChange={setSize} />
                <QtyStepper product={product} value={qty} onChange={setQty} />
                <button
                  className="btn primary"
                  disabled={qty <= 0 || needsSize}
                  onClick={() => {
                    addToCart(product, qty, size);
                    toast(`${product.reference}${size ? ` (${variantLabel(product, size)})` : ""} adicionado ao carrinho`);
                    onClose();
                  }}
                >
                  Adicionar
                </button>
              </div>
            )}
          </div>
          {product.sizeType === "medida" ? (
            <p className="hint">Fita soldada à medida: indique o comprimento em mm. O preço por fita (metros × preço por metro + soldadura) aparece no carrinho. Para vários comprimentos, adicione um de cada vez.</p>
          ) : product.sizeType ? (
            <p className="hint">Para vários tamanhos, adicione um de cada vez.</p>
          ) : null}
          <p className="vat-note">Preços sem IVA. Quantidades arredondadas a caixas completas.</p>
        </div>
      </div>
    </Modal>
  );
}

export const statusLabel: Record<string, string> = {
  pending: "A validar",
  validated: "Validada",
  sent: "Enviada ao fabricante",
  confirmed: "Confirmada pelo fabricante",
  delivered: "Entregue",
  cancelled: "Cancelada",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status s-${status}`}>{statusLabel[status] ?? status}</span>;
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
