import {
    FieldValue,
    Timestamp
} from 'firebase/firestore';

export type Uid = string;

export type CardID = string;
export type Slug = string;
export type CardIdentifier = CardID | Slug;

//TODO: lock this down more
//TODO: should this be the same as PermissionType?
type CardPermissionType = string;

type CardPermissions = {
    [name : CardPermissionType]: Uid[]
}

//TODO: lock this down more
export type CardFieldType = string;

type FontSizeBoostMap = {
    [name: CardFieldType]: number,
}

//TODO: lock this down more
export type CardType = string;

//TODO: lock this down more
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

//TOOD: tighten
type ImagePosition = string;

export interface ImageInfo {
    //Must always be set to a fully resolved url
    src: string,
    //Natural height and width in pixels
    height: number,
    width: number,
    //Size, in ems, for the width of the image as rendered. (The height will maintain aspect ratio)
    emSize: number,
    //If the file is an uload, the path in the upload bucket. This is usef
    uploadPath: string,
    //If set, the location where the original was found, for citations, etc.
    original: string,
    alt: string,
    //Must be one of the values in LEGAL_IMAGE_POSITIONS
    position: ImagePosition
    //number in ems
    margin: number,
}

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

export type ReferencesEntriesDiff = (ExpandedReferenceObject | ExpandedReferenceDelete)[];

export type ImageBlock = ImageInfo[];

//TODO: lock this down more
type TODOType = string;

type TODOOverrides = {
    [name: TODOType]: boolean
}

type ReferencesMap = {
    [id: CardID]: boolean
}

//TODO: tighten this
export type ReferenceType = string;

export type ReferencesInfoMap = {
    [id : CardID]: {
        [typ : ReferenceType]: string
    }
}

export type ReferencesInfoMapByType = {
    [typ : ReferenceType]: {
        [id : CardID]: string
    }
}

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

//TODO: tighten this
export type IconName = string;

export type SelectorStyleMap = {
    [selector : string]: string[]
}

export type CardTypeConfigurationMap = {
	[typ : CardType] : {
        //invertContentPublishWarning: if true, then the 'There's content but unpublished,
        //are you sure?' will not trigger... unelss you try to publish in which case it
        //will ask for confirmation.
		invertContentPublishWarning? : true,
        // orphanedByDefault: if true, then the confirmation of 'You're about to make this
        // card orphaned' will be flipped, and the natural location of them will be
        // orphaned.
        orphanedByDefault? : true,
        // publishedByDefault: if true, then createCard will by default create a card that
        // is published. This is useful for example for concept cards, where the primary
        // content is the reference list. If this is true, then trying to save the card if
        // it's not published will always warn.
        publishedByDefault? : true,
        // styleBlock: if provided, will be rendered as the style block in the card
        // renderer when this card type is selected. A string that will be run through css
        // tag. This isn't an css tag to avoid having heavyweight imports so this can be
        // included in tests. You should use styleBlockForCardType to generate the string,
        // so that the right selector guards and indentation are added.
        styleBlock? : string,
        // dark: if true, the card is considered dark, and styles for e.g. thumbnails,
        // including badge color, will swap.
        dark? : true,
        // iconName: a reference from icons to show in front of the title everywhere it
        // shows up. A string that indexes into icons. This isn't an html tag to avoid
        // having heavyweight imports so this can be included in tests.
        iconName? : IconName,
        // autoSlug: if true, then when a new card is created, it will try to automatically
        // add a name to the card that is `CARD_TYPE-NORMALIZED-TITLE`.
        autoSlug? : true,
        // defaultBody: if set, then when a card of this type is created, it will have this
        // string.
        defaultBody? : string,
        // description: the string describing what the card type is, for UI helptext.
        description : string,
        // backportTitleExtractor: if defined, a function taking (rawCard, referenceType,
        //  allRawCards) that should return the string to be used for backporting text. If
        // not defined, will just use card.title.
        backportTitleExtractor? : ( card : Card, referenceType : ReferenceType, allRawCards : Cards) => string
	}
}

