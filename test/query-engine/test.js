/*eslint-env node*/

//End-to-end tests for the worker-side QueryEngine: cards in, forwarded
//user-state actions replayed, collections out — plus the two things the
//engine also serves from the same corpus, search-recall narrowing (asserted
//bit-identical against the full scan, since narrowing that changes RESULTS is
//a bug, not an optimization) and worker-served tag suggestions. Runs in Node
//with no DOM — the same environment constraint the worker has.

import assert from 'assert';

let QueryEngine;
let UPDATE_STARS;
let UPDATE_READS;
let UPDATE_SECTIONS;
let UPDATE_READING_LIST;
let UPDATE_TAGS;
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
			UPDATE_TAGS,
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

		it('recalls mid-typing prefixes and embedded words exactly like the substring-matching scorer', async () => {
			const {SearchIndex} = await import('../../lib/src/worker/search-index.js');
			const {queryTokensForText} = await import('../../lib/src/worker/query-engine.js');
			const engine = new QueryEngine();
			engine.updateCards(zebraCorpus(), []);
			const index = new SearchIndex();
			index.updateCard('card1', queryTokensForText('Zebra migration patterns'));
			index.updateCard('card2', queryTokensForText('A zebra crossing story'));
			index.updateCard('card3', queryTokensForText('Zebra keeper notes'));
			engine.setSearchRecall(index, new Set());
			//The scorer matches by SUBSTRING (nlp.ts indexOf); the narrowed path
			//must not silently drop what a full scan finds. 'zebr' is a user
			//mid-typing 'zebra' — the exact regression shipped in round 3.
			for (const query of ['zebr', 'zebra', 'ebra', 'migrat', 'migra']) {
				const description = `everything/query/${query}/`;
				engine.setSearchRecall(null, null);
				const full = engine.runCollection(description);
				engine.setSearchRecall(index, new Set());
				const narrowed = engine.runCollection(description);
				assert.deepStrictEqual(narrowed, full, `narrowed must equal full scan for mid-typing query '${query}'`);
				assert.ok(full.ids.length > 0, `sanity: '${query}' should match something in the full scan`);
			}
			//A token with no containing key must yield the same (empty-ish)
			//result as the full scan, not a crash or a stale universe.
			engine.setSearchRecall(null, null);
			const fullMiss = engine.runCollection('everything/query/xylophone/');
			engine.setSearchRecall(index, new Set());
			assert.deepStrictEqual(engine.runCollection('everything/query/xylophone/'), fullMiss);
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


	describe('worker-served tag suggestions', () => {
		it('reuses unchanged card fingerprints after an ordinary card save', () => {
			const engine = makeEngine();
			engine.updateCards({concept: card('concept', {card_type: 'concept', title: 'Zebra', title_alternates: 'Equid'})}, []);
			const before = engine._ensureSuggestGenerator();
			const unchanged = before.fingerprintForCardID('a');
			const changed = before.fingerprintForCardID('b');
			engine.updateCards({b: card('b', {title: 'Entirely different vocabulary'})}, []);
			const after = engine._ensureSuggestGenerator();
			assert.strictEqual(after._fingerprintCache, before._fingerprintCache);
			assert.strictEqual(after.fingerprintForCardID('a'), unchanged,
				'a one-card save must not recompute TF-IDF for every tagged card');
			assert.notStrictEqual(after.fingerprintForCardID('b'), changed);
			assert.notDeepStrictEqual([...after.fingerprintForCardID('b').entries()], [...changed.entries()]);
		});

		it('retains fingerprints when a concept edit changes only metadata', () => {
			const engine = makeEngine();
			const concept = card('concept', {card_type: 'concept', title: 'Zebra', title_alternates: 'Equid'});
			engine.updateCards({concept}, []);
			const before = engine._ensureSuggestGenerator();
			const unchanged = before.fingerprintForCardID('a');
			engine.updateCards({concept: {...concept, tags: ['bits-and-bobs'], auto_todo_overrides: {prioritized: true}}}, []);
			const after = engine._ensureSuggestGenerator();
			assert.strictEqual(after._fingerprintCache, before._fingerprintCache);
			assert.strictEqual(after.fingerprintForCardID('a'), unchanged);
		});

		it('refreshes concepts and synonyms on add, edit, type change, and removal', () => {
			const engine = makeEngine();
			engine._ensureSuggestGenerator();
			const compareFresh = () => {
				const fresh = new QueryEngine();
				fresh.updateCards({...engine.rawCards}, []);
				const actual = engine._ensureSuggestGenerator();
				const expected = fresh._ensureSuggestGenerator();
				assert.deepStrictEqual(actual._concepts, expected._concepts);
				assert.deepStrictEqual(actual._synonyms, expected._synonyms);
				assert.deepStrictEqual([...actual.fingerprintForCardID('a').entries()], [...expected.fingerprintForCardID('a').entries()]);
			};
			engine.updateCards({concept: card('concept', {card_type: 'concept', title: 'Zebra', title_alternates: 'Equid'})}, []);
			compareFresh();
			engine.updateCards({concept: {...engine.rawCards.concept, title: 'Horse', title_alternates: 'Pony'}}, []);
			compareFresh();
			engine.updateCards({concept: {...engine.rawCards.concept, card_type: 'content'}}, []);
			compareFresh();
			engine.updateCards({concept: {...engine.rawCards.concept, card_type: 'concept'}}, []);
			compareFresh();
			engine.updateCards({}, ['concept']);
			compareFresh();
		});

		it('preserves duplicate-title precedence when an existing card becomes a concept', () => {
			const engine = new QueryEngine();
			const a = card('a', {title: 'Zebra'});
			engine.updateCards({a, b: card('b', {title: 'Zebra', card_type: 'concept'})}, []);
			engine._ensureSuggestGenerator();
			engine.updateCards({a: {...a, card_type: 'concept'}}, []);
			assert.strictEqual(engine._ensureSuggestGenerator()._concepts.Zebra, 'b');
		});

		//A tag's fingerprint sorts the union vocabulary of every member card.
		//Recomputing every tag after any card change was the dominant per-edit
		//worker cost at corpus scale (7–8s per save at 30k, profiled). Only the
		//tags that list the changed card may change.
		const tagged = () => {
			const engine = new QueryEngine();
			engine.updateCards({
				z1: card('z1', {title: 'Zebra migration patterns', tags: ['animals']}),
				z2: card('z2', {title: 'Zebra crossing safety', tags: ['animals']}),
				m1: card('m1', {title: 'Municipal budget planning', tags: ['civics']}),
				m2: card('m2', {title: 'Municipal election law', tags: ['civics']}),
				w1: card('w1', {title: 'Watercolor technique', tags: ['art']}),
			}, []);
			const tags = {
				animals: {id: 'animals', title: 'Animals', cards: ['z1', 'z2']},
				civics: {id: 'civics', title: 'Civics', cards: ['m1', 'm2']},
				art: {id: 'art', title: 'Art', cards: ['w1']},
			};
			engine.hydrateCollectionState({sections: {}, tags, starredCardIDs: [], readCardIDs: [], readingList: [], selectedCardIDs: []});
			return {engine, tags};
		};

		it('recomputes only the tags that list a changed card', () => {
			const {engine} = tagged();
			const before = engine._ensureTagFingerprints();
			const generator = engine._ensureSuggestGenerator();
			const calls = [];
			const original = generator.constructor.prototype.fingerprintForCardIDList;
			generator.constructor.prototype.fingerprintForCardIDList = function (ids) {
				calls.push([...ids]);
				return original.call(this, ids);
			};
			try {
				engine.updateCards({m1: card('m1', {title: 'Municipal zoning reform', tags: ['civics']})}, []);
				const after = engine._ensureTagFingerprints();
				assert.deepStrictEqual(calls, [['m1', 'm2']], 'only the civics tag lists m1');
				assert.strictEqual(after.animals, before.animals, 'an untouched tag keeps its fingerprint object');
				assert.strictEqual(after.art, before.art);
				assert.notStrictEqual(after.civics, before.civics);
				//Equivalent to a cold build over the same corpus.
				const fresh = new QueryEngine();
				fresh.updateCards({...engine.rawCards}, []);
				fresh.hydrateCollectionState({sections: {}, tags: engine._tags, starredCardIDs: [], readCardIDs: [], readingList: [], selectedCardIDs: []});
				const expected = fresh._ensureTagFingerprints();
				for (const tagID of Object.keys(expected)) {
					assert.deepStrictEqual([...after[tagID].entries()], [...expected[tagID].entries()], tagID);
				}
			} finally {
				generator.constructor.prototype.fingerprintForCardIDList = original;
			}
		});

		it('recomputes a tag whose membership changed', () => {
			const {engine, tags} = tagged();
			const before = engine._ensureTagFingerprints();
			engine.applyAction({type: UPDATE_TAGS, tags: {art: {...tags.art, cards: ['w1', 'z1']}}});
			const after = engine._ensureTagFingerprints();
			assert.notStrictEqual(after.art, before.art, 'a new tag object with new membership is rebuilt');
			assert.strictEqual(after.animals, before.animals);
			assert.strictEqual(after.civics, before.civics);
		});

		it('keeps fingerprints across the full-map tag delivery the worker actually receives', () => {
			//corpus-worker's tags listener sends EVERY tag as a fresh object on
			//every snapshot, so an identity-keyed cache would recompute all of
			//them after any tag write — master's cost in a different coat.
			const {engine, tags} = tagged();
			const before = engine._ensureTagFingerprints();
			const delivered = structuredClone(tags);
			delivered.art.cards = ['w1', 'z1'];
			engine.applyAction({type: UPDATE_TAGS, tags: delivered, complete: true});
			const after = engine._ensureTagFingerprints();
			assert.strictEqual(after.animals, before.animals, 'same membership, new object: reused');
			assert.strictEqual(after.civics, before.civics);
			assert.notStrictEqual(after.art, before.art, 'changed membership: rebuilt');
		});

		it('drops a tag that a complete delivery no longer contains', () => {
			const {engine, tags} = tagged();
			engine._ensureTagFingerprints();
			engine.applyAction({type: UPDATE_TAGS, tags: {animals: tags.animals, civics: tags.civics}, complete: true});
			assert.deepStrictEqual(Object.keys(engine._ensureTagFingerprints()).sort(), ['animals', 'civics']);
			assert.ok(!engine._tagFingerprintCache.has('art'));
			//A partial delivery still merges.
			engine.applyAction({type: UPDATE_TAGS, tags: {art: tags.art}});
			assert.deepStrictEqual(Object.keys(engine._ensureTagFingerprints()).sort(), ['animals', 'art', 'civics']);
		});

		it('rebuilds every tag when a new IDF epoch is installed', () => {
			const {engine} = tagged();
			const before = engine._ensureTagFingerprints();
			engine.setIDFMap({idf: {zebra: 2.5}, maxIDF: 2.5});
			const after = engine._ensureTagFingerprints();
			for (const tagID of Object.keys(before)) assert.notStrictEqual(after[tagID], before[tagID], tagID);
		});

		it('recomputes a tag whose member card was removed', () => {
			const {engine} = tagged();
			const before = engine._ensureTagFingerprints();
			engine.updateCards({}, ['z2']);
			const after = engine._ensureTagFingerprints();
			assert.notStrictEqual(after.animals, before.animals);
			assert.strictEqual(after.civics, before.civics);
		});

		it('rebuilds every tag when the IDF epoch or concepts change', () => {
			const {engine} = tagged();
			const before = engine._ensureTagFingerprints();
			engine.updateCards({concept: card('concept', {card_type: 'concept', title: 'Zebra', title_alternates: 'Equid'})}, []);
			const after = engine._ensureTagFingerprints();
			for (const tagID of Object.keys(before)) assert.notStrictEqual(after[tagID], before[tagID], tagID);
		});

		it('ranks tags by fingerprint overlap with the mirrored editing card, excluding existing tags', async () => {
			const engine = new QueryEngine();
			const cards = {};
			cards.z1 = card('z1', {title: 'Zebra migration patterns', tags: ['animals']});
			cards.z2 = card('z2', {title: 'Zebra crossing safety', tags: ['animals']});
			cards.m1 = card('m1', {title: 'Municipal budget planning', tags: ['civics']});
			cards.m2 = card('m2', {title: 'Municipal election law', tags: ['civics']});
			cards.editing = card('editing', {title: 'Zebra herd dynamics', tags: []});
			engine.updateCards(cards, []);
			engine.hydrateCollectionState({
				sections: {},
				tags: {
					animals: {id: 'animals', title: 'Animals', cards: ['z1', 'z2']},
					civics: {id: 'civics', title: 'Civics', cards: ['m1', 'm2']},
				},
				starredCardIDs: [],
				readCardIDs: [],
				readingList: [],
				selectedCardIDs: [],
			});
			const processed = engine.runCollection('everything/') && engine._ensureProcessedCards();
			engine.setEditingCard(processed.editing, null);
			const suggestions = engine.suggestTags(3);
			assert.ok(suggestions.includes('animals'), `zebra editing card should suggest the zebra tag: ${JSON.stringify(suggestions)}`);
			assert.ok(suggestions.indexOf('animals') < (suggestions.indexOf('civics') === -1 ? Infinity : suggestions.indexOf('civics')),
				'the overlapping tag must outrank the unrelated one');
			//Existing tags are excluded.
			engine.setEditingCard({...processed.editing, tags: ['animals']}, null);
			assert.ok(!engine.suggestTags(3).includes('animals'), 'already-applied tags must not be suggested');
			//No editing card -> no suggestions, no throw.
			engine.setEditingCard(null, null);
			assert.deepStrictEqual(engine.suggestTags(3), []);
		});
	});

});
