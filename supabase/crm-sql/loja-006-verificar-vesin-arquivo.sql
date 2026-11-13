-- Depois de retirar a VESIN: confirma que a loja ficou limpa e que a cópia de segurança existe (só totais).
select 'fabricante na loja' as tipo, count(*) as total from public.b2b_manufacturers where slug = 'vesin' or name ilike '%vesin%'
union all select 'artigos na loja', count(*) from public.b2b_products p join public.b2b_manufacturers m on m.id = p.manufacturer_id where m.slug = 'vesin'
union all select 'arquivo: fabricante', count(*) from arquivo.vesin_fabricante
union all select 'arquivo: famílias', count(*) from arquivo.vesin_familias
union all select 'arquivo: artigos', count(*) from arquivo.vesin_artigos
union all select 'arquivo: preços', count(*) from arquivo.vesin_precos
union all select 'arquivo: regras', count(*) from arquivo.vesin_regras
union all select 'arquivo: campanhas', count(*) from arquivo.vesin_campanhas;
