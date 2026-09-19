# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# A Server Action's id is a hash salted with the actions encryption key, and
# Next draws a fresh key for every build that is not given one. A tab left open
# across a deploy then calls ids the new server never heard of, and the click
# fails. One key kept across builds keeps every unchanged action's id; the
# deployment id lets a stale tab notice it is stale and load the page again.
ARG NEXT_DEPLOYMENT_ID
ENV NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID
RUN --mount=type=secret,id=actions_key,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY \
    npm run build
# The runner has no node_modules of its own, so the migrator ships as one
# self-contained file rather than as a script plus a TypeScript runtime.
RUN ./node_modules/.bin/esbuild src/db/migrate.ts \
    --bundle --platform=node --format=esm --outfile=migrate.mjs

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/migrate.mjs ./migrate.mjs
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh && chown -R app:app /app
USER app
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
