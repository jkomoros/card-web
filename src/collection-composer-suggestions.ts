import {
	CollectionDescription,
	collectionDescriptionWithFilterAppended,
	collectionDescriptionWithConfigurableFilter,
	collectionDescriptionWithFilterRemoved,
	collectionDescriptionWithQuery,
	collectionDescriptionWithSelected,
	collectionDescriptionWithSet,
	collectionDescriptionWithSortReversed,
	chronologicalDateBounds,
} from './collection_description.js';

import {
	CARD_FILTER_DESCRIPTIONS,
	CONFIGURABLE_FILTER_INFO,
	INVERSE_FILTER_NAMES,
	NONE_FILTER_NAME,
	SELECTED_FILTER_NAME,
	TODO_COMBINED_FILTER_NAME,
	parseRelativeDateParts,
} from './filters.js';
import { humanizeCollectionToken, parseCollectionSource } from './collection-source.js';

export type CollectionComposerSuggestionKind =
  | 'add'
  | 'broaden'
  | 'pivot'
  | 'recent'
  | 'source'
  | 'search';

export type CollectionComposerSuggestion = {
  id: string;
  kind: CollectionComposerSuggestionKind;
  action: 'open' | 'add' | 'remove' | 'replace';
  //The canonical display name of the thing this row acts on, with no verb
  //attached. `label` is this name with the action's verb in front of it, and
  //receipts are composed from it as sentences, so a clause reads the same in
  //the row, the chip, and the receipt that follows it.
  name: string;
  label: string;
  detail: string;
  description: CollectionDescription;
  destinationPath?: string;
  configureFilter?: string;
  sourceFilter?: string;
};

export type CollectionComposerCandidate = {
  filter: string;
  category: 'section' | 'tag' | 'card type' | 'todo' | 'relationship' | 'date' | 'author';
  label: string;
  detail: string;
  aliases?: string[];
  searchValues?: string[];
  urlDetail?: string;
  valueLabel?: string;
  spotlight?: boolean;
  clauseLabel?: string;
};

export type CollectionComposerContext = {
  cardsSelected?: boolean;
  candidates?: CollectionComposerCandidate[];
  recentCollections?: Array<{
    description: CollectionDescription;
    visits: number;
    frequent?: boolean;
    relative?: boolean;
  }>;
  preservedSelectedCard?: string;
  sourceAllowedOrigins?: ReadonlySet<string>;
  //The collection actually on screen, which is not the same thing as `current`
  //once the draft has been edited. Recents are destinations, and the
  //collection you are already standing in is not one.
  activeCollection?: CollectionDescription;
  //The canonical serialization of the collection visited immediately before
  //the active one, when history can say so. This is the only destination
  //allowed to be labeled "Back to"; everything else is just a destination.
  previousCollection?: string;
};

const SOURCE_ONLY_CONFIGURABLE_FILTERS = new Set(['combine', 'exclude', 'expand']);

export type ActiveCardMetadata = {
  section: string;
  tags: string[];
  cardType: string;
  contributors: string[];
};

export const activeCardMetadataCandidates = (
	activeCard: ActiveCardMetadata | null,
	baseCandidates: CollectionComposerCandidate[]
): CollectionComposerCandidate[] => {
	if (!activeCard) return [];
	const byFilter = new Map(baseCandidates.map(candidate => [candidate.filter, candidate]));
	const result: CollectionComposerCandidate[] = [];
	//A contextual candidate is the same clause as its base candidate — same
	//filter, same name. All that context adds is why it is being offered, so
	//only the reason, the spotlight, and the URL note change here. Rewriting the
	//label as well is how "Starred" ended up with four spellings.
	const add = (filter: string, reason: string, spotlight = false) => {
		const candidate = byFilter.get(filter);
		if (!candidate) return;
		result.push({
			...candidate,
			detail: reason,
			spotlight,
			urlDetail: candidate.category === 'author'
				? 'Adds a durable contributor clause; copied links keep the same person'
				: 'Adds the explicit value to the collection URL; copied links keep this value',
		});
	};
	const visibleTags = activeCard.tags
		.map(tag => ({tag, candidate: byFilter.get(tag)}))
		.filter(item => Boolean(item.candidate))
		.sort((left, right) => (left.candidate?.valueLabel || left.tag).localeCompare(right.candidate?.valueLabel || right.tag));
	for (const [index, {tag}] of visibleTags.entries()) {
		add(tag, 'The open card has this tag', index === 0);
	}
	if (activeCard.section) {
		add(activeCard.section, 'The open card is in this section', true);
	}
	if (activeCard.cardType) {
		add(activeCard.cardType, 'The open card has this card type');
	}
	for (const contributor of [...new Set((activeCard.contributors || []).filter(Boolean))]) {
		add(`author/${contributor.toLowerCase()}`, 'The open card has this contributor');
	}
	return result;
};

