import {
	CONFIGURABLE_FILTER_ARGUMENTS,
	CONFIGURABLE_FILTER_NAMES,
	INVERSE_FILTER_NAMES,
	REVERSE_CARD_FILTER_CONFIG_MAP,
	TODO_ALL_INFOS,
} from './filters.js';

import {
	CollectionDescription,
} from './collection_description.js';

import {
	collectionExpressionParts,
	collectionFilterDescription,
	collectionFilterDisplayName,
	collectionFilterLabels,
	type CollectionComposerCandidate,
} from './collection-composer-suggestions.js';

export type CollectionFilterCatalogCategory =
	| 'Suggested for this card'
	| 'Common'
	| 'Dates'
	| 'Tags and sections'
	| 'People'
	| 'Relationships'
	| 'Similarity'
	| 'Text and specific cards'
	| 'Card properties'
	| 'Advanced';

export type CollectionFilterCatalogItem = {
	filter: string;
	label: string;
	detail: string;
	example: string;
	category: CollectionFilterCatalogCategory;
	configurable: boolean;
	guided: boolean;
	appliedIndex: number;
	searchValues: string[];
	//The other half of an `x` / `not-x` pair, or '' when this filter has no
	//opposite. One catalog row stands for the whole pair; the polarity
	//affordance swaps which half `filter` names.
	oppositeFilter: string;
	//True when `filter` is the excluding half of the pair, so the row can say
	//so without re-deriving it from the name.
	negated: boolean;
	//The stable identity of the pair, which is what a polarity choice is
	//recorded against — it does not change when the row flips.
	polarityKey: string;
};

//Which filter this catalog row would use if the polarity were flipped, keyed
//by the pair's stable identity. The component owns the record; the catalog
//just honors it.
export type CollectionFilterCatalogPolarity = Readonly<Record<string, string>>;

const CATEGORY_ORDER : CollectionFilterCatalogCategory[] = [
	'Suggested for this card',
	'Common',
	'Dates',
	'Tags and sections',
	'People',
	'Relationships',
	'Similarity',
	'Text and specific cards',
	'Card properties',
	'Advanced',
];

// Keep the small, unfiltered catalog useful without requiring someone to know
// what to search for. Applied filters come first (so they are always editable),
// followed by a few durable, high-frequency entry points.
const COMMON_FILTER_ORDER = [
	'working-notes',
	'has-todo',
	'published',
	'unread',
	'starred',
	'content',
	'concept',
	'person',
	'quote',
	'work',
	'section-head',
];

const COMMON_FILTERS = new Set(COMMON_FILTER_ORDER);
const SIMILARITY_FILTERS = new Set(['similar', 'similar-cutoff', 'same-type', 'different-type']);
const STRUCTURAL_FILTERS = new Set(['combine', 'exclude', 'expand', 'limit', 'offset']);
const SOURCE_ONLY_FILTERS = new Set(['combine', 'exclude', 'expand']);

//The filter machinery already knows every `x` / `not-x` pair: INVERSE_FILTER_NAMES
//maps each EXCLUDING filter to the including one it is the complement of, and
//that is the same map the collection code uses to decide a filter is an exclude
//set. Deriving the pairs from it — rather than string-matching a `not-` prefix —
//is why `unread`/`read`, `no-todo`/`has-todo`, `missing-reciprocal-links`/
//`has-all-reciprocal-links` and `all-cards`/`none` all merge correctly even
//though none of them spell the negation the same way.
const OPPOSITE_OF : Record<string, string> = {};
for (const [negated, positive] of Object.entries(INVERSE_FILTER_NAMES)) {
	if (!OPPOSITE_OF[positive]) OPPOSITE_OF[positive] = negated;
	if (!OPPOSITE_OF[negated]) OPPOSITE_OF[negated] = positive;
}
const IS_NEGATED_FILTER = new Set(Object.keys(INVERSE_FILTER_NAMES));

