# Perf harness (test/perf-harness/) — design & usage

**Status: foundation landed; browser runner is next.** This is the committed, rerunnable replacement for the lost scratchpad probe scripts (`measure.mjs`, `probe-*.mjs`). It measures the design doc's **Appendix-A interaction budgets** at 40k+ cards and emits a diffable JSON baseline, so the G0/G1 decision gates become empirical and the ~2s commit-settle becomes attributable. See `docs/fast-corpus-design-doc.md` (Appendix A, G0/G1) and `docs/superpowers/plans/2026-07-07-adversarial-verification-plan.md` (hand-off #1).

**Built so far (this increment):**
- `src/perf.ts` gained `DEBUG_PERF.data()` — a machine-readable snapshot of `{actionStats, counters}` so a driver can assert against budgets/invariants instead of scraping `console.table`.
- `gen-corpus.js` — the deterministic, worst-case synthetic corpus generator (below), with `gen-corpus.test.js` (7 cases) wired into `npm run test:perf-harness` and the full `npm test`.

**Not yet built (next increment, has infra/session dependencies):** the Playwright browser runner and its two run modes.

## Why it exists

- Every 40k measurement to date lived in session scratchpads that are now gone. Nothing is reproducible; G0/G1 have never run with committed tooling.
- Nav is measurably fixed at 40k (zero long tasks), but **commit→interactive sits at ~2s vs a 200ms budget (10×)** with the root cause unattributed (worker↔UI serialization vs Lit render fan-out vs computation).
- Per the reshaped verification plan: **gate deterministic counter invariants hard (CI); report wall-clock p95 (don't hard-fail — hardware variance).**

## Budgets (Appendix A)

| Interaction | Budget | Gate type |
|---|---|---|
| Arrow-key nav (incl. auto-mark-read echo) | ≤16ms main-thread | report p95 + **assert** `refilters-when-membership-unchanged == 0` |
| Keystroke while editing | ≤16ms | report p95 |
| Editor open | ≤100ms | report p95 |
| Commit → interactive | ≤200ms | report p95 + attribution split |
| Remote echo (other tab's edit) | ≤50ms | report p95 |
| Find-dialog query (post-debounce) | ≤100ms | report p95 |

## Architecture — two run modes, one core

1. **`local` (CI-reproducible).** Playwright drives a locally-served build against a **synthetic corpus** in the **Firestore emulator** (emulator auth). No live session, no quota, deterministic. This is the regression half.
2. **`dev` (the G1 acceptance run).** Playwright drives the running dev app (`localhost:8081` — the **dev** project; `127.0.0.1:8081` is PROD, never load the corpus there) against the real ~40k corpus as an authenticated admin. Needs a valid Firebase session in a copied browser profile. Operator-assisted (session + quota).

### Shared core
- **Pre-boot** via Playwright `addInitScript`: set `localStorage['debug-perf']='1'`, `localStorage['corpus-worker']='shadow'` (worker owns ingestion — measures the real path, UI behaviour unchanged), optionally `localStorage['corpus-sync']`.
- **Await corpus-ready** (see Open Q1).
- `window.DEBUG_PERF.reset()`, then drive the Appendix-A script, wrapping each interaction in `performance.mark`/`measure`.
- After the run, read `window.DEBUG_PERF.data()` — the new machine-readable getter added to `src/perf.ts` (returns `{actionStats, counters}`) — plus long-task counts.
- Compute p50/p95/p99 per interaction; emit `test/perf-harness/baselines/<label>.json` (diffable); **assert** the counter invariants, **report** the p95s.

### Commit-settle attribution
The commit path already emits `dispatch:<TYPE>` timings via `perfMiddleware`. The harness splits the ~2s across `MODIFY_CARD` → `ECHO_LOCAL_CARD_MODIFICATIONS` → worker round-trip → `UPDATE_CARDS`/worker-collection push → Lit render, turning the single number into worker-serialization vs render fan-out vs computation.

## Reusing what already exists (do NOT reinvent)
- `src/perf.ts`: `DEBUG_PERF.enable/reset/dump/**data**` (data() added for this harness) + `perfMiddleware` (per-dispatch timing) + `perfCount`/`perfRecord` on hot paths (`makeFilterFromCards:changedMaps`, `diffSelector:*:skipped`, `collection:handoff`, `processCard:miss`).
- `src/corpus-mode.ts`: `corpus-worker` (off|spike|shadow|on) and `corpus-sync` (listen|watermark) localStorage keys.

## How to run (target)
- `npm run perf:local` — emulator + synthetic corpus (CI-safe, no session).
- `npm run perf:dev` — dev app + real corpus (G1; needs a live Firebase session in the copied profile).

## Open questions to resolve before the runner is complete
- **Q1 — corpus-ready signal.** Which signal does the harness await so it measures a fully-loaded corpus? Candidates: the worker `syncState:'live'`/`loadComplete`, a card-count threshold in the store, or a DOM signal. Resolve by tracing `src/corpus-bridge.ts` / `src/worker/worker-protocol.ts` / the store's loaded-state.
- **Q2 — browser automation dep.** Add `playwright` as a devDep and use its bundled chromium (cleaner than the scratchpad's hardcoded `chromium-1223` path). Confirm it installs under Node 20.
- **Q3 — synthetic corpus into the emulator.** The generator (`gen-corpus.js`, `generateCorpus({count, seed})`) is built and produces a consistent worst-case `{[id]: cardDoc}` map (dense refs, derived inbound, fat body tail). Remaining: a loader that bulk-writes it to the Firestore emulator via `firebase-admin` (the `tools/mount.ts` pattern, gated on `FIRESTORE_EMULATOR_HOST`) and auths the app against the emulator. `node test/perf-harness/gen-corpus.js --count 40000 --seed 1 --out corpus.json` works today for the file form.
- **Q4 — dialog handling.** The scratchpad harness had to `page.on('dialog')` accept, or commits aborted; replicate.

## Provenance note
The prior harness (`measure.mjs` in the `5580af71` scratchpad; `probe-commit2/probe-echo3/probe-cleanup.mjs` in `c4ce6470`) used pinned chromium-1223, a copied `./perf-profile` with a valid Firebase session, `corpus-worker=shadow` via `addInitScript`, and a 600s readiness deadline. Those files are gone; this harness is the committed, never-lost-again replacement.
