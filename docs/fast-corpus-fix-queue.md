# fast-corpus pre-land fix queue

Working state for the Round 9 five-lens adversarial review (correctness, UX,
security, performance, robustness). **Items are DELETED from this file as they
are resolved**, each deletion committed with its fix. When this file is empty it
gets deleted, and the queue is done.

Dedup note: several findings were reported independently by 2-3 reviewers; those
are merged into a single item and marked with the lenses that found them.

---

## Verified on real DEV (2026-08-02)

- **Save round-trip re-verified after every Round 12 / F7 / F8 change**, 10
  consecutive saves with a byte-exact restore: editor release p50 44ms p95
  292ms; server-confirmed p50 530ms **p95 779ms** (was 1066ms, and 5070ms in
  Round 10). Criterion 4 ("Save <1s with durable intent") is now met at p95 as
  well as p50. P23 is closed.

- **F7 boot reorder**: boot-to-live 27,973ms -> 7,442ms, inside the 15s
  advisory budget. tombstone catch-up 16,052 -> 1,317ms, and the published
  plane 19,488 -> 5,559ms. `mismatchedPartitions=0` on both boots, which is the
  signal that the catch-up still completes before the trust gate — if the
  ordering had broken it would read 1 plus a partition repair.
  NOT yet run: the two-device delete-while-away and launder-vs-delta ghost
  tests. They need a second profile; worth doing in the acceptance test.

- **S4 purge**: cached Firestore documents went 1,625 -> 0 across a purge boot,
  measured with the network OFFLINE so nothing could re-cache and mask it; the
  request flag cleared, and the app recovered to the full 40,225 cards when
  back online. Only the HONOR half was exercised end to end (the flag was set
  directly); the sign-out trigger that sets it was not, because signing out of
  the debug browser cannot be undone without the owner's password. That one
  line is worth confirming during the acceptance test.

## Round 13 — external landing review (2026-08-02)

Full report: docs/fast-corpus-landing-review-2026-08-02.md. Fixed already:
the card-create P0, the owner's private notes removed from history, the image-edit false conflict, the
bulk-path cross-tab window, non-reactive save gating, the bare-`e` keystroke
hazard, layout-dependent shortcuts, wedged-intent reporting, the stale landing
rationale, the runbook index gate, and the cold-sweep clamp discard.

### TEST COVERAGE — first executable coverage of the thunk layer exists now

`test/card-create-executor` drives the REAL registered executor, building a
REAL MultiBatch, committing to a REAL Firestore emulator, then reads the
documents back. It proved out on the two bugs that actually shipped: reverting
the endAtomicGroup fix fails 4 of its 5 tests with "the card-create batch must
actually commit", and re-stamping only `updated` fails with "created must be
server-assigned, not the intent's client value (got 2020-01-01)".

The claim that this layer could not be tested was wrong, and cheaply so:
lib/src/actions/data.js imports in plain Node behind the jsdom shim the suite
already uses, and src/firebase.ts has a loopback-only emulator hook. Two things
were needed that are worth knowing for the next harness: the `user` reducer
must be registered by hand (store.js registers only `app` and `data`; the app's
components add the rest lazily, and without it the executor silently skips the
author write), and a section must be seeded before a card can join it.

A second suite, `test/comment-executors`, now covers the L2b paths that shipped
reasoned-about but never run: the server preflight, the conflict refusal, the
already-applied no-op, delete idempotency, and an edit whose add has not landed.
Shared setup lives in `test/harness-support/app-harness.js` so the next suite
costs ~10 lines: jsdom globals, the loopback emulator flag, the `user` reducer,
and an ALERT CAPTURE (jsdom implements neither alert nor confirm, and without
the capture every user-reporting path throws inside a jsdom timer — which is
why the reporting paths, the ones that keep failing silently, had been
impossible to test).

Both suites were mutation-tested rather than merely written, and that caught a
weakness in one of MY OWN tests: deleting the already-applied branch left the
test green, because execution falls through to the conflict check and the
assertions held FOR THE WRONG REASON. Fixed by asserting the distinguishing
signal — a no-op is silent, a conflict tells the user. Mutation-test every test
added here; a test that cannot kill its mutant is the instrument this branch
has already been burned by three times.

