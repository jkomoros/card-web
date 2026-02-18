import {
	UNION_FILTER_DELIMITER,
	PUBLISHED_FILTER_NAME,
	UNPUBLISHED_FILTER_NAME,
	EXCLUDE_FILTER_NAME,
	COMBINE_FILTER_NAME,
	LIMIT_FILTER_NAME,
	OFFSET_FILTER_NAME,
	QUERY_FILTER_NAME,
	SELECTED_FILTER_NAME
} from './filter-constants.js';

import {
	SetName,
	FilterName
} from '../shared/types.js';

import {
	normalizedWords,
	stemmedNormalizedWords,
	ngrams,
	STOP_WORDS
} from '../shared/nlp.js';

import type {
	ServerIDFData
} from './types.js';

// Interface for collection description (avoids circular dependency with collection_description.ts)
export interface CollectionDescriptionLike {
	filters: FilterName[];
	set: SetName;
}

import {
	where,
	documentId,
	QueryConstraint,
	Timestamp
} from 'firebase/firestore';

// Feature flag for SIMPLE collections with server-side counting
export const ENABLE_SIMPLE_COLLECTIONS = true;

export enum FilterComplexity {
	SIMPLE = 'SIMPLE',    // Server-queryable
	COMPLEX = 'COMPLEX',  // Client-only
	HYBRID = 'HYBRID'     // Context-dependent
}

export interface FilterClassification {
	complexity: FilterComplexity;
	canGetServerCount: boolean;
	firestoreConstraints?: QueryConstraint[];
	reason: string;
	isExact?: boolean;
}

// Define filter classification sets
// SIMPLE filters can be translated to Firestore queries
const SIMPLE_FILTERS = new Set([
	PUBLISHED_FILTER_NAME,  // 'published'
	UNPUBLISHED_FILTER_NAME, // 'unpublished'
	'section',
	'tag',
	'author',
	'cards',
	'updated',
	'created',
	'last-tweeted',
	'has-comments',
	'has-tweet',
	'orphaned',
	'has-body',
	QUERY_FILTER_NAME, // 'query' - uses array-contains on nlp_search_tokens
	'query-strict',     // uses array-contains on nlp_search_tokens
	// All type-X filters are SIMPLE
]);

// COMPLEX filters require client-side processing
const COMPLEX_FILTERS = new Set([
	'children',
	'parents',
	'descendants',
	'ancestors',
	'references',
	'references-inbound',
	'references-outbound',
	'direct-references',
	'direct-references-inbound',
	'direct-references-outbound',
	'direct-connections',
	'connections',
	'about-concept',
	'missing-concept',
	'has-content',
	'has-links',
	'has-inbound-links',
	'has-reciprocal-links',
	'has-substantive-content',
	'starred',
	'read',
	SELECTED_FILTER_NAME, // 'selected'
	'reading-list',
	'has-slug',
	'has-tags',
	'has-images',
	'has-notes',
	'expand',
	// NOTE: 'query' and 'query-strict' moved to SIMPLE (uses array-contains on nlp_search_tokens)
	'similar',
	'similar-cutoff',
	'same-type',
	'different-type',
	// All negatives of COMPLEX filters
	'unstarred',
	'unread',
	'not-selected',
	'missing-links',
	'missing-inbound-links',
	'missing-reciprocal-links',
	'missing-substantive-content',
	'missing-slug',
	'missing-tags',
	'missing-images',
	'missing-notes',
	// All has-X-references and inbound-X-references filters
	'link-references',
	'generic-references',
	'concept-references',
	'citation-references',
	'fork-references',
	'mined-references',
	'dupe-of-references',
	'key-card-references',
	'ack-references',
	'commentary-references',
	'inbound-link-references',
	'inbound-generic-references',
	'inbound-concept-references',
	'inbound-citation-references',
	'inbound-fork-references',
	'inbound-mined-references',
	'inbound-dupe-of-references',
	'inbound-key-card-references',
	'inbound-ack-references',
	'inbound-commentary-references',
	// All needs-X and missing-X filters (TODOs)
	'needs-slug',
	'needs-content',
	'needs-substantive-content',
	'needs-links',
	'needs-inbound-links',
	'needs-reciprocal-links',
	'needs-tags',
	'needs-to-be-published',
	'needs-prose',
	'needs-citations',
	'needs-diagram',
	'needs-todo',
	'missing-content',
	'has-all-reciprocal-links',
	'does-not-need-reciprocal-links',
	'does-not-need-to-be-published',
	'does-not-need-links',
	'does-not-need-inbound-links',
	'does-not-need-slug',
	'does-not-need-content',
	'does-not-need-substantive-content',
	'does-not-need-tags',
	'does-not-need-prose',
	'does-not-need-citations',
	'does-not-need-diagram',
	'no-todo',
	'has-todo',
	// Freeform todos
	'not-automatically-prioritized',
	'automatically-prioritized',
	'not-prioritized',
	'prioritized',
	'not-mined',
	'mined'
]);

