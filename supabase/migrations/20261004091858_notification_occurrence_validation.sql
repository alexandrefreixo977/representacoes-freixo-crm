create view public.notification_schedule with(security_invoker=true) as
 select i.user_id,i.source_table,i.id item_id,off offset_minutes,i.revision,
 case when i.reminder_offsets is null and i.reminder_at is not null then i.reminder_at else i.starts_at-make_interval(mins=>off) end scheduled_for,
 least(i.starts_at+case when off=0 then interval '5 minutes' else interval '0' end,
 (case when i.reminder_offsets is null and i.reminder_at is not null then i.reminder_at else i.starts_at-make_interval(mins=>off) end)+interval '5 minutes') expires_at
 from public.notification_items i join public.profiles u on u.id=i.user_id and u.active
 left join public.notification_preferences p on p.user_id=i.user_id
 cross join lateral unnest(case when i.reminder_offsets is null and i.reminder_at is not null then array[greatest(0,extract(epoch from(i.starts_at-i.reminder_at))::int/60)] else coalesce(i.reminder_offsets,case when i.category='task' then p.task_offsets else p.agenda_offsets end,array[15]) end) off
 where i.has_time and i.starts_at is not null and case when i.category='task' then coalesce(p.tasks_enabled,true) else coalesce(p.agenda_enabled,true) end;
revoke all on public.notification_schedule from anon;
grant select on public.notification_schedule to authenticated,service_role;
create or replace function public.notification_prepare() returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.notification_occurrences o set status='cancelled' where o.status='active' and not exists(
 select 1 from public.notification_schedule s where s.item_id=o.item_id and s.source_table=o.source_table and s.user_id=o.user_id and s.revision=o.revision and s.offset_minutes=o.offset_minutes and s.scheduled_for=o.scheduled_for);
 insert into public.notification_occurrences(user_id,source_table,item_id,offset_minutes,scheduled_for,expires_at,revision)
 select distinct user_id,source_table,item_id,offset_minutes,scheduled_for,expires_at,revision from public.notification_schedule
 where scheduled_for between now()-interval '5 minutes' and now()+interval '2 days'
 on conflict(user_id,source_table,item_id,offset_minutes,scheduled_for) do update set revision=excluded.revision,status='active',expires_at=excluded.expires_at;
 update public.notification_push_deliveries set status='unknown' where status='claimed' and claimed_at<now()-interval '5 minutes';
end $$;
create or replace function public.notification_claim_push() returns setof public.notification_push_deliveries language sql security invoker set search_path='' as $$
 insert into public.notification_push_deliveries(occurrence_id,subscription_id,status)
 select o.id,s.id,case when p.quiet_enabled and
 (case when p.quiet_start<p.quiet_end then (now() at time zone p.timezone)::time>=p.quiet_start and (now() at time zone p.timezone)::time<p.quiet_end
 else (now() at time zone p.timezone)::time>=p.quiet_start or (now() at time zone p.timezone)::time<p.quiet_end end) then 'quiet' else 'claimed' end
 from public.notification_occurrences o join public.notification_preferences p on p.user_id=o.user_id and p.push
 join public.push_subscriptions s on s.user_id=o.user_id and s.active
 where o.status='active' and o.scheduled_for<=now() and o.expires_at>now()
 and not exists(select 1 from public.notification_push_deliveries d where d.occurrence_id=o.id and d.subscription_id=s.id)
 order by o.scheduled_for limit 100
 on conflict(occurrence_id,subscription_id) do nothing returning *;
$$;