//The card-editing hygiene family — every `has-x` / `no-x` / `needs-x` /
//`does-not-need-x` filter the TODO machinery generates. They are real filters
//and stay in the catalog, but they are tools for grooming the corpus, not ways
//most people describe a set of cards, so they sort below the properties that
//are. Derived from the filter machinery's own TODO configuration rather than
//from the shape of the names.
const isTodoMachineryFilter = (filter : string) : boolean =>
	Boolean(TODO_ALL_INFOS[REVERSE_CARD_FILTER_CONFIG_MAP[filter]]);

const commonFilterRank = (filter : string) => {
	const rank = COMMON_FILTER_ORDER.indexOf(filter);
	return rank < 0 ? Number.POSITIVE_INFINITY : rank;
};

const categoryFor =(filter : string, candidate? : CollectionComposerCandidate) : CollectionFilterCatalogCategory => {
	if (candidate?.spotlight) return 'Suggested for this card';
	const family = filter.split('/')[0];
	if (COMMON_FILTERS.has(filter)) return 'Common';
	if (SIMILARITY_FILTERS.has(family)) return 'Similarity';
	if (STRUCTURAL_FILTERS.has(family)) return 'Advanced';
	if (candidate?.category === 'date') return 'Dates';
	if (candidate?.category === 'tag' || candidate?.category === 'section') return 'Tags and sections';
	if (candidate?.category === 'author') return 'People';
	if (candidate?.category === 'relationship') return 'Relationships';
	if (candidate?.category === 'card type' || candidate?.category === 'todo') return 'Common';
	const argumentTypes = (CONFIGURABLE_FILTER_ARGUMENTS[family] || []).map(argument => argument.type);
	if (argumentTypes.includes('date') || ['created', 'updated', 'last-tweeted'].includes(family)) return 'Dates';
	if (argumentTypes.includes('user-id')) return 'People';
	if (argumentTypes.some(type => ['key-card', 'reference-type', 'sub-filter', 'expand-filter'].includes(type))) return 'Relationships';
	if (argumentTypes.some(type => ['text', 'multiple-cards', 'concept-str-or-id'].includes(type))) return 'Text and specific cards';
	if (CONFIGURABLE_FILTER_NAMES[family] || ['limit', 'offset'].includes(family)) return 'Advanced';
	return 'Card properties';
};

//An example is only useful if it is an example of what would happen HERE. It
//builds on the draft the user is actually composing, so choosing the row is a
//prediction they can check, not a claim about a collection they are not in.
const exampleFor = (
	filter : string,
	base : string,
	labels : Record<string, string>,
	candidate? : CollectionComposerCandidate
) : string => {
	const clause = (value : string) => collectionFilterDisplayName(value, labels);
	if (candidate) return `${base} AND ${clause(candidate.filter)}`;
	const family = filter.split('/')[0];
	if (['updated', 'created', 'last-tweeted'].includes(family)) return `${base} AND ${clause(`${family}/after/7-days-ago`)}`;
	if (family === 'query') return `${base} AND ${clause('query/systems')}`;
	if (family === 'query-strict') return `${base} AND ${clause('query-strict/systems thinking')}`;
	if (family === 'author') return `${base} AND My Cards`;
	if (family === 'exclude') return `${base} AND NOT ${clause('working-notes')}`;
	if (family === 'combine') return `${base} AND (Tagged AI OR Tagged Systems)`;
	if (family === 'expand') return `Start with ${base}, then include linked cards`;
	const argumentsInfo = CONFIGURABLE_FILTER_ARGUMENTS[family] || [];
	const configured = argumentsInfo.length ? `${family}/${argumentsInfo.map(argument => argument.default).join('/')}` : filter;
	return `${base} AND ${clause(configured)}`;
};

