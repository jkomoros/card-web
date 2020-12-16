import {
	CARD_TYPE_CONCEPT,
	REFERENCE_TYPE_ACK,
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
	LIMIT_FILTER_NAME,
} from './filters.js';

import {
	cardNeedsReciprocalLinkTo
} from './util.js';

/*

An array where each item has:
	collection: a collection description, possibly using SELF_KEY_CARD_ID as a placeholder
	title: a title to display
	description: if provided, will render a help badge with this text
	cardsToBoldFilterFactory: if not null, should be a factory that, given the expanded card object, will return a filter function to then be passed other expanded card objects to test if they should be bold. The items that return true from that second item will be shown as strong in the reference block.
	emptyMessage: if non-falsey will show that message if no cards match. If it is falsey and no cards match, the block will not be shown.
*/
const REFERENCE_BLOCKS_FOR_CARD_TYPE = {
	[CARD_TYPE_CONCEPT]: [
		{
			//TODO: actually change this to concept reference type once that exists
			collection: new CollectionDescription(EVERYTHING_SET_NAME, [referencesConfigurableFilterText(DIRECT_REFERENCES_INBOUND_FILTER_NAME, SELF_KEY_CARD_ID, REFERENCE_TYPE_ACK)]),
			title: 'Cards that reference this concept',
			emptyMessage: 'No cards reference this concept',
		}
	]
};

const REFERENCE_TYPES_TO_EXCLUDE_FROM_INFO_PANEL = Object.entries(REFERENCE_TYPES).filter(entry => entry[1].excludeFromInfoPanel).map(entry => entry[0]);
const SUBSTANTIVE_REFERENCE_TYPES = Object.entries(REFERENCE_TYPES).filter(entry => entry[1].substantive).map(entry => entry[0]);

const NUM_SIMILAR_CARDS_TO_SHOW = 5;

const INFO_PANEL_REFERENCE_BLOCKS = [
	{
		title: 'Other referenced cards',
		description: 'Cards that this card references that are not links',
		collection: new CollectionDescription(EVERYTHING_SET_NAME, [referencesConfigurableFilterText(DIRECT_REFERENCES_OUTBOUND_FILTER_NAME, SELF_KEY_CARD_ID, REFERENCE_TYPES_TO_EXCLUDE_FROM_INFO_PANEL, true)])
	},
	{
		collection: new CollectionDescription(EVERYTHING_SET_NAME, [referencesConfigurableFilterText(DIRECT_REFERENCES_INBOUND_FILTER_NAME, SELF_KEY_CARD_ID, SUBSTANTIVE_REFERENCE_TYPES)]),
		title: 'Cards That Link Here',
		description: 'Cards that link to this one.',
		emptyMessage: 'No cards link to this one.',
		cardsToBoldFilterFactory: (keyCard) => {
			return (card) => cardNeedsReciprocalLinkTo(keyCard, card);
		}
	},
	{
		collection: new CollectionDescription(EVERYTHING_SET_NAME, ['has-body', SIMILAR_FILTER_NAME + '/' + SELF_KEY_CARD_ID, EXCLUDE_FILTER_NAME + '/' + referencesConfigurableFilterText(DIRECT_REFERENCES_FILTER_NAME, SELF_KEY_CARD_ID, SUBSTANTIVE_REFERENCE_TYPES), LIMIT_FILTER_NAME + '/' + NUM_SIMILAR_CARDS_TO_SHOW]),
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
	return configs.map(block => ({...block, collection: collectionDescriptionWithKeyCard(block.collection, card.id)}));
};

export const expandReferenceBlocks = (card, blocks, collectionConstructorArgs) => {
	if (blocks.length == 0) return [];
	return blocks.map(block => {
		const boldFilter = block.cardsToBoldFilterFactory ? block.cardsToBoldFilterFactory(card) : null;
		const collection = block.collection.collection(collectionConstructorArgs);
		const boldCards = boldFilter ? Object.fromEntries(collection.filteredCards.filter(boldFilter).map(card => [card.id, true])): {};
		return {
			...block,
			collection,
			boldCards
		};
	});
};