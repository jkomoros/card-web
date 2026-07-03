/*eslint-env node*/

//End-to-end tests for the worker-side QueryEngine: cards in, forwarded
//user-state actions replayed, collections out. Runs in Node with no DOM —
//the same environment constraint the worker has.

import assert from 'assert';

let QueryEngine;
let UPDATE_STARS;
let UPDATE_READS;
let UPDATE_SECTIONS;
let UPDATE_READING_LIST;
let SELECT_CARDS;

const card = (id, extras) => ({
	id,
	card_type: 'content',
	title: 'Title of ' + id,
	body: '<p>Body of ' + id + '</p>',
	section: 'main',
	tags: [],
	sort_order: 1.0,
	references: {},
	references_info: {},
	references_inbound: {},
	references_info_inbound: {},
	star_count: 0,
	thread_count: 0,
	notes: '',
	todo: '',
	auto_todo_overrides: {},
	published: true,
	full_bleed: false,
	images: [],
	...extras,
});

describe('QueryEngine', () => {
	before(async () => {
		({QueryEngine} = await import('../../lib/src/worker/query-engine.js'));
		({
			UPDATE_STARS,
			UPDATE_READS,
			UPDATE_SECTIONS,
			UPDATE_READING_LIST,
			SELECT_CARDS,
		} = await import('../../lib/src/actions.js'));
	});

	const makeEngine = () => {
		const engine = new QueryEngine();
		engine.updateCards({
			a: card('a', {sort_order: 3.0}),
			b: card('b', {sort_order: 2.0}),
			c: card('c', {sort_order: 1.0}),
		}, []);
		return engine;
	};

	it('runs the everything set sorted by sort_order', async () => {
		const engine = makeEngine();
		const result = engine.runCollection('everything/');
		assert.deepStrictEqual(result.ids, ['a', 'b', 'c']);
		assert.strictEqual(result.numCards, 3);
		assert.strictEqual(result.isFallback, false);
	});

	it('applies starred filter from replayed star actions', async () => {
		const engine = makeEngine();
		engine.applyAction({type: UPDATE_STARS, starsToAdd: ['b', 'c'], starsToRemove: []});
		const result = engine.runCollection('everything/starred/');
		assert.deepStrictEqual(result.ids, ['b', 'c']);
		//Un-starring updates membership.
		engine.applyAction({type: UPDATE_STARS, starsToAdd: [], starsToRemove: ['c']});
		assert.deepStrictEqual(engine.runCollection('everything/starred/').ids, ['b']);
	});

	it('applies unread inverse filter from replayed read actions', async () => {
		const engine = makeEngine();
		engine.applyAction({type: UPDATE_READS, readsToAdd: ['a'], readsToRemove: []});
		const result = engine.runCollection('everything/unread/');
		assert.deepStrictEqual(result.ids, ['b', 'c']);
	});

	it('composes the main set from replayed sections', async () => {
		const engine = makeEngine();
		engine.applyAction({type: UPDATE_SECTIONS, sections: {
			main: {id: 'main', title: 'Main', cards: ['a', 'b', 'c'], order: 0, start_cards: []},
		}});
		const result = engine.runCollection('main/');
		assert.deepStrictEqual(result.ids, ['a', 'b', 'c']);
	});

	it('supports the reading-list set from replayed reading list', async () => {
		const engine = makeEngine();
		engine.applyAction({type: UPDATE_READING_LIST, list: ['c', 'a']});
		const result = engine.runCollection('reading-list/');
		assert.deepStrictEqual(result.ids, ['c', 'a']);
	});

	it('exposes selected cards as the selected filter', async () => {
		const engine = makeEngine();
		engine.applyAction({type: SELECT_CARDS, cards: ['b']});
		const result = engine.runCollection('everything/selected/');
		assert.deepStrictEqual(result.ids, ['b']);
	});

	it('runs query filters over card text', async () => {
		const engine = makeEngine();
		engine.updateCards({
			d: card('d', {title: 'Hill climbing strategies', body: '<p>Climbing hills is hard.</p>', sort_order: 0.5}),
		}, []);
		const result = engine.runCollection('everything/query/hill climbing/');
		assert.deepStrictEqual(result.ids, ['d']);
	});

	it('handles card updates and removals', async () => {
		const engine = makeEngine();
		engine.updateCards({b: card('b', {sort_order: 10.0})}, ['c']);
		const result = engine.runCollection('everything/');
		assert.deepStrictEqual(result.ids, ['b', 'a']);
		assert.strictEqual(engine.cardCount, 2);
	});
});
