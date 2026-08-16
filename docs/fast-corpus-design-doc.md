# Design Doc: Fast Whole-Corpus Card Search, Editing, and Navigation at 40k Scale

Branch: `design/all-cards-local-design-doc` (from `implement/all-cards-local-ready`)

Date: 2026-07-02

Status: Proposal — synthesizes six months of branch history, three research reports (master architecture, branch archaeology, current-state audit), and three independently-developed candidate architectures.

---

## 1. Goals

Gathered from explicit user statements and requirements discovered across the whole effort, in priority order:

1. **Warm interaction performance** — navigating up/down card lists, opening the editor, typing, and committing a card must be fast. This is the #1 goal and the #1 *unmet* goal: even after two full rounds of optimization on `implement/all-cards-local-ready`, the user reported navigation and editing "unacceptably slow."
2. **Whole-corpus search** — query filters and the find dialog must search all ~40k cards (published + unpublished for privileged users), not a hot subset.
3. **No massive memory footprint** — all-cards-in-Redux currently implies roughly 0.8–1.5GB tab memory. Explicitly called out as unacceptable.
4. **Cold boot matters least** (explicit) — 30s+ initial load is tolerated, though improvement is welcome.
5. **Feature preservation** — sections, tags, stars/reads/reading-list, reference graph and reference filters, concept cards + synonyms, concept highlighting, word clouds, similarity sort (Qdrant embeddings), find dialog, permissions (published vs. unpublished; per-card author/editor visibility), live multi-user updates, undo/conflict detection.
6. **Multi-user correctness** — permission changes must not leave stale data; older clients must not poison stored NLP (fingerprint validation exists for this).

### Non-goals

- Cold-boot heroics beyond what falls out naturally.
- Offline-first authoring.
- Corpus scale beyond ~100k cards (though the chosen design should not paint us into a corner).

---

## 2. What we learned (condensed history)

Six architectural approaches over ~6 months. Full archaeology preserved in `docs/all-cards-local-branch-analysis.md` and the branches themselves.

| Era | Approach | Outcome | Lesson |
|---|---|---|---|
| Baseline (master) | ~1–10k hot cards; `selectCards` re-runs full NLP for the corpus on any change; complete/partial mode toggle | Untenable at 40k | Selector chain and eager NLP are the structural costs |
| Cursor pagination | Load cards in pages on demand | Abandoned | Partial data breaks Collection memoization and completeness semantics |
| Firestore Enterprise + `regex_match` | Server-side text search | **Fully reverted** — broken 3 independent ways (RE2 incompatibility, wrong operator/field shapes), zero realized benefit | Never bet on unproven server operators; spike on the real corpus first |
| 3-tier hot system + progressive deep fetch | ~10k hot cards instant + background deep fetch for completeness | Worked, but removed | The client selector chain stayed O(40k)-expensive per update (600ms+ blocking JS); +710 lines of generation/debounce complexity; server narrowing didn't address the real cost |
| All-cards-local v1 | Remove deep fetch, load all 40k | Exposed selector chain as the true bottleneck | Simplification made the O(40k) cost undeniable |
| All-cards-local v2 (current) | WeakMap<Card, ProcessedCard> cache; stored `nlp_tokens` + `nlp_source_fingerprint`; partitioned getDocs boot; two rounds of component fixes | Selector eval 600ms → ~5ms; all tests pass; **user still reports unacceptable slowness** | Per-card caching is necessary but not sufficient; something below the selector layer still costs O(corpus) per interaction |

Hard technical constraints discovered along the way:

- Firestore: a single query on 38k+ docs hits a ~60s timeout → must partition/paginate (current: 4–5 parallel documentID-range getDocs, then onSnapshot). Max 10k docs per getDocs page. One `array-contains` per standard query. `regex_match` unusable. No full-text search in standard Firestore.
- Firestore rules cannot enforce content↔NLP consistency; `nlp_source_fingerprint` validation is the working mitigation.
- Reference-derived NLP fields must be computed locally (inbound references mutate without touching the card doc).
- Derived server artifacts (IDF maps, any index) must not leak unpublished vocabulary; unpublished visibility is per-user.
- Redux/reselect identity semantics mean a 40k-entry map in state has an inherent invalidation blast-radius problem — every candidate design must confront it explicitly.
- A recorded April 2026 decision favored Firestore Enterprise Pipeline `arrayContainsAll` over stored `nlp_search_tokens` (~4–8s unindexed Preview scans, ~100–500ms once array indexes land). That decision predates the all-cards-local pivot; it is an option, not a commitment.

---

