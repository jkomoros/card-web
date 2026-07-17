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
