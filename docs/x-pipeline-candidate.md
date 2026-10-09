# Buyer-first pipeline candidate

Implemented on the October 6 saved corpus. The first evaluation replayed saved
answers; a subsequent bounded evaluation actually re-asked the model on 88
archived cases. A later five-project fresh test ran real X searches and both
full pipelines in isolated local copies. No production edits or rollout
occurred. The fresh test exposed a buyer regression: do not treat the earlier
regression-set result as a passed rollout experiment.

## Runtime changes

- Compile one category-plus-request lane from existing specific multiword
  artifact/job slots. No bare category search, new seed-model call, new budget,
  farm-screen bypass or venue privilege. It ranks after the first rival lane.
- Require intent level 3 (an ask for something to use) for buyer cards. Level 2
  advice/exploration can still take the separately checked conversation route.
- Read already-collected `wants_offering`, `hard_requirement` and optional
  `wanted_kind` answers. A neighbouring job, unsupported requirement or missing
  evidence goes to Held rather than being asserted as supported buyer fit.
- Recognize a verbatim, author-directed “recommend me/us” request when the
  existing intent and product-kind/offering/requirement evidence corroborates
  it. This resolves a contradictory low own-need score without changing that
  raw score or weakening seller, resolved, audience, parent or bio checks.
- Clarify the own-need prompt: asking for a specific tool to use need not say
  “I”; a generic invitation to share startups is different.
- Distinguish a stand-alone optional feature inquiry from a mandatory adoption
  constraint. Check every author sentence for constraints, independently of
  the chosen quote. Never infer a feature's support from category fit.
- Bump scorer and lane versions. Existing shown cards are not retroactively
  changed; these rules apply when a post is actually judged/re-scored.

The real judge already received saved capabilities, exclusions and a product
brief. The earlier blind packet only supplied a short summary. Its uncertain
labels therefore do not establish that the runtime was missing product facts.
Missing endpoint/feature support must not be invented to improve a metric.

## Initial saved-answer result (before prompt validation)

The replay executes the real `assess()` with archived raw answers and context.
Labels combine original model judgments with the attributed 66-card model
review. These are model labels, not human truth or verified buyer conversions.
AnyAPI is excluded below because it was the development product.

For the **broad arm's stored buyer cards**, not its entire feed:

| Label | Before | After |
|---|---:|---:|
| Buyer ask | 2 | 1 |
| Useful conversation, not buyer | 16 | 0 |
| Irrelevant according to model labels | 34 | 0 |
| Insufficient evidence | 4 | 0 |
| Total buyer cards | 56 | 1 |

The remaining card is Tally's survey request. The Cal.com switch inquiry moves
to Held because forms support was not established. This is an explicit loss
of one model-labelled buyer from automatic display, not a recall success.
In the baseline arm, its one buyer and two irrelevant cards all leave buyer
display. Existing conversation cards are not rechecked by this replay.

The direct-request rule additionally recovers one Grenseo tracker request from
the contradictory own-need rejection into **pending_context**. Its stored
judge level was search, even though the reply check had a bio. The replay does
not pretend a complete buyer assessment occurred or count it as a new card.

## Retrieval result and remaining misses

Within the saved labelled non-AnyAPI corpus, old lanes lexically select 29
posts including one buyer ask; old lanes plus the candidate select 108,
including three asks. This is **not search recall**: it precedes actual X
pagination, all free screens, thread recovery, deduplication and judging.

After the unchanged visible-term screen, the added request lane has 36 new
eligible labelled posts: one ask, two conversations, 32 irrelevant and one
insufficient. The new eligible ask is the Grenseo direct tracker request.
Other screens/author-page farm counts and final judgments remain unverified.
This result argues for keeping strong judging, not publishing retrieval hits.

The other Grenseo alternative request splits its category and request across
sentences, so the existing same-sentence rule still blocks it. Tally's survey
wording does not match the saved lane vocabulary; its original discovery was
through a thread. Do not claim those cases were recovered or add observed
test phrases solely to manufacture a passing recall metric.

No thresholds were swept to maximize a score. Nevertheless, inspecting and
changing rules on this corpus makes it development evidence, not a held-out
test. One surviving labelled buyer cannot establish reliable precision.
Useful-conversation yield and fresh search cost still need separate validation.

## Reproduce the file-only comparison

The frozen ignored evidence is retained in the existing checkout:

