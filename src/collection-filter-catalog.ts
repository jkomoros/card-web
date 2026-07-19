import {
	CONFIGURABLE_FILTER_ARGUMENTS,
	CONFIGURABLE_FILTER_NAMES,
} from './filters.js';

import {
	readableCollectionFilter,
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
};

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

const commonFilterRank = (filter : string) => {
	const rank = COMMON_FILTER_ORDER.indexOf(filter);
	return rank < 0 ? Number.POSITIVE_INFINITY : rank;
};

const humanize = (value : string) => value
	.split(/[- ]/)
	.map(word => word ? word[0].toUpperCase() + word.slice(1) : '')
	.join(' ');

const categoryFor = (filter : string, candidate? : CollectionComposerCandidate) : CollectionFilterCatalogCategory => {
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

const exampleFor = (filter : string, candidate? : CollectionComposerCandidate) : string => {
	if (candidate) return `Everything AND ${candidate.clauseLabel || candidate.label}`;
	const family = filter.split('/')[0];
	if (family === 'updated') return 'Everything AND Updated in the last 7 days';
	if (family === 'created') return 'Everything AND Created in the last 7 days';
	if (family === 'last-tweeted') return 'Everything AND Tweeted in the last 7 days';
	if (family === 'query') return 'Everything AND Text contains “systems”';
	if (family === 'query-strict') return 'Everything AND Text exactly contains “systems thinking”';
	if (family === 'author') return 'Everything AND Authored by me';
	if (family === 'exclude') return 'Everything AND NOT Working Notes';
	if (family === 'combine') return 'Everything AND (Tagged AI OR Tagged Systems)';
	if (family === 'expand') return 'Start with Tagged AI, then include linked cards';
	const argumentsInfo = CONFIGURABLE_FILTER_ARGUMENTS[family] || [];
	const configured = argumentsInfo.length ? `${family}/${argumentsInfo.map(argument => argument.default).join('/')}` : filter;
	return `Everything AND ${readableCollectionFilter(configured)}`;
};

const relevance = (item : CollectionFilterCatalogItem, query : string) : number => {
	if (!query) return 0;
	const values = item.searchValues.map(value => value.toLowerCase());
	if (values.some(value => value === query)) return 0;
	if (values.some(value => value.startsWith(query))) return 1;
	const words = query.split(/\s+/).filter(Boolean);
	if (words.every(word => values.some(value => value.includes(word)))) return 2;
	return Number.POSITIVE_INFINITY;
};

export const buildCollectionFilterCatalog = (
	filterDescriptions : Readonly<Record<string, string>>,
	candidates : readonly CollectionComposerCandidate[],
	appliedFilters : readonly string[],
	query = ''
) : CollectionFilterCatalogItem[] => {
	const candidateByFilter = new Map(candidates.map(candidate => [candidate.filter, candidate]));
	const filters = Array.from(new Set([...Object.keys(filterDescriptions), ...candidates.map(candidate => candidate.filter)]));
	const normalizedQuery = query.trim().toLowerCase();
	return filters.map(filter => {
		const candidate = candidateByFilter.get(filter);
		const family = filter.split('/')[0];
		const appliedIndex = appliedFilters.findIndex(applied => applied === filter ||
			(filter === family && Boolean(CONFIGURABLE_FILTER_NAMES[family]) && applied.startsWith(`${family}/`)));
		const label = candidate?.label || humanize(filter);
		const detail = candidate?.detail || filterDescriptions[filter] || filterDescriptions[family] || `Keeps cards matching ${label}`;
		const example = exampleFor(filter, candidate);
		return {
			filter,
			label,
			detail,
			example,
			category: categoryFor(filter, candidate),
			configurable: Boolean(CONFIGURABLE_FILTER_NAMES[family]),
			guided: !SOURCE_ONLY_FILTERS.has(family),
			appliedIndex,
			searchValues: [filter, family, label, detail, example, candidate?.category || '', ...(candidate?.aliases || [])],
		};
	}).map(item => ({item, relevance: relevance(item, normalizedQuery)}))
		.filter(({relevance}) => Number.isFinite(relevance))
		.sort((a, b) => a.relevance - b.relevance ||
			CATEGORY_ORDER.indexOf(a.item.category) - CATEGORY_ORDER.indexOf(b.item.category) ||
			Number(b.item.appliedIndex >= 0) - Number(a.item.appliedIndex >= 0) ||
			Number(Boolean(candidateByFilter.get(b.item.filter)?.spotlight)) - Number(Boolean(candidateByFilter.get(a.item.filter)?.spotlight)) ||
			commonFilterRank(a.item.filter) - commonFilterRank(b.item.filter) ||
			a.item.label.localeCompare(b.item.label))
		.map(({item}) => item);
};

export const collectionFilterCatalogCategories = CATEGORY_ORDER;
