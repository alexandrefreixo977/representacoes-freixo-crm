"""Tira as fotos dos artigos do catálogo PDF da Blue Master e liga-as aos artigos já carregados.

Uso: python3 data/extract_bluemaster_images.py "Catalogo BM_2026.pdf" supabase/migrations/<data>_bluemaster_catalogo.sql \
       public/img/bluemaster supabase/migrations/<data>_bluemaster_imagens.sql
Precisa de: pymupdf, pillow.
Depois de extrair, correr data/normalize_images.py na pasta das fotos (quadrado branco 500x500).

Como liga foto e artigo:
- Cada secção do catálogo tem uma caixa "Ref. BMH" (código da série) com a foto do produto por baixo ou ao lado,
  e depois a tabela com as referências.
- Um artigo cuja referência aparece numa tabela fica com a foto etiquetada com o seu código, se houver,
  senão com a foto da secção (a caixa "Ref." mais próxima acima, na mesma coluna).
- Os artigos que não aparecem escritos no catálogo (tabelas só com medidas) ficam com a foto da série
  cujo código é o prefixo mais comprido da referência (ex. BMH03X100 -> série BMH).
"""
import hashlib
import io
import math
import re
import sys

import fitz
from PIL import Image


def norm(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", s.upper())


def rect_distance(p: fitz.Point, r: fitz.Rect) -> float:
    dx = max(r.x0 - p.x, 0, p.x - r.x1)
    dy = max(r.y0 - p.y, 0, p.y - r.y1)
    return math.hypot(dx, dy)


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


def series_ok(code: str) -> bool:
    return len(code) >= (2 if code[:1].isalpha() else 3)


def page_items(page, refs: set):
    """Devolve ([(código da linha, xref)], [(código de série, xref)])."""
    width = page.rect.width
    lines = []
    for blk in page.get_text("dict")["blocks"]:
        for ln in blk.get("lines", []):
            text = "".join(s["text"] for s in ln["spans"]).strip()
            if text:
                lines.append((fitz.Rect(ln["bbox"]), text))

    headers = []  # (rect, [séries])
    for r, t in lines:
        m = re.match(r"^Ref\.?\s*(.+)$", t)
        if m:
            codes = [norm(c) for c in re.split(r"[/,;]|\s-\s|\s+", m.group(1)) if norm(c)]
            headers.append((r, [c for c in codes if series_ok(c)]))
    rows = [(r, norm(t)) for r, t in lines if norm(t) in refs and len(norm(t)) >= 4]

    images = []
    for im in page.get_image_info(xrefs=True):
        r = fitz.Rect(im["bbox"]) & page.rect
        if not im["xref"] or r.is_empty or r.y1 < 50:
            continue
        if r.width * r.height < 2500 or min(r.width, r.height) < 25 or max(r.width, r.height) < 45:
            continue
        images.append([r, im["xref"], None])

    # Etiquetas: o código do artigo escrito junto a uma foto (fora da tabela).
    row_codes = {c for _, c in rows}
    for r, c in rows:
        centre = fitz.Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)
        near = [im for im in images if rect_distance(centre, im[0]) < 25]
        if near and c in row_codes:
            best = min(near, key=lambda im: rect_distance(centre, im[0]))
            if best[2] is None:
                best[2] = c

    def column(x: float, y: float):
        """Limites x da coluna onde está x: corta a meio entre caixas "Ref." lado a lado."""
        lo, hi = 0.0, width
        for hr, _ in headers:
            if abs(hr.y0 - y) < 400 and abs(hr.x0 - x) > 120:
                if hr.x0 > x:
                    hi = min(hi, hr.x0 - 10)
                else:
                    lo = max(lo, hr.x0 - 40)
        return lo, hi

    def first_row_below(hr):
        lo, hi = column(hr.x0, hr.y0)
        ys = [r.y0 for r, _ in rows if r.y0 > hr.y1 and lo <= r.x0 <= hi]
        return min(ys, default=hr.y0 + 320)

    def section_image(hr):
        lo, hi = column(hr.x0, hr.y0)
        bottom = first_row_below(hr)
        cands = [
            im for im in images
            if hr.y0 - 90 <= (im[0].y0 + im[0].y1) / 2 <= bottom and lo - 5 <= (im[0].x0 + im[0].x1) / 2 <= hi
        ]
        return max(cands, key=lambda im: im[0].width * im[0].height)[1] if cands else None

    sec_img = {id(h): section_image(h[0]) for h in headers}
    out_rows = []
    for r, c in rows:
        exact = [im for im in images if im[2] == c]
        if exact:
            out_rows.append((c, exact[0][1]))
            continue
        above = [h for h in headers if h[0].y0 < r.y0 and abs(h[0].x0 - r.x0) < 150]
        lo, hi = column(r.x0, r.y0)
        above = [h for h in above if lo - 5 <= h[0].x0 <= hi] or above
        if above:
            h = max(above, key=lambda h: h[0].y0)
            if sec_img[id(h)]:
                out_rows.append((c, sec_img[id(h)]))
                continue
        cands = [im for im in images if r.y0 - 350 < im[0].y1 <= r.y0 + 5 and lo - 5 <= (im[0].x0 + im[0].x1) / 2 <= hi]
        if cands:
            out_rows.append((c, max(cands, key=lambda im: im[0].width * im[0].height)[1]))
    out_series = [(code, sec_img[id(h)]) for h in headers for code in h[1] if sec_img[id(h)]]
    return out_rows, out_series


