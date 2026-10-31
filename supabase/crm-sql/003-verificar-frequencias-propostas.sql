-- Verificação (só totais; os valores de frequência são texto genérico como "Mensal").
select 'clientes' as tipo, null::text as valor, count(*) as total from public.clients
union all select 'freq_dias preenchida', null, count(*) from public.clients where visit_frequency_days is not null
union all select 'freq_texto', coalesce(visit_frequency,'(vazio)'), count(*) from public.clients group by visit_frequency
union all select 'clientes com last_visit_at', null, count(*) from public.clients where last_visit_at is not null
union all select 'proposta ' || proposal_status, null, count(*) from public.catalog_orders where document_type='proposal' group by proposal_status
union all select 'proposta enviada ha mais de 7 dias sem resposta', null, count(*) from public.catalog_orders where document_type='proposal' and proposal_status='sent' and sent_at < now() - interval '7 days';
