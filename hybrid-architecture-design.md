# Hybrid Architecture Design: Client + Server Search and Links

## Status: Work in Progress

This document outlines the design for a hybrid architecture that allows the card-web application to work with large card collections (50k+ cards) while maintaining the benefits of client-side performance for downloaded cards.

## Problem Statement

The current architecture assumes all visible cards are downloaded to the client. This worked well when the database was small, but now with 50k+ cards in production:

### Primary Problem: Client-Side Performance Degradation
- **Editing became really slow**: Saving cards takes several seconds
- **Card creation sluggish**: Creating new cards has noticeable lag
- **Navigation delays**: Moving between cards has UI freezes
- **Memory pressure**: 50k cards in memory causes GC pauses

**Root cause**: Many O(n) operations run on every state change:
- NLP processing and stemming on all cards (selector recomputation)
- Inbound reference updates touching many cards on save
- Collection filtering/sorting over 50k cards repeatedly
- Multiple selectors iterating over all cards

### Secondary Problems from Limited Snapshot Workaround
The current workaround (only download published + recent unpublished cards) breaks features:
1. **Search**: Can only search cards that are downloaded
2. **Links**: Links to cards not in the snapshot appear broken (non-functional)
3. **References**: Reference blocks incomplete if referenced cards aren't downloaded
4. **Navigation**: Cannot navigate to cards that aren't in the client store

## Design Constraints

1. **Simplest change possible**: Minimize complexity and maintain current architecture where feasible
2. **No new servers**: Only use Firebase Functions (already deployed)
3. **No huge server component**: Server should be lightweight, not reimplementing all client logic
4. **Progressive enhancement**: Features should work better when cards are local, but still work for remote cards
5. **Performance**: Don't regress performance for cards that are already downloaded

---

## Architecture Investigation

### Current State Summary

**Card Loading:**
- All published cards fetched via live listener (no limit)
- Recent unpublished cards fetched (default limit: 5000, max: 10000)
- Cards stored in Redux store: `state.data.cards`
- Firestore local cache provides offline support
- "Complete mode" toggle to fetch all vs recent unpublished cards

**Search:**
- 100% client-side full-text search
- Uses custom PreparedQuery with Porter Stemmer
- Fields searched: title, body, subtitle, references_info_inbound, etc.
- Optional semantic search via OpenAI embeddings (requires AI permissions)
- No third-party search service (no Algolia, Elasticsearch, etc.)
- O(n) scan of all cards in memory for every search

**Links and References:**
- Links to non-existent cards styled as plain text (`javascript:void(0)` href)
- When navigating to a card not in store, `fetchCard()` fetches that specific card
- `fetchCardLinkCardsForFetchedCard()` fetches all substantive references from that card
- Bidirectional reference tracking: `references_info` (outbound) and `references_info_inbound`
- Reference blocks display related cards (backlinks)

**Key Files:**
- `src/actions/database.ts` - Firebase live listeners
- `src/actions/data.ts` - Card receive/remove actions
- `src/actions/app.ts` - Card fetching and navigation
- `src/components/card-link.ts` - Link rendering
- `src/filters.ts`, `src/nlp.ts` - Search implementation
- `src/references.ts` - Reference management

---

## Design Options

### Option 1: Lightweight Card Metadata + On-Demand Full Cards

**Concept**: Download lightweight metadata for all cards, but only fetch full card content on demand.

**Architecture**:
1. **Card Metadata Collection**: Store minimal info for all 50k cards in client
   - Card ID, slug, title, section, tags, published status
   - Reference counts (inbound/outbound)
   - Modified/created timestamps
   - ~500 bytes per card = ~25MB for 50k cards

2. **Full Card Store**: Keep only actively-used full cards (~1000-5000)
   - Current viewing path
   - Recently edited cards
   - Cards in search results being displayed
   - Cards with expanded reference blocks

3. **Lazy Loading**: Fetch full cards when needed
   - Navigation triggers fetchCard() (already exists)
   - Search returns metadata, fetches top N results
   - Link hover prefetches card
   - Reference blocks fetch on expand

**Client-Side Changes**:
- New Redux state: `cardMetadata` (all 50k) separate from `cards` (subset)
- Selectors check metadata first, fetch full card if needed
- Search operates on metadata fields, fetches results
- Link rendering checks metadata for existence, shows clickable even if not loaded
- Collection operations use metadata for filtering/sorting

**Server-Side Changes** (Firebase Functions):
- `searchCards(query, limit)`: Full-text search returning card IDs
- `fetchCardBatch(cardIDs[])`: Fetch multiple cards efficiently
- Optional: `quickSearch(query)` using Firestore indexes for simple queries

**Performance Impact**:
- ✅ Solves primary problem: Only 1000-5000 full cards in memory
- ✅ Selectors operate on much smaller dataset
- ✅ NLP processing only on loaded cards
- ✅ Reference updates only touch loaded cards
- ⚠️ Search requires server-side component
- ⚠️ Additional complexity: two-tier card storage
- ⚠️ Navigation slightly slower (fetch delay)

**Complexity**: Medium - Requires significant refactoring of selectors and state management

---

### Option 2: Server-Side Search + Client-Side Everything Else

**Concept**: Keep current architecture, but move ONLY search to server.

**Architecture**:
1. **Current loading stays the same**: Download limited snapshot (~5000 cards)
2. **Search delegated to server**: Firebase Function with full-text search
3. **Search results trigger loading**: Server returns card IDs, client fetches those cards
4. **Links remain as-is**: Non-loaded cards show as non-functional
5. **Add "Load Card" action**: Manual way to load a specific card by ID/slug

**Server-Side Changes** (Firebase Functions):
- `searchCards(query, options)`:
  - Uses Firestore full-text search or Algolia integration
  - Returns: `{results: [{cardID, title, snippet, score}], hasMore: boolean}`
  - Supports pagination
- Alternative: Leverage existing `embeddings.ts` semantic search more prominently

**Client-Side Changes**:
- New action: `serverSearch(query)` -> fetches results -> loads cards
- Find dialog updated to use server search
- Result cards automatically added to store after search
- Minimal other changes

