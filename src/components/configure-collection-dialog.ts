import { html, css, PropertyValues } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { live } from 'lit/directives/live.js';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import { SITE_DOMAIN } from '../config.GENERATED.SECRET.js';

import {
	registerShortcut,
	shortcutKeys,
	DIALOG_SHORTCUT_PRIORITY,
	SHORTCUT_COMBOS
} from '../shortcuts.js';

import {
	selectConfigureCollectionDialogOpen,
	selectConfigureCollectionDialogMode,
	selectConfigureCollectionDialogFocusRequest,
	selectFilterDescriptions,
	selectCollectionComposerCandidates,
	selectAuthorAndCollaboratorUserIDs,
	selectAuthorsForTagList,
	selectTagInfosForCards,
	selectSnapshotCollectionDescription,
	selectActiveCollectionDescription,
	selectTags,
	selectCardsSelected,
	selectUid,
	selectActiveCardID,
	selectRequestedCard,
	selectActiveCard,
	selectAnyDialogOpenExceptCollectionComposer,
	selectCards,
	selectCollectionConstructorArguments,
	selectDefaultCollectionDescription,
	selectKnownCollectionFilterNames,
	selectPageExtra,
	getIdForCard,
} from '../selectors.js';

import {
	askForPathToNavigateTo,
	cancelConfigureCollectionDialog,
	closeConfigureCollectionDialog,
	openConfigureCollectionDialog,
	navigatePathToResult,
	showSnackbar,
} from '../actions/app.js';

import {
	PLACEHOLDER_CARD_ID_CHARACTER,
	resolveCardSelector,
	updateCollectionConfigurationSnapshot,
} from '../actions/collection.js';

import {
	collectionDescriptionWithSet,
	collectionDescriptionWithSort,
	collectionDescriptionWithSortReversed,
	collectionDescriptionWithViewMode,
	collectionDescriptionWithFilterRemoved,
	collectionDescriptionWithFilterModified,
	collectionDescriptionWithFilterAppended,
	collectionURLPath,
	COLLECTION_URL_PREFIX,
	CollectionDescription
} from '../collection_description.js';

import {
	SET_INFOS,
	SORTS,
	ALL_FILTER_NAME,
	LEGAL_VIEW_MODES,
	filterNamesAreViewerDependent,
} from '../filters.js';

import {
	LINK_ICON,
	OPEN_IN_BROWSER_ICON,
	PLUS_ICON
} from '../../shared/icons.js';

import './configure-collection-filter.js';

import './collection-sentence.js';
import './collection-pill-row.js';

import './loading-placeholder.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	help,
	HelpStyles,
} from './help-badges.js';

import { ScrollingSharedStyles } from './scrolling-shared-styles.js';

import {
	SetName,
	SortName,
	ViewMode,
} from '../../shared/types.js';

import {
	TagInfos,
	State,
	Uid,
	ProcessedCard,
} from '../types.js';

import {
	CollectionConditionEvent,
	ExpressionModifiedEvent,
	FilterModifiedEvent
} from '../events.js';

import {
	collectionComposerEnabled,
	collectionComposerPreviewEnabled,
} from '../collection-composer-mode.js';

import {
	corpusWorkerRunCollection,
} from '../corpus-bridge.js';

import {
	cardIDIsPlaceholder,
	commitPathDroppingLostCard,
} from '../collection-navigation.js';

import {
	formatCollectionCardCount,
	startCollectionComposerPreviews,
} from '../collection-composer-preview.js';

import {
	CollectionComposerSuggestion,
	CollectionComposerCandidate,
	activeCardMetadataCandidates,
	activeCardRelationshipCandidates,
	collectionDraftReceipt,
	collectionExpressionParts,
	collectionFilterDisplayName,
	collectionFilterLabels,
	collectionOptionDisplayName,
	rankedComposerSuggestions,
	readableCollectionExpression,
} from '../collection-composer-suggestions.js';

import {
	collectionLinkCopiedMessage,
	COLLECTION_LINK_COPY_FAILED_MESSAGE,
} from '../collection-link-copy.js';

import {
	readRememberedCollections,
	RememberedCollectionEntry,
} from '../collection-composer-history.js';

import {
	memoize,
} from '../memoize.js';

//The receipt and its Undo now live in collection-navigation-receipt.ts: the
//drawer sentence's pills navigate too, and one navigation reported two ways by
//two surfaces is the drift the receipt exists to prevent. Re-exported here so
//the ids stay importable from where they were first published.
export {
	COLLECTION_NAVIGATION_RECEIPT_DEDUPE_KEY,
	UNDO_COLLECTION_NAVIGATION_ACTION_ID,
} from '../collection-navigation-receipt.js';

import {
	showCollectionNavigationReceipt,
} from '../collection-navigation-receipt.js';

import {
	parseCollectionSource,
	CollectionSourceExpectedKind,
	ParsedCollectionSource,
} from '../collection-source.js';

import {
	buildCollectionFilterCatalog,
	CollectionFilterCatalogItem,
} from '../collection-filter-catalog.js';

import {
	CollectionExpression,
	FilterExpressionNode,
	collectionDescriptionWithExpression,
	collectionExpressionForDescription,
	serializeFilterNode,
	withConditionAppended,
	withConditionRemoved,
	withMemberNegationToggled,
	withMemberRemoved,
	withNegationToggled,
} from '../collection-expression.js';

import {
	CollectionSentencePath,
} from './collection-sentence.js';

import {
	PILL_ROW_KEY_HINTS,
	pillRowSpellingFor,
} from './collection-pill-row.js';

import {
	CollectionCompletionContext,
	collectionCompletionCandidates,
	collectionCompletionIdleRows,
	CompletionCandidate,
	defaultConfigurableFilter,
} from '../collection-completion-index.js';

import {
	PaletteRow,
	frozenPaletteOrder,
	paletteBrowseRows,
	paletteIdleRows,
	paletteOrScopedRows,
	paletteOrderKey,
	paletteTypingRows,
	paletteWordRows,
	PaletteWordScope,
	RECENT_SECTION,
} from '../collection-palette-rows.js';

//The two lists that are painted by the .row rules. Naming them means the
//pointer rule below is written once rather than twice.
type ComposerRowList = 'palette' | 'source-completion';

const ALREADY_ACTIVE_MESSAGE = 'This collection is already open.';

//Sentence case, honest about the reason, and it names what the key the user
//actually has does instead (HS-2.3, §3.5: a refusal reports and offers the
//next move). U+2019 apostrophe (§2.2).
const NEW_TAB_UNSUPPORTED_NOTE = 'Opening in a new tab isn’t supported — Enter opens here.';

//A keystroke that has already been spent on a commit.
//
//The composer has two commit handlers — one per mode — and they are mutually
//exclusive by mode. That is not enough on its own: a commit flips the mode
//SYNCHRONOUSLY (cancelConfigureCollectionDialog runs stateChanged before it
//returns), so an Enter that reaches the second handler after the first has
//acted finds exactly the mode that handler wants and commits again. The live
//review caught the result: one Enter in Source mode pushed the source's
//destination AND then opened the quick composer's first recents row, leaving a
//receipt that named a collection the user never chose.
//
//The EVENT is the only identity a commit cannot change under us, so that is
//what the single-flight is keyed on. A WeakSet keeps no keystroke alive.
const committedKeystrokes = new WeakSet<KeyboardEvent>();

//A collection path is one line. Enter in the source textarea is spoken for —
//_handleSourceKeyDown prevents the default and commits — so a line break that
//reaches the INPUT handler arrived by a route that never passed that guard: a
//paste, a drop, an injected insertion. Every one of those means "the text I
//brought with me", not "commit".
const SOURCE_LINE_BREAKS = /[\r\n]+/g;

//How many distinct collections' counts one composer session remembers. Every
//keystroke can name a few new ones; this is generous for a session and small
//enough to be free.
const RETAINED_PREVIEW_COUNT_LIMIT = 120;

//Stable stand-ins for the not-yet-populated cases. A fresh `{}` or a fresh
//CollectionDescription every render would give the memos below a new cache key
//each time and defeat them entirely.
const EMPTY_FILTER_DESCRIPTIONS : {[filterName : string]: string} = {};
const EMPTY_COLLECTION_DESCRIPTION = new CollectionDescription();
const EMPTY_TAG_INFOS : TagInfos = {};

//HOW MANY MEANINGS ONE TYPED WORD IS ALLOWED TO PRODUCE.
//
//A candidate becomes up to three rows (add, or, not), and the index offers
//eight candidates by default — twenty-four rows for one keystroke, in a list
//whose whole design premise is that there is one of it and it is short. Six
//candidates is what fits the palette's own measure; twelve rows is the cap on
//what the flattening produces from them, and because the flattening preserves
//the engine's own ranking the rows it drops are the ones the engine already
//ranked last.
const TYPING_CANDIDATE_LIMIT = 6;
const TYPING_ROW_LIMIT = 12;

//A destination row renders as a miniature sentence, which needs the expression
//behind its description. Keyed on the description's identity — the recents
//list hands back the same objects until storage changes — so a list of rows
//parses each of its collections once rather than once per render. A WeakMap
//rather than the shared memoize() because there are as many of these as there
//are rows, and memoize's cache is two deep.
const rowExpressions = new WeakMap<CollectionDescription, CollectionExpression>();

const expressionForDescription = (description : CollectionDescription) : CollectionExpression => {
	const known = rowExpressions.get(description);
	if (known) return known;
	const expression = collectionExpressionForDescription(description);
	rowExpressions.set(description, expression);
	return expression;
};

//Four pure derivations that every render of the composer asks for, several of
//them more than once per render, and all of which used to recompute from
//scratch on every keystroke — measured at 1.4ms (source parse), 1.0ms (filter
//catalog) and 0.74ms (suggestions) per call, up to five calls per character.
//They are memoized here rather than on the instance so the cache key is the
//arguments, which is what actually decides whether the answer can change; the
//codebase's own memoize() compares argument tuples by identity, so each of
//these takes only values whose identity is already stable (Redux selector
//results, strings, and the outputs of the memos above it).
const composerCandidatesFor = memoize((activeCard : ProcessedCard | null, composerCandidates : CollectionComposerCandidate[], activeCardID : string) : CollectionComposerCandidate[] => {
	const activeMetadata = activeCardMetadataCandidates(activeCard ? {
		section: activeCard.section,
		tags: activeCard.tags,
		cardType: activeCard.card_type,
		contributors: [activeCard.author, ...activeCard.collaborators],
	} : null, composerCandidates);
	const contextualFilters = new Set(activeMetadata.map(candidate => candidate.filter));
	return [
		...activeMetadata,
		...composerCandidates.filter(candidate => !contextualFilters.has(candidate.filter)),
		...activeCardRelationshipCandidates(activeCardID),
	];
}, 2) as (activeCard : ProcessedCard | null, composerCandidates : CollectionComposerCandidate[], activeCardID : string) => CollectionComposerCandidate[];

const composerFilterLabelsFor = memoize((candidates : CollectionComposerCandidate[]) : Record<string, string> =>
	collectionFilterLabels(candidates), 2) as (candidates : CollectionComposerCandidate[]) => Record<string, string>;

//The tag-info map, flattened to the id → title shape the clause namer wants.
//Memoized on the map's identity, which is a selector result and so is stable
//until a card's name or title actually changes — this runs once per render of
//a list whose every row may ask for it.
const composerCardNamesFor = memoize((cardTagInfos : TagInfos) : Record<string, string> =>
	Object.fromEntries(Object.entries(cardTagInfos || {}).map(entry => [entry[0], entry[1].title])), 2) as (cardTagInfos : TagInfos) => Record<string, string>;

const parsedSourceFor = memoize((
	sourceInput : string,
	candidates : CollectionComposerCandidate[],
	filterDescriptions : {[filterName : string]: string},
	preservedSelectedCard : string
) : ParsedCollectionSource => parseCollectionSource(sourceInput, {
	ordinaryFilters: new Set(Object.keys(filterDescriptions || {})),
	filterDescriptions,
	suggestedFilters: candidates.map(candidate => candidate.filter),
	filterSearchValues: Object.fromEntries(candidates.map(candidate => [candidate.filter, [candidate.label, candidate.category, ...(candidate.aliases || [])]])),
	preservedSelectedCard,
	allowedOrigins: COMPOSER_ALLOWED_ORIGINS,
}), 2) as (sourceInput : string, candidates : CollectionComposerCandidate[], filterDescriptions : {[filterName : string]: string}, preservedSelectedCard : string) => ParsedCollectionSource;

//BROWSE ALL IS THE CATALOG'S DATA WITHOUT THE CATALOG'S SURFACE. The module
//still answers "every filter family, grouped, with a one-line description", which
//is exactly what the surviving quiet link seeds the one list with. What died is
//the wall it used to be rendered as: the setup strip, the category caps, the
//per-row examples and the Not toggles. Polarity is passed empty because the Not
//toggle is gone — flipping is a verb on a pill now, not a control on a row.
const NO_CATALOG_POLARITY : Readonly<Record<string, string>> = {};

const browseItemsFor = memoize((
	filterDescriptions : {[filterName : string]: string},
	candidates : CollectionComposerCandidate[],
	draft : CollectionDescription,
	query : string
) : CollectionFilterCatalogItem[] => buildCollectionFilterCatalog(filterDescriptions, candidates, draft, query, NO_CATALOG_POLARITY), 2) as (
	filterDescriptions : {[filterName : string]: string},
	candidates : CollectionComposerCandidate[],
	draft : CollectionDescription,
	query : string
) => CollectionFilterCatalogItem[];

//THE DRAFT IS A DESCRIPTION; THE EXPRESSION IS A VIEW OF IT. Keeping the tree
//as a second source of truth would mean two things to keep in step across
//undo, source round-trips and draft preservation — all of which already work on
//the description. Memoized on the description's identity so the sentence, the
//pill row and the completion index are all handed the SAME array and Lit's
//dirty check can do its job.
const draftExpressionFor = memoize((description : CollectionDescription) : CollectionExpression =>
	collectionExpressionForDescription(description), 2) as (description : CollectionDescription) => CollectionExpression;

//Everything the completion index needs, assembled once per render rather than
//once per call. Its identity is the memo key for both calls below, which is what
//keeps a keystroke from rebuilding the index's whole world twice.
const completionContextFor = memoize((
	candidates : CollectionComposerCandidate[],
	cardNames : Record<string, string>,
	filterDescriptions : {[filterName : string]: string},
	tagInfos : TagInfos,
	recentCollections : RecentComposerCollection[],
	activeCollection : CollectionDescription | undefined,
	previousCollection : string | undefined,
	preservedSelectedCard : string,
	cardsSelected : boolean
) : CollectionCompletionContext => ({
	candidates,
	cardNames,
	filterDescriptions,
	tagInfos,
	recentCollections,
	activeCollection,
	previousCollection,
	preservedSelectedCard,
	cardsSelected,
	sourceAllowedOrigins: COMPOSER_ALLOWED_ORIGINS,
}), 2) as (
	candidates : CollectionComposerCandidate[],
	cardNames : Record<string, string>,
	filterDescriptions : {[filterName : string]: string},
	tagInfos : TagInfos,
	recentCollections : RecentComposerCollection[],
	activeCollection : CollectionDescription | undefined,
	previousCollection : string | undefined,
	preservedSelectedCard : string,
	cardsSelected : boolean
) => CollectionCompletionContext;

const idleRowsFor = memoize((
	description : CollectionDescription,
	context : CollectionCompletionContext
) => collectionCompletionIdleRows(description, context), 2) as (
	description : CollectionDescription,
	context : CollectionCompletionContext
) => ReturnType<typeof collectionCompletionIdleRows>;

const completionCandidatesFor = memoize((
	token : string,
	expression : CollectionExpression,
	description : CollectionDescription,
	context : CollectionCompletionContext,
	limit : number
) : CompletionCandidate[] => collectionCompletionCandidates({token, expression, description, context, limit}), 2) as (
	token : string,
	expression : CollectionExpression,
	description : CollectionDescription,
	context : CollectionCompletionContext,
	limit : number
) => CompletionCandidate[];

type RecentComposerCollection = {description : CollectionDescription, visits : number, frequent? : boolean, relative? : boolean};

//The remembered list already has a stable identity while storage is unchanged,
//so deserializing it into descriptions can key on that identity.
const recentCollectionsFor = memoize((remembered : RememberedCollectionEntry[]) : RecentComposerCollection[] =>
	remembered.map(entry => ({
		description: CollectionDescription.deserialize(entry.authoring),
		visits: entry.visits,
		frequent: entry.frequent,
		relative: entry.relative,
	})), 2) as (remembered : RememberedCollectionEntry[]) => RecentComposerCollection[];

//The ranking and the frozen-order reshuffle are the last two steps of the same
//per-keystroke derivation, so they are memoized on the same terms the list
//itself is: the row set, and the counts that may reorder it.
const rankedSuggestionsFor = memoize((suggestions : CollectionComposerSuggestion[], previewCounts : {[suggestionID : string]: number}) : CollectionComposerSuggestion[] =>
	rankedComposerSuggestions(suggestions, previewCounts), 2) as (suggestions : CollectionComposerSuggestion[], previewCounts : {[suggestionID : string]: number}) => CollectionComposerSuggestion[];

//Which origins a pasted collection URL may come from. Always the origin this
//client is running on; plus this deployment's own public domain, which is
//configuration (SITE_DOMAIN), not a literal. It was hardcoded to
//thecompendium.cards in two places, so every other deployment of this app
//trusted somebody else's site and not its production self. A deployment that
//sets no site_domain simply trusts same-origin only.
//
//Computed once, at module scope: it is an input to the parse on every
//keystroke, and a fresh Set each time would defeat memoizing that parse.
const COMPOSER_ALLOWED_ORIGINS : ReadonlySet<string> = new Set([
	...(typeof window === 'undefined' ? [] : [window.location.origin]),
	...(SITE_DOMAIN ? [`https://${SITE_DOMAIN}`] : []),
]);

//HS-1.3 is a MUST and D1 is the app's worst terminology defect: nothing in
//the product has ever said what a collection IS, while the editor calls tags
//collections and the info panel calls a section one. §1.3 names this dialog as
//the natural home and gives the exact sentence; it appears wherever the dialog
//first shows the user their collection, in all three of its modes.
const COLLECTION_HELP = 'A collection is a set of cards you can link to.';

//SENTENCE CASE, IN THE DOM AND NOT ONLY ON THE SCREEN (HS-2.1).
//
//The row action chips were lowercase text painted ALL-CAPS by
//text-transform, which §2.1 reserves for nothing: these are action labels, so
//they are sentence case. text-transform never changed textContent, so the
//accessible name and the visible word disagreed for the whole life of the
//control — a screen reader said "add" while the screen said "ADD".
const sentenceCase = (value : string) : string => value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

//WHAT A ROW COSTS YOU, in one word the eye can sort on. Only Source mode's
//completion list still wears this as a chip: the palette's verb chips are
//deleted outright (the section heading carries the grammar, and a navigating row
//under a typing list gets the one OPEN_IN_BROWSER glyph), but the source
//completions are a different list with a different grammar — 'add' and
//'complete' are not distinguishable from the token itself — and source mode is
//kept as it was.
const rowConsequence = (verb : string) : 'navigate' | 'transform' => verb === 'open' ? 'navigate' : 'transform';

//The spec's own words for a draft that resolves to nothing. A sentence-case
//fragment with no terminal period (HS-2.6): it states what is absent, and the
//recovery rows underneath are the offer.
const NO_CARDS_MATCH_NOTE = 'No cards currently match';

@customElement('configure-collection-dialog')
class ConfigureCollectionDialog extends connect(store)(DialogElement) {

	@state()
		_collectionDescription: CollectionDescription;

	//The collection actually on screen. _collectionDescription is the draft,
	//which diverges from this as soon as the user edits it.
	@state()
		_activeCollectionDescription: CollectionDescription | null = null;

	@state()
		_filterDescriptions: {[filterName : string]: string};

	//Every filter name resolvable right now, or an empty set while sections and
	//tags are still loading. Recents are read against it, so an entry naming a
	//filter this app has no definition for is not offered as a destination.
	@state()
		_knownFilterNames : ReadonlySet<string> = new Set<string>();

	@state()
		_composerCandidates: CollectionComposerCandidate[] = [];

	@state()
		_activeCard : ProcessedCard | null = null;

