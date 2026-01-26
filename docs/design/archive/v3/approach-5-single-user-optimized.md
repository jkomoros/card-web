# Approach 5: Single-User Optimized Card Loading Architecture

## Executive Summary

This plan simplifies the card-web application's data loading architecture for a **single power user** with 30k cards. It removes over-engineered features (ghost cards, 3-tier hot system, recent edits listener) while keeping valuable improvements (dual-track filtering, discovered cards cache, simple eviction).

**Key Principle**: Optimize for the 95% use case (browsing 5-10k hot cards) while gracefully handling the 5% case (comprehensive "search all" queries).

**Key Metrics**:
- **Total Code**: ~1,200 LOC (vs 4,400 LOC in over-engineered Approach 2)
- **Cost**: $0/month (within free tier)
- **Performance**: 95th percentile <100ms (vs <50ms current for hot tier only)
- **Complexity**: Low (2 tiers vs 3, simple LRU vs LRU/LFU hybrid)

---

## 1. Architecture Overview

### Current State Analysis

From `/src/actions/database.ts` (lines 354-446):
- Published cards: Single onSnapshot for all ~10k cards (line 356)
- Unpublished cards: All cards OR top 5k by created date (lines 421-441)
- No client-side persistence or warm cache
- All filtering happens client-side in memory

### Proposed Architecture

```
┌──────────────────────────────────────────────────────┐
│ SIMPLIFIED 2-TIER HYBRID ARCHITECTURE                │
├──────────────────────────────────────────────────────┤
│                                                       │
│  Tier 1: Hot Cards (Real-Time)                       │
│  • 5k-10k most recent cards                          │
│  • onSnapshot (existing mechanism)                   │
│  • Instant client-side filtering (<50ms)             │
│  • No changes to existing listeners                  │
│                                                       │
│  Tier 2: Discovered Cards (Warm Cache)               │
│  • User's working set (2k-5k cards)                  │
│  • Fetched on-demand via getDoc()                    │
│  • Simple LRU eviction (not LRU/LFU hybrid)          │
│  • Persisted to IndexedDB                            │
│  • Survives page reloads                             │
│                                                       │
│  Server Queries (On-Demand Fallback)                 │
│  • Two-phase: count query, then fetch IDs            │
│  • Only for "search all" / comprehensive queries     │
│  • Aggressive result caching (cardsVersion key)      │
│  • User accepts 200-500ms latency                    │
│                                                       │
└──────────────────────────────────────────────────────┘
```

### What We Removed from Previous Approaches

1. **No Ghost Cards** (1200 LOC): Questionable 2MB savings for single user with modern hardware
2. **No 3-Tier Hot System**: Published/Prioritized/Recent added unnecessary coordination complexity
3. **No Recent Edits Listener**: Solves multi-user problem that doesn't exist
4. **No LFU Scoring**: Simple LRU is sufficient for single-user access patterns
5. **No Discovery Method Weighting**: Over-optimization for single user

---

## 2. Core Components

Total estimated code: **~1,200 LOC** (vs 4,400 LOC in Approach 2)

### 2.1 Discovered Cards Manager (~200 LOC)

**File**: `/src/discovered-cards.ts`

**Responsibilities:**
- Track cards discovered through navigation/links
- Fetch full card data via `getDoc()`
- Coordinate with LRU eviction
- Load/save from IndexedDB on startup/shutdown

**Key Methods:**
```typescript
class DiscoveredCardsManager {
  // Track a card as discovered (called when user navigates/views)
  discoverCard(cardID: CardID): void

  // Fetch card data if not in hot tier
  async fetchCard(cardID: CardID): Promise<Card | null>

  // Check if card is available (hot or discovered)
  hasCard(cardID: CardID): boolean

  // Get all discovered card IDs for filtering
  getDiscoveredCardIDs(): CardID[]
}
```

**Integration Points:**
- Hook into existing `showCard` action in `/src/actions/app.ts`
- Read from existing `state.data.cards` for hot tier check
- Write discovered cards to Redux `state.data.discoveredCards`

### 2.2 Simple LRU Eviction (~100 LOC)

**File**: `/src/lru-eviction.ts`

