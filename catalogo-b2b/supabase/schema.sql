-- Catálogo B2B Freixo — base de dados (Supabase / Postgres)
-- Correr uma vez no SQL Editor de um projeto Supabase novo (ou neste mesmo projeto do CRM: todas as
-- tabelas têm o prefixo b2b_ e não tocam nas tabelas do CRM).
-- A estrutura segue a do catálogo beta do CRM (catalog_*), para ser fácil juntar as duas apps mais tarde.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- catálogo (público, sem preços)
create table if not exists public.b2b_manufacturers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  orders_email text,
  sort int not null default 100,
  active boolean not null default true
);

create table if not exists public.b2b_families (
  id uuid primary key default gen_random_uuid(),
  manufacturer_id uuid not null references public.b2b_manufacturers(id) on delete cascade,
  name text not null,
  unique (manufacturer_id, name)
);

create table if not exists public.b2b_products (
  id uuid primary key default gen_random_uuid(),
  manufacturer_id uuid not null references public.b2b_manufacturers(id),
  family_id uuid references public.b2b_families(id) on delete set null,
  reference text not null,
  ean text,
  designation text not null,
  description text,
  image_url text,
  tech_sheet_url text,
  sales_unit text not null default 'un',
  pack_qty numeric(14,3) not null default 1 check (pack_qty > 0),
  moq numeric(14,3) not null default 1 check (moq > 0),
  is_new boolean not null default false,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (manufacturer_id, reference)
);
create index if not exists b2b_products_search on public.b2b_products using gin (to_tsvector('portuguese', reference || ' ' || designation));

create table if not exists public.b2b_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  badge text,
  image_url text,
  manufacturer_id uuid references public.b2b_manufacturers(id) on delete set null,
  product_id uuid references public.b2b_products(id) on delete set null,
  starts_on date,
  ends_on date,
  active boolean not null default true,
  sort int not null default 100
);