	@state()
		_userIDs: Uid[];

	@state()
		_userInfos: TagInfos;

	@state()
		_cardTagInfos: TagInfos;

	//The REAL colours, and the authored prose behind a tag. The sentence paints a
	//value pill in the colour its tag already has everywhere else in the app, and
	//the completion index matches a typed word against a tag's own description —
	//both from here. _cardTagInfos is a different map for a different job (naming
	//the CARD a clause is anchored to) and the two must not be confused.
	@state()
		_tagInfos: TagInfos = {};

	@state()
		_composerInput = '';

	@state()
		_entryMode : 'compose' | 'source' = 'compose';

	//Every request to open the composer, including the ones that arrive while
	//it is already open. Ctrl-K on an open composer changes nothing else about
	//the state, so this is what makes "focus the input again" observable.
	@state()
		_focusRequest = 0;

	@state()
		_sourceInput = '';

	@state()
		_sourceCompletionIndex = 0;

	@state()
		_sourceCompletionsDismissed = false;

	@state()
		_sourceReturnWarning = false;

	_sourceDirty = false;
	_sourceAutoDelimitedSegment = false;
	_draftSelectedCard = '';
	_requestedCard = '';
	_lastValidSource : ParsedCollectionSource | null = null;

	@state()
		_highlightedRow = 0;

	//Whether _highlightedRow currently means anything. The spec draws a
	//hard line between "Enter with a highlighted suggestion" (open that
	//destination) and "Enter with no highlighted suggestion" (open the current
	//draft). A row is highlighted only once the user has pointed at one: by
	//typing (the list is then interpretations of what they typed), by arrowing,
	//or by genuinely moving the mouse over a row. Rebuilding the list — after a
	//Tab materialization, a clause edit, or an undo — leaves nothing
	//highlighted, so the next Enter commits the draft the user just composed
	//rather than whatever happens to sit in row 0.
	@state()
		_rowHighlightActive = false;

	//mouseenter fires whenever the list re-renders under a resting cursor, which
	//would silently hand the Enter target to whichever row happened to land
	//under the pointer. Pointer highlighting is armed only by a real mousemove
	//and disarmed again by the next keystroke.
	//
	//REACTIVE, because it is also what decides whether hover PAINTS. While the
	//keyboard owns the highlight, a hovered row that is not the highlighted one
	//is a second row reading as selected — and the spec's MUST is that "the
	//transformation accepted on keydown is the one visibly highlighted on
	//keydown". updated() mirrors it onto the host so one CSS rule gates every
	//list's hover on it.
	@state()
		_pointerHighlightArmed = false;

	//The legacy builder's own expansion, for the composer-off path only. The
	//composer's clause editor is the pill row now, and it is opened by selecting
	//a pill rather than by a toggle.
	@state()
		_builderExpanded = false;

	//"BROWSE ALL FILTERS" IS A FEED, NOT A PLACE. The catalog mode is gone: this
	//seeds the SAME list with every family under the same headings, and Escape
	//peels it like any other layer.
	@state()
		_browseOpen = false;

	//Which sentence word the list is currently showing alternatives for, when
	//the user clicked one. '' the rest of the time.
	@state()
		_wordScope : PaletteWordScope | '' = '';

	//THE OR-SCOPED INPUT. The pill row's "or…" is a request — it knows which
	//token an alternative would join and not what the alternative is — so the
	//palette answers by scoping the input to that condition: every row is now an
	//alternative joining it.
	@state()
		_orTarget : {index : number, memberIndex : number} | null = null;

	@state()
		_cardsSelected = false;

	@state()
		_userScope = '';

	@state()
		_previewCounts: {[suggestionID : string]: number} = {};

	//Whether the DRAFT's own count is still being computed. Every other count
	//is decoration on a row; this one drives the primary button's label, and
	//"we don't know yet" and "there is nothing to say" are different facts
	//(HS-3.6) that both used to render as a bare "Open this collection".
	@state()
		_draftCountPending = false;

	//Counts keyed by the collection they counted, not by the suggestion that
	//happened to name it. _refreshPreviewCounts used to blank every count and
	//re-enqueue on every keystroke, so each character erased counts that were
	//still correct for ~150ms of debounce plus a worker round trip — and the
	//primary button flipped between "Open this collection" and "Open 1307
	//cards" while the draft it describes had not changed at all.
	//
	//Deliberately NOT kept past the composer session: the preview module does
	//not cache completed results because corpus membership can change under it,
	//and this cache accepts that same risk only for as long as one composer is
	//open, where the alternative is measurably worse.
	_retainedPreviewCounts = new Map<string, number>();

	@state()
		_activeCardID = '';

	@state()
		_activationPending = false;

	@state()
		_activationMessage = '';

	//A note about a KEY, not about the collection: it explains a modifier the
	//composer deliberately does nothing with, so it lives beside the key hints
	//rather than in the activation line, which is reserved for what did or did
	//not happen to a navigation.
	@state()
		_modifierNote = '';

	_newTabNoteShown = false;

	//WHICH TOKEN OF THE SENTENCE IS SELECTED, in the sentence's own address:
	//[] for nothing, [index] for a condition or a group's edge, [index, member]
	//for one alternative inside a group. Controlled, because this dialog is what
	//shows the pill row for it — the sentence reports gestures and does not
	//decide.
	@state()
		_selectedPath : CollectionSentencePath = [];

	@state()
		_draftReceiptMessage = '';

	//The typed text of a draft that was closed without being committed, and the
	//collection it was an adjustment to. Not @state: nothing renders from them
	//directly, and they are read once, on the next open.
	_preservedComposerInput = '';
	_preservedDraftBase = '';

	@state()
		_clauseSelectionMessage = '';

	//The order the list was last ranked in, keyed by the identity of the rows it
	//ranked. Deliberately not @state: it is a memo of a render, not an input to
	//one.
	_paletteOrder : {key : string, order : string[]} | null = null;

	_draftUndoDescription : CollectionDescription | null = null;
	_draftUndoSelectedCard : string | null = null;
	_cancelPreviews : (() => void) | null = null;
	readonly _draftPreviewID = 'current-draft-preview';
	//THE SECOND OF THE PILL ROW'S TWO COUNT ROLES. "Draft now matches N" is the
	//draft's own count — the same fact the footer states, asked once — and "without
	//this pill: N" is a different collection, so it is a different preview. There
	//is no third: a clause being edited is already IN the draft, so the draft's
	//count IS the count of the editor's current values, and counting it twice
	//would be two names for one number.
	readonly _withoutPreviewID = 'without-pill-preview';

