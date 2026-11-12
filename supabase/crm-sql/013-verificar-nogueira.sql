-- CRM: oportunidades do cliente "Nogueira e Gonçalves" (só códigos, fases e sim/não).
select c.code, c.tax_id is not null as tem_nif, o.reference, s.name as fase, o.outcome, o.estimated_value, o.final_value,
  o.b2b_quote_id is not null as vem_da_loja, o.source, o.created_at, o.updated_at
from clients c left join opportunities o on o.client_id = c.id left join opportunity_stages s on s.id = o.stage_id
where c.trade_name ilike '%nogueira%' or coalesce(c.legal_name, '') ilike '%nogueira%'
order by c.code, o.created_at;
