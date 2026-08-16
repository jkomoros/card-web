/*eslint-env node*/

import {
	JSDOM
} from 'jsdom';

import {
	overrideDocument
} from '../../lib/src/document.js';

//shared/ has its OWN document module with its own state. Overriding only src/
//left shared's getDocument() returning null, so any shared/ helper under test
//took its no-document branch — a regex approximation — while the browser takes
//the DOM branch. innerTextForHTML's two paths disagree on inputs that matter
//(entities like &thinsp; and &Tab; decode on one and not the other), so a test
//could be green for the wrong reason (#733).
import {
	overrideDocument as overrideSharedDocument
} from '../../lib/shared/document.js';

import {
	getDocument as getSharedDocument
} from '../../lib/shared/document.js';

const dom = new JSDOM('');

overrideDocument(dom.window.document);
overrideSharedDocument(dom.window.document);

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

//Content from first two bites of https://komoroske.com/bits-and-bobs 3/25/24
// eslint-disable-next-line quotes
const BIG_GOOGLE_DOC_INPUT = `<meta charset='utf-8'><meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-9f09e1e4-7fff-3ccb-7775-98ead583a06f"><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">I&rsquo;m 60 hours into being &ldquo;</span><a href="https://www.linkedin.com/feed/update/urn:li:activity:7177014641850548224/" style="text-decoration:none;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#1155cc;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:underline;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">unemployed</span></a><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">&rdquo; as I write this.</span></p></li><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">What&rsquo;s the biggest thing I&rsquo;ve noticed so far?</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">The </span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:italic;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">quiet </span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">that comes from being disconnected from Slack.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Slack is a background cacophony, a constant reminder that there are things happening all around you in your organization.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">At its best, it&rsquo;s the kind of hustle and bustle background sound of a thriving city.</span></p></li><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:square;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="3"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">A kind of pleasant sound of things happening.</span></p></li></ul><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">But more often, it&rsquo;s just the mosquito buzz of the urgent, never leaving your ear, making you anxious at all times, telling you to stop thinking about the important, and to focus only on the urgent.</span></p></li><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:square;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="3"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">In large organizations, this can become a background roar.</span></p></li></ul><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">The other thing I&rsquo;ve noticed: for all of the crap LinkedIn gets as a &ldquo;social network&rdquo;, the professional positivity when you announce a big life change really does feel great.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">I feel like I&rsquo;m at the beginning of my hero journey (before we know if I&rsquo;ll be a hero or die trying), setting off into the intimidating forest.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Everyone I&rsquo;ve ever interacted with back in the village is cheering me on, buoying my spirits as I tackle something terrifying and novel.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Seeing all of the faces of people I&rsquo;ve interacted with over the years and knowing they&rsquo;re cheering me on… that feels great.</span></p></li></ul><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Customizability and centralization are in tension.</span></p></li><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">The things that make something customizable make it hard to handle in a scaled / levered fashion.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Centralization creates so much efficiency that as a user or maker you have to exert more effort to stand out from the gravity well of the cheap way everyone else is doing it.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Since centralization wins against customizability in each little micro paper cut decision, it keeps on compounding.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Before you know it, you get one-size-fits-all software for everyone all the time.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">This happens even if people still want customizability.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">The logic of aggregation simply gets so much momentum that it steamrolls everything else.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">A net loss of value for the ecosystem.</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:10pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Where's the hyper-customizable software for power users?</span></p></li></ul></ul></b>`;

