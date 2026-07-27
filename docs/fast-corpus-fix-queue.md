# fast-corpus pre-land fix queue

Working state for the Round 9 five-lens adversarial review (correctness, UX,
security, performance, robustness). **Items are DELETED from this file as they
are resolved**, each deletion committed with its fix. When this file is empty it
gets deleted, and the queue is done.

Dedup note: several findings were reported independently by 2-3 reviewers; those
are merged into a single item and marked with the lenses that found them.

---

---

## P1 — correctness

### C6. Takeover resurrects a completed multi-edit and duplicates audit history
`src/actions/data.ts:945-948`/`:579-582` (catch re-persists the in-memory
snapshot without re-reading) and `:472-482`/`:798-800` (`checkingServerMarker`
goes false after the FIRST probe). A fenced tab's late failure re-persists
`{nextIndex: 10}` for an operation another tab already completed to 30. On
Retry, only the first marker is checked, so a re-chunked replay writes a second
`card_updates` doc per card under a different batchID, permanently corrupting
audit history. The bulk-tag path is immune (operation-stable audit ids).

### C7/U16. Offline card CREATION is silently lost, unlike every save path
`src/actions/data.ts:1863` (`createCard`), `:1780`, `:1838`. Has neither a
durable intent nor a `durableSaveEligible` gate, unlike every save path. The
main thread is now `memoryLocalCache()`, so offline `batch.commit()` neither
resolves nor rejects and the card is gone on reload. Master's persistent cache
made this survive for free. Also the `+` / Cmd-M affordances are not disabled
during the unverified window, so you can create a card, type, and then be
refused Save.

### R8. A future-dated `updated` permanently poisons the watermark
`src/worker/watermark.ts:40-50`, `corpus-worker.ts:1275-1294`.
`deriveSessionWatermark` takes `max(updated)` with no wall-clock sanity bound.
One doc a year ahead → the delta bound matches nothing, and an EMPTY but
server-confirmed delta still marks the plane healthy → `live` → the poisoned
card is snapshotted → every future boot re-derives it. Silent permanent
staleness reported as live. Realistic trigger: an out-of-band/admin/migration
write. Note S1 above makes this remotely inducible.

### P13. Sync-meta ownership never claimed on the compact-snapshot path
`src/worker/corpus-worker.ts:1831-1837` builds `syncMetaState` inline and the
only `loadSyncMeta()` call is guarded by `if (!syncMetaState)`, so
`claimOwnership()` is never called on that path and every subsequent `save()`
aborts against a prior session's owner record — silently dropping ALL sync-meta
writes including per-page cold-sweep cursors.

### R11. Snapshot quota exhaustion is silent and retries forever at full cost
`src/worker/corpus-worker.ts:440-490`. No backoff, no disable-after-N, no
`clear()` to reclaim, and each retry runs a full synchronous `toWire` deep clone
of ~40k cards before the first await. The warm-boot advantage silently
disappears and the user is never told. Also the explicit-abort path logs
`(null)` because `transaction.error` is null on abort.

### R13. Worker unhandled rejections are invisible; boot-critical promises unguarded
`src/worker/corpus-worker.ts:2058`, `:2097`, `:2028`. No `self.onerror` and no
`unhandledrejection` handler anywhere in `src/worker/`, and worker rejections do
not reach `worker.onerror`. `gateAndProceed` has no try/catch, and
`sweepPartition` calls `updateLocalState`/`forwardBatch` OUTSIDE its try, so a
throw there stops verification permanently with no retry and no error anywhere.

### C9. `bulkTagResumeAttemptedThisPage` set by SUCCESSFUL saves, kills later resume
`src/actions/data.ts:416` (unconditional, never cleared on success), consumed at
`:593` which also guards `resumePendingDurableMultiEdit()`. A completed label
edit therefore disables automatic single-save recovery for the life of the page.

