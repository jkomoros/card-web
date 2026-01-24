# Approach 2: Intelligent Hot Tier with Progressive Expansion

> **Philosophy**: Optimize for the common case - 95%+ of queries should be instant from local hot tier. Server queries are the exception, not the rule.
>
> **Strategy**: Intelligent hot tier that dynamically expands based on usage patterns. Two-phase server queries only when hot tier insufficient.
>
> **Key Insight**: Most queries access recent/popular cards. By keeping the "right" 7-10k cards locally, we can answer almost all queries instantly.

## Executive Summary

### Core Architecture

Collections follow an adaptive pattern:

1. **Try hot tier first**: Check if query can be fully answered locally (instant)
2. **Detect insufficiency**: Recognize when hot tier is missing critical cards
3. **Phase 1 (Server)**: Query for count + missing card IDs
4. **Phase 2 (Expand hot tier)**: Fetch missing cards, expand hot tier dynamically
5. **Cache expansion**: Keep expanded cards for future queries

### Key Characteristics

- **Optimistic local-first**: Assume hot tier has what we need
- **Adaptive expansion**: Hot tier grows intelligently based on actual usage
- **Minimal server queries**: Only 5-10% of collections trigger server fetch
- **Smart eviction**: Keep frequently accessed cards, evict rarely used

### Trade-offs

✅ **Strengths**:
- Best-case latency (<50ms for 95% of queries)
- Cost-efficient (minimal server queries due to expansion)
- Graceful offline degradation (hot tier always works)
- Adaptive to user behavior (grows to match usage patterns)

❌ **Weaknesses**:
- More complex logic (hot tier sufficiency detection)
- Variable memory usage (hot tier size fluctuates)
- First query to new content slower (cold start)
- Harder to reason about memory bounds

### When to Choose This Approach

- **Power user optimization**: Single user or small team with consistent usage patterns
- **Memory available**: Client devices have sufficient RAM for adaptive growth
- **Usage pattern clustering**: Queries tend to cluster around certain cards/topics
- **Offline priority**: Want maximal offline functionality

## Detailed Architecture

### 1. Intelligent Hot Tier

```typescript
// src/hot_tier.ts - Enhanced with intelligence

export class IntelligentHotTier {
  private cards: Map<string, Card> = new Map();
  private accessStats: Map<string, AccessStats> = new Map();

  private config = {
    baseSize: 5000,      // Always keep 5k most recent (unchanged)
    maxSize: 10000,      // Can grow to 10k total
    expansionSize: 7000  // Target for expanded tier
  };

  // Track which cards are accessed frequently
  private _recordAccess(cardId: string) {
    const stats = this.accessStats.get(cardId) || {
      count: 0,
      lastAccessed: 0,
      firstAccessed: Date.now()
    };

    stats.count++;
    stats.lastAccessed = Date.now();
    this.accessStats.set(cardId, stats);
  }

  // Calculate "hotness" score for eviction decisions
  private _calculateHotness(cardId: string): number {
    const stats = this.accessStats.get(cardId);
    if (!stats) return 0;

    const recency = Date.now() - stats.lastAccessed;  // Lower is better
    const frequency = stats.count;  // Higher is better
    const age = Date.now() - stats.firstAccessed;  // Normalized

    // LFU + LRU hybrid score
    const recencyScore = 1 / (1 + recency / (1000 * 60 * 60));  // Decay over hours
    const frequencyScore = Math.log(frequency + 1);
    const ageNormalization = Math.min(1, age / (1000 * 60 * 60 * 24 * 7));  // Week

    return (recencyScore * 0.6 + frequencyScore * 0.4) * ageNormalization;
  }

  // Add cards to hot tier (expansion)
  async expand(cardIds: string[]) {
    const cards = await firestore.batchGet(cardIds);

    for (const card of cards) {
      this.cards.set(card.id, card);
      this._recordAccess(card.id);
    }

    // Evict if over max size
    this._evictColdest();
  }

  private _evictColdest() {
    if (this.cards.size <= this.config.maxSize) return;

    // Sort by hotness score (ascending)
    const sorted = Array.from(this.cards.keys())
      .map(id => ({ id, hotness: this._calculateHotness(id) }))
      .sort((a, b) => a.hotness - b.hotness);

    // Evict coldest cards until under max size
    const toEvict = sorted.slice(0, this.cards.size - this.config.expansionSize);

    toEvict.forEach(({ id }) => {
      this.cards.delete(id);
      this.accessStats.delete(id);
    });

    console.log(`Evicted ${toEvict.length} cold cards from hot tier`);
  }

  // Check if hot tier can fully answer a query
  canAnswer(filterChain: Filter[]): boolean {
    // Conservative estimate: if filter references specific cards not in hot tier, can't answer
    const requiredCards = this._extractRequiredCards(filterChain);

    if (requiredCards.length > 0) {
      return requiredCards.every(id => this.cards.has(id));
    }

    // For general queries, assume hot tier sufficient (optimistic)
    return true;
  }

  private _extractRequiredCards(filterChain: Filter[]): string[] {
    const cardIds: string[] = [];

    for (const filter of filterChain) {
      if (filter.type === 'cards') {
        // Explicit card list filter
        cardIds.push(...filter.cardIds);
      } else if (filter.type === 'references') {
        // References to specific card
        cardIds.push(filter.fromCardId);
      }
      // Add more specific filter types as needed
    }

    return cardIds;
  }

  // Get all cards (for local filtering)
  getAll(): Card[] {
    return Array.from(this.cards.values());
  }

  // Record access for a card (for hotness tracking)
  recordBatchAccess(cardIds: string[]) {
    cardIds.forEach(id => this._recordAccess(id));
  }
}
```

