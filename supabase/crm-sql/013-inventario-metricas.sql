-- Inventário para o dashboard comercial: colunas e totais (sem dados pessoais)
select jsonb_build_object(
 'colunas', (select jsonb_object_agg(table_name, cols) from (select table_name, string_agg(column_name, ',' order by ordinal_position) cols
   from information_schema.columns where table_schema='public'
   and table_name in ('opportunities','opportunity_stages','catalog_orders','catalog_order_lines','manufacturer_commissions','visits','clients','client_manufacturers','opportunity_events','activities') group by table_name) t),
 'fases', (select jsonb_agg(jsonb_build_object('n',name,'p',position,'prob',probability,'t',terminal) order by position) from public.opportunity_stages),
 'oport', (select jsonb_agg(x) from (select s.name fase, count(*) n, round(sum(coalesce(o.estimated_value,0))) valor, min(o.created_at)::date primeira, max(o.updated_at)::date ultima
   from public.opportunities o left join public.opportunity_stages s on s.id=o.stage_id group by 1) x),
 'docs', (select jsonb_agg(x) from (select document_type, proposal_status, status::text st, count(*) n, round(sum(coalesce(total,0))) total, min(created_at)::date primeira, max(created_at)::date ultima
   from public.catalog_orders group by 1,2,3) x),
 'ativ', (select jsonb_agg(x) from (select kind, count(*) n, count(*) filter (where occurred_at > now()-interval '90 days') n90 from public.activities group by 1) x),
 'visits', (select count(*) from public.visits),
 'clientes', (select count(*) from public.clients),
 'comissoes', (select count(*) from public.manufacturer_commissions),
 'perfis', (select jsonb_object_agg(role, n) from (select role::text, count(*) n from public.profiles where active group by 1) x)
) as inventario;
