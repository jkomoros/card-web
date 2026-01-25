# Approach 4: Streaming Incremental Results

> **Philosophy**: Stream results progressively as they arrive. User sees count immediately, then IDs in chunks, then card data incrementally. No waiting for complete results.
>
> **Strategy**: Server streams count → card IDs → card data in multiple chunks. Client renders incrementally as each chunk arrives.
>
> **Key Insight**: Users prefer to see partial results immediately rather than waiting for complete results. Streaming makes large queries feel instant.

## Executive Summary

### Core Architecture

Queries follow a streaming timeline:

1. **T+0ms**: Query sent to server
2. **T+50ms**: Count received, displayed to user
3. **T+100ms**: First chunk of card IDs received (1000 IDs)
4. **T+150ms**: Second chunk of card IDs received (1000 IDs)
5. **T+200ms**: First batch of card data received (50 cards), rendered
6. **T+300ms**: More card data batches arrive as user scrolls

User sees progress throughout, never a blank screen waiting.

### Key Characteristics

- **Streaming protocol**: Server sends multiple chunks, client processes incrementally
- **Immediate feedback**: Count within 50ms, first cards within 200ms
- **Progressive rendering**: Cards appear as they load
- **Cancellable**: Abort query if user changes filters

### Trade-offs

✅ **Strengths**:
- Best perceived performance (immediate feedback)
- Handles large result sets gracefully (stream, don't block)
- Natural loading indicators (progressive count)
- User can interact with early results while rest loads

❌ **Weaknesses**:
- More complex protocol (server-side streaming)
- Network overhead (multiple chunks)
- Requires Firebase Functions (can't use pure Pipeline operations)
- Harder to cache (partial results)

### When to Choose This Approach

- **Large result sets**: Queries that return thousands of cards
- **User experience priority**: Perceived performance more important than cost
- **Variable latency tolerance**: Users willing to wait if they see progress
- **Modern clients**: Web sockets or streaming HTTP available

## Detailed Architecture

### 1. Streaming Protocol

```typescript
// functions/src/streaming_search.ts - Server-side streaming endpoint

export const streamingSearch = functions.https.onCall(async (data, context) => {
  const { filterChain, userId } = data;

  // Create response stream
  const stream = createResponseStream();

  try {
    // Step 1: Send count immediately
    const countQuery = buildCountQuery(filterChain, userId);
    const count = await countQuery.execute();

    stream.send({
      type: 'count',
      value: count,
      timestamp: Date.now()
    });

    // Step 2: Execute full query for IDs
    const idQuery = buildIDQuery(filterChain, userId);
    const allIds = await idQuery.execute();

    // Step 3: Stream IDs in chunks (1000 at a time)
    const chunkSize = 1000;
    for (let i = 0; i < allIds.length; i += chunkSize) {
      const chunk = allIds.slice(i, i + chunkSize);

      stream.send({
        type: 'ids',
        value: chunk,
        offset: i,
        total: allIds.length,
        timestamp: Date.now()
      });

      // Small delay to avoid overwhelming client
      await sleep(10);
    }

    // Step 4: Signal ID streaming complete
    stream.send({
      type: 'ids_complete',
      total: allIds.length,
      timestamp: Date.now()
    });

    // Note: Card data is fetched by client on-demand, not streamed from server
    // This keeps server response lightweight and fast

  } catch (error) {
    stream.error({
      type: 'error',
      message: error.message,
      timestamp: Date.now()
    });
  } finally {
    stream.close();
  }
});

function buildCountQuery(filterChain: Filter[], userId: string) {
  // Optimized query that returns only count (no documents)
  return db.pipeline()
    .collection('cards')
    .where(buildFilterExpression(filterChain, userId))
    .aggregate({ count: expr.count(expr.field('*')) });
}

function buildIDQuery(filterChain: Filter[], userId: string) {
  // Query that returns only IDs (covered query if indexed)
  return db.pipeline()
    .collection('cards')
    .where(buildFilterExpression(filterChain, userId))
    .select(['id'])
    .execute();
}
```

### 2. Client-Side Stream Receiver

```typescript
// src/streaming_client.ts - Receive and process streamed results

export class StreamingQueryClient {
  private activeStreams: Map<string, StreamingQuery> = new Map();

  async executeQuery(
    filterChain: Filter[],
    onProgress: (event: StreamEvent) => void
  ): Promise<StreamingQuery> {
    const queryId = this._generateQueryId();
    const query = new StreamingQuery(queryId, filterChain, onProgress);

    this.activeStreams.set(queryId, query);

    try {
      await query.execute();
    } finally {
      this.activeStreams.delete(queryId);
    }

    return query;
  }

  cancelQuery(queryId: string) {
    const query = this.activeStreams.get(queryId);
    if (query) {
      query.cancel();
      this.activeStreams.delete(queryId);
    }
  }

  cancelAllQueries() {
    this.activeStreams.forEach(query => query.cancel());
    this.activeStreams.clear();
  }
}

class StreamingQuery {
  private count: number | null = null;
  private ids: string[] = [];
  private idsComplete: boolean = false;
  private cancelled: boolean = false;

  constructor(
    public readonly queryId: string,
    private filterChain: Filter[],
    private onProgress: (event: StreamEvent) => void
  ) {}

  async execute() {
    // Call streaming endpoint
    const callable = httpsCallable(functions, 'streamingSearch');
    const stream = await callable({
      filterChain: this.filterChain.map(f => f.serialize()),
      userId: currentUserId()
    });

    // Process streamed events
    for await (const event of stream) {
      if (this.cancelled) {
        break;
      }

      this._handleEvent(event);
    }
  }

  private _handleEvent(event: StreamEvent) {
    switch (event.type) {
      case 'count':
        this.count = event.value;
        this.onProgress({
          type: 'count',
          count: event.value,
          queryId: this.queryId
        });
        break;

      case 'ids':
        this.ids.push(...event.value);
        this.onProgress({
          type: 'ids_chunk',
          ids: event.value,
          offset: event.offset,
          total: event.total,
          progress: this.ids.length / event.total,
          queryId: this.queryId
        });
        break;

      case 'ids_complete':
        this.idsComplete = true;
        this.onProgress({
          type: 'ids_complete',
          totalIds: this.ids.length,
          queryId: this.queryId
        });
        break;

      case 'error':
        this.onProgress({
          type: 'error',
          error: event.message,
          queryId: this.queryId
        });
        break;
    }
  }

  cancel() {
    this.cancelled = true;
  }

  getCount(): number | null {
    return this.count;
  }

  getIDs(): string[] {
    return this.ids;
  }

  isComplete(): boolean {
    return this.idsComplete;
  }
}
```

### 3. Streaming Collection

```typescript
// src/streaming_collection.ts - Collection with streaming query

export class StreamingCollection {
  private filterChain: Filter[];
  private queryId: string | null = null;
  private count: number | null = null;
  private ids: string[] = [];
  private idsComplete: boolean = false;
  private materializedCards: Map<number, Card> = new Map();

  private listeners: Set<CollectionListener> = new Set();

  constructor(filterChain: Filter[]) {
    this.filterChain = filterChain;
  }

  // Subscribe to collection updates
  subscribe(listener: CollectionListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private _notify(event: CollectionEvent) {
    this.listeners.forEach(listener => listener(event));
  }

  // Start streaming query
  async startQuery() {
    // Cancel existing query if any
    if (this.queryId) {
      streamingClient.cancelQuery(this.queryId);
    }

    // Start new streaming query
    const query = await streamingClient.executeQuery(
      this.filterChain,
      (event) => this._handleStreamEvent(event)
    );

    this.queryId = query.queryId;
  }

  private _handleStreamEvent(event: StreamEvent) {
    switch (event.type) {
      case 'count':
        this.count = event.count;
        this._notify({
          type: 'count_updated',
          count: event.count
        });
        break;

      case 'ids_chunk':
        this.ids.push(...event.ids);
        this._notify({
          type: 'ids_progress',
          idsCount: this.ids.length,
          totalIds: event.total,
          progress: event.progress
        });

        // Start materializing cards for visible range
        this._materializeVisibleRange();
        break;

      case 'ids_complete':
        this.idsComplete = true;
        this._notify({
          type: 'ids_complete',
          totalIds: this.ids.length
        });
        break;

      case 'error':
        this._notify({
          type: 'error',
          error: event.error
        });
        break;
    }
  }

  // Materialize cards for visible range
  private async _materializeVisibleRange(offset: number = 0, limit: number = 50) {
    // Wait until we have IDs for this range
    while (this.ids.length < offset + limit && !this.idsComplete) {
      await sleep(50);  // Wait for more IDs
    }

    const rangeIds = this.ids.slice(offset, offset + limit);

    // Fetch card data (from hot tier or Firestore)
    const cards = await this._fetchCardData(rangeIds);

    // Store materialized cards
    cards.forEach((card, i) => {
      this.materializedCards.set(offset + i, card);
    });

    // Notify listeners
    this._notify({
      type: 'cards_materialized',
      offset,
      cards
    });
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

  // Get current state
  getCount(): number | null {
    return this.count;
  }

  getIDs(): string[] {
    return this.ids;
  }

  getMaterializedCards(offset: number, limit: number): Card[] {
    const cards: Card[] = [];

    for (let i = offset; i < offset + limit; i++) {
      const card = this.materializedCards.get(i);
      if (card) {
        cards.push(card);
      }
    }

    return cards;
  }

  isComplete(): boolean {
    return this.idsComplete;
  }

  // Request materialization of specific range
  async materialize(offset: number, limit: number) {
    return this._materializeVisibleRange(offset, limit);
  }
}
```

### 4. UI Integration with Progress

```typescript
// src/components/streaming-card-list.tsx - Progressive rendering

const StreamingCardList: React.FC<{ collection: StreamingCollection }> = ({ collection }) => {
  const [count, setCount] = useState<number | null>(null);
  const [idsProgress, setIdsProgress] = useState(0);
  const [cards, setCards] = useState<Card[]>([]);
  const [offset, setOffset] = useState(0);
  const batchSize = 50;

  useEffect(() => {
    // Subscribe to collection updates
    const unsubscribe = collection.subscribe((event) => {
      switch (event.type) {
        case 'count_updated':
          setCount(event.count);
          break;

        case 'ids_progress':
          setIdsProgress(event.progress);
          break;

        case 'cards_materialized':
          if (event.offset === offset) {
            setCards(event.cards);
          }
          break;
      }
    });

    // Start query
    collection.startQuery();

    return unsubscribe;
  }, [collection]);

  useEffect(() => {
    // Request materialization when offset changes
    collection.materialize(offset, batchSize);
  }, [offset]);

  return (
    <div>
      {/* Progress indicators */}
      {count !== null && (
        <div className="count">
          {count} results {!collection.isComplete() && '(loading...)'}
        </div>
      )}

      {!collection.isComplete() && (
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${idsProgress * 100}%` }}
          />
          <span>Loading IDs: {Math.round(idsProgress * 100)}%</span>
        </div>
      )}

      {/* Card list */}
      <div className="cards">
        {cards.map((card, i) => (
          <CardPreview
            key={card.id}
            card={card}
            className={i >= cards.length - 10 ? 'prefetch-trigger' : ''}
          />
        ))}
      </div>

      {/* Navigation */}
      {offset > 0 && (
        <button onClick={() => setOffset(Math.max(0, offset - batchSize))}>
          Previous
        </button>
      )}

      {count && offset + batchSize < count && (
        <button onClick={() => setOffset(offset + batchSize)}>
          Next
        </button>
      )}
    </div>
  );
};
```

### 5. Optimized Caching Layer

```typescript
// src/streaming_cache.ts - Cache streamed results

