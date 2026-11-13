"""Segunda passagem às fotos Blue Master: artigos que a primeira (extract_bluemaster_images.py) deixou sem foto.

Uso: python3 data/extract_bluemaster_images_extra.py "Catalogo BM_2026.pdf" supabase/migrations/<data>_bluemaster_catalogo.sql \
       supabase/migrations/<data>_bluemaster_imagens.sql public/img/bluemaster supabase/migrations/<data>_bluemaster_imagens_2.sql
Precisa de: pymupdf, pillow.

Muitas tabelas do catálogo não têm a caixa "Ref." por cima: têm o código da série como título de coluna ou de linha
("FF92", "BC82", "560"…) e as referências completas não aparecem escritas (só as medidas). Aqui:
- cada texto da página que seja uma referência sem foto, ou o início (série) de referências sem foto, fica ligado à
  foto de produto mais próxima na página;
- um artigo fica com a foto da sua referência, se ela estiver escrita, senão com a da série mais comprida que for
  o início da referência (ex. 5350750 = série 535 + comprimento 0750);
- séries só com algarismos só contam junto a uma tabela "Ref." (evita confundir com medidas);
- a foto só é aceite se a página estiver na zona do catálogo da família do artigo (a 2 páginas, no máximo, de uma
  página onde aparece escrita uma referência dessa família); se não, o artigo fica sem foto;
- serras de fita (só têm medidas no catálogo): a foto oficial da linha, conforme o tipo (bimetal = caixa M42,
  aço carbono = rolo, alimentação/inox, RemGrit, metal duro).
"""
import hashlib
import pathlib
import re
import sys

import fitz

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from extract_bluemaster_images import norm, rect_distance, render  # noqa: E402
from normalize_images import normalize  # noqa: E402


