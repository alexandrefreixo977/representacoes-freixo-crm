create or replace function public.notification_followup_date() returns trigger language plpgsql set search_path='' as $$
begin
 -- Source-triggered follow-ups carry dates; a user's explicit reschedule may add a time.
 if new.follow_up_source_id is not null and (tg_op='INSERT' or pg_trigger_depth()>1) then
 select next_action_date into new.due_date from public.activities where id=new.follow_up_source_id;
 new.has_time=false;
 end if;
 return new;
end $$;