## 3. The critical finding: the residual slowness has a suspect, and it was never profiled

**No browser profile of the app with a realistic 40k corpus has ever been captured.** Every optimization round — including the two on this branch — was driven by code reading and inference. All three candidate plans independently concluded that a profiling gate must come before any further investment.

Code-level analysis during this design round identified four specific identity-churn costs that survive all existing optimizations, ranked:

1. **`makeFilterFromCards` clones every filter membership map on every card/stars/reads update** (`src/reducers/collection.ts:187–203`). For each of the ~125 entries in `CARD_FILTER_FUNCS`, it runs `setUnion(setRemove(prev, nonMatching), matching)` — two full object spreads of maps holding up to 40k entries each, *regardless of whether membership changed*. Worse: arrow-key navigation fires auto-mark-read (`UPDATE_READS`), which takes the same path. This is a reducer-level cost, **below** every selector optimization done so far, and is the strongest single candidate for the unexplained residual slowness.
2. **`UPDATE_CARDS` resets `cardSimilarity` to a fresh `{}` every time** (`src/reducers/data.ts:154`, existing TODO), guaranteeing `selectCollectionConstructorArguments` invalidation on every echo.
3. **`selectActiveCollection` constructs a brand-new `Collection` with empty filter/sort caches whenever args identity changes** — including on `UPDATE_READS` during navigation — even though its actual filtering inputs (`cardsSnapshot`, `filtersSnapshot`) are unchanged by design of the ghosting system. `card-view.stateChanged` and the drawer-visibility selector then force a full 40k refilter + resort.
4. **`selectCountsForTabs` rebuilds ~5 Collections** (several over the full `everything` set) inside `main-view.stateChanged` on every such invalidation.

Secondary surviving costs (from the current-state audit): `selectCards` returns a new result object whenever any card changes, so every downstream dependent re-runs; the post-getDocs onSnapshot re-delivers ~38k docs through O(full-card) deep-equal dedupe; boot runs the full cascade 5–10+ times as partitions land; `selectActiveCardEnriched` and `selectSynonymMap` recompute on unrelated card changes.

Memory: raw card + Redux ProcessedCard + WeakMap entries + Firestore IndexedDB mirror ≈ 12–18KB/card → ~0.5–0.7GB of data, 0.8–1.5GB tab RSS. A heap this size also implicates GC pauses as a possible contributor to perceived jank — another thing only profiling can confirm.

---

## 4. Candidate architectures

Three plans were developed independently against the same brief, each committing to a different bet. All three are preserved here at decision-making fidelity; each plan's full text is available in the session records and can be regenerated.

### Plan A — Finish all-cards-local: surgical blast-radius completion (~17 days)

**Bet:** the architecture is 90% right; the residual slowness is the four identity-churn bugs above, which are code-verifiable and cheap to fix. Cards stay in Redux; memory is addressed only with cheap wins.

**Key moves:**

- **Stage 0 — Instrument & baseline (2d).** Redux middleware timing every dispatch; counters in `Collection._makeFilteredCards`/`_makeSortedCards`, `makeFilterFromCards` (maps cloned, entries copied), `selectCards` cache misses; `performance.measure` around `stateChanged` for the four hot components. Scripted interactions on the real production corpus as admin: arrow-down ×20 (with auto-mark-read), editor open, 30 keystrokes, commit + echo, remote echo from second tab, cold/warm boot. Budgets: navigation keypress ≤16ms; editor open ≤100ms; commit-to-interactive ≤200ms; remote echo ≤50ms; zero active-collection refilters when membership doesn't change.
- **Stage 1 — Reducer identity fixes (2d).** Rewrite `makeFilterFromCards` to compute per-filter add/remove deltas and clone only maps that actually changed (return previous identity when nothing changed); same for `UPDATE_STARS`/`UPDATE_READS`; surgically prune `cardSimilarity` instead of resetting it.
- **Stage 2 — Incremental projection selectors (3d).** A `createCardDiffSelector` utility (identity-diff the 40k keys ~1–2ms; recompute only when the relevant slice changed) applied to `selectEverythingSet`, `selectDefaultSet`, `selectAuthorAndCollaboratorUserIDs`, `selectSynonymMap`, `selectRawConceptCards`, `selectAllCardsFilter`.
- **Stage 3 — Collection work handoff + cheap tab counts (4d).** `Collection.cloneWithUpdatedCards(...)`: when description/snapshots/sets/salt/keyCard are identity-equal, carry over filtered-ID list and sort info and only re-expand the visible collection (sub-ms) instead of refiltering 40k. `countForDescription()` intersects sets with filter maps without instantiating Collections. Dev-mode assertion compares handoff results to full rebuilds. **This stage is the acceptance gate for goal #1.**
- **Stage 4 — Boot coalescing + timestamp-based echo dedupe (1.5d).** Batch partition arrivals through the existing `ENQUEUE_CARD_UPDATES`; fast-path echo dedupe on `updated` timestamps (sampled deep-equal assertion in dev).
- **Stage 5 — Memory cheap wins (1.5d).** Strip `nlp_search_tokens` from Redux at ingestion (est. 80–200MB; keep the field in Firestore to preserve the Enterprise option); shared frozen empty objects in `processCard`.
- **Stage 6 — Deletions (1d).** `src/filter-classification.ts` and its test, complete/partial mode remnants, related selectors/actions.

