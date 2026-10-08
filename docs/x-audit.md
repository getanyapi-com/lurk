# Buyer-first X audit

The audit is a research tool, not a production query rollout. Buyer needs
(`ask`), useful conversations (`reply`), irrelevant posts (`not`) and missing
evidence (`insufficient`) remain separate. Model-generated labels are not
human ground truth. AnyAPI is a development/tuning product and excluded from
the validation aggregate by default.

## Reanalyse existing evidence without spending

The original corpus lives in ignored `.context/x-audit/<tag>/`. Raw customer
posts and labels must stay out of Git. Preserve the original `REPORT.md` and
labels: offline output goes in a separate directory.

```sh
# Once, if a snapshot does not already exist. Requires the local audit DB.
npm run x:audit -- snapshot --tag wk1006

# Reads files only: no .env, database, provider or model calls.
npm run x:audit -- offline --tag wk1006
```

`snapshot` refuses remote database hosts and runs a repeatable-read, read-only
transaction. It captures the current stored evaluation state, not an immutable
event log of what happened at run time. The snapshot is frozen once exported.
Its setup/content hashes and the sample text are checked during analysis;
missing posts or text drift cause a failure rather than silent exclusion.

`report` is an alias for `offline`; it no longer reads changing DB rows. Labels
come from the frozen tag's `labels.jsonl`. An optional `--exclude Name,Name`
overrides the default exclusion. Excluded products still appear as development
rows, but not in the aggregate or screening diagnostic verdicts.

Generated files in `.context/x-audit/<tag>/offline/`:

- `REPORT.md`: exact observed label counts, displayed-post metrics and narrow
  lexical/screening comparisons, with their limitations.
- `analysis.json`: separate buyer/conversation card metrics, unique
  product-author-conversation counts, unlabelled cards, pending stages, stored
  score top-five proxies, recorded loss reasons and all failed stored buyer
  conditions. A first rejection reason is not causal attribution.
- `review.html` and `review-packet.jsonl`: a blind packet with every original
  ask, every high-weight positive and up to two additional examples per
  product/stage stratum. No original verdicts, arms or weights are embedded in
  the page. Product facts and any supplied parent text are historical context.
- `review-selection.json`: selection reasons and packet hash; keep this hidden
  during review. The packet deliberately oversamples positives and must not
  be used to estimate population precision.
- `REVIEW-RUBRIC.md`: evidence requirements and label definitions.

## Human adjudication

Open `review.html`. Enter your reviewer name, choose a verdict and explain it.
Buyers require an author need quote, a capability supported by the supplied
product facts, evidence the need is unresolved, and why replying helps.
Conversations require supported capability and useful-reply evidence. Missing
facts belong in `insufficient`; do not invent context or product capabilities.

The page saves browser-local drafts where storage is available and downloads
attributed JSONL. It submits nothing to Lurk or X. Keep the downloaded file:
the inline page's local storage is not a durable evidence ledger. Partial
downloads are accepted, but incomplete positive evidence is not.

```sh
npm run x:audit -- offline --tag wk1006 \
  --adjudications /absolute/path/adjudications.jsonl
```

Reviewed results go in `offline-reviewed-<hash>/`, leaving original evidence
unchanged. Unreviewed labels remain explicitly model-derived. A reviewer-name
field records attribution; it does not by itself prove human review.

## Sampling and uncertainty

Future `sample` runs partition the union of both arms into nonoverlapping
product/post strata. A post shown by either arm is in a census; judged/unfinished
and screened-only posts are sampled independently with frozen deterministic
seeds. Every displayed post is included, even if one author posted repeatedly
in a conversation. Each sampled post has weight `post population / posts
sampled`. Zero-budget strata are unknown, not zero losses. Existing samples
cannot be overwritten by rerunning the command.

Conversation deduplication happens only in separate metrics. It must never be
mixed with post-level weight denominators. A `sampling.json` version-2 manifest
records units, populations, keys, weights, window and setup hash. Weighted
category estimates require valid nonoverlapping strata and complete sample
labels. Missing/unsampled strata make estimates unavailable.

The October 6 corpus used conversation deduplication against raw post
denominators and has no valid version-2 manifest. Its old weights remain
**unvalidated**. The tool lists high-influence examples for review but does not
guess corrected population loss/recall estimates from the saved sample.

Displayed buyer fractions use labelled cards, with unknown-card counts and
noise bounds explicit. Wilson ranges are descriptive and not adjusted for
author/conversation clustering. Weighted category ranges sum per-stratum
descriptive Wilson ranges; they are not a pooled 95% interval. A census has no
sampling uncertainty within that corpus, but still has labelling uncertainty.

`insufficient` is unverified, not confirmed noise: definite noise counts only
`not`, while upper noise bounds include insufficient and unlabelled cards.
Model adjudication can be imported without waiting for human review, as long
as the reviewer explicitly identifies the model and does not claim human
ground truth or personal founder willingness. Only the reviewed subset is
relabelled; the remainder retains its original model judgments.

## What offline comparisons can establish

- Query-shape comparisons are lexical candidate coverage within the labelled
  sample. They do not replay X ranking, query filters, depth or global recall.
- The whole-own-post alternative changes only term matching, not venue
  listicle rules or reply routing. Passing that rule does not imply the judge
  would display a lead.
- Activity-filter diagnostics inventory the labelled posts stopped at that
  first rule. Historical per-search-page author counts are not archived, so
  full downstream recovery is unknown. Do not claim a complete screen replay.
- Stored gate signals reveal simultaneous failed buyer conditions without
  loosening thresholds. Missing signals remain unknown; existing quotes have
  not been independently revalidated by this diagnostic.
- Stored-score top-five metrics are proxies, not the exact UI ordering.

Do not weaken `no_active_need`, remove farm checks, mine the lift table into
queries, or promote venue conversations into buyer alerts based on these
diagnostics alone.

## Next fresh validation (not run by this work)

1. Finish the blind adjudication and agree on buyer versus conversation utility.
2. Freeze a later, untouched time window and validation products. Exclude
   AnyAPI; prevent author/conversation overlap with development examples.
   The already-inspected October corpus is exploratory, not a clean holdout.
3. Predeclare buyer-quality target, tolerated noise per product-week, minimum
   per-product evidence, total spend and stop conditions. These values remain
   **unset** until explicitly agreed; historic caps/thresholds are not reused.
4. Test retrieval and each screening/routing change independently, including
   unique adjudicated buyer conversations, buyer-card precision, noise bounds,
   founder usefulness of conversations and measured provider/model costs.
5. Ship only after that independent verdict. Opening the audit PR does not
   authorize live runs, merging, deployment or production competitor changes.

The live `setup`/`run` commands are retained for a future authorized study:
`setup` can buy seed slots and creates local copies; `run` makes billed provider
and model calls. Backfill disables the normal daily per-project limits. Neither
is part of the file-only analysis workflow above.
