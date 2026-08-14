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

//THE STORED-TOKEN FAST PATH — the DEFAULT path for every migrated card, and
//until now the only major path in card-processing with no test at all.
//
//It matters twice over. Correctness: if the freshness check is wrong, stale
//tokens serve search results for text the card no longer contains, silently.
//And memory: this path is why StoredProcessedRun exists as a CLASS. Declaring
//the accessors in an object literal gave every instance its own AccessorPairs
//and therefore its own hidden class — a heap snapshot of a real session found
//~830MB of the 1,031MB heap in shape metadata, 129,156 objects each named
//`get stemmed`, and 404,155 AccessorPairs, almost exactly three per run. So the
//"optimization" made the common case far more expensive than the slow path it
//replaced.
describe('stored NLP token fast path', () => {

	let processCard;
	let nlp;

	before(async () => {
		({processCard} = await import('../../lib/src/card-processing.js'));
		nlp = await import('../../lib/shared/nlp.js');
	});

	//A card whose stored tokens genuinely describe its own text.
	const migratedCard = (overrides = {}) => {
		const card = {...rawCard('migrated', 'Migrated'), ...overrides};
		const slow = processCard({...card}, {});
		card.nlp_tokens = {};
		for (const [field, runs] of Object.entries(slow.nlp)) {
			if (!Array.isArray(runs)) continue;
			card.nlp_tokens[field] = runs.map(run => ({
				normalized: run.normalized,
				...(run.uppercaseRanges ? {uppercaseRanges: run.uppercaseRanges} : {})
			}));
		}
		card.nlp_version = nlp.CURRENT_NLP_VERSION;
		card.nlp_source_fingerprint = nlp.nlpSourceFingerprintForCard(card);
		return card;
	};

	it('serves the SAME normalized text as the slow path', () => {
		const card = migratedCard();
		const fast = processCard(card, {});
		const slow = processCard({...card, nlp_tokens: undefined}, {});
		assert.deepStrictEqual(
			fast.nlp.title.map(run => run.normalized),
			slow.nlp.title.map(run => run.normalized),
			'the fast path must not change what the card indexes as');
		assert.deepStrictEqual(
			fast.nlp.body.map(run => run.stemmed),
			slow.nlp.body.map(run => run.stemmed),
			'including the lazily-stemmed form');
	});

	it('REFUSES stored tokens whose fingerprint no longer matches the text', () => {
		//The case that silently corrupts search: the card was edited after its
		//tokens were generated, so the stored tokens describe text that is gone.
		const card = migratedCard();
		const edited = {...card, title: 'Something else entirely'};
		const processed = processCard(edited, {});
		assert.ok(
			processed.nlp.title.some(run => run.normalized.includes('entirely')),
			'an edited card must be re-processed, not served from stale tokens');
	});

	it('REFUSES stored tokens from an older NLP version', () => {
		const card = migratedCard();
		const older = {...card, nlp_version: nlp.CURRENT_NLP_VERSION - 1};
		const processed = processCard(older, {});
		assert.ok(processed.nlp.title.length, 'still processed, via the slow path');
	});

	it('keeps its accessors on the PROTOTYPE, not on each instance', () => {
		//THE 830MB INVARIANT, expressed as the thing that actually causes it.
		//Accessors declared per instance give each object its own DescriptorArray
		//and hidden class; on the prototype, every instance shares one shape.
		const card = migratedCard();
		const run = processCard(card, {}).nlp.body[0];
		assert.ok(run, 'the card has at least one body run');
		const proto = Object.getPrototypeOf(run);
		for (const accessor of ['stemmed', 'withoutStopWords', 'empty']) {
			assert.ok(
				Object.getOwnPropertyDescriptor(proto, accessor)?.get,
				`${accessor} must be a prototype getter`);
			assert.strictEqual(
				Object.getOwnPropertyDescriptor(run, accessor), undefined,
				`${accessor} must NOT be an own property — that is what made every instance its own shape`);
		}
	});

	it('has a LATENT enumeration trap, pinned here deliberately', () => {
		//Object.keys / spread / structuredClone see the memo FIELDS and not the
		//getters, so a spread of a run loses stemmed/withoutStopWords/empty and
		//gains _stemmed/_withoutStopWords. No live consumer does this today; this
		//test exists so that whoever writes the first one finds out here rather
		//than through a wrong search result.
		const card = migratedCard();
		const run = processCard(card, {}).nlp.body[0];
		const keys = Object.keys(run);
		assert.ok(keys.includes('_stemmed') && keys.includes('_withoutStopWords'),
			'the memo fields are enumerable own properties');
		assert.ok(!keys.includes('stemmed') && !keys.includes('empty'),
			'the getters are not');
		assert.strictEqual({...run}.stemmed, undefined,
			'so spreading a run DROPS its stemmed form — do not spread these');
	});

	it('computes stemmed forms LAZILY, and memoizes them', () => {
		//Laziness is the whole reason the stored path is cheaper; losing it would
		//stem every run of every card at prime time.
		const card = migratedCard();
		const run = processCard(card, {}).nlp.body[0];
		assert.strictEqual(run._stemmed, undefined, 'not stemmed until asked');
		const first = run.stemmed;
		assert.strictEqual(run._stemmed, first, 'the memo is filled in on first read');
		assert.strictEqual(run.stemmed, first, 'and reused');
	});
});

