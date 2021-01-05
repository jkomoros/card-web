/*eslint-env node*/

import {
	JSDOM
} from 'jsdom';

import {
	overrideDocument
} from '../../src/document.js';

const dom = new JSDOM('');

overrideDocument(dom.window.document);

import {
	normalizeBodyHTML,
} from '../../src/contenteditable.js';

import {
	TESTING
} from '../../src/nlp.js';

import assert from 'assert';

describe('content editable scrubbing', () => {
	it('No op simple content', async () => {
		const input = '<p>Content</p>';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Content</p>\n';
		assert.equal(actual, expected);
	});

	it('Replaces <b> with <strong>', async () => {
		const input = '<p>Strong content is <b>strong</b></p>';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Strong content is <strong>strong</strong></p>\n';
		assert.equal(actual, expected);
	});

	it('Replaces <i> with <em>', async () => {
		const input = '<p>Emphaszied content is <i>emphasized</i></p>';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Emphaszied content is <em>emphasized</em></p>\n';
		assert.equal(actual, expected);
	});

	it('Removes <br>', async () => {
		const input = '<p>Line breaks <br>Should be removed</p>';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Line breaks Should be removed</p>\n';
		assert.equal(actual, expected);
	});

	it('Removes extra line breaks', async () => {
		const input = '<p>Extra line breaks should be removed</p>\n\n<p>They\'re unnecessary</p>';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Extra line breaks should be removed</p>\n<p>They\'re unnecessary</p>\n';
		assert.equal(actual, expected);
	});

	it('Removes internal line breaks', async () => {
		const input = '<p>Extra line breaks \nshould be removed</p>';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Extra line breaks should be removed</p>\n';
		assert.equal(actual, expected);
	});

	it('Line breaks for ul', async () => {
		const input = '<ul><li>List one</li><li>List two</li></ul>';
		const actual = normalizeBodyHTML(input);
		const expected = '<ul>\n\t<li>List one</li>\n\t<li>List two</li>\n</ul>\n';
		assert.equal(actual, expected);
	});

	it('Line breaks for ol', async () => {
		const input = '<ol><li>List one</li><li>List two</li></ol>';
		const actual = normalizeBodyHTML(input);
		const expected = '<ol>\n\t<li>List one</li>\n\t<li>List two</li>\n</ol>\n';
		assert.equal(actual, expected);
	});

	it('a to card-link for card', async () => {
		const input = '<p>Here is a <a href=\'abc-cde\'>link to a card</a></p>\n';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Here is a <card-link card="abc-cde">link to a card</card-link></p>\n';
		assert.equal(actual, expected);
	});

	it('a to card-link for normal link', async () => {
		const input = '<p>Here is a <a href=\'https://www.google.com\'>link to a webpage</a></p>\n';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Here is a <card-link href="https://www.google.com">link to a webpage</card-link></p>\n';
		assert.equal(actual, expected);
	});

	it('spans are removed', async () => {
		const input = '<p>Content <span>that</span><span> should</span> be removed</p>\n';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Content that should be removed</p>\n';
		assert.equal(actual, expected);
	});

	it('fonts are removed', async () => {
		const input = '<p>Content <font style="color:red">that</font><font> should</font> be removed</p>\n';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Content that should be removed</p>\n';
		assert.equal(actual, expected);
	});

	it('Anon content at top level gets p wrapper', async () => {
		const input = 'Content';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Content</p>\n';
		assert.equal(actual, expected);
	});

	it('Anon content in ol gets li wrapper', async () => {
		const input = '<ol>List one</ol>';
		const actual = normalizeBodyHTML(input);
		const expected = '<ol>\n\t<li>List one</li>\n</ol>\n';
		assert.equal(actual, expected);
	});

	it('Anon content in ul gets li wrapper', async () => {
		const input = '<ul>List one</ul>';
		const actual = normalizeBodyHTML(input);
		const expected = '<ul>\n\t<li>List one</li>\n</ul>\n';
		assert.equal(actual, expected);
	});

	it('Anon mixed top-level content gets wrapped in p', async () => {
		const input = 'Content <strong>mixed</strong> at top';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Content <strong>mixed</strong> at top</p>\n';
		assert.equal(actual, expected);
	});

	it('Anon mixed top-level content gets wrapped in p but not parts already in a valid-top level', async () => {
		const input = 'Content <strong>mixed</strong> at top <p>another</p> other';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Content <strong>mixed</strong> at top</p>\n<p>another</p>\n<p>other</p>\n';
		assert.equal(actual, expected);
	});

	it('Anon mixed top-level content gets wrapped in <ol> but not parts already in a valid-top level', async () => {
		const input = 'Content <strong>mixed</strong> at top <ol><li>yup</li></ol> other';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Content <strong>mixed</strong> at top</p>\n<ol>\n\t<li>yup</li>\n</ol>\n<p>other</p>\n';
		assert.equal(actual, expected);
	});

	it('h2 allowed at top level', async () => {
		const input = '<h2>Content</h2>';
		const actual = normalizeBodyHTML(input);
		const expected = '<h2>Content</h2>\n';
		assert.equal(actual, expected);
	});

	it('non-text-non-legal-top-node at beginning of top level', async () => {
		const input = '<strong>Content</strong> other';
		const actual = normalizeBodyHTML(input);
		const expected = '<p><strong>Content</strong> other</p>\n';
		assert.equal(actual, expected);
	});

	it('Remove all styles', async () => {
		const input = '<p style="color:red">Styled <strong style="color:blue">content</strong></p>';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Styled <strong>content</strong></p>\n';
		assert.equal(actual, expected);
	});

	it('Spans with a class are left', async () => {
		const input = '<p>Styled <span class="small">content</span></p>';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Styled <span class="small">content</span></p>\n';
		assert.equal(actual, expected);
	});

	it('card-links with a munged href are modified', async () => {
		//If you copy/paste content-editable with a card-link, the href is munged.
		const input = '<p><card-link href="http://localhost:8081/cardid">This is some text</card-link></p>';
		const actual = normalizeBodyHTML(input);
		const expected = '<p><card-link card="cardid">This is some text</card-link></p>\n';
		assert.equal(actual, expected);
	});

	it('content with a role or dir attribute is removed', async () => {
		const input = '<p role="presentation">Styled <strong dir="ltr">content</strong></p>';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Styled <strong>content</strong></p>\n';
		assert.equal(actual, expected);
	});

});

