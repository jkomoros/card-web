import {
	z
} from 'zod';

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