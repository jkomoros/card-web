import {
	CARD_TYPE_CONCEPT,
	REFERENCE_TYPE_CONCEPT,
	SELF_KEY_CARD_ID,
	REFERENCE_TYPES,
} from './card_fields.js';

import {
	CollectionDescription,
	collectionDescriptionWithKeyCard
} from './collection_description.js';

import {
	EVERYTHING_SET_NAME,
	DIRECT_REFERENCES_FILTER_NAME,
	DIRECT_REFERENCES_INBOUND_FILTER_NAME,
	DIRECT_REFERENCES_OUTBOUND_FILTER_NAME,
	SIMILAR_FILTER_NAME,
	EXCLUDE_FILTER_NAME,
	referencesConfigurableFilterText,
	missingConceptConfigurableFilterText,
	aboutConfigurableFilterText,
	LIMIT_FILTER_NAME,
} from './filters.js';

import {
	cardNeedsReciprocalLinkTo
} from './util.js';

/*

An array where each item has:
	collectionDescription: a collection description, possibly using SELF_KEY_CARD_ID as a placeholder
	navigationCollectionDescription: a collectiond description, that if set and showNavigate is true, will be used instead of collectionDescription.
	title: a title to display
	description: if provided, will render a help badge with this text
	cardsToBoldFilterFactory: if not null, should be a factory that, given the expanded card object, will return a filter function to then be passed other expanded card objects to test if they should be bold. The items that return true from that second item will be shown as strong in the reference block.
	emptyMessage: if non-falsey will show that message if no cards match. If it is falsey and no cards match, the block will not be shown.
	showNavigate: if true, then will show a button to navigate to that collection
	onlyForEditors: if true, will only show this block if the keyCard is one the user may edit

	An 'expanded' referenceBlock also has:
	collection: the expanded Collection based on the collectionDescription
	boldCards: a map of cards based on cardsToBoldFilterFactory
*/
const REFERENCE_BLOCKS_FOR_CARD_TYPE = {
	[CARD_TYPE_CONCEPT]: [
		{
			collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, [referencesConfigurableFilterText(DIRECT_REFERENCES_INBOUND_FILTER_NAME, SELF_KEY_CARD_ID, REFERENCE_TYPE_CONCEPT)]),
			navigationCollectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, [aboutConfigurableFilterText(SELF_KEY_CARD_ID)]),
			title: 'Cards that reference this concept',
			emptyMessage: 'No cards reference this concept',
			showNavigate: true,
		},
		{
			collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, [missingConceptConfigurableFilterText(SELF_KEY_CARD_ID)]),
			title: 'Cards that should reference this concept but don\'t',
			showNavigate: true,
			onlyForEditors: true,
		}
	]
};

const REFERENCE_TYPES_TO_EXCLUDE_FROM_INFO_PANEL = Object.entries(REFERENCE_TYPES).filter(entry => entry[1].excludeFromInfoPanel).map(entry => entry[0]);
const SUBSTANTIVE_REFERENCE_TYPES = Object.entries(REFERENCE_TYPES).filter(entry => entry[1].substantive).map(entry => entry[0]);

const NUM_SIMILAR_CARDS_TO_SHOW = 5;

