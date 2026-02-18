# Plan: Fix Broken Search + Revert Enterprise Firestore

## Context

Branch `implement/firestore-enterprise-phase-0` has a broken server-side search implementation (BRANCH-REVIEW Issue #2). The code at `src/filter-classification.ts:446-447` uses `where('nlp_tokens', 'regex_match', pattern)` which fails in three independent ways:

1. `regex_match` is a Pipeline API function, NOT a valid `where()` operator
2. `nlp_tokens` is a map field, not a string — `regex_match` requires strings
3. The regex pattern uses RE2-incompatible lookaheads (`(?=.*token)`)

The `@ts-ignore` hides the TypeScript error, and multiple try-catch layers silently swallow the runtime failure. The code has never successfully executed.

Additionally, Enterprise Firestore provides **zero realized benefit** — no Pipeline API calls, no vector search, no Enterprise-only features are used. Everything that works (long polling, NLP caching, 3-tier system) runs on Standard. The Enterprise migration adds cost and complexity for nothing.

**Goal**: Replace broken search with a working `array-contains` approach on Standard Firestore, and remove Enterprise infrastructure.

---

## Part 1: Search Rearchitecture

### New data field: `nlp_search_tokens: string[]`

Add a single new array field to each card containing **deduplicated stemmed unigrams + bigrams** from all indexed text fields. This enables `array-contains` queries for server-side narrowing.

Example for a card about "hill climbing algorithms":
```
nlp_search_tokens: ["hill", "climb", "algorithm", "hill climb", "climb algorithm", ...]
```

### Query flow

1. User searches "hill climbing" → stem to `["hill", "climb"]`, bigrams: `["hill climb"]`
2. Look up IDF for each token/bigram → `"hill climb"` is rarest
3. Server: `where('nlp_search_tokens', 'array-contains', 'hill climb')` → ~5-20 candidates
4. Client: Score candidates using existing `PreparedQuery.cardScore()` via `nlp_tokens` fast path (preserves full phrase/bigram/adjacency scoring)

### Files to modify

#### `shared/types.ts` (~line 522)
- [x] Add `nlp_search_tokens?: string[]` to `Card` interface

#### `src/filter-classification.ts`
- [x] **Lines 431-449**: Rewrite `buildQueryConstraints(queryString, serverIDF?)`:
  - Stem query tokens using `stemmedNormalizedWords(normalizedWords(queryString))` from `shared/nlp.ts`
  - Generate bigrams from stemmed tokens using existing `ngrams()` function
  - If `serverIDF` provided, select the token/bigram with highest IDF (rarest)
  - If no IDF, fall back to first non-stop-word token
  - Return `[where('nlp_search_tokens', 'array-contains', selectedToken)]`
  - Remove `@ts-ignore` and `escapeRegex` function
- [x] **Lines 326-328**: Add optional `serverIDF` parameter to `buildFirestoreConstraints()` and thread to `buildQueryConstraints()`
- [x] **Line 180**: Add optional `serverIDF` parameter to `classifyCollectionDescription()` and thread through

#### `src/actions/collection.ts` (~line 676-691)
- [x] In `deepFetchForActiveCollection`, bypass the `classification` getter — call `classifyCollectionDescription()` directly with IDF context:
  ```typescript
  const state = getState();
  const serverIDF = selectServerIDF(state);
  const classification = classifyCollectionDescription(fetchDescription, serverIDF);
  ```
- [x] This gives the constraint builder access to IDF for optimal token selection
- [x] Existing callers of `.classification` getter still work (without IDF optimization)

#### `src/actions/data.ts` (~lines 465-502)
- [x] After generating `nlpTokens`, also generate `nlp_search_tokens`:
  - Extract all unique stemmed words from `nlpTokens[field][].stemmed` across all fields
  - Generate bigrams using `ngrams(stemmedText, 2)` from `shared/nlp.ts`
  - Deduplicate with a `Set`
  - Add `cardUpdateObject.nlp_search_tokens = Array.from(searchTokens)`
- [x] Also: hash `nlp_fingerprint` instead of storing raw text (replace ~750 bytes with ~64-byte hash)

#### `tools/migrate-nlp-tokens.mjs` (~lines 185-212)
- [x] Add `nlp_search_tokens` generation to the migration batch update
- [x] Same logic as data.ts: extract unique stemmed tokens + bigrams per card

#### `firestore.indexes.json`
- [x] Add composite index for `nlp_search_tokens` with `arrayConfig: "CONTAINS"` + `sort_order`
- [x] Remove old `nlp_tokens` ascending index (no longer used for queries)

#### `test/filter-classification/test.js`
- [x] Update test at line 71-77: `query` filter should now be classified as SIMPLE (not COMPLEX)
- [x] Add test that `buildQueryConstraints` produces a valid `array-contains` constraint
- [x] Add test for IDF-based token selection

### Why `nlp_tokens` is still needed (verified)

The `nlp_tokens` field stores per-field, per-run NLP data. It cannot be replaced by `nlp_search_tokens`:

- **Client-side search scoring** (`src/nlp.ts:740` `PreparedQuery.cardScore()`) uses per-field stemmed text for phrase matching. Title matches are weighted differently than body matches — this requires the per-field structure.
- **Performance**: Without `nlp_tokens`, every card access recomputes NLP from raw text (~5-50ms/card). The fast path at `src/selectors.ts:394` skips this by reading stored tokens.
- **Semantic analysis** (`src/nlp.ts:906` `wordCountsForSemantics()`) uses per-run `withoutStopWords` for fingerprinting and TF-IDF.
- The `original` field is already NOT stored (only `normalized`, `stemmed`, `withoutStopWords`).

`nlp_search_tokens` is a **flat deduplicated array** for server-side `array-contains` queries. `nlp_tokens` is a **structured map** for client-side scoring. They serve different purposes and both are needed.

### Key functions to reuse (already exist)
- `ngrams(text, size)` — `shared/nlp.ts:331` — bigram generation
- `stemmedNormalizedWords()` — `shared/nlp.ts:197` — stem query input
- `normalizedWords()` — `shared/nlp.ts:168` — normalize query input
- `selectServerIDF` — `src/selectors.ts:848` — access IDF map from state
- `cardWithNormalizedTextPropertiesFast` — `src/selectors.ts:394` — client-side scoring from `nlp_tokens`
- `STOP_WORDS` — `shared/nlp.ts:47` — filter out common words

---

## Part 2: Enterprise Firestore Revert

Remove all Enterprise-specific infrastructure. Standard Firestore supports everything we need.

### Files to modify

#### `src/firebase.ts`
- [x] Remove `FIRESTORE_DATABASE_ID_DEV/PROD` imports and databaseId selection logic (~lines 34-66)
- [x] Simplify `initializeFirestore()` call — remove third `databaseId` argument (~line 78)
- [x] Remove deprecation warnings and debug logging

#### `tools/config.ts`
- [x] Remove `getFirestoreDatabaseId()` function (~lines 17-25)
- [x] Remove `validateConfig()` function and calls (~lines 33-61)
- [x] Hardcode database IDs to `'(default)'` (~lines 94-95)

#### `tools/types.ts`
- [x] Remove `use_legacy_firestore` field from `ModeConfig` interface (~lines 62-71)

#### `tools/env.ts`
- [x] Hardcode database ID to `'(default)'` (~line 55-56)

#### `functions/src/common.ts`
- [x] Remove databaseId logic and deprecation warnings (~lines 67-87)
- [x] Simplify to `export const db = getFirestore()`

#### `gulpfile.mjs`
- [x] Remove `getFirestoreDatabaseId()` duplicate (~lines 32-40)
- [x] Remove `databaseFlag` conditional logic (~lines 446-447, 721)
- [x] Remove `--database` flags from deploy commands (~lines 484, 489)
- [x] Remove deprecation warnings (~lines 79-85, 635-639)
- [x] Simplify backup/restore — remove `--database=` params (~lines 533, 584)
- [x] Remove `functions:config:set` database ID (~line 641)
- [x] Remove entire Enterprise migration section: `checkDatabaseExists`, `waitForOperation`, `migrate-to-enterprise` (~lines 815-1011)
- [x] Simplify `verify-functions-config` — remove database checks (~lines 655-691)
- [x] Simplify `set-up-deploy` — remove databaseFlag (~line 727)

#### `functions/src/index.ts`
- [x] **Lines 184-200**: Health endpoint — remove `database` object or simplify
- [x] Triggers — verify they work with `(default)` after revert

#### `shared/env-constants.ts`
- [x] Remove `FIRESTORE_DATABASE_ID_VAR` export (~line 16)
- [x] Update imports in `functions/src/common.ts` and `functions/src/index.ts`

#### `README.md`
- [x] Remove Enterprise setup instructions (~lines 34-43, 95-112, 129-136)
- [x] Replace with Standard-only guidance

#### `.vscode/config_schema.json`
- [x] Remove `use_legacy_firestore` field definitions (~lines 489-491, 662-664, 835-837)

#### `config.SAMPLE.json`
- [x] Ensure no `use_legacy_firestore` field present

#### Files to delete
- [x] `ENTERPRISE_MIGRATION.md`
- [x] `tools/verify-migration.mjs`

#### `config.SECRET.json`
- [x] Remove `use_legacy_firestore: true` from dev config

---

## Part 3: Collateral Issue Fixes

These issues are automatically fixed or trivially fixed alongside the main changes:

| Issue | Fix | How |
|-------|-----|-----|
| #1 (triggers missing database) | Auto-fixed by reverting to `(default)` | Triggers default to `(default)` — no param needed |
| #3 (orphaned `== null`) | Change to `where('section', '==', '')` | 1-line fix in `filter-classification.ts:391` |
| #4 (main `!= null`) | Change to `where('section', '!=', '')` | 1-line fix in `filter-classification.ts:420` |
| #6 (broken import) | Delete `verify-migration.mjs` | Part of Enterprise revert |
| #8 (inverted config default) | Remove `use_legacy_firestore` entirely | Part of Enterprise revert |
| #14 (dead functions:config:set) | Remove database ID from config command | Part of gulpfile cleanup |
| #32 (duplicated getFirestoreDatabaseId) | Remove all 3 copies | Part of Enterprise revert |
| #33 (waitForOperation bug) | Remove entire migration section | Part of Enterprise revert |

---

## Verification

1. **Build**: `npm run build` — no TypeScript errors
2. **Tests**: `npm test` — filter-classification tests pass (updated expectations)
3. **Migration**: Run `node tools/migrate-nlp-tokens.mjs --dry-run` — verify `nlp_search_tokens` generation
4. **Config generation**: `npm run generate:config && npm run generate:env` — verify `(default)` database IDs
5. **Manual**: Deploy to dev, type a search query, verify:
   - Console shows no regex_match errors
   - Deep fetch returns candidate cards
   - Search results are correctly ranked (phrase matches score higher)
6. **Index deployment**: `firebase deploy --only firestore` — new `nlp_search_tokens` array index created
