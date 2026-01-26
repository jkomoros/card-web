# Approach 2: Intelligent Hot Tier with Progressive Expansion

> **Philosophy**: Optimize for the common case - 95%+ of queries should be instant from local hot tier. Server queries are the exception, not the rule.
>
> **Strategy**: Multi-tier hot tier with intelligent discovered card management and LRU/LFU hybrid eviction. Two-phase server queries only when hot tier insufficient.
>
> **Key Insight**: Most queries access recent/popular cards. By keeping the "right" 7-10k cards locally with smart eviction, we can answer almost all queries instantly.

## Executive Summary

### Core Architecture

Collections follow an adaptive pattern with three-tier hot tier + discovered cards:

1. **Multi-tier hot tier** (5-10k cards): Published (5k) + Prioritized (user-configured) + Recent Unpublished (dynamic)
2. **Discovered cards** (WARM tier): Cards from search/similarity/filters with staleness tracking
3. **Ghost cards** (minimal metadata): Previews for evicted cards with fetch-on-demand
4. **Recent edits listener**: 250 most recently edited cards for discovered card freshness
5. **Smart eviction**: LRU/LFU hybrid scoring keeps frequently accessed cards

### Key Characteristics

- **Optimistic local-first**: Assume hot tier has what we need
- **Adaptive expansion**: Discovered cards tracked with access patterns
- **Minimal server queries**: Only 5-10% of collections trigger server fetch
- **Smart eviction**: Hybrid LRU/LFU scoring with discovery-method weighting
- **Ghost cards**: Distinguish "not loaded" from "doesn't exist"

### Performance Targets

| Metric | Target | Approach 2 |
|--------|--------|------------|
| Save latency P95 | <500ms | ~250ms (8-9k cards avg) |
| Query latency (hot tier) | <100ms | ~50ms (local filtering) |
| Query latency (server) | <500ms | 200-500ms (first time), then hot |
| Navigation latency | <100ms | <50ms (95% from hot tier) |
| Hot tier hit rate | >70% | 85-95% after warmup |
| Cost/month (power user) | <$5 | $0.12-0.66 |

### Trade-offs

✅ **Strengths**:
- Best-case latency (<50ms for 95% of queries)
- Cost-efficient (minimal server queries due to expansion)
- Graceful offline degradation (hot tier always works)
- Adaptive to user behavior (grows to match usage patterns)
- Ghost cards enable preview without full fetch

❌ **Weaknesses**:
- More complex logic (tier management, eviction)
- Variable memory usage (hot tier + discovered fluctuates)
- First query to new content slower (cold start)
- Requires warmup period (first week 50% hit rate → 85-95%)

### When to Choose This Approach

- **Power user optimization**: Single user or small team with consistent usage patterns
- **Memory available**: Client devices have sufficient RAM for adaptive growth
- **Usage pattern clustering**: Queries tend to cluster around certain cards/topics
- **Offline priority**: Want maximal offline functionality

---

## 1. Multi-Tier Hot Tier Architecture

### 1.1 Tier Structure

```typescript
// src/types.ts - Hot tier configuration

export interface HotTierConfig {
  // Tier 1: Published cards (NEVER_EVICT)
  published: {
    maxSize: 5000;
    query: 'where(published == true)';
    priority: 'NEVER_EVICT';
  };

  // Tier 2: Prioritized unpublished (NEVER_EVICT, user-configured)
  prioritized: {
    maxSize: number;  // User-configurable: 0-3000
    tags?: string[];
    sections?: string[];
    authors?: string[];
    priority: 'NEVER_EVICT';
  };

  // Tier 3: Recent unpublished (HOT, evictable)
  recentUnpublished: {
    maxSize: number;  // Calculated: 10k - Tier1 - Tier2
    query: 'where(published == false) orderBy(created, desc) limit(N)';
    priority: 'HOT';
  };
}

// Target total: 10,000 cards across all three tiers
// Tier 1: ~5,000 (fixed)
// Tier 2: ~1,000-2,000 (user configurable)
// Tier 3: ~3,000-4,000 (fills to 10k)
```

### 1.2 Query Construction

