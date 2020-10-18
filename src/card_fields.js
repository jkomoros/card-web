export const TEXT_FIELD_BODY = 'body';
export const TEXT_FIELD_TITLE = 'title';
export const TEXT_FIELD_SUBTITLE = 'subtitle';

export const CARD_TYPE_CONTENT = 'content';
export const CARD_TYPE_SECTION_HEAD = 'section-head';
export const CARD_TYPE_WORKING_NOTES = 'working-notes';

export const VALID_CARD_TYPES = Object.fromEntries([
	CARD_TYPE_CONTENT,
	CARD_TYPE_SECTION_HEAD,
	CARD_TYPE_WORKING_NOTES
].map(key => [key, true]));

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