export const activeCardRelationshipCandidates = (activeCardID: string): CollectionComposerCandidate[] => activeCardID ? [
	{
		filter: `children/+${activeCardID}`,
		category: 'relationship',
		label: 'This card and cards it links to',
		detail: 'Anchors to the open card and follows its direct outgoing references; copied links keep this anchor',
		aliases: ['links from this card', 'linked from', 'children', 'outgoing references'],
	},
	{
		filter: `parents/+${activeCardID}`,
		category: 'relationship',
		label: 'This card and cards linking here',
		detail: 'Anchors to the open card and follows direct incoming references; copied links keep this anchor',
		aliases: ['links to this card', 'linking here', 'parents', 'incoming references'],
	},
	{
		filter: `direct-connections/+${activeCardID}`,
		category: 'relationship',
		label: 'This card and directly connected cards',
		detail: 'Anchors to the open card and follows references in either direction; copied links keep this anchor',
		aliases: ['connected to this card', 'connections', 'either direction', 'related cards'],
		spotlight: true,
	},
] : [];

const candidateRelevance = (candidate: CollectionComposerCandidate, query: string): number => {
	const values = candidate.searchValues || [candidate.label, candidate.filter, candidate.category, ...(candidate.aliases || [])]
		.map(value => value.toLowerCase());
	if (values.some(value => value === query)) return 0;
	if (values.some(value => value.startsWith(query))) return 1;
	const tokens = query.split(/\s+/).filter(Boolean);
	if (tokens.length && tokens.every(token => values.some(value => value.includes(token)))) return 2;
	if (values.some(value => value.includes(query))) return 3;
	return Number.POSITIVE_INFINITY;
};

//The word-level humanizer lives in collection-source, which this file already
//imports, so the parser's own diagnostics and these display names cannot drift
//into two spellings of the same token.
const humanize = humanizeCollectionToken;

const decoded = (value: string): string => {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};

//The handful of ordinary filters whose URL spelling does not humanize into the
//name the product uses for them. Overrides live here, inside the one naming
//function, rather than becoming a second table someone has to remember to keep
//in sync.
const FILTER_DISPLAY_NAME_OVERRIDES: Record<string, string> = {
	[SELECTED_FILTER_NAME]: 'Selected Cards',
	[TODO_COMBINED_FILTER_NAME]: 'Has any TODO',
	//`none` is a router placeholder, not a filter anyone composed. It should
	//never reach a draft now that history refuses to record it, but a hand-typed
	//route or an old bookmark still can — and humanize() rendered it as the bare
	//word 'None', which reads like a real, chosen condition. Named and explained,
	//it reads as what it is.
	[NONE_FILTER_NAME]: 'Nothing (placeholder)',
};

//Clauses the app can produce but the composer cannot meaningfully edit, each
//with the sentence that says why it is there and what to do about it. The spec
//("Unknown and unsupported source") asks for exactly this shape: a readable
//name plus a line of explanation, never a raw identifier on its own.
const UNSUPPORTED_FILTER_EXPLANATIONS: Record<string, string> = {
	[NONE_FILTER_NAME]: 'The app puts this in a route that names no collection yet. It matches no cards, so remove it to see anything.',
};

export const collectionFilterExplanation = (filter: string): string =>
	UNSUPPORTED_FILTER_EXPLANATIONS[filter] || '';

const DATE_FILTER_DISPLAY_NAMES: Record<string, string> = {
	updated: 'Updated',
	created: 'Created',
	'last-tweeted': 'Tweeted',
};

const QUERY_FILTER_DISPLAY_NAMES: Record<string, string> = {
	query: 'Text contains',
	'query-strict': 'Text exactly contains',
};

//A date boundary as the seeded date candidates spell it, so `7-days-ago` reads
//the same whether the clause came from a suggestion or from someone editing 7
//into 14 in the clause editor.
const readableDateBoundary = (value: string): string => {
	const parts = parseRelativeDateParts(value);
	if (!parts) return value;
	if (parts.type === 'special') return parts.value;
	if (parts.type === 'offset') {
		return `${parts.amount} ${parts.unit}${parts.amount === 1 ? '' : 's'} ago`;
	}
	return `last ${humanize(parts.weekday)}`;
};

