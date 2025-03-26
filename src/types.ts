import {
	z
} from 'zod';

import {
	FieldValue
} from 'firebase/firestore';

import {
	FIND_CARD_TO_LINK,
	FIND_CARD_TO_PERMISSION,
	FIND_CARD_TO_REFERENCE,
	FIND_CARD_OPEN
} from '../shared/card_fields.js';

import {
	CollectionDescription
} from './collection_description.js';

import {
	TemplateResult
} from 'lit';

import {
	TabConfigItemInput,
	TabConfigName
} from './types_simple.js';

import {
	CollectionConfiguration,
	SortName,
	SetName,
	ConcreteFilterName,
	Uid,
	CardID,
	Slug,
	CardIdentifier,
	CardType,
	cardTypeSchema,
	ReferenceType,
	referenceTypeSchema,
	ReferencesInfoMap,
	ReferencesInfoMapByType,
	ReferencesArrayByType,
	CardBooleanMap,
	FilterMap,
	Filters,
	SectionID,
	TagID,
	SectionCore,
	Sections as SharedSections,
	UserPermissionsCore,
	PermissionType,
	CardPermissions,
	CSSColorString,
	ImagePositionType,
	ImageInfo,
	ImageInfoStringProperty,
	ImageInfoNumberProperty,
	ImageInfoImagePositionTypeProperty,
	ImageInfoProperty,
	ImageInfoPropertyValue,
	ImageBlock,
	ImporterType,
	SuggestionType,
	CardFlags,
	CardFlagsRemovals,
	ExpandedReferenceKey,
	ExpandedReferenceObject,
	ExpandedReferenceDelete,
	ReferencesEntriesDiffItem,
	ReferencesEntriesDiff,
	ReferencesDiff,
	ReferencesCardsDiff,
	cardFieldTypeEditableSchema,
	cardFieldTypeNonEditableSchema,
	CardFieldTypeEditable,
	CardFieldTypeNonEditable,
	cardFieldTypeSchema,
	CardFieldType,
	FontSizeBoostMap,
	autoTODOType,
	freeformTODOKey,
	todoType,
	AutoTODOType,
	FreeformTODOKey,
	TODOType,
	autoTODOTypeArray,
	TODOOverrides,
	NonAutoMergeableCardDiff,
	CardDiff,
	Card,
	OpenAIModelName,
	AnthropicModelName,
	AIModelName,
	ChatMessage,
	Chat,
	ChatID,
	ChatMessageID,
	ProcessedCard,
	StringCardMap,
	SynonymMap,
	isProcessedCard,
	IconName,
	CardTypeConfigurationMap,
	AutoSlugConfig,
	CardFieldTypeConfiguration
} from '../shared/types.js';

import {
	Timestamp
} from '../shared/timestamp.js';

//Reexport
export {
	Uid,
	CardID,
	Slug,
	CardIdentifier,
	CardType,
	cardTypeSchema,
	ReferenceType,
	referenceTypeSchema,
	ReferencesInfoMap,
	ReferencesInfoMapByType,
	ReferencesArrayByType,
	CardBooleanMap,
	FilterMap,
	Filters,
	SectionID,
	TagID,
	SectionCore,
	SharedSections,
	ConcreteFilterName,
	SetName,
	SortName,
	CollectionConfiguration,
	UserPermissionsCore,
	PermissionType,
	CardPermissions,
	CSSColorString,
	ImagePositionType,
	ImageInfo,
	ImageInfoStringProperty,
	ImageInfoNumberProperty,
	ImageInfoImagePositionTypeProperty,
	ImageInfoProperty,
	ImageInfoPropertyValue,
	ImageBlock,
	ImporterType,
	SuggestionType,
	CardFlags,
	CardFlagsRemovals,
	ExpandedReferenceKey,
	ExpandedReferenceObject,
	ExpandedReferenceDelete,
	ReferencesEntriesDiffItem,
	ReferencesEntriesDiff,
	ReferencesDiff,
	ReferencesCardsDiff,
	cardFieldTypeEditableSchema,
	cardFieldTypeNonEditableSchema,
	CardFieldTypeEditable,
	CardFieldTypeNonEditable,
	cardFieldTypeSchema,
	CardFieldType,
	FontSizeBoostMap,
	autoTODOType,
	freeformTODOKey,
	todoType,
	AutoTODOType,
	FreeformTODOKey,
	TODOType,
	autoTODOTypeArray,
	TODOOverrides,
	NonAutoMergeableCardDiff,
	CardDiff,
	Card,
	OpenAIModelName,
	AnthropicModelName,
	AIModelName,
	ProcessedCard,
	StringCardMap,
	SynonymMap,
	isProcessedCard,
	IconName,
	CardTypeConfigurationMap,
	CardFieldTypeConfiguration
};

