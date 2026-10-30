-- Propostas comerciais (pedido do Alexandre, 30/10/2026).
-- Perfis da equipa Freixo:
--   admin     = gestão (Alexandre, Tina): vê e faz tudo, incluindo todas as propostas;
--   comercial = equipa comercial: vê preços e descontos de todos os clientes e só as SUAS propostas.
-- Os clientes nunca veem propostas nem este módulo.

-- ---------------------------------------------------------------- perfil comercial
alter table public.b2b_users drop constraint if exists b2b_users_role_check;
alter table public.b2b_users drop constraint if exists b2b_users_check;
alter table public.b2b_users add constraint b2b_users_role_check check (role in ('client', 'admin', 'comercial'));
alter table public.b2b_users add constraint b2b_users_check check (role in ('admin', 'comercial') or client_id is not null);
alter table public.b2b_users add column if not exists email text;
alter table public.b2b_users add column if not exists name text;
update public.b2b_users bu set email = lower(u.email) from auth.users u where u.id = bu.user_id and bu.email is null;

-- Tina (caixa comercial@) também é gestão.
insert into public.b2b_admin_emails (email) values ('comercial@representacoesfreixo.com') on conflict do nothing;
insert into public.b2b_users (user_id, role, email)
select u.id, 'admin', lower(u.email) from auth.users u join public.b2b_admin_emails a on a.email = lower(u.email)
on conflict (user_id) do update set role = 'admin', client_id = null, email = excluded.email;

create or replace function public.b2b_grant_admin_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from b2b_admin_emails where email = lower(new.email)) then
    insert into b2b_users (user_id, role, email) values (new.id, 'admin', lower(new.email))
    on conflict (user_id) do update set role = 'admin', client_id = null, email = excluded.email;
  end if;
  return new;
end;
$$;

-- Equipa Freixo (gestão ou comercial).
create or replace function public.b2b_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from b2b_users where user_id = auth.uid() and role in ('admin', 'comercial'));
$$;

-- A equipa comercial precisa de ver preços, clientes e descontos para preparar propostas.
drop policy if exists b2b_price_read on public.b2b_prices;
create policy b2b_price_read on public.b2b_prices for select using (b2b_my_client() is not null or b2b_is_staff());
drop policy if exists b2b_client_read on public.b2b_clients;
create policy b2b_client_read on public.b2b_clients for select using (id = b2b_my_client() or b2b_is_staff());
drop policy if exists b2b_rules_read on public.b2b_discount_rules;
create policy b2b_rules_read on public.b2b_discount_rules for select using (
  (b2b_my_client() is not null and (client_id is null or client_id = b2b_my_client())) or b2b_is_staff());

-- ---------------------------------------------------------------- propostas
create sequence if not exists public.b2b_quote_seq;

create table if not exists public.b2b_quotes (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  owner_id uuid not null default auth.uid() references auth.users(id),
  owner_name text,
  owner_email text,
  -- cliente registado, ou potencial cliente (dados escritos na proposta)
  client_id uuid references public.b2b_clients(id) on delete set null,
  customer_name text not null,
  customer_nif text,
  customer_email text,
  customer_phone text,
  customer_address text,
  contact_name text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'lost')),
  valid_until date,
  delivery_terms text,
  payment_terms text,
  notes text,
  internal_note text,
  total numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists b2b_quotes_owner on public.b2b_quotes (owner_id, created_at desc);

create table if not exists public.b2b_quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.b2b_quotes(id) on delete cascade,
  position int not null default 0,
  product_id uuid references public.b2b_products(id) on delete set null,
  manufacturer_name text,
  reference text not null,
  designation text not null,
  variant text,
  sales_unit text not null default 'un',
  qty numeric(14,3) not null check (qty > 0),
  list_price numeric(14,4) not null default 0,
  discounts numeric[] not null default '{}',
  net_price numeric(14,4) not null default 0,
  line_total numeric(14,2) not null default 0
);
create index if not exists b2b_quote_lines_quote on public.b2b_quote_lines (quote_id, position);

-- Número PROP-AAAA-0001, dado pelo servidor.
create or replace function public.b2b_quote_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.number is null or new.number = '' then
    new.number := 'PROP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('b2b_quote_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;
drop trigger if exists b2b_quote_number on public.b2b_quotes;
create trigger b2b_quote_number before insert on public.b2b_quotes for each row execute function public.b2b_quote_number();

alter table public.b2b_quotes enable row level security;
alter table public.b2b_quote_lines enable row level security;

-- Cada comercial vê e altera só as suas; a gestão vê e altera todas.
create policy b2b_quotes_rw on public.b2b_quotes for all
  using (b2b_is_admin() or (b2b_is_staff() and owner_id = auth.uid()))
  with check (b2b_is_admin() or (b2b_is_staff() and owner_id = auth.uid()));
