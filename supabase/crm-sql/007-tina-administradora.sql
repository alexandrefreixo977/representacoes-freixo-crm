-- 02/11/2026: a Tina (comercial@representacoesfreixo.com) é administradora do CRM, como o Alexandre.
-- 1) Se já entrou alguma vez, o perfil passa a administrador ativo, com acesso ao catálogo/encomendas.
update public.profiles p set role = 'admin', active = true, updated_at = now()
  from auth.users u
 where u.id = p.id and lower(u.email) = 'comercial@representacoesfreixo.com';

insert into public.crm_feature_access (feature_key, user_id, enabled)
select 'catalog_orders_beta', p.id, true
  from public.profiles p join auth.users u on u.id = p.id
 where lower(u.email) = 'comercial@representacoesfreixo.com'
on conflict (feature_key, user_id) do update set enabled = true;

-- 2) Se ainda não entrou, fica administradora ativa logo no primeiro início de sessão
--    (as contas da gestão não passam pelo estado "pendente").
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare
  first_user boolean := not exists(select 1 from public.profiles);
  management boolean := lower(new.email) in ('afreixo@representacoesfreixo.com', 'comercial@representacoesfreixo.com');
begin
  insert into public.profiles (id, full_name, role, active, email)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email, 'Utilizador'),
          case when first_user or management then 'admin'::public.app_role else 'commercial'::public.app_role end,
          first_user or management,
          lower(new.email))
  on conflict (id) do update set email = excluded.email, updated_at = now();
  if management then
    insert into public.crm_feature_access (feature_key, user_id, enabled)
    values ('catalog_orders_beta', new.id, true)
    on conflict (feature_key, user_id) do update set enabled = true;
  end if;
  return new;
end; $$;

-- Verificação (sem dados pessoais): a conta existe? é administradora ativa? tem o catálogo?
select exists(select 1 from auth.users where lower(email) = 'comercial@representacoesfreixo.com') as conta_existe,
       exists(select 1 from public.profiles p join auth.users u on u.id = p.id
               where lower(u.email) = 'comercial@representacoesfreixo.com' and p.role = 'admin' and p.active) as administradora_ativa,
       exists(select 1 from public.crm_feature_access a join auth.users u on u.id = a.user_id
               where lower(u.email) = 'comercial@representacoesfreixo.com' and a.enabled) as acesso_catalogo,
       (select count(*) from public.profiles where role = 'admin' and active) as total_admins_ativos;
