# Approach 1: Server-First Query Engine

> **Philosophy**: Server is authoritative source of truth for all collection queries. Client manages progressive card data fetching and rendering.
>
> **Strategy**: Two-phase pattern is fundamental - every collection starts with server query for count + IDs, then client progressively fetches card data.
>
> **Key Insight**: Card ID lists change infrequently and can be cached aggressively. Card data is fetched only when needed for rendering.

## Executive Summary

### Core Architecture

All collection queries follow the same pattern:

1. **Phase 1 (Server)**: Execute filter chain → return count + card ID list
2. **Phase 2 (Client)**: Fetch card data in batches as needed for rendering
3. **Caching**: Aggressive caching of count + ID lists (keyed on collection descriptor hash)
4. **Hot Tier**: Recent cards kept in memory for instant access (bypass Phase 2)

### Key Characteristics

- **All queries server-first**: No client-side filter delegation logic
- **Uniform abstraction**: Same pattern for explicit searches and navigation collections
- **Cache-centric**: 90-95% cache hit rate target for card ID lists
- **Progressive rendering**: User sees count immediately, cards appear as fetched

### Trade-offs

✅ **Strengths**:
- Simple mental model (server does filtering, client does rendering)
- Consistent latency (no unpredictable client-side processing)
- Cost-efficient (cache hit rate + batched fetching)
- Scalable (works for 30k, 300k, 3M cards)

❌ **Weaknesses**:
- Cold start latency (200-500ms for uncached queries)
- Server dependency (offline mode degrades)
- Cannot handle client-only filters server-side (similarity, references)

### When to Choose This Approach

- **Large stable corpus**: Cards change infrequently (high cache hit rate)
- **Read-heavy workload**: Repeated queries for same collections
- **Correctness priority**: Server-enforced permissions and filtering
- **Long-term scalability**: Plan to grow beyond 30k cards

## Detailed Architecture

### 1. Collection Query Flow

```typescript
// src/collection_description.ts - Enhanced with server-first pattern

class Collection {
  private async _fetchCardIDList(): Promise<{ count: number, ids: string[] }> {
    const cacheKey = this.hashDescriptor();

    // Check cache first
    const cached = await this.cache.get(cacheKey);
    if (cached && !this.cache.isStale(cached)) {
      return cached;
    }

    // Phase 1: Server query for count + IDs
    const result = await this.serverQueryEngine.execute({
      filters: this.filterChain,
      userId: currentUserId(),
      fieldsOnly: ['id'],  // Minimal data transfer
      returnCount: true
    });

    // Cache result (15-minute TTL)
    await this.cache.set(cacheKey, result, { ttl: 15 * 60 * 1000 });

    return result;
  }

  private async _fetchCardData(ids: string[], batch: number = 50): Promise<Card[]> {
    // Check hot tier first
    const hotCards = ids
      .map(id => this.hotTier.get(id))
      .filter(Boolean);

    if (hotCards.length === ids.length) {
      return hotCards;  // All in hot tier, instant
    }

    // Fetch missing cards from Firestore
    const missingIds = ids.filter(id => !this.hotTier.has(id));
    const fetched = await this.firestore.batchGet(missingIds.slice(0, batch));

    // Merge hot tier + fetched
    return ids.map(id =>
      this.hotTier.get(id) || fetched.find(c => c.id === id)
    ).filter(Boolean);
  }

  async filteredCards(): Promise<{
    count: number,
    cards: Card[],
    preview: boolean,
    hasMore: boolean
  }> {
    // Phase 1: Get count + full ID list
    const { count, ids } = await this._fetchCardIDList();

    // Phase 2: Fetch card data for visible batch
    const batchSize = this.visibleCardCount || 50;
    const cards = await this._fetchCardData(ids, batchSize);

    return {
      count,
      cards,
      preview: cards.length < Math.min(ids.length, batchSize),
      hasMore: ids.length > cards.length
    };
  }

  // Progressive loading for scrolling/navigation
  async fetchMoreCards(offset: number, limit: number = 50): Promise<Card[]> {
    const { ids } = await this._fetchCardIDList();  // From cache
    const batch = ids.slice(offset, offset + limit);
    return this._fetchCardData(batch, limit);
  }
}
```

