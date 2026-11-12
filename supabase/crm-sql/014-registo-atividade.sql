-- 12/11/2026 — Registo de atividade dos utilizadores do CRM (visível só para administradores).
-- * crm_sessions: entradas e saídas (uma sessão = período contínuo de utilização; termina ao sair
--   ou após 20 minutos sem atividade).
-- * crm_activity_log: tudo o que cada utilizador faz — páginas e fichas abertas (registadas pela app)
--   e todas as criações, alterações e eliminações de dados (registadas pela própria base de dados,
--   por isso não dependem da app nem podem ser contornadas).
-- Os registos com mais de 12 meses são apagados automaticamente (RGPD: conservação limitada).

create table if not exists public.crm_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason in ('logout', 'inatividade')),
  device text,
  user_agent text
);
create index if not exists crm_sessions_user_started_idx on public.crm_sessions(user_id, started_at desc);
create index if not exists crm_sessions_started_idx on public.crm_sessions(started_at desc);

create table if not exists public.crm_activity_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid references public.crm_sessions(id) on delete set null,
  kind text not null check (kind in ('login', 'logout', 'view', 'action', 'create', 'update', 'delete')),
  module text,
  entity_table text,
  entity_id text,
  label text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists crm_activity_log_created_idx on public.crm_activity_log(created_at desc);
create index if not exists crm_activity_log_user_created_idx on public.crm_activity_log(user_id, created_at desc);

alter table public.crm_sessions enable row level security;
alter table public.crm_activity_log enable row level security;
-- Só os administradores leem. Ninguém escreve diretamente: a escrita é feita pelas funções abaixo.
drop policy if exists "crm sessions admin read" on public.crm_sessions;
create policy "crm sessions admin read" on public.crm_sessions for select using (public.current_role() = 'admin');
drop policy if exists "crm activity admin read" on public.crm_activity_log;
create policy "crm activity admin read" on public.crm_activity_log for select using (public.current_role() = 'admin');
revoke all on public.crm_sessions, public.crm_activity_log from anon, authenticated;
grant select on public.crm_sessions, public.crm_activity_log to authenticated;

create schema if not exists crm_internal;