// Meta filters that affect pagination/sorting but don't filter results
const META_FILTERS = new Set([
	LIMIT_FILTER_NAME,   // 'limit'
	OFFSET_FILTER_NAME   // 'offset'
]);

export function classifyCollectionDescription(
	description: CollectionDescriptionLike,
	serverIDF?: ServerIDFData | null
): FilterClassification {
	// Empty filters = SIMPLE (just the set)
	if (!description.filters || description.filters.length === 0) {
		try {
			const constraints = buildSetConstraints(description.set);
			return {
				complexity: FilterComplexity.SIMPLE,
				canGetServerCount: true,
				firestoreConstraints: constraints,
				reason: 'No filters',
				isExact: true
			};
		} catch (e) {
			// reading-list set or other complex set
			return {
				complexity: FilterComplexity.COMPLEX,
				canGetServerCount: false,
				reason: 'Complex set: ' + description.set,
				isExact: false
			};
		}
	}

	// Check each filter
	for (const filter of description.filters) {
		// Skip meta filters (they don't affect classification)
		const [filterType] = filter.split('/');
		if (META_FILTERS.has(filterType)) {
			continue;
		}

		// Union filters
		if (filter.includes(UNION_FILTER_DELIMITER)) {
			const result = classifyUnionFilter(filter);
			if (result.complexity === FilterComplexity.COMPLEX) {
				return result;
			}
			continue;
		}

		// Check COMPLEX first (early exit)
		if (COMPLEX_FILTERS.has(filterType)) {
			return {
				complexity: FilterComplexity.COMPLEX,
				canGetServerCount: false,
				reason: `Complex filter: ${filterType}`,
				isExact: false
			};
		}

		// Check hybrid filters
		if ([COMBINE_FILTER_NAME, EXCLUDE_FILTER_NAME].includes(filterType)) {
			const result = classifyHybridFilter(filter);
			if (result.complexity === FilterComplexity.COMPLEX) {
				return result;
			}
			continue;
		}

		// Check if it's a type-X filter (all are SIMPLE)
		if (filterType.startsWith('type-')) {
			continue;
		}

		// Unknown filter = COMPLEX for safety
		if (!SIMPLE_FILTERS.has(filterType)) {
			return {
				complexity: FilterComplexity.COMPLEX,
				canGetServerCount: false,
				reason: `Unknown filter: ${filterType}`,
				isExact: false
			};
		}
	}

	// All filters SIMPLE - try to build constraints
	try {
		const constraints = buildFirestoreConstraints(description, serverIDF);
		return {
			complexity: FilterComplexity.SIMPLE,
			canGetServerCount: true,
			firestoreConstraints: constraints,
			reason: 'All filters server-queryable',
			isExact: true
		};
	} catch (e) {
		// Failed to build constraints - fall back to COMPLEX
		return {
			complexity: FilterComplexity.COMPLEX,
			canGetServerCount: false,
			reason: 'Failed to build Firestore constraints: ' + (e as Error).message,
			isExact: false
		};
	}
}

function classifyUnionFilter(filter: FilterName): FilterClassification {
	// Union filters like "section/A+section/B" or "published+starred"
	const [firstPart] = filter.split('/');
	const unionParts = firstPart.split(UNION_FILTER_DELIMITER);

	for (const part of unionParts) {
		// Check if any part is COMPLEX
		if (COMPLEX_FILTERS.has(part)) {
			return {
				complexity: FilterComplexity.COMPLEX,
				canGetServerCount: false,
				reason: `Union contains complex filter: ${part}`,
				isExact: false
			};
		}

		// Check if unknown
		if (!SIMPLE_FILTERS.has(part) && !part.startsWith('type-')) {
			return {
				complexity: FilterComplexity.COMPLEX,
				canGetServerCount: false,
				reason: `Union contains unknown filter: ${part}`,
				isExact: false
			};
		}
	}

	// All parts are SIMPLE
	return {
		complexity: FilterComplexity.SIMPLE,
		canGetServerCount: true,
		reason: 'Union of simple filters',
		isExact: true
	};
}

