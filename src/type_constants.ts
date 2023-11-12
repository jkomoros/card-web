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

//Recreated in functions/src/embedding.ts
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
} as const;

export const TEXT_FIELD_TYPES = {
	...TEXT_FIELD_TYPES_EDITABLE,
	[TEXT_FIELD_REFERENCES_INFO_INBOUND]: true,
	[TEXT_FIELD_REFERENCES_NON_LINK_OUTBOUND]: true,
	[TEXT_FIELD_RERERENCES_CONCEPT_OUTBOUND]: true,
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

export const COMMIT_ACTION_CONSOLE_LOG = 'CONSOLE_LOG';
export const COMMIT_ACTION_EDIT_MESSAGE = 'EDIT_MESSAGE';
export const COMMIT_ACTION_ADD_MESSAGE = 'ADD_MESSAGE';
export const COMMIT_ACTION_CREATE_THREAD = 'CREATE_THREAD';

export const COMMIT_ACTION_TYPES = {
	[COMMIT_ACTION_CONSOLE_LOG]: true,
	[COMMIT_ACTION_EDIT_MESSAGE]: true,
	[COMMIT_ACTION_ADD_MESSAGE]: true,
	[COMMIT_ACTION_CREATE_THREAD]: true
};

export const SORT_NAME_DEFAULT = 'default';
export const SORT_NAME_RECENT = 'recent';
export const SORT_NAME_STARS = 'stars';
export const SORT_NAME_ORIGINAL_ORDER = 'original-order';
export const SORT_NAME_LINK_COUNT = 'link-count';
export const SORT_NAME_UPDATED = 'updated';
export const SORT_NAME_CREATED = 'created';
export const SORT_NAME_COMMENTED = 'commented';
export const SORT_NAME_LAST_TWEETED = 'last-tweeted';
export const SORT_NAME_TWEET_COUNT = 'tweet-count';
export const SORT_NAME_TWEET_ORDER = 'tweet-order';
export const SORT_NAME_TODO_DIFFICULTY = 'todo-difficulty';
export const SORT_NAME_RANDOM = 'random';
export const SORT_NAME_CARD_RANK = 'card-rank';

export const SORT_NAME_TYPES = {
	[SORT_NAME_DEFAULT]: true,
	[SORT_NAME_RECENT]: true,
	[SORT_NAME_STARS]: true,
	[SORT_NAME_ORIGINAL_ORDER]: true,
	[SORT_NAME_LINK_COUNT]: true,
	[SORT_NAME_UPDATED]: true,
	[SORT_NAME_CREATED]: true,
	[SORT_NAME_COMMENTED]: true,
	[SORT_NAME_LAST_TWEETED]: true,
	[SORT_NAME_TWEET_COUNT]: true,
	[SORT_NAME_TWEET_ORDER]: true,
	[SORT_NAME_TODO_DIFFICULTY]: true,
	[SORT_NAME_RANDOM]: true,
	[SORT_NAME_CARD_RANK]: true
};

export const TAB_CONFIG_DEFAULT_TABS = 'default_tabs';
export const TAB_CONFIG_DEFAULT_END_TABS = 'default_end_tabs';
export const TAB_CONFIG_SECTIONS = 'sections';
export const TAB_CONFIG_HIDDEN_SECTIONS = 'hidden_sections';
export const TAB_CONFIG_TAGS = 'tags';
export const TAB_CONFIG_HIDDEN_TAGS = 'hidden_tags';
export const TAB_CONFIG_POPULAR = 'popular';
export const TAB_CONFIG_RECENT = 'recent';
export const TAB_CONFIG_READING_LIST = 'reading-list';
export const TAB_CONFIG_STARRED = 'starred';
export const TAB_CONFIG_UNREAD = 'unread';
export const TAB_CONFIG_WORKING_NOTES = 'working-notes';
export const TAB_CONFIG_CONCEPTS = 'concepts';
export const TAB_CONFIG_TWITTER = 'twitter';
export const TAB_CONFIG_RANDOM = 'random';

export const TAB_CONFIG_TYPES = {
	[TAB_CONFIG_DEFAULT_TABS]: true,
	[TAB_CONFIG_DEFAULT_END_TABS]: true,
	[TAB_CONFIG_SECTIONS]: true,
	[TAB_CONFIG_HIDDEN_SECTIONS]: true,
	[TAB_CONFIG_TAGS]: true,
	[TAB_CONFIG_HIDDEN_TAGS]: true,
	[TAB_CONFIG_POPULAR]: true,
	[TAB_CONFIG_RECENT]: true,
	[TAB_CONFIG_READING_LIST]: true,
	[TAB_CONFIG_STARRED]: true,
	[TAB_CONFIG_UNREAD]: true,
	[TAB_CONFIG_WORKING_NOTES]: true,
	[TAB_CONFIG_CONCEPTS]: true,
	[TAB_CONFIG_TWITTER]: true,
	[TAB_CONFIG_RANDOM]: true
};

export const AI_DIALOG_TYPE_CARD_SUMMARY = 'summary';
export const AI_DIALOG_TYPE_SUGGEST_TITLE = 'title';
export const AI_DIALOG_TYPE_MISSING_CONCEPTS = 'concepts';

export const AI_DIALOG_TYPES = {
	[AI_DIALOG_TYPE_CARD_SUMMARY]: true,
	[AI_DIALOG_TYPE_SUGGEST_TITLE]: true,
	[AI_DIALOG_TYPE_MISSING_CONCEPTS]: true
};

export const CARDS_COLLECTION = 'cards';
export const CARD_UPDATES_COLLECTION = 'updates';
export const SECTION_UPDATES_COLLECTION = 'updates';
export const SECTIONS_COLLECTION = 'sections';
export const TAGS_COLLECTION = 'tags';
export const TAG_UPDATES_COLLECTION = 'updates';
export const MAINTENANCE_COLLECTION = 'maintenance_tasks';
export const AUTHORS_COLLECTION = 'authors';
export const THREADS_COLLECTION = 'threads';
export const MESSAGES_COLLECTION = 'messages';
export const STARS_COLLECTION = 'stars';
export const READS_COLLECTION = 'reads';
//The user of this is actually clsoer to "userInfos", but that sounded weird.
//This is a cache of information related to users, like whether htey're
//anonymous, and when they were last seen. We never use it on the client, just
//report up so the info exists on the server.
export const USERS_COLLECTION = 'users';
export const READING_LISTS_COLLECTION = 'reading_lists';
export const READING_LISTS_UPDATES_COLLECTION = 'updates';
export const PERMISSIONS_COLLECTION = 'permissions';
export const TWEETS_COLLECTION = 'tweets';

export const FIND_CARD_OPEN = 'FIND_CARD_OPEN';
export const FIND_CARD_TO_LINK = 'FIND_CARD_TO_LINK';
export const FIND_CARD_TO_REFERENCE = 'FIND_CARD_TO_REFERENCE';
export const FIND_CARD_TO_PERMISSION = 'FIND_CARD_TO_PERMISSION';