#!/usr/bin/env bash
# 1) Diz ao Supabase qual é o endereço da loja (para os emails de convite e recuperação levarem ao sítio certo).
# 2) Convida por email as contas de gestão (ADMIN_EMAILS, separados por vírgula) que ainda não existam.
#    A pessoa define a própria palavra-passe; o papel de administrador é dado pela migração b2b_admin_emails.
# Precisa das variáveis exportadas por resolve-config.sh.
set -euo pipefail

allow="https://freixo-b2b.pages.dev/**,https://b2b.representacoesfreixo.com/**,https://encomendas.representacoesfreixo.com/**,${APP_URL}/**"
curl -sf -X PATCH "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "$(jq -n --arg s "$APP_URL" --arg a "$allow" '{site_url: $s, uri_allow_list: $a}')" > /dev/null
echo "Endereço da loja nos emails: $APP_URL"

# As chaves novas (sb_secret_...) vão só no cabeçalho apikey; as antigas (JWT) também no Authorization.
headers=(-H "apikey: $B2B_SERVICE_KEY")
[[ "$B2B_SERVICE_KEY" == sb_secret_* ]] || headers+=(-H "Authorization: Bearer $B2B_SERVICE_KEY")

existing=$(curl -sf "${headers[@]}" "$VITE_SUPABASE_URL/auth/v1/admin/users?per_page=1000" | jq -r '[.users[].email | ascii_downcase] | join(" ")')
IFS=',' read -ra emails <<< "$ADMIN_EMAILS"
for raw in "${emails[@]}"; do
  email=$(echo "$raw" | tr -d ' ' | tr '[:upper:]' '[:lower:]')
  [ -z "$email" ] && continue
  if grep -qw -- "$email" <<< "$existing"; then
    echo "Conta de gestão já existe: $email"
  else
    curl -sf -X POST "${headers[@]}" -H "Content-Type: application/json" \
      "$VITE_SUPABASE_URL/auth/v1/invite?redirect_to=$(jq -rn --arg u "$APP_URL" '$u|@uri')" \
      -d "$(jq -n --arg e "$email" '{email: $e}')" > /dev/null
    echo "Convite enviado para: $email"
  fi
done