```typescript
// src/actions/database.ts - Multi-tier connections

// Tier 1: Published cards (unchanged from current)
export const connectLivePublishedCards = () => {
  if (!selectUserMayViewApp(store.getState() as State)) return;

  livePublishedCardsUnsubscribe = onSnapshot(
    query(collection(db, CARDS_COLLECTION), where('published', '==', true)),
    cardSnapshotReceiver('published')
  );
};

// Tier 2: Prioritized unpublished (NEW)
let livePrioritizedUnpublishedCardsUnsubscribe: (() => void) | null = null;

export const connectLivePrioritizedUnpublishedCards = () => {
  const state = store.getState() as State;
  if (!selectUserMayViewApp(state)) return;

  const config = selectHotTierPriorityConfig(state);
  if (!config.enabled) return;

  // Build queries from user configuration
  const queries = buildPrioritizedUnpublishedQueries(config);

  store.dispatch(expectUnpublishedCards('unpublished-prioritized'));

  // Execute all queries, union results
  const unsubscribers = queries.map(q =>
    onSnapshot(q, cardSnapshotReceiver('unpublished-prioritized'))
  );

  livePrioritizedUnpublishedCardsUnsubscribe = () => {
    unsubscribers.forEach(unsub => unsub());
  };
};

const buildPrioritizedUnpublishedQueries = (config: HotTierPriorityConfig): Query[] => {
  const queries: Query[] = [];
  const baseCollection = collection(db, CARDS_COLLECTION);
  const unpublishedConstraint = where('published', '==', false);

  // Tags query (array-contains-any, max 10 items)
  if (config.tags && config.tags.length > 0) {
    const tagBatches = chunkArray(config.tags, 10);
    tagBatches.forEach(batch => {
      queries.push(
        query(baseCollection, unpublishedConstraint, where('tags', 'array-contains-any', batch))
      );
    });
  }

  // Sections query (in, max 10 items)
  if (config.sections && config.sections.length > 0) {
    const sectionBatches = chunkArray(config.sections, 10);
    sectionBatches.forEach(batch => {
      queries.push(
        query(baseCollection, unpublishedConstraint, where('section', 'in', batch))
      );
    });
  }

  // Authors query (in, max 10 items)
  if (config.authors && config.authors.length > 0) {
    const authorBatches = chunkArray(config.authors, 10);
    authorBatches.forEach(batch => {
      queries.push(
        query(baseCollection, unpublishedConstraint, where('author', 'in', batch))
      );
    });
  }

  return queries;
};

// Tier 3: Recent unpublished (MODIFIED from current)
export const connectLiveUnpublishedCards = () => {
  const state = store.getState() as State;
  if (!selectUserMayViewApp(state)) return;

  // Calculate dynamic limit for Tier 3
  const tier3Limit = calculateTier3Limit(state);

  const userMayViewUnpublished = selectUserMayViewUnpublished(state);
  const completeModeEnabled = selectCompleteModeEnabled(state);

  if (userMayViewUnpublished) {
    store.dispatch(expectUnpublishedCards(
      completeModeEnabled ? 'unpublished-complete' : 'unpublished-recent'
    ));

    if (completeModeEnabled) {
      // Complete mode: all unpublished
      liveUnpublishedCardsUnsubcribe = onSnapshot(
        query(collection(db, CARDS_COLLECTION), where('published', '==', false)),
        cardSnapshotReceiver('unpublished-complete')
      );
    } else {
      // Partial mode: limited to Tier 3 allocation
      liveUnpublishedCardsUnsubcribe = onSnapshot(
        query(
          collection(db, CARDS_COLLECTION),
          where('published', '==', false),
          orderBy('created', 'desc'),
          limit(tier3Limit)
        ),
        cardSnapshotReceiver('unpublished-recent')
      );
    }
  }
};

const calculateTier3Limit = (state: State): number => {
  const totalBudget = 10000;  // Target total cards
  const tier1Count = 5000;     // Published (estimated)
  const tier2Config = selectHotTierPriorityConfig(state);
  const tier2EstimatedCount = tier2Config.enabled ? estimateTier2Count(tier2Config) : 0;

  // Tier 3 = Budget - Tier 1 - Tier 2
  const tier3Limit = Math.max(0, totalBudget - tier1Count - tier2EstimatedCount);

  console.log(`Hot Tier: T1=${tier1Count}, T2=${tier2EstimatedCount}, T3=${tier3Limit}`);

  return tier3Limit;
};
```

### 1.3 Tier Priority Configuration

```typescript
// src/hot_tier_config.ts - User configuration

export interface HotTierPriorityConfig {
  enabled: boolean;
  tags?: string[];      // e.g., ['active-projects', 'high-priority']
  sections?: string[];  // e.g., ['roadmap', 'urgent']
  authors?: string[];   // e.g., ['uid-teammate-1', 'uid-teammate-2']
}

export const DEFAULT_HOT_TIER_PRIORITY_CONFIG: HotTierPriorityConfig = {
  enabled: false,
  tags: [],
  sections: [],
  authors: []
};

// Stored in localStorage
export const loadHotTierPriorityConfig = (): HotTierPriorityConfig => {
  const stored = localStorage.getItem('hotTierPriorityConfig');
  if (stored) {
    try {
      return {...DEFAULT_HOT_TIER_PRIORITY_CONFIG, ...JSON.parse(stored)};
    } catch (e) {
      console.error('Failed to parse hot tier config', e);
    }
  }
  return DEFAULT_HOT_TIER_PRIORITY_CONFIG;
};
```

### 1.4 Deduplication Across Tiers

```typescript
// src/actions/data.ts - Enhanced receiveCards with tier priority

export const receiveCards = (cards: Cards, fetchType: CardFetchType): ThunkSomeAction =>
  (dispatch, getState) => {
    const state = getState();
    const existingCards = selectRawCards(state);
    const existingMetadata = state.data.cardFetchMetadata || {};

    const cardsToUpdate: Cards = {};
    const updatedMetadata = {...existingMetadata};

    for (const card of Object.values(cards)) {
      const cardId = card.id;
      const existingCard = existingCards[cardId];
      const existingMeta = existingMetadata[cardId];

      // Determine tier from fetchType
      const incomingTier = fetchTypeToTier(fetchType);

      // Check if we already have this card from a higher-priority tier
      if (existingCard && existingMeta) {
        const existingTier = existingMeta.primaryTier;

        if (tierPriority(existingTier) > tierPriority(incomingTier)) {
          // Keep existing card from higher-priority tier
          console.log(`Dedup: Keeping ${cardId} from ${existingTier} (ignoring ${incomingTier})`);

          // But track that this tier also has it
          updatedMetadata[cardId] = {
            ...existingMeta,
            fetchTypes: [...existingMeta.fetchTypes, fetchType]
          };
          continue;
        }
      }

      // Accept this card (either new or from higher-priority tier)
      if (!existingCard || !deepEqualIgnoringTimestamps(existingCard, card)) {
        cardsToUpdate[cardId] = card;
      }

      updatedMetadata[cardId] = {
        fetchTypes: existingMeta ? [...existingMeta.fetchTypes, fetchType] : [fetchType],
        primaryTier: incomingTier
      };
    }

    const pendingModifications = selectPendingModificationCount(state);
    if (pendingModifications === 0) {
      dispatch(updateCards(cardsToUpdate, fetchType, updatedMetadata));
    }
    dispatch(enqueueCardUpdates(cardsToUpdate, fetchType));
  };

const fetchTypeToTier = (fetchType: CardFetchType): 'tier1' | 'tier2' | 'tier3' => {
  if (fetchType === 'published') return 'tier1';
  if (fetchType === 'unpublished-prioritized') return 'tier2';
  return 'tier3';
};

const tierPriority = (tier: 'tier1' | 'tier2' | 'tier3'): number => {
  return {tier1: 3, tier2: 2, tier3: 1}[tier];
};
```

---

## 2. Discovered Cards with Intelligent Eviction

### 2.1 Discovery Mechanisms

Cards discovered outside the hot tier are tracked with metadata:

