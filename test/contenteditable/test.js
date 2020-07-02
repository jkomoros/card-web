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

	it('Removes line breaks', async () => {
		const input = '<p>Line breaks <br>Should be removed</p>';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Line breaks Should be removed</p>\n';
		assert.equal(actual, expected);
	});
});