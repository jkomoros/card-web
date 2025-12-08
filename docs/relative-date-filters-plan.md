# Implementation Plan: Relative Date Filters

## Current State Analysis

### How Date Filtering Works Today

**URL Format:** `created/after/2025-11-5`

**Key Components:**

1. **`parseDateSection()` (filters.ts:259-269)**
   - Splits URL string by '/' → `["after", "2025-11-5"]`
   - Creates Date objects using native `new Date(pieces[1])`
   - Returns: `[DateRangeType, Date, Date]`

2. **`makeDateSection()` (filters.ts:271-279)**
   - Takes `(comparisonType, dateOne, dateTwo)` as Date objects
   - Outputs absolute date string: `"2025-11-5"`
   - Format: `YYYY-M-D` (no zero padding)

3. **`makeDateConfigurableFilter()` (filters.ts:287-330)**
   - Receives date strings as parameters
   - Converts to Date objects: `new Date(firstDateStr)`
   - Creates filter function that compares card timestamps against these dates

4. **UI Component (`configure-collection-date.ts`)**
   - Uses HTML5 `<input type="date">` picker
   - Always produces Date objects
   - Calls `makeDateSection()` with Date objects

### Architecture Characteristics

- **No date library** - uses native JavaScript `Date()` constructor
- **Date-centric** - Everything works with Date objects internally
- **Simple URL format** - Just absolute date strings
- **No validation** - Invalid dates silently create `Invalid Date` objects

---

## Requirements for Relative Dates

### Desired URL Formats

```
created/after/3-days-ago
created/after/last-monday
created/between/2-weeks-ago/yesterday
updated/before/last-friday
```

### Relative Date Syntax Proposed

**Offset-based (from today):**
- `yesterday`
- `N-days-ago` (e.g., `3-days-ago`, `7-days-ago`)
- `N-weeks-ago` (e.g., `2-weeks-ago`)
- `N-months-ago` (e.g., `1-month-ago`, `6-months-ago`)
- `N-years-ago` (e.g., `1-year-ago`)

**Day-of-week anchors:**
- `last-monday`, `last-tuesday`, `last-wednesday`, `last-thursday`, `last-friday`, `last-saturday`, `last-sunday`
- These refer to the most recent occurrence of that weekday (not including today)

**Special keywords:**
- `today` (midnight of current day)
- `yesterday` (same as `1-day-ago`)

---

## Design Decisions

### Decision 1: Relative vs Absolute in URLs

**Question:** Should `created/after/3-days-ago` stay as `3-days-ago` in the URL, or be converted to an absolute date like `2025-12-4`?

**Decision: Keep relative dates in URLs**

**Rationale:**
- **Reusability:** URL `created/after/7-days-ago` is useful as a bookmark that always shows "last week's cards"
- **Intent preservation:** The relative expression captures user intent better
- **Flexibility:** Users can share/bookmark URLs that adapt to current time
- **User request:** The user explicitly wants `created/after/3-days-ago` format

**Trade-offs accepted:**
- Slight complexity: Need to recalculate dates on every page load
- UI complexity: Need separate input mode for relative dates

### Decision 2: UI Input Approach

**Options considered:**
1. Replace date picker with text input
2. Add toggle between date picker and text input
3. Keep date picker, allow manual URL editing for relative dates
4. Date picker + preset buttons for common relative dates

**Decision: Option 3 initially - Keep existing date picker, allow manual URL entry**

**Rationale:**
- **Minimal changes:** No UI changes required for initial implementation
- **Backward compatible:** Existing date picker workflow unchanged
- **Power user feature:** Relative dates can be used by editing URL manually or via programmatic access
- **Incremental:** Can add better UI later without breaking anything

**Future enhancement:** Add relative date presets or text input mode

### Decision 3: Date Resolution Strategy

**Decision: Resolve relative dates to absolute dates at parse time**

**Rationale:**
- Filter functions need actual Date objects to compare against timestamps
- Resolution happens in `parseDateSection()` - single point of responsibility
- Recalculation on every page load ensures "3-days-ago" always means "3 days before today"

---

## Implementation Plan

### Phase 1: Core Parsing Logic

#### 1.1: Create Relative Date Parser

**New function in `filters.ts`:**

```typescript
/**
 * Parses a relative date string into an absolute Date object.
 * Returns null if the string is not a recognized relative date format.
 *
 * Supported formats:
 * - today, yesterday
 * - N-days-ago, N-weeks-ago, N-months-ago, N-years-ago
 * - last-monday, last-tuesday, etc.
 */
export const parseRelativeDate = (str: string): Date | null => {
  // Implementation details below
}
```

**Logic:**

1. **Today/Yesterday:**
   ```typescript
   if (str === 'today') {
     const d = new Date();
     d.setHours(0, 0, 0, 0);
     return d;
   }
   if (str === 'yesterday') {
     const d = new Date();
     d.setDate(d.getDate() - 1);
     d.setHours(0, 0, 0, 0);
     return d;
   }
   ```

