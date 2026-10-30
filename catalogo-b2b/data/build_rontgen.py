"""Gera a migração SQL com o catálogo RÖNTGEN a partir da tarifa PDF (lida por data/parse_rontgen.py).

Uso: python3 data/build_rontgen.py "RONTGEN Tarifa 2025.pdf" supabase/migrations/<data>_rontgen_catalogo.sql
- Fitas de serra: vendidas à medida (size_type 'medida'). Preço de tabela = preço por metro;
  b2b_prices.weld_price = soldadura de cada fita. O cliente indica o comprimento em mm.
- Serras de máquina alternativa e de mão: preço por unidade.
"""
import collections
import re
import sys

import fitz

sys.path.insert(0, __import__("os").path.dirname(__file__))
from parse_rontgen import band_saws, hand_saws  # noqa: E402

FAMILY = [("HM-TITAN", "Fitas de serra de metal duro (HM-TITAN)"), ("GRIT", "Fitas de serra com grão de metal duro (GRIT)"),
          ("RRR", "Fitas de serra de aço carbono (RRR)"), ("BI-ALFA", "Fitas de serra bimetálicas (BI-ALFA)")]


def q(v) -> str:
    return "null" if v in (None, "") else "'" + str(v).replace("'", "''") + "'"


def ref_part(s: str) -> str:
    return re.sub(r"[^A-Z0-9/,]+", "-", s.upper()).strip("-")


def main(pdf: str, out: str) -> None:
    doc = fitz.open(pdf)
    rows, seen = [], set()
    for it in band_saws(doc):
        fam = next(f for k, f in FAMILY if it["series"].startswith(k) or k in it["series"])
        size = it["size"]
        tpi = it["tpi"]
        form = it["form"]
        ref = "RO-" + "-".join(ref_part(x) for x in [it["series"], size.replace(" x ", "X"), tpi, form] if x)
        if ref in seen:
            continue
        seen.add(ref)
        teeth = f" · {tpi} dpp" if tpi and not tpi.startswith("passo") else (f" · {tpi}" if tpi else "")
        dente = {"N": " · dente N (neutro)", "H": " · dente H (gancho)"}.get(form, "")
        designation = f"Fita de serra Röntgen {it['series']} {size} mm{teeth}{dente} · à medida"
        # Sem preços na descrição: a descrição é pública e os preços só aparecem com sessão iniciada.
        desc = ("Fita de serra soldada à medida: indique o comprimento em mm. O preço por fita é calculado pelos metros "
                "mais a soldadura. dpp = dentes por polegada. Dente N = neutro (0º); H = gancho (ângulo positivo).")
        rows.append((ref, designation, desc, fam, "m", "medida", it["per_metre"], it["weld"]))
    for it in hand_saws(doc):
        fam = "Serras de arco (mão)" if it["kind"] == "Serra de mão" else "Serras de máquina alternativa"
        ref = "RO-" + "-".join(ref_part(x) for x in [it["series"], it["dim"].replace(" x ", "X"), it["teeth"] + "Z"])
        if ref in seen:
            continue
        seen.add(ref)
        teeth = "progressivo 32/18 dpp" if "/" in it["teeth"] else f"{it['teeth']} dpp"
        designation = f"{it['kind']} Röntgen {it['series']} {it['dim']} mm · {teeth}"
        rows.append((ref, designation, "", fam, "un", None, it["price"], None))

    values = ",\n".join(f"({q(r)},{q(d)},{q(x)},{q(f)},{q(u)},{q(s)},{p},{'null' if w is None else w})" for r, d, x, f, u, s, p, w in rows)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(f"""-- Catálogo RÖNTGEN (tarifa março 2025, {len(rows)} artigos). Gerado por data/build_rontgen.py — não editar à mão.
-- Fitas de serra à medida: preço de tabela por metro + soldadura por fita (b2b_prices.weld_price); o cliente indica o comprimento.

insert into public.b2b_manufacturers (name, slug, orders_email, sort, active)
values ('Röntgen', 'rontgen', 'oficina@rontgen-iberica.com', 100, true)
on conflict (slug) do update set orders_email = excluded.orders_email, active = true;

create temp table rontgen_import (reference text, designation text, description text, family text,
  sales_unit text, size_type text, list_price numeric, weld_price numeric);

insert into rontgen_import values
{values};

do $$
declare m uuid := (select id from public.b2b_manufacturers where slug = 'rontgen');
begin
  insert into public.b2b_families (manufacturer_id, name)
  select distinct m, family from rontgen_import
  on conflict (manufacturer_id, name) do nothing;

  insert into public.b2b_products (manufacturer_id, family_id, reference, designation, description,
    sales_unit, pack_qty, moq, size_type, is_new, active, updated_at)
  select m, fam.id, a.reference, a.designation, a.description, a.sales_unit, 1, 1, a.size_type, false, true, now()
  from rontgen_import a join public.b2b_families fam on fam.manufacturer_id = m and fam.name = a.family
  on conflict (manufacturer_id, reference) do update set
    designation = excluded.designation, description = excluded.description, sales_unit = excluded.sales_unit,
    size_type = excluded.size_type, family_id = excluded.family_id, active = true, updated_at = now();

  insert into public.b2b_prices (product_id, list_price, weld_price)
  select p.id, a.list_price, a.weld_price from rontgen_import a
  join public.b2b_products p on p.manufacturer_id = m and p.reference = a.reference
  on conflict (product_id) do update set list_price = excluded.list_price, weld_price = excluded.weld_price, updated_at = now();
end $$;

drop table rontgen_import;
""")
    print(f"{len(rows)} artigos -> {out}")
    print(collections.Counter(r[3] for r in rows).most_common())


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
