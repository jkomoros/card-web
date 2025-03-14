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
	CardFlags
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
	CardFlags
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

export interface Card {
	//This is a cut-down version that only has the fields we need
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

	//A spot for stashing various flags and metadata.
	flags? : CardFlags,

	published: boolean,
	//TODO: we should have this explicitly set on all cards, but in practice only some do.
	full_bleed? : boolean,

	title: string,
	subtitle? : string,
	title_alternates? : string,
	body: string,
	commentary? : string,
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
	references: CardBooleanMap,
	references_inbound: CardBooleanMap,
	//images is an imagesBlock. See src/images.js for a definition.
	images: ImageBlock,

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