/*eslint-env node, es2022*/

//WHAT A DEAD CORPUS GENERATION MAY KEEP ALIVE (#768).
//
//After sign-out the state rebuilds, but three module-level strong retainers
//used to pin the LAST generation's full cards map until organically
//displaced: reference_blocks' workerExpansionMemo (8 entries, each holding
//args), its memoized primary-blocks trio, and selectors'
//_previousActiveCollection. The first two are now WeakMap-keyed on the
//CollectionConstructorArguments identity — args objects are minted fresh by
//createSelector per generation, so a dropped generation's entries become
//collectable the moment reselect lets go of the old args. These tests
//verify that with the real GC (mocha --v8-expose-gc): a dead generation's
//args and cards map become unreachable while a live generation's survive.
//_previousActiveCollection cannot be weak-keyed (its purpose is handing the
//previous generation's collection to the next build), so it is released
//eagerly by the sign-in/sign-out flow instead — that wiring lives in
//actions/user.ts, outside what this suite can cheaply mount.

import assert from 'assert';

let expandReferenceBlocksViaRunner;
let getExpandedPrimaryReferenceBlocksForCard;
let CollectionDescription;

//Settle enough turns for finalization; three gc passes is the standard
//incantation for WeakRef determinism in V8.
const gcNow = async () => {
	for (let i = 0; i < 3; i++) {
		global.gc();
		await new Promise(resolve => setImmediate(resolve));
	}
};

const card = (id) => ({id, card_type: 'working-notes', title: 'Card ' + id});

//Args are only identity-keyed by the memos on these light paths; the cards
//map inside is the payload whose retention we care about.
const argsFor = (cards) => ({cards, filters: {}, sets: {}, sections: {}});

const workerResult = () => ({ids: [], labels: [], numCards: 0, numStartCards: 0, isFallback: false, preview: false, partialMatches: {}});

