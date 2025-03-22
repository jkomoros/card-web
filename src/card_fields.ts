import {
	REFERENCES_INFO_CARD_PROPERTY,
	REFERENCES_INFO_INBOUND_CARD_PROPERTY,
	REFERENCES_CARD_PROPERTY,
	REFERENCES_INBOUND_CARD_PROPERTY,
	COLORS
} from '../shared/card-fields.js';

import {
	Card,
	CardType,
	ReferenceType,
	CardFieldType,
	CardID
} from '../shared/types.js';

import {
	ProcessedCard,
	CardTypeConfigurationMap,
	ReferenceTypeConfigurationMap,
	CardFieldTypeConfigurationMap,
	SelectorStyleMap,
	CardFieldTypeEditableConfigurationMap,
} from './types.js';

import {
	TypedObject
} from '../shared/typed_object.js';

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
	[REFERENCES_INFO_CARD_PROPERTY]: {},
	[REFERENCES_INFO_INBOUND_CARD_PROPERTY]: {},
	[REFERENCES_CARD_PROPERTY]: {},
	[REFERENCES_INBOUND_CARD_PROPERTY]: {},
	font_size_boost: {},
	card_type: 'content',
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
	nlp: {
		body: [],
		title: [],
		subtitle: [],
		commentary: [],
		title_alternates: [],
		external_link: [],
		references_info_inbound: [],
		non_link_references: [],
		concept_references: []
	}
};

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
export const DEFAULT_CARD_TYPE : CardType = 'content';

export const CONCEPT_DEFAULT_BODY = 'This is a concept card. The following cards reference this concept.';
export const WORK_DEFAULT_BODY = 'This is a card about a work (e.g. a book, article, tweet). The following cards cite this work.';
export const PERSON_DEFAULT_BODY = 'This is a card about a person. The following cards cite this person.';

//styleBlockForCardType returns a style block appropriate for being run through
//lit-css and used to add styles that will only be activated for cards of a
//given type. selectors is an object of css selector to an array of individual
//style lines, with or without a trailing ';'.
const styleBlockForCardType = (cardType : CardType, selectors : SelectorStyleMap) : string => Object.entries(selectors).map(selectorEntry => '.container.' + cardType + ' ' + selectorEntry[0] + ' {\n' + selectorEntry[1].map(propertyEntry => '\t' + propertyEntry + (propertyEntry.endsWith(';') ? '' : (!propertyEntry.startsWith('/') ? ';' : ''))).join('\n') + '\n}\n').join('\n');