	static override styles = [
		...DialogElement.styles,
		ButtonSharedStyles,
		HelpStyles,
		//The two nested panes below (the suggestion listbox and the filter
		//catalog) are deliberate inner scrollers with their own max-height,
		//which is the case the #759 convention reserves the shared .scroller
		//class for — the dialog body itself still scrolls through
		//DialogElement #inner.
		ScrollingSharedStyles,
		css`
			/* A LIGHT PALETTE, NOT A WORKSPACE.
			   The composer used to be pinned to 90% of the viewport's height
			   and 64em wide because it contained seven things — a setup strip,
			   a catalog wall, two editor panels, two lists and a footer — and
			   every one of them was competing for the same column. It contains
			   four now: the sentence, the input, ONE list and the footer
			   (03-proposal-c-grow-it-native.md §2b). A box that tall around
			   that little content is a room with the furniture pushed to the
			   walls, so the height goes back to the base .content's own
			   content-sizing, with a cap so a long list scrolls rather than
			   growing the dialog off the screen.

			   THE WIDTH IS STILL PINNED, and for the reason it always was: the
			   base rule sizes .content to its content between 40% and 70%, and
			   .background centres it, so a list changing under typing moved the
			   left edge of the field being typed into. All three of
			   width/min-width/max-width take the same value so the percentages
			   cannot re-enter. 44em is the palette's own measure — wide enough
			   for a sentence of pills and a right-aligned count, narrow enough
			   that a one-line row reads as a line rather than as a table. */
			.content {
				--composer-width: min(44em, 92vw);
				max-height: 80vh;
				width: var(--composer-width);
				min-width: var(--composer-width);
				max-width: var(--composer-width);
			}

			/* Mobile is full-screen (.mobile .content in DialogElement wins on
			   specificity for width/height/max-width); min-width is the one
			   the base rule leaves for us to clear. */
			.mobile .content {
				min-width: 0;
			}

			.row {
				display: flex;
				flex-direction: row;
				justify-content: space-between;
			}

			.row > div {
				display: flex;
				flex-direction: column;
			}

			.mobile .row {
				flex-wrap: wrap;
				gap: 0.75em;
			}

			.mobile .row > div {
				flex: 1 1 8em;
				min-width: 0;
			}

			/* THE SENTENCE IS THE FIRST THING UNDER THE TITLE, and it is prose,
			   not a form row. collection-sentence renders inline so its pills
			   wrap like words; this block is only the space around it and the
			   help badge that rides at its end. */
			.sentence {
				color: var(--app-dark-text-color);
				font-size: 1.05em;
				line-height: 1.8;
				overflow-wrap: anywhere;
				padding: 0.75em 0 0.5em;
			}

			/* HelpStyles sizes the badge at 1.3em of whatever it sits in, which
			   suits a 0.75em form label. The sentence runs at 1.05em, where
			   that would make the badge the largest glyph in the dialog. */
			.sentence .help svg {
				height: 1em;
				width: 1em;
			}

			/* The word the sentence declines to say at its defaults. Subordinate
			   in colour and size, like the tail it stands in for, and built on
			   button.small rather than a fourth button system. */
			.order-word-operator {
				color: var(--app-dark-text-color-light);
				font-size: 0.85em;
			}

			button.small.verb.order-word {
				color: var(--app-dark-text-color-light);
				font-size: 0.85em;
				min-height: 0;
				vertical-align: baseline;
			}

			button.small.verb.order-word:hover {
				text-decoration: underline;
			}

			/* §4.2's 44px floor on a touch layout, where a row is the target. */
			.mobile .palette-row button {
				min-height: 44px;
			}

			.mobile .order-word {
				min-height: 44px;
			}

			/* THE PILL ROW IS ATTACHED TO THE SENTENCE, always directly under
			   it, because the whole argument for a one-line editor is that
			   everything you can do to a clause appears at the place you see it
			   (03-proposal-c §2b). It cannot squash — it is one row — so unlike
			   the anchored panels it replaced it needs no bound, no inner
			   scroller and no floor to steal from the list. */
			.pill-row {
				border-left: 3px solid var(--app-primary-color);
				margin-bottom: 0.5em;
				padding-left: 0.6em;
			}

			/* THE INPUT IS FIND-DIALOG'S #query, IN THIS DIALOG.
			   Borderless with a bottom rule, full width, and the placeholder
			   continuing the sentence above it. It is a block of its own rather
			   than an item flexed in beside the last chip, because the sentence
			   is now a real sentence that wraps: an input that tried to sit on
			   the same line as its last pill either got 8em of a wrapped line or
			   pushed the pill off it. */
			.composer-input {
				border: 0;
				border-bottom: 1px solid var(--app-dark-text-color);
				box-sizing: border-box;
				display: block;
				font: inherit;
				padding: 0.6em 0.2em;
				width: 100%;
			}

			.composer-input:focus {
				border-bottom-color: var(--app-primary-color);
			}

			/* INSET, not offset. The input flexes to exactly the width of
			   #inner, which is the dialog's scroll container, so an outline
			   drawn 2px OUTSIDE it fell in the overflow on both sides and was
			   clipped: the ring rendered as two disconnected purple bars above
			   and below the field, which reads as a rendering fault rather
			   than as focus. Drawn 2px inside its own box it is one
			   rectangle, and it cannot be clipped by anything. */
			.composer-input:focus-visible {
				border-bottom-color: transparent;
				outline: 2px solid var(--app-primary-color);
				outline-offset: -2px;
			}

			/* A RECEIPT IS A THING, SO IT NEEDS AN EDGE.
			   This strip floated between the input and the suggestion list with
			   no container of its own, so "Added Starred · Undo" read as loose
			   text that had come adrift — and it sat hard against the top of the
			   list, where the fade clips the first row, so the two collided.
			   A wash and a rule of its own space give it a boundary; the tokens
			   are the same two the clause chips and the divider already use.
			   The colour also steps up from --app-dark-text-color-light, which
			   is ~2.3:1 on white and which this file has already rejected once
			   for text that has to be read (see the loading-placeholder note
			   below). A receipt is precisely that: it is the only record of what
			   the last keystroke did to the draft. */
			.draft-receipt {
				align-items: center;
				background: var(--app-primary-color-light-very-transparent);
				border-left: 3px solid var(--app-divider-color);
				color: var(--app-dark-text-color-darker);
				display: flex;
				font-size: 0.82em;
				gap: 0.5em;
				margin: 0.4em 0;
				padding: 0.3em 0.6em;
			}

			/* THE COMPOSER'S TEXT VERB — one rule, replacing three near-identical
			   local repaints (.draft-receipt button, .builder-toggle
			   button.small, .mode-actions button.small) and, more usefully,
			   five omissions. ButtonSharedStyles' base button is
			   --app-light-text-color on --app-dark-text-color, and .small clears
			   only the BACKGROUND — so "Copy link", "Keep editing", "Return to
			   last valid collection", "Done editing", "Cancel" and the catalog's
			   "Show N more" were white text on the dialog's white surface. That
			   is not a cosmetic gap; those buttons were invisible.

			   Deliberately NOT button.text: §4.2's named text variant is the
			   FILLED purple block for banners and gates — card-view's empty-state
			   Refine is one, and it takes that variant. These eleven are inline
			   verbs inside a workspace. As filled blocks they would repaint the
			   dialog, which is a redesign, not a conformance fix. So this is the
			   extension §4.2 asks for when a surface genuinely needs something
			   the five variants do not cover: built ON button.small, in one
			   place, rather than a local button system. */
			button.small.verb {
				color: var(--app-primary-color);
				margin: 0;
				/* §4.2's 44px minimum; .small is 18x18 with padding: 0. */
				min-height: 44px;
			}

			/* §4.6's panel heading register: subordinate weight, subordinate
			   colour, and the words as they were written. These were the app's
			   only ALL-CAPS headings — CONTINUE, REFINE THIS COLLECTION,
			   SUGGESTED FOR THIS CARD — a fourth type register invented for one
			   dialog, and the spec writes every one of them sentence case. The
			   uppercase came from text-transform, so the DOM already said the
			   sentence-case words; only the screen disagreed. Dropping the
			   transform takes the letter-spacing with it: that spacing existed
			   to open up small caps and is noise without them. */
			.suggestion-heading {
				color: var(--app-dark-text-color-light);
				font-size: 0.78em;
				font-weight: 400;
				margin-top: 1.2em;
			}

			/* ONE LIST, and it is content-sized until it runs out of room. The
			   dialog is no longer pinned to 90% of the viewport, so a
			   flex-basis-0 list would collapse to nothing; a max-height is what
			   makes a long list scroll instead of growing the palette off the
			   screen, and it is the only bound the list needs now that there is
			   no catalog or editor panel to negotiate with. */
			.palette-list,
			.suggestions {
				list-style: none;
				margin: 0.25em 0 0;
				max-height: 40vh;
				overscroll-behavior: contain;
				padding: 0;
			}

			/* A SCROLL PANE HAS TO LOOK LIKE ONE, AND LAND ON WHOLE ROWS.
			   Both long lists take the shared .scroller treatment, which on an
			   overlay-scrollbar system is nothing at all — so a list of twelve
			   showing five gave no sign the other seven existed, and the row at
			   the boundary was cut through its own label.

			   THE BOTTOM FADE IS THE AFFORDANCE, and it is self-limiting: both
			   panes are flex: 1 1 0, so they are as tall as the dialog lets
			   them be and their content only reaches the bottom edge when there
			   is more of it than fits. A short list leaves blank space there
			   and fades nothing. currentColor rather than a colour of any kind
			   (§4.1): a mask reads the alpha channel, so the colour is
			   irrelevant and naming a token here would be inventing a meaning
			   for it.

			   SCROLL-PADDING IS WHY A ROW LANDS WHOLE. It replaces the
			   scroll-margin-top the row used to carry: the reason for the top
			   value is unchanged — scrollIntoView({block:'nearest'}) scrolls to
			   the row's own box, so the group heading above row 0 went out of
			   view on the first arrow press and never came back, taking the
			   CONTINUE label with it for the rest of the session — but the
			   bottom edge needs the same reservation, and one property on the
			   container states both without the two adding up. The bottom value
			   is the fade, so a row scrolled to never lands underneath it. */
			.palette-list,
			.suggestions {
				--composer-edge-fade: 1.5em;
				mask-image: linear-gradient(to bottom,
					currentColor calc(100% - var(--composer-edge-fade)),
					transparent 100%);
				scroll-padding-block: 2.2em var(--composer-edge-fade);
			}

			/* ONE ROW ANATOMY, and it is the whole of proposal B §2.1: one
			   label, a right-aligned quiet count, and a detail line only on
			   the highlighted row. No verb chip — the section heading carries
			   the grammar — and one navigate glyph on a destination row under
			   a typing list.

			   The count column is FIXED, not auto, and it is fixed even while
			   the counts are still being computed: that is what stops the whole
			   row re-flowing when a number lands 150ms after the row does.
			   11em holds the longest thing this cell can say ('9,999 cards →
			   9,999 cards') at this width without wrapping. */
			.palette-row,
			.suggestion {
				align-items: start;
				border-top: 1px solid var(--app-divider-color);
				display: grid;
				grid-template-columns: minmax(0, 1fr) auto;
				margin: 0;
			}

			.palette-row button,
			.suggestion button {
				background: transparent;
				/* Declared on every row, painted on one. The bar used to be
				   added by the highlighted rule alone, so the border box
				   appeared and disappeared under the highlight; now only its
				   COLOUR changes, which is also the only thing that can be
				   transitioned without moving anything. */
				border-left: 3px solid transparent;
				box-shadow: none;
				color: var(--app-dark-text-color);
				column-gap: 0.75em;
				display: grid;
				margin: 0;
				padding: 0.5em;
				padding-left: calc(0.5em - 3px);
				text-align: left;
				width: 100%;
			}

			.palette-row button {
				grid-template-columns: minmax(0, 1fr) 11em auto;
				grid-template-areas:
					'label count glyph'
					'widens count glyph'
					'detail detail detail';
			}

			/* The source completion list keeps the columns it always had,
			   including the verb chip its two modes genuinely need. */
			.suggestion button {
				grid-template-columns: minmax(0, 1fr) 5.5em;
				grid-template-areas:
					'category category'
					'label    action'
					'detail   detail';
			}

			/* HOVER PAINTS ONLY WHILE THE POINTER OWNS THE HIGHLIGHT.
			   Hover and keyboard selection used to paint the same lavender
			   fill, so with the cursor resting anywhere over the list two rows
			   read as selected and only one of them was the one Enter would
			   take. The pointer owns the highlight exactly when
			   _pointerHighlightArmed is set — a real mousemove since the last
			   keystroke — and in that state every list moves its highlight to
			   the row under the cursor, so the hovered row IS the highlighted
			   row and there is still only one. While the keyboard owns it,
			   hover paints nothing at all. */
			:host([data-pointer-armed]) .palette-row button:hover,
			:host([data-pointer-armed]) .suggestion button:hover {
				background: var(--app-primary-color-light-very-transparent);
				box-shadow: none;
			}

			/* Categorically stronger than a hover tint: the fill and the bar. */
			.palette-row button[data-highlighted],
			.suggestion button[data-highlighted] {
				background: var(--app-primary-color-light-very-transparent);
				border-left-color: var(--app-primary-color);
				box-shadow: none;
			}

			.suggestion button[data-highlighted] .suggestion-action {
				background: var(--app-primary-color);
				color: var(--app-light-text-color);
			}

			.row-label,
			.suggestion-label {
				grid-area: label;
				min-width: 0;
				overflow-wrap: anywhere;
			}

			/* WHAT AN "OR" ROW WIDENS, as the subordinate clause it is. Proposal
			   B §3.1 requires the row to be labeled with its target; the label
			   already reads "<target> or <new>", so this says which half of that
			   sentence was already there. */
			.row-widens {
				color: var(--app-dark-text-color-light);
				font-size: 0.75em;
				grid-area: widens;
			}

			.row-detail,
			.suggestion-detail,
			.key-hints,
			.no-suggestions {
				color: var(--app-dark-text-color-light);
				font-size: 0.78em;
				margin-top: 0.2em;
				overflow-wrap: anywhere;
			}

			.row-detail {
				grid-area: detail;
			}

			.suggestion-detail {
				grid-area: detail;
			}

			/* RIGHT-ALIGNED, so the numbers line up with each other rather than
			   with the variable-length words that follow them, and reserved even
			   while empty so a number landing 150ms late moves nothing. */
			.row-count {
				color: var(--app-dark-text-color-light);
				font-size: 0.82em;
				grid-area: count;
				text-align: right;
				white-space: nowrap;
			}

			/* THE ONE GLYPH THAT SURVIVED THE VERB CHIPS. A destination under a
			   typing list is the only row whose consequence differs from its
			   neighbours', so it is the only row that has to say so — and it
			   says it the way find-dialog already does. */
			.row-navigate {
				align-self: center;
				grid-area: glyph;
			}

			.row-navigate svg {
				fill: var(--app-dark-text-color-light);
				height: 1em;
				width: 1em;
			}

			/* A recent renders as the sentence it is, in miniature. The
			   renderer is the same component the palette's own sentence is, so
			   a collection is called the same thing in both places. */
			.row-sentence {
				color: var(--app-dark-text-color);
			}

			/* justify-self: start, inside a fixed track: every chip on every
			   row begins at the same x. The padding is unconditional so that
			   filling it for the highlighted row (below) moves nothing.
			   Sentence case now (§2.1), with the letter-spacing that was
			   opening up the caps removed with them. A 1px transparent border
			   is declared on every chip so that giving the transform chips a
			   real one below moves nothing either. */
			.suggestion-action {
				align-self: start;
				background: transparent;
				border: 1px solid transparent;
				color: var(--app-primary-color);
				font-size: 0.72em;
				grid-area: action;
				justify-self: start;
				padding: 0.2em 0.4em;
				white-space: nowrap;
			}

			/* THE CONSEQUENCE CLASS IS SCANNABLE WITHOUT READING THE WORD.
			   Open is the only verb in any of these three lists that LEAVES —
			   it commits a navigation and closes the composer. Everything else
			   rewrites the draft, or its representation, and hands the user back
			   to composing. In ALL CAPS the seven verbs were one undifferentiated
			   register; in sentence case they are quieter still, so the
			   difference moves into the treatment: the navigational verb is a
			   filled 700 chip, the draft-transforming ones are outlined at 400.
			   Both weights exist (§4.3 loads 400 and 700 and nothing else).
			   Judgment call worth stating: the highlighted-row rule below fills
			   whichever chip is highlighted, so on that ONE row the fill stops
			   discriminating — deliberately, because a categorically stronger
			   highlight is what the previous wave established and what keeps
			   "the transformation accepted on keydown is the one visibly
			   highlighted" legible. The weight survives the fill, and the
			   key-hints line names that row's verb outright. */
			.suggestion-action[data-consequence='navigate'] {
				background: var(--app-primary-color);
				color: var(--app-light-text-color);
				font-weight: 700;
			}

			.suggestion-action[data-consequence='transform'] {
				border-color: var(--app-primary-color);
			}

			/* A genuine extension rather than a repaint: this is a toggle (it
			   pairs with aria-pressed and takes .selected from
			   ButtonSharedStyles), and it needs a square hit target beside the
			   row it modifies. Kept for the legacy builder path, which still
			   renders its own selects. */

			/* The key-hints line sits below the list and outside it, so the
			   list's last row was clipped underneath it on a narrow screen. */
			.mobile .palette-list,
			.mobile .suggestions {
				padding-bottom: 2.75em;
			}

			/* Same discipline, a narrower column: 11em of a 375px screen would
			   leave the label nothing, so the count takes its own row under the
			   label and is allowed to wrap. */
			.mobile .palette-row button {
				grid-template-columns: minmax(0, 1fr) auto;
				grid-template-areas:
					'label glyph'
					'widens glyph'
					'count count'
					'detail detail';
			}

			.mobile .row-count {
				text-align: left;
				white-space: normal;
			}

			.mobile .suggestion button {
				grid-template-columns: minmax(0, 1fr) 9em;
				grid-template-areas:
					'category category'
					'label    action'
					'detail   detail';
			}

			/* Right-aligned under the right-aligned count, so the two elements
			   of the same column share an edge. */
			.mobile .suggestion-action {
				justify-self: end;
			}

			/* THE TWO QUIET LINKS THAT SURVIVED. "Browse all filters" seeds this
			   same list with every family; "Edit source" is the one way into
			   Source. Everything else that used to live on this rule — the
			   catalog toggle's setup strip, the clause-builder toggle — is
			   deleted. */
			.mode-links {
				border-top: 1px solid var(--app-divider-color);
				margin-top: 0.75em;
				padding-top: 0.5em;
			}

			/* Only the padding differs from .verb here: this row's two links sit
			   flush against its rule, not inset from it. */
			.mode-links button.verb {
				padding: 0.35em 0;
			}

			.builder {
				display: flex;
				flex-direction: column;
				margin-top: 0.5em;
				min-height: 0;
			}

			/* THE URL THE DRAFT WOULD OPEN, under the list, while composing.
			   The plus and minus keys in the sentence's own keyboard grammar
			   are literally the URL's spellings for union and exclusion, and
			   this line is where a user first sees what they produce — the
			   ladder teaching downward, one quiet line at a time (proposal C
			   §4.6). Subordinate colour and monospace: it is a path, not a
			   sentence. */
			.compiled-path {
				color: var(--app-dark-text-color-light);
				font-family: monospace;
				font-size: 0.75em;
				margin-top: 0.5em;
				overflow-wrap: anywhere;
			}

			/* The footer is the last child of #inner, so scrolling the list to
			   the port's bottom edge would push Open out of view. Reserving its
			   room at the port's end is what keeps it reachable. */
			#inner {
				scroll-padding-block-end: 3.5em;
			}

			.mobile .builder ul {
				padding-left: 1em;
			}

			.mobile .builder select,
			.mobile .builder input,
			.mobile .builder button {
				min-height: 44px;
				max-width: 100%;
			}

			/* And this one is the last thing in a scrolling workspace, so it
			   needs its own top rule of space and the iOS safe-area inset under
			   it. Everything else comes from .buttons.

			   flex: 0 0 auto is load-bearing, not cosmetic: the footer is a
			   sibling of the editor panes above it, and its room must be
			   RESERVED out of theirs. Left shrinkable it gave up its own height
			   to a growing editor and the two ended up sharing pixels. */
			.buttons.composer-actions {
				align-items: center;
				flex: 0 0 auto;
				gap: 0.5em;
				margin-top: 0.75em;
				padding: 0.5em 0 max(0.25em, env(safe-area-inset-bottom));
			}

			/* While a suggestion is highlighted there were two numbers on
			   screen claiming to be what Enter would do — the row's, which was
			   right, and this readout's, which described the draft. The
			   button's act does not change (clicking it always opens the
			   draft), so what recedes is its weight, not its meaning. Enough
			   to stop competing, not so much that a live control reads as
			   disabled; the disabled treatment is a grey fill, not a fade. */
			.buttons.composer-actions[data-deemphasized] {
				opacity: 0.6;
			}

			/* §4.2's 44px hit target. button.round is 2.75em square, which is
			   44px only while this dialog renders at 16px; pin both dimensions
			   to the same floor so the button stays a circle rather than an
			   ellipse when it is the min-width that binds. */
			.buttons .primary {
				min-height: 44px;
				min-width: 44px;
			}

			/* Subordinate to the count it qualifies, and to the button it sits
			   beside — it is a statement of fact about the draft, not a warning:
			   an empty draft is valid, and the recovery rows above are the
			   offer. --app-dark-text-color-darker rather than -light for the
			   same reason the receipt takes it: this one has to be read. */
			.composer-actions .no-cards-note {
				color: var(--app-dark-text-color-darker);
				font-size: 0.85em;
				margin-right: auto;
			}

			/* The count is a READOUT of what the primary would open, not part of
			   the button's name (§3.3, §4.2: a round glyph has no label to vary).
			   It arrives after the row is already on screen, so its width is
			   reserved — this is the same reservation the button's label used to
			   carry, moved to the element that now changes. Without it, the
			   button slid left under the pointer the moment a number landed. */
			.composer-actions .action-count {
				color: var(--app-dark-text-color);
				min-width: 7em;
				text-align: right;
			}

			/* 400, not 500 (§4.3 loads only 400 and 700). These are the same
			   subordinate register as .suggestion-heading and as
			   ButtonSharedStyles' own label rule, both of which are already 400 —
			   rounding up to 700 would make them the loudest thing in the
			   source pane. The uppercase is gone with the rest of §4.6's
			   heading register: "COLLECTION SOURCE", "THIS MEANS", "OPENS ON"
			   and "WILL OPEN AS" were shouted versions of strings already
			   written in the case they should be read in. */
			.source-editor label,
			.source-interpretation-label {
				color: var(--app-dark-text-color-light);
				display: block;
				font-size: 0.78em;
				font-weight: 400;
				margin: 0.8em 0 0.35em;
			}

			.source-input {
				box-sizing: border-box;
				font-family: monospace;
				line-height: 1.45;
				min-height: 5.5em;
				overflow-wrap: anywhere;
				padding: 0.65em;
				resize: vertical;
				white-space: pre-wrap;
				width: 100%;
			}

			/* THE TONES WERE INVERTED. 'Ready to open' — the one state where
			   nothing is wrong — took a loud 3px purple bar, while the parse
			   error took --app-divider-color, which on white is invisible. So
			   the pane shouted when it had nothing to say and went silent when
			   the user had made a mistake.
			   The spec asks for parse errors in the existing warning colour;
			   §4.5 makes red the error tone and reserves purple for the
			   committing action, which on this pane is the Open button. Keep
			   typing is neither: an incomplete source is not an error, so it
			   stays the neutral rule. */
			.source-status {
				border-left: 3px solid var(--app-divider-color);
				font-size: 0.85em;
				margin-top: 0.6em;
				padding: 0.35em 0.6em;
			}

			/* Teal, not purple: §4.5's "this exists" is exactly what a valid
			   source has established, and it is quieter than the action it
			   enables. */
			.source-status[data-status='valid'] {
				border-left-color: var(--app-secondary-color);
			}

			/* An unsupported source is a refusal, not a stage on the way to a
			   collection, so it takes the same tone as a parse error. */
			.source-status[data-status='invalid'],
			.source-status[data-status='unsupported'] {
				border-left-color: var(--app-warning-color);
			}

			/* The label carries the tone too. A 3px bar alone is easy to miss
			   beside a monospace field the eye is already inside. */
			.source-status[data-status='invalid'] strong,
			.source-status[data-status='unsupported'] strong {
				color: var(--app-warning-color);
			}

			.source-link {
				font-family: monospace;
				overflow-wrap: anywhere;
			}

			.source-suggestion-heading {
				color: var(--app-dark-text-color-light);
				font-size: 0.75em;
				margin: 0.65em 0 0.25em;
			}

			/* The row's kind word — Sort, View, Set, Filter, Date, Value, or a
			   live candidate's own category. Sentence case, and the presentation
			   function authors it that way rather than a transform painting it. */
			.source-suggestion-category {
				color: var(--app-dark-text-color-light);
				font-size: 0.72em;
				grid-area: category;
			}

			.source-steps {
				display: flex;
				flex-wrap: wrap;
				gap: 0.35em;
				margin: 0.25em 0;
			}

			.source-step {
				background: var(--app-primary-color-light-very-transparent);
				border: 1px solid var(--app-divider-color);
				padding: 0.3em 0.5em;
			}

			.mode-actions {
				align-items: center;
				border-top: 1px solid var(--app-divider-color);
				display: flex;
				justify-content: space-between;
				margin-top: 0.75em;
				padding-top: 0.5em;
			}

			/* One element, two tones, because it carries two different facts
			   (§3.6.2). Unmarked is the WORKING state — "Opening collection…",
			   the app is fetching and the user waits — which the tone ladder
			   gives --app-primary-color-light. data-problem is the state that
			   refused: the edit gate, or a collection that is already open.
			   Those are problems and take --app-warning-color. Painting both
			   the same brand purple made a refusal look like progress. */
			.activation-message {
				color: var(--app-primary-color-light);
				font-size: 0.85em;
				margin-top: 0.5em;
			}

			.activation-message[data-problem] {
				color: var(--app-warning-color);
			}

			/* MOTION — §4.4, and the spec's "Card Web's existing short fade
			   timing". The composer had none anywhere: it appeared, its
			   highlight teleported between rows, and its layers snapped open.

			   EVERY property animated here is opacity, colour or transform.
			   None of them is a layout property, on purpose: the dialog's box
			   and its rows' columns were just pinned so that nothing moves
			   under a keystroke, and an animated width or height would put the
			   movement straight back in.

			   THE WHOLE BLOCK IS GATED on prefers-reduced-motion:
			   no-preference, so a reader who has asked for stillness gets the
			   end state immediately rather than a shortened version of the
			   same movement — the surface stays fully understandable with
			   transitions disabled, which is what the spec asks for.

			   Closing is not animated: .container goes to display:none, and
			   there is no state left to animate out of. */
			@media (prefers-reduced-motion: no-preference) {
				@keyframes composer-appear {
					from { opacity: 0; }
					to { opacity: 1; }
				}

				/* A settle, not an entrance. It ends at transform:none, so it
				   leaves nothing behind on the pinned box. */
				@keyframes composer-settle {
					from { opacity: 0; transform: scale(0.985); }
					to { opacity: 1; transform: none; }
				}

				.container.open .background {
					animation: composer-appear var(--transition-fade) both;
				}

				.container.open .content {
					animation: composer-settle var(--transition-fade) both;
				}

				/* The highlight MOVES between rows instead of teleporting.
				   Exactly the three properties the highlight changes — the
				   fill, the bar's colour, and the chip — so nothing in this
				   transition can shift a row. */
				.palette-row button,
				.suggestion button,
				.suggestion-action {
					transition:
						background-color var(--transition-fade),
						border-left-color var(--transition-fade),
						color var(--transition-fade);
				}

				/* "Expanding a layer should feel like revealing familiar
				   detail." The height is deliberately not part of it. */
				.builder,
				.pill-row {
					animation: composer-appear var(--transition-fade) both;
				}

				/* The tone the source diagnostic changes to, and the weight
				   the primary gives up while a highlighted row owns Enter. */
				.source-status {
					transition: border-left-color var(--transition-fade), color var(--transition-fade);
				}

				.buttons.composer-actions {
					transition: opacity var(--transition-fade);
				}
			}
		`
	];

	override innerRender() {
		if (collectionComposerEnabled()) return this._entryMode === 'source' ? this._sourceRender() : this._composerRender();
		return this._builderRender();
	}

	get _parsedSource() : ParsedCollectionSource {
		return parsedSourceFor(this._sourceInput, this._contextualComposerCandidates, this._filterDescriptions, this._draftSelectedCard);
	}

	//ONE DECISION, TWO SENTENCES — SO THEY CANNOT CONTRADICT EACH OTHER.
	//
	//The heading and the body used to be computed independently: the heading
	//branched on parsed.status, and the body took the first diagnostic with a
	//single fallback shared by every state. An incomplete or invalid source that
	//produced NO diagnostic therefore fell through to the valid state's own
	//sentence, and the pane read "Keep typing — This source is complete and safe
	//to open": one element saying, in two halves, that the source both is and is
	//not openable. §2.4's honest-header rule is not satisfiable by a header
	//alone if the body underneath it is free to say something else.
	//
	//Both halves now come out of the same branch, so every state owns its own
	//fallback and the valid sentence is reachable from exactly one place.
	//
	//ONE HONEST HEADER PER STATE CLASS. 'Not supported here' and 'Can’t
	//understand this source' were two headers for one class — the source cannot
	//be opened — and each was wrong about half of it. The app understands `foo`
	//perfectly well and simply has no such filter, so "can't understand" is
	//false; a malformed date is understood and rejected, so "not supported" is
	//false. The header states the one fact both share, and the sentence
	//underneath says which it was. The incomplete state stays distinct, because
	//nothing is wrong there yet.
	//
	//"Safe to open" is a claim about the source. It says nothing about who gets
	//what when the resulting link is opened, and Source is the surface whose
	//whole job is the URL — the one place a user is looking at the link itself,
	//and therefore the one place most likely to copy it. A personal clause makes
	//the link resolve against the reader's own stars, reads and reading list, so
	//the sentence says that instead of implying the opposite.
	_sourceStatus(parsed : ParsedCollectionSource, description : CollectionDescription) : {label : string, sentence : string} {
		const diagnostic = parsed.diagnostics[0]?.message || '';
		if (parsed.status === 'valid') {
			return {
				label: 'Ready to open',
				sentence: diagnostic || (filterNamesAreViewerDependent(description.filters) ?
					'opens for you; this link’s results depend on who views it.' :
					'This source is complete and safe to open.'),
			};
		}
		if (parsed.status === 'incomplete') {
			return {
				label: 'Keep typing',
				sentence: diagnostic || 'This source is not a whole collection yet.',
			};
		}
		return {
			label: 'Can’t open this source',
			sentence: diagnostic || 'This source does not describe a collection this app can open.',
		};
	}

