
import {
	references
} from './references.js';

import * as CONSTANTS from './card_field_constants.js';

import {
	Card,
	Cards,
	ProcessedCard,
	CardTypeConfigurationMap,
	ReferenceTypeConfigurationMap,
	CardFieldTypeConfigurationMap,
	SelectorStyleMap,
	CardType,
	ReferenceType,
	FontSizeBoostMap,
	CardFieldTypeEditable,
	CardFieldTypeEditableConfigurationMap
} from './types.js';

import {
	TypedObject
} from './typed_object.js';

import {
	CardRenderer
} from './components/card-renderer.js';

import {
	Timestamp
} from 'firebase/firestore';

export const EMPTY_CARD_ID = '?EMPTY-CARD?';

export const EMPTY_CARD : Card = {
	created: Timestamp.now(),
	updated: Timestamp.now(),
	author: '',
	permissions: {},
	collaborators: [],
	updated_substantive: Timestamp.now(),
	updated_message: Timestamp.now(),
	star_count: 0,
	star_count_manual: 0,
	tweet_favorite_count: 0,
	tweet_retweet_count: 0,
	thread_count: 0,
	thread_resolved_count: 0,
	sort_order: Number.MAX_SAFE_INTEGER / 2,
	title: '',
	section: '',
	body: '',
	[CONSTANTS.REFERENCES_INFO_CARD_PROPERTY]: {},
	[CONSTANTS.REFERENCES_INFO_INBOUND_CARD_PROPERTY]: {},
	[CONSTANTS.REFERENCES_CARD_PROPERTY]: {},
	[CONSTANTS.REFERENCES_INBOUND_CARD_PROPERTY]: {},
	font_size_boost: {},
	card_type: CONSTANTS.CARD_TYPE_CONTENT,
	notes: '',
	todo: '',
	slugs: [],
	name: '',
	tags: [],
	id: EMPTY_CARD_ID,
	published: false,
	images: [],
	auto_todo_overrides: {},
	last_tweeted: Timestamp.now(),
	tweet_count: 0
};

export const EMPTY_PROCESSED_CARD : ProcessedCard = {
	...EMPTY_CARD,
	fallbackText: {},
    importantNgrams: {},
    synonymMap: {},
    nlp: {}
}

/*

On each card is a references property and a references info.

references_info has the following shape:
{
    'CARD_ID_A': {
        'link': 'text that links to the other',
        'dupe-of': ''
    },
    'CARD_ID_B': {
        'link': '',
    }
}

That is, an object of card ids that then map to a sub-object with keys of
REFERENCE_TYPE_* to strings. The strings are the description affiliated with
that reference. For example, for links, it's the text of the link. For
citations, it might be information like "Page 22". Note that an empty string is
allowed, and counts as a reference. If the cardID is in the reference_info, then
there must be at least one reference set on the object. References_info is the
canonical object that we typically mutate and contains the information.

There's also a references field, that has the following shape:
{
    'CARD_ID_A': true,
    'CARD_ID_B': true,
}

That is, an object mapping card ids to true, IFF that card has a non-empty
references object in referenes_info. References duplicates the references_info,
but in a format that allows doing queries via Firestore (it's not possible to
query for the existence or non-existence of a subobject. You can do the orderBy
trick, but that requires a separate index for each subkey)

Cards also have references_inbound and references_info_inbound. These have
exactly the same shape, but represent the card references blocks from cards that
point TO this card. Those are maintained by modifyCardWithBatch and
createForkedCard, and basically just copy the sub-object from refrences_info to
the card that is poitned to.

*/

//The min and max sort order for card.sort_order that we should deliberately set.
export const MAX_SORT_ORDER_VALUE = Number.MAX_VALUE / 3.0;
export const MIN_SORT_ORDER_VALUE = 0.0;
//The default amount that a card's sort order should be incremented or
//decremented beyond the next one when it's not being sandwiched in between two
//known sort_orders. This is set so that it would give a reasonable spread even
//if there were denominator number of cards. So the denominator should be set to
//a number greater than any expected individual web of cards will ever have.
export const DEFAULT_SORT_ORDER_INCREMENT = (MAX_SORT_ORDER_VALUE - MIN_SORT_ORDER_VALUE) / 100000;

