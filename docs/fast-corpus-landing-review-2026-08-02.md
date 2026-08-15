# Landing review: `implement/fast-corpus` — Rounds 13, 14 & 15 (2026-08-02)

> **Read Round 15 (the last section) first — it supersedes the earlier
> verdicts.** Rounds 13 and 14 are kept intact as the record of what was found
> and what each set of fix commits was responding to.
>
> Round 13: full-branch review (found the card-creation P0).
> Round 14: re-review of the five fix commits (all P0/P1s confirmed fixed;
> reproduced the renderer crash).
> Round 15: heap snapshot root-causes the crash; new P0 in the upgrade path;
> test-coverage audit; `functions/`+`tools/` review.
> Round 16: the three cutover blockers verified live (offline anonymous boot
> reproduced); two new P1s in the fixes themselves.
> Round 17: every Round-16 item verified fixed — the cleanest response round;
> remaining work is process-grade (tripwire date, CI, kill switch, crash).

# Round 13 — full-branch review

Independent pre-land review of the full branch (360 commits, ~48k insertions vs
`master`), run as six parallel review agents (default-path audit, write-path
data integrity, sync-engine robustness, UX-vs-master, performance,
release engineering) plus **live verification** against real DEV
(dev-complexity-compendium.web.app, admin account, 40,225 cards) using the
existing debug Chrome instance. Full `npm test` was run first: **green, 716
passing across 38 suites** including security.

Known items already tracked in `docs/fast-corpus-fix-queue.md` (U14, U25–U27,
C14, R16, R19, P11, P12, P18, P21, P22) are not re-reported.

## Verdict

**Not ready to land.** One P0 (card creation is completely broken at HEAD,
confirmed live), three or four cheap-but-real P1s, and — just as important —
the branch's own landing rationale is stale: the HANDOFF-BRIEF says "merge is
SAFE (all flags default off)," but the flags were **flipped to default-on on
2026-07-11** (`bbfdd89c`), and production hosting *force-enables* them. After
this merge, deploying master to prod hosting *is* the cutover. Every finding
below that says "flags-on" is describing the mainline path.

All of the merge-blocking items are small, localized fixes. The deeper
sync-engine risks are real but belong to the prod-cutover gate, not the merge
gate — provided the deploy-dev-only discipline actually holds.

---

## P0 — land blockers

### P0-1. Card creation is 100% broken: missing `endAtomicGroup()` in the card-create executor

`src/actions/data.ts:2198` calls `batch.beginAtomicGroup(intent.cardID)` and
the executor commits at `data.ts:2239` without ever calling
`endAtomicGroup()`. `shared/multi_batch.ts:240` unconditionally throws
`Cannot commit while a MultiBatch atomic group is active` in that state. The
same executor runs for **both** first-time creation and replay
(`createCard` → `runDurableAuxWrite(intent)` → executor), so:

- Every card create fails deterministically — plain create, forked card
  (`data.ts:2577`), and bulk import (`data.ts:2060`) all build intents through
  this executor.
- The failure is misclassified as transient: the user is told *"That card
  could not be created right now. It has been saved and will be created
  automatically when the connection recovers."* The connection is fine; the
  intent wedges in the aux-write queue and **every replay fails with the same
  error, forever** (verified across reloads: "retained for the next trigger").

**Live confirmation on DEV:** pressing the real UI shortcut (Cmd-Shift-M)
produced the console warning, the misleading alert, and a permanently wedged
`card-create` intent; a pre-existing wedged intent from an earlier session
(`c-633-abf790`, queued ~14 minutes before, app online, sync=live) confirmed
the permanence. Every other `beginAtomicGroup` site in the codebase pairs with
`endAtomicGroup` (`data.ts:623, 999, 1009, 1031, 1065, 1302, 1325`); only this
one is missing.