//#733: this file overrode src/'s document but not shared/'s — a separate
//module with separate state — so any shared/ helper under test took its
//no-document fallback while the browser takes the DOM path.
//
//The audit rule is NOT "every suite touching shared/ must override it". It is
//MATCH THE THREAD YOU ARE MODELLING. test/query-engine and
//test/subscription-manager deliberately leave shared's document null, because
//nothing under src/worker/ ever calls overrideDocument and the worker really
//does run without a DOM — 154 measured fallback calls there are fidelity, not
//a bug. "Fixing" those two would make them lie about the worker.
describe('the harness exercises the same document path the browser does', () => {
	it('has overridden shared/document, not just src/document', () => {
		//Asserted DIRECTLY rather than via observable behaviour. An earlier
		//version of this test proved the point by decoding &thinsp; / &Tab;,
		//which the DOM path handles and the regex fallback leaves literal. That
		//worked only because those entities are absent from NAMED_ENTITIES
		//(shared/util.ts) — a table whose stated purpose is DOM parity and which
		//has been growing steadily toward it. Adding six entries to it makes the
		//behavioural proxy pass with the override removed; the invariant itself
		//cannot rot that way.
		assert.notStrictEqual(getSharedDocument(), null,
			'shared/document must be overridden too, or shared/ helpers silently take their no-document fallback');
	});

	//The style/script fix is in normalizeBodyHTML, which runs on EVERY card
	//save — not just bulk import. Asserting it only through
	//importBodiesFromGoogleDocs would test one call site of a shared change.
	//
	//This is not merely cosmetic: dompurify (card-renderer, at render) strips a
	//TOP-LEVEL <style> but NOT one nested inside a <p>, and the renderer assigns
	//the result to innerHTML inside a lit shadow root. So a nested <style> in a
	//card body was injecting live CSS into that card's shadow root. Measured
	//with the renderer's exact dompurify config.
	it('strips style and script from a body, not just from imported bullets', () => {
		assert.strictEqual(normalizeBodyHTML('<p>before<style>.k{color:red}</style>after</p>'), '<p>beforeafter</p>\n');
		assert.strictEqual(normalizeBodyHTML('<p>a<script>x()</script>b</p>'), '<p>ab</p>\n');
		//The nested case dompurify misses.
		assert.ok(!normalizeBodyHTML('<p><style>body{display:none}</style></p>').includes('<style'),
			'a nested style element must not survive into a card body');
	});

	it('drops an element whose entire content is a style element', () => {
		assert.strictEqual(normalizeBodyHTML('<p><style>.k{color:red}</style></p>'), '');
	});
});