- `.context/x-audit/wk1006/candidate/inputs.json`: read-only export of local
  audit copies' full raw answers, contexts and product facts; hash
  `c45a53db183f`. Never recreate it by scanning or overwrite it with live state.
- `.context/x-audit/wk1006/snapshot.json`, `setup.json`, `labels.jsonl` and
  `offline/model-adjudications.jsonl`: preserved earlier evidence.
- `.context/x-audit/export-candidate.mjs`: the local read-only exporter used;
  it rejects remote hosts and an existing export target.

```sh
npx tsx scripts/x-candidate-replay.ts .context/x-audit/wk1006
```

The command reads files only and writes `candidate/REPORT.md` and
`candidate/results.json`, including per-product/arm counts, unique buyer
conversations, changed fates and pending recovered requests. No `.env`, DB or
network connection is needed. Raw posts/answers remain ignored, outside Git.

## Actual model validation

Both judge versions received identical archived product facts, posts, parents
and available bios. AnyAPI was excluded; reply checking was disabled to isolate
buyer assessment. Baseline judge/gates/questions were frozen at `cbdcfd4`.
There were 55 previously reviewed regression cases and 33 previously unlabelled
cases. The latter were model-labelled before judge outputs and contained no
buyer asks. This is not a human-labelled, fresh-window population sample.

The first paired run exposed one mandatory requirement incorrectly treated as
optional. After tightening that prompt, the candidate was re-asked on all 88
frozen cases without changing labels. Final scorer: `x-2026-10-08.2`.

| Model label of complete buyer cards | Baseline | Final candidate |
|---|---:|---:|
| Buyer ask | 2 | 4 |
| Useful conversation, not buyer | 3 | 0 |
| Non-lead | 2 | 0 |
| Insufficient evidence | 4 | 0 |
| Total | 11 | 4 |

All complete buyers were regression cases. The candidate retains both existing
asks and qualifies both Grenseo requests. It keeps the Cal.com switch inquiry
without claiming forms support, while holding the explicitly required but
unverified priority-routing feature. Five uncertain regression cases are Held
and four rejected. Both arms produce zero buyers on the 33 unseen cases; with
no unseen asks, that sample cannot establish buyer recall or improvement.

Both arms leave one known generic startup-pitch invitation at pending_context.
It is not displayed as a buyer, but the intermediate error remains. Reply
checking and its useful-conversation yield are untested. Directly judging the
two requests still missed by upstream retrieval/screens does not recover them
end-to-end. Four correct model-labelled buyer cards cannot establish population
precision, global recall or conversions. This is encouraging development
evidence, not a guarantee.

Recorded model usage was $0.055396 for 264 successful responses (270 HTTP
attempts including retries), within the announced $0.10 bound. This is an
application ledger value, not a reconciled provider invoice. Only local
`llm_usage` was written. No additional X spend or production write occurred.

Evidence is preserved in `.context/x-audit/wk1006/validation/`: frozen manifest
`f7f14d255d86`, baseline sources, blind cards and labels, original paired and
final candidate outputs, call ledgers, logs, `REPORT.md` and `results.json`.
The file-only `analyze.py` regenerates the summary without model calls. Paid
runners refuse existing outputs; do not silently rerun or replace evidence.

## Fresh five-project test

The real old/new pipelines ran on isolated local copies of existing Cal.com,
Tally, Clipy, Grenseo and Scarlett projects, from October 6 at 23:00 UTC through
October 8 at 05:54 UTC. One page per lane, with every compiled lane; the audit
backfill removes normal per-project daily pools. Existing seed slots were
explicitly pinned, including stale caches. Seed generation and current live
production configuration were not tested. Actual retrieval, free screens,
parents, bios, Jev judging, Muse reply checks and local lead writes ran.

The two-arm/reference union contained 404 unique product/posts. A displayed
card census and deterministic non-displayed sample produced 202 blind cards,
individually labelled by GPT-6.1-Sol before inspecting their pipeline fates:
2 asks, 8 conversations, 188 non-leads and 4 insufficient cases. These remain
model labels, not human truth. The reviewer knew study context and aggregate
progress. None of the selected cards was in the older labelled sample;
authors overlapped, so this is not an author-independent holdout.

- Baseline displayed **one buyer, no conversations**; candidate displayed
  **no buyers, one useful Cal.com conversation**. Neither displayed card was
  model-labelled false/unknown. With one card per arm, precision is not reliably
  established; a zero-buyer feed is not a precision win.