//WHEN a boundary is, as a number, so two of them can be put in the order a
//reader expects. Both spellings a bound can take resolve here: a relative one
//through the engine's own resolver, a fixed one through Date. A bound that
//resolves to neither sorts as NaN, and the comparison below leaves the pair
//alone rather than guessing at an order for something it cannot read.
//`between` DELIBERATELY accepts its bounds in either order — filters.ts's
//comparison is order-insensitive. The LABEL had no such licence: 'Updated
//between 2026-08-19 and 2020-01-01' describes a window that runs backwards and
//therefore matches nothing, while the collection it names matches plenty. The
//engine keeps its tolerance; the display puts the earlier bound first, so the
//sentence describes the window that actually filters.
//
//ONE rule, shared with the path builder, which orders the same bounds when it
//produces the canonical URL. Two copies is how the display and the URL came to
//disagree about the same range.
const displayOrderedBounds = chronologicalDateBounds;

const derivedDateFilterName = (family: string, values: string[]): string => {
	const name = DATE_FILTER_DISPLAY_NAMES[family];
	if (!name) return '';
	const [comparison, ...boundaries] = values;
	if (comparison === 'between' && boundaries.length === 2) {
		const readable = displayOrderedBounds(boundaries).map(readableDateBoundary);
		return `${name} between ${readable[0]} and ${readable[1]}`;
	}
	const readable = boundaries.map(readableDateBoundary);
	if (comparison === 'after' && readable.length === 1) {
		return readable[0] === 'today' ? `${name} today` : `${name} since ${readable[0]}`;
	}
	if (comparison === 'before' && readable.length === 1) return `${name} before ${readable[0]}`;
	return '';
};

//The single function that maps a filter clause to the name a user sees. Every
//surface — suggestion labels, draft chips, broaden rows, receipts, the clause
//editor header, the filter catalog, source completions — goes through here, so
//a clause means the same thing everywhere. `labels` carries the names the live
//corpus knows (a tag's title, a contributor's display name); everything else is
//derived from the filter's own URL parts, which is what keeps an edited value
//("14 days ago") as well-named as the seeded one it replaced.
export const collectionFilterDisplayName = (
	filter: string,
	labels: Record<string, string> = {}
): string => {
	const known = labels[filter];
	if (known) return known;
	const [family, ...rawValues] = filter.split('/');
	if (rawValues[0]?.startsWith('+')) {
		if (family === 'children') return 'This card and cards it links to';
		if (family === 'parents') return 'This card and cards linking here';
		if (family === 'direct-connections') return 'This card and directly connected cards';
	}
	const readableFamily = (value: string) => {
		const alternatives = decoded(value)
			.split('+')
			.map(alternative => FILTER_DISPLAY_NAME_OVERRIDES[alternative] || humanize(alternative));
		return alternatives.length > 1 ? `(${alternatives.join(' OR ')})` : alternatives[0];
	};
	const readableValue = (value: string) => humanize(decoded(value).split('+').join(' '));
	const values = rawValues.map(decoded);
	const dateName = derivedDateFilterName(family, values);
	if (dateName) return dateName;
	const queryName = QUERY_FILTER_DISPLAY_NAMES[family];
	if (queryName && values.length) {
		return `${queryName} “${values.join('/').split('+').join(' ')}”`;
	}
	if (!rawValues.length) return readableFamily(family);
	return `${readableFamily(family)} ${rawValues.map(readableValue).join(' · ')}`;
};

//THE ONE PLACE A FILTER'S DESCRIPTION IS DECIDED, for the same reason
//collectionFilterDisplayName is the one place its NAME is.
//
//CARD_FILTER_DESCRIPTIONS synthesizes 'Inverse of <internal id>' for every
//excluding filter (filters.ts, where INVERSE_FILTER_NAMES is folded in), and
//that string is a raw filter id pointed straight at a user — the §1.4 MUST.
//It reached suggestion details, catalog rows, and every aria-label composed
//from them. Here the synthesized sentence is recognized by RECONSTRUCTING it
//rather than by matching a prefix, so an authored description that happens to
//begin with those words is still preferred, and the replacement goes through
//the display-name path so it names the other half of the pair the way the rest
//of the composer already does.
//
//The negative form is a whole authored sentence, never a prefix concatenated
//onto a positive one: 'Does not need ' + 'Whether the card has…' is how
//'Does not need Whether the card has citations…' shipped.
export const collectionFilterDescription = (
	filter: string,
	filterDescriptions: Readonly<Record<string, string>> = {},
	labels: Record<string, string> = {}
): string => {
	const family = filter.split('/')[0];
	const authored = filterDescriptions[filter] || filterDescriptions[family] || '';
	const positive = INVERSE_FILTER_NAMES[filter];
	if (positive && (!authored || authored === `Inverse of ${positive}`)) {
		return `Cards not matching ${collectionFilterDisplayName(positive, labels)}`;
	}
	return authored;
};