const DANGEROUS_SORT_ORDER_MARGIN = MAX_SORT_ORDER_VALUE / 2;

export const sortOrderIsDangerous = (proposedSortOrder : number) : boolean => {
	//Aggresively warn if we start getting to sort order values htat are at the
	//end of the allowable range. Rare, but would lead to weird overlapping
	//issues. We'll generally hit these only fater many hundreds of thousands of
	//cards are created at the edge.
	if (proposedSortOrder > (Number.MAX_VALUE - DANGEROUS_SORT_ORDER_MARGIN)) return true;
	if (proposedSortOrder < ((Number.MAX_VALUE * -1) + DANGEROUS_SORT_ORDER_MARGIN)) return true;
	return false;
};

//The card type to assume if none is specified.
export const DEFAULT_CARD_TYPE = CONSTANTS.CARD_TYPE_CONTENT;

export const CONCEPT_DEFAULT_BODY = 'This is a concept card. The following cards reference this concept.';
export const WORK_DEFAULT_BODY = 'This is a card about a work (e.g. a book, article, tweet). The following cards cite this work.';
export const PERSON_DEFAULT_BODY = 'This is a card about a person. The following cards cite this person.';

//styleBlockForCardType returns a style block appropriate for being run through
//lit-css and used to add styles that will only be activated for cards of a
//given type. selectors is an object of css selector to an array of individual
//style lines, with or without a trailing ';'.
const styleBlockForCardType = (cardType : CardType, selectors : SelectorStyleMap) : string => Object.entries(selectors).map(selectorEntry => '.container.' + cardType + ' ' + selectorEntry[0] + ' {\n' + selectorEntry[1].map(propertyEntry => '\t' + propertyEntry + (propertyEntry.endsWith(';') ? '' : (!propertyEntry.startsWith('/') ? ';' : ''))).join('\n') + '\n}\n').join('\n');

export const CARD_TYPE_CONFIGURATION : CardTypeConfigurationMap  = {
	[CONSTANTS.CARD_TYPE_CONTENT]: {
		description: 'The primary type of card, with a title and body.'
	},
	[CONSTANTS.CARD_TYPE_SECTION_HEAD]: {
		description: 'A section head for a section or tag. You typically don\'t create these manually',
		dark: true,
		styleBlock: styleBlockForCardType(CONSTANTS.CARD_TYPE_SECTION_HEAD, {
			'.background': [
				'position: absolute',
				'display: block',
				'height: 50%',
				'bottom: 0',
				'width: 100%',
				'background-color: var(--app-primary-color)',
				'/* counteract the padding in the base card */',
				'margin-left:-1.45em'
			],
			'h1': [
				'font:var(--app-header-font-family);',
				'font-weight:bold;',
				'font-size:3.0em;',
				'margin-top:2.25em;',
			],
			'h2': [
				'color: var(--app-primary-color-subtle);',
				'font-size:1.2em;',
				'font-weight:normal;',
				'position:absolute;',
				'bottom:1em;'
			],
		})
	},
	[CONSTANTS.CARD_TYPE_WORKING_NOTES]: {
		description: 'A card of private rough notes, to later be forked and developed into one or more content cards',
		invertContentPublishWarning: true,
		orphanedByDefault: true,
		styleBlock: styleBlockForCardType(CONSTANTS.CARD_TYPE_WORKING_NOTES, {
			'section': [
				'font-size:0.8em;',
				'line-height:1.2;',
			]
		}),
		iconName: 'INSERT_DRIVE_FILE_ICON',
	},
	[CONSTANTS.CARD_TYPE_CONCEPT]: {
		description: 'A card denoting a concept that can be highlighted on other cards',
		orphanedByDefault: true,
		publishedByDefault: true,
		iconName: 'MENU_BOOK_ICON',
		autoSlug: true,
		defaultBody: CONCEPT_DEFAULT_BODY,
	},
	[CONSTANTS.CARD_TYPE_PERSON]: {
		description: 'A card of information about a person that other cards can point to as a citation',
		orphanedByDefault: true,
		publishedByDefault: true,
		iconName: 'PERSON_ICON',
		autoSlug: true,
		defaultBody: PERSON_DEFAULT_BODY,
	},
	[CONSTANTS.CARD_TYPE_WORK]: {
		description: 'A card of information about an external work (article, book, tweet) that other cards can point to as a citation',
		orphanedByDefault: true,
		publishedByDefault: true,
		iconName: 'RECEIPT_ICON',
		autoSlug: true,
		defaultBody: WORK_DEFAULT_BODY,
		backportTitleExtractor : (rawCard, _, rawCards) => {
			let authors = [];
			for (const otherID of (references(rawCard).byTypeArray()[CONSTANTS.REFERENCE_TYPE_CITATION_PERSON] || [])) {
				const otherCard = rawCards[otherID];
				if (!otherCard) continue;
				authors.push(getCardTitleForBackporting(otherCard, CONSTANTS.REFERENCE_TYPE_CITATION_PERSON, rawCards));
			}
			return rawCard.title + '\n' + authors.join('\n');
		}
	},
};

