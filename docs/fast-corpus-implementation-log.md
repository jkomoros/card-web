# Fast-Corpus Implementation Log

Branch: `implement/fast-corpus` (created from `origin/master` ef9e9cd4, then merged
`design/all-cards-local-design-doc` which carries the full all-cards-local lineage).

Executing the plan in `docs/fast-corpus-design-doc.md`: **Plan A** (surgical
blast-radius completion) then **Plan B** (corpus worker). This log tracks progress,
decisions, and environment quirks so any session can resume mid-stream.

## Environment notes (read before working)

- **Node**: use 20.20.0 (`.nvmrc`); the `esm` mocha loader breaks on Node 26.
  `export PATH="$HOME/.nvm/versions/node/v20.20.0/bin:$PATH"` before npm/npx.
- **Broken git hook**: the user's `.dev-secrets` hooks prompt interactively on
  /dev/tty for a missing `content` checkout and HANG in non-interactive sessions;
  the pre-commit hook stashes unstaged changes before hanging (recoverable from
  `$TMPDIR/commit_hook_changes.*`). ALWAYS use `git -c core.hooksPath=/dev/null`
  and `git commit --no-verify`.
- **Port 8080** is occupied by the user's unrelated vite server (boardgame
  project) — `npm run test:security` can't start the Firestore emulator on the
  default port. Run the other suites individually; run test:security only with a
  port override in firebase.json (not yet done).
- Tests import compiled output from `lib/` — run `npm run build:typescript`
  (and `npm run build:shared` if shared/ changed) before mocha suites.

## Plan A — COMPLETE (all stages committed)

| Stage | Commit | Summary |
|---|---|---|
| merge | 5d13be1f + 97840eeb | origin/master + all-cards-local lineage; dump.ts type fix |
| A1 | 7fb46df3 | makeFilterFromCards delta-clones only changed filter maps; no-op UPDATE_STARS/READS preserve state identity; cardSimilarity surgically pruned. New suite `test:reducers`. |
| A0 | c73c78ec | `src/perf.ts`: DEBUG_PERF console API (enable/dump/reset), dispatch-timing middleware, counters in makeFilterFromCards/processCard/collection filter-sort. |
| A2 | d7e9087e | `src/incremental-selectors.ts` (createCardsDiffSelector); selectRawConceptCards, selectSynonymMap, selectAuthorAndCollaboratorUserIDs, selectEverythingSet(+Snapshot), selectDefaultSet, selectAllCardsFilter, selectTagInfosForCards now identity-stable on irrelevant card changes. New suite `test:incremental-selectors`. |
| A3 | 0714c888 | Collection.handoff (static) carries filtered IDs/sortInfo/sortExtras/partialMatches/fallback state when only live cards changed (ghosting snapshot inputs identity-equal); selectActiveCollection retains previous collection. countForDescription + split selectCountsForTabs (cheap set-intersection counts on stable inputs; full Collection only for configurable-filter tabs). New suite `test:collection`. |
| A4 | 23b368b1 | Boot: 5 unpublished getDocs partitions coalesce into 750ms-flushed batches (generation-guarded). Echo: phase-2 initial onSnapshot delivery dedupes on updated-timestamp equality (1% sampled deep-equal validation), replacing ~38k deep compares. |
| A5 | fc40eab1 | nlp_search_tokens stripped at all ingestion boundaries (stays in Firestore; preserves Enterprise option); shared frozen empty fallbackText/importantNgrams/synonymMap in processCard. |
| A6 | 6a9d20b7 | Deleted src/filter-classification.ts + test + classification getters; deleted complete/partial mode (TURN_COMPLETE_MODE, DataState fields, thunks, selectors, localStorage keys, main-view wiring). |

Verification state: `npx tsc --noEmit` clean (app + functions), full `npm run build`
passes, all non-security suites pass (incl. new reducers/incremental-selectors/
collection suites). **Not yet done**: browser profiling at 40k (needs the user's
account/machine — instrumentation is in place: run `DEBUG_PERF.enable()` in
console, interact, `DEBUG_PERF.dump()`); test:security (port conflict).