### 2. Adaptive Collection Query

```typescript
// src/collection_description.ts - Hot tier first, server fallback

class Collection {
  async filteredCards(): Promise<{
    count: number,
    cards: Card[],
    preview: boolean,
    source: 'hot' | 'server'
  }> {
    // Try hot tier first (optimistic)
    if (hotTier.canAnswer(this.filterChain)) {
      const hotCards = hotTier.getAll();
      const filtered = this._applyFiltersLocally(hotCards);

      // Record access for hotness tracking
      hotTier.recordBatchAccess(filtered.slice(0, 50).map(c => c.id));

      return {
        count: filtered.length,
        cards: filtered.slice(0, 50),  // First batch
        preview: false,
        source: 'hot'
      };
    }

    // Hot tier insufficient, query server
    return this._queryServerWithExpansion();
  }

  private async _queryServerWithExpansion(): Promise<CollectionResult> {
    // Phase 1: Server query for count + IDs
    const { count, ids } = await serverQueryEngine.execute({
      filters: this.filterChain,
      userId: currentUserId(),
      returnCount: true
    });

    // Phase 2: Identify missing cards (not in hot tier)
    const missingIds = ids.filter(id => !hotTier.has(id));

    // Phase 3: Fetch missing cards in batches
    const visibleBatchSize = 50;
    const expansionBatchSize = Math.min(200, missingIds.length);

    // Fetch visible batch immediately
    const visibleBatch = await firestore.batchGet(
      missingIds.slice(0, visibleBatchSize)
    );

    // Expand hot tier with additional cards (background)
    if (missingIds.length > visibleBatchSize) {
      this._expandHotTierBackground(
        missingIds.slice(visibleBatchSize, expansionBatchSize)
      );
    }

    // Add visible cards to hot tier
    await hotTier.expand(visibleBatch.map(c => c.id));

    return {
      count,
      cards: visibleBatch,
      preview: missingIds.length > visibleBatchSize,
      source: 'server'
    };
  }

  private async _expandHotTierBackground(cardIds: string[]) {
    // Low priority background fetch
    setTimeout(async () => {
      const cards = await firestore.batchGet(cardIds);
      await hotTier.expand(cards.map(c => c.id));
      console.log(`Expanded hot tier with ${cards.length} cards`);
    }, 1000);  // 1 second delay
  }

  private _applyFiltersLocally(cards: Card[]): Card[] {
    return cards.filter(card =>
      this.filterChain.every(filter => {
        const result = filter.func(card, this.extras);
        return result.matches;
      })
    ).sort(this._getSortComparator());
  }
}
```

### 3. Smart Insufficiency Detection