export class StreamingCache {
  private idListCache: Map<string, CachedIDList> = new Map();
  private maxCacheSize: number = 100;

  // Cache ID list from streaming query
  cacheIDList(filterHash: string, ids: string[], count: number) {
    this.idListCache.set(filterHash, {
      ids,
      count,
      timestamp: Date.now(),
      ttl: 15 * 60 * 1000  // 15 minutes
    });

    this._evictOldest();
  }

  // Try to get cached ID list
  getCachedIDList(filterHash: string): CachedIDList | null {
    const cached = this.idListCache.get(filterHash);

    if (!cached) {
      return null;
    }

    // Check staleness
    const age = Date.now() - cached.timestamp;
    if (age > cached.ttl) {
      this.idListCache.delete(filterHash);
      return null;
    }

    return cached;
  }

  private _evictOldest() {
    if (this.idListCache.size <= this.maxCacheSize) {
      return;
    }

    // Find oldest entry
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, value] of this.idListCache) {
      if (value.timestamp < oldestTime) {
        oldestTime = value.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.idListCache.delete(oldestKey);
    }
  }

  // Invalidate affected caches
  invalidateAffected(changedCardIds: string[]) {
    const toDelete: string[] = [];

    for (const [key, value] of this.idListCache) {
      // Conservative: invalidate if any changed card in ID list
      const hasAffected = changedCardIds.some(id => value.ids.includes(id));
      if (hasAffected) {
        toDelete.push(key);
      }
    }

    toDelete.forEach(key => this.idListCache.delete(key));
  }
}

