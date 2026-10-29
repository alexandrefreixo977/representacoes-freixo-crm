"""Tira as fotos dos artigos do catálogo PDF da AGHASA TURIS e liga-as aos artigos já carregados.

Uso: python3 data/extract_aghasa_images.py "Catalogo AT_PT.pdf" supabase/migrations/<data>_aghasa_catalogo.sql \
       public/img/aghasa supabase/migrations/<data>_aghasa_imagens.sql
Precisa de: pymupdf, pillow.
Depois de extrair, correr data/normalize_images.py na pasta das fotos (quadrado branco 500x500).

Como liga foto e artigo:
- Cada tabela do catálogo tem a coluna "Cod. Barras" com o prefixo do EAN no cabeçalho ("8435130...") e os
  6 últimos dígitos em cada linha. Prefixo + dígitos = EAN, que já está na tarifa carregada.
- Por baixo de muitas fotos está o código do artigo ("1910 01-B"); o artigo com esse código fica com essa foto.
- Os outros artigos da mesma secção (entre dois títulos) ficam com a foto etiquetada de código mais parecido,
  ou, sem etiquetas, com a maior foto da secção que não esteja na coluna das tabelas (evita fotos de ambiente).
"""
import hashlib
import io
import math
import re
import sys

import fitz
from PIL import Image


def rect_distance(p: fitz.Point, r: fitz.Rect) -> float:
    dx = max(r.x0 - p.x, 0, p.x - r.x1)
    dy = max(r.y0 - p.y, 0, p.y - r.y1)
    return math.hypot(dx, dy)


def norm(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", s.upper())


def common_prefix(a: str, b: str) -> int:
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n


def ean_ok(code: str) -> bool:
    if len(code) != 13 or not code.isdigit():
        return False
    s = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(code[:12]))
    return (10 - s % 10) % 10 == int(code[12])


def render(doc, xref: int) -> Image.Image:
    pix = fitz.Pixmap(doc, xref)
    smask = doc.extract_image(xref).get("smask", 0)
    if smask:
        pix = fitz.Pixmap(pix, fitz.Pixmap(doc, smask))
    if pix.n - pix.alpha >= 4:
        pix = fitz.Pixmap(fitz.csRGB, pix)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, "white")
        bg.paste(img, mask=img.split()[-1])
        img = bg
    return img.convert("RGB")


def page_items(page, refs: set):
    """Devolve [(chave, código, fitz.Point)] das linhas de tabela e as fotos [(rect, xref, etiqueta|None)]."""
    lines = []
    for blk in page.get_text("dict")["blocks"]:
        for ln in blk.get("lines", []):
            text = "".join(s["text"] for s in ln["spans"]).strip()
            if text:
                size = max(s["size"] for s in ln["spans"])
                font = ln["spans"][0]["font"]
                lines.append((fitz.Rect(ln["bbox"]), text, size, font))
    width = page.rect.width
    titles = sorted(r.y0 for r, t, size, font in lines if 11 <= size <= 16 and r.x0 < width * 0.85 and r.y0 > 60)
    prefixes = [(r, t[:7]) for r, t, *_ in lines if re.fullmatch(r"\d{7}\.{1,3}", t)]

    rows = []
    for r, t, *_ in lines:
        if not re.fullmatch(r"\d{6}", t):
            continue
        heads = [(pr, p) for pr, p in prefixes if pr.y1 <= r.y0 + 2 and abs(pr.x0 - r.x0) < 25]
        if not heads:
            continue
        head = max(heads, key=lambda it: it[0].y1)[1]
        ean = head + t
        if not ean_ok(ean):
            continue
        same_row = [(rr, tt) for rr, tt, *_ in lines if abs((rr.y0 + rr.y1) / 2 - (r.y0 + r.y1) / 2) < 3 and rr.x1 < r.x0]
        code = norm(min(same_row, key=lambda it: it[0].x0)[1]) if same_row else ""
        rows.append((ean, code, fitz.Point(r.x0, (r.y0 + r.y1) / 2)))
    # Tabelas sem coluna de código de barras: a linha começa pelo código do artigo, em negrito.
    seen = {round(p.y) for *_, p in rows}
    for r, t, size, font in lines:
        c = norm(t)
        y = (r.y0 + r.y1) / 2
        if "Bold" in font and len(c) >= 4 and c in refs and not any(abs(y - sy) < 3 for sy in seen):
            rows.append(("ref:" + c, c, fitz.Point(r.x1 + 60, y)))

    row_codes = {c for _, c, _ in rows if c}
    row_ys = {round(p.y) for *_, p in rows}
    images = []
    for im in page.get_image_info(xrefs=True):
        r = fitz.Rect(im["bbox"])
        if not im["xref"] or r.x0 < -2 or r.x1 > width * 0.92 or r.y0 < 58:
            continue
        if r.width * r.height < 2500 or (max(r.width, r.height) < 45):
            continue
        images.append([r, im["xref"], None])
    for r, t, size, font in lines:
        c = norm(t)
        if c in row_codes and not any(abs(y - (r.y0 + r.y1) / 2) < 3 for y in row_ys) and images:
            centre = fitz.Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)
            best = min(images, key=lambda it: rect_distance(centre, it[0]))
            if rect_distance(centre, best[0]) < 40 and best[2] is None:
                best[2] = c

    def section(y: float) -> int:
        return sum(1 for ty in titles if ty <= y + 2)

    table_x0 = min((p.x for *_, p in rows), default=width) - 120
    result = []
    for ean, code, p in rows:
        sec = section(p.y)
        cands = [im for im in images if section((im[0].y0 + im[0].y1) / 2) == sec]
        exact = [im for im in cands if im[2] == code] or [im for im in images if im[2] == code]
        if exact:
            result.append((ean, exact[0][1]))
            continue
        labelled = [im for im in cands if im[2]]
        if labelled:
            best = max(labelled, key=lambda im: common_prefix(im[2], code))
            if common_prefix(best[2], code) >= 2:
                result.append((ean, best[1]))
                continue
        loose = [im for im in cands if (im[0].x0 + im[0].x1) / 2 < table_x0] or [
            im for im in cands if im[0].width / max(im[0].height, 1) < 2.2
        ]
        if loose:
            result.append((ean, max(loose, key=lambda im: im[0].width * im[0].height)[1]))
    return result