function classifyHybridFilter(_filter: FilterName): FilterClassification {
	// combine/ and exclude/ filters depend on their arguments
	// For now, treat them as COMPLEX since we'd need to recursively parse
	// the sub-filters to determine complexity
	return {
		complexity: FilterComplexity.COMPLEX,
		canGetServerCount: false,
		reason: 'Hybrid filter (combine/exclude) - requires client-side processing',
		isExact: false
	};
}

export function buildFirestoreConstraints(
	description: CollectionDescriptionLike,
	serverIDF?: ServerIDFData | null
): QueryConstraint[] {
	const constraints: QueryConstraint[] = [];

	// Add set constraints
	constraints.push(...buildSetConstraints(description.set));

	// Add filter constraints
	for (const filter of description.filters) {
		// Skip meta filters
		const [filterType] = filter.split('/');
		if (META_FILTERS.has(filterType)) {
			continue;
		}

		// Handle unions
		if (filter.includes(UNION_FILTER_DELIMITER)) {
			// Union constraints require OR queries which are complex
			// For now, throw error - unions need special handling
			throw new Error('Union filters require client-side processing');
		}

		const [, ...args] = filter.split('/');

		switch (filterType) {
			case PUBLISHED_FILTER_NAME:
				constraints.push(where('published', '==', true));
				break;
			case UNPUBLISHED_FILTER_NAME:
				constraints.push(where('published', '==', false));
				break;
			case 'section':
				if (args.length > 0) {
					constraints.push(where('section', '==', args[0]));
				}
				break;
			case 'tag':
				if (args.length > 0) {
					constraints.push(where('tags', 'array-contains', args[0]));
				}
				break;
			case 'author':
				if (args.length > 0) {
					constraints.push(where('author', '==', args[0]));
				}
				break;
			case 'cards':
				if (args.length > 0) {
					const cardIDs = args[0].split(',').slice(0, 30); // Firestore limit
					constraints.push(where(documentId(), 'in', cardIDs));
				}
				break;
			case 'updated':
			case 'created':
			case 'last-tweeted':
				constraints.push(...buildDateConstraints(filterType, args));
				break;
			case 'has-comments':
				constraints.push(where('thread_count', '>', 0));
				break;
			case 'has-tweet':
				constraints.push(where('tweet_count', '>', 0));
				break;
			case 'orphaned':
				constraints.push(where('section', '==', ''));
				break;
			case 'has-body':
				// Cards with body field - needs to check card_type in BODY_CARD_TYPES
				// This is complex - throw for now
				throw new Error('has-body filter requires client-side processing');
			case QUERY_FILTER_NAME:
			case 'query-strict':
				if (args.length > 0) {
					const queryString = args.join('/'); // Rejoin in case query had slashes
					constraints.push(...buildQueryConstraints(queryString, serverIDF));
				}
				break;
			default:
				if (filterType.startsWith('type-')) {
					const cardType = filterType.substring(5);
					constraints.push(where('card_type', '==', cardType));
				} else {
					throw new Error(`Unknown filter: ${filterType}`);
				}
		}
	}

	return constraints;
}

function buildSetConstraints(set: SetName): QueryConstraint[] {
	switch (set) {
		case 'main':
			return [where('section', '!=', '')];
		case 'everything':
			return [];
		case 'reading-list':
			// Requires join with reading list - not supported
			throw new Error('reading-list not supported for SIMPLE classification');
		default:
			return [];
	}
}

/**
 * Build array-contains constraint for query filters using nlp_search_tokens.
 * Stems and normalizes query input, generates bigrams, then selects the
 * rarest token (by IDF) for the server-side narrowing query.
 */
