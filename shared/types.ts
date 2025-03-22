import {
	z
} from 'zod';

import {
	Timestamp
} from './timestamp.js';

import * as icons from './../shared/icons.js';

export type IconName = keyof(typeof icons);

export type Uid = string;

export type CardID = string;
export type Slug = string;
export type CardIdentifier = CardID | Slug;

//Inspired by https://stackoverflow.com/a/54520829
type KeysMatching<T, V> = {[K in keyof T]-?: T[K] extends V ? K : never}[keyof T];

// CardType - duplicated from src/types.ts
export const cardTypeSchema = z.enum([
	'content',
	'section-head',
	'working-notes',
	'concept',
	'work',
	'person',
	'quote'
]);

export type CardType = z.infer<typeof cardTypeSchema>;

export const referenceTypeSchema = z.enum([
	//For card-links within body content
	//NOTE: duplicated in tweet-helpers.js
	'link',
	//For cards that are dupes of another card
	'dupe-of',
	//For cards that want to acknowledge another card (e.g. to get the 'missing
	//reciprocal links' to go away) without actually doing a more substantive
	//reference. These references typically shouldn't 'count' in many cases.
	'ack',
	//For references that aren't any of the other types
	'generic',
	//For cards that were forked from another--that is, whose content started as a
	//direct copy of the other card at some point
	'fork-of',
	//For cards that want to express they are based on insights 'mined' from the
	//other card--typically a working-notes card.
	'mined-from',
	//For cards that want to say you should also see a related card that is similar,
	//a kind of peer.
	'see-also',
	//For saying that the card that is pointing from uses the concept pointed to at
	//the other card. The other card may only be a concept card.
	'concept',
	//For concept cards that are synonym of another concept card. Conceptually a
	//sub-type of the concept reference type.
	'synonym',
	//For concept cards that are the antonym of another concept card. Conceptually a
	//sub-type of the concept reference type.
	'opposite-of',
	//For concept cards that are not strict synonyms of another card, but have a
	//parallel to them. Conceptually a sub-type of the concept reference type.
	'parallel-to',
	//For cards that are an example of a more generic concept that is pointed to.
	//Conceptually a sub-type of the concept reference type.
	'example-of',
	//For cards that are a metaphor for a concept. Conceptually a sub-type of the
	//concept reference type.
	'metaphor-for',
	'citation',
	'citation-person'
]);

export type ReferenceType = z.infer<typeof referenceTypeSchema>;

export type ReferencesInfoMap = {
	[id : CardID]: {
		[typ in ReferenceType]+?: string
	}
};

export type ReferencesInfoMapByType = {
	[typ in ReferenceType]+?: {
		[id : CardID]: string
	}
};

export type ReferencesArrayByType = {
	[typ in ReferenceType]+?: CardID[]
};

export type CardBooleanMap = {
	[id : CardID] : boolean
};

export type FilterMap = {
	[id : CardID] : true
};

export type Filters = {
	[filterName : ConcreteFilterName] : FilterMap
};

export type SectionID = string;
export type TagID = string;

// Core fields for Section that both client and server need
export interface SectionCore {
	cards: CardID[];
}

// UserPermissionsCore defines the base permission types
export interface UserPermissionsCore {
	admin?: boolean;
	viewApp?: boolean;
	edit?: boolean;
	editSection?: boolean;
	editTag?: boolean;
	editCard?: boolean;
	createCard?: boolean;
	viewUnpublished?: boolean;
	comment?: boolean;
	star?: boolean;
	markRead?: boolean;
	modifyReadingList?: boolean;
	remoteAI?: boolean;
}

// PermissionType is used for permission checks
export type PermissionType = '' | keyof UserPermissionsCore;

// CardPermissions maps permission types to arrays of user IDs
export type CardPermissions = {
	[name in PermissionType]+?: Uid[]
};

// Generic Sections type that works with any Section type that extends SectionCore
export type Sections<T extends SectionCore = SectionCore> = {
	[sectionName: SectionID]: T
};