//Any key in this object is a legal reference type
export const REFERENCE_TYPES : ReferenceTypeConfigurationMap = {
	[CONSTANTS.REFERENCE_TYPE_LINK]: {
		name: 'Body link',
		description: 'Automatically extracted links from the body of the card',
		editable: false,
		substantive: true,
		//limegreen
		color: '#32CD32',
		//already visible on the card itself
		excludeFromInfoPanel: true,
		needsReciprocation: true,
	},
	[CONSTANTS.REFERENCE_TYPE_DUPE_OF]: {
		name: 'Duplicate of',
		description: 'Denotes that this card is a duplicate of the card that it\'s pointing to',
		editable: true,
		substantive: true,
		//darkcyan
		color: '#008B8B',
	},
	[CONSTANTS.REFERENCE_TYPE_ACK]: {
		name: 'Non-substantive acknowledgement',
		description: 'For when a card wants to acknowledge another card, but not form a substantive link. Useful for making the missing-reference or suggested-concept go away',
		editable: true,
		substantive: false,
		color: '#CCCCCC',
		//Not important enough
		excludeFromInfoPanel: true,
	},
	[CONSTANTS.REFERENCE_TYPE_GENERIC]: {
		name: 'Generic reference',
		description: 'For a card to reference another where no other reference type makes sense',
		editable: true,
		substantive: true,
		//sandybrown
		color: '#F4A460',
		excludeFromInfoPanel: false,
	},
	[CONSTANTS.REFERENCE_TYPE_FORK_OF]: {
		name: 'Forked from',
		description: 'For a card that was forked from another card',
		editable: true,
		substantive: true,
		//darkmagenta
		color: '#8B008B',
		excludeFromInfoPanel: false,
	},
	[CONSTANTS.REFERENCE_TYPE_MINED_FROM]: {
		name: 'Insights mined from',
		description: 'For a card that denotes that its insights are at least partially based on insights in another card',
		editable: true,
		substantive: true,
		//royalblue
		color: '#4169E1',
		excludeFromInfoPanel: false,
	},
	[CONSTANTS.REFERENCE_TYPE_SEE_ALSO]: {
		name: 'See also',
		description: 'For cards that make similar points and make sense to consume as a set',
		editable: true,
		substantive: true,
		//navy
		color: '#000080',
		//Already included in its own block
		excludeFromInfoPanel: true,
	},
	[CONSTANTS.REFERENCE_TYPE_CONCEPT]: {
		name: 'Concept',
		description: 'For cards that are about a concept this card uses',
		editable: true,
		substantive: true,
		//darkkhahki
		color: '#BDB76B',
		//It's included in its own section
		excludeFromInfoPanel: true,
		toCardTypeAllowList: {
			[CONSTANTS.CARD_TYPE_CONCEPT]: true,
		},
		backportMissingText: true,
	},
	[CONSTANTS.REFERENCE_TYPE_SYNONYM]: {
		//NOTE: synonymMap effectivley pretends that an inbound synonym
		//reference should count as a reciprocal outbound reference, too.
		name: 'Interchangeable with',
		description: 'For concept cards that are synonyms of another concept card',
		editable: true,
		substantive: true,
		//darkkhahki
		color: '#BDB76B',
		//Printed out on concept cards, which are the only cards that can be on the from side.
		excludeFromInfoPanel: true,
		toCardTypeAllowList: {
			[CONSTANTS.CARD_TYPE_CONCEPT]: true,
		},
		fromCardTypeAllowList: {
			[CONSTANTS.CARD_TYPE_CONCEPT]: true,
		},
		backportMissingText: true,
		//Effectively a sub-type of concept reference.
		subTypeOf: CONSTANTS.REFERENCE_TYPE_CONCEPT,
		reciprocal: true,
	},
	[CONSTANTS.REFERENCE_TYPE_OPPOSITE_OF]: {
		name: 'In contrast to',
		description: 'For concept cards that are antonyms of another concept card',
		editable: true,
		substantive: true,
		//darkkhahki
		color: '#BDB76B',
		//Printed out on concept cards, which are the only cards that can be on the from side.
		excludeFromInfoPanel: true,
		toCardTypeAllowList: {
			[CONSTANTS.CARD_TYPE_CONCEPT]: true,
		},
		fromCardTypeAllowList: {
			[CONSTANTS.CARD_TYPE_CONCEPT]: true,
		},
		//Don't backport text since they're the opposite!
		backportMissingText: false,
		//Effectively a sub-type of concept reference.
		subTypeOf: CONSTANTS.REFERENCE_TYPE_CONCEPT,
		reciprocal: true,
	},
	[CONSTANTS.REFERENCE_TYPE_PARALLEL_TO]: {
		name: 'Parallel to',
		description: 'For concept cards that are not quite interchangeable with other concepts, but have a parallel',
		editable: true,
		substantive: true,
		//darkkhahki
		color: '#BDB76B',
		//Printed out on concept cards, which are the only cards that can be on the from side.
		excludeFromInfoPanel: true,
		toCardTypeAllowList: {
			[CONSTANTS.CARD_TYPE_CONCEPT]: true,
		},
		fromCardTypeAllowList: {
			[CONSTANTS.CARD_TYPE_CONCEPT]: true,
		},
		//Don't backport text since they aren't literally that thing, just kind of similar.
		backportMissingText: false,
		//Effectively a sub-type of concept reference.
		subTypeOf: CONSTANTS.REFERENCE_TYPE_CONCEPT,
		reciprocal: true,
	},
	[CONSTANTS.REFERENCE_TYPE_EXAMPLE_OF]: {
		name: 'Example of',
		inboundName: 'Examples',
		description: 'For cards that are an example of a more general concept',
		editable: true,
		substantive: true,
		//darkkhahki
		color: '#BDB76B',
		//Printed out in info panel
		excludeFromInfoPanel: true,
		toCardTypeAllowList: {
			[CONSTANTS.CARD_TYPE_CONCEPT]: true,
		},
		backportMissingText: true,
		subTypeOf: CONSTANTS.REFERENCE_TYPE_CONCEPT,
	},
	[CONSTANTS.REFERENCE_TYPE_METAPHOR_FOR]: {
		name: 'Metaphor for',
		inboundName: 'Metaphors',
		description: 'For cards that are a metaphor for a concept',
		editable: true,
		substantive: true,
		//darkkhahki
		color: '#BDB76B',
		//Printed out in info panel
		excludeFromInfoPanel: true,
		toCardTypeAllowList: {
			[CONSTANTS.CARD_TYPE_CONCEPT]: true,
		},
		backportMissingText: true,
		subTypeOf: CONSTANTS.REFERENCE_TYPE_CONCEPT,
	},
	[CONSTANTS.REFERENCE_TYPE_CITATION]: {
		name: 'Citation (Work)',
		inboundName: 'Citations',
		description: 'For citing works (books, articles, tweets) that this card is partially based on.',
		editable: true,
		substantive: true,
		//royalblue
		color: '#4169E1',
		//Printed out separately in info panel
		excludeFromInfoPanel: true,
		toCardTypeAllowList: {
			[CONSTANTS.CARD_TYPE_WORK]: true,
		},
		//Allow inbound from any type of card that is not also a work, or a person (works can point to persons but not vice versa)
		fromCardTypeAllowList: Object.fromEntries(Object.keys(CARD_TYPE_CONFIGURATION).filter(key => key != CONSTANTS.CARD_TYPE_WORK && key != CONSTANTS.CARD_TYPE_PERSON).map(key => [key, true])),
		backportMissingText: true,
	},
	[CONSTANTS.REFERENCE_TYPE_CITATION_PERSON]: {
		name: 'Citation (Person)',
		inboundName: 'Person Citations',
		description: 'For citing people whose insights this card is partially based on. Used either for citing authors from a work card, or when there isn\'t a specific work to cite, because such a card either hasn\'t been created yet or because there is no work to cite.',
		editable: true,
		substantive: true,
		//royalblue
		color: '#4169E1',
		//Printed out separately in info panel
		excludeFromInfoPanel: true,
		toCardTypeAllowList: {
			[CONSTANTS.CARD_TYPE_PERSON]: true,
		},
		//Allow inbound from any card that is not also a person, to avoid loops.
		fromCardTypeAllowList: Object.fromEntries(Object.keys(CARD_TYPE_CONFIGURATION).filter(key => key != CONSTANTS.CARD_TYPE_PERSON).map(key => [key, true])),
		backportMissingText: true,
		subTypeOf: CONSTANTS.REFERENCE_TYPE_CITATION,
	},
};