**End state of a single-card edit:** echo → coalesced `UPDATE_CARDS` → new cards map (1 new object), filter maps cloned only where membership flipped → `selectCards` with 39,999 WeakMap hits (~5ms) → projections keep identity → Collection handoff re-expansion (sub-ms) → Lit re-renders only the affected card. Target <30ms total.

**Honest weaknesses:** memory stays at hundreds of MB (goal 3 only partially met); if profiling reveals the jank is GC-pressure from the giant heap or Lit render fan-out rather than reducer/selector work, this plan fixes real problems but may not fix *the* problem.

### Plan B — Corpus Worker: move the corpus off the UI thread (~28–37 days)

**Bet:** no amount of tuning fixes the structural fact that a 40k-entry map lives in the synchronous state tree the UI renders from. Move the corpus, the Firestore SDK, the filter/sort engine, and all whole-corpus NLP into a dedicated Web Worker. UI-thread Redux holds only what is visible: the active collection's ordered ID list, a ~300-card window of stubs, a compact ~4MB `cardMeta` table (title/type/section/published/sortOrder for all cards, for synchronous consumers like `card-link`), and pinned full cards (active + editing).

**Key decisions:**

- **Firestore SDK lives in the worker** (auth via `indexedDBLocalPersistence` handoff): snapshot parsing, echo dedupe, and boot work leave the UI thread entirely; the corpus never crosses the postMessage boundary.
- **Custom inverted index for candidate recall** (`Map<stemmedToken, Set<CardID>>` over the already-stored `nlp_search_tokens`) — *not* FlexSearch/MiniSearch/SQLite-FTS5, because ranking must stay bit-identical to the existing field-weighted `PreparedQuery.cardScore`, which runs over just the recalled candidates. Index build ~1–3s off-thread at boot; ~1ms delta maintenance per edit.
- **The engine is the existing code**: `filters.ts`, `collection_description.ts`, `nlp.ts` are already UI-free and run in the worker (linkedom injected via the existing `overrideDocument()` for slow-path HTML tokenization). Every filter type (query, reference graph BFS, concepts, stars/reads forwarded as deltas, unions/inversions, similarity via forwarded Qdrant map) executes worker-side with the same code.
- **`Collection` is replaced by a serializable `CollectionResult`** (ordered IDs + labels + counts + fallback/preview flags) pushed by worker-side live subscriptions; a thin `CollectionView` on the UI thread preserves the getter surface of the ~25 consuming files (enumerated in the plan). Components render the previous result during the gap, which reproduces today's ghosting/snapshot semantics.
- **Edit propagation:** commit → worker applies optimistic corpus + index delta → incrementally re-runs live subscriptions → pushes a result diff (usually "nothing moved") → tiny Redux delta. The `UPDATE_CARDS` blast radius ceases to exist because there is no all-cards map on the UI thread. Firestore echo arrives in the worker and is deduped there.
- **Memory target:** UI thread ~0 (from ~500–700MB); worker ~200–350MB; tab RSS ~400–550MB total, with a small UI heap so GC pauses stop hitting frames.

**Migration:** Stage 0 spike (Firestore-in-worker multi-tab persistence + index benchmarks + the overdue 40k profile, 3–4d, kill-switch); Stage 1 move card ingestion to worker behavior-neutrally (4–5d); Stage 2 worker query engine in shadow mode with divergence logging against the live UI computation (8–10d); Stage 3 cutover + big deletion (10–14d); Stage 4 tuning (3–4d).

**Honest weaknesses:** the largest and riskiest migration (the Collection consumer surface across ~25 files); Firestore-in-worker multi-tab persistence is a load-bearing unknown (fallbacks specified); permanent two-thread debugging cost; ~28–37 days.

### Plan C — Thin client + server-side whole-corpus search (~30–37 days)

