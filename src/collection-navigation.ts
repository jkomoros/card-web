export type CardRequestResolution = {
	cardID: string;
	commit: boolean;
	collectionPending: boolean;
};

export type InvalidCollectionCardResolution =
	| {action: 'stay'}
	| {action: 'select-first'}
	| {action: 'default-card'};

export const cardIDIsPlaceholder = (cardID : string): boolean =>
	Boolean(cardID && cardID[0] === '_');

// Resolve a requested card without losing the user's collection intent. A
// placeholder request is committed even when its collection is temporarily
// empty, so a later data echo can select the first matching card.
export const resolveCardRequest = (
	requestedCard : string,
	resolvedRequestedCard : string,
	activeCardID : string,
	collectionCardIDs : string[]
) : CardRequestResolution => {
	if (!cardIDIsPlaceholder(requestedCard)) {
		return {
			cardID: resolvedRequestedCard,
			commit: activeCardID !== resolvedRequestedCard,
			collectionPending: false,
		};
	}

	const firstCardID = collectionCardIDs[0] || '';
	return {
		cardID: firstCardID || activeCardID,
		commit: true,
		collectionPending: !firstCardID,
	};
};

export const resolveInvalidCollectionCard = (
	requestedCard : string,
	activeCardID : string,
	collectionCardIDs : string[]
) : InvalidCollectionCardResolution => {
	if (!collectionCardIDs.length || collectionCardIDs.includes(activeCardID)) return {action: 'stay'};
	if (cardIDIsPlaceholder(requestedCard)) return {action: 'select-first'};
	return {action: 'default-card'};
};

//SPEC §Navigation to selected card: "if the current URL includes a selected
//card and a draft transformation removes that card from the result … committing
//navigates to the default item in the new collection."
//
//A commit that carried the old card suffix into a collection that does not
//contain it stranded the user: the URL named a card the new collection has no
//index for, so the stage kept rendering it, the drawer highlighted nothing, and
//the arrow keys — which step by the selected card's index within the collection
//— had nowhere to step. A well-formed collection path is
//`<collection>/<card>`, so dropping the suffix leaves the trailing slash that
//already means "the default item in this collection".
export const commitPathDroppingLostCard = (path : string, selectedCard : string, cardSurvives : boolean) : string => {
	//No card at stake, or the internal placeholder, which already means
	//"whatever the default is".
	if (!selectedCard || cardIDIsPlaceholder(selectedCard)) return path;
	if (cardSurvives) return path;
	//Only a suffix can be dropped as one. Anything else is not the shape this
	//function was told it was looking at, and mangling it would be worse than
	//leaving the commit alone.
	if (!path.endsWith(selectedCard)) return path;
	return path.slice(0, path.length - selectedCard.length);
};

export type CollectionSnapshotRefreshState = {
	dataFullyLoaded: boolean;
	alreadyCommittedWhenFullyLoaded: boolean;
	forceCommit: boolean;
	requestedCard: string;
	activeCollectionSize: number;
};

export const shouldRefreshCollectionSnapshot = ({
	dataFullyLoaded,
	alreadyCommittedWhenFullyLoaded,
	forceCommit,
	requestedCard,
	activeCollectionSize,
} : CollectionSnapshotRefreshState): boolean =>
	!dataFullyLoaded ||
	!alreadyCommittedWhenFullyLoaded ||
	forceCommit ||
	(cardIDIsPlaceholder(requestedCard) && activeCollectionSize === 0);
