-- Bound all existing permissive activity policies to the assigned commercial.
-- Unassigned legacy records belong to their author; administrators retain team access.
create policy "activities personal scope"
on public.activities as restrictive for all to authenticated
using (public.current_role() = 'admin' or coalesce(assigned_to, actor_id) = (select auth.uid()))
with check (public.current_role() = 'admin' or coalesce(assigned_to, actor_id) = (select auth.uid()));
create policy "activities deletion requires admin"
on public.activities as restrictive for delete to authenticated
using (public.current_role() = 'admin');
