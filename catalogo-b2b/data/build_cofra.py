"""Gera a migração SQL com os catálogos COFRA (calçado e vestuário) a partir da tarifa .xls do fabricante.

Uso: python3 data/build_cofra.py "Tarifas COFRA PORTUGAL 2°Sem.2026.xls" supabase/migrations/<data>_cofra_catalogo.sql
Folhas: "Calzado (Cofra + Techno)", "Vestuario", "Accessorios" — colunas Codigo, Nombre comercial, PVP (a partir da linha 5).
Duas marcas na loja, com o mesmo email de encomendas:
  COFRA Calçado   = calçado + acessórios (meias, palmilhas, atacadores); o calçado obriga a escolher o tamanho.
  COFRA Vestuário = vestuário; obriga a escolher o tamanho.
"""
import collections
import re
import sys

import xlrd

EMAIL = "s.degennaro@cofra.it"


def q(v) -> str:
    if v is None or v == "":
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def shoe_family(name: str) -> str:
    n = name.upper()
    m = re.search(r"\b(S[1-7])(P|PS|PL|S|L)?\b", n)
    if m:
        base, extra = m.group(1), m.group(2) or ""
        if base == "S1" and extra.startswith("P"):
            return "Calçado S1P"
        return f"Calçado {base}"
    if re.search(r"\bO[1-7]", n):
        return "Calçado ocupacional (O)"
    if re.search(r"\bSB\b", n):
        return "Calçado SB"
    return "Calçado (outros)"


def rows(sheet):
    for i in range(4, sheet.nrows):
        code, name, price = sheet.row_values(i)[:3]
        code, name = str(code).strip(), re.sub(r"\s+", " ", str(name).strip())
        if not code or not name:
            continue
        try:
            value = float(str(price).replace(".", "").replace(",", ".")) if isinstance(price, str) else float(price)
        except ValueError:
            continue
        yield code, name, value


def main(src: str, out: str) -> None:
    wb = xlrd.open_workbook(src)
    items = []  # (slug, reference, designation, family, size_type, price)
    for code, name, price in rows(wb.sheet_by_name("Calzado (Cofra + Techno)")):
        items.append(("cofra-calcado", code, name, shoe_family(name), "calcado", price))
    for code, name, price in rows(wb.sheet_by_name("Accessorios")):
        items.append(("cofra-calcado", code, name, "Acessórios: meias, palmilhas e atacadores", None, price))
    for code, name, price in rows(wb.sheet_by_name("Vestuario")):
        items.append(("cofra-vestuario", code, name, "Vestuário de trabalho", "vestuario", price))

    values = [
        f"({q(slug)},{q(ref)},{q(name)},{q('Tarifa COFRA Portugal, 2.º semestre 2026 (encomendas de 01/08/2026 a 28/02/2027)')},{q(fam)},{q(size)},{round(price, 2)})"
        for slug, ref, name, fam, size, price in items
    ]
    with open(out, "w", encoding="utf-8") as f:
        f.write(f"""-- Catálogos COFRA (tarifa Portugal 2.º semestre 2026, {len(values)} artigos). Gerado por data/build_cofra.py — não editar à mão.
-- Preço de tabela = PVP. Calçado e vestuário pedem tamanho na encomenda.

insert into public.b2b_manufacturers (name, slug, orders_email, sort, active) values
  ('COFRA Calçado', 'cofra-calcado', '{EMAIL}', 40, true),
  ('COFRA Vestuário', 'cofra-vestuario', '{EMAIL}', 41, true)
on conflict (slug) do update set orders_email = excluded.orders_email, active = true;

create temp table cofra_import (slug text, reference text, designation text, description text, family text, size_type text, list_price numeric);

insert into cofra_import values
""")
        f.write(",\n".join(values))
        f.write(""";

insert into public.b2b_families (manufacturer_id, name)
select distinct m.id, a.family from cofra_import a join public.b2b_manufacturers m on m.slug = a.slug
on conflict (manufacturer_id, name) do nothing;

insert into public.b2b_products (manufacturer_id, family_id, reference, designation, description, size_type,
  sales_unit, pack_qty, moq, is_new, active, updated_at)
select m.id, fam.id, a.reference, a.designation, a.description, a.size_type, 'un', 1, 1, false, true, now()
from cofra_import a
join public.b2b_manufacturers m on m.slug = a.slug
join public.b2b_families fam on fam.manufacturer_id = m.id and fam.name = a.family
on conflict (manufacturer_id, reference) do update set
  designation = excluded.designation, description = excluded.description, size_type = excluded.size_type,
  family_id = excluded.family_id, active = true, updated_at = now();

insert into public.b2b_prices (product_id, list_price)
select p.id, a.list_price from cofra_import a
join public.b2b_manufacturers m on m.slug = a.slug
join public.b2b_products p on p.manufacturer_id = m.id and p.reference = a.reference
on conflict (product_id) do update set list_price = excluded.list_price, updated_at = now();

drop table cofra_import;
""")
    print(f"{len(values)} artigos -> {out}")
    print(collections.Counter((i[0], i[3]) for i in items).most_common())


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
