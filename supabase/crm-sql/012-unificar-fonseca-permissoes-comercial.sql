-- 10/11/2026
-- 1) Perfil comercial (Lúcia): pode editar a ficha e os contactos dos clientes atribuídos a si.
--    As regras de acesso continuam a limitar cada comercial aos seus próprios clientes.
insert into public.role_permissions(role, permission, allowed)
values ('commercial', 'clients.edit', true), ('commercial', 'contacts.manage', true)
on conflict (role, permission) do update set allowed = true;

-- 2) Casa Fonseca: fica CLI0055 (tem NIF, contacto e fabricantes); sai CLI0346 (António Silva Domingues),
--    cujo nome passa a nome legal da ficha que fica.
select jsonb_build_object('unificar', public.crm_merge_clients('CLI0055', 'CLI0346'),
  'permissoes', (select jsonb_object_agg(permission, allowed) from public.role_permissions where role = 'commercial')) as resultado;
