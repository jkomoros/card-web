/*eslint-env node, es2022*/

//generateCardDiff MUST NOT MUTATE THE CARDS IT IS HANDED.
//
//It used to. `references(updatedCard).setLinks(linkInfo)` replaces the
//references_info and references properties on the object it is given, and
//generateCardDiff called it directly on its second argument. That argument is
//almost always live redux state: selectEditingCardHasUnsavedChanges runs the
//diff over state.editor.card from inside a createSelector, and
//selectEditingUnderlyingCardSnapshotDiff runs it over the corpus card in
//state.data.cards. The every-keystroke dirty check in edit-draft.ts goes down
//the same path. So a memoized derivation was writing into the store on every
//dirty check. Nothing broke visibly only because the store is a plain
//createStore with no immutability middleware — which is exactly the kind of
//accident that stops being invisible the moment anyone adds freezing, or
//relies on structural sharing to decide something did not change (#771).
//
//These tests pin the property behaviorally rather than by reading the source:
//deep-frozen inputs must survive the call (a mutation throws in module strict
//mode), unfrozen inputs must come back deep-equal AND identical by reference
//in their reference maps, and the diff must be byte-identical either way. The
//link cases matter most, because the setLinks path only runs when an html
//field changed — a non-mutation test over cards with no body edit would pass
//against the buggy code.

import {
	JSDOM
} from 'jsdom';

import assert from 'assert';

const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

//jsdom does not implement innerText, and extractCardLinksFromBody reads it to
//get each link's text. Without this the extracted values are undefined, which
//makes the references block illegal and setLinks throws — i.e. the link path
//we specifically want to exercise would never run. textContent is the closest
//honest stand-in for the flat markup these tests use.
Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
	get() {
		return this.textContent;
	},
	configurable: true
});

after(() => {
	dom.window.close();
	//Importing card_diff pulls in Firebase's Node transport, which keeps a
	//MessagePort referenced even though this pure suite never uses it. Unref
	//only that transport handle so the full npm test chain exits.
	for (const handle of process._getActiveHandles()) {
		if (handle.constructor?.name === 'MessagePort' && typeof handle.unref === 'function') handle.unref();
	}
});

let generateCardDiff;
let overshadowedDiffChanges;

const makeCard = (id, extras = {}) => ({
	id,
	card_type: 'content',
	title: 'Title of ' + id,
	subtitle: '',
	commentary: '',
	title_alternates: '',
	external_link: '',
	body: '<p>Body of ' + id + '</p>',
	section: 'main',
	name: id,
	slugs: [],
	tags: [],
	references: {},
	references_info: {},
	references_inbound: {},
	references_info_inbound: {},
	notes: '',
	todo: '',
	auto_todo_overrides: {},
	permissions: {},
	collaborators: [],
	flags: {},
	published: true,
	full_bleed: false,
	sort_order: 1,
	images: [],
	font_size_boost: {},
	...extras
});

//A card whose body contains a card-link to each of the given ids, and whose
//stored reference block already reflects them — i.e. a card in the consistent
//state the commit path leaves cards in.
const cardLinkingTo = (id, linkedIDs, extras = {}) => {
	const links = linkedIDs.map(linked => `<card-link card="${linked}">${linked} text</card-link>`).join(' ');
	return makeCard(id, {
		body: `<p>Body of ${id} ${links}</p>`,
		references: Object.fromEntries(linkedIDs.map(linked => [linked, true])),
		references_info: Object.fromEntries(linkedIDs.map(linked => [linked, {link: `${linked} text`}])),
		...extras
	});
};

const deepFreeze = (value, seen = new Set()) => {
	if (!value || typeof value !== 'object') return value;
	if (seen.has(value)) return value;
	seen.add(value);
	for (const inner of Object.values(value)) deepFreeze(inner, seen);
	return Object.freeze(value);
};

const clone = (value) => JSON.parse(JSON.stringify(value));

