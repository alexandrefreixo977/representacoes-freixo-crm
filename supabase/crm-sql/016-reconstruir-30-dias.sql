-- 12/11/2026 — Reconstrói a atividade dos 30 dias anteriores ao início do registo (14), a partir do rasto que já existia:
-- * entradas/saídas: renovações da sessão de login (auth.refresh_tokens, ~1 por hora com o CRM aberto e visível);
--   a sessão reconstruída começa na 1.ª renovação e termina, aproximadamente, na última (intervalos > 75 min = nova entrada);
-- * o que fez: atividades (visitas, tarefas, agenda) criadas e concluídas, clientes, oportunidades, tarefas e
--   documentos comerciais criados, eventos de oportunidades e de documentos, emails enviados, alterações de fabricantes.
-- Não é possível recuperar páginas abertas, pesquisas nem quem editou fichas de cliente (não havia registo disso).
-- Pode ser corrido várias vezes: apaga e volta a criar apenas os registos reconstruídos.

alter table public.crm_sessions drop constraint if exists crm_sessions_end_reason_check;
alter table public.crm_sessions add constraint crm_sessions_end_reason_check check (end_reason in ('logout', 'inatividade', 'reconstruida'));

create temporary table _janela as
select now() - interval '30 days' as desde,
       coalesce((select min(created_at) from public.crm_activity_log where coalesce(detail ->> 'reconstruido', '') <> 'true'), now()) as ate;

delete from public.crm_activity_log where detail ->> 'reconstruido' = 'true';
delete from public.crm_sessions where end_reason = 'reconstruida';

-- Entradas e saídas
with t as (
  select rt.user_id::uuid as user_id, rt.created_at
    from auth.refresh_tokens rt, _janela j
   where rt.created_at >= j.desde and rt.created_at < j.ate
     and exists (select 1 from public.profiles p where p.id::text = rt.user_id)
), t2 as (
  select user_id, created_at,
         case when lag(created_at) over w is null or created_at - lag(created_at) over w > interval '75 minutes' then 1 else 0 end as novo
    from t window w as (partition by user_id order by created_at)
), g as (
  select user_id, created_at, sum(novo) over (partition by user_id order by created_at) as grupo from t2
), s as (
  select user_id, min(created_at) as inicio, max(created_at) as fim, count(*) as n from g group by user_id, grupo
), ins as (
  insert into public.crm_sessions(user_id, started_at, last_seen_at, ended_at, end_reason, device)
  select user_id, inicio, greatest(fim, inicio + interval '5 minutes'), greatest(fim, inicio + interval '5 minutes'), 'reconstruida', null from s
  returning id, user_id, started_at
)
insert into public.crm_activity_log(user_id, session_id, kind, label, detail, created_at)
select user_id, id, 'login', 'Entrou no CRM', '{"reconstruido": true}'::jsonb, started_at from ins;

-- O que fez
insert into public.crm_activity_log(user_id, kind, entity_table, entity_id, label, detail, created_at)
select x.user_id, x.kind, x.entity_table, x.entity_id, left(x.label, 300), x.detail || '{"reconstruido": true}'::jsonb, x.quando
  from (
    select a.actor_id as user_id, 'create' as kind, 'activities' as entity_table, a.id::text as entity_id, coalesce(a.title, a.summary) as label,
           jsonb_strip_nulls(jsonb_build_object('tipo', coalesce(a.interaction_type, a.kind::text), 'cliente', c.trade_name, 'data', coalesce(a.start_at::text, a.due_date::text))) as detail, a.created_at as quando
      from public.activities a left join public.clients c on c.id = a.client_id
    union all
    select a.completed_by, 'update', 'activities', a.id::text, coalesce(a.title, a.summary),
           jsonb_strip_nulls(jsonb_build_object('tipo', coalesce(a.interaction_type, a.kind::text), 'cliente', c.trade_name, 'campos', jsonb_build_array('status'), 'estado', 'completed')), a.completed_at
      from public.activities a left join public.clients c on c.id = a.client_id where a.completed_at is not null and a.completed_by is not null
    union all
    select c.created_by, 'create', 'clients', c.id::text, c.trade_name, '{}'::jsonb, c.created_at from public.clients c
    union all
    select o.created_by, 'create', 'opportunities', o.id::text, o.title, jsonb_strip_nulls(jsonb_build_object('cliente', c.trade_name)), o.created_at
      from public.opportunities o left join public.clients c on c.id = o.client_id
    union all
    select e.actor_id, 'action', 'opportunities', e.opportunity_id::text, 'Oportunidade “' || coalesce(o.title, '') || '”: ' || e.title, jsonb_strip_nulls(jsonb_build_object('evento', e.event_type)), e.created_at
      from public.opportunity_events e left join public.opportunities o on o.id = e.opportunity_id
    union all
    select t.created_by, 'create', 'tasks', t.id::text, t.title, '{}'::jsonb, t.created_at from public.tasks t
    union all
    select d.created_by, 'create', 'catalog_orders', d.id::text, d.order_number::text, jsonb_build_object('tipo', d.document_type), d.created_at from public.catalog_orders d
    union all
    select ev.actor_id, 'create', 'catalog_document_events', ev.id::text, ev.event_type, jsonb_build_object('tipo', ev.event_type), ev.created_at from public.catalog_document_events ev
    union all
    select m.sender_id, 'create', 'emails', m.id::text, m.subject, jsonb_strip_nulls(jsonb_build_object('cliente', c.trade_name)), coalesce(m.sent_at, m.created_at)
      from public.emails m left join public.clients c on c.id = m.client_id
    union all
    select f.actor_id, 'action', 'manufacturers', f.manufacturer_id::text, 'Fabricante “' || coalesce(mf.name, '') || '”: ' || f.action || ' ' || replace(f.entity_type, '_', ' '), '{}'::jsonb, f.created_at
      from public.manufacturer_audit_logs f left join public.manufacturers mf on mf.id = f.manufacturer_id
  ) x, _janela j
 where x.user_id is not null and x.quando >= j.desde and x.quando < j.ate
   and exists (select 1 from public.profiles p where p.id = x.user_id);

-- Liga cada ação reconstruída à sessão reconstruída em que aconteceu (quando existe).
update public.crm_activity_log l set session_id = s.id
  from public.crm_sessions s
 where l.detail ->> 'reconstruido' = 'true' and l.session_id is null and s.end_reason = 'reconstruida'
   and s.user_id = l.user_id and l.created_at between s.started_at - interval '5 minutes' and s.ended_at + interval '60 minutes';

select jsonb_build_object(
  'sessoes_reconstruidas', (select count(*) from public.crm_sessions where end_reason = 'reconstruida'),
  'acoes_reconstruidas', (select jsonb_object_agg(k, n) from (select coalesce(entity_table, kind) k, count(*) n from public.crm_activity_log where detail ->> 'reconstruido' = 'true' group by 1) z),
  'utilizadores', (select count(distinct user_id) from public.crm_sessions where end_reason = 'reconstruida'),
  'desde', (select min(started_at)::date from public.crm_sessions where end_reason = 'reconstruida')) as resultado;
