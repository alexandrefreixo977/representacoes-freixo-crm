-- References original work records; no copies of tasks or calendar events.
create table public.notification_preferences (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 timezone text not null default 'Europe/Lisbon', in_app boolean not null default true,
 push boolean not null default false, tasks_enabled boolean not null default true,
 agenda_enabled boolean not null default true, overdue boolean not null default true,
 daily_summary boolean not null default true,
 task_offsets integer[] not null default '{15}', agenda_offsets integer[] not null default '{15}',
 quiet_enabled boolean not null default false, quiet_start time not null default '22:00', quiet_end time not null default '07:00',
 updated_at timestamptz not null default now(),
 check (cardinality(task_offsets)<=8 and 0<=all(task_offsets) and 43200>=all(task_offsets)),
 check (cardinality(agenda_offsets)<=8 and 0<=all(agenda_offsets) and 43200>=all(agenda_offsets))
);
alter table public.activities add column if not exists has_time boolean not null default true,
 add column if not exists due_date date, add column if not exists schedule_timezone text not null default 'Europe/Lisbon',
 add column if not exists reminder_offsets integer[];
alter table public.tasks add column if not exists has_time boolean not null default true,
 add column if not exists due_date date, add column if not exists schedule_timezone text not null default 'Europe/Lisbon',
 add column if not exists reminder_offsets integer[];
alter table public.activities add constraint activity_reminder_offsets_valid check (cardinality(reminder_offsets)<=8 and 0<=all(reminder_offsets) and 43200>=all(reminder_offsets));
alter table public.tasks add constraint task_reminder_offsets_valid check (cardinality(reminder_offsets)<=8 and 0<=all(reminder_offsets) and 43200>=all(reminder_offsets));
-- Follow-up dates never represented a time selected by a user.
update public.activities a set has_time=false,due_date=s.next_action_date
 from public.activities s where a.follow_up_source_id=s.id and s.next_action_date is not null;
create function public.notification_validate_timezone() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from pg_timezone_names where name=new.timezone) then raise exception 'Invalid timezone'; end if;
 new.updated_at=now(); return new;
