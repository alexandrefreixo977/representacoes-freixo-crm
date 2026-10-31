alter table public.catalog_import_runs add column batch_key text not null default 'full', add column rows_fingerprint text;
create unique index catalog_import_batch_once on public.catalog_import_runs(manufacturer_id,source_sha256,price_version,batch_key) where status='imported';
create or replace function public.commercial_import_catalog(payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare mid uuid;plid uuid;pid uuid;vid uuid;fid uuid;r jsonb;run public.catalog_import_runs;cnt integer:=0;new_count integer:=0;variant_count integer:=0;unchanged integer:=0;old_price numeric;report jsonb;
begin
 if not public.commercial_is_admin() or not public.has_catalog_orders_beta_access() then raise exception 'Importação reservada à administração';end if;
 mid=(payload->>'manufacturer_id')::uuid;
 if not exists(select 1 from public.manufacturers where id=mid and lower(name) like 'acha%') then raise exception 'Esta fase permite importar apenas ACHA';end if;
 if coalesce(jsonb_array_length(payload->'rows'),0) not between 1 and 500 then raise exception 'Ficheiro sem artigos ou demasiado grande';end if;
 if coalesce(payload->>'source_sha256','')!~'^[a-f0-9]{64}$' or nullif(trim(payload->>'version'),'') is null or (payload->>'confirmed')::boolean is not true then raise exception 'Confirme a fonte e a pré-visualização';end if;
 perform pg_advisory_xact_lock(hashtextextended(mid::text,0));
 select * into run from public.catalog_import_runs where manufacturer_id=mid and source_sha256=payload->>'source_sha256' and price_version=payload->>'version' and batch_key=coalesce(payload->>'batch_key','full') and status='imported' order by created_at desc limit 1;
 if run.id is not null then if run.rows_fingerprint is distinct from md5((payload->'rows')::text) then raise exception 'O conteúdo deste lote mudou. Use uma nova versão para preservar o histórico';end if;return run.report||jsonb_build_object('already_imported',true);end if;
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
 insert into public.catalog_import_runs(manufacturer_id,filename,source_sha256,price_version,status,report,created_by,imported_at,batch_key,rows_fingerprint) values(mid,payload->>'filename',payload->>'source_sha256',payload->>'version','imported',report,auth.uid(),now(),coalesce(payload->>'batch_key','full'),md5((payload->'rows')::text));
 return report;
end $$;
revoke all on function public.commercial_import_catalog(jsonb) from public,anon;
grant execute on function public.commercial_import_catalog(jsonb) to authenticated;