-- Administração de utilizadores com dados reais (31/10/2026).
-- 1) Email no perfil, preenchido a partir das contas Microsoft 365 (auth.users).
alter table public.profiles add column if not exists email text;
update public.profiles p set email = lower(u.email) from auth.users u where u.id = p.id and (p.email is distinct from lower(u.email));

-- 2) Quem entra pela primeira vez fica "pendente" (inativo) até um administrador o aprovar.
--    O primeiro utilizador de sempre continua a ser administrador ativo.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare first_user boolean := not exists(select 1 from public.profiles);
begin
  insert into public.profiles (id, full_name, role, active, email)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email, 'Utilizador'),
          case when first_user then 'admin'::public.app_role else 'commercial'::public.app_role end,
          first_user,
          lower(new.email))
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end; $$;

-- 3) Nunca deixar o CRM sem pelo menos um administrador ativo.
create or replace function public.keep_one_active_admin() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active) then
    if not exists (select 1 from public.profiles where id <> old.id and role = 'admin' and active) then
      raise exception 'Tem de existir pelo menos um administrador ativo.';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists keep_one_active_admin on public.profiles;
create trigger keep_one_active_admin before update on public.profiles for each row execute procedure public.keep_one_active_admin();

-- Verificação (só totais).
select role::text, active, count(*) as total, count(email) as com_email from public.profiles group by role, active;
