//Utilities for selectors that project a narrow slice out of the full cards
//map. The cards map gets a new identity on every single-card update, which by
//default forces every selector keyed on it to recompute (and produce a new
//result identity, cascading further). These helpers identity-diff the cards
//map against the previous one (~O(corpus) key walk, but no per-card work) and
//only recompute — and only change result identity — when a card relevant to
//the projection actually changed.

import {
	Card,
	Cards
} from './types.js';

import {
	perfCount
} from './perf.js';

export type CardsDelta = {
	//Cards present in both maps but with a different object identity.
	changed : [prev : Card, next : Card][],
	added : Card[],
	//The previous card objects for IDs no longer present.
	removed : Card[],
};

export const diffCards = (prev : Cards, next : Cards) : CardsDelta => {
	const changed : [Card, Card][] = [];
	const added : Card[] = [];
	const removed : Card[] = [];
	for (const [id, nextCard] of Object.entries(next)) {
		const prevCard = prev[id];
		if (!prevCard) {
			added.push(nextCard);
			continue;
		}
		if (prevCard !== nextCard) changed.push([prevCard, nextCard]);
	}
	for (const [id, prevCard] of Object.entries(prev)) {
		if (!next[id]) removed.push(prevCard);
	}
	return {changed, added, removed};
};

type CardsDiffSelectorOptions<R> = {
	//Human-readable name for perf counters.
	name : string,
	//Given the delta between the previous and next cards maps, decide whether
	//the projection could have changed. Only called when there is a previous
	//result; a first call always computes.
	needsRecompute : (delta : CardsDelta) => boolean,
	compute : (cards : Cards) => R,
};

//Returns a function (cards) => R that keeps the previous result identity when
//needsRecompute returns false for the delta. Stateful: create one instance
//per selector.
export const createCardsDiffSelector = <R>(options : CardsDiffSelectorOptions<R>) : ((cards : Cards) => R) => {
	let lastCards : Cards | null = null;
	let lastResult : R;
	return (cards : Cards) : R => {
		if (lastCards === cards) return lastResult;
		let recompute = true;
		if (lastCards !== null) {
			const delta = diffCards(lastCards, cards);
			recompute = options.needsRecompute(delta);
		}
		if (recompute) {
			perfCount('diffSelector:' + options.name + ':recompute');
			lastResult = options.compute(cards);
		} else {
			perfCount('diffSelector:' + options.name + ':skipped');
		}
		lastCards = cards;
		return lastResult;
	};
};

//Common needsRecompute building blocks.

export const membershipChanged = (delta : CardsDelta) : boolean =>
	delta.added.length > 0 || delta.removed.length > 0;

//True if any added/removed/changed card satisfies the predicate (for changed
//cards, on either the previous or next version).
export const anyCardMatches = (delta : CardsDelta, predicate : (card : Card) => boolean) : boolean => {
	for (const card of delta.added) {
		if (predicate(card)) return true;
	}
	for (const card of delta.removed) {
		if (predicate(card)) return true;
	}
	for (const [prev, next] of delta.changed) {
		if (predicate(prev) || predicate(next)) return true;
	}
	return false;
};

//True if any changed card differs according to fieldsDiffer, or membership
//changed at all.
export const anyChangedCardDiffers = (delta : CardsDelta, fieldsDiffer : (prev : Card, next : Card) => boolean) : boolean => {
	if (membershipChanged(delta)) return true;
	for (const [prev, next] of delta.changed) {
		if (fieldsDiffer(prev, next)) return true;
	}
	return false;
};

export const isConceptCard = (card : Card) : boolean => card.card_type === 'concept';

//Shallow array equality.
export const arraysEqual = (a : readonly unknown[], b : readonly unknown[]) : boolean => {
	if (a === b) return true;
	if (!a || !b) return false;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
};
