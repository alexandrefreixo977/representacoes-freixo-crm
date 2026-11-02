-- Additive; no existing commercial records are modified. Apply after validation.
alter table public.clients add column if not exists route_location jsonb;
alter table public.clients add column if not exists visit_frequency_days integer check (visit_frequency_days between 1 and 3650);

create table public.route_plans (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id),
 week_start date not null,
 timezone text not null default 'Europe/Lisbon',
 settings jsonb not null default '{}'::jsonb,
 revision integer not null default 1,
 created_by uuid not null default auth.uid() references public.profiles(id),
 updated_by uuid not null default auth.uid() references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(owner_id,week_start),
 check(extract(isodow from week_start)=1)
);
create table public.route_stops (
 id uuid primary key default gen_random_uuid(),
 plan_id uuid not null references public.route_plans(id),
 client_id uuid not null references public.clients(id),
 contact_id uuid references public.client_contacts(id),
 opportunity_id uuid references public.opportunities(id),
 activity_id uuid unique references public.activities(id),
 day date not null,
 position integer not null default 0 check(position>=0),
 starts_at timestamptz,
 duration_minutes integer not null default 45 check(duration_minutes between 5 and 480),
 state text not null default 'planned' check(state in ('suggested','planned','contact','confirmed','completed','rescheduled','cancelled','not_done')),
 locked boolean not null default false,
 reason text not null default '',
 result text not null default '',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(state not in ('confirmed','completed') or starts_at is not null),
 check(state<>'completed' or length(trim(result))>0)
);
create index route_stops_plan_day on public.route_stops(plan_id,day,position);
create table public.route_revisions (
 id bigint generated always as identity primary key,
 plan_id uuid not null references public.route_plans(id),
 actor_id uuid not null default auth.uid() references public.profiles(id),
 action text not null,
 snapshot jsonb not null,
 created_at timestamptz not null default now()
);
create index route_revisions_plan on public.route_revisions(plan_id,created_at desc);
alter table public.route_plans enable row level security;
alter table public.route_stops enable row level security;
alter table public.route_revisions enable row level security;
create policy route_plan_access on public.route_plans for all to authenticated
 using(owner_id=auth.uid() or exists(select 1 from public.profiles where id=auth.uid() and role='admin' and active))
 with check((owner_id=auth.uid() or exists(select 1 from public.profiles where id=auth.uid() and role='admin' and active)) and exists(select 1 from public.profiles where id=owner_id and active));
create policy route_stop_access on public.route_stops for all to authenticated
 using(exists(select 1 from public.route_plans p where p.id=plan_id))
 with check(exists(select 1 from public.route_plans p join public.clients c on c.id=client_id and c.owner_id=p.owner_id where p.id=plan_id and c.archived_at is null));
create policy route_revision_read on public.route_revisions for select to authenticated using(exists(select 1 from public.route_plans p where p.id=plan_id));
create policy route_revision_insert on public.route_revisions for insert to authenticated with check(actor_id=auth.uid() and exists(select 1 from public.route_plans p where p.id=plan_id));
grant select,insert,update on public.route_plans,public.route_stops to authenticated;
grant select,insert on public.route_revisions to authenticated;
grant usage on sequence public.route_revisions_id_seq to authenticated;

create function public.route_plan_guard() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if tg_op='UPDATE' then
  if new.owner_id<>old.owner_id or new.week_start<>old.week_start then raise exception 'O comercial e a semana do plano não podem ser alterados.'; end if;
  new.revision:=old.revision+1;
  insert into public.route_revisions(plan_id,action,snapshot) values(old.id,'plan_updated',to_jsonb(old));
 end if;
 if not exists(select 1 from pg_timezone_names where name=new.timezone) then raise exception 'Fuso horário inválido.'; end if;
 new.updated_by:=auth.uid(); new.updated_at:=now(); return new;
end $$;
create trigger route_plan_guard before insert or update on public.route_plans for each row execute function public.route_plan_guard();

