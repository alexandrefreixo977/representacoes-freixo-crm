begin;
select set_config('request.jwt.claims','{"sub":"2decb535-0aee-4959-b81b-8b928056ba75","role":"authenticated"}',true);
set local role authenticated;
do $$
declare cid uuid;did uuid;mid uuid;pid uuid;vid uuid;price numeric;qty numeric;lead_id uuid;payload jsonb;d public.catalog_orders;
begin
 select p.id,p.manufacturer_id,i.variant_id,i.list_price,coalesce(v.minimum_pack,p.minimum_pack,1) into strict pid,mid,vid,price,qty
 from public.catalog_products p join public.catalog_price_list_items i on i.product_id=p.id join public.catalog_price_lists pl on pl.id=i.price_list_id left join public.catalog_product_variants v on v.id=i.variant_id where not p.is_test and p.active and not pl.is_test limit 1;
 lead_id=public.commercial_lead(jsonb_build_object('trade_name','QA COMERCIAL ROLLBACK','email','qa-commercial-rollback@example.invalid'));
 if not exists(select 1 from public.activities where client_id=lead_id and source_module='lead_profile' and due_date is null and not has_time) then raise exception 'FAIL: tarefa do lead deve existir sem data inventada';end if;
 begin perform public.commercial_lead(jsonb_build_object('trade_name','QA COMERCIAL ROLLBACK','email','qa-commercial-rollback@example.invalid'));raise exception 'FAIL: duplicado aceite';exception when others then if sqlerrm='FAIL: duplicado aceite' then raise;end if;end;
 payload=jsonb_build_object('client_id',lead_id,'manufacturer_id',mid,'document_type','proposal','currency','EUR','lines',jsonb_build_array(jsonb_build_object('product_id',pid,'variant_id',vid,'quantity',qty,'list_price_snapshot',0.01,'applied_discounts',jsonb_build_array(40,10,5))));
 did=public.commercial_save_document(payload);
 select * into strict d from public.catalog_orders where id=did;
 if d.order_number not like 'ORC-%' then raise exception 'FAIL: numeração';end if;
 if not exists(select 1 from public.catalog_order_lines where order_id=did and list_price_snapshot=price and net_unit_price=round(price*.6*.9*.95,2)) then raise exception 'FAIL: preço oficial/desconto';end if;
 if d.shipping_known or d.vat_treatment<>'undetermined' then raise exception 'FAIL: portes/IVA';end if;
 perform public.commercial_transition(did,'pending_validation');
 begin perform public.commercial_save_document(payload||jsonb_build_object('id',did));raise exception 'FAIL: alteração de documento protegido';exception when others then if sqlerrm='FAIL: alteração de documento protegido' then raise;end if;end;
 begin update public.catalog_orders set workflow_state='validated' where id=did;raise exception 'FAIL: validação direta';exception when others then if sqlerrm='FAIL: validação direta' then raise;end if;end;
 perform public.commercial_transition(did,'draft');
 perform public.commercial_save_document(payload||jsonb_build_object('id',did,'row_version',(select row_version from public.catalog_orders where id=did)));
 perform public.commercial_transition(did,'cancelled','Teste em transação revertida');
 if not exists(select 1 from public.catalog_document_events where document_id=did) then raise exception 'FAIL: histórico';end if;
 did=public.commercial_save_document(payload);
 perform public.commercial_transition(did,'pending_validation');
 perform set_config('qa.commercial_document',did::text,true);
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"2decb535-0aee-4959-b81b-8b928056ba75","role":"service_role"}',true);
set local role service_role;
do $$
declare did uuid:=current_setting('qa.commercial_document')::uuid;vid uuid;attempt jsonb;
begin
 vid=public.commercial_approve(did,(select row_version from public.catalog_orders where id=did),'2decb535-0aee-4959-b81b-8b928056ba75','{}',repeat('A',100),repeat('a',64),'TESTE-REVERTIDO.pdf');
 attempt=public.commercial_claim_send(vid,'2decb535-0aee-4959-b81b-8b928056ba75','{"to":["qa@example.invalid"]}','TESTE REVERTIDO','<p>Teste sem envio real</p>');
 begin perform public.commercial_claim_send(vid,'2decb535-0aee-4959-b81b-8b928056ba75','{"to":["qa@example.invalid"]}','TESTE','Teste');raise exception 'FAIL: envio duplicado';exception when others then if sqlerrm='FAIL: envio duplicado' then raise;end if;end;
 perform public.commercial_finish_send((attempt->>'id')::uuid,'2decb535-0aee-4959-b81b-8b928056ba75','accepted',null,null);
 perform public.commercial_finish_send((attempt->>'id')::uuid,'2decb535-0aee-4959-b81b-8b928056ba75','accepted',null,null);
 if (select count(*) from public.catalog_document_events where document_id=did and event_type='email_accepted')<>1 then raise exception 'FAIL: finalização duplicada';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"2decb535-0aee-4959-b81b-8b928056ba75","role":"authenticated"}',true);
set local role authenticated;
do $$
declare did uuid:=current_setting('qa.commercial_document')::uuid;oid uuid;other uuid;
begin
 perform public.commercial_transition(did,'accepted');
 oid=public.commercial_convert_proposal(did);other=public.commercial_convert_proposal(did);
 if oid<>other then raise exception 'FAIL: conversão duplicada';end if;
 if not exists(select 1 from public.catalog_orders where id=oid and source_proposal_id=did and order_number like 'ENC-%') then raise exception 'FAIL: relação orçamento/encomenda';end if;
 other=public.commercial_copy_document(did,'revision','Correção de teste revertida');
 if not exists(select 1 from public.catalog_orders where id=other and revision_of_id=did and workflow_state='draft') then raise exception 'FAIL: revisão';end if;
 begin update public.catalog_order_lines set quantity=quantity+1 where order_id=did;raise exception 'FAIL: artigo enviado alterável';exception when others then if sqlerrm='FAIL: artigo enviado alterável' then raise;end if;end;
end $$;
rollback;
