begin;

alter table public.manufacturers add column if not exists external_id text;
alter table public.manufacturers add column if not exists country text;
alter table public.manufacturers add column if not exists website text;
alter table public.manufacturers add column if not exists representation_type text;
alter table public.manufacturers add column if not exists territory text;
alter table public.manufacturers add column if not exists currency text;
alter table public.manufacturers add column if not exists commercial_language text;
alter table public.manufacturers add column if not exists internal_owner text;
alter table public.manufacturers add column if not exists general_email text;
alter table public.manufacturers add column if not exists general_phone text;
alter table public.manufacturers add column if not exists notes text;
alter table public.manufacturers add column if not exists deleted_at timestamptz;
create unique index if not exists manufacturers_external_id_unique on public.manufacturers(external_id) where external_id is not null;

create table if not exists public.manufacturer_contacts (
  id uuid primary key default gen_random_uuid(), external_id text unique, manufacturer_id uuid not null references public.manufacturers(id) on delete cascade,
  first_name text, last_name text, job_title text, area text, email text, phone text, whatsapp text, language text,
  is_primary boolean not null default false, active boolean not null default true, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);

create table if not exists public.manufacturer_commercial_terms (
  id uuid primary key default gen_random_uuid(), external_id text unique, manufacturer_id uuid not null references public.manufacturers(id) on delete cascade,
  market text, currency text, price_list text, base_discount numeric(8,4), additional_discount numeric(8,4),
  payment_term text, payment_method text, minimum_order numeric(14,2), minimum_unit text,
  free_shipping_from numeric(14,2), shipping_rule text, incoterm text, average_delivery text,
  valid_from date, valid_until date, exclusivity text, client_notes text, visibility text not null default 'client' check(visibility in ('client','internal')),
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);

create table if not exists public.manufacturer_family_discounts (
  id uuid primary key default gen_random_uuid(), external_id text unique, manufacturer_id uuid not null references public.manufacturers(id) on delete cascade,
  family text, subfamily text, family_code text, discount numeric(8,4), extra_discount numeric(8,4), minimum_quantity numeric(14,3),
  special_price numeric(14,2), valid_from date, valid_until date, cumulative boolean, campaign text, notes text,
  visibility text not null default 'client' check(visibility in ('client','internal')), active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);

create table if not exists public.manufacturer_logistics (
  id uuid primary key default gen_random_uuid(), external_id text unique, manufacturer_id uuid not null references public.manufacturers(id) on delete cascade,
  shipping_origin text, destination_market text, usual_carrier text, minimum_order numeric(14,2), free_shipping_from numeric(14,2),
  fixed_shipping_cost numeric(14,2), shipping_rule text, preparation_time text, transport_time text, estimated_total_time text,
  partial_shipping boolean, dropshipping boolean, notes text, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);

create table if not exists public.manufacturer_commissions (
  id uuid primary key default gen_random_uuid(), external_id text unique, manufacturer_id uuid not null references public.manufacturers(id) on delete cascade,
  territory text, base_commission numeric(8,4), bonus_tiers text, calculation_base text, assessment_frequency text,
  payment_frequency text, payment_term text, currency text, retentions_adjustments text, internal_notes text,
  valid_from date, valid_until date, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);

