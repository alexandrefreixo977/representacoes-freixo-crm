-- Importar campanhas a partir do ficheiro do fabricante (pedido do Alexandre, 31/10/2026).
-- A gestão carrega o Excel/PDF em Gestão › Campanhas; a app lê os artigos e preços netos e chama esta função.
-- p_rows: [{reference, netPrice, offerQty, designation, listPrice, imageUrl, ean}]
-- - artigo encontrado (referência normalizada, igual à pesquisa): ganha o preço de campanha; se não tiver foto, fica com a do ficheiro;
-- - artigo que não existe: é criado se vier com designação (preço de tabela = PVP do ficheiro, ou o neto);
-- - p_replace = true apaga primeiro os preços que a campanha já tinha.
create or replace function public.b2b_import_campaign(p_campaign uuid, p_rows jsonb, p_replace boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c b2b_campaigns;
  r record;
  v_product uuid;
  v_family uuid;
  v_applied int := 0;
  v_created int := 0;
  v_missing text[] := '{}';
begin
  if not b2b_is_admin() then raise exception 'Sem permissão'; end if;
  select * into c from b2b_campaigns where id = p_campaign;
  if c.id is null then raise exception 'Campanha não encontrada'; end if;
  if c.manufacturer_id is null then raise exception 'Escolha a marca da campanha antes de importar'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20000 then raise exception 'Linhas inválidas'; end if;

  if p_replace then
    delete from b2b_discount_rules where campaign_id = p_campaign;
  end if;

  for r in
    select * from jsonb_to_recordset(p_rows) as x(reference text, "netPrice" numeric, "offerQty" numeric, designation text,
      "listPrice" numeric, "imageUrl" text, ean text)
  loop
    if coalesce(trim(r.reference), '') = '' or r."netPrice" is null or r."netPrice" < 0 then continue; end if;
    select id into v_product from b2b_products
    where manufacturer_id = c.manufacturer_id
      and ref_norm = upper(regexp_replace(trim(r.reference), '[\s.\-_/]', '', 'g'))
    limit 1;

    if v_product is null then
      if coalesce(trim(r.designation), '') = '' then
        v_missing := v_missing || trim(r.reference);
        continue;
      end if;
      insert into b2b_families (manufacturer_id, name) values (c.manufacturer_id, 'Campanhas')
      on conflict (manufacturer_id, name) do update set name = excluded.name
      returning id into v_family;
      insert into b2b_products (manufacturer_id, family_id, reference, designation, image_url, ean, sales_unit, pack_qty, moq, is_new, active, updated_at)
      values (c.manufacturer_id, v_family, left(trim(r.reference), 80), left(trim(r.designation), 200),
              case when r."imageUrl" ~* '^https?://' then left(r."imageUrl", 500) end, nullif(left(trim(r.ean), 20), ''),
              'un', 1, 1, true, true, now())
      returning id into v_product;
      insert into b2b_prices (product_id, list_price) values (v_product, round(coalesce(r."listPrice", r."netPrice"), 4))
      on conflict (product_id) do nothing;
      v_created := v_created + 1;
    elsif r."imageUrl" ~* '^https?://' then
      update b2b_products set image_url = left(r."imageUrl", 500), updated_at = now()
      where id = v_product and coalesce(image_url, '') = '';
    end if;

    delete from b2b_discount_rules where campaign_id = p_campaign and product_id = v_product;
    insert into b2b_discount_rules (client_id, manufacturer_id, product_id, discounts, special_net_price, active, valid_until, campaign_id, offer_qty)
    values (null, c.manufacturer_id, v_product, '{}', round(r."netPrice", 4), true, c.ends_on, p_campaign,
            nullif(r."offerQty", 0));
    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object('applied', v_applied, 'created', v_created, 'missing', to_jsonb(v_missing));
end;
$$;
revoke all on function public.b2b_import_campaign(uuid, jsonb, boolean) from public, anon;
grant execute on function public.b2b_import_campaign(uuid, jsonb, boolean) to authenticated;

-- Mudar a data de fim de uma campanha atualiza a validade dos seus preços.
create or replace function public.b2b_campaign_sync_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.ends_on is distinct from old.ends_on then
    update b2b_discount_rules set valid_until = new.ends_on where campaign_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists b2b_campaign_sync_rules on public.b2b_campaigns;
create trigger b2b_campaign_sync_rules after update on public.b2b_campaigns for each row execute function public.b2b_campaign_sync_rules();
