create schema if not exists crm_internal;
revoke all on schema crm_internal from public,anon,authenticated;
create sequence public.opportunity_reference_seq;
create sequence public.commercial_document_seq;
grant usage on sequence public.opportunity_reference_seq,public.commercial_document_seq to authenticated;
alter table public.clients add column is_lead boolean not null default false,add column client_kind text not null default 'company' check(client_kind in ('company','person'));
create function public.client_missing_fields(c public.clients) returns text[] language sql immutable set search_path='' as $$
 select array_remove(array[
 case when nullif(trim(c.trade_name),'') is null then 'Nome' end,
 case when nullif(trim(c.email),'') is null then 'Email' end,
 case when nullif(trim(c.phone),'') is null then 'Telefone' end,
 case when nullif(trim(c.address),'') is null then 'Morada' end,
 case when nullif(trim(c.city),'') is null then 'Localidade' end,
 case when nullif(trim(c.country),'') is null then 'País' end,
 case when lower(c.country) in ('pt','portugal') and c.client_kind='company' and nullif(trim(c.tax_id),'') is null then 'NIF/NIPC' end,
 case when lower(c.country) in ('pt','portugal') and nullif(trim(c.postal_code),'') is null then 'Código postal' end],null)
$$;
alter table public.opportunities
 add column reference text unique default ('OP-'||extract(year from now())::text||'-'||lpad(nextval('public.opportunity_reference_seq')::text,5,'0')),
 add column manufacturer_id uuid references public.manufacturers(id),add column family_id uuid references public.catalog_product_families(id),
 add column need text,add column currency text not null default 'EUR' check(currency ~ '^[A-Z]{3}$'),
 add column outcome text not null default 'active' check(outcome in ('active','won','lost','archived')),
 add column next_action_date date,add column next_action_time time,add column schedule_timezone text not null default 'Europe/Lisbon',
 add column action_kind text not null default 'task' check(action_kind in ('task','meeting','visit','call')),
 add column priority smallint not null default 3 check(priority between 1 and 5),
 add column closed_at timestamptz,add column final_value numeric check(final_value>=0),
 add column created_by uuid references public.profiles(id),add column updated_by uuid references public.profiles(id),
 add column last_activity_at timestamptz not null default now();
insert into public.opportunity_stages(name,position,probability,terminal)
 select n,p,v,t from (values('Lead identificado',1,10,false),('Qualificado',2,25,false),('Necessidade confirmada',3,40,false),('Proposta enviada',4,60,false),('Negociação',5,80,false),('Ganha',6,100,true),('Perdida',7,0,true)) s(n,p,v,t)
 where not exists(select 1 from public.opportunity_stages x where lower(x.name)=lower(s.n));
alter table public.opportunity_stages enable row level security;
create policy stages_read on public.opportunity_stages for select to authenticated using(true);
create policy stages_admin on public.opportunity_stages for all to authenticated using(public.current_role()='admin') with check(public.current_role()='admin');
grant select on public.opportunity_stages to authenticated;
alter table public.activities add column opportunity_id uuid references public.opportunities(id),add column opportunity_role text;
create unique index opportunity_next_activity on public.activities(opportunity_id) where opportunity_role='next_action';
create index activity_opportunity on public.activities(opportunity_id,occurred_at desc) where opportunity_id is not null;
alter table public.catalog_orders add column opportunity_id uuid references public.opportunities(id),
 add column document_type text not null default 'order' check(document_type in ('order','proposal')),
 add column proposal_status text not null default 'draft' check(proposal_status in ('draft','sent','accepted','rejected')),
 add column source_proposal_id uuid references public.catalog_orders(id),add column sent_at timestamptz,add column accepted_at timestamptz;