create or replace function crm_internal.open_session(uid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.crm_sessions where user_id = uid and ended_at is null order by last_seen_at desc limit 1
$$;

-- Chamada pela app a cada minuto de utilização (e ao abrir). Devolve a sessão em curso.
create or replace function public.crm_activity_ping(p_session uuid default null, p_device text default null, p_user_agent text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  current_id uuid;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid and active) then
    raise exception 'Sem sessão ativa';
  end if;
  -- Sessões paradas há mais de 20 minutos terminam na última atividade registada.
  update public.crm_sessions set ended_at = last_seen_at, end_reason = 'inatividade'
   where user_id = uid and ended_at is null and last_seen_at < now() - interval '20 minutes';
  select id into current_id from public.crm_sessions
   where user_id = uid and ended_at is null and (p_session is null or id = p_session)
   order by last_seen_at desc limit 1;
  if current_id is null then
    select id into current_id from public.crm_sessions where user_id = uid and ended_at is null order by last_seen_at desc limit 1;
  end if;
  if current_id is not null then
    update public.crm_sessions set last_seen_at = now() where id = current_id;
    return current_id;
  end if;
  insert into public.crm_sessions(user_id, device, user_agent)
  values (uid, left(p_device, 40), left(p_user_agent, 300)) returning id into current_id;
  insert into public.crm_activity_log(user_id, session_id, kind, label, detail)
  values (uid, current_id, 'login', 'Entrou no CRM', jsonb_build_object('dispositivo', left(p_device, 40)));
  -- Conservação limitada a 12 meses.
  delete from public.crm_activity_log where created_at < now() - interval '12 months';
  delete from public.crm_sessions where started_at < now() - interval '12 months';
  return current_id;
end $$;

-- Chamada ao terminar sessão.
create or replace function public.crm_activity_end(p_session uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); sid uuid;
begin
  if uid is null then return; end if;
  select id into sid from public.crm_sessions
   where user_id = uid and ended_at is null and (p_session is null or id = p_session)
   order by last_seen_at desc limit 1;
  if sid is null then return; end if;
  update public.crm_sessions set ended_at = now(), last_seen_at = now(), end_reason = 'logout' where id = sid;
  insert into public.crm_activity_log(user_id, session_id, kind, label) values (uid, sid, 'logout', 'Terminou sessão');
end $$;

-- Navegação e ações registadas pela app (páginas, fichas abertas, pesquisas, etc.).
create or replace function public.crm_activity_record(p_kind text, p_module text default null, p_label text default null,
  p_entity_table text default null, p_entity_id text default null, p_detail jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null or p_kind not in ('view', 'action') then return; end if;
  if not exists (select 1 from public.profiles where id = uid and active) then return; end if;
  insert into public.crm_activity_log(user_id, session_id, kind, module, label, entity_table, entity_id, detail)
  values (uid, crm_internal.open_session(uid), p_kind, left(p_module, 60), left(p_label, 300), left(p_entity_table, 60), left(p_entity_id, 80), p_detail);
end $$;

revoke all on function public.crm_activity_ping(uuid, text, text) from public, anon;
revoke all on function public.crm_activity_end(uuid) from public, anon;
revoke all on function public.crm_activity_record(text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.crm_activity_ping(uuid, text, text) to authenticated;
grant execute on function public.crm_activity_end(uuid) to authenticated;
grant execute on function public.crm_activity_record(text, text, text, text, text, jsonb) to authenticated;

-- Regista na base de dados cada criação, alteração ou eliminação feita por um utilizador.
-- TG_ARGV[0] (opcional) = coluna com o autor, para operações feitas pelo servidor em nome do utilizador.
create or replace function crm_internal.log_data_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  row_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  row_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r jsonb := coalesce(row_new, row_old);
  changed text[];
  client_name text;
  lbl text;
  info jsonb;
begin
  -- Alterações em cadeia (feitas por outros gatilhos) já ficam representadas pela ação original.
  if pg_trigger_depth() > 1 then return null; end if;
  if uid is null and tg_nargs > 0 then
    begin uid := (r ->> tg_argv[0])::uuid; exception when others then uid := null; end;
  end if;
  if uid is null or not exists (select 1 from public.profiles where id = uid) then return null; end if;

  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into changed
      from jsonb_each(row_new) n
     where n.value is distinct from row_old -> n.key
       and n.key not in ('updated_at', 'row_version', 'search_vector', 'search_text', 'synced_at');
    if changed is null then return null; end if;
  end if;

  if r ? 'client_id' and (r ->> 'client_id') is not null then
    select trade_name into client_name from public.clients where id::text = r ->> 'client_id';
  end if;
  lbl := coalesce(r ->> 'trade_name', r ->> 'title', r ->> 'summary', r ->> 'subject', r ->> 'name', r ->> 'full_name',
                  nullif(concat_ws(' ', r ->> 'first_name', r ->> 'last_name'), ''), r ->> 'order_number', r ->> 'event_type');
  info := jsonb_strip_nulls(jsonb_build_object(
    'campos', to_jsonb(changed),
    'cliente', client_name,
    'tipo', coalesce(r ->> 'interaction_type', r ->> 'kind', r ->> 'document_type', r ->> 'event_type'),
    'estado', case when tg_op = 'UPDATE' and 'status' = any(changed) then r ->> 'status' end,
    'estado_anterior', case when tg_op = 'UPDATE' and 'status' = any(changed) then row_old ->> 'status' end,
    'data', coalesce(r ->> 'start_at', r ->> 'due_date', r ->> 'due_at')
  ));
  insert into public.crm_activity_log(user_id, session_id, kind, entity_table, entity_id, label, detail)
  values (uid, crm_internal.open_session(uid), lower(case tg_op when 'INSERT' then 'create' else tg_op end),
          tg_table_name, r ->> 'id', left(lbl, 300), info);
  return null;
end $$;

-- Liga o registo às tabelas com dados de trabalho (só às que existem nesta base de dados).
do $$
declare
  t record;
  autor text;
  ligadas text[] := '{}';
begin
  for t in select * from (values
      ('clients', null), ('client_contacts', null), ('client_manufacturers', null),
      ('activities', null), ('tasks', null), ('visits', null),
      ('opportunities', null), ('emails', null),
      ('manufacturers', null), ('manufacturer_contacts', null), ('manufacturer_commercial_terms', null),
      ('manufacturer_family_discounts', null), ('manufacturer_logistics', null), ('manufacturer_commissions', null),
      ('catalog_orders', null), ('catalog_document_events', 'actor_id'),
      ('route_plans', null), ('route_stops', null),
      ('profiles', null), ('role_permissions', null)
    ) as v(tabela, autor)
  loop
    if to_regclass('public.' || t.tabela) is null then continue; end if;
    autor := t.autor;
    if autor is not null and not exists (select 1 from information_schema.columns
        where table_schema = 'public' and table_name = t.tabela and column_name = autor) then
      autor := null;
    end if;
    execute format('drop trigger if exists crm_activity_log_trg on public.%I', t.tabela);
    execute format('create trigger crm_activity_log_trg after insert or update or delete on public.%I for each row execute function crm_internal.log_data_change(%s)',
                   t.tabela, coalesce(quote_literal(autor), ''));
    ligadas := ligadas || t.tabela;
  end loop;
  raise notice 'Registo ligado a: %', ligadas;
end $$;

select jsonb_build_object(
  'tabelas_com_registo', (select jsonb_agg(c.relname order by c.relname) from pg_trigger g join pg_class c on c.oid = g.tgrelid
                          where g.tgname = 'crm_activity_log_trg'),
  'sessoes', (select count(*) from public.crm_sessions),
  'registos', (select count(*) from public.crm_activity_log)) as resultado;