2. **Offset-based (N-units-ago):**
   ```typescript
   const offsetMatch = str.match(/^(\d+)-(day|week|month|year)s?-ago$/);
   if (offsetMatch) {
     const amount = parseInt(offsetMatch[1]);
     const unit = offsetMatch[2];
     const d = new Date();

     switch(unit) {
       case 'day': d.setDate(d.getDate() - amount); break;
       case 'week': d.setDate(d.getDate() - (amount * 7)); break;
       case 'month': d.setMonth(d.getMonth() - amount); break;
       case 'year': d.setFullYear(d.getFullYear() - amount); break;
     }

     d.setHours(0, 0, 0, 0);
     return d;
   }
   ```

3. **Day-of-week (last-X):**
   ```typescript
   const weekdayMatch = str.match(/^last-(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
   if (weekdayMatch) {
     const targetDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
       .indexOf(weekdayMatch[1]);

     const d = new Date();
     const currentDay = d.getDay();

     // Calculate days to subtract
     // If today is Wednesday (3) and we want last Monday (1):
     // daysBack = (3 - 1 + 7) % 7 = 2, but we want at least 1, so: 2 || 7 = 2
     let daysBack = ((currentDay - targetDay + 7) % 7) || 7;

     d.setDate(d.getDate() - daysBack);
     d.setHours(0, 0, 0, 0);
     return d;
   }
   ```

4. **Not recognized - return null:**
   ```typescript
   return null;
   ```

**Location:** Add before `parseDateSection()` in `filters.ts` (around line 258)

#### 1.2: Modify `parseDateSection()`

**Current implementation (line 259-269):**
```typescript
export const parseDateSection = (str : string) : [dateType : DateRangeType, firstDate : Date, secondDate : Date] => {
	let pieces = str.split('/');
	const targetLength = CONFIGURABLE_FILTER_URL_PARTS[pieces[0]] + 1;
	pieces = pieces.slice(0, targetLength);
	let firstDate = new Date();
	let secondDate = new Date();
	if (pieces.length > 1) firstDate = new Date(pieces[1]);  // ← CHANGE HERE
	if (pieces.length > 2) secondDate = pieces[2] ? new Date(pieces[2]) : new Date();  // ← AND HERE
	return [pieces[0] as DateRangeType, firstDate, secondDate];
};
```

**Modified implementation:**
```typescript
export const parseDateSection = (str : string) : [dateType : DateRangeType, firstDate : Date, secondDate : Date] => {
	let pieces = str.split('/');
	const targetLength = CONFIGURABLE_FILTER_URL_PARTS[pieces[0]] + 1;
	pieces = pieces.slice(0, targetLength);
	let firstDate = new Date();
	let secondDate = new Date();

	if (pieces.length > 1) {
		const relativeDate = parseRelativeDate(pieces[1]);
		firstDate = relativeDate !== null ? relativeDate : new Date(pieces[1]);
	}

	if (pieces.length > 2 && pieces[2]) {
		const relativeDate = parseRelativeDate(pieces[2]);
		secondDate = relativeDate !== null ? relativeDate : new Date(pieces[2]);
	} else if (pieces.length > 2) {
		secondDate = new Date();
	}

	return [pieces[0] as DateRangeType, firstDate, secondDate];
};
```

**Changes:**
- Try parsing as relative date first via `parseRelativeDate()`
- Fall back to absolute date parsing with `new Date()` if not relative
- Preserves backward compatibility - all existing absolute dates still work

### Phase 2: Testing & Validation

#### 2.1: Manual Testing

Test these URLs:

```
#c/created/after/3-days-ago
#c/created/after/last-monday
#c/updated/before/yesterday
#c/created/between/2-weeks-ago/yesterday
#c/created/after/today
#c/created/after/1-month-ago
```

Verify:
- Filters work correctly
- Date comparison logic is accurate
- Edge cases (weekends, month boundaries) handled properly

#### 2.2: Edge Cases to Consider

1. **"last-monday" when today IS Monday** → should return last week's Monday (7 days ago)
2. **"0-days-ago"** → should be treated as "today"
3. **Month boundaries** → "30-days-ago" when it's March 2nd should handle correctly
4. **Leap years** → "1-year-ago" should handle Feb 29
5. **Invalid numbers** → "abc-days-ago" should return null and fall back to `new Date("abc-days-ago")` = Invalid Date
6. **Plural handling** → Support both "1-day-ago" and "1-days-ago"

#### 2.3: Validation Function (Optional)

Could add a validation helper:

```typescript
export const isValidRelativeDateString = (str: string): boolean => {
  return parseRelativeDate(str) !== null;
}
```

Use for:
- UI feedback (if we add relative date input UI)
- Debugging/logging
- Future autocomplete features

### Phase 3: Documentation & Future Enhancements

#### 3.1: Documentation

Add to appropriate location (README or docs):

