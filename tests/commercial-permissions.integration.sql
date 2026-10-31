-- Fixtures and temporary permission changes are rolled back. No email is sent.
begin;
select set_config('qa.admin',(select id::text from public.profiles where role='admin' and active limit 1),true);
select set_config('qa.commercial',(select id::text from public.profiles where role='commercial' and active limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('qa.admin'),true);
set local role authenticated;
do $$
declare cid uuid; contact uuid;mid uuid;rel uuid;eid uuid;n integer;fresh uuid;
begin
 select id into strict mid from public.manufacturers where active and deleted_at is null limit 1;
 insert into public.clients(code,trade_name,email,is_lead,owner_id,created_by,created_at)
 values('QA-'||gen_random_uuid(),'QA conditions lead','qa@example.invalid',true,current_setting('qa.commercial')::uuid,auth.uid(),now()-interval '1 day') returning id into cid;
 insert into public.client_contacts(client_id,first_name,email)values(cid,'QA','qa@example.invalid')returning id into contact;
 insert into public.client_manufacturers(client_id,manufacturer_id)values(cid,mid)returning id into rel;
 perform set_config('request.jwt.claim.sub',current_setting('qa.commercial'),true);
 if not exists(select 1 from public.clients where id=cid) then raise exception 'Assigned lead not visible';end if;
 if exists(select 1 from public.clients where owner_id<>auth.uid())then raise exception 'Other clients visible';end if;
 if public.has_crm_permission('clients.edit')or public.has_crm_permission('contacts.manage')or public.has_crm_permission('client_terms.manage')then raise exception 'Default permissions not locked';end if;
 update public.clients set trade_name='Forbidden' where id=cid;get diagnostics n=row_count;if n<>0 then raise exception 'Client writable';end if;
 update public.client_contacts set first_name='Forbidden' where id=contact;get diagnostics n=row_count;if n<>0 then raise exception 'Contact writable';end if;
 update public.client_manufacturers set agreed_discount=.99 where id=rel;get diagnostics n=row_count;if n<>0 then raise exception 'Terms writable';end if;
 delete from public.clients where id=cid;get diagnostics n=row_count;if n<>0 then raise exception 'Client deletable';end if;
 begin insert into public.client_contacts(client_id,first_name)values(cid,'Forbidden');raise exception 'Contact insert allowed';exception when insufficient_privilege then null;end;
 begin insert into public.client_manufacturers(client_id,manufacturer_id)values(cid,mid);raise exception 'Terms insert allowed';exception when insufficient_privilege then null;end;
 update public.role_permissions set allowed=true where role='commercial'and permission='clients.edit';get diagnostics n=row_count;if n<>0 then raise exception 'Commercial changed permissions';end if;
 begin insert into public.role_permissions values('commercial','qa.escalation',true);raise exception 'Permission escalation allowed';exception when insufficient_privilege then null;end;
 eid=public.record_manufacturer_conditions(cid,mid,'QA conditions','<p>QA</p>','QA','{"to":["qa@example.invalid"],"cc":["qa-cc@example.invalid"]}','{"items":["base"]}');
 if not exists(select 1 from public.emails where id=eid and client_id=cid)or not exists(select 1 from public.activities where entity_id=eid and client_id=cid)or not exists(select 1 from public.manufacturer_client_communications where email_id=eid and client_id=cid)or(select count(*)from public.email_recipients where email_id=eid)<>2 then raise exception 'Lead history incomplete';end if;
 insert into public.activities(client_id,kind,interaction_type,actor_id,assigned_to,title,summary,status)values(cid,'call','Chamada',auth.uid(),auth.uid(),'QA activity','QA activity','completed');
 -- Initial contact remains possible in the same transaction that creates a lead.
 insert into public.clients(code,trade_name,email,is_lead,owner_id,created_by)values('QA-'||gen_random_uuid(),'QA new lead','qa-new@example.invalid',true,auth.uid(),auth.uid())returning id into fresh;
 insert into public.client_contacts(client_id,first_name,email)values(fresh,'Initial contact','qa-new@example.invalid');
 perform set_config('request.jwt.claim.sub',current_setting('qa.admin'),true);
 update public.role_permissions set allowed=true where role='commercial'and permission in('clients.edit','contacts.manage','client_terms.manage');
 update public.role_permissions set allowed=false where role='commercial'and permission='workflow.own';
 perform set_config('request.jwt.claim.sub',current_setting('qa.commercial'),true);
 update public.clients set phone='QA'where id=cid;get diagnostics n=row_count;if n<>1 then raise exception 'Configured edit not effective';end if;
 update public.client_contacts set first_name='QA edited'where id=contact;get diagnostics n=row_count;if n<>1 then raise exception 'Configured contact edit not effective';end if;
 update public.client_manufacturers set agreed_discount=.1 where id=rel;get diagnostics n=row_count;if n<>1 then raise exception 'Configured terms edit not effective';end if;
 begin insert into public.activities(client_id,kind,interaction_type,actor_id,assigned_to,title,summary,status)values(cid,'call','Chamada',auth.uid(),auth.uid(),'Forbidden','Forbidden','completed');raise exception 'Workflow permission ineffective';exception when insufficient_privilege then null;end;
 eid=public.record_manufacturer_conditions(cid,mid,'QA email without workflow','<p>QA</p>','QA','{"to":["qa@example.invalid"]}','{}');
 perform set_config('request.jwt.claim.sub',current_setting('qa.admin'),true);
 update public.role_permissions set allowed=false where role='commercial'and permission='emails.own';
 perform set_config('request.jwt.claim.sub',current_setting('qa.commercial'),true);
 if public.has_crm_permission('emails.own')then raise exception 'Email permission ineffective';end if;
 begin perform public.record_manufacturer_conditions(cid,mid,'Forbidden','QA','QA','{"to":["qa@example.invalid"]}','{}');raise exception 'Email log allowed';exception when others then if sqlerrm='Email log allowed'then raise;end if;end;
 perform set_config('request.jwt.claim.sub',current_setting('qa.admin'),true);
 update public.clients set phone='QA admin'where id=cid;get diagnostics n=row_count;if n<>1 then raise exception 'Admin edit blocked';end if;
end $$;
rollback;