**Performance Impact**:
- ✅ Solves search limitation
- ✅ Minimal changes to existing architecture
- ✅ Client performance unchanged (still limited snapshot)
- ❌ Doesn't solve broken links problem
- ❌ Doesn't solve incomplete reference blocks
- ❌ Search has network latency vs instant client-side

**Complexity**: Low - Single focused change

---

### Option 3: Smart Card Eviction + Aggressive Caching

**Concept**: Allow loading all cards but intelligently evict old ones to keep working set small.

**Architecture**:
1. **Start with limited snapshot** (~5000 recent/published)
2. **Load cards on demand** (navigation, search hits, links)
3. **LRU eviction**: When store exceeds threshold (e.g., 10k cards), evict least recently used
4. **Pin important cards**: Keep currently visible, recently edited, and user's own cards
5. **IndexedDB persistence**: Store evicted cards locally for instant reload

**Client-Side Changes**:
- New action: `cullUnusedCards(threshold)` - removes LRU cards from Redux store
- Track access time per card: `lastAccessedTimestamp`
- Trigger culling when `Object.keys(state.data.cards).length > THRESHOLD`
- IndexedDB layer for evicted card cache
- Selectors skip evicted cards (marked with flag)

**Server-Side Changes**:
- None required (uses existing fetchCard)

**Performance Impact**:
- ✅ Keeps working set small (<=10k cards)
- ✅ Frequently used cards stay in memory (fast)
- ✅ Minimal server changes
- ⚠️ Selectors still process all in-memory cards
- ⚠️ Eviction adds complexity
- ⚠️ Search still limited to in-memory cards
- ❌ Doesn't fundamentally solve the O(n) selector problem

**Complexity**: Medium - Eviction logic, IndexedDB integration, access tracking

---

### Option 4: Hybrid Metadata + Selector Optimization (Recommended)

**Concept**: Combine lightweight metadata with targeted performance optimizations to address root cause.

**Architecture**:
1. **Two-tier card storage** (like Option 1):
   - Metadata for all 50k cards
   - Full content for active subset (~2000-5000 cards)

2. **Aggressive selector optimization**:
   - Memoize expensive operations (NLP, concept extraction) at card level
   - Incremental updates: Only reprocess changed cards
   - Move `possibleMissingConcepts` to background worker
   - Lazy NLP: Only process cards when actually searched

3. **Batched reference updates**:
   - Queue inbound link updates instead of immediate writes
   - Debounce and batch multiple reference changes
   - Update only affected cards (not full scan)

4. **Server-side search fallback**:
   - Client-side search on loaded cards (instant)
   - Server-side search for cards not loaded (fallback)
   - Merge results seamlessly

**Client-Side Changes**:
- Card metadata structure: `{id, slug, title, section, tags, published, referenceCount}`
- Split selectors: metadata-based vs content-based
- Memoize NLP at per-card level (not all-cards recomputation)
- Web Worker for expensive operations (missing concepts, embeddings)
- Batched reference update queue with debouncing
- Search checks loaded cards first, falls back to server

**Server-Side Changes** (minimal):
- `searchCards(query, options)`: Simple full-text search on title/body
- `getCardMetadata()`: Return metadata for all/filtered cards (one-time load)
- Optional: `batchFetchCards(ids[])`: Multi-get optimization

**Performance Impact**:
- ✅✅ Addresses root cause: Selector optimization reduces O(n) overhead
- ✅✅ Small working set: Only ~2000-5000 full cards loaded
- ✅ Search works everywhere (client + server)
- ✅ Links work (metadata knows existence)
- ✅ Progressive: Fast for loaded cards, still works for others
- ⚠️ Higher initial complexity but pays off long-term
- ⚠️ Requires careful refactoring of selectors

**Complexity**: Medium-High - Multiple changes but each addresses specific bottleneck

---

### Option 5: Move to Firestore Queries Only (Radical Simplification)

**Concept**: Stop maintaining client-side store entirely. Query Firestore directly on demand.

**Architecture**:
1. **No Redux card store**: Remove `state.data.cards`
2. **Component-level queries**: Each component queries Firestore directly
3. **Firestore caching**: Rely on Firestore's built-in offline cache
4. **Live listeners per-view**: Each card view has its own listener
5. **Search via Firestore**: Use Firestore queries with indexing

**Client-Side Changes**:
- Massive refactor: Remove Redux card state
- Convert all selectors to Firestore queries
- Use React hooks for data fetching (useCard, useCardCollection)
- Remove card-related actions and reducers

**Server-Side Changes**:
- Extensive Firestore indexes for common queries
- Possibly algolia or typesense integration for search

**Performance Impact**:
- ✅ No client-side performance issues (no large state)
- ✅ Always up-to-date data
- ❌❌ Breaks offline-first architecture
- ❌❌ Massive refactor (thousands of lines changed)
- ❌ Network latency on every operation
- ❌ Loses sophisticated client-side filtering/sorting

**Complexity**: Extreme - Complete architecture rewrite

---

---

## Special Consideration: The Collection System

### Collection Architecture Power and Complexity

The webapp's **Collection system** is a core feature that enables declarative, composable queries with:
- **Graph operations**: ancestors/descendants with N-hop traversal
- **Set operations**: union, intersection, complement
- **Embedding similarity**: semantic search with Qdrant
- **Complex filters**: 30+ configurable filter types that can nest arbitrarily
- **Examples**: `exclude/combine/similar/ancestors:5/query/...`

**Current requirement**: All cards must be loaded in memory because:
1. Graph traversal needs complete reference graph
2. Set operations (especially complement) need universe of cards
3. Filters can reference `{self}` (current card context)
4. Collections maintain stable snapshots during editing ("ghosting")
5. Pagination requires sorting entire filtered set first

**Challenge**: Collections like `/everything/working-notes` contain 40k+ items. Loading all of them defeats the purpose of limiting downloads.

### Hybrid Collection Strategy

The key insight: **We need a two-level Collection system**

#### Level 1: Card ID Collections (Lightweight)

**Concept**: Collection logic operates on card IDs only, not full card content.

