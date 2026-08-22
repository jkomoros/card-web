/*eslint-env node, es2022*/

//WHAT THE ENQUEUE GATE IS ALLOWED TO HOLD BACK (#765).
//
//While a modification is pending, receiveCards parks listener deliveries in a
//queue so the operation's own echoes apply in one batch. The gate used to park
//EVERYTHING, keyed on a bare count — so a card created in the middle of a
//large bulk operation (thousands of targets) sat in the queue until the whole
//operation settled: pendingNewCardID never cleared, navigateToNewCard never
//fired, the editor never opened, and typing fell through to view-level
//shortcuts for the life of the operation. Found by the #763 adversarial
//review; #763 made the editor half work per-card, leaving this gate as the
//only thing still stranding a mid-bulk-op create.
//
//Since #763 the MODIFY_CARD action records its target IDs
//(pendingModificationCardIDs), so the gate can tell an echo from an unrelated
//arrival. These tests pin the partition: only the operation's own targets are
//gated; everything else — a fresh create, another client's edit — applies
//immediately. They also pin the staleness guard that partition makes
//necessary: a directly-applied card must evict any older copy of itself still
//parked in the queue (stranded by a failed earlier cycle), or the eventual
//flush would clobber the newer value.

import assert from 'assert';
import {bootstrapApp} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const {store} = app;

const {receiveCards} = await import('../../lib/src/actions/data.js');

//A minimal but complete-enough card for the diff/apply pipeline. Unique
//timestamps so deepEqualIgnoringTimestamps never confuses two of them.
let stampCounter = 1700000000;
const card = (id, overrides = {}) => ({
	id,
	name: id,
	card_type: 'working-notes',
	title: 'Title of ' + id,
	body: '<p>Body of ' + id + '</p>',
	section: '',
	slugs: [],
	tags: [],
	references: {},
	references_info: {},
	references_inbound: {},
	references_info_inbound: {},
	auto_todo_overrides: {},
	flags: {},
	published: false,
	created: {seconds: stampCounter++, nanoseconds: 0},
	updated: {seconds: stampCounter++, nanoseconds: 0},
	updated_substantive: {seconds: stampCounter++, nanoseconds: 0},
	updated_message: {seconds: stampCounter++, nanoseconds: 0},
	...overrides,
});

const data = () => store.getState().data;

const enqueuedIDs = () => {
	const result = [];
	for (const bucket of Object.values(data().enqueuedCards)) {
		result.push(...Object.keys(bucket));
	}
	return result.sort();
};

//NOTE: enqueueCardUpdates flushes the moment the parked count reaches
//modificationCount, so any test that wants an echo to STAY parked must use a
//modification of at least two cards and deliver only one.
const modifyCard = (cardIDs) => store.dispatch({
	type: 'MODIFY_CARD',
	modificationCount: cardIDs === undefined ? 2 : cardIDs.length,
	cardIDs,
});