def main(pdf: str, catalog_sql: str, out_dir: str, migration: str) -> None:
    doc = fitz.open(pdf)
    ean_ref = {}
    for ref, ean in re.findall(r"^\('((?:[^']|'')*)','(\d{13})'", open(catalog_sql, encoding="utf-8").read(), re.M):
        ean_ref.setdefault(ean, []).append(ref)

    norm_ref = {}
    for refs in ean_ref.values():
        for ref in refs:
            norm_ref.setdefault(norm(ref), []).append(ref)
    for ref in re.findall(r"^\('((?:[^']|'')*)','',", open(catalog_sql, encoding="utf-8").read(), re.M):
        norm_ref.setdefault(norm(ref), []).append(ref)

    found = {}  # referência -> (página, xref)
    for pn in range(len(doc)):
        for key, xref in page_items(doc[pn], set(norm_ref)):
            for ref in norm_ref.get(key[4:], []) if key.startswith("ref:") else ean_ref.get(key, []):
                found.setdefault(ref, (pn, xref))

    saved, ref_file = {}, {}
    for ref, (pn, xref) in sorted(found.items()):
        if xref not in saved:
            fname = f"at-{hashlib.md5(str(xref).encode()).hexdigest()[:10]}.jpg"
            try:
                img = render(doc, xref)
            except Exception:
                continue
            img.thumbnail((500, 500))
            img.save(f"{out_dir}/{fname}", quality=80, optimize=True)
            saved[xref] = fname
        ref_file[ref] = saved[xref]

    folder = out_dir.rstrip("/").split("public/", 1)[-1]
    values = ",\n".join(f"('{r}', '/{folder}/{f}')" for r, f in sorted(ref_file.items()))
    total = sum(len(v) for v in norm_ref.values())
    with open(migration, "w", encoding="utf-8") as fh:
        fh.write(f"""-- Fotos AGHASA TURIS tiradas do catálogo PDF (data/extract_aghasa_images.py). {len(ref_file)} artigos, {len(saved)} fotos.
update public.b2b_products p set image_url = v.url, updated_at = now()
from (values
{values}
) as v(reference, url), public.b2b_manufacturers m
where m.slug = 'aghasa-turis' and p.manufacturer_id = m.id and p.reference = v.reference;
""")
    print(f"{len(ref_file)} de {total} artigos ficaram com foto ({len(saved)} fotos)")


if __name__ == "__main__":
    main(*sys.argv[1:5])
