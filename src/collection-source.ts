import { CollectionDescription } from './collection_description.js';
import {
	CONFIGURABLE_FILTER_NAMES,
	CONFIGURABLE_FILTER_ARGUMENTS,
	CONFIGURABLE_FILTER_URL_PARTS,
	SORTS,
	isRelativeDate,
} from './filters.js';
import {
	LEGAL_VIEW_MODES,
	SET_NAMES,
} from '../shared/collection_description_base.js';

export type CollectionSourceKind = 'fragment' | 'route' | 'url';
export type CollectionSourceStatus = 'valid' | 'incomplete' | 'unsupported' | 'invalid';

export type CollectionSourceDiagnostic = {
	code: string;
	status: Exclude<CollectionSourceStatus, 'valid'>;
	message: string;
	segment?: number;
	expected?: string[];
	expectedDetails?: Record<string, string>;
};

export type CollectionSourceSegment = {
	raw: string;
	value: string;
	index: number;
	start: number;
	end: number;
};

export type CollectionSourceContext = {
	ordinaryFilters: ReadonlySet<string>;
	filterDescriptions?: Readonly<Record<string, string>>;
	suggestedFilters?: readonly string[];
	filterSearchValues?: Readonly<Record<string, readonly string[]>>;
	preservedSelectedCard?: string;
	allowedOrigins?: ReadonlySet<string>;
};

export type ParsedCollectionSource = {
	raw: string;
	kind: CollectionSourceKind;
	collectionText: string;
	segments: CollectionSourceSegment[];
	selectedCardRaw: string;
	selectedCardSource: 'explicit' | 'preserved' | 'default';
	query: string;
	hash: string;
	notices: string[];
	status: CollectionSourceStatus;
	diagnostics: CollectionSourceDiagnostic[];
	description?: CollectionDescription;
	canonicalPath?: string;
	nextExpected?: string[];
	nextExpectedDetails?: Record<string, string>;
};

const STATUS_PRIORITY : Record<CollectionSourceStatus, number> = {
	valid: 0,
	unsupported: 1,
	incomplete: 2,
	invalid: 3,
};

const strictDate = (value : string) : boolean => {
	if (isRelativeDate(value)) return true;
	const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
	if (!match) return false;
	const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
	return date.getFullYear() === Number(match[1]) &&
		date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
};

const tokenize = (text : string) : {segments: CollectionSourceSegment[]; badEncoding: number[]} => {
	const segments : CollectionSourceSegment[] = [];
	const badEncoding : number[] = [];
	let start = 0;
	for (let index = 0; index <= text.length; index++) {
		if (index !== text.length && text[index] !== '/') continue;
		const raw = text.slice(start, index);
		let value = raw;
		try {
			value = decodeURIComponent(raw);
		} catch {
			badEncoding.push(segments.length);
		}
		segments.push({raw, value, index: segments.length, start, end: index});
		start = index + 1;
	}
	return {segments, badEncoding};
};

