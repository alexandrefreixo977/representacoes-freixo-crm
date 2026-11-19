"""Gera as migrações do catálogo DOGHER TOOLS e da campanha PROMO2026.

Uso: python3 data/build_dogher.py data/dogher/tabela_2025_26.tsv data/dogher/promo2026.tsv \
       supabase/migrations/<data>_dogher_catalogo.sql supabase/migrations/<data>_campanha_dogher_promo2026.sql

- tabela_2025_26.tsv sai do Catálogo Geral DOGHER TOOLS 2025-26 (PDF de 690 páginas) com data/dogher/export.py
  (ver data/dogher/LEIA-ME.txt). Preço de tabela = preço do catálogo (preço recomendado, sem IVA).
  "cx" = o catálogo dá o preço por embalagem (coluna "€ / N"), a embalagem é a unidade de venda.
- promo2026.tsv sai do folheto PROMO2026 (PT) com data/dogher/promo.py: cada preço riscado foi conferido com o
  preço de tabela do catálogo. Os artigos que não estão no catálogo (designação preenchida) são criados aqui.
- Grupo "Equipamentos e consumíveis industriais" (separador Indústria): sort 240, o lugar guardado para a Dogher.
"""
import collections
import sys

CAMPAIGN_ID = "d0c4e2a0-2026-4f26-9d00-0000000d2026"
STARTS_ON, ENDS_ON = "2026-11-19", "2026-12-31"


def q(v) -> str:
    return "null" if v in (None, "") else "'" + str(v).replace("'", "''") + "'"


def read_tsv(path):
    for line in open(path, encoding="utf-8"):
        if line.startswith("#") or not line.strip():
            continue
        yield line.rstrip("\n").split("\t")


def catalog_sql(items) -> str:
    values = ",\n".join(f"({q(r)},{q(d)},{q(x)},{q(f)},{q(u)},{p},{pr},{q(img)})"
                        for r, f, d, x, u, p, pr, img in items)
    return f"""-- Catálogo DOGHER TOOLS (Catálogo Geral 2025-26, PT; {len(items)} artigos, fotos tiradas do próprio catálogo).
-- Gerado por data/build_dogher.py — não editar à mão. Preço de tabela = preço do catálogo (sem IVA).
-- Grupo Equipamentos e consumíveis industriais (sort 240). Encomendas para export@dogher.com (Export Sales Office,
-- o endereço que confirma as encomendas dos clientes portugueses).

insert into public.b2b_manufacturers (name, slug, orders_email, sort, active, legal_name, address, country, phone, website)
values ('DOGHER TOOLS', 'dogher', 'export@dogher.com', 240, true, 'DOGHER TOOLS, S.A.',
  'Polígono Industrial Arriandi, Tabernabarri Nº5, 48215 Iurreta (Vizcaya)', 'Espanha', '+34 946 216 145', 'www.dogher.com')
on conflict (slug) do update set orders_email = excluded.orders_email, sort = excluded.sort, active = true,
  name = excluded.name,
  legal_name = coalesce(public.b2b_manufacturers.legal_name, excluded.legal_name),
  address = coalesce(public.b2b_manufacturers.address, excluded.address),
  country = coalesce(public.b2b_manufacturers.country, excluded.country),
  phone = coalesce(public.b2b_manufacturers.phone, excluded.phone),
  website = coalesce(public.b2b_manufacturers.website, excluded.website);

create temp table dogher_import (reference text, designation text, description text, family text,
  sales_unit text, pack_qty numeric, list_price numeric, image_url text);

insert into dogher_import values
{values};

do $$
declare m uuid := (select id from public.b2b_manufacturers where slug = 'dogher');
begin
  insert into public.b2b_families (manufacturer_id, name)
  select distinct m, family from dogher_import
  on conflict (manufacturer_id, name) do nothing;

  insert into public.b2b_products (manufacturer_id, family_id, reference, designation, description, image_url,
    sales_unit, pack_qty, moq, is_new, active, updated_at)
  select m, fam.id, a.reference, a.designation, a.description, a.image_url, a.sales_unit, a.pack_qty, 1, false, true, now()
  from dogher_import a join public.b2b_families fam on fam.manufacturer_id = m and fam.name = a.family
  on conflict (manufacturer_id, reference) do update set
    designation = excluded.designation, description = excluded.description, sales_unit = excluded.sales_unit,
    pack_qty = excluded.pack_qty, family_id = excluded.family_id, active = true, updated_at = now(),
    image_url = coalesce(public.b2b_products.image_url, excluded.image_url);

  insert into public.b2b_prices (product_id, list_price)
  select p.id, a.list_price from dogher_import a
  join public.b2b_products p on p.manufacturer_id = m and p.reference = a.reference
  on conflict (product_id) do update set list_price = excluded.list_price, updated_at = now();
end $$;

drop table dogher_import;
"""


