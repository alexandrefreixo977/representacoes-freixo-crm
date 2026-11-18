-- Resumo de vendas: acrescenta as propostas da loja no período anterior (para comparar o total de propostas).
-- Resumo de vendas da loja B2B para o dashboard comercial do CRM (só com a chave de serviço).
-- Vendas = encomendas validadas, enviadas ao fabricante, confirmadas ou entregues (não conta pendentes nem anuladas).
-- O período anterior é comparável (mesmo número de dias): [p_prev_from, p_prev_to).
-- p_crm_clients filtra pelos clientes do CRM de um comercial (null = todos).
create or replace function public.b2b_sales_stats(p_from date, p_to date, p_prev_from date, p_prev_to date, p_crm_clients uuid[] default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with o as (
    select o.id, o.client_id, o.manufacturer_id, o.status, coalesce(o.subtotal, 0) as valor,
           (o.created_at at time zone 'Europe/Lisbon')::date as dia
      from b2b_orders o join b2b_clients c on c.id = o.client_id
     where p_crm_clients is null or c.crm_client_id = any(p_crm_clients)
  ),
  v as (select * from o where status in ('validated', 'sent', 'confirmed', 'delivered')),
  cur as (select * from v where dia >= p_from and dia < p_to),
  prev as (select * from v where dia >= p_prev_from and dia < p_prev_to),
  q as (
    select q.* from b2b_quotes q left join b2b_clients c on c.id = q.client_id
     where p_crm_clients is null or c.crm_client_id = any(p_crm_clients)
  ),
  months as (
    select to_char(m, 'YYYY-MM') as mes from generate_series(date_trunc('month', p_to - 1) - interval '11 months', date_trunc('month', p_to - 1), interval '1 month') m
  )
  select jsonb_build_object(
    'vendas', jsonb_build_object(
      'atual', (select jsonb_build_object('valor', coalesce(sum(valor), 0), 'encomendas', count(*), 'clientes', count(distinct client_id)) from cur),
      'anterior', (select jsonb_build_object('valor', coalesce(sum(valor), 0), 'encomendas', count(*), 'clientes', count(distinct client_id)) from prev)),
    'por_validar', (select jsonb_build_object('encomendas', count(*), 'valor', coalesce(sum(valor), 0)) from o where status = 'pending'),
    'mensal', (select jsonb_agg(jsonb_build_object('mes', m.mes, 'valor', coalesce(x.valor, 0), 'encomendas', coalesce(x.n, 0)) order by m.mes)
                 from months m left join (select to_char(dia, 'YYYY-MM') mes, sum(valor) valor, count(*) n from v group by 1) x on x.mes = m.mes),
    'marcas', coalesce((select jsonb_agg(x order by x.valor desc) from (
                 select coalesce(m.name, 'Outro') as marca, sum(cur.valor) as valor, count(*) as encomendas,
                        (select coalesce(sum(p.valor), 0) from prev p where p.manufacturer_id is not distinct from cur.manufacturer_id) as anterior
                   from cur left join b2b_manufacturers m on m.id = cur.manufacturer_id group by cur.manufacturer_id, m.name) x), '[]'::jsonb),
    'clientes', coalesce((select jsonb_agg(x order by x.valor desc) from (
                 select c.name as nome, c.crm_client_id, sum(cur.valor) as valor, count(*) as encomendas,
                        (select coalesce(sum(p.valor), 0) from prev p where p.client_id = c.id) as anterior
                   from cur join b2b_clients c on c.id = cur.client_id group by c.id, c.name, c.crm_client_id
                  order by 3 desc limit 10) x), '[]'::jsonb),
    'sem_encomenda', coalesce((select jsonb_agg(x order by x.ultima) from (
                 select c.name as nome, c.crm_client_id, max(v.dia) as ultima, sum(v.valor) as historico
                   from v join b2b_clients c on c.id = v.client_id group by c.id, c.name, c.crm_client_id
                  having max(v.dia) < p_to - 60 limit 10) x), '[]'::jsonb),
    'propostas', (select jsonb_build_object(
                    'enviadas', count(*) filter (where status in ('sent', 'accepted', 'lost')),
                    'aceites', count(*) filter (where status = 'accepted'),
                    'perdidas', count(*) filter (where status = 'lost'),
                    'em_aberto', count(*) filter (where status = 'sent'),
                    'valor_aceite', coalesce(sum(total) filter (where status = 'accepted'), 0),
                    'valor_aberto', coalesce(sum(total) filter (where status = 'sent'), 0))
                  from q where (created_at at time zone 'Europe/Lisbon')::date >= p_from and (created_at at time zone 'Europe/Lisbon')::date < p_to),
    'propostas_anterior', (select count(*) filter (where status in ('sent', 'accepted', 'lost')) from q
                  where (created_at at time zone 'Europe/Lisbon')::date >= p_prev_from and (created_at at time zone 'Europe/Lisbon')::date < p_prev_to),
    'pedidos_acesso', (select count(*) from b2b_access_requests r
                        where not exists (select 1 from b2b_users u where lower(u.email) = lower(r.email))),
    'clientes_loja', (select jsonb_build_object('ativos', count(*) filter (where active), 'com_encomenda', (select count(distinct client_id) from cur))
                        from b2b_clients c where p_crm_clients is null or c.crm_client_id = any(p_crm_clients))
  );
$$;
revoke all on function public.b2b_sales_stats(date, date, date, date, uuid[]) from public, anon, authenticated;
grant execute on function public.b2b_sales_stats(date, date, date, date, uuid[]) to service_role;
