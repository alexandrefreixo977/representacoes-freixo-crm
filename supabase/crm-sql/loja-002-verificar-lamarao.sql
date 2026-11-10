-- Loja B2B: há cliente da loja ligado a algum dos dois registos do CRM? (só contagens)
select count(*) filter (where crm_client_id is not null) as ligados_ao_crm,
       count(*) as clientes_lamarao
  from public.b2b_clients where name ilike '%lamar%rocha%' or name ilike '%LR Ferramentas%';
