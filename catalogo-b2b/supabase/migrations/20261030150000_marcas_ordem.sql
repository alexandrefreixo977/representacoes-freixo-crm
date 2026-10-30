-- Ordem das marcas na loja igual à do site representacoesfreixo.com (menu "Marcas", 30/10/2026):
-- Acha, Aghasa Turis, Bluemaster, Buff, Cofra, Dogher, Klever, Jomiba, JSP, Röntgen, Turbo.
-- Os números deixam espaço para as marcas que ainda não estão na loja (Buff 35, Dogher 60, Klever 70, Turbo 110).
update public.b2b_manufacturers set sort = v.sort
from (values
  ('acha-herramientas', 10),
  ('aghasa-turis', 20),
  ('blue-master', 30),
  ('cofra-calcado', 40),
  ('cofra-vestuario', 41),
  ('jomiba', 80),
  ('jsp-safety', 90),
  ('rontgen', 100)
) as v(slug, sort)
where public.b2b_manufacturers.slug = v.slug;
