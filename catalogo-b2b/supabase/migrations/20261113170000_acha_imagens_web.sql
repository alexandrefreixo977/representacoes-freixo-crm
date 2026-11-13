-- ACHA: fotos que faltavam, do site acha.com (página do produto onde a referência aparece). 2 de 2 artigos. Gerado por data/fetch_web_images.py.
update public.b2b_products p set image_url = v.url, updated_at = now()
from (values
('29105D', '/img/acha/acha2-2855f93260.jpg'),
('29402', '/img/acha/acha2-8b66be74e9.jpg')
) as v(ref, url), public.b2b_manufacturers m
where m.slug = 'acha-herramientas' and p.manufacturer_id = m.id and p.reference = v.ref
  and coalesce(p.image_url, '') !~* '\.(jpe?g|png|webp)(\?|$)';