describe('corpus retainers (#768)', () => {

	before(async function() {
		this.timeout(20000);
		assert.strictEqual(typeof global.gc, 'function',
			'this suite must run under --v8-expose-gc (see package.json script)');
		({expandReferenceBlocksViaRunner, getExpandedPrimaryReferenceBlocksForCard} =
			await import('../../lib/src/reference_blocks.js'));
		({CollectionDescription} = await import('../../lib/src/collection_description.js'));
	});

	const makeBlock = (filterName) => ({
		collectionDescription: new CollectionDescription('everything', [filterName]),
		title: 'probe block',
	});

	describe('expandReferenceBlocksViaRunner memo', () => {

		it('hits on an identical request within one generation', async () => {
			const args = argsFor({'c-hit': card('c-hit')});
			const editable = {};
			const runner = () => Promise.resolve(workerResult());
			const probe = card('c-hit');
			const first = expandReferenceBlocksViaRunner(probe, [makeBlock('unstarred')], args, editable, runner);
			const second = expandReferenceBlocksViaRunner(probe, [makeBlock('unstarred')], args, editable, runner);
			assert.strictEqual(first, second, 'same generation + same request must share one promise');
			await first;
		});

		it('keeps the 8-entry LRU per generation', async () => {
			const args = argsFor({'c-lru': card('c-lru')});
			const editable = {};
			const runner = () => Promise.resolve(workerResult());
			const probe = card('c-lru');
			const filters = ['unstarred', 'starred', 'read', 'unread', 'everything', 'published', 'unpublished', 'orphaned', 'has-content'];
			const first = expandReferenceBlocksViaRunner(probe, [makeBlock(filters[0])], args, editable, runner);
			for (const name of filters.slice(1)) {
				await expandReferenceBlocksViaRunner(probe, [makeBlock(name)], args, editable, runner);
			}
			//9 distinct requests through an 8-entry LRU: the first is evicted.
			const again = expandReferenceBlocksViaRunner(probe, [makeBlock(filters[0])], args, editable, runner);
			assert.notStrictEqual(first, again, 'the oldest entry must have been evicted');
			await again;
		});

		it('a null resolution (worker teardown) evicts its entry', async () => {
			const args = argsFor({'c-null': card('c-null')});
			const editable = {};
			const runner = () => Promise.resolve(null);
			const probe = card('c-null');
			const first = expandReferenceBlocksViaRunner(probe, [makeBlock('unstarred')], args, editable, runner);
			assert.strictEqual(await first, null);
			const second = expandReferenceBlocksViaRunner(probe, [makeBlock('unstarred')], args, editable, runner);
			assert.notStrictEqual(first, second, 'a failed run must not be served from the memo');
			await second;
		});

		it('releases a dead generation entirely, while a live one survives', async function() {
			this.timeout(20000);
			const editable = {};
			const runner = () => Promise.resolve(workerResult());
			let deadCards = {'c-dead': card('c-dead')};
			let deadArgs = argsFor(deadCards);
			const liveCards = {'c-live': card('c-live')};
			const liveArgs = argsFor(liveCards);
			const liveProbe = card('c-live');
			await expandReferenceBlocksViaRunner(card('c-dead'), [makeBlock('unstarred')], deadArgs, editable, runner);
			await expandReferenceBlocksViaRunner(liveProbe, [makeBlock('unstarred')], liveArgs, editable, runner);
			const deadArgsRef = new WeakRef(deadArgs);
			const deadCardsRef = new WeakRef(deadCards);
			//The sign-out analogue: nothing outside the memo references the
			//old generation any more.
			deadArgs = null;
			deadCards = null;
			await gcNow();
			assert.strictEqual(deadArgsRef.deref(), undefined,
				'a dropped generation\'s args must be collectable — the memo may not pin it');
			assert.strictEqual(deadCardsRef.deref(), undefined,
				'a dropped generation\'s cards map must be collectable');
			//And the live generation still hits, proving the release was
			//per-generation rather than a global wipe.
			//One probe object: card identity is part of the memo key.
			const first = expandReferenceBlocksViaRunner(liveProbe, [makeBlock('starred')], liveArgs, editable, runner);
			const second = expandReferenceBlocksViaRunner(liveProbe, [makeBlock('starred')], liveArgs, editable, runner);
			assert.strictEqual(first, second);
			await first;
		});
	});

	describe('getExpandedPrimaryReferenceBlocksForCard memo', () => {

		it('releases a dead generation, while a live one survives', async function() {
			this.timeout(20000);
			//working-notes has no primary reference blocks, so this exercises
			//the memo bookkeeping without the expansion machinery.
			let deadCards = {'p-dead': card('p-dead')};
			let deadArgs = argsFor(deadCards);
			const liveArgs = argsFor({'p-live': card('p-live')});
			getExpandedPrimaryReferenceBlocksForCard(deadArgs, card('p-dead'), {});
			getExpandedPrimaryReferenceBlocksForCard(liveArgs, card('p-live'), {});
			const deadArgsRef = new WeakRef(deadArgs);
			const deadCardsRef = new WeakRef(deadCards);
			const liveArgsRef = new WeakRef(liveArgs);
			deadArgs = null;
			deadCards = null;
			await gcNow();
			assert.strictEqual(deadArgsRef.deref(), undefined, 'dead generation args must be collectable');
			assert.strictEqual(deadCardsRef.deref(), undefined, 'dead generation cards must be collectable');
			assert.notStrictEqual(liveArgsRef.deref(), undefined, 'the live generation must survive');
		});

		it('replacing the editable map releases the one it replaced', async function() {
			this.timeout(20000);
			const args = argsFor({'p-ed': card('p-ed')});
			let oldEditable = {'p-ed': true};
			const oldEditableRef = new WeakRef(oldEditable);
			getExpandedPrimaryReferenceBlocksForCard(args, card('p-ed'), oldEditable);
			//Same generation, new editable map: the memo entry is replaced.
			getExpandedPrimaryReferenceBlocksForCard(args, card('p-ed'), {'p-ed': false});
			oldEditable = null;
			await gcNow();
			assert.strictEqual(oldEditableRef.deref(), undefined,
				'a replaced editable map must not stay pinned by the memo');
		});
	});
});