**New Data Structure**:
```typescript
// Reference types: link, see-also, concept, synonym, citation, example-of, etc.
// Filters query by specific types: referencesFilter('inbound', 'concept')

interface CardStub {
  id: CardID;
  slug: string;
  title: string;
  section: SectionID;
  tags: TagID[];
  published: boolean;
  author: UserID;
  created: Timestamp;
  updated: Timestamp;

  // CRITICAL: Reference graph BY TYPE (for Collection filters)
  // Filters need to query specific reference types
  // e.g., referencesFilter('inbound', 'concept') needs concept-type refs only
  references: {[type: ReferenceType]: CardID[]};           // Outbound by type
  referencesInbound: {[type: ReferenceType]: CardID[]};    // Inbound by type

  // Examples:
  // references: {
  //   'link': ['card-abc', 'card-def'],
  //   'concept': ['card-xyz'],
  //   'see-also': ['card-123', 'card-456']
  // }
  // referencesInbound: {
  //   'link': ['card-789'],
  //   'citation': ['card-paper-1']
  // }

  // Metadata for filtering
  cardType: CardType;
  starred: boolean;
  // For sorting
  sortOrder: number;
}

// Redux state
interface DataState {
  cardStubs: {[id: CardID]: CardStub};  // ALL 50k cards (~100 bytes each = 5MB)
  cards: {[id: CardID]: Card};          // Subset of full cards loaded (~2k-5k)
  // ...
}
```

**What this enables**:
- **Typed graph traversals**: Can follow specific reference types on stubs
  - `referencesFilter('inbound', 'concept')` → only concept references
  - `referencesFilter('outbound', ['citation', 'citation-person'])` → multiple types
  - `referencesFilter('both', 'see-also', {ply: 5})` → 5-hop see-also graph
- **Set operations**: Union/intersection/complement work on ID sets
- **Filtering**: Most filters only need stub metadata (section, tags, cardType, etc.)
- **Sorting**: Can sort by metadata fields (created, updated, sortOrder)
- **Pagination**: Can compute which IDs match, then fetch only visible page

**Size calculation**:
- Base metadata: ~50 bytes
- Reference graph by type: ~10 types × 5 refs/type × 8 bytes = ~400 bytes worst case
- Average with compression: ~150 bytes per stub
- **50k stubs × 150 bytes = ~7.5MB** (vs 50k full cards × 5KB = 250MB)

#### Level 2: Paginated Full Card Loading

**Concept**: Once Collection determines which card IDs match, load full cards in pages.

**Flow**:
```
1. User navigates to /everything/working-notes
   ↓
2. CollectionDescription parsed from URL
   ↓
3. Collection.filterCardIDs(cardStubs) → [id1, id2, ..., id40000]
   - Operates on stubs only
   - Returns array of matching card IDs
   ↓
4. Collection.sortCardIDs(matchingIDs, cardStubs) → sorted IDs
   - Sorts by metadata (created, updated, title, etc.)
   - For complex sorts needing full content: mark as "needs full cards"
   ↓
5. Paginate: Take IDs 0-250 for first page
   ↓
6. Fetch full cards: fetchCardBatch([id1...id250])
   ↓
7. Display: Show full cards in UI
   ↓
8. User scrolls down → fetch next 250 IDs → repeat
```

**Pagination Strategy**:
```typescript
interface PaginatedCollection {
  description: CollectionDescription;
  allMatchingIDs: CardID[];        // All IDs that match filter (40k+)
  totalCount: number;               // Total matches
  pageSize: number;                 // e.g., 250
  currentPage: number;              // Current page index
  loadedPages: Set<number>;         // Which pages have been fetched
  fullyLoadedCardIDs: Set<CardID>; // Which cards have full content
}
```

### Which Filters Can Work on Stubs Only?

**✅ Works with stubs** (majority of filters):
- **Set filters**: main, reading-list, everything
- **Card type filters**: cardType check
- **Section/tag filters**: section/tags metadata
- **Date filters**: created/updated timestamps
- **Author filters**: author field
- **Boolean flags**: starred, published, etc.
- **Graph traversals**: references/referencesInbound structure
- **Set operations**: union, intersection, exclude (on ID sets)
- **Limit/offset**: pagination

**⚠️ Needs full cards** (minority):
- **Full-text search** (`query`, `query-strict`): Need body content
  - **Workaround**: Server-side search returns matching IDs
- **Embedding similarity** (`similar`): Need embeddings
  - **Workaround**: Server already has Qdrant, query it for IDs
- **Complex content-based filters**: Custom filters checking body/commentary
  - **Workaround**: Fetch affected cards on-demand

**Hybrid approach**: Collection first filters on stubs (fast), then for filters needing full content:
1. Fetch matching full cards (if count < 1000, just fetch them)
2. OR delegate to server-side computation
3. OR show "Loading..." and fetch progressively

### Server-Side Collection Execution (Optional Phase 3+)

For truly massive collections or complex queries, could move Collection logic server-side:

**Option A: Translate Collection to Firestore Queries**
- CollectionDescription → Firestore query composition
- Limited to Firestore's query capabilities (no arbitrary graph traversal)
- Good for simple filters: section, tags, cardType, date ranges

**Option B: Server-Side Collection Engine**
- Firebase Function receives CollectionDescription
- Executes same Collection logic on server
- Returns paginated card IDs
- Requires: card stubs in server memory or efficient DB queries

**Option C: Hybrid Execution**
- Client executes simple filters on stubs
- Server executes complex filters (search, similarity, deep graph)
- Merge results client-side

**Recommendation**: Start with client-side stub filtering (Phase 2), add server execution only if needed (Phase 3+).

### Migration Path for Large Collections

**Phase 2A: Add Card Stubs**
1. Load all card stubs (5MB download, one-time)
2. Keep existing Collection logic unchanged
3. Verify stubs are sufficient for most filters

**Phase 2B: Stub-Based Filtering**
1. Refactor filters to operate on stubs first
2. Add `requiresFullCard()` method to each filter
3. Collection.filterCardIDs() works on stubs
4. Fetch full cards only for final results

**Phase 2C: Pagination for Large Collections**
1. Detect when collection > threshold (e.g., 1000 cards)
2. Enable pagination mode: load 250 at a time
3. Infinite scroll loads next page
4. Cache loaded pages in Redux

