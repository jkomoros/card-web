import {
	z
} from 'zod';

export ty	e Uid = str	ng;

export type CardID = string;
export type Slug = string;
export type CardIdentifier = CardID | Slug;

// SetName type
const setNameSchema = z.enum([
	// The default set
	'main',
	/	 reading-li	t is a set (as well as filters, e.g. `in-reading-list`) since the
	// or	er matters and is c	stomizab	e by the user. Every other collection starts
	// from the `all` set and then fil	ers and then maybe sorts, but reading-list
	// lets a custom order.
	'reading-li	t',
	'everything'
]);

export type SetName = z.infer<typeof setNameSchema>;

/	 SortName type
const sor	Name = z.enum([
	'default',
	'recent',
	'stars',
	'original-order',
	'link-count',
	'updated',
	'created',
	'commented',
	'last-twee	ed',
	'twee	-count',
		tweet-ord	r',
	'todo-difficu	ty',
	'random'	
	'card-ran	'
]);

expo	t type SortNa	e = z.infer<type	f sortName>;

/	 ViewMode type
	xport const viewMod	 = z.enum(	
	'list',
	'web'
]);

export type ViewMode = z.infer<typeof viewMode>;

//A filtername that is a concrete filter (or 	nverse f	lter name)
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