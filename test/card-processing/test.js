/*eslint-env node*/

import assert from 'assert';
import {JSDOM} from 'jsdom';

import {overrideDocument} from '../../lib/shared/document.js';

const dom = new JSDOM('');
overrideDocument(dom.window.document);

import {
	lazyProcessCards,
	processCards,
} from '../../lib/src/card-processing.js';

const rawCard = (id, title) => ({
	id,
	title,
	body: `<p>${title} body</p>`,
	card_type: 'content',
	author: 'author',
	collaborators: [],
	tags: [],
	references: {},
	references_info: {},
	references_info_inbound: {},
	auto_todo_overrides: {},
	published: false,
});

const observedCard = (card, observations) => new Proxy(card, {
	get(target, property, receiver) {
		observations.count++;
		return Reflect.get(target, property, receiver);
	},
});

describe('lazy card processing', () => {
	it('processes only a directly requested card', () => {
		const firstReads = {count: 0};
		const secondReads = {count: 0};
		const raw = {
			first: observedCard(rawCard('first', 'First'), firstReads),
			second: observedCard(rawCard('second', 'Second'), secondReads),
		};

		const cards = lazyProcessCards(raw);
		assert.strictEqual(firstReads.count, 0);
		assert.strictEqual(secondReads.count, 0);
		assert.deepStrictEqual(Object.keys(cards), ['first', 'second']);
		assert.strictEqual(firstReads.count, 0, 'enumerating IDs must remain lazy');
		assert.strictEqual(secondReads.count, 0, 'enumerating IDs must remain lazy');

		assert.strictEqual(cards.first.title, 'First');
		assert(firstReads.count > 0, 'the requested card should be processed');
		assert.strictEqual(secondReads.count, 0, 'an unrelated card must stay unprocessed');
		assert.strictEqual(cards.first, cards.first, 'processed-card identity should be cached');
	});

	it('preserves the complete object enumeration surface', () => {
		const raw = {
			first: rawCard('first', 'First'),
			second: rawCard('second', 'Second'),
		};
		const eager = processCards(raw);
		const lazy = lazyProcessCards(raw);

		assert.deepStrictEqual(Object.keys(lazy), Object.keys(eager));
		assert.deepStrictEqual(Object.values(lazy), Object.values(eager));
		assert.deepStrictEqual(Object.entries(lazy), Object.entries(eager));
		assert.deepStrictEqual({...lazy}, eager);
		assert.strictEqual(JSON.stringify(lazy), JSON.stringify(eager));
		assert.strictEqual('first' in lazy, true);
		assert.strictEqual(Object.prototype.hasOwnProperty.call(lazy, 'second'), true);
		assert.strictEqual(lazy.missing, undefined);
		assert.strictEqual('missing' in lazy, false);
	});

	it('is stable for one raw map and refreshes when that map changes', () => {
		const first = rawCard('first', 'First');
		const raw = {first};
		const initial = lazyProcessCards(raw);
		assert.strictEqual(lazyProcessCards(raw), initial);

		const unchangedMap = {first};
		const unchanged = lazyProcessCards(unchangedMap);
		assert.notStrictEqual(unchanged, initial, 'a new raw-map identity needs a new lazy view');
		assert.strictEqual(unchanged.first, initial.first, 'unchanged card objects reuse processed identity');

		const changedMap = {first: rawCard('first', 'Changed')};
		const changed = lazyProcessCards(changedMap);
		assert.notStrictEqual(changed.first, initial.first);
		assert.strictEqual(changed.first.title, 'Changed');
	});
});
