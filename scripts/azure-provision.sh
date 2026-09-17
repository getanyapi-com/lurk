#!/usr/bin/env bash
#
# Provision one hosted instance on Azure Container Apps. Idempotent: every step
# checks for the resource first, so a second run is a no-op that reprints names.
#
# Usage:
#   RESOURCE_GROUP=reddit-leads-prod scripts/azure-provision.sh --dry-run
#   RESOURCE_GROUP=reddit-leads-prod DOMAIN=leads.example.com scripts/azure-provision.sh
#
# Secret values are never passed on the command line of this script and never
# printed. They are read from, and generated into, a gitignored env file
# (default deploy/env.production). Commands that carry a secret are logged by
# description only.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCATION="${LOCATION:-centralus}"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/deploy/env.production}"
RESOURCE_GROUP="${RESOURCE_GROUP:-}"
DOMAIN="${DOMAIN:-}"
IMAGE_TAG="${IMAGE_TAG:-bootstrap}"
DRY_RUN=false

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    --resource-group) RESOURCE_GROUP="$2"; shift ;;
    --domain) DOMAIN="$2"; shift ;;
    --location) LOCATION="$2"; shift ;;
    --env-file) ENV_FILE="$2"; shift ;;
    --image-tag) IMAGE_TAG="$2"; shift ;;
    -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -z "$RESOURCE_GROUP" ]; then
  echo "RESOURCE_GROUP is required. Pass --resource-group or set the variable." >&2
  exit 2
fi

# Resource names follow the resource group, because the product name is not settled.
BASE="$RESOURCE_GROUP"
ACR_NAME="$(printf '%s' "$BASE" | tr -cd '[:alnum:]' | tr '[:upper:]' '[:lower:]')acr"
PG_SERVER="$BASE-pg"
PG_DB="$(printf '%s' "$BASE" | tr '-' '_')"
PG_ADMIN="appadmin"
ENV_NAME="$BASE-env"
APP_NAME="$BASE-app"
IDENTITY_NAME="$BASE-id"
IMAGE_REPO="reddit-leads"

say() { printf '\n== %s\n' "$1"; }
run() {
  if $DRY_RUN; then printf 'would run: %s\n' "$*"; return 0; fi
  "$@"
}
# Same as run, but the arguments carry a secret so only the label is printed.
run_secret() {
  local label="$1"; shift
  if $DRY_RUN; then printf 'would run: %s (arguments withheld)\n' "$label"; return 0; fi
  printf 'running: %s\n' "$label"
  "$@" >/dev/null
}
# Reads a value out of Azure. In a dry run there is nothing to read.
capture() {
  if $DRY_RUN; then printf '<dry-run>'; return 0; fi
  "$@"
}
exists() { $DRY_RUN && return 1; "$@" >/dev/null 2>&1; }

# ---------------------------------------------------------------- env file ---

mkdir -p "$(dirname "$ENV_FILE")"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

env_get() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }
env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -v "^$key=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}
# Generates a value once and keeps it, so a second run never rotates a credential.
env_default() {
  local key="$1" generator="$2"
  if [ -z "$(env_get "$key")" ]; then
    env_set "$key" "$($generator)"
    echo "generated $key into $ENV_FILE"
  fi
}
gen_password() { LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32; }
# 32 bytes base64, which is what src/lib/crypto.ts requires.
gen_encryption_key() { openssl rand -base64 32; }

for required in NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY CLERK_SECRET_KEY; do
  if [ -z "$(env_get "$required")" ]; then
    echo "$required is missing from $ENV_FILE. Add it and run again." >&2
    exit 2
  fi
done
env_default PG_ADMIN_PASSWORD gen_password
env_default APP_ENCRYPTION_KEY gen_encryption_key

say "Plan"
cat <<PLAN
subscription   $(capture az account show --query id -o tsv)
location       $LOCATION
resource group $RESOURCE_GROUP
registry       $ACR_NAME (Basic)
postgres       $PG_SERVER (Burstable Standard_B1ms, 32 GiB, version 17), database $PG_DB
environment    $ENV_NAME
container app  $APP_NAME, image $ACR_NAME.azurecr.io/$IMAGE_REPO:$IMAGE_TAG
identity       $IDENTITY_NAME (AcrPull on the registry)
custom domain  ${DOMAIN:-none yet, the default azurecontainerapps.io hostname is used}
env file       $ENV_FILE
PLAN

# --------------------------------------------------------------- resources ---

say "Resource providers"
# A Container Apps environment writes its logs to a Log Analytics workspace, so
# the subscription needs that provider before the environment can be created.
for namespace in Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry \
                 Microsoft.DBforPostgreSQL Microsoft.ManagedIdentity; do
  state="$(capture az provider show -n "$namespace" --query registrationState -o tsv)"
  if [ "$state" != "Registered" ]; then
    run az provider register -n "$namespace" --wait -o none
  fi
done

say "Resource group"
if ! exists az group show -n "$RESOURCE_GROUP"; then
  run az group create -n "$RESOURCE_GROUP" -l "$LOCATION" -o none