describe('generateCardDiff does not mutate its arguments', () => {

	before(async () => {
		({generateCardDiff, overshadowedDiffChanges} = await import('../../lib/src/card_diff.js'));
	});

	it('leaves both cards deep-equal, and their reference maps identical by reference, after a body edit that changes links', () => {
		const underlying = cardLinkingTo('card-a', ['card-b']);
		const updated = cardLinkingTo('card-a', ['card-b']);
		//The edit that makes the setLinks path run: a new link in the body that
		//the stored reference block does not know about yet.
		updated.body = '<p>Body of card-a <card-link card="card-b">card-b text</card-link> <card-link card="card-c">card-c text</card-link></p>';

		const underlyingBefore = clone(underlying);
		const updatedBefore = clone(updated);
		const updatedReferences = updated.references;
		const updatedReferencesInfo = updated.references_info;
		const updatedReferencesInfoInner = updated.references_info['card-b'];

		const diff = generateCardDiff(underlying, updated);

		assert.deepStrictEqual(underlying, underlyingBefore, 'the underlying card was modified');
		assert.deepStrictEqual(updated, updatedBefore, 'the updated card was modified');
		//deepStrictEqual would still pass if setLinks swapped in a fresh but
		//equal map. It does not swap in an equal map here (the whole point is
		//that the links changed), but pin identity anyway: a memoized selector
		//handing back a card with a new references_info object is a change even
		//when the contents happen to match.
		assert.strictEqual(updated.references, updatedReferences, 'references was replaced on the input card');
		assert.strictEqual(updated.references_info, updatedReferencesInfo, 'references_info was replaced on the input card');
		assert.strictEqual(updated.references_info['card-b'], updatedReferencesInfoInner, 'a references_info entry was replaced on the input card');

		//And the diff still saw the new link.
		assert.deepStrictEqual(diff.references_diff, [{cardID: 'card-c', referenceType: 'link', value: 'card-c text'}]);
	});

	it('runs against deep-frozen cards and produces the same diff as against unfrozen ones', () => {
		const makeInputs = () => {
			const underlying = cardLinkingTo('card-a', ['card-b']);
			const updated = cardLinkingTo('card-a', ['card-b']);
			updated.title = 'A new title';
			updated.body = '<p>Body of card-a <card-link card="card-c">card-c text</card-link></p>';
			updated.tags = ['tag-one'];
			updated.published = false;
			return [underlying, updated];
		};

		const [warmUnderlying, warmUpdated] = makeInputs();
		const expected = generateCardDiff(warmUnderlying, warmUpdated);

		const [frozenUnderlying, frozenUpdated] = makeInputs();
		deepFreeze(frozenUnderlying);
		deepFreeze(frozenUpdated);

		//If anything in the diff path writes to either card this throws, since
		//module code is strict mode.
		const frozenDiff = generateCardDiff(frozenUnderlying, frozenUpdated);

		assert.deepStrictEqual(frozenDiff, expected, 'the frozen-input diff differs from the unfrozen-input diff');
	});

	it('is repeatable: diffing the same pair twice gives the same answer', () => {
		//The old mutation made the second call see a card the first call had
		//rewritten. With well-formed inputs that was idempotent, but only by
		//luck; pin that repeated calls agree now that nothing is carried over.
		const underlying = cardLinkingTo('card-a', ['card-b']);
		const updated = cardLinkingTo('card-a', ['card-b']);
		updated.body = '<p>Body of card-a <card-link card="card-c">card-c text</card-link></p>';

		const first = generateCardDiff(underlying, updated);
		const second = generateCardDiff(underlying, updated);
		assert.deepStrictEqual(second, first);
	});

	it('does not mutate through overshadowedDiffChanges, which chains two diffs over the same card', () => {
		//This is where the old mutation was observable BETWEEN calls: the
		//middle card is the `updated` argument of the first diff and the
		//`underlying` argument of the second, so the first call's rewrite of
		//its reference block fed straight into the second call's comparison.
		const original = cardLinkingTo('card-a', ['card-b'], {section: 'section-a'});
		const snapshot = cardLinkingTo('card-a', ['card-b'], {section: 'section-b'});
		//The body edits are what make the setLinks path run on each hop, which
		//is what made the middle card get rewritten.
		snapshot.body = '<p>Body of card-a <card-link card="card-b">card-b text</card-link> extra</p>';
		const current = cardLinkingTo('card-a', ['card-b'], {section: 'section-c'});
		current.body = '<p>Body of card-a <card-link card="card-b">card-b text</card-link> extra and more</p>';

		deepFreeze(original);
		deepFreeze(snapshot);
		deepFreeze(current);

		const diff = overshadowedDiffChanges(original, snapshot, current);
		//section changed in both hops, so it is overshadowed; body changed in
		//both too but is on the non-automatic-merge list, so it must not appear.
		assert.deepStrictEqual(diff, {section: 'section-c'});
	});
});

describe('generateCardDiff still gets link references right', () => {

	before(async () => {
		({generateCardDiff} = await import('../../lib/src/card_diff.js'));
	});

	it('reports a link added by the body edit', () => {
		const underlying = makeCard('card-a');
		const updated = makeCard('card-a', {
			body: '<p>Body of card-a <card-link card="card-b">to bee</card-link></p>'
		});
		const diff = generateCardDiff(underlying, updated);
		assert.deepStrictEqual(diff.references_diff, [{cardID: 'card-b', referenceType: 'link', value: 'to bee'}]);
	});

	it('reports a link removed by the body edit', () => {
		const underlying = cardLinkingTo('card-a', ['card-b']);
		const updated = makeCard('card-a', {
			//Same stored reference block as underlying, but the body no longer
			//mentions the link, so re-extraction must delete it.
			body: '<p>Body of card-a with the link taken out</p>',
			references: {'card-b': true},
			references_info: {'card-b': {link: 'card-b text'}}
		});
		const diff = generateCardDiff(underlying, updated);
		assert.deepStrictEqual(diff.references_diff, [{cardID: 'card-b', referenceType: 'link', delete: true}]);
	});

	it('re-extraction replaces only link references, leaving other reference types alone', () => {
		const underlying = makeCard('card-a', {
			references: {'card-b': true},
			references_info: {'card-b': {ack: ''}}
		});
		const updated = makeCard('card-a', {
			body: '<p>Body of card-a <card-link card="card-c">see</card-link></p>',
			references: {'card-b': true},
			references_info: {'card-b': {ack: ''}}
		});
		const diff = generateCardDiff(underlying, updated);
		assert.deepStrictEqual(diff.references_diff, [{cardID: 'card-c', referenceType: 'link', value: 'see'}]);
	});

	it('reports no references_diff when the body edit does not change the links', () => {
		const underlying = cardLinkingTo('card-a', ['card-b']);
		const updated = cardLinkingTo('card-a', ['card-b']);
		updated.body = updated.body.replace('Body of card-a', 'Body of card-a, revised');
		const diff = generateCardDiff(underlying, updated);
		assert.strictEqual(diff.references_diff, undefined);
		assert.ok(diff.body, 'the body change should still be in the diff');
	});
});
