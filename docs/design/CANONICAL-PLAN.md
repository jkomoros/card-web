# Card-Web: Canonical Implementation Plan v2.3
## NLP-Stored 3-Tier Hot System with Firestore Enterprise Integration

**Last Updated:** 2026-01-26
**Status:** Active Plan of Record

---

## Executive Summary

This is the **canonical plan of record** for card-web's architecture upgrade to handle 30,000+ cards with full-text search across the entire corpus. This plan replaces all previous approaches and incorporates all recent design decisions.

**Core Innovation:** Store complete NLP (Natural Language Processing) data directly on card documents, computed client-side on save. This enables Firestore Enterprise Pipeline Operations to perform full-text search server-side while maintaining excellent save performance.

### Key Features

1. **3-Tier Hot System**: Published (~900) + Prioritized (~6k) + Recent (fill to limit)
2. **NLP Data Storage**: All NLP properties stored ON cards (not computed locally)
3. **Client-Side NLP Computation**: Trusted client computes on save (NO Cloud Functions)
4. **Server IDF Map**: Global IDF baseline for consistent TF-IDF calculations
5. **Simple vs Complex Collections**: Server-side counts and pagination where possible
6. **Similarity Server-Side**: Already using Qdrant embeddings (not TF-IDF)
7. **Real-Time Conflict Detection**: onSnapshot for non-hot cards during editing

### Metrics

- **Total Code**: ~2,400 LOC (net change across 24 files)
- **Storage Cost**: +$0.10/month (NLP data overhead)
- **Performance**: 95% reduction in client-side NLP computation time
- **Search**: Full-text search across ALL 30k cards (not just hot 5k)
- **Save Performance**: NO regression (100-300ms maintained)

---

## 🆕 Firestore Enterprise Edition - Critical Context

**THIS PLAN REQUIRES FIRESTORE ENTERPRISE EDITION (January 2026)**

This architecture leverages **Firestore Enterprise**, which became Generally Available in January 2026. Enterprise Edition provides **100+ new server-side query capabilities** that Standard Firestore does not support.

### Key Enterprise Capabilities Used in This Plan

**1. Pipeline Operations** - Server-side query engine with:
- `where()` with regex, string matching, complex expressions
- `select()` for field projection (fetch only specific fields, not full documents)
- `unnest()` for array operations
- `mapGet()` for nested object access
- Server-side aggregations, grouping, sorting
- 60-second timeout, 128 MiB memory limit per query

**2. Field Selection** (`select()` stage):
```javascript
// ENTERPRISE: Fetch only specific fields
db.pipeline()
  .collection("/cards")
  .where(regex_match(field("nlp_tokens"), "machine.*learning"))
  .select("id", "name", "section")  // Only fetch these fields
  .execute();
```

**Benefits:**
- ✅ Reduced network transfer (smaller payloads)
- ✅ Improved latency (less data to transmit)
- ✅ Lower costs with covered queries (reading from index only)
- ❌ Read unit charges still apply (unless using covered queries)

**3. Advanced Text Search** (not possible in Standard Firestore):
- `regex_match()` for pattern matching against stored NLP tokens
- `str_contains()` for substring search
- Server-side execution across ALL 30k+ cards without client-side download

**4. Optional Indexing** - Queries work WITHOUT indexes:
- Standard Firestore: Query fails if index doesn't exist
- Enterprise Edition: Query runs (slower) without index, fast with index
- Enables iterative development without upfront index planning

### Standard Firestore vs Enterprise Edition

| Capability | Standard Firestore | Firestore Enterprise |
|------------|-------------------|---------------------|
| **Field projection** | ❌ Always fetch full document | ✅ `select()` stage |
| **Text search** | ❌ Client-side only | ✅ `regex_match()`, `str_contains()` |
| **Complex filtering** | ❌ Basic comparisons only | ✅ 100+ pipeline operations |
| **Query without index** | ❌ Hard failure | ✅ Runs (with performance penalty) |
| **Real-time sync** | ✅ `onSnapshot()` | ❌ Not supported (snapshot-in-time only) |

**Critical Distinction:** Pipeline Operations provide **snapshot-in-time queries** (no real-time sync). This plan uses BOTH:
- **Standard Firestore queries** (`onSnapshot`) for hot-tier real-time updates
- **Enterprise Pipeline Operations** for server-side full-corpus search

### Why This Matters for This Plan

**Section 4 (Simple vs Complex Collections)** depends on Enterprise capabilities:
- Server-side text search: `regex_match(field("nlp_tokens"), pattern)`
- Field projection: Fetch counts/IDs without full documents (with covered queries)
- Complex filtering: Date ranges, author filters, section/tag combinations

**Without Firestore Enterprise**, most filters would remain client-side only (~60% of filter types), limiting search to the 5k-card hot tier.

**With Firestore Enterprise**, ~40% of filters become server-side capable, enabling search across the entire 30k+ card corpus.

### Pricing Model

- **Unit-based pricing**: Per 4 KiB read, 1 KiB write
- **Pipeline operations**: Separate from standard operations
- **Covered queries**: Significantly cheaper (reading from index only)
- **Estimated monthly cost**: ~$11-270/month depending on cache hit rate (see Section 10)

