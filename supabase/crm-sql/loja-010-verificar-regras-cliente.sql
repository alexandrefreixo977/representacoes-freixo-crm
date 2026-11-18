-- Regras de desconto por cliente na loja (só totais) e fabricantes da loja.
select 'fabricante' as tipo, name || ' / ativo=' || active as valor, null::bigint as total from public.b2b_manufacturers
union all select 'clientes da loja', null, count(*) from public.b2b_clients
union all select 'clientes ligados ao CRM', null, count(*) from public.b2b_clients where crm_client_id is not null
union all select 'regras de cliente (fabricante inteiro)', m.name, count(*) from public.b2b_discount_rules r join public.b2b_manufacturers m on m.id = r.manufacturer_id
  where r.client_id is not null and r.family_id is null and r.product_id is null group by m.name
union all select 'regras de cliente (família/artigo)', null, count(*) from public.b2b_discount_rules where client_id is not null and (family_id is not null or product_id is not null)
union all select 'regras gerais (sem campanha)', null, count(*) from public.b2b_discount_rules where client_id is null and campaign_id is null;
