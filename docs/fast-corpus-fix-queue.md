# fast-corpus pre-land fix queue

Working state for the Round 9 five-lens adversarial review (correctness, UX,
security, performance, robustness). **Items are DELETED from this file as they
are resolved**, each deletion committed with its fix. When this file is empty it
gets deleted, and the queue is done.

Dedup note: several findings were reported independently by 2-3 reviewers; those
are merged into a single item and marked with the lenses that found them.

---

## P0 — data integrity / release blockers

### C18 (residual). Creation and comments still lack durable write-ahead records
The user-visible losses are closed: compose text is restored on failure rather
than cleared before the write, comment writes are awaited and surfaced, and the
fork commit is awaited. What remains is the structural gap the reviewer named —
neither card creation nor comments has a durable intent, so a crash between an
accepted UI action and the server ack still loses the operation (the eligibility
gate is only point-in-time). Closing it properly means extending the write-ahead
pattern to both, which is a design change rather than a patch.

---

## P1 — correctness

---

## P1 — performance

### P23 (residual). Server-confirmed save — re-measure at scale
Round 10 measured server-confirmed p95 at 5070ms against editor release p95
57ms. The N1 fix (apply the committed cards locally once the commit is
server-confirmed, instead of waiting for the delta listener to echo them back)
changed this materially: two post-fix samples on real DEV came in at 979ms and
449ms, both confirmed against server truth by reloading to `live`. That is a
sample of two, not a p95 — what remains is a proper distribution, not a
protocol change. The earlier conclusion that shortening it required rewriting
the durable protocol was wrong: most of the time was the listener round trip.

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
