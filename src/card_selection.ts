import type { CardID } from './types.js';

//Returns the inclusive range between anchor and target in the drawer's current
//order. If the anchor is no longer in the collection, treat the target as a
//normal single-card selection.
export const cardSelectionRange = (cardIDs : CardID[], anchor : CardID | null, target : CardID) : CardID[] => {
	const targetIndex = cardIDs.indexOf(target);
	const anchorIndex = anchor ? cardIDs.indexOf(anchor) : -1;
	if (targetIndex < 0 || anchorIndex < 0) return [target];
	const start = Math.min(anchorIndex, targetIndex);
	const end = Math.max(anchorIndex, targetIndex);
	return cardIDs.slice(start, end + 1);
};

export class CardSelectionAnchor {

	_cardID : CardID | null = null;
	_cardIDs : CardID[] = [];

	cardsForClick(cardIDs : CardID[], target : CardID, shift : boolean) : CardID[] {
		const orderUnchanged = cardIDs.length == this._cardIDs.length && cardIDs.every((id, index) => id == this._cardIDs[index]);
		const anchor = orderUnchanged ? this._cardID : null;
		const cards = shift ? cardSelectionRange(cardIDs, anchor, target) : [target];
		this._cardID = target;
		this._cardIDs = [...cardIDs];
		return cards;
	}

	reset() {
		this._cardID = null;
		this._cardIDs = [];
	}
}
