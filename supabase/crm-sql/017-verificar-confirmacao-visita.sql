-- 19/11/2026 — Porque não saiu o email de confirmação de visita? Só totais e sim/não, sem dados pessoais.
with v as (
  select a.*, c.email as client_email,
         (select count(*) from public.client_contacts cc where cc.client_id = a.client_id and coalesce(cc.active, true) and coalesce(cc.email,'') like '%@%') as contactos_com_email,
         (select count(*) from public.client_contacts cc where cc.client_id = a.client_id and coalesce(cc.active, true) and cc.is_primary and coalesce(cc.email,'') like '%@%') as principais_com_email,
         (select coalesce(ct.email,'') like '%@%' from public.client_contacts ct where ct.id = a.contact_id) as contacto_visita_com_email
    from public.activities a join public.clients c on c.id = a.client_id
   where a.kind = 'visit' and a.created_at > now() - interval '8 hours'
)
select json_build_object(
  'visitas_criadas_8h', (select count(*) from v),
  'detalhe', (select json_agg(json_build_object(
      'criada', to_char(created_at at time zone 'Europe/Lisbon','HH24:MI'), 'origem', source_module, 'estado', status,
      'tem_hora', start_at is not null and coalesce(has_time,true), 'futura', start_at > now(),
      'cliente_tem_email', coalesce(client_email,'') like '%@%', 'contactos_com_email', contactos_com_email,
      'principais_com_email', principais_com_email, 'contacto_visita_com_email', contacto_visita_com_email) order by created_at) from v),
  'emails_confirmacao_8h', (select count(*) from public.emails where (subject like 'Confirmação de visita%' or subject like 'Visita reagendada%') and created_at > now() - interval '8 hours'),
  'emails_enviados_crm_7d', (select count(*) from public.emails where status = 'sent' and created_at > now() - interval '7 days'),
  'assinaturas', (select json_agg(json_build_object('ativo', p.active, 'nome', coalesce(p.signature_name,p.full_name,'') <> '', 'email_assinatura', coalesce(p.signature_email,'') <> '', 'assinatura_ligada', p.signature_enabled)) from public.profiles p where p.active)
) as resultado;
