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

//WHAT KIND OF THING THE NEXT TOKEN IS. The completion list is rendered by one
//row treatment for every grammar position, and without this it had to guess:
//every completion that was not obviously a date fell through to "filter", so
//the sort names offered after `sort/` were labeled 'filter' and described as
//'A legal collection filter'. The parser is the only thing that knows which
//production it is in, so it says so rather than leaving the UI to infer it.
//'root' is the position where a set, a filter, `sort` and `view` are all legal,
//and there the per-token classification the UI already does is the right answer.
export type CollectionSourceExpectedKind = 'root' | 'filter' | 'sort' | 'view' | 'value';

export type CollectionSourceDiagnostic = {
	code: string;
	status: Exclude<CollectionSourceStatus, 'valid'>;
	message: string;
	segment?: number;
	expected?: string[];
	expectedDetails?: Record<string, string>;
	expectedKind?: CollectionSourceExpectedKind;
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
	//The origin a full URL was written against, or '' for a route or a bare
	//fragment. The parser knows which origins are ALLOWED (context.allowedOrigins)
	//but not which of them is the one this client is running on, so it reports
	//what it read and lets the UI decide whether an origin was translated.
	origin: string;
	notices: string[];
	status: CollectionSourceStatus;
	diagnostics: CollectionSourceDiagnostic[];
	description?: CollectionDescription;
	canonicalPath?: string;
	nextExpected?: string[];
	nextExpectedDetails?: Record<string, string>;
	nextExpectedKind?: CollectionSourceExpectedKind;
};

//A URL token is an internal identifier and must not reach a user (§1.4). This
//is the word-level half of that mapping — 'reading-list' -> 'Reading List' —
//and it lives HERE, in the module that owns the URL vocabulary, because
//collection-composer-suggestions imports this file: its
//collectionFilterDisplayName and collectionOptionDisplayName are built on top
//of this, and a copy in each direction is exactly the divergence §5 warns
//about.
export const humanizeCollectionToken = (value : string) : string =>
	value
		.split(/[- ]/)
		.map(word => (word ? word[0].toUpperCase() + word.slice(1) : ''))
		.join(' ');

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