**Responsibilities:**
- Track access order (single timestamp per card)
- Evict least recently used when over threshold
- Run asynchronously (requestAnimationFrame or requestIdleCallback)
- Never evict cards in current view

**Key Data Structure:**
```typescript
interface LRUCache {
  // cardID -> last access timestamp
  accessTimes: Map<CardID, number>;

  // Maximum discovered cards (default: 5000)
  maxSize: number;

  // Cards immune to eviction (currently visible)
  protectedCards: Set<CardID>;
}
```

**Algorithm:**
```typescript
// When discovered tier exceeds maxSize + buffer (5500):
// 1. Sort by accessTimes (oldest first)
// 2. Filter out protectedCards
// 3. Remove oldest 500 cards in batches of 100 (50ms per batch)
// 4. Update IndexedDB in background
```

**Why Simple LRU (not LRU/LFU hybrid):**
- Single user = access patterns are consistent
- Discovery method (navigation vs search) doesn't matter for single user
- Simplicity = fewer bugs, easier to reason about
- Frequency weighting adds complexity without measurable benefit

### 2.3 Dual-Track Filter Executor (~300 LOC)

**File**: `/src/dual-track-filter.ts`

**Responsibilities:**
- Execute filters on hot + discovered cards (fast path)
- Fall back to server query if needed (slow path)
- Coordinate caching and result presentation

**Decision Tree:**
```typescript
async function executeFilter(filterDescription: FilterDescription): Promise<CardID[]> {
  // 1. Try client-side first (hot + discovered)
  const clientResults = await filterCardsClientSide(filterDescription);

  // 2. Check if results are complete
  if (isCompleteResult(clientResults, filterDescription)) {
    return clientResults; // Fast path: <100ms
  }

  // 3. Show partial results + loading indicator
  showPartialResults(clientResults);

  // 4. Fall back to server query
  const serverResults = await executeServerQuery(filterDescription);

  // 5. Merge and return
  return serverResults; // Slow path: 200-500ms
}
```

**Completeness Detection:**
```typescript
function isCompleteResult(results: CardID[], filter: FilterDescription): boolean {
  // Can we guarantee we found all matches?

  // If filter only uses hot-tier properties (published, section, tags):
  if (filter.requiresOnlyHotTier()) return true;

  // If filter has limit AND we found enough results:
  if (filter.limit && results.length >= filter.limit) return true;

  // Otherwise, we might be missing cards
  return false;
}
```

### 2.4 Server Query Coordinator (~200 LOC)

**File**: `/src/server-query.ts`

**Responsibilities:**
- Build Firestore queries from filter descriptions
- Execute two-phase queries (count + IDs)
- Cache results keyed by filter hash + cardsVersion
- Fetch full card data for discovered cards

**Two-Phase Query Pattern:**
```typescript
async function executeServerQuery(filter: FilterDescription): Promise<CardID[]> {
  // Phase 1: Count query (estimate result size)
  const countSnapshot = await getCountFromAggregation(query);
  const estimatedCount = countSnapshot.data().count;

  // Phase 2: Fetch IDs only (minimal data transfer)
  const snapshot = await getDocs(query(
    collection(db, 'cards'),
    ...buildQueryConstraints(filter)
    // Note: Firestore doesn't support select('__name__') in standard SDK
    // We fetch full documents but only extract IDs
  ));

  const cardIDs = snapshot.docs.map(doc => doc.id);

  // Phase 3: Ensure discovered (fetch full data for IDs not in hot tier)
  await discoverCards(cardIDs);

  return cardIDs;
}
```

**Caching Strategy:**
```typescript
interface QueryCache {
  // Hash of (filterDescription + cardsVersion) -> result IDs
  cache: Map<string, { ids: CardID[], timestamp: number }>;

  // Invalidate when any card changes
  cardsVersion: number;
}

// On card update: cardsVersion++, cache.clear()
```

### 2.5 State Management Fixes (~200 LOC)

**Files**:
- `/src/reducers/collection.ts`
- `/src/types.ts`

**Critical Fix**: Set Reference Instability

