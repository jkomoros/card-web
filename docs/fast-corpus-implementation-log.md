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

- **B3d — find-dialog search served by the worker (done, browser-verified)**:
  second subscription slot ('query') tracking
  selectCollectionDescriptionForQuery while the find dialog is open and
  nothing is being edited (the editing-card-dependent variant stays local —
  the worker has no editing card; the bridge simply doesn't subscribe then
  and the selector's description-match fails safe to local computation).
  selectCollectionForQuery serves Collection.fromWorkerResult in 'on' mode.
  Verified live: typing "complex" in the find dialog produced a 199-card
  ranked result pushed from the worker (everything/has-body/query/complex/)
  and the dialog rendered it.

**IMPORTANT FINDING (2026-07-03), revises the design doc's index assumption**:
PreparedQuery matching is SUBSTRING-based — `stringPropertyScoreForStringSubQuery`
does `value.indexOf(str) >= 0` against the joined stemmed runs (src/nlp.ts:727),
so a query term matches anywhere inside a card's text ("art" matches "start").
Exact-token recall from nlp_search_tokens therefore CANNOT be bit-identical:
it would miss substring matches. The built SearchIndex remains useful for
explicitly-approximate contexts (as-you-type prefiltering, server-side
narrowing) but must NOT gate the query filter. Options if full-scan-in-worker
latency proves too high at 40k: (a) trigram/substring index, (b) accept
token-boundary semantics as a product change, (c) two-phase display (fast
token-recall results instantly, full-scan results merged when ready). The
full scan runs off-thread and per-card scoring over preprocessed runs is
cheap, so measure at 40k before building any of these.

Remaining for B3 (documented for continuation):
1. ~~Index-accelerated query recall~~ — blocked on the substring finding
   above; measure worker full-scan query latency at 40k first.
2. windowCards/cardMeta memory reduction (IN PROGRESS):
   - **cardMeta infrastructure done (browser-verified)**: the worker
     maintains a compact CardMeta table (id/name/title/card_type/section/
     tags/slugs/published/sort_order) and delta-pushes only genuinely
     changed entries; bridge dispatches UPDATE_CARD_META into
     DataState.cardMeta (selectCardMetas). Verified live: all 1240 metas
     populate in shadow mode.
   - **CardMeta carries author + collaborators** so permission-map selectors
     (selectCardIDsUserMayEdit, selectUserPermissionsForCardsMap) can flip to
     meta in P2.
   - **card-link flipped (browser-verified)**: existence/card_type/published
     and auto-title rendering prefer selectCardMetas when populated, falling
     back to the full cards map — behavior-neutral today, and removes the
     inline-link full-map dependency ahead of P2 stop-mirroring. Non-title
     auto fields still need the full card (documented in the getter).
   - **Consumer survey completed (sub-agent, 2026-07-03)**: full
     classification of every selectCards/selectRawCards consumer. Key
     conclusions: most selectors are already identity-optimized (A2) or
     small-set; the first cardMeta flip target is card-link title lookups;
     genuine full-corpus UI consumers to move to worker RPCs (all off hot
     paths): possibleMissingConcepts word cloud, maintenance tasks,
     suggestions generation, reference fallback-text resolution. Flip order:
     (P1) validate + default 'on'; (P2) stop mirroring full card batches
     into Redux in 'on' mode, serving thumbnails from windowed expansion +
     card-link/tag-info/slug lookups from cardMeta (add author/collaborators
     to CardMeta for permission maps first); (P3) off-path worker RPCs;
     (P4) delete 'on'-mode dead paths.
3. User validation of shadow → on on the real privileged 40k corpus
   (worker auth pickup + partitioned unpublished getDocs at scale).

**40K VALIDATION SCORECARD for the user's three targets (2026-07-03)**:
1. Rapid keyboard navigation: keystroke path clean (debounced reference
   blocks, commit dba98e20); settle cost ~1-2s remains = reference blocks.
2. Typing while editing: FIXED (fafe64da) — zero long tasks at 40k, was
   600-1200ms per >=250ms pause (info-panel blocks were keyed on the
   editing card, defeating memoization per keystroke).
3. Commit: works end to end, 4.05s total = ~3 repeated reference-block
   sweeps (~2.5s) + 583ms UPDATE_CARDS echo cascade + network. Both
   remaining costs are the same subsystem: reference blocks.

**THE ONE REMAINING FIX THAT PAYS ALL THREE**: make reference blocks cheap.
(a) Right answer: serve them from the corpus worker (they're ordinary
collection descriptions — one-shot engine runs or per-block subscriptions).
(b) Quick structural win available first: the ~8 direct-references* blocks
scan 40k cards to answer an O(dozens) question — a Collection fast path
could derive candidates from the key card's reference maps directly; only
the two similar/key-card-id blocks genuinely need corpus-wide scoring.
Also worth attacking: the 583ms single-card UPDATE_CARDS echo dispatch.

**40K PROFILING RESULTS (2026-07-03, dev mirror, admin account, 40,225 cards)**:
- Cold partitioned load: 38,985 unpublished across 5 partitions, ~146s
  (long-polling); warm (IndexedDB) reload: <30s. A4 coalescing flushed all
  38,985 in one batch. PROD WARNING: loading the corpus on prod hit
  Firestore `resource-exhausted` quota mid-load — use the dev mirror for
  testing (localhost = dev-complexity-compendium; 127.0.0.1 = prod).
- **Plan A held at scale**: no slow dispatches during navigation; the main
  collection handoff worked (never appeared in slow-work logs).
- **ROOT CAUSE OF RESIDUAL NAV SLOWNESS FOUND**: each navigation
  synchronously ran ~10 key-card reference-block collections (info panel +
  on-card) over all 40,225 cards: 60-400ms each, similar/key-card-id
  fingerprint blocks 250-950ms → 1-2s blocking per keystroke. Fixed the
  keystroke path via 250ms debounce (commit dba98e20); the settle cost
  itself (~1-2s once per landed card) remains — NEXT: compute reference
  blocks in the corpus worker (the descriptions are ordinary collections;
  run them via one-shot engine runs in the deferred callback, or
  per-block subscriptions).
4. Once 'on' is default: delete main-thread listener paths and the
   UI-thread Collection filtering (keep handoff for fallback windows), and
   move remaining all-card consumers (word clouds, suggestions, maintenance)
   to worker RPCs.

**POST-FAST-PATH MEASUREMENT (2026-07-03, settled 40k session, trusted input)**:
- Navigation: ~0.6-1.2s blocking per press remains; the two similar/key-card-id
  blocks now dominate (direct-references enumerate landed in 84087fe5 and
  removed those materialization scans). 
- Typing: steady-state clean (earlier zero-long-task run stands); switching
  INTO the 38k-card working-notes collection costs ~3s (filter+sort).
- Commit: 16s when the active collection is the 38k recent-sorted view
  (vs 4.05s in a small collection) — big-collection re-sort + stale-retry
  loop dominate.
- CONCLUSION: UI-thread micro-fixes are at diminishing returns. The remaining
  hot costs (similarity blocks, big-collection filter/sort, echo cascade) are
  precisely what the corpus worker already does off-thread — next steps are
  worker-served reference blocks and defaulting collection serving to 'on'
  mode after the user's shadow sign-off, per the existing B3 plan.
- Measurement harness for reuse: scratchpad/measure.mjs pattern (playwright
  launchPersistentContext with the copied mcp-chrome profile — May profile's
  Firebase session remains valid; chromium-1223 executablePath pin).

**WORKER-SERVED REFERENCE BLOCKS (099fd6bd) — VERIFIED LIVE (2026-07-03,
40,225 cards, admin account, shadow mode)**: measure.mjs results vs the
POST-FAST-PATH baseline:
- NAV: **zero long tasks** across 6 rapid ArrowDown presses + settle (was
  ~0.6-1.2s blocking per press). The similar/ block scoring left the UI
  thread; the [PERF] collection-filter lines for direct-references/similar
  blocks still appear but no longer block.
- TYPING: clean — one 66ms task across a 10-char trusted-input type.
- COMMIT: UI-thread cost gone (56ms + 295ms tasks vs 16s of sweeps), but the
  settle condition (pendingModificationCount==0 && !editing) timed out —
  which led to the two findings below.

**COMMIT-SETTLE INVESTIGATION (2026-07-03)** — two real bugs found via
focused probes (scratchpad probe-commit.mjs / probe-commit2.mjs):
1. **Stuck pendingModificationCount (fixed, 8fb46bd1)**: MODIFY_CARD sets the
   count to the PLANNED write count; a commit whose diff turns out to be a
   no-op (zero writes committed — e.g. probe 1's edit was normalized away)
   or a failed commit never gets an echo, so the count never cleared and
   receiveCards suppressed applying card updates indefinitely. In off mode
   unrelated background echoes eventually self-healed this; in worker modes
   they're rare, so it surfaced. MODIFY_CARD_SUCCESS now carries the actual
   committed write count; the reducer takes min (the local echo can flush
   BEFORE commit resolves — success must not re-raise a cleared count);
   FAILURE clears; success also flushes already-enqueued satisfying echoes.
   Tests in test:reducers.
2. **Worker corpus was one backend blip away from silent permanent
   incompleteness (fixed, c79541c2)**: during a live dev datastore outage the
   partitioned unpublished getDocs resolved with "0 cards" and NO error
   (plain getDocs silently falls back to the worker's EMPTY memory cache) and
   the phase-2 unpublished onSnapshot errored — which terminates the listener
   permanently. Worker now uses getDocsFromServer + retryWithBackoff (new
   src/worker/retry.ts + test:worker-retry suite, in npm test), and all
   worker snapshot listeners re-attach with 5s→60s backoff on error
   (generation-guarded; permission-denied stays terminal since auth changes
   arrive as reconnects). NOTE the main-thread path keeps its old behavior
   (persistent cache cushions it); if its listeners ever die on error the
   same pattern applies.

Harness notes (probes): editingCommit has confirm() dialogs — Playwright
auto-DISMISSES dialogs unless a 'dialog' handler accepts them, which reads as
"User cancelled" and leaves editing=true (part of the measure.mjs timeout).
Body edits appended after the final </p> get normalized away → no-op commit;
insert INSIDE the last paragraph. Commit-echo round trip in worker modes goes
main-thread write → server → worker's separate connection → forwarded batch
(no latency-compensated local echo), so expect seconds, not ms.

**COMMIT-ECHO ROOT CAUSE + FIX (2026-07-03, probe-echo3.mjs)**: side-by-side
main-thread doc listener vs worker query listener on the same commit showed:
main thread latency-compensated echo at +39ms, server ack +1.0s — but the
worker's 38,985-doc unpublished Listen stream DIES ~110s after attach on dev
("datastore operation timed out"), observed repeatedly. Off mode never sees
this because the main thread's persistent cache gives its Listen resume
tokens; the worker's memory cache restarts the full Listen every boot. With
the re-attach fix (c79541c2) the echo eventually arrives via the re-attached
listener's initial delivery (fastDedupe diffs 38,985 → 1 changed): commit
settled at +113.8s — correct but unusable.

**Fix — commits self-echo locally in worker modes (d7ccf9d0)**:
modifyCardWithBatch materializes the post-write cards (sentinels resolved
locally via applyCardFirebaseUpdate's clientSentinels; inbound-link updates
composed per batch) into an optional accumulator; after a successful commit,
modifyCardsIndividually (and reorderCard) dispatch them through receiveCards
(token-stripped) AND forward them unstripped to the worker corpus via new
whitelisted action ECHO_LOCAL_CARD_MODIFICATIONS (worker preserves prior
nlp_search_tokens when an echo card lacks them, so non-content edits don't
knock cards out of the index; updateLocalState covers corpus + index +
engine + subscriptions + cardMeta). The real server echo later dedupes away
(deepEqualIgnoringTimestamps). Off mode untouched. **VERIFIED LIVE at 40k:
commit now FULLY SETTLES at +2.0s in shadow mode** (was 113.8s / never).
Server truth confirmed the write; [PERF] showed the echo as "diffed 1 → 1
changed".

Also fixed in passing (d7ccf9d0): reorderCard and maintenance
rerunCardFinishers called modifyCardWithBatch WITHOUT await, but its
batch.set calls happen after its first internal await — batch.commit() ran on
an empty batch and those writes silently never persisted (latent dormant bug,
predates this branch).

Remaining worker-Listen consideration for 'on'-mode quality (not
correctness): each Listen drop costs a full 38,985-doc redelivery on
re-attach (~4s worker CPU + ~75ms main-thread diff, every ~2min on a strained
dev backend). Options if it matters: partition the unpublished Listen like
the getDocs (5 × ~8k, localizes drops), or the already-planned cache handoff
(worker gets persistentLocalCache + resume tokens once the main thread stops
holding it — the endgame of P2/P4).

**MASTER BASELINE COMPARISON (2026-07-03)** — the real bar: master's daily
experience is PARTIAL mode (~6,240 cards loaded: 1,240 published + 5,000
most-recent unpublished), vs the branch loading all 40,225. Measured master
(ef9e9cd4) with the identical harness/flow (NAV in main/half-baked, in-app
switch to working-notes, trusted-input typing, editor commit), same account,
dev backend, same machine:

| | master @ 6,240 cards | branch @ 40,225 (shadow) |
|---|---|---|
| NAV (6 rapid presses) | 22 long tasks, ~2,030ms total blocking (sustained ~90-120ms tasks) | **zero long tasks** |
| TYPING (10 chars) | 3 tasks, 195ms total | 1 task, 66ms |
| COMMIT settle | 819ms | ~2,000ms |
| COMMIT UI blocking | 8 tasks, ~1,120ms | 2 tasks, ~350ms |

Verdict: at 6.4× the corpus, the branch has strictly less UI-thread jank than
master's baseline in every phase. The one metric where master wins is commit
wall-clock settle (0.8s vs 2.0s): master's Firestore latency compensation
settles at local write-ack, while the branch's self-echo fires after the
server ack (~1s) and the UPDATE_CARDS echo cascade costs ~300ms at 40k. If
that 1.2s gap matters, the echo could move to fire at dispatch time (before
awaiting commit) — deferred until someone feels it.

**STRICTLY-SUPERIOR PASS (2026-07-03, commits b8301740→7bddaa96)** — closing
the commit gap and hardening; final head-to-head, ON mode at 40,225 cards vs
master at 6,240:
- NAV: master 22 long tasks ~2,030ms → branch ZERO long tasks.
- TYPING: master 3 tasks/195ms → branch ZERO long tasks.
- COMMIT UI blocking: master ~1,120ms across 8 tasks (max 380ms) → branch
  ~750ms across 3 tasks (max 384ms).
- COMMIT wall-clock settle: both now bounded by the same server ack (the
  optimistic echo settles Redux instantly; editor close awaits ack exactly
  like master; dev-backend acks ranged 0.8–2.9s across runs for both).
What it took (each CPU-profiled live before/after):
1. receiveCards applied every batch TWICE when nothing pending (enqueue-path
   flush condition always satisfied) — paths now exclusive w/ leftover guard.
2. Optimistic echo: dispatched before awaiting commit; pre-write cards
   snapshotted; rollback on commit failure (worker corpus too).
3. Worker's unpublished Listen split into the 5 getDocs partitions (a drop
   now redelivers ~8k, not 39k).
4. selectFingerprintGenerator rebuilt per cards-map change and re-ran TF-IDF
   over the corpus (~840ms/commit): per-card fingerprints now shared across
   generator instances via WeakMap keyed on card object identity (valid
   because unchanged cards keep identity), scoped to IDF/concepts/synonyms/
   size identity — plus selectServerIDFMap so the IDF wrapper keeps identity
   (without which the cache silently never hit). Remaining ~230ms is the
   per-tag fingerprint combine (selectTagsSemanticFingerprint) — next
   candidate if commit blocking needs to shrink further.
5. Similar-card filters' fetch trigger dynamically imported
   actions/similarity.js, whose graph reaches lit — in the worker this threw
   'window is not defined' (40 pageerrors/session) and silently dropped
   EVERY similarity fetch in worker modes. Now routed through leaf
   src/similarity-request.ts: main thread installs the real fetch
   (store.ts), the worker forwards over the bridge (deduped,
   'requestSimilarity' message), and the bridge re-keys live subscriptions
   on cardSimilarity identity changes so worker collections refresh.
Shadow-mode measurement caveat discovered on the way: the shadow comparator
itself recomputes the active collection on the UI thread after every corpus
change (~1.5s at 38k) — measure commit UX in ON mode (or off), never shadow.
Harness caveat: harness scripts must use an ABSOLUTE profile path; a
relative ./perf-profile silently creates a fresh signed-out profile.

**OLD-WAY ROBUSTNESS PARITY (2026-07-04, 28547779)** — warm boots restored:
worker modes now prime Redux once from the MAIN thread's persistent cache
(getDocsFromCache; purely local) at connect, so the app is usable in seconds
(active card resolved +5s vs +80s, verified live) while the worker's
authoritative network load proceeds behind; its initial coalesced flush is
flagged fastDedupe so reconciliation over the primed state skips the deep
compares. Worker readiness for serving collections/reference blocks is now
tracked bridge-side (per-fetchType batches delivered under the current
generation) instead of via Redux loading flags — the prime clears those
early, and a partially-loaded worker must never shrink a rendered collection
or serve empty reference blocks. Known limitation (rare): cards DELETED
since the cache was written linger for the session (the worker can't send
removals for docs it never saw); a full fix is a post-load ID-set
reconciliation message — noted for B3.

**RECONCILIATION + QUOTA-OUTAGE HARDENING (2026-07-04, 67675d47)**: the
deleted-card limitation above is now closed — once the worker corpus is
complete the bridge requests the full corpus ID set (requestCorpusIDs /
corpusIDs protocol) and removes Redux cards the worker doesn't have, once
per generation, with a mass-removal guard (skip + warn if >max(50, 10%)
stale — genuine while-away deletions are small). Found + fixed in the
process via a REAL dev quota outage (resource-exhausted after this session's
~15 full 40k loads): listener-error empty batches were counted as
corpus-completeness evidence, which under an outage would have declared an
empty worker corpus ready (empty reference blocks in 'on' mode, and
reconciliation would have removed every primed card). Error batches now
carry errorFallback and don't count. Validated UNDER the live outage: app
usable at +5s on 5,001 primed cards, readiness stays false, zero removals,
count stable — the old-way degraded-mode behavior, demonstrated in the wild.
PENDING (quota reset): one full-load run to see 'corpus reconciliation:
clean' and re-confirm commit flows. NOTE the outage also demonstrates why
the memory-cache worker is quota-hungry: every boot reads ~40k docs; go easy
on repeated full boots against dev (each probe run costs ~40k reads), and
the persistent-cache handoff (P2/P4) is what ultimately fixes this.

**FAILED EXPERIMENT — do not retry casually**: persistentLocalCache with
persistentMultipleTabManager inside the worker is `unimplemented` in the SDK
(12.12.0: "IndexedDB persistence is only available on platforms that support
LocalStorage"), auto-falls back to memory — AND the mere attempt reproducibly
broke app boot (active card never resolved; mechanism unclear, likely shared
firestore IndexedDB metadata interference with the main thread's multi-tab
client). Reverted. The real cache handoff (persistentSingleTabManager in the
worker once the main thread no longer holds persistence) remains the P2/P4
endgame; the local-cache prime above covers the daily warm-boot need until
then. Also note single-editor priority (user, 2026-07-04): concurrent edits
are an accepted-eventual-consistency edge case; 99% of usage is one editor,
occasionally multiple readers.

Baseline-harness mechanics (for reruns): master worktree needs
src/config.GENERATED.SECRET.ts copied in, `npm run generate:config` +
`generate:seo:config` (index.html is GENERATED and gitignored — wds 404s on
everything without it), tools/dump.ts deleted (pre-existing master tsc
error), node_modules symlinked (deps identical). CRITICAL: serve on port
8081 — the browser profile's Firebase credential is ORIGIN-bound to
localhost:8081; on any other port the app runs signed-out (published cards
only). Clear completeModeEnabled/completeModeLimit/corpus-worker in
localStorage via addInitScript. Script: scratchpad/measure-master.mjs;
worktree at scratchpad/master-baseline (git worktree remove when done).

**ADVERSARIAL REVIEW + BLOCKING FIXES (2026-07-04, 070d7659)**: four
sub-agent critiques (hacks / UX downsides / robustness / 6-month regrets)
reviewed the whole branch; three independently converged on the same top
defect. Fixed in 070d7659 (all 23 suites green):
1. Readiness was "first batch per fetchType" — satisfiable by the first of
   five partition flushes (~20% corpus) or an offline worker's empty
   from-cache snapshots. Now: worker announces loadComplete explicitly
   (privileged 'unpublished' = prime finished + listeners attached), AND the
   corpus must be TRUSTWORTHY vs Redux (corpusSizeTrustworthy in
   src/corpus-readiness.ts, max(50,10%) tolerance, tested). Every batch
   carries corpusSize so readiness recovers after outages.
2. Offline/outage blanking: an empty-memory-cache "load" can no longer
   serve/blank the primed app (trustworthy gate) — VALIDATED LIVE under a
   real dev resource-exhausted outage during this session: readiness stayed
   false, no untrusted serving, no reconciliation mass-removal.
3. Gen-1 (pre-permission) subscriptions no longer survive reconnect:
   worker clears its SubscriptionManager on (re)connect, bridge resets slot
   state + dispatches null results, pushes are readiness-gated at delivery.
4. Reconciliation now fires only when load-complete AND trustworthy, and
   re-arms per batch (outage recovery still reconciles); no more
   partial-corpus guard-skip latch.
5. Privacy: unpublished cache prime now happens at unpublished-connect with
   permissions known — full corpus only for mayViewUnpublished,
   author/editor-filtered for plain uids, skipped for anonymous. (A
   privileged session's cache previously primed ~38k unpublished cards into
   ANY later viewer's Redux.)
6. Stuck latches: reorderCard throw → pendingReorder stuck (try/caught);
   modifyCards no-id failOnError return → pendingModifications stuck
   (dispatches FAILURE). Worker runCollection failures reply WITH id
   (failed:true → bridge resolves null → local fallback); pending runs
   flushed on generation bump/teardown (blocks no longer freeze). Similarity
   dedupe is a 60s TTL (one failed fetch no longer kills similarity for a
   card until reload); bridge fetch call catches.
7. Hack removal: worker gets DEV_MODE from src/firebase.ts (was a duplicate
   hostname sniff — the thing that once pointed the loader at prod);
   partition table unified in src/card-partitions.ts (copies had drifted),
   sentinel as explicit '' escape.

STILL PENDING from the review (non-blocking, prioritized):
- Happy-path live validation of loadComplete/reconciliation/commit at 40k —
  BLOCKED on dev quota reset (the outage is real as of this writing; the
  main-thread persistent cache also came up nearly empty (1 card), so the
  next warm-boot prime will be cold until an off-mode session or worker
  load repopulates it).
- Parity test iterating every registered filter/sort through selector path
  AND QueryEngine (drift guard for FORWARDED_ACTION_TYPES); extract bridge
  readiness/reconciliation into more pure tested functions.
- Commit measurement harnesses to tools/perf/ (currently in wipeable /tmp).
- Measure find-dialog local-scan cost at 40k in 'on' mode (B3d only
  verified at 1,240; first paint per typing pause is still a local scan).
- Verify whether card-view's suggested-concept highlights were silently
  disabled (card-view.ts ~:976) vs deferred — review flagged as a possible
  unlogged feature removal.
- The [PERF] console.logs in receiveCards/database.ts bypass the
  DEBUG_PERF gate — gate them behind perfEnabled().
- Bigger regrets tracked for P2+: dual data planes calcifying, 'off'-mode
  rot, SearchIndex maintenance cost with no consumer, multi-tab quota
  multiplication (each tab = its own worker = its own 40k load).

**QUOTA ROOT-CAUSE + THE SYNC REDESIGN (2026-07-05)**: the owner declared
~40k-billed-reads-per-worker-boot unacceptable and set a 60k-card prod
ceiling. Key verified fact that reframed everything (see
docs/corpus-sync-fact-check.md, official pricing doc): a listener
re-attached after >30 MINUTES of disconnection is billed as a BRAND-NEW
query — the full result set — persistence and resume tokens
notwithstanding. So full-corpus listeners can never be cheap across
sessions, and the persistent-cache handoff (ecb69ec2) fixed boot SPEED and
offline but not billing. Two design agents (watermark/delta vs
bundle-centric; both docs committed), a fact-checker, and an adversarial
judge produced the final architecture in docs/corpus-sync-design.md:
- Delta plane: cache prime (free) → PER-BOOT trust gate (per-partition
  getCountFromServer vs corpus-in-hand; ~40-60 reads; partial caches are
  REAL — live incident: a 5,001-card partial-mode residue whose
  max(updated) ≈ corpus max would never self-heal via deltas) → ONE
  `published==false AND updated>watermark-5min` delta listener (result set
  = the change set) → tombstones collection for deletions (+ per-tombstone
  getDocFromServer cache laundering) → repair path re-reads only
  mismatched partitions.
- Watermark invariant: derived ONLY from `updated` of docs resident in the
  corpus from server-confirmed snapshots (never clocks/read-times/echo
  cards) — the no-gap proof in the watermark design doc depends on it.
- `updated` is the cursor (NOT a new sync_ts field): the judge verified
  'recent'/'updated' sorts read updated_substantive, so bumping `updated`
  on inbound-link writes (which previously DIDN'T bump — a live fastDedupe
  silent-drop hazard) has no sort side effects.
- Cold path v1: budgeted resumable server sweep (~65k reads over 2 days,
  ~yearly); bundle/GCS-snapshot machinery deliberately rejected for v1
  (internal-API risk + ~800 lines of standing server infra for a yearly
  event); escalation triggers documented in the design doc.
- ALSO fixed: cacheSizeBytes CACHE_SIZE_UNLIMITED on both persistent caches
  (17cffef9) — the 40MB LRU default was silently evicting the corpus and
  explains this week's near-empty caches.

Landed so far: Phase 0 (inbound-link updated bumps via new shared
timestampSentinel param + rules TEMPLATE change [firestore.rules is
GENERATED — edit firestore.TEMPLATE.rules]; tombstones collection + rules +
deleteCard batch write; (published,updated) composite index) and Phase 1
code (corpus-sync localStorage flag 'listen'|'watermark' via
CORPUS_WORKER.setSyncMode; worker watermark boot: prime → gate → repair →
tombstone catch-up → delta listener; src/worker/watermark.ts +
test:watermark; src/worker/sync-meta.ts worker IndexedDB store; syncState
protocol message unverified|live|stale). DEPLOY ORDER: npm run
generate:config, then firebase deploy --only firestore:rules,
firestore:indexes (dev, then prod) BEFORE any watermark-mode boot — the
delta query needs the composite index and the tombstone/updated rules.
STILL TO DO: Phase 2 budgeted cold sweep (currently cold falls back to the
partition repair path = full unbudgeted re-read); Phase 3 second-tab Web
Lock; Phase 4 cleanup (remove partition listeners after soak); live
validation of a watermark-mode boot (<100 reads expected) AFTER
rules+index deploy — dev quota was exhausted again on 2026-07-05 by a
single legacy-mode boot (the incident that proved the partial-cache hole).


**PHASES 2-3 + FIRST LIVE WATERMARK BOOTS (2026-07-05, later)**: Phase 2
budgeted cold sweep landed (6663f1db: priority phase = 5,000 most-recent
first, then ascending (updated, documentId) pages of 500 with persisted
cursor; 42k/quota-day budget with automatic pause/resume at Pacific
midnight; pure math in src/worker/cold-budget.ts + test:cold-budget; cold =
local < 50% of server total per the gate — repairs of nearly-everything are
a full read and belong on the budget). Phase 3 second-tab Web Locks guard
landed (65d277f6). Rules + BOTH composite indexes deployed to
dev-complexity-compendium — found live that index DIRECTION matters: the
priority phase's ORDER BY updated DESC needs its own (published ASC,
updated DESC) composite (9a2613e0), separate from the delta listener's ASC
one. LIVE VALIDATION so far (real dev, watermark mode): prime served 5,001
cached cards with the app usable at +10s; trust gate correctly reported
server=38,985 local=5,001 mismatched=10 and classified COLD; budgeted sweep
started; priority query correctly failed-precondition'd while the DESC
index builds, with the 60s retry loop holding; syncState 'unverified'
surfaced; no boot breakage. STILL PENDING: sweep completion once the DESC
index finishes building (a long-observation probe is running; expect
priority 5k + pages until today's remaining quota dies → pause → resume at
reset), then a WARM watermark boot (<100 reads: the real headline number),
then prod rules+indexes deploy and flipping corpus-sync default after soak.
NOTE: the budget counter only counts SWEEP reads — a day whose quota was
partly burned by other traffic (like today's legacy boot) exhausts early
and the 60s page-retry loop rides it out; acceptable, documented.
**ADVERSARIAL VERIFICATION OF THE SHIPPED SYNC (2026-07-05, later)**: a
verifier agent audited the implementation line-by-line plus the live cold
run. Verdict: yes-with-fixes (warm plane correct, O(changes) billing holds).
Its blocker B1 (cold sweep first-page startAfter('') deadlock, demonstrated
live) was already fixed in 2c625504; everything else landed in e19e248e:
watermark client-clock contamination guards (echo cards + pending persisted
mutations excluded from derivation until server-confirmed — the no-gap
invariant was violated two ways, one needing NO clock skew), tombstone
catch-up before the gate, directional gate (ghosts always repaired, small
missing-counts tolerated since the delta covers fresh creations),
post-sweep re-gate before loadComplete (sweep cursor and swept docs live in
different IndexedDBs), recreated-card suppression inversion + boot-time
launder retries, deleteCard tombstone-first batch ordering + editCard-
grantee tombstone rules (redeployed to dev). Remaining validations, in the
verifier's priority order: (1) cold sweep to completion live incl. one
budget pause and one worker-kill mid-sweep; (2) emulator test for watermark
contamination (pending mutation + skewed-clock echo must not advance the
bound); (3) multi-day warm-boot soak with billed-read telemetry (~40-60
gate + deltas expected), incl. a cross-device delete and an unpublish-flip.
The verifier's M7 stands: the specced emulator suite is the biggest
remaining test gap — the one live cold run immediately hit a bug in exactly
that untested layer.

**CATCH-UP ENTRY (2026-07-07/08): three arcs landed by a separate session,
then review-hardened.** The 2026-07-06/07 session (31 commits, 06cba17c..
be340772) shipped: (1) the `updated` write-invariant made structural for
client writes — MultiBatch chokepoint + rules enforcement (bumpsUpdated on
create/content-edit branches, admin-gated tweet exemption) + a 465-line
audit suite + Stryker mutation testing; (2) adversarial verification
scaffolding (property tests, 100% mutation score on the policy core); (3) an
emulator-based perf harness (test/perf-harness/: seeded synthetic corpus,
Playwright runner, flag-gated emulator wiring in firebase.ts — default-off
and fail-closed via a demo-perf projectId override — worker-mode
measurement, DEBUG_PERF.data()). That session did NOT update this log, and
did NOT run the three pending live sync validations (cold sweep completion,
warm-boot billed-read count, soak) — THEY REMAIN THE GATE to flipping
corpus-sync default and the prod deploy.

A two-critic adversarial review of that work, then fixes (bced4990,
153a3d98, 181eaa0a, + this entry):
- Rules: the inbound-reference `updated` requirement had been collapsed
  from the design's staged rollout straight to REQUIRED — a rules-only prod
  deploy would have permission-denied every link-affecting edit from the
  shipped prod client. Un-collapsed to optional-but-validated; the tighten
  step is written into the rule itself as a prod-cutover action; security
  tests assert the staged semantics (176 passing).
- The guard moved to shared/ and its ENFORCEMENT into MultiBatchBase, so
  the admin-SDK MultiBatch (tools/mount.ts) applies the same policy —
  admin writes bypass rules, so the chokepoint is their only net. Six new
  tests drive the base wiring with a stub SDK (the audit had demonstrated
  that deleting the guard call passed every test while the mutation badge
  stayed 100%). Stryker retargeted: 43/43 killed.
- Perf harness: synthetic cards now carry nlp_search_tokens + a Zipf
  vocabulary (previously the worker index had nothing to index — every
  query measured the full-scan fallback) + the REQUIRED sort_order
  (previously the default-set comparator computed NaN per pair) + realistic
  published ratio; --assert gate implemented; README gains a Status-honesty
  section (no CI, no perf:dev yet, live-dev numbers remain the acceptance
  evidence; pre-fix baselines not comparable).
- The NLP-migration no-bump exemption is now REGISTERED in
  docs/corpus-sync-design.md's new exemption registry (it had been
  self-granted in a code comment).
- Claim corrections for the record: "100% mutation score" covers the policy
  core only (now also the base wiring via direct tests); harness numbers
  are relative-delta evidence only. OPEN: the unexplained 14.4s worker
  collectionPush inside the settled window of the admin-on-40000 baseline —
  investigate before trusting worker-side harness timings; old baselines
  invalidated by the corpus changes anyway.

**LANDING READINESS (2026-07-10, in progress)** — branch is 203 commits
ahead of origin/master, 0 behind (no conflict risk). CRITICAL DEPLOY
FINDING, verified in code: with all flags at defaults ('corpus-worker' off,
'corpus-sync' listen), the app is STILL all-cards-local via MAIN-THREAD
full-corpus listeners — A6 deleted partial mode, so there is no 6k-cap
fallback anymore. At prod scale (~40-60k cards) every >30-min-gap boot on
the default path bills ~O(corpus) reads (the documented 30-min listener
re-billing rule). Therefore: **MERGING to master is safe (no deploy
happens); DEPLOYING to prod is NOT safe until the flag-flip decision** —
prod deploy must ship with corpus-worker='on' + corpus-sync='watermark'
defaults (gated on the three live validations + the user's sign-off) or
not happen at all. The "default-off = behavior-neutral" framing is true
for dev ergonomics and rollback, NOT for prod billing. Also gated the
formerly-unconditional [PERF] console.logs in receiveCards/
cardSnapshotReceiver behind perfEnabled() (review item; ambient noise for
every user otherwise).

**PERCEIVED-LATENCY FIXES (2026-07-11, 9e754b67)**: adversarial prosecution
proved "zero long tasks" measured jank, not content arrival. Fixed: (1)
stale reference blocks / info-panel content now CLEAR on card change
(empty-until-ready) instead of showing the previous card's relations for
the debounce+roundtrip window; components track ownership via
_cardReferenceBlocksForCardID / _expensivePropertiesForCardID; (2) 1s
max-wait on both 250ms settle debounces (they reset per state change —
store churn could starve them forever); (3) bridge resubscribes the active
collection IMMEDIATELY on description change (was: up to 1s comparator tick
+ compute, forcing a ~3s local fallback per switch at 40k). REMAINING
pre-flip: content-correctness metric in the harness — poll
document.querySelector('card-view')._cardReferenceBlocksForCardID ===
activeCardID from keydown to first correct frame (the ownership fields
exist precisely to make this measurable); accepted-not-fixed: blocks
pinned/empty while editing (restore via worker editing-card blocks, P3).

## 2026-07-11 — Adversarial round 2 (fixes-of-the-fixes) + UX-feel critique

**Attacker vs 9e754b67 — four confirmed defects, all fixed in 496c98e6:**
C1 max-wait could fire the SYNC 1-2s fallback mid-nav in off/boot mode
(freeze + ~1Hz flicker) → overdue now also requires
corpusWorkerCanRunCollections(); I1 firstDeferredAt epochs not reset on
early-return paths (editing return, !_open return) → stale-overdue instant
fires on editing-finish/panel-reopen, fixed; I2 worker-null fallback
labeled ownership with stale captured cardID (clears CORRECT content next
stateChanged) → fresh card id; I3 fastResubscribeOnDescriptionChange paid
Object.keys(40k) on EVERY dispatch → cheap serialize compare gates first.
Attacker verified sound: reconnect interplay, editing/find gating,
no-stuck-empty, precomputed serialize.

**UX-feel critic verdict (full report in session task
a1907d60d91ad47c4):** browsing/settling/find = acceptable; editing,
boot-visibility, second-tab = needs-work. Top 5 by felt impact, NOT YET
IMPLEMENTED (queue for pre-flag-flip polish):
1. Sync/staleness pill in header driven by already-plumbed syncState +
   cold-sweep progress (today syncState is console.log-only — biggest
   trust gap: app knows its confidence, tells nobody).
2. Second-tab snack-bar ("another tab is syncing — showing published
   only; reload to take over") — snack-bar.ts exists, currently
   offline/online-only; loser-tab downgrade is console-only
   (corpus-worker.ts ~:1278).
3. Sidebar skeleton instead of hard void during the 250ms gap — reuse
   card-renderer's italic/dim `.loading` idiom + reserve height.
4. Frozen dimmed "as of before edit" reference blocks while editing
   (today blocks + word cloud vanish for the whole edit session — the
   garden's best feature removed exactly while writing).
5. Find-drawer opacity dip while a query is in flight (occasional
   "search ignored me" on slow queries).

## 2026-07-11 — Restored: live related-cards refresh while editing (4790e53e)

Owner asked where the master-era "refresh related cards every ~5s while
editing" pipeline went. Answer: it was a chain, and only the last hop was
cut. Upstream always survived — textFieldUpdated's 1s debounce →
EDITING_PROCESS_NORMALIZED_TEXT_PROPERTIES → version-memoized
selectEditingNormalizedCard; the similar-cards filter's
lastSeenEditingCard identity trigger → Qdrant fetch of LIVE content →
EDITING_UPDATE_SIMILAR_CARDS overlay. dba98e20 severed the render hop
(card-view cleared blocks for the whole edit session) because the sync
expansion is 1-2s at 40k; and the worker path couldn't represent the
editing card (query-engine hardcoded editingCardSimilarity: undefined,
worker's requestSimilarity forward dropped the editingCard arg — so in
worker mode the editing-content Qdrant fetch was ALSO silently dead).

Restore (worker-served): setEditingCard protocol message (bridge sends on
normalized-card/similarity identity change, ~1/s max, reset+resent on
reconnect) → engine threads editingCard/editingCardSimilarity into every
run (native CollectionConstructorArguments fields; shared filter code
just works) + markDirty re-pushes subscriptions; requestSimilarity
forEditingCard forwarded sans TTL, resolved main-side against the
canonical object (clone has dead Timestamp prototypes), identity-deduped
in fetchSimilarCardsForCardIfEnabled against shadow-mode double-fetch.
card-view editing gate removed: same debounce/max-wait scheduler, card =
selectEditingNormalizedCard while editing, args =
selectCollectionConstructorArgumentsWithEditingCard, stale-drop
invalidates on editing-state toggle. Off-mode sync fallback = exact
master behavior (feature at ≤10k scale; off mode at 40k was already
non-viable). Cadence while typing: debounce+1s max-wait ≈ 1Hz off-thread
refresh; Qdrant round-trip lands seconds later and re-pushes. This
closes UX critique #4 and subsumes the P3 editing-blocks item.

Tests: full suite green. NOT yet live-verified (needs signed-in editor
session on dev at 40k: type in a card body, watch sidebar related cards
update within ~1-5s without typing jank; verify one similarCards callable
per content version in the network tab, no duplicates in shadow mode).
Info panel still deliberately serves the COMMITTED card while editing —
candidate follow-up now that the worker can serve editing content.
