import assert from 'assert';

import {
	recoveryIDsForGroupOutcomes,
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

	it('rolls back when Redux still holds the exact prior object (echo was enqueue-gated and never applied)', () => {
		//The optimistic echo often never reaches Redux: receiveCards
		//enqueues while a commit is pending, and dedupe drops updated-only
		//echoes entirely. Redux then still holds the PRIOR object — the
		//rollback must still be dispatched (it corrects the worker corpus,
		//which applied the echo unconditionally, and enqueue-merges over the
		//phantom optimistic entry). Identity, not equivalence: a listener
		//delivering different content produces a different object and is
		//correctly skipped (previous test).
		const prior = card('a', 'before');
		const result = rollbackCardsStillOptimistic(
			{a: prior},
			{a: card('a', 'optimistic')},
			{a: prior},
			equivalent,
		);
		assert.deepStrictEqual(result, {a: prior});
	});

	it('preserves a server-confirmed echo with identical content but a newer version', () => {
		const versionedCard = (id, body, version) => ({id, body, version});
		const result = rollbackCardsStillOptimistic(
			{a: versionedCard('a', 'before', 1)},
			{a: versionedCard('a', 'same edit', 2)},
			{a: versionedCard('a', 'same edit', 3)},
			(a, b) => a.body === b.body && a.version === b.version,
		);
		assert.deepStrictEqual(result, {});
	});
});

describe('partial batch recovery classification', () => {
	it('requires no reads when every group failed', () => {
		const result = recoveryIDsForGroupOutcomes(
			{a: ['a', 'inbound-a'], b: ['b']},
			[],
			['a', 'b'],
		);
		assert.deepStrictEqual(result, {
			failedOnlyIDs: ['a', 'inbound-a', 'b'],
			ambiguousIDs: [],
		});
	});

	it('reads only cards shared by successful and failed groups', () => {
		const result = recoveryIDsForGroupOutcomes(
			{a: ['a', 'shared-inbound'], b: ['b', 'shared-inbound']},
			['a'],
			['b'],
		);
		assert.deepStrictEqual(result, {
			failedOnlyIDs: ['b'],
			ambiguousIDs: ['shared-inbound'],
		});
	});
});
