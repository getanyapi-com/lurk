# X opportunity ranking candidate

Version: `x-attention-2026-10-09.1`. Draft PR #131; not merged/deployed and not independently validated.

## What changed

The X tab's New view reads one ranked stream from the existing evaluation window. Workflow state no longer determines priority. Screened, held, rejected and already-scored pending-context posts can be displayed without becoming a lead. The initial pane may open a strong uncertain opportunity. Below a visible priority floor, weaker/unscored cards remain in the same stream; if all are weak, the page says so and does not automatically front one as a good match.

The computation uses cached Jev evidence only:

```
need priority = own_need × max(same_kind, supported_job)
                × (expected_intent + 1)/5
                × (1−rival_vendor) × (1−promoting) × (1−resolved)
```

Expected intent uses a valid stored 0–4 distribution, normalized for rounding, or the **unrounded raw score** when probabilities are absent/malformed. Missing core signals mean unscored, not an invented zero. Personal/free use has no automatic commercial penalty; a supported basic job can outrank a specialised-brief neighbour classification.

A completed positive reply check preserves public conversation opportunities with a bounded term `0.5 × founder_would_reply × fit × (1−rival_vendor)`. This does not require the author to be shopping for themselves, and cannot be activated by an unverified high reply signal. Explicit unmet requirements multiply priority by .2; a completed negative reply assessment multiplies it by .3. Unknown requirements/context are annotations, not penalties. New keeps one card per author, with date/engagement as tiebreaks. History keeps each marked post.

These are heuristics, **not calibrated probabilities or expected financial value**. Display numbers are labelled priority, not a conversion percentage. The provisional divider is .4; it is visible guidance, not deletion or an alert threshold. The reader ranks the entire bounded date window before author deduplication and its 200-row display cap. It respects project words, mutes, unavailable posts, lead statuses, existing ask-score filters and answered conversations.

Failed reply checks now restore the ordinary buyer fold to the stored evaluation instead of leaving the old reply-route score on it. Existing historical rows are not mutated; the display ranker uses raw evidence and the failed check, not their stale score.

## What did NOT change

- Retrieval queries, paid allowances and API/model calls.
- Qualification, promotion, lead writes and alert eligibility.
- Quiet/weekly scheduling or lane pausing. These remain operational policies, not controlled by the display floor.
- Scoring-settings/alert scores. Their existing configuration continues to affect qualified ask eligibility; they are not reinterpreted as weights for this experimental attention score.
- Production product briefs/configuration, outreach, merge or deployment.

## Reproducible development check

```
npm run x:ranking-replay -- \
  --snapshot .context/x-audit/prospects1009-5/snapshot.json \
  --out .context/x-audit/ranking1009/implemented-replay \
  --seed lurk-ranking-20261009-r1
```

Use a NEW output directory for each run; existing evidence is never overwritten. This CLI loads no environment or DB, imports no API client, and blocks `fetch`. It produces `replay.json` (hashes, rankings and blind attribution) and `review.html` (no score, stage, source method or model label). Owner choices can be downloaded locally; nothing is sent to X or another person. This is the same candidate retrieval arm, not a comparison of two search pools.

The frozen Oct 2–9 development replay covers 415 candidate product/posts:

| Check | Result |
|---|---|
| Clipy free recorder for a few videos | 11th in old groups → 3rd in new order |
| Clipy already-recorded app-review story | 1st in flat old-score sort → 18th in new order |
| Clipy first nine new cards | Two previously model-supported and seven model-conditional cases |
| Grenseo screened complaint | 2nd in new order, still not verified exact technical fit |
| Tally / Scarlett | No card clears the provisional .4 divider |

These are unblinded sanity checks. Formula choice was informed by inspected examples; labels are model-generated; overlapping development data cannot demonstrate better user utility, recall, conversions or an unseen week. The cheap ranking fix does not establish that retrieval finds enough useful conversations.

## Frozen prospective review protocol

Before inspecting the next corpus, retain the ranker hash, version, .4 floor and fixed seed. Do not tune them during that review. Proposed chronological week: **2026-10-10 06:00 UTC through 2026-10-17 06:00 UTC**, after this candidate's development evidence. Changing the ranker after that week starts invalidates the pre-frozen comparison; use a later unseen window instead.

1. Export the next same-format local audit snapshot on the five existing projects. No run is scheduled or new spending authorized by this document. If comparing scout retrieval too, keep its budget and pool provenance separate; $.153 was an observed past experiment, not a guaranteed future cost.
2. Run the offline CLI with `--validation-after 2026-10-10T06:00:00Z`. It rejects earlier included posts. This date check **does not prove nobody has seen them**; record prior inspection and author/thread overlaps separately.
3. The packet interleaves old group order and new ranked order with deterministic seeded starting sides, deduplicating posts/authors. Hide attribution until choices are collected. Review the first ten per project and then skim remaining posts for misses. Do not equate interleaving credit with a directly measured standalone precision@10; separately report each ranker's retained top-ten positions against the choices.
4. Actual project-owner preferences are primary. Record Kevin's proxy choices separately. Mark Save / Investigate / Reply / Skip; model reviews cannot replace these choices or measure conversion.
5. Report useful choices in the displayed ten, first useful rank, useful cards below the floor/outside ten, duplicate reduction and review time. Count scout-only useful opportunities separately from ordering recovery. Missing/unreviewed choices are unknown, not skips.
6. Decision rule: if independently found/missed useful opportunities exceed the ordering recovery, prioritize retrieval. If coverage misses are near zero and owner usefulness improves, keep the simple ranking and stop adding ranking machinery. Do not call an ambiguous/tied comparison a win. A single small week is directional, not statistical assurance.
7. Track actual conversations and adoption later; they are different outcomes from willingness to investigate.

The packet/protocol are prepared. **No unseen corpus has been collected or owner review completed yet.** The PR stays draft pending that evidence.

## Inspecting the actual app locally

Use an isolated local preview database populated from the frozen snapshot, not an empty real project. Start `next dev` with `LURK_X_PREVIEW_ONLY=true`, `X_LEADS=true` and `RUN_SCHEDULER=false`; leave retrieval/model/email keys blank. Do not change `.env` or point this preview at production.

The development-only flag suppresses the X tab's start-on-open, rejects its Scan now action before queueing or charging an allowance, hides the scan button/status, and labels the page as archived data. It does not affect production. The regular project picker, date/status filters, ranked reader, styling and detail pane still work.

The Oct 9 local preview uses a separate database with all 415 archived candidate evaluations across five copied projects; no original project or frozen audit row is replaced. Verify its jobs, X runs and usage tables remain empty after opening/selecting/refreshing. This is UI verification, not fresh lead-quality validation.
