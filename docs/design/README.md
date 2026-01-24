# Firestore Enterprise Hybrid Architecture: Design Overview

> **Status**: Planning Phase
> **Created**: January 2026
> **Purpose**: Document 4 architectural approaches for integrating Firestore Enterprise Pipeline Operations into card-web

## Background

Card-web currently handles 30,000+ cards with client-side filtering, but faces limitations:
- Partial mode limits fetching to 5,000 most recent cards
- Users cannot search older cards
- Client-side processing becomes slow at scale

Firestore Enterprise (now GA) provides Pipeline Operations with server-side query capabilities. This directory contains detailed design documents for 4 different integration approaches.

## Research Documents

Before reviewing designs, see:

1. **[Current Architecture](../architecture/current-card-system.md)** - How card fetching and filtering works today
2. **[Firestore Enterprise Capabilities](../research/firestore-enterprise-capabilities.md)** - What Pipeline Operations provide

## Design Approaches

### Comparison Matrix

| Aspect | Approach 1: Smart Delegation | Approach 2: Hot/Cold Tier | Approach 3: Server-First | Approach 4: Dual-Track |
|--------|------------------------------|---------------------------|-------------------------|------------------------|
| **Philosophy** | Automatic filter routing | Two-tier progressive loading | Server by default | Parallel execution |
| **First Result Latency** | 50-500ms | 50ms (hot tier) | 200-500ms or <5ms (cached) | 50ms (preview) |
| **Searches All Cards** | ✅ Always | ✅ When triggered | ✅ Always | ✅ Always |
| **Real-time Updates** | ✅ Hot cards | ✅ Hot tier only | ✅ Parallel channel | ✅ Client track |
| **Est. Monthly Cost** | ~$270 | ~$500 | ~$27-270 | ~$11/year |
| **Implementation** | 1000 LOC, 9 weeks | 1750 LOC, 6 weeks | 1410 LOC, 9 weeks | 645 LOC, 5 weeks |
| **Complexity** | High | High | Very High | Medium |
| **Graceful Degradation** | Excellent | Good | Moderate | Excellent |
| **Cache Hit Rate** | 50-70% | 70-90% | 90-95% | 70%+ |

### Detailed Designs

📄 **[Approach 1: Smart Filter Delegation](approach-1-smart-delegation.md)**
- Automatically analyzes filter chains
- Routes some filters to server, some to client
- Intelligent result merging
- **Best for**: Power users, complex filter combinations

📄 **[Approach 2: Progressive Hybrid Loading](approach-2-progressive-loading.md)**
- Hot tier: Recent 5k cards (instant, real-time)
- Cold tier: Older cards (on-demand from server)
- Triggers: Empty results, old dates, missing cards
- **Best for**: Common case optimization (95%+ queries are recent)

📄 **[Approach 3: Server-First with Fallback](approach-3-server-first.md)**
- Translate entire filter chain to Pipeline operations
- Execute server-side by default
- Aggressive caching (keyed on global `cardsVersion`)
- **Best for**: Large stable corpus, read-heavy workload

📄 **[Approach 4: Parallel Dual-Track Execution](approach-4-dual-track.md)** ⭐ RECOMMENDED
- Execute both client AND server simultaneously
- Show client results immediately (50ms preview)
- Merge server results when ready (500ms complete)
- **Best for**: Best perceived performance, lowest cost

## Recommendation

### Primary Recommendation: Approach 4 (Dual-Track)

**Rationale:**
1. **Fastest time-to-value**: 5-week rollout vs 6-9 weeks for others
2. **Lowest cost**: ~$11/year with caching vs $27-500/month
3. **Best UX**: Instant preview (50ms) + progressive enhancement
4. **Lowest implementation risk**: 645 LOC, reuses existing patterns
5. **Graceful degradation**: Client track always works

**Phased Evolution:**
- **Phase 1**: Implement Approach 4 (Dual-Track)
- **Phase 2**: Add aggressive caching from Approach 3
- **Phase 3**: Optimize with smart delegation hints from Approach 1

### Alternative: Approach 3 (Server-First)

**If cache hit rate can reach 95%:**
- Sub-5ms response time for common queries
- Simplest mental model (server does everything)
- Best long-term scalability

**Risk:** 200-500ms cold start may feel slow

## Key Design Decisions

### 1. Real-Time Sync Strategy

**All approaches keep existing `onSnapshot()` for recent cards:**
```typescript
// Continue using (unchanged)
onSnapshot(
  query(collection(db, "cards"), where("published", "==", true)),
  cardSnapshotReceiver("published")
);

// Pipeline operations supplement (no real-time)
const results = await db.pipeline()
  .collection("cards")
  .where(/* complex filters */)
  .execute();
```

**Rationale**: Pipeline operations don't support `onSnapshot()`, so hybrid is required

### 2. Caching Strategy

**Consensus across approaches:**
- Cache server query results
- Invalidate on card changes
- 5-minute TTL minimum
- Use existing memoization infrastructure

**Differences:**
- Approach 1: Moderate caching (50-70% hit rate)
- Approach 2: Per-trigger caching (70-90% hit rate)
- Approach 3: Aggressive with `cardsVersion` (90-95% hit rate)
- Approach 4: Result caching (70%+ hit rate)

