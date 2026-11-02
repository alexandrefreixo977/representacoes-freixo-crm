import { useState } from "react";
import { ClientSearch, type ClientPick } from "../ClientSearch";
import { ProductModal } from "../components";
import { api } from "../data";
import { go, useApp } from "../state";
import type { Client, Product } from "../types";
import { CartPage } from "./Cart";
import { ProductAdder } from "./Quotes";

/**
 * Equipa Freixo (gestão e comerciais): encomendar em nome de um cliente.
 * Escolhe o cliente, junta artigos (pesquisa, lista de referências ou catálogo) com os preços desse cliente
 * e confirma: a encomenda segue o fluxo normal (a validar, email à Freixo e, se pedido, ao cliente).
 */
export function OrderForClientPage() {
  const { session, actingClient, setActingClient, addToCart, cart, clearCart, toast } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sized, setSized] = useState<Product | null>(null);
  const staff = !!session && session.role !== "client";

  if (!staff) {
    return (
      <div className="panel narrow">
        <h1>Encomendar para cliente</h1>
        <p>Reservado à equipa da Representações Freixo.</p>
        <button className="btn primary" onClick={() => go("entrar", { voltar: "encomendar" })}>Entrar</button>
      </div>
    );
  }

  function choose(c: Client) {
    // O carrinho é a encomenda em curso: ao trocar de cliente, começa vazio.
    if (actingClient && actingClient.id !== c.id && cart.length) clearCart();
    setActingClient(c);
  }

  async function pick(p: ClientPick) {
    setError(null);
    if (p.shop) return choose(p.shop);
    if (!p.crm) return;
    setBusy(true);
    try {
      choose(await api.clientFromCrm(p.crm.crmId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!actingClient) {
    return (
      <section className="panel">
        <h1>Encomendar para cliente</h1>
        <p className="hint">
          Procure o cliente no CRM. Depois junte os artigos: os preços e descontos são os desse cliente, e a encomenda fica a validar como as
          que os clientes fazem. Se o cliente ainda não tiver ficha na loja, é criada com os dados do CRM (sem enviar convite).
        </p>
        <ClientSearch autoFocus onPick={pick} />
        {busy && <p className="muted">A preparar o cliente…</p>}
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  return (
    <div>
      <section className="panel acting-client">
        <div className="row between" style={{ marginTop: 0 }}>
          <div>
            <p className="eyebrow">Encomenda em nome de</p>
            <h1 style={{ margin: 0 }}>{actingClient.name}</h1>
            <small className="muted">{[actingClient.nif && `NIF ${actingClient.nif}`, actingClient.email].filter(Boolean).join(" · ")}</small>
          </div>
          <div className="row" style={{ marginTop: 0 }}>
            <button className="btn ghost" onClick={() => go("")}>Procurar no catálogo</button>
            <button
              className="btn ghost"
              onClick={() => {
                if (cart.length) clearCart();
                setActingClient(null);
              }}
            >
              Trocar cliente
            </button>
          </div>
        </div>
        <ProductAdder
          pasteLabel="Juntar à encomenda"
          onAdd={(list) => {
            let added = 0;
            for (const { product, qty } of list) {
              if (product.sizeType) {
                setSized(product); // tamanho/comprimento escolhe-se na ficha do artigo
                continue;
              }
              addToCart(product, qty);
              added++;
            }
            if (added) toast(`${added} ${added === 1 ? "artigo adicionado" : "artigos adicionados"}`);
          }}
        />
      </section>
      <CartPage embedded />
      {sized && <ProductModal product={sized} onClose={() => setSized(null)} />}
    </div>
  );
}
