/*eslint-env node*/

import { JSDOM } from 'jsdom';
import { overrideDocument } from '../../shared/dist/document.js';

const dom = new JSDOM('');
overrideDocument(dom.window.document);

import {
	normalizedWords,
	stemmedNormalizedWords,
	ngrams,
	calcIDFMapForCards,
	cardWithNormalizedTextPropertiesSimple,
	nlpSourceFingerprintForCard,
	ngramWithinOther,
	importantNgramsWithinRun,
} from '../../shared/dist/nlp.js';

import assert from 'assert';

// Minimal card stub matching the Card interface shape.
// Only card_type, body, and title are exercised by
// cardWithNormalizedTextPropertiesSimple → extractContentWords.
const makeCard = (id, body, title = '') => ({
	id,
	card_type: 'content',
	body,
	title,
	subtitle: '',
	title_alternates: '',
	commentary: '',
	notes: '',
	todo: '',
	section: '',
	tags: [],
	slugs: [],
	name: id,
	author: '',
	collaborators: [],
	permissions: {},
	sort_order: 0,
	published: true,
	references_info: {},
	references_info_inbound: {},
	references: {},
	references_inbound: {},
	font_size_boost: {},
	images: [],
	auto_todo_overrides: {},
	external_link: '',
	created: { seconds: 0, nanoseconds: 0 },
	updated: { seconds: 0, nanoseconds: 0 },
	updated_substantive: { seconds: 0, nanoseconds: 0 },
	updated_message: { seconds: 0, nanoseconds: 0 },
	star_count: 0,
	star_count_manual: 0,
	tweet_favorite_count: 0,
	tweet_retweet_count: 0,
	thread_count: 0,
	thread_resolved_count: 0,
	last_tweeted: { seconds: 0, nanoseconds: 0 },
	tweet_count: 0,
});

describe('normalizedWords', () => {
	it('returns empty string for empty input', async () => {
		assert.strictEqual(normalizedWords(''), '');
	});

	it('lowercases text', async () => {
		assert.strictEqual(normalizedWords('Hello World'), 'hello world');
	});

	it('strips punctuation', async () => {
		const result = normalizedWords('bold!');
		assert.strictEqual(result, 'bold');
	});

	it('converts hyphens to spaces', async () => {
		assert.strictEqual(normalizedWords('hill-climbing'), 'hill climbing');
	});

	it('preserves case with originalCase=true', async () => {
		const result = normalizedWords('Hello World', true);
		assert.strictEqual(result, 'Hello World');
	});
});

describe('stemmedNormalizedWords', () => {
	it('returns empty string for empty input', async () => {
		assert.strictEqual(stemmedNormalizedWords(''), '');
	});

	it('stems a single word', async () => {
		const result = stemmedNormalizedWords('climbing');
		// Porter stemmer reduces 'climbing' to 'climb'
		assert.strictEqual(result, 'climb');
	});

	it('stems multiple words', async () => {
		const result = stemmedNormalizedWords('running hills');
		// Each word is independently stemmed
		assert.ok(result.length > 0);
		const parts = result.split(' ');
		assert.strictEqual(parts.length, 2);
	});

	it('honors override stems for optimiz- prefix', async () => {
		const result = stemmedNormalizedWords('optimized');
		assert.strictEqual(result, 'optimiz');
	});
});

describe('ngrams', () => {
	it('returns empty array for empty input', async () => {
		assert.deepStrictEqual(ngrams(''), []);
	});

	it('returns empty array when words fewer than size', async () => {
		assert.deepStrictEqual(ngrams('hello', 2), []);
	});

	it('returns one bigram for two words', async () => {
		const result = ngrams('hello world', 2);
		assert.deepStrictEqual(result, ['hello world']);
	});

	it('returns two bigrams for three words', async () => {
		const result = ngrams('one two three', 2);
		assert.deepStrictEqual(result, ['one two', 'two three']);
	});

	it('supports custom size=3', async () => {
		const result = ngrams('a b c d', 3);
		assert.deepStrictEqual(result, ['a b c', 'b c d']);
	});
});

