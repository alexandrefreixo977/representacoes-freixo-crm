"""Gera as migrações do catálogo UNIOR Hand Tools e da campanha de preços netos para distribuidores.

Uso: python3 data/build_unior.py "TARIFA UNIOR 2026-27 V3.xlsx" "PRECIOS NETOS PROMOCION ESPECIAL DISTRIBUIDORES 2026-27.xlsx" \
       supabase/migrations/<data>_unior_catalogo.sql supabase/migrations/<data>_campanha_unior_2026.sql

Tarifa: Código/SKU, DESCRIPCION, P.V.P 2026, …, Codigo EAN, FAMILIA, Categoria, Categoria II, peso e medidas,
embalagens RP2/IP, Link Ficha Técnica, Link Fotografia Artículo. Preço de tabela = P.V.P 2026.
Campanha: as mesmas colunas com NETO PROMOCION DISTRIBUIDOR. Válida até 26/02/2027, só para revendedores com conta.
"""
import re
import sys

import openpyxl

SLUG = "unior"
CAMPAIGN_ID = "b1d0a1f0-2026-4f27-9e00-0000000b2027"
ENDS_ON = "2027-02-26"

# Categoria UNIOR (sem o número) -> família na loja
FAMILIES = {
    "Llaves": "Chaves", "Vasos y Accesorios": "Chaves de caixa e acessórios", "Alicates": "Alicates",
    "Herramienta Aislada VDE": "Ferramenta isolada VDE", "Fontanería": "Canalização", "Tijeras": "Tesouras e corta-cabos",
    "Destornilladores": "Chaves de fendas", "Extractores": "Extratores", "Martillos, punteros y Cortafríos": "Martelos, punções e escopros",
    "Mobiliario": "Mobiliário de oficina", "Mobiliario NEGRO": "Mobiliário de oficina (preto)", "Mobiliario Negro": "Mobiliário de oficina (preto)",
    "Neumática": "Ferramenta pneumática", "Medición": "Medição e binário", "Electrónica": "Eletrónica", "Automoción": "Automóvel",
    "Herramienta para Bicicleta": "Ferramenta para bicicleta", "Varios": "Diversos", "Juegos": "Jogos de ferramentas",
    "Marketing": "Expositores e marketing", "Material Publicitario": "Expositores e marketing",
    "Herramientas para Motos": "Ferramenta para motos", "Piezas de repuesto": "Peças de substituição", "Antichispa": "Ferramenta antichispa",
}


def family(cat) -> str:
    name = re.sub(r"^\s*\d+\.\s*", "", str(cat or "")).strip()
    return FAMILIES.get(name, name or "Outros")


def q(v) -> str:
    return "null" if v in (None, "") else "'" + str(v).replace("'", "''") + "'"


def num(v) -> str:
    return str(v).replace(".", ",") if v not in (None, "") else ""


def rows_of(path):
    ws = openpyxl.load_workbook(path, read_only=True).worksheets[0]
    head = None
    for r in ws.iter_rows(values_only=True):
        if head is None:
            if r and r[0] == "Código/SKU":
                head = [str(h or "").strip() for h in r]
            continue
        if r[0] is None:
            continue
        yield dict(zip(head, r))