Current problem in `/src/reducers/collection.ts`:
```typescript
// Line 104: Using Set operations creates new Set objects
filters: {
  ...state.filters,
  starred: setUnion(setRemove(state.filters.starred, action.starsToRemove), action.starsToAdd)
}
```

**Solution**: Use arrays instead of Sets in Redux state
```typescript
// Before (unstable reference):
interface Filters {
  starred: Set<CardID>;  // New Set object every time
}

// After (stable reference):
interface Filters {
  starred: CardID[];  // Array is stable, easy to memoize
}

// Convert to Set in selectors where needed:
export const selectStarredCardsSet = createSelector(
  state => state.filters.starred,
  (starredArray) => new Set(starredArray)
);
```

**State Versioning Framework:**
```typescript
interface VersionedState {
  version: number;  // Increment on structure changes
  data: {
    cards: Cards;
    discoveredCards: Cards;
    // ... existing fields
  };
}

// Migrations for version changes
const migrations: Record<number, (state: any) => any> = {
  1: (state) => ({ ...state, discoveredCards: {} }),
  2: (state) => ({ ...state, filters: arrayifyFilters(state.filters) }),
};

function migrateState(state: any, targetVersion: number): any {
  let currentVersion = state.version || 0;
  let migratedState = { ...state };

  while (currentVersion < targetVersion) {
    currentVersion++;
    if (migrations[currentVersion]) {
      migratedState = migrations[currentVersion](migratedState);
    }
  }

  migratedState.version = targetVersion;
  return migratedState;
}
```

### 2.6 IndexedDB Persistence (~200 LOC)

**File**: `/src/indexeddb.ts`

**Responsibilities:**
- Persist discovered cards across sessions
- Persist LRU access times
- Load on startup (before Firebase connects)
- Save on changes (debounced, 5-second interval)

**Schema:**
```typescript
// Database: 'card-web'
// Version: 1

// Object Store: 'discoveredCards'
interface DiscoveredCardEntry {
  id: CardID;  // Primary key
  card: Card;
  lastAccess: number;
  discoveryMethod: 'navigation' | 'search';
}

// Object Store: 'metadata'
interface Metadata {
  key: 'cardsVersion' | 'lastSaved';  // Primary key
  value: any;
}
```

**Startup Sequence:**
```typescript
async function initializeApp() {
  // 1. Load discovered cards from IndexedDB
  const { cards, accessTimes } = await indexedDB.loadDiscoveredCards();

  // 2. Hydrate Redux store
  dispatch(hydrateDiscoveredCards(cards, accessTimes));

  // 3. Connect Firebase listeners (existing code)
  connectLivePublishedCards();
  connectLiveUnpublishedCards();

  // 4. Start background sync (save to IndexedDB periodically)
  startPeriodicIndexedDBSync();
}
```

**Save Strategy:**
```typescript
// Debounced save (5-second delay after last change)
let saveTimeout: number | null = null;

function scheduleIndexedDBSave() {
  if (saveTimeout) clearTimeout(saveTimeout);

  saveTimeout = setTimeout(async () => {
    const state = store.getState();
    await indexedDB.saveDiscoveredCards(
      state.data.discoveredCards,
      state.lru.accessTimes
    );
  }, 5000);
}
```

---

## 3. Migration Strategy

**4 Phases** (not 7 from over-engineered version)

### Phase 1: Add Discovered Tier + Simple LRU (Week 1)

**Goal**: Augment available card set without changing filter behavior

**Tasks**:
- Create `discovered-cards.ts`, `lru-eviction.ts`
- Hook into existing `showCard` action
- Add `state.data.discoveredCards` to Redux
- Implement simple LRU eviction (async, non-blocking)
- **No UI changes yet** - discovered cards just augment available set

**Success Criteria**:
- Navigate through 10k cards, verify discovered tier populated
- Verify LRU eviction at 5500 cards
- Verify no performance regression (<50ms for hot tier queries)

**Rollback**: Feature flag `enableDiscoveredCards` = false

### Phase 2: Add Server Query Fallback (Week 2)

**Goal**: Enable comprehensive "search all" queries

