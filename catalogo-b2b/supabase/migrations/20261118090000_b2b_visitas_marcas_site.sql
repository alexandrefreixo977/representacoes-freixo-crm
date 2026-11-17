-- As marcas mais visitadas passam a contar o site WordPress (páginas /marcas-representadas/<marca>/) e a loja B2B.
create or replace function public.b2b_visit_stats(p_days int default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  with v as (
    select * from b2b_visits
     where not staff and day > (now() at time zone 'Europe/Lisbon')::date - least(greatest(p_days, 1), 366)
  ),
  site_tot as (
    select site, count(distinct visitor) as visitantes, count(*) as paginas,
           count(distinct visitor) filter (where day > (now() at time zone 'Europe/Lisbon')::date - 7) as visitantes_7d,
           count(distinct client_id) as clientes_com_sessao
      from v group by site
  ),
  per_day as (
    select site, day, count(distinct visitor) as visitantes from v group by site, day
  ),
  brands as (
    select coalesce(m.name, v.brand_slug) as marca, count(distinct v.visitor) as visitantes, count(*) as paginas
      from v left join b2b_manufacturers m on m.slug = v.brand_slug
     where v.brand_slug is not null
     group by 1 order by 2 desc, 3 desc limit 10
  )
  select jsonb_build_object(
    'dias', least(greatest(p_days, 1), 366),
    'desde', (select min(day) from b2b_visits),
    'sites', coalesce((select jsonb_object_agg(site, jsonb_build_object('visitantes', visitantes, 'paginas', paginas,
                'visitantes_7d', visitantes_7d, 'clientes_com_sessao', clientes_com_sessao)) from site_tot), '{}'::jsonb),
    'por_dia', coalesce((select jsonb_agg(jsonb_build_object('site', site, 'dia', day, 'visitantes', visitantes) order by day) from per_day), '[]'::jsonb),
    'marcas', coalesce((select jsonb_agg(jsonb_build_object('marca', marca, 'visitantes', visitantes, 'paginas', paginas)) from brands), '[]'::jsonb)
  );
$$;
revoke all on function public.b2b_visit_stats(int) from public, anon, authenticated;
grant execute on function public.b2b_visit_stats(int) to service_role;
