# All-Cards-Local Landing Plan

Branch: `implement/all-cards-local-ready`

Started: 2026-05-02

Goal: make the all-cards-client-side approach robust enough to land, prioritizing warm interaction performance first, whole-set search second, and NLP edge-case correctness third.

## Priorities

1. Performance for:
   - navigating up/down in card lists
   - opening cards for editing
   - typing in an editing card
   - committing an editable card
2. Ability to search through the whole loaded card set.
3. NLP edge-case correctness, especially where incorrect stored NLP would materially bite search or card semantics.

## Working Principles

- Keep all cards client-side for users allowed to see them.
- Prefer client-side filtering/search once cards are loaded.
- Do not let stored NLP become a trusted stale source of truth unless it is made consistent.
- Remove or quarantine vestigial server-search machinery when it conflicts with the final architecture.
- Test after each meaningful chunk.

## TODO

### Performance

- [x] Add a memoized active-collection card ID index so next/previous navigation does not allocate and scan `collection.map(...)` on every keypress.
- [x] Open the editor immediately from local state, then refresh the card asynchronously and reconcile if the fetched card differs.
- [x] Add stale-generation protection to the full unpublished partitioned `getDocs` flow.
- [x] Profile or at least instrument one-card update/snapshot echo paths enough to see whether active collection filtering is being forced during commit.
- [x] Reduce post-commit selector blast radius if profiling/instrumentation shows active collection rebuilds are too expensive.
- [x] Keep typing keystroke path free of global card-map updates; profile delayed normalized-card enrichment separately.
- [x] Re-check real interaction complaints with sub-agent critique focused on arrow navigation, edit mode, suggested concepts, and selector/cache architecture.
- [x] Remove the remaining full-card-map scans from the editor config/suggested-concepts path.
- [x] Fix the observed arrow-key lag caused by re-rendering the whole visible thumbnail list when only the highlighted card changed.
- [x] Keep the editor opening on Configuration while moving suggested concepts/tags off the synchronous editor-open path.

### Whole-Set Search

- [x] Confirm query filters operate over the loaded local set and do not depend on vestigial `nlp_search_tokens` server narrowing.
- [x] Make stored NLP an optional acceleration, not a lossy source of truth for fields needed by local search.
- [x] Ensure cards created by every write path are searchable immediately in the local all-cards model.

### NLP Robustness

- [x] Normalize fast-path `card.nlp` shape so every `CardFieldType` exists as an array.
- [x] Fix stored NLP behavior for `non_link_references` and `concept_references`, or compute those fields locally instead of trusting stored tokens.
- [x] Ensure inbound-reference updates, forks, and deletes cannot leave target-card searchable NLP stale in a way that affects local search.
- [x] Prevent older/permissive clients from leaving current-version stored NLP stale after content edits, or detect and ignore stale stored NLP.

### Product/Architecture Cleanup

- [x] Remove or rewrite complete/partial mode UI so it matches all-local fetch behavior.
- [x] Make public IDF maps safe, private, or disabled.
- [x] Fix lazy `require('jsdom')` usage in ESM functions if the affected functions remain deployed.
- [x] Remove or clearly isolate abandoned Firestore Enterprise/deep-fetch/server-query code.

## Completed

