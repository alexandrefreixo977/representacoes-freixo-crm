begin;

alter table public.activities
  add column if not exists follow_up_source_id uuid references public.activities(id) on delete cascade,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references public.profiles(id) on delete set null;

create unique index if not exists activities_follow_up_source_unique
  on public.activities(follow_up_source_id)
  where follow_up_source_id is not null;

create index if not exists activities_follow_up_due_idx
  on public.activities(start_at, status)
  where kind = 'task' and follow_up_source_id is not null;

create or replace function public.sync_interaction_follow_up_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'task' or new.follow_up_source_id is not null then
    return new;
  end if;

  if nullif(btrim(new.next_action), '') is not null and new.next_action_date is not null then
    insert into public.activities (
      client_id, kind, actor_id, assigned_to, interaction_type, title, summary,
      description, occurred_at, start_at, status, source_module, follow_up_source_id,
      created_at, updated_at
    ) values (
      new.client_id, 'task', new.actor_id, coalesce(new.assigned_to, new.actor_id),
      'Tarefa', new.next_action, new.next_action,
      'Follow-up automático da interação: ' || coalesce(new.subject, new.summary, new.interaction_type),
      new.next_action_date::timestamp + time '09:00',
      new.next_action_date::timestamp + time '09:00',
      'scheduled', 'follow_up', new.id, now(), now()
    )
    on conflict (follow_up_source_id) where follow_up_source_id is not null
    do update set
      client_id = excluded.client_id,
      assigned_to = excluded.assigned_to,
      title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      occurred_at = excluded.occurred_at,
      start_at = excluded.start_at,
      updated_at = now()
    where public.activities.status not in ('completed', 'done');
  else
    delete from public.activities
    where follow_up_source_id = new.id
      and status not in ('completed', 'done');
  end if;

  return new;
end;
$$;

drop trigger if exists sync_interaction_follow_up_task_change on public.activities;
create trigger sync_interaction_follow_up_task_change
after insert or update of next_action, next_action_date, client_id, assigned_to, actor_id
on public.activities
for each row execute procedure public.sync_interaction_follow_up_task();

-- Uma tarefa futura não é uma interação concluída e não deve alterar a data
-- do último contacto do cliente.
create or replace function public.sync_client_after_activity()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.kind = 'task' then
    return new;
  end if;
  update public.clients set
    last_contact_at = greatest(coalesce(last_contact_at, new.occurred_at), new.occurred_at),
    next_action = coalesce(new.next_action, next_action),
    next_contact_at = coalesce(new.next_action_date::timestamptz, next_contact_at),
    updated_at = now()
  where id = new.client_id;
  return new;
end;
$$;

-- Cria as tarefas em falta para interações históricas sem duplicar registos.
insert into public.activities (
  client_id, kind, actor_id, assigned_to, interaction_type, title, summary,
  description, occurred_at, start_at, status, source_module, follow_up_source_id,
  created_at, updated_at
)
select
  source.client_id, 'task', source.actor_id, coalesce(source.assigned_to, source.actor_id),
  'Tarefa', source.next_action, source.next_action,
  'Follow-up automático da interação: ' || coalesce(source.subject, source.summary, source.interaction_type),
  source.next_action_date::timestamp + time '09:00',
  source.next_action_date::timestamp + time '09:00',
  'scheduled', 'follow_up', source.id, now(), now()
from public.activities source
where source.kind <> 'task'
  and nullif(btrim(source.next_action), '') is not null
  and source.next_action_date is not null
on conflict (follow_up_source_id) where follow_up_source_id is not null do nothing;

commit;