export const REFERENCE_TYPES_THAT_BACKPORT_MISSING_TEXT = Object.fromEntries(Object.entries(REFERENCE_TYPES).filter(entry => entry[1].backportMissingText).map(entry => [entry[0], true]));
//Map of baseType ==> subTypeName ==> true. The base type will also be in its own set
export const REFERENCE_TYPES_EQUIVALENCE_CLASSES : {[base in ReferenceType]+?: {[other in ReferenceType]+?: true}} = {};
for (let [referenceType, config] of TypedObject.entries(REFERENCE_TYPES)) {
	const baseType = config.subTypeOf || referenceType;
	if (!REFERENCE_TYPES_EQUIVALENCE_CLASSES[baseType]) REFERENCE_TYPES_EQUIVALENCE_CLASSES[baseType] = {};
	REFERENCE_TYPES_EQUIVALENCE_CLASSES[baseType][referenceType] = true;
}

//map of card-type -> map of reference-type -> true. So for a given card type,
//you can check if there are any inbound references to the card that should not
//be allowed.
export const LEGAL_INBOUND_REFERENCES_BY_CARD_TYPE = Object.fromEntries(TypedObject.keys(CARD_TYPE_CONFIGURATION).map(cardType => [cardType, Object.fromEntries(Object.entries(REFERENCE_TYPES).filter(referenceTypeEntry => !referenceTypeEntry[1].toCardTypeAllowList || referenceTypeEntry[1].toCardTypeAllowList[cardType]).map(entry => [entry[0], true]))]));
export const LEGAL_OUTBOUND_REFERENCES_BY_CARD_TYPE = Object.fromEntries(TypedObject.keys(CARD_TYPE_CONFIGURATION).map(cardType => [cardType, Object.fromEntries(Object.entries(REFERENCE_TYPES).filter(referenceTypeEntry => !referenceTypeEntry[1].fromCardTypeAllowList || referenceTypeEntry[1].fromCardTypeAllowList[cardType]).map(entry => [entry[0], true]))]));

