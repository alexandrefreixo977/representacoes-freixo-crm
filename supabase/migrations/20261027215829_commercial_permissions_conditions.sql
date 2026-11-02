-- Keep the existing role model and ownership policies. Additional restrictive
-- policies cannot widen access granted by any existing policy.
insert into public.role_permissions(role,permission,allowed) values
 ('commercial','clients.edit',false),
 ('commercial','contacts.manage',false),
 ('commercial','client_terms.manage',false)
on conflict(role,permission) do update set allowed=excluded.allowed;

create or replace function public.has_crm_permission(permission_name text)
returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce(public.current_role()='admin' or exists(
  select 1 from public.role_permissions r
  where r.role=public.current_role() and r.permission=permission_name and r.allowed
 ),false)
$$;
revoke all on function public.has_crm_permission(text) from public,anon;
grant execute on function public.has_crm_permission(text) to authenticated;

create policy "client editing permission" on public.clients as restrictive for update to authenticated
 using(public.has_crm_permission('clients.edit')) with check(public.has_crm_permission('clients.edit'));
create policy "client deletion admin" on public.clients as restrictive for delete to authenticated
 using(public.current_role()='admin');
create policy "contact editing permission" on public.client_contacts as restrictive for update to authenticated
 using(public.has_crm_permission('contacts.manage')) with check(public.has_crm_permission('contacts.manage'));
create policy "contact deletion permission" on public.client_contacts as restrictive for delete to authenticated
 using(public.has_crm_permission('contacts.manage'));
-- Preserve atomic new-lead creation with its initial contact, without permitting
-- additional contacts or edits to an existing dossier.
create policy "contact creation permission" on public.client_contacts as restrictive for insert to authenticated
 with check(public.has_crm_permission('contacts.manage') or exists(
  select 1 from public.clients c where c.id=client_id and c.is_lead
   and c.created_by=auth.uid() and c.owner_id=auth.uid() and c.created_at=transaction_timestamp()
 ));
create policy "client terms insert permission" on public.client_manufacturers as restrictive for insert to authenticated
 with check(public.has_crm_permission('client_terms.manage'));
create policy "client terms update permission" on public.client_manufacturers as restrictive for update to authenticated
 using(public.has_crm_permission('client_terms.manage')) with check(public.has_crm_permission('client_terms.manage'));
create policy "client terms delete permission" on public.client_manufacturers as restrictive for delete to authenticated
 using(public.has_crm_permission('client_terms.manage'));

do $$ declare t text; begin
 foreach t in array array['tasks','visits','opportunities'] loop
  execute format('create policy "workflow insert permission" on public.%I as restrictive for insert to authenticated with check(public.has_crm_permission(''workflow.own''))',t);
  execute format('create policy "workflow update permission" on public.%I as restrictive for update to authenticated using(public.has_crm_permission(''workflow.own'')) with check(public.has_crm_permission(''workflow.own''))',t);
  execute format('create policy "workflow delete permission" on public.%I as restrictive for delete to authenticated using(public.has_crm_permission(''workflow.own''))',t);
 end loop;
end $$;
create policy "activity insert permission" on public.activities as restrictive for insert to authenticated
 with check(public.has_crm_permission(case when kind='email' then 'emails.own' else 'workflow.own' end));
create policy "activity update permission" on public.activities as restrictive for update to authenticated
 using(public.has_crm_permission(case when kind='email' then 'emails.own' else 'workflow.own' end))
 with check(public.has_crm_permission(case when kind='email' then 'emails.own' else 'workflow.own' end));
create policy "activity delete permission" on public.activities as restrictive for delete to authenticated
 using(public.has_crm_permission(case when kind='email' then 'emails.own' else 'workflow.own' end));

create policy "communications assigned scope" on public.manufacturer_client_communications as restrictive for select to authenticated
 using(public.current_role()='admin' or (sender_id=auth.uid() and exists(select 1 from public.clients c where c.id=client_id)));
create policy "communications permission" on public.manufacturer_client_communications as restrictive for insert to authenticated
 with check(public.has_crm_permission('emails.own') and exists(select 1 from public.clients c where c.id=client_id));

-- One transaction records all history after Graph accepts the message. Leads use
-- the same client ID; no second lead table or conversion is required.
create function public.record_manufacturer_conditions(cid uuid,mid uuid,mail_subject text,html text,plain text,recipients jsonb,conditions jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare eid uuid;stamp timestamptz:=now();brand text;
begin
 if not public.has_crm_permission('emails.own') or not exists(select 1 from public.clients where id=cid and archived_at is null) then
  raise exception 'Cliente ou Lead não autorizado';end if;
 select name into strict brand from public.manufacturers where id=mid and active and deleted_at is null;
 if jsonb_array_length(recipients->'to')<1 then raise exception 'Destinatário em falta';end if;
 insert into public.emails(client_id,sender_id,subject,body_html,status,sent_at)
 values(cid,auth.uid(),mail_subject,html,'sent',stamp) returning id into eid;
 insert into public.email_recipients(email_id,address,recipient_type)
 select eid,value,'to' from jsonb_array_elements_text(recipients->'to')
 union all select eid,value,'cc' from jsonb_array_elements_text(coalesce(recipients->'cc','[]'));
 insert into public.activities(client_id,manufacturer_id,kind,interaction_type,actor_id,entity_id,title,subject,summary,description,result,status,source_module,occurred_at,start_at)
 values(cid,mid,'email','Condições comerciais',auth.uid(),eid,mail_subject,mail_subject,'Condições comerciais '||brand||' enviadas',plain,'Para '||(recipients->'to'->>0),'sent','manufacturers',stamp,stamp);
 insert into public.manufacturer_client_communications(manufacturer_id,client_id,email_id,sender_id,recipient,cc,subject,selected_conditions,status,sent_at)
 values(mid,cid,eid,auth.uid(),recipients->'to'->>0,(select string_agg(value,'; ') from jsonb_array_elements_text(coalesce(recipients->'cc','[]'))),mail_subject,coalesce(conditions,'{}'),'sent',stamp);
 return eid;
end $$;
revoke all on function public.record_manufacturer_conditions(uuid,uuid,text,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.record_manufacturer_conditions(uuid,uuid,text,text,text,jsonb,jsonb) to authenticated;
