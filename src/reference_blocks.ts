import {
	KEY_CARD_ID_PLACEHOLDER,
	REFERENCE_TYPES,
	REFERENCE_TYPES_EQUIVALENCE_CLASSES,
} from './card_fields.js';

import {
	CARD_TYPE_CONCEPT,
	CARD_TYPE_WORK,
	CARD_TYPE_PERSON,
	CARD_TYPE_WORKING_NOTES,
	REFERENCE_TYPE_CONCEPT,
	REFERENCE_TYPE_CITATION,
	REFERENCE_TYPE_CITATION_PERSON,
	REFERENCE_TYPE_SEE_ALSO,
	REFERENCE_TYPE_EXAMPLE_OF,
	REFERENCE_TYPE_METAPHOR_FOR,
	CARD_TYPE_CONTENT,
	EVERYTHING_SET_NAME,
} from './type_constants.js';

import {
	Collection,
	CollectionDescription,
	collectionDescriptionWithKeyCard
} from './collection_description.js';

import {
	DIRECT_REFERENCES_FILTER_NAME,
	DIRECT_REFERENCES_INBOUND_FILTER_NAME,
	DIRECT_REFERENCES_OUTBOUND_FILTER_NAME,
	SIMILAR_FILTER_NAME,
	EXCLUDE_FILTER_NAME,
	referencesConfigurableFilterText,
	missingConceptConfigurableFilterText,
	aboutConceptConfigurableFilterText,
	LIMIT_FILTER_NAME,
	SAME_TYPE_FILTER,
	DIFFERENT_TYPE_FILTER,
	UNION_FILTER_DELIMITER,
} from './filters.js';

import {
	CardBooleanMap,
	Card,
	CardType,
	CollectionConstructorArguments,
	FilterMap,
	ReferenceType
} from './types.js';

import {
	cardNeedsReciprocalLinkTo
} from './util.js';

export interface ReferenceBlock {
    // collectionDescription: a collection description, possibly using KEY_CARD_ID_PLACEHOLDER as a placeholder
	collectionDescription: CollectionDescription;
    // navigationCollectionDescription: a collectiond description, that if set and showNavigate is true, will be used instead of collectionDescription.
	navigationCollectionDescription? : CollectionDescription;
    // title: a title to display,
	title: string;
    // condensed: if true, will show up in a much smaller, inline style
	condensed?: boolean;
    // description: if provided, will render a help badge with this text
	description? : string;
    // cardsToBoldFilterFactory: if not null, should be a factory that, given the expanded card object, will return a filter function to then be passed other expanded card objects to test if they should be bold. The items that return true from that second item will be shown as strong in the reference block.
	cardsToBoldFilterFactory? : (card : Card) => ((otherCard : Card) => boolean)
    // emptyMessage: if non-falsey will show that message if no cards match. If it is falsey and no cards match, the block will not be shown.
	emptyMessage? : string;
    // showNavigate: if true, then will show a button to navigate to that collection
	showNavigate? : boolean;
    // onlyForEditors: if true, will only show this block if the keyCard is one the user may edit
	onlyForEditors? : boolean;
}

export interface ExpandedReferenceBlock extends ReferenceBlock {
    //collection: the expanded Collection based on the collectionDescription
    collection: Collection;
    //boldCards: a map of cards based on cardsToBoldFilterFactory
    boldCards: FilterMap;
}

export type ReferenceBlocks = readonly ReferenceBlock[];

export type ExpandedReferenceBlocks = readonly ExpandedReferenceBlock[];

const CONCEPT_CARD_CONDENSED_REFERENCE_BLOCKS : ReferenceBlocks = Object.entries(REFERENCE_TYPES).filter(entry => entry[1].subTypeOf == REFERENCE_TYPE_CONCEPT && entry[0] != REFERENCE_TYPE_CONCEPT).map(entry => {
	const referenceType = entry[0] as ReferenceType;
	const referenceConfig = entry[1];
	if (referenceConfig.reciprocal) {
		return {
			collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME,[referencesConfigurableFilterText(DIRECT_REFERENCES_FILTER_NAME, KEY_CARD_ID_PLACEHOLDER, referenceType)]),
			title: referenceConfig.name,
			condensed: true,
		};
	}
	return [
		{
			collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME,[referencesConfigurableFilterText(DIRECT_REFERENCES_OUTBOUND_FILTER_NAME, KEY_CARD_ID_PLACEHOLDER, referenceType)]),
			title: referenceConfig.name,
			condensed: true,
		},
		{
			collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME,[referencesConfigurableFilterText(DIRECT_REFERENCES_INBOUND_FILTER_NAME, KEY_CARD_ID_PLACEHOLDER, referenceType)]),
			title: referenceConfig.inboundName,
			condensed: true,
		},
	];
}).flat();

