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
    },
    {
      "collectionGroup": "cards",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "published", "order": "ASCENDING" },
        { "fieldPath": "section", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "cards",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "card_type", "order": "ASCENDING" },
        { "fieldPath": "updated_substantive", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "cards",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "tags", "arrayConfig": "CONTAINS" },
        { "fieldPath": "updated_substantive", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "cards",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "author", "order": "ASCENDING" },
        { "fieldPath": "created", "order": "DESCENDING" }
      ]
    }
  ]
}
```

**Notes:**
- Tier 2 query (prioritized cards) does NOT require an index because it only uses equality filters without orderBy
- Additional indexes above support common SIMPLE collection queries (section + sort, type + sort, tag + sort, author + sort)
- Firestore will request additional indexes as needed when queries fail in development

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

### 4.6 "Fetch IDs Only" Pattern Clarification

**IMPORTANT**: There is NO built-in "fetch only document IDs" operation in Firestore. The `select()` stage (Firestore Enterprise Pipeline Operations) can project specific fields, but:

1. **Read charges still apply** - Every document matched counts as a read
2. **Network transfer reduced** - Smaller payloads when projecting fewer fields
3. **Covered queries** - If `select()` only requests fields in the index, Firestore reads from index only (cheaper, faster)

**For Simple Collections:**
- Option A: Use `select('__name__')` to fetch only document IDs (Firestore Enterprise)
  - Still charges full read units per document
  - Reduces network transfer
  - Requires Enterprise Edition
- Option B: Fetch full documents in batches (Standard Firestore)
  - Same read cost as option A
  - More network transfer
  - Works with Standard Firestore

**Recommendation**: For most use cases, fetching full documents in batches (Option B) is simpler and doesn't require Enterprise Edition. Only use Option A if network bandwidth is a significant concern.

### 4.7 Pagination for SIMPLE Collections

**Two-Phase Fetch Pattern:**

1. **Phase 1:** Fetch card IDs or full cards from server
2. **Phase 2:** Load batches progressively (for pagination)

**Implementation:**

```typescript
class SimplifiedCollection {
  private cards: Card[] = [];
  private visibleCards: Card[] = [];

  async initialize() {
    // Fetch initial batch with server-side query
    await this.fetchCardBatch(50);

    // Get count from server
    this.totalCount = await this.getServerCount();
  }

