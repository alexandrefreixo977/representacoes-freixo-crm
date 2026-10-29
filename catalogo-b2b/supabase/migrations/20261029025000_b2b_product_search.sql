-- Pesquisa de artigos no servidor (os catálogos dos fabricantes têm dezenas de milhares de artigos).
-- search_text: referência + designação + EAN em minúsculas e sem acentos, para pesquisar "flexometro" e achar "Flexómetro".
-- ref_norm: referência sem espaços, pontos, hífenes, sublinhados ou barras (igual a normRef() na app).

alter table public.b2b_products
  add column if not exists search_text text generated always as (
    translate(lower(reference || ' ' || designation || ' ' || coalesce(ean, '')),
      'áàâãäåéèêëíìîïóòôõöúùûüçñ', 'aaaaaaeeeeiiiiooooouuuucn')
  ) stored,
  add column if not exists ref_norm text generated always as (
    upper(regexp_replace(reference, '[\s.\-_/]', '', 'g'))
  ) stored;

create extension if not exists pg_trgm with schema extensions;
create index if not exists b2b_products_search_trgm on public.b2b_products using gin (search_text extensions.gin_trgm_ops);
create index if not exists b2b_products_ref_norm on public.b2b_products (ref_norm);
create index if not exists b2b_products_ean on public.b2b_products (ean);
create index if not exists b2b_products_listing on public.b2b_products (manufacturer_id, family_id, designation);
create index if not exists b2b_products_designation on public.b2b_products (designation, id);
