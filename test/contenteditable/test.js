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
	it('wraps naked top-level content', async () => {
		const input = '<p>Content</p>';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Content</p>\n';
		assert.equal(actual, expected);
	});
});