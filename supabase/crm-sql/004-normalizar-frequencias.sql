-- Normaliza a frequência de visita (texto) e preenche visit_frequency_days. Devolve só totais.
update public.clients set visit_frequency = 'Quinzenal' where lower(trim(visit_frequency)) in ('qinzenal','quinzenal') and visit_frequency <> 'Quinzenal';
update public.clients set visit_frequency = null where trim(coalesce(visit_frequency,'')) in ('', '0');
update public.clients set visit_frequency_days = case lower(trim(visit_frequency))
  when 'semanal' then 7 when 'quinzenal' then 15 when 'mensal' then 30 when 'bimestral' then 60
  when 'trimestral' then 90 when 'semestral' then 180 when 'anual' then 365 else null end;
select coalesce(visit_frequency,'(vazio)') as valor, count(*) as total from public.clients group by visit_frequency order by 2 desc;
