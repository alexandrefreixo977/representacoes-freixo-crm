"""Tira as fotos dos artigos do catálogo PDF da JSP e liga-as às referências da tabela de preços.

Uso: python3 data/extract_jsp_images.py "Catalogo JSP SAFETY 2025.pdf" supabase/migrations/<data>_jsp_catalogo.sql \
       public/img/jsp supabase/migrations/<data>_jsp_imagens.sql
Precisa de: pymupdf, pillow. Depois de extrair, as fotos já ficam no formato uniforme (normalize_images.py).

No catálogo cada bloco tem as fotos do modelo em cima e, por baixo, as linhas "código + descrição".
Cada código fica com a maior foto do conjunto mais próximo acima dele (preferindo o mesmo lado da página).
Os códigos que não vêm no catálogo ficam com a foto do código com o prefixo comum mais comprido (mín. 6 caracteres,
ex. ABS000-001-600 -> ABS000-…), se houver.
"""
import hashlib
import pathlib
import re
import sys

import fitz

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from extract_bluemaster_images import render  # noqa: E402
from normalize_images import normalize  # noqa: E402

CODE = re.compile(r"^[A-Z]{3}\d{3}-[0-9A-Z]{3}-[0-9A-Z]{3}$")


def common_prefix(a: str, b: str) -> int:
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n


def main(pdf: str, catalog_sql: str, out_dir: str, migration: str) -> None:
    doc = fitz.open(pdf)
    refs = set(re.findall(r"^\('([^']+)','", open(catalog_sql, encoding="utf-8").read(), re.M))
    found = {}
    for pn in range(len(doc)):
        page = doc[pn]
        imgs = []
        for im in page.get_image_info(xrefs=True):
            r = fitz.Rect(im["bbox"]) & page.rect
            if im["xref"] and not r.is_empty and r.width * r.height > 3000 and min(r.width, r.height) > 30:
                imgs.append((r, im["xref"]))
        if not imgs:
            continue
        for blk in page.get_text("dict")["blocks"]:
            for ln in blk.get("lines", []):
                text = "".join(s["text"] for s in ln["spans"]).strip()
                if text not in refs or not CODE.match(text) or text in found:
                    continue
                r = fitz.Rect(ln["bbox"])
                above = [(ir, x) for ir, x in imgs if ir.y1 <= r.y1 + 10 and ir.y1 > r.y0 - 320]
                if not above:
                    continue
                half = page.rect.width / 2
                same_side = [(ir, x) for ir, x in above if (ir.x1 > half) == (r.x0 + 200 > half) or ir.x0 < r.x0 + 250]
                pool = same_side or above
                nearest = min(pool, key=lambda it: r.y0 - it[0].y1)
                group = [it for it in pool if abs(it[0].y1 - nearest[0].y1) < 70]
                found[text] = max(group, key=lambda it: it[0].width * it[0].height)[1]
    direct = len(found)
    for ref in refs - set(found):
        best = max(found, key=lambda c: common_prefix(c, ref), default=None)
        if best and common_prefix(best, ref) >= 6:
            found[ref] = found[best]

    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    saved, ref_file = {}, {}
    for ref, xref in sorted(found.items()):
        if xref not in saved:
            name = f"jsp-{hashlib.md5(str(xref).encode()).hexdigest()[:10]}.jpg"
            try:
                img = render(doc, xref)
                img.save(out / name, quality=90)
                normalize(out / name)
                saved[xref] = name
            except Exception:
                saved[xref] = None
        if saved[xref]:
            ref_file[ref] = saved[xref]
    folder = out_dir.rstrip("/").split("public/", 1)[-1]
    values = ",\n".join(f"('{r}', '/{folder}/{f}')" for r, f in sorted(ref_file.items()))
    with open(migration, "w", encoding="utf-8") as fh:
        fh.write(f"""-- Fotos JSP tiradas do catálogo PDF (data/extract_jsp_images.py). {len(ref_file)} artigos, {len(set(ref_file.values()))} fotos.
update public.b2b_products p set image_url = v.url, updated_at = now()
from (values
{values}
) as v(reference, url), public.b2b_manufacturers m
where m.slug = 'jsp-safety' and p.manufacturer_id = m.id and p.reference = v.reference;
""")
    print(f"{len(ref_file)} de {len(refs)} artigos com foto ({len(set(ref_file.values()))} fotos); {direct} lidos no catálogo")


if __name__ == "__main__":
    main(*sys.argv[1:5])
