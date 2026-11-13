-- Confirma que a cópia de segurança da VESIN foi apagada (só totais).
select 'tabelas arquivo.vesin_*' as tipo, count(*) as total from information_schema.tables where table_schema = 'arquivo' and table_name like 'vesin%';