Introduced **yesterday** in `0579ae5a` ("Round 12 P0: stop the queue losing,
wedging, and mis-stamping user work") — the commit that hardened the queue
added the atomic group to the create executor without the closing call, and
card creation was evidently never re-driven on real DEV afterwards.

**Fix:** one line (`batch.endAtomicGroup();` before the commit), plus see
Meta-1 below — no test in the 716 catches an app-path card create.

---

## P1 — fix before merge

### P1-1. `nocommit*.txt` — private corpus-derived word dumps are committed

`nocommit.txt` (41KB), `nocommit_2.txt` (20KB), `nocommit_3.txt` (10KB) at the
repo root — ~8,000 lines of vocabulary tokenized from the owner's real corpus,
including an email address and personal names. Added accidentally in
`70d5ecd8`; referenced by nothing (grepped src/tools/test/shared/functions).
Merging puts them permanently in a public repo's history — delete before
merge (and rebase out if the history exposure matters).

### P1-2. Every image edit trips a false "Changed elsewhere" conflict

`src/durable-overwrite-guard.ts:59-66` compares guarded fields by identity
(`===`). `images` is the only object-valued field in
`NON_AUTOMATIC_MERGE_FIELDS` (`:23`), and `generateCardDiff` always emits the
whole array (`src/card_diff.ts:452`), so the recorded base array, the fresh
server-parsed array, and the update array are three distinct objects — the
guard reports a conflict on the **first** chunk of every save that touches
images. The user gets "Multi-edit paused… Changed elsewhere… Retrying
replaces those changes with yours; Stop discards your pending save" for a
conflict that does not exist; automatic resume permanently refuses
(`data.ts:1159-1161`). Recoverable (the stamped draft survives), but it fires
on a routine action, first try, and actively invites the user to discard
their save. `test/durable-overwrite-guard/test.js` covers strings only.
**Fix:** deep-compare non-primitive guarded fields.

### P1-3. Residual F8-class cross-tab erasure in the bulk-import queue persist

`src/aux-write-queue.ts:488-498` (`writePendingAuxWrites`, called only from
`runDurableAuxWrites:751`): `keep` is computed from a queue snapshot taken at
T0, `existing` is re-read at T1, and any id in `existing` but not `keep` gets
its **body key deleted** — which erases a sibling tab's intent queued between
T0 and T1. This is the same destructive pattern the per-intent-key rework
(`22095701`, F8/F5) was written to eliminate, surviving in the one bulk path.
If the sibling tab has closed (or its 8s attempt timeout passed), the queued
comment/card is silently gone; `repairIndexFromScan` cannot adopt a deleted
body. **Fix:** drop the delete loop, or only delete ids present in the T0
snapshot.

### P1-4. find-dialog's save-gating fields are not reactive

`src/components/find-dialog.ts:152-156`: `_saveEligible` and `_corpusStatus`
sit under a `@state()` decorator that applies only to `_userMayCreateCard`.
The create-stub "+" button renders `?disabled=${!this._saveEligible}` but
never re-renders when eligibility changes — open the link dialog during the
boot-verification window and the button stays dead after sync goes live (and
conversely can look enabled while actually blocked, clicks silently no-op via
the `:336` guard). One-line `@state()` fix; the same undecorated pattern
repeats in `card-view.ts:387-390`, `card-editor.ts:278,295`, and
`multi-edit-dialog.ts:130` (those only stale the *tooltip copy*, since their
disabled state rides a decorated field — fix in the same sweep).

---

## Stale landing rationale — the flags are already flipped (read this before merging)

- `src/corpus-mode.ts:36-46, 85-95`: `corpus-worker` defaults to `'on'` and
  `corpus-sync` to `'watermark'`; on any host other than `localhost`,
  `127.0.0.1`, and `dev-complexity-compendium.web.app`, localStorage is not
  even consulted — **prod has no client-side kill switch**. Rollback after a
  bad prod deploy = redeploy.
- The HANDOFF-BRIEF landing note ("merge SAFE, all flags default off",
  2026-07-10) predates the flip (`bbfdd89c`, 2026-07-11) and should be
  corrected so nobody merges/deploys on the old rationale.
- The July warning about "default boot = main-thread full-corpus listeners,
  ~40k reads" is obsolete in the *other* direction: the default boot is now
  worker-owned ingestion; the uncapped main-thread path survives only as a
  dev-host diagnostic mode.

## Prod-deploy blockers (do not gate the merge; DO gate the cutover)

1. **Anonymous visitors lost all card persistence.** Readers get
   `persist:false` (memory cache) workers (`src/corpus-bridge.ts:1460,
   1800-1820`; `src/worker/corpus-worker.ts:1135-1138`), and the main thread
   also drops to `memoryLocalCache` (`src/firebase.ts:129`). Master served
   warm anonymous boots instantly from IndexedDB; at HEAD every anonymous
   visit, every tab, re-downloads the full published corpus and offline
   viewing is gone. This is the public site's primary audience, and it is
   acknowledged nowhere in the docs. (Live check: the anonymous boot does
   *work* — full render, no errors — the regression is latency/offline/reads,
   not breakage.)
2. **`on` mode fails closed on browsers without module-worker support**
   (Safari <15, Firefox <114): shell + permanent "card sync failed" error
   (`corpus-bridge.ts:1239-1248`); the main-thread fallback is reachable only
   in diagnostic modes. Master worked everywhere.
3. **Runbook waits on only one of ~20 new composite indexes**
   (`docs/prod-cutover-runbook.md:85-88`). The cold-boot priority phase needs
   `(published ASC, updated DESC)`, not just the ASC pair; find/slug and
   suggestion queries need others. Amend to "wait until ALL indexes +
   fieldOverrides show Enabled."
4. Rules/indexes must deploy before hosting (documented in the runbook;
   nothing enforces it — and because of the force-on flags, hosting deploy to
   prod IS the cutover).
5. Main-thread per-user state (stars/reads/reading-lists) is memory-only in
   default mode (`src/firebase.ts:116-117`) — for heavy accounts this
   re-bills tens of thousands of reads per boot. Worth a measurement before
   cutover.

## Sync-engine risks (flag-flip blast radius; flags are on at HEAD, so these are live on dev now)

The engine is well-defended overall (derived watermarks, epoch-CAS IndexedDB
writes, directional trust gate, post-delta re-gate); the two never-run
scenarios from the fix queue (two-device delete-while-away, launder-vs-delta
ghost) were analyzed statically and are substantially handled. Remaining:

1. **P1 — Interrupted cold sweep at ≥50% discards the watermark clamp**
   (`corpus-worker.ts:2433-2442` vs `:2033-2038`): the warm-classification
   path clears `coldSweep` *including* `startBound` without promoting it to
   `watermarkClamp`, so a crash mid-sweep + an edit-during-sweep older than
   watermark−5min = a card served stale at `syncState=live`, permanently
   (count-gate is membership-only and cannot see mutations). Fix: promote
   `sweep.startBound` when discarding.
2. **P1 — Acknowledged unguarded backward ingest** (`corpus-worker.ts:709-729`
   "KNOWN LATENT"): five paths write the corpus without version guards; a
   partition-repair read racing the delta listener can roll a card back over
   a newer delivery, permanently below the next boot's bound. Exists only as
   a code comment — get it into a tracked queue before the prod flip.
3. P2s: a second delta delivery can mark the plane `live` before the deficit
   re-gate finishes (`:1853-1875`, transient); partition-repair ghosts are
   never cache-laundered → recurring per-boot flash-ghost + ~4k-read repair
   for console-deleted cards (`:1500` vs `:1816-1829`); future-`updated`
   poison inside the 1-hour tolerance can blackhole a window of edits
   (`:1565-1583`); tombstone cursor lacks the future-plausibility guard the
   card watermark has (`:1641`). Tombstone pruning is unimplemented (Phase 4),
   so the long-offline-device hazard cannot occur yet, and the trust gate is
   a structural backstop when it is implemented.

## UX regressions vs master

1. **Bare `e` opens the editor and swallows subsequent typing into the card
   body** (`main-view.ts:502-507`; NOT present on master — added in
   `acc19b8c`). Live-demonstrated by accident: typing a search phrase with the
   card view focused inserted the tail of the phrase into the card body. The
   fix-queue's U15 ("`e` is a silent no-op") is wrong at HEAD — the shortcut
   is live and hot. A single unmodified letter key that instantly moves focus
   into contenteditable card content is a data-mutation hazard; recommend
   requiring a modifier or at least not focusing the body.
2. **Navigation while editing is allowed with no prompt and leaves the editor
   orphaned.** Live-verified: with unsaved changes open on card A, clicking
   any card link navigates the view to card B while the editor stays open,
   still bound to card A. No unsaved-changes prompt fires at navigation time.
   (Same structural behavior exists on master; but this branch added link-like
   surfaces near the editor and a two-pane conditional-render editor, making
   it much easier to hit. Judgment call — at minimum confusing.)
3. **Cmd-Shift-C / Cmd-Shift-I are silent no-ops on the editor's default
   Content tab** (`card-editor.ts:959,978` zeroes `_suggestedConcepts` unless
   detail fields are visible; the shortcut handler `:1369-1377` still
   killEvent()s). Master populated suggestions whenever editing. Regression.
4. **Editor shortcuts switched from `e.key` to `e.code`**
   (`card-view.ts:1215,1229`, `card-editor.ts:1369,1374`): on non-QWERTY
   layouts the printed shortcut stops working and a different physical key
   silently triggers card creation. No indication this was intentional.
5. Non-reactive status fields (see P1-4). Fork button not gated like its
   siblings (fails post-click with an alert instead of disabled-with-reason).
   Diagnostic `off` mode logs a spurious `console.timeEnd` warning per boot
   (`database.ts:414-418`).

Checked and clean: tab counts (`countForDescription` matches real Collection
counts under offset/limit/fallback), `Collection.handoff` semantics vs
master's ghosting, worker-served reorderability fails closed
(`_sortExtrasUnknown`), keyboard suppression now covers all modals + gate,
shift-click multi-select, comments/info-panel hidden-state resets.

## Performance

Live measurements this round (admin, 40,225 cards, warm worker cache, DEV):

| Metric | Measured | Notes |
|---|---|---|
| Boot → first cards | 5.7s (1,239 cards) | priority phase |
| Boot → full corpus in Redux | 9.1s (40,225) | `loadComplete` |
| Boot → syncState `live` | **19.7s** | advisory budget is 15s; prior best 7.4s — backend variance + replay traffic this boot; worth re-measuring |
| Long tasks during boot | 351ms, 448ms, **2,476ms** | the 2.5s freeze lands ~6.5s in, during snapshot apply — the UI is usable-then-frozen |
| Heap | **1,543MB peak** during boot, 685MB settled | peak is ~2.2× settle; renderer-crash watch item (fix-queue P0) plausibly relates |
| Save round-trip (modify path) | editor release 369ms, server-confirmed 1,127ms | consistent with the p95 779ms claim's ballpark |
| Find query (worker-served) | results ~1.2s after typing | |
| Takeover (tab2 ← tab1) | usable 2.4s, live 20.3s | reciprocal reclaim: live 14.0s |

Code findings (agent, excluding known P11/P12/P18/P21/P22):

1. **`Collection.handoff` is structurally dead in the wired app** —
   `reducers/data.ts:202-203` re-spreads `slugIndex` on *every* UPDATE_CARDS
   (including empty batches), which churns `selectTabCollectionFallbacks`/
   `startCards` identity, which the handoff bails on
   (`collection_description.ts:817-818`); `pruneCardSimilarity` identity churn
   is a second independent breaker. The unit test passes only because it
   hand-builds args with shared identities. Affects the (now diagnostic-only)
   main-thread mode and any degraded fallback: full 40k filter+sort rebuild
   per commit/echo — the 16s-class behavior the branch's own log measured.
   Verify cheaply: `perfCount('collection:handoff')` reads 0 after a flag-off
   edit session.
2. **Server IDF map is unbounded** (`functions/src/idf.ts:66-77`): every
   distinct unigram+bigram in the corpus → plausibly several MB. localStorage
   cache write will silently fail at scale → re-download + main-thread
   `JSON.parse` every boot; competes for the same ~5MB origin quota the
   aux-write queue budgets (`MAX_QUEUE_BYTES=1.5MB` — its cohabitant list
   doesn't mention `server_idf_cache`); the full map is deep-walked and
   structured-cloned to the worker on every reconnect. Needs a size
   measurement + top-N trim.
3. `selectDefaultSet` uses raw `diffCards` instead of `sharedDiffCards`
   (`selectors.ts:1467-1486`) — a private ~10-20ms O(2n) walk per cards
   change. One-line fix.
4. Client-side IDF fallback recomputes the full-corpus map on any card
   *deletion* (`nlp.ts:1501-1512`, `cardCount >= memoized` check) —
   multi-second synchronous, only when server IDF is absent.
5. `on`-mode memory: Redux still mirrors all 40k full cards **plus** 40k
   cardMeta, on top of the worker's two copies — the deferred "stop
   mirroring" item is the single biggest memory lever (few hundred MB at
   40k), and the 1.5GB boot peak above makes it more urgent than P2.
6. Cold sweep forwards per ~500-card page (~80 main-thread dispatch cascades
   per cold boot); batching would cut it ~4×.

## Write-path P2s (beyond the P0/P1s)

- **Offline card delete is a silent no-op that looks successful**
  (`data.ts:2610-2683`): navigation + editor close happen before any server
  work; the `getDocs` on the memory-only cache rejects offline into an
  unawaited promise. No durable record exists for deletes (`card-delete` is
  not an `AuxWriteKind`) — the docs' claim that deletion is durably recorded
  is ahead of the code. Master's persistent cache made offline deletes land
  eventually; this is a durability regression.
- The 8s attempt timeout defeats the "in-flight intents are skipped by
  replay" invariant (`aux-write-queue.ts:684-724`): offline star / new-thread
  comment can double-apply `star_count`/`thread_count` (+2) after a
  same-session reconnect.
- Durable executor's post-commit echo omits the auth-scope guard its sibling
  passes (`data.ts:1075` vs `:1339`) — narrow sign-out-mid-commit privacy
  window.
- An oversized card-create atomic group (fork of a hub card, >~250 ops)
  silently splits and can partially land, after which the replay preflight
  clears the intent — permanent silent loss of section/tag membership.
- S4 purge is honored only at fresh worker boot; a same-session A→B account
  switch runs on A's persistent cache until reload (`corpus-worker.ts:1027`).

## Release engineering (beyond P1-1)

- Guard↔rules drift gate and protocol gate import compiled `lib/` with no
  build step and there is **no CI** — a green local `npm test` can validate a
  stale build. Cheap: make those suites depend on `build:typescript`.
- Rules' inbound-reference "identity floor" checks global permissions, so a
  user with only per-card `permissions.editCard` rights cannot save
  link-affecting edits (probably a null user set on this deployment; document
  the tradeoff).
- Worker-bundle version skew windows exist (stable unhashed worker URL vs
  hashed main chunks, ~1h CDN cache; dirty-draft tab surviving a SW update) —
  mitigated by the exact-match protocol handshake; the discipline "bump
  protocol version on any wire change" is enforced only by a pin test.
- `test/security/test.js:1446` is a dated tripwire: `npm test` fails outright
  on 2026-09-15 if the Phase 6 rules tightening hasn't happened. Known, but
  it will bite whoever merges after that date.
- Verified in sync/covered: template↔generated rules (425/425 lines modulo
  injections), every new client write shape vs rules (tombstone batch, split
  star rule + `star_count` binding — also live-verified: star 14→15→14, no
  permission errors), every new query shape vs `firestore.indexes.json`,
  SW update pipeline end-to-end, deploy ordering in `tools/cli.ts`, debug
  surfaces all gated behind `debug-perf` (only read-only `DEBUG_PERF`
  ungated).

## Live verification log (what was actually driven on DEV)

- Instrumented reload of the admin tab (timings above); console clean except
  the replay failure and a deprecation warning.
- Card create via real UI shortcut → **fails** (P0-1), misleading alert,
  wedged intent. Reproduced the pre-existing wedged intent failing on boot
  replay across two reloads.
- Draft recovery: unsaved-draft snackbar → Recover → editor restored the
  draft body → save → server-confirmed in 1.1s, draft cleared. (This also
  removed a `REVIEWSENTINEL42` test string a previous session had left saved
  in card `c-000-aaa696` — that card is now byte-identical to its intended
  content.)
- Star/read/reading-list: work in a real collection; correctly disabled (with
  explanatory tooltip) on fallback views — same gating as master.
- Find dialog (Cmd-F): worker-served, 10 results in ~1.2s, Escape clean.
- Two-tab: gate appears in tab 2 with clear copy; takeover works both
  directions; inactive tab's privileged snapshot is purged from Redux;
  wedged-intent replay in the non-owner tab is correctly mutation-fenced.
- Anonymous fresh-profile boot: renders fully (section view, drawer, card,
  word cloud), no console errors.
- NOT covered live (needs a second signed-in device/profile): two-device
  delete-while-away, launder-vs-delta ghost (statically analyzed: handled),
  the sign-out→purge trigger half of S4, and the fix-queue's unreproduced
  renderer crash (the 1.5GB boot-heap peak is the best current lead).

## Meta-observations

1. **716 green tests coexist with 100%-broken card creation.** The aux-write
   suites test the queue with fake executors; nothing drives the real
   card-create executor through `MultiBatch.commit()`. A single integration
   test (executor + real MultiBatch against a stub commit) would have caught
   the P0. Same gap class: no test exercises an object-valued field through
   the overwrite guard (P1-2), and the handoff unit test hand-builds
   identities the selector graph never produces (perf finding 1).
2. **The fix-queue's "closed" claims need re-verification after later
   commits.** F8 was closed by `22095701`, then partially reopened by the
   bulk path (P1-3). The Round-12 queue-hardening commit broke creation
   (P0-1). U15's description is inverted at HEAD. The queue's process —
   delete items as fixed — leaves no audit trail connecting "closed" items to
   the commits that later touched the same code.
3. Cleanup performed in the debug browser (dev data only): removed the two
  wedged empty-card `card-create` intents (`c-633-abf790`, `c-985-bef781` —
  neither card ever existed server-side), restored card `c-000-aaa696`'s
  body via the draft-recovery flow, returned star/read state and tab
  ownership to how they were found.

## Suggested landing sequence

1. Fix P0-1 (one line) + add the missing executor integration test; re-drive
   a create on real DEV.
2. Fix P1-2 (deep-compare), P1-3 (remove the delete loop), P1-4 (`@state()`
   sweep); delete the `nocommit*.txt` files (P1-1).
3. Correct the HANDOFF-BRIEF landing note to reflect the default-on flags,
   and decide explicitly whether merge should also carry a prod kill switch
   (a remotely-toggleable flag, or at least un-force localStorage on prod).
4. Merge; keep deploys dev-only.
5. Before the prod cutover: anonymous-persistence decision, fail-closed
   browser decision, runbook "ALL indexes" amendment, sync-engine P1-1/P1-2,
   and the boot-heap-peak investigation.

---

# Round 14 — adversarial re-review of the five fix commits (2026-08-02)

Scope: `b3822d8d`, `8816340a`, `70cd7849`, `982e01ca`, `b8b546bc` — the response
to Round 13. Method: two adversarial review agents (one per commit group) tasked
with *disproving* the fix claims and hunting for fixes-of-fixes, plus independent
live verification on real DEV (admin, 40,225 cards). Full `npm test` re-run:
**green, 719 passing** (up from 716 — three new tests).

Because this branch has a documented history of commits claiming things their
diff does not do, every "FIXED" below was checked against the diff, and the
user-facing ones were driven in the browser rather than read.

## Verdict update

**The P0 and all four P1s are genuinely fixed — I verified the user-facing ones
live.** Card creation works end to end, the keystroke-capture hazard is gone, the
nocommit files are scrubbed from history without collateral damage, and the
landing rationale now tells the truth. The branch is materially closer to
landable than it was this morning.

Two caveats keep it from a clean bill:

1. A **renderer crash reproduced** on the long-lived debug tab (crash dump
   written 10:28:26 today, mid-session). This is the fix-queue's
   "seen ONCE, not reproduced" P0 — it now has a second occurrence and a
   measured precondition. See R14-1; it is the most serious open item.
2. Fix-queue hygiene regressed again: **four of five fix commits did not touch
   the queue**, so it currently lists as open several items those very commits
   fixed. See R14-5.

Everything else found this round is P3-or-lower polish.

## Fix verification

| Round 13 finding | Verdict | How verified |
|---|---|---|
| **P0-1** card creation broken (missing `endAtomicGroup`) | **FIXED** | Live: Cmd-Shift-M created card `c-316-cfb763`, corpus 40,225→40,226, **no alert, empty replay queue**. Deleted it again via the editor's delete affordance (confirm dialog → 40,225). All `beginAtomicGroup` sites in `src/` re-audited: every reachable path now closes. |
| **P1-1** `nocommit*.txt` in history | **FIXED** | Absent from `git log --all`; on disk but ignored. Commit count 365 = 360 + 5, nothing lost. Rebase integrity spot-checked: all three Round-13 code quotes still exist verbatim at the expected places in the rebased pre-fix commit `997bfa28`. Bonus: `origin/implement/fast-corpus` is an ancestor of HEAD and never contained the files — **the private data never left the machine**. |
| **P1-2** images false "Changed elsewhere" | **FIXED** for the reported repro; see R14-2 for a residual | Guard now value-compares non-primitives (`sameFieldValue`); 9 tests pass including reorder-is-a-change. `ImageInfo` is all-primitive, so no genuine conflict can now be missed. |
| **P1-3** cross-tab intent-body erasure (bulk path) | **FIXED** | The `deleteIntentKeys` loop is gone; the new code only deletes ids in its own `written` list (rollback). Correct by inspection — but **no test drives a sibling write during the bulk persist**; the F8 test still covers only the singular path. |
| **P1-4** non-reactive `_saveEligible`/`_corpusStatus` | **FIXED** | All four components now decorate both fields individually. Live: with sync `live`, Redux status, the component field and the rendered tooltip all agreed — no staleness. One miss remains (R14-4). |
| **UX-1** bare `e` keystroke-capture hazard | **FIXED** | Live: pressing `e` then typing `everest` on a card left the editor closed and the card body byte-identical. Ctrl-E opens the editor correctly. |
| **UX-3** Cmd-Shift-C/I dead on Content tab | **FIXED** | `detailFieldsVisible = this._active`; handler now acts on populated state. |
| **UX-4** `e.code` layout dependence | **FIXED** — and the agent's claimed regression is a **false positive**, see below | |
| **Fork button ungated** | **FIXED** | Same disabled+`blockedReason` pattern as siblings, on reactive fields, plus a guard in the handler. |
| **Stray `console.timeEnd`** | **FIXED** | Both branches guarded; all remaining time/timeEnd pairs in `src/` verified symmetric. |
| **Sync P1-1** watermark clamp on interrupted sweep | **FIXED** | Promotion added on the discard path; the two other `coldSweep = null` sites analysed and shown safe; clamp still cleared on first delta server delivery (no permanent pinning). Correct bound (`startBound`). **No test** exercises the discard path. |
| **Sync P1-2** backward ingest given a tracked home | **DONE** | Now in the fix queue with its reverted-fix rationale. |
| **Landing rationale / index gate** | **FIXED** | Re-verified the corrected text against `src/corpus-mode.ts` myself: defaults are `'on'`/`'watermark'`, allowlist is exactly localhost/127.0.0.1/dev host. Runbook now names all 29 composite indexes + 19 field overrides, and the counts match `firestore.indexes.json`. |

### A claimed regression that is NOT real (recorded so nobody "fixes" it)

One agent reported a P2: that reverting `e.code == 'KeyR'` → `pressedLetter(e) == 'r'`
(`card-view.ts:1253`) kills Cmd-Alt-R / Cmd-Alt-Shift-R on macOS, because Option
composes `r` into `®`. Master's own surviving comment ("If you hold Alt then
e.key will not be r") makes this very plausible on paper.

**Measured live on macOS Chrome: it is wrong.** With Meta held, macOS suppresses
Option composition, so the event arrives as `key:'r', code:'KeyR', alt:true,
meta:true` (and `'R'` with Shift, which `pressedLetter` lowercases). Both
shortcuts demonstrably fired: Cmd-Alt-Shift-R changed the path
`/c/half-baked/` → `/c/everything/limit/1/sort/random/`, and Cmd-Alt-R changed
`randomSalt`. Since every shortcut in that handler is behind an early
`if (!e.metaKey && !e.ctrlKey) return`, the composition case master worried
about is unreachable. The `e.key` revert is correct.

Worth doing anyway: master's stale comment now contradicts the code above it and
will keep generating this exact false report. Deleting the comment is the fix.

## New findings

### R14-1 (P1, and the most serious item open) — renderer crash reproduced; fresh-boot heap is fine, long-session heap is not

A Chrome crash dump was written at **10:28:26 today**, during this review, on the
debug tab: the renderer holding the app died, CDP `Runtime.evaluate` stopped
responding, and the tab had to be recreated at the browser level. The tab had
been through a long mixed session (create/delete a card, editor open/close,
saves, draft recovery, a two-tab takeover in both directions, multi-edit dialog,
several in-renderer reloads); the crash landed on a subsequent page navigation.

This is the second occurrence of the fix-queue's P0 "Renderer crash seen ONCE,
not reproduced", and the first with numbers attached.

Measurements, which also **correct Round 13's framing of this**:

| Condition | GC-settled heap |
|---|---|
| Fresh boot to `loadComplete`, 40,225 cards | **574 MB** (peak 712 MB) |
| Same, with a section collection + drawer loaded | **787 MB** |
| After 40 arrow-key card navigations | 792 MB |
| After 10 more find-dialog queries | **791 MB — flat** |
| Long-lived mixed session, immediately before the crash | **1,763 MB after forced `HeapProfiler.collectGarbage`** |

Two conclusions, one of which retracts a Round 13 claim:

- **Round 13's "1.5 GB boot peak" was wrong as a boot cost.** A fresh boot peaks
  at ~712 MB against a 4,192 MB limit. The 1.5–1.9 GB figures came from a tab
  that had already accumulated.
- **Navigation and search do not leak.** 40 navigations plus 10 worker-served
  searches moved GC-settled heap by 4 MB. This is a real result for the branch —
  the hot paths are clean — and it *narrows* the hunt.

So ~1.2 GB of GC-resistant retention accrued from something else in that
session. The untested suspects, in rough order: repeated in-renderer reloads
each re-priming 40k cards, and the two-tab ownership takeover / snapshot purge
and re-prime cycle. Recommended next step: drive reload×N and takeover×N loops
with `collectGarbage` between iterations; whichever grows, take one heap
snapshot and read the retainer path. That is a bounded investigation and it is
the difference between "unexplained crash" and a known bug.

Severity: it takes a long working session to reach, but that is exactly how the
owner uses this app, and the failure mode is losing the tab.

### R14-2 (P3, mechanism confirmed) — residual images false-conflict via key-order-sensitive comparison

`sameFieldValue` compares with `JSON.stringify(left) === JSON.stringify(right)`
(`durable-overwrite-guard.ts:56`), which is key-order sensitive. The two copies
being compared do not share a key order:

- Server-stored images, read live from the dev corpus, come back as
  `position, height, src, width, emSize, uploadPath, alt, margin`.
- Client-constructed images go through `getImagesFromCard`'s
  `{...DEFAULT_IMAGE, ...img}` (`images.ts:89`), giving
  `src, emSize, margin, width, height, position, uploadPath, …`.

So a base recorded from a client-shaped copy — which is what the local echo
writes into Redux after a save — compares unequal to the identical server value,
and the "Changed elsewhere" dialog returns for a second consecutive images save
inside the echo window. First saves (the case the new tests cover) are fine
because Redux still holds the server-shaped copy.

I confirmed the key orders differ live but did **not** drive two consecutive
image saves (that needs an upload), so the mechanism is confirmed and the
end-to-end repro is not. Errs toward asking rather than losing data.

Cheap fix: the codebase already has the right comparator — `imageBlocksEquivalent`
(`images.ts:194`) compares images order-insensitively by value. Either use it, or
sort keys in `sameFieldValue`.

### R14-3 (P3) — the UI still advertises the shortcut that was just removed

`card-view.ts:751-752` renders tooltip and `aria-label` "Edit card (E)". Bare E
is now deliberately a no-op; the binding is Cmd/Ctrl-E. Verified live: the label
reads "Edit card (E)" while pressing E does nothing. Screen-reader users get the
same wrong promise. (This also re-creates the literal text of fix-queue item
U15, which is still in the queue unmodified even though `8816340a`'s message
calls its description wrong.)

### R14-4 (P4) — one field missed in the `@state()` sweep

`card-editor.ts:285` `_suggestedTagsState` is still declared under a neighbour's
decorator — the exact pattern `b3822d8d` set out to eliminate, and one of the two
card-editor lines Round 13 cited. It drives the "calculating… / unavailable right
now" copy from async worker callbacks. Currently masked because every transition
also assigns `_suggestedTags` a fresh array, so a render tags along by
coincidence.

### R14-5 (process) — the fix queue now lists fixed work as open

Four of the five fix commits (`b3822d8d`, `8816340a`, `70cd7849`, `b8b546bc`)
did not touch `docs/fast-corpus-fix-queue.md`. Since the queue's stated process
is "items are DELETED from this file as they are resolved", it is now
actively misleading: the Cmd-Shift-C/I item (queue line 72) and the fork-button
item (line 80) are both fixed in `b8b546bc` yet still listed as open, and U15
(line 139) describes the opposite of current behavior.

Related and more consequential: the Round-13 write-path P2s and performance
findings (offline delete silent no-op, 8s-timeout double-apply, echo auth-scope
gap, oversized create group, S4 account-switch, unbounded IDF map, dead
`Collection.handoff`, `selectDefaultSet` diff) live **only** in this untracked
review file, which the queue merely links. One `rm` and they are gone. They
should be folded into the queue before this file is cleaned up.

### Smaller notes

- **`test/atomic-group-balance` is a tripwire, not a proof.** Verified it fails
  on the actual P0 (good). But its function-start regex matches only
  `registerAuxWriteExecutor(`, `export const …` and `const … =`, so a
  `beginAtomicGroup` inside a plain `function foo()` or a class method is
  invisible; branch-asymmetric begin/end is not caught; and intervening
  `const x = …;` statements create pseudo-scopes that could false-positive on
  future code. Only `src/` is scanned.
- **Wedge surfacing** works for the P0 shape (alerts once at 4 consecutive
  identical failures, never storms). Two edges: a merely-offline queue can reach
  4 across two offline boots and be told "something is wrong"; and a
  deterministic *hang* is never counted (the 8s first-attempt timeout resolves
  `'queued'` without recording, and the replay path has no timeout at all).
- **Restoring Content-tab concept suggestions** puts
  `suggestedConceptReferencesForCard` — self-described "very expensive" and
  main-thread in every mode — back in the default editing view, invalidated ~1s
  after each typing pause. It is master-parity and O(card), not O(corpus), so
  probably fine; worth one typing-jank measurement on a large card.
- **Sync clamp, theoretical edge:** `corpus-worker.ts:2446` overwrites rather
  than takes `min(existing, startBound)`. Two crashes plus a cache loss in a
  specific order could replace an older clamp with a newer one on a sweep that
  did not re-read everything. `min()` closes it.
- **Boot-to-live variance is wide and unexplained.** Measured this round on the
  same machine and corpus: 12.8s, 19.7s, and one boot that reached
  `loadComplete` at 31.6s and `live` only after >90s. The 7.4s figure in the
  implementation log is a best case, not a typical one. Worth re-measuring
  before anyone treats the 15s advisory budget as met.
- Untouched decisions from Round 13, still open: the **prod kill switch** and
  the **anonymous-persistence** cost are now accurately documented but neither
  is decided.

## Live verification log (Round 14)

Driven on real DEV, admin account, 40,225 cards:

- Card create via the real shortcut → real card, corpus +1, no alert, empty
  queue; deleted again via the editor's delete affordance with its confirm
  dialog → corpus back to 40,225. **The P0 is genuinely dead.**
- Bare `e` + typing → no editor, no body mutation. Ctrl-E → editor opens.
- Cmd-Alt-R and Cmd-Alt-Shift-R → both fire (see the false-positive note).
- Cmd-F find dialog → opens, worker-served results, Escape closes.
- Edit tooltip vs Redux corpus status → agree exactly (the `@state` fix works).
- Multi-edit dialog → opens, Escape closes it and keyboard navigation recovers.
- Heap/leak workload → 40 navigations + 10 searches, GC-settled heap flat.
- Renderer crash → reproduced (dump at 10:28:26); tab recovered by recreating
  the target at browser level; the profile, session and corpus survived intact.

Dev-data cleanup performed: the one test card created was deleted; no other card
content was modified this round; the aux-write queue is empty; the debug tab is
signed in, live, and left on a normal collection view.

## What I would require before merge

1. **R14-1** — bounded investigation of the long-session heap retention. It does
   not have to be *fixed* before merge, but "we know what retains it" should be
   true before this ships to the owner's daily driver.
2. **R14-5** — fold the Round-13 P2/perf findings and this round's items into the
   fix queue, and delete the entries the fix commits already resolved.
3. R14-3 and R14-4 are one-line fixes; take them with the next commit.
4. R14-2 whenever images are next touched — use `imageBlocksEquivalent`.

Everything Round 13 called a merge blocker is resolved.

---

# Round 15 — heap root-cause, upgrade path, and under-audited subsystems (2026-08-02)

Scope: HEAD `5cc94ce4`. Four review agents on lenses no prior round covered
(test-suite coverage shape, `functions/`+`tools/`+maintenance, the master→HEAD
upgrade moment, adversarial re-review of `d2c93dfe`/`5cc94ce4`), plus the heap
snapshot investigation that Rounds 14 recommended and `5cc94ce4` deferred.
Full `npm test`: **green, 720 passing**.

## Verdict update

**The renderer-crash blocker is now root-caused, with a specific code fix.** It
is not a "high floor" and not the card corpus — see R15-1, which also corrects
`5cc94ce4`'s conclusion and one of my own Round-13 findings.

But this round surfaces a **new P0 that is worse than anything outstanding**: on
the current build, deploying to a user who already has master's service worker
does not actually upgrade them, and cannot until they close every tab (R15-2).
That one is deploy-blocking rather than merge-blocking, but it invalidates the
cutover verification step in the runbook.

## R15-1 (P1, root-caused) — the retained gigabyte is V8 shape metadata created by per-instance accessors in the `nlp_tokens` fast path

I took a real heap snapshot (3.5 GB of snapshot for a 1,031 MB heap; 24.1 M
nodes) from the tab in the exact state that preceded the crash, and walked
retainer paths. Findings, in order:

**First, the state the snapshot was taken in.** The tab had *lost* ownership:
worker terminated, `purgeAndDeactivate` complete, and the Redux `data` slice
verifiably empty — `cards: 0, cardMeta: 0, cardsSnapshot: 0, slugIndex: 0,
cardSimilarity: 0`. `Runtime.getHeapUsage` on the page isolate itself (not
`performance.memory`, which could have aggregated a worker) reported
**1,010 MB after a forced GC**, with no worker target alive to attribute it to.

This **refutes `5cc94ce4`'s conclusion** that "the settled floor is ~1.02 GB
with the corpus mirrored into the page." The corpus is not in the page in this
state, by the branch's own purge design, and the number is the same ~1.02 GB.
Whatever was polled, the explanation does not hold.

**Where the memory actually is** (self_size by node type):

| | |
|---|---|
| object shape | **397.8 MB** (7,836,502 nodes) |
| system / Map (hidden classes) | **266.3 MB** (6,979,742) |
| system / DescriptorArray | **120.0 MB** (543,580) |
| system / PropertyArray | 39.3 MB (479,789) |
| system / AccessorPair | 4.6 MB (404,155) |
| *actual JS objects+arrays* | 169 MB `Object` + 165 MB `Array` |

Roughly **830 MB of the 1,031 MB is V8 hidden-class metadata** — 7.8 M shapes
for ~3.5 M objects. Healthy code shares one shape across millions of instances;
more than two shapes *per object* means something is minting a unique hidden
class per allocation.

**The culprit is identifiable from the snapshot's own node names:** 129,156
objects each named `get empty`, `get stemmed`, `get withoutStopWords`, and
404,155 `AccessorPair`s ≈ 3 per object. That is `src/card-processing.ts:83-93`
— the fast path this branch added for stored `nlp_tokens`:

```ts
return {
    normalized: storedRun.normalized,
    original: '',
    get stemmed() { return getStemmed(); },
    get withoutStopWords() { … },
    uppercaseRanges: storedRun.uppercaseRanges,
    get empty() { return storedRun.normalized === ''; }
};
```

Accessors declared in an object literal force V8 to give **each instance** its
own `AccessorPair`s (the closures differ per run), therefore its own
`DescriptorArray`, therefore its own hidden-class `Map`. One NLP run costs a
handful of metadata objects instead of sharing a shape.

**The slow path it replaced does this correctly.** `src/nlp.ts:446-471` is a
class with plain instance fields (`this.stemmed = …`) and a single *prototype*
getter (`get empty()`), so every instance shares one hidden class and one
AccessorPair. The optimization intended to make migrated cards cheap (lazy
stemming) made them dramatically more expensive in metadata than the path it
was optimizing — and it is the **default** path for every migrated card.

**Fix:** have the fast path construct the same class (or plain precomputed
fields), keeping laziness, if wanted, via a shared prototype rather than
per-instance closures. This is a contained change in one function with a
directly measurable before/after (`Runtime.getHeapUsage` after a forced GC).

**Still open after the fix lands:** why 129 k run objects are alive at all in a
tab whose corpus was purged. `_processedCardCache` is WeakMap-keyed, so this
implies something still strongly holds many card objects. One retainer path I
walked runs through a rendered element's `__card` property into memoized
selector `restArgs`, which is a plausible seed but not enough for 129 k runs.
Worth one more targeted look after the shape fix, since the fix will change the
denominator.

**Correction to my own Round-13 finding.** I flagged the server IDF map as
"plausibly 10⁶+ terms / several MB". Measured on the real dev corpus: **49,713
keys, 1.6 MB**, and the localStorage write succeeds (1,630,961 bytes present).
It is a real cohabitant of a ~5 MB quota shared with the aux-write queue's
1.5 MB budget, but it is not a memory problem and I overstated it. The retainer
walk found it only because its backing store is the largest *single* node
(1.5 MB), not because it is a large share of the heap.

## R15-2 (P0 for deploy) — master's service worker serves master's bundle; the upgrade does not take until every tab closes

Master's SW is still the controller on the first post-deploy load, and it holds
the app entry point at a **stable, unhashed** precache URL — confirmed in the
built artifact:

```
url:"lib/src/components/card-web-app.js",revision:"7064e796571bb5710eaa311704ec1a32"
```

(`rollup.config.js` uses default entry naming; `workbox-config.cjs:16-20`
globs `lib/src/**/*`; `index.TEMPLATE.html:33` sets `<base href="/">`.) So:

1. Navigation fetches HEAD's `index.html` (not precached) — good.
2. Its `<script src="lib/src/components/card-web-app.js">` is answered
   **cache-first by master's SW** — so **master's bundle runs**.
3. HEAD's SW installs and, because `workbox-config.cjs:26` now sets
   `skipWaiting: false`, **waits**.
4. The update event HEAD's bootstrap fires is listened for by *HEAD's* bundle
   (`card-web-app.ts:98`) — which is not the bundle running. Master's bundle
   has no listener, no `SKIP_WAITING` sender, no update UI.
5. `index.TEMPLATE.html:65-67` deliberately removed master's `location.reload()`
   escape hatch.

A waiting worker activates only when every client in scope closes; reloading
does not do it. **Consequence for the runbook:** Phase 5's anonymous
private-window check passes (no SW), while the signed-in existing-profile check
silently exercises *master* and also looks fine. The two checks that are meant
to confirm the cutover cannot disagree, because neither is testing HEAD.
Asymmetry worth noting: rollback is unaffected (master's SW calls
`skipWaiting()` unconditionally), so the recovery path is fast in one direction
and stuck in the other.

**Fix:** ship `skipWaiting: true` for the cutover build only, or hash the entry
filename (`output.entryFileNames: '[name]-[hash].js'`) so master's precache
cannot answer for it.

## R15-3 (P1) — `calculateIDF` is scheduled weekly against this branch's own written prohibition

`functions/src/idf.ts:38-48` is an `onSchedule('0 2 * * 0')` that runs
`db.collection('cards').get()`, and `tools/deploy-firebase.ts:11-15` puts it in
`baseFunctions`, so every `deploy`/`dev-deploy` ships it to both projects.

`docs/corpus-sync-design.md:51` — same branch — names this exact line and says
the opposite: that `idf.ts:48` burns a full corpus read per invocation and
**"must never be scheduled"**, with a loud comment. There is no loud comment.
The same paragraph records the quota-exhaustion incident that motivated the
rule. Net effect: a recurring uncapped ~40 k-read burst every Sunday 02:00 on
both projects, on a branch whose entire design goal is read-cost control.

## R15-4 (P1) — the upgrade breaks deletion for anyone still on master's bundle, and the runbook claims the opposite

`firestore.TEMPLATE.rules:339-348` now requires an atomic tombstone alongside
the card delete. `master:src/actions/data.ts:1263` writes `batch.delete(ref)`
and nothing else, so every master-client delete is `permission-denied` from the
moment Phase 2's rules land. That is a deliberate, documented decision — but:

- `prod-cutover-runbook.md:97-98` states the reverse: *"The rules remain
  COMPATIBLE with the currently-deployed old prod client — nothing breaks
  between Phase 2 and Phase 4."* Delete breaks, for that whole window.
- R15-2 makes the window open-ended rather than a deploy-day gap.
- The failure is **silent and the UI has already committed**: master runs
  `editingFinish()` and `navigateToNextCard()` before `await batch.commit()`,
  with no `catch`. The user confirms, the editor closes, the view moves on —
  and the card is still there after a reload.

## R15-5 (P1) — rollback strands durable user work; the runbook calls it "client-only"

Master reads none of HEAD's new keys. After the blessed "redeploy master"
rollback: `card-web-aux-writes-v2-*` (queued stars, comments, card creates,
bulk imports) is never replayed; `card-web-edit-draft-v1` is unrecoverable
(master has no draft recovery); `card-web-pending-multi-edit-v1` strands a
paused multi-edit. Nothing is corrupted — returning to HEAD replays it — but
the queue has no age bound, so a `star` intent replays `increment(±1)` days
later against a count the user has since changed. `prod-cutover-runbook.md:145-150`
describes rollback as "instant, client-only"; it is not client-only if it
strands queued writes.

## R15-6 (P2) — the wedge alert can be permanently silenced instead of deferred

`src/aux-write-queue.ts:179-180`, added in `d2c93dfe` to stop offline queues
from being reported as wedged:

```ts
if (count !== FAILURES_BEFORE_REPORTING) return;
if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
```

The threshold test is exact equality and runs *before* the offline check. If
the 4th consecutive identical failure of a genuinely wedged intent happens to
land while offline, it is suppressed — and every later failure has count 5, 6,
7…, so `count !== 4` returns early **forever**. The user is never told, on any
subsequent online attempt. Gate the increment, or report on `count >=
threshold` with a persisted already-reported flag.

Related, same commit: the claim that a deterministic *hang* is now counted does
not hold. The 8 s timeout that calls `recordFailure` exists only on the first
attempt; the replay path (`:904`) awaits the executor with no timeout, so a
hang accumulates exactly 1 of the 4 required failures, forever.

## R15-7 (P2) — R14-2 fixed key *order* but not key *set*, and declined the fix that covered both

`d2c93dfe` replaced `JSON.stringify` with a key-sorting `stableSerialize`. That
handles order-only differences, and the added test exercises it — but both
test fixtures have identical key sets. My Round-14 live measurement was of a
key-**set** difference: server images returned 8 keys, `DEFAULT_IMAGE`
(`src/images.ts:57-67`) has 9 (it also carries `original`). Driven against
those two shapes, the bogus conflict still fires.

The recommended `imageBlocksEquivalent` was declined on zero-import grounds,
but the reason it works is not its comparison loop — it is that
`getImagesFromCard` runs *both* sides through `{...DEFAULT_IMAGE, ...img}`
first, normalizing the key set. Sorting keys drops exactly that property. A
key-union fill needs no imports.

Two smaller regressions in the same comparator: an explicit `undefined` value
now conflicts with an absent key (stricter, in a change meant to loosen), and
`stableSerialize` ignores `toJSON`, so any future `Date`/`Map`/`Set`-valued
guarded field would compare **equal when it differs** — a missed-conflict
direction the guard exists to prevent. Unreachable today; worth a comment.

## R15-8 (structural) — what the 720 tests actually cover, and the cheapest fix

A systematic audit of the suite explains the recurring pattern better than any
individual finding:

- **~27,000 LOC have zero executable coverage**: `src/components/*` (14,664),
  `src/actions/*` (10,436), `corpus-worker.ts` (2,794), `corpus-bridge.ts`
  (2,023), `selectors.ts` (2,213). No test instantiates a Lit component,
  creates a store, or dispatches a thunk. Those layers are guarded only by
  **~60 regex assertions over source text**.
- Of ~46 real bug fixes on this branch, 17 were in components, 17 in thunks,
  17 in the worker/bridge — the three zero-coverage layers. Only 10 shipped a
  test, all in the two shapes the harness supports.
- The pattern is not forgetfulness: **the harness can only reach modules
  deliberately extracted to have no imports**, so each bug is fixed by
  extracting a new pure module and testing that, while the wiring that calls it
  stays untested. `durable-overwrite-guard.ts` exists because of this — and its
  bugs then recurred *in it* twice (P1-2, R14-2).
- **`shared/multi_batch.ts:240`** — the exact throw that made card creation
  100% broken — is referenced by zero tests.
- Two tests were **green while pointed at catastrophically broken lines**:
  `test/search-recall/test.js:105` asserts `/content: 'updating/` matches
  `card-drawer.ts`, and stayed green for four days across the outage where that
  line's illegal octal escape made Lit's `css` tag yield `undefined` and
  silently dropped the entire stylesheet. And `test/atomic-group-balance`
  asserts `ends + aborts >= begins`, so **deleting the atomic group entirely
  passes** — reintroducing the exact partial-landing bug the group was added
  for.
- **There is no CI.** `.github/` holds only CODEOWNERS; `.travis.yml` invokes
  three scripts that have not existed for four years. No test script builds
  first. No `engines` field — on Node 18 `test:reducers` hard-fails, so "720
  green" is reproducible on one unenforced Node version.
- The pre-commit hook greps staged *contents* for `nocommit` — which is why
  three files literally named `nocommit*.txt` sailed through.

The highest-leverage fix is cheaper than the branch believed.
`test/atomic-group-balance`'s own header justifies being static by claiming the
executors live in modules that need the browser Firebase runtime — **that is
false**. With the jsdom shim already used in `test/collection/test.js:12-18`,
`lib/src/actions/{data,comments,user}.js`, `store.js` and even
`components/card-editor.js` all import in plain Node, and driving
`runDurableAuxWrite` runs the **real** executor through a real `MultiBatch`
past the `multi_batch.ts:240` check. ~60 lines, no new dependencies, and
`src/firebase.ts:153` already honors a `firebase-emulator` flag so it can be
made hermetic under `firebase emulators:exec` exactly like `test:security`.
That one harness would have caught the P0 plus at least five other shipped bugs.

## Other findings worth queueing

- **`innerTextForHTML` now silently falls back to a regex extractor**
  (`shared/util.ts:182-197`) where master threw. Nothing under `src/worker/`
  calls `overrideDocument`, so the worker — which owns similarity, fingerprints
  and suggestions in default mode — silently uses the lower-fidelity path.
  `A &mdash; B` tokenizes to `[a, b]` on the main thread and `[a, mdash, b]` in
  the worker, and `nlp_source_fingerprint` is computed from raw fields so it
  cannot detect the divergence.
- **Corpus-wide maintenance tasks bump `updated` on unchanged cards**
  (`maintenance.ts:203-208` `updateInboundLinks`, `:168-172`
  `normalizeContentBody`) with no change detection. Running the inbound-link
  repair redelivers ~40 k documents to every device — the cost
  `docs/corpus-sync-design.md:112-118` explicitly refuses elsewhere, and which
  `resetTweets` was given `updateWithoutTimestampBump` to avoid.
- **`migrate-nlp-tokens.mjs` defaults to PROD** (`:66`) and is idempotent but
  **not resumable past a deterministically failing batch** (retry ×3 then
  `process.exit(1)`, no per-doc fallback, no cursor). `--limit=N` still reads
  the whole corpus.
- **Server IDF omits `concept_references` and `non_link_references`**
  (`shared/nlp.ts:288-292` short-circuits `overrideExtractor` fields), and the
  client scores every missing term as `maxIDF` (`src/nlp.ts:1570`) — the value
  reserved for the corpus's rarest term. Fingerprints therefore skew toward
  reference-derived phrases. Mechanism certain; user-visible magnitude not
  measured.
- **`mount.ts --push` is not atomic per card** despite a comment claiming it
  prevents exactly that inconsistency — zero `beginAtomicGroup` calls anywhere
  in `tools/`, with splits every 250 ops.
- **Admin write guard fails open on a collection rename** —
  `tools/mount.ts:554` hardcodes `'cards'` while importing `CARDS_COLLECTION`;
  `cardWriteViolation` returns `null` for a non-matching path.
- **`functions/src/twitter.ts:213-215` carries an `updated-invariant`
  annotation asserting these functions are never scheduled** — `index.ts:60-76`
  schedules two of them. The annotation-audit test only checks that a comment
  is *present*, never that it is true.
- **`5cc94ce4` dropped the Round-13 performance findings** while claiming to
  fold the review file's contents into the queue: `Collection.handoff` dead,
  IDF map, `selectDefaultSet` raw diff, client-IDF recompute on delete, the
  40k-cards-plus-cardMeta Redux mirror, and the per-page sweep cascades are
  still only in this untracked file. The fold-in also stripped every file:line
  anchor from the items it did carry over. And the queue now contains both the
  Round-14 retraction and, unedited at `:170-171` and `:186-192`, the retracted
  "1.5GB boot peak / crash never reproduced" text.

## Live verification log (Round 15)

- Heap snapshot captured from the pre-crash tab state; per-isolate usage
  measured with `Runtime.getHeapUsage` (1,010 MB) rather than
  `performance.memory`, to rule out worker aggregation. 24.1 M nodes analysed
  with a streaming parser; retainer paths walked to GC roots.
- Redux `data` slice dumped in that state: all corpus keys empty, confirming
  the purge ran and the retention is elsewhere.
- `serverIDF.idf` measured directly: 49,713 keys / 1.6 MB, localStorage cache
  present at 1,630,961 bytes.
- No card data was created, modified, or deleted this round.

## Recommended order

1. **R15-2** before any prod deploy — one line, and without it the cutover
   silently does not happen.
2. **R15-1** — contained fix in `card-processing.ts`, directly measurable, and
   it is the standing crash blocker.
3. **R15-3** — unschedule `calculateIDF` (or make it incremental) before it
   costs another quota incident.
4. **R15-4 / R15-5** — correct the two runbook claims that are the opposite of
   what the code does.
5. **R15-8's T1 harness** — the single highest-value process change on this
   branch; it is an hour of work and it closes the failure mode that produced
   the P0.
6. R15-6, R15-7 and the queued items with the next commit.

---

# Round 16 — the three cutover blockers, adversarially (2026-08-04)

Scope: HEAD `bca60333`, i.e. the ~19 commits answering Rounds 13-15, with
emphasis on the three newest: `4635221a` (anonymous reader snapshot),
`875fdcaf` (per-user state into the worker), and the protocol 3→4 bump.
Three review agents plus live verification on real DEV and on a **fresh
anonymous browser profile**. Full `npm test`: **green, 765 passing**.

## Verdict

**The cutover blockers are genuinely fixed, and I verified the headline claim
independently rather than taking it on trust.** On a clean profile with no
network at all, an anonymous visitor booted to `loadComplete` in **1,583 ms
with all 1,239 published cards**, fully rendered — drawer, card body, similar
cards, word cloud. The author's 1,458 ms is reproducible. The shared record
contains **1,239 cards, 1,239 of them `published === true`, zero unpublished**.

Both Round-15 findings are also fixed and verified: the NLP fast path is now a
class with prototype getters (`StoredProcessedRun`), and the entry bundle is
renamed so master's precache cannot answer for it.

**But `4635221a` silently reopened a security fix that a previous round
closed** (R16-1), and the optimistic layer added in `875fdcaf` rests on an
invariant that does not hold (R16-2). Both are the branch's signature failure
mode — a fix whose precondition was invalidated by a later change — and both
are small fixes.

## Verified working (live, this round)

| Claim | Result |
|---|---|
| Anonymous offline persistence | **Confirmed.** Fresh profile, network off: 1,239 cards, `loadComplete` 1,583 ms, fully rendered. |
| Shared record holds only published cards | **Confirmed.** `dev-complexity-compendium:published` = 1,239 cards, `publishedTrue: 1239`, `publishedFalse: 0`. |
| Privileged corpus stays uid-scoped | **Confirmed.** On the admin device the only records are `…:KteKDU…:privileged` (40,225 cards; 1,239 published + 38,986 unpublished) and its `:owner`. **No `:published` record was ever written by the privileged session** — the write gate holds in practice. |
| Per-user state served by the worker | **Confirmed.** 608 `reads` present, all three loaded flags true, `sync: live`. |
| R15-1 heap fix | **Fixed.** `card-processing.ts` now uses a class with plain fields + prototype getters, with the snapshot evidence recorded in the comment. |
| R15-2 SW upgrade deadlock | **Fixed**, by renaming the entry to `card-web-app-entry.js`. Master's precache has `card-web-app.js`, so it cannot answer for the new name and the request falls through to network. A rename rather than a hash is sufficient here — from HEAD onward the app's own update machinery works, because the deadlock was specific to master's bundle having no update listener. |

## R16-1 (P1, new) — the sign-out purge now clears the *shared* record and leaves the privileged 40k-card corpus on disk

`src/worker/corpus-worker.ts:2730`:

```ts
const store = corpusSnapshotStore || new CorpusSnapshotStore(`${projectID}:${outgoingUid}:privileged`);
```

The comment immediately above it (`:2711-2717`) states the fix this line is
supposed to implement:

> C11: this used to be `if (corpusSnapshotStore) store.clear()`, but that object
> only exists after a PRIVILEGED connect … Construct the store from the outgoing
> uid instead, **so the purge does not depend on which path we arrived by**.

The code kept `corpusSnapshotStore ||` as the preferred branch, so it still
depends on the path. That was **safe until `4635221a`**, because
`corpusSnapshotStore` was only ever the privileged store or `null`. That commit
made the non-privileged path assign it too (`:1245`,
`corpusSnapshotKey(projectID, '', 'published')`), invalidating the precondition.
`purgePrivilegedSnapshot(currentUid)` runs at `:2739` *before*
`disableCorpusSnapshotPersistence()`, so it captures the previous session's
store.

Two consequences:

1. **Security — the S4/C11 threat model exactly.** An admin whose permissions
   are revoked live reconnects non-privileged (so `corpusSnapshotStore` becomes
   the published store), then signs out. `clear()` destroys
   `${projectID}:published`, while `${projectID}:<adminUid>:privileged` — the
   materialized 38,986-card unpublished corpus, which I confirmed is on disk in
   plaintext IndexedDB — **is never deleted**. That record surviving sign-out on
   a shared device is the precise thing S4 exists to prevent.
2. **Feature defeat, and much easier to reach.** *Any* signed-in
   non-privileged user signing out deletes the shared reader record and its
   `:owner` token, so the next anonymous visitor pays a full cold boot. The
   `void`-ed async purge also races a new reader session's `load()`/`save()` on
   the same key.

**Fix:** delete the `corpusSnapshotStore ||` fallback and always construct from
`outgoingUid` — which is what the comment already claims the code does.

## R16-2 (P1, new) — a discarded write never reverts, so the UI can show a star that does not exist, permanently

`src/actions/user.ts:562-571` observes exactly one outcome, from the *first*
attempt:

```ts
apply();
try { outcome = await run(); } catch { outcome = 'threw'; }
if (outcome === 'discarded' || outcome === 'threw') revert();
```

The commit's stated safety rule — "a queued write must not revert, since the
intent is durable" — is sound only if `'queued'` always converges to
`'committed'`. It does not. There are two other discard sites, and neither can
reach the revert closure:

- `aux-write-queue.ts:983-986` — permanent failure **on replay**, inside
  `replayPendingAuxWrites`, which returns `void`.
- `aux-write-queue.ts:546-556` — the 30-day age-out inside
  `readPendingAuxWrites`. `HIGH_VALUE_KINDS` is
  `['card-create','comment-add','comment-edit']`, so star/read/reading-list
  intents age out with **no alert at all**.

Scenario: user stars a card on a flaky connection → transient failure →
`'queued'`, star stays lit (correct). On reconnect the replay runs, the card has
since been deleted → `not-found` → classified permanent → DISCARDED. The user
gets an alert *and* the card stays visibly starred for the rest of the session.
The age-out variant produces the same lie with no alert whatsoever.

**Fix shape:** the queue should notify on terminal discard, or the reducers
should reconcile against the authoritative echo — rather than
`applyOptimistically` observing only the first attempt.

## R16-3 (P1, new) — a worker failure in shadow/spike mode now loses stars, reads and the reading list for the session

`src/actions/database.ts:239, 272, 305` gate all three per-user connects on
`corpusWorkerOwnsCardIngestion()`. The fallback in
`src/corpus-bridge.ts:1349-1362` calls `reconnectBackgroundDataForActiveTab()`,
which early-returns unless the tab was made inert
(`database.ts:750: if (!backgroundDataInert) return;`) — and in the shadow/spike
branch it was not. The three per-user connects exist *only* inside that
early-returning function, and the only other call sites are in `signIn`, which
already ran and no-op'd.

So after a worker startup timeout or a protocol mismatch in shadow mode, the
three `*Loaded` flags stay false forever, which wedges
`selectDataIsFullyLoaded` — card-view shows its loading placeholder
indefinitely, `updateCardSelector` returns early, suggestions are suppressed,
and bulk-tag/durable-save resume are blocked. Before `875fdcaf` the same worker
failure was harmless to per-user state.

This matters more than usual right now because the protocol just moved 3→4 and
the worker bundle is still cache-skewable — see R16-5.

## R16-4 (P2, new, measured live) — offline is silently *partial*: sections and tags are empty while their loaded flags say otherwise

Measured on the anonymous profile, same page, online then offline:

| | online | offline |
|---|---|---|
| cards | 1,239 | 1,239 |
| sections | 5 | **0** |
| `sectionsLoaded` | true | **true** |
| tags | 52 | **0** |
| `tagsLoaded` | true | **true** |
| `corpusStatus` | live | **live** |

The corpus persists; sections and tags do not (they are main-thread reads
against a memory-only cache). The screenshot shows the consequence: the section
navigation is replaced by a stuck "Loading…", with `corpusStatus: live` and no
message. The flags being `true` on empty data is the worse half — anything
gated on "sections are loaded" proceeds against an empty set rather than
waiting.

This is a *new* state created by the feature: before `4635221a` an anonymous
offline boot did not work at all, so there was nothing to be inconsistent.

## R16-5 (P2) — the worker bundle is still unhashed and CDN-cached, and the protocol just changed

Verified against deployed DEV:

```
/lib/src/worker/corpus-worker.js   cache-control: max-age=3600   (protocolVersion:4)
/lib/src/components/card-web-app-entry.js   cache-control: max-age=3600
```

`firebase.json` has no `headers` block, so Firebase Hosting's one-hour default
applies. The worker URL is a fixed string (`corpus-bridge.ts:183`) while the
main chunks are content-hashed, so for up to an hour after a deploy a returning
user can get a v3 worker against a v4 page. The exact-match version check
handles it deterministically — but per R16-3, in shadow mode that now also
costs the user their per-user state. Both served files currently agree at v4;
the hazard is the deploy window, and the author's unreproduced `Page crashed`
"on the first load after the protocol 3→4 deploy" sits in exactly it.

## R16-6 (P2) — anonymous visitors attach three per-user listeners, contradicting the code's own comment

`corpus-worker.ts:2787-2789` says an anonymous uid "has no stars, reads or
reading list, so these deliver empty and cost nothing" — but anonymous sign-in
yields a real uid, so `connectUserState(uid)` runs. Confirmed live on the
anonymous profile: `uid: ohr7bOiPPYXPZVJ2vjX75BnRec02`, `isAnonymous: true`,
and all three loaded flags `true` with zero stars — the listeners attached and
delivered empty. Three empty queries still bill a minimum read each, on the
very cost axis the anonymous-visitor blocker was about. Also `spike` mode now
double-subscribes (main thread *and* worker), doubling the cost in the mode
used for measurement.

## R16-7 (P2) — config-dependent exposure: the uid-less record assumes `published == public`

`database.ts:490-497` exists to drop privileged scope for a user who may not
view the app. After `4635221a` that path (`connectCards(false, '')`) reaches
`connectPublishedFromSnapshot`, which loads `${projectID}:published` from
IndexedDB and forwards every card in it to Redux — for a user explicitly denied
access — and works offline. On *this* deployment `viewApp` is granted to all
(`config.GENERATED.SECRET.ts:8`), so published content is already public and
this is not exploitable. On any card-web deployment that restricts `viewApp` —
a shape `config.SAMPLE.json` supports — the shared record hands the whole
published corpus to the next visitor on the device.

Cheap hardening regardless: **re-filter on read** with the same
`snapshotEligibleCard(card, true)` predicate the write already uses. Today the
read path trusts the record entirely, and both reconciliation paths
(`corpus-worker.ts:1274`, `published-removals.ts:16`) are conditioned on
`card.published`, so an unpublished card that ever reached the record could
never be removed by any later reconciliation.

## Smaller findings

- **Reading-list revert restores a stale whole-list snapshot**
  (`user.ts:619-622`). Stars and reads revert with a delta inverse, which
  composes; the reading list re-dispatches a list captured before the write,
  discarding anything that landed in between. Add A, then add B successfully,
  then A fails → B vanishes from the UI until reload.
- **Optimistic apply sets the loaded flags** (`reducers/user.ts:79-96` fires on
  any `UPDATE_STARS`/`UPDATE_READS`/`UPDATE_READING_LIST`, and the optimistic
  `apply()` now dispatches those on the main thread before any data arrives).
  Auto-mark-read on boot can flip `readsLoaded` true with a single entry,
  un-gating the app against a reads set missing ~608 entries.
- **A listener re-attach re-delivers the whole set as `added`**, and the
  reducers are `setUnion`-based, so a queued optimistic *removal* can be
  clobbered — the same "silently undo an action taken offline" the commit set
  out to prevent, arriving from the other side. Removals that happened while
  the listener was down can never be expressed at all.
- **The per-user listeners have no retry** (`corpus-worker.ts:1343, 1361`);
  their error path is `status()`, which the bridge only `console.log`s, while
  `syncState` keeps reporting `live`.
- **`readingList` and the three loaded flags survive sign-out**
  (`reducers/user.ts:66-74` resets `stars`/`reads` but not those), so the
  auto-anonymous session briefly treats the previous user's reading list as
  authoritative — a window this commit widens, since correction now requires a
  full worker reconnect.
- **New eager import cycle**: `corpus-bridge.ts:160-165` adds a *static* import
  from `actions/user.js`, closing the bridge↔database↔user cycle that the file's
  own fallback path uses a dynamic import specifically to avoid.
- **`WARM_CACHE_THRESHOLD = 1000`** gates the reader prime's
  `markInitialDelivered`; DEV has 1,239 published cards, so the offline result
  does not generalize to deployments with fewer than 1,000.
- **Tests**: `test/corpus-snapshot` adds two pure-helper tests
  (`corpusSnapshotKey` string-building, `snapshotEligibleCard` truth table) —
  nothing exercises `connectPublishedFromSnapshot`,
  `claimPublishedSnapshotWriter`, or the key↔filter *pairing* that is the actual
  privacy boundary. `test/optimistic-user-state` is a 4-case truth table over a
  10-line function and cannot represent discard-after-queue (R16-2), the exact
  failure its rule creates. `test/account-handover` is unmodified by `875fdcaf`
  and contains nothing about per-user state.

## Live verification log (Round 16)

- Fresh anonymous Chromium profile: cold boot, then IndexedDB inspection, then
  offline reload with the service worker confirmed controlling. Screenshot of
  the offline render captured.
- Admin device IndexedDB enumerated: record keys, card counts, and
  published/unpublished breakdown per record.
- Deployed DEV cache headers and the served worker bundle's protocol constant
  checked over the network.
- Admin per-user state read from Redux (608 reads, flags, uid).
- No card content was created, modified, or deleted this round; the anonymous
  profiles are scratch and were left in the session scratchpad.

## Recommended order

1. **R16-1** — one line, and it is both a security regression and a
   feature-defeat. Nothing else on this list is as cheap relative to impact.
2. **R16-2** — decide the reconciliation shape for terminal discards; the
   current invariant is unsound rather than incomplete.
3. **R16-3** — restore the per-user connects on the worker-failure fallback.
4. **R16-7's read-side filter** — one line, converts a permanent leak class
   into a self-healing one, independent of the config question.
5. **R16-4** — either persist sections/tags or stop claiming they are loaded.
6. R16-5 (add a `headers` block or hash the worker URL) and the smaller items.

## Round 16 addendum — verification of the R15 responses

A third review pass ran the new suites in an isolated copy of the repo and
mutation-tested them. Headline: **the test harness I recommended in R15-8 is
the strongest work on this branch.** It drives the real registered executors
through a real `MultiBatch` with nothing stubbed, it is genuinely hermetic
(`firebase.harness.json` + `--project demo-perf`; the emulator log confirms
"Detected demo project ID … attempts to access non-emulated services will
fail"), and **every mutant aimed at it was killed**, including the original P0:
removing `endAtomicGroup` fails 7 of 8 tests with "the card-create batch must
actually commit". `d5cf4a4e`'s R15-6 fix is likewise mutation-verified —
reverting it to `count !== FAILURES_BEFORE_REPORTING` fails on "once back
online the user MUST be told; the report is deferred, not cancelled". Full
suite independently reproduced at 765 passing.

Two things the commit messages get wrong, both verified in source:

### R16-8 (P1, new) — the R15-3 fix traded a weekly 40k-read burst for an unauthenticated on-demand one

`functions/src/idf.ts:56` now reads:

```ts
export const calculateIDF = onRequest({
	memory: '2GiB',
	timeoutSeconds: 540 // 9 minutes
}, async (_req, res) => {
	…
	const snapshot = await db.collection('cards').get();
```

The schedule is gone — that part of R15-3 is fixed, and the deploy-list
comment's reasoning for keeping it in `baseFunctions` (you must deploy the
unscheduled version to replace an already-live scheduled one) is correct.

But `onRequest` v2 functions are public by default: the Firebase CLI grants
`allUsers` the `run.invoker` role unless told otherwise, and this one declares
no `invoker: 'private'`, no auth or App Check, and no method check — the
request parameter is `_req`, unused, so a plain GET runs it. Each invocation
does a full-corpus read (~40k billed reads at current size), up to 9 minutes of
2 GiB compute, and appends a `idf-maps/idf-v${Date.now()}.json` object that is
never pruned. It is repeatable and concurrent.

The function's own comment banner says it is "MANUALLY invoked only. Run it
deliberately, when the IDF map is actually stale, and be aware of what it costs
each time." That intent is right; the deployment shape does not enforce it —
anything that learns the URL, including a crawler or a link-preview fetcher,
can trigger it. On a branch whose stated purpose is read-cost control after a
quota-exhaustion incident, this is a worse exposure than the schedule it
replaced.

**Fix:** add `invoker: 'private'`, or convert to `onCall` with an admin-uid
check. Worth confirming the current IAM binding on the already-deployed
revision as part of the cutover. (I verified this by reading source only and
did not exercise the deployed endpoint.)

### R16-9 (P2, new) — `card-delete` was added everywhere except `HIGH_VALUE_KINDS`

`src/aux-write-queue.ts:517` is still
`new Set(['card-create', 'comment-add', 'comment-edit'])`. `6f6aad55` added
`card-delete` to `AuxWriteKind`, `AUX_WRITE_KINDS`, `KINDS_REQUIRING_PAYLOAD`
and `DISCARD_LABELS` — but not here. Three consequences, the first of which
re-creates the exact failure that commit set out to remove:

- **The alert lies when storage is full.** `runDurableAuxWrite:715` only
  rejects on a persist failure for high-value kinds; otherwise it proceeds
  session-only. `deleteCard` (`actions/data.ts:2752-2757`) then sees `'queued'`
  and tells the user *"The deletion has been saved and will apply automatically
  when the connection recovers"* — while nothing was persisted. On reload the
  card is back.
- **No admission control**, and a `card-delete` intent carries
  `persistableCard(card)` — the full wire card *including `nlp_tokens` and
  `nlp_search_tokens`*. It is plausibly the largest intent kind and the only
  card-sized one bypassing `MAX_QUEUE_BYTES`. The executor needs only
  `card.published` and the outbound references, so the token fields are waste.
- **Silent 30-day age-out** (`:546-553` only logs and reports for high-value
  kinds), so a delete that never landed disappears with no trace.

Note the fix isn't a one-liner: adding it to the set makes `runDurableAuxWrite`
reject, and `card-editor.ts:1190` dispatches `deleteCard` unawaited, so the
rejection must be handled inside `deleteCard` — the same reason `comment-delete`
is excluded.

### Still open, and still only in this file

`861003a1`'s claim that Round 15's findings were folded into the queue "so the
review file is disposable" remains false: **deleting this document today would
lose 13 findings.** Absent from `docs/fast-corpus-fix-queue.md` at HEAD: all six
Round-13 performance findings (`grep -ic` returns 0 for `handoff`,
`selectDefaultSet`, `sharedDiffCards`, `IDF`, `cardMeta`) and all seven Round-15
"worth queueing" items — of which three were re-verified in code this round as
still exactly as reported (`tools/mount.ts:552` still hardcodes
`cardsCollection: 'cards'`; `migrate-nlp-tokens.mjs:66` still defaults to PROD;
`functions/src/twitter.ts:213` still says these functions "must never be
scheduled" while `functions/src/index.ts:63,76` schedules two of them).

The queue also still carries three mutually inconsistent accounts of the
renderer crash — the retracted "~1.5GB heap peak … seen once and never
reproduced" text at `:588-591` and `:604-613` sits beside "Round 14:
REPRODUCED, with numbers" at `:330` — and still asserts at `:350-353` that "this
tab's settled floor is ~1.02GB with the full corpus mirrored into the page",
which R15-1 refuted by dumping an empty Redux `data` slice in that same state.

Two smaller corrections to the queue's status claims: **R15-6's second half is
recorded as fixed but is untouched** — `aux-write-queue.ts:980` is still a bare
`await executor(intent, true)` with no timeout, so a deterministically hanging
executor still accumulates one failure, never reaches the threshold of 4, and
now also blocks the replay loop while holding the Web Lock. And **R15-7 is
narrower than recorded**: a server image missing a key whose `DEFAULT_IMAGE`
value is *non-empty* (`emSize: 15`, `margin: 1`) still false-conflicts; only
keys defaulting to a contentless value are covered.

Finally, `tools/assert-build-fresh.cjs` (a good addition) has three measured
false-pass modes: touching any file under `lib/` masks every stale source
(max-mtime vs max-mtime, not per-file), `tools/**/*.ts` and `functions/` are not
scanned though `tsconfig.json` emits them, and deleting a `.ts` leaves an
orphan `.js` undetected.

---

# Round 17 — the Round-16 responses, verified (2026-08-04)

Scope: HEAD `cc952726`, the seven commits answering Round 16 and its addendum
(`38c9b927`, `00495943`, `22750445`, `d2d147b8`, `ed72240f`, `a15aec55`,
`cc952726`). Full `npm test`: **green, 781 passing**.

Method note: repeated API outages killed the review subagents mid-run this
round, so the commit-by-commit verification was done inline by the coordinating
reviewer — every verdict below is from directly-read diffs and live probes, but
the two deep-dive passes (e.g. mutation-testing the new tests) did not happen.
Treat test-quality verdicts as read-only this round.

## Verdict

**Every Round-16 P1 and P2 is genuinely fixed, several of them better than the
recommended fix shape.** Live verification confirms the deployed state matches.
This is the cleanest response round so far: no fix-of-a-fix regressions found,
and two of the fixes are structural rather than local. Remaining items are
P3-grade or process notes.

## Verified fixed (each against the diff; live where marked)

| Finding | Verdict | Evidence |
|---|---|---|
| **R16-1** purge cleared the wrong store | **FIXED** | `purgePrivilegedSnapshot` now always constructs from `outgoingUid`; the `corpusSnapshotStore \|\|` fallback is gone, with the incident recorded in the comment. |
| **R16-8** `calculateIDF` public endpoint | **FIXED** | `invoker: 'private'` + POST-only, with the gcloud invocation documented and the "check the already-deployed revision's IAM" caveat in-source. The commit also flags (without changing) two pre-branch siblings with the same shape — the right scoping call. |
| **R16-2** unsound optimistic invariant | **FIXED, structurally** | All three terminal-discard sites (first-attempt `:818`, 30-day age-out `:560`, replay `:1042`) funnel through `reportDiscardedIntent`, which now notifies subscribers *before* the user-facing alert. `installOptimisticUserStateReconciler` reverts by kind, computes reading-list reverts from current state (also fixing the stale-snapshot revert), guards against double-install and against reverting another account's intent after a switch. `applyOptimistically` now reverts only on throw — correct, since a throw is the one failure with no intent to be discarded later. |
| **R15-6 second half** (replay hang never counted) | **FIXED** | The replay attempt is now bounded with the same `unsettledAttempts` bookkeeping as the first attempt; a hang records a failure (so the wedge report can reach its threshold) and no longer holds the replay Web Lock forever. The timeout rejection carries no `code` → classified transient → retained, which is the right call. |
| **R16-3** worker failure loses per-user state | **FIXED** | The shadow/spike fallback explicitly reconnects the three per-user connects. |
| **R16-9 / card-delete admission** | **FIXED, plus** | `card-delete` added to `HIGH_VALUE_KINDS`, and the intent payload is **trimmed** to the seven fields the executor needs — dropping `nlp_tokens`/`nlp_search_tokens`, which had made it the largest intent kind. |
| **R16-4** offline partial (sections/tags) | **FIXED, verified live** | Fresh anonymous profile, network off: `sections: 5, tags: 52` — identical to online — nav tabs rendered, 1,239 cards in 1.56s. The reader record now carries sections+tags. |
| **R16-5** worker bundle cache skew | **FIXED, verified deployed** | `firebase.TEMPLATE.json` headers block; live DEV serves `cache-control: no-cache` on `/lib/src/worker/corpus-worker.js`. |
| **R16-7** read-side filter / config assumption | **FIXED, structurally** | `cc952726` makes scope THE single decision: `snapshotScopeForSession()` derives both the record key and the card filter, so key↔filter disagreement is inexpressible; the load path re-filters with the same predicate; privileged scope passes everything (privileged loads unharmed). This is better than the recommended one-line filter. |
| Loaded flags from optimistic apply | **FIXED** | `UPDATE_*` actions carry `optimistic: true`; the reducer only sets `*Loaded` on non-optimistic (authoritative) deliveries. |
| Sign-out state survival | **FIXED** | `SIGNOUT_SUCCESS` now resets `readingList`, `readingListSnapshot`, and all three `*Loaded` flags. |
| Re-attach clobbers / removals inexpressible | **FIXED, both directions** | The worker sends re-attach deliveries as **authoritative full sets**; the reducer replaces instead of unioning, then **overlays the pending intent queue** on top — so removals-while-detached are expressed AND a queued offline removal survives the replace. Bonus: queued-but-unsent actions are now visible after a reload, fixing a gap that predates the optimistic layer. |
| Per-user listeners had no retry | **FIXED** | `connectUserState` now has generation-guarded re-attach with backoff (`userStateReattachDelayMs`). |
| Eager import cycle | **FIXED** (per commit message; diff shows the static import removed) | |
| `assert-build-fresh` false passes | **FIXED** | Rewritten per-file (relative-path comparison); spot-read only, not re-mutation-tested this round. |
| NLP fast path untested | **FIXED** | `test/card-processing` now drives `processCard` with real `nlp_tokens`, asserts fast-vs-slow-path equivalence, laziness (`_stemmed === undefined` until asked), and pins the changed enumeration surface (`_stemmed`/`_withoutStopWords` in `Object.keys`) with a comment naming the latent trap. |
| Fix-queue accuracy | **MOSTLY FIXED** | The six Round-13 perf findings and the Round-15 "worth queueing" items are now present (`handoff`, `selectDefaultSet`, `sharedDiffCards`, `cardMeta`, `migrate-nlp`, `mount.ts`, `twitter.ts` all grep-positive); the crash entries are explicitly cross-marked SUPERSEDED with pointers instead of contradicting each other. One gap: **`innerTextForHTML` (the worker regex-fallback tokenization divergence, R15) is still absent from the queue.** |

Also verified live this round: the reworked optimistic star path is healthy
(optimistic reflection 114ms, server-settled 647ms, queue empty, clean unstar),
and the deployed worker bundle serves protocol 4 with `no-cache`.

## New observations (nothing above P3)

1. **Late-discard revert can transiently undo a *successful* re-do.** The
   reconciler's star/read reverts are unconditional deltas
   (`updateStars([], [cardID])`). If a queued `star-add` is discarded weeks
   later (age-out) and the user had *successfully re-starred the same card* in
   between, the revert removes the legitimate star locally. Self-heals on the
   next authoritative re-delivery — which now exists (d2d147b8) — so this is
   P3: transient, narrow, and the alternative (consulting the server per
   discard) costs more than it buys. Worth a one-line comment.
2. **Reader record now persists sections/tags whose member lists reference
   unpublished card IDs** — measured: 14,218 tag→card and 515 section→card
   references outside the published set. Verified this is **parity, not a
   leak**: `firestore.TEMPLATE.rules:287,296` serve sections/tags to anyone
   with `viewApp`, member lists included, so anonymous clients always saw
   these IDs online. IDs only, no content. The same `viewApp`-restricted-
   deployment caveat as R16-7 applies, and the scope comment added in
   `cc952726` is the right place if that caveat ever needs enforcing.
3. `innerTextForHTML` worker divergence: still the one Round-15 finding
   tracked nowhere but this file.

## Open items at HEAD (unchanged from prior rounds)

The renderer-crash retention mystery (three occurrences, all aggregate leads
eliminated, StoredProcessedRun fix plausibly related but its effect
unmeasured); the six Round-13 performance findings (now tracked in the queue);
CI (`.github/` still CODEOWNERS-only) and the missing `engines` field; the
dated security-test tripwire (2026-09-15 — five weeks away and it will brick
`npm test` for whoever merges after it); the prod kill-switch decision; and the
two pre-branch public endpoints (`reindexCardEmbeddings`,
`cleanupOldEmbeddings`) now flagged in-source.

## Bottom line

Round 16's list is cleared, with two structural improvements
(single-decision scope; authoritative-replace-plus-overlay) that remove whole
classes rather than instances. From this reviewer's side the branch's remaining
pre-merge work is: the tripwire date, the `engines`/CI gap, deciding the prod
kill switch, and the standing crash investigation — plus finishing the queue
entry for `innerTextForHTML`. The write path, sync engine, reader path,
per-user state, and upgrade path have now each survived at least one
adversarial round without a new P1 emerging.

---

# Round 18 — the decision-log implementation, verified (2026-08-13)

Scope: HEAD `85cf65cc`, four commits implementing the product audit's decision
log (`3c8a3d62`, `843084f0`, `d7911781`, `85cf65cc`). Reviewed inline; full
`npm test`: **green, 789 passing**. Live-checked against deployed DEV.

## Verdict

Every decision-log item that called for code or docs is implemented, several
better than specified. One new finding — and it is the **fourth occurrence of
the branch's most-recurrent bug**, in the very commit that fixed the audit's
polish item. Plus one operational note: DEV's deploy predates the newest
commit, so the drawer fix is not actually running anywhere yet.

## Verified implemented

| Decision | Verdict | Notes |
|---|---|---|
| #2 tripwire out of `npm test` | **DONE, better** | `tools/check-deadlines.cjs` + `test:rules-deadline`; and the in-suite check got a **21-day warning ramp** with actionable copy — a cliff became a countdown. |
| #3 engines + CI | **DONE, better** | `"node": ">=20"`; workflow pins Node from `.nvmrc` AND Java (for the emulator suites). Standout: `test/ci-coverage/test.js` *asserts* that `test:ci` equals `test` minus the secrets-requiring suites — the "CI quietly runs less than it claims" failure mode is now structurally impossible. |
| #4 drawer copy | **DONE at HEAD; see R18-1 and the deploy note** | |
| #5 `innerTextForHTML` queue entry | **DONE — and then fixed outright** (`3c8a3d62`): numeric entities (dec+hex, range-guarded) fully decoded; curated named table for typographic punctuation + Latin-1 accents; `&amp;` correctly skipped in the named pass and decoded **last** with the double-decode rationale written down; unknown entities left as literal text rather than dropped. Tests added. Omission: **`&euro;`** (and Greek letters) — the one common prose entity not covered; one-line addition. |
| #6 kill switch | **DONE, better than spec'd** | `diagnosticModesAllowed()` removed entirely rather than allowlisting prod hostnames — the commit's reasoning (prod answers to two hostnames; a missed alias silently restores the no-escape-hatch behavior on exactly the host that needs it) is correct and the REVISIT condition is recorded. |
| #8/#9 rollback + delete-freeze habits | **DONE** | Runbook now has the ten-second pre-rollback check *with the exact devtools one-liner*, the draft warning, and the delete-freeze section with its single-writer rationale. |
| #17/#18 accepted residuals | **DONE** | Recorded in place in the guard with the single-editor reasoning. |
| #22 standing rule | **DONE** | In the queue. |
| #19–21, #23–25 deferred + triggers | **DONE** | Recorded with numeric triggers. |

## R18-1 (P3 severity, P1 pattern) — `_collectionPending` is undecorated: the fourth recurrence

`src/components/card-view.ts:389-396`:

```ts
@state()
	_collectionUpdating: boolean;
	//"the active collection has not been served yet", …
	_collectionPending: boolean;
```

The decorator applies only to `_collectionUpdating`; `_collectionPending` — the
field `85cf65cc` adds to make the drawer say "loading…" on a cold boot — is a
plain property whose assignment triggers no re-render. The fix works only when
unrelated boot traffic happens to re-render card-view (which is frequent during
boot, so it will *usually* appear to work — the worst kind of almost-correct).

This is the exact declared-under-a-neighbour's-decorator pattern found in
Round 13 (P1-4, four components), Round 14 (R14-4, `_suggestedTagsState`), and
fixed in a sweep both times. Round 15's T4 recommended an AST rule (the
`test/mutation-barrier` harness already parses TypeScript) requiring every
field assigned in `stateChanged` to carry its own decorator. It was never
implemented, and the bug has now recurred in the first commit to touch a
component since. **Recommendation: decorate the field (one line) and write the
AST rule this time — four occurrences is the argument.**

## Deploy note

DEV's hosted build has `last-modified 01:04:16 GMT`; `85cf65cc` was authored
01:06:22 GMT. The deployed site is two minutes older than HEAD, so a live cold
anonymous boot still shows the bare "0 cards" (verified — which also confirms
the gap `85cf65cc` describes is real). Redeploy DEV before counting #4 as
landed; the soak clock for the crash gate should also be running on the real
HEAD.

## Bottom line

The decision log is implemented faithfully — in three places more robustly than
asked (ramped tripwire, self-asserting CI coverage, hostname-free kill switch).
The one defect found is a one-line fix whose real message is the missing AST
guard: this bug class has now survived two "fixed everywhere" sweeps, and it
will keep coming back until a test, not a reviewer, owns it.

---

# Round 19 — break-it sweep: fresh lenses at HEAD `85cf65cc` (2026-08-13)

Scope: three agent passes on surfaces prior rounds under-covered (full-depth
review of the newest 11 commits, which Rounds 17-18 reviewed inline; empirical
hostile-data probes against built `lib/`; full master→HEAD authorization-delta
review) plus live stress measurement on DEV. This round also **corrects two of
my own prior verdicts and one of my own measurements** — details inline.

## Verdict

The best haul since Round 13: two new P1s (one of which means **the new CI has
never actually run**), a cluster of real P2s in the newest commits, and one
major measurement correction in the branch's favor. The rules/authorization
delta, by contrast, came back clean — it narrows access nearly everywhere.

## P1s

### R19-1 — `ownsUserState` is latched pre-auth and never refreshed; one boot ordering defeats the anonymous-listener fix, the other wedges the app

`connect` computes `ownsUserState`/`ownsSupplementalData` from Redux at send
time (`corpus-bridge.ts:1635`), but `reconnect` carries neither
(`worker-protocol.ts:146`) and the worker's reconnect handler updates only
`generation` (`corpus-worker.ts:3012-3017`) — the flags keep their
first-connect values for the worker's life. The first connect is almost always
**pre-auth**, when `selectUserIsAnonymous` is still false:

- Ordering A (connect before auth): `ownsUserState` latches **true** → after
  anonymous sign-in the worker attaches all three per-user listeners for the
  anonymous uid — the exact billed-reads behavior `00495943` claims removed
  (R16-6 is NOT fixed).
- Ordering B (persisted auth resolves first): the flag latches **false** → the
  worker never attaches per-user listeners, the main-thread ones are hard-gated
  off, nothing else dispatches authoritative per-user sets (verified by grep) —
  all three `*Loaded` flags stay false forever and `selectDataIsFullyLoaded`
  wedges: perpetual loading card, suggestions and durable-save resume blocked.
  R16-3's blast radius, reachable by boot timing on the public site.

Perverse coupling: fixing A alone makes B unconditional. The fix needs both
halves — carry the flags on `reconnect` (or recompute worker-side) AND deliver
empty authoritative per-user sets when the worker doesn't own user state.

### R19-2 — the new CI workflow cannot pass, and its self-check can't see that

`.github/workflows/test.yml` builds with `build:shared && build:typescript` on
a clean checkout — but ~10 modules in `src/` import `config.GENERATED.SECRET.js`,
which is gitignored and produced only by `generate:config`, which requires the
equally-gitignored `config.SECRET.json`. With `noEmitOnError`, every CI run
dies at the build step with TS2307. The (genuinely clever) `test/ci-coverage`
meta-test checks script-text relationships, not that the workflow can execute.
**This corrects my Round-18 verdict** ("#3 DONE, better" — wrong; the workflow
is decorative until a sample-config generation step exists). Fix shape: a
`generate:config --sample` path driven by the checked-in `config.SAMPLE.json`.

### R19-3 — one corrupt `nlp_tokens` record takes down whole-corpus processing (empirical)

The fast-path gate checks `nlp_version` and `nlp_source_fingerprint` — but the
fingerprint hashes **raw fields, not the tokens**, so corrupt tokens pass the
gate and hit an unguarded `storedRuns.map(...)`. Probed: a string-valued
`nlp_tokens` or a `[null]` run throws; the WeakMap cache is written only on
success so the throw repeats on **every access**; every whole-corpus consumer
(worker query engine, main-thread `lazyProcessCards`) dies on every evaluation,
and the worker's message dispatch has no try/catch. Truncated-but-well-typed
tokens are worse: zero runs, card silently unsearchable, nothing logged. The
snapshot validator checks cards only as "object with matching id" — a flipped
IndexedDB record feeds this directly. Fix is small and local: validate run
shape, fall back to the slow path that already exists.

## P2s

1. **The reading list never got the pending-intent overlay** — found
   independently by both agents. Stars/reads route through
   `receiveAuthoritative*` + `overlayPendingUserIntents`; the bridge still
   dispatches `updateReadingList(message.list)` as a wholesale replace, and
   every worker delivery (including post-error re-attach, now routine thanks
   to the retry) is a full list. Queue an add on a flaky connection → the
   next delivery visibly reverses the user's action. **Corrects my Round-17
   verdict** ("authoritative re-delivery FIXED, both directions" — true for
   stars/reads only).
2. **d2d147b8 changed the protocol without bumping the version** (still 4)
   while the page *removed* its main-thread sections/tags fallback. A stale v4
   worker + new page passes the handshake, never sends sections/tags →
   `*Loaded` never flips → silent `selectDataIsFullyLoaded` wedge — the silent
   variant of exactly what the exact-match handshake exists to prevent.
   Transitional exposure; the bump costs zero.
3. **Going offline can wipe the reader record's sections/tags.** The
   supplemental listener stores even a zero-doc from-cache snapshot into
   `latestSections/latestTags` and schedules a save; a `persist:false` reader
   raises exactly that empty fire offline → the record's navigation data is
   destroyed ~15s into an offline session, un-fixing R16-4 for subsequent
   offline boots until back online. (~70% confidence on SDK timing; the guard
   — skip empty `fromCache` deliveries — is cheap regardless.)
4. **Numeric-entity decode reintroduces the double-decode** the decoder's own
   comment prevents for the named spelling: `&#38;mdash;` → em dash (DOM:
   literal `&mdash;`), because pass-one output is re-scanned by the named
   pass. Also `&#55296;` emits a **lone surrogate** where the DOM emits
   U+FFFD (traced: worker-local only today, no Firestore-write path — but the
   trap is armed for any future persist of worker-computed text), `&#0;`/
   over-max left literal, and the tag-stripper eats ordinary `3 < 5` prose as
   a "tag" — data loss in worker search for math-y cards.
5. **Best-effort kinds bypass queue admission control** (empirical): the
   count/byte caps are enforced only for high-value kinds, so a long offline
   reading session (auto-mark-read every 5s) can fill the queue past
   `MAX_QUEUED_INTENTS`, after which **card creation is refused** ("more than
   can be safely queued offline") while the queue is full of 150-byte reads.
6. **A stale snapshot resurrects deleted sections/tags for the whole session**:
   `UPDATE_SECTIONS`/`UPDATE_TAGS` merge, so a record-injected entry survives
   every live full-map delivery; a deleted section reappears in nav each boot
   until a post-save reload.
7. **`check:deadlines` doesn't cover the deploys it was written for**: it's an
   npm pre-hook on `npm run deploy*`, but the runbook's rules deploys — 
   including Phase 6 itself — use `npx firebase deploy --only firestore:rules`,
   which bypasses npm hooks entirely. (Moot if the carve-out amendment lands
   and the deadline is deleted; otherwise wire it into firebase.json predeploy.)

## Authorization delta (master→HEAD): CLEAN, three LOW notes

Rule-by-rule review of the full ~225-line rules diff: the delta **narrows**
access nearly everywhere (updated-invariant enforcement, tombstone gating,
star/read/reading-list id-binding, the inbound-reference identity floor). 
Anonymous principals cannot get, list, or `count()` tombstones; unpublished
count()/partition query shapes fail closed; storage delta is the idf-maps
`get` rule only, and the map is built from published body cards only; config
injection cannot silently widen a rule (malformed values fail the deploy).
Security suite: **201/201 passing**. Three LOW findings for the queue: a
star-count inflation cycle (bare star delete then re-create+increment nets +1
per cycle — far better than master's arbitrary ±1, but the rule comment
overclaims), tombstones forgeable at never-existed card ids by *trusted*
principals, and `users/{uid}/multi_edit_chunks` having no schema/size bound.
Also: Firebase CLI 15 rejects Node 18 before the emulator starts — the
`engines` field encodes this correctly.

## Live measurements (Round 19)

- **Back-from-vacation boot**: after 9 idle days, `loadComplete` 8.1s but
  `live` at **49.3s** — worst yet (prior range 7.4-31s); mechanism is
  presumably the 9-day delta catch-up + gate repairs. Since **saving is gated
  on `live`**, this is "return from a trip, can't edit for a minute." Worth a
  progress surface or a gentler gate.
- The ~2.5s boot freeze persists (5.5-8.1s in, every boot measured).
- Interaction under stress, all healthy: collection switching 107-159ms
  across 12 rapid switches; editor typing p50 18ms / p90 21ms; find-as-you-
  type p50 61ms per keystroke (first query ~2s warm-up); one 631ms long task
  across the whole stress run.
- **Heap correction (against my own Rounds 14-16 numbers).** The author's
  tooling docs warn that long-attached CDP sessions with console listeners
  retain remote objects and inflate the heap — and they're right: after a
  clean relaunch of the debug Chrome, a listener-free raw-CDP measurement
  settles at **229MB post-GC** (matching the author's 230MB), versus 1,501MB
  measured through my 11-day-old instrumented connection minutes earlier. My
  1.0-1.5GB "retention" figures (including Round 15's snapshot analysis of a
  contaminated heap) were substantially instrumentation debris. Caveats: the
  clean-run boot didn't reach `live` within 240s (relaunch oddity, worth one
  re-check), so 229MB may be pre-corpus; and the *crash* remains real but its
  leading "retention" indicator was polluted by the measurement itself. The
  shape-metadata mechanism found in Round 15 was real code (the fix stands);
  its measured magnitude in that snapshot can no longer be trusted.

## Smaller notes

`fromWire` turns an own `__proto__` key into the rebuilt object's prototype
(no global pollution; only reachable from a corrupted IndexedDB record — skip
the key in the walk); Timestamp impostor shapes (`seconds:'evil'`) construct
NaN-bearing real Timestamps un-validated; ghost index entries persist forever
in `readPendingAuxHeaders` (spurious replay triggers each boot); the one-record
snapshot serializes to ~461MB for a token-bearing synthetic 40k corpus —
inside the historically fragile IndexedDB band, though save failure is
correctly capped at 3 attempts; a rejected first dynamic import in
`withUserActions` latches for the session, dropping all subsequent per-user
deliveries; re-attach backoff never resets on success; sections/tags cross
postMessage without wire markers (prototype-less Timestamps — no consumer
breaks today); `assert-build-fresh` has case-insensitivity and
deleted-mid-scan edges. Mobile card sizing (R16) remains uninvestigated.

## Priority order for the response round

1. R19-1 (both halves together — the flags on `reconnect` + empty
   authoritative delivery), since one of its orderings is a public-site wedge.
2. R19-2 (make CI actually run — sample-config generation).
3. R19-3 (validate `nlp_tokens` shape, fall back to slow path).
4. P2-1 reading-list overlay + P2-2 protocol bump + P2-3 fromCache guard, as
   one coherent "finish d2d147b8" commit.
5. P2-5 admission control for best-effort kinds; P2-4 decoder ordering +
   surrogate clamp; P2-6 snapshot-merge semantics; the LOW rules notes at
   leisure.

---

# Round 20 — the Round-19 responses, verified (2026-08-14)

Scope: HEAD `ed77ff8d`, two commits (`3b2d82a0`, `ed77ff8d`) answering Round
19. Reviewed inline with executable verification. Full `npm test`: **green,
797 passing.**

## Verdict

**Every Round-19 P1 and P2 is fixed, and the two hardest ones were verified by
execution rather than reading.** This round also finally closes the branch's
longest-running process gap: the `@state()` footgun now has an AST test.

| Round-19 finding | Verdict | How verified |
|---|---|---|
| R19-1 latched ownership flags (both halves) | **FIXED** | `reconnect` now carries freshly-computed `ownsUserState`/`ownsSupplementalData` and the worker re-latches them; ordering-B (auth-first) is closed by the sign-in path dispatching **empty authoritative sets** for anonymous users, flipping the `*Loaded` flags without listeners. Both halves landed together, as required. |
| R19-2 CI cannot run | **FIXED, verified by execution** | `CARD_WEB_CONFIG_FILE` env override + `generate:config:sample` from the checked-in sample (an env var *deliberately* rather than a `cp` that would clobber real credentials locally). I simulated CI in a clean secret-less worktree: sample-config → `build:shared` → `tsc --noEmit` **exit 0**. |
| R19-3 corrupt `nlp_tokens` crash loop | **FIXED** | `validStoredNLPTokens` shape-checks containers, run objects, `normalized` type, and `uppercaseRanges`; failure falls back to the existing slow path. New tests. |
| Reading-list overlay missing | **FIXED** | `receiveAuthoritativeReadingList` exists and the bridge routes through it. |
| Protocol not bumped | **FIXED** | Version 5. |
| Offline wipes reader sections/tags | **FIXED** | Empty `fromCache` deliveries skipped (`corpus-worker.ts:1405`). |
| Numeric-amp double decode + surrogates | **FIXED** | `&#38;`/`&#x26;` deferred to the last pass with the DOM-semantics rationale; surrogate/NUL/over-max handling addressed in the same rework. |
| Queue admission bypass | **FIXED, right shape** | ALL kinds now consult `groupFitsInQueue`; over-budget best-effort intents degrade to session-only (with a console note) instead of either persisting past the cap or failing — durable capacity is reserved for card writes, and reads/stars still work in-session. |
| Stale snapshot resurrects sections/tags | **FIXED** | `UPDATE_SECTIONS`/`UPDATE_TAGS` now carry `complete`: replace for whole-map deliveries, merge for deltas. |

## The headline: the footgun finally has an owner

`test/reactive-state/test.js` — a TypeScript-AST rule requiring every field a
component assigns in `stateChanged()` *and* reads in its template to carry its
own reactive decorator. Two design choices worth applauding: **no exemption
list** (an earlier draft flagged all undecorated stateChanged-assigned fields,
found six, investigated all six, found them legitimately plain, and narrowed
the rule instead of accumulating excuses — the header documents this), and the
suite includes a vacuous-pass guard. I mutation-tested it: removing
`_collectionPending`'s decorator (R18-1, now fixed) fails the suite with a
precise, actionable message. Wired into both `test` and `test:ci`. Four
occurrences across six rounds; it should be structurally impossible now.

## Notes

- **The deploy-lags-the-commit habit recurred**: DEV's build (14:15 GMT)
  predates `ed77ff8d` (14:21 GMT) by six minutes — the same pattern that made
  Round 18's live check test the wrong build. Harmless each time so far, but
  the runbook's verify steps assume the deployed build IS HEAD; worth making
  the deploy script print the deployed commit hash, or deploying last.
- Not re-verified this round (unchanged): mobile card sizing (R16, still
  open), the crash soak status, and the Round-19 LOW rules notes
  (star-cycle, tombstone forging, multi_edit_chunks bounds) — all remain
  queued.

## Bottom line

Round 19's list is cleared with executable evidence, the recurring bug class
is fenced by a test, and the remaining open items are the long-tail queue
(LOW rules notes, mobile sizing, crash soak, deferred perf triggers). From
this reviewer's perspective the branch is back to its Round-17 state — no
known unfixed P1s — but now with CI that actually runs, an AST guard on its
most-recurrent bug, and the decision log fully executed.

---

# Round 21 — deploy stamp, verified (2026-08-14)

Scope: HEAD `89bf9ffd`, two commits (`1dce48ab`, `89bf9ffd`) implementing
Round 20's deploy-lag note. Verified live.

- **Works end-to-end**: `https://<site>/deploy-stamp.json` reports
  `{short: "89bf9ffd", dirty: false, deployedAt: …}` — exactly HEAD, live.
  Both deploy paths call `writeDeployStamp()` after `build()` (so `rm -rf
  build/` cannot eat it) and before the hosting upload.
- **The DIRTY refinement is right**: tracked modifications plus untracked
  files under the SOURCE trees only — so the reviewers' untracked docs don't
  make the warning fire on every deploy ("a warning that always fires is one
  nobody reads"). Verified: stamp says `dirty: false` with two untracked docs
  present.
- **One residual (P3)**: the stamp is served with `cache-control:
  max-age=3600`, so "is HEAD live?" can be answered with last hour's stamp —
  the one file that should never be cached. Add `/deploy-stamp.json` to the
  no-cache headers block in `firebase.TEMPLATE.json`, next to the worker
  bundle entry that already exists. One line.
- Suggestion while in there: the runbook's post-deploy verify step should
  `curl` the stamp and compare to `git rev-parse HEAD` — the tool now exists;
  make the checklist use it.
