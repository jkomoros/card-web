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
	COMBINE_FILTER_NAME,
	CONFIGURABLE_FILTER_INFO,
	EXCLUDE_FILTER_NAME,
	INVERSE_FILTER_NAMES,
	NONE_FILTER_NAME,
	SELECTED_FILTER_NAME,
	TODO_COMBINED_FILTER_NAME,
	filterNameIsViewerDependent,
	filterNamesAreViewerDependent,
	parseRelativeDateParts,
} from './filters.js';
import { humanizeCollectionToken, parseCollectionSource } from './collection-source.js';
import { curatedFilterDescription, filterSynonyms } from './collection-filter-synonyms.js';
import {
	namedInverseFilterName,
	splitCombineMembers,
	unionSpellingMembers,
} from './collection-boolean-spelling.js';

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
  //True when the clause this row adds — or, for a destination row, the
  //collection it opens — is computed from the signed-in account. The row says
  //so, quietly, because the consequence only shows up once the link is shared.
  viewerDependent?: boolean;
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
  //HOW MANY CARDS THIS VALUE COVERS, when the corpus can say — sections and
  //tags know their own membership. It is a RANKING input (the completion
  //index's corpus-fit term: a tag on four hundred cards is a likelier thing to
  //reach for than a tag on one), never a displayed number: the counts a row
  //shows come from running the collection, and a membership list is a different
  //and staler fact than that.
  corpusCount?: number;
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
  //Card id → title, for naming the card an anchored clause is anchored to. A
  //missing entry is normal (the card's title has not loaded, or this account
  //cannot see it) and falls back to the id.
  cardNames?: Record<string, string>;
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
//The families whose first argument is a card, the sentence each one makes once
//that card has a name, and WHAT ITS REMAINING ARGUMENTS ARE. Every one of them
//reads as a relationship to a named thing rather than as a family name with an
//identifier stuck on the end ("Direct Connections Perf Card 42"), which is what
//the generic value path produced for the families that had no special case at
//all.
//
//The `rest` shapes exist because the generic path joined every positional
//argument with ' · ' and named none of them: `References “X” · Link · 2` gave
//a reference type and a search depth the same formatting and no label, so the
//`2` could have been anything. Direction (who references whom) is taken from
//the engine's own isInbound/twoWay test in makeCardLinksConfigurableFilter,
//not from the family descriptions — two of those descriptions currently
//contradict each other.
type AnchoredArgument = 'reference-types' | 'ply';

const ANCHORED_CLAUSE_SHAPES: Record<string, {sentence: (card: string) => string; rest: AnchoredArgument[]}> = {
	'children': {sentence: card => `Cards ${card} links to`, rest: []},
	'parents': {sentence: card => `Cards linking to ${card}`, rest: []},
	'direct-connections': {sentence: card => `Connected to ${card}`, rest: []},
	'similar': {sentence: card => `Similar to ${card}`, rest: []},
	//Downstream/upstream rather than another pair of mirror sentences. The two
	//descriptions these replace differed only in voice ("referenced by a given
	//card" against "reference the given card"), which is exactly the pair a
	//reader has to parse twice to tell apart.
	'descendants': {sentence: card => `Downstream of ${card}`, rest: ['ply']},
	'ancestors': {sentence: card => `Upstream of ${card}`, rest: ['ply']},
	'connections': {sentence: card => `Connected to ${card}`, rest: ['ply']},
	'direct-references': {sentence: card => `Connected to ${card}`, rest: ['reference-types']},
	'direct-references-inbound': {sentence: card => `Referencing ${card}`, rest: ['reference-types']},
	'direct-references-outbound': {sentence: card => `Referenced by ${card}`, rest: ['reference-types']},
	'references': {sentence: card => `Connected to ${card}`, rest: ['reference-types', 'ply']},
	'references-inbound': {sentence: card => `Referencing ${card}`, rest: ['reference-types', 'ply']},
	'references-outbound': {sentence: card => `Referenced by ${card}`, rest: ['reference-types', 'ply']},
};