```typescript
// src/types.ts - Discovered card metadata

export type DiscoveryMethod =
  | 'reference-block'     // Priority: HIGH (70%) - Explicitly referenced
  | 'similarity-sidebar'  // Priority: HIGH (60%) - Similar to active card
  | 'search-query'        // Priority: MEDIUM-HIGH (50%) - User searched
  | 'filter-collection'   // Priority: MEDIUM (40%) - Collection browsing
  | 'navigation'          // Priority: LOW (20%) - Prefetched
  | 'prefetch';           // Priority: VERY LOW (10%) - Aggressive prefetch

export interface DiscoveredCardMetadata {
  cardID: CardID;
  tier: 'WARM' | 'COLD' | 'GHOST';
  discoveryMethod: DiscoveryMethod;
  discoveryContext?: CardID;  // Card that led to discovery
  discoveredAt: number;        // Timestamp when first discovered
  addedAt: number;             // Timestamp when added to current tier
  lastAccessed: number;        // Last access timestamp
  accessCount: number;         // Total access count
  lastSyncedAt?: number;       // Last time fetched from Firestore
  fresh?: boolean;             // In recent edits window
}
```

### 2.2 LRU/LFU Hybrid Eviction Scoring

```typescript
// src/discovered_cards/eviction.ts - Hybrid scoring algorithm

/**
 * Calculate eviction score for a card.
 * Lower scores = higher priority for eviction.
 *
 * Formula:
 * - Recency: 40% (how recently accessed)
 * - Frequency: 30% (how often accessed)
 * - Age: 20% (how long in tier)
 * - Discovery: 10% (discovery method quality)
 */
export function calculateEvictionScore(
  metadata: DiscoveredCardMetadata,
  now: number = Date.now()
): number {

  // RECENCY COMPONENT (40%)
  // Exponential decay: score halves every 6 hours
  const hoursSinceAccess = (now - metadata.lastAccessed) / (1000 * 60 * 60);
  const recencyScore = Math.exp(-0.1155 * hoursSinceAccess); // 0.1155 ≈ ln(2)/6

  // FREQUENCY COMPONENT (30%)
  // Logarithmic scaling: diminishing returns for high frequency
  const frequencyScore = Math.log10(metadata.accessCount + 1) / 2.0;

  // AGE COMPONENT (20%)
  // How long has card been in this tier? Older = more established
  const daysInTier = (now - metadata.addedAt) / (1000 * 60 * 60 * 24);
  const ageScore = Math.min(1.0, daysInTier / 7.0); // Caps at 1 week

  // DISCOVERY METHOD COMPONENT (10%)
  // Weight by discovery quality
  const discoveryWeights: {[key in DiscoveryMethod]: number} = {
    'reference-block': 0.9,
    'similarity-sidebar': 0.7,
    'search-query': 0.6,
    'filter-collection': 0.4,
    'navigation': 0.2,
    'prefetch': 0.1,
  };
  const discoveryScore = discoveryWeights[metadata.discoveryMethod] || 0.3;

  // WEIGHTED TOTAL
  return (
    recencyScore * 0.40 +
    frequencyScore * 0.30 +
    ageScore * 0.20 +
    discoveryScore * 0.10
  );
}

// Example scores:
// - Just searched, 2 accesses: 0.55 (keep)
// - Reference, viewed 10x: 0.85 (definitely keep)
// - Prefetch, never accessed, 2 days: 0.09 (evict!)
// - Stale search, 5 accesses, 6 months: 0.47 (maybe evict)
```

### 2.3 Eviction Manager

```typescript
// src/discovered_cards/eviction_manager.ts - Background eviction

export class EvictionManager {
  private isEvicting = false;
  private evictionInterval: number | null = null;

  constructor() {
    // Check every 5 minutes
    this.evictionInterval = window.setInterval(() => {
      this.checkAndEvict();
    }, 5 * 60 * 1000);
  }

  async checkAndEvict(): Promise<void> {
    if (this.isEvicting) return;

    const state = store.getState() as State;
    const discoveredState = selectDiscoveredCardsState(state);
    const status = assessMemoryPressure(discoveredState);

    if (!status.shouldEvict) return;

    this.isEvicting = true;

    try {
      // Calculate scores for all WARM cards
      const metadata = selectDiscoveredCardMetadata(state);
      const scores = this.scoreAllCards(metadata);

      // Sort by score (ascending = worst first)
      scores.sort((a, b) => a.totalScore - b.totalScore);

      // Determine how many to evict
      const currentCount = status.warmCount;
      const target = MEMORY_CONFIG.EVICTION_TARGET;
      const toEvict = Math.min(
        currentCount - target,
        MEMORY_CONFIG.EVICTION_BATCH_SIZE
      );

      // Take worst N cards
      const victimIDs = scores.slice(0, toEvict).map(s => s.cardID);

      console.log(`Evicting ${victimIDs.length} cards (scores: ${scores[0].totalScore.toFixed(3)} - ${scores[toEvict-1].totalScore.toFixed(3)})`);

      // Create ghost cards for evicted cards with references
      const ghostCards = await this.createGhostCards(victimIDs, state);

      // Dispatch eviction
      store.dispatch(evictDiscoveredCards(victimIDs, ghostCards));

    } finally {
      this.isEvicting = false;
    }
  }

  private scoreAllCards(metadata: {[id: CardID]: DiscoveredCardMetadata}): EvictionScore[] {
    const now = Date.now();
    const scores: EvictionScore[] = [];

    for (const meta of Object.values(metadata)) {
      if (meta.tier === 'GHOST') continue;
      const score = calculateEvictionScore(meta, now);
      scores.push({cardID: meta.cardID, totalScore: score});
    }

    return scores;
  }

  private async createGhostCards(
    cardIDs: CardID[],
    state: State
  ): Promise<GhostCard[]> {
    const ghosts: GhostCard[] = [];
    const cards = selectRawCards(state);

    for (const cardID of cardIDs) {
      const card = cards[cardID];

      // Only create ghost if card has inbound references
      if (card && hasInboundReferences(card)) {
        ghosts.push({
          id: card.id,
          title: card.title,
          section: card.section,
          cardType: card.card_type,
          published: card.published,
          tier: 'GHOST'
        });
      }
    }

    return ghosts;
  }
}
```

### 2.4 Memory Budget Configuration

