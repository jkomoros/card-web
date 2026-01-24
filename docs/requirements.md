# Firestore Enterprise Hybrid Architecture: Requirements Document

> **Status**: Formalized Requirements
> **Date**: January 2026
> **Purpose**: Comprehensive requirements specification for integrating Firestore Enterprise Pipeline Operations into card-web
> **Related**: See `docs/design/README.md` for architectural approaches

## Executive Summary

### What Problem Are We Solving?

Users need to **search across ALL 30,000+ cards** while maintaining excellent application performance. Currently, partial mode limits searches to only the most recent 5,000 cards (16.7% coverage), preventing users from finding historical cards and conducting comprehensive analysis.

### What Are We NOT Solving? (Critical Clarification)

**SAVE PERFORMANCE IS NOT THE PROBLEM.**

- Save lag (9+ seconds) ONLY occurs when 5k-10k+ cards are loaded client-side
- **Partial mode (5k cards) has EXCELLENT save performance** (~100-300ms)
- The current system maintains excellent save performance by limiting to 5k cards
- We are NOT trying to make saves faster
- We ARE trying to avoid making saves slower

**The Real Problem**: Users want comprehensive search (30k cards) WITHOUT loading all cards client-side (which would cause save lag). Any solution MUST keep client-side card count below 5-10k to preserve excellent save performance.

## Key Requirements

### 1. Search All Cards
- Must search ALL 30,000+ cards (not just recent 5,000)
- Must NOT load all 30k client-side (would cause save lag)

### 2. Progressive Loading (Extended)
- Show partial local results immediately (<100ms)
- Show full results soon after (<2000ms)
- Apply to explicit searches (query dialog)
- NOT required for KeyCard navigation (must be instant)

### 3. KeyCard-Based Collections (Critical)
- Similar cards sidebar updates on every navigation
- Reference blocks (8 per card) update instantly
- 300-1,600 collection instantiations per day
- Must be <100ms latency (client-side filtering only)
- Must NOT query server (cost prohibitive)

### 4. Preserve Save Performance (CRITICAL)
- Current: ~100-300ms (partial mode with 5k cards)
- Target: NO regression
- Maximum: <500ms P95
- Client state: <5-10k cards

### 5. Cost Constraints
- Explicit searches: $1-5/month acceptable
- Navigation collections: Must be near-zero ($0)
- Total budget: <$50/month single user

## Critical Insights from Critiques

### Collections Are Not Uniform

| Collection Type | Frequency | Cost Tolerance | Strategy |
|----------------|-----------|----------------|----------|
| **Explicit searches** | 10-20/day | High ($0.01) | Server query ✓ |
| **KeyCard navigation** | 300-1,600/day | Very low ($0) | Client-only ✓ |

**Any approach treating all collections uniformly will either:**
1. Under-serve explicit searches (incomplete results), OR
2. Over-serve navigation (cost explosion $145k/month)

### The Cost Difference

```
Explicit searches (10/day):  $0.60/month ✓ ACCEPTABLE
Navigation (1000/day):       $60/month  ✗ CATASTROPHIC (if server-queried)

Ratio: 100:1 frequency, but 1:10 value
```

### Required: Smart Delegation

Must differentiate collection types:
- Whitelist explicit searches for server queries
- Blacklist KeyCard navigation for client-only
- Selective triggering based on collection characteristics

### KeyCard Prefetching Opportunity

**Critical constraint discovered**: KeyCards are almost always cards in the current collection.

**Impact on designs:**
- **Without prefetching**: 30k possible KeyCards → ~0% cache hit rate → cost explosion
- **With prefetching**: 5-20 visible cards → 70-90% cache hit rate → cost manageable

**Prefetching strategy:**
1. When collection loads, identify visible cards (5-20 cards)
2. Background prefetch server results for each visible KeyCard variant
3. User navigates to visible card → Cache hit → Instant result
4. As user scrolls, prefetch new visible cards