### C11. Sign-out snapshot purge no-ops after a non-privileged reconnect
`src/worker/corpus-worker.ts:2063`. `corpusSnapshotStore` is only created in
`connectUnpublishedWatermark`; a permission revocation reconnects non-privileged
first, so the later `uid === ''` connect finds a null store and the full
materialized unpublished corpus stays in IndexedDB. Also `clear()` never deletes
the `${key}:owner` record, and nothing anywhere calls
`clearIndexedDbPersistence`.

---

## P1 — UX

### U3. Every successful save fires an assertive alert whose Recover cannot work
`src/actions/data.ts:777-782` → `src/edit-draft.ts:94-99` →
`src/components/card-web-app.ts:335-341`. `stampDraftForSave` announces
synchronously but `_refreshDraftAvailability` is async, so it reads state after
`dispatch(editingFinish())` — editing false, draft exists, uid matches →
`_draftAvailable = true`. So every save pops `role='alert'
aria-live='assertive'` "An unsaved card draft is available." Recover is
guaranteed to throw because `editingStart` refuses while
`durableCardMutationPending()`; Discard removes the recovery record mid-flight.

### U5. Multi-edit dialog becomes undismissable and mislabeled
`src/actions/data.ts:949-952`, `src/components/multi-edit-dialog.ts:217-224`.
A failed SINGLE-card save sets both `bulkTagOperationProgress` and
`cardModificationError`, so opening Edit All Cards shows "Saved multi-edit needs
attention / Retry remaining 1 cards" for an operation the user never started —
and `_shouldClose()` returns early whenever `_bulkTagProgress` is truthy,
ignoring `cancelled`, so Escape AND the ✕ are both dead.

### U7. Cmd/Ctrl+Enter runs the whole confirm gauntlet before revealing refusal
`main-view.ts:487` → `actions/app.ts:445` → `actions/editor.ts:362` (no
eligibility check) → `actions/data.ts:752` (alert). The user answers the pending
slug, suggested-concept and overshadowed-changes confirms, THEN learns sync
isn't live. The mouse path is a hover-only tooltip. Two different behaviors for
the same intent, and no always-visible sync signal while the editor is open.

### U8. Drawer asserts "0 cards", undimmed, for the whole pre-loadComplete window
`selectors.ts:1701-1706`, `card-view.ts:1104-1107`. `selectActiveCollection`
returns a placeholder with `numCards: 0` and **`isFallback: false`**, so the
drawer stays showing, holds its 13em column, prints "0 cards", and the `else`
branch deliberately does not set `_collectionUpdating` — suppressing the dim +
"updating…" honesty mechanism exactly when the wait is longest. Then it pops
0 → 40,225. (Note: this also means my earlier `selectCardsDrawerPanelShowing`
change is inert on the worker path.)

### U9. Find dialog asserts zero results with no loading affordance
`find-dialog.ts:395-425`, `selectors.ts:2005-2021`. Cmd-F before `loadComplete`:
the query slot isn't subscribed, `_lastReadyCollection` is null so
stale-while-revalidate doesn't engage, and `selectFindSearchPreparing` bails
because `searchRecall` is null. The user sees "0 cards" and concludes the card
doesn't exist.

### U10. The boot-placeholder fix is inert — its premise is false
`card-renderer.ts:278-281`, `card-stage.ts:170`, `card-view.ts:685`.
`.boot-placeholder { font-style:inherit; opacity:inherit; }` was justified by
"the uniform fade card-stage already applies" — that fade is
`.loading card-renderer {opacity:0.6}`, keyed on card-stage's `loading`
property, and **card-view never sets it** (the only setter in the repo is
`basic-card-view.ts:84`). So "Loading..." now renders as ordinary full-weight,
full-opacity title/body text, visually identical to a real card.

