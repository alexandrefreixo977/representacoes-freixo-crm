begin;
do $$
declare u uuid; c uuid; task uuid:=gen_random_uuid(); event uuid:=gen_random_uuid(); sub1 uuid:=gen_random_uuid(); sub2 uuid:=gen_random_uuid(); n integer;
begin
 select id into u from public.profiles where active order by created_at limit 1;
 select id into c from public.clients limit 1;
 insert into public.notification_preferences(user_id,push,quiet_enabled,task_offsets) values(u,true,false,array[15]) on conflict(user_id) do update set push=true,quiet_enabled=false,tasks_enabled=true,task_offsets=array[15];
 insert into public.activities(id,client_id,kind,title,summary,interaction_type,actor_id,assigned_to,start_at,occurred_at,status,source_module,reminder_offsets)
 values(task,c,'task','Transactional notification test','Transactional test','Tarefa',u,u,now()+interval '15 minutes',now(),'scheduled','tasks',array[0,5,15,30,60,120,1440]);
 perform public.notification_prepare();
 select count(*) into n from public.notification_occurrences where item_id=task;
 if n<>3 then raise exception 'Expected current and future offsets 0,5,15, got %',n; end if;
 perform public.notification_prepare();
 if (select count(*) from public.notification_occurrences where item_id=task)<>n then raise exception 'Duplicate occurrences'; end if;
 insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth) values
 (sub1,u,'https://fcm.googleapis.com/notification-test-'||sub1,repeat('A',87),repeat('A',22)),
 (sub2,u,'https://fcm.googleapis.com/notification-test-'||sub2,repeat('A',87),repeat('A',22));
 perform public.notification_claim_push();perform public.notification_claim_push();
 if (select count(*) from public.notification_push_deliveries d join public.notification_occurrences o on o.id=d.occurrence_id where o.item_id=task)<>2 then raise exception 'Must claim once per device'; end if;
 insert into public.notification_reads(user_id,source_table,item_id,revision) select u,'activities',task,revision from public.notification_items where id=task;
 if (select status from public.activities where id=task)<>'scheduled' then raise exception 'Reading completed task'; end if;
 update public.activities set start_at=now()+interval '1 day' where id=task;perform public.notification_prepare();
 if exists(select 1 from public.notification_occurrences where item_id=task and offset_minutes=15 and scheduled_for<=now() and status='active') then raise exception 'Old reminder after reschedule'; end if;
 update public.activities set status='completed' where id=task;perform public.notification_prepare();
 if exists(select 1 from public.notification_occurrences where item_id=task and status='active') then raise exception 'Completed reminder active'; end if;
 update public.activities set status='scheduled',has_time=false,due_date=current_date,start_at=null where id=task;perform public.notification_prepare();
 if exists(select 1 from public.notification_occurrences where item_id=task and status='active') then raise exception 'Date only push'; end if;
 update public.activities set has_time=true,start_at=now()+interval '15 minutes',reminder_offsets=null where id=task;perform public.notification_prepare();
 update public.notification_preferences set task_offsets='{}' where user_id=u;perform public.notification_prepare();
 if exists(select 1 from public.notification_occurrences where item_id=task and status='active') then raise exception 'Old preference reminder active'; end if;
 insert into public.activities(id,client_id,kind,title,summary,interaction_type,actor_id,assigned_to,start_at,occurred_at,status,source_module,reminder_offsets)
 values(event,c,'meeting','Transactional agenda test','Transactional test','Reunião',u,u,now(),now(),'scheduled','agenda',array[0]);perform public.notification_prepare();
 if not exists(select 1 from public.notification_occurrences where item_id=event and status='active') then raise exception 'Agenda missing'; end if;
 update public.activities set status='cancelled' where id=event;perform public.notification_prepare();
 if exists(select 1 from public.notification_occurrences where item_id=event and status='active') then raise exception 'Cancelled agenda active'; end if;
 if has_function_privilege('authenticated','public.notification_sender_keys()','execute') or has_function_privilege('anon','public.notification_prepare()','execute') then raise exception 'Secret/service privilege exposed'; end if;
 if exists(select 1 from pg_class where relname in ('notification_preferences','push_subscriptions','notification_reads','notification_daily_views','notification_occurrences','notification_toast_receipts','notification_push_deliveries') and not relrowsecurity) then raise exception 'RLS missing'; end if;
end $$;
rollback;
select 'Passed: reminder offsets, idempotency, two devices, read versus completed, reschedule, completion, date-only, preference changes, agenda cancellation, RLS and service privileges' result;
