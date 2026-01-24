# Firestore Enterprise Hybrid Architecture: Design Overview

> **Status**: Design Phase - 4 New Architectures (v2)
> **Created**: January 2026
> **Updated**: January 24, 2026
> **Purpose**: Document 4 architectural approaches for integrating Firestore Enterprise Pipeline Operations into card-web
>
> **Note**: This document describes v2 architectures that embrace the two-phase fetch pattern and handle 300-1,600 collections/day. See `archive/v1/` for original designs.

## Background

Card-web currently handles 30,000+ cards with client-side filtering, but faces limitations:
- Partial mode limits fetching to 5,000 most recent cards
- Users cannot search older cards (16.7% coverage)
- Want to search all 30k+ cards without loading them all client-side (would cause save lag)

Firestore Enterprise (now GA, January 2026) provides Pipeline Operations with server-side query capabilities. These designs leverage the two-phase fetch pattern discovered through extensive analysis.

## Key Architectural Insights

### Two-Phase Fetch Pattern (Fundamental)

All approaches embrace this pattern:

1. **Phase 1 (Server)**: Query returns count + card ID list
   - Lightweight (count + 30k IDs ≈ 240 KB, ~60 Firestore reads with covered queries)
   - Can be cached aggressively (card ID lists change infrequently)
   - Critical for UX: "Showing 1-50 of 30,000 results"

2. **Phase 2 (Client)**: Fetch card data in batches as needed
   - Initial batch: Visible cards (e.g., 50 cards)
   - Progressive batches: As user scrolls/navigates
   - Cost proportional to cards VIEWED (~50-200), not cards MATCHED (~30,000)

### Pre-Filtered NLP Storage

All approaches assume NLP data is stored pre-filtered per card type:
- Store only searchable fields in `nlp` object (configured by TEXT_FIELD_CONFIGURATION)
- Server queries all NLP fields uniformly without card-type awareness
- 20-40% storage savings, dramatically simpler server queries

### KeyCard Predictability

Navigation collections (300-1,600/day) benefit from:
- KeyCards are almost always in current collection
- Sequential navigation (keyboard) or visible on screen (scroll)
- Enables aggressive prefetching (70-90% cache hit rates)

### Cost Model

Two-phase + batching makes costs inherently reasonable:
- Cost proportional to cards viewed, not cards matched
- Single power user: $0.15-0.30/month (realistic target)
- 1000 users: $3-5/month (well under $5 limit)

## Research Documents

Before reviewing designs, see:

1. **[Requirements](../requirements.md)** - Comprehensive requirements with two-phase pattern, KeyCard navigation, pre-filtered NLP
2. **[Firestore Enterprise Capabilities](../research/firestore-enterprise-capabilities.md)** - What Pipeline Operations provide
3. **[Original v1 Designs](archive/v1/README.md)** - Archived original approaches (failed arbitrary collections test)

## Design Approaches (v2)

### Comparison Matrix

| Aspect | Approach 1: Server-First | Approach 2: Intelligent Hot Tier | Approach 3: Lazy Materialized | Approach 4: Streaming |
|--------|--------------------------|----------------------------------|------------------------------|----------------------|
| **Philosophy** | Server authoritative, client renders | Optimize for common case (hot tier) | Collections are ID lists until viewed | Stream results progressively |
| **Query Pattern** | Always query server (cached) | Try hot tier first, server fallback | Phase 1 cached aggressively, Phase 2 on-demand | Server streams count → IDs → data |
| **First Feedback** | <50ms (cached), 200-500ms (uncached) | <50ms (95% hot tier hit) | <50ms (cached ID list) | 50ms (count streamed) |
| **Complete Results** | 200-500ms | <50ms (hot tier) or 200-500ms (server) | 200-300ms (materialize visible) | 200-400ms (IDs + cards) |
| **Cache Hit Rate** | 90-95% (ID lists) | 85-95% (hot tier coverage) | 95-98% (ID lists, longer TTL) | 80-95% (ID lists) |
| **Memory Usage** | ~110 MB (7k hot tier + cache) | ~80-100 MB (adaptive 8-9k hot tier) | ~80 MB (minimal materialization) | ~90 MB (7k hot tier + materialized) |
| **Monthly Cost (Single User)** | $0.20/month | $0.12-0.29/month | $0.15-0.20/month | $0.17-0.25/month |
| **Implementation LOC** | ~1200 LOC | ~1250 LOC | ~1150 LOC | ~1200 LOC |
| **Timeline** | 5 weeks | 5 weeks | 5 weeks | 5 weeks |
| **Complexity** | Medium | High | Medium-High | High |
| **Best For** | Simplicity, scalability | Best-case latency | Cost efficiency | Perceived performance |

