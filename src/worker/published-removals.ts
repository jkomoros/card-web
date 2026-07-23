import type {Card, CardID} from '../types.js';

//A published-query removal can mean published→unpublished, not deletion. If
//the unpublished listener already installed that version, an out-of-order
//published removal must not delete it. Real deletes are handled by tombstones
//and published ghost reconciliation.
export const safePublishedRemovals = (
	removedIDs : CardID[],
	currentCards : ReadonlyMap<CardID, Card>,
) => removedIDs.filter(id => currentCards.get(id)?.published !== false);

export const publishedGhostIDs = (
	currentCards : ReadonlyMap<CardID, Card>,
	authoritativeIDs : ReadonlySet<CardID>,
) => [...currentCards.entries()]
	.filter(([id, card]) => card.published && !authoritativeIDs.has(id))
	.map(([id]) => id);