const INFO_PANEL_REFERENCE_BLOCKS = [
	{
		title: 'Concepts',
		description: 'Concepts this card references',
		collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, [referencesConfigurableFilterText(DIRECT_REFERENCES_OUTBOUND_FILTER_NAME, SELF_KEY_CARD_ID, REFERENCE_TYPE_CONCEPT)])
	},
	{
		title: 'Other referenced cards',
		description: 'Cards that this card references that are not links',
		collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, [referencesConfigurableFilterText(DIRECT_REFERENCES_OUTBOUND_FILTER_NAME, SELF_KEY_CARD_ID, REFERENCE_TYPES_TO_EXCLUDE_FROM_INFO_PANEL, true)])
	},
	{
		collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, [referencesConfigurableFilterText(DIRECT_REFERENCES_INBOUND_FILTER_NAME, SELF_KEY_CARD_ID, SUBSTANTIVE_REFERENCE_TYPES)]),
		title: 'Cards That Link Here',
		description: 'Cards that link to this one.',
		emptyMessage: 'No cards link to this one.',
		cardsToBoldFilterFactory: (keyCard) => {
			return (card) => cardNeedsReciprocalLinkTo(keyCard, card);
		}
	},
	{
		collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, ['has-body', SIMILAR_FILTER_NAME + '/' + SELF_KEY_CARD_ID, EXCLUDE_FILTER_NAME + '/' + referencesConfigurableFilterText(DIRECT_REFERENCES_FILTER_NAME, SELF_KEY_CARD_ID, SUBSTANTIVE_REFERENCE_TYPES), LIMIT_FILTER_NAME + '/' + NUM_SIMILAR_CARDS_TO_SHOW]),
		title: 'Similar Cards',
		description: 'Cards that are neither linked to or from here but that have distinctive terms that overlap with this card.',
	}
];

export const primaryReferenceBlocksForCard = (card) => {
	if (!card) return []; 
	return expandReferenceBlockConfig(card, REFERENCE_BLOCKS_FOR_CARD_TYPE[card.card_type]);
};

export const infoPanelReferenceBlocksForCard = (card) => {
	return expandReferenceBlockConfig(card, INFO_PANEL_REFERENCE_BLOCKS);
};

const expandReferenceBlockConfig = (card, configs) => {
	if (!configs) return [];
	if (!card || !card.id) return [];
	return configs.map(block => ({
		...block,
		collectionDescription: collectionDescriptionWithKeyCard(block.collectionDescription, card.id),
		navigationCollectionDescription: block.navigationCollectionDescription ? collectionDescriptionWithKeyCard(block.navigationCollectionDescription, card.id) : undefined,
	}));
};

export const expandReferenceBlocks = (card, blocks, collectionConstructorArgs, cardIDsUserMayEdit) => {
	if (blocks.length == 0) return [];
	return blocks.filter(block => block.onlyForEditors ? cardIDsUserMayEdit[card.id] : true).map(block => {
		const boldFilter = block.cardsToBoldFilterFactory ? block.cardsToBoldFilterFactory(card) : null;
		const collection = block.collectionDescription.collection(collectionConstructorArgs);
		const boldCards = boldFilter ? Object.fromEntries(collection.filteredCards.filter(boldFilter).map(card => [card.id, true])): {};
		return {
			...block,
			collection,
			boldCards
		};
	});
};

let memoizedCollectionConstructorArguments = null;
let memoizedCardIDsUserMayEdit = null;
let memoizedExpandedPrimaryBlocksForCard = new Map();

//getExpandedPrimaryReferenceBlocksForCard is reasonably efficient because it
//caches results, so as long as the things that a collection depends on and the
//card hasn't changed, it won't have to recalculate the results. You can get a
//collectionConstructorArguments from selectCollectionConstructorArguments.
//cardIDsUserMayEdit can be passed with result from selectCardIDsUserMayEdit.
export const getExpandedPrimaryReferenceBlocksForCard = (collectionConstructorArguments, card, cardIDsUserMayEdit) => {
	if (memoizedCollectionConstructorArguments != collectionConstructorArguments || cardIDsUserMayEdit != memoizedCardIDsUserMayEdit) {
		memoizedExpandedPrimaryBlocksForCard = new Map();
		memoizedCollectionConstructorArguments = collectionConstructorArguments;
		memoizedCardIDsUserMayEdit = cardIDsUserMayEdit;
	}

	if (!memoizedExpandedPrimaryBlocksForCard.has(card)) {
		//Generate new blocks and stash
		const blocks = primaryReferenceBlocksForCard(card);
		//reference-block will hide any ones that shouldn't render because of an empty collection
		const expandedBlocks = expandReferenceBlocks(card, blocks, collectionConstructorArguments, cardIDsUserMayEdit);
		memoizedExpandedPrimaryBlocksForCard.set(card, expandedBlocks);
	}

	return memoizedExpandedPrimaryBlocksForCard.get(card);

};