describe('the enqueue gate partitions on the modification targets (#765)', () => {

	beforeEach(() => {
		//Settle any pending cycle and empty the queue so tests are independent.
		store.dispatch({type: 'MODIFY_CARD_SUCCESS', modificationCount: 0});
		store.dispatch({type: 'CLEAR_ENQUEUED_CARD_UPDATES'});
	});

	it('applies an untargeted arrival immediately while gating the target echo', () => {
		modifyCard(['gate-t1', 'gate-t2']);
		store.dispatch(receiveCards({
			'gate-n1': card('gate-n1'),
			'gate-t1': card('gate-t1', {title: 'echo of t1'}),
		}, 'unpublished'));
		assert.ok(data().cards['gate-n1'], 'the untargeted card must apply immediately');
		assert.ok(!data().cards['gate-t1'], 'the target echo must stay gated');
		assert.deepStrictEqual(enqueuedIDs(), ['gate-t1'], 'only the target may be parked');
	});

	it('an immediately-applied create clears pendingNewCardID mid-operation', () => {
		//This is the exact #765 symptom chain: pendingNewCardID clearing is
		//what lets the loaded/navigate machinery open the new card's editor.
		store.dispatch({type: 'EXPECT_NEW_CARD', ID: 'gate-n2', cardType: 'working-notes', navigate: false});
		modifyCard(['gate-t1', 'gate-t2']);
		store.dispatch(receiveCards({'gate-n2': card('gate-n2')}, 'unpublished'));
		assert.ok(data().cards['gate-n2'], 'the created card must apply mid-operation');
		assert.strictEqual(data().pendingNewCardID, '', 'the arrival must satisfy the expected-new-card wait');
	});

	it('a pending modification with no recorded targets still gates everything', () => {
		//Legacy dispatch shapes carry no cardIDs; the fallback must match
		//selectCardModificationPendingForCard and keep the old global gate.
		modifyCard(undefined);
		store.dispatch(receiveCards({'gate-n3': card('gate-n3')}, 'unpublished'));
		assert.ok(!data().cards['gate-n3'], 'with no target set every arrival must gate');
		assert.deepStrictEqual(enqueuedIDs(), ['gate-n3']);
	});

	it('gated echoes still flush when the modification settles', () => {
		modifyCard(['gate-t4a', 'gate-t4b']);
		store.dispatch(receiveCards({'gate-t4a': card('gate-t4a', {title: 'echo of t4a'})}, 'unpublished'));
		assert.ok(!data().cards['gate-t4a'], 'parked while pending');
		store.dispatch({type: 'MODIFY_CARD_SUCCESS', modificationCount: 2});
		//The next delivery on the direct-apply path flushes stranded leftovers
		//first (they are older), then applies itself.
		store.dispatch(receiveCards({'gate-n4': card('gate-n4')}, 'unpublished'));
		assert.strictEqual(data().cards['gate-t4a'].title, 'echo of t4a', 'the parked echo must flush');
		assert.ok(data().cards['gate-n4']);
		assert.deepStrictEqual(enqueuedIDs(), [], 'the queue must be empty after the flush');
	});

	it('a fully-deduped delivery mid-operation still clears its loading flag', () => {
		//Some fetches deliberately signal "done loading" with a delivery whose
		//cards all dedupe away (or an outright empty one). The partition must
		//not swallow that: an empty UPDATE_CARDS is what clears the flag.
		store.dispatch(receiveCards({'gate-d6': card('gate-d6', {title: 'settled'})}, 'unpublished'));
		modifyCard(['gate-t6a', 'gate-t6b']);
		store.dispatch({type: 'EXPECT_FETCHED_CARDS', fetchType: 'unpublished'});
		assert.strictEqual(data().loadingCardFetchTypes['unpublished'], true);
		//Redeliver the identical card: dedupe empties the batch entirely.
		store.dispatch(receiveCards({'gate-d6': {...data().cards['gate-d6']}}, 'unpublished'));
		assert.strictEqual(data().loadingCardFetchTypes['unpublished'], undefined,
			'the deduped-empty delivery must still clear the loading flag');
		assert.deepStrictEqual(enqueuedIDs(), [], 'nothing may be parked by an empty delivery');
	});

	it('a newer direct-applied card evicts its stale parked copy, so the flush cannot clobber it', () => {
		//Cycle A parks an echo of x5, then fails, stranding it in the queue.
		modifyCard(['gate-x5', 'gate-w5']);
		store.dispatch(receiveCards({'gate-x5': card('gate-x5', {title: 'stale v1'})}, 'unpublished'));
		store.dispatch({type: 'MODIFY_CARD_FAILURE', error: new Error('harness-induced failure')});
		assert.deepStrictEqual(enqueuedIDs(), ['gate-x5'], 'the failed cycle strands its echo');
		//Cycle B targets other cards; a NEWER x5 arrives from elsewhere and
		//applies immediately.
		modifyCard(['gate-y5a', 'gate-y5b']);
		store.dispatch(receiveCards({'gate-x5': card('gate-x5', {title: 'newer v2'})}, 'unpublished'));
		assert.strictEqual(data().cards['gate-x5'].title, 'newer v2');
		assert.deepStrictEqual(enqueuedIDs(), [], 'the stale parked copy must be evicted');
		//Settle cycle B and force a flush: the stale v1 must NOT reappear.
		store.dispatch({type: 'MODIFY_CARD_SUCCESS', modificationCount: 2});
		store.dispatch(receiveCards({'gate-q5': card('gate-q5')}, 'unpublished'));
		assert.strictEqual(data().cards['gate-x5'].title, 'newer v2', 'the flush must not clobber the newer value');
	});
});
