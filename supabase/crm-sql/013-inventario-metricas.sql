-- Inventário para o dashboard comercial: colunas e totais (sem dados pessoais)
select table_name, string_agg(column_name||':'||data_type, ', ' order by ordinal_position) as colunas
  from information_schema.columns where table_schema='public'
   and table_name in ('opportunities','opportunity_stages','catalog_orders','catalog_order_lines','manufacturer_commissions','visits','clients','client_manufacturers','opportunity_events')
 group by table_name;
select name, position, probability, terminal from public.opportunity_stages order by position;
select s.name as fase, count(*) as n, round(sum(coalesce(o.estimated_value,0))) as valor,
       min(o.created_at)::date as primeira, max(o.updated_at)::date as ultima
  from public.opportunities o left join public.opportunity_stages s on s.id=o.stage_id group by 1 order by 1;
select document_type, coalesce(proposal_status,status::text) as estado, count(*) as n, round(sum(coalesce(total,0))) as total,
       min(created_at)::date as primeira, max(created_at)::date as ultima
  from public.catalog_orders group by 1,2 order by 1,2;
select kind, count(*) as n, count(*) filter (where occurred_at > now()-interval '90 days') as n_90d from public.activities group by 1 order by 2 desc;
select count(*) as visitas_tabela, max(created_at)::date from public.visits;
select count(*) as clientes, count(*) filter (where deleted_at is null) as ativos from public.clients;
select count(*) as fabricantes_comissao from public.manufacturer_commissions;
select role, count(*) from public.profiles where active group by 1;