### Detailed Designs

📄 **[Approach 1: Server-First Query Engine](approach-1-server-first-query-engine.md)**
- **Strategy**: Every collection queries server for count + IDs (Phase 1), aggressively cached
- **Client Role**: Manages progressive card data fetching (Phase 2) and rendering
- **Cache Strategy**: 90-95% hit rate for card ID lists (15-minute TTL)
- **Cost**: $0.20/month single user, $3.33/month 1000 users
- **Best for**: Simplicity, predictable latency, long-term scalability
- **Key Insight**: Simple is better - one clear pattern for all collections

📄 **[Approach 2: Intelligent Hot Tier with Progressive Expansion](approach-2-intelligent-hot-tier.md)**
- **Strategy**: Optimistic local-first, query server only when hot tier insufficient
- **Adaptive**: Hot tier grows to 8-10k cards based on usage patterns (learns from access patterns)
- **Cache Strategy**: 85-95% queries answered from hot tier, minimal server queries
- **Cost**: $0.12-0.29/month depending on hit rate
- **Best for**: Best-case latency (<50ms for 95% of queries), offline-first
- **Key Insight**: Most queries access recent/popular cards - keep the right cards locally

📄 **[Approach 3: Lazy Materialized Collections](approach-3-lazy-materialized-collections.md)**
- **Strategy**: Collections are lightweight card ID lists until rendered
- **Separation of Concerns**: "What matches" (filtering) vs "Show me the data" (materialization)
- **Cache Strategy**: 95-98% hit rate for ID lists (1-4 hour TTL based on collection type)
- **Cost**: $0.15-0.20/month (lowest due to aggressive ID list caching)
- **Best for**: Extreme cost efficiency, memory efficiency, thousands of collections
- **Key Insight**: Same collection definition repeats thousands of times, but ID list rarely changes

📄 **[Approach 4: Streaming Incremental Results](approach-4-streaming-incremental-results.md)**
- **Strategy**: Server streams count → card IDs (chunked) → client fetches card data
- **Progressive**: User sees count in 50ms, IDs in 200-400ms, first cards in 200-300ms
- **Cache Strategy**: 80-95% hit rate for ID lists (shorter TTL due to streaming overhead)
- **Cost**: $0.17-0.25/month
- **Best for**: Best perceived performance, large result sets, progressive UX
- **Key Insight**: Users prefer seeing partial results immediately rather than waiting for complete results

## Detailed Comparison

### Performance Characteristics

| Metric | Approach 1 | Approach 2 | Approach 3 | Approach 4 |
|--------|------------|------------|------------|------------|
| **Save Latency** | ~200ms (7k cards) | ~250ms (8-9k cards) | ~200ms (7k hot + 1k materialized) | ~200ms (7k hot + materialized) |
| **Count Query** | <50ms (cached) | <50ms (hot tier) | <50ms (cached ID list) | 50ms (streamed) |
| **First Card Batch** | 200-500ms | <50ms (hot tier) | 200-300ms | 200-300ms |
| **Navigation** | <50ms (prefetch) | <50ms (hot tier 95%) | <50ms (cached IDs + materialized) | <50ms (cached IDs) |
| **Cache Hit Rate** | 90-95% | 85-95% | 95-98% | 80-95% |

### Cost Analysis

**Single Power User** (10 searches/day, 500 navigation collections/day):

| Approach | Phase 1 (Server Queries) | Phase 2 (Card Data) | Total/Month |
|----------|-------------------------|---------------------|-------------|
| **1: Server-First** | $0.028 (25.5 queries/day) | $0.138 (7,650 fetches/day) | **$0.17** |
| **2: Hot Tier** | $0.028 (5% miss rate) | $0.092 (expansion batches) | **$0.12** |
| **3: Lazy Materialized** | $0.011 (2% miss rate) | $0.138 (visible cards) | **$0.15** |
| **4: Streaming** | $0.028 (20% miss rate) | $0.138 (visible cards) | **$0.17** |

*Note: Phase 2 costs similar across approaches (all fetch ~50-200 cards per collection viewed)*

### Implementation Complexity

