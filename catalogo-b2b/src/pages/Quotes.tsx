import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, formatDate } from "../components";
import { api } from "../data";
import {
  applyDiscounts,
  formatDiscounts,
  formatEur,
  parseDiscounts,
  parseQuickOrder,
  priceFor,
  sizesFor,
  variantLabel,
} from "../pricing";
import { go, useApp } from "../state";
import type { Client, Pricing, Product, Quote, QuoteLine, QuoteStatus } from "../types";

// Propostas comerciais: só para a equipa Freixo (gestão e comercial). O comercial vê as suas; a gestão vê todas.

export const QUOTE_STATUS: Record<QuoteStatus, string> = {
  draft: "Rascunho",
  sent: "Enviada",
  accepted: "Aceite",
  lost: "Perdida",
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const inDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const shortDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-PT") : "—");

const emptyQuote = (): Quote => ({
  customerName: "",
  status: "draft",
  validUntil: inDays(30),
  paymentTerms: "",
  deliveryTerms: "",
  total: 0,
  lines: [],
});

export function QuotesPage() {
  const { session, route } = useApp();
  if (!session || session.role === "client") {
    return (
      <div className="panel narrow">
        <h1>Propostas</h1>
        <p>Reservado à equipa comercial da Representações Freixo.</p>
        {!session && <button className="btn primary" onClick={() => go("entrar", { voltar: "propostas" })}>Entrar</button>}
      </div>
    );
  }
  const id = route.params.get("id");
  if (id || route.params.get("nova")) return <QuoteEditor key={id ?? "nova"} id={id} />;
  return <QuoteList />;
}

// ------------------------------------------------------------------ lista

function QuoteList() {
  const { session } = useApp();
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<QuoteStatus | "">("");
  const [q, setQ] = useState("");
  useEffect(() => {
    api.listQuotes().then(setQuotes, (e) => setError((e as Error).message));
  }, []);
  const isAdmin = session?.role === "admin";
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (quotes ?? []).filter(
      (x) =>
        (!status || x.status === status) &&
        (!term || `${x.number} ${x.customerName} ${x.ownerName ?? ""} ${x.ownerEmail ?? ""}`.toLowerCase().includes(term))
    );
  }, [quotes, status, q]);
  const sum = (s: QuoteStatus) => (quotes ?? []).filter((x) => x.status === s).reduce((t, x) => t + x.total, 0);

  return (
    <div className="quotes">
      <div className="row between">
        <h1 className="page-title">Propostas{isAdmin ? " · todas" : ""}</h1>
        <button className="btn accent" onClick={() => go("propostas", { nova: "1" })}>+ Nova proposta</button>
      </div>
      {error && <p className="error">{error}</p>}
      {quotes && quotes.length > 0 && (
        <div className="kpis">
          {(["draft", "sent", "accepted", "lost"] as QuoteStatus[]).map((s) => (
            <button key={s} className={`kpi ${status === s ? "on" : ""}`} onClick={() => setStatus(status === s ? "" : s)}>
              <span>{QUOTE_STATUS[s]}</span>
              <strong>{quotes.filter((x) => x.status === s).length}</strong>
              <small>{formatEur(sum(s))}</small>
            </button>
          ))}
        </div>
      )}
      <div className="filters">
        <label>
          Procurar
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Número, cliente ou comercial" />
        </label>
      </div>
      {!quotes && !error ? (
        <div className="empty">A carregar…</div>
      ) : shown.length === 0 ? (
        <div className="empty">{quotes?.length ? "Nenhuma proposta com estes filtros." : "Ainda não há propostas. Crie a primeira."}</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Número</th>
                <th>Cliente</th>
                {isAdmin && <th>Comercial</th>}
                <th>Data</th>
                <th>Validade</th>
                <th>Estado</th>
                <th className="num">Total s/ IVA</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((x) => (
                <tr key={x.id} className="clickable" onClick={() => go("propostas", { id: x.id })}>
                  <td><strong>{x.number}</strong></td>
                  <td>{x.customerName}{!x.clientId && <small className="muted"> · potencial</small>}</td>
                  {isAdmin && <td>{x.ownerName || x.ownerEmail}</td>}
                  <td>{shortDate(x.createdAt)}</td>
                  <td className={x.validUntil && x.validUntil < new Date().toISOString().slice(0, 10) && x.status === "sent" ? "late" : ""}>
                    {shortDate(x.validUntil)}
                  </td>
                  <td><span className={`status q-${x.status}`}>{QUOTE_STATUS[x.status]}</span></td>
                  <td className="num">{formatEur(x.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ editor

type Draft = QuoteLine & { key: string; discountsText: string };
let keySeq = 0;
const toDraft = (l: QuoteLine): Draft => ({ ...l, key: `l${++keySeq}`, discountsText: formatDiscounts(l.discounts).replace(/%/g, "") });

function QuoteEditor({ id }: { id: string | null }) {
  const { session, catalog, pricing, remember, toast } = useApp();
  const [quote, setQuote] = useState<Quote | null>(id ? null : emptyQuote());
  const [lines, setLines] = useState<Draft[]>([]);
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const prices = useRef<Pick<Pricing, "listPrices" | "weldPrices">>({ listPrices: {}, weldPrices: {} });

  useEffect(() => {
    api.listClients().then(setClients, () => undefined);
  }, []);

  useEffect(() => {
    if (!id) return;
    api
      .getQuote(id)
      .then(async (q) => {
        setQuote(q);
        setLines(q.lines.map(toDraft));
        const ids = q.lines.map((l) => l.productId).filter((x): x is string => !!x);
        if (ids.length) {
          const found = await api.getProducts(ids);
          remember(found);
          setProducts(new Map(found.map((p) => [p.id, p])));
        }
      })
      .catch((e) => setError((e as Error).message));
  }, [id, remember]);

  const mfrName = useCallback((p: Product) => catalog?.manufacturers.find((m) => m.id === p.manufacturerId)?.name ?? "", [catalog]);

  /** Preço sugerido para o cliente da proposta (descontos do cliente, ou os gerais para um potencial cliente). */
  const suggested = useCallback(
    async (p: Product, clientId: string | null | undefined, variant?: string | null) => {
      if (prices.current.listPrices[p.id] == null) {
        const got = await api.getPrices([p.id]);
        prices.current = {
          listPrices: { ...prices.current.listPrices, ...got.listPrices },
          weldPrices: { ...prices.current.weldPrices, ...got.weldPrices },
        };
      }
      const info = priceFor(p, { rules: pricing?.rules ?? [], ...prices.current }, clientId, variant);
      return info ?? { listPrice: 0, discounts: [], netPrice: 0, special: false };
    },
    [pricing]
  );

  if (error && !quote) return <div className="panel"><p className="error">{error}</p><button className="btn ghost" onClick={() => go("propostas")}>Voltar</button></div>;
  if (!quote) return <div className="empty">A carregar a proposta…</div>;

  const set = (patch: Partial<Quote>) => {
    setQuote({ ...quote, ...patch });
    setDirty(true);
  };
  const setLine = (key: string, patch: Partial<Draft>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  async function addProducts(list: { product: Product; qty: number }[]) {
    remember(list.map((x) => x.product));
    setProducts((m) => new Map([...m, ...list.map((x) => [x.product.id, x.product] as const)]));
    const added: Draft[] = [];
    for (const { product, qty } of list) {
      const price = await suggested(product, quote!.clientId);
      added.push(
        toDraft({
          productId: product.id,
          manufacturerName: mfrName(product),
          reference: product.reference,
          designation: product.designation,
          salesUnit: product.salesUnit,
          qty: Math.max(qty, product.moq || 1),
          variant: null,
          listPrice: price.listPrice,
          discounts: price.discounts,
          netPrice: price.netPrice,
          lineTotal: 0,
        })
      );
    }
    setLines((ls) => [...ls, ...added]);
    setDirty(true);
  }

  function pickClient(clientId: string) {
    const c = clients.find((x) => x.id === clientId);
    if (!c) {
      set({ clientId: null });
      return;
    }
    set({
      clientId: c.id,
      customerName: c.name,
      customerNif: c.nif ?? "",
      customerEmail: c.email ?? "",
      customerPhone: c.phone ?? "",
      customerAddress: c.address ?? "",
    });
  }

  async function reprice() {
    const next: Draft[] = [];
    for (const l of lines) {
      const p = l.productId ? products.get(l.productId) : undefined;
      if (!p) {
        next.push(l);
        continue;
      }
      const price = await suggested(p, quote!.clientId, l.variant);
      next.push({ ...l, listPrice: price.listPrice, discounts: price.discounts, netPrice: price.netPrice, discountsText: formatDiscounts(price.discounts).replace(/%/g, "") });
    }
    setLines(next);
    setDirty(true);
    toast("Preços atualizados com as condições do cliente.");
  }

  const total = round2(lines.reduce((t, l) => t + round2(l.netPrice * l.qty), 0));
  const full = (): Quote => ({ ...quote!, total, lines: lines.map(({ key: _k, discountsText: _d, ...l }) => ({ ...l, lineTotal: round2(l.netPrice * l.qty) })) });

  async function save(patch?: Partial<Quote>) {
    setBusy(true);
    setError(null);
    try {
      const q = { ...full(), ...patch };
      const res = await api.saveQuote(q);
      const stored = await api.getQuote(res.id).catch(() => null);
      const merged: Quote = {
        ...q,
        id: res.id,
        number: res.number,
        ownerId: stored?.ownerId ?? q.ownerId,
        ownerName: stored?.ownerName ?? q.ownerName,
        ownerEmail: stored?.ownerEmail ?? q.ownerEmail,
        createdAt: stored?.createdAt ?? q.createdAt,
        total: stored?.total ?? q.total,
      };
      setQuote(merged);
      setDirty(false);
      if (!quote!.id) history.replaceState(null, "", `#/propostas?id=${res.id}`);
      toast(`Proposta ${res.number} guardada.`);
      return merged;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function printPdf() {
    const saved = dirty || !quote!.id ? await save() : full();
    if (saved) printQuote(saved, products, session?.name || session?.email || "");
  }

  async function email() {
    const saved = dirty || !quote!.id || quote!.status === "draft" ? await save({ status: quote!.status === "draft" ? "sent" : quote!.status }) : full();
    if (!saved) return;
    const subject = `Proposta ${saved.number} · Representações Freixo`;
    const body =
      `Bom dia${saved.contactName ? ` ${saved.contactName}` : ""},\n\n` +
      `Conforme solicitado, enviamos em anexo a nossa proposta ${saved.number}` +
      `${saved.validUntil ? `, válida até ${shortDate(saved.validUntil)}` : ""}.\n` +
      `Total: ${formatEur(saved.total)} (valores sem IVA).\n\n` +
      `Ficamos ao dispor para qualquer esclarecimento.\n\nCom os melhores cumprimentos,\n${session?.name || ""}\nRepresentações Freixo`;
    toast("Descarregue o PDF (Imprimir › Guardar como PDF) e anexe-o ao email.");
    location.href = `mailto:${saved.customerEmail ?? ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  async function duplicate() {
    const copy: Quote = { ...full(), id: undefined, number: undefined, status: "draft", validUntil: inDays(30), createdAt: undefined };
    const res = await api.saveQuote(copy).catch((e) => {
      setError((e as Error).message);
      return null;
    });
    if (res) {
      toast(`Criada a proposta ${res.number}.`);
      go("propostas", { id: res.id });
    }
  }

  async function remove() {
    if (!quote!.id) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    await api.deleteQuote(quote!.id);
    toast("Proposta eliminada.");
    go("propostas");
  }

  const canEditOwner = session?.role === "admin" || !quote.ownerId || quote.ownerId === session?.userId;

  return (
    <div className="quote-editor">
      <div className="row between">
        <div>
          <button className="link" onClick={() => go("propostas")}>← Propostas</button>
          <h1 className="page-title">
            {quote.number ?? "Nova proposta"}
            {quote.number && <span className={`status q-${quote.status}`}>{QUOTE_STATUS[quote.status]}</span>}
          </h1>
          {quote.ownerName && <small className="muted">Comercial: {quote.ownerName}{quote.createdAt ? ` · criada a ${formatDate(quote.createdAt)}` : ""}</small>}
        </div>
        <div className="row wrap">
          <button className="btn primary" disabled={busy || !canEditOwner} onClick={() => save()}>{busy ? "A guardar…" : dirty || !quote.id ? "Guardar" : "Guardada ✓"}</button>
          <button className="btn ghost" disabled={busy || !lines.length} onClick={printPdf}><Icon name="doc" size={16} /> PDF / Imprimir</button>
          <button className="btn ghost" disabled={busy || !lines.length} onClick={email}>Enviar por email</button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <section className="card-block">
        <h2>Cliente</h2>
        <div className="form-grid">
          <label className="full">
            Cliente registado na loja
            <select value={quote.clientId ?? ""} onChange={(e) => pickClient(e.target.value)}>
              <option value="">— Potencial cliente (escrever os dados abaixo) —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.nif ? ` · ${c.nif}` : ""}</option>
              ))}
            </select>
          </label>
          <label>Empresa *<input value={quote.customerName} onChange={(e) => set({ customerName: e.target.value })} /></label>
          <label>NIF<input value={quote.customerNif ?? ""} onChange={(e) => set({ customerNif: e.target.value })} /></label>
          <label>Pessoa de contacto<input value={quote.contactName ?? ""} onChange={(e) => set({ contactName: e.target.value })} /></label>
          <label>Email<input type="email" value={quote.customerEmail ?? ""} onChange={(e) => set({ customerEmail: e.target.value })} /></label>
          <label>Telefone<input value={quote.customerPhone ?? ""} onChange={(e) => set({ customerPhone: e.target.value })} /></label>
          <label>Morada<input value={quote.customerAddress ?? ""} onChange={(e) => set({ customerAddress: e.target.value })} /></label>
        </div>
      </section>

      <section className="card-block">
        <div className="row between">
          <h2>Artigos</h2>
          {lines.some((l) => l.productId) && (
            <button className="link" onClick={reprice}>Recalcular com as condições do cliente</button>
          )}
        </div>
        <ProductAdder onAdd={addProducts} />
        {lines.length === 0 ? (
          <div className="empty small">Procure artigos acima ou cole uma lista de referências.</div>
        ) : (
          <div className="table-wrap">
            <table className="table quote-lines">
              <thead>
                <tr>
                  <th>Artigo</th>
                  <th>Tam./Comp.</th>
                  <th className="num">Qtd.</th>
                  <th className="num">P. tabela</th>
                  <th>Desc. %</th>
                  <th className="num">P. líquido</th>
                  <th className="num">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const p = l.productId ? products.get(l.productId) : undefined;
                  return (
                    <tr key={l.key}>
                      <td className="art">
                        {p ? (
                          <>
                            <strong>{l.reference}</strong> <small className="muted">{l.manufacturerName}</small>
                            <div>{l.designation}</div>
                          </>
                        ) : (
                          <>
                            <input className="ref" placeholder="Referência" value={l.reference} onChange={(e) => setLine(l.key, { reference: e.target.value })} />
                            <input placeholder="Designação" value={l.designation} onChange={(e) => setLine(l.key, { designation: e.target.value })} />
                          </>
                        )}
                      </td>
                      <td>
                        {p?.sizeType ? (
                          <>
                            <input
                              className="small-in"
                              list={`qs-${l.key}`}
                              value={l.variant ?? ""}
                              placeholder={p.sizeType === "medida" ? "mm" : "—"}
                              onChange={async (e) => {
                                const variant = e.target.value.slice(0, 20);
                                if (p.sizeType === "medida") {
                                  const price = await suggested(p, quote.clientId, variant);
                                  setLine(l.key, { variant, listPrice: price.listPrice, netPrice: applyDiscounts(price.listPrice, l.discounts) });
                                } else setLine(l.key, { variant });
                              }}
                            />
                            <datalist id={`qs-${l.key}`}>{sizesFor(p).map((s) => <option key={s} value={s} />)}</datalist>
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="num">
                        <input className="num-in" inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.key, { qty: Number(e.target.value.replace(",", ".")) || 0 })} />
                        <small className="muted"> {l.salesUnit}</small>
                      </td>
                      <td className="num">
                        <input
                          className="num-in"
                          inputMode="decimal"
                          value={l.listPrice}
                          onChange={(e) => {
                            const listPrice = Number(e.target.value.replace(",", ".")) || 0;
                            setLine(l.key, { listPrice, netPrice: applyDiscounts(listPrice, l.discounts) });
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="disc-in"
                          placeholder="ex. 40+5"
                          value={l.discountsText}
                          onChange={(e) => {
                            const discounts = parseDiscounts(e.target.value);
                            setLine(l.key, { discountsText: e.target.value, discounts, netPrice: applyDiscounts(l.listPrice, discounts) });
                          }}
                        />
                      </td>
                      <td className="num">
                        <input
                          className="num-in"
                          inputMode="decimal"
                          title="Escrever um preço líquido substitui os descontos"
                          value={l.netPrice}
                          onChange={(e) => setLine(l.key, { netPrice: round4(Number(e.target.value.replace(",", ".")) || 0), discounts: [], discountsText: "" })}
                        />
                      </td>
                      <td className="num"><strong>{formatEur(round2(l.netPrice * l.qty))}</strong></td>
                      <td className="actions">
                        <button className="link" title="Subir" disabled={i === 0} onClick={() => setLines((ls) => move(ls, i, -1))}>↑</button>
                        <button className="link danger" title="Remover" onClick={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); setDirty(true); }}>
                          <Icon name="close" size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}><strong>Total s/ IVA</strong></td>
                  <td className="num"><strong>{formatEur(total)}</strong></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <button
          className="link"
          onClick={() => {
            setLines((ls) => [...ls, toDraft({ reference: "", designation: "", salesUnit: "un", qty: 1, listPrice: 0, discounts: [], netPrice: 0, lineTotal: 0 })]);
            setDirty(true);
          }}
        >
          + Linha livre (artigo fora do catálogo)
        </button>
      </section>

      <section className="card-block">
        <h2>Condições</h2>
        <div className="form-grid">
          <label>Válida até<input type="date" value={quote.validUntil ?? ""} onChange={(e) => set({ validUntil: e.target.value })} /></label>
          <label>
            Estado
            <select value={quote.status} onChange={(e) => set({ status: e.target.value as QuoteStatus })}>
              {Object.entries(QUOTE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Condições de pagamento<input value={quote.paymentTerms ?? ""} placeholder="ex. 30 dias após fatura" onChange={(e) => set({ paymentTerms: e.target.value })} /></label>
          <label>Prazo de entrega<input value={quote.deliveryTerms ?? ""} placeholder="ex. 5 a 8 dias úteis" onChange={(e) => set({ deliveryTerms: e.target.value })} /></label>
          <label className="full">Observações (aparecem na proposta)<textarea rows={3} value={quote.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} /></label>
          <label className="full">Nota interna (só a equipa Freixo vê)<textarea rows={2} value={quote.internalNote ?? ""} onChange={(e) => set({ internalNote: e.target.value })} /></label>
        </div>
      </section>

      <div className="row wrap">
        <button className="btn primary" disabled={busy || !canEditOwner} onClick={() => save()}>Guardar</button>
        {quote.id && <button className="btn ghost" onClick={duplicate}>Duplicar</button>}
        {quote.id && (
          <button className="btn ghost danger" onClick={remove} onBlur={() => setConfirming(false)}>
            {confirming ? "Confirmar: eliminar esta proposta" : "Eliminar"}
          </button>
        )}
      </div>
    </div>
  );
}

function move<T>(list: T[], i: number, d: number) {
  const next = [...list];
  const j = i + d;
  if (j < 0 || j >= next.length) return list;
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// ------------------------------------------------------------------ adicionar artigos

function ProductAdder({ onAdd }: { onAdd: (list: { product: Product; qty: number }[]) => void }) {
  const { catalog } = useApp();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let stale = false;
    const t = window.setTimeout(() => {
      api.searchProducts({ q: term, offset: 0, limit: 10 }).then((page) => !stale && setResults(page.products), () => undefined);
    }, 250);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [q]);

  const mfr = (p: Product) => catalog?.manufacturers.find((m) => m.id === p.manufacturerId)?.name ?? "";

  async function addPasted() {
    const wanted = parseQuickOrder(text);
    if (!wanted.length) return;
    const found = await api.findProducts(wanted.map((w) => w.reference));
    const norm = (s: string) => s.toUpperCase().replace(/[\s.\-_/]/g, "");
    const list: { product: Product; qty: number }[] = [];
    const missing: string[] = [];
    for (const w of wanted) {
      const p = found.find((x) => norm(x.reference) === norm(w.reference) || (x.ean && norm(x.ean) === norm(w.reference)));
      if (p) list.push({ product: p, qty: w.qty });
      else missing.push(w.reference);
    }
    onAdd(list);
    setMsg(`${list.length} artigos adicionados.${missing.length ? ` Não encontrados: ${missing.join(", ")}` : ""}`);
    if (!missing.length) {
      setText("");
      setPaste(false);
    }
  }

  return (
    <div className="adder">
      <div className="adder-search">
        <Icon name="search" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar artigo para juntar (referência, nome, marca)" />
        <button className="link" onClick={() => setPaste((v) => !v)}>{paste ? "Fechar" : "Colar lista de referências"}</button>
      </div>
      {results.length > 0 && (
        <ul className="adder-results">
          {results.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  onAdd([{ product: p, qty: 1 }]);
                  setQ("");
                  setResults([]);
                }}
              >
                <strong>{p.reference}</strong>
                <span>{p.designation}</span>
                <small>{mfr(p)}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {paste && (
        <div className="adder-paste">
          <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Uma linha por artigo, ex.:\n2321 10\nJSP-AEB030-1A2-000 5"} />
          <button className="btn ghost" onClick={addPasted} disabled={!text.trim()}>Juntar à proposta</button>
        </div>
      )}
      {msg && <p className="muted small">{msg}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ PDF (janela de impressão)

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function printQuote(q: Quote, products: Map<string, Product>, author: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  const anyDiscount = q.lines.some((l) => l.discounts.length || l.netPrice < l.listPrice);
  const rows = q.lines
    .map((l) => {
      const p = l.productId ? products.get(l.productId) : undefined;
      const img = p?.imageUrl ? `<img src="${esc(new URL(p.imageUrl, location.origin).href)}" alt="">` : "";
      const variant = l.variant ? ` · ${esc(variantLabel(p ?? { sizeType: null }, l.variant))}` : "";
      return `<tr><td class=img>${img}</td><td><strong>${esc(l.reference)}</strong>${l.manufacturerName ? `<br><span class=muted>${esc(l.manufacturerName)}</span>` : ""}</td>
<td>${esc(l.designation)}${variant}</td><td class=n>${l.qty} ${esc(l.salesUnit)}</td>
${anyDiscount ? `<td class=n>${formatEur(l.listPrice)}</td><td class=n>${l.discounts.length ? formatDiscounts(l.discounts) : l.netPrice < l.listPrice ? "Especial" : "—"}</td>` : ""}
<td class=n>${formatEur(l.netPrice)}</td><td class=n>${formatEur(round2(l.netPrice * l.qty))}</td></tr>`;
    })
    .join("");
  const cust = [
    q.customerNif ? `NIF ${esc(q.customerNif)}` : "",
    q.customerAddress ? esc(q.customerAddress) : "",
    q.contactName ? `A/C ${esc(q.contactName)}` : "",
    [q.customerEmail, q.customerPhone].filter(Boolean).map((x) => esc(String(x))).join(" · "),
  ]
    .filter(Boolean)
    .join("<br>");
  const terms = [
    q.validUntil ? `<div><span>Validade</span>${shortDate(q.validUntil)}</div>` : "",
    q.paymentTerms ? `<div><span>Pagamento</span>${esc(q.paymentTerms)}</div>` : "",
    q.deliveryTerms ? `<div><span>Entrega</span>${esc(q.deliveryTerms)}</div>` : "",
  ].join("");
  w.document.write(`<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><title>${esc(q.number ?? "Proposta")} · ${esc(q.customerName)}</title>
<style>
@page{size:A4;margin:14mm}
body{font:12px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#2b2b2d;margin:0}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:14px;border-bottom:3px solid #d2b12b}
.top img{height:62px}
.doc{text-align:right}.doc h1{font-size:20px;margin:0;color:#3b3b3d;letter-spacing:.04em}.doc strong{font-size:14px}
.muted{color:#6b6f75}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:16px 0}
.box{border:1px solid #e1e1e3;border-radius:6px;padding:10px 12px}.box h3{margin:0 0 4px;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#9a8320}
table{width:100%;border-collapse:collapse;margin-top:6px}
th{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#6b6f75;text-align:left;border-bottom:2px solid #3b3b3d;padding:6px}
td{border-bottom:1px solid #e6e6e8;padding:6px;vertical-align:middle}
td.img{width:44px}td.img img{width:40px;height:40px;object-fit:contain}
.n{text-align:right;white-space:nowrap}
tfoot td{border:0;font-size:14px;padding-top:10px}
.terms{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}.terms div{border:1px solid #e1e1e3;border-radius:6px;padding:8px 12px;min-width:150px}.terms span{display:block;font-size:10px;text-transform:uppercase;color:#6b6f75}
.notes{white-space:pre-wrap;border-left:3px solid #d2b12b;padding:6px 12px;background:#faf7ea}
.foot{margin-top:28px;font-size:10px;color:#6b6f75;border-top:1px solid #e1e1e3;padding-top:8px;display:flex;justify-content:space-between}
tr{page-break-inside:avoid}
</style></head><body>
<div class=top><img src="${location.origin}/logo.png" alt="Representações Freixo"><div class=doc><h1>PROPOSTA</h1><strong>${esc(q.number ?? "")}</strong><div class=muted>${new Date(q.createdAt ?? Date.now()).toLocaleDateString("pt-PT")}</div></div></div>
<div class=parties>
<div class=box><h3>Cliente</h3><strong>${esc(q.customerName)}</strong><br>${cust}</div>
<div class=box><h3>Representações Freixo</h3>Viana do Castelo · Portugal<br>Comercial: ${esc(q.ownerName || author)}${q.ownerEmail ? `<br>${esc(q.ownerEmail)}` : ""}</div>
</div>
<table><thead><tr><th></th><th>Referência</th><th>Designação</th><th class=n>Qtd.</th>${anyDiscount ? "<th class=n>P. tabela</th><th class=n>Desc.</th>" : ""}<th class=n>P. unit.</th><th class=n>Total</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan=${anyDiscount ? 7 : 5} class=n><strong>Total sem IVA</strong></td><td class=n><strong>${formatEur(q.total)}</strong></td></tr></tfoot></table>
${terms ? `<div class=terms>${terms}</div>` : ""}
${q.notes ? `<div class=notes>${esc(q.notes)}</div>` : ""}
<div class=foot><span>Valores em euros, sem IVA. Proposta sujeita a confirmação de stock.</span><span>Representações Freixo · encomendas.representacoesfreixo.com</span></div>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
  w.document.close();
}
