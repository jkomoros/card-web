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
- **FIXED. The S4 purge was honored only at a fresh worker boot**, so a
  same-session A->B account switch ran on A's persistent cache until something
  else happened to reload. `purgePersistence` rides only the FIRST connect
  message — the one that creates the worker — and signing out then signing in
  as a different account never reloads the page, so B kept running against A's
  Firestore cache: a second, larger copy of the privileged corpus, unpublished
  bodies included, sitting in IndexedDB.
  A handover now reloads. Blunt, and chosen deliberately over restarting the
  worker in place: the worker lifecycle is what ownership, the readiness gate
  and the whole boot path are built on, and a bespoke mid-session teardown is
  far likelier to break those than one reload on a rare auth transition. The
  DECISION lives in `src/account-handover.ts` as a zero-import leaf with
  `test/account-handover`, because each branch is a distinct way to get it
  wrong. In particular it does NOT reload when no worker has been connected yet
  (an ordinary fresh boot already carries the purge — reloading there would hit
  every returning user), it NEVER reloads over an open editor (the same promise
  the SW update path makes; the request survives in localStorage for the next
  boot), and it reloads at most once per pending purge (a failing purge would
  otherwise reload forever).

### NOT yet folded in from the review file (R16 correction)

The claim elsewhere in this document that "the review file is disposable" was
FALSE by thirteen findings. These live only in
`docs/fast-corpus-landing-review-2026-08-02.md` and are recorded here so the
queue is the single list it claims to be. None are fixed.

Round 13 performance (six, none present here — `grep -ic` for `handoff`,
`selectDefaultSet`, `sharedDiffCards`, `IDF`, `cardMeta` returned 0):
the main-thread handoff cost, `selectDefaultSet`, `sharedDiffCards`, the IDF
map's size and load path, and `cardMeta` — see the Round 13 section of the
review file for the measurements.

Round 15 (seven "worth queueing" items) — likewise see that file.

Three were re-verified as still true at R16 and are worth naming, because each
is a foot-gun rather than a perf number:
- `tools/mount.ts:552` still hardcodes `cardsCollection: 'cards'`.
- `tools/migrate-nlp-tokens.mjs:66` still defaults to PROD.
- `functions/src/twitter.ts:213` still says the tweet functions "must never be
  scheduled" while `functions/src/index.ts:63,76` schedules both. One of these
  two statements is wrong and it matters which.

### Still open from Round 16

- **P2-3. FIXED, but the first attempt was wrong and the reason is worth
  keeping.** Moving the sections/tags listeners into the worker (which was the
  right move for the privileged case — resume tokens, and they survive offline
  there) did NOT fix the measured case, and the DEV check still returned
  `sections: 0, tags: 0` offline. A READER's worker runs `persist: false`, by
  the same constraint the compact snapshot exists for: Firestore inside a worker
  offers only a single-tab lease, so a reader must not contend for it. A reader
  therefore has NO Firestore cache to serve from, in the worker or anywhere.
  The fix is to carry sections and tags in the compact snapshot record itself,
  beside the cards they navigate — the record IS the reader's persistence layer.
  Optional fields, so an older record still loads. Verified on DEV: offline now
  reports `sections: 5, tags: 52`, identical to online, where it previously
  reported 0 and 0 while both loaded flags claimed true.
- **P2-3 (original report).** Measured anonymous, same page: online
  `sections: 5, tags: 52` becomes offline `sections: 0, tags: 0`, while
  `sectionsLoaded` and `tagsLoaded` are both true and `corpusStatus` is `live`.
  Navigation disappears behind a stuck "Loading…" and anything gated on
  "sections loaded" proceeds against an empty set. The compact snapshot covers
  CARDS only. Either persist sections/tags alongside it or stop claiming
  loaded — the current combination is the worst of the two.
- **P2-6, remaining.** A listener re-attach re-delivers everything as `added`,
  and `setUnion` cannot express a removal, so a re-attach can clobber a queued
  optimistic REMOVAL. (The other two P2-6 items — premature `*Loaded` flags and
  per-user state surviving sign-out — are fixed.)