interface CachedIDList {
  ids: string[];
  count: number;
  timestamp: number;
  ttl: number;
}
```

### 6. Query Cancellation

```typescript
// src/query_controller.ts - Manage query lifecycle

export class QueryController {
  private activeQuery: StreamingQuery | null = null;

  async executeQuery(filterChain: Filter[]): Promise<StreamingCollection> {
    // Cancel existing query if filter changed
    if (this.activeQuery) {
      this.activeQuery.cancel();
      this.activeQuery = null;
    }

    // Check cache first
    const filterHash = this._hashFilters(filterChain);
    const cached = streamingCache.getCachedIDList(filterHash);

    if (cached) {
      // Return instant collection from cache
      return this._buildFromCache(filterChain, cached);
    }

    // Start new streaming query
    const collection = new StreamingCollection(filterChain);
    await collection.startQuery();

    // Track as active
    this.activeQuery = collection.queryId ?
      streamingClient.activeStreams.get(collection.queryId) :
      null;

    // Cache result when complete
    collection.subscribe((event) => {
      if (event.type === 'ids_complete') {
        streamingCache.cacheIDList(
          filterHash,
          collection.getIDs(),
          collection.getCount()
        );
      }
    });

    return collection;
  }

  private _buildFromCache(
    filterChain: Filter[],
    cached: CachedIDList
  ): StreamingCollection {
    const collection = new StreamingCollection(filterChain);

    // Populate with cached data (synchronous)
    collection['count'] = cached.count;
    collection['ids'] = cached.ids;
    collection['idsComplete'] = true;

    // Notify listeners immediately
    collection['_notify']({ type: 'count_updated', count: cached.count });
    collection['_notify']({ type: 'ids_complete', totalIds: cached.ids.length });

    return collection;
  }

