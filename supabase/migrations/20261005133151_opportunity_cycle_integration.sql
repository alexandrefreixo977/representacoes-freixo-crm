create or replace function crm_internal.validate_opportunity() returns trigger language plpgsql set search_path='' as $$
declare stage_name text;
begin
 if auth.uid() is not null and not exists(select 1 from public.clients c where c.id=new.client_id) then raise exception 'Cliente não autorizado';end if;
 if new.contact_id is not null and not exists(select 1 from public.client_contacts where id=new.contact_id and client_id=new.client_id) then raise exception 'O contacto não pertence ao cliente';end if;
 if new.family_id is not null and not exists(select 1 from public.catalog_product_families where id=new.family_id and manufacturer_id=new.manufacturer_id)then raise exception 'Família e fabricante incompatíveis';end if;
 if not exists(select 1 from public.profiles where id=new.seller_id and active)then raise exception 'Responsável inválido';end if;
 if not exists(select 1 from pg_timezone_names where name=new.schedule_timezone)then raise exception 'Fuso horário inválido';end if;
 if new.estimated_value<0 then raise exception 'Valor inválido';end if;
 select name into stage_name from public.opportunity_stages where id=new.stage_id;
 if new.outcome='archived' and (tg_op='INSERT' or old.stage_id is not distinct from new.stage_id)then null;elsif stage_name='Ganha' then new.outcome='won';elsif stage_name='Perdida' then new.outcome='lost';elsif new.outcome in ('won','lost','archived')then new.outcome='active';end if;
 if new.outcome='lost' and nullif(trim(new.loss_reason),'') is null then raise exception 'Indique o motivo de perda';end if;
 if new.winning_proposal_id is not null and not exists(select 1 from public.catalog_orders where id=new.winning_proposal_id and opportunity_id=new.id and document_type='proposal')then raise exception 'Proposta vencedora inválida';end if;
 new.closed_at=case when new.outcome in ('won','lost')then coalesce(new.closed_at,now())else null end;
 new.updated_at=now();new.updated_by=auth.uid();if tg_op='INSERT'then new.created_by=auth.uid();end if;
 return new;
end $$;
create or replace function crm_internal.lead_profile_changed()returns trigger language plpgsql security definer set search_path='' as $$
declare missing text[];tz text;
begin
 if not new.is_lead then return new;end if;missing=public.client_missing_fields(new);
 if cardinality(missing)=0 then
 update public.clients set is_lead=false where id=new.id;
 update public.activities set status='completed',completed_at=now(),updated_at=now()where source_module='lead_profile'and source_record_id=new.id and status<>'completed';
 else
 select coalesce(timezone,'Europe/Lisbon')into tz from public.notification_preferences where user_id=new.owner_id;
 insert into public.activities(client_id,kind,interaction_type,title,summary,description,actor_id,assigned_to,status,source_module,source_record_id,has_time,due_date)
 values(new.id,'task','Tarefa','Completar ficha do cliente','Completar ficha do cliente',array_to_string(missing,', '),coalesce(auth.uid(),new.created_by),coalesce(new.owner_id,new.created_by),'scheduled','lead_profile',new.id,false,(now() at time zone coalesce(tz,'Europe/Lisbon'))::date)
 on conflict(source_module,source_record_id) where source_record_id is not null do update set description=excluded.description,assigned_to=excluded.assigned_to,status='scheduled',updated_at=now();
 end if;return new;
end $$;
create or replace function crm_internal.opportunity_activity_changed()returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.opportunity_id is null then return new;end if;
 if tg_op='INSERT' or old.opportunity_id is distinct from new.opportunity_id or old.status is distinct from new.status then insert into public.opportunity_events(opportunity_id,actor_id,event_type,title,detail,entity_id)values(new.opportunity_id,auth.uid(),'activity',case when tg_op='INSERT' or old.opportunity_id is distinct from new.opportunity_id then new.interaction_type||' criada'else new.interaction_type||': '||case new.status when 'completed'then 'Concluída'when 'cancelled'then 'Cancelada'else new.status end end,new.title,new.id);end if;
 if pg_trigger_depth()=1 and new.opportunity_role='next_action' then update public.opportunities set next_action=new.title,next_action_date=case when new.has_time then (new.start_at at time zone new.schedule_timezone)::date else new.due_date end,next_action_time=case when new.has_time then (new.start_at at time zone new.schedule_timezone)::time else null end,schedule_timezone=new.schedule_timezone,last_activity_at=now()where id=new.opportunity_id;end if;
 return new;
