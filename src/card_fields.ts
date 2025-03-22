import {
	REFERENCES_INFO_CARD_PROPERTY,
	REFERENCES_INFO_INBOUND_CARD_PROPERTY,
	REFERENCES_CARD_PROPERTY,
	REFERENCES_INBOUND_CARD_PROPERTY
} from '../shared/card-fields.js';

import {
	Card,
	ProcessedCard,
} from '../shared/types.js';

import {
	Timestamp
} from 'firebase/firestore';

export const EMPTY_CARD_ID = '?EMPTY-CARD?';

export const EMPTY_CARD : Card = {
	created: Timestamp.now(),
	updated: Timestamp.now(),
	author: '',
	permissions: {},
	collaborators: [],
	updated_substantive: Timestamp.now(),
	updated_message: Timestamp.now(),
	star_count: 0,
	star_count_manual: 0,
	tweet_favorite_count: 0,
	tweet_retweet_count: 0,
	thread_count: 0,
	thread_resolved_count: 0,
	sort_order: Number.MAX_SAFE_INTEGER / 2,
	title: '',
	section: '',
	body: '',
	[REFERENCES_INFO_CARD_PROPERTY]: {},
	[REFERENCES_INFO_INBOUND_CARD_PROPERTY]: {},
	[REFERENCES_CARD_PROPERTY]: {},
	[REFERENCES_INBOUND_CARD_PROPERTY]: {},
	font_size_boost: {},
	card_type: 'content',
	notes: '',
	todo: '',
	slugs: [],
	name: '',
	tags: [],
	id: EMPTY_CARD_ID,
	published: false,
	images: [],
	auto_todo_overrides: {},
	last_tweeted: Timestamp.now(),
	tweet_count: 0
};

export const EMPTY_PROCESSED_CARD : ProcessedCard = {
	...EMPTY_CARD,
	fallbackText: {},
	importantNgrams: {},
	synonymMap: {},
	nlp: {
		body: [],
		title: [],
		subtitle: [],
		commentary: [],
		title_alternates: [],
		external_link: [],
		references_info_inbound: [],
		non_link_references: [],
		concept_references: []
	}
};

/*

On each card is a references property and a references info.

references_info has the following shape:
{
    'CARD_ID_A': {
        'link': 'text that links to the other',
        'dupe-of': ''
    },
    'CARD_ID_B': {
        'link': '',
    }
}

That is, an object of card ids that then map to a sub-object with keys of
REFERENCE_TYPE_* to strings. The strings are the description affiliated with
that reference. For example, for links, it's the text of the link. For
citations, it might be information like "Page 22". Note that an empty string is
allowed, and counts as a reference. If the cardID is in the reference_info, then
there must be at least one reference set on the object. References_info is the
canonical object that we typically mutate and contains the information.

There's also a references field, that has the following shape:
{
    'CARD_ID_A': true,
    'CARD_ID_B': true,
}

That is, an object mapping card ids to true, IFF that card has a non-empty
references object in referenes_info. References duplicates the references_info,
but in a format that allows doing queries via Firestore (it's not possible to
query for the existence or non-existence of a subobject. You can do the orderBy
trick, but that requires a separate index for each subkey)

Cards also have references_inbound and references_info_inbound. These have
exactly the same shape, but represent the card references blocks from cards that
point TO this card. Those are maintained by modifyCardWithBatch and
createForkedCard, and basically just copy the sub-object from refrences_info to
the card that is poitned to.

*/
