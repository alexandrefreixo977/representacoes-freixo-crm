-- Encomenda de uma proposta enviada ao fabricante => proposta aceite (e, no CRM, oportunidade ganha).
-- Pedido do Alexandre, 12/11/2026 (caso Nogueira e Gonçalves).

create or replace function public.b2b_order_sent_accepts_quote() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('sent', 'confirmed', 'delivered') and new.status is distinct from old.status then
    update b2b_quotes q set status = 'accepted', updated_at = now()
    where q.status <> 'accepted'
      and (q.order_group_id = new.group_id or q.id = (select quote_id from b2b_order_groups where id = new.group_id));
  end if;
  return new;
end;
$$;
drop trigger if exists b2b_order_sent_accepts_quote on public.b2b_orders;
create trigger b2b_order_sent_accepts_quote after update of status on public.b2b_orders
  for each row execute function public.b2b_order_sent_accepts_quote();

-- Encomendas feitas antes desta ligação: liga cada proposta à encomenda do mesmo cliente, feita depois dela,
-- com exatamente os mesmos artigos e quantidades (e o mesmo total). Só quando a correspondência é única.
with cand as (
  select q.id as quote_id, g.id as group_id,
         count(*) over (partition by q.id) as n_q, count(*) over (partition by g.id) as n_g
  from b2b_quotes q
  join b2b_order_groups g on g.client_id = q.client_id and g.created_at >= q.created_at and g.quote_id is null
  where q.order_group_id is null and q.status in ('sent', 'accepted')
    and (select coalesce(sum(o.subtotal), 0) from b2b_orders o where o.group_id = g.id and o.status <> 'cancelled') = q.total
    and not exists (
      (select product_id, qty from b2b_quote_lines where quote_id = q.id)
      except
      (select l.product_id, l.qty from b2b_order_lines l join b2b_orders o on o.id = l.order_id where o.group_id = g.id))
    and not exists (
      (select l.product_id, l.qty from b2b_order_lines l join b2b_orders o on o.id = l.order_id where o.group_id = g.id)
      except
      (select product_id, qty from b2b_quote_lines where quote_id = q.id))
), pick as (select quote_id, group_id from cand where n_q = 1 and n_g = 1),
linked as (
  update b2b_order_groups g set quote_id = p.quote_id from pick p where g.id = p.group_id returning g.id, g.quote_id
)
update b2b_quotes q set order_group_id = l.id,
  status = case when q.status = 'sent' and exists (
                  select 1 from b2b_orders o where o.group_id = l.id and o.status in ('sent', 'confirmed', 'delivered'))
                then 'accepted' else q.status end,
  updated_at = now()
from linked l where q.id = l.quote_id;