export const parseCollectionSource = (
	raw : string,
	context : CollectionSourceContext
) : ParsedCollectionSource => {
	let kind : CollectionSourceKind = 'fragment';
	let collectionText = raw;
	let query = '';
	let hash = '';
	const notices : string[] = [];
	const diagnostics : CollectionSourceDiagnostic[] = [];
	let routeHasTrailingSlash = false;

	const diagnose = (status : Exclude<CollectionSourceStatus, 'valid'>, code : string, message : string, segment? : number, expected? : string[], expectedDetails? : Record<string, string>) =>
		diagnostics.push({status, code, message, segment, expected, expectedDetails});
	const allRootTokens = Array.from(new Set([
		...SET_NAMES,
		...context.ordinaryFilters,
		...Object.keys(CONFIGURABLE_FILTER_NAMES),
		...(context.suggestedFilters || []),
		'sort',
		'view',
	]));
	const preferredFilters = Array.from(new Set([
		...['starred', 'unread', 'query', 'updated', 'created'].filter(token => context.ordinaryFilters.has(token) || CONFIGURABLE_FILTER_NAMES[token]),
		...(context.suggestedFilters || []).slice(0, 5),
	]));
	const rootTokens = [...SET_NAMES, ...preferredFilters, 'sort', 'view'];
	const rootDetails = Object.fromEntries(allRootTokens.map(token => [token,
		token === 'sort' ? 'Choose how cards are ordered' :
			token === 'view' ? 'Choose how cards are displayed' :
				SET_NAMES.includes(token as never) ? `Start from the ${token} collection set` :
				context.filterDescriptions?.[token] || `Filter cards with ${token}`
	]));
	const validateFilterExpression = (rawParts : string[], start : number, diagnosticSegment : number) : number => {
		const name = rawParts[start];
		if (!name) return start + 1;
		if (!CONFIGURABLE_FILTER_NAMES[name]) {
			for (const member of name.split('+')) {
				if (!member || !context.ordinaryFilters.has(member)) {
					const search = member.toLowerCase();
					const expected = allRootTokens.filter(token => token !== 'sort' && token !== 'view' && !SET_NAMES.includes(token as never) &&
						(token.toLowerCase().startsWith(search) ||
							(context.filterSearchValues?.[token] || []).some(value => value.toLowerCase().includes(search)))).slice(0, 12);
					diagnose('unsupported', 'unknown-nested-filter', `This app does not know the nested “${member || name}” filter.`, diagnosticSegment, expected.length ? expected : undefined, rootDetails);
				}
			}
			return start + 1;
		}

		let cursor = start + 1;
		for (const argument of CONFIGURABLE_FILTER_ARGUMENTS[name] || []) {
			if (argument.type === 'sub-filter' || argument.type === 'expand-filter') {
				cursor = validateFilterExpression(rawParts, cursor, diagnosticSegment);
				continue;
			}
			if (argument.type === 'date') {
				const comparison = rawParts[cursor];
				if (!['before', 'after', 'between'].includes(comparison)) {
					diagnose('invalid', 'invalid-argument', `“${comparison || ''}” is not a date comparison.`, diagnosticSegment);
					cursor++;
					continue;
				}
				const dateCount = comparison === 'between' ? 2 : 1;
				for (const dateRaw of rawParts.slice(cursor + 1, cursor + 1 + dateCount)) {
					let date = dateRaw;
					try { date = decodeURIComponent(dateRaw); } catch { /* diagnosed by tokenizer */ }
					if (!strictDate(date)) diagnose('invalid', 'invalid-argument', `“${date}” is not a valid fixed or relative date.`, diagnosticSegment);
				}
				cursor += 1 + dateCount;
				continue;
			}
			const rawValue = rawParts[cursor] || '';
			let value = rawValue;
			try { value = decodeURIComponent(rawValue); } catch { /* diagnosed by tokenizer */ }
			if (argument.type === 'int' && !/^\d+$/.test(value)) {
				diagnose('invalid', 'invalid-argument', `${argument.description} needs a non-negative integer.`, diagnosticSegment);
			}
			if (argument.type === 'float' && (value.trim() === '' || !Number.isFinite(Number(value)))) {
				diagnose('invalid', 'invalid-argument', `${argument.description} needs a number.`, diagnosticSegment);
			}
			cursor++;
		}
		return cursor;
	};

	if (!raw) diagnose('incomplete', 'empty', 'Choose a starting set, filter, sort, or view.', undefined, rootTokens, rootDetails);
	if (raw.length > 8192) diagnose('invalid', 'too-long', 'Collection source must be shorter than 8 KB.');
	if (raw !== raw.trim()) diagnose('invalid', 'whitespace', 'Remove whitespace outside the collection source.');

	if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
		kind = 'url';
		try {
			const url = new URL(raw);
			query = url.search;
			hash = url.hash;
			if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
				diagnose('invalid', 'bad-url', 'Use an HTTP or HTTPS Card Web URL without credentials.');
			}
			if (context.allowedOrigins && !context.allowedOrigins.has(url.origin)) diagnose('invalid', 'foreign-origin', 'Use a Card Web URL from this app or the production site.');
			if (url.pathname !== '/c' && !url.pathname.startsWith('/c/')) {
				diagnose('invalid', 'wrong-route', 'The URL must point to a /c/ collection route.');
			}
			collectionText = url.pathname === '/c' ? '' : url.pathname.slice(3);
			routeHasTrailingSlash = url.pathname.endsWith('/');
		} catch {
			diagnose('invalid', 'bad-url', 'This is not a valid URL.');
			collectionText = '';
		}
	} else if (raw.startsWith('/c/') || raw.startsWith('c/')) {
		kind = 'route';
		const routeURL = new URL(raw.startsWith('/') ? raw : `/${raw}`, 'https://source.invalid');
		query = routeURL.search;
		hash = routeURL.hash;
		collectionText = routeURL.pathname.startsWith('/c/') ? routeURL.pathname.slice(3) : routeURL.pathname.slice(2);
		routeHasTrailingSlash = routeURL.pathname.endsWith('/');
	} else if (raw === '/c' || raw === 'c') {
		kind = 'route';
		collectionText = '';
	} else if (raw.startsWith('/')) {
		diagnose('invalid', 'wrong-route', 'App-relative routes must start with /c/.');
	}
	if (query || hash) notices.push('URL query and fragment decorations are shown but are not part of the collection source.');

	if (kind === 'fragment' && collectionText.startsWith('/')) collectionText = collectionText.slice(1);
	const tokenized = tokenize(collectionText);
	let segments = tokenized.segments;
	for (const segment of tokenized.badEncoding) diagnose('invalid', 'bad-encoding', 'This segment has invalid percent encoding.', segment);

	let selectedCardRaw = context.preservedSelectedCard || '';
	let selectedCardSource : ParsedCollectionSource['selectedCardSource'] = context.preservedSelectedCard ? 'preserved' : 'default';
	if (kind !== 'fragment') {
		selectedCardSource = routeHasTrailingSlash ? 'default' : 'explicit';
		if (routeHasTrailingSlash) {
			if (segments.at(-1)?.raw === '') segments = segments.slice(0, -1);
			selectedCardRaw = '';
		} else {
			selectedCardRaw = segments.pop()?.raw || '';
		}
	} else if (segments.at(-1)?.raw === '') {
		segments = segments.slice(0, -1);
	}

	if (segments.some(segment => segment.raw === '')) diagnose('invalid', 'empty-segment', 'Empty path segments are not allowed.', segments.find(segment => segment.raw === '')?.index);

	const filters : string[] = [];
	let set : string | undefined;
	let sort = 'default';
	let sortReversed = false;
	let view = 'list';
	let viewExtra = '';
	let sawSort = false;
	let sawView = false;
	let index = 0;
	if (segments[index] && SET_NAMES.includes(segments[index].raw as never)) {
		set = segments[index].raw;
		index++;
	}
	while (index < segments.length) {
		const segment = segments[index];
		if (!segment.raw) { index++; continue; }
		if (segment.raw === 'sort') {
			if (sawSort) diagnose('invalid', 'duplicate-sort', 'Only one sort can be used.', segment.index);
			sawSort = true;
			index++;
			if (segments[index]?.raw === 'reverse') { sortReversed = true; index++; }
			if (!segments[index]) {
				diagnose('incomplete', 'expected-token', 'Sort needs a sort name.', segment.index, Object.keys(SORTS));
				continue;
			}
			sort = segments[index].raw;
			if (!(segments[index].raw in SORTS)) diagnose('unsupported', 'unknown-sort', `This app does not know the “${segments[index].value}” sort.`, segments[index].index);
			index++;
			continue;
		}
		if (segment.raw === 'view') {
			if (sawView) diagnose('invalid', 'duplicate-view', 'Only one view can be used.', segment.index);
			sawView = true;
			index++;
			if (!segments[index]) {
				diagnose('incomplete', 'expected-token', 'View needs a view mode.', segment.index, Object.keys(LEGAL_VIEW_MODES));
				continue;
			}
			const mode = segments[index];
			view = mode.raw;
			if (!(mode.raw in LEGAL_VIEW_MODES)) diagnose('invalid', 'invalid-view', `“${mode.value}” is not a valid view.`, mode.index);
			index++;
			if (LEGAL_VIEW_MODES[mode.raw as keyof typeof LEGAL_VIEW_MODES]) {
				if (!segments[index]) diagnose('incomplete', 'expected-token', `${mode.value} view needs a value.`, mode.index);
				else { viewExtra = segments[index].raw; index++; }
			}
			continue;
		}
		if (CONFIGURABLE_FILTER_NAMES[segment.raw]) {
			const parts = [segment.raw];
			let remaining = CONFIGURABLE_FILTER_URL_PARTS[segment.raw] || 0;
			index++;
			while (remaining > 0 && index < segments.length) {
				const part = segments[index];
				if (part.raw === 'sort' || part.raw === 'view') {
					diagnose('invalid', 'reserved-argument', `“${part.value}” cannot interrupt a filter.`, part.index);
					break;
				}
				parts.push(part.raw);
				remaining--;
				remaining += CONFIGURABLE_FILTER_URL_PARTS[part.raw] || 0;
				index++;
			}
			if (remaining > 0) {
				const decodedParts = parts.map(part => {
					try { return decodeURIComponent(part); } catch { return part; }
				});
				const dateComparison = ['created', 'updated', 'last-tweeted'].includes(decodedParts[0]) ? decodedParts[1] : '';
				const message = ['before', 'after'].includes(dateComparison) ? `${dateComparison} needs a date.` :
					dateComparison === 'between' ? `between needs ${remaining} more ${remaining === 1 ? 'date' : 'dates'}.` :
					`${segment.value} needs ${remaining} more ${remaining === 1 ? 'value' : 'values'}.`;
				let expected : string[] | undefined;
				let expectedDetails : Record<string, string> | undefined;
				if (['created', 'updated', 'last-tweeted'].includes(decodedParts[0]) && !dateComparison) {
					expected = ['before', 'after', 'between'];
					expectedDetails = {before: 'Cards dated before a date', after: 'Cards dated after a date', between: 'Cards between two dates'};
				} else if (['before', 'after'].includes(dateComparison) || dateComparison === 'between') {
					expected = ['today', 'yesterday', '3-days-ago'];
					expectedDetails = {today: 'A rolling boundary at today', yesterday: 'A rolling boundary at yesterday', '3-days-ago': 'A rolling boundary three days ago'};
				} else {
					const nextArgument = CONFIGURABLE_FILTER_ARGUMENTS[segment.raw]?.[parts.length - 1];
					if (nextArgument?.type === 'sub-filter' || nextArgument?.type === 'expand-filter') {
						expected = rootTokens.filter(token => token !== 'sort' && token !== 'view' && !SET_NAMES.includes(token as never));
						expectedDetails = rootDetails;
					} else if (nextArgument) {
						expected = [encodeURIComponent(nextArgument.default)];
						expectedDetails = {[expected[0]]: nextArgument.description};
					}
				}
				diagnose('incomplete', 'expected-token', message, segment.index, expected, expectedDetails);
			} else {
				const values = parts.map(part => {
					try { return decodeURIComponent(part); } catch { return part; }
				});
				if (['created', 'updated', 'last-tweeted'].includes(values[0])) {
					if (!['before', 'after', 'between'].includes(values[1])) diagnose('invalid', 'invalid-argument', `“${values[1]}” is not a date comparison.`, segment.index);
					for (const date of values.slice(2)) if (!strictDate(date)) diagnose('invalid', 'invalid-argument', `“${date}” is not a valid fixed or relative date.`, segment.index);
				}
				if (['limit', 'offset'].includes(values[0]) && !/^\d+$/.test(values[1])) diagnose('invalid', 'invalid-argument', `${values[0]} needs a non-negative integer.`, segment.index);
				const consumed = validateFilterExpression(parts, 0, segment.index);
				if (consumed !== parts.length) diagnose('invalid', 'unexpected-argument', `“${segment.value}” has unexpected extra values.`, segment.index);
				filters.push(parts.join('/'));
			}
			continue;
		}
		if (CONFIGURABLE_FILTER_URL_PARTS[segment.raw]) {
			diagnose('invalid', 'orphan-argument', `“${segment.value}” cannot start a filter.`, segment.index);
			index++;
			continue;
		}
		const union = segment.raw.split('+');
		if (union.some(part => !part)) diagnose('invalid', 'invalid-union', 'A union cannot contain an empty filter.', segment.index);
		for (const part of union) if (!context.ordinaryFilters.has(part)) {
			const search = part.toLowerCase();
			const expected = allRootTokens.filter(token => token.toLowerCase().startsWith(search) ||
				(context.filterSearchValues?.[token] || []).some(value => value.toLowerCase().includes(search))).slice(0, 12);
			diagnose('unsupported', 'unknown-filter', `This app does not know the “${part}” filter.`, segment.index, expected.length ? expected : undefined, rootDetails);
		}
		filters.push(segment.raw);
		index++;
	}

	let status : CollectionSourceStatus = 'valid';
	for (const diagnostic of diagnostics) if (STATUS_PRIORITY[diagnostic.status] > STATUS_PRIORITY[status]) status = diagnostic.status;
	let description : CollectionDescription | undefined;
	let canonicalPath : string | undefined;
	let nextExpected : string[] | undefined;
	let nextExpectedDetails : Record<string, string> | undefined;
	if (status === 'valid') {
		try {
			const legacySource = [...(set ? [set] : []), ...filters];
			if (sawSort) legacySource.push('sort', ...(sortReversed ? ['reverse'] : []), sort);
			if (sawView) legacySource.push('view', view, ...(viewExtra ? [viewExtra] : []));
			description = CollectionDescription.deserialize(legacySource.join('/') + '/');
			if (description.set !== (set || 'main') || description.filters.join('\n') !== filters.join('\n') ||
				description.sort !== sort || description.sortReversed !== sortReversed || description.viewMode !== view || description.viewModeExtra !== viewExtra) {
				diagnose('invalid', 'legacy-mismatch', 'This source cannot be lowered without changing its meaning.');
				status = 'invalid';
				description = undefined;
			} else {
				canonicalPath = `/c/${description.serializeShort()}${selectedCardRaw}`;
				if (raw.endsWith('/') && (kind === 'fragment' || routeHasTrailingSlash)) {
					nextExpected = rootTokens.filter(token => !SET_NAMES.includes(token as never) &&
						!(token === 'sort' && sawSort) && !(token === 'view' && sawView) && !filters.includes(token)).slice(0, 12);
					nextExpectedDetails = rootDetails;
				}
			}
		} catch {
			diagnose('invalid', 'legacy-mismatch', 'This source cannot be opened safely.');
			status = 'invalid';
		}
	}

	return {raw, kind, collectionText, segments, selectedCardRaw, selectedCardSource, query, hash, notices, status, diagnostics, description, canonicalPath, nextExpected, nextExpectedDetails};
};
