/*eslint-env node, es2020*/

//Pins the #742/#755/#746 cluster: one shared timestampToMillis helper with
//per-caller sentinels (filters NaN, sorts 0), and the sort/default
//unknown-key assertion.

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
let SORTS;
let timestampToMillis;

const ts = (seconds) => ({seconds, nanoseconds: 0});

const card = (id, extras) => ({
	id,
	card_type: 'content',
	title: 'Title of ' + id,
	body: '<p>Body</p>',
	section: 'main',
	tags: [],
	sort_order: 1.0,
	references: {},
	references_info: {},
	references_inbound: {},
	references_info_inbound: {},
	auto_todo_overrides: {},
	published: true,
	...extras,
});

describe('shared timestampToMillis (#742/#755)', () => {
	before(async () => {
		({CollectionDescription, SORTS} = await import('../../lib/src/filters.js').then(async (filters) => ({
			SORTS: filters.SORTS,
			CollectionDescription: (await import('../../lib/src/collection_description.js')).CollectionDescription,
		})));
		({timestampToMillis} = await import('../../lib/src/util.js'));
	});

	after(() => {
		dom.window.close();
	});

	it('accepts a real-Timestamp-shaped value and the wire shape; sentinel for anything else', () => {
		assert.strictEqual(timestampToMillis({toMillis: () => 1234}, NaN), 1234);
		assert.strictEqual(timestampToMillis({seconds: 2, nanoseconds: 5e8}, NaN), 2500);
		//Malformed classes yield the CALLER'S sentinel — including non-finite
		//seconds and a toMillis() that itself yields NaN, which would
		//otherwise smuggle NaN past the gate straight into the comparator.
		for (const malformed of [new Date(0), '2023-01-01', 12345, {}, null, undefined,
			{seconds: NaN}, {seconds: Infinity}, {toMillis: () => NaN}]) {
			assert.ok(Number.isNaN(timestampToMillis(malformed, NaN)), `NaN sentinel for ${String(malformed)}`);
			assert.strictEqual(timestampToMillis(malformed, 0), 0, `0 sentinel for ${String(malformed)}`);
		}
	});

	it('a malformed timestamp no longer silently reorders a sorted collection (#742)', () => {
		//The issue's repro: a Date-valued `created` made the extractor yield
		//undefined, the comparator NaN, and Array.prototype.sort treats NaN
		//as "equal" — leaving the malformed card wherever the base order put
		//it. With sentinel 0 it sorts deterministically to the end.
		const cards = {
			b: card('b', {created: new Date('2023-06-01')}),
			a: card('a', {created: ts(1_780_000_000)}),
			c: card('c', {created: ts(1_580_000_000)}),
		};
		const description = new CollectionDescription('everything', [], 'created');
		const collection = description.collection({
			cards,
			sets: {main: [], 'reading-list': [], everything: ['b', 'a', 'c']},
			filters: {},
			sections: {},
			fallbacks: {},
			startCards: {},
		});
		assert.deepStrictEqual(
			collection.finalSortedCards.map(c => c.id),
			['a', 'c', 'b'],
			'the malformed card must sort predictably to the end, not float where the base order left it');
	});

	it('every timestamp sort yields a real number for wire-shape and malformed fields alike', () => {
		const extract = (config, c) => config.extractor(c, {}, {[c.id]: c}, {}, {});
		const wire = card('wire', {
			created: ts(100), updated_substantive: ts(100), updated_message: ts(100), last_tweeted: ts(100),
		});
		const malformed = card('bad', {
			created: new Date(0), updated_substantive: 'nope', updated_message: 42, last_tweeted: {},
		});
		for (const name of ['updated', 'created', 'commented', 'recent', 'last-tweeted']) {
			for (const c of [wire, malformed]) {
				const [value] = extract(SORTS[name], c);
				assert.strictEqual(typeof value, 'number', `sort/${name} on ${c.id}`);
				assert.ok(!Number.isNaN(value), `sort/${name} must never yield NaN (card ${c.id})`);
			}
		}
	});

	it('sort/default asserts on an unknown sortExtras key instead of silently misordering (#746)', () => {
		const c = card('x');
		//A known configurable-filter key works (children/ is registered).
		assert.doesNotThrow(() => SORTS['default'].extractor(c, {}, {x: c}, {children: {x: 1}}, {}));
		//An unknown key is an invariant violation and must say so loudly:
		//keys are recorded into sortExtras only by registered configurable
		//filters, so a silent config?.flipOrder would hide real breakage as
		//a wrong sort order.
		assert.throws(
			() => SORTS['default'].extractor(c, {}, {x: c}, {'no-such-filter': {x: 1}}, {}),
			/unknown configurable filter key 'no-such-filter'/);
	});

	it('similarity.ts carries no bare .toMillis() on card data (#755)', () => {
		//The decision on #755 records this as the LAST unguarded wire-shape
		//.toMillis() on the read path, to be re-verified by grep rather than
		//assumed once fixed. Source-text pin, per repo convention.
		const source = readFileSync(new URL('../../src/actions/similarity.ts', import.meta.url), 'utf8');
		//Strip line comments: the explanation of WHY there is no .toMillis()
		//may legitimately name it.
		const code = source.split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
		assert.ok(!code.includes('.toMillis('),
			'similarity.ts must convert timestamps via the shared timestampToMillis helper');
		assert.ok(code.includes('timestampToMillis('), 'the shared helper must actually be used');
	});
});
