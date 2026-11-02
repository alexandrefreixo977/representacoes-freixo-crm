# ACHA — auditoria e decisões (08/10/2026)

## Encontrado antes de alterar

- Produção v69; React 19/Vinext/Vite, Supabase Auth/JWT e RLS.
- Catálogo em `app/catalogo-beta/page.tsx`; tabelas catalog_products, catalog_product_variants, catalog_product_families, catalog_price_lists/items e catalog_commercial_rules. Dez produtos: cinco fixtures antigas e cinco grupos reais de flexómetros. Não apagar fixtures nem histórico.
- Orçamentos já distinguem-se de encomendas em catalog_orders/document_type. Linhas em catalog_order_lines; referências e preços ficam em snapshot. Reutilizar estas tabelas.
- Oportunidades e leads persistentes, client.is_lead, tarefa lead_profile, ligação opportunity_id e conversão transacional já existem.
- send-email usa Graph e assinatura verificada. Reutilizar autenticação, assinatura e transporte. Não existe gerador de PDF comercial.
- COMPANY_EMAIL_CONFIG centraliza website, mas não há configuração corporativa persistida. Não inventar morada, NIF ou telefone.
- `has_catalog_orders_beta_access()` exige flag catalog_orders_beta ativa e perfil ativo. Existe uma lista crm_feature_access antiga que a função atual não consulta; preservar a regra efetiva, sem alargar acesso. Importação/alteração permanente de preços e validação: administrador. Descontos por linha: acesso comercial existente; alteração direta de preço líquido: administrador.
- Falta circuito de aprovação/PDF imutável, arquivo de versões, envio com exclusão mútua e administração/importação.

## Decisões

1. Acrescentar estados de trabalho aos documentos existentes, preservando os estados legados para Oportunidades.
2. PDFs aprovados serão versões imutáveis ligadas ao documento e ao envio. Revisão cria novo documento identificado; não altera PDF enviado.
3. Alterações comerciais recalculadas no PostgreSQL numeric; frontend usa Decimal. Portes desconhecidos e IVA por determinar são explícitos.
4. Envio exige confirmação; reserva única server-side por versão, anexo obtido da versão aprovada, destinatário de encomendas fixo na configuração corporativa. Aceitação Graph não significa entrega. Falha ambígua bloqueia repetição até reconciliação.
5. Reutilizar catálogo/cartão/seleção de variantes e EmailComposer, acrescentando listas comerciais e grelha de edição.
6. Importação ACHA com pré-visualização, validação de referências/preços, hash de fonte e relatório. Reimportação idempotente e histórico de preços preservado. Dados duvidosos ficam excluídos e identificados.

## Fonte de importação

PDF fornecido pelo utilizador: ACHA - CATÁLOGO TARIFA 2025.pdf, 244 páginas, SHA-256 `20f1fabb2bb418002d60f8c51b37073afd1c7be13a492943ed6747b3f269aba4`.

Importação real concluída em 30 lotes: 7.037 referências oficiais com preço, 7.026 produtos e 16 variantes existentes. Reimportação executada sem duplicados. Página 10 incluída numa revisão adicional: 20 referências, das quais oito variantes já existentes; 12 produtos novos. Nenhum outro fabricante importado.

## Implementação entregue

- Catálogo com pesquisa paginada, cartões/lista, variantes existentes, carrinho e rascunhos editáveis.
- Orçamentos e encomendas reutilizam catalog_orders/lines; revisões, anulação com motivo, numeração concorrente e conversão idempotente.
- Lead rápido reutiliza clients/contactos e tarefa sem data inventada; associação opcional a oportunidade.
- PDFs A4 com logótipo oficial, fonte Unicode, cabeçalhos repetidos e versões aprovadas imutáveis.
- Envio Graph com assinatura, PDF aprovado e confirmação; encomendas destinadas a comercial@representacoesfreixo.com. Reserva única bloqueia duplo envio e resultados ambíguos.
- Configuração central commercial_company, importação CSV/XLSX/JSON validado, pré-visualização editável, lotes idempotentes e histórico.
- Migrações: 20261008215104, 20261009090447, 20261009142418 e 20261010134328. Novas tabelas: commercial_company, catalog_document_versions, catalog_document_events, catalog_send_attempts, catalog_import_runs. Restantes estruturas reutilizadas.
- Autorização beta existente preservada; importação/preços permanentes e validação reservados à administração; RLS e funções de envio apenas server-side.

## Evidência e limites

- 61 testes automáticos passaram: descontos, importação, PDF, envio simulado, correio, assinaturas, notificações e service worker.
- Integração SQL transacional testa lead, preços oficiais, descontos, proteção, aprovação, reserva de envio, conversão e revisões; rollback não envia emails reais.
- PDF de 60 artigos: seis páginas, 60 referências, cabeçalhos repetidos, bytes estáveis e inspeção visual da primeira/última página.
- 5 produtos possuem imagens; 7.021 usam placeholder. Não foram inventadas imagens, EAN ou embalagens. Referências novas são artigos individuais; agrupamento adicional de variantes requer validação técnica.
- Tabela oficial 2025. Não significa confirmação de vigência comercial em 2026. Sem data final inventada.
- Dados oficiais por configurar: designação legal, morada, NIF/NIPC e telefone. PDFs sinalizam ausência e não inventam valores.
- Extração PDF reutilizável: instalar pdfplumber e pypdf; executar scripts/extract-acha.py com PDF e pasta de saída, depois scripts/validate-acha.py com a pasta. Rever relatório e carregar catalog-import.json na administração. A interface não extrai PDFs arbitrários diretamente.
- Testes reais de entrega, QA completa mobile e regressão visual de todas as áreas não estão comprovados neste relatório. Aceitação Graph não é confirmação de entrega.