//'within 2 steps' is the spec's own spelling for a ply — its opening-state
//example reads "Adds Working notes + References within 2 steps" — and it is
//what the word 'Ply' has to become everywhere it is shown, because nobody
//outside a graph-search paper reads a bare '2' as a search depth.
export const readablePly = (value: string): string => {
	const steps = Number(value);
	if (!Number.isFinite(steps)) return `within ${value} steps`;
	return steps === 1 ? 'within 1 step' : `within ${steps} steps`;
};

//A card's name as a clause should say it: its title in quotes, or its id when
//no title has loaded. Quoted because a title is arbitrary user text and can be
//a whole sentence; without quotes "Connected to Cards linking to X" is
//unparseable.
const anchorCardName = (rawValue: string, cardNames: Record<string, string>): string => {
	//`+` is INCLUDE_KEY_CARD_PREFIX — whether the anchor card is itself in the
	//results. It changes the membership, not which card is being named.
	const id = decoded(rawValue).replace(/^\+/, '');
	if (!id) return '';
	const title = cardNames[id];
	return title ? `“${title}”` : id;
};

//Reference types arrive as a `+`-joined union, optionally behind the invert
//prefix. Humanized and joined with 'or', because that is what a union of them
//means to the person reading it.
const readableReferenceTypes = (rawValue: string): string => {
	const value = decoded(rawValue);
	const inverted = value.startsWith('-');
	const types = (inverted ? value.slice(1) : value).split('+').filter(Boolean).map(humanize);
	if (!types.length) return '';
	const joined = types.length > 1 ? `${types.slice(0, -1).join(', ')} or ${types[types.length - 1]}` : types[0];
	return inverted ? `by any reference except ${joined}` : `by ${joined} references`;
};

const anchoredClauseName = (
	family: string,
	rawValues: string[],
	cardNames: Record<string, string>
): string => {
	const shape = ANCHORED_CLAUSE_SHAPES[family];
	if (!shape) return '';
	//A clause with MORE arguments than the family's shape accounts for is a
	//spelling this function does not understand, and a name that silently
	//dropped an argument would describe a different collection from the one
	//that runs. Fewer is fine — a trailing argument the URL omits is one the
	//engine defaults, and there is nothing to say about it.
	if (!rawValues.length || rawValues.length > shape.rest.length + 1) return '';
	const card = anchorCardName(rawValues[0], cardNames);
	if (!card) return '';
	const parts = [shape.sentence(card)];
	for (const [index, kind] of shape.rest.entries()) {
		const raw = rawValues[index + 1];
		if (raw === undefined) continue;
		const readable = kind === 'ply' ? readablePly(decoded(raw)) : readableReferenceTypes(raw);
		if (readable) parts.push(readable);
	}
	return parts.join(' · ');
};

//A boolean segment read as words, or '' when this segment is not one. Split by
//the one splitter the draft layer uses, so a `combine/` that the compiler would
//model as a group and a `combine/` that this function names cannot disagree
//about where the first member ends. A segment the splitter refuses is left to
//the generic path, exactly as the draft layer leaves it as a manual pill.
const booleanSpellingName = (
	filter: string,
	labels: Record<string, string>,
	cardNames: Record<string, string>
): string => {
	const name = (part: string) => collectionFilterDisplayName(part, labels, cardNames);
	const union = unionSpellingMembers(filter);
	if (union) return union.map(name).join(' or ');
	const slash = filter.indexOf('/');
	if (slash < 0) return '';
	const head = filter.slice(0, slash);
	const rest = filter.slice(slash + 1);
	if (!rest) return '';
	if (head === EXCLUDE_FILTER_NAME) {
		//The app's own word first — `exclude/published` IS `unpublished`, and the
		//draft layer normalizes the two into one node for exactly that reason.
		const named = namedInverseFilterName(rest);
		if (named) return name(named);
		//A negated ALTERNATION is bracketed, for the reason describeExpressionNode
		//states: "not A or B" read left to right is (not A) or B, which is a
		//different collection. The two functions have to agree, because they name
		//the same clause on different surfaces.
		const inner = name(rest);
		return unionSpellingMembers(rest) || splitCombineMembers(rest) ?
			`not (${inner})` :
			`not ${inner}`;
	}
	if (head === COMBINE_FILTER_NAME) {
		const halves = splitCombineMembers(rest);
		if (!halves) return '';
		return halves.map(name).join(' or ');
	}
	return '';
};

