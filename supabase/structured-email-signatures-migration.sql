begin;
alter table public.profiles
  add column if not exists signature_name text,
  add column if not exists signature_title text,
  add column if not exists signature_email text,
  add column if not exists signature_phone text,
  add column if not exists signature_address text,
  add column if not exists signature_qr_path text,
  add column if not exists signature_enabled boolean not null default true;

update public.profiles p set
  signature_name=coalesce(p.signature_name,p.full_name),
  signature_email=coalesce(p.signature_email,u.email),
  signature_title=coalesce(p.signature_title,case when p.role='admin' then 'Administrador' else 'Comercial' end)
from auth.users u
where u.id=p.id and (p.signature_name is null or p.signature_email is null or p.signature_title is null);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('email-signatures','email-signatures',true,2097152,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=true,file_size_limit=2097152,allowed_mime_types=array['image/png','image/jpeg','image/webp'];

drop policy if exists "signature qr public read" on storage.objects;
create policy "signature qr public read" on storage.objects for select using(bucket_id='email-signatures');
drop policy if exists "signature qr owner insert" on storage.objects;
create policy "signature qr owner insert" on storage.objects for insert to authenticated with check(bucket_id='email-signatures' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "signature qr owner update" on storage.objects;
create policy "signature qr owner update" on storage.objects for update to authenticated using(bucket_id='email-signatures' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='email-signatures' and (storage.foldername(name))[1]=auth.uid()::text);
commit;