const relevance = (searchValues : string[], query : string) : number => {
	if (!query) return 0;
	const values = searchValues.map(value => value.toLowerCase());
	if (values.some(value => value === query)) return 0;
	if (values.some(value => value.startsWith(query))) return 1;
	const words = query.split(/\s+/).filter(Boolean);
	if (words.every(word => values.some(value => value.includes(word)))) return 2;
	return Number.POSITIVE_INFINITY;
};

type CatalogSide = {
	filter : string;
	label : string;
	detail : string;
	example : string;
	category : CollectionFilterCatalogCategory;
	configurable : boolean;
	guided : boolean;
	appliedIndex : number;
	searchValues : string[];
	relevance : number;
	candidateWorthy : boolean;
	commonRank : number;
	spotlight : boolean;
	negated : boolean;
	todoMachinery : boolean;
};

export const buildCollectionFilterCatalog = (
	filterDescriptions : Readonly<Record<string, string>>,
	candidates : readonly CollectionComposerCandidate[],
	draft : CollectionDescription,
	query = '',
	polarity : CollectionFilterCatalogPolarity = {}
) : CollectionFilterCatalogItem[] => {
	const candidateByFilter = new Map(candidates.map(candidate => [candidate.filter, candidate]));
	const labels = collectionFilterLabels(candidates);
	const appliedFilters = draft.filters;
	const draftParts = collectionExpressionParts(draft, labels);
	const base = [draftParts.set.label, ...draftParts.filters.map(part => part.label)].join(' AND ');
	const filters = Array.from(new Set([...Object.keys(filterDescriptions), ...candidates.map(candidate => candidate.filter)]));
	const known = new Set(filters);
	const normalizedQuery = query.trim().toLowerCase();

	const buildSide = (filter : string) : CatalogSide => {
		const candidate = candidateByFilter.get(filter);
		const family = filter.split('/')[0];
		const appliedIndex = appliedFilters.findIndex(applied => applied === filter ||
			(filter === family && Boolean(CONFIGURABLE_FILTER_NAMES[family]) && applied.startsWith(`${family}/`)));
		const label = collectionFilterDisplayName(filter, labels);
		const negated = IS_NEGATED_FILTER.has(filter);
		//An excluding half whose only description is the synthesized "Inverse of
		//<internal id>" would leak a raw filter name (HS-1.4). One shared
		//function decides that, for this catalog and for the suggestion list, so
		//the same filter cannot be honest in one and leaky in the other.
		const detail = candidate?.detail ||
			collectionFilterDescription(filter, filterDescriptions, labels) ||
			`Keeps cards matching ${label}`;
		//AN EXAMPLE OF AN APPLIED FILTER IS THE DRAFT ITSELF. Composing one
		//unconditionally produced "Main AND Tagged tag-14 AND Tagged tag-14" for
		//a filter the row's own badge says is "Already in this collection" — an
		//example of a collection nobody can reach, contradicting the badge two
		//lines below it. The draft already contains the filter, so showing the
		//draft as it stands is both the honest example and the true one.
		const example = appliedIndex >= 0 ? base : exampleFor(filter, base, labels, candidate);
		const searchValues = [
			filter,
			family,
			label,
			candidate?.label || '',
			detail,
			example,
			candidate?.category || '',
			...(candidate?.aliases || []),
		].filter(Boolean);
		return {
			filter,
			label,
			detail,
			example,
			category: categoryFor(filter, candidate),
			configurable: Boolean(CONFIGURABLE_FILTER_NAMES[family]),
			guided: !SOURCE_ONLY_FILTERS.has(family),
			appliedIndex,
			searchValues,
			relevance: relevance(searchValues, normalizedQuery),
			candidateWorthy: Boolean(candidate),
			commonRank: commonFilterRank(filter),
			spotlight: Boolean(candidate?.spotlight),
			negated,
			todoMachinery: isTodoMachineryFilter(filter),
		};
	};

	const items : CollectionFilterCatalogItem[] = [];
	const scored : {item : CollectionFilterCatalogItem, side : CatalogSide}[] = [];
	for (const filter of filters) {
		const opposite = OPPOSITE_OF[filter];
		const paired = Boolean(opposite) && known.has(opposite);
		//One row per pair. The row lives with the INCLUDING half so the same
		//pair is never visited twice; the excluding half is reachable through
		//the row's polarity affordance.
		if (paired && IS_NEGATED_FILTER.has(filter)) continue;
		const sides = paired ? [buildSide(filter), buildSide(opposite)] : [buildSide(filter)];
		const polarityKey = filter;
		//Which half the row shows when nobody has flipped it: the half actually
		//in the draft (so an applied clause is always editable), then whichever
		//half the query matched better, then the half the suggestion system or
		//the common list already thinks is worth offering, and finally the
		//including half.
		const defaultSide = sides.find(candidateSide => candidateSide.appliedIndex >= 0) ||
			[...sides].sort((left, right) =>
				left.relevance - right.relevance ||
				Number(right.candidateWorthy) - Number(left.candidateWorthy) ||
				left.commonRank - right.commonRank ||
				Number(left.negated) - Number(right.negated))[0];
		//An explicit flip wins over all of that — it is the user pointing at the
		//half they want. The row keeps the DEFAULT half's category and sort
		//position either way, so flipping a row never makes it jump to another
		//part of the catalog while the user is looking at it.
		const side = sides.find(candidateSide => candidateSide.filter === polarity[polarityKey]) || defaultSide;
		const otherSide = sides.find(candidateSide => candidateSide !== side);
		const item : CollectionFilterCatalogItem = {
			filter: side.filter,
			label: side.label,
			detail: side.detail,
			example: side.example,
			category: defaultSide.category,
			configurable: side.configurable,
			guided: side.guided,
			appliedIndex: side.appliedIndex,
			//Both halves stay searchable from one row: someone who remembers
			//"unread" still finds the row even when it is currently showing
			//"Read".
			searchValues: [...side.searchValues, ...(otherSide?.searchValues || [])],
			oppositeFilter: otherSide?.filter || '',
			negated: side.negated,
			polarityKey,
		};
		items.push(item);
		scored.push({item, side: defaultSide});
	}

	//A row matches if EITHER half of its pair matches, so merging two entries
	//into one never makes a filter unfindable by the name someone remembers.
	const bestRelevance = new Map(items.map(item => [item, relevance(item.searchValues, normalizedQuery)]));
	const sideOf = new Map(scored.map(({item, side}) => [item, side]));
	return items
		.filter(item => Number.isFinite(bestRelevance.get(item) ?? Number.POSITIVE_INFINITY))
		.sort((a, b) => {
			const sideA = sideOf.get(a)!;
			const sideB = sideOf.get(b)!;
			//Usefulness, not alphabet — inside Card properties, which is the
			//category that was a straight alphabetical dump of everything the
			//filter machinery happens to define. A filter the suggestion system
			//already thinks is worth proposing comes first, then the ordinary
			//properties, then the corpus-grooming TODO family. The other
			//categories are already small and hand-ordered, so they keep the
			//ordering they had.
			const usefulness = a.category === 'Card properties' && b.category === 'Card properties' ?
				(Number(sideB.candidateWorthy) - Number(sideA.candidateWorthy) ||
					Number(sideA.todoMachinery) - Number(sideB.todoMachinery)) : 0;
			return (bestRelevance.get(a) ?? 0) - (bestRelevance.get(b) ?? 0) ||
				CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
				Number(b.appliedIndex >= 0) - Number(a.appliedIndex >= 0) ||
				Number(sideB.spotlight) - Number(sideA.spotlight) ||
				usefulness ||
				sideA.commonRank - sideB.commonRank ||
				a.label.localeCompare(b.label);
		});
};

export const collectionFilterCatalogCategories = CATEGORY_ORDER;
