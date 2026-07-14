import assert from 'assert';

import {
	rollbackCardsStillOptimistic,
} from '../../lib/src/edit-recovery.js';

const card = (id, body) => ({id, body});
const equivalent = (a, b) => a.body === b.body;

describe('failed edit rollback', () => {
	it('restores a card that still contains this attempt optimistic state', () => {
		const result = rollbackCardsStillOptimistic(
			{a: card('a', 'before')},
			{a: card('a', 'optimistic')},
			{a: card('a', 'optimistic')},
			equivalent,
		);
		assert.deepStrictEqual(result, {a: card('a', 'before')});
	});

	it('does not overwrite a newer listener delivery', () => {
		const result = rollbackCardsStillOptimistic(
			{a: card('a', 'before')},
			{a: card('a', 'optimistic')},
			{a: card('a', 'newer remote edit')},
			equivalent,
		);
		assert.deepStrictEqual(result, {});
	});

	it('evaluates every affected card independently', () => {
		const result = rollbackCardsStillOptimistic(
			{a: card('a', 'before a'), b: card('b', 'before b')},
			{a: card('a', 'optimistic a'), b: card('b', 'optimistic b')},
			{a: card('a', 'remote a'), b: card('b', 'optimistic b')},
			equivalent,
		);
		assert.deepStrictEqual(result, {b: card('b', 'before b')});
	});
});