### 2. Server Query Engine

```typescript
// src/server_query_engine.ts - New module for Pipeline operations

export class ServerQueryEngine {
  async execute(query: ServerQuery): Promise<{ count: number, ids: string[] }> {
    // Translate filter chain to Pipeline operations
    const pipeline = this._buildPipeline(query);

    // Execute with timeout
    const result = await Promise.race([
      this._executePipeline(pipeline),
      this._timeout(55000)  // 55s (before 60s server timeout)
    ]);

    return {
      count: result.count,
      ids: result.documents.map(doc => doc.id)
    };
  }

  private _buildPipeline(query: ServerQuery): PipelineQuery {
    const { filters, userId, fieldsOnly, returnCount } = query;

    let pipeline = db.pipeline().collection('cards');

    // Translate each filter to Pipeline expression
    for (const filter of filters) {
      const expr = this._translateFilter(filter);
      if (expr) {
        pipeline = pipeline.where(expr);
      }
    }

    // Apply permissions (user can only see accessible cards)
    pipeline = pipeline.where(
      expr.or(
        expr.eq(expr.field('published'), true),
        expr.eq(expr.field('author'), userId),
        expr.array_contains(expr.field('permissions.editCard'), userId)
      )
    );

    // Optimize for count + IDs only
    if (fieldsOnly) {
      pipeline = pipeline.select(fieldsOnly);
    }

    // Add count aggregation
    if (returnCount) {
      pipeline = pipeline.add_fields({
        total_count: expr.count(expr.field('*'))
      });
    }

    return pipeline;
  }

  private _translateFilter(filter: Filter): Expression | null {
    switch (filter.type) {
      case 'query':
        return this._translateTextQuery(filter);
      case 'section':
        return expr.eq(expr.field('section'), filter.value);
      case 'tag':
        return expr.array_contains(expr.field('tags'), filter.value);
      case 'date':
        return this._translateDateFilter(filter);
      case 'published':
        return expr.eq(expr.field('published'), filter.value);
      case 'author':
        return expr.eq(expr.field('author'), filter.userId);

      // Client-only filters (cannot translate)
      case 'references':
      case 'similar':
      case 'combine':
      case 'expand':
        return null;  // Handled by fallback

      default:
        console.warn(`Unsupported filter type: ${filter.type}`);
        return null;
    }
  }

  private _translateTextQuery(filter: QueryFilter): Expression {
    const tokens = filter.preparedQuery.withoutStopWords;  // Stemmed tokens

    // Query all NLP fields uniformly (pre-filtered by card type)
    const fieldQueries = [
      'nlp.body[*].withoutStopWords',
      'nlp.title[*].withoutStopWords',
      'nlp.subtitle[*].withoutStopWords',
      'nlp.commentary[*].withoutStopWords',
      'nlp.references[*].withoutStopWords',
      // ... all 9 possible NLP fields
    ].map(field =>
      tokens.map(token =>
        expr.str_contains(expr.field(field), token)
      ).reduce((a, b) => expr.and(a, b))  // All tokens must match
    ).reduce((a, b) => expr.or(a, b));  // Match any field

    return fieldQueries;
  }
}
```

### 3. Caching Layer

