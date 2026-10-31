begin;
alter table public.profiles
  add column if not exists signature_postal_code text,
  add column if not exists signature_locality text,
  add column if not exists signature_country text;

update public.profiles
set signature_country='Portugal'
where signature_country is null;
commit;