**Bet:** the client should never hold 40k full cards. Three layers: (1) a **stub index** of all cards (~25–40MB: title, type, section, tags, refs/inbound-refs bitmasks, and a `filter_bits` bitmask precomputing all ~90 boolean card filters server-side), stored in a sharded `cardStubs` collection maintained by the existing `onDocumentWritten` trigger and streamed to the client via ~300-doc onSnapshot; (2) a **bounded hot set** of ~2–5k full cards (visible window + starred + reading list + concept cards + editor/author cards, LRU-evicted) — the only thing `selectCards` ever iterates; (3) a **permission-aware `searchCards` Cloud Function** running Firestore Enterprise Pipeline `arrayContainsAll` over the already-stored `nlp_search_tokens`, with per-user permission predicates injected server-side, returning IDs + scores only (content always fetched through rules-enforced SDK reads; the standard-Firestore rarest-token fallback is pre-designed into the same endpoint contract).

**Notable structural wins:** cold boot drops to seconds (~300 shard reads instead of 40k docs); the write trigger becomes a server-authoritative NLP backstop (fixes the old-client-poisoning hole for good); search-index freshness is transactional because `nlp_search_tokens` is written in the same batch as every save; thumbnails render from stubs; boolean/reference/date filters work corpus-wide off stubs without full cards.

**Honest weaknesses:** most moving parts (stub shards + versioning + backfill migration + rules for shard visibility + endpoint + Enterprise dependency); Enterprise Pipeline is in Preview (availability/pricing/lock-in risk — the spike answers it, and the fallback works on standard Firestore); unpublished stub visibility is global-permission-gated, so per-card author/editor visibility still needs the existing author/editor queries; the reducer-level identity bugs (§3) still need fixing anyway since the hot set is in Redux; word clouds/fingerprints over huge collections get capped.

---

## 5. Recommendation

**Do Plan A now, with Plan B as the pre-planned second act if — and only if — profiling shows the remaining pain is heap/GC or render fan-out rather than reducer/selector work. Park Plan C.**

Reasoning:

1. **Plan A's Stage 0–3 is mandatory under every strategy.** All three plans require the profiling baseline that has never been captured. And the reducer identity fixes (Stage 1) are needed even under Plan C (the hot set lives in Redux) and are not wasted under Plan B (Stages 1–2 of B reuse the same engine code A cleans up, and B's own Stage 0 needs A's instrumentation). There is no future in which fixing `makeFilterFromCards` is wrong.
2. **Plan A has the best expected value per day.** It is ~17 days against 28–37, targets four *named, code-verifiable* defects that plausibly explain the exact user-reported symptom (arrow-navigation slowness maps directly to `UPDATE_READS` → 125-map clone → Collection rebuild → tab counts), and every stage is independently shippable with a dev-mode equivalence assertion.
3. **The decision between "done" and "Plan B" becomes empirical instead of speculative.** After A's Stage 3 gate, re-run the interaction script. If budgets are met and tab memory is tolerable in practice on the user's actual machines, stop — goals 1, 2, 4, 5, 6 are met and goal 3 is partially met (Stage 5 recovers 100–200MB). If interaction budgets are met but memory is still unacceptable, or profiling shows GC pauses from the large heap are a first-order jank source, proceed to Plan B — whose worker migration then starts from a codebase where the engine (filters/collection/nlp) has already been identity-disciplined and instrumented.
4. **Plan C is parked, not rejected.** Its two cheapest stages are worth adopting independently at any point: (a) the server-authoritative NLP backstop in the write trigger (~3d, closes the old-client poisoning hole permanently), and (b) keeping `nlp_search_tokens` in Firestore documents (Plan A strips it from Redux only), which preserves the Enterprise Pipeline option recorded in April 2026. Full Plan C becomes the right answer if the corpus grows toward 100k+, if target devices can't afford a worker-resident corpus, or if cold boot is repromoted as a goal.

### Decision gates, explicitly

| Gate | Question | Evidence | Outcome |
|---|---|---|---|
| G0 (after A Stage 0, day ~2) | Does the profile confirm reducer/selector identity churn as the dominant interaction cost? | Dispatch histograms, `makeFilterFromCards` clone counts, `stateChanged` timings | Confirmed → continue A. Dominated by Lit render fan-out → still do A Stages 1–3 (shrinks changed-property fan-out) but add component-subscription narrowing to scope. Dominated by GC/heap → compress A (Stages 1, 3 only) and begin B's Stage 0 spike in parallel |
| G1 (after A Stage 3, day ~11) | Are interaction budgets met on the real corpus? | Re-run of the scripted interactions | Met → finish A Stages 4–6, ship, stop. Not met → the profile now shows exactly what's left; choose B (structural) with A's work carried forward |
| G2 (if B triggered) | Firestore-in-worker multi-tab persistence + index build benchmarks pass? | B's Stage-0 spike (3–4d, kill-switch) | Pass → execute B Stages 1–4. Fail → fall back to main-thread-listener-forwarding variant, or reopen Plan C |

