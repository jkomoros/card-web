/*eslint-env node, es2022*/

//THE PILL ROW, the one-line editor that replaces the anchored editor panels.
//
//Behavioral, over the real registered component. What is worth pinning is what
//the design promises about the three actions:
//
//  - Invert prefers the app's own INVERSE WORD. `published` must become
//    `unpublished` and not `exclude/published`, and the row must say which of
//    those two the user is about to get before they press it. The verb is
//    spelled INVERT (owner, F2): 'Flip' named the gesture, and the title under
//    it was already promising the resulting WORD.
//  - Removal on one alternative DISSOLVES the group it leaves behind with a
//    single member, because the sentence must never draw a group container
//    around one pill.
//  - The widening verb is a request, not an edit: this row knows which token an
//    alternative would join and not what the alternative is. It is LABELLED
//    'Also match…' (owner, F1): 'Or…' was the URL's operator with an ellipsis
//    after it, and the phrase that replaces it is the one the scoped input it
//    opens already uses.
//  - The two REWRITING verbs read as BUTTONS (owner, F1: they "don't read as
//    buttons and are kind of confusing"), which here means the composer's
//    outlined transform-chip treatment rather than purple link text. Removal is
//    not one of them: it is the app's ✕ (owner, F1), the same glyph tag-chip and
//    the sentence pill already use, in the same trailing place.
//  - And every label/control pair in the row shares ONE alignment rule (owner,
//    F3), so a label cannot sit at a different height from the control it names.
//
//And the counts are properties. A row that invented one would be making a
//promise about a collection nobody computed.

import { JSDOM } from 'jsdom';
import assert from 'assert';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const dom = new JSDOM('', { url: 'https://example.com/c/main/' });
for (const name of [
	'window', 'document', 'Document', 'HTMLElement', 'Element', 'Node',
	'customElements', 'CSSStyleSheet', 'Event', 'CustomEvent', 'MouseEvent',
	'KeyboardEvent', 'ShadowRoot', 'DocumentFragment', 'HTMLInputElement',
	'HTMLSelectElement', 'HTMLButtonElement', 'HTMLAnchorElement',
	'navigator', 'getComputedStyle', 'MutationObserver', 'requestAnimationFrame',
]) globalThis[name] = name === 'window' ? dom.window : name === 'document' ? dom.window.document : dom.window[name];

const { OR_VERB_LABEL, INVERT_VERB_LABEL } = await import('../../lib/src/components/collection-pill-row.js');
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

//REMOVAL IS NO LONGER FOUND BY ITS WORDS, because it no longer has any: it is
//the ✕ (owner, F1). Its NAME is asserted separately, below — an icon-only
//control is exactly the kind that can lose one silently, so finding it and
//naming it are two different questions and get two different lines.
const removeControl = (element) => element.shadowRoot.querySelector('button.remove');

const rowText = (element) => element.shadowRoot.querySelector('.row').textContent.replace(/\s+/g, ' ').trim();

//The one thing a host is handed when an action is pressed: the whole next tree.
const nextExpressionFrom = async (element, control) => {
	let result = null;
	element.addEventListener('expression-modified', (e) => { result = e.detail.expression; });
	control.click();
	await element.updateComplete;
	return result;
};

const nextExpression = async (element, label) => nextExpressionFrom(element, verb(element, label));

const nextExpressionAfterRemove = async (element) => nextExpressionFrom(element, removeControl(element));

