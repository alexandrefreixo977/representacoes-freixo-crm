-- Loja B2B: visitas do site WordPress registadas pela imagem-contador (só totais)
select site, count(*) as registos, count(distinct visitor) as visitantes,
       count(*) filter (where page = '/') as na_raiz, count(brand_slug) as com_marca
  from public.b2b_visits where day >= current_date - 1 group by site order by site;
select jsonb_path_query_array(public.b2b_visit_stats(30)->'marcas', '$[*].marca') as marcas;
