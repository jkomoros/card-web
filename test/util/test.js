/*eslint-env node*/

import {
	cardIsPrioritized
} from '../../lib/src/util.js';

import assert from 'assert';

describe('cardIsPrioritized', () => {
	it('returns false for null card', async () => {
		assert.strictEqual(cardIsPrioritized(null), false);
	});

	it('returns true when auto_todo_overrides.prioritized === false (inverted semantics)', async () => {
		const card = { auto_todo_overrides: { prioritized: false } };
		assert.strictEqual(cardIsPrioritized(card), true);
	});

	it('returns false when auto_todo_overrides.prioritized === true', async () => {
		const card = { auto_todo_overrides: { prioritized: true } };
		assert.strictEqual(cardIsPrioritized(card), false);
	});

	it('returns false when auto_todo_overrides.prioritized === undefined', async () => {
		const card = { auto_todo_overrides: {} };
		assert.strictEqual(cardIsPrioritized(card), false);
	});

	it('returns false when auto_todo_overrides.prioritized === null', async () => {
		const card = { auto_todo_overrides: { prioritized: null } };
		assert.strictEqual(cardIsPrioritized(card), false);
	});

	it('returns false when auto_todo_overrides.prioritized === 0 (strict false check, not falsy)', async () => {
		const card = { auto_todo_overrides: { prioritized: 0 } };
		assert.strictEqual(cardIsPrioritized(card), false);
	});
});
