-- Associações e grupos comerciais dos clientes.
-- Migração incremental: preserva integralmente is_cecofersa_member e todos os dados existentes.
begin;

alter table public.clients add column if not exists is_las_rias_member boolean not null default false;
alter table public.clients add column if not exists is_factor_pro_member boolean not null default false;
alter table public.clients add column if not exists is_big_mat_member boolean not null default false;
alter table public.clients add column if not exists is_industrial_pro_member boolean not null default false;

comment on column public.clients.is_las_rias_member is 'Sócio LAS RIAS';
comment on column public.clients.is_factor_pro_member is 'Sócio FACTOR PRO / El Sábio';
comment on column public.clients.is_big_mat_member is 'Sócio BIG MAT';
comment on column public.clients.is_industrial_pro_member is 'Sócio INDUSTRIAL PRO';

commit;