### U11. Worker failure and unsupported browsers are unrecoverable walls
`corpus-mode.ts:38-51`, `corpus-bridge.ts:1023-1033`,
`corpus-ownership-gate.ts:84, 139-141`. Failing closed is criterion 9 and the
policy is right; the recovery affordance is not. `readCorpusWorkerMode()`
returns `'on'` unconditionally off dev hosts so the graceful `'fallback'` branch
is unreachable in production, and `writeCorpusWorkerMode('off')` is refused
there. A worker chunk 404 after a deploy gives a full-viewport "Cards could not
load" whose only button reloads into the same condition. `'unsupported'` renders
NO button, `_activate` early-returns, and `_containFocus` swallows Escape while
preventDefault-ing Tab onto a `tabindex="-1"` panel — a keyboard trap (WCAG
2.1.2) on a non-interactive element. These users could read the site on master.

### U12. Single-card save can fail with no alert, no pill, and no state change
`actions/data.ts:949` (`skipAlert` → console.warn only). The compensating UI is
the save pill, which renders only when a localStorage intent exists — so every
throw BEFORE `persistDurableMultiEdit` succeeds (including `!uid` and
`persistDurableMultiEdit` itself throwing on quota) leaves `_saveStatus` at
`'idle'`. User hits Save; nothing happens anywhere. The adjacent bulk-tag path
does not pass `skipAlert` — the inconsistency is the bug's shape.

### C13. `void trackMutation(...)` swallows `MutationFencedError`
`src/actions/comments.ts:102`, `:276`. In a fenced tab the user gets no feedback
and no error; there is no `unhandledrejection` handler anywhere in `src/`.

---

## P1 — performance

### P1. 93% of the search-recall index serves only a console debug hook
`src/worker/search-index.ts:131-144`, built from `corpus-worker.ts:350-394`.
`substringCandidates` — the only function the narrowing path calls — skips every
posting key containing a space, but `updateCard` indexes `nlp_search_tokens`
verbatim, which contain bigrams. The only consumer of bigram postings is
`candidates()`, reachable solely from `window.CORPUS_WORKER.query()`.
`candidatesUnion()` has no callers at all. MEASURED at 40,225 cards: build 4,439
→ 1,371 ms; 585k posting keys → 41k; 7.08M entries → 3.25M (~190 MB on a
synthetic corpus, likely more on real prose); `substringCandidates("karento")`
40 ms → 1.9 ms. Fix is ~3 lines: skip tokens containing a space in `updateCard`.

### P4. The re-gate doubles every boot's gate cost, and can repair-loop
`corpus-worker.ts:1267-1273`. Confirmed it cannot storm (the `firstServerDelivery`
flag is outside `makeHandler`, so listener re-attach does not re-fire it), but it
adds +40 count-reads to EVERY boot. Worse: a locally-pending write that creates
an unpublished card makes `local > counts[i]` (zero tolerance) while
`getDocsFromServer` overlays the pending write so the repair removes nothing —
so the boot pays gate(40) → repair(3,899) → gate(40) → repair(3,899) again,
every boot while the write stays unacknowledged. Fix: skip the repair when gate
#2's result is identical to gate #1's.

### P5. Main thread dropped to `memoryLocalCache`: 8 unbounded listeners lost resume tokens
`src/firebase.ts:103-104`. Master used `persistentLocalCache` unconditionally so
every listener carried a persisted resume token. Eight listeners the worker
never took over — messages, threads, stars, **reads (one doc per card ever
read)**, reading_lists, authors, sections, tags — have no `limit()` and now
re-read in full on every page load. The comment asserting they "are small and
online-only" is not evidenced. **Measure `reads`/`messages` sizes on DEV before
landing — this is the largest unknown in the audit and may partly cancel the
headline read-cost win.**

### P6. Seven independent 40k-key diff walks per cards-map identity change
`src/incremental-selectors.ts:27-42`, instantiated at `selectors.ts:396, 405,
438, 1047, 1058, 1474` plus a hand-rolled twin at `:1449-1466`. MEASURED ~19.5 ms
each → **~136 ms of pure "did anything change" walking** per cards-map change,
plus ~11.7 ms for the reducer spread. A single-card save ≈ 150-300 ms, ~30% of
the <1s bar. Fix: compute the delta once per transition and share it.