```typescript
// src/discovered_cards/config.ts - Memory configuration

export const MEMORY_CONFIG = {
  // Target counts
  HOT_TIER_TARGET: 10000,       // Total hot tier (all 3 tiers)
  WARM_TIER_TARGET: 5000,       // Discovered cards target
  WARM_TIER_MAX: 6000,          // Hard limit before eviction
  GHOST_TIER_MAX: 2000,         // Maximum ghost entries

  // Memory estimates (bytes)
  AVG_CARD_SIZE: 10 * 1024,     // 10KB per full card
  AVG_GHOST_SIZE: 500,          // 500 bytes per ghost (95% savings)
  AVG_METADATA_SIZE: 500,       // 500 bytes per metadata entry

  // Eviction batch configuration
  EVICTION_BATCH_SIZE: 500,     // Evict 500 cards per batch
  EVICTION_TARGET: 4500,        // Evict down to this count

  // Hysteresis zones (prevent thrashing)
  EVICTION_TRIGGER_HIGH: 6000,  // Start evicting
  EVICTION_TRIGGER_LOW: 4500,   // Stop evicting
};

export interface MemoryStatus {
  warmCount: number;
  ghostCount: number;
  totalEstimate: number;
  shouldEvict: boolean;
  pressure: 'low' | 'medium' | 'high' | 'critical';
}

export function assessMemoryPressure(state: DiscoveredCardsState): MemoryStatus {
  const {warmCardCount, ghostCardCount, totalMemoryEstimate} = state;

  let pressure: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (warmCardCount > MEMORY_CONFIG.WARM_TIER_MAX) {
    pressure = 'critical';
  } else if (warmCardCount > MEMORY_CONFIG.WARM_TIER_MAX * 0.9) {
    pressure = 'high';
  } else if (warmCardCount > MEMORY_CONFIG.WARM_TIER_TARGET) {
    pressure = 'medium';
  }

  return {
    warmCount: warmCardCount,
    ghostCount: ghostCardCount,
    totalEstimate: totalMemoryEstimate,
    shouldEvict: warmCardCount >= MEMORY_CONFIG.EVICTION_TRIGGER_HIGH,
    pressure
  };
}
```

---

## 3. Ghost Cards for Evicted Content

### 3.1 Ghost Card Structure

```typescript
// src/types.ts - Ghost card definition

export interface GhostCard {
  // Minimal card data for previews (500 bytes vs 10KB full card)
  id: CardID;
  title: string;
  section: SectionID;
  cardType: CardType;
  published: boolean;
  tier: 'GHOST';

  // Intentionally missing: body, references, nlp data, etc.
}

export type CardOrGhost = Card | GhostCard;

export function isGhostCard(card: CardOrGhost | null): card is GhostCard {
  return card !== null && 'tier' in card && card.tier === 'GHOST';
}
```

### 3.2 Card Link Component States

```typescript
// src/components/card-link.ts - Three-state rendering

@customElement('card-link')
class CardLink extends LitElement {
  @state()
  _cardState: 'loaded' | 'ghost' | 'not-found' | 'loading';

  get _cardState(): 'loaded' | 'ghost' | 'not-found' | 'loading' {
    const cardObj = this._cardObj;

    if (!cardObj) {
      // Check if fetch is pending
      if (this._pendingFetches && this._pendingFetches[this.card]) {
        return 'loading';
      }
      return 'not-found';
    }

    if (isGhostCard(cardObj)) {
      return 'ghost';
    }

    return 'loaded';
  }

  render() {
    return html`
      <a @click=${this._handleMouseClick}
         title='${this._titleText}'
         class='card
                ${this._cardState === 'ghost' ? 'ghost' : ''}
                ${this._cardState === 'loading' ? 'loading' : ''}
                ${this._cardState === 'loaded' ? 'exists' : ''}
                ${this._cardState === 'not-found' ? 'does-not-exist' : ''}'
         href='${this._computedHref}'>
        ${this._inner}
      </a>`;
  }

  _handleMouseClick(e: MouseEvent) {
    if (!this.card || !this._cardObj) return;

    // Handle ghost card click - fetch before navigating
    if (this._cardState === 'ghost') {
      e.preventDefault();
      store.dispatch(fetchCardOnDemand(this.card));
      return;
    }

    // Normal click handling...
  }
}

// CSS for ghost state
a.card.ghost {
  color: var(--app-secondary-color-light);
  opacity: 0.7;
  text-decoration-style: dotted;
}

a.card.ghost::after {
  content: " ↓";  /* Down arrow indicates "click to load" */
  font-size: 0.8em;
  opacity: 0.5;
}
```

### 3.3 Fetch-on-Demand Action

```typescript
// src/actions/data.ts - Promote ghost to full card

const pendingCardFetches: Map<CardID, Promise<Card | null>> = new Map();

export const fetchCardOnDemand = (cardID: CardID): ThunkSomeAction =>
  async (dispatch, getState) => {
    const state = getState();

    // Check if already loaded
    const card = getCardById(state, cardID);
    if (card && !isGhostCard(card)) {
      return; // Already have full card
    }

    // Check if fetch already in progress (deduplicate)
    if (pendingCardFetches.has(cardID)) {
      await pendingCardFetches.get(cardID);
      return;
    }

    // Mark fetch as pending
    dispatch({type: FETCH_CARD_ON_DEMAND, cardID});

    // Fetch from Firestore
    const fetchPromise = (async () => {
      try {
        const docRef = doc(db, CARDS_COLLECTION, cardID);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
          // Card doesn't exist - remove ghost
          dispatch({
            type: FETCH_CARD_ON_DEMAND_FAILURE,
            cardID,
            reason: 'not-found'
          });

          dispatch(removeGhostCard(cardID));
          return null;
        }

        const cardData = cardWithNormalizedTextProperties(
          docSnap.data(),
          selectFallbackTextMap(state),
          selectImportantNGrams(state)
        );

        // Success - promote ghost to full card
        dispatch({
          type: FETCH_CARD_ON_DEMAND_SUCCESS,
          cardID,
          card: cardData
        });

        dispatch(receiveCards({[cardID]: cardData}, 'on-demand'));

        return cardData;

      } catch (error) {
        console.error(`Failed to fetch card ${cardID}:`, error);

        dispatch({
          type: FETCH_CARD_ON_DEMAND_FAILURE,
          cardID,
          reason: 'error',
          error: error.message
        });

        return null;
      } finally {
        pendingCardFetches.delete(cardID);
      }
    })();

    pendingCardFetches.set(cardID, fetchPromise);
    await fetchPromise;
  };
```