//A CORRUPT STORED-TOKEN RECORD MUST NOT TAKE DOWN WHOLE-CORPUS PROCESSING.
//
//The fast-path gate checks nlp_version and nlp_source_fingerprint, but that
//fingerprint hashes the card's RAW FIELDS, not the tokens — so it cannot detect
//a damaged token record at all, and the damage reaches an unguarded map().
//
//Two of these THREW, and the WeakMap cache is written only on success, so the
//throw repeated on every access: every whole-corpus consumer (the worker's query
//engine, the main thread's lazyProcessCards) died on every evaluation. One
//flipped IndexedDB record is enough, since the snapshot validator checks cards
//only as "an object with a matching id". The other two corrupted silently, which
//is worse: a run whose normalized text is literally null, and a card that simply
//stops matching anything with nothing logged.
describe('corrupt stored NLP tokens fall back instead of exploding', () => {

	let processCard;
	let nlp;

	before(async () => {
		({processCard} = await import('../../lib/src/card-processing.js'));
		nlp = await import('../../lib/shared/nlp.js');
	});

	const cardWithTokens = (tokens) => {
		const base = rawCard('corrupt', 'Hello');
		return {...base, nlp_tokens: tokens, nlp_version: nlp.CURRENT_NLP_VERSION,
			nlp_source_fingerprint: nlp.nlpSourceFingerprintForCard(base)};
	};

	const goodTokens = () => {
		const slow = processCard(rawCard('corrupt', 'Hello'), {});
		const tokens = {};
		for (const [field, runs] of Object.entries(slow.nlp)) {
			if (Array.isArray(runs)) tokens[field] = runs.map(run => ({normalized: run.normalized}));
		}
		return tokens;
	};

	//Each of these was reproduced against the unguarded version.
	const CORRUPTIONS = {
		'a string where the token map should be': 'not-an-object',
		'a null run': {title: [null]},
		'a run with no normalized text': {title: [{}]},
		'a run whose normalized text is not a string': {title: [{normalized: 42}]},
		'truncated to nothing while the card still has text': {},
	};

	for (const [label, tokens] of Object.entries(CORRUPTIONS)) {
		it(`survives ${label}`, () => {
			const processed = processCard(cardWithTokens(tokens), {});
			const titles = (processed.nlp.title || []).map(run => run.normalized);
			assert.ok(titles.length, 'the card must still be processed, via the slow path');
			assert.ok(titles.every(text => typeof text === 'string'),
				'and must not produce a run whose normalized text is not text');
			assert.ok(titles.some(text => text.includes('hello')),
				'the slow path must recover the card\'s ACTUAL text, not an empty shell');
		});
	}

	it('still uses the fast path when the tokens are valid', () => {
		//The guard must not be so strict that it throws the optimization away.
		const tokens = goodTokens();
		const processed = processCard(cardWithTokens(tokens), {});
		const run = processed.nlp.title[0];
		assert.ok(run, 'has a title run');
		assert.ok(Object.prototype.hasOwnProperty.call(run, '_stemmed'),
			'a StoredProcessedRun (the fast path), not a slow-path run');
	});
});
