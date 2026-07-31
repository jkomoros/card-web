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

## Round 11 — from the four-lens critique (UX / robustness / perf / archaeology)

### VERIFICATION DEBT (created by the 2026-07-31 power outage)
The signed-in Chrome profile used for live DEV verification lived in the session
scratchpad under `/private/tmp` and was destroyed by the outage, along with the
Playwright harness. Re-creating it needs a sign-in I cannot perform (entering the
account password is off-limits for me). Everything below this line was fixed and
unit/type-checked, but the end-to-end DEV re-check that normally accompanies each
fix is OUTSTANDING for: N1 (echo after confirmed commit) and N13 (the status
indicator's new count/tooltip — code and CSS are checked, PIXELS are not; the
in-app browser is also unreachable in this environment). Owner action: sign in
once on a debug Chrome, or run these checks as part of the acceptance test.
NOTE for whoever rebuilds that harness: `window.CORPUS_WORKER` and
`window.DEBUG_STORE` are now gated behind `localStorage['debug-perf'] = '1'`
(S9), so a driver script must set it in an init script BEFORE the page loads,
the way test/perf-harness/run.js already does.

---

## P1 — correctness

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

### P23 (residual, product decision). Server-confirmed save is ~4.5-5s
Measured properly (Round 10 of the findings doc): editor release p95 57ms,
server-confirmed p95 5070ms, warm boot to usable p95 7.3s, editing-enabled p95
36.6s. The perceived commit meets criterion 4; the server-confirmed commit does
not. The near-constant server time points at sequential round trips in the
durable protocol rather than variance, so shortening it is a protocol change.
Left as an explicit decision rather than silently claimed as met.

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
