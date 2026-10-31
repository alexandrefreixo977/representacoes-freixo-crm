-- Extend the existing commercial records; preserve their identifiers and legacy states.
alter table public.catalog_orders
 add column workflow_state text not null default 'draft' check(workflow_state in ('draft','pending_validation','validated','sent','under_review','accepted','rejected','expired','manufacturer_confirmed','shipping','completed','cancelled')),
 add column shipping_known boolean not null default false,
 add column vat_treatment text not null default 'undetermined' check(vat_treatment in ('included','excluded','exempt','undetermined')),
 add column payment_terms text,
 add column delivery_terms text,
 add column valid_until date,
 add column revision_of_id uuid references public.catalog_orders(id),
 add column revision_reason text,
 add column revision_number integer not null default 1,
 add column updated_by uuid references public.profiles(id),
 add column validated_by uuid references public.profiles(id),
 add column validated_at timestamptz,
 add column sent_by uuid references public.profiles(id),
 add column cancelled_by uuid references public.profiles(id),
 add column cancelled_at timestamptz,
 add column cancellation_reason text,
 add column row_version integer not null default 1;
update public.catalog_orders set workflow_state=case when document_type='proposal' then proposal_status else case status when 'confirmed' then 'validated' when 'sent_to_manufacturer' then 'sent' else status end end;
alter table public.catalog_order_lines
 add column variant_snapshot text,
 add column sales_unit_snapshot text,
 add column price_item_id uuid references public.catalog_price_list_items(id),
 add column net_price_overridden boolean not null default false,
 add column cancelled_at timestamptz,
 add column cancelled_by uuid references public.profiles(id),
 add column cancellation_reason text;
alter table public.catalog_products add column source_metadata jsonb not null default '{}'::jsonb;
alter table public.catalog_product_variants add column source_metadata jsonb not null default '{}'::jsonb;
alter table public.catalog_price_lists add column source_metadata jsonb not null default '{}'::jsonb;

create table public.commercial_company (
 id boolean primary key default true check(id), brand_name text not null,
 legal_name text, address text, tax_number text, phone text,
 email text not null, website text not null, logo_path text not null,
 updated_by uuid references public.profiles(id), updated_at timestamptz not null default now()
);
insert into public.commercial_company(id,brand_name,email,website,logo_path) values(true,'Representações Freixo','comercial@representacoesfreixo.com','https://www.representacoesfreixo.com','/email-signature-logo.png');
create table public.catalog_document_versions (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references public.catalog_orders(id),
 version integer not null, snapshot jsonb not null, pdf_base64 text not null,
 pdf_sha256 text not null, filename text not null,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 unique(document_id,version), check(length(pdf_base64) between 100 and 8000000)
);
alter table public.catalog_orders add column approved_version_id uuid references public.catalog_document_versions(id);
create table public.catalog_document_events (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references public.catalog_orders(id),
 event_type text not null, detail jsonb not null default '{}'::jsonb,
 actor_id uuid references public.profiles(id), created_at timestamptz not null default now()
);
create index catalog_document_events_document_idx on public.catalog_document_events(document_id,created_at desc);
create table public.catalog_send_attempts (
 id uuid primary key default gen_random_uuid(), version_id uuid not null unique references public.catalog_document_versions(id),
 status text not null check(status in ('prepared','sending','accepted','failed','uncertain')),
 recipients jsonb not null, subject text not null, body_html text not null,
 graph_id text, error text, attempted_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), accepted_at timestamptz
);
create table public.catalog_import_runs (
 id uuid primary key default gen_random_uuid(), manufacturer_id uuid not null references public.manufacturers(id),
 filename text not null, source_sha256 text not null, price_version text not null,
 status text not null check(status in ('preview','imported','failed')),
 report jsonb not null, created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), imported_at timestamptz
);
create index catalog_import_runs_source_idx on public.catalog_import_runs(manufacturer_id,source_sha256);
create function public.commercial_is_admin() returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active and role='admin')
$$;
revoke all on function public.commercial_is_admin() from public,anon;
grant execute on function public.commercial_is_admin() to authenticated;
alter table public.commercial_company enable row level security;
alter table public.catalog_document_versions enable row level security;
alter table public.catalog_document_events enable row level security;
alter table public.catalog_send_attempts enable row level security;
alter table public.catalog_import_runs enable row level security;
create policy company_read on public.commercial_company for select to authenticated using(public.has_catalog_orders_beta_access());
create policy company_update on public.commercial_company for update to authenticated using(public.commercial_is_admin()) with check(public.commercial_is_admin());
create policy document_versions_read on public.catalog_document_versions for select to authenticated using(exists(select 1 from public.catalog_orders d where d.id=document_id));
create policy document_events_read on public.catalog_document_events for select to authenticated using(exists(select 1 from public.catalog_orders d where d.id=document_id));
create policy send_attempts_read on public.catalog_send_attempts for select to authenticated using(exists(select 1 from public.catalog_document_versions v where v.id=version_id));
create policy import_runs_read on public.catalog_import_runs for select to authenticated using(public.commercial_is_admin());
grant select,update on public.commercial_company to authenticated;
grant select on public.catalog_document_versions,public.catalog_document_events,public.catalog_send_attempts,public.catalog_import_runs to authenticated;
grant all on public.commercial_company,public.catalog_document_versions,public.catalog_document_events,public.catalog_send_attempts,public.catalog_import_runs to service_role;

