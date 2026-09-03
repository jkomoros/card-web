/*eslint-env node, es2022*/

//ONE PARSER, PINNED FROM BOTH ENDS (owner, F4).
//
//`tag:internal` has to mean the same thing in the find dialog and in the
//composer, and the only way that stays true is if there is one module and both
//suites point at it. So this file has three parts:
//
//  1. THE MODULE ITSELF — the operator table, the value ladder, and the rule
//     that an unknown prefix is not an operator.
//  2. THE FIND-DIALOG FLOOR — extractFiltersFromQuery, which is the find
//     dialog's whole reading of what the user typed. Every behavior the old
//     private parser in nlp.ts had is asserted here, because "the floor" is not
//     a promise unless something checks it.
//  3. THE COMPOSER END — that a parsed operator reaches the completion index at
//     tier `parsed`, which is the top of the ranking, and that a colon in plain
//     text still costs nothing.

import { JSDOM } from 'jsdom';
import assert from 'assert';

const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

let parseQueryOperatorToken;
let parseQueryOperators;
let queryOperatorFamilyForWord;
let queryOperatorWords;
let extractFiltersFromQuery;
let collectionCompletionCandidates;
let CollectionDescription;

//A small closed world, so a case says what it depends on rather than depending
//on whatever the real corpus happens to contain today.
const VOCABULARY = {
	tags: ['internal', 'interesting', 'systems'],
	sections: ['about', 'half-baked'],
	cardTypes: ['content', 'working-notes', 'concept'],
	filters: ['published', 'unpublished', 'starred', 'has-links', 'has-comments', 'no-comments'],
	sorts: ['default', 'recent', 'stars', 'created'],
	sets: ['main', 'reading-list', 'everything'],
	authors: ['abc123'],
};

const draft = (serialized = 'everything/') => CollectionDescription.deserialize(serialized);