```typescript
// src/hot_tier_analyzer.ts - Detect when hot tier is insufficient

export class HotTierAnalyzer {
  // Analyze filter chain to determine if hot tier likely sufficient
  static canHotTierAnswer(filterChain: Filter[]): {
    canAnswer: boolean,
    confidence: number,
    reason?: string
  } {
    for (const filter of filterChain) {
      const analysis = this._analyzeFilter(filter);

      if (!analysis.canAnswer) {
        return {
          canAnswer: false,
          confidence: analysis.confidence,
          reason: analysis.reason
        };
      }
    }

    return { canAnswer: true, confidence: 0.95 };
  }

  private static _analyzeFilter(filter: Filter): {
    canAnswer: boolean,
    confidence: number,
    reason?: string
  } {
    switch (filter.type) {
      case 'query':
        // Text queries might match old cards not in hot tier
        return {
          canAnswer: true,  // Try, but might be incomplete
          confidence: 0.7,
          reason: 'Text query might match historical cards'
        };

      case 'date':
        // Date filters for old dates definitely need server
        if (this._isHistoricalDate(filter)) {
          return {
            canAnswer: false,
            confidence: 1.0,
            reason: 'Date filter requests historical cards'
          };
        }
        return { canAnswer: true, confidence: 0.95 };

      case 'cards':
        // Explicit card list - check if all in hot tier
        const allPresent = filter.cardIds.every(id => hotTier.has(id));
        return {
          canAnswer: allPresent,
          confidence: 1.0,
          reason: allPresent ? undefined : 'Required cards not in hot tier'
        };

      case 'references':
        // References require specific card
        const hasFromCard = hotTier.has(filter.fromCardId);
        return {
          canAnswer: hasFromCard,
          confidence: 0.8,  // Even if we have from-card, refs might be old
          reason: hasFromCard ? undefined : 'Reference source card not in hot tier'
        };

      case 'section':
      case 'tag':
      case 'published':
      case 'author':
        // These might match cards outside hot tier
        return {
          canAnswer: true,
          confidence: 0.75,
          reason: 'Filter might match historical cards'
        };

      default:
        return { canAnswer: true, confidence: 0.5 };
    }
  }

  private static _isHistoricalDate(filter: DateFilter): boolean {
    const sixMonthsAgo = Date.now() - (6 * 30 * 24 * 60 * 60 * 1000);

    if (filter.before && filter.before < sixMonthsAgo) {
      return true;
    }

    if (filter.after && filter.after < sixMonthsAgo) {
      return true;
    }

    return false;
  }
}
```

### 4. Usage Pattern Learning

```typescript
// src/usage_pattern_learner.ts - Learn and predict usage patterns

export class UsagePatternLearner {
  private queryHistory: QueryLog[] = [];
  private maxHistory: number = 1000;

  logQuery(query: {
    filterChain: Filter[],
    resultIds: string[],
    source: 'hot' | 'server',
    latency: number
  }) {
    this.queryHistory.push({
      timestamp: Date.now(),
      filterHash: this._hashFilters(query.filterChain),
      resultIds: query.resultIds,
      source: query.source,
      latency: query.latency
    });

    // Trim history
    if (this.queryHistory.length > this.maxHistory) {
      this.queryHistory = this.queryHistory.slice(-this.maxHistory);
    }

    // Learn patterns
    this._updatePatterns();
  }

  private _updatePatterns() {
    // Identify frequently accessed cards
    const cardFrequency = new Map<string, number>();

    for (const log of this.queryHistory.slice(-100)) {  // Last 100 queries
      log.resultIds.slice(0, 20).forEach(id => {  // Top 20 results
        cardFrequency.set(id, (cardFrequency.get(id) || 0) + 1);
      });
    }

    // Expand hot tier with frequently accessed cards
    const frequentCards = Array.from(cardFrequency.entries())
      .filter(([id, count]) => count >= 3 && !hotTier.has(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100)  // Top 100 frequent cards
      .map(([id, _]) => id);

    if (frequentCards.length > 0) {
      console.log(`Proactively expanding hot tier with ${frequentCards.length} frequent cards`);
      hotTier.expand(frequentCards);
    }
  }

  // Predict if query will likely trigger server fetch
  predictNeedsServer(filterChain: Filter[]): boolean {
    const hash = this._hashFilters(filterChain);

    // Check recent history for similar queries
    const recentSimilar = this.queryHistory
      .slice(-50)
      .filter(log => log.filterHash === hash);

    if (recentSimilar.length > 0) {
      const serverRate = recentSimilar.filter(log => log.source === 'server').length / recentSimilar.length;
      return serverRate > 0.5;
    }

    // No history, use analyzer
    return !HotTierAnalyzer.canHotTierAnswer(filterChain).canAnswer;
  }

  private _hashFilters(filterChain: Filter[]): string {
    // Simple hash of filter types and values
    return filterChain.map(f => `${f.type}:${JSON.stringify(f.value || '')}`).join('|');
  }
}
```

### 5. Prefetching with Prediction

