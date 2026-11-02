-- Pedido do Alexandre (02/11/2026): a Tina (comercial@representacoesfreixo.com) tem acesso total como administradora.
-- Garante o papel admin a todas as contas da gestão (b2b_admin_emails), mesmo que um convite as tenha posto como comercial ou cliente.
insert into public.b2b_admin_emails (email) values ('comercial@representacoesfreixo.com') on conflict do nothing;

insert into public.b2b_users (user_id, role, email)
select u.id, 'admin', lower(u.email) from auth.users u join public.b2b_admin_emails a on a.email = lower(u.email)
on conflict (user_id) do update set role = 'admin', client_id = null, email = excluded.email;

-- Um admin nunca deve ficar rebaixado por um convite posterior.
create or replace function public.b2b_keep_admin_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role <> 'admin' and exists (
    select 1 from b2b_admin_emails a join auth.users u on lower(u.email) = a.email where u.id = new.user_id
  ) then
    new.role := 'admin';
    new.client_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists b2b_keep_admin_role on public.b2b_users;
create trigger b2b_keep_admin_role before insert or update on public.b2b_users
for each row execute function public.b2b_keep_admin_role();
