/*eslint-env node*/

import assert from 'assert';
import {describe, it} from 'node:test';

import {
	resolveCardRequest,
	resolveInvalidCollectionCard,
	shouldRefreshCollectionSnapshot,
} from '../../src/collection-navigation.ts';

describe('collection placeholder navigation', () => {
	it('records placeholder intent while the target collection is empty', () => {
		assert.deepStrictEqual(
			resolveCardRequest('_', '_', 'previous-card', []),
			{cardID: 'previous-card', commit: true, collectionPending: true}
		);
	});

	it('selects the first card when target membership arrives', () => {
		assert.deepStrictEqual(
			resolveInvalidCollectionCard('_', 'previous-card', ['new-card', 'another-card']),
			{action: 'select-first'}
		);
		assert.deepStrictEqual(
			resolveCardRequest('_', '_', 'previous-card', ['new-card', 'another-card']),
			{cardID: 'new-card', commit: true, collectionPending: false}
		);
	});

	it('refreshes a fully-loaded snapshot while placeholder navigation is pending', () => {
		assert.strictEqual(shouldRefreshCollectionSnapshot({
			dataFullyLoaded: true,
			alreadyCommittedWhenFullyLoaded: true,
			forceCommit: false,
			requestedCard: '_',
			activeCollectionSize: 0,
		}), true);
	});

	it('preserves stable snapshots for nonempty collections', () => {
		assert.strictEqual(shouldRefreshCollectionSnapshot({
			dataFullyLoaded: true,
			alreadyCommittedWhenFullyLoaded: true,
			forceCommit: false,
			requestedCard: '_',
			activeCollectionSize: 2,
		}), false);
	});

	it('stays in the collection after selecting one of its cards', () => {
		assert.deepStrictEqual(
			resolveInvalidCollectionCard('_', 'new-card', ['new-card', 'another-card']),
			{action: 'stay'}
		);
	});

	it('preserves explicit-card redirect behavior', () => {
		assert.deepStrictEqual(
			resolveInvalidCollectionCard('previous-card', 'previous-card', ['new-card']),
			{action: 'default-card'}
		);
	});
});
