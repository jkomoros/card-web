# Critique: Approach 2 (Progressive Hybrid Loading / Hot/Cold Tier) Against Arbitrary Collections with KeyCard

## Executive Summary

**Approach 2's hot/cold tier architecture FUNDAMENTALLY FAILS when extended to arbitrary collections.** While it successfully addresses the original narrow problem (query dialog searches), it completely breaks down for KeyCard-based collections due to fragile trigger logic and cost explosion.

**Key Failures:**
1. **Trigger logic designed for static searches** - Five triggers (empty results, old dates, etc.) don't model navigation-driven KeyCard changes
2. **Cost explosion with aggressive triggering** - $1,166/month for 100 users if cold tier triggers on every KeyCard change
3. **Incomplete results with conservative triggering** - If cold tier doesn't trigger, users see only partial results (defeats the purpose)
4. **No per-KeyCard caching strategy** - Cache hit rate <10% for navigation patterns
5. **Cost-completeness dilemma** - Must choose between expensive + complete OR cheap + incomplete; no middle ground

**The fundamental mismatch:**
- Designed for: User-initiated searches (infrequent, high-value, cacheable)
- Reality: Navigation-triggered collections (frequent, low-value, uncacheable due to unique KeyCards)

**Projected cost:**
- Aggressive triggering (complete results): $1,166/month for 100 users
- Conservative triggering (incomplete results): Violates "full results" requirement

**Recommendation: DO NOT USE** Approach 2 for arbitrary collections. The trigger-based progressive loading is architecturally incompatible with frequently-changing KeyCard collections.

---

**For full analysis covering:**
- Detailed trigger logic breakdown for each collection type
- False positive/negative scenarios
- Why hot/cold tier assumptions fail for KeyCard collections
- Comparison to Approach 3/4 caching strategies

**See agent output: a1cf108**

**Critical insight:** Approach 2 assumes "most queries satisfied by hot tier (recent 5k cards)." This is false for similarity queries (older cards might be more similar), reference chains (old foundational cards get referenced by newer ones), and concept-based queries (concepts are timeless).