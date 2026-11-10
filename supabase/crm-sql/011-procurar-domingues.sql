-- Procura o registo "António Silva Domingues" (só códigos e que padrão bate).
select c.code,
  c.trade_name ilike '%ant%nio%silva%' as antonio_silva,
  c.trade_name ilike '%domin%' or coalesce(c.legal_name,'') ilike '%domin%' as domin,
  c.trade_name ilike '%silva d%' as silva_d,
  c.trade_name ilike '%fonseca%' as fonseca, c.trade_name ilike 'casa%' as comeca_casa,
  c.tax_id is not null as tem_nif,
  (select count(*) from client_contacts where client_id = c.id) as contactos,
  (select count(*) from client_contacts x where x.client_id = c.id and (concat_ws(' ', x.first_name, x.last_name) ilike '%domin%' or concat_ws(' ', x.first_name, x.last_name) ilike '%fonseca%')) as contacto_bate
from public.clients c
where c.trade_name ilike '%ant%nio%silva%' or c.trade_name ilike '%domin%' or coalesce(c.legal_name,'') ilike '%domin%'
   or c.trade_name ilike '%fonseca%'
   or exists (select 1 from client_contacts x where x.client_id = c.id and concat_ws(' ', x.first_name, x.last_name) ilike '%domin%')
order by c.code;
