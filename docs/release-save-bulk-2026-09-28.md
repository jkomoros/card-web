# Save and bulk-edit release validation — 2026-09-28

Status: **ready for the limited three-commit save/bulk-integrity release**.
The full suite and signed-in real DEV checks at 40,225 existing cards pass.
The synthetic 50k memory failure also occurs on the deployed version and remains
open under #522/#659. This is not a memory fix, a 50k editing acceptance result,
or clearance to ship the separate principled-mutations architecture.

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
not been completed. The first baseline attempt reached 39,694 cards without a
crash, then hit its ten-minute harness timeout. That incomplete attempt is not
proof that the candidate introduced the OOM; the longer paired runs must resolve
the comparison. It also does not establish equivalence between the generated
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
corrected locally to inspect the corresponding raw card in the store. Neither this timeout nor the
same timeout in a 2,000-card diagnostic is evidence of an application defect.
The 12k emulator also logged its 10,001-message transport limit, but attributing
the invalid timeout to that limit would be incorrect.

The 2,000-card run independently completed the same bulk/recovery and single-save/
navigation steps; the retained intermediate result records 20 down and 20 up,
returning to the original ID. These smaller runs cannot clear the 50,000-card gate.

## Corrected rapid-create check

The corrected 2,000-card run completed with exit 0 and exact server verification.
It created three distinct private working-notes cards, saved exact bodies on the
first two, and verified a collection count increase of exactly three. It observed
the automatically opened editor for each new card; the earlier extra Edit click
was another harness mistake, reproduced as an invisible-control timeout.
Find was closed and focus cleared through actual Escape key events before the
create shortcut. No semantic/corpus drain was inserted between save and creation.

Observed create times were 152/134/106 ms; the first two saves settled in 156/130 ms.
These are local-emulator observations, not production latency promises. The normal
single-save body matched on the server, and 20 down/20 up returned to the starting
card. Navigation p95 was 18 ms, above the existing advisory 16 ms budget; the run
passed its correctness/counter gates, not every advisory timing budget.
Evidence: `result-2000-actual-editor.json` in the local evidence directory.
Earlier runs with weaker measurement assertions are not counted as acceptance.
These checks do not establish full architecture cutover. Existing issue #775
(obsolete creation replay recreating a
later-deleted card) is not fixed by this stack.


## Harness audit during the continuation

A separate Sol audit identified misplaced Playwright timeout options in the
release-only harness. Parent independently reproduced the signature mismatch:
a 40 ms option passed as the second argument used the 200 ms default; passing
`null` before the options enforced 40 ms. Most affected waits requested the same
30-second default, but editor-close and Find requested five seconds. The passing
2k result recorded those operations at 74 ms and 257 ms, respectively, so the
wrong timeout did not hide a violation in that result. Corrected next-run copies
are retained locally. Rapid-create waits already passed explicit arguments and
options correctly.

The initial bulk round-trip comparisons verify selected domains, not every field
in the document. A stronger next-run comparator checks all authoritative fields
except the expected `updated` clock. Parent independently verified its positive
clock control and six negatives: changes to notes, todo, sort order, permissions,
an added field, and a missing body all fail. The general multi-edit comparison
still covers its explicitly selected fields; it is not whole-document proof.


## Instrumented 50k continuation

The candidate subsequently completed cold loading with exactly 50,000 cards in
both page and Worker, authoritative sync live, and a persisted 50,000-card compact
snapshot. The same process then restored all 50,000 cards from that snapshot on
reload, but its renderer crashed before warm verification reached live. This is
not a complete acceptance pass and no editing checks ran at 50k.

Parent independently parsed the new minidump: PID 64334, 2026-09-28 15:25:04 UTC,
`v8-oom-location = Scavenger: semi-space copy`. Dump SHA-256:
`c23602c24e560c609f3f06b5bbccbe6fabb03a46ac5104b1a3f0be696b117fce`.
The final sampled V8 used heap was approximately 805 MB in the page and 2.81 GB
in the corpus Worker. These are separate-isolate samples, not exact crash-time
heaps or process RSS. Sampling performed no forced GC and changed no heap limits.
The cold-run Worker peaked at a sampled 2.78 GB and later dropped below 1 GB after
natural collection; the successful cold retry disproves the earlier inference
that merely reaching fewer cards established a candidate-specific regression.
The paired baseline result below establishes that the fixture can also exhaust
memory on the deployed version; it does not prove the two versions have identical
memory behavior.


## Matched deployed baseline