const REFERENCE_BLOCKS_FOR_CARD_TYPE : {[cardType in CardType]+? : ReferenceBlocks} = {
	[CARD_TYPE_CONCEPT]: [
		...CONCEPT_CARD_CONDENSED_REFERENCE_BLOCKS,
		{
			collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, ['not-' + CARD_TYPE_CONCEPT, referencesConfigurableFilterText(DIRECT_REFERENCES_INBOUND_FILTER_NAME, KEY_CARD_ID_PLACEHOLDER, [...Object.keys(REFERENCE_TYPES_EQUIVALENCE_CLASSES[REFERENCE_TYPE_CONCEPT]) as ReferenceType[]])]),
			navigationCollectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, [aboutConceptConfigurableFilterText(KEY_CARD_ID_PLACEHOLDER)]),
			title: 'Cards that reference this concept',
			showNavigate: true,
		},
		{
			collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, [missingConceptConfigurableFilterText(KEY_CARD_ID_PLACEHOLDER)]),
			title: 'Cards that should reference this concept but don\'t',
			showNavigate: true,
			onlyForEditors: true,
		}
	],
	[CARD_TYPE_WORK]: [
		{
			collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME,[referencesConfigurableFilterText(DIRECT_REFERENCES_OUTBOUND_FILTER_NAME, KEY_CARD_ID_PLACEHOLDER, REFERENCE_TYPE_CITATION_PERSON)]),
			title: 'Authors',
			condensed: true,
		},
		{
			collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, [referencesConfigurableFilterText(DIRECT_REFERENCES_INBOUND_FILTER_NAME, KEY_CARD_ID_PLACEHOLDER, REFERENCE_TYPE_CITATION)]),
			title: 'Cards that cite this work',
			showNavigate: true,
			emptyMessage: 'No cards cite this work'
		},
	],
	[CARD_TYPE_PERSON]: [
		{
			collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, [CARD_TYPE_WORK, referencesConfigurableFilterText(DIRECT_REFERENCES_INBOUND_FILTER_NAME, KEY_CARD_ID_PLACEHOLDER, REFERENCE_TYPE_CITATION_PERSON)]),
			title: 'Works that cite this person',
			showNavigate: true,
			emptyMessage: 'No works cite this person'
		},
		{
			collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, ['not-' + CARD_TYPE_WORK, referencesConfigurableFilterText(DIRECT_REFERENCES_INBOUND_FILTER_NAME, KEY_CARD_ID_PLACEHOLDER, REFERENCE_TYPE_CITATION_PERSON)]),
			title: 'Cards that cite this person',
			showNavigate: true,
			emptyMessage: 'No cards cite this person'
		},
	]
};

const REFERENCE_TYPES_TO_EXCLUDE_FROM_INFO_PANEL = Object.entries(REFERENCE_TYPES).filter(entry => entry[1].excludeFromInfoPanel).map(entry => entry[0]) as ReferenceType[];
const SUBSTANTIVE_REFERENCE_TYPES = Object.entries(REFERENCE_TYPES).filter(entry => entry[1].substantive).map(entry => entry[0]) as ReferenceType[];

const NUM_SIMILAR_CARDS_TO_SHOW = 5;

