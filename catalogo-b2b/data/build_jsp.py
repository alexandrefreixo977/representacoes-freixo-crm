"""Gera a migração SQL com o catálogo JSP SAFETY a partir da tabela de preços Excel do fabricante.

Uso: python3 data/build_jsp.py "JSP Price List.xlsx" supabase/migrations/<data>_jsp_catalogo.sql [email_encomendas]
Colunas (linha 7): Code, Description, Product Group, Minimum Order Quantity, Incremental Order Quantity,
SLA, Lead Time, Currency, SRP. Preço de tabela = SRP (EUR). Linhas sem preço ou noutra moeda ficam de fora.
"""
import collections
import sys

import openpyxl

GROUPS = {
    "Helmets": "Capacetes",
    "Helmet Accessories": "Acessórios para capacetes",
    "Bump / Top Caps": "Bonés de proteção",
    "Spectacles": "Óculos de proteção",
    "Goggles": "Óculos panorâmicos",
    "Faceshields": "Viseiras",
    "Filterspec": "Óculos de proteção",
    "Hearing Protection": "Proteção auditiva",
    "Respiratory Disposable": "Máscaras descartáveis",
    "Respiratory Reusable": "Máscaras reutilizáveis e filtros",
    "Powered Air": "Proteção respiratória motorizada",
    "Respair": "Proteção respiratória motorizada",
    "Height Safety": "Trabalhos em altura",
    "Swiss One": "Proteção auditiva",
    "Iles": "Outros",
}


def q(v) -> str:
    if v is None or v == "":
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def main(src: str, out: str, email: str = "afreixo@representacoesfreixo.com") -> None:
    ws = openpyxl.load_workbook(src, read_only=True, data_only=True).worksheets[0]
    seen, values, fams = set(), [], []
    for r in ws.iter_rows(min_row=9, values_only=True):
        code, desc, group, moq, inc, sla, lead, cur, price = (list(r) + [None] * 9)[:9]
        if not code or cur != "EUR" or not isinstance(price, (int, float)):
            continue
        code = str(code).strip()
        if code in seen:
            continue
        seen.add(code)
        fam = GROUPS.get(str(group or "").strip(), "Outros")
        fams.append(fam)
        inc = int(inc) if isinstance(inc, (int, float)) and inc > 0 else 1
        moq = int(moq) if isinstance(moq, (int, float)) and moq > 0 else inc
        details = []
        if lead:
            details.append("Disponibilidade: em stock" if str(lead).lower() == "stocked" else f"Prazo de entrega: {lead}".replace("days", "dias"))
        if moq > 1 or inc > 1:
            details.append(f"Encomenda mínima {moq} un., em múltiplos de {inc}")
        if sla == "End of Line":
            details.append("Fim de série")
        values.append(f"({q(code)},{q(str(desc).strip())},{q('. '.join(details))},{inc},{moq},{q(fam)},{round(float(price), 4)})")

    with open(out, "w", encoding="utf-8") as f:
        f.write(f"""-- Catálogo JSP SAFETY (tabela 2026, em vigor desde 20/04/2026, {len(values)} artigos). Gerado por data/build_jsp.py — não editar à mão.
-- Preço de tabela = SRP (EUR). Mínimo = "Minimum Order Quantity", múltiplos = "Incremental Order Quantity".

insert into public.b2b_manufacturers (name, slug, orders_email, sort, active)
values ('JSP Safety', 'jsp-safety', {q(email)}, 50, true)
on conflict (slug) do update set orders_email = excluded.orders_email, active = true;

create temp table jsp_import (reference text, designation text, description text,
  pack_qty numeric, moq numeric, family text, list_price numeric);

insert into jsp_import values
""")
        f.write(",\n".join(values))
        f.write(""";

do $$
declare m uuid := (select id from public.b2b_manufacturers where slug = 'jsp-safety');
begin
  insert into public.b2b_families (manufacturer_id, name)
  select distinct m, family from jsp_import
  on conflict (manufacturer_id, name) do nothing;

  insert into public.b2b_products (manufacturer_id, family_id, reference, designation, description,
    sales_unit, pack_qty, moq, is_new, active, updated_at)
  select m, fam.id, a.reference, a.designation, a.description, 'un', a.pack_qty, a.moq, false, true, now()
  from jsp_import a join public.b2b_families fam on fam.manufacturer_id = m and fam.name = a.family
  on conflict (manufacturer_id, reference) do update set
    designation = excluded.designation, description = excluded.description,
    pack_qty = excluded.pack_qty, moq = excluded.moq, family_id = excluded.family_id, active = true, updated_at = now();

  insert into public.b2b_prices (product_id, list_price)
  select p.id, a.list_price from jsp_import a
  join public.b2b_products p on p.manufacturer_id = m and p.reference = a.reference
  on conflict (product_id) do update set list_price = excluded.list_price, updated_at = now();
end $$;

drop table jsp_import;
""")
    print(f"{len(values)} artigos -> {out}")
    print(collections.Counter(fams).most_common())


if __name__ == "__main__":
    main(*sys.argv[1:4])