//THE `/c/` PREFIX IS A SEGMENT, NOT THREE CHARACTERS.
//
//`new URL()` normalizes `..` before this module ever sees a path, so
//`/c/../zzzfoo/` arrives as `/zzzfoo/` and `/c/../../etc/passwd` as
//`/etc/passwd`. The fixed-length slice(3)/slice(2) that used to strip the route
//then ate the first character of whatever was actually there, and every
//diagnostic downstream quoted a token the user never typed — “zzfoo” for
//zzzfoo, “tc” for etc. A quoted token that is not the user's own text is worse
//than no quote at all: it sends them hunting for a typo that is ours.
//
//Splitting on `/` and dropping the literal `c` segment cannot eat a character.
//When that segment is not there — which only happens when `..` has climbed out
//of the collection route — nothing is dropped, and the caller says so instead
//of silently parsing whatever the climb landed on.
const stripCollectionRouteSegment = (pathname : string) : {text : string, onRoute : boolean} => {
	//A pathname always begins with '/', so segments[0] is ''.
	const segments = pathname.split('/');
	if (segments[1] !== 'c') return {text: segments.slice(1).join('/'), onRoute: false};
	return {text: segments.slice(2).join('/'), onRoute: true};
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
	let origin = '';
	const notices : string[] = [];
	const diagnostics : CollectionSourceDiagnostic[] = [];
	let routeHasTrailingSlash = false;

	const diagnose = (status : Exclude<CollectionSourceStatus, 'valid'>, code : string, message : string, segment? : number, expected? : string[], expectedDetails? : Record<string, string>, expectedKind : CollectionSourceExpectedKind = 'root') =>
		diagnostics.push({status, code, message, segment, expected, expectedDetails, expectedKind});
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
	//A sort and a view have their own vocabularies, and their own descriptions
	//to go with them. Offering them with no detail is what made the completion
	//list fall back to 'A legal collection filter' for every sort name in the
	//app. SORTS already carries an authored description per sort; the view modes
	//carry only whether they take an extra value, which is exactly the thing a
	//user about to type one needs to know.
	const sortNames = Object.keys(SORTS);
	const sortDetails = Object.fromEntries(Object.entries(SORTS).map(([name, info]) => [name, info.description]));
	const viewNames = Object.keys(LEGAL_VIEW_MODES);
	const viewDetails = Object.fromEntries(viewNames.map(name => [name,
		LEGAL_VIEW_MODES[name as keyof typeof LEGAL_VIEW_MODES] ?
			'Shows the collection this way, anchored to one card' :
			'Shows the collection this way']));
	//Half a word is not a wrong word. A token that is a strict prefix of at
	//least one filter this app knows is a filter the user has not finished
	//typing, and saying "not supported here" on every keystroke of `sta` —
	//while the list underneath is already offering Starred — is a hard failure
	//claimed about a state that is going fine.
	const unfinishedToken = (token : string) : boolean => {
		if (!token) return false;
		const search = token.toLowerCase();
		return allRootTokens.some(known => known !== token && known.toLowerCase().startsWith(search));
	};
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
					if (unfinishedToken(member)) {
						diagnose('incomplete', 'unfinished-nested-filter', `“${member}” is the start of a filter name, so this nested filter is not finished yet. Choose one below or keep typing.`, diagnosticSegment, expected.length ? expected : undefined, rootDetails, 'filter');
					} else {
						diagnose('unsupported', 'unknown-nested-filter', `This app does not know the nested “${member || name}” filter.`, diagnosticSegment, expected.length ? expected : undefined, rootDetails, 'filter');
					}
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
				diagnose('invalid', 'bad-url', 'Use an HTTP or HTTPS URL from this app, without credentials.');
			}
			//Which origins count is deployment configuration, so the message
			//cannot promise "the production site" — most deployments of this
			//app have exactly one trusted origin, their own.
			if (context.allowedOrigins && !context.allowedOrigins.has(url.origin)) {
				diagnose('invalid', 'foreign-origin', context.allowedOrigins.size > 1 ?
					'Use a URL from this app or its public address.' :
					'Use a URL from this app.');
			}
			origin = url.origin;
			const route = stripCollectionRouteSegment(url.pathname);
			if (!route.onRoute) {
				diagnose('invalid', 'wrong-route', 'The URL must point to a /c/ collection route.');
			}
			collectionText = route.text;
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
		const route = stripCollectionRouteSegment(routeURL.pathname);
		//The only way a path that STARTED with /c/ arrives without it is `..`
		//climbing above the collection route. Naming that is honest; parsing
		//whatever the climb landed on as if it were a collection is not.
		if (!route.onRoute) diagnose('invalid', 'wrong-route', 'This path uses “..” to climb out of the /c/ collection route.');
		collectionText = route.text;
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
				diagnose('incomplete', 'expected-token', 'Sort needs a sort name.', segment.index, sortNames, sortDetails, 'sort');
				continue;
			}
			const sortSegment = segments[index];
			sort = sortSegment.raw;
			if (sortSegment.raw && !(sortSegment.raw in SORTS)) {
				//HALF A SORT NAME IS NOT A WRONG ONE, exactly as it is not for a
				//filter. `sort/sta` used to report "This app does not know the
				//“sta” sort" — a hard failure claimed about a state that is going
				//fine — while `sta` in a filter position had said "keep typing"
				//since the last wave. Same production, same answer, with the
				//completions that make the keep-typing state actionable.
				const search = sortSegment.raw.toLowerCase();
				const matches = sortNames.filter(name => name.toLowerCase().startsWith(search));
				if (matches.length) {
					diagnose('incomplete', 'unfinished-sort', `“${sortSegment.value}” is the start of a sort name, so this source is not finished yet. Choose one below or keep typing.`, sortSegment.index, matches, sortDetails, 'sort');
				} else {
					diagnose('unsupported', 'unknown-sort', `This app does not know the “${sortSegment.value}” sort.`, sortSegment.index, sortNames, sortDetails, 'sort');
				}
			}
			index++;
			continue;
		}
		if (segment.raw === 'view') {
			if (sawView) diagnose('invalid', 'duplicate-view', 'Only one view can be used.', segment.index);
			sawView = true;
			index++;
			if (!segments[index]) {
				diagnose('incomplete', 'expected-token', 'View needs a view mode.', segment.index, viewNames, viewDetails, 'view');
				continue;
			}
			const mode = segments[index];
			view = mode.raw;
			if (mode.raw && !(mode.raw in LEGAL_VIEW_MODES)) {
				//Same rule as sort and as filters: a strict prefix is unfinished,
				//not wrong.
				const search = mode.raw.toLowerCase();
				const matches = viewNames.filter(name => name.toLowerCase().startsWith(search));
				if (matches.length) {
					diagnose('incomplete', 'unfinished-view', `“${mode.value}” is the start of a view name, so this source is not finished yet. Choose one below or keep typing.`, mode.index, matches, viewDetails, 'view');
				} else {
					diagnose('invalid', 'invalid-view', `“${mode.value}” is not a valid view.`, mode.index, viewNames, viewDetails, 'view');
				}
			}
			index++;
			if (LEGAL_VIEW_MODES[mode.raw as keyof typeof LEGAL_VIEW_MODES]) {
				if (!segments[index]) diagnose('incomplete', 'expected-token', `The ${humanizeCollectionToken(mode.value)} view needs a value.`, mode.index);
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
				let expectedKind : CollectionSourceExpectedKind = 'value';
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
						expectedKind = 'filter';
					} else if (nextArgument) {
						expected = [encodeURIComponent(nextArgument.default)];
						expectedDetails = {[expected[0]]: nextArgument.description};
					}
				}
				diagnose('incomplete', 'expected-token', message, segment.index, expected, expectedDetails, expectedKind);
			} else {
				const values = parts.map(part => {
					try { return decodeURIComponent(part); } catch { return part; }
				});
				if (['created', 'updated', 'last-tweeted'].includes(values[0])) {
					if (!['before', 'after', 'between'].includes(values[1])) diagnose('invalid', 'invalid-argument', `“${values[1]}” is not a date comparison.`, segment.index);
					for (const date of values.slice(2)) if (!strictDate(date)) diagnose('invalid', 'invalid-argument', `“${date}” is not a valid fixed or relative date.`, segment.index);
				}
				if (['limit', 'offset'].includes(values[0]) && !/^\d+$/.test(values[1])) diagnose('invalid', 'invalid-argument', `The ${humanizeCollectionToken(values[0])} filter needs a non-negative integer.`, segment.index);
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
			if (unfinishedToken(part)) {
				diagnose('incomplete', 'unfinished-filter', `“${part}” is the start of a filter name, so this source is not finished yet. Choose one below or keep typing.`, segment.index, expected.length ? expected : undefined, rootDetails);
			} else {
				diagnose('unsupported', 'unknown-filter', `This app does not know the “${part}” filter.`, segment.index, expected.length ? expected : undefined, rootDetails);
			}
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
	let nextExpectedKind : CollectionSourceExpectedKind | undefined;
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
					nextExpectedKind = 'root';
				}
			}
		} catch {
			diagnose('invalid', 'legacy-mismatch', 'This source cannot be opened safely.');
			status = 'invalid';
		}
	}

	return {raw, kind, collectionText, segments, selectedCardRaw, selectedCardSource, query, hash, origin, notices, status, diagnostics, description, canonicalPath, nextExpected, nextExpectedDetails, nextExpectedKind};
};
