#!/usr/bin/env bash
# Deploy the current commit to the hosted Container App by hand, the same path
# .github/workflows/deploy.yml takes once the GitHub repository exists.
#
#   RESOURCE_GROUP=reddit-leads-prod scripts/deploy-manual.sh
#
# Container Apps run linux/amd64. A build on an Apple Silicon Mac defaults to
# arm64, which pushes fine and then fails to pull with "not found", so the
# platform is pinned here rather than remembered.
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:?set RESOURCE_GROUP, e.g. reddit-leads-prod}"
# The same key the workflow builds with, or every Server Action id changes and
# each open tab breaks on its next click. It is the repository secret of the
# same name; a copy lives in the main checkout's gitignored deploy/actions-key.env.
: "${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:?set NEXT_SERVER_ACTIONS_ENCRYPTION_KEY to the key the deploy workflow uses}"
export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
BASE="${BASE:-$RESOURCE_GROUP}"
APP_NAME="${APP_NAME:-$BASE-app}"
ACR_NAME="${ACR_NAME:-$(printf '%s' "$BASE" | tr -cd 'a-z0-9')acr}"
IMAGE_REPO="${IMAGE_REPO:-reddit-leads}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
  echo "The working tree is dirty; commit first so the tag names what is deployed." >&2
  exit 1
fi

SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
TAG="$ACR_NAME.azurecr.io/$IMAGE_REPO:$SHA"
SUFFIX="s$(printf '%s' "$SHA" | cut -c1-8)"

az acr login --name "$ACR_NAME"
docker build --platform linux/amd64 -t "$TAG" \
  --secret id=actions_key,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY \
  --build-arg NEXT_DEPLOYMENT_ID="$SHA" "$REPO_ROOT"
docker push "$TAG"
az containerapp update -n "$APP_NAME" -g "$RESOURCE_GROUP" \
  --image "$TAG" --revision-suffix "$SUFFIX" -o none

REVISION="$APP_NAME--$SUFFIX"
until state="$(az containerapp revision show -n "$APP_NAME" -g "$RESOURCE_GROUP" \
    --revision "$REVISION" --query properties.runningState -o tsv)" \
    && { [ "$state" = "Running" ] || [ "$state" = "RunningAtMaxScale" ] || [ "$state" = "Failed" ]; }; do
  echo "revision $REVISION is $state"
  sleep 15
done
echo "revision $REVISION is $state"
[ "$state" != "Failed" ]

APP_URL="$(az containerapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" \
  --query "properties.template.containers[0].env[?name=='APP_URL'].value | [0]" -o tsv)"
curl -sf -o /dev/null "$APP_URL/api/health" && echo "healthy $APP_URL"
