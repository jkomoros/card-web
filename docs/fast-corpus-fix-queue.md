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

### C11. Sign-out snapshot purge no-ops after a non-privileged reconnect
`src/worker/corpus-worker.ts:2063`. `corpusSnapshotStore` is only created in
`connectUnpublishedWatermark`; a permission revocation reconnects non-privileged
first, so the later `uid === ''` connect finds a null store and the full
materialized unpublished corpus stays in IndexedDB. Also `clear()` never deletes
the `${key}:owner` record, and nothing anywhere calls
`clearIndexedDbPersistence`.

---

## P1 — UX

### U9. Find dialog asserts zero results with no loading affordance
`find-dialog.ts:395-425`, `selectors.ts:2005-2021`. Cmd-F before `loadComplete`:
the query slot isn't subscribed, `_lastReadyCollection` is null so
stale-while-revalidate doesn't engage, and `selectFindSearchPreparing` bails
because `searchRecall` is null. The user sees "0 cards" and concludes the card
doesn't exist.

### U11 (residual). No production escape hatch from a worker failure
`corpus-mode.ts:38-51`, `corpus-bridge.ts:1023-1033`. `readCorpusWorkerMode()`
returns `'on'` unconditionally off dev hosts, so the graceful `'fallback'`
branch is unreachable in production and `writeCorpusWorkerMode('off')` is
refused there — a worker chunk 404 after a deploy gives a full-viewport panel
whose only button reloads into the same condition. Failing closed is criterion
9 and the policy is right; the missing piece is a recovery path. (The
`unsupported` keyboard trap and its missing explanation are fixed.)

---

## P1 — performance

*(All seven items resolved; see the Round 9 section of
docs/fast-corpus-review-findings.md for the measurements.)*

## P2 — security hardening

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

- **U14.** `card-editor.ts:539, 583` switched from `?hidden` to conditional
  rendering, so switching editor tabs destroys the textareas — losing native
  undo history and scroll position.
- **U15.** `e` is a silent no-op (see U7/C3).
- **U17.** Durable aux writes are discarded with only `console.error`; call sites
  are `void runDurableAuxWrite(...)` with no catch.
- **U18.** Suggested tags render empty on worker timeout, indistinguishable from
  "no suggestions" (`card-editor.ts:984-992`).
- **U22.** `card-drawer.ts:184` returns a fresh `<div hidden>` instead of
  `?hidden`, so collapse/reopen (and every editor minimize) destroys the list and
  its scroll position.
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
  listeners re-attach in lockstep after an outage. (The dead-handle accumulation
  half is fixed.)
- **R17.** Epoch saturation: `Number.isInteger(1e308)` is true, so a crafted
  lease passes validation and `+1` is a fixed point; with
  `corpus-snapshot.ts:108` accepting `epoch <=`, a stale worker can re-claim.
- **R18.** `finishUnresponsiveTakeover` leaks a queued lock request on success
  (`corpus-bridge.ts:1306-1315`).
- **R19.** Unconditional 1 Hz synchronous localStorage write for the tab's life,
  never paused on `visibilitychange`, no `pagehide` lease release.
- **R24.** Snapshot `savedAt` is written but never read — an offline months-old
  snapshot is primed and served with no staleness signal.

## P2 — performance polish

- **P11.** Boot round-trips the snapshot through wire format twice
  (`fromWire` then `toWire(stripForWire())`) — ~1-1.5 s of the 7.1 s
  `loadComplete`.
- **P12.** Cold sweep re-reads its own priority phase (5,000 wasted reads, 11%
  of a cold boot).
- **P15.** `repairPartitions` recomputes `corpusUnpublishedPerPartition()` inside
  its loop (O(40k) per repaired partition).
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
