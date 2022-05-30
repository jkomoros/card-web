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

//TODO: lock this down more
type ImageBlock = any;

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

export type Sets = {
    [setName : SetName] : CardID[]
}

export type Filters = {
    [filterName : string] : {
        [id : CardID] : true
    }
}

export interface CollectionConstructorArguments {
    cards? : Cards,
    sets? : Sets,
    filters? : Filters,
    sections? : {
        [sectionName : string]: Section
    },
    fallbacks? : {
        [serializedDescription: string] : CardID[],
    }
    startCards? : {
        [serializedDescription : string] : CardID[],
    },
    userID? : Uid,
    keyCardID? : CardID,
    cardsSnapshot? : Cards,
    filtersSnapshot? : Filters,
    editingCard? : Card
}