//Sets, sorts, and view modes are URL enum tokens too, and they reach the UI in
//select controls and receipts. One function so `reading-list` never shows up
//raw in either place.
export const collectionOptionDisplayName = (value: string): string => humanize(value);

//The names the live corpus knows for its own filters. One place decides that a
//candidate's clause label wins over its longer, search-oriented label.
export const collectionFilterLabels = (
	candidates: readonly CollectionComposerCandidate[] = []
): Record<string, string> =>
	Object.fromEntries(candidates.map(candidate => [candidate.filter, candidate.clauseLabel || candidate.label]));

const defaultFilter = (name: string): string => {
	const configurable = CONFIGURABLE_FILTER_INFO[name];
	if (!configurable) return name;
	return (
		name +
    '/' +
    configurable.arguments.map((argument) => argument.default).join('/')
	);
};

export const collectionDescriptionFromComposerSource = (
	rawSource: string
): CollectionDescription | null => {
	const parsed = parseCollectionSource(rawSource, {
		ordinaryFilters: new Set(Object.keys(CARD_FILTER_DESCRIPTIONS)),
	});
	return parsed.description || null;
};

//The verbs of the action grammar. A row's label is its verb followed by the
//clause's one canonical name, so the row, the chip it produces, and the receipt
//that follows all say the same words.
const ACTION_VERBS: Record<CollectionComposerSuggestion['action'], string> = {
	open: 'Open',
	add: 'Add',
	remove: 'Remove',
	replace: 'Replace',
};

const verbLabel = (action: CollectionComposerSuggestion['action'], name: string): string =>
	`${ACTION_VERBS[action]} ${name}`;

const removalSuggestions = (
	current: CollectionDescription,
	filterLabels: Record<string, string>
): CollectionComposerSuggestion[] =>
	current.filters.map((filter, index) => {
		const name = collectionFilterDisplayName(filter, filterLabels);
		return {
			id: `remove:${index}:${filter}`,
			kind: 'broaden' as const,
			action: 'remove' as const,
			name,
			label: verbLabel('remove', name),
			detail: `Broadens this collection by removing ${name}`,
			description: collectionDescriptionWithFilterRemoved(current, index),
		};
	});

const collectionDifference = (
	current: CollectionDescription,
	destination: CollectionDescription,
	visits: number,
	filterLabels: Record<string, string>
): string => {
	const changes: string[] = [];
	if (current.set !== destination.set) {
		changes.push(
			`Uses ${humanize(destination.set)} instead of ${humanize(current.set)}`
		);
	}
	const currentFilters = new Set(current.filters);
	const destinationFilters = new Set(destination.filters);
	const removed = current.filters.filter(
		(filter) => !destinationFilters.has(filter)
	);
	const added = destination.filters.filter(
		(filter) => !currentFilters.has(filter)
	);
	if (removed.length)
		changes.push(`Removes ${removed.map(filter => collectionFilterDisplayName(filter, filterLabels)).join(', ')}`);
	if (added.length)
		changes.push(`Adds ${added.map(filter => collectionFilterDisplayName(filter, filterLabels)).join(', ')}`);
	if (
		current.sort !== destination.sort ||
    current.sortReversed !== destination.sortReversed
	) {
		changes.push(
			`Sorts by ${destination.sortReversed ? 'reverse ' : ''}${humanize(
				destination.sort
			)}`
		);
	}
	changes.push(visits > 1 ? `Visited ${visits} times` : 'Recently visited');
	return changes.join(' · ');
};

