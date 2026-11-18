"""Gera a migração SQL do catálogo KLEVER a partir da transcrição da tarifa (data/klever/tarifa_2026.txt).

Uso: python3 data/build_klever.py data/klever/tarifa_2026.txt supabase/migrations/<data>_klever_catalogo.sql

A tarifa KLEVER 2026 (Klever Innovations Spain SLU) é um PDF de 11 páginas com cerca de 80 artigos
(marcas Klever, Tortoris, Scraperite, Kretzer e Knifeline), transcrito para o .txt.
Regras:
- Preço de tabela = preço da tarifa. "un" = preço por unidade, vendido em múltiplos da U.V. (embalagem);
  "cx" = preço por caixa (€/CAJA), a caixa é a unidade de venda.
- Grupo "Equipamentos e consumíveis industriais" (separador Indústria): sort 270, a seguir à UNIOR.
- As fotos saem da própria tarifa com data/extract_pdf_ref_images.py (migração à parte).
"""
import collections
import sys


def q(v) -> str:
    return "null" if v in (None, "") else "'" + str(v).replace("'", "''") + "'"


def parse(path: str):
    items, seen, family = [], set(), None
    for raw in open(path, encoding="utf-8"):
        line = raw.strip()
        if not line or line.startswith("# "):
            continue
        if line.startswith("## "):
            family = line[3:].strip()
            continue
        ref, name, desc, unit, pack, price = [p.strip() for p in line.split("|")]
        if ref in seen:
            continue
        seen.add(ref)
        items.append((ref, f"{ref} · {name}", desc, family, unit, int(pack),
                      float(price.replace(",", ".")), "Novidade 2026" in desc))
    return items


def main(src: str, out_sql: str) -> None:
    items = parse(src)
    values = ",\n".join(f"({q(r)},{q(d)},{q(x)},{q(f)},{q(u)},{p},{pr},{str(n).lower()})"
                        for r, d, x, f, u, p, pr, n in items)
    with open(out_sql, "w", encoding="utf-8") as fh:
        fh.write(f"""-- Catálogo KLEVER (tarifa de preços 2026: Klever, Tortoris, Scraperite, Kretzer, Knifeline; {len(items)} artigos).
-- Gerado por data/build_klever.py — não editar à mão. Preço de tabela = preço da tarifa.
-- Grupo Equipamentos e consumíveis industriais (sort 270). Encomendas para info@kleverinnovations.es.

insert into public.b2b_manufacturers (name, slug, orders_email, sort, active, legal_name, address, country, phone, website)
values ('KLEVER', 'klever', 'info@kleverinnovations.es', 270, true, 'Klever Innovations Spain SLU',
  'C/ Esperança 23, 08330 Premià de Mar (Barcelona)', 'Espanha', '+34 935 132 320', 'www.kleverinnovations.es')
on conflict (slug) do update set orders_email = excluded.orders_email, sort = excluded.sort, active = true,
  legal_name = coalesce(public.b2b_manufacturers.legal_name, excluded.legal_name),
  address = coalesce(public.b2b_manufacturers.address, excluded.address),
  country = coalesce(public.b2b_manufacturers.country, excluded.country),
  phone = coalesce(public.b2b_manufacturers.phone, excluded.phone),
  website = coalesce(public.b2b_manufacturers.website, excluded.website);

create temp table klever_import (reference text, designation text, description text, family text,
  sales_unit text, pack_qty numeric, list_price numeric, is_new boolean);

insert into klever_import values
{values};

do $$
declare m uuid := (select id from public.b2b_manufacturers where slug = 'klever');
begin
  insert into public.b2b_families (manufacturer_id, name)
  select distinct m, family from klever_import
  on conflict (manufacturer_id, name) do nothing;

  insert into public.b2b_products (manufacturer_id, family_id, reference, designation, description,
    sales_unit, pack_qty, moq, is_new, active, updated_at)
  select m, fam.id, a.reference, a.designation, a.description, a.sales_unit, a.pack_qty, a.pack_qty, a.is_new, true, now()
  from klever_import a join public.b2b_families fam on fam.manufacturer_id = m and fam.name = a.family
  on conflict (manufacturer_id, reference) do update set
    designation = excluded.designation, description = excluded.description, sales_unit = excluded.sales_unit,
    pack_qty = excluded.pack_qty, moq = excluded.moq, is_new = excluded.is_new,
    family_id = excluded.family_id, active = true, updated_at = now();

  insert into public.b2b_prices (product_id, list_price)
  select p.id, a.list_price from klever_import a
  join public.b2b_products p on p.manufacturer_id = m and p.reference = a.reference
  on conflict (product_id) do update set list_price = excluded.list_price, updated_at = now();
end $$;

drop table klever_import;
""")
    print(f"{len(items)} artigos -> {out_sql}")
    print(collections.Counter(i[3] for i in items).most_common())


if __name__ == "__main__":
    main(*sys.argv[1:3])
