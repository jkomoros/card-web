//NOTE: this next one is duplicated in tweet-helpers.js and both are in
//functions/updates.js;
export const REFERENCES_INFO_CARD_PROPERTY = 'references_info';
//Also referenced directly in firestore.TEMPLATE.rules
export const REFERENCES_INFO_INBOUND_CARD_PROPERTY = 'references_info_inbound';
//These two properties are exactly like the normal references fields exccept
//it's a map of cardID -> true for cards that are referenced.
export const REFERENCES_CARD_PROPERTY = 'references';
//Also referenced directly in firestore.TEMPLATE.rules
export const REFERENCES_INBOUND_CARD_PROPERTY = 'references_inbound';

export const TEXT_FIELD_BODY = 'body';
export const TEXT_FIELD_TITLE = 'title';
export const TEXT_FIELD_SUBTITLE = 'subtitle';
//Also duplicated in card-renderer styles
export const TEXT_FIELD_TITLE_ALTERNATES = 'title_alternates';
export const TEXT_FIELD_REFERENCES_INFO_INBOUND = REFERENCES_INFO_INBOUND_CARD_PROPERTY;
export const TEXT_FIELD_REFERENCES_NON_LINK_OUTBOUND = 'non_link_references';
export const TEXT_FIELD_RERERENCES_CONCEPT_OUTBOUND = 'concept_references';

//CardFieldType and EditableCardFieldType is driven off of these keys. Note the
//membership in each object need to be consistent with
//TEXT_fIELD_CONIGURATION.readOnly

export const TEXT_FIELD_TYPES_EDITABLE = {
	[TEXT_FIELD_BODY]: true,
	[TEXT_FIELD_TITLE]: true,
	[TEXT_FIELD_SUBTITLE]: true,
	[TEXT_FIELD_TITLE_ALTERNATES]: true
};

export const TEXT_FIELD_TYPES = {
	...TEXT_FIELD_TYPES_EDITABLE,
	[TEXT_FIELD_REFERENCES_INFO_INBOUND]: true,
	[TEXT_FIELD_REFERENCES_NON_LINK_OUTBOUND]: true,
	[TEXT_FIELD_RERERENCES_CONCEPT_OUTBOUND]: true,
};

export const CARD_TYPE_CONTENT = 'content';
export const CARD_TYPE_SECTION_HEAD = 'section-head';
export const CARD_TYPE_WORKING_NOTES = 'working-notes';
export const CARD_TYPE_CONCEPT = 'concept';
export const CARD_TYPE_WORK = 'work';
export const CARD_TYPE_PERSON = 'person';

//CardType literal values are driven off of this object
export const CARD_TYPE_TYPES = {
	[CARD_TYPE_CONTENT]: true,
	[CARD_TYPE_SECTION_HEAD]: true,
	[CARD_TYPE_WORKING_NOTES]: true,
	[CARD_TYPE_CONCEPT]: true,
	[CARD_TYPE_WORK]: true,
	[CARD_TYPE_PERSON]: true,
};

//For card-links within body content
//NOTE: duplicated in tweet-helpers.js
export const REFERENCE_TYPE_LINK = 'link';
//For cards that are dupes of another card
export const REFERENCE_TYPE_DUPE_OF = 'dupe-of';
//For cards that want to acknowledge another card (e.g. to get the 'missing
//reciprocal links' to go away) without actually doing a more substantive
//reference. These references typically shouldn't 'count' in many cases.
export const REFERENCE_TYPE_ACK = 'ack';
//For references that aren't any of the other types
export const REFERENCE_TYPE_GENERIC = 'generic';
//For cards that were forked from another--that is, whose content started as a
//direct copy of the other card at some point
export const REFERENCE_TYPE_FORK_OF = 'fork-of';
//For cards that want to express they are based on insights 'mined' from the
//other card--typically a working-notes card.
export const REFERENCE_TYPE_MINED_FROM = 'mined-from';
//For cards that want to say you should also see a related card that is similar,
//a kind of peer.
export const REFERENCE_TYPE_SEE_ALSO = 'see-also';
//For saying that the card that is pointing from uses the concept pointed to at
//the other card. The other card may only be a concept card.
export const REFERENCE_TYPE_CONCEPT = 'concept';
//For concept cards that are synonym of another concept card. Conceptually a
//sub-type of the concept reference type.
export const REFERENCE_TYPE_SYNONYM = 'synonym';
//For concept cards that are the antonym of another concept card. Conceptually a
//sub-type of the concept reference type.
export const REFERENCE_TYPE_OPPOSITE_OF = 'opposite-of';
//For concept cards that are not strict synonyms of another card, but have a
//parallel to them. Conceptually a sub-type of the concept reference type.
export const REFERENCE_TYPE_PARALLEL_TO = 'parallel-to';
//For cards that are an example of a more generic concept that is pointed to.
//Conceptually a sub-type of the concept reference type.
export const REFERENCE_TYPE_EXAMPLE_OF = 'example-of';
//For cards that are a metaphor for a concept. Conceptually a sub-type of the
//concept reference type.
export const REFERENCE_TYPE_METAPHOR_FOR = 'metaphor-for';
export const REFERENCE_TYPE_CITATION = 'citation';
export const REFERENCE_TYPE_CITATION_PERSON = 'citation-person';

