# Implementation Plan: Relative Date UI with Dropdowns

## Overview

Implement a mode selector in `configure-collection-date.ts` that switches between:
- **Absolute mode**: Existing date picker
- **Relative mode**: Dropdown-based UI for building relative date strings

## UI Design

### Structure

```
[Comparison Type ▼]  ( ) Absolute  (•) Relative

─── When Absolute Mode ───
[2025-12-07 📅]

─── When Relative Mode ───
Type: [Offset ▼]
      [3] [days ▼] ago

─── Or Weekday Type ───
Type: [Weekday ▼]
      last [monday ▼]

─── Or Special Type ───
Type: [Special ▼]
      [yesterday ▼]
```

### Relative Date Types

1. **Offset** → `N-unit-ago` format
   - Number: 1-999
   - Unit: days, weeks, months, years
   - Output: `3-days-ago`, `2-weeks-ago`

2. **Weekday** → `last-weekday` format
   - Weekday: monday through sunday
   - Output: `last-monday`, `last-friday`

3. **Special** → keywords
   - Options: today, yesterday
   - Output: `today`, `yesterday`

---

## Implementation Steps

### Step 1: Add Helper Functions to `filters.ts`

#### 1.1: Core Relative Date Parser

```typescript
/**
 * Parses a relative date string into an absolute Date object.
 * Returns null if the string is not a recognized relative date format.
 */
export const parseRelativeDate = (str: string): Date | null => {
	if (!str) return null;

	// Special keywords
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

	// Offset-based: N-days-ago, N-weeks-ago, etc.
	// Support both singular and plural: 1-day-ago, 2-days-ago
	const offsetMatch = str.match(/^(\d+)-(day|week|month|year)s?-ago$/);
	if (offsetMatch) {
		const amount = parseInt(offsetMatch[1], 10);
		const unit = offsetMatch[2];
		const d = new Date();
		d.setHours(0, 0, 0, 0);

		switch(unit) {
		case 'day':
			d.setDate(d.getDate() - amount);
			break;
		case 'week':
			d.setDate(d.getDate() - (amount * 7));
			break;
		case 'month':
			d.setMonth(d.getMonth() - amount);
			break;
		case 'year':
			d.setFullYear(d.getFullYear() - amount);
			break;
		}

		return d;
	}

	// Weekday-based: last-monday, last-tuesday, etc.
	const weekdayMatch = str.match(/^last-(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
	if (weekdayMatch) {
		const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
		const targetDay = weekdays.indexOf(weekdayMatch[1]);

		const d = new Date();
		d.setHours(0, 0, 0, 0);
		const currentDay = d.getDay();

		// Calculate days to go back
		// If today is Wednesday (3) and we want last Monday (1): (3 - 1) = 2
		// If today is Monday (1) and we want last Monday (1): we want 7 days back, not 0
		let daysBack = ((currentDay - targetDay + 7) % 7) || 7;

		d.setDate(d.getDate() - daysBack);
		return d;
	}

	// Not a relative date format
	return null;
};
```

#### 1.2: Detection Helper

```typescript
/**
 * Returns true if the string is a valid relative date format.
 */
export const isRelativeDate = (str: string): boolean => {
	return parseRelativeDate(str) !== null;
};
```

#### 1.3: Relative Date Type Detection

```typescript
export type RelativeDateType = 'offset' | 'weekday' | 'special';

export type RelativeDateParts = {
	type: 'offset';
	amount: number;
	unit: 'day' | 'week' | 'month' | 'year';
} | {
	type: 'weekday';
	weekday: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
} | {
	type: 'special';
	value: 'today' | 'yesterday';
};

/**
 * Parses a relative date string into its component parts for UI editing.
 * Returns null if not a valid relative date.
 */
export const parseRelativeDateParts = (str: string): RelativeDateParts | null => {
	if (!str) return null;

	// Special keywords
	if (str === 'today') {
		return { type: 'special', value: 'today' };
	}
	if (str === 'yesterday') {
		return { type: 'special', value: 'yesterday' };
	}

	// Offset-based
	const offsetMatch = str.match(/^(\d+)-(day|week|month|year)s?-ago$/);
	if (offsetMatch) {
		return {
			type: 'offset',
			amount: parseInt(offsetMatch[1], 10),
			unit: offsetMatch[2] as 'day' | 'week' | 'month' | 'year'
		};
	}

	// Weekday-based
	const weekdayMatch = str.match(/^last-(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
	if (weekdayMatch) {
		return {
			type: 'weekday',
			weekday: weekdayMatch[1] as 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
		};
	}

	return null;
};
```

