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
	DIRECT_REFERENCES_INBOUND_FILTER_NAME,
	DIRECT_REFERENCES_OUTBOUND_FILTER_NAME,
	referencesConfigurableFilterText,
} from './filters.js';

/*

An array where each item has:
	collection: a collection description, possibly using SELF_KEY_CARD_ID as a placeholder
	title: a title to display
	description: if provided, will render a help badge with this text
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

const REFERENCE_TYPES_TO_EXCLUDE_FROM_INFO_PANEL = Object.entries(REFERENCE_TYPES).filter(entry => !entry[1].excludeFromInfoPanel).map(entry => entry[1]);

const INFO_PANEL_REFERENCE_BLOCKS = [
	{
		title: 'Other referenced cards',
		description: 'Cards that this card references that are not links',
		collection: new CollectionDescription(EVERYTHING_SET_NAME, [referencesConfigurableFilterText(DIRECT_REFERENCES_OUTBOUND_FILTER_NAME, SELF_KEY_CARD_ID, REFERENCE_TYPES_TO_EXCLUDE_FROM_INFO_PANEL, true)])
	}
];

export const primaryReferenceBlocksForCard = (card) => {
	if (!card) return []; 
	return expandReferenceBlockConfig(REFERENCE_BLOCKS_FOR_CARD_TYPE[card.card_type]);
};

export const infoPanelReferenceBlocksForCard = () => {
	return expandReferenceBlockConfig(INFO_PANEL_REFERENCE_BLOCKS);
};

const expandReferenceBlockConfig = (card, configs) => {
	if (!configs) return [];
	return configs.map(block => ({...block, collection: collectionDescriptionWithKeyCard(block.collection, card.id)}));
};