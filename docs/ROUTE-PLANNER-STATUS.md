# RF | Planeador de Rotas — estado de implementação

Atualizado em 20/10/2026. **Em desenvolvimento; não publicado e não aceite como concluído.**

## Base encontrada

CRM React 19/Vinext, API no servidor, Supabase Auth/Postgres/RLS. As visitas são atividades (`activities`), usadas também pela Agenda e pelos lembretes existentes. Os clientes pertencem a um comercial (`owner_id`). Não existiam coordenadas nem fornecedor de mapas configurado. O utilizador escolheu Google Maps e confirmou que ainda não existe projeto Google Cloud.

## Preparado nesta intervenção

- Separadores Histórico de Visitas / Planeador de Rotas em Visitas.
- Plano por comercial/semana, configuração de dias, horário, almoço, margem, limites, partida, chegada e custo/km.
- Carteira paginada e pesquisável, sem acesso à carteira de outro comercial.
- Paragens com estados distintos, bloqueio manual, objetivo, resultado e edição.
- Confirmação e realização sincronizadas com uma única atividade original; ligação de visitas já agendadas.
- Registos de revisão e controlo de concorrência; compromissos confirmados protegidos na aplicação de propostas.
- Motor de inserção por prioridade, restrições de tempo e matriz rodoviária. É uma heurística; não garante o ótimo global.
- Adaptador Google para geocodificação, matriz e polilinha; nunca substitui uma falha por distâncias em linha reta.
- Mapa Google preparado para posições validadas; agrupamento simples de posições próximas.
- Validação manual de coordenadas, auditoria e navegação externa.
- Acesso ao planeador a partir da ficha do cliente, seleção de contacto/oportunidade e criação de tarefa de seguimento pelo mecanismo existente.
- Polilinhas e comparação inicial/proposta preparadas no código, apenas para o mesmo conjunto de visitas e percursos válidos; ainda sem teste Google real.
- Sugestões e prioridade de inserção por oportunidades abertas, propostas pendentes (respeitando acesso beta), tarefas vencidas, prioridade A e frequência explicitamente definida. Ainda não cobre todos os critérios solicitados nem tem edição de pesos na interface.

## Base de dados

Migração `20261020214549_route_planner.sql` aplicada no Supabase:

- `clients.route_location`, `clients.visit_frequency_days`.
- `route_plans`, `route_stops`, `route_revisions`, com RLS.
- Triggers para auditoria e sincronização de atividades.
- RPC `route_apply_order`, com transação, revisão e proteção de compromissos.

Não foram criados clientes ou visitas comerciais reais. Os testes de integração foram executados dentro de transações revertidas. As tabelas de planos/paragens ficaram vazias após os testes.

## Validação efetuada

- 9 testes unitários do motor/adaptador: horários fixos, almoço, regresso, percurso ausente, semana, posições fixas, dados comerciais ausentes e respostas/falhas Google simuladas.
- 4 testes existentes Agenda/Dashboard: períodos, mudança de hora e correspondência de atividades do dia. Total da execução: 13 testes aprovados.
- TypeScript aprovado.
- Build completo aprovado; a compilação de fecho inclui também as últimas integrações de Clientes e Tarefas.
- Integração Supabase: confirmação cria atividade, realização atualiza a mesma atividade; repetir confirmação mantém uma única atividade; otimização não pode alterar hora confirmada.
- RLS: Lucia impedida de criar plano para outro comercial.
- Seguimento: duas atualizações da mesma próxima ação originaram uma única tarefa, com `has_time=false` e a data escolhida, dentro de transação revertida.
- Teste Google real efetuado em 20/10/2026: Geocoding OK, matriz de 4 elementos OK e percurso de teste no Porto com 935 m / 333 s e polilinha válida. Não realizados: browser autenticado do planeador, smartphone/PWA ou regressão funcional de todos os módulos.

## Pendências — não ocultar na entrega

