# Cursor-Based Pagination Implementation Plan

**Status:** In Progress (Phase 0)
**Last Updated:** 2026-02-14
**Related:** [requirements.md](requirements.md), [design/CANONICAL-PLAN.md](design/CANONICAL-PLAN.md)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Solution Overview](#solution-overview)
4. [Why This Approach](#why-this-approach)
5. [Alternatives Considered](#alternatives-considered)
6. [Architectural Decisions](#architectural-decisions)
7. [Trade-offs and Mitigations](#trade-offs-and-mitigations)
8. [Implementation Phases](#implementation-phases)
9. [Technical Specifications](#technical-specifications)
10. [Testing Strategy](#testing-strategy)
11. [Future Considerations](#future-considerations)

---

## Executive Summary

Implement cursor-based chunk loading for SIMPLE collections to address critical memory and performance issues when loading large card collections (16k+ cards causing 835MB+ memory usage).

**Core Strategy:**
- Load cards in 250-card chunks using Firestore cursor pagination
- Use one-time `getDocs()` for viewing chunks (no real-time updates)
- Use `onSnapshot()` only for the single card being edited
- Store pagination state in Redux, not Collection instances

**Expected Impact:**
- Reduce memory usage from 835MB → ~50-100MB for typical usage
- Enable viewing full corpus without loading all cards
- Maintain acceptable UX with manageable trade-offs

---

## Problem Statement

### Current Issues

1. **Memory Exhaustion**
   - Loading 16k+ cards causes **835MB+ memory usage**
   - All cards loaded into memory simultaneously via `onSnapshot()`
   - Browser performance degrades significantly
   - Risk of tab crashes on memory-constrained devices

2. **Performance Problems**
   - Multiple active real-time listeners (10+ simultaneous `onSnapshot()` queries)
   - Continuous memory pressure from real-time updates
   - Unnecessary bandwidth consumption for cards never viewed
   - Slow initial page load as all cards must be fetched

3. **Scalability Constraints**
   - Current architecture cannot support viewing 30k+ full corpus
   - Every collection view requires loading all matching cards
   - Client-side filtering requires all cards in memory

### Quantified Impact

```
Current (16k cards):
- Memory: 835MB+
- Active queries: 10+
- Initial load time: 10-15 seconds
- All cards kept in sync via onSnapshot()

Target (with pagination):
- Memory: 50-100MB (1-2 chunks loaded)
- Active queries: 1-2 (current chunk + editing card)
- Initial load time: 2-3 seconds (first chunk only)
- Only viewed chunks loaded, editing card in sync
```

---

## Solution Overview

### High-Level Approach

Implement **cursor-based pagination** for SIMPLE collections using Firestore's native cursor mechanisms:

1. **Chunk Loading**
   - Load cards in 250-card chunks on demand
   - Use `startAfter(lastDoc)` cursors for sequential pagination
   - One-time `getDocs()` fetches (no real-time for viewing)

2. **State Management**
   - Store pagination state in Redux, keyed by collection serialization
   - Track loaded chunks, cursors, current position, total count
   - Persist across Collection instance recreation

3. **Editing Workflow**
   - Fetch current card on edit start (conflict detection)
   - Attach `onSnapshot()` to editing card only
   - Detach on edit end/cancel
   - Only 1 active real-time listener at a time

4. **Collection Classification**
   - SIMPLE collections: Server-queryable, supports pagination
   - COMPLEX collections: Client-side filtering, requires all cards (existing behavior)

### What Changes

**Added:**
- Pagination state in Redux `CollectionState`
- Chunk loading actions (`LOAD_CHUNK`, `LOAD_CHUNK_SUCCESS`, `LOAD_CHUNK_FAILURE`)
- Cursor tracking in reducer
- Conditional loading in `selectActiveCollection` selector
- Refresh-on-edit-start in editor

**Unchanged:**
- Collection instance interface (external API)
- COMPLEX collection behavior (still loads all cards)
- Card editing, permissions, references
- UI components (card-thumbnail-list still receives flat array)

---

## Why This Approach

### Why Cursor-Based Pagination (Not Offset)

**Firestore Constraint:** Offset-based pagination (`limit(250).offset(500)`) requires Firestore to read and skip all offset documents, causing:
- Same read costs as fetching all skipped documents
- Poor performance for deep pagination
- No cursor efficiency

**Cursor-based pagination (`startAfter(lastDoc)`):**
- ✅ Only reads requested documents
- ✅ Efficient for any chunk position
- ✅ Native Firestore optimization
- ✅ Consistent with best practices

### Why Redux State (Not Collection Instances)

Collection instances are:
- Recreated on every navigation
- Not persisted between route changes
- Stateless value objects designed for immutability
- Would require refactoring entire architecture

**Redux state is:**
- ✅ Persistent across navigation
- ✅ Survives Collection recreation
- ✅ Already established pattern in codebase
- ✅ Enables efficient cursor tracking
- ✅ Keyed by `collection.serialize()` for stability

### Why getDocs for Chunks + onSnapshot for Editing Only

**Problem with onSnapshot everywhere:**
- 10+ concurrent real-time listeners
- Continuous memory pressure
- Bandwidth waste for cards never viewed
- All chunks stay in sync unnecessarily

**Solution:**
1. **Viewing chunks**: One-time `getDocs()`
   - Only loaded chunks consume memory
   - No ongoing listener overhead
   - User explicitly requests more via scrolling

2. **Editing card**: Single `onSnapshot()` attached on edit start
   - Only the card being edited is in sync
   - Detached on save/cancel
   - Maximum 1 real-time listener at a time

**Trade-off:** Chunks may become stale if cards update while viewing
**Mitigation:** Refresh editing card on edit start catches conflicts

### Why SIMPLE vs COMPLEX Classification

**SIMPLE collections:**
- All filters translatable to Firestore queries
- Can use server-side `getCountFromServer()`
- Supports cursor pagination
- Examples: `section/foo`, `tag/bar`, `published`, `type-content`

**COMPLEX collections:**
- Require client-side filtering (graph traversal, text search without Firestore Enterprise)
- Need all cards loaded for filtering
- Use existing behavior (load all via `onSnapshot()`)
- Examples: `references`, `descendants`, `query/[text]` (pre-Phase 2)

**Classification happens at:**
- Collection initialization
- Redux action creation time
- Determined by `classifyCollectionDescription()` in `filter-classification.ts`

---

## Alternatives Considered

### Alternative 1: Real-time Pagination (onSnapshot per chunk)

```typescript
// Attach onSnapshot to each loaded chunk
onSnapshot(query(collection, limit(250)), snapshot => {
  // Keep chunk in sync
});
```

**Rejected Because:**
- ❌ 4-5 concurrent listeners for typical usage (4 chunks × 250 cards)
- ❌ Memory pressure from all listeners
- ❌ Bandwidth waste keeping unseen chunks in sync
- ❌ Defeats memory optimization goal

### Alternative 2: Offset-Based Pagination

```typescript
query(collection, limit(250), offset(chunkIndex * 250))
```

**Rejected Because:**
- ❌ Firestore reads all offset documents (500 reads for chunk 2)
- ❌ Poor performance for deep pagination
- ❌ Same cost as reading skipped documents
- ❌ Violates Firestore best practices

### Alternative 3: Virtual Scrolling with Windowed Loading

Load only visible cards in viewport (20-30 cards)

**Rejected Because:**
- ❌ Requires knowing total count + stable positioning
- ❌ Complex UI interactions (jump to arbitrary position)
- ❌ Poor UX for rapid scrolling (constant loading)
- ❌ Over-optimization (250 chunks handle well in practice)

### Alternative 4: Lazy Collection Materialization (Phase Storage)

Store materialized card ID lists in Firestore documents

**Rejected Because:**
- ❌ Write costs for every collection query
- ❌ Stale data without TTL mechanism
- ❌ Complexity of cache invalidation
- ❌ Overkill for single-user app
- ❌ See CANONICAL-PLAN.md Approach 3 analysis

### Alternative 5: Keep Everything in Collection Instances

Store pagination state on Collection objects

**Rejected Because:**
- ❌ Collections recreated on every navigation
- ❌ Would lose pagination state on route change
- ❌ Requires refactoring entire Collection architecture
- ❌ Collections are designed as immutable value objects
- ❌ Redux already established for app state

---

## Architectural Decisions

### Decision 1: Pagination State Location

**Decision:** Store in Redux `CollectionState.paginationState`

**Rationale:**
- Collections are recreated frequently (every navigation)
- Redux persists across route changes
- Already established pattern for app state
- Key by `collection.serialize()` for stability

**Structure:**
```typescript
paginationState: {
  [collectionKey: string]: {
    loadedChunks: Set<number>,           // {0, 1, 2}
    chunkCursors: Map<number, DocumentSnapshot>, // {0: doc250, 1: doc500}
    currentChunkIndex: number,           // 1
    chunkSize: number,                   // 250
    totalCount: number | null,           // 16842
    isLoading: boolean,
    error?: string
  }
}
```

### Decision 2: Chunk Size

**Decision:** 250 cards per chunk

**Rationale:**
- Existing `renderLimit` in card-thumbnail-list is 250
- Good balance: not too many queries, not too much memory
- ~5MB per chunk (250 cards × ~20KB each)
- Typical usage: 1-2 chunks loaded (50-100MB)
- Firestore query limits (max 10MB response) are safe

### Decision 3: Real-time Updates Scope

**Decision:**
- ❌ No `onSnapshot()` for chunk viewing
- ✅ `onSnapshot()` only for card being edited

**Rationale:**
- **Performance:** 1 active query vs 10+
- **Memory:** Only editing card in sync, chunks are snapshots
- **UX:** Acceptable staleness trade-off (viewing is momentary)
- **Conflict detection:** Refresh on edit start catches conflicts

**Implementation:**
```typescript
// editor.ts - On edit start
const unsubscribe = onSnapshot(doc(firestore, 'cards', cardId), snapshot => {
  dispatch({
    type: UPDATE_CARD,
    card: snapshot.data()
  });
});

// Store unsubscribe, call on edit end/cancel
```

### Decision 4: SIMPLE vs COMPLEX Split

**Decision:** Paginate SIMPLE only, keep COMPLEX behavior unchanged

**Rationale:**
- SIMPLE collections: Server-queryable, supports `getCountFromServer()`
- COMPLEX collections: Require all cards for client-side filtering
- No benefit paginating COMPLEX (need full dataset anyway)
- Incremental migration path (SIMPLE first, COMPLEX later if needed)

**Classification Logic:**
```typescript
// filter-classification.ts
export function classifyCollectionDescription(desc): FilterClassification {
  // Check if all filters are server-queryable
  // Returns { complexity: SIMPLE | COMPLEX, constraints: [...] }
}
```

### Decision 5: Conflict Handling

**Decision:** Refresh card on edit start + existing conflict detection

**No new conflict resolution mechanism needed:**
- Card already has edit conflict detection (last-modified timestamps)
- Refresh on edit start ensures latest version before editing
- User notified if conflicts detected on save
- Existing architecture handles this well

**Why this is sufficient:**
- Single-user app (low conflict probability)
- Edit session typically short (<5 minutes)
- Most changes are non-conflicting (different fields)
- Existing conflict UI already robust

---

## Trade-offs and Mitigations

### Trade-off 1: Stale Data in Viewed Chunks

**Trade-off:** Viewed chunks not in real-time sync (one-time `getDocs()`)

**Impact:**
- User sees snapshot of cards at load time
- Changes by other processes not reflected until refresh
- Editing card may have newer version than viewed

**Mitigations:**
1. **Refresh on edit start** - Fetch latest card before editing
2. **Conflict detection** - Existing timestamp-based detection
3. **Manual refresh** - User can reload collection if needed
4. **Single-user app** - Low probability of external changes

**Acceptable Because:**
- Viewing is transient (user scrolls past quickly)
- Editing is where accuracy matters (addressed by refresh)
- Memory savings (800MB → 100MB) outweigh staleness

### Trade-off 2: Pagination Adds Latency

**Trade-off:** Loading next chunk has ~200-500ms latency

**Impact:**
- User scrolls to bottom → sees loading spinner
- Not instant like pre-loaded data

**Mitigations:**
1. **Prefetch next chunk** - Load chunk N+1 when scrolling into bottom 25% of chunk N
2. **Optimistic cursor** - Start query before user reaches end
3. **Chunk size tuning** - 250 cards = ~3 scroll pages
4. **Loading indicators** - Clear feedback during fetch

**Acceptable Because:**
- Alternative is loading all 16k cards (10-15 seconds initial load)
- 200-500ms latency beats 10-second wait
- Users understand "load more" pattern

### Trade-off 3: Increased Code Complexity

**Trade-off:** Pagination logic adds ~500 LOC, state management complexity

**Impact:**
- More Redux actions (LOAD_CHUNK, UPDATE_CURSOR)
- Conditional logic in selectors
- Cursor tracking and bookkeeping

**Mitigations:**
1. **Isolate in modules** - `actions/pagination.ts`, clear boundaries
2. **Type safety** - TypeScript prevents state errors
3. **Documentation** - This plan + code comments
4. **Testing** - Unit tests for reducers, integration tests for flows

**Acceptable Because:**
- Core problem (memory exhaustion) requires solution
- Complexity localized to collection management
- One-time cost, long-term maintainability

### Trade-off 4: Server Costs (getCountFromServer)

**Trade-off:** Each SIMPLE collection query runs `getCountFromServer()` (1 read unit)

**Impact:**
- Extra read for total count
- Not needed for rendering (just pagination UI)

**Mitigations:**
1. **Cache counts** - Store in Redux, reuse for same collection
2. **Debounce** - Don't re-count on rapid navigation
3. **Lazy counting** - Only count when pagination UI visible

**Acceptable Because:**
- 1 read vs 16k reads (massive savings)
- Count enables "Page 1 of 67" UI (good UX)
- Firestore Enterprise has favorable read pricing

---

## Implementation Phases

### Phase 0: Foundation (Current)

**Goal:** Set up pagination infrastructure

**Tasks:**
- [x] Add `paginationState` to `CollectionState` type
- [x] Add pagination action constants (`INIT_SIMPLE_COLLECTION`, `LOAD_CHUNK`, etc.)
- [ ] Implement pagination actions in `actions/collection.ts`
- [ ] Update collection reducer for pagination state
- [ ] Add live editing card updates in `editor.ts`
- [ ] Update `selectActiveCollection` selector for pagination logic

**Outcome:** Pagination plumbing ready, not yet wired to collections

### Phase 1: Cursor-Based Pagination for SIMPLE Collections

**Goal:** Enable chunk loading for server-queryable collections

#### Step 1.1: Collection Classification

```typescript
// actions/collection.ts
import { classifyCollectionDescription } from '../filter-classification.js';

export function initializeCollection(collectionConfig) {
  const classification = classifyCollectionDescription(collectionConfig);

  if (classification.complexity === FilterComplexity.SIMPLE) {
    return initSimpleCollection(collectionConfig, classification);
  } else {
    return initComplexCollection(collectionConfig); // Existing behavior
  }
}
```

#### Step 1.2: Server Count Query

```typescript
// actions/collection.ts
async function getServerCount(collectionConfig, constraints) {
  const coll = collection(firestore, 'cards');
  const q = query(coll, ...constraints);
  const snapshot = await getCountFromServer(q);
  return snapshot.data().count;
}
```

#### Step 1.3: Chunk Loading Action

```typescript
// actions/collection.ts
export function loadChunk(collectionKey, chunkIndex) {
  return async (dispatch, getState) => {
    const state = getState();
    const pagination = state.collection.paginationState[collectionKey];

    // Check if already loaded
    if (pagination.loadedChunks.has(chunkIndex)) {
      return;
    }

    dispatch({ type: LOAD_CHUNK, collectionKey, chunkIndex });

    try {
      // Build query with cursor
      const constraints = [...pagination.baseConstraints];
      if (chunkIndex > 0) {
        const cursor = pagination.chunkCursors.get(chunkIndex - 1);
        constraints.push(startAfter(cursor));
      }
      constraints.push(limit(pagination.chunkSize));

      const q = query(collection(firestore, 'cards'), ...constraints);
      const snapshot = await getDocs(q);

      const cards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const lastDoc = snapshot.docs[snapshot.docs.length - 1];

      dispatch({
        type: LOAD_CHUNK_SUCCESS,
        collectionKey,
        chunkIndex,
        cards,
        cursor: lastDoc
      });
    } catch (error) {
      dispatch({
        type: LOAD_CHUNK_FAILURE,
        collectionKey,
        chunkIndex,
        error: error.message
      });
    }
  };
}
```

#### Step 1.4: Reducer Updates

```typescript
// reducers/collection.ts
case LOAD_CHUNK_SUCCESS: {
  const { collectionKey, chunkIndex, cards, cursor } = action;

  return {
    ...state,
    paginationState: {
      ...state.paginationState,
      [collectionKey]: {
        ...state.paginationState[collectionKey],
        loadedChunks: state.paginationState[collectionKey].loadedChunks.add(chunkIndex),
        chunkCursors: state.paginationState[collectionKey].chunkCursors.set(chunkIndex, cursor),
        isLoading: false
      }
    },
    // Add cards to main cards state
    cards: {
      ...state.cards,
      ...cards.reduce((acc, card) => ({ ...acc, [card.id]: card }), {})
    }
  };
}
```

#### Step 1.5: Selector Integration

```typescript
// selectors/collection.ts
export const selectActiveCollection = createSelector(
  [
    state => state.collection.activeCollectionConfig,
    state => state.collection.paginationState,
    state => state.collection.cards,
    state => state.collection.renderOffset
  ],
  (config, paginationState, cards, renderOffset) => {
    const collectionKey = serializeCollection(config);
    const pagination = paginationState[collectionKey];

    if (!pagination) {
      // Not yet initialized
      return { cards: [], loading: true };
    }

    // Determine which chunks are needed
    const chunkIndex = Math.floor(renderOffset / pagination.chunkSize);

    // Load chunk if needed (trigger action via middleware)
    if (!pagination.loadedChunks.has(chunkIndex)) {
      // Trigger load (will be handled by middleware)
      dispatchLoadChunk(collectionKey, chunkIndex);
      return { cards: [], loading: true };
    }

    // Return cards from loaded chunks
    const startIndex = chunkIndex * pagination.chunkSize;
    const endIndex = startIndex + pagination.chunkSize;

    return {
      cards: getCardsForChunk(cards, collectionKey, startIndex, endIndex),
      loading: pagination.isLoading,
      totalCount: pagination.totalCount
    };
  }
);
```

#### Step 1.6: Edit-Time Card Refresh

```typescript
// editor.ts
async function startEditing(cardId) {
  // Fetch latest version before editing
  const docRef = doc(firestore, 'cards', cardId);
  const snapshot = await getDoc(docRef);

  dispatch({
    type: REFRESH_EDITING_CARD,
    card: { id: snapshot.id, ...snapshot.data() }
  });

  // Attach real-time listener
  const unsubscribe = onSnapshot(docRef, snapshot => {
    dispatch({
      type: UPDATE_EDITING_CARD,
      card: { id: snapshot.id, ...snapshot.data() }
    });
  });

  // Store unsubscribe for cleanup
  dispatch({
    type: SET_EDITING_LISTENER,
    cardId,
    unsubscribe
  });
}

function stopEditing() {
  const { editingCardId, editingListener } = getState().editor;
  if (editingListener) {
    editingListener(); // Unsubscribe
  }
  dispatch({ type: CLEAR_EDITING_LISTENER });
}
```

#### Step 1.7: Testing

```typescript
// Test pagination reducer
test('LOAD_CHUNK_SUCCESS adds chunk to loadedChunks', () => {
  const state = { paginationState: { 'coll:main': { loadedChunks: new Set([0]) } } };
  const action = { type: LOAD_CHUNK_SUCCESS, collectionKey: 'coll:main', chunkIndex: 1 };
  const newState = reducer(state, action);
  expect(newState.paginationState['coll:main'].loadedChunks.has(1)).toBe(true);
});

// Test integration: load chunk on scroll
test('Scrolling to chunk 2 triggers load', async () => {
  // Navigate to collection
  // Scroll to renderOffset = 500 (chunk 2)
  // Verify LOAD_CHUNK dispatched
  // Verify chunk 2 loaded
});
```

**Acceptance Criteria:**
- ✅ SIMPLE collections load first chunk on init
- ✅ Scrolling triggers subsequent chunk loads
- ✅ Total count displays in UI
- ✅ Editing card refreshes on edit start
- ✅ Only 1 active `onSnapshot()` at a time
- ✅ Memory usage <150MB for 1000 visible cards

---

### Phase 2: Query Filters as SIMPLE (Firestore Enterprise)

**Goal:** Make text search filters server-queryable using Firestore Enterprise `regex_match()`

**Context:** Currently, `query/[text]` and `query-strict/[text]` are COMPLEX (require client-side TF-IDF). With Firestore Enterprise Pipeline Operations, we can execute regex search server-side.

#### Step 2.1: Add NLP Token Field (Already Done)

Card documents already have `nlp_tokens` field computed on save (Porter stemming + n-grams). This enables regex matching.

```typescript
// Existing: Card document structure
{
  id: 'card-abc',
  title: 'Machine Learning Basics',
  nlp_tokens: 'machin learn basic ml algorithm',  // ✅ Already computed
  // ...
}
```

#### Step 2.2: Update Filter Classification

```typescript
// filter-classification.ts
const SIMPLE_FILTERS = new Set([
  // ... existing SIMPLE filters
  QUERY_FILTER_NAME,        // 'query' - NOW SIMPLE with Firestore Enterprise
  'query-strict',           // NOW SIMPLE with Firestore Enterprise
]);

// Remove from COMPLEX_FILTERS
const COMPLEX_FILTERS = new Set([
  // ... (remove 'query', 'query-strict')
]);
```

#### Step 2.3: Build Regex Constraints

```typescript
// filter-classification.ts
function buildQueryFilterConstraint(queryText: string): QueryConstraint {
  // Convert query text to regex pattern (Porter stemming)
  const tokens = stemQueryText(queryText); // 'machine learning' → 'machin learn'
  const pattern = tokens.split(' ').join('.*'); // 'machin.*learn'

  // Firestore Enterprise Pipeline Operation
  return where(
    expr.regex_match(
      field('nlp_tokens'),
      `.*${pattern}.*`,
      'i'  // Case-insensitive
    )
  );
}

// Add to buildFirestoreConstraints()
case QUERY_FILTER_NAME: {
  if (!ENABLE_FIRESTORE_ENTERPRISE) {
    throw new Error('query filter requires Firestore Enterprise');
  }
  const queryText = args[0];
  constraints.push(buildQueryFilterConstraint(queryText));
  break;
}
```

#### Step 2.4: Feature Flag

```typescript
// filter-classification.ts
export const ENABLE_FIRESTORE_ENTERPRISE = true; // Set based on project

// In classification logic
if (filterType === QUERY_FILTER_NAME) {
  if (ENABLE_FIRESTORE_ENTERPRISE) {
    // Treat as SIMPLE
    return { complexity: FilterComplexity.SIMPLE, ... };
  } else {
    // Fall back to COMPLEX (client-side TF-IDF)
    return { complexity: FilterComplexity.COMPLEX, ... };
  }
}
```

#### Step 2.5: Test Query Filters

```typescript
// Test Firestore Enterprise query
test('query/text builds regex_match constraint', () => {
  const desc = { set: 'main', filters: ['query/machine learning'] };
  const classification = classifyCollectionDescription(desc);

  expect(classification.complexity).toBe(FilterComplexity.SIMPLE);
  expect(classification.firestoreConstraints).toContainEqual(
    where(expr.regex_match(field('nlp_tokens'), '.*machin.*learn.*', 'i'))
  );
});

// Integration test: search across full corpus
test('query filter searches all cards via pagination', async () => {
  // Set up 1000 cards with 'machine learning' in various positions
  // Query 'query/machine learning'
  // Verify SIMPLE classification
  // Verify pagination works
  // Verify all matching cards found
});
```

**Acceptance Criteria:**
- ✅ `query/[text]` classified as SIMPLE when Firestore Enterprise enabled
- ✅ `regex_match()` constraints generated correctly
- ✅ Search works across full corpus via pagination
- ✅ Falls back to COMPLEX (client-side) when Firestore Enterprise disabled
- ✅ Performance: Search 30k cards in <2 seconds

---

## Technical Specifications

### Data Structures

#### Pagination State (Redux)

```typescript
interface PaginationState {
  [collectionKey: string]: {
    // Chunk tracking
    loadedChunks: Set<number>;              // {0, 1, 2}
    chunkCursors: Map<number, DocumentSnapshot>; // {0: doc250, 1: doc500}
    currentChunkIndex: number;               // 1

    // Configuration
    chunkSize: number;                       // 250
    baseConstraints: QueryConstraint[];      // [where('section', '==', 'foo')]

    // Metadata
    totalCount: number | null;               // 16842
    isLoading: boolean;
    error?: string;

    // Timestamps
    lastUpdated: number;                     // Date.now()
  }
}
```

#### Collection Classification

```typescript
interface FilterClassification {
  complexity: FilterComplexity;     // SIMPLE | COMPLEX | HYBRID
  canGetServerCount: boolean;       // true for SIMPLE
  firestoreConstraints?: QueryConstraint[]; // undefined for COMPLEX
  reason: string;                   // 'All filters server-queryable'
  isExact?: boolean;                // true if classification is definitive
}
```

### Redux Actions

```typescript
// Pagination actions
interface InitSimpleCollectionAction {
  type: typeof INIT_SIMPLE_COLLECTION;
  collectionKey: string;
  config: CollectionConfiguration;
  classification: FilterClassification;
  totalCount: number;
  chunkSize: number;
}

interface LoadChunkAction {
  type: typeof LOAD_CHUNK;
  collectionKey: string;
  chunkIndex: number;
}

interface LoadChunkSuccessAction {
  type: typeof LOAD_CHUNK_SUCCESS;
  collectionKey: string;
  chunkIndex: number;
  cards: Card[];
  cursor: DocumentSnapshot;
}

interface LoadChunkFailureAction {
  type: typeof LOAD_CHUNK_FAILURE;
  collectionKey: string;
  chunkIndex: number;
  error: string;
}
```

### Firestore Queries

#### Chunk Query (SIMPLE Collection)

```typescript
// First chunk
const q = query(
  collection(firestore, 'cards'),
  where('section', '==', 'concepts'),
  where('published', '==', true),
  orderBy('updated', 'desc'),
  limit(250)
);

// Subsequent chunks
const q = query(
  collection(firestore, 'cards'),
  where('section', '==', 'concepts'),
  where('published', '==', true),
  orderBy('updated', 'desc'),
  startAfter(lastDocFromChunkN),
  limit(250)
);

const snapshot = await getDocs(q); // One-time fetch
```

#### Count Query

```typescript
const countQuery = query(
  collection(firestore, 'cards'),
  where('section', '==', 'concepts'),
  where('published', '==', true)
);

const countSnapshot = await getCountFromServer(countQuery);
const totalCount = countSnapshot.data().count; // 16842
```

#### Editing Card Query

```typescript
// Real-time listener (only while editing)
const unsubscribe = onSnapshot(
  doc(firestore, 'cards', cardId),
  snapshot => {
    dispatch({
      type: UPDATE_EDITING_CARD,
      card: { id: snapshot.id, ...snapshot.data() }
    });
  }
);

// Cleanup on edit end
unsubscribe();
```

### Key Algorithms

#### Chunk Index Calculation

```typescript
function getChunkIndex(renderOffset: number, chunkSize: number): number {
  return Math.floor(renderOffset / chunkSize);
}

// Example: renderOffset = 527, chunkSize = 250
// chunkIndex = Math.floor(527 / 250) = 2
// Need chunks: 2 (and prefetch 3)
```

#### Prefetch Logic

```typescript
function shouldPrefetchNextChunk(
  renderOffset: number,
  chunkSize: number,
  loadedChunks: Set<number>
): boolean {
  const currentChunk = getChunkIndex(renderOffset, chunkSize);
  const nextChunk = currentChunk + 1;

  // Prefetch when scrolling into bottom 25% of current chunk
  const chunkProgress = (renderOffset % chunkSize) / chunkSize;

  return chunkProgress > 0.75 && !loadedChunks.has(nextChunk);
}
```

---

## Testing Strategy

### Unit Tests

1. **Reducer Tests**
   - `INIT_SIMPLE_COLLECTION` creates pagination state
   - `LOAD_CHUNK_SUCCESS` adds chunk to loadedChunks
   - `LOAD_CHUNK_FAILURE` sets error state
   - Cursor tracking works correctly

2. **Classification Tests**
   - `classifyCollectionDescription()` returns SIMPLE for server-queryable filters
   - COMPLEX for client-side filters
   - Hybrid filters classified correctly
   - Query filters SIMPLE with Firestore Enterprise flag

3. **Constraint Building Tests**
   - `buildFirestoreConstraints()` generates correct constraints
   - Date filters parsed correctly
   - Union filters handled (or rejected as COMPLEX)
   - Query filters build `regex_match()` constraints

### Integration Tests

1. **Pagination Flow**
   - Initialize collection → first chunk loads
   - Scroll to bottom → next chunk loads
   - Navigate away and back → pagination state persists
   - Total count displays correctly

2. **Editing Flow**
   - Start edit → card refreshes from server
   - Edit in progress → `onSnapshot()` active
   - Save/cancel → `onSnapshot()` detaches
   - Conflict detected if card changed externally

3. **SIMPLE vs COMPLEX**
   - SIMPLE collection (e.g., `section/foo`) → pagination enabled
   - COMPLEX collection (e.g., `references/card-abc`) → loads all cards (existing behavior)
   - Mixed filters → falls back to COMPLEX

### Performance Tests

1. **Memory Usage**
   - Baseline: 835MB for 16k cards (current)
   - Target: <150MB with pagination (1-2 chunks)
   - Measure: Chrome DevTools Memory Profiler

2. **Load Time**
   - Baseline: 10-15 seconds for 16k cards
   - Target: 2-3 seconds for first chunk (250 cards)
   - Measure: Performance API

3. **Query Performance**
   - Count query: <500ms for 16k cards
   - Chunk query: <300ms for 250 cards
   - Firestore Enterprise regex: <2 seconds for 30k cards

### Manual Testing Checklist

- [ ] Navigate to SIMPLE collection → first chunk loads instantly
- [ ] Scroll to bottom → next chunk loads with spinner
- [ ] Refresh page → pagination state persists
- [ ] Edit card → refreshes on edit start
- [ ] Edit card → real-time updates while editing
- [ ] Save card → `onSnapshot()` detaches
- [ ] Navigate to COMPLEX collection → all cards load (existing behavior)
- [ ] Search with query filter → classified as SIMPLE (Phase 2)
- [ ] Memory usage stays <150MB during typical usage

---

## Future Considerations

### Phase 3: Prefetch Optimization

Add smart prefetching to reduce perceived latency:

```typescript
// Prefetch next chunk when scrolling into bottom 25% of current chunk
if (shouldPrefetchNextChunk(renderOffset, chunkSize, loadedChunks)) {
  dispatch(loadChunk(collectionKey, currentChunkIndex + 1));
}
```

### Phase 4: Background Chunk Updates

Periodically refresh chunks in background:

```typescript
// Refresh chunks older than 5 minutes
setInterval(() => {
  const staleChunks = getStaleChunks(paginationState, 5 * 60 * 1000);
  staleChunks.forEach(chunkIndex => {
    dispatch(refreshChunk(collectionKey, chunkIndex));
  });
}, 60 * 1000); // Check every minute
```

### Phase 5: IndexedDB Caching

Persist chunks to IndexedDB for offline/faster loads:

```typescript
// Store chunks in IndexedDB
await idb.put('chunks', {
  collectionKey,
  chunkIndex,
  cards,
  timestamp: Date.now()
});

// Retrieve on init
const cachedChunk = await idb.get('chunks', { collectionKey, chunkIndex });
if (cachedChunk && !isStale(cachedChunk.timestamp)) {
  return cachedChunk.cards;
}
```

### Phase 6: COMPLEX Collection Optimization

Explore pagination for COMPLEX collections:

- **Challenge:** Client-side filtering requires full dataset
- **Options:**
  1. Two-phase: Server fetches IDs, client filters, load chunks of filtered IDs
  2. Hybrid: Server-side pre-filtering + client-side refinement
  3. Firestore Enterprise Pipeline Operations for more filters

### Phase 7: Virtual Scrolling

If 250-card chunks still too heavy:

- Render only visible cards in viewport (20-30 cards)
- Requires stable positioning + jump-to-position logic
- Use `react-window` or similar library

---

## Appendix A: Related Documents

- [requirements.md](requirements.md) - Firestore Enterprise hybrid architecture requirements
- [design/CANONICAL-PLAN.md](design/CANONICAL-PLAN.md) - Full system architecture with NLP-stored 3-tier hot system
- [design/README.md](design/README.md) - Design approach comparison and selection rationale
- [research/firestore-enterprise-capabilities.md](research/firestore-enterprise-capabilities.md) - Firestore Enterprise Pipeline Operations reference

## Appendix B: Key Code Locations

- **Classification Logic:** `src/filter-classification.ts`
- **Pagination Actions:** `src/actions/collection.ts`
- **Pagination Reducer:** `src/reducers/collection.ts`
- **Collection Selector:** `src/selectors/collection.ts`
- **Editor Integration:** `src/editor.ts` (edit-time refresh)
- **Types:** `src/types.ts` (PaginationState interface)

## Appendix C: Glossary

- **SIMPLE Collection:** Server-queryable, supports pagination via Firestore constraints
- **COMPLEX Collection:** Requires client-side filtering, loads all cards
- **Chunk:** 250-card segment loaded via single `getDocs()` query
- **Cursor:** Firestore DocumentSnapshot used for `startAfter()` pagination
- **Firestore Enterprise:** GA as of January 2026, provides `regex_match()` and 100+ Pipeline Operations
- **Pagination State:** Redux state tracking loaded chunks, cursors, counts per collection

## Appendix D: Migration Notes

### From Current (onSnapshot All) to Pagination

1. **No Breaking Changes:** UI components receive same data structure (flat card array)
2. **COMPLEX Collections Unchanged:** Existing behavior preserved for client-side filtering
3. **Incremental Rollout:** SIMPLE collections adopt pagination, COMPLEX deferred
4. **State Migration:** No user data migration needed (ephemeral state only)

### Rollback Plan

If pagination causes issues:

1. Set `ENABLE_SIMPLE_COLLECTIONS = false` in `filter-classification.ts`
2. All collections fall back to COMPLEX behavior (load all via `onSnapshot()`)
3. Pagination state ignored, existing code path activated
4. No data loss (state is derived from Firestore)

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-14 | Claude Sonnet 4.5 | Initial comprehensive plan document |

---

**Last Updated:** 2026-02-14
**Document Owner:** @jkomoros
**Status:** Living document (update as implementation progresses)