Card DELETION now has a durable record and executable coverage too (it had
neither: the UI committed before any server work, and the enumeration of the
updates subcollection rejects offline into a promise nobody awaited, so the
card silently came back on reload). It is also now VERIFIED ON REAL DEV against
real rules rather than only against the harness's permissive ones: two cards
deleted through the actual editor button, each confirmed gone on a fresh boot at
`live`, with a card left untouched in the same run as the control that proves
the check discriminates. DEV is back at its 40,225-card baseline.

Two harness lessons from that verification, both of which produced a FALSE
FAILURE that looked like a product bug:
- `deleteCard` opens with `confirm()`. Playwright auto-DISMISSES dialogs, so the
  thunk early-returned and the run reported "card still present, no intent
  queued, no alert" — the exact signature of a broken durable write. Override
  `window.confirm` in an init script before concluding anything.
- Reading `data.cards[id]` in the SAME session moments after `live` is reached
  can still show the card: the worker had already logged the tombstone removal,
  but the corresponding Redux update had not landed yet. On a fresh boot it is
  gone at 0 s. Take server truth from a fresh boot, not from the live edge.

A second process lesson, worth as much as the tests: a mutation that does not
COMPILE proves nothing. Two mutants "survived" against card-delete until I
noticed tsc had failed on an unused import, so lib/ was never rebuilt and the
suite had run against the correct code. Always check the mutant builds. The one
mutant that survived legitimately — deleting the already-gone check — was real,
because re-deleting an absent document is harmless; what it is NOT harmless to
do is rewrite the tombstone timestamp the tombstone plane's cursor keys on, and
that is now the assertion.

The durable multi-edit chunk loop — the largest remaining uncovered piece — now
has `test/durable-multi-edit-loop` (8 tests): multi-chunk completion, resume
from `nextIndex`, marker probing across CONSECUTIVE chunks, refusing a marker
from another operation, the overwrite guard refusing/retaining/proceeding, the
same-value retry that must NOT conflict, and the single-card save whose target
was deleted elsewhere. This is the loop every card edit goes through, the
one-card editor Save included.

Mutation-tested, three mutants, and the FIRST VERSION OF TWO OF THESE TESTS WAS
WORTHLESS — worth recording because it is a trap specific to this loop. The
"already committed" cards were seeded holding exactly the value the update would
write, so a loop that wrongly re-processed them produced an EMPTY DIFF, wrote
nothing, and the test passed. The marker-probing mutant (stop probing after the
first marker — the real historical bug) survived. Fixed by seeding those cards
with a DELIBERATELY DIFFERENT body, so a wrongly re-planned chunk is visible in
both the body and the `card_updates` count. All three mutants now die:
- probe stops after the first marker → caught on the first card of chunk 2
- overwrite guard never fires → "the other device's content must survive"
- resume rewinds `nextIndex` to 0 → "is behind nextIndex; must not touch it"

The compile lesson repeated itself twice here, in both directions: one mutant
was rejected by `tsc` (`false &&` narrowed `operation` to null) and proved
nothing until rewritten, and one `str.replace` anchor silently did not match —
caught only because the script asserts its match count. Assert the anchor;
assert the mutant builds.

### Write-path P2s (folded in from the Round 13 review file)

- **FIXED. The attempt timeout defeated the "in-flight intents are skipped by
  replay" invariant**: an offline star or new-thread comment could double-apply
  star_count / thread_count after a same-session reconnect. The timeout drops
  the intent from `inFlight` deliberately — that is what keeps a stranded
  attempt from wedging the queue for the session — but offline the SDK still
  has the mutation queued locally and flushes it on reconnect, so the replay
  triggered by that same `online` event could commit a rival copy. The star and
  comment executors preflight the server on replay, which narrows the window
  but does not close it: the preflight can read before the original mutation
  lands, and these are `increment()` fanouts, so a second commit is a
  permanently wrong count.
  Unsettled attempt promises are now kept in a map, and replay awaits an
  outstanding one (bounded by the attempt timeout) before starting a rival —
  usually settling it, since the replay trigger IS the reconnect. Both halves
  are tested: the rival is not committed, and an attempt that never settles at
  all is still replayed.
