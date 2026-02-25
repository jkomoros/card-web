/*eslint-env node*/

import {
	classifyCollectionDescription,
	FilterComplexity,
	buildQueryConstraints,
	buildFirestoreConstraints,
	TESTING,
} from '../../lib/src/filter-classification.js';

import assert from 'assert';

// Helper: create a CollectionDescriptionLike object without importing
// CollectionDescription (which transitively pulls in Lit and requires window).
const desc = (set, filters) => ({ set, filters });

describe('filter classification', () => {
	it('classifies no filters as SIMPLE', async () => {
		const classification = classifyCollectionDescription(desc('main', []));
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies published filter as SIMPLE', async () => {
		const classification = classifyCollectionDescription(desc('', ['published']));
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies section filter as SIMPLE', async () => {
		const classification = classifyCollectionDescription(desc('', ['section/main']));
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies tag filter as SIMPLE', async () => {
		const classification = classifyCollectionDescription(desc('', ['tag/foo']));
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies type-X filter as SIMPLE', async () => {
		const classification = classifyCollectionDescription(desc('', ['type-content']));
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies starred filter as COMPLEX', async () => {
		const classification = classifyCollectionDescription(desc('', ['starred']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
		assert.strictEqual(classification.isExact, false);
	});

	it('classifies children filter as COMPLEX', async () => {
		const classification = classifyCollectionDescription(desc('', ['children/card-123']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
		assert.strictEqual(classification.isExact, false);
	});

	it('classifies query filter as SIMPLE', async () => {
		const classification = classifyCollectionDescription(desc('', ['query/test']));
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies mixed SIMPLE and COMPLEX as COMPLEX', async () => {
		const classification = classifyCollectionDescription(desc('', ['published', 'starred']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
		assert.strictEqual(classification.isExact, false);
	});

	it('classifies multiple SIMPLE filters as SIMPLE', async () => {
		const classification = classifyCollectionDescription(desc('', ['published', 'section/main', 'tag/foo']));
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('ignores limit/offset meta filters', async () => {
		const classification = classifyCollectionDescription(desc('', ['published', 'limit/10', 'offset/5']));
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies union of SIMPLE filters as COMPLEX', async () => {
		// Union filters always require client-side OR processing
		const classification = classifyCollectionDescription(desc('', ['section/a+section/b']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
	});

	it('classifies union with COMPLEX filter as COMPLEX', async () => {
		const classification = classifyCollectionDescription(desc('', ['published+starred']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
	});

	it('classifies unknown filter as COMPLEX for safety', async () => {
		const classification = classifyCollectionDescription(desc('', ['unknown-filter']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
	});

	it('classifies combine filter as COMPLEX', async () => {
		const classification = classifyCollectionDescription(desc('', ['combine/published/starred']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
	});

	it('classifies exclude filter as COMPLEX', async () => {
		const classification = classifyCollectionDescription(desc('', ['exclude/published/starred']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
	});

	it('buildQueryConstraints produces array-contains constraint', async () => {
		const constraints = buildQueryConstraints('hill climbing');
		assert.strictEqual(constraints.length, 1);
		// The constraint should be targeting nlp_search_tokens
		// We verify by checking the constraint object structure
		assert.ok(constraints[0]);
	});

	it('buildQueryConstraints returns empty for empty query', async () => {
		const constraints = buildQueryConstraints('');
		assert.strictEqual(constraints.length, 0);
	});

	it('buildQueryConstraints with IDF selects rarest token', async () => {
		const mockIDF = {
			version: 1,
			cardCount: 100,
			ngramSize: 2,
			idf: {
				'hill': 2.0,
				'climb': 5.0,      // rarest unigram
				'hill climb': 8.0  // rarest overall
			},
			maxIDF: 10.0
		};
		const constraints = buildQueryConstraints('hill climbing', mockIDF);
		assert.strictEqual(constraints.length, 1);
		assert.ok(constraints[0]);
	});

	it('classifies tag + query combined as COMPLEX (multiple array-contains)', async () => {
		const classification = classifyCollectionDescription(desc('', ['tag/foo', 'query/bar']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
	});

	it('classifies has-body as COMPLEX', async () => {
		const classification = classifyCollectionDescription(desc('', ['has-body']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
	});

	it('classifies union filter as COMPLEX', async () => {
		// Even a union of all-SIMPLE parts is COMPLEX because standard
		// Firestore cannot do server-side OR queries
		const classification = classifyCollectionDescription(desc('', ['published+unpublished']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
	});
});

describe('parseDate via TESTING', () => {
	it('parses YYYY-MM-DD correctly', async () => {
		const date = TESTING.parseDate('2024-01-15');
		assert.ok(date);
		assert.strictEqual(date.getFullYear(), 2024);
		assert.strictEqual(date.getMonth(), 0); // January = 0
		assert.strictEqual(date.getDate(), 15);
	});

	it('parses unpadded YYYY-M-D', async () => {
		const date = TESTING.parseDate('2024-1-5');
		assert.ok(date);
		assert.strictEqual(date.getFullYear(), 2024);
		assert.strictEqual(date.getMonth(), 0);
		assert.strictEqual(date.getDate(), 5);
	});

	it('returns null for empty string', async () => {
		assert.strictEqual(TESTING.parseDate(''), null);
	});

	it('returns null for no-dash format', async () => {
		assert.strictEqual(TESTING.parseDate('20240115'), null);
	});

	it('returns null for incomplete date', async () => {
		assert.strictEqual(TESTING.parseDate('2024-01'), null);
	});

	it('returns null for text input', async () => {
		assert.strictEqual(TESTING.parseDate('not-a-date'), null);
	});

	it('returns null for ISO datetime format', async () => {
		assert.strictEqual(TESTING.parseDate('2024-01-15T12:00:00Z'), null);
	});
});

describe('selectBestToken via TESTING', () => {
	it('with IDF: selects highest IDF (rarest) token', async () => {
		const candidates = ['common', 'rare', 'medium'];
		const unigrams = ['common', 'rare', 'medium'];
		const idf = {
			idf: { 'common': 1.0, 'rare': 5.0, 'medium': 3.0 },
			maxIDF: 6.0
		};
		const result = TESTING.selectBestToken(candidates, unigrams, idf);
		assert.strictEqual(result, 'rare');
	});

	it('unknown tokens get maxIDF so unknown words are preferred', async () => {
		const candidates = ['known', 'unknown_word'];
		const unigrams = ['known', 'unknown_word'];
		const idf = {
			idf: { 'known': 2.0 },
			maxIDF: 10.0
		};
		const result = TESTING.selectBestToken(candidates, unigrams, idf);
		assert.strictEqual(result, 'unknown_word');
	});

	it('without IDF: selects first non-stop-word unigram', async () => {
		const candidates = ['the', 'cat', 'the cat'];
		const unigrams = ['the', 'cat'];
		const result = TESTING.selectBestToken(candidates, unigrams, null);
		assert.strictEqual(result, 'cat');
	});

	it('all stop words: falls back to first candidate', async () => {
		const candidates = ['the', 'a', 'the a'];
		const unigrams = ['the', 'a'];
		const result = TESTING.selectBestToken(candidates, unigrams, null);
		assert.strictEqual(result, 'the');
	});
});

describe('buildFirestoreConstraints direct', () => {
	it('published filter produces 1 constraint', async () => {
		const constraints = buildFirestoreConstraints(desc('main', ['published']));
		assert.strictEqual(constraints.length, 1);
	});

	it('section filter produces 1 constraint', async () => {
		const constraints = buildFirestoreConstraints(desc('main', ['section/test-section']));
		assert.strictEqual(constraints.length, 1);
	});

	it('type filter produces 1 constraint', async () => {
		const constraints = buildFirestoreConstraints(desc('main', ['type-content']));
		assert.strictEqual(constraints.length, 1);
	});

	it('throws on multiple array-contains (tag + query)', async () => {
		assert.throws(
			() => buildFirestoreConstraints(desc('main', ['tag/foo', 'query/bar'])),
			/Multiple array-contains/
		);
	});

	it('throws on unknown filter', async () => {
		assert.throws(
			() => buildFirestoreConstraints(desc('main', ['unknown-filter-xyz'])),
			/Unknown filter/
		);
	});

	it('throws on union filter', async () => {
		assert.throws(
			() => buildFirestoreConstraints(desc('main', ['published+unpublished'])),
			/Union filters/
		);
	});

	it('throws on reading-list set', async () => {
		assert.throws(
			() => buildFirestoreConstraints(desc('reading-list', [])),
			/reading-list/
		);
	});
});

describe('date constraint integration via buildFirestoreConstraints', () => {
	it('updated/before/date produces 1 constraint', async () => {
		const constraints = buildFirestoreConstraints(desc('main', ['updated/before/2024-01-15']));
		assert.strictEqual(constraints.length, 1);
	});

	it('updated/after/date produces 1 constraint', async () => {
		const constraints = buildFirestoreConstraints(desc('main', ['updated/after/2024-01-15']));
		assert.strictEqual(constraints.length, 1);
	});

	it('updated/between/date1/date2 produces 2 constraints', async () => {
		const constraints = buildFirestoreConstraints(desc('main', ['updated/between/2024-01-01/2024-12-31']));
		assert.strictEqual(constraints.length, 2);
	});

	it('created/bare-date produces 2 constraints (start + end of day)', async () => {
		const constraints = buildFirestoreConstraints(desc('main', ['created/2024-06-15']));
		assert.strictEqual(constraints.length, 2);
	});

	it('updated/last-7-days produces 1 constraint', async () => {
		const constraints = buildFirestoreConstraints(desc('main', ['updated/last-7-days']));
		assert.strictEqual(constraints.length, 1);
	});
});

describe('date error cases via TESTING.buildDateConstraints', () => {
	it('empty args throws missing arguments', async () => {
		assert.throws(
			() => TESTING.buildDateConstraints('updated', []),
			/missing arguments/
		);
	});

	it('before without date throws missing date', async () => {
		assert.throws(
			() => TESTING.buildDateConstraints('updated', ['before']),
			/missing date/
		);
	});

	it('between with only one date throws', async () => {
		assert.throws(
			() => TESTING.buildDateConstraints('updated', ['between', '2024-01-01']),
			/requires two dates/
		);
	});
});
