# All-Cards-Local Branch Analysis

Branch reviewed: `experiment/all-cards-local`

Base used for comparison: `origin/master`

Date: 2026-05-02

## Recommendation

Do not ship this branch as-is.

The final all-cards-client-side direction is architecturally plausible and worth continuing, but it is not proven shippable. This analysis is based on code review and targeted tests, not browser profiling with a realistic 40k-card local cache. The branch has the right high-level optimization: keep all raw cards local, avoid full NLP recomputation for unchanged cards, and lazily enrich concepts/synonyms only where needed. That is promising, but several correctness and privacy issues are ship blockers, and the important interaction paths remain unmeasured.

Ship readiness blockers:

- Stored NLP loses some reference-derived searchable fields for migrated/current-version tokenized cards.
- Stored NLP can become stale or arbitrary because rules do not tie content changes to NLP fields.
- Public IDF maps can leak unpublished/private vocabulary and are wired into deploy/startup paths.
- One-card updates still invalidate large selector graphs and may rebuild/filter active collections.
- Opening the editor now waits on a `getDoc` before showing the editor.
- The old complete/partial mode UI still exists, but the fetch behavior is gone.
- Full unpublished `getDocs` partition work can apply stale results after auth/permission changes.
- Several write paths create or mutate cards without refreshing stored NLP.

## What The Final Approach Does

The branch removes the 3-tier hot/deep-fetch system and loads all unpublished cards for users who may view unpublished cards.

- Published cards still come from a live `onSnapshot` query.
- Privileged unpublished access starts five parallel `getDocs` document-ID partitions, dispatches each partition into Redux, and then attaches a full unpublished live listener.
- Non-privileged users still subscribe only to unpublished cards authored by them or explicitly editable by them, but those author/editor queries are no longer limited by partial mode.

Relevant code:

- `src/actions/database.ts:360` connects published cards.
- `src/actions/database.ts:408` connects unpublished cards.
- `src/actions/database.ts:462` starts partitioned unpublished `getDocs`.
- `src/actions/database.ts:496` attaches the full unpublished listener.

The key selector change is in `src/selectors.ts`:

- `selectCards` now iterates all raw cards and uses a `WeakMap<Card, ProcessedCard>` cache keyed by raw card object identity.
- Cards with current `nlp_tokens` use a stored-token fast path.
- Concepts and synonyms are no longer baked into every processed card. They are lazily added for the active card and fingerprinting consumers.

Relevant code:

- `src/selectors.ts:383` defines the processed-card `WeakMap`.
- `src/selectors.ts:400` takes the stored-token fast path.
- `src/selectors.ts:442` rebuilds the processed-card map by iterating raw cards.
- `src/selectors.ts:484` enriches only the active card.
- `src/nlp.ts:485` implements lazy concept/synonym enrichment.

This is the central improvement: one card change no longer implies full NLP recomputation for 40k cards. It still implies iterating 40k cards and returning a new `selectCards` object when the raw cards object changes, so downstream selector cost is still unresolved.

## Interaction Performance

### Cold Boot

Cold boot is intentionally heavy and you said it matters least. The branch tries to reduce wall-clock time with parallel partitioned `getDocs`, but it still downloads a large Firestore dataset and populates Redux/IndexedDB.

The bigger correctness risk is stale work. The partitioned `getDocs` calls are promises, not listeners, so `disconnectLiveUnpublishedCards()` cannot cancel them. If auth or permissions change while the partitions are in flight, an older request can still dispatch cards and later attach a listener.

Relevant code:

- `src/actions/database.ts:414` disconnects existing listeners.
- `src/actions/database.ts:462` starts uncancelable partition promises.
- `src/actions/database.ts:496` attaches the listener after awaiting partitions.

### Navigating Up/Down In Card Lists

This is probably a cached O(collection size) scan per navigation, not a full refilter/resort per keypress. That may be acceptable, but it is unmeasured and sits directly on the keypress path.

Navigation uses the active collection array, maps it to IDs, and calls `indexOf`.

Relevant code:

- `src/actions/app.ts:158` uses active collection navigation.
- `src/selectors.ts:1798` returns `selectActiveCollectionCards`.
- `src/selectors.ts:1803` computes the index with `collection.map(card => card.id).indexOf(cardId)`.

Before shipping, replace this with a memoized card ID to index map and profile navigation with large collections.

### Opening Cards For Editing

This is a clear regression from `origin/master`.

`editingStart` now awaits a fresh `getDoc` before dispatching `EDITING_START`, so opening the editor can block on network/cache latency. If the fetched card materially differs, `receiveCards` can dispatch a global card update before the editor opens.

Nuance: `receiveCards` dedupes with `deepEqualIgnoringTimestamps`, so the global invalidation only happens if the fetched card differs materially. The single-card edit listener installed afterward updates editor underlying-card state, not the global card map.

