-- Loja B2B: a encomenda ENC-2026-0005 corresponde a que proposta? (só números e contagens)
select o.number, o.status, o.subtotal, o.created_at, o.status_changed_at, g.placed_by_staff,
  (select count(*) from b2b_order_lines l where l.order_id = o.id) as linhas,
  q.number as proposta, q.status as estado_proposta, q.total as total_proposta,
  (select count(*) from b2b_quote_lines ql where ql.quote_id = q.id) as linhas_proposta,
  (select count(*) from b2b_quote_lines ql join b2b_order_lines l on l.order_id = o.id and l.product_id = ql.product_id and l.qty = ql.qty where ql.quote_id = q.id) as linhas_iguais
from b2b_orders o join b2b_order_groups g on g.id = o.group_id
join b2b_quotes q on q.client_id = o.client_id
where o.number like 'ENC-2026-0005%'
order by q.number;