export function buildQueryConstraints(queryString: string, serverIDF?: ServerIDFData | null): QueryConstraint[] {
	const stemmed = stemmedNormalizedWords(normalizedWords(queryString));
	const tokens = stemmed.split(' ').filter(t => t);

	if (tokens.length === 0) return [];

	// Generate bigrams from stemmed tokens
	const bigrams = tokens.length >= 2 ? ngrams(stemmed, 2) : [];
	const allCandidates = [...tokens, ...bigrams];

	// Select the best (rarest) token for server-side filtering
	const selectedToken = selectBestToken(allCandidates, tokens, serverIDF);

	return [
		where('nlp_search_tokens', 'array-contains', selectedToken)
	];
}

/**
 * Select the best token for array-contains query. Prefers the rarest token
 * by IDF (if available), otherwise falls back to the first non-stop-word.
 */
function selectBestToken(candidates: string[], unigrams: string[], serverIDF?: ServerIDFData | null): string {
	if (serverIDF && serverIDF.idf) {
		// Pick the candidate with the highest IDF (rarest)
		let bestToken = candidates[0];
		let bestIDF = -1;
		for (const candidate of candidates) {
			const idf = serverIDF.idf[candidate] ?? serverIDF.maxIDF;
			if (idf > bestIDF) {
				bestIDF = idf;
				bestToken = candidate;
			}
		}
		return bestToken;
	}

	// No IDF available — pick first non-stop-word unigram, or first token
	for (const token of unigrams) {
		if (!STOP_WORDS[token]) return token;
	}
	return candidates[0];
}

function buildDateConstraints(
	filterType: string,
	args: string[]
): QueryConstraint[] {
	// Date filters have format: updated/YYYY-MM-DD/YYYY-MM-DD
	// or: updated/last-N-days
	// or: updated/this-week, updated/this-month, etc.

	if (args.length === 0) {
		throw new Error(`Date filter ${filterType} missing arguments`);
	}

	const fieldName = filterType === 'last-tweeted' ? 'last_tweeted' : filterType;

	const arg0 = args[0];

	// Handle relative dates like "last-7-days"
	if (arg0.startsWith('last-') && arg0.endsWith('-days')) {
		const days = parseInt(arg0.slice(5, -5));
		if (!isNaN(days)) {
			const cutoffDate = new Date();
			cutoffDate.setDate(cutoffDate.getDate() - days);
			const cutoffTimestamp = Timestamp.fromDate(cutoffDate);
			return [where(fieldName, '>=', cutoffTimestamp)];
		}
	}

	// Handle "this-week", "this-month", etc.
	const now = new Date();
	if (arg0 === 'this-week') {
		const startOfWeek = new Date(now);
		startOfWeek.setDate(now.getDate() - now.getDay());
		startOfWeek.setHours(0, 0, 0, 0);
		return [where(fieldName, '>=', Timestamp.fromDate(startOfWeek))];
	}

	if (arg0 === 'this-month') {
		const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
		return [where(fieldName, '>=', Timestamp.fromDate(startOfMonth))];
	}

	if (arg0 === 'this-year') {
		const startOfYear = new Date(now.getFullYear(), 0, 1);
		return [where(fieldName, '>=', Timestamp.fromDate(startOfYear))];
	}

	// Handle date range: YYYY-MM-DD/YYYY-MM-DD
	if (args.length >= 2) {
		const startDate = parseDate(args[0]);
		const endDate = parseDate(args[1]);

		if (startDate && endDate) {
			return [
				where(fieldName, '>=', Timestamp.fromDate(startDate)),
				where(fieldName, '<=', Timestamp.fromDate(endDate))
			];
		}
	}

	// Single date
	const singleDate = parseDate(arg0);
	if (singleDate) {
		const endOfDay = new Date(singleDate);
		endOfDay.setHours(23, 59, 59, 999);
		return [
			where(fieldName, '>=', Timestamp.fromDate(singleDate)),
			where(fieldName, '<=', Timestamp.fromDate(endOfDay))
		];
	}

	throw new Error(`Invalid date filter format: ${filterType}/${args.join('/')}`);
}

function parseDate(dateStr: string): Date | null {
	// Parse YYYY-MM-DD format
	const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (match) {
		const year = parseInt(match[1]);
		const month = parseInt(match[2]) - 1; // JS months are 0-indexed
		const day = parseInt(match[3]);
		const date = new Date(year, month, day);
		if (!isNaN(date.getTime())) {
			return date;
		}
	}
	return null;
}