Relevant code:

- `src/actions/editor.ts:279` starts `editingStart`.
- `src/actions/editor.ts:297` awaits `getDoc`.
- `src/actions/editor.ts:300` dispatches `receiveCards`.
- `src/actions/data.ts:1443` dedupes received cards.
- `src/actions/editor.ts:317` attaches the editor-only live listener.

The safer shape is to open from local state immediately, then refresh/reconcile asynchronously.

### Typing In An Editing Card

The keystroke path is mostly protected.

Typing updates editor state. Expensive normalized NLP work is delayed until `EDITING_PROCESS_NORMALIZED_TEXT_PROPERTIES`, so full NLP is not recomputed on every keystroke.

Relevant code:

- `src/actions/editor.ts:448` updates editing fields.
- `src/actions/editor.ts:482` schedules delayed normalized-text processing.
- `src/selectors.ts:871` memoizes `selectEditingNormalizedCard` behind the extraction version.
- `src/selectors.ts:907` merges the latest editing card with delayed NLP.

The delayed path still needs profiling. After the debounce, `selectEditingNormalizedCard` can run full NLP with concepts/synonyms, and editor suggestions/fingerprints can touch broader semantic machinery.

Relevant code:

- `src/selectors.ts:880` computes the normalized editing card.
- `src/selectors.ts:958` computes editing-card semantic fingerprint.
- `src/selectors.ts:964` computes suggested concept references.
- `src/selectors.ts:975` computes suggested tags.

### Committing An Editable Card

The added save-time NLP generation is probably not the main cost by itself because it processes one edited card. But commit is not only per-card NLP.

The save path runs finishers/diff generation before writing. Existing finishers can call `selectCards`, concept lookup, and fingerprinting. That is not new in this branch, but all-cards-local increases the size of data those paths can see.

Relevant code:

- `src/actions/data.ts:407` calls `generateFinalCardDiff`.
- `src/card_finishers.ts:37` uses `selectCards` and concept matching.
- `src/actions/data.ts:423` detects content-field changes for NLP generation.
- `src/actions/data.ts:468` writes `nlp_tokens`, `nlp_search_tokens`, and `nlp_version`.

The post-commit snapshot echo is the larger risk. Any non-empty `UPDATE_CARDS` replaces `state.data.cards` identity, causing `selectCards` to iterate all raw cards and return a new object. Components such as `card-view` call many selectors on Redux updates. Some selector paths can force active collection filtering through drawer visibility and fallback checks.

Relevant code:

- `src/reducers/data.ts:135` handles `UPDATE_CARDS`.
- `src/selectors.ts:442` rebuilds the processed-card map.
- `src/selectors.ts:1467` rebuilds the everything set from `selectCards`.
- `src/selectors.ts:1600` rebuilds collection constructor arguments from `selectCards`.
- `src/components/card-view.ts:846` calls many selectors during `stateChanged`.
- `src/selectors.ts:1789` computes drawer visibility from `selectActiveCollection`.
- `src/collection_description.ts:799` forces filtering for `Collection.isFallback`.

This needs browser profiling before the approach can be called viable.

## Behavior Lost Or At Risk

### Stored NLP Loses Some Reference-Derived Search

This is the main behavior regression.

On `origin/master`, processed cards were computed client-side with fallback text available to override extractors. In this branch, cards with current `nlp_tokens` use the fast path and rebuild NLP only from stored normalized runs. Save-time NLP generation passes empty fallback/concept/synonym maps, and the shared migration NLP skips override extractors.

The affected fields are specifically override-extractor fields such as:

- `non_link_references`
- `concept_references`

These can include reference labels and fallback/backported titles that are not explicit text on the card. Searches and concept logic that depend on those runs can stop matching migrated/current-version tokenized cards.

Relevant code:

- `src/nlp.ts:370` defines the client override extractors.
- `src/nlp.ts:397` uses override extractors in full client NLP.
- `src/selectors.ts:400` uses the stored-token fast path.
- `src/actions/data.ts:431` generates save-time NLP with empty fallback/concept/synonym maps.
- `shared/nlp.ts:260` skips override extractors in shared/server NLP.
- `tools/migrate-nlp-tokens.mjs:178` uses the simplified shared NLP path.

Important correction: `references_info_inbound` is not an override-extractor field. Existing `references_info_inbound` object text should be indexed by the migration. The risk for that field is staleness after later inbound-reference mutations, not initial migration omission.

Relevant code:

- `shared/card_fields.ts:496` configures `references_info_inbound`.
- `shared/card_fields.ts:510` configures `non_link_references`.
- `shared/nlp.ts:260` skips only override extractors.

### Reference-Derived Stored NLP Can Become Stale

Edits, forks, and deletes can update inbound reference data on target cards without recomputing target-card stored NLP. If those target cards have current `nlp_tokens`, the fast path can continue using stale inbound-derived runs.