describe('html highlighting', () => {
	it('No op simple content', () => {
		const input = '<p>Content</p>';
		const actual = TESTING.highlightStringInHTML(input, 'foo', 'c-123');
		const expected = '<p>Content</p>';
		assert.strictEqual(actual, expected);
	});

	it('Single word replacement full precise word', () => {
		const input = '<p>foo</p>';
		const actual = TESTING.highlightStringInHTML(input, 'foo', 'c-123');
		const expected = '<p><card-highlight card="c-123">foo</card-highlight></p>';
		assert.strictEqual(actual, expected);
	});

	it('multi word replacement full precise words', () => {
		const input = '<p>foo Bar</p>';
		const actual = TESTING.highlightStringInHTML(input, 'foo bar', 'c-123');
		const expected = '<p><card-highlight card="c-123">foo Bar</card-highlight></p>';
		assert.strictEqual(actual, expected);
	});

	it('multi word replacement full words with extra before and after', () => {
		const input = '<p>Before and foo Bar after</p>';
		const actual = TESTING.highlightStringInHTML(input, 'foo bar', 'c-123');
		const expected = '<p>Before and <card-highlight card="c-123">foo Bar</card-highlight> after</p>';
		assert.strictEqual(actual, expected);
	});

	it('multi word replacement with inner extra puncutation and prefixes', () => {
		const input = '<p>Before and foo--Bar after</p>';
		const actual = TESTING.highlightStringInHTML(input, 'foo bar', 'c-123');
		const expected = '<p>Before and <card-highlight card="c-123">foo--Bar</card-highlight> after</p>';
		assert.strictEqual(actual, expected);
	});

	it('multi word replacement full precise words double depth element', () => {
		const input = '<p>Blammo <span>foo Bar</span> Blammo</p>';
		const actual = TESTING.highlightStringInHTML(input, 'foo bar', 'c-123');
		const expected = '<p>Blammo <span><card-highlight card="c-123">foo Bar</card-highlight></span> Blammo</p>';
		assert.strictEqual(actual, expected);
	});

	it('multi word replacement with inner escaped puncutation and prefixes', () => {
		const input = '<p>Before and foo&emdash;Bar after</p>';
		const actual = TESTING.highlightStringInHTML(input, 'foo bar', 'c-123');
		const expected = '<p>Before and <card-highlight card="c-123">foo&emdash;Bar</card-highlight> after</p>';
		assert.strictEqual(actual, expected);
	});

	it('multi word replacement across element break is skipped', () => {
		const input = '<p>Before and foo</p><p> Bar after</p>';
		const actual = TESTING.highlightStringInHTML(input, 'foo bar', 'c-123');
		const expected = '<p>Before and foo</p><p> Bar after</p>';
		assert.strictEqual(actual, expected);
	});

	it('multi word replacement across element break is skipped', () => {
		const input = '<p>Before and foo</p><p> Bar after</p>';
		const actual = TESTING.highlightStringInHTML(input, 'foo bar', 'c-123');
		const expected = '<p>Before and foo</p><p> Bar after</p>';
		assert.strictEqual(actual, expected);
	});

	it('multi word replacement with a peer child element', () => {
		const input = '<p>Before and foo Bar after <strong>other</strong></p>';
		const actual = TESTING.highlightStringInHTML(input, 'foo bar', 'c-123');
		const expected = '<p>Before and <card-highlight card="c-123">foo Bar</card-highlight> after <strong>other</strong></p>';
		assert.strictEqual(actual, expected);
	});

	it('multi word replacement x2 with a peer child element', () => {
		const input = '<p>Before and foo Bar after <strong>other</strong> and another foo: :bar yo</p>';
		const actual = TESTING.highlightStringInHTML(input, 'foo bar', 'c-123');
		const expected = '<p>Before and <card-highlight card="c-123">foo Bar</card-highlight> after <strong>other</strong> and another <card-highlight card="c-123">foo: :bar</card-highlight> yo</p>';
		assert.strictEqual(actual, expected);
	});

	it('multi word replacement with a peer existing card-highlight element', () => {
		const input = '<p>Before and <card-highlight card="c-345">slam yo</card-highlight> and then foo bar after</p>';
		const actual = TESTING.highlightStringInHTML(input, 'foo bar', 'c-123');
		const expected = '<p>Before and <card-highlight card="c-345">slam yo</card-highlight> and then <card-highlight card="c-123">foo bar</card-highlight> after</p>';
		assert.strictEqual(actual, expected);
	});

	//Test that if a word is bolded in the middle of a multi-word test string it works (that is, if the card highlight would fully contain other text nodes)
	//Test that it doesn't highlight within another highlight
	//Test that it doesn't highlight inside a link
	//Test taht it doens't highlight outside of word boundaries (e.g. continuous within discontinous)
});