const recentSuggestions = (
	current: CollectionDescription,
	context: CollectionComposerContext
): CollectionComposerSuggestion[] => {
	const filterLabels = collectionFilterLabels(context.candidates);
	//Suppress both the draft being composed and the collection already on
	//screen. Deduping against the draft alone meant that as soon as the draft
	//diverged from the active collection — the state every user is in after
	//their first Tab — the recents happily offered "Back to <the collection you
	//are looking at>", a destination whose only effect is to throw the draft
	//away.
	const suppressed = new Set<string>([current.serialize()]);
	if (context.activeCollection) suppressed.add(context.activeCollection.serialize());
	const seen = new Set<string>();
	const result: CollectionComposerSuggestion[] = [];
	for (const recent of context.recentCollections || []) {
		const canonical = recent.description.serialize();
		if (suppressed.has(canonical) || seen.has(canonical)) continue;
		seen.add(canonical);
		const name = readableCollectionExpression(recent.description, filterLabels);
		//A recent is named by what it IS. "Back to" is a claim about direction, so
		//it is spent only on the one collection the history can actually prove you
		//came from; every other recent is simply a destination you can open.
		const previous = Boolean(context.previousCollection) && canonical === context.previousCollection;
		result.push({
			id: `recent:${canonical}`,
			kind: 'recent',
			action: 'open',
			name,
			label: previous ? `Back to ${name}` : verbLabel('open', name),
			detail: `${collectionDifference(current, recent.description, recent.visits, filterLabels)}${recent.relative ? ' · Recognized as the same rolling date window' : ''}`,
			description: recent.description,
		});
		//FOUR rows, matching the budget the history module reserves: three
		//recents plus the one frequency-promoted collection. At three, a
		//three-legged rotation lost a leg — the row on screen is suppressed
		//above, so the visible list was never as deep as its cap suggested.
		if (result.length >= 4) break;
	}
	return result;
};

const EMPTY_STATE_FILTERS = ['starred', 'unread', 'working-notes'];

const emptyStateSuggestions = (
	current: CollectionDescription,
	context: CollectionComposerContext
): CollectionComposerSuggestion[] => {
	const filterLabels = collectionFilterLabels(context.candidates);
	const recents = recentSuggestions(current, context);
	const refinements: CollectionComposerSuggestion[] = [];
	if (
		context.cardsSelected &&
    !current.filters.includes(SELECTED_FILTER_NAME)
	) {
		const name = collectionFilterDisplayName(SELECTED_FILTER_NAME, filterLabels);
		refinements.push({
			id: 'add:selected',
			kind: 'add',
			action: 'add',
			name,
			label: verbLabel('add', name),
			detail:
        `Adds the ordinary ${name} filter; clear the selection to change its members`,
			description: collectionDescriptionWithSelected(current),
		});
	}
	refinements.push(...removalSuggestions(current, filterLabels));
	//Teach the coherent outgoing/incoming/either-direction family only when it
	//will not displace recents, selection, or removal actions. In denser states
	//the same candidates remain discoverable by typing.
	if (!recents.length && !refinements.length && !current.filters.length) {
		for (const candidate of (context.candidates || []).filter(candidate => candidate.spotlight).slice(0, 3)) {
			const name = collectionFilterDisplayName(candidate.filter, filterLabels);
			refinements.push({
				id: `candidate:${candidate.category}:${candidate.filter}`,
				kind: 'add',
				action: 'add',
				name,
				label: verbLabel('add', name),
				detail: `${candidate.detail} · ${candidate.urlDetail || `Adds ${name} to the collection URL; copied links keep it`}`,
				description: collectionDescriptionWithFilterAppended(current, candidate.filter),
			});
		}
	}
	for (const filter of EMPTY_STATE_FILTERS) {
		if (current.filters.includes(filter)) continue;
		const name = collectionFilterDisplayName(filter, filterLabels);
		refinements.push({
			id: `add:${filter}`,
			kind: 'add',
			action: 'add',
			name,
			label: verbLabel('add', name),
			detail: `Adds ${name} to this collection`,
			description: collectionDescriptionWithFilterAppended(current, filter),
		});
	}
	if (current.set !== 'everything') {
		refinements.push({
			id: 'set:everything',
			kind: 'broaden',
			action: 'replace',
			name: 'Everything',
			label: 'Start from Everything',
			detail: `Replaces the ${collectionOptionDisplayName(current.set)} set with Everything`,
			description: collectionDescriptionWithSet(current, 'everything'),
		});
	}
	refinements.push({
		id: 'sort:reverse',
		kind: 'pivot',
		action: 'replace',
		name: current.sortReversed ? 'Normal sort direction' : 'Reversed sort',
		label: current.sortReversed
			? 'Use normal sort direction'
			: 'Reverse the current sort',
		detail: current.sortReversed
			? 'Turns off reversed sorting'
			: 'Keeps every clause and reverses only the sort',
		description: collectionDescriptionWithSortReversed(
			current,
			!current.sortReversed
		),
	});
	//One destination, one row. A recent whose destination a refinement already
	//rebuilds is the same collection reached by a different verb; the refinement
	//wins because it teaches the transformation, and because serialize() is
	//faithful down to sort and view mode, an identical serialization means the
	//recent carried nothing extra to lose.
	const refinementDestinations = new Set(refinements.map(suggestion => suggestion.description.serialize()));
	return dedupedByDestination(
		[...recents.filter(recent => !refinementDestinations.has(recent.description.serialize())), ...refinements],
		current
	).slice(0, 8);
};

