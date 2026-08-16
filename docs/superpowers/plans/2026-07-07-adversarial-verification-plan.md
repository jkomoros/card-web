# Verification Plan: the `updated`-write guard (scoped) — with hand-offs

**Date:** 2026-07-07 (reshaped after an adversarial critique of the v1 plan)
**Change under test:** the `updated`-write invariant — client `MultiBatch` guard (`src/multi_batch.ts` + zero-import core `src/card-write-guard.ts`), source-audit tests (`test/updated-invariant/`), and security rules (`firestore.TEMPLATE.rules` + `test/security/`). Commits `06cba17c`..`ebe85506`.

## Why this doc was reshaped

The v1 plan proposed ~20–30 engineer-days (Playwright perf harness, 10–65k synthetic-corpus generator, a new `test/corpus-worker/` suite, brand-new CI with a wall-clock budget gate, chaos/two-device fault injection) to verify a ~50-line runtime change that already has 15 core tests, 175 emulator rule tests, a static bypass audit, and a clean multi-agent review. An adversarial review found it **scope-confused**: four of six performance rows (arrow-nav, keystroke, editor-open, find-dialog) never touch this change — they are the **fast-corpus Plan-A Stage-0 profiling gate** (`makeFilterFromCards`/reducer churn is the design doc's actual slowness suspect), smuggled in under this change's banner. It also **oversold "independent oracle"**: the guard and the rules encode one policy authored together, so a test between them catches *drift*, not a *shared* mistake.

This doc is now scoped to **verifying the change**. The app-wide performance work and the worker-sync-at-scale work are handed off (below) to the efforts that own them and have a reason to rerun them.

## Honest framing of what our tests can and cannot establish

- **Emulator engine = independent executor; policy = not independently authored.** The Firestore emulator runs the *real* rules (not our code), so it independently *executes* the policy — but the guard and the rules were written together from one spec. A test comparing them is a **drift-regression gate**, not a proof the shared policy is correct.
- **Incident replay = regression-lock of a known failure**, not falsification of the unknown.
- **The runtime guard's choke point is `MultiBatch`.** Its verdict *logic* is well-tested; the load-bearing structural question is whether every card write actually flows through it. See "Named residual holes."

## Two claims, honestly scoped to this change

- **R (robustness):** the write-side invariant is airtight for the paths the guard + rules cover, and any divergence between the two layers is caught.
- **P (performance, this change's slice only):** the guard's per-write cost is negligible against the commit→interactive budget. The **app-wide** Appendix-A budgets are **not this change's concern** — hand-off #1.

---

## The core (proportionate to the change): ~2–4 days

### DONE — landed in `test/updated-invariant/test.js` (this commit)

1. **Combinatorial falsification of the pure core.** The input domain (doc path, collection, field-set) is small and finite, so it is enumerated *exhaustively* — stronger than random sampling for this shape. Properties, not impl re-derivation: a card write violates IFF top-level-card-path ∧ no-sentinel; non-card/subcollection paths are always inert; **no content field can be smuggled through the escape hatch alone or mixed with a counter** (monotonicity: adding a key never clears a violation).
2. **Guard↔rules drift gate** — parses the non-bump fields out of `cardEditLegal{Stars,Messages,Tweets}` in `firestore.TEMPLATE.rules` and asserts they *exactly* equal the guard's `COUNTER_FIELDS_EXEMPT_FROM_UPDATED`. Framed honestly as a drift gate. **Proven to have teeth**: reintroducing the `ebe85506` mismatch turns it red naming `onlyInGuard: ['tweet_favorite_count']`.
3. **Guard cost micro-bench** — 72 ns/call for the pure-core policy check → a 500-op MultiBatch commit pays ~36µs of guard overhead. This **settles Claim P for this change by itself**, making the v1 plan's A/B toggle and 65k harness unnecessary here. (Loose smoke ceiling, not a flaky wall-clock gate; the printed ns/call is the datum.)
4. **Mutation testing** — Stryker scoped to `src/card-write-guard.ts` (`npm run test:mutation`; config in `stryker.conf.json`; a single-file `tsc` build per mutant, scoped `test:updated-invariant` as the killer). **100% mutation score, 43/43 killed** — every behavioural mutant *and* the error-message contract are constrained. (First run scored 83.7% with 7 survivors, all in message prose; a `violation messages pin their load-bearing guidance` test now kills them — legitimate, since the messages are the guard's developer-facing contract.) Break threshold is 90, so a future untested guard branch fails the run.

### NEXT — optional, low residual value

5. **Less-heuristic choke-point backing (optional).** The bypass audit runs as a test but matches card refs by ref-name (its own header says so). The server-side/admin-SDK hole is documented as a first-class limit (below). A stronger check (AST-resolving each write ref's type) would replace the heuristic, but it is low-value for this change — the runtime guard + rules already cover every *client* path, and the heuristic tripwire + review cover the rest.

### Named residual holes (asserted-and-logged, never hidden)

- **Server-side / admin-SDK writes bypass BOTH the client guard AND the rules.** Cloud Functions (`functions/`) don't use `MultiBatch`, and admin credentials bypass security rules. Today those functions only write exempt counters (`twitter.ts`, annotated), so the invariant holds — but a future content-writing function is residual-risk-#1 with **no runtime net**. The only defenses there are the static bypass audit (heuristic) and review. If server-side card content-writes ever appear, they need their own enforcement (a shared-`MultiBatchBase` guard, or a functions-side assert).
- **`isServerTimestampSentinel` is not Node-testable** (it lives in `firebase.ts`, which initializes the app at import). Its correctness across sentinel shapes is covered by reasoning + the browser harness (hand-off #1); it is O(1).
- **Design-doc blind spots (documented, not solved here):** the count() boot gate cannot detect a silently *mutated* card whose `updated` didn't bump (→ the write-side guard is the *only* defense there), and within-partition ghost/missing cancellation is theoretically possible. These belong to corpus-sync verification (hand-off #2).

---

## Hand-offs (moved out of this doc, to owners who will rerun them)

### → fast-corpus **Plan A, Stage 0** (`docs/fast-corpus-design-doc.md`)
The app-wide performance verification is Stage 0's profiling gate (G0/G1), not verification of this change. Move there:
- The **committed Playwright interaction harness** (arrow×20 w/ auto-mark-read, editor open, 30 keystrokes, commit+echo, remote echo, cold/warm boot, find-dialog), reading the **already-present** `src/perf.ts` counters + new `performance.measure` spans.
- The **deterministic worst-case synthetic-corpus generator** (10k/40k/65k, emulator-safe), seeded from the existing 40k generator in `test/search-index/test.js`.
- The Appendix-A budgets: arrow-nav ≤16ms, keystroke ≤16ms, editor-open ≤100ms, find-dialog ≤100ms (and commit ≤200ms / echo ≤50ms at the *app* level).
- **CI, when it exists, gates on the deterministic counter invariants** (`makeFilterFromCards:changedMaps`, "active-collection refilters when membership unchanged == 0", "guard runs during nav == 0"), **not** wall-clock p95 — GitHub-runner variance makes a millisecond budget a flaky red build that gets disabled. There is no CI in this repo today; do not stand one up whose first act is a wall-clock gate.

### → corpus-sync **Phase 1/2** (`docs/corpus-sync-design.md`)
The worker sync machinery (`corpus-worker.ts`, 1389 lines, currently untested) is that effort's verification. Move there:
- A `test/corpus-worker/` integration suite on the synthetic corpus in the emulator.
- **Watermark no-gap** (never advance from echo/read-time/wall-clock — "enforce in one function with tests").
- **`fastDedupe` inbound-only metamorphic test**: an inbound-reference-only change without the bump is silently droppable (reproduce the `data.ts:1519` hazard); with the bump it propagates. This is the one Layer-D item genuinely about *this* invariant — keep it as a **correctness** test there (not a 65k wall-clock test).
- **Boot-trust-gate incident replay** (the 5,001-card partial cache), tombstone/laundering, second-tab Web Lock, chaos/two-device/fault-injection, and the two blind-spot assertions above.

---

## Bottom line

Verifying *this change* is a ~2–4 day core: exhaustive pure-core falsification (done), a drift-regression gate (done, teeth-proven), a micro-bench that settles the guard's cost (done, 72 ns/call), plus mutation testing and the named server-side boundary (next). Everything else in the v1 plan is real and worth doing — but it verifies the fast-corpus and corpus-sync efforts, not a 50-line guard, and it belongs in those plans where it has an owner and a standing reason to rerun.