// PermissionType and CardPermissions now imported from shared/types.js

// CardFieldType and related types now imported from shared/types.js

export const dateRangeType = z.enum([
	'before',
	'after',
	'between'
]);

export type DateRangeType = z.infer<typeof dateRangeType>;

// FontSizeBoostMap now imported from shared/types.js

export type CreateCardOpts = {
	cardType? : CardType;
	section? : SectionID;
	id? : CardID;
	noNavigate? : boolean;
	//If provided, this will be used instead of CardTypeConfig.autoSlug.
	autoSlug?: AutoSlugConfig;
	title? : string,
	body? : string;
}

// CardType now imported from shared/types.js

type CSSPartString = string;

export type WordCloudItemInfo = {
	title : string,
	suppressLink : boolean,
	filter : CSSPartString,
	color? : CSSColorString,
	previewCard? : CardID
}

export type WordCloudItemInfos = {
	[id : string]: WordCloudItemInfo
};

export type WordCloud = [
	string[],
	WordCloudItemInfos
];

// ImagePositionType, ImageInfo, and related types now imported from shared/types.js
// ExpandedReferenceKey, ExpandedReferenceObject, ExpandedReferenceDelete, ReferencesEntriesDiffItem,
// ReferencesEntriesDiff, ReferencesDiff, and ReferencesCardsDiff now imported from shared/types.js

// ImageBlock now imported from shared/types.js

// AutoTODOType, FreeformTODOKey, TODOType, autoTODOTypeArray, and TODOOverrides now imported from shared/types.js

// ReferenceType, ReferencesInfoMap, ReferencesInfoMapByType, and ReferencesArrayByType now imported from shared/types.js

export interface TweetInfo {
	id : string
	user_screen_name : string
	user_id : string
	posted_text : string
	supplied_text : string
	truncated : boolean
	auto_tweet_version : number
	media_expanded_url : string
	media_id : string
	media_url_https : string
	fake : boolean
	created : Timestamp
	card : CardID
	archived : boolean
	archive_date : Timestamp
	retweet_count : number;
	favorite_count : number;
	//Last time we fetched and updated the retweet and favorite counts
	engagement_last_fetched : Timestamp
	//Last time the retweet or favorite counts CHANGED from what we already had
	//stored.
	engagement_last_changed : Timestamp
}

// backportTitleExtractor: if defined, a function taking (rawCard, referenceType,
//  allRawCards) that should return the string to be used for backporting text. If
// not defined, will just use card.title.
export type CardTypeBackportTitleExtractor = ( card : Card, referenceType : ReferenceType, allRawCards : Cards) => string;

export type SortExtra = {
	[cardID : CardID] : number
};

export type SortExtras = {
	[filterName : string]: SortExtra
};

interface WebInfoNode {
	id: CardID,
	name: string
}

export interface WebInfoNodeWithLayout extends WebInfoNode {
	x : number,
	y : number,
}

interface WebInfoEdge {
	source : CardID,
	target : CardID,
	value : number
}

export interface WebInfoEdgeWithLayout {
	source: WebInfoNodeWithLayout,
	target: WebInfoNodeWithLayout,
	value : number
}

export type WebInfo = {
	nodes: WebInfoNode[],
	edges: WebInfoEdge[]
};

export type WebInfoWithLayout = {
	nodes: WebInfoNodeWithLayout[]
	edges: WebInfoEdgeWithLayout[]
}

export type CardIDMap = {
	[id : CardID] : true | Card | ProcessedCard
};

export type SortExtractorResult = [sortValue : number, label : string];

export type SortConfigurationMap = {
	//TODO: make it so no field is optional, which will help detect places where
	//you forgot to add a configuration block for a type. And then do this for
	//others, too.
	[sortName in SortName]: {
		extractor : (card : ProcessedCard, sections : Sections, cards : ProcessedCards, sortExtras : SortExtras, filterExtras: FilterExtras) => SortExtractorResult ,
		description : string,
		labelName? : string | ((sortExtras : SortExtras) => string),
		reorderable? : (sortExtras : SortExtras) => boolean,
	}
}

export type ConfigurableFilterControlPiece = {
	controlType : ConfigurableFilterFuncURLPart,
	description : string,
	value : string
}

