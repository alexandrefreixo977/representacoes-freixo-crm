"""Gera a migração SQL com o catálogo ACHA a partir da tarifa Excel do fabricante.

Uso: python3 data/build_acha.py "ACHA - TARIFA 2025.xlsx" supabase/migrations/<data>_acha_catalogo.sql
Colunas esperadas: Paginación, Orden, Código ACHA, EAN13, Descripción, PVP Tarifa, Ud x Caja,
Dimensión, Peso (kg), Observaciones, Imagen.
"""
import collections
import re
import sys

import openpyxl

# Família (PT) -> palavras que aparecem na descrição (ES). A primeira que bater ganha.
FAMILIES = [
    ("Chaves de caixa e acessórios", ["vaso", "nuez", "carraca", "alargadera", "alargador", "articulación", "barra de torsión",
                                      "anillo de retención", "pasador", "extractor", "regleta con", "adaptador", "mango", "barra de extensión", "extensión"]),
    ("Chaves", ["llave", "llaves", "juego-navaja"]),
    ("Blocos padrão e calibração", ["bloque patrón", "bloques patrón", "barra patrón", "mesa de planitud", "mármol"]),
    ("Paquímetros e calibres", ["calibre", "calibrador", "punta metal duro", "punta de metal duro", "punta acero para calibres"]),
    ("Micrómetros e comparadores", ["micrómetro", "alesómetro", "reloj", "comparador", "galgas", "galga", "base magnética",
                                    "soporte magnético", "soporte para micrómetro", "soporte universal", "soporte para mediciones"]),
    ("Esquadros, réguas e goniómetros", ["escuadra", "regla", "cartabón", "goniómetro", "transp", "falsa escuadra", "compás",
                                         "gramil", "caja de madera"]),
    ("Fitas métricas e medição de distância", ["flexómetro", "cinta", "metro plegable", "doble metro", "circómetro",
                                               "medidor", "porta flexómetros", "láser", "proyector", "trípode", "detector"]),
    ("Níveis e prumos", ["nivel", "plomada", "nivelador", "cuña niveladora", "ángulos magnéticos", "calzos"]),
    ("Marcação e traçagem", ["rotulador", "lápiz", "lápices", "marcador", "tiza", "tizas", "porta tizas", "tubo de marcar",
                             "tubo marcar", "spray", "bote", "tiralíneas", "barra pintura", "barra  pintura", "punta trazar", "bobina", "carrete", "cordón", "abecedario",
                             "numeración", "granete", "puntero", "buril", "punta de trazar", "azul", "plantilla", "minas"]),
    ("Martelos, maços e ferramentas de impacto", ["martillo", "maza", "maceta", "taco", "botador", "cortafrío", "cincel",
                                                  "desencofrador", "palanca", "hacha", "piqueta", "pala", "cuña", "sacabocado",
                                                  "perforador", "boca de repuesto"]),
    ("Corte e raspagem", ["cutter", "cuchilla", "cuchillas", "cuchillo", "hoja", "hojas", "raspador", "espátula", "rebabador",
                          "tijera", "cepillo", "avellanador", "lima", "broca", "disco"]),
    ("Ímanes e elevação", ["imán", "polipasto", "gancho", "magnético"]),
    ("Alicates e chaves de fendas", ["destornillador", "alicate", "tenaza", "pinza", "sargento", "corta"]),
    ("Inspeção e eletrónica", ["lupa", "endoscopio", "multímetro", "sonda", "termómetro", "palpador"]),
    ("Caixas e malas de ferramentas", ["caja herramientas", "caja de herramientas", "maletín"]),
    ("Expositores", ["expositor"]),
]


def family_for(desc: str) -> str | None:
    d = desc.lower()
    best = None
    for name, words in FAMILIES:
        for w in words:
            m = re.search(r"(?<![a-záéíóúñ])" + re.escape(w) + r"(?:e?s)?(?![a-záéíóúñ])", d)
            if m and (best is None or m.start() < best[0]):
                best = (m.start(), name)
    return best[1] if best else None


