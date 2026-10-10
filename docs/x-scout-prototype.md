# Cheap adaptive scout: experiment, not production

**Decision: API cost is plausible; meaningful commercial usefulness is not yet demonstrated.**

On 2026-10-09, a bounded GPT-6.1-Sol loop developed searches for five existing
projects, observed search results, refined queries and saved a reusable recipe.
The next chronological 24-hour window ran those recipes without another planner.
GPT-6-Luna triaged posts; Sol verified selected candidates with parent/profile
context and supplied product facts. No production pipeline or project was changed.

## What happened

All figures below are **measured incremental API dollars**, not forecasts.

| Project | Scout | Saved-query day + triage | Strong verification | Supported requests, baseline → recipe |
| --- | ---: | ---: | ---: | --- |
| Cal.com | $0.02096 | $0.00060 | $0 | 0 → 0 |
| Tally | $0.02938 | $0.00170 | $0.00263 | 0 → 1 |
| Clipy | $0.02589 | $0.00143 | $0 | 0 → 0 |
| Grenseo | $0.02776 | $0.00191 | $0 | 0 → 0 |
| Scarlett | $0.02209 | $0.00272 | $0.00412 | 0 → 0, plus one conditional case |

Total across scouting, both comparison arms, triage and verification:
**$0.153203525**. This includes 31 Sol calls, eight Luna calls, 54 X searches,
two profile lookups and one parent lookup. All 96 purchases settled with a
reported cost; no unknown-charge reserves were needed and none exceeded its
pre-request reservation. Each project's entire trial cost $0.02351–$0.03573.

The fixed-query baseline retrieved 20 product/posts; saved recipes retrieved 39.
There were 57 unique product/post pairs across both arms. Both arms had identical
triage prompts/model except the recipe's learned negative rules. Baseline queries
were the previously saved baseline lanes, **not the full old production pipeline**.
Both daily arms had a $0.01 allowance; actual spending was not equalized.

### Actual usefulness

- Tally: one explicit Google Forms replacement request. The author wants a site
  to create their own form, which supplied Tally facts support. This appears to be
  personal/community use: **not proof of a high-value business buyer**.
- Scarlett: an author wants help with too many WhatsApp messages. The parent is
  Grok-bot feedback; a Grok connector might be required and is not a supplied
  Scarlett capability. The profile suggests a hotelier, but client-message use
  and Google Calendar are unestablished. **Conditional, not a qualified lead.**
- A manual pass through retrieved snapshots also found a Jotform-limit complaint
  that cheap triage skipped. Tally's unlimited submissions plausibly help, but the
  author says they plan to fix it that day. Current unresolved status is unknown.
  This is a near miss, not an additional proven prospect.
- Neither selected candidate was present in the saved earlier audit JSON/JSONL
  corpus searched for its id. Nevertheless, these windows overlap development
  data and this is **not an independently frozen unseen holdout**.

The root model reviewed retrieved snapshots and the selected proof cards. This
is model review, not human ground truth. No outreach, reply, sign-up, payment or
conversion was measured. No recall/precision percentage or significance claim
is justified by two selected cards or by the retrieved-only universe.

## Economics: what is and is not established

One planning session cost 2.1–2.9 cents; one saved-query day cost 0.06–0.27 cents.
That contradicts the assumption that **this bounded form** necessarily costs a
lot. It says nothing about unlimited per-lead agents, broad web investigations,
or running an agent continuously.

An illustrative scenario of four sessions at each project's observed scout cost,
30 days at its observed replay-day cost, plus a **$0.30 verification allowance**,
comes to about **$0.40–$0.47/project/month** in incremental API spend.
This is arithmetic on one day, **not a measured monthly operating cost**.
Future volume, search coverage, recipe decay, cache behavior, failed calls,
verification demand, infrastructure and human review may change economics.

The proposed $1 allowance is four $0.10 scout sessions, $0.30 retrieval/triage and
$0.30 verification. The prototype enforces only the current trial's phase caps:
$0.10 scout, $0.01 per daily arm and $0.06 combined verification per project.
It is **not a deployed monthly-budget service**. Exhaustion does not silently
upgrade a model, add retries, or invent a fallback strategy.

**Do not ship on these results.** Preserve saved strategies as experimental
artifacts. The next product criterion must be user-accepted, commercially useful
opportunities, not cheaper searches or more topical posts. Cheap triage is also
a possible loss point; the missed form-limit complaint is a concrete example.

## Reproduce / inspect

```sh
npm run x:scout-prototype -- \
  --manifest .context/x-audit/prospects1009-5/manifest.json \
  --out .context/x-audit/a-new-scout-run
```

**This command buys capped API calls.** It uses configured house credentials,
does not open a database, refuses an existing output directory and freezes live
model prices, product facts, windows and input hash before purchases. The strong
and cheap model price ceilings are checked against OpenRouter's catalog. Each
purchase is reserved and journaled before HTTP; missing billing consumes the full
reservation. Provider price overruns disable subsequent purchases.

The manifest accepts `products[]` with `name`, `source`, `facts` and
`lanes.baseline[].body`; use an exported project snapshot. Raw posts, purchase
journal, exact windows, saved recipes and manual review remain ignored at
`.context/x-audit/scout1009-5/`. The executed source snapshot is saved there too;
post-run hardening added global fail-closed behavior for provider overcharges.

Limits: English-only, one 20-post page per query, at most six scout turns, at most
three triage candidates per 30-post batch and six verification candidates per
project. No image inspection or product-document lookup. Supplied facts came
from the prior local project export, not fresh production/product-site checking.
Strategies were tested on their scout window and replayed on the immediately
following day; there is no multiweek longevity proof.

PR #131 remains draft. Nothing was merged, deployed or scheduled.

Verification after the prototype and fail-closed hardening: `npm run check`
passed typecheck, full lint and **950 tests across 101 files**. Spending-guard
tests cover concurrent reservations, unknown/failed billing, overcharges and
duplicate settlement. Test keys were removed by the suite's setup; the local
database container was restored to its prior stopped state.
