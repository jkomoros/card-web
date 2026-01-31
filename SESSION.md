# Implementation Session Plan - Firestore Enterprise Hybrid Architecture

**Date:** 2026-01-30
**Status:** Ready to Begin Implementation
**Current Branch:** `feature/firestore-enterprise-hybrid`
**Plan Document:** `/Users/jkomoros/Code/card-web/docs/design/CANONICAL-PLAN.md` (v2.5)

---

## Current State

### What's Complete ✅

1. **CANONICAL-PLAN.md fully reviewed and corrected**
   - 8 parallel agents reviewed all major sections
   - 30+ critical issues fixed
   - 2,000+ lines of detailed specifications added
   - Version bumped from v2.0 → v2.5
   - All changes committed to `feature/firestore-enterprise-hybrid` branch

2. **Critical Corrections Made:**
   - Section 1: Fixed Tier 3 query logic, added unsubscribe variables
   - Section 2: Corrected content fields list, fixed function signatures
   - Section 3: Exported NLP functions, implemented Cloud Function
   - Section 4: Reclassified 8 filters, corrected filter counts (274 total)
   - Section 7: Added Phase 0.5 (index deployment), realistic 15-17 week timeline
   - Section 8: Added 7 subsections with migration safety mechanisms
   - Section 9: Expanded testing strategy with concrete test cases
   - Section 10: Detailed cost analysis ($1.95/month typical usage)

3. **Files Created:**
   - `/functions/src/idf.ts` - Cloud Function for IDF calculation
   - `/storage.rules` - Updated with IDF maps public read access
   - `/tmp/filter-diagnosis.md` - Complete filter classification
   - `/Users/jkomoros/Code/card-web/SESSION.md` - This file

4. **Code Verified:**
   - Existing codebase analyzed for compatibility
   - Function signatures verified
   - Export statements needed identified
   - jsdom infrastructure confirmed available

### Git Status

**Current Branch:** `feature/firestore-enterprise-hybrid`
**Based On:** `master` (commit: 97392e1b "Merge feature/relative-date-filters into master")

**Recent Commits:**
```
a08b6c60 - Add comprehensive Firestore Enterprise capabilities section
b08a1fa5 - Update canonical plan with composition filter analysis
38e6ae28 - Add reference filters analysis to canonical plan
2e7de435 - Expand Section 10 (Cost Analysis) with comprehensive details
716545be - Overhaul Section 7 (Implementation Roadmap)
becc5431 - Enhance Section 8 (Migration Strategy)
e7edbedb - Correct Section 4 filter classifications
[more commits from agent reviews]
```

---

## Next Steps - Implementation Checklist

### Step 1: Create Implementation Branch ⏭️ NEXT

**Branch off from current state:**
```bash
git checkout feature/firestore-enterprise-hybrid
git checkout -b implement/firestore-enterprise-phase-0
```

**Why a new branch?**
- `feature/firestore-enterprise-hybrid` contains planning/design work
- `implement/firestore-enterprise-phase-0` will contain actual code changes
- Keeps planning separate from implementation
- Allows for clean PR reviews

### Step 2: Firebase Project Setup ⏭️ NEXT

**CRITICAL: Use staging project, NOT production!**

```bash
# Switch to dev/staging project
firebase use dev-complexity-compendium

# Verify you're on the right project
firebase projects:list
# Should show: dev-complexity-compendium (current)

# NEVER use production:
# ❌ complexity-compendium <- PRODUCTION - DO NOT USE
```

**Projects:**
- ✅ `dev-complexity-compendium` - Staging (SAFE to use)
- ❌ `complexity-compendium` - Production (NEVER use during implementation)

### Step 3: Phase 0.5 - Deploy Firestore Composite Index 🔧

**CRITICAL FIRST STEP** - Code will FAIL HARD without this index.

**File:** `/Users/jkomoros/Code/card-web/firestore.indexes.json`

**Add this index:**
```json
{
  "collectionGroup": "cards",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "published", "order": "ASCENDING" },
    { "fieldPath": "auto_todo_overrides.prioritized", "order": "ASCENDING" },
    { "fieldPath": "created", "order": "DESCENDING" }
  ]
}
```

