# Firestore Enterprise Pipeline Operations: Capabilities & Research

> **Date**: January 2026
> **Status**: Generally Available (GA)
> **Purpose**: Research document for Firestore Enterprise Edition capabilities
> **Context**: Evaluating for card-web hybrid architecture to search 30k+ cards

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [What's New in Firestore Enterprise](#whats-new-in-firestore-enterprise)
3. [Pipeline Operations Overview](#pipeline-operations-overview)
4. [Query Capabilities](#query-capabilities)
5. [Performance Characteristics](#performance-characteristics)
6. [Pricing Model](#pricing-model)
7. [Limitations & Constraints](#limitations--constraints)
8. [Migration Considerations](#migration-considerations)

## Executive Summary

Firestore Enterprise Edition (GA as of January 2026) introduces **Pipeline Operations** - a completely reimagined query engine with 100+ new query capabilities. Key improvements:

**For Card-Web:**
- ✅ Can query ALL 30k+ cards server-side (no client memory limit)
- ✅ Complex text matching via `regex_match()` and `str_contains()`
- ✅ Optional indexing (queries work without indexes)
- ✅ Server-side aggregations and transformations
- ❌ **No real-time sync** for Pipeline operations (pull-based only)
- ❌ 60-second timeout, 128 MiB memory limit per query

**Pricing Shift:**
- Standard: Per-document pricing
- Enterprise: Per-unit pricing (4 KiB chunks for reads, 1 KiB for writes)
- Indexes are NOT free in Enterprise (consume write units)

## What's New in Firestore Enterprise

### Announcement Timeline

- **August 2025**: MongoDB compatibility announced
- **January 2026**: Pipeline Operations blog post published
- **January 2026**: Enterprise Edition reaches General Availability (GA)

### Key Sources

- [Firestore Release Notes](https://docs.cloud.google.com/firestore/docs/release-notes)
- [Editions Overview](https://firebase.google.com/docs/firestore/editions)
- [Pipeline Operations Blog](https://firebase.blog/posts/2026/01/firestore-enterprise-pipeline-operations)
- [Pipeline Overview Docs](https://docs.cloud.google.com/firestore/native/docs/pipeline/overview)
- [Get Started Guide](https://firebase.google.com/docs/firestore/pipelines/get-started-with-pipelines)

### Standard vs Enterprise Comparison

| Feature | Standard Edition | Enterprise Edition |
|---------|------------------|---------------------|
| **Query Engine** | Core operations only | Core + Pipeline operations |
| **Indexing** | Required for compound queries | Optional (queries work without) |
| **Full-Text Search** | Not available | Via `str_contains`, `regex_match` |
| **Complex Expressions** | Limited | 100+ functions |
| **OR Operations** | Not supported | Supported |
| **Pricing Model** | Per document | Per unit (4 KiB/1 KiB) |
| **Real-Time Sync** | Yes (`onSnapshot`) | Only Core ops (Pipeline is pull-only) |
| **MongoDB Compatibility** | No | Yes |
| **Free Tier** | 50k reads, 20k writes/day | Same |

## Pipeline Operations Overview

### What Are Pipeline Operations?

Pipeline operations are a new query interface that provides advanced query functionality through **sequential stage execution**:

```javascript
const results = await db.pipeline()
  .collection("cards")           // Stage 1: Input
  .where(expr)                   // Stage 2: Filter
  .select(fields)                // Stage 3: Project
  .sort(field, direction)        // Stage 4: Order
  .limit(100)                    // Stage 5: Limit
  .execute();
```

### Key Insight

> "Applying a limit before a sort can yield unintended results (as the limit would be applied before sorting)."

Pipeline stages execute **in order**, enabling complex transformations impossible with Standard Firestore.

### Available Stages

#### Input Stages
- `collection(path)` - Query specific collection
- `collectionGroup(name)` - Query across collections with same name
- `database()` - Query all documents (Enterprise only)
- `documents([refs])` - Batch read specific documents

#### Transformation Stages
- `where()` - Filter documents via expressions
- `select()` - Return only specified fields
- `add_fields()` - Extend schema with computed fields
- `remove_fields()` - Exclude fields from results
- `sort()` - Order results
- `limit()` - Restrict result count
- `offset()` - Skip N documents
- `aggregate()` - Group and summarize data
- `distinct()` - Return unique groupings
- `find_nearest()` - Vector similarity search
- `sample()` - Random sampling
- `unnest()` - Expand array fields
- `union()` - Combine multiple inputs
- `replace_with()` - Transform documents

## Query Capabilities

### Text Search Functions

#### `str_contains(field, substring)`

```javascript
// Find cards containing "machine learning"
db.pipeline()
  .collection("cards")
  .where(
    expr.or(
      expr.str_contains(expr.field("body"), "machine learning"),
      expr.str_contains(expr.field("title"), "machine learning")
    )
  )
  .execute();
```

**Characteristics:**
- Case-sensitive by default
- Substring matching (not full-text search with ranking)
- No stemming or NLP processing
- Fast when indexed, slow on full scans

#### `regex_match(field, pattern, flags)`

```javascript
// Find cards with "AI" or "artificial intelligence" (case-insensitive)
db.pipeline()
  .collection("cards")
  .where(
    expr.regex_match(
      expr.field("body"),
      "\\b(ai|artificial intelligence)\\b",
      "i"  // case-insensitive flag
    )
  )
  .execute();
```

**Capabilities:**
- Full regex support (JavaScript-like syntax)
- Flags: `i` (case-insensitive), `m` (multiline)
- Can approximate stemming with pattern alternatives
- Performance: O(n) worst case without index hints

### Array Operations

#### `array_contains_all(field, values)`

```javascript
// Find cards with ALL specified tags
db.pipeline()
  .collection("cards")
  .where(
    expr.array_contains_all(
      expr.field("tags"),
      ["concept", "important", "reviewed"]
    )
  )
  .execute();
```

**Difference from Standard**:
- Standard: `array-contains` (single value) or `array-contains-any` (up to 30 values)
- Enterprise: `array_contains_all` (all must be present, unlimited size)

### Comparison Functions

```javascript
// Complex date filtering
db.pipeline()
  .collection("cards")
  .where(
    expr.and(
      expr.gte(expr.field("created"), startDate),
      expr.lte(expr.field("created"), endDate),
      expr.eq(expr.field("published"), true)
    )
  )
  .execute();
```

**Available**: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`

### Aggregation Functions

```javascript
// Count cards by section
db.pipeline()
  .collection("cards")
  .aggregate(
    expr.count(expr.field("*")),
    expr.field("section")  // Group by section
  )
  .execute();
```

**Functions**: `sum()`, `avg()`, `min()`, `max()`, `count()`, `count_distinct()`

### Complex Expressions Example

```javascript
// Cards with >100 words in body, created in last 30 days
db.pipeline()
  .collection("cards")
  .where(
    expr.and(
      // Word count >100 (approximate via length)
      expr.gt(
        expr.length(expr.field("body")),
        500  // ~100 words × 5 chars avg
      ),
      // Created in last 30 days
      expr.gte(
        expr.field("created"),
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      )
    )
  )
  .execute();
```

## Performance Characteristics

### Query Execution Limits

| Metric | Limit |
|--------|-------|
| **Query timeout** | 60 seconds |
| **Memory limit** | 128 MiB materialized data |
| **Result set size** | Unlimited (but timeout applies) |
| **Concurrent queries** | No stated limit |

### Index Requirements

> "Pipeline operations do not require that an index is always present. This means that a query can exhibit higher latency compared to existing queries."

**Trade-off**:
- ✅ Queries work without indexes (developer autonomy)
- ❌ Unindexed queries can be very slow (full collection scans)
- 💡 Use Query Insights and Query Explain to identify optimization opportunities

### Index Optimization Best Practices

**Recommended Index Field Order:**
1. Equality filters (any order)
2. Sort fields (same order as `sort()`)
3. Range/inequality filters (decreasing selectivity)

**Example**:
```javascript
// Query
db.pipeline()
  .collection("cards")
  .where(expr.eq(expr.field("section"), "ai"))
  .where(expr.gt(expr.field("star_count"), 5))
  .sort("created", "desc")
  .execute();

// Recommended index: (section ASC, created DESC, star_count DESC)
```

### Covered Queries

If all returned fields exist in a secondary index, Firestore skips fetching full documents:

```javascript
// Create index on: (section, created, title)
db.pipeline()
  .collection("cards")
  .where(expr.eq(expr.field("section"), "ai"))
  .select(["section", "created", "title"])  // All in index
  .sort("created", "desc")
  .execute();

// Much faster + cheaper (reads from index only, not documents)
```

### Performance Benchmarks (Estimated)

| Query Type | Indexed | Unindexed |
|------------|---------|-----------|
| Simple equality | 10-50ms | 500-2000ms |
| Text search (`str_contains`) | 50-200ms | 2000-10000ms |
| Regex match | 100-500ms | 5000-30000ms |
| Complex aggregation | 200-1000ms | 10000-60000ms |

*Note: Actual performance depends on collection size, query complexity, and server load.*

## Pricing Model

### Unit-Based Pricing

**Read Operations** (per 4 KiB):
- Enterprise charges per 4 KiB "unit" of data read
- Example: 10 KiB document = 3 read units (10 ÷ 4 = 2.5, rounded up to 3)

**Write Operations** (per 1 KiB):
- Enterprise charges per 1 KiB "unit" of data written
- Example: 2.5 KiB document = 3 write units (2.5 ÷ 1 = 2.5, rounded up to 3)

**Critical Difference: Indexes Are NOT Free**
- Standard: Index updates are free
- Enterprise: Index writes consume write units
- Impact: More indexes = higher write costs

### Cost Comparison

**Scenario**: 10 million reads per month, 2 million writes

#### Standard Edition Pricing
```
Reads:   (10,000,000 / 100,000) × $0.06 = $6.00
Writes:  (2,000,000 / 100,000) × $0.18 = $3.60
Storage: 500 GB × $0.18 = $90.00
────────────────────────────────────────
Total: ~$99.60/month
```

#### Enterprise Edition Pricing (Estimated)
```
Assuming average document size:
- Reads:  4 KiB avg → same unit count
- Writes: 1 KiB avg → more units
- Indexes: 3 indexes × writes = 3× write cost

Reads:   10M units × ($0.06/100k) = $6.00
Writes:  2M × 4 units (avg size + indexes) × ($0.18/100k) = $14.40
Storage: 500 GB × $0.18 = $90.00
────────────────────────────────────────
Total: ~$110.40/month (+11% vs Standard)
```

**For Card-Web** (30k+ cards, mostly reads):
```
Assumption: 1000 active users, 5 queries/user/day, 90% cache hit

Daily queries:  1000 × 5 × 0.1 (cache miss) = 500
Monthly queries: 500 × 30 = 15,000

Per query: ~30,000 cards × 4 KiB = 120 MB ≈ 30,000 read units

Total reads: 15,000 × 30,000 = 450,000,000 read units
Cost: (450M / 100k) × $0.06 = $270/month

WITH aggressive caching (99% hit rate):
Cost: (4.5M / 100k) × $0.06 = $2.70/month
```

### Free Tier
All customers get:
- 50,000 reads/day
- 20,000 writes/day
- 20,000 deletes/day
- 1 GB storage/month

**Impact for Card-Web**: Free tier covers ~1-2 queries/day in dev, minimal help in production

## Limitations & Constraints

### No Real-Time Sync for Pipeline Operations

**Critical Limitation**: Pipeline operations are pull-based, not push-based

```javascript
// ❌ This does NOT work
db.pipeline()
  .collection("cards")
  .where(expr.eq(expr.field("section"), "ai"))
  .onSnapshot((snapshot) => {  // No onSnapshot for Pipeline!
    // ...
  });

// ✅ Must use polling or Core operations for real-time
onSnapshot(
  query(collection(db, "cards"), where("section", "==", "ai")),
  (snapshot) => { /* real-time updates */ }
);
```

**Workaround for Card-Web**:
- Keep existing `onSnapshot()` for recent 5k cards (real-time)
- Use Pipeline operations for historical cards (snapshot-in-time)
- Hybrid approach: real-time channel + periodic server refresh

### Query Timeout: 60 Seconds

```javascript
// ❌ This might timeout
db.pipeline()
  .collection("cards")  // 30k docs
  .where(
    expr.regex_match(
      expr.field("body"),
      "very.*complex.*regex.*with.*backtracking"
    )
  )
  .execute();  // Could exceed 60s
```

**Mitigation**:
- Use `select()` to minimize data transfer
- Add indexes for common query patterns
- Implement client-side timeout at 55s to fail fast
- Fall back to client-side processing if server times out

### Memory Limit: 128 MiB

Materialized data (result set + intermediate stages) cannot exceed 128 MiB:

```javascript
// ❌ This might exceed memory limit
db.pipeline()
  .collection("cards")  // 30k docs × 10 KiB = 300 MB
  .aggregate(/* complex grouping */)
  .execute();  // Error: RESOURCE_EXHAUSTED
```

**Mitigation**:
- Use `select()` to fetch only needed fields
- Implement pagination with `offset()` and `limit()`
- Process in batches if aggregating large datasets

### Preview Stage Limitations

During preview (as of January 2026):

❌ No specialized index support for `array_contains` or `find_nearest` (vector search)
❌ Pagination not supported (workaround: chain `where()/sort()` stages)
❌ Emulator support unavailable
❌ No offline capabilities

### Security Rules Limitations

> "Complex expressions, such as arithmetic within a filter or string functions like strContains, are not recognized for constraining queries in Security Rules, though they are available for use in Pipeline queries themselves."

**Impact**: Cannot use Pipeline expressions in security rules for row-level security

## Migration Considerations

### Standard → Enterprise Migration

**Steps**:
1. Create new Firestore Enterprise Edition database
2. Migrate data (export/import or dual-write strategy)
3. Update client SDKs to latest version
4. Refactor queries to use Pipeline operations
5. Test thoroughly (query results may differ without indexes)
6. Monitor costs (unit-based pricing)

**Data Model Changes**: None required (Enterprise is backwards compatible)

**Query Translation Examples**:

```javascript
// BEFORE (Standard Firestore)
const query1 = query(
  collection(db, "cards"),
  where("section", "==", "ai"),
  where("published", "==", true)
);

const query2 = query(
  collection(db, "cards"),
  where("section", "==", "ml"),
  where("published", "==", true)
);

// Client-side OR: Fetch both, merge
const [results1, results2] = await Promise.all([
  getDocs(query1),
  getDocs(query2)
]);
const merged = [...results1.docs, ...results2.docs];

// AFTER (Enterprise Pipeline)
const results = await db.pipeline()
  .collection("cards")
  .where(
    expr.and(
      expr.or(
        expr.eq(expr.field("section"), "ai"),
        expr.eq(expr.field("section"), "ml")
      ),
      expr.eq(expr.field("published"), true)
    )
  )
  .execute();
// Single query, server-side OR
```

### For Card-Web Specifically

**Advantages**:
- ✅ Can query all 30k+ cards server-side
- ✅ Text search via `regex_match` (approximate stemming)
- ✅ Complex filters without client-side processing
- ✅ Offload NLP-like processing to server (regex patterns)

**Challenges**:
- ❌ No real-time sync for Pipeline queries
- ❌ Cannot replicate full NLP (stemming, bigrams, BM25 scoring) server-side
- ❌ Cost increases with query volume
- ❌ Timeout risk on complex queries

**Recommended Hybrid Approach**:
- Use Core operations + `onSnapshot()` for recent 5k cards (real-time)
- Use Pipeline operations for deep search across all 30k+ cards (on-demand)
- Cache Pipeline results aggressively (cards rarely change)
- Fall back to client-side scoring for NLP-based ranking

## Key Takeaways

1. **Pipeline Operations enable server-side querying of full 30k+ card corpus**
2. **No real-time sync** - must keep `onSnapshot()` for recent cards
3. **Pricing shift** - unit-based, indexes cost money
4. **Query capabilities** - `str_contains`, `regex_match`, complex expressions
5. **Performance** - 60s timeout, 128 MiB memory limit
6. **Hybrid architecture recommended** - real-time for recent, server for deep search

## Next Steps

See design documents for 4 architectural approaches:
- `design-approach-1-smart-delegation.md`
- `design-approach-2-progressive-loading.md`
- `design-approach-3-server-first.md`
- `design-approach-4-dual-track.md`