const INFO_PANEL_REFERENCE_BLOCKS : ReferenceBlocks = [
	{
		title: 'Example of',
		description: 'Concepts this card is an example of',
		collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, [referencesConfigurableFilterText(DIRECT_REFERENCES_OUTBOUND_FILTER_NAME, KEY_CARD_ID_PLACEHOLDER, REFERENCE_TYPE_EXAMPLE_OF)]),
	},
	{
		title: 'Metaphor for',
		description: 'Concepts this card is an example of',
		collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, [referencesConfigurableFilterText(DIRECT_REFERENCES_OUTBOUND_FILTER_NAME, KEY_CARD_ID_PLACEHOLDER, REFERENCE_TYPE_METAPHOR_FOR)]),
	},
	{
		title: 'Concepts',
		description: 'Concepts this card references',
		collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, [referencesConfigurableFilterText(DIRECT_REFERENCES_OUTBOUND_FILTER_NAME, KEY_CARD_ID_PLACEHOLDER, REFERENCE_TYPE_CONCEPT)])
	},
	{
		title: 'See Also',
		description: 'Cards that are related to this card and make sense to consume together',
		collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, [referencesConfigurableFilterText(DIRECT_REFERENCES_OUTBOUND_FILTER_NAME, KEY_CARD_ID_PLACEHOLDER, REFERENCE_TYPE_SEE_ALSO)])
	},
	{
		title: 'Citations',
		emptyMessage: 'No citations',
		description: 'Works or people that insights for this card were based on',
		collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, [referencesConfigurableFilterText(DIRECT_REFERENCES_OUTBOUND_FILTER_NAME, KEY_CARD_ID_PLACEHOLDER, [...Object.keys(REFERENCE_TYPES_EQUIVALENCE_CLASSES[REFERENCE_TYPE_CITATION]) as ReferenceType[]])])

	},
	{
		title: 'Other referenced cards',
		description: 'Cards that this card references that are not links',
		collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, [referencesConfigurableFilterText(DIRECT_REFERENCES_OUTBOUND_FILTER_NAME, KEY_CARD_ID_PLACEHOLDER, REFERENCE_TYPES_TO_EXCLUDE_FROM_INFO_PANEL, true)])
	},
	{
		collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, ['not-' + CARD_TYPE_CONCEPT,referencesConfigurableFilterText(DIRECT_REFERENCES_INBOUND_FILTER_NAME, KEY_CARD_ID_PLACEHOLDER, SUBSTANTIVE_REFERENCE_TYPES)]),
		title: 'Cards That Link Here',
		description: 'Cards that link to this one.',
		emptyMessage: 'No cards link to this one.',
		showNavigate: true,
		cardsToBoldFilterFactory: (keyCard) => {
			return (card) => cardNeedsReciprocalLinkTo(keyCard, card);
		}
	},
	{
		collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, ['has-body', SIMILAR_FILTER_NAME + '/' + KEY_CARD_ID_PLACEHOLDER, SAME_TYPE_FILTER + '/' + KEY_CARD_ID_PLACEHOLDER, EXCLUDE_FILTER_NAME + '/' + referencesConfigurableFilterText(DIRECT_REFERENCES_FILTER_NAME, KEY_CARD_ID_PLACEHOLDER, SUBSTANTIVE_REFERENCE_TYPES), LIMIT_FILTER_NAME + '/' + NUM_SIMILAR_CARDS_TO_SHOW]),
		navigationCollectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, ['has-body', SIMILAR_FILTER_NAME + '/' + KEY_CARD_ID_PLACEHOLDER, SAME_TYPE_FILTER + '/' + KEY_CARD_ID_PLACEHOLDER, EXCLUDE_FILTER_NAME + '/' + referencesConfigurableFilterText(DIRECT_REFERENCES_FILTER_NAME, KEY_CARD_ID_PLACEHOLDER, SUBSTANTIVE_REFERENCE_TYPES)]),
		showNavigate: true,
		title: 'Similar Cards',
		description: 'Cards that are neither linked to or from here but that have distinctive terms that overlap with this card and are the same type of card.',
	},
	{
		collectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, ['has-body', SIMILAR_FILTER_NAME + '/' + KEY_CARD_ID_PLACEHOLDER, CARD_TYPE_WORKING_NOTES + UNION_FILTER_DELIMITER + CARD_TYPE_CONTENT, DIFFERENT_TYPE_FILTER + '/' + KEY_CARD_ID_PLACEHOLDER, EXCLUDE_FILTER_NAME + '/' + referencesConfigurableFilterText(DIRECT_REFERENCES_FILTER_NAME, KEY_CARD_ID_PLACEHOLDER, SUBSTANTIVE_REFERENCE_TYPES), LIMIT_FILTER_NAME + '/' + NUM_SIMILAR_CARDS_TO_SHOW]),
		navigationCollectionDescription: new CollectionDescription(EVERYTHING_SET_NAME, ['has-body', SIMILAR_FILTER_NAME + '/' + KEY_CARD_ID_PLACEHOLDER, CARD_TYPE_WORKING_NOTES + UNION_FILTER_DELIMITER + CARD_TYPE_CONTENT, DIFFERENT_TYPE_FILTER + '/' + KEY_CARD_ID_PLACEHOLDER, EXCLUDE_FILTER_NAME + '/' + referencesConfigurableFilterText(DIRECT_REFERENCES_FILTER_NAME, KEY_CARD_ID_PLACEHOLDER, SUBSTANTIVE_REFERENCE_TYPES)]),
		showNavigate: true,
		title: 'Similar Cards (Other Type)',
		description: 'Cards that are neither linked to or from here but that have distinctive terms that overlap with this card but are a different type (either working-notes or content)',
	}
];