	_sourceRender() {
		const parsed = this._parsedSource;
		const shown = parsed.status === 'valid' ? parsed : this._lastValidSource;
		const description = shown?.description || this._collectionDescription;
		const count = this._previewCounts[this._draftPreviewID];
		const {label: statusLabel, sentence: diagnostic} = this._sourceStatus(parsed, description);
		const completionDiagnostic = parsed.diagnostics.find(item => item.expected?.length);
		const completionMode = completionDiagnostic ? 'complete' : 'add';
		const completionDetails = completionDiagnostic?.expectedDetails || parsed.nextExpectedDetails || {};
		//Which production the completions belong to. Only the parser knows, and
		//without it every completion fell through to 'filter'.
		const completionKind : CollectionSourceExpectedKind = completionDiagnostic?.expectedKind || parsed.nextExpectedKind || 'root';
		const completions = this._sourceCompletionsDismissed ? [] : (completionDiagnostic?.expected || parsed.nextExpected || []);
		const expressionParts = collectionExpressionParts(description, this._composerFilterLabels, this._composerCardNames);
		const fullDestination = parsed.canonicalPath ? new URL(parsed.canonicalPath, window.location.origin).toString() : '';
		//The app elides the default set, so a perfectly good `/c/main/starred/`
		//canonicalizes to `/c/starred/`. Shown under "Will open as" with no
		//further comment, that reads as the app quietly rewriting what was
		//typed. Naming it as the same collection in canonical form is the whole
		//difference between a rewrite and a spelling.
		const canonicalized = Boolean(parsed.canonicalPath) && parsed.canonicalPath !== this._sourceInput;
		//AN ORIGIN THAT WAS TRANSLATED IS NOT A SPELLING.
		//
		//A pasted link from this deployment's public address is accepted, and it
		//is genuinely the same collection — but "written in this app's canonical
		//form" describes a change of SPELLING, and this one changed the host the
		//link points at. On a dev build opening a thecompendium.cards link, that
		//sentence claimed the two were interchangeable when the whole point is
		//that they are not. Same-origin canonicalization keeps its own copy.
		const foreignOrigin = parsed.origin && parsed.origin !== window.location.origin ? new URL(parsed.origin).hostname : '';
		return html`
			<div class='source-editor'>
				<label for='collection-source-input'>Collection Source ${help(COLLECTION_HELP)}</label>
				<textarea
					id='collection-source-input'
					class='source-input'
					rows='3'
					spellcheck='false'
					role='combobox'
					aria-autocomplete='list'
					aria-controls=${ifDefined(completions.length ? 'collection-source-completions' : undefined)}
					aria-expanded=${completions.length > 0}
					aria-activedescendant=${ifDefined(completions.length ? `collection-source-completion-${this._sourceCompletionIndex}` : undefined)}
					aria-describedby=${parsed.canonicalPath ? 'collection-source-status collection-source-destination' : 'collection-source-status'}
					aria-invalid=${parsed.status !== 'valid'}
					placeholder='everything/starred/updated/after/3-days-ago/'
					.value=${this._sourceInput}
					@input=${this._handleSourceInput}
					@keydown=${this._handleSourceKeyDown}
				></textarea>
				<div id='collection-source-status' class='source-status' role='status' data-status=${parsed.status}>
					<strong>${statusLabel}</strong> — ${diagnostic}
				</div>
			</div>
			${completions.length ? html`
				<div class='source-suggestion-heading'>${completionMode === 'add' ? 'Add another filter or modifier — type to search all filters' : 'Choose the next value'}</div>
				<div id='collection-source-completions' class='suggestions scroller' role='listbox' aria-label='Legal next source values'>
					${completions.map((completion, index) => {
		const presentation = this._sourceCompletionPresentation(completion, completionDetails[completion], completionKind);
		return html`
						<div class='suggestion' role='presentation'>
							<button id=${`collection-source-completion-${index}`} role='option' tabindex='-1' aria-selected=${index === this._sourceCompletionIndex} ?data-highlighted=${index === this._sourceCompletionIndex} @mousemove=${() => this._handleRowPointerMove('source-completion', index)} @mouseenter=${() => this._handleRowPointerEnter('source-completion', index)} @click=${() => this._acceptSourceCompletion(completion)}>
								<span class='source-suggestion-category'>${presentation.category}</span>
								<span class='suggestion-label'>${presentation.label}</span>
								<span class='suggestion-action' data-consequence=${rowConsequence(completionMode)}>${sentenceCase(completionMode)}</span>
								<span class='suggestion-detail'>${presentation.detail} · <code>${completion}</code></span>
							</button>
						</div>
					`;
	})}
				</div>
			` : ''}
			<span class='source-interpretation-label'>${parsed.status === 'valid' ? 'This means' : 'Last valid collection'}</span>
			<div class='source-steps' role='group' aria-label=${readableCollectionExpression(description, this._composerFilterLabels, this._composerCardNames)}>
				<span class='source-step'>Start with ${expressionParts.set.label}</span>
				${expressionParts.filters.map(filter => html`<span class='source-step'>Then ${filter.label}</span>`)}
				${expressionParts.modifiers.map(modifier => html`<span class='source-step'>Finally ${modifier}</span>`)}
			</div>
			<!-- A collection with no cards opens on nothing, so "Opens on: the
			     first card in the collection" names a card that does not exist.
			     Suppressed only at a RESOLVED zero: while the count is still
			     undefined we do not yet know, and guessing is what produced the
			     claim in the first place. -->
			${shown?.selectedCardRaw && count !== 0 ? html`
				<span class='source-interpretation-label'>Opens on</span>
				<div>${shown.selectedCardRaw === PLACEHOLDER_CARD_ID_CHARACTER ? 'The first card in the collection' : shown.selectedCardRaw}</div>
			` : ''}
			${fullDestination ? html`
				<span class='source-interpretation-label'>${canonicalized ? 'Will open as' : 'Link'}</span>
				<div id='collection-source-destination' class='source-link'>${fullDestination}</div>
				${canonicalized ? html`<div class='key-hints'>${foreignOrigin ? `From ${foreignOrigin}, opened in this app` : 'Same collection, written in this app’s canonical form'}</div>` : ''}
			` : ''}
			${parsed.notices.map(notice => html`<div class='key-hints'>${notice} ${parsed.query}${parsed.hash}</div>`)}
			${fullDestination ? html`<button class='small verb' @click=${this._handleCopySourceLink} aria-label='Copy collection link'>Copy link</button>` : ''}
			${this._sourceReturnWarning ? html`
				<div id='collection-source-return-warning' class='source-status' data-status='invalid' role='alert' tabindex='-1'>
					These source edits do not form an openable collection.
					<div><button class='small verb' @click=${() => this._sourceReturnWarning = false}>Keep editing</button><button class='small verb' @click=${this._returnToLastValidSource}>Return to last valid collection</button></div>
				</div>
			` : ''}
			${this._modifierNoteRender()}
			<div class='mode-actions'>
				<button class='small verb' @click=${this._handleBackToCompose}>Edit visually</button>
				<span class='key-hints'>${this._sourceKeyHints(completions.length > 0, completionMode, parsed.status === 'valid')}</span>
			</div>
			${this._openActionRender(
		count,
		parsed.status !== 'valid' || this._activationPending,
		parsed.status === 'valid' ?
			(this._activationPending ? 'Already opening this collection' : 'Open this collection') :
			'This source does not describe a collection yet, so there is nothing to open',
		this._handleOpenSource
	)}
			${this._activationMessage ? html`<div class='activation-message' data-problem role='alert'>${this._activationMessage}</div>` : ''}
		`;
	}

	_builderRender() {
		return html`
			<label>Filters ${help(COLLECTION_HELP)}</label>
			<ul>
				${this._collectionDescription.filters.map((filterName, index) => html`
					<configure-collection-filter
						.value=${filterName}
						.index=${index}
						.mobile=${this.mobile}
						.filterDescriptions=${this._filterDescriptions}
						.cardTagInfos=${this._cardTagInfos}
						.userIDs=${this._userIDs}
						.userInfos=${this._userInfos}
						@filter-modified=${this._handleFilterModified}
						@filter-removed=${this._handleFilterRemoved}>
					</configure-collection-filter>`)}
				<li>
					<button
						class='small'
						@click=${this._handleAddFilterClicked}
						title='Add a new filter (ANDed with other filters)'
					>
						${PLUS_ICON}
					</button>
				</li>
			</ul>
			<div class='row'>
				<div>
					<label for='collection-set'>Set</label>
					<select id='collection-set' @change=${this._handleSetSelectChanged}>
						${Object.entries(SET_INFOS).map(entry => html`<option value=${entry[0]} title=${entry[1].description} .selected=${live(entry[0] === this._collectionDescription.set)}>${collectionOptionDisplayName(entry[0])}</option>`)}
					</select>
				</div>
				<div>
					<label for='collection-sort'>Sort</label>
					<select id='collection-sort' @change=${this._handleSortSelectChanged}>
						${Object.entries(SORTS).map(entry => html`<option value=${entry[0]} title=${entry[1].description} .selected=${live(entry[0] === this._collectionDescription.sort)}>${collectionOptionDisplayName(entry[0])}</option>`)}
					</select>
				</div>
				<div>
					<label for='reversed'>Sort Reversed</label>
					<input type='checkbox' @change=${this._handleSortReversedCheckboxChanged} id='reversed' .checked=${this._collectionDescription.sortReversed}>
				</div>
				<div>
					<label for='modify-path'>Manually modify path</label>
					<button class='small' id='modify-path' @click=${this._handleModifyPath}>${LINK_ICON}</button>
				</div>
			</div>
		`;
	}

	//--- The sentence ---------------------------------------------------------

	//THE SAME RENDERER THE DRAWER USES, interactive and at full size. The
	//composer used to build the draft out of its own chip markup — a white box
	//with a divider down its middle — which is why a clause could look like a
	//chip in the drawer and a table cell here. One component, two hosts: the
	//drawer navigates on a gesture and this dialog edits a draft, and that is
	//the only difference between them.
	//
	//The help badge rides at the END of the sentence rather than in front of it:
	//it defines the word "collection" (HS-1.3's MUST, debt item D1), which is a
	//footnote to the sentence and not its subject.
	_sentenceRender() {
		return html`
			<div class='sentence'>
				<collection-sentence
					.expression=${this._draftExpression}
					.set=${this._collectionDescription.set}
					.sort=${this._collectionDescription.sort}
					.sortReversed=${this._collectionDescription.sortReversed}
					.viewMode=${this._collectionDescription.viewMode}
					.viewModeExtra=${this._collectionDescription.viewModeExtra}
					.tagInfos=${this._tagInfos}
					.labels=${this._composerFilterLabels}
					.cardNames=${this._composerCardNames}
					.filterDescriptions=${this._filterDescriptions || EMPTY_FILTER_DESCRIPTIONS}
					.interactive=${true}
					.selectedPath=${this._selectedPath}
					@condition-selected=${this._handleTokenSelected}
					@member-selected=${this._handleTokenSelected}
					@group-edge-selected=${this._handleTokenSelected}
					@condition-activated=${this._handleTokenSelected}
					@condition-removed=${this._handleTokenRemoved}
					@set-clicked=${this._handleSetWordClicked}
					@sort-clicked=${this._handleSortWordClicked}
				></collection-sentence>${this._orderWordRender()}${help(COLLECTION_HELP)}
			</div>
		`;
	}

	//THE ORDER IS A WORD IN THE SENTENCE — WHEN THE SENTENCE HAS ONE TO SHOW.
	//
	//collection-sentence deliberately omits its tail at the defaults: "sorted by
	//default" tells the user about a FIELD rather than about their collection,
	//and that refusal is right. But it leaves the palette with no word to click
	//at exactly the moment most users arrive, and the four-select setup strip
	//that used to carry sort and view is deleted. Typing 'recent' reaches the
	//same rows, and would have been the only route.
	//
	//So the palette supplies the missing word itself, at the sentence's own
	//subordinate scale, and only when the sentence has not supplied one. It says
	//what it opens rather than what the collection currently is, which is the one
	//phrasing that is honest at a default.
	_orderWordRender() {
		const description = this._collectionDescription;
		const hasTail = description.sort !== 'default' || description.sortReversed || description.viewMode !== 'list';
		if (hasTail) return '';
		return html`<span class='order-word-operator'> · </span><button class='small verb order-word' @click=${this._handleSortWordClicked}>order and view</button>`;
	}

	//--- The pill row ---------------------------------------------------------

	//WHETHER THERE IS A TOKEN TO EDIT. A selection and a real token used to be
	//two facts kept in step by hand, and every path that dropped one without the
	//other rendered an empty panel. Asked as one question here, a row with no
	//token behind it cannot be rendered at all.
	get _pillRowOpen() : boolean {
		if (!this._selectedPath.length) return false;
		return Boolean(pillRowSpellingFor(this._draftExpression, this._selectedPath[0], this._selectedMemberIndex));
	}

	get _selectedMemberIndex() : number {
		return this._selectedPath.length === 2 ? this._selectedPath[1] : -1;
	}

	//THE TWO COUNT ROLES, WIRED LIVE. "Draft now matches N" is the fact — the
	//same number the footer states, asked once through the same debounced
	//preview machinery and the same retained cache — and "without this pill: N"
	//is a prediction about a different collection, so it is a different preview.
	//`without this pill` is what replaced the old "Remove X" suggestion rows
	//entirely: the question they answered is answered here, beside the clause
	//they were about.
	_pillRowRender() {
		if (!this._pillRowOpen) return '';
		return html`
			<div class='pill-row'>
				<collection-pill-row
					.expression=${this._draftExpression}
					.index=${this._selectedPath[0]}
					.memberIndex=${this._selectedMemberIndex}
					.labels=${this._composerFilterLabels}
					.cardNames=${this._composerCardNames}
					.cardTagInfos=${this._cardTagInfos}
					.userIDs=${this._userIDs}
					.userInfos=${this._userInfos}
					.draftCount=${this._previewCounts[this._draftPreviewID]}
					.withoutCount=${this._previewCounts[this._withoutPreviewID]}
					@expression-modified=${this._handleExpressionModified}
					@pill-or-requested=${this._handlePillOrRequested}
				></collection-pill-row>
			</div>
		`;
	}

	//--- The one list, as data ------------------------------------------------

	get _draftExpression() : CollectionExpression {
		return draftExpressionFor(this._collectionDescription || EMPTY_COLLECTION_DESCRIPTION);
	}

	get _completionContext() : CollectionCompletionContext {
		const remembered = readRememberedCollections(this._userScope, this._knownFilterNames);
		const activeCanonical = this._activeCollectionDescription?.serialize();
		//The first two remembered entries are in raw visit order, so the first
		//of them that is not the collection on screen is genuinely the one
		//visited before it. That is the only thing that earns the words "Back
		//to"; anything further back is a destination, not a direction.
		const previousCollection = remembered.slice(0, 2).find(entry => entry.canonical !== activeCanonical)?.canonical;
		return completionContextFor(
			this._contextualComposerCandidates,
			this._composerCardNames,
			this._filterDescriptions || EMPTY_FILTER_DESCRIPTIONS,
			this._tagInfos || EMPTY_TAG_INFOS,
			recentCollectionsFor(remembered),
			this._activeCollectionDescription || undefined,
			previousCollection,
			this._draftSelectedCard,
			this._cardsSelected
		);
	}

	//THE FOUR FEEDS, IN THE ORDER THEY OUTRANK EACH OTHER.
	//
	//An or-scoped input is the narrowest question the palette can be asking, so
	//it wins outright; a sentence word being edited is the next; Browse all is a
	//seeded list and typing FILTERS it rather than leaving it; and with none of
	//those in force the list is the idle two sections or the typing valences.
	//One `if` ladder rather than four booleans consulted in four places, because
	//the list has exactly one content at a time and that is the whole design.
	_rawPaletteRows() : PaletteRow[] {
		const description = this._collectionDescription;
		const expression = this._draftExpression;
		const context = this._completionContext;
		if (this._orTarget) {
			return paletteOrScopedRows(
				completionCandidatesFor(this._composerInput, expression, description, context, TYPING_CANDIDATE_LIMIT),
				description,
				this._orTarget.index
			).slice(0, TYPING_ROW_LIMIT);
		}
		if (this._wordScope) return paletteWordRows(description, this._wordScope);
		if (this._browseOpen) return paletteBrowseRows(
			browseItemsFor(
				this._filterDescriptions || EMPTY_FILTER_DESCRIPTIONS,
				this._contextualComposerCandidates,
				description,
				this._composerInput
			),
			description
		);
		if (this._composerInput.trim()) {
			return paletteTypingRows(
				completionCandidatesFor(this._composerInput, expression, description, context, TYPING_CANDIDATE_LIMIT),
				description
			).slice(0, TYPING_ROW_LIMIT);
		}
		return this._idleRows(description, context);
	}

	//RECENTS AND AT MOST THREE, and the cap is the completion index's own — the
	//owner's complaint #6 ("random suggestions") answered by arithmetic rather
	//than by taste. The count-aware ranking and the contradictory-refinement
	//suppression are ported unchanged from the old suggestion path; they are
	//applied to the whole idle list and the sections are re-derived from `kind`
	//afterwards, so "recents first, always" is structural rather than a property
	//of the ranking.
	_idleRows(description : CollectionDescription, context : CollectionCompletionContext) : PaletteRow[] {
		const idle = idleRowsFor(description, context);
		const ranked = rankedSuggestionsFor(
			this._withoutContradictoryRefinements([...idle.recents, ...idle.contextual]),
			this._previewCounts
		);
		return paletteIdleRows(
			ranked.filter(suggestion => suggestion.kind === 'recent'),
			ranked.filter(suggestion => suggestion.kind !== 'recent')
		);
	}

	get _paletteRows() : PaletteRow[] {
		if (!this._collectionDescription) return [];
		const rows = this._rawPaletteRows();
		//THE LIST DOES NOT MOVE UNDER THE KEYBOARD. The identity of the row set
		//is the "was this list rebuilt?" test: a new input or draft produces
		//different rows, and only then may counts reorder them. While a row is
		//highlighted the order is frozen outright, so the transformation
		//accepted on keydown is the one that was visible on keydown.
		const key = paletteOrderKey(rows);
		const memo = this._paletteOrder;
		if (memo && memo.key === key && this._rowHighlightActive) return frozenPaletteOrder(rows, memo.order);
		const order = rows.map(row => row.id);
		//Only when the order actually moved: reassigning an identical memo would
		//hand the frozen-order path a new array every render and defeat its
		//cache, which is the whole reason the list is stable to begin with.
		if (!memo || memo.key !== key || memo.order.length !== order.length || memo.order.some((id, index) => id !== order[index])) {
			this._paletteOrder = {key, order};
		}
		return rows;
	}

	//--- The one list, rendered -----------------------------------------------

	//A ROW WITH NOTHING TO PROMISE HAS NO NUMBER.
	//
	//A count answers "how many cards", so a row that changes only the ORDER or
	//the VIEW has no answer to give: it would render "1,842 cards → 1,842 cards"
	//and take a column to say nothing. A row that names a FAMILY has not decided
	//a collection yet. And Browse all is a directory of filters rather than a
	//list of predictions — the design's own line for it is "one line per family:
	//name + gray description", with no number in it.
	//
	//The same rule gates the PREVIEW REQUEST, so a number that would not be
	//rendered is never asked of the worker either.
	_rowCountMeaningful(row : PaletteRow) : boolean {
		if (this._browseOpen) return false;
		if (row.configurable && row.filter) return false;
		const draft = this._collectionDescription;
		const other = row.description;
		if (other.set !== draft.set) return true;
		return other.filters.join('/') !== draft.filters.join('/');
	}

	//THE COLLECTION WITHOUT THE SELECTED PILL, which is what the pill row's
	//second count counts. Built through the same removal helpers the Remove verb
	//uses, so "without this pill: N" and pressing Remove cannot disagree about
	//what removing it would do.
	get _expressionWithoutSelection() : CollectionExpression {
		const path = this._selectedPath;
		if (!path.length) return this._draftExpression;
		const memberIndex = this._selectedMemberIndex;
		return memberIndex < 0 ?
			withConditionRemoved(this._draftExpression, path[0]) :
			withMemberRemoved(this._draftExpression, path[0], memberIndex);
	}

	//TWO COUNT ROLES, AND THIS IS THE SECOND ONE. The sentence's count is a
	//FACT about the draft and lives beside the primary; a row's count is a
	//PREDICTION and is written as the transition it predicts. A destination is
	//the exception the design already draws: it is a whole other collection
	//rather than an edit to this one, so it states its own size rather than a
	//delta from a draft it does not descend from.
	_rowCountText(row : PaletteRow) : string {
		if (!this._rowCountMeaningful(row)) return '';
		const count = this._previewCounts[row.id];
		if (count === undefined) return '';
		if (row.kind === 'destination') return formatCollectionCardCount(count);
		const draftCount = this._previewCounts[this._draftPreviewID];
		if (draftCount === undefined) return formatCollectionCardCount(count);
		return `${formatCollectionCardCount(draftCount)} → ${formatCollectionCardCount(count)}`;
	}

	//THE PILL IT WOULD BECOME, rendered by the component that will render it in
	//the sentence a keystroke later (proposal A's token discipline). A
	//destination is a whole collection, so it renders as the whole sentence in
	//miniature — the same idiom, one size down. Everything else is one line of
	//text, because a family name and a sort name are words rather than clauses.
	_rowLabelRender(row : PaletteRow) {
		if (row.kind === 'destination') {
			return html`<collection-sentence
				class='row-sentence'
				.expression=${expressionForDescription(row.description)}
				.set=${row.description.set}
				.sort=${row.description.sort}
				.sortReversed=${row.description.sortReversed}
				.viewMode=${row.description.viewMode}
				.viewModeExtra=${row.description.viewModeExtra}
				.tagInfos=${this._tagInfos}
				.labels=${this._composerFilterLabels}
				.cardNames=${this._composerCardNames}
				.filterDescriptions=${this._filterDescriptions || EMPTY_FILTER_DESCRIPTIONS}
				.subtle=${true}
			></collection-sentence>`;
		}
		if (row.kind === 'valence' && row.pillExpression) {
			return html`<collection-sentence
				class='row-sentence'
				.expression=${row.pillExpression}
				.conditionsOnly=${true}
				.tagInfos=${this._tagInfos}
				.labels=${this._composerFilterLabels}
				.cardNames=${this._composerCardNames}
				.filterDescriptions=${this._filterDescriptions || EMPTY_FILTER_DESCRIPTIONS}
				.subtle=${true}
			></collection-sentence>`;
		}
		return html`${row.label}`;
	}

