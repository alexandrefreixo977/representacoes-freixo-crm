-- Verificação (só nomes de fases e totais).
select 'fase' as tipo, name || ' | pos ' || position || ' | prob ' || probability || ' | terminal ' || coalesce(terminal::text,'null') as valor, null::bigint as total from public.opportunity_stages
union all select 'coluna oportunidade', column_name || ' ' || data_type, null from information_schema.columns where table_schema='public' and table_name='opportunities'
union all select 'oportunidades', coalesce(source,'(sem origem)'), count(*) from public.opportunities group by source
union all select 'clientes com NIF', null, count(*) from public.clients where coalesce(tax_id,'')<>'';
