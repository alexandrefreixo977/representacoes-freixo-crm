-- 12/11/2026 — Só leitura: que rasto existe dos últimos 30 dias para reconstruir a atividade (só totais, sem dados pessoais).
with d as (select now() - interval '30 days' as desde)
select jsonb_build_object(
  'auth_eventos', (select jsonb_object_agg(a, n) from (select payload->>'action' a, count(*) n from auth.audit_log_entries, d where created_at >= d.desde group by 1) x),
  'auth_mais_antigo', (select min(created_at)::date from auth.audit_log_entries),
  'auth_last_sign_in_30d', (select count(*) from auth.users, d where last_sign_in_at >= d.desde),
  'auth_sessoes', (select count(*) from auth.sessions, d where created_at >= d.desde),
  'auth_refresh_tokens', (select count(*) from auth.refresh_tokens, d where created_at >= d.desde),
  'atividades_criadas', (select count(*) from public.activities, d where created_at >= d.desde),
  'atividades_atualizadas', (select count(*) from public.activities, d where updated_at >= d.desde),
  'atividades_concluidas', (select count(*) from public.activities, d where completed_at >= d.desde),
  'oportunidade_eventos', (select count(*) from public.opportunity_events, d where created_at >= d.desde),
  'documentos_eventos', (select count(*) from public.catalog_document_events, d where created_at >= d.desde),
  'emails', (select count(*) from public.emails, d where created_at >= d.desde),
  'audit_logs', (select count(*) from public.audit_logs, d where created_at >= d.desde),
  'fabricantes_audit', (select count(*) from public.manufacturer_audit_logs, d where created_at >= d.desde),
  'clientes_criados', (select count(*) from public.clients, d where created_at >= d.desde),
  'clientes_atualizados', (select count(*) from public.clients, d where updated_at >= d.desde),
  'contactos_criados', (select count(*) from public.client_contacts, d where created_at >= d.desde),
  'colunas', (select jsonb_object_agg(table_name, cols) from (select table_name, jsonb_agg(column_name order by column_name) cols from information_schema.columns
     where table_schema = 'public' and table_name in ('activities','clients','client_contacts','opportunities','emails','tasks','visits','catalog_orders') and column_name in ('created_at','updated_at','created_by','updated_by','actor_id','owner_id','completed_by','seller_id','sender_id','assigned_to','completed_at') group by 1) c)
) as resultado;
