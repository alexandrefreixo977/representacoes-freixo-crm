-- Campanha ACHA "Oferta Outono-Inverno 2026" (preços netos, 198 artigos), válida de 01/10/2026 a 31/01/2027.
-- Pedido do Alexandre (31/10/2026): só visível para revendedores com conta. Gerado por data/build_acha_oferta.py — não editar à mão.

-- Campanhas só para clientes registados (visitantes não as veem).
alter table public.b2b_campaigns add column if not exists members_only boolean not null default true;
alter table public.b2b_campaigns add column if not exists details text;
drop policy if exists b2b_camp_read on public.b2b_campaigns;
create policy b2b_camp_read on public.b2b_campaigns for select using (
  (active and (starts_on is null or starts_on <= current_date) and (ends_on is null or ends_on >= current_date)
   and (not members_only or b2b_my_client() is not null or b2b_is_staff()))
  or b2b_is_admin());

-- Preços de campanha: regras por artigo ligadas à campanha (apagar a campanha apaga os preços).
alter table public.b2b_discount_rules add column if not exists campaign_id uuid references public.b2b_campaigns(id) on delete cascade;
alter table public.b2b_discount_rules add column if not exists offer_qty numeric;
create index if not exists b2b_rules_campaign on public.b2b_discount_rules (campaign_id);

insert into public.b2b_campaigns (id, title, subtitle, badge, details, manufacturer_id, starts_on, ends_on, active, sort, members_only)
select 'a0c4a2f6-2026-4f10-9d2a-0000000a2026', 'Oferta Outono-Inverno 2026',
  'Preços netos em nivelação laser, flexómetros, marcação, metrologia e medição eletrónica. Até 31 de janeiro de 2027.',
  'Preço neto',
  'Preços netos por unidade, já aplicados no seu carrinho. A coluna "Oferta" indica a quantidade de referência da ACHA para cada artigo. Expositores com condições próprias (ver descrição de cada um). Tubos de tinta indelével: 2,40 €/un a partir de 50 un.; 2,35 € a partir de 100; 2,30 € a partir de 200; 2,25 € a partir de 400 (caixas da mesma referência).',
  m.id, '2026-10-01', '2027-01-31', true, 10, true
from public.b2b_manufacturers m where m.slug = 'acha-herramientas'
on conflict (id) do update set title = excluded.title, subtitle = excluded.subtitle, badge = excluded.badge, details = excluded.details,
  starts_on = excluded.starts_on, ends_on = excluded.ends_on, members_only = true;

create temp table acha_new (reference text, designation text, description text, family text, image_url text, list_price numeric);
insert into acha_new values
('54340EIN','Adaptador bateria EINHELL para nível laser 18VMAX','Adaptador bateria EINHELL para nível laser 18VMAX. Oferta ACHA Outono-Inverno 2026.','Níveis e prumos',null,12.6),
('54340AEG','Adaptador bateria AEG para nível laser 18VMAX','Adaptador bateria AEG para nível laser 18VMAX. Oferta ACHA Outono-Inverno 2026.','Níveis e prumos',null,12.6),
('54340HIL','Adaptador bateria HILTI para nível laser 18VMAX','Adaptador bateria HILTI para nível laser 18VMAX. Oferta ACHA Outono-Inverno 2026.','Níveis e prumos',null,12.6),
('54340FLE','Adaptador bateria FLEX para nível laser 18VMAX','Adaptador bateria FLEX para nível laser 18VMAX. Oferta ACHA Outono-Inverno 2026.','Níveis e prumos',null,12.6),
('70018','Nível laser vermelho rotativo Spinner com recetor, mira e tripé','Nível laser vermelho rotativo Spinner com recetor, mira e tripé. Oferta ACHA Outono-Inverno 2026.','Níveis e prumos',null,477.11),
('70025','Nível laser vermelho rotativo PARA-DS com recetor','Nível laser vermelho rotativo PARA-DS com recetor. Oferta ACHA Outono-Inverno 2026.','Níveis e prumos',null,899.25),
('XP540','Expositor nível laser verde 3D multibateria 18VMAX (6 níveis + 6 adaptadores grátis)','Expositor nível laser 3D multibateria 18VMAX: 6 níveis 54340 + 6 adaptadores à escolha grátis. Oferta ACHA Outono-Inverno 2026.','Níveis e prumos','https://www.acha.com/images/catalogo/5242967290244740.jpg',1348.74),
('XP542','Expositor misto de nivelação (níveis laser, medidores e endoscópios)','Expositor misto nivelação: 2x 54340 + 2 adaptadores, 54322, 2x 54321D, 2x 54319D, 2x 54361D, 2x 54362D, 57736D, 57737D. Oferta ACHA Outono-Inverno 2026.','Níveis e prumos',null,1224.64);

