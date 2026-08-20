/*eslint-env node, es2020*/

//Pins the #761 fix: a bulk import must read top-to-bottom in paste order
//under sort/recent. The mechanism is a shared per-group timestamp on the
//recency-driving fields (created / updated_substantive / updated_message),
//which makes the recency comparator tie for the whole group so ordering
//falls through to the base set's sort_order (descending in paste order).
//`updated` stays a server timestamp — the create rule requires it and
//watermark delta sync keys on it.

import {
	JSDOM
} from 'jsdom';

import assert from 'assert';

import {
	readFileSync
} from 'fs';

const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

let CollectionDescription;

const ts = (seconds) => ({seconds, nanoseconds: 0});

const card = (id, sortOrder, extras) => ({
	id,
	card_type: 'working-notes',
	title: 'Title of ' + id,
	body: '<p>Body of ' + id + '</p>',
	section: '',
	tags: [],
	sort_order: sortOrder,
	references: {},
	references_info: {},
	references_inbound: {},
	references_info_inbound: {},
	auto_todo_overrides: {},
	published: false,
	...extras,
});

describe('bulk import ordering under sort/recent (#761)', () => {
	before(async () => {
		({CollectionDescription} = await import('../../lib/src/collection_description.js'));
	});

	after(() => {
		dom.window.close();
	});

	it('a group sharing one timestamp sorts by sort_order (paste order), first pasted on top', () => {
		//Simulates what bulkCreateWorkingNotes now produces: descending
		//sort_order in paste order, identical recency timestamps. An older,
		//unrelated card sits below; a newer edit sits above.
		const shared = ts(1_000_000);
		const cards = {
			older: card('older', 50, {updated_substantive: ts(500_000)}),
			newer: card('newer', 40, {updated_substantive: ts(2_000_000)}),
			//Paste order first→last: p1, p2, p3 with DESCENDING sort_order.
			p3: card('p3', 8, {updated_substantive: shared}),
			p1: card('p1', 10, {updated_substantive: shared}),
			p2: card('p2', 9, {updated_substantive: shared}),
		};
		const description = new CollectionDescription('everything', [], 'recent');
		//Set projections guarantee the base set is ordered by sort_order
		//descending (set-projections.ts); the tie fall-through relies on it.
		const setOrder = Object.keys(cards).sort((a, b) => cards[b].sort_order - cards[a].sort_order);
		const collection = description.collection({
			cards,
			sets: {main: [], 'reading-list': [], everything: setOrder},
			filters: {},
			sections: {},
			fallbacks: {},
			startCards: {},
		});
		assert.deepStrictEqual(
			collection.finalSortedCards.map(c => c.id),
			['newer', 'p1', 'p2', 'p3', 'older'],
			'tied recency must fall through to sort_order, keeping paste order');
	});

	it('bulkCreateWorkingNotes stamps one shared client timestamp per group', () => {
		//Structural pin (source-text convention, as in test/dev-serve): the
		//shared stamp must be taken ONCE per import, outside the per-body
		//loop, and applied to exactly the three fields the recency/created
		//sorts read — never to `updated`, which rules require to be the
		//request server-time.
		const source = readFileSync(new URL('../../src/actions/data.ts', import.meta.url), 'utf8');
		const fnStart = source.indexOf('export const bulkCreateWorkingNotes');
		assert.ok(fnStart >= 0);
		const fnSource = source.slice(fnStart, source.indexOf('\nexport const', fnStart + 10));
		assert.ok(fnSource.includes('const importTimestamp = Timestamp.now();'),
			'bulk import must take one shared timestamp per group');
		const loopStart = fnSource.indexOf('for (const body of bodies)');
		assert.ok(loopStart >= 0);
		assert.ok(fnSource.indexOf('const importTimestamp') < loopStart,
			'the shared timestamp must be taken before the per-body loop');
		for (const field of ['created', 'updated_substantive', 'updated_message']) {
			assert.ok(fnSource.includes(`obj.${field} = importTimestamp;`),
				`bulk import must stamp ${field} with the shared timestamp`);
		}
		assert.ok(!fnSource.includes('obj.updated = importTimestamp'),
			'`updated` must remain a server timestamp (rules + watermark sync)');
	});
});