| Aspect | Approach 1 | Approach 2 | Approach 3 | Approach 4 |
|--------|------------|------------|------------|------------|
| **New Modules** | 5 files | 4 files | 4 files | 4 files |
| **Modified Files** | 3 files | 3 files | 3 files | 3 files |
| **Total LOC** | ~1200 | ~1250 | ~1150 | ~1200 |
| **Timeline** | 5 weeks | 5 weeks | 5 weeks | 5 weeks |
| **Testing Complexity** | Medium | High (adaptive logic) | Medium-High (two layers) | High (streaming) |
| **Debugging** | Easy (clear pattern) | Medium (adaptive behavior) | Hard (two-tier indirection) | Medium (stream events) |

### Memory Footprint

| Component | Approach 1 | Approach 2 | Approach 3 | Approach 4 |
|-----------|------------|------------|------------|------------|
| **Hot Tier** | 70 MB (7k cards) | 80-100 MB (8-10k adaptive) | 70 MB (7k cards) | 70 MB (7k cards) |
| **ID List Cache** | 20-40 MB (100 collections) | N/A (uses hot tier) | 20-40 MB (aggressive caching) | 10-20 MB (shorter TTL) |
| **Materialized Cards** | 2-5 MB (visible) | N/A (in hot tier) | 1-2 MB (minimal) | 2-5 MB (visible) |
| **Total** | **~110 MB** | **~80-100 MB** | **~80 MB** | **~90 MB** |

## Recommendation

### Primary Recommendation: **Approach 3 (Lazy Materialized Collections)**

**Rationale:**

1. **Lowest cost**: $0.15/month single user (95-98% cache hit rate for ID lists)
2. **Memory efficient**: ~80 MB total (minimal materialization until needed)
3. **Scalable**: Handles thousands of collections naturally
4. **Clear separation**: Filtering (Phase 1) vs rendering (Phase 2) are distinct concerns
5. **Predictable**: Consistent latency with aggressive caching

**When to choose**:
- Cost is a priority (lowest server query costs)
- Memory is constrained (smallest footprint)
- Collection churn is high (thousands of instantiations/day)
- Cards change infrequently (good cache hit rates)

### Alternative: **Approach 2 (Intelligent Hot Tier)** for Best Latency

**If best-case latency is priority:**
- 95% of queries are <50ms (from hot tier)
- Adapts to usage patterns (learns frequently accessed cards)
- Best offline degradation (hot tier always works)
- Cost: $0.12/month (minimal server queries after warmup)

**Trade-off**: More complex (adaptive logic), variable memory (8-10k cards)

### Alternative: **Approach 1 (Server-First)** for Simplicity

**If simplicity and maintainability are priority:**
- Simplest mental model (server filters, client renders)
- Predictable behavior (no adaptive complexity)
- Easy to debug and reason about
- Cost: $0.20/month (slightly higher than Approach 3)

**Trade-off**: Slightly higher cost, cold start latency

### Alternative: **Approach 4 (Streaming)** for Large Result Sets

**If handling very large result sets (10k+ cards):**
- Best perceived performance (immediate count, progressive IDs)
- User sees progress throughout
- Natural for large queries
- Cost: $0.17-0.25/month

**Trade-off**: More complex protocol (streaming), requires Firebase Functions

## Common Elements Across All Approaches

### 1. Two-Phase Fetch Pattern

All approaches use the same fundamental pattern:

```typescript
// Phase 1: Get count + card ID list from server
const { count, ids } = await serverQueryEngine.execute({
  filters: filterChain,
  userId: currentUserId(),
  returnCount: true,
  fieldsOnly: ['id']
});

// Phase 2: Fetch card data for visible cards
const visibleIds = ids.slice(0, 50);
const cards = await fetchCardData(visibleIds);
```

### 2. Hot Tier for Real-Time Updates

All approaches maintain a hot tier (5-10k recent cards) with `onSnapshot()`:

```typescript
// Real-time sync for recent cards (UNCHANGED from current system)
onSnapshot(
  query(
    collection(db, 'cards'),
    where('published', '==', true),
    orderBy('updated', 'desc'),
    limit(5000)
  ),
  cardSnapshotReceiver('published')
);
```

### 3. Pre-Filtered NLP Storage

All approaches assume NLP data is stored pre-filtered:

```typescript
// Only searchable fields per card type
nlp?: {
  body?: [ProcessedRun, ...],  // Only if body is searchable
  title?: [ProcessedRun, ...],  // Only if title is searchable
  // Fields omitted if not searchable for this card type
}
```

### 4. Server-Side IDF Calculation

All approaches use server-side IDF over full 30k corpus:

```typescript
// Calculate IDF from all cards (not just hot tier)
const idfMap = await calculateIDF();  // Queries all 30k cards for NLP data
```

