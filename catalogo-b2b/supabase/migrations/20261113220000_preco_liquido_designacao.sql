-- "Preço neto" passa a "Preço líquido" (e "Preços netos" a "Preços líquidos") nos textos das campanhas (pedido do Alexandre, 13/11/2026).
update public.b2b_campaigns set
  title    = replace(replace(replace(replace(replace(replace(title,    'Preços netos', 'Preços líquidos'), 'preços netos', 'preços líquidos'), 'Preço neto', 'Preço líquido'), 'preço neto', 'preço líquido'), 'PREÇOS NETOS', 'PREÇOS LÍQUIDOS'), 'PREÇO NETO', 'PREÇO LÍQUIDO'),
  subtitle = replace(replace(replace(replace(replace(replace(subtitle, 'Preços netos', 'Preços líquidos'), 'preços netos', 'preços líquidos'), 'Preço neto', 'Preço líquido'), 'preço neto', 'preço líquido'), 'PREÇOS NETOS', 'PREÇOS LÍQUIDOS'), 'PREÇO NETO', 'PREÇO LÍQUIDO'),
  badge    = replace(replace(replace(replace(replace(replace(badge,    'Preços netos', 'Preços líquidos'), 'preços netos', 'preços líquidos'), 'Preço neto', 'Preço líquido'), 'preço neto', 'preço líquido'), 'PREÇOS NETOS', 'PREÇOS LÍQUIDOS'), 'PREÇO NETO', 'PREÇO LÍQUIDO'),
  details  = replace(replace(replace(replace(replace(replace(details,  'Preços netos', 'Preços líquidos'), 'preços netos', 'preços líquidos'), 'Preço neto', 'Preço líquido'), 'preço neto', 'preço líquido'), 'PREÇOS NETOS', 'PREÇOS LÍQUIDOS'), 'PREÇO NETO', 'PREÇO LÍQUIDO')
where concat_ws(' ', title, subtitle, badge, details) ~* 'pre[çc]os? netos?';
