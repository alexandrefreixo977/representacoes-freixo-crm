import { useEffect, useState } from "react";
import { api } from "../data";
import { formatEur } from "../pricing";
import { go, useApp } from "../state";
import type { Product, ProductEdit } from "../types";

const PAGE = 50;
const SIZE_TYPES = [
  ["", "Sem tamanhos"],
  ["calcado", "Calçado (tamanho)"],
  ["vestuario", "Vestuário (tamanho)"],
  ["medida", "Fita à medida (mm)"],
] as const;

/**
 * Gestão › Artigos: procurar qualquer artigo (de qualquer marca, também os inativos) e corrigir tudo:
 * designação, descrição, foto, ficha técnica, preço de tabela, embalagem, mínimo, família, tamanhos, novidade e visibilidade.
 */
export function ProductsAdmin() {
  const { catalog, route } = useApp();
  const editId = route.params.get("id");
  const isNew = route.params.get("novo") === "1";
  const [mfrId, setMfrId] = useState(route.params.get("m") ?? "");
  const [q, setQ] = useState("");
  const [inactive, setInactive] = useState(false);
  const [noImage, setNoImage] = useState(false);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{ products: Product[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editId || isNew) return;
    let alive = true;
    const t = window.setTimeout(() => {
      api
        .searchProducts({ manufacturerId: mfrId || undefined, q, includeInactive: inactive, noImage, offset: page * PAGE, limit: PAGE })
        .then((r) => alive && (setResult(r), setError(null)))
        .catch((e) => alive && setError((e as Error).message));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [mfrId, q, inactive, noImage, page, editId, isNew]);

  if (editId || isNew) {
    return <ProductEditor id={editId} defaultMfr={mfrId} onClose={() => go("gestao", { t: "artigos", m: mfrId || undefined })} />;
  }

  const mfrName = (id: string) => catalog?.manufacturers.find((m) => m.id === id)?.name ?? "";
  const pages = result ? Math.ceil(result.total / PAGE) : 0;
  return (
    <section className="panel">
      <div className="row between" style={{ marginTop: 0 }}>
        <h2>Artigos</h2>
        <button className="btn primary" onClick={() => go("gestao", { t: "artigos", novo: "1", m: mfrId || undefined })}>+ Novo artigo</button>
      </div>
      <p className="hint">Procure por referência, designação ou EAN e carregue no artigo para o corrigir. As alterações aparecem logo na loja.</p>
      <div className="form-grid">
        <label>
          Marca
          <select value={mfrId} onChange={(e) => { setMfrId(e.target.value); setPage(0); }}>
            <option value="">Todas</option>
            {(catalog?.manufacturers ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label>
          Procurar
          <input value={q} placeholder="ex. 617961, alicate, 3838909…" onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        </label>
        <label className="check" style={{ flexDirection: "row", alignItems: "center" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={noImage} onChange={(e) => { setNoImage(e.target.checked); setPage(0); }} />
          Só artigos sem foto
        </label>
        <label className="check" style={{ flexDirection: "row", alignItems: "center" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={inactive} onChange={(e) => { setInactive(e.target.checked); setPage(0); }} />
          Mostrar também os inativos
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {result && (
        <>
          <p className="muted small">{result.total} artigos{pages > 1 ? ` · página ${page + 1} de ${pages}` : ""}</p>
          <div className="table-wrap">
            <table className="table import-table products-admin">
              <thead>
                <tr><th>Foto</th><th>Referência</th><th>Designação</th><th>Marca</th><th /></tr>
              </thead>
              <tbody>
                {result.products.map((p) => (
                  <tr key={p.id} className={p.active === false ? "muted" : ""} onClick={() => go("gestao", { t: "artigos", id: p.id, m: mfrId || undefined })}>
                    <td>{p.imageUrl ? <img src={p.imageUrl} alt="" className="thumb" loading="lazy" /> : <span className="thumb no-photo">sem foto</span>}</td>
                    <td><strong>{p.reference}</strong></td>
                    <td>{p.designation}{p.active === false && <span className="status s-cancelled" style={{ marginLeft: 8 }}>Inativo</span>}</td>
                    <td>{mfrName(p.manufacturerId)}</td>
                    <td><button className="btn ghost small">Editar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="row">
              <button className="btn ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Anterior</button>
              <button className="btn ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Seguinte ›</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

const blank = (manufacturerId: string): ProductEdit => ({
  manufacturerId,
  familyId: null,
  reference: "",
  ean: "",
  designation: "",
  description: "",
  imageUrl: "",
  techSheetUrl: "",
  salesUnit: "un",
  packQty: 1,
  moq: 1,
  isNew: false,
  sizeType: null,
  active: true,
  listPrice: null,
  weldPrice: null,
});

function ProductEditor({ id, defaultMfr, onClose }: { id: string | null; defaultMfr: string; onClose: () => void }) {
  const { catalog, refreshCatalog, refreshPrices, updateProduct } = useApp();
  const [form, setForm] = useState<ProductEdit | null>(id ? null : blank(defaultMfr));
  const [priceText, setPriceText] = useState("");
  const [weldText, setWeldText] = useState("");
  const [newFamily, setNewFamily] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [imgBroken, setImgBroken] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .getProductForEdit(id)
      .then((p) => {
        setForm(p);
        setPriceText(p.listPrice != null ? String(p.listPrice).replace(".", ",") : "");
        setWeldText(p.weldPrice != null ? String(p.weldPrice).replace(".", ",") : "");
      })
      .catch((e) => setError((e as Error).message));
  }, [id]);

  if (!form) return <section className="panel">{error ? <p className="error">{error}</p> : <p className="muted">A abrir o artigo…</p>}</section>;

  const set = (patch: Partial<ProductEdit>) => {
    setSaved(null);
    setForm({ ...form, ...patch });
  };
  const families = (catalog?.families ?? []).filter((f) => f.manufacturerId === form.manufacturerId).sort((a, b) => a.name.localeCompare(b.name));
  const parseNum = (t: string) => {
    const v = Number(t.trim().replace(/\s/g, "").replace(",", "."));
    return t.trim() && Number.isFinite(v) && v >= 0 ? v : null;
  };

  async function onPhoto(file: File) {
    setError(null);
    setBusy("A carregar a foto…");
    try {
      const small = await shrinkImage(file, 1200);
      const url = await api.uploadImage(small, form!.reference || file.name.replace(/\.[^.]+$/, ""));
      setImgBroken(false);
      set({ imageUrl: url });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!form) return;
    setError(null);
    const listPrice = parseNum(priceText);
    if (priceText.trim() && listPrice == null) return setError("Preço de tabela inválido.");
    if (!form.manufacturerId) return setError("Escolha a marca.");
    if (!form.reference.trim() || !form.designation.trim()) return setError("A referência e a designação são obrigatórias.");
    if (!(form.packQty > 0) || !(form.moq > 0)) return setError("A embalagem e a encomenda mínima têm de ser maiores que zero.");
    setBusy("A gravar…");
    try {
      const product = await api.saveProduct({
        ...form,
        listPrice,
        weldPrice: form.sizeType === "medida" ? parseNum(weldText) : null,
        newFamily: newFamily?.trim() || undefined,
      });
      updateProduct(product);
      refreshPrices([product.id]);
      if (newFamily?.trim()) await refreshCatalog();
      setNewFamily(null);
      setForm({ ...form, id: product.id, familyId: product.familyId });
      setSaved(`Artigo ${product.reference} gravado.`);
      if (!id) go("gestao", { t: "artigos", id: product.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const img = form.imageUrl?.trim();
  return (
    <section className="panel product-editor">
      <div className="row between" style={{ marginTop: 0 }}>
        <h2>{id ? `Editar ${form.reference}` : "Novo artigo"}</h2>
        <button className="btn ghost" onClick={onClose}>‹ Voltar à lista</button>
      </div>
      <div className="editor-layout">
        <div className="editor-photo">
          {img && !imgBroken ? (
            <img src={img} alt="" onError={() => setImgBroken(true)} />
          ) : (
            <div className="thumb no-photo big">{img ? "O link da foto não abre" : "Sem foto"}</div>
          )}
          <label className="btn ghost file-btn">
            Carregar foto do computador
            <input type="file" accept="image/*" hidden disabled={!!busy} onChange={(e) => e.target.files?.[0] && onPhoto(e.target.files[0])} />
          </label>
          <label>
            Ou link da foto
            <input value={form.imageUrl ?? ""} placeholder="https://…" onChange={(e) => { setImgBroken(false); set({ imageUrl: e.target.value }); }} />
          </label>
        </div>

        <div className="form-grid">
          <label>
            Marca *
            <select value={form.manufacturerId} disabled={!!id} onChange={(e) => set({ manufacturerId: e.target.value, familyId: null })}>
              <option value="">— Escolher —</option>
              {(catalog?.manufacturers ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label>
            Família
            {newFamily == null ? (
              <select
                value={form.familyId ?? ""}
                onChange={(e) => (e.target.value === "__nova" ? setNewFamily("") : set({ familyId: e.target.value || null }))}
              >
                <option value="">— Sem família —</option>
                {families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                <option value="__nova">+ Nova família…</option>
              </select>
            ) : (
              <span className="row" style={{ marginTop: 0 }}>
                <input autoFocus value={newFamily} placeholder="Nome da nova família" onChange={(e) => setNewFamily(e.target.value)} />
                <button className="btn ghost small" onClick={() => setNewFamily(null)}>Cancelar</button>
              </span>
            )}
          </label>
          <label>Referência *<input value={form.reference} onChange={(e) => set({ reference: e.target.value })} /></label>
          <label>EAN<input value={form.ean ?? ""} inputMode="numeric" onChange={(e) => set({ ean: e.target.value })} /></label>
          <label className="full">Designação *<input maxLength={200} value={form.designation} onChange={(e) => set({ designation: e.target.value })} /></label>
          <label className="full">
            Descrição
            <textarea rows={4} value={form.description ?? ""} onChange={(e) => set({ description: e.target.value })} />
          </label>
          <label className="full">Link da ficha técnica<input value={form.techSheetUrl ?? ""} placeholder="https://…" onChange={(e) => set({ techSheetUrl: e.target.value })} /></label>
          <label>
            Preço de tabela (€, sem IVA)
            <input inputMode="decimal" value={priceText} placeholder="vazio = sob consulta" onChange={(e) => { setSaved(null); setPriceText(e.target.value); }} />
            {parseNum(priceText) != null && <small className="muted">{formatEur(parseNum(priceText)!)}{form.sizeType === "medida" ? " por metro" : ""}</small>}
          </label>
          {form.sizeType === "medida" && (
            <label>Soldadura por fita (€)<input inputMode="decimal" value={weldText} onChange={(e) => { setSaved(null); setWeldText(e.target.value); }} /></label>
          )}
          <label>Unidade de venda<input value={form.salesUnit} placeholder="un, par, cx, m…" onChange={(e) => set({ salesUnit: e.target.value })} /></label>
          <label>Unidades por embalagem<input type="number" min={0.001} step="any" value={form.packQty} onChange={(e) => set({ packQty: Number(e.target.value) })} /></label>
          <label>Encomenda mínima<input type="number" min={0.001} step="any" value={form.moq} onChange={(e) => set({ moq: Number(e.target.value) })} /></label>
          <label>
            Tamanhos
            <select value={form.sizeType ?? ""} onChange={(e) => set({ sizeType: (e.target.value || null) as ProductEdit["sizeType"] })}>
              {SIZE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="check" style={{ flexDirection: "row", alignItems: "center" }}>
            <input type="checkbox" style={{ width: "auto" }} checked={form.isNew} onChange={(e) => set({ isNew: e.target.checked })} />
            Marcar como novidade
          </label>
          <label className="check" style={{ flexDirection: "row", alignItems: "center" }}>
            <input type="checkbox" style={{ width: "auto" }} checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
            Visível na loja (desligue para esconder o artigo)
          </label>
        </div>
      </div>
      {busy && <p className="muted">{busy}</p>}
      {error && <p className="error">{error}</p>}
      {saved && <p className="notice"><span>{saved}</span></p>}
      <div className="row">
        <button className="btn primary" disabled={!!busy} onClick={save}>{id ? "Gravar alterações" : "Criar artigo"}</button>
        <button className="btn ghost" onClick={onClose}>Voltar</button>
      </div>
    </section>
  );
}

/** Reduz a foto (lado maior até maxSide px) e grava em JPEG, para a loja abrir depressa. */
async function shrinkImage(file: File, maxSide: number): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Escolha um ficheiro de imagem (JPG, PNG ou WEBP).");
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("Não consegui abrir esta imagem.");
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 400_000 && /jpeg|png|webp/.test(file.type)) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // PNG transparente fica com fundo branco
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error("Não consegui preparar a foto."))), "image/jpeg", 0.86));
}
