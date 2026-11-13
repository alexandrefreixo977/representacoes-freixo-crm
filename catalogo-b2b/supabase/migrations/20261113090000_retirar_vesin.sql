-- Retirar a VESIN da loja B2B (pedido do Alexandre, 13/11/2026).
-- 1) Cópia de segurança de tudo o que é da VESIN no esquema privado "arquivo" (não exposto à API da loja).
--    Para repor: inserir de volta a partir de arquivo.vesin_* (fabricante → famílias → artigos → preços → regras/campanhas).
--    A origem dos dados também fica no repositório: data/vesin/tarifa_2026.txt + data/build_vesin.py.
-- 2) Apaga fabricante, famílias, artigos, preços, regras e campanhas da VESIN.
--    Artigos que estejam em encomendas ficam guardados (inativos) para não estragar o histórico; propostas guardam o texto.

create schema if not exists arquivo;
revoke all on schema arquivo from public, anon, authenticated;

do $$
declare
  v_m uuid[];
begin
  select array_agg(id) into v_m from public.b2b_manufacturers where slug = 'vesin';
  if v_m is null then
    raise notice 'VESIN já não existe na loja';
    return;
  end if;

  -- 1) cópia de segurança (só cria se ainda não existir)
  if to_regclass('arquivo.vesin_fabricante') is null then
    create table arquivo.vesin_fabricante as select * from public.b2b_manufacturers where id = any(v_m);
    create table arquivo.vesin_familias as select * from public.b2b_families where manufacturer_id = any(v_m);
    create table arquivo.vesin_artigos as select * from public.b2b_products where manufacturer_id = any(v_m);
    create table arquivo.vesin_precos as
      select pr.* from public.b2b_prices pr join public.b2b_products p on p.id = pr.product_id where p.manufacturer_id = any(v_m);
    create table arquivo.vesin_regras as select * from public.b2b_discount_rules where manufacturer_id = any(v_m);
    create table arquivo.vesin_campanhas as
      select * from public.b2b_campaigns
      where manufacturer_id = any(v_m) or product_id in (select id from public.b2b_products where manufacturer_id = any(v_m));
  end if;

  -- 2) apagar
  delete from public.b2b_discount_rules where manufacturer_id = any(v_m);
  delete from public.b2b_campaigns
    where manufacturer_id = any(v_m) or product_id in (select id from public.b2b_products where manufacturer_id = any(v_m));
  delete from public.b2b_prices where product_id in (select id from public.b2b_products where manufacturer_id = any(v_m));
  delete from public.b2b_products p
    where p.manufacturer_id = any(v_m) and not exists (select 1 from public.b2b_order_lines l where l.product_id = p.id);
  update public.b2b_products set active = false where manufacturer_id = any(v_m);

  if exists (select 1 from public.b2b_products where manufacturer_id = any(v_m))
     or exists (select 1 from public.b2b_orders where manufacturer_id = any(v_m)) then
    -- há histórico de encomendas: o fabricante fica guardado mas oculto
    delete from public.b2b_families f where f.manufacturer_id = any(v_m)
      and not exists (select 1 from public.b2b_products p where p.family_id = f.id);
    update public.b2b_manufacturers set active = false where id = any(v_m);
  else
    delete from public.b2b_families where manufacturer_id = any(v_m);
    delete from public.b2b_manufacturers where id = any(v_m);
  end if;
end $$;