//No row may offer the collection it is already standing in, and no two rows may
//offer the same one. Both are the same rule: a row whose destination is
//indistinguishable from another row's — or from the draft's — is not a choice.
const dedupedByDestination = (
	suggestions: CollectionComposerSuggestion[],
	current: CollectionDescription
): CollectionComposerSuggestion[] => {
	const currentDestination = current.serialize();
	const seen = new Set<string>();
	const result: CollectionComposerSuggestion[] = [];
	for (const suggestion of suggestions) {
		const destination = suggestion.description.serialize();
		//Two rows are exempt from destination identity. A pasted source is the
		//user's own text, and echoing it back is honest even when it names the
		//collection they are already composing. A row that opens an editor
		//(Configure/Edit in Source) does not go anywhere at all, so its nominal
		//destination is not what it offers.
		const opensAnEditor = Boolean(suggestion.configureFilter || suggestion.sourceFilter);
		if (suggestion.kind !== 'source' && !opensAnEditor) {
			if (destination === currentDestination) continue;
			if (seen.has(destination)) continue;
		}
		seen.add(destination);
		result.push(suggestion);
	}
	return result;
};

//Ranking that can only use what it already knows. Rows with a resolved count of
//zero sink below rows that lead somewhere, within their own section so the
//Continue/Refine split stays put. Rows whose count has not arrived keep their
//deterministic place rather than being punished for being slow.
export const rankedComposerSuggestions = (
	suggestions: readonly CollectionComposerSuggestion[],
	counts: { [suggestionID: string]: number } = {}
): CollectionComposerSuggestion[] => {
	const section = (suggestion: CollectionComposerSuggestion) => (suggestion.kind === 'recent' ? 0 : 1);
	const empty = (suggestion: CollectionComposerSuggestion) => (counts[suggestion.id] === 0 ? 1 : 0);
	return suggestions
		.map((suggestion, index) => ({suggestion, index}))
		.sort((left, right) =>
			section(left.suggestion) - section(right.suggestion) ||
      empty(left.suggestion) - empty(right.suggestion) ||
      left.index - right.index)
		.map(({suggestion}) => suggestion);
};

