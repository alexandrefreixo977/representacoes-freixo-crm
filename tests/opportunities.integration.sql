-- Run as an administrator in the SQL test connection. All fixtures roll back.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where active and role='admin' limit 1),true);
set local role authenticated;
do $$
declare oid uuid;cid uuid;did uuid;ord uuid;mid uuid;prod uuid;tid uuid;n numeric;owner uuid:=auth.uid();other_user uuid;
begin
 select id,manufacturer_id into strict prod,mid from public.catalog_products where active limit 1;
 oid=public.opportunity_save(jsonb_build_object('lead',jsonb_build_object('trade_name','QA transacional do ciclo','email','qa-cycle@example.invalid'),'title','QA comercial','manufacturer_id',mid,'next_action','Telefonar','next_action_date','2026-10-07','next_action_time','10:00','schedule_timezone','Europe/Lisbon'));
 select client_id into cid from public.opportunities where id=oid;
 select id into strict tid from public.activities where opportunity_id=oid and opportunity_role='next_action';
 if not exists(select 1 from public.activities where client_id=cid and source_module='lead_profile' and status='scheduled')then raise exception 'Missing completeness alert';end if;
 begin perform public.opportunity_save('{"lead":{"trade_name":"QA transacional do ciclo","email":"QA-CYCLE@example.invalid"}}');raise exception 'duplicate allowed';exception when others then if sqlerrm='duplicate allowed'then raise;end if;end;
 update public.activities set start_at='2026-10-08T09:00:00Z',due_date='2026-10-08' where id=tid;
 if (select next_action_date from public.opportunities where id=oid)<>'2026-10-08'::date or (select next_action_time from public.opportunities where id=oid)<>'10:00'::time then raise exception 'Reschedule/timezone mismatch';end if;
 did=public.commercial_save_document(jsonb_build_object('opportunity_id',oid,'client_id',cid,'manufacturer_id',mid,'document_type','proposal','lines',jsonb_build_array(jsonb_build_object('product_id',prod,'quantity',2,'list_price_snapshot',100,'applied_discounts',jsonb_build_array(40,10)))));
 select total into n from public.catalog_orders where id=did;if n<>108 then raise exception 'Successive discounts expected 108, got %',n;end if;
 perform public.opportunity_record_email(oid,did,'QA proposal','<p>QA</p>','QA',jsonb_build_object('to',jsonb_build_array('qa@example.invalid')));
 if(select stage_name from public.opportunity_board where id=oid)<>'Proposta enviada'then raise exception 'Send stage not advanced';end if;
 begin update public.catalog_order_lines set quantity=9 where order_id=did;raise exception 'sent snapshot editable';exception when others then if sqlerrm='sent snapshot editable'then raise;end if;end;
 perform public.opportunity_transition(oid,(select id from public.opportunity_stages where name='Ganha'),jsonb_build_object('confirmed',true,'final_value',108,'winning_proposal_id',did));
 ord=public.commercial_convert_proposal(did);
 if public.commercial_convert_proposal(did)<>ord then raise exception 'Duplicate conversion';end if;
 if(select total from public.catalog_orders where id=ord)<>108 then raise exception 'Snapshot lost';end if;
 begin update public.catalog_orders set status='confirmed'where id=ord;raise exception 'Incomplete order allowed';exception when others then if sqlerrm='Incomplete order allowed'then raise;end if;end;
 update public.clients set phone='123456789',address='QA',city='Lisboa',country='Portugal',tax_id='999999990',postal_code='1000-000' where id=cid;
 if(select is_lead from public.clients where id=cid)then raise exception 'Lead not completed';end if;
 if exists(select 1 from public.activities where client_id=cid and source_module='lead_profile' and status<>'completed')then raise exception 'Completeness alert not completed';end if;
 update public.catalog_orders set status='confirmed'where id=ord;
 update public.opportunities set outcome='archived'where id=oid;
 if(select outcome from public.opportunities where id=oid)<>'archived'then raise exception 'Archive failed';end if;
 perform public.opportunity_transition(oid,(select id from public.opportunity_stages where name='Qualificado'));
 if(select outcome from public.opportunities where id=oid)<>'active'then raise exception 'Reopen failed';end if;
 begin perform public.opportunity_transition(oid,(select id from public.opportunity_stages where name='Perdida'),'{"confirmed":true}');raise exception 'Loss without reason allowed';exception when others then if sqlerrm='Loss without reason allowed'then raise;end if;end;
 perform public.opportunity_transition(oid,(select id from public.opportunity_stages where name='Perdida'),'{"confirmed":true,"loss_reason":"Preço"}');
 if(select count(*)from public.activities where opportunity_id=oid and opportunity_role='next_action')<>1 then raise exception 'Duplicate task';end if;
 select id into other_user from public.profiles where active and role<>'admin' and id<>owner limit 1;
 if other_user is not null then
 perform set_config('request.jwt.claim.sub',other_user::text,true);
 if exists(select 1 from public.opportunities where id=oid)or exists(select 1 from public.opportunity_events where opportunity_id=oid)or exists(select 1 from public.activities where opportunity_id=oid)or exists(select 1 from public.catalog_orders where id=did)then raise exception 'Cross-user visibility';end if;
 begin perform public.opportunity_save(jsonb_build_object('id',oid,'title','unauthorized'));raise exception 'Cross-user write';exception when others then if sqlerrm='Cross-user write'then raise;end if;end;
 perform set_config('request.jwt.claim.sub',owner::text,true);
 end if;
end $$;
rollback;
