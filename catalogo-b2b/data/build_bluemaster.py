"""Gera a migração SQL com o catálogo BLUE MASTER a partir da tabela Excel do fabricante (versão PT).

Uso: python3 data/build_bluemaster.py "Tabela BLUEMASTER2026_PT.xlsx" supabase/migrations/<data>_bluemaster_catalogo.sql
Folha "Tabela 2026": ORDEN, CODIGO, DESCRIÇÃO ARTICULO, EAN, CODDTO, PVP, ...
Folha "Descontos Cliente": CodDto, DESCRIPÇÃO, ... — cada grupo de desconto passa a família.
Por decisão do Alexandre (29/10/2026) os descontos da tabela NÃO são aplicados: os clientes veem o PVP.
"""
import collections
import re
import sys

import openpyxl

# Nomes das famílias mais legíveis do que os da folha de descontos.
NAMES = {
    "DA001": "Serras craneanas bimetálicas",
    "DA002": "Fresas (Razorback, Remgrit e outras)",
    "DA003": "Folhas e arcos de serra",
    "DA004": "Serras de sabre e tico-tico",
    "DA005": "Extratores de machos Walton",
    "DA006": "Expositores",
    "DA007": "Cut Magic",
    "DA008": "Serras de fita",
    "DA010": "Brocas HSS (BC02, BC2, BC22, BC5…)",
    "DA011": "Brocas para metal",
    "DA012": "Brocas de cabo cónico (BC11)",
    "DA013": "Fresas FF01–FF99",
    "DA014": "Escareadores",
    "DA015": "Jogos de machos e caçonetes HSS",
    "DA016": "Mandris",
    "DA017": "Brocas para parede e combinadas",
    "DA019": "Brocas multiusos (BW4, BW8)",
    "DA020": "Brocas SDS Plus",
    "DA021": "Brocas SDS Max, ponteiros e cinzéis",
    "DA022": "Brocas para madeira",
    "DA024": "Fresas de metal duro integral",
    "DA028": "Machos de máquina",
    "DA033": "Fresas corta-círculos",
    "DA035": "Fresas rotativas de metal duro",
    "DA041": "Brocas de metal duro integral",
    "DA042": "Cones redutores e extensões",
    "DA043": "Brocas para grés e porcelânico",
    "DA044": "Brocas diamantadas para cerâmica",
    "DA045": "Discos diamantados",
    "DA050": "Insertos e ferramentas Powercoil",
    "DA052": "Perfuradores",
    "DA053": "Bits para parafusos",
    "DA054": "Rebarbadores",
    "DA063": "Porta-ferramentas, machos especiais e lâminas de torno",
}


def q(v) -> str:
    if v is None or v == "":
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def main(src: str, out: str) -> None:
    wb = openpyxl.load_workbook(src, read_only=True)
    ws = wb["Tabela 2026"]
    rows = [r for r in list(ws.iter_rows(values_only=True))[1:] if r[1] and isinstance(r[5], (int, float))]
    values, fams = [], []
    for r in rows:
        _, ref, desc, ean, group, price = r[:6]
        group = str(group or "").strip().upper()
        fam = NAMES.get(group, "Outros")
        fams.append(fam)
        ean = str(int(ean)) if isinstance(ean, (int, float)) else (str(ean).strip() if ean else None)
        designation = re.sub(r"\s+", " ", str(desc).strip())
        values.append(f"({q(str(ref).strip())},{q(ean)},{q(designation)},{q('Grupo de desconto ' + group)},{q(fam)},{round(float(price), 4)})")

    with open(out, "w", encoding="utf-8") as f:
        f.write(f"""-- Catálogo BLUE MASTER (tabela 2026, {len(values)} artigos). Gerado por data/build_bluemaster.py — não editar à mão.
-- Preço de tabela = PVP 2026. Famílias = grupos de desconto do fabricante. Sem descontos aplicados (decisão do Alexandre).

insert into public.b2b_manufacturers (name, slug, orders_email, sort, active)
values ('Blue Master', 'blue-master', 'export@bluemaster.es', 30, true)
on conflict (slug) do update set orders_email = excluded.orders_email, active = true;

create temp table bluemaster_import (reference text, ean text, designation text, description text, family text, list_price numeric);

insert into bluemaster_import values
""")
        f.write(",\n".join(values))
        f.write(""";

do $$
declare m uuid := (select id from public.b2b_manufacturers where slug = 'blue-master');
begin
  insert into public.b2b_families (manufacturer_id, name)
  select distinct m, family from bluemaster_import
  on conflict (manufacturer_id, name) do nothing;

  insert into public.b2b_products (manufacturer_id, family_id, reference, ean, designation, description,
    sales_unit, pack_qty, moq, is_new, active, updated_at)
  select m, fam.id, a.reference, a.ean, a.designation, a.description, 'un', 1, 1, false, true, now()
  from bluemaster_import a join public.b2b_families fam on fam.manufacturer_id = m and fam.name = a.family
  on conflict (manufacturer_id, reference) do update set
    ean = excluded.ean, designation = excluded.designation, description = excluded.description,
    family_id = excluded.family_id, active = true, updated_at = now();

  insert into public.b2b_prices (product_id, list_price)
  select p.id, a.list_price from bluemaster_import a
  join public.b2b_products p on p.manufacturer_id = m and p.reference = a.reference
  on conflict (product_id) do update set list_price = excluded.list_price, updated_at = now();
end $$;

drop table bluemaster_import;
""")
    print(f"{len(values)} artigos -> {out}")
    print(collections.Counter(fams).most_common())


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
