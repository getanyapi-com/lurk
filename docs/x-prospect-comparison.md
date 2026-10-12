# Actual prospect-inbox comparison, October 9

## Decision

**Keep PR #131 draft; do not ship this candidate.** It produces a narrow
manually reviewed shortlist gain, not a dependable automatic-leads improvement.
No additional paid retuning run follows this result.

Five existing local projects, fixed October 2–9 seven-day window. Ten isolated
copies ran original `cbdcfd4` versus frozen candidate `2c121fd`, with existing
seed slots pinned, at most two pages per lane in each arm, the same $0.48
conservative per-arm guard and $1 overall ceiling. Explicit backfill bypasses
normal per-project daily pools. This is not a free-tier recurring benchmark,
seed-generation evaluation or current production verification.

## Actual inbox counts

| Project | Old Leads | New Leads | Old Maybe | New Maybe | Supported old → new, both groups |
|---|---:|---:|---:|---:|---:|
| Cal.com | 1 | 2 | 6 | 5 | 1 → 1 |
| Tally | 0 | 0 | 5 | 11 | 0 → 0 |
| Clipy | 1 | 2 | 16 | 35 | 1 → 2 |
| Grenseo | 1 | 1 | 0 | 2 | 0 → 1 |
| Scarlett | 1 | 0 | 8 | 11 | 0 → 0 |
| Total | 4 | 5 | 35 | 64 | 2 → 4 |

“Supported” means worthwhile to review against supplied basic capabilities,
not guaranteed fit, willingness to pay or conversion. Conditional platform/
intent/performance cases do not count as supported. GPT-6.1-Sol individually
reviewed all 75 unique posts visible across the two inboxes with stored parent
context, available bio and saved facts. This was unblinded, model judgement,
not human ground truth. The corpus contains 415 unique product/posts; no
exhaustive recall/precision claim is made about that corpus or all X.

Maybe includes Held **and** the UI's worth-a-look filtered band. Actual UI
readers/order were used, then fixed time bounds; no Leads/Maybe group was truncated (worth rows sort first in the capped filtered list).
Top-five Leads and top-five Maybe are recorded separately in the evidence.

- The Cal.com Calendly switcher remains a worthwhile basic scheduling prospect
  in both arms, without a promise of the optional form feature. New also
  qualifies an already-built-scheduler article, not an open buyer need.
- Clipy retains the few-video/free-alternative shopper only in Maybe and
  recovers the camera/editing request into Maybe. Known basic capabilities
  support a trial/demo discussion, not unlimited free use or unspecified
  editing quality. Two new qualified Mac asks are conditional because supplied
  facts never establish Mac support. Ubuntu and another Mac ask also need
  platform confirmation. Many remaining posts are vendors/solved cases.
- Grenseo gains a specific AI visibility tracker request, replacing a weak
  vendor/tutorial venue in its qualified feed. Explain $49+ pricing rather
  than assume budget fit.
- Tally has no supported prospect. Its Maybe grows from 5 to 11 and is dominated
  by patients/respondents/customers using someone else's forms, not buyers.
- Scarlett has no supported prospect. The original qualified card describes
  the author's startup in response to a startup-description prompt, not
  shopping. New avoids qualifying it, but still puts it in Maybe.

Only two projects gain a supported prospect, below Astra's proposed practical
three-project bar. No supported old prospect vanishes if Maybe is included,
but supported qualified cards remain two in both arms and Cal.com's qualified
noise worsens. All four supported examples were already in development
corpora; this overlapping week is not independent validation. Reply checks
remain pending under the ordinary stop-after-unanswered policy; they are not
judged negatives. No global X recall, conversions or statistically established
precision improvement.

## Runtime and execution

Candidate changes only basic-job eligibility and bounded request retrieval:
fresh supported_job can override a narrower neighbour, but missing support,
non-product-seeking, mandatory requirements, seller, own-need and other checks
remain. Two specific saved categories get separate request lanes and broader
generic question phrasing; normal request scans may follow a second full page
within existing daily budgets. No product config edits or seed-model calls.

Clipy hit an existing UTF-16 truncation bug. Execution-only patch `80d1319`
prevents parent context ending in a lone surrogate. Resumed pending evaluations
on the same copy with all lane next_due_at in the future: zero search pages,
no changed query/scorer/policy. The initial partial run and repair/resume are
separate durable records, not an overwritten trial. One later Jev fetch failed.

## Cost and verification

- Recorded local data $0.042180 + models $0.146668 = **$0.188848**.
- Conservative total **$0.198848238**, including $0.01 for the failed fetch;
  under $1. Returned response prices and rounded local ledger agree otherwise.
  Not reconciled invoices. Shared caches affect incremental per-arm costs.
- 761 HTTP responses, one failed fetch, no unaccounted started request IDs.
- Policy candidate: typecheck, full lint, **946 tests / 100 files** passed.
  Unicode repair: typecheck, full lint and **47 real-DB X-run tests** passed,
  including the regression. No paid calls in tests; no fresh build claim.
- Isolated copies were disabled and unstarted scan jobs removed; no production
  changes, alerts, outreach, merge or deployment.

Frozen private evidence is ignored in `.context/x-audit/prospects1009-5/`:
manifest/snapshot hashes, original baseline runtime, policy/execution commits,
request journals, raw run and resume outputs, per-card `review.json`, cost
ledgers, full `REPORT.md` and self-contained interactive `inbox.html` with
actual post links, excerpts, fit/caveats, age, known-example markers and exact
old/new placement. Raw customer evidence is not committed.