// SetName type
const setNameSchema = z.enum([
	// The default set
	'main',
	// reading-list is a set (as well as filters, e.g. `in-reading-list`) since the
	// order matters and is customizable by the user. Every other collection starts
	// from the `all` set and then filters and then maybe sorts, but reading-list
	// lets a custom order.
	'reading-list',
	'everything'
]);

export type SetName = z.infer<typeof setNameSchema>;

// SortName type
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const sortNameSchema = z.enum([
	'default',
	'recent',
	'stars',
	'original-order',
	'link-count',
	'updated',
	'created',
	'commented',
	'last-tweeted',
	'tweet-count',
	'tweet-order',
	'todo-difficulty',
	'random',
	'card-rank'
]);

export type SortName = z.infer<typeof sortNameSchema>;

// ViewMode type
export const viewMode = z.enum([
	'list',
	'web'
]);

export type ViewMode = z.infer<typeof viewMode>;

//A filtername that is a concrete filter (or inverse filter name)
export type ConcreteFilterName = string;

//A filtername that is a union of multiple concerte filter names, separated by '+'
export type UnionFilterName = string;

//The full defininiton of a ConfigurableFilter, including ConfigurableFilterType + '/' + ConfigurableFilterRest
export type ConfigurableFilterName = string;

//A full description of one filter
export type FilterName = ConcreteFilterName | UnionFilterName | ConfigurableFilterName;

// CollectionConfiguration type
export type CollectionConfiguration = {
	setName: SetName,
	//activeFilterNames is the list of named filters to apply to the default
	//set. These names are either concrete filters, inverse filters, or union
	//filters (i.e. they concatenate conrete or inverse filternames delimited by
	//'+'). For the purposes of processing URLs though they can all be treated
	//as though they're concrete filters named their literal name in this.
	filterNames: FilterName[],
	sortName: SortName,
	sortReversed: boolean,
	viewMode: ViewMode,
	viewModeExtra: string,
};

// Convenience functions for string context type-checking
export const setName = (input : SetName) => setNameSchema.parse(input);

export type CSSColorString = string;

const _imagePositionType = z.enum([
	//Will position left. Multiple images will go to the right of the one
	//immediatebly before them.
	'top-left',
	//Like top-left, but images after the first will stack below the ones before
	//them. For the first image, equivalent to top-left.
	'left',
	//Will position right. Multiple images will go to the left of the one
	//immediately before them.
	'top-right',
	//Like top-right, but images after the first will stack below the ones before
	//them. For the first image, equivalent to top-right.
	'right'
]);

export type ImagePositionType = z.infer<typeof _imagePositionType>;

//Note: images.ts:isImagePositionTypeProperty relies on position being the only
//key for ImagePositionType
export interface ImageInfo {
	//Must always be set to a fully resolved url
	src: string,
	//Natural height and width in pixels
	height: number,
	width: number,
	//Size, in ems, for the width of the image as rendered. (The height will maintain aspect ratio)
	emSize: number,
	//If the file is an upload, the path in the upload bucket. This is used
	uploadPath: string,
	//If set, the location where the original was found, for citations, etc.
	original: string,
	alt: string,
	//Must be one of the values in LEGAL_IMAGE_POSITIONS
	position: ImagePositionType,
	//number in ems
	margin: number,
}

export type ImageInfoStringProperty = KeysMatching<ImageInfo,string>;
export type ImageInfoNumberProperty = KeysMatching<ImageInfo,number>;
export type ImageInfoImagePositionTypeProperty = KeysMatching<ImageInfo,ImagePositionType>;
export type ImageInfoProperty = ImageInfoStringProperty | ImageInfoNumberProperty | ImageInfoImagePositionTypeProperty;
export type ImageInfoPropertyValue = string | number | ImagePositionType;

export type ImageBlock = ImageInfo[];

export type ImporterType = 'google-docs-bulleted' | 'google-docs-flat';

export type SuggestionType = 'add-see-also'
	| 'add-dupe-of'
	| 'synthesize-cluster'
	| 'remove-priority'
	| 'add-concept'
	| 'convert-to-quote'
	| 'convert-markdown';

//A set of extra little metadata
export type CardFlags = {
	created_by_suggestor? : SuggestionType
	//The version the suggestor was that created the card. Helps trace quality errors.
	created_by_suggestor_version? : number,
	converted_by_suggestor? : SuggestionType,
	converted_by_suggestor_version? : number,
	importer? : ImporterType,
	importer_version? : number
};

