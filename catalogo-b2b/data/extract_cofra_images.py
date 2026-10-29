"""Tira as fotos do calçado do catálogo PDF da COFRA e liga-as às referências da tarifa.

Uso: python3 data/extract_cofra_images.py "SAFETY-FOOTWEAR-ES 2026-2.pdf" "Tarifas COFRA PORTUGAL 2°Sem.2026.xls" \
       public/img/cofra supabase/migrations/<data>_cofra_imagens.sql
Precisa de: pymupdf, pillow, xlrd.
Depois de extrair, correr data/normalize_images.py na pasta das fotos (quadrado branco 500x500).

Como liga foto e artigo: procura no PDF o título do modelo (ex. "ABU DHABI S3S CI FO SR"); se não houver título igual,
usa o nome base do modelo (o que vem antes da classe S1/S3/O2…). A foto é a imagem maior logo abaixo desse título.
As fotos ficam no site (public/img/cofra) e a migração preenche image_url.
"""
import hashlib
import io
import re
import sys

import fitz
import xlrd
from PIL import Image

CLS = r"(?:S[1-7]|O[1-7]|SB|OB)"


def norm(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", s.upper())


def base(name: str) -> str:
    m = re.search(r"\s" + CLS + r"(?:\s|P|S|L|$)", " " + name.upper())
    return name.upper()[: m.start() - 1].strip() if m else name.upper()


def main(pdf: str, xls: str, out_dir: str, migration: str) -> None:
    doc = fitz.open(pdf)
    sheet = xlrd.open_workbook(xls).sheet_by_name("Calzado (Cofra + Techno)")
    items = [
        (str(sheet.row_values(i)[0]).strip(), re.sub(r"\s+", " ", str(sheet.row_values(i)[1]).strip()))
        for i in range(4, sheet.nrows)
        if str(sheet.row_values(i)[0]).strip()
    ]

    titles = []  # (página, retângulo, nome completo, nome base)
    for pn in range(len(doc)):
        for blk in doc[pn].get_text("dict")["blocks"]:
            for ln in blk.get("lines", []):
                text = "".join(s["text"] for s in ln["spans"]).strip()
                size = max((s["size"] for s in ln["spans"]), default=0)
                m = re.search(r"([A-Z][A-Z0-9’'\.\- ]{1,40}?)\s+" + CLS + r"(?:P?S|P?L|P)?\b.*", text)
                if m and size >= 7:
                    titles.append((pn, fitz.Rect(ln["bbox"]), norm(m.group(0)), norm(m.group(1))))

    def photo(pn: int, rect: fitz.Rect):
        page = doc[pn]
        below = [t[1].y0 for t in titles if t[0] == pn and t[1].y0 > rect.y0 + 5]
        nxt = min(below, default=1e9)
        imgs = []
        for im in page.get_image_info(xrefs=True):
            r = fitz.Rect(im["bbox"]) & page.rect
            if 15000 < r.width * r.height < 0.6 * page.rect.width * page.rect.height:
                imgs.append((r, im["xref"]))
        cands = [x for x in imgs if rect.y0 - 60 <= x[0].y0 < nxt] or [
            x for x in imgs if abs((x[0].y0 + x[0].y1) / 2 - rect.y0) < 250
        ]
        return max(cands, key=lambda x: x[0].width * x[0].height) if cands else None

    full, by_base = {}, {}
    for t in titles:
        full.setdefault(t[2], t)
        by_base.setdefault(t[3], t)

    saved, code_file = {}, {}
    for code, name in items:
        t = full.get(norm(name)) or by_base.get(norm(base(name)))
        if not t:
            continue
        found = photo(t[0], t[1])
        if not found:
            continue
        rect, xref = found
        key = f"x{xref}" if xref else f"{t[0]}-{rect}"
        if key not in saved:
            fname = f"cofra-{hashlib.md5(key.encode()).hexdigest()[:10]}.jpg"
            img = None
            if xref:
                try:
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
                except Exception:
                    img = None
            if img is None:
                zoom = min(2.5, 520 / max(rect.width, 1))
                pix = doc[t[0]].get_pixmap(clip=rect, matrix=fitz.Matrix(zoom, zoom), alpha=False)
                img = Image.open(io.BytesIO(pix.tobytes("png")))
            img = img.convert("RGB")
            img.thumbnail((600, 600))
            img.save(f"{out_dir}/{fname}", quality=82, optimize=True)
            saved[key] = fname
        code_file[code] = saved[key]

    values = ",\n".join(f"('{c}', '/img/cofra/{f}')" for c, f in sorted(code_file.items()))
    with open(migration, "w", encoding="utf-8") as fh:
        fh.write(f"""-- Fotos do calçado COFRA tiradas do catálogo PDF (data/extract_cofra_images.py). {len(code_file)} artigos, {len(saved)} fotos.
update public.b2b_products p set image_url = v.url, updated_at = now()
from (values
{values}
) as v(reference, url), public.b2b_manufacturers m
where m.slug = 'cofra-calcado' and p.manufacturer_id = m.id and p.reference = v.reference;
""")
    print(f"{len(code_file)} de {len(items)} artigos com foto ({len(saved)} fotos)")


if __name__ == "__main__":
    main(*sys.argv[1:5])
