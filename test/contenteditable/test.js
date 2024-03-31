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
	normalizeBodyHTML,
	importBodiesFromGoogleDocs
} from '../../lib/src/contenteditable.js';

import {
	TESTING
} from '../../lib/src/nlp.js';

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

	it('content with a card-highlight or dir attribute is removed', async () => {
		const input = '<p>Here\'s some <card-highlight>content</card-highlight></p>';
		const actual = normalizeBodyHTML(input);
		const expected = '<p>Here\'s some content</p>\n';
		assert.equal(actual, expected);
	});

	it('content with an alternate top level tag', async () => {
		const input = 'Here\'s some <card-link card="card-id">content</card-link>';
		const actual = normalizeBodyHTML(input, {'blockquote': true});
		const expected = '<blockquote>Here\'s some <card-link card="card-id">content</card-link></blockquote>\n';
		assert.equal(actual, expected);
	});

	it('content with an alternate top level tag is hoisted up', async () => {
		const input = '<p>Here\'s some <card-link card="card-id">content</card-link></p>';
		const actual = normalizeBodyHTML(input, {'blockquote': true});
		const expected = '<blockquote><p>Here\'s some <card-link card="card-id">content</card-link></p></blockquote>\n';
		assert.equal(actual, expected);
	});

	it('content with extra empty second-level items are normalized away', async () => {
		const input = '<blockquote><p>Blammo</p><p></p></blockquote>';
		const actual = normalizeBodyHTML(input, {'blockquote': true});
		const expected = '<blockquote><p>Blammo</p></blockquote>\n';
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

	it('replacements inside of existing card-highlights are not done', () => {
		const input = '<p>Before and <card-highlight card="c-345">and foo bar</card-highlight> and after</p>';
		const actual = TESTING.highlightStringInHTML(input, 'foo bar', 'c-123');
		const expected = '<p>Before and <card-highlight card="c-345">and foo bar</card-highlight> and after</p>';
		assert.strictEqual(actual, expected);
	});

	it('replacements inside of existing card-links are rendered but inactive', () => {
		const input = '<p>Before and <card-link card="c-345">and foo bar</card-link> and after</p>';
		const actual = TESTING.highlightStringInHTML(input, 'foo bar', 'c-123');
		const expected = '<p>Before and <card-link card="c-345">and <card-highlight disabled="" card="c-123">foo bar</card-highlight></card-link> and after</p>';
		assert.strictEqual(actual, expected);
	});

	it('replacements inside of existing a\'s are done', () => {
		const input = '<p>Before and <a href="c-345">and foo bar</a> and after</p>';
		const actual = TESTING.highlightStringInHTML(input, 'foo bar', 'c-123');
		const expected = '<p>Before and <a href="c-345">and <card-highlight card="c-123">foo bar</card-highlight></a> and after</p>';
		assert.strictEqual(actual, expected);
	});

	it('Single word replacement that\'s a part of the target word is not replaced', () => {
		const input = '<p>food</p>';
		const actual = TESTING.highlightStringInHTML(input, 'foo', 'c-123');
		const expected = '<p>food</p>';
		assert.strictEqual(actual, expected);
	});

	it('Single word replacement that\'s a middle part of the target word is not replaced', () => {
		const input = '<p>sfood</p>';
		const actual = TESTING.highlightStringInHTML(input, 'foo', 'c-123');
		const expected = '<p>sfood</p>';
		assert.strictEqual(actual, expected);
	});

	it('Single word replacement that\'s a end part of the target word is not replaced', () => {
		const input = '<p>sfoo</p>';
		const actual = TESTING.highlightStringInHTML(input, 'foo', 'c-123');
		const expected = '<p>sfoo</p>';
		assert.strictEqual(actual, expected);
	});

	//The following are bonus things 
	//Test that if a word is bolded in the middle of a multi-word test string it works (that is, if the card highlight would fully contain other text nodes)
});


