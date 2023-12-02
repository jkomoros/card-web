import {
	REFERENCE_TYPES,
	REFERENCE_TYPES_EQUIVALENCE_CLASSES,
} from './card_fields.js';

import {
	Collection,
	CollectionDescription,
	collectionDescriptionWithKeyCard
} from './collection_description.js';

import {
	similarFilter,
	sameTypeFilter,
	excludeFilter,
	referencesFilter,
	unionFilter,
	collectionDescription,
	differentTypeFilter,
	limitFilter,
	aboutConceptFilter,
	missingConceptFilter,
	cardTypeFilter
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

import {
	TypedObject
} from './typed_object.js';

export interface ReferenceBlock {
    // collectionDescription: a collection description, possibly using KEY_CARD_ID_PLACEHOLDER as a placeholder
	collectionDescription: CollectionDescription;
    // navigationCollectionDescription: a collectiond description, that if set and showNavigate is true, will be used instead of collectionDescription.
	navigationCollectionDescription? : CollectionDescription;
    // title: a title to display,
	title: string;
    // condensed: if true, will show up in a much smaller, inline style
	condensed?: boolean;
	//If provided, will render card-link subtly (e.g. no icon)
	subtle? : boolean;
	//if true, then even if it's condensed it will show up in the primary section.
	primary? : boolean;
    // description: if provided, will render a help badge with this text
	description? : string;
    // cardsToBoldFilterFactory: if not null, should be a factory that, given the expanded card object, will return a filter function to then be passed other expanded card objects to test if they should be bold. The items that return true from that second item will be shown as strong in the reference block.
	cardsToBoldFilterFactory? : (card : Card) => ((otherCard : Card) => boolean)
    // emptyMessage: if non-falsey will show that message if no cards match. If it is falsey and no cards match, the block will not be shown.
	emptyMessage? : string;
    // showNavigate: if true, then will show a button to navigate to that collection
	showNavigate? : boolean;
	//If provided, then if the collection is a preview, a warning icon will be shown, and it will have this message.
	showPreview? : string;
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

const CONCEPT_CARD_CONDENSED_REFERENCE_BLOCKS : ReferenceBlocks = TypedObject.entries(REFERENCE_TYPES).filter(entry => entry[1].subTypeOf == 'concept' && entry[0] != 'concept').map(entry => {
	const referenceType = entry[0] as ReferenceType;
	const referenceConfig = entry[1];
	if (referenceConfig.reciprocal) {
		return {
			collectionDescription: collectionDescription(referencesFilter('both', referenceType)),
			title: referenceConfig.name || '',
			condensed: true,
		};
	}
	return [
		{
			collectionDescription: collectionDescription(referencesFilter('outbound', referenceType)),
			title: referenceConfig.name || '',
			condensed: true,
		},
		{
			collectionDescription: collectionDescription(referencesFilter('inbound', referenceType)),
			title: referenceConfig.inboundName || '',
			condensed: true,
		},
	];
}).flat();

const REFERENCE_BLOCKS_FOR_CARD_TYPE : {[cardType in CardType]+? : ReferenceBlocks} = {
	'concept': [
		...CONCEPT_CARD_CONDENSED_REFERENCE_BLOCKS,
		{
			collectionDescription: collectionDescription('not' + cardTypeFilter('concept'), referencesFilter('inbound', TypedObject.keys(REFERENCE_TYPES_EQUIVALENCE_CLASSES.concept))),
			navigationCollectionDescription: collectionDescription(aboutConceptFilter()),
			title: 'Cards that reference this concept',
			showNavigate: true,
		},
		{
			collectionDescription: collectionDescription(missingConceptFilter()),
			title: 'Cards that should reference this concept but don\'t',
			showNavigate: true,
			onlyForEditors: true,
		}
	],
	'work': [
		{
			collectionDescription: collectionDescription(referencesFilter('outbound', 'citation-person')),
			title: 'Authors',
			condensed: true,
		},
		{
			collectionDescription: collectionDescription(referencesFilter('inbound', 'citation')),
			title: 'Cards that cite this work',
			showNavigate: true,
			emptyMessage: 'No cards cite this work'
		},
	],
	'person': [
		{
			collectionDescription: collectionDescription(cardTypeFilter('work'), referencesFilter('inbound', 'citation-person')),
			title: 'Works that cite this person',
			showNavigate: true,
			emptyMessage: 'No works cite this person'
		},
		{
			collectionDescription: collectionDescription('not-' + cardTypeFilter('work'), referencesFilter('inbound', 'citation-person')),
			title: 'Cards that cite this person',
			showNavigate: true,
			emptyMessage: 'No cards cite this person'
		},
	],
	'quote': [
		{
			//Reach through a work citation to the person citation.
			collectionDescription: collectionDescription(
				//Only show person
				cardTypeFilter('person'),
				//We have to reach through both types, because the first connection might be to a work, and then to a person.
				referencesFilter('outbound', ['citation', 'citation-person'], {ply: 2}),
				//We don't need to do a limitFilter(1) because even if multiple
				//cards link to a person directly or indirectly each card can
				//only show up once.
			),
			title: '',
			primary: true,
			condensed: true,
			subtle: true
		},
		{
			collectionDescription: collectionDescription(cardTypeFilter('work'), referencesFilter('outbound', 'citation')),
			title: '',
			primary: true,
			condensed: true,
			subtle: true
		}
	]
};

const REFERENCE_TYPES_TO_EXCLUDE_FROM_INFO_PANEL = Object.entries(REFERENCE_TYPES).filter(entry => entry[1].excludeFromInfoPanel).map(entry => entry[0]) as ReferenceType[];
const SUBSTANTIVE_REFERENCE_TYPES = Object.entries(REFERENCE_TYPES).filter(entry => entry[1].substantive).map(entry => entry[0]) as ReferenceType[];
const SUBSTANTIVE_WITHOUT_SEE_ALSO_REFERENCE_TYPES = SUBSTANTIVE_REFERENCE_TYPES.filter(type => type != 'see-also');

const NUM_SIMILAR_CARDS_TO_SHOW = 5;

export const SIMILAR_SAME_TYPE = [
	'has-body',
	similarFilter(),
	sameTypeFilter(),
	excludeFilter(referencesFilter('both', SUBSTANTIVE_REFERENCE_TYPES))
];

const SIMILAR_DIFFERENT_TYPE = [
	'has-body',
	similarFilter(),
	unionFilter(cardTypeFilter('content'), cardTypeFilter('working-notes')),
	differentTypeFilter(),
	excludeFilter(referencesFilter('both', SUBSTANTIVE_REFERENCE_TYPES))
];

const SIMLIAR_PREVIEW_MESSAGE = 'These cards are based on the lower-quality local similarity, not embedding based similarity.';

const INFO_PANEL_REFERENCE_BLOCKS : ReferenceBlocks = [
	{
		title: 'Example of',
		description: 'Concepts this card is an example of',
		collectionDescription: collectionDescription(referencesFilter('outbound', 'example-of'))
	},
	{
		title: 'Metaphor for',
		description: 'Concepts this card is an example of',
		collectionDescription: collectionDescription(referencesFilter('outbound', 'metaphor-for'))
	},
	{
		title: 'Concepts',
		description: 'Concepts this card references',
		collectionDescription: collectionDescription(referencesFilter('outbound', 'concept'))
	},
	{
		title: 'See Also',
		description: 'Cards that are related to this card and make sense to consume together',
		collectionDescription: collectionDescription(referencesFilter('both', 'see-also'))
	},
	{
		title: 'Citations',
		emptyMessage: 'No citations',
		description: 'Works or people that insights for this card were based on',
		collectionDescription: collectionDescription(referencesFilter('outbound', TypedObject.keys(REFERENCE_TYPES_EQUIVALENCE_CLASSES.citation)))

	},
	{
		title: 'Other referenced cards',
		description: 'Cards that this card references that are not links',
		collectionDescription: collectionDescription(referencesFilter('outbound', REFERENCE_TYPES_TO_EXCLUDE_FROM_INFO_PANEL, {invertReferencesTypes: true}))
	},
	{
		//We filter out see-also types because we already show those reciprocally in see-also.
		collectionDescription: collectionDescription('not-' + cardTypeFilter('concept'), referencesFilter('inbound', SUBSTANTIVE_WITHOUT_SEE_ALSO_REFERENCE_TYPES)),
		title: 'Cards That Link Here',
		description: 'Cards that link to this one.',
		emptyMessage: 'No cards link to this one.',
		showNavigate: true,
		cardsToBoldFilterFactory: (keyCard) => {
			return (card) => cardNeedsReciprocalLinkTo(keyCard, card);
		}
	},
	{
		collectionDescription: collectionDescription(...SIMILAR_SAME_TYPE, limitFilter(NUM_SIMILAR_CARDS_TO_SHOW)),
		navigationCollectionDescription: collectionDescription(...SIMILAR_SAME_TYPE),
		showNavigate: true,
		showPreview: SIMLIAR_PREVIEW_MESSAGE,
		title: 'Similar Cards',
		description: 'Cards that are neither linked to or from here but that have distinctive terms that overlap with this card and are the same type of card.',
	},
	{
		collectionDescription: collectionDescription(...SIMILAR_DIFFERENT_TYPE, limitFilter(NUM_SIMILAR_CARDS_TO_SHOW)),
		navigationCollectionDescription: collectionDescription(...SIMILAR_DIFFERENT_TYPE),
		showNavigate: true,
		showPreview: SIMLIAR_PREVIEW_MESSAGE,
		title: 'Similar Cards (Other Type)',
		description: 'Cards that are neither linked to or from here but that have distinctive terms that overlap with this card but are a different type (either working-notes or content)',
	}
];

export const primaryReferenceBlocksForCard = (card : Card | null) : ReferenceBlocks => {
	if (!card) return []; 
	return expandReferenceBlockConfig(card, REFERENCE_BLOCKS_FOR_CARD_TYPE[card.card_type] || []);
};

export const infoPanelReferenceBlocksForCard = (card : Card | null) : ReferenceBlocks => {
	return expandReferenceBlockConfig(card, INFO_PANEL_REFERENCE_BLOCKS);
};

//In the common case that expandReferenceBlocks gets an empty array, rtuen the
//same thing so that selectors won't re-run.
const EMPTY_ARRAY = Object.freeze([]);

const expandReferenceBlockConfig = (card : Card | null, configs : ReferenceBlocks) : ReferenceBlocks => {
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

export const expandReferenceBlocks = (card : Card | null, blocks : ReferenceBlocks, collectionConstructorArgs : CollectionConstructorArguments, cardIDsUserMayEdit : CardBooleanMap) : ExpandedReferenceBlocks => {
	if (!card) return EMPTY_ARRAY;
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

let memoizedCollectionConstructorArguments : CollectionConstructorArguments | null = null;
let memoizedCardIDsUserMayEdit : CardBooleanMap | null = null;
let memoizedExpandedPrimaryBlocksForCard : Map<Card, ExpandedReferenceBlocks> = new Map();

//getExpandedPrimaryReferenceBlocksForCard is reasonably efficient because it
//caches results, so as long as the things that a collection depends on and the
//card hasn't changed, it won't have to recalculate the results. You can get a
//collectionConstructorArguments from selectCollectionConstructorArguments.
//cardIDsUserMayEdit can be passed with result from selectCardIDsUserMayEdit.
export const getExpandedPrimaryReferenceBlocksForCard = (collectionConstructorArguments : CollectionConstructorArguments, card : Card | null, cardIDsUserMayEdit? : CardBooleanMap) : ExpandedReferenceBlocks => {
	if (!card) return EMPTY_ARRAY;
	if (!cardIDsUserMayEdit) cardIDsUserMayEdit = {};

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

	return memoizedExpandedPrimaryBlocksForCard.get(card) || [];

};