**Tasks**:
- Create `server-query.ts`, `dual-track-filter.ts`
- Modify filter execution in `/src/filters.ts`
- Add loading states for comprehensive queries
- Implement query result caching

**Success Criteria**:
- Query for "all cards with 'concept' in body" - should fall back to server
- Verify 200-500ms latency for server queries
- Verify cache hit rate >80% for repeated queries

**Rollback**: Server query fallback disabled via feature flag

### Phase 3: Add IndexedDB Persistence (Week 3)

**Goal**: Persist discovered cards across sessions

**Tasks**:
- Create `indexeddb.ts`
- Add startup hydration logic
- Add periodic background sync (5-second debounce)
- Handle quota exceeded errors gracefully

**Success Criteria**:
- Load 5k discovered cards, reload page, verify instant availability
- Verify IndexedDB save completes in <50ms (background)
- Test quota exceeded scenario (clear old data)

**Rollback**: Disable IndexedDB persistence, rely on session-only cache

### Phase 4: Enable for Production (Week 4)

**Goal**: Deploy to production with monitoring

**Tasks**:
- Fix Set reference instability (arrays instead of Sets)
- Add state versioning framework
- Add performance monitoring (query latency, cache hit rate)
- **Gradual rollout**: Feature flag enabled by default

**Success Criteria**:
- No performance regression in P95 query latency
- Cache hit rate >85% for discovered cards
- No IndexedDB errors in production

**Rollback**: Disable all features via master feature flag

---

## 4. Cost Analysis (Realistic for Single User)

### Current Costs (Baseline)
- Published cards listener: ~10k reads/day (real-time updates)
- Unpublished cards listener: ~5k reads/day
- **Total: ~15k reads/day = ~450k reads/month = FREE**
- Firestore free tier: 50k reads/day, 1.5M reads/month

### New Costs with This Approach
- Hot tier listeners: Same as current (~15k reads/day)
- Discovered cards (on-demand `getDoc()`): ~100 fetches/day = ~3k reads/month
- Server queries (comprehensive search): ~10 queries/day × 30 cards avg = ~300 reads/month
- **Total: ~453k reads/month = FREE** (well under 1.5M free tier limit)

### Cost Comparison with Over-Engineered Versions

| Feature | This Plan | Approach 2 | Savings |
|---------|-----------|------------|---------|
| Ghost cards system | $0 | $0 | 1200 LOC complexity |
| Recent edits listener | $0 (removed) | ~10k reads/day | 300k reads/month |
| 3-tier coordination | $0 (simple 2-tier) | $0 | ~800 LOC complexity |
| LRU/LFU hybrid | $0 (simple LRU) | $0 | ~300 LOC complexity |

**Key Insight**: For a single user, costs are negligible regardless of architecture. **Simplicity is the real win.**

---

## 5. Performance Targets

| Operation | Current | Target | Notes |
|-----------|---------|--------|-------|
| Hot tier queries | <50ms | <50ms | Unchanged (client-side filter) |
| Discovered tier | N/A | <100ms | Includes getDoc() fetch if needed |
| Server queries (cold) | N/A | 200-500ms | User accepts for "search all" |
| Server queries (cached) | N/A | <5ms | Aggressive caching |
| Page load (cold) | 2-3s | 2-3s | Unchanged (Firebase connection) |
| Page load (warm IndexedDB) | 2-3s | 0.5-1s | Instant discovered cards |
| LRU eviction | N/A | <50ms | Async, 100 cards per batch |

---

## 6. Implementation Files

### New Files (Create)

1. **`/src/discovered-cards.ts`** (~200 LOC)
   - DiscoveredCardsManager class
   - Integration with Redux actions
   - Discovery tracking and card fetching

2. **`/src/lru-eviction.ts`** (~100 LOC)
   - LRUCache class
   - Async eviction logic (RAF/idle callback)
   - Protected cards management

3. **`/src/dual-track-filter.ts`** (~300 LOC)
   - executeFilter() decision tree
   - Completeness detection
   - Partial result handling

4. **`/src/server-query.ts`** (~200 LOC)
   - Two-phase query execution
   - Result caching (cardsVersion key)
   - Query constraint building

