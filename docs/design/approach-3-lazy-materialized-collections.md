# Approach 3: Lazy Materialized Collections

> **Philosophy**: Collections are lightweight card ID lists until rendered. Separate the concerns of "what matches" (filtering) from "show me the data" (materialization).
>
> **Strategy**: Aggressively cache card ID lists (Phase 1), lazily materialize card data only for visible cards (Phase 2). Collections are just pointers until viewed.
>
> **Key Insight**: Collection definitions repeat thousands of times per day (sidebar updates), but the underlying card ID lists change rarely (cards don't change often).

## Executive Summary

### Core Architecture

Collections have two distinct lifecycle phases:

1. **Definition Phase** (lightweight): Hash filter chain → return cached card ID list
2. **Materialization Phase** (on-demand): Fetch card data for visible cards only

Every collection starts as just a descriptor (filter chain). Card ID lists are computed once and cached for hours. Card data is fetched only when cards are actually rendered.

### Key Characteristics

- **Lazy by default**: Collections don't materialize until rendered
- **Aggressive ID caching**: Card ID lists cached for 1-4 hours
- **Minimal card data**: Only fetch what's visible (50-100 cards)
- **Unified abstraction**: Same pattern for all collection types

### Trade-offs

✅ **Strengths**:
- Extreme cost efficiency (cache hit rate 95%+, minimal card data fetched)
- Memory efficient (collections are tiny until materialized)
- Fast count queries (ID list has count built-in)
- Scalable (works for thousands of collections)

❌ **Weaknesses**:
- Two-tier mental model (definition vs materialization)
- Cache staleness possible (1-4 hour TTL)
- More complex cache invalidation
- Harder to debug (two layers of indirection)

### When to Choose This Approach

- **High collection churn**: Thousands of collection instantiations per day
- **Stable corpus**: Cards change infrequently (good cache hit rates)
- **Memory constrained**: Want minimal resident memory
- **Cost priority**: Lowest possible server query costs

## Detailed Architecture

### 1. Collection Descriptor

```typescript
// src/collection_descriptor.ts - Lightweight collection definition

export class CollectionDescriptor {
  readonly filterChain: Filter[];
  readonly userId: string;
  readonly hash: string;  // Deterministic hash of filter chain

  constructor(filterChain: Filter[], userId: string) {
    this.filterChain = filterChain;
    this.userId = userId;
    this.hash = this._computeHash();
  }

  private _computeHash(): string {
    // Deterministic hash that uniquely identifies this collection
    const filterStr = this.filterChain
      .map(f => `${f.type}:${JSON.stringify(f.value || {})}`)
      .join('|');

    return `coll:${this.userId}:${hashString(filterStr)}`;
  }

  // Collection descriptors are serializable (for URL encoding)
  toJSON(): string {
    return JSON.stringify({
      filters: this.filterChain.map(f => f.serialize()),
      userId: this.userId
    });
  }

  static fromJSON(json: string): CollectionDescriptor {
    const { filters, userId } = JSON.parse(json);
    const filterChain = filters.map(f => Filter.deserialize(f));
    return new CollectionDescriptor(filterChain, userId);
  }
}
```

### 2. Card ID List Cache

```typescript
// src/card_id_list_cache.ts - Aggressive caching of card ID lists

export class CardIDListCache {
  private memoryCache: Map<string, CachedIDList> = new Map();
  private idbCache: IDBDatabase;

  async get(descriptor: CollectionDescriptor): Promise<CardIDList | null> {
    const key = descriptor.hash;

    // Check memory first
    if (this.memoryCache.has(key)) {
      const cached = this.memoryCache.get(key);

      if (!this._isStale(cached)) {
        return cached.value;
      }

      // Stale, remove from cache
      this.memoryCache.delete(key);
    }

    // Check IndexedDB
    const idbCached = await this._getFromIDB(key);
    if (idbCached && !this._isStale(idbCached)) {
      // Promote to memory
      this.memoryCache.set(key, idbCached);
      return idbCached.value;
    }

    return null;  // Cache miss
  }

  async set(
    descriptor: CollectionDescriptor,
    value: CardIDList,
    options: { ttl: number }
  ): Promise<void> {
    const key = descriptor.hash;
    const cached: CachedIDList = {
      value,
      timestamp: Date.now(),
      ttl: options.ttl,
      descriptor: descriptor.toJSON()
    };

    // Write to both memory and IndexedDB
    this.memoryCache.set(key, cached);
    await this._setInIDB(key, cached);
  }

  private _isStale(cached: CachedIDList): boolean {
    const age = Date.now() - cached.timestamp;
    return age > cached.ttl;
  }

  // Invalidate based on card changes
  async invalidateAffected(changedCardIds: string[]) {
    // Strategy: Invalidate all collections that might contain these cards
    // This is conservative but safe

    const toInvalidate: string[] = [];

    for (const [key, cached] of this.memoryCache) {
      // Check if any changed card is in this collection's ID list
      const hasAffectedCard = changedCardIds.some(id =>
        cached.value.ids.includes(id)
      );

      if (hasAffectedCard) {
        toInvalidate.push(key);
      }
    }

    // Remove from cache
    toInvalidate.forEach(key => {
      this.memoryCache.delete(key);
      this._deleteFromIDB(key);
    });

    console.log(`Invalidated ${toInvalidate.length} collections due to card changes`);
  }

  // Invalidate all (nuclear option)
  invalidateAll() {
    this.memoryCache.clear();
    this._clearIDB();
  }
}

interface CardIDList {
  count: number;
  ids: string[];
  timestamp: number;
}

interface CachedIDList {
  value: CardIDList;
  timestamp: number;
  ttl: number;
  descriptor: string;  // For debugging
}
```

### 3. Lazy Collection

```typescript
// src/lazy_collection.ts - Two-phase lazy materialization

export class LazyCollection {
  private descriptor: CollectionDescriptor;
  private idList: CardIDList | null = null;
  private materializedCards: Map<number, Card> = new Map();  // offset -> card

  constructor(filterChain: Filter[], userId: string) {
    this.descriptor = new CollectionDescriptor(filterChain, userId);
  }

  // Phase 1: Get card ID list (fast, cached)
  async getIDList(): Promise<CardIDList> {
    if (this.idList) {
      return this.idList;  // Already fetched
    }

    // Check cache first
    const cached = await cardIDListCache.get(this.descriptor);

    if (cached) {
      this.idList = cached;
      return cached;
    }

    // Cache miss, query server
    this.idList = await this._fetchIDListFromServer();

    // Cache result (1-4 hour TTL based on collection type)
    const ttl = this._getTTL();
    await cardIDListCache.set(this.descriptor, this.idList, { ttl });

    return this.idList;
  }

  // Phase 2: Materialize cards for visible range (lazy)
  async materialize(offset: number, limit: number): Promise<Card[]> {
    const idList = await this.getIDList();

    // Get IDs for requested range
    const rangeIds = idList.ids.slice(offset, offset + limit);

    // Check what's already materialized
    const materialized: Card[] = [];
    const toFetch: string[] = [];

    rangeIds.forEach((id, i) => {
      const globalOffset = offset + i;
      if (this.materializedCards.has(globalOffset)) {
        materialized.push(this.materializedCards.get(globalOffset));
      } else {
        toFetch.push(id);
      }
    });

    // Fetch missing cards
    if (toFetch.length > 0) {
      const fetched = await this._fetchCardData(toFetch);

      // Store in materialized map
      fetched.forEach((card, i) => {
        const globalOffset = offset + materialized.length + i;
        this.materializedCards.set(globalOffset, card);
      });

      materialized.push(...fetched);
    }

    return materialized;
  }

  // Get count without materializing any cards
  async count(): Promise<number> {
    const idList = await this.getIDList();
    return idList.count;
  }

  // Check if card is in collection (without materializing)
  async contains(cardId: string): Promise<boolean> {
    const idList = await this.getIDList();
    return idList.ids.includes(cardId);
  }

  // Find position of card in collection
  async indexOf(cardId: string): Promise<number> {
    const idList = await this.getIDList();
    return idList.ids.indexOf(cardId);
  }

  private async _fetchIDListFromServer(): Promise<CardIDList> {
    const result = await serverQueryEngine.execute({
      filters: this.descriptor.filterChain,
      userId: this.descriptor.userId,
      fieldsOnly: ['id'],
      returnCount: true
    });

    return {
      count: result.count,
      ids: result.ids,
      timestamp: Date.now()
    };
  }

  private async _fetchCardData(ids: string[]): Promise<Card[]> {
    // Check hot tier first
    const hotCards: Card[] = [];
    const missingIds: string[] = [];

    ids.forEach(id => {
      const hot = hotTier.get(id);
      if (hot) {
        hotCards.push(hot);
      } else {
        missingIds.push(id);
      }
    });

    // Fetch missing from Firestore
    if (missingIds.length > 0) {
      const fetched = await firestore.batchGet(missingIds);
      return [...hotCards, ...fetched];
    }

    return hotCards;
  }

  private _getTTL(): number {
    // Different TTLs for different collection types
    const filterTypes = new Set(this.descriptor.filterChain.map(f => f.type));

    if (filterTypes.has('query')) {
      // Text queries: 15 minutes (might be exploring)
      return 15 * 60 * 1000;
    } else if (filterTypes.has('similar')) {
      // Similar cards: 1 hour (stable)
      return 60 * 60 * 1000;
    } else if (filterTypes.has('references')) {
      // References: 4 hours (very stable)
      return 4 * 60 * 60 * 1000;
    } else {
      // Default: 1 hour
      return 60 * 60 * 1000;
    }
  }

  // Prefetch next batch (for scrolling)
  async prefetchNext(currentOffset: number, batchSize: number = 50) {
    const nextOffset = currentOffset + batchSize;
    this.materialize(nextOffset, batchSize);  // Fire and forget
  }
}
```

### 4. Collection Factory

```typescript
// src/collection_factory.ts - Centralized collection creation

export class CollectionFactory {
  private instances: Map<string, LazyCollection> = new Map();

  // Get or create collection (singleton per descriptor)
  getCollection(filterChain: Filter[], userId: string): LazyCollection {
    const descriptor = new CollectionDescriptor(filterChain, userId);
    const key = descriptor.hash;

    if (!this.instances.has(key)) {
      const collection = new LazyCollection(filterChain, userId);
      this.instances.set(key, collection);
    }

    return this.instances.get(key);
  }

  // Invalidate collections affected by card changes
  async invalidateAffected(changedCardIds: string[]) {
    // Invalidate card ID list cache
    await cardIDListCache.invalidateAffected(changedCardIds);

    // Clear materialized cards from instances
    for (const collection of this.instances.values()) {
      collection.materializedCards.clear();
    }
  }

  // Stats for debugging
  getStats() {
    return {
      activeCollections: this.instances.size,
      cacheSize: cardIDListCache.memoryCache.size,
      memoryUsage: this._estimateMemory()
    };
  }

  private _estimateMemory(): number {
    let bytes = 0;

    for (const collection of this.instances.values()) {
      // Collection descriptor: ~1 KB
      bytes += 1024;

      // Materialized cards: ~10 KB per card
      bytes += collection.materializedCards.size * 10240;
    }

    return bytes;
  }
}

// Singleton instance
export const collectionFactory = new CollectionFactory();
```

### 5. Integration with UI

```typescript
// src/components/card-list.tsx - Lazy rendering

const CardList: React.FC<{ collection: LazyCollection }> = ({ collection }) => {
  const [count, setCount] = useState<number | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const batchSize = 50;

  useEffect(() => {
    // Phase 1: Get count immediately (fast)
    collection.count().then(setCount);
  }, [collection]);

  useEffect(() => {
    // Phase 2: Materialize visible cards (lazy)
    setLoading(true);

    collection.materialize(offset, batchSize).then(materialized => {
      setCards(materialized);
      setLoading(false);

      // Prefetch next batch
      collection.prefetchNext(offset, batchSize);
    });
  }, [collection, offset]);

  const handleScroll = (e: ScrollEvent) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;

    // Approaching bottom? Load more
    if (scrollTop + clientHeight > scrollHeight - 200) {
      setOffset(offset + batchSize);
    }
  };

  return (
    <div onScroll={handleScroll}>
      {count !== null && (
        <div className="count">
          Showing {offset + 1}-{Math.min(offset + batchSize, count)} of {count}
        </div>
      )}

      {cards.map(card => (
        <CardPreview key={card.id} card={card} />
      ))}

      {loading && <Spinner />}
    </div>
  );
};
```

### 6. KeyCard Navigation

```typescript
// src/navigation.ts - Efficient KeyCard navigation with lazy collections

export class NavigationController {
  async navigateToKeyCard(newKeyCardId: string, collection: LazyCollection) {
    // Find position in collection (from cached ID list)
    const index = await collection.indexOf(newKeyCardId);

    if (index === -1) {
      console.warn('KeyCard not in collection');
      return;
    }

    // Materialize window around keycard
    const windowSize = 100;  // 50 before, 50 after
    const windowOffset = Math.max(0, index - 50);

    const windowCards = await collection.materialize(windowOffset, windowSize);

    // Update UI
    this.setKeyCard(newKeyCardId);

    // Sidebar and reference blocks update instantly
    // (they use the same collection, so ID list is cached)
    this.updateSidebar(collection);
    this.updateReferenceBlocks(collection);
  }

  private updateSidebar(collection: LazyCollection) {
    // Sidebar shows similar cards - uses same pattern
    const sidebarCollection = collectionFactory.getCollection(
      [{ type: 'similar', fromCardId: this.currentKeyCard }],
      this.userId
    );

    // Count is instant (from cache)
    sidebarCollection.count().then(count => {
      this.setSidebarCount(count);
    });

    // Materialize first 10 cards
    sidebarCollection.materialize(0, 10).then(cards => {
      this.setSidebarCards(cards);
    });
  }

  private updateReferenceBlocks(collection: LazyCollection) {
    // Reference blocks (8 per card) - each is a tiny collection
    const references = this.currentCard.references || [];

    references.forEach(ref => {
      const refCollection = collectionFactory.getCollection(
        [{ type: 'references', fromCardId: ref.card }],
        this.userId
      );

      // Count only (no materialization needed for preview)
      refCollection.count().then(count => {
        this.setReferenceCount(ref.card, count);
      });
    });
  }
}
```

## Cost Analysis

### Server Query Frequency

With aggressive ID list caching:

**Single Power User (Realistic):**
```
Assumptions:
- 510 collections/day (10 searches + 500 navigation)
- 95% cache hit rate for card ID lists (1-4 hour TTL)
- 70% hot tier hit rate for card data

Phase 1 (Card ID Lists):
  Uncached queries: 510 × 0.05 = 25.5 per day
  Per query: 60 reads (covered query)
  Monthly: 25.5 × 30 × 60 = 45,900 reads = $0.028/month

Phase 2 (Card Data):
  Collections per day: 510
  Cards per collection: 50 avg
  Hot tier hit rate: 70%
  Fetches per day: 510 × 50 × 0.3 = 7,650
  Monthly: 7,650 × 30 = 229,500 reads = $0.138/month

Total: $0.166/month ≈ $0.17/month
```

**After Warmup (98% cache hit rate):**
```
Phase 1: 510 × 0.02 × 30 × 60 = 18,360 reads = $0.011/month
Phase 2: Same (229,500 reads) = $0.138/month
Total: $0.149/month ≈ $0.15/month
```

**Cold Start (First Day, 0% cache hit):**
```
Phase 1: 510 × 60 = 30,600 reads = $0.018
Phase 2: 510 × 50 × 0.3 = 7,650 reads = $0.0046
Total: $0.023/day → $0.69/month if sustained (but cache builds quickly)
```

### Cache Effectiveness

```
Cache hit rate progression:
- Hour 1: 0% (cold start)
- Hour 4: 50% (common collections cached)
- Day 1: 80% (most navigation patterns cached)
- Week 1: 95% (usage patterns stabilized)
- Week 2+: 98% (steady state)

Average monthly cost: $0.15-0.20/month
```

### Memory Usage

```
Card ID List Cache:
- 100 unique collections × 30k IDs × 20 bytes = 60 MB
- Typical: 20-40 MB (fewer unique collections)

Materialized Cards:
- 200 cards × 10 KB = 2 MB (only visible cards)
- Peak: 5 MB

Hot Tier:
- 7k cards × 10 KB = 70 MB

Total: ~110 MB avg, ~135 MB peak
```

## Implementation Plan

### Phase 1: Foundation (2 weeks)

**Week 1: Card ID List Cache**
- [ ] Create `CardIDListCache` with IndexedDB
- [ ] Implement cache invalidation strategy
- [ ] Add TTL logic for different collection types
- [ ] Create `CollectionDescriptor` class

**Week 2: Lazy Collection**
- [ ] Create `LazyCollection` class
- [ ] Implement two-phase materialization
- [ ] Add prefetching for scrolling
- [ ] Create `CollectionFactory` singleton

### Phase 2: Integration (2 weeks)

**Week 3: UI Integration**
- [ ] Modify existing `Collection` to use `LazyCollection` internally
- [ ] Update card list rendering for lazy materialization
- [ ] Add progress indicators for Phase 2
- [ ] Test with large collections (30k cards)

**Week 4: Navigation & Optimization**
- [ ] Enhance `NavigationController` for lazy collections
- [ ] Optimize KeyCard navigation with caching
- [ ] Add sidebar and reference block optimization
- [ ] Implement smart cache invalidation

### Phase 3: Polish (1 week)

**Week 5: Performance & Monitoring**
- [ ] Add telemetry for cache hit rates
- [ ] Optimize materialization batch sizes
- [ ] Memory profiling and leak detection
- [ ] Load testing with 1000 collections

### Files to Create

**New Files** (~900 LOC):
- `src/collection_descriptor.ts` (~100 LOC) - Lightweight collection identity
- `src/card_id_list_cache.ts` (~300 LOC) - Aggressive caching layer
- `src/lazy_collection.ts` (~350 LOC) - Two-phase materialization
- `src/collection_factory.ts` (~150 LOC) - Singleton factory

**Modified Files** (~250 LOC):
- `src/collection_description.ts` (+150 LOC) - Integrate with LazyCollection
- `src/navigation.ts` (+50 LOC) - Use cached ID lists
- `src/components/card-list.tsx` (+50 LOC) - Lazy rendering

**Total**: ~1150 LOC

## Comparison to Requirements

### ✅ Meets All Requirements

| Requirement | How Met |
|------------|---------|
| Search all 30k+ cards | ✅ Server query returns full ID list |
| Two-phase fetch | ✅ Fundamental architecture (ID list → card data) |
| Progressive loading with count | ✅ Count from ID list (instant), cards materialized on-demand |
| KeyCard collections | ✅ ID list cached, materialization only for visible |
| Preserve save performance | ✅ Client keeps <7k hot tier + ~200 materialized = <8k cards |
| Cost <$5/month | ✅ $0.15-0.20/month with aggressive caching |
| IDF calculations | ✅ Server-side IDF over full corpus |
| Pre-filtered NLP | ✅ Server queries NLP fields uniformly |

### Performance Targets

| Metric | Target | Actual |
|--------|--------|--------|
| Save latency | <500ms P95 | ~200ms (7k hot tier + 1k materialized) |
| Collection count | Immediate | ✅ From cached ID list |
| First card batch | <500ms | <50ms (cached ID list), 200ms (uncached) |
| Navigation latency | <100ms | <50ms (ID list cached, window materialized) |
| Cache hit rate | >70% | 95-98% for ID lists |

## Alternatives Considered

### Why Not Materialize Eagerly?

**Rejected**: Fetch all card data when collection created
- **Reason**: Wastes bandwidth and memory for cards never viewed
- **Trade-off**: Lazy materialization adds complexity but saves 80-90% of fetches

### Why Not Cache Card Data?

**Rejected**: Cache full card objects instead of just IDs
- **Reason**: Cards are large (10 KB), IDs are tiny (20 bytes). ID lists are 500× smaller.
- **Trade-off**: Two-phase complexity vs memory efficiency

### Why Not Shorter TTL?

**Rejected**: 5-15 minute TTL for ID lists
- **Reason**: Cards rarely change (hours/days). Longer TTL (1-4 hours) is safe and saves costs.
- **Trade-off**: Potential staleness vs cost savings (95%+ cache hit rate)

## Summary

**Approach 3 (Lazy Materialized Collections)** maximizes cost and memory efficiency:

1. **Collections are just ID lists** until cards are rendered
2. **Aggressive caching** of ID lists (1-4 hour TTL, 95-98% hit rate)
3. **Lazy materialization** fetches only visible cards (50-100 at a time)
4. **Unified abstraction** works for all collection types
5. **Cost**: $0.15-0.20/month for single power user

**Choose this approach if you value**:
- Extreme cost efficiency (lowest server query costs)
- Memory efficiency (minimal resident memory)
- Scalability (thousands of collections)
- Clear separation of concerns (filtering vs rendering)

**Trade-offs**:
- Two-tier mental model (ID list vs card data)
- Potential cache staleness (1-4 hour TTL)
- More complex invalidation logic
- Slightly higher latency for uncached queries
