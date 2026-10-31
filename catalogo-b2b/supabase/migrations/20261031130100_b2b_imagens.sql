-- Fotos dos artigos carregadas na gestão (Gestão › Artigos): bucket público "b2b-imagens".
-- Toda a gente lê (são as fotos da loja); só a gestão carrega, troca ou apaga.
-- Fica protegido para bases de dados sem Storage (testes locais).

do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'Sem Storage: bucket de imagens não criado';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('b2b-imagens', 'b2b-imagens', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists b2b_imagens_admin_insert on storage.objects';
  execute 'drop policy if exists b2b_imagens_admin_update on storage.objects';
  execute 'drop policy if exists b2b_imagens_admin_delete on storage.objects';
  execute $p$create policy b2b_imagens_admin_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'b2b-imagens' and public.b2b_is_admin())$p$;
  execute $p$create policy b2b_imagens_admin_update on storage.objects for update to authenticated
    using (bucket_id = 'b2b-imagens' and public.b2b_is_admin()) with check (bucket_id = 'b2b-imagens' and public.b2b_is_admin())$p$;
  execute $p$create policy b2b_imagens_admin_delete on storage.objects for delete to authenticated
    using (bucket_id = 'b2b-imagens' and public.b2b_is_admin())$p$;
exception when insufficient_privilege then
  raise warning 'Sem permissão para configurar o Storage: crie o bucket b2b-imagens no painel do Supabase';
end $$;
