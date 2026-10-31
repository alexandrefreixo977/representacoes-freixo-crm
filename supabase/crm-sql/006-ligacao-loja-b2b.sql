-- Ligação à loja B2B: cada proposta da loja dá no máximo uma oportunidade no CRM.
alter table public.opportunities add column if not exists b2b_quote_id uuid;
create unique index if not exists opportunities_b2b_quote on public.opportunities(b2b_quote_id) where b2b_quote_id is not null;
select 'opportunities.b2b_quote_id' as coluna, count(*) as existe from information_schema.columns where table_schema='public' and table_name='opportunities' and column_name='b2b_quote_id';