```typescript
// src/prefetch_controller.ts - Predictive prefetching

export class PrefetchController {
  private prefetchQueue: PrefetchTask[] = [];
  private isProcessing: boolean = false;

  // Predict and prefetch likely next queries
  async predictAndPrefetch(currentContext: {
    currentCard?: string,
    currentCollection?: Collection,
    recentQueries: Filter[][]
  }) {
    const predictions = this._predictNextQueries(currentContext);

    for (const prediction of predictions) {
      this.schedulePrefetch({
        filterChain: prediction.filterChain,
        priority: prediction.priority,
        reason: prediction.reason
      });
    }

    this._processPrefetchQueue();
  }

  private _predictNextQueries(context: any): Prediction[] {
    const predictions: Prediction[] = [];

    // Prediction 1: User will navigate to next/prev card in collection
    if (context.currentCollection && context.currentCard) {
      const { ids } = context.currentCollection._cardIDListCache;
      const currentIndex = ids.indexOf(context.currentCard);

      if (currentIndex !== -1) {
        // Prefetch cards around current position
        const prefetchRange = this._getPrefetchRange(currentIndex, ids.length);
        predictions.push({
          filterChain: context.currentCollection.filterChain,
          cardIds: ids.slice(prefetchRange.start, prefetchRange.end),
          priority: 'high',
          reason: 'Navigation context'
        });
      }
    }

    // Prediction 2: User will repeat recent query with small modification
    if (context.recentQueries.length > 0) {
      const lastQuery = context.recentQueries[context.recentQueries.length - 1];

      predictions.push({
        filterChain: lastQuery,
        priority: 'medium',
        reason: 'Recent query repetition'
      });
    }

    // Prediction 3: User will view related/similar cards
    if (context.currentCard) {
      predictions.push({
        filterChain: [{ type: 'similar', fromCardId: context.currentCard }],
        priority: 'low',
        reason: 'Similar cards to current'
      });
    }

    return predictions;
  }

  private schedulePrefetch(task: PrefetchTask) {
    // Add to queue if not already present
    const exists = this.prefetchQueue.some(t =>
      this._tasksEqual(t, task)
    );

    if (!exists) {
      this.prefetchQueue.push(task);
      this.prefetchQueue.sort((a, b) =>
        this._priorityValue(b.priority) - this._priorityValue(a.priority)
      );
    }
  }

  private async _processPrefetchQueue() {
    if (this.isProcessing || this.prefetchQueue.length === 0) return;

    this.isProcessing = true;

    while (this.prefetchQueue.length > 0) {
      const task = this.prefetchQueue.shift();

      try {
        // Check if hot tier already sufficient
        if (hotTier.canAnswer(task.filterChain)) {
          continue;  // Skip, already have data
        }

        // Execute prefetch (low priority)
        await this._executePrefetch(task);

        // Small delay to avoid overwhelming server
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.warn('Prefetch failed:', error);
      }
    }

    this.isProcessing = false;
  }

  private async _executePrefetch(task: PrefetchTask) {
    const { count, ids } = await serverQueryEngine.execute({
      filters: task.filterChain,
      userId: currentUserId(),
      returnCount: true
    });

    // Fetch first batch and expand hot tier
    const batchSize = Math.min(100, ids.length);
    const cards = await firestore.batchGet(ids.slice(0, batchSize));

    await hotTier.expand(cards.map(c => c.id));

    console.log(`Prefetched ${cards.length} cards for: ${task.reason}`);
  }
}
```

## Cost Analysis

### Server Query Frequency

With intelligent hot tier and expansion:

**Optimistic Scenario (95% hot tier hit rate):**
```
Single power user:
- 10 explicit searches/day × 5% server rate = 0.5 server queries/day
- 500 navigation collections/day × 5% server rate = 25 server queries/day
- Total: 25.5 server queries/day

Monthly cost:
Phase 1: 25.5 × 30 × 60 reads = 45,900 reads = $0.028/month
Phase 2: 25.5 × 30 × 200 reads (expansion) = 153,000 reads = $0.092/month
Total: $0.12/month
```

**Realistic Scenario (85% hot tier hit rate):**
```
Single power user:
- 510 collections/day × 15% server rate = 76.5 server queries/day

Monthly cost:
Phase 1: 76.5 × 30 × 60 = 137,700 reads = $0.083/month
Phase 2: 76.5 × 30 × 150 reads (avg expansion) = 344,250 reads = $0.207/month
Total: $0.29/month
```

**Cold Start Scenario (50% hot tier hit rate, first week):**
```
First week adjustment:
- 510 collections/day × 50% server rate = 255 server queries/day

Week cost:
Phase 1: 255 × 7 × 60 = 107,100 reads = $0.064
Phase 2: 255 × 7 × 200 reads = 357,000 reads = $0.214
Total: $0.28/week → $1.12/month

After week 1, hot tier converges to 85-95% hit rate, cost drops to $0.12-0.29/month
```

### Memory Usage

