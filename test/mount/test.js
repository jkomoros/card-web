/*eslint-env node*/

import {
	JSDOM
} from 'jsdom';

import {
	overrideDocument
} from '../../lib/src/document.js';

const dom = new JSDOM('');

overrideDocument(dom.window.document);

import {
	normalizeBodyHTMLString,
	replaceAnchorsWithCardLinks,
	normalizeLineBreaks,
} from '../../lib/shared/util.js';

import {
	normalizeBodyHTML,
} from '../../lib/src/contenteditable.js';

import snarkdown from 'snarkdown';

import assert from 'assert';

//--- Replicate markdownToHTML from tools/mount.ts ---

const BLOCK_TAG_REGEX = /^<(p|ul|ol|h[1-4]|blockquote)[\s>]/;

const markdownToHTML = (markdown) => {
	if (!markdown) return '';

	// Step 1: Wiki-link replacement (pass through snarkdown as inline HTML)
	let html = markdown.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g,
		(_match, cardId, text) => `<card-link card="${cardId}">${text}</card-link>`
	);
	html = html.replace(/\[\[([^\]]+)\]\]/g,
		(_match, cardId) => `<card-link card="${cardId}">${cardId}</card-link>`
	);

	// Step 2: Paragraph split + snarkdown
	const paragraphs = html.split(/\n\n+/).filter(p => p.trim());
	const converted = paragraphs.map(p => {
		const trimmed = p.trim();
		if (BLOCK_TAG_REGEX.test(trimmed)) return trimmed;
		const result = snarkdown(trimmed);
		if (BLOCK_TAG_REGEX.test(result)) return result;
		return `<p>${result}</p>`;
	});
	let result = converted.join('');

	// Step 3: Post-snarkdown unescape (skip <code> blocks)
	result = result.replace(/<code>[\s\S]*?<\/code>|\\([\\*_`~\[\]#>+\-.=])/g,
		(match, escaped) => escaped !== undefined ? escaped : match
	);

	// Step 4: Convert <a href> to canonical <card-link> (shared)
	result = replaceAnchorsWithCardLinks(result);

	// Step 5: Canonical normalization (shared)
	result = normalizeBodyHTMLString(result);

	return result;
};

//--- Suite 1: normalizeBodyHTMLString ---

describe('normalizeBodyHTMLString', () => {
	it('Strips <br> tag', () => {
		const input = '<p>Hello<br>world</p>';
		const actual = normalizeBodyHTMLString(input);
		const expected = '<p>Helloworld</p>\n';
		assert.strictEqual(actual, expected);
	});

	it('Strips <br/> tag', () => {
		const input = '<p>Hello<br/>world</p>';
		const actual = normalizeBodyHTMLString(input);
		const expected = '<p>Helloworld</p>\n';
		assert.strictEqual(actual, expected);
	});

	it('Strips <br /> tag (with space)', () => {
		const input = '<p>Hello<br />world</p>';
		const actual = normalizeBodyHTMLString(input);
		const expected = '<p>Helloworld</p>\n';
		assert.strictEqual(actual, expected);
	});

	it('Converts <b> to <strong>', () => {
		const input = '<p><b>bold</b></p>';
		const actual = normalizeBodyHTMLString(input);
		const expected = '<p><strong>bold</strong></p>\n';
		assert.strictEqual(actual, expected);
	});

	it('Converts <i> to <em>', () => {
		const input = '<p><i>italic</i></p>';
		const actual = normalizeBodyHTMLString(input);
		const expected = '<p><em>italic</em></p>\n';
		assert.strictEqual(actual, expected);
	});

	it('Adds canonical line breaks after block elements', () => {
		const input = '<ul><li>a</li><li>b</li></ul>';
		const actual = normalizeBodyHTMLString(input);
		const expected = '<ul>\n\t<li>a</li>\n\t<li>b</li>\n</ul>\n';
		assert.strictEqual(actual, expected);
	});

	it('Replaces &nbsp; with space', () => {
		const input = '<p>Hello&nbsp;world</p>';
		const actual = normalizeBodyHTMLString(input);
		const expected = '<p>Hello world</p>\n';
		assert.strictEqual(actual, expected);
	});

	it('No-op on empty string', () => {
		const input = '';
		const actual = normalizeBodyHTMLString(input);
		assert.strictEqual(actual, '');
	});

	it('No-op on already-canonical HTML', () => {
		const input = '<p>Hello world</p>\n';
		const actual = normalizeBodyHTMLString(input);
		assert.strictEqual(actual, input);
	});
});

//--- Suite 2: replaceAnchorsWithCardLinks ---

describe('replaceAnchorsWithCardLinks', () => {
	it('Converts <a href="https://..."> to <card-link href="...">', () => {
		const input = '<a href="https://example.com">Example</a>';
		const actual = replaceAnchorsWithCardLinks(input);
		const expected = '<card-link href="https://example.com">Example</card-link>';
		assert.strictEqual(actual, expected);
	});

	it('Converts <a href="http://..."> to <card-link href="...">', () => {
		const input = '<a href="http://example.com">Example</a>';
		const actual = replaceAnchorsWithCardLinks(input);
		const expected = '<card-link href="http://example.com">Example</card-link>';
		assert.strictEqual(actual, expected);
	});

	it('Converts <a href="/path"> to <card-link href="/path">', () => {
		const input = '<a href="/some/path">Link</a>';
		const actual = replaceAnchorsWithCardLinks(input);
		const expected = '<card-link href="/some/path">Link</card-link>';
		assert.strictEqual(actual, expected);
	});

	it('Converts <a href="card-id"> to <card-link card="card-id">', () => {
		const input = '<a href="my-card-id">Card</a>';
		const actual = replaceAnchorsWithCardLinks(input);
		const expected = '<card-link card="my-card-id">Card</card-link>';
		assert.strictEqual(actual, expected);
	});

	it('Handles multiple anchors in one string', () => {
		const input = '<p><a href="https://a.com">A</a> and <a href="card-1">B</a></p>';
		const actual = replaceAnchorsWithCardLinks(input);
		const expected = '<p><card-link href="https://a.com">A</card-link> and <card-link card="card-1">B</card-link></p>';
		assert.strictEqual(actual, expected);
	});

	it('No-op when no anchors present', () => {
		const input = '<p>No links here</p>';
		const actual = replaceAnchorsWithCardLinks(input);
		assert.strictEqual(actual, input);
	});
});

//--- Suite 3: markdownToHTML round-trip ---

describe('markdownToHTML round-trip', () => {
	it('Simple paragraph', () => {
		const actual = markdownToHTML('Hello world');
		const expected = '<p>Hello world</p>\n';
		assert.strictEqual(actual, expected);
	});

	it('Bold text', () => {
		const actual = markdownToHTML('**bold**');
		const expected = '<p><strong>bold</strong></p>\n';
		assert.strictEqual(actual, expected);
	});

	it('Italic text', () => {
		const actual = markdownToHTML('*italic*');
		const expected = '<p><em>italic</em></p>\n';
		assert.strictEqual(actual, expected);
	});

	it('External link', () => {
		const actual = markdownToHTML('[text](https://example.com)');
		const expected = '<p><card-link href="https://example.com">text</card-link></p>\n';
		assert.strictEqual(actual, expected);
	});

	it('Wiki-link simple', () => {
		const actual = markdownToHTML('[[card-id]]');
		const expected = '<p><card-link card="card-id">card-id</card-link></p>\n';
		assert.strictEqual(actual, expected);
	});

	it('Wiki-link with text', () => {
		const actual = markdownToHTML('[[card-id|display]]');
		const expected = '<p><card-link card="card-id">display</card-link></p>\n';
		assert.strictEqual(actual, expected);
	});

	it('List items have canonical whitespace', () => {
		const actual = markdownToHTML('- one\n- two');
		assert.ok(actual.includes('<ul>\n\t<li>'), 'Should have canonical <ul>\\n\\t<li> whitespace');
		assert.ok(actual.includes('one</li>\n'), 'Should have </li>\\n');
		assert.ok(actual.includes('two</li>\n'), 'Should have </li>\\n');
	});

	it('List NOT wrapped in <p>', () => {
		const actual = markdownToHTML('- one\n- two');
		assert.ok(!actual.includes('<p><ul>'), 'List should not be wrapped in <p>');
		assert.ok(!actual.includes('<p><li>'), 'List items should not be wrapped in <p>');
	});

	it('Multiple paragraphs separated by blank line', () => {
		const actual = markdownToHTML('First paragraph\n\nSecond paragraph');
		assert.ok(actual.includes('<p>First paragraph</p>'), 'Should contain first paragraph');
		assert.ok(actual.includes('<p>Second paragraph</p>'), 'Should contain second paragraph');
	});

	it('Backslash unescape outside code', () => {
		const actual = markdownToHTML('some\\_thing');
		assert.ok(actual.includes('some_thing'), 'Backslash before underscore should be unescaped');
		assert.ok(!actual.includes('\\'), 'No backslash should remain');
	});

	it('Backslash unescape skips code', () => {
		const actual = markdownToHTML('`some\\_thing`');
		assert.ok(actual.includes('<code>'), 'Should contain code element');
		assert.ok(actual.includes('some\\_thing'), 'Backslash inside code should be preserved');
	});

	it('<br /> from snarkdown is stripped', () => {
		// snarkdown converts single newlines to <br />, normalizeBodyHTMLString strips them
		const actual = markdownToHTML('line one\nline two');
		assert.ok(!actual.includes('<br'), 'Should not contain any <br> variants');
	});
});

//--- Suite 4: normalizeBodyHTML consistency ---

describe('normalizeBodyHTML consistency', () => {
	it('<p>Hello</p> through both produces equivalent results', () => {
		const input = '<p>Hello</p>';
		const fromString = normalizeBodyHTMLString(input);
		const fromDOM = normalizeBodyHTML(input);
		assert.strictEqual(fromString, fromDOM);
	});

	it('<p><b>bold</b></p> through both produces the same <strong> conversion', () => {
		const input = '<p><b>bold</b></p>';
		const fromString = normalizeBodyHTMLString(input);
		const fromDOM = normalizeBodyHTML(input);
		assert.strictEqual(fromString, fromDOM);
	});

	it('<ul><li>a</li><li>b</li></ul> has same line break formatting', () => {
		const input = '<ul><li>a</li><li>b</li></ul>';
		const fromString = normalizeBodyHTMLString(input);
		const fromDOM = normalizeBodyHTML(input);
		assert.strictEqual(fromString, fromDOM);
	});
});