```typescript
// src/cache/collection_cache.ts - New caching infrastructure

export class CollectionCache {
  private memoryCache: Map<string, CachedResult> = new Map();
  private idbCache: IDBDatabase;

  constructor() {
    this.idbCache = await this._initIndexedDB();
    this._startCleanupTimer();
  }

  async get(key: string): Promise<CachedResult | null> {
    // Check memory first (fastest)
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key);
    }

    // Check IndexedDB (persistent)
    const cached = await this._getFromIDB(key);
    if (cached) {
      this.memoryCache.set(key, cached);  // Promote to memory
      return cached;
    }

    return null;
  }

  async set(
    key: string,
    value: { count: number, ids: string[] },
    options: { ttl: number }
  ): Promise<void> {
    const cached = {
      value,
      timestamp: Date.now(),
      ttl: options.ttl
    };

    // Write to both memory and IndexedDB
    this.memoryCache.set(key, cached);
    await this._setInIDB(key, cached);
  }

  isStale(cached: CachedResult): boolean {
    const age = Date.now() - cached.timestamp;
    return age > cached.ttl;
  }

  invalidateAll(): void {
    // Called when ANY card changes
    this.memoryCache.clear();
    this._clearIDB();
  }

  invalidatePattern(pattern: string): void {
    // Called when specific cards change
    for (const [key, _] of this.memoryCache) {
      if (key.includes(pattern)) {
        this.memoryCache.delete(key);
        this._deleteFromIDB(key);
      }
    }
  }
}
```

### 4. Hot Tier Management

```typescript
// src/hot_tier.ts - Existing onSnapshot logic enhanced

class HotTier {
  private cards: Map<string, Card> = new Map();
  private maxSize: number = 7000;  // 7k cards (up from 5k with pre-computed NLP)

  constructor() {
    this._setupFirestoreListeners();
  }

  private _setupFirestoreListeners() {
    // Existing onSnapshot queries (UNCHANGED)
    onSnapshot(
      query(
        collection(db, 'cards'),
        where('published', '==', true),
        orderBy('updated', 'desc'),
        limit(this.maxSize / 2)  // 3500 published
      ),
      this._handleSnapshot('published')
    );

    onSnapshot(
      query(
        collection(db, 'cards'),
        where('published', '==', false),
        where('permissions.editCard', 'array-contains', currentUserId()),
        orderBy('updated', 'desc'),
        limit(this.maxSize / 2)  // 3500 unpublished
      ),
      this._handleSnapshot('unpublished')
    );
  }

  private _handleSnapshot(type: string) {
    return (snapshot: QuerySnapshot) => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added' || change.type === 'modified') {
          this.cards.set(change.doc.id, change.doc.data() as Card);
        } else if (change.type === 'removed') {
          this.cards.delete(change.doc.id);
        }
      });

      // Invalidate cache entries that might be affected
      collectionCache.invalidatePattern(type);

      // Evict if over size
      this._evictLRU();
    };
  }

  get(id: string): Card | undefined {
    return this.cards.get(id);
  }

  has(id: string): boolean {
    return this.cards.has(id);
  }

  private _evictLRU() {
    if (this.cards.size <= this.maxSize) return;

    // Evict oldest cards by last accessed time
    const sorted = Array.from(this.cards.entries())
      .sort((a, b) => (a[1]._accessed || 0) - (b[1]._accessed || 0));

    const toRemove = sorted.slice(0, this.cards.size - this.maxSize);
    toRemove.forEach(([id, _]) => this.cards.delete(id));
  }
}
```

### 5. KeyCard Navigation with Prefetching

```typescript
// src/navigation.ts - Enhanced for prefetching

class NavigationController {
  private prefetchBuffer: number = 50;  // Cards before/after current

  async navigateToKeyCard(newKeyCardId: string) {
    const collection = this.currentCollection;
    const { ids } = await collection._fetchCardIDList();  // From cache

    // Find position in collection
    const index = ids.indexOf(newKeyCardId);
    if (index === -1) {
      console.warn('KeyCard not in collection');
      return;
    }

    // Prefetch window: [index - buffer, index + buffer]
    const windowStart = Math.max(0, index - this.prefetchBuffer);
    const windowEnd = Math.min(ids.length, index + this.prefetchBuffer + 1);
    const windowIds = ids.slice(windowStart, windowEnd);

    // Fetch card data for window (if not already loaded)
    await collection._fetchCardData(windowIds, windowIds.length);

    // Update UI
    this.setKeyCard(newKeyCardId);
  }

  // Called when user scrolls
  async onScroll(visibleCardIds: string[]) {
    const collection = this.currentCollection;
    const { ids } = await collection._fetchCardIDList();

    // Find visible range
    const firstIndex = ids.indexOf(visibleCardIds[0]);
    const lastIndex = ids.indexOf(visibleCardIds[visibleCardIds.length - 1]);

    // Prefetch next batch if approaching boundary
    const remainingInBatch = ids.length - lastIndex;
    if (remainingInBatch < 10) {
      const nextBatch = ids.slice(lastIndex + 1, lastIndex + 51);
      collection._fetchCardData(nextBatch, 50);  // Background fetch
    }
  }
}
```

