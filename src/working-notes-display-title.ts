//The dated summary a working-notes card shows when its author left the title
//empty: "<m/d/yy> <up to eight fingerprint terms from the body>". Until
//slice 5 a finisher WROTE this into the shared cards/*.title on every save —
//ranked by the viewer's IDF over the viewer's corpus, unpublished cards
//included, so one viewer's private vocabulary leaked into a shared field.
//It is a display-only projection now, computed for the viewer from the
//viewer's own inputs, and it never reaches a card object or a write path:
//test/working-notes-display-title pins that no module under src/actions,
//src/worker, the diff/batch/queue layers or functions/ imports this one.
//
//Memoized on the ProcessedCard object: incremental reducers keep the identity
//of unchanged cards and every new image is a new object, so a hit costs a
//WeakMap lookup and nothing is recomputed on an unrelated save. The inputs
//(IDF map, concepts, synonyms) change identity on an IDF epoch, the first
//epoch, or a concept/synonym change — not per save.

import {
	createSelector
} from 'reselect';

import {
	FingerprintGenerator,
} from './nlp.js';

import {
	displayTitleDate,
	displayTitleDateLabel,
	displayTitleKey,
	generatedWorkingNotesTitle as kernelTitle
} from './working-notes-title-kernel.js';

export {displayTitleDate, displayTitleDateLabel, displayTitleKey};

import {
	selectConcepts,
	selectFingerprintGenerator,
	selectSynonymMap,
	selectWorkerIDFMap,
} from './selectors.js';

import type {
	CardMetas,
	ProcessedCard,
	State
} from './types.js';

//The generator is the memo key: one object per (idfMap, concepts, synonyms)
//identity. In worker modes the IDF map is the worker's per-epoch map (or
//the pending sentinel before the first epoch), so this is stable across
//saves. Off mode has no worker map: the main generator, which built IDF
//over the corpus itself, is used instead; it changes identity per save,
//so titles recompute per save there — off mode is the small-corpus
//fallback and that is what it cost before too.
//Built on first use, not at module load: this module is reached from
//components that selectors.ts's own import graph pulls in, so composing
//its selectors at evaluation time hits them before they are initialized.
let selectDisplayTitleGenerator : ((state : State) => FingerprintGenerator | null) | null = null;
const displayTitleGeneratorSelector = () => {
	if (!selectDisplayTitleGenerator) {
		selectDisplayTitleGenerator = createSelector(
			selectWorkerIDFMap,
			selectConcepts,
			selectSynonymMap,
			(idfMap, concepts, synonyms) => idfMap ? new FingerprintGenerator(undefined, undefined, undefined, idfMap, concepts, synonyms) : null
		);
	}
	return selectDisplayTitleGenerator;
};

export type DisplayTitleInputs = FingerprintGenerator;

export const selectDisplayTitleInputs = (state : State) : DisplayTitleInputs => displayTitleGeneratorSelector()(state) || selectFingerprintGenerator(state);

//FROZEN per card object: a title, once computed, is never recomputed for
//an IDF epoch or a concept edit — only a new image of the card (a new
//object, after a save) gets a new one. That is what the owner asked for
//(titles should change very rarely; stale is fine), and it is also what
//the worker's cache does, keyed on the card's substantive-update time. This
//main-thread path is the fallback for a card whose meta carries no title
//yet; the worker's title wins whenever present (displayTitleWithMeta).
const memo = new WeakMap<ProcessedCard, string>();

//The projection itself, uncached, over the main thread's inputs.
export const generatedWorkingNotesTitle = (card : ProcessedCard, inputs : DisplayTitleInputs) : string => kernelTitle(card, inputs);

//An authored title wins; a non-working-notes card without one has no
//display title (the drawer's own full-bleed fallback applies there).
export const displayTitle = (card : ProcessedCard, inputs : DisplayTitleInputs) : string => {
	if (card.title) return card.title;
	if (card.card_type !== 'working-notes') return '';
	const hit = memo.get(card);
	if (hit !== undefined) return hit;
	const title = generatedWorkingNotesTitle(card, inputs);
	memo.set(card, title);
	return title;
};

//What every consumer should call: the worker's frozen title from the compact
//meta when it has one, else the main-thread fallback.
export const displayTitleWithMeta = (card : ProcessedCard, metas : CardMetas | null | undefined, inputs : DisplayTitleInputs) : string => {
	if (card.title) return card.title;
	if (card.card_type !== 'working-notes') return '';
	const meta = metas ? metas[card.id] : undefined;
	if (meta && meta.displayTitle) return meta.displayTitle;
	return displayTitle(card, inputs);
};

//A cold drawer window (250 rows at 47k, ~1.5ms each) would be a ~350ms
//render. The budgeted variant computes misses synchronously while the
//current render's budget lasts, then returns the date alone (HOUSE-STYLE
//§3.6: a loading placeholder, not wrong content) and queues the rest to be
//filled in idle slices; subscribers are told when a slice lands so they can
//re-render, at which point the queued cards are memo hits.
const BUDGET_MS = 8;
let budgetDeadline = 0;
const queue : {card : ProcessedCard, inputs : DisplayTitleInputs}[] = [];
const queued = new WeakSet<ProcessedCard>();
const listeners = new Set<() => void>();
let drainScheduled = false;

//Call once at the start of a render that will ask for budgeted titles.
export const beginDisplayTitleBudget = (now = performance.now()) : void => {
	budgetDeadline = now + BUDGET_MS;
};

const scheduleDrain = () => {
	if (drainScheduled) return;
	drainScheduled = true;
	setTimeout(() => {
		drainScheduled = false;
		const deadline = performance.now() + BUDGET_MS;
		while (queue.length && performance.now() < deadline) {
			const {card, inputs} = queue.shift() as {card : ProcessedCard, inputs : DisplayTitleInputs};
			queued.delete(card);
			//Computed since it was queued (within a later render's budget):
			//the frozen entry stands.
			if (memo.has(card)) continue;
			displayTitle(card, inputs);
		}
		for (const listener of listeners) listener();
		if (queue.length) scheduleDrain();
	}, 0);
};

export const displayTitleBudgeted = (card : ProcessedCard, inputs : DisplayTitleInputs, metas? : CardMetas | null) : string => {
	if (card.title) return card.title;
	if (card.card_type !== 'working-notes') return '';
	const meta = metas ? metas[card.id] : undefined;
	if (meta && meta.displayTitle) return meta.displayTitle;
	const hit = memo.get(card);
	if (hit !== undefined) return hit;
	if (performance.now() < budgetDeadline) return displayTitle(card, inputs);
	if (!queued.has(card)) {
		queued.add(card);
		queue.push({card, inputs});
		scheduleDrain();
	}
	return displayTitleDateLabel(card);
};

//Subscribers are re-rendered after each drained slice. Returns the
//unsubscribe.
//The web view's node label: the same title the list shows (budgeted the
//same way, with the date alone as the placeholder), falling back to the id
//for a card with neither an authored nor a display title — the Collection's
//own WebInfo rule, so a card missing from the store keeps the label the
//collection computed.
export const graphNodeName = (card : ProcessedCard, metas : CardMetas | null | undefined, inputs : DisplayTitleInputs) : string => {
	return displayTitleBudgeted(card, inputs, metas) || card.id;
};

export const subscribeDisplayTitles = (listener : () => void) : (() => void) => {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
};

//For tests: how many cards are waiting for an idle slice.
export const pendingDisplayTitleCount = () : number => queue.length;