export type SortExtra = {
    [cardID : CardID] : number
};

export type SortExtras = {
    [filterName : string]: SortExtra
};

export type WebInfo = {
    nodes: {id : CardID, name: string}[],
    edges: {source : CardID, target : CardID, value : number}[]
};

export type CardIDMap = {
    [id : CardID] : true | Card | ProcessedCard
};

export type SortExtractorResult = [sortValue : number, label : string];

export type SortConfigurationMap = {
    [sortName : string]: {
        extractor : (card : ProcessedCard, sections : Sections, cards : ProcessedCards, sortExtras : SortExtras) => SortExtractorResult ,
        description : string,
        labelName? : string | ((sortExtras : SortExtras) => string),
        reorderable? : (sortExtras : SortExtras) => boolean,
    }
}

export type ConfigurableFilterFunc = (card : ProcessedCard, extras? : FilterExtras) => ([matches : boolean] | [ matches : boolean, sortExtra : number] | [ matches : boolean, sortExtra : number, label : string]);

export type ConfigurableFilterFuncFactoryResult = [func : ConfigurableFilterFunc, reverse : boolean];

type ConfigurableFilterFuncFactory = (...parts : string[]) => ConfigurableFilterFuncFactoryResult;

//TODO: tighten to e.g. URL_PART_* constant values
type ConfigurableFilterFuncURLPart = string;

type ConfigurableFilterFuncArgument = {
    type : ConfigurableFilterFuncURLPart,
    description : string,
    default : number | string | boolean,
};

export type ConfigurableFilterConfigurationMap = {
    [filterName : string] : {
        factory : ConfigurableFilterFuncFactory,
        labelName? : string,
        flipOrder? : boolean,
        description : string,
        suppressLabels? : boolean,
        arguments : ConfigurableFilterFuncArgument[],
    }
};

//TODO: tighten
//TODO: this name is confusing, in the state this is just called tab
export type EditorTab = string;
//TODO: tighten
//TODO: this name is confusing, in the state this is called editorTab
export type EditorContentTab = string;

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

export type CommentMessage = {
    id: CommentMessageID
    author: Uid,
    card: CardID,
    created: Timestamp,
    deleted: boolean,
    message: string,
    thread: CommentThreadID,
    updated: Timestamp
};

export type CommentThread = {
    id: CommentThreadID,
    author: Uid,
    card: CardID,
    created: Timestamp,
    deleted: boolean,
    messages: CommentMessageID[],
    parent_message: CommentMessageID,
    resolved: boolean,
    updated: Timestamp,
};

//TODO: tighten this
export type HTMLTagName = string;

type CardTypeMap = {
    [typ : CardType] : boolean
}

