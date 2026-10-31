begin;

create table if not exists public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  graph_id text not null unique,
  conversation_id text,
  direction text not null check (direction in ('in','out')),
  from_address text,
  from_name text,
  to_addresses jsonb default '[]'::jsonb,
  subject text,
  body_preview text,
  sent_at timestamptz,
  received_at timestamptz,
  is_read boolean default false,
  client_id uuid references public.clients(id),
  contact_id uuid references public.client_contacts(id),
  manufacturer_id uuid references public.manufacturers(id),
  is_lead boolean default false,
  owner_id uuid not null references public.profiles(id),
  created_at timestamptz default now()
);
alter table public.mail_messages enable row level security;
grant select, insert, update, delete on public.mail_messages to authenticated;
drop policy if exists "mail owner or admin" on public.mail_messages;
create policy "mail owner or admin" on public.mail_messages for all
  using (owner_id = auth.uid() or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ))
  with check (owner_id = auth.uid());
create index if not exists mail_conv_idx on public.mail_messages(conversation_id);
create index if not exists mail_client_idx on public.mail_messages(client_id);
create index if not exists mail_manufacturer_idx on public.mail_messages(manufacturer_id);
create index if not exists mail_owner_received_idx on public.mail_messages(owner_id, received_at desc);

-- Requires global-agenda-migration.sql and client-dossier-migration.sql.
-- The index is also a concurrency guard when two tabs synchronize together.
create unique index if not exists activities_mail_entity_unique
  on public.activities(entity_id) where source_module = 'mail';

create or replace function public.sync_mail_messages(messages jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  incoming public.mail_messages;
  saved public.mail_messages;
  message_time timestamptz;
  synced integer := 0;
  lead_count integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(messages) <> 'array' or jsonb_array_length(messages) > 200 then
    raise exception 'Expected at most 200 messages';
  end if;
  for incoming in select * from jsonb_populate_recordset(null::public.mail_messages, messages)
  loop
    if incoming.owner_id is distinct from auth.uid() then raise exception 'Invalid owner'; end if;
    insert into public.mail_messages as m (
      graph_id, conversation_id, direction, from_address, from_name, to_addresses,
      subject, body_preview, sent_at, received_at, is_read,
      client_id, contact_id, manufacturer_id, is_lead, owner_id
    ) values (
      incoming.graph_id, incoming.conversation_id, incoming.direction, incoming.from_address, incoming.from_name,
      incoming.to_addresses, incoming.subject, incoming.body_preview, incoming.sent_at, incoming.received_at,
      incoming.is_read, incoming.client_id, incoming.contact_id, incoming.manufacturer_id, incoming.is_lead, auth.uid()
    ) on conflict(graph_id) do update set
      conversation_id = excluded.conversation_id, direction = excluded.direction,
      from_address = excluded.from_address, from_name = excluded.from_name, to_addresses = excluded.to_addresses,
      subject = excluded.subject, body_preview = excluded.body_preview,
      sent_at = excluded.sent_at, received_at = excluded.received_at,
      is_read = coalesce(m.is_read, false) or coalesce(excluded.is_read, false),
      client_id = excluded.client_id, contact_id = excluded.contact_id,
      manufacturer_id = excluded.manufacturer_id, is_lead = excluded.is_lead
      where m.owner_id = auth.uid()
    returning * into saved;
    if saved.id is null then raise exception 'Message belongs to another owner'; end if;
    synced := synced + 1;
    if saved.is_lead then lead_count := lead_count + 1; end if;
    if saved.client_id is not null then
      message_time := coalesce(saved.received_at, saved.sent_at, now());
      insert into public.activities (
        client_id, contact_id, manufacturer_id, kind, interaction_type, title, subject, summary,
        description, actor_id, assigned_to, occurred_at, start_at, status, source_module, entity_id, updated_at
      ) select
        saved.client_id, saved.contact_id, saved.manufacturer_id, 'email', 'Email', saved.subject, saved.subject,
        (case when saved.direction = 'in' then 'Email recebido: ' else 'Email enviado: ' end) || coalesce(saved.subject, ''),
        saved.body_preview, auth.uid(), auth.uid(), message_time, message_time, 'completed', 'mail', saved.id, now()
      where not exists (select 1 from public.activities a where a.entity_id = saved.id)
      on conflict(entity_id) where source_module = 'mail' do nothing;
    end if;
  end loop;
  return jsonb_build_object('sincronizadas', synced, 'leads', lead_count);
end;
$$;
revoke all on function public.sync_mail_messages(jsonb) from public, anon;
grant execute on function public.sync_mail_messages(jsonb) to authenticated;

commit;