export type FilterFuncResult = {
	matches: boolean,
	sortExtra? : number,
	partialMatch? : boolean,
	//Whether this result should be considered a preview--e.g the final result
	//relies on a value from the server that has not been downloaded yet.
	preview? : boolean
}

//preview is true if any item returned preview:true in the whole set
export type ConfigurableFilterResult = [result : FilterMap, reverse : boolean, sortValues : SortExtra | null, partialMatches: CardBooleanMap | null, preview : boolean];

export type ConfigurableFilterFunc = (card : ProcessedCard, extras? : FilterExtras) => FilterFuncResult;

export type ConfigurableFilterFuncFactoryResult = [func : ConfigurableFilterFunc, reverse : boolean];

type ConfigurableFilterFuncFactory = (filterType : ConfigurableFilterType, ...parts : URLPart[]) => ConfigurableFilterFuncFactoryResult;

const _configurableFilterFuncURLPart = z.enum([
	'date',
	'text',
	'key-card',
	'int',
	'float',
	'reference-type',
	'user-id',
	'sub-filter',
	'multiple-cards',
	'concept-str-or-id',
	//A sub-filter that expand knows how to pass multiple cards to
	'expand-filter'
]);

type ConfigurableFilterFuncURLPart = z.infer<typeof _configurableFilterFuncURLPart>;

type ConfigurableFilterFuncArgument = {
	type : ConfigurableFilterFuncURLPart,
	description : string,
	default : number | string | boolean,
};

export type ConfigurableFilterConfigurationMap = {
	[filterName : ConfigurableFilterType] : {
		factory : ConfigurableFilterFuncFactory,
		labelName? : string,
		flipOrder? : boolean,
		description : string,
		suppressLabels? : boolean,
		arguments : ConfigurableFilterFuncArgument[],
	}
};

//TODO: this name is confusing, in the state this is just called tab

const _editorTabSchema = z.enum([
	'content',
	'config'
]);

export type EditorTab = z.infer<typeof _editorTabSchema>;

const _editorContentTabSchema = z.enum([
	'content',
	'notes',
	'todo'
]);

//TODO: this name is confusing, in the state this is called editorTab
export type EditorContentTab = z.infer<typeof _editorContentTabSchema>;

export type UserInfo = {
	uid: Uid,
	isAnonymous: boolean,
	photoURL: string,
	displayName: string,
	email: string,
};

export type Author = {
	id: Uid,
	displayName : string,
	photoURL : string,
	updated: Timestamp
};

export type CommentThreadID = string;
export type CommentMessageID = string;

export interface CommentMessage {
	id: CommentMessageID
	author: Uid,
	card: CardID,
	created: Timestamp,
	deleted: boolean,
	message: string,
	thread: CommentThreadID,
	updated: Timestamp
}

export interface ComposedCommentMessage extends CommentMessage {
	expandedAuthor: Author,
	mayEdit: boolean,
}

export interface CommentThread {
	id: CommentThreadID,
	author: Uid,
	card: CardID,
	created: Timestamp,
	deleted: boolean,
	messages: CommentMessageID[],
	parent_message: CommentMessageID,
	resolved: boolean,
	updated: Timestamp,
}

export interface ComposedCommentThread extends CommentThread {
	expandedMessages: ComposedCommentMessage[],
	expandedAuthor: Author,
	mayResolve: boolean,
}

export type CommentMessages = {
	[id : CommentMessageID]: CommentMessage
}

export type CommentThreads = {
	[id : CommentThreadID]: CommentThread
}

// htmlFormatter: if provided, is a function that takes the raw value and returns
// html to set, or '' to use the raw value. For the common case of just a prefix,
// use displayPrefix. Should be combined with noContentEditable otherwise the
// formated HTML will get mixed into the underlying value.
export type CardFieldHTMLFormatter = (input : string) => string;

//Validator takes the proposed stirng and returns an error string or '' if
//no problem. If it is provided and returns a non-empty string, then edits
//to that field will not be allowed to be saved. This is conceptually
//similar to a cardFinisher, which can throw an error if a card doesn't
//validate... but it's on the field level.
export type CardFieldValidator = (input : string | undefined, cardType : CardType, config : CardFieldTypeConfiguration) => string;

// CSSColorString now imported from shared/types.js

export type CardTestFunc = (card : Card) => boolean;

// ImporterType, SuggestionType, CardFlags, and CardFlagsRemovals now imported from shared/types.js

// Card interface now imported from shared/types.js