const TITLE_ALTERNATE_DELIMITER = ',';
const TITLE_ALTERNATE_NEGATION = '-';

/*

This approach of allowing 'opposites' of cards to be represented in
title_alternates with a special prefix makes it so all of the other downstream
text processing works, while still making it clear that the term is the opposite of the primary term.

*/
const titleAlternatesHTMLFormatter = (value : string) : string => {
	if (!value) return value;
	const synonyms = [];
	const antonyms = [];
	for (const str of value.split(TITLE_ALTERNATE_DELIMITER)) {
		const trimmedStr = str.trim();
		if (!trimmedStr) continue;
		if (trimmedStr[0] == TITLE_ALTERNATE_NEGATION) {
			//Replace the first instance of the negator only, leaving the rest of whitespace intact
			antonyms.push(str.replace(TITLE_ALTERNATE_NEGATION, ''));
		} else {
			synonyms.push(str);
		}
	}
	let result = '';
	if (synonyms.length) result += '<span>Also known as</span> ' + synonyms.join(TITLE_ALTERNATE_DELIMITER);
	if (synonyms.length && antonyms.length) result += ' ';
	if (antonyms.length) result += '<span>In contrast to</span> ' + antonyms.join(TITLE_ALTERNATE_DELIMITER);
	return result;
};

