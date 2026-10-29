import { useCallback, useEffect, useMemo, useState } from "react";
import { StatusBadge, formatDate, statusLabel } from "../components";
import { api } from "../data";
import { detectColumns, mapRows, readSpreadsheet, type ColumnMap } from "../importer";
import { formatDiscounts, formatEur, normRef, parseDiscounts } from "../pricing";
import { go, useApp } from "../state";
import type { AccessRequest, Client, DiscountRule, Manufacturer, Order, OrderStatus, PriceImportRow } from "../types";
import { OrderLinesTable } from "./Orders";

const TABS = [
  ["encomendas", "Encomendas"],
  ["fabricantes", "Fabricantes"],
  ["precos", "Importar preços"],
  ["clientes", "Clientes e descontos"],
  ["pedidos", "Pedidos de acesso"],
] as const;

export function AdminPage() {
  const { session, route } = useApp();
  const tab = route.params.get("t") ?? "encomendas";
  if (!session || session.role !== "admin") {
    return (
      <div className="panel narrow">
        <h1>Área de gestão</h1>
        <p>Reservada à equipa da Representações Freixo.</p>
        <button className="btn primary" onClick={() => go("entrar", { voltar: "gestao" })}>Entrar</button>
      </div>
    );
  }
  return (
    <div className="admin">
      <h1 className="page-title">Gestão</h1>
      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => go("gestao", { t: id })}>{label}</button>
        ))}
      </nav>
      {tab === "encomendas" && <OrdersAdmin />}
      {tab === "fabricantes" && <ManufacturersAdmin />}
      {tab === "precos" && <ImportAdmin />}
      {tab === "clientes" && <ClientsAdmin />}
      {tab === "pedidos" && <RequestsAdmin />}
    </div>
  );
}

// ------------------------------------------------------------------ encomendas

const NEXT: Partial<Record<OrderStatus, OrderStatus>> = { pending: "validated", validated: "sent", sent: "confirmed", confirmed: "delivered" };
const NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  pending: "Validar",
  validated: "Marcar como enviada ao fabricante",
  sent: "Fabricante confirmou",
  confirmed: "Marcar como entregue",
};