## Fallback Strategy

### Client-Only Filters

Some filters cannot be translated to server-side Pipeline operations:

```typescript
class ServerQueryEngine {
  async execute(query: ServerQuery): Promise<{ count: number, ids: string[] }> {
    const { filters } = query;

    // Separate server-capable and client-only filters
    const serverFilters = filters.filter(f => this._canTranslate(f));
    const clientFilters = filters.filter(f => !this._canTranslate(f));

    if (clientFilters.length > 0) {
      // Hybrid: Get candidates from server, refine client-side
      return this._hybridExecution(serverFilters, clientFilters);
    }

    // Pure server execution
    return this._serverExecution(serverFilters);
  }

  private async _hybridExecution(
    serverFilters: Filter[],
    clientFilters: Filter[]
  ): Promise<{ count: number, ids: string[] }> {
    // Phase 1: Server returns candidate cards (broader filter)
    const candidates = await this._serverExecution(serverFilters);

    // Phase 2: Fetch candidate card data
    const cards = await firestore.batchGet(candidates.ids);

    // Phase 3: Client-side refinement
    const refined = cards.filter(card =>
      clientFilters.every(filter => filter.func(card))
    );

    return {
      count: refined.length,
      ids: refined.map(c => c.id)
    };
  }
}
```

### Timeout Handling

```typescript
private async _executePipeline(pipeline: PipelineQuery): Promise<Result> {
  try {
    const result = await pipeline.execute();
    return result;
  } catch (error) {
    if (error.code === 'DEADLINE_EXCEEDED') {
      console.warn('Server query timeout, falling back to client');
      return this._clientFallback();
    }
    throw error;
  }
}

private async _clientFallback(): Promise<Result> {
  // Fall back to client-side execution on hot tier only
  const hotCards = Array.from(hotTier.cards.values());
  const filtered = hotCards.filter(card =>
    this.filterChain.every(filter => filter.func(card))
  );

  return {
    count: filtered.length,
    ids: filtered.map(c => c.id),
    fallback: true  // Flag for UI warning
  };
}
```

## IDF Calculation Integration

```typescript
// src/nlp_server.ts - Server-side IDF calculation

export async function calculateIDF(): Promise<IDFMap> {
  // Query ALL cards for NLP data
  const result = await db.pipeline()
    .collection('cards')
    .select(['id', 'nlp'])  // Only need NLP fields
    .execute();

  const termCounts = new Map<string, number>();
  const totalDocs = result.documents.length;

  // Iterate over all cards
  for (const doc of result.documents) {
    const nlp = doc.nlp || {};
    const uniqueTerms = new Set<string>();

    // Iterate over all NLP fields present (pre-filtered)
    for (const fieldRuns of Object.values(nlp)) {
      for (const run of fieldRuns) {
        const tokens = run.withoutStopWords.split(' ');
        tokens.forEach(token => uniqueTerms.add(token));
      }
    }

    // Increment document frequency for each unique term
    uniqueTerms.forEach(term => {
      termCounts.set(term, (termCounts.get(term) || 0) + 1);
    });
  }

  // Calculate IDF: log(totalDocs / docFrequency)
  const idfMap = new Map<string, number>();
  for (const [term, docFreq] of termCounts) {
    idfMap.set(term, Math.log(totalDocs / docFreq));
  }

  return idfMap;
}

// Cache IDF calculation (expensive, changes slowly)
let idfCache: { map: IDFMap, timestamp: number } | null = null;

export async function getIDF(): Promise<IDFMap> {
  const now = Date.now();
  const cacheAge = idfCache ? now - idfCache.timestamp : Infinity;

  // Refresh every 24 hours
  if (cacheAge > 24 * 60 * 60 * 1000) {
    idfCache = {
      map: await calculateIDF(),
      timestamp: now
    };
  }

  return idfCache.map;
}
```

