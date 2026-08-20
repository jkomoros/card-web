//Set projections (ordered CardID lists) over the cards map, shared by the
//main thread's selectors and the corpus worker's query engine. Pure and
//store-free.

import {
	Cards,
	CardID,
	Sections
} from './types.js';

export const computeDefaultSet = (sections : Sections, cards : Cards) : CardID[] => {
	const resultSet = new Set<CardID>();
	for (const section of Object.values(sections)) {
		for (const cardId of section.cards) {
			//Only IDs with an actual card record (#752). The sections doc is
			//a membership index readable by anyone, while card records are
			//permission-gated — so an anonymous client gets all ~1300 IDs
			//but only the ~800 published records. Counting the raw list
			//while rendering the records made the header claim more cards
			//than the corpus ("main: 1307" against an everything of 1239)
			//and self-contradict within one URL. The owner's call: counts
			//reflect card records, so they always equal what renders. This
			//is one map lookup inside a loop that already runs at set-build
			//time — both memoized call sites recompute on any card
			//membership change, so a card arriving later re-adds itself.
			//The same guarantee holds for the other two sets: everything is
			//built from the cards map itself, and the reading-list is gated
			//through existingCardsOnly below.
			if (!cards[cardId]) continue;
			resultSet.add(cardId);
		}
	}
	//Also include any cards that have a non-null section but aren't in any
	//section's cards array. This handles cards that have a section field
	//but weren't loaded via the section data.
	for (const [id, card] of Object.entries(cards)) {
		if (card.section && !resultSet.has(id)) {
			resultSet.add(id);
		}
	}
	const result = [...resultSet];
	//The order of cards in the section object is nondterministic. The order
	//that matters is the sort_order. Higher sort-order should sort to the top.
	result.sort((a,b) => {
		const cardAValue = cards[a] ? cards[a].sort_order : 0.0;
		const cardBValue = cards[b] ? cards[b].sort_order : 0.0;
		return cardBValue - cardAValue;
	});
	return result;
};

//Returns the list with IDs lacking a card record removed — preserving the
//INPUT's identity when nothing needed removing, which is the overwhelmingly
//common case, so memoized consumers keyed on the set's identity don't churn
//(#752). Used for the reading-list set, whose stored list can outlive a
//card's deletion or reach a user who may not read it.
export const existingCardsOnly = (ids : CardID[] | undefined, cards : Cards) : CardID[] => {
	//Some test fixtures (and defensive callers) hold a user record with no
	//readingList at all; absent means empty, same as the raw-list behavior.
	if (!ids) return [];
	let filtered : CardID[] | null = null;
	for (let i = 0; i < ids.length; i++) {
		const exists = Boolean(cards[ids[i]]);
		if (filtered) {
			if (exists) filtered.push(ids[i]);
		} else if (!exists) {
			filtered = ids.slice(0, i);
		}
	}
	return filtered || ids;
};

export const makeEverythingSetFromCards = (cards : Cards) : CardID[] => {
	const keys = Object.keys(cards);
	keys.sort((a, b) => {
		const cardAValue = cards[a] ? cards[a].sort_order : 0.0;
		const cardBValue = cards[b] ? cards[b].sort_order : 0.0;
		return cardBValue - cardAValue;
	});
	return keys;
};