function OrdersAdmin() {
  const { catalog } = useApp();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [filter, setFilter] = useState<string>("pending");
  const [open, setOpen] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const load = useCallback(() => {
    api.listOrders().then(setOrders);
    api.listClients().then(setClients);
  }, []);
  useEffect(load, [load]);
  if (!orders || !catalog) return <div className="empty">A carregar…</div>;

  const mfr = (id: string) => catalog.manufacturers.find((m) => m.id === id);
  const counts = orders.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.status]: (acc[o.status] ?? 0) + 1 }), {});
  const list = filter === "all" ? orders : orders.filter((o) => o.status === filter);

  async function move(o: Order, status: OrderStatus, note?: string) {
    await api.setOrderStatus(o.id, status, note);
    load();
  }

  return (
    <>
      <div className="chips">
        {["pending", "validated", "sent", "confirmed", "delivered", "cancelled", "all"].map((s) => (
          <button key={s} className={filter === s ? "active" : ""} onClick={() => setFilter(s)}>
            {s === "all" ? "Todas" : statusLabel[s]} {s === "all" ? orders.length : counts[s] ?? 0}
          </button>
        ))}
      </div>
      {list.length === 0 && <p className="muted">Sem encomendas neste estado.</p>}
      <div className="order-list">
        {list.map((o) => {
          const m = mfr(o.manufacturerId);
          const client = clients.find((c) => c.id === o.clientId);
          return (
            <article key={o.id} className="order">
              <button className="order-head" onClick={() => setOpen(open === o.id ? null : o.id)}>
                <div>
                  <strong>{o.number} · {o.clientName}</strong>
                  <span>{m?.name} · {formatDate(o.createdAt)}{o.customerRef ? ` · Ref. cliente ${o.customerRef}` : ""}</span>
                </div>
                <StatusBadge status={o.status} />
                <strong className="amount">{formatEur(o.subtotal)}</strong>
              </button>
              {open === o.id && (
                <div className="order-body">
                  <OrderLinesTable order={o} />
                  <NoteEditor order={o} onSave={(note) => move(o, o.status, note)} />
                  <div className="row wrap">
                    {NEXT[o.status] && (
                      <button className="btn primary" onClick={() => move(o, NEXT[o.status]!)}>{NEXT_LABEL[o.status]}</button>
                    )}
                    {(o.status === "validated" || o.status === "sent") && (
                      <>
                        <a className="btn ghost" href={mailtoForManufacturer(o, m?.name ?? "", m?.ordersEmail ?? "", client)}>Preparar email ao fabricante</a>
                        <button className="btn ghost" onClick={() => printOrder(o, m?.name ?? "", client)}>Imprimir / PDF</button>
                      </>
                    )}
                    {o.status !== "cancelled" && o.status !== "delivered" && <CancelButton onConfirm={() => move(o, "cancelled")} />}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}

function CancelButton({ onConfirm }: { onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button className="btn ghost danger" onClick={() => setAsking(true)}>Cancelar</button>;
  return (
    <span className="row" style={{ marginTop: 0 }}>
      <button className="btn primary" onClick={onConfirm}>Sim, cancelar encomenda</button>
      <button className="btn ghost" onClick={() => setAsking(false)}>Não</button>
    </span>
  );
}

function NoteEditor({ order, onSave }: { order: Order; onSave: (n: string) => void }) {
  const [note, setNote] = useState(order.internalNote ?? "");
  return (
    <label className="note">
      Nota interna (não visível para o cliente)
      <div className="row">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: confirmado prazo com o fabricante" />
        <button className="btn ghost" disabled={note === (order.internalNote ?? "")} onClick={() => onSave(note)}>Guardar</button>
      </div>
    </label>
  );
}

function orderText(o: Order, client?: Client) {
  const lines = o.lines.map(
    (l) => `${l.reference} | ${l.designation} | ${l.qty} ${l.salesUnit} | ${l.discounts.length ? formatDiscounts(l.discounts) : "-"} | ${formatEur(l.netPrice)}`
  );
  return [
    `Cliente: ${o.clientName}${client?.nif ? ` (NIF ${client.nif})` : ""}`,
    client?.address ? `Morada: ${client.address}` : "",
    o.customerRef ? `Ref. cliente: ${o.customerRef}` : "",
    "",
    "Referência | Designação | Quantidade | Desconto | Preço líquido",
    ...lines,
    "",
    `Total s/ IVA: ${formatEur(o.subtotal)}`,
    o.notes ? `\nObservações do cliente: ${o.notes}` : "",
  ]
    .filter((x, i, arr) => x !== "" || arr[i - 1] !== "")
    .join("\n");
}

function mailtoForManufacturer(o: Order, mfrName: string, email: string, client?: Client) {
  const subject = `Encomenda ${o.number} · ${o.clientName}`;
  const body = `Bom dia,\n\nSegue encomenda para ${mfrName}:\n\n${orderText(o, client)}\n\nObrigado,\nAlexandre Freixo\nRepresentações Freixo`;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function printOrder(o: Order, mfrName: string, client?: Client) {
  const w = window.open("", "_blank");
  if (!w) return;
  const rows = o.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.reference)}</td><td>${esc(l.designation)}</td><td class=n>${l.qty} ${esc(l.salesUnit)}</td><td class=n>${formatEur(l.listPrice)}</td><td>${l.discounts.length ? formatDiscounts(l.discounts) : "—"}</td><td class=n>${formatEur(l.netPrice)}</td><td class=n>${formatEur(l.lineTotal)}</td></tr>`
    )
    .join("");
  w.document.write(`<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><title>${esc(o.number)}</title>
<style>body{font:13px system-ui,sans-serif;color:#15314c;margin:32px}h1{font:600 22px Georgia,serif;margin:0}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border-bottom:1px solid #d6e0e6;padding:7px;text-align:left}th{font-size:11px;text-transform:uppercase;color:#5a7385}.n{text-align:right}.top{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #ef9b45;padding-bottom:14px}.muted{color:#5a7385}</style></head><body>
<div class=top><div><h1>Representações Freixo</h1><div class=muted>Nota de encomenda</div></div><div style="text-align:right"><strong>${esc(o.number)}</strong><div class=muted>${formatDate(o.createdAt)}</div></div></div>
<p><strong>Fabricante:</strong> ${esc(mfrName)}<br><strong>Cliente:</strong> ${esc(o.clientName)}${client?.nif ? ` · NIF ${esc(client.nif)}` : ""}${client?.address ? `<br><strong>Morada:</strong> ${esc(client.address)}` : ""}${o.customerRef ? `<br><strong>Ref. cliente:</strong> ${esc(o.customerRef)}` : ""}</p>
<table><thead><tr><th>Referência</th><th>Designação</th><th class=n>Qtd.</th><th class=n>P. tabela</th><th>Desc.</th><th class=n>P. líquido</th><th class=n>Total</th></tr></thead><tbody>${rows}</tbody>
<tfoot><tr><td colspan=6><strong>Total s/ IVA</strong></td><td class=n><strong>${formatEur(o.subtotal)}</strong></td></tr></tfoot></table>
${o.notes ? `<p><strong>Observações:</strong> ${esc(o.notes)}</p>` : ""}
<script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

// ------------------------------------------------------------------ importar preços

const FIELDS: [keyof PriceImportRow, string][] = [
  ["reference", "Referência *"],
  ["designation", "Designação"],
  ["listPrice", "Preço de tabela"],
  ["salesUnit", "Unidade"],
  ["packQty", "Unidades por caixa"],
  ["family", "Família"],
  ["ean", "EAN"],
];

function ImportAdmin() {
  const { catalog, refreshCatalog, refreshSession } = useApp();
  const [mfrId, setMfrId] = useState("");
  const [raw, setRaw] = useState<unknown[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<ColumnMap>({});
  const [headerRow, setHeaderRow] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => (raw ? mapRows(raw, map, headerRow) : []), [raw, map, headerRow]);
  const header = raw?.[headerRow] ?? [];

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    try {
      const data = await readSpreadsheet(file);
      const detected = detectColumns(data);
      setRaw(data);
      setFileName(file.name);
      setHeaderRow(detected.headerRow);
      setMap(detected.map);
    } catch (e) {
      setError(`Não consegui ler o ficheiro: ${(e as Error).message}`);
    }
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.importPriceList(mfrId, rows);
      setResult(`Importação concluída: ${r.updated} artigos atualizados, ${r.created} novos, ${r.skipped} ignorados.`);
      setRaw(null);
      await refreshCatalog();
      await refreshSession();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel wide">
      <h2>Importar tabela de preços (Excel)</h2>
      <p className="hint">
        Escolha o fabricante e carregue o ficheiro .xlsx ou .csv. As colunas são detetadas automaticamente; confirme abaixo.
        Os artigos são atualizados pela referência e os novos são criados. Tabelas em PDF: envie-mas e converto-as para Excel.
      </p>
      <div className="row wrap">
        <select value={mfrId} onChange={(e) => setMfrId(e.target.value)}>
          <option value="">Fabricante…</option>
          {catalog?.manufacturers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <input type="file" accept=".xlsx,.csv" disabled={!mfrId} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </div>
      {error && <p className="error">{error}</p>}
      {result && <p className="ok">{result}</p>}
      {raw && (
        <>
          <h3>{fileName}: correspondência de colunas</h3>
          <div className="mapping">
            <label>
              Linha de cabeçalho
              <input type="number" min={1} value={headerRow + 1} onChange={(e) => setHeaderRow(Math.max(0, Number(e.target.value) - 1))} />
            </label>
            {FIELDS.map(([field, label]) => (
              <label key={field}>
                {label}
                <select
                  value={map[field] ?? ""}
                  onChange={(e) => setMap((m) => ({ ...m, [field]: e.target.value === "" ? undefined : Number(e.target.value) }))}
                >
                  <option value="">—</option>
                  {header.map((h, i) => <option key={i} value={i}>{String(h ?? `Coluna ${i + 1}`)}</option>)}
                </select>
              </label>
            ))}
          </div>
          <p>{rows.length} linhas. Os artigos que já existem ficam com o preço atualizado; os restantes são criados.</p>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Referência</th><th>Designação</th><th className="num">Preço</th><th>Un.</th><th className="num">Cx.</th><th>Família</th></tr></thead>
              <tbody>
                {rows.slice(0, 12).map((r, i) => (
                  <tr key={i}>
                    <td>{r.reference}</td><td>{r.designation}</td><td className="num">{r.listPrice != null ? formatEur(r.listPrice) : "—"}</td>
                    <td>{r.salesUnit}</td><td className="num">{r.packQty}</td><td>{r.family}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn primary" disabled={busy || map.reference === undefined || !rows.length} onClick={runImport}>
            {busy ? "A importar…" : `Importar ${rows.length} linhas`}
          </button>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ clientes e descontos

function ClientsAdmin() {
  const { catalog, refreshSession, productsById, ensureProducts } = useApp();
  const [clients, setClients] = useState<Client[]>([]);
  const [rules, setRules] = useState<DiscountRule[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [editing, setEditing] = useState<Partial<Client> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    api.listClients().then(setClients);
    api.listRules().then((list) => {
      setRules(list);
      const ids = list.map((r) => r.productId).filter((id): id is string => !!id);
      if (ids.length) ensureProducts(ids).catch(() => undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(load, [load]);
  if (!catalog) return null;

  const client = clients.find((c) => c.id === selected);
  const visibleRules = rules.filter((r) => (selected ? r.clientId === selected : !r.clientId));
  const mfrName = (id: string) => catalog.manufacturers.find((m) => m.id === id)?.name ?? "";
  const scope = (r: DiscountRule) =>
    r.productId
      ? `Artigo ${productsById.get(r.productId)?.reference ?? ""}`
      : r.familyId
        ? `Família ${catalog.families.find((f) => f.id === r.familyId)?.name ?? ""}`
        : "Todo o fabricante";

  return (
    <div className="clients-admin">
      <aside className="client-list">
        <button className={!selected ? "active" : ""} onClick={() => setSelected("")}>Regras gerais (todos os clientes)</button>
        {clients.map((c) => (
          <button key={c.id} className={selected === c.id ? "active" : ""} onClick={() => setSelected(c.id)}>{c.name}</button>
        ))}
        <button className="btn ghost" onClick={() => setEditing({ name: "" })}>+ Novo cliente</button>
      </aside>

      <section className="panel wide">
        {editing ? (
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const saved = await api.saveClient(editing as Client);
              setEditing(null);
              setSelected(saved.id);
              load();
            }}
          >
            <h2 className="full">{editing.id ? "Editar cliente" : "Novo cliente"}</h2>
            <label>Nome<input required value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
            <label>NIF<input value={editing.nif ?? ""} onChange={(e) => setEditing({ ...editing, nif: e.target.value })} /></label>
            <label>Email<input type="email" value={editing.email ?? ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></label>
            <label>Telefone<input value={editing.phone ?? ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></label>
            <label className="full">Morada de entrega<input value={editing.address ?? ""} onChange={(e) => setEditing({ ...editing, address: e.target.value })} /></label>
            <div className="row full">
              <button className="btn primary">Guardar</button>
              <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancelar</button>
            </div>
          </form>
        ) : (
          <>
            <div className="row between">
              <h2>{client ? client.name : "Regras gerais"}</h2>
              {client && <button className="btn ghost" onClick={() => setEditing(client)}>Editar ficha</button>}
            </div>
            {client ? (
              <p className="muted">{[client.nif && `NIF ${client.nif}`, client.email, client.phone, client.address].filter(Boolean).join(" · ")}</p>
            ) : (
              <p className="muted">Aplicam-se a todos os clientes, exceto quando o cliente tem uma regra própria para o mesmo fabricante.</p>
            )}

            <h3>Descontos e preços especiais</h3>
            <table className="table">
              <thead><tr><th>Fabricante</th><th>Aplica-se a</th><th>Condição</th><th /></tr></thead>
              <tbody>
                {visibleRules.length === 0 && <tr><td colSpan={4} className="muted">Sem regras: vê o preço de tabela.</td></tr>}
                {visibleRules.map((r) => (
                  <tr key={r.id}>
                    <td>{mfrName(r.manufacturerId)}</td>
                    <td>{scope(r)}</td>
                    <td>{r.specialNetPrice != null ? `Preço líquido ${formatEur(r.specialNetPrice)}` : formatDiscounts(r.discounts) || "—"}</td>
                    <td><button className="link danger" onClick={async () => { await api.deleteRule(r.id); load(); refreshSession(); }}>Apagar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <RuleForm clientId={selected || null} onSaved={() => { load(); refreshSession(); }} />

            {client && (
              <>
                <h3>Acesso à loja</h3>
                <InviteForm client={client} onMessage={setMsg} />
                {msg && <p className="ok">{msg}</p>}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function RuleForm({ clientId, onSaved }: { clientId: string | null; onSaved: () => void }) {
  const { catalog } = useApp();
  const [mfr, setMfr] = useState("");
  const [familyId, setFamilyId] = useState("");
  const [ref, setRef] = useState("");
  const [kind, setKind] = useState<"disc" | "net">("disc");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!catalog) return null;
  const families = catalog.families.filter((f) => f.manufacturerId === mfr);

  async function save() {
    setError(null);
    let productId: string | undefined;
    if (ref.trim()) {
      const p = (await api.findProducts([ref], mfr)).find((x) => normRef(x.reference) === normRef(ref) || normRef(x.ean ?? "") === normRef(ref));
      if (!p) return setError("Referência não encontrada neste fabricante.");
      productId = p.id;
    }
    const discounts = kind === "disc" ? parseDiscounts(value) : [];
    const net = kind === "net" ? Number(value.replace(",", ".")) : null;
    if (kind === "disc" && !discounts.length) return setError("Indique o desconto, ex.: 40 + 5");
    if (kind === "net" && !(net! >= 0)) return setError("Indique o preço líquido.");
    if (kind === "net" && !productId) return setError("O preço líquido especial aplica-se a um artigo: indique a referência.");
    await api.saveRule({ clientId, manufacturerId: mfr, familyId: productId ? null : familyId || null, productId, discounts, specialNetPrice: net });
    setValue("");
    setRef("");
    onSaved();
  }

  return (
    <div className="rule-form">
      <select value={mfr} onChange={(e) => { setMfr(e.target.value); setFamilyId(""); }}>
        <option value="">Fabricante…</option>
        {catalog.manufacturers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <select value={familyId} disabled={!mfr || !!ref} onChange={(e) => setFamilyId(e.target.value)}>
        <option value="">Todas as famílias</option>
        {families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      <input placeholder="Referência (opcional)" value={ref} disabled={!mfr} onChange={(e) => setRef(e.target.value)} />
      <select value={kind} onChange={(e) => setKind(e.target.value as "disc" | "net")}>
        <option value="disc">Desconto %</option>
        <option value="net">Preço líquido €</option>
      </select>
      <input placeholder={kind === "disc" ? "Ex.: 40 + 5" : "Ex.: 12,50"} value={value} onChange={(e) => setValue(e.target.value)} />
      <button className="btn primary" disabled={!mfr} onClick={save}>Adicionar</button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function InviteForm({ client, onMessage }: { client: Client; onMessage: (m: string) => void }) {
  const [email, setEmail] = useState(client.email ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <div className="row wrap">
      <input type="email" placeholder="Email do utilizador" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button
        className="btn ghost"
        disabled={!email || busy}
        onClick={async () => {
          setBusy(true);
          try {
            onMessage(await api.inviteClientUser(client.id, email));
          } catch (e) {
            onMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Enviar convite de acesso
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ pedidos de acesso

function RequestsAdmin() {
  const [list, setList] = useState<AccessRequest[] | null>(null);
  useEffect(() => {
    api.listAccessRequests().then(setList);
  }, []);
  if (!list) return <div className="empty">A carregar…</div>;
  return (
    <div className="panel wide">
      <h2>Pedidos de acesso</h2>
      {list.length === 0 && <p className="muted">Sem pedidos.</p>}
      {list.map((r) => (
        <article key={r.id} className="request">
          <strong>{r.company}</strong>
          <span>{[r.name, r.email, r.phone, r.nif && `NIF ${r.nif}`].filter(Boolean).join(" · ")}</span>
          {r.message && <p>{r.message}</p>}
          <small className="muted">{formatDate(r.createdAt)}</small>
        </article>
      ))}
      <p className="hint">Para dar acesso: crie o cliente em "Clientes e descontos" e envie o convite para o email.</p>
    </div>
  );
}

// ------------------------------------------------------------------ fabricantes

type MfrDraft = { id?: string; name: string; ordersEmail: string; logoUrl: string; sort: number; active: boolean };

function ManufacturersAdmin() {
  const { refreshCatalog } = useApp();
  const [list, setList] = useState<Manufacturer[] | null>(null);
  const [draft, setDraft] = useState<MfrDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.listManufacturers().then(setList).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);
  if (!list) return <div className="empty">A carregar…</div>;

  const edit = (m?: Manufacturer) =>
    setDraft(
      m
        ? { id: m.id, name: m.name, ordersEmail: m.ordersEmail ?? "", logoUrl: m.logoUrl ?? "", sort: m.sort, active: m.active !== false }
        : { name: "", ordersEmail: "", logoUrl: "", sort: (list.at(-1)?.sort ?? 0) + 1, active: true }
    );

  return (
    <div className="panel wide">
      <div className="row between">
        <h2>Fabricantes</h2>
        {!draft && <button className="btn primary" onClick={() => edit()}>+ Novo fabricante</button>}
      </div>
      <p className="hint">Cada fabricante aparece como separador no catálogo. O email de encomendas é usado em "Preparar email ao fabricante".</p>
      {error && <p className="error">{error}</p>}

      {draft && (
        <form
          className="form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await api.saveManufacturer({ ...draft, name: draft.name.trim() });
              setDraft(null);
              load();
              refreshCatalog();
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <label>Nome<input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label>Email de encomendas<input type="email" value={draft.ordersEmail} onChange={(e) => setDraft({ ...draft, ordersEmail: e.target.value })} /></label>
          <label>Logótipo (endereço da imagem, opcional)<input type="url" value={draft.logoUrl} onChange={(e) => setDraft({ ...draft, logoUrl: e.target.value })} placeholder="https://…" /></label>
          <label>Ordem no catálogo<input type="number" value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: Number(e.target.value) })} /></label>
          <label className="check full" style={{ flexDirection: "row", alignItems: "center" }}>
            <input type="checkbox" style={{ width: "auto" }} checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
            Visível no catálogo
          </label>
          <div className="row full">
            <button className="btn primary">Guardar</button>
            <button type="button" className="btn ghost" onClick={() => setDraft(null)}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="table-wrap">
        <table className="table">
          <thead><tr><th className="num">Ordem</th><th>Fabricante</th><th>Email de encomendas</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={5} className="muted">Ainda não há fabricantes. Crie o primeiro com "+ Novo fabricante".</td></tr>}
            {list.map((m) => (
              <tr key={m.id}>
                <td className="num">{m.sort}</td>
                <td><strong>{m.name}</strong></td>
                <td>{m.ordersEmail || <span className="muted">—</span>}</td>
                <td>{m.active === false ? <span className="status s-cancelled">Oculto</span> : <span className="status s-delivered">Visível</span>}</td>
                <td><button className="link" onClick={() => edit(m)}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
