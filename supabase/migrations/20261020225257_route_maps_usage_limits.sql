-- Server-only, atomic reservations. Failed provider calls still consume the budget.
create table public.route_maps_usage (
 id bigint generated always as identity primary key,
 action text not null check (action in ('matrix','route','geocode')),
 units integer not null check (units > 0 and units <= 400),
 created_at timestamptz not null default now()
);
create index route_maps_usage_window_idx on public.route_maps_usage(action, created_at);
alter table public.route_maps_usage enable row level security;
revoke all on public.route_maps_usage from public, anon, authenticated;
grant select, insert on public.route_maps_usage to service_role;
grant usage on sequence public.route_maps_usage_id_seq to service_role;

create function public.route_reserve_maps_usage(p_action text, p_units integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
 v_month_limit integer;
 v_day_limit integer;
 v_month_used bigint;
 v_day_used bigint;
begin
 if p_action is null or p_action not in ('matrix','route','geocode')
   or p_units is null or p_units < 1 or p_units > 400
   or (p_action <> 'matrix' and p_units <> 1) then
   raise exception 'Invalid maps reservation';
 end if;
 v_month_limit := case when p_action='matrix' then 8000 else 1000 end;
 v_day_limit := case when p_action='matrix' then 800 else 100 end;
 -- Serializes reservations across workers and users, before the external request.
 perform pg_catalog.pg_advisory_xact_lock(20261020, 752);
 select coalesce(sum(units),0),
   coalesce(sum(units) filter (where created_at >= now()-interval '24 hours'),0)
 into v_month_used,v_day_used from public.route_maps_usage
 where action=p_action and created_at >= now()-interval '31 days';
 if v_month_used+p_units > v_month_limit or v_day_used+p_units > v_day_limit then
   return false;
 end if;
 insert into public.route_maps_usage(action,units) values(p_action,p_units);
 return true;
end $$;
revoke all on function public.route_reserve_maps_usage(text,integer) from public,anon,authenticated;
grant execute on function public.route_reserve_maps_usage(text,integer) to service_role;
