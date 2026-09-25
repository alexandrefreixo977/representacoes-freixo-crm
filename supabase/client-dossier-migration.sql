-- Evolução da tabela existente de atividades para timeline comercial completa.
begin;

alter table public.activities add column if not exists interaction_type text;
alter table public.activities add column if not exists subject text;
alter table public.activities add column if not exists description text;
alter table public.activities add column if not exists manufacturer_id uuid references public.manufacturers(id) on delete set null;
alter table public.activities add column if not exists contact_id uuid references public.client_contacts(id) on delete set null;
alter table public.activities add column if not exists next_action text;
alter table public.activities add column if not exists next_action_date date;
alter table public.activities add column if not exists status text not null default 'completed';
alter table public.activities add column if not exists updated_at timestamptz not null default now();

update public.activities
set interaction_type = case kind::text
  when 'email' then 'Email'
  when 'call' then 'Chamada telefónica'
  when 'visit' then 'Visita comercial'
  when 'meeting' then 'Reunião'
  when 'proposal' then 'Proposta enviada'
  when 'note' then 'Nota interna'
  else initcap(kind::text)
end,
subject = coalesce(subject, summary),
description = coalesce(description, result)
where interaction_type is null;

alter table public.activities alter column interaction_type set not null;
create index if not exists activities_client_type_date_idx on public.activities(client_id, interaction_type, occurred_at desc);
create index if not exists activities_next_action_idx on public.activities(next_action_date) where next_action_date is not null;

drop policy if exists "activities authorized update" on public.activities;
create policy "activities authorized update" on public.activities for update
using (actor_id=auth.uid() or public.current_role()='admin')
with check (actor_id=auth.uid() or public.current_role()='admin');

drop policy if exists "activities admin delete" on public.activities;
create policy "activities admin delete" on public.activities for delete
using (public.current_role()='admin');

create or replace function public.sync_client_after_activity()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.clients set
    last_contact_at = greatest(coalesce(last_contact_at, new.occurred_at), new.occurred_at),
    next_action = coalesce(new.next_action, next_action),
    next_contact_at = coalesce(new.next_action_date::timestamptz, next_contact_at),
    updated_at = now()
  where id = new.client_id;
  return new;
end;
$$;

drop trigger if exists sync_client_after_activity_change on public.activities;
create trigger sync_client_after_activity_change
after insert or update on public.activities
for each row execute procedure public.sync_client_after_activity();

commit;