def main(pdf, catalog_sql, done_sql, out_dir, migration):
    doc = fitz.open(pdf)
    by_norm, fam, desc = {}, {}, {}
    for ref, des, f in re.findall(r"^\('((?:[^']|'')*)','\d*','((?:[^']|'')*)','(?:[^']|'')*','((?:[^']|'')*)'",
                                  open(catalog_sql, encoding="utf-8").read(), re.M):
        ref = ref.replace("''", "'")
        by_norm.setdefault(norm(ref), []).append(ref)
        fam[norm(ref)], desc[norm(ref)] = f, des.upper()
    done = set(re.findall(r"^\('((?:[^']|'')*)', '/img/", open(done_sql, encoding="utf-8").read(), re.M))
    missing = {n for n, refs in by_norm.items() if not any(r in done for r in refs)}
    prefixes = {n[:k] for n in missing for k in range(3, len(n) + 1)}

    best = {}  # código -> [(distância, página, xref)], mais perto primeiro
    fam_pages, set_pages, img_kinds = {}, set(), {}

    def kind(d):
        w = re.findall(r"[A-Z]+", d)
        return w[0][:4] if w else ""
    for pn in range(len(doc)):
        for w in doc[pn].get_text("words"):
            c = norm(w[4])
            if c in fam and len(c) >= 5:
                fam_pages.setdefault(fam[c], set()).add(pn)
    def near_family(n, pn):
        return any(abs(pn - q) <= 2 for q in fam_pages.get(fam[n], ()))

    for pn in range(len(doc)):
        page = doc[pn]
        lines = []
        for blk in page.get_text("dict")["blocks"]:
            for ln in blk.get("lines", []):
                for sp in ln["spans"]:
                    for tok in re.split(r"\s+", sp["text"].strip()):
                        c = norm(tok)
                        if c in prefixes:
                            lines.append((fitz.Rect(sp["bbox"]), c))
        if not lines:
            continue
        refs_marks = [fitz.Rect(b[:4]) for b in page.get_text("words") if b[4].startswith("Ref")]
        images = []
        for im in page.get_image_info(xrefs=True):
            r = fitz.Rect(im["bbox"]) & page.rect
            if not im["xref"] or r.is_empty or r.y1 < 50:
                continue
            if r.width * r.height < 1500 or min(r.width, r.height) < 12 or max(r.width, r.height) < 60:
                continue
            images.append((r, im["xref"]))
        if not images:
            continue
        if re.search(r"\b(ESTOJOS?|ESTUCHES?|JOGOS|EXPOSITOR(ES)?|SORTIDOS?)\b", page.get_text()):
            set_pages.add(pn)
        for w in page.get_text("words"):
            c = norm(w[4])
            if c in desc and len(c) >= 5:
                ctr = fitz.Point((w[0] + w[2]) / 2, (w[1] + w[3]) / 2)
                d, xref = min((rect_distance(ctr, ir), x) for ir, x in images)
                if d < 250:
                    img_kinds.setdefault(xref, set()).add(kind(desc[c]))
        for r, c in lines:
            if c.isdigit() and c not in missing:
                if not any(rect_distance(fitz.Point(r.x0, r.y0), m) < 120 for m in refs_marks):
                    continue
            centre = fitz.Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)
            for d, xref in sorted((rect_distance(centre, ir), x) for ir, x in images):
                if d <= 450:
                    best.setdefault(c, []).append((d, pn, xref))

    for c in best:
        best[c].sort()
    # Fotos de estojos/jogos/expositores: não servem para um artigo avulso.
    SET = re.compile(r"\b(JOGO|JUEGO|ESTOJO|ESTUCHE|EXPOSITOR|SORTIDO|SURTIDO|SET|CAIXA|MALETA|KIT)\b")
    set_xrefs = {best[c][0][2] for c in best if c in desc and SET.search(desc[c])}

    drawing = {}

    def is_drawing(xref):
        """Desenhos técnicos (traço branco sobre preto ou preto sobre branco, sem cor) não são fotos."""
        if xref not in drawing:
            try:
                im = render(doc, xref).convert("RGB").resize((64, 64))
                px = list(im.getdata())
                dark = sum(1 for r, g, b in px if r + g + b < 120) / len(px)
                grey = sum(1 for r, g, b in px if max(r, g, b) - min(r, g, b) < 12) / len(px)
                mid = sum(1 for r, g, b in px if 120 <= r + g + b <= 600) / len(px)
                full = render(doc, xref)
                flat = max(full.size) / max(1, min(full.size)) > 8  # traços e barras, não fotos
                drawing[xref] = (dark > 0.3 and grey > 0.95 and mid < 0.25) or flat
            except Exception:  # noqa: BLE001
                drawing[xref] = True
        return drawing[xref]

    def pick(n, c):
        for d, pn, xref in best[c]:
            if not near_family(n, pn):
                continue
            if (xref in set_xrefs or pn in set_pages) and not SET.search(desc[n]):
                continue
            if xref in img_kinds and kind(desc[n]) not in img_kinds[xref]:
                continue
            if is_drawing(xref):
                continue
            return (d, pn, xref)
        return None

    saw = {"bimetal": (366, 15663), "carbono": (374, 15726), "alimentar": (375, 15766),
           "remgrit": (376, 15789), "metal duro": (377, 15798)}

    def saw_kind(d):
        if "REMGRIT" in d or "REMDRIT" in d:
            return "remgrit"
        if "METAL DURO" in d or "CARBURO" in d:
            return "metal duro"
        if "CARBONO" in d:
            return "carbono"
        if "ALIMENT" in d or "RECTIFICADO" in d or "INOX" in d:
            return "alimentar"
        return "bimetal"

    assign = {}
    for n in missing:
        if fam[n] == "Serras de fita":
            assign[n] = (0,) + saw[saw_kind(desc[n])]
            continue
        got = pick(n, n) if n in best else None
        if not got:
            for k in range(len(n) - 1, 2, -1):
                if n[:k] in best:
                    got = pick(n, n[:k])
                    break
        if got:
            assign[n] = got

    out = pathlib.Path(out_dir)
    saved, pairs = {}, []
    for n, (_, pn, xref) in sorted(assign.items()):
        if xref not in saved:
            name = f"bm2-{hashlib.md5(f'{pn}-{xref}'.encode()).hexdigest()[:10]}.jpg"
            try:
                img = render(doc, xref)
                img.save(out / name, quality=90)
                normalize(out / name)
                saved[xref] = name
            except Exception:  # noqa: BLE001
                saved[xref] = None
        if saved[xref]:
            pairs += [(r, saved[xref]) for r in by_norm[n]]
    folder = out.name
    q = lambda s: "'" + s.replace("'", "''") + "'"  # noqa: E731
    with open(migration, "w", encoding="utf-8") as fh:
        fh.write(f"-- Fotos Blue Master, 2.ª passagem ao catálogo PDF (data/extract_bluemaster_images_extra.py). "
                 f"{len(pairs)} artigos, {len({f for _, f in pairs})} fotos.\n")
        fh.write("update public.b2b_products p set image_url = v.url, updated_at = now()\nfrom (values\n")
        fh.write(",\n".join(f"({q(r)}, '/img/{folder}/{f}')" for r, f in pairs))
        fh.write("\n) as v(reference, url), public.b2b_manufacturers m\n"
                 "where m.slug = 'blue-master' and p.manufacturer_id = m.id and p.reference = v.reference\n"
                 "  and coalesce(p.image_url, '') = '';\n")
    left = sum(len(by_norm[n]) for n in missing) - len(pairs)
    print(f"{len(pairs)} artigos com foto, {len({f for _, f in pairs})} fotos; ficam {left} sem foto")
    with open(pathlib.Path(migration).with_suffix(".mapa.tsv"), "w", encoding="utf-8") as fh:
        for n, (d, pn, xref) in sorted(assign.items()):
            fh.write(f"{by_norm[n][0]}\t{pn}\t{xref}\t{saved.get(xref)}\n")


if __name__ == "__main__":
    main(*sys.argv[1:6])
