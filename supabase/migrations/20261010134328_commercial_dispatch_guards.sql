create or replace function public.commercial_claim_send(vid uuid,actor uuid,recipients jsonb,subject text,html text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.catalog_orders;a public.catalog_send_attempts;
begin
 select d0.* into strict d from public.catalog_orders d0 where approved_version_id=vid for update;
 if d.workflow_state<>'validated' then raise exception 'Apenas documentos validados podem ser enviados';end if;
 if exists(select 1 from public.catalog_order_lines where order_id=d.id and cancelled_at is not null) then raise exception 'Existem artigos anulados. Crie e valide uma revisão antes de enviar';end if;
 select * into a from public.catalog_send_attempts where version_id=vid for update;
 if a.status in ('sending','accepted','uncertain') then raise exception 'Envio já iniciado. Consulte o histórico antes de repetir';end if;
 insert into public.catalog_send_attempts(version_id,status,recipients,subject,body_html,attempted_by)
 values(vid,'sending',recipients,subject,html,actor)
 on conflict(version_id) do update set status='sending',recipients=excluded.recipients,subject=excluded.subject,body_html=excluded.body_html,error=null,updated_at=now(),attempted_by=actor returning * into a;
 return to_jsonb(a);
end $$;
revoke all on function public.commercial_claim_send(uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.commercial_claim_send(uuid,uuid,jsonb,text,text) to service_role;

create function crm_internal.commercial_dispatch_guard() returns trigger language plpgsql set search_path='' as $$
declare did uuid;
begin
 did=case when tg_table_name='catalog_orders' then old.id else old.order_id end;
 perform 1 from public.catalog_orders where id=did for update;
 if exists(select 1 from public.catalog_send_attempts a join public.catalog_document_versions v on v.id=a.version_id where v.document_id=did and a.status in ('sending','uncertain')) and auth.role()<>'service_role' then
  raise exception 'Envio em curso ou por confirmar. Resolva o estado do envio antes de alterar o documento';
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger a_commercial_dispatch_guard before update or delete on public.catalog_orders for each row execute function crm_internal.commercial_dispatch_guard();
create trigger a_commercial_dispatch_guard before update or delete on public.catalog_order_lines for each row execute function crm_internal.commercial_dispatch_guard();
