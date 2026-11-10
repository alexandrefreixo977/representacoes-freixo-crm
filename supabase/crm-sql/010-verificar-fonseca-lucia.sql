-- Só códigos, sim/não e totais.
select jsonb_build_object('codigo', c.code, 'fonseca', c.trade_name ilike '%fonseca%' or coalesce(c.legal_name,'') ilike '%fonseca%',
  'domingues', c.trade_name ilike '%domingues%' or coalesce(c.legal_name,'') ilike '%domingues%',
  'casa', c.trade_name ilike '%casa%', 'tem_nif', c.tax_id is not null, 'arquivado', c.archived_at is not null,
  'contactos', (select count(*) from client_contacts where client_id = c.id),
  'fabricantes', (select count(*) from client_manufacturers where client_id = c.id),
  'dono_lucia', exists(select 1 from auth.users u where u.id = c.owner_id and lower(u.email) = 'lcosta@representacoesfreixo.com'),
  'criado', to_char(c.created_at, 'YYYY-MM-DD')) as linha
  from public.clients c
 where c.trade_name ilike '%fonseca%' or c.trade_name ilike '%domingues%' or coalesce(c.legal_name,'') ilike '%domingues%' or coalesce(c.legal_name,'') ilike '%fonseca%'
union all
select jsonb_build_object('lucia_perfil', p.role::text, 'ativa', p.active,
  'clientes_dela', (select count(*) from clients where owner_id = p.id),
  'perm', (select jsonb_object_agg(permission, allowed) from role_permissions where role = 'commercial'))
  from public.profiles p join auth.users u on u.id = p.id where lower(u.email) = 'lcosta@representacoesfreixo.com'
union all
select jsonb_build_object('policies_clients', (select jsonb_agg(policyname || ':' || cmd || ':' || permissive) from pg_policies where tablename = 'clients'));
