"""Gera a migração da campanha ACHA "Oferta Outono-Inverno 2026" (preços netos).

Uso: python3 data/build_acha_oferta.py data/acha/oferta_outono_inverno_2026.txt supabase/migrations/<data>_campanha_acha_outono_2026.sql

Cada linha do .txt (REF | UDS. | preço neto | nota) vira uma regra geral por artigo com preço líquido especial,
ligada à campanha e válida até ao fim da promoção. Artigos que não estão na tarifa ACHA 2025 são criados aqui.
"""
import sys

CAMPAIGN_ID = "a0c4a2f6-2026-4f10-9d2a-0000000a2026"
ENDS_ON = "2027-01-31"

# Artigos da oferta que não existem na tarifa 2025: (designação, família, preço de tabela, imagem)
NEW = {
    "54340EIN": ("Adaptador bateria EINHELL para nível laser 18VMAX", "Níveis e prumos", 12.60, None),
    "54340AEG": ("Adaptador bateria AEG para nível laser 18VMAX", "Níveis e prumos", 12.60, None),
    "54340HIL": ("Adaptador bateria HILTI para nível laser 18VMAX", "Níveis e prumos", 12.60, None),
    "54340FLE": ("Adaptador bateria FLEX para nível laser 18VMAX", "Níveis e prumos", 12.60, None),
    "70018": ("Nível laser vermelho rotativo Spinner com recetor, mira e tripé", "Níveis e prumos", None, None),
    "70025": ("Nível laser vermelho rotativo PARA-DS com recetor", "Níveis e prumos", None, None),
    "XP540": ("Expositor nível laser verde 3D multibateria 18VMAX (6 níveis + 6 adaptadores grátis)", "Níveis e prumos", None,
              "https://www.acha.com/images/catalogo/5242967290244740.jpg"),
    "XP542": ("Expositor misto de nivelação (níveis laser, medidores e endoscópios)", "Níveis e prumos", None, None),
}


def q(v) -> str:
    return "null" if v in (None, "") else "'" + str(v).replace("'", "''") + "'"


def parse(path):
    items = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        ref, uds, net, *rest = [p.strip() for p in line.split("|")]
        items.append((ref, int(uds), float(net.replace(",", ".")), (rest[0] if rest else "")))
    return items


