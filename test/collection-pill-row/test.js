/*eslint-env node, es2022*/

//THE PILL ROW, the one-line editor that replaces the anchored editor panels.
//
//Behavioral, over the real registered component. What is worth pinning is what
//the design promises about the three verbs:
//
//  - Flip prefers the app's own INVERSE WORD. `published` must become
//    `unpublished` and not `exclude/published`, and the row must say which of
//    those two the user is about to get before they press it.
//  - Remove on one alternative DISSOLVES the group it leaves behind with a
//    single member, because the sentence must never draw a group container
//    around one pill.
//  - The widening verb is a request, not an edit: this row knows which token an
//    alternative would join and not what the alternative is. It is LABELLED
//    'Also match…' (owner, F1): 'Or…' was the URL's operator with an ellipsis
//    after it, and the phrase that replaces it is the one the scoped input it
//    opens already uses.
//  - And all three read as BUTTONS (owner, F1: they "don't read as buttons and
//    are kind of confusing"), which here means the composer's outlined
//    transform-chip treatment rather than purple link text.
//
//And the counts are properties. A row that invented one would be making a
//promise about a collection nobody computed.

import { JSDOM } from 'jsdom';
import assert from 'assert';

const dom = new JSDOM('', { url: 'https://example.com/c/main/' });
for (const name of [
	'window', 'document', 'Document', 'HTMLElement', 'Element', 'Node',
	'customElements', 'CSSStyleSheet', 'Event', 'CustomEvent', 'MouseEvent',
	'KeyboardEvent', 'ShadowRoot', 'DocumentFragment', 'HTMLInputElement',
	'HTMLSelectElement', 'HTMLButtonElement', 'HTMLAnchorElement',
	'navigator', 'getComputedStyle', 'MutationObserver', 'requestAnimationFrame',
]) globalThis[name] = name === 'window' ? dom.window : name === 'document' ? dom.window.document : dom.window[name];

const { OR_VERB_LABEL } = await import('../../lib/src/components/collection-pill-row.js');
const { serializeCollectionExpression } = await import('../../lib/src/collection-expression.js');

const filter = (name) => ({ kind: 'filter', filter: name });

const mount = async (properties) => {
	const element = document.createElement('collection-pill-row');
	Object.assign(element, { expression: [], index: -1, memberIndex: -1, ...properties });
	document.body.appendChild(element);
	for (let round = 0; round < 3; round++) await element.updateComplete;
	return element;
};

const verb = (element, label) => Array.from(element.shadowRoot.querySelectorAll('button.verb'))
	.find(button => button.textContent.trim() === label);

const rowText = (element) => element.shadowRoot.querySelector('.row').textContent.replace(/\s+/g, ' ').trim();

//The one thing a host is handed when a verb is pressed: the whole next tree.
const nextExpression = async (element, label) => {
	let result = null;
	element.addEventListener('expression-modified', (e) => { result = e.detail.expression; });
	verb(element, label).click();
	await element.updateComplete;
	return result;
};