**Phase 2D: Optimize Expensive Filters**
1. Full-text search: delegate to server
2. Similarity: query Qdrant directly for IDs
3. Complex filters: fetch cards in batches

### Example: /everything/working-notes Implementation

**Current (broken)**:
- Tries to load all 40k working-notes cards
- Client freezes/crashes
- Workaround: Don't load, collection is empty

**With stubs + pagination**:
```typescript
// 1. User navigates to /everything/working-notes
const description = new CollectionDescription(
  'everything',
  [cardTypeFilter('working-notes'), UNPUBLISHED_FILTER_NAME],
  'recent'
);

// 2. Filter on stubs (fast - 40k stubs in memory)
const allMatchingIDs = description.filterCardIDs(cardStubs);
// Returns: [id1, id2, ..., id40000] - just IDs, no full content

// 3. Sort by 'recent' (updated timestamp - available in stub)
const sortedIDs = description.sortCardIDs(allMatchingIDs, cardStubs);

// 4. Paginate - load first 250
const page1IDs = sortedIDs.slice(0, 250);
await dispatch(fetchCardBatch(page1IDs));

// 5. Display first page (250 cards with full content)
// UI shows: "Showing 1-250 of 40,127"

// 6. User scrolls down → load next page
const page2IDs = sortedIDs.slice(250, 500);
await dispatch(fetchCardBatch(page2IDs));
```

**Performance**:
- Initial filter: <100ms (40k stubs in memory)
- Sort: <50ms (sorting IDs by timestamp)
- Fetch first page: ~500ms (250 cards from Firestore)
- Total: ~650ms vs. "never completes"

### Technical Challenges and Solutions

**Challenge 1: Reference graph completeness with types**
- Graph traversal filters need complete reference structure BY TYPE
- Example: `referencesFilter('inbound', 'concept')` needs only concept-type inbound refs
- **Solution**: Include `references`/`referencesInbound` objects with type breakdown in stubs
- Size impact: ~100-400 bytes per card (depends on reference density)
- Most cards have <20 total references across all types
- Compression helps significantly (reference arrays compress well)

**Challenge 2: Sort by complex fields**
- Some sorts need full card content (e.g., sort by body length)
- **Solution**:
  - Include common sort fields in stubs (created, updated, title)
  - For rare complex sorts: fetch all matching cards (if count reasonable)
  - Or compute sort metadata server-side

**Challenge 3: Dynamic filters with {self}**
- Filters like `similar/{self}` depend on current card
- **Solution**: Fetch current card first, then execute filter on stubs

**Challenge 4: Maintaining "ghosting" during edits**
- Collections use snapshot of cards to prevent items disappearing during edits
- **Solution**: Maintain stub snapshots same way (lightweight)

**Challenge 5: Pagination UX**
- Need to show total count and allow jumping to pages
- **Solution**: Collection knows total count (from stub filtering), loads pages on demand

### Card Stub Generation

**Option A: Separate Firestore collection**
- Create `card_stubs` collection mirroring `cards`
- Firestore trigger updates stubs when cards change
- Denormalization overhead but most efficient

**Option B: Extract from full cards**
- Load cards as today, extract stubs client-side
- No denormalization but requires loading all cards once
- Hybrid: Load published stubs from server, extract unpublished locally

**Option C: Firebase Function endpoint**
- `getCardStubs(filter)` function returns all/filtered stubs
- Computes stubs on-demand from cards collection
- Slower but no denormalization

**Recommendation**: Start with Option B (extract from loaded cards), migrate to Option A if stubs prove valuable.

---

## Additional Design Considerations

### Consideration 1: Permissions and Privacy

**Current behavior** (must preserve):
- If user can't view a card, it's completely invisible
- Links to unpermitted cards look like plain text (not clickable)
- No evidence the card exists at all

**Challenge with stubs**:
- Stubs are lightweight, but still need permission filtering
- Can't send stubs for cards user can't view (privacy leak)
- Need to distinguish: "card exists but not loaded" vs "card doesn't exist/no permission"

**Solution: Permission-Filtered Stub Loading**

```typescript
// Stubs come pre-filtered by permissions server-side
interface StubLoadingStrategy {
  published: true,           // All published cards (public)
  unpublished: {
    author: uid,              // User's own unpublished cards
    permissions: uid,         // Cards where user has explicit permission
    recent: 5000             // Recent unpublished cards (if user can view app)
  }
}

// Client receives ONLY stubs for cards they can view
// Just like today, but lightweight
```

**Link rendering logic**:
```typescript
// In card-link component
get _shouldRenderAsLink() {
  const stub = this._cardStubs[this.card];
  const fullCard = this._cards[this.card];

  // Card exists in stubs = user has permission to view it
  // Render as link (clickable)
  if (stub || fullCard) return true;

  // No stub = either doesn't exist OR no permission
  // Render as plain text (not clickable) - current behavior preserved
  return false;
}
```

**Key insight**: Stubs obey same permission rules as full cards. User only receives stubs for cards they can view. Zero information leak.

**Implementation**:
1. Firestore query for stubs uses same permission filters as full cards
2. `published == true` OR `author == uid` OR `permissions.view_card contains uid`
3. Client never sees stub for unpermitted card
4. Link behavior remains identical to today

---

### Consideration 2: Immutability and Aggressive Caching

**Observation**: The vast majority of cards almost never change once created.

**Opportunity**: Leverage immutability for caching and performance.

**Strategy: Content-Addressed Caching with Firestore Versioning**

#### Approach A: Version-Based Caching (Recommended)

**Concept**: Track card versions, cache immutable snapshots.

```typescript
interface CardStub {
  id: CardID;
  slug: string;
  title: string;
  // ... other fields

  // NEW: Version tracking
  version: number;              // Increments on each edit
  lastModified: Timestamp;      // When it changed
  immutable: boolean;           // Flag for truly immutable cards
}

interface CachedCard {
  card: Card;
  version: number;
  cachedAt: Timestamp;
}
```

