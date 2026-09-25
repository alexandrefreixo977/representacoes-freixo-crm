-- Agenda global e centralizada do CRM
alter table public.activities add column if not exists title text;
alter table public.activities add column if not exists description text;
alter table public.activities add column if not exists interaction_type text;
alter table public.activities add column if not exists contact_id uuid references public.client_contacts(id);
alter table public.activities add column if not exists manufacturer_id uuid references public.manufacturers(id);
alter table public.activities add column if not exists assigned_to uuid references public.profiles(id);
alter table public.activities add column if not exists start_at timestamptz;
alter table public.activities add column if not exists end_at timestamptz;
alter table public.activities add column if not exists status text not null default 'scheduled';
alter table public.activities add column if not exists source_module text not null default 'client';
alter table public.activities add column if not exists source_record_id uuid;
alter table public.activities add column if not exists updated_at timestamptz not null default now();

update public.activities
set title=coalesce(title,summary), assigned_to=coalesce(assigned_to,actor_id),
    start_at=coalesce(start_at,occurred_at), interaction_type=coalesce(interaction_type,initcap(kind::text))
where title is null or assigned_to is null or start_at is null;

create unique index if not exists activities_source_unique
  on public.activities(source_module,source_record_id) where source_record_id is not null;
create index if not exists activities_agenda_start_idx on public.activities(start_at);
create index if not exists activities_assigned_idx on public.activities(assigned_to,start_at);

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='activities') then
    alter publication supabase_realtime add table public.activities;
  end if;
end $$;

drop policy if exists "activities global read" on public.activities;
create policy "activities global read" on public.activities for select
using (auth.uid() is not null and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active=true));

drop policy if exists "profiles team read" on public.profiles;
create policy "profiles team read" on public.profiles for select
using (auth.uid() is not null);

drop policy if exists "activities agenda insert" on public.activities;
create policy "activities agenda insert" on public.activities for insert
with check (actor_id=auth.uid() and (assigned_to=auth.uid() or public.current_role()='admin'));

drop policy if exists "activities agenda update" on public.activities;
create policy "activities agenda update" on public.activities for update
using (actor_id=auth.uid() or assigned_to=auth.uid() or public.current_role()='admin')
with check (actor_id=auth.uid() or assigned_to=auth.uid() or public.current_role()='admin');

drop policy if exists "activities agenda delete" on public.activities;
create policy "activities agenda delete" on public.activities for delete
using (public.current_role()='admin');
