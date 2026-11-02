# Correio — espelho do Outlook

A fonte da verdade é o Outlook. Esta versão não cria tabelas, não importa mensagens nem cria atividades na leitura. O envio existente permanece inalterado, incluindo os seus registos comerciais anteriores.

## API
- `GET /api/mail/list?folder=inbox|sentitems&q=texto&page=cursor`: 25 mensagens, `mensagens` e `nextPage`. Pesquisa Graph sem combinar `$orderby`; enviados ordenam por envio, entrada por receção. A página é um cursor opaco assinado, válido durante uma hora, ligado ao utilizador, caixa, pasta e pesquisa. O servidor segue o nextLink original.
- `GET /api/mail/message?id=...`: corpo completo da caixa da sessão, sem marcar como lido.
- `GET /api/mail/by-entity?email=...&email=...`: consulta participants (from/to/cc/bcc) de cada endereço, percorre páginas, elimina duplicados e ordena por data. Até 30 endereços. O Graph limita a pesquisa a 1.000 mensagens por endereço; `limited` e a interface avisam quando o limite é atingido.
- As duas antigas rotas de sincronização devolvem 410 e não fazem gravações.

Todas as consultas exigem JWT Supabase válido e perfil ativo. A caixa vem exclusivamente do email autenticado. Cache HTTP desativada. Matching usa apenas os registos acessíveis pelas políticas existentes: clientes não arquivados, contactos ativos, fabricantes e contactos ativos não eliminados. `general_email` é o campo real dos fabricantes. Endereços partilhados por entidades diferentes não são associados arbitrariamente; não são leads.

## Interface
Correio abre a Entrada ao vivo, permite Enviados, pesquisa, Atualizar e Carregar mais. A ficha do cliente tem a aba Emails, com endereço principal e contactos. O estado lido/não lido reflete a Microsoft. O corpo é apresentado numa iframe isolada, sem scripts, navegação, formulários nem carregamento de imagens externas. Nenhum conteúdo é guardado em localStorage ou Supabase.

## Configuração e legado
Usa as mesmas variáveis Microsoft e Supabase do envio. Mail.Read de aplicação requer consentimento administrativo. Não aplicar `supabase/mail-messages-migration.sql` para esta arquitetura: esse ficheiro e o teste SQL são apenas legado da versão anterior. Dados históricos anteriores ficam preservados e não são usados pelo novo Correio.

## Verificação
`node --test tests/mail-matching.test.mjs tests/mail-sync.test.mjs`
Cobrem autenticação, matching cliente/contacto/fabricante, leads, paginação assinada, pesquisa, corpo só de leitura, histórico multi-endereço e ausência de gravações. Compilar a aplicação e verificar Entrada/Enviados, corpo e aba Emails com uma sessão autorizada; comparar contagens de mensagens/atividades antes e depois. Não é necessário enviar novas mensagens para verificar conversas existentes.

## Etapa B — leitura completa e envio
O leitor pede CC, Reply-To e metadados de anexos. Procura CIDs mesmo quando `hasAttachments` é falso, carrega as imagens inline e substitui as referências por data URIs. Os anexos normais só são carregados ao descarregar. Conteúdo e ficheiros ficam apenas em memória durante a operação.

`GET /api/mail/attachment?messageId=...&attachmentId=...` devolve nome, tipo e bytes base64 do ficheiro da caixa autenticada. Anexos especiais do Outlook que não tenham contentBytes apresentam uma mensagem para os abrir no Outlook.

`POST /api/mail/reply` aceita messageId, mode, comment, to/cc/bcc (listas independentes), signatureVersion e attachments. Valida endereços e duplicados antes de contactar Graph. Com Mail.ReadWrite + Mail.Send, cria o rascunho nativo createReply/createReplyAll/createForward apenas no envio, preserva o fio e original, aplica os destinatários e HTML assinado, anexa ficheiros e envia. Nunca repete automaticamente um envio nem elimina um rascunho após falha; avisa para verificar Enviados/Rascunhos. BCC só é enviado na propriedade bccRecipients, nunca incluído no HTML ou no histórico CRM. Respostas e reencaminhamentos não gravam dados no Supabase.

