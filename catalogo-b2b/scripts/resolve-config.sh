#!/usr/bin/env bash
# Descobre sozinho os dados do Supabase e do Cloudflare a partir de 3 chaves e verifica se estão certas.
# Chaves necessárias (segredos do GitHub): SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD, CLOUDFLARE_API_TOKEN.
# A conta Cloudflare vem de CLOUDFLARE_ACCOUNT_ID_DEFAULT no workflow (o ID da conta não é secreto).
# Exporta para os passos seguintes: SUPABASE_PROJECT_REF, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
# B2B_SERVICE_KEY, CLOUDFLARE_ACCOUNT_ID. Nunca escreve chaves no registo.
set -uo pipefail

PROJECT_NAME="freixo-catalogo-b2b"
ok=1
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
out="${GITHUB_ENV:-/dev/null}"
say() { echo "$1"; echo "$1" >> "$summary"; }
fail() { say "❌ $1"; ok=0; }
export_var() { echo "::add-mask::$2"; echo "$1=$2" >> "$out"; export "$1=$2"; }

say "### Verificação da configuração do Catálogo B2B"

# ---- Supabase
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  fail "Falta o segredo SUPABASE_ACCESS_TOKEN (supabase.com/dashboard/account/tokens)."
else
  projects=$(curl -sf -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" https://api.supabase.com/v1/projects) || projects=""
  if [ -z "$projects" ]; then
    fail "O SUPABASE_ACCESS_TOKEN não é aceite pelo Supabase. Gere um novo token e substitua o segredo."
  else
    count=$(echo "$projects" | jq 'length')
    ref=$(echo "$projects" | jq -r --arg n "$PROJECT_NAME" '[.[] | select(.name == $n)][0].id // empty')
    if [ -z "$ref" ] && [ "$count" = "1" ]; then ref=$(echo "$projects" | jq -r '.[0].id'); fi
    if [ -z "$ref" ]; then
      fail "Não encontrei o projeto \"$PROJECT_NAME\" no Supabase (projetos visíveis: $(echo "$projects" | jq -r '[.[].name] | join(", ")'))."
    else
      say "✅ Supabase: projeto encontrado ($(echo "$projects" | jq -r --arg r "$ref" '.[] | select(.id == $r) | .name + ", região " + .region'))."
      echo "SUPABASE_PROJECT_REF=$ref" >> "$out"; export SUPABASE_PROJECT_REF="$ref"
      export_var VITE_SUPABASE_URL "https://$ref.supabase.co"
      keys=$(curl -sf -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "https://api.supabase.com/v1/projects/$ref/api-keys?reveal=true") || keys="[]"
      anon=$(echo "$keys" | jq -r '([.[] | select(.type == "publishable")][0].api_key) // ([.[] | select(.name == "anon")][0].api_key) // empty')
      service=$(echo "$keys" | jq -r '([.[] | select(.type == "secret")][0].api_key) // ([.[] | select(.name == "service_role")][0].api_key) // empty')
      if [ -z "$anon" ] || [ -z "$service" ]; then
        fail "Não consegui ler as chaves do projeto. Confirme que o projeto já terminou de arrancar."
      else
        export_var VITE_SUPABASE_ANON_KEY "$anon"
        export_var B2B_SERVICE_KEY "$service"
        say "✅ Supabase: chaves do projeto obtidas."
      fi
      if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
        fail "Falta o segredo SUPABASE_DB_PASSWORD (a palavra-passe da base de dados do passo 1)."
      elif command -v supabase >/dev/null; then
        if supabase link --project-ref "$ref" --password "$SUPABASE_DB_PASSWORD" >/dev/null 2>&1 \
          && supabase db push --dry-run --password "$SUPABASE_DB_PASSWORD" >/dev/null 2>&1; then
          say "✅ Supabase: palavra-passe da base de dados correta."
        else
          fail "A SUPABASE_DB_PASSWORD não está certa. No Supabase: Project Settings → Database → Reset database password, e substitua o segredo."
        fi
      fi
    fi
  fi
fi

# ---- Cloudflare
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  fail "Falta o segredo CLOUDFLARE_API_TOKEN."
else
  verify=$(curl -sf -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" https://api.cloudflare.com/client/v4/user/tokens/verify | jq -r '.result.status // empty') || verify=""
  if [ "$verify" != "active" ]; then
    fail "O CLOUDFLARE_API_TOKEN não é aceite pelo Cloudflare. Crie um novo (Cloudflare Pages: Edit) e substitua o segredo."
  else
    # A conta: o segredo CLOUDFLARE_ACCOUNT_ID, senão o valor por omissão do workflow, senão a primeira conta visível.
    acct="${CLOUDFLARE_ACCOUNT_ID:-${CLOUDFLARE_ACCOUNT_ID_DEFAULT:-}}"
    if [ -z "$acct" ]; then
      acct=$(curl -sf -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" https://api.cloudflare.com/client/v4/accounts | jq -r '.result[0].id // empty') || acct=""
    fi
    pages=$( [ -n "$acct" ] && curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$acct/pages/projects" | jq -r '.success // false')
    if [ "$pages" != "true" ]; then
      fail "O token do Cloudflare é válido, mas não consegue gerir o Cloudflare Pages da conta. Confirme a permissão Account → Cloudflare Pages → Edit."
    else
      echo "CLOUDFLARE_ACCOUNT_ID=$acct" >> "$out"; export CLOUDFLARE_ACCOUNT_ID="$acct"
      say "✅ Cloudflare: token válido com acesso ao Cloudflare Pages."
    fi
  fi
fi

if [ "$ok" = 1 ]; then say "**Tudo certo: pode publicar.**"; else say "**Há chaves por corrigir (ver acima).**"; exit 1; fi