- **FIXED. The durable executor's post-commit echo omitted the auth-scope guard
  its sibling passes** — a narrow sign-out-mid-commit window in which a chunk's
  cards, possibly UNPUBLISHED, were pushed into the corpus for whoever the tab
  now belonged to. The scope is captured per chunk immediately BEFORE the
  commit: at operation start it would be a stale record of a previous sign-in
  (a durable multi-edit can resume in a later session) and would reject every
  legitimate resume, while after the commit the sign-out has already happened
  and would simply become the "expected" scope.
  NOT covered by a test, and worth saying plainly: `echoLocalCardModifications`
  returns early unless the corpus worker owns ingestion, which it does not in
  the Node harness, so exercising it needs a worker-ownership seam that does
  not exist yet. The change itself is passing an argument the sibling path
  already passes, and the guard it feeds is covered there.
- **FIXED. An oversized card-create atomic group** (forking a hub card, >~250
  ops) splits and can partially land, after which the replay preflight cleared
  the intent — permanent silent loss of section/tag membership. The atomic group
  added for the P0 does not bound SIZE, and `endAtomicGroup` deliberately splits
  an oversized group across batches that commit CONCURRENTLY with independent
  success (refusing instead would make such cards permanently unsavable, which
  an earlier revision did).
  The fix is at the other end: the replay no longer treats "the card doc exists"
  as proof the creation finished. It re-applies the fanout, every write of which
  is idempotent by construction — arrayUnion of this card's id, audit documents
  under the key captured when the user acted, ensureAuthor, and the inbound-link
  mirror recomputed from the card — and skips ONLY the card document, the one
  write that cannot be repeated safely. Tested in both directions: a creation
  whose section membership and audit doc never landed is repaired, and an edit
  made after the creation is NOT reverted.
- The S4 purge is honored only at a fresh worker boot, so a same-session A->B
  account switch runs on A's persistent cache until reload.

### Release engineering (folded in)

- **There is no CI.** The stale-build half of this is now closed:
  tools/assert-build-fresh.cjs fails loudly when any hand-edited .ts in src/ or
  shared/ is newer than anything in lib/, wired through .mocharc.cjs (so all 41
  mocha suites get it without touching 41 script definitions) plus pre-hooks for
  the node --test suites and for `npm test` itself. A rebuild per suite was
  rejected: it would run tsc 40+ times per full run. What remains is actual CI —
  nothing runs the suite except a human choosing to.
- The rules' inbound-reference identity floor checks global permissions, so a
  user holding only per-card `permissions.editCard` cannot save link-affecting
  edits. Probably a null user set here; document the tradeoff.
- Worker-bundle version skew windows exist (stable unhashed worker URL vs
  hashed main chunks, ~1h CDN cache; a dirty-draft tab surviving an SW
  update). Mitigated by the exact-match protocol handshake, whose discipline
  is enforced only by a pin test.
- `test/security/test.js` carries a DATED tripwire: `npm test` fails outright
  from 2026-09-15 if the Phase 6 rules tightening has not happened. It will
  bite whoever merges after that date.

### From Round 15 (not yet fixed)

- **R15-6. FIXED.** The wedge alert could be permanently SILENCED rather than
  deferred. Reporting keyed on the count being EQUAL to the threshold, so any
  reason to skip the report at exactly that count lost it forever — counts 5,
  6, 7 ... never matched again — and the `navigator.onLine` suppression was
  exactly such a reason. Now the failure record carries a `reported` flag and
  the test is `count >= threshold && !reported`, so offline DEFERS the report
  instead of cancelling it, it still fires only once per distinct error, and a
  different error re-arms it. Records written before this change lack the flag
  and simply report once, which is the safe direction.
- **R15-7. FIXED.** The overwrite guard compared key ORDER-insensitively but
  not key SET, so a base recorded before a field existed differed from a server
  copy carrying that field at its default — a "changed elsewhere" refusal the
  user could not resolve by editing anything, i.e. a save they could not
  complete. Values are now canonicalized by recursively dropping CONTENTLESS
  object entries (absent, null, '', false, 0, [], {}), and two contentless
  whole-field values compare equal. Deliberately conservative: a field holding
  real text on one side and missing on the other is still a conflict, and array
  elements are never dropped because images are positional. Tested in both
  directions, including the assertions that keep the fix from degrading into
  "compare nothing".
- **Still open after the shape fix:** why ~129k NLP run objects are alive at
  all in a tab whose corpus was purged. _processedCardCache is WeakMap-keyed,
  so something still strongly holds many card objects; one retainer path runs
  through a rendered element's __card into memoized selector restArgs. Worth
  one targeted look now that the shape fix changes the denominator.
