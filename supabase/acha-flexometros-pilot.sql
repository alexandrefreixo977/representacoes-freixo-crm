begin;

do $$
declare
  mid uuid;
  fid uuid;
  plist uuid;
begin
  select id into mid from public.manufacturers where lower(name) like 'acha%' and deleted_at is null limit 1;
  if mid is null then raise exception 'Fabricante ACHA não encontrado'; end if;

  insert into public.catalog_product_families(manufacturer_id,name,subfamily,active,is_test)
  values(mid,'Metrologia','Flexómetros',true,false)
  on conflict(manufacturer_id,name,subfamily) do update set active=true,is_test=false
  returning id into fid;

  update public.catalog_products
  set active=false,updated_at=now()
  where manufacturer_id=mid and is_test=true;

  insert into public.catalog_price_lists(manufacturer_id,name,version,currency,valid_from,status,is_test)
  values(mid,'Catálogo Tarifa ACHA','2025','EUR','2025-01-01','active',false)
  on conflict(manufacturer_id,name,version) do update set status='active',currency='EUR',is_test=false
  returning id into plist;

  insert into public.catalog_products(manufacturer_id,family_id,reference,designation,short_description,technical_description,main_image_url,sales_unit,minimum_pack,moq,status,manufacturer_product_url,technical_sheet_url,active,is_test)
  values
    (mid,fid,'29092D','Flexómetro dupla face com luz LED','Leitura dos dois lados, fita branca com revestimento de nylon e luz LED integrada.','8 m × 25 mm · espessura da fita 0,117 mm','/catalog/acha/flexometro-led.webp','un',1,1,'active','https://www.acha.com/','https://repfreixo-my.sharepoint.com/:b:/g/personal/afreixo_representacoesfreixo_com/IQDknuvKj4PMRb6jq0WLVCGIAc1P-so1Q2r5gErXIAHOQ3Y',true,false),
    (mid,fid,'29373D','Flexómetro dupla face Standout ultrarrígido','Fita extra larga de 32 mm, impressão nas duas faces e alcance sem dobrar até 3,5 m.','Disponível em 5 m e 8 m · fita 32 mm · espessura 0,120 mm','/catalog/acha/flexometro-standout.webp','un',1,1,'active','https://www.acha.com/','https://repfreixo-my.sharepoint.com/:b:/g/personal/afreixo_representacoesfreixo_com/IQDknuvKj4PMRb6jq0WLVCGIAc1P-so1Q2r5gErXIAHOQ3Y',true,false),
    (mid,fid,'29306D','Flexómetro com travão duplo Pro Ergo-R','Caixa bimaterial ergonómica e dois sistemas de travão para controlo preciso da fita.','Disponível de 3 m a 10 m · fita amarela · espessura 0,117 mm','/catalog/acha/flexometro-pro-ergo-r.webp','un',1,1,'active','https://www.acha.com/','https://repfreixo-my.sharepoint.com/:b:/g/personal/afreixo_representacoesfreixo_com/IQDknuvKj4PMRb6jq0WLVCGIAc1P-so1Q2r5gErXIAHOQ3Y',true,false),
    (mid,fid,'29300D','Flexómetro com bloqueio automático Self Lock','Bloqueio automático da fita, botão de recolha e caixa bimaterial resistente.','Disponível de 3 m a 8 m · fita amarela · espessura 0,117 mm','/catalog/acha/flexometro-self-lock.webp','un',1,1,'active','https://www.acha.com/','https://repfreixo-my.sharepoint.com/:b:/g/personal/afreixo_representacoesfreixo_com/IQDknuvKj4PMRb6jq0WLVCGIAc1P-so1Q2r5gErXIAHOQ3Y',true,false),
    (mid,fid,'29296D','Flexómetro magnético Maggrip Dublix','Fita impressa nas duas faces e gancho magnético para trabalho em superfícies metálicas.','Disponível de 3 m a 8 m · fita amarela · espessura 0,117 mm','/catalog/acha/flexometro-maggrip-dublix.webp','un',1,1,'active','https://www.acha.com/','https://repfreixo-my.sharepoint.com/:b:/g/personal/afreixo_representacoesfreixo_com/IQDknuvKj4PMRb6jq0WLVCGIAc1P-so1Q2r5gErXIAHOQ3Y',true,false)
  on conflict(manufacturer_id,reference) do update set
    family_id=excluded.family_id,designation=excluded.designation,short_description=excluded.short_description,
    technical_description=excluded.technical_description,main_image_url=excluded.main_image_url,
    manufacturer_product_url=excluded.manufacturer_product_url,technical_sheet_url=excluded.technical_sheet_url,
    status='active',active=true,is_test=false,updated_at=now();

  with variant_data(product_ref,reference,suffix,length_m,width_mm,thickness_mm,pack,price) as (
    values
      ('29092D','29092D','8 m × 25 mm',8,25,0.117,4,29.89),
      ('29373D','29373D','5 m × 32 mm',5,32,0.120,4,31.49),
      ('29373D','29375D','8 m × 32 mm',8,32,0.120,4,34.94),
      ('29306D','29306D','3 m × 16 mm',3,16,0.117,10,6.18),
      ('29306D','29307D','5 m × 19 mm',5,19,0.117,10,9.33),
      ('29306D','29308D','5 m × 25 mm',5,25,0.117,10,11.52),
      ('29306D','29309D','8 m × 25 mm',8,25,0.117,10,15.80),
      ('29306D','29310D','10 m × 25 mm',10,25,0.117,10,20.08),
      ('29300D','29300D','3 m × 16 mm',3,16,0.117,6,12.90),
      ('29300D','29301D','5 m × 19 mm',5,19,0.117,6,16.93),
      ('29300D','29302D','5 m × 25 mm',5,25,0.117,5,20.18),
      ('29300D','29303D','8 m × 25 mm',8,25,0.117,5,28.27),
      ('29296D','29296D','3 m × 16 mm',3,16,0.117,10,12.61),
      ('29296D','29297D','5 m × 19 mm',5,19,0.117,10,16.59),
      ('29296D','29298D','5 m × 25 mm',5,25,0.117,10,20.18),
      ('29296D','29299D','8 m × 25 mm',8,25,0.117,10,26.07)
  )
  insert into public.catalog_product_variants(product_id,reference,designation_suffix,attributes,sales_unit,minimum_pack,moq,active)
  select p.id,v.reference,v.suffix,jsonb_build_object('comprimento_m',v.length_m,'largura_mm',v.width_mm,'espessura_mm',v.thickness_mm,'embalagem',v.pack),'un',v.pack,1,true
  from variant_data v join public.catalog_products p on p.manufacturer_id=mid and p.reference=v.product_ref
  on conflict(product_id,reference) do update set designation_suffix=excluded.designation_suffix,attributes=excluded.attributes,minimum_pack=excluded.minimum_pack,active=true;

  with price_data(reference,price) as (
    values
      ('29092D',29.89),('29373D',31.49),('29375D',34.94),
      ('29306D',6.18),('29307D',9.33),('29308D',11.52),('29309D',15.80),('29310D',20.08),
      ('29300D',12.90),('29301D',16.93),('29302D',20.18),('29303D',28.27),
      ('29296D',12.61),('29297D',16.59),('29298D',20.18),('29299D',26.07)
  )
  insert into public.catalog_price_list_items(price_list_id,product_id,variant_id,list_price,currency,valid_from)
  select plist,v.product_id,v.id,d.price,'EUR','2025-01-01'
  from price_data d
  join public.catalog_product_variants v on v.reference=d.reference
  join public.catalog_products p on p.id=v.product_id and p.manufacturer_id=mid
  on conflict(price_list_id,product_id,variant_id) do update set list_price=excluded.list_price,currency='EUR',valid_from='2025-01-01';
end $$;

commit;