describe('the pill row', () => {

	describe('invert', () => {

		//NEGATION IS LANGUAGE, and the app already owns the words. Inverting
		//`published` must produce the FILTER `unpublished`, not a not-node that
		//would compile to exclude/published — the composer would otherwise be
		//able to re-spell one into the other and call it an edit.
		it('prefers the app\'s own inverse word over an operator', async () => {
			const element = await mount({ expression: [filter('published')], index: 0 });

			const next = await nextExpression(element, INVERT_VERB_LABEL);

			assert.deepStrictEqual(next, [filter('unpublished')]);
			assert.deepStrictEqual(serializeCollectionExpression(next), ['unpublished'],
				'and it compiles to the word, never to exclude/');
		});

		it('promises which word the pill will read, before it is pressed', async () => {
			const element = await mount({ expression: [filter('published')], index: 0 });
			assert.match(verb(element, INVERT_VERB_LABEL).getAttribute('title'), /Unpublished/,
				'the user is told what they are about to get');
			assert.ok(!/outlined/.test(verb(element, INVERT_VERB_LABEL).getAttribute('title')),
				'a named inverse is a plain word on a plain pill');
		});

		//SUPERSEDED PIN (owner, F3). This used to assert /outlined pill/ — the
		//title told the user what the app would PAINT, in vocabulary ('outlined',
		//'pill') that names nothing they have a concept for and that becomes a lie
		//the day the treatment changes. The promise is about the collection now.
		it('says what the clause will MEAN when there is no word for its inverse', async () => {
			const element = await mount({ expression: [filter('tag-3')], index: 0 });
			const title = verb(element, INVERT_VERB_LABEL).getAttribute('title');
			assert.match(title, /This becomes/, 'the resulting-word promise survives — that part was good');
			assert.match(title, /everything except those cards/, 'and the tail says the meaning');
			assert.ok(!/outlined|pill|struck|dashed|chip|badge/i.test(title),
				'no rendering vocabulary in a sentence about cards');
		});

		//THE SWEEP, NOT THE INSTANCE (owner, F3: "sweep ALL user-facing strings
		//for rendering vocabulary"). One fixed title is one bug; the RULE is that
		//this component never describes paint to a person. Attribute and text
		//content only — the component's own comments discuss outlined chips at
		//length, and they are written for readers of the source.
		it('puts no rendering vocabulary in any string a user reads', async () => {
			const element = await mount({ expression: [filter('tag-3')], index: 0, draftCount: 12, withoutCount: 40 });
			const strings = [rowText(element)];
			for (const node of element.shadowRoot.querySelectorAll('*')) {
				for (const attribute of ['title', 'aria-label', 'placeholder']) {
					const value = node.getAttribute(attribute);
					if (value) strings.push(value);
				}
			}
			assert.ok(strings.length > 3, 'the sweep actually found strings to sweep');
			for (const value of strings) {
				assert.ok(!/\b(outlined|struck|strikethrough|dashed|pill|chip|badge|lozenge)\b/i.test(value),
					`"${value}" describes rendering rather than meaning`);
			}
		});

		it('inverts one alternative inside a group without touching the others', async () => {
			const element = await mount({
				expression: [{ kind: 'or', members: [filter('published'), filter('tag-3')] }],
				index: 0,
				memberIndex: 0,
			});

			const next = await nextExpression(element, INVERT_VERB_LABEL);

			assert.deepStrictEqual(next, [{ kind: 'or', members: [filter('unpublished'), filter('tag-3')] }]);
		});

		it('is an involution: pressing it twice is the identity', async () => {
			const element = await mount({ expression: [filter('tag-3')], index: 0 });
			const once = await nextExpression(element, INVERT_VERB_LABEL);
			element.expression = once;
			await element.updateComplete;
			const twice = await nextExpression(element, INVERT_VERB_LABEL);
			assert.deepStrictEqual(twice, [filter('tag-3')]);
		});
	});

	describe('remove', () => {

		it('removes a whole condition', async () => {
			const element = await mount({ expression: [filter('tag-3'), filter('starred')], index: 0 });

			const next = await nextExpressionAfterRemove(element);

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

			const next = await nextExpressionAfterRemove(element);

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

			const next = await nextExpressionAfterRemove(element);

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

		//SUPERSEDED PIN (owner, F1, F2). It listed three verb LABELS —
		//[OR_VERB_LABEL, 'Flip', 'Remove'] — and that list is now wrong twice
		//over: the polarity verb says Invert, and removal has no label at all.
		//What the pin is actually for survives unchanged: every pill offers all
		//three actions, so a dead affordance is structurally impossible.
		it('offers all three actions on every pill, so a dead affordance is impossible', async () => {
			const element = await mount({ expression: [filter('starred')], index: 0 });
			assert.deepStrictEqual(
				Array.from(element.shadowRoot.querySelectorAll('button.verb')).map(button => button.textContent.trim()),
				[OR_VERB_LABEL, INVERT_VERB_LABEL],
				'the two verbs that REWRITE the clause wear words');
			assert.ok(removeControl(element), 'and removal is there too, as the ✕');
			const labels = Array.from(element.shadowRoot.querySelectorAll('button'))
				.map(button => button.textContent.trim());
			assert.ok(!labels.includes('Flip'),
				'the gesture word is gone; the button names the result now');
		});

		//THE VERB NAMES THE RESULT (owner, F2: the word is Invert).
		//
		//'Flip' said that something turns over. It did not say what into what —
		//which the title beneath it was already saying, and saying in exactly
		//these terms ("This becomes “Unpublished”"). The label and its title now
		//use one word for one idea.
		it('spells the polarity verb as the result, not as the gesture', async () => {
			assert.strictEqual(INVERT_VERB_LABEL, 'Invert');
			const element = await mount({ expression: [filter('published')], index: 0 });
			assert.ok(verb(element, 'Invert'), 'the button wears the label');
			assert.ok(!verb(element, 'Flip'), 'and the gesture word is gone');
		});

		//REMOVAL IS THE ✕ (owner, F1), which is the glyph this app already uses
		//for removing a clause — tag-chip's trailing delete, and therefore the
		//sentence pill's own remove control. A bordered word sitting beside the
		//two bordered rewriting verbs claimed to be a third rewrite.
		it('removes with the app\'s ✕, named twice because it is icon-only', async () => {
			const element = await mount({ expression: [filter('starred')], index: 0 });
			const remove = removeControl(element);
			assert.ok(remove, 'the control exists');
			assert.strictEqual(remove.textContent.trim(), '', 'and it carries no word');
			assert.ok(remove.querySelector('svg'), 'it is the icon');
			//HS §2.5: an icon-only control needs BOTH. A title alone is silent to
			//a screen reader; an aria-label alone is silent on hover.
			assert.strictEqual(remove.getAttribute('title'), 'Remove this filter');
			assert.strictEqual(remove.getAttribute('aria-label'), 'Remove this filter');
			assert.ok(remove.classList.contains('small'),
				'built on button.small, the app\'s icon treatment — not on the outlined verb chip');
			assert.ok(!remove.classList.contains('verb'),
				'removal does not rewrite the clause, so it does not wear the rewrite treatment');

			//And on one alternative it still says WHICH thing goes.
			const member = await mount({
				expression: [{ kind: 'or', members: [filter('tag-3'), filter('tag-7')] }],
				index: 0,
				memberIndex: 1,
			});
			assert.strictEqual(removeControl(member).getAttribute('aria-label'), 'Remove this alternative');
			assert.strictEqual(removeControl(member).getAttribute('title'), 'Remove this alternative');
		});

		//THE ✕ IS A 44px TARGET IN BOTH DIRECTIONS. button.small carries no
		//floor of its own — it is defined by REMOVING the base treatment — and an
		//18px glyph is what you get if nobody says otherwise (§4.2).
		it('gives the ✕ a real hit target', async () => {
			const element = await mount({ expression: [filter('starred')], index: 0 });
			const styles = element.constructor.styles.map(style => String(style.cssText || style)).join('\n');
			const rule = styles.match(/button\.remove\s*\{[^}]*\}/)[0];
			assert.match(rule, /min-height:\s*44px/);
			assert.match(rule, /min-width:\s*44px/, 'a glyph is narrow; the target must not be');
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

		//SUPERSEDED PIN, BY THE OWNER'S OWN REVERSAL (owner, F2).
		//
		//It used to be 'gives the verbs a visible boundary, so they read as
		//pressable', and it asserted a 1px --app-primary-color border plus a
		//lavender hover fill. That treatment was borrowed from the palette's
		//.suggestion-action[data-consequence='transform'] — which is a CHIP
		//painted on a row, not a button anyone presses — and as a button
		//rendering it existed nowhere else in this app. The owner's verdict:
		//"The round-4 bordered-outline verb treatment exists nowhere else in the
		//app and the owner finds it alien." So the boundary is deleted, and what
		//is pinned instead is that these two wear an EXISTING idiom exactly.
		//
		//The idiom is configure-collection-dialog's own `button.small.verb`:
		//transparent, --app-primary-color label, margin 0, a 44px floor. Its
		//nearest shipped instance is the pair "Keep editing" / "Return to last
		//valid collection" — two peer text verbs, side by side, in that same
		//dialog, neither of which commits, which is exactly what these are.
		//
		//The pin reads the DIALOG'S rule and requires the row's to match it
		//declaration for declaration, so the two cannot drift into two
		//treatments of one idea. JSDOM computes no layout, so what is pinned is
		//the rule.
		it('gives the verbs the dialog’s own text-verb treatment, and nothing of its own', async () => {
			const element = await mount({ expression: [filter('starred')], index: 0 });
			const styles = element.constructor.styles.map(style => String(style.cssText || style)).join('\n');
			const rule = styles.match(/button\.small\.verb\s*\{[^}]*\}/)[0];

			const declarations = (text) => text
				.slice(text.indexOf('{') + 1, text.lastIndexOf('}'))
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.split(';').map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean).sort();

			//THE SHIPPED RULE ITSELF, read out of the file that ships it.
			const dialogSource = await readFile(
				path.join(REPO_ROOT, 'src/components/configure-collection-dialog.ts'), 'utf8');
			const shipped = dialogSource.match(/\n\t\t\tbutton\.small\.verb \{[^}]*\}/)[0];
			assert.deepStrictEqual(declarations(rule), declarations(shipped),
				'the row wears the dialog\'s text-verb rule verbatim, not an approximation of it');

			//And the bespoke treatment is gone, not merely outranked.
			assert.ok(!/border:\s*1px solid var\(--app-primary-color\)/.test(styles),
				'the bordered-outline chip treatment is deleted from this component');
			assert.ok(!/button\.verb:hover/.test(styles),
				'and so is the hover fill that only existed to sit inside that border');

			//The group is still separated from the argument controls beside it.
			assert.match(styles, /\.verbs\s*\{[^}]*border-left:\s*1px solid var\(--app-divider-color\)/);
			//§4.2 has no outline BUTTON variant, and this does not invent one: it
			//is the same base variant the composer already extends.
			for (const button of element.shadowRoot.querySelectorAll('button.verb')) {
				assert.ok(button.classList.contains('small'),
					'built on button.small, not on a fourth button system');
			}
		});

		//THE ✕ IS WHERE THIS APP DISMISSES THINGS (owner, F1).
		//
		//It sat in the verb row, on the same line as two controls that REWRITE
		//the clause, and it is the one that deletes it. The app states its
		//dismiss idiom in exactly one place — DialogElement's #close: a
		//`button.small` absolutely positioned at the top right of the surface it
		//dismisses — so that is what the configurable section's own removal
		//takes, against the section instead of against a dialog.
		it('pins the ✕ to the section’s upper right, the way a dialog pins its close', async () => {
			const element = await mount({ expression: [filter('starred')], index: 0 });
			const styles = element.constructor.styles.map(style => String(style.cssText || style)).join('\n');
			const rule = styles.match(/button\.remove\s*\{[^}]*\}/)[0];
			assert.match(rule, /position:\s*absolute/);
			assert.match(rule, /top:\s*0/);
			assert.match(rule, /right:\s*0/);
			//The same three properties DialogElement's own close button uses,
			//read out of the file that ships it rather than restated here.
			const dialogElement = await readFile(
				path.join(REPO_ROOT, 'src/components/dialog-element.ts'), 'utf8');
			const close = dialogElement.match(/#close \{[^}]*\}/)[0];
			assert.match(close, /position:\s*absolute/,
				'the idiom this copies must still be the idiom');
			assert.match(close, /right:/);

			//AND IT CANNOT OVERLAP ANYTHING, AT ANY EDITOR SIZE: the row reserves
			//its column outright rather than relying on where the flow happens to
			//wrap on one viewport.
			const row = styles.match(/\.row\s*\{[^}]*\}/)[0];
			assert.match(row, /position:\s*relative/, 'the section is the positioning context');
			assert.match(row, /padding:\s*0\.35em 44px 0\.35em 0/,
				'44px of the right edge belongs to the ✕ and to nothing else');

			//It also left the verb row, which is the point.
			const verbs = element.shadowRoot.querySelector('.verbs');
			assert.ok(!verbs.contains(removeControl(element)),
				'removal is not a third verb');
		});

		//ONE ALIGNMENT RULE FOR EVERY LABEL/CONTROL PAIR (owner, F3: "the labels
		//on some configurable filter controls (for example created after 7 days)
		//are not consistent vertically").
		//
		//The cause was that the rule was only ever half a rule. `.row` centres
		//its items, but `.argument` was a COLUMN — so a tall argument hung its
		//label at the top of a 90px block and a short one hung its label 30px
		//lower, and the date editor's own boundary label landed at a third
		//height again. Measured live before the fix, on 'Created since 7 days
		//ago': 'When' at y=150, 'Date' at y=167, the radios at y=193, the fields
		//at y=216.
		//
		//What is pinned is the rule, not the pixels — JSDOM computes no layout,
		//and a pixel assertion would be a lie about what this suite can see. The
		//pixels were checked in the live app and are in the commit message.
		it('puts every label on its control\'s centerline, with one rule', async () => {
			const element = await mount({ expression: [filter('starred')], index: 0 });
			const styles = element.constructor.styles.map(style => String(style.cssText || style)).join('\n');
			const rule = styles.match(/\.argument\s*\{[^}]*\}/)[0];
			assert.match(rule, /align-items:\s*center/,
				'the label sits on its control\'s centerline whatever that control\'s height is');
			assert.match(rule, /flex-direction:\s*row/,
				'beside the control, not above it — above is what put them at four heights');
			assert.ok(!/flex-direction:\s*column/.test(rule));
			//THE HALF THAT IS NOT WRITTEN IN THIS FILE. ButtonSharedStyles gives
			//every <label> margin-top: 1em, and an .argument is a <label> — and a
			//centred flex row centres the MARGIN box, so the control lands half
			//that margin below the line. align-items alone does not fix this;
			//that is why the pin asserts both.
			assert.match(rule, /margin:\s*0/,
				'the shared stacked-form label margin is cancelled, or centring is a lie');
			//And the row that hosts the pairs centres them too, so the pairs
			//share one centerline with each other and with the verbs.
			assert.match(styles.match(/\.row\s*\{[^}]*\}/)[0], /align-items:\s*center/);
			assert.match(styles.match(/\.verbs\s*\{[^}]*\}/)[0], /align-items:\s*center/);
			//A label that wraps re-centres against its control and breaks the
			//line this whole rule exists to hold.
			assert.match(styles.match(/\.argument-label\s*\{[^}]*\}/)[0], /white-space:\s*nowrap/);
		});

		//SUPERSEDED PIN (owner, F2). This used to assert two separate lines —
		//'draft now matches 184 cards' and 'without this pill: 1842 cards' — and
		//then, after the round-3 tightness pass, only the second of them. One side
		//of a comparison, stated alone, reads as the size of the collection: the
		//owner read `without this pill: 34.4k cards` exactly that way. The row
		//states the transition now, in the palette list's own `current → after`
		//grammar, so there is one consequence language on the whole surface.
		it('states both sides of the removal, or neither', async () => {
			const element = await mount({ expression: [filter('starred')], index: 0 });
			assert.ok(!/removing this/.test(rowText(element)),
				'a number here is a promise about a collection; there is nothing honest to say before it arrives');

			//HALF A TRANSITION IS WORSE THAN NONE, which is the whole point: a
			//lone number is the misreading this fix exists to delete, so a row
			//that knows one side and not the other says nothing at all.
			element.withoutCount = 1842;
			await element.updateComplete;
			assert.ok(!/1842/.test(rowText(element)), 'one side alone is not a consequence');

			element.draftCount = 184;
			await element.updateComplete;
			assert.match(rowText(element), /removing this: 184 cards → 1842 cards/,
				'the WITH side, the arrow, and the WITHOUT side, in the list rows\' own grammar');
			assert.ok(!/without this pill/.test(rowText(element)),
				'and the old one-sided phrasing is gone with its jargon');
		});

		it('renders nothing at all for an address that names no token', async () => {
			const element = await mount({ expression: [filter('starred')], index: 4 });
			assert.strictEqual(element.shadowRoot.querySelector('.row'), null);
		});

		//SUPERSEDED PIN (owner, F4). This was 'documents the keys the footer
		//teaches, in the module that performs them' — it asserted the four
		//entries of PILL_ROW_KEY_HINTS ('+' adds an or, '-' inverts, Enter edits,
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

	//A VERB HAS TO MEAN SOMETHING FOR THE CLAUSE IT IS OFFERED ON.
	//
	//Both verbs are claims ABOUT claims: 'Also match…' builds an OR of two
	//predicates, and 'Invert' asks for the cards a predicate does NOT select. A
	//structural clause is not a predicate — a limit matches every card and is
	//applied after the sort — so widening one is a no-op and inverting one
	//quietly empties the collection. They were offered on every clause alike.
	describe('the verbs', () => {

		const verbLabels = (element) => Array.from(element.shadowRoot.querySelectorAll('button.verb'))
			.map((button) => button.textContent.trim());

		for (const spelling of ['limit/10', 'offset/5']) {
			it(`offers neither verb on ${spelling}`, async () => {
				const element = await mount({ expression: [filter(spelling)], index: 0 });
				assert.deepStrictEqual(verbLabels(element), [],
					'a clause that makes no claim about cards has nothing to widen or invert');
				//AND IT KEEPS WHAT IS REAL. Changing the number and removing the
				//clause are both perfectly meaningful; only the two verbs are not.
				assert.ok(element.shadowRoot.querySelector('.argument input'),
					'the argument control stays');
				assert.ok(element.shadowRoot.querySelector('button.remove'),
					'and so does the ✕');
			});
		}

		it('still offers both verbs on an ordinary clause', async () => {
			const element = await mount({ expression: [filter('tag-3')], index: 0 });
			assert.deepStrictEqual(verbLabels(element), [OR_VERB_LABEL, INVERT_VERB_LABEL]);
		});

		//THE INVOLUTION SURVIVES THE RULE. A negated ordinary clause SERIALIZES
		//as `exclude/tag-3`, and `exclude` is a structural FAMILY — so a rule
		//written against the spelling would refuse Invert to every clause that
		//had just been inverted, and make the app's own involution one-way. The
		//node here is the shape negatedExpressionNode actually produces, which
		//is what the row is handed after the user presses Invert once.
		it('still offers both verbs on an already-inverted clause', async () => {
			const element = await mount({ expression: [{ kind: 'not', child: filter('tag-3') }], index: 0 });
			assert.deepStrictEqual(verbLabels(element), [OR_VERB_LABEL, INVERT_VERB_LABEL],
				'inverting a clause must not remove the button that un-inverts it');
		});
	});
});