def q(v) -> str:
    if v is None or v == "":
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def main(src: str, out: str) -> None:
    ws = openpyxl.load_workbook(src, read_only=True).active
    rows = [r for r in list(ws.iter_rows(values_only=True))[1:] if r[2] and isinstance(r[5], (int, float))]

    # Produtos sem palavra-chave ficam com a família mais comum da mesma página do catálogo.
    by_page = collections.defaultdict(collections.Counter)
    fams = []
    for r in rows:
        f = family_for(r[4] or "")
        fams.append(f)
        if f:
            by_page[r[0]][f] += 1
    fams = [f or (by_page[r[0]].most_common(1)[0][0] if by_page[r[0]] else "Outros") for f, r in zip(fams, rows)]

    values = []
    for r, fam in zip(rows, fams):
        page, order, ref, ean, desc, price, pack, dim, weight, obs, img = r[:11]
        desc = re.sub(r"\s*\(\d+\)\s*$", "", str(desc).strip())
        designation = f"{desc} · {dim}" if dim else desc
        details = []
        if dim:
            details.append(f"Dimensão: {dim}")
        if weight:
            details.append(f"Peso: {str(weight).replace('.', ',')} kg")
        if pack and int(pack) > 1:
            details.append(f"Embalagem: {int(pack)} unidades")
        details.append(f"Catálogo ACHA 2025, pág. {page}")
        pack = int(pack) if pack else 1
        values.append(
            f"({q(str(ref).strip())},{q(str(ean).strip() if ean else None)},{q(designation)},{q('. '.join(details))},"
            f"{q(img)},{pack},{'true' if obs and 'NUEVO' in str(obs).upper() else 'false'},{q(fam)},{round(float(price), 2)},"
            f"{int(order) if str(order).isdigit() else 0})"
        )

    with open(out, "w", encoding="utf-8") as f:
        f.write(f"""-- Catálogo ACHA HERRAMIENTAS (tarifa 2025, {len(values)} artigos). Gerado por data/build_acha.py — não editar à mão.
-- Preço de tabela = PVP Tarifa 2025 do fabricante. Quantidades em múltiplos da caixa (Ud x Caja).

insert into public.b2b_manufacturers (name, slug, orders_email, sort, active)
values ('ACHA Herramientas', 'acha-herramientas', 'ventas@acha.com', 10, true)
on conflict (slug) do update set orders_email = excluded.orders_email, active = true;

create temp table acha_import (reference text, ean text, designation text, description text, image_url text,
  pack_qty numeric, is_new boolean, family text, list_price numeric, sort int);

insert into acha_import values
""")
        f.write(",\n".join(values))
        f.write(""";

do $$
declare m uuid := (select id from public.b2b_manufacturers where slug = 'acha-herramientas');
begin
  insert into public.b2b_families (manufacturer_id, name)
  select distinct m, family from acha_import
  on conflict (manufacturer_id, name) do nothing;

  insert into public.b2b_products (manufacturer_id, family_id, reference, ean, designation, description, image_url,
    sales_unit, pack_qty, moq, is_new, active, updated_at)
  select m, fam.id, a.reference, a.ean, a.designation, a.description, a.image_url, 'un', a.pack_qty, a.pack_qty, a.is_new, true, now()
  from acha_import a join public.b2b_families fam on fam.manufacturer_id = m and fam.name = a.family
  on conflict (manufacturer_id, reference) do update set
    ean = excluded.ean, designation = excluded.designation, description = excluded.description,
    image_url = excluded.image_url, pack_qty = excluded.pack_qty, moq = excluded.moq, is_new = excluded.is_new,
    family_id = excluded.family_id, active = true, updated_at = now();

  insert into public.b2b_prices (product_id, list_price)
  select p.id, a.list_price from acha_import a
  join public.b2b_products p on p.manufacturer_id = m and p.reference = a.reference
  on conflict (product_id) do update set list_price = excluded.list_price, updated_at = now();
end $$;

drop table acha_import;
""")
    print(f"{len(values)} artigos -> {out}")
    print(collections.Counter(fams).most_common())


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