end $$;
create or replace function crm_internal.validate_commercial_document()returns trigger language plpgsql set search_path='' as $$
begin
 if new.opportunity_id is not null and not exists(select 1 from public.opportunities o where o.id=new.opportunity_id and o.client_id=new.client_id and(o.manufacturer_id is null or o.manufacturer_id=new.manufacturer_id))then raise exception 'Documento incompatível com a oportunidade';end if;
 if new.contact_id is not null and not exists(select 1 from public.client_contacts where id=new.contact_id and client_id=new.client_id)then raise exception 'Contacto inválido';end if;
 if new.document_type='order'and new.status not in ('draft','cancelled')and new.opportunity_id is not null and exists(select 1 from public.clients c where c.id=new.client_id and cardinality(public.client_missing_fields(c))>0)then raise exception 'Complete a ficha do cliente antes de formalizar a encomenda';end if;
 return new;
end $$;
create or replace function public.commercial_save_document(payload jsonb)returns uuid language plpgsql security invoker set search_path='' as $$
declare did uuid;oid uuid;doc public.catalog_orders;p public.catalog_products;l jsonb;discount numeric;net numeric;qty numeric;total_value numeric:=0;kind text;num text;cid uuid;mid uuid;variant uuid;
begin
 if not public.has_catalog_orders_beta_access()then raise exception 'Catálogo não autorizado';end if;
 oid=nullif(payload->>'opportunity_id','')::uuid;cid=(payload->>'client_id')::uuid;mid=(payload->>'manufacturer_id')::uuid;kind=coalesce(payload->>'document_type','order');
 if oid is not null then perform 1 from public.opportunities where id=oid for update;if not found then raise exception 'Oportunidade não autorizada';end if;end if;
 if not exists(select 1 from public.clients where id=cid)then raise exception 'Cliente não autorizado';end if;
 if coalesce(jsonb_array_length(payload->'lines'),0)not between 1 and 200 then raise exception 'Selecione entre 1 e 200 produtos';end if;
 did=nullif(payload->>'id','')::uuid;
 if did is not null then select * into strict doc from public.catalog_orders where id=did for update;if doc.status<>'draft'or doc.proposal_status<>'draft'or doc.opportunity_id is distinct from oid or doc.client_id is distinct from cid or doc.manufacturer_id is distinct from mid or doc.document_type<>kind then raise exception 'Crie uma revisão para preservar este documento';end if;
 update public.catalog_orders set contact_id=nullif(payload->>'contact_id','')::uuid,notes=payload->>'notes',updated_at=now()where id=did;delete from public.catalog_order_lines where order_id=did;
 else
 num=case when kind='proposal'then 'PR-'else 'EN-'end||extract(year from now())::text||'-'||lpad(nextval('public.commercial_document_seq')::text,5,'0');
 insert into public.catalog_orders(order_number,client_id,contact_id,manufacturer_id,seller_id,created_by,currency,document_type,opportunity_id,notes)values(num,cid,nullif(payload->>'contact_id','')::uuid,mid,coalesce((select seller_id from public.opportunities where id=oid),auth.uid()),auth.uid(),coalesce(payload->>'currency','EUR'),kind,oid,payload->>'notes')returning id into did;
 end if;
 for l in select * from jsonb_array_elements(payload->'lines')loop
 select * into strict p from public.catalog_products where id=(l->>'product_id')::uuid and manufacturer_id=mid and active;
 variant=nullif(l->>'variant_id','')::uuid;if variant is not null and not exists(select 1 from public.catalog_product_variants where id=variant and product_id=p.id)then raise exception 'Variante inválida';end if;
 qty=(l->>'quantity')::numeric;net=(l->>'list_price_snapshot')::numeric;if qty is null or net is null or qty<=0 or net<0 then raise exception 'Quantidade/preço inválidos';end if;
 for discount in select value::numeric from jsonb_array_elements_text(coalesce(l->'applied_discounts','[]'))loop if discount<0 or discount>100 then raise exception 'Desconto inválido';end if;net=net*(1-discount/100);end loop;net=round(net,2);
 insert into public.catalog_order_lines(order_id,product_id,variant_id,reference_snapshot,designation_snapshot,quantity,list_price_snapshot,automatic_discounts,applied_discounts,net_unit_price,line_total,discount_manually_changed,discount_changed_by,discount_changed_at)
 values(did,p.id,variant,coalesce((select reference from public.catalog_product_variants where id=variant),p.reference),concat_ws(' — ',p.designation,(select nullif(designation_suffix,'') from public.catalog_product_variants where id=variant)),qty,(l->>'list_price_snapshot')::numeric,array(select value::numeric from jsonb_array_elements_text(coalesce(l->'automatic_discounts','[]'))),array(select value::numeric from jsonb_array_elements_text(coalesce(l->'applied_discounts','[]'))),net,round(net*qty,2),coalesce((l->>'discount_manually_changed')::boolean,false),auth.uid(),now());total_value=total_value+round(net*qty,2);
 end loop;
 update public.catalog_orders set subtotal=total_value,total=total_value+shipping+tax,updated_at=now()where id=did;return did;
