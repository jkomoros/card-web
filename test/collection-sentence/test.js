/*eslint-env node, es2022*/

//THE SENTENCE RENDERER, AND THE PILL VOCABULARY IT IS BUILT FROM.
//
//These are BEHAVIORAL: the real components are registered and mounted in jsdom,
//real DOM events are fired at them, and the assertions read what the user would
//see and what a host would receive. jsdom computes no layout, so the handful of
//facts that are purely geometric (the 44px remove target, the quiet-until-hover
//rule) are pinned against the registered component's own stylesheet instead —
//the idiom the composer's interaction suite already uses for the same reason.
//
//What is worth pinning here is exactly what the design bets on:
//  - the two-fill rule (real colour only where colour already means something);
//  - negation as language, not as an operator (named inverses stay plain words,
//    inverse-less filters get the outlined "not" pill);
//  - the OR-group as ONE token containing alternatives;
//  - the traversal grammar, including entering and leaving a group;
//  - removal, which is what the palette's editable draft is built on;
//  - and the unresolved treatment, which is the one place the sentence and the
//    card count are allowed to disagree — visibly.

import { JSDOM } from 'jsdom';
import assert from 'assert';

const dom = new JSDOM('', { url: 'https://example.com/c/main/' });
for (const name of [
	'window', 'document', 'Document', 'HTMLElement', 'Element', 'Node',
	'customElements', 'CSSStyleSheet', 'Event', 'CustomEvent', 'MouseEvent',
	'KeyboardEvent', 'ShadowRoot', 'DocumentFragment', 'HTMLAnchorElement',
	'HTMLButtonElement', 'navigator', 'getComputedStyle', 'MutationObserver',
	'requestAnimationFrame',
]) globalThis[name] = name === 'window' ? dom.window : name === 'document' ? dom.window.document : dom.window[name];

const { UNRESOLVED_CLAUSE_NOTE } = await import('../../lib/src/components/collection-sentence.js');
await import('../../lib/src/components/tag-chip.js');

//A tag the app already has a colour for, and a section. Everything else the
//sentence meets is a property clause and must come out neutral.
const TAG_INFOS = {
	'tag-3': { id: 'tag-3', title: 'Systems', color: '#aa3377' },
	'reading-list': { id: 'reading-list', title: 'Reading list', color: '#3377aa' },
};

const NEUTRAL = 'var(--app-dark-text-color-darker)';

const mount = async (properties = {}) => {
	const element = document.createElement('collection-sentence');
	Object.assign(element, {
		expression: [],
		set: 'everything',
		sort: 'default',
		tagInfos: TAG_INFOS,
		...properties,
	});
	document.body.appendChild(element);
	await settle(element);
	return element;
};

//Lit renders the host, then each chip renders itself; a chip's own attributes
//are set by the host's template, so one cycle is not enough to read them.
const settle = async (element) => {
	for (let round = 0; round < 3; round++) {
		await element.updateComplete;
		for (const chip of chips(element)) await chip.updateComplete;
		for (const group of element.shadowRoot.querySelectorAll('tag-chip-group')) await group.updateComplete;
	}
};

const chips = (element) => Array.from(element.shadowRoot.querySelectorAll('tag-chip'));

//THE FILL THE SENTENCE CHOSE, read where it chose it. jsdom's CSS parser drops
//any inline value containing var(), so the painted background of a neutral pill
//is unreadable from the DOM there — but the DECISION is the tagInfos entry the
//sentence hands the chip, and that is data. tag-chip's own painting of that
//entry is pinned separately, against a concrete colour jsdom does keep.
const chipFill = (chip) => chip.tagInfos[chip.tagName].color;

const chipText = (chip) => chip.shadowRoot.querySelector('a.primary').textContent.replace(/\s+/g, ' ').trim();