//Redefining KeysMatching locally as it's used here but now defined in shared/types.ts
type KeysMatching<T, V> = {[K in keyof T]-?: T[K] extends V ? K : never}[keyof T];

export type CardTimestampPropertyName = KeysMatching<Card,Timestamp>;

type OptionalFields<Type> = {
	[Property in keyof Type]+?: Type[Property]
};

export type OptionalFieldsCard = OptionalFields<Card>;

type TimestampToFieldValue<Type> = {
	[Property in keyof Type]: Type[Property] extends Timestamp ? FieldValue | Type[Property] : Type[Property]
};

//Firebase updates allow arrayUnion and arrayRemove sentinels
//TODO: arent' there at least some fields that are deletable (e.g. FieldValue:deleteSentinel)
type ArrayToFieldValueUnion<Type> = {
	[Property in keyof Type]: Type[Property] extends unknown[] ? Type[Property] | FieldValue : Type[Property]
}

type CardUpdateIntermediate = OptionalFields<ArrayToFieldValueUnion<TimestampToFieldValue<Card>>>;

export type FirestoreLeafValue = boolean | string | number | object | FieldValue;

//A partial udpate using possible dottedFieldPath property names that is
//appropriate for being updateDoc(ref, DottedCardUpdate)
export type DottedCardUpdate = {
	//The only actual type the string keys can be are ones that start with
	//'references(_info)?(_inbound)?.' or 'permissions.' and then are either a
	//FieldValue or a boolean or a string. But index types must be the union of
	//all of the possible keys so they're very permissive here
	[dottedPropertyName : string] : FirestoreLeafValue
}

//CardUpdate is a thing htat might be sent to updateDoc(cardRef, update :
//CardUpdate). Note that while there are explicit knonw keeys there are often additional fields, like the
//ones added by applyReferencesDiff, like [references_info.abc123.link] =
//deleteSentinel. This is because updateDoc() expects dottedFieldPath names for sub-objects to partially modify.
export type CardUpdate = CardUpdateIntermediate & DottedCardUpdate;

export type CardLike = Card | CardUpdate;

export interface CardWithOptionalFallbackText extends Card {
	fallbackText?: ReferencesInfoMap,
}

export type Cards = {
	[id : CardID]: Card
}

export type ProcessedCards = {
	[id: CardID]: ProcessedCard
}

// PermissionType now imported from shared/types.js

export interface PermissionInfo {
	displayName : string,
	description : string,
	locked? : boolean,
	legalOnCard? : boolean,
}

export interface UserPermissionsForCards {
	[uid : Uid]: {
		[permissionType in PermissionType]+?: CardID[]
	}
}

export type PermissionInfoCollection = {
	[permissionType in PermissionType]+?: PermissionInfo
}

export interface UserPermissions extends UserPermissionsCore {
	id? : Uid,
	notes? : string,
}

export type UserPermissionsMap = {
	[person: Uid]: UserPermissions
};

const _commitActionType = z.enum([
	'CONSOLE_LOG',
	'EDIT_MESSAGE',
	'ADD_MESSAGE',
	'CREATE_THREAD',
	'CREATE_CHAT'
]);

export type CommitActionType = z.infer<typeof _commitActionType>;



//A part of a URL in a collection description. These pieces are delimited by '/' in the URL.
export type URLPart = string;

//The first part of a ConfigurableFilterName, that determines what type of filter factory to use.
export type ConfigurableFilterType = string;

//The rest of the arguments to a given ConfigurableFilter as URLPart, delimited
//by '/'. The lenght and contents are specific to the ConfigurableFilterType.
export type ConfigurableFilterRest = string;


// SectionID and TagID now imported from shared/types.js

//See also SectionUpdate
export interface Section extends SectionCore {
	start_cards : CardID[],
	order : number,
	title : string,
	subtitle? : string,
	updated : Timestamp,
	id : SectionID | TagID,
	default? : boolean,
}

export type SectionUpdate = OptionalFields<TimestampToFieldValue<Section>>;

export type Tags = {
	[tagName : TagID] : Section
}

type CSSFilterString = string;

export type TagInfo = {
	title : string,
	id : string,
	description? : string,
	previewCard? : CardID,
	suppressLink? : boolean,
	subtle? : boolean,
	iconName? : IconName,
	color? : CSSColorString,
	filter? : CSSFilterString,
	disabled? : boolean,
}

export type TagInfos = {
	[name : string]: TagInfo
}

// Based on the shared Sections type but using our specific Section interface
export type Sections = {
	[sectionName: SectionID]: Section
}

export type Sets = {
	[setName in SetName]+?: CardID[]
}

