/*eslint-env node*/

//The worker carries its everything set forward across updateCards (the full
//re-sort per save was its largest fixed cost on the Save→New path). Every
//collection over the everything set must still see exactly the full sort.

import assert from 'assert';

const card = (id, sortOrder, extras = {}) => ({
	id, card_type: 'content', title: 'T ' + id, body: '<p>b</p>', section: '', tags: [], sort_order: sortOrder,
	references: {}, references_info: {}, references_inbound: {}, references_info_inbound: {},
	star_count: 0, thread_count: 0, notes: '', todo: '', auto_todo_overrides: {}, published: true, full_bleed: false, images: [], ...extras,
});

describe('QueryEngine everything set (incremental carry)', () => {
	let QueryEngine;
	let makeEverythingSetFromCards;
	before(async () => {
		({QueryEngine} = await import('../../lib/src/worker/query-engine.js'));
		({makeEverythingSetFromCards} = await import('../../lib/src/set-projections.js'));
	});

	it('equals the full sort after adds, sort_order moves, section-only edits and removals', () => {
		const engine = new QueryEngine();
		const cards = {};
		for (let i = 0; i < 60; i++) cards['c' + i] = card('c' + i, (i * 37) % 61);
		engine.updateCards({...cards}, []);
		assert.deepStrictEqual(engine.runCollection('everything/').ids, makeEverythingSetFromCards(cards));
		//A new card, a moved card, a section-only edit (irrelevant here) and
		//a removal, in one batch; then a batch with only a content edit.
		const batches = [
			{cards: {n1: card('n1', 100.5), c3: card('c3', -4), c7: card('c7', (7 * 37) % 61, {section: 'main'})}, removed: ['c9']},
			{cards: {c4: card('c4', (4 * 37) % 61, {title: 'renamed'})}, removed: []},
			{cards: {n2: card('n2', 0.5), n3: card('n3', 0.25)}, removed: ['n1', 'c3']},
		];
		for (const batch of batches) {
			for (const [id, c] of Object.entries(batch.cards)) cards[id] = c;
			for (const id of batch.removed) delete cards[id];
			engine.updateCards(batch.cards, batch.removed);
			assert.deepStrictEqual(engine.runCollection('everything/').ids, makeEverythingSetFromCards(cards));
		}
		//The carry survived every batch: the one rebuild is the first use.
		//(A lazily rebuilt set passes every result check above while paying
		//the sort, which is the cost this exists to remove.)
		assert.strictEqual(engine._everythingSetRebuilds, 1);
	});

	it('rebuilds when the carried set is stale (a batch too large to carry)', async () => {
		const {INCREMENTAL_EVERYTHING_SET_MAX_TOUCHED} = await import('../../lib/src/set-projections.js');
		const engine = new QueryEngine();
		engine.updateCards({a: card('a', 1)}, []);
		engine.runCollection('everything/');
		const cards = {a: card('a', 1)};
		const big = {};
		for (let i = 0; i < INCREMENTAL_EVERYTHING_SET_MAX_TOUCHED + 5; i++) big['b' + i] = card('b' + i, i + 10);
		Object.assign(cards, big);
		engine.updateCards(big, []);
		assert.deepStrictEqual(engine.runCollection('everything/').ids, makeEverythingSetFromCards(cards));
		assert.strictEqual(engine._everythingSetRebuilds, 2, 'a big batch is rebuilt lazily, not carried');
	});
});
