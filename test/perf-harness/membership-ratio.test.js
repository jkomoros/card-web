/*eslint-env node, es2022*/

//The design doc's slice-3 gate (docs/lean-architecture/03-worker-update-path.md
//§1.6): against master's plain-map filter algorithm, a one-card
//UPDATE_CARDS onto a primed 12k-card collection must cost at most 0.1x and
//the prime itself at most 1.1x. Master's algorithm is inlined here (it no
//longer exists in src) so the ratio is measured in one process on one
//machine: CI load moves both sides together. Medians, since single runs
//are noisy.

import assert from 'assert';
import {generateCorpus} from './gen-corpus.js';

const collectionReducer = (await import('../../lib/src/reducers/collection.js')).default;
const {CARD_FILTER_FUNCS, INITIAL_STATE} = await import('../../lib/src/filters.js');
const {UPDATE_CARDS} = await import('../../lib/src/actions.js');

const filterFuncs = Object.entries(CARD_FILTER_FUNCS).map(([name, {func}]) => [name, func]);

//master@8f56ea89 src/reducers/collection.ts makeFilterFromCards, verbatim in
//behaviour: card-major prime into fresh plain maps when every prior map is
//empty, otherwise per-filter add/remove lists and a full copy of each
//changed map.
const masterMakeFilterFromCards = (cards, previousFilters) => {
	const result = {};
	const cardValues = Object.values(cards);
	if (cardValues.length >= 1000 && filterFuncs.every(([name]) => Object.keys(previousFilters[name] || {}).length === 0)) {
		for (const [name] of filterFuncs) result[name] = {};
		for (const card of cardValues) {
			for (const [name, func] of filterFuncs) {
				if (func(card)) result[name][card.id] = true;
			}
		}
		return result;
	}
	for (const [filterName, func] of filterFuncs) {
		const previous = previousFilters[filterName] || {};
		let toAdd = null;
		let toRemove = null;
		for (const card of cardValues) {
			const matches = Boolean(func(card));
			const inPrevious = Boolean(previous[card.id]);
			if (matches === inPrevious) continue;
			if (matches) (toAdd ||= []).push(card.id);
			else (toRemove ||= []).push(card.id);
		}
		if (!toAdd && !toRemove) continue;
		const updated = {...previous};
		if (toRemove) for (const id of toRemove) delete updated[id];
		if (toAdd) for (const id of toAdd) updated[id] = true;
		result[filterName] = updated;
	}
	return result;
};
const masterReduce = (filters, cards) => ({...filters, ...masterMakeFilterFromCards(cards, filters)});

const median = values => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
};
const timed = (runs, fn) => median(Array.from({length: runs}, () => {
	const started = performance.now();
	fn();
	return performance.now() - started;
}));

describe('slice-3 ratio gate: membership reducer vs master plain maps at 12k', function() {
	this.timeout(120000);
	const cards = generateCorpus({count: 12000, seed: 3});
	const newCard = {...Object.values(cards)[0], id: 'ratio-gate-new-card', title: 'new'};
	const RUNS = 7;

	it('a one-card UPDATE_CARDS onto a primed collection costs at most 0.1x master, and the prime at most 1.1x', () => {
		const masterPrime = timed(RUNS, () => masterReduce(INITIAL_STATE.filters, cards));
		const productPrime = timed(RUNS, () => collectionReducer(INITIAL_STATE, {type: UPDATE_CARDS, cards, fetchType: 'published'}));

		const masterPrimed = masterReduce(INITIAL_STATE.filters, cards);
		const productPrimed = collectionReducer(INITIAL_STATE, {type: UPDATE_CARDS, cards, fetchType: 'published'});
		const masterNewCard = timed(RUNS, () => masterReduce(masterPrimed, {[newCard.id]: newCard}));
		const productNewCard = timed(RUNS, () => collectionReducer(productPrimed, {type: UPDATE_CARDS, cards: {[newCard.id]: newCard}, fetchType: 'published'}));

		const primeRatio = productPrime / masterPrime;
		const newCardRatio = productNewCard / masterNewCard;
		console.log(`      prime: master ${masterPrime.toFixed(1)}ms product ${productPrime.toFixed(1)}ms ratio ${primeRatio.toFixed(2)}; new card: master ${masterNewCard.toFixed(2)}ms product ${productNewCard.toFixed(2)}ms ratio ${newCardRatio.toFixed(3)}`);
		assert.ok(newCardRatio <= 0.1, `new-card ratio ${newCardRatio.toFixed(3)} exceeds the 0.1x gate (master ${masterNewCard.toFixed(2)}ms, product ${productNewCard.toFixed(2)}ms)`);
		assert.ok(primeRatio <= 1.1, `prime ratio ${primeRatio.toFixed(2)} exceeds the 1.1x gate (master ${masterPrime.toFixed(1)}ms, product ${productPrime.toFixed(1)}ms)`);
	});
});