Relevant code:

- `src/actions/data.ts:431` recomputes tokens only for the edited card.
- `src/actions/data.ts:483` writes inbound updates to other cards.
- `src/actions/data.ts:1228` forks a card and writes inbound updates.
- `src/actions/data.ts:1306` deletes a card and removes inbound references.

### Stored NLP Can Be Stale Or Poisoned By Older Clients

Firestore rules do not require content edits to update `nlp_tokens` or `nlp_version`, and the fast path trusts current-version stored tokens. If an older deployed client edits `title`, `body`, references, or other searchable fields after migration, the visible card content can change while stored NLP remains current-version and stale.

Similarly, any user who can edit a card can write arbitrary NLP fields unless rules or server-side validation prevent it. That does not appear to bypass read permissions, but it can poison search/fingerprint behavior for other users.

Relevant code:

- `firestore.TEMPLATE.rules:257` defines card update rules without NLP/content consistency checks.
- `src/selectors.ts:400` trusts current-version stored NLP.

### Fast Path May Produce Partial `nlp` Objects

The full NLP path initializes every `CardFieldType` to an array. The stored-token fast path only adds fields present in `card.nlp_tokens`. Query paths often guard missing fields, but other code may assume fields such as `concept_references` exist as arrays.

Relevant code:

- `src/selectors.ts:402` builds `nlp` only from stored entries.
- `src/nlp.ts:473` full NLP initializes every field.
- `src/nlp.ts:1253` assumes `cardObj.nlp.concept_references.map(...)`.

This should either be normalized in the fast path or audited thoroughly.

### Partial/Performance Mode Is Gone But Still Shown

The branch always loads all unpublished cards for users who may view unpublished. It also loads full author/editor unpublished sets for non-privileged users. The old partial/complete-mode state and UI remain, but toggling them no longer changes what is fetched.

Impact: the UI can claim "Showing only recent cards" or "performance mode" while the app has already fetched all matching unpublished cards.

Relevant code:

- `src/actions/database.ts:420` always chooses all unpublished cards for privileged users.
- `src/actions/database.ts:503` loads full author/editor unpublished sets for non-privileged users.
- `src/components/limit-warning.ts:100` still describes partial unpublished behavior.
- `src/reducers/data.ts:112` still stores complete-mode state.

This is either dead UI to remove or a product decision to reverse.

### New Cards May Lack Stored NLP

The edit path writes stored NLP fields, but several create/write paths write raw card objects. Locally, missing current `nlp_tokens` means the card takes the slow path, so this is not immediately an all-local search correctness bug. It is a readiness/performance risk and a future-server-query correctness risk.

Subtle behavior risk: a newly created card without tokens may initially search correctly via the slow path, then become lossy after an edit writes current-version tokens generated without fallback text.

Relevant code:

- `src/actions/data.ts:775` creates tag/start-card style objects.
- `src/actions/data.ts:880` bulk import writes raw objects.
- `src/actions/data.ts:1089` create writes the raw object.
- `src/actions/data.ts:1228` fork writes the raw new card.
- `src/actions/maintenance.ts:265` maintenance/setup writes cards.

### Query Matching Is Still Client-Side Once Cards Are Loaded

Normal query filters still do final scoring client-side through `PreparedQuery.cardScore`. The branch does not appear to make loaded-card query matching depend on Firestore Enterprise or `nlp_search_tokens`.

Relevant code:

- `src/filters.ts:874` uses query scoring.
- `src/nlp.ts:600` scores cards from `card.nlp`.

Important nuance: normal query matching did not appear synonym-expanded before. Concepts and synonyms matter for semantic fingerprints, concept highlighting, word clouds, suggested concepts, and similar/related ranking paths, not direct text query synonym matching.

### Server-Side Query Work Looks Vestigial

The branch still has filter classification and Firestore query constraints for `nlp_search_tokens`, but the final all-local fetch path appears not to consume those constraints.

Relevant code:

- `src/filter-classification.ts:445` builds query constraints.
- `src/collection_description.ts:321` exposes classification but does not pass `serverIDF`.
- `src/actions/database.ts:441` loads all unpublished cards without collection-specific constraints.

This is not necessarily user-visible now, but it is confusing and creates maintenance risk.

## Privacy And Data Readiness

### Public IDF Map Leaks Private Vocabulary

This is a ship blocker.

> **RESOLVED 2026-08-15, by deletion.** Everything named below is gone: the
> `calculateIDF` function, `functions/src/idf.ts`, the public-read `idf-maps`
> storage rule, `src/idf-cache.ts`, the `server_idf_cache` localStorage entry
> and the whole Redux/protocol plumbing. Fingerprint rarity is now computed in
> the corpus worker over the cards the viewer can actually see, so the scope is
> structural rather than filtered (docs/visible-corpus-idf-design.md), and
> `test/idf-index` pins the deletion. The one step no repo state can prove:
> `firebase functions:delete calculateIDF` on BOTH projects — omitting an
> export does not undeploy the live copy. The rest of this section is kept as
> the record of what the hazard was.

