/*eslint-env node*/

//The card revision clock: the admission rule every holder of a card image
//applies, the write-guard mirror, and MultiBatchBase's injection of the
//revision bump. Node-only, against the compiled output. The Rules side is
//in test/security; the behavioural blank-card test is in
//test/card-create-executor.

import assert from 'assert';

let cardRevision;
let cardImageMayAdvance;
let admitCardImages;
let cardUpdateAdvancesRevision;
let callerRevisionViolation;
let MultiBatchBase;

describe('card revision', () => {
	before(async () => {
		({cardRevision, cardImageMayAdvance, admitCardImages} = await import('../../lib/shared/card-revision.js'));
		({cardUpdateAdvancesRevision, callerRevisionViolation} = await import('../../lib/shared/card-write-guard.js'));
		({MultiBatchBase} = await import('../../lib/shared/multi_batch.js'));
	});

	describe('admission', () => {
		it('reads a missing or junk revision as 0', () => {
			assert.strictEqual(cardRevision({}), 0);
			assert.strictEqual(cardRevision(null), 0);
			assert.strictEqual(cardRevision({revision: '7'}), 0);
			assert.strictEqual(cardRevision({revision: -1}), 0);
			assert.strictEqual(cardRevision({revision: 1.5}), 0);
			assert.strictEqual(cardRevision({revision: 7}), 7);
		});

		it('admits newer and equal images, refuses older ones, and admits anything when nothing is held', () => {
			assert.ok(cardImageMayAdvance({revision: 3}, {revision: 4}));
			assert.ok(cardImageMayAdvance({revision: 3}, {revision: 3}), 'equal: counters and the listener refresh of an echo');
			assert.ok(!cardImageMayAdvance({revision: 3}, {revision: 2}));
			assert.ok(!cardImageMayAdvance({revision: 1}, {}), 'a legacy image cannot replace a revisioned one');
			assert.ok(cardImageMayAdvance({}, {}), 'two legacy images: today\'s behaviour');
			assert.ok(cardImageMayAdvance(null, {revision: 1}));
			assert.ok(cardImageMayAdvance(undefined, {}));
		});

		it('splits a batch and returns the same object when nothing is refused', () => {
			const held = {a: {revision: 2}, b: {revision: 5}};
			const incoming = {a: {revision: 3}, b: {revision: 4}, c: {revision: 1}};
			const {admitted, refusedIDs} = admitCardImages(incoming, id => held[id]);
			assert.deepStrictEqual(refusedIDs, ['b']);
			assert.deepStrictEqual(Object.keys(admitted), ['a', 'c']);
			assert.strictEqual(admitted.a, incoming.a);
			const clean = admitCardImages({a: {revision: 9}}, id => held[id]);
			assert.deepStrictEqual(clean.refusedIDs, []);
			assert.strictEqual(clean.admitted, incoming === clean.admitted ? incoming : clean.admitted);
			const same = {a: {revision: 9}};
			assert.strictEqual(admitCardImages(same, id => held[id]).admitted, same, 'identity preserved when nothing is refused');
		});
	});

	describe('write guard', () => {
		it('treats only the inbound-reference mirror as revision-neutral', () => {
			assert.ok(!cardUpdateAdvancesRevision(['references_inbound', 'updated']));
			assert.ok(!cardUpdateAdvancesRevision(['references_inbound.c-1', 'references_info_inbound.c-1', 'updated']));
			assert.ok(cardUpdateAdvancesRevision(['body', 'updated']));
			assert.ok(cardUpdateAdvancesRevision(['tags', 'updated']));
			assert.ok(cardUpdateAdvancesRevision(['references_inbound', 'title', 'updated']));
			assert.ok(!cardUpdateAdvancesRevision([]), 'nothing written: nothing to advance');
		});

		it('refuses a caller-supplied revision on a card, not elsewhere', () => {
			assert.ok(callerRevisionViolation('cards/c-1', 'cards', ['body', 'revision']));
			assert.ok(callerRevisionViolation('cards/c-1', 'cards', ['revision.x']));
			assert.strictEqual(callerRevisionViolation('cards/c-1', 'cards', ['body', 'updated']), null);
			assert.strictEqual(callerRevisionViolation('sections/main', 'cards', ['revision']), null);
			assert.strictEqual(callerRevisionViolation('cards/c-1/updates/1', 'cards', ['revision']), null);
		});
	});

	describe('MultiBatchBase injection', () => {
		const SENTINEL = {__serverTimestamp: true};
		const INCREMENT = {__increment: 1};
		const ref = (path) => ({path});

		const makeBatch = (withGuard = true, effectiveBatchLimit) => {
			const writes = [];
			const config = {
				createBatch: () => ({writes: []}),
				batchSet: (batch, ref, data) => { writes.push({op: 'set', path: ref.path, data, batch}); },
				batchUpdate: (batch, ref, data) => { writes.push({op: 'update', path: ref.path, data, batch}); },
				batchDelete: (batch, ref) => { writes.push({op: 'delete', path: ref.path, batch}); },
				commitBatch: async () => {},
			};
			if (withGuard) {
				config.cardWriteGuard = {
					cardsCollection: 'cards',
					refPath: ref => ref.path,
					isServerTimestampValue: value => value === SENTINEL,
					revisionIncrement: () => INCREMENT,
				};
			}
			return {batch: new MultiBatchBase(config, effectiveBatchLimit), writes};
		};

		it('injects increment(1) once per card per batch, even when a card is written three times', () => {
			const {batch, writes} = makeBatch();
			//The mixed-tag multi-edit shape: three updates to one card in one
			//atomic group. The Rules judge the batch's FINAL state, so a bump
			//on each would read as +3 and be denied.
			batch.beginAtomicGroup('g');
			batch.update(ref('cards/c-1'), {body: 'x', updated: SENTINEL});
			batch.update(ref('cards/c-1'), {tags: ['t'], updated: SENTINEL});
			batch.update(ref('cards/c-1'), {title: 'y', updated: SENTINEL});
			batch.update(ref('cards/c-2'), {body: 'z', updated: SENTINEL});
			batch.endAtomicGroup();
			//Operations materialize into their real batch at commit.
			return batch.commit().then(() => {
				const bumps = writes.filter(write => write.data.revision === INCREMENT).map(write => write.path);
				assert.deepStrictEqual(bumps.sort(), ['cards/c-1', 'cards/c-2']);
				assert.strictEqual(writes.filter(write => write.path === 'cards/c-1').length, 3);
			});
		});

		it('bumps once per batch when a split fanout puts the same card in two batches', async () => {
			const {batch, writes} = makeBatch(true, 2);
			batch.update(ref('cards/c-1'), {body: 'a', updated: SENTINEL});
			batch.update(ref('cards/c-1'), {title: 'b', updated: SENTINEL});
			batch.update(ref('cards/c-1'), {notes: 'c', updated: SENTINEL});
			await batch.commit();
			const batches = new Set(writes.map(write => write.batch));
			assert.strictEqual(batches.size, 2, 'the limit of 2 splits three ops into two batches');
			for (const underlying of batches) {
				const bumped = writes.filter(write => write.batch === underlying && write.data.revision === INCREMENT);
				assert.strictEqual(bumped.length, 1, 'exactly one bump per underlying batch');
			}
		});

		it('does not bump the inbound-reference mirror, counters, or non-card writes', async () => {
			const {batch, writes} = makeBatch();
			batch.update(ref('cards/c-1'), {'references_inbound.c-2': true, 'references_info_inbound.c-2': {link: ''}, updated: SENTINEL});
			batch.updateWithoutTimestampBump(ref('cards/c-1'), {star_count: 2, star_count_manual: 2});
			batch.update(ref('sections/main'), {cards: ['c-1']});
			batch.set(ref('cards/c-1/updates/1'), {diff: {}});
			await batch.commit();
			assert.ok(writes.every(write => !('revision' in write.data)), JSON.stringify(writes.map(write => write.data)));
		});

		it('sets revision 1 on a card create and refuses a merge set', async () => {
			const {batch, writes} = makeBatch();
			batch.set(ref('cards/c-new'), {body: 'new', updated: SENTINEL});
			await batch.commit();
			assert.strictEqual(writes[0].data.revision, 1);
			assert.throws(() => batch.set(ref('cards/c-new'), {body: 'x', updated: SENTINEL}, {merge: true}), /with options is not supported/);
		});

		it('a create counts as the batch\'s bump: an update to the same new card injects no increment', async () => {
			//The Rules judge the batch's final state: revision 1 from the set
			//plus increment(1) would read as 2 and deny the create.
			const {batch, writes} = makeBatch();
			batch.beginAtomicGroup('create');
			batch.set(ref('cards/c-new'), {body: 'new', updated: SENTINEL});
			batch.update(ref('cards/c-new'), {title: 'titled', updated: SENTINEL});
			batch.update(ref('cards/c-other'), {body: 'x', updated: SENTINEL});
			batch.endAtomicGroup();
			await batch.commit();
			const byPath = Object.fromEntries(writes.map(write => [write.op + ' ' + write.path, write.data.revision]));
			assert.strictEqual(byPath['set cards/c-new'], 1);
			assert.strictEqual(byPath['update cards/c-new'], undefined);
			assert.strictEqual(byPath['update cards/c-other'], INCREMENT);
		});

		it('refuses a caller-supplied revision and queues nothing', () => {
			const {batch, writes} = makeBatch();
			assert.throws(() => batch.update(ref('cards/c-1'), {body: 'x', updated: SENTINEL, revision: 9}), /sets `revision` itself/);
			assert.throws(() => batch.set(ref('cards/c-1'), {body: 'x', updated: SENTINEL, revision: 1}), /sets `revision` itself/);
			assert.strictEqual(writes.length, 0);
		});

		it('a config without cardWriteGuard injects nothing', async () => {
			const {batch, writes} = makeBatch(false);
			batch.update(ref('cards/c-1'), {body: 'x'});
			batch.set(ref('cards/c-2'), {body: 'y'});
			await batch.commit();
			assert.ok(writes.every(write => !('revision' in write.data)));
		});
	});
});