create unique index order_from_proposal_once on public.catalog_orders(source_proposal_id) where source_proposal_id is not null;
create unique index order_from_opportunity_once on public.catalog_orders(opportunity_id) where document_type='order' and opportunity_id is not null;
create index document_opportunity on public.catalog_orders(opportunity_id,created_at desc);
alter table public.opportunities add column winning_proposal_id uuid references public.catalog_orders(id);
create table public.opportunity_events(id uuid primary key default gen_random_uuid(),opportunity_id uuid not null references public.opportunities(id),actor_id uuid references public.profiles(id),event_type text not null,title text not null,detail text,entity_id uuid,created_at timestamptz not null default now());
alter table public.opportunity_events enable row level security;
create policy opportunity_events_read on public.opportunity_events for select to authenticated using(exists(select 1 from public.opportunities o where o.id=opportunity_id));
revoke all on public.opportunity_events from anon,authenticated;
grant select on public.opportunity_events to authenticated;
create index opportunity_events_feed on public.opportunity_events(opportunity_id,created_at desc);
create index opportunity_owner_pipeline on public.opportunities(seller_id,outcome,stage_id,updated_at desc);
create index opportunity_manufacturer on public.opportunities(manufacturer_id) where manufacturer_id is not null;
create index clients_normalized_email on public.clients(lower(email)) where archived_at is null;

create function crm_internal.validate_opportunity() returns trigger language plpgsql set search_path='' as $$
declare stage_name text;
begin
 if auth.uid() is not null and not exists(select 1 from public.clients c where c.id=new.client_id) then raise exception 'Cliente não autorizado';end if;
 if new.contact_id is not null and not exists(select 1 from public.client_contacts where id=new.contact_id and client_id=new.client_id) then raise exception 'O contacto não pertence ao cliente';end if;
 if new.family_id is not null and not exists(select 1 from public.catalog_product_families where id=new.family_id and manufacturer_id=new.manufacturer_id)then raise exception 'Família e fabricante incompatíveis';end if;
 if not exists(select 1 from public.profiles where id=new.seller_id and active)then raise exception 'Responsável inválido';end if;
 if not exists(select 1 from pg_timezone_names where name=new.schedule_timezone)then raise exception 'Fuso horário inválido';end if;
 if new.estimated_value<0 then raise exception 'Valor inválido';end if;
 select name into stage_name from public.opportunity_stages where id=new.stage_id;
 if stage_name='Ganha' then new.outcome='won';elsif stage_name='Perdida' then new.outcome='lost';elsif new.outcome in ('won','lost')then new.outcome='active';end if;
 if new.outcome='lost' and nullif(trim(new.loss_reason),'') is null then raise exception 'Indique o motivo de perda';end if;
 if new.winning_proposal_id is not null and not exists(select 1 from public.catalog_orders where id=new.winning_proposal_id and opportunity_id=new.id and document_type='proposal')then raise exception 'Proposta vencedora inválida';end if;
 new.closed_at=case when new.outcome in ('won','lost')then coalesce(new.closed_at,now())else null end;
 new.updated_at=now();new.updated_by=auth.uid();if tg_op='INSERT'then new.created_by=auth.uid();end if;
 return new;
end $$;
create trigger opportunity_validate before insert or update on public.opportunities for each row execute function crm_internal.validate_opportunity();