-- Service-only tables hold approved bytes and dispatch receipts; browser JWTs cannot forge them.
create function crm_internal.commercial_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.catalog_document_events(document_id,event_type,actor_id,detail)
 values(new.id,case when tg_op='INSERT' then 'created' else 'updated' end,coalesce(auth.uid(),new.updated_by,new.created_by),jsonb_build_object('state',new.workflow_state,'number',new.order_number,'version',new.row_version));
 return new;
end $$;
create trigger commercial_audit after insert or update on public.catalog_orders for each row execute function crm_internal.commercial_audit();

create or replace function crm_internal.protect_commercial_lines() returns trigger language plpgsql set search_path='' as $$
declare d public.catalog_orders;
begin
 select * into strict d from public.catalog_orders where id=case when tg_op='DELETE' then old.order_id else new.order_id end;
 if tg_op='UPDATE' and new.order_id is distinct from old.order_id then raise exception 'Não é permitido transferir linhas entre documentos';end if;
 if d.workflow_state<>'draft' or d.status<>'draft' or d.proposal_status<>'draft' then
  if tg_op='UPDATE' and (to_jsonb(new)-array['cancelled_at','cancelled_by','cancellation_reason'])=(to_jsonb(old)-array['cancelled_at','cancelled_by','cancellation_reason']) and old.cancelled_at is null and new.cancelled_at is not null and nullif(trim(new.cancellation_reason),'') is not null and new.cancelled_by=auth.uid() then return new;end if;
  raise exception 'Documento protegido. Crie uma revisão ou anule o artigo com motivo.';
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;

create function crm_internal.protect_commercial_header() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Anule o documento para preservar o histórico';end if;
 if old.workflow_state<>'draft' and
 (to_jsonb(new)-array['workflow_state','status','proposal_status','updated_at','updated_by','row_version','validated_at','validated_by','sent_at','sent_by','accepted_at','cancelled_at','cancelled_by','cancellation_reason','approved_version_id']) is distinct from
 (to_jsonb(old)-array['workflow_state','status','proposal_status','updated_at','updated_by','row_version','validated_at','validated_by','sent_at','sent_by','accepted_at','cancelled_at','cancelled_by','cancellation_reason','approved_version_id']) then raise exception 'Crie uma revisão para alterar o conteúdo de um documento protegido';end if;
 if auth.role()<>'service_role' and (new.approved_version_id is distinct from old.approved_version_id or new.validated_at is distinct from old.validated_at or new.sent_by is distinct from old.sent_by or new.workflow_state in ('validated','sent') and new.workflow_state<>old.workflow_state) then raise exception 'Utilize a validação e o envio pelo servidor';end if;
 new.updated_at=now();new.updated_by=coalesce(auth.uid(),new.updated_by);new.row_version=old.row_version+1;return new;
end $$;
create trigger commercial_header_guard before update or delete on public.catalog_orders for each row execute function crm_internal.protect_commercial_header();

-- Permanent catalogue and price changes require administration; reads keep the current beta boundary.
do $$ declare t text;begin
 foreach t in array array['catalog_products','catalog_product_variants','catalog_product_families','catalog_price_lists','catalog_price_list_items','catalog_commercial_rules'] loop
  execute format('create policy commercial_admin_insert on public.%I as restrictive for insert to authenticated with check(public.commercial_is_admin())',t);
  execute format('create policy commercial_admin_update on public.%I as restrictive for update to authenticated using(public.commercial_is_admin()) with check(public.commercial_is_admin())',t);
  execute format('create policy commercial_admin_delete on public.%I as restrictive for delete to authenticated using(public.commercial_is_admin())',t);
 end loop;
