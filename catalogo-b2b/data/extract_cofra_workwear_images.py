"""Tira as fotos do vestuário do catálogo PDF da COFRA e liga-as às referências da tarifa, por cor.

Uso: python3 data/extract_cofra_workwear_images.py "WORKWEAR-ES 2026-1.pdf" "Tarifas COFRA PORTUGAL 2°Sem.2026.xls" \
       public/img/cofra-vestuario supabase/migrations/<data>_cofra_vestuario_imagens.sql
Precisa de: pymupdf, pillow, xlrd.
Depois de extrair, correr data/normalize_images.py na pasta das fotos (quadrado branco 500x500).

No catálogo cada modelo tem um título "NOME V264" e uma foto por cor com o código da cor ao lado ("02").
A referência da tarifa V264-0-02 = modelo V264, cor 02. Cada código de cor fica com a foto mais próxima;
se a cor não tiver foto, o artigo fica com a foto principal do modelo.
"""
import collections
import hashlib
import io
import math
import re
import sys

import fitz
import xlrd
from PIL import Image


def split(code: str):
    m = re.match(r"^(V\d+)-\d+-(\d\d)", code)
    return (m.group(1), m.group(2)) if m else (None, None)


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
    if img.mode in ("RGBA", "LA"):
        bg = Image.new("RGB", img.size, "white")
        bg.paste(img, mask=img.split()[-1])
        img = bg
    return img.convert("RGB")


def main(pdf: str, xls: str, out_dir: str, migration: str) -> None:
    doc = fitz.open(pdf)
    sheet = xlrd.open_workbook(xls).sheet_by_name("Vestuario")
    rows = [str(sheet.row_values(i)[0]).strip() for i in range(4, sheet.nrows) if str(sheet.row_values(i)[0]).strip()]

    models = {}  # V264 -> {"main": xref, "colors": {"02": xref}}
    for pn in range(len(doc)):
        page = doc[pn]
        titles, labels = [], []
        for blk in page.get_text("dict")["blocks"]:
            for ln in blk.get("lines", []):
                text = "".join(s["text"] for s in ln["spans"]).strip()
                size = max(s["size"] for s in ln["spans"])
                m = re.search(r"\b(V\d{3,4})\b", text)
                if m and size >= 16:
                    titles.append((ln["bbox"][1], m.group(1)))
                if re.fullmatch(r"\d\d[A-Z]?", text) and 11 <= size <= 14:
                    x0, y0, x1, y1 = ln["bbox"]
                    labels.append((fitz.Point((x0 + x1) / 2, (y0 + y1) / 2), text[:2]))
        if not titles:
            continue
        titles.sort()

        def owner(y: float) -> str:
            found = titles[0][1]
            for ty, model in titles:
                if y >= ty - 20:
                    found = model
            return found

        by_model = collections.defaultdict(list)
        for im in page.get_image_info(xrefs=True):
            r = fitz.Rect(im["bbox"]) & page.rect
            if im["xref"] and 6000 < r.width * r.height < 0.5 * page.rect.width * page.rect.height:
                by_model[owner((r.y0 + r.y1) / 2)].append((r, im["xref"]))
        for point, color in labels:
            cands = by_model.get(owner(point.y))
            if not cands:
                continue
            r, xref = min(cands, key=lambda it: rect_distance(point, it[0]))
            if rect_distance(point, r) < 60:
                models.setdefault(owner(point.y), {"main": None, "colors": {}})["colors"].setdefault(color, xref)
        for model, cands in by_model.items():
            entry = models.setdefault(model, {"main": None, "colors": {}})
            if entry["main"] is None:
                entry["main"] = max(cands, key=lambda it: it[0].width * it[0].height)[1]

    saved, code_file = {}, {}
    for code in rows:
        model, color = split(code)
        entry = models.get(model)
        if not entry:
            continue
        xref = entry["colors"].get(color) or entry["main"]
        if not xref:
            continue
        if xref not in saved:
            fname = f"cofrav-{hashlib.md5(str(xref).encode()).hexdigest()[:10]}.jpg"
            img = render(doc, xref)
            img.thumbnail((600, 600))
            img.save(f"{out_dir}/{fname}", quality=82, optimize=True)
            saved[xref] = fname
        code_file[code] = saved[xref]

    folder = out_dir.rstrip("/").split("public/", 1)[-1]
    values = ",\n".join(f"('{c}', '/{folder}/{f}')" for c, f in sorted(code_file.items()))
    with open(migration, "w", encoding="utf-8") as fh:
        fh.write(f"""-- Fotos do vestuário COFRA tiradas do catálogo PDF (data/extract_cofra_workwear_images.py). {len(code_file)} artigos, {len(saved)} fotos.
update public.b2b_products p set image_url = v.url, updated_at = now()
from (values
{values}
) as v(reference, url), public.b2b_manufacturers m
where m.slug = 'cofra-vestuario' and p.manufacturer_id = m.id and p.reference = v.reference;
""")
    print(f"{len(code_file)} de {len(rows)} artigos com foto ({len(saved)} fotos)")


if __name__ == "__main__":
    main(*sys.argv[1:5])
