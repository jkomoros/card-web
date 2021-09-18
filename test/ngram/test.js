/*eslint-env node*/

import {
	ngramWithinOther
} from '../../src/nlp.js';

import assert from 'assert';


describe('ngram', () => {
	it('within other identity', async () => {
		const container = 'organic';
		const ngram = 'organic';
		const shouldMatch = true;
		assert.ok(shouldMatch == ngramWithinOther(ngram, container));
	});

	it('within other no match', async () => {
		const container = 'organic';
		const ngram = 'organica';
		const shouldMatch = false;
		assert.ok(shouldMatch == ngramWithinOther(ngram, container));
	});

	it('within other no match 2', async () => {
		const container = 'organicb';
		const ngram = 'organica';
		const shouldMatch = false;
		assert.ok(shouldMatch == ngramWithinOther(ngram, container));
	});

	it('within other multi word identity', async () => {
		const container = 'foo bar';
		const ngram = 'foo bar';
		const shouldMatch = true;
		assert.ok(shouldMatch == ngramWithinOther(ngram, container));
	});

	it('within other multi word single ngram', async () => {
		const container = 'foo bar';
		const ngram = 'foo';
		const shouldMatch = true;
		assert.ok(shouldMatch == ngramWithinOther(ngram, container));
	});

	it('within other multi word multi ngram', async () => {
		const container = 'foo bar baz sed';
		const ngram = 'foo bar';
		const shouldMatch = true;
		assert.ok(shouldMatch == ngramWithinOther(ngram, container));
	});

	it('within other multi word multi ngram middle', async () => {
		const container = 'foo bar baz sed';
		const ngram = 'bar baz';
		const shouldMatch = true;
		assert.ok(shouldMatch == ngramWithinOther(ngram, container));
	});

	it('within other multi word multi ngram end', async () => {
		const container = 'foo bar baz sed';
		const ngram = 'baz sed';
		const shouldMatch = true;
		assert.ok(shouldMatch == ngramWithinOther(ngram, container));
	});

	// it('within other partial match word beginning', async () => {
	// 	const container = 'organic juice drink';
	// 	const ngram = 'organ';
	// 	const shouldMatch = false;
	// 	assert.ok(shouldMatch == ngramWithinOther(ngram, container));
	// });

	it('within other partial match word middle', async () => {
		const container = 'organic juice drink';
		const ngram = 'juic';
		const shouldMatch = false;
		assert.ok(shouldMatch == ngramWithinOther(ngram, container));
	});

	// it('within other partial match word end', async () => {
	// 	const container = 'organic juice drink';
	// 	const ngram = 'ink';
	// 	const shouldMatch = false;
	// 	assert.ok(shouldMatch == ngramWithinOther(ngram, container));
	// });

});