#### 1.4: Relative Date String Constructor

```typescript
/**
 * Constructs a relative date string from component parts.
 */
export const makeRelativeDateString = (parts: RelativeDateParts): string => {
	switch (parts.type) {
	case 'special':
		return parts.value;
	case 'offset': {
		// Use plural form for amounts != 1
		const unit = parts.amount === 1 ? parts.unit : `${parts.unit}s`;
		return `${parts.amount}-${unit}-ago`;
	}
	case 'weekday':
		return `last-${parts.weekday}`;
	default:
		return '';
	}
};
```

#### 1.5: Update `parseDateSection()`

```typescript
export const parseDateSection = (str : string) : [dateType : DateRangeType, firstDate : Date, secondDate : Date] => {
	let pieces = str.split('/');
	const targetLength = CONFIGURABLE_FILTER_URL_PARTS[pieces[0]] + 1;
	pieces = pieces.slice(0, targetLength);
	let firstDate = new Date();
	let secondDate = new Date();

	if (pieces.length > 1) {
		// Try parsing as relative date first
		const relativeDate = parseRelativeDate(pieces[1]);
		firstDate = relativeDate !== null ? relativeDate : new Date(pieces[1]);
	}

	if (pieces.length > 2 && pieces[2]) {
		// Try parsing as relative date first
		const relativeDate = parseRelativeDate(pieces[2]);
		secondDate = relativeDate !== null ? relativeDate : new Date(pieces[2]);
	} else if (pieces.length > 2) {
		secondDate = new Date();
	}

	return [pieces[0] as DateRangeType, firstDate, secondDate];
};
```

---

### Step 2: Update `configure-collection-date.ts`

#### 2.1: Add Properties

```typescript
@property({ type: String })
	value: string;

@property({ type: Boolean })
	_relativeMode: boolean = false;

@property({ type: String })
	_relativeType: RelativeDateType = 'offset';

@property({ type: Number })
	_offsetAmount: number = 3;

@property({ type: String })
	_offsetUnit: 'day' | 'week' | 'month' | 'year' = 'day';

@property({ type: String })
	_weekday: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday' = 'monday';

@property({ type: String })
	_special: 'today' | 'yesterday' = 'yesterday';
```

#### 2.2: Detect Mode on Value Change

```typescript
override willUpdate(changedProperties: PropertyValues) {
	super.willUpdate(changedProperties);

	if (changedProperties.has('value')) {
		// Parse the value to detect if it contains relative dates
		const pieces = this.value.split('/');
		const firstDateStr = pieces[1] || '';

		if (isRelativeDate(firstDateStr)) {
			this._relativeMode = true;
			this._loadRelativeDateParts(firstDateStr);
		} else {
			this._relativeMode = false;
		}
	}
}

_loadRelativeDateParts(dateStr: string) {
	const parts = parseRelativeDateParts(dateStr);
	if (!parts) return;

	this._relativeType = parts.type;

	switch (parts.type) {
	case 'offset':
		this._offsetAmount = parts.amount;
		this._offsetUnit = parts.unit;
		break;
	case 'weekday':
		this._weekday = parts.weekday;
		break;
	case 'special':
		this._special = parts.value;
		break;
	}
}
```

#### 2.3: Render Method

