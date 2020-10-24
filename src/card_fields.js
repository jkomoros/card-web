export const TEXT_FIELD_BODY = 'body';
export const TEXT_FIELD_TITLE = 'title';
export const TEXT_FIELD_SUBTITLE = 'subtitle';
export const TEXT_FIELD_LINKS_INBOUND_TEXT = 'links_inbound_text';

export const CARD_TYPE_CONTENT = 'content';
export const CARD_TYPE_SECTION_HEAD = 'section-head';
export const CARD_TYPE_WORKING_NOTES = 'working-notes';

export const VALID_CARD_TYPES = Object.fromEntries([
	CARD_TYPE_CONTENT,
	CARD_TYPE_SECTION_HEAD,
	CARD_TYPE_WORKING_NOTES
].map(key => [key, true]));



/*
html: whether or not the field allows html. NOTE: currently it's only supported
for a single field to be marked as html, and it must be called 'body'. See #345
for fixing that.

container: the type of container element the field should be printed out into
(the actual card custom element will decide whether to print it out in the first
place)

legalCardTypes: a map of CARD_TYPE constant to true for cards it is legal on.
If this field is null, it signals it's legal on all card types.

derivedForCardTypes: a map of CARD_TYPE constant to true for card types for
which the field is fully derived based on OTHER enumrated fields. Derived fields
are already "counted" so should be skipped when extracting normalized card
details for example in indexes.

readOnly: if true, a form field to edit this won't be printed out in cardEditor.

*/

export const TEXT_FIELD_CONFIGURATION = {
	[TEXT_FIELD_TITLE]: {
		html: false,
		container: 'h1',
		legalCardTypes: {[CARD_TYPE_CONTENT]: true, [CARD_TYPE_SECTION_HEAD]: true},
		derivedForCardTypes: {[CARD_TYPE_WORKING_NOTES]: true},
	},
	[TEXT_FIELD_BODY]: {
		html: true,
		container: 'section',
		legalCardTypes: {[CARD_TYPE_CONTENT]: true, [CARD_TYPE_WORKING_NOTES]: true},
		derivedForCardTypes: {},
	},
	[TEXT_FIELD_SUBTITLE]: {
		html: false,
		container: 'h2',
		legalCardTypes: {[CARD_TYPE_SECTION_HEAD]: true},
		derivedForCardTypes: {},
	},
	[TEXT_FIELD_LINKS_INBOUND_TEXT]: {
		html: false,
		readOnly: true,
		//null signals it's legal for all card types
		legalCardTypes: null,
		derivedForCardTypes: {},
	}
};

export const DERIVED_FIELDS_FOR_CARD_TYPE = Object.fromEntries(Object.keys(VALID_CARD_TYPES).map(typ => {
	return [typ, Object.fromEntries(Object.entries(TEXT_FIELD_CONFIGURATION).filter(entry => (entry[1].derivedForCardTypes || {})[typ]).map(entry => [entry[0], true]))];
}));

//types of card that have a body
export const BODY_CARD_TYPES = TEXT_FIELD_CONFIGURATION[TEXT_FIELD_BODY].legalCardTypes;

export const editableFieldsForCardType = (cardType) => {
	let result = {};
	for (let key of Object.keys(TEXT_FIELD_CONFIGURATION)) {
		const config = TEXT_FIELD_CONFIGURATION[key];
		//Items with null for legalCardTypes are legal in all card types
		if (config.legalCardTypes && !config.legalCardTypes[cardType]) continue;
		if (config.readOnly) continue;
		result[key] = config;
	}
	return result;
};