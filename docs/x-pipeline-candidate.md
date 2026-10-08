# Buyer-first pipeline candidate

Implemented on the October 6 saved corpus. The first evaluation replayed saved
answers; a subsequent bounded evaluation actually re-asked the model on 88
archived cases. No new X searches, production edits or rollout occurred. This
is a concrete candidate with regression evidence, not a passed fresh-search
experiment.

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

## Rollout decision

The candidate is reviewable in the PR; it is not merged or deployed. The
actual model comparison supports cleaner buyer classification on known
regressions, but not a broad rollout verdict. Before deployment, validate the
complete retrieval/screens/context/judge/reply pipeline on an untouched window,
with meaningful new positive cases, an explicitly chosen spend and quality
target. No fresh X scan or production change was performed in this work.
