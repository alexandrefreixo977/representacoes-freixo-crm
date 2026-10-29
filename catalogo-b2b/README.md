# Catálogo B2B · Representações Freixo

Loja de encomendas online para revendedores: catálogo por fabricante, preços de tabela com os descontos de cada
cliente, carrinho com vários fabricantes e divisão automática numa encomenda por fabricante.
App **separada do CRM** (pasta própria, base de dados com tabelas `b2b_*`), desenhada para ser integrada no CRM mais tarde.

## O que faz

**Público (sem login)**
- Catálogo com separadores por fabricante, banner de campanhas, pesquisa (referência, EAN, designação, marca) e filtros por família / novidades.
- Fichas de artigo com referência, embalagem, encomenda mínima, descrição e ficha técnica. **Sem preços.**
- Formulário "Pedir acesso" para novos revendedores.

**Cliente (com login)**
- Vê o preço de tabela, o desconto que tem atribuído (ex.: 35% + 5%) ou o preço líquido especial, e o preço final.
- Quantidades sempre em caixas completas.
- **Encomenda rápida**: cola uma lista "referência quantidade" (ou EAN) e vai tudo para o carrinho.
- Carrinho multifabricante → ao confirmar cria uma encomenda por fabricante, em estado **A validar**.
- Histórico de encomendas com estado e botão "Repetir encomenda".

**Gestão Freixo**
- Encomendas por estado: A validar → Validada → Enviada ao fabricante → Confirmada → Entregue (ou Cancelada), com nota interna.
- "Preparar email ao fabricante" (abre o Outlook com a encomenda) e "Imprimir / PDF".
- Importar tabelas de preços em Excel (.xlsx/.csv): deteta as colunas (PT/EN/ES), mostra pré-visualização, atualiza por referência e cria artigos novos.
- Clientes e descontos: regras por fabricante, família ou artigo; descontos sucessivos ou preço líquido especial; convite de acesso por email.
- Pedidos de acesso recebidos.

### Como se escolhe o desconto
Ganha a regra mais específica: **artigo > família > fabricante**. No mesmo nível, a regra do cliente ganha à regra geral.
Os preços são sempre recalculados no servidor quando a encomenda é submetida (`b2b_submit_order`), nunca se confia no browser.

## Experimentar (modo demonstração)

```bash
npm install
npm run dev
```

Sem variáveis do Supabase a app arranca em **modo demonstração**, com dados fictícios guardados no browser:
- Cliente: `cliente@demo.pt` / `demo`
- Gestão: `gestao@demo.pt` / `demo`

Testes: `npm test` · Build: `npm run build` (gera `dist/`).

## Pôr em produção

1. **Base de dados**: num projeto Supabase (pode ser o do CRM, as tabelas têm prefixo `b2b_`), correr `supabase/schema.sql` no SQL Editor.
2. **Primeiro administrador**: criar o utilizador em Authentication → Users e correr o `insert` que está no fim do `schema.sql`.
3. **Funções** (Supabase CLI): `supabase functions deploy notify-order` e `supabase functions deploy invite-client`, com os segredos:
   - `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`: aplicação Microsoft 365 com permissão `Mail.Send` (aplicação);
   - `MAIL_FROM` (ex.: caixa que envia), `NOTIFY_TO` (quem recebe as encomendas, separados por vírgula), `APP_URL` (endereço da loja).
4. **Site**: copiar `.env.example` para `.env` com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`, `npm run build` e publicar a pasta `dist/`
   (Cloudflare Pages, Netlify ou outro alojamento estático). Em Authentication → URL Configuration, pôr o endereço da loja como Site URL.
5. **Dados**: criar fabricantes (tabela `b2b_manufacturers`, com o email de encomendas), importar as tabelas em Excel na área de gestão,
   criar clientes, atribuir descontos e enviar convites.

## Estrutura

```
src/pricing.ts        descontos, escolha da regra, caixas, divisão por fabricante, encomenda rápida
src/importer.ts       leitura e mapeamento de tabelas Excel/CSV
src/data/             api.ts (contrato), demo-api.ts (browser), supabase-api.ts (produção)
src/pages/            Catálogo, Encomenda rápida, Carrinho, Encomendas, Conta, Gestão
supabase/schema.sql   tabelas, regras de segurança (RLS) e funções de encomenda e importação
supabase/functions/   notify-order (emails) e invite-client (convites)
```

## Integração futura com o CRM
A estrutura segue a do catálogo beta do CRM (`catalog_products`, `catalog_price_list_items`, `catalog_commercial_rules`,
`catalog_orders`). Para juntar: mapear `b2b_clients` → `clients`, `b2b_manufacturers` → `manufacturers`, e as encomendas validadas
passam a aparecer no dossier do cliente no CRM.