---

## 4. Recent Edits Freshness Query

### 4.1 Architecture

Monitor the 250 most recently edited cards to catch changes to discovered cards:

```typescript
// src/actions/database.ts - Recent edits listener

let liveRecentEditsUnsubscribe: (() => void) | null = null;

export const connectLiveRecentEdits = () => {
  const state = store.getState() as State;
  if (!selectUserMayViewApp(state)) return;

  const featureFlags = state.data.featureFlags;
  if (!featureFlags.recentEditsListener) return;

  liveRecentEditsUnsubscribe = onSnapshot(
    query(
      collection(db, CARDS_COLLECTION),
      orderBy('updated_substantive', 'desc'),
      limit(250)  // Conservative; tune based on measured ops/card
    ),
    (snapshot) => {
      const cards: Cards = {};
      const cardIds: CardID[] = [];

      snapshot.docChanges().forEach(change => {
        if (change.type === 'removed') return;
        const doc = change.doc;
        const id: CardID = doc.id;
        const card: Card = {...doc.data({serverTimestamps: 'estimate'}), id} as Card;
        cards[id] = card;
        cardIds.push(id);
      });

      // Update recent edits set
      store.dispatch({
        type: RECENT_EDITS_UPDATE,
        cardIds
      });

      // Only update cards that are in discovered tier (not hot tier)
      store.dispatch(receiveCards(cards, 'recent_edits'));
    }
  );
};

export const disconnectLiveRecentEdits = () => {
  if (liveRecentEditsUnsubscribe) {
    liveRecentEditsUnsubscribe();
    liveRecentEditsUnsubscribe = null;
  }
};
```

### 4.2 Selective Update Logic

```typescript
// src/actions/data.ts - Filter recent_edits updates

export const receiveCards = (cards: Cards, fetchType: CardFetchType): ThunkSomeAction =>
  (dispatch, getState) => {
    const state = getState();
    const existingCards = selectRawCards(state);
    const cardsToUpdate: Cards = {};

    for (const card of Object.values(cards)) {
      // Special handling for recent_edits
      if (fetchType === 'recent_edits') {
        const hotTierIds = selectHotTierCardIds(state);
        const discoveredIds = selectDiscoveredCardIds(state);

        // Skip if card is in hot tier (already has dedicated listener)
        if (hotTierIds.has(card.id)) continue;

        // Only update if card is already in memory (discovered)
        if (!discoveredIds.has(card.id)) continue;

        // Check for actual changes
        if (existingCards[card.id] && deepEqualIgnoringTimestamps(existingCards[card.id], card)) {
          continue;
        }

        cardsToUpdate[card.id] = card;
      } else {
        // Normal card fetch
        if (existingCards[card.id] && deepEqualIgnoringTimestamps(existingCards[card.id], card)) {
          continue;
        }
        cardsToUpdate[card.id] = card;
      }
    }

    const pendingModifications = selectPendingModificationCount(state);
    if (pendingModifications === 0) {
      dispatch(updateCards(cardsToUpdate, fetchType));
    }
    dispatch(enqueueCardUpdates(cardsToUpdate, fetchType));
  };
```

### 4.3 Cost Analysis

```
Single user:
- Recent edits listener: 1 listener monitoring 250 cards
- Incremental reads: ~1 read per edit in top-250
- Typical edits/day: 5-20 (power user)
- Monthly cost: 5-20 × 30 × $0.000006 = $0.0009-0.0036
- Negligible: <$0.01/month

10 active users:
- Each edit triggers updates for all users
- 10 edits/day × 10 users = 100 reads/day
- Monthly cost: 100 × 30 × $0.000006 = $0.018/month
- Still negligible: <$0.02/month
```

---

## 5. Field Selection and Two-Phase Fetch

### 5.1 Architecture (Revised)

**Key Finding**: Firestore Enterprise `select()` doesn't reduce read costs, only network transfer. Revised strategy uses two-phase ID fetch via aggregation.

```typescript
// src/actions/enterprise_query.ts - Two-phase query

/**
 * Phase 1: Execute filter and return count + matching card IDs
 */
export const executePhase1Query = async (
  filters: Filter[],
  userId: Uid
): Promise<{count: number, ids: CardID[], timestamp: number}> => {

  // Translate filters to Pipeline where() expressions
  const whereExpressions = translateFiltersToWhereExpressions(filters, userId);

  // Execute aggregation query for count + IDs
  const result = await db.pipeline()
    .collection(CARDS_COLLECTION)
    .where(whereExpressions)
    .aggregate(
      expr.count(expr.field("*")).as("count"),
      expr.collect(expr.field("__name__")).as("ids")
    )
    .execute();

  return {
    count: result.count,
    ids: result.ids,
    timestamp: Date.now()
  };
};

/**
 * Phase 2: Fetch full card documents for specific IDs (batch)
 */
export const executePhase2Batch = async (
  cardIds: CardID[],
  offset: number,
  batchSize: number
): Promise<{cards: Cards, batchOffset: number, batchSize: number}> => {
  const batchIds = cardIds.slice(offset, offset + batchSize);

  if (batchIds.length === 0) {
    return {cards: {}, batchOffset: offset, batchSize: 0};
  }

  // Batch fetch full documents
  const docs = await db.pipeline()
    .documents(batchIds.map(id => db.collection(CARDS_COLLECTION).doc(id)))
    .execute();

  const cards: Cards = {};
  docs.forEach(doc => {
    if (doc.exists) {
      cards[doc.id] = doc.data() as Card;
    }
  });

  return {
    cards,
    batchOffset: offset,
    batchSize: batchIds.length
  };
};
```

### 5.2 Progressive Fetch Strategy

