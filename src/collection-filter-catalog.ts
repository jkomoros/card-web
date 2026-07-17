import {
	CONFIGURABLE_FILTER_ARGUMENTS,
	CONFIGURABLE_FILTER_NAMES,
} from './filters.js';

import type { CollectionComposerCandidate } from './collection-composer-suggestions.js';

export type CollectionFilterCatalogCategory =
	| 'Suggested for this card'
	| 'Dates'
	| 'Tags and sections'
	| 'People'
	| 'Relationships'
	| 'Text and specific cards'
	| 'Card properties'
	| 'Advanced';

export type CollectionFilterCatalogItem = {
	filter: string;
	label: string;
	detail: string;
	category: CollectionFilterCatalogCategory;
	configurable: boolean;
	appliedIndex: number;
	searchValues: string[];
};

const CATEGORY_ORDER : CollectionFilterCatalogCategory[] = [
	'Suggested for this card',
	'Dates',
	'Tags and sections',
	'People',
	'Relationships',
	'Text and specific cards',
	'Card properties',
	'Advanced',
];

// Keep the small, unfiltered catalog useful without requiring someone to know
// what to search for. Applied filters come first (so they are always editable),
// followed by a few durable, high-frequency entry points.
const COMMON_FILTER_ORDER = ['starred', 'unread', 'has-content', 'working-notes', 'todo'];

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
	if (candidate?.category === 'date') return 'Dates';
	if (candidate?.category === 'tag' || candidate?.category === 'section') return 'Tags and sections';
	if (candidate?.category === 'author') return 'People';
	if (candidate?.category === 'relationship') return 'Relationships';
	if (candidate?.category === 'card type' || candidate?.category === 'todo') return 'Card properties';
	const family = filter.split('/')[0];
	const argumentTypes = (CONFIGURABLE_FILTER_ARGUMENTS[family] || []).map(argument => argument.type);
	if (argumentTypes.includes('date') || ['created', 'updated', 'last-tweeted'].includes(family)) return 'Dates';
	if (argumentTypes.includes('user-id')) return 'People';
	if (argumentTypes.some(type => ['key-card', 'reference-type', 'sub-filter', 'expand-filter'].includes(type))) return 'Relationships';
	if (argumentTypes.some(type => ['text', 'multiple-cards', 'concept-str-or-id'].includes(type))) return 'Text and specific cards';
	if (CONFIGURABLE_FILTER_NAMES[family] || ['limit', 'offset'].includes(family)) return 'Advanced';
	return 'Card properties';
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
		return {
			filter,
			label,
			detail,
			category: categoryFor(filter, candidate),
			configurable: Boolean(CONFIGURABLE_FILTER_NAMES[family]),
			appliedIndex,
			searchValues: [filter, family, label, detail, candidate?.category || '', ...(candidate?.aliases || [])],
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
