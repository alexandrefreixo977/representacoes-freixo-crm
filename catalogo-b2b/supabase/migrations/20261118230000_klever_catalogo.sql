-- Catálogo KLEVER (tarifa de preços 2026: Klever, Tortoris, Scraperite, Kretzer, Knifeline; 79 artigos).
-- Gerado por data/build_klever.py — não editar à mão. Preço de tabela = preço da tarifa.
-- Grupo Equipamentos e consumíveis industriais (sort 270). Encomendas para info@kleverinnovations.es.

insert into public.b2b_manufacturers (name, slug, orders_email, sort, active, legal_name, address, country, phone, website)
values ('KLEVER', 'klever', 'info@kleverinnovations.es', 270, true, 'Klever Innovations Spain SLU',
  'C/ Esperança 23, 08330 Premià de Mar (Barcelona)', 'Espanha', '+34 935 132 320', 'www.kleverinnovations.es')
on conflict (slug) do update set orders_email = excluded.orders_email, sort = excluded.sort, active = true,
  legal_name = coalesce(public.b2b_manufacturers.legal_name, excluded.legal_name),
  address = coalesce(public.b2b_manufacturers.address, excluded.address),
  country = coalesce(public.b2b_manufacturers.country, excluded.country),
  phone = coalesce(public.b2b_manufacturers.phone, excluded.phone),
  website = coalesce(public.b2b_manufacturers.website, excluded.website);

create temp table klever_import (reference text, designation text, description text, family text,
  sales_unit text, pack_qty numeric, list_price numeric, is_new boolean);

