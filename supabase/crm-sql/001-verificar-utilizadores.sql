-- Verificação (só totais e estrutura, sem dados pessoais).
select 'colunas' as tipo, string_agg(column_name, ',' order by ordinal_position) as valor, null::bigint as total
  from information_schema.columns where table_schema='public' and table_name='profiles'
union all
select 'perfil ' || role::text || ' ativo=' || active::text, null, count(*) from public.profiles group by role, active
union all
select 'utilizadores auth', null, count(*) from auth.users;
