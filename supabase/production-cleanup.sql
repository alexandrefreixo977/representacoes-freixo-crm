-- Produção Portugal: utilizadores autorizados e remoção de dados de demonstração.
begin;

create table if not exists public.authorized_users (
  email text primary key,
  full_name text not null,
  role public.app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.authorized_users (email, full_name, role, active)
values
  ('afreixo@representacoesfreixo.com', 'Alexandre Freixo', 'admin', true),
  ('comercial@representacoesfreixo.com', 'Tina Sciullo', 'admin', true),
  ('lcosta@representacoesfreixo.com', 'Lucia Costa', 'commercial', true)
on conflict (email) do update set
  full_name = excluded.full_name,
  role = excluded.role,
  active = excluded.active,
  updated_at = now();

delete from public.authorized_users
where lower(email) not in (
  'afreixo@representacoesfreixo.com',
  'comercial@representacoesfreixo.com',
  'lcosta@representacoesfreixo.com'
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  allowed public.authorized_users%rowtype;
begin
  select * into allowed
  from public.authorized_users
  where lower(email) = lower(new.email)
    and active = true;

  if found then
    insert into public.profiles (id, full_name, role, active)
    values (new.id, allowed.full_name, allowed.role, true)
    on conflict (id) do update set
      full_name = excluded.full_name,
      role = excluded.role,
      active = true,
      updated_at = now();
  else
    delete from public.profiles where id = new.id;
  end if;
  return new;
end;
$$;

-- Sincroniza contas Microsoft que já possam existir.
insert into public.profiles (id, full_name, role, active)
select u.id, a.full_name, a.role, true
from auth.users u
join public.authorized_users a on lower(a.email) = lower(u.email)
where a.active = true
on conflict (id) do update set
  full_name = excluded.full_name,
  role = excluded.role,
  active = true,
  updated_at = now();

-- Remove acessos que não pertencem à lista aprovada.
delete from public.profiles p
where not exists (
  select 1 from auth.users u
  join public.authorized_users a on lower(a.email) = lower(u.email)
  where u.id = p.id and a.active = true
);

-- Limpeza integral dos dados comerciais de demonstração.
delete from public.email_recipients;
delete from public.emails;
delete from public.activities;
delete from public.audit_logs;
delete from public.tasks;
delete from public.visits;
delete from public.opportunities;
delete from public.client_contacts;
delete from public.clients;

alter table public.authorized_users enable row level security;
drop policy if exists "authorized users admin read" on public.authorized_users;
create policy "authorized users admin read"
on public.authorized_users for select
using (public.current_role() = 'admin');

commit;

select email, full_name, role, active
from public.authorized_users
order by role, full_name;
