"""Gera a migração SQL com o catálogo AGHASA TURIS a partir da tarifa Excel do fabricante.

Uso: python3 data/build_aghasa.py "AGHASA TURIS_Tarifa 2026.xlsx" supabase/migrations/<data>_aghasa_catalogo.sql
Colunas (linha 3): Cod. Largo, Referencia, Descripción, Descripción corta, Precio'25, Precio'26, Fecha Precio Nuevo,
Variación Precio, Rango, EAN, Unid/ Paquete, Marca, Página Catálogo.
"""
import collections
import sys

import openpyxl

# Secção do catálogo (início do código "Página Catálogo") -> família em português.
SECTIONS = {
    "P01-01": "Chaves de fendas e punções",
    "P01-02": "Chaves e chaves de caixa",
    "P01-03": "X-atos, tesouras e raspadores",
    "P01-04": "Alicates e corta-cabos",
    "P01-05": "Alicates e tenazes",
    "P01-06": "Alicates de cravar e descarnar",
    "P01-07": "Extratores e prensas",
    "P01-08": "Vazadores",
    "P01-09": "Tornos de bancada e grampos",
    "P01-10": "Maços e marretas",
    "P01-11": "Martelos",
    "P01-12": "Maços e marretas",
    "P01-13": "Marcação e traçagem",
    "P01-14": "Punções de marcar",
    "P01-15": "Escopros, talhadeiras e punções",
    "P01-16": "Limas e grosas",
    "P01-17": "Arcos de serra",
    "P02-01": "Fitas métricas",
    "P02-02": "Níveis, esquadros e réguas",
    "P02-04": "Medição de precisão",
    "P02-05": "Medição de precisão",
    "P03-01": "Brocas",
    "P03-02": "Brocas",
    "P03-03": "Lâminas de serra",
    "P03-04": "Coroas de corte",
    "P03-05": "Discos de serra",
    "P04-01": "Discos de corte e desbaste",
    "P04-02": "Escovas e polimento",
    "P04-03": "Abrasivos flexíveis",
    "P04-04": "Rodas abrasivas e acessórios",
    "P04-05": "Mós de haste",
    "P05-01": "Fitas adesivas",
    "P05-02": "Buchas e fixação",
    "P06-01": "Escadas e plataformas",
    "P07-01": "Proteção ocular",
    "P08-01": "Misturadores",
    "P09-01": "Bombas e lubrificação",
    "P10-01": "Malas e arrumação",
    "P10-02": "Cadeados",
    "P10-03": "Iluminação",
    "P11-01": "Guias passa-cabos",
    "P12-01": "Sinalização",
    "ZCATAL": "Material elétrico",
    "PZCATA": "Buchas e fixação",
}


def q(v) -> str:
    if v is None or v == "":
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def main(src: str, out: str) -> None:
    ws = openpyxl.load_workbook(src, read_only=True).worksheets[0]
    rows = [r for r in list(ws.iter_rows(values_only=True))[3:] if r[2] and isinstance(r[6], (int, float))]
    values, fams = [], []
    for r in rows:
        _, _, ref, desc, short, _, price, _, _, _, ean, pack, brand, page = r[:14]
        fam = SECTIONS.get(str(page or "")[:6], "Outros")
        fams.append(fam)
        pack = int(pack) if pack else 1
        details = []
        if brand:
            details.append(f"Marca: {brand}")
        if pack > 1:
            details.append(f"Embalagem: {pack} unidades")
        if page:
            details.append(f"Catálogo AGHASA TURIS 2026, ref. página {page}")
        designation = str(short or desc).strip()
        if brand and str(brand).lower() not in designation.lower():
            designation = f"{designation} · {brand}"
        ean = str(int(ean)) if isinstance(ean, (int, float)) else (str(ean).strip() if ean else None)
        values.append(f"({q(str(ref).strip())},{q(ean)},{q(designation)},{q('. '.join(details))},{pack},{q(fam)},{round(float(price), 4)})")

    with open(out, "w", encoding="utf-8") as f:
        f.write(f"""-- Catálogo AGHASA TURIS (tarifa 2026, em vigor desde 15/05/2026, {len(values)} artigos). Gerado por data/build_aghasa.py — não editar à mão.
-- Preço de tabela = Precio'26 do fabricante. Quantidades em múltiplos de "Unid/ Paquete".

insert into public.b2b_manufacturers (name, slug, orders_email, sort, active)
values ('AGHASA TURIS', 'aghasa-turis', 'annac.deza@aghasaturis.com', 20, true)
on conflict (slug) do update set orders_email = excluded.orders_email, active = true;

create temp table aghasa_import (reference text, ean text, designation text, description text,
  pack_qty numeric, family text, list_price numeric);

insert into aghasa_import values
""")
        f.write(",\n".join(values))
        f.write(""";

do $$
declare m uuid := (select id from public.b2b_manufacturers where slug = 'aghasa-turis');
begin
  insert into public.b2b_families (manufacturer_id, name)
  select distinct m, family from aghasa_import
  on conflict (manufacturer_id, name) do nothing;

  insert into public.b2b_products (manufacturer_id, family_id, reference, ean, designation, description,
    sales_unit, pack_qty, moq, is_new, active, updated_at)
  select m, fam.id, a.reference, a.ean, a.designation, a.description, 'un', a.pack_qty, a.pack_qty, false, true, now()
  from aghasa_import a join public.b2b_families fam on fam.manufacturer_id = m and fam.name = a.family
  on conflict (manufacturer_id, reference) do update set
    ean = excluded.ean, designation = excluded.designation, description = excluded.description,
    pack_qty = excluded.pack_qty, moq = excluded.moq, family_id = excluded.family_id, active = true, updated_at = now();

  insert into public.b2b_prices (product_id, list_price)
  select p.id, a.list_price from aghasa_import a
  join public.b2b_products p on p.manufacturer_id = m and p.reference = a.reference
  on conflict (product_id) do update set list_price = excluded.list_price, updated_at = now();
end $$;

drop table aghasa_import;
""")
    print(f"{len(values)} artigos -> {out}")
    print(collections.Counter(fams).most_common())


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