- Clipy's free Screen Studio alternative request was an old-pipeline buyer
  but became Held/wrong_job. The saved facts support basic recording/editing
  and a first-recordings trial, while the generated brief calls a general
  recorder a neighbour. The model selected that neighbour despite same_kind
  75% and requirement met. This contradiction needs resolving, not a blanket
  removal of neighbour or constraint checks.
- A second Clipy request for face-camera recording and editing appeared only
  in the broader reference: both capped pipelines missed it. This is a miss
  in the reviewed retrieved sample, not a global-recall estimate.
- The candidate retrieved a useful Grenseo measurement workflow but its
  no_visible_term screen stopped it. Reference searches also found Tally
  creators with form failures and delivery glitches that both arms missed.
- Recorded data $0.048740 plus models $0.038949 = **$0.087689**, under the
  announced $1 ceiling. Costs are ledger values, not reconciled invoices;
  shared query/profile reuse makes arm costs incremental. The interrupted
  runner resumed unfinished copies without rerunning completed arms.

Frozen evidence is in `.context/x-audit/fresh1008-5/REPORT.md`, with manifest
`b3cead998ea2`, snapshot `d702048cd844`, blind packet, immutable outcome files,
labels/provenance and file-only `analyze.py`. No production or live-feed write,
alert, merge or deployment occurred. The capped reference is not exhaustive;
two reviewed buyers in one project are too little for a broad quality verdict.

## Rollout decision

### Offline follow-up after independent review

[The positioning replay](x-positioning-replay.md) checks saved briefs and
7,519 stored answer sets without new calls or runtime changes. A hypothetical
`positioning_conflict` reason keeps five Clipy cases unqualified; removing the
neighbour veto outright would instead qualify one fresh model-labelled ask,
three archived model-labelled non-leads and one conversation. The final
88-case regression replay is unchanged. These are development diagnostics,
not a fresh win or a shipped fix.

The fresh counts above refer to qualified cards only: the candidate also has
two user-visible **Maybe** cards, one model-labelled ask and one unlabelled.
The Clipy request was demoted, not hidden. Claude Opus 5.5 disputed several
conversation labels; the original blind labels remain preserved, not silently
changed after observing outcomes. Do not loosen screens on those labels alone.

The candidate is reviewable in the PR; it is not merged or deployed. The
archived comparison supports cleaner classification on known regressions, but
the fresh full-pipeline test exposed a lost buyer and another retrieval miss.
**Do not ship this candidate on this evidence.** Resolve the contradictory
product-job descriptions and request coverage, freeze a new candidate, then
evaluate a new window with more positives. Keep mandatory-requirement, seller
and context checks; do not tune on these misses and claim independent success.

## October 9 actual prospect-inbox comparison

[The seven-day comparison](x-prospect-comparison.md) supersedes the rollout
recommendation above. Candidate `2c121fd` allows a narrower neighbour when a
fresh judgement says the supplied product explicitly performs the core job,
while retaining other checks; splits two specific category request lanes;
and adds generic question phrasing. A second full recurring request page is
allowed inside existing daily budgets. Scorer/lanes version October 9.1.

Actual Leads + Maybe yielded four supported prospects vs two for original
`cbdcfd4`, but only Clipy and Grenseo gained a prospect. Supported qualified
cards stay two in both arms; Maybe grows from 35 to 64, two newly qualified
Mac requests lack platform evidence, and all four supported cases were
already in a development corpus. Cal.com's qualified top-of-inbox noise
worsens. This is a narrow shortlist gain, not reliable generalized utility.

GPT-6 Astra also corrected the earlier offline inference: old labels calling
three archived Clipy examples non-leads do not prove they are noise; the text
contains real recorder requests. No ground truth is manufactured from those
labels. The original immutable evidence remains unchanged.

A Unicode truncation bug interrupted Clipy. Execution-only patch `80d1319`
resumed pending evaluations in the same copy without search pages or policy
changes. Recorded total $0.188848; conservative accounting $0.198848238
including a $0.01 reserve for one failed fetch, under $1.

**Keep PR #131 draft. Do not merge/deploy on this evidence; stop this bounded
evaluation without another retuning run.** No source project/production
changes, notifications or outreach. Raw evidence stays ignored under
`.context/x-audit/prospects1009-5/`; the linked actual inbox is the deliverable.