- The test gaps the reviewer lists: nothing exercises
  `connectPublishedFromSnapshot` / `claimPublishedSnapshotWriter` or the
  key↔filter PAIRING that is the actual privacy boundary; the `nlp_tokens` fast
  path (`StoredProcessedRun`) has no test at all, and its enumeration surface
  changed (`Object.keys`/spread/`structuredClone` now emit `_stemmed` /
  `_withoutStopWords` and omit the getters) — latent, no live consumer today.
- `tools/assert-build-fresh.cjs` has three measured false-pass modes: touching
  any file under `lib/` masks every stale source (it compares max-mtime to
  max-mtime, not per file); `tools/**/*.ts` and `functions/` are not scanned
  though tsconfig emits them; and deleting a `.ts` leaves an orphan `.js`
  undetected.

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

- **R15-6. NOW actually fixed; the earlier FIXED claim covered only half.** The
  replay path was a bare `await executor(intent, true)` with NO timeout, so a
  deterministically hanging executor (a Firestore commit on a memory-only cache
  while offline neither resolves nor rejects) hung the replay loop forever WHILE
  HOLDING THE REPLAY WEB LOCK — no tab could replay anything after it — and the
  intent accumulated exactly ONE failure, so the four needed to report a wedge
  could never arrive. The counter's whole premise is that a deterministic hang
  is as wedged as a deterministic throw, and the hang was the case it missed.
  The replay attempt is now bounded by the same timeout, its rejection carries
  no `code` so it is classified transient and RETAINED, and the outstanding
  promise is recorded in `unsettledAttempts` so a later replay waits on it
  rather than racing a rival copy. Tested, including that the queue is still
  usable afterwards (the lock was released).
- **R15-6 (first half, unchanged).** The wedge alert could be permanently SILENCED rather than
  deferred. Reporting keyed on the count being EQUAL to the threshold, so any
  reason to skip the report at exactly that count lost it forever — counts 5,
  6, 7 ... never matched again — and the `navigator.onLine` suppression was
  exactly such a reason. Now the failure record carries a `reported` flag and
  the test is `count >= threshold && !reported`, so offline DEFERS the report
  instead of cancelling it, it still fires only once per distinct error, and a
  different error re-arms it. Records written before this change lack the flag
  and simply report once, which is the safe direction.
- **R15-7. Narrower than first recorded; the remaining two gaps are now closed.**
  The contentless rule only ever forgave EMPTY defaults, so a base recorded
  before a key existed still false-conflicted against a server copy carrying
  that key at a NON-EMPTY default — `DEFAULT_IMAGE` has `emSize: 15` and
  `margin: 1`, so ordinary image edits were still refusable with nothing the
  user could edit to resolve it. `overwrittenCardFields` now takes per-field
  defaults (the module stays a zero-import leaf; `data.ts` passes
  `{images: DEFAULT_IMAGE}`) and fills them on both sides before comparing.
  Separately, and worse because it ran the other way: a `Date` (or Firestore
  `Timestamp`, or any class instance) has no enumerable own keys, so
  `contentless` judged EVERY one of them empty and two different Dates compared
  EQUAL — a MISSED conflict, i.e. the guard silently waving through the
  overwrite it exists to catch. Both `contentless` and `canonical` now treat a
  non-plain object as an opaque value. Both directions tested.