**Cost with prefetching:**
- Explicit search: 1 query per search = 10-20 queries/day
- Navigation with prefetch: 1 query per visible card = 100-400 queries/day (on collection change)
- Total: ~110-420 queries/day vs 1,300-3,200 without prefetch (3-8× reduction)

**Trade-offs:**
- ✅ Makes server queries viable for navigation (70-90% cache hit)
- ✅ Reduces cost 3-8× compared to naive query-on-demand
- ⚠️ Still 10× more expensive than client-only filtering
- ⚠️ Prefetch must be background (not block collection load)
- ⚠️ Wasted prefetches if user doesn't navigate to all visible cards

## Success Criteria

### Functionality
- ✅ Search coverage: 100% of 30k cards
- ✅ Real-time sync: Maintained for 5k recent cards
- ✅ Progressive loading: Works for explicit searches

### Performance
- ✅ Save latency: <200ms P50, <500ms P95 (no regression)
- ✅ Query latency: <100ms preview, <500ms complete
- ✅ Navigation: <100ms sidebar update

### Cost
- ✅ Monthly: <$5 for single user
- ✅ Per explicit search: <$0.01
- ✅ Per navigation: <$0.001 (ideally $0)

## Design Constraints

### 1. Cannot Use Same Strategy for All Collections
- Explicit searches justify server queries (comprehensive results worth cost)
- KeyCard navigation requires client-only (cost prohibitive otherwise)

### 2. Progressive Loading is REQUIRED
- Must show partial results immediately
- Server-first (blocks until complete) violates requirement
- Dual-track pattern (preview → complete) is ideal

### 3. KeyCard Navigation is Highly Predictable
- **KeyCards are almost always cards already in the current collection**
- Navigation is typically sequential (keyboard next/prev card)
- When scrolling, the next KeyCard must be visible on screen
- This means: 5-20 candidate KeyCards vs 30,000 theoretical possibilities
- **Prefetching becomes viable**: Can prefetch server results for visible cards
- **Cache hit rate could be high** (70-90%) with aggressive prefetching
- **Important**: Naive caching (no prefetch) still has ~0% hit rate (30k unique KeyCards)

### 4. Cost Controls are MANDATORY
- Per-user quotas (max queries per day)
- Rate limiting (max concurrent queries)
- Circuit breakers (disable if budget exceeded)
- Collection type whitelisting

## Usage Patterns

### Explicit Search (High-Value, Infrequent)
```
Frequency: 10-20 per day
User types query → Expects comprehensive results → Willing to wait 500ms
Cost tolerance: $0.01-0.10 per query
Cacheable: Yes (same query repeated)
```

### Navigation (Low-Value, Frequent)
```
Frequency: 300-1,600 collections per day
User clicks card → Sidebar updates → Must be instant (<100ms)
Cost tolerance: Near-zero
Cacheable: Yes WITH prefetching (KeyCards are in current collection, typically sequential)
Cacheable: No WITHOUT prefetching (each KeyCard unique among 30k possibilities)

Navigation pattern:
- Keyboard navigation: Sequential (next/prev card in collection)
- Scroll navigation: KeyCard must be visible on screen
- Prefetch opportunity: 5-20 visible cards in current collection
```

---

**For complete requirements including:**
- User personas and usage patterns
- Detailed functional/performance/cost requirements
- Technical constraints (Firestore Enterprise, filter translation)
- Success metrics and non-requirements
- Critical usage patterns from critiques

**See full document in agent output: ad6b1c5**

---

## Critical Files

- `/Users/jkomoros/Code/card-web/src/actions/database.ts` - Firestore queries, must preserve real-time sync
- `/Users/jkomoros/Code/card-web/src/collection_description.ts` - Collection class (~900 LOC), integration point
- `/Users/jkomoros/Code/card-web/src/filters.ts` - Filter definitions, translation to Pipeline operations
- `/Users/jkomoros/Code/card-web/src/nlp.ts` - PreparedQuery (client-only, cannot replicate server-side)