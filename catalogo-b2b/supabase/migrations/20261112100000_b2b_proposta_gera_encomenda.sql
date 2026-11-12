-- Proposta aceite pelo cliente -> encomenda (pedido do Alexandre, 12/11/2026).
-- Ao confirmar a aprovação ("Aceite"), a app gera a encomenda com os preços e quantidades da proposta
-- (o que o cliente aprovou), dividida por fabricante, e fica "a validar" como as outras.

alter table public.b2b_quotes add column if not exists order_group_id uuid references public.b2b_order_groups(id) on delete set null;
alter table public.b2b_order_groups add column if not exists quote_id uuid references public.b2b_quotes(id) on delete set null;

create or replace function public.b2b_quote_to_order(p_quote uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_q b2b_quotes;
  v_client uuid;
  v_nif text;
  v_group uuid;
  v_number text;
  v_order uuid;
  v_seq int := 0;
  v_mfr record;
  v_missing text;
begin
  if not b2b_is_staff() then
    raise exception 'Só a equipa Freixo pode converter propostas';
  end if;
  select * into v_q from b2b_quotes where id = p_quote for update;
  if v_q.id is null or not (b2b_is_admin() or v_q.owner_id = auth.uid()) then
    raise exception 'Proposta não encontrada';
  end if;
  if v_q.status <> 'accepted' then
    raise exception 'A proposta % ainda não está aceite', v_q.number;
  end if;
  -- Já convertida: devolve a encomenda que existe (nunca duplica).
  if v_q.order_group_id is not null then
    return jsonb_build_object('groupId', v_q.order_group_id,
      'groupNumber', (select number from b2b_order_groups where id = v_q.order_group_id), 'created', false);
  end if;

  -- Artigos: linhas do catálogo; uma linha livre só serve se a referência existir no catálogo.
  create temp table if not exists _qlines (pos int, product_id uuid, manufacturer_id uuid, reference text, designation text,
    variant text, size_type text, sales_unit text, qty numeric, list_price numeric, discounts numeric[], net_price numeric) on commit drop;
  truncate _qlines;
  insert into _qlines
  select l.position, p.id, p.manufacturer_id, coalesce(p.reference, l.reference), l.designation, l.variant, p.size_type,
         l.sales_unit, l.qty, l.list_price, l.discounts, l.net_price
  from b2b_quote_lines l
  left join lateral (
    select x.* from b2b_products x
    where (l.product_id is not null and x.id = l.product_id)
       or (l.product_id is null and upper(regexp_replace(x.reference, '[\s.\-_/]', '', 'g')) = upper(regexp_replace(l.reference, '[\s.\-_/]', '', 'g')))
    order by (x.id = l.product_id) desc nulls last, x.active desc
    limit 1
  ) p on true
  where l.quote_id = v_q.id and l.qty > 0;

  if not exists (select 1 from _qlines) then
    raise exception 'A proposta % não tem artigos', v_q.number;
  end if;
  select string_agg(reference, ', ' order by pos) into v_missing from _qlines where product_id is null;
  if v_missing is not null then
    raise exception 'Estes artigos não estão no catálogo da loja e não podem ir para a encomenda: %. Troque-os por artigos do catálogo ou retire-os.', v_missing;
  end if;
  select string_agg(reference, ', ' order by pos) into v_missing from _qlines where size_type is not null and coalesce(trim(variant), '') = '';
  if v_missing is not null then
    raise exception 'Indique o tamanho/comprimento destes artigos antes de gerar a encomenda: %', v_missing;
  end if;

  -- Cliente: o da proposta; senão um cliente da loja com o mesmo NIF; senão cria a ficha com os dados da proposta.
  v_client := v_q.client_id;
  v_nif := nullif(regexp_replace(coalesce(v_q.customer_nif, ''), '\D', '', 'g'), '');
  if v_client is null and v_nif is not null then
    select id into v_client from b2b_clients where regexp_replace(coalesce(nif, ''), '\D', '', 'g') = v_nif order by active desc, created_at limit 1;
  end if;
  if v_client is null then
    insert into b2b_clients (name, nif, email, phone, address)
    values (v_q.customer_name, nullif(trim(v_q.customer_nif), ''), nullif(trim(v_q.customer_email), ''),
            nullif(trim(v_q.customer_phone), ''), nullif(trim(v_q.customer_address), ''))
    returning id into v_client;
  end if;

  v_number := 'ENC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('b2b_order_seq')::text, 4, '0');
  insert into b2b_order_groups (number, client_id, user_id, customer_ref, notes, placed_by_staff, quote_id)
  values (v_number, v_client, auth.uid(), left(v_q.number, 80),
          left('Proposta ' || v_q.number || ' aceite pelo cliente.' || coalesce(E'\n' || nullif(trim(v_q.notes), ''), ''), 2000),
          true, v_q.id)
  returning id into v_group;

  for v_mfr in select distinct manufacturer_id from _qlines order by manufacturer_id loop
    v_seq := v_seq + 1;
    insert into b2b_orders (group_id, number, client_id, manufacturer_id)
    values (v_group, v_number || '/' || v_seq, v_client, v_mfr.manufacturer_id)
    returning id into v_order;

    insert into b2b_order_lines (order_id, product_id, reference, designation, variant, sales_unit, qty, list_price, discounts, net_price, line_total)
    select v_order, product_id, reference,
           designation || case
             when coalesce(trim(variant), '') = '' or designation like '%· Tam.%' or designation like '%· Comprimento%' then ''
             when size_type = 'medida' then ' · Comprimento ' || trim(variant) || ' mm'
             else ' · Tam. ' || trim(variant) end,
           nullif(trim(variant), ''), sales_unit, qty, list_price, discounts, net_price, round(net_price * qty, 2)
    from _qlines where manufacturer_id = v_mfr.manufacturer_id order by pos;

    update b2b_orders set subtotal = (select coalesce(sum(line_total), 0) from b2b_order_lines where order_id = v_order)
    where id = v_order;
  end loop;

  update b2b_quotes set order_group_id = v_group, client_id = v_client, updated_at = now() where id = v_q.id;
  return jsonb_build_object('groupId', v_group, 'groupNumber', v_number, 'created', true);
end;
$$;
revoke all on function public.b2b_quote_to_order(uuid) from public, anon;
grant execute on function public.b2b_quote_to_order(uuid) to authenticated;
