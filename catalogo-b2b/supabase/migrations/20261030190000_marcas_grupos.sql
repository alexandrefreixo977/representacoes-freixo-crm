-- Marcas agrupadas como no site representacoesfreixo.com (pedido do Alexandre, 30/10/2026).
-- sort 100–199 = EPI; 200–299 = Equipamentos e consumíveis industriais (a loja usa estes intervalos para os grupos).
-- Lugares guardados para marcas que ainda não estão na loja: Buff 110, Klever 150, Turbo 160, Dogher 240.
update public.b2b_manufacturers set sort = v.sort
from (values
  ('cofra-calcado', 120),
  ('cofra-vestuario', 121),
  ('jomiba', 130),
  ('jsp-safety', 140),
  ('vesin', 170),
  ('acha-herramientas', 210),
  ('aghasa-turis', 220),
  ('blue-master', 230),
  ('rontgen', 250)
) as v(slug, sort)
where public.b2b_manufacturers.slug = v.slug;