fi

say "Container registry"
if ! exists az acr show -n "$ACR_NAME" -g "$RESOURCE_GROUP"; then
  run az acr create -n "$ACR_NAME" -g "$RESOURCE_GROUP" -l "$LOCATION" --sku Basic -o none
fi
ACR_LOGIN_SERVER="$(capture az acr show -n "$ACR_NAME" -g "$RESOURCE_GROUP" --query loginServer -o tsv)"
ACR_ID="$(capture az acr show -n "$ACR_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)"

say "Managed identity and registry pull permission"
if ! exists az identity show -n "$IDENTITY_NAME" -g "$RESOURCE_GROUP"; then
  run az identity create -n "$IDENTITY_NAME" -g "$RESOURCE_GROUP" -l "$LOCATION" -o none
fi
IDENTITY_ID="$(capture az identity show -n "$IDENTITY_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)"
IDENTITY_PRINCIPAL="$(capture az identity show -n "$IDENTITY_NAME" -g "$RESOURCE_GROUP" --query principalId -o tsv)"
run az role assignment create \
  --role AcrPull \
  --assignee-object-id "$IDENTITY_PRINCIPAL" \
  --assignee-principal-type ServicePrincipal \
  --scope "$ACR_ID" \
  -o none || echo "AcrPull assignment already present"

say "Postgres flexible server"
if ! exists az postgres flexible-server show -n "$PG_SERVER" -g "$RESOURCE_GROUP"; then
  run_secret "az postgres flexible-server create -n $PG_SERVER" \
    az postgres flexible-server create \
      -n "$PG_SERVER" -g "$RESOURCE_GROUP" -l "$LOCATION" \
      --tier Burstable --sku-name Standard_B1ms \
      --storage-size 32 --version 17 \
      --admin-user "$PG_ADMIN" --admin-password "$(env_get PG_ADMIN_PASSWORD)" \
      --public-access Enabled --yes -o none
fi
run az postgres flexible-server db create \
  -g "$RESOURCE_GROUP" -s "$PG_SERVER" -n "$PG_DB" -o none || echo "database already present"
run az postgres flexible-server firewall-rule create \
  -g "$RESOURCE_GROUP" -s "$PG_SERVER" -n allow-azure-services \
  --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 -o none

DB_HOST="$PG_SERVER.postgres.database.azure.com"
env_set DATABASE_URL "postgres://$PG_ADMIN:$(env_get PG_ADMIN_PASSWORD)@$DB_HOST:5432/$PG_DB?sslmode=require"

say "Container Apps environment"
if ! exists az containerapp env show -n "$ENV_NAME" -g "$RESOURCE_GROUP"; then
  run az containerapp env create -n "$ENV_NAME" -g "$RESOURCE_GROUP" -l "$LOCATION" -o none
fi

say "Image"
if ! exists az acr repository show -n "$ACR_NAME" --image "$IMAGE_REPO:$IMAGE_TAG"; then
  echo "Tag $IMAGE_REPO:$IMAGE_TAG is not in the registry; building it there."
  run az acr build --registry "$ACR_NAME" -t "$IMAGE_REPO:$IMAGE_TAG" "$REPO_ROOT"
fi

# ------------------------------------------------------------ container app --

# Only values that are actually set become secrets or environment variables, so
# an unused integration never half-configures the app.
SECRET_ARGS=()
ENV_ARGS=()
add_secret() {
  local ref="$1" key="$2" value
  value="$(env_get "$key")"
  [ -z "$value" ] && return 0
  SECRET_ARGS+=("$ref=$value")
  ENV_ARGS+=("$key=secretref:$ref")
}
add_plain() {
  local key="$1" fallback="${2:-}" value
  value="$(env_get "$key")"
  [ -z "$value" ] && value="$fallback"
  [ -z "$value" ] && return 0
  ENV_ARGS+=("$key=$value")
}

add_secret database-url DATABASE_URL
add_secret app-encryption-key APP_ENCRYPTION_KEY
add_secret clerk-secret-key CLERK_SECRET_KEY
add_secret anyapi-house-api-key ANYAPI_HOUSE_API_KEY
add_secret openrouter-api-key OPENROUTER_API_KEY
add_secret azure-email-connection-string AZURE_EMAIL_CONNECTION_STRING
add_secret smtp-url SMTP_URL
add_secret slack-client-secret SLACK_CLIENT_SECRET

add_plain NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
add_plain ANYAPI_BASE_URL https://api.getanyapi.com
add_plain ANYAPI_OAUTH_CLIENT_ID
add_plain OPENROUTER_MODEL
add_plain ALERTS_FROM_EMAIL
add_plain SLACK_CLIENT_ID
add_plain HOUSE_DATA_CAP_USD_PER_DAY
add_plain HOUSE_LLM_CAP_USD_PER_DAY
ENV_ARGS+=("SELF_HOSTED=false")
# The scheduler must run on exactly one process, so the app is pinned to one replica.
ENV_ARGS+=("RUN_SCHEDULER=true")

