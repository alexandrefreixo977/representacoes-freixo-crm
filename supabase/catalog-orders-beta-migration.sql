begin;

create table if not exists public.crm_feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_feature_access (
  feature_key text not null references public.crm_feature_flags(key) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  granted_at timestamptz not null default now(),
  primary key(feature_key,user_id)
);

insert into public.crm_feature_flags(key,enabled,description)
values('catalog_orders_beta',false,'Catálogo de produtos e encomendas B2B — beta privado')
on conflict(key) do nothing;

insert into public.crm_feature_access(feature_key,user_id,enabled)
select 'catalog_orders_beta',p.id,true from public.profiles p join auth.users u on u.id=p.id where lower(u.email)='afreixo@representacoesfreixo.com'
on conflict(feature_key,user_id) do update set enabled=true;

update public.crm_feature_flags set enabled=true,updated_at=now() where key='catalog_orders_beta';

create or replace function public.has_catalog_orders_beta_access()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.crm_feature_flags f
    join public.profiles p on p.id=auth.uid()
    where f.key='catalog_orders_beta' and f.enabled=true and p.active=true
  )
$$;

create table if not exists public.catalog_product_families (
  id uuid primary key default gen_random_uuid(), manufacturer_id uuid not null references public.manufacturers(id),
  name text not null, subfamily text, active boolean not null default true, is_test boolean not null default false,
  created_at timestamptz not null default now(), unique(manufacturer_id,name,subfamily)
);
create table if not exists public.catalog_products (
  id uuid primary key default gen_random_uuid(), manufacturer_id uuid not null references public.manufacturers(id), family_id uuid references public.catalog_product_families(id),
  reference text not null, ean text, designation text not null, short_description text, technical_description text,
  main_image_url text, additional_images jsonb not null default '[]'::jsonb, sales_unit text not null default 'un', minimum_pack numeric(14,3) not null default 1,
  moq numeric(14,3) not null default 1, status text not null default 'active' check(status in ('active','discontinued','on_request')),
  manufacturer_product_url text, technical_sheet_url text, internal_notes text, active boolean not null default true, is_test boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(manufacturer_id,reference)
);
create table if not exists public.catalog_product_variants (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.catalog_products(id) on delete cascade,
  reference text, ean text, designation_suffix text, attributes jsonb not null default '{}'::jsonb, sales_unit text, minimum_pack numeric(14,3), moq numeric(14,3), active boolean not null default true,
  created_at timestamptz not null default now(), unique(product_id,reference)
);
create table if not exists public.catalog_price_lists (
  id uuid primary key default gen_random_uuid(), manufacturer_id uuid not null references public.manufacturers(id), name text not null, version text not null,
  currency text not null default 'EUR', valid_from date not null, valid_until date, status text not null default 'active', is_test boolean not null default false,
  created_at timestamptz not null default now(), unique(manufacturer_id,name,version)
);
create table if not exists public.catalog_price_list_items (
  id uuid primary key default gen_random_uuid(), price_list_id uuid not null references public.catalog_price_lists(id) on delete cascade,
  product_id uuid not null references public.catalog_products(id), variant_id uuid references public.catalog_product_variants(id), list_price numeric(14,4) not null,
  currency text not null default 'EUR', valid_from date not null, valid_until date, created_at timestamptz not null default now(),
  unique(price_list_id,product_id,variant_id)
);
create table if not exists public.catalog_commercial_rules (
  id uuid primary key default gen_random_uuid(), manufacturer_id uuid not null references public.manufacturers(id), client_id uuid references public.clients(id),
  family_id uuid references public.catalog_product_families(id), product_id uuid references public.catalog_products(id), variant_id uuid references public.catalog_product_variants(id),
  discount_percentages numeric[] not null default '{}', special_price numeric(14,4), priority smallint not null default 100,
  valid_from date, valid_until date, active boolean not null default true, is_test boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.catalog_orders (
  id uuid primary key default gen_random_uuid(), order_number text not null unique, client_id uuid not null references public.clients(id), contact_id uuid references public.client_contacts(id),
  manufacturer_id uuid not null references public.manufacturers(id), order_date date not null default current_date,
  status text not null default 'draft' check(status in ('draft','confirmed','sent_to_manufacturer','manufacturer_confirmed','shipping','completed','cancelled')),
  seller_id uuid not null references public.profiles(id), currency text not null default 'EUR', notes text, subtotal numeric(14,2) not null default 0,
  shipping numeric(14,2) not null default 0, tax numeric(14,2) not null default 0, total numeric(14,2) not null default 0,
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.catalog_order_lines (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.catalog_orders(id) on delete cascade,
  product_id uuid not null references public.catalog_products(id), variant_id uuid references public.catalog_product_variants(id),
  reference_snapshot text not null, designation_snapshot text not null, quantity numeric(14,3) not null,
  list_price_snapshot numeric(14,4) not null, automatic_discounts numeric[] not null default '{}', applied_discounts numeric[] not null default '{}',
  net_unit_price numeric(14,4) not null, line_total numeric(14,2) not null, notes text,
  discount_manually_changed boolean not null default false, discount_changed_by uuid references public.profiles(id), discount_changed_at timestamptz,
  created_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['crm_feature_flags','crm_feature_access','catalog_product_families','catalog_products','catalog_product_variants','catalog_price_lists','catalog_price_list_items','catalog_commercial_rules','catalog_orders','catalog_order_lines'] loop
    execute format('alter table public.%I enable row level security',t);
  end loop;
end $$;

create policy "beta flags authorized" on public.crm_feature_flags for select using(public.has_catalog_orders_beta_access());
create policy "beta access self" on public.crm_feature_access for select using(user_id=auth.uid() and public.has_catalog_orders_beta_access());
do $$ declare t text; begin
  foreach t in array array['catalog_product_families','catalog_products','catalog_product_variants','catalog_price_lists','catalog_price_list_items','catalog_commercial_rules','catalog_orders','catalog_order_lines'] loop
    execute format('create policy %I on public.%I for all using (public.has_catalog_orders_beta_access()) with check (public.has_catalog_orders_beta_access())','catalog beta authorized',t);
  end loop;
end $$;

do $$ declare mid uuid; fid uuid; plist uuid; p record; begin
  select id into mid from public.manufacturers where lower(name) like 'acha%' and deleted_at is null limit 1;
  if mid is null then return; end if;
  insert into public.catalog_product_families(manufacturer_id,name,subfamily,is_test) values(mid,'Metrologia','Medição eletrónica',true)
    on conflict(manufacturer_id,name,subfamily) do update set active=true returning id into fid;
  insert into public.catalog_products(manufacturer_id,family_id,reference,designation,short_description,technical_description,main_image_url,sales_unit,minimum_pack,moq,status,manufacturer_product_url,technical_sheet_url,is_test) values
    (mid,fid,'ACHA-TEST-001','Medidor de espessuras e revestimentos','Instrumento portátil para controlo de espessuras.','Produto de teste para validação do catálogo beta.','/email-signature-logo.png','un',1,1,'active','https://www.acha.com/es/productos/medicion-electronica',null,true),
    (mid,fid,'ACHA-TEST-002','Termómetro digital laser 400 ºC','Medição de temperatura à distância.','Produto de teste para validação do catálogo beta.','/email-signature-logo.png','un',1,1,'active','https://www.acha.com/es/productos/medicion-electronica',null,true),
    (mid,fid,'ACHA-TEST-003','Nível laser verde 3D','Nível laser profissional multibateria.','Produto de teste para validação do catálogo beta.',null,'un',1,1,'active','https://www.acha.com/es/',null,true),
    (mid,fid,'ACHA-TEST-004','Endoscópio para videoinspeção 5 m','Câmara portátil para inspeção visual.','Produto de teste para validação do catálogo beta.',null,'un',1,1,'on_request','https://www.acha.com/es/',null,true),
    (mid,fid,'ACHA-TEST-005','Projetor LED profissional antichoque','Iluminação portátil para utilização industrial.','Produto de teste para validação do catálogo beta.',null,'un',1,1,'active','https://www.acha.com/es/',null,true)
  on conflict(manufacturer_id,reference) do update set designation=excluded.designation,active=true,is_test=true;
  insert into public.catalog_price_lists(manufacturer_id,name,version,currency,valid_from,status,is_test)
    values(mid,'Tabela beta ACHA','2026-T1','EUR','2026-01-01','active',true)
    on conflict(manufacturer_id,name,version) do update set status='active' returning id into plist;
  for p in select id,reference from public.catalog_products where manufacturer_id=mid and is_test=true loop
    insert into public.catalog_price_list_items(price_list_id,product_id,list_price,currency,valid_from)
    values(plist,p.id,case p.reference when 'ACHA-TEST-001' then 100 when 'ACHA-TEST-002' then 125 when 'ACHA-TEST-003' then 295 when 'ACHA-TEST-004' then 180 else 89 end,'EUR','2026-01-01')
    on conflict(price_list_id,product_id,variant_id) do update set list_price=excluded.list_price;
  end loop;
  if not exists(select 1 from public.catalog_commercial_rules where manufacturer_id=mid and client_id is null and is_test=true) then
    insert into public.catalog_commercial_rules(manufacturer_id,discount_percentages,priority,active,is_test) values(mid,array[40::numeric],500,true,true);
  end if;
end $$;

commit;