**Deploy:**
```bash
firebase deploy --only firestore:indexes --project dev-complexity-compendium
```

**Wait for index to build** (10-30 minutes, sometimes hours):
```bash
# Check status
firebase firestore:indexes --project dev-complexity-compendium

# Should show: READY
# If CREATING or PROCESSING, wait
```

**Success Criteria:**
- Index status: READY
- Can run query without error:
  ```javascript
  db.collection('cards')
    .where('published', '==', false)
    .where('auto_todo_overrides.prioritized', '==', true)
    .orderBy('auto_todo_overrides.prioritized')
    .orderBy('created', 'desc')
    .limit(100)
  ```

### Step 4: Phase 1 - Implement 3-Tier Hot System (Week 1-3)

**Files to modify:**

1. **`/src/types.ts`** - Add new CardFetchType values:
   ```typescript
   const _cardFetchTypeSchema = z.enum([
       'published',
       'unpublished-prioritized',  // ADD
       'unpublished-recent',       // ADD
       'unpublished-partial',
       'unpublished-complete',
       'unpublished-editor',
       'unpublished-author'
   ]);
   ```

2. **`/src/util.ts`** - Update `fetchTypeIsUnpublished()`:
   ```typescript
   export const fetchTypeIsUnpublished = (fetchType : CardFetchType) : boolean => {
       return fetchType !== 'published';
   };
   // Add new fetch types to the check
   ```

3. **`/src/actions/database.ts`**:
   - Add unsubscribe variables (after line 361):
     ```typescript
     let liveUnpublishedPrioritizedCardsUnsubscribe : (() => void) | null = null;
     let liveUnpublishedRecentCardsUnsubscribe : (() => void) | null = null;
     ```
   - Modify `connectLiveUnpublishedCards()` (lines 398-446)
   - Modify `disconnectLiveUnpublishedCards()` (lines 377-394)

4. **`/src/actions/data.ts`**:
   - Update `cullExtraCompleteModeCards()` (lines 279-300)

**Testing:**
- Run existing tests: `npm test`
- Add new tests for 3-tier loading
- Verify no duplicate cards across tiers
- Test dynamic limit calculation

**Success Criteria:**
- All 3 tiers load correctly
- No duplicates between tiers
- Hot tier = ~900 published + ~6000 prioritized + dynamic recent
- P95 load time < 5 seconds
- Memory < 23 MB (+15% from baseline)

### Step 5: Phase 2 - Implement NLP Data Storage (Week 4-6)

**Files to modify:**

1. **`/shared/types.ts`** - Add NLP storage types:
   ```typescript
   export interface ProcessedRunStorage { /* ... */ }
   export interface NLPTokenStorage { /* ... */ }
   export interface Card {
       // ... existing fields ...
       nlp_tokens?: NLPTokenStorage;
       nlp_fingerprint?: string;
       nlp_version?: number;
   }
   ```

2. **`/src/nlp.ts`**:
   - Export `calcIDFMapForCards` (line 1632)
   - Export `MAX_N_GRAM_FOR_FINGERPRINT` (line 895)

3. **`/src/actions/data.ts`** - Modify `modifyCardWithBatch()`:
   - Generate NLP tokens on save
   - Use correct content fields list
   - Handle `references_diff` check

4. **`/src/selectors.ts`**:
   - Add fast path for cards with `nlp_tokens`
   - Fallback to computation for old cards

**Testing:**
- Save a card and verify `nlp_tokens` is stored
- Load a card with stored NLP and verify it's used
- Verify backward compatibility with cards without NLP

**Success Criteria:**
- Save time P95 < 300ms (no regression)
- NLP tokens stored correctly
- 95% reduction in client-side NLP computation time
- Backward compatible with existing cards

### Step 6: Phase 3 - Implement Server IDF Map (Week 7-8)

**Files already created:**
- ✅ `/functions/src/idf.ts` - Cloud Function implementation

**Files to modify:**

1. **`/functions/src/index.ts`** - Export the function:
   ```typescript
   export { calculateIDF } from './idf.js';
   ```

2. **`/storage.rules`** - Add public read for IDF maps:
   ```typescript
   match /idf-maps/{fileName} {
     allow read: if true;  // Public read
     allow write: if false; // Cloud Function only
   }
   ```