end $$;
create trigger notification_timezone before insert or update on public.notification_preferences for each row execute function public.notification_validate_timezone();
create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 endpoint text not null unique, p256dh text not null, auth text not null, device_info text,
 active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), last_used_at timestamptz,
 check (endpoint ~ '^https://(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/[^[:space:]]+$'),
 check (length(p256dh) between 86 and 90 and p256dh ~ '^[A-Za-z0-9_=-]+$'),
 check (length(auth) between 22 and 24 and auth ~ '^[A-Za-z0-9_=-]+$')
);
create index push_subscription_owner on public.push_subscriptions(user_id) where active;
create table public.notification_reads (
 user_id uuid not null references public.profiles(id) on delete cascade, source_table text not null check(source_table in ('activities','tasks')),
 item_id uuid not null, revision text not null, read_at timestamptz not null default now(), primary key(user_id,source_table,item_id)
);
create table public.notification_daily_views(user_id uuid not null references public.profiles(id) on delete cascade, day date not null, primary key(user_id,day));
create table public.notification_occurrences (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 source_table text not null check(source_table in ('activities','tasks')), item_id uuid not null,
 offset_minutes integer not null, scheduled_for timestamptz not null, expires_at timestamptz not null,
 revision text not null, status text not null default 'active' check(status in ('active','cancelled')),
 created_at timestamptz not null default now(), unique(user_id,source_table,item_id,offset_minutes,scheduled_for)
);
create index notification_occurrence_due on public.notification_occurrences(scheduled_for,expires_at) where status='active';
create index notification_occurrence_owner on public.notification_occurrences(user_id,scheduled_for);
create table public.notification_toast_receipts(user_id uuid not null references public.profiles(id) on delete cascade, occurrence_id uuid not null references public.notification_occurrences(id) on delete cascade, primary key(user_id,occurrence_id));
create table public.notification_push_deliveries(
 id uuid primary key default gen_random_uuid(), occurrence_id uuid not null references public.notification_occurrences(id) on delete cascade,
 subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
 status text not null default 'claimed' check(status in ('claimed','sent','failed','expired','cancelled','quiet','unknown')),
 claimed_at timestamptz not null default now(), sent_at timestamptz, error_code text,
 unique(occurrence_id,subscription_id)
);
do $$ declare t text; begin
 foreach t in array array['notification_preferences','push_subscriptions','notification_reads','notification_daily_views','notification_occurrences','notification_toast_receipts','notification_push_deliveries'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
 foreach t in array array['notification_preferences','push_subscriptions','notification_reads'] loop
 execute format('grant select, insert, update, delete on public.%I to authenticated',t);
 execute format('create policy own_rows on public.%I for all to authenticated using (user_id=(select auth.uid()) and exists(select 1 from public.profiles where id=(select auth.uid()) and active)) with check (user_id=(select auth.uid()) and exists(select 1 from public.profiles where id=(select auth.uid()) and active))',t);
 end loop;
 foreach t in array array['notification_daily_views','notification_toast_receipts'] loop
 execute format('grant select, insert on public.%I to authenticated',t);
 execute format('create policy own_rows on public.%I for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()))',t);
 end loop;
end $$;
grant select on public.notification_occurrences to authenticated;
create policy own_occurrences on public.notification_occurrences for select to authenticated using(user_id=(select auth.uid()));

create view public.notification_items with(security_invoker=true) as
 select a.id,'activities'::text source_table,coalesce(a.assigned_to,a.actor_id) user_id,
 case when a.kind::text='task' then 'task' else 'agenda' end category,
 coalesce(nullif(a.title,''),nullif(a.subject,''),a.summary,'Sem título') title,
 c.trade_name client_name,a.client_id,a.contact_id,concat_ws(' ',cc.first_name,cc.last_name) contact_name,
 a.start_at starts_at,a.due_date,a.has_time,a.schedule_timezone,a.reminder_offsets,null::timestamptz reminder_at,
 a.status,a.source_module origin,
 md5(concat_ws('|',a.start_at,a.due_date,a.has_time,a.assigned_to,a.actor_id,a.status,a.reminder_offsets,a.title,a.subject)) revision
 from public.activities a left join public.clients c on c.id=a.client_id left join public.client_contacts cc on cc.id=a.contact_id
 where a.status not in ('completed','done','cancelled','canceled','archived')
 and (a.kind::text='task' or (a.source_module in ('agenda','visits') and a.kind::text in ('visit','meeting','call','note')))
 and not exists(select 1 from public.tasks t where t.id=a.source_record_id)
 union all
 select t.id,'tasks',coalesce(t.assignee_id,t.created_by),'task',t.title,c.trade_name,t.client_id,t.contact_id,concat_ws(' ',cc.first_name,cc.last_name),
 t.due_at,t.due_date,t.has_time,t.schedule_timezone,t.reminder_offsets,t.reminder_at,t.status,'tasks',
 md5(concat_ws('|',t.due_at,t.due_date,t.has_time,t.assignee_id,t.created_by,t.status,t.reminder_offsets,t.reminder_at,t.title))
 from public.tasks t left join public.clients c on c.id=t.client_id left join public.client_contacts cc on cc.id=t.contact_id
 where t.status not in ('completed','done','cancelled','canceled','archived');
revoke all on public.notification_items from anon;
grant select on public.notification_items to authenticated,service_role;

-- These service-only functions coordinate background work. They do not grant users elevated access.
create function public.notification_prepare() returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.notification_occurrences o set status='cancelled' where o.status='active' and not exists(
 select 1 from public.notification_items i left join public.notification_preferences p on p.user_id=i.user_id
 where i.id=o.item_id and i.source_table=o.source_table and i.user_id=o.user_id and i.revision=o.revision
 and i.has_time and i.starts_at is not null
 and case when i.category='task' then coalesce(p.tasks_enabled,true) else coalesce(p.agenda_enabled,true) end);
 insert into public.notification_occurrences(user_id,source_table,item_id,offset_minutes,scheduled_for,expires_at,revision)
 select i.user_id,i.source_table,i.id,off,
 case when i.reminder_offsets is null and i.reminder_at is not null then i.reminder_at else i.starts_at-make_interval(mins=>off) end,
 least(i.starts_at+case when off=0 then interval '5 minutes' else interval '0' end,
 (case when i.reminder_offsets is null and i.reminder_at is not null then i.reminder_at else i.starts_at-make_interval(mins=>off) end)+interval '5 minutes'),i.revision
 from public.notification_items i join public.profiles u on u.id=i.user_id and u.active
 left join public.notification_preferences p on p.user_id=i.user_id
 cross join lateral unnest(case when i.reminder_offsets is null and i.reminder_at is not null then array[greatest(0,extract(epoch from(i.starts_at-i.reminder_at))::int/60)] else coalesce(i.reminder_offsets,case when i.category='task' then p.task_offsets else p.agenda_offsets end,array[15]) end) off
 where i.has_time and i.starts_at is not null
 and case when i.category='task' then coalesce(p.tasks_enabled,true) else coalesce(p.agenda_enabled,true) end
 and (case when i.reminder_offsets is null and i.reminder_at is not null then i.reminder_at else i.starts_at-make_interval(mins=>off) end) between now()-interval '5 minutes' and now()+interval '2 days'
 on conflict(user_id,source_table,item_id,offset_minutes,scheduled_for) do update set revision=excluded.revision,status='active',expires_at=excluded.expires_at;
 update public.notification_push_deliveries set status='unknown' where status='claimed' and claimed_at<now()-interval '5 minutes';
end $$;
revoke all on function public.notification_prepare() from public,anon,authenticated;
grant execute on function public.notification_prepare() to service_role;
create function public.notification_claim_push() returns setof public.notification_push_deliveries language sql security invoker set search_path='' as $$
 insert into public.notification_push_deliveries(occurrence_id,subscription_id,status)
 select o.id,s.id,case when p.quiet_enabled and
 (case when p.quiet_start<p.quiet_end then (now() at time zone p.timezone)::time>=p.quiet_start and (now() at time zone p.timezone)::time<p.quiet_end
 else (now() at time zone p.timezone)::time>=p.quiet_start or (now() at time zone p.timezone)::time<p.quiet_end end) then 'quiet' else 'claimed' end
 from public.notification_occurrences o join public.notification_preferences p on p.user_id=o.user_id and p.push
 join public.push_subscriptions s on s.user_id=o.user_id and s.active
 where o.status='active' and o.scheduled_for<=now() and o.expires_at>now()
 order by o.scheduled_for limit 100
 on conflict(occurrence_id,subscription_id) do nothing returning *;
$$;
revoke all on function public.notification_claim_push() from public,anon,authenticated;
grant execute on function public.notification_claim_push() to service_role;

-- Public key only. The sender's private key is available exclusively to the service role.
create function public.notification_public_key() returns text language sql security definer set search_path='' as $$
 select decrypted_secret from vault.decrypted_secrets where name='notification_vapid_public' and exists(select 1 from public.profiles where id=(select auth.uid()) and active)
$$;
revoke all on function public.notification_public_key() from public,anon;
grant execute on function public.notification_public_key() to authenticated;
create function public.notification_sender_keys() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_object_agg(name,decrypted_secret) from vault.decrypted_secrets where name in ('notification_vapid_public','notification_vapid_private')
$$;
revoke all on function public.notification_sender_keys() from public,anon,authenticated;
grant execute on function public.notification_sender_keys() to service_role;
do $$ declare t text; begin
 foreach t in array array['tasks','notification_occurrences','notification_preferences'] loop
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t); end if;
 end loop;
end $$;