create policy b2b_quote_lines_rw on public.b2b_quote_lines for all
  using (exists (select 1 from b2b_quotes q where q.id = quote_id and (b2b_is_admin() or (b2b_is_staff() and q.owner_id = auth.uid()))))
  with check (exists (select 1 from b2b_quotes q where q.id = quote_id and (b2b_is_admin() or (b2b_is_staff() and q.owner_id = auth.uid()))));

-- Grava a proposta e as linhas de uma vez (as linhas são substituídas). Corre com as permissões de quem chama (RLS).
-- p_quote: campos da proposta (id vazio = nova); p_lines: [{productId, manufacturerName, reference, designation, variant,
--   salesUnit, qty, listPrice, discounts, netPrice}]. O total de cada linha e da proposta é calculado aqui.
create or replace function public.b2b_save_quote(p_quote jsonb, p_lines jsonb)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := nullif(p_quote->>'id', '')::uuid;
  v_number text;
  v_name text;
begin
  if not b2b_is_staff() then raise exception 'Sem permissão'; end if;
  if coalesce(trim(p_quote->>'customerName'), '') = '' then raise exception 'Indique o cliente da proposta'; end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'Linhas inválidas'; end if;
  if jsonb_array_length(p_lines) > 500 then raise exception 'Demasiadas linhas'; end if;
  select coalesce(name, email) into v_name from b2b_users where user_id = auth.uid();

  if v_id is null then
    insert into b2b_quotes (owner_id, owner_name, owner_email, client_id, customer_name, customer_nif, customer_email, customer_phone,
      customer_address, contact_name, status, valid_until, delivery_terms, payment_terms, notes, internal_note)
    values (auth.uid(), v_name, (select email from b2b_users where user_id = auth.uid()),
      nullif(p_quote->>'clientId', '')::uuid, left(trim(p_quote->>'customerName'), 200), left(p_quote->>'customerNif', 30),
      left(p_quote->>'customerEmail', 200), left(p_quote->>'customerPhone', 40), left(p_quote->>'customerAddress', 400),
      left(p_quote->>'contactName', 120), coalesce(nullif(p_quote->>'status', ''), 'draft'), nullif(p_quote->>'validUntil', '')::date,
      left(p_quote->>'deliveryTerms', 400), left(p_quote->>'paymentTerms', 400), left(p_quote->>'notes', 4000), left(p_quote->>'internalNote', 4000))
    returning id, number into v_id, v_number;
  else
    update b2b_quotes set
      client_id = nullif(p_quote->>'clientId', '')::uuid,
      customer_name = left(trim(p_quote->>'customerName'), 200),
      customer_nif = left(p_quote->>'customerNif', 30),
      customer_email = left(p_quote->>'customerEmail', 200),
      customer_phone = left(p_quote->>'customerPhone', 40),
      customer_address = left(p_quote->>'customerAddress', 400),
      contact_name = left(p_quote->>'contactName', 120),
      status = coalesce(nullif(p_quote->>'status', ''), status),
      valid_until = nullif(p_quote->>'validUntil', '')::date,
      delivery_terms = left(p_quote->>'deliveryTerms', 400),
      payment_terms = left(p_quote->>'paymentTerms', 400),
      notes = left(p_quote->>'notes', 4000),
      internal_note = left(p_quote->>'internalNote', 4000),
      updated_at = now()
    where id = v_id
    returning number into v_number;
    if v_number is null then raise exception 'Proposta não encontrada'; end if;
    delete from b2b_quote_lines where quote_id = v_id;
  end if;

  insert into b2b_quote_lines (quote_id, position, product_id, manufacturer_name, reference, designation, variant, sales_unit,
    qty, list_price, discounts, net_price, line_total)
  select v_id, e.ord::int, nullif(e.v->>'productId', '')::uuid, left(e.v->>'manufacturerName', 120), left(e.v->>'reference', 80),
    left(e.v->>'designation', 400), nullif(left(trim(e.v->>'variant'), 20), ''), coalesce(nullif(e.v->>'salesUnit', ''), 'un'),
    (e.v->>'qty')::numeric, round(coalesce((e.v->>'listPrice')::numeric, 0), 4),
    coalesce(array(select d::numeric from jsonb_array_elements_text(coalesce(e.v->'discounts', '[]'::jsonb)) d
                   where d::numeric > 0 and d::numeric <= 100), '{}'),
    round(coalesce((e.v->>'netPrice')::numeric, 0), 4),
    round(round(coalesce((e.v->>'netPrice')::numeric, 0), 4) * (e.v->>'qty')::numeric, 2)
  from jsonb_array_elements(p_lines) with ordinality as e(v, ord)
  where coalesce((e.v->>'qty')::numeric, 0) > 0 and coalesce(trim(e.v->>'reference'), '') <> '';

  update b2b_quotes set total = (select coalesce(sum(line_total), 0) from b2b_quote_lines where quote_id = v_id) where id = v_id;
  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;
revoke all on function public.b2b_save_quote(jsonb, jsonb) from public, anon;
grant execute on function public.b2b_save_quote(jsonb, jsonb) to authenticated;