//The field that images will be inserted into
export const IMAGES_TEXT_FIELD = CONSTANTS.TEXT_FIELD_BODY;

const DEFAULT_MAX_FONT_BOOST = 0.3;

export const TEXT_FIELD_CONFIGURATION : CardFieldTypeConfigurationMap = {
	[CONSTANTS.TEXT_FIELD_TITLE]: {
		html: false,
		container: 'h1',
		nonScrollable: true,
		legalCardTypes: {
			[CONSTANTS.CARD_TYPE_CONTENT]: true,
			[CONSTANTS.CARD_TYPE_SECTION_HEAD]: true,
			[CONSTANTS.CARD_TYPE_CONCEPT]: true,
			[CONSTANTS.CARD_TYPE_WORK]: true,
			[CONSTANTS.CARD_TYPE_PERSON]: true,
		},
		derivedForCardTypes: {
			[CONSTANTS.CARD_TYPE_WORKING_NOTES]: true
		},
		autoFontSizeBoostForCardTypes: {},
		matchWeight: 1.0,
	},
	[CONSTANTS.TEXT_FIELD_TITLE_ALTERNATES]: {
		html: false,
		container: 'h5',
		nonScrollable: true,
		legalCardTypes: {[CONSTANTS.CARD_TYPE_CONCEPT]: true},
		derivedForCardTypes: {},
		autoFontSizeBoostForCardTypes: {},
		matchWeight:0.95,
		noContentEditable: true,
		hideIfEmpty: true,
		htmlFormatter: titleAlternatesHTMLFormatter,
		extraRunDelimiter: TITLE_ALTERNATE_DELIMITER,
		description: 'Words to treat as synonyms that don\'t have their own concept cards. A \'' + TITLE_ALTERNATE_DELIMITER + '\' separates multiple ones, and ones that start with \'' +  TITLE_ALTERNATE_NEGATION + '\' will render as antonyms.' 
	},
	[CONSTANTS.TEXT_FIELD_BODY]: {
		html: true,
		container: 'section',
		legalCardTypes: {
			[CONSTANTS.CARD_TYPE_CONTENT]: true,
			[CONSTANTS.CARD_TYPE_WORKING_NOTES]: true,
			[CONSTANTS.CARD_TYPE_CONCEPT]: true,
			[CONSTANTS.CARD_TYPE_WORK]: true,
			[CONSTANTS.CARD_TYPE_PERSON]: true,
		},
		derivedForCardTypes: {},
		autoFontSizeBoostForCardTypes: {
			[CONSTANTS.CARD_TYPE_WORKING_NOTES]: DEFAULT_MAX_FONT_BOOST
		},
		matchWeight:0.5
	},
	[CONSTANTS.TEXT_FIELD_SUBTITLE]: {
		html: false,
		container: 'h2',
		legalCardTypes: {[CONSTANTS.CARD_TYPE_SECTION_HEAD]: true},
		derivedForCardTypes: {},
		autoFontSizeBoostForCardTypes: {},
		matchWeight:0.75,
	},
	[CONSTANTS.TEXT_FIELD_REFERENCES_INFO_INBOUND]: {
		html: false,
		readOnly: true,
		//null signals it's legal for all card types
		legalCardTypes: null,
		derivedForCardTypes: {},
		autoFontSizeBoostForCardTypes: {},
		matchWeight:0.95,
	},
	//This one has a custom extractor, so its name doesn't correspond to a
	//literl field. It's the text of outbound references, except links. The
	//logic is that links are already represented in text in the body, but every
	//other type of reference is not, so it should count for indexing. This is
	//also where backported reference text shows up.
	[CONSTANTS.TEXT_FIELD_REFERENCES_NON_LINK_OUTBOUND]: {
		html: false,
		readOnly: true,
		//null signals it's legal for all card types
		legalCardTypes: null,
		derivedForCardTypes: {},
		autoFontSizeBoostForCardTypes: {},
		matchWeight:0.5,
		overrideExtractor: true,
	},
	//This counts outboudn reference text to concepts. That text will have
	//already been counted in TEXT_FIELD_REFERENCES_NON_LINK_OUTBOUND, so this
	//has the effect of triple counting concepts since theyr'e so important.
	//NOTE: fingerprint.itemsFromConceptReferences in nlp.js relies on this configuration
	[CONSTANTS.TEXT_FIELD_RERERENCES_CONCEPT_OUTBOUND]: {
		html: false,
		readOnly: true,
		//null signals it's legal for all card types
		legalCardTypes: null,
		derivedForCardTypes: {},
		autoFontSizeBoostForCardTypes: {},
		matchWeight:0.75,
		overrideExtractor: true,
		indexFullRun: true,
	}
};