export type FilterExtras = {
	filterSetMemberships : Filters,
	cards : ProcessedCards,
	keyCardID : CardID,
	editingCard : ProcessedCard | null,
	userID : Uid,
	randomSalt: string,
	cardSimilarity: CardSimilarityMap,
	editingCardSimilarity: SortExtra | null
};

// CardBooleanMap, FilterMap, and Filters now imported from shared/types.js

export type SerializedDescriptionToCardList = {
	[serializedDescription: string] : CardID[],
}

export interface CollectionConstructorArguments {
	cards : ProcessedCards,
	sets : Sets,
	filters : Filters,
	sections : Sections,
	fallbacks? : SerializedDescriptionToCardList,
	startCards? : SerializedDescriptionToCardList,
	userID? : Uid,
	randomSalt? : string,
	keyCardID? : CardID,
	cardsSnapshot? : ProcessedCards,
	filtersSnapshot? : Filters,
	editingCard? : ProcessedCard,
	cardSimilarity? : CardSimilarityMap,
	editingCardSimilarity? : SortExtra
}

export type Logger = {
	info(...msg: unknown[]): void;
	error(...msg: unknown[]): void;
	log(...msg: unknown[]): void;
	warn(...msg: unknown[]): void;
}

export interface BadgeMap {
	stars: FilterMap,
	reads: FilterMap,
	todos: FilterMap,
	readingList: CardBooleanMap,
	selected: FilterMap
}

//TODO: tighten this
export type MaintenanceTaskID = string;
export type MaintenanceTask = {
	id: MaintenanceTaskID,
	timestamp: Timestamp,
	version: number,
};

export interface HTMLElementWithStashedSelectionOffset extends HTMLElement {
	stashedSelectionOffset?: [number, number]
}

export type FindDialogType = typeof FIND_CARD_OPEN | typeof FIND_CARD_TO_LINK | typeof FIND_CARD_TO_PERMISSION | typeof FIND_CARD_TO_REFERENCE;

export type AppState = {
	location: string,
	page: string,
	pageExtra: string,
	offline: boolean,
	snackbarOpened: boolean,
	headerPanelOpen: boolean,
	commentsAndInfoPanelOpen: boolean,
	cardsDrawerPanelOpen: boolean,
	cardsDrawerInfoExpanded: boolean,
	configureCollectionDialogOpen: boolean,
	presentationMode: boolean,
	mobileMode: boolean,
	hoverX: number,
	hoverY: number,
	hoverCardId: CardID,
	//the card that was fetched as a singleton, for example in basic-card-view.
	fetchedCard: Card,
	cardBeingFetched: boolean,
	ctrlKeyPressed: boolean,
	//if this is true, then the word cloud in card-drawer will be replaced with
	//the suggest missing concepts, which is EXTREMELY expensive.
	suggestMissingConceptsEnabled: boolean,
}


export type CollectionState = {
	active : CollectionConfiguration,
	//If the dialog to configure the collection is open, this will be set to a
	//thing to configure. This is popped out because changing parts of the
	//active collection can be very expensive, and would make the configure
	//collection dialog feel very unresponsive.
	snapshot : CollectionConfiguration | null,
	//These are the actual values of the filters in current use, reflecting all
	//of the changes. If you want the filter set that goes along with the
	//cardSnapshot (and doesn't update until
	//COMMIT_PENDING_COLLECTION_PODIFICATIONS) then use filtersSnapshot instead.
	filters: Filters,
	//This is a snapshot of filters from the last time
	//COMMIT_PENDING_COLLECTION_MODFICIATIONS was called.
	filtersSnapshot: Filters,
	//requestCard is the identifier specifically requested in the URL. This
	//could be the card's ID, a slug for that card, or a special placeholder
	//like `_`. The fully resolved activeCard is stored in activeCardId.
	requestedCard: CardID,
	//the fully resolved literal ID of the active card (not slug, not special
	//placeholder).
	activeCardID: CardID,
	//The sale for the random sort, which should stay the same within a session (so
	//the sort order doesn't change randomly) but be different across sessions.
	randomSalt: string,
	activeRenderOffset: number,
	//This is the set of cards that are currently selected. Selection state is
	//ephemeral and not persisted.
	selectedCards: FilterMap,
	//It's very expensive to update the collectionWordCloud, so we only update it when this is incremented.
	collectionWordCloudVersion: number
}

export type CommentsState = {
	messages: CommentMessages,
	threads: CommentThreads,
	messagesLoaded: boolean,
	threadsLoaded: boolean,
}

