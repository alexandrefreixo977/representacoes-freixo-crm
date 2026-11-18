-- Descontos gravados nas fichas dos clientes no CRM (Fabricantes / Marcas → Desconto) passam para a loja.
-- O CRM escreve estas regras (source = 'crm') com a chave de serviço; a loja só as lê.
-- Uma regra por cliente e fabricante, para o fabricante inteiro. Regras de família/artigo e campanhas
-- continuam a ganhar por serem mais específicas.
alter table public.b2b_discount_rules add column if not exists source text;
alter table public.b2b_discount_rules add column if not exists crm_relation_id uuid;
create unique index if not exists b2b_discount_rules_crm_unique
  on public.b2b_discount_rules (client_id, manufacturer_id) where source = 'crm';

-- Empate no mesmo nível (cliente, fabricante inteiro): a regra feita à mão na loja ganha à do CRM.
create or replace function public.b2b_pick_rule(p_client uuid, p_product uuid)
returns public.b2b_discount_rules
language sql stable security definer set search_path = public as $$
  select r.* from b2b_discount_rules r
  join b2b_products p on p.id = p_product
  where r.active
    and (r.valid_until is null or r.valid_until >= current_date)
    and r.manufacturer_id = p.manufacturer_id
    and (r.client_id is null or r.client_id = p_client)
    and (r.product_id is null or r.product_id = p.id)
    and (r.family_id is null or r.family_id = p.family_id)
  order by (case when r.product_id is not null then 2 when r.family_id is not null then 1 else 0 end) desc,
           (r.client_id is not null) desc,
           (r.source is distinct from 'crm') desc
  limit 1;
$$;