create function crm_internal.opportunity_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare title text;st text;at_time timestamptz;task_status text;tz text;
begin
 select name into st from public.opportunity_stages where id=new.stage_id;
 if tg_op='INSERT' then title='Oportunidade criada';elsif old.stage_id is distinct from new.stage_id then title=case when old.outcome in ('won','lost') and new.outcome='active' then 'Oportunidade reaberta' else 'Fase: '||st end;elsif old.seller_id is distinct from new.seller_id then title='Responsável alterado';elsif old.outcome is distinct from new.outcome then title='Oportunidade arquivada';end if;
 if title is not null then insert into public.opportunity_events(opportunity_id,actor_id,event_type,title)values(new.id,auth.uid(),'opportunity',title);end if;
 if pg_trigger_depth()>1 then return new;end if;
 tz=new.schedule_timezone;
 if new.outcome='active' and nullif(trim(new.next_action),'') is not null and new.next_action_date is not null then
 at_time=case when new.next_action_time is not null then (new.next_action_date+new.next_action_time) at time zone tz else null end;
 insert into public.activities(client_id,kind,interaction_type,title,summary,actor_id,assigned_to,start_at,occurred_at,status,source_module,source_record_id,has_time,due_date,schedule_timezone,opportunity_id,opportunity_role)
 values(new.client_id,new.action_kind::public.activity_kind,case new.action_kind when 'task'then 'Tarefa'when 'visit'then 'Visita'when 'meeting'then 'Reunião'else 'Chamada'end,new.next_action,new.next_action,coalesce(auth.uid(),new.created_by,new.seller_id),new.seller_id,at_time,coalesce(at_time,now()),'scheduled',case when new.action_kind='task'then 'opportunity_followup'else 'agenda'end,new.id,at_time is not null,new.next_action_date,tz,new.id,'next_action')
 on conflict(opportunity_id) where opportunity_role='next_action' do update set title=excluded.title,summary=excluded.summary,client_id=excluded.client_id,assigned_to=excluded.assigned_to,kind=excluded.kind,interaction_type=excluded.interaction_type,start_at=excluded.start_at,has_time=excluded.has_time,due_date=excluded.due_date,schedule_timezone=excluded.schedule_timezone,source_module=excluded.source_module,updated_at=now(),status=case when activities.start_at is distinct from excluded.start_at or activities.due_date is distinct from excluded.due_date or activities.title is distinct from excluded.title or activities.status='cancelled' then 'scheduled'else activities.status end;
 else update public.activities set status='cancelled',updated_at=now() where opportunity_id=new.id and opportunity_role='next_action' and status not in ('completed','done','cancelled');end if;
 if new.outcome='active' and (nullif(trim(new.next_action),'') is null or new.next_action_date is null)then
 insert into public.activities(client_id,kind,interaction_type,title,summary,actor_id,assigned_to,status,source_module,source_record_id,has_time,due_date,opportunity_id)
 values(new.client_id,'task','Tarefa','Definir próxima ação — '||new.title,'Definir próxima ação',coalesce(auth.uid(),new.seller_id),new.seller_id,'scheduled','opportunity_attention',new.id,false,(now() at time zone tz)::date,new.id)
 on conflict(source_module,source_record_id) where source_record_id is not null do update set assigned_to=excluded.assigned_to,title=excluded.title,status='scheduled',updated_at=now();
 else update public.activities set status='completed',completed_at=now(),updated_at=now() where source_module='opportunity_attention' and source_record_id=new.id and status<>'completed';end if;
 return new;
end $$;
create trigger opportunity_changed after insert or update on public.opportunities for each row execute function crm_internal.opportunity_changed();

create function crm_internal.lead_profile_changed()returns trigger language plpgsql security definer set search_path='' as $$
declare missing text[];tz text;
begin
 if not new.is_lead then return new;end if;missing=public.client_missing_fields(new);
 if cardinality(missing)=0 then
 update public.activities set status='completed',completed_at=now(),updated_at=now()where source_module='lead_profile'and source_record_id=new.id and status<>'completed';
 else
 select coalesce(timezone,'Europe/Lisbon')into tz from public.notification_preferences where user_id=new.owner_id;
 insert into public.activities(client_id,kind,interaction_type,title,summary,description,actor_id,assigned_to,status,source_module,source_record_id,has_time,due_date)
 values(new.id,'task','Tarefa','Completar ficha do cliente','Completar ficha do cliente',array_to_string(missing,', '),coalesce(auth.uid(),new.created_by),coalesce(new.owner_id,new.created_by),'scheduled','lead_profile',new.id,false,(now() at time zone coalesce(tz,'Europe/Lisbon'))::date)
 on conflict(source_module,source_record_id) where source_record_id is not null do update set description=excluded.description,assigned_to=excluded.assigned_to,status='scheduled',updated_at=now();
 end if;return new;
end $$;
create trigger lead_profile_changed after insert or update of trade_name,email,phone,address,city,country,tax_id,postal_code,owner_id on public.clients for each row execute function crm_internal.lead_profile_changed();

create function crm_internal.opportunity_activity_changed()returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.opportunity_id is null then return new;end if;
 if tg_op='INSERT' or old.status is distinct from new.status then insert into public.opportunity_events(opportunity_id,actor_id,event_type,title,detail,entity_id)values(new.opportunity_id,auth.uid(),'activity',case when tg_op='INSERT'then new.interaction_type||' criada'else new.interaction_type||': '||case new.status when 'completed'then 'Concluída'when 'cancelled'then 'Cancelada'else new.status end end,new.title,new.id);end if;
 if pg_trigger_depth()=1 and new.opportunity_role='next_action' then update public.opportunities set next_action=new.title,next_action_date=case when new.has_time then (new.start_at at time zone new.schedule_timezone)::date else new.due_date end,next_action_time=case when new.has_time then (new.start_at at time zone new.schedule_timezone)::time else null end,schedule_timezone=new.schedule_timezone,last_activity_at=now()where id=new.opportunity_id;end if;
 return new;