def main(tarifa, promo, out_cat, out_camp):
    seen, values = set(), []
    for r in rows_of(tarifa):
        ref = str(r["Código/SKU"]).strip()
        price = r["P.V.P 2026"]
        if ref in seen or not isinstance(price, (int, float)):
            continue
        seen.add(ref)
        desc = " ".join(str(r["DESCRIPCION"]).split())
        parts = [x.strip() for x in desc.split("-", 2)]
        if len(parts) == 3 and parts[1] and parts[2]:
            desc = f"{parts[1]} · {parts[2]} · mod. {parts[0]}"  # "110/1-Llaves fija-6 x 7" -> "Llaves fija · 6 x 7 · mod. 110/1"
        details = []
        if r.get("Categoria II") and r["Categoria II"] != 0:
            details.append(f"Linha: {re.sub(r'^[0-9.]+ *', '', str(r['Categoria II'])).strip()}")
        dims = [num(r.get(k)) for k in ("Longitud del producto", "Ancho del producto", "Altura del producto")]
        if all(dims):
            details.append(f"Dimensões: {' x '.join(dims)} mm")
        if r.get("Peso del producto (g)"):
            details.append(f"Peso: {num(r['Peso del producto (g)'])} g")
        if r.get("HASTA FIN DE EXISTENCIA"):
            details.append("Até fim de existências")
        if r.get("Link Ficha Técnica"):
            details.append(f"Ficha técnica: {r['Link Ficha Técnica']}")
        details.append("Tarifa UNIOR 2026-27")
        values.append(f"({q(ref)},{q(r.get('Codigo EAN'))},{q(desc[:200])},{q('. '.join(details))},"
                      f"{q(r.get('Link Fotografia Artículo'))},{q(family(r.get('Categoria')))},{round(float(price), 2)})")

    with open(out_cat, "w", encoding="utf-8") as fh:
        fh.write(f"""-- Catálogo UNIOR Hand Tools (tarifa 2026-27, em vigor de 15/07/2026 a 26/02/2027, {len(values)} artigos).
-- Gerado por data/build_unior.py — não editar à mão. Preço de tabela = P.V.P 2026. Encomendas para unior@unior.es.

insert into public.b2b_manufacturers (name, slug, orders_email, sort, active)
values ('UNIOR', '{SLUG}', 'unior@unior.es', 260, true)
on conflict (slug) do update set orders_email = excluded.orders_email, active = true;

create temp table unior_import (reference text, ean text, designation text, description text, image_url text,
  family text, list_price numeric);

insert into unior_import values
{",\n".join(values)};

do $$
declare m uuid := (select id from public.b2b_manufacturers where slug = '{SLUG}');
begin
  insert into public.b2b_families (manufacturer_id, name)
  select distinct m, family from unior_import
  on conflict (manufacturer_id, name) do nothing;

  insert into public.b2b_products (manufacturer_id, family_id, reference, ean, designation, description, image_url,
    sales_unit, pack_qty, moq, is_new, active, updated_at)
  select m, fam.id, a.reference, a.ean, a.designation, a.description, a.image_url, 'un', 1, 1, false, true, now()
  from unior_import a join public.b2b_families fam on fam.manufacturer_id = m and fam.name = a.family
  on conflict (manufacturer_id, reference) do update set
    ean = excluded.ean, designation = excluded.designation, description = excluded.description,
    image_url = excluded.image_url, family_id = excluded.family_id, active = true, updated_at = now();

  insert into public.b2b_prices (product_id, list_price)
  select p.id, a.list_price from unior_import a
  join public.b2b_products p on p.manufacturer_id = m and p.reference = a.reference
  on conflict (product_id) do update set list_price = excluded.list_price, updated_at = now();
end $$;

drop table unior_import;
""")
    print(len(values), "artigos ->", out_cat)

    offer, done = [], set()
    for r in rows_of(promo):
        ref = str(r["Código/SKU"]).strip()
        net = r["NETO PROMOCION DISTRIBUIDOR"]
        if ref in done or not isinstance(net, (int, float)):
            continue
        if ref not in seen:
            raise SystemExit(f"Artigo da campanha fora da tarifa: {ref}")
        done.add(ref)
        offer.append(f"({q(ref)},{round(float(net), 2)})")

    with open(out_camp, "w", encoding="utf-8") as fh:
        fh.write(f"""-- Campanha UNIOR "Promoção especial distribuidores 2026-27" (preços netos, {len(offer)} artigos), válida até 26/02/2027.
-- Só para revendedores com conta (pedido do Alexandre, 31/10/2026). Gerado por data/build_unior.py — não editar à mão.

insert into public.b2b_campaigns (id, title, subtitle, badge, details, manufacturer_id, starts_on, ends_on, active, sort, members_only)
select {q(CAMPAIGN_ID)}, 'Promoção especial distribuidores 2026-27',
  'Preços netos em chaves, alicates, ferramenta isolada VDE, jogos, medição e mobiliário de oficina. Até 26 de fevereiro de 2027.',
  'Preço neto',
  'Preços netos por unidade para distribuidores, já aplicados no seu carrinho. Válidos até 26/02/2027.',
  m.id, '2026-10-31', {q(ENDS_ON)}, true, 20, true
from public.b2b_manufacturers m where m.slug = '{SLUG}'
on conflict (id) do update set title = excluded.title, subtitle = excluded.subtitle, badge = excluded.badge, details = excluded.details,
  starts_on = excluded.starts_on, ends_on = excluded.ends_on, members_only = true;

create temp table unior_offer (reference text, net_price numeric);
insert into unior_offer values
{",\n".join(offer)};

do $$
declare m uuid := (select id from public.b2b_manufacturers where slug = '{SLUG}');
begin
  delete from public.b2b_discount_rules where campaign_id = {q(CAMPAIGN_ID)};
  insert into public.b2b_discount_rules (client_id, manufacturer_id, product_id, discounts, special_net_price, active, valid_until, campaign_id)
  select null, m, p.id, '{{}}', o.net_price, true, {q(ENDS_ON)}, {q(CAMPAIGN_ID)}
  from unior_offer o join public.b2b_products p on p.manufacturer_id = m and p.reference = o.reference;

  if (select count(*) from public.b2b_discount_rules where campaign_id = {q(CAMPAIGN_ID)}) <> (select count(*) from unior_offer) then
    raise exception 'Campanha UNIOR: há artigos da oferta que não foram encontrados';
  end if;
end $$;

drop table unior_offer;
""")
    print(len(offer), "preços de campanha ->", out_camp)


if __name__ == "__main__":
    main(*sys.argv[1:5])
