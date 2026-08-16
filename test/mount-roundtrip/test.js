/*eslint-env node*/

import {
	JSDOM
} from 'jsdom';

import {
	overrideDocument
} from '../../lib/src/document.js';

//shared/ has its own document module with its own state; overriding only src/
//leaves shared's getDocument() null, so shared/ helpers under test take their
//no-document fallback branch rather than the DOM path the browser runs (#733).
import {
	overrideDocument as overrideSharedDocument
} from '../../lib/shared/document.js';

const dom = new JSDOM('');

overrideDocument(dom.window.document);
overrideSharedDocument(dom.window.document);

import assert from 'assert';
import snarkdown from 'snarkdown';
import TurndownService from 'turndown';

import {
	normalizeBodyHTMLString,
	replaceAnchorsWithCardLinks
} from '../../lib/shared/util.js';

//--- Replicated from tools/mount.ts (not exported) ---

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
	result = result.replace(/<code>[\s\S]*?<\/code>|\\([\\*_`~[\]#>+\-.=])/g,
		(match, escaped) => escaped !== undefined ? escaped : match
	);

	// Step 4: Convert <a href> to canonical <card-link> (shared)
	result = replaceAnchorsWithCardLinks(result);

	// Step 5: Canonical normalization (shared)
	result = normalizeBodyHTMLString(result);

	return result;
};

const createTurndownService = () => {
	const td = new TurndownService({
		headingStyle: 'atx',
		codeBlockStyle: 'fenced',
		emDelimiter: '*',
	});

	//Custom rule for <card-link> elements
	td.addRule('cardLink', {
		filter: (node) => {
			return node.nodeName === 'CARD-LINK';
		},
		replacement: (content, node) => {
			const el = node;
			const cardId = el.getAttribute('card') || '';
			const href = el.getAttribute('href') || '';
			const text = el.textContent || '';

			if (href) {
				//External link -- escape parens in URL to avoid breaking markdown
				const safeHref = href.replace(/\(/g, '%28').replace(/\)/g, '%29');
				return `[${text}](${safeHref})`;
			}

			if (cardId) {
				//Internal card link - use card ID directly for round-trip fidelity
				//Use content (turndown-processed markdown) to preserve inner formatting
				const displayText = content || text;
				if (text === cardId || text === '') {
					return `[[${cardId}]]`;
				}
				return `[[${cardId}|${displayText}]]`;
			}

			return content || text;
		}
	});

	return td;
};

//--- Test helpers ---

const td = createTurndownService();

const roundTrip = (html) => {
	const markdown = td.turndown(html);
	return markdownToHTML(markdown);
};

//--- Tests ---

describe('HTML to Markdown to HTML round-trip', () => {

	it('Simple paragraph', () => {
		const input = '<p>Hello world</p>\n';
		const actual = roundTrip(input);
		assert.strictEqual(actual, input);
	});

	it('Bold text', () => {
		const input = '<p>Some <strong>bold</strong> text</p>\n';
		const actual = roundTrip(input);
		assert.strictEqual(actual, input);
	});

	it('Italic text', () => {
		const input = '<p>Some <em>italic</em> text</p>\n';
		const actual = roundTrip(input);
		assert.strictEqual(actual, input);
	});

	it('External link', () => {
		const input = '<p>Click <card-link href="https://example.com">here</card-link></p>\n';
		const actual = roundTrip(input);
		assert.strictEqual(actual, input);
	});

	it('Internal card link', () => {
		const input = '<p>See <card-link card="my-card-id">this card</card-link></p>\n';
		const actual = roundTrip(input);
		assert.strictEqual(actual, input);
	});

	it('Internal card link where text matches ID', () => {
		const input = '<p>See <card-link card="my-card-id">my-card-id</card-link></p>\n';
		const actual = roundTrip(input);
		assert.strictEqual(actual, input);
	});

	it('Unordered list', () => {
		const input = '<ul>\n\t<li>Item one</li>\n\t<li>Item two</li>\n</ul>\n';
		const actual = roundTrip(input);
		assert.strictEqual(actual, input);
	});

	it('Ordered list', () => {
		const input = '<ol>\n\t<li>First</li>\n\t<li>Second</li>\n</ol>\n';
		const actual = roundTrip(input);
		assert.strictEqual(actual, input);
	});

	it('Multiple paragraphs', () => {
		const input = '<p>First paragraph</p>\n<p>Second paragraph</p>\n';
		const actual = roundTrip(input);
		assert.strictEqual(actual, input);
	});

	it('Mixed formatting', () => {
		const input = '<p>Here is <strong>bold</strong> and <em>italic</em> text</p>\n';
		const actual = roundTrip(input);
		assert.strictEqual(actual, input);
	});

	it('Heading', () => {
		const input = '<h2>My Heading</h2>\n';
		const actual = roundTrip(input);
		assert.strictEqual(actual, input);
	});

	it('Blockquote', () => {
		const input = '<blockquote>A quote</blockquote>\n';
		const actual = roundTrip(input);
		assert.strictEqual(actual, input);
	});

	it('Paragraph with card link and regular text', () => {
		const input = '<p>Before <card-link card="abc-123">link text</card-link> after</p>\n';
		const actual = roundTrip(input);
		assert.strictEqual(actual, input);
	});

	it('URL with parentheses', () => {
		const input = '<p><card-link href="https://en.wikipedia.org/wiki/Test_(assessment)">Test</card-link></p>\n';
		// Turndown escapes parens to %28/%29, and those survive the round-trip
		const expected = '<p><card-link href="https://en.wikipedia.org/wiki/Test_%28assessment%29">Test</card-link></p>\n';
		const actual = roundTrip(input);
		assert.strictEqual(actual, expected);
	});

});

describe('Turndown specific edge cases', () => {

	it('Formatted text inside card-link is preserved in markdown', () => {
		const html = '<card-link card="x"><em>formatted</em></card-link>';
		const markdown = td.turndown(html);
		// The card-link rule uses content (turndown-processed) which preserves inner formatting
		assert.ok(markdown.includes('*formatted*'), `Expected markdown to contain *formatted*, got: ${markdown}`);
	});

	it('External card-link produces standard markdown link', () => {
		const html = '<card-link href="https://example.com">text</card-link>';
		const markdown = td.turndown(html);
		assert.strictEqual(markdown, '[text](https://example.com)');
	});

});