```typescript
override render() {
	const [typ, dateOne, dateTwo] = parseDateSection(this.value);
	const pieces = this.value.split('/');
	const firstDateStr = pieces[1] || '';
	const secondDateStr = pieces[2] || '';

	const typeRequiresSecondDate = CONFIGURABLE_FILTER_URL_PARTS[typ] == 2;

	return html`
		<div class="container">
			<!-- Comparison type selector -->
			<select .value=${typ} @change=${this._handleTypeChanged}>
				${dateRangeType.options.map(t => html`<option .value=${t}>${t}</option>`)}
			</select>

			<!-- Mode selector -->
			<label>
				<input
					type="radio"
					name="mode"
					value="absolute"
					?checked=${!this._relativeMode}
					@change=${this._handleModeChanged}
				>
				Absolute
			</label>
			<label>
				<input
					type="radio"
					name="mode"
					value="relative"
					?checked=${this._relativeMode}
					@change=${this._handleModeChanged}
				>
				Relative
			</label>

			<!-- First date input -->
			${this._renderDateInput(true, firstDateStr, dateOne)}

			<!-- Second date input (if needed) -->
			${typeRequiresSecondDate ? this._renderDateInput(false, secondDateStr, dateTwo) : ''}
		</div>
	`;
}

_renderDateInput(isFirst: boolean, dateStr: string, dateObj: Date) {
	if (this._relativeMode) {
		return this._renderRelativeDateInput(isFirst, dateStr);
	} else {
		return this._renderAbsoluteDateInput(isFirst, dateObj);
	}
}

_renderAbsoluteDateInput(isFirst: boolean, dateObj: Date) {
	const formatted = this._formatDateForInput(dateObj);
	return html`
		<input
			type="date"
			.value=${formatted}
			?data-first=${isFirst}
			@change=${this._handleDateChanged}
		>
	`;
}

_renderRelativeDateInput(isFirst: boolean, dateStr: string) {
	return html`
		<div class="relative-date-controls">
			<!-- Type selector -->
			<select
				.value=${this._relativeType}
				?data-first=${isFirst}
				@change=${this._handleRelativeTypeChanged}
			>
				<option value="offset">Offset</option>
				<option value="weekday">Weekday</option>
				<option value="special">Special</option>
			</select>

			<!-- Controls based on type -->
			${this._relativeType === 'offset' ? html`
				<input
					type="number"
					min="1"
					.value=${String(this._offsetAmount)}
					?data-first=${isFirst}
					@change=${this._handleOffsetAmountChanged}
				>
				<select
					.value=${this._offsetUnit}
					?data-first=${isFirst}
					@change=${this._handleOffsetUnitChanged}
				>
					<option value="day">days</option>
					<option value="week">weeks</option>
					<option value="month">months</option>
					<option value="year">years</option>
				</select>
				<span>ago</span>
			` : ''}

			${this._relativeType === 'weekday' ? html`
				<span>last</span>
				<select
					.value=${this._weekday}
					?data-first=${isFirst}
					@change=${this._handleWeekdayChanged}
				>
					<option value="monday">Monday</option>
					<option value="tuesday">Tuesday</option>
					<option value="wednesday">Wednesday</option>
					<option value="thursday">Thursday</option>
					<option value="friday">Friday</option>
					<option value="saturday">Saturday</option>
					<option value="sunday">Sunday</option>
				</select>
			` : ''}

			${this._relativeType === 'special' ? html`
				<select
					.value=${this._special}
					?data-first=${isFirst}
					@change=${this._handleSpecialChanged}
				>
					<option value="today">Today</option>
					<option value="yesterday">Yesterday</option>
				</select>
			` : ''}
		</div>
	`;
}
```

#### 2.4: Event Handlers