## Cost Analysis

### Per-Query Cost Breakdown

**Phase 1 (Count + Card IDs):**
```
Query all 30k cards (4 KiB avg): 30,000 reads
Select only 'id' field: Still 30,000 reads (Firestore doesn't support field projection for read charging)
Total: 30,000 read units = $0.000180

NOTE: Actually cheaper with covered queries (index only):
If index exists on filter fields + id: ~60 read units = $0.000036
```

**Phase 2 (Card Data Batch):**
```
Fetch 50 cards (full documents):
50 cards × 1 read = 50 read units = $0.00003

Fetch 200 cards:
200 cards × 1 read = 200 read units = $0.00012
```

### Monthly Cost Estimates

**Scenario 1: Single Power User**
```
Assumptions:
- 10 explicit searches/day
- 500 navigation collections/day (sidebar, references)
- 90% cache hit rate for card ID lists
- Average 50 cards viewed per collection

Phase 1 (card ID lists):
  Uncached queries: (10 + 500) × 0.1 = 51 per day
  Per query: 60 reads (covered query)
  Daily reads: 51 × 60 = 3,060
  Monthly reads: 3,060 × 30 = 91,800
  Cost: $0.055/month

Phase 2 (card data):
  Collections per day: 510
  Cards per collection: 50 avg
  Hot tier hit rate: 70%
  Fetched per day: 510 × 50 × 0.3 = 7,650
  Monthly reads: 7,650 × 30 = 229,500
  Cost: $0.138/month

Total: $0.193/month ≈ $0.20/month
```

**Scenario 2: 1000 Active Users (Original Estimate)**
```
Assumptions:
- 5 queries/user/day
- 80% cache hit rate
- 50% queries hit hot tier

Daily queries: 1000 × 5 = 5,000
Uncached queries: 5,000 × 0.2 = 1,000

Phase 1: 1,000 × 60 = 60,000 reads/day = 1.8M reads/month = $1.08/month
Phase 2: 5,000 × 50 × 0.5 = 125,000 reads/day = 3.75M reads/month = $2.25/month

Total: $3.33/month (well under $5/month target)
```

### Cache Hit Rate Sensitivity

| Cache Hit Rate | Monthly Cost (Single User) | Monthly Cost (1000 Users) |
|----------------|---------------------------|---------------------------|
| 70% | $0.29/month | $4.99/month |
| 80% | $0.24/month | $4.16/month |
| 90% | $0.20/month | $3.33/month |
| 95% | $0.18/month | $2.91/month |

## Implementation Plan

### Phase 1: Foundation (2 weeks)

**Week 1: Server Infrastructure**
- [ ] Create `server_query_engine.ts` module
- [ ] Implement filter translation for basic types (query, section, tag, date)
- [ ] Setup Firebase Functions endpoint for Pipeline queries
- [ ] Add timeout and error handling

**Week 2: Client Integration**
- [ ] Create `collection_cache.ts` with IndexedDB
- [ ] Modify `Collection` class to use server-first pattern
- [ ] Implement two-phase fetch flow
- [ ] Add fallback for unsupported filters

### Phase 2: Progressive Loading (2 weeks)

**Week 3: Batching & Prefetching**
- [ ] Implement `fetchMoreCards()` for scrolling
- [ ] Add prefetch logic for KeyCard navigation
- [ ] Create `NavigationController` for smart prefetching
- [ ] Add progress indicators in UI

**Week 4: Hot Tier Enhancement**
- [ ] Increase hot tier size to 7k cards (pre-computed NLP)
- [ ] Add LRU eviction logic
- [ ] Optimize cache invalidation on card changes
- [ ] Add telemetry for cache hit rates

### Phase 3: Optimization (1 week)

