-- Fitas de serra à medida (Röntgen, pedido de 30/10/2026): o cliente indica o comprimento em mm.
-- size_type 'medida': o preço de tabela é por metro e b2b_prices.weld_price é a soldadura de cada fita.
-- Preço por fita = metros x preço/m + soldadura, e depois os descontos do cliente. Bate certo com priceFor() em src/pricing.ts.

alter table public.b2b_products drop constraint if exists b2b_products_size_type_check;
alter table public.b2b_products add constraint b2b_products_size_type_check
  check (size_type in ('calcado', 'vestuario', 'medida'));
alter table public.b2b_prices add column if not exists weld_price numeric check (weld_price >= 0);

create or replace function public.b2b_submit_order(p_items jsonb, p_customer_ref text, p_notes text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid := b2b_my_client();
  v_group uuid;
  v_number text;
  v_order uuid;
  v_seq int := 0;
  v_mfr record;
  v_item record;
  v_rule b2b_discount_rules;
  v_list numeric;
  v_disc numeric[];
  v_net numeric;
  v_qty numeric;
  v_mm int;
  v_weld numeric;
  d numeric;
begin
  if auth.uid() is null or v_client is null then
    raise exception 'Conta sem cliente associado';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Carrinho vazio';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'Demasiadas linhas';
  end if;

  v_number := 'ENC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('b2b_order_seq')::text, 4, '0');
  insert into b2b_order_groups (number, client_id, user_id, customer_ref, notes)
  values (v_number, v_client, auth.uid(), left(p_customer_ref, 80), left(p_notes, 2000))
  returning id into v_group;

  for v_mfr in
    select distinct p.manufacturer_id
    from jsonb_to_recordset(p_items) as i("productId" uuid, qty numeric, variant text)
    join b2b_products p on p.id = i."productId" and p.active
    order by p.manufacturer_id
  loop
    v_seq := v_seq + 1;
    insert into b2b_orders (group_id, number, client_id, manufacturer_id)
    values (v_group, v_number || '/' || v_seq, v_client, v_mfr.manufacturer_id)
    returning id into v_order;

    for v_item in
      select p.*, i.qty as wanted, nullif(left(trim(i.variant), 20), '') as chosen
      from jsonb_to_recordset(p_items) as i("productId" uuid, qty numeric, variant text)
      join b2b_products p on p.id = i."productId" and p.active
      where p.manufacturer_id = v_mfr.manufacturer_id and i.qty > 0
    loop
      if v_item.size_type is not null and v_item.chosen is null then
        raise exception 'Indique o % do artigo %',
          case when v_item.size_type = 'medida' then 'comprimento (mm)' else 'tamanho' end, v_item.reference;
      end if;
      select list_price, weld_price into v_list, v_weld from b2b_prices where product_id = v_item.id;
      if v_list is null then
        raise exception 'Artigo % sem preço', v_item.reference;
      end if;
      -- fita à medida: preço de tabela por metro -> preço por fita = metros x preço/m + soldadura
      v_mm := null;
      if v_item.size_type = 'medida' then
        v_mm := case when v_item.chosen ~ '^[0-9]{3,5}$' then v_item.chosen::int end;
        if v_mm is null or v_mm < 100 or v_mm > 20000 then
          raise exception 'Comprimento inválido no artigo % (indique em mm, entre 100 e 20000)', v_item.reference;
        end if;
        v_list := round(v_list * v_mm / 1000.0 + coalesce(v_weld, 0), 4);
      end if;
      -- caixas completas e quantidade mínima
      v_qty := ceil(greatest(v_item.wanted, v_item.moq, v_item.pack_qty) / v_item.pack_qty) * v_item.pack_qty;
      v_rule := b2b_pick_rule(v_client, v_item.id);
      if v_rule.special_net_price is not null and v_mm is null then
        v_disc := '{}';
        v_net := v_rule.special_net_price;
      else
        v_disc := coalesce(array(select x from unnest(v_rule.discounts) x where x > 0 and x <= 100), '{}');
        v_net := v_list;
        foreach d in array v_disc loop
          v_net := v_net * (1 - d / 100);
        end loop;
        v_net := round(v_net, 4);
      end if;
      insert into b2b_order_lines (order_id, product_id, reference, designation, variant, sales_unit, qty, list_price, discounts, net_price, line_total)
      values (v_order, v_item.id, v_item.reference,
              v_item.designation || case
                when v_mm is not null then ' · Comprimento ' || v_mm || ' mm'
                when v_item.chosen is not null then ' · Tam. ' || v_item.chosen else '' end,
              v_item.chosen, case when v_mm is not null then 'fita' else v_item.sales_unit end, v_qty, v_list, v_disc, v_net, round(v_net * v_qty, 2));
    end loop;

    update b2b_orders set subtotal = (select coalesce(sum(line_total), 0) from b2b_order_lines where order_id = v_order)
    where id = v_order;
  end loop;

  if v_seq = 0 then
    raise exception 'Nenhum artigo válido no carrinho';
  end if;
  return jsonb_build_object('groupId', v_group, 'groupNumber', v_number);
end;
$$;
revoke all on function public.b2b_submit_order(jsonb, text, text) from public, anon;
grant execute on function public.b2b_submit_order(jsonb, text, text) to authenticated;