### What gets deleted regardless of path

- `src/filter-classification.ts` + its test script + the `classification` getter on `CollectionDescription` (legacy server-narrowing, isolated, dead in the all-local runtime).
- Complete/partial mode remnants: `TURN_COMPLETE_MODE`, `completeMode`/`completeModeCardLimit` in `DataState`, `selectCardLimitReached`, `selectCompleteModeEffectiveCardLimit`, `DEFAULT_PARTIAL_MODE_CARD_FETCH_LIMIT`.
- Any remaining Enterprise/deep-fetch vestiges (grep-verified; most already removed).

### What must be preserved regardless of path

- Stored-NLP write paths (`nlp_tokens`, `nlp_search_tokens`, `nlp_version`, `nlp_source_fingerprint`) and the migration tool — they are the foundation for every search strategy on the table.
- The WeakMap `processCard` cache, generation guards on partitioned fetches, and all the component-level fixes from this branch (thumbnail highlight patching, deferred editor suggestions, closed-panel short-circuits, Collection final-array caching) — every plan builds on them.
- `PreparedQuery.cardScore` semantics — user-visible ranking must not change out from under the user.
- Published-only IDF generation (privacy fix) — and no derived server artifact may ever include unpublished vocabulary.

---

## 6. Roadmap summary

```
Week 1        Week 2         Week 3          Week 4+
├─ A0 profile ├─ A2 projections ├─ A4 boot     (only if G1 fails)
├─ A1 reducers│  A3 handoff ────┤  A5 memory   ├─ B0 worker spike (kill-switch)
│             │  [G1 gate] ─────┤  A6 delete   ├─ B1 ingestion → worker
[G0 gate]     │                 └─ ship        ├─ B2 shadow mode
                                               ├─ B3 cutover
                                               └─ B4 tune
```

- Plan A alone: **~17 engineer-days** to a shippable, measured resolution of goals 1, 2, 4, 5, 6 and partial 3.
- Plan A + Plan B (if gated in): **~45–54 engineer-days total**, resolving all goals including memory categorically.
- Optional orthogonal adds at any point: server-authoritative NLP backstop trigger (~3d, from Plan C).

---

## 7. Open questions for the user

1. **Profiling access:** Stage 0 needs runs against the production corpus as an admin on your actual machine(s). The interaction script will be runnable by you with results dumped to console if needed. Which machine(s) represent the target experience?
2. **Memory bar:** is ~400–600MB tab memory (Plan A end-state) acceptable in practice, or is the goal closer to Plan B's ~UI-thread-weightless model? This directly determines whether G1 success ends the project.
3. **`nlp_search_tokens` in Firestore:** keep (preserves the Enterprise Pipeline option; costs document size and IndexedDB) or drop after Plan A ships? Default: keep.
4. **Is the April 2026 Enterprise Pipeline decision still live**, or superseded by the all-cards-local pivot? This doc treats it as parked (Plan C).

---

## Appendix A: Interaction budgets (acceptance criteria)

| Interaction | Budget | Today (unmeasured; to be baselined in A0) |
|---|---|---|
| Arrow-key navigation (incl. auto-mark-read echo) | ≤16ms main-thread | Reported unacceptable |
| Editor open | ≤100ms | Improved on branch, unverified at 40k |
| Keystroke while editing | ≤16ms | Believed protected |
| Commit → interactive | ≤200ms | 50–200ms+ observable rebuilds |
| Remote echo (other user's edit) | ≤50ms | Unmeasured |
| Find-dialog query (after 250ms debounce) | ≤100ms to first results | Unmeasured at 40k |
| Zero active-collection refilters on membership-neutral updates | invariant | Currently violated |

## Appendix B: Source reports

The three research reports (master architecture map, branch archaeology/history-and-learnings, current-state audit) and the three full plans were produced by parallel sub-agent investigations on 2026-07-02 and are captured in the session records; this doc is their synthesis. Key prior docs: `docs/all-cards-local-branch-analysis.md` (ship blockers, 2026-05-02), `docs/all-cards-local-landing-plan.md` (completed optimization log, 2026-05-02).