export const collectionComposerSuggestions = (
	current: CollectionDescription,
	input: string,
	filterDescriptions: { [filterName: string]: string },
	context: CollectionComposerContext = {}
): CollectionComposerSuggestion[] => {
	const query = input.trim();
	if (!query) return emptyStateSuggestions(current, context);

	const filterLabels = collectionFilterLabels(context.candidates);
	const result: CollectionComposerSuggestion[] = [];
	const looksLikeSource = query.includes('/') || /^https?:\/\//i.test(query);
	if (looksLikeSource) {
		const parsedSource = parseCollectionSource(query, {
			ordinaryFilters: new Set([...Object.keys(CARD_FILTER_DESCRIPTIONS), ...Object.keys(filterDescriptions)]),
			preservedSelectedCard: context.preservedSelectedCard,
			allowedOrigins: context.sourceAllowedOrigins,
		});
		const description = parsedSource.description;
		if (description && parsedSource.canonicalPath) {
			result.push({
				id: `source:${description.serialize()}`,
				kind: 'source',
				action: 'open',
				name: readableCollectionExpression(description, filterLabels),
				label: 'Open this collection source',
				detail: description.serializeShortOriginalOrder(),
				description,
				destinationPath: parsedSource.canonicalPath,
			});
		}
	}

	const normalizedQuery = query.toLowerCase();
	const matchingCandidates = (context.candidates || [])
		.map(candidate => ({candidate, relevance: candidateRelevance(candidate, normalizedQuery)}))
		.filter(match => Number.isFinite(match.relevance))
		.sort((left, right) => left.relevance - right.relevance || left.candidate.label.localeCompare(right.candidate.label));
	//The honest description is computed BEFORE the match, not after it: a row
	//that matched on the words 'Inverse of not-starred' and then displayed
	//something else would be answering a query the user cannot see.
	const matchingFilters = Object.keys(filterDescriptions)
		.map(name => ({name, detail: collectionFilterDescription(name, filterDescriptions, filterLabels)}))
		.filter(({name, detail}) =>
			name.toLowerCase().includes(normalizedQuery) || detail.toLowerCase().includes(normalizedQuery)
		)
		.map(({name, detail}) => {
			const relevance = (() => {
				const normalizedName = name.toLowerCase();
				if (normalizedName === normalizedQuery) return 0;
				if (normalizedName.startsWith(normalizedQuery)) return 1;
				if (normalizedName.includes(normalizedQuery)) return 2;
				if (detail.toLowerCase().startsWith(normalizedQuery)) return 3;
				return 4;
			})();
			return {name, detail, relevance};
		});
	const interpretations = [
		...matchingCandidates.map(match => ({type: 'candidate' as const, ...match})),
		...matchingFilters.map(match => ({type: 'filter' as const, ...match})),
	].sort((left, right) => left.relevance - right.relevance ||
    (left.type === right.type ? 0 : left.type === 'candidate' ? -1 : 1) ||
    (left.type === 'candidate' ? left.candidate.label : left.name).localeCompare(right.type === 'candidate' ? right.candidate.label : right.name));
	const seenDestinations = new Set(result.map(suggestion => suggestion.description.serialize()));
	let concreteCandidateCount = 0;
	for (const interpretation of interpretations) {
		let suggestion: CollectionComposerSuggestion;
		if (interpretation.type === 'candidate') {
			const candidate = interpretation.candidate;
			if (current.filters.includes(candidate.filter) || concreteCandidateCount >= 6) continue;
			const name = collectionFilterDisplayName(candidate.filter, filterLabels);
			suggestion = {
				id: `candidate:${candidate.category}:${candidate.filter}`,
				kind: 'add',
				action: 'add',
				name,
				label: verbLabel('add', name),
				detail: `${candidate.detail} · ${candidate.urlDetail || `Adds ${name} to the collection URL; copied links keep it`}`,
				description: collectionDescriptionWithFilterAppended(current, candidate.filter),
			};
		} else {
			const {name, detail} = interpretation;
			const filter = defaultFilter(name);
			const configurable = CONFIGURABLE_FILTER_INFO[name];
			const sourceOnly = configurable && SOURCE_ONLY_CONFIGURABLE_FILTERS.has(name);
			const existingConfigurable = configurable && current.filters.some(currentFilter => currentFilter.startsWith(name + '/'));
			if (!configurable && current.filters.includes(filter)) continue;
			//A configurable family is named by its family until its values exist; a
			//plain filter is named by the one name that clause carries everywhere.
			const displayName = configurable ?
				collectionFilterDisplayName(name, filterLabels) :
				collectionFilterDisplayName(filter, filterLabels);
			suggestion = {
				id: `filter:${filter}`,
				kind: 'add',
				action: existingConfigurable ? 'replace' : 'add',
				name: displayName,
				label: sourceOnly ? `Edit ${displayName} in Source` : configurable ? `${existingConfigurable ? 'Edit' : 'Configure'} ${displayName}` : verbLabel('add', displayName),
				detail: sourceOnly ? `${detail} · nested expressions use lossless Source mode with completions` : configurable ? `${detail} · choose its values before changing the draft` : detail,
				description: existingConfigurable ? collectionDescriptionWithConfigurableFilter(current, filter) : collectionDescriptionWithFilterAppended(current, filter),
				configureFilter: configurable && !sourceOnly ? name : undefined,
				sourceFilter: sourceOnly ? name : undefined,
			};
		}
		const destination = suggestion.description.serialize();
		if (seenDestinations.has(destination)) continue;
		seenDestinations.add(destination);
		if (interpretation.type === 'candidate') concreteCandidateCount++;
		result.push(suggestion);
		if (result.length >= 7) break;
	}

	const queryDescription = collectionDescriptionWithQuery(current, query);
	const queryAction = current.filters.some(filter => filter.startsWith('query/')) ? 'replace' : 'add';
	const queryName = collectionFilterDisplayName(
		queryDescription.filters.find(filter => filter.startsWith('query/')) || '',
		filterLabels
	);
	result.push({
		id: `query:${normalizedQuery}`,
		kind: 'search',
		action: queryAction,
		name: queryName,
		label: verbLabel(queryAction, queryName),
		detail: 'Explicitly adds a text-query clause to this collection',
		description: queryDescription,
	});

	return dedupedByDestination(result, current).slice(0, 8);
};