def main(src, out):
    items = parse(src)
    notes = {}
    last = ""
    for ref, _u, _n, note in items:
        if note == "idem":
            note = last
        if note:
            notes[ref] = note
            last = note
    new_rows = []
    for ref, (des, fam, list_price, img) in NEW.items():
        net = next(n for r, _u, n, _x in items if r == ref)
        desc = notes.get(ref, des) + ". Oferta ACHA Outono-Inverno 2026."
        new_rows.append(f"({q(ref)},{q(des)},{q(desc)},{q(fam)},{q(img)},{list_price if list_price else net})")
    offer = ",\n".join(f"({q(r)},{u},{n},{q(notes.get(r) if r not in NEW else None)})" for r, u, n, _x in items)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(f"""-- Campanha ACHA "Oferta Outono-Inverno 2026" (preços netos, {len(items)} artigos), válida de 01/10/2026 a 31/01/2027.
-- Pedido do Alexandre (31/10/2026): só visível para revendedores com conta. Gerado por data/build_acha_oferta.py — não editar à mão.

-- Campanhas só para clientes registados (visitantes não as veem).
alter table public.b2b_campaigns add column if not exists members_only boolean not null default true;
alter table public.b2b_campaigns add column if not exists details text;
drop policy if exists b2b_camp_read on public.b2b_campaigns;
create policy b2b_camp_read on public.b2b_campaigns for select using (
  (active and (starts_on is null or starts_on <= current_date) and (ends_on is null or ends_on >= current_date)
   and (not members_only or b2b_my_client() is not null or b2b_is_staff()))
  or b2b_is_admin());

-- Preços de campanha: regras por artigo ligadas à campanha (apagar a campanha apaga os preços).
alter table public.b2b_discount_rules add column if not exists campaign_id uuid references public.b2b_campaigns(id) on delete cascade;
alter table public.b2b_discount_rules add column if not exists offer_qty numeric;
create index if not exists b2b_rules_campaign on public.b2b_discount_rules (campaign_id);

insert into public.b2b_campaigns (id, title, subtitle, badge, details, manufacturer_id, starts_on, ends_on, active, sort, members_only)
select {q(CAMPAIGN_ID)}, 'Oferta Outono-Inverno 2026',
  'Preços netos em nivelação laser, flexómetros, marcação, metrologia e medição eletrónica. Até 31 de janeiro de 2027.',
  'Preço neto',
  'Preços netos por unidade, já aplicados no seu carrinho. A coluna "Oferta" indica a quantidade de referência da ACHA para cada artigo. Expositores com condições próprias (ver descrição de cada um). Tubos de tinta indelével: 2,40 €/un a partir de 50 un.; 2,35 € a partir de 100; 2,30 € a partir de 200; 2,25 € a partir de 400 (caixas da mesma referência).',
  m.id, '2026-10-01', {q(ENDS_ON)}, true, 10, true
from public.b2b_manufacturers m where m.slug = 'acha-herramientas'
on conflict (id) do update set title = excluded.title, subtitle = excluded.subtitle, badge = excluded.badge, details = excluded.details,
  starts_on = excluded.starts_on, ends_on = excluded.ends_on, members_only = true;

create temp table acha_new (reference text, designation text, description text, family text, image_url text, list_price numeric);
insert into acha_new values
{",\n".join(new_rows)};

create temp table acha_offer (reference text, offer_qty numeric, net_price numeric, note text);
insert into acha_offer values
{offer};

do $$
declare m uuid := (select id from public.b2b_manufacturers where slug = 'acha-herramientas');
begin
  insert into public.b2b_families (manufacturer_id, name) select distinct m, family from acha_new
  on conflict (manufacturer_id, name) do nothing;

  insert into public.b2b_products (manufacturer_id, family_id, reference, designation, description, image_url,
    sales_unit, pack_qty, moq, is_new, active, updated_at)
  select m, fam.id, a.reference, a.designation, a.description, a.image_url, 'un', 1, 1, true, true, now()
  from acha_new a join public.b2b_families fam on fam.manufacturer_id = m and fam.name = a.family
  on conflict (manufacturer_id, reference) do nothing;

  insert into public.b2b_prices (product_id, list_price)
  select p.id, a.list_price from acha_new a join public.b2b_products p on p.manufacturer_id = m and p.reference = a.reference
  on conflict (product_id) do nothing;

  -- Expositores: a composição fica na descrição do artigo.
  update public.b2b_products p set description = o.note || '. ' || coalesce(p.description, '')
  from acha_offer o where p.manufacturer_id = m and p.reference = o.reference and o.note is not null
    and (o.reference like 'XP%' or o.reference = '45130') and position(o.note in coalesce(p.description, '')) = 0;

  delete from public.b2b_discount_rules where campaign_id = {q(CAMPAIGN_ID)};
  insert into public.b2b_discount_rules (client_id, manufacturer_id, product_id, discounts, special_net_price, active, valid_until, campaign_id, offer_qty)
  select null, m, p.id, '{{}}', o.net_price, true, {q(ENDS_ON)}, {q(CAMPAIGN_ID)}, o.offer_qty
  from acha_offer o join public.b2b_products p on p.manufacturer_id = m and p.reference = o.reference;

  if (select count(*) from public.b2b_discount_rules where campaign_id = {q(CAMPAIGN_ID)}) <> (select count(*) from acha_offer) then
    raise exception 'Campanha ACHA: há artigos da oferta que não foram encontrados';
  end if;
end $$;

drop table acha_new;
drop table acha_offer;
""")
    print(len(items), "artigos ->", out)


if __name__ == "__main__":
    main(*sys.argv[1:3])