export type CardFieldTypeConfigurationMap = {
    [typ : CardFieldType]: {
        // html: whether or not the field allows html. NOTE: currently it's only supported
        // for a single field to be marked as html, and it must be called 'body'. See #345
        // for fixing that.
        html? : boolean,
        // container: the type of container element the field should be printed out into
        // (the actual card custom element will decide whether to print it out in the first
        // place)
        container? : HTMLTagName,
        // legalCardTypes: a map of CARD_TYPE constant to true for cards it is legal on. If
        // this field is null, it signals it's legal on all card types.
        legalCardTypes? : CardTypeMap,
        // derivedForCardTypes: a map of CARD_TYPE constant to true for card types for
        // which the field is fully derived based on OTHER enumrated fields. Derived fields
        // are already "counted" so should be skipped when extracting normalized card
        // details for example in indexes.
        derivedForCardTypes? : CardTypeMap,
        // noContentEditable: if true, even if the form field is editable, it won't be made
        // editable on card renderer, the only way to modify it will be in the edit text
        // field in the content tab of editor.
        noContentEditable? : boolean,
        // displayPrefix: If set, then if the value is not empty then it will prefix the
        // given prefix. noContentEditable should also be true, otherwise you'll get the
        // prefix weirdly mixed in. Sort of sugar for htmlFormatter.
        displayPrefix? : string,
        // htmlFormatter: if provided, is a function that takes the raw value and returns
        // html to set, or '' to use the raw value. For the common case of just a prefix,
        // use displayPrefix. Should be combined with noContentEditable otherwise the
        // formated HTML will get mixed into the underlying value.
        htmlFormatter? : (input : string) => string,
        // extraRunDelimiter: if provided, then when deciding where to break runs, that
        // character will also be considered as a run break (in addition to the default
        // `\n`)
        extraRunDelimiter? : string,
        // hideIfEmpty: If true, then it will be hidden if there's no content.
        hideIfEmpty? : boolean,
        // description: If not empty, will show a help description next to that field in
        // editor.
        description? : string,
        // nonScrollable: If true, then it will be printed out in order in the
        // non-scrollable top region, before the scrollable portions are printed out in
        // order.
        nonScrollable? : boolean,
        // readOnly: if true, a form field to edit this won't be printed out in cardEditor.
        readOnly? : boolean,
        // matchWeight: if a match is found when searching in that field, how much weight
        // should it receive?
        matchWeight? : number,
        // autoFontSizeBoostForCardTypes: For any card type that has a key, fontSizeBoosts
        // will auto-set the font size for that field, with the value for that field being
        // used as the max value that the boost can legally be for that field. NOTE: card
        // types that define reference blocks will interfere with auto-sizing currently.
        // #407 tracks fixing that.
        autoFontSizeBoostForCardTypes? : {
            [typ : CardType]: number
        },
        // overrideExtractor: boolean. If true, then nlp.js will expect there to be an
        // override extractor defined in nlp.js. That is, instead of literally just
        // fetching a field with that name from card, it will instead rely on an extractor
        // function. (Those override extractors often require references, which would
        // pollute the clean imports for this file, so they're defined there)
        overrideExtractor? : boolean,
        // extraIndexingCount: if a number greater than zero, then when counting words from
        // that text field, the wordCountForSemantics will pretend like all of the text run
        // showed up that many times. So undefined or 0 would count as one, and 2 would
        // triple count.
        extraIndexingCount? : number,
        // indexFullRun: if true, then the full normalized text string of each run will be
        // indexed as though it were an ngram (even if the number of words is too high to
        // be counted as an ngram). In addition, it will count full (not 1/wordCount).
        indexFullRun? : boolean
    }
}

//TODO: tighten this
type CSSColorString = string;

export type ReferenceTypeConfigurationMap = {
    [type : ReferenceType] : {
        //name - name of the reference type, for presenting in UIs
        name : string,
        //inboundName - the name of the reference type when inbound, for presenting in UIs.
        inboundName? : string,
        //descripton - string describing what it means
        description: string,
        //editable - whether it should be directly editable by a user
        editable? : boolean,
        //substantive - whether the reference is important enough to acknowledge to a non-editor-user in the UI
        substantive? : boolean,
        //color - the color to use when it shows up as a tag
        color: CSSColorString,
        //excludeFromInfoPanel - if true, will not show up in the infoPanelArray. That might be because they are already visible elsewhere, or aren't important enough to show.
        excludeFromInfoPanel? : boolean,
        //toCardTypeAllowList - if null or undefined, any card of any type may be on the receiving end. If not null, then only card_types in the toCardTypeAllowList map are allowed.
        toCardTypeAllowList? : {
            [cardType : CardType]: true,
        },
        //fromCardTypeAllowList - if null or undefined, any card of any type may be on the sending end. If not null, then only card_types in the fromCardTypeAllowList are allowed.
        fromCardTypeAllowList? : {
            [cardType : CardType]: true,
        },
        //backportMissingText - if true, then if a card has an outbound reference of this type without text, it will backport the title of the to card, so for the purposes of any nlp processing, it will be as though the outbound reference included the title of the card it's pointing to. (The underlying data in the db is untouched)
        backportMissingText? : boolean,
        //subTypeOf - if set, then this reference type is also equivalent to the other reference type in a fundamental way. For example, example-of and synonym are equivalent to concept.
        subTypeOf? : ReferenceType,
        //conceptReference - if true, then this type of reference will be considered to be a concept reference even if it's not literally one (e.g. example-of, synonym). Every type is already equivalent to itself so that can be elided. A given card can only reference anohter card with one referenceType within an equivalence class.
        conceptReference? : boolean,
        //reciprocal - if true, then an outbound reference to a card should precisely imply the other card outbound links back to this one. 
        reciprocal? : boolean,
        //needsReciprocation - if true, then cards that don't reciprocate with a link will be called out.
        needsReciprocation? : boolean
    }
}