export type Chats = {
	[id: ChatID]: Chat
};

export type ChatMessages = {
	[id: ChatMessageID]: ChatMessage
};

export type ChatState = {
	currentChat: ChatID,
	messages: ChatMessages,
	chats: Chats,
	chatsLoading : boolean,
	chatMessagesLoading: boolean,
	sending: boolean,
	sendFailure: Error | null,
	composingMessage: string
}

export type TweetMap = {
	[tweetID : string]: TweetInfo
}

export type AuthorsMap = {
	[id : Uid] : Author
}

export type CardFieldMap = {
	[field in CardFieldType]+?: true
}

export type TabConfig = (TabConfigName | TabConfigItem)[];

//We add the live versions that aren't allowed in inputs.
export type TabConfigItem = Omit<TabConfigItemInput, 'icon' | 'collection'> & {
	//collection can be either a string that can be deserialized into a CollectionDescription, or an actual 
	//CollectionDescription. It will be expanded to be a CollectionDescription either way. Each item should have a collection
	//or an href. If it's a string, remember it should start with a setname, e/g. 'everything/working-notes'
	collection?: string | CollectionDescription,
	//Can be either a string naming an ICON constant in src/../shared/icons.js, or an actual Icon template.
	//If provided, will render that instead of the display_name text.
	icon?: IconName | TemplateResult,
}

export interface ExpandedTabConfigItem extends TabConfigItem {
	expandedCollection: CollectionDescription,
	expandedIcon: TemplateResult
}

export type ExpandedTabConfig = ExpandedTabConfigItem[];

//A map of card_id to similarity to that ID.
//Note the map will likely only have a subset of the other cards.
export type CardSimilarityMap = Record<CardID, SortExtra>;

export type SuggestionDiffCreateCard = {
	card_type? : CardType,
	title? : string,
	body? : string,
	autoSlug? : AutoSlugConfig
};

//At least one part of diff is required.
export type SuggestionDiff = {
	createCard : SuggestionDiffCreateCard | SuggestionDiffCreateCard[],
	keyCards?: CardDiff,
	supportingCards?: CardDiff
} | {
	createCard? : SuggestionDiffCreateCard | SuggestionDiffCreateCard[],
	keyCards: CardDiff,
	//The diff to apply to each supportingCard.
	supportingCards?: CardDiff
} | {
	createCard? : SuggestionDiffCreateCard | SuggestionDiffCreateCard[],
	keyCards? : CardDiff,
	supportingCards: CardDiff
};

// SuggestionType now imported from shared/types.js

export type Suggestion = {
	type: SuggestionType,
	keyCards: CardID[],
	supportingCards: CardID[],
	//TODO: add contextCards

	//The diff to apply if the action is accepted
	action: SuggestionDiff,
	//An alternate action. Often the mirror of the primary.
	alternateAction?: SuggestionDiff
	//The diff to apply if the action is rejected. Typically an `ack` reference.
	rejection?: SuggestionDiff
};

const _cardFetchTypeSchema = z.enum([
	'published',
	'unpublished-partial',
	'unpublished-complete',
	'unpublished-editor',
	'unpublished-author'
]);

export type CardFetchType = z.infer<typeof _cardFetchTypeSchema>;

export type CardFetchTypeMap = {[type in CardFetchType]+?: true};

