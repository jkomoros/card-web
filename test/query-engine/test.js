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

	it('runs the landing stars sort directly from raw card fields', () => {
		const engine = makeEngine();
		engine.updateCards({
			a: card('a', {sort_order: 3.0, star_count: 2}),
			b: card('b', {sort_order: 2.0, star_count: 9}),
			c: card('c', {sort_order: 1.0, star_count: 2}),
		}, []);
		const result = engine.runCollection('everything/sort/stars/');
		assert.deepStrictEqual(result.ids, ['b', 'a', 'c']);
		assert.deepStrictEqual(result.labels, ['', '', '']);
		assert.strictEqual(result.numCards, 3);
		assert.strictEqual(result.numStartCards, 0);
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

	it('authoritatively replaces user state while retaining card-derived filters', async () => {
		const engine = makeEngine();
		engine.applyAction({type: UPDATE_STARS, starsToAdd: ['a'], starsToRemove: []});
		engine.applyAction({type: UPDATE_READS, readsToAdd: ['c'], readsToRemove: []});
		engine.applyAction({type: SELECT_CARDS, cards: ['a']});

		engine.hydrateCollectionState({
			sections: {main: {id: 'main', title: 'Main', cards: ['b', 'c'], order: 0, start_cards: [], default: true}},
			tags: {},
			starredCardIDs: ['b'],
			readCardIDs: ['a'],
			readingList: ['c'],
			selectedCardIDs: ['c'],
		});

		assert.deepStrictEqual(engine.runCollection('everything/starred/').ids, ['b']);
		assert.deepStrictEqual(engine.runCollection('everything/unread/').ids, ['b', 'c']);
		assert.deepStrictEqual(engine.runCollection('main/').ids, ['a', 'b', 'c']);
		assert.deepStrictEqual(engine.runCollection('reading-list/').ids, ['c']);
		assert.deepStrictEqual(engine.runCollection('everything/selected/').ids, ['c']);
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

	it('exports only complete card-derived filter maps', () => {
		const engine = makeEngine();
		engine.applyAction({type: UPDATE_STARS, starsToAdd: ['a'], starsToRemove: []});
		const filters = engine.cardDerivedFilters();
		assert.ok(Object.keys(filters).length > 50);
		assert.deepStrictEqual(Object.keys(filters.content || {}).sort(), ['a', 'b', 'c']);
		assert.strictEqual(Object.prototype.hasOwnProperty.call(filters, 'starred'), false);
		for (const value of Object.values(filters)) assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	});

	describe('search recall narrowing', () => {
		const zebraCorpus = () => {
			const cards = {};
			for (let i = 0; i < 8; i++) {
				const id = 'card' + i;
				cards[id] = card(id, {sort_order: i, title: 'Filler topic ' + i});
			}
			//Node has no DOM so body HTML extracts to empty text; use titles for
			//matchable content (the narrowing logic is field-agnostic).
			cards.card1 = card('card1', {title: 'Zebra migration patterns'});
			cards.card2 = card('card2', {title: 'A zebra crossing story'});
			cards.card3 = card('card3', {title: 'Zebra keeper notes'});
			return cards;
		};

		it('produces bit-identical results with a sound universe, and actually narrows', async () => {
			const {SearchIndex} = await import('../../lib/src/worker/search-index.js');
			const {queryTokensForText} = await import('../../lib/src/worker/query-engine.js');
			for (const description of ['everything/query/zebra/', 'everything/has-body/query/zebra/']) {
				const engine = new QueryEngine();
				engine.updateCards(zebraCorpus(), []);
				const full = engine.runCollection(description);
				assert.ok(full.ids.includes('card1') && full.ids.includes('card2') && full.ids.includes('card3'),
					`query should match all three zebra cards for ${description}: ${JSON.stringify(full.ids)}`);
				const index = new SearchIndex();
				index.updateCard('card1', queryTokensForText('Zebra migration patterns'));
				index.updateCard('card2', queryTokensForText('A zebra crossing story'));
				//card3 deliberately unindexed: it must be recalled via always-scan.
				engine.setSearchRecall(index, new Set(['card3']));
				assert.ok(engine.searchRecallEnabled);
				const narrowed = engine.runCollection(description);
				assert.deepStrictEqual(narrowed, full, `narrowed result must equal full scan for ${description}`);
				//Prove the narrowing engaged: with card3 dropped from the universe
				//its match must disappear (guards against a silently-dead fast path).
				engine.setSearchRecall(index, new Set());
				const unsound = engine.runCollection(description);
				assert.ok(!unsound.ids.includes('card3'), 'narrowing did not actually restrict the universe');
				//And disabling recall restores the full path.
				engine.setSearchRecall(null, null);
				assert.deepStrictEqual(engine.runCollection(description), full);
			}
		});

		it('falls back to the full path for stop-word-only queries and non-query collections', async () => {
			const {SearchIndex} = await import('../../lib/src/worker/search-index.js');
			const engine = new QueryEngine();
			engine.updateCards(zebraCorpus(), []);
			const fullEverything = engine.runCollection('everything/');
			engine.setSearchRecall(new SearchIndex(), new Set());
			assert.deepStrictEqual(engine.runCollection('everything/'), fullEverything);
			//'the' is all stop words -> no tokens -> full scan despite empty index.
			const stopWordResult = engine.runCollection('everything/query/the/');
			assert.ok(Array.isArray(stopWordResult.ids));
		});
	});

});