//lit has no adoptedStyleSheets in jsdom, so it puts a <style> element in every
//shadow root; textContent would otherwise read the stylesheet as sentence text.
//Shadow content and slotted light children are both walked, because an OR-group
//keeps its members in the light DOM.
const visibleText = (node) => {
	let out = '';
	for (const child of node.childNodes) {
		if (child.nodeType === 3) { out += child.textContent; continue; }
		if (child.nodeType !== 1) continue;
		if (child.localName === 'style') continue;
		if (child.shadowRoot) out += visibleText(child.shadowRoot);
		out += visibleText(child);
	}
	return out;
};

const sentenceText = (element) => visibleText(element.shadowRoot).replace(/\s+/g, ' ').trim();

//Every event a host may wire, captured in arrival order.
const listen = (element) => {
	const seen = [];
	for (const name of ['condition-selected', 'member-selected', 'group-edge-selected',
		'condition-activated', 'condition-removed', 'set-clicked', 'sort-clicked']) {
		element.addEventListener(name, (e) => seen.push({ name, detail: e.detail }));
	}
	return seen;
};

const press = (element, key) => {
	const conditions = element.shadowRoot.querySelector('.conditions');
	conditions.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};

const filter = (name) => ({ kind: 'filter', filter: name });

describe('the collection sentence', () => {

	describe('structure', () => {

		it('reads as set, conditions and sort tail, joined by quiet interpuncts', async () => {
			const element = await mount({
				expression: [filter('tag-3'), filter('has-todo')],
				sort: 'recent',
			});
			//The set leads, the clauses follow, the sort trails. The operators are
			//interpuncts, never the word AND: structure is punctuation here.
			//The tail is PROSE about the collection, so the option name inside it
			//is lowercase: "sorted by Recent" reads as a proper noun the user is
			//supposed to already know, which is the register the whole sentence
			//is written to avoid.
			assert.match(sentenceText(element), /^Everything · Systems · Has any TODO · sorted by recent$/);
			assert.ok(!/ AND /.test(sentenceText(element)), 'AND is not a word in this sentence');
			assert.strictEqual(chips(element).length, 2, 'one pill per condition');
		});

		it('says nothing about a default sort or view', async () => {
			const element = await mount({ expression: [filter('has-todo')] });
			assert.ok(!/sorted by/.test(sentenceText(element)),
				'a sentence that says "sorted by default" is describing a field, not a collection');
			assert.ok(!/viewed as/.test(sentenceText(element)));
		});

		it('names a non-default view mode as the sentence\'s last words', async () => {
			const element = await mount({ expression: [], viewMode: 'web' });
			assert.match(sentenceText(element), /viewed as web/);
		});

		it('offers a count slot at the end rather than a count of its own', async () => {
			const element = await mount({ expression: [filter('has-todo')] });
			const slot = element.shadowRoot.querySelector('slot[name="count"]');
			assert.ok(slot, 'the count is the host\'s to supply — the sentence only reserves its place');
		});
	});

	describe('the two-fill rule', () => {

		//The spec's own warning is against a pill rainbow. The rule this
		//implements is not a taste call per filter family — it is a lookup, so
		//it cannot drift: a clause the app already has a colour for wears it,
		//and everything else is the one neutral.
		it('gives a value pill its real colour and a property pill the one neutral', async () => {
			const element = await mount({ expression: [filter('tag-3'), filter('has-todo')] });
			const [value, property] = chips(element);
			assert.strictEqual(chipFill(value), '#aa3377', 'a tag keeps the colour it has everywhere else');
			assert.strictEqual(chipFill(property), NEUTRAL, 'a property clause has no colour of its own');
		});

		//THE LOOKUP DECIDES WHETHER IT IS A VALUE; THE CORPUS DECIDES WHAT COLOUR.
		//
		//Folding those two questions into one (`real?.color || NEUTRAL`) meant a
		//value whose corpus has authored no colour came out neutral here and
		//tag-chip's own default two panels away: one tag, two colours, and in a
		//corpus that has never set a tag colour — which is most of them — the
		//spine's "colour where it already means something" rule inverted into
		//"nothing is coloured at all". A known value with no authored colour
		//passes `color` through UNSET, so tag-chip supplies the same default it
		//supplies for that tag everywhere else.
		it('leaves a colourless value to tag-chip\'s own default rather than neutralising it', async () => {
			const element = await mount({
				expression: [filter('tag-9'), filter('has-todo')],
				tagInfos: { ...TAG_INFOS, 'tag-9': { id: 'tag-9', title: 'Uncoloured' } },
			});
			const [value, property] = chips(element);
			assert.strictEqual(chipFill(value), undefined,
				'a value the corpus gave no colour must not be pinned to the property neutral');
			assert.strictEqual(value.shadowRoot.querySelector('span').style.backgroundColor,
				'rgb(205, 92, 92)',
				'tag-chip paints it the same default it paints that tag with everywhere else');
			assert.strictEqual(chipFill(property), NEUTRAL, 'and a clause that is not a value still is');
		});

		it('uses no third fill, whatever the expression contains', async () => {
			const element = await mount({
				expression: [
					filter('tag-3'),
					filter('updated/after/2020-01-01'),
					{ kind: 'or', members: [filter('reading-list'), filter('starred')] },
					{ kind: 'not', child: filter('has-todo') },
					{ kind: 'manual', source: 'expand/similar' },
				],
			});
			const fills = new Set(chips(element).map(chipFill));
			//Two real colours for the two value pills, and the single neutral for
			//every other clause — a negated pill keeps its own colour and merely
			//stops being filled with it, so negation adds no third choice here.
			const allowed = new Set([NEUTRAL, '#aa3377', '#3377aa']);
			for (const fill of fills) assert.ok(allowed.has(fill), `unexpected pill fill ${fill}`);
		});

		it('names a value pill with the title the app already uses for it', async () => {
			const element = await mount({ expression: [filter('tag-3')] });
			assert.strictEqual(chipText(chips(element)[0]), 'Systems',
				'the sentence chip and the card chip are the same tag; they must be the same word');
		});

		it('lets an explicit label win over the tag\'s own title', async () => {
			const element = await mount({
				expression: [filter('tag-3')],
				labels: { 'tag-3': 'Systems thinking' },
			});
			assert.strictEqual(chipText(chips(element)[0]), 'Systems thinking');
		});
	});

	describe('negation is language', () => {

		it('renders a filter with a named inverse as its own word, on a plain pill', async () => {
			const element = await mount({ expression: [filter('unpublished')] });
			const [chip] = chips(element);
			assert.strictEqual(chip.negated, false, 'unpublished is a word, not an operator');
			assert.ok(!/\bnot\b/.test(chipText(chip)), 'and nothing is prefixed to it');
			assert.strictEqual(chip.shadowRoot.querySelector('span').classList.contains('negated'), false,
				'so the pill stays filled');
		});

		it('renders an inverse-less filter as the outlined not-pill', async () => {
			const element = await mount({ expression: [{ kind: 'not', child: filter('tag-3') }] });
			const [chip] = chips(element);
			assert.strictEqual(chip.negated, true);
			//The space after 'not' is a MARGIN, not a trailing space inside the
			//element: a trailing space at an inline element's edge is collapsed
			//away in exactly the cases that matter, which is how the pill came to
			//read "notSystems". textContent therefore has no space in it and the
			//rendering does.
			assert.strictEqual(chipText(chip), 'notSystems', 'the negation is a word inside the pill');
			assert.strictEqual(chip.shadowRoot.querySelector('span').style.color, 'rgb(170, 51, 119)',
				'fill inversion keeps the colour the tag already has, as the text and border');
			assert.strictEqual(chipFill(chip), '#aa3377',
				'and it is still the same clause about the same tag');
		});
	});

	describe('the OR-group', () => {

		it('renders alternatives as ONE token containing pills, joined by a quiet or', async () => {
			const element = await mount({
				expression: [{ kind: 'or', members: [filter('tag-3'), filter('reading-list')] }],
			});
			const groups = element.shadowRoot.querySelectorAll('tag-chip-group');
			assert.strictEqual(groups.length, 1, 'a group is one token');
			assert.strictEqual(groups[0].querySelectorAll('tag-chip').length, 2);
			assert.match(sentenceText(element), /Systems\s*or\s*Reading list/);
			assert.ok(!/OR/.test(sentenceText(element)), 'the operator is subordinate lowercase text');
		});

		it('keeps every member\'s own colour inside the one border', async () => {
			const element = await mount({
				expression: [{ kind: 'or', members: [filter('tag-3'), filter('reading-list')] }],
			});
			assert.deepStrictEqual(chips(element).map(chipFill), ['#aa3377', '#3377aa']);
		});

		it('names the whole group for assistive tech, not just its members', async () => {
			const element = await mount({
				interactive: true,
				expression: [{ kind: 'or', members: [filter('tag-3'), filter('reading-list')] }],
			});
			const group = element.shadowRoot.querySelector('tag-chip-group');
			assert.strictEqual(group.getAttribute('role'), 'group');
			assert.strictEqual(group.getAttribute('aria-label'), 'Systems or Reading list');
		});

		//A FLIPPED GROUP INVERTS AS A UNIT.
		//
		//The negation used to render as a floating word BESIDE a container of
		//solid pills, which reads left to right as `(not Systems) or Reading
		//list` — a different collection from the one it names, and exactly the
		//precedence the group's border exists to settle. Two facts fix it and
		//both are pinned: the word lives inside the boundary it applies to, so
		//there is nothing for it to attach to except the whole group; and the
		//CONTAINER takes the fill inversion, which is the rule tag-chip already
		//states for a negated pill, applied at the level the negation applies at.
		it('puts the not INSIDE a negated group, and inverts the group as one thing', async () => {
			const element = await mount({
				expression: [{ kind: 'not', child: { kind: 'or', members: [filter('tag-3'), filter('reading-list')] } }],
			});
			assert.match(sentenceText(element), /not\s*Systems\s*or\s*Reading list/);
			const group = element.shadowRoot.querySelector('tag-chip-group');
			assert.ok(group.hasAttribute('negated'), 'the container is what is flipped');
			const negation = group.querySelector('.group-negation');
			assert.ok(negation, 'and the word that says so is one of its children');
			assert.strictEqual(negation.textContent.trim(), 'not');
			assert.deepStrictEqual(chips(element).map(chip => chip.negated), [false, false],
				'the negation applies to all the alternatives, so no single member wears it');
			//The container's inversion is the same trade tag-chip makes: the fill
			//goes and the edge arrives.
			const groupStyles = customElements.get('tag-chip-group').styles
				.map(sheet => String(sheet.cssText || '')).join('\n');
			assert.match(groupStyles, /:host\(\[negated\]\)\s*\{[^}]*background:\s*var\(--app-light-text-color\)/);
			assert.match(groupStyles, /:host\(\[negated\]\)\s*\{[^}]*border-width:\s*2px/);
		});
	});

	//TOUCH IS NOT A SMALLER MOUSE, and on a phone the sentence was unusable:
	//tapping a pill selected the word inside its label instead of opening the
	//pill row, the pills were ~20px against §4.2's 44px floor, and the group's
	//only edge affordance was a 1px border.
	describe('the touch layout', () => {

		const sentenceStyles = () => customElements.get('collection-sentence').styles
			.map(sheet => String(sheet.cssText || '')).join('\n');

		it('refuses to let a tap become a text selection', () => {
			//A tap IS a press-and-hold for the ~100ms before it resolves, and the
			//browser's default answer to a press-and-hold on text is to select
			//the word under it. Pinned on both sides of the shadow boundary: the
			//sentence declares it (user-select inherits) and the tokenized chip
			//declares it for itself.
			assert.match(sentenceStyles(), /\.sentence\s*\{[^}]*user-select:\s*none/);
			const chipStyles = customElements.get('tag-chip').styles
				.map(sheet => String(sheet.cssText || '')).join('\n');
			assert.match(chipStyles, /span\.tokenized\s*\{[^}]*user-select:\s*none/);
		});

		it('gives every token the 44px floor, and the group edge something to tap', () => {
			const styles = sentenceStyles();
			assert.match(styles, /:host\(\[mobile\]\)[^{]*tag-chip[^{]*\{[^}]*min-height:\s*44px/);
			assert.match(styles, /:host\(\[mobile\]\)\s*tag-chip-group\s*\{[^}]*padding/,
				'a 1px border is not a target on any device');
			assert.match(styles, /:host\(\[mobile\]\)\s*\.sentence\s*\{[^}]*line-height/,
				'or two rows of 44px targets overlap and the top of one pill belongs to the pill above it');
		});

		it('reflects the flag so the layout is reachable from CSS at all', async () => {
			const element = await mount({ mobile: true, expression: [filter('tag-3')] });
			assert.ok(element.hasAttribute('mobile'));
		});
	});

	describe('the unresolved treatment', () => {

		//THE SENTENCE AND THE COUNT HAVE TO AGREE. A clause the parser could not
		//resolve is not in the collection the count describes, so it is shown as
		//what it is: named, not applied.
		it('strikes a clause the app could not resolve, and says so in its name', async () => {
			const element = await mount({
				interactive: true,
				expression: [filter('tag-33x'), filter('has-todo')],
				unresolvedFilters: ['tag-33x'],
			});
			const [struck, applied] = chips(element);
			assert.ok(struck.hasAttribute('data-unresolved'), 'the struck clause is marked');
			assert.ok(!applied.hasAttribute('data-unresolved'), 'and the applied one is not');
			assert.match(struck.getAttribute('aria-label'), /didn’t understand/,
				'the strike is invisible to a screen reader, so the name carries it too');
			assert.match(UNRESOLVED_CLAUSE_NOTE, /didn’t understand/);
		});

		it('carries the strike as a decoration, never as a colour alone', async () => {
			const styles = customElements.get('collection-sentence').styles
				.map(sheet => String(sheet.cssText || '')).join('\n');
			assert.match(styles, /\[data-unresolved\]\s*\{[^}]*text-decoration:\s*line-through/);
			assert.ok(!/\[data-unresolved\]\s*\{[^}]*--app-warning-color/.test(styles),
				'nothing went wrong here, so it takes no warning colour');
		});
	});

	describe('the keyboard grammar', () => {

		const GROUPED = [
			filter('tag-3'),
			{ kind: 'or', members: [filter('reading-list'), filter('starred')] },
			filter('has-todo'),
		];

		it('traverses conditions with left and right, clamping at the ends', async () => {
			const element = await mount({ interactive: true, expression: GROUPED, selectedPath: [0] });
			const seen = listen(element);

			press(element, 'ArrowRight');
			assert.deepStrictEqual(seen.at(-1), { name: 'group-edge-selected', detail: { index: 1, memberIndex: -1 } },
				'landing on a group selects the group as one token');

			//The component is CONTROLLED: it reports where the arrow points and
			//the host moves the selection. A test that skipped this step would be
			//asserting against a component that had quietly kept its own copy.
			element.selectedPath = [1];
			await settle(element);
			press(element, 'ArrowLeft');
			assert.deepStrictEqual(seen.at(-1), { name: 'condition-selected', detail: { index: 0, memberIndex: -1 } });

			element.selectedPath = [0];
			await settle(element);
			const before = seen.length;
			press(element, 'ArrowLeft');
			assert.strictEqual(seen.length, before, 'the beginning of a sentence is the beginning; it does not wrap');
		});

		it('enters a group with down and leaves it with up', async () => {
			const element = await mount({ interactive: true, expression: GROUPED, selectedPath: [1] });
			const seen = listen(element);

			press(element, 'ArrowDown');
			assert.deepStrictEqual(seen.at(-1), { name: 'member-selected', detail: { index: 1, memberIndex: 0 } });

			element.selectedPath = [1, 0];
			await settle(element);
			press(element, 'ArrowRight');
			assert.deepStrictEqual(seen.at(-1), { name: 'member-selected', detail: { index: 1, memberIndex: 1 } });

			element.selectedPath = [1, 1];
			await settle(element);
			const before = seen.length;
			press(element, 'ArrowRight');
			assert.strictEqual(seen.length, before, 'right at the last alternative stays inside the group — up is how you leave');

			press(element, 'ArrowUp');
			assert.deepStrictEqual(seen.at(-1), { name: 'group-edge-selected', detail: { index: 1, memberIndex: -1 } });
		});

		it('removes the selection with Delete and opens it with Enter', async () => {
			const element = await mount({ interactive: true, expression: GROUPED, selectedPath: [1, 1] });
			const seen = listen(element);

			press(element, 'Delete');
			assert.deepStrictEqual(seen.at(-1), { name: 'condition-removed', detail: { index: 1, memberIndex: 1 } },
				'Delete names the alternative, not the group that holds it');

			press(element, 'Enter');
			assert.deepStrictEqual(seen.at(-1), { name: 'condition-activated', detail: { index: 1, memberIndex: 1 } });
		});

		it('does nothing at all when it is not interactive', async () => {
			const element = await mount({ expression: GROUPED, selectedPath: [0] });
			assert.strictEqual(element.shadowRoot.querySelector('.conditions').getAttribute('role'), null,
				'prose is not announced as a toolbar');
			const seen = listen(element);
			press(element, 'ArrowRight');
			press(element, 'Delete');
			assert.deepStrictEqual(seen, []);
		});
	});

	describe('the ARIA pattern', () => {

		it('is a toolbar of controls, with exactly one tab stop', async () => {
			const element = await mount({
				interactive: true,
				expression: [filter('tag-3'), filter('has-todo'), filter('starred')],
			});
			const conditions = element.shadowRoot.querySelector('.conditions');
			assert.strictEqual(conditions.getAttribute('role'), 'toolbar');
			assert.strictEqual(conditions.getAttribute('aria-orientation'), 'horizontal');
			assert.ok(conditions.getAttribute('aria-label'), 'a toolbar needs a name');

			const tabbable = chips(element).filter(chip => chip.getAttribute('tabindex') === '0');
			assert.strictEqual(tabbable.length, 1, 'a roving tabindex has one tab stop, not three');
			assert.strictEqual(tabbable[0], chips(element)[0], 'and with nothing selected it is the first token');
		});

		it('moves the tab stop to the selection, and says which token is current', async () => {
			const element = await mount({
				interactive: true,
				expression: [filter('tag-3'), filter('has-todo')],
				selectedPath: [1],
			});
			const [first, second] = chips(element);
			assert.strictEqual(first.getAttribute('tabindex'), '-1');
			assert.strictEqual(second.getAttribute('tabindex'), '0');
			assert.strictEqual(second.getAttribute('aria-current'), 'true');
			assert.strictEqual(first.getAttribute('aria-current'), null);
		});

		it('is not a listbox, and the reason is written down', async () => {
			const { readFile } = await import('fs/promises');
			const source = await readFile(new URL('../../src/components/collection-sentence.ts', import.meta.url), 'utf8');
			assert.match(source, /role=option` requires presentational children/,
				'the pattern choice is a design decision and must not be re-litigated from memory');
			assert.ok(!/role='listbox'|role="listbox"/.test(source));
		});

		it('exposes no roles or tab stops at all when it is not interactive', async () => {
			const element = await mount({ expression: [filter('tag-3')] });
			const [chip] = chips(element);
			assert.strictEqual(chip.getAttribute('tabindex'), null);
			assert.strictEqual(chip.getAttribute('role'), null);
		});
	});

	describe('pointer gestures', () => {

		it('reports which token was clicked', async () => {
			const element = await mount({ interactive: true, expression: [filter('tag-3'), filter('has-todo')] });
			const seen = listen(element);
			chips(element)[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, composed: true }));
			assert.deepStrictEqual(seen.at(-1), { name: 'condition-selected', detail: { index: 1, memberIndex: -1 } });
		});

		it('scopes a segment tap to the segment and an edge tap to the group', async () => {
			const element = await mount({
				interactive: true,
				expression: [{ kind: 'or', members: [filter('tag-3'), filter('reading-list')] }],
			});
			const seen = listen(element);
			const group = element.shadowRoot.querySelector('tag-chip-group');

			group.querySelectorAll('tag-chip')[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, composed: true }));
			assert.deepStrictEqual(seen.at(-1), { name: 'member-selected', detail: { index: 0, memberIndex: 1 } });

			group.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, composed: true }));
			assert.deepStrictEqual(seen.at(-1), { name: 'group-edge-selected', detail: { index: 0, memberIndex: -1 } });
		});

		//THE ✕ ON A PILL removes that clause; a host turns that into an edit of
		//its draft. It must not ALSO read as a selection of the pill, which is
		//what a click anywhere else on it means.
		it('reports a removal and stops it being read as a selection too', async () => {
			const element = await mount({ interactive: true, expression: [filter('tag-3'), filter('has-todo')] });
			const seen = listen(element);
			let bubbled = 0;
			element.addEventListener('click', () => bubbled++);

			const chip = chips(element)[1];
			chip.shadowRoot.querySelector('a.delete').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, composed: true }));
			await settle(element);

			assert.ok(seen.some(entry => entry.name === 'condition-removed' && entry.detail.index === 1),
				'the ✕ names the clause it removes');
			assert.strictEqual(bubbled, 0, 'and the click that produced it does not also reach the host as "open this"');
		});

		it('reports a member removal by its place inside the group', async () => {
			const element = await mount({
				interactive: true,
				expression: [{ kind: 'or', members: [filter('tag-3'), filter('reading-list')] }],
			});
			const seen = listen(element);
			const member = element.shadowRoot.querySelectorAll('tag-chip')[1];
			member.shadowRoot.querySelector('a.delete').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, composed: true }));
			assert.deepStrictEqual(seen.at(-1), { name: 'condition-removed', detail: { index: 0, memberIndex: 1 } });
		});

		it('offers the set and the sort as words a host can act on', async () => {
			const element = await mount({ interactive: true, expression: [], sort: 'recent' });
			const seen = listen(element);
			element.shadowRoot.querySelector('button.word.set').click();
			element.shadowRoot.querySelector('button.word.tail').click();
			assert.deepStrictEqual(seen.map(entry => entry.name), ['set-clicked', 'sort-clicked']);
		});
	});
});

//THE PILL VOCABULARY ITSELF. These extensions exist for the sentence, so they
//are pinned beside it: tag-chip had no outlined state and no token mode before
//this wave, and both are load-bearing for how a clause reads.
describe('the pill vocabulary', () => {

	const chipStyles = () => customElements.get('tag-chip').styles
		.map(sheet => String(sheet.cssText || '')).join('\n');

	const mountChip = async (properties) => {
		const chip = document.createElement('tag-chip');
		Object.assign(chip, properties);
		document.body.appendChild(chip);
		await chip.updateComplete;
		return chip;
	};

	it('leaves a plain chip exactly as it was', async () => {
		const chip = await mountChip({ tagName: 'tag-3', tagInfos: TAG_INFOS });
		const span = chip.shadowRoot.querySelector('span');
		assert.ok(!span.classList.contains('negated'));
		assert.strictEqual(span.style.backgroundColor, 'rgb(170, 51, 119)');
		assert.strictEqual(span.style.color, '', 'a filled chip takes its text colour from the host rule, as before');
	});

	it('inverts the fill of a negated chip and keeps its colour as the outline', async () => {
		const chip = await mountChip({ tagName: 'tag-3', tagInfos: TAG_INFOS, negated: true });
		const span = chip.shadowRoot.querySelector('span');
		assert.ok(span.classList.contains('negated'));
		assert.strictEqual(span.style.color, 'rgb(170, 51, 119)');
		//jsdom drops a var() from an inline style, so the white fill itself is
		//pinned where it is decided rather than where it is painted.
		assert.match(String(customElements.get('tag-chip').prototype.render), /var\(--app-light-text-color\)/);
		assert.strictEqual(chip.shadowRoot.querySelector('.not').textContent, 'not',
			'the negation is a quiet lowercase word in the label, not a badge');
		//And the space after it is a margin, so it cannot be collapsed away.
		assert.match(chipStyles(), /\.not\s*\{[^}]*margin-right/);
	});

	it('pays for the outline out of the padding, so flipping a pill moves nothing', () => {
		assert.match(chipStyles(), /span\.negated\s*\{[^}]*border:\s*1px solid/);
		assert.match(chipStyles(), /span\.negated\s*\{[^}]*padding:\s*calc\(0\.2em - 1px\)/,
			'a negated chip must occupy the same box as a plain one');
	});

	it('gives a tokenized chip an icon for its remove control, not a literal X', async () => {
		const chip = await mountChip({ tagName: 'tag-3', tagInfos: TAG_INFOS, tokenized: true, editing: true });
		const remove = chip.shadowRoot.querySelector('a.delete');
		assert.ok(remove.querySelector('svg'), '§4.2: never render a text glyph where an icon exists');
		assert.strictEqual(remove.getAttribute('tabindex'), '-1',
			'the surrounding surface owns the tab order; Delete is this control\'s keyboard equivalent');
	});

	it('keeps the remove control quiet until it is reached for, without reflowing', () => {
		const styles = chipStyles();
		assert.match(styles, /span\.tokenized\.enabled\.editing a\.delete\s*\{[^}]*opacity:\s*0/);
		assert.match(styles, /span\.tokenized\.enabled\.editing:hover a\.delete/);
		assert.ok(!/span\.tokenized\.enabled\.editing a\.delete\s*\{[^}]*display:\s*none/.test(styles),
			'display:none would shove the sentence sideways under the cursor');
	});

	it('gives that control a 44px target without a 44px glyph', () => {
		assert.match(chipStyles(), /span\.tokenized a\.delete::after\s*\{[^}]*height:\s*44px/);
		assert.match(chipStyles(), /span\.tokenized a\.delete::after\s*\{[^}]*width:\s*44px/);
	});

	it('does not make a chip with nowhere to go into a link', async () => {
		const chip = await mountChip({ tagName: 'tag-3', tagInfos: { 'tag-3': { ...TAG_INFOS['tag-3'], suppressLink: true } } });
		assert.strictEqual(chip.shadowRoot.querySelector('a.primary').getAttribute('href'), null,
			'an anchor with no destination is not a link and must not be a tab stop');
	});

	it('draws the OR-group as one hairline pill around its members', () => {
		const styles = customElements.get('tag-chip-group').styles
			.map(sheet => String(sheet.cssText || '')).join('\n');
		//THE BORDER HAS TO BE VISIBLE TO BE A BORDER. --app-divider-color is
		//#eee on a white dialog: the one mark that says "these two pills are one
		//condition" could not be seen. It takes the subordinate TEXT colour, the
		//same token the sentence's own operators use.
		assert.match(styles, /border:\s*1px solid var\(--app-dark-text-color-light\)/);
		assert.match(styles, /border-radius:\s*0\.3em/, 'the same radius tag-chip rounds at — a group IS a pill');
	});
});
