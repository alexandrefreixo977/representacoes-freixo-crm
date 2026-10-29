-- Contas de gestão: quem entra com um destes emails fica automaticamente com o papel de administrador.
create table if not exists public.b2b_admin_emails (
  email text primary key check (email = lower(email))
);
alter table public.b2b_admin_emails enable row level security;
create policy b2b_admin_emails_admin on public.b2b_admin_emails for all using (b2b_is_admin()) with check (b2b_is_admin());

insert into public.b2b_admin_emails (email) values ('afreixo@representacoesfreixo.com') on conflict do nothing;

create or replace function public.b2b_grant_admin_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from b2b_admin_emails where email = lower(new.email)) then
    insert into b2b_users (user_id, role) values (new.id, 'admin')
    on conflict (user_id) do update set role = 'admin', client_id = null;
  end if;
  return new;
end;
$$;

drop trigger if exists b2b_grant_admin_on_signup on auth.users;
create trigger b2b_grant_admin_on_signup after insert on auth.users
  for each row execute function public.b2b_grant_admin_on_signup();

-- Contas que já existam.
insert into public.b2b_users (user_id, role)
select u.id, 'admin' from auth.users u join public.b2b_admin_emails a on a.email = lower(u.email)
on conflict (user_id) do update set role = 'admin', client_id = null;
