-- Ligação ao CRM: cada cliente da loja aponta para o cliente correspondente no CRM (uma só base de clientes).
alter table public.b2b_clients add column if not exists crm_client_id uuid;
create unique index if not exists b2b_clients_crm_client on public.b2b_clients(crm_client_id) where crm_client_id is not null;
