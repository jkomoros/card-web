# Perf harness (test/perf-harness/) — design & usage

**Status: runner BUILT and verified (emulator; 300–6000 cards).** This is the committed, rerunnable replacement for the lost scratchpad probe scripts (`measure.mjs`, `probe-*.mjs`). It measures the design doc's **Appendix-A interaction budgets** and emits a diffable JSON baseline, so the G0/G1 decision gates become empirical and the ingestion cost becomes attributable. See `docs/fast-corpus-design-doc.md` (Appendix A, G0/G1) and the plan `docs/superpowers/plans/2026-07-07-perf-harness-runner.md`.

**How to run:** `npm run perf:local`. The packaged gate seeds 40k cards,
signs in as an admin, runs the shipping `on` + `watermark` configuration,
drives the interaction script, and fails on invariant or interaction-budget
regressions. For a smaller exploratory admin run:
```
npm run perf:build && firebase emulators:exec --only firestore,auth --config firebase.perf.json --project demo-perf \
  "node test/perf-harness/run.js --count 6000 --auth admin --load-timeout 180000"
```
Baseline lands in `test/perf-harness/baselines/<authMode>-<count>.json`; authoritative main-thread numbers are `results.dispatch.*` (avg/max from perfMiddleware). Raise `--load-timeout` for larger corpora.

**First findings (emulator, admin):** the interaction dispatches are all sub-ms at 300 cards; by 6000, **`UPDATE_CARDS` (card ingestion/echo-apply) grows to ~13ms avg / ~29ms max** and `UPDATE_READS` (auto-mark-read → `makeFilterFromCards`) is climbing — early confirmation that the ingestion path is the scaling cost. **A 40k corpus does not finish loading within a practical timeout** (the ingestion is genuinely slow at scale — exactly the symptom the perf effort targets); measuring 40k needs either the reducer/selector fixes to land first or a much larger `--load-timeout`. Note: emulator commit/echo wall-clock is optimistic (near-zero local round-trip); the real-corpus G1 acceptance run (`perf:dev`) remains separate.

**Built so far:**
- `src/perf.ts` gained `DEBUG_PERF.data()` — a machine-readable snapshot of `{actionStats, counters}` so a driver can assert against budgets/invariants instead of scraping `console.table`.
- `gen-corpus.js` — the deterministic, worst-case synthetic corpus generator (below), with `gen-corpus.test.js` (7 cases) wired into `npm run test:perf-harness` and the full `npm test`.
- `load-emulator.js` — seeds a generated corpus into the Firestore **emulator** via `firebase-admin` (converts the generator's plain timestamps to real `Timestamp`s, batches at 400, verifies the `count()`). Refuses to run without `FIRESTORE_EMULATOR_HOST` (never a real project). **Verified**: 2000 cards → emulator → count matches. Runs on a dedicated port via `firebase.perf.json` (8089) so it never touches the default 8080.

**Not yet built (next increment — real complications, see Open Questions):** the app-side emulator wiring and the Playwright browser runner + auth.

## Why it exists

- Every 40k measurement to date lived in session scratchpads that are now gone. Nothing is reproducible; G0/G1 have never run with committed tooling.
- Nav is measurably fixed at 40k (zero long tasks), but **commit→interactive sits at ~2s vs a 200ms budget (10×)** with the root cause unattributed (worker↔UI serialization vs Lit render fan-out vs computation).
- Per the reshaped verification plan: **gate deterministic counter invariants hard (CI); report wall-clock p95 (don't hard-fail — hardware variance).**

## Status honesty

- `--assert` (implemented) hard-fails on the deterministic counter invariant
  and reports wall-clock budget breaches; `--assert-budgets` makes breaches
  fail too. There is NO CI wiring yet — nothing runs this automatically.
- `perf:dev` (the acceptance run against the REAL dev backend that every
  emulator-optimism disclaimer defers to) **does not exist yet**. Until it
  does, the live-dev measurements in docs/fast-corpus-implementation-log.md
  are the acceptance evidence; this harness is a regression detector for
  relative deltas between harness runs only.
- The synthetic corpus now includes nlp_search_tokens, a Zipf-ish ~800-word
  vocabulary, sort_order, and a realistic published ratio (~5%) — earlier
  runs exercised the worker's full-scan fallback exclusively and a
  NaN-comparator sort; baselines recorded before this are not comparable.

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
- `npm run perf:local` — 40k-card emulator ship gate (admin, worker-on,
  watermark, assertions enabled; no live session).
- `npm run perf:dev` — dev app + real corpus (G1; needs a live Firebase session in the copied profile).

## Next increment: app-side wiring + Playwright runner

**Resolved this increment:**
- **Ready signal** — `window.CORPUS_WORKER.syncState() === 'live'` in worker modes (`src/corpus-bridge.ts`); in `off` mode, poll the store's card count instead.
- **Corpus into the emulator** — done (`load-emulator.js`, verified).

**Remaining, with the real complications:**
1. **App emulator wiring does not exist yet.** `src/firebase.ts` always connects to the real dev/prod project; `firebase.json` has no emulator config (the `test:security` emulator is rules-only). Add a **strictly flag-gated, default-off** `connectFirestoreEmulator(db,…)` + `connectAuthEmulator(auth,…)` block, gated on a localStorage flag the harness sets pre-boot via Playwright `addInitScript`.
2. **The worker has no `localStorage`.** In `shadow`/`on` modes the corpus worker (`src/worker/corpus-worker.ts`) does its OWN Firestore init and cannot read the flag; the emulator config must be passed to the worker at spawn. **So the first runnable target is `corpus-worker=off`** (main-thread only, no worker) — it needs only the `firebase.ts` wiring and exercises the reducer/selector path that is the design doc's actual slowness suspect (`makeFilterFromCards`). Worker-mode measurement is a later step.
3. **Auth.** Admin/unpublished visibility needs a signed-in admin — use the **Auth emulator** + a test sign-in (`load-emulator.js` already seeds `permissions/{uid} = {admin:true}`).
4. **Browser driver.** Add `playwright` (devDep, bundled chromium). Wrap the whole run in one `firebase emulators:exec` so the emulator stays up: load corpus → start `wds --port 8081` → drive the Appendix-A script → emit baseline → **assert the counter invariants, report p95**.
5. **Dialogs.** `page.on('dialog')` accept, or commits abort (per the lost scratchpad harness).

## Provenance note
The prior harness (`measure.mjs` in the `5580af71` scratchpad; `probe-commit2/probe-echo3/probe-cleanup.mjs` in `c4ce6470`) used pinned chromium-1223, a copied `./perf-profile` with a valid Firebase session, `corpus-worker=shadow` via `addInitScript`, and a 600s readiness deadline. Those files are gone; this harness is the committed, never-lost-again replacement.