**Caching Strategy**:
```typescript
// IndexedDB cache keyed by (cardID, version)
const cardCache = {
  'card-abc:version-1': Card,
  'card-abc:version-2': Card,
  'card-xyz:version-1': Card,
}

// When fetching card
async function fetchCardWithCache(cardID: CardID, expectedVersion: number) {
  // 1. Check IndexedDB cache
  const cached = await indexedDB.get(`${cardID}:version-${expectedVersion}`);
  if (cached) return cached; // Instant load from cache

  // 2. Fetch from Firestore
  const card = await firestore.collection('cards').doc(cardID).get();

  // 3. Cache it (version-keyed, immutable)
  await indexedDB.put(`${cardID}:version-${card.version}`, card);

  return card;
}
```

**Benefits**:
- **Immutable cache entries**: Version-keyed cache never needs invalidation
- **Offline-first**: Cards stay cached indefinitely, work offline forever
- **Fast repeated access**: Second load of any card is instant (IndexedDB)
- **Bandwidth savings**: Never re-fetch unchanged cards
- **Storage-efficient**: Browser can cache 100MB+ easily (20k cards)

**Stub-based loading flow**:
```
1. Load all stubs (includes version numbers)
   ↓
2. User navigates to collection → need cards [id1, id2, ..., id250]
   ↓
3. Check cache for each: fetchCardWithCache(id1, stub.version)
   ↓
4. Cache hits: Instant load (0ms)
   Cache misses: Fetch from Firestore (~20ms each)
   ↓
5. Result: Mostly cached cards load instantly
```

**Cache invalidation**:
- Stub updates → version changes → cache key changes
- Old versions remain cached (no deletion needed)
- Browser automatically evicts old entries when storage full

**Size estimation**:
- 5KB per card × 20,000 cached cards = 100MB
- IndexedDB quota: Typically 50% of available disk (100GB+)
- Comfortable cache size: 10,000-50,000 cards

#### Approach B: Last-Modified Headers (HTTP-style)

**Concept**: Use Firestore's `updated` timestamp for conditional fetching.

```typescript
// Firestore allows reading only if document changed since timestamp
const cardRef = firestore.collection('cards').doc(cardID);

// Check if local cached card is still current
if (cachedCard.lastModified >= stub.lastModified) {
  return cachedCard; // Still fresh
}

// Otherwise fetch new version
const card = await cardRef.get();
```

**Benefits**:
- Simpler than versioning (no new fields needed)
- Works with existing `updated` timestamp

**Drawbacks**:
- Timestamp precision issues (millisecond vs second)
- Requires Firestore read to check freshness
- Cache invalidation more complex

**Recommendation**: Approach A (version-based) is cleaner and more efficient.

#### Approach C: Content-Addressed Storage (Radical)

**Concept**: Hash card content, store by content hash.

```typescript
interface CardStub {
  id: CardID;
  contentHash: string;  // SHA-256 of card body + metadata
  // ...
}

// Cache keyed by content hash (globally deduplicated)
const contentCache = {
  'sha256-abc123...': CardContent,
}
```

**Benefits**:
- Ultimate deduplication (identical content shared)
- Perfect immutability (content hash never lies)

**Drawbacks**:
- Requires computing hash server-side on every card write
- More complex architecture
- Probably overkill for this use case

**Recommendation**: Too complex, not needed.

---

### Immutability Flags for Published Cards

**Optimization**: Published cards rarely change (95%+ immutable).

**Enhancement to CardStub**:
```typescript
interface CardStub {
  // ... existing fields

  published: boolean;
  lastModified: Timestamp;
  version: number;

  // NEW: Immutability hint
  // Set to true for published cards older than 30 days with no edits
  likelyImmutable: boolean;
}
```

**Caching policy**:
```typescript
if (stub.likelyImmutable) {
  // Aggressive caching: keep in IndexedDB forever
  // Check for updates only on app refresh (not per session)
  cachePolicy = 'immutable';
} else if (stub.published) {
  // Published but recent: might still be edited
  // Revalidate every 24 hours
  cachePolicy = 'public, max-age=86400';
} else {
  // Unpublished: actively being worked on
  // Revalidate frequently (live listener)
  cachePolicy = 'no-cache';
}
```

**Expected cache hit rates**:
- **Published cards (old)**: 99% hit rate (truly immutable)
- **Published cards (recent)**: 90% hit rate (occasionally edited)
- **Unpublished cards**: 50% hit rate (frequently edited)
- **Overall**: ~85-90% of card fetches served from cache

**Performance impact**:
- First load: Same as today (fetch from Firestore)
- Second load: **Instant** (0ms from IndexedDB)
- Bandwidth: 90% reduction over time
- Offline: Works perfectly (cached cards available)

---

### Combined Strategy: Stubs + Versioned Caching + Pagination

**The full picture**:

```
1. App starts
   ↓
2. Load all card stubs (~5MB, includes version numbers)
   Stubs filtered by permissions (same as full cards today)
   ↓
3. User navigates to /everything/working-notes (40k stubs match)
   ↓
4. Collection.filterCardIDs(stubs) → [40,000 IDs]
   Collection.sortCardIDs(IDs) → sorted by 'recent'
   ↓
5. Need first 250 full cards
   ↓
6. For each ID: fetchCardWithCache(id, stub.version)
   - Check IndexedDB: cardCache[`${id}:v${version}`]
   - 90% cache hit → instant load (0ms)
   - 10% cache miss → fetch from Firestore (~20ms)
   ↓
7. Display first page in ~200ms
   (225 cached instantly + 25 fetched)
   ↓
8. User scrolls → load next 250 (mostly cached too)
```

**Result**:
- First visit: ~650ms (mostly fetches)
- Second visit: ~200ms (mostly cached)
- Subsequent visits: ~50ms (all cached)
- Offline: Works perfectly (stubs + cache)
- Bandwidth: 90% reduction

---

## Critical Analysis of Options

### Evaluation Criteria
1. **Addresses root cause**: Does it fix the O(n) performance problems?
2. **Minimal server complexity**: Avoids creating a heavy server-side component
3. **Implementation simplicity**: Feasible to implement without massive rewrites
4. **Fixes broken features**: Resolves search, links, and reference limitations
5. **Progressive enhancement**: Works better for loaded cards, still works for others

### Detailed Critique

