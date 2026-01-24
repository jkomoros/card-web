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

**The Solution Architecture**:
1. **Two-phase fetch**: Count + card IDs (server), then batched card data (progressive)
2. **Hot tier + dynamic paging**: Keep recent cards local, page in/out as user navigates
3. **Aggressive prefetching**: Next batch loaded before user reaches it (hide latency)
4. **Pre-computed NLP**: Store stemmed tokens in Firestore (fewer cards + no CPU = net win)
5. **Cost model**: Proportional to cards VIEWED (~50-200), not cards MATCHED (~30,000)
6. **IDF calculations**: Compute over representative sample (ideally all 30k cards) for word clouds and auto-titles

**Key insights**:
- Firestore doesn't support field selection (always fetch full document), so storing NLP tokens adds storage cost but no query cost. With fewer cards downloaded, this is now a clear win.
- Server-side saves exist (tweet engagement updates) but ONLY modify engagement metrics, never content fields, so NLP tokens remain valid without server-side computation.

## Key Requirements

### 1. Search All Cards (Two-Phase Fetch Pattern)
- Must search ALL 30,000+ cards (not just recent 5,000)
- Must NOT load all 30k card objects client-side (would cause save lag)

**Two-phase fetch pattern:**
1. **Phase 1 - Count + Card IDs (Server)**: Server executes filter and returns:
   - **Total count** of matching cards (CRITICAL for UX: "Showing 1-50 of 30,000")
   - List of matching card IDs (can be batched)
   - Includes permission filtering (only cards user can access)
   - Lightweight response (count + 30k card IDs ≈ 240KB, ~60 Firestore reads)
2. **Phase 2 - Card Data Batches (Progressive)**: Client fetches full card data in batches
   - Initial batch: Visible cards (e.g., 50 cards)
   - Progressive batches: Fetch more as user navigates/scrolls
   - Prefetch next batch before reaching boundary
   - Never load all 30k card objects simultaneously

**Count is more important than immediate card data:**
- User needs to see "30,000 results" immediately
- Card data can be fetched progressively as needed
- Prefetching prevents perceived latency at batch boundaries

**Why this pattern:**
- Server enforces permissions (user only sees accessible cards)
- Cost efficient (fetch only cards user views, not all matching cards)
- Enables KeyCard navigation (prefetch nearby card data)
- Leverages existing card-list pagination for rendering performance

**Overall architecture philosophy:**
- **Hot tier**: Keep recent cards loaded locally (fast, real-time sync)
- **Dynamic paging**: Page cards in/out as user navigates
- **Aggressive prefetching**: Fetch next chunk before user reaches it (hide latency)
- **Search latency**: Main latency is on search, but progressive loading makes it feel fast
- **Performance win**: Pre-computed NLP + fewer cards = might support larger hot tier

### 2. Progressive Loading with Count (Extended)
- **COUNT is critical**: Show total number of matching cards immediately
  - "Showing 1-50 of 30,000 results"
  - Enables progress indicators and navigation
  - More important than immediate full card data
- Show partial local results immediately (<100ms)
- Show full results in batches as user navigates (<2000ms per batch)
- Prefetch next batch before reaching boundary
- Apply to explicit searches (query dialog)
- Apply to large collections with batching

### 3. KeyCard-Based Collections (Critical)
- Similar cards sidebar updates on every navigation
- Reference blocks (8 per card) update instantly
- 300-1,600 collection instantiations per day
- Must be <100ms latency for KeyCard navigation

**Two-phase pattern makes server queries viable:**
- Phase 1 (card ID list): One-time cost when collection definition changes
- Phase 2 (card data): Progressive fetch for visible cards
- KeyCard navigation: Data already loaded for nearby cards
- Cost: ~$0.000039 per collection (450× cheaper than naive approach)

### 4. Preserve Save Performance (CRITICAL)
- Current: ~100-300ms (partial mode with 5k cards)
- Target: NO regression
- Maximum: <500ms P95
- Client state: Keep below 5-10k cards to maintain performance

**With pre-computed NLP, might support larger hot tier:**
- Current: 5k cards with client-side NLP processing
- Potential: 7-10k cards with pre-computed NLP (no CPU cost)
- Save performance depends on card count, not NLP processing
- Pre-computed NLP is pure win (fewer cards loaded + no CPU = faster)

