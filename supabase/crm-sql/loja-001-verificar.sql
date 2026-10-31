-- Verificação da loja B2B (só totais).
select 'clientes' as tipo, null::text as valor, count(*) as total from public.b2b_clients
union all select 'clientes com NIF', null, count(*) from public.b2b_clients where coalesce(nif,'')<>''
union all select 'encomendas', status, count(*) from public.b2b_orders group by status
union all select 'propostas', status, count(*) from public.b2b_quotes group by status
union all select 'propostas com cliente registado', null, count(*) from public.b2b_quotes where client_id is not null
union all select 'propostas com NIF', null, count(*) from public.b2b_quotes where coalesce(customer_nif,'')<>'';