export const CARD_TYPE_CONFIGURATION : CardTypeConfigurationMap  = {
	'content': {
		description: 'The primary type of card, with a title and body.'
	},
	'section-head': {
		description: 'A section head for a section or tag. You typically don\'t create these manually',
		dark: true,
		styleBlock: styleBlockForCardType('section-head', {
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
	'working-notes': {
		description: 'A card of private rough notes, to later be forked and developed into one or more content cards',
		invertContentPublishWarning: true,
		orphanedByDefault: true,
		styleBlock: styleBlockForCardType('working-notes', {
			'section': [
				'font-size:0.8em;',
				'line-height:1.2;',
			]
		}),
		iconName: 'INSERT_DRIVE_FILE_ICON',
	},
	'concept': {
		description: 'A card denoting a concept that can be highlighted on other cards',
		orphanedByDefault: true,
		publishedByDefault: true,
		iconName: 'MENU_BOOK_ICON',
		autoSlug: 'primary',
		defaultBody: CONCEPT_DEFAULT_BODY,
	},
	'person': {
		description: 'A card of information about a person that other cards can point to as a citation',
		orphanedByDefault: true,
		publishedByDefault: true,
		iconName: 'PERSON_ICON',
		autoSlug: 'primary',
		defaultBody: PERSON_DEFAULT_BODY,
	},
	'work': {
		description: 'A card of information about an external work (article, book, tweet) that other cards can point to as a citation',
		orphanedByDefault: true,
		publishedByDefault: true,
		iconName: 'RECEIPT_ICON',
		//Don't try primary, because there are a lot of Work cards that overlap
		//with useful concepts (e.g. 'Situated Software') that we'd rather not
		//have squat on that slug.
		autoSlug: 'prefixed',
		defaultBody: WORK_DEFAULT_BODY
	},
	'quote': {
		description: 'A quote from an external source',
		orphanedByDefault: true,
		defaultBody: '<blockquote><p>This is a quote</p></blockquote>',
		iconName: 'FORMAT_QUOTE_ICON',
		styleBlock: styleBlockForCardType('quote', {
			'.primary section': [
				'display: flex;',
				'justify-content: center;'
			],
			'.primary': [
				'display: flex;',
				'flex-direction: column;',
				'justify-content: center;'
			],
			'.primary-references': [
				'display: flex;',
				'flex-direction: row;',
				'justify-content: center;'
			]
		})
	}
};

//Any key in this object is a legal reference type
export const REFERENCE_TYPES : ReferenceTypeConfigurationMap = {
	'link': {
		name: 'Body link',
		description: 'Automatically extracted links from the body of the card',
		editable: false,
		substantive: true,
		color: COLORS.LIME_GREEN,
		//already visible on the card itself
		excludeFromInfoPanel: true,
		needsReciprocation: true,
	},
	'dupe-of': {
		name: 'Duplicate of',
		description: 'Denotes that this card is a duplicate of the card that it\'s pointing to',
		editable: true,
		substantive: true,
		color: COLORS.DARK_CYAN,
	},
	'ack': {
		name: 'Non-substantive acknowledgement',
		description: 'For when a card wants to acknowledge another card, but not form a substantive link. Useful for making the missing-reference or suggested-concept go away',
		editable: true,
		substantive: false,
		color: '#CCCCCC',
		//Not important enough
		excludeFromInfoPanel: true,
	},
	'generic': {
		name: 'Generic reference',
		description: 'For a card to reference another where no other reference type makes sense',
		editable: true,
		substantive: true,
		color: COLORS.SANDY_BROWN,
		excludeFromInfoPanel: false,
	},
	'fork-of': {
		name: 'Forked from',
		description: 'For a card that was forked from another card',
		editable: true,
		substantive: true,
		color: COLORS.DARK_MAGENTA,
		excludeFromInfoPanel: false,
	},
	'mined-from': {
		name: 'Insights mined from',
		description: 'For a card that denotes that its insights are at least partially based on insights in another card',
		editable: true,
		substantive: true,
		color: COLORS.ROYAL_BLUE,
		excludeFromInfoPanel: false,
	},
	'see-also': {
		name: 'See also',
		description: 'For cards that make similar points and make sense to consume as a set',
		editable: true,
		substantive: true,
		color: COLORS.NAVY,
		//Already included in its own block
		excludeFromInfoPanel: true,
	},
	'concept': {
		name: 'Concept',
		description: 'For cards that are about a concept this card uses',
		editable: true,
		substantive: true,
		color: COLORS.DARK_KHAKI,
		//It's included in its own section
		excludeFromInfoPanel: true,
		toCardTypeAllowList: {
			'concept': true,
		},
		backportMissingText: true,
	},
	'synonym': {
		//NOTE: synonymMap effectivley pretends that an inbound synonym
		//reference should count as a reciprocal outbound reference, too.
		name: 'Interchangeable with',
		description: 'For concept cards that are synonyms of another concept card',
		editable: true,
		substantive: true,
		color: COLORS.DARK_KHAKI,
		//Printed out on concept cards, which are the only cards that can be on the from side.
		excludeFromInfoPanel: true,
		toCardTypeAllowList: {
			'concept': true,
		},
		fromCardTypeAllowList: {
			'concept': true,
		},
		backportMissingText: true,
		//Effectively a sub-type of concept reference.
		subTypeOf: 'concept',
		reciprocal: true,
	},
	'opposite-of': {
		name: 'In contrast to',
		description: 'For concept cards that are antonyms of another concept card',
		editable: true,
		substantive: true,
		color: COLORS.DARK_KHAKI,
		//Printed out on concept cards, which are the only cards that can be on the from side.
		excludeFromInfoPanel: true,
		toCardTypeAllowList: {
			'concept': true,
		},
		fromCardTypeAllowList: {
			'concept': true,
		},
		//Don't backport text since they're the opposite!
		backportMissingText: false,
		//Effectively a sub-type of concept reference.
		subTypeOf: 'concept',
		reciprocal: true,
	},
	'parallel-to': {
		name: 'Parallel to',
		description: 'For concept cards that are not quite interchangeable with other concepts, but have a parallel',
		editable: true,
		substantive: true,
		color: COLORS.DARK_KHAKI,
		//Printed out on concept cards, which are the only cards that can be on the from side.
		excludeFromInfoPanel: true,
		toCardTypeAllowList: {
			'concept': true,
		},
		fromCardTypeAllowList: {
			'concept': true,
		},
		//Don't backport text since they aren't literally that thing, just kind of similar.
		backportMissingText: false,
		//Effectively a sub-type of concept reference.
		subTypeOf: 'concept',
		reciprocal: true,
	},
	'example-of': {
		name: 'Example of',
		inboundName: 'Examples',
		description: 'For cards that are an example of a more general concept',
		editable: true,
		substantive: true,
		color: COLORS.DARK_KHAKI,
		//Printed out in info panel
		excludeFromInfoPanel: true,
		toCardTypeAllowList: {
			'concept': true,
		},
		backportMissingText: true,
		subTypeOf: 'concept',
	},
	'metaphor-for': {
		name: 'Metaphor for',
		inboundName: 'Metaphors',
		description: 'For cards that are a metaphor for a concept',
		editable: true,
		substantive: true,
		color: COLORS.DARK_KHAKI,
		//Printed out in info panel
		excludeFromInfoPanel: true,
		toCardTypeAllowList: {
			'concept': true,
		},
		backportMissingText: true,
		subTypeOf: 'concept',
	},
	'citation': {
		name: 'Citation (Work)',
		inboundName: 'Citations',
		description: 'For citing works (books, articles, tweets) that this card is partially based on.',
		editable: true,
		substantive: true,
		color: COLORS.ROYAL_BLUE,
		//Printed out separately in info panel
		excludeFromInfoPanel: true,
		toCardTypeAllowList: {
			'work': true,
		},
		//Allow inbound from any type of card that is not also a work, or a person (works can point to persons but not vice versa)
		fromCardTypeAllowList: Object.fromEntries(TypedObject.keys(CARD_TYPE_CONFIGURATION).filter(key => key != 'work' && key != 'person').map(key => [key, true])),
		backportMissingText: true,
		valueHint: 'A value in this context should be the page numbers, separated by commas'
	},
	'citation-person': {
		name: 'Citation (Person)',
		inboundName: 'Person Citations',
		description: 'For citing people whose insights this card is partially based on. Used either for citing authors from a work card, or when there isn\'t a specific work to cite, because such a card either hasn\'t been created yet or because there is no work to cite.',
		editable: true,
		substantive: true,
		color: COLORS.ROYAL_BLUE,
		//Printed out separately in info panel
		excludeFromInfoPanel: true,
		toCardTypeAllowList: {
			'person': true,
		},
		//Allow inbound from any card that is not also a person, to avoid loops.
		fromCardTypeAllowList: Object.fromEntries(TypedObject.keys(CARD_TYPE_CONFIGURATION).filter(key => key != 'person').map(key => [key, true])),
		backportMissingText: true,
		subTypeOf: 'citation',
		valueHint: 'A value in this context is typically to a URL you dont want to bother creating a work card for'
	},
};

export const REFERENCE_TYPES_THAT_BACKPORT_MISSING_TEXT = Object.fromEntries(Object.entries(REFERENCE_TYPES).filter(entry => entry[1].backportMissingText).map(entry => [entry[0], true]));
const TEMP_REFERENCE_TYPES_EQUIVALENCE_CLASSES : {[base in ReferenceType]+?: {[other in ReferenceType]+?: true}} = {};

for (const [referenceType, config] of TypedObject.entries(REFERENCE_TYPES)) {
	const baseType = config.subTypeOf || referenceType;
	if (!TEMP_REFERENCE_TYPES_EQUIVALENCE_CLASSES[baseType]) TEMP_REFERENCE_TYPES_EQUIVALENCE_CLASSES[baseType] = {};
	const base = TEMP_REFERENCE_TYPES_EQUIVALENCE_CLASSES[baseType] || {};
	base[referenceType] = true;
}
//Map of baseType ==> subTypeName ==> true. The base type will also be in its own set
export const REFERENCE_TYPES_EQUIVALENCE_CLASSES = TEMP_REFERENCE_TYPES_EQUIVALENCE_CLASSES as Required<typeof TEMP_REFERENCE_TYPES_EQUIVALENCE_CLASSES>;

//map of card-type -> map of reference-type -> true. So for a given card type,
//you can check if there are any inbound references to the card that should not
//be allowed.
export const LEGAL_INBOUND_REFERENCES_BY_CARD_TYPE = Object.fromEntries(TypedObject.keys(CARD_TYPE_CONFIGURATION).map(cardType => [cardType, Object.fromEntries(Object.entries(REFERENCE_TYPES).filter(referenceTypeEntry => !referenceTypeEntry[1].toCardTypeAllowList || referenceTypeEntry[1].toCardTypeAllowList[cardType]).map(entry => [entry[0], true]))]));
export const LEGAL_OUTBOUND_REFERENCES_BY_CARD_TYPE = Object.fromEntries(TypedObject.keys(CARD_TYPE_CONFIGURATION).map(cardType => [cardType, Object.fromEntries(Object.entries(REFERENCE_TYPES).filter(referenceTypeEntry => !referenceTypeEntry[1].fromCardTypeAllowList || referenceTypeEntry[1].fromCardTypeAllowList[cardType]).map(entry => [entry[0], true]))]));

export const TITLE_ALTERNATE_DELIMITER = ',';
export const TITLE_ALTERNATE_NEGATION = '-';

//The field that images will be inserted into
export const IMAGES_TEXT_FIELD : CardFieldType = 'body';

const DEFAULT_MAX_FONT_BOOST = 0.3;


export const TEXT_FIELD_CONFIGURATION : CardFieldTypeConfigurationMap = {
	'title': {
		html: false,
		container: 'h1',
		nonScrollable: true,
		legalCardTypes: {
			'content': true,
			'section-head': true,
			'concept': true,
			'work': true,
			'person': true,
		},
		derivedForCardTypes: {
			'working-notes': true,
			'quote': true
		},
		autoFontSizeBoostForCardTypes: {},
		matchWeight: 1.0,
	},
	'title_alternates': {
		html: false,
		container: 'h5',
		nonScrollable: true,
		legalCardTypes: {'concept': true},
		derivedForCardTypes: {},
		autoFontSizeBoostForCardTypes: {},
		matchWeight:0.95,
		noContentEditable: true,
		hideIfEmpty: true,
		extraRunDelimiter: TITLE_ALTERNATE_DELIMITER,
		description: 'Words to treat as synonyms that don\'t have their own concept cards. A \'' + TITLE_ALTERNATE_DELIMITER + '\' separates multiple ones, and ones that start with \'' +  TITLE_ALTERNATE_NEGATION + '\' will render as antonyms.' 
	},
	'body': {
		html: true,
		container: 'section',
		legalCardTypes: {
			'content': true,
			'working-notes': true,
			'concept': true,
			'work': true,
			'person': true,
			'quote': true
		},
		overrideLegalTopLevelNodes: {
			'quote': {
				'blockquote': true
			}
		},
		derivedForCardTypes: {},
		autoFontSizeBoostForCardTypes: {
			'working-notes': DEFAULT_MAX_FONT_BOOST
		},
		matchWeight:0.5
	},
	'commentary': {
		container: 'section',
		hideIfEmpty: true,
		footer: true,
		html: true,
		legalCardTypes: {
			'quote': true
		},
		description: 'Extra discussion about the body, useful for commentary on quote cards.'
	},
	'subtitle': {
		html: false,
		container: 'h2',
		legalCardTypes: {'section-head': true},
		derivedForCardTypes: {},
		autoFontSizeBoostForCardTypes: {},
		matchWeight:0.75,
	},
	'external_link': {
		html: false,
		container:'h4',
		legalCardTypes: {
			person: true,
			work: true
		},
		nonScrollable: true,
		hideIfEmpty: true,
		noContentEditable: true,
		skipIndexing: true
	},
	'references_info_inbound': {
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
	'non_link_references': {
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
	'concept_references': {
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

//types of card that have a body
export const BODY_CARD_TYPES = TEXT_FIELD_CONFIGURATION.body.legalCardTypes || {};

//types of card that may have an image
export const IMAGE_CARD_TYPES = TEXT_FIELD_CONFIGURATION[IMAGES_TEXT_FIELD].legalCardTypes;
//Throw now if it's not valid to find invalid configuration earlier.
if (!IMAGE_CARD_TYPES) throw new Error('invalid image_card_types');

export const editableFieldsForCardType = (cardType : CardType) : CardFieldTypeEditableConfigurationMap => {
	const result : Partial<CardFieldTypeConfigurationMap> = {};
	for (const key of TypedObject.keys(TEXT_FIELD_CONFIGURATION)) {
		const config = TEXT_FIELD_CONFIGURATION[key];
		//Items with null for legalCardTypes are legal in all card types
		if (config.legalCardTypes && !config.legalCardTypes[cardType]) continue;
		if (config.readOnly) continue;
		result[key] = config;
	}
	//TODO: verify it actually has all the fields.
	return result as CardFieldTypeConfigurationMap;
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

//This placeholder is useful in e.g. the suggestions pipeline where a new card
//is created.
const NEW_CARD_ID_PLACEHOLDER = 'new-card-id';

export const newCardIDPlaceholder = (index = 0) : CardID => {
	const suffix = index ? '-' + String(index) : '';
	return NEW_CARD_ID_PLACEHOLDER + suffix;
};

export const isNewCardIDPlaceholder = (id : CardID) : boolean => {
	return id.startsWith(NEW_CARD_ID_PLACEHOLDER);
};

const newCardIDIndex = (id : CardID) : number => {
	if (!isNewCardIDPlaceholder(id)) return -1;
	if (id === NEW_CARD_ID_PLACEHOLDER) return 0;
	const rawNum = id.slice((NEW_CARD_ID_PLACEHOLDER + '-').length);
	return parseInt(rawNum);
};

//If input is a new_card_id placeholder then convert it, otherwise just pass through.
export const replaceNewCardIDPlaceholder = (input : CardID, actualNewCardIDs : CardID[]) : CardID => {
	if (!isNewCardIDPlaceholder(input)) return input;
	const index = newCardIDIndex(input);
	const result = actualNewCardIDs[index];
	if (result === undefined) throw new Error(`${index} does not exist in ${actualNewCardIDs}`);
	return result;
};