- **R15-7 (original half, unchanged).** The overwrite guard compared key ORDER-insensitively but
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
- **Measured, with a boundary drawn. Read this before spending more time here.**
  A clean-profile pass on real DEV (Chrome restarted between runs,
  `HeapProfiler.collectGarbage` twice, then `Runtime.getHeapUsage`) established:

      fresh boot, corpus 40,225        230-234MB main-thread heap
      5 consecutive in-renderer reloads 231 / 230 / 230 / 231 / 230MB  -- FLAT
      25 editor open/close cycles       456 -> 458MB                   -- FLAT
      12 minutes idle at live           685 -> 686MB                   -- FLAT
      boot to loadComplete              8.2-8.7s;  to live ~11.1s

  So the three activities most suspected of leaking do NOT leak, and the
  earlier hypothesis that in-renderer reloads were the crash mechanism is
  DISPROVEN.

  The 230 -> 456 -> 685MB "ratchet" I reported earlier DID NOT REPRODUCE and
  should be treated as an instrument artifact, not an application leak. Five
  consecutive boots in one restarted browser gave 229MB, and heap snapshots
  taken after 1 boot and after 5 boots are compositionally identical
  (5,668,763 vs 5,581,188 nodes; 249MB vs 245MB of self_size). The most likely
  explanation for the earlier readings is my own tooling: a `page.on('console')`
  listener retains its arguments' remote objects for the life of a CDP session,
  and those sessions were attached for long stretches. RESTART CHROME between
  comparison runs.

  So: no leak was found from navigation, editor open/close, or idle time, and
  the crash's 1,763MB remains unexplained by anything reproducible here.

  WHAT THE SNAPSHOT DID FIND, and it is reproducible and large — 40% of a
  FRESH-BOOT main-thread heap is V8 shape metadata:

      system / Map (hidden classes)   1,738,607 objects   66.3MB
      system / DescriptorArray          157,305           29.8MB
      system / TransitionArray           42,507            2.0MB
      (enum cache)                       10,021            0.5MB
      ------------------------------------------------------------
      shape metadata                                     ~98.6MB of 249MB

  That is ~43 distinct hidden classes PER CARD at 40,225 cards. Healthy code
  shares shapes across instances; this is the same failure mode as the
  StoredProcessedRun fix, which is therefore only PARTLY addressed. The likely
  source is the card model's ID-keyed dictionaries — `references`,
  `references_info`, `references_inbound`, `references_info_inbound`,
  `font_size_boost`, `auto_todo_overrides` — where every card has a different
  key SET, so every one of those objects gets its own Map plus a transition
  chain. The direction is to hold ID-keyed dictionaries as `Map`s rather than
  plain objects; that is an architectural change and NOT a pre-acceptance-test
  edit. Supporting counts: 819,676 plain `Object` and 715,361 `Array`
  instances, ~20 and ~18 per card respectively, which is just the card shape.

  Two smaller observations from the same snapshot: 38,358 separate `working-notes`
  strings and 40,231 separate copies of one author uid (JSON.parse does not
  intern), together ~1.6MB that interning would reclaim.

  The tooling is now in the repo so this is reproducible rather than a one-off:
  `tools/capture-heap-snapshot.mjs` and `tools/heap-snapshot-report.mjs` (the
  report streams, because the file exceeds V8's max string length and the
  `strings` table it needs comes last).

- **Heap effect of the shape fix is STILL UNMEASURED, and I did not establish
  it.** The crash report's 574MB / 1,763MB are PROCESS-level; everything above
  is the main-thread isolate only, via `Runtime.getHeapUsage`. Those are not
  comparable — the exact instrument mismatch that invalidated the previous
  before/after — so no before/after claim about the shape fix should be made
  from these numbers. A real A/B needs the same instrument on both sides, and
  the worker isolate included (attaching to the worker target for its heap
  failed here and needs fixing first).

- **Boot-to-live variance did not reproduce.** On a clean profile the spread is
  tight (loadComplete 8.2-8.7s across six boots); the earlier 12.8 / 19.7 /
  31.6s figures were taken on a long-lived, heavily-navigated tab.

### Renderer crash: one more occurrence (2026-08-03)

A `Page crashed` on the FIRST load after a deploy that bumped the worker
protocol 3 -> 4 (so every cached worker bundle was invalidated and the
mismatch-recovery path ran). The tab was heavily abused by that point in the
session: dozens of navigations, the full 40k corpus, repeated forced GCs and two
~830MB heap snapshots taken from it.