### P7. `QueryEngine.updateCards` replaces the whole 40k map per batch
`src/worker/query-engine.ts:225-233`. Changing `_cards` identity invalidates four
O(corpus) memos. MEASURED ~55 ms fixed per batch, plus 11.2 ms per changed
filter map in `reducers/collection.ts:297` (a 100-card tag edit → 55-170 ms,
paid twice: worker engine and main-thread Redux). Fix: hold the mirror as a Map
mutated in place, or version-count it.

### P2. Compact snapshot rewrites all 40,225 cards after every editing burst
`corpus-worker.ts:440-490`. `Object.fromEntries([...corpus.entries()].map(toWire))`
— a full deep walk allocating a fresh object per card — then one synchronous
structured-clone `put`. MEASURED from the author's own harness log: 12,000 cards
in 776 ms, twice → **~2.6 s at 40,225**, and real cards carry `nlp_tokens` which
the harness corpus lacks. The 15 s debounce is correct; the problem is there is
no dirty-card path, so changing 0.25% of the corpus rewrites 100% of it, and the
worker blocks for the duration. Interim: slice `toWire` across yields.

### P8. BFS filter spreads the lazy processed-cards proxy while editing
`src/filters.ts:528` — `{...cards, [editingCard.id]: editingCard}` where `cards`
is the `lazyProcessCards` Proxy, firing `processCard` for all 40,225 cards.
MEASURED 23 ms for traversal alone. `editingCard` bumps ~1/s while typing, with
~7-10 reference blocks each memoizing separately. Fix: shadow via a lookup
wrapper, not a spread.

### P9. Info-panel similar-cards fallback fingerprints the whole corpus on the UI thread
`selectors.ts:2074-2085` → `reference_blocks.ts:289-306` → `nlp.ts:1688-1715`.
The `similar` filter has no `enumerate`, so it materializes all 40,225
ProcessedCards and fingerprints every one. The author's own comment puts it at
1-2 s. Retention risk: with `serverIDF` null, `idfMapForCards` results are pinned
by WeakMap to live Cards for the corpus lifetime (~640 MB estimated per thread).
Fix: refuse to build a corpus-wide generator without a server IDF.

---

## P2 — security hardening

- **S3.** `firebase-emulator` localStorage flag is ungated in production and
  redirects Firestore **and Auth** to an arbitrary host
  (`src/firebase.ts:61-62, 127-137`; mirrored at `corpus-worker.ts:840-847`).
  One-shot XSS or device access becomes an indefinite silent MITM and a
  credential-phishing surface via the emulator's auth handler. The branch
  already has the right pattern in `corpus-mode.ts:18-22`
  (`diagnosticModesAllowed()`); apply it here and restrict host to localhost.
- **S5.** The `resource == null` hazard remains at `firestore.TEMPLATE.rules`
  chats read and chat_messages read. Both fail closed, but it is the same trap
  that destroyed stars. (The `reading_lists` read was fixed with S2.)
- **S4.** Data-at-rest remanence: the worker's `persistentLocalCache` is
  `CACHE_SIZE_UNLIMITED` and `clearIndexedDbPersistence` is called nowhere, so
  the full privileged corpus (including unpublished bodies) survives sign-out on
  disk.
- **S6.** Anonymous users can `increment(star_count)` with no star doc, and can
  increment `star_count` while decrementing `star_count_manual` in one write
  (`editOnlyIncrementsOrDecrements` accepts any ±1 combination).
- **S7.** The `tombstones` read rule evaluates `userMayViewUnpublished()` against
  a document with a different schema; a tombstone carrying an `author` field
  self-grants read to that uid.
- **S8.** `functions/src/index.ts` `health` — ungated `onRequest` disclosing
  which API keys are configured. Not in `baseFunctions`, so not deployed today.
