# Offline product-positioning check

Follow-up to Claude Opus 5.5's read-only review of the five-project X test.
This adds **offline diagnostics only**, not a runtime gate, query, product
configuration change or deployment. No new data/model calls were made.

## What was checked

- 13 saved product-fact versions across eight products: the five-project
  fresh snapshot, the full October 6 archived answer export and the final
  88-case actual-model validation. AnyAPI remains development-only.
- 7,519 stored answer sets: 59 fresh-window, 7,372 archived full-export and
  88 archived final-validation assessments. Arms/versions overlap; these are
  **not 7,519 independent examples or a new quality test**.
- Screened/unanswered evaluations were not resurrected. Two fresh ancestor
  evaluations have no text in the window-filtered post export and are listed
  explicitly as skipped. Search-level answers stay search-level.
- Original facts, answers, labels and reports were read, hashed and preserved.
  The replay blocks fetch, loads no `.env`, and calls no DB/scan/model function.

## Brief review flags

The checker flags a neighbour that names a listed competitor or shares at
least two meaningful words with a saved capability. It uses shallow word
inflections, not a semantic model. Eight saved versions across five products
were flagged. **A flag is a question to review, not a proven contradiction.**

| Product | Overlap to review | Interpretation from the saved facts |
|---|---|---|
| Clipy | General recorder/Loom and video editing vs screen/camera recording, Loom migration and editing capabilities | The narrow agent-workflow positioning and basic capabilities differ. Decide whether general recorder shoppers are intended buyers; don't auto-qualify them from capability overlap. |
| Tally | Dedicated e-signature service vs accepting e-signatures | A supported feature need not make the product a dedicated contract-signing replacement. |
| Grenseo | Search Console analytics vs aligning content plans with Search Console queries | Using a data source is not replacing that source's entire analytics product. |
| Lead Router | Inbound calls neighbour vs tracking/routing inbound calls | Review the segment distinction rather than assume all call-software buyers fit. |
| Popcorn AI | Broadcast marketing neighbour vs sending broadcast campaigns | Review why conversational-checkout positioning excludes a supported feature. |

Cal.com, Scarlett and the development AnyAPI version had no lexical flags.
This is not a clean bill of health: the checker misses semantic contradictions
without word overlap. Archive competitor names come from saved baseline lane
seeds, not a new complete export of current production competitors.

## Saved-answer gate replay

Two hypotheses were kept separate:

1. **Proposed conflict reason:** if a neighbour is the only remaining blocker,
   keep the post unqualified under `positioning_conflict` (Maybe, or waiting
   for context). It cannot become a buyer or auto-route to a paid reply check.
2. **Diagnostic ablation:** omit only `wanted_kind` in a temporary answer copy
   to see what the current assessor would do. This is not a proposed rollout
   and its results are not recovered buyers.

Both preserve the other scores, verbatim quote, seller, audience, own-need,
intent, context and mandatory-requirement checks. Unknown support is never
filled in. The helper is used only by the offline script/tests.

### Result

- The proposed conflict reason changes **five** assessments, all Clipy:
  the fresh Screen Studio request and four archived posts. **Zero new buyers**
  are automatically qualified; the fresh request already exists in Maybe.
- Removing the neighbour answer outright would qualify all five: the fresh
  model-labelled ask, **three archived model-labelled non-leads and one
  conversation**. This is evidence against treating removal as a free recall
  win. The original model labels remain disputed, not human ground truth.
- The final archived 88-case replay has **no changes** and matches its saved
  stage outcomes before the hypothetical policy. Its four regression buyers
  remain four; this is a regression check, not fresh validation.
- Replay stages are before the separate Muse reply check. They must not be
  presented as final UI feed counts or as a rerun of the historical baseline.

## Measurement corrections

The original fresh report counted qualified buyer/conversation cards, not all
user-visible cards. Held posts are visible in **Maybe**: the fresh snapshot
contains two candidate Maybe cards, one model-labelled ask and one unlabelled;
baseline has none. Do not call the demoted Clipy request hidden or rejected.

Opus disputed several of the original useful-conversation labels, including
the Cal.com workflow example, Grenseo vendor post and Tally customer notices.
Record that disagreement; do not silently rewrite the blind labels after
seeing outcomes. One qualified card per arm still cannot establish quality.

## Reproduce without paid calls

```sh
npx tsx scripts/x-positioning-replay.ts \
  --fresh .context/x-audit/fresh1008-5 \
  --archive .context/x-audit/wk1006 \
  --out .context/x-audit/positioning-check-new
```

Choose a new output directory: existing outputs are refused. The frozen
result for this follow-up is `.context/x-audit/positioning1008-r3/REPORT.md`
and `results.json`, including every changed assessment, neighbour/capability
review flag, source-file SHA-256, skipped rows and original stored stage.
Raw customer evidence remains ignored and is not committed.

## Decision

Keep PR #131 draft and the runtime unchanged. The offline conflict reason
offers a clearer explanation, **not better buyer recall**. Before implementing
a gate exception, settle Clipy's intended buyer segment and inspect the older
false-positive examples. Retrieval depth/question coverage is a separate
unimplemented hypothesis. Validate any frozen runtime changes in a different
window; this replay cannot establish global X recall or conversions.