export const readableCollectionExpression = (
	description: CollectionDescription,
	filterLabels: Record<string, string> = {}
): string => {
	const parts = collectionExpressionParts(description, filterLabels);
	const clauses = [parts.set.label];
	clauses.push(...parts.filters.map(filter => filter.label));
	let result = clauses.join(' AND ');
	if (parts.modifiers.length) result += ` · ${parts.modifiers.join(' · ')}`;
	return result;
};

export type CollectionExpressionParts = {
  set: { raw: string; label: string };
  //`explanation` is non-empty only for a clause the composer cannot edit, and
  //carries the sentence that says why it is in the draft at all.
  filters: Array<{ raw: string; label: string; index: number; explanation: string }>;
  modifiers: string[];
};

export const collectionExpressionParts = (
	description: CollectionDescription,
	filterLabels: Record<string, string> = {}
): CollectionExpressionParts => {
	const modifiers: string[] = [];
	if (description.sort !== 'default' || description.sortReversed) {
		modifiers.push(`sorted by ${description.sortReversed ? 'reverse ' : ''}${collectionOptionDisplayName(description.sort)}`);
	}
	if (description.viewMode !== 'list') {
		let view = `viewed as ${collectionOptionDisplayName(description.viewMode)}`;
		if (description.viewModeExtra) view += ` (${collectionOptionDisplayName(description.viewModeExtra)})`;
		modifiers.push(view);
	}
	return {
		set: {raw: description.set, label: collectionOptionDisplayName(description.set)},
		filters: description.filters.map((raw, index) => ({raw, index, label: collectionFilterDisplayName(raw, filterLabels), explanation: collectionFilterExplanation(raw)})),
		modifiers,
	};
};

//The one place a draft edit turns into a sentence. Receipts are composed from
//the same canonical names the rows and chips use, so "Add: Add Starred" and
//"Updated filter" cannot happen: the receipt says what changed, in the words
//the change was offered in.
const truncatedName = (name: string): string => (name.length > 48 ? `${name.slice(0, 47)}…` : name);

const namedList = (names: string[]): string => {
	const shown = names.slice(0, 2).map(truncatedName);
	const remaining = names.length - shown.length;
	if (!remaining) return shown.join(' and ');
	return `${shown.join(', ')} and ${remaining} more`;
};

export const collectionDraftReceipt = (
	before: CollectionDescription,
	after: CollectionDescription,
	filterLabels: Record<string, string> = {}
): string => {
	const beforeFilters = new Set(before.filters);
	const afterFilters = new Set(after.filters);
	const removed = before.filters.filter(filter => !afterFilters.has(filter));
	const added = after.filters.filter(filter => !beforeFilters.has(filter));
	const name = (filter: string) => collectionFilterDisplayName(filter, filterLabels);
	if (removed.length === 1 && added.length === 1 && removed[0].split('/')[0] === added[0].split('/')[0]) {
		return `Changed ${truncatedName(name(removed[0]))} to ${truncatedName(name(added[0]))}`;
	}
	const changes: string[] = [];
	if (removed.length) changes.push(`Removed ${namedList(removed.map(name))}`);
	if (added.length) changes.push(`Added ${namedList(added.map(name))}`);
	if (before.set !== after.set) changes.push(`Changed the starting set to ${collectionOptionDisplayName(after.set)}`);
	if (before.sort !== after.sort) changes.push(`Changed the order to ${collectionOptionDisplayName(after.sort)}`);
	if (before.sortReversed !== after.sortReversed) changes.push(after.sortReversed ? 'Reversed the order' : 'Restored the normal order');
	if (before.viewMode !== after.viewMode) changes.push(`Changed the view to ${collectionOptionDisplayName(after.viewMode)}`);
	else if (before.viewModeExtra !== after.viewModeExtra) changes.push('Changed the focus card');
	if (!changes.length) return 'Updated this draft';
	return changes.join(' · ');
};