def main(pdf: str, catalog_sql: str, out_dir: str, migration: str) -> None:
    doc = fitz.open(pdf)
    norm_ref = {}
    for ref in re.findall(r"^\('((?:[^']|'')*)','\d*'", open(catalog_sql, encoding="utf-8").read(), re.M):
        norm_ref.setdefault(norm(ref), []).append(ref)
    refs = set(norm_ref)

    found, series = {}, {}  # código -> (página, xref)
    for pn in range(len(doc)):
        rows, sers = page_items(doc[pn], refs)
        for c, xref in rows:
            found.setdefault(c, (pn, xref))
        for c, xref in sers:
            series.setdefault(c, (pn, xref))
    direct = len(found)
    codes = sorted(series, key=len, reverse=True)
    for c in refs - set(found):
        for s in codes:
            if c.startswith(s) and len(c) > len(s):
                found[c] = series[s]
                break

    saved, ref_file = {}, {}
    for c, (pn, xref) in sorted(found.items()):
        if xref not in saved:
            fname = f"bm-{hashlib.md5(str(xref).encode()).hexdigest()[:10]}.jpg"
            try:
                img = render(doc, xref)
            except Exception:
                saved[xref] = None
                continue
            img.thumbnail((500, 500))
            img.save(f"{out_dir}/{fname}", quality=80, optimize=True)
            saved[xref] = fname
        if saved[xref]:
            for ref in norm_ref[c]:
                ref_file[ref] = saved[xref]

    folder = out_dir.rstrip("/").split("public/", 1)[-1]
    values = ",\n".join(f"('{r}', '/{folder}/{f}')" for r, f in sorted(ref_file.items()))
    nphotos = len({f for f in ref_file.values()})
    total = sum(len(v) for v in norm_ref.values())
    with open(migration, "w", encoding="utf-8") as fh:
        fh.write(f"""-- Fotos Blue Master tiradas do catálogo PDF (data/extract_bluemaster_images.py). {len(ref_file)} artigos, {nphotos} fotos.
update public.b2b_products p set image_url = v.url, updated_at = now()
from (values
{values}
) as v(reference, url), public.b2b_manufacturers m
where m.slug = 'blue-master' and p.manufacturer_id = m.id and p.reference = v.reference;
""")
    print(f"{len(ref_file)} de {total} artigos com foto ({nphotos} fotos); {direct} códigos lidos nas tabelas, "
          f"o resto pela série")


if __name__ == "__main__":
    main(*sys.argv[1:5])
