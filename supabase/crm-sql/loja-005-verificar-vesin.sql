-- Levantamento da VESIN na loja B2B antes de a retirar (só totais).
with m as (select id from public.b2b_manufacturers where slug = 'vesin' or name ilike '%vesin%'),
p as (select id from public.b2b_products where manufacturer_id in (select id from m))
select 'fabricante' as tipo, (select string_agg(name || ' / ativo=' || active, ', ') from public.b2b_manufacturers where id in (select id from m)) as valor, (select count(*) from m) as total
union all select 'artigos', null, count(*) from p
union all select 'artigos ativos', null, count(*) from public.b2b_products where id in (select id from p) and active
union all select 'artigos com foto', null, count(*) from public.b2b_products where id in (select id from p) and coalesce(image_url,'')<>''
union all select 'fotos no Storage b2b-imagens', null, count(*) from public.b2b_products where id in (select id from p) and image_url ilike '%b2b-imagens%'
union all select 'artigos com ficha técnica', null, count(*) from public.b2b_products where id in (select id from p) and coalesce(tech_sheet_url,'')<>''
union all select 'preços', null, count(*) from public.b2b_prices where product_id in (select id from p)
union all select 'famílias', null, count(*) from public.b2b_families where manufacturer_id in (select id from m)
union all select 'regras gerais', null, count(*) from public.b2b_discount_rules where manufacturer_id in (select id from m) and client_id is null
union all select 'regras de cliente', null, count(*) from public.b2b_discount_rules where manufacturer_id in (select id from m) and client_id is not null
union all select 'regras de campanha', null, count(*) from public.b2b_discount_rules where manufacturer_id in (select id from m) and campaign_id is not null
union all select 'campanhas', null, count(*) from public.b2b_campaigns where manufacturer_id in (select id from m) or product_id in (select id from p)
union all select 'encomendas', status, count(*) from public.b2b_orders where manufacturer_id in (select id from m) group by status
union all select 'linhas de encomenda', null, count(*) from public.b2b_order_lines where product_id in (select id from p)
union all select 'linhas de proposta', null, count(*) from public.b2b_quote_lines where product_id in (select id from p) or manufacturer_name ilike '%vesin%'
union all select 'propostas com VESIN', null, count(distinct quote_id) from public.b2b_quote_lines where product_id in (select id from p) or manufacturer_name ilike '%vesin%'
union all select 'campanhas que falam da VESIN', null, count(*) from public.b2b_campaigns where coalesce(title,'')||coalesce(subtitle,'')||coalesce(badge,'') ilike '%vesin%'
union all select 'artigos de outras marcas com VESIN no texto', null, count(*) from public.b2b_products where manufacturer_id not in (select id from m) and (designation ilike '%vesin%' or coalesce(description,'') ilike '%vesin%');
