-- Descontos gravados nas fichas dos clientes (client_manufacturers), por fabricante e estado (só totais, sem clientes).
select m.name as fabricante, coalesce(cm.discount_status, '—') as estado,
       count(*) filter (where cm.agreed_discount is not null) as com_desconto,
       count(*) as associacoes,
       min(cm.agreed_discount) as min, max(cm.agreed_discount) as max
from public.client_manufacturers cm join public.manufacturers m on m.id = cm.manufacturer_id
group by 1, 2 order by 1, 2;