end $$;
create trigger opportunity_activity_changed after insert or update on public.activities for each row execute function crm_internal.opportunity_activity_changed();

create function public.opportunity_save(payload jsonb)returns uuid language plpgsql security invoker set search_path='' as $$
declare cid uuid;oid uuid;contact uuid;sid uuid;v public.opportunities;lead jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active)then raise exception 'Sessão inválida';end if;
 oid=nullif(payload->>'id','')::uuid;cid=nullif(payload->>'client_id','')::uuid;
 if oid is not null then select * into strict v from public.opportunities where id=oid for update;cid=v.client_id;end if;
 if cid is null then
 lead=payload->'lead';if nullif(trim(lead->>'trade_name'),'') is null or coalesce(lead->>'email','')!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'then raise exception 'Nome e email são obrigatórios';end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(lead->>'email'),0));
 if not coalesce((payload->>'allow_duplicate')::boolean,false)and exists(select 1 from public.clients where archived_at is null and (lower(email)=lower(lead->>'email')or lower(trade_name)=lower(lead->>'trade_name')))then raise exception 'Poderá já existir um registo semelhante. Selecione-o ou confirme a criação.';end if;
 cid=gen_random_uuid();insert into public.clients(id,code,trade_name,email,phone,country,city,website,notes,owner_id,created_by,is_lead,client_kind)values(cid,'L-'||upper(left(cid::text,8)),trim(lead->>'trade_name'),lower(trim(lead->>'email')),lead->>'phone',lead->>'country',lead->>'city',lead->>'website',lead->>'notes',auth.uid(),auth.uid(),true,coalesce(lead->>'client_kind','company'));
 if nullif(trim(lead->>'contact_name'),'')is not null then insert into public.client_contacts(client_id,first_name,email,phone,is_primary)values(cid,lead->>'contact_name',lead->>'email',lead->>'phone',true)returning id into contact;end if;
 end if;
 contact=coalesce(nullif(payload->>'contact_id','')::uuid,contact);
 sid=coalesce(nullif(payload->>'stage_id','')::uuid,v.stage_id,(select id from public.opportunity_stages where name='Lead identificado'limit 1));
 if oid is null then insert into public.opportunities(client_id,contact_id,seller_id,stage_id,title)values(cid,contact,coalesce(nullif(payload->>'seller_id','')::uuid,auth.uid()),sid,coalesce(nullif(trim(payload->>'title'),''),(select 'Consulta — '||trade_name from public.clients where id=cid)))returning id into oid;end if;
 update public.opportunities set title=coalesce(nullif(trim(payload->>'title'),''),title),contact_id=contact,stage_id=sid,seller_id=coalesce(nullif(payload->>'seller_id','')::uuid,seller_id),manufacturer_id=nullif(payload->>'manufacturer_id','')::uuid,family_id=nullif(payload->>'family_id','')::uuid,
 need=payload->>'need',description=payload->>'description',source=payload->>'source',notes=payload->>'notes',currency=coalesce(nullif(payload->>'currency',''),'EUR'),estimated_value=coalesce((payload->>'estimated_value')::numeric,0),probability=coalesce((payload->>'probability')::smallint,10),expected_close=nullif(payload->>'expected_close','')::date,next_action=payload->>'next_action',next_action_date=nullif(payload->>'next_action_date','')::date,next_action_time=nullif(payload->>'next_action_time','')::time,schedule_timezone=coalesce(payload->>'schedule_timezone','Europe/Lisbon'),action_kind=coalesce(payload->>'action_kind','task'),priority=coalesce((payload->>'priority')::smallint,3)where id=oid;
 return oid;
end $$;
revoke all on function public.opportunity_save(jsonb)from public,anon;grant execute on function public.opportunity_save(jsonb)to authenticated;

