# Save and bulk-edit release validation — 2026-09-28

Status: **not cleared for release**. Build, suite and bulk-integrity checks pass,
but the 50,000-card browser validation failed during corpus loading.

## Scope

The runtime candidate is `a2fe204eaa67bf627c95df120e6581b2184fbf8f` in the main
checkout, containing the ordered fixes `0c2f15f9`, `d11b5f4c`, and `a2fe204e`.
The separate principled-mutations architecture worktree is excluded.

The public production deployment stamp and remote master both identify
`294fcb5630e930a7ae09c3c3ad85900e42ad0dd5`; the production stamp reports a clean
2026-09-20 deployment. This is the verified comparison baseline.

## Completed checks

- Fresh full suite on the identical candidate in the isolated landing worktree:
  2,158 passing tests across 90 suites, including 200 Firestore Rules tests.
- Fresh production frontend/service-worker build in the main checkout.
- Cloud Functions lint and build, build-freshness check, and deployment deadline check.
- Production SEO generation: 1,241 public cards read, local pages generated.
- Read-only Firebase and gcloud project-access checks, and Git remote connectivity.
- Separate Sol adversarial review found no new verified product-correctness blocker.
- Sol repeated causal source negatives in a private regular-file checkout, rebuilding
  each variant: disabling incomplete-selection refusal produced 2 failures; restoring
  it produced 2 passes. Disabling concept-cache refresh produced the intended duplicate
  title promotion failure; restoring it produced 19 passes. Parent inspected the actual
  assertion failures, rather than counting build/import failures as negative evidence.

The full suite includes authoritative tag no-op classification, concurrent-write
preservation, account/permission changes during commit, failure/retry, lost
acknowledgements, and complete tag-plus-priority target coverage.

## Bulk-edit comparison

Sol executed the real browser tag executor against the deployed baseline and candidate
with Worker mode on, watermark live, 2,000 fixture cards and 500 selected targets.
Both updated exactly 500 intended cards, rewrote zero already-matching cards, and
restored the original membership exactly.

| Operation | Deployed baseline | Candidate |
| --- | ---: | ---: |
| Add tag to 500 targets | 4.35 s | 7.21 s |
| Reapply to 500 already-matching targets | 0.004 s | 2.84 s |
| Restore original membership | 5.15 s | 7.23 s |

The candidate remains under the existing 20-second gate at this selection size.
It does additional authoritative work to avoid dropping intent based on stale local
labels. This is a correctness tradeoff, not a claim that every bulk edit is faster.
The runs overlapped another corpus load, so precise comparative percentages are not
quiet-machine acceptance measurements. A separate Worker-off diagnostic is retained
but is not used as shipping-mode evidence.

A separate 5,000-target probe did not complete authoritative final verification.
The write stream ran, but the Admin verification stalled; it is not an accepted
5,000-target result or a basis for extrapolating performance to entire collections.

## Release environment

The ignored local `.firebaserc` now selects `complexity-compendium`. This is needed
because release generates SEO pages from the selected project before its later
`firebase use` step. No production write was made to configure this local selection.

The following environment was checked on this machine:

```sh
cd ~/Code/card-web
export PATH="$HOME/.nvm/versions/node/v20.20.0/bin:$HOME/.nvm/versions/node/v21.7.1/bin:$HOME/Code/sdk/google-cloud-sdk/bin:/Applications/Xcode.app/Contents/Developer/usr/bin:$PATH"
export CLOUDSDK_PYTHON=/opt/homebrew/bin/python3
npm run release
```

Node is 20.20.0; the second Node installation supplies the Firebase CLI executable,
not the runtime. The explicit Git and Python paths avoid the system Xcode-license
problem. The release command itself was **not run**. It performs the configured
production backup, deployment, embedding reindex and release-tag push; tests are a
separate prerequisite and are not invoked by that command.

## Evidence and limits

Local evidence is retained under the ignored directory
`test/perf-harness/baselines/release-validation/`: full-suite and causal-negative
logs, comparison summaries, source/build hashes, and the release-specific browser
runner. No successful 50,000-card browser result exists from this validation.

The browser runner uses the production bundle, signed-in admin, Worker ownership,
watermark sync, and the real service worker. The stronger assertions require the
20-down/20-up navigation sequence to return to its starting card, reject save errors,
and verify exactly three new private cards and their exact bodies on the server.

The first 50k attempt exhausted the emulator's 4 GB heap while exporting its fixture;
it is not counted as a product result. A 12 GB heap retained the fixture successfully.
A subsequent headless-shell run lost its renderer at 46,413 loaded cards. The matched
macOS crash report establishes SIGTRAP, not an OOM cause. Its log and crash report are
retained under `release-validation/failures/`. The full Chrome for Testing retry
also crashed, after reporting 23,516 loaded cards. Parent independently parsed the
minidump's process ID (61911) and timestamp (14:26:35 UTC), and read its annotation:
`v8-oom-location = MarkCompactCollector: young object promotion failed`.
This establishes a renderer V8 heap OOM in this run. It does not establish whether
the three fixes introduced the failure: an equivalent deployed-baseline run has
not been completed. It also does not establish equivalence between the generated
fixture's memory demand and the real production corpus.

The isolated emulator uses byte-identical copies of the generated Rules and indexes;
the retry preserved all assertions and exited on the browser crash. Increasing the
browser heap was not used to turn this failure into a pass.

A separate 12,000-card diagnostic in installed Chrome completed cold and warm
loading, authoritative 100-card tag/general multi-edit round trips, lost-ack
recovery, and the single-save/20-down/20-up interaction function. The full run
failed at the first rapid-create wait, but that timeout was a **harness defect**:
`PERF_HARNESS.activeRawCard()` returns only ID, body and modification error; the
new predicate incorrectly required its nonexistent `card_type` field. Parent
verified the actual API implementation and the impossible predicate. It has been
corrected locally to inspect the corresponding raw card in the store, but the
corrected rapid-create check has not been rerun. Neither this timeout nor the
same timeout in a 2,000-card diagnostic is evidence of an application defect.
The 12k emulator also logged its 10,001-message transport limit, but attributing
the invalid timeout to that limit would be incorrect.

The 2,000-card run independently completed the same bulk/recovery and single-save/
navigation steps; the retained intermediate result records 20 down and 20 up,
returning to the original ID. There is still no complete rapid-save/create result,
and these smaller runs cannot clear the 50,000-card gate.
Earlier runs with weaker measurement assertions are not counted as acceptance.
These checks do not establish full architecture cutover. Existing issue #775
(obsolete creation replay recreating a
later-deleted card) is not fixed by this stack.
