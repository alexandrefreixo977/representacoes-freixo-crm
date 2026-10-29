import { useEffect, useState } from "react";
import { StatusBadge, formatDate } from "../components";
import { api } from "../data";
import { formatDiscounts, formatEur } from "../pricing";
import { go, useApp } from "../state";
import type { Order } from "../types";

export function OrdersPage() {
  const { session, catalog, addToCart, toast, productsById } = useApp();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (session) api.listMyOrders().then(setOrders).catch(() => setOrders([]));
  }, [session]);

  if (!session) {
    return (
      <div className="panel">
        <h1>As minhas encomendas</h1>
        <button className="btn primary" onClick={() => go("entrar", { voltar: "encomendas" })}>Entrar</button>
      </div>
    );
  }
  if (!orders) return <div className="empty">A carregar…</div>;
  const mfrName = (id: string) => catalog?.manufacturers.find((m) => m.id === id)?.name ?? "";

  function repeat(o: Order) {
    let n = 0;
    o.lines.forEach((l) => {
      if (productsById.has(l.productId)) {
        addToCart(l.productId, l.qty);
        n++;
      }
    });
    toast(`${n} artigo(s) adicionados ao carrinho`);
    go("carrinho");
  }

  return (
    <div className="panel wide">
      <h1>As minhas encomendas</h1>
      {orders.length === 0 && <p className="muted">Ainda não fez encomendas por aqui.</p>}
      <div className="order-list">
        {orders.map((o) => (
          <article key={o.id} className="order">
            <button className="order-head" onClick={() => setOpen(open === o.id ? null : o.id)}>
              <div>
                <strong>{o.number}</strong>
                <span>{mfrName(o.manufacturerId)} · {formatDate(o.createdAt)}{o.customerRef ? ` · Ref. ${o.customerRef}` : ""}</span>
              </div>
              <StatusBadge status={o.status} />
              <strong className="amount">{formatEur(o.subtotal)}</strong>
            </button>
            {open === o.id && (
              <div className="order-body">
                <OrderLinesTable order={o} />
                <button className="btn ghost" onClick={() => repeat(o)}>Repetir encomenda</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

export function OrderLinesTable({ order }: { order: Order }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Referência</th>
            <th>Designação</th>
            <th className="num">Qtd.</th>
            <th className="num">P. tabela</th>
            <th>Desc.</th>
            <th className="num">P. líquido</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.reference}</td>
              <td>{l.designation}</td>
              <td className="num">{l.qty} {l.salesUnit}</td>
              <td className="num">{formatEur(l.listPrice)}</td>
              <td>{l.discounts.length ? formatDiscounts(l.discounts) : l.netPrice < l.listPrice ? "Especial" : "—"}</td>
              <td className="num">{formatEur(l.netPrice)}</td>
              <td className="num">{formatEur(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6}>Total s/ IVA</td>
            <td className="num"><strong>{formatEur(order.subtotal)}</strong></td>
          </tr>
        </tfoot>
      </table>
      {order.notes && <p className="muted">Observações: {order.notes}</p>}
    </div>
  );
}