-- ---------------------------------------------------------------- preços e clientes (privado)
create table if not exists public.b2b_prices (
  product_id uuid primary key references public.b2b_products(id) on delete cascade,
  list_price numeric(14,4) not null check (list_price >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.b2b_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  nif text,
  email text,
  phone text,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Liga cada login (auth.users) a um cliente. role = 'admin' para a equipa Freixo.
create table if not exists public.b2b_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  client_id uuid references public.b2b_clients(id) on delete cascade,
  role text not null default 'client' check (role in ('client','admin')),
  check (role = 'admin' or client_id is not null)
);

-- Regras comerciais. client_id vazio = todos os clientes.
-- Prioridade: artigo > família > fabricante; no mesmo nível, regra do cliente > regra geral.
-- Preço líquido especial substitui os descontos.
create table if not exists public.b2b_discount_rules (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.b2b_clients(id) on delete cascade,
  manufacturer_id uuid not null references public.b2b_manufacturers(id) on delete cascade,
  family_id uuid references public.b2b_families(id) on delete cascade,
  product_id uuid references public.b2b_products(id) on delete cascade,
  discounts numeric[] not null default '{}',
  special_net_price numeric(14,4),
  active boolean not null default true,
  valid_until date,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- encomendas
create sequence if not exists public.b2b_order_seq;

create table if not exists public.b2b_order_groups (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  client_id uuid not null references public.b2b_clients(id),
  user_id uuid not null references auth.users(id),
  customer_ref text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.b2b_orders (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.b2b_order_groups(id) on delete cascade,
  number text not null unique,
  client_id uuid not null references public.b2b_clients(id),
  manufacturer_id uuid not null references public.b2b_manufacturers(id),
  status text not null default 'pending'
    check (status in ('pending','validated','sent','confirmed','delivered','cancelled')),
  subtotal numeric(14,2) not null default 0,
  internal_note text,
  status_changed_at timestamptz,
  status_changed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.b2b_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.b2b_orders(id) on delete cascade,
  product_id uuid not null references public.b2b_products(id),
  reference text not null,
  designation text not null,
  sales_unit text not null,
  qty numeric(14,3) not null check (qty > 0),
  list_price numeric(14,4) not null,
  discounts numeric[] not null default '{}',
  net_price numeric(14,4) not null,
  line_total numeric(14,2) not null
);

create table if not exists public.b2b_access_requests (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  nif text,
  name text not null,
  email text not null,
  phone text,
  message text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- funções auxiliares
create or replace function public.b2b_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from b2b_users where user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.b2b_my_client() returns uuid
language sql stable security definer set search_path = public as $$
  select client_id from b2b_users where user_id = auth.uid();
$$;

-- Regra que se aplica a um produto para um cliente (igual a pickRule() em src/pricing.ts).
create or replace function public.b2b_pick_rule(p_client uuid, p_product uuid)
returns public.b2b_discount_rules
language sql stable security definer set search_path = public as $$
  select r.* from b2b_discount_rules r
  join b2b_products p on p.id = p_product
  where r.active
    and (r.valid_until is null or r.valid_until >= current_date)
    and r.manufacturer_id = p.manufacturer_id
    and (r.client_id is null or r.client_id = p_client)
    and (r.product_id is null or r.product_id = p.id)
    and (r.family_id is null or r.family_id = p.family_id)
  order by (case when r.product_id is not null then 2 when r.family_id is not null then 1 else 0 end) desc,
           (r.client_id is not null) desc
  limit 1;
$$;

-- Submete o carrinho. Os preços são SEMPRE recalculados aqui (nunca se confia no browser) e
-- o carrinho é dividido numa encomenda por fabricante, todas em estado "pending" (a validar).
-- p_items: [{"productId": "...", "qty": 10}, ...]
create or replace function public.b2b_submit_order(p_items jsonb, p_customer_ref text, p_notes text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid := b2b_my_client();
  v_group uuid;
  v_number text;
  v_order uuid;
  v_seq int := 0;
  v_mfr record;
  v_item record;
  v_rule b2b_discount_rules;
  v_list numeric;
  v_disc numeric[];
  v_net numeric;
  v_qty numeric;
  d numeric;
begin
  if auth.uid() is null or v_client is null then
    raise exception 'Conta sem cliente associado';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Carrinho vazio';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'Demasiadas linhas';
  end if;

  v_number := 'ENC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('b2b_order_seq')::text, 4, '0');
  insert into b2b_order_groups (number, client_id, user_id, customer_ref, notes)
  values (v_number, v_client, auth.uid(), left(p_customer_ref, 80), left(p_notes, 2000))
  returning id into v_group;

  for v_mfr in
    select distinct p.manufacturer_id
    from jsonb_to_recordset(p_items) as i("productId" uuid, qty numeric)
    join b2b_products p on p.id = i."productId" and p.active
    order by p.manufacturer_id
  loop
    v_seq := v_seq + 1;
    insert into b2b_orders (group_id, number, client_id, manufacturer_id)
    values (v_group, v_number || '/' || v_seq, v_client, v_mfr.manufacturer_id)
    returning id into v_order;

    for v_item in
      select p.*, i.qty as wanted
      from jsonb_to_recordset(p_items) as i("productId" uuid, qty numeric)
      join b2b_products p on p.id = i."productId" and p.active
      where p.manufacturer_id = v_mfr.manufacturer_id and i.qty > 0
    loop
      select list_price into v_list from b2b_prices where product_id = v_item.id;
      if v_list is null then
        raise exception 'Artigo % sem preço', v_item.reference;
      end if;
      -- caixas completas e quantidade mínima
      v_qty := ceil(greatest(v_item.wanted, v_item.moq, v_item.pack_qty) / v_item.pack_qty) * v_item.pack_qty;
      v_rule := b2b_pick_rule(v_client, v_item.id);
      if v_rule.special_net_price is not null then
        v_disc := '{}';
        v_net := v_rule.special_net_price;
      else
        v_disc := coalesce(array(select x from unnest(v_rule.discounts) x where x > 0 and x <= 100), '{}');
        v_net := v_list;
        foreach d in array v_disc loop
          v_net := v_net * (1 - d / 100);
        end loop;
        v_net := round(v_net, 4);
      end if;
      insert into b2b_order_lines (order_id, product_id, reference, designation, sales_unit, qty, list_price, discounts, net_price, line_total)
      values (v_order, v_item.id, v_item.reference, v_item.designation, v_item.sales_unit, v_qty, v_list, v_disc, v_net, round(v_net * v_qty, 2));
    end loop;

    update b2b_orders set subtotal = (select coalesce(sum(line_total), 0) from b2b_order_lines where order_id = v_order)
    where id = v_order;
  end loop;

  if v_seq = 0 then
    raise exception 'Nenhum artigo válido no carrinho';
  end if;
  return jsonb_build_object('groupId', v_group, 'groupNumber', v_number);
end;
$$;
revoke all on function public.b2b_submit_order(jsonb, text, text) from public, anon;
grant execute on function public.b2b_submit_order(jsonb, text, text) to authenticated;

-- Importação de tabela de preços (Excel) feita pela gestão. Atualiza por referência; cria artigos novos.
-- p_rows: [{"reference","designation","listPrice","salesUnit","packQty","family","ean"}, ...]
create or replace function public.b2b_import_prices(p_manufacturer uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_family uuid;
  v_product uuid;
  v_created int := 0;
  v_updated int := 0;
  v_skipped int := 0;
begin
  if not b2b_is_admin() then raise exception 'Sem permissão'; end if;
  for r in
    select * from jsonb_to_recordset(p_rows) as x(reference text, designation text, "listPrice" numeric,
      "salesUnit" text, "packQty" numeric, family text, ean text)
  loop
    if coalesce(trim(r.reference), '') = '' then v_skipped := v_skipped + 1; continue; end if;
    v_family := null;
    if coalesce(trim(r.family), '') <> '' then
      insert into b2b_families (manufacturer_id, name) values (p_manufacturer, trim(r.family))
      on conflict (manufacturer_id, name) do update set name = excluded.name
      returning id into v_family;
    end if;
    select id into v_product from b2b_products
    where manufacturer_id = p_manufacturer
      and upper(regexp_replace(reference, '[\s.\-_/]', '', 'g')) = upper(regexp_replace(r.reference, '[\s.\-_/]', '', 'g'))
    limit 1;
    if v_product is not null then
      update b2b_products set
        designation = coalesce(nullif(trim(r.designation), ''), designation),
        sales_unit = coalesce(nullif(trim(r."salesUnit"), ''), sales_unit),
        pack_qty = coalesce(nullif(r."packQty", 0), pack_qty),
        family_id = coalesce(v_family, family_id),
        ean = coalesce(nullif(trim(r.ean), ''), ean),
        updated_at = now()
      where id = v_product;
      v_updated := v_updated + 1;
    elsif coalesce(trim(r.designation), '') <> '' and r."listPrice" is not null then
      insert into b2b_products (manufacturer_id, family_id, reference, designation, sales_unit, pack_qty, moq, ean, is_new)
      values (p_manufacturer, v_family, trim(r.reference), trim(r.designation), coalesce(nullif(trim(r."salesUnit"), ''), 'un'),
              coalesce(nullif(r."packQty", 0), 1), coalesce(nullif(r."packQty", 0), 1), nullif(trim(r.ean), ''), true)
      returning id into v_product;
      v_created := v_created + 1;
    else
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if r."listPrice" is not null then
      insert into b2b_prices (product_id, list_price) values (v_product, r."listPrice")
      on conflict (product_id) do update set list_price = excluded.list_price, updated_at = now();
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped);
end;
$$;
revoke all on function public.b2b_import_prices(uuid, jsonb) from public, anon;
grant execute on function public.b2b_import_prices(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- segurança (RLS)
alter table public.b2b_manufacturers enable row level security;
alter table public.b2b_families enable row level security;
alter table public.b2b_products enable row level security;
alter table public.b2b_campaigns enable row level security;
alter table public.b2b_prices enable row level security;
alter table public.b2b_clients enable row level security;
alter table public.b2b_users enable row level security;
alter table public.b2b_discount_rules enable row level security;
alter table public.b2b_order_groups enable row level security;
alter table public.b2b_orders enable row level security;
alter table public.b2b_order_lines enable row level security;
alter table public.b2b_access_requests enable row level security;

-- Montra pública: qualquer pessoa vê fabricantes, famílias, artigos e campanhas ativos (sem preços).
create policy b2b_mfr_read on public.b2b_manufacturers for select using (active or b2b_is_admin());
create policy b2b_fam_read on public.b2b_families for select using (true);
create policy b2b_prod_read on public.b2b_products for select using (active or b2b_is_admin());
create policy b2b_camp_read on public.b2b_campaigns for select using (
  (active and (starts_on is null or starts_on <= current_date) and (ends_on is null or ends_on >= current_date)) or b2b_is_admin());

-- Preços: só clientes com conta (e a gestão).
create policy b2b_price_read on public.b2b_prices for select using (b2b_my_client() is not null or b2b_is_admin());

-- Cada cliente só vê a sua ficha, as suas regras (e as gerais) e as suas encomendas.
create policy b2b_client_read on public.b2b_clients for select using (id = b2b_my_client() or b2b_is_admin());
create policy b2b_users_read on public.b2b_users for select using (user_id = auth.uid() or b2b_is_admin());
create policy b2b_rules_read on public.b2b_discount_rules for select using (
  (b2b_my_client() is not null and (client_id is null or client_id = b2b_my_client())) or b2b_is_admin());
create policy b2b_groups_read on public.b2b_order_groups for select using (client_id = b2b_my_client() or b2b_is_admin());
create policy b2b_orders_read on public.b2b_orders for select using (client_id = b2b_my_client() or b2b_is_admin());
create policy b2b_lines_read on public.b2b_order_lines for select using (
  exists (select 1 from b2b_orders o where o.id = order_id and (o.client_id = b2b_my_client() or b2b_is_admin())));

-- Pedidos de acesso: qualquer pessoa pode enviar; só a gestão lê.
create policy b2b_req_insert on public.b2b_access_requests for insert with check (true);
create policy b2b_req_read on public.b2b_access_requests for select using (b2b_is_admin());

-- Gestão: escrita em tudo (as encomendas dos clientes entram só pela função b2b_submit_order).
create policy b2b_mfr_admin on public.b2b_manufacturers for all using (b2b_is_admin()) with check (b2b_is_admin());
create policy b2b_fam_admin on public.b2b_families for all using (b2b_is_admin()) with check (b2b_is_admin());
create policy b2b_prod_admin on public.b2b_products for all using (b2b_is_admin()) with check (b2b_is_admin());
create policy b2b_camp_admin on public.b2b_campaigns for all using (b2b_is_admin()) with check (b2b_is_admin());
create policy b2b_price_admin on public.b2b_prices for all using (b2b_is_admin()) with check (b2b_is_admin());
create policy b2b_client_admin on public.b2b_clients for all using (b2b_is_admin()) with check (b2b_is_admin());
create policy b2b_users_admin on public.b2b_users for all using (b2b_is_admin()) with check (b2b_is_admin());
create policy b2b_rules_admin on public.b2b_discount_rules for all using (b2b_is_admin()) with check (b2b_is_admin());
create policy b2b_orders_admin on public.b2b_orders for update using (b2b_is_admin()) with check (b2b_is_admin());

-- ---------------------------------------------------------------- primeiro administrador
-- Depois de criar o seu utilizador em Authentication > Users, corra (com o seu email):
-- insert into public.b2b_users (user_id, role) select id, 'admin' from auth.users where email = 'afreixo@representacoesfreixo.com';