//When adding a field here, consider whether it should also be in CardDiff.
export interface Card {
    id: CardID,

    slugs: Slug[],
    name: CardIdentifier,

    author: Uid,
    collaborators: Uid[],
    permissions: CardPermissions,

    //A number that is compared to other cards to give the default sort
    //order. Higher numbers will show up first in the default sort order.
    //Before saving the card for the first time, you should set this to a
    //reasonable value, typically DEFAULT_SORT_ORDER_INCREMENT smaller than
    //every card already known to exist.
    sort_order: number,
    card_type: CardType,
    section: SectionID,
    tags: TagID[],


    published: boolean,
    //TODO: we should have this explicitly set on all cards, but in practice only some do.
    full_bleed? : boolean,

    title: string,
    subtitle? : string,
    body: string,
    notes: string,
    todo: string,

    //See the documentation for these two string contants in card_fields.js
    //for information on the shape of these fields.
    references_info: ReferencesInfoMap,
    references_info_inbound: ReferencesInfoMap,
    // version are like the normal properties, but where it's a map
    //of cardID to true if there's ANY kind of refernce. Whenever a card is
    //modified, these s are automatically mirrored basd on the value
    //of references. They're popped out primarily so that you can do
    //firestore qureies on them to find cards that link to another.
    references: ReferencesMap,
    references_inbound: ReferencesMap,

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

    //Defaul to epoch 1970 for things not yet tweeted
    last_tweeted: Timestamp,
    tweet_count: number,

}

type OptionalFields<Type> = {
    [Property in keyof Type]+?: Type[Property]
};

export type OptionalFieldsCard = OptionalFields<Card>;

type TimestampToFieldValue<Type> = {
    [Property in keyof Type]: Type[Property] extends Timestamp ? FieldValue : Type[Property]
};

//Firebase updates allow arrayUnion and arrayRemove sentinels
//TODO: arent' there at least some fields that are deletable (e.g. FieldValue:deleteSentinel)
type ArrayToFieldValueUnion<Type> = {
    [Property in keyof Type]: Type[Property] extends any[] ? Type[Property] | FieldValue : Type[Property]
}

export type CardUpdate = ArrayToFieldValueUnion<TimestampToFieldValue<OptionalFieldsCard>>;

//These are fields in CardDiff that cannot be auto-merged when edits are made by
//someone else.
interface NonAutoMergeableCardDiff {

    //Note: if you add or remove something here, also modify src/card_diff.ts:NON_AUTOMATIC_MERGE_FIELDS

    //Freeform text fields
    title? : string,
    title_alternates? : string,
    body? : string,
    subtitle? : string,
    todo? : string,
    notes? : string,

    //Special sub-objec that doesn't have diffing yet.
    images? : ImageBlock,
}

//Every field in here (or NonAutoMergeableCardDiff) has to be known how to be handled in various functions in card_diff.ts
export interface CardDiff extends NonAutoMergeableCardDiff  {

    //Every field directly on here (and not in NonAutoMergeableCardDiff) can
    //safely be auto-merged.

    name? : string,
    section? : SectionID,
    full_bleed? : boolean,
    sort_order? : number,
    published? : boolean,
    card_type? : CardType,


    font_size_boost? : FontSizeBoostMap,
    references_diff? : ReferencesEntriesDiff,

    auto_todo_overrides_enablements? : TODOType[],
    auto_todo_overrides_disablements? : TODOType[],
    auto_todo_overrides_removals? : TODOType[],
    add_editors? : Uid[],
    remove_editors? : Uid[],
    add_collaborators? : Uid[],
    remove_collaborators? : Uid[],
    addTags? : TagID[],
    removeTags? : TagID[],
}

