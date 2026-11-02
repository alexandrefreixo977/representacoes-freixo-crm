-- Validação de encomendas: a gestão pode alterar o desconto ou pôr um preço líquido numa linha
-- enquanto a encomenda ainda não foi enviada ao fabricante (pendente ou validada).
alter table public.b2b_order_lines add column if not exists price_edited boolean not null default false;
alter table public.b2b_orders add column if not exists client_notified_at timestamptz;

create or replace function public.b2b_admin_set_line_price(p_line uuid, p_discounts numeric[], p_net numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order uuid;
  v_status text;
  v_list numeric;
  v_qty numeric;
  v_disc numeric[];
  v_net numeric;
  d numeric;
begin
  if not b2b_is_admin() then
    raise exception 'Sem permissão';
  end if;
  select l.order_id, o.status, l.list_price, l.qty
    into v_order, v_status, v_list, v_qty
    from b2b_order_lines l
    join b2b_orders o on o.id = l.order_id
   where l.id = p_line
     for update of o;
  if v_order is null then
    raise exception 'Linha não encontrada';
  end if;
  if v_status not in ('pending', 'validated') then
    raise exception 'Só é possível alterar preços antes de enviar a encomenda ao fabricante';
  end if;
  if p_net is not null then
    if p_net < 0 or p_net > 1000000 then
      raise exception 'Preço líquido inválido';
    end if;
    v_disc := '{}';
    v_net := round(p_net, 4);
  else
    v_disc := coalesce(array(select x from unnest(coalesce(p_discounts, '{}')) x where x > 0 and x <= 100), '{}');
    v_net := v_list;
    foreach d in array v_disc loop
      v_net := v_net * (1 - d / 100);
    end loop;
    v_net := round(v_net, 4);
  end if;
  update b2b_order_lines
     set discounts = v_disc, net_price = v_net, line_total = round(v_net * v_qty, 2), price_edited = true
   where id = p_line;
  update b2b_orders
     set subtotal = (select coalesce(sum(line_total), 0) from b2b_order_lines where order_id = v_order)
   where id = v_order;
end;
$$;

revoke all on function public.b2b_admin_set_line_price(uuid, numeric[], numeric) from public, anon;
grant execute on function public.b2b_admin_set_line_price(uuid, numeric[], numeric) to authenticated;
