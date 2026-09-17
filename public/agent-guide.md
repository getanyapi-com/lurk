# lurk Agent Guide

You are operating lurk by AnyAPI, a Reddit buyer-intent lead finder, on behalf
of a human user. Everything here is read-only: this product finds and scores
leads, and the person decides what to do about them.

The API lives on the same origin you fetched this file from, under `/api/v1`.
The examples below call it `$BASE`, so set `BASE=https://<this instance>/api/v1`.

- Machine-readable schema: `/openapi.json`
- MCP endpoint: `/api/mcp`

## What a lead actually is

A lead is a Reddit post or comment that this app bought from AnyAPI, one call at
a time, and then scored against the user's product profile. It is scored output,
not raw Reddit access: every lead carries a written `reason`, the
`matchedPhrase` that surfaced it, an intent `stage`, a `sellerSide` flag for the
posters who are selling rather than buying, and `costUsd`, which is what the
Reddit data behind that lead cost in dollars.

`score` is 0-100 and it is a sort order for a human's attention. It is not a
probability that the person will buy, and you should never present it as one.

## Authentication

Every request carries the user's key:

    Authorization: Bearer rl_sk_...

The user creates keys in the app under Settings -> API. Keys are read-only
(`read` scope). Reading this API costs nothing, and every response says so with
`X-Request-Cost-Usd: 0`; the only money in this product is the Reddit data the
scans buy, which is already spent by the time you read a lead.

Each key has a daily request allowance: 1,000 requests a day, or 10,000 when the
user has connected their own AnyAPI wallet. Over it you get `429` with a
`Retry-After` header in seconds; the counter resets at UTC midnight. A
self-hosted instance has no allowance at all.

## The loop

Start with `GET $BASE/me`. It tells you the user's tier, their limits, and how
many requests the key has spent today.

    curl -H "Authorization: Bearer $KEY" $BASE/me

Then list projects and pull the untriaged queue in one call:

    curl -H "Authorization: Bearer $KEY" $BASE/projects
    curl -H "Authorization: Bearer $KEY" \
      "$BASE/projects/$PROJECT/leads?status=new&minScore=70&include=body&limit=50"

`status=new` is the default and is the queue the user sees in the app. The
default window is the last 30 days of Reddit posts, which is also how long this
product keeps Reddit data. `include=body` returns the full post or comment text,
which is what you need to classify anything. Paginate with `limit` and `offset`
and stop when `pagination.hasMore` is false; the page cap is 100.

For an incremental sync, pass `since=<ISO 8601>`. That filters on when the lead
was scored, not when the post was written, so you see exactly what is new since
your last pull.

Other reads:

    GET $BASE/projects/$PROJECT/seo-opportunities   Reddit threads already ranking
                                                    on Google for the keywords
    GET $BASE/projects/$PROJECT/pain-themes         what the leads keep complaining
                                                    about, clustered
    GET $BASE/projects/$PROJECT/usage               today's AnyAPI spend for this
                                                    project

## Triage is yours, acting is the human's

For each lead, decide whether it is a real buyer worth a conversation, and tell
your user what you concluded and why. Quote the poster's own words back to them;
the `reason` field is the app's one-line judgement, and your job is to check it
against the body rather than repeat it.

There is no sending in this product, and no reply writing either. No DM queue,
no browser extension, no comment posting, no outbox, no drafted replies.
**Hide** and **not a fit** are actions the human takes in the app, and they are
the only two states a lead moves into by hand. If your user asks you to reply to
a lead, the words have to come from you or from them: hand them the text and
point them at the `url` field. Reddit punishes generic outreach and so do the
subreddits; a specific, peer-to-peer message that references the actual post is
the only kind worth sending.

## Where the money is

Every lead carries `costUsd`: the dollar cost of the AnyAPI call that fetched
the post behind it. It is often a fraction of a cent. `GET .../usage` sums
today's spend for a project and splits it two ways that matter:

- `fetched` is calls this project actually paid for.
- `reused` is calls served from data another project had already bought, which
  cost this project nothing.

If a user asks "what is this costing me", answer from `usage`, per project, in
dollars. Do not estimate, and do not turn a per-lead cost into a projection
unless they ask for one.

## Connecting over MCP

The same API is available as an MCP server over streamable HTTP at `/api/mcp`,
with the same Bearer key:

    {
      "mcpServers": {
        "lurk": {
          "url": "https://<this instance>/api/mcp",
          "headers": { "Authorization": "Bearer rl_sk_..." }
        }
      }
    }

Tools: `list_projects`, `list_leads`, `get_lead`, `list_seo_opportunities`,
`list_pain_themes`, `get_usage`, and `describe`, which returns this guide.
`list_leads` takes the same filters as the REST call.

## Errors

Every error is the same envelope:

    { "error": { "code": "...", "message": "..." } }

Codes: `unauthorized` (401, missing or wrong key), `not_found` (404, or a
project that is not this user's), `invalid_request` (400, a filter value this
API cannot read), `rate_limited` (429, back off until `Retry-After`), and
`internal_error` (500).