end $$;
-- Related rows retain the same opportunity access boundary.
create policy linked_activity_access on public.activities as restrictive for all to authenticated
 using(opportunity_id is null or exists(select 1 from public.opportunities o where o.id=opportunity_id))
 with check(opportunity_id is null or exists(select 1 from public.opportunities o where o.id=opportunity_id and o.client_id=activities.client_id));
create policy linked_email_access on public.emails as restrictive for all to authenticated
 using(opportunity_id is null or exists(select 1 from public.opportunities o where o.id=opportunity_id))
 with check(opportunity_id is null or exists(select 1 from public.opportunities o where o.id=opportunity_id and o.client_id=emails.client_id));
create function public.opportunity_record_email(oid uuid,proposal uuid,mail_subject text,html text,plain text,recipients jsonb)returns uuid language plpgsql security invoker set search_path='' as $$
declare o public.opportunities;eid uuid;addr text;recipient_kind text;
begin
 select * into strict o from public.opportunities where id=oid for update;
 if proposal is not null and not exists(select 1 from public.catalog_orders where id=proposal and opportunity_id=oid and document_type='proposal')then raise exception 'Proposta inválida';end if;
 insert into public.emails(client_id,opportunity_id,sender_id,subject,body_html,status,sent_at)values(o.client_id,oid,auth.uid(),mail_subject,html,'sent',now())returning id into eid;
 foreach recipient_kind in array array['to','cc','bcc']loop
 for addr in select jsonb_array_elements_text(coalesce(recipients->recipient_kind,'[]'))loop
 insert into public.email_recipients(email_id,address,recipient_type)values(eid,addr,recipient_kind);
 end loop;end loop;
 insert into public.activities(client_id,opportunity_id,kind,interaction_type,title,subject,summary,description,actor_id,assigned_to,entity_id,status,source_module,occurred_at)
 values(o.client_id,oid,'email','Email',mail_subject,mail_subject,'Email enviado: '||mail_subject,plain,auth.uid(),o.seller_id,eid,'sent','opportunities',now());
 if proposal is not null then update public.catalog_orders set proposal_status=case when proposal_status='accepted'then 'accepted'else 'sent'end,sent_at=now(),updated_at=now()where id=proposal;end if;
 update public.opportunities set last_activity_at=now()where id=oid;
 return eid;
end $$;
revoke all on function public.opportunity_record_email(uuid,uuid,text,text,text,jsonb)from public,anon;
grant execute on function public.opportunity_record_email(uuid,uuid,text,text,text,jsonb)to authenticated;
