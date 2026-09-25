begin;
alter table public.profiles add column if not exists email_signature_html text;
comment on column public.profiles.email_signature_html is 'Assinatura HTML segura aplicada automaticamente aos emails enviados pelo CRM';
commit;