**Option 1 (Metadata + On-Demand):**
- ❌ Doesn't address selector optimization - still runs O(n) on the full card subset
- ⚠️ 25MB metadata download is non-trivial (though one-time)
- ✅ Fixes links (metadata knows existence)
- ⚠️ Search still requires server component
- **Verdict**: Addresses symptoms but not root cause. Two-tier storage adds complexity without fixing selectors.

**Option 2 (Server-Side Search Only):**
- ❌ Doesn't solve performance problem at all
- ❌ Links remain broken
- ❌ References remain incomplete
- ✅ Minimal change, easy to implement
- **Verdict**: Band-aid solution. Doesn't justify the effort since it leaves major issues unsolved.

**Option 3 (Smart Eviction + Caching):**
- ❌ Doesn't address O(n) selector problem
- ⚠️ Eviction logic adds significant complexity
- ⚠️ IndexedDB sync can be tricky
- ❌ Search still limited
- **Verdict**: Adds complexity without solving root cause. LRU eviction is engineering overhead for limited benefit.

**Option 4 (Hybrid Metadata + Optimization):**
- ✅✅ Addresses root cause with selector optimization
- ✅✅ Card stubs enable Collection system to work with all cards
- ✅✅ Pagination for large collections (40k+ items now possible)
- ✅ Two-tier storage keeps working set small
- ✅ Server component is minimal (search only)
- ✅ Fixes all broken features (including large collections!)
- ⚠️ Most complex initially, but tackles real problems
- **Verdict**: Best long-term solution. Card stub approach is the key insight that makes Collections work.

**Option 5 (Firestore Queries Only):**
- ❌❌ Complete rewrite - violates "simplest change" constraint
- ❌ Breaks offline-first model
- ❌ Loses sophisticated client-side features
- **Verdict**: Nuclear option. Too radical for this problem.

---

## Recommended Approach

**Phased Implementation of Option 4 (Hybrid Metadata + Optimization)**

This approach balances addressing the root cause with incremental, manageable changes. Break it into three phases:

### Phase 1: Quick Wins - Selector Optimization (Weeks 1-2)

**Goal**: Reduce O(n) overhead without architectural changes.

**Changes**:
1. **Per-card NLP memoization** (src/nlp.ts, src/selectors.ts:434-446):
   - Cache stemmed text per card instead of recomputing all cards
   - Use WeakMap keyed by card object: `memoizedCardNLP.get(card)`
   - Only recompute when card content changes

2. **Batch reference updates** (src/actions/data.ts:436-451):
   - Queue inbound link updates instead of immediate Firestore writes
   - Debounce with 500ms delay
   - Batch multiple changes into single transaction

3. **Incremental selector updates**:
   - Track which cards changed in UPDATE_CARDS action
   - Only reprocess changed cards through expensive pipelines
   - Cache results for unchanged cards

**Expected Impact**: 50-70% reduction in save/edit lag with limited code changes.

**Risk**: Low - These are isolated optimizations that don't change architecture.

---

### Phase 2: Two-Tier Storage - Card Stubs (Weeks 3-6)

**Goal**: Introduce lightweight card stubs to enable Collections and universal search/links.

**New Data Structures**:

```typescript
// Card Stub for ALL cards (50k+)
// This is the critical piece that makes Collections work without loading everything
interface CardStub {
  id: CardID;
  slug: string;
  title: string;
  section: SectionID;
  tags: TagID[];
  published: boolean;
  author: UserID;
  created: Timestamp;
  updated: Timestamp;

  // CRITICAL: Reference graph BY TYPE for Collection filters
  // Many reference types: link, see-also, concept, synonym, citation, etc.
  // Collection filters query by type: referencesFilter('inbound', 'concept')
  references: {[type: ReferenceType]: CardID[]};           // Outbound by type
  referencesInbound: {[type: ReferenceType]: CardID[]};    // Inbound by type

  // Metadata for filtering
  cardType: CardType;
  starred: boolean;
  sortOrder: number;
  version: number;              // For caching (see Consideration 2)
  likelyImmutable: boolean;     // Caching hint
}

// Redux state
interface DataState {
  cardStubs: {[id: CardID]: CardStub};  // ALL 50k cards (~5MB)
  cards: {[id: CardID]: Card};          // Subset (~2k-5k loaded)
  fullyLoadedCardIDs: Set<CardID>;      // Track which cards have full content
  // ... existing fields
}
```

**Changes**:
1. **Load card stubs** (src/actions/database.ts):
   - `connectLiveCardStubs()`: Fetches stubs for all cards (5MB)
   - Alternative: Extract stubs from loaded cards initially
   - Store in `state.data.cardStubs`
   - Includes reference graph arrays for Collections

2. **Refactor Collection system** (src/collection_description.ts, src/filters.ts):
   - Add `Collection.filterCardIDs(stubs)`: Operate on stubs, return matching IDs
   - Add `Collection.sortCardIDs(ids, stubs)`: Sort IDs using stub metadata
   - Mark filters that require full cards: `requiresFullCard()` method
   - **Update reference filters**: Use typed reference structure from stubs
     - `referencesFilter('inbound', 'concept')` → check `stub.referencesInbound['concept']`
     - `referencesFilter('outbound', ['citation', 'citation-person'])` → check multiple types
   - Most filters work on stubs: section, tags, cardType, typed graph traversal, dates

3. **Pagination for large collections** (src/components/card-view.ts):
   - When collection > 1000 items, enable pagination mode
   - Load first 250 full cards for display
   - Infinite scroll triggers fetch of next page
   - Show "Showing 1-250 of 40,127" indicator

4. **Update selectors** (src/selectors.ts):
   - `selectCardStubs()`: Returns all stubs
   - `selectCard(id)`: Checks `cards` first, triggers fetch if not loaded
   - `selectCardExists(id)`: Checks stubs (always knows all cards)
   - Collections now built from stubs, then full cards fetched for visible items

5. **Update card-link component** (src/components/card-link.ts):
   - Check stubs for existence (not just loaded cards)
   - Show clickable link even if full card not loaded
   - Add visual indicator for "not yet loaded" cards
   - Prefetch on hover

6. **Hybrid search** (src/filters.ts, src/nlp.ts):
   - Client-side search on loaded cards (instant, full-featured)
   - Title-only search on stubs (fast, always works)
   - Server-side search for full-text across all cards (fallback)

