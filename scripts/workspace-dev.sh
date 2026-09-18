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
#
# What the caller set wins over the file. .env says RUN_SCHEDULER=false, and
# sourcing it after the caller's RUN_SCHEDULER=true quietly turned the
# scheduler back off, so "dev with scheduler" never ran a job.
ASKED_RUN_SCHEDULER="${RUN_SCHEDULER:-}"
ASKED_SCHEDULER_SEED="${SCHEDULER_SEED:-}"
ASKED_SWEEP_SCALE="${SWEEP_SCALE:-}"
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
[ -n "$ASKED_RUN_SCHEDULER" ] && RUN_SCHEDULER="$ASKED_RUN_SCHEDULER"
[ -n "$ASKED_SWEEP_SCALE" ] && export SWEEP_SCALE="$ASKED_SWEEP_SCALE"
# Seeding is never taken from .env here: see below.
SCHEDULER_SEED="$ASKED_SCHEDULER_SEED"

export RUN_SCHEDULER="${RUN_SCHEDULER:-false}"
# With the scheduler on, run what somebody queued and nothing else. Seeding at
# boot queues work for every project in the shared database, fixtures included.
export SCHEDULER_SEED="${SCHEDULER_SEED:-false}"
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
