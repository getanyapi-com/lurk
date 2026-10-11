# X opportunity ranking candidate

Version: `x-attention-2026-10-10.1`. Draft PR #131; not merged/deployed and not independently validated.

## What changed

The X tab's New view reads one ranked stream from the existing evaluation window. Workflow state no longer determines priority. Screened, held, rejected and already-scored pending-context posts can be displayed without becoming a lead. The initial pane may open a strong uncertain opportunity. Below a visible priority floor, weaker/unscored cards remain in the same stream; if all are weak, the page says so and does not automatically front one as a good match.

The computation uses cached Jev evidence only:

```
need priority = own_need × max(same_kind, supported_job)
                × (expected_intent + 1)/5
                × (1−rival_vendor) × (1−promoting) × (1−resolved)
```

Expected intent uses a valid stored 0–4 distribution, normalized for rounding, or the **unrounded raw score** when probabilities are absent/malformed. Missing inputs make the affected path unassessed, not an invented zero. Personal/free use has no automatic commercial penalty; a supported basic job can outrank a specialised-brief neighbour classification.

A completed positive reply check preserves public conversation opportunities with a bounded term `0.5 × founder_would_reply × fit × (1−rival_vendor)`. This path is computed independently: absent adoption-only inputs do not erase an otherwise assessed conversation. It requires the pipeline's final `reasonCode=worth_reply`, raw `reply.worth_reply=true`, no reply failure/code, and valid founder, fit and rival signals. A raw positive alone is insufficient: the pipeline also checks shape/moment, required checks and a verbatim quote. Missing legacy provenance disables only the conversation path. Priority is the maximum of the available paths; neither available means null, while a valid zero stays zero. The marker is provenance, not permission to include merged rows excluded by the reader.

Explicit unmet requirements multiply each available path by .2. A failed public-reply assessment disables conversation priority and adds “Public reply not recommended”; **it no longer multiplies independent adoption priority by .3**. Unknown/malformed requirements and context are annotations, not penalties. A `none_stated` assessment gets a neutral detail-only compatibility caveat, not a list-wide check: lack of an identified requirement does not verify fit. No requirement-confidence threshold or platform-specific extraction was added. New keeps one card per author, with date/engagement as tiebreaks. History keeps each marked post.

These are heuristics, **not calibrated probabilities or expected financial value**. Priority stays internal to ordering; list and detail use descriptive pills instead of numeric scores. All above-divider opportunities say “Potential match,” irrespective of their old lead/held/filter state; requirement and context checks remain separate annotations. Legacy fit/intent verdicts do not determine New’s badges, since they do not determine its order. Unknown requirements still do not reduce priority; a higher position is not proof of verified product compatibility. Below the provisional .4 divider, rows say “Weaker match” (or “Unassessed”), with quieter headlines, backgrounds and avatars. Hover, keyboard focus and selection restore emphasis, and all posts remain reviewable. History retains the familiar badges without applying this divider. The divider is guidance, not deletion or an alert threshold. The reader ranks the entire bounded date window before author deduplication and its 200-row display cap. It respects project words, mutes, unavailable posts, lead statuses, existing ask-score filters and answered conversations.

The pipeline previously changed failed reply checks to restore the ordinary buyer fold to the stored evaluation instead of leaving the old reply-route score on it. This iteration changes the display reader only; existing historical rows are not mutated. Internal replay diagnostics retain each path separately, never in the blind packet or user-facing numeric display.

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
  --out .context/x-audit/ranking1010/another-new-directory \
  --seed lurk-iteration-20261010-r1