O compositor permite chips editáveis em Para/CC/BCC, Enter/vírgula/ponto e vírgula, remoção e contactos disponíveis sob RLS. Os destinatários iniciais excluem o próprio endereço e os aliases disponibilizados pelo Graph. Quando as permissões da aplicação não permitem consultar proxyAddresses, a interface avisa que não pôde verificar aliases; não exige novas permissões nem inventa endereços próprios.

GET /api/mail/compose-context carrega a assinatura da sessão, os contactos e os aliases disponíveis. signatureOnly=1 consulta apenas a assinatura. Nome/email em falta usam explicitamente a identidade real do perfil/conta, com aviso; função, telefone, morada e QR ausentes não são inventados. Uma falha de leitura impede enviar antes de carregar a assinatura. O mesmo gerador é usado na pré-visualização e no servidor; o hash signatureVersion impede enviar uma assinatura alterada desde a abertura. As configurações guardadas dos utilizadores não são modificadas.

O botão Novo email reutiliza EmailComposer e `/api/send-email`, com assinatura atual e registo comercial do envio em `emails` e `email_recipients`; quando o destinatário corresponde a um cliente/contacto conhecido, mantém também a atividade de envio na ficha. Esta exceção aplica-se só a novas mensagens enviadas pela app, conforme o pedido do utilizador; leitura, respostas e reencaminhamentos continuam sem persistência no CRM. Nesta entrada e nas respostas, os anexos têm limite total de 2,5 MB (máximo de 20 nas respostas), para respeitar o pedido JSON direto de 4 MB sem alterar o mecanismo de anexos grandes do envio existente. O endpoint existente de envio e as outras entradas mantêm o funcionamento anterior.

HTML é sanitizado num template inerte e isolado numa iframe sem scripts, formulários ou navegação. A política de imagens começa por permitir apenas data URIs; o utilizador pode permitir HTTP(S) com Mostrar imagens externas, por mensagem, sem enviar referrer. Downloads usam URLs blob temporários com atributo download.

Verificação adicional: `node --test tests/mail-content.test.mjs tests/mail-actions.test.mjs`. Inclui inline-only, download autenticado, reply/replyAll/forward sem rascunhos, validação de anexos/tamanho real e falhas sem repetição.

Referências: [mensagem e hasAttachments](https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0), [reply](https://learn.microsoft.com/en-us/graph/api/message-reply?view=graph-rest-1.0), [replyAll](https://learn.microsoft.com/en-us/graph/api/message-replyall?view=graph-rest-1.0), [forward](https://learn.microsoft.com/en-us/graph/api/message-forward?view=graph-rest-1.0).

O antigo menu/Section Emails foi removido. A ligação /emails encaminha para /correio. O indicador Conta Microsoft 365 ligada / Ligação segura ativa passou para o topo do Correio. A ficha do cliente e o endpoint send-email permanecem intactos. Falhas no registo após um envio aceite geram aviso de registo incompleto e fecham o compositor, evitando um segundo envio.

## Eliminar e marcar como lido
Mail.ReadWrite de aplicação permite POST /api/mail/mark-read (apenas isRead:true) ao abrir e POST /api/mail/delete após confirmação. Ambas recebem messageId; a caixa vem da sessão. DELETE normal, sem permanentDelete, com proteção contra repetição para mensagens já em Itens Eliminados. Não há gravações no Supabase. A interface só retira a mensagem/deixa de usar negrito após sucesso do Graph; falhas mantêm a mensagem e apresentam aviso.

Verificação da correção de destinatários/assinatura: tests/mail-composition.test.mjs, tests/email-signature.test.mjs e restantes testes mail-*. Inclui configuração vazia da Lúcia com identidade verificada, snapshot de assinatura, arrays Para/CC/BCC e ausência de dados BCC no corpo.
