-- Loja B2B: propostas e encomendas do cliente "Nogueira e Gonçalves" (só números, estados e sim/não).
select q.number, q.status, q.total,
  q.client_id is not null as tem_cliente_loja,
  c.crm_client_id is not null as cliente_ligado_crm,
  coalesce(q.customer_nif, c.nif, '') <> '' as tem_nif,
  q.order_group_id is not null as tem_encomenda_ligada,
  (select string_agg(o.number || ':' || o.status, ', ' order by o.number) from b2b_orders o where o.group_id = q.order_group_id) as encomendas_da_proposta,
  (select string_agg(o.number || ':' || o.status || ':' || coalesce(g.quote_id::text <> '', false)::text, ', ' order by o.number)
     from b2b_orders o join b2b_order_groups g on g.id = o.group_id where o.client_id = q.client_id) as encomendas_do_cliente,
  q.updated_at
from b2b_quotes q left join b2b_clients c on c.id = q.client_id
where q.customer_name ilike '%nogueira%' or c.name ilike '%nogueira%'
order by q.created_at;
