/*eslint-env node*/

import {
	cardIsPrioritized
} from '../../lib/src/util.js';

import assert from 'assert';

describe('cardIsPrioritized', () => {
	it('returns false for null card', async () => {
		assert.strictEqual(cardIsPrioritized(null), false);
	});

	it('returns true when auto_todo_overrides.prioritized === false (inverted semantics)', async () => {
		const card = { auto_todo_overrides: { prioritized: false } };
		assert.strictEqual(cardIsPrioritized(card), true);
	});

	it('returns false when auto_todo_overrides.prioritized === true', async () => {
		const card = { auto_todo_overrides: { prioritized: true } };
		assert.strictEqual(cardIsPrioritized(card), false);
	});

	it('returns false when auto_todo_overrides.prioritized === undefined', async () => {
		const card = { auto_todo_overrides: {} };
		assert.strictEqual(cardIsPrioritized(card), false);
	});

	it('returns false when auto_todo_overrides.prioritized === null', async () => {
		const card = { auto_todo_overrides: { prioritized: null } };
		assert.strictEqual(cardIsPrioritized(card), false);
	});

	it('returns false when auto_todo_overrides.prioritized === 0 (strict false check, not falsy)', async () => {
		const card = { auto_todo_overrides: { prioritized: 0 } };
		assert.strictEqual(cardIsPrioritized(card), false);
	});
});

//THE WORKER AND THE MAIN THREAD MUST TOKENIZE THE SAME TEXT.
//
//innerTextForHTML uses the DOM when there is one and a regex extractor when
//there is not. NOTHING under src/worker/ calls overrideDocument, so the worker
//ALWAYS takes the fallback — and the worker owns similarity, fingerprints and
//suggestions in the default mode. The fallback decoded six entities, so
//`A &mdash; B` tokenized as [a, mdash, b] there and [a, b] on the main thread,
//and `caf&eacute;` split into [caf, eacute] instead of [café].
//
//`nlp_source_fingerprint` is computed from RAW card fields, so it cannot detect
//this divergence and will never heal it. The only thing that keeps the two
//paths honest is a test that runs both.
describe('innerTextForHTML parity between the worker and main-thread paths', () => {

	let util;
	let overrideDocument;
	let JSDOM;

	//Deliberately a range of the CLASSES that diverged, not a list of the
	//entities now in the table: typographic punctuation, accented Latin-1
	//(which silently split a word into two tokens), numeric and hex forms, an
	//UNKNOWN entity (must survive as literal text rather than be dropped), and
	//the &amp; ordering trap.
	const SAMPLES = [
		'A &mdash; B',
		'<p>Hello &amp; goodbye</p>',
		'x &nbsp; y',
		'<p>a</p><p>b</p>',
		'caf&eacute; au lait',
		'na&iuml;ve r&eacute;sum&eacute;',
		'a &ndash; b &hellip; c',
		'&#8212; numeric',
		'&#x2014; hex',
		'literal &amp;mdash; stays literal',
		'&unknownentity; is kept',
		'25 &deg;C &plusmn; 2',
		'Se&ntilde;or &amp; Se&ntilde;ora',
		'<p>Multi</p><p>block &mdash; content</p>',
	];

	before(async () => {
		util = await import('../../lib/shared/util.js');
		({overrideDocument} = await import('../../lib/shared/document.js'));
		({JSDOM} = await import('jsdom'));
	});

	it('produces byte-identical text with and without a document', () => {
		//Run the document-less path FIRST: overrideDocument is global and
		//permanent, so the order matters.
		const withoutDocument = SAMPLES.map(sample => util.innerTextForHTML(sample));
		overrideDocument(new JSDOM('').window.document);
		const withDocument = SAMPLES.map(sample => util.innerTextForHTML(sample));
		for (const [index, sample] of SAMPLES.entries()) {
			assert.strictEqual(withoutDocument[index], withDocument[index],
				`worker and main-thread extraction differ for ${JSON.stringify(sample)}`);
		}
	});

	it('keeps an unknown entity as literal text rather than dropping it', () => {
		//Dropping it would delete a word from the index silently; keeping it
		//tokenizes something slightly wrong but visible.
		assert.ok(util.innerTextForHTML('&unknownentity; kept').includes('unknownentity'));
	});

	it('decodes &amp; LAST, so an escaped entity stays escaped', () => {
		//`&amp;mdash;` is the literal text "&mdash;", not an em dash. Decoding
		//&amp; first would silently turn documentation about entities into the
		//entities themselves.
		assert.strictEqual(util.innerTextForHTML('&amp;mdash;'), '&mdash;');
	});
});