**Deploy:**
```bash
# Build functions
cd functions && npm run build

# Deploy
firebase deploy --only functions:calculateIDF,storage --project dev-complexity-compendium
```

**Testing:**
- Trigger Cloud Function manually
- Verify IDF map appears in Cloud Storage
- Verify client can fetch IDF map
- Test fallback when IDF map missing

**Success Criteria:**
- Cloud Function runs successfully (< 60 seconds)
- IDF map uploaded to Cloud Storage
- Client fetches and caches IDF map
- Consistent fingerprints across all clients

### Step 7: Continue with Remaining Phases

Follow the roadmap in Section 7 of CANONICAL-PLAN.md:
- Phase 4: Simple vs Complex Collections (Week 9-11)
- Phase 5: Real-Time Editing Conflicts (Week 9-11, parallel)
- Phase 6: Security Rules & Permissions (Week 12)
- Phase 7: Data Migration Execution (Week 13)
- Phase 8: Monitoring & Observability (Week 14)
- Phase 9: Canary Deployment (Week 15)
- Phase 10: Production Hardening & Documentation (Week 16-17)

---

## Important Notes

### Firebase Project Reminder 🚨
**ALWAYS verify you're on staging:**
```bash
firebase use dev-complexity-compendium
firebase projects:list  # Confirm dev-complexity-compendium is current
```

**If you accidentally use production:**
1. STOP immediately
2. Run: `firebase use dev-complexity-compendium`
3. Verify no changes were deployed to production
4. If changes were deployed, ROLLBACK immediately

### Code Safety Checks

Before deploying ANY code:
1. ✅ Run tests: `npm test`
2. ✅ Verify Firebase project: `firebase projects:list`
3. ✅ Check branch: `git branch --show-current`
4. ✅ Review changes: `git diff master...HEAD`
5. ✅ Build functions: `cd functions && npm run build`

### Rollback Procedures

If anything goes wrong:
1. **Immediate rollback**: Disable feature flags
2. **Index rollback**: Cannot delete indexes safely once built
3. **Code rollback**: `git revert` or redeploy previous version
4. **Data rollback**: Migration is safe (cards readable at all times)

---

## Key Documents

- **Plan:** `/Users/jkomoros/Code/card-web/docs/design/CANONICAL-PLAN.md` (v2.5)
- **Filter Diagnosis:** `/tmp/filter-diagnosis.md` (274 filters classified)
- **Requirements:** `/Users/jkomoros/Code/card-web/docs/requirements.md`
- **This Session:** `/Users/jkomoros/Code/card-web/SESSION.md`

---

## Cost Estimates

- **Typical usage:** $1.95/month
- **Storage:** $0.14/month (NLP data)
- **Cloud Functions:** $0.00/month (within free tier)
- **Cloud Storage:** $0.00/month (within free tier)

**Annual savings vs Algolia:** $438.60/year

---

## Timeline

**Total:** 15-17 weeks (including 2-week risk buffer)

**Critical Path:**
- Phase 0.5: Week 0 (index deployment) ← BLOCKING
- Phase 1: Week 1-3 (3-tier hot system)
- Phase 2: Week 4-6 (NLP storage)
- Phase 3: Week 7-8 (Server IDF) - can parallel with Phase 4-5
- Phase 4: Week 9-11 (Simple collections)
- Phase 5: Week 9-11 (Editing conflicts) - parallel with Phase 4
- Phase 6: Week 12 (Security rules)
- Phase 7: Week 13 (Migration)
- Phase 8: Week 14 (Monitoring)
- Phase 9: Week 15 (Canary)
- Phase 10: Week 16-17 (Hardening)

---

## What to Tell Claude in Next Session

"Continue implementation of Firestore Enterprise Hybrid Architecture. Read /Users/jkomoros/Code/card-web/SESSION.md for current status and next steps. We're ready to start Phase 0.5 (Firestore index deployment). Use firebase project dev-complexity-compendium (NEVER complexity-compendium). Create new branch implement/firestore-enterprise-phase-0."

---

**Last Updated:** 2026-01-30
**Ready to implement:** ✅ YES
**Production-safe:** ✅ YES (using staging project)
**Plan accuracy:** ✅ VERIFIED by 8 agents
