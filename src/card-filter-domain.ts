import type {CardID, Cards} from './types.js';

//A worker projection is safe to install only when its stated corpus is the
//exact own-key domain Redux will have after applying this batch. Prototype
//properties and duplicate wire IDs are not cards.
export const cardFilterDomainMatches = (existingCards : Cards, incomingCards : Cards, cardFilterCorpusIDs : CardID[]) : boolean => {
	const ownsCard = (cardMap : Cards, id : CardID) => Object.prototype.hasOwnProperty.call(cardMap, id);
	const existingIDs = Object.keys(existingCards);
	const incomingIDs = Object.keys(incomingCards);
	const combinedCount = existingIDs.length + incomingIDs.filter(id => !ownsCard(existingCards, id)).length;
	const uniqueFilterIDs = new Set(cardFilterCorpusIDs);
	return combinedCount === uniqueFilterIDs.size && uniqueFilterIDs.size === cardFilterCorpusIDs.length && cardFilterCorpusIDs.every(id => ownsCard(existingCards, id) || ownsCard(incomingCards, id));
};
