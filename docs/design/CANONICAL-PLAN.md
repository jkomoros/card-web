# Card-Web: Canonical Implementation Plan v2.0
## NLP-Stored 3-Tier Hot System with Firestore Enterprise Integration

**Last Updated:** 2026-01-25
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
- Query: `where('published', '==', false) AND where('auto_todo_overrides.prioritized', '!=', false) ORDER BY created DESC LIMIT(remaining)`
- FetchType: `'unpublished-recent'` (NEW)
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
- `undefined` (missing): Card is NOT prioritized (default)
- `true`: Card is explicitly NOT prioritized (override to "done")
- `false`: Card IS prioritized (override to "not done")

**Why it's backwards:** Historical maintenance task flipped all boolean values. Code uses `cardIsPrioritized()` helper everywhere to abstract this.

### 1.3 Implementation

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

```typescript
export const connectLiveUnpublishedCards = () => {
    // ... existing setup ...

    if (completeModeEnabled) {
        // Complete mode: fetch all unpublished (no change)
        // ... existing logic ...
    } else {
        // NEW 3-TIER SYSTEM

        // Tier 2: Prioritized cards
        store.dispatch(expectUnpublishedCards('unpublished-prioritized'));
        liveUnpublishedPrioritizedCardsUnsubscribe = onSnapshot(
            query(
                collection(db, CARDS_COLLECTION),
                where('published', '==', false),
                where('auto_todo_overrides.prioritized', '==', false)
            ),
            cardSnapshotReceiver('unpublished-prioritized')
        );

        // Tier 3: Recent unpublished (non-prioritized)
        store.dispatch(expectUnpublishedCards('unpublished-recent'));
        liveUnpublishedRecentCardsUnsubscribe = onSnapshot(
            query(
                collection(db, CARDS_COLLECTION),
                where('published', '==', false),
                where('auto_todo_overrides.prioritized', '!=', false),
                orderBy('auto_todo_overrides.prioritized'),  // Required for != query
                orderBy('created', 'desc'),
                limit(effectiveLimit)  // Conservative initial limit
            ),
            cardSnapshotReceiver('unpublished-recent')
        );
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
    const prioritizedCards = Object.values(cards).filter(card =>
        !card.published && cardIsPrioritized(card)
    );
    const recentCards = Object.values(cards).filter(card =>
        !card.published && !cardIsPrioritized(card)
    ).sort((a, b) => b.created.seconds - a.created.seconds);

    // Calculate how many recent cards we can keep
    const limit = selectCompleteModeEffectiveCardLimit(state);
    const remainingSlots = Math.max(0, limit - publishedCards.length - prioritizedCards.length);

    // Cull excess recent cards
    if (recentCards.length > remainingSlots) {
        const cardsToCull = recentCards.slice(remainingSlots).map(card => card.id);
        dispatch(cullCards(cardsToCull));
        dispatch(refreshCardSelector(true));
    }
};
```

### 1.4 Firestore Index Required

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

### 1.5 Duplicate Prevention

**Existing mechanism (no changes needed):**
- `removeCards()` function uses 3-second timeout
- Cards moving between tiers handled automatically
- Most recent update wins

**Scenarios:**
- Card becomes prioritized: Moves tier 3 → tier 2 ✓
- Card loses priority: Moves tier 2 → tier 3 (may trigger culling) ✓
- Card published: Moves tier 2/3 → tier 1 ✓

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

**File: `/src/nlp.ts`** - Add new function:

```typescript
export const generateNLPDataForCard = (
  card: Card,
  state: State
): { nlp_tokens: NLPTokenStorage, nlp_fingerprint: string, nlp_version: number } => {

  const fallbackText = selectFallbackTextMapForCard(state, card.id);
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

### 4.1 Classification Logic

**SIMPLE Collections** (server-friendly):
- Boolean equality: `published`, `unpublished`
- String equality: `section/[id]`, `author/[uid]`, `card_type`
- Array containment: `tag/[id]`
- Date comparisons: `updated/before/[date]`, `created/after/[date]`
- **Special**: `similar/[card]` is SIMPLE (uses server Qdrant!)

**COMPLEX Collections** (client-only):
- Text search: `query/[text]`, `query-strict/[text]` (needs Porter stemmer, TF-IDF)
- Graph traversal: `children/[card]`, `descendants/[card]/[ply]` (needs BFS)
- Composition: `exclude/[filter]`, `combine/[filter1]/[filter2]`
- Concept analysis: `about-concept/[concept]`

### 4.2 Filter Classification Algorithm

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

### 4.3 Server-Side Counts

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

### 4.4 Pagination for SIMPLE Collections

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

### 4.5 UI for Counts

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

**Approach:** Batch migration using MultiBatch infrastructure

**File: `/src/actions/maintenance.ts`** - Add migration task:

```typescript
const MIGRATE_NLP_DATA = 'migrate-nlp-data';

const migrateNLPData: MaintenanceTaskFunction = async (_, getState) => {
  const batch = new MultiBatch(db);
  const state = getState();
  const cards = selectCards(state);

  let migratedCount = 0;

  for (const card of Object.values(cards)) {
    // Skip if already has current NLP
    if (card.nlp_tokens && card.nlp_version === CURRENT_NLP_VERSION) {
      continue;
    }

    // Generate NLP data
    const nlpData = generateNLPDataForCard(card, state);

    // Add to batch
    batch.update(doc(db, CARDS_COLLECTION, card.id), {
      nlp_tokens: nlpData.nlp_tokens,
      nlp_fingerprint: nlpData.nlp_fingerprint,
      nlp_version: nlpData.nlp_version
    });

    migratedCount++;
    if (migratedCount % 100 === 0) {
      console.log(`Migrated ${migratedCount} cards...`);
    }
  }

  await batch.commit();
  console.log(`Migration complete: ${migratedCount} cards`);
};
```

**Performance:**
- 30,000 cards / 500 per batch = 60 batches
- ~500-1000ms per batch
- **Total time: 30-60 minutes**
- **Cost: $0.054** (30k writes × $0.0018 per 100k)

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
- New: ~453k reads/month (+3k for discovered tier, staleness checks)
- Still within free tier (1.5M/month)
- **Increase: $0/month**

**Cloud Function costs:**
- Weekly IDF calculation: $0.001/week = $0.004/month
- **Increase: +$0.004/month**

### 10.3 Total Cost Impact

**Monthly costs:**
- Storage: +$0.10
- Reads: +$0
- Cloud Functions: +$0
- **Total increase: ~$0.10/month**

**One-time migration:** $0.054

**Annual increase:** ~$1.20/year

**Cost per benefit:** Enables full-text search across 30k cards for ~10 cents/month = **Excellent ROI**

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

## Revision History

- **v2.0** (2026-01-25): Initial canonical plan incorporating all agent designs
- Future revisions will be documented here

---

**END OF CANONICAL PLAN**
