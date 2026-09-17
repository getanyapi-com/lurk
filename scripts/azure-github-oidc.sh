#!/usr/bin/env bash
#
# Give the Deploy workflow a way to sign in to Azure without a stored password.
# Creates an app registration, its service principal, a federated credential
# trusting one GitHub repository's default branch, and the two role assignments
# the workflow needs: push to the registry and roll the container app.
#
# GitHub's OIDC token names the repository with its owner and repository ids
# embedded, as repo:owner@123/repo@456:ref:refs/heads/main, so the credential
# subject has to match that exactly. The ids come from `gh api`, so the GitHub
# CLI must be signed in.
#
# Usage:
#   GITHUB_REPO=owner/repo RESOURCE_GROUP=reddit-leads-prod scripts/azure-github-oidc.sh --dry-run
#   GITHUB_REPO=owner/repo RESOURCE_GROUP=reddit-leads-prod scripts/azure-github-oidc.sh
#
# Prints the three values to store as GitHub repository secrets. Nothing it
# prints is a password: OIDC exchanges a short-lived GitHub token instead.
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-}"
GITHUB_REPO="${GITHUB_REPO:-}"
BRANCH="${BRANCH:-main}"
DRY_RUN=false

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    --resource-group) RESOURCE_GROUP="$2"; shift ;;
    --repo) GITHUB_REPO="$2"; shift ;;
    --branch) BRANCH="$2"; shift ;;
    -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -z "$RESOURCE_GROUP" ] || [ -z "$GITHUB_REPO" ]; then
  echo "RESOURCE_GROUP and GITHUB_REPO (owner/repo) are both required." >&2
  exit 2
fi

APP_DISPLAY_NAME="$RESOURCE_GROUP-github-deploy"
CREDENTIAL_NAME="$(printf '%s' "$GITHUB_REPO" | tr '/' '-')-$BRANCH"

OWNER_ID="$(gh api "repos/$GITHUB_REPO" --jq .owner.id)"
REPO_ID="$(gh api "repos/$GITHUB_REPO" --jq .id)"
SUBJECT="repo:${GITHUB_REPO%%/*}@$OWNER_ID/${GITHUB_REPO#*/}@$REPO_ID:ref:refs/heads/$BRANCH"

run() {
  if $DRY_RUN; then printf 'would run: %s\n' "$*"; return 0; fi
  "$@"
}
capture() {
  if $DRY_RUN; then printf '<dry-run>'; return 0; fi
  "$@"
}

printf '\n== Plan\n'
cat <<PLAN
subscription    $(capture az account show --query id -o tsv)
tenant          $(capture az account show --query tenantId -o tsv)
app             $APP_DISPLAY_NAME
trusts          $SUBJECT
scope           the $RESOURCE_GROUP resource group (Contributor and AcrPush)
PLAN

printf '\n== App registration\n'
APP_ID="$(capture az ad app list --display-name "$APP_DISPLAY_NAME" --query "[0].appId" -o tsv)"
if [ -z "$APP_ID" ] || [ "$APP_ID" = "<dry-run>" ]; then
  APP_ID="$(capture az ad app create --display-name "$APP_DISPLAY_NAME" --query appId -o tsv)"
fi
echo "appId $APP_ID"

printf '\n== Service principal\n'
run az ad sp create --id "$APP_ID" -o none || echo "service principal already present"
SP_OBJECT_ID="$(capture az ad sp show --id "$APP_ID" --query id -o tsv)"

printf '\n== Federated credential\n'
CREDENTIAL_JSON="$(cat <<JSON
{
  "name": "$CREDENTIAL_NAME",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "$SUBJECT",
  "description": "GitHub Actions deploy from $GITHUB_REPO on $BRANCH",
  "audiences": ["api://AzureADTokenExchange"]
}
JSON
)"
if $DRY_RUN; then
  printf 'would run: az ad app federated-credential create --id %s --parameters -\n%s\n' \
    "$APP_ID" "$CREDENTIAL_JSON"
else
  CREDENTIAL_FILE="$(mktemp)"
  printf '%s\n' "$CREDENTIAL_JSON" > "$CREDENTIAL_FILE"
  az ad app federated-credential create --id "$APP_ID" --parameters "$CREDENTIAL_FILE" -o none \
    || echo "federated credential already present"
  rm -f "$CREDENTIAL_FILE"
fi

printf '\n== Role assignments\n'
SUBSCRIPTION_ID="$(capture az account show --query id -o tsv)"
SCOPE="/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP"
for role in Contributor AcrPush; do
  run az role assignment create \
    --role "$role" \
    --assignee-object-id "$SP_OBJECT_ID" \
    --assignee-principal-type ServicePrincipal \
    --scope "$SCOPE" \
    -o none || echo "$role already assigned"
done

printf '\n== Done\n'
cat <<OUT
Store these as GitHub repository secrets on $GITHUB_REPO:
  AZURE_CLIENT_ID=$APP_ID
  AZURE_TENANT_ID=$(capture az account show --query tenantId -o tsv)
  AZURE_SUBSCRIPTION_ID=$SUBSCRIPTION_ID
OUT