5. **`/src/indexeddb.ts`** (~200 LOC)
   - IndexedDB wrapper
   - Load/save discovered cards
   - Schema migration handling

### Modified Files

6. **`/src/reducers/collection.ts`** (~50 LOC changes)
   - Replace Sets with arrays in filters
   - Add discoveredCards to state
   - Maintain backward compatibility

7. **`/src/reducers/data.ts`** (~30 LOC changes)
   - Add HYDRATE_DISCOVERED_CARDS action
   - Add cardsVersion tracking
   - Increment version on card updates

8. **`/src/actions/app.ts`** (~20 LOC changes)
   - Hook discoverCard() into showCard action
   - Track navigation patterns
   - Update LRU access times

9. **`/src/filters.ts`** (~100 LOC changes)
   - Integrate dual-track filter execution
   - Add completeness detection helpers
   - Maintain existing filter logic

10. **`/src/types.ts`** (~50 LOC changes)
    - Add DiscoveredCardsState interface
    - Add state versioning types
    - Add LRU cache types

**Total New Code**: ~1,200 LOC
**Total Modified Code**: ~250 LOC
**Total Impact**: ~1,450 LOC

---

## 7. Testing Strategy

### Unit Tests

**LRU Eviction** (`lru-eviction.test.ts`):
- Evict oldest cards when threshold exceeded
- Protect currently visible cards from eviction
- Async eviction doesn't block UI thread

**Completeness Detection** (`dual-track-filter.test.ts`):
- Hot-tier-only filters marked as complete
- Filters with limits marked complete if enough results
- Complex filters correctly marked incomplete

**IndexedDB Persistence** (`indexeddb.test.ts`):
- Save/load discovered cards correctly
- Handle quota exceeded gracefully
- Corrupt data doesn't crash app

### Integration Tests

**Discovered Card Flow**:
1. User navigates to card not in hot tier
2. Card discovered, fetched via getDoc()
3. Card cached in discovered tier
4. Card persisted to IndexedDB
5. Page reload: card instantly available

**Server Query Fallback**:
1. Execute filter on hot + discovered tiers
2. Partial results shown with loading indicator
3. Server query executes (200-500ms)
4. Full results merged and displayed
5. Result cached for future queries

**Page Reload with IndexedDB**:
1. Load 5k discovered cards, navigate through them
2. Reload page
3. IndexedDB hydrates Redux store (<100ms)
4. Firebase listeners connect (2-3s)
5. Verify discovered cards immediately available

### Performance Tests

**LRU Overhead**:
- Load 30k cards, navigate randomly through 10k
- Measure LRU tracking overhead (<1ms per access)
- Verify eviction completes in <50ms (async batches)

**Cache Hit Rate**:
- Execute 100 typical queries
- Measure cache hit rate (target: >80%)
- Verify cached queries return in <5ms

**IndexedDB Save Time**:
- Save 5k discovered cards to IndexedDB
- Measure time to completion (target: <50ms)
- Verify doesn't block UI thread

---

## 8. Rollback Plan

### Feature Flag

**Primary Flag**: `enableDiscoveredCards` (default: false initially, true after Phase 4)

```typescript
if (featureFlags.enableDiscoveredCards) {
  // Use new dual-track filtering
  return executeDualTrackFilter(filterDescription);
} else {
  // Use existing client-side filtering (hot tier only)
  return executeClientSideFilter(filterDescription);
}
```

### Rollback Triggers

Monitor for these issues:

1. **Performance Regression**
   - Hot tier queries >200ms (currently <50ms)
   - Page load time >5s (currently 2-3s)

2. **Memory Leak**
   - Discovered cards grow unbounded (>10k cards)
   - Browser memory usage >500MB

3. **IndexedDB Errors**
   - Quota exceeded errors
   - Data corruption
   - Save failures >5%

### Rollback Procedure