```typescript
// src/collection_description.ts - Progressive loading

async filteredCards(): Promise<CollectionResultTwoPhase> {
  // Try hot tier first (optimistic)
  if (this.hotTier.canAnswer(this.filterChain)) {
    const hotCards = this.hotTier.getAll();
    const filtered = this._applyFiltersLocally(hotCards);

    this.hotTier.recordBatchAccess(filtered.slice(0, 50).map(c => c.id));

    return {
      count: filtered.length,
      cards: filtered.slice(0, 50),
      preview: false,
      completeness: {
        totalMatched: filtered.length,
        loaded: Math.min(50, filtered.length),
        isComplete: filtered.length <= 50
      },
      phase: 'phase2-complete'
    };
  }

  // Hot tier insufficient, execute two-phase query
  return this._executeTwoPhaseQuery();
}

private async _executeTwoPhaseQuery(): Promise<CollectionResultTwoPhase> {
  // Phase 1: Get count + all matching IDs
  const phase1 = await executePhase1Query(this.filterChain, this.userId);

  // Identify cards already in hot tier
  const hotTierIds = new Set(this.hotTier.getAllIds());
  const missingIds = phase1.ids.filter(id => !hotTierIds.has(id));

  // Phase 2: Fetch first batch of missing cards
  const initialBatchSize = 50;
  const phase2 = await executePhase2Batch(missingIds, 0, initialBatchSize);

  // Merge with hot tier cards
  const allCards = {
    ...Object.fromEntries(
      phase1.ids.slice(0, initialBatchSize)
        .map(id => [id, this.hotTier.get(id) || phase2.cards[id]])
        .filter(([_, card]) => card)
    )
  };

  // Start background prefetch for next batch
  if (missingIds.length > initialBatchSize) {
    this._schedulePrefetch(missingIds, initialBatchSize, initialBatchSize);
  }

  return {
    count: phase1.count,
    cards: Object.values(allCards),
    preview: missingIds.length > 0,
    completeness: {
      totalMatched: phase1.count,
      loaded: Object.keys(allCards).length,
      percentLoaded: (Object.keys(allCards).length / phase1.count) * 100,
      isComplete: phase1.count <= initialBatchSize
    },
    phase: missingIds.length === 0 ? 'phase2-complete' : 'phase2-partial'
  };
}
```

### 5.3 Cost Estimate

```
Phase 1: Count + IDs for 30k cards
- Operations: 30,000 reads (full document scan)
- Cost: 30,000 / 100,000 × $0.06 = $0.018 per query

Phase 2: Fetch first 50 cards
- Operations: 50 reads
- Cost: 50 / 100,000 × $0.06 = $0.00003 per query

Total: $0.01803 per explicit search
Monthly (10 searches/day): 10 × 30 × $0.018 = $5.40

With hot tier hit rate (85%):
- Only 15% queries need server
- Monthly: $5.40 × 0.15 = $0.81/month
```

---

## 6. Filter Decomposition and Intelligent Splitting

### 6.1 Filter Classification

```typescript
// src/filter_analyzer.ts - Filter capability analysis

enum FilterCapability {
  FULL_SERVER = 'full-server',    // 100% server-executable
  HYBRID = 'hybrid',               // Server pre-filter + client scoring
  CLIENT_ONLY = 'client-only',     // Requires client-side data
  COMPOSITIONAL = 'compositional'  // Depends on sub-filters
}

const FILTER_CLASSIFICATIONS = {
  // FULL_SERVER (40%)
  'published': FilterCapability.FULL_SERVER,
  'section': FilterCapability.FULL_SERVER,
  'tag': FilterCapability.FULL_SERVER,
  'author': FilterCapability.FULL_SERVER,
  'date': FilterCapability.FULL_SERVER,
  'card-type': FilterCapability.FULL_SERVER,

  // HYBRID (20%)
  'query': FilterCapability.HYBRID,  // Server: token match, Client: TF-IDF scoring
  'similar': FilterCapability.HYBRID, // Server: candidates, Client: embeddings

  // CLIENT_ONLY (40%)
  'references': FilterCapability.CLIENT_ONLY,  // BFS graph traversal
  'children': FilterCapability.CLIENT_ONLY,
  'descendants': FilterCapability.CLIENT_ONLY,
  'expand': FilterCapability.CLIENT_ONLY,
  'exclude': FilterCapability.CLIENT_ONLY,
  'about-concept': FilterCapability.CLIENT_ONLY,

  // COMPOSITIONAL
  'combine': FilterCapability.COMPOSITIONAL,
};
```

### 6.2 Hybrid Execution Strategy

```typescript
// src/hybrid_filter_executor.ts - Coordinated execution

export class HybridFilterExecutor {
  async execute(
    collectionDescription: CollectionDescription,
    extras: FilterExtras
  ): Promise<HybridExecutionResult> {

    // Step 1: Analyze filter chain
    const analysis = new FilterAnalyzer().analyzeFilterChain(
      collectionDescription.filters,
      extras
    );

    // Step 2: Check if hot tier sufficient
    if (this.hotTier.canAnswerWith(analysis)) {
      return this.executeClientOnly(collectionDescription, extras, 'hot-tier');
    }

    // Step 3: Route based on capability
    switch (analysis.decomposition.strategy) {
      case 'server-only':
        return this.executeServerOnly(collectionDescription, analysis, extras);

      case 'client-only':
        return this.executeClientOnly(collectionDescription, extras, 'hot-tier');

      case 'hybrid':
        return this.executeHybrid(collectionDescription, analysis, extras);

      case 'fallback':
        return this.executeClientOnly(collectionDescription, extras, 'hot-tier');
    }
  }

  private async executeHybrid(
    description: CollectionDescription,
    analysis: FilterAnalysis,
    extras: FilterExtras
  ): Promise<HybridExecutionResult> {

    // Phase 1: Execute server pre-filter
    const serverQuery = this.queryBuilder.buildQuery(
      {
        ...analysis.decomposition,
        clientFilters: []  // Only server filters
      },
      extras
    );

    const snapshot = await getDocs(serverQuery);
    const candidateIDs = snapshot.docs.map(doc => doc.id);

    // Fetch candidate cards
    const candidateCards = await this.fetchCards(candidateIDs);

    // Phase 2: Apply client filters to candidates
    const clientFilters = analysis.decomposition.clientFilters;
    const refinedCollection = new CollectionDescription(
      description.set,
      clientFilters,
      description.sort,
      description.sortReversed
    ).collection({
      ...extras,
      cards: Object.fromEntries(candidateCards.map(c => [c.id, c]))
    });

    const finalCards = refinedCollection.filteredCards;

    // Expand hot tier with final results
    await this.hotTier.expand(finalCards.map(c => c.id));

    return {
      count: finalCards.length,
      cards: finalCards,
      source: 'hybrid',
      coverage: {
        searchedCards: candidateIDs.length,
        totalCards: 30000,
        isComplete: true,
        disclaimer: `Searched ${candidateIDs.length} candidates from 30,000 cards`
      }
    };
  }
}
```