export const DERIVED_FIELDS_FOR_CARD_TYPE = Object.fromEntries(TypedObject.keys(CARD_TYPE_CONFIGURATION).map(typ => {
	return [typ, Object.fromEntries(TypedObject.entries(TEXT_FIELD_CONFIGURATION).filter(entry => entry[1].derivedForCardTypes ? entry[1].derivedForCardTypes[typ] : false).map(entry => [entry[0], true]))];
}));

const AUTO_FONT_SIZE_BOOST_FIELDS_FOR_CARD_TYPE : {[cardType in CardType]+?: {[fieldType in CardFieldTypeEditable]+?: true}} = Object.fromEntries(TypedObject.keys(CARD_TYPE_CONFIGURATION).map(typ => {
	return [typ, Object.fromEntries(TypedObject.entries(TEXT_FIELD_CONFIGURATION).filter(entry => entry[1].autoFontSizeBoostForCardTypes ? entry[1].autoFontSizeBoostForCardTypes[typ] : false).map(entry => [entry[0], true]))];
}));

//types of card that have a body
export const BODY_CARD_TYPES = TEXT_FIELD_CONFIGURATION[CONSTANTS.TEXT_FIELD_BODY].legalCardTypes;

//types of card that may have an image
export const IMAGE_CARD_TYPES = TEXT_FIELD_CONFIGURATION[IMAGES_TEXT_FIELD].legalCardTypes;

export const editableFieldsForCardType = (cardType : CardType) : CardFieldTypeEditableConfigurationMap => {
	let result : CardFieldTypeConfigurationMap = {};
	for (let key of TypedObject.keys(TEXT_FIELD_CONFIGURATION)) {
		const config = TEXT_FIELD_CONFIGURATION[key];
		//Items with null for legalCardTypes are legal in all card types
		if (config.legalCardTypes && !config.legalCardTypes[cardType]) continue;
		if (config.readOnly) continue;
		result[key] = config;
	}
	return result;
};

//The special key card ID that will be replaced with a given card in reference
//blocks, and that filters know how to accept and treat specially. This special
//key card ID is looked for in two places: reference_blocks, when they 'burn in'
//a key card for navigation, and also every configurable filter that accepts IDs
//as configuration arguments handles them specially. This is so that the
//memoization machinery to create a new configurable filter can be used ONCE,
//and just invalidate the memoization of the internal calculations of the
//configurable function that depends on the keyCardID. A key card is the card to
//'pivot' off of, and is typically the active card, but not always.
export const KEY_CARD_ID_PLACEHOLDER = 'key-card-id';