create view public.opportunity_board with(security_invoker=true)as
 select o.*,s.name stage_name,s.position stage_position,c.trade_name client_name,c.email client_email,c.phone client_phone,c.is_lead,c.client_kind,
 public.client_missing_fields(c) missing_fields,cardinality(public.client_missing_fields(c))>0 incomplete,
 nullif(trim(o.next_action),'')is null or o.next_action_date is null missing_action,
 concat_ws(' ',cc.first_name,cc.last_name)contact_name,cc.email contact_email,m.name manufacturer_name,p.full_name seller_name,
 concat_ws(' ',o.reference,o.title,o.need,c.trade_name,c.email,c.phone,c.tax_id,cc.first_name,cc.last_name,cc.email)search_text,
 (select count(*)from public.catalog_orders d where d.opportunity_id=o.id and d.document_type='proposal')proposal_count,
 (select count(*)from public.activities a where a.opportunity_id=o.id and a.opportunity_role='next_action')activity_count
 from public.opportunities o join public.clients c on c.id=o.client_id join public.opportunity_stages s on s.id=o.stage_id
 left join public.client_contacts cc on cc.id=o.contact_id left join public.manufacturers m on m.id=o.manufacturer_id left join public.profiles p on p.id=o.seller_id;
revoke all on public.opportunity_board from anon;grant select on public.opportunity_board to authenticated;
create function public.opportunity_metrics()returns jsonb language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(x),'[]')from(select currency,count(*)filter(where outcome='active')active_count,
 coalesce(sum(estimated_value)filter(where outcome='active'),0)nominal,
 coalesce(sum(estimated_value*coalesce(probability,0)/100)filter(where outcome='active'),0)weighted,
 count(*)filter(where outcome='active'and(next_action is null or next_action_date is null))missing_action,
 count(*)filter(where outcome='won')won,count(*)filter(where outcome='lost')lost from public.opportunities group by currency)x
$$;
revoke all on function public.opportunity_metrics()from public,anon;grant execute on function public.opportunity_metrics()to authenticated;

create function public.opportunity_transition(oid uuid,target_stage uuid,details jsonb default '{}')returns void language plpgsql security invoker set search_path='' as $$
declare o public.opportunities;st text;
begin
 select * into strict o from public.opportunities where id=oid for update;select name into strict st from public.opportunity_stages where id=target_stage;
 if st in ('Ganha','Perdida')and not coalesce((details->>'confirmed')::boolean,false)then raise exception 'Confirme o fecho';end if;
 update public.opportunities set stage_id=target_stage,loss_reason=case when st='Perdida'then nullif(trim(details->>'loss_reason'),'')else loss_reason end,competitor=coalesce(details->>'competitor',competitor),
 final_value=case when st='Ganha'then coalesce((details->>'final_value')::numeric,estimated_value)else final_value end,
 winning_proposal_id=case when st='Ganha'then nullif(details->>'winning_proposal_id','')::uuid else winning_proposal_id end,
 notes=coalesce(details->>'notes',notes),probability=case when st='Ganha'then 100 when st='Perdida'then 0 else probability end where id=oid;
 if st='Ganha'and nullif(details->>'winning_proposal_id','')is not null then update public.catalog_orders set proposal_status='accepted',accepted_at=now()where id=(details->>'winning_proposal_id')::uuid and opportunity_id=oid;end if;
end $$;
revoke all on function public.opportunity_transition(uuid,uuid,jsonb)from public,anon;grant execute on function public.opportunity_transition(uuid,uuid,jsonb)to authenticated;

-- Tighten only newly linked documents; preserve the existing unlinked catalog access model.
create policy linked_document_access on public.catalog_orders as restrictive for all to authenticated using(opportunity_id is null or exists(select 1 from public.opportunities where id=opportunity_id))with check(opportunity_id is null or exists(select 1 from public.opportunities where id=opportunity_id));
create policy linked_line_access on public.catalog_order_lines as restrictive for all to authenticated using(exists(select 1 from public.catalog_orders where id=order_id))with check(exists(select 1 from public.catalog_orders where id=order_id));
create function crm_internal.validate_commercial_document()returns trigger language plpgsql set search_path='' as $$
begin
 if new.opportunity_id is not null and not exists(select 1 from public.opportunities o where o.id=new.opportunity_id and o.client_id=new.client_id and(o.manufacturer_id is null or o.manufacturer_id=new.manufacturer_id))then raise exception 'Documento incompatível com a oportunidade';end if;
 if new.contact_id is not null and not exists(select 1 from public.client_contacts where id=new.contact_id and client_id=new.client_id)then raise exception 'Contacto inválido';end if;
 if new.document_type='order'and new.status<>'draft'and new.opportunity_id is not null and exists(select 1 from public.clients c where c.id=new.client_id and cardinality(public.client_missing_fields(c))>0)then raise exception 'Complete a ficha do cliente antes de formalizar a encomenda';end if;
 return new;