**Expected Impact**:
- ✅✅ Collections work with 40k+ items (was impossible before)
- ✅ Links work universally
- ✅ Graph traversal filters work (reference structure in stubs)
- ✅ Working set stays small (~2k-5k full cards, 50k stubs)
- ✅ /everything/working-notes loads in <1 second (first page)

**Risk**: Medium - Requires careful Redux state migration and selector updates.

---

### Phase 3: Server-Side Search Fallback (Weeks 6-7)

**Goal**: Enable search across all cards, even those not loaded.

**Firebase Function** (functions/src/search.ts - NEW FILE):

```typescript
export const searchCards = onCall({}, async (request: CallableRequest<SearchRequest>) => {
  throwIfUserMayNotViewCards(request);

  const {query, limit = 50, offset = 0, publishedOnly = false} = request.data;

  // Option A: Simple Firestore query (works for title searches)
  const cardsRef = collection(db, 'cards');
  let q = query(cardsRef, where('published', '==', true));
  // Firestore doesn't support full-text search natively
  // This would require Algolia or building an inverted index

  // Option B: Use existing embeddings.ts semantic search
  // Leverage similarCards with query embedding

  // Option C: Build simple inverted index in Firestore subcollection
  // cards/{cardID}/searchTokens/{token} -> boolean

  return {
    results: matchingCards.map(card => ({
      cardID: card.id,
      title: card.title,
      snippet: extractSnippet(card.body, query),
      score: card.score
    })),
    hasMore: totalResults > offset + limit
  };
});
```

**Client-Side Changes**:
1. **Hybrid search action** (src/actions/find.ts):
   ```typescript
   export const performHybridSearch = (query: string) => async (dispatch, getState) => {
     // First: Search loaded cards (instant)
     const loadedResults = clientSideSearch(selectCards(getState()), query);

     // If loaded results look complete, return
     if (loadedResults.length >= 50) {
       return loadedResults;
     }

     // Otherwise: Search server for unloaded cards
     const serverResults = await searchCardsFunction({query, limit: 50});

     // Fetch full cards for top server results
     const cardIDs = serverResults.results.map(r => r.cardID);
     await dispatch(fetchCardBatch(cardIDs.slice(0, 20)));

     // Merge and deduplicate
     return mergeResults(loadedResults, serverResults);
   };
   ```

2. **Find dialog update** (src/components/find-dialog.ts):
   - Use `performHybridSearch` instead of client-only search
   - Show loading indicator for server search
   - Display "(showing loaded cards)" vs "(searching all cards)"

**Expected Impact**:
- Search works across all 50k cards
- Instant results for loaded cards
- Fallback to server for comprehensive search

**Risk**: Medium - Requires implementing server-side search (Algolia, embeddings, or custom index).

---

## Alternative: Simplified Hybrid Approach

If the phased approach seems too complex, here's a **minimal viable hybrid**:

### Simplified Option: Metadata-Lite + Server Search

**Core Changes**:
1. **Add metadata extraction** during card load (no separate collection):
   - When cards load, extract and cache metadata in separate Redux state
   - Metadata = `{id, slug, title, published, section, tags}`
   - ~50 bytes per card, can cache for non-loaded cards too

2. **Universal card existence check**:
   - `selectAllKnownCardIDs()` returns IDs from metadata + loaded cards
   - Links check this instead of just loaded cards
   - Links to non-loaded cards: clickable, trigger fetchCard on click

3. **Server-side search** (minimal implementation):
   - Firebase Function using Firestore's native indexes
   - Simple title/tag search only (skip full-text initially)
   - Returns card IDs, client fetches full cards

4. **Quick selector fixes**:
   - Memoize per-card NLP
   - Batch reference updates

**Effort**: 2-3 weeks
**Impact**: Fixes 80% of issues with 30% of the complexity

---

---

## Implementation Plan

### Recommended: Start with Phase 1 (Quick Wins)

**Why**: Delivers immediate performance improvements with minimal risk and effort. Can be deployed independently and validated before committing to larger architectural changes.

**Step-by-Step**:

1. **Week 1: Per-Card NLP Memoization**
   - File: `src/nlp.ts`
   - Create `memoizedCardNLP` WeakMap
   - Update `cardWithNormalizedTextProperties()` to check cache first
   - Add cache invalidation on card content change
   - Test: Measure selector recomputation time before/after

2. **Week 2: Batch Reference Updates**
   - File: `src/actions/data.ts`
   - Create reference update queue
   - Debounce `inboundLinksUpdates()` with 500ms delay
   - Batch multiple updates into single Firestore transaction
   - Test: Verify inbound links still update correctly

3. **Week 2: Deploy and Measure**
   - Deploy to production
   - Monitor edit/save times via performance metrics
   - Gather user feedback
   - Decide whether Phase 2 is necessary

---

### If Phase 1 Insufficient: Proceed to Phase 2

**Week 3-5: Two-Tier Storage Implementation**

See Phase 2 details above. Key decision point: Do we create a separate Firestore collection for metadata, or extract it from existing card loads?

**Recommendation**: Extract from existing loads initially (simpler), migrate to separate collection if needed later.

---

## Open Questions and Risks

### Technical Questions

1. **Metadata Source**: Should metadata be a separate Firestore collection or extracted from full cards?
   - **Separate collection**: More efficient, but requires maintaining two collections (denormalization)
   - **Extract from cards**: Simpler, but requires loading cards to get metadata
   - **Recommendation**: Start with extraction, migrate to separate collection if performance demands

2. **How to handle full-text search on server?**
   - **Option A - Algolia**: $1/month for 10k records, mature solution, easy integration
   - **Option B - Qdrant + embeddings**: Already have infrastructure, semantic search is better, but slower
   - **Option C - Custom Firestore index**: Free, but limited capabilities (no fuzzy matching, no relevance scoring)
   - **Option D - Typesense**: Self-hosted or cloud, great full-text search, would need deployment
   - **Recommendation**: Start with Option C (Firestore indexes) for simple title/tag search, add Algolia if more sophistication needed

3. **Metadata freshness**: How to keep metadata in sync with full cards?
   - Use same Firestore listeners for both
   - Metadata updates trigger full card invalidation
   - **Recommendation**: Single source of truth (Firestore), listeners keep both in sync