export const primaryReferenceBlocksForCard = (card : Card) : ReferenceBlocks => {
	if (!card) return []; 
	return expandReferenceBlockConfig(card, REFERENCE_BLOCKS_FOR_CARD_TYPE[card.card_type]);
};

export const infoPanelReferenceBlocksForCard = (card : Card) : ReferenceBlocks => {
	return expandReferenceBlockConfig(card, INFO_PANEL_REFERENCE_BLOCKS);
};

//In the common case that expandReferenceBlocks gets an empty array, rtuen the
//same thing so that selectors won't re-run.
const EMPTY_ARRAY = Object.freeze([]);

const expandReferenceBlockConfig = (card : Card, configs : ReferenceBlocks) : ReferenceBlocks => {
	if (!configs) return EMPTY_ARRAY as ReferenceBlocks;
	if (!card || !card.id) return EMPTY_ARRAY as ReferenceBlocks;
	return configs.map(block => ({
		...block,
		//navigationCollectionDescription is always set, the expanded version of
		//the collecction with the key card replaced, or 'burned in'. We base
		//that off of the override navigationCollectionDescription, or just the
		//default one.
		navigationCollectionDescription: collectionDescriptionWithKeyCard(block.navigationCollectionDescription || block.collectionDescription, card.id),
	}));
};

export const expandReferenceBlocks = (card : Card, blocks : ReferenceBlocks, collectionConstructorArgs : CollectionConstructorArguments, cardIDsUserMayEdit : CardBooleanMap) : ExpandedReferenceBlocks => {
	if (blocks.length == 0) return EMPTY_ARRAY;
	const keyCardCollectionConstructorArgs = {
		...collectionConstructorArgs,
		keyCardID: card.id,
	};
	return blocks.filter(block => block.onlyForEditors ? cardIDsUserMayEdit[card.id] : true).map(block => {
		const boldFilter = block.cardsToBoldFilterFactory ? block.cardsToBoldFilterFactory(card) : null;
		const collection = block.collectionDescription.collection(keyCardCollectionConstructorArgs);
		const boldCards : FilterMap = boldFilter ? Object.fromEntries(collection.filteredCards.filter(boldFilter).map(card => [card.id, true])): {};
		return {
			...block,
			collection,
			boldCards
		};
	});
};

let memoizedCollectionConstructorArguments : CollectionConstructorArguments = null;
let memoizedCardIDsUserMayEdit : CardBooleanMap = null;
let memoizedExpandedPrimaryBlocksForCard : Map<Card, ExpandedReferenceBlocks> = new Map();

//getExpandedPrimaryReferenceBlocksForCard is reasonably efficient because it
//caches results, so as long as the things that a collection depends on and the
//card hasn't changed, it won't have to recalculate the results. You can get a
//collectionConstructorArguments from selectCollectionConstructorArguments.
//cardIDsUserMayEdit can be passed with result from selectCardIDsUserMayEdit.
export const getExpandedPrimaryReferenceBlocksForCard = (collectionConstructorArguments : CollectionConstructorArguments, card : Card, cardIDsUserMayEdit? : CardBooleanMap) : ExpandedReferenceBlocks => {
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