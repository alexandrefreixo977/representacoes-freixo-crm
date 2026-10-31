# Centro de Alertas — análise e decisões

## Arquitetura encontrada (03/10/2026)

- React 19, TypeScript e Vinext/Vite, publicado como Worker através de Sites. Navegação central em `app/page.tsx`.
- Supabase Auth (Microsoft), JWT validado no servidor e perfis ativos. PostgreSQL com RLS e Realtime.
- `tasks` existe, incluindo `due_at` e `reminder_at`, mas os registos atuais são sobretudo `activities.kind='task'`. A Agenda também usa `activities`. Não serão criadas cópias de tarefas/eventos.
- Agenda tem alterações Realtime. Badge antigo conta tarefas em memória e encaminha apenas para Tarefas.
- Uma PWA, um manifest e um service worker `/sw.js`, que guarda apenas recursos estáticos e evita dados autenticados/API. Sem infraestrutura Push, subscriptions, preferências, Edge Functions ou cron instalados.
- PostgreSQL disponibiliza pg_cron, pg_net e Vault. Vault já está instalado. O agendamento será no Supabase, sem depender do browser.
- Datas temporais em timestamptz; interface interpreta o fuso do navegador e usa ocasionalmente dias UTC. Não existe preferência de timezone. O trigger de follow-ups sem hora inventa atualmente 09:00.

## Decisões de implementação

- Um centro global, alimentado por referências aos registos originais. Tarefas das duas tabelas; compromissos planeados da Agenda (incluindo visitas já agendadas). Excluir emails e restantes fontes comerciais automáticas.
- Preferência IANA de timezone, distinção explícita de data sem hora, conversão consistente de hora civil para instante. Preservar instantes históricos; retirar a interpretação de hora aos follow-ups que só tinham data.
- Preferências, leituras e resumo diário por utilizador, separados do estado operacional da tarefa/evento. Ler um alerta não conclui o trabalho.
- Lembretes com múltiplas antecedências no modelo. Sem hora: alertas diários/in-app, sem inventar instante de push.
- Cron a cada minuto → materialização de ocorrências e Edge Function Web Push. Chaves privadas no Vault, apenas public VAPID no cliente. Subscriptions independentes por dispositivo.
- Unicidade por ocorrência/dispositivo, reserva atómica e revalidação da origem antes de enviar. Estratégia de no máximo uma tentativa quando o resultado é incerto: não repetir um push potencialmente entregue. Uma falha pode perder esse push, mas o item permanece no Centro de Alertas.
- Tolerância de cinco minutos para entrega. Horário silencioso suprime esse push, sem o adiar nem ocultar o alerta in-app. Não enviar mensagens temporais já desatualizadas.
- Uma única integração de push/notificationclick no service worker existente. Sem cache de mensagens, credenciais ou dados comerciais.
- Estado global com Realtime e relógio local; atualização de recuperação moderada apenas com página visível. Resumo diário e toasts reclamados atomicamente para não repetir entre separadores.

## Validação e publicação

### Dados e migrações

Três migrações: `notification_center`, `notification_scheduling` e `notification_occurrence_validation` (04/10/2026). Tabelas novas: `notification_preferences`, `push_subscriptions`, `notification_reads`, `notification_daily_views`, `notification_occurrences`, `notification_toast_receipts`, `notification_push_deliveries`. Campos acrescentados a `activities` e `tasks`: `has_time`, `due_date`, `schedule_timezone`, `reminder_offsets`. O campo legado `tasks.reminder_at` continua a ser interpretado quando não há offsets explícitos.

As views `notification_items` e `notification_schedule` são security-invoker. Não duplicam os registos operacionais. Apenas tarefas pendentes e compromissos planeados da Agenda originam alertas. Emails e fontes comerciais futuras estão excluídos.

### Interface e preferências

Sino global com contagem de assuntos pendentes (lido continua pendente), painel Atrasados/Hoje/Próximos, ações Ver/Concluir/Reagendar nas tarefas e Ver evento na Agenda. Reagendar também permite mudar o lembrete. Resumo diário reclamado uma vez por utilizador/dia, entre separadores e dispositivos. Toasts têm recibos únicos por ocorrência/utilizador.

Área pessoal > Notificações: ativação explícita por dispositivo, estados de suporte/permissão, preferências de app/push/tarefas/agenda/atrasados/resumo, fuso horário, horários silenciosos e antecedências predefinidas. Formulários de Tarefas e Agenda permitem antecedências rápidas, personalizadas e várias separadas por vírgulas (máximo oito, até 30 dias). Sem hora, não há push temporal. Preferências são guardadas no Supabase.

