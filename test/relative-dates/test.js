/*eslint-env node*/

import assert from 'assert';
import {describe, it} from 'node:test';

import {
	dateMatchesFilter,
	makeFilterDateResolver,
	parseRelativeDate,
	relativeDateCacheKey,
} from '../../src/relative-date.ts';

const assertLocalDate = (actual, year, month, day) => {
	assert.strictEqual(actual.getFullYear(), year);
	assert.strictEqual(actual.getMonth(), month);
	assert.strictEqual(actual.getDate(), day);
	assert.strictEqual(actual.getHours(), 0);
	assert.strictEqual(actual.getMinutes(), 0);
	assert.strictEqual(actual.getSeconds(), 0);
	assert.strictEqual(actual.getMilliseconds(), 0);
};

describe('relative date filters', () => {
	it('parses special and offset relative dates from local midnight', () => {
		const reference = new Date(2026, 6, 17, 15, 30);

		assertLocalDate(parseRelativeDate('today', reference), 2026, 6, 17);
		assertLocalDate(parseRelativeDate('yesterday', reference), 2026, 6, 16);
		assertLocalDate(parseRelativeDate('3-days-ago', reference), 2026, 6, 14);
		assertLocalDate(parseRelativeDate('2-weeks-ago', reference), 2026, 6, 3);
		assertLocalDate(parseRelativeDate('1-month-ago', reference), 2026, 5, 17);
		assertLocalDate(parseRelativeDate('1-year-ago', reference), 2025, 6, 17);
	});

	it('parses last-weekday as the most recent past occurrence', () => {
		const friday = new Date(2026, 6, 17, 15, 30);

		assertLocalDate(parseRelativeDate('last-monday', friday), 2026, 6, 13);
		assertLocalDate(parseRelativeDate('last-friday', friday), 2026, 6, 10);
	});

	it('applies relative dates to before, after, and between comparisons', () => {
		const RealDate = Date;
		const now = new RealDate(2026, 6, 17, 15, 30).getTime();
		global.Date = class extends RealDate {
			constructor(...args) {
				super(...(args.length ? args : [now]));
			}
			static now() {
				return now;
			}
		};

		try {
			const afterMonday = new RealDate(2026, 6, 14, 12).getTime();
			const beforeMonday = new RealDate(2026, 6, 12, 12).getTime();
			const lastMonday = makeFilterDateResolver('last-monday');
			const yesterday = makeFilterDateResolver('yesterday');
			const sevenDaysAgo = makeFilterDateResolver('7-days-ago');
			const today = makeFilterDateResolver('today');

			assert.strictEqual(dateMatchesFilter(afterMonday, 'after', lastMonday, () => null), true);
			assert.strictEqual(dateMatchesFilter(beforeMonday, 'after', lastMonday, () => null), false);
			assert.strictEqual(dateMatchesFilter(beforeMonday, 'before', yesterday, () => null), true);
			assert.strictEqual(dateMatchesFilter(afterMonday, 'between', sevenDaysAgo, today), true);
		} finally {
			global.Date = RealDate;
		}
	});

	it('refreshes memoized relative filters after local midnight', () => {
		const RealDate = Date;
		let now = new RealDate(2026, 6, 13, 12).getTime();
		global.Date = class extends RealDate {
			constructor(...args) {
				super(...(args.length ? args : [now]));
			}
			static now() {
				return now;
			}
		};

		try {
			const cardDate = new RealDate(2026, 6, 10, 12).getTime();
			const resolveLastMonday = makeFilterDateResolver('last-monday');
			assert.strictEqual(dateMatchesFilter(cardDate, 'after', resolveLastMonday, () => null), true);

			now = new RealDate(2026, 6, 21, 12).getTime();
			assert.strictEqual(dateMatchesFilter(cardDate, 'after', resolveLastMonday, () => null), false);
		} finally {
			global.Date = RealDate;
		}
	});

	it('keeps collection cache keys stable until the local date changes', () => {
		assert.strictEqual(
			relativeDateCacheKey(new Date(2026, 6, 17, 0, 1)),
			relativeDateCacheKey(new Date(2026, 6, 17, 23, 59))
		);
		assert.notStrictEqual(
			relativeDateCacheKey(new Date(2026, 6, 17, 23, 59)),
			relativeDateCacheKey(new Date(2026, 6, 18, 0, 0))
		);
	});
});