### 5. Cost Constraints (Dramatically Improved with Two-Phase)
- Total budget: <$5/month single user (down from <$50)
- Two-phase + batching makes costs inherently reasonable
- Cost proportional to cards viewed, not cards matched

### 6. IDF (Inverse Document Frequency) Calculations for Word Clouds and Titles

**Current limitations:**
- IDF calculations based only on ~5k cards in hot set
- Used for word clouds (visual prominence of terms)
- Used for auto-generating working-notes titles
- Some slop acceptable, but ideally want more representative sample

**Requirements:**
- IDF calculations should use as many representative cards as possible
- Ideally based on ALL 30k+ cards, not just hot 5k subset
- Must not block UI (can be computed async/background)
- Results should be cached and updated periodically

**Architectural considerations:**
- Could compute IDF server-side (all cards available with NLP data)
- Could cache IDF results (changes slowly)
- Could compute incrementally (hot tier + sample from cold tier)
- Could use stale IDF from larger corpus (acceptable slop)
- With NLP data in Firestore, server can compute IDF over full 30k corpus
- IDF calculation uses `withoutStopWords` tier (same as fingerprinting)

**Note for architecture design:**
- This is a global corpus statistic (not per-collection)
- Changes slowly (only when card content changes significantly)
- High cache hit rate potential
- Acceptable to be slightly stale (doesn't need real-time)

### 7. Caching and Paging Architecture

**Hot tier (local, fast):**
- Keep recent cards loaded locally with real-time sync
- Potentially 5-10k cards with pre-computed NLP
- Instant access, no latency
- Real-time updates via `onSnapshot()`

**Dynamic paging (as needed):**
- Page cards in/out as user navigates through large collections
- Fetch batches of 50-100 cards
- Evict old batches when memory limit approached

**Aggressive prefetching (hide latency):**
- Prefetch next batch before user reaches boundary
- User rarely sees latency (feels instant)
- Keyboard navigation: Prefetch next 50 cards in collection
- Scroll navigation: Prefetch visible cards

**Search latency (acceptable):**
- Main visible latency is on initial search query
- Progressive loading makes it feel fast:
  - Count + preview from hot tier: <100ms
  - Full results from server: <500ms
  - User sees "30,000 results" + preview immediately

## Critical Insights from Critiques

### Collections Are Not Uniform (Revised with Two-Phase Pattern)

| Collection Type | Frequency | Card Data Needed | Cost with Two-Phase |
|----------------|-----------|------------------|---------------------|
| **Explicit searches** | 10-20/day | All results (~50-500 cards) | $0.01-0.10 per search |
| **Navigation collections** | 300-1,600/day | Visible only (~5-20 cards) | $0.000039 per collection |
| **Huge collections** | Rare | Progressive (~5-20 visible) | $0.000039-0.000048 |

**Two-phase pattern enables server queries for ALL collection types:**
- Phase 1 (card IDs): Cheap for all sizes (~60 reads)
- Phase 2 (card data): Cost proportional to visible cards, not collection size

### Cost Comparison: Naive vs Two-Phase with Batching

**Naive approach (fetch all card objects):**
```
Explicit search (500 results):  500 reads = $0.0003
Navigation (30k collection):    30,000 reads = $0.018
Total (10 searches + 1000 nav): $18.30/day ✗ CATASTROPHIC
```

**Two-phase batched approach (count + IDs, then batched card data):**
```
Explicit search (500 results):
  Phase 1: 60 reads (count + IDs)
  Phase 2: 500 reads (all result cards)
  Total: 560 reads = $0.000336

Navigation (30k collection, user views 50 cards):
  Phase 1: 60 reads (count + IDs)
  Phase 2: 50 reads (first batch)
  Total: 110 reads = $0.000066

Navigation (30k collection, user views 200 cards):
  Phase 1: 60 reads (count + IDs)
  Phase 2: 200 reads (4 batches)
  Total: 260 reads = $0.000156

Total (10 searches + 1000 nav, avg 50 cards viewed):
  10 × $0.000336 + 1000 × $0.000066 = $0.069/day ✓ ACCEPTABLE
```

**Cost reduction: 265× cheaper with two-phase batched pattern**

**Key insight**: Cost proportional to cards VIEWED, not cards MATCHED

### Smart Delegation Still Useful (But Less Critical)

With two-phase pattern, server queries are viable for all collections, but optimization still useful:
- Cache card ID lists (change infrequently)
- Distinguish client-only filters (similarity, references) from server-translatable
- Progressive loading for huge result sets

### KeyCard Prefetching with Two-Phase Fetch

**Critical constraint discovered**: KeyCards are almost always cards in the current collection.

**How it works:**
1. **Server returns card ID list** for collection (one-time cost per collection)
2. **Client progressively fetches card data** for visible cards + buffer
3. **User navigates (KeyCard changes)** to nearby card
4. **Card data already loaded** → Sidebar/reference blocks update instantly

**Prefetching strategy:**
1. When collection loads: Fetch card ID list from server (Phase 1)
2. Fetch card data for visible cards (5-20 cards, Phase 2)
3. User navigates: Most KeyCard changes are to already-loaded cards
4. As user scrolls: Fetch more card data in background

**Cost model with two-phase + batching:**
- **Phase 1 (Count + Card IDs)**: ~60 reads for count + 30k card IDs (one-time per collection)
  - Can be batched: Fetch first 1000 IDs, then fetch more as needed
  - Or fetch all IDs upfront if cheap enough (240KB for 30k IDs)
- **Phase 2 (Card data batches)**: ~1 read per card × batch size
  - Initial batch: 50 cards = 50 reads
  - Each subsequent batch: 50 cards = 50 reads
  - Only fetch batches user navigates to
- **Total per collection**: 60 (count/IDs) + 50 (initial batch) + (50 × batches navigated)
- **Navigation cost**: Near-zero within loaded batch, 50 reads at batch boundary

**Example: User navigates through 200 cards in a 30k collection:**
- Phase 1: 60 reads (count + all card IDs)
- Phase 2: 4 batches × 50 reads = 200 reads
- Total: 260 reads = $0.000156
- vs naive: 30,000 reads = $0.018 (115× cheaper)

**Example: User only views first 50 cards:**
- Phase 1: 60 reads (count + IDs)
- Phase 2: 1 batch × 50 reads = 50 reads
- Total: 110 reads = $0.000066
- vs naive: 30,000 reads = $0.018 (272× cheaper)

**Trade-offs:**
- ✅ Makes server queries viable for ALL collections (not just explicit searches)
- ✅ KeyCard navigation is instant (data already loaded)
- ✅ Natural pagination for huge collections (30k+ cards)
- ⚠️ Two-phase complexity (card ID list + card data)
- ⚠️ Server must return card ID list format (new API)

## Success Criteria

### Functionality
- ✅ Search coverage: 100% of 30k cards
- ✅ Count accuracy: Correct total count immediately (not progressive)
- ✅ Real-time sync: Maintained for loaded cards
- ✅ Progressive loading: Batched card data as user navigates
- ✅ Prefetching: Next batch ready before boundary reached
- ✅ IDF calculations: Based on representative sample (ideally all 30k cards, not just hot 5k)

### Performance
- ✅ Save latency: <200ms P50, <500ms P95 (no regression)
- ✅ Query latency: <100ms preview, <500ms complete
- ✅ Navigation: <100ms sidebar update

### Cost (Revised with Two-Phase + Batching)
- ✅ Monthly: <$5 for single user (realistic: $0.50-2/month)
- ✅ Per explicit search: <$0.001 (60 reads for count/IDs + 50-500 reads for results)
- ✅ Per navigation: <$0.0001 (most cards already in hot tier or loaded batch)
- ✅ Per large collection: <$0.0001 (60 reads for count/IDs + 50-100 for visible)

## Design Constraints

### 1. Store Pre-Processed NLP Data in Firestore (Required)

**Decision**: Store stemmed/normalized tokens in Firestore with each card.

**Why this is now a clear win:**
- **Fewer cards downloaded**: Only visible/navigated cards (50-200 vs 5,000-30,000)
- **CPU cost savings**: NLP processing is non-trivial, removing it is significant
- **Net performance gain**: Smaller download volume + no CPU processing = might keep MORE cards locally
- **Better server-side search**: Server can search pre-processed tokens directly

**Implementation:**
- Generate stemmed/normalized tokens on save (client and server)
- Store in new Firestore field (e.g., `nlp_tokens: string[]`)
- Server-side saves need NLP logic (same Porter stemming algorithm)
- Moderate increase in card size (acceptable given fewer cards loaded)

**Firestore limitation**: Can't fetch only some fields, always get full document
- Even if we only need card ID + title, we download full card
- This makes storing additional NLP data "free" in terms of query patterns
- Just increases storage cost slightly

### 2. Cannot Use Same Strategy for All Collections (Less Critical with Two-Phase)
- Explicit searches may need all result cards (for display)
- Navigation collections only need visible cards (progressive)

### 3. Progressive Loading with Count is REQUIRED
- Must show count immediately (most critical)
- Must show partial results immediately (first batch)
- Progressive batching as user navigates
- Prefetch next batch before boundary
- Count + first batch should be <500ms combined

### 4. KeyCard Navigation is Highly Predictable (Enables Batching)
- **KeyCards are almost always cards already in the current collection**
- Navigation is typically sequential (keyboard next/prev card)
- When scrolling, the next KeyCard must be visible on screen
- This means: 5-20 candidate KeyCards vs 30,000 theoretical possibilities

**Two-phase + batching leverages this:**
- Phase 1: Get count + IDs for collection (one-time)
- Phase 2: Fetch card data for visible cards in batch (progressive)
- KeyCard navigation stays within loaded batch (instant)
- When approaching batch boundary, prefetch next batch
- Navigation cost: Near-zero (data already loaded in batch)

### 5. Cost Controls (Less Critical with Two-Phase Batching)
- Two-phase + batching makes costs inherently reasonable
- Cost proportional to cards viewed, not cards matched
- Still useful: Cache count + card IDs (change infrequently)
- Optional: Rate limiting for server queries
- Optional: Budget monitoring and alerts

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
- `/Users/jkomoros/Code/card-web/src/nlp.ts` - PreparedQuery (client-only, stemming/normalization logic)

## NLP Processing Architecture Decision

**Current architecture**: NLP processing (Porter stemming, bigrams, normalization) happens client-side only.

**Decision**: Store pre-processed NLP tokens in Firestore (migrate to server-side search capability)

**Rationale with two-phase + batching:**
1. **Fewer cards downloaded** = NLP storage cost is negligible
   - Old: 5,000 cards always loaded → NLP storage cost significant
   - New: 50-200 cards typically loaded → NLP storage cost minimal
2. **CPU savings outweigh storage cost**
   - NLP processing is non-trivial computation
   - Pre-computed tokens eliminate this cost on every card load
   - Net performance gain: might support LARGER hot tier
3. **Firestore doesn't support field selection**
   - Always fetch full document regardless
   - Adding NLP field doesn't increase query cost
   - Only increases storage cost (small)
4. **Better server-side search**
   - Server can search pre-processed tokens directly
   - Enables full NLP search capabilities via Pipeline operations
   - Better ranking and relevance

**Implementation requirements:**
- Add `nlp` field to card schema with same multi-tier structure as currently computed
- Structure (from src/nlp.ts:611-621, 577-594):
  ```typescript
  nlp: {
      body: [ProcessedRun, ...],
      title: [ProcessedRun, ...],
      subtitle: [ProcessedRun, ...],
      ...
  }

  ProcessedRun: {
      original: string,       // "Force of Gravity"
      normalized: string,     // "force of gravity"
      stemmed: string,        // "forc of graviti"
      withoutStopWords: string  // "forc graviti"
  }
  ```
- Generate full NLP object on client save in `modifyCardWithBatch()` (src/actions/data.ts:400-452)
- NO server-side NLP machinery needed (server never modifies content)
- One-time backfill: Migrate existing 30k cards to include full NLP structure

**Server-side save paths analysis:**
- Tweet engagement updates (scheduled every 3 hours): `tweet_count`, `tweet_retweet_count`, `tweet_favorite_count`, `star_count`
- Auto-tweet marking (4 times daily): `tweet_count`, `last_tweeted`
- **Critical insight**: Server-side saves ONLY modify engagement metrics, NEVER content fields
- NLP tokens are computed from content fields (title, body, subtitle, tags, etc.)
- Since server never modifies content, NLP tokens remain valid
- **Therefore**: No server-side NLP computation needed, no Firestore trigger needed

**Firestore Enterprise Pipeline Operations support:**
- ✅ Supports nested object structure (maps containing arrays of objects)
- Can query nested fields: `nlp.body[*].withoutStopWords` (array wildcard queries)
- Can use `str_contains`, `regex_match` on nested string fields
- For text search: Query `withoutStopWords` tier (stemmed + stop words removed)
- For exact matching: Query `stemmed` or `normalized` tiers
- Preserves all four processing tiers for flexibility