- **S9.** `window.CORPUS_WORKER` (incl. `takeOver`, `setMode`) and
  `window.DEBUG_STORE` ship ungated, while the strictly less powerful
  `PERF_HARNESS` is flag-gated.
- **S10.** BroadcastChannel `'request'` branch has no correlation token
  (`corpus-bridge.ts:1391`), giving any same-origin script an ownership-churn
  primitive; replies also spread the attacker-supplied object.
- **S11.** `aux-write-queue.ts:65-72` validates `kind` only as a string, so
  `executors[intent.kind]` is an unguarded lookup (`kind:"constructor"` resolves
  to `Object`); `cardID`/`auditKey` flow unvalidated into document paths.
  Same class: `idf-cache.ts:69-80` (`as CachedIDF`, no shape check, `NaN` age
  never expires) and `card-web-app.ts:435-462`.
- **S12.** `tools/seo.ts:80-81` interpolates `card.title` into `<title>`
  unescaped. Build-time, published cards, editor-authored — pre-existing and out
  of branch, but the one path where stored content reaches served HTML unescaped.

## P2 — UX polish

- **U13.** `limit-warning.ts:94` shows a WARNING triangle for ~20 s of every
  healthy boot.
- **U14.** `card-editor.ts:539, 583` switched from `?hidden` to conditional
  rendering, so switching editor tabs destroys the textareas — losing native
  undo history and scroll position.
- **U15.** `e` is a silent no-op (see U7/C3).
- **U17.** Durable aux writes are discarded with only `console.error`; call sites
  are `void runDurableAuxWrite(...)` with no catch.
- **U18.** Suggested tags render empty on worker timeout, indistinguishable from
  "no suggestions" (`card-editor.ts:984-992`).
- **U19.** Save error text is hover-only (`card-web-app.ts:259`); visible text is
  the fixed string "Save paused". Unreachable on touch.
- **U20.** `corpus-status-indicator.ts:79` un-quiets `.label` for the header
  instance, which has no `max-width`, so the `stale` sentence wraps the header.
- **U21.** Update banner's Reload goes dead after the 15 s activation timeout
  (`card-web-app.ts:302-320`).
- **U22.** `card-drawer.ts:184` returns a fresh `<div hidden>` instead of
  `?hidden`, so collapse/reopen (and every editor minimize) destroys the list and
  its scroll position.
- **U23.** Floating status pill sits over presentation mode
  (`main-view.ts:379`).
- **U24.** Drawer `min-width` breakpoint is 600px but the app's mobile
  breakpoint is 900px, so 601-900px reserves ~208px for an empty column.
- **U25.** Reference blocks render as nothing (not "loading") until the worker
  can serve, and stale blocks survive navigation to a not-yet-loaded card.
- **U26.** Takeover shows a static disabled button for up to 12 s with no
  progress and no cancel.
- **U27.** `inert` is a no-op on Firefox <112 / Safari <15.5, which with U4 lets
  Tab reach live controls behind the overlay.
- **U28.** The `span.reason` wrapper pattern is incomplete: `card-view.ts:696`
  (reading list) still has `?disabled` + `title` on the button, `:697`/`:698`
  (star, mark-read) are `?disabled` with NO title at all, and
  `comments-panel.ts:130`. Also the technique does not help keyboard or AT users.

## P2 — correctness / robustness hardening

- **C14.** A single `card-web-edit-draft-v1` key holds one draft
  (`edit-draft.ts:17`), so two concurrently-dirty editors overwrite each other;
  `persistDraft` is also unguarded against `QuotaExceededError`.
- **R15.** No `onversionchange`/`onblocked` on either IDB store, so "Clear site
  data" hangs while the worker holds the connection.
- **R16.** Listener retry has no jitter and no `resource-exhausted` case; all 13
  listeners re-attach in lockstep after an outage. `unsubscribes.push` runs on
  every re-attach and never removes the dead entry.