say "Container app"
if ! exists az containerapp show -n "$APP_NAME" -g "$RESOURCE_GROUP"; then
  run_secret "az containerapp create -n $APP_NAME" \
    az containerapp create \
      -n "$APP_NAME" -g "$RESOURCE_GROUP" \
      --environment "$ENV_NAME" \
      --image "$ACR_LOGIN_SERVER/$IMAGE_REPO:$IMAGE_TAG" \
      --registry-server "$ACR_LOGIN_SERVER" \
      --registry-identity "$IDENTITY_ID" \
      --user-assigned "$IDENTITY_ID" \
      --ingress external --target-port 3000 \
      --cpu 0.5 --memory 1.0Gi \
      --min-replicas 1 --max-replicas 1 \
      --secrets "${SECRET_ARGS[@]}" \
      --env-vars "${ENV_ARGS[@]}" \
      -o none
else
  run_secret "az containerapp secret set -n $APP_NAME" \
    az containerapp secret set -n "$APP_NAME" -g "$RESOURCE_GROUP" --secrets "${SECRET_ARGS[@]}" -o none
  run_secret "az containerapp update -n $APP_NAME --set-env-vars" \
    az containerapp update -n "$APP_NAME" -g "$RESOURCE_GROUP" --set-env-vars "${ENV_ARGS[@]}" -o none
fi

FQDN="$(capture az containerapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" \
  --query properties.configuration.ingress.fqdn -o tsv)"
APP_URL="https://${DOMAIN:-$FQDN}"
env_set APP_URL "$APP_URL"
run az containerapp update -n "$APP_NAME" -g "$RESOURCE_GROUP" --set-env-vars "APP_URL=$APP_URL" -o none

# ------------------------------------------------------------ custom domain --

if [ -n "$DOMAIN" ]; then
  say "Custom domain $DOMAIN"
  VERIFICATION_ID="$(capture az containerapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" \
    --query properties.customDomainVerificationId -o tsv)"
  STATIC_IP="$(capture az containerapp env show -n "$ENV_NAME" -g "$RESOURCE_GROUP" \
    --query properties.staticIp -o tsv)"
  # An apex domain has to be an A record to the environment's address, because a
  # CNAME cannot sit at the root of a zone. A subdomain uses a CNAME instead.
  # The apex certificate validates over HTTP through that A record; TXT
  # validation prints a token that has to be published by hand and left
  # lurk.so's certificate Pending on 2026-09-05.
  if [ "$(printf '%s' "$DOMAIN" | tr -cd '.' | wc -c)" -le 1 ]; then
    APEX_RECORD="A     $DOMAIN -> $STATIC_IP"
    VALIDATION=HTTP
  else
    APEX_RECORD="CNAME $DOMAIN -> $FQDN"
    VALIDATION=CNAME
  fi
  cat <<DNS
Publish these first. Azure reads them itself, so they must resolve publicly and
must not be proxied by a CDN that answers with its own address and certificate.
  $APEX_RECORD
  TXT   asuid.$DOMAIN -> $VERIFICATION_ID
DNS
  if ! run az containerapp hostname add -n "$APP_NAME" -g "$RESOURCE_GROUP" \
       --hostname "$DOMAIN" -o none; then
    echo "Azure cannot see those records yet. Publish them and run this script again."
    echo "Everything else is provisioned; only the custom domain is outstanding."
    exit 0
  fi
  run az containerapp env certificate create -n "$ENV_NAME" -g "$RESOURCE_GROUP" \
    --hostname "$DOMAIN" --validation-method "$VALIDATION" --certificate-name "$BASE-cert" -o none
  # Issuance takes minutes; binding a Pending certificate fails.
  until [ "$(capture az containerapp env certificate list -n "$ENV_NAME" -g "$RESOURCE_GROUP" \
      --query "[?name=='$BASE-cert'].properties.provisioningState | [0]" -o tsv)" = "Succeeded" ]; do
    echo "certificate $BASE-cert still provisioning"
    sleep 30
  done
  run az containerapp hostname bind -n "$APP_NAME" -g "$RESOURCE_GROUP" \
    --hostname "$DOMAIN" --environment "$ENV_NAME" --certificate "$BASE-cert" -o none
else
  say "Custom domain"
  echo "DOMAIN is unset, so the app is reachable only on its default hostname."
fi

say "Done"
cat <<OUT
hostname            https://$FQDN
app url             $APP_URL
registry            $ACR_LOGIN_SERVER
image               $ACR_LOGIN_SERVER/$IMAGE_REPO:$IMAGE_TAG
secrets and values  $ENV_FILE (gitignored) and the container app's own secrets

Set these GitHub repository variables so deploy.yml can roll a new revision:
  AZURE_RESOURCE_GROUP=$RESOURCE_GROUP
  AZURE_CONTAINER_REGISTRY=$ACR_NAME
  AZURE_CONTAINER_APP=$APP_NAME
  APP_HEALTH_URL=$APP_URL/api/health
Then run scripts/azure-github-oidc.sh for the sign-in secrets.
OUT
