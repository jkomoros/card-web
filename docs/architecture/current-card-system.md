# Current Card Fetching and Filtering System

> **Status**: Current architecture as of January 2026
> **Purpose**: Document existing system before Firestore Enterprise hybrid integration
> **Related**: See `firestore-enterprise-capabilities.md` for new capabilities

## Table of Contents

1. [Overview](#overview)
2. [Card Fetching Architecture](#card-fetching-architecture)
3. [Filter Chain System](#filter-chain-system)
4. [Client-Side Search](#client-side-search)
5. [Memoization & Caching](#memoization--caching)
6. [Performance Characteristics](#performance-characteristics)
7. [Current Limitations](#current-limitations)

## Overview

Card-web uses a sophisticated client-side filtering system built on Firestore with Redux state management. The system handles 30,000+ cards through:

- **Partial mode**: Fetches most recent 5,000 cards (default)
- **Client-side filtering**: Complex filter chains executed in-memory
- **Real-time sync**: Firestore `onSnapshot()` listeners for live updates
- **Memoized selectors**: Reselect library prevents unnecessary recomputation

### Current Scale

- **Total cards**: 30,000+ (and growing)
- **Fetched in partial mode**: 5,000 most recent
- **Memory usage**: ~50 MB for 5k cards
- **Filter execution**: ~50-150ms for typical query

## Card Fetching Architecture

### Source: `src/actions/database.ts`

#### Published Cards Query (Lines 354-357)

```typescript
onSnapshot(
  query(
    collection(db, CARDS_COLLECTION),
    where('published', '==', true)
  ),
  cardSnapshotReceiver('published')
);
```

**Characteristics:**
- Fetches ALL published cards (no limit)
- Real-time updates via `onSnapshot()`
- Typically ~1,000-2,000 cards

#### Unpublished Cards Queries (Lines 398-446)

The system handles unpublished cards in three permission-based modes:

**1. Admin Mode** (Lines 409-426)
```typescript
// Partial mode (default): Recent 5,000
onSnapshot(
  query(
    collection(db, CARDS_COLLECTION),
    where('published', '==', false),
    orderBy('created', 'desc'),
    limit(effectiveLimit)  // 5000 default
  ),
  cardSnapshotReceiver('unpublished-partial')
);

// Complete mode (optional): All unpublished
onSnapshot(
  query(
    collection(db, CARDS_COLLECTION),
    where('published', '==', false),
    orderBy('created', 'desc'),
    limit(10000)  // Firestore max
  ),
  cardSnapshotReceiver('unpublished-complete')
);
```

**2. Author Mode** (Lines 428-438)
```typescript
// Cards user authored
onSnapshot(
  query(
    collection(db, CARDS_COLLECTION),
    where('author', '==', uid),
    where('published', '==', false),
    orderBy('created', 'desc'),
    limit(effectiveLimit)
  ),
  cardSnapshotReceiver('unpublished-author')
);
```

**3. Editor Mode** (Lines 440-446)
```typescript
// Cards user can edit
onSnapshot(
  query(
    collection(db, CARDS_COLLECTION),
    where('permissions.edit-card', 'array-contains', uid),
    where('published', '==', false),
    orderBy('created', 'desc'),
    limit(effectiveLimit)
  ),
  cardSnapshotReceiver('unpublished-editor')
);
```

### Complete Mode Toggle

**Source**: `src/actions/data.ts` (Lines 237-277)

```typescript
export const toggleCompleteMode = (): ThunkSomeAction => {
  return (dispatch) => {
    const enabled = !selectCompleteModeEnabled(getState());
    dispatch(turnCompleteMode(enabled));

    // Store in localStorage
    localStorage.setItem('completeModeEnabled', enabled);
  };
};
```

**Configuration** (`src/constants.ts`):
- `DEFAULT_PARTIAL_MODE_CARD_FETCH_LIMIT = 5000`
- `FIRESTORE_MAXIMUM_LIMIT_CLAUSE = 10000`

**Cleanup**: When toggling back to partial mode, `cullExtraCompleteModeCards()` removes cards exceeding the limit.

### Card Snapshot Receiver (Lines 325-352)

All queries feed into `cardSnapshotReceiver`:

```typescript
const cardSnapshotReceiver = (fetchType: CardFetchType) => {
  return (snapshot: QuerySnapshot) => {
    const cards: Cards = {};

    snapshot.docChanges().forEach(change => {
      if (change.type !== 'removed') {
        const doc = change.doc;
        const card = cardWithNormalizedTextProperties(
          doc.data(),
          fallbackText,
          importantNgrams,
          synonyms
        );
        cards[card.id] = card;
      }
    });

    store.dispatch(receiveCards(cards, fetchType));
  };
};
```

**Processing:**
1. Converts Firestore documents to Card objects
2. Normalizes text properties (stemming, bigrams)
3. Dispatches to Redux store
4. Handles card removal when they disappear from query

## Filter Chain System

### Source: `src/filters.ts` and `src/collection_description.ts`

### Architecture Overview

```
CollectionDescription (URL-like spec)
    ↓
Filter Chain: main/query/text/children/+self/sort/relevance
    ↓
combinedFilterForFilterDefinition()
    ↓
[Filter1, Filter2, Filter3] → Combined Filter Function
    ↓
baseSet.filter(combinedFilter)
    ↓
Filtered Card IDs
```

### Filter Types

#### 1. Basic Filters (Concrete)
Simple membership tests stored in `state.collection.filters`:

- `starred`, `unread`, `published`, `unpublished`
- Section filters: `section/main`, `section/meta`
- Tag filters: `tag/concept`, `tag/important`
- Card type filters: `content`, `working-notes`, `todo`

**Source**: Created by reducers via `makeFilterFromCards()`, `makeFilterFromSection()`

#### 2. Configurable Filters (Multi-part)

Factory functions create filters from parameters:

| Filter | Example | Purpose |
|--------|---------|---------|
| `query` | `query/machine+learning` | Full-text search |
| `limit` | `limit/50` | Take first N cards |
| `exclude` | `exclude/starred` | Invert another filter |
| `combine` | `combine/filter1/filter2` | Union (OR) of filters |
| `expand` | `expand/main/link` | Include linked cards |
| `references` | `references-inbound/card-id` | Link-based filtering |
| `similarity` | `similar/card-id` | Semantic similarity |
| `author` | `author/uid` | Filter by author |
| `date` | `created/after/2025-01-01` | Date range |

**Source**: `src/filters.ts` Lines 250-450

#### 3. Union Filters

Combine multiple basic filters with OR logic using `+` delimiter:
- `starred+unread` → matches if either starred OR unread
- `section/ai+section/ml` → cards in either section

### Filter Chain Processing

**Key Function**: `combinedFilterForFilterDefinition()` (Lines 676-695)

```typescript
const combinedFilterForFilterDefinition = (
  filterDefinition: FilterName[],
  extras: FilterExtras
): [FilterFunc, SortExtras, CardBooleanMap, boolean] => {

  const includeSets: FilterMap[] = [];
  const excludeSets: FilterMap[] = [];
  const allSortExtras: SortExtras = {};
  let anyPreview = false;

  // Process each filter in chain
  for (const filterName of filterDefinition) {
    const [filterSet, inverted, sortExtras, partialMatches, preview] =
      filterSetForFilterDefinitionItem(filterName, extras);

    if (inverted) {
      excludeSets.push(filterSet);
    } else {
      includeSets.push(filterSet);
    }

    Object.assign(allSortExtras, sortExtras);
    anyPreview = anyPreview || preview;
  }

  // Combine: card must be in ALL includeSets AND NONE of excludeSets
  const combinedFilter = makeCombinedFilter(includeSets, excludeSets);

  return [combinedFilter, allSortExtras, partialMatches, anyPreview];
};
```

### Collection Class (Lines 720-860)

The Collection class orchestrates filtering:

```typescript
export class Collection {
  private _filteredCards?: ProcessedCard[];
  private _preview = false;

  _makeFilteredCards() {
    const baseSet = this._sets[this._description.set] || [];
    let filteredItems = baseSet;

    if (this._description.filters.length) {
      const [filter, sortExtras, partialMatches, preview] =
        combinedFilterForFilterDefinition(
          this._description.filters,
          this._filterExtras
        );

      filteredItems = baseSet.filter(item => filter(item));
      this._sortExtras = sortExtras;
      this._partialMatches = partialMatches;
      this._preview = preview;
    }

    this._preLimitlength = filteredItems.length;

    // Fallback to default collection if empty
    if (filteredItems.length == 0) {
      this._collectionIsFallback = true;
      filteredItems = this._fallbacks[this._description.serialize()] || [];
    }

    return expandCardCollection(filteredItems, this._cardsForExpansion);
  }

  get preview(): boolean {
    this._ensureFilteredCards();
    return this._preview;
  }
}
```

### Complex Filters

#### Combine Filter
```typescript
// combine/section/ai/section/ml
// Returns cards in EITHER section/ai OR section/ml
makeCombineConfigurableFilter(filterType, ...subFilters);
```

#### Expand Filter
```typescript
// expand/query/text/references-outbound/link
// Find cards matching query, then include cards they link to
makeExpandConfigurableFilter(filterType, mainFilter, expansionFilter);
```

#### Similarity Filter (Lines 911-978)
```typescript
const makeSimilarConfigurableFilter = () => {
  const generator = memoize((cards, cardIDs, editingCard, cardSimilarity) => {
    let preview = false;

    // Check if we have server embeddings
    if (!cardSimilarity[cardID]) {
      // Fetch from server
      preview = fetchSimilarCardsIfEnabled(cardID);
    }

    // Fallback to local fingerprints if no server data
    const fingerprint = fingerprintGenerator.fingerprintForCardIDList(cardIDs);

    return {
      map: fingerprintGenerator.closestOverlappingItems(fingerprint),
      preview  // Signals async fetch in progress
    };
  });

  // Returns preview=true while waiting for server embeddings
  return func;
};
```

**Pattern**: This is the ONLY current filter that fetches from server asynchronously. It demonstrates the preview flag pattern that hybrid approaches will leverage.

#### Reference Filters

Uses BFS traversal for graph queries:

```typescript
// references-inbound/card-id/3
// Find cards that reference card-id, up to 3 links away
makeCardLinksConfigurableFilter();
```

**Implementation**:
- `cardBFSMaker()` performs breadth-first search
- Returns degree of separation as sort value
- Supports: children, parents, ancestors, descendants, bidirectional

## Client-Side Search

### Source: `src/nlp.ts` (Lines 729-855)

### PreparedQuery Class

```typescript
export class PreparedQuery {
  text: PreparedQueryConfiguration;

  constructor(queryText: string) {
    // 1. Lowercase and split into words
    const words = stemmedNormalizedWords(queryText);

    // 2. Apply Porter stemmer for root matching
    const stemmed = words.map(word => stemWord(word));

    // 3. Generate bigrams (2-word sequences)
    const bigrams = generateBigrams(stemmed);

    // 4. Build configuration for multi-field search
    this.text = textSubQueryForWords(stemmed, bigrams);
  }

  cardScore(card: ProcessedCard): [score: number, fullMatch: boolean] {
    let score = 0;
    let allWordsFound = true;

    // Score each field (title, body, commentary) with weights
    for (const [field, weight] of TEXT_FIELD_WEIGHTS) {
      const fieldScore = this.scoreField(card[field], weight);
      score += fieldScore;

      if (fieldScore === 0) allWordsFound = false;
    }

    // Boost by inbound link count (popularity)
    const inboundBoost = 1.0 + (card.inboundLinksCount * 0.02);
    score *= inboundBoost;

    return [score, allWordsFound];
  }
}
```

### Scoring Algorithm

**Field Weights** (from `TEXT_FIELD_CONFIGURATION`):
- `title`: 3.0 (highest weight)
- `body`: 1.0 (baseline)
- `subtitle`: 2.0
- `commentary`: 0.8
- `notes`: 0.5

**Scoring Rules**:
1. **Exact phrase match**: Highest score
2. **All words found**: High score (weighted by word length)
3. **Individual word match**: Medium score
4. **Bigram match**: Good score
5. **Inbound link boost**: Multiply by `1.0 + (inboundCount × 0.02)`

### Query Filter Integration (Lines 255-257, 863-879)

```typescript
export const queryFilter = (
  queryText: string,
  strict = false
): ConfigurableFilterName => {
  return (strict ? QUERY_STRICT_FILTER_NAME : QUERY_FILTER_NAME)
    + '/'
    + encodeURIComponent(queryText);
};
```

**Usage in filter chain**:
- URL: `main/query/machine+learning`
- Filter executes: `PreparedQuery("machine learning")`
- Scores all cards, filters score > 0
- Strict mode requires `fullMatch === true`

### Query Rewriting (Lines 774-799)

Supports search shortcuts:
- `is:todo` → filter to todo cards
- `section:main` → filter to section
- `tag:important` → filter by tag
- `has:comments` → only cards with comments
- `has:no-comments` → exclude commented cards

## Memoization & Caching

### Reselect Library

**Source**: `src/selectors.ts` (Lines 1-3)

```typescript
import { createSelector } from 'reselect';

export const selectActiveCollection = createSelector(
  selectActiveCollectionDescription,
  selectCollectionConstructorArguments,
  (description, args) => description ? description.collection(args) : null
);
```

**Benefits**:
- Only recomputes when inputs change
- Prevents cascading re-renders
- Memoized by object identity

### Custom Memoization (`src/memoize.ts`)

#### 1. General Purpose Memoization
```typescript
export const memoize = (fn: Function, entries = 3) => {
  const cache = new Map();

  return (...args) => {
    const key = JSON.stringify(args);

    if (cache.has(key)) {
      return cache.get(key);  // Cache hit
    }

    const result = fn(...args);
    cache.set(key, result);

    // LRU eviction: keep only last N entries
    if (cache.size > entries) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }

    return result;
  };
};
```

**Usage**: Caches up to 3 previous results, LRU eviction

#### 2. First-Argument Memoization
```typescript
export const memoizeFirstArg = (fn: Function) => {
  const cache = new WeakMap();

  return (firstArg, ...restArgs) => {
    if (cache.has(firstArg)) {
      return cache.get(firstArg);
    }

    const result = fn(firstArg, ...restArgs);
    cache.set(firstArg, result);
    return result;
  };
};
```

**Usage**: Optimized for frequently-changing first argument (e.g., card objects)

#### 3. Deep Equality Return
```typescript
export const deepEqualReturnSame = (fn: Function) => {
  let lastResult;

  return (...args) => {
    const result = fn(...args);

    if (deepEqual(result, lastResult)) {
      return lastResult;  // Same object reference
    }

    lastResult = result;
    return result;
  };
};
```

**Usage**: Prevents downstream recomputation by returning same object reference if deep equal

### Filter Extras Memoization

**Source**: `src/collection_description.ts` (Line 658)

```typescript
const makeExtrasForFilterFunc = memoize(
  (filterSetMemberships, cards, keyCardID, editingCard, userID,
   randomSalt, cardSimilarity, editingCardSimilarity) => {
    return {
      filterSetMemberships,
      cards,
      keyCardID,
      editingCard,
      userID,
      randomSalt,
      cardSimilarity,
      editingCardSimilarity
    };
  }
);
```

**Purpose**: Memoizes the "extras" object passed to filter functions. Filters check object identity to avoid recomputation.

## Performance Characteristics

### Current Performance (5,000 cards in memory)

| Operation | Latency | Notes |
|-----------|---------|-------|
| Filter execution | 50-150ms | Depends on filter complexity |
| Text search | 80-120ms | NLP processing + scoring |
| Reference filter (BFS) | 40-80ms | Graph traversal |
| Sort | 20-40ms | Sorting filtered results |
| Collection rebuild | 5-10ms | Memoized, cache hit |

### Memory Usage

| Data | Size | Notes |
|------|------|-------|
| 5,000 raw cards | ~25 MB | Firestore documents |
| Processed cards | ~30 MB | With normalized text |
| Filter membership maps | ~5 MB | Basic filter sets |
| Memoization caches | ~3 MB | Recent computations |
| **Total** | **~65 MB** | Acceptable for modern browsers |

### Bottlenecks at 30k+ Scale

#### 1. Memory Constraints
- 30k cards = ~180 MB in memory
- Mobile browsers may struggle
- Tab becomes unresponsive during GC

#### 2. Filter Execution Time
- Text search: 300-500ms (30k cards)
- Complex filter chains: 500-1000ms
- User perceives lag

#### 3. NLP Processing
- Stemming every card: O(n) with card count
- Bigram generation: O(n × m) where m = avg words/card
- Cannot be fully parallelized (single-threaded JS)

#### 4. Real-time Sync Overhead
- `onSnapshot()` limit: 10,000 documents max
- Network bandwidth for 30k cards: ~100 MB download
- Initial load time: 10-30 seconds

## Current Limitations

### 1. Partial Mode Limitation
**Problem**: Users cannot search cards beyond the fetched 5,000
- Searching for "concept from 2 years ago" returns no results
- Historical analysis impossible
- "Complete mode" fetches 10k (Firestore max), still incomplete

### 2. Client-Side Processing Bottleneck
**Problem**: All filtering happens in browser's main thread
- 30k cards × complex filter = 500ms-1s lag
- UI freezes during computation
- No way to utilize server's processing power

### 3. No Server-Side Full-Text Search
**Problem**: Firestore doesn't support `contains` or regex queries
- Must fetch all cards to client, then search
- Cannot offload text search to server
- Workaround: Denormalized `searchTokens` array (limited effectiveness)

### 4. Memory Limits
**Problem**: Cannot load all 30k+ cards on low-memory devices
- Mobile browsers: ~100 MB practical limit
- 30k cards = ~180 MB
- Crashes or extreme slowness

### 5. Query Complexity Ceiling
**Problem**: Some queries impossible within Firestore constraints
- Cannot do OR operations natively (workaround: multiple queries)
- Cannot combine arbitrary filters server-side
- Cannot do complex aggregations

### 6. Cost Inefficiency
**Problem**: Fetching all cards client-side wastes bandwidth
- User searches for 1 card, downloads 5,000
- 90% of downloaded data never displayed
- Mobile data usage concern

## Key Files Reference

| File | Purpose | Key Content |
|------|---------|-------------|
| `src/actions/database.ts` | Firestore queries & subscriptions | `connectLiveCards`, `cardSnapshotReceiver` |
| `src/actions/data.ts` | Card management, complete mode | `toggleCompleteMode`, `cullExtraCompleteModeCards` |
| `src/filters.ts` | All filter types and factories | `makeQueryConfigurableFilter`, `makeSimilarConfigurableFilter` |
| `src/collection_description.ts` | Filter chain execution | `Collection` class, `combinedFilterForFilterDefinition` |
| `src/nlp.ts` | Full-text search | `PreparedQuery` class, `cardScore` |
| `src/selectors.ts` | Redux selectors | `selectActiveCollection`, Reselect usage |
| `src/memoize.ts` | Custom memoization | `memoize`, `deepEqualReturnSame` |

## Conclusion

The current system is well-architected for client-side processing at ~5k card scale. Key strengths:

✅ Robust filter chain architecture
✅ Sophisticated NLP search with stemming/bigrams
✅ Real-time sync via Firestore listeners
✅ Effective memoization prevents recomputation
✅ Composable filters (combine, expand, exclude)

**However**, at 30k+ scale, fundamental limitations emerge:

❌ Cannot fetch all cards (memory + network)
❌ Client-side processing too slow
❌ No server-side query capabilities
❌ Partial mode limits searchability

**Next**: See `firestore-enterprise-capabilities.md` for how Firestore Enterprise Pipeline Operations can address these limitations, and the 4 design approaches for hybrid architecture.