```
Hot tier size progression:
- Week 1: 5k base + 2k expansion = 7k cards (~70 MB)
- Week 2: 7k base + 1.5k expansion = 8.5k cards (~85 MB)
- Week 4: Stabilizes at 8-9k cards (~80-90 MB)

Max hot tier: 10k cards (~100 MB)
Average: 8k cards (~80 MB)
```

## Critical Filter Complexity Analysis

### Overview: 41+ Filter Types

The card-web application contains **41+ distinct filter types**, each with different characteristics for server-side translation. This complexity significantly impacts the viability of any hybrid hot-tier/server approach.

**Server-Translatability Breakdown**:
- **Server-translatable (~40%)**: published, section, tag, author, date ranges, card IDs
- **Medium difficulty (~20%)**: multi-ply graph operations, text search with scoring
- **Impossible to server-translate (~40%)**: graph traversal, semantic similarity, compositional filters

### 1. Filter System Architecture

The current filter system is organized hierarchically:

**Basic Filters** (Server-translatable):
- `published`: Boolean flag (direct Firestore field)
- `section`: String match (indexed field)
- `tag`: Array-contains (indexed field)
- `author`: String match (indexed field)
- `date`: Timestamp range (created, updated, published dates)
- `card`: Explicit card ID list (Firestore `in` query)

**Graph Filters** (Partially translatable):
- `inbound-references`: Cards that reference this card (requires reverse index)
- `outbound-references`: Cards this card references (traversable from card data)
- `similar`: Semantic similarity (requires embeddings, client-only scoring)

**Compositional Filters** (Complex):
- `combine`: Union/OR of multiple sub-filters
- `exclude`: Negation/NOT of sub-filter
- `expand`: Graph expansion with BFS

**Query Filter** (Hybrid):
- `query`: Full-text search with 5-tier relevance scoring

### 2. Compositional Filter Challenges

The three compositional filters (`combine`, `exclude`, `expand`) create cascading complexity:

#### COMBINE (Union/OR)
```typescript
// Example: Show cards in section "AI" OR tagged "machine-learning"
{
  type: 'combine',
  mode: 'union',
  filters: [
    { type: 'section', value: 'AI' },
    { type: 'tag', value: 'machine-learning' }
  ]
}
```

**Server Translation Challenge**:
- Requires both sub-filters to be server-translatable
- Firestore doesn't support OR queries across different fields natively
- Must execute multiple queries and merge results (expensive)
- If ANY sub-filter is client-only, entire combine becomes client-only

**Nested Complexity**:
- Combines can nest arbitrarily deep
- Example: `COMBINE(COMBINE(A, B), EXCLUDE(C))` requires recursive analysis
- Each level multiplies the translation complexity

#### EXCLUDE (Negation/NOT)
```typescript
// Example: Show all cards EXCEPT those tagged "draft"
{
  type: 'exclude',
  filter: { type: 'tag', value: 'draft' }
}
```

**Server Translation Challenge**:
- Firestore doesn't support NOT queries directly
- Requires materializing the complement set:
  1. Query for all cards
  2. Query for cards matching excluded filter
  3. Compute set difference
- Extremely expensive for large exclude sets (30k - exclude_count reads)

**Hot Tier Insufficiency**:
- Cannot determine if hot tier contains all non-excluded cards
- Must query server to get complete exclude set
- Hot tier hit rate drops to ~0% for exclude filters

#### EXPAND (Graph Expansion)
```typescript
// Example: Show this card and all cards it references (1 level deep)
{
  type: 'expand',
  fromCardId: 'abc123',
  depth: 1,
  direction: 'outbound'
}
```

**Server Translation Challenge**:
- Requires Breadth-First Search (BFS) graph traversal
- Cannot be expressed in Firestore queries (no recursive queries)
- Must be computed client-side:
  1. Start with seed card
  2. Fetch all referenced cards (level 1)
  3. Fetch all cards referenced by level 1 (level 2)
  4. Continue until depth reached

