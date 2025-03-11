import {
	z
} from 'zod';

export type Uid = string;

export type CardID = string;
export type Slug = string;
export type CardIdentifier = CardID | Slug;

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