describe('google doc bulk import', () => {
	
	it('Basic bulleted test', () => {
		
		const input = BIG_GOOGLE_DOC_INPUT;
		const actual = importBodiesFromGoogleDocs(input, 'bulleted');
		const expected = [
			`<ul>
			<li><p>I’m 60 hours into being “<card-link href="https://www.linkedin.com/feed/update/urn:li:activity:7177014641850548224/">unemployed</card-link>” as I write this.</p>
		</li>
		<ul>
			<li><p>What’s the biggest thing I’ve noticed so far?</p>
		</li>
			<li><p>The <em>quiet </em>that comes from being disconnected from Slack.</p>
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

	it('Basic flat test', () => {
		
		const input = BIG_GOOGLE_DOC_INPUT;
		const actual = importBodiesFromGoogleDocs(input, 'flat');
		const expected = [
			`<p>I’m 60 hours into being “<card-link href="https://www.linkedin.com/feed/update/urn:li:activity:7177014641850548224/">unemployed</card-link>” as I write this.</p>
			<p>What’s the biggest thing I’ve noticed so far?</p>
			<p>The <em>quiet </em>that comes from being disconnected from Slack.</p>
			<p>Slack is a background cacophony, a constant reminder that there are things happening all around you in your organization.</p>
			<p>At its best, it’s the kind of hustle and bustle background sound of a thriving city.</p>
			<p>A kind of pleasant sound of things happening.</p>
			<p>But more often, it’s just the mosquito buzz of the urgent, never leaving your ear, making you anxious at all times, telling you to stop thinking about the important, and to focus only on the urgent.</p>
			<p>In large organizations, this can become a background roar.</p>
			<p>The other thing I’ve noticed: for all of the crap LinkedIn gets as a “social network”, the professional positivity when you announce a big life change really does feel great.</p>
			<p>I feel like I’m at the beginning of my hero journey (before we know if I’ll be a hero or die trying), setting off into the intimidating forest.</p>
			<p>Everyone I’ve ever interacted with back in the village is cheering me on, buoying my spirits as I tackle something terrifying and novel.</p>
			<p>Seeing all of the faces of people I’ve interacted with over the years and knowing they’re cheering me on… that feels great.</p>
		`,
			`<p>Customizability and centralization are in tension.</p>
			<p>The things that make something customizable make it hard to handle in a scaled / levered fashion.</p>
			<p>Centralization creates so much efficiency that as a user or maker you have to exert more effort to stand out from the gravity well of the cheap way everyone else is doing it.</p>
			<p>Since centralization wins against customizability in each little micro paper cut decision, it keeps on compounding.</p>
			<p>Before you know it, you get one-size-fits-all software for everyone all the time.</p>
			<p>This happens even if people still want customizability.</p>
			<p>The logic of aggregation simply gets so much momentum that it steamrolls everything else.</p>
			<p>A net loss of value for the ecosystem.</p>
			<p>Where's the hyper-customizable software for power users?</p>
`
		];
		//Strip out newlines and tabs for easier comparison
		const strippedActual = actual.map(str => str.split('\n').join('').split('\t').join(''));
		const strippedExpected = expected.map(str => str.split('\n').join('').split('\t').join(''));
		assert.deepStrictEqual(strippedActual, strippedExpected);
	});

	//A blank bullet is its own top-level run, so without a filter it became an
	//empty card AND consumed one of the 200-card import budget.
	// eslint-disable-next-line quotes
	const BLANK_LINE_INPUT = `<meta charset="utf-8"><ul><li dir="ltr" aria-level="1"><p dir="ltr" role="presentation"><span>First real line.</span></p></li><li dir="ltr" aria-level="1"><p dir="ltr" role="presentation"><span></span></p></li><li dir="ltr" aria-level="1"><p dir="ltr" role="presentation"><span>&nbsp;</span></p></li><li dir="ltr" aria-level="1"><p dir="ltr" role="presentation"><span>Second real line.</span></p></li></ul>`;

	it('skips blank and whitespace-only lines', () => {
		const actual = importBodiesFromGoogleDocs(BLANK_LINE_INPUT, 'flat');
		assert.strictEqual(actual.length, 2, 'the empty and &nbsp;-only bullets should not become cards');
		const stripped = actual.map(str => str.split('\n').join('').split('\t').join('').trim());
		assert.deepStrictEqual(stripped, ['<p>First real line.</p>', '<p>Second real line.</p>']);
	});

	it('skips blank lines in bulleted mode too', () => {
		const actual = importBodiesFromGoogleDocs(BLANK_LINE_INPUT, 'bulleted');
		assert.strictEqual(actual.length, 2, 'the empty and &nbsp;-only bullets should not become cards');
		//Assert WHICH two survived: a length check alone would pass if the
		//filter dropped the wrong two bullets.
		assert.ok(actual[0].includes('First real line.'), 'first surviving body should be the first real line');
		assert.ok(actual[1].includes('Second real line.'), 'second surviving body should be the second real line');
	});

	//NOTE: this one passes WITHOUT the filter too — it is a regression guard,
	//not a demonstration of the fix. It pins the choice of predicate: the
	//filter tests the FINAL body rather than the run's first <li>, because in
	//bulleted mode a run is a top-level <li> plus its nested <ul>, so a blank
	//PARENT bullet whose children carry the content is non-empty and must
	//survive. An implementation that filtered on the first <li> would fail
	//here.
	// eslint-disable-next-line quotes
	const BLANK_PARENT_INPUT = `<meta charset="utf-8"><ul><li dir="ltr" aria-level="1"><p dir="ltr" role="presentation"><span></span></p></li><ul><li dir="ltr" aria-level="2"><p dir="ltr" role="presentation"><span>Real nested content.</span></p></li></ul></ul>`;

	it('keeps a blank parent bullet that has real nested children', () => {
		const actual = importBodiesFromGoogleDocs(BLANK_PARENT_INPUT, 'bulleted');
		assert.strictEqual(actual.length, 1, 'the run carries real nested text, so it is not empty');
		assert.ok(actual[0].includes('Real nested content.'));
	});

	//#734: two shapes still became junk cards after the blank-line fix.
	//Both are fixed UPSTREAM, in normalization, rather than by widening the
	//bulk-import predicate — because at the call site the body is
	//`<p>{zero-width}</p>`, non-empty markup, so recognising it as blank would
	//mean testing TEXT content, which is exactly the predicate rejected in #730
	//for silently deleting text-less-but-real content. Making the body actually
	//empty keeps the safe predicate.
	// eslint-disable-next-line quotes
	const ZERO_WIDTH_INPUT = `<meta charset="utf-8"><ul><li dir="ltr" aria-level="1"><p dir="ltr" role="presentation"><span>Real.</span></p></li><li dir="ltr" aria-level="1"><p dir="ltr" role="presentation"><span>\u200b</span></p></li></ul>`;
	// eslint-disable-next-line quotes
	const STYLE_INPUT = `<meta charset="utf-8"><ul><li dir="ltr" aria-level="1"><p dir="ltr" role="presentation"><span>Real.</span></p></li><li dir="ltr" aria-level="1"><p dir="ltr" role="presentation"><style type="text/css">.lst-kix{list-style:none}</style></p></li></ul>`;

	it('skips a bullet whose only content is a zero-width character', () => {
		const actual = importBodiesFromGoogleDocs(ZERO_WIDTH_INPUT, 'flat');
		assert.strictEqual(actual.length, 1, 'a zero-width-only bullet is not a card');
		assert.ok(actual[0].includes('Real.'));
	});

	it('skips a bullet whose only content is a style element', () => {
		const actual = importBodiesFromGoogleDocs(STYLE_INPUT, 'flat');
		assert.strictEqual(actual.length, 1, 'a card body must never be raw CSS');
		assert.ok(!actual[0].includes('lst-kix'), 'the CSS must not survive into any body');
	});

	//NOTE: passes without the fix too — a regression guard, not a demonstration.
	//The other half of the zero-width fix: these characters are a legitimate
	//line-break opportunity INSIDE a word, and must not be stripped there.
	it('keeps a zero-width character that sits inside real text', () => {
		const normalized = normalizeBodyHTML('<p>wide\u200bword</p>');
		assert.ok(normalized.includes('\u200b'), 'a zero-width space inside a word is deliberate and must survive');
		assert.ok(normalized.includes('wide') && normalized.includes('word'));
	});

	//The blank class deliberately EXCLUDES U+200C (ZWNJ) and U+200D (ZWJ).
	//They look like peers of the zero-width space and are not: ZWJ binds emoji
	//sequences, and ZWNJ is semantically load-bearing in Persian, Arabic and
	//Devanagari.
	//
	//The joiner must be its OWN TEXT NODE for this to bite — inside a text node
	//with the emoji it is never blank, so a naive test of that shape passes
	//either way and proves nothing. Measured: with the joiners included in the
	//class, this input normalizes to two adjacent emoji with the joiner gone,
	//i.e. a silently broken sequence.
	it('preserves a joiner that is its own text node between elements', () => {
		const ZWJ = '\u200d';
		const split = '<p><strong>\u{1f468}</strong>' + ZWJ + '<strong>\u{1f469}</strong></p>';
		const normalized = normalizeBodyHTML(split);
		assert.ok(normalized.includes(ZWJ),
			'a lone ZWJ between elements binds an emoji sequence and must not be dropped as blank');
	});

	it('preserves a lone zero-width non-joiner too', () => {
		const ZWNJ = '\u200c';
		const split = '<p><strong>\u0645\u06cc</strong>' + ZWNJ + '<strong>\u062e\u0648\u0627\u0647\u0645</strong></p>';
		assert.ok(normalizeBodyHTML(split).includes(ZWNJ),
			'ZWNJ is meaningful in Persian and must not be dropped as blank');
	});

});