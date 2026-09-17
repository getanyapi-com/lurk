#!/bin/sh
# Brings a workspace up far enough to look at the app: the shared Postgres, the
# migrations it is missing, then Next on this workspace's own port.
#
# The scheduler is off unless the caller turns it on. It ticks every minute and
# a scan it starts buys real Reddit and model calls, which is not what opening a
# page should do.
set -e

# Next reads .env by itself; tsx and docker compose do not, and the migration
# runner is a tsx script. Loading it here is what makes all three agree.
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

export RUN_SCHEDULER="${RUN_SCHEDULER:-false}"
PORT="${CONDUCTOR_PORT:-3000}"
export APP_URL="http://localhost:$PORT"

# Every workspace of this repo shares the one Postgres on 5433, so the first
# one to run brings it up and the rest find it already there. Starting a second
# compose project would only fail on the bound port.
#
# docker compose reads .env for the app service's required variables, so this
# only works in a workspace that has one. Files to copy puts it there.
if nc -z localhost 5433 2>/dev/null; then
  echo "Postgres is already up on 5433"
else
  echo "Starting Postgres"
  docker compose up -d postgres
fi

echo "Applying migrations"
npm run db:migrate

echo "Starting Next on port $PORT"
exec npx next dev --port "$PORT"
