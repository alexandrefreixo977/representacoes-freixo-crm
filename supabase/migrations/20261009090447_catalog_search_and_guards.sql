create index if not exists catalog_price_product_variant on public.catalog_price_list_items(product_id,variant_id);
create index if not exists catalog_variant_product_active on public.catalog_product_variants(product_id) where active;
create function public.commercial_search_products(search_text text default '',manufacturer uuid default null,family_name text default '',product_status text default '',page_number integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$
 with matches as materialized (
 select p.* from public.catalog_products p left join public.catalog_product_families f on f.id=p.family_id left join public.manufacturers m on m.id=p.manufacturer_id
 where p.active and not p.is_test and (manufacturer is null or p.manufacturer_id=manufacturer) and (family_name='' or f.name=family_name) and (product_status='' or p.status=product_status)
 and (search_text='' or concat_ws(' ',p.reference,p.ean,p.designation,p.short_description,f.name,f.subfamily,m.name) ilike '%'||search_text||'%' or exists(select 1 from public.catalog_product_variants v where v.product_id=p.id and concat_ws(' ',v.reference,v.ean,v.designation_suffix) ilike '%'||search_text||'%'))
 ), selected as (select * from matches order by designation,id limit 60 offset greatest(page_number,0)*60)
 select jsonb_build_object('total',(select count(*) from matches),'products',coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object(
 'catalog_product_families',(select jsonb_build_object('name',f.name,'subfamily',f.subfamily) from public.catalog_product_families f where f.id=p.family_id),
 'catalog_price_list_items',coalesce((select jsonb_agg(x) from (select i.list_price,i.currency from public.catalog_price_list_items i join public.catalog_price_lists pl on pl.id=i.price_list_id where i.product_id=p.id and i.variant_id is null and pl.status='active' and not pl.is_test and (i.valid_from is null or i.valid_from<=current_date) and (i.valid_until is null or i.valid_until>=current_date) and (pl.valid_until is null or pl.valid_until>=current_date) order by pl.valid_from desc nulls last,pl.created_at desc,i.created_at desc limit 1)x),'[]'::jsonb),
 'catalog_product_variants',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('catalog_price_list_items',coalesce((select jsonb_agg(x) from (select i.list_price,i.currency from public.catalog_price_list_items i join public.catalog_price_lists pl on pl.id=i.price_list_id where i.variant_id=v.id and pl.status='active' and not pl.is_test and (i.valid_from is null or i.valid_from<=current_date) and (i.valid_until is null or i.valid_until>=current_date) and (pl.valid_until is null or pl.valid_until>=current_date) order by pl.valid_from desc nulls last,pl.created_at desc,i.created_at desc limit 1)x),'[]'::jsonb)) order by v.reference) from public.catalog_product_variants v where v.product_id=p.id and v.active),'[]'::jsonb)
 )),'[]'::jsonb)) from selected p
$$;
revoke all on function public.commercial_search_products(text,uuid,text,text,integer) from public,anon;
grant execute on function public.commercial_search_products(text,uuid,text,text,integer) to authenticated;

create function crm_internal.commercial_lock_line_parent() returns trigger language plpgsql set search_path='' as $$
declare d public.catalog_orders;
begin
 select * into strict d from public.catalog_orders where id=case when tg_op='DELETE' then old.order_id else new.order_id end for update;
 if tg_op<>'DELETE' then
  if new.quantity<=0 or new.list_price_snapshot<0 or new.net_unit_price<0 or new.line_total<>round(new.quantity*new.net_unit_price,2) then raise exception 'Valores da linha inválidos';end if;
  if new.net_price_overridden and auth.role()<>'service_role' and not public.commercial_is_admin() then raise exception 'Preço líquido reservado à administração';end if;
  if not exists(select 1 from public.catalog_products p where p.id=new.product_id and p.manufacturer_id=d.manufacturer_id) then raise exception 'Artigo de outro fabricante';end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger a_commercial_lock_line_parent before insert or update or delete on public.catalog_order_lines for each row execute function crm_internal.commercial_lock_line_parent();
create function crm_internal.commercial_new_document_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if auth.role()<>'service_role' and (new.workflow_state<>'draft' or new.approved_version_id is not null or new.validated_at is not null or new.validated_by is not null or new.sent_at is not null or new.sent_by is not null or new.status<>'draft' or new.proposal_status<>'draft' or new.created_by is distinct from auth.uid()) then raise exception 'Um novo documento tem de começar como rascunho';end if;
 return new;
end $$;
create trigger commercial_new_document_guard before insert on public.catalog_orders for each row execute function crm_internal.commercial_new_document_guard();