  async fetchCardBatch(limit: number): Promise<void> {
    const q = query(
      collection(db, CARDS_COLLECTION),
      ...this.classification.firestoreConstraints,
      orderBy(this.sortField, this.sortDirection),
      limit(limit)
    );

    const snapshot = await getDocs(q);
    this.cards = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()} as Card));
    this.visibleCards = this.cards;
  }

  async getServerCount(): Promise<number> {
    const q = query(
      collection(db, CARDS_COLLECTION),
      ...this.classification.firestoreConstraints
    );

    const snapshot = await getCountFromServer(q);
    return snapshot.data().count;
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

### Timeline Overview

**Total Duration:** 15-17 weeks (not 10 weeks as initially estimated)

**Critical Path:**
- Phase 0.5 (Firestore Index) → Phase 1 (3-Tier) → Phase 2 (NLP Storage) → Phase 7 (Migration)
- Phase 3 (Server IDF) can run parallel to Phase 4-5 after Phase 2
- Phase 8 (Monitoring) must complete before Phase 9 (Canary)

**Risk Buffer:** 2 weeks built into timeline for unexpected issues

---

### Phase 0.5: Firestore Index Deployment (Week 0 - CRITICAL)

**Goal:** Deploy Firestore composite index BEFORE any code changes

**Why Critical:**
- Firestore indexes can take 10-30 minutes to build (sometimes hours for large collections)
- Code will FAIL HARD if index doesn't exist (queries will throw errors)
- Must be deployed to production before Phase 1

**Tasks:**
1. Add composite index to `firestore.indexes.json`
2. Deploy index: `firebase deploy --only firestore:indexes`
3. Monitor index build status in Firebase Console
4. Verify index is ACTIVE before proceeding
5. Test query works with new index

**Index Specification:**
```json
{
  "collectionGroup": "cards",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "published", "order": "ASCENDING" },
    { "fieldPath": "auto_todo_overrides.prioritized", "order": "ASCENDING" },
    { "fieldPath": "created", "order": "DESCENDING" }
  ]
}
```

**Success Criteria:**
- Index shows ACTIVE status in Firebase Console
- Test query returns results without errors
- No performance degradation on existing queries
- Index build completes in <30 minutes

**Rollback Plan:**
- If index fails, code changes CANNOT proceed
- Can delete index via Console or CLI
- No user impact (index-only change)

---

### Phase 1: 3-Tier Hot System (Week 1-2)

**Goal:** Replace 2-tier with 3-tier card loading

**Dependencies:** Phase 0.5 (Firestore Index) MUST complete first

**Tasks:**
1. Add new CardFetchType enum values (`unpublished-prioritized`, `unpublished-recent`)
2. Modify `connectLiveUnpublishedCards()` with 3 queries
3. Update `cullExtraCompleteModeCards()` for tier-aware culling
4. Update TypeScript types for new fetch types
5. Test tier transitions and duplicate prevention
6. Add unit tests for tier classification logic

**Success Criteria:**
- All 3 tiers load correctly with no errors
- No duplicate cards across tiers (verified by card ID uniqueness check)
- Cards move between tiers gracefully (no flashing or re-renders)
- Tier 1 + 2 total: ~6,900 cards (verified by card count)
- Performance: Tier load time <5 seconds P95 (no regression from <3s baseline)
- Memory usage: <15% increase from baseline (~20MB → ~23MB)

**Rollback Plan:**
- Feature flag: `ENABLE_3_TIER_HOT_SYSTEM = false`
- Falls back to 2-tier system (existing code path)

---

### Phase 2: NLP Data Storage (Week 3-5)

**Goal:** Store NLP data on cards, compute on save

**Dependencies:** Phase 1 (3-Tier System)

**Tasks:**
1. Add nlp_tokens, nlp_fingerprint, nlp_version to Card interface
2. Implement `generateNLPDataForCard()` in nlp.ts
3. Implement `reconstructProcessedCardFromStorage()` in nlp.ts
4. Implement `hasContentFieldChanges()` helper function
5. Integrate into `modifyCardWithBatch()` save flow
6. Modify ProcessedRun to support reconstruction from storage
7. Update selectors to use stored NLP (fast path)
8. Create Phase 1 migration task (mark cards with nlp_version: 0)
9. Create Phase 2 lazy computation logic
10. Test save flow with various card types

**Success Criteria:**
- Save performance: P50 <250ms, P95 <500ms, P99 <800ms (no regression from P95 <300ms baseline)
- NLP computation time: <50ms P95 for typical card
- New cards have nlp_tokens populated correctly
- Old cards work with fallback to computation
- Stored NLP data matches computed NLP (spot-check 100 random cards)
- Document size increase: <30KB P95 (target: ~18KB typical)
- Phase 1 migration marks all cards in <20 minutes

**Rollback Plan:**
- Feature flag: `ENABLE_STORED_NLP_DATA = false`
- Falls back to on-the-fly computation
- Stored nlp_tokens ignored (no data loss)

---

### Phase 3: Server IDF Map (Week 6-7)

**Goal:** Server-maintained IDF for consistent TF-IDF

**Dependencies:** Phase 2 (NLP Storage) - can run parallel to Phase 4-5

**Tasks:**
1. Create shared NLP utilities in `/shared/nlp_core.ts`
2. Add jsdom dependency for server-side DOM operations
3. Implement scheduled Cloud Function for IDF calculation
4. Create `IDFCache` class with localStorage caching
5. Modify `FingerprintGenerator` to accept server IDF
6. Add app initialization IDF download
7. Update storage.rules for public access to `/idf-maps/`
8. Test weekly Cloud Function execution
9. Test IDF cache expiration and refresh

**Success Criteria:**
- IDF map generated successfully on server (verified by file in Storage)
- IDF calculation completes in <60 seconds (target: <30s)
- Clients download and cache IDF on first load
- IDF download time: <300ms P95 (gzipped ~50-150KB)
- Fingerprints consistent across sessions (compare 10 random cards before/after)
- Fallback to client IDF works when server IDF unavailable
- localStorage cache respects 7-day TTL

**Rollback Plan:**
- Feature flag: `ENABLE_SERVER_IDF = false`
- Falls back to client-side IDF calculation
- Cloud Function can be disabled without impact

---

### Phase 4: Simple Collections & Pagination (Week 8-10)

**Goal:** Server counts and pagination for simple collections

**Dependencies:** Phase 2 (NLP Storage) - can run parallel to Phase 3

**Tasks:**
1. Implement filter classification logic (SIMPLE vs COMPLEX)
2. Add classification for all 50+ filter types
3. Add `getCollectionCount()` with getCountFromServer
4. Implement two-phase fetch (IDs then cards)
5. Add scroll-based pagination trigger (load at 80% scroll)
6. Update UI to show exact vs approximate counts
7. Add discovered tier integration for pagination
8. Test with various collection types
9. Performance test pagination with 10k+ card collections

**Success Criteria:**
- SIMPLE collections show exact counts (badge: "Server-side count")
- COMPLEX collections show approximate counts (badge: "Approximate")
- Count accuracy: 100% for SIMPLE, >95% for COMPLEX
- Server count latency: <200ms P95
- Pagination loads 50 cards per batch
- Pagination batch load time: <300ms P95
- Scroll triggering works smoothly (no jank, no duplicate loads)
- Memory efficient: Only visible cards rendered

**Rollback Plan:**
- Feature flag: `ENABLE_SIMPLE_COLLECTIONS = false`
- Falls back to full collection loading (existing behavior)

---

### Phase 5: Real-Time Editing Conflicts (Week 11)

**Goal:** Detect concurrent edits on non-hot cards

**Dependencies:** Phase 1 (3-Tier System) - can run parallel to Phase 3-4

**Tasks:**
1. Add `attachEditingCardListener()` in editingStart
2. Add `detachEditingCardListener()` in editingFinish
3. Update TypeScript types for discoveredCards state
4. Test with concurrent edits (simulate multi-user scenario)
5. Verify existing merge machinery works
6. Test listener lifecycle (attach/detach)
7. Test with cards in different tiers

**Success Criteria:**
- Listener attached for non-hot cards only
- Listener not attached for hot-tier cards (redundant)
- Merge button appears on conflict (existing UI)
- Merge works correctly (no data loss)
- Listener detached on editor close
- No memory leaks from listeners
- Performance: Listener attachment <10ms

**Rollback Plan:**
- Feature flag: `ENABLE_EDITING_LISTENERS = false`
- Falls back to no conflict detection (existing behavior)
- Users warned about potential edit conflicts

---

### Phase 6: Security Rules & Permissions (Week 12)

**Goal:** Update Firestore security rules and storage rules

**Dependencies:** Phase 3 (Server IDF)

**Tasks:**
1. Review current security rules for compatibility
2. Add storage rules for public IDF map access
3. Test rules with different user permissions
4. Test rules with unauthenticated users
5. Verify no security regressions
6. Deploy rules to staging first
7. Deploy rules to production

**Security Rules Changes:**
```
// storage.rules
match /idf-maps/{fileName} {
  allow get: if true;  // Public read for IDF maps
}
```

**Success Criteria:**
- Authenticated users can read/write cards (no regression)
- Unauthenticated users can read IDF maps only
- No unauthorized access to card data
- Rules deploy without errors
- Security audit passes (verify with test accounts)

**Rollback Plan:**
- Revert storage rules via `firebase deploy --only storage`
- Immediate rollback possible (<1 minute)

---

### Phase 7: Data Migration Execution (Week 13)

**Goal:** Execute NLP data migration for all 30k cards

**Dependencies:** Phase 2 (NLP Storage), Phase 8 (Monitoring)

**Tasks:**
1. Run Phase 1 migration: Mark all cards with `nlp_version: 0`
2. Monitor migration progress (logs, error rate)
3. Verify cards marked correctly (sample 100 random cards)
4. Enable Phase 2 lazy computation
5. Monitor lazy computation over 1 week
6. Spot-check NLP correctness (sample 50 cards)
7. Monitor performance metrics
8. Check for errors or anomalies

**Migration Timeline:**
- Phase 1: 10-20 minutes (mark 30k cards)
- Phase 2: 2-4 weeks (lazy computation as cards accessed)
- Total cost: $0.054 (one-time)

**Success Criteria:**
- Phase 1 completes in <20 minutes
- 100% of cards marked with `nlp_version: 0`
- No errors during Phase 1 migration
- Lazy computation works (verified by checking cards have `nlp_version: 1` after access)
- No performance regression during lazy migration
- Spot-check accuracy: >99% (allow for edge cases)
- No user-visible impact

**Rollback Plan:**
- Phase 1 is reversible (clear `nlp_version` field)
- Phase 2 is non-blocking (disable via feature flag)
- If critical issues found, disable lazy computation and investigate

---

### Phase 8: Monitoring & Observability (Week 14)

**Goal:** Add comprehensive monitoring and alerting

**Dependencies:** None - can start early (recommended)

**Tasks:**
1. Add performance metrics collection
   - Save operation latency (P50, P95, P99)
   - NLP computation time
   - Tier load time
   - Collection count latency
   - Pagination load time
2. Add error tracking
   - Migration errors
   - NLP computation failures
   - Index query failures
   - Listener attachment failures
3. Add logging for critical events
   - Tier transitions
   - Migration progress
   - IDF download success/failure
   - Fallback activations
4. Set up alerts
   - Save latency >1s P99
   - Error rate >1%
   - Migration stalls
5. Create monitoring dashboard
6. Test alerts trigger correctly

**Metrics to Track:**
- Save operations: P50, P95, P99 latency
- Tier load time: P50, P95
- NLP computation: P50, P95 duration
- Collection counts: accuracy, latency
- Error rates by phase/feature
- Feature flag states
- Cache hit rates (IDF, discovered tier)

**Success Criteria:**
- All metrics collected correctly
- Dashboard shows real-time data
- Alerts trigger within 5 minutes of issue
- No sensitive data in logs
- Performance overhead <5ms per operation

**Rollback Plan:**
- Monitoring is non-blocking (can disable without impact)
- Reduce logging verbosity if performance impact detected

---

### Phase 9: Canary Deployment (Week 15)

**Goal:** Gradual rollout with canary testing

**Dependencies:** Phase 8 (Monitoring), all feature phases complete

**Tasks:**
1. Deploy to staging environment (full test)
2. Run automated test suite
3. Manual QA testing (save, load, search, edit)
4. Enable for 5% of users (canary cohort)
5. Monitor metrics for 48 hours
6. Compare canary vs control group
7. If successful, increase to 25%
8. Monitor for 48 hours
9. If successful, increase to 100%
10. Monitor for 1 week

**Canary Groups:**
- 5% cohort: Early adopters (days 1-2)
- 25% cohort: Broader test (days 3-4)
- 100% rollout: Full deployment (day 5+)

**Success Criteria:**
- Canary group shows no performance regression
- Error rate <0.5% (lower than control group baseline <1%)
- No user-reported issues
- All feature flags enabled successfully
- Metrics within acceptable ranges (see Phase 8)
- Save performance: P95 <500ms (no regression)

**Rollback Triggers:**
- Error rate >2%
- Save latency P99 >1.5s (>50% regression)
- User-reported data loss
- Critical bugs discovered

**Rollback Plan:**
- Disable feature flags (affects canary group only)
- Rollback time: <5 minutes
- Full rollback via deployment revert: <15 minutes

---

### Phase 10: Production Hardening & Docs (Week 16-17)

**Goal:** Production readiness, documentation, post-launch optimization

**Dependencies:** Phase 9 (Canary Deployment)

**Tasks:**
1. Comprehensive testing
   - Unit tests for all new functions (>80% coverage)
   - Integration tests for end-to-end flows
   - Performance testing (load testing with 30k cards)
   - Regression testing (verify no existing features broken)
   - Edge case testing (empty cards, large cards, concurrent edits)
2. Performance optimization
   - Profile NLP computation bottlenecks
   - Optimize filter classification logic
   - Reduce unnecessary re-renders
3. Documentation
   - Update README with new architecture
   - Document feature flags
   - Add troubleshooting guide
   - Document rollback procedures
4. Code cleanup
   - Remove dead code
   - Add inline comments for complex logic
   - Clean up console.logs
5. Post-launch monitoring
   - Watch metrics for 1 week
   - Address any performance issues
   - Fix minor bugs

**Success Criteria:**
- Test coverage >80% for new code
- All performance targets met (see Appendix B)
- Zero critical bugs
- Documentation complete
- Code review approved
- Monitoring shows stable metrics
- No rollbacks needed

**Performance Targets (Final Validation):**
- Save operations: P50 <200ms, P95 <500ms, P99 <800ms
- Tier load time: <5s P95
- NLP computation: <50ms P95
- IDF download: <300ms P95
- Server count (SIMPLE): <200ms P95
- Pagination batch: <300ms P95
- Memory usage: <15% increase from baseline

**Rollback Plan:**
- Full deployment revert possible if critical issues found
- Rollback time: <30 minutes
- All data safe (migrations are non-destructive)
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

**Performance:
- **Phase 1**: 30k cards × 1 write = ~10-15 minutes
- **Phase 2**: Lazy over weeks/months (zero perceived impact)
- **Total cost**: $0.054 (30k writes × $0.0018 per 100k)
- **UX impact**: None (no browser freeze, no listener storm)

### 8.2 Lazy Computation Triggers (Comprehensive)

Cards marked with `nlp_version: 0` will automatically have their NLP computed and saved when triggered by ANY of these events:

**Primary Triggers:**
1. **Hot Tier Load** - Card enters published/prioritized/recent tier via onSnapshot
2. **User Edit** - Card opened in editor and modified
3. **Discovered Tier Fetch** - Card fetched on-demand via `getDoc()`

**Secondary Triggers:**
4. **Collection Display** - Card rendered in any collection view
5. **Card Preview** - Card shown in hover preview or reference panel
6. **Search Result** - Card appears in search results (triggers NLP for ranking)
7. **Similar Cards Computation** - Card used as similarity seed
8. **Fingerprint Generation** - Auto-title computation requires NLP
9. **Export Operations** - Card included in bulk export
10. **Maintenance Tasks** - Batch operations that process cards

**Coverage Guarantee:** Since ALL card access routes through selectors that use `getProcessedCard()`, every card will eventually be migrated through normal usage. Published and prioritized cards (~6,900) will migrate within first week. Remaining cards migrate as accessed.

### 8.3 Handling Partial Migrations

**Scenario:** Migration interrupted due to deployment, browser crash, or user session end.

**Built-In Resilience:**

1. **Idempotent Operations** - `nlp_version: 0` marker is idempotent (can set multiple times)
2. **Resumable Phase 1** - If marking cards fails mid-batch, restart marks only unmarked cards
3. **Resumable Phase 2** - Lazy computation automatically resumes on next access
4. **No Coordination Required** - Each card migrates independently (no ordering dependencies)

**Progress Tracking:**

Add maintenance task to report migration status:

```typescript
export const checkNLPMigrationProgress = async (): Promise<MigrationStatus> => {
  const totalCards = await getCountFromServer(
    query(collection(db, CARDS_COLLECTION))
  );

  const migratedCards = await getCountFromServer(
    query(
      collection(db, CARDS_COLLECTION),
      where('nlp_version', '>=', 1)  // Current or future versions
    )
  );

  const markedForMigration = await getCountFromServer(
    query(
      collection(db, CARDS_COLLECTION),
      where('nlp_version', '==', 0)  // Marked but not yet migrated
    )
  );

  return {
    total: totalCards.data().count,
    migrated: migratedCards.data().count,
    pending: markedForMigration.data().count,
    percentComplete: (migratedCards.data().count / totalCards.data().count) * 100
  };
};
```

**Partial Migration States:**

| State | nlp_version | nlp_tokens | Behavior |
|-------|-------------|------------|----------|
| **Unmarked** | `undefined` | `undefined` | Compute NLP on every access (legacy) |
| **Marked** | `0` | `undefined` | Compute NLP + save on first access |
| **Migrated** | `1` | Present | Use stored NLP (fast path) |
| **Mixed** | Varies | Varies | Different cards in different states (SAFE) |

**Safety:** All three states work correctly. No card is ever unreadable due to partial migration.

### 8.4 Monitoring During Migration

**Key Metrics to Track:**

1. **Migration Progress**
   - Cards marked for migration (`nlp_version: 0`)
   - Cards successfully migrated (`nlp_version: 1`)
   - Percentage complete
   - Estimated time to 95% completion

2. **Performance Impact**
   - Average save time (P50, P95, P99)
   - NLP computation time per card
   - Background save success rate
   - Failed NLP saves (retry queue depth)

3. **Error Rates**
   - Failed background saves (permissions, network)
   - NLP computation errors (malformed cards)
   - Storage quota exceeded errors

4. **Resource Usage**
   - Client memory usage (ProcessedCard cache)
   - Firestore write operations (should stay within free tier)
   - localStorage size (IDF cache)

**Monitoring Implementation:**

```typescript
// File: /src/actions/monitoring.ts (NEW)
export class MigrationMonitor {
  private metrics: MigrationMetrics = {
    nlpComputeCount: 0,
    nlpSaveCount: 0,
    nlpSaveFailures: 0,
    totalComputeTimeMs: 0,
    averageComputeTimeMs: 0
  };

  recordNLPComputation(timeMs: number) {
    this.metrics.nlpComputeCount++;
    this.metrics.totalComputeTimeMs += timeMs;
    this.metrics.averageComputeTimeMs =
      this.metrics.totalComputeTimeMs / this.metrics.nlpComputeCount;

    // Alert if computation time exceeds threshold
    if (timeMs > 100) {
      console.warn(`Slow NLP computation: ${timeMs}ms`);
    }
  }

  recordNLPSave(success: boolean) {
    if (success) {
      this.metrics.nlpSaveCount++;
    } else {
      this.metrics.nlpSaveFailures++;

      // Alert if failure rate exceeds 5%
      const failureRate = this.metrics.nlpSaveFailures /
        (this.metrics.nlpSaveCount + this.metrics.nlpSaveFailures);
      if (failureRate > 0.05) {
        console.error(`NLP save failure rate: ${(failureRate * 100).toFixed(1)}%`);
      }
    }
  }

  getMetrics(): MigrationMetrics {
    return { ...this.metrics };
  }

  persistMetrics() {
    localStorage.setItem('migration_metrics', JSON.stringify(this.metrics));
  }
}
```

**Alerting Thresholds:**
- NLP computation time > 100ms → Warning
- Save failure rate > 5% → Error
- Memory usage > 500MB → Warning
- Migration stalled (no progress for 24 hours) → Warning

### 8.5 Performance Impact During Migration

**Expected Impact:**

| Phase | Operation | Impact | Mitigation |
|-------|-----------|--------|------------|
| **Phase 1** | Marking Cards | NONE | Happens in maintenance task |
| **Phase 2** | First Access | +10-50ms NLP compute | Acceptable |
| **Phase 2** | Background Save | NONE | Async, non-blocking |
| **Post-Migration** | All Access | -95% compute time | Huge WIN |

**Detailed Analysis:**

1. **Phase 1 (Marking): No User Impact**
   - Runs as maintenance task in background
   - Takes 10-15 minutes, user can continue working
   - No UI freeze, no perceived slowdown

2. **Phase 2 (Lazy Migration): Minimal Impact**
   - Only affects FIRST access to each card
   - NLP computation: 10-50ms (already happens on save)
   - Background save: Async via Firestore SDK
   - Subsequent accesses use fast path

3. **Post-Migration: Massive Performance Improvement**
   - 95% reduction in client-side NLP computation
   - Selectors run 10-50ms faster per card
   - Filter evaluation faster
   - Search faster

**Memory Impact:** ZERO (ProcessedCard reconstructed from storage has same footprint)

**Network Impact:**
- Phase 1: 30k writes × ~50 bytes = 1.5 MB (spread over 10-15 min)
- Phase 2: 30k writes × ~18 KB avg = 540 MB (spread over weeks/months)
- Bandwidth: Negligible (<1 MB/day amortized)

### 8.6 Data Consistency Guarantees

**Consistency Model:** Eventual consistency with guaranteed correctness

**Consistency Invariants:**

✅ **Invariant 1: Readable at All Times**
- Every card state (unmarked, marked, migrated) has valid read path
- No card ever becomes "unreadable" during migration

✅ **Invariant 2: Write-Once Per Card**
- Each card migrated exactly once (unless error requires retry)
- `nlp_version: 0 → 1` transition is one-way

✅ **Invariant 3: Content-NLP Sync**
- If card content changes during migration, new NLP computed on save
- `hasContentFieldChanges()` check ensures NLP always matches content

✅ **Invariant 4: Version Monotonicity**
- `nlp_version` only increases (never decreases)
- Future migrations (v2, v3) can use same pattern

**Race Conditions Handled:**

1. **Concurrent Edit During Migration**
   - Resolution: Last write wins (Firestore atomic updates)
   - Outcome: Card gets latest content + latest NLP ✅

2. **Multiple Browser Tabs**
   - Resolution: Both saves write identical NLP data (idempotent)
   - Outcome: No corruption, minor redundant write ✅

3. **Save Collision**
   - Resolution: User save takes precedence (includes fresh NLP)
   - Outcome: Correct final state ✅

**Consistency Verification:**

```typescript
export const verifyNLPConsistency = async (sampleSize = 100): Promise<ConsistencyReport> => {
  const migratedCards = await getDocs(
    query(
      collection(db, CARDS_COLLECTION),
      where('nlp_version', '==', 1),
      limit(sampleSize)
    )
  );

  let inconsistencies = 0;
  for (const doc of migratedCards.docs) {
    const card = doc.data() as Card;
    const freshNLP = generateNLPDataForCard(card, state);

    if (!deepEqual(freshNLP.nlp_tokens, card.nlp_tokens)) {
      inconsistencies++;
      console.warn(`Inconsistent NLP for card ${card.id}`);
    }
  }

  return {
    sampleSize: migratedCards.size,
    inconsistencies,
    consistencyRate: ((migratedCards.size - inconsistencies) / migratedCards.size) * 100
  };
};
```

**Expected Consistency Rate:** 99.9%+

### 8.7 Rollback Strategy

**Feature Flags:**

```typescript
// File: /src/feature_flags.ts
export const FEATURE_FLAGS = {
  ENABLE_3_TIER_HOT_SYSTEM: true,
  ENABLE_STORED_NLP_DATA: true,      // Controls fast path
  ENABLE_SERVER_IDF: true,
  ENABLE_SIMPLE_COLLECTIONS: true,
  ENABLE_EDITING_LISTENERS: true,

  // Emergency kill switches
  FORCE_RECOMPUTE_NLP: false,        // Ignore stored NLP, always compute
  DISABLE_NLP_BACKGROUND_SAVE: false // Don't save NLP (read-only mode)
};
```

**Rollback Scenarios:**

#### Scenario 1: Stored NLP Causing Errors

**Symptoms:** Cards render incorrectly, search broken, fingerprints wrong

**Rollback Procedure:**
1. Set `ENABLE_STORED_NLP_DATA = false` (forces fallback to computation)
2. Deploy config update (30 seconds)
3. Clear client caches: `localStorage.clear()`, refresh tabs
4. Verify cards render correctly (fallback path)
5. Investigate root cause
6. Fix issue, re-enable flag

**Recovery Time:** <5 minutes
**Data Impact:** NONE (no data deleted, just ignored)
**User Impact:** Slight performance regression, but full functionality

#### Scenario 2: Migration Causing Performance Issues

**Symptoms:** Browser slowdowns, excessive memory usage, save timeouts

**Rollback Procedure:**
1. Set `DISABLE_NLP_BACKGROUND_SAVE = true` (stop migration)
2. Investigate: Check metrics, identify problematic cards
3. Fix issue (e.g., skip cards >100KB, optimize NLP)
4. Resume migration with fix

**Recovery Time:** Immediate (stop migration), resume when fixed
**Data Impact:** Migration paused (resumable later)
**User Impact:** NONE (migration is background)

#### Scenario 3: Server IDF Corruption

**Symptoms:** Fingerprints inconsistent, auto-titles broken

**Rollback Procedure:**
1. Set `ENABLE_SERVER_IDF = false` (use client-side IDF)
2. Delete corrupted IDF from Cloud Storage
3. Manually trigger IDF recalculation Cloud Function
4. Verify new IDF correctness
5. Re-enable server IDF

**Recovery Time:** 10-15 minutes (IDF recalculation)
**Data Impact:** NONE (fallback to client IDF)
**User Impact:** Slight fingerprint variations during fallback

#### Scenario 4: 3-Tier System Causing Duplicates

**Symptoms:** Duplicate cards in UI, cards in wrong tiers

**Rollback Procedure:**
1. Set `ENABLE_3_TIER_HOT_SYSTEM = false` (revert to 2-tier)
2. Restart Firestore listeners (reconnect)
3. Verify no duplicates
4. Investigate tier boundary conditions
5. Fix and re-enable

**Recovery Time:** <2 minutes (listener restart)
**Data Impact:** NONE (no Firestore changes)
**User Impact:** Brief UI refresh, then normal operation

**Complete Rollback (Nuclear Option):**

If multiple components fail:

1. Set ALL feature flags to `false`
2. Clear all caches (localStorage, IndexedDB, service worker)
3. Redeploy previous stable version
4. Verify full system functionality
5. Investigate issues in isolated dev environment
6. Incremental re-enable with fixes

**Recovery Time:** 10-15 minutes (full redeploy)
**Data Impact:** NONE (all new fields optional, backward compatible)
**User Impact:** Brief downtime, then back to pre-migration state

**Rollback Testing:**

```typescript
// File: /test/rollback_test.ts
describe('Migration Rollback', () => {
  it('should work with stored NLP disabled', async () => {
    FEATURE_FLAGS.ENABLE_STORED_NLP_DATA = false;
    const card = await selectProcessedCard('test-card');
    expect(card.nlp).toBeDefined();  // Computed on-the-fly
  });

  it('should work with 3-tier disabled', async () => {
    FEATURE_FLAGS.ENABLE_3_TIER_HOT_SYSTEM = false;
    await connectLiveCards();
    const cards = selectCards();
    expect(hasDuplicates(cards)).toBe(false);
  });

  it('should work with server IDF disabled', async () => {
    FEATURE_FLAGS.ENABLE_SERVER_IDF = false;
    const generator = selectFingerprintGenerator();
    expect(generator).toBeDefined();  // Uses client IDF
  });
});
```

### 8.8 Cloud Function NLP Computation Feasibility

**Question:** Can Cloud Functions run NLP computation (needs jsdom, node environment)?

**Answer:** ✅ YES - Fully supported

**Evidence:**

1. **jsdom Already Available**
   - Package: `jsdom@22.1.0` in `/functions/package.json` ✅
   - TypeScript types: `@types/jsdom@21.1.4` ✅
   - Already used for server-side HTML processing

2. **Node Environment Compatible**
   - Cloud Functions run Node 20 (specified in `engines`)
   - NLP utilities only use basic DOM operations (createElement, textContent)
   - No browser-specific APIs (window, navigator, etc.)

3. **Polyfill Pattern**
   ```typescript
   // In Cloud Function before NLP computation
   import { JSDOM } from 'jsdom';

   if (typeof document === 'undefined') {
     const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
     global.document = dom.window.document;
     global.DOMParser = dom.window.DOMParser;
   }

   // Now NLP utilities work normally
   const processedCard = cardWithNormalizedTextProperties(card, ...);
   ```

4. **Existing Server-Side HTML Processing**
   - File: `/functions/src/embeddings.ts` already processes HTML server-side
   - Uses similar DOM manipulation patterns
   - Proven to work in production

**Implementation Note:**

The plan currently uses **client-side NLP computation on save** (Section 2.3), NOT Cloud Functions. This decision is intentional:

- ✅ Simpler architecture (no async Cloud Function roundtrip)
- ✅ No cold start delays
- ✅ Atomic with save operation
- ✅ No additional Cloud Function costs

However, if future requirements need server-side NLP (e.g., bulk migration Cloud Function), jsdom support is already available.

**Server IDF Calculation Cloud Function:**

The plan DOES use Cloud Functions for server-side IDF calculation (Section 3.3):

```typescript
export const calculateIDF = onSchedule({
  schedule: '0 2 * * 0',  // Weekly
  memory: '2GiB',
  timeoutSeconds: 540
}, async (event) => {
  // Polyfill jsdom for NLP utilities
  if (typeof document === 'undefined') {
    const dom = new JSDOM('');
    global.document = dom.window.document;
  }

  const allCards = await getCards();
  const bodyCards = allCards.filter(card => BODY_CARD_TYPES[card.card_type]);
  const idfMap = calcIDFMapForCards(bodyCards, MAX_N_GRAM_FOR_FINGERPRINT);

  await bucket.file(`idf-maps/idf-v${Date.now()}.json`).save(JSON.stringify(idfMap));
});
```

This Cloud Function WILL use jsdom and WILL work correctly.

**Conclusion:** Cloud Function NLP computation is feasible but not needed for the current architecture. The jsdom dependency is already satisfied.
---

## 9. Testing Strategy

### Overview

This testing strategy covers all components of the canonical plan with comprehensive unit, integration, performance, and migration tests. Existing test infrastructure uses **Mocha + Chai** with Firebase emulators for security rule tests (located in `/test/` directory).

### 9.1 Unit Tests

Unit tests validate individual components in isolation. Use existing Mocha test framework with `assert` from Chai.

#### 9.1.1 3-Tier Hot System Tests

**File:** `/test/tier-system/test.js` (NEW)

**Coverage:**
- Tier classification logic (published, prioritized, recent)
- Duplicate prevention during tier transitions
- Culling logic when tiers overflow limit
- Edge cases: empty collections, large tier 2 (10k+ cards), zero tier 3 slots

**Key Test Cases:**
```javascript
// Tier classification with backwards prioritized logic
it('Prioritized unpublished cards classified as Tier 2', async () => {
  const card = {
    published: false,
    auto_todo_overrides: { prioritized: false } // false = prioritized (backwards)
  };
  const tier = classifyCardTier(card);
  assert.strictEqual(tier, 'unpublished-prioritized');
});

// Culling excess Tier 3 cards
it('Tier 3 culls excess cards when limit exceeded', async () => {
  const cards = mockCardsWithTiers(900, 6000, 200); // Exceeds 7k limit
  const culled = cullExtraCompleteModeCards(cards, 7000);
  assert.strictEqual(countByTier(culled, 'unpublished-recent'), 100); // Only 100 remain
});

// Tier transition duplicate prevention
it('Card moving from Tier 3 to Tier 2 removed from Tier 3', async () => {
  const initialCards = { 'card-1': { fetchType: 'unpublished-recent' } };
  const update = { 'card-1': { auto_todo_overrides: { prioritized: false } } };
  const result = await simulateTierTransition(initialCards, update);
  assert.strictEqual(result['card-1'].fetchType, 'unpublished-prioritized');
});
```

**Edge Cases:**
- Empty database (0 cards)
- Large Tier 2 (10k+ prioritized cards)
- Tier 3 limit = 0 (when Tier 1 + Tier 2 fills capacity)
- Rapid tier transitions (publish → unpublish → prioritize)

#### 9.1.2 NLP Storage Tests

**File:** `/test/nlp-storage/test.js` (NEW)

**Coverage:**
- `generateNLPDataForCard()` correctness for all content fields
- Empty field exclusion from NLP tokens
- Concept reference normalization
- `reconstructProcessedCardFromStorage()` fast path
- Backward compatibility (missing/outdated nlp_version)
- `hasContentFieldChanges()` detection logic

**Key Test Cases:**
```javascript
// NLP generation with concepts
it('Handles concept references correctly', async () => {
  const card = { title: 'Complexity and Hill Climbing', body: '<p>Discussion</p>' };
  const conceptMap = { 'Hill Climbing': 'concept-hill-climbing' };
  const nlpData = generateNLPDataForCard(card, { ...mockState, concepts: conceptMap });
  const titleTokens = nlpData.nlp_tokens.title;
  assert.ok(titleTokens.some(run => run.stemmed.includes('climb')));
});

// Fast path reconstruction
it('Current nlp_version uses stored data (fast path)', async () => {
  const card = { nlp_tokens: {/*...*/}, nlp_version: 1 };
  const startTime = performance.now();
  const processed = getProcessedCard(card, mockState);
  const endTime = performance.now();
  assert.ok(endTime - startTime < 5); // Fast path < 5ms
});

// Legacy fallback
it('Legacy card without nlp_tokens computes on-the-fly', async () => {
  const legacyCard = { id: 'legacy', title: 'Old Card' }; // No NLP fields
  const processed = getProcessedCard(legacyCard, mockState);
  assert.ok(processed.nlp); // Computed successfully
});
```

**Save Flow Integration:**
- Content field changes trigger NLP computation
- Non-content fields skip NLP computation
- Save includes NLP data when appropriate

#### 9.1.3 Server IDF Tests

**File:** `/test/server-idf/test.js` (NEW)

**Coverage:**
- `IDFCache` download on first access
- localStorage caching (survives reload)
- 7-day TTL expiration
- Server unavailable fallback to client IDF
- IDF consistency across sessions
- Cloud Function IDF generation (mocked)

**Key Test Cases:**
```javascript
// Cache behavior
it('Returns cached IDF on subsequent access', async () => {
  const cache = new IDFCache();
  const idf1 = await cache.getIDF();
  const idf2 = await cache.getIDF();
  assert.strictEqual(idf1, idf2); // Same object reference
});

// Expiration
it('Expired cache (>7 days) triggers re-download', async () => {
  const expiredDate = Date.now() - (8 * 24 * 60 * 60 * 1000);
  localStorage.setItem('idf_cache', JSON.stringify({ timestamp: expiredDate, data: {} }));
  const idf = await cache.getIDF();
  assert.ok(Date.now() - new Date(idf.generatedAt) < 24 * 60 * 60 * 1000);
});

// Consistency
it('Server IDF produces consistent fingerprints across sessions', async () => {
  const fingerprint1 = generator1.fingerprintForCardID('test-card');
  const fingerprint2 = generator2.fingerprintForCardID('test-card'); // New session
  assert.deepStrictEqual(fingerprint1, fingerprint2);
});
```

**Fallback Behavior:**
- Server 500 error → use client IDF
- Network timeout → use client IDF
- Client IDF matches expected format

#### 9.1.4 Collection Classification Tests

**File:** `/test/collection-classification/test.js` (NEW)

**Coverage:**
- SIMPLE filter detection (published, section, tag, date range, author)
- COMPLEX filter detection (children, descendants, starred, reading-list)
- Union filter handling (SIMPLE + SIMPLE = SIMPLE, SIMPLE + COMPLEX = COMPLEX)
- Query filter classification (SIMPLE with Enterprise, COMPLEX without)
- Firestore query constraint building
- Server count accuracy validation

**Key Test Cases:**
```javascript
// Filter classification
it('Published filter classified as SIMPLE', async () => {
  const filter = { filters: ['published'] };
  const result = classifyFilter(filter);
  assert.strictEqual(result.isSimple, true);
  assert.strictEqual(result.canGetServerCount, true);
});

it('Children filter classified as COMPLEX', async () => {
  const filter = { filters: ['children/card-123'] };
  const result = classifyFilter(filter);
  assert.strictEqual(result.isSimple, false);
  assert.ok(result.reason.includes('Complex'));
});

// Union handling
it('Union of SIMPLE filters remains SIMPLE', async () => {
  const filter = { filters: ['section/A+section/B'] };
  const result = classifyFilter(filter);
  assert.strictEqual(result.isSimple, true);
});

// Query building
it('Builds correct query for union filter', async () => {
  const filter = { filters: ['section/A+section/B+section/C'] };
  const constraints = buildFirestoreQuery(filter);
  assert.deepStrictEqual(constraints[0].value, ['A', 'B', 'C']);
});
```

**Count Accuracy:**
- SIMPLE collections return exact counts matching actual cards
- COMPLEX collections return approximate counts
- Server count endpoint responds < 200ms

### 9.2 Integration Tests

Integration tests validate end-to-end workflows with Firebase emulators.

**File:** `/test/integration/canonical-plan.test.js` (NEW)

#### 9.2.1 3-Tier Loading Flow

**Scenarios:**
- Complete load sequence: Tier 1 → Tier 2 → Tier 3
- Tier overflow handling (> 7000 cards)
- Correct card distribution across tiers
- No duplicate cards after all tiers load

**Test:**
```javascript
it('Complete load sequence: Tier 1 → Tier 2 → Tier 3', async () => {
  await store.dispatch(connectLiveCards());
  await waitForAllTiers();

  const cards = selectRawCards(store.getState());
  const tier1 = Object.values(cards).filter(c => c.published);
  const tier2 = Object.values(cards).filter(c => !c.published && cardIsPrioritized(c));
  const tier3 = Object.values(cards).filter(c => !c.published && !cardIsPrioritized(c));

  assert.ok(tier1.length > 0);
  assert.ok(tier2.length > 0);
  assert.strictEqual(tier1.length + tier2.length + tier3.length, Object.keys(cards).length);
});
```

#### 9.2.2 NLP Save & Load Flow

**Scenarios:**
- Edit → Save → NLP stored → Reload → NLP loaded
- Save performance within targets (P95 < 500ms)
- Background NLP computation for legacy cards (nlp_version: 0)
- Failed background save doesn't crash app

**Test:**
```javascript
it('Edit → Save → NLP stored → Reload → NLP loaded', async () => {
  const cardId = 'test-card';

  await store.dispatch(editingStart(cardId));
  await store.dispatch(updateEditorContent({ title: 'New Title' }));
  await store.dispatch(saveCard());

  // Verify NLP saved to Firestore
  const savedCard = await getDoc(doc(db, 'cards', cardId));
  assert.ok(savedCard.data().nlp_tokens);
  assert.strictEqual(savedCard.data().nlp_version, 1);

  // Clear and reload
  await store.dispatch(clearCards());
  await store.dispatch(fetchCard(cardId));

  const processedCard = selectProcessedCard(store.getState(), cardId);
  assert.ok(processedCard.nlp);
});
```

#### 9.2.3 Server IDF Integration

**Scenarios:**
- App initialization downloads IDF
- IDF cached in localStorage
- FingerprintGenerator uses server IDF
- Fingerprints consistent across sessions

**Test:**
```javascript
it('App initialization downloads and caches IDF', async () => {
  localStorage.clear();
  await store.dispatch(initializeApp());

  const idf = selectServerIDF(store.getState());
  assert.ok(idf);

  const cached = JSON.parse(localStorage.getItem('idf_cache'));
  assert.ok(cached);
});
```

#### 9.2.4 Collection Pagination

**Scenarios:**
- SIMPLE collection: count → IDs → batch load
- Scroll trigger loads next batch
- Pagination batch load < 300ms
- Discovered tier fetch for missing cards

**Test:**
```javascript
it('SIMPLE collection: count → IDs → batch load', async () => {
  const collection = new CollectionDescription({ filters: ['published'] });

  const countInfo = await collection.getCount();
  assert.strictEqual(countInfo.isExact, true);

  await collection.initialize();
  assert.strictEqual(collection.cardIDs.length, countInfo.count);

  await collection.loadCardBatch(0, 50);
  assert.strictEqual(collection.visibleCards.length, 50);
});
```

#### 9.2.5 Real-Time Editing Conflicts

**Scenarios:**
- Edit non-hot card → concurrent edit → merge
- Listener attached for non-hot cards only
- Listener detached on editing finish
- Merge UI appears on conflict

**Test:**
```javascript
it('Edit non-hot card → concurrent edit detected → merge works', async () => {
  const cardId = 'discovered-card';

  await store.dispatch(fetchDiscoveredCard(cardId));
  await store.dispatch(editingStart(cardId));

  // Simulate concurrent edit
  await updateCardRemotely(cardId, { body: '<p>Remote change</p>' });
  await waitForCardUpdate(cardId);

  const conflicts = selectOvershadowedUnderlyingChangesDiff(store.getState());
  assert.ok(Object.keys(conflicts).length > 0);

  await store.dispatch(mergeOvershadowedUnderlyingChanges());
  const editorCard = selectEditorCard(store.getState());
  assert.ok(editorCard.body.includes('Remote change'));
});
```

### 9.3 Performance Tests

Performance tests validate timing targets with benchmarking.

**File:** `/test/performance/benchmarks.js` (NEW)

#### 9.3.1 Save Operations Benchmark

**Targets:**
- P50 save time < 200ms
- P95 save time < 500ms
- Large card (2000 words) save < 500ms
- NLP computation overhead < 50ms

**Test:**
```javascript
it('P95 save time < 500ms', async () => {
  const times = await benchmarkSaveOperations(100);
  const p95 = percentile(times, 0.95);
  assert.ok(p95 < 500, `P95 ${p95}ms exceeds 500ms target`);
});
```

#### 9.3.2 3-Tier Load Performance

**Targets:**
- Complete 3-tier load < 5 seconds
- Tier 1 loads < 1 second
- Tier 2 loads < 3 seconds

**Test:**
```javascript
it('Complete 3-tier load < 5 seconds', async () => {
  const startTime = performance.now();
  await store.dispatch(connectLiveCards());
  await waitForAllTiers();
  const endTime = performance.now();
  assert.ok(endTime - startTime < 5000);
});
```

#### 9.3.3 IDF and Collection Performance

**Targets:**
- IDF first download < 300ms
- Cached IDF access < 5ms
- SIMPLE collection count < 200ms
- COMPLEX collection count < 100ms
- Pagination batch load (50 cards) < 300ms

### 9.4 Migration Tests

Migration tests validate data migration safety and correctness.

**File:** `/test/migration/nlp-migration.test.js` (NEW)

#### 9.4.1 Phase 1: Mark Cards

**Scenarios:**
- All cards without nlp_version marked with nlp_version: 0
- Existing nlp_version unchanged
- Completes within time limit (< 15 min for 30k cards)
- Batch write limits handled correctly (500 per batch)

**Test:**
```javascript
it('Marks all cards without nlp_version', async () => {
  const db = setupStagingDatabase(1000);
  await runPhase1Migration(db);

  const cards = await getAllCards(db);
  cards.forEach(card => {
    if (!card.nlp_tokens) {
      assert.strictEqual(card.nlp_version, 0);
    }
  });
});
```

#### 9.4.2 Phase 2: Lazy Computation

**Scenarios:**
- Card with nlp_version:0 triggers background save on load
- Background save doesn't block UI
- Failed background save doesn't crash app
- NLP computation results correct

**Test:**
```javascript
it('Card with nlp_version:0 triggers background save on load', async () => {
  await setCard(db, 'legacy-card', { title: 'Test', nlp_version: 0 });

  await store.dispatch(fetchCard('legacy-card'));
  await waitForAsyncSave();

  const updatedCard = await getCard(db, 'legacy-card');
  assert.ok(updatedCard.nlp_tokens);
  assert.strictEqual(updatedCard.nlp_version, 1);
});
```

#### 9.4.3 Migration Validation

**Scenarios:**
- Spot-check NLP correctness for migrated cards
- Save/load still works after migration
- Performance unchanged after migration
- All 30k cards have valid NLP data

**Test:**
```javascript
it('Spot-check NLP correctness for migrated cards', async () => {
  await runFullMigration(db);
  const sampleCards = await getSampleCards(db, 10);

  sampleCards.forEach(card => {
    assert.ok(card.nlp_tokens);
    assert.strictEqual(card.nlp_version, 1);
    Object.values(card.nlp_tokens).forEach(runs => {
      runs.forEach(run => {
        assert.ok(run.original && run.normalized && run.stemmed);
      });
    });
  });
});
```

### 9.5 Security Rule Tests

Extend existing security tests for NLP fields.

**File:** `/test/security/nlp-rules.test.js` (NEW)

**Coverage:**
- Users with edit permission can set nlp_tokens
- Non-editors cannot set nlp_tokens
- Invalid nlp_version rejected
- NLP fields follow same permissions as card content

### 9.6 Edge Case Tests

**File:** `/test/edge-cases/stress-tests.js` (NEW)

**Scenarios:**
- Empty collection (0 cards) loads without error
- Large collection (30k+ cards) loads successfully
- Card with very long body (10k words) processes correctly
- Rapid tier transitions handled gracefully
- Concurrent saves to same card handled correctly

**Test:**
```javascript
it('Large collection (30k+ cards) loads successfully', async () => {
  const db = setupLargeDatabase(35000);
  await store.dispatch(connectLiveCards());
  await waitForAllTiers();

  const cards = selectRawCards(store.getState());
  const limit = selectCompleteModeEffectiveCardLimit(store.getState());
  assert.ok(Object.keys(cards).length <= limit);
});
```

### 9.7 Regression Test Suite

Track fixes for reported issues.

**File:** `/test/regression/known-issues.test.js` (NEW)

**Examples:**
- Issue #123: Duplicate cards when publishing
- Issue #145: NLP fingerprint empty for cards with only stop words
- Issue #167: Tier 3 culling removes wrong cards

### 9.8 Load Testing

**File:** `/test/load/stress.js` (NEW)

**Scenarios:**
- 100 concurrent users loading app
- IDF cache handles concurrent requests
- Server count endpoint handles sustained load (1000 requests)
- Success rate > 95% under load

### 9.9 Test Coverage Goals

**Targets:**
- Unit test coverage: >80%
- Integration test coverage: >60%
- Critical paths: 100% coverage
  - Save flow with NLP
  - 3-tier loading
  - Collection classification
  - Migration phases

**Coverage report:**
```bash
npm run test:coverage
```

### 9.10 Test Infrastructure

**package.json scripts:**
```json
{
  "scripts": {
    "test:all": "npm run test:unit && npm run test:integration && npm run test:performance",
    "test:unit": "mocha -r esm test/tier-system test/nlp-storage test/server-idf test/collection-classification --timeout=10000",
    "test:integration": "npm run generate:config && firebase emulators:exec --only firestore 'mocha -r esm test/integration --timeout=30000'",
    "test:performance": "mocha -r esm test/performance --timeout=60000",
    "test:migration": "mocha -r esm test/migration --timeout=300000",
    "test:load": "mocha -r esm test/load --timeout=600000"
  }
}
```

### 9.11 Continuous Integration

**File:** `.github/workflows/test.yml` (NEW)

Run full test suite on every push/PR:
- Unit tests
- Integration tests
- Performance tests
- Regression tests
- Coverage report upload

### Test File Organization

```
/test/
  /tier-system/
    test.js                    # 3-tier loading tests
  /nlp-storage/
    test.js                    # NLP generation/storage tests
  /server-idf/
    test.js                    # IDF cache tests
  /collection-classification/
    test.js                    # Filter classification tests
  /integration/
    canonical-plan.test.js     # End-to-end integration tests
  /performance/
    benchmarks.js              # Performance benchmarks
  /migration/
    nlp-migration.test.js      # Migration validation tests
  /edge-cases/
    stress-tests.js            # Edge cases and stress tests
  /regression/
    known-issues.test.js       # Regression tests for fixed bugs
  /load/
    stress.js                  # Load testing
  /security/
    test.js                    # Existing security rule tests
    nlp-rules.test.js          # NLP field security tests
  fingerprint/                 # Existing NLP fingerprint tests
  references/                  # Existing reference tests
  ngram/                       # Existing ngram tests
  url/                         # Existing URL tests
  contenteditable/             # Existing content editable tests
```

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
2. **Filter Classification** - Expanded from ~10 to ALL ~99 filter types (274 names)
3. **Missing Functions** - Added implementation specs for 3 functions
4. **Cost Analysis** - Corrected read estimates and Cloud Function costs
5. **Server IDF** - Added jsdom polyfill solution for browser APIs

### 8 Misclassified Filters Corrected (v2.4)

**Moved from SIMPLE to COMPLEX:**
1. `has-slug` / `missing-slug` - Firestore `!= []` doesn't work for empty array detection
2. `has-tags` / `missing-tags` - Same issue
3. `has-images` / `missing-images` - Same issue
4. `has-notes` / `missing-notes` - Requires checking string field length client-side

**Why these were wrong:**
- Original plan claimed: `where('slugs', '!=', [])` would work
- **Reality**: Firestore's `!=` operator excludes documents where field doesn't exist
- Cannot distinguish between `[]` (empty array) and missing field
- Would require separate boolean flags like `has_slugs: boolean` to query server-side
- Sources: [Firebase Query Docs](https://firebase.google.com/docs/firestore/query-data/queries), [Fireship Array Tutorial](https://fireship.io/lessons/firestore-array-queries-guide/)

**Impact:**
- SIMPLE filter count decreased from ~25 to ~17
- COMPLEX filter count increased from ~25 to ~70+
- These 4 filter types remain client-side only unless data model changes

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

- **v2.5** (2026-01-26): Section 7 (Implementation Roadmap) comprehensive overhaul
  - **Timeline extended**: 10 weeks → 15-17 weeks (realistic timeline with risk buffer)
  - **Added Phase 0.5**: Firestore Index Deployment (CRITICAL - must deploy before code changes)
  - **Corrected success criteria**: Added specific performance metrics with proper baselines
    - Save performance: P50 <250ms, P95 <500ms, P99 <800ms (was vague "P95 <500ms")
    - Tier load time: <5s P95 with baseline comparison
    - Memory usage: <15% increase with specific targets
  - **Added 4 missing phases**:
    - Phase 6: Security Rules & Permissions (Week 12)
    - Phase 7: Data Migration Execution (Week 13)
    - Phase 8: Monitoring & Observability (Week 14)
    - Phase 9: Canary Deployment (Week 15)
    - Phase 10: Production Hardening & Docs (Week 16-17, was "Testing & Polish")
  - **Added phase dependencies**: Clear critical path and parallelization opportunities
  - **Added rollback plans**: Every phase now has specific rollback procedures
  - **Added comprehensive success criteria**: Measurable metrics for each phase
  - **Improved Phase 2**: Expanded from 2 weeks to 3 weeks, added 10 detailed tasks
  - **Improved Phase 3**: Expanded from 1 week to 2 weeks, added 9 detailed tasks
  - **Improved Phase 4**: Expanded from 2 weeks to 3 weeks, added comprehensive testing
  - User request: Review and fix Section 7 implementation roadmap
- **v2.4** (2026-01-26): Section 4 accuracy corrections and complete filter count
  - **Corrected 8 misclassified filters**: `has-slug`, `has-tags`, `has-images`, `has-notes` moved from SIMPLE to COMPLEX
  - **Critical finding**: Firestore `where('array', '!=', [])` does NOT work for empty array detection
  - **Accurate filter count**: ~99 unique filter types generating ~274 filter names (was "60+")
  - **Added detail on "Fetch IDs only" pattern**: Clarified that `select()` still charges full read units, only reduces network transfer
  - **Added 4 missing composite indexes** for common SIMPLE collection queries
  - **Sources**: [Firebase Query Docs](https://firebase.google.com/docs/firestore/query-data/queries), [Fireship Array Tutorial](https://fireship.io/lessons/firestore-array-queries-guide/)
  - Agent investigation: User-requested comprehensive Section 4 review
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