export type CardFlagsRemovals = Partial<Record<keyof CardFlags, true>>;

export type ExpandedReferenceKey = string;
export type ExpandedReferenceObject = {
	cardID : CardID,
	referenceType : ReferenceType,
	value : string
}
export type ExpandedReferenceDelete = {
	cardID : CardID,
	referenceType : ReferenceType,
	delete : true
}

export type ReferencesEntriesDiffItem = ExpandedReferenceObject | ExpandedReferenceDelete;

export type ReferencesEntriesDiff = ReferencesEntriesDiffItem[];

type ReferencesDiffItem = {
	[propName : string] : string
}

type ReferencesDiffItemDelete = {
	[propName : string] : boolean
}

export type ReferencesDiff = [ReferencesDiffItem, ReferencesDiffItem, ReferencesDiffItemDelete, ReferencesDiffItemDelete];

export type ReferencesCardsDiff = [additionsOrModifications : CardBooleanMap, deletions : CardBooleanMap];

//CardFieldType and EditableCardFieldType is driven off of these keys. Note the
//membership in each object need to be consistent with
//TEXT_fIELD_CONIGURATION.readOnly

// Field-related types for Card
export const cardFieldTypeEditableSchema = z.enum([
	'body',
	'commentary',
	'title',
	'subtitle',
	//Also duplicated in card-renderer styles
	'title_alternates',
	'external_link'
]);

export const cardFieldTypeNonEditableSchema = z.enum([
	'references_info_inbound',
	'non_link_references',
	'concept_references'
]);

export type CardFieldTypeEditable = z.infer<typeof cardFieldTypeEditableSchema>;

export type CardFieldTypeNonEditable = z.infer<typeof cardFieldTypeNonEditableSchema>;

export const cardFieldTypeSchema = z.union([
	cardFieldTypeEditableSchema,
	cardFieldTypeNonEditableSchema
]);

export type CardFieldType = z.infer<typeof cardFieldTypeSchema>;

export type FontSizeBoostMap = {
	[name in CardFieldType]+?: number
};

// TODO-related types for Card
export const autoTODOType = z.enum([
	'citations',
	'content',
	'content-mined',
	'diagram',
	'inbound-links',
	'links',
	'prioritized',
	'prose',
	'published',
	'reciprocal-links',
	'slug',
	'substantive-content',
	'tags',
	'author-citation',
	'quote-citation'
]);

export type AutoTODOType = z.infer<typeof autoTODOType>;

export const freeformTODOKey = z.literal('freeform-todo');

export type FreeformTODOKey = z.infer<typeof freeformTODOKey>;

export const todoType = autoTODOType.or(freeformTODOKey);

export type TODOType = z.infer<typeof todoType>;

export const autoTODOTypeArray = z.array(autoTODOType);

export type TODOOverrides = {
	[name in AutoTODOType]+?: boolean
};

// CardDiff related types
export interface NonAutoMergeableCardDiff {
	//Note: if you add or remove something here, also modify src/card_diff.ts:NON_AUTOMATIC_MERGE_FIELDS

	//Freeform text fields
	title?: string;
	title_alternates?: string;
	body?: string;
	subtitle?: string;
	commentary?: string;
	todo?: string;
	notes?: string;
	external_link?: string;

	//Special sub-object that doesn't have diffing yet.
	images?: ImageBlock;
}

//Every field in here (or NonAutoMergeableCardDiff) has to be known how to be handled in various functions in card_diff.ts
export interface CardDiff extends NonAutoMergeableCardDiff {
	//Every field directly on here (and not in NonAutoMergeableCardDiff) can
	//safely be auto-merged.

	name?: string;
	section?: SectionID;
	full_bleed?: boolean;
	sort_order?: number;
	published?: boolean;
	card_type?: CardType;

	font_size_boost?: FontSizeBoostMap;
	references_diff?: ReferencesEntriesDiff;