//ReferenceType literal values are driven off of this object
export const REFERENCE_TYPE_TYPES = {
	[REFERENCE_TYPE_LINK]: true,
	[REFERENCE_TYPE_DUPE_OF]: true,
	[REFERENCE_TYPE_ACK] : true,
	[REFERENCE_TYPE_GENERIC]: true,
	[REFERENCE_TYPE_FORK_OF]: true,
	[REFERENCE_TYPE_MINED_FROM]: true,
	[REFERENCE_TYPE_SEE_ALSO]: true,
	[REFERENCE_TYPE_CONCEPT]: true,
	[REFERENCE_TYPE_SYNONYM]: true,
	[REFERENCE_TYPE_OPPOSITE_OF]: true,
	[REFERENCE_TYPE_PARALLEL_TO]: true,
	[REFERENCE_TYPE_EXAMPLE_OF]: true,
	[REFERENCE_TYPE_METAPHOR_FOR]: true,
	[REFERENCE_TYPE_CITATION]: true,
	[REFERENCE_TYPE_CITATION_PERSON]: true
};

export const BEFORE_FILTER_NAME = 'before';
export const AFTER_FILTER_NAME = 'after';
export const BETWEEN_FILTER_NAME = 'between';

export const DATE_RANGE_TYPES = {
	[BEFORE_FILTER_NAME]: true,
	[AFTER_FILTER_NAME]: true,
	[BETWEEN_FILTER_NAME]: true,
};

export const URL_PART_DATE_SECTION = 'date';
export const URL_PART_FREE_TEXT = 'text';
export const URL_PART_KEY_CARD = 'key-card';
export const URL_PART_INT = 'int';
export const URL_PART_FLOAT = 'float';
export const URL_PART_REFERENCE_TYPE = 'reference-type';
export const URL_PART_USER_ID = 'user-id';
export const URL_PART_SUB_FILTER = 'sub-filter';
export const URL_PART_MULTIPLE_CARDS = 'multiple-cards';
export const URL_PART_CONCEPT_STR_OR_ID = 'concept-str-or-id';
//A sub-filter that expand knows how to pass multiple cards to
export const URL_PART_EXPAND_FILTER = 'expand-filter';

//These drive ConfigurableFilterFuncURLPart type
export const URL_PART_TYPES = {
	[URL_PART_DATE_SECTION]: true,
	[URL_PART_FREE_TEXT] : true,
	[URL_PART_KEY_CARD] : true,
	[URL_PART_INT] : true,
	[URL_PART_FLOAT] : true,
	[URL_PART_REFERENCE_TYPE] : true,
	[URL_PART_USER_ID] : true,
	[URL_PART_SUB_FILTER] : true,
	[URL_PART_MULTIPLE_CARDS] : true,
	[URL_PART_CONCEPT_STR_OR_ID] : true,
	[URL_PART_EXPAND_FILTER] : true
};

//Will position left. Multiple images will go to the right of the one
//immediatebly before them.
export const IMAGE_POSITION_TOP_LEFT = 'top-left';
//Like top-left, but images after the first will stack below the ones before
//them. For the first image, equivalent to top-left.
export const IMAGE_POSITION_LEFT = 'left';
//Will position right. Multiple images will go to the left of the one
//immediately before them.
export const IMAGE_POSITION_TOP_RIGHT = 'top-right';
//Like top-right, but images after the first will stack below the ones before
//them. For the first image, equivalent to top-right.
export const IMAGE_POSITION_RIGHT = 'right';

//Drives ImagePositionType
export const IMAGE_POSITION_TYPES = {
	[IMAGE_POSITION_LEFT]: true,
	[IMAGE_POSITION_RIGHT]: true,
	[IMAGE_POSITION_TOP_LEFT]: true,
	[IMAGE_POSITION_TOP_RIGHT]: true,
};

export const DEFAULT_SET_NAME = 'main';
//reading-list is a set (as well as filters, e.g. `in-reading-list`) since the
//order matters and is customizable by the user. Every other collection starts
//from the `all` set and then filters and then maybe sorts, but reading-list
//lets a custom order.
export const READING_LIST_SET_NAME = 'reading-list';
export const EVERYTHING_SET_NAME = 'everything';

//Drives SetName type
export const SET_NAME_TYPES = {
	[DEFAULT_SET_NAME]: true,
	[READING_LIST_SET_NAME]: true,
	[EVERYTHING_SET_NAME]: true
};

export const DEFAULT_VIEW_MODE = 'list';
export const VIEW_MODE_WEB = 'web';

//Drives ViewMode type
export const VIEW_MODE_TYPES = {
	[DEFAULT_VIEW_MODE]: true,
	[VIEW_MODE_WEB]: true
};

export const TAB_CONTENT = 'content';
export const TAB_CONFIG = 'config';

//Drives EditorTab type
export const EDITOR_TAB_TYPES = {
	[TAB_CONTENT]: true,
	[TAB_CONFIG]: true
};

export const EDITOR_TAB_CONTENT = 'content';
export const EDITOR_TAB_NOTES = 'notes';
export const EDITOR_TAB_TODO = 'todo';

//Drives EditorContentTab type
export const EDITOR_CONTENT_TAB_TYPES = {
	[EDITOR_TAB_CONTENT]: true,
	[EDITOR_TAB_NOTES]: true,
	[EDITOR_TAB_TODO]: true,
};