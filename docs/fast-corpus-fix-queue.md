# fast-corpus pre-land fix queue

Working state for the Round 9 five-lens adversarial review (correctness, UX,
security, performance, robustness). **Items are DELETED from this file as they
are resolved**, each deletion committed with its fix. When this file is empty it
gets deleted, and the queue is done.

Dedup note: several findings were reported independently by 2-3 reviewers; those
are merged into a single item and marked with the lenses that found them.

---

## Round 12 — four-lens adversarial review (robustness / perf / UX / data-loss audit)

Findings marked **[MINE]** are regressions introduced by this session's own work.

### P0 — data loss / wedge

- **R1/L1 [MINE]. `runDurableAuxWrite` awaits an executor that never settles offline.**
  A Firestore commit on the memory-only main-thread cache neither resolves nor
  rejects while offline — the branch's own comment says so. So `await
  runDurableAuxWrite(...)` HANGS: `createCard` never dispatches its failure,
  `EXPECT_NEW_CARD` stays latched (app stuck "not fully loaded"), the `'queued'`
  outcome and its reassurance message are unreachable, and the intent stays in
  `inFlight` forever, which makes `replayPendingAuxWrites` skip it permanently.
- **L1 [MINE]. Bulk import persists intents ONE AT A TIME.** `makeAuxWriteIntent`
  is pure; only `runDurableAuxWrite` persists. Stalling on card 1 of a 200-card
  import means intents 2..200 were never written — 199 cards lost on reload.
- **L6/R2. The queue's failure policy is "silently drop everything"**, written
  when it held only stars/reads. One corrupt `JSON.parse`, one `validIntent`
  miss, or a 30-day age-out silently returns `[]`, and the next write persists
  that empty list — erasing every queued card creation and comment. And
  `writePendingAuxWrites` swallows `QuotaExceededError`, so an intent that was
  never persisted is treated as durable.
- **L7. `card-create`'s fanout is not atomic.** No `beginAtomicGroup`, and
  MultiBatch splits and commits concurrently with independent success. If the
  card batch lands and the section batch does not, the replay preflight sees the
  card exists and returns — the card is permanently missing from its section and
  tags, silently.
- **L2. A `'discarded'` comment destroys the typed text.** `reportCommentOutcome`
  ignores `'discarded'`, so `composeCommit`'s restore path never runs. A comment
  on a card another device just deleted returns `not-found`, which the queue
  classifies as permanent.
- **L3. A resumed durable multi-edit CLOBBERS newer content.** The record carries
  no base version, and `CardDiff` text fields are whole-value replacements. Edit
  on laptop → fails transiently → edit properly on phone → laptop wakes days
  later and writes the stale text over the phone's. Fully automatic, no confirm.
  `edit-draft.ts` already has the right machinery (`baseUpdated` + a confirm).

### P1 — correctness

- **R3/L5 [MINE]. `created`, `updated_substantive` and `updated_message` are now
  CLIENT-CLOCK values on every created card.** A sentinel is identity-keyed, so
  JSON destroys it and the executor re-vends only `updated`.
  `updated_substantive` is what every `updated/*` collection sorts and buckets
  on, so a skewed clock parks new cards in the wrong day — or the future.
- **R4. The initial attempt writes no cross-tab claim**, though the type comment
  says it does. Only replay claims. Two tabs can both execute one intent:
  `star-add` double-increments, `comment-add` double-increments `thread_count`.
- **R5 [MINE]. `bulkCreateWorkingNotes` latches `BULK_IMPORT_PENDING`** on two
  exits, leaving the dialog permanently scrimmed with no message.
- **L4. `modifyCardsIndividually` refuses silently** (no failure action), and
  `applySuggestion` reads the error selector before the commit could resolve —
  so a suggestion is marked applied when nothing was written.
- **L2b. `editMessage`/`deleteMessage` have no durable record**, and
  `deleteMessage` is dispatched unawaited with no global rejection handler.
- **R7. `waitForCardToExist` never times out** — two silent hangs.

### P1 — performance (boot to `live` is 26s against a 15s budget)

- **F3. The published listener is deferred past the whole prime CPU block**, not
  just past the IndexedDB read it was meant to avoid contending with. Moving it
  to just after the snapshot `load()` resolves is safe by construction (the
  non-compact branch already attaches before its cache query, and the ordering
  race is handled). Est. 2-5s.
- **F2. A second full trust gate runs before `markWatermarkPlane('delta')`.** Its
  ordering protects the SNAPSHOT SAVE, not `live`; gate the save instead. Est.
  0.5-2s.
- **F4. Tombstone and delta listeners are serialized** when only their plane
  bookkeeping needs ordering. Est. 0.5-2s.
- **F5 [MINE]. The queue does O(queue) read-modify-write per operation** and now
  carries ~2KB card payloads, so replay is O(N^2) in bytes.
- **DO THIS FIRST: `status()` messages carry no timestamps**, so none of the
  boot decomposition above is measurable. Emit one line on `live` with deltas
  for each checkpoint and every estimate becomes a number.

### P2 — UX consistency

- **U28. A NON-BLOCKING storage warning puts up the full-screen lockout panel.**
  The snapshot-persistence failure calls `degraded()`, which is in
  `CORPUS_STATUS_BLOCKS_INTERACTION`, so the whole app goes behind a modal
  headlined "Cards could not load" whose body says "The app still works". Both
  buttons are useless for a quota condition. Raw `String(e)` reaches user copy.
- **U29. The disabled-control tooltip fix was applied in three files and missed
  in the two create-card buttons** — icon-only, no tooltip, not focusable, and
  Cmd-M is silently swallowed on the theory that those buttons explain it.
- **U30. Every "blocked" tooltip says "still verifying", but the same gate fires
  on `stale`/`off`/`degraded`** — the header pill says "interrupted" while the
  Save tooltip says "verifying". Derive the reason from the status.
- **U31. The save pill's destructive control is styled identically to the safe
  one**, has no confirm, and is called five different things across the app.
- **U32. Identical gate, opposite feedback**: Cmd-M is a silent no-op while
  Cmd-Enter raises a modal `alert()`.
- **U33. Static `aria-label` + dynamic `title`** on the star/read/reading-list
  toggles — the accessible name is wrong in half of all states, no `aria-pressed`.
- **U34. Ownership panel**: headline restated verbatim in the body, "restart
  Chrome" in four strings, hardcoded colors/sizes outside the app's tokens,
  double-announced live region.
- **U35. Copy drift**: eight different sentences for "sync is not live yet",
  three for "inactive", two for "contended"; `DEFAULT_MESSAGES` is a second,
  already-drifted copy of the status strings; `corpus` leaks into user copy;
  `…` vs `...`. Export shared constants.
- **U36. `.count` on the status pill is ~2.3:1 contrast** — the one number the
  branch exists to show.

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

## P1 — performance

### P23 (residual, product decision). Server-confirmed save p95 is ~1.07s
Re-measured properly on real DEV after the N1 fix, 10 consecutive saves of one
card with a byte-exact restore afterwards:

  editor release    p50 48ms    p95 80ms
  server-confirmed  p50 622ms   p95 1066ms   (samples: 1066,670,620,595,626,
                                              622,656,586,574,791)

Round 10 measured the same thing at p95 5070ms, and concluded the near-constant
~5s pointed at sequential round trips in the durable protocol, so shortening it
would be a protocol change. That conclusion was WRONG: most of it was the
delta-listener round trip the durable path uniquely depended on, which the N1
fix removed. Criterion 4 ("Save <1s with durable intent") is met at p50 and
missed at p95 by 66ms, on one card on one machine. Whether that counts as met
is the owner's call; there is no longer a known structural cause to attack.

## P2 — security hardening

- **S4 (residual).** Firestore's own `persistentLocalCache` still survives
  sign-out. The materialized privileged corpus (the compact snapshot) IS now
  purged, robustly, regardless of which connect path signed out — but the
  Firestore cache is a second, larger copy and clearing it needs
  `terminate()` + `clearIndexedDbPersistence()`. `connectCards` proceeds
  synchronously to `connectPublished()` for the signed-out reader, which needs a
  live `db`, so a correct purge means restructuring that path to re-initialize
  Firestore afterwards. Attempted and backed out for exactly that reason; the
  constraint is recorded as a comment at the call site.
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
- **U15.** `e` is a silent no-op (see U7/C3).
- **U18.** Suggested tags render empty on worker timeout, indistinguishable from
  "no suggestions" (`card-editor.ts:984-992`).
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