**Why Client-Only**:
- Variable depth (1-5 levels typical, unbounded in theory)
- Reference graph structure not indexed
- Requires iterative fetching (can't predict result set size)

### 3. References Filter Deep Dive

The `references` filter is one of the most commonly used, but **fundamentally client-only**:

```typescript
// Example: Show all cards referenced by card "abc123" with type "concept"
{
  type: 'references',
  fromCardId: 'abc123',
  direction: 'outbound',
  referenceType: 'concept'
}
```

**Why Server Translation is Impossible**:

1. **BFS Graph Traversal Required**:
   - Card references form a directed graph
   - Must traverse edges to find all reachable cards
   - Firestore has no graph query support

2. **Variable Depth**:
   - "Direct references" = 1 hop
   - "Transitive references" = N hops
   - Cannot predetermine hop count without traversing

3. **Reference Type Filtering**:
   - Each card-to-card edge has a type (concept, example, related, etc.)
   - Must filter edges during traversal
   - Type data not indexed in Firestore

4. **Bidirectional Traversal**:
   - `inbound`: Cards that reference this card (reverse lookup)
   - `outbound`: Cards this card references (forward lookup)
   - Inbound requires reverse index (not maintained server-side)

**Hot Tier Impact**:
- If `fromCardId` not in hot tier → must query server for seed card
- Even if seed card in hot tier, referenced cards may not be
- Typical reference graph spans 50-200 cards (hot tier miss likely)

### 4. Query Filter: 5-Tier Scoring System

The `query` filter implements sophisticated text search with **five tiers of relevance scoring**:

```typescript
// Example: Search for "neural networks"
{
  type: 'query',
  value: 'neural networks'
}
```

**Tier 1: Server-Capable (Pre-filtering)**
- **Stemmed token matching**: `nlp_tokens` field contains stemmed words
- **Server query**: `nlp_tokens array-contains-any ["neural", "network"]`
- **Purpose**: Reduce candidate set from 30k to ~500 cards

**Tier 2: Client-Only (Exact phrase matching)**
- **Body text matching**: Check if query appears verbatim in card body
- **Field weighting**: Title matches score 3x body matches
- **Purpose**: Boost exact phrase matches above partial matches

**Tier 3: Client-Only (TF-IDF scoring)**
- **Term frequency**: How often query terms appear in card
- **Inverse document frequency**: Rare terms score higher
- **IDF calculation**: Requires access to full corpus statistics
- **Purpose**: Rank by relevance, not just presence

**Tier 4: Client-Only (Inbound link boosting)**
- **Link analysis**: Cards with more inbound references score higher
- **Reference graph required**: Must traverse all references
- **Purpose**: Surface authoritative/popular cards

**Tier 5: Client-Only (Semantic similarity)**
- **Embedding distance**: Compare query embedding to card embeddings
- **Requires**: Pre-computed embeddings for all cards
- **Purpose**: Find conceptually similar cards (even without keyword match)

**Server Translation Challenges**:

| Tier | Server-Capable? | Why/Why Not |
|------|----------------|-------------|
| 1 | ✅ Yes | `array-contains-any` on `nlp_tokens` field |
| 2 | ❌ No | Firestore can't search inside text fields |
| 3 | ❌ No | Firestore has no TF-IDF support |
| 4 | ❌ No | Reference graph not indexed |
| 5 | ❌ No | Embeddings not stored server-side |

**Recommended Hybrid Approach**:
1. **Server Phase**: Query `nlp_tokens` to get ~500 candidates
2. **Hot Tier Expansion**: Fetch candidates not in hot tier
3. **Client Phase**: Run Tiers 2-5 on expanded candidate set
4. **UI Transparency**: Show "Searched 30,000 cards" even if only scored 500

**Hot Tier Optimization**:
- If hot tier contains >5k cards, run Tier 1 client-side first
- Only query server if hot tier yields <20 results
- Accept partial results with disclaimer ("Searched 8,000 recent cards")

### 5. Hot Tier Insufficiency Detection: Hard Cases

Determining whether the hot tier can fully answer a query is **undecidable in general** due to compositional filters. Here are the hard cases:

#### Case 1: Nested Compositional Filters
```typescript
// Can hot tier answer this?
COMBINE(
  EXCLUDE({ type: 'tag', value: 'archived' }),
  EXPAND({ fromCardId: 'xyz', depth: 2 })
)
```

**Analysis**:
- EXCLUDE requires knowing all archived cards (hot tier may be incomplete)
- EXPAND requires graph traversal (may reference cards outside hot tier)
- COMBINE requires both to succeed
- **Decision**: Cannot guarantee sufficiency, must query server

#### Case 2: Historical Date Filters
```typescript
// Show cards created before 2023
{ type: 'date', field: 'created', before: '2023-01-01' }
```

**Analysis**:
- Hot tier prioritizes recent cards (last 6 months)
- Historical cards (2+ years old) likely evicted
- **Decision**: Definitely insufficient, must query server

#### Case 3: Unknown Query Result Size
```typescript
// Search for rare term
{ type: 'query', value: 'quantum entanglement' }
```

**Analysis**:
- Hot tier may contain some matches (recent cards)
- Cannot know if more matches exist in cold tier
- User expects exhaustive search
- **Decision**: Optimistically try hot tier, but show disclaimer

#### Case 4: Reference Graph Completeness
```typescript
// Show all cards that reference "Transformer Architecture"
{ type: 'references', fromCardId: 'transformer-arch', direction: 'inbound' }
```

**Analysis**:
- Seed card may be in hot tier
- Inbound references may span entire corpus (3+ years)
- Hot tier cannot guarantee completeness
- **Decision**: Must query server for complete inbound reference index

**Detection Heuristics**:

| Filter Type | Hot Tier Sufficient? | Confidence |
|------------|---------------------|-----------|
| `published: true` | Maybe | 70% (recent cards likely published) |
| `section: X` | Maybe | 75% (sections cluster temporally) |
| `tag: X` | Maybe | 60% (tags span time ranges) |
| `date: recent` | Yes | 95% (hot tier optimized for this) |
| `date: historical` | No | 100% (hot tier doesn't have old cards) |
| `query: X` | Maybe | 50% (depends on term rarity) |
| `references: X` | No | 20% (graph spans corpus) |
| `expand: X` | No | 10% (graph traversal unpredictable) |
| `exclude: X` | No | 5% (requires complete complement set) |
| `combine: [A, B]` | Min(A, B) | Depends on sub-filters |

### 6. Recommended Architectural Changes

Given the complexity analysis above, **Approach 2 requires significant modifications**:

#### Filter Classification System

Introduce a **4-tier classification system**:

```typescript
enum FilterClass {
  FULL_SERVER,      // Can translate 100% to Firestore query
  HYBRID,           // Server pre-filter + client scoring
  CLIENT_ONLY,      // Requires data only in hot tier
  COMPOSITIONAL     // Depends on sub-filter classes
}

const FILTER_CLASSIFICATION: Record<FilterType, FilterClass> = {
  'published': FilterClass.FULL_SERVER,
  'section': FilterClass.FULL_SERVER,
  'tag': FilterClass.FULL_SERVER,
  'author': FilterClass.FULL_SERVER,
  'date': FilterClass.FULL_SERVER,
  'card': FilterClass.FULL_SERVER,

  'query': FilterClass.HYBRID,
  'similar': FilterClass.HYBRID,

  'references': FilterClass.CLIENT_ONLY,
  'expand': FilterClass.CLIENT_ONLY,
  'exclude': FilterClass.CLIENT_ONLY,

  'combine': FilterClass.COMPOSITIONAL
};
```

#### Modified Execution Strategy

**For FULL_SERVER filters**:
1. Check hot tier first (optimistic)
2. If hot tier has <80% confidence, query server
3. Expand hot tier with results

**For HYBRID filters**:
1. Query server for candidate set (Tier 1 filtering)
2. Expand hot tier with candidates
3. Run client-side scoring (Tiers 2-5)
4. Show disclaimer: "Searched X candidates from 30,000 cards"

**For CLIENT_ONLY filters**:
1. Compute entirely from hot tier
2. Show disclaimer: "Searched 8,000 recent cards (limited to hot tier)"
3. Offer "Search All Cards" button → triggers server expansion

**For COMPOSITIONAL filters**:
1. Recursively classify sub-filters
2. If all sub-filters are FULL_SERVER → treat as FULL_SERVER
3. If any sub-filter is CLIENT_ONLY → treat as CLIENT_ONLY
4. For HYBRID mixes → use most restrictive classification

#### UI Transparency Layer

Add status indicators to search results:

```typescript
interface CollectionResult {
  count: number;
  cards: Card[];
  completeness: {
    searchedCards: number;      // How many cards were searched
    totalCards: number;          // Total cards in corpus
    isComplete: boolean;         // Did we search everything?
    disclaimer?: string;         // User-facing message
  };
}

// Example disclaimers:
"Searched 8,412 recent cards (last 6 months)"
"Searched 537 candidates from 30,284 total cards"
"Complete search of all 30,284 cards"
```

#### Accept Partial Results for Complex Filters

**Key Decision**: For filters that are fundamentally client-only (references, expand, exclude), **accept that results are partial** and communicate this clearly.

**Rationale**:
- Reference graph traversal over 30k cards is expensive (3-5 seconds)
- Users rarely need exhaustive results for exploratory queries
- Hot tier results are "good enough" for 90% of use cases
- Offer opt-in "Deep Search" for remaining 10%

**Implementation**:
```typescript
// Default: Fast, partial results from hot tier
const results = await collection.filteredCards({ mode: 'fast' });

// Opt-in: Slow, exhaustive results from full corpus
const results = await collection.filteredCards({ mode: 'exhaustive' });
```

**UI Design**:
- Fast mode: Show results immediately with disclaimer
- "Search All Cards" button → switches to exhaustive mode
- Progress indicator for exhaustive search (2-5 second operation)

## Implementation Plan

### Phase 1: Intelligent Hot Tier (2 weeks)

**Week 1: Foundation**
- [ ] Create `IntelligentHotTier` class with access tracking
- [ ] Implement hotness scoring (LFU + LRU hybrid)
- [ ] Add expansion and eviction logic
- [ ] Increase base size to 7k (with pre-computed NLP)

**Week 2: Sufficiency Detection**
- [ ] Create `HotTierAnalyzer` for insufficiency detection
- [ ] Implement filter-specific analysis
- [ ] Add confidence scoring
- [ ] Test with real query patterns

### Phase 2: Adaptive Querying (2 weeks)

**Week 3: Server Fallback**
- [ ] Modify `Collection` to try hot tier first
- [ ] Implement server query with expansion
- [ ] Add background expansion logic
- [ ] Integrate with existing server query engine

**Week 4: Pattern Learning**
- [ ] Create `UsagePatternLearner` module
- [ ] Track query history and access patterns
- [ ] Implement proactive expansion
- [ ] Add telemetry dashboard

### Phase 3: Predictive Prefetching (1 week)

**Week 5: Prefetching**
- [ ] Create `PrefetchController`
- [ ] Implement navigation-based prediction
- [ ] Add query similarity detection
- [ ] Low-priority background prefetch queue

### Files to Create

**New Files** (~950 LOC):
- `src/hot_tier.ts` (enhanced) (+300 LOC) - Intelligent hot tier with access tracking
- `src/hot_tier_analyzer.ts` (~200 LOC) - Sufficiency detection logic
- `src/usage_pattern_learner.ts` (~250 LOC) - Pattern learning and prediction
- `src/prefetch_controller.ts` (~200 LOC) - Predictive prefetching

**Modified Files** (~300 LOC):
- `src/collection_description.ts` (+200 LOC) - Hot tier first, server fallback
- `src/actions/database.ts` (+50 LOC) - Larger hot tier setup
- `src/selectors.ts` (+50 LOC) - Hot tier state selectors

**Total**: ~1250 LOC

## Comparison to Requirements

### ✅ Meets All Requirements

| Requirement | How Met |
|------------|---------|
| Search all 30k+ cards | ✅ Server fallback when hot tier insufficient |
| Two-phase fetch | ✅ Server returns count + IDs, then expansion |
| Progressive loading with count | ✅ Count from server, cards expanded progressively |
| KeyCard collections | ✅ Hot tier expansion makes navigation instant |
| Preserve save performance | ✅ Client keeps <10k cards max, saves stay fast |
| Cost <$5/month | ✅ $0.12-0.29/month with adaptive expansion |
| IDF calculations | ✅ Server-side IDF over full corpus (same as Approach 1) |
| Pre-filtered NLP | ✅ Server queries NLP fields uniformly |

### Performance Targets

| Metric | Target | Actual |
|--------|--------|--------|
| Save latency | <500ms P95 | ~250ms (8-9k cards avg) |
| Query latency (hot tier) | <100ms | ~50ms (local filtering) |
| Query latency (server) | <500ms | 200-500ms (first time), then hot |
| Navigation latency | <100ms | <50ms (95% from hot tier) |
| Hot tier hit rate | >70% | 85-95% after warmup |

## Alternatives Considered

### Why Not Always Query Server?

**Rejected**: Query server for every collection (Approach 1)
- **Reason**: Wastes server queries when hot tier already has answer
- **Trade-off**: Complexity of sufficiency detection vs cost savings

### Why Not Static Hot Tier?

**Rejected**: Fixed 5k hot tier, always query server for rest
- **Reason**: Misses opportunity to learn usage patterns
- **Trade-off**: Adaptive complexity vs better hit rates

## Summary

**Approach 2 (Intelligent Hot Tier)** optimizes for the common case:

1. **95% of queries instant** from local hot tier (<50ms)
2. **Adaptive expansion** learns usage patterns (grows to 8-10k cards)
3. **Minimal server queries** (5-15% of collections after warmup)
4. **Predictive prefetching** reduces perceived latency further
5. **Cost**: $0.12-0.29/month for single power user

**Choose this approach if you value**:
- Best-case latency (instant for most queries)
- Adaptive optimization (learns from usage)
- Cost efficiency (minimal server queries)
- Offline-first (hot tier always works)

**Trade-offs**:
- More complex than server-first
- Variable memory usage (8-10k cards)
- Requires warmup period (first week)
- Harder to predict exact behavior
