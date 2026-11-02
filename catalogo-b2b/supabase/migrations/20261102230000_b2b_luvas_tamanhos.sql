-- Luvas com tamanho (6 a 11): novo size_type 'luvas', aplicado a todas as luvas da JOMIBA.
-- A encomenda já exige o tamanho quando size_type não é nulo (b2b_place_order).
alter table public.b2b_products drop constraint if exists b2b_products_size_type_check;
alter table public.b2b_products add constraint b2b_products_size_type_check
  check (size_type in ('calcado', 'vestuario', 'luvas', 'medida'));

update public.b2b_products p
set size_type = 'luvas', updated_at = now()
from public.b2b_manufacturers m, public.b2b_families f
where m.id = p.manufacturer_id and m.slug = 'jomiba'
  and f.id = p.family_id
  and p.size_type is null
  and (f.name ilike 'luvas%' or p.designation ilike '%guante%' or p.designation ilike '%manopla%');
