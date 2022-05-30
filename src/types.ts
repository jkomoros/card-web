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

type ReferencesInfoMap = {
    [id : CardID]: {
        [typ : CardType]: string
    }
}

export interface Card {
    created: FirestoreTimestamp,
    updated: FirestoreTimestamp,
    author: Uid,
    permissions: CardPermissions,
    collaborators: Uid[],
    updated_substantive: FirestoreTimestamp,
    updated_message: FirestoreTimestamp,
    star_count: number,
    star_count_manual: number,
    tweet_favorite_count: number,
    tweet_retweet_count: number,
    thread_count: number,
    thread_resolved_count: number,
    sort_order: number,
    title: string,
    section: string,
    body: string,
    references_info: ReferencesInfoMap,
    references_info_inbound: ReferencesInfoMap,
    references: ReferencesMap,
    references_inbound: ReferencesMap,
    font_size_boost: FontSizeBoostMap,
    card_type: CardType,
    notes: string,
    todo: string,
    slugs: Slug[],
    name: CardIdentifier,
    tags: string[],
    published: boolean,
    images: ImageBlock,
    auto_todo_overrides: TODOOverrides,
    last_tweeted: FirestoreTimestamp,
    tweet_count: number,
}

export interface ProcessedCard extends Card {
    //TODO: lock this down more
    fallbackText: any,
    //TODO: lock this down more
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