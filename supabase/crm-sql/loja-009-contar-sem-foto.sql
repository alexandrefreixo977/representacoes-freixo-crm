-- Loja B2B: artigos com e sem foto por fabricante (só totais; o catálogo é público).
select m.name,
       count(*) filter (where p.active) as ativos,
       count(*) filter (where p.active and coalesce(p.image_url,'') = '') as ativos_sem_foto,
       count(*) filter (where coalesce(p.image_url,'') = '') as todos_sem_foto,
       count(*) filter (where p.image_url like '/img/%') as foto_local,
       count(*) filter (where p.image_url like 'http%') as foto_externa
from public.b2b_products p join public.b2b_manufacturers m on m.id = p.manufacturer_id
group by m.name order by m.name;
