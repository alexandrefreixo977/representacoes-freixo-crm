-- Extensão compatível da ficha de cliente para a Base Master.
begin;

alter table public.clients add column if not exists source_key text;
alter table public.clients add column if not exists commercial_name text;
alter table public.clients add column if not exists potential text;
alter table public.clients add column if not exists priority_label text;
alter table public.clients add column if not exists visit_frequency text;
alter table public.clients add column if not exists next_action text;
alter table public.clients add column if not exists growth_plan text;
alter table public.clients add column if not exists reference_name text;
alter table public.clients add column if not exists source_name text;
alter table public.clients add column if not exists is_cecofersa_member boolean not null default false;
alter table public.clients add column if not exists validation_status text;

create unique index if not exists clients_source_key_unique
  on public.clients (lower(source_key)) where source_key is not null and source_key <> '';
create unique index if not exists clients_tax_id_unique
  on public.clients (upper(regexp_replace(tax_id, '\s', '', 'g'))) where tax_id is not null and tax_id <> '';

create table if not exists public.manufacturers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_manufacturers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  manufacturer_id uuid not null references public.manufacturers(id) on delete cascade,
  manufacturer_client_code text,
  agreed_discount numeric(7,4),
  discount_status text,
  source_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(client_id, manufacturer_id)
);

create unique index if not exists contacts_client_email_unique
  on public.client_contacts (client_id, lower(email)) where email is not null and email <> '';

alter table public.manufacturers enable row level security;
alter table public.client_manufacturers enable row level security;

drop policy if exists "manufacturers authenticated read" on public.manufacturers;
create policy "manufacturers authenticated read" on public.manufacturers
  for select using (auth.uid() is not null);

drop policy if exists "manufacturers admin manage" on public.manufacturers;
create policy "manufacturers admin manage" on public.manufacturers
  for all using (public.current_role()='admin') with check (public.current_role()='admin');

drop policy if exists "client manufacturers authorized" on public.client_manufacturers;
create policy "client manufacturers authorized" on public.client_manufacturers
  for all using (
    exists(select 1 from public.clients c where c.id=client_id and (c.owner_id=auth.uid() or public.current_role()='admin'))
  ) with check (
    exists(select 1 from public.clients c where c.id=client_id and (c.owner_id=auth.uid() or public.current_role()='admin'))
  );

create or replace function public.assign_imported_clients_to_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.clients
  set owner_id = new.id, updated_at = now()
  where owner_id is null and (
    (lower(commercial_name) in ('alexandre','alexandre freixo') and lower(new.full_name) like 'alexandre%') or
    (lower(commercial_name) in ('tina','tina sciullo') and lower(new.full_name) like 'tina%') or
    (lower(commercial_name) in ('lúcia','lucia','lucia costa') and lower(new.full_name) like 'lucia%')
  );
  return new;
end;
$$;

drop trigger if exists assign_imported_clients_after_profile on public.profiles;
create trigger assign_imported_clients_after_profile
  after insert or update of full_name on public.profiles
  for each row execute procedure public.assign_imported_clients_to_user();

commit;