export type DataState = {
	cards: Cards,
	authors: AuthorsMap,
	sections: Sections,
	tags: Tags,
	slugIndex: {[slug : Slug] : CardID},
	//A snapshot of cards from last time UPDATE_COLLECTION_SHAPSHOT was called.
	//Keeping a snapshot helps make sure that filtering logic in the current
	//collection doesn't change constantly
	cardsSnapshot: Cards,
	//true while we're loading tweets for the current card
	tweetsLoading: boolean,
	//We only fetch tweets for cards that we have already viewed.
	tweets: TweetMap,
	//The types of card fetch updates that are in flight. These flags are raised
	//when the fetch starts, and lowered when the first result of that fetchtyep
	//is provided (although there might be subsequent of htat type too and that's OK)
	loadingCardFetchTypes: CardFetchTypeMap,
	//These three are flipped to true on the first UPDATE_type entry, primarily
	//as a flag to  selectDataisFullyLoaded.
	//TODO: consider flipping these to be loading (vs loadED) to align with loadingCardFetchTypes.
	sectionsLoaded: boolean,
	tagsLoaded: boolean,
	//If true, the user has expliclitly requested that all unpublished card data
	//be loaded, even if it's very large.
	completeMode: boolean,
	//The number of cards to limit to if partial mode is engaged. If 0, that means 'deafult'.
	completeModeCardLimit : number,
	//keeps track of whether we committed any pending collections on being fully
	//loaded already. If so, then even if refreshCardSelector gets called again,
	//we won't update the collection again.
	alreadyCommittedModificationsWhenFullyLoaded: boolean,
	cardModificationError: Error | null,
	//This is split into two because modifyCardSuccess might trigger before we
	//receive all of the cards, but need to remember how many we're expecting.
	pendingModifications: boolean,
	pendingModificationCount: number,
	//A card that we created, but is not yet in the cards collection. This will
	//be cleared as soon as that card is received and added.
	pendingNewCardID: CardID,
	//The card_type of the card denoted by pendingNewCardID
	pendingNewCardType: CardType,
	//Similar to pendingNewCardID, but specifically for a new card that was
	//created that--when it is loaded--we should navigate to. This is either the
	//value of pendingNewCardID, or blank. Note that there's a brief moment
	//where the new card has been received, so pendingNewCardID is cleared, but
	//pendingNewCardIDToNavigateTo is not yet cleared, because the navigation
	//hasn't yet happened.
	pendingNewCardIDToNavigateTo: CardID,
	//a map of cardID -> true for cards that we expect to be deleted imminently,
	//since we just issued a deletion command to the datastore.
	pendingDeletions: CardBooleanMap,
	pendingReorder: boolean,
	//These are cards that we've received but don't want to dispatch yet until
	//updateEnqueuedCards is called. We do this if we expect many cards in
	//multiple batches to all land, so we don't do expensive recalculations once
	//for each batch. See #701.
	enqueuedCards: {
		[field in CardFetchType]+?: Cards
	}
	//When we're doing card similarity based on embedings, we have to reach out
	//to a cloud function. This is where we store that information.
	cardSimilarity: CardSimilarityMap
}

export type EditorState = {
	editing: boolean,
	//If true, then the editor shows up as a single collapsed line, saving
	//vertical space for small screens.
	editorMinimized: boolean,
	//this is a map of field name to true if it was updated last from content
	//editable, or false or missing if it wasn't.
	updatedFromContentEditable: CardFieldMap,
	card: Card | null,
	//A direct reference to the card, as it was when editing started, in the
	//cards array. Useful for detecting when the underlying card has changed.
	underlyingCardSnapshot: Card | null,
	//The very original card snapshot from when editing started. This allows us
	//to figure out what edits have been merged in from other users while we're
	//open for editing.
	originalUnderlyingCardSnapshot: Card | null,
	//This number should increment every time EDITING_EXTRACT_LINKS fires. The
	//selector for selectEditingNormalizedCard will return the same result until this changes.
	cardExtractionVersion: number,
	substantive: boolean,
	selectedTab: EditorTab,
	selectedEditorTab: EditorContentTab,
	pendingSlug: Slug,
	pendingReferenceType: ReferenceType,
	imagePropertiesDialogOpen: boolean,
	imagePropertiesDialogIndex: number,
	imageBrowserDialogOpen: boolean,
	//Undefined communicates 'add to end'
	imageBrowserDialogIndex?: number,
	//The same as data.cardSimilarity, but for the editing card. If undefined,
	//then it's not up ot date for the current card.
	editingCardSimilarity?: SortExtra
}

export type FindState = {
	open: boolean,
	//query is the query as input by the user, as quick as we can update state.
	query: string,
	//activeQuery is the query that goes into the processing pipeline. We only
	//update this every so often as query is updated, because it is expensive
	//and drives expensive template updating, introducing lag.
	activeQuery: string,
	renderOffset: number,
	//For when the user is looking to link specific highlighted text to that card
	linking: boolean,
	//For when the user is looking to add permissions to a given card
	permissions: boolean,
	//For when the user wants to add a specific type of reference from the
	//editing card to this one
	referencing: boolean,
	//If true, sort by recent. Otherwise, sort by query match.
	sortByRecent: boolean,
	//Can be a single cardType, or a union filter.
	cardTypeFilter: string,
	//if true, the filter shouldn't be able to be changed
	cardTypeFilterLocked: boolean,
}

export type MaintenanceTaskMap = {
	[id : MaintenanceTaskID]: MaintenanceTask
}

export type MaintenanceState = {
	executedTasks: MaintenanceTaskMap,
	taskActive: boolean,
}

