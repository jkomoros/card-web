export const TEXT_FIELD_BODY = 'body';
export const TEXT_FIELD_TITLE = 'title';
export const TEXT_FIELD_SUBTITLE = 'subtitle';

export const CARD_TYPE_CONTENT = 'content';
export const CARD_TYPE_SECTION_HEAD = 'section-head';
export const CARD_TYPE_WORKING_NOTES = 'working-notes';

const noop = (card) => card;

const WORKING_NOTES_TITLE_PREFIX = '>';

const workingNotesExtractor = card => {
	//TODO: also include first part of semantic fingerprint.
	const date = card.updated.toDate();
	const title = WORKING_NOTES_TITLE_PREFIX + ' ' + date.toDateString();
	return {
		...card,
		title,
	};
};

//These are the functions that should be passed a card right as editing is
//committing. They are given the card, and should return a card with the fields
//set as they want. The card should not be modified; if new fields are to be
//added a copy should be returned. This is a useful point to do field
//derivation, like title fields for working-notes cards. Adding one here also
//will add it to VALID_CARD_TYPES.
export const CARD_TYPE_EDITING_FINISHERS = {
	[CARD_TYPE_CONTENT]: noop,
	[CARD_TYPE_SECTION_HEAD]: noop,
	[CARD_TYPE_WORKING_NOTES]: workingNotesExtractor,
};

export const VALID_CARD_TYPES = Object.fromEntries(Object.keys(CARD_TYPE_EDITING_FINISHERS).map(key => [key, true]));

//NOTE: currently it's only supported for a single field to be marked as html,
//and it must be called 'body'. See #345 for fixing that.

export const TEXT_FIELD_CONFIGURATION = {
	[TEXT_FIELD_TITLE]: {
		html: false,
		container: 'h1',
		legal_card_types: {[CARD_TYPE_CONTENT]: true, [CARD_TYPE_SECTION_HEAD]: true}
	},
	[TEXT_FIELD_BODY]: {
		html: true,
		container: 'section',
		legal_card_types: {[CARD_TYPE_CONTENT]: true, [CARD_TYPE_WORKING_NOTES]: true},
	},
	[TEXT_FIELD_SUBTITLE]: {
		html: false,
		container: 'h2',
		legal_card_types: {[CARD_TYPE_SECTION_HEAD]: true},
	}
};

export const legalFieldsForCardType = (cardType) => {
	let result = {};
	for (let key of Object.keys(TEXT_FIELD_CONFIGURATION)) {
		const config = TEXT_FIELD_CONFIGURATION[key];
		//Items with null for legal_card_types are legal in all card types
		if (config.legal_card_types && !config.legal_card_types[cardType]) continue;
		result[key] = config;
	}
	return result;
};