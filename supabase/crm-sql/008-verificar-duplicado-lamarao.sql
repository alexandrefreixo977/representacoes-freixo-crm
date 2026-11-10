-- Verificação antes de unificar CLI0168 e CLI0326 (Lamarão & Rocha). Só contagens e campos preenchidos (sim/não).
create temp table chk (cliente text, tabela text, total bigint);
do $$
declare r record; c record; n bigint;
begin
  for c in select id, code from public.clients where code in ('CLI0168','CLI0326') loop
    for r in
      select tc.table_schema s, tc.table_name t, kcu.column_name col
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
        join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
       where tc.constraint_type = 'FOREIGN KEY' and ccu.table_schema = 'public' and ccu.table_name = 'clients' and ccu.column_name = 'id'
    loop
      execute format('select count(*) from %I.%I where %I = $1', r.s, r.t, r.col) into n using c.id;
      if n > 0 then insert into chk values (c.code, r.t || '.' || r.col, n); end if;
    end loop;
  end loop;
end $$;
insert into chk
select code, 'campos: ' || concat_ws(',',
  case when legal_name is not null then 'legal_name' end, case when tax_id is not null then 'nif' end,
  case when email is not null then 'email' end, case when phone is not null then 'telefone' end,
  case when address is not null then 'morada' end, case when city is not null then 'cidade' end,
  case when notes is not null then 'notas' end, case when conditions is not null then 'condicoes' end,
  'estado=' || status::text, case when archived_at is not null then 'arquivado' end,
  'criado=' || to_char(created_at, 'YYYY-MM-DD')), null
from public.clients where code in ('CLI0168','CLI0326');
select * from chk order by cliente, tabela;