- **R17.** Epoch saturation: `Number.isInteger(1e308)` is true, so a crafted
  lease passes validation and `+1` is a fixed point; with
  `corpus-snapshot.ts:108` accepting `epoch <=`, a stale worker can re-claim.
- **R18.** `finishUnresponsiveTakeover` leaks a queued lock request on success
  (`corpus-bridge.ts:1306-1315`).
- **R19.** Unconditional 1 Hz synchronous localStorage write for the tab's life,
  never paused on `visibilitychange`, no `pagehide` lease release.
- **R20.** `localStorage` accessed OUTSIDE the try in `durableCardMutationPending`
  (`data.ts:325`), `readBulkTagOperation` (`:359`), `readDurableMultiEdit`
  (`:697`) — `typeof localStorage` itself throws when storage is policy-blocked,
  and it propagates into `card-view.stateChanged`. `corpus-mode.ts:39-43` on this
  same branch shows the correct pattern.
- **R21.** `persistDraft` has no try/catch (`edit-draft.ts:62-65`), so a full
  localStorage skips `stampDraftForSave` and leaves a stale "unsaved draft
  available" banner after a SUCCESSFUL save.
- **R22.** Reading-list `auditKey` is `'' + Date.now()`, so two writes in the
  same ms collide.
- **R23.** `requestedSimilarityCardIDs` is never pruned
  (`corpus-worker.ts:2325`).
- **R24.** Snapshot `savedAt` is written but never read — an offline months-old
  snapshot is primed and served with no staleness signal.
- **R25.** `takeoverBlockReason` does not consult `durableCardMutationPending()`.

## P2 — performance polish

- **P10.** `corpusWorkerCanRunCollections()` does an O(corpus) `Object.keys`
  behind a boolean (MEASURED 3.2 ms), called per reference block →
  ~36 ms per navigation settle. Memoize against `state.data.cards` identity.
- **P11.** Boot round-trips the snapshot through wire format twice
  (`fromWire` then `toWire(stripForWire())`) — ~1-1.5 s of the 7.1 s
  `loadComplete`.
- **P12.** Cold sweep re-reads its own priority phase (5,000 wasted reads, 11%
  of a cold boot).
- **P14.** Gate retry loops have no cap or escalation — the repair-failed path
  re-runs the whole gate at 40 count-reads/minute indefinitely.
- **P15.** `repairPartitions` recomputes `corpusUnpublishedPerPartition()` inside
  its loop (O(40k) per repaired partition).
- **P16.** Ungated `[PERF]` `console.log` on the editing path
  (`selectors.ts:889, 905-906`), unlike everything else in `src/perf.ts`.
- **P17.** `card-thumbnail-list.ts:407` `.expandedReferenceBlocks=${[]}` — a
  fresh array literal defeats Lit's `hasChanged`, forcing up to 250
  `card-renderer` re-renders per drawer render.
- **P18.** 4 synchronous `localStorage.getItem` + up to 2 `JSON.parse` per
  dispatch (`card-web-app.ts:437-453`, `card-view.ts:1040`); during a durable
  multi-edit the parsed record can include full card objects.
- **P19.** `unsubscribes` accumulates dead handles (see R16).
- **P20.** `processedTombstoneIDs` uses `.includes()` in a loop, making
  `processTombstones` O(n²), and the array is persisted into every snapshot.
- **P21.** Impure `localStorage` reads inside `createSelector` result functions
  (`selectors.ts:1701, 2000, 2014, 2031`); `markCorpusWorkerUnavailable()` flips
  mode without touching Redux, so memoized worker-served collections go stale.
- **P22.** Measurement integrity: `test/perf-harness/gen-corpus.js` never sets
  `nlp_tokens`, so every harness card takes the slow full-NLP path — harness
  interaction numbers overstate per-card cost while memory numbers understate
  it. Also there is no heap measurement in the harness at all.
