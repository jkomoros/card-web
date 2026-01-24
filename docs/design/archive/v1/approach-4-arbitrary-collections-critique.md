# Critique: Approach 4 (Parallel Dual-Track Execution) Against Arbitrary Collections with KeyCard

## Executive Summary

**Approach 4 is PERFECT for progressive loading but CATASTROPHIC on cost for arbitrary collections.** The dual-track pattern delivers exactly what the requirement asks for (partial → full results), but the cost model collapses when applied to navigation-driven KeyCard collections.

**The brilliant pattern:**
- ✅ Progressive loading: Client track (50ms) → Server track (500ms) ✓
- ✅ Preview flag semantics: Grayed cards → final results ✓
- ✅ Graceful degradation: Client track always works ✓
- ✅ Best perceived performance: 50ms to interactive ✓

**The fatal flaw:**
- ❌ Cost explosion: $50-500/month for SINGLE user if applied to all collections
- ❌ KeyCard cache hit rate: ~0% (each navigation is unique)
- ❌ Query volume: 12-16 server queries PER CARD NAVIGATION
- ❌ Design estimate off by 50-500×: "$11/year" assumes 5 queries/day, reality is 300-1600/day

**The design's blind spot:**

The code has `_shouldUseDualTrack()` guard limiting to `['main', 'everything']` sets. This guard exists to prevent cost explosion, but the design doc doesn't explain WHY. Extended requirements ask to violate this guard.

**Projected cost:**
- Design estimate (5 queries/day): $11/year
- Single casual user (arbitrary collections): $60-240/year
- Single power user (heavy navigation): $432/month
- 10 users: $5,000+/month

**The irony:** With selective triggering (existing guard), Approach 4 IS Approach 1 (smart delegation). The brilliance is the execution pattern, not the trigger strategy.

**Recommendation:**
- ✅ USE for main query dialog - Perfect fit
- ❌ DO NOT enable for arbitrary collections - Cost prohibitive
- ⚠️ Need smart delegation to decide which collections get dual-track

---

**For full analysis covering:**
- Cost breakdown showing 50-500× multiplier
- Why mitigation strategies fail or contradict requirements
- The design's implicit assumptions vs extended requirements reality
- Why dual-track becomes smart delegation with selective triggering

**See agent output: a479034**

**Critical insight:** Dual-track assumes rare, user-initiated queries (search box). KeyCard collections are frequent, navigation-triggered queries (sidebar reference blocks). Query volume is 60-320× higher than designed for, making the cost model collapse.