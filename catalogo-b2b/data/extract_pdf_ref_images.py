"""Fotos tiradas de um catálogo PDF oficial de uma marca, ligadas pela referência escrita no catálogo.

Uso: python3 data/extract_pdf_ref_images.py catalogo.pdf refs.txt public/img/<pasta> <prefixo> <slug-fabricante> \
       supabase/migrations/<data>_<nome>.sql "comentário"
refs.txt: uma referência por linha (só as que ainda não têm foto).
Precisa de: pymupdf, pillow.

Cada referência escrita numa página fica com a foto de produto mais próxima dessa referência (até ~6 cm);
ignora desenhos técnicos, traços e imagens pequenas (ícones).
"""
import hashlib
import pathlib
import re
import sys

import fitz

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from extract_bluemaster_images import rect_distance, render  # noqa: E402
from normalize_images import normalize  # noqa: E402


def norm(s):
    return re.sub(r"[^0-9A-Z]", "", s.upper())


def is_photo(img):
    w, h = img.size
    if max(w, h) / max(1, min(w, h)) > 8:
        return False
    px = list(img.convert("RGB").resize((48, 48)).getdata())
    dark = sum(1 for r, g, b in px if r + g + b < 120) / len(px)
    grey = sum(1 for r, g, b in px if max(r, g, b) - min(r, g, b) < 12) / len(px)
    return not (dark > 0.3 and grey > 0.95)


def main(pdf, refs_file, out_dir, prefix, slug, migration, comment):
    doc = fitz.open(pdf)
    refs = {}
    for r in open(refs_file, encoding="utf-8").read().split("\n"):
        if r.strip():
            refs.setdefault(norm(r), []).append(r.strip())
    best, photo = {}, {}
    for pn, page in enumerate(doc):
        hits = [(fitz.Rect(w[:4]), norm(w[4])) for w in page.get_text("words") if norm(w[4]) in refs]
        if not hits:
            continue
        images = []
        for im in page.get_image_info(xrefs=True):
            r = fitz.Rect(im["bbox"]) & page.rect
            if im["xref"] and not r.is_empty and r.width * r.height >= 1500 and min(r.width, r.height) >= 12:
                images.append((r, im["xref"]))
        for r, c in hits:
            ctr = fitz.Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)
            for d, xref in sorted((rect_distance(ctr, ir), x) for ir, x in images):
                if d > 170:
                    break
                if xref not in photo:
                    try:
                        photo[xref] = is_photo(render(doc, xref))
                    except Exception:  # noqa: BLE001
                        photo[xref] = False
                if photo[xref]:
                    if c not in best or d < best[c][0]:
                        best[c] = (d, pn, xref)
                    break
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    saved, pairs = {}, []
    for c, (_, pn, xref) in sorted(best.items()):
        if xref not in saved:
            name = f"{prefix}-{hashlib.md5(f'{pdf}-{xref}'.encode()).hexdigest()[:10]}.jpg"
            render(doc, xref).save(out / name, quality=90)
            normalize(out / name)
            saved[xref] = name
        pairs += [(r, saved[xref]) for r in refs[c]]
    q = lambda s: "'" + s.replace("'", "''") + "'"  # noqa: E731
    with open(migration, "w", encoding="utf-8") as f:
        f.write(f"-- {comment} {len(pairs)} artigos. Gerado por data/extract_pdf_ref_images.py.\n")
        f.write("update public.b2b_products p set image_url = v.url, updated_at = now()\nfrom (values\n")
        f.write(",\n".join(f"({q(a)}, '/img/{out.name}/{b}')" for a, b in pairs))
        f.write(f"\n) as v(ref, url), public.b2b_manufacturers m\nwhere m.slug = {q(slug)} and p.manufacturer_id = m.id "
                "and p.reference = v.ref\n  and coalesce(p.image_url, '') !~* '\\.(jpe?g|png|webp)(\\?|$)';\n")
    with open(pathlib.Path(migration).with_suffix(".mapa.tsv"), "w", encoding="utf-8") as f:
        for c, (d, pn, xref) in sorted(best.items()):
            f.write(f"{refs[c][0]}\t{pn}\t{xref}\t{saved[xref]}\n")
    print(f"{len(pairs)} de {sum(len(v) for v in refs.values())} artigos com foto, {len(saved)} fotos")


if __name__ == "__main__":
    main(*sys.argv[1:8])
