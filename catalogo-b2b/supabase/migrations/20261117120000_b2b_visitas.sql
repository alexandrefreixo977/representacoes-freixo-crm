-- Visitas ao site institucional e à loja B2B, e marcas mais vistas (17/11/2026).
-- Sem cookies nem IP: cada browser tem um identificador aleatório (localStorage).
-- Conta-se uma visita por visitante, página e dia. A equipa (gestão/comercial) fica marcada e não entra nas contas.
create table if not exists public.b2b_visits (
  id bigint generated always as identity primary key,
  site text not null check (site in ('b2b', 'site')),
  day date not null default (now() at time zone 'Europe/Lisbon')::date,
  visitor text not null,
  page text not null default '',
  brand_slug text,
  client_id uuid references public.b2b_clients(id) on delete set null,
  staff boolean not null default false,
  created_at timestamptz not null default now(),
  unique (site, day, visitor, page)
);
create index if not exists b2b_visits_day on public.b2b_visits (day, site);
alter table public.b2b_visits enable row level security; -- sem políticas: só pelas funções abaixo

create or replace function public.b2b_track_visit(p_site text, p_visitor text, p_page text default '', p_brand text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_staff boolean := false;
begin
  if p_site not in ('b2b', 'site') or p_visitor !~ '^[A-Za-z0-9_-]{8,40}$' then return; end if;
  if auth.uid() is not null then
    select exists(select 1 from b2b_users where user_id = auth.uid() and role in ('admin', 'comercial')) into v_staff;
  end if;
  insert into b2b_visits (site, visitor, page, brand_slug, client_id, staff)
  values (p_site, p_visitor, left(coalesce(p_page, ''), 200),
          nullif(left(regexp_replace(coalesce(p_brand, ''), '[^a-z0-9-]', '', 'g'), 60), ''),
          case when auth.uid() is not null then b2b_my_client() end, v_staff)
  on conflict (site, day, visitor, page) do nothing;
end; $$;
revoke all on function public.b2b_track_visit(text, text, text, text) from public;
grant execute on function public.b2b_track_visit(text, text, text, text) to anon, authenticated;

-- Resumo para o dashboard do CRM (só com a chave de serviço).
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
     where v.site = 'b2b' and v.brand_slug is not null
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