end $$;
create trigger commercial_document_validate before insert or update on public.catalog_orders for each row execute function crm_internal.validate_commercial_document();
create function crm_internal.commercial_document_changed()returns trigger language plpgsql security definer set search_path='' as $$
declare label text;current_position integer;
begin
 if new.opportunity_id is null then return new;end if;
 if tg_op='INSERT'then label=case when new.document_type='proposal'then 'Proposta criada: 'else 'Encomenda criada: 'end||new.order_number;
 elsif old.proposal_status is distinct from new.proposal_status then label='Proposta '||case new.proposal_status when 'sent'then 'enviada'when 'accepted'then 'aceite'when 'rejected'then 'recusada'else 'em rascunho'end||': '||new.order_number;
 elsif old.status is distinct from new.status then label='Encomenda: '||new.status;end if;
 if label is not null then insert into public.opportunity_events(opportunity_id,actor_id,event_type,title,entity_id)values(new.opportunity_id,auth.uid(),'document',label,new.id);end if;
 if new.document_type='proposal'and new.proposal_status='sent'then
 select s.position into current_position from public.opportunities o join public.opportunity_stages s on s.id=o.stage_id where o.id=new.opportunity_id and o.outcome='active';
 if current_position<4 then update public.opportunities set stage_id=(select id from public.opportunity_stages where name='Proposta enviada'limit 1),last_activity_at=now()where id=new.opportunity_id;end if;
 end if;
 if new.document_type='order'and new.status in ('confirmed','sent_to_manufacturer','manufacturer_confirmed','shipping','completed')then update public.clients set status='active',is_lead=false where id=new.client_id;end if;
 return new;
end $$;
create trigger commercial_document_changed after insert or update on public.catalog_orders for each row execute function crm_internal.commercial_document_changed();