	_paletteRowRender(row : PaletteRow, index : number, highlightedIndex : number) {
		const highlighted = index === highlightedIndex;
		const countText = this._rowCountText(row);
		//THE DETAIL LINE IS ON THE HIGHLIGHTED ROW AND NOWHERE ELSE (proposal B
		//§2.1). A list where every row explains itself is a list nobody scans.
		//The one exception is Browse all, whose whole content IS "name + one
		//line of description" — that list has no other way to tell a family from
		//its neighbour.
		const showDetail = Boolean(row.detail) && (highlighted || row.alwaysDetail);
		return html`
			<div class='palette-row' role='presentation'>
				<button
					id='collection-palette-row-${index}'
					role='option'
					tabindex='-1'
					aria-selected=${highlighted}
					aria-label=${`${row.label}. ${row.detail}${countText ? `. ${countText}` : ''}`}
					data-index=${index}
					data-row-id=${row.id}
					data-filter=${ifDefined(row.filter)}
					?disabled=${this._activationPending}
					?data-highlighted=${highlighted}
					@mousemove=${() => this._handleRowPointerMove('palette', index)}
					@mouseenter=${() => this._handleRowPointerEnter('palette', index)}
					@click=${() => this._activateRow(row, row.navigates)}
				>
					<span class='row-label'>${this._rowLabelRender(row)}</span>
					<!-- WHAT AN "OR" WIDENS, named. The label already reads
					     "<target> or <new>"; this says which half of it was
					     already in the sentence, which is the fact that makes the
					     row causal rather than arbitrary. -->
					${row.targetLabel ? html`<span class='row-widens'>widens ${row.targetLabel}</span>` : ''}
					${countText ? html`<span class='row-count'>${countText}</span>` : ''}
					<!-- THE ONE GLYPH THAT SURVIVED THE VERB CHIPS. Under a
					     typing list the rows are edits and a recent is not, so
					     the one row whose consequence differs says so. In the
					     idle list the "Recent" heading has already said it. -->
					${row.navigates && row.section !== RECENT_SECTION ? html`<span class='row-navigate' aria-hidden='true'>${OPEN_IN_BROWSER_ICON}</span>` : ''}
					<!-- "ONLY FOR YOU" DIES IN COMPOSITION (meta-proposal
					     convergence 6). The note rode every personal row and
					     every personal chip, which is a caution repeated in the
					     one place where nothing is at stake yet — nobody has
					     shared anything. Viewer-dependence speaks ONCE, where the
					     consequence actually lands: in the copy-link
					     confirmation, and in Source's own status line. Both are
					     untouched. -->
					${showDetail ? html`<span class='row-detail'>${row.detail}</span>` : ''}
				</button>
			</div>
		`;
	}

	//ONE LIST, WITH HEADINGS RATHER THAN SECTIONS. A run of rows sharing a
	//section gets one heading in the app's panel-h3 register — normal weight,
	//subordinate colour, sentence case — and the heading is what carries the
	//grammar that the deleted verb chips used to restate on every row.
	_paletteListRender(rows : PaletteRow[], highlightedIndex : number) {
		if (!rows.length) {
			return html`<div class='no-suggestions'>${this._browseOpen ?
				'No filters match yet. Try a broader word such as date, tag, author, relationship, or text.' :
				'No complete interpretation yet. Keep typing or browse all filters.'}</div>`;
		}
		let section = '';
		return html`
			<div class='palette-list scroller' id='collection-palette-list' role='listbox' aria-label='Collection choices'>
				${rows.map((row, index) => {
		const heading = row.section && row.section !== section ? row.section : '';
		section = row.section;
		return html`${heading ? html`<div class='suggestion-heading'>${heading}</div>` : ''}${this._paletteRowRender(row, index, highlightedIndex)}`;
	})}
			</div>
		`;
	}

	//THE URL THE DRAFT WOULD OPEN, one quiet line under the list.
	//
	//Nothing depends on it and it asks for nothing — which is exactly why it
	//teaches. The keyboard grammar's `+` and `-` are the URL's own spellings for
	//union and exclusion, so a user who has been pressing them has already been
	//authoring this string; this is where they first see it, and the step from
	//here into Source is a step they have already taken without noticing.
	_compiledPathRender() {
		const path = collectionURLPath(this._collectionDescription, {selectedCard: this._draftSelectedCard, originalOrder: true});
		if (!path) return '';
		return html`<div class='compiled-path' aria-hidden='true'>${path}</div>`;
	}

	_composerRender() {
		if (!this._collectionDescription) return html``;
		const rows = this._paletteRows;
		const highlightedIndex = this._activeHighlightIndex(rows);
		const highlighted = rows[highlightedIndex];
		const expressionParts = collectionExpressionParts(this._collectionDescription, this._composerFilterLabels, this._composerCardNames);
		const draftCount = this._previewCounts[this._draftPreviewID];
		return html`
			<div class='visually-hidden' aria-live='polite'>Draft: ${readableCollectionExpression(this._collectionDescription, this._composerFilterLabels, this._composerCardNames)}</div>
			${this._sentenceRender()}
			<!-- DIRECTLY UNDER THE SENTENCE, at the place the clause is. That is
			     the whole argument for a one-line editor: everything you can do
			     to a clause appears where you see it. -->
			${this._pillRowRender()}
			<!-- Visible, not a title: hover is unreachable on touch (§3.6.4),
			     and a clause the user cannot edit is exactly the one that has to
			     explain itself. Empty for every ordinary clause. -->
			${expressionParts.filters.filter(filter => filter.explanation).map(filter => html`
				<div class='row-detail unsupported-clause'>${filter.label}: ${filter.explanation}</div>
			`)}
			<input
				class='composer-input'
				id='collection-composer-input'
				type='text'
				role='combobox'
				aria-label='Compose collection filters'
				aria-autocomplete='list'
				aria-controls=${ifDefined(rows.length ? 'collection-palette-list' : undefined)}
				aria-expanded=${rows.length > 0}
				aria-activedescendant=${ifDefined(highlighted ? `collection-palette-row-${highlightedIndex}` : undefined)}
				aria-busy=${this._activationPending}
				placeholder=${this._inputPlaceholder}
				.value=${this._composerInput}
				@input=${this._handleComposerInput}
				@keydown=${this._handleComposerKeyDown}
			>
			${this._draftReceiptMessage ? html`
				<div class='draft-receipt' role='status'>
					<span>${this._draftReceiptMessage}</span>
					${this._draftUndoDescription ? html`<button class='small verb' @click=${this._undoDraftEdit}>Undo</button>` : ''}
				</div>
			` : ''}
			<!-- ANNOUNCED, NOT SHOWN. The pill row under the sentence is the
			     visible answer to "which clause is selected", and it says so in
			     more detail than a status line could. A screen reader still has
			     to be told that the selection moved, because focus stays in the
			     input while the arrow keys walk the sentence. -->
			${this._clauseSelectionMessage ? html`<div class='visually-hidden' role='status'>${this._clauseSelectionMessage}</div>` : ''}
			${this._activationPending || this._activationMessage ? html`
				<div class='activation-message' ?data-problem=${Boolean(this._activationMessage)} role=${this._activationMessage ? 'alert' : 'status'} aria-live=${ifDefined(this._activationMessage ? undefined : 'polite')}>
					${this._activationMessage || 'Opening collection…'}
				</div>
			` : ''}
			${this._paletteListRender(rows, highlightedIndex)}
			<div class='key-hints'>${this._composerKeyHints(rows, highlighted)}</div>
			${this._modifierNoteRender()}
			${this._compiledPathRender()}
			<div class='mode-links'>
				<button class='small verb' @click=${this._handleBrowseToggle}>${this._browseOpen ? 'Hide all filters' : 'Browse all filters'}</button>
				<button class='small verb' @click=${this._handleEditSource}>Edit source</button>
			</div>
			${this._openActionRender(
		draftCount,
		this._activationPending,
		this._activationPending ? 'Already opening this collection' : 'Open this collection',
		this._handleOpenCurrentDraft,
		Boolean(highlighted)
	)}
		`;
	}

	//THE INPUT SAYS WHAT QUESTION IT IS ASKING. Ordinarily it continues the
	//sentence; scoped by "or…" it is asking for an alternative to ONE named
	//condition, and a placeholder that went on saying "type another condition"
	//would be describing the wrong edit.
	get _inputPlaceholder() : string {
		if (this._orTarget) {
			const label = this._readableComposerFilter(pillRowSpellingFor(this._draftExpression, this._orTarget.index, -1));
			return `Also match… (widens ${label})`;
		}
		if (this._browseOpen) return 'Search dates, tags, authors, relationships…';
		return 'Type another condition…';
	}

	//THE FOOTER STATES THE CONTRACT THAT IS ACTUALLY IN FORCE.
	//
	//Spec: "A persistent, context-sensitive footer states the active contract,
	//for example Tab Add · Enter Open · Esc Cancel." Two of the states this
	//line stated were not true.
	//
	//'Click edits' was printed whenever a list was on screen with nothing
	//highlighted — including when every row in it was a destination that
	//clicking OPENS, which is the one verb a footer must never get wrong. With
	//nothing highlighted the rows differ from each other, so the honest line
	//makes no claim about them at all and describes only the keys that mean the
	//same thing whichever row the user is looking at. Each highlighted state
	//then names that row's own verbs.
	//
	//And the main state never named Escape, though the spec's own example
	//contract ends with it and it is the only way out that does not navigate.
	//The word comes from the canonical combo table, like every other key this
	//dialog names, rather than being spelled a second way here.
	//
	//The branches are ordered the way _activateRow already orders them — source,
	//then set-up-and-add, then the plain action — so the footer cannot promise a
	//verb the click would not perform.
	//
	//AND A TOUCH LAYOUT HAS NO KEYBOARD TO STATE A CONTRACT FOR. On a phone this
	//line named ↑↓, Tab, Click and Escape — four inputs the device does not
	//have — which is the same defect as the wrong verb, one level up: a footer
	//that describes controls the user cannot reach. The touch line points at the
	//affordances that ARE there rather than restating a keyboard grammar, and it
	//makes no per-row claim, for the same reason the nothing-highlighted desktop
	//branch makes none.
	//
	//THE PILL ROW'S OWN KEYS COME FROM THE MODULE THAT PERFORMS THEM
	//(PILL_ROW_KEY_HINTS), so the line that teaches `+ adds an or` and the row
	//that implements it cannot drift apart. `+` and `-` are deliberately the
	//URL's own spellings for union and exclusion: the shortcut a user learns
	//here is the character they will one day read in the compiled-path line
	//under the list, and then in Source.
	_composerKeyHints(rows : PaletteRow[], highlighted : PaletteRow | undefined) : string {
		const escapeHint = `${shortcutKeys('dialog-escape')} cancels`;
		if (this.mobile) {
			if (this._browseOpen) return 'Tap a filter to add it or set it up';
			if (this._pillRowOpen) return 'Editing a clause · tap its verbs to change it · tap another pill to edit that one';
			return rows.length ?
				'Tap a row to use it · tap the open button for this collection' :
				'Type to compose · tap the open button for this collection';
		}
		//A SCOPED INPUT STATES ITS OWN SCOPE. Every row is an alternative
		//joining one named condition, so the generic line would be describing a
		//different list.
		if (this._orTarget) return `Type an alternative · Tab widens the clause · ${shortcutKeys('dialog-escape')} goes back to the pill`;
		//THE PILL ROW OWNS THE PILL'S KEYS while a pill is selected, and the
		//line names them from the module that performs them.
		if (this._pillRowOpen) {
			const keys = PILL_ROW_KEY_HINTS.map(hint => `${hint.key} ${hint.means}`).join(' · ');
			return `←→ choose clause · ${keys} · ${shortcutKeys('dialog-escape')} closes the row`;
		}
		if (!highlighted) {
			return rows.length ?
				`↑↓ or Tab choose · Enter opens this collection · ${escapeHint}` :
				`Type to compose · Enter opens this collection · ${escapeHint}`;
		}
		if (highlighted.sourceFilter) return '↑↓ choose · Click, Tab, or Enter opens Source';
		if (highlighted.configurable && highlighted.filter) return '↑↓ choose · Click, Tab, or Enter adds it and opens its controls';
		//A destination: clicking it and Enter do the same thing, and Tab is the
		//spec's labeled secondary action.
		if (highlighted.navigates) return '↑↓ choose · Click or Enter opens · Tab copies it into the draft';
		return '↑↓ choose · Click or Tab adds · Enter adds and opens';
	}

	//BOTH modes explain an inert modifier the same way, in the same place: on
	//the key-hints line, which is where the composer already states its key
	//contract.
	_modifierNoteRender() {
		if (!this._modifierNote) return '';
		return html`<div class='key-hints modifier-note' role='status'>${this._modifierNote}</div>`;
	}

	//BOTH modes commit through the same control, so it is described once.
	//
	//§3.3 makes the one committing action of a dialog a `button.round.primary`
	//glyph, and §4.2 has no variant whose visible label changes under the user.
	//The count is therefore a READOUT beside the button rather than part of it:
	//it says what this button would open, the way find-dialog's OPEN_IN_BROWSER
	//glyph says where its own navigate control goes. That also retires the
	//uncomfortable half of the old arrangement, where the accessible name had to
	//be pinned STATIC against a visible label that kept changing — with no
	//label, the two can simply agree.
	//
	//When there is no count and none is arriving the readout is EMPTY, not the
	//action phrase: the button's title already says 'Open this collection' on
	//hover, and repeating it as body text would put a second, competing label
	//next to a glyph that is meant to carry the name itself. The width is
	//reserved in CSS so an empty readout and a full one occupy the same room.
	//deemphasized: a suggestion is highlighted, so ENTER belongs to that row and
	//not to this button. The button's own act is unchanged — clicking it always
	//opens the draft — so its readout keeps naming the draft's count rather than
	//being repointed at a collection the button would not open. What changes is
	//weight: while the keyboard is on a row that carries its own number, the
	//draft's number recedes, and the two numbers on screen stop competing to be
	//"what Enter will do". The key-hints line directly above says which one it
	//is, and the reserved width means nothing moves either way.
	_openActionRender(count : number | undefined, disabled : boolean, reason : string, handler : (e : Event) => void, deemphasized = false) {
		return html`
			<div class='buttons composer-actions' ?data-deemphasized=${deemphasized}>
				<!-- '0 cards' is a number, not a sentence, and the spec asks for
				     the sentence: a draft that resolves to nothing has to SAY so
				     next to the control that would open it, or the user reads the
				     zero as a count still arriving. Only at a resolved zero —
				     undefined means the answer is not in yet, which is a
				     different fact (§3.6). -->
				${count === 0 ? html`<span class='no-cards-note'>${NO_CARDS_MATCH_NOTE}</span>` : ''}
				<!-- The count is LOADING, not in flight (§3.6): the user typed a
				     clause, not a request for a number, and the draft is fully
				     usable without it. That is exactly what loading-placeholder is
				     for, and it settles the colour question too — its header
				     documents --app-dark-text-color-light as failing WCAG AA, and
				     that is the token the hand-rolled '· counting…' used. -->
				<span class='action-count' role='status'>${count === undefined ?
		(this._draftCountPending ? html`<loading-placeholder noun='the card count'></loading-placeholder>` : '') :
		formatCollectionCardCount(count)}</span>
				<!-- The reason goes on the WRAPPER: Chrome and Safari suppress
				     hover on a disabled control, so on the button it would be
				     unreachable exactly when it is needed (§2.5). The button
				     keeps its own title and aria-label, which a wrapper title
				     does not supply. -->
				<span class='reason' title=${reason}>
					<button class='round primary' title='Open this collection' aria-label='Open this collection' ?disabled=${disabled} @click=${handler}>${OPEN_IN_BROWSER_ICON}</button>
				</span>
			</div>
		`;
	}

	//SPEC §Narrow: "Suggestions should be suppressed when they are redundant,
	//contradictory, or known to produce the same set." A narrowing clause whose
	//RESOLVED count is zero while the collection itself is not empty is
	//contradictory by measurement — offering 'Starred · 0 cards' in a list
	//headed "Refine" proposes a refinement that refines the collection out of
	//existence.
	//
	//Only in the empty-input state, which is the Refine list the spec is
	//talking about. Once the user has typed, the rows are INTERPRETATIONS of
	//what they typed, and hiding the filter somebody just named is a different
	//and worse defect. Browse all is unaffected either way, so a contradictory
	//clause is always still findable — this suppresses an unsolicited offer, not
	//the filter.
	//
	//Counts come from the retained map, keyed by COLLECTION, rather than from
	//_previewCounts, which is keyed by row id and rebuilt from the visible list:
	//suppressing a row on a count that then stops being requested because the
	//row is gone is an oscillation, not a suppression.
	_withoutContradictoryRefinements(suggestions : CollectionComposerSuggestion[]) : CollectionComposerSuggestion[] {
		if (this._composerInput.trim()) return suggestions;
		const draftCount = this._countForDescription(this._collectionDescription);
		if (draftCount === undefined || draftCount === 0) return suggestions;
		const filtered = suggestions.filter(suggestion =>
			suggestion.action !== 'add' || this._countForDescription(suggestion.description) !== 0);
		return filtered.length === suggestions.length ? suggestions : filtered;
	}

	//The index of the visibly highlighted row, or -1 when nothing is
	//highlighted. Everything that reads the highlight — the rendered marker,
	//aria-activedescendant, the key hints, and the keydown handlers — goes
	//through here, so "the transformation accepted on keydown is the one
	//visibly highlighted on keydown" is a structural property rather than a
	//coincidence.
	_activeHighlightIndex(rows : {length : number}) : number {
		if (!this._rowHighlightActive) return -1;
		if (!rows.length) return -1;
		return Math.min(this._highlightedRow, rows.length - 1);
	}

	//BOTH LISTS FOLLOW ONE POINTER RULE, so neither can end up with a hover fill
	//on one row and a keyboard highlight on another.
	_highlightListRowFromPointer(list : ComposerRowList, index : number) {
		if (list === 'palette') {
			this._highlightedRow = index;
			this._rowHighlightActive = true;
			return;
		}
		this._sourceCompletionIndex = index;
	}

	_handleRowPointerMove(list : ComposerRowList, index : number) {
		//A mousemove is proof the pointer actually moved, so it both arms
		//pointer highlighting and takes the highlight itself. mouseenter alone
		//is not proof: it also fires when rows shift under a resting cursor.
		this._pointerHighlightArmed = true;
		this._highlightListRowFromPointer(list, index);
	}

	_handleRowPointerEnter(list : ComposerRowList, index : number) {
		if (!this._pointerHighlightArmed) return;
		this._highlightListRowFromPointer(list, index);
	}

	get _contextualComposerCandidates() : CollectionComposerCandidate[] {
		return composerCandidatesFor(this._activeCard, this._composerCandidates, this._activeCardID);
	}

	get _composerFilterLabels() : Record<string, string> {
		return composerFilterLabelsFor(this._contextualComposerCandidates);
	}

	//Card id → title, for the clause namer to name an anchor with. The tag
	//infos are the map the key-card control already renders cards through, so
	//a card is called the same thing in the chip and in the control that
	//chose it.
	get _composerCardNames() : Record<string, string> {
		return composerCardNamesFor(this._cardTagInfos);
	}

	_readableComposerFilter(filter : string) : string {
		return collectionFilterDisplayName(filter, this._composerFilterLabels, this._composerCardNames);
	}

	//EVERY COMPLETION SAYS WHAT KIND OF THING IT IS.
	//
	//This function used to classify by the token alone, so anything it did not
	//recognize fell through to the last line — and the last line asserts
	//"filter". After `sort/`, every sort name in the app was therefore offered
	//as a filter, described as "A legal collection filter", in a list whose
	//heading says "Choose the next value". Three claims, one of them true.
	//
	//`kind` is the parser's answer to "which production is this?", which is the
	//only place that fact exists. It is consulted FIRST for the positions where
	//it is decisive (a sort name and a view name are never anything else), and
	//as a fallback for a filter ARGUMENT, whose token could be anything at all.
	//Between the two, the token-level rules stay: at a root position a candidate,
	//`sort`, `view`, a set name and a date boundary are each recognizable on
	//sight and each deserve their own word.
	_sourceCompletionPresentation(token : string, grammarDetail = '', kind : CollectionSourceExpectedKind = 'root') : {label: string, detail: string, category: string} {
		if (kind === 'sort') return {label: collectionOptionDisplayName(token), detail: grammarDetail || 'A card order', category: 'Sort'};
		if (kind === 'view') return {label: collectionOptionDisplayName(token), detail: grammarDetail || 'A way to display the collection', category: 'View'};
		const candidate = this._contextualComposerCandidates.find(item => item.filter === token);
		if (candidate) return {label: this._readableComposerFilter(token), detail: candidate.detail, category: sentenceCase(candidate.category)};
		if (token === 'sort') return {label: 'Choose an order', detail: grammarDetail || 'Control the order cards appear in', category: 'Sort'};
		if (token === 'view') return {label: 'Choose a view', detail: grammarDetail || 'Control how cards are displayed', category: 'View'};
		if (['main', 'everything', 'reading-list'].includes(token)) return {label: collectionOptionDisplayName(token), detail: grammarDetail || 'A starting set for the collection', category: 'Set'};
		if (['before', 'after', 'between', 'today', 'yesterday'].includes(token) || /-ago$/.test(token)) {
			return {label: this._readableComposerFilter(token), detail: grammarDetail || 'A date boundary', category: 'Date'};
		}
		if (kind === 'value') return {label: this._readableComposerFilter(token), detail: grammarDetail || 'A value this filter needs', category: 'Value'};
		return {label: this._readableComposerFilter(token), detail: grammarDetail || 'A legal collection filter', category: 'Filter'};
	}

