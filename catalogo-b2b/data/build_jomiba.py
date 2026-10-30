"""Gera a migração SQL e as fotos do catálogo JOMIBA a partir da tarifa PDF do fabricante.

Uso: python3 data/build_jomiba.py "TARIFA JOMIBA MAYO 2026.pdf" supabase/migrations/<data>_jomiba_catalogo.sql public/img/jomiba
Precisa de: pymupdf, pillow.

Em cada linha da tarifa: fotos à esquerda, código do artigo (cinzento, negrito), descrição e preço P.V.P. à direita.
Os títulos das secções (faixa preta) passam a famílias. As fotos ficam no formato uniforme (normalize_images.py).
"""
import collections
import hashlib
import io
import pathlib
import re
import sys

import fitz
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from normalize_images import normalize  # noqa: E402

WORDS = [
    ("guantes", "luvas"), ("guante", "luva"), ("piel", "pele"), ("serraje", "crute"), ("uso general", "uso geral"),
    ("cuero", "couro"), ("vacuno", "bovino"), ("marrón", "castanho"), ("serie", "série"), ("mixtos", "mistos"),
    ("desechables", "descartáveis"), ("deshechables", "descartáveis"), ("botas", "botas"), ("corte", "corte"),
    ("químicos", "químicos"), ("frío", "frio"), ("térmicos", "térmicas"), ("protección", "proteção"),
    ("ante el", "contra o"), ("ante", "contra"), ("al", "ao"), ("riesgos", "riscos"), ("de seguridad", "de segurança"),
    ("vestuario", "vestuário"), ("laboral", "de trabalho"), ("algodón", "algodão"), ("fibras textiles", "fibras têxteis"),
    ("fibbras textiles", "fibras têxteis"), ("industria alimentaria", "indústria alimentar"), ("malla metálica", "malha metálica"),
    ("auditiva", "auditiva"), ("tapones", "tampões"), ("reutilizables", "reutilizáveis"), ("no reutilizables", "não reutilizáveis"),
    ("gafas", "óculos"), ("seguridad facial", "proteção facial"), ("pantalla", "viseira"), ("arnés", "arnês"),
    ("medias máscaras", "meias máscaras"), ("con filtros integrados", "com filtros integrados"), ("filros", "filtros"),
    ("para partículas", "para partículas"), ("gases y vapores", "gases e vapores"), ("complementos", "complementos"),
    ("alta visibilidad", "alta visibilidade"), ("delantal", "avental"), ("hilo", "fio"), ("y", "e"), ("con", "com"),
    ("especiales", "especiais"), ("especial", "especial"), ("cabra", "cabra"), ("plegada", "dobrada"), ("moldeada", "moldada"),
    ("clásica", "clássica"), ("dieléctricos", "dielétricas"), ("electrostáticos", "eletrostáticas"), ("contra impactos", "contra impactos"),
    ("cortes", "cortes"), ("auriculares", "auriculares"), ("de visita", "de visita"), ("cubre-gafas", "sobreóculos"),
    ("panorámicas", "panorâmicos"), ("criogénicos hidrofugados", "criogénicas hidrófugas"), ("fibra", "fibra"),
    ("filamentos de acero", "filamentos de aço"), ("arenoso", "arenoso"), ("lona", "lona"), ("flor", "flor"),
]


def pt(title: str) -> str:
    t = " ".join(title.split()).lower()
    for es, p in WORDS:
        t = re.sub(rf"(?<![\wáéíóúñ]){re.escape(es)}(?![\wáéíóúñ])", p, t)
    t = t.strip(" /-")
    t = re.sub(r"\b3m\b", "3M", t)
    return t[:1].upper() + t[1:]


def q(v) -> str:
    return "null" if v in (None, "") else "'" + str(v).replace("'", "''") + "'"


