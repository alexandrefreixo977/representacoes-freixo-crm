create or replace function public.commercial_import_blue_master(payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare mid uuid;plid uuid;pid uuid;vid uuid;fid uuid;r jsonb;run public.catalog_import_runs;cnt integer:=0;new_count integer:=0;variant_count integer:=0;unchanged integer:=0;old_price numeric;report jsonb;
begin
 if auth.role()<>'service_role' and (not public.commercial_is_admin() or not public.has_catalog_orders_beta_access()) then raise exception 'Importação reservada à administração';end if;
 mid=(payload->>'manufacturer_id')::uuid;
 if auth.role()='service_role' and not exists(select 1 from public.profiles where id=(payload->>'actor_id')::uuid and role='admin') then raise exception 'Identifique o administrador responsável pela importação';end if;
 if not exists(select 1 from public.manufacturers where id=mid and lower(name) in ('blue-master','blue master','bluemaster')) then raise exception 'Este importador destina-se apenas à BLUE-MASTER';end if;
 if coalesce(jsonb_array_length(payload->'rows'),0) not between 1 and 500 then raise exception 'Ficheiro sem artigos ou demasiado grande';end if;
 if coalesce(payload->>'source_sha256','')!~'^[a-f0-9]{64}$' or nullif(trim(payload->>'version'),'') is null or (payload->>'confirmed')::boolean is not true then raise exception 'Confirme a fonte e a pré-visualização';end if;
 perform pg_advisory_xact_lock(hashtextextended(mid::text,0));
 select * into run from public.catalog_import_runs where manufacturer_id=mid and source_sha256=payload->>'source_sha256' and price_version=payload->>'version' and batch_key=coalesce(payload->>'batch_key','full') and status='imported' order by created_at desc limit 1;
 if run.id is not null then if run.rows_fingerprint is distinct from md5((payload->'rows')::text) then raise exception 'O conteúdo deste lote mudou. Use uma nova versão para preservar o histórico';end if;return run.report||jsonb_build_object('already_imported',true);end if;
 if exists(select 1 from jsonb_array_elements(payload->'rows') a group by trim(a->>'reference') having count(*)>1) then raise exception 'A pré-visualização contém referências duplicadas';end if;
 for r in select * from jsonb_array_elements(payload->'rows') loop
  if (r->>'validation_status' is distinct from 'approved' and r->>'validation_status' is distinct from 'source_verified') or (r->>'validation_status'='approved' and (nullif(r->>'main_image_url','') is null or nullif(r->>'sales_unit','') is null)) or (r->>'validation_status'='source_verified' and r->'source_metadata'->>'sales_unit_validation' is distinct from 'pending') then raise exception 'Referência sem validação técnica/imagem/unidade: %',r->>'reference';end if;
  if not exists(select 1 from public.manufacturer_family_discounts d where d.manufacturer_id=mid and d.active and d.deleted_at is null and d.family_code=r->'source_metadata'->>'manufacturer_discount_family_code') then raise exception 'Grupo comercial desconhecido: %',r->>'reference';end if;

  if nullif(trim(r->>'reference'),'') is null or nullif(trim(r->>'designation'),'') is null or coalesce(r->>'price','')!~'^[0-9]+(\.[0-9]{1,4})?$' or (r->>'price')::numeric<=0 or coalesce(r->>'currency','EUR')<>'EUR' then raise exception 'Referência/designação/preço inválidos: %',r->>'reference';end if;
 end loop;
 insert into public.catalog_price_lists(manufacturer_id,name,version,currency,valid_from,valid_until,source_metadata)
 values(mid,'BLUE-MASTER 2026',payload->>'version','EUR',nullif(payload->>'valid_from','')::date,nullif(payload->>'valid_until','')::date,jsonb_build_object('filename',payload->>'filename','sha256',payload->>'source_sha256'))
 on conflict(manufacturer_id,name,version) do nothing returning id into plid;
 if plid is null then select id into plid from public.catalog_price_lists where manufacturer_id=mid and name='BLUE-MASTER 2026' and version=payload->>'version';end if;
 for r in select * from jsonb_array_elements(payload->'rows') loop
  pid=null;vid=null;fid=null;
  select v.id,v.product_id into vid,pid from public.catalog_product_variants v join public.catalog_products p on p.id=v.product_id where p.manufacturer_id=mid and v.reference=trim(r->>'reference');
  if vid is not null then variant_count=variant_count+1;
  else
   select id into pid from public.catalog_products where manufacturer_id=mid and reference=trim(r->>'reference');
   if nullif(trim(r->>'family'),'') is not null and r->>'family'<>'Por classificar' then
    select id into fid from public.catalog_product_families where manufacturer_id=mid and lower(name)=lower(r->>'family') and coalesce(subfamily,'')=coalesce(r->>'subfamily','') limit 1;
    if fid is null then insert into public.catalog_product_families(manufacturer_id,name,subfamily) values(mid,r->>'family',nullif(r->>'subfamily','')) returning id into fid;end if;
   end if;
   if pid is null then
    insert into public.catalog_products(manufacturer_id,family_id,reference,designation,ean,technical_description,main_image_url,sales_unit,status,source_metadata)
    values(mid,fid,trim(r->>'reference'),trim(r->>'designation'),nullif(r->>'ean',''),r->>'technical_description',r->>'main_image_url',r->>'sales_unit',case when r->>'validation_status'='source_verified' then 'on_request' else 'active' end,coalesce(r->'source_metadata','{}'::jsonb)||jsonb_build_object('filename',payload->>'filename','sha256',payload->>'source_sha256','source_page',r->'source_page','row',r->>'source_row','validation_status',r->>'validation_status')) returning id into pid;
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
 insert into public.catalog_import_runs(manufacturer_id,filename,source_sha256,price_version,status,report,created_by,imported_at,batch_key,rows_fingerprint) values(mid,payload->>'filename',payload->>'source_sha256',payload->>'version','imported',report,coalesce(auth.uid(),(payload->>'actor_id')::uuid),now(),coalesce(payload->>'batch_key','full'),md5((payload->'rows')::text));
 return report;
end $$;
revoke all on function public.commercial_import_blue_master(jsonb) from public,anon;
grant execute on function public.commercial_import_blue_master(jsonb) to authenticated,service_role;
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
  if p.source_metadata->>'sales_unit_validation'='pending' then raise exception 'A unidade de venda da referência % ainda está em validação. Não pode ser adicionada a um documento.',p.reference;end if;
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
  select resolved.discounts,resolved.special_price into automatic,special
  from public.commercial_product_terms(p.id,cid,variant,qty) resolved;
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
create or replace function public.commercial_search_products(search_text text default '',manufacturer uuid default null,family_name text default '',product_status text default '',page_number integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$
 with matches as materialized (
 select p.* from public.catalog_products p left join public.catalog_product_families f on f.id=p.family_id left join public.manufacturers m on m.id=p.manufacturer_id
 where p.active and not p.is_test and (manufacturer is null or p.manufacturer_id=manufacturer) and (family_name='' or lower(f.name)=lower(family_name)) and (product_status='' or p.status=product_status)
 and (search_text='' or concat_ws(' ',p.reference,p.ean,p.designation,p.short_description,f.name,f.subfamily,m.name) ilike '%'||search_text||'%' or exists(select 1 from public.catalog_product_variants v where v.product_id=p.id and concat_ws(' ',v.reference,v.ean,v.designation_suffix) ilike '%'||search_text||'%'))
 ), selected as (select * from matches order by designation,id limit 60 offset greatest(page_number,0)*60)
 select jsonb_build_object('total',(select count(*) from matches),'products',coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object(
 'catalog_product_families',(select jsonb_build_object('name',f.name,'subfamily',f.subfamily) from public.catalog_product_families f where f.id=p.family_id),
 'catalog_price_list_items',coalesce((select jsonb_agg(x) from (select i.list_price,i.currency from public.catalog_price_list_items i join public.catalog_price_lists pl on pl.id=i.price_list_id where i.product_id=p.id and i.variant_id is null and pl.status='active' and not pl.is_test and (i.valid_from is null or i.valid_from<=current_date) and (i.valid_until is null or i.valid_until>=current_date) and (pl.valid_until is null or pl.valid_until>=current_date) order by pl.valid_from desc nulls last,pl.created_at desc,i.created_at desc limit 1)x),'[]'::jsonb),
 'catalog_product_variants',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('catalog_price_list_items',coalesce((select jsonb_agg(x) from (select i.list_price,i.currency from public.catalog_price_list_items i join public.catalog_price_lists pl on pl.id=i.price_list_id where i.variant_id=v.id and pl.status='active' and not pl.is_test and (i.valid_from is null or i.valid_from<=current_date) and (i.valid_until is null or i.valid_until>=current_date) and (pl.valid_until is null or pl.valid_until>=current_date) order by pl.valid_from desc nulls last,pl.created_at desc,i.created_at desc limit 1)x),'[]'::jsonb)) order by v.reference) from public.catalog_product_variants v where v.product_id=p.id and v.active),'[]'::jsonb)
 )),'[]'::jsonb)) from selected p
$$;