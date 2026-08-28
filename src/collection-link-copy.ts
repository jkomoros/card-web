//What the app says after copying a collection link, in one place.
//
//The spec asks the persistent collection sentence to "offer Copy link nearby
//and describe the linked view after copying" (§Persistent collection sentence).
//Both copy paths — the sentence's icon in card-view and Source mode's Copy link
//button — said only 'Collection link copied.', which confirms that a copy
//happened and says nothing about WHAT is now on the clipboard. A user with two
//collections open and one clipboard cannot tell those two outcomes apart.
//
//One module rather than two call sites, because the comment on the Source-mode
//handler is right that two spellings of one outcome is how sync-copy's eight
//sentences happened — and a composed message has far more room to drift than a
//literal did.

import {
	CollectionDescription
} from './collection_description.js';

import {
	filterNamesAreViewerDependent
} from './filters.js';

import {
	readableCollectionExpression
} from './collection-composer-suggestions.js';

import {
	formatCollectionCardCount
} from './collection-composer-preview.js';

//Long enough to name a real collection, short enough that the sentence stays a
//sentence. A composed expression has no upper bound — every clause the user
//added is in it — and a snack bar that wraps to five lines is not a transient
//confirmation any more (§3.5).
const MAX_EXPRESSION_LENGTH = 60;

const truncatedExpression = (expression : string) : string => (
	expression.length > MAX_EXPRESSION_LENGTH ? `${expression.slice(0, MAX_EXPRESSION_LENGTH - 1)}…` : expression
);

//The durability half of the sentence. This is the same question the chips and
//Source ask, through the same predicate, so a link described as working for
//anyone cannot contain a clause a chip just called personal.
const durabilityNote = (description : CollectionDescription) : string => (
	filterNamesAreViewerDependent(description.filters) ?
		'Results depend on who views it' :
		'Works for anyone'
);

//`count` is optional because the two callers know it with different
//confidence: card-view has the collection's own numCards, while Source has
//whatever the preview worker has returned so far, which may be nothing yet. A
//missing count drops its segment rather than guessing or saying zero.
export const collectionLinkCopiedMessage = (
	description : CollectionDescription,
	filterLabels : Record<string, string> = {},
	count? : number
) : string => {
	const segments = [
		`Copied a link to ${truncatedExpression(readableCollectionExpression(description, filterLabels))}`,
	];
	if (count !== undefined) segments.push(formatCollectionCardCount(count));
	segments.push(durabilityNote(description));
	return `${segments.join(' · ')}.`;
};

//§2.4's four parts: what happened, what it means, and the next step. The
//reassurance part is left out because there is nothing to reassure about — no
//data was at stake in a clipboard write. The next step is real: Source mode
//shows the URL as text, so a user whose browser refused clipboard access has
//somewhere to go and select it by hand.
export const COLLECTION_LINK_COPY_FAILED_MESSAGE = 'Could not copy the collection link. The link is shown in Edit source.';