```

Use a NEW output directory for each run; existing evidence is never overwritten. This CLI loads no environment or DB, imports no API client, and blocks `fetch`. It produces `replay.json` (hashes, rankings and blind attribution) and `review.html` (no score, stage, source method or model label). Owner choices can be downloaded locally; nothing is sent to X or another person. This is the same candidate retrieval arm, not a comparison of two search pools.

The frozen Oct 2–9 development replay covers 415 candidate product/posts:

| Check | Result |
|---|---|
| Clipy free recorder for a few videos | 11th in old groups → 3rd in new order |
| Clipy already-recorded app-review story | 1st in flat old-score sort → 18th in Oct 9 ranker → 10th in Oct 10 ranker: known first-page regression |
| Clipy first nine new cards | Two previously model-supported and seven model-conditional cases |
| Grenseo screened complaint | 2nd in new order, still not verified exact technical fit |
| Tally / Scarlett | No card clears the provisional .4 divider |

These are unblinded sanity checks. Formula choice was informed by inspected examples; labels are model-generated; overlapping development data cannot demonstrate better user utility, recall, conversions or an unseen week. The cheap ranking fix does not establish that retrieval finds enough useful conversations.

### Oct 10 review-driven semantic iteration

Astra and Fable reviewed the route/evidence separation, with an implementation round after edits. They agree this corrects interpretation of cached inputs, not that it improves user usefulness. Astra's requirement-uncertainty critique was adopted: detail-only compatibility disclosure and conservative malformed-choice fallback. Fable's proposed `.7` requirement-mass cutoff was not adopted: it is another unvalidated threshold selected using inspected examples. Removing weaker-row muting was deferred because it conflicts with the explicitly requested visual distinction. The provisional .4 divider still collapses differing evidence levels; it is not a calibrated good/bad boundary.

Before/after replay used identical saved posts and seed, in separate `before/` and `final/` output directories under `.context/x-audit/ranking1010/`; `after/` and `comparison.json` are preserved intermediate evidence, not final-source annotations. `final-comparison.json` references the final source hash; numerical order is unchanged from the intermediate run. There are 415 posts and 363 retained authors. Above-divider counts stay Cal.com 1, Tally 0, Clipy 3, Grenseo 1, Scarlett 0 (total **5**). Seventeen author priorities rise after removing the public-reply penalty. The ordered first ten change on four projects: unchanged above-divider counts do **not** establish unchanged first-page usefulness. Besides the already-solved Clipy story, Tally's promotional comparison rises 19th→8th and Cal.com's ambiguous Lemon post rises 22nd→10th. These regressions expose unreliable cached job/resolution/promotion signals; no weights were retuned to hide them.

Independent conversation handling changes **zero cards in this archived corpus**: its missing-adoption-input behavior is covered by unit and reader/CLI integration fixtures, not evidence of newly recovered real prospects. The archived corpus also has no raw-positive-plus-failure-code example; that contradiction is fixture-tested only. The Mac request still stores `none_stated` despite explicitly asking for Mac: its detail caveat does not extract that constraint or verify Mac support, and the list still cannot distinguish it from a genuine no-specific-requirement request. Fixing that stored assessment remains deferred, as does the divider's compression of differing evidence strengths. No new retrieval, owner choices or conversions occurred. Unit coverage also checks failure override, absent marker/fit, malformed choices, valid zero and unmet scaling. Reader/CLI integration verifies the final marker reaches the ranker and route diagnostics do not enter the blind packet. Fresh full check: 970 tests across 106 files, including all four database-backed opportunity-reader cases (`check-final.log`); build passes. The actual archived preview displays the neutral caveat, with zero jobs, scans or usage rows afterwards. No real conversation-only example exists to render; that missing-adoption-input case remains fixture-only.

## Prospective review protocol — previous freeze superseded

### Oct 11 experimental task-reading contract (offline only)

`src/lib/x/taskReading.ts` is a separate experimental contract, version
`x-task-reading-2026-10-11.1`. **It is not called by judgeX or the display
ranker.** No historical signals are rewritten. It asks for the particular
product-linked task, author ownership/state, and author/fact citations, so a
completed recording cannot be confused with an unresolved app-review problem.
Personal, community and free use remain valid; missing product support stays
unknown, not incompatible. Parents cannot supply an author's own need.

Seven independent choice questions replace the existing requirement question
and add six others. Source maps contain the actual normalized/truncated author
sentences and exact supplied fact fields. A cited requirement verdict remains
provisional: citation existence cannot prove the inference, and one fact cannot
establish support for every restriction. Invalid requirement citations degrade
to unknown without changing the raw answers.

For a valid task-relation distribution, the experimental task factor is
`P(own_open) + P(own_evaluating) + P(unknown) × legacyTaskFactor`, where the
legacy factor is `own_need × (1−promoting) × (1−resolved)`. Missing/malformed
distributions or invalid citation IDs retain the legacy factor. Uncited
relation mass backs off to unknown; absent task linkage moves all own-task mass
to unknown while retaining grounded non-adopter mass. The selected label alone
cannot change the numerical result for the same distribution and citations.
No one-hot probabilities are fabricated from reviewer choices.

The source-blinded development probe freezes 100 archived posts (first 15
retained-author cards plus five seeded remaining cards per project). Astra's
independent reference is separate from the candidate extraction. Fable's
extraction and implementation reviews failed at the provider; a fresh blinded
Astra session continues extraction, explicitly a same-model-family surrogate,
not a Fable result. Agreement is not owner utility or Jev accuracy. Without actual new Jev
probabilities, the experimental numerical sort cannot be evaluated. The
acceptance criterion remains fewer determinate evidence errors, no new
determinate false closures, and no project losing useful first-ten cards; an
inconclusive result or unchanged sort is **not a win**. Evidence and model
disagreements are retained in `.context/x-audit/evidence1011/`.

Reproduce a source-only export (no environment, DB or model-client imports):

```
npx tsx scripts/x-task-contract.ts SOURCE_PACKET NEW_OUTPUT.json
```

Existing output is refused. The measured complete-question block grows from
20 to 26 questions, with a median 4,774 additional serialized question bytes
(about 30%) and a median 1,144-byte extra fact map on this sample. These are
local payload measurements, **not billed tokens, dollars, latency or real
provider adherence**. Same call count does not imply unchanged cost.

#### Development probe result and next hypothesis

The 100-card categorical probe is **inconclusive, not an improvement**.
The two blinded Astra passes agreed on 91 task classes, left five inconclusive,
and disagreed on four potentially useful but ambiguous questions. Those four
are not proven missed adopters. Requirement-label differences fell from 38 to
nine, but different definitions of core job, hard restriction and optional
interest prevent interpreting that as 29 corrected errors. No actual Jev
probabilities were produced; no numerical ranking improvement was measured.
One reference quote in a long Tally post was outside the scorer's bounded
head/tail input; full-text reference is not automatically identical evidence.

The separate reference pass over all 114 cached Tally posts found 112 Skips,
one Investigate and one Insufficient. The investigation is an ambiguous
complaint about CPA intake forms, not a clear open request to create a form.
This is a weak cached retrieval pool, not evidence that Tally lacks demand.
Free and personal use were not excluded. Ranking alone cannot create missing
prospects; the saved earlier scout already tried some basic job/first-person
queries, so those are not unexplored retrieval ideas.

The next separately versioned hypothesis is `x-open-task-2026-10-11.2`:
`xOpenTaskQuestions` adds a genuine joint NOUL for a still-open author adoption
task, with source/fact diagnostics; `xOpenTaskFactor` uses it only with valid
citations and a non-unknown relation. Missing or ambiguous evidence retains
the old graded factor. It does not turn a chosen label into certainty. This
hypothesis remains **offline and not enabled in production**. The pure
OpenRouter wire serializer/parser is shared with the app in `jevWire.ts`;
Gateway adherence is not established by an OpenRouter-route comparison.

Forty paired requests are frozen (six nonoverlap and two declared diagnostics
per project), with exact app `candidateOf`/state/question parity verified.
The input correction strips a leading reply handle in one case; earlier
artifacts remain preserved. A separate source-blinded Astra reference labels
these 40 as two Reply, four Investigate, 30 Skip and four Insufficient. These
are proxy judgments, not owner choices or unseen validation.

The prepared comparison sorts a fixed 131-card context, overlaying the same
40 fresh pairs in both arms while leaving 91 cached cards equal. Diagnostics
also get an excluded sensitivity comparison. Incomplete pairs remain cached
in both arms and an incomplete trial cannot establish a win. Raw answers and
archived checked-reply provenance are preserved. Joint-factor coverage,
unchanged-question drift, requirements, first-ten movements and actual billing
must all be reported. The executor and evaluator check frozen hashes and
request/journal provenance. Six isolated fake-fetch billing/error fixtures
pass; these do not measure API behavior or actual cost.

### Authorized paid scoring results, Oct 11

Kevin authorized **$5 cumulative testing spend**, not $5 per run. This does
not authorize fresh X scans or production changes. Historical audit costs are
separate. Every new attempt is journalled; unresolved charges retain a full
conservative reservation against the total.

The 40 paired actual Jev comparison completed with 80 usable responses and
$0.021785988 recorded cost. A dated model alias initially stopped execution;
the first response was retained once after verifying the exact alias. The
joint factor activated on only 2/40 cases. First-ten model-reference useful
counts did not improve on any project. Astra and Fable's saved independent
reviews found no accepted win; Fable's T3 task was subsequently cancelled by a
server restart, so its surviving written review is not a terminal approval.
The diagnostic-excluded sample was mostly below the head, limiting its ability
to reveal first-page effects.

A 30-response locator-option text diagnostic cost $0.009568272 and did not
improve role citation/joint coverage. A separate 20-response role-instruction
probe cost $0.006258: role citations rose 1/10 to 8/10 and joint activation
1/10 to 6/10. This fixes a mechanical evidence-locator problem, not owner
utility. It also exposes joint replacement raising some publishers.

A predeclared 60-card cached-head comparison then used two identical baseline
controls and the role-wording candidate, comparing both joint replacement and
a conservative fold retaining existing promotion/resolution suppression.
All 180 usable responses were obtained across 182 attempts. Two transport
failures remain unknown-cost; their combined $0.145152 reservation is retained.
Successful responses were reused unchanged through two separately journalled
continuations, with request/hash provenance. The second continuation extended
only the network timeout; prompts, labels, formulas and acceptance criteria
were unchanged. This head test recorded $0.045114930.

All four rankings retain the same model-reference useful first-ten counts:
Cal.com 4, Tally 0, Clipy 9, Grenseo 2, Scarlett 1. Joint activation rose to
42/60, but **neither candidate met the predeclared improvement criterion**.
Valid citation IDs do not prove entailment. Content-scheduling/appointment
scope confusion and crawler-access/causal-attribution support errors persist.
The conservative fold reduces some publisher uplifts by construction, not as
independent evidence of better understanding.

The fixed **131-card replay context**, not the full 415-post corpus, contains
known-reference useful totals of 4/1/11/2/1. Its known-label first-ten ceiling
is 18 against the measured 16; four unresolved reference cases remain unknown.
Three projects have no additional known-useful card to recover within this
context. Tally's ambiguous intake complaint and two Clipy cases remain below
the first ten. This is neither a global retrieval ceiling nor owner truth.

At completion of the head test, cumulative known cost is **$0.082727190**,
plus **$0.145152 reserved** for unknown charges. The authoritative continuing
ledger is `.context/x-audit/evidence1011/testing-budget.json`; this paragraph
is a dated checkpoint, not the remaining budget for later runs.

Artifacts: `actual-comparison-r17.json`, `binding-results-r20.json`,
`role-results-r22.json`, `head-results-r29.json`, all purchase journals and
continuation amendments in the ignored evidence folder. Source-blinded model
references remain development proxies, not human preferences, unseen
validation, calibrated probabilities, conversions or measured global recall.
The task contract remains offline; no revised factor is enabled in production.
The previously recorded full source check passed 979 tests across 107 files;
that historical software check is not new API or usefulness proof.

### Standalone direct-attention experiment, Oct 11

The next first-principles hypothesis judged worthwhile investigation directly,
instead of replacing a marginal factor. Both independent preparation reviews
found the same blocker: mixing a standalone scalar on grounded posts with a
legacy product on ungrounded posts. This was corrected **before purchase**:
every valid scalar, including zero with `none` citations, drives need attention;
locators are diagnostics only. The unbought r30 is preserved and superseded by
r32. A subsequent native amendment review was interrupted without a completed
approval; none is inferred. Root verified the correction and frozen hashes;
seven isolated fake-fetch fixtures passed, including zero with absent task
linkage, with zero real API calls.

All **131 cached replay-pool cards** received three fresh calls: identical
baseline A/B and candidate containing the same 20 baseline questions plus one
holistic NOUL and three primary-task/role/fact locators. Actual app input
construction and body equivalence across the preparation amendment were
verified. The candidate reads a supplied fact map; this is a bundle comparison,
not an isolated causal estimate of a single question. No old intent/fit/
promotion/resolution multipliers are applied to the holistic scalar. Existing
checked-conversation provenance remains required. No display-floor,
qualification, alerts or production integration changed.

The 393 requests all returned usable responses, with **$0.097261374** recorded
cost and no new unknown charges. Candidate reference-useful first-ten counts
are **4/0/8/2/0 (14 total)**, versus **4/0/9/2/1 (16)** in both controls. Tally's
first model-reference useful case moves 16th→21st; Scarlett's moves 3rd/4th→11th.
The candidate loses one useful first-page case each on Clipy and Scarlett.
It **fails** the frozen more-useful/fewer-Skip/no-project-loss criteria. The
same conclusion holds with the predeclared bounded-source sensitivity treating
one fuller-text Tally reference as Unknown. Unknown reference cards cannot
establish a win by merely replacing Skips.

Evidence: `HOLISTIC_PROTOCOL_R32.md`, `holistic-freeze-r32.json`,
`purchases-holistic-r32.jsonl`, `holistic-results-r32.json` and the unchanged
per-case raw answers in the ignored evidence directory. Fable's completed
actual-result review independently verified all 12 hashes, 393 unique usable
responses and the recorded receipts, and rejected the candidate. Its source
audit identifies wrong-operation, helper and promotional uplifts; it also
disputes several development reference actions. Neither those disputed actions
nor cross-scale replicated score differences establish owner truth or statistical
significance. Grenseo's reported AUC was tied, not worse. Astra's completed actual-result
review also independently verifies the execution and rejects r32. It distinguishes
source errors from debatable preferences and proposes a small sequential
coherent-frame diagnostic with explicit source-entailment contrasts, not an
accepted fix.
A count regression against model references alone does not prove every disputed
opportunity is worthless. The candidate is **not integrated**.

Cumulative recorded scoring API charges after this test: **$0.179988564**,
plus **$0.145152 reserved** for two earlier unknown charges. The same $5 overall
cap leaves **$4.674859436 unencumbered** at this checkpoint. Model-review
subscription usage is not represented as scoring API receipts. Cheap execution
has been measured; useful lead recovery has not. No fresh X retrieval,
production changes, owner review, unseen validation or conversions occurred.

### Preference diagnostic and next mechanism preparation, Oct 11

A zero-cost blinded preference packet is prepared, not completed. Its reproduced
selection is the union of 19 model-reference-useful cards, 34 distinct first-ten
boundary movers against either control (two useful overlaps), and four unknown
references: **55 unique archived cards**, not the reviewer's approximate 42.
The packet hides previous grades, positions, reference actions and model
attribution. Exact bounded author words, supplied context, bios and product
briefs remain available. Save / Investigate / Reply / Skip / Not sure and optional
rationale export locally; missing and unsure choices remain unknown. Kevin's
choices are proxy preferences unless the project-owner identity is established.
They do not authorize outreach or measure conversion. Selection is conditioned
on prior results, not unseen validation; because not every first-ten position is
included, do not derive full precision@10 from this packet. Desktop/mobile
render and isolated interaction/export checks passed with zero external calls.
No choices have been collected or automatically transmitted.

Artifacts: `OWNER_PROTOCOL_R35.md`, `owner-freeze-r35.json`,
`owner-review-r35.html` and separate public/private packet JSON in the ignored
evidence directory. The HTML contains no previous scores or private mappings.

A separate **24-case coherent task-frame extraction probe** is concretely
prepared for independent review, not bought: 16 named development failure/
disagreement cases plus eight deterministically selected positive-retention
controls. It asks a cheap structured-output model to describe actor, exact
operation/object/output, concurrent tasks, task-local temporal state, adoption
openness and explicit versus unknown requirements, with source quotations.
There are no lead labels, scalar grades or fitted coefficients. Existing
same-call independent locators did not test conditioning a second call on such
a frame. Mechanical citations still do not establish entailment; every frame
must pass an independent source audit before preparing a later paired scorer.
No edited successful frames may be selectively passed onward. A successful
extraction probe alone would not establish ranking usefulness or owner demand.

`FRAME_PROTOCOL_R36.md` and r36/r38 plans are preserved as unbought preparations.
Fable's completed r37 review supports a source-mechanism probe, with concrete
pre-purchase gaps: fixed source expectations/threshold, output/reasoning bounds,
a genuine Grenseo control, citable background and no example-answer leakage.
The r40 preparation addresses those classes. Its eight controls include a real
Grenseo tracker request; the system prompt uses generalized operation rules;
all supplied brief fields and bio are citable. This uses Gemini rather than Jev,
so even a pass would be a model/design-bundle result, not proof that sequential
architecture alone helped.

The review also exposed earlier reviewer overclaims. The Microsoft/SSO post
actually discusses booking pages and Calendly; a completed switch is plausible,
not uniquely established. Grenseo's supplied brief explicitly mentions citations
driving AI answers; exact answer-specific attribution remains unknown rather
than proved absent. One evaluator p0 can concatenate an author's self-thread:
the saved recorder inquiry is separate from its earlier traffic invitation.
The extractor still sees only the bounded combined input and must not invent
chronology. Preserve these alternatives in the pre-purchase expectation sheet.

`FRAME_PROTOCOL_R40.md`, `frame-plan-r40.json` and ignored `run-frame-r40.mjs`
provide concrete serial mechanics, with no second-stage scorer prepared. Sixteen
isolated fake-fetch fixtures pass (36 simulated POSTs, **zero real calls**),
including durable pending reservations, reasoning/token cap failures, malformed
JSON, exact quotations, shape bounds, tamper detection and near-cap rejection.
The executor defaults to no-network dry run. Explicit reasoning off is enforced
in the request and must be proved by actual usage before a response is usable;
missing reasoning usage stops rather than becoming zero. Array limits are in the
schema; executable validation additionally enforces bounded free strings.

The 24-attempt local ceiling is **$0.50 within the same $5 cumulative cap**.
The pending reserve is widened conservatively to the full published input AND
provider output maximum, including reasoning: **$0.360448 per pending attempt**,
not expected spend. Previous unknown charges remain reserved. Public catalog
price/context/capabilities must match frozen metadata, requests have provider
price/parameter guards, and any uncertain failure stops without automatic retry.
Astra completed 24 pre-purchase expectation rows containing 122 source rules
and 261 exact citations, all independently checked before a 12-artifact freeze.
Fable's completed r41 mechanics review found no concrete budget/security defect;
its earlier snapshot lacked the expectations/freeze that subsequently landed.
That review is not approval of later changed hashes or evidence of utility.

#### Actual frame smoke and stopped continuation

The r40 first call returned billing and zero reported reasoning tokens, but a
validator incorrectly classified signature-only Google metadata as thought
content. It stopped after **one call, $0.0015295**. The raw response, source and
frozen expectations remain unchanged. A narrow r42 representation amendment
allows recognized signature-only metadata only when usage reports zero thinking;
nonblank thought text remains rejected. Eighteen zero-call fixtures pass, including
both metadata cases. It also requests explicit usage receipts, as Fable advised.

The continuation reused that already-paid response with journal/request hashes
and proof its charge was already in the cumulative ledger; it did **not** retry
or charge it twice. Two fresh responses cost **$0.0024185**. The second stopped
on two exact source quotations exceeding the frozen 160-code-point limit (the longest
was 202 points). No source text or generated frame was shortened or patched.
The stop is a mechanical length failure, not itself proof of bad understanding.
A wider quotation limit has been inspected **offline only**, not promoted to
primary acceptance or used to call a completed trial.

Exactly **three actual unique frames**, not 24, were bought for **$0.003948**.
Their interpreted task, completion and requirement assertions are now under
independent Astra/Fable source audit against the immutable expectations. That
will distinguish genuine source errors from permitted inference before further
purchases. The formal full-trial pass cannot be met by these partial outputs;
two-stage architecture or ranking efficacy has not been disproved or proven.
There is no second-stage scoring call or production integration.

At this checkpoint cumulative recorded scoring receipts are **$0.183936564**,
plus unchanged **$0.145152 unknown-charge reservations**, leaving
**$4.670911436 unencumbered** under the same $5 overall cap. No new uncertain
charge occurred; no fresh X, DB/production/config, retrieval or display change.
Evidence: `FRAME_AMENDMENT_R42.md`, both preserved purchase journals/freezes,
`frame-execution-results-r40.json`, `frame-execution-results-r42.json`, and
`frame-partial-analysis-r43.json` in the ignored folder. Actual-source reviews
are pending and are not represented as approvals.

The previously proposed **2026-10-10 06:00 UTC–2026-10-17 06:00 UTC** freeze is invalidated by this version change after its start. Do not use that date with the new ranker to call an overlapping comparison frozen or unseen. All iteration replays remain development evidence. Before inspecting a subsequent corpus, freeze the final ranker hash, version, .4 floor, seed, and a new chronological window that starts after the freeze. No replacement window is scheduled or declared independently unseen here.

1. Export the next same-format local audit snapshot on the five existing projects. No run is scheduled or new spending authorized by this document. If comparing scout retrieval too, keep its budget and pool provenance separate; $.153 was an observed past experiment, not a guaranteed future cost.
2. Run the offline CLI with `--validation-after <new-frozen-window-start>`. It rejects earlier included posts. This date check **does not prove nobody has seen them**; record prior inspection and author/thread overlaps separately.
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