	auto_todo_overrides_enablements?: AutoTODOType[];
	auto_todo_overrides_disablements?: AutoTODOType[];
	auto_todo_overrides_removals?: AutoTODOType[];
	set_flags?: CardFlags;
	remove_flags?: CardFlagsRemovals;
	add_editors?: Uid[];
	remove_editors?: Uid[];
	add_collaborators?: Uid[];
	remove_collaborators?: Uid[];
	add_tags?: TagID[];
	remove_tags?: TagID[];
}

//Core Card interface definition that both client and server can use
export interface Card {
	id: CardID,

	slugs: Slug[],
	name: CardIdentifier,

	author: Uid,
	collaborators: Uid[],
	permissions: CardPermissions,

	//A number that is compared to other cards to give the default sort
	//order. Higher numbers will show up first in the default sort order.
	sort_order: number,
	card_type: CardType,
	section: SectionID,
	tags: TagID[],

	//A spot for stashing various flags and metadata.
	flags?: CardFlags,

	published: boolean,
	full_bleed?: boolean,

	title: string,
	subtitle?: string,
	title_alternates?: string,
	body: string,
	commentary?: string,
	notes: string,
	todo: string,

	//See the documentation for these string contants in card_fields.js
	//for information on the shape of these fields.
	references_info: ReferencesInfoMap,
	references_info_inbound: ReferencesInfoMap,
	// version are like the normal properties, but where it's a map
	//of cardID to true if there's ANY kind of refernce. Whenever a card is
	//modified, these s are automatically mirrored basd on the value
	//of references. They're popped out primarily so that you can do
	//firestore qureies on them to find cards that link to another.
	references: CardBooleanMap,
	references_inbound: CardBooleanMap,

	//Keys in this object denote fields that should have their emsize
	//boosted, with a missing key equal to a boost of 0.0. The font size is
	//1.0 + the boost, in ems.
	font_size_boost: FontSizeBoostMap,
	//images is an imagesBlock. See src/images.js for a definition.
	images: ImageBlock,
	//auto_todo_overrides is a map of key -> true or false, for each kind of
	//TODO (as enumerated in TODO_OVERRIDE_LEGAL_KEYS). A value of true
	//means that the TODO is overrided to the "done" state for that TODO, no
	//matter how else the card is configured. A false means it it is
	//overridden to the "not done" state no mater how the rest of the card
	//is configured. And a missing key means "based on what the TODO
	//function said for that key based on being passed the card"
	auto_todo_overrides: TODOOverrides,

	//A pointer to an external link for this card. Most commonly used for
	//work and person cards.
	external_link?: string,

	created: Timestamp,
	updated: Timestamp,
	updated_substantive: Timestamp,
	updated_message: Timestamp,

	//star_count is sum of star_count_manual, tweet_favorite_count, tweet_retweet_count.
	star_count: number,
	//star_count_manual is the count of stars in the stars collection (as
	//opposed to faux stars that are tweet enagement actions)
	star_count_manual: number,
	//The sum of favorite counts for all tweets for this card
	tweet_favorite_count: number,
	//The sum of retweet counts for all tweets for this card
	tweet_retweet_count: number,

	thread_count: number,
	thread_resolved_count: number,

	//Default to epoch 1970 for things not yet tweeted
	last_tweeted: Timestamp,
	tweet_count: number,
}

export interface StringCardMap {
	[ngram : string] : CardID
}

export type SynonymMap = {
	[input : string]: string[]
}

export function isProcessedCard(card : Card | ProcessedCard) : card is ProcessedCard {
	return (card as {nlp : unknown}).nlp !== undefined;
}

//TODO: is there a better way to do this since ProcessRun just flat out exists in nlp.js?
export interface ProcessedRunInterface {
	normalized : string,
	original : string,
	stemmed : string,
	withoutStopWords : string,
	readonly empty : boolean
}

type NLPInfo = {
	[field in CardFieldType]: ProcessedRunInterface[]
}

export interface ProcessedCard extends Card {
	//this is stashed there so that the cardWithNormalizedTextProperties machinery can fetch it if it wants.
	fallbackText: ReferencesInfoMap,
	//agains stashed here by cardWithNormalizedTextProperties so wordCountForSemantics can fetch it.
	importantNgrams: StringCardMap,
	synonymMap: SynonymMap,
	nlp: NLPInfo,
}