	//The same contract Source mode has always stated, plus the touch branch the
	//quick composer needed for the same reason: on a phone there is no ↑↓, no
	//Tab and no Escape key, so naming them is a contract the device cannot keep.
	_sourceKeyHints(hasCompletions : boolean, completionMode : string, valid : boolean) : string {
		if (this.mobile) {
			if (hasCompletions) return completionMode === 'add' ? 'Tap a row to add it to the source' : 'Tap a row to fill in the next value';
			return valid ? 'Tap the open button for this collection' : 'Keep editing — the note above says what is missing';
		}
		if (hasCompletions) {
			return completionMode === 'add' ?
				`↑↓ choose · Tab adds · Enter opens · ${shortcutKeys('dialog-escape')} dismisses suggestions` :
				`↑↓ choose · Tab or Enter completes · ${shortcutKeys('dialog-escape')} dismisses suggestions`;
		}
		return valid ?
			`Enter opens · ${shortcutKeys('dialog-escape')} cancels` :
			`Keep editing · ${shortcutKeys('dialog-escape')} cancels`;
	}

	constructor() {
		super();
		this.title = collectionComposerEnabled() ? 'Compose a Collection' : 'Configure Collection';
	}

	_handleSourceInput(e : InputEvent) {
		const input = e.composedPath()[0];
		if (!(input instanceof HTMLTextAreaElement)) throw new Error('not textarea element');
		//A line break is not a character any path can contain, and it is not a
		//commit either — the commit half of this pair already refused to let one
		//be typed. Left in, the segment logic below reads it as the start of a
		//new filter and closes it with a slash nobody asked for, so `…/` becomes
		//`…/\n/` and the editor can only report "Empty path segments are not
		//allowed": true, and no help at all about the newline that caused it.
		const value = input.value.replace(SOURCE_LINE_BREAKS, '');
		const rawCaret = input.selectionStart;
		const before = input.value.slice(0, rawCaret);
		const nextCaret = rawCaret - (before.length - before.replace(SOURCE_LINE_BREAKS, '').length);
		//WHICH WAY THE TEXT WENT, ASKED OF THE EVENT THAT KNOWS.
		//
		//Comparing prefixes cannot tell a deletion from an insertion, and with an
		//auto-delimiter in play the two are literally indistinguishable that way:
		//"backspaced over the closing slash" and "still extending this segment"
		//both satisfy startsWith(). Read as an extension, a deletion was answered
		//by re-appending the very slash it had just removed — the keystroke
		//silently undone, and _sourceInput left holding a string the textarea no
		//longer showed. The InputEvent states outright which it was.
		//Every real edit names itself; an event that does not is treated as an
		//insertion, which is what the untyped path meant before it was asked.
		const inputType = e.inputType || 'insertText';
		const deleting = inputType.startsWith('delete');
		const inserting = inputType.startsWith('insert');
		const previous = this._sourceInput;
		//An insertion that already ends in a delimiter closed its own segment —
		//a pasted `starred/updated/`, say. Adding another only manufactures the
		//empty segment the parser then has to complain about.
		const startsNewFilter = inserting && !this._sourceAutoDelimitedSegment && previous.endsWith('/') &&
			value.startsWith(previous) && value.length > previous.length && !value.endsWith('/') &&
			Boolean(this._parsedSource.nextExpected?.length);
		let nextValue = value;
		if (startsNewFilter) {
			nextValue += '/';
			this._sourceAutoDelimitedSegment = true;
		} else if (this._sourceAutoDelimitedSegment && deleting) {
			//The delimiter was this editor's idea, so this editor takes it back.
			//Backspacing away the last character of the segment it was closing
			//leaves that slash butted against the one before it — `//`, which is
			//the "empty path segment" error, arrived at by deleting. Retract the
			//delimiter with the segment and the source lands back where it was
			//before the character was ever typed.
			const emptiedSegment = nextValue.endsWith('/') && nextCaret === nextValue.length - 1 &&
				nextCaret > 0 && nextValue[nextCaret - 1] === '/';
			if (emptiedSegment) nextValue = nextValue.slice(0, -1);
			this._sourceAutoDelimitedSegment = !emptiedSegment && nextValue.endsWith('/') && nextCaret === nextValue.length - 1;
		} else if (this._sourceAutoDelimitedSegment && inserting) {
			const extendsAutoDelimitedValue = value.startsWith(previous.slice(0, -1));
			if (extendsAutoDelimitedValue && !value.endsWith('/')) nextValue += '/';
			const caretBeforeDelimiter = nextValue.endsWith('/') && nextCaret === nextValue.length - 1;
			this._sourceAutoDelimitedSegment = caretBeforeDelimiter && nextValue !== previous.slice(0, previous.lastIndexOf('/') + 1);
		}
		//The textarea is where this has to end up, and a re-render cannot be
		//counted on to put it there: when the rewrite lands back on the string
		//the component already held, nothing in the render tree changed and Lit
		//has nothing to commit — the stripped newline would stay on screen. Write
		//it where it has to go, then let the render agree.
		const rewrote = nextValue !== input.value;
		if (rewrote) {
			input.value = nextValue;
			input.setSelectionRange(nextCaret, nextCaret);
		}
		this._sourceInput = nextValue;
		this._sourceDirty = true;
		this._activationMessage = '';
		this._sourceReturnWarning = false;
		this._sourceCompletionsDismissed = false;
		this._sourceCompletionIndex = 0;
		const parsed = this._parsedSource;
		if (parsed.status === 'valid') this._lastValidSource = parsed;
		if (rewrote || this._sourceAutoDelimitedSegment) this.updateComplete.then(() => {
			const sourceInput = this.shadowRoot?.querySelector<HTMLTextAreaElement>('#collection-source-input');
			sourceInput?.setSelectionRange(nextCaret, nextCaret);
		});
	}

