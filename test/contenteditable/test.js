/*eslint-env node*/

import {
	normalizeBodyHTML,
	overrideDocument
} from '../../src/contenteditable.js';

import {
	JSDOM	
} from 'jsdom';

import assert from 'assert';

const dom = new JSDOM('');

overrideDocument(dom.window.document);

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

});