1. Projeto Google Cloud configurado e APIs testadas (ver atualização abaixo). Falta aplicar a configuração num deployment do planeador, após concluir os requisitos pendentes; `ROUTE_MAPS_ENABLED=false` mantém o acesso desligado.
2. Concluir geocodificação na interface, aprovação de candidatos e política de cache/expiração compatível com os termos Google; correção no mapa e invalidação quando a morada muda.
3. Completar os critérios comerciais restantes (potencial quando disponível, limiares de valor, disponibilidade e proximidade explicada) e edição dos pesos na interface.
4. Validar percursos/ordem visual e comparação com Google real; completar apresentação diária e preparação resumida por visita.
5. Validar no browser os fluxos da ficha do cliente, contacto/oportunidade e tarefa de seguimento (base de dados do seguimento já testada).
6. Tratar reuniões/outros compromissos como intervalos bloqueados. Atualmente, compromissos da Agenda não incluídos no plano bloqueiam explicitamente a otimização.
7. Concluir filtros geográficos/fabricante/classificação, supervisão e indicadores agregados, notificações de alterações e execução mobile simplificada.
8. Testar permissões mais abrangentes, concorrência, falhas, fuso horário, dispositivos e regressão completa.
9. Rever a interface com o utilizador e obter autorização de publicação. O planeador não está disponível na versão pública.

## Configuração Google prevista

Não enviar chaves pelo chat. Configurar no ambiente do projeto, com a chave do servidor marcada como segredo:

- `GOOGLE_MAPS_SERVER_KEY`: Geocoding API e Routes API, com restrições adequadas.
- `GOOGLE_MAPS_BROWSER_KEY`: Maps JavaScript API, restrita aos domínios aprovados do CRM.
- `ROUTE_MAPS_ENABLED=true`: apenas depois de aprovação, configuração de quotas e validação.

## Google Cloud — configuração concluída em 20/10/2026

- Projeto `representacoes-freixo-crm`, faturação associada pelo proprietário e termos EEA aceites pelo próprio.
- Maps JavaScript API, Geocoding API e Routes API ativas com autorização explícita.
- Chave web `RF CRM - Mapa web`: apenas Maps JavaScript, referer `https://crm.representacoesfreixo.com/*`.
- Chave privada `RF CRM - Servidor rotas`: apenas Geocoding e Routes. Sem restrição de IP porque o alojamento não dispõe de IP de saída fixo validado; segredo exclusivamente server-side.
- Ambas guardadas como segredos em Sites, revisão de ambiente 9. Não gravadas no repositório ou em ficheiros. Revisão ainda não aplicada por deployment. Chamada Google feita apenas no teste técnico separado.
- Consola Google apresenta quotas Routes como não ajustáveis, incluindo limite diário ilimitado e botão Edit quota desativado. Não foi configurado um teto financeiro na Google nem alertas de orçamento.
- Migração `20261020225257_route_maps_usage_limits.sql` aplicada. Reservas atómicas exclusivamente server-side em `route_maps_usage`, RPC `route_reserve_maps_usage`; sem acesso anon/authenticated. Conta pedidos antes do envio, incluindo falhas, sem guardar moradas/coordenadas.
- Código do planeador reserva até 800 elementos de matriz/24 h e 8.000/31 dias; até 100 pedidos de geocodificação ou percurso/24 h e 1.000/31 dias por categoria, para toda a equipa. Recusa chamadas se contador indisponível. Proteção ainda não publicada, acompanhando o restante planeador.
- Limites locais não abrangem carregamentos do mapa no navegador ou utilizações externas das chaves; não constituem garantia de fatura zero. Partilhas da conta de faturação e futuras funcionalidades/SKUs podem alterar custos.
- Testes de limite diário, janela de 31 dias, validação de unidades e ausência de permissões do browser aprovados em transação revertida; TypeScript, 13 testes e build aprovados após esta alteração.

As matrizes estão limitadas a 20 localizações (até 400 elementos por pedido); não há reotimização automática a cada edição. Não foi ativada faturação nem efetuada qualquer chamada paga Google. Os custos concretos dependem do contrato/uso e devem ser confirmados na consola antes de ativar.

Documentação oficial consultada:
- https://developers.google.com/maps/documentation/routes/compute_route_matrix
- https://developers.google.com/maps/documentation/routes/policies
- https://developers.google.com/maps/documentation/geocoding/policies

## Publicação anterior concluída

Dashboard/Agenda publicado como versão 77, deployment `appgdep_6ad7dcf8bb4081919dcefa12416410d1`, em 20/10/2026. Commit `fc891213c7aacf666efedd9488e0ea937a1f6b11`. As alterações do planeador são posteriores e não fazem parte dessa publicação.
