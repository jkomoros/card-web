//TODO: reuse the types from the main project

import {
	Timestamp,
	FieldValue
} from 'firebase-admin/firestore';

import {
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
	ImageInfo,
	ImageBlock,
	CardFlags,
	ExpandedReferenceKey,
	ExpandedReferenceObject,
	ExpandedReferenceDelete,
	ReferencesEntriesDiffItem,
	ReferencesEntriesDiff,
	ReferencesDiff,
	ReferencesCardsDiff,
	CardFieldType,
	FontSizeBoostMap,
	AutoTODOType,
	TODOType,
	TODOOverrides,
	NonAutoMergeableCardDiff,
	CardDiff,
	Card
} from '../../shared/types.js';

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
	UserPermissionsCore,
	PermissionType,
	CardPermissions,
	ImageInfo,
	ImageBlock,
	CardFlags,
	ExpandedReferenceKey,
	ExpandedReferenceObject,
	ExpandedReferenceDelete,
	ReferencesEntriesDiffItem,
	ReferencesEntriesDiff,
	ReferencesDiff,
	ReferencesCardsDiff,
	CardFieldType,
	FontSizeBoostMap,
	AutoTODOType,
	TODOType,
	TODOOverrides,
	NonAutoMergeableCardDiff,
	CardDiff,
	Card
};

// SectionID and TagID now imported from shared/types.js

// Simple Section type for functions, extending the core definition
export type Section = SectionCore;

// ReferenceType now imported from shared/types.js

// Use the shared Sections type with our specific Section interface
export type Sections = SharedSections<Section>;

// Extending the shared UserPermissionsCore with just what functions need
export interface UserPermissions extends Partial<UserPermissionsCore> {
	//This is a cut-down version that only has the fields we need
	admin?: boolean;
	remoteAI?: boolean;
}

export type Cards = Record<CardID, Card>;

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

type TimestampToFieldValue<Type> = {
	[Property in keyof Type]: Type[Property] extends Timestamp ? FieldValue | Type[Property] : Type[Property]
};

type NumberToFieldValue<Type> = {
	[Property in keyof Type]: Type[Property] extends number ? FieldValue | Type[Property] : Type[Property]
};

//Firebase updates allow arrayUnion and arrayRemove sentinels
//TODO: arent' there at least some fields that are deletable (e.g. FieldValue:deleteSentinel)
type ArrayToFieldValueUnion<Type> = {
	[Property in keyof Type]: Type[Property] extends unknown[] ? Type[Property] | FieldValue : Type[Property]
}

//Replicated in src/actions/similarity.ts
export type EmbeddableCard = Pick<Card, 'body' | 'title' | 'commentary' | 'subtitle' | 'card_type' | 'created' | 'id'>;

export type CardUpdate = Partial<NumberToFieldValue<ArrayToFieldValueUnion<TimestampToFieldValue<Card>>>>;

export type CardLike = Card | CardUpdate;

export type TweetInfoUpdate = Partial<TimestampToFieldValue<TweetInfo>>;

//Replicated in `src/actions/database.ts`
export type LegalRequestData = {
	type: 'warmup'
} | {
	type: 'slug',
	value: string
};

//Replicated in `src/actions/database.ts`
export type LegalResponseData = {
	legal: boolean,
	reason: string
};

type MillisecondsSinceEpoch = number;

//Replicated in `src/actions/similarity.ts`
export type SimilarCardsRequestData = {
	card_id: CardID

	//timestamp in milliseconds since epoch. If provided, results will only be
	//provided if the Vector point has a last-updated since then, otherwise
	//error of `stale`.
	last_updated? : MillisecondsSinceEpoch

	//TODO: include a limit

	//If card is provided, it will be used to get the content to embed, live.
	//The user must have AI permission or it will fail.
	//The card provided should match the card_id
	card?: EmbeddableCard
};

//Replicated in `src/actions/similarity.ts`
export type CardSimilarityItem = [CardID, number];

//Replicated in `src/actions/similarity.ts`
export type SimilarCardsResponseData = {
	success: false,
	code: 'qdrant-disabled' | 'insufficient-permissions' | 'no-embedding' | 'stale-embedding' | 'unknown'
	error: string
} | {
	success: true
	cards: CardSimilarityItem[]
};

//Replicated in `src/actions/bulk-import.ts`
export type SemanticSortRequestData = {
	cards: CardID[]
}

//Replicated in `src/actions/bulk-import.ts`
export type SemanticSortResponseData = {
	cards: CardID[],
	swaps: number
}