end $$;

create or replace function public.commercial_save_document(payload jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare did uuid;oid uuid;doc public.catalog_orders;p public.catalog_products;v public.catalog_product_variants;pi public.catalog_price_list_items;l jsonb;discount numeric;net numeric;qty numeric;total_value numeric:=0;kind text;num text;cid uuid;mid uuid;variant uuid;automatic numeric[];applied numeric[];special numeric;shipping_value numeric;
begin
 if not public.has_catalog_orders_beta_access() then raise exception 'Catálogo não autorizado';end if;
 oid=nullif(payload->>'opportunity_id','')::uuid;cid=(payload->>'client_id')::uuid;mid=(payload->>'manufacturer_id')::uuid;kind=coalesce(payload->>'document_type','order');
 if kind not in ('order','proposal') then raise exception 'Tipo de documento inválido';end if;
 if oid is not null then perform 1 from public.opportunities where id=oid for update;if not found then raise exception 'Oportunidade não autorizada';end if;end if;
 if not exists(select 1 from public.clients where id=cid) then raise exception 'Cliente não autorizado';end if;
 if coalesce(jsonb_array_length(payload->'lines'),0) not between 1 and 200 then raise exception 'Selecione entre 1 e 200 produtos';end if;
 shipping_value=coalesce(nullif(payload->>'shipping','')::numeric,0);if shipping_value<0 then raise exception 'Portes inválidos';end if;
 did=nullif(payload->>'id','')::uuid;
 if did is not null then
  select * into strict doc from public.catalog_orders where id=did for update;
  if doc.workflow_state<>'draft' or doc.status<>'draft' or doc.proposal_status<>'draft' or doc.opportunity_id is distinct from oid or doc.client_id is distinct from cid or doc.manufacturer_id is distinct from mid or doc.document_type<>kind then raise exception 'Crie uma revisão para preservar este documento';end if;
  if payload ? 'row_version' and doc.row_version<>(payload->>'row_version')::integer then raise exception 'O documento foi alterado por outro utilizador. Reabra antes de guardar';end if;
  delete from public.catalog_order_lines where order_id=did;
 else
  num=case when kind='proposal' then 'ORC-' else 'ENC-' end||extract(year from now())::text||'-'||lpad(nextval('public.commercial_document_seq')::text,5,'0');
  insert into public.catalog_orders(order_number,client_id,contact_id,manufacturer_id,seller_id,created_by,currency,document_type,opportunity_id,notes)
  values(num,cid,nullif(payload->>'contact_id','')::uuid,mid,coalesce((select seller_id from public.opportunities where id=oid),auth.uid()),auth.uid(),coalesce(payload->>'currency','EUR'),kind,oid,payload->>'notes') returning id into did;
 end if;
 for l in select * from jsonb_array_elements(payload->'lines') loop
  select * into strict p from public.catalog_products where id=(l->>'product_id')::uuid and manufacturer_id=mid and active and not is_test;
  variant=nullif(l->>'variant_id','')::uuid;v=null;
  if variant is not null then select * into strict v from public.catalog_product_variants where id=variant and product_id=p.id and active;end if;
  select i.* into pi from public.catalog_price_list_items i join public.catalog_price_lists pl on pl.id=i.price_list_id
  where i.product_id=p.id and i.variant_id is not distinct from variant and pl.status='active' and not pl.is_test and (i.valid_from is null or i.valid_from<=current_date) and (i.valid_until is null or i.valid_until>=current_date) and (pl.valid_until is null or pl.valid_until>=current_date)
  order by pl.valid_from desc nulls last,pl.created_at desc,i.created_at desc limit 1;
  if pi.id is null then raise exception 'Artigo % sem preço oficial válido',coalesce(v.reference,p.reference);end if;
  if pi.currency<>coalesce(payload->>'currency','EUR') then raise exception 'Moedas incompatíveis';end if;
  qty=(l->>'quantity')::numeric;
  if qty is null or qty<=0 or qty<coalesce(v.moq,p.moq,1) or mod(qty,coalesce(v.minimum_pack,p.minimum_pack,1))<>0 then raise exception 'Respeite a quantidade mínima e o múltiplo de embalagem do artigo %',p.reference;end if;
  automatic='{}';special=null;
  select r.discount_percentages,r.special_price into automatic,special from public.catalog_commercial_rules r
  where r.manufacturer_id=mid and r.active and not r.is_test and (r.client_id is null or r.client_id=cid) and (r.family_id is null or r.family_id=p.family_id) and (r.product_id is null or r.product_id=p.id) and (r.variant_id is null or r.variant_id=variant) and (r.valid_from is null or r.valid_from<=current_date) and (r.valid_until is null or r.valid_until>=current_date)
  order by ((r.client_id is not null)::int*16+(r.variant_id is not null)::int*8+(r.product_id is not null)::int*4+(r.family_id is not null)::int*2) desc,r.priority limit 1;
  automatic=coalesce(automatic,'{}');applied=case when l ? 'applied_discounts' then array(select value::numeric from jsonb_array_elements_text(l->'applied_discounts')) else automatic end;
  net=pi.list_price;
  foreach discount in array applied loop if discount is null or discount<0 or discount>100 then raise exception 'Desconto inválido';end if;net=net*(1-discount/100);end loop;
  if special is not null and applied=automatic then net=special;end if;
  if nullif(l->>'net_unit_price_override','') is not null then
   if not public.commercial_is_admin() then raise exception 'Só a administração pode substituir o preço líquido';end if;
   net=(l->>'net_unit_price_override')::numeric;if net<0 then raise exception 'Preço inválido';end if;
  end if;net=round(net,2);
  insert into public.catalog_order_lines(order_id,product_id,variant_id,reference_snapshot,designation_snapshot,variant_snapshot,sales_unit_snapshot,quantity,list_price_snapshot,automatic_discounts,applied_discounts,net_unit_price,line_total,notes,discount_manually_changed,discount_changed_by,discount_changed_at,price_item_id,net_price_overridden)
  values(did,p.id,variant,coalesce(v.reference,p.reference),p.designation,v.designation_suffix,coalesce(v.sales_unit,p.sales_unit),qty,pi.list_price,automatic,applied,net,round(net*qty,2),l->>'notes',applied<>automatic,case when applied<>automatic then auth.uid() end,case when applied<>automatic then now() end,pi.id,nullif(l->>'net_unit_price_override','') is not null);
  total_value=total_value+round(net*qty,2);
 end loop;
 update public.catalog_orders set contact_id=nullif(payload->>'contact_id','')::uuid,notes=payload->>'notes',payment_terms=payload->>'payment_terms',delivery_terms=payload->>'delivery_terms',valid_until=nullif(payload->>'valid_until','')::date,shipping_known=coalesce((payload->>'shipping_known')::boolean,false),shipping=shipping_value,vat_treatment=coalesce(payload->>'vat_treatment','undetermined'),subtotal=total_value,total=total_value+shipping_value,tax=0,updated_at=now() where id=did;
 return did;
end $$;

create function public.commercial_lead(payload jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare cid uuid;
begin
 if not public.has_catalog_orders_beta_access() then raise exception 'Catálogo não autorizado';end if;
 if nullif(trim(payload->>'trade_name'),'') is null or coalesce(payload->>'email','')!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Nome e email são obrigatórios';end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(trim(payload->>'email')),0));
 select id into cid from public.clients where archived_at is null and (lower(trim(email))=lower(trim(payload->>'email')) or lower(trim(trade_name))=lower(trim(payload->>'trade_name'))) limit 1;
 if cid is not null then raise exception 'Já existe uma ficha semelhante. Selecione o cliente existente';end if;
 cid=gen_random_uuid();
 insert into public.clients(id,code,trade_name,email,phone,address,tax_id,notes,owner_id,created_by,is_lead,client_kind)
 values(cid,'L-'||upper(left(cid::text,8)),trim(payload->>'trade_name'),lower(trim(payload->>'email')),payload->>'phone',payload->>'address',payload->>'tax_number',payload->>'notes',auth.uid(),auth.uid(),true,'company');
 if nullif(trim(payload->>'contact_name'),'') is not null then insert into public.client_contacts(client_id,first_name,email,phone,is_primary) values(cid,trim(payload->>'contact_name'),lower(trim(payload->>'email')),payload->>'phone',true);end if;
 return cid;
end $$;
revoke all on function public.commercial_lead(jsonb) from public,anon;
grant execute on function public.commercial_lead(jsonb) to authenticated;

-- Revisions and explicitly justified additional orders are separate records.
drop index public.order_from_opportunity_once;
drop index public.order_from_proposal_once;
alter table public.catalog_orders add column additional_order_reason text;
create unique index order_from_proposal_once on public.catalog_orders(source_proposal_id) where source_proposal_id is not null and revision_of_id is null and additional_order_reason is null;
create function public.commercial_copy_document(source_id uuid,operation text,reason text default null) returns uuid language plpgsql security invoker set search_path='' as $$
declare s public.catalog_orders;did uuid;kind text;revision integer;
begin
 if not public.has_catalog_orders_beta_access() then raise exception 'Catálogo não autorizado';end if;
 select * into strict s from public.catalog_orders where id=source_id for update;
 if operation not in ('revision','convert','additional_order') then raise exception 'Operação inválida';end if;
 if operation<>'convert' and nullif(trim(reason),'') is null then raise exception 'Indique o motivo';end if;
 if operation in ('convert','additional_order') then
  if s.document_type<>'proposal' or (s.workflow_state<>'accepted' and s.proposal_status<>'accepted') then raise exception 'O orçamento tem de estar aceite';end if;
  if operation='convert' then select id into did from public.catalog_orders where source_proposal_id=s.id and revision_of_id is null and additional_order_reason is null;if did is not null then return did;end if;end if;
  kind='order';revision=1;
 else kind=s.document_type;select coalesce(max(revision_number),s.revision_number)+1 into revision from public.catalog_orders where id=s.id or revision_of_id=coalesce(s.revision_of_id,s.id);end if;
 insert into public.catalog_orders(order_number,client_id,contact_id,manufacturer_id,seller_id,currency,notes,subtotal,shipping,shipping_known,vat_treatment,payment_terms,delivery_terms,valid_until,tax,total,created_by,opportunity_id,document_type,source_proposal_id,revision_of_id,revision_reason,revision_number,additional_order_reason)
 values(case when kind='proposal' then 'ORC-' else 'ENC-' end||extract(year from now())::text||'-'||lpad(nextval('public.commercial_document_seq')::text,5,'0'),s.client_id,s.contact_id,s.manufacturer_id,s.seller_id,s.currency,s.notes,s.subtotal,s.shipping,s.shipping_known,s.vat_treatment,s.payment_terms,s.delivery_terms,s.valid_until,s.tax,s.total,auth.uid(),s.opportunity_id,kind,case when operation='revision' then s.source_proposal_id else s.id end,case when operation='revision' then coalesce(s.revision_of_id,s.id) end,case when operation='revision' then reason end,revision,case when operation='additional_order' then reason end) returning id into did;
 insert into public.catalog_order_lines(order_id,product_id,variant_id,reference_snapshot,designation_snapshot,variant_snapshot,sales_unit_snapshot,quantity,list_price_snapshot,automatic_discounts,applied_discounts,net_unit_price,line_total,notes,discount_manually_changed,price_item_id,net_price_overridden)
 select did,product_id,variant_id,reference_snapshot,designation_snapshot,variant_snapshot,sales_unit_snapshot,quantity,list_price_snapshot,automatic_discounts,applied_discounts,net_unit_price,line_total,notes,discount_manually_changed,price_item_id,net_price_overridden from public.catalog_order_lines where order_id=s.id and cancelled_at is null;
 update public.catalog_orders set subtotal=(select coalesce(sum(line_total),0) from public.catalog_order_lines where order_id=did),total=(select coalesce(sum(line_total),0) from public.catalog_order_lines where order_id=did)+shipping+tax where id=did;
 return did;
end $$;
revoke all on function public.commercial_copy_document(uuid,text,text) from public,anon;
grant execute on function public.commercial_copy_document(uuid,text,text) to authenticated;
create or replace function public.commercial_convert_proposal(proposal uuid) returns uuid language sql security invoker set search_path='' as $$ select public.commercial_copy_document(proposal,'convert',null) $$;

create function public.commercial_transition(document_id uuid,target text,reason text default null) returns void language plpgsql security invoker set search_path='' as $$
declare d public.catalog_orders;
begin
 select * into strict d from public.catalog_orders where id=document_id for update;
 if not public.has_catalog_orders_beta_access() then raise exception 'Catálogo não autorisé';end if;
 if target='cancelled' then
  if nullif(trim(reason),'') is null then raise exception 'Indique o motivo de anulação';end if;
 elsif target='pending_validation' then
  if d.workflow_state<>'draft' or not exists(select 1 from public.catalog_order_lines where order_id=d.id) then raise exception 'É necessário um rascunho com artigos';end if;
 elsif target='draft' then
  if d.workflow_state<>'pending_validation' then raise exception 'Crie uma revisão';end if;
 elsif d.document_type='proposal' and target in ('under_review','accepted','rejected','expired') then
  if d.workflow_state not in ('sent','under_review') then raise exception 'Envie o orçamento antes de atualizar a resposta';end if;
 elsif d.document_type='order' and (target='manufacturer_confirmed' and d.workflow_state='sent' or target='shipping' and d.workflow_state='manufacturer_confirmed' or target='completed' and d.workflow_state in ('manufacturer_confirmed','shipping')) then null;
 else raise exception 'Transição de estado inválida';end if;
 update public.catalog_orders set workflow_state=target,
 status=case when target='cancelled' then 'cancelled' when target in ('manufacturer_confirmed','shipping','completed') then target else status end,
 proposal_status=case when document_type='proposal' and target in ('accepted','rejected') then target else proposal_status end,
 accepted_at=case when target='accepted' then now() else accepted_at end,
 cancelled_at=case when target='cancelled' then now() else cancelled_at end,cancelled_by=case when target='cancelled' then auth.uid() else cancelled_by end,cancellation_reason=case when target='cancelled' then reason else cancellation_reason end where id=d.id;
end $$;
revoke all on function public.commercial_transition(uuid,text,text) from public,anon;
grant execute on function public.commercial_transition(uuid,text,text) to authenticated;

create function public.commercial_approve(did uuid,expected_version integer,actor uuid,snapshot jsonb,pdf text,sha text,filename text) returns uuid language plpgsql security definer set search_path='' as $$
declare d public.catalog_orders;vid uuid;
begin
 select * into strict d from public.catalog_orders where id=did for update;
 if d.workflow_state<>'pending_validation' or d.row_version<>expected_version then raise exception 'O documento mudou. Atualize a pré-visualização';end if;
 if not exists(select 1 from public.profiles where id=actor and role='admin' and active) then raise exception 'Validação reservada à administração';end if;
 if d.document_type='order' and exists(select 1 from public.clients c where c.id=d.client_id and cardinality(public.client_missing_fields(c))>0) then raise exception 'Complete a ficha do cliente antes de validar a encomenda';end if;
 insert into public.catalog_document_versions(document_id,version,snapshot,pdf_base64,pdf_sha256,filename,created_by) values(did,d.row_version,snapshot,pdf,sha,filename,actor) returning id into vid;
 update public.catalog_orders set workflow_state='validated',approved_version_id=vid,validated_by=actor,validated_at=now(),updated_by=actor where id=did;
 return vid;
end $$;
revoke all on function public.commercial_approve(uuid,integer,uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.commercial_approve(uuid,integer,uuid,jsonb,text,text,text) to service_role;
create function public.commercial_claim_send(vid uuid,actor uuid,recipients jsonb,subject text,html text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.catalog_orders;a public.catalog_send_attempts;
begin
 select d0.* into strict d from public.catalog_orders d0 where approved_version_id=vid for update;
 if d.workflow_state<>'validated' then raise exception 'Apenas documentos validados podem ser enviados';end if;
 select * into a from public.catalog_send_attempts where version_id=vid for update;
 if a.status in ('sending','accepted','uncertain') then raise exception 'Envio já iniciado. Consulte o histórico antes de repetir';end if;
 insert into public.catalog_send_attempts(version_id,status,recipients,subject,body_html,attempted_by)
 values(vid,'sending',recipients,subject,html,actor)
 on conflict(version_id) do update set status='sending',recipients=excluded.recipients,subject=excluded.subject,body_html=excluded.body_html,error=null,updated_at=now(),attempted_by=actor returning * into a;
 return to_jsonb(a);
end $$;
revoke all on function public.commercial_claim_send(uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.commercial_claim_send(uuid,uuid,jsonb,text,text) to service_role;
create function public.commercial_finish_send(attempt uuid,actor uuid,result text,graph_message_id text,error_message text default null) returns void language plpgsql security definer set search_path='' as $$
declare a public.catalog_send_attempts;d public.catalog_orders;eid uuid;recipient_kind text;addr text;
begin
 select * into strict a from public.catalog_send_attempts where id=attempt for update;
 if a.status='accepted' then return;end if;
 if result not in ('accepted','failed','uncertain') then raise exception 'Resultado inválido';end if;
 select d0.* into strict d from public.catalog_orders d0 join public.catalog_document_versions v on v.document_id=d0.id where v.id=a.version_id for update of d0;
 update public.catalog_send_attempts set status=result,graph_id=coalesce(graph_message_id,graph_id),error=error_message,updated_at=now(),accepted_at=case when result='accepted' then now() end where id=attempt;
 insert into public.catalog_document_events(document_id,event_type,actor_id,detail) values(d.id,'email_'||result,actor,jsonb_build_object('attempt',attempt,'version',a.version_id,'recipients',a.recipients,'graph_id',graph_message_id));
 if result<>'accepted' then return;end if;
 update public.catalog_orders set workflow_state='sent',status=case when document_type='order' then 'sent_to_manufacturer' else status end,proposal_status=case when document_type='proposal' then 'sent' else proposal_status end,sent_at=now(),sent_by=actor,updated_by=actor where id=d.id;
 insert into public.emails(client_id,opportunity_id,sender_id,subject,body_html,status,sent_at) values(d.client_id,d.opportunity_id,actor,a.subject,a.body_html,'sent',now()) returning id into eid;
 foreach recipient_kind in array array['to','cc','bcc'] loop
  for addr in select jsonb_array_elements_text(coalesce(a.recipients->recipient_kind,'[]')) loop insert into public.email_recipients(email_id,address,recipient_type) values(eid,addr,recipient_kind);end loop;
 end loop;
 insert into public.activities(client_id,opportunity_id,kind,interaction_type,title,subject,summary,actor_id,assigned_to,entity_id,status,source_module,occurred_at)
 values(d.client_id,d.opportunity_id,'email','Email',a.subject,a.subject,'Envio aceite pela Microsoft: '||d.order_number,actor,d.seller_id,eid,'sent','commercial',now());
end $$;
revoke all on function public.commercial_finish_send(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.commercial_finish_send(uuid,uuid,text,text,text) to service_role;

-- Unknown manufacturer validity dates stay unknown instead of inventing 1 January.
alter table public.catalog_price_lists alter column valid_from drop not null;
alter table public.catalog_price_list_items alter column valid_from drop not null;
create policy import_runs_admin_insert on public.catalog_import_runs for insert to authenticated with check(public.commercial_is_admin() and created_by=auth.uid());
grant insert on public.catalog_import_runs to authenticated;
create function public.commercial_import_catalog(payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare mid uuid;plid uuid;pid uuid;vid uuid;fid uuid;r jsonb;run public.catalog_import_runs;cnt integer:=0;new_count integer:=0;variant_count integer:=0;unchanged integer:=0;old_price numeric;report jsonb;
begin
 if not public.commercial_is_admin() or not public.has_catalog_orders_beta_access() then raise exception 'Importação reservada à administração';end if;
 mid=(payload->>'manufacturer_id')::uuid;
 if not exists(select 1 from public.manufacturers where id=mid and lower(name) like 'acha%') then raise exception 'Esta fase permite importar apenas ACHA';end if;
 if coalesce(jsonb_array_length(payload->'rows'),0) not between 1 and 15000 then raise exception 'Ficheiro sem artigos ou demasiado grande';end if;
 if coalesce(payload->>'source_sha256','')!~'^[a-f0-9]{64}$' or nullif(trim(payload->>'version'),'') is null or (payload->>'confirmed')::boolean is not true then raise exception 'Confirme a fonte e a pré-visualização';end if;
 perform pg_advisory_xact_lock(hashtextextended(mid::text,0));
 select * into run from public.catalog_import_runs where manufacturer_id=mid and source_sha256=payload->>'source_sha256' and status='imported' order by created_at desc limit 1;
 if run.id is not null then return run.report||jsonb_build_object('already_imported',true);end if;
 if exists(select 1 from jsonb_array_elements(payload->'rows') a group by trim(a->>'reference') having count(*)>1) then raise exception 'A pré-visualização contém referências duplicadas';end if;
 for r in select * from jsonb_array_elements(payload->'rows') loop
  if nullif(trim(r->>'reference'),'') is null or nullif(trim(r->>'designation'),'') is null or coalesce(r->>'price','')!~'^[0-9]+(\.[0-9]{1,4})?$' or (r->>'price')::numeric<=0 or coalesce(r->>'currency','EUR')<>'EUR' then raise exception 'Referência/designação/preço inválidos: %',r->>'reference';end if;
 end loop;
 insert into public.catalog_price_lists(manufacturer_id,name,version,currency,valid_from,valid_until,source_metadata)
 values(mid,'Catálogo Tarifa ACHA',payload->>'version','EUR',nullif(payload->>'valid_from','')::date,nullif(payload->>'valid_until','')::date,jsonb_build_object('filename',payload->>'filename','sha256',payload->>'source_sha256'))
 on conflict(manufacturer_id,name,version) do nothing returning id into plid;
 if plid is null then select id into plid from public.catalog_price_lists where manufacturer_id=mid and name='Catálogo Tarifa ACHA' and version=payload->>'version';end if;
 for r in select * from jsonb_array_elements(payload->'rows') loop
  pid=null;vid=null;fid=null;
  select v.id,v.product_id into vid,pid from public.catalog_product_variants v join public.catalog_products p on p.id=v.product_id where p.manufacturer_id=mid and v.reference=trim(r->>'reference');
  if vid is not null then variant_count=variant_count+1;
  else
   select id into pid from public.catalog_products where manufacturer_id=mid and reference=trim(r->>'reference');
   if nullif(trim(r->>'family'),'') is not null and r->>'family'<>'Por classificar' then
    select id into fid from public.catalog_product_families where manufacturer_id=mid and name=r->>'family' and coalesce(subfamily,'')=coalesce(r->>'subfamily','') limit 1;
    if fid is null then insert into public.catalog_product_families(manufacturer_id,name,subfamily) values(mid,r->>'family',nullif(r->>'subfamily','')) returning id into fid;end if;
   end if;
   if pid is null then
    insert into public.catalog_products(manufacturer_id,family_id,reference,designation,ean,technical_description,source_metadata)
    values(mid,fid,trim(r->>'reference'),trim(r->>'designation'),nullif(r->>'ean',''),r->>'technical_description',jsonb_build_object('filename',payload->>'filename','sha256',payload->>'source_sha256','page',r->'source_page','row',r->>'source_row','pack_verified',false)) returning id into pid;
    new_count=new_count+1;
   end if;
  end if;
  select list_price into old_price from public.catalog_price_list_items where price_list_id=plid and product_id=pid and variant_id is not distinct from vid limit 1;
  if found then
   if old_price<>(r->>'price')::numeric then raise exception 'O preço da referência % diverge da versão existente. Importe como nova versão para preservar o histórico',r->>'reference';end if;unchanged=unchanged+1;
  else
   insert into public.catalog_price_list_items(price_list_id,product_id,variant_id,list_price,currency,valid_from,valid_until) values(plid,pid,vid,(r->>'price')::numeric,'EUR',nullif(payload->>'valid_from','')::date,nullif(payload->>'valid_until','')::date);
  end if;cnt=cnt+1;
 end loop;
 report=jsonb_build_object('references',cnt,'new_products',new_count,'existing_variants',variant_count,'unchanged_prices',unchanged,'price_list_id',plid,'source_sha256',payload->>'source_sha256','warnings',coalesce(payload->'warnings','[]'::jsonb));
 insert into public.catalog_import_runs(manufacturer_id,filename,source_sha256,price_version,status,report,created_by,imported_at) values(mid,payload->>'filename',payload->>'source_sha256',payload->>'version','imported',report,auth.uid(),now());
 return report;
end $$;
revoke all on function public.commercial_import_catalog(jsonb) from public,anon;
grant execute on function public.commercial_import_catalog(jsonb) to authenticated;

create or replace function crm_internal.lead_profile_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare missing text[];
begin
 if not new.is_lead then return new;end if;
 missing=public.client_missing_fields(new);
 if cardinality(missing)=0 then
  update public.clients set is_lead=false where id=new.id;
  update public.activities set status='completed',completed_at=now(),updated_at=now() where source_module='lead_profile' and source_record_id=new.id and status<>'completed';
 else
  insert into public.activities(client_id,kind,interaction_type,title,summary,description,actor_id,assigned_to,status,source_module,source_record_id,has_time,due_date)
  values(new.id,'task','Tarefa','Completar ficha do cliente — '||new.trade_name,'Completar ficha do cliente — '||new.trade_name,array_to_string(missing,', '),coalesce(auth.uid(),new.created_by),coalesce(new.owner_id,new.created_by),'scheduled','lead_profile',new.id,false,null)
  on conflict(source_module,source_record_id) where source_record_id is not null do update set title=excluded.title,summary=excluded.summary,description=excluded.description,assigned_to=excluded.assigned_to,status='scheduled',updated_at=now();
 end if;return new;
end $$;

-- Lock parent rows for line edits, including direct PostgREST writes, to serialize approval.
create function crm_internal.commercial_line_version() returns trigger language plpgsql set search_path='' as $$
begin
 update public.catalog_orders set updated_at=now() where id=case when tg_op='DELETE' then old.order_id else new.order_id end;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger commercial_line_version after insert or update or delete on public.catalog_order_lines for each row execute function crm_internal.commercial_line_version();
