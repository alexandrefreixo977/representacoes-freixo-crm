import { useMemo, useState } from "react";
import { api } from "../data";
import { parseCampaignPdf, parseCampaignSheet, readPdf, referenceCandidates, type CampaignImportRow } from "../campaignImport";
import { readSpreadsheet } from "../importer";
import { formatEur, normRef } from "../pricing";
import { useApp } from "../state";
import type { Campaign, CampaignImportResult, Product } from "../types";

type Line = CampaignImportRow & { product?: Product; include: boolean };
type State = "ok" | "new" | "noprice" | "missing";

const stateOf = (l: Line): State =>
  l.netPrice == null ? "noprice" : l.product ? "ok" : l.designation?.trim() ? "new" : "missing";
const LABEL: Record<State, string> = { ok: "No catálogo", new: "Artigo novo", noprice: "Sem preço", missing: "Falta designação" };

/**
 * Importa uma campanha a partir do ficheiro do fabricante (Excel/CSV com colunas, ou PDF com a oferta):
 * lê referências, preços netos, quantidades e fotos, mostra tudo para rever e cria a campanha com os preços.
 */
export function CampaignImport({ campaigns, onDone, onCancel }: { campaigns: Campaign[]; onDone: (msg: string) => void; onCancel: () => void }) {
  const { catalog, refreshCatalog, refreshSession } = useApp();
  const [mfrId, setMfrId] = useState("");
  const [target, setTarget] = useState(""); // "" = nova campanha
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [head, setHead] = useState({ title: "", subtitle: "", startsOn: "", endsOn: "", membersOnly: true, replace: true });
  const [filter, setFilter] = useState<State | "all">("all");
  const [result, setResult] = useState<CampaignImportResult | null>(null);

  const mfrCampaigns = campaigns.filter((c) => c.manufacturerId === mfrId);

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    setFileName(file.name);
    setBusy("A ler o ficheiro…");
    try {
      let parsed;
      let found: Product[];
      if (/\.pdf$/i.test(file.name)) {
        const pdf = await readPdf(file);
        found = await api.findProducts(referenceCandidates(pdf), mfrId);
        const known = new Set(found.map((p) => normRef(p.reference)));
        parsed = parseCampaignPdf(pdf, (t) => known.has(normRef(t)));
      } else {
        parsed = parseCampaignSheet(await readSpreadsheet(file));
        found = await api.findProducts(parsed.rows.map((r) => r.reference), mfrId);
      }
      if (!parsed.rows.length) throw new Error("Não encontrei artigos neste ficheiro. Confirme a marca escolhida e o ficheiro.");
      const byRef = new Map(found.map((p) => [normRef(p.reference), p]));
      setLines(
        parsed.rows.map((r) => {
          const product = byRef.get(normRef(r.reference));
          return { ...r, product, include: r.netPrice != null && (!!product || !!r.designation) };
        })
      );
      setHead((h) => ({
        ...h,
        title: h.title || titleCase(parsed.title ?? "") || `Campanha ${catalog?.manufacturers.find((m) => m.id === mfrId)?.name ?? ""}`.trim(),
        startsOn: parsed.startsOn || h.startsOn || new Date().toISOString().slice(0, 10),
        endsOn: parsed.endsOn || h.endsOn,
      }));
      setFilter("all");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const counts = useMemo(() => {
    const c: Record<State, number> = { ok: 0, new: 0, noprice: 0, missing: 0 };
    (lines ?? []).forEach((l) => c[stateOf(l)]++);
    return c;
  }, [lines]);
  const chosen = (lines ?? []).filter((l) => l.include && l.netPrice != null && (l.product || l.designation?.trim()));
  const shown = (lines ?? []).map((l, i) => ({ l, i })).filter(({ l }) => filter === "all" || stateOf(l) === filter);
  const edit = (i: number, patch: Partial<Line>) => setLines((ls) => ls!.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  async function confirm() {
    setError(null);
    setBusy("A criar a campanha…");
    try {
      const existing = campaigns.find((c) => c.id === target);
      const id = await api.saveCampaign(
        existing
          ? { ...existing, startsOn: head.startsOn || existing.startsOn, endsOn: head.endsOn || existing.endsOn, membersOnly: head.membersOnly }
          : {
              title: head.title.trim() || "Campanha",
              subtitle: head.subtitle.trim() || null,
              badge: "Preço neto",
              manufacturerId: mfrId,
              productId: null,
              startsOn: head.startsOn || null,
              endsOn: head.endsOn || null,
              active: true,
              sort: 50,
              membersOnly: head.membersOnly,
              details: "Preços netos por unidade, já aplicados no seu carrinho.",
            }
      );
      setBusy(`A gravar ${chosen.length} preços…`);
      const res = await api.importCampaign(
        id,
        chosen.map(({ product: _p, include: _i, ...r }) => ({ ...r, designation: r.designation?.trim() || undefined })),
        existing ? head.replace : true
      );
      setResult(res);
      await Promise.all([refreshCatalog(), refreshSession()]);
      onDone(
        `Campanha "${existing?.title ?? head.title}" gravada: ${res.applied} preços de campanha` +
          (res.created ? `, ${res.created} artigos novos criados` : "") +
          (res.missing.length ? `. Sem artigo no catálogo: ${res.missing.join(", ")}` : "") +
          "."
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="import-campaign">
      <div className="row between">
        <h3>Importar campanha do fabricante</h3>
        <button className="btn ghost" onClick={onCancel}>Fechar</button>
      </div>
      <p className="hint">
        Carregue o ficheiro da campanha tal como o fabricante o enviou: Excel/CSV (deteta as colunas de código, preço neto, PVP,
        quantidade e o link da foto) ou PDF (lê as referências e os preços netos de cada artigo). Antes de gravar, revê tudo aqui.
      </p>
      <div className="form-grid">
        <label>
          Marca *
          <select value={mfrId} onChange={(e) => { setMfrId(e.target.value); setLines(null); setTarget(""); }}>
            <option value="">— Escolher —</option>
            {(catalog?.manufacturers ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label>
          Para
          <select value={target} disabled={!mfrId} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Nova campanha</option>
            {mfrCampaigns.map((c) => <option key={c.id} value={c.id}>Atualizar: {c.title}</option>)}
          </select>
        </label>
        <label className="full">
          Ficheiro (.xlsx, .csv ou .pdf)
          <input type="file" accept=".xlsx,.csv,.pdf" disabled={!mfrId || !!busy} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      </div>
      {busy && <p className="muted">{busy}</p>}
      {error && <p className="error">{error}</p>}

      {lines && !result && (
        <>
          <div className="form-grid">
            {!target && <label className="full">Título *<input maxLength={80} value={head.title} onChange={(e) => setHead({ ...head, title: e.target.value })} /></label>}
            {!target && <label className="full">Texto<input maxLength={140} value={head.subtitle} placeholder="ex. Preços netos em chaves, alicates e jogos" onChange={(e) => setHead({ ...head, subtitle: e.target.value })} /></label>}
            <label>Início<input type="date" value={head.startsOn} onChange={(e) => setHead({ ...head, startsOn: e.target.value })} /></label>
            <label>Fim<input type="date" value={head.endsOn} onChange={(e) => setHead({ ...head, endsOn: e.target.value })} /></label>
            <label className="check" style={{ flexDirection: "row", alignItems: "center" }}>
              <input type="checkbox" style={{ width: "auto" }} checked={head.membersOnly} onChange={(e) => setHead({ ...head, membersOnly: e.target.checked })} />
              Só para revendedores com conta
            </label>
            {target && (
              <label className="check" style={{ flexDirection: "row", alignItems: "center" }}>
                <input type="checkbox" style={{ width: "auto" }} checked={head.replace} onChange={(e) => setHead({ ...head, replace: e.target.checked })} />
                Substituir os preços que a campanha já tem
              </label>
            )}
          </div>

          <div className="import-summary">
            <strong>{fileName}</strong>: {lines.length} artigos lidos.
            {(["all", "ok", "new", "noprice", "missing"] as const).map((s) =>
              s === "all" || counts[s] ? (
                <button key={s} className={`chip ${filter === s ? "on" : ""}`} onClick={() => setFilter(s)}>
                  {s === "all" ? "Todos" : LABEL[s]} ({s === "all" ? lines.length : counts[s]})
                </button>
              ) : null
            )}
          </div>
          {counts.new > Math.max(5, counts.ok) && (
            <p className="error">
              Atenção: {counts.new} artigos não existem no catálogo desta marca e serão criados como artigos novos. Confirme que escolheu a marca certa
              (ou carregue primeiro a tabela de preços do fabricante).
            </p>
          )}
          {counts.noprice > 0 && (
            <p className="hint">"Sem preço": a referência está no ficheiro mas não consegui ler o preço com segurança (escalões, ou o preço está noutro sítio da página). Escreva o preço neto para incluir.</p>
          )}

          <div className="table-wrap">
            <table className="table import-table">
              <thead>
                <tr><th /><th>Foto</th><th>Referência</th><th>Designação</th><th className="num">PVP</th><th className="num">Neto</th><th className="num">Qtd. oferta</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {shown.slice(0, 600).map(({ l, i }) => {
                  const st = stateOf(l);
                  const img = l.product?.imageUrl || l.imageUrl;
                  return (
                    <tr key={i} className={l.include ? "" : "muted"}>
                      <td><input type="checkbox" checked={l.include} onChange={(e) => edit(i, { include: e.target.checked })} aria-label="Incluir" /></td>
                      <td>{img ? <img src={img} alt="" className="thumb" loading="lazy" /> : null}</td>
                      <td><strong>{l.product?.reference ?? l.reference}</strong></td>
                      <td>
                        {l.product ? (
                          l.product.designation
                        ) : (
                          <input value={l.designation ?? ""} placeholder="Designação (para criar o artigo)" onChange={(e) => edit(i, { designation: e.target.value, include: true })} />
                        )}
                      </td>
                      <td className="num">{l.listPrice != null ? formatEur(l.listPrice) : ""}</td>
                      <td className="num">
                        <input
                          className="num-input"
                          inputMode="decimal"
                          value={l.netPrice ?? ""}
                          onChange={(e) => {
                            const v = Number(e.target.value.replace(",", "."));
                            edit(i, { netPrice: e.target.value.trim() && Number.isFinite(v) ? v : undefined, include: true });
                          }}
                        />
                      </td>
                      <td className="num">{l.offerQty ?? ""}</td>
                      <td><span className={`status ${st === "ok" ? "s-delivered" : st === "new" ? "s-sent" : "s-pending"}`}>{LABEL[st]}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {shown.length > 600 && <p className="muted small">A mostrar 600 de {shown.length}. Todos os marcados serão gravados.</p>}

          <div className="row">
            <button className="btn primary" disabled={!!busy || !chosen.length || (!target && !head.title.trim())} onClick={confirm}>
              {target ? "Atualizar campanha" : "Criar campanha"} com {chosen.length} preços
            </button>
            <button className="btn ghost" onClick={onCancel}>Cancelar</button>
          </div>
        </>
      )}
    </div>
  );
}

/** "PROMOCION ESPECIAL 2026-27" -> "Promocion especial 2026-27" */
function titleCase(s: string) {
  const t = s.trim();
  return t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t;
}