describe('google doc bulk import', () => {
	//Content from first two bites of https://komoroske.com/bits-and-bobs 3/25/24
	it('Basic test', () => {
		// eslint-disable-next-line quotes
		const input = `<meta charset='utf-8'><meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-9f09e1e4-7fff-3ccb-7775-98ead583a06f"><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">I&rsquo;m 60 hours into being &ldquo;</span><a href="https://www.linkedin.com/feed/update/urn:li:activity:7177014641850548224/" style="text-decoration:none;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#1155cc;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:underline;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">unemployed</span></a><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">&rdquo; as I write this.</span></p></li><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">What&rsquo;s the biggest thing I&rsquo;ve noticed so far?</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">The </span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:italic;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">quiet </span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">that comes from being disconnected from Slack.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Slack is a background cacophony, a constant reminder that there are things happening all around you in your organization.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">At its best, it&rsquo;s the kind of hustle and bustle background sound of a thriving city.</span></p></li><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:square;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="3"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">A kind of pleasant sound of things happening.</span></p></li></ul><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">But more often, it&rsquo;s just the mosquito buzz of the urgent, never leaving your ear, making you anxious at all times, telling you to stop thinking about the important, and to focus only on the urgent.</span></p></li><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:square;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="3"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">In large organizations, this can become a background roar.</span></p></li></ul><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">The other thing I&rsquo;ve noticed: for all of the crap LinkedIn gets as a &ldquo;social network&rdquo;, the professional positivity when you announce a big life change really does feel great.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">I feel like I&rsquo;m at the beginning of my hero journey (before we know if I&rsquo;ll be a hero or die trying), setting off into the intimidating forest.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Everyone I&rsquo;ve ever interacted with back in the village is cheering me on, buoying my spirits as I tackle something terrifying and novel.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Seeing all of the faces of people I&rsquo;ve interacted with over the years and knowing they&rsquo;re cheering me on… that feels great.</span></p></li></ul><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Customizability and centralization are in tension.</span></p></li><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">The things that make something customizable make it hard to handle in a scaled / levered fashion.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Centralization creates so much efficiency that as a user or maker you have to exert more effort to stand out from the gravity well of the cheap way everyone else is doing it.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Since centralization wins against customizability in each little micro paper cut decision, it keeps on compounding.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Before you know it, you get one-size-fits-all software for everyone all the time.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">This happens even if people still want customizability.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">The logic of aggregation simply gets so much momentum that it steamrolls everything else.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">A net loss of value for the ecosystem.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:10pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Where's the hyper-customizable software for power users?</span></p></li></ul></ul></b>`;
		const actual = importBodiesFromGoogleDocs(input);
		const expected = [
			`<ul>
			<li><p>I’m 60 hours into being “<card-link href="https://www.linkedin.com/feed/update/urn:li:activity:7177014641850548224/">unemployed</card-link>” as I write this.</p>
		</li>
		<ul>
			<li><p>What’s the biggest thing I’ve noticed so far?</p>
		</li>
			<li><p>The quiet that comes from being disconnected from Slack.</p>
		</li>
			<li><p>Slack is a background cacophony, a constant reminder that there are things happening all around you in your organization.</p>
		</li>
			<li><p>At its best, it’s the kind of hustle and bustle background sound of a thriving city.</p>
		</li>
		<ul>
			<li><p>A kind of pleasant sound of things happening.</p>
		</li>
		</ul>
			<li><p>But more often, it’s just the mosquito buzz of the urgent, never leaving your ear, making you anxious at all times, telling you to stop thinking about the important, and to focus only on the urgent.</p>
		</li>
		<ul>
			<li><p>In large organizations, this can become a background roar.</p>
		</li>
		</ul>
			<li><p>The other thing I’ve noticed: for all of the crap LinkedIn gets as a “social network”, the professional positivity when you announce a big life change really does feel great.</p>
		</li>
			<li><p>I feel like I’m at the beginning of my hero journey (before we know if I’ll be a hero or die trying), setting off into the intimidating forest.</p>
		</li>
			<li><p>Everyone I’ve ever interacted with back in the village is cheering me on, buoying my spirits as I tackle something terrifying and novel.</p>
		</li>
			<li><p>Seeing all of the faces of people I’ve interacted with over the years and knowing they’re cheering me on… that feels great.</p>
		</li>
		</ul>
		</ul>
		`,
			`<ul>
		<li><p>Customizability and centralization are in tension.</p>
	</li>
	<ul>
		<li><p>The things that make something customizable make it hard to handle in a scaled / levered fashion.</p>
	</li>
		<li><p>Centralization creates so much efficiency that as a user or maker you have to exert more effort to stand out from the gravity well of the cheap way everyone else is doing it.</p>
	</li>
		<li><p>Since centralization wins against customizability in each little micro paper cut decision, it keeps on compounding.</p>
	</li>
		<li><p>Before you know it, you get one-size-fits-all software for everyone all the time.</p>
	</li>
		<li><p>This happens even if people still want customizability.</p>
	</li>
		<li><p>The logic of aggregation simply gets so much momentum that it steamrolls everything else.</p>
	</li>
		<li><p>A net loss of value for the ecosystem.</p>
	</li>
		<li><p>Where's the hyper-customizable software for power users?</p>
	</li>
	</ul>
	</ul>
	`
		];
		//Strip out newlines and tabs for easier comparison
		const strippedActual = actual.map(str => str.split('\n').join('').split('\t').join(''));
		const strippedExpected = expected.map(str => str.split('\n').join('').split('\t').join(''));
		assert.deepStrictEqual(strippedActual, strippedExpected);
	});

});