//TODO: just use the firestore definition?
interface FirestoreTimestamp {
    seconds: number,
    nanoseconds: number,
}

export type Uid = string;

export type CardID = string;
export type Slug = string;
export type CardIdentifier = CardID | Slug;

//TODO: lock this down more
//TODO: should this be the same as PermissionInfoType?
type CardPermissionType = string;

type CardPermissions = {
    [name : CardPermissionType]: Uid[]
}

//TODO: lock this down more
type CardFieldType = string;

type FontSizeBoostMap = {
    [name: CardFieldType]: number,
}

//TODO: lock this down more
export type CardType = string;

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
    created : FirestoreTimestamp
    card : CardID
    archived : boolean
    archive_date : FirestoreTimestamp
    retweet_count : number;
    favorite_count : number;
    //Last time we fetched and updated the retweet and favorite counts
    engagement_last_fetched : FirestoreTimestamp
    //Last time the retweet or favorite counts CHANGED from what we already had
    //stored.
    engagement_last_changed : FirestoreTimestamp
}

//TODO: tighten this
type IconName = string;

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

export interface Card {
    id: CardID,
    created: FirestoreTimestamp,
    updated: FirestoreTimestamp,
    author: Uid,
    permissions: CardPermissions,
    collaborators: Uid[],
    updated_substantive: FirestoreTimestamp,
    updated_message: FirestoreTimestamp,
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
    //A number that is compared to other cards to give the default sort
    //order. Higher numbers will show up first in the default sort order.
    //Before saving the card for the first time, you should set this to a
    //reasonable value, typically DEFAULT_SORT_ORDER_INCREMENT smaller than
    //every card already known to exist.
    sort_order: number,
    title: string,
    section: string,
    body: string,
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
    card_type: CardType,
    notes: string,
    todo: string,
    slugs: Slug[],
    name: CardIdentifier,
    tags: string[],
    published: boolean,
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
    //Defaul to epoch 1970 for things not yet tweeted
    last_tweeted: FirestoreTimestamp,
    tweet_count: number,
}

export interface ProcessedCard extends Card {
    //TODO: lock this down more
    //this is stashed there so that the cardWithNormalizedTextProperties machinery can fetch it if it wants.
    fallbackText: any,
    //TODO: lock this down more
    //agains stashed here by cardWithNormalizedTextProperties so wordCountForSemantics can fetch it.
    importantNgrams: any,
    //TODO: lock this down more
    synonymMap: any,
    //TODO: lock this down more
    nlp: any,
}

export type Cards = {
    [id : CardID]: Card
}

export type ProcessedCards = {
    [id: CardID]: ProcessedCard
}

//TODO: lock this down more
export type PermissionInfoType = string;

export interface PermissionInfo {
	displayName : string,
	description : string,
	locked? : boolean,
	legalOnCard? : boolean,
}

export interface PermissionInfoCollection {
	[name: PermissionInfoType]: PermissionInfo
}

//TODO: lock this down
export type SetName = string;
//TODO: lock this down
export type SortName = string;
//TODO: lock this down
export type ViewMode = string;

type Section = {
    start_cards : CardID[],
    order : number,
    cards : CardID[],
    title : string,
    updated : FirestoreTimestamp,
    id : string
}

export type Sections = {
    [sectionName : string]: Section
}

export type Sets = {
    [setName : SetName] : CardID[]
}

export type Filters = {
    [filterName : string] : {
        [id : CardID] : true
    }
}

export type SerializedDescriptionToCardList = {
    [serializedDescription: string] : CardID[],
}

export interface CollectionConstructorArguments {
    cards? : Cards,
    sets? : Sets,
    filters? : Filters,
    sections? : Sections,
    fallbacks? : SerializedDescriptionToCardList,
    startCards? : SerializedDescriptionToCardList,
    userID? : Uid,
    keyCardID? : CardID,
    cardsSnapshot? : Cards,
    filtersSnapshot? : Filters,
    editingCard? : Card
}