export type SynonymMap = {
    [input : string]: string[]
}

//TODO: is there a better way to do this since ProcessRun just flat out exists in nlp.js?
interface ProcessedRunInterface {
    normalized : string,
    original : string,
    stemmed : string,
    withoutStopWords : string,
    readonly empty : boolean
}

type NLPInfo = {
    [field : CardFieldType]: ProcessedRunInterface[]
}

export interface ProcessedCard extends Card {
    //this is stashed there so that the cardWithNormalizedTextProperties machinery can fetch it if it wants.
    fallbackText: ReferencesInfoMap,
    //agains stashed here by cardWithNormalizedTextProperties so wordCountForSemantics can fetch it.
    importantNgrams: {
        [ngram : string] : CardID
    },
    synonymMap: SynonymMap,
    //TODO: lock this down more
    nlp: NLPInfo,
}

export type Cards = {
    [id : CardID]: Card
}

export type ProcessedCards = {
    [id: CardID]: ProcessedCard
}

//TODO: lock this down more
//UserPermissions enumerates each legal value by hand.
export type PermissionType = string;

export interface PermissionInfo {
	displayName : string,
	description : string,
	locked? : boolean,
	legalOnCard? : boolean,
}

export interface PermissionInfoCollection {
	[name: PermissionType]: PermissionInfo
}

export interface UserPermissions {
    id? : Uid,
    notes? : string,
    //The remaining properties are conceptually an enumeration of PermissionType.
    admin? : boolean,
    viewApp? : boolean,
    edit? : boolean,
    editSection? : boolean,
    editTag? : boolean,
    editCard? : boolean,
    createCard? : boolean,
    viewUnpublished? : boolean,
    comment? : boolean,
    star? : boolean,
    markRead? : boolean,
    modifyReadingList? : boolean,
};

export type UserPermissionsMap = {
	[person: Uid]: UserPermissions
};

//When adding to this also extend src/actions/prompt.ts:COMMIT_ACTIONS
export type CommitActionType = '' | 'CONSOLE_LOG' | 'EDIT_MESSAGE' | 'ADD_MESSAGE' | 'CREATE_THREAD';

//TODO: lock this down
export type SetName = string;
//TODO: lock this down
export type SortName = string;
//TODO: lock this down
export type ViewMode = string;

export type SectionID = string;

export type TagID = string;

//See also SectionUpdate
type Section = {
    start_cards : CardID[],
    order : number,
    cards : CardID[],
    title : string,
    subtitle? : string,
    updated : Timestamp,
    id : SectionID | TagID,
    default? : boolean,
}

export type SectionUpdate = TimestampToFieldValue<OptionalFields<Section>>;

export type Tags = {
    [tagName : TagID] : Section
}

export type Sections = {
    [sectionName : SectionID]: Section
}

export type Sets = {
    [setName : SetName] : CardID[]
}

export type FilterExtras = {
	filterSetMemberships : Filters,
	cards : ProcessedCards,
	keyCardID : CardID,
	editingCard : Card,
	userID : Uid,
};

export type FilterMap = {
    [id : CardID] : true
};

export type Filters = {
    [filterName : string] : FilterMap
}

export type SerializedDescriptionToCardList = {
    [serializedDescription: string] : CardID[],
}

export interface CollectionConstructorArguments {
    cards? : ProcessedCards,
    sets? : Sets,
    filters? : Filters,
    sections? : Sections,
    fallbacks? : SerializedDescriptionToCardList,
    startCards? : SerializedDescriptionToCardList,
    userID? : Uid,
    keyCardID? : CardID,
    cardsSnapshot? : ProcessedCards,
    filtersSnapshot? : Filters,
    editingCard? : Card
}

//TODO: tighten this
export type MaintenanceTaskID = string;
export type MaintenanceTask = {
    id: MaintenanceTaskID,
    timestamp: Timestamp,
    version: number,
};

