create or replace function crm_internal.validate_opportunity() returns trigger language plpgsql set search_path='' as $$
declare stage_name text;
begin
 if auth.uid() is not null and not exists(select 1 from public.clients c where c.id=new.client_id) then raise exception 'Cliente não autorizado';end if;
 if new.contact_id is not null and not exists(select 1 from public.client_contacts where id=new.contact_id and client_id=new.client_id) then raise exception 'O contacto não pertence ao cliente';end if;
 if new.family_id is not null and not exists(select 1 from public.catalog_product_families where id=new.family_id and manufacturer_id=new.manufacturer_id)then raise exception 'Família e fabricante incompatíveis';end if;
 if not exists(select 1 from public.profiles where id=new.seller_id and active)then raise exception 'Responsável inválido';end if;
 if not exists(select 1 from pg_timezone_names where name=new.schedule_timezone)then raise exception 'Fuso horário inválido';end if;
 if not exists(select 1 from public.profiles p join public.clients c on c.id=new.client_id where p.id=new.seller_id and (p.role='admin' or c.owner_id=p.id))then raise exception 'O responsável deve ter acesso à ficha do cliente. Atribua primeiro o cliente ao comercial.';end if;
 if new.estimated_value<0 then raise exception 'Valor inválido';end if;
 select name into stage_name from public.opportunity_stages where id=new.stage_id;
 if new.outcome='archived' and (tg_op='INSERT' or old.stage_id is not distinct from new.stage_id)then null;elsif stage_name='Ganha' then new.outcome='won';elsif stage_name='Perdida' then new.outcome='lost';elsif new.outcome in ('won','lost','archived')then new.outcome='active';end if;
 if new.outcome='lost' and nullif(trim(new.loss_reason),'') is null then raise exception 'Indique o motivo de perda';end if;
 if new.winning_proposal_id is not null and not exists(select 1 from public.catalog_orders where id=new.winning_proposal_id and opportunity_id=new.id and document_type='proposal')then raise exception 'Proposta vencedora inválida';end if;
 new.closed_at=case when new.outcome in ('won','lost')then coalesce(new.closed_at,now())else null end;
 new.updated_at=now();new.updated_by=auth.uid();if tg_op='INSERT'then new.created_by=auth.uid();end if;
 return new;
end $$;
create or replace function public.opportunity_save(payload jsonb)returns uuid language plpgsql security invoker set search_path='' as $$
declare cid uuid;oid uuid;contact uuid;sid uuid;v public.opportunities;lead jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active)then raise exception 'Sessão inválida';end if;
 oid=nullif(payload->>'id','')::uuid;cid=nullif(payload->>'client_id','')::uuid;
 if oid is not null then select * into strict v from public.opportunities where id=oid for update;cid=v.client_id;end if;
 if cid is null then
 lead=payload->'lead';if nullif(trim(lead->>'trade_name'),'') is null or coalesce(lead->>'email','')!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'then raise exception 'Nome e email são obrigatórios';end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(lead->>'email'),0));
 if not coalesce((payload->>'allow_duplicate')::boolean,false)and exists(select 1 from public.clients where archived_at is null and (lower(email)=lower(lead->>'email')or lower(trade_name)=lower(lead->>'trade_name')))then raise exception 'Poderá já existir um registo semelhante. Selecione-o ou confirme a criação.';end if;
 cid=gen_random_uuid();insert into public.clients(id,code,trade_name,email,phone,country,city,website,notes,owner_id,created_by,commercial_name,is_lead,client_kind)values(cid,'L-'||upper(left(cid::text,8)),trim(lead->>'trade_name'),lower(trim(lead->>'email')),lead->>'phone',lead->>'country',lead->>'city',lead->>'website',lead->>'notes',auth.uid(),auth.uid(),(select split_part(full_name,' ',1) from public.profiles where id=auth.uid()),true,coalesce(lead->>'client_kind','company'));
 if nullif(trim(lead->>'contact_name'),'')is not null then insert into public.client_contacts(client_id,first_name,email,phone,is_primary)values(cid,lead->>'contact_name',lead->>'email',lead->>'phone',true)returning id into contact;end if;
 end if;
 contact=coalesce(nullif(payload->>'contact_id','')::uuid,contact);
 sid=coalesce(nullif(payload->>'stage_id','')::uuid,v.stage_id,(select id from public.opportunity_stages where name='Lead identificado'limit 1));
 if oid is null then insert into public.opportunities(client_id,contact_id,seller_id,stage_id,title)values(cid,contact,coalesce(nullif(payload->>'seller_id','')::uuid,auth.uid()),sid,coalesce(nullif(trim(payload->>'title'),''),(select 'Consulta — '||trade_name from public.clients where id=cid)))returning id into oid;end if;
 update public.opportunities set title=coalesce(nullif(trim(payload->>'title'),''),title),contact_id=contact,stage_id=sid,seller_id=coalesce(nullif(payload->>'seller_id','')::uuid,seller_id),manufacturer_id=nullif(payload->>'manufacturer_id','')::uuid,family_id=nullif(payload->>'family_id','')::uuid,
 need=payload->>'need',description=payload->>'description',source=payload->>'source',notes=payload->>'notes',currency=coalesce(nullif(payload->>'currency',''),'EUR'),estimated_value=coalesce((payload->>'estimated_value')::numeric,0),probability=coalesce((payload->>'probability')::smallint,10),expected_close=nullif(payload->>'expected_close','')::date,next_action=payload->>'next_action',next_action_date=nullif(payload->>'next_action_date','')::date,next_action_time=nullif(payload->>'next_action_time','')::time,schedule_timezone=coalesce(payload->>'schedule_timezone','Europe/Lisbon'),action_kind=coalesce(payload->>'action_kind','task'),priority=coalesce((payload->>'priority')::smallint,3)where id=oid;
 return oid;
end $$;
create function crm_internal.protect_commercial_lines()returns trigger language plpgsql set search_path='' as $$
declare d public.catalog_orders;
begin
 select * into d from public.catalog_orders where id=case when tg_op='DELETE'then old.order_id else new.order_id end;
 if d.opportunity_id is not null and (d.status<>'draft' or d.proposal_status<>'draft')then raise exception 'Documento já enviado/confirmado. Crie uma revisão para preservar o histórico.';end if;
 if tg_op='UPDATE'and new.order_id is distinct from old.order_id then raise exception 'Não é permitido transferir linhas entre documentos';end if;
 return case when tg_op='DELETE'then old else new end;
end $$;
create trigger protect_commercial_lines before insert or update or delete on public.catalog_order_lines for each row execute function crm_internal.protect_commercial_lines();