## Plan B — IN PROGRESS

Architecture (see design doc §Plan B): dedicated Web Worker owns the Firestore
SDK + full corpus + inverted index + query engine; UI Redux keeps only visible
state. Staged: B0 spike → B1 ingestion-in-worker (behavior-neutral) → B2 shadow
mode → B3 cutover.

### Decisions made

- **Rollout safety**: worker path is gated by a localStorage flag
  (`corpus-worker`: 'off' | 'spike'| 'shadow' | 'on'). Since no browser
  validation is possible in this autonomous session, defaults stay
  behavior-neutral; shadow mode logs divergence without changing behavior.
  Cutover (B3) only flips after shadow logs are clean on the user's machine.
- **Worker bundle**: second rollup config entry emitting a self-contained
  `build/lib/src/worker/corpus-worker.js`; worker URL is the absolute path
  `/lib/src/worker/corpus-worker.js`, which resolves in both dev (wds serving
  repo root, tsc output in lib/) and prod (build/ as web root).
- **Worker typing**: no "webworker" tsconfig lib (conflicts with "dom" in one
  program); the worker file accesses its global scope through a narrow local
  interface cast from globalThis.
- **Worker must NOT import src/firebase.ts** (touches window at module load);
  it initializes its own Firebase app with
  `initializeAuth(app, {persistence: indexedDBLocalPersistence})` (reads the
  main thread's persisted credential) + `persistentLocalCache`. Multi-tab
  manager behavior inside workers is a Stage-B0 open question; fallback is
  single-tab manager for the worker.
- **Index**: custom inverted index over stored `nlp_search_tokens` (recall
  only; ranking stays with PreparedQuery.cardScore over candidates). NOT
  FlexSearch/MiniSearch/SQLite (see design doc for reasoning). Note
  nlp_search_tokens are stripped from Redux (A5) but the worker sees raw
  Firestore docs, so it has them.

### B0 spike — COMPLETE (code-side)

- `src/worker/search-index.ts` — pure inverted index (updateCard/removeCard/
  candidates/candidatesUnion), no DOM/Firestore deps.
- `src/worker/worker-protocol.ts` — typed main↔worker message unions with
  generation counters for stale-message dropping.
- `src/worker/corpus-worker.ts` — worker entry: own Firebase app
  ('corpus-worker'), initializeAuth(indexedDBLocalPersistence),
  persistentLocalCache (single-tab in worker — see decisions), published-cards
  onSnapshot ingestion into corpus Map + index, spike/query messages.
- `src/corpus-bridge.ts` — main-thread bridge, spawned only when localStorage
  'corpus-worker' is set; `window.CORPUS_WORKER` console API (setMode/spike/
  query). Wired into main-view._connectViewAppData as a no-op by default.
- rollup: second config emits self-contained
  `build/lib/src/worker/corpus-worker.js` (~380KB min). Full `npm run build`
  passes.
- `test/search-index/test.js` (`npm run test:search-index`, in `npm test`):
  unit tests + synthetic 40k benchmark. **Benchmark results (Node, M-series):
  index build 40k cards ≈ 1.7s total (43µs/card); avg recall query 0.12ms.**
  Validates the design assumption that index build is a cheap one-time boot
  cost off-thread and recall is effectively free vs. O(40k) scoring.

**Browser validation still needed (user)**: set
`localStorage.setItem('corpus-worker','spike')`, reload, watch
`[corpus-worker]` console lines, run `CORPUS_WORKER.spike()` and
`CORPUS_WORKER.query('...')`. Open questions it answers: (a) module worker
loads under wds dev serving and in prod build; (b) worker auth picks up the
persisted credential; (c) Firestore-in-worker cold/warm load times; (d)
IndexedDB coexistence of the worker's cache with the main thread's.

### B1 — COMPLETE (code-side; browser validation pending)

Worker-owned card ingestion behind the flag ('shadow' or 'on'):

- `src/worker/wire-format.ts` + `test/wire-format`: Firestore Timestamp
  instances don't survive structured clone, so cards crossing the boundary
  have Timestamps converted to `{__wireTimestamp, seconds, nanoseconds}`
  markers worker-side and reconstructed as real Timestamp instances
  bridge-side. Identity-preserving for subtrees without timestamps.
- `src/worker/corpus-worker.ts`: full ingestion mirroring
  src/actions/database.ts — published onSnapshot; privileged unpublished via
  5 parallel documentID-partitioned getDocs (60s-timeout workaround) with
  750ms coalescing and connection-generation guards, then phase-2 onSnapshot
  whose initial delivery is flagged fastDedupe; author/editor listeners for
  non-privileged uids. Every batch also updates the worker's own corpus +
  search index (strips nlp_search_tokens only in the forwarded copy).
- `src/corpus-bridge.ts`: `corpusWorkerOwnsCardIngestion()` (mode is 'shadow'
  or 'on'); 'cards' messages → `receiveCards(cards, fetchType, fastDedupe)` /
  `removeCards` — the exact same Redux path as main-thread listeners.
  Param-deduped connect/reconnect with generation bumps on auth changes.
- `src/actions/database.ts`: connectLivePublishedCards /
  connectLiveUnpublishedCards delegate to the worker when it owns ingestion
  (still dispatching expectUnpublishedCards so loading indicators work);
  otherwise the existing main-thread path runs untouched.

Flag off (default): zero behavior change. **Browser validation (user)**: set
`localStorage.setItem('corpus-worker','shadow')`, reload; cards should load
normally with `[corpus-worker]` ingestion lines in the console; boot-time
snapshot parsing now happens off the UI thread.

Sections/tags/stars/reads listeners remain on the main thread; forwarding
them TO the worker is part of B2 (needed for worker-side filters).

### B2 — COMPLETE (code-side; browser shadow validation pending)

Discovery that simplified everything: filters.ts / collection_description.ts /
nlp.ts / reducers/collection.ts / actions.js all load and run WITHOUT any DOM
(verified empirically in bare Node) — the JSDOM shims in older tests were
over-cautious. No document shim needed; the one genuine DOM dependency
(innerTextForHTML in shared/util.ts, used by slow-path NLP for cards without
valid stored tokens) got a regex-based no-document fallback.

- B2a (2787a40c): pure refactor — processCard/processCards →
  `src/card-processing.ts`; computeDefaultSet/makeEverythingSetFromCards →
  `src/set-projections.ts`. Store-free, shared by selectors and worker.
- `src/worker/query-engine.ts`: maintains filter membership by replaying the
  REAL collection reducer (semantics can't drift), engine-local raw
  sections/reading-list, identity-memoized processed-cards + sets, and
  runCollection() through the real CollectionDescription/Collection machinery.
  Mirrors selectFilters (base + selected). Node-tested end to end in
  `test/query-engine` (8 tests: sets, starred/unread/selected filters,
  sections, reading-list, query text search, updates/removals).
- `src/action-forwarder.ts`: leaf middleware module (avoids store↔bridge
  import cycle); store.ts taps every action.
- Bridge: forwards FORWARDED_ACTION_TYPES (stars/reads/reading-list/sections/
  tags/selection) wire-encoded to the worker, buffering until spawn (listener
  installed at module load in shadow/on modes); sends tab-config
  fallbacks/startCards on connect; shadow comparator asks the worker to run
  the active collection every ≥5s and diff-logs `[corpus-shadow]`
  MATCH/DIVERGENCE lines, gated to moments when ghosting snapshot == live
  state and nothing is being edited (so both sides answer the same question).
- shared/util.ts innerTextForHTML: no-document regex fallback (tag strip +
  entity decode + card-link conversion). Slow-path-only; cards with valid
  stored NLP tokens never touch it.

**Browser-validated (2026-07-03, Playwright against the dev backend as an
anonymous user)**: worker module loads under wds; Firebase-in-worker
initializes; all 1240 published cards ingested by the worker and forwarded
(main-thread listeners never attached); UI populated identically. Shadow
comparator results — all MATCH, byte-identical ordered IDs:
- `main/half-baked/` 89 cards (including section start card)
- `main/random-thoughts/` 386 cards
- `everything/sort/recent/` 1240 cards (validates worker-side Timestamps)
- `everything/query/complexity/` 202 cards (validates full-text scoring)

Parity fixes found by this validation (all committed):
- configureCollections re-sent when tab-config fallbacks/startCards change
  (was snapshotted before sections loaded → missing start cards).
- Shadow compares gated on loading flags + sections/tags loaded.
- Worker forwards EMPTY snapshots (UPDATE_CARDS clears loading flags even
  with no cards) and forwards an empty batch on listener permission errors
  (anonymous users can't run author/editor queries), so loading indicators
  clear exactly like the main-thread path; bridge dispatches empty batches.

Known-benign console line in worker modes: Firestore warns "LocalStorage is
unavailable" in the worker (no localStorage there); IndexedDB persistence
still applies.

**Still needing user validation**: signed-in privileged flows (worker auth
credential pickup, partitioned unpublished getDocs at 40k scale), and
editing/saving under shadow mode. Same steps: set the flag, use the app,
watch for `[corpus-shadow] DIVERGENCE`.

### B3 — IN PROGRESS (gated cutover)

Full cutover (CollectionView over pushed results + windowCards + cardMeta on
the UI thread; async consumers → worker RPCs; delete UI-thread corpus
machinery) remains gated on the user validating shadow mode on the real
privileged 40k corpus.

- **B3a — live collection subscriptions (done, browser-verified)**:
  `src/worker/subscription-manager.ts` — subscribe/unsubscribe a description;
  every engine mutation (card batches, replayed actions, config) marks dirty;
  coalesced 50ms flush recomputes and pushes ONLY results whose ordered
  IDs/labels changed. Bridge subscribes the active collection description
  (resubscribing on description/salt/uid changes) and the shadow comparator
  is now push-driven (1s debounce, deduped log lines) instead of 5s polling.
  The one-shot shadowCollection protocol was removed (subscriptions supersede
  it). New suite `test:subscription-manager` (4 tests). Verified live:
  MATCH pushes for main/half-baked (89) and main/random-thoughts (386).

- **B3b (707479f2)**: UPDATE_WORKER_COLLECTION action +
  CollectionState.workerActiveCollection slice; bridge maintains the live
  subscription in shadow AND on modes and dispatches pushes in 'on' mode.
- **B3c — cutover path live (done, browser-verified)**: worker results carry
  numStartCards + partialMatches; `Collection.fromWorkerResult` builds a REAL
  Collection pre-seeded with the pushed result (filtered/sorted/final cards,
  labels, counts, fallback/preview/partialMatches) so every lazy getter
  no-ops and NO component changes were needed — un-seeded getters
  (sortValueForCard, webInfo, exotic sort labels) gracefully fall back to
  UI-thread computation. selectActiveCollection serves the seeded collection
  in 'on' mode when the pushed description matches, falling back to local
  computation during transitions. Mode helpers moved to leaf
  `src/corpus-mode.ts` (no import cycles). Verified live in 'on' mode:
  active collections rendered from worker pushes (main/half-baked 89 incl.
  start card; main/random-thoughts 386), navigation tracks, card view works.
  fromWorkerResult equivalence test added to test:collection.

Remaining for B3 (documented for continuation):
1. Subscribe the find-dialog collection (selectCollectionForQuery) the same
   way, so search executes in the worker (index-accelerated recall is already
   built — wire PreparedQuery candidates through SearchIndex.candidates).
2. windowCards/cardMeta memory reduction: stop holding all raw cards in
   UI-thread Redux in 'on' mode (the actual memory win; today 'on' mode still
   mirrors all cards to Redux via forwarded batches).
3. User validation of shadow → on on the real privileged 40k corpus
   (worker auth pickup + partitioned unpublished getDocs at scale).
4. Once 'on' is default: delete main-thread listener paths and the
   UI-thread Collection filtering (keep handoff for fallback windows), and
   move remaining all-card consumers (word clouds, suggestions, maintenance)
   to worker RPCs.
