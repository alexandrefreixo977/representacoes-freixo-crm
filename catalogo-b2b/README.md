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

### Como se escolhe o desconto (regra confirmada pelo Alexandre a 29/10/2026)
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

Tudo é publicado automaticamente pelo GitHub Actions (`.github/workflows/catalogo-b2b.yml`) sempre que há alterações
no ramo `main`: testes → base de dados (migrações) → funções de email → site. As contas ficam em nome da
Representações Freixo; o Claude gere o código e as publicações através do repositório.

Endereço previsto: **https://encomendas.representacoesfreixo.com** (subdomínio; o site institucional em www fica como está).

### Configuração inicial (uma vez)
1. **Supabase** (base de dados e logins): criar conta e um projeto novo, região Europa (ex.: Frankfurt).
2. **Cloudflare** (alojamento do site): criar conta gratuita e um token de API com permissão *Cloudflare Pages: Edit*.
3. **GitHub → Settings → Secrets and variables → Actions**, só 3 segredos:
   `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` e `CLOUDFLARE_API_TOKEN`.
   O projeto, o endereço, as chaves públicas e a conta Cloudflare são descobertos por `scripts/resolve-config.sh`,
   que também verifica as chaves em cada PR (resultado no resumo da execução "Catálogo B2B").
   Para o email (passo posterior): segredos `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` (aplicação Microsoft 365
   com permissão `Mail.Send`) e variáveis `MAIL_FROM`, `NOTIFY_TO`.
4. **Domínio**: no Cloudflare Pages → projeto `freixo-b2b` → Custom domains, juntar `encomendas.representacoesfreixo.com`
   e criar o registo CNAME indicado no fornecedor do domínio.
5. **Supabase → Authentication → URL Configuration**: Site URL = endereço da loja.
6. **Primeiro administrador**: criar o utilizador em Authentication → Users e correr no SQL Editor o `insert` que está no fim
   de `supabase/migrations/20261029000000_b2b_schema.sql`.

Depois disto, cada alteração aprovada no GitHub fica online em poucos minutos. Sem os segredos, o workflow só corre os testes.

### Dados
Criar fabricantes (tabela `b2b_manufacturers`, com o email de encomendas), importar as tabelas Excel na área de gestão,
criar clientes, atribuir descontos e enviar convites.

### Publicar à mão (alternativa)
`supabase db push`, `supabase functions deploy notify-order invite-client`, `npm run build` com o `.env` preenchido
(ver `.env.example`) e publicar a pasta `dist/` em qualquer alojamento estático.

## Estrutura

```
src/pricing.ts        descontos, escolha da regra, caixas, divisão por fabricante, encomenda rápida
src/importer.ts       leitura e mapeamento de tabelas Excel/CSV
src/data/             api.ts (contrato), demo-api.ts (browser), supabase-api.ts (produção)
src/pages/            Catálogo, Encomenda rápida, Carrinho, Encomendas, Conta, Gestão
supabase/migrations/  tabelas, regras de segurança (RLS) e funções de encomenda e importação
supabase/functions/   notify-order (emails) e invite-client (convites)
```

## Integração futura com o CRM
A estrutura segue a do catálogo beta do CRM (`catalog_products`, `catalog_price_list_items`, `catalog_commercial_rules`,
`catalog_orders`). Para juntar: mapear `b2b_clients` → `clients`, `b2b_manufacturers` → `manufacturers`, e as encomendas validadas
passam a aparecer no dossier do cliente no CRM.