def main(pdf: str, out_sql: str, img_dir: str) -> None:
    doc = fitz.open(pdf)
    out = pathlib.Path(img_dir)
    out.mkdir(parents=True, exist_ok=True)
    folder = img_dir.rstrip("/").split("public/", 1)[-1]
    items, seen, family = [], set(), "Outros"
    for pn in range(len(doc)):
        page = doc[pn]
        lines = []
        for blk in page.get_text("dict")["blocks"]:
            for ln in blk.get("lines", []):
                t = "".join(s["text"] for s in ln["spans"]).strip()
                if t:
                    sp = ln["spans"][0]
                    lines.append((fitz.Rect(ln["bbox"]), t, round(sp["size"]), sp["font"], sp["color"]))
        lines.sort(key=lambda it: (it[0].y0, it[0].x0))
        codes = [l for l in lines if l[3].startswith("Calibri-Bold") and l[4] == 0x7F7F7F and l[2] >= 12 and l[0].x0 < 300]
        heads = [l for l in lines if l[4] == 0xFFFFFF and l[2] >= 15]
        prices = [l for l in lines if re.fullmatch(r"\d+(\.\d{3})*,\d+\s*€", l[1]) and l[0].x0 > 430]
        imgs = [fitz.Rect(i["bbox"]) for i in page.get_image_info(xrefs=True) if i["xref"]]
        imgs = [r for r in imgs if r.x1 < 172 and r.width * r.height > 1500]
        for ci, (r, code, *_rest) in enumerate(codes):
            for h in heads:
                if h[0].y0 < r.y0:
                    family = pt(h[1])
            nxt = min([c[0].y0 for c in codes[ci + 1:]] + [h[0].y0 for h in heads if h[0].y0 > r.y0] + [page.rect.y1])
            pr = [p for p in prices if r.y0 - 10 <= p[0].y0 < nxt]
            if not pr:
                continue
            price = float(pr[0][1].replace("€", "").strip().replace(".", "").replace(",", "."))
            desc = " ".join(l[1] for l in lines if l[3].startswith("Arial") and 160 < l[0].x0 < 340 and r.y0 < l[0].y0 < nxt)
            desc = re.sub(r"\s+", " ", desc).strip()
            code = " ".join(code.split())
            if code in seen:
                continue
            seen.add(code)
            first = re.split(r"(?<=\.)\s", desc)[0].rstrip(".") if desc else ""
            designation = f"{code} · {first}" if first else code
            img_url = None
            band = [im for im in imgs if r.y0 - 15 <= (im.y0 + im.y1) / 2 <= nxt]
            if band:
                clip = band[0]
                for im in band[1:]:
                    clip |= im
                clip = fitz.Rect(clip.x0 + 2, clip.y0 + 2, clip.x1 - 2, clip.y1 - 2)  # sem as linhas da tabela
                pix = page.get_pixmap(clip=clip, matrix=fitz.Matrix(3, 3), alpha=False)
                name = f"jomiba-{hashlib.md5(code.encode()).hexdigest()[:10]}.jpg"
                Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB").save(out / name, quality=90)
                normalize(out / name)
                img_url = f"/{folder}/{name}"
            size_type = "calcado" if re.search(r"\b(BOTAS?|CALZADO|ZAPATOS?)\b", family.upper() + " " + desc.upper()) and "Luva" not in family else None
            items.append((code, designation[:200], desc, family, price, img_url, size_type))

    values = ",\n".join(
        f"({q(c)},{q(d)},{q(x)},{q(f)},{p},{q(i)},{q(s)})" for c, d, x, f, p, i, s in items
    )
    with open(out_sql, "w", encoding="utf-8") as fh:
        fh.write(f"""-- Catálogo JOMIBA (tarifa maio 2026, {len(items)} artigos). Gerado por data/build_jomiba.py — não editar à mão.
-- Preço de tabela = P.V.P. da tarifa. Fotos tiradas da própria tarifa (public/img/jomiba).

insert into public.b2b_manufacturers (name, slug, orders_email, sort, active)
values ('JOMIBA', 'jomiba', 'ventas@jomiba.com', 80, true)
on conflict (slug) do update set orders_email = excluded.orders_email, active = true;

create temp table jomiba_import (reference text, designation text, description text, family text,
  list_price numeric, image_url text, size_type text);

insert into jomiba_import values
{values};

do $$
declare m uuid := (select id from public.b2b_manufacturers where slug = 'jomiba');
begin
  insert into public.b2b_families (manufacturer_id, name)
  select distinct m, family from jomiba_import
  on conflict (manufacturer_id, name) do nothing;

  insert into public.b2b_products (manufacturer_id, family_id, reference, designation, description, image_url,
    sales_unit, pack_qty, moq, size_type, is_new, active, updated_at)
  select m, fam.id, a.reference, a.designation, a.description, a.image_url, 'un', 1, 1, a.size_type, false, true, now()
  from jomiba_import a join public.b2b_families fam on fam.manufacturer_id = m and fam.name = a.family
  on conflict (manufacturer_id, reference) do update set
    designation = excluded.designation, description = excluded.description, image_url = excluded.image_url,
    size_type = excluded.size_type, family_id = excluded.family_id, active = true, updated_at = now();

  insert into public.b2b_prices (product_id, list_price)
  select p.id, a.list_price from jomiba_import a
  join public.b2b_products p on p.manufacturer_id = m and p.reference = a.reference
  on conflict (product_id) do update set list_price = excluded.list_price, updated_at = now();
end $$;

drop table jomiba_import;
""")
    print(f"{len(items)} artigos, {sum(1 for i in items if i[5])} com foto -> {out_sql}")
    print(collections.Counter(i[3] for i in items).most_common())
    print(sum(1 for i in items if i[6]), "com tamanho (calçado)")


if __name__ == "__main__":
    main(*sys.argv[1:4])
