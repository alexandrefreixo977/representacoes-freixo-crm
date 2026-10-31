"use client";
// Secção "Loja B2B" no dossier do cliente: acesso à loja, encomendas e propostas feitas lá.
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { orderStatusLabel, quoteStatusLabel } from "./b2b-link";

type ShopData = {
  shopUrl: string;
  linked: { id: string; name: string; users: { email: string | null; name: string | null }[] } | null;
  orders: { id: string; number: string; status: string; total: number; createdAt: string; manufacturer: string }[];
  quotes: { id: string; number: string; status: string; total: number; createdAt: string; validUntil: string | null; owner: string; opportunityId: string | null }[];
};
const euro = (value: number) => value.toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
const day = (value: string) => new Date(value).toLocaleDateString("pt-PT");

export default function B2BShopSection({ clientId, clientEmail, session, canEdit }: { clientId?: string; clientEmail?: string; session: Session | null; canEdit: boolean }) {
  const [data, setData] = useState<ShopData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState(clientEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const token = session?.access_token;

  const load = async () => {
    if (!clientId || !token) return;
    setError("");
    const response = await fetch(`/api/b2b/client?id=${encodeURIComponent(clientId)}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body.error ?? "Não foi possível ler a loja B2B."); return; }
    setData(body);
  };
  useEffect(() => { void load(); }, [clientId, token]);

  const giveAccess = async () => {
    if (!clientId || !token) return;
    setBusy(true); setNotice("");
    const response = await fetch("/api/b2b/client", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: clientId, email: email.trim() }) });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    setNotice(response.ok ? body.message : body.error ?? "Não foi possível dar acesso à loja.");
    if (response.ok) { setInviteOpen(false); await load(); }
  };

  if (!clientId) return null;
  const totalOrders = data?.orders.filter(o => o.status !== "cancelled").reduce((sum, o) => sum + o.total, 0) ?? 0;
  return <section className="client-detail-section b2b-shop">
    <div className="section-title"><h3>Loja B2B</h3>{data && <a href={data.shopUrl} target="_blank" rel="noreferrer">Abrir a loja ↗</a>}</div>
    {error && <p className="form-hint">{error}</p>}
    {notice && <div className="email-notice" role="status">{notice}</div>}
    {data && <>
      <p>{data.linked
        ? <>Cliente na loja{data.linked.users.length ? <> · acesso de {data.linked.users.map(u => u.email).filter(Boolean).join(", ")}</> : <> · ainda sem utilizadores com acesso</>}</>
        : <>Este cliente ainda não está na loja.</>}</p>
      {canEdit && (!data.linked || !data.linked.users.length) && (inviteOpen
        ? <div className="b2b-invite"><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email de quem vai encomendar" /><button className="primary" disabled={busy || !email.trim()} onClick={() => void giveAccess()}>{busy ? "A enviar…" : "Enviar convite"}</button><button onClick={() => setInviteOpen(false)} disabled={busy}>Cancelar</button></div>
        : <div className="dossier-actions"><button className="primary" onClick={() => setInviteOpen(true)}>Dar acesso à loja</button></div>)}
      {data.orders.length > 0 && <><h4>Encomendas na loja · {euro(totalOrders)}</h4><div className="detail-table b2b-table">
        <div className="detail-head"><span>Encomenda</span><span>Data</span><span>Fabricante</span><span>Estado</span><span>Valor</span></div>
        {data.orders.map(o => <div key={o.id}><strong>{o.number}</strong><span>{day(o.createdAt)}</span><span>{o.manufacturer}</span><span>{orderStatusLabel[o.status] ?? o.status}</span><span>{euro(o.total)}</span></div>)}
      </div></>}
      {data.quotes.length > 0 && <><h4>Propostas da loja</h4><div className="detail-table b2b-table">
        <div className="detail-head"><span>Proposta</span><span>Data</span><span>Comercial</span><span>Estado</span><span>Valor</span></div>
        {data.quotes.map(q => <div key={q.id}><strong>{q.number}</strong><span>{day(q.createdAt)}</span><span>{q.owner || "—"}</span><span>{quoteStatusLabel[q.status] ?? q.status}{q.opportunityId ? " · no pipeline" : ""}</span><span>{euro(q.total)}</span></div>)}
      </div></>}
      {data.linked && !data.orders.length && !data.quotes.length && <p className="form-hint">Sem encomendas nem propostas na loja.</p>}
    </>}
  </section>;
}