1. Set `enableDiscoveredCards = false` via remote config
2. Clear IndexedDB (user won't notice, just slower queries)
3. Verify hot tier filtering still works
4. Investigate issue in development environment
5. Fix and redeploy with feature flag enabled

**Recovery Time**: <5 minutes (feature flag toggle)

---

## 9. Future Enhancements (Out of Scope)

These are **NOT** included in this plan (keep it simple):

1. **Predictive Fetching**: Pre-fetch linked cards before user clicks
   - Adds complexity, marginal benefit for single user
   - User with fast internet won't notice 100ms fetch

2. **Smart Eviction**: LFU or ML-based scoring
   - Overkill for single user with consistent patterns
   - Simple LRU is sufficient

3. **Multi-Device Sync**: Sync discovered cards across devices
   - Not requested, adds significant complexity
   - User can just navigate to cards on each device

4. **Service Worker**: Offline-first architecture
   - Separate project, requires rethinking Firebase integration
   - User expects internet connection for card management

5. **Firestore Enterprise Pipeline Operations**
   - Only needed for >30k cards or complex aggregations
   - Current approach handles 30k cards well
   - Can revisit if card count grows to 100k+

---

## 10. Why This is "Right-Sized"

### Complexity Comparison

| Aspect | Over-Engineered (App 2) | This Plan (App 5) | Under-Engineered (Status Quo) |
|--------|-------------------------|-------------------|-------------------------------|
| **LOC** | 4,400 | 1,200 | 0 (no changes) |
| **Tiers** | 3 (Pub/Pri/Rec) | 2 (Hot/Disc) | 1 (Hot only) |
| **Eviction** | LRU+LFU hybrid | Simple LRU | No eviction |
| **Persistence** | IndexedDB + Ghost | IndexedDB | None |
| **Real-time** | 3 listeners + recent edits | 2 listeners (existing) | 2 listeners |
| **Cost** | $0 | $0 | $0 |
| **Complexity** | High | Low | None |
| **Performance (hot)** | 50ms | 50ms | 50ms |
| **Performance (all)** | 50ms | 200-500ms | Fails (only 5k cards) |

### The Sweet Spot

**This plan handles 30k cards gracefully without over-engineering for problems that don't exist:**

- ❌ Multi-user coordination (only one user)
- ❌ Offline-first (user expects internet connection)
- ❌ 100k+ cards (only 30k cards)
- ❌ Complex eviction heuristics (simple LRU works fine)
- ❌ Ghost card memory optimization (modern hardware has plenty of RAM)

**What we DO solve:**
- ✅ Search all 30k cards (not just hot tier 5k)
- ✅ Persist working set across sessions (IndexedDB)
- ✅ Graceful degradation (fast path + slow fallback)
- ✅ Maintainable codebase (1,200 LOC, not 4,400)

---

## 11. Critical Implementation Details

### 11.1 Set Reference Instability Fix

**Problem**: Current code creates new Set objects in reducers

```typescript
// src/reducers/collection.ts line 104
filters: {
  ...state.filters,
  starred: setUnion(
    setRemove(state.filters.starred, action.starsToRemove),
    action.starsToAdd
  )
}
// ^ Every call creates new Set, breaks Reselect memoization
```

**Solution**: Store arrays, convert to Sets in selectors

```typescript
// In reducer (store arrays):
filters: {
  ...state.filters,
  starred: [
    ...state.filters.starred.filter(id => !action.starsToRemove.includes(id)),
    ...action.starsToAdd
  ]
}

// In selector (convert to Set with stable reference):
export const selectStarredCardsSet = createSelector(
  state => state.filters.starred,
  // Use custom equality check for arrays
  { memoizeOptions: { equalityCheck: shallowEqual } },
  (starredArray) => new Set(starredArray)
);
```

### 11.2 Async Eviction Pattern

**Problem**: Evicting 1000 cards synchronously blocks UI thread (200-500ms)

**Solution**: Batch eviction with yielding to browser

```typescript
async function evictCards(victims: CardID[]): Promise<void> {
  const BATCH_SIZE = 100;

  for (let i = 0; i < victims.length; i += BATCH_SIZE) {
    const batch = victims.slice(i, i + BATCH_SIZE);

    // Evict batch (synchronous Redux dispatch)
    store.dispatch(removeDiscoveredCards(batch));

    // Yield to browser (allow UI updates, user input)
    await new Promise(resolve => requestAnimationFrame(resolve));
  }

  // Save to IndexedDB in background (doesn't block)
  indexedDB.saveDiscoveredCards(store.getState().data.discoveredCards);
}
```

### 11.3 Query Caching Strategy

**Problem**: Repeated queries shouldn't hit server

**Solution**: Cache keyed by filter hash + cardsVersion

```typescript
interface CachedQuery {
  filterHash: string;
  cardsVersion: number;
  resultIDs: CardID[];
  timestamp: number;
}

class QueryCache {
  private cache = new Map<string, CachedQuery>();

  get(filter: FilterDescription, cardsVersion: number): CardID[] | null {
    const key = hashFilter(filter);
    const cached = this.cache.get(key);

    if (!cached) return null;
    if (cached.cardsVersion !== cardsVersion) {
      // Stale - any card changed since cache
      this.cache.delete(key);
      return null;
    }

    return cached.resultIDs;
  }

  set(filter: FilterDescription, cardsVersion: number, ids: CardID[]): void {
    const key = hashFilter(filter);
    this.cache.set(key, {
      filterHash: key,
      cardsVersion,
      resultIDs: ids,
      timestamp: Date.now()
    });
  }

  // Invalidate all caches when any card changes
  invalidate(): void {
    this.cache.clear();
  }
}
```

---

## 12. Success Metrics

### Performance Metrics (Measure Weekly)

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Hot tier query latency (P95) | <50ms | Monitor filter execution times |
| Discovered tier query latency (P95) | <100ms | Track getDoc() call times |
| Server query latency (P95) | <500ms | Track executeServerQuery() times |
| Cache hit rate | >80% | (cached queries / total queries) |
| IndexedDB save time (P95) | <50ms | Monitor save operation duration |
| LRU eviction time (P95) | <50ms | Monitor eviction operation duration |

### User Experience Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Page load time (cold) | <3s | Measure time to first render |
| Page load time (warm IndexedDB) | <1s | Measure with discovered cards cached |
| "Search all" query success rate | >95% | Track server query failures |
| Memory usage (stable state) | <200MB | Monitor browser memory |

### Code Quality Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Test coverage | >80% | Jest coverage report |
| TypeScript strict mode | 100% | No `any` types in new code |
| Bundle size increase | <50KB | Compare before/after builds |

---

## Conclusion

This plan delivers **80% of the value with 30% of the complexity** compared to over-engineered alternatives. It respects the reality that this is a **single-user application** and optimizes for simplicity, maintainability, and the 95% use case.

**What Makes This "Right-Sized":**

1. **Solves real problems**: Search all 30k cards, persist working set
2. **Avoids non-problems**: Multi-user coordination, ghost cards, complex eviction
3. **Maintainable**: 1,200 LOC of simple, understandable code
4. **Cost-effective**: Free tier ($0/month for single user)
5. **Performant**: 95th percentile <100ms for most queries
6. **Graceful**: Fast path for common case, slow fallback for rare case

**Next Steps:**

1. Review this plan and gather feedback
2. Create feature flag infrastructure
3. Begin Phase 1 implementation (discovered tier + LRU)
4. Measure baseline performance metrics before changes
5. Implement incrementally with continuous monitoring

---

## Appendix: Critical Files Reference

Based on codebase exploration, these are the 5 most critical files for implementation:

1. **`/src/actions/database.ts`** (lines 354-446)
   - Currently manages onSnapshot listeners
   - Will integrate discovered cards manager
   - Will add server query coordinator

2. **`/src/filters.ts`** (2271 lines)
   - Currently handles all client-side filtering
   - Will integrate dual-track filter executor
   - Will add completeness detection

3. **`/src/reducers/collection.ts`** (lines 100-110)
   - Currently uses Sets for filters (causes reference instability)
   - Will convert to arrays for stable references
   - Will add discoveredCards state

4. **`/src/actions/app.ts`** (showCard action)
   - Currently manages card navigation
   - Will hook discovered cards tracking
   - Pattern to follow for integration

5. **`/src/types.ts`** (State interfaces)
   - Defines State, Card, Filters interfaces
   - Will add DiscoveredCardsState
   - Will add state versioning types