### 3. Filter Translation

**Translatable to Pipeline:**
- Text search (`query`) → `str_contains` or `regex_match`
- Date filters → Timestamp comparisons
- Section/tag filters → Field equality
- Author filters → UID matching

**Client-only (cannot translate):**
- Reference filters (BFS graph traversal)
- Similarity (requires embeddings)
- Combine/expand (complex composition)
- Custom NLP scoring

### 4. Fallback Strategy

**All approaches provide fallback:**
- Server timeout (60s) → Client execution
- Server error → Client execution
- Unsupported filter → Client refinement
- Feature flag → Disable server entirely

## Implementation Patterns

### Preview Flag Pattern (from existing similarity filter)

```typescript
// Filter returns preview=true while fetching
const func = (card, extras) => {
  const serverData = extras.serverResults[card.id];

  if (!serverData) {
    // Trigger async fetch
    fetchFromServer(card.id);
    return { matches: false, preview: true };
  }

  return { matches: serverData.matches, preview: false };
};
```

**UI Integration** (already exists):
```typescript
if (collection.preview) {
  // Show loading indicator, gray out cards
}
```

### Async Fetch Pattern (from existing similarity)

```typescript
// src/actions/similarity.ts pattern
const fetchServerData = (query) => async (dispatch) => {
  const callable = httpsCallable(functions, 'pipelineSearch');
  const result = await callable({ query });

  dispatch({
    type: PIPELINE_RESULTS_RECEIVED,
    results: result.data.cards
  });
};
```

## Cost Analysis

### Query Volume Estimates

**Assumptions for 1000 active users:**
- 5 queries per user per day
- 30-day month
- Various cache hit rates

| Cache Hit Rate | Queries/Month | Reads (30k cards/query) | Cost |
|----------------|---------------|------------------------|------|
| 0% (no cache) | 150,000 | 4.5 billion | $270/month |
| 50% | 75,000 | 2.25 billion | $135/month |
| 70% | 45,000 | 1.35 billion | $81/month |
| 90% | 15,000 | 450 million | $27/month |
| 95% | 7,500 | 225 million | $13.50/month |
| 99% | 1,500 | 45 million | $2.70/month |

**Approach-Specific Estimates:**
- **Approach 1**: 50-70% hit rate = ~$81-135/month
- **Approach 2**: 70-90% hit rate = ~$27-81/month
- **Approach 3**: 90-95% hit rate = ~$13.50-27/month
- **Approach 4**: 70%+ hit rate + minimal queries = ~$1-20/month ($11/year typical)

### Cost Optimization Strategies

1. **Aggressive Caching**
   - 5-15 minute TTL
   - Version-based invalidation
   - IndexedDB persistence

2. **Query Debouncing**
   - 300ms delay on filter changes
   - Cancel pending queries
   - Batch rapid changes

3. **Selective Server Use**
   - Only query server when client can't fulfill
   - Skip server for queries with all recent cards
   - Use complexity heuristics

4. **Field Selection**
   - `select(['id', 'title'])` instead of full documents
   - Reduces 10 KiB → 0.5 KiB per card
   - 20× cost reduction

## Next Steps

### Immediate Actions

1. **Review** all 4 approach documents
2. **Decide** on primary approach (recommend: Approach 4)
3. **Prototype** basic Pipeline query integration
4. **Test** cost estimates with real queries
5. **Plan** phased rollout

### Open Questions

1. **Cost tolerance**: $11/year vs $27-270/month acceptable?
2. **Latency tolerance**: 200-500ms cold start acceptable?
3. **Preview UX**: Comfortable with grayed/loading states?
4. **Migration timeline**: 5 weeks (Approach 4) vs 9 weeks (Approach 1/3)?
5. **Real-time priority**: All cards or recent cards only?

### Validation Experiments

Before committing to an approach:

1. **Cost Test**: Run sample queries, measure actual read counts
2. **Latency Test**: Measure Pipeline query performance on 30k cards
3. **Cache Test**: Validate cache hit rate assumptions with usage logs
4. **UX Test**: Show preview states to users, gather feedback

## Appendix

### Technologies

- **Firestore Enterprise Edition**: GA as of January 2026
- **Pipeline Operations**: Server-side query engine
- **Firebase Functions**: For Cloud Functions integration (Approach 2)
- **IndexedDB**: For persistent client-side caching
- **Reselect**: Existing memoization library

### Constraints

- **No real-time sync**: Pipeline operations are pull-only
- **60-second timeout**: Complex queries must complete within limit
- **128 MiB memory limit**: Materialized result set cannot exceed
- **Firestore pricing**: Unit-based (4 KiB reads, 1 KiB writes)

### Success Metrics

- **Search coverage**: 100% of 30k+ cards searchable (up from 5k)
- **Query latency**: P95 <500ms cold, <50ms cached
- **Cost**: <$50/month for 1000 active users
- **Cache hit rate**: >70%
- **Real-time sync**: Maintained for recent 5k cards
- **User satisfaction**: No complaints about search limitations

---

**Last Updated**: January 24, 2026
**Authors**: Claude (design), jkomoros (requirements)
**Status**: Awaiting decision and iteration