insert into klever_import values
('KCJ-1-Y','KCJ-1-Y · Klever Kutter amarelo','Cutter de segurança compacto de lâmina protegida, amarelo.','Klever · Cutters de segurança compactos','un',10,2.75,false),
('KCJ-1MD','KCJ-1MD · Klever Kutter detetável (metal detectable)','Cutter de segurança compacto de lâmina protegida, detetável por detetores de metais (indústria alimentar).','Klever · Cutters de segurança compactos','un',10,4.1,false),
('KCJ-1-R','KCJ-1-R · Klever Kutter vermelho','Cutter de segurança compacto de lâmina protegida, vermelho.','Klever · Cutters de segurança compactos','un',10,2.75,false),
('KCJ-4-30','KCJ-4-30 · Klever Excel Single','Cutter de segurança compacto de lâmina protegida, lâmina simples.','Klever · Cutters de segurança compactos','un',10,4.02,false),
('KCJ-4-20','KCJ-4-20 · Klever Excel lâmina dupla','Cutter de segurança compacto de lâmina protegida, lâmina dupla.','Klever · Cutters de segurança compactos','un',10,3.91,false),
('PLS-400-30MD','PLS-400-30MD · Klever Excel Plus detetável (metal detectable)','Cutter de segurança compacto de lâmina protegida, detetável por detetores de metais.','Klever · Cutters de segurança compactos','un',10,6.33,false),
('KCJ-XC-30-Y','KCJ-XC-30-Y · Klever XChange Single','Cutter de segurança de cabeça intercambiável, lâmina simples. Cabeça de substituição: KCJ-XH-30.','Klever · Cutters de cabeça intercambiável (XChange)','un',12,10.0,false),
('KCJ-XC-20-Y','KCJ-XC-20-Y · Klever XChange lâmina dupla','Cutter de segurança de cabeça intercambiável, lâmina dupla. Cabeça de substituição: KCJ-XH-20.','Klever · Cutters de cabeça intercambiável (XChange)','un',12,9.75,false),
('PLS-200XC-20G','PLS-200XC-20G · Klever XChange Double PLUS','Cutter de cabeça intercambiável, lâmina dupla, cabeça com corta-cintas metálico. Cabeça de substituição: KCJ-XH-20.','Klever · Cutters de cabeça intercambiável (XChange)','un',12,9.35,false),
('PLS-200XC-30G','PLS-200XC-30G · Klever XChange Single PLUS','Cutter de cabeça intercambiável, cabeça com corta-cintas e raspador de etiquetas metálicos. Cabeça de substituição: KCJ-XH-35.','Klever · Cutters de cabeça intercambiável (XChange)','un',12,9.57,false),
('KCJ-1X','KCJ-1X · Klever Kutter Kleen™ (aço)','Cutter de segurança antibacteriano, lâmina de aço.','Klever · Cutters antibacterianos (Kleen)','un',10,3.41,false),
('KCJ-1XSS','KCJ-1XSS · Klever Kutter Kleen™ (inox)','Cutter de segurança antibacteriano, lâmina de aço inoxidável.','Klever · Cutters antibacterianos (Kleen)','un',10,3.41,false),
('DFC-364X','DFC-364X · Kleen™ cutter corta-filme','Cutter de segurança antibacteriano para cortar filme.','Klever · Cutters antibacterianos (Kleen)','un',10,3.58,false),
('EBC1X','EBC1X · Kleen™ cutter de lâmina oculta','Cutter de segurança antibacteriano de lâmina oculta.','Klever · Cutters antibacterianos (Kleen)','un',10,4.02,false),
('KCJ-XC-30X','KCJ-XC-30X · Kleen™ XChange Single Sided','Cutter antibacteriano de cabeça intercambiável, lâmina simples. Cabeça de substituição: KCJ-XH-30X.','Klever · Cutters antibacterianos (Kleen)','un',12,12.82,false),
('KCJ-XC-20X','KCJ-XC-20X · Kleen™ XChange lâmina dupla','Cutter antibacteriano de cabeça intercambiável, lâmina dupla. Cabeça de substituição: KCJ-XH-20X.','Klever · Cutters antibacterianos (Kleen)','un',12,12.65,false),
('KCJ-XH-20X','KCJ-XH-20X · Kleen™ XChange cabeça dupla','Cabeça de substituição antibacteriana, lâmina dupla, para Kleen™ XChange.','Klever · Cutters antibacterianos (Kleen)','un',25,1.38,false),
('KCJ-XH-30X','KCJ-XH-30X · Kleen™ XChange cabeça simples','Cabeça de substituição antibacteriana, lâmina simples, para Kleen™ XChange.','Klever · Cutters antibacterianos (Kleen)','un',12,1.49,false),
('KCJ-XH-35X','KCJ-XH-35X · Kleen™ XChange cabeça Multitask','Cabeça de substituição antibacteriana Multitask para Kleen™ XChange.','Klever · Cutters antibacterianos (Kleen)','un',12,1.54,false),
('KCJ-XH-30','KCJ-XH-30 · Klever XChange cabeça Single','Cabeça de substituição de lâmina simples para Klever XChange.','Klever · Cabeças de substituição','un',12,1.21,false),
('KCJ-XH-20','KCJ-XH-20 · Klever XChange cabeça dupla','Cabeça de substituição de lâmina dupla para Klever XChange.','Klever · Cabeças de substituição','un',25,1.16,false),
('KCJ-XH-35','KCJ-XH-35 · Klever XChange cabeça Multitask','Cabeça de substituição Multitask com raspador de etiquetas e corta-cintas.','Klever · Cabeças de substituição','un',12,1.49,false),
('ECO-200XC-20EX','ECO-200XC-20EX · Eco XChange lâmina dupla','Cutter de segurança de cabeça intercambiável, cabo 100% reciclado, lâmina dupla. Cabeça de substituição: KCJ-XH-20X. Novidade 2026.','Klever · Cutters de material reciclado (Eco XChange)','un',10,9.1,true),
('ECO-200XC-30EX','ECO-200XC-30EX · Eco XChange Single','Cutter de segurança de cabeça intercambiável, cabo 100% reciclado, lâmina simples. Cabeça de substituição: KCJ-XH-30X. Novidade 2026.','Klever · Cutters de material reciclado (Eco XChange)','un',10,9.4,true),
('ECO-200XC-35EX','ECO-200XC-35EX · Eco XChange Multitask','Cutter de segurança de cabeça intercambiável, cabo 100% reciclado, Multitask. Cabeça de substituição: KCJ-XH-35X. Novidade 2026.','Klever · Cutters de material reciclado (Eco XChange)','un',10,9.55,true),
('KeyB','KeyB · Keybak porta-chaves extensível','Porta-chaves extensível Keybak para prender o cutter.','Klever · Acessórios','un',1,28.8,false),
('CL-36','CL-36 · Cordão extensível porta-cutter','Cordão extensível para prender o cutter (guarda-cutter).','Klever · Acessórios','un',1,2.86,false),
('S10','S10 · Tortoris cutter ambidestro cabo de alumínio, lâmina ajustável 6–22 mm','Cutter semi-automático ambidestro, cabo de alumínio, comprimento de lâmina ajustável de 6 a 22 mm. Lâminas: 452TIN, B1-S.','Tortoris · Cutters de segurança retráteis','un',1,10.31,false),
('S10-CER','S10-CER · Tortoris cutter ambidestro cabo de alumínio, lâmina CERÂMICA 6–22 mm','Cutter semi-automático ambidestro, cabo de alumínio, lâmina cerâmica de comprimento ajustável de 6 a 22 mm. Lâmina: B1-CER.','Tortoris · Cutters de segurança retráteis','un',1,14.77,false),
('S11','S11 · Tortoris cutter ambidestro cabo de alumínio, lâmina 40 mm','Cutter semi-automático ambidestro, cabo de alumínio, lâmina de 40 mm. Lâmina: B3-S.','Tortoris · Cutters de segurança retráteis','un',1,11.25,false),
('S24','S24 · Tortoris cutter ambidestro cabo de plástico superleve','Cutter semi-automático ambidestro, cabo de plástico superleve, ativação por pressão. Lâminas: 452TIN, B1-S.','Tortoris · Cutters de segurança retráteis','un',1,8.33,false),
('ES44','ES44 · Tortoris cutter de retração automática','Cutter ambidestro de retração automática (a lâmina recolhe ao deixar de tocar a superfície de corte), cabo de plástico superleve e antiderrapante, ativação por pressão. Lâminas: 452TIN, B1-S.','Tortoris · Cutters de segurança retráteis','un',1,8.75,false),
('US53R','US53R · Tortoris cutter ergonómico dupla segurança, vermelho','Cutter compacto ambidestro e ergonómico: abre sem danificar a mercadoria e protege quem o usa. Personalizável com logótipo.','Tortoris · Cutters dupla segurança','un',10,2.45,false),
('US53N','US53N · Tortoris cutter ergonómico dupla segurança, preto','Cutter compacto ambidestro e ergonómico: abre sem danificar a mercadoria e protege quem o usa. Personalizável com logótipo.','Tortoris · Cutters dupla segurança','un',10,2.45,false),
('US53B','US53B · Tortoris cutter ergonómico dupla segurança, branco','Cutter compacto ambidestro e ergonómico: abre sem danificar a mercadoria e protege quem o usa. Personalizável com logótipo.','Tortoris · Cutters dupla segurança','un',10,2.45,false),
('US35','US35 · Tortoris cutter ambidestro de cabeça substituível (4 usos)','Cutter ambidestro de dupla segurança com cabeça substituível de 4 usos. Cabeças de substituição: C-105.','Tortoris · Cutters dupla segurança','un',10,12.32,false),
('C-105','C-105 · Tortoris cabeças de substituição para US35','Cabeças de substituição para o cutter US35.','Tortoris · Cutters dupla segurança','un',10,3.37,false),
('452TIN','452TIN · Lâmina de substituição em titânio (caixa de 10)','Lâmina All fit em titânio, 53 x 19 mm / 0,63 mm, para S10, S24 e ES44. Caixa de 10.','Tortoris · Lâminas de substituição','cx',1,4.58,false),
('B1-S','B1-S · Lâmina serrilhada de substituição (caixa de 10)','Lâmina serrilhada para S10, S24 e ES44. Caixa de 10.','Tortoris · Lâminas de substituição','cx',1,4.58,false),
('B3-S','B3-S · Lâmina serrilhada longa de substituição (caixa de 10)','Lâmina serrilhada longa para S11. Caixa de 10.','Tortoris · Lâminas de substituição','cx',1,5.21,false),
('B1-CER','B1-CER · Lâmina CERÂMICA de substituição (caixa de 5)','Lâmina cerâmica para S10-CER. Caixa de 5.','Tortoris · Lâminas de substituição','cx',1,14.77,false),
('SRT33GPO','SRT33GPO · Scraperite raspador de cabo longo com 6 lâminas plásticas','Raspador de cabo longo com 6 lâminas de plástico de substituição (3 retas e 3 curvas). Raspa sem danificar.','Scraperite · Raspadores de lâmina plástica','un',12,9.5,false),
('SRTD6GPO','SRTD6GPO · Scraperite raspador pequeno com 6 lâminas plásticas','Raspador pequeno com 6 lâminas retas de plástico de substituição. Raspa sem danificar.','Scraperite · Raspadores de lâmina plástica','un',12,7.9,false),
('SRTW6GPO','SRTW6GPO · Scraperite raspador largo com 6 lâminas plásticas','Raspador largo com 6 lâminas retas de plástico de substituição. Raspa sem danificar.','Scraperite · Raspadores de lâmina plástica','un',12,13.12,false),
('SRWGPO','SRWGPO · Scraperite raspador largo','Raspador largo de lâmina plástica. Raspa sem danificar.','Scraperite · Raspadores de lâmina plástica','un',12,4.4,false),
('SRS30GPO','SRS30GPO · Scraperite lâmina plástica laranja, macia (caixa de 25)','Lâmina de substituição de plástico laranja (macia). Caixa de 25.','Scraperite · Lâminas plásticas de substituição','cx',1,7.07,false),
('SRS100HYL','SRS100HYL · Scraperite lâmina plástica amarela, dura (caixa de 100)','Lâmina de substituição de plástico amarelo (dura). Caixa de 100.','Scraperite · Lâminas plásticas de substituição','cx',1,18.3,false),
('SRS30MBL','SRS30MBL · Scraperite lâmina plástica azul, cloro e ambientes marinhos (caixa de 30)','Lâmina de substituição de plástico azul, resistente ao cloro e a ambientes marinhos. Caixa de 30.','Scraperite · Lâminas plásticas de substituição','cx',1,7.65,false),
('SRS100BIN','SRS100BIN · Scraperite lâmina plástica preta, industrial (caixa de 100)','Lâmina de substituição de plástico preto (industrial). Caixa de 100.','Scraperite · Lâminas plásticas de substituição','cx',1,22.15,false),
('SRS30PRO','SRS30PRO · Scraperite lâmina plástica magenta, resistência química (caixa de 30)','Lâmina de substituição de plástico magenta (resistência química). Caixa de 30.','Scraperite · Lâminas plásticas de substituição','cx',1,8.24,false),
('SRW25GPO','SRW25GPO · Scraperite lâmina plástica larga laranja, macia (caixa de 25)','Lâmina larga de substituição de plástico laranja (macia). Caixa de 25.','Scraperite · Lâminas plásticas de substituição','cx',1,8.05,false),
('SRW25BIN','SRW25BIN · Scraperite lâmina plástica larga preta, industrial (caixa de 25)','Lâmina larga de substituição de plástico preto (industrial). Caixa de 25.','Scraperite · Lâminas plásticas de substituição','cx',1,13.25,false),
('753225','753225 · Kretzer tesoura de segurança Safecut 10" / 25 cm','Tesoura de segurança Kretzer Solingen Safecut, 10" / 25 cm, dedos protegidos.','Kretzer · Tesouras de segurança','un',10,50.88,false),
('752020','752020 · Kretzer tesoura de segurança Safecut 8" / 20 cm','Tesoura de segurança Kretzer Solingen Safecut, 8" / 20 cm, dedos protegidos.','Kretzer · Tesouras de segurança','un',10,27.04,false),
('752015','752015 · Kretzer tesoura de segurança Safecut 6" / 15 cm','Tesoura de segurança Kretzer Solingen Safecut, 6" / 15 cm, dedos protegidos.','Kretzer · Tesouras de segurança','un',10,23.95,false),
('782613','782613 · Kretzer tesoura de segurança Safecut 5" / 13 cm','Tesoura de segurança Kretzer Solingen Safecut, 5" / 13 cm, dedos protegidos.','Kretzer · Tesouras de segurança','un',10,13.65,false),
('753020','753020 · Kretzer tesoura de segurança Safecut 8" / 20 cm (753020)','Tesoura de segurança Kretzer Solingen Safecut, 8" / 20 cm, dedos protegidos.','Kretzer · Tesouras de segurança','un',10,34.45,false),
('774525','774525 · Kretzer tesoura de segurança Finny 10" / 25 cm','Tesoura de segurança Kretzer Solingen Finny, 10" / 25 cm, dedos protegidos.','Kretzer · Tesouras de segurança','un',10,61.39,false),
('773224','773224 · Kretzer tesoura de segurança Finny 9,5" / 24 cm','Tesoura de segurança Kretzer Solingen Finny, 9,5" / 24 cm, dedos protegidos.','Kretzer · Tesouras de segurança','un',10,48.26,false),
('772015','772015 · Kretzer tesoura de segurança Finny 6" / 15 cm','Tesoura de segurança Kretzer Solingen Finny, 6" / 15 cm, dedos protegidos.','Kretzer · Tesouras de segurança','un',10,22.76,false),
('772020','772020 · Kretzer tesoura de segurança Finny 8" / 20 cm','Tesoura de segurança Kretzer Solingen Finny, 8" / 20 cm, dedos protegidos.','Kretzer · Tesouras de segurança','un',10,25.44,false),
('773020','773020 · Kretzer tesoura de segurança Finny 8" / 20 cm (773020)','Tesoura de segurança Kretzer Solingen Finny, 8" / 20 cm, dedos protegidos.','Kretzer · Tesouras de segurança','un',10,31.67,false),
('H914.04','H914.04 · Knifeline cutter Sterling lâmina longa 40 mm','Cutter de segurança semi-automático Sterling, lâmina longa de 40 mm. Lâmina de substituição: 207.960.','Knifeline · Cutters de segurança retráteis','un',1,14.89,false),
('5044MD','5044MD · Knifeline cutter Multicut detetável (metal detectable)','Cutter de segurança semi-automático Multicut, detetável por detetores de metais. Lâmina de substituição: KL445INOX.','Knifeline · Cutters de segurança retráteis','un',10,4.8,false),
('AS100','AS100 · Knifeline cutter Auto-Retract','Cutter de segurança automático: a lâmina recolhe ao deixar de tocar a superfície de corte. Lâmina de substituição: AS-100 10.','Knifeline · Cutters de segurança retráteis','un',1,29.95,false),
('KL00110CER','KL00110CER · Knifeline cutter Longcut lâmina CERÂMICA','Cutter de segurança automático Longcut com lâmina cerâmica. Lâminas de substituição: 10526, 10528.','Knifeline · Cutters de segurança retráteis','un',10,28.2,false),
('207.960','207.960 · Knifeline lâmina 109,6 x 18 mm / 0,50 mm (caixa de 10)','Lâmina de substituição 109,6 x 18 mm / 0,50 mm, para H914.04. Caixa de 10.','Knifeline · Lâminas de substituição','cx',1,5.0,false),
('KL445INOX','KL445INOX · Knifeline lâmina de aço inoxidável (caixa de 10)','Lâmina de substituição em aço inoxidável, para 5044MD. Caixa de 10.','Knifeline · Lâminas de substituição','cx',1,5.25,false),
('AS-100 10','AS-100 10 · Knifeline lâmina para Auto-Retract AS100 (caixa de 10)','Lâmina de substituição para o cutter AS100. Caixa de 10.','Knifeline · Lâminas de substituição','cx',1,7.95,false),
('10526','10526 · Knifeline lâmina cerâmica ponta arredondada (caixa de 3)','Lâmina cerâmica de substituição, ponta arredondada, para KL00110CER. Caixa de 3.','Knifeline · Lâminas de substituição','cx',1,26.51,false),
('10528','10528 · Knifeline lâmina cerâmica (caixa de 3)','Lâmina cerâmica de substituição, para KL00110CER. Caixa de 3.','Knifeline · Lâminas de substituição','cx',1,26.51,false),
('C109-MD','C109-MD · Knifeline cutter cabeça de aço detetável','Cutter de segurança compacto para a indústria alimentar, detetável por detetores de metais (incluindo as peças mais pequenas).','Knifeline · Cutters detetáveis para alimentação','un',10,5.95,false),
('C103-MD','C103-MD · Knifeline cutter detetável','Cutter de segurança compacto para a indústria alimentar, detetável por detetores de metais (incluindo as peças mais pequenas).','Knifeline · Cutters detetáveis para alimentação','un',10,3.92,false),
('X7070 MDP','X7070 MDP · Knifeline cutter cabeça substituível detetável','Cutter de cabeça substituível para a indústria alimentar, detetável por detetores de metais. Cabeça de substituição: H10010.','Knifeline · Cutters detetáveis para alimentação','un',10,16.5,false),
('X6040 MDP','X6040 MDP · Knifeline cutter lâmina longa 40 mm detetável','Cutter semi-automático de lâmina longa (40 mm) para a indústria alimentar, detetável por detetores de metais. Lâmina de substituição: H10008-B3.','Knifeline · Cutters detetáveis para alimentação','un',10,14.89,false),
('X6060 MDP','X6060 MDP · Knifeline cutter lâmina ajustável 13–16 mm detetável','Cutter semi-automático de lâmina ajustável 13–16 mm para a indústria alimentar, detetável por detetores de metais. Lâmina de substituição: 19.TIN.452.','Knifeline · Cutters detetáveis para alimentação','un',10,4.8,false),
('H10008-B3','H10008-B3 · Knifeline lâmina de substituição para X6040 MDP (caixa de 10)','Lâmina de substituição para X6040 MDP. Caixa de 10.','Knifeline · Lâminas e cabeças para cutters detetáveis','cx',1,5.2,false),
('19.TIN.452','19.TIN.452 · Knifeline lâmina de titânio para X6060 MDP (caixa de 10)','Lâmina de substituição em titânio para X6060 MDP. Caixa de 10.','Knifeline · Lâminas e cabeças para cutters detetáveis','cx',1,5.1,false),
('H10010','H10010 · Knifeline cabeça de substituição para X7070 MDP (caixa de 10)','Cabeça de substituição para X7070 MDP. Caixa de 10.','Knifeline · Lâminas e cabeças para cutters detetáveis','cx',1,16.46,false);

do $$
declare m uuid := (select id from public.b2b_manufacturers where slug = 'klever');
begin
  insert into public.b2b_families (manufacturer_id, name)
  select distinct m, family from klever_import
  on conflict (manufacturer_id, name) do nothing;

  insert into public.b2b_products (manufacturer_id, family_id, reference, designation, description,
    sales_unit, pack_qty, moq, is_new, active, updated_at)
  select m, fam.id, a.reference, a.designation, a.description, a.sales_unit, a.pack_qty, a.pack_qty, a.is_new, true, now()
  from klever_import a join public.b2b_families fam on fam.manufacturer_id = m and fam.name = a.family
  on conflict (manufacturer_id, reference) do update set
    designation = excluded.designation, description = excluded.description, sales_unit = excluded.sales_unit,
    pack_qty = excluded.pack_qty, moq = excluded.moq, is_new = excluded.is_new,
    family_id = excluded.family_id, active = true, updated_at = now();

  insert into public.b2b_prices (product_id, list_price)
  select p.id, a.list_price from klever_import a
  join public.b2b_products p on p.manufacturer_id = m and p.reference = a.reference
  on conflict (product_id) do update set list_price = excluded.list_price, updated_at = now();
end $$;

drop table klever_import;
