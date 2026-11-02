-- Dados da empresa de cada fabricante, mostrados nas propostas e notas de encomenda (pedido do Alexandre, 02/11/2026).
-- Preenchem-se em Gestão › Fabricantes. O site começa pelo domínio do email de encomendas.
alter table public.b2b_manufacturers
  add column if not exists legal_name text,
  add column if not exists nif text,
  add column if not exists address text,
  add column if not exists country text,
  add column if not exists phone text,
  add column if not exists website text;

update public.b2b_manufacturers
set website = 'www.' || split_part(lower(trim(trailing '.' from orders_email)), '@', 2)
where website is null and orders_email like '%@%.%';
