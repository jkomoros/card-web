/*eslint-env node*/

import assert from 'assert';
import { describe, it } from 'node:test';

import { CardSelectionAnchor, cardSelectionRange } from '../../src/card_selection.ts';

describe('cardSelectionRange', () => {
	const cards = ['a', 'b', 'c', 'd'];

	it('returns an inclusive forward range', () => {
		assert.deepStrictEqual(cardSelectionRange(cards, 'a', 'c'), ['a', 'b', 'c']);
	});

	it('returns an inclusive reverse range in drawer order', () => {
		assert.deepStrictEqual(cardSelectionRange(cards, 'd', 'b'), ['b', 'c', 'd']);
	});

	it('returns just the target when it is also the anchor', () => {
		assert.deepStrictEqual(cardSelectionRange(cards, 'b', 'b'), ['b']);
	});

	it('returns just the target when there is no valid anchor', () => {
		assert.deepStrictEqual(cardSelectionRange(cards, null, 'c'), ['c']);
		assert.deepStrictEqual(cardSelectionRange(cards, 'old-card', 'c'), ['c']);
	});
});

describe('CardSelectionAnchor', () => {
	const cards = ['a', 'b', 'c', 'd'];

	it('uses the most recent ordinary click as the Shift-click anchor', () => {
		const anchor = new CardSelectionAnchor();
		assert.deepStrictEqual(anchor.cardsForClick(cards, 'b', false), ['b']);
		assert.deepStrictEqual(anchor.cardsForClick(cards, 'd', true), ['b', 'c', 'd']);
	});

	it('supports reverse Shift-click sequences', () => {
		const anchor = new CardSelectionAnchor();
		anchor.cardsForClick(cards, 'd', false);
		assert.deepStrictEqual(anchor.cardsForClick(cards, 'b', true), ['b', 'c', 'd']);
	});

	it('falls back to one card after the anchor is reset', () => {
		const anchor = new CardSelectionAnchor();
		anchor.cardsForClick(cards, 'a', false);
		anchor.reset();
		assert.deepStrictEqual(anchor.cardsForClick(cards, 'c', true), ['c']);
	});

	it('falls back to one card when the drawer order changes', () => {
		const anchor = new CardSelectionAnchor();
		anchor.cardsForClick(cards, 'a', false);
		assert.deepStrictEqual(anchor.cardsForClick(['d', 'c', 'b', 'a'], 'c', true), ['c']);
	});
});
