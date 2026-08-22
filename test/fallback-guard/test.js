/*eslint-env node, es2022*/

//WHAT A GUARD MAY CONCLUDE FROM A TRANSITIONAL COLLECTION (#767).
//
//During a worker cutover the active collection is a placeholder whose
//isFallback:false is a guess. The action-layer guards (stars, reading list,
//read marks, comments, auto-mark-read) used to act on the guess: on every
//navigation to an orphaned card the auto-read animation started and then
//no-oped, and a cutover outlasting the 5s timer would have committed the
//read-add the guard exists to prevent. These tests pin the shared awaitable
//guard those actions now run through, and the pure decision function the
//auto-read scheduler uses (which cannot await — its deferral rides the same
//timeout handle as the real timer so navigation cancels both).

import assert from 'assert';

let awaitInteractableCollection;
let autoMarkReadScheduleDecision;
let TRANSITIONAL_MAX_RECHECKS;

const CONCRETE = {isTransitional: false, isFallback: false};
const FALLBACK = {isTransitional: false, isFallback: true};
//The cutover placeholder: claims not-fallback while knowing nothing.
const TRANSITIONAL = {isTransitional: true, isFallback: false};

describe('awaitInteractableCollection (#767)', () => {

	before(async () => {
		({awaitInteractableCollection, autoMarkReadScheduleDecision, TRANSITIONAL_MAX_RECHECKS} =
			await import('../../lib/src/actions/fallback-guard.js'));
	});

	it('resolves immediately for a concrete collection, without a timer', async () => {
		let reads = 0;
		await awaitInteractableCollection(() => { reads++; return CONCRETE; });
		assert.strictEqual(reads, 1, 'one look must suffice — no re-check loop');
	});

	it('treats a missing collection as interactable, matching the old guards', async () => {
		await awaitInteractableCollection(() => null);
	});

	it('rejects on a concrete fallback collection', async () => {
		await assert.rejects(
			awaitInteractableCollection(() => FALLBACK),
			/fallback content/);
	});

	it('waits through a transition, then resolves once the collection is concrete', async () => {
		let reads = 0;
		//Transitional for two checks, then the worker result lands.
		await awaitInteractableCollection(() => (++reads <= 2 ? TRANSITIONAL : CONCRETE), 5);
		assert.strictEqual(reads, 3, 'must have re-checked until concrete');
	});

	it('waits through a transition and REFUSES when the truth is a fallback', async () => {
		//The orphan-navigation case: the placeholder said false, the truth is
		//true. Trusting the guess would have been the guarded-against write.
		let reads = 0;
		await assert.rejects(
			awaitInteractableCollection(() => (++reads <= 2 ? TRANSITIONAL : FALLBACK), 5),
			/fallback content/);
	});

	it('gives up with a rejection when the transition never resolves', async () => {
		await assert.rejects(
			awaitInteractableCollection(() => TRANSITIONAL, 5, 3),
			/still loading/);
	});
});

describe('autoMarkReadScheduleDecision (#767)', () => {

	it('schedules for a concrete, non-fallback collection (and for none at all)', () => {
		assert.strictEqual(autoMarkReadScheduleDecision(CONCRETE, 0), 'schedule');
		assert.strictEqual(autoMarkReadScheduleDecision(null, 0), 'schedule');
	});

	it('skips fallback content — the original guard, preserved', () => {
		assert.strictEqual(autoMarkReadScheduleDecision(FALLBACK, 0), 'skip');
	});

	it('defers on a transitional placeholder instead of trusting its guess', () => {
		assert.strictEqual(autoMarkReadScheduleDecision(TRANSITIONAL, 0), 'defer');
		assert.strictEqual(autoMarkReadScheduleDecision(TRANSITIONAL, TRANSITIONAL_MAX_RECHECKS - 1), 'defer');
	});

	it('gives up after the re-check bound rather than polling forever', () => {
		assert.strictEqual(autoMarkReadScheduleDecision(TRANSITIONAL, TRANSITIONAL_MAX_RECHECKS), 'give-up');
	});
});
