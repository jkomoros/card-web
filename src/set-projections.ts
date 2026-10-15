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

//A missing or non-finite sort_order reads as 0 on both the full and the
//incremental path: a NaN comparator result is treated as "equal" by sort,
//which made the full order incoherent and the merge below (which assumes
//the kept part is ordered) disagree with it.
const sortOrderOf = (cards : Cards, id : CardID) : number => {
	const value = cards[id] ? cards[id].sort_order : 0.0;
	return Number.isFinite(value) ? value : 0.0;
};

export const makeEverythingSetFromCards = (cards : Cards) : CardID[] => {
	const keys = Object.keys(cards);
	keys.sort((a, b) => sortOrderOf(cards, b) - sortOrderOf(cards, a));
	return keys;
};

//--- Incremental everything set ---------------------------------------------
//The everything set depends only on membership and `sort_order`, yet both
//holders rebuilt it with a full O(n log n) sort of the whole corpus on every
//relevant change — the main thread twice (the live set and the collection
//snapshot) and the worker once — so a single card creation at 40k cards paid
//~150ms of sorting on the main thread and ~125ms in the worker's flush,
//directly on the Save→New path. One card moved; the other 40k did not.
//
//Carry the previous ordering forward instead: drop the touched ids, sort the
//(few) upserted ones, and merge. For distinct sort orders the result is
//exactly the full sort's (test/incremental-selectors runs a random battery).
//Ties are NOT: an upserted card lands AFTER existing cards with an equal
//sort_order, which is where a stable full sort of a map whose newest key is
//last also places a NEW card, but a card whose sort_order CHANGED to an
//existing value keeps its old map position in a full sort and can land
//before later-inserted equals there. So order among equal sort orders is
//history-dependent within one holder, and reset by a full rebuild. Equal
//sort orders are collisions, not a contract: nothing reads the relative
//order of two equal keys as meaning, and the two holders never agreed on it
//anyway because their maps were built in different orders.
export type EverythingSetDelta = {
	//Ids added, or whose sort_order changed. Ids absent from `cards` are
	//dropped (a removal that arrived in the same delta as an upsert).
	upserted : CardID[],
	removed : CardID[],
};

//Past this many touched ids the merge's per-id work no longer beats a sort.
export const INCREMENTAL_EVERYTHING_SET_MAX_TOUCHED = 256;

export const updateEverythingSet = (previous : CardID[], cards : Cards, delta : EverythingSetDelta) : CardID[] => {
	const touched = new Set<CardID>(delta.removed);
	for (const id of delta.upserted) touched.add(id);
	if (!touched.size) return previous;
	if (touched.size > INCREMENTAL_EVERYTHING_SET_MAX_TOUCHED) return makeEverythingSetFromCards(cards);
	const kept : CardID[] = [];
	for (const id of previous) {
		if (!touched.has(id)) kept.push(id);
	}
	const inserts : CardID[] = [];
	for (const id of touched) {
		if (cards[id]) inserts.push(id);
	}
	inserts.sort((a, b) => sortOrderOf(cards, b) - sortOrderOf(cards, a));
	const result : CardID[] = new Array(kept.length + inserts.length);
	let keptIndex = 0;
	let insertIndex = 0;
	let resultIndex = 0;
	while (keptIndex < kept.length || insertIndex < inserts.length) {
		const takeKept = insertIndex >= inserts.length || (keptIndex < kept.length &&
			sortOrderOf(cards, kept[keptIndex]) >= sortOrderOf(cards, inserts[insertIndex]));
		result[resultIndex++] = takeKept ? kept[keptIndex++] : inserts[insertIndex++];
	}
	return result;
};
