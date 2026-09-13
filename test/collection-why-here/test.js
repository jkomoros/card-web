/*eslint-env node, es2022*/

//WHY THIS CARD IS HERE — THE ACCOUNT, AND THE SECTION THAT SHOWS IT.
//
//This suite is in two halves because the feature is in two halves, and only one
//of them can be got wrong quietly.
//
//The MODEL half is the load-bearing one. The panel claims to explain the
//engine's decision clause by clause, and the only thing standing between that
//claim and a plausible fiction is that the verdicts come from the engine's own
//per-segment machinery rather than from a second implementation of it. So the
//central assertion here is not "tag-1 passes for card a" — it is that for EVERY
//card in a real corpus, the conjunction of the per-clause verdicts equals the
//membership the real Collection computed. A re-derivation that got one filter
//family subtly wrong would still pass a hand-written per-clause pin; it cannot
//pass this one.
//
//The COMPONENT half is behavioral, in the idiom the sentence suite already
//uses: the real components are registered and mounted in jsdom, and the
//assertions read what a user would see (which pills are dimmed, what the honest
//line says) and what a host would receive (the tap-through event).

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

const { CollectionDescription } = await import('../../lib/src/collection_description.js');
const { parseCollectionExpression } = await import('../../lib/src/collection-expression.js');
const {
	collectionMembershipForCard,
	collectionMembershipNote,
} = await import('../../lib/src/collection-membership.js');
const { WHY_HERE_HEADING } = await import('../../lib/src/components/collection-why-here.js');
await import('../../lib/src/components/tag-chip.js');

//--- The corpus -------------------------------------------------------------
//
//Six cards chosen so every verdict shape has a witness: a card that passes
//everything, one that fails a plain clause, one that passes a group through its
//SECOND alternative, one that fails a group outright, one that passes only the
//negated clause, and one that is outside the set while passing every condition.

const card = (id, extras) => ({
	id,
	card_type: 'content',
	title: 'Title of ' + id,
	body: '<p>Body</p>',
	section: 'main',
	tags: [],
	sort_order: 1.0,
	references: {},
	references_info: {},
	references_inbound: {},
	references_info_inbound: {},
	auto_todo_overrides: {},
	published: true,
	...extras,
});

const IDS = ['a', 'b', 'c', 'd', 'e', 'g'];

const makeState = () => {
	const cards = Object.fromEntries(IDS.map((id, index) => [id, card(id, { sort_order: index })]));
	const sets = {
		//`g` is deliberately outside main and inside everything: it is the card
		//that fails only the SET.
		main: ['a', 'b', 'c', 'd', 'e'],
		everything: [...IDS],
		'reading-list': [],
	};
	const filters = {
		'in-all-set': { a: true, b: true, c: true, d: true, e: true },
		'in-everything-set': Object.fromEntries(IDS.map(id => [id, true])),
		'tag-1': { a: true, b: true, e: true, g: true },
		'tag-2': { c: true },
		starred: { a: true, c: true, e: true, g: true },
		//`published` is the POSITIVE side of the pair; `unpublished` reaches it
		//through INVERSE_FILTER_NAMES, which is exactly the path the negated
		//pill has to travel.
		published: { a: true, b: true, c: true },
	};
	return { cards, sets, filters };
};

const STABLE = {};

const makeArgs = (state) => ({
	cards: state.cards,
	sets: state.sets,
	filters: state.filters,
	sections: STABLE,
	fallbacks: STABLE,
	startCards: STABLE,
	userID: '',
	randomSalt: '',
	cardSimilarity: STABLE,
	editingCardSimilarity: undefined,
	keyCardID: '',
	editingCard: undefined,
	cardsSnapshot: state.cards,
	filtersSnapshot: state.filters,
});

//Everything AND (tag-1 or tag-2) AND starred AND unpublished — one group, one
//plain clause, one clause whose pill reads as a word rather than an operator.
const FILTERS = ['tag-1+tag-2', 'starred', 'unpublished'];

const membershipFor = (set, cardID) => {
	const state = makeState();
	const description = new CollectionDescription(set, FILTERS);
	const collection = description.collection(makeArgs(state));
	return collectionMembershipForCard(
		parseCollectionExpression(description.filters),
		set,
		cardID,
		collection.filterExtras
	);
};

//THE DOM IS A FIXTURE TOO, and nothing was putting it back.
//
//Every mount in this file appends to document.body and no test removed what it
//appended, so a full run finished with dozens of live elements stacked in one
//document — each with its own Lit update loop, its own listeners and its own
//shadow root. Anything that queries past a shadow boundary, counts elements, or
//reads document.activeElement is then reading the whole run's residue rather
//than the case in front of it. Emptying the body between tests is what makes a
//test's DOM the DOM that test built.
afterEach(() => {
	while (document.body.firstChild) document.body.firstChild.remove();
});