- **Heap effect of the shape fix is UNMEASURED.** Needs a clean-profile A/B
  with Runtime.getHeapUsage after a forced GC; my before/after used a different
  instrument on a long-lived tab and is not comparable.

### Renderer crash (Round 14: REPRODUCED, with numbers)

Second occurrence, crash dump 2026-08-02 10:28:26, on a long-lived tab after a
mixed session (create/delete, editor open/close, saves, draft recovery, a
two-tab takeover both directions, multi-edit, several in-renderer reloads).

  fresh boot to loadComplete, 40,225 cards   574MB settled (712MB peak)
  + section collection and drawer            787MB
  + 40 arrow-key navigations                 792MB
  + 10 find-dialog queries                   791MB — FLAT
  long mixed session, just before the crash  1,763MB after forced GC

This RETRACTS the earlier "1.5GB boot peak": a fresh boot peaks at ~712MB
against a 4,192MB limit, and navigation and search do not leak (4MB over 50
operations). So ~1.2GB of GC-resistant retention comes from something else.
BOTH named suspects have now been TESTED AND ELIMINATED (2026-08-02, same
debug tab, GC forced between iterations):

  5 consecutive in-renderer reloads   1038MB, 1038, 1038, 1038, 1038 — flat
  3 two-tab takeover cycles           1016MB, 1016, 1016 — flat

So neither reloads nor takeovers retain. What the same run DID show is that
this tab's settled floor is ~1.02GB with the full corpus mirrored into the
page, against the 574MB the reviewer measured at a fresh loadComplete — the
difference being a rendered section collection and drawer (they measured 787MB
for that). Against a 4,192MB limit that is a high floor but not a leak.

Remaining hypotheses, none tested: (a) the crash is a transient SPIKE on top of
a ~1GB floor rather than accumulation — the two occurrences both followed a
page navigation, which is when a new collection materializes; (b) retention
lives in the WORKER heap, which performance.memory does not see; (c) something
in the mixed session not covered above (editor open/close, draft recovery,
multi-edit). Next step should be a heap SNAPSHOT with a retainer path rather
than more aggregate polling — the aggregate has now said all it can.

### Boot-to-live variance is unexplained

Same machine, same corpus, Round 14: 12.8s, 19.7s, and one boot reaching
loadComplete at 31.6s and `live` only after >90s. The 7.4s figure is a BEST
case, not a typical one. Re-measure before treating the 15s advisory budget as
met.

### P1 — correctness (tracked, not yet fixed)

- **Unguarded backward ingest.** Five paths write the corpus without version
  guards (server prime, cold-sweep priority phase, each cold-sweep page,
  partition repair, the delta listener), so a partition-repair read racing the
  delta listener can roll a card back over a newer delivery — permanently, if
  it lands below the next boot's bound. This has been a code comment at
  corpus-worker.ts:709 marked KNOWN LATENT; it is now tracked. The naive fix
  (a monotonic `updated` filter at forwardBatch) was tried and REVERTED for
  two documented reasons, so closing it properly is a design change: the
  guard has to live where the exemption state is still intact, and per-card
  rather than per-batch.

### P2 — sync engine

- A second delta delivery can mark the plane live before the deficit re-gate
  finishes (transient).
- Partition-repair ghosts are never cache-laundered, so a console-deleted card
  gives a per-boot flash-ghost plus a ~4k-read repair, every boot.
- A future-`updated` inside the 1-hour tolerance can blackhole a window of
  edits.
- The tombstone cursor lacks the future-plausibility guard the card watermark
  has. (Tombstone pruning is unimplemented, so the long-offline hazard cannot
  occur yet.)

### P2 — UX

- Navigation while editing is allowed with no prompt and leaves the editor
  open and bound to the previous card. Structurally present on master too, but
  easier to hit here.

### Prod-cutover blockers (do NOT gate the merge; DO gate the deploy)

- Anonymous visitors lost all card persistence: readers get memory-cache
  workers and the main thread drops to memoryLocalCache, so every anonymous
  visit re-downloads the published corpus and offline viewing is gone. This is
  the public site's primary audience.
- `on` mode fails closed on browsers without module-worker support (Safari
  <15, Firefox <114) — shell plus a permanent error, where master worked.