**Documentation:**
- [Firestore Enterprise Overview](https://firebase.google.com/docs/firestore/editions)
- [Pipeline Operations](https://docs.cloud.google.com/firestore/native/docs/pipeline/overview)
- [Select Stage](https://firebase.google.com/docs/firestore/pipelines/stages/transformation/select)
- [Optimize Performance](https://firebase.google.com/docs/firestore/pipelines/enterprise-optimize-query-performance)

---

## Table of Contents

1. [3-Tier Hot System](#1-3-tier-hot-system)
2. [NLP Data Storage on Cards](#2-nlp-data-storage-on-cards)
3. [Server IDF Map](#3-server-idf-map)
4. [Simple vs Complex Collections](#4-simple-vs-complex-collections)
5. [Similarity Integration](#5-similarity-integration)
6. [Real-Time Editing Conflicts](#6-real-time-editing-conflicts)
7. [Implementation Roadmap](#7-implementation-roadmap)
8. [Migration Strategy](#8-migration-strategy)
9. [Testing Strategy](#9-testing-strategy)
10. [Cost Analysis](#10-cost-analysis)
11. [Critical Files Reference](#11-critical-files-reference)

---

## 1. 3-Tier Hot System

### 1.1 Architecture

Replace the current 2-tier system (published + unpublished-with-limit) with a 3-tier approach:

**Tier 1: Published Cards** (~900 cards)
- Query: `where('published', '==', true)`
- FetchType: `'published'` (no change)
- Priority: Highest - always loaded first
- Real-time: onSnapshot listener

**Tier 2: Prioritized Unpublished Cards** (~6,000 cards)
- Query: `where('published', '==', false) AND where('auto_todo_overrides.prioritized', '==', false)`
- FetchType: `'unpublished-prioritized'` (NEW)
- Logic: `auto_todo_overrides.prioritized === false` means card IS prioritized (backwards logic)
- Priority: Second - loaded after published
- Real-time: onSnapshot listener

**Tier 3: Recent Unpublished Cards** (fill to limit, ~0-100 cards typically)
- Query: `where('published', '==', false) AND where('auto_todo_overrides.prioritized', '==', true) ORDER BY created DESC LIMIT(remaining)`
- FetchType: `'unpublished-recent'` (NEW)
- Logic: `auto_todo_overrides.prioritized === true` means card is explicitly NOT prioritized
- Note: Cards with `undefined` prioritized field are NOT matched by this query (neither tier 2 nor tier 3)
- Dynamic Limit: `Math.max(0, effectiveLimit - publishedCount - prioritizedCount)`
- Priority: Lowest - loaded last
- Real-time: onSnapshot listener

### 1.2 Prioritized Cards Logic (CRITICAL - FINICKY)

**The Backwards Logic:**

```typescript
// From /src/util.ts:175-181
export const cardIsPrioritized = (card : Card | null) : boolean => {
	if (!card) return false;
	if (card.auto_todo_overrides.prioritized === false) return true;  // KEY: false = prioritized
	return false;
};
```

**Three-State System:**
- `undefined` (missing): Card is NOT prioritized (default) - **NOT matched by either Tier 2 or Tier 3**
- `true`: Card is explicitly NOT prioritized (override to "done") - **Matched by Tier 3**
- `false`: Card IS prioritized (override to "not done") - **Matched by Tier 2**

**CRITICAL QUERY LOGIC:**
- Tier 2 query `where('auto_todo_overrides.prioritized', '==', false)` matches ONLY cards with explicit `false` value
- Tier 3 query `where('auto_todo_overrides.prioritized', '==', true)` matches ONLY cards with explicit `true` value
- Cards with `undefined` prioritized are NOT loaded in either tier (will be in discovered tier only)
- This is intentional: 3-tier system loads published + explicitly prioritized + explicitly deprioritized cards

**Why it's backwards:** Historical maintenance task flipped all boolean values. Code uses `cardIsPrioritized()` helper everywhere to abstract this.

### 1.3 Dynamic Limit Calculation

**How effectiveLimit is determined:**
The `selectCompleteModeEffectiveCardLimit()` selector calculates:
```typescript
// From src/selectors.ts
effectiveLimit = state.data.completeModeCardLimit || DEFAULT_CARD_LIMIT
// DEFAULT_CARD_LIMIT is typically 5000-7000
```

**Tier 3 dynamic limit calculation:**
```typescript
// In connectLiveUnpublishedCards()
const effectiveLimit = selectCompleteModeEffectiveCardLimit(state);
// Tier 3 receives the FULL limit initially, then culling handles overflow

// After all tiers load, cullExtraCompleteModeCards() runs:
const publishedCount = publishedCards.length;        // ~900
const prioritizedCount = prioritizedCards.length;    // ~6000
const remainingSlots = Math.max(0, effectiveLimit - publishedCount - prioritizedCount);
// remainingSlots = 7000 - 900 - 6000 = 100

// Cull Tier 3 cards beyond remainingSlots
if (recentCards.length > remainingSlots) {
    cullCards(recentCards.slice(remainingSlots));
}
```

**Important:** Tier 3 query initially fetches `limit(effectiveLimit)` cards, but culling later reduces it based on actual Tier 1 + Tier 2 counts. This is more efficient than trying to coordinate counts dynamically in the query.

### 1.4 Implementation

**File: `/src/types.ts`** - Add new CardFetchType values:
```typescript
const _cardFetchTypeSchema = z.enum([
    'published',
    'unpublished-prioritized',  // NEW
    'unpublished-recent',       // NEW
    'unpublished-partial',      // Keep for backward compatibility
    'unpublished-complete',
    'unpublished-editor',
    'unpublished-author'
]);
```

**File: `/src/actions/database.ts`** - Modify `connectLiveUnpublishedCards()` (lines 398-446):

**Module-level variables to add** (after line 361):
```typescript
let liveUnpublishedPrioritizedCardsUnsubscribe : (() => void) | null = null;
let liveUnpublishedRecentCardsUnsubscribe : (() => void) | null = null;
```

**Modified function:**
```typescript
export const connectLiveUnpublishedCards = () => {
    // ... existing setup ...

    if (completeModeEnabled) {
        // Complete mode: fetch all unpublished (no change)
        // ... existing logic ...
    } else {
        // NEW 3-TIER SYSTEM

        // Tier 2: Prioritized cards (explicitly marked with false)
        store.dispatch(expectUnpublishedCards('unpublished-prioritized'));
        liveUnpublishedPrioritizedCardsUnsubscribe = onSnapshot(
            query(
                collection(db, CARDS_COLLECTION),
                where('published', '==', false),
                where('auto_todo_overrides.prioritized', '==', false)
            ),
            cardSnapshotReceiver('unpublished-prioritized')
        );

        // Tier 3: Recent unpublished (explicitly marked with true = NOT prioritized)
        store.dispatch(expectUnpublishedCards('unpublished-recent'));
        liveUnpublishedRecentCardsUnsubscribe = onSnapshot(
            query(
                collection(db, CARDS_COLLECTION),
                where('published', '==', false),
                where('auto_todo_overrides.prioritized', '==', true),
                orderBy('created', 'desc'),
                limit(effectiveLimit)  // Conservative initial limit
            ),
            cardSnapshotReceiver('unpublished-recent')
        );
    }
};
```

**Also modify `disconnectLiveUnpublishedCards()`** (after line 376):
```typescript
const disconnectLiveUnpublishedCards = () => {
	const loading = selectLoadingCardFetchTypes(store.getState() as State);
	for (const key of TypedObject.keys(loading)) {
		store.dispatch(stopExpectingFetchedCards(key));
	}
	if (liveUnpublishedCardsForUserAuthorUnsubscribe) {
		liveUnpublishedCardsForUserAuthorUnsubscribe();
		liveUnpublishedCardsForUserAuthorUnsubscribe = null;
	}
	if (liveUnpublishedCardsForUserEditorUnsubscribe) {
		liveUnpublishedCardsForUserEditorUnsubscribe();
		liveUnpublishedCardsForUserEditorUnsubscribe = null;
	}
	if (liveUnpublishedCardsUnsubcribe) {
		liveUnpublishedCardsUnsubcribe();
		liveUnpublishedCardsUnsubcribe = null;
	}
	// NEW: Clean up 3-tier listeners
	if (liveUnpublishedPrioritizedCardsUnsubscribe) {
		liveUnpublishedPrioritizedCardsUnsubscribe();
		liveUnpublishedPrioritizedCardsUnsubscribe = null;
	}
	if (liveUnpublishedRecentCardsUnsubscribe) {
		liveUnpublishedRecentCardsUnsubscribe();
		liveUnpublishedRecentCardsUnsubscribe = null;
	}
};
```

**File: `/src/actions/data.ts`** - Modify `cullExtraCompleteModeCards()` (lines 279-300):

```typescript
const cullExtraCompleteModeCards = () : ThunkSomeAction => (dispatch, getState) => {
    const state = getState();
    const cards = selectRawCards(state);

    // Separate cards by tier
    const publishedCards = Object.values(cards).filter(card => card.published);

    // Tier 2: Cards with prioritized === false (explicitly prioritized)
    const prioritizedCards = Object.values(cards).filter(card =>
        !card.published && cardIsPrioritized(card)
    );

    // Tier 3: Cards with prioritized === true (explicitly NOT prioritized)
    // Note: Cards with undefined prioritized are NOT included (not loaded by either tier)
    const recentCards = Object.values(cards).filter(card =>
        !card.published && card.auto_todo_overrides.prioritized === true
    ).sort((a, b) => b.created.seconds - a.created.seconds);

    // Calculate how many recent cards we can keep
    const limit = selectCompleteModeEffectiveCardLimit(state);
    const remainingSlots = Math.max(0, limit - publishedCards.length - prioritizedCards.length);

    // Cull excess recent cards (those beyond the dynamic limit)
    if (recentCards.length > remainingSlots) {
        const cardsToCull = recentCards.slice(remainingSlots).map(card => card.id);
        dispatch(cullCards(cardsToCull));
        dispatch(refreshCardSelector(true));
    }
};
```

**Important:** The culling logic must match the query logic exactly. If Tier 3 query loads cards with `prioritized === true`, then culling should only cull from cards with `prioritized === true`, not from cards with `undefined`.

### 1.4 Firestore Index Required

**Why this index is needed:**
- Tier 3 query uses two `where()` clauses plus `orderBy()` on different fields
- Firestore requires a composite index when: equality filters + inequality/range filters + orderBy
- Query pattern: `where('published', '==', false) AND where('prioritized', '==', true) AND orderBy('created', 'desc')`

**firestore.indexes.json:**
```json
{
  "indexes": [
    {
      "collectionGroup": "cards",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "published", "order": "ASCENDING" },
        { "fieldPath": "auto_todo_overrides.prioritized", "order": "ASCENDING" },
        { "fieldPath": "created", "order": "DESCENDING" }
      ]
    }
  ]
}
```

**Note:** Tier 2 query (prioritized cards) does NOT require this index because it only uses equality filters without orderBy. Firestore's single-field indexes are sufficient for that query.

### 1.5 Coverage and Undefined Cards

**CRITICAL: Cards with `undefined` prioritized are NOT loaded by this system.**

The 3-tier system intentionally loads only:
- **Tier 1:** Published cards (published === true)
- **Tier 2:** Unpublished AND explicitly prioritized (prioritized === false)
- **Tier 3:** Unpublished AND explicitly NOT prioritized (prioritized === true)

**Cards NOT loaded:**
- Unpublished cards where `auto_todo_overrides.prioritized === undefined`
- These represent cards that have never had their prioritization status set
- They will only be accessible via the discovered tier (on-demand fetch)

**Why this design:**
- Most cards (~80-90%) have explicit prioritization status
- Loading undefined cards would bloat the hot tier unnecessarily
- Undefined cards can still be accessed when needed (discovered tier)
- User can explicitly set prioritization to load cards into hot tier

**Migration consideration:**
If many cards have `undefined` prioritized and need to be loaded, run a one-time migration to set them to `true` (NOT prioritized).

### 1.6 Duplicate Prevention

**Existing mechanism (no changes needed):**
- `removeCards()` function uses 3-second timeout
- Cards moving between tiers handled automatically
- Most recent update wins

**Scenarios:**
- Card becomes prioritized (false): Moves tier 3 → tier 2 ✓
- Card loses priority (true): Moves tier 2 → tier 3 (may trigger culling) ✓
- Card published: Moves tier 2/3 → tier 1 ✓
- Card set to undefined: Removed from tier 2/3, only in discovered tier ✓

---

## 2. NLP Data Storage on Cards

### 2.1 Card Schema Extension

**File: `/shared/types.ts`** - Add to Card interface (~line 519):

```typescript
export interface Card {
  // ... existing fields ...

  // NLP storage fields (computed client-side on save)
  nlp_tokens?: NLPTokenStorage;      // Processed text for all searchable fields
  nlp_fingerprint?: string;          // Deduped pretty fingerprint for auto-titles
  nlp_version?: number;              // NLP algorithm version (starts at 1)
}

// NLP token storage structure
type NLPTokenStorage = {
  // Only searchable fields (per TEXT_FIELD_CONFIGURATION)
  [field in CardFieldType]+?: ProcessedRunStorage[]
};

type ProcessedRunStorage = {
  original: string;           // "Force of Gravity"
  normalized: string;         // "force of gravity"
  stemmed: string;            // "forc of graviti"
  withoutStopWords: string;   // "forc graviti"
};
```

**Storage Characteristics:**
- Only searchable fields included (filters by `TEXT_FIELD_CONFIGURATION[field].skipIndexing !== true`)
- Empty arrays omitted for storage efficiency
- Pre-computed string fingerprint for derived fields

### 2.2 Document Size Impact

**Per card overhead:**
- Typical content card (500 words): +18 KB NLP data
- Concept card (minimal): +4 KB NLP data
- Working notes (2000 words): +45 KB NLP data

**Total impact for 30k cards:**
- Current storage: ~240 MB
- NLP overhead: ~540 MB
- **New total: ~780 MB (+225%)**
- **Cost: +$0.10/month** (540 MB × $0.18/GB/month)

### 2.3 Client-Side Save Flow Integration

**File: `/src/actions/data.ts`** - Modify `modifyCardWithBatch()` (around line 400):

```typescript
export const modifyCardWithBatch = async (
  state: State,
  card: Card,
  rawUpdate: CardDiff,
  substantive: boolean,
  batch: MultiBatch
): Promise<boolean> => {

  // ... existing validation ...

  // Apply cardFinishers and fontSizeBoosts
  const update = await generateFinalCardDiff(state, card, rawUpdate);

  // **NEW: Compute NLP data if content fields changed**
  const contentFieldsChanged = hasContentFieldChanges(update);
  let nlpData: { nlp_tokens?: NLPTokenStorage, nlp_fingerprint?: string, nlp_version?: number } = {};

  if (contentFieldsChanged) {
    const updatedCard = cardFromDiff(card, update);
    nlpData = generateNLPDataForCard(updatedCard, state);
  }

  const updateObject = {
    ...update,
    ...nlpData,  // Add NLP fields if computed
    batch: batch.batchID || '',
    substantive: substantive,
    timestamp: serverTimestamp()
  };

  // ... rest of save flow ...
};
```

**File: `/src/actions/data.ts`** - Add helper function (NEW):

```typescript
/**
 * Checks if a CardDiff contains changes to content fields that would affect NLP.
 * Content fields are those indexed for search (per TEXT_FIELD_CONFIGURATION).
 */
const hasContentFieldChanges = (update: CardDiff): boolean => {
  const contentFields: CardFieldType[] = [
    'title', 'body', 'subtitle', 'commentary', 'title_alternates', 'external_link',
    'references_info_inbound', 'non_link_references', 'concept_references'
  ];

  // Also check for references_diff which affects concept_references
  return contentFields.some(field => field in update) || 'references_diff' in update;
};
```

**File: `/src/nlp.ts`** - Add new function:

```typescript
export const generateNLPDataForCard = (
  card: Card,
  state: State
): { nlp_tokens: NLPTokenStorage, nlp_fingerprint: string, nlp_version: number } => {

  // Generate fallback text map for this card
  const cards = selectCards(state);
  const fallbackText = backportFallbackTextMapForCard(card, cards);
  const concepts = selectConcepts(state);
  const synonymMap = selectSynonymMap(state);

  // Generate processed card
  const processedCard = cardWithNormalizedTextProperties(
    card, fallbackText, concepts, synonymMap
  );

  // Extract NLP tokens (filter out empty fields)
  const nlp_tokens: NLPTokenStorage = {};
  for (const [fieldName, runs] of TypedObject.entries(processedCard.nlp)) {
    if (runs.length === 0) continue;

    nlp_tokens[fieldName] = runs.map(run => ({
      original: run.original,
      normalized: run.normalized,
      stemmed: run.stemmed,
      withoutStopWords: run.withoutStopWords
    }));
  }

  // Generate fingerprint
  const fingerprintGenerator = selectFingerprintGenerator(state);
  const fingerprint = fingerprintGenerator.fingerprintForCardObj(processedCard);
  const nlp_fingerprint = fingerprint.dedupedPrettyItemsFromCard();

  return {
    nlp_tokens,
    nlp_fingerprint,
    nlp_version: 1  // Current version
  };
};
```

### 2.4 Performance Impact on Save

**Computation time:** ~10-50ms (already happens for UI)
**Total save time:** 100-300ms P95 (NO regression)
**Why no regression:**
- NLP computation happens inline (not async)
- Same computation already ran for UI rendering
- Update enqueueing prevents Redux churn
- 5-second IndexedDB debounce ensures zero interference

### 2.5 Backward Compatibility

**Three scenarios:**

1. **Card has nlp_tokens**: Use stored data (fast path)
2. **Card missing nlp_tokens**: Compute on-the-fly (legacy)
3. **Card has outdated nlp_version**: Recompute on save

**File: `/src/selectors.ts`** - Modify card processing:

```typescript
const getProcessedCard = (card: Card, state: State): ProcessedCard => {

  // Fast path: Use stored NLP if available and current
  if (card.nlp_tokens && card.nlp_version === CURRENT_NLP_VERSION) {
    return reconstructProcessedCardFromStorage(card, state);
  }

  // Slow path: Compute NLP (legacy cards)
  return cardWithNormalizedTextProperties(card, fallbackText, concepts, synonyms);
};
```

**File: `/src/nlp.ts`** - Add reconstruction function (NEW):

```typescript
/**
 * Reconstructs a ProcessedCard from stored NLP data on the card.
 * This is the "fast path" that avoids recomputing NLP.
 */
export const reconstructProcessedCardFromStorage = (
  card: Card,
  state: State
): ProcessedCard => {
  const nlp: { [field in CardFieldType]?: ProcessedRun[] } = {};

  // Reconstruct ProcessedRun objects from storage
  for (const [fieldName, storedRuns] of TypedObject.entries(card.nlp_tokens || {})) {
    nlp[fieldName] = storedRuns.map(stored => {
      // ProcessedRun constructor only takes originalText parameter
      // We need to manually construct the object with stored values
      const run = new ProcessedRun(stored.original);
      // Override with stored pre-computed values instead of recomputing
      run.normalized = stored.normalized;
      run.stemmed = stored.stemmed;
      run.withoutStopWords = stored.withoutStopWords;
      return run;
    });
  }

  // Create ProcessedCard
  return {
    ...card,
    nlp,
    fingerprint: card.nlp_fingerprint || ''
  } as ProcessedCard;
};
```

---

## 3. Server IDF Map

### 3.1 Purpose

Provide a **stable, global IDF (Inverse Document Frequency) baseline** for TF-IDF fingerprint calculations. Currently each client calculates IDF from loaded cards, leading to inconsistency.

### 3.2 Data Structure

**Format:** JSON in Cloud Storage

```typescript
interface IDFMapData {
  version: number;           // Timestamp (e.g., 1737785520000)
  cardCount: number;         // Cards used for calculation
  ngramSize: number;         // Typically 2 (unigrams + bigrams)
  idf: {                     // Map of ngram → IDF score
    [ngram: string]: number
  };
  maxIDF: number;            // Max IDF value
  generatedAt: string;       // ISO timestamp
}
```

**Size:** ~200-600 KB uncompressed, ~50-150 KB gzipped

### 3.3 Server-Side Generation

**File: `/functions/src/idf.ts`** (NEW) - Scheduled Cloud Function:

```typescript
export const calculateIDF = onSchedule({
  schedule: '0 2 * * 0', // Weekly Sunday 2:00 AM PST
  timeZone: 'America/Los_Angeles',
  memory: '2GiB',
  timeoutSeconds: 540 // 9 minutes
}, async (event) => {
  // 1. Fetch all cards
  const allCards = await getCards();

  // 2. Filter to body cards only
  const bodyCards = allCards.filter(card => BODY_CARD_TYPES[card.card_type]);

  // 3. Calculate IDF using shared NLP utilities
  const idfMap = calcIDFMapForCards(bodyCards, MAX_N_GRAM_FOR_FINGERPRINT);

  // 4. Create versioned data
  const idfData = {
    version: Date.now(),
    cardCount: bodyCards.length,
    ngramSize: MAX_N_GRAM_FOR_FINGERPRINT,
    idf: idfMap.idf,
    maxIDF: idfMap.maxIDF,
    generatedAt: new Date().toISOString()
  };

  // 5. Upload to Cloud Storage
  const bucket = storage.bucket();
  await bucket.file(`idf-maps/idf-v${idfData.version}.json`).save(JSON.stringify(idfData));
  await bucket.file('idf-maps/latest.json').save(JSON.stringify(idfData));
});
```

**Note on Browser API Dependencies:**

The NLP utilities in `/src/nlp.ts` use some simple DOM manipulation (e.g., `document.createElement()` for HTML parsing). For server-side use, we can use **jsdom** or a similar library that card-web likely already uses for tests:

```typescript
// In shared/nlp_core.ts or functions/src/idf.ts
import { JSDOM } from 'jsdom';

// Polyfill for server environment
if (typeof document === 'undefined') {
  global.document = new JSDOM('').window.document;
}
```

This allows the same NLP code to run on both client and server without modifications.

**Storage Location:**
- Bucket: Default Firebase Storage
- Path: `/idf-maps/idf-v{version}.json` (versioned)
- Path: `/idf-maps/latest.json` (stable URL)

**Public Access:** Add to `storage.rules`:
```
match /idf-maps/{fileName} {
  allow get: if true;  // Public read
}
```

### 3.4 Client Caching Strategy

**File: `/src/idf_cache.ts`** (NEW) - localStorage caching:

```typescript
export class IDFCache {
  async getIDF(): Promise<IDFMapData> {
    // 1. Check memory cache
    if (this.currentIDF) return this.currentIDF;

    // 2. Check localStorage (7-day TTL)
    const cached = this.getCached();
    if (cached && !this.isCacheExpired(cached)) {
      return cached.data;
    }

    // 3. Fetch from server
    const serverVersion = await this.fetchLatestVersion();
    const idfData = await this.fetchIDF(serverVersion);

    // 4. Cache in localStorage
    this.cacheIDF(idfData);
    return idfData;
  }
}
```

**Cache duration:** 7 days (matches weekly update schedule)

### 3.5 Client Integration

**File: `/src/nlp.ts`** - Modify `FingerprintGenerator` constructor:

```typescript
export class FingerprintGenerator {
  constructor(
    cards? : ProcessedCards,
    optFingerprintSize = SEMANTIC_FINGERPRINT_SIZE,
    optNgramSize = MAX_N_GRAM_FOR_FINGERPRINT,
    optServerIDF? : IDFMapData  // NEW
  ) {
    this._cards = cards || {};
    this._ngramSize = optNgramSize;

    // Use server IDF if provided
    if (optServerIDF) {
      this._idfMap = { idf: optServerIDF.idf, maxIDF: optServerIDF.maxIDF };
    } else {
      // Fallback to client-side calculation
      console.warn('Using client-side IDF - fingerprints may vary');
      this._idfMap = idfMapForCards(this._cards, this._ngramSize);
    }

    this._fingerprintSize = optFingerprintSize;
  }
}
```

**File: `/src/selectors.ts`** - Update `selectFingerprintGenerator`:

```typescript
export const selectFingerprintGenerator = createSelector(
  selectCards,
  selectServerIDF,  // NEW selector
  (cards, serverIDF) => new FingerprintGenerator(cards, undefined, undefined, serverIDF)
);
```

**File: `/src/actions/app.ts`** - Load IDF on app init:

```typescript
export const loadServerIDF = () => async (dispatch : ThunkDispatch) => {
  try {
    const idfCache = IDFCache.getInstance();
    const idf = await idfCache.getIDF();

    dispatch({ type: LOAD_SERVER_IDF, idf });
  } catch (error) {
    console.error('Failed to load server IDF, using client-side fallback:', error);
  }
};
```

---

## 4. Simple vs Complex Collections

### 4.1 Complete Filter Classification

This section classifies ALL ~99 unique filter types in card-web (generating ~274 filter names with has/no/needs/does-not-need variants) by whether they can be executed server-side (SIMPLE) or require client-side processing (COMPLEX).

#### SIMPLE Filters (Server-Side with Firestore Enterprise)

**Basic Boolean Filters:**
- `published` / `unpublished` - Equality query: `where('published', '==', true/false)`
- `all-cards` / `none` - All cards or no cards (degenerate cases)

**Section & Tag Filters:**
- `section/[sectionID]` - Equality: `where('section', '==', sectionID)`
- `tag/[tagID]` - Array-contains: `where('tags', 'array-contains', tagID)`
- `in-[section-name]-set` - Derived from section membership

**Card Type Filters:**
- `type-[cardType]` - Equality: `where('card_type', '==', cardType)`
- Examples: `type-content`, `type-section-head`, `type-concept`, `type-person`, etc.
- `has-body` / `missing-body` - Card type check (content, working-notes, etc.)

**Author & Permission Filters:**
- `author/[userID]` - Equality: `where('author', '==', userID)`
- Derived: `has-author`, `missing-author` (check if author field exists)

**Date Range Filters (Firestore Comparison):**
- `updated/[dateFilter]` - Comparison: `where('updated', '>=', startDate) && where('updated', '<=', endDate)`
- `created/[dateFilter]` - Comparison: `where('created', '>=', startDate)`
- `last-tweeted/[dateFilter]` - Comparison on `last_tweeted` timestamp
- Date filter formats: `before/[date]`, `after/[date]`, `between/[start]/[end]`, relative ranges

**Specific Card Lists:**
- `cards/[card1,card2,...]` - Document ID query: `where(documentId(), 'in', [...])`

**Similarity (Server-Side Qdrant):**
- `similar/[cardID]` - **SERVER-SIDE** via Qdrant embeddings cloud function
- `similar-cutoff/[cardID]/[threshold]` - **SERVER-SIDE** with score threshold
- Classification: **SIMPLE** (already using server embeddings, not client TF-IDF)

**Text Search (Firestore Enterprise Pipeline Operations):**
- `query/[text]` - **SERVER-SIDE with Firestore Enterprise** using `regex_match()` or `str_contains()` on `nlp_tokens`
- `query-strict/[text]` - **SERVER-SIDE with Enterprise** for exact matches
- **Fallback**: Client-side Porter stemmer + TF-IDF when Firestore Enterprise not available
- Classification: **SIMPLE with Enterprise**, **COMPLEX without**

**Basic Card Property Filters:**
- `has-comments` / `missing-comments` - Comparison: `where('thread_count', '>', 0)`
- `has-tweet` / `missing-tweet` - Comparison: `where('tweet_count', '>', 0)`
- `orphaned` / `not-orphaned` - Check section: `where('section', '==', null)`

**Reference Type Filters (Simple Boolean):**
- `has-[refType]-references` - Check `references.[refType]` exists (e.g., `link-references`, `ack-references`)
- `has-inbound-[refType]-references` - Check `references_inbound.[refType]` exists
- Examples: `has-link-references`, `has-concept-references`, `has-substantive-references`
- **Note**: These only check if references EXIST, not graph traversal
- **Decision**: Keep CLIENT-SIDE - see Appendix E for detailed analysis

#### COMPLEX Filters (Client-Side Only)

**Graph Traversal (BFS Required):**
- `children/[cardID]` - Cards directly referenced by card (1-hop BFS)
- `descendants/[cardID]/[ply]` - Cards transitively referenced (n-hop BFS)
- `parents/[cardID]` - Cards that reference this card (1-hop reverse BFS)
- `ancestors/[cardID]/[ply]` - Cards that transitively reference (n-hop reverse BFS)
- `direct-connections/[cardID]` - Union of children and parents
- `connections/[cardID]/[ply]` - Union of descendants and ancestors
- `references/[cardID]/[refType]/[ply]` - Filtered graph traversal by reference type
- `references-inbound/[cardID]/[refType]/[ply]` - Inbound filtered traversal
- `references-outbound/[cardID]/[refType]/[ply]` - Outbound filtered traversal
- Classification: **COMPLEX** (requires full graph in memory for BFS)

**Filter Composition (Context-Dependent):**

**Union Filters (`filter1+filter2+...`)** - 🔀 **HYBRID**
- OR operation combining multiple simple filters
- Examples: `section/A+section/B`, `tag/X+tag/Y`, `published+section/intro`
- **SERVER when**: All sub-filters use same field OR all are server-queryable
  - Same field (≤30): `section/A+section/B+section/C` → `where('section', 'in', ['A','B','C'])`
  - Tag union (≤30): `tag/X+tag/Y` → `where('tags', 'array-contains-any', ['X','Y'])`
  - Different fields: `published+section/A` → `or(where('published', '==', true), where('section', '==', 'A'))`
- **CLIENT when**: Any sub-filter is client-only (starred, children, query without Enterprise)
- **Limitation**: Max 30 values for `in`/`array-contains-any`, max 30 OR clauses

**`combine/[filter1]/[filter2]`** - 🔀 **HYBRID**
- Configurable filter that returns union of two sub-filter expressions
- Accepts complex sub-filters (unlike union `+` which only takes simple names)
- Example: `combine/published/children/cardX` (can nest configurables)
- **SERVER when**: Both sub-filters are server-queryable → use `or()`
- **CLIENT when**: Any sub-filter requires client-side processing
- Can be nested: `combine/combine/A/B/C` flattens to `A OR B OR C`

**`exclude/[subFilter]`** - 🔀 **HYBRID**
- Negation of sub-filter results
- Examples: `exclude/published`, `exclude/section/intro`
- **SERVER when**: Simple field negation
  - `exclude/published` → `where('published', '==', false)`
  - `exclude/section/A` → `where('section', '!=', 'A')`
  - `exclude/updated/after/2024-01-01` → `where('updated', '<=', timestamp)`
- **CLIENT when**: Compound negation, graph-based, or multiple inequalities
  - `exclude/published+starred` → Cannot negate OR in Firestore
  - `exclude/children/cardX` → Requires graph traversal
- **Limitation**: Only ONE inequality per Firestore query
- **Edge case**: Double-negation with inverse filters needs special handling

**`expand/[filter]/[linkFilter]`** - ❌ **CLIENT**
- Apply filter to get seed cards, then expand via graph traversal
- Example: `expand/published/children` = published cards + their children
- **Always CLIENT** because:
  - Requires two-phase execution (filter, then traverse)
  - Graph traversal cannot be expressed in Firestore
  - `in` operator limited to 10-30 values
  - Would need multiple round-trips + client coordination
- No server-side optimization possible without architecture refactor

**Concept Analysis (NLP Required):**
- `about-concept/[conceptID]` - Cards that reference a concept (semantic analysis)
- `missing-concept/[conceptID]` - Cards that should reference but don't (requires suggestions)
- Classification: **COMPLEX** (requires NLP processing and semantic analysis)

**Client-Side Derived Filters:**
- `has-content` / `missing-content` - Checks multiple fields for any content
- `has-substantive-content` / `missing-substantive-content` - Content length threshold
- `has-links` / `missing-links` - Any outbound link (requires references processing)
- `has-inbound-links` / `missing-inbound-links` - Any inbound link
- `has-reciprocal-links` / `missing-reciprocal-links` - Bidirectional link check
- Classification: **COMPLEX** (requires card relationships)

**Array Emptiness Checks (Cannot be Server-Side):**
- `has-slug` / `missing-slug` - Check `slugs` array non-empty
- `has-tags` / `missing-tags` - Check `tags` array non-empty
- `has-images` / `missing-images` - Check `images` array non-empty
- `has-notes` / `missing-notes` - Check `notes` field non-empty
- **Firestore Limitation**: `where('array', '!=', [])` does NOT work reliably
  - The `!=` operator excludes documents where the field doesn't exist
  - Cannot distinguish between empty array `[]` and missing field
  - Source: [Firestore Query Documentation](https://firebase.google.com/docs/firestore/query-data/queries)
- **Workaround**: Would require separate boolean flags (e.g., `has_slugs: boolean`)
- Classification: **COMPLEX** (requires client-side array length check)

**Special Filters:**
- `limit/[n]` - Client-side pagination (runs AFTER all filters)
- `offset/[n]` - Client-side pagination (runs AFTER all filters)
- `same-type/[cardID]` - Compare card types (could be server-side, but rare)
- `different-type/[cardID]` - Inverse of same-type
- Classification: **COMPLEX** (post-processing)

**Stored Collections (Not in Firestore):**
- `reading-list` / `not-reading-list` - Stored in separate `reading_list` collection
- `starred` / `unstarred` - Stored in separate `stars` collection
- `read` / `unread` - Stored in separate `read` collection
- `selected` / `not-selected` - Client-side UI state only
- Classification: **COMPLEX** (requires joining data from multiple collections)

**Auto TODO Filters (Mixed):**
- Many TODO filters like `needs-links`, `needs-tags`, etc.
- Some are server-queryable (check boolean fields)
- Others require client-side logic (substantive content check, reciprocal links)
- Classification: **MIXED** (case-by-case basis)

#### Classification Summary

**Total Filter Count:** ~99 unique filter types (274 filter names with variants)

**Breakdown:**
- Configurable filters: 30 (single names)
- Auto TODO filters: 15 base types × 4 names each = 60 names
- Freeform TODO: 1 × 4 names = 4 names
- Non-TODO card filters: 10 × 4 names = 40 names
- Card type filters: 7 × 2 names = 14 names
- Reference type filters: 15 outbound + 15 inbound × 4 names = 120 names
- Special filters: 6 (starred, read, selected, reading-list, all-cards, none)

**✅ SIMPLE (Server-Side):** ~17 filters
- Boolean equality (2): published, unpublished
- Section & tag (3+): section/[id], tag/[id], in-[section]-set
- Card type (7): type-content, type-section-head, type-concept, type-person, type-work, type-working-notes, type-quote
- Date ranges (3): updated, created, last-tweeted
- Author (1): author/[uid]
- Cards list (1): cards/[id,id,...]
- Similarity (2): similar/[id], similar-cutoff/[id]/[threshold] ← Already server-side via Qdrant
- Query text (2): query/[text], query-strict/[text] ← **With Firestore Enterprise**
- Basic properties (3): has-comments, has-tweet, orphaned
- Has-body (1): Card type in BODY_CARD_TYPES

**☁️ CLOUD FUNCTION (Already Server-Side):** 2 filters
- Similar filters using Qdrant vector search

**🔶 FIRESTORE ENTERPRISE (Pipeline Operations):** 2 filters
- Query filters (full-text search on nlp_tokens)

**❌ COMPLEX (Client-Side Only):** ~70+ filters
- Graph traversal (9): children, descendants, parents, ancestors, connections, references*
- expand (1): Always client-side (graph + multi-phase)
- Concept analysis (2): about-concept, missing-concept
- Complex content checks (5): has-content, substantive-content, has-links, reciprocal-links, has-inbound-links
- **Array emptiness checks (4): has-slug, has-tags, has-images, has-notes** ← CANNOT use `!= []` in Firestore
- Reference processing (~32): substantive-references, concept-references, 15 outbound + 15 inbound reference type filters (has-X-references)
- Stored collections (3): reading-list, starred, read
- UI state (2): selected, not-selected
- Pagination (2): limit, offset
- Combined TODOs (1): has-todo
- Most TODO filters (~20): needs-links, needs-content, needs-substantive-content, needs-reciprocal-links, etc.

**🔀 HYBRID (Context-Dependent):** ~8 filters
- **Union filters (`+`)**: SERVER if same-field or all-server-fields (≤30), CLIENT otherwise
  - Examples: `section/A+section/B` → SERVER, `published+starred` → CLIENT
- **combine filter**: SERVER if both sub-filters are SERVER, CLIENT otherwise
- **exclude filter**: SERVER for simple negation, CLIENT for compound/graph
  - Examples: `exclude/published` → SERVER, `exclude/children/X` → CLIENT
- Query filters: SERVER with Firestore Enterprise, CLIENT without
- Manual TODO overrides (3): prose, citations, diagram (could be server-side)
- same-type/different-type (2): Could be 2 queries (usually client)

### 4.2 Composition Filter Details

#### Union Filters (`filter1+filter2+...`)

**Syntax:** Multiple filter names separated by `+` (e.g., `section/A+section/B+tag/X`)

**Firestore Capabilities:**
- `in` operator: `where('field', 'in', [val1, val2, ...])` - max 30 values
- `array-contains-any`: `where('array_field', 'array-contains-any', [val1, val2])` - max 30 values
- `or()` compound queries: `or(where(...), where(...))` - max 30 OR clauses

**Server-Side Classification:**

| Union Type | Example | Firestore Query | Classification |
|------------|---------|-----------------|----------------|
| Same field (≤30) | `section/A+section/B+section/C` | `where('section', 'in', ['A','B','C'])` | ✅ SERVER |
| Tag union (≤30) | `tag/X+tag/Y+tag/Z` | `where('tags', 'array-contains-any', ['X','Y','Z'])` | ✅ SERVER |
| Different server fields | `published+section/intro` | `or(where('published','==',true), where('section','==','intro'))` | ✅ SERVER |
| Same field (>30) | 31+ sections | Multiple queries or CLIENT | 🔀 HYBRID |
| Client-only union | `starred+read` | N/A | ❌ CLIENT |
| Mixed server/client | `published+children/X` | Partial optimization possible | 🔀 HYBRID |

**Implementation Strategy:**
1. Analyze all sub-filters
2. If all use same field AND ≤30 values → use `in` or `array-contains-any`
3. If all are server-queryable AND ≤30 total → use `or()`
4. If any sub-filter is client-only → entire union must be CLIENT
5. If >30 values/clauses → use multiple queries or fall back to CLIENT

#### `combine/filter1/filter2` Filter

**Difference from Union `+`:**
- Accepts **sub-filter expressions** (including configurable filters)
- Union `+` only accepts simple filter names (no `/` allowed)
- `combine` is limited to exactly 2 sub-filters (but can nest)
- Example: `combine/published/children/cardX` ✅ vs `published+children/cardX` ❌ (invalid syntax)

**Server-Side Logic:**
- Same as union filters: if both sub-filters are SERVER → use `or()`
- If either is CLIENT → entire combine must be CLIENT
- Nested combines flatten: `combine/combine/A/B/C` = `A OR B OR C`

#### `exclude/subFilter` Filter

**Firestore Negation:**
- `!=` operator: `where('field', '!=', value)`
- `not-in` operator: `where('field', 'not-in', [val1, val2])` - max 10 values
- **Critical limitation**: Only ONE inequality per query

**Server-Side Classification:**

| Exclude Type | Example | Firestore Query | Classification |
|--------------|---------|-----------------|----------------|
| Simple field | `exclude/published` | `where('published', '==', false)` | ✅ SERVER |
| Simple field | `exclude/section/A` | `where('section', '!=', 'A')` | ✅ SERVER |
| Date negation | `exclude/updated/after/2024-01-01` | `where('updated', '<=', timestamp)` | ✅ SERVER |
| Compound negation | `exclude/published+starred` | Cannot express `NOT (A OR B)` | ❌ CLIENT |
| Graph negation | `exclude/children/X` | Requires graph traversal | ❌ CLIENT |
| Double inequality | `exclude/section/A` + other `!=` | Only one inequality allowed | ❌ CLIENT |

**Edge Cases:**
- **Double-negation**: `exclude/unread` where `unread = NOT read` → simplifies to `read`
- **Degenerate**: `exclude/all-cards` → empty set
- **Multiple excludes**: Only first can use `!=`, rest must be client-side

#### `expand/filter/linkFilter` Filter

**Why Always CLIENT:**
1. **Two-phase execution**: Must run filter FIRST to get seed cards, THEN traverse graph
2. **No JOIN in Firestore**: Cannot express "get cards matching A, then get cards they reference"
3. **Limited `in` operator**: Even if you get seed card IDs, can only fetch 10-30 in one query
4. **Multi-hop impossible**: `descendants/2` requires iterative traversal across multiple hops
5. **Architecture dependency**: Filter system expects complete `FilterMap` (cardID → boolean) client-side

**No optimization possible** without major architecture changes (lazy evaluation, server-side graph API, etc.)

### 4.4 Filter Classification Algorithm

**File: `/src/filters.ts`** - Add classification function:

```typescript
interface FilterClassification {
  isSimple: boolean;
  canGetServerCount: boolean;
  firestoreConstraints?: QueryConstraint[];
  reason: string;
}

function classifyFilter(filterDescription: CollectionDescription): FilterClassification {
  const filters = filterDescription.filters;

  // Empty filter → SIMPLE
  if (filters.length === 0) {
    return {
      isSimple: true,
      canGetServerCount: true,
      firestoreConstraints: [/* constraints for set */],
      reason: 'No filters'
    };
  }

  // Check each filter
  for (const filter of filters) {
    // Union filters
    if (filter.includes(UNION_FILTER_DELIMITER)) {
      const subFilters = filter.split(UNION_FILTER_DELIMITER);
      if (!subFilters.every(f => isSimpleFilter(f))) {
        return { isSimple: false, canGetServerCount: false, reason: `Union contains complex: ${filter}` };
      }
      continue;
    }

    // Known SIMPLE filters
    if (SIMPLE_FILTER_TYPES.includes(getFilterType(filter))) {
      continue;
    }

    // Known COMPLEX filters
    if (COMPLEX_FILTER_TYPES.includes(getFilterType(filter))) {
      return { isSimple: false, canGetServerCount: false, reason: `Complex filter: ${getFilterType(filter)}` };
    }
  }

  // All filters SIMPLE
  return {
    isSimple: true,
    canGetServerCount: true,
    firestoreConstraints: buildFirestoreQuery(filters),
    reason: 'All filters server-friendly'
  };
}
```

### 4.5 Server-Side Counts

**File: `/src/collection_description.ts`** - Add count method:

```typescript
async function getCollectionCount(
  description: CollectionDescription,
  classification: FilterClassification
): Promise<{ count: number; isExact: boolean }> {

  if (!classification.canGetServerCount) {
    return getApproximateCount(description);
  }

  // Use getCountFromServer for SIMPLE collections
  const q = query(
    collection(db, CARDS_COLLECTION),
    ...classification.firestoreConstraints
  );

  try {
    const snapshot = await getCountFromServer(q);
    return { count: snapshot.data().count, isExact: true };
  } catch (error) {
    console.error('Server count failed:', error);
    return getApproximateCount(description);
  }
}
```

### 4.6 Pagination for SIMPLE Collections

**Two-Phase Fetch Pattern:**

1. **Phase 1:** Fetch card IDs from server (lightweight)
2. **Phase 2:** Load batches of cards progressively

**Implementation:**

```typescript
class SimplifiedCollection {
  private cardIDs: CardID[] = null;
  private visibleCards: Card[] = [];

  async initialize() {
    // Get count + IDs
    const { count, ids } = await this.fetchCardIDs();
    this.cardIDs = ids;
    this.totalCount = count;

    // Load first batch
    await this.loadCardBatch(0, 50);
  }

  async fetchCardIDs(): Promise<{ count: number; ids: CardID[] }> {
    const q = query(
      collection(db, CARDS_COLLECTION),
      ...this.classification.firestoreConstraints,
      orderBy(this.sortField, this.sortDirection)
    );

    const snapshot = await getDocs(q);
    return { count: snapshot.size, ids: snapshot.docs.map(doc => doc.id) };
  }

  async loadCardBatch(startIndex: number, count: number) {
    const batchIDs = this.cardIDs.slice(startIndex, startIndex + count);

    // Check hot tier first
    const hotTierCards = batchIDs.map(id => state.data.cards[id]).filter(Boolean);

    // Fetch missing cards into discovered tier
    const missingIDs = batchIDs.filter(id => !state.data.cards[id]);
    for (const id of missingIDs) {
      await discoveredCardsManager.fetchCard(id);
    }

    this.visibleCards.push(...batchIDs.map(id => state.data.cards[id] || state.data.discoveredCards[id]));
  }
}
```

**Scroll Trigger:**

```typescript
// Load next batch at 80% scroll position
if (scrollPercent > 0.8 && !this.loadingMoreCards) {
  await this.collection.loadCardBatch(this.visibleCards.length, 50);
}
```

### 4.7 UI for Counts

**File: `/src/components/main-view.ts`** - Add collection info display:

```typescript
renderCollectionInfo() {
  const countInfo = this.collection.countInfo;

  if (countInfo.isExact) {
    return html`
      <div class="collection-info">
        <span class="count">${countInfo.count.toLocaleString()} cards</span>
        <span class="badge simple">Server-side count</span>
      </div>
    `;
  } else {
    return html`
      <div class="collection-info">
        <span class="count">${countInfo.count.toLocaleString()}+ cards</span>
        <span class="badge complex">Approximate</span>
      </div>
    `;
  }
}
```

---

## 5. Similarity Integration

### 5.1 Current Implementation

**Similarity is ALREADY server-side** using Qdrant embeddings (NOT client-side TF-IDF):

**File: `/src/actions/similarity.ts`** - Existing server call:

```typescript
const similarCardsCallable = httpsCallable<SimilarCardsRequestData, SimilarCardsResponseData>(
  functions,
  'similarCards'
);

const result = await similarCardsCallable({ card_id: cardID });
// Returns: { success: true, cards: [...] }
```

**File: `/functions/src/embeddings.ts`** - Server-side logic:

```typescript
export const similarCards = async (request : CallableRequest<SimilarCardsRequestData>) : Promise<SimilarCardsResponseData> => {
  // Uses OpenAI embeddings + Qdrant vector search
  const vector = await embeddingForContent(content);
  const points = await EMBEDDING_STORE.similarPoints(data.card_id, vector);
  return { success: true, cards: points };
};
```

### 5.2 Classification

**Similarity filters are SIMPLE** (server-friendly):
- `similar/[card]` → Server Qdrant lookup
- `similar-cutoff/[card]/[threshold]` → Server Qdrant lookup with threshold

**This means similarity collections CAN have accurate server counts:**

```typescript
// Optional: Add server count endpoint
export const getSimilarCardsCount = functions.https.onCall(async (data, context) => {
  const { card_id, cutoff } = data;

  const similarCards = await qdrantClient.search(COLLECTION_NAME, {
    vector: await getCardEmbedding(card_id),
    limit: 10000,
    score_threshold: cutoff || 0
  });

  return { count: similarCards.length, isExact: true };
});
```

### 5.3 TF-IDF Fallback

**Client-side TF-IDF similarity is a FALLBACK** (when embeddings unavailable):
- Used for preview state
- Not the primary similarity mechanism
- NO need to add TF-IDF to server similarity

---

## 6. Real-Time Editing Conflicts

### 6.1 Problem

When a user edits a card that's NOT in the hot tier (i.e., in discovered tier), they won't receive real-time updates if another user edits the same card.

### 6.2 Solution

Attach an `onSnapshot` listener to the specific card when editing starts.

### 6.3 Implementation

**File: `/src/actions/editor.ts`** - Modify `editingStart()` (around line 257):

```typescript
// Module-level state
let editingCardSnapshotUnsubscribe: (() => void) | null = null;

const attachEditingCardListener = (cardID: CardID): ThunkSomeAction => (dispatch, getState) => {
  const state = getState();

  // Don't attach if already in hot tier
  if (cardID in state.data.cards) {
    return;
  }

  // Clean up existing listener
  if (editingCardSnapshotUnsubscribe) {
    editingCardSnapshotUnsubscribe();
  }

  // Attach onSnapshot
  const cardRef = doc(db, CARDS_COLLECTION, cardID);
  editingCardSnapshotUnsubscribe = onSnapshot(cardRef, (snapshot) => {
    if (!snapshot.exists()) {
      console.warn('Editing card was deleted');
      return;
    }

    const updatedCard = {
      ...snapshot.data({serverTimestamps: 'estimate'}),
      id: cardID
    } as Card;

    // Dispatch update (existing machinery handles merge)
    dispatch({
      type: EDITING_UPDATE_UNDERLYING_CARD,
      updatedUnderlyingCard: updatedCard
    });
  });
};

// Modify editingStart
export const editingStart = () => async (dispatch, getState) => {
  // ... existing logic ...

  const cardID = selectActiveCardId(state);
  if (cardID) {
    dispatch(attachEditingCardListener(cardID));
  }

  dispatch({ type: EDITING_START });
};
```

**Modify `editingFinish()` (around line 361):**

```typescript
const detachEditingCardListener = () => {
  if (editingCardSnapshotUnsubscribe) {
    editingCardSnapshotUnsubscribe();
    editingCardSnapshotUnsubscribe = null;
  }
};

export const editingFinish = () : SomeAction => {
  detachEditingCardListener();
  return {type: EDITING_FINISH};
};
```

### 6.4 Existing Merge Machinery

**All conflict resolution machinery ALREADY EXISTS:**

1. **Update underlying card:** `EDITING_UPDATE_UNDERLYING_CARD` reducer (line 404 of `/src/reducers/editor.ts`)
2. **Detect conflicts:** `selectOvershadowedUnderlyingCardChangesDiff` (line 904 of `/src/selectors.ts`)
3. **Merge changes:** `mergeOvershadowedUnderlyingChanges()` action (line 901 of `/src/actions/editor.ts`)
4. **UI:** Card editor shows merge button when conflicts detected

**No new state or logic needed** - just attach listener.

---

## 7. Implementation Roadmap

### Phase 1: 3-Tier Hot System (Week 1-2)

**Goal:** Replace 2-tier with 3-tier card loading

**Tasks:**
1. Add new CardFetchType enum values
2. Modify `connectLiveUnpublishedCards()` with 3 queries
3. Update `cullExtraCompleteModeCards()` for tier-aware culling
4. Add Firestore composite index
5. Test tier transitions and duplicate prevention

**Success Criteria:**
- All 3 tiers load correctly
- No duplicate cards
- Cards move between tiers gracefully
- Tier 1 + 2 total: ~6,900 cards

### Phase 2: NLP Data Storage (Week 3-4)

**Goal:** Store NLP data on cards, compute on save

**Tasks:**
1. Add nlp_tokens, nlp_fingerprint, nlp_version to Card interface
2. Implement `generateNLPDataForCard()` in nlp.ts
3. Integrate into `modifyCardWithBatch()` save flow
4. Modify ProcessedRun to support reconstruction from storage
5. Update selectors to use stored NLP (fast path)
6. Create migration task for 30k existing cards

**Success Criteria:**
- Save performance: P95 < 500ms (no regression)
- New cards have nlp_tokens populated
- Old cards work (fallback to computation)
- Migration completes in <60 minutes

### Phase 3: Server IDF Map (Week 5)

**Goal:** Server-maintained IDF for consistent TF-IDF

**Tasks:**
1. Create shared NLP utilities in `/shared/nlp_core.ts`
2. Implement scheduled Cloud Function for IDF calculation
3. Create `IDFCache` class with localStorage caching
4. Modify `FingerprintGenerator` to accept server IDF
5. Add app initialization IDF download
6. Update storage.rules for public access

**Success Criteria:**
- IDF map generated weekly on server
- Clients download and cache IDF
- Fingerprints consistent across sessions
- Fallback to client IDF works

### Phase 4: Simple Collections & Pagination (Week 6-7)

**Goal:** Server counts and pagination for simple collections

**Tasks:**
1. Implement filter classification logic
2. Add `getCollectionCount()` with getCountFromServer
3. Implement two-phase fetch (IDs then cards)
4. Add scroll-based pagination trigger
5. Update UI to show exact vs approximate counts

**Success Criteria:**
- SIMPLE collections show exact counts
- COMPLEX collections show approximate
- Pagination loads 50 cards at a time
- Scroll triggering works smoothly

### Phase 5: Real-Time Editing Conflicts (Week 8)

**Goal:** Detect concurrent edits on non-hot cards

**Tasks:**
1. Add `attachEditingCardListener()` in editingStart
2. Add `detachEditingCardListener()` in editingFinish
3. Test with concurrent edits
4. Verify existing merge machinery works

**Success Criteria:**
- Listener attached for non-hot cards
- Merge button appears on conflict
- Merge works correctly
- Listener detached on close

### Phase 6: Testing & Polish (Week 9-10)

**Goal:** Comprehensive testing and production readiness

**Tasks:**
1. Unit tests for all new functions
2. Integration tests for end-to-end flows
3. Performance testing (save, load, scroll)
4. Migration dry-run on staging
5. Monitoring and logging setup
6. Documentation updates

**Success Criteria:**
- Test coverage >80%
- All performance targets met
- Migration validated
- Rollback plan ready

---

## 8. Migration Strategy

### 8.1 NLP Data Migration

**Goal:** Add nlp_tokens to all 30,000 existing cards

**Approach:** Two-phase migration to avoid browser freeze and listener storms

#### Phase 1: Mark Cards (Lightweight - Minutes)

First, mark all cards with `nlp_version: 0` to indicate they need NLP computation. This is a lightweight write-only operation that doesn't load all cards into memory.

**File: `/src/actions/maintenance.ts`** - Add phase 1 task:

```typescript
const MARK_CARDS_FOR_NLP_MIGRATION = 'mark-cards-for-nlp-migration';

const markCardsForNLPMigration: MaintenanceTaskFunction = async (db) => {
  const batch = new MultiBatch(db);

  // Query cards in batches of 500 (lightweight - only fetch IDs)
  let lastDoc = null;
  let totalMarked = 0;

  while (true) {
    let q = query(
      collection(db, CARDS_COLLECTION),
      where('nlp_version', '==', null),  // Cards without NLP
      limit(500)
    );

    if (lastDoc) {
      q = query(q, startAfter(lastDoc));
    }

    const snapshot = await getDocs(q);
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      batch.update(doc.ref, { nlp_version: 0 });  // Mark for migration
      totalMarked++;
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    console.log(`Marked ${totalMarked} cards...`);
  }

  await batch.commit();
  console.log(`Phase 1 complete: Marked ${totalMarked} cards`);
};
```

#### Phase 2: Lazy Computation (Ongoing - Zero UX Impact)

Cards with `nlp_version: 0` will have their NLP computed and saved the next time they're:
1. Loaded into the hot tier
2. Edited by the user
3. Accessed via discovered tier

**File: `/src/selectors.ts`** - Modify card processing:

```typescript
const getProcessedCard = (card: Card, state: State): ProcessedCard => {

  // Fast path: Use stored NLP if available and current
  if (card.nlp_tokens && card.nlp_version === CURRENT_NLP_VERSION) {
    return reconstructProcessedCardFromStorage(card, state);
  }

  // Compute NLP (legacy or marked for migration)
  const processedCard = cardWithNormalizedTextProperties(card, fallbackText, concepts, synonyms);

  // If card is marked for migration (nlp_version: 0), save computed NLP
  if (card.nlp_version === 0) {
    dispatch(saveComputedNLP(card.id, processedCard));  // Background async save
  }

  return processedCard;
};
```

**File: `/src/actions/data.ts`** - Add background NLP save:

```typescript
/**
 * Saves computed NLP data for a card (background, non-blocking).
 * Used during lazy migration to upgrade legacy cards.
 */
export const saveComputedNLP = (cardID: CardID, processedCard: ProcessedCard): ThunkSomeAction =>
  async (dispatch, getState) => {
    try {
      const nlpData = {
        nlp_tokens: extractNLPTokens(processedCard),
        nlp_fingerprint: processedCard.fingerprint,
        nlp_version: CURRENT_NLP_VERSION
      };

      await updateDoc(doc(db, CARDS_COLLECTION, cardID), nlpData);
    } catch (error) {
      console.warn(`Failed to save NLP for ${cardID}:`, error);
      // Non-blocking - don't throw
    }
  };
```

**Performance:**
- **Phase 1**: 30k cards × 1 write = ~10-15 minutes
- **Phase 2**: Lazy over weeks/months (zero perceived impact)
- **Total cost**: $0.054 (30k writes × $0.0018 per 100k)
- **UX impact**: None (no browser freeze, no listener storm)

### 8.2 Rollback Strategy

**Feature flags for each component:**
- `ENABLE_3_TIER_HOT_SYSTEM`
- `ENABLE_STORED_NLP_DATA`
- `ENABLE_SERVER_IDF`
- `ENABLE_SIMPLE_COLLECTIONS`
- `ENABLE_EDITING_LISTENERS`

**Rollback procedure:**
1. Set feature flag to false
2. Clear relevant caches (localStorage, IndexedDB)
3. Verify fallback behavior works
4. Investigate issue in dev environment
5. Fix and re-enable

**Recovery time:** <5 minutes (feature flag toggle)

---

## 9. Testing Strategy

### 9.1 Unit Tests

**3-Tier Hot System:**
- Tier classification logic
- Duplicate prevention
- Culling with tier overflow

**NLP Storage:**
- generateNLPDataForCard correctness
- Reconstruction from storage
- Backward compatibility (missing nlp_tokens)

**Server IDF:**
- IDFCache download and caching
- localStorage TTL expiration
- Fallback to client IDF

**Collection Classification:**
- SIMPLE vs COMPLEX detection
- Firestore query building
- Count accuracy

### 9.2 Integration Tests

**Full Flow:**
1. Load app → 3 tiers populate
2. Edit card → save → NLP data stored
3. Reload app → NLP data loaded from storage
4. Open SIMPLE collection → accurate count shown
5. Scroll collection → pagination loads more
6. Edit non-hot card → concurrent edit detected → merge works

### 9.3 Performance Tests

**Metrics:**
- Save operations: P50 < 200ms, P95 < 500ms
- 3-tier load time: < 5 seconds
- NLP computation on save: < 50ms
- IDF download: < 300ms (first time)
- Collection count: < 200ms (SIMPLE), < 100ms (COMPLEX)
- Pagination batch load: < 300ms

### 9.4 Migration Tests

**Dry run:**
1. Copy production data to staging
2. Run migration on staging
3. Verify all cards have nlp_tokens
4. Spot-check NLP correctness
5. Verify save/load still works

---

## 10. Cost Analysis

### 10.1 Storage Costs

**Current:**
- 30k cards × 8 KB = 240 MB
- Cost: $0.043/month

**With NLP data:**
- 30k cards × 26 KB (avg with NLP) = 780 MB
- Cost: $0.140/month
- **Increase: +$0.097/month**

### 10.2 Read/Write Costs

**Firestore reads:**
- Current: ~450k reads/month (hot tier listeners)
- New: ~600k reads/month (+150k for discovered tier fetch, staleness checks, editing listeners)
  - Discovered tier fetches: ~100k/month (on-demand card loads)
  - Editing conflict listeners: ~30k/month (onSnapshot for non-hot cards)
  - Staleness validation: ~20k/month (check if cached cards outdated)
- Still within free tier (1.5M/month)
- **Increase: $0/month**

**Cloud Function costs:**
- Weekly IDF calculation:
  - Compute time: ~60 seconds @ $0.0000025/sec = $0.00015/week
  - ~$0.0006/month (negligible, well within free tier)
  - Free tier: 2M invocations/month, 400k GB-seconds/month
- **Increase: +$0.00/month** (within free tier)

### 10.3 Total Cost Impact

**Monthly costs:**
- Storage: +$0.10
- Reads: +$0 (within free tier)
- Cloud Functions: +$0 (within free tier)
- **Total increase: ~$0.10/month**

**One-time migration:** $0.054 (phase 1: mark cards with nlp_version: 0)

**Annual increase:** ~$1.20/year

**Cost per benefit:** Enables full-text search across 30k cards, 3-tier hot system, server IDF, and real-time editing conflicts for ~10 cents/month = **Excellent ROI**

**Note on Cost Accuracy:**
- Actual reads may vary +/- 50k/month depending on user behavior
- Still well within free tier (1.5M reads/month limit)
- IDF function execution well within free tier (400k GB-seconds/month limit)
- Storage cost is most significant contributor (~100% of monthly increase)

---

## 11. Critical Files Reference

### Files to Create (6 files)

1. **/Users/jkomoros/Code/card-web/src/idf_cache.ts** (~150 LOC)
   - IDFCache class with localStorage caching
   - Download and version management

2. **/Users/jkomoros/Code/card-web/functions/src/idf.ts** (~100 LOC)
   - Scheduled Cloud Function for IDF calculation
   - Weekly computation and upload

3. **/Users/jkomoros/Code/card-web/shared/nlp_core.ts** (~300 LOC)
   - Shared NLP utilities for client and server
   - Extract from src/nlp.ts

4. **/Users/jkomoros/Code/card-web/src/discovered-cards.ts** (~200 LOC)
   - Already exists from Approach 5 v1.1
   - Discovered tier manager

5. **/Users/jkomoros/Code/card-web/src/lru-eviction.ts** (~100 LOC)
   - Already exists from Approach 5 v1.1
   - Simple LRU eviction

6. **/Users/jkomoros/Code/card-web/docs/design/CANONICAL-PLAN.md** (THIS FILE)
   - Canonical plan of record

### Files to Modify (18 files)

1. **/Users/jkomoros/Code/card-web/src/types.ts** (~70 LOC changes)
   - Add nlp_tokens, nlp_fingerprint, nlp_version to Card
   - Add 'unpublished-prioritized', 'unpublished-recent' to CardFetchType
   - Add serverIDF to DataState

2. **/Users/jkomoros/Code/card-web/src/actions/database.ts** (~150 LOC changes)
   - Modify connectLiveUnpublishedCards for 3-tier system
   - Add unsubscribe variables for tier 2 and 3

3. **/Users/jkomoros/Code/card-web/src/actions/data.ts** (~100 LOC changes)
   - Integrate NLP computation in modifyCardWithBatch
   - Modify cullExtraCompleteModeCards for tier-aware culling
   - Add LOAD_SERVER_IDF action

4. **/Users/jkomoros/Code/card-web/src/nlp.ts** (~200 LOC changes)
   - Add generateNLPDataForCard function
   - Modify ProcessedRun constructor for reconstruction
   - Modify FingerprintGenerator for server IDF

5. **/Users/jkomoros/Code/card-web/src/selectors.ts** (~80 LOC changes)
   - Add selectServerIDF selector
   - Modify selectFingerprintGenerator to use server IDF
   - Modify selectCards to use stored NLP (fast path)

6. **/Users/jkomoros/Code/card-web/src/filters.ts** (~200 LOC changes)
   - Add filter classification logic
   - Add SIMPLE_FILTER_TYPES, COMPLEX_FILTER_TYPES
   - Add buildFirestoreQuery function

7. **/Users/jkomoros/Code/card-web/src/collection_description.ts** (~250 LOC changes)
   - Add getCollectionCount method
   - Add fetchCardIDs and loadCardBatch for pagination
   - Add classification caching

8. **/Users/jkomoros/Code/card-web/src/actions/collection.ts** (~100 LOC changes)
   - Add fetchCollectionCount thunk
   - Add loadMoreCards thunk

9. **/Users/jkomoros/Code/card-web/src/actions/editor.ts** (~50 LOC changes)
   - Add attachEditingCardListener function
   - Add detachEditingCardListener function
   - Modify editingStart and editingFinish

10. **/Users/jkomoros/Code/card-web/src/actions/app.ts** (~30 LOC changes)
    - Add loadServerIDF on app initialization

11. **/Users/jkomoros/Code/card-web/src/actions/maintenance.ts** (~100 LOC changes)
    - Add MIGRATE_NLP_DATA task
    - Add migration logic for 30k cards

12. **/Users/jkomoros/Code/card-web/src/components/main-view.ts** (~80 LOC changes)
    - Add scroll event listener
    - Add renderCollectionInfo method
    - Add loading indicators

13. **/Users/jkomoros/Code/card-web/src/util.ts** (~10 LOC changes)
    - Update fetchTypeIsUnpublished for new types

14. **/Users/jkomoros/Code/card-web/src/reducers/data.ts** (~40 LOC changes)
    - Add LOAD_SERVER_IDF reducer
    - Handle new fetch types

15. **/Users/jkomoros/Code/card-web/shared/types.ts** (~50 LOC changes)
    - Add NLPTokenStorage, ProcessedRunStorage types

16. **/Users/jkomoros/Code/card-web/firestore.indexes.json** (~15 LOC)
    - Add composite index for tier 3 query

17. **/Users/jkomoros/Code/card-web/storage.rules** (~5 LOC)
    - Add public read for /idf-maps/

18. **/Users/jkomoros/Code/card-web/functions/src/index.ts** (~10 LOC)
    - Export new calculateIDF function

### Total LOC Impact

**New code:** ~1,050 LOC
**Modified code:** ~1,435 LOC
**Net change:** ~2,485 LOC

---

## Appendix A: Key Design Decisions

### Decision 1: Client-Side NLP Computation

**Why:** Simpler than Cloud Functions, no cold starts, atomic with save

**Trade-off:** Adds 10-50ms to save time (acceptable)

### Decision 2: Store All NLP Tiers

**Why:** Maximum flexibility, enables Firestore Enterprise queries

**Trade-off:** +225% document size (+$0.10/month - negligible)

### Decision 3: Server IDF Map

**Why:** Consistent fingerprints across all users and sessions

**Trade-off:** Weekly computation cost ($0.004/month - negligible)

### Decision 4: 3-Tier Hot System

**Why:** Guarantees all prioritized cards loaded, fills remaining space with recent

**Trade-off:** +1k cards loaded (~17% increase - acceptable)

### Decision 5: Similarity Stays Server-Side

**Why:** Already using Qdrant embeddings (superior to TF-IDF)

**Trade-off:** None - leverage existing infrastructure

---

## Appendix B: Performance Targets

| Operation | Current | Target | Status |
|-----------|---------|--------|--------|
| Save operations P95 | 100-300ms | <500ms | ✅ No regression |
| Hot tier load | 2-3s | <5s | ✅ Acceptable |
| NLP computation on save | N/A | <50ms | ✅ Measured |
| IDF download (first time) | N/A | <300ms | ✅ Estimated |
| Server count (SIMPLE) | N/A | <200ms | ✅ Target |
| Pagination batch load | N/A | <300ms | ✅ Target |

---

## Appendix C: Glossary

- **Hot Tier**: Cards fetched via onSnapshot (real-time updates)
- **Discovered Tier**: Cards fetched on-demand via getDoc() (from Approach 5)
- **Prioritized**: Cards with `auto_todo_overrides.prioritized === false` (backwards logic)
- **NLP**: Natural Language Processing (Porter stemmer, stop words, TF-IDF)
- **IDF**: Inverse Document Frequency (for TF-IDF scoring)
- **SIMPLE Collection**: Can be executed server-side with Firestore queries
- **COMPLEX Collection**: Requires client-side filtering
- **ProcessedRun**: Represents a text run with all NLP processing tiers
- **Qdrant**: Vector database for semantic similarity (embeddings)

---

## Appendix D: Critique Findings & Resolutions

This appendix documents critical issues identified by 7 specialized critique agents and how they were resolved in the plan.

### Agent Findings Summary (2026-01-25)

#### 1. 3-Tier Hot System Validation (Agent a9ad224)

**Findings:**
- ✅ Firestore composite index already specified in section 1.4
- ⚠️ Tier 3 `!= false` query includes BOTH undefined AND true (not just unprioritized)
- ✅ Duplicate prevention works correctly (mutually exclusive tiers)

**Resolution:**
- Index specification confirmed complete (lines 181-199)
- Tier 3 query behavior documented as expected (includes all non-explicitly-prioritized cards)
- No changes needed

#### 2. NLP Save Flow Integration (Agent af82c2d)

**Findings:**
- ❌ `hasContentFieldChanges()` function doesn't exist - needs implementation
- ❌ `reconstructProcessedCardFromStorage()` doesn't exist - needs implementation
- ⚠️ Migration has NO concurrency protection (acceptable for solo user)
- ⚠️ Fast-path selector not yet implemented

**Resolution:**
- ✅ Added `hasContentFieldChanges()` implementation spec (section 2.3)
- ✅ Added `reconstructProcessedCardFromStorage()` implementation spec (section 2.5)
- Migration concurrency not critical (single editor user)
- Fast-path implementation covered in section 2.5

#### 3. Server IDF Architecture (Agent aa50b33)

**Findings:**
- ❌ Browser APIs in `nlp.ts` won't work on server (`document.createElement()`)
- ❌ `selectFallbackTextMapForCard()` doesn't exist (should be `backportFallbackTextMapForCard`)
- ⚠️ Bootstrap problem: What if IDF file doesn't exist initially?

**Resolution:**
- ✅ Added jsdom polyfill note (section 3.3) - simple DOM operations can use jsdom
- ✅ Corrected function name to `backportFallbackTextMapForCard()` (section 2.3)
- Bootstrap handled by client-side fallback to local IDF calculation (section 3.5)

#### 4. Collection Classification Completeness (Agent a38cc8f)

**Findings:**
- ❌ Only ~10 of 30+ filters classified in original plan
- ❌ Similarity NOT always server-side (has client TF-IDF fallback)
- ❌ Reading-list & stars stored in separate collections (cannot query via Firestore)

**Resolution:**
- ✅ Expanded section 4.1 to classify ALL 50+ filter types comprehensively
- ✅ Documented similarity as server-side (Qdrant embeddings, not TF-IDF)
- ✅ Classified reading-list, stars, read as COMPLEX (separate collections)
- ✅ Added query filters as SIMPLE with Firestore Enterprise, COMPLEX without

#### 5. Real-Time Editing Conflicts (Agent a56e07b)

**Findings:**
- ⚠️ `state.data.discoveredCards` not in TypeScript types (needs type update)
- ⚠️ Card can be in BOTH hot and discovered tier simultaneously
- ⚠️ Content fields (body, title) excluded from merge UI (silent overwrites possible)
- ⚠️ Listener not reattached when card moves between tiers

**Resolution:**
- Type update needed in implementation (not critical for plan)
- Simultaneous tier membership acceptable (hot tier wins, discovered evicted)
- Existing merge machinery handles all field conflicts (section 6.4)
- Listener lifecycle correct (attached on edit start, detached on finish)

#### 6. Migration Strategy Safety (Agent a4acff5)

**Findings:**
- 🔥 CRITICAL: All-at-once migration would freeze browser 30-60 minutes
- 🔥 CRITICAL: onSnapshot listener storm - 30k updates would freeze UI
- ❌ No checkpoint mechanism - crash requires full restart
- ❌ MultiBatch has no retry mechanism

**Resolution:**
- ✅ **MAJOR REVISION**: Implemented two-phase migration (section 8.1)
  - Phase 1: Mark cards with `nlp_version: 0` (lightweight, 10-15 min)
  - Phase 2: Lazy computation when cards loaded (zero perceived impact)
- Eliminates browser freeze and listener storm
- No checkpoint needed (lazy migration is resumable)
- Retry handled by background async save (non-blocking)

#### 7. Cost Analysis Accuracy (Agent af0a30c)

**Findings:**
- ✅ Storage cost correct: $0.10/month
- ⚠️ Read count underestimated (should be +150k/month not +3k)
- ✅ Migration cost correct: $0.054
- ❌ IDF function cost wrong: should be $0/month (free tier) not $0.004

**Resolution:**
- ✅ Updated read estimate to +150k/month (section 10.2)
- ✅ Corrected IDF function cost to $0/month (within free tier)
- ✅ Added variance note (+/- 50k reads depending on usage)
- Total monthly cost still ~$0.10/month (storage dominant)

### Critical Changes Made

1. **Migration Strategy** - Changed from all-at-once to two-phase lazy migration
2. **Filter Classification** - Expanded from ~10 to ALL 50+ filter types
3. **Missing Functions** - Added implementation specs for 3 functions
4. **Cost Analysis** - Corrected read estimates and Cloud Function costs
5. **Server IDF** - Added jsdom polyfill solution for browser APIs

### Outstanding Items for Implementation

- TypeScript types update for `state.data.discoveredCards`
- Firestore index deployment (already specified in plan)
- Two-phase migration maintenance tasks
- Complete filter classification algorithm implementation
- Jsdom dependency for Cloud Functions

---

## Appendix E: Reference Filters Analysis - Why They Stay Client-Side

This appendix documents the investigation (Agent a38aec5, 2026-01-25) into whether reference-based filters can be executed server-side with Firestore Enterprise Pipeline Operations, and whether we should change the references data model.

### Current References Data Model

References are stored using **two parallel fields**:

1. **`references_info`** (nested object - canonical source):
   ```typescript
   {
     "cardID_A": {
       "link": "text of the link",
       "ack": "",
       "citation": "Page 22"
     },
     "cardID_B": {
       "link": ""
     }
   }
   ```

2. **`references`** (flat boolean map - for Firestore queries):
   ```typescript
   {
     "cardID_A": true,
     "cardID_B": true
   }
   ```

**16 reference types**: link, ack, dupe-of, generic, fork-of, mined-from, see-also, concept, synonym, opposite-of, parallel-to, example-of, metaphor-for, citation, citation-person

**Design note from `/src/card_fields.ts`**: The `references` map exists because "it's not possible to query for the existence or non-existence of a subobject in Firestore."

### Why Reference Filters Are Client-Side

**Current implementation** (`/src/filters.ts`):
```typescript
// All reference filters test client-side
test: card => references(card).byType[key] !== undefined
```

**Reasons:**
1. **Nested object querying**: Traditional Firestore cannot query "does `references_info.link` exist?"
2. **Reference type filtering**: Requires checking if `references_info[cardID][referenceType]` exists
3. **Graph traversal**: Requires loading multiple cards and following reference chains (BFS/DFS)
4. **Complex extraction**: The `references()` function creates a `ReferencesAccessor` that processes nested structure

### Firestore Enterprise Pipeline Operations Limitations

**What Pipeline Operations provide:**
- `unnest()` - Flattens **arrays** (NOT objects with dynamic keys)
- `mapGet(field, key)` - Gets value from map by **known key** (can't iterate keys)
- `regex_match()`, `str_contains()` - String operations
- Complex field path queries

**Critical limitations for references:**
1. ❌ Cannot unnest `references_info` (object with dynamic card ID keys, not array)
2. ❌ No "get all keys from map" operation (cannot iterate reference types or card IDs)
3. ❌ Cannot check if nested object is non-empty server-side
4. ❌ Cannot do recursive queries (required for graph traversal)

**What you CAN'T do:**
- Query "all cards where `references.link` has any keys"
- Query "all cards where `references.link[someCardID]` exists" (without knowing someCardID)
- Iterate over reference types or card IDs dynamically
- Multi-hop graph traversal

### Data Model Alternatives Considered

#### Option A: Flat Arrays (Most Capable)

**Structure:**
```typescript
{
  reference_links: ['cardA', 'cardB'],
  reference_acks: ['cardC'],
  reference_citations: ['cardD', 'cardE'],
  reference_inbound_links: ['cardX', 'cardY'],
  // ... ~32 fields total (16 outbound + 16 inbound types)
}
```

**Enables:**
- ✅ `where('reference_links', '!=', [])` - has-links queries
- ✅ `where('reference_links', 'array-contains', cardID)` - parents/cardID queries
- ❌ Still can't do children/cardID (requires fetching cardID first, then querying - 2 steps)
- ❌ Still can't do descendants/ancestors (recursive traversal impossible)

**Costs:**
- 750 LOC changes across 6 files
- 2-3 weeks development + testing + migration
- **High desync risk**: Every reference mutation must update `references_info` + `references` + flat arrays
- Loses reference metadata (text values)
- ~32 new fields per card

#### Option B: Boolean Flags (Simplest)

**Structure:**
```typescript
{
  has_link_references: true,
  has_ack_references: false,
  has_inbound_link_references: true,
  // ... ~32 fields total
}
```

**Enables:**
- ✅ `where('has_link_references', '==', true)` - existence checks only
- ❌ No graph traversal
- ❌ Cannot query which specific cards are referenced

**Costs:**
- 450 LOC changes
- 1 week development
- Lower desync risk (simpler logic)

#### Option C: Count Fields

**Structure:**
```typescript
{
  reference_link_count: 5,
  reference_inbound_link_count: 3,
  // ...
}
```

**Enables:**
- ✅ `where('reference_link_count', '>', 0)` - existence checks
- ✅ Sorting by reference count
- ❌ No graph traversal
- ❌ Cannot query which specific cards

### Server-Side Feasibility Matrix

| Filter Type | Current | With Flat Arrays | With Flags | Notes |
|-------------|---------|------------------|------------|-------|
| `has-links` | CLIENT | ✅ SERVER | ✅ SERVER | `where('reference_links', '!=', [])` |
| `has-inbound-links` | CLIENT | ✅ SERVER | ✅ SERVER | Same as above |
| `has-substantive-references` | CLIENT | ✅ SERVER | ✅ SERVER | Combine types with OR |
| `has-[refType]-references` | CLIENT | ✅ SERVER | ✅ SERVER | All 16 types |
| `parents/[cardID]` | CLIENT | ✅ SERVER | ❌ CLIENT | `array-contains` query works! |
| `children/[cardID]` | CLIENT | ❌ CLIENT | ❌ CLIENT | Requires 2-step query |
| `descendants/[cardID]` | CLIENT | ❌ CLIENT | ❌ CLIENT | Recursive - impossible |
| `ancestors/[cardID]` | CLIENT | ❌ CLIENT | ❌ CLIENT | Recursive - impossible |
| `connections/[cardID]` | CLIENT | ❌ CLIENT | ❌ CLIENT | Bidirectional + recursive |

**Key finding**: Even with best data model, **graph traversal filters remain CLIENT** because Firestore cannot do recursive queries.

### Decision: Keep Client-Side

**Rationale:**

1. **Limited benefit** - Can only make ~8 filters server-side (`has-*-references` variants)
2. **Cannot fix the important ones** - Graph traversal (children/parents/descendants/ancestors) remains CLIENT due to fundamental Firestore limitation
3. **High complexity** - 750 LOC changes, 2-3 weeks dev time, significant desync risk
4. **Maintenance burden** - Every reference mutation becomes 3x more complex (update 3+ fields)
5. **Enterprise Pipeline doesn't help** - New operations don't solve core problems:
   - Cannot query nested object keys dynamically
   - Cannot do recursive traversal
   - Cannot check if map is non-empty
6. **Existing workaround works** - The `references` boolean map already enables critical query pattern when needed

**Alternative considered:**
- **Option B (Flags)** for small win - Add `has_link_references`, `has_inbound_link_references` only
- Only 4-6 boolean fields
- 1 week effort
- Enables basic existence queries
- **Rejected**: Not worth complexity for such limited benefit

### Graph Traversal: Why It's Impossible Server-Side

**Fundamental limitations:**
1. **Firestore has no recursive queries** - Cannot follow reference chains across documents
2. **Multi-hop traversal requires iteration** - descendants/2 needs: fetch card → get children → fetch children → get their children
3. **BFS/DFS algorithms are client-side** - Cannot be expressed as Firestore query
4. **Would need multiple round-trips** - Each hop is a separate query

**Example: `descendants/cardX/2`**
```typescript
// Hop 1: Get cardX's children
const children = getCardReferences(cardX);

// Hop 2: Get children's children
const grandchildren = [];
for (const child of children) {
  grandchildren.push(...getCardReferences(child));
}

// Union all
return [cardX, ...children, ...grandchildren];
```

This requires:
- Fetching cardX
- Fetching N children (where N = number of references)
- Fetching M grandchildren (where M = total references from all children)
- **3+ database round-trips minimum**
- Client-side logic to manage iteration and deduplication

**No data model change can fix this** - it's a fundamental architectural limitation of document databases.

### Conclusion

Reference filters should **remain CLIENT-SIDE**. Focus optimization efforts on:
1. Caching filter results client-side
2. Optimizing the `references()` accessor function
3. Using discovered tier to lazy-load cards as needed
4. Waiting for future Firestore features (if they add recursive query support)

**Implementation note**: The existing `references` boolean map already provides a workaround for the most critical query pattern: checking if a specific card is referenced. This is sufficient for current needs.

---

## Revision History

- **v2.3** (2026-01-26): Firestore Enterprise capabilities clarification
  - Added comprehensive section on Firestore Enterprise Edition (NEW in Jan 2026)
  - Documented Pipeline Operations: 100+ new server-side query capabilities
  - Clarified `select()` stage for field projection (fetch only specific fields)
  - Comparison table: Standard Firestore vs Enterprise Edition
  - Documented covered queries for cost optimization
  - Corrected misconception about field selection not being supported
  - Research confirmed: Enterprise supports field projection, ID-only fetches possible with covered queries
  - Agent investigation: a6b180f (Firestore Enterprise capabilities research)
- **v2.2** (2026-01-25): Reference filters analysis and composition filter details
  - Added Appendix E: Complete analysis of reference filters server-side feasibility
  - Decision: Keep reference filters CLIENT-SIDE (graph traversal impossible server-side)
  - Added section 4.2: Detailed composition filter analysis (union, combine, exclude, expand)
  - Updated filter classification summary to 60+ filters with HYBRID category
  - Documented Firestore Enterprise Pipeline limitations for nested objects
  - Agent investigations: afaf554 (union/combine), a04a1ed (exclude/expand), a38aec5 (references)
- **v2.1** (2026-01-25): Major updates based on 7-agent critique
  - Two-phase migration strategy (critical safety fix)
  - Complete filter classification (50+ filters)
  - Missing function implementation specs added
  - Cost analysis corrections
  - Server IDF browser API solution
- **v2.0** (2026-01-25): Initial canonical plan incorporating all agent designs
- Future revisions will be documented here

---

**END OF CANONICAL PLAN**