create temp table acha_offer (reference text, offer_qty numeric, net_price numeric, note text);
insert into acha_offer values
('54340',1,224.79,'Nível laser verde 3D multibateria 18VMAX'),
('54340BOS',1,6.45,null),
('54340DEW',1,6.45,null),
('54340FES',1,6.45,null),
('54340MAK',1,6.45,null),
('54340MET',1,6.45,null),
('54340MIL',1,6.45,null),
('54340HIK',1,6.45,null),
('54340EIN',1,6.45,null),
('54340AEG',1,6.45,null),
('54340HIL',1,6.45,null),
('54340FLE',1,6.45,null),
('54322',1,178.71,null),
('54323',1,245.27,null),
('54324',1,409.13,null),
('70018',1,477.11,null),
('54325',1,511.54,null),
('70025',1,899.25,null),
('XP540',1,1348.74,null),
('XP542',1,1224.64,null),
('54319D',1,40.45,null),
('54320D',1,69.0,null),
('54321D',1,99.0,null),
('50322',1,49.89,null),
('54332',1,10.19,null),
('54330',1,15.31,null),
('54333',1,20.43,null),
('54335',1,71.17,null),
('54334',1,60.93,null),
('54336',1,137.74,null),
('60161',1,55.81,null),
('60162',1,81.41,null),
('60150',1,30.21,null),
('29407D',6,5.07,null),
('29092D',4,15.31,null),
('29201D',8,10.92,null),
('29202D',8,14.71,null),
('29142D',10,5.5,null),
('29382D',5,22.03,null),
('29306D',20,3.16,null),
('29307D',20,4.78,null),
('29308D',10,5.9,null),
('29309D',5,8.09,null),
('29310D',5,10.28,null),
('29130D',20,3.05,null),
('29131D',20,3.26,null),
('29132D',10,4.7,null),
('29326D',10,6.94,null),
('29327D',10,10.86,null),
('29329D',10,18.66,null),
('29120D',30,2.69,null),
('29121D',30,4.1,null),
('29122D',12,6.51,null),
('29296D',10,6.46,null),
('29297D',10,8.49,null),
('29298D',10,10.33,null),
('29299D',10,13.35,null),
('29373D',4,16.12,null),
('29375D',4,17.89,null),
('29516D',2,11.44,null),
('29517D',2,14.57,null),
('29510D',2,12.42,null),
('29511D',2,14.9,null),
('29535D',2,8.44,null),
('29536D',2,10.77,null),
('29537D',2,13.16,null),
('29538D',2,18.57,null),
('29530D',2,14.01,null),
('29531D',2,20.15,null),
('29532D',2,39.22,null),
('54980D',4,3.52,null),
('54981D',4,3.88,null),
('54982D',4,6.04,null),
('54904',2,48.98,null),
('54905',2,55.33,null),
('XP451',1,75.11,'Expositor marcadores ACHA: 10 de cada (fino e médio, preto, vermelho, azul, verde)'),
('45230',50,0.92,null),
('45232',50,0.92,null),
('45234',50,0.92,null),
('45236',50,0.92,null),
('45576',24,3.28,null),
('45578',24,3.28,null),
('45580',24,3.28,null),
('45582',24,3.28,null),
('XP456',1,262.72,'Expositor marcadores de bombagem líquida: 20 de cada cor (preto, vermelho, branco, amarelo)'),
('46240',50,2.41,null),
('46241',50,2.41,null),
('46242',50,2.41,null),
('46243',50,2.41,null),
('XP461',1,298.98,'Expositor Edding 3000: 64 preto, 32 vermelho, 24 azul, 8 verde'),
('45130',1,135.88,'Expositor marcador ponta telescópica extrafina: 24 preto, 12 vermelho, 8 azul'),
('45028',5,10.33,null),
('45029',5,11.81,null),
('45050D',48,0.74,null),
('45051D',48,1.11,null),
('45008',48,1.2,null),
('45002',60,0.91,null),
('XP464',1,76.93,'Expositor lápis bicolor Faber-Castell grosso (60 un.)'),
('XP465',1,76.02,'Expositor lápis bicolor Faber-Castell fino (120 un.)'),
('57022',2,5.65,null),
('57023',2,5.93,null),
('57024',2,6.52,null),
('57025',2,7.27,null),
('57027',2,10.01,null),
('57029',2,13.04,null),
('57042',2,16.6,null),
('57043',2,17.76,null),
('57044',2,19.26,null),
('57045',2,21.74,null),
('57047',2,30.0,null),
('57049',2,39.11,null),
('57208D',2,5.93,null),
('57212D',2,7.11,null),
('57216D',2,7.61,null),
('57220D',2,8.36,null),
('57226D',2,9.18,null),
('57230D',2,11.15,null),
('57108D',2,13.64,null),
('57112D',2,16.26,null),
('57116D',2,17.51,null),
('57120D',2,19.15,null),
('57126D',2,21.28,null),
('57130D',2,28.29,null),
('45430',50,2.4,'Tubo de tinta indelével: 2,40 €/un a partir de 50 un. (100 un.: 2,35 · 200 un.: 2,30 · 400 un.: 2,25), caixas da mesma referência'),
('45431',50,2.4,'Tubo de tinta indelével: 2,40 €/un a partir de 50 un. (100 un.: 2,35 · 200 un.: 2,30 · 400 un.: 2,25), caixas da mesma referência'),
('45432',50,2.4,'Tubo de tinta indelével: 2,40 €/un a partir de 50 un. (100 un.: 2,35 · 200 un.: 2,30 · 400 un.: 2,25), caixas da mesma referência'),
('45433',50,2.4,'Tubo de tinta indelével: 2,40 €/un a partir de 50 un. (100 un.: 2,35 · 200 un.: 2,30 · 400 un.: 2,25), caixas da mesma referência'),
('45434',50,2.4,'Tubo de tinta indelével: 2,40 €/un a partir de 50 un. (100 un.: 2,35 · 200 un.: 2,30 · 400 un.: 2,25), caixas da mesma referência'),
('45435',50,2.4,'Tubo de tinta indelével: 2,40 €/un a partir de 50 un. (100 un.: 2,35 · 200 un.: 2,30 · 400 un.: 2,25), caixas da mesma referência'),
('45436',50,2.4,'Tubo de tinta indelével: 2,40 €/un a partir de 50 un. (100 un.: 2,35 · 200 un.: 2,30 · 400 un.: 2,25), caixas da mesma referência'),
('14124',5,9.91,null),
('14154',5,11.85,null),
('14204',5,16.35,null),
('15124',4,14.7,null),
('15154',4,17.13,null),
('15204',2,20.23,null),
('15254',2,29.41,null),
('40204',10,10.42,null),
('40254',10,10.8,null),
('40304',10,11.97,null),
('40404',10,14.45,null),
('07520',10,7.82,null),
('07525',10,9.16,null),
('07530',10,11.08,null),
('07540',10,13.47,null),
('32034',10,5.2,null),
('32054',10,6.31,null),
('32104',3,15.98,null),
('31024',10,1.26,null),
('31054',10,2.92,null),
('31064',10,4.32,null),
('17113',6,16.3,null),
('17116',6,17.18,null),
('17118',6,18.2,null),
('17120',2,22.67,null),
('17240',5,16.56,null),
('17260',2,37.69,null),
('XP501',1,739.49,'Expositor testers: 4x 50002, 4x 50003, 2x 50004, 50005, 4x 50022, 50024, 4x 50041, 2x 50042, 4x 50043, 2x 50050'),
('50002',2,25.55,null),
('50003',2,30.67,null),
('50004',2,53.71,null),
('50005',2,58.83,null),
('50022',2,35.79,null),
('50024',2,56.27,null),
('50041',2,5.27,null),
('50042',2,16.26,null),
('50043',2,11.2,null),
('50050',2,25.25,null),
('57736D',1,60.93,null),
('57737D',1,96.78,null),
('54361D',1,34.1,null),
('54362D',1,39.32,null),
('50150D',1,24.06,null),
('50151D',1,29.51,null),
('50152D',1,49.9,null),
('53104',5,13.15,null),
('53105',5,14.16,null),
('53106',4,16.72,null),
('53108',4,19.13,null),
('53110',4,21.48,null),
('53112',2,24.14,null),
('53115',2,28.0,null),
('53118',2,31.28,null),
('53120',2,35.09,null),
('53134',5,19.09,null),
('53135',5,21.11,null),
('53136',4,22.34,null),
('53138',4,27.51,null),
('53140',4,33.69,null),
('53142',2,34.96,null),
('53145',2,38.12,null),
('53148',2,40.97,null),
('53150',2,43.23,null),
('XP053',1,643.2,'Expositor níveis PRO 800 (24 níveis de 60 a 200 cm, normais e magnéticos)'),
('XP052',1,468.13,'Expositor níveis PRO 800 (24 níveis de 40 a 100 cm, normais e magnéticos)'),
('53164',1,74.2,null),
('53166',1,87.0,null),
('53168',1,92.12,null);