### 6.3 Query Filter: 5-Tier Hybrid Scoring

```typescript
// Query filter is HYBRID: server matches tokens, client scores

// Tier 1: Server pre-filtering (reduce 30k → ~500 candidates)
const preparedQuery = new PreparedQuery(queryText);
const tokens = preparedQuery.stemmedTokens;

const serverQuery = query(
  collection(db, CARDS_COLLECTION),
  where('nlp_tokens', 'array-contains-any', tokens.slice(0, 30))
);

// Tier 2-5: Client-side scoring on candidates
// - Exact phrase matching
// - TF-IDF scoring
// - Inbound link boosting
// - Semantic similarity

const scoredResults = candidateCards.map(card => {
  const [score, fullMatch] = preparedQuery.cardScore(card);
  return {card, score, fullMatch};
}).sort((a, b) => b.score - a.score);
```

---

## 7. Redux State Structure

### 7.1 Complete State Schema

```typescript
// src/types.ts - Enhanced DataState

export interface DataState {
  // Existing fields...
  cards: Cards;
  authors: AuthorsMap;
  sections: Sections;
  tags: Tags;
  slugIndex: {[slug: Slug]: CardID};

  // NEW: Tier management
  tiers: {
    // Three hot tiers
    hotPublishedIds: Set<CardID>;
    hotPrioritizedIds: Set<CardID>;
    hotRecentUnpublishedIds: Set<CardID>;

    // Discovered cards (WARM tier)
    discoveredIds: Set<CardID>;

    // Ghost cards (COLD tier preview data)
    ghostCards: {[id: CardID]: GhostCard};

    // Tier configurations
    hotPublished: TierConfig;
    hotPrioritized: TierConfig;
    hotRecentUnpublished: TierConfig;

    // Total memory estimate
    estimatedMemoryUsage: number;  // MB

    // Eviction state
    evictionInProgress: boolean;
  };

  // NEW: Per-card metadata
  cardMetadata: {
    [id: CardID]: {
      lastAccessed: number;
      accessCount: number;
      firstLoaded: number;
      discoveryMethod: DiscoveryMethod;
      tier: 'HOT_PUBLISHED' | 'HOT_PRIORITIZED' | 'HOT_RECENT_UNPUBLISHED' | 'WARM' | 'COLD' | 'GHOST';
      lastSyncedAt: number;
      fresh: boolean;
    }
  };

  // NEW: Recent edits tracking
  recentEditsEnabled: boolean;
  recentEditsCardIds: Set<CardID>;

  // NEW: Feature flags
  featureFlags: {
    intelligentHotTier: boolean;
    discoveredCards: boolean;
    evictionPolicy: boolean;
    recentEditsListener: boolean;
    fieldSelection: boolean;
    filterDecomposition: boolean;
  };
}
```

### 7.2 Key Selectors

```typescript
// src/selectors.ts - Tier query selectors

export const selectHotTierCardIds = createSelector(
  selectTiers,
  (tiers): Set<CardID> => {
    const combined = new Set<CardID>();
    tiers.hotPublishedIds.forEach(id => combined.add(id));
    tiers.hotPrioritizedIds.forEach(id => combined.add(id));
    tiers.hotRecentUnpublishedIds.forEach(id => combined.add(id));
    return combined;
  }
);

export const selectDiscoveredCardIds = createSelector(
  selectTiers,
  (tiers) => tiers.discoveredIds
);

export const selectGhostCards = createSelector(
  selectTiers,
  (tiers) => tiers.ghostCards
);

export const selectCardTier = (state: State, cardId: CardID): string => {
  const tiers = selectTiers(state);
  if (tiers.hotPublishedIds.has(cardId)) return 'HOT_PUBLISHED';
  if (tiers.hotPrioritizedIds.has(cardId)) return 'HOT_PRIORITIZED';
  if (tiers.hotRecentUnpublishedIds.has(cardId)) return 'HOT_RECENT_UNPUBLISHED';
  if (tiers.discoveredIds.has(cardId)) return 'WARM';
  if (tiers.ghostCards[cardId]) return 'GHOST';
  return 'COLD';
};

export const selectMemoryUsage = createSelector(
  selectTiers,
  selectRawCards,
  selectCardMetadata,
  (tiers, cards, metadata): number => {
    // 10KB per full card, 0.5KB per ghost, 0.5KB per metadata
    const fullCardCount = Object.keys(cards).length;
    const ghostCardCount = Object.keys(tiers.ghostCards).length;
    const metadataCount = Object.keys(metadata).length;

    return (fullCardCount * 10 + ghostCardCount * 0.5 + metadataCount * 0.5) / 1024; // MB
  }
);
```

---

## 8. Migration Strategy

### Phase 1: Add Metadata Structures (Week 1-2)
**Goal**: Add new state structures without changing behavior

- Add `tiers`, `cardMetadata`, `featureFlags` to `DataState`
- Create new action types and reducers
- Add persistence layer (IndexedDB)
- Feature flag: `intelligentHotTier` (default: false)

### Phase 2: Implement Multi-Tier Hot Tier (Week 3-4)
**Goal**: Split existing hot tier into three tiers

- Modify `connectLivePublishedCards` to populate `HOT_PUBLISHED`
- Modify `connectLiveUnpublishedCards` to populate `HOT_RECENT_UNPUBLISHED`
- Implement `HOT_PRIORITIZED` tier (empty initially)
- Feature flag: `intelligentHotTier` (opt-in)