- Main-thread per-user state (stars/reads/reading-lists) is memory-only in the
  default mode, so heavy accounts re-bill tens of thousands of reads per boot.
  Worth measuring before the cutover.

### Performance (measured live by the reviewer)

- A ~2.5s main-thread freeze and a ~1.5GB heap peak during boot. This is the
  best lead on the renderer crash seen once and never reproduced.

---

## Round 12 — four-lens adversarial review (robustness / perf / UX / data-loss audit)

Findings marked **[MINE]** are regressions introduced by this session's own work.

### P2 — UX consistency


---

## P0 — data integrity / release blockers

### Renderer crash seen ONCE, not reproduced
On 2026-08-01 the debug tab's renderer crashed immediately after unregistering
the service worker + deleting all caches and reloading (the heaviest
fetch-plus-prime path). It did not reproduce: the next boot completed in 11s
with 40,229 cards and a 550MB heap against a 4,192MB limit. One occurrence
under an artificial condition is not enough to attribute to the app, and not
little enough to ignore. Watch for it during the acceptance test.

---

## P1 — correctness

---

## P2 — UX polish

- **U14.** `card-editor.ts` switched from `?hidden` to conditional rendering for
  the Content/Configuration panes, so switching tabs destroys the Notes and
  Freeform TODO textareas — losing native undo history and scroll position. The
  text itself is safe in Redux. CONFIRMED by direct measurement (3 textareas on
  the content tab, 0 on config). ATTEMPTED TWICE and reverted both times: naively
  rendering both panes with `?hidden` did not change the measured behavior, and I
  could not explain why before running out of budget for a P2. Whoever picks this
  up: verify with a shadow-piercing probe that counts textareas inside
  card-editor's own shadow root across a tab switch, and note that rollup strips
  HTML comments from Lit templates, so a comment is NOT a usable staleness check.
- **U25.** Reference blocks render as nothing (not "loading") until the worker
  can serve, and stale blocks survive navigation to a not-yet-loaded card.
- **U26.** Takeover shows a static disabled button for up to 12 s with no
  progress and no cancel.
- **U27.** `inert` is a no-op on Firefox <112 / Safari <15.5, which with U4 lets
  Tab reach live controls behind the overlay.
- **C14.** A single `card-web-edit-draft-v1` key holds one draft
  (`edit-draft.ts:17`), so two concurrently-dirty editors overwrite each other;
  `persistDraft` is also unguarded against `QuotaExceededError`.
- **R16.** Listener retry has no jitter and no `resource-exhausted` case; all 13
  listeners re-attach in lockstep after an outage. (The dead-handle accumulation
  half is fixed.)
- **R19 (won't fix as stated).** The 1 Hz synchronous localStorage heartbeat is
  real, but it is NOT safe to pause while hidden: `forceStaleTakeover` decides a
  tab is dead from `Date.now() - lease.heartbeatAt > OWNERSHIP_STALE_MS`, i.e.
  from that very write. Pausing it makes a healthy backgrounded tab look stale
  within seconds and lets another tab force ownership away from it, including
  one holding unsaved work. Attempted and reverted; the reasoning is now a
  comment at the call site. Making it cheaper requires changing what takeover
  keys on.
- **P11.** Boot round-trips the snapshot through wire format twice
  (`fromWire` then `toWire(stripForWire())`) — ~1-1.5 s of the 7.1 s
  `loadComplete`.
- **P12.** Cold sweep re-reads its own priority phase (5,000 wasted reads, 11%
  of a cold boot).
- **P18.** 4 synchronous `localStorage.getItem` + up to 2 `JSON.parse` per
  dispatch (`card-web-app.ts:437-453`, `card-view.ts:1040`); during a durable
  multi-edit the parsed record can include full card objects.
- **P21.** Impure `localStorage` reads inside `createSelector` result functions
  (`selectors.ts:1701, 2000, 2014, 2031`); `markCorpusWorkerUnavailable()` flips
  mode without touching Redux, so memoized worker-served collections go stale.
- **P22.** Measurement integrity: `test/perf-harness/gen-corpus.js` never sets
  `nlp_tokens`, so every harness card takes the slow full-NLP path — harness
  interaction numbers overstate per-card cost while memory numbers understate
  it. Also there is no heap measurement in the harness at all.