def campaign_sql(promo, known) -> str:
    new = [(r, pvp, des) for r, pvp, _n, _p, des in promo if des]
    missing = [r for r, *_x, des in promo if not des and r not in known]
    if missing:
        raise SystemExit(f"Artigos da promoção sem artigo no catálogo nem designação: {missing}")
    new_rows = ",\n".join(f"({q(r)},{q(des)},{q(des + '. Artigo do folheto PROMO2026 DOGHER TOOLS.')},{pvp})"
                          for r, pvp, des in new)
    offer = ",\n".join(f"({q(r)},{n})" for r, _pvp, n, _p, _d in promo)
    return f"""-- Campanha DOGHER TOOLS "PROMO 2026" (preços líquidos de campanha, {len(promo)} artigos), só para revendedores com conta.
-- Pedido do Alexandre (19/11/2026). Gerado por data/build_dogher.py — não editar à mão.
-- O folheto não traz datas: fica de {STARTS_ON} a {ENDS_ON} (muda-se em Gestão › Campanhas).

insert into public.b2b_campaigns (id, title, subtitle, badge, details, manufacturer_id, starts_on, ends_on, active, sort, members_only)
select {q(CAMPAIGN_ID)}, 'DOGHER TOOLS · Promoção 2026',
  'Preços líquidos em armazenagem, carros e malas com ferramenta, chaves, alicates, percussão e ferramenta variada.',
  'Preço líquido',
  'Preços líquidos por unidade, sem IVA, já aplicados no seu carrinho. O preço riscado é o preço de tabela do catálogo DOGHER TOOLS 2025-26. Portes pagos pela Dogher em encomendas a partir de 200 € líquidos; encomenda mínima 40 € líquidos.',
  m.id, {q(STARTS_ON)}, {q(ENDS_ON)}, true, 20, true
from public.b2b_manufacturers m where m.slug = 'dogher'
on conflict (id) do update set title = excluded.title, subtitle = excluded.subtitle, badge = excluded.badge, details = excluded.details,
  starts_on = excluded.starts_on, ends_on = excluded.ends_on, members_only = true;

create temp table dogher_new (reference text, designation text, description text, list_price numeric);
insert into dogher_new values
{new_rows};

create temp table dogher_offer (reference text, net_price numeric);
insert into dogher_offer values
{offer};

do $$
declare m uuid := (select id from public.b2b_manufacturers where slug = 'dogher');
begin
  insert into public.b2b_families (manufacturer_id, name) values (m, 'Promoção 2026 · Malas e carros com ferramenta')
  on conflict (manufacturer_id, name) do nothing;
  insert into public.b2b_products (manufacturer_id, family_id, reference, designation, description,
    sales_unit, pack_qty, moq, is_new, active, updated_at)
  select m, fam.id, a.reference, a.designation, a.description, 'un', 1, 1, true, true, now()
  from dogher_new a join public.b2b_families fam on fam.manufacturer_id = m and fam.name = 'Promoção 2026 · Malas e carros com ferramenta'
  on conflict (manufacturer_id, reference) do nothing;
  insert into public.b2b_prices (product_id, list_price)
  select p.id, a.list_price from dogher_new a join public.b2b_products p on p.manufacturer_id = m and p.reference = a.reference
  on conflict (product_id) do nothing;

  delete from public.b2b_discount_rules where campaign_id = {q(CAMPAIGN_ID)};
  insert into public.b2b_discount_rules (client_id, manufacturer_id, product_id, discounts, special_net_price, active, valid_until, campaign_id)
  select null, m, p.id, '{{}}', o.net_price, true, {q(ENDS_ON)}, {q(CAMPAIGN_ID)}
  from dogher_offer o join public.b2b_products p on p.manufacturer_id = m and p.reference = o.reference;
  if (select count(*) from public.b2b_discount_rules where campaign_id = {q(CAMPAIGN_ID)}) <> (select count(*) from dogher_offer) then
    raise exception 'Campanha DOGHER: há artigos da promoção que não foram encontrados';
  end if;
end $$;

drop table dogher_new;
drop table dogher_offer;
"""


def main(tabela, promo_tsv, out_cat, out_camp):
    items, seen = [], set()
    for r, f, d, x, u, p, pr, img in read_tsv(tabela):
        if r in seen:
            continue
        seen.add(r)
        items.append((r, f, d, x, u, int(p), float(pr), img))
    promo = [(r, float(pvp), float(n), int(p), des) for r, pvp, n, p, des in read_tsv(promo_tsv)]
    open(out_cat, "w", encoding="utf-8").write(catalog_sql(items))
    open(out_camp, "w", encoding="utf-8").write(campaign_sql(promo, seen))
    print(f"{len(items)} artigos -> {out_cat}; {len(promo)} preços de campanha -> {out_camp}")
    print(len(collections.Counter(i[1] for i in items)), "famílias;", sum(1 for i in items if i[7]), "com foto")


if __name__ == "__main__":
    main(*sys.argv[1:5])
