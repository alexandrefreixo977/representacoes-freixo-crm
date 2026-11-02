import { useEffect, useState } from "react";
import { api } from "./data";
import { normSearch } from "./pricing";
import type { Client, CrmClientHit } from "./types";

/** Escolha da equipa: cliente da loja (shop) e/ou cliente do CRM (crm). */
export type ClientPick = { shop?: Client; crm?: CrmClientHit };

/**
 * Pesquisa de clientes para a equipa Freixo (propostas e encomendas): procura na base de dados do CRM
 * e junta os clientes que só existem na loja. Mostra se o cliente já tem ficha na loja.
 */
export function ClientSearch({ onPick, placeholder, autoFocus }: { onPick: (pick: ClientPick) => void; placeholder?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [shop, setShop] = useState<Client[]>([]);
  const [crm, setCrm] = useState<CrmClientHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [crmError, setCrmError] = useState<string | null>(null);

  useEffect(() => {
    api.listClients().then(setShop, () => undefined);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setCrm([]);
      return;
    }
    let stale = false;
    setBusy(true);
    const t = window.setTimeout(() => {
      api
        .searchCrmClients(term)
        .then((r) => !stale && (setCrm(r), setCrmError(null)))
        .catch((e) => !stale && (setCrm([]), setCrmError((e as Error).message)))
        .finally(() => !stale && setBusy(false));
    }, 300);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [q]);

  const terms = normSearch(q).split(/\s+/).filter(Boolean);
  const linked = new Set(crm.map((c) => c.shopClientId).filter(Boolean));
  // Clientes da loja que não vieram do CRM nesta pesquisa (ex. criados só na loja).
  const shopOnly = terms.length
    ? shop.filter((c) => !linked.has(c.id) && terms.every((t) => normSearch(`${c.name} ${c.nif ?? ""} ${c.email ?? ""}`).includes(t))).slice(0, 10)
    : [];
  const shopById = new Map(shop.map((c) => [c.id, c]));

  function pick(p: ClientPick) {
    setQ("");
    setCrm([]);
    onPick(p);
  }

  return (
    <div className="client-search">
      <input autoFocus={autoFocus} value={q} placeholder={placeholder ?? "Procurar cliente no CRM (nome, NIF ou email)"} onChange={(e) => setQ(e.target.value)} />
      {busy && <small className="muted">A procurar no CRM…</small>}
      {crmError && <small className="muted">Sem ligação ao CRM ({crmError}). A mostrar só os clientes da loja.</small>}
      {(crm.length > 0 || shopOnly.length > 0) && (
        <ul className="client-pick">
          {crm.map((c) => (
            <li key={c.crmId}>
              <button type="button" onClick={() => pick({ crm: c, shop: c.shopClientId ? shopById.get(c.shopClientId) : undefined })}>
                <strong>{c.name}</strong>
                <small>{[c.nif && `NIF ${c.nif}`, c.email, c.shopClientId ? "já na loja" : "só no CRM"].filter(Boolean).join(" · ")}</small>
              </button>
            </li>
          ))}
          {shopOnly.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => pick({ shop: c })}>
                <strong>{c.name}</strong>
                <small>{[c.nif && `NIF ${c.nif}`, c.email, "só na loja"].filter(Boolean).join(" · ")}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {terms.length > 0 && q.trim().length >= 2 && !busy && !crm.length && !shopOnly.length && <small className="muted">Nenhum cliente encontrado.</small>}
    </div>
  );
}
