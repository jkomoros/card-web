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
	selectConcepts,
	selectFingerprintGenerator,
	selectSynonymMap,
	selectWorkerIDFMap,
} from './selectors.js';

import {
	timestampToMillis
} from './util.js';

import type {
	Card,
	ProcessedCard,
	State
} from './types.js';

const NUM_TERMS = 8;

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

//The date the finisher used was `updated`, which no longer survives: every
//inbound-link write bumps it and the cutover script bumps it once more, so
//every legacy note would show the cutover date. updated_substantive is the
//last content save (the drawer's "last activity"); created is the fallback
//for a never-saved card, and now for a card with neither.
export const displayTitleDate = (card : Card) : Date => {
	const millis = timestampToMillis(card.updated_substantive, NaN);
	if (Number.isFinite(millis)) return new Date(millis);
	const created = timestampToMillis(card.created, NaN);
	if (Number.isFinite(created)) return new Date(created);
	return new Date();
};

//One formatter, hoisted: toLocaleDateString constructs one per call (~35µs),
//and a cold drawer window renders ~250 date placeholders per pass.
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {month: 'numeric', day: 'numeric', year: '2-digit'});
export const displayTitleDateLabel = (card : Card) : string => DATE_FORMAT.format(displayTitleDate(card));

//The projection itself, uncached. The card must be the processed card (its
//normalized text, backported reference text and concept enrichment are what
//the finisher computed inline before fingerprinting).
export const generatedWorkingNotesTitle = (card : ProcessedCard, inputs : DisplayTitleInputs) : string => {
	const pretty = inputs.fingerprintForCardObj(card, ['body']).dedupedPrettyItemsFromCard();
	const terms = pretty.split(' ').filter(Boolean).slice(0, NUM_TERMS).join(' ');
	const date = displayTitleDateLabel(card);
	return terms ? `${date} ${terms}` : date;
};

const memo = new WeakMap<ProcessedCard, {inputs : DisplayTitleInputs, title : string}>();

//An authored title wins; a non-working-notes card without one has no
//display title (the drawer's own full-bleed fallback applies there).
export const displayTitle = (card : ProcessedCard, inputs : DisplayTitleInputs) : string => {
	if (card.title) return card.title;
	if (card.card_type !== 'working-notes') return '';
	const hit = memo.get(card);
	if (hit && hit.inputs === inputs) return hit.title;
	const title = generatedWorkingNotesTitle(card, inputs);
	memo.set(card, {inputs, title});
	return title;
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
			//A card computed since it was queued (within a later render's
			//budget, possibly under newer inputs) keeps that entry: recomputing
			//under the queued inputs would evict the newer one.
			if (memo.has(card)) continue;
			displayTitle(card, inputs);
		}
		for (const listener of listeners) listener();
		if (queue.length) scheduleDrain();
	}, 0);
};

export const displayTitleBudgeted = (card : ProcessedCard, inputs : DisplayTitleInputs) : string => {
	if (card.title) return card.title;
	if (card.card_type !== 'working-notes') return '';
	const hit = memo.get(card);
	if (hit && hit.inputs === inputs) return hit.title;
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
export const subscribeDisplayTitles = (listener : () => void) : (() => void) => {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
};

//For tests: how many cards are waiting for an idle slice.
export const pendingDisplayTitleCount = () : number => queue.length;