create function public.route_stop_sync() returns trigger language plpgsql security invoker set search_path=public as $$
declare p public.route_plans; a public.activities; activity_status text;
begin
 select * into strict p from public.route_plans where id=new.plan_id for update;
 if tg_op='INSERT' then select coalesce(max(position)+1,0) into new.position from public.route_stops where plan_id=p.id and day=new.day; end if;
 if new.day<p.week_start or new.day>p.week_start+6 then raise exception 'A visita deve pertencer à semana do plano.'; end if;
 if new.starts_at is not null and (new.starts_at at time zone p.timezone)::date<>new.day then raise exception 'Data e hora incompatíveis.'; end if;
 if new.contact_id is not null and not exists(select 1 from public.client_contacts where id=new.contact_id and client_id=new.client_id) then raise exception 'Contacto incompatível.'; end if;
 if new.opportunity_id is not null and not exists(select 1 from public.opportunities where id=new.opportunity_id and client_id=new.client_id and seller_id=p.owner_id) then raise exception 'Oportunidade incompatível.'; end if;
 if tg_op='UPDATE' then
  if new.plan_id<>old.plan_id or new.client_id<>old.client_id or new.activity_id is distinct from old.activity_id then raise exception 'Não pode trocar a ligação original da visita.'; end if;
  if old.state='completed' and new is distinct from old then raise exception 'Visita realizada: mantenha o histórico original.'; end if;
  if old.activity_id is not null and new.state in ('suggested','planned','contact') then raise exception 'Reagende ou cancele a visita já confirmada.'; end if;
  insert into public.route_revisions(plan_id,action,snapshot) values(p.id,'stop_updated',to_jsonb(old));
 end if;
 if new.activity_id is not null then
  select * into strict a from public.activities where id=new.activity_id for update;
  if a.client_id<>new.client_id or coalesce(a.assigned_to,a.actor_id)<>p.owner_id or a.kind::text<>'visit' then raise exception 'Visita original incompatível.'; end if;
  -- Linking an existing appointment never silently reschedules it.
  if tg_op='INSERT' and (a.start_at is distinct from new.starts_at or new.state<>'confirmed') then raise exception 'Preserve a data e hora do compromisso original.'; end if;
 end if;
 activity_status:=case new.state when 'completed' then 'completed' when 'cancelled' then 'cancelled' when 'not_done' then 'cancelled' else 'scheduled' end;
 if new.state in ('confirmed','completed','rescheduled','cancelled','not_done') and (new.state='confirmed' or new.activity_id is not null) then
  if new.starts_at is null then raise exception 'Indique uma hora para a visita confirmada.'; end if;
  if new.activity_id is null then
   insert into public.activities(client_id,contact_id,opportunity_id,kind,interaction_type,title,summary,description,actor_id,assigned_to,start_at,end_at,occurred_at,due_date,has_time,schedule_timezone,status,source_module,result)
   values(new.client_id,new.contact_id,new.opportunity_id,'visit','Visita','Visita comercial',new.reason,new.reason,auth.uid(),p.owner_id,new.starts_at,new.starts_at+make_interval(mins=>new.duration_minutes),new.starts_at,new.day,true,p.timezone,activity_status,'visits',new.result) returning id into new.activity_id;
  else
   update public.activities set start_at=new.starts_at,end_at=new.starts_at+make_interval(mins=>new.duration_minutes),occurred_at=new.starts_at,due_date=new.day,has_time=true,schedule_timezone=p.timezone,status=activity_status,result=new.result,description=new.reason,updated_at=now(),completed_at=case when new.state='completed' then now() else null end,completed_by=case when new.state='completed' then auth.uid() else null end where id=new.activity_id;
  end if;
 end if;
 update public.route_plans set updated_at=now() where id=p.id;
 new.updated_at:=now(); return new;
end $$;
create trigger route_stop_sync before insert or update on public.route_stops for each row execute function public.route_stop_sync();

create function public.route_apply_order(p_plan uuid,p_revision integer,p_stops jsonb) returns void language plpgsql security invoker set search_path=public as $$
declare p public.route_plans; s jsonb; original public.route_stops;
begin
 select * into strict p from public.route_plans where id=p_plan for update;
 if p.revision<>p_revision then raise exception 'O plano mudou noutro dispositivo. Atualize antes de aplicar.'; end if;
 if jsonb_array_length(p_stops)>100 then raise exception 'Demasiadas paragens.'; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_stops))<>jsonb_array_length(p_stops) then raise exception 'Paragens duplicadas.'; end if;
 for s in select * from jsonb_array_elements(p_stops) loop
  select * into strict original from public.route_stops where id=(s->>'id')::uuid and plan_id=p_plan for update;
  if original.locked or original.state in ('confirmed','completed') then
   if original.day<>(s->>'day')::date or original.starts_at is distinct from (s->>'starts_at')::timestamptz or (original.locked and original.position<>(s->>'position')::integer) then raise exception 'Compromisso ou posição fixada não pode ser alterado pela otimização.'; end if;
  end if;
  if original.state<>'completed' then update public.route_stops set day=(s->>'day')::date,starts_at=(s->>'starts_at')::timestamptz,position=(s->>'position')::integer where id=original.id; end if;
 end loop;
 update public.route_plans set updated_at=now() where id=p.id;
end $$;
revoke all on function public.route_apply_order(uuid,integer,jsonb) from public,anon;
grant execute on function public.route_apply_order(uuid,integer,jsonb) to authenticated;
