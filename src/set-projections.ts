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

export const makeEverythingSetFromCards = (cards : Cards) : CardID[] => {
	const keys = Object.keys(cards);
	keys.sort((a, b) => {
		const cardAValue = cards[a] ? cards[a].sort_order : 0.0;
		const cardBValue = cards[b] ? cards[b].sort_order : 0.0;
		return cardBValue - cardAValue;
	});
	return keys;
};
