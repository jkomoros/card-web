/*eslint-env node*/

//The engine tells the worker when serving a request now would mean a
//whole-corpus synchronous pass: a cold similarity map (a similar-cards
//request builds it in one task) and stale enriched inputs after a concept
//title change (the next tag suggestion re-fingerprints every card).

import assert from 'assert';

const card = (id, extras = {}) => ({
	id, card_type: 'content', title: 'Title of ' + id, body: '<p>Body of ' + id + ' with some words</p>', section: 'main', tags: [], sort_order: 1.0,
	references: {}, references_info: {}, references_inbound: {}, references_info_inbound: {},
	star_count: 0, thread_count: 0, notes: '', todo: '', auto_todo_overrides: {}, published: true, full_bleed: false, images: [], ...extras,
});

describe('QueryEngine warmth signals', () => {
	let QueryEngine;
	let UPDATE_TAGS;
	before(async () => {
		({QueryEngine} = await import('../../lib/src/worker/query-engine.js'));
		({UPDATE_TAGS} = await import('../../lib/src/actions.js'));
	});
	const makeEngine = (n = 12) => {
		const engine = new QueryEngine();
		const cards = {};
		for (let i = 0; i < n; i++) cards['c' + i] = card('c' + i);
		cards.concept = card('concept', {card_type: 'concept', title: 'Alpha'});
		engine.updateCards(cards, []);
		engine.applyAction({type: UPDATE_TAGS, tags: {t1: {id: 't1', cards: ['c0', 'c1']}}, complete: true});
		return engine;
	};

	it('similarityFingerprintsCold is true before the warm-up (above the threshold) and false after', async () => {
		const engine = makeEngine(20);
		assert.strictEqual(engine.similarityFingerprintsCold(5), true);
		await engine.warmSimilarityFingerprints(async () => {}, () => true, 0);
		assert.strictEqual(engine.similarityFingerprintsCold(5), false);
		//An edit re-queues one card: below any sane threshold, not cold.
		engine.updateCards({c3: card('c3', {body: '<p>changed</p>'})}, []);
		assert.strictEqual(engine.similarityFingerprintsCold(5), false);
	});

	it('with deferWhenSimilarityCold, a filter that reaches the fallback on a cold map throws SimilarityColdError; embeddings or a warm map answer', async () => {
		const {SimilarityColdError} = await import('../../lib/src/worker/query-engine.js');
		//Above the default cold threshold (500 pending cards).
		const engine = makeEngine(600);
		const description = 'everything/similar/c0/';
		assert.throws(() => engine.runCollection(description, {keyCardID: 'c0', deferWhenSimilarityCold: true}), SimilarityColdError, 'cold + fallback reached');
		assert.strictEqual(Boolean(engine._similarityFingerprints && Object.keys(engine._similarityFingerprints).length), false, 'nothing was built inside the request');
		//Embedding results for the key card never reach the fallback.
		const embedded = engine.runCollection(description, {keyCardID: 'c0', deferWhenSimilarityCold: true, cardSimilarity: {c0: {c1: 0.9, c2: 0.5}}});
		assert.deepStrictEqual(embedded.ids.slice(0, 2), ['c1', 'c2']);
		//Without the option the request builds synchronously, as subscriptions do.
		const built = engine.runCollection(description, {keyCardID: 'c0'});
		assert.ok(built.ids.length > 0);
		//Warm now: the deferring option answers too.
		const warm = engine.runCollection(description, {keyCardID: 'c0', deferWhenSimilarityCold: true});
		assert.deepStrictEqual(warm.ids, built.ids);
	});

	it('suggestInputsStale is false for a concept body or notes edit and true for a concept title edit, until the generator is rebuilt', () => {
		const engine = makeEngine();
		engine.setEditingCard(engine._ensureProcessedCards().c0, null);
		engine.suggestTags();
		assert.strictEqual(engine.suggestInputsStale(), false);
		engine.updateCards({concept: {...engine.rawCards.concept, notes: 'metadata'}}, []);
		assert.strictEqual(engine.suggestInputsStale(), false, 'a notes edit keeps the concepts');
		engine.updateCards({concept: {...engine.rawCards.concept, body: '<p>new body</p>'}}, []);
		assert.strictEqual(engine.suggestInputsStale(), false, 'a body edit keeps the concepts');
		engine.updateCards({concept: {...engine.rawCards.concept, title: 'Alpha renamed'}}, []);
		assert.strictEqual(engine.suggestInputsStale(), true, 'a title edit changes the concepts');
		engine.suggestTags();
		assert.strictEqual(engine.suggestInputsStale(), false, 'rebuilt: no longer stale');
		//A reader never builds the generator: nothing to go stale.
		const reader = makeEngine();
		reader.updateCards({concept: {...reader.rawCards.concept, title: 'Renamed for a reader'}}, []);
		assert.strictEqual(reader.suggestInputsStale(), false);
	});
});
