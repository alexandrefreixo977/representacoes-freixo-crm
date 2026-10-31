-- Freixo CRM: criação automática do perfil e políticas do histórico de email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email, 'Utilizador'),
    case when not exists (select 1 from public.profiles) then 'admin'::public.app_role else 'commercial'::public.app_role end,
    true
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute procedure public.handle_new_user();

create policy "email recipients follow email"
on public.email_recipients for all
using (
  exists (
    select 1 from public.emails e
    where e.id = email_id
      and (e.sender_id = auth.uid() or public.current_role() = 'admin')
  )
)
with check (
  exists (
    select 1 from public.emails e
    where e.id = email_id
      and (e.sender_id = auth.uid() or public.current_role() = 'admin')
  )
);

create policy "activities authorized insert"
on public.activities for insert
with check (
  actor_id = auth.uid()
  and exists (
    select 1 from public.clients c
    where c.id = client_id
      and (c.owner_id = auth.uid() or public.current_role() = 'admin')
  )
);

