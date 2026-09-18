# lurk

lurk is a Reddit buyer-intent finder you can self-host for free, hosted at
<https://lurk.so>. It watches the subreddits and keywords your buyers use, scores every post
and comment against your product, tells you in one sentence why each one scored what it did,
and shows what the data behind that lead cost, down to the request.

Data comes from [AnyAPI](https://getanyapi.com): one key, pay per request in USD, no
subscription. "Premium" here means connecting your own AnyAPI wallet, not paying us a monthly
fee. Self-hosting has no limits at all.

## What it does

- **Builds your product profile from your URL.** One page read plus one language model call
  gives you the pain, the solution, who buys, the subreddits they post in and the searches
  they run. Everything is editable.
- **Scans on a schedule.** Per keyword and per tracked subreddit, then a title-level triage,
  then it opens only the threads worth reading, then one product-agnostic reading of each that
  says whether anybody is asking for anything, then the comments on the best of those. Cost
  follows quality, not volume.
- **Scores with a written reason.** 0-100 from fit, intent and how alive the thread is, plus
  an intent stage, the phrase that matched, and a seller-side flag for the people who are
  selling rather than buying.
- **Ranks the feed.** Filter by window, community and stage. Every card carries the poster,
  the community, the age, the subreddit's own self-promotion rule, and the cost line.
- **Sends alerts.** A digest email, a Slack or Discord post, or your own webhook.
- **Finds the Reddit threads Google already ranks** for your keywords, with position, thread
  age and whether a competitor is named in it or recommended in its replies.
- **Watches your competitors** on Reddit: which ones are being recommended in the threads
  your leads sit in, and what new posts naming them say, positive, negative or neutral.
- **Groups your leads into pain themes**, over data you already paid for.
- **Answers all of it over a read-only API and MCP**, so an agent can triage for you.

## What it never does

Deliberately absent, and not planned:

- **No posting.** No comment or DM is ever sent for you.
- **No reply drafting.** lurk finds and explains the conversation; the words are yours.
- **No browser extension.**
- **No conversation inbox.** Once you reply, the conversation belongs to Reddit.
- **No feedback loop that rewrites your filters.** Marking a lead as not a fit records the
  reason and shows it in Insights; it does not silently change what you see next.
- **No archive of Reddit.** Search is the index. We keep 30 days and no more.
- **No subscription.** There is no plan to buy here, in any tier.

## Five-minute self-host

You need Docker, a free [Clerk](https://clerk.com) application for sign-in, an
[AnyAPI](https://getanyapi.com) key and an [OpenRouter](https://openrouter.ai) key.

```bash
git clone <repo> lurk
cd lurk
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # APP_ENCRYPTION_KEY
```

Put that key in `APP_ENCRYPTION_KEY`, paste your Clerk, AnyAPI and OpenRouter keys into
`.env`, then:

```bash
docker compose up
```

The app applies its own migrations on start and serves on <http://localhost:3000>. Sign up,
paste your product's URL, and press Scan now.

To let other people connect their own AnyAPI wallet instead of using your key, register this
instance as an OAuth client once and paste the printed id into `ANYAPI_OAUTH_CLIENT_ID`:

```bash
npm run anyapi:register
```

## Environment

| Variable | Required | Default | What it does |
|---|---|---|---|
| `DATABASE_URL` | yes | - | Postgres connection string. Compose sets it for you. |
| `APP_URL` | yes | `http://localhost:3000` | Public origin. Must match the registered OAuth redirect. |
| `APP_ENCRYPTION_KEY` | yes | - | 32 random bytes, base64. Encrypts stored AnyAPI refresh tokens. |
| `SELF_HOSTED` | no | `false` | `true` removes every tier limit. |
| `RUN_SCHEDULER` | no | `false` | `true` on exactly one process runs the every-minute job tick. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | yes | - | Clerk publishable key. |
| `CLERK_SECRET_KEY` | yes | - | Clerk secret key. |
| `ANYAPI_BASE_URL` | no | `https://api.getanyapi.com` | AnyAPI gateway. |
| `ANYAPI_OAUTH_CLIENT_ID` | no | - | Printed by `npm run anyapi:register`. Needed for wallet connect. |
| `ANYAPI_HOUSE_API_KEY` | no | - | The key used when a user has not connected a wallet. |
| `OPENROUTER_API_KEY` | no | - | Pays for judging every title, post and comment the scan reads (TypeSafe's Jev), and for the product profile, competitor classification and clustering. Without it nothing is scored. |
| `OPENROUTER_MODEL` | no | `meta/muse-spark-1.3-contributor` | Override the model. |
| `JEV_MODEL` | no | `~typesafe/jev-latest` | Override the judging model. |
| `ALERTS_FROM_EMAIL` | no | - | The From address on a digest. Email needs this and one of the two below. |
| `AZURE_EMAIL_CONNECTION_STRING` | no | - | Sends the digest through Azure Communication Services. Wins when both are set. |
| `SMTP_URL` | no | - | Sends the digest through any SMTP server, as `smtps://user:pass@host:465`. |
| `SLACK_CLIENT_ID` | no | - | With the secret, turns the Slack channel into an Add to Slack button. |
| `SLACK_CLIENT_SECRET` | no | - | The other half of the Slack app. |
| `HOUSE_DATA_CAP_USD_PER_DAY` | no | `25` | Daily ceiling on data spend from the house key. |
| `HOUSE_LLM_CAP_USD_PER_DAY` | no | `10` | Daily ceiling on language model spend. |

A variable set to nothing counts as unset, so an empty line in `.env` never half-configures a
feature.

## Tiers

A hosted instance has two tiers. Self-hosting is neither: it has no limits at all.

| Setting | Free | Connected wallet |
|---|---|---|
| Projects | 2 | unlimited |
| Keywords per project | 25 | unlimited |
| Tracked subreddits per project | 10 | unlimited |
| Scan cadence | every 6 hours | hourly |
| Comment scan | top 20 scored threads per scan | every thread over your threshold |
| Feed window | 30 days | 30 days |
| Alerts | daily digest, Slack and Discord, + 1 custom webhook | hourly, unlimited custom webhooks |
| Reddit SEO | 10 keywords, refreshed weekly | unlimited keywords, refreshed daily |
| Competitors | 3 | unlimited |
| Insights | full | full |
| API and MCP | read-only, 1,000 requests a day | read-only, unlimited requests |

Connecting a wallet buys freshness and breadth, not features. Every feature is on in every
tier.

## How a wallet connection works

Sign in, open Settings, and press Connect AnyAPI wallet. You land on the AnyAPI consent
screen, where you set the spend cap this app may use, and come back connected. This app never
sees or stores an AnyAPI key: it holds a refresh token, encrypted with `APP_ENCRYPTION_KEY`,
and swaps it for a short-lived access token when it needs to make a call. Disconnect deletes
the token here and revokes it at AnyAPI.

## Alerts

Settings -> Alerts is where new leads land. Add an email digest, a Slack or Discord webhook,
or a generic webhook that receives the same digest as JSON. Slack and Discord cost nothing to
post to, so a project may add as many of those as it likes; the generic webhook is the one the
free tier caps, at one. Email needs `ALERTS_FROM_EMAIL`
and one carrier: `AZURE_EMAIL_CONNECTION_STRING` or `SMTP_URL`, in that order. On Azure, the local part of `ALERTS_FROM_EMAIL` must also be added as a sender
username on the domain, or every send is refused. The webhooks need nothing. A digest carries the day's new leads with
their score, reason, community and link, in the same shapes the feed uses, and sends nothing
at all when there is nothing new. The scheduler queues one digest pass an hour and each
channel decides whether its own cadence is due.

Slack takes a pasted webhook URL by default. To let people pick a channel instead, create a
Slack app at <https://api.slack.com/apps> with Incoming Webhooks on, the `incoming-webhook`
bot scope, and `https://<your APP_URL>/connect/slack/callback` as a redirect URL. Slack only
accepts https redirect URLs, so this does not work against `http://localhost`. Put the app's
client id and secret in `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` and the form shows an Add
to Slack button; the pasted-URL path stays one click away.

## API and MCP

Settings -> API mints read-only keys prefixed `rl_sk_`. Send one as a bearer token:

```bash
curl -H "Authorization: Bearer $KEY" http://localhost:3000/api/v1/projects
```

Reading costs nothing, and every response says so with `X-Request-Cost-Usd: 0`. The schema is
served at [`/openapi.json`](public/openapi.json) and the agent guide, which explains what a
lead is and how to triage one, at [`/agent-guide.md`](public/agent-guide.md). The same reads
are available to an agent over MCP at `/api/mcp`.

## Costs, measured

Real runs on this codebase against tally.so, on 2026-09-05. Data is what AnyAPI billed;
model is what OpenRouter billed.

| Run | AnyAPI requests | Data | Model | What came back |
|---|---|---|---|---|
| First scan, 12 keywords and 5 subreddits | 27 | $0.028 | $0.0067 | 4 leads |
| Reddit SEO refresh, 3 keywords | 27 | $0.028 | - | 24 ranking threads |
| Competitor scan, 3 competitors | 27 | $0.032 | - | mentions with a sentiment each |
| Insights over stored leads | 0 | $0 | $0.0004 | pain themes and communities |
| Daily digest email | 0 | $0 | - | one email |

Two things keep the bill this small. Reddit rows are shared: the same search run inside your
cadence window is reused, billed at zero, and the Data usage screen shows fetched against
reused. And a scan is a funnel, so full posts and comment threads are only bought for the
titles that survived triage.

## Data we store, and for how long

Reddit posts and comments are public facts, so they are stored once and shared across
projects: two people tracking the same keyword pay for one fetch between them. Scores are
never shared; the same post can be a 92 for one product and a 12 for another. Shared Reddit
rows are deleted 30 days after they were posted, along with the leads pointing at them, which
is also the feed window.

## Built on AnyAPI

Every Reddit and Google call this app makes goes through [AnyAPI](https://getanyapi.com),
using the published TypeScript SDK. That is the point of giving this away: the whole category
sells you a subscription and hides what the data costs, and here the cost of a lead is printed
on the lead.

- One key reaches Reddit search, subreddit listings, posts, comments, profiles and community
  details, plus Google search for the Reddit SEO screen.
- You pay per request in USD, from a wallet, with no plan and no minimum.
- Every call returns its own price, which is what the cost lines in this app are made of.
- A free trial key with starter credit and no card is a sign-up away at
  <https://getanyapi.com>.

## Hosting it on Azure

Self-hosting needs none of this. It is how the one hosted instance runs.

### Provision, once

`scripts/azure-provision.sh` creates everything in one resource group and is safe to run
again: every step checks for the resource first. Secrets are never arguments to it. They
live in `deploy/env.production`, which is gitignored, and the script generates the ones you
should not choose yourself.

```bash
mkdir -p deploy
cat > deploy/env.production <<'EOF'
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
ANYAPI_HOUSE_API_KEY=
OPENROUTER_API_KEY=
ALERTS_FROM_EMAIL=
AZURE_EMAIL_CONNECTION_STRING=
SMTP_URL=
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
EOF

RESOURCE_GROUP=reddit-leads-prod scripts/azure-provision.sh --dry-run
RESOURCE_GROUP=reddit-leads-prod scripts/azure-provision.sh
```

It writes `PG_ADMIN_PASSWORD`, `APP_ENCRYPTION_KEY`, `DATABASE_URL` and `APP_URL` back into
that file, and sets the same values as Container App secrets. Nothing else holds them.

What it creates, all in `centralus` by default and all on the smallest sensible tier:

| Resource | Tier |
|---|---|
| Container registry | Basic |
| Postgres flexible server, plus a database and a firewall rule for Azure services | Burstable `Standard_B1ms`, 32 GiB, version 17 |
| Container Apps environment | Consumption |
| Container app, one replica, port 3000, external ingress | 0.5 vCPU, 1 GiB |
| User-assigned managed identity with `AcrPull` on the registry | - |

The app is pinned to exactly one replica because `RUN_SCHEDULER=true` must run on exactly
one process.

### The custom domain

Set `DOMAIN` and the script prints the records to publish, adds the hostname, asks for a
managed certificate and binds it. If the records are not visible yet it says so and leaves
everything else provisioned, so it is safe to run again once DNS has propagated:

```bash
RESOURCE_GROUP=reddit-leads-prod DOMAIN=lurk.so scripts/azure-provision.sh
```

An apex domain such as `lurk.so` needs an `A` record to the environment's address, because a
CNAME cannot sit at the root of a zone; a subdomain gets a `CNAME` to the app instead. The
script picks the right shape and the matching certificate validation method for you.

Azure resolves those records itself to prove you own the name and to issue the certificate,
so they must be served as published. Behind a proxying CDN, Cloudflare's orange cloud
included, Azure sees the proxy's address and its certificate instead and validation never
passes. Set the records to DNS-only until the certificate is issued.

### Let GitHub deploy

`.github/workflows/deploy.yml` signs in with OpenID Connect, so no Azure password is stored
on GitHub. `scripts/azure-github-oidc.sh` creates the app registration, the federated
credential that trusts one repository and branch, and the two role assignments the workflow
needs:

```bash
GITHUB_REPO=owner/repo RESOURCE_GROUP=reddit-leads-prod scripts/azure-github-oidc.sh --dry-run
GITHUB_REPO=owner/repo RESOURCE_GROUP=reddit-leads-prod scripts/azure-github-oidc.sh
```

Then set these on the repository, with `gh variable set` and `gh secret set` or in the
repository settings:

| Repository variable | Where it comes from |
|---|---|
| `AZURE_RESOURCE_GROUP` | the resource group you provisioned |
| `AZURE_CONTAINER_REGISTRY` | registry name, printed by the provision script |
| `AZURE_CONTAINER_APP` | container app name, printed by the provision script |
| `APP_HEALTH_URL` | `https://<hostname>/api/health`, printed by the provision script |

| Repository secret | Where it comes from |
|---|---|
| `AZURE_CLIENT_ID` | printed by `scripts/azure-github-oidc.sh` |
| `AZURE_TENANT_ID` | printed by `scripts/azure-github-oidc.sh` |
| `AZURE_SUBSCRIPTION_ID` | printed by `scripts/azure-github-oidc.sh` |

A deploy builds the image, pushes it, rolls the container app to a revision named after the
commit, and then polls `APP_HEALTH_URL` until it answers 200. Migrations are not a separate
job: `docker-entrypoint.sh` applies them before the server starts, and one replica means
they run once.

`scripts/deploy-manual.sh` does the same from a clean checkout, for when the workflow is
not an option:

```bash
RESOURCE_GROUP=reddit-leads-prod scripts/deploy-manual.sh
```

It pins `--platform linux/amd64`, because an image built on an Apple Silicon Mac without it
pushes fine and then fails to pull with "not found".

## Development

```bash
npm install
docker compose up -d postgres
cp .env.example .env    # fill in the keys, point DATABASE_URL at localhost:5433
npm run db:migrate
npm run dev
```

`npm run check` runs the typecheck, the linter and the unit tests. The database-backed tests
skip unless `DATABASE_URL` is set, and never write to that database: they use a sibling named
`<database>_test` on the same server (or `TEST_DATABASE_URL`), created and migrated on the
first run. They also drop every paid key from the environment, so a test cannot spend.
`npm run db:generate` writes a new migration after a schema change.

## Licence

MIT.
