/*eslint-env node*/

//Tests for the cold-sweep budget math.

import assert from 'assert';

let pacificDayKey;
let msUntilNextPacificDay;
let rolledOverReads;
let budgetExhausted;
let COLD_SWEEP_DAILY_BUDGET;

describe('cold-budget', () => {
	before(async () => {
		({pacificDayKey, msUntilNextPacificDay, rolledOverReads, budgetExhausted, COLD_SWEEP_DAILY_BUDGET} = await import('../../lib/src/worker/cold-budget.js'));
	});

	it('day key is the UTC-8 calendar day', () => {
		//2026-07-05T07:59Z is still 2026-07-04 in UTC-8; 08:01Z is 07-05.
		assert.strictEqual(pacificDayKey(Date.UTC(2026, 6, 5, 7, 59)), '2026-07-04');
		assert.strictEqual(pacificDayKey(Date.UTC(2026, 6, 5, 8, 1)), '2026-07-05');
	});

	it('msUntilNextPacificDay lands just past the boundary', () => {
		const now = Date.UTC(2026, 6, 5, 7, 0); //1h before the UTC-8 boundary
		const wait = msUntilNextPacificDay(now);
		assert.ok(wait > 60 * 60 * 1000 && wait <= 61 * 60 * 1000 + 1000, String(wait));
		assert.strictEqual(pacificDayKey(now + wait), '2026-07-05');
	});

	it('read counter rolls over on a new quota day', () => {
		const now = Date.UTC(2026, 6, 5, 12, 0);
		const sameDay = rolledOverReads(30000, '2026-07-05', now);
		assert.deepStrictEqual(sameDay, {readsToday: 30000, day: '2026-07-05'});
		const nextDay = rolledOverReads(30000, '2026-07-04', now);
		assert.deepStrictEqual(nextDay, {readsToday: 0, day: '2026-07-05'});
	});

	it('budget exhaustion threshold', () => {
		assert.strictEqual(budgetExhausted(COLD_SWEEP_DAILY_BUDGET - 1), false);
		assert.strictEqual(budgetExhausted(COLD_SWEEP_DAILY_BUDGET), true);
	});
});