do $$
declare m uuid := (select id from public.b2b_manufacturers where slug = 'acha-herramientas');
begin
  insert into public.b2b_families (manufacturer_id, name) select distinct m, family from acha_new
  on conflict (manufacturer_id, name) do nothing;

  insert into public.b2b_products (manufacturer_id, family_id, reference, designation, description, image_url,
    sales_unit, pack_qty, moq, is_new, active, updated_at)
  select m, fam.id, a.reference, a.designation, a.description, a.image_url, 'un', 1, 1, true, true, now()
  from acha_new a join public.b2b_families fam on fam.manufacturer_id = m and fam.name = a.family
  on conflict (manufacturer_id, reference) do nothing;

  insert into public.b2b_prices (product_id, list_price)
  select p.id, a.list_price from acha_new a join public.b2b_products p on p.manufacturer_id = m and p.reference = a.reference
  on conflict (product_id) do nothing;

  -- Expositores: a composição fica na descrição do artigo.
  update public.b2b_products p set description = o.note || '. ' || coalesce(p.description, '')
  from acha_offer o where p.manufacturer_id = m and p.reference = o.reference and o.note is not null
    and (o.reference like 'XP%' or o.reference = '45130') and position(o.note in coalesce(p.description, '')) = 0;

  delete from public.b2b_discount_rules where campaign_id = 'a0c4a2f6-2026-4f10-9d2a-0000000a2026';
  insert into public.b2b_discount_rules (client_id, manufacturer_id, product_id, discounts, special_net_price, active, valid_until, campaign_id, offer_qty)
  select null, m, p.id, '{}', o.net_price, true, '2027-01-31', 'a0c4a2f6-2026-4f10-9d2a-0000000a2026', o.offer_qty
  from acha_offer o join public.b2b_products p on p.manufacturer_id = m and p.reference = o.reference;

  if (select count(*) from public.b2b_discount_rules where campaign_id = 'a0c4a2f6-2026-4f10-9d2a-0000000a2026') <> (select count(*) from acha_offer) then
    raise exception 'Campanha ACHA: há artigos da oferta que não foram encontrados';
  end if;
end $$;

drop table acha_new;
drop table acha_offer;