export type MultiEditState = {
	open: boolean,
	referencesDiff: ReferencesEntriesDiff,
	addTags: TagID[],
	removeTags: TagID[],
	addTODOEnablements: AutoTODOType[]
	addTODODisablements: AutoTODOType[]
};


const _aiDialogType = z.enum([
	'summary',
	'title',
	'concepts'
]);

export type AIDialogType = z.infer<typeof _aiDialogType>;

export type AIState = {
	open: boolean;
	active: boolean;
	kind : AIDialogType;
	selectedIndex: number;
	result: string[];
	error: string;
	model: AIModelName;
	//All cards that it was told to operate on
	allCards: CardID[];
	//The actual cards the prompt includes
	filteredCards: CardID[];
};

export type BulkImportDialogMode = 'import' | 'export';

export type BulkImportState = {
	open: boolean,
	mode: BulkImportDialogMode,
	//Whether or not the import is running
	pending: boolean,
	bodies: string[],
	//If provided, will use this order, not the implicit order of the collection.
	overrideCardOrder: CardID[] | null,
	importer: ImporterType | '',
	importerVersion: number
};

export type PermissionsState = {
	permissions: UserPermissionsMap,
	pendingUid : Uid,
	pendingPermissionType: PermissionType
}

export type PromptState = {
	composeOpen: boolean,
	content: string,
	message: string,
	action: CommitActionType,
	//Depends on what the action is. For EDIT_MESSAGE, for example, is a message ID.
	associatedId: CommentMessageID | CommentThreadID,
}

export type SuggestionsState = {
	open: boolean,
	//Note: this does not say LLMs will be used, just that if OPEN_AI_ENABLED
	//and the user has permission suggestors will be told to use them.
	useLLMs: boolean,
	//Whether the thresholds for suggesting something should be lowered to suggest more thigs.
	aggressive: boolean,
	selectedIndex: number,
	//Whether a suggestion is being applied.
	pending: boolean,
	loadingForCard: {
		[card: CardID] : true
	},
	suggestionsForCard : {
		[card : CardID] : Suggestion[]
	}
}

export type UserState = {
	user : UserInfo | null,
	//pending is true whenever we are expecting either a SIGNIN_SUCCESS or
	//SIGNOUT_SUCCESS. That's true both when the page loads before we get the
	//initial auth state (which is why it defaults to true), and also when the
	//user has proactively hit the signIn or signOut buttons.
	pending: boolean,
	error: Error | null,
	//userPermissions is the object that tells us what we're allowed to do. The
	//security rules will actually enforce this; this is mainly just to not have
	//affordances in the client UI if they won't work. See BASE_PERMISSIONS
	//documentation for what the legal values are.
	userPermissions: UserPermissions,
	stars : FilterMap,
	reads: FilterMap,
	readingList: CardID[],
	//This is the reading list that we use for the purposes of the live set. We
	//only update it when UPDATE_COLLECTION_SHAPSHOT is called, for
	//similar reasons that we use filters/pendingFiltesr for sets. That is,
	//reading-list is liable to change while the user is viewing that set, due
	//to their own actions, and it would be weird if the cards would disappear
	//when they hit that button.
	readingListSnapshot: CardID[],
	//These two are analoges to cardsLoaded et al in data. They're set to true
	//after UPDATE_STARS or _READS has been called at least once.  Primarily for
	//selectDataIsFullyLoaded purposes.
	starsLoaded: boolean,
	readsLoaded: boolean,
	readingListLoaded: boolean,
	userPermissionsLoaded: boolean,
	autoMarkReadPending: boolean,
}

export type State = {
	ai?: AIState,
	app: AppState,
	bulkImport? : BulkImportState,
	data: DataState,
	find? : FindState,
	editor? : EditorState,
	collection? : CollectionState,
	prompt? : PromptState,
	comments? : CommentsState,
	chat? : ChatState,
	maintenance? : MaintenanceState,
	multiedit? : MultiEditState,
	permissions? : PermissionsState,
	suggestions? :SuggestionsState,
	user? : UserState
}

//The following are convenience functions for when you have a given enum that
//will be used in a generic string context and want type-checking to verify it
//is part of the enum.
export const cardType = (input : CardType) => cardTypeSchema.parse(input);
export const referenceType = (input : ReferenceType) => referenceTypeSchema.parse(input);
export const cardFieldType = (input : CardFieldType) => cardFieldTypeSchema.parse(input);
export const editorTab = (input : EditorTab) => _editorTabSchema.parse(input);
export const editorContentTab = (input : EditorContentTab) => _editorContentTabSchema.parse(input);