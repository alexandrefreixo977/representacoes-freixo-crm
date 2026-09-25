# Freixo CRM — arquitetura do MVP

Aplicação Next.js/TypeScript com PostgreSQL no Supabase. O ficheiro `supabase/schema.sql` contém o núcleo relacional, índices e políticas RLS. A autenticação deverá usar Microsoft 365 federado através do Supabase Auth; o envio de email usa Microsoft Graph OAuth 2.0 e permanece em modo de demonstração enquanto não existirem credenciais aprovadas.

## Limites de segurança

- A interface nunca decide sozinha se um utilizador pode ler ou alterar um registo.
- As políticas RLS isolam vendedores e dão visibilidade global apenas a gestores e administradores.
- A service role é exclusiva do servidor e nunca é exposta ao browser.
- Visitas concluídas e alterações críticas geram eventos de auditoria; os registos comerciais usam arquivo lógico.
- Tokens Microsoft devem ser cifrados e renovados no servidor. Nenhuma password Microsoft é armazenada.

## Próximas ligações externas

1. Criar projeto Supabase numa região da União Europeia e aplicar `supabase/schema.sql`.
2. Configurar o fornecedor Microsoft/Azure no Supabase Auth.
3. Registar uma aplicação no Microsoft Entra ID para o Graph e autorizar `Mail.Send`, `User.Read` e `offline_access`.
4. Preencher as variáveis de ambiente no alojamento; manter `EMAIL_DEMO_MODE=true` até aprovação de um teste controlado.