describe('Query operators', () => {
	before(async () => {
		({
			parseQueryOperatorToken,
			parseQueryOperators,
			queryOperatorFamilyForWord,
			queryOperatorWords,
		} = await import('../../lib/src/query-operators.js'));
		({ extractFiltersFromQuery } = await import('../../lib/src/nlp.js'));
		({ collectionCompletionCandidates } = await import('../../lib/src/collection-completion-index.js'));
		({ CollectionDescription } = await import('../../lib/src/collection_description.js'));
	});

	describe('the operator table', () => {

		it('names every operator the owner asked for, plus the find dialog’s inheritance', () => {
			for (const [word, family] of [
				['tag', 'tag'],
				['tagged', 'tag'],
				['section', 'section'],
				['card-type', 'card-type'],
				['type', 'card-type'],
				['query', 'query'],
				['sort', 'sort'],
				['set', 'set'],
				['author', 'person'],
				['filter', 'filter'],
				['is', 'filter'],
				['has', 'filter'],
			]) {
				assert.strictEqual(queryOperatorFamilyForWord(word), family, `${word}: is the ${family} operator`);
			}
		});

		it('exposes its own words so a surface can teach the grammar from the table', () => {
			const words = queryOperatorWords();
			assert.ok(words.includes('tag'), 'the table is what a surface would list');
			assert.ok(words.length >= 12, 'every alias is reachable, not only the canonical words');
		});

		it('an unknown prefix is not an operator, so a colon in plain text is plain text', () => {
			for (const token of ['ratio:3', 'note:', 'http://example.com', 'a:b', ':leading', 'nocolon']) {
				assert.strictEqual(parseQueryOperatorToken(token, VOCABULARY), null, `${token} is text`);
			}
		});
	});

	describe('the value ladder, scoped to the operator’s family', () => {

		it('matches exactly', () => {
			const parsed = parseQueryOperatorToken('tag:internal', VOCABULARY);
			assert.strictEqual(parsed.family, 'tag');
			assert.strictEqual(parsed.value, 'internal');
			assert.strictEqual(parsed.match, 'exact');
			assert.strictEqual(parsed.filter, 'internal');
		});

		it('matches by prefix, shortest candidate first', () => {
			const parsed = parseQueryOperatorToken('tag:inter', VOCABULARY);
			//Both 'internal' and 'interesting' start with 'inter'; the shorter one
			//is the one an abbreviation most likely meant.
			assert.strictEqual(parsed.value, 'internal');
			assert.strictEqual(parsed.match, 'prefix');
		});

		it('matches a typo — the owner’s own case', () => {
			const parsed = parseQueryOperatorToken('tag:intrnal', VOCABULARY);
			assert.strictEqual(parsed.value, 'internal');
			assert.strictEqual(parsed.match, 'typo');
			assert.strictEqual(parsed.filter, 'internal');
		});

		it('scopes the ladder to the family, so one drawer cannot answer for another', () => {
			//'content' is a card type, not a tag. Asked as a tag it does not
			//resolve, even though the very same string resolves as a card type.
			assert.strictEqual(parseQueryOperatorToken('tag:content', VOCABULARY).match, 'unresolved');
			assert.strictEqual(parseQueryOperatorToken('type:content', VOCABULARY).match, 'exact');
		});

		it('still accepts a value it cannot resolve, because the find dialog always has', () => {
			const parsed = parseQueryOperatorToken('tag:nosuchtag', VOCABULARY);
			assert.strictEqual(parsed.match, 'unresolved');
			assert.strictEqual(parsed.filter, 'nosuchtag');
		});

		//AN UNRESOLVED VALUE IS STILL USER TEXT, AND THESE FAMILIES SPELL IT AS A
		//BARE PATH SEGMENT. `tag:a/b` produced the filter `a/b`, which the
		//collection path reads as two filters; `by:x/y` produced `author/x/y`, a
		//family with arity 2 whose parser takes 1. `#` and `?` never reach the
		//parser at all — the browser truncates the path there. So the operator is
		//still READ (a surface wants to know the drawer was opened) and it names
		//no filter.
		it('refuses to name a filter from an unresolved value a path cannot carry', () => {
			for (const token of ['tag:a/b', 'section:a/b', 'type:a/b', 'by:x/y', 'tag:50%', 'tag:a#b', 'tag:a?b']) {
				const parsed = parseQueryOperatorToken(token, VOCABULARY);
				assert.strictEqual(parsed.match, 'unresolved', `${token} resolves to nothing`);
				assert.strictEqual(parsed.filter, '', `${token} must name no filter, got ${parsed.filter}`);
			}
			//And a whole typed line drops it rather than carrying a broken clause.
			assert.deepStrictEqual(parseQueryOperators('tag:a/b tag:internal', VOCABULARY).filters, ['internal']);
		});

		//THE REFUSAL IS SCOPED TO `unresolved`, WHICH IS THE ONLY KIND THAT CAN
		//CARRY ARBITRARY TEXT. A resolved value came out of the corpus's own
		//vocabulary and is a real name by construction; `filter:`/`is:` is the
		//documented escape hatch for naming a filter the app does not know, and a
		//configurable filter's own spelling legitimately contains slashes.
		it('leaves the resolved values and the filter escape hatch alone', () => {
			assert.strictEqual(parseQueryOperatorToken('tag:internal', VOCABULARY).filter, 'internal');
			assert.strictEqual(parseQueryOperatorToken('by:me', VOCABULARY).filter, 'author/me');
			assert.strictEqual(parseQueryOperatorToken('filter:updated/after/today', VOCABULARY).filter, 'updated/after/today');
			//And with no vocabulary at all the find dialog's trust-the-user path
			//is byte-identical, slashes included.
			assert.strictEqual(parseQueryOperatorToken('tag:a/b').filter, 'a/b');
		});

		it('checks nothing when the caller offers no vocabulary', () => {
			const parsed = parseQueryOperatorToken('tag:intrnal');
			assert.strictEqual(parsed.match, 'literal');
			assert.strictEqual(parsed.filter, 'intrnal');
		});

		it('treats an empty vocabulary as “I do not know”, not as “nothing exists”', () => {
			const parsed = parseQueryOperatorToken('tag:whatever', {tags: []});
			assert.strictEqual(parsed.match, 'literal');
			assert.strictEqual(parsed.filter, 'whatever');
		});

		it('spells a person as the app spells one', () => {
			assert.strictEqual(parseQueryOperatorToken('author:me', VOCABULARY).filter, 'author/me');
			assert.strictEqual(parseQueryOperatorToken('author:abc123', VOCABULARY).filter, 'author/abc123');
		});
	});

	describe('the whole string', () => {

		it('reads operators anywhere, in any order, and keeps the rest as text', () => {
			const parsed = parseQueryOperators('crystallizing tag:internal blammo', VOCABULARY);
			assert.strictEqual(parsed.text, 'crystallizing blammo');
			assert.deepStrictEqual(parsed.filters, ['internal']);
		});

		it('carries a sort and a set out of the string', () => {
			const parsed = parseQueryOperators('sort:stars set:everything published', VOCABULARY);
			assert.strictEqual(parsed.sort, 'stars');
			assert.strictEqual(parsed.set, 'everything');
			assert.strictEqual(parsed.sortReversed, false);
			assert.strictEqual(parsed.text, 'published');
		});

		it('reads a reversed sort', () => {
			for (const token of ['sort:reverse-recent', 'sort:-recent']) {
				const parsed = parseQueryOperators(token, VOCABULARY);
				assert.strictEqual(parsed.sort, 'recent', token);
				assert.strictEqual(parsed.sortReversed, true, token);
			}
		});

		it('lets the last sort win, because a collection has one order', () => {
			const parsed = parseQueryOperators('sort:stars sort:created', VOCABULARY);
			assert.strictEqual(parsed.sort, 'created');
		});

		it('folds query: back into the text rather than making a second filter', () => {
			const parsed = parseQueryOperators('query:stale tag:internal', VOCABULARY);
			assert.strictEqual(parsed.text, 'stale');
			assert.deepStrictEqual(parsed.filters, ['internal']);
		});

		it('reports every operator it read, for a caller that wants to explain itself', () => {
			const parsed = parseQueryOperators('tag:internal sort:stars ratio:3', VOCABULARY);
			assert.deepStrictEqual(parsed.operators.map(entry => entry.family), ['tag', 'sort']);
			assert.strictEqual(parsed.text, 'ratio:3', 'the unknown prefix stayed text');
		});
	});

	//--- The find dialog's floor ---------------------------------------------

	describe('the find dialog’s existing behaviour, as a floor', () => {

		//The three cases test/fingerprint/test.js has always pinned, restated
		//here so a change to the shared module is caught by the shared module's
		//own suite as well as by the one that predates it.
		it('parses one word and one filter', () => {
			assert.deepStrictEqual(extractFiltersFromQuery('crystallizing filter:has-links'), ['crystallizing', ['has-links']]);
		});

		it('parses two words and one filter', () => {
			assert.deepStrictEqual(extractFiltersFromQuery('crystallizing blammo filter:has-links'), ['crystallizing blammo', ['has-links']]);
		});

		it('parses a filter in between two words', () => {
			assert.deepStrictEqual(extractFiltersFromQuery('crystallizing filter:has-links blammo'), ['crystallizing blammo', ['has-links']]);
		});

		it('keeps is: as a synonym for filter:', () => {
			assert.deepStrictEqual(extractFiltersFromQuery('is:published'), ['', ['published']]);
		});

		it('keeps the tag: and section: bare-token spellings', () => {
			assert.deepStrictEqual(extractFiltersFromQuery('tag:foo'), ['', ['foo']]);
			assert.deepStrictEqual(extractFiltersFromQuery('section:bar'), ['', ['bar']]);
		});

		it('keeps the has: / has:no- asymmetry exactly', () => {
			assert.deepStrictEqual(extractFiltersFromQuery('has:comments'), ['', ['has-comments']]);
			assert.deepStrictEqual(extractFiltersFromQuery('has:no-comments'), ['', ['no-comments']]);
		});

		it('lower-cases everything, as it always did', () => {
			assert.deepStrictEqual(extractFiltersFromQuery('Tag:Foo Crystallizing'), ['crystallizing', ['foo']]);
		});

		it('trusts a filter name it does not know, as it always did', () => {
			assert.deepStrictEqual(extractFiltersFromQuery('filter:nosuchfilter'), ['', ['nosuchfilter']]);
		});

		it('collapses runs of whitespace into single spaces, as it always did', () => {
			assert.deepStrictEqual(extractFiltersFromQuery('  crystallizing\tblammo  '), ['crystallizing blammo', []]);
		});

		it('is MORE powerful than it was: sort: and set: are no longer searched for as words', () => {
			//Before the shared parser these were plain text and ended up inside
			//the query/ filter, so a find for `sort:stars` searched card prose for
			//the literal string.
			assert.deepStrictEqual(extractFiltersFromQuery('sort:stars'), ['', []]);
			assert.strictEqual(parseQueryOperators('sort:stars').sort, 'stars');
		});
	});

	//--- The composer end ----------------------------------------------------

	describe('the composer reads the same operators, at the top tier', () => {

		const candidates = [
			{filter: 'internal', category: 'tag', label: 'Internal', clauseLabel: 'Tagged internal'},
			{filter: 'about', category: 'section', label: 'About', clauseLabel: 'Section About'},
			{filter: 'content', category: 'card type', label: 'Content', clauseLabel: 'Card type Content'},
		];

		const candidatesFor = (token) => collectionCompletionCandidates({
			token,
			expression: [],
			description: draft(),
			context: {candidates},
			limit: 20,
		});

		it('parses tag:internal as a literal, at the top of the ranking', () => {
			const results = candidatesFor('tag:internal');
			assert.ok(results.length, 'the operator produced a candidate');
			assert.strictEqual(results[0].tier, 'parsed', 'a parse leads the list');
			assert.strictEqual(results[0].filter, 'internal');
		});

		it('typo-matches the value inside the operator’s own family', () => {
			const results = candidatesFor('tag:intrnal');
			assert.strictEqual(results[0].tier, 'parsed');
			assert.strictEqual(results[0].filter, 'internal');
		});

		it('reads card-type: and its type: alias', () => {
			for (const token of ['card-type:content', 'type:content']) {
				const results = candidatesFor(token);
				assert.strictEqual(results[0].tier, 'parsed', token);
				assert.strictEqual(results[0].filter, 'content', token);
			}
		});

		it('reads section:', () => {
			const results = candidatesFor('section:about');
			assert.strictEqual(results[0].tier, 'parsed');
			assert.strictEqual(results[0].filter, 'about');
		});

		it('reads query: as a parse rather than as the free-text guess', () => {
			const results = candidatesFor('query:stale');
			assert.strictEqual(results[0].tier, 'parsed');
			assert.strictEqual(results[0].filter, 'query/stale');
		});

		it('reads sort: and set: as the sentence words they change', () => {
			const sorted = candidatesFor('sort:stars');
			assert.strictEqual(sorted[0].tier, 'parsed');
			assert.strictEqual(sorted[0].kind, 'sort');
			const set = candidatesFor('set:reading-list');
			assert.strictEqual(set[0].tier, 'parsed');
			assert.strictEqual(set[0].kind, 'set');
		});

		it('leaves an unknown prefix to the ordinary tiers, so a colon breaks nothing', () => {
			const results = candidatesFor('ratio:3');
			assert.ok(!results.some(result => result.tier === 'parsed' && result.filter === 'ratio:3'), 'nothing was parsed');
			assert.ok(results.length, 'and the ordinary reading still answered');
		});
	});
});