	_handleSourceKeyDown(e : KeyboardEvent) {
		if (e.isComposing || e.keyCode === 229) return;
		//Commit handling is MODE-EXCLUSIVE. Both halves of this pair decline
		//outright when the composer is not in their mode, and decline a
		//keystroke another handler has already spent.
		if (this._entryMode !== 'source') return;
		if (committedKeystrokes.has(e)) return;
		//A keystroke means the keyboard owns the highlight again, in this mode
		//as in the other one: the completions list is painted by the same rules
		//and must not show a hover fill on a row the keyboard is not on.
		this._pointerHighlightArmed = false;
		if (e.key === 'Enter' && e.shiftKey) {
			this._refuseNewTab(e);
			return;
		}
		const parsed = this._parsedSource;
		const completionDiagnostic = parsed.diagnostics.find(item => item.expected?.length);
		const completions = this._sourceCompletionsDismissed ? [] : (completionDiagnostic?.expected || parsed.nextExpected || []);
		if (completions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
			e.preventDefault();
			const direction = e.key === 'ArrowDown' ? 1 : -1;
			this._sourceCompletionIndex = (this._sourceCompletionIndex + direction + completions.length) % completions.length;
			return;
		}
		//Shift-Tab is reverse focus traversal, here as everywhere else: it must
		//not accept a completion any more than it materializes a suggestion in
		//the quick composer.
		if (completions.length && ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'Enter' && completionDiagnostic))) {
			e.preventDefault();
			this._acceptSourceCompletion(completions[this._sourceCompletionIndex]);
			return;
		}
		if (completions.length && e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			this._sourceCompletionsDismissed = true;
			return;
		}
		if (e.key !== 'Enter') return;
		e.preventDefault();
		//The other half of "mode-exclusive": the keystroke stops here rather
		//than continuing up the tree to whatever else is listening. #740's
		//registry already declines a defaultPrevented event; this covers the
		//local listeners it does not speak for.
		e.stopPropagation();
		if (parsed.status !== 'valid') return;
		committedKeystrokes.add(e);
		this._handleOpenSource();
	}

	_acceptSourceCompletion(completion : string) {
		const parsedBefore = this._parsedSource;
		const addingToValidSource = parsedBefore.status === 'valid' &&
			!parsedBefore.diagnostics.some(item => item.expected?.length) && Boolean(parsedBefore.nextExpected?.includes(completion));
		const input = this.shadowRoot?.querySelector<HTMLTextAreaElement>('#collection-source-input');
		let nextCaret : number;
		if (addingToValidSource) {
			this._sourceInput = `${this._sourceInput}${completion}/`;
			nextCaret = this._sourceInput.length;
		} else {
			const selectionStart = input?.selectionStart ?? this._sourceInput.length;
			const selectionEnd = input?.selectionEnd ?? selectionStart;
			const segmentStart = this._sourceInput.lastIndexOf('/', Math.max(0, selectionStart - 1)) + 1;
			const followingSlash = this._sourceInput.indexOf('/', selectionEnd);
			const segmentEnd = followingSlash < 0 ? this._sourceInput.length : followingSlash;
			const prefix = this._sourceInput.slice(0, segmentStart);
			const suffix = this._sourceInput.slice(segmentEnd);
			const needsSlash = !suffix.startsWith('/');
			this._sourceInput = `${prefix}${completion}${needsSlash ? '/' : ''}${suffix}`;
			nextCaret = prefix.length + completion.length + (needsSlash || suffix.startsWith('/') ? 1 : 0);
		}
		this._sourceDirty = true;
		this._sourceAutoDelimitedSegment = false;
		this._sourceCompletionsDismissed = false;
		this._sourceCompletionIndex = 0;
		const parsed = this._parsedSource;
		if (parsed.status === 'valid') this._lastValidSource = parsed;
		this.updateComplete.then(() => {
			const sourceInput = this.shadowRoot?.querySelector<HTMLTextAreaElement>('#collection-source-input');
			sourceInput?.focus();
			sourceInput?.setSelectionRange(nextCaret, nextCaret);
		});
	}

	_handleEditSource() {
		this._openSource();
	}

	_openSource(filterToAppend = '') {
		if (!this._sourceDirty) {
			const appendedFilter = filterToAppend ? `${filterToAppend}/` : '';
			//The filter being appended may be a HALF-TYPED clause, so it is
			//spliced into the text rather than appended to the description —
			//but the part before it is still built by the one path builder, so
			//the bare Main draft opens Source at `/c/main/` and not at `/c/`.
			const base = collectionURLPath(this._collectionDescription, {originalOrder: true});
			this._sourceInput = `${base}${appendedFilter}${this._draftSelectedCard}`;
			this._sourceDirty = Boolean(filterToAppend);
		}
		store.dispatch(openConfigureCollectionDialog('source'));
	}

	_handleBackToCompose() {
		const parsed = this._parsedSource;
		if (parsed.status === 'valid' && parsed.description) {
			this._commitDraftEdit(parsed.description, 'Applied source to the visual draft', false, parsed.selectedCardRaw);
			this._sourceDirty = false;
		} else {
			this._sourceReturnWarning = true;
			this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLElement>('#collection-source-return-warning')?.focus());
			return;
		}
		store.dispatch(openConfigureCollectionDialog('compose'));
		this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
	}

	_returnToLastValidSource() {
		if (this._lastValidSource?.description) {
			this._commitDraftEdit(this._lastValidSource.description, 'Returned to the last valid source', false, this._lastValidSource.selectedCardRaw);
			this._sourceInput = this._lastValidSource.canonicalPath || this._sourceInput;
			this._sourceDirty = false;
		}
		this._sourceReturnWarning = false;
		store.dispatch(openConfigureCollectionDialog('compose'));
		this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
	}

	//A transient outcome is a snackbar (§3.5, §5) — not a fourth kind of inline
	//message with its own state field, its own CSS and its own lifetime rules.
	//card-view's copy button on the same collection says exactly these two
	//sentences; two spellings of one outcome is how sync-copy's eight sentences
	//happened. Now that the success message is COMPOSED rather than literal,
	//keeping the two in step means calling one builder, not copying one string:
	//collection-link-copy.ts owns the wording for both.
	async _handleCopySourceLink() {
		const parsed = this._parsedSource;
		const path = parsed.canonicalPath;
		if (!path) return;
		try {
			await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
			//The description that produced the path, so the sentence describes
			//what was actually copied rather than the draft it came from — and
			//_countForDescription for the same reason the arrival receipt uses
			//it: a count belongs to the collection it was measured for. Reaching
			//for the DRAFT's count here said '0 cards' about a link to a
			//collection nobody had counted, which is the one thing worse than
			//saying no number at all. A collection nobody previewed gets no
			//count segment rather than somebody else's.
			const description = parsed.description || this._collectionDescription;
			store.dispatch(showSnackbar(collectionLinkCopiedMessage(description, this._composerFilterLabels, this._countForDescription(description), this._composerCardNames)));
		} catch {
			store.dispatch(showSnackbar(COLLECTION_LINK_COPY_FAILED_MESSAGE, {kind: 'refused'}));
		}
	}

	//Whether a destination names the collection already on screen. Collections
	//are compared, not URL spellings: `/c/main/sort/default/` and `/c/` are the
	//same collection said two ways, and navigatePathToResult only compares
	//paths — so a textually different spelling of the active route pushed a
	//duplicate history entry for a navigation that went nowhere.
	//
	//`selectedCard` is the card the destination would request, or null for a
	//destination that carries its own path and so may legitimately be a real
	//navigation to a different card within the same collection.
	_destinationIsActiveCollection(description : CollectionDescription, selectedCard : string | null) : boolean {
		if (selectActiveCollectionDescription(store.getState() as State).serialize() !== description.serialize()) return false;
		return selectedCard === null || selectedCard === this._requestedCard;
	}

	//Whether the card a destination path selects survives into that
	//destination. Run once, at commit, over the real collection — not on the
	//typing path, and only when there is a card at stake.
	_destinationContainsCard(description : CollectionDescription, cardIDOrSlug : string) : boolean {
		const state = store.getState() as State;
		const cardID = getIdForCard(state, cardIDOrSlug);
		//A card this app has never heard of is not evidence that the
		//destination excludes it — it may simply not be loaded yet. Dropping
		//the suffix on that basis would throw away a card the user asked for,
		//which is the opposite of the bug being fixed here.
		if (!selectCards(state)[cardID]) return true;
		const collection = description.collection(selectCollectionConstructorArguments(state));
		return collection.finalSortedCards.some(card => card.id === cardID);
	}

	//SPEC §Navigation to selected card: when a draft transformation removes the
	//selected card from the result, committing navigates to the DEFAULT item in
	//the new collection. Keeping the suffix stranded the user — the URL still
	//named a card the new collection does not contain, so the stage went on
	//rendering it while the drawer highlighted nothing and the arrow keys, which
	//walk the collection by the selected card's index, had nowhere to step.
	//
	//Applied to the finished PATH rather than to each producer of one, so every
	//route into a commit — quick composer, recents, Source, a suggestion
	//carrying its own destinationPath — is covered by construction. A
	//well-formed collection path is `<collection>/<card>`, so dropping the card
	//leaves the trailing slash that already means "the default item".
	_pathWithLiveSelectedCard(path : string) : string {
		if (!path.startsWith(COLLECTION_URL_PREFIX)) return path;
		const [description, selectedCard] = CollectionDescription.deserializeWithExtra(path.slice(COLLECTION_URL_PREFIX.length));
		if (!selectedCard || cardIDIsPlaceholder(selectedCard)) return path;
		return commitPathDroppingLostCard(path, selectedCard, this._destinationContainsCard(description, selectedCard));
	}

	//What the router will ACTUALLY make active for a path, asked of the router's
	//own resolution rather than guessed at. A receipt built from the requested
	//description said "Now showing Main · 765 cards" about a URL that had landed
	//somewhere else entirely; built from this, a wrong landing is at least
	//reported honestly.
	_arrivedDescription(fallback : CollectionDescription) : CollectionDescription {
		const state = store.getState() as State;
		//navigatePathToResult dispatches UPDATE_PAGE synchronously, so pageExtra
		//is already the committed path by the time a commit path reads it.
		const pageExtra = selectPageExtra(state);
		//An EMPTY page extra is not "nothing to go on": it is precisely the
		//`/c/` case, and card-view answers it by navigating to the app's own
		//default collection. Naming the draft there is how "Now showing Main ·
		//765 cards" ended up over a screen showing the default view instead.
		if (!pageExtra) return selectDefaultCollectionDescription(state) || fallback;
		return resolveCardSelector(state, pageExtra).description;
	}

	//The receipt's count must be the ARRIVAL's count, not the request's. Counts
	//are retained by collection, so an arrival that matches something already
	//previewed has one; an arrival nobody previewed gets no count rather than
	//somebody else's.
	_countForDescription(description : CollectionDescription) : number | undefined {
		return this._retainedPreviewCounts.get(this._previewCountKey(description));
	}

	//One place both commit paths report from, so the receipt cannot drift from
	//what arrived.
	_showArrivalReceipt(returnPath : string, requested : CollectionDescription) {
		const arrived = this._arrivedDescription(requested);
		showCollectionNavigationReceipt(
			returnPath,
			readableCollectionExpression(arrived, this._composerFilterLabels, this._composerCardNames),
			this._countForDescription(arrived)
		);
	}

	_handleOpenSource() {
		//Mode-exclusive: the Source commit belongs to Source mode only.
		if (this._entryMode !== 'source') return;
		const parsed = this._parsedSource;
		if (parsed.status !== 'valid' || !parsed.description || !parsed.canonicalPath || this._activationPending) return;
		//Spec ("Committing navigation"): a draft equivalent to the collection
		//already open simply closes the composer — no push, no receipt. Source
		//is a second spelling of the same draft and gets the same answer; it
		//used to push, and then say "Now showing …" about a navigation that
		//never happened.
		if (this._destinationIsActiveCollection(parsed.description, parsed.selectedCardRaw)) {
			store.dispatch(cancelConfigureCollectionDialog());
			return;
		}
		this._activationPending = true;
		this._activationMessage = '';
		//Captured before the push, because that is what Undo returns to.
		const returnPath = window.location.pathname;
		const result = store.dispatch(navigatePathToResult(this._pathWithLiveSelectedCard(parsed.canonicalPath)));
		if (result.status === 'blocked-editing') {
			this._activationPending = false;
			this._activationMessage = 'Finish or cancel the current card edit before opening this collection.';
			return;
		}
		if (result.status === 'unchanged') {
			this._activationPending = false;
			store.dispatch(cancelConfigureCollectionDialog());
			return;
		}
		store.dispatch(cancelConfigureCollectionDialog());
		this._showArrivalReceipt(returnPath, parsed.description);
	}

	_handleComposerInput(e : InputEvent) {
		const input = e.composedPath()[0];
		if (!(input instanceof HTMLInputElement)) throw new Error('not input element');
		this._composerInput = input.value;
		//TYPING LEAVES A SEEDED LIST. Browse all and the sentence-word lists are
		//answers to a gesture; a keystroke is a new question, and the completions
		//are its answer. The exception is an OR-scoped input, where typing is
		//precisely what the scope asked for — so the scope, and the pill row
		//under it, survive.
		if (!this._orTarget) {
			this._selectedPath = [];
			this._clauseSelectionMessage = '';
			this._wordScope = '';
		}
		this._highlightedRow = 0;
		//Typed text makes the list interpretations of what was typed, so the
		//top interpretation is the highlighted one and Enter opens it. Emptying
		//the input returns the list to destinations nobody has pointed at, and
		//Enter goes back to meaning "open the draft".
		this._rowHighlightActive = Boolean(input.value.trim());
		this._pointerHighlightArmed = false;
		this._activationMessage = '';
	}

	_handleComposerKeyDown(e : KeyboardEvent) {
		if (this._activationPending) {
			e.preventDefault();
			e.stopPropagation();
			return;
		}
		if (e.isComposing || e.keyCode === 229) return;
		//Commit handling is MODE-EXCLUSIVE; see _handleSourceKeyDown.
		if (this._entryMode !== 'compose') return;
		if (committedKeystrokes.has(e)) return;
		if (e.key === 'Enter' && e.shiftKey) {
			this._refuseNewTab(e);
			return;
		}
		//A keystroke means the keyboard owns the highlight again: a resting
		//pointer must not take it back when the list re-renders underneath.
		this._pointerHighlightArmed = false;
		const rows = this._paletteRows;
		if (!this._composerInput && this._draftExpression.length && this._handleSentenceKeyDown(e)) return;
		const highlightedIndex = this._activeHighlightIndex(rows);
		const highlighted = rows[highlightedIndex];
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			if (!rows.length) return;
			e.preventDefault();
			e.stopPropagation();
			const direction = e.key === 'ArrowDown' ? 1 : -1;
			//Arrowing into a list with nothing highlighted lands on the first
			//(or last) row instead of skipping one.
			this._highlightedRow = highlightedIndex < 0 ?
				(direction === 1 ? 0 : rows.length - 1) :
				(highlightedIndex + direction + rows.length) % rows.length;
			this._rowHighlightActive = true;
			return;
		}
		if (e.key === 'Tab' && !e.shiftKey && rows.length) {
			e.preventDefault();
			e.stopPropagation();
			//Tab is how the keyboard reaches the list without typing first.
			//With nothing highlighted it highlights the first row — the list
			//becomes enterable — and with a row highlighted it MATERIALIZES
			//that row: the valence's own expression becomes the draft, the
			//input clears, and focus stays where it was. A destination
			//materializes as its expression rather than opening, which is the
			//labeled secondary action the spec allows for an Open row.
			if (!highlighted) {
				this._highlightedRow = 0;
				this._rowHighlightActive = true;
				return;
			}
			this._activateRow(highlighted, false);
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			committedKeystrokes.add(e);
			//Spec: Enter opens the highlighted destination including its visible
			//preview, or the current draft when no row is highlighted.
			if (highlighted) this._activateRow(highlighted, true);
			else this._handleOpenCurrentDraft();
		}
	}

	//THE SENTENCE'S OWN KEYS, DRIVEN FROM THE INPUT.
	//
	//The sentence implements this grammar itself when it has focus, but focus
	//lives in the input for the whole composing flow — a user who has just typed
	//a clause and wants to flip it should not have to Tab into a toolbar first.
	//So the input forwards the keys, and the two implementations agree because
	//they call the same editing helpers on the same tree.
	//
	//Returns whether the key was spent here, so the list's own keys are reached
	//only by a keystroke the sentence did not want.
	_handleSentenceKeyDown(e : KeyboardEvent) : boolean {
		const expression = this._draftExpression;
		const path = this._selectedPath;
		const memberIndex = this._selectedMemberIndex;
		switch (e.key) {
		case 'Backspace':
			e.preventDefault();
			e.stopPropagation();
			//TWO-STEP, as it always was: the first Backspace on an empty input
			//SELECTS the last condition and says so, and only the second one
			//removes it. Deleting on the first keystroke would make an
			//unrecoverable edit out of a key people press without looking.
			if (!path.length) {
				this._selectToken([expression.length - 1]);
				this._clauseSelectionMessage = `${this._selectedTokenLabel} selected · Backspace again to remove`;
				return true;
			}
			this._removeSelectedToken();
			return true;
		case 'Delete':
			if (!path.length) return false;
			e.preventDefault();
			e.stopPropagation();
			this._removeSelectedToken();
			return true;
		case 'Enter':
			//ENTER EDITS THE SELECTED PILL, which is what the footer's own key
			//table (PILL_ROW_KEY_HINTS) promises. The row is already open, so
			//"edit" means putting the caret in its first control.
			if (!path.length) return false;
			e.preventDefault();
			e.stopPropagation();
			committedKeystrokes.add(e);
			void this._focusPillRowControl();
			return true;
		case '+':
			//THE URL'S OWN SPELLING FOR UNION, as the shortcut for adding one.
			//The compiled-path line under the list is where the user sees the
			//character they just pressed appear in a path (proposal C §4.6).
			if (!path.length) return false;
			e.preventDefault();
			e.stopPropagation();
			this._requestOr(path[0], memberIndex);
			return true;
		case '-':
			//And the URL's own spelling for exclusion. It flips through the
			//draft layer, so `published` becomes the WORD `unpublished` rather
			//than an operator.
			if (!path.length) return false;
			e.preventDefault();
			e.stopPropagation();
			this._applyExpression(memberIndex < 0 ?
				withNegationToggled(expression, path[0]) :
				withMemberNegationToggled(expression, path[0], memberIndex), '', path);
			return true;
		case 'ArrowLeft':
		case 'ArrowRight': {
			e.preventDefault();
			e.stopPropagation();
			const last = expression.length - 1;
			if (e.key === 'ArrowLeft') {
				this._selectToken([path.length ? Math.max(0, path[0] - 1) : last]);
				return true;
			}
			const next = path.length ? path[0] + 1 : 0;
			if (next > last) this._clearSelection();
			else this._selectToken([next]);
			return true;
		}
		default:
			return false;
		}
	}

	//Spec's keyboard table offers Shift-Enter as "open in a new browser tab, IF
	//browser behavior can be supported safely". It cannot be: the app holds a
	//one-active-tab ownership lease, so a second tab of the same corpus is
	//precisely the state that lease exists to prevent. Silently treating the
	//modifier as a plain Enter is the worst of the three options — the user asks
	//for a new tab and gets a navigation in this one with no word about it.
	//
	//So the modifier is deliberately INERT on both commit paths, and says so
	//once per composer session (a note repeated on every press would be nagging
	//about a key the user is entitled to keep trying).
	_refuseNewTab(e : KeyboardEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (this._newTabNoteShown) return;
		this._newTabNoteShown = true;
		this._modifierNote = NEW_TAB_UNSUPPORTED_NOTE;
	}

	//--- Choosing a row -------------------------------------------------------

	//WHAT A ROW DOES, IN ONE PLACE. The footer's branches read this order back,
	//so the line that promises a verb and the handler that performs it cannot
	//disagree — which they did, in the list this replaces, for the whole life of
	//the catalog's verb chips.
	_activateRow(row : PaletteRow, open : boolean) {
		//A clause this layer will not compose. Source is the honest offer, and
		//the family is spliced into the text so the user lands where the clause
		//would go rather than at the end of a path.
		if (row.sourceFilter) {
			this._openSource(row.sourceFilter.split('/')[0]);
			return;
		}
		//A row that names a FAMILY rather than a clause. Nothing is pending any
		//more: the clause lands in the draft with the family's own defaults and
		//its pill row opens on it, so the count beside the sentence is already
		//the count of what was chosen and Undo is one click away. The old
		//explicit-confirm gate existed because the panel it gated was a
		//six-control wall the draft could not show; a one-line row under the
		//sentence needs no gate.
		//This branch is for a feed that has no expression to apply — Browse all
		//and the Refine rows that name a family. A typed family arrives as a
		//valence row with a real expression, and is handled after the commit.
		if (row.kind === 'transform' && row.configurable && row.filter) {
			void this._addFamilyWithDefaults(row.filter.split('/')[0]);
			return;
		}
		if (open) {
			this._openDestination(row.description, row.destinationPath || '', false, row.label);
			return;
		}
		//A destination materialized by Tab is not "added"; the draft becomes it.
		//Everything else says what it did to the draft, derived from the same
		//canonical names the row used.
		this._commitDraftEdit(row.description, row.navigates ? `Replaced the draft with ${row.label}` : '', true);
		this._composerInput = '';
		this._highlightedRow = 0;
		this._orTarget = null;
		this._browseOpen = false;
		this._wordScope = '';
		//A TYPED FAMILY OPENS ITS CONTROLS TOO. The clause it just added is a
		//real collection, but the arguments are the point of a configurable
		//family — so the pill it produced is selected and its row appears under
		//the sentence, exactly as it does when the family is chosen by name.
		//Only an `add`: an `or` fuses into a group and a `not` is a flip, and
		//neither of those is the gesture "set this up".
		if (row.configurable && row.valenceKind === 'add') {
			const expression = this._draftExpression;
			if (expression.length) {
				this._selectToken([expression.length - 1]);
				void this._focusPillRowControl();
			}
		}
	}

	//THE ONE COMMIT PATH, AND EVERY GUARD IT EVER GREW. Ported whole: the
	//already-active semantic close, the editing block, the unchanged-route
	//report, the return path captured BEFORE the push, and the receipt built
	//from what actually arrived. The only thing that changed is what hands it a
	//destination.
	_openDestination(description : CollectionDescription, explicitPath : string, isDraft : boolean, name : string) {
		if (this._activationPending) return;
		//A destination carrying its own path can still be a real navigation (a
		//different selected card, say), so only the draft — whose selected card
		//is checkable here — gets the semantic comparison when a path is present.
		const alreadyActive = (isDraft || !explicitPath) &&
			this._destinationIsActiveCollection(description, isDraft ? this._draftSelectedCard : null);
		if (alreadyActive) {
			//Spec: if the draft is equivalent to the active collection, Enter
			//simply closes the composer. Choosing a *destination* that is
			//already on screen is a different act: it navigates nowhere, so
			//say so rather than closing with no explanation, which would look
			//to the user like their draft evaporated.
			if (isDraft) {
				store.dispatch(cancelConfigureCollectionDialog());
				return;
			}
			this._activationMessage = ALREADY_ACTIVE_MESSAGE;
			return;
		}
		this._activationPending = true;
		this._activationMessage = '';
		//Captured before the push, because that is what Undo returns to.
		const returnPath = window.location.pathname;
		const destinationPath = this._pathWithLiveSelectedCard(
			explicitPath || collectionURLPath(description, {selectedCard: this._draftSelectedCard, originalOrder: true})
		);
		const result = store.dispatch(navigatePathToResult(destinationPath));
		if (result.status === 'blocked-editing') {
			this._activationPending = false;
			this._activationMessage = 'Finish or cancel the current card edit before opening this collection.';
			return;
		}
		if (result.status === 'unchanged') {
			this._activationPending = false;
			//Spec: if the draft is equivalent to the active collection, Enter
			//simply closes the composer without a duplicate history entry. A
			//chosen destination that turns out to resolve to the route already
			//on screen instead says so.
			if (isDraft) {
				store.dispatch(cancelConfigureCollectionDialog());
				return;
			}
			this._activationMessage = ALREADY_ACTIVE_MESSAGE;
			return;
		}
		store.dispatch(cancelConfigureCollectionDialog());
		this._showArrivalReceipt(returnPath, description);
		//Referenced so a future caller that wants the row's own name in the
		//receipt has it; the arrival's name is what actually gets reported.
		void name;
	}

	//--- Editing the sentence -------------------------------------------------

	//THE DRAFT IS A DESCRIPTION AND THE EXPRESSION IS A VIEW OF IT, so every
	//tree edit lands through the one seam and then through the one commit. That
	//is what keeps undo, draft preservation and the source round-trip working
	//on a boolean edit without any of them learning what a FilterExpressionNode
	//is.
	_applyExpression(expression : CollectionExpression, message = '', selectPath : CollectionSentencePath | null = null) {
		this._commitDraftEdit(collectionDescriptionWithExpression(this._collectionDescription, expression), message);
		if (selectPath && selectPath.length) this._selectToken(selectPath);
	}

	//WHETHER THE ADDRESS STILL NAMES THE SAME TOKEN after an edit. A flip and an
	//argument edit leave the shape alone, so the row stays open on the clause
	//the user is working on — closing it there is the defect the audited session
	//hit, where setting a start date made the panel vanish before the end date
	//could be set. A REMOVAL changes the shape, and then the address means
	//something else: index 0 of a two-condition sentence names the survivor
	//after the first is removed, so keeping the selection would silently
	//repoint the row at a clause nobody chose.
	_selectionSurvives(previous : CollectionExpression, next : CollectionExpression) : boolean {
		const path = this._selectedPath;
		if (!path.length) return false;
		if (previous.length !== next.length) return false;
		if (path.length < 2) return true;
		const members = (expression : CollectionExpression) => {
			const node = expression[path[0]];
			return node && node.kind === 'or' ? node.members.length : -1;
		};
		return members(previous) === members(next);
	}

	_handleExpressionModified(e : ExpressionModifiedEvent) {
		const previous = this._draftExpression;
		const survives = this._selectionSurvives(previous, e.detail.expression);
		const path = this._selectedPath;
		this._applyExpression(e.detail.expression, '', survives ? path : null);
		if (!survives) this._focusComposerInputSoon();
	}

	_handleTokenSelected(e : CollectionConditionEvent) {
		this._selectToken(e.detail.memberIndex >= 0 ? [e.detail.index, e.detail.memberIndex] : [e.detail.index]);
	}

	_handleTokenRemoved(e : CollectionConditionEvent) {
		const expression = e.detail.memberIndex >= 0 ?
			withMemberRemoved(this._draftExpression, e.detail.index, e.detail.memberIndex) :
			withConditionRemoved(this._draftExpression, e.detail.index);
		this._applyExpression(expression);
		this._focusComposerInputSoon();
	}

	_removeSelectedToken() {
		const path = this._selectedPath;
		if (!path.length) return;
		const memberIndex = this._selectedMemberIndex;
		this._applyExpression(memberIndex < 0 ?
			withConditionRemoved(this._draftExpression, path[0]) :
			withMemberRemoved(this._draftExpression, path[0], memberIndex));
	}

	get _selectedTokenLabel() : string {
		if (!this._selectedPath.length) return '';
		return this._readableComposerFilter(pillRowSpellingFor(this._draftExpression, this._selectedPath[0], this._selectedMemberIndex));
	}

	//SELECTING A TOKEN TAKES THE HIGHLIGHT AWAY FROM THE LIST. The key hints
	//already say so — the pill-row branch outranks every highlighted-row branch
	//— but a list that went on PAINTING its highlighted row would mean two
	//things read as selected and only one of them was what the next Enter would
	//take (spec: the transformation accepted on keydown is the one visibly
	//highlighted on keydown).
	_selectToken(path : CollectionSentencePath) {
		this._selectedPath = path;
		this._orTarget = null;
		this._rowHighlightActive = false;
		this._clauseSelectionMessage = path.length ? `${this._selectedTokenLabel} selected` : '';
	}

	_clearSelection() {
		this._selectedPath = [];
		this._orTarget = null;
		this._clauseSelectionMessage = '';
	}

	_requestOr(index : number, memberIndex : number) {
		this._orTarget = {index, memberIndex};
		this._composerInput = '';
		this._highlightedRow = 0;
		this._rowHighlightActive = false;
		this._focusComposerInputSoon();
	}

	_handlePillOrRequested(e : CollectionConditionEvent) {
		this._requestOr(e.detail.index, e.detail.memberIndex);
	}

	//SET AND SORT ARE WORDS, and clicking one fills the list with its
	//alternatives. The four-select setup strip is deleted; this is what replaced
	//it, and typing a set or sort name reaches the same rows through the
	//completion index.
	_handleSetWordClicked() {
		this._openWordScope('set');
	}

	_handleSortWordClicked() {
		this._openWordScope('sort');
	}

	_openWordScope(scope : PaletteWordScope) {
		this._wordScope = scope;
		this._browseOpen = false;
		this._clearSelection();
		this._composerInput = '';
		this._highlightedRow = 0;
		this._rowHighlightActive = false;
		this._focusComposerInputSoon();
	}

	_handleBrowseToggle() {
		this._browseOpen = !this._browseOpen;
		this._wordScope = '';
		this._clearSelection();
		this._composerInput = '';
		this._highlightedRow = 0;
		this._rowHighlightActive = false;
		this._focusComposerInputSoon();
	}

	//A FAMILY CHOSEN BY NAME LANDS IN THE DRAFT AND OPENS ITS ROW. If the draft
	//already has a clause from that family, the row opens on THAT clause instead
	//of adding a second one — which is what the catalog's "Already in this
	//collection" line used to say and this simply does.
	async _addFamilyWithDefaults(family : string) {
		const expression = this._draftExpression;
		const applied = expression.findIndex(node => {
			const spelling = serializeFilterNode(node);
			return spelling === family || spelling.startsWith(`${family}/`);
		});
		if (applied >= 0) {
			this._selectToken([applied]);
			this._composerInput = '';
			this._browseOpen = false;
			await this._focusPillRowControl();
			return;
		}
		const node : FilterExpressionNode = {kind: 'filter', filter: defaultConfigurableFilter(family)};
		const next = withConditionAppended(expression, node);
		this._composerInput = '';
		this._browseOpen = false;
		this._applyExpression(next, '', [next.length - 1]);
		await this._focusPillRowControl();
	}

	//FOCUS CAN ONLY LAND IN A CONTROL THAT EXISTS YET.
	//
	//Lit renders one component per microtask turn. Awaiting this dialog's
	//updateComplete gets the <collection-pill-row> ELEMENT into the DOM, but its
	//own first render — and the date/key-card/multiple-cards control nested one
	//level further in — happen on later turns. focusPrimaryControl works by
	//querying shadow roots, so calling it after a single await queries roots that
	//are still empty: it finds nothing, and focus stays behind in the composer
	//input, a dozen Tabs from the field the user just asked to edit.
	async _focusPillRowControl() {
		await this.updateComplete;
		const row = this.shadowRoot?.querySelector<HTMLElement & {updateComplete? : Promise<unknown>, focusPrimaryControl? : () => boolean}>('collection-pill-row');
		if (row?.updateComplete) await row.updateComplete;
		const nested = row?.shadowRoot?.querySelector<HTMLElement & {updateComplete? : Promise<unknown>}>(
			'.argument configure-collection-date, .argument configure-collection-key-card, .argument configure-collection-multiple-cards'
		);
		if (nested?.updateComplete) await nested.updateComplete;
		if (row?.focusPrimaryControl?.()) return;
		//A pill with no arguments has verbs and nothing else, and its first verb
		//is a live control inside the row — which is where "Enter edits" has to
		//land, rather than nowhere.
		row?.shadowRoot?.querySelector<HTMLElement>('button.verb')?.focus();
	}

	_focusComposerInputSoon() {
		this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
	}

	_commitDraftEdit(description : CollectionDescription, message = '', focusInput = false, selectedCard = this._draftSelectedCard) {
		this._draftUndoDescription = this._collectionDescription;
		this._draftUndoSelectedCard = this._draftSelectedCard;
		this._draftSelectedCard = selectedCard;
		this._draftReceiptMessage = message || collectionDraftReceipt(this._collectionDescription, description, this._composerFilterLabels, this._composerCardNames);
		this._selectedPath = [];
		//The draft just changed, so the list is about to be rebuilt around it.
		//Nothing in the new list is what the user was pointing at, so the next
		//Enter commits the draft they just composed.
		this._rowHighlightActive = false;
		this._pointerHighlightArmed = false;
		this._clauseSelectionMessage = '';
		store.dispatch(updateCollectionConfigurationSnapshot(description));
		if (focusInput) this._focusComposerInputSoon();
	}

	_undoDraftEdit() {
		if (!this._draftUndoDescription) return;
		const description = this._draftUndoDescription;
		const selectedCard = this._draftUndoSelectedCard;
		this._draftUndoDescription = null;
		this._draftUndoSelectedCard = null;
		if (selectedCard !== null) this._draftSelectedCard = selectedCard;
		this._draftReceiptMessage = 'Restored previous draft';
		this._selectedPath = [];
		this._orTarget = null;
		this._rowHighlightActive = false;
		this._pointerHighlightArmed = false;
		this._clauseSelectionMessage = '';
		store.dispatch(updateCollectionConfigurationSnapshot(description));
		this._focusComposerInputSoon();
	}

	_handleCatalogDirectionChanged(e : Event) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
		this._commitDraftEdit(collectionDescriptionWithSortReversed(this._collectionDescription, ele.value === 'reverse'));
	}

	_handleViewModeChanged(e : Event) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
		const viewMode = ele.value as ViewMode;
		const extra = LEGAL_VIEW_MODES[viewMode] ? (this._collectionDescription.viewModeExtra || this._activeCardID || '_') : '';
		this._commitDraftEdit(collectionDescriptionWithViewMode(this._collectionDescription, viewMode, extra));
	}

	_handleViewCardChanged(e : FilterModifiedEvent) {
		this._commitDraftEdit(collectionDescriptionWithViewMode(this._collectionDescription, this._collectionDescription.viewMode, e.detail.value));
	}

	_handleOpenCurrentDraft() {
		//Mode-exclusive: the draft commit belongs to the quick composer only.
		if (this._entryMode !== 'compose') return;
		this._openDestination(
			this._collectionDescription,
			collectionURLPath(this._collectionDescription, {selectedCard: this._draftSelectedCard, originalOrder: true}),
			true,
			readableCollectionExpression(this._collectionDescription, this._composerFilterLabels, this._composerCardNames)
		);
	}

	_handleModifyPath() {
		store.dispatch(askForPathToNavigateTo());
	}

	//THE LEGACY BUILDER'S OWN HANDLERS. They serve the composer-OFF path, where
	//the dialog is still the original filter list; the composer's own clause
	//editing goes through the sentence and the pill row, which never touch a
	//filter index.
	_handleFilterModified(e : FilterModifiedEvent) {
		this._commitDraftEdit(collectionDescriptionWithFilterModified(this._collectionDescription, e.detail.index, e.detail.value));
	}

	_handleFilterRemoved(e : FilterModifiedEvent) {
		this._commitDraftEdit(collectionDescriptionWithFilterRemoved(this._collectionDescription, e.detail.index));
	}

	_handleAddFilterClicked() {
		this._commitDraftEdit(collectionDescriptionWithFilterAppended(this._collectionDescription, ALL_FILTER_NAME));
	}

	_handleSetSelectChanged(e : Event) {
		const ele = e.composedPath()[0];
		if(!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
		const set = ele.value as SetName;
		this._commitDraftEdit(collectionDescriptionWithSet(this._collectionDescription, set));
	}

	_handleSortSelectChanged(e : Event) {
		const ele = e.composedPath()[0];
		if(!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
		const sort = ele.value as SortName;
		this._commitDraftEdit(collectionDescriptionWithSort(this._collectionDescription, sort));
	}

	_handleSortReversedCheckboxChanged(e : Event) {
		const ele = e.composedPath()[0];
		if(!(ele instanceof HTMLInputElement)) throw new Error('not input element');
		const sortReversed = ele.checked;
		this._commitDraftEdit(collectionDescriptionWithSortReversed(this._collectionDescription, sortReversed));
	}

	_unregisterNestedEscapeShortcut : (() => void) | null = null;

	//Escape peels the composer's NESTED layers (the filter catalog, then the
	//clause builder) before it closes the dialog itself. This used to be an
	//override of DialogElement._handleKeyDown, which no longer exists — the
	//base class routes Escape through the shortcut registry (#740). Same
	//shape expressed in the registry's vocabulary: one notch ABOVE dialog
	//priority so it is consulted before the base dialog's cancel, and it
	//DECLINES (returns false) when no nested layer is open, which is what
	//the old `super._handleKeyDown(e)` fallthrough did. Registered on open
	//and unregistered on close, matching the base class, so a closed
	//composer never sits in front of another dialog's Escape.
	//
	//An OPEN composer still could, though, and that is what `when` is for.
	//Priority +1 outranks every dialog's own Escape, including one stacked ON
	//TOP of the composer — find-dialog, opened from the key-card control inside
	//the filter catalog. Escape there peeled the catalog and left the picker on
	//screen, which is the wrong layer by two. The registry applies `when`
	//before the handler, so declining while any other dialog is open hands
	//Escape to the surface actually in front (HS-3.8: Escape closes the topmost
	//dismissable surface). The composer's OWN cancel needs no such term: it
	//registers at plain dialog priority, where the registry's newest-first
	//tiebreak already puts the later-opened dialog first.
	private _syncNestedEscapeShortcut() {
		if (this.open && !this._unregisterNestedEscapeShortcut) {
			this._unregisterNestedEscapeShortcut = registerShortcut({
				id: 'collection-composer-nested-escape',
				keys: SHORTCUT_COMBOS['dialog-escape'],
				label: 'Close the composer’s current layer',
				priority: DIALOG_SHORTCUT_PRIORITY + 1,
				when: (state) => !selectAnyDialogOpenExceptCollectionComposer(state),
				focusPolicy: 'any-focus',
				handler: (e) => {
					//The registry already declines composing keystrokes via
					//isComposing; keyCode 229 is the older spelling that some
					//IMEs still send.
					if (e.keyCode === 229) return false;
					if (!this.open) return false;
					//THE LAYERS PEEL IN THE ORDER THEY WERE OPENED, innermost
					//first. An or-scoped input was opened FROM the pill row, so
					//Escape there returns to the pill rather than closing it;
					//the pill row was opened from the sentence, so Escape there
					//returns to the sentence. Every step is one layer, and the
					//user's place is never further away than the number of
					//Escapes they have pressed.
					if (this._orTarget) {
						this._orTarget = null;
						this._focusComposerInputSoon();
						return true;
					}
					if (this._selectedPath.length) {
						this._clearSelection();
						this._focusComposerInputSoon();
						return true;
					}
					if (this._browseOpen || this._wordScope) {
						this._browseOpen = false;
						this._wordScope = '';
						this._highlightedRow = 0;
						this._rowHighlightActive = false;
						this._focusComposerInputSoon();
						return true;
					}
					//Source is a LAYER too, and Escape peels it exactly like the
					//catalog above. It used to close the whole dialog and take
					//the typed source with it — which the spec's "Error
					//recovery" forbids outright: switching back must not lose
					//invalid text. Nothing is committed and nothing is
					//confirmed; _sourceInput stays in component state, so
					//re-entering Source restores what was typed, to the
					//character. A third Escape, from the quick composer, closes
					//as it always did.
					if (this._entryMode === 'source') {
						store.dispatch(openConfigureCollectionDialog('compose'));
						this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
						return true;
					}
					return false;
				},
			});
		} else if (!this.open && this._unregisterNestedEscapeShortcut) {
			this._unregisterNestedEscapeShortcut();
			this._unregisterNestedEscapeShortcut = null;
		}
	}

	override willUpdate(changedProps : PropertyValues<this>) {
		super.willUpdate(changedProps);
		if (changedProps.has('open')) this._syncNestedEscapeShortcut();
	}

	//The one input the composer is composing with, in whichever mode it is in.
	_focusComposerInput() {
		const input = this._entryMode === 'source' ?
			this.shadowRoot?.querySelector<HTMLTextAreaElement>('#collection-source-input') :
			this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input');
		input?.focus();
	}

	_handleDoneClicked() {
		store.dispatch(closeConfigureCollectionDialog());
	}

	override _shouldClose() {
		//Override base class.
		if (collectionComposerEnabled()) {
			//The half-typed text belongs to the same un-committed draft the
			//reducer is about to preserve, so it is kept under the same
			//condition: only when the draft actually diverged from the
			//collection on screen, and keyed to that collection. The two
			//conditions are the same comparison of the same two values —
			//serialize() on the snapshot and on the active collection.
			const base = this._activeCollectionDescription?.serialize() || '';
			const diverged = Boolean(base) && this._collectionDescription?.serialize() !== base;
			this._preservedComposerInput = diverged ? this._composerInput : '';
			this._preservedDraftBase = diverged ? base : '';
			store.dispatch(cancelConfigureCollectionDialog());
		} else {
			store.dispatch(closeConfigureCollectionDialog());
		}
	}

	override updated(changedProps : PropertyValues<this>) {
		super.updated(changedProps);
		//Mirrored onto the host so ONE rule can gate hover for both lists,
		//rather than each container having to remember the attribute. (The same
		//idiom snack-bar uses for its mobile class, and for the same reason: a
		//property Lit does not reflect cannot be matched from CSS.)
		this.toggleAttribute('data-pointer-armed', this._pointerHighlightArmed);
		if ((changedProps.has('_highlightedRow') || changedProps.has('_rowHighlightActive')) && this._rowHighlightActive) {
			this.shadowRoot?.querySelector(`#collection-palette-row-${this._highlightedRow}`)?.scrollIntoView?.({block: 'nearest'});
		}
		//A LIST OPENS AT ITS TOP.
		//
		//These panes are not recreated between sessions, so their scrollTop
		//survives close-and-reopen: a session that had arrowed down the list
		//reopened HEADERLESS in the middle of it, with the Recent heading
		//scrolled off the top and no sign that anything was above. Every
		//transition that REPLACES what a pane holds — opening the dialog,
		//entering or leaving Source, seeding or clearing Browse all — puts it
		//back at the top, which is where the row the keyboard is about to land
		//on lives.
		if (changedProps.has('open') || changedProps.has('_entryMode') || changedProps.has('_browseOpen') || changedProps.has('_wordScope')) {
			for (const pane of this.shadowRoot?.querySelectorAll('.palette-list, .suggestions') || []) pane.scrollTop = 0;
		}
		//A ROW THAT OPENS BELOW THE FOLD HAS NOT OPENED.
		//
		//The pill row is the second element of the column, so it is on screen by
		//construction in nearly every case — but #inner is still a scroll
		//container, and a session scrolled down inside Browse all that chooses a
		//family would open the row above its scroll position. block:'nearest'
		//scrolls the least that makes it visible, so a row already in view does
		//not jump.
		//
		//ONLY WHEN THE SELECTION ACTUALLY MOVES. The path leaves and re-enters
		//its own value on every argument edit (that is what keeps the row open),
		//and Lit reports each new array as a change — scrolling on that would
		//yank the port under someone in the middle of typing a date. The ADDRESS
		//is what has to have changed, not the array holding it.
		const previousPath = changedProps.get('_selectedPath');
		const selectionMoved = changedProps.has('_selectedPath') &&
			(previousPath || []).join(',') !== this._selectedPath.join(',');
		if (this.open && selectionMoved && this._selectedPath.length) {
			this.updateComplete.then(() => this.shadowRoot?.querySelector('.pill-row')?.scrollIntoView?.({block: 'nearest'}));
		}
		if (changedProps.has('open')) {
			this._activationPending = false;
			this._activationMessage = '';
			if (this.open) {
				this._composerInput = '';
				this._highlightedRow = 0;
				//Opening over a resting cursor must not decide what Enter does.
				this._rowHighlightActive = false;
				this._pointerHighlightArmed = false;
				this._builderExpanded = false;
				this._browseOpen = false;
				this._wordScope = '';
				this._orTarget = null;
				//A fresh session gets fresh counts: corpus membership may have
				//changed since the last time this composer was open.
				this._retainedPreviewCounts.clear();
				this._selectedPath = [];
				this._draftReceiptMessage = '';
				this._clauseSelectionMessage = '';
				//Once per composer session, not once per app lifetime: a user
				//who comes back a week later has earned the explanation again.
				this._modifierNote = '';
				this._newTabNoteShown = false;
				this._draftUndoDescription = null;
				this._draftUndoSelectedCard = null;
				this._sourceDirty = false;
				this._sourceAutoDelimitedSegment = false;
				this._draftSelectedCard = this._requestedCard;
				this._sourceInput = this._entryMode === 'source' ? window.location.pathname : '';
				const parsed = this._entryMode === 'source' ? this._parsedSource : null;
				if (parsed?.status === 'valid') this._draftSelectedCard = parsed.selectedCardRaw;
				this._lastValidSource = parsed?.status === 'valid' ? parsed : null;
				//The reducer has already decided whether to resume the chips, on
				//the same comparison this makes: is the collection this draft was
				//an adjustment to still the one on screen? If it is, the typed
				//text comes back with them, and the receipt says so — chips
				//reappearing with no explanation is its own small mystery.
				//
				//No Undo on this receipt. Undo means "put the draft back the way
				//it was before that edit", and there was no edit here; wiring the
				//existing single-level undo to mean "discard the thing you just
				//got back" would give one button two meanings. The Refine list's
				//own "Start from Everything" is the discard path.
				const resumed = Boolean(this._preservedDraftBase) && this._preservedDraftBase === (this._activeCollectionDescription?.serialize() || '');
				if (resumed) {
					this._composerInput = this._preservedComposerInput;
					this._draftReceiptMessage = 'Restored the draft you were composing';
				}
				this._preservedComposerInput = '';
				this._preservedDraftBase = '';
			}
		}
		//Ctrl-K on an already-open composer: put the caret back in the input the
		//user is composing with, whichever mode they are in. Skipped on the
		//request that OPENED the dialog, which DialogElement already focuses.
		if (this.open && changedProps.has('_focusRequest') && !changedProps.has('open') && changedProps.get('_focusRequest') !== undefined) {
			this.updateComplete.then(() => this._focusComposerInput());
		}
		if (this.open && changedProps.has('_entryMode') && this._entryMode === 'source') {
			if (!this._sourceDirty && !this._sourceInput) this._sourceInput = collectionURLPath(this._collectionDescription, {selectedCard: this._draftSelectedCard, originalOrder: true});
			this.updateComplete.then(() => {
				const input = this.shadowRoot?.querySelector<HTMLTextAreaElement>('#collection-source-input');
				if (!input) return;
				input.focus();
				if (changedProps.has('open')) input.select();
				else input.setSelectionRange(input.value.length, input.value.length);
			});
		}
		if (
			changedProps.has('open') ||
			changedProps.has('_composerInput') ||
			changedProps.has('_sourceInput') ||
			changedProps.has('_entryMode') ||
			changedProps.has('_collectionDescription') ||
			changedProps.has('_activeCollectionDescription') ||
			changedProps.has('_activeCardID') ||
			changedProps.has('_activeCard') ||
			changedProps.has('_filterDescriptions') ||
			changedProps.has('_composerCandidates') ||
			changedProps.has('_cardsSelected') ||
			changedProps.has('_userScope') ||
			//THE PILL ROW'S SECOND COUNT MOVES WITH THE SELECTION. "Without this
			//pill" is a question about a different collection for every pill, so
			//it has to be re-asked when the selection does.
			changedProps.has('_selectedPath') ||
			//And the list's own rows change with every feed, so the counts they
			//carry have to be asked for the rows actually on screen.
			changedProps.has('_browseOpen') ||
			changedProps.has('_wordScope') ||
			changedProps.has('_orTarget')
		) this._refreshPreviewCounts();
	}

	//The identity of the thing a count counts. Same shape the preview module
	//groups its own work by, so two suggestions naming one collection share one
	//count here for the same reason they share one worker run there.
	_previewCountKey(description : CollectionDescription) : string {
		return `${this._activeCardID}\n${description.serialize()}`;
	}

	_rememberPreviewCount(key : string, count : number) {
		//Bounded: a long composing session must not grow a map forever.
		if (this._retainedPreviewCounts.size >= RETAINED_PREVIEW_COUNT_LIMIT) {
			const oldest = this._retainedPreviewCounts.keys().next().value;
			if (oldest !== undefined) this._retainedPreviewCounts.delete(oldest);
		}
		this._retainedPreviewCounts.set(key, count);
	}

	_refreshPreviewCounts() {
		if (this._cancelPreviews) this._cancelPreviews();
		this._cancelPreviews = null;
		const sourceDescription = this._entryMode === 'source' ? (this._parsedSource.description || this._lastValidSource?.description) : null;
		const previewDescription = sourceDescription || this._collectionDescription;
		if (!this.open || !collectionComposerPreviewEnabled()) {
			this._previewCounts = {};
			this._draftCountPending = false;
			return;
		}
		//A ROW IS COUNTED WHEN ITS COUNT WOULD MEAN SOMETHING. A row that opens
		//Source has no collection, a row that names a FAMILY has not decided one
		//yet, and Browse all is a directory of filters rather than a set of
		//predictions — asking the worker for forty family counts nobody will
		//read is what the budget exists to prevent.
		const previewSuggestions : CollectionComposerSuggestion[] = this._entryMode === 'source' ? [] :
			this._paletteRows
				.filter(row => !row.sourceFilter && !row.configurable && this._rowCountMeaningful(row))
				.map(row => ({
					id: row.id,
					kind: 'source' as const,
					action: 'open' as const,
					name: row.label,
					label: row.label,
					detail: '',
					description: row.description,
				}));
		//THE PILL ROW'S SECOND COUNT IS COUNTED LIKE ANY OTHER ROW. It goes
		//through the same debounce, the same worker budget and the same retained
		//cache, which is what makes a count that moves under a changing
		//selection affordable at all.
		if (this._entryMode !== 'source' && this._pillRowOpen) {
			previewSuggestions.unshift({
				id: this._withoutPreviewID,
				kind: 'source',
				action: 'open',
				name: 'Without this pill',
				label: 'Without this pill',
				detail: '',
				description: collectionDescriptionWithExpression(previewDescription, this._expressionWithoutSelection),
			});
		}
		previewSuggestions.unshift({
			id: this._draftPreviewID,
			kind: 'source',
			action: 'open',
			name: 'Current draft',
			label: 'Current draft',
			detail: '',
			description: previewDescription,
		});
		//Keep every count whose collection did not change, and ask only for the
		//ones nobody has counted yet.
		const retained : {[suggestionID : string]: number} = {};
		const missing : CollectionComposerSuggestion[] = [];
		const keyBySuggestionID = new Map<string, string>();
		for (const suggestion of previewSuggestions) {
			const key = this._previewCountKey(suggestion.description);
			keyBySuggestionID.set(suggestion.id, key);
			const known = this._retainedPreviewCounts.get(key);
			if (known === undefined) missing.push(suggestion);
			else retained[suggestion.id] = known;
		}
		this._previewCounts = retained;
		this._draftCountPending = missing.some(suggestion => suggestion.id === this._draftPreviewID);
		if (!missing.length) return;
		this._cancelPreviews = startCollectionComposerPreviews(
			missing,
			this._activeCardID,
			corpusWorkerRunCollection,
			(suggestionID, count) => {
				if (!this.open) return;
				const key = keyBySuggestionID.get(suggestionID);
				if (key) this._rememberPreviewCount(key, count);
				if (suggestionID === this._draftPreviewID) this._draftCountPending = false;
				this._previewCounts = {...this._previewCounts, [suggestionID]: count};
			}
		);
	}

	override disconnectedCallback() {
		if (this._cancelPreviews) this._cancelPreviews();
		this._cancelPreviews = null;
		if (this._unregisterNestedEscapeShortcut) this._unregisterNestedEscapeShortcut();
		this._unregisterNestedEscapeShortcut = null;
		super.disconnectedCallback();
	}

	override stateChanged(state : State) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectConfigureCollectionDialogOpen(state);
		this.mobile = state.app ? state.app.mobileMode : false;
		this._collectionDescription = selectSnapshotCollectionDescription(state);
		this._activeCollectionDescription = selectActiveCollectionDescription(state);
		this._filterDescriptions = selectFilterDescriptions(state);
		this._knownFilterNames = selectKnownCollectionFilterNames(state);
		this._composerCandidates = selectCollectionComposerCandidates(state);
		this._userIDs = selectAuthorAndCollaboratorUserIDs(state);
		this._userInfos = selectAuthorsForTagList(state);
		this._cardTagInfos = selectTagInfosForCards(state);
		this._tagInfos = selectTags(state);
		this._cardsSelected = selectCardsSelected(state);
		this._userScope = selectUid(state);
		this._activeCardID = selectActiveCardID(state);
		//THE PLACEHOLDER NEVER REACHES A PATH THIS DIALOG BUILDS.
		//
		//The router rewrites "no card in the URL" to the internal placeholder
		//'_' (actions/collection.ts) and canonicalizeURL rewrites it straight
		//back to an empty segment. Carrying it into a destination meant every
		//composer navigation pushed `/c/…/_` and then replaceState'd the real
		//path a tick later — a URL the user never asked for, entered into
		//history, and the app's own §1.4 rule is that an internal identifier
		//never reaches a user. Stripped where the value ENTERS the component, so
		//both consumers (the paths built from it and the already-open comparison
		//that is made against it) agree without either having to remember.
		const requestedCard = selectRequestedCard(state) || '';
		this._requestedCard = requestedCard === PLACEHOLDER_CARD_ID_CHARACTER ? '' : requestedCard;
		this._activeCard = selectActiveCard(state);
		this._entryMode = selectConfigureCollectionDialogMode(state);
		this._focusRequest = selectConfigureCollectionDialogFocusRequest(state);
		this.title = collectionComposerEnabled() ? 'Compose a Collection' : 'Configure Collection';
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'configure-collection-dialog': ConfigureCollectionDialog;
	}
}