```typescript
_formatDateForInput(date: Date): string {
	return date.getFullYear() + '-' +
	       String(date.getMonth() + 1).padStart(2, '0') + '-' +
	       String(date.getDate()).padStart(2, '0');
}

_handleModeChanged(e: Event) {
	const ele = e.target as HTMLInputElement;
	this._relativeMode = ele.value === 'relative';

	// When switching to relative mode, initialize with sensible defaults
	if (this._relativeMode) {
		this._emitRelativeDateValue(true);
	} else {
		// When switching to absolute, use the current resolved date
		const [typ, dateOne, dateTwo] = parseDateSection(this.value);
		this._dispatchNewValue(makeDateSection(typ, dateOne, dateTwo));
	}
}

_handleTypeChanged(e: Event) {
	const ele = e.composedPath()[0];
	if (!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
	const [, dateOne, dateTwo] = parseDateSection(this.value);
	const val = dateRangeType.parse(ele.value);

	if (this._relativeMode) {
		// Preserve relative format
		const pieces = this.value.split('/');
		pieces[0] = val;
		this._dispatchNewValue(pieces.join('/'));
	} else {
		this._dispatchNewValue(makeDateSection(val, dateOne, dateTwo));
	}
}

_handleDateChanged(e: Event) {
	const ele = e.composedPath()[0];
	if (!(ele instanceof HTMLInputElement)) throw new Error('not input element');
	let [typ, dateOne, dateTwo] = parseDateSection(this.value);
	const dt = new Date(ele.value);
	if (ele.dataset.first) {
		dateOne = dt;
	} else {
		dateTwo = dt;
	}
	this._dispatchNewValue(makeDateSection(typ, dateOne, dateTwo));
}

_handleRelativeTypeChanged(e: Event) {
	const ele = e.target as HTMLSelectElement;
	this._relativeType = ele.value as RelativeDateType;
	const isFirst = (ele as HTMLSelectElement).hasAttribute('data-first');
	this._emitRelativeDateValue(isFirst);
}

_handleOffsetAmountChanged(e: Event) {
	const ele = e.target as HTMLInputElement;
	this._offsetAmount = parseInt(ele.value, 10) || 1;
	const isFirst = ele.hasAttribute('data-first');
	this._emitRelativeDateValue(isFirst);
}

_handleOffsetUnitChanged(e: Event) {
	const ele = e.target as HTMLSelectElement;
	this._offsetUnit = ele.value as 'day' | 'week' | 'month' | 'year';
	const isFirst = ele.hasAttribute('data-first');
	this._emitRelativeDateValue(isFirst);
}

_handleWeekdayChanged(e: Event) {
	const ele = e.target as HTMLSelectElement;
	this._weekday = ele.value as 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
	const isFirst = ele.hasAttribute('data-first');
	this._emitRelativeDateValue(isFirst);
}

_handleSpecialChanged(e: Event) {
	const ele = e.target as HTMLSelectElement;
	this._special = ele.value as 'today' | 'yesterday';
	const isFirst = ele.hasAttribute('data-first');
	this._emitRelativeDateValue(isFirst);
}

_emitRelativeDateValue(isFirst: boolean) {
	const pieces = this.value.split('/');
	const typ = pieces[0] as DateRangeType;

	let relativeParts: RelativeDateParts;
	switch (this._relativeType) {
	case 'offset':
		relativeParts = {
			type: 'offset',
			amount: this._offsetAmount,
			unit: this._offsetUnit
		};
		break;
	case 'weekday':
		relativeParts = {
			type: 'weekday',
			weekday: this._weekday
		};
		break;
	case 'special':
		relativeParts = {
			type: 'special',
			value: this._special
		};
		break;
	}

	const relativeStr = makeRelativeDateString(relativeParts);

	if (isFirst) {
		pieces[1] = relativeStr;
	} else {
		pieces[2] = relativeStr;
	}

	this._dispatchNewValue(pieces.join('/'));
}
```

#### 2.5: Update Styles

```typescript
static override styles = [
	ButtonSharedStyles,
	css`
		:host {
			display: inline-block;
		}
		.container {
			display: flex;
			flex-direction: row;
			align-items: center;
			gap: 8px;
			flex-wrap: wrap;
		}
		.relative-date-controls {
			display: flex;
			flex-direction: row;
			align-items: center;
			gap: 4px;
		}
		label {
			display: flex;
			align-items: center;
			gap: 4px;
			cursor: pointer;
		}
		input[type="number"] {
			width: 60px;
		}
	`
];
```

