# Buyer-first pipeline candidate

Implemented on the October 6 saved corpus, without new searches, provider
calls, model calls, production edits or a rollout. This is a concrete runtime
candidate, not a claim that the experiment has passed fresh validation.

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
  “I”; a generic invitation to share startups is different. This prompt change
  has not been re-asked against the saved corpus.
- Bump scorer and lane versions. Existing shown cards are not retroactively
  changed; these rules apply when a post is actually judged/re-scored.

The real judge already received saved capabilities, exclusions and a product
brief. The earlier blind packet only supplied a short summary. Its uncertain
labels therefore do not establish that the runtime was missing product facts.
Missing endpoint/feature support must not be invented to improve a metric.

## Exact saved-answer result

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

## Rollout decision

The candidate is reviewable in the PR; it is not merged or deployed. The
saved evidence supports removing clearly misrouted buyer cards and examining
the recovered request, but not a broad rollout verdict. Before deployment,
validate fresh judging/search on an untouched window with an explicitly agreed
spend and quality target, including the known Held-buyer tradeoff. No such
fresh spend or production change was performed in this work.
