-- Unificar clientes duplicados (10/11/2026).
-- crm_merge_clients(fica, sai): passa tudo o que está ligado ao cliente que sai (contactos, fabricantes, visitas,
-- tarefas, oportunidades, histórico...) para o cliente que fica, completa os campos vazios do que fica,
-- guarda uma cópia do registo que sai em clients_merged_backup e apaga-o.
create table if not exists public.clients_merged_backup (
  id bigint generated always as identity primary key,
  kept_id uuid not null,
  removed_row jsonb not null,
  merged_at timestamptz not null default now()
);
alter table public.clients_merged_backup enable row level security;

create or replace function public.crm_merge_clients(p_keep text, p_drop text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k public.clients; d public.clients; r record; x record; moved int := 0; merged int := 0;
begin
  select * into k from clients where code = p_keep;
  select * into d from clients where code = p_drop;
  if k.id is null or d.id is null or k.id = d.id then raise exception 'Códigos inválidos: % / %', p_keep, p_drop; end if;

  insert into clients_merged_backup (kept_id, removed_row) values (k.id, to_jsonb(d));

  -- fabricantes: se ambos tinham o mesmo fabricante, junta os campos numa linha
  for x in select * from client_manufacturers where client_id = d.id loop
    if exists (select 1 from client_manufacturers where client_id = k.id and manufacturer_id = x.manufacturer_id) then
      update client_manufacturers set
        manufacturer_client_code = coalesce(manufacturer_client_code, x.manufacturer_client_code),
        agreed_discount = coalesce(agreed_discount, x.agreed_discount),
        discount_status = coalesce(discount_status, x.discount_status),
        source_name = coalesce(source_name, x.source_name), updated_at = now()
       where client_id = k.id and manufacturer_id = x.manufacturer_id;
      delete from client_manufacturers where id = x.id;
      merged := merged + 1;
    else
      update client_manufacturers set client_id = k.id, updated_at = now() where id = x.id;
      moved := moved + 1;
    end if;
  end loop;

  -- todas as outras tabelas ligadas a clients(id)
  for r in
    select tc.table_schema s, tc.table_name t, kcu.column_name col
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
     where tc.constraint_type = 'FOREIGN KEY' and ccu.table_schema = 'public' and ccu.table_name = 'clients'
       and ccu.column_name = 'id' and tc.table_name <> 'client_manufacturers'
  loop
    for x in execute format('select ctid as c from %I.%I where %I = $1', r.s, r.t, r.col) using d.id loop
      begin
        execute format('update %I.%I set %I = $1 where ctid = $2', r.s, r.t, r.col) using k.id, x.c;
        moved := moved + 1;
      exception when unique_violation then
        -- já existe igual no cliente que fica (ex.: o mesmo contacto): fica só um
        execute format('delete from %I.%I where ctid = $1', r.s, r.t) using x.c;
        merged := merged + 1;
      end;
    end loop;
  end loop;

  delete from clients where id = d.id;

  update clients set
    legal_name = coalesce(legal_name, d.legal_name, case when upper(d.trade_name) <> upper(k.trade_name) then d.trade_name end),
    tax_id = coalesce(tax_id, d.tax_id), country = coalesce(country, d.country), region = coalesce(region, d.region),
    city = coalesce(city, d.city), address = coalesce(address, d.address), postal_code = coalesce(postal_code, d.postal_code),
    phone = coalesce(phone, d.phone), email = coalesce(email, d.email), website = coalesce(website, d.website),
    segment = coalesce(segment, d.segment), zone = coalesce(zone, d.zone), sales_channel = coalesce(sales_channel, d.sales_channel),
    priority = coalesce(priority, d.priority), commercial_potential = coalesce(commercial_potential, d.commercial_potential),
    conditions = case when d.conditions is null or d.conditions = conditions then conditions else concat_ws(E'\n', conditions, d.conditions) end,
    notes = case when d.notes is null or d.notes = notes then notes else concat_ws(E'\n', notes, d.notes) end,
    last_visit_at = greatest(last_visit_at, d.last_visit_at), last_contact_at = greatest(last_contact_at, d.last_contact_at),
    next_contact_at = coalesce(next_contact_at, d.next_contact_at), owner_id = coalesce(owner_id, d.owner_id),
    created_at = least(created_at, d.created_at), updated_at = now()
   where id = k.id;

  return jsonb_build_object('fica', p_keep, 'saiu', p_drop, 'ligacoes_passadas', moved, 'repetidas_juntas', merged);
end; $$;
revoke all on function public.crm_merge_clients(text, text) from public, anon, authenticated;

-- Lamarão & Rocha: fica CLI0168 (tem o contacto e 3 fabricantes); CLI0326 sai.
select public.crm_merge_clients('CLI0168', 'CLI0326') as resultado
union all
-- Casa Fonseca / António Silva Domingues: só códigos e totais, para escolher qual fica.
select jsonb_build_object('codigo', c.code, 'casa_fonseca', c.trade_name ilike '%fonseca%', 'tem_nif', c.tax_id is not null,
  'contactos', (select count(*) from client_contacts where client_id = c.id),
  'fabricantes', (select count(*) from client_manufacturers where client_id = c.id),
  'criado', to_char(c.created_at, 'YYYY-MM-DD'))
  from public.clients c
 where c.trade_name ilike '%casa fonseca%' or c.trade_name ilike '%silva domingues%' or c.legal_name ilike '%silva domingues%';