4. **Reference blocks for non-loaded cards**: Should reference blocks fetch cards automatically?
   - **Option A**: Auto-fetch when block expanded (current behavior for fetched cards)
   - **Option B**: Show card titles only, require explicit "load" action
   - **Recommendation**: Option A - maintain current UX expectations

5. **Selector memoization strategy**: Current reselect library limitations?
   - Reselect creates one memoized instance per selector
   - With 50k cards, might need per-card memoization (not supported by default)
   - **Recommendation**: Use WeakMap-based per-entity memoization as shown in Phase 1

### Performance Risks

1. **Metadata download size**: 50k * 500 bytes = 25MB
   - Mitigations: Compression (gzip), incremental loading, filter by published status
   - **Risk Level**: Medium - might be acceptable with compression

2. **Search latency**: Server-side search adds network round-trip
   - Mitigation: Client-side search first (instant), server fallback only if needed
   - **Risk Level**: Low - progressive enhancement means no regression

3. **Reference update batching**: Could cause stale inbound links temporarily
   - Mitigation: 500ms delay is barely noticeable, eventual consistency acceptable
   - **Risk Level**: Low - inbound links are not critical for immediate consistency

4. **Selector optimization might not be enough**: Even with optimizations, 5k cards might still be slow
   - Mitigation: Phase 2 reduces working set further to ~2k cards
   - **Risk Level**: Medium - unknown until measured

### Architecture Risks

1. **Two-tier storage complexity**: Maintaining two data structures (metadata + full cards) is error-prone
   - Mitigation: Clear separation of concerns, comprehensive tests
   - **Risk Level**: Medium - requires disciplined state management

2. **Firestore query costs**: More queries = higher costs
   - Current: ~1 query per user session (load cards)
   - Phase 2: +1 query for metadata, +N queries for on-demand cards
   - Mitigation: Firestore free tier is 50k reads/day, likely sufficient
   - **Risk Level**: Low - cost increase probably negligible

3. **Breaking offline support**: On-demand fetching might not work offline
   - Mitigation: Firestore offline cache persists previously loaded cards
   - Fall back to cached cards when offline
   - **Risk Level**: Low - existing offline features maintained

### UX Risks

1. **Loading indicators everywhere**: On-demand fetching needs UI feedback
   - Mitigation: Prefetch on hover, skeleton screens, instant metadata display
   - **Risk Level**: Medium - could feel sluggish if not done well

2. **Search behavior change**: Users accustomed to instant client-side search
   - Mitigation: Hybrid approach searches client first (still instant)
   - **Risk Level**: Low - most users won't notice

3. **Inconsistent link behavior**: Some links instant, others require fetch
   - Mitigation: Prefetching and consistent loading states
   - **Risk Level**: Low - acceptable with good UX

---

## Success Metrics

### Phase 1 Success Criteria
- Edit/save operations complete in <500ms (currently several seconds)
- Card creation completes in <200ms
- Navigation between cards <100ms
- No user complaints about lag

### Phase 2 Success Criteria (if needed)
- Search returns results for all 50k cards
- Links to all cards work (clickable, functional)
- Reference blocks show all inbound links
- Client memory usage <100MB (vs >300MB with all cards)
- User can navigate/work with app smoothly even with 50k+ cards in database

### Monitoring
- Add performance.mark() calls around:
  - Card save operations
  - Selector recomputations
  - Search operations
  - Navigation actions
- Track 95th percentile latency for each operation
- Monitor Firestore read/write costs

---

## Alternative Considerations

### Could we just upgrade hardware?
**No** - This is a JavaScript main thread problem. Even with more CPU/RAM, the synchronous O(n) operations block the UI. Need algorithmic improvements, not hardware.

### Could we use Web Workers?
**Partially** - Some operations (NLP processing, missing concepts) can move to workers. But Redux selectors run synchronously on main thread, can't easily move. Phase 1 optimizations are more effective.

### Could we limit users to viewing fewer cards?
**No** - This is what the current workaround does, and it breaks essential features (search, links, references). The whole point is to support all cards without breaking features.

### Could we paginate everything?
**Not easily** - The current architecture assumes a complete card graph for reference resolution, collection filtering, and search. Pagination would require fundamental architecture changes (similar to Option 5's radical rewrite).

### What about GraphQL?
**Overkill** - GraphQL solves different problems (flexible queries, reducing over-fetching). Wouldn't address the O(n) selector performance issues. We already have Firestore's real-time subscriptions.

---

## Conclusion

The hybrid architecture (Option 4 with Card Stubs) is the recommended approach because it:

1. ✅✅ **Addresses root cause**: Selector optimizations fix O(n) performance problems
2. ✅✅ **Enables Collections at scale**: Card stubs make 40k+ item collections possible
3. ✅✅ **Preserves Collection power**: Graph traversal, set operations, complex filters all work on stubs
4. ✅ **Minimal server complexity**: Only need simple search function, no heavy backend
5. ✅ **Incremental implementation**: Can deploy Phase 1 immediately, evaluate before Phase 2
6. ✅ **Fixes all broken features**: Search, links, references, large collections all work
7. ✅ **Progressive enhancement**: Fast for loaded cards, still works for unloaded cards
8. ✅ **Low risk**: Each phase independently valuable and testable

**Key Insight**: Card stubs (5MB for 50k cards) are the critical architectural piece that:
- Provide enough metadata for Collection filtering/sorting
- Include reference graph for graph traversal filters
- Enable pagination for massive collections like /everything/working-notes
- Keep memory usage reasonable while supporting all features

**Next Steps**:
1. Review this design document and gather feedback
2. Create GitHub issues for Phase 1 tasks
3. Implement Phase 1 (Weeks 1-2) - Quick performance wins
4. Deploy and measure impact
5. Implement Phase 2 (Weeks 3-6) - Card stubs + Collection refactoring
6. Test with /everything/working-notes (40k items)
7. If needed, add Phase 3 (server-side search)

The phased approach allows validating assumptions at each step. **Phase 2 (Card Stubs) is the breakthrough** that makes the Collection system work at scale while maintaining its power and expressiveness.
