import { useState } from "react";
import { Icon, PriceTag, ProductImage, QtyStepper } from "../components";
import { api } from "../data";
import type { SubmitResult } from "../data/api";
import { formatEur, splitByManufacturer, variantLabel } from "../pricing";
import { go, useApp } from "../state";

/** embedded: dentro da página "Encomendar para cliente" (equipa Freixo). */
export function CartPage({ embedded }: { embedded?: boolean } = {}) {
  const { cart, catalog, pricing, session, setQty, clearCart, refreshSession, productsById, actingClient, setActingClient, priceClientId } = useApp();
  const staff = !!session && session.role !== "client";
  const [customerRef, setCustomerRef] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SubmitResult | null>(null);

  if (!catalog) return <div className="empty">A carregar…</div>;
  const mfrName = (id: string) => catalog.manufacturers.find((m) => m.id === id)?.name ?? "";

  if (done && staff) {
    return (
      <div className="panel success">
        <h1>Encomenda registada</h1>
        <p>
          A encomenda <strong>{done.groupNumber}</strong> foi registada em nome de <strong>{done.orders[0]?.clientName}</strong> e fica a aguardar
          validação, como as encomendas feitas pelos clientes.
        </p>
        <ul className="split-list">
          {done.orders.map((o) => (
            <li key={o.id}>
              <span>{o.number} · {mfrName(o.manufacturerId)}</span>
              <strong>{formatEur(o.subtotal)}</strong>
            </li>
          ))}
        </ul>
        <div className="row">
          <button className="btn primary" onClick={() => { setDone(null); setActingClient(null); go("encomendar"); }}>Nova encomenda</button>
          <button className="btn ghost" onClick={() => go(session?.role === "admin" ? "gestao" : "encomendas")}>Ver encomendas</button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="panel success">
        <h1>Encomenda recebida</h1>
        <p>
          Obrigado! A encomenda <strong>{done.groupNumber}</strong> foi registada e vai ser validada pela Representações Freixo
          antes de seguir para {done.orders.length > 1 ? "os fabricantes" : "o fabricante"}.
        </p>
        {done.orders.length > 1 && <p>Foi dividida em {done.orders.length} encomendas, uma por fabricante:</p>}
        <ul className="split-list">
          {done.orders.map((o) => (
            <li key={o.id}>
              <span>{o.number} · {mfrName(o.manufacturerId)}</span>
              <strong>{formatEur(o.subtotal)}</strong>
            </li>
          ))}
        </ul>
        <div className="row">
          <button className="btn primary" onClick={() => go("encomendas")}>Ver as minhas encomendas</button>
          <button className="btn ghost" onClick={() => go("")}>Voltar ao catálogo</button>
        </div>
      </div>
    );
  }

  if (cart.some((i) => !productsById.has(i.productId)) && cart.length) return <div className="empty">A carregar o carrinho…</div>;
  const groups = splitByManufacturer(cart, [...productsById.values()], pricing, priceClientId);
  const total = groups.reduce((s, g) => s + g.subtotal, 0);
  const missingPrice = groups.some((g) => g.items.some((i) => !i.price));

  if (!groups.length && embedded) {
    return <p className="hint">Junte artigos acima, ou procure no catálogo: os preços e o carrinho já são os de {actingClient?.name ?? "o cliente"}.</p>;
  }
  if (!groups.length) {
    return (
      <div className="panel empty-cart">
        <Icon name="cart" size={40} />
        <h1>O carrinho está vazio</h1>
        <p>Procure no catálogo ou use a encomenda rápida por referência.</p>
        <div className="row">
          <button className="btn primary" onClick={() => go("")}>Ver catálogo</button>
          <button className="btn ghost" onClick={() => go("rapida")}>Encomenda rápida</button>
        </div>
      </div>
    );
  }

  async function submit() {
    if (!session) return go("entrar", { voltar: "carrinho" });
    if (staff && !actingClient) return go("encomendar");
    setBusy(true);
    setError(null);
    try {
      const result = await api.submitOrder(
        cart,
        customerRef.trim(),
        notes.trim(),
        staff && actingClient ? { clientId: actingClient.id, notifyClient: true } : undefined
      );
      clearCart();
      setDone(result);
      refreshSession();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cart-layout">
      <div>
        {!embedded && <h1 className="page-title">{staff && actingClient ? `Encomenda para ${actingClient.name}` : "Carrinho"}</h1>}
        {staff && !actingClient && (
          <p className="notice">
            <span>Para encomendar em nome de um cliente, escolha primeiro o cliente.</span>
            <button className="btn primary small" onClick={() => go("encomendar")}>Escolher cliente</button>
          </p>
        )}
        {groups.length > 1 && (
          <p className="hint">Tem artigos de {groups.length} fabricantes. Ao confirmar, criamos uma encomenda para cada um.</p>
        )}
        {groups.map((g) => (
          <section key={g.manufacturerId} className="cart-group">
            <header>
              <h2>{mfrName(g.manufacturerId)}</h2>
              {session && <strong>{formatEur(g.subtotal)}</strong>}
            </header>
            {g.items.map(({ product, qty, variant, total }) => (
              <div key={`${product.id}|${variant ?? ""}`} className="cart-line">
                <ProductImage product={product} manufacturer={catalog.manufacturers.find((m) => m.id === product.manufacturerId)} />
                <div className="cart-line-info">
                  <strong>{product.designation}</strong>
                  <span>
                    {product.reference}
                    {variant ? <> · <b>{variantLabel(product, variant)}</b></> : product.sizeType ? <> · <b className="error">{product.sizeType === "medida" ? "Falta o comprimento" : "Falta o tamanho"}</b></> : null} · Cx: {product.packQty} {product.salesUnit}
                  </span>
                  <PriceTag product={product} compact />
                </div>
                <div className="cart-line-qty">
                  <QtyStepper product={product} value={qty} onChange={(q) => setQty(product.id, q, variant)} />
                  {session && <strong>{formatEur(total)}</strong>}
                  <button className="link danger" onClick={() => setQty(product.id, 0, variant)}>Remover</button>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>

      <aside className="summary">
        <h2>Resumo</h2>
        {session ? (
          <>
            {groups.map((g) => (
              <div key={g.manufacturerId} className="sum-row">
                <span>{mfrName(g.manufacturerId)}</span>
                <span>{formatEur(g.subtotal)}</span>
              </div>
            ))}
            <div className="sum-row total">
              <span>Total s/ IVA</span>
              <strong>{formatEur(total)}</strong>
            </div>
            {staff && actingClient && <p className="hint">Encomenda em nome de <strong>{actingClient.name}</strong>, com as condições deste cliente.</p>}
            <label>
              {staff ? "Referência / n.º de encomenda do cliente" : "A sua referência / n.º de encomenda"}
              <input value={customerRef} onChange={(e) => setCustomerRef(e.target.value)} maxLength={80} placeholder="Opcional" />
            </label>
            <label>
              Observações
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Morada de entrega, prazos, etc." />
            </label>
            {missingPrice && <p className="warn">Há artigos sem preço: a Freixo confirma o valor na validação.</p>}
            {error && <p className="error">{error}</p>}
            {staff && actingClient && (
              <p className="hint">
                {actingClient.email
                  ? `O cliente recebe automaticamente a confirmação por email (${actingClient.email}).`
                  : "O cliente não tem email na ficha: a confirmação segue só para si."}
              </p>
            )}
            <button className="btn primary block" disabled={busy || (staff && !actingClient)} onClick={submit}>
              {busy ? "A enviar…" : "Confirmar encomenda"}
            </button>
            <p className="vat-note">
              {staff
                ? "A encomenda fica a aguardar validação, tal como as dos clientes."
                : "A encomenda fica a aguardar validação da Representações Freixo. Recebe confirmação por email."}
            </p>
          </>
        ) : (
          <>
            <p>Para ver preços e enviar a encomenda, entre na sua conta.</p>
            <button className="btn primary block" onClick={() => go("entrar", { voltar: "carrinho" })}>Entrar</button>
          </>
        )}
      </aside>
    </div>
  );
}