create function public.commercial_save_document(payload jsonb)returns uuid language plpgsql security invoker set search_path='' as $$
declare did uuid;oid uuid;doc public.catalog_orders;p public.catalog_products;l jsonb;discount numeric;net numeric;qty numeric;total_value numeric:=0;kind text;num text;cid uuid;mid uuid;variant uuid;
begin
 if not public.has_catalog_orders_beta_access()then raise exception 'Catálogo não autorizado';end if;
 oid=nullif(payload->>'opportunity_id','')::uuid;cid=(payload->>'client_id')::uuid;mid=(payload->>'manufacturer_id')::uuid;kind=coalesce(payload->>'document_type','order');
 if oid is not null then perform 1 from public.opportunities where id=oid for update;if not found then raise exception 'Oportunidade não autorizada';end if;end if;
 if not exists(select 1 from public.clients where id=cid)then raise exception 'Cliente não autorizado';end if;
 if jsonb_array_length(payload->'lines')not between 1 and 200 then raise exception 'Selecione entre 1 e 200 produtos';end if;
 did=nullif(payload->>'id','')::uuid;
 if did is not null then select * into strict doc from public.catalog_orders where id=did for update;if doc.status<>'draft'or doc.proposal_status<>'draft'or doc.opportunity_id is distinct from oid then raise exception 'Crie uma revisão para preservar este documento';end if;
 update public.catalog_orders set notes=payload->>'notes',updated_at=now()where id=did;delete from public.catalog_order_lines where order_id=did;
 else
 num=case when kind='proposal'then 'PR-'else 'EN-'end||extract(year from now())::text||'-'||lpad(nextval('public.commercial_document_seq')::text,5,'0');
 insert into public.catalog_orders(order_number,client_id,contact_id,manufacturer_id,seller_id,created_by,currency,document_type,opportunity_id,notes)values(num,cid,nullif(payload->>'contact_id','')::uuid,mid,coalesce((select seller_id from public.opportunities where id=oid),auth.uid()),auth.uid(),coalesce(payload->>'currency','EUR'),kind,oid,payload->>'notes')returning id into did;
 end if;
 for l in select * from jsonb_array_elements(payload->'lines')loop
 select * into strict p from public.catalog_products where id=(l->>'product_id')::uuid and manufacturer_id=mid and active;
 variant=nullif(l->>'variant_id','')::uuid;if variant is not null and not exists(select 1 from public.catalog_product_variants where id=variant and product_id=p.id)then raise exception 'Variante inválida';end if;
 qty=(l->>'quantity')::numeric;net=(l->>'list_price_snapshot')::numeric;if qty<=0 or net<0 then raise exception 'Quantidade/preço inválidos';end if;
 for discount in select value::numeric from jsonb_array_elements_text(coalesce(l->'applied_discounts','[]'))loop if discount<0 or discount>100 then raise exception 'Desconto inválido';end if;net=net*(1-discount/100);end loop;net=round(net,2);
 insert into public.catalog_order_lines(order_id,product_id,variant_id,reference_snapshot,designation_snapshot,quantity,list_price_snapshot,automatic_discounts,applied_discounts,net_unit_price,line_total,discount_manually_changed,discount_changed_by,discount_changed_at)
 values(did,p.id,variant,coalesce((select reference from public.catalog_product_variants where id=variant),p.reference),p.designation,qty,(l->>'list_price_snapshot')::numeric,array(select value::numeric from jsonb_array_elements_text(coalesce(l->'automatic_discounts','[]'))),array(select value::numeric from jsonb_array_elements_text(coalesce(l->'applied_discounts','[]'))),net,round(net*qty,2),coalesce((l->>'discount_manually_changed')::boolean,false),auth.uid(),now());total_value=total_value+round(net*qty,2);
 end loop;
 update public.catalog_orders set subtotal=total_value,total=total_value+shipping+tax,updated_at=now()where id=did;return did;
end $$;
revoke all on function public.commercial_save_document(jsonb)from public,anon;grant execute on function public.commercial_save_document(jsonb)to authenticated;
create function public.commercial_convert_proposal(proposal uuid)returns uuid language plpgsql security invoker set search_path='' as $$
declare p public.catalog_orders;o public.opportunities;did uuid;
begin
 select * into strict p from public.catalog_orders where id=proposal and document_type='proposal';
 select * into strict o from public.opportunities where id=p.opportunity_id for update;
 select * into strict p from public.catalog_orders where id=proposal for update;
 if o.outcome<>'won'or(o.winning_proposal_id is distinct from p.id and p.proposal_status<>'accepted')then raise exception 'Selecione a proposta aceite/vencedora de uma oportunidade ganha';end if;
 select id into did from public.catalog_orders where document_type='order'and(opportunity_id=o.id or source_proposal_id=p.id);if did is not null then return did;end if;
 insert into public.catalog_orders(order_number,client_id,contact_id,manufacturer_id,seller_id,currency,notes,subtotal,shipping,tax,total,created_by,opportunity_id,source_proposal_id)
 values('EN-'||extract(year from now())::text||'-'||lpad(nextval('public.commercial_document_seq')::text,5,'0'),p.client_id,p.contact_id,p.manufacturer_id,p.seller_id,p.currency,p.notes,p.subtotal,p.shipping,p.tax,p.total,auth.uid(),o.id,p.id)returning id into did;
 insert into public.catalog_order_lines(order_id,product_id,variant_id,reference_snapshot,designation_snapshot,quantity,list_price_snapshot,automatic_discounts,applied_discounts,net_unit_price,line_total,notes,discount_manually_changed,discount_changed_by,discount_changed_at)
 select did,product_id,variant_id,reference_snapshot,designation_snapshot,quantity,list_price_snapshot,automatic_discounts,applied_discounts,net_unit_price,line_total,notes,discount_manually_changed,discount_changed_by,discount_changed_at from public.catalog_order_lines where order_id=p.id;
 return did;
end $$;
revoke all on function public.commercial_convert_proposal(uuid)from public,anon;grant execute on function public.commercial_convert_proposal(uuid)to authenticated;