describe('the pill row', () => {

	describe('flip', () => {

		//NEGATION IS LANGUAGE, and the app already owns the words. Flipping
		//`published` must produce the FILTER `unpublished`, not a not-node that
		//would compile to exclude/published — the composer would otherwise be
		//able to re-spell one into the other and call it an edit.
		it('prefers the app\'s own inverse word over an operator', async () => {
			const element = await mount({ expression: [filter('published')], index: 0 });

			const next = await nextExpression(element, 'Flip');

			assert.deepStrictEqual(next, [filter('unpublished')]);
			assert.deepStrictEqual(serializeCollectionExpression(next), ['unpublished'],
				'and it compiles to the word, never to exclude/');
		});

		it('promises which word the pill will read, before it is pressed', async () => {
			const element = await mount({ expression: [filter('published')], index: 0 });
			assert.match(verb(element, 'Flip').getAttribute('title'), /Unpublished/,
				'the user is told what they are about to get');
			assert.ok(!/outlined/.test(verb(element, 'Flip').getAttribute('title')),
				'a named inverse is a plain word on a plain pill');
		});

		it('says so differently when there is no word and the pill will be outlined', async () => {
			const element = await mount({ expression: [filter('tag-3')], index: 0 });
			assert.match(verb(element, 'Flip').getAttribute('title'), /outlined pill/);
		});

		it('flips one alternative inside a group without touching the others', async () => {
			const element = await mount({
				expression: [{ kind: 'or', members: [filter('published'), filter('tag-3')] }],
				index: 0,
				memberIndex: 0,
			});

			const next = await nextExpression(element, 'Flip');

			assert.deepStrictEqual(next, [{ kind: 'or', members: [filter('unpublished'), filter('tag-3')] }]);
		});

		it('is an involution: pressing it twice is the identity', async () => {
			const element = await mount({ expression: [filter('tag-3')], index: 0 });
			const once = await nextExpression(element, 'Flip');
			element.expression = once;
			await element.updateComplete;
			const twice = await nextExpression(element, 'Flip');
			assert.deepStrictEqual(twice, [filter('tag-3')]);
		});
	});

	describe('remove', () => {

		it('removes a whole condition', async () => {
			const element = await mount({ expression: [filter('tag-3'), filter('starred')], index: 0 });

			const next = await nextExpression(element, 'Remove');

			assert.deepStrictEqual(next, [filter('starred')]);
		});

		//A one-member OR is just the member. The sentence must never draw a
		//group container around a single pill, and the rule lives in the draft
		//layer so every surface gets it for free.
		it('dissolves the group when one of two alternatives goes', async () => {
			const element = await mount({
				expression: [{ kind: 'or', members: [filter('tag-3'), filter('tag-7')] }],
				index: 0,
				memberIndex: 1,
			});

			const next = await nextExpression(element, 'Remove');

			assert.deepStrictEqual(next, [filter('tag-3')]);
			assert.deepStrictEqual(serializeCollectionExpression(next), ['tag-3'],
				'and it compiles as a plain clause, with no leftover union');
		});

		it('keeps the group when three alternatives become two', async () => {
			const element = await mount({
				expression: [{ kind: 'or', members: [filter('a'), filter('b'), filter('c')] }],
				index: 0,
				memberIndex: 1,
			});

			const next = await nextExpression(element, 'Remove');

			assert.deepStrictEqual(next, [{ kind: 'or', members: [filter('a'), filter('c')] }]);
		});
	});

	describe('or…', () => {

		it('asks the host rather than editing anything', async () => {
			const element = await mount({
				expression: [{ kind: 'or', members: [filter('tag-3'), filter('tag-7')] }],
				index: 0,
				memberIndex: 1,
			});
			let requested = null;
			let edited = 0;
			element.addEventListener('pill-or-requested', (e) => { requested = e.detail; });
			element.addEventListener('expression-modified', () => { edited++; });

			verb(element, OR_VERB_LABEL).click();

			assert.deepStrictEqual(requested, { index: 0, memberIndex: 1 },
				'the row knows which token an alternative would join');
			assert.strictEqual(edited, 0, 'and nothing changed, because it does not know what the alternative is');
		});
	});

	describe('the row itself', () => {

		it('always names its scope', async () => {
			const condition = await mount({ expression: [filter('tag-3')], index: 0 });
			assert.match(rowText(condition), /^Tag 3/);

			const member = await mount({
				expression: [{ kind: 'or', members: [filter('tag-3'), filter('tag-7')] }],
				index: 0,
				memberIndex: 1,
			});
			//Clicking a segment and clicking the group's edge open the same row
			//about different things; without this line the difference would be
			//an invisible spatial rule.
			assert.match(rowText(member), /Tag 7 one alternative in Tag 3 or Tag 7/);
		});

		it('names the whole group when the scope is the group\'s edge', async () => {
			const element = await mount({
				expression: [{ kind: 'or', members: [filter('tag-3'), filter('tag-7')] }],
				index: 0,
			});
			assert.match(rowText(element), /^Tag 3 or Tag 7/);
			assert.ok(!/one alternative/.test(rowText(element)));
		});

		it('offers all three verbs on every pill, so a dead affordance is impossible', async () => {
			const element = await mount({ expression: [filter('starred')], index: 0 });
			assert.deepStrictEqual(
				Array.from(element.shadowRoot.querySelectorAll('button.verb')).map(button => button.textContent.trim()),
				[OR_VERB_LABEL, 'Flip', 'Remove']);
		});

		//SUPERSEDED PIN (owner, F1). The widening verb used to be pinned as the
		//literal string 'Or…'. The owner: the three verbs "are kind of
		//confusing" — and that one carried most of it, being the URL's `+`
		//operator spelled as a word with nothing after it to say what it wants.
		//What replaces it is not a new concept: it is the exact phrase the
		//or-scoped input's own placeholder already asks the question in.
		it('asks for the widening in the words the scoped input asks it in', async () => {
			assert.strictEqual(OR_VERB_LABEL, 'Also match…');
			const element = await mount({ expression: [filter('starred')], index: 0 });
			assert.ok(verb(element, OR_VERB_LABEL), 'the button wears the label');
			assert.ok(!verb(element, 'Or…'), 'and the operator-with-an-ellipsis is gone');
			assert.match(verb(element, OR_VERB_LABEL).getAttribute('title'),
				/Widen this to also match something else/,
				'with the title still saying what widening means');
		});

		//THE THREE VERBS MUST READ AS PRESSABLE (owner, F1).
		//
		//They were `button.small.verb` with a hover underline: transparent, no
		//boundary, purple — which is this app's LINK treatment, so three of them
		//in a row read as prose rather than as controls. What they take is the
		//treatment the composer already uses for a control that REWRITES THE
		//DRAFT (.suggestion-action[data-consequence='transform']): an outlined
		//chip. Not button.text — §4.2's filled variant is for THE committing
		//action, and these are three peers, none of which commits.
		//
		//JSDOM computes no layout, so what is pinned is the rule.
		it('gives the verbs a visible boundary, so they read as pressable', async () => {
			const element = await mount({ expression: [filter('starred')], index: 0 });
			const styles = element.constructor.styles.map(style => String(style.cssText || style)).join('\n');
			const rule = styles.match(/button\.verb\s*\{[^}]*\}/)[0];
			assert.match(rule, /border:\s*1px solid var\(--app-primary-color\)/,
				'a boundary, from a token — this is what makes it read as a button');
			assert.match(rule, /min-height:\s*44px/, '§4.2 hit target');
			assert.ok(!/border-radius/.test(rule), 'square, per §4.4');
			assert.match(styles, /button\.verb:hover\s*\{[^}]*background:\s*var\(--app-primary-color-light-very-transparent\)/,
				'and the hover is the palette rows own fill, not a link underline');
			assert.ok(!/button\.verb:hover\s*\{[^}]*text-decoration/.test(styles),
				'the link treatment is gone with the confusion it caused');
			//And the group is separated from the argument controls beside it.
			assert.match(styles, /\.verbs\s*\{[^}]*border-left:\s*1px solid var\(--app-divider-color\)/);
			//§4.2 has no outline BUTTON variant, and this does not invent one: it
			//is the same base variant the composer already extends.
			for (const button of element.shadowRoot.querySelectorAll('button.verb')) {
				assert.ok(button.classList.contains('small'),
					'built on button.small, not on a fourth button system');
			}
		});

		it('says nothing about counts until somebody computes them', async () => {
			const element = await mount({ expression: [filter('starred')], index: 0 });
			assert.ok(!/draft now matches/.test(rowText(element)),
				'a number here is a promise about a collection; there is nothing honest to say before it arrives');
			assert.ok(!/without this pill/.test(rowText(element)));

			element.draftCount = 184;
			element.withoutCount = 1842;
			await element.updateComplete;
			assert.match(rowText(element), /draft now matches 184 cards/);
			assert.match(rowText(element), /without this pill: 1842 cards/);
		});

		it('renders nothing at all for an address that names no token', async () => {
			const element = await mount({ expression: [filter('starred')], index: 4 });
			assert.strictEqual(element.shadowRoot.querySelector('.row'), null);
		});

		//SUPERSEDED PIN (owner, F4). This was 'documents the keys the footer
		//teaches, in the module that performs them' — it asserted the four
		//entries of PILL_ROW_KEY_HINTS ('+' adds an or, '-' flips, Enter edits,
		//Delete removes), so that the composer's footer line and the row that
		//performs those keys could not drift apart.
		//
		//The footer line is deleted (owner: "this text … is unnecessary"), and a
		//table that existed only to spell it has no second consumer. The KEYS are
		//untouched and are pinned where they are performed — see the composer's
		//own interaction suite, which presses '+' and '-' and asserts what the
		//draft becomes. What is pinned here is the absence of the table.
		it('publishes no key table, now that nothing renders one', async () => {
			const module = await import('../../lib/src/components/collection-pill-row.js');
			assert.strictEqual(module.PILL_ROW_KEY_HINTS, undefined,
				'the footer that was its only reader is gone');
		});
	});

	describe('argument controls', () => {

		//REPARENTED, NOT REWRITTEN: configure-collection-date already knows how
		//to edit a date boundary, and it already speaks filter-modified-complex.
		it('reparents the existing date control for a date-valued clause', async () => {
			const element = await mount({ expression: [filter('updated/after/2020-01-01')], index: 0 });
			const control = element.shadowRoot.querySelector('configure-collection-date');
			assert.ok(control, 'the clause is edited where it stands');
			assert.strictEqual(control.value, 'after/2020-01-01');
		});

		it('shows no argument controls for a clause that has no arguments', async () => {
			const element = await mount({ expression: [filter('starred')], index: 0 });
			assert.strictEqual(element.shadowRoot.querySelector('configure-collection-date'), null,
				'a pill with nothing to edit simply has no editor region — that is what kills dead Edit buttons');
		});

		it('rebuilds the clause from an argument edit, in place', async () => {
			const element = await mount({ expression: [filter('starred'), filter('updated/after/2020-01-01')], index: 1 });
			let next = null;
			element.addEventListener('expression-modified', (e) => { next = e.detail.expression; });

			element.shadowRoot.querySelector('configure-collection-date')
				.dispatchEvent(new dom.window.CustomEvent('filter-modified-complex', {
					bubbles: true, composed: true, detail: { value: 'after/2021-06-01', index: 0 },
				}));

			assert.deepStrictEqual(next, [filter('starred'), filter('updated/after/2021-06-01')],
				'the clause keeps its place in the sentence and changes what it selects');
		});

		it('keeps a negation across an argument edit', async () => {
			const element = await mount({
				expression: [{ kind: 'not', child: filter('updated/after/2020-01-01') }],
				index: 0,
			});
			let next = null;
			element.addEventListener('expression-modified', (e) => { next = e.detail.expression; });

			element.shadowRoot.querySelector('configure-collection-date')
				.dispatchEvent(new dom.window.CustomEvent('filter-modified-complex', {
					bubbles: true, composed: true, detail: { value: 'after/2021-06-01', index: 0 },
				}));

			assert.deepStrictEqual(next, [{ kind: 'not', child: filter('updated/after/2021-06-01') }],
				'"not updated after X" is still a question about X');
		});

		//THE REST OF THE FAMILY EDITORS MOVED ACROSS TOO. The palette has no
		//anchored panel to fall back to any more, so a clause whose control did
		//not reparent would be a pill with nothing behind it.
		it('reparents the find-dialog card picker for a card-valued clause', async () => {
			const element = await mount({ expression: [filter('children/+abc123')], index: 0 });
			const control = element.shadowRoot.querySelector('configure-collection-key-card');
			assert.ok(control, 'a card value is picked with the app\'s own picker');
			assert.strictEqual(control.value, '+abc123');
		});

		it('reparents the multiple-cards control', async () => {
			const element = await mount({ expression: [filter('cards/abc123')], index: 0 });
			assert.ok(element.shadowRoot.querySelector('configure-collection-multiple-cards'),
				'a multi-card clause edits its own list');
		});

		//A ply is an int and a reference type is a select, and both live on the
		//same clause — so this pins that a multi-argument family gets every one
		//of its controls, addressed by its own sub-index.
		it('offers every argument of a reference clause, ply included', async () => {
			const element = await mount({ expression: [filter('references/+abc123/link/2')], index: 0 });
			assert.ok(element.shadowRoot.querySelector('configure-collection-key-card'), 'the card');
			assert.ok(element.shadowRoot.querySelector('.argument select'), 'the reference type');
			const ply = element.shadowRoot.querySelector('.argument input[type="number"]');
			assert.ok(ply, 'the ply');
			assert.strictEqual(ply.value, '2');
		});

		it('rebuilds the clause from a plain control, at the sub-index it edits', async () => {
			const element = await mount({ expression: [filter('references/+abc123/link/2')], index: 0 });
			let next = null;
			element.addEventListener('expression-modified', (e) => { next = e.detail.expression; });

			const ply = element.shadowRoot.querySelector('.argument input[type="number"]');
			ply.value = '5';
			ply.dispatchEvent(new dom.window.Event('change', { bubbles: true, composed: true }));

			assert.deepStrictEqual(next, [filter('references/+abc123/link/5')],
				'only the argument the control owns changes');
		});

		//The refusal is the point: a manual clause is one this layer said it
		//could not model, and offering a control for it would be a promise the
		//compiler cannot keep.
		it('offers no control for the structural families it models as manual pills', async () => {
			const element = await mount({ expression: [filter('expand/all-cards/children/+abc123')], index: 0 });
			assert.strictEqual(element.shadowRoot.querySelector('.argument'), null,
				'edit-in-source is the honest offer for a clause this layer does not understand');
		});

		it('lands focus in the control the row just opened', async () => {
			const element = await mount({ expression: [filter('limit/10')], index: 0 });
			assert.strictEqual(element.focusPrimaryControl(), true,
				'a caller can fall back rather than leaving focus behind the row it opened');
			assert.strictEqual(element.shadowRoot.activeElement, element.shadowRoot.querySelector('.argument input'));
		});
	});
});
