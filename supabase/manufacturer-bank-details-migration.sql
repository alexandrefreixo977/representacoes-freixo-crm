begin;

alter table public.manufacturer_commercial_terms add column if not exists bank_name text;
alter table public.manufacturer_commercial_terms add column if not exists account_holder text;
alter table public.manufacturer_commercial_terms add column if not exists iban text;
alter table public.manufacturer_commercial_terms add column if not exists swift_bic text;
alter table public.manufacturer_commercial_terms add column if not exists bank_instructions text;

commit;