//TODO: tighten to things like FIND_CARD_TO_PERMISSION et al
export type FindDialogType = string;

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
	activeSetName: SetName,
	//activeFilterNames is the list of named filters to apply to the default
	//set. These names are either concrete filters, inverse filters, or union
	//filters (i.e. they concatenate conrete or inverse filternames delimited by
	//'+'). For the purposes of processing URLs though they can all be treated
	//as though they're concrete filters named their literal name in this.
	activeFilterNames: string[],
	activeSortName: SortName,
	activeSortReversed: boolean,
	activeViewMode: ViewMode,
	activeViewModeExtra: string,
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
	activeCardId: CardID,
	activeRenderOffset: number,
}

export type CommentsState = {
	messages: {[id : CommentMessageID]: CommentMessage},
	threads: {[id : CommentThreadID]: CommentThread},
	messagesLoaded: boolean,
	threadsLoaded: boolean,
}

export type DataState = {
	cards: Cards,
	authors: {[id : Uid]: Author},
	sections: Sections,
	tags: Tags,
	slugIndex: {[slug : Slug] : CardID},
	//A snapshot of cards from last time UPDATE_COLLECTION_SHAPSHOT was called.
	//Keeping a snapshot helps make sure that filtering logic in the current
	//collection doesn't change constantly
	cardsSnapshot: Cards,
	//a map of cardID -> true for cards that we expect to be deleted imminently,
	//since we just issued a deletion command to the datastore.
	expectedDeletions: {[id : CardID] : true},
	//true while we're loading tweets for the current card
	tweetsLoading: boolean,
	//We only fetch tweets for cards that we have already viewed.
	tweets: {[tweetID : string]: TweetInfo},
	//These three are flipped to true on the first UPDATE_type entry, primarily
	//as a flag to  selectDataisFullyLoaded.
	publishedCardsLoaded: boolean,
	unpublishedCardsLoaded: boolean,
	sectionsLoaded: boolean,
	tagsLoaded: boolean,
	//keeps track of whether we committed any pending collections on being fully
	//loaded already. If so, then even if refreshCardSelector gets called again,
	//we won't update the collection again.
	alreadyCommittedModificationsWhenFullyLoaded: boolean,
	//Whether a card modification is pending
	cardModificationPending: boolean,
	cardModificationError: Error,
	reorderPending: boolean,
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
	pendingNewCardIDToNavigateTo: CardID
}

export type EditorState = {
	editing: boolean,
	//this is a map of field name to true if it was updated last from content
	//editable, or false or missing if it wasn't.
	updatedFromContentEditable: {[field : CardFieldType] : true},
	card: Card,
	//A direct reference to the card, as it was when editing started, in the
	//cards array. Useful for detecting when the underlying card has changed.
	underlyingCardSnapshot: Card,
	//The very original card snapshot from when editing started. This allows us
	//to figure out what edits have been merged in from other users while we're
	//open for editing.
	originalUnderlyingCardSnapshot: Card,
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
	cardTypeFilter: CardType,
	//if true, the filter shouldn't be able to be changed
	cardTypeFilterLocked: boolean,
}

export type MaintenanceTaskMap = {
    [id : MaintenanceTaskID]: MaintenanceTask
}

export type MaintenanceState = {
	executedTasks: MaintenanceTaskMap,
	taskActive: false,
}

export type MultiEditState = {
	open: boolean,
	referencesDiff: ReferencesEntriesDiff,
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

export type UserState = {
	user : UserInfo,
	//pending is true whenever we are expecting either a SIGNIN_SUCCESS or
	//SIGNOUT_SUCCESS. That's true both when the page loads before we get the
	//initial auth state (which is why it defaults to true), and also when the
	//user has proactively hit the signIn or signOut buttons.
	pending: boolean,
	error: Error,
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
    app: AppState,
    data: DataState,
    find? : FindState,
    editor? : EditorState,
	collection? : CollectionState,
	prompt? : PromptState,
	comments? : CommentsState,
    maintenance? : MaintenanceState,
    multiedit? : MultiEditState,
    permissions? : PermissionsState,
    user? : UserState
}