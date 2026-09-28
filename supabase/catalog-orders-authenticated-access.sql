begin;

create or replace function public.has_catalog_orders_beta_access()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.crm_feature_flags f
    join public.profiles p on p.id=auth.uid()
    where f.key='catalog_orders_beta'
      and f.enabled=true
      and p.active=true
  )
$$;

commit;