describe('calcIDFMapForCards', () => {
	it('returns empty IDF map for no cards', async () => {
		const idfMap = calcIDFMapForCards({}, 2);
		assert.deepStrictEqual(idfMap.idf, {});
		assert.strictEqual(idfMap.maxIDF, 0);
	});

	it('returns IDF entries for a single card', async () => {
		const card = cardWithNormalizedTextPropertiesSimple(
			makeCard('card-1', '<p>machine learning</p>')
		);
		const idfMap = calcIDFMapForCards({ 'card-1': card }, 2);
		assert.ok(Object.keys(idfMap.idf).length > 0);
		assert.ok(idfMap.maxIDF >= 0);
	});

	it('word in all cards has lower IDF than word in one card', async () => {
		const card1 = cardWithNormalizedTextPropertiesSimple(
			makeCard('card-1', '<p>common unique1</p>')
		);
		const card2 = cardWithNormalizedTextPropertiesSimple(
			makeCard('card-2', '<p>common unique2</p>')
		);
		const cards = { 'card-1': card1, 'card-2': card2 };
		const idfMap = calcIDFMapForCards(cards, 1);

		// 'common' appears in both cards → lower IDF (stemmed form)
		const commonStemmed = stemmedNormalizedWords('common');
		// 'unique1' appears in one card → higher IDF (stemmed form)
		const unique1Stemmed = stemmedNormalizedWords('unique1');

		assert.ok(idfMap.idf[commonStemmed] !== undefined, 'common term should be in IDF map');
		assert.ok(idfMap.idf[unique1Stemmed] !== undefined, 'unique term should be in IDF map');
		assert.ok(idfMap.idf[commonStemmed] < idfMap.idf[unique1Stemmed],
			`common IDF (${idfMap.idf[commonStemmed]}) should be less than unique IDF (${idfMap.idf[unique1Stemmed]})`);
	});

	it('returns maxIDF property', async () => {
		const card = cardWithNormalizedTextPropertiesSimple(
			makeCard('card-1', '<p>hello world</p>')
		);
		const idfMap = calcIDFMapForCards({ 'card-1': card }, 2);
		assert.ok(typeof idfMap.maxIDF === 'number');
	});
});

describe('importantNgramsWithinRun', () => {
	//The reference is the loop it replaced: every key tested with
	//ngramWithinOther, in key order. The optimized version must return
	//exactly the same keys in the same order — order matters because it
	//becomes the count map's insertion order, which breaks ties in the
	//fingerprint sort — for any map and any run, including the odd shapes
	//below.
	const reference = (map, words) => Object.keys(map).filter(ngram => ngramWithinOther(ngram, words));
	const same = (map, words) => {
		assert.deepStrictEqual(importantNgramsWithinRun(map, words), reference(map, words), `${JSON.stringify(words)} over ${JSON.stringify(Object.keys(map))}`);
	};

	it('matches whole words only, at any position, for keys longer than the fingerprint ngram size', () => {
		const map = {zebra: 'c1', 'zebra crossing': 'c2', 'long concept name here': 'c3', bra: 'c4', 'crossing safety': 'c5'};
		same(map, 'zebra crossing safety');
		same(map, 'the zebra');
		same(map, 'zebrafish');
		same(map, 'a long concept name here today');
		same(map, 'long concept name');
		same(map, '');
	});

	it('preserves the exact boundary semantics of ngramWithinOther with empty and repeated tokens', () => {
		const map = {'': 'c0', 'a': 'c1', 'a a': 'c2', 'a  b': 'c3', ' a': 'c4'};
		for (const words of ['', ' ', 'a', 'a a', 'a a a', 'a  b', ' a', 'b a', 'a ']) same(map, words);
	});

	it('does not match through the prototype and reports each key once', () => {
		const map = {toString: 'c1', repeat: 'c2'};
		same(map, 'constructor hasOwnProperty toString');
		same(map, 'repeat repeat repeat');
		assert.deepStrictEqual(importantNgramsWithinRun(map, 'repeat repeat'), ['repeat']);
		assert.deepStrictEqual(importantNgramsWithinRun({}, 'anything at all'), []);
	});

	it('agrees with the reference on random runs and maps', () => {
		//Use the LCG's high bits: its low bits cycle with a tiny period, which
		//left an earlier version of this loop producing three distinct keys.
		let seed = 7;
		const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 16) % n; };
		const vocab = ['a', 'b', 'c', 'ab', 'abc', '', 'zebra', 'x', 'a  b', ' a', 'b '];
		for (let i = 0; i < 2000; i++) {
			const map = {};
			for (let k = 0; k < 1 + rand(6); k++) {
				const len = 1 + rand(4);
				map[Array.from({length: len}, () => vocab[rand(vocab.length)]).join(' ')] = 'c';
			}
			const words = Array.from({length: rand(9)}, () => vocab[rand(vocab.length)]).join(' ');
			same(map, words);
		}
	});
});

describe('nlpSourceFingerprintForCard', () => {
	it('changes when raw searchable text changes', async () => {
		const before = makeCard('card-1', '<p>old body</p>', 'Title');
		const after = makeCard('card-1', '<p>new body</p>', 'Title');

		assert.notStrictEqual(nlpSourceFingerprintForCard(before), nlpSourceFingerprintForCard(after));
	});

	it('ignores inbound reference text because clients recompute it locally', async () => {
		const before = makeCard('card-1', '<p>body</p>', 'Title');
		const after = {
			...before,
			references_info_inbound: {
				other: {
					link: 'Changed inbound label'
				}
			}
		};

		assert.strictEqual(nlpSourceFingerprintForCard(before), nlpSourceFingerprintForCard(after));
	});
});