//Returns an object with field -> boosts to set. It will return
//card.font_size_boosts if no change, or an object like font_size_boosts, but
//with modifications made as appropriate leaving any untouched keys the same,
//and any keys it modifies but sets to 0.0 deleted.
export const fontSizeBoosts = async (card : Card) : Promise<FontSizeBoostMap> => {
	if (!card) return {};
	const fields = AUTO_FONT_SIZE_BOOST_FIELDS_FOR_CARD_TYPE[card.card_type] || {};
	const currentBoost = card.font_size_boost || {};
	if (Object.keys(fields).length === 0) return currentBoost;
	const result : FontSizeBoostMap = {...currentBoost};
	for (const field of TypedObject.keys(fields)) {
		const boost = await calculateBoostForCardField(card, field);
		if (boost == 0.0) {
			if (result[field] !== undefined) delete result[field];
			continue;
		}
		result[field] = boost;
	}
	return result;
};

type CardRendererProvider = {
	sizingCardRenderer : CardRenderer
}

let cardRendererProvider : CardRendererProvider = null;

//Custom elements that have a sizing card-renderer should all this to offer
//themselves up. This module can't create its own card-renderer because a)
//importing card-renderer leads to a circular dependency, but also because the
//card-renderer has to be within the main web app to get the right css vars so
//it can size accurately. provider should hae a sizingCardRenderer property we
//can fetch an instance of card-renderer from that we may inject our own card
//into.
export const setFontSizingCardRendererProvider = (provider : CardRendererProvider) => {
	if (!cardRendererProvider) cardRendererProvider = provider;
};

const MAX_FONT_BOOST_BISECT_STEPS = 3;

//calculateBoostForCardField is an expensive method because it repeatedly
//changes layout and then reads it back. But even with that, it typically takes
//less than 15ms or so on a normal computer.
const calculateBoostForCardField = async (card : Card, field : CardFieldTypeEditable) : Promise<number> => {

	const max = TEXT_FIELD_CONFIGURATION[field].autoFontSizeBoostForCardTypes[card.card_type];
	let low = 0.0;
	let high = max;
	let alwaysLow = true;
	let alwaysHigh = true;

	let middle = ((high - low) / 2) + low;
	let count = 0;
	while (count < MAX_FONT_BOOST_BISECT_STEPS) {
		const overflows = await cardOverflowsFieldForBoost(card, field, middle);
		if (overflows) {
			high = middle;
			alwaysHigh = false;
		} else {
			low = middle;
			alwaysLow = false;
		}
		middle = ((high - low) / 2) + low;
		count++;
	}
	//No matter where we stopped, the value of middle might now overflow (even
	//if there had been no overflows yet). Check one more time. If it does
	//overflow, round down.
	const overflows = await cardOverflowsFieldForBoost(card, field, middle);
	if (overflows) {
		middle = low;
		alwaysHigh = false;
	}

	//Check if it should return the extremes
	if (alwaysHigh && !await cardOverflowsFieldForBoost(card, field, max)) return max;
	if (alwaysLow && await cardOverflowsFieldForBoost(card, field, 0.0)) return 0.0;

	return middle;
};

const cardOverflowsFieldForBoost = async (card : Card, field : CardFieldTypeEditable, proposedBoost : number) : Promise<boolean> => {
	if (!cardRendererProvider) {
		console.warn('No card renderer provider provided');
		return false;
	}
	let ele = cardRendererProvider.sizingCardRenderer;
	if (!ele) {
		console.warn('No active card renderer');
		return false;
	}
	let tempCard : ProcessedCard = {...EMPTY_PROCESSED_CARD, ...card, font_size_boost: {...card.font_size_boost, [field]:proposedBoost}};
	ele.card = tempCard;
	await ele.updateComplete;
	const isOverflowing = ele.isOverflowing();
	return isOverflowing;
};

//eslint-disable-next-line no-unused-vars
export const getCardTitleForBackporting = (rawCard : Card, referenceType : ReferenceType, rawCards : Cards) : string => {
	const config = CARD_TYPE_CONFIGURATION[rawCard.card_type];
	if (config) {
		const f = config.backportTitleExtractor;
		if (f) {
			return f(rawCard, referenceType, rawCards);
		}
	}
	return rawCard.title;
};