//("14 days ago") as well-named as the seeded one it replaced.
export const collectionFilterDisplayName = (
	filter: string,
	labels: Record<string, string> = {},
	cardNames: Record<string, string> = {}
): string => {
	const known = labels[filter];
	if (known) return known;
	//THE THREE BOOLEAN SPELLINGS ARE READ, NOT SHOWN (proposal C §3: "never
	//exclude, combine, not, or invert as UI nouns").
	//
	//Before this branch the generic path below named `tag-2+tag-1` by splitting
	//the FAMILY on '+' and humanizing each half — "(Tag 2 OR Tag 1)", ignoring
	//`labels` entirely, so the same clause was "Tagged tag-2 or Tagged tag-1" as
	//a pill and "(Tag 2 OR Tag 1)" in the snackbar that followed choosing it.
	//`exclude/tag-1+tag-2` was worse: `exclude` fell through as an ordinary
	//family name and the flip receipt read "Added Exclude Tag 1 Tag 2".
	//
	//Naming a boolean segment is naming its PARTS, so this recurses through
	//itself — which is what makes the names inside a group the same names the
	//group's members carry as pills, `labels` and all. The words are the draft
	//layer's own: lowercase 'or' between alternatives, the app's inverse WORD
	//for a negation that has one, and 'not X' when it does not.
	const boolean = booleanSpellingName(filter, labels, cardNames);
	if (boolean) return boolean;
	const [family, ...rawValues] = filter.split('/');
	//AN ANCHORED CLAUSE IS NAMED BY THE CARD IT ANCHORS.
	//
	//This branch used to return 'This card and cards it links to' for any
	//`+`-prefixed clause of these three families, keyed on the prefix and the
	//family and never on WHICH card. That is only true when the anchor is the
	//card on screen — and the `labels` lookup two lines above already handles
	//exactly that case, because activeCardRelationshipCandidates seeds labels
	//with `children/+<activeCardID>` and its two siblings. So everything
	//reaching here is a clause anchored to some OTHER card, and calling it
	//"this card" was false in every one of them.
	//
	//The visible damage: two Continue rows anchored to different cards were
	//indistinguishable, and swapping the anchor produced the receipt "Changed
	//This card and directly connected cards to This card and directly
	//connected cards". Naming the card fixes both at once, because the receipt
	//is composed from this same function.
	//
	//The id is the fallback and ONLY the fallback — for a card whose title has
	//not loaded, or which this account cannot see. It is not a good name, but
	//it is the one honest thing left to say, and it is strictly better than a
	//confident sentence about the wrong card.
	const anchorName = anchoredClauseName(family, rawValues, cardNames);
	if (anchorName) return anchorName;
	const readableFamily = (value: string) => {
		const alternatives = decoded(value)
			.split('+')
			.map(alternative => FILTER_DISPLAY_NAME_OVERRIDES[alternative] || humanize(alternative));
		//Lowercase 'or', like every other alternation in the app's prose. A
		//RAW '+' is handled one level up by booleanSpellingName; this arm only
		//catches a percent-encoded one, and it must not spell it differently.
		return alternatives.length > 1 ? alternatives.join(' or ') : alternatives[0];
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
	//THE CURATED SENTENCE OUTRANKS THE REGISTRY'S OWN, and only for the filters
	//collection-filter-synonyms has actually rewritten. The registry's
	//descriptions were authored for a catalog that listed mechanisms; the
	//composer shows them to somebody choosing a collection, and the two audiences
	//want different sentences about the same filter. A live section or tag
	//description (which arrives through `filterDescriptions` keyed by its own id)
	//is never overridden, because the corpus knows its own tags better than a
	//static table can.
	const curated = curatedFilterDescription(filter) || curatedFilterDescription(family);
	if (curated) return curated;
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

//THE SENTENCE'S TAIL, WRITTEN ONCE.
//
//"sorted by Updated" put a title-cased option name in the middle of a lowercase
//phrase, so the sort read as a proper noun the user was supposed to already
//know. The tail is prose about the collection, so its words are prose. Two
//surfaces composed this phrase independently — the sentence renderer's own tail
//and collectionExpressionParts — which is why one of them could be fixed and
//the other could not; there is one now.
const lowercaseOption = (value: string): string => {
	const name = collectionOptionDisplayName(value);
	//Only the leading capital humanize() added. A name that is genuinely
	//upper-case past its first letter (TODO) keeps it.
	return name.charAt(0).toLowerCase() + name.slice(1);
};

export const collectionOrderPhrases = (
	sort: string,
	sortReversed: boolean,
	viewMode: string,
	viewModeExtra: string
): string[] => {
	const phrases: string[] = [];
	if (sort !== 'default' || sortReversed) {
		phrases.push(`sorted by ${sortReversed ? 'reverse ' : ''}${lowercaseOption(sort)}`);
	}
	if (viewMode !== 'list') {
		let view = `viewed as ${lowercaseOption(viewMode)}`;
		if (viewModeExtra) view += ` (${collectionOptionDisplayName(viewModeExtra)})`;
		phrases.push(view);
	}
	return phrases;
};

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

//EXPORTED for the palette's zero-card recovery. A draft that matches nothing
//needs the per-clause removals back — with their counts — and re-deriving
//"remove clause N, named" beside the generator that already does it is how the
//recovery list and the Refine list would come to name the same clause two ways.
export const collectionComposerRemovalSuggestions = (
	current: CollectionDescription,
	filterLabels: Record<string, string> = {},
	cardNames: Record<string, string> = {}
): CollectionComposerSuggestion[] => removalSuggestions(current, filterLabels, cardNames);

const removalSuggestions = (
	current: CollectionDescription,
	filterLabels: Record<string, string>,
	cardNames: Record<string, string> = {}
): CollectionComposerSuggestion[] =>
	current.filters.map((filter, index) => {
		const name = collectionFilterDisplayName(filter, filterLabels, cardNames);
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

//WHAT ARRIVING AT THIS COLLECTION WOULD DO TO THE DRAFT, as one line.
//
//A recent (or a pivot) is a COMBINATORIAL action in the round-3 model: executing
//it replaces the draft with several changes at once. Every other row can show
//what it does as the pill it produces; this one cannot, because it produces half
//a dozen.
//
//IT IS NOT THE ANNOTATION ANY MORE (round-3 tightness, S1). It was, on the
//argument "same shape, bigger payload"; on a real corpus the payload was a
//three-clause sentence in the slot where every other row says 'tag', it wrapped
//to three lines, and it made one species of row twice the height of the rest.
//That is the one-species rule broken by the mechanism meant to keep it. The slot
//says `recent`; this sentence is the row's DETAIL line, which is where every
//other row's explanation lives and where — since collectionDifference has always
//been built out of it — this one already was.
//
//STILL EXPORTED, because the receipt and the tests name a destination's diff the
//same way and a second derivation of one sentence is how they would drift.
export const collectionComposerDestinationDiff = (
	current: CollectionDescription,
	destination: CollectionDescription,
	filterLabels: Record<string, string> = {},
	cardNames: Record<string, string> = {}
): string => collectionDifferenceChanges(current, destination, filterLabels, cardNames).join(' · ');

const collectionDifferenceChanges = (
	current: CollectionDescription,
	destination: CollectionDescription,
	filterLabels: Record<string, string>,
	cardNames: Record<string, string> = {}
): string[] => {
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
		changes.push(`Removes ${removed.map(filter => collectionFilterDisplayName(filter, filterLabels, cardNames)).join(', ')}`);
	if (added.length)
		changes.push(`Adds ${added.map(filter => collectionFilterDisplayName(filter, filterLabels, cardNames)).join(', ')}`);
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
	return changes;
};

const collectionDifference = (
	current: CollectionDescription,
	destination: CollectionDescription,
	visits: number,
	filterLabels: Record<string, string>,
	cardNames: Record<string, string> = {}
): string => [
	...collectionDifferenceChanges(current, destination, filterLabels, cardNames),
	visits > 1 ? `Visited ${visits} times` : 'Recently visited',
].join(' · ');

//A URL note that is true. The default promise — "copied links keep it" — is a
//claim about durability, and it is false for a clause whose membership is
//recomputed from whoever opens the link: the value in the URL is kept, and it
//still resolves to somebody else's cards. Saying the reassuring sentence
//anyway is precisely what §"Never hide ambiguity" forbids, so a personal
//clause gets the honest one instead. The personal test runs FIRST, ahead of
//any authored `urlDetail`, because a hand-written durability promise on a
//personal clause would be the same lie with better prose.
const candidateURLNote = (filter: string, name: string, urlDetail?: string): string => {
	if (filterNameIsViewerDependent(filter)) return `Adds ${name} to the collection URL; the results depend on who opens it`;
	return urlDetail || `Adds ${name} to the collection URL; copied links keep it`;
};

//EXPORTED so the completion index can offer the same recents rows the idle list
//offers, rather than re-deriving "a recent collection, named and deduped" a
//second time. The meta-proposal makes recents "the first content of the first
//gesture" in BOTH the idle list and the typed list (convergence 4), and two
//derivations of one row is how those two lists would come to disagree about
//which collection you were last in.
export const collectionComposerRecentSuggestions = (
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
		const name = readableCollectionExpression(recent.description, filterLabels, context.cardNames || {});
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
			detail: `${collectionDifference(current, recent.description, recent.visits, filterLabels, context.cardNames || {})}${recent.relative ? ' · Recognized as the same rolling date window' : ''}`,
			description: recent.description,
			//A recent is a destination, not a clause, so the question is whether
			//the collection it opens is personal — one personal clause anywhere in
			//it is enough.
			viewerDependent: filterNamesAreViewerDependent(recent.description.filters),
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
	const recents = collectionComposerRecentSuggestions(current, context);
	const refinements: CollectionComposerSuggestion[] = [];
	//THE OPENING STATE'S OWN EXAMPLE. Spec §Opening state lists "recent, pinned,
	//resumable, or ACTIVE-CARD destinations" as the first of the two stable
	//sections, and its worked example leads with exactly this row:
	//
	//    Working notes connected to this card                         8
	//    Adds Working notes + References within 2 steps
	//
	//The relationship candidates existed and the typed path already built rows
	//from them, but the empty state only reached them through the spotlight
	//branch below, which requires no recents, no refinements AND no filters —
	//a state almost nobody is in. So the one suggestion that depends on where
	//the user actually is was the one the opening list never offered, and it
	//could only be found by typing a phrase you would have to already know.
	//
	//ONE row, not the family of three: the other two (links out, links in) are
	//narrower cases of it, and the empty list is a budget of six to eight rows
	//that recents and refinements have prior claims on. Its count arrives
	//through the ordinary preview machinery, which keys on the row's id and so
	//needs nothing new here.
	//BUILT HERE, UNSHIFTED AT THE END. It must not be in `refinements` while the
	//spotlight branch below tests `!refinements.length`: that guard is what
	//keeps the tag/section spotlights to the genuinely bare state, and counting
	//this row against it silently deleted them for every user with a card open.
	const activeCardCandidate = (context.candidates || []).find(candidate => candidate.filter.startsWith('direct-connections/+'));
	const activeCardDestination = activeCardCandidate && !current.filters.includes(activeCardCandidate.filter) ?
		activeCardCandidate :
		undefined;
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
	refinements.push(...removalSuggestions(current, filterLabels, context.cardNames || {}));
	//Teach the coherent outgoing/incoming/either-direction family only when it
	//will not displace recents, selection, or removal actions. In denser states
	//the same candidates remain discoverable by typing.
	if (!recents.length && !refinements.length && !current.filters.length) {
		//The active-card destination is added unconditionally below, so it does
		//not spend one of these three slots on a row that is coming anyway.
		for (const candidate of (context.candidates || []).filter(candidate => candidate.spotlight && candidate.filter !== activeCardDestination?.filter).slice(0, 3)) {
			const name = collectionFilterDisplayName(candidate.filter, filterLabels);
			refinements.push({
				id: `candidate:${candidate.category}:${candidate.filter}`,
				kind: 'add',
				action: 'add',
				name,
				label: verbLabel('add', name),
				detail: `${candidate.detail} · ${candidateURLNote(candidate.filter, name, candidate.urlDetail)}`,
				description: collectionDescriptionWithFilterAppended(current, candidate.filter),
				viewerDependent: filterNameIsViewerDependent(candidate.filter),
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
			viewerDependent: filterNameIsViewerDependent(filter),
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
	//After recents, before every generic refinement. It is the one row on this
	//list that is about where the user actually is, which is the whole premise
	//of §"Begin from where the user is".
	if (activeCardDestination) {
		const name = collectionFilterDisplayName(activeCardDestination.filter, filterLabels, context.cardNames || {});
		refinements.unshift({
			id: `candidate:${activeCardDestination.category}:${activeCardDestination.filter}`,
			kind: 'add',
			action: 'add',
			name,
			label: verbLabel('add', name),
			detail: `${activeCardDestination.detail} · ${candidateURLNote(activeCardDestination.filter, name, activeCardDestination.urlDetail)}`,
			description: collectionDescriptionWithFilterAppended(current, activeCardDestination.filter),
			viewerDependent: filterNameIsViewerDependent(activeCardDestination.filter),
		});
	}
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
export const dedupedByDestination = (
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
		//THE CURATED SYNONYMS ARE A RANKING INPUT HERE TOO, not only in the new
		//completion index. Proposal C's flow ③ ("aliases catch 'pub'") and the
		//meta-proposal's convergence 5 both describe the same behavior for the
		//typed list this function already feeds, and a word that finds a family
		//in the palette but not in this list would be a synonym that works in one
		//half of the app.
		.map(name => ({
			name,
			detail: collectionFilterDescription(name, filterDescriptions, filterLabels),
			synonyms: filterSynonyms(name),
		}))
		.filter(({name, detail, synonyms}) =>
			name.toLowerCase().includes(normalizedQuery) ||
			detail.toLowerCase().includes(normalizedQuery) ||
			synonyms.some(synonym => synonym.startsWith(normalizedQuery))
		)
		.map(({name, detail, synonyms}) => {
			const relevance = (() => {
				const normalizedName = name.toLowerCase();
				if (normalizedName === normalizedQuery) return 0;
				if (normalizedName.startsWith(normalizedQuery)) return 1;
				if (normalizedName.includes(normalizedQuery)) return 2;
				//A synonym match sits between the name and the description prose:
				//it is a word somebody chose to mean this filter, which the
				//description's incidental wording is not.
				if (synonyms.some(synonym => synonym === normalizedQuery)) return 2;
				if (synonyms.some(synonym => synonym.startsWith(normalizedQuery))) return 3;
				if (detail.toLowerCase().startsWith(normalizedQuery)) return 4;
				return 5;
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
				detail: `${candidate.detail} · ${candidateURLNote(candidate.filter, name, candidate.urlDetail)}`,
				description: collectionDescriptionWithFilterAppended(current, candidate.filter),
				viewerDependent: filterNameIsViewerDependent(candidate.filter),
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
				//Ask the clause this row would actually produce, not the family the
				//user typed: `author` defaults to `author/me`, and it is the `me`
				//that makes the destination personal.
				viewerDependent: filterNameIsViewerDependent(filter),
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
		//SAY THAT IT MATCHES PARTIALLY. filters.ts's own description for this
		//family — 'Selects cards that contain text that at least partially
		//matches a provided query' — reaches the catalog, but this row overrode
		//it with a sentence about the mechanism ('adds a text-query clause')
		//that says nothing about what the clause will DO. Meanwhile the chip
		//reads `Text contains “systems thinking”`, which sounds like a promise
		//that both words appear together. The row is where the user decides, so
		//it is where the qualification belongs.
		detail: 'Keeps cards whose text matches this query, including cards matching only some of its words',
		description: queryDescription,
	});

	return dedupedByDestination(result, current).slice(0, 8);
};

//THE COLLECTION, AS ONE LINE OF PROSE — and it is the SAME line the sentence
//renderer draws on screen, word for word.
//
//The clauses used to be joined with ' AND ', which is the one register the
//composer promises never to use outside Source: the drawer's own sentence says
//"Main · Tagged tag-1", the commit snackbar said "Main AND (Tag 2 OR Tag 1)",
//and a user comparing the two had no way to know they named the same
//collection. The interpunct is what the sentence already uses for the same
//conjunction, and it cannot be confused with the lowercase 'or' inside a group
//the way a second English conjunction would be ("Main and Tagged tag-2 or
//Tagged tag-1" has two readings; "Main · Tagged tag-2 or Tagged tag-1" has
//one).
//
//The clause NAMES come from collectionFilterDisplayName, which now reads the
//boolean spellings too, so every surface that renders an expression as text —
//this, the receipts, the snackbar, the zero-card empty state, the aria strings
//— gets one spelling of one clause.
export const readableCollectionExpression = (
	description: CollectionDescription,
	filterLabels: Record<string, string> = {},
	cardNames: Record<string, string> = {}
): string => {
	const parts = collectionExpressionParts(description, filterLabels, cardNames);
	const clauses = [parts.set.label];
	clauses.push(...parts.filters.map(filter => filter.label));
	return [...clauses, ...parts.modifiers].join(' · ');
};

export type CollectionExpressionParts = {
  set: { raw: string; label: string };
  //`explanation` is non-empty only for a clause the composer cannot edit, and
  //carries the sentence that says why it is in the draft at all.
  //`viewerDependent` marks a clause whose membership is computed from the
  //signed-in account rather than from the cards, so the chip can say so.
  filters: Array<{ raw: string; label: string; index: number; explanation: string; viewerDependent: boolean }>;
  modifiers: string[];
};

//The words the app uses for personal scope, in one place, so a chip, a
//suggestion row and Source cannot each invent their own phrasing for it.
export const VIEWER_DEPENDENT_CHIP_NOTE = 'only for you';
export const VIEWER_DEPENDENT_CHIP_EXPLANATION = 'Membership depends on who is signed in; a copied link shows other people their own cards, not yours.';

export const collectionExpressionParts = (
	description: CollectionDescription,
	filterLabels: Record<string, string> = {},
	cardNames: Record<string, string> = {}
): CollectionExpressionParts => {
	const modifiers = collectionOrderPhrases(
		description.sort,
		description.sortReversed,
		description.viewMode,
		description.viewModeExtra
	);
	return {
		set: {raw: description.set, label: collectionOptionDisplayName(description.set)},
		filters: description.filters.map((raw, index) => ({raw, index, label: collectionFilterDisplayName(raw, filterLabels, cardNames), explanation: collectionFilterExplanation(raw), viewerDependent: filterNameIsViewerDependent(raw)})),
		modifiers,
	};
};