Did NOT reproduce: restarting Chrome and repeating the identical sequence on a
fresh renderer worked cleanly (608 reads via the worker, all loaded flags true,
corpus 40,225). So it cannot be attributed to that change, and cannot be ruled
out either. Recorded because the crash is still unexplained and every genuine
occurrence is worth its conditions. Note the correlation with the same
"long-lived tab" shape as the earlier crash report — and that a protocol bump
plus SW cache invalidation is a heavier-than-usual boot.

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

So neither reloads nor takeovers retain.

RETRACTED (R16): the sentence that used to follow — that the ~1.02GB floor was
"the full corpus mirrored into the page" — is refuted. The reviewer dumped the
Redux `data` slice in exactly that state and found 0 cards, 0 cardMeta and the
worker terminated, with 1,010MB still retained. So the floor is NOT the page's
copy of the corpus, and whatever holds it is still unidentified. Against a
4,192MB limit it is a high floor; calling it explained was wrong.

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

### Found by smoke-testing a real DEV deploy (FIXED)

- **The "Update ready" banner covered the editor's Save and Cancel buttons.**
  Both banners are `position: fixed` in the bottom-right corner, and the card
  editor's action row is fixed in that same corner while editing:
  `elementFromPoint` at the centre of BOTH buttons returned the banner, so
  clicks never reached them. The banner's own text is "Update ready — save or
  cancel your draft first", so it instructed the user to press exactly the two
  controls it was blocking, with no way to comply — a genuine dead end on the
  service-worker update path, not a cosmetic overlap.
  Fixed with an `.editor-open` modifier that lifts the update banner to
  `bottom: 4.25rem` and the draft-recovery banner to `7.75rem` so the two do not
  then stack on each other. This is the same class of bug as the two corner
  clearances already commented in that CSS (the comments panel's add button and
  the drawer's create buttons); the editor's row was the case that got missed.
  Verified against the deployed DEV build: banner y=1164-1211 vs buttons
  y=1227-1271, and the Cancel click LANDS where it previously timed out.
  Worth knowing for any future check of this kind: the service worker is
  cache-first, so a fresh deploy is NOT what an open tab loads. The first
  verification attempt silently tested the PREVIOUS bundle and appeared to show
  the fix failing. Unregister the service worker and clear caches first.

### Prod-cutover blockers: anonymous persistence (FIXED)

Readers now keep a compact snapshot of their own. Firestore inside a dedicated
worker supports only `persistentSingleTabManager({forceOwnership: true})`, so a
reader cannot be handed the Firestore cache without contending for the single
lease a signed-in owner tab will steal — but the compact snapshot has no such
constraint. It is the application's own IndexedDB record and was ALREADY keyed
by scope, so the published scope simply joins the privileged one, and Firestore's
cache stays exclusively the owner's. That is the whole persistence model in two
sentences, which is the point: no second informal lock over Firestore's lease.

Design notes worth keeping:
- The record is keyed `${projectID}:published`, with NO uid. Published content
  is identical for every viewer, so one record serves them all and survives the
  anonymous uid churning between sessions — which is what makes a second
  anonymous visit warm at all.
- That sharing is only sound because the save filters to published cards. A
  signed-in NON-privileged user also runs author/editor listeners, so their own
  unpublished cards are in the same corpus; writing those into the shared record
  would hand them to the next anonymous visitor on that device. This is a
  privacy boundary, and `snapshotEligibleCard` is unit-tested as one.
- Staleness needs no cursor. The published listener is a FULL-SET query, so its
  first server-confirmed delivery is the complete authoritative corpus for the
  scope, and `publishedGhostIDs` already reconciles anything the snapshot holds
  that the server does not — machinery that predates this and was written for
  exactly this shape. That same delivery is the reader's trust gate, exactly as
  strong as the privileged path's three healthy planes.
- Exactly one reader tab writes, via a Web Lock requested WITHOUT `ifAvailable`
  so the role transfers when the writing tab closes rather than being lost.
  Readers have no ownership lease by design (a public visitor's second tab must
  keep working), and their default token is epoch 0, so `claimOwnership` would
  otherwise accept every tab.
- `save()` aborts unless a stored owner record matches, so the reader path must
  claim explicitly even though it has no epoch. Missing that produced silent
  no-ops reported only as "ownership changed during the write" — found by
  running it on DEV, not by reading it.

MEASURED on DEV with a fresh signed-out profile:
    offline, no network at all    loadComplete 1,458ms, all 1,239 cards
    warm prime                    "published compact snapshot prime: 1239 cards"
                                  at +672ms, initial load complete immediately
    privileged path unchanged     primes 40,225 from its snapshot, saves, live
                                  in 10.3s

NOT fixed, and deliberately not overclaimed: BILLING. The published listener is
still a full-set query on every boot (~28-35 Firestore requests, unchanged),
because resume tokens live in Firestore's cache, which a reader structurally
cannot hold. What changed is that the corpus is served locally and instantly,
and works with no network; what did not change is that liveness still costs one
published query per boot. Reducing that needs a watermark-bounded published
delta query, which is a larger piece of work.

Also unfixed: online, an anonymous `loadComplete` is still gated on the
author/editor listeners, which are network-bound and always EMPTY for an
anonymous account (the rules' `userMayCreateCard` requires admin or explicit
permissions, so an anonymous uid can never author a card). Evidence that this is
the remaining gate: with the same snapshot, offline is 1,458ms while online warm
is ~4,100ms. Skipping those two listeners for an anonymous session would need an
`isAnonymous` field on the connect message and a protocol version bump.

### Prod-cutover blockers: per-user state re-reads (FIXED)

Stars, reads and the reading list are now read by the CORPUS WORKER and
forwarded to the main thread as the same add/remove deltas the main thread used
to derive from `docChanges()`, so the reducers are untouched. The worker is the
only context holding Firestore's persistent cache, so its re-attach bills deltas
instead of the whole result set; the main thread runs a memoryLocalCache and was
re-reading everything on every boot (measured: 608 `reads` documents for the
owner's DEV account, every boot). Gated once at each listener's DEFINITION in
database.ts rather than at the two call sites, so there is exactly one rule.
Protocol bumped 3 -> 4; the version pin test is deliberate and was updated
knowingly.

THE HALF THAT IS NOT OBVIOUS, and was not in the original framing of this item:
these toggles never applied anything locally. The star/read/reading-list UI was
painted entirely by the listener echo, which was instant only because the write
and the listener shared ONE Firestore instance — latency compensation fires on
the pending mutation. The worker's instance knows nothing about the main
thread's pending write, so moving the listener alone would have made every
toggle wait for a server round trip before it visibly did anything. So the
change also adds an optimistic layer (`applyOptimistically`), and the subtle
rule in it is unit-tested: a QUEUED write must NOT revert, because the intent is
durable and will be retried, which is exactly what the UI promises — reverting
would silently undo an action taken offline. Only 'discarded' or a throw revert.
Re-applying is safe because the stars/reads reducers are set-based.

Verified on real DEV:
    per-user state via the worker   608 reads, all three loaded flags true
    star toggle                     store reflected in 192ms / 83ms
                                    (includes the driver's click round trip),
                                    settling with pendingIntents=0
    account state                   restored (the test unstars what it starred)

One bug caught only by running it against a real account: the first version
suppressed EMPTY delta messages, and the reducers set `starsLoaded`/`readsLoaded`
from receiving the message at all — so an account with no stars stayed
permanently "not loaded". That is most accounts.

Billing was NOT re-measured, and cannot be from here: the gain is on PROD, where
the account is large. The mechanism is the one that matters (resume tokens now
exist for these queries because the worker's cache persists them).

### Prod-cutover blockers (do NOT gate the merge; DO gate the deploy)

- Anonymous visitors lost all card persistence: readers get memory-cache
  workers and the main thread drops to memoryLocalCache, so every anonymous
  visit re-downloads the published corpus and offline viewing is gone. This is
  the public site's primary audience.
  NOW MEASURED on DEV, fresh signed-out profile, two consecutive visits:
      ownership state                 "reader" (as designed)
      IndexedDB after two visits      firebase-heartbeat-database,
                                      firebaseLocalStorageDb — and NOTHING else
      visit 1 / visit 2               loadComplete 4.1s / 4.3s
      Firestore requests              43 / 46
      corpus                          1,239 published cards, both times
  So BOTH persistence layers are absent — no Firestore cache database and no
  compact-snapshot store — and the second visit gets zero warm-boot benefit.
  Offline is therefore impossible, not merely degraded.
  Root cause is two independent gates: `persist = corpusWorkerOwnsCardIngestion()
  && ownershipState !== 'reader'` in the bridge (so a reader's worker takes
  memoryLocalCache), and firebase.ts demoting the MAIN thread to
  memoryLocalCache whenever the worker owns ingestion. And the compact snapshot
  cannot simply be switched on for readers: `corpusSnapshotStore` is constructed
  inside `connectUnpublishedWatermark`, i.e. it exists only on the PRIVILEGED
  path, so the published-only reader path has no snapshot machinery at all.
  Why readers are excluded is a real constraint, not an oversight: inside a
  dedicated worker Firestore supports only
  `persistentSingleTabManager({forceOwnership: true})`, so two clients cannot
  hold the same database, and a reader tab holding it would collide with a
  signed-in owner tab.
- `on` mode fails closed on browsers without module-worker support (Safari
  <15, Firefox <114) — shell plus a permanent error, where master worked.
  PARTLY ADDRESSED: the error is now ACCURATE rather than misleading. The
  mechanism is worth knowing — `new Worker(url, {type: 'module'})` does NOT
  throw on such a browser, it silently creates a CLASSIC worker which then
  fails to parse the ESM bundle and arrives as an ordinary startup error, so
  the panel said "Reload to retry", which can never work. A lazy feature probe
  (evaluated only on the failure path, so the happy path pays nothing) now
  selects a message naming the browsers that do work. The probe relies on Web
  IDL argument conversion running the `type` getter before the URL is resolved;
  verified true on Chrome, and the throwing case is handled because the getter
  has already answered by then.
  What this does NOT do is make those browsers work. The real fix is a CLASSIC
  (non-module) worker bundle as a fallback — still a worker, so it does not
  violate the "no legacy fallback bypassing worker ownership" criterion, unlike
  the main-thread fallback. That is a build change and a deploy-gating decision,
  not a pre-acceptance-test edit. NOTE the unsupported branch could not be
  exercised here: no browser lacking module workers was available, so only the
  supported branch is verified live.
- Main-thread per-user state (stars/reads/reading-lists) is memory-only in the
  default mode, so heavy accounts re-bill tens of thousands of reads per boot.
  MEASURED on DEV for the owner's account: 608 `reads` documents, 0 stars, 0
  reading-list — all re-fetched on every boot, because the main thread runs
  memoryLocalCache in worker modes and so has no resume tokens. The PROD number
  is the one that matters and cannot be measured from here (PROD is off limits);
  it is structurally the same and larger.
  Same root cause as the anonymous-persistence item: the main thread was demoted
  because the worker holds Firestore's single-tab persistence lease. The fixes
  are therefore architectural — move per-user reads into the worker, which
  already has persistence, or give the main thread its own Firestore
  app/database instance (complicated by auth persistence keys including the app
  name).

### Performance (measured live by the reviewer)

- A ~2.5s main-thread freeze during boot.
  SUPERSEDED (R16): the "~1.5GB heap peak" and "seen once and never reproduced"
  halves of this entry are stale and contradicted the Round 14 section above,
  which reproduced the crash WITH numbers. Two later occurrences are also
  recorded (2026-08-03, and the 2026-08-01 one below). Treat the Round 14
  section plus the R16 clean-profile measurements as the current record.

---

## Round 12 — four-lens adversarial review (robustness / perf / UX / data-loss audit)

Findings marked **[MINE]** are regressions introduced by this session's own work.

### P2 — UX consistency


---

## P0 — data integrity / release blockers

### Renderer crash, 2026-08-01 (SUPERSEDED — see the Round 14 section, which reproduced it)
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