#### 2.6: Import New Functions

```typescript
import {
	parseDateSection,
	makeDateSection,
	CONFIGURABLE_FILTER_URL_PARTS,
	isRelativeDate,
	parseRelativeDateParts,
	makeRelativeDateString,
	type RelativeDateType,
	type RelativeDateParts
} from '../filters.js';

import type { PropertyValues } from 'lit';
```

---

### Step 3: Handle Second Date Input for "between" Filters

For `between` filters that need two dates, the component needs to manage two separate relative/absolute states. Options:

**Option A: Unified mode** - Both dates use the same mode (simpler)
**Option B: Independent modes** - Each date can be relative or absolute (more flexible)

**Recommendation: Option A initially**

For Option A, the mode selector applies to both dates. If you switch from absolute to relative, both dates become relative.

To implement Option B later, you'd need:
- Separate mode toggles for each date
- Track `_relativeMode1` and `_relativeMode2`
- Separate relative date state for second date

---

## Testing Scenarios

### Test Cases

1. **Create new relative filter from UI:**
   - Select "after" + Relative + Offset + 3 days
   - URL should be: `after/3-days-ago`
   - Filter should work correctly

2. **Load existing relative filter:**
   - Load URL: `created/after/last-monday`
   - UI should show: Relative mode, Weekday type, Monday selected
   - Should be editable

3. **Switch from absolute to relative:**
   - Start with absolute date
   - Switch to relative mode
   - Should initialize with sensible defaults (e.g., 3-days-ago)

4. **Switch from relative to absolute:**
   - Start with relative date (e.g., 3-days-ago)
   - Switch to absolute mode
   - Should show the resolved date (e.g., 2025-12-04)

5. **Between filter with two relative dates:**
   - Type: between
   - Date 1: 2-weeks-ago
   - Date 2: yesterday
   - URL: `between/2-weeks-ago/yesterday`

6. **Edge cases:**
   - Change comparison type while in relative mode
   - Change relative type from offset to weekday
   - Enter 0 or negative numbers in offset amount

---

## Future Enhancements

### Quick Presets
Add preset buttons for common relative dates:
```
[Yesterday] [Last Week] [Last Month] [Last Year]
```

### Validation & Feedback
- Show preview: "3 days ago = December 4, 2025"
- Highlight invalid inputs
- Suggest corrections

### Keyboard Shortcuts
- Tab navigation through dropdowns
- Enter to apply

### More Relative Formats
- "this-week", "this-month" (from start of period)
- "N-days-from-now" (future dates)
- "beginning-of-month", "end-of-month"

---

## Implementation Checklist

- [ ] Add `parseRelativeDate()` to filters.ts
- [ ] Add `isRelativeDate()` to filters.ts
- [ ] Add `parseRelativeDateParts()` to filters.ts
- [ ] Add `makeRelativeDateString()` to filters.ts
- [ ] Export `RelativeDateType` and `RelativeDateParts` types
- [ ] Update `parseDateSection()` in filters.ts
- [ ] Add properties to configure-collection-date component
- [ ] Add `willUpdate` lifecycle method
- [ ] Update render method with mode selector
- [ ] Implement `_renderDateInput()` method
- [ ] Implement `_renderAbsoluteDateInput()` method
- [ ] Implement `_renderRelativeDateInput()` method
- [ ] Add all event handlers
- [ ] Update styles
- [ ] Update imports
- [ ] Test with created filter
- [ ] Test with updated filter
- [ ] Test with last_tweeted filter
- [ ] Test between filter with two dates
- [ ] Test mode switching
- [ ] Test all relative date types (offset, weekday, special)

---

## Estimated Effort

- **filters.ts changes:** 2-3 hours
- **configure-collection-date.ts changes:** 4-5 hours
- **Testing & refinement:** 2-3 hours
- **Total:** 8-11 hours

This is a more substantial change than the minimal approach, but results in a much more user-friendly interface.