`calculateIDF` fetches all cards, filters only to body card types, and writes every term to Cloud Storage. Storage rules make `idf-maps/*` public. This is not merely hypothetical: the function is exported for deployment, deploy tooling includes functions, and the app loads `idf-maps/latest.json` during startup.

Impact: unpublished/private card vocabulary can leak through public IDF JSON.

Relevant code:

- `functions/src/idf.ts:45` fetches all cards.
- `functions/src/idf.ts:50` filters only by body card type.
- `functions/src/idf.ts:83` uploads the IDF JSON.
- `storage.rules:17` makes IDF maps publicly readable.
- `functions/src/index.ts:179` exports `calculateIDF`.
- `tools/deploy-firebase.ts:10` includes functions deployment.
- `src/components/main-view.ts:431` loads server IDF on startup.
- `src/idf-cache.ts:45` fetches `idf-maps/latest.json`.

### Lazy `require('jsdom')` Is A Runtime Risk Under ESM

`functions/package.json` is `type: module`, but the branch uses lazy `require('jsdom')` in function code. TypeScript may pass, but Node ESM does not define `require` unless explicitly created.

Relevant code:

- `functions/src/idf.ts:29`
- `functions/src/embeddings.ts`
- `functions/package.json`

### Migration Leaves Some Cards Unversioned

The migration skips cards without `title`, `body`, or `commentary`, so those cards never get `nlp_version`. They will always take the slow client path even if the correct current-version representation is intentionally empty NLP.

Relevant code:

- `tools/migrate-nlp-tokens.mjs:171`

### Rules Compatibility Is Technically Fine But Semantically Risky

Existing optional fields mean older documents can still load via the slow path, and old clients are not blocked by the schema change. That compatibility is useful, but it also means the app cannot rely on stored NLP being present, fresh, or honest.

Before shipping stored NLP as trusted client input, either:

- make it server-generated and protected,
- make rules enforce consistency/versioning enough to be meaningful,
- or treat stored NLP as an opportunistic cache and detect stale/missing fields robustly.

## What Is Preserved

The branch preserves the broad client-side collection/filter architecture once cards are local. Complex filters such as references, concept filters, selected/read/starred, and related collection behavior still run through client collection/filter machinery rather than requiring Firestore Enterprise.

Active-card concept highlighting was restored via lazy enrichment:

- `src/selectors.ts:484` defines `selectActiveCardEnriched`.
- `src/nlp.ts:485` defines `enrichCardWithConcepts`.
- `src/components/card-view.ts` uses the enriched active card for display.

The branch also addresses the worst prior selector cost: concepts/synonyms no longer force every card to be reprocessed on ordinary updates. That is a necessary improvement, but not sufficient proof that all warm interaction paths are fast.

## Suggested Ship Criteria

Before shipping this approach:

1. Fix stored NLP semantics for `non_link_references` and `concept_references`, including fallback/backported labels.
2. Ensure inbound-reference updates, forks, and deletes refresh affected target-card stored NLP or make those fields computed locally.
3. Normalize fast-path `nlp` shape so all expected fields exist as arrays.
4. Generate or refresh stored NLP on all write paths, including create, bulk import, fork, tag/start-card creation, maintenance writes, edit, and delete side effects.
5. Prevent old clients or permissive rules from leaving current-version NLP stale or arbitrary.
6. Remove, hide, or restore partial/performance mode so UI matches actual fetch behavior.
7. Prevent stale partitioned `getDocs` results/listeners from applying after auth or permission changes.
8. Change editor open to show immediately from local state, then refresh/reconcile in the background.
9. Add a memoized active-collection ID index for next/previous navigation.
10. Profile navigation, editor open, delayed typing enrichment, commit, and snapshot echo with a realistic 40k-card cache.
11. Make IDF generation private/scope-aware or remove it from deploy/startup. If retained, fix ESM lazy imports.
12. Delete or clearly isolate vestigial Firestore Enterprise/deep-fetch/query-classification code that is no longer part of the shipped architecture.

## Verification Performed

Read-only investigation covered the branch diff, key selectors, card fetch paths, editor actions, stored NLP generation, migration tooling, Cloud Function IDF generation, storage rules, and follow-up critique from three sub-agents.

I attempted the full test script, but it stopped before running the suite because local Firebase tooling requires Java 21. Sub-agents independently ran targeted non-Firestore tests successfully:

- `npm run test:filter-classification`
- `npm run test:shared-nlp`
- `npm run test:util`

No application code was changed for this analysis.