- [x] Created working branch `implement/all-cards-local-ready` on top of `experiment/all-cards-local`.
- [x] Captured deeper branch analysis in `docs/all-cards-local-branch-analysis.md`.
- [x] Replaced active-card index lookup with a memoized active collection ID index.
- [x] Moved editor freshness read off the editor-open critical path.
- [x] Added generation checks so stale partitioned unpublished fetches cannot dispatch cards or attach listeners.
- [x] Fast-path tokenized cards now have complete `nlp` field arrays.
- [x] Fast-path tokenized cards compute `references_info_inbound`, `non_link_references`, and `concept_references` locally from current raw card/reference state.
- [x] Cards without stored NLP remain searchable through the existing slow path, so create/bulk/fork paths are immediately searchable in the all-local model.
- [x] Stored NLP now carries `nlp_source_fingerprint`; stale or missing fingerprints fall back to full local NLP.
- [x] Edits to `external_link` now refresh stored NLP and source fingerprints.
- [x] Slow collection filter/sort work now logs when it exceeds 50ms, making one-card update/snapshot echo costs visible.
- [x] NLP migration reruns cards that have current-version tokens but no source fingerprint.
- [x] Drawer visibility selector now avoids forcing fallback/filter work when the drawer is closed.
- [x] Hidden card drawer no longer renders collection counts/thumbnails, avoiding collection evaluation when the drawer is closed.
- [x] Delayed editor normalized-card enrichment logs when it exceeds 50ms.
- [x] Server-query filter classification is explicitly documented as legacy/isolated from the all-local fetch runtime.
- [x] Public IDF generation now filters to published body cards only.
- [x] Lazy `jsdom` loads in functions now use `createRequire(import.meta.url)` under ESM.
- [x] Limit warning now reports only all-card unpublished loading state instead of offering a misleading partial/complete toggle.
- [x] Node URL parsing tests now install a JSDOM browser shim before loading Lit-dependent modules.
- [x] `filters.ts` no longer imports similarity actions at module load, reducing circular import pressure around collection description parsing.
- [x] Store setup now tolerates the `redux-thunk` CommonJS/ESM shape used by the Mocha `esm` loader.
- [x] Editor open/typing path no longer computes suggested concepts/tags, editing reference blocks, card tag-info maps, or config-only metadata while the content tab is active.
- [x] Editor hidden tabs are not rendered, so the config surface no longer builds tag/reference controls on every content keystroke.
- [x] Saving from the content tab no longer forces suggested-concept computation before generating the write diff.
- [x] Concept highlighting now inverts the concept ngram map once and only checks concepts referenced by the active card, avoiding full concept-map scans during up/down navigation.
- [x] Second-round sub-agent review found that `Collection.finalSortedCards` was still allocating whole arrays repeatedly during list navigation; the collection now caches final sorted cards and labels per instance.
- [x] Full-card thumbnail lists no longer expand reference blocks for every visible thumbnail, avoiding reference-block work while scrolling/navigating list views.
- [x] `tag-list` no longer filters all `tagInfos` entries when no add/select control is rendered, avoiding accidental 40k-entry scans in display-only tag lists.
- [x] Editing normalized cards no longer attach the global concept and synonym maps; suggested concepts now tokenize the editing card without causing semantic word-counting to scan every concept against every run.
- [x] Editor config tab now builds card tag infos only for visible reference chips, previous deleted references, missing reciprocal links, and suggested concepts instead of calling the all-card `selectTagInfosForCards` selector.
- [x] Duplicate fresh-card updates from edit-open `onSnapshot`/`getDoc` are ignored when timestamp-insensitive card data is equivalent, reducing needless editor conflict/update fanout.
- [x] Thumbnail-list highlight changes now update only the old/new thumbnail DOM nodes and scroll target instead of re-rendering up to 250 thumbnails on every arrow-key navigation.
- [x] Closed suggestions, comments, and info panels now avoid their expensive active-card/all-card selectors while closed.
- [x] Suggested tags/concepts in the editor Configuration tab are deferred until after the editor has opened; stale deferred work is guarded by editing card/extraction key.

## Test Log