Uma única subscrição Realtime global para os alertas, debounce de mudanças, relógio local de 15 segundos e recuperação visível a cada cinco minutos. A consulta está limitada a 2.000 registos e o painel avisa quando atinge esse limite. Os grupos mostram até 200 itens, com indicação dos restantes.

### Push, scheduling e segurança

`pg_cron` chama `notification-dispatch` a cada minuto através de `pg_net`. Edge Function com verificação JWT e validação adicional da service-role. VAPID e credencial do cron estão no Vault. Chaves privadas nunca são devolvidas ao browser. O RPC de chave pública exige utilizador ativo e devolve só a chave pública. RPCs de preparação, reserva, configuração e chaves privadas são exclusivos de service-role.

Cada dispositivo tem uma subscription independente. RLS limita leitura e escrita ao próprio utilizador. Hosts de entrega são limitados aos fornecedores Google/Mozilla/Apple/Microsoft para evitar pedidos a destinos arbitrários. Respostas 404/410 desativam o dispositivo. A tabela de entregas é exclusivamente server-side: RLS sem política de cliente e privilégios de cliente revogados são intencionais.

Unicidade ocorrência/dispositivo e inserção atómica impedem duplicados em crons concorrentes. Antes de enviar, a função volta a verificar o registo, o horário, o lembrete, as preferências e o dispositivo. Alterações de preferências também invalidam ocorrências antigas. Tentativas com entrega incerta não são repetidas; ficam `unknown`. Esta escolha privilegia ausência de duplicados sobre repetição de uma entrega potencialmente perdida. Não é possível retirar um push já entregue antes de uma alteração posterior.

O SW existente mantém a política de cache apenas de recursos estáticos. Recebe `push`, rejeita eventos expirados/de outra conta e abre/foca a tarefa ou evento em `notificationclick`, apenas no mesmo domínio. Guarda somente o identificador da conta do dispositivo em IndexedDB; logout limpa esse marcador, fecha notificações e tenta desativar/cancelar a subscription. O manifest e o âmbito da PWA mantêm-se.

### Datas e exemplo pedido

Timezone IANA por utilizador, inicialmente detetado no browser; fallback legado Europe/Lisbon. `timestamptz` preserva instantes. `due_date` preserva dias sem hora. Temporal rejeita horas ambíguas ou inexistentes na mudança de horário. Follow-ups antigos baseados apenas numa data são tratados como sem hora. Agenda, lista de Tarefas, centro e push formatam no fuso escolhido.

Criado uma única vez o exemplo solicitado: Enviar condições comerciais, cliente Alexandre Freixo, 05/10/2026 às 10:00 Europe/Lisbon (09:00 UTC), lembrete 15 minutos antes. ID `189fe0e1-df3d-4261-bde8-5a530ec52198`.

### Testes executados antes da publicação

- TypeScript sem erros e build de produção concluído.
- 41 testes Node: 36 de regressão do Correio/assinaturas/envio e cinco conjuntos de alertas (fusos Lisboa/São Paulo, DST, atraso após a hora, dias sem hora, agenda passada/futura e todas as antecedências).
- Três testes adicionais do SW: apresentação, foco/link correto, rejeição de expiração/outra conta, URL externa bloqueada e logout.
- Teste transacional PostgreSQL, com rollback: todas as antecedências, cron repetido, dois dispositivos, lido diferente de concluído, reagendamento, conclusão, sem hora, alteração de preferências e cancelamento de Agenda. RLS e privilégios das funções de serviço verificados.
- Cron real devolveu HTTP 200 em execuções consecutivas. Ainda sem subscrições reais autorizadas nesse momento, logo `sent:0` não comprova entrega num dispositivo.

### Limitações e operação

Push depende de autorização do browser e do sistema operativo, ligação e suporte a execução em background. iOS/iPadOS requer uma web app no ecrã principal e versão compatível (16.4+). Encerrar/forçar paragem do browser ou restrições de bateria pode impedir ou atrasar entrega. Ver [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) e [Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API).

Não são necessários novos secrets manuais: foram configurados no Vault. Cada utilizador precisa de ativar notificações nos dispositivos pretendidos. Testes físicos de smartphone/PWA e entrega com browser fechado devem ser distinguidos de testes automatizados; não são presumidos como aprovados.

A auditoria Supabase também encontrou avisos anteriores ao projeto (RLS em opportunity_stages, funções legadas security-definer e proteção de palavras-passe). Não foram alterados nesta tarefa, incluindo os objetos de Comercial BETA. [Referência de auditoria](https://supabase.com/docs/guides/database/database-linter).