describe('why this card is here', () => {

	describe('the account, against the engine that made the decision', () => {

		//THE ASSERTION THE WHOLE FEATURE RESTS ON.
		it('agrees with the real collection about every card, one clause at a time', () => {
			const state = makeState();
			for (const set of ['main', 'everything']) {
				const description = new CollectionDescription(set, FILTERS);
				const collection = description.collection(makeArgs(state));
				const expression = parseCollectionExpression(description.filters);
				const matched = new Set(collection.filteredCards.map(item => item.id));
				for (const id of IDS) {
					const membership = collectionMembershipForCard(expression, set, id, collection.filterExtras);
					assert.strictEqual(membership.passes, matched.has(id),
						`${set}: the clause-by-clause account disagrees with the collection about ${id}`);
				}
			}
		});

		//And the collection's own cross-check, which is what the selector
		//consults before it publishes an explanation at all.
		it('answers matchedCard with the same verdict it reaches clause by clause', () => {
			const state = makeState();
			const description = new CollectionDescription('main', FILTERS);
			const collection = description.collection(makeArgs(state));
			const expression = parseCollectionExpression(description.filters);
			for (const id of IDS) {
				const membership = collectionMembershipForCard(expression, 'main', id, collection.filterExtras);
				assert.strictEqual(collection.matchedCard(id), membership.passes, id);
			}
		});

		it('refuses to answer matchedCard where the card list is not a membership answer', () => {
			const state = makeState();
			//A limited collection has truncated its matches, so absence from the
			//list means nothing and the cross-check must not read it as a no.
			//`limit` is a FILTER in this grammar, which is why it is spelled as
			//one here.
			const limited = new CollectionDescription('main', [...FILTERS, 'limit/1']);
			assert.strictEqual(limited.collection(makeArgs(state)).matchedCard('a'), null);
			//And a fallback collection is showing what it found INSTEAD of its
			//matches, so its card list is not a membership answer either.
			const empty = new CollectionDescription('main', ['tag-2', 'starred', 'unpublished']);
			const fallbackArgs = {...makeArgs(state), fallbacks: {[empty.serialize()]: ['a']}};
			const fallback = empty.collection(fallbackArgs);
			assert.strictEqual(fallback.isFallback, true, 'the fixture has to actually fall back');
			assert.strictEqual(fallback.matchedCard('a'), null);
		});

		//`a` is the card that passes everything but the negation: it is
		//published, and the pill reads "unpublished".
		it('reads a negated pill as a verdict about the negation', () => {
			const membership = membershipFor('main', 'a');
			assert.deepStrictEqual(membership.conditions.map(item => item.passes), [true, true, false]);
			assert.strictEqual(membership.passes, false);

			//`d` is unpublished, so the same pill is lit for it.
			assert.strictEqual(membershipFor('main', 'd').conditions[2].passes, true);
		});

		it('lights the alternative that passes and dims its siblings', () => {
			//`a` is tagged 1, `c` is tagged 2: the group passes for both, but
			//through different members.
			assert.deepStrictEqual(membershipFor('main', 'a').conditions[0].members, [true, false]);
			assert.deepStrictEqual(membershipFor('main', 'c').conditions[0].members, [false, true]);
			//`d` has neither tag, so the group itself fails.
			const d = membershipFor('main', 'd').conditions[0];
			assert.strictEqual(d.passes, false);
			assert.deepStrictEqual(d.members, [false, false]);
		});

		it('counts the set separately from the conditions', () => {
			//`g` passes every condition and is simply not in Main.
			const g = membershipFor('main', 'g');
			assert.deepStrictEqual(g.conditions.map(item => item.passes), [true, true, true]);
			assert.strictEqual(g.setPasses, false);
			assert.strictEqual(g.failingConditions, 0);
			assert.strictEqual(g.passes, false);
			//And in Everything, the same card is simply in the collection.
			const everything = membershipFor('everything', 'g');
			assert.strictEqual(everything.setPasses, true);
			assert.strictEqual(everything.passes, true);
		});
	});

	describe('the one honest line', () => {

		const note = (overrides) => collectionMembershipNote({
			conditions: [{ passes: true, members: [] }, { passes: true, members: [] },
				{ passes: true, members: [] }, { passes: true, members: [] }],
			setPasses: true,
			failingConditions: 0,
			passes: true,
			...overrides,
		}, 'Main');

		it('says nothing at all when the card is in the collection', () => {
			assert.strictEqual(note(), '');
		});

		it('counts the conditions the card fails', () => {
			assert.strictEqual(note({ failingConditions: 2, passes: false }),
				'Not in this collection — fails 2 of 4 conditions');
			assert.strictEqual(note({ failingConditions: 1, passes: false }),
				'Not in this collection — fails 1 of 4 conditions');
		});

		it('names the set instead of a count when the set is what fails', () => {
			assert.strictEqual(note({ setPasses: false, passes: false }),
				'Not in this collection — this card isn’t in Main');
		});
	});

	describe('the section', () => {

		const TAG_INFOS = {
			'tag-1': { id: 'tag-1', title: 'Tag 1', color: '#aa3377' },
			'tag-2': { id: 'tag-2', title: 'Tag 2', color: '#3377aa' },
		};

		const settle = async (element) => {
			for (let round = 0; round < 4; round++) {
				await element.updateComplete;
				for (const child of element.shadowRoot.querySelectorAll('collection-sentence')) {
					await child.updateComplete;
					for (const chip of child.shadowRoot.querySelectorAll('tag-chip')) await chip.updateComplete;
					for (const group of child.shadowRoot.querySelectorAll('tag-chip-group')) {
						await group.updateComplete;
						for (const chip of group.querySelectorAll('tag-chip')) await chip.updateComplete;
					}
				}
			}
		};

		const mount = async (cardID, set = 'main') => {
			const element = document.createElement('collection-why-here');
			Object.assign(element, {
				expression: parseCollectionExpression(FILTERS),
				set,
				membership: membershipFor(set, cardID),
				tagInfos: TAG_INFOS,
				labels: {},
			});
			document.body.appendChild(element);
			await settle(element);
			return element;
		};

		const rows = (element) => Array.from(element.shadowRoot.querySelectorAll('button.row'));

		//A chip may live in its sentence's shadow root or, inside a group, in the
		//group's light DOM.
		//A group keeps its members in its own LIGHT DOM, but the group itself is
		//in the sentence's shadow root, so one query reaches every chip either
		//way — in sentence order, which is the order the reader sees.
		const chipsIn = (row) =>
			Array.from(row.querySelector('collection-sentence').shadowRoot.querySelectorAll('tag-chip'));

		const text = (node) => {
			let out = '';
			for (const child of node.childNodes) {
				if (child.nodeType === 3) { out += child.textContent; continue; }
				if (child.nodeType !== 1) continue;
				if (child.localName === 'style') continue;
				if (child.shadowRoot) out += text(child.shadowRoot);
				out += text(child);
			}
			return out;
		};
		const visible = (node) => text(node).replace(/\s+/g, ' ').trim();

		it('lays the conditions out one per row, under the panel’s own heading', async () => {
			const element = await mount('a');
			assert.strictEqual(element.shadowRoot.querySelector('h4').textContent, WHY_HERE_HEADING);
			assert.strictEqual(rows(element).length, 3, 'one row per condition, not one line of prose');
			assert.deepStrictEqual(rows(element).map(visible), ['Tag 1 or Tag 2', 'Starred', 'Unpublished']);
		});

		it('names the set as quiet text rather than as a fourth pill', async () => {
			const inSet = await mount('a');
			assert.strictEqual(visible(inSet.shadowRoot.querySelector('.set')), 'In Main');
			assert.strictEqual(inSet.shadowRoot.querySelector('.set tag-chip'), null);
			assert.strictEqual(inSet.shadowRoot.querySelector('.set').hasAttribute('data-fails'), false);

			const outOfSet = await mount('g');
			assert.strictEqual(visible(outOfSet.shadowRoot.querySelector('.set')), 'Not in Main');
			assert.strictEqual(outOfSet.shadowRoot.querySelector('.set').hasAttribute('data-fails'), true);
		});

		//THE VERDICT IS THE PILL'S OWN TREATMENT, not a mark beside it.
		it('dims the pills this card fails and leaves the rest alone', async () => {
			const element = await mount('a');
			const [group, starred, unpublished] = rows(element);
			assert.strictEqual(chipsIn(starred)[0].subtle, false, 'a passing clause is a normal pill');
			assert.strictEqual(chipsIn(unpublished)[0].subtle, true, 'a failing clause is tag-chip’s subtle state');
			//The one CSS fact behind that state, pinned against the registered
			//component rather than measured: jsdom computes no layout.
			assert.match(
				chipsIn(unpublished)[0].constructor.styles.map(sheet => String(sheet.cssText || '')).join('\n') +
					chipsIn(unpublished)[0].shadowRoot.querySelector('span').getAttribute('style'),
				/grayscale/,
				'the dim is a real filter, not a class nothing paints');
			assert.strictEqual(chipsIn(group).some(chip => chip.subtle), true);
		});

		it('lights the alternative that passes inside a group, and dims its sibling', async () => {
			const element = await mount('c');
			const [group] = rows(element);
			assert.deepStrictEqual(chipsIn(group).map(chip => chip.subtle), [true, false],
				'c is tagged 2, so the second alternative is the lit one');
			const container = group.querySelector('collection-sentence').shadowRoot.querySelector('tag-chip-group');
			assert.strictEqual(container.hasAttribute('data-fails'), false,
				'and the group itself passes, because one alternative does');
			assert.match(container.getAttribute('aria-label'), /this card matches/,
				'a dim nobody can see is not a verdict — the group says it in words too');
		});

		it('marks a group as failing only when every alternative fails', async () => {
			const element = await mount('d');
			const [group] = rows(element);
			assert.deepStrictEqual(chipsIn(group).map(chip => chip.subtle), [true, true]);
			const container = group.querySelector('collection-sentence').shadowRoot.querySelector('tag-chip-group');
			assert.strictEqual(container.hasAttribute('data-fails'), true);
			assert.match(container.getAttribute('aria-label'), /does not match/);
		});

		//A CARD THAT FAILS A CLAUSE CAN STILL BE THE CARD ON SCREEN.
		it('admits it when the card is not in the collection, and stays quiet when it is', async () => {
			const failing = await mount('a');
			assert.strictEqual(visible(failing.shadowRoot.querySelector('.note')),
				'Not in this collection — fails 1 of 3 conditions');

			const passing = await mount('e');
			assert.strictEqual(passing.shadowRoot.querySelector('.note'), null,
				'every pill lit says it better than a line repeating it');
		});

		it('opens the composer on the clause that was tapped', async () => {
			const element = await mount('a');
			const seen = [];
			element.addEventListener('condition-activated', (e) => seen.push(e.detail));
			rows(element)[2].click();
			assert.deepStrictEqual(seen, [{ index: 2, memberIndex: -1 }],
				'the row scopes to its condition, and says which one');
		});

		it('renders nothing at all when there is no card to judge, or no conditions', async () => {
			const element = document.createElement('collection-why-here');
			Object.assign(element, { expression: parseCollectionExpression(FILTERS), set: 'main', membership: null });
			document.body.appendChild(element);
			await settle(element);
			assert.strictEqual(visible(element.shadowRoot), '', 'no verdicts, no heading');

			element.membership = membershipFor('main', 'a');
			element.expression = [];
			await settle(element);
			assert.strictEqual(visible(element.shadowRoot), '', 'an unfiltered collection poses no question');
		});
	});

	//SUPERSEDED SECTION (owner: "default it to on, remove the flag").
	//
	//This was headed 'THE ONE COMPOSER SURFACE THAT SHIPPED UNGATED', and it
	//pinned the rollout gate that had been added to the why-here computation so
	//that a user who had never turned the composer on could not see an "In this
	//collection" account whose clauses tapped through to the legacy Configure
	//Collection dialog. There is no flag, no flag-off user and no legacy dialog:
	//the composer is the dialog, so the account is computed for everyone and the
	//tap-through lands where it always meant to.
	//
	//What survives unchanged is the substance the second pin carried — the rows
	//cannot strand anyone — plus its converse, now that the panel is universal.
	//The cost note survives too: the verdicts materialize a full filter set per
	//clause on the MAIN thread, a configurable clause scans the whole corpus to
	//do it, and the panel re-asks on the order of once a second while it is
	//open. Routing that through the corpus worker is still the real answer and
	//still a separate change — it is simply everyone's cost now.
	describe('the account, for everyone', () => {

		//A SOURCE PIN, because the fact is about which call sites exist rather
		//than about a value: the panel's own timeout is a debounced side effect
		//with a corpus behind it, and mounting one to observe an absence would
		//assert less than reading the line that causes it.
		it('computes the account with nothing to consult first', async () => {
			const {readFile} = await import('fs/promises');
			const source = await readFile(new URL('../../src/components/card-info-panel.ts', import.meta.url), 'utf8');
			assert.match(source, /const whyHere = selectWhyHereForActiveCard\(freshState\);/,
				'the why-here computation is unconditional');
			assert.ok(!/collection-composer-mode/.test(source),
				'and the module that owned the rollout flag is not imported — it does not exist');
		});

		//THE ROWS CANNOT STRAND ANYONE. With no membership there are no rows, so
		//there is nothing to tap through — the same absence the section already
		//renders for a card it cannot judge. (Unchanged in substance: this was
		//always a statement about an empty account, not about a flag.)
		it('offers no tap-through when there is no account to show', async () => {
			const element = document.createElement('collection-why-here');
			Object.assign(element, { expression: parseCollectionExpression(FILTERS), set: 'main', membership: null });
			document.body.appendChild(element);
			for (let round = 0; round < 4; round++) await element.updateComplete;
			assert.strictEqual(element.shadowRoot.querySelectorAll('button').length, 0,
				'no account, no clause to open');
		});
	});
});