export type ChatID = string;
export type ChatMessageID = string;

export type Chat = {
	id: ChatID,
	owner: Uid,
	model: AIModelName,
	//In the future we'll have ACLs for view to allow people without admin to see chats they are ACLd into
	updated: Timestamp
	created: Timestamp,
	//The number of tokens of length to target for the initial background (that is, the card content that is passed in)
	background_length: number,
	collection: {
		//serialized collection description path
		description: string,
		configuration: CollectionConfiguration
	},
	//The cards that were requested. cards is a subset of this set.
	requested_cards: CardID[],
	//The card ids that are actually included in the system prompt.
	cards: CardID[]
	title: string
};

export type ChatMessage = {
	id: ChatMessageID,
	chat: ChatID,
	//A monotincally increasing message inddex for sorting
	message_index: number,
	//System is for the innitial snapshot of all of the cards that are selected;
	//we snapshot it at thread creation time so later calls to the API for new
	//messages can simply select all of the messages, in order, with the right
	//chat_id, instead of also having to do an expensive set of fetches for the
	//cards. No user should be able to read back the system prompt object
	//locally, it's just used in the server to concatenate the whole
	//conversation history for api requests.
	role: 'system' | 'assistant' | 'user',
	//True while a response is still streaming. Once the response is complete
	//streaming is set to false. The client has a live updater that queries for
	//streaming:false, to make sure it doesn't constantly get updates as they
	//are written (using the incomding stream tokens) and then gets the final
	//result once it's done.
	streaming: boolean,
	timestamp: Timestamp
	//Markdown text
	content: string
};

export type ComposedChat = Chat & {
	messages: ChatMessage[]
};

export type ComposedChats = {
	[chatID: ChatID]: ComposedChat
};

export type CreateChatRequestData = {
	owner: Uid,
	cards: CardID[],
	model: AIModelName,
	initialMessage: string,
	backgroundLength: number,
	collection: {
		description: string,
		configuration: CollectionConfiguration
	}
};

export type CreateChatResponseData = {
	success: false;
	error: string;
} | {
	success: true,
	chat: ChatID
};

export type OpenAIModelName = 'gpt-4o';

export type AnthropicModelName = 'claude-3-7-sonnet-latest';

export type AIModelName = OpenAIModelName | AnthropicModelName;

/**
 * Request data for semantic sorting of cards
 */
export type SemanticSortRequestData = {
	cards: CardID[]
}

/**
 * Response data for semantic sorting of cards
 */
export type SemanticSortResponseData = {
	cards: CardID[],
	swaps: number
}

/**
 * Request data for checking if a slug is legal
 */
export type LegalRequestData = {
	type: 'warmup'
} | {
	type: 'slug',
	value: string
};

/**
 * Response data for checking if a slug is legal
 */
export type LegalResponseData = {
	legal: boolean,
	reason: string
};

/**
 * Type representing milliseconds since epoch, used for timestamps
 */
export type MillisecondsSinceEpoch = number;

/**
 * Embeddable subset of a Card with only the fields needed for embedding
 */
export type EmbeddableCard = Pick<Card, 'body' | 'title' | 'commentary' | 'subtitle' | 'card_type' | 'created' | 'id'>;

/**
 * A tuple of [CardID, similarity score]
 */
export type CardSimilarityItem = [CardID, number];

/**
 * Request data for fetching similar cards
 */
export type SimilarCardsRequestData = {
	card_id: CardID

	// timestamp in milliseconds since epoch. If provided, results will only be
	// provided if the Vector point has a last-updated since then, otherwise
	// error of 'stale'.
	last_updated?: MillisecondsSinceEpoch

	// If card is provided, it will be used to get the content to embed, live.
	// The user must have AI permission or it will fail.
	// The card provided should match the card_id
	card?: EmbeddableCard
};

/**
 * Response data for similar cards request
 */
export type SimilarCardsResponseData = {
	success: false,
	code: 'qdrant-disabled' | 'insufficient-permissions' | 'no-embedding' | 'stale-embedding' | 'unknown'
	error: string
} | {
	success: true
	cards: CardSimilarityItem[]
};