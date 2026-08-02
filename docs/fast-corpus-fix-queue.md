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

- Cmd-Shift-C / Cmd-Shift-I are silent no-ops on the editor's default Content
  tab: the suggestion state is zeroed unless detail fields are visible, but
  the shortcut still killEvent()s. Master populated suggestions whenever
  editing.
- Navigation while editing is allowed with no prompt and leaves the editor
  open and bound to the previous card. Structurally present on master too, but
  easier to hit here.
- The fork button is not gated like its siblings — it fails after the click
  with an alert instead of being disabled with a reason.
- Diagnostic `off` mode logs a spurious console.timeEnd warning per boot.

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
- **U15.** `e` is a silent no-op (see U7/C3).
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