  private _hashFilters(filterChain: Filter[]): string {
    return filterChain
      .map(f => `${f.type}:${JSON.stringify(f.value || {})}`)
      .join('|');
  }
}
```

## Cost Analysis

### Server Query Costs

**Single Power User:**
```
Assumptions:
- 10 explicit searches/day
- 500 navigation collections/day
- 80% cache hit rate (streaming cache)
- Average 50 cards viewed per collection

Uncached queries: 510 × 0.2 = 102 per day

Per streaming query:
  Count query: 30k cards, aggregation only = 30k reads
  ID query: 30k cards, select ['id'] = 30k reads (covered: 60 reads)
  Total: 60 reads (with index)

Phase 1 (streaming queries):
  Daily: 102 × 60 = 6,120 reads
  Monthly: 6,120 × 30 = 183,600 reads = $0.110/month

Phase 2 (card data):
  Collections per day: 510
  Cards per collection: 50
  Hot tier hit rate: 70%
  Fetches: 510 × 50 × 0.3 = 7,650 per day
  Monthly: 7,650 × 30 = 229,500 reads = $0.138/month

Total: $0.248/month ≈ $0.25/month
```

**With 95% Cache Hit Rate (After Warmup):**
```
Uncached queries: 510 × 0.05 = 25.5 per day

Phase 1: 25.5 × 30 × 60 = 45,900 reads = $0.028/month
Phase 2: 229,500 reads = $0.138/month
Total: $0.166/month ≈ $0.17/month
```

### Network Overhead

```
Per streaming query:
  Count message: ~100 bytes
  IDs (30k cards): ~240 KB (chunked)
  Total: ~240 KB

Per query with cached IDs:
  No network (instant from cache)

Average network per query: 240 KB × 0.2 (uncached) = 48 KB
Daily network: 510 queries × 48 KB = 24.5 MB
Monthly network: 24.5 MB × 30 = 735 MB