- 2026-05-02: Full `npm test` is still expected to require Java 21 for Firebase security-emulator coverage in this environment; run the non-emulator suites directly.
- 2026-05-02: `npx tsc --noEmit` passed after navigation index, editor-open, and unpublished fetch generation changes.
- 2026-05-02: `npx tsc --noEmit` passed after fast-path NLP shape/reference extractor changes.
- 2026-05-02: `npm run test:shared-nlp` passed, 18 tests.
- 2026-05-02: `npm run test:ngram` passed, 11 tests.
- 2026-05-02: `npm run test:filter-classification` passed, 49 tests.
- 2026-05-02: `npm run test:contenteditable` passed, 48 tests.
- 2026-05-02: `npx tsc --noEmit` passed after adding `external_link` to stored-NLP refresh detection.
- 2026-05-02: `cd functions && npx tsc --noEmit` passed after public IDF filtering change.
- 2026-05-02: `cd functions && npx tsc --noEmit` passed after ESM lazy `jsdom` fix.
- 2026-05-02: `npx tsc --noEmit` passed after limit warning UI cleanup.
- 2026-05-02: Final `npx tsc --noEmit` and `cd functions && npx tsc --noEmit` both passed for the current worktree.
- 2026-05-02: `npx tsc --noEmit` passed after local `references_info_inbound` processing change.
- 2026-05-02: `npm run build:shared` passed after `nlp_source_fingerprint` support.
- 2026-05-02: `npm run test:shared-nlp` passed, 20 tests.
- 2026-05-02: `npx tsc --noEmit` passed after collection performance instrumentation.
- 2026-05-02: `npx tsc --noEmit` passed after migration skip and drawer visibility refinements.
- 2026-05-02: `npx tsc --noEmit` passed after hidden card drawer render short-circuit.
- 2026-05-02: Final `npm run test:shared-nlp` passed, 20 tests.
- 2026-05-02: Final `npm run test:filter-classification` passed, 49 tests.
- 2026-05-02: Final `cd functions && npx tsc --noEmit` passed.
- 2026-05-02: `npx tsc --noEmit` passed after delayed editor enrichment instrumentation.
- 2026-05-02: `npm run test:filter-classification` passed, 49 tests, after legacy classification isolation comment.
- 2026-05-02: `npx tsc --noEmit` passed after legacy classification isolation comment.
- 2026-05-02: `npm run build` passed. Rollup/workbox emitted existing warnings about `this` rewriting, circular dependencies, minify-html-literals, outdated browserslist data, and one bundle above the precache size limit.
- 2026-05-02: Final `npm run build` passed with the same warning classes.
- 2026-05-02: `npm run build:shared && npm run build:typescript && npm run test:references` passed, 42 tests, after updating stale reference-test imports.
- 2026-05-02: `npm run test:fingerprint` passed, 41 tests, after updating stale fingerprint-test imports and expectations to match the compiled shared NLP/card-field modules.
- 2026-05-02: `npm run test:url` passed, 23 tests, after fixing the Node DOM shim and reducing collection/filter circular import pressure.
- 2026-05-02: Non-security suite passed: `test:url`, `test:contenteditable`, `test:references`, `test:fingerprint`, `test:ngram`, `test:objpath`, `test:mount`, `test:mount-roundtrip`, `test:filter-classification`, `test:util`, and `test:shared-nlp`.
- 2026-05-02: `npm test` still stops before app tests at `test:security` because local Firebase tooling requires Java 21 or newer.
- 2026-05-02: Final `npx tsc --noEmit`, `cd functions && npx tsc --noEmit`, and `npm run build` passed. Build warnings remained the known Rollup/workbox warnings about `this` rewriting, circular dependencies, minify-html-literals, outdated browserslist data, and one oversized precache bundle.
- 2026-05-02: After Temurin 21 was installed, `java -version` reported OpenJDK 21.0.11 and full `npm test` passed, including `test:security` with 169 security-rule tests.
- 2026-05-02: After editor hot-path cleanup, `npx tsc --noEmit`, `npm run test:contenteditable`, `npm run test:fingerprint`, `npm run test:url`, and `npm test` passed.
- 2026-05-02: After concept-highlight lookup optimization, `npx tsc --noEmit`, `npm run test:contenteditable`, and `npm run test:fingerprint` passed.
- 2026-05-02: Final `npm run build` and `npm test` passed after the navigation/editor performance fixes. Build warnings remained the known Rollup/workbox warning classes.
- 2026-05-02: Second-round perf review spawned sub-agents for arrow navigation, editor/suggested concepts, and selector/cache architecture. Their critiques identified residual full-array allocation, full-card thumbnail reference-block expansion, global concept attachment to editing normalization, all-card tag-info creation in the editor, display-only tag-list filtering, and duplicate edit-open fresh-card updates.
- 2026-05-02: `npx tsc --noEmit` passed after collection final-array caching, display-only tag-list filtering, full-card thumbnail simplification, edit-open dedupe, editing normalized-card narrowing, and editor-local card tag infos.
- 2026-05-02: `npm run test:contenteditable`, `npm run test:fingerprint`, and `npm run test:url` passed after the second-round performance fixes.
- 2026-05-02: Final `npm run build` passed after the second-round performance fixes. Build warnings remained the known Rollup/workbox warning classes.
- 2026-05-02: Final `npm test` passed, including `test:security` with 169 Firestore emulator tests.
- 2026-05-02: User reported navigation and editing were still unacceptably slow, and clarified that editing should open Configuration because content is editable inline.
- 2026-05-02: `npx tsc --noEmit`, `npm run test:contenteditable`, `npm run test:fingerprint`, and `npm run test:url` passed after the thumbnail-highlight, closed-panel, and deferred editor suggestion fixes.