### Phase 3: Add Discovered Cards (Week 5-6)
**Goal**: Track discovered cards separately from hot tier

- Add `DISCOVER_CARDS_BATCH` action to search/filter results
- Implement discovered tier selectors
- Update `Collection._makeFilteredCards` to check discovered tier
- Feature flag: `discoveredCards` (opt-in)

### Phase 4: Enable Eviction Policy (Week 7-8)
**Goal**: Automatically evict cold cards from discovered tier

- Implement eviction middleware
- Add LRU/LFU hybrid scoring
- Create ghost cards for evicted cards with references
- Feature flag: `evictionPolicy` (opt-in)

### Phase 5: Add Recent Edits Listener (Week 9-10)
**Goal**: Keep discovered cards fresh

- Implement `connectLiveRecentEdits`
- Add `RECENT_EDITS_UPDATE` action
- Update discovered card metadata on edits
- Feature flag: `recentEditsListener` (opt-in)

### Phase 6: Add Ghost Cards (Week 11-12)
**Goal**: Support minimal card previews for evicted cards

- Implement ghost card structure
- Add three-state card-link rendering
- Promote ghost to full on user interaction
- Feature flag: `fieldSelection` (opt-in)

### Phase 7: Enable Filter Decomposition (Week 13-14)
**Goal**: Optimize filter execution with tier awareness

- Enhance `Collection._makeFilteredCards` with tier checking
- Implement hot tier sufficiency detection
- Add hybrid filter executor
- Feature flag: `filterDecomposition` (gradual rollout)

---

## 9. Cost Analysis

### Optimistic Scenario (95% hot tier hit rate)

```
Single power user:
- 10 explicit searches/day × 5% server rate = 0.5 server queries/day
- 500 navigation collections/day × 5% server rate = 25 server queries/day
- Total: 25.5 server queries/day

Monthly cost:
- Phase 1: 25.5 × 30 × 60 reads = 45,900 reads = $0.028/month
- Phase 2: 25.5 × 30 × 200 reads (expansion) = 153,000 reads = $0.092/month
- Recent edits: <$0.01/month
Total: $0.12/month
```

### Realistic Scenario (85% hot tier hit rate)

```
Single power user:
- 510 collections/day × 15% server rate = 76.5 server queries/day

Monthly cost:
- Phase 1: 76.5 × 30 × 60 = 137,700 reads = $0.083/month
- Phase 2: 76.5 × 30 × 150 reads (avg expansion) = 344,250 reads = $0.207/month
- Recent edits: <$0.01/month
Total: $0.29/month
```

### Cold Start Scenario (50% hot tier hit rate, first week)

```
First week:
- 510 collections/day × 50% server rate = 255 server queries/day
- Phase 1: 255 × 7 × 60 = 107,100 reads = $0.064
- Phase 2: 255 × 7 × 200 reads = 357,000 reads = $0.214
Total: $0.28/week

After week 1, hot tier converges to 85-95% hit rate, cost drops to $0.12-0.29/month
```

---

## 10. Implementation Files

### New Files (~3,200 LOC)

**Core Infrastructure:**
- `src/hot_tier_config.ts` (~150 LOC) - Multi-tier configuration
- `src/discovered_cards/eviction.ts` (~200 LOC) - LRU/LFU hybrid scoring
- `src/discovered_cards/eviction_manager.ts` (~300 LOC) - Background eviction
- `src/actions/enterprise_query.ts` (~400 LOC) - Two-phase query execution
- `src/filter_analyzer.ts` (~400 LOC) - Filter classification
- `src/hybrid_filter_executor.ts` (~500 LOC) - Hybrid execution coordinator
- `src/persistence/tier_cache.ts` (~200 LOC) - IndexedDB persistence

**Middleware:**
- `src/middleware/eviction.ts` (~200 LOC) - Eviction sweeper
- `src/middleware/staleness.ts` (~150 LOC) - Staleness checker
- `src/middleware/memory.ts` (~150 LOC) - Memory monitor

**Components:**
- `src/components/hot-tier-config-dialog.ts` (~250 LOC) - Configuration UI
- `src/components/memory-dashboard.ts` (~200 LOC) - Metrics display

**Monitoring:**
- `src/monitoring/metrics.ts` (~200 LOC) - Performance tracking
- `src/monitoring/alerts.ts` (~100 LOC) - Alert thresholds

### Modified Files (~1,200 LOC)

- `src/types.ts` (+200 LOC) - New state structures
- `src/reducers/data.ts` (+300 LOC) - Tier and metadata reducers
- `src/actions/data.ts` (+200 LOC) - Discovery and eviction actions
- `src/actions/database.ts` (+200 LOC) - Multi-tier listeners, recent edits
- `src/collection_description.ts` (+200 LOC) - Tier-aware filtering
- `src/selectors.ts` (+100 LOC) - Tier query selectors

**Total**: ~4,400 LOC

---

## 11. Summary

**Approach 2 (Intelligent Hot Tier)** optimizes for the common case:

1. **Multi-tier hot tier** (5-10k cards): Published + Prioritized + Recent Unpublished
2. **Discovered cards** (WARM tier): Smart LRU/LFU eviction with discovery-method weighting
3. **Ghost cards**: Distinguish "not loaded" from "doesn't exist", 95% memory savings
4. **Recent edits listener**: 250 most recently edited cards for discovered card freshness
5. **Field selection**: Two-phase ID fetch → progressive loading
6. **Filter decomposition**: 40% server-capable, 20% hybrid, 40% client-only
7. **Cost**: $0.12-0.66/month for single power user

**Choose this approach if you value**:
- Best-case latency (instant for 95% of queries)
- Adaptive optimization (learns from usage patterns)
- Cost efficiency (minimal server queries with intelligent expansion)
- Offline-first (hot tier always works)
- Ghost cards for instant navigation previews

**Trade-offs**:
- More complex than server-first (tier management, eviction)
- Variable memory usage (8-10k hot + 0-5k discovered)
- Requires warmup period (first week 50% → 85-95% hit rate)
- Staleness indicators for cards outside recent edits window