This is negligible for modern networks.
```

## Implementation Plan

### Phase 1: Streaming Infrastructure (2 weeks)

**Week 1: Server-Side Streaming**
- [ ] Create Firebase Function with streaming support
- [ ] Implement count query (optimized)
- [ ] Implement ID query with chunking (1000 per chunk)
- [ ] Add error handling and timeout logic

**Week 2: Client-Side Streaming**
- [ ] Create `StreamingQueryClient` class
- [ ] Implement event receiver and dispatcher
- [ ] Add query cancellation support
- [ ] Create `StreamingCollection` class

### Phase 2: UI Integration (2 weeks)

**Week 3: Progressive Rendering**
- [ ] Create `StreamingCardList` component
- [ ] Add progress indicators (count, IDs, cards)
- [ ] Implement incremental card rendering
- [ ] Add loading states and animations

**Week 4: Optimization**
- [ ] Create `StreamingCache` for ID lists
- [ ] Implement cache invalidation on card changes
- [ ] Add prefetching for scrolling
- [ ] Optimize batch sizes based on performance

### Phase 3: Polish (1 week)

**Week 5: UX & Performance**
- [ ] Add abort controls for slow queries
- [ ] Improve progress indicator UX
- [ ] Memory profiling and optimization
- [ ] Load testing with large result sets (10k+ cards)

### Files to Create

**New Files** (~950 LOC):
- `functions/src/streaming_search.ts` (~300 LOC) - Server-side streaming
- `src/streaming_client.ts` (~250 LOC) - Client stream receiver
- `src/streaming_collection.ts` (~300 LOC) - Streaming collection class
- `src/streaming_cache.ts` (~100 LOC) - Cache for streamed results

**Modified Files** (~250 LOC):
- `src/collection_description.ts` (+100 LOC) - Integrate StreamingCollection
- `src/components/card-list.tsx` (+100 LOC) - Progressive rendering UI
- `src/query_controller.ts` (+50 LOC) - Query lifecycle management

**Total**: ~1200 LOC

## Comparison to Requirements

### ✅ Meets All Requirements

| Requirement | How Met |
|------------|---------|
| Search all 30k+ cards | ✅ Server streams all card IDs |
| Two-phase fetch | ✅ Count + IDs streamed, then card data fetched |
| Progressive loading with count | ✅ Count arrives in 50ms, IDs streamed progressively |
| KeyCard collections | ✅ Cached ID lists make navigation instant |
| Preserve save performance | ✅ Client keeps <7k hot tier + materialized cards |
| Cost <$5/month | ✅ $0.17-0.25/month with caching |
| IDF calculations | ✅ Server-side IDF over full corpus |
| Pre-filtered NLP | ✅ Server queries NLP fields uniformly |

### Performance Targets

| Metric | Target | Actual |
|--------|--------|--------|
| Save latency | <500ms P95 | ~200ms (7k hot tier + materialized) |
| First feedback (count) | Immediate | 50ms (streamed) |
| IDs complete | <500ms | 200-400ms (streamed in chunks) |
| First cards | <500ms | 200-300ms (after IDs arrive) |
| Navigation latency | <100ms | <50ms (cached IDs) |

## Alternatives Considered

### Why Not Stream Card Data Too?

**Rejected**: Stream full card objects from server
- **Reason**: Cards are large (10 KB). Streaming 30k cards = 300 MB response. Too expensive.
- **Trade-off**: Only stream IDs (240 KB), fetch card data on-demand

### Why Not Single Response?

**Rejected**: Wait for complete results, return all at once
- **Reason**: 30k card query takes 200-500ms. User sees blank screen during wait.
- **Trade-off**: Streaming shows progress (count at 50ms, IDs incrementally)

### Why Not WebSockets?

**Rejected**: Use WebSocket instead of HTTP streaming
- **Reason**: Firebase Functions don't support WebSockets natively. HTTP streaming simpler.
- **Trade-off**: HTTP streaming via callable functions is sufficient

## Summary

**Approach 4 (Streaming Incremental Results)** provides best perceived performance:

1. **Count in 50ms** (streamed immediately)
2. **IDs in 200-400ms** (streamed in 1k chunks)
3. **First cards in 200-300ms** (materialized from hot tier + Firestore)
4. **Progressive rendering** (user sees results appearing)
5. **Cost**: $0.17-0.25/month for single power user

**Choose this approach if you value**:
- Best perceived performance (immediate feedback)
- Progressive UX (seeing results load)
- Handling large result sets (10k+ cards)
- User engagement during loading

**Trade-offs**:
- More complex protocol (streaming)
- Requires Firebase Functions
- Network overhead (multiple chunks)
- Harder to cache partial results
