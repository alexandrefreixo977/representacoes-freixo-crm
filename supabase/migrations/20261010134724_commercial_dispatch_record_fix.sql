create or replace function crm_internal.commercial_dispatch_guard() returns trigger language plpgsql set search_path='' as $$
declare did uuid;
begin
 did=(to_jsonb(old)->>case when tg_table_name='catalog_orders' then 'id' else 'order_id' end)::uuid;
 perform 1 from public.catalog_orders where id=did for update;
 if exists(select 1 from public.catalog_send_attempts a join public.catalog_document_versions v on v.id=a.version_id where v.document_id=did and a.status in ('sending','uncertain')) and auth.role()<>'service_role' then
 raise exception 'Envio em curso ou por confirmar. Resolva o estado do envio antes de alterar o documento';
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