create table if not exists public.manufacturer_client_communications (
  id uuid primary key default gen_random_uuid(), manufacturer_id uuid not null references public.manufacturers(id), client_id uuid not null references public.clients(id),
  email_id uuid references public.emails(id) on delete set null, sender_id uuid not null references public.profiles(id), recipient text not null,
  cc text, subject text not null, selected_conditions jsonb not null default '{}'::jsonb, status text not null default 'draft', sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.manufacturer_audit_logs (
  id bigint generated always as identity primary key, actor_id uuid references public.profiles(id), manufacturer_id uuid references public.manufacturers(id) on delete set null,
  action text not null, entity_type text not null, entity_id text, before_data jsonb, after_data jsonb, created_at timestamptz not null default now()
);

do $$
declare r record; target_id uuid;
begin
  for r in select * from (values
    ('FAB-001','JSP Safety','UK / Alemanha','https://www.jspsafety.com/','Agente / Representante',null,'EUR','Inglês / Espanhol','Tina Sciullo','espana@jsp.co.uk','(+44) (0) 1993 824000'),
    ('FAB-002','COFRA','Itália','https://www.cofra.it','Agente / Representante',null,'EUR','Espanhol','Tina Sciullo','s.degennaro@cofra.it','(+39) 0 883 341 411'),
    ('FAB-003','ACHA Herramientas','Espanha','https://acha.com','Agente / Representante',null,'EUR','Espanhol','Tina Sciullo','info@acha.com','(+34) 943 120 424'),
    ('FAB-004','VESIN','Espanha','https://vesin.com','Agente / Representante',null,'EUR','Espanhol','Tina Sciullo',null,null),
    ('FAB-005','JOMIBA','Espanha','https://www.jomiba.com/','Agente / Representante',null,'EUR','Espanhol','Tina Sciullo',null,null),
    ('FAB-006','Blue-Master','Espanha','https://www.bluemaster.es/pt/','Agente / Representante',null,'EUR','Espanhol','Tina Sciullo',null,null),
    ('FAB-007','Dogher Tools','Espanha','https://www.dogher.com/pt/','Agente / Representante',null,'EUR','Espanhol','Tina Sciullo',null,null),
    ('FAB-008','RÖNTGEN','Espanha','https://roentgen-saw.com/es','Agente / Representante',null,'EUR','Espanhol','Tina Sciullo',null,null),
    ('FAB-009','BUFF Safety','Espanha','https://www.buff.com/safety','Agente / Representante',null,'EUR','Espanhol','Tina Sciullo',null,null),
    ('FAB-010','Klever Innovations','Espanha','https://kleverinnovations.net/','Agente / Representante',null,'EUR','Espanhol','Tina Sciullo',null,null),
    ('FAB-011','Aghasa Turis','Espanha','https://www.aghasaturis.com/pt/','Agente / Representante',null,'EUR','Espanhol','Tina Sciullo',null,null),
    ('FAB-012','Turbo','Espanha',null,'Agente / Representante',null,'EUR','Espanhol','Tina Sciullo',null,null),
    ('FAB-013','Unior','Espanha','https://uniortools.com/es/','Agente / Representante',null,'EUR','Espanhol','Tina Sciullo',null,null)
  ) as x(external_id,name,country,website,representation_type,territory,currency,commercial_language,internal_owner,general_email,general_phone)
  loop
    select id into target_id from public.manufacturers where external_id=r.external_id or lower(name)=lower(r.name)
      or (r.external_id='FAB-001' and lower(name)='jsp safety') or (r.external_id='FAB-003' and lower(name)='acha')
      or (r.external_id='FAB-006' and lower(replace(name,'-',' '))='blue master') or (r.external_id='FAB-008' and lower(name)='rontgen') limit 1;
    if target_id is null then
      insert into public.manufacturers(external_id,name,country,website,active,representation_type,territory,currency,commercial_language,internal_owner,general_email,general_phone)
      values(r.external_id,r.name,r.country,r.website,true,r.representation_type,r.territory,r.currency,r.commercial_language,r.internal_owner,r.general_email,r.general_phone)
      returning id into target_id;
    else
      update public.manufacturers set external_id=r.external_id,name=r.name,country=r.country,website=r.website,active=true,
        representation_type=r.representation_type,territory=r.territory,currency=r.currency,commercial_language=r.commercial_language,
        internal_owner=r.internal_owner,general_email=r.general_email,general_phone=r.general_phone,updated_at=now() where id=target_id;
    end if;
  end loop;
end $$;

insert into public.manufacturer_logistics(external_id,manufacturer_id,shipping_origin,destination_market,minimum_order,free_shipping_from,shipping_rule,preparation_time,transport_time,estimated_total_time,partial_shipping,dropshipping)
select 'LOG-'||m.external_id,m.id,x.origin,'Portugal',x.minimum_order,x.free_shipping,x.rule,x.preparation,x.transport,x.total,true,false
from (values
  ('FAB-001','Alemanha',300::numeric,500::numeric,'75€ encomendas inferiores a 500€','24h','48h','72h'),
  ('FAB-002','Itália',200::numeric,500::numeric,'20€ encomendas inferiores a 500€','24h','96h','120h'),
  ('FAB-003','Espanha',35::numeric,300::numeric,'6 € se o peso for inferior a 10 kg / 10 € se for superior a 10 kg','12h','12h','24h'),
  ('FAB-004','Espanha',null,null,null,null,null,null),('FAB-005','Espanha',null,null,null,null,null,null),
  ('FAB-006','Espanha',null,null,null,null,null,null),('FAB-007','Espanha',null,null,null,null,null,null),
  ('FAB-008','Espanha',null,null,null,null,null,null),('FAB-009','Espanha',null,null,null,null,null,null),
  ('FAB-010','Espanha',null,null,null,null,null,null),('FAB-011','Espanha',null,null,null,null,null,null),
  ('FAB-012','Espanha',null,null,null,null,null,null),('FAB-013','Espanha',null,null,null,null,null,null)
) x(external_id,origin,minimum_order,free_shipping,rule,preparation,transport,total)
join public.manufacturers m on m.external_id=x.external_id
on conflict(external_id) do update set shipping_origin=excluded.shipping_origin,destination_market=excluded.destination_market,
minimum_order=excluded.minimum_order,free_shipping_from=excluded.free_shipping_from,shipping_rule=excluded.shipping_rule,
preparation_time=excluded.preparation_time,transport_time=excluded.transport_time,estimated_total_time=excluded.estimated_total_time,updated_at=now();

alter table public.manufacturer_contacts enable row level security;
alter table public.manufacturer_commercial_terms enable row level security;
alter table public.manufacturer_family_discounts enable row level security;
alter table public.manufacturer_logistics enable row level security;
alter table public.manufacturer_commissions enable row level security;
alter table public.manufacturer_client_communications enable row level security;
alter table public.manufacturer_audit_logs enable row level security;

do $$ declare t text; begin
  foreach t in array array['manufacturer_contacts','manufacturer_commercial_terms','manufacturer_family_discounts','manufacturer_logistics'] loop
    execute format('drop policy if exists %I on public.%I','manufacturer authenticated read',t);
    execute format('create policy %I on public.%I for select using (auth.uid() is not null)','manufacturer authenticated read',t);
    execute format('drop policy if exists %I on public.%I','manufacturer admin manage',t);
    execute format('create policy %I on public.%I for all using (public.current_role()=''admin'') with check (public.current_role()=''admin'')','manufacturer admin manage',t);
  end loop;
end $$;

drop policy if exists "manufacturer commissions admin" on public.manufacturer_commissions;
create policy "manufacturer commissions admin" on public.manufacturer_commissions for all using(public.current_role()='admin') with check(public.current_role()='admin');
drop policy if exists "manufacturer communications read" on public.manufacturer_client_communications;
create policy "manufacturer communications read" on public.manufacturer_client_communications for select using(auth.uid() is not null);
drop policy if exists "manufacturer communications insert" on public.manufacturer_client_communications;
create policy "manufacturer communications insert" on public.manufacturer_client_communications for insert with check(sender_id=auth.uid());
drop policy if exists "manufacturer audit admin read" on public.manufacturer_audit_logs;
create policy "manufacturer audit admin read" on public.manufacturer_audit_logs for select using(public.current_role()='admin');

create or replace function public.audit_manufacturer_change() returns trigger language plpgsql security definer set search_path=public as $$
declare mid uuid; eid text;
begin
  mid=coalesce(new.manufacturer_id,old.manufacturer_id); eid=coalesce(new.id,old.id)::text;
  insert into public.manufacturer_audit_logs(actor_id,manufacturer_id,action,entity_type,entity_id,before_data,after_data)
  values(auth.uid(),mid,tg_op,tg_table_name,eid,case when tg_op='INSERT' then null else to_jsonb(old) end,case when tg_op='DELETE' then null else to_jsonb(new) end);
  return coalesce(new,old);
end $$;

do $$ declare t text; begin
  foreach t in array array['manufacturer_contacts','manufacturer_commercial_terms','manufacturer_family_discounts','manufacturer_logistics','manufacturer_commissions'] loop
    execute format('drop trigger if exists audit_change on public.%I',t);
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function public.audit_manufacturer_change()',t);
  end loop;
end $$;

create or replace function public.audit_manufacturer_self_change() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.manufacturer_audit_logs(actor_id,manufacturer_id,action,entity_type,entity_id,before_data,after_data)
  values(auth.uid(),coalesce(new.id,old.id),tg_op,'manufacturers',coalesce(new.id,old.id)::text,
    case when tg_op='INSERT' then null else to_jsonb(old) end,case when tg_op='DELETE' then null else to_jsonb(new) end);
  return coalesce(new,old);
end $$;
drop trigger if exists audit_manufacturer_self on public.manufacturers;
create trigger audit_manufacturer_self after insert or update or delete on public.manufacturers for each row execute function public.audit_manufacturer_self_change();

commit;
