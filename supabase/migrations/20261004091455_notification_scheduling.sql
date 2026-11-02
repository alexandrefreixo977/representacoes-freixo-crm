create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create function public.notification_configure(public_key text,private_key text,cron_key text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from vault.secrets where name='notification_vapid_public') then
 perform vault.create_secret(public_key,'notification_vapid_public');
 perform vault.create_secret(private_key,'notification_vapid_private');
 end if;
 if not exists(select 1 from vault.secrets where name='notification_cron_key') then perform vault.create_secret(cron_key,'notification_cron_key'); end if;
end $$;
revoke all on function public.notification_configure(text,text,text) from public,anon,authenticated;
grant execute on function public.notification_configure(text,text,text) to service_role;
select cron.schedule('freixo-notification-dispatch','* * * * *',$job$
 select net.http_post(url:='https://ubkscstjgcrrxpudvoie.supabase.co/functions/v1/notification-dispatch',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='notification_cron_key')),
 body:='{}'::jsonb,timeout_milliseconds:=50000);
$job$);

-- Date-only follow-ups remain date-only, including after their source is edited.
create function public.notification_followup_date() returns trigger language plpgsql set search_path='' as $$
begin
 if new.follow_up_source_id is not null then
 select next_action_date into new.due_date from public.activities where id=new.follow_up_source_id;
 new.has_time=false;
 end if;
 return new;
end $$;
create trigger notification_followup_date before insert or update of start_at,follow_up_source_id on public.activities for each row execute function public.notification_followup_date();

-- Narrow pending-record indexes support the owner/date queries without indexing historical mail.
create index notification_activity_pending_owner on public.activities(coalesce(assigned_to,actor_id),start_at) where status not in ('completed','done','cancelled','canceled','archived') and (kind='task' or source_module in ('agenda','visits'));
create index notification_task_pending_owner on public.tasks(coalesce(assignee_id,created_by),due_at) where status not in ('completed','done','cancelled','canceled','archived');