The fair baseline run used deployed revision `294fcb56`, the same retained 50k
fixture, Chrome for Testing 1228, default V8 heap, and the same separate page/Worker
sampler. It reached 41,020 cards, then crashed during cold loading. Parent
independently parsed its minidump: PID 65348, 2026-09-28 15:40:04 UTC,
`v8-oom-location = MarkCompactCollector: young object promotion failed`.
Dump SHA-256: `0b1c60cd65dec5ea808c720d08cd0b17a94ca6bdf35b6dbb672fe3a177910b60`.
The final sample at 40,121 cards was page 269 MB and Worker 2.34 GB. The dump, log,
samples and machine-readable summary are retained under the local `failures/`
evidence directory.

This proves that the synthetic default-heap loading failure is present in the
deployed version. It does not establish equivalence of peak memory, clear the
candidate's warm failure, or verify candidate editing at 50k. A preliminary run
was deliberately stopped before cold completion and separately retained because
its planned pre-warm IndexedDB export would have added allocations absent from
the candidate run. The fair run performed no export and never reached warm load.


## Real DEV corpus validation

On 2026-09-28 PDT (2026-09-29 UTC), the owner signed into DEV in the in-app
browser. The local production bundle was served at `localhost:8081`; the app
showed DEVMODE and the signed-in editor. After activating the offered service
worker update, all 40,225 existing DEV cards loaded and the app reached up to date.
Parent independently compared all five source/build anchors with the recorded
`a2fe204e` manifest; all matched. No DEV deployment or production write was needed.

Through the real UI, three private working-notes cards were created:
`c-009-cad523`, `c-004-cff586`, and `c-105-ebc984`. The first two received distinct
validation bodies and the third stayed blank. A direct Admin read explicitly
scoped to `dev-complexity-compendium` proved exact bodies, private working-notes
types, unique IDs, and an authoritative count increase from 40,225 to 40,228.
The three cards were then selected in their own collection and bulk edited with
Bits and Bobs plus Prioritize card. A second authoritative read proved all three
had `tags: ["bits-and-bobs"]` and `auto_todo_overrides.prioritized: false` (the
app's prioritization representation). Every unrelated field matched the pre-edit
document; only the two intended fields and `updated` were excluded from comparison.

UI automation observations, including control/verification overhead:

| Operation | Observed time |
| --- | ---: |
| First save to editor close | 710 ms |
| Create second note to editor ready | 1,572 ms |
| Second save to settled status | 1,759 ms |
| Second save through immediate third-note editor ready | 3,080 ms |
| Three-card bulk tag plus prioritization to settled status | 2,762 ms |

These are not CPU profiles, production guarantees, or an improvement ratio against
the deployed code. The first creation's early snapshot timing is excluded because
it preceded editor readiness. The first save-to-create check incorrectly looked
for a drawer creation button absent in the `none` collection; the subsequent
sequence used the normal working-note shortcut without semantic-drain delays.

Twenty ArrowDown and twenty ArrowUp events each changed the active card URL;
the return path exactly reversed the outward sequence and ended on the original
`section-half-baked` card. The first endpoint assertion compared URL spellings
and rejected the default section URL versus the explicit same-card URL; the card
identity and reverse sequence were independently checked. Automation p95 was
32 ms and maximum 64 ms, not isolated application frame times.
A further warm reload reached up to date with all 40,228 cards. Its precise latency
was not captured; the successful state is the evidence.

Local evidence: `real-dev-before-bulk.json`, `real-dev-bulk-result.json`, and
`real-dev-ui-result.json`. Three private DEV-only validation cards remain for
inspection. The real DEV corpus is smaller than production's reported 47k+;
this does not retroactively turn the synthetic 50k failures into passes.
The preexisting memory risk is already tracked by
[#522](https://github.com/jkomoros/card-web/issues/522) and
[#659](https://github.com/jkomoros/card-web/issues/659).


## Final release assessment

A final separate Sol adversarial review found no verified blocking issue for this
bounded release. Parent directly performed the DEV UI flows, independently read
all three documents from the explicitly selected DEV backend, verified complete
unrelated-field preservation, checked build hashes, and parsed both candidate and
baseline crash dumps. The recommendation rests on those observations, not only
on the reviewer's verdict.

The 500-target bulk latency increase is an explicit correctness tradeoff;
5,000-target completion and synthetic 50k editing remain unverified. Real DEV
has 40,225 original cards, not the reported 47k+ production corpus. Existing
memory issues #522/#659 and lifecycle issue #775 remain open. These limits must
not be described as resolved by this release.

Final build-freshness and deployment-deadline checks pass. Read-only remote-master
verification still returns `294fcb5630e930a7ae09c3c3ad85900e42ad0dd5`. No runtime
source changed during this validation, so the full suite applies to the same
payload. Production release, backup, deployment, reindex and tag push remain for
the owner to initiate using the environment block above.