**Supported Relative Date Formats:**
- `today` - Midnight of current day
- `yesterday` - Midnight of previous day
- `N-days-ago` - N days before today
- `N-weeks-ago` - N weeks before today
- `N-months-ago` - N months before today
- `N-years-ago` - N years before today
- `last-monday` through `last-sunday` - Most recent occurrence of that weekday

**Examples:**
- `#c/created/after/7-days-ago` - Cards created in the last week
- `#c/updated/after/last-monday` - Cards updated since last Monday
- `#c/created/between/1-month-ago/yesterday` - Cards created in the last month

#### 3.2: Future UI Enhancements (Not in Initial Implementation)

**Option A: Preset Buttons**
Add quick-select buttons next to date picker:
- [Today] [Yesterday] [Last Week] [Last Month]

**Option B: Dual-mode Input**
Toggle between:
- Date picker mode (absolute dates)
- Text input mode (relative dates with autocomplete)

**Option C: Smart Input**
Single input that:
- Shows date picker for absolute dates
- Accepts text for relative dates
- Provides autocomplete suggestions

**Option D: Relative Date Builder**
Dropdown UI:
- Select amount: [3]
- Select unit: [days]
- Select direction: [ago]
- Result: `3-days-ago`

---

## Files to Modify

### Core Implementation

| File | Function | Changes | Lines |
|------|----------|---------|-------|
| `src/filters.ts` | NEW: `parseRelativeDate()` | Add new function | ~258 (before `parseDateSection`) |
| `src/filters.ts` | `parseDateSection()` | Add relative date detection | 259-269 → 259-285 |

### Testing

| File | Changes |
|------|---------|
| (New) `test/filters/relative-dates.js` | Unit tests for `parseRelativeDate()` |

### Documentation

| File | Changes |
|------|---------|
| `README.md` or docs | Document relative date filter syntax |

---

## Risks & Mitigations

### Risk 1: Timezone Issues

**Problem:** Relative dates calculated at midnight in user's local timezone may not align with card timestamps (which are UTC)

**Mitigation:**
- Use `setHours(0, 0, 0, 0)` to normalize to midnight
- Document behavior
- Future: Could add timezone configuration option

### Risk 2: Performance

**Problem:** `parseRelativeDate()` called for every date string on every page load

**Mitigation:**
- Regex matching is fast
- Date calculations are trivial
- Only called during filter setup, not per-card
- No significant performance impact expected

### Risk 3: Ambiguity in "last-X"

**Problem:** Does "last-monday" include today if today is Monday?

**Decision:** No - "last-monday" always refers to the most recent PAST Monday, not including today. If today is Monday, it returns 7 days ago.

**Rationale:**
- More intuitive for "after/last-monday" filters
- Consistent with "yesterday" not meaning "today"

### Risk 4: Month/Year Calculations

**Problem:** "1-month-ago" from Jan 31 is ambiguous (Dec 31 or Dec 30/29/28?)

**Mitigation:**
- Use JavaScript's built-in `setMonth()` which handles this automatically
- JavaScript resolves Jan 31 → setMonth(-1) → Dec 31 (correct behavior)
- Document this behavior if needed

---

## Success Criteria

✅ All existing date filters continue to work (backward compatibility)
✅ URL `created/after/3-days-ago` successfully filters cards
✅ URL `created/after/last-monday` successfully filters cards
✅ Relative dates recalculate on each page load (dynamic behavior)
✅ Invalid relative date strings fall back to absolute date parsing
✅ Edge cases (month boundaries, weekends) handled correctly

---

## Implementation Effort Estimate

**Core functionality:** ~2-3 hours
- Write `parseRelativeDate()`: 1 hour
- Modify `parseDateSection()`: 15 minutes
- Testing & debugging: 1-2 hours

**Documentation:** ~30 minutes

**Total:** ~3 hours for initial implementation

**Future UI enhancements:** 3-8 hours depending on approach

---

## Open Questions

1. **Should we support "next-monday" or "tomorrow"?**
   - Probably not needed for typical "created/updated" filters
   - Could add if use cases emerge

2. **Should we support "this-week" or "this-month"?**
   - Ambiguous start date (Sunday vs Monday for weeks)
   - Better to use explicit "7-days-ago" or "last-sunday"

3. **Should relative dates be case-insensitive?**
   - Current plan: case-sensitive (lowercase only)
   - Could add `.toLowerCase()` if needed

4. **Should we validate/warn about Invalid Dates?**
   - Current system silently creates Invalid Date objects
   - Could add console warnings
   - Not critical for initial implementation

---

## Backwards Compatibility

✅ **100% backward compatible**

- All existing absolute date URLs continue to work unchanged
- `parseRelativeDate()` returns `null` for non-relative formats
- Falls back to existing `new Date()` parsing
- No changes to `makeDateSection()` (still outputs absolute dates)
- No UI changes required
- No changes to filter factory functions

Users can immediately start using relative dates by manually editing URLs, while all existing bookmarks, links, and workflows remain functional.