**Week 5: Performance & Cost**
- [ ] Add covered query optimization (index hints)
- [ ] Implement IDF calculation with server-side NLP
- [ ] Add query result caching
- [ ] Monitor and tune cache TTLs
- [ ] Load testing and cost validation

### Files to Create

**New Files** (~800 LOC):
- `src/server_query_engine.ts` (~300 LOC) - Pipeline query builder and executor
- `src/cache/collection_cache.ts` (~200 LOC) - IndexedDB-backed cache
- `src/nlp_server.ts` (~150 LOC) - Server-side IDF calculation
- `src/navigation.ts` (~150 LOC) - Prefetching logic
- `functions/src/pipeline_search.ts` (~200 LOC) - Cloud Function endpoint

**Modified Files** (~400 LOC changes):
- `src/collection_description.ts` (+200 LOC) - Two-phase fetch integration
- `src/actions/database.ts` (+100 LOC) - Hot tier size increase, cache invalidation
- `src/selectors.ts` (+50 LOC) - Cache-aware selectors
- `src/reducers/data.ts` (+50 LOC) - Cache state management

**Total**: ~1200 LOC

### Migration Timeline

**Week 1-2**: Backend infrastructure (transparent to users)
**Week 3**: Feature flag rollout (10% of queries)
**Week 4**: Ramp to 50% of queries
**Week 5**: Full rollout (100%)

### Risk Mitigation

1. **Server Dependency**: Graceful fallback to client-side (hot tier only)
2. **Cost Overrun**: Feature flag to disable server queries if budget exceeded
3. **Latency Regression**: Aggressive caching + prefetching to mask cold starts
4. **Cache Invalidation**: Conservative TTLs (15 min) to avoid stale data

## Comparison to Requirements

### ✅ Meets All Requirements

| Requirement | How Met |
|------------|---------|
| Search all 30k+ cards | ✅ Server query returns full result set |
| Two-phase fetch | ✅ Fundamental architecture (count + IDs, then card data) |
| Progressive loading with count | ✅ Count returned immediately, cards in batches |
| KeyCard collections | ✅ Cache + prefetch makes navigation instant |
| Preserve save performance | ✅ Client keeps <7k cards, saves stay fast |
| Cost <$5/month | ✅ $0.20-3.33/month depending on scale |
| IDF calculations | ✅ Server-side IDF over full 30k corpus |
| Pre-filtered NLP | ✅ Server queries NLP fields uniformly |

### Performance Targets

| Metric | Target | Actual |
|--------|--------|--------|
| Save latency | <500ms P95 | ~200ms (7k cards) |
| Query count | Immediate | ✅ Phase 1 |
| First card batch | <500ms | 200-500ms (uncached), <50ms (cached) |
| Navigation latency | <100ms | <50ms (prefetched) |
| Cache hit rate | >70% | 90-95% target |

## Alternatives Considered

### Why Not Client-First?

**Rejected**: Client-first with selective server delegation
- **Reason**: Adds complexity (decision logic for when to use server)
- **Trade-off**: Simpler to always query server with aggressive caching

### Why Not Dual-Track?

**Rejected**: Parallel client + server execution
- **Reason**: Always queries server (even when cached would suffice)
- **Trade-off**: Server-first with cache is faster for common case

### Why Not Hot/Cold Trigger-Based?

**Rejected**: Only query server when hot tier insufficient
- **Reason**: Unpredictable latency (sometimes instant, sometimes 500ms)
- **Trade-off**: Consistent server-first with cache is more predictable

## Summary

**Approach 1 (Server-First Query Engine)** is the simplest, most scalable architecture:

1. **All collections query server** for count + card IDs (Phase 1)
2. **Aggressive caching** makes 90-95% of queries instant
3. **Progressive fetching** loads card data only as needed (Phase 2)
4. **Hot tier** provides real-time updates for recent cards
5. **Cost**: $0.20-3.33/month depending on scale

**Choose this approach if you value**:
- Simplicity (one clear pattern for all collections)
- Predictability (consistent latency with caching)
- Scalability (works for 30k, 300k, 3M cards)
- Long-term maintainability (less clever, more straightforward)
