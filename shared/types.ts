import {
	z
} from 'zod';

export type Uid = string;

export type CardID = string;
export type Slug = string;
export type CardIdentifier = CardID | Slug;

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