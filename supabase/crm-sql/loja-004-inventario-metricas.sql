-- Loja B2B: inventário para o dashboard comercial (colunas e totais, sem dados pessoais)
select jsonb_build_object(
 'colunas', (select jsonb_object_agg(table_name, cols) from (select table_name, string_agg(column_name, ',' order by ordinal_position) cols
   from information_schema.columns where table_schema='public'
   and table_name in ('b2b_orders','b2b_order_groups','b2b_order_lines','b2b_quotes','b2b_clients','b2b_access_requests','b2b_users') group by table_name) t),
 'encomendas', (select jsonb_agg(x) from (select status::text, count(*) n, min(created_at)::date primeira, max(created_at)::date ultima from public.b2b_orders group by 1) x),
 'propostas', (select jsonb_agg(x) from (select status::text, count(*) n from public.b2b_quotes group by 1) x),
 'clientes', (select count(*) from public.b2b_clients),
 'clientes_com_crm', (select count(*) from public.b2b_clients where crm_client_id is not null),
 'utilizadores', (select jsonb_object_agg(role, n) from (select role::text, count(*) n from public.b2b_users group by 1) x),
 'pedidos_acesso', (select jsonb_agg(x) from (select status::text, count(*) n from public.b2b_access_requests group by 1) x)
) as inventario;
