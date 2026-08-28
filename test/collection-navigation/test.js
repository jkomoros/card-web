/*eslint-env node*/

import assert from 'assert';
import {describe, it} from 'node:test';

import {
	commitPathDroppingLostCard,
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

//Spec §Navigation to selected card. A commit that changed a key-card anchor so
//the previously-selected card left the new collection used to push the old card
//suffix anyway: the URL named a card the collection has no index for, the stage
//went on rendering it, the drawer highlighted nothing, and ArrowUp/ArrowDown —
//which step by that index — did nothing at all.
describe('committing a collection that ejects the selected card', () => {
	it('drops the suffix so the router selects the default item', () => {
		assert.strictEqual(
			commitPathDroppingLostCard('/c/starred/card-a', 'card-a', false),
			'/c/starred/'
		);
	});

	it('keeps the card when it survives into the destination', () => {
		assert.strictEqual(
			commitPathDroppingLostCard('/c/starred/card-a', 'card-a', true),
			'/c/starred/card-a'
		);
	});

	it('leaves a path with no card of its own alone', () => {
		assert.strictEqual(commitPathDroppingLostCard('/c/starred/', '', false), '/c/starred/');
		//The internal placeholder already means "the default item", so there is
		//nothing to strand and nothing to drop.
		assert.strictEqual(commitPathDroppingLostCard('/c/starred/_', '_', false), '/c/starred/_');
	});

	it('refuses to mangle a path the card is not a suffix of', () => {
		assert.strictEqual(
			commitPathDroppingLostCard('/c/starred/card-a/', 'card-a', false),
			'/c/starred/card-a/'
		);
	});
});
