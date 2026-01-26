# Section 3 (Server IDF Map) - Required Fixes

## Issues Found

### 1. Missing Exports from `/src/nlp.ts`

**`calcIDFMapForCards` (line 1632):**
- Currently NOT exported
- Required by Cloud Function to calculate IDF
- **Fix:** Add `export` keyword

**`MAX_N_GRAM_FOR_FINGERPRINT` (line 895):**
- Currently NOT exported
- Required by Cloud Function for ngram size
- **Fix:** Change `const` to `export const`

### 2. jsdom Infrastructure

**Status:** ALREADY EXISTS
- jsdom is already a dependency: `functions/package.json` line 29
- @types/jsdom is also present: `functions/package.json` line 24
- No additional installation needed

**Implementation:**
```typescript
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = dom.window as any;
```

### 3. Cloud Function Setup

**File structure verified:**
- Functions directory: `/Users/jkomoros/Code/card-web/functions/src/`
- Index file exists: `/Users/jkomoros/Code/card-web/functions/src/index.ts`
- Other Cloud Functions already configured (screenshot, tweet, embeddings, etc.)

**New file needed:** `/functions/src/idf.ts`

**Export needed in `/functions/src/index.ts`:**
```typescript
export { calculateIDF } from './idf.js';
```

### 4. Cloud Storage Integration

**Current storage.rules location:** `/Users/jkomoros/Code/card-web/storage.rules`

**Required addition** (after line 15):
```javascript
match /idf-maps/{fileName} {
  allow get: if true;  // Public read for IDF maps
}
```

### 5. Implementation Details Missing

The plan's implementation is correct in concept but missing details:

1. **Firestore snapshot fetching** - needs `getFirestore()` import
2. **Storage bucket access** - needs `getStorage()` import
3. **Card data structure** - needs to map snapshot docs correctly
4. **ProcessedCards format** - `calcIDFMapForCards` expects object with cardID keys
5. **Error handling** - should have try/catch
6. **Logging** - should log success/failure

## Complete Implementation

### `/functions/src/idf.ts` (NEW FILE)

```typescript
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { JSDOM } from 'jsdom';

// Polyfill for server environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = dom.window as any;

// These must be exported from /src/nlp.ts first
import { calcIDFMapForCards, MAX_N_GRAM_FOR_FINGERPRINT } from '../../src/nlp.js';
import { cardWithNormalizedTextProperties } from '../../src/nlp.js';
import { BODY_CARD_TYPES } from '../../shared/card_fields.js';

export const calculateIDF = onSchedule({
  schedule: '0 2 * * 0', // Weekly Sunday 2:00 AM PST
  timeZone: 'America/Los_Angeles',
  memory: '2GiB',
  timeoutSeconds: 540 // 9 minutes
}, async (event) => {
  try {
    const db = getFirestore();
    const storage = getStorage();

    // 1. Fetch all cards from Firestore
    console.log('Fetching cards from Firestore...');
    const snapshot = await db.collection('cards').get();
    const allCards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log(`Fetched ${allCards.length} total cards`);

    // 2. Filter to body cards only
    const bodyCards = allCards.filter(card => BODY_CARD_TYPES[card.card_type]);
    console.log(`Filtered to ${bodyCards.length} body cards`);

    // 3. Process cards with NLP
    // For IDF calculation, we can pass empty maps since we only need word counts
    const processedCards = Object.fromEntries(
      bodyCards.map(card => [
        card.id,
        cardWithNormalizedTextProperties(card, {}, {}, {})
      ])
    );

    // 4. Calculate IDF map
    console.log('Calculating IDF map...');
    const idfMap = calcIDFMapForCards(processedCards, MAX_N_GRAM_FOR_FINGERPRINT);
    console.log(`Generated IDF map with ${Object.keys(idfMap.idf).length} terms`);

    // 5. Create versioned data
    const idfData = {
      version: Date.now(),
      cardCount: bodyCards.length,
      ngramSize: MAX_N_GRAM_FOR_FINGERPRINT,
      idf: idfMap.idf,
      maxIDF: idfMap.maxIDF,
      generatedAt: new Date().toISOString()
    };

    // 6. Upload to Cloud Storage
    const bucket = storage.bucket();
    const versionedPath = `idf-maps/idf-v${idfData.version}.json`;
    const latestPath = 'idf-maps/latest.json';

    console.log(`Uploading to ${versionedPath}...`);
    await bucket.file(versionedPath).save(JSON.stringify(idfData), {
      contentType: 'application/json',
      metadata: { cacheControl: 'public, max-age=604800' } // 7 days
    });

    console.log(`Uploading to ${latestPath}...`);
    await bucket.file(latestPath).save(JSON.stringify(idfData), {
      contentType: 'application/json',
      metadata: { cacheControl: 'public, max-age=3600' } // 1 hour
    });

    console.log(`✓ IDF map generated successfully: ${bodyCards.length} cards, version ${idfData.version}`);
  } catch (error) {
    console.error('Failed to generate IDF map:', error);
    throw error;
  }
});
```

### Changes to `/src/nlp.ts`

**Line 895:** Change from:
```typescript
const MAX_N_GRAM_FOR_FINGERPRINT = 2;
```
To:
```typescript
export const MAX_N_GRAM_FOR_FINGERPRINT = 2;
```

**Line 1632:** Change from:
```typescript
const calcIDFMapForCards = (cards : ProcessedCards, ngramSize: number) : IDFMap => {
```
To:
```typescript
export const calcIDFMapForCards = (cards : ProcessedCards, ngramSize: number) : IDFMap => {
```

### Changes to `/functions/src/index.ts`

**After line 174** (after the last export), add:
```typescript
export { calculateIDF } from './idf.js';
```

### Changes to `/storage.rules`

**After line 15** (after the uploads match block), add:
```javascript
match /idf-maps/{fileName} {
  allow get: if true;  // Public read for IDF maps
}
```

## Summary

- **Exports needed:** 2 (both in nlp.ts)
- **New files:** 1 (functions/src/idf.ts)
- **Modified files:** 3 (nlp.ts, index.ts, storage.rules)
- **jsdom:** Already available as dependency
- **Cloud Function setup:** Pattern matches existing functions (embeddings, screenshot)
- **Storage rules:** Simple public read permission needed

All infrastructure exists. Implementation is complete and correct once exports are added.