### 5. KeyCard Prefetching

All approaches leverage KeyCard predictability:

```typescript
// Prefetch window around current keycard
const index = ids.indexOf(currentKeyCard);
const windowIds = ids.slice(index - 50, index + 51);
await fetchCardData(windowIds);  // Prefetch before navigation
```

## Implementation Patterns

### Collection Lifecycle

```typescript
// 1. User creates collection (e.g., search query)
const collection = new Collection(filterChain, userId);

// 2. Get count (Phase 1 - fast)
const count = await collection.getCount();  // From cache or server
// UI shows: "30,000 results"

// 3. Materialize visible cards (Phase 2 - lazy)
const cards = await collection.getCards(0, 50);  // First batch
// UI renders: 50 cards

// 4. User scrolls - fetch more
const moreCards = await collection.getCards(50, 50);  // Next batch

// 5. User navigates to KeyCard - already prefetched
const keyCardPosition = await collection.indexOf(newKeyCard);
// Cards around keyCardPosition already loaded
```

### Cache Invalidation

```typescript
// When card changes (saved by user)
const changedCardIds = ['card-123'];

// Invalidate affected collections
await collectionCache.invalidateAffected(changedCardIds);

// Hot tier updates automatically via onSnapshot()
// (Real-time sync still works)
```

## Migration Path

All approaches follow similar migration:

### Phase 1: Foundation (2 weeks)
- [ ] Implement server query engine (Pipeline operations)
- [ ] Create caching infrastructure (IndexedDB)
- [ ] Add NLP pre-filtering to card saves
- [ ] Backfill NLP data for existing cards

### Phase 2: Integration (2 weeks)
- [ ] Modify Collection class for two-phase fetch
- [ ] Implement progressive card data loading
- [ ] Add prefetching for KeyCard navigation
- [ ] Update UI for progress indicators

### Phase 3: Optimization (1 week)
- [ ] Tune cache TTLs based on usage patterns
- [ ] Add telemetry for cache hit rates
- [ ] Optimize batch sizes
- [ ] Load testing and cost validation

### Feature Flag Rollout

```
Week 1-2: Backend infrastructure (invisible to users)
Week 3: 10% of queries use new system
Week 4: 50% of queries
Week 5: 100% rollout
```

## Success Metrics

### Functionality
- ✅ Search coverage: 100% of 30k cards (up from 16.7%)
- ✅ Real-time sync: Maintained for hot tier
- ✅ Progressive loading: Count immediate, cards in batches
- ✅ IDF calculations: Based on all 30k cards (not just 5k)

### Performance
- ✅ Save latency: <200ms P50, <500ms P95 (no regression from current partial mode)
- ✅ Count query: <100ms P95
- ✅ First card batch: <500ms P95
- ✅ Navigation: <100ms P95

### Cost
- ✅ Single user: <$1/month (realistic: $0.15-0.30/month)
- ✅ 1000 users: <$5/month (realistic: $3-4/month)
- ✅ Per explicit search: <$0.001
- ✅ Per navigation collection: <$0.0001

### Cache Efficiency
- ✅ ID list cache hit rate: >90%
- ✅ Hot tier hit rate: >70%
- ✅ Server query frequency: <100/day single user

## Open Questions

1. **Cache TTL tuning**: What's the optimal TTL for different collection types?
   - Text queries: 15 minutes? (exploratory)
   - Navigation collections: 1-4 hours? (stable)
   - Need real-world usage data to optimize

2. **Hot tier size**: Can we safely increase to 10k with pre-computed NLP?
   - Save latency testing needed
   - Memory profiling on different devices

3. **Prefetch aggressiveness**: How many cards to prefetch?
   - Current estimate: 50-100 card window
   - Trade-off: Memory vs latency hiding

4. **Server timeout handling**: What's the fallback for 60-second timeouts?
   - Partial results? Error message? Client-side processing?

## Validation Experiments

Before final decision:

1. **Cost Test**: Run sample queries, measure actual read counts and costs
2. **Latency Test**: Measure Pipeline query performance on 30k cards
3. **Cache Test**: Validate cache hit rate assumptions with usage logs
4. **Memory Test**: Profile memory usage with 7k, 8k, 10k hot tier sizes
5. **UX Test**: Show progressive loading to users, gather feedback

---

**Last Updated**: January 24, 2026
**Status**: Awaiting decision between Approaches 3, 2, or 1
**Authors**: Claude (design), jkomoros (requirements)
**Previous Versions**: See `archive/v1/` for original 4 approaches
