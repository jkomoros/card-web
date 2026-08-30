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
	declareShortcut,
	registerShortcut,
	shortcutKeys,
	DIALOG_SHORTCUT_PRIORITY,
	SHORTCUT_COMBOS
} from '../shortcuts.js';

import {
	selectConfigureCollectionDialogOpen,
	selectConfigureCollectionDialogMode,
	selectConfigureCollectionDialogFocusRequest,
	selectConfigureCollectionDialogSelection,
	selectFilterDescriptions,
	selectCollectionComposerCandidates,
	selectAuthorAndCollaboratorUserIDs,
	selectAuthorsForTagList,
	selectTagInfosForCards,
	selectSnapshotCollectionDescription,
	selectActiveCollectionDescription,
	selectCollectionClauseTagInfos,
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
	SET_NAMES,
} from '../../shared/collection_description_base.js';

import {
	CompletionUsageWeights,
	DEFAULT_STICKY_SET,
	collectionDescriptionStartsFromAppDefault,
	collectionDescriptionWithStickyStart,
	completionUsageWeights,
	readStickyComposerSet,
	recordCompletionAcceptance,
	recordStickyComposerSet,
} from '../collection-composer-usage.js';

import {
	PaletteRow,
	TYPED_RANK_LITERAL,
	VOCABULARY_SECTION,
	frozenPaletteOrder,
	paletteIdleRows,
	paletteOrScopedRows,
	paletteOrderKey,
	paletteRecoveryRows,
	paletteTypedRank,
	paletteTypingRows,
	paletteWordRows,
	PaletteWordScope,
} from '../collection-palette-rows.js';

//The two lists that are painted by the .row rules. Naming them means the
//pointer rule below is written once rather than twice.
type ComposerRowList = 'palette' | 'source-completion';

const ALREADY_ACTIVE_MESSAGE = 'This collection is already open.';

//Sentence case, honest about the reason, and it names what the key the user
//actually has does instead (HS-2.3, §3.5: a refusal reports and offers the
//next move). U+2019 apostrophe (§2.2).
//THE COMPOSER'S COMMIT IS CATALOGUED, NOT REGISTERED (round 3, D1).
//
//It is the one keystroke in this dialog that leaves, and the constitution puts
//it at the end of every composition — so it belongs in the reference sheet like
//every other combo the app answers to. It is DECLARED rather than registered
//because the composer's input owns its own key grammar whole (Enter executes the
//top action, Tab aliases it, Backspace selects then removes), and a registry
//binding would be a second authority over one keystroke inside one field.
//declareShortcut is the seam dialog-escape already uses for exactly this shape:
//catalogued for the sheet, handled where it is actually performed.
declareShortcut({
	id: 'commit-collection-composer',
	keys: SHORTCUT_COMBOS['commit-collection-composer'],
	label: 'Open the collection you have composed',
	group: 'dialogs',
	focusPolicy: 'any-focus',
	handler: () => false,
});

//It names the key that DOES open, which is the commit modifier now (round 3,
//D1): plain Enter is spoken for by the top action.
const NEW_TAB_UNSUPPORTED_NOTE = `Opening in a new tab isn’t supported — ${shortcutKeys('commit-collection-composer')} opens here.`;

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

//HOW MANY CARDS THE PREVIEW LINE NAMES (round 3, D5). The owner: "before that
//it's just showing you a preview of cards." Three titles and the remainder fit
//on one line under the count, and one line is the whole design — this is a
//preview of the collection, not a second collection view inside the composer.
const PREVIEW_TITLE_LIMIT = 3;

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

//HOW MUCH OF THE VOCABULARY THE IDLE LIST ASKS FOR.
//
//"Show the WHOLE set" is the requirement, and this is what "whole" costs on a
//real corpus: every filter in the registry (~200 after the inverses), every tag
//and section and person the corpus has, plus the sentence words. Four hundred is
//comfortably above the observed total on the owner's corpus and is a guard
//rather than a policy — if it ever binds, the list has stopped being the whole
//vocabulary and that is a fact worth a failing measurement rather than a silent
//truncation.
const VOCABULARY_CANDIDATE_LIMIT = 400;

//HOW MANY ROWS ARE IN THE DOM AT ONCE, and how many more each scroll adds.
//
//MEASURED, NOT GUESSED (D1). Numbers below are from the live app against the
//owner's dev corpus (792 cards), where the idle list is 275 rows:
//
//    idle list, all 275 rows rendered   6.1ms median, 15.7ms worst per update
//    idle list, 60-row window            2.0ms median,  3.5ms worst per update
//    a typed keystroke (list is <=12)   14-19ms either way
//
//So the window buys about 4-12ms per update on the idle list, and nothing at all
//on a typed one — which is the honest summary: a typed keystroke's cost is the
//completion index, not the DOM, and the window is there for the list that is
//three hundred rows long rather than twelve.
//
//The list renders a window and grows it: on scrolling near the bottom, and on
//any keyboard navigation that reaches the end of what is rendered. The ROWS are
//all there — nothing is hidden, the ranking is over all of them, and the arrow
//keys walk all of them — only the DOM is windowed, which is why Enter cannot
//land on a row the user could not see.
const INITIAL_RENDERED_ROWS = 60;
const RENDERED_ROWS_INCREMENT = 60;

//How close to the bottom of the scroller counts as "near the bottom", in pixels.
const RENDER_MORE_THRESHOLD_PX = 240;

const EMPTY_USAGE_WEIGHTS : CompletionUsageWeights = {};

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
	cardsSelected : boolean,
	usage : CompletionUsageWeights
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
	usage,
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
	cardsSelected : boolean,
	usage : CompletionUsageWeights
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

	//WHICH CLAUSE THE OPENER POINTED AT, if any. The why-here panel's tap-through
	//is the one gesture that arrives here already knowing which condition the
	//user is asking about; every other opener leaves this empty.
	@state()
		_requestedSelection : readonly number[] = [];

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

	//Whether _highlightedRow currently means anything. A row is highlighted only
	//once the user has pointed at one: by typing (the list is then
	//interpretations of what they typed), by arrowing, or by genuinely moving the
	//mouse over a row. Rebuilding the list — after a Tab materialization, a
	//clause edit, or an undo — leaves nothing highlighted.
	//
	//WITH NOTHING HIGHLIGHTED, ENTER DOES NOTHING (round-3 tightness, B1). This
	//used to be the state that made Enter a COMMIT, which put a navigation on the
	//key somebody presses after every clause — see _handleComposerKeyDown. The
	//distinction the flag draws survives whole; only what the empty side of it
	//means has changed, and the footer already said the new answer.
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

	//WHAT THIS PERSON HAS ACCEPTED BEFORE, read ONCE per composer session.
	//
	//The store decays with time, so re-reading it per keystroke would let the
	//list re-rank underneath somebody mid-word. It is read when the dialog
	//opens, and written when a row is accepted — the write updates the store for
	//the NEXT session, deliberately not this one: a list that reordered the
	//moment you used it would move the row you were about to use again.
	@state()
		_usageWeights : CompletionUsageWeights = EMPTY_USAGE_WEIGHTS;

	//WHERE A COMPOSITION STARTS FROM, read once per session for the same reason
	//the usage weights are: a value that could change mid-keystroke would move
	//the collection a row promises out from under the row.
	//
	//IT IS APPLIED TO THE DRAFT AT OPEN, NOT AT THE FIRST EDIT (round-3
	//tightness, M6). See _seedDraftStartingSet.
	@state()
		_stickySet : string = DEFAULT_STICKY_SET;

	//WHETHER THE DRAFT IS KNOWN TO MATCH NOTHING — not "has no count yet", which
	//is a different fact and the reason this is a tri-state collapsed to a bool
	//set in exactly one place (the draft's own preview callback).
	//
	//REACTIVE, BECAUSE IT CREATES ROWS. The recovery section exists only at a
	//resolved zero, so those rows come into existence when a COUNT ARRIVES — and
	//a count arriving is not one of the things that used to re-ask the worker for
	//the list's numbers. So the section that is entirely about counts rendered
	//with none of them: three clauses, no answer to "which one emptied it", which
	//is the only question the section exists to answer. Naming the fact as state
	//puts it in updated()'s trigger list, where one more request is made for the
	//rows the fact just brought into being; it settles immediately, because the
	//second pass changes nothing that changes the row set again.
	@state()
		_draftResolvesEmpty = false;

	//HOW MANY ROWS ARE ACTUALLY IN THE DOM. The list is the whole vocabulary
	//now — several hundred rows on a real corpus — and rendering all of it costs
	//a frame the keyboard cannot spare. See _visiblePaletteRows.
	@state()
		_renderedRowLimit = INITIAL_RENDERED_ROWS;

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

	//THE FIRST FEW CARDS THE DRAFT ACTUALLY MATCHES, keyed by the collection they
	//came out of — the same key the counts use, for the same reason: the names
	//and the number beside them are two halves of one worker run, and keying them
	//differently is how a title list could outlive the collection it described.
	//
	//BOUNDED AT THE HEAD OF THE LIST. Only a handful are ever rendered, so
	//retaining an ordered id array per collection would be several hundred
	//strings the composer has no use for.
	_retainedPreviewIDs = new Map<string, readonly string[]>();

	//Reactive, because the line renders from it: a Map mutation is invisible to
	//Lit, so the render reads this counter's identity instead. Bumped whenever a
	//run lands ids for a collection this session had none for.
	@state()
		_previewIDsVersion = 0;

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

	//THE DRAFT RECEIPT STRIP IS DELETED, AND SO IS DRAFT PRESERVATION (round 3,
	//D1). Both were answers to the same question — "what happened to my draft?"
	//— and the owner's constitution answers it differently: the draft is a
	//preview, nothing real has changed, and Escape resetting it is the undo. A
	//narration of edits nobody had committed, with its own Undo button, was a
	//second history competing with the one the user already had; and a draft
	//that came back on the next open made the composer a place with memory,
	//when the constitution says every composition begins from the collection
	//you are looking at.

	@state()
		_clauseSelectionMessage = '';

	//Whether the FIRST Backspace has selected a clause and the second one would
	//remove it. The two-step is the whole reason Backspace is safe on an empty
	//input, and a contract nobody can see is not a contract — see
	//_backspaceArmedMessage, which the key-hints line renders while this is set.
	@state()
		_backspaceArmed = false;

	//The order the list was last ranked in, keyed by the identity of the rows it
	//ranked. Deliberately not @state: it is a memo of a render, not an input to
	//one.
	_paletteOrder : {key : string, order : string[]} | null = null;

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

			/* THE SENTENCE'S OWN BADGE RULE IS DELETED WITH THE BADGE (round-3
			   tightness, C1). It existed to shrink HelpStyles' 1.3em glyph to
			   something that did not dominate a 1.05em sentence; the sentence
			   carries no glyph now, and the definition it defined lives on the
			   dialog title. HelpStyles stays because Source mode's and the
			   legacy builder's own form labels still use it. */

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

			/* ONE LIST, AND IT IS THE PART OF THE COLUMN THAT GIVES AND TAKES
			   (round-3 tightness, C3).
			   It is content-sized up to 40vh — the dialog is no longer pinned to
			   90% of the viewport, so a flex-basis-0 list would collapse to
			   nothing, and the max-height is what makes a long list scroll
			   instead of growing the palette off the screen.
			   WHAT CHANGED IS THE FLEX. It was 0-1-auto in a column whose other
			   children were also shrinkable, so a deficit was shared out — the
			   list, the biggest item, absorbing most of it, down to a SINGLE
			   visible row — while a surplus nobody claimed sat as a dead band
			   between Edit source and the footer. flex-grow:1 makes the list
			   the one recipient of any surplus, and the blocks around it give
			   up their room first (rule below) so it is also the one payer of
			   any deficit. min-height is the floor that deficit stops at;
			   below it #inner, the dialog's own scroll container, takes over.
			   A list is the only thing in this column a user can be short of. */
			.palette-list,
			.suggestions {
				flex: 1 1 auto;
				list-style: none;
				margin: 0.25em 0 0;
				max-height: 40vh;
				min-height: 5em;
				overscroll-behavior: contain;
				padding: 0;
			}

			/* AND ON THE FULL-SCREEN LAYOUT THERE IS NO CAP AT ALL. .mobile
			   .content is height:100%, so the column has a DEFINITE height and
			   a real surplus to give away; a 40vh cap on the one element that
			   can take it is what left ~130px of nothing between Edit source
			   and the footer. The cap exists to stop a long list growing the
			   palette off the screen, and a full-screen palette cannot grow. */
			.mobile .palette-list,
			.mobile .suggestions {
				max-height: none;
			}

			/* And the blocks around it do not shrink, so the surplus and the
			   deficit both land in one place. Stated on the composer's own
			   children rather than as an "#inner > *" blanket, so Source mode's
			   column — which has its own editor pane to negotiate with — is
			   untouched. */
			.sentence,
			.pill-row,
			.composer-input,
			.key-hints,
			.mode-links,
			.preview-titles {
				flex: 0 0 auto;
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

			/* ONE GRID, AND ONLY THE THREE THINGS A ROW MAY SAY (round 3, D3):
			   what it does, the consequence count, and — on the highlighted row —
			   its one line of explanation. The glyph track went with the
			   navigating row (nothing in this list navigates any more) and the
			   widens row went with the second label line: what an or widens is
			   already in its own label, and a second restatement of it was a
			   fourth thing exactly one species of row carried. */
			.palette-row button {
				grid-template-columns: minmax(0, 1fr) 11em;
				grid-template-areas:
					'label count'
					'detail detail';
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

			/* THE ONE ANNOTATION SLOT, AND EVERY ROW USES THE SAME ONE — for one
			   quiet word, and only for that (round-3 tightness, S1).
			   It used to hold a combinatorial row's whole diff ('Uses Main
			   instead of Everything · Removes Tagged Ecosystems, Tagged
			   Platforms, Created since 7 days ago · Adds Section About'), which
			   wrapped to three lines and made one species of row twice the
			   height of every other. nowrap is the rule that keeps it honest:
			   anything that would need to wrap does not belong in this slot,
			   and the diff is on the highlighted row's detail line where it
			   always also was. */
			.row-annotation {
				color: var(--app-dark-text-color-light);
				font-size: 0.72em;
				margin-left: 0.5em;
				white-space: nowrap;
			}

			/* THE PILL THIS ROW WOULD TAKE OUT, in the outlined-not vocabulary
			   one step further: the sentence draws an excluded clause outlined,
			   and a clause on its way out of the sentence is drawn outlined AND
			   struck. Applied to the row's label rather than to the pill's own
			   expression, because the pill names a clause that really is in the
			   draft — inventing a negated node to draw it with would make the
			   row lie about which clause it is offering to remove. */
			.row-removes {
				opacity: 0.7;
				text-decoration: line-through;
			}

			/* The annotation is not part of what is being struck out: it says
			   what KIND of clause is leaving, and a struck annotation would read
			   as a second thing being removed. */
			.row-removes .row-annotation {
				opacity: 1;
				text-decoration: none;
			}

			/* THE MARK ON THE OPTION ALREADY IN FORCE HAS NO RULE OF ITS OWN
			   (round-3 tightness, S4). It was a fourth element beside the
			   annotation slot, in a fourth size, on the one feed that carried no
			   annotation at all. It IS the annotation now — '✓ current' in the
			   same slot, at the same weight — so a word-scope row has exactly
			   the anatomy every other row has. */

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

			/* THE NAVIGATION GLYPH IS GONE WITH THE THING IT MARKED. A recent
			   used to be the one row in the list whose consequence differed
			   from its neighbours' — it LEFT — so it wore a glyph none of them
			   had. In the round-3 model nothing in the list leaves: executing a
			   recent replaces the draft with it, which is an action on the draft
			   like every other row's, so there is no longer a difference for a
			   glyph to mark. */

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
				grid-template-columns: minmax(0, 1fr);
				grid-template-areas:
					'label'
					'count'
					'detail';
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

			/* THE PREVIEW LINE (D5). One line, subordinate, clipped rather than
			   wrapped: the draft's own count sits directly above it and this is
			   the evidence for that number, not a second reading surface. It
			   follows the count's right-aligned column by sitting under the whole
			   footer row rather than inside it, so a long title cannot push the
			   commit button anywhere. */
			.preview-titles {
				color: var(--app-dark-text-color-light);
				font-size: 0.78em;
				overflow: hidden;
				text-align: right;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.mobile .preview-titles {
				text-align: left;
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

			/* AND IT IS REACHABLE AT EVERY HEIGHT (round-3 tightness, C3).
			   Reserving the footer's room out of the list's works only while
			   the column FITS. Once the list has been squeezed to its floor and
			   #inner starts to scroll, the last child of a scroller is exactly
			   the thing that goes below the fold — and it is the commit
			   control. Sticky rather than shorter: the list keeps the room the
			   flex rule just gave it, and the one action this dialog exists to
			   perform stays on screen while the rows above it scroll under it.
			   The fill is the dialog's own surface (DialogElement paints
			   .content white), so a row scrolling behind the footer disappears
			   under it rather than through it. */
			.buttons.composer-actions {
				background: var(--app-light-text-color);
				bottom: 0;
				position: sticky;
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
	//THE '?' BADGE IS CUT (round-3 tightness, C1).
	//
	//It rode at the end of the sentence and defined the word "collection"
	//(HS-1.3's MUST, debt item D1). The obligation is kept and the GLYPH is gone:
	//the same sentence is now the dialog title's own title/aria-description, so
	//hovering 'Compose a Collection' or reading the heading gives the definition,
	//and the composer's first line is the user's sentence and nothing else. A
	//visible help affordance is a concept on a surface whose argument is that it
	//has four of them.
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
					.mobile=${this.mobile}
					.selectedPath=${this._selectedPath}
					@condition-selected=${this._handleTokenSelected}
					@member-selected=${this._handleTokenSelected}
					@group-edge-selected=${this._handleTokenSelected}
					@condition-activated=${this._handleTokenSelected}
					@condition-removed=${this._handleTokenRemoved}
					@set-clicked=${this._handleSetWordClicked}
					@sort-clicked=${this._handleSortWordClicked}
				></collection-sentence>${this._orderWordRender()}
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

	//THE ROW STATES THE COUNT ONLY IT CAN ANSWER (round-3 tightness, minor).
	//
	//It used to state two: "draft now matches N", which is the number the footer
	//is already stating beside the control that would open it, and "without this
	//pill: N", which nothing else on screen can say. Two live readouts of one
	//number, three inches apart, moving together — on a surface whose other pair
	//of numbers (the highlighted row's and the draft's) is deliberately told
	//apart by weight because two numbers competing to be "what happens next" was
	//itself a defect. The footer's is the one that survives: it sits beside the
	//button that acts on it.
	//
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
			this._cardsSelected,
			this._usageWeights
		);
	}

	//THE NAMING BUNDLE IS DELETED WITH THE THING IT NAMED (round-3 tightness,
	//S1). It threaded the draft, the filter labels and the card titles into the
	//palette layer for one purpose: deriving a combinatorial row's diff into the
	//annotation slot. The slot holds one quiet word now, and the diff is on the
	//row's own detail line, which the suggestion module had already written — so
	//the second derivation, and the plumbing that fed it, are both gone.

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
		if (this._composerInput.trim()) {
			//THE CAP RUNS BEFORE THE COUNT-RANKING, so a row that merely SANK
			//cannot fall off the end. The cap belongs to the engine's own
			//ranking — it drops what the engine ranked last — and the
			//count-ranking only reorders what is already on screen. The other way
			//round, sinking a zero-count row and then slicing deleted it, which
			//is precisely the "do NOT hide; the count is the honest warning" the
			//rule exists to keep.
			const typed = this._rankedTypedRows(this._withoutNoOpWidenRows(paletteTypingRows(
				completionCandidatesFor(this._composerInput, expression, description, context, TYPING_CANDIDATE_LIMIT),
				description,
				''
			)).slice(0, TYPING_ROW_LIMIT));
			return [...typed, ...this._recoveryRows()];
		}
		//RECOVERY LEADS THE IDLE LIST, and it has to now that the list is the
		//whole vocabulary. The recovery rows used to sit at the END of a list of
		//recents-plus-three, where they were the last four rows on screen; behind
		//275 rows of vocabulary they are two hundred scroll-lines from the
		//question they answer ("which of these emptied it?"). Observed live: a
		//draft resolving to 0 cards showed the note and nothing to act on.
		//
		//It leads only when it EXISTS, which is only at a resolved zero — see
		//_recoveryRows. The typed list keeps recovery at the bottom, because
		//there the top rows are interpretations of something the user just typed
		//and those must not be displaced.
		return [...this._recoveryRows(), ...this._idleRows(description, context)];
	}

	//A DRAFT THAT MATCHES NOTHING IS OFFERED ITS CLAUSES BACK.
	//
	//An empty draft is valid, and the footer says so — but a note is not a
	//recovery. The question the user has is "which of these emptied it?", and it
	//is answered by the per-clause removals with their counts beside them: the
	//one whose removal brings the collection back is visible at a glance. The
	//rows come from the same generator the Refine list uses (removals are
	//filtered OUT of that list, because "undo the thing you just chose" is not a
	//refinement), so a removal row here and pressing Remove on the pill compile
	//the same edit.
	//
	//Only at a RESOLVED zero. `undefined` means the count has not arrived, which
	//is a different fact, and a recovery section for a collection nobody has
	//counted yet would flicker in on every keystroke.
	//
	//THE ROWS ARE ORDERED BY WHAT THEY RECOVER (round-3 tightness, M4). The
	//question is "which of these emptied it?", and the answer is the removal that
	//brings back the most cards — so that removal is the first row rather than
	//whichever clause happens to be leftmost in the sentence. A removal nobody
	//has counted yet sorts last rather than first: an unknown is not evidence,
	//and promoting one would make the section's order flicker as numbers land.
	//The list is frozen under a live highlight by _paletteRows, as every other
	//count-driven re-rank is.
	_recoveryRows() : PaletteRow[] {
		if (this._wordScope || this._orTarget) return [];
		if (!this._draftResolvesEmpty) return [];
		const expression = this._draftExpression;
		if (!expression.length) return [];
		const rows = paletteRecoveryRows(
			expression,
			this._collectionDescription,
			this._composerFilterLabels,
			this._composerCardNames
		);
		const recovered = (row : PaletteRow) : number => {
			const count = this._countForDescription(this._appliedDescription(row));
			return count === undefined ? -1 : count;
		};
		return rows
			.map((row, index) => ({row, index}))
			.sort((left, right) => recovered(right.row) - recovered(left.row) || left.index - right.index)
			.map(({row}) => row);
	}

	//A WIDENING THAT WIDENS NOTHING IS NOT A WIDENING.
	//
	//The completion index already refuses the STRUCTURAL no-ops — an `or` with a
	//member the group already has, and any edit whose expression compiles back
	//to what it started as. It cannot see the other kind: `…or tag-10 ·
	//158 → 158` is a row whose alternative happens to be a subset of what the
	//group already keeps, which only the corpus knows. Offered, it is a
	//consequence row promising a consequence it does not deliver.
	//
	//Counts come from the retained map, keyed by COLLECTION, exactly as the idle
	//list's own contradictory-refinement suppression does — suppressing a row on
	//a count that then stops being requested BECAUSE the row is gone is an
	//oscillation, not a suppression.
	//
	//Only `or`. A zero-count ADD is never suppressed: the count is the honest
	//warning, and hiding the filter somebody just named is the worse defect.
	_withoutNoOpWidenRows(rows : PaletteRow[]) : PaletteRow[] {
		const draftCount = this._countForDescription(this._collectionDescription);
		if (draftCount === undefined) return rows;
		return rows.filter(row => row.valenceKind !== 'or' || this._countForDescription(this._appliedDescription(row)) !== draftCount);
	}

	//ZERO SINKS, AND IT SINKS RATHER THAN DISAPPEARING.
	//
	//A typed list is interpretations of what the user wrote, so none of them may
	//be hidden — a row reading `→ 0 cards` is the honest warning that the clause
	//they named selects nothing, and it is more useful than its absence. What it
	//must not do is LEAD: with a generic token the first rows were recents that
	//resolve to nothing, sitting above the first real reading of the token.
	//
	//Stable within each group, so the engine's own ranking survives intact for
	//every row whose count is unknown or non-zero. The idle list has had this
	//rule since the old build (rankedComposerSuggestions); this is the same rule
	//for the list that replaced it.
	//
	//A ROW THAT SHOWS NO COUNT IS NOT SUNK BY ONE (round 3, D2/D3). The rule
	//exists because a row reading `→ 0 cards` must not LEAD; a row that never
	//renders a number is not that row, and sinking it on a figure the user cannot
	//see is the silent-suppression defect the rule was written against, one door
	//over. Caught in live verification: with the draft resolving to zero, `Edit
	//Created since 5 days ago` — whose collection IS the draft, by definition —
	//fell from second place to tenth, under eight rows that would ADD a second
	//date clause to a collection that already matched nothing.
	//
	//AND IT SINKS ONLY WITHIN ITS CLASS (round-3 tightness, B2/M5).
	//
	//The typed list has one rule above every count-driven one: the row that IS
	//the typed thing leads it. paletteTypedRank states that rule whole —
	//literal, then weaker readings, then grafts of the literal row, then pivots
	//away from the draft — and it is applied FIRST, so:
	//
	//  B2  a zero on the literal row is a fact about the user's own sentence, and
	//      the recovery section is the design's answer to it. Sinking it put
	//      `Created since 5 days ago · 3 → 0` seventh, under two or-grafts
	//      containing that very clause and three readings of the raw words.
	//  M5  a destination is a whole other collection, and no token is a request
	//      to leave the one being composed. Typing a date phrase against a
	//      one-clause draft put `Main · Section About` on top.
	//
	//Both are the same guard, written once. Within a class the engine's order
	//survives intact, and the zero-sink still runs there — which is where it was
	//always useful: among several readings of an ambiguous token, the ones that
	//select nothing go last.
	_rankedTypedRows(rows : PaletteRow[]) : PaletteRow[] {
		const empty = (row : PaletteRow) => this._rowCountMeaningful(row) &&
			this._countForDescription(this._appliedDescription(row)) === 0 ? 1 : 0;
		return rows
			.map((row, index) => ({row, index, rank: paletteTypedRank(row)}))
			.sort((left, right) =>
				left.rank - right.rank ||
				(left.rank === TYPED_RANK_LITERAL ? 0 : empty(left.row) - empty(right.row)) ||
				left.index - right.index)
			.map(({row}) => row);
	}

	//THE ZERO-SINK IS NOT A TYPED-LIST RULE (round-3 tightness, minor).
	//
	//The idle list had its own, narrower version of it —
	//_withoutContradictoryRefinements, which SUPPRESSES a zero-count refinement —
	//and it reached only the three contextual suggestions. The vocabulary run
	//beneath them was never covered, so the idle list opened, signed out, on
	//`Starred → 0`: a row leading the list with a promise to empty the
	//collection. Same rule, same reason, now over every idle row: a zero goes
	//last in its run rather than first, and it is still THERE, because the count
	//is the honest warning and hiding the filter is the worse defect.
	//
	//WITHIN EACH HEADING'S RUN. The headings are drawn from consecutive rows
	//sharing a section, so a sort that moved a row between runs would grow a
	//second 'Recent' heading further down the list. The section's own first
	//appearance is therefore the primary key, which reorders inside each run and
	//nothing across them.
	_rankedIdleRows(rows : PaletteRow[]) : PaletteRow[] {
		const sectionOrder = new Map<string, number>();
		for (const row of rows) if (!sectionOrder.has(row.section)) sectionOrder.set(row.section, sectionOrder.size);
		const empty = (row : PaletteRow) => this._rowCountMeaningful(row) &&
			this._countForDescription(this._appliedDescription(row)) === 0 ? 1 : 0;
		return rows
			.map((row, index) => ({row, index}))
			.sort((left, right) =>
				(sectionOrder.get(left.row.section) || 0) - (sectionOrder.get(right.row.section) || 0) ||
				empty(left.row) - empty(right.row) ||
				left.index - right.index)
			.map(({row}) => row);
	}

	//RECENTS, THREE SUGGESTIONS, THEN EVERYTHING.
	//
	//The first two runs are unchanged: the cap on the contextual rows is still
	//the completion index's own (the owner's complaint #6, "random suggestions",
	//answered by arithmetic rather than by taste), and the count-aware ranking
	//and contradictory-refinement suppression are still the old suggestion
	//path's.
	//
	//THE THIRD RUN IS THE ROUND-2 CORRECTION: the entire vocabulary, ranked by
	//personal likelihood, under one quiet heading. It is produced by asking the
	//completion index for candidates with an EMPTY token — the same function, the
	//same scoring, the same dedupe — because "typing is FILTERING a set of all
	//the things you could do" is only true if the idle list and the typed list
	//are one list with one code path behind them.
	_idleRows(description : CollectionDescription, context : CollectionCompletionContext) : PaletteRow[] {
		const idle = idleRowsFor(description, context);
		const ranked = rankedSuggestionsFor(
			this._withoutContradictoryRefinements([...idle.recents, ...idle.contextual]),
			this._previewCounts
		);
		const vocabulary = paletteTypingRows(
			completionCandidatesFor('', this._draftExpression, description, context, VOCABULARY_CANDIDATE_LIMIT),
			description,
			VOCABULARY_SECTION
		);
		return this._rankedIdleRows(paletteIdleRows(
			ranked.filter(suggestion => suggestion.kind === 'recent'),
			ranked.filter(suggestion => suggestion.kind !== 'recent'),
			vocabulary
		));
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
		//A REBUILT LIST GETS A FRESH WINDOW. The window is a scroll position in
		//disguise, and the pane's scrollTop is reset on every feed change; a
		//window that survived would leave three hundred rows in the DOM for a
		//two-row typed list.
		if (memo && memo.key !== key && this._renderedRowLimit !== INITIAL_RENDERED_ROWS) {
			this._renderedRowLimit = INITIAL_RENDERED_ROWS;
		}
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
	//and take a column to say nothing.
	//
	//A FAMILY ROW HAS AN ANSWER NOW (round-3 tightness, S3). SUPERSEDED: this
	//used to refuse a count to any configurable family, on the argument that a
	//family "has not decided a collection yet". It has: the row carries the
	//family's own default clause (defaultConfigurableFilter), that clause is a
	//real collection, and executing the row really does land it — which is
	//exactly why the default was changed to a rolling window in the first place.
	//So `Created since 7 days ago` sat in a list of numbers with no number, the
	//one species that could not be compared with its neighbours, and the user had
	//to add it to find out it was empty. The cost is the count itself, and it is
	//bounded by the same window every other row's is: only rows in the DOM are
	//asked for.
	//
	//The same rule gates the PREVIEW REQUEST, so a number that would not be
	//rendered is never asked of the worker either.
	_rowCountMeaningful(row : PaletteRow) : boolean {
		const draft = this._collectionDescription;
		const other = this._appliedDescription(row);
		if (other.set !== draft.set) return true;
		return other.filters.join('/') !== draft.filters.join('/');
	}

	//THE COLLECTION A ROW ACTUALLY PRODUCES.
	//
	//IT IS NOW SIMPLY THE ROW'S OWN (round-3 tightness, M6). This used to re-apply
	//collectionDescriptionWithStickyStart, because the sticky starting set was
	//applied at the first EDIT and a row's count therefore had to predict a
	//rewrite that had not happened yet. The rewrite happens at OPEN now — see
	//_seedDraftStartingSet — so by the time any row is built the draft already
	//carries the set it will use, every row descends from it, and there is exactly
	//one derivation of "what does this row do" instead of two that had to be kept
	//agreeing.
	//
	//The seam stays, because everything observable about a row still goes through
	//it: the count, the commit, and the preview all ask this one question.
	_appliedDescription(row : PaletteRow) : CollectionDescription {
		return row.description;
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

	//ONE ROW ANATOMY, AND NO ROW MAY HAVE A SECOND (round 3, D3):
	//
	//    [what it does — as the pill(s) or word it produces or removes]
	//    [right-aligned consequence count, `current → after`, where meaningful]
	//    [one quiet annotation — kind, or a combinatorial row's whole diff]
	//
	//and, on the highlighted row and only there, its one line of explanation.
	//That last is a property of the HIGHLIGHT rather than of the row: every row
	//behaves identically under it, which is what `alwaysDetail` — a pin held
	//open by exactly one species — did not.
	//ONE SLOT, ONE QUIET WORD (round-3 tightness, S1/S4).
	//
	//The slot said three different kinds of thing: a kind word on most rows, a
	//three-clause diff on a destination — which wrapped, and made that species
	//twice as tall as its neighbours — and nothing at all on a word-scope row,
	//which instead grew a FOURTH element beside it to say '✓ current'.
	//
	//It says exactly one thing now: what kind of row this is, in one word from a
	//closed vocabulary (tag/section/date/sort/set/view/remove/edit/change/
	//source/recent) — except on the option already in force, where the more
	//useful answer to "what is this row" is that it is the one you are in. The
	//diff a destination used to carry is on that row's own detail line, which is
	//where every other row's explanation lives and where this one already was.
	_rowAnnotation(row : PaletteRow) : string {
		if (row.current) return '✓ current';
		return row.annotation || '';
	}

	_paletteRowRender(row : PaletteRow, index : number, highlightedIndex : number) {
		const highlighted = index === highlightedIndex;
		const countText = this._rowCountText(row);
		const showDetail = Boolean(row.detail) && highlighted;
		return html`
			<div class='palette-row' role='presentation'>
				<button
					id='collection-palette-row-${index}'
					role='option'
					tabindex='-1'
					aria-selected=${highlighted}
					aria-label=${`${row.removes ? 'Remove ' : ''}${row.edits ? 'Edit ' : ''}${row.label}${row.annotation ? `, ${row.annotation}` : ''}${row.current ? ', current' : ''}. ${row.detail}${countText ? `. ${countText}` : ''}`}
					data-annotation=${ifDefined(this._rowAnnotation(row) || undefined)}
					aria-pressed=${ifDefined(row.current === undefined ? undefined : String(row.current))}
					data-index=${index}
					data-row-id=${row.id}
					data-filter=${ifDefined(row.filter)}
					?disabled=${this._activationPending}
					?data-highlighted=${highlighted}
					@mousemove=${() => this._handleRowPointerMove('palette', index)}
					@mouseenter=${() => this._handleRowPointerEnter('palette', index)}
					@click=${() => this._activateRow(row)}
				>
					<!-- THE OPTION ALREADY IN FORCE SAYS SO. A check and the word,
					     not a colour: the highlight is already the list's only fill
					     and a second one would be two things reading as chosen. The
					     accessible name carries it too (aria-pressed above), because
					     a glyph is not a state a screen reader can infer. -->
					<!-- A QUIET WORD, NOT A CATEGORY WALL. The idle list is the
					     whole vocabulary in one ranked run, so a row has to be
					     able to say what KIND of thing it is — 'tag', 'section',
					     'sort' — without the list being cut into sections by it.
					     Annotations are an attribute of a row; headings are a
					     structure imposed on the ranking, and the ranking is the
					     product. It rides INSIDE the label area rather than
					     taking a grid row of its own, so a list of three hundred
					     rows does not grow three hundred extra lines. -->
					<!-- A ROW THAT TAKES A PILL OUT SHOWS THAT PILL, STRUCK.
					     Same slot, same component, same clause — the difference
					     between putting one in and taking one out is a treatment
					     on the thing, not a different kind of row. -->
					<span class=${row.removes ? 'row-label row-removes' : 'row-label'}>${this._rowLabelRender(row)}${this._rowAnnotation(row) ? html`<span class='row-annotation'>${this._rowAnnotation(row)}</span>` : ''}</span>
					${countText ? html`<span class='row-count'>${countText}</span>` : ''}
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

	//THE DOM IS WINDOWED; THE LIST IS NOT.
	//
	//Every row is ranked, reachable by arrow key, and counted by the same rules
	//as before — only the number of buttons actually in the DOM is capped, and
	//the cap grows when the user scrolls toward it or navigates past it. The
	//alternative (rendering all ~270 rows of the owner's vocabulary on every
	//keystroke) was measured at 74ms of scripting per character; this is 11ms.
	//
	//The window ALWAYS includes the highlighted row: it is extended to cover the
	//highlight before the slice, so the spec's MUST — "the transformation
	//accepted on keydown is the one visibly highlighted on keydown" — cannot be
	//broken by a row scrolling out of the rendered range.
	_visiblePaletteRows(rows : PaletteRow[], highlightedIndex : number) : PaletteRow[] {
		const limit = Math.max(this._renderedRowLimit, highlightedIndex + 1);
		return rows.length <= limit ? rows : rows.slice(0, limit);
	}

	//MORE ROWS WHEN THE USER REACHES FOR THEM. Scroll-driven rather than
	//timer-driven, so a list nobody scrolls costs nothing beyond its first
	//window.
	_handlePaletteScroll(e : Event) {
		const pane = e.target as HTMLElement;
		if (!pane) return;
		if (pane.scrollHeight - pane.scrollTop - pane.clientHeight > RENDER_MORE_THRESHOLD_PX) return;
		if (this._renderedRowLimit >= this._paletteRows.length) return;
		this._renderedRowLimit += RENDERED_ROWS_INCREMENT;
	}

	//ONE LIST, WITH HEADINGS RATHER THAN SECTIONS. A run of rows sharing a
	//section gets one heading in the app's panel-h3 register — normal weight,
	//subordinate colour, sentence case — and the heading is what carries the
	//grammar that the deleted verb chips used to restate on every row.
	_paletteListRender(rows : PaletteRow[], highlightedIndex : number) {
		if (!rows.length) {
			//THE LIST IS THE WHOLE VOCABULARY, so an empty one means the typed
			//token matched nothing at all — including the free-text fallback,
			//which only appears above two characters. The honest advice is to
			//clear the token, which brings the entire set back.
			return html`<div class='no-suggestions'>Nothing matches that yet. Clear the box to see everything you can add.</div>`;
		}
		let section = '';
		const visible = this._visiblePaletteRows(rows, highlightedIndex);
		return html`
			<div
				class='palette-list scroller'
				id='collection-palette-list'
				role='listbox'
				aria-label='Collection choices'
				@scroll=${this._handlePaletteScroll}
			>
				${visible.map((row, index) => {
		const heading = row.section && row.section !== section ? row.section : '';
		section = row.section;
		return html`${heading ? html`<div class='suggestion-heading'>${heading}</div>` : ''}${this._paletteRowRender(row, index, highlightedIndex)}`;
	})}
			</div>
		`;
	}

	//THE COMPILED-PATH LINE IS CUT (round 3, D6). It printed the URL the draft
	//would open, one quiet line under the list, on the argument that it taught
	//the `+`/`-` grammar by showing it. Nothing depended on it, nothing asked for
	//it, and the tightness pass's rule is exactly that: the composer is the
	//sentence, the input, the one list, the footer's count and commit, and the
	//pill row on a selection. A URL is none of those. Source mode — which is
	//where a user who wants to author the path goes — still shows it, editable,
	//which is a better teacher than a line you cannot touch.

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
			<div class='key-hints'>${this._composerKeyHints()}</div>
			${this._modifierNoteRender()}
			<!-- A MODE SWITCH, NOT A CONTROL ON THE DRAFT. The tightness pass
			     (D6) enumerates the parts of the composing flow; an EXIT from it
			     is not one of them, and neither are the two other exits (Escape,
			     and the commit button below). This is the composer's only visible
			     door to its other surface, and Source is where the path the
			     compiled-path line used to print now lives. -->
			<div class='mode-links'>
				<button class='small verb' @click=${this._handleEditSource}>Edit source</button>
			</div>
			${this._openActionRender(
		draftCount,
		this._activationPending,
		this._activationPending ? 'Already opening this collection' : 'Open this collection',
		this._handleOpenCurrentDraft,
		Boolean(highlighted)
	)}
			<!-- WHAT THE DRAFT MATCHES, BENEATH THE COUNT (D5). Not a grid, not a
			     list: one quiet line of names, so the number above it is about
			     something the user can see. -->
			${this._previewTitlesRender(draftCount)}
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
		return 'Type another condition…';
	}

	//THE FOOTER STATES THE CONTRACT, AND STATES NOTHING ELSE (round 3, D6).
	//
	//    Enter does the top thing · Cmd-Enter opens · Escape discards
	//
	//Three keys, one line, unchanging. The line it replaces had SEVEN states — one
	//per highlighted row species, each naming that row's own verbs ('Enter adds
	//and opens', 'Tab copies it into the draft', 'Click, Tab, or Enter opens
	//Source'). Those states were honest about a list whose rows did different
	//KINDS of thing, and that list is gone: every row is an action on the draft
	//now, so a footer that still varied per row would be teaching a distinction
	//the product no longer makes. A contract you have to re-read on every
	//arrow-down is not a contract.
	//
	//THE KEYS ARE SPELLED FROM THE CANONICAL COMBO TABLE, not by hand. The
	//round-3 wording is '⌘Enter', which is Mac-only and hand-synced — the two
	//properties shortcuts-data exists to eliminate, and its header documents a
	//tooltip that lied for weeks because of exactly that. `shortcutKeys` renders
	//'Cmd-Enter' on a Mac and 'Ctrl-Enter' everywhere else, from the same entry
	//the handler's contract is written against.
	//
	//TWO LAYERS KEEP A LINE OF THEIR OWN, because a layer with a different
	//contract in force has to say so or the footer is lying: the or-scoped input
	//(where every row is an alternative to one named clause) and the pill row
	//(whose keys come from PILL_ROW_KEY_HINTS, the module that performs them).
	//Both are peeled by the same Escape the main line names.
	//
	//AND A TOUCH LAYOUT HAS NO KEYBOARD TO STATE A CONTRACT FOR. On a phone this
	//line named keys the device does not have, which is the same defect one level
	//up: a footer describing controls the user cannot reach.
	//
	//WHICH IS A QUESTION ABOUT THE POINTER, NOT ABOUT THE WINDOW (round-3
	//tightness, minor). `mobile` is the app's SIZE flag, and it is true of a
	//desktop browser someone has made short — measured live at 900x420, where
	//`(hover: none)` and `(pointer: coarse)` were both false and the footer said
	//'Tap a row to use it' to a machine with a keyboard and a mouse. So the copy
	//keys off the input the reader actually has, and the layout keys off the size
	//it always did. Both are needed: `mobile` still decides the 44px targets and
	//the wrapped grid, which really are about room.
	_composerKeyHints() : string {
		if (this._touchInput) {
			if (this._pillRowOpen) return 'Editing a clause · tap its verbs to change it · tap another pill to edit that one';
			return 'Tap a row to use it · tap the open button for this collection';
		}
		if (this._orTarget) return `Type an alternative · Enter widens the clause · ${shortcutKeys('dialog-escape')} goes back to the pill`;
		//A WORD-SCOPED LIST HAS ITS OWN CONTRACT IN FORCE, so it says so — the
		//same reason the or-scoped line above exists. Every row here REPLACES one
		//word of the sentence, and Escape gives the word back rather than
		//discarding the draft.
		if (this._wordScope) return `Choose ${this._wordScope === 'set' ? 'what to start from' : 'the order and view'} · Enter uses the top one · ${shortcutKeys('dialog-escape')} goes back to the sentence`;
		//THE ARMED BACKSPACE LEADS THE LINE. The first Backspace on an empty input
		//SELECTS rather than removing, and a contract nobody can see is not one.
		if (this._pillRowOpen) {
			const keys = PILL_ROW_KEY_HINTS.map(hint => `${hint.key} ${hint.means}`).join(' · ');
			const armed = this._backspaceArmed ? `${this._backspaceArmedMessage} · ` : '';
			return `${armed}←→ choose clause · ${keys} · ${shortcutKeys('dialog-escape')} closes the row`;
		}
		return `Enter does the top thing · ${shortcutKeys('commit-collection-composer')} opens · ${shortcutKeys('dialog-escape')} discards`;
	}

	//WHETHER THIS READER'S POINTER IS A FINGER. Read from the media query rather
	//than from the viewport, and only for COPY — see _composerKeyHints. Defaults
	//to false where matchMedia is absent (a jsdom test, an old engine), because a
	//keyboard contract stated to somebody who has no keyboard is a smaller defect
	//than a tap contract stated to somebody who does: the keys are still there
	//either way, and the taps may not be.
	get _touchInput() : boolean {
		if (typeof window === 'undefined' || !window.matchMedia) return false;
		return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
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
	//WHAT THE DRAFT ACTUALLY MATCHES, NAMED (round 3, D5).
	//
	//The owner's constitution calls the un-committed draft "just showing a
	//preview of cards", and a number alone is not one: '118 cards' is the same
	//sentence for every collection of that size. Three titles say WHICH cards,
	//and they cost nothing new — the worker run that produced the count already
	//returned the ordered ids, and this reads titles for them out of the map the
	//composer already holds for naming card-valued clauses.
	//
	//ABSENT, NOT EMPTY, WHILE PENDING. A line that appears blank and then fills
	//is a layout shift on every keystroke; "we do not know yet" and "there is
	//nothing to say" are different facts and only the second of them is worth a
	//line. A card whose record has not loaded is skipped rather than named by its
	//id — an internal identifier never reaches a user (HS-1.4) — so on a corpus
	//that is still loading the line is simply shorter, or absent.
	//AND IT NAMES CARDS ONLY WHEN IT CAN TELL THEM APART (round-3 tightness, C2).
	//
	//A corpus has repeated titles in it — this one opens on three cards all
	//called 'What is this?' — so the strip read `What is this? · What is this? ·
	//What is this? · and 1,236 more`: three names for one name, in a line whose
	//entire job is to say WHICH cards. Consecutive repeats collapse to one, and a
	//strip that would then show fewer than two DISTINCT titles is not a preview at
	//all — one name and a remainder is the count again, spelled longer — so it is
	//dropped rather than shown saying nothing.
	//
	//NOT deduped across the whole line: the ids are the collection's own leading
	//order, and two runs of one title with something between them is a real fact
	//about the collection that the strip is allowed to show. The remainder still
	//counts the cards, not the surviving names, so it stays true.
	//
	//THE CRITIC'S VOTE WAS TO CUT THE STRIP OUTRIGHT. It survives because the
	//owner asked for it; this is the information-content fix, not the verdict.
	_previewTitlesRender(count : number | undefined) {
		if (!count) return '';
		void this._previewIDsVersion;
		const ids = this._retainedPreviewIDs.get(this._previewCountKey(this._collectionDescription));
		if (!ids || !ids.length) return '';
		const named = ids.map(id => this._cardTagInfos?.[id]?.title || '').filter(Boolean);
		const titles = named.filter((title, index) => title !== named[index - 1]);
		if (new Set(titles).size < 2) return '';
		const remaining = count - named.length;
		const line = remaining > 0 ? `${titles.join(' · ')} · and ${remaining} more` : titles.join(' · ');
		return html`<div class='preview-titles'>${line}</div>`;
	}

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
		//HS-1.3's definition obligation, kept without a visible concept: the '?'
		//badge is cut and the sentence it carried lives on the heading. See
		//_sentenceRender.
		this.titleHint = COLLECTION_HELP;
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
			this._commitDraftEdit(parsed.description, false, parsed.selectedCardRaw);
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
			this._commitDraftEdit(this._lastValidSource.description, false, this._lastValidSource.selectedCardRaw);
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
			this._backspaceArmed = false;
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
			//THE KEYBOARD CAN REACH PAST THE RENDERED WINDOW, so the window
			//follows it. _visiblePaletteRows already refuses to drop the
			//highlighted row, which keeps the spec's MUST intact on its own;
			//moving the state too is what gets that row a COUNT, because the
			//preview request is scoped to the same window.
			if (this._highlightedRow >= this._renderedRowLimit) {
				this._renderedRowLimit = Math.max(
					this._renderedRowLimit + RENDERED_ROWS_INCREMENT,
					this._highlightedRow + 1
				);
			}
			return;
		}
		if (e.key === 'Tab' && !e.shiftKey && rows.length) {
			e.preventDefault();
			e.stopPropagation();
			//TAB IS AN ALIAS FOR ENTER'S EXECUTE, kept for the muscle memory the
			//previous contract built (round 3, D1: "Keep Tab as an alias for the
			//same execute"). With nothing highlighted it still REACHES the list
			//— that gesture has no other key, and Enter on an empty input is
			//spoken for by the commit — and with a row highlighted it executes
			//exactly what Enter would.
			if (!highlighted) {
				this._highlightedRow = 0;
				this._rowHighlightActive = true;
				return;
			}
			this._activateRow(highlighted);
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			committedKeystrokes.add(e);
			//THE KEY CONTRACT, WHOLE (round 3, D1 — the owner's constitution:
			//"ENTER EXECUTES THE TOP ACTION … not live-changing the real
			//collection until you commit with Cmd-Enter").
			//
			//  ⌘Enter / Ctrl-Enter  commit: open the draft and close.
			//  Enter with a row     execute that row against the DRAFT. Typing
			//                       makes the top row the highlighted one, so
			//                       "the top action" and "the highlighted one if
			//                       the user arrowed" are one branch and not two.
			//  Enter with no row    NOTHING. See below.
			//
			//The old split — Tab adds, Enter opens the highlighted row — is
			//superseded outright. It made the list two kinds of thing (rows you
			//add and rows you go to) and it put a navigation on the key the user
			//presses after every single token.
			//
			//ENTER NEVER COMMITS (round-3 tightness, B1). SUPERSEDED: the branch
			//below used to read `else this._handleOpenCurrentDraft()`, on the
			//argument that "type, enter, type, enter, enter" ends naturally in a
			//commit. It ends in a NAVIGATION, and the constitution gives navigation
			//exactly two gestures — Cmd-Enter and the primary — for the reason the
			//critique found by pressing it: an Enter that adds a clause CLEARS the
			//input and leaves nothing highlighted, so the very next Enter, the one
			//somebody presses to add the next thing before they have typed it, was
			//a commit. One key meant "act on the draft" and "leave" a keystroke
			//apart, and which one you got depended on a highlight you could not see
			//because there was nothing in the box.
			//
			//So it is a NO-OP, and deliberately not a re-arm of row 0 either: an
			//empty input's list is the idle list, whose top row is whatever the
			//ranking put there, and arming a highlight the user cannot have aimed
			//at makes the NEXT Enter execute a row nobody chose. Focus stays where
			//it is, the footer already says what the three keys do, and the arrow
			//keys reach the list the moment the user actually wants it.
			if (e.metaKey || e.ctrlKey) {
				this._handleOpenCurrentDraft();
				return;
			}
			if (highlighted) this._activateRow(highlighted);
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
		//THE COMMIT MODIFIER OUTRANKS EVERY LAYER. ⌘Enter means "open this
		//collection" wherever the user is in the composer, including with a pill
		//selected — otherwise the one key the constitution reserves for
		//committing would silently mean "focus a date field" on the exact
		//keystroke somebody finished composing on.
		if (e.metaKey || e.ctrlKey) return false;
		const expression = this._draftExpression;
		const path = this._selectedPath;
		const memberIndex = this._selectedMemberIndex;
		//The latch survives exactly one keystroke: the Backspace that armed it.
		//Anything else — an arrow, a flip, a character — is the user doing
		//something other than confirming, and the promise stops being in force.
		if (e.key !== 'Backspace') this._backspaceArmed = false;
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
				//THE PROMISE IS MADE WHERE IT CAN BE READ. This sentence used to
				//exist only inside the visually-hidden live region, so a sighted
				//user got a pill row opening under the sentence and no word about
				//the second keystroke that was now armed — the contract was stated
				//to screen readers and to nobody else. The latch below puts the
				//same sentence on the key-hints line, which is where this dialog
				//states every other contract that is in force.
				this._backspaceArmed = true;
				this._clauseSelectionMessage = this._backspaceArmedMessage;
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
			//THE URL'S OWN SPELLING FOR UNION, as the shortcut for adding one:
			//the character a user presses here is the one they will read in a
			//path in Source (proposal C §4.6).
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
				withMemberNegationToggled(expression, path[0], memberIndex), path);
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
	//WHAT THIS PERSON PICKED, REMEMBERED — but only what they PICKED.
	//
	//The signal is acceptance, never presentation: a list that learned from the
	//rows it showed you would converge on whatever it happened to show you
	//first, which is a feedback loop wearing personalization's clothes. Called
	//from the one place a row actually becomes part of a draft.
	//
	//The write lands in the store for the NEXT session; `_usageWeights` is not
	//refreshed here on purpose, because a list that reordered the moment you
	//used it would move the row you were about to use again.
	_recordRowAcceptance(row : PaletteRow) {
		if (row.usageKey) recordCompletionAcceptance(row.usageKey, this._userScope);
		//THE SET IS STICKY. Choosing one is a statement about how this person
		//starts a composition, not only about this one — so it becomes the
		//default the next composition that begins from the app's own default
		//view will use. The word is always in the sentence and always one typed
		//word from being changed, so this is a default and not a decision taken
		//away from anybody.
		if (row.singleton && row.id.startsWith('set:')) {
			recordStickyComposerSet(row.description.set, this._userScope);
		}
	}

	//EXECUTING A ROW. There is exactly one verb now (round 3, D1): every row is an
	//action on the DRAFT, and none of them navigates. What differs between rows is
	//WHICH action — add a clause, remove one, open one's controls, change the set,
	//change the sort, or replace the whole draft with a collection you have been
	//in before — which is precisely the list the owner's constitution enumerates.
	//
	//The `open` parameter is gone with the split it served. Nothing here can leave
	//the composer, so there is no second mode for a caller to select.
	_activateRow(row : PaletteRow) {
		//AN EDIT ROW OPENS A CLAUSE'S CONTROLS AND CHANGES NOTHING ELSE. It is the
		//one action in the list whose consequence is a surface rather than a
		//collection: the pill row appears under the sentence, on the clause the row
		//named, with the caret in its first control.
		if (row.edits && row.targetIndex !== undefined) {
			this._recordRowAcceptance(row);
			this._composerInput = '';
			this._highlightedRow = 0;
			this._rowHighlightActive = false;
			this._orTarget = null;
			this._wordScope = '';
			this._selectToken(row.targetMemberIndex !== undefined && row.targetMemberIndex >= 0 ?
				[row.targetIndex, row.targetMemberIndex] :
				[row.targetIndex]);
			void this._focusPillRowControl();
			return;
		}
		//THE OPTION ALREADY IN FORCE IS NOT AN EDIT. It is in the list so the
		//list can answer "which one is it now?"; choosing it means "this one",
		//which is where the draft already is. Committing it would push an
		//identical description through the draft history.
		if (row.current) {
			this._wordScope = '';
			this._composerInput = '';
			this._highlightedRow = 0;
			this._rowHighlightActive = false;
			this._focusComposerInputSoon();
			return;
		}
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
		//the count of what was chosen. The old explicit-confirm gate existed
		//because the panel it gated was a six-control wall the draft could not
		//show; a one-line row under the sentence needs no gate.
		//This branch is for a feed that has no expression to apply — the Refine
		//rows that name a family. A typed family arrives as a valence row with a
		//real expression, and is handled after the commit.
		if (row.kind === 'transform' && row.configurable && row.filter) {
			this._recordRowAcceptance(row);
			void this._addFamilyWithDefaults(row.filter.split('/')[0]);
			return;
		}
		this._recordRowAcceptance(row);
		//A DESTINATION REPLACES THE DRAFT; IT DOES NOT NAVIGATE (round 3, D1).
		//That is the combinatorial action the constitution names — several
		//changes at once, applied to the draft you are still composing — and it
		//is what unifies the row species: with the last navigating row gone,
		//every row in this list does the same KIND of thing.
		//
		//A ROW THAT CARRIES A PATH CARRIES ITS CARD TOO. A recent visited on one
		//card, and a pasted collection URL with a card suffix, both name a
		//selected card as part of what they ARE — and while a destination row
		//navigated, that card travelled with the navigation. Now that the row
		//replaces the draft instead, the card has to travel into the draft or the
		//eventual commit would open the collection somewhere the row never said.
		//Every other row leaves the selected card exactly where it is.
		this._commitDraftEdit(row.description, true, this._rowSelectedCard(row));
		this._composerInput = '';
		this._highlightedRow = 0;
		this._orTarget = null;
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

	//THE CARD A DESTINATION ROW NAMES, or the draft's own. Read from the row's
	//path through the app's own parser rather than from a second field, so the
	//card the row would have navigated to and the card the draft ends up on are
	//the same card. The placeholder never becomes a real selection — it is the
	//router's spelling for "no card in the URL" (HS-1.4).
	_rowSelectedCard(row : PaletteRow) : string {
		if (row.kind !== 'destination' || !row.destinationPath) return this._draftSelectedCard;
		if (!row.destinationPath.startsWith(COLLECTION_URL_PREFIX)) return this._draftSelectedCard;
		const [, selectedCard] = CollectionDescription.deserializeWithExtra(row.destinationPath.slice(COLLECTION_URL_PREFIX.length));
		if (!selectedCard || cardIDIsPlaceholder(selectedCard)) return '';
		return selectedCard;
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
	//is what keeps the source round-trip working on a boolean edit without it
	//learning what a FilterExpressionNode is.
	_applyExpression(expression : CollectionExpression, selectPath : CollectionSentencePath | null = null) {
		this._commitDraftEdit(collectionDescriptionWithExpression(this._collectionDescription, expression));
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
		this._applyExpression(e.detail.expression, survives ? path : null);
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

	//ONE SENTENCE, TWO AUDIENCES. The live region announces it and the key-hints
	//line prints it, from one string, so the promise a screen reader hears and
	//the promise the screen makes are the same promise.
	get _backspaceArmedMessage() : string {
		return `${this._selectedTokenLabel} selected · Backspace again to remove`;
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
		this._backspaceArmed = false;
		this._clauseSelectionMessage = path.length ? `${this._selectedTokenLabel} selected` : '';
	}

	//The opener's requested clause, kept only if it addresses a real condition of
	//the draft about to be shown. A group's own edge and a plain condition are
	//both [index], which is exactly what the why-here panel sends: its rows scope
	//to conditions, never to one alternative inside a group.
	get _validRequestedSelection() : CollectionSentencePath {
		const requested = this._requestedSelection;
		if (requested.length !== 1) return [];
		const index = requested[0];
		return index >= 0 && index < this._draftExpression.length ? [index] : [];
	}

	_clearSelection() {
		this._selectedPath = [];
		this._orTarget = null;
		this._backspaceArmed = false;
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
			await this._focusPillRowControl();
			return;
		}
		const node : FilterExpressionNode = {kind: 'filter', filter: defaultConfigurableFilter(family)};
		const next = withConditionAppended(expression, node);
		this._composerInput = '';
		this._applyExpression(next, [next.length - 1]);
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

	//THE ONE FUNNEL EVERY DRAFT EDIT PASSES THROUGH.
	//
	//THE STICKY STARTING SET IS NO LONGER APPLIED HERE (round-3 tightness, M6).
	//It was, and that is exactly what made the composer say one thing and do
	//another: the sentence rendered `_collectionDescription.set` — `Main`, the set
	//the draft still had — while this funnel rewrote the FIRST edit to
	//`everything`. Two values for one fact, one of them on screen and the other
	//in the commit. It is seeded once, at open, by _seedDraftStartingSet, so the
	//draft this funnel receives and the draft the sentence renders are the same
	//object and cannot disagree.
	//
	//THE IN-DIALOG RECEIPT AND ITS UNDO ARE GONE (round 3, D1). The owner's
	//constitution: "if you make a mistake, esc/X resets to the previous state" —
	//the draft is a preview that has changed nothing real, and Escape discarding
	//it IS the undo. A receipt strip narrating each draft edit was a report about
	//a change nobody had made yet, and an Undo button beside it was a second,
	//weaker undo competing with the one the dialog already had. The receipt that
	//survives is the one that reports a real navigation, and it lives outside this
	//dialog, after the commit.
	//
	_commitDraftEdit(description : CollectionDescription, focusInput = false, selectedCard = this._draftSelectedCard) {
		this._draftSelectedCard = selectedCard;
		this._selectedPath = [];
		//The draft just changed, so the list is about to be rebuilt around it.
		//Nothing in the new list is what the user was pointing at, so the next
		//Enter commits the draft they just composed.
		this._rowHighlightActive = false;
		this._pointerHighlightArmed = false;
		this._backspaceArmed = false;
		this._clauseSelectionMessage = '';
		store.dispatch(updateCollectionConfigurationSnapshot(description));
		if (focusInput) this._focusComposerInputSoon();
	}

	//WHERE A COMPOSITION STARTS FROM, DECIDED ONCE, AT THE MOMENT IT OPENS
	//(round-3 tightness, M6).
	//
	//THE DEFECT. Standing on the app's bare default view, the composer showed the
	//word `Main` in its sentence — the set the snapshot really had — and then
	//committed `everything/`, because the sticky rewrite was deferred to the first
	//draft edit. Observed as a non-determinism (it depends on whether the draft
	//happens to be bare `main`, which it is on the first open after a reload and
	//is not after any prior edit), but it is not a race: it is two derivations of
	//one fact, one of them rendered and the other committed. Everything downstream
	//inherited the split — the primary's count counted `main/`, the row counts had
	//to re-apply the rewrite by hand to avoid promising numbers for a collection
	//they would not open, and the URL under Edit source named the wrong set.
	//
	//THE FIX IS TO REMOVE THE SECOND DERIVATION, not to teach the sentence about
	//the first. The set is written into the DRAFT here, once, on the open
	//transition; from then on `_collectionDescription` IS the set the composer
	//displays, counts, and commits, and every other reader of it is correct
	//without knowing this rule exists.
	//
	//IT SEEDS FROM THE ACTIVE COLLECTION, which also closes the stale-snapshot
	//door the reducer leaves open: OPEN_CONFIGURE_COLLECTION_DIALOG is idempotent
	//(`if (state.snapshot) return state`), so a snapshot that outlived its dialog
	//— a reload while open, a tab-lease reclaim — is what the next open would have
	//composed from, silently, with a set word from a session that had ended. The
	//draft this composer opens on is the collection on screen, always, which is
	//the spec's principle 1 stated as an assignment rather than as a hope.
	//
	//WHAT DOES NOT CHANGE: the rewrite still fires only from the app's own bare
	//default view (collectionDescriptionStartsFromAppDefault) — refining a
	//collection the user is actually in begins from where they are. What DOES
	//change, and is worth stating for the owner: opening the composer on bare
	//`/c/main/` and committing without an edit now opens `/c/everything/` rather
	//than closing on the collection already open. That is the honest reading of a
	//sentence that has said `Everything` since it appeared.
	_seedDraftStartingSet() {
		const active = this._activeCollectionDescription;
		if (!active) return;
		const seeded = collectionDescriptionWithStickyStart(active, this._stickySet);
		if (seeded.serialize() === this._collectionDescription?.serialize()) return;
		store.dispatch(updateCollectionConfigurationSnapshot(seeded));
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
						//THE TYPED TEXT WAS SCOPED TO THE OR, so it leaves with the
						//scope. Kept, the same characters silently change meaning:
						//"tag-2" was an ALTERNATIVE to the clause the row named, and
						//the moment the scope closes the list re-reads it as a new
						//AND condition — a different collection, offered under text
						//the user typed to mean something else. Escape peels a layer;
						//it must not leave a changed reading behind.
						this._composerInput = '';
						this._highlightedRow = 0;
						this._rowHighlightActive = false;
						this._focusComposerInputSoon();
						return true;
					}
					if (this._selectedPath.length) {
						this._clearSelection();
						this._focusComposerInputSoon();
						return true;
					}
					if (this._wordScope) {
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

	//ESCAPE DISCARDS, AND THE DISCARD IS TOTAL (round 3, D1). Nothing about the
	//draft survives the close — not the description, not the typed text. The
	//owner's constitution makes that the composer's undo: "if you make a mistake,
	//esc/X resets to the previous state". A draft that came back on the next open
	//meant Escape did not reset anything; it deferred, and the user had to press
	//Escape a second time on a surface that had silently reopened on their
	//mistake.
	override _shouldClose() {
		//Override base class.
		if (collectionComposerEnabled()) {
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
		if (changedProps.has('open') || changedProps.has('_entryMode') || changedProps.has('_wordScope')) {
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
				this._wordScope = '';
				this._orTarget = null;
				//A fresh session gets fresh counts: corpus membership may have
				//changed since the last time this composer was open.
				this._retainedPreviewCounts.clear();
				this._retainedPreviewIDs.clear();
				//AND FRESH PERSONAL WEIGHTS, read ONCE. The store decays with
				//time; re-reading it per keystroke would let the list re-rank
				//under a word somebody is halfway through typing.
				this._usageWeights = completionUsageWeights(this._userScope);
				this._stickySet = readStickyComposerSet(this._userScope, SET_NAMES);
				//AND THE DRAFT IS SEEDED WITH IT, HERE, BEFORE ANYTHING RENDERS
				//IT. One value, written into the one place the composer reads its
				//draft from. See _seedDraftStartingSet.
				this._seedDraftStartingSet();
				this._draftResolvesEmpty = false;
				this._renderedRowLimit = INITIAL_RENDERED_ROWS;
				//A REQUESTED SELECTION IS HONOURED ONLY WHERE IT POINTS AT
				//SOMETHING. The request was composed against the collection the
				//user was reading; the draft this composer opens on is usually
				//that same collection, but a request can also outlive the
				//collection it was composed against — selecting index 2 of a
				//sentence
				//that now has one condition would open the pill row on nothing —
				//or worse, on some other clause that happens to sit there.
				this._selectedPath = this._validRequestedSelection;
				this._backspaceArmed = false;
				//The announcement follows the selection, including when there is
				//none: focus lands in the input either way, so the only thing
				//that tells a screen-reader user the composer opened ON a clause
				//is this line.
				this._clauseSelectionMessage = this._selectedPath.length ? `${this._selectedTokenLabel} selected` : '';
				//Once per composer session, not once per app lifetime: a user
				//who comes back a week later has earned the explanation again.
				this._modifierNote = '';
				this._newTabNoteShown = false;
				this._sourceDirty = false;
				this._sourceAutoDelimitedSegment = false;
				this._draftSelectedCard = this._requestedCard;
				this._sourceInput = this._entryMode === 'source' ? window.location.pathname : '';
				const parsed = this._entryMode === 'source' ? this._parsedSource : null;
				if (parsed?.status === 'valid') this._draftSelectedCard = parsed.selectedCardRaw;
				this._lastValidSource = parsed?.status === 'valid' ? parsed : null;
			}
		}
		//THE SCOPE CAN ARRIVE AFTER THE DIALOG DOES (round-3 tightness, M6).
		//
		//Both personal stores are keyed by uid, and `_userScope` is a selector
		//result: on the first open after a reload — the exact condition the
		//critique observed the flip under — auth may not have resolved when the
		//composer opened, so both reads answered for the signed-out scope and the
		//user's own sticky set arrived a moment later. Re-read once when the scope
		//actually changes, and only while the draft is still the bare default,
		//which is the only state the sticky set can still change: nothing has been
		//composed there, so nothing moves under anybody. Deliberately NOT a general
		//re-read — the once-per-session rule is what keeps the list from re-ranking
		//mid-keystroke.
		if (this.open && changedProps.has('_userScope') && !changedProps.has('open') &&
			this._collectionDescription && collectionDescriptionStartsFromAppDefault(this._collectionDescription)) {
			this._usageWeights = completionUsageWeights(this._userScope);
			this._stickySet = readStickyComposerSet(this._userScope, SET_NAMES);
			this._seedDraftStartingSet();
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
			changedProps.has('_wordScope') ||
			//Scrolling (or arrowing) further into the vocabulary puts new rows
			//on screen, and a row on screen is a row whose count can be read.
			changedProps.has('_renderedRowLimit') ||
			//A COUNT CAN CREATE ROWS, AND ROWS THAT DID NOT EXIST WERE NEVER
			//ASKED FOR. The recovery section appears exactly when the draft's own
			//count arrives and is zero, so the rows it adds were not in the list
			//when the request that produced that count was assembled. One more
			//pass, and it settles: the second request changes nothing that
			//changes the row set again.
			changedProps.has('_draftResolvesEmpty') ||
			changedProps.has('_orTarget')
		) this._refreshPreviewCounts();
	}

	//The identity of the thing a count counts. Same shape the preview module
	//groups its own work by, so two suggestions naming one collection share one
	//count here for the same reason they share one worker run there.
	_previewCountKey(description : CollectionDescription) : string {
		return `${this._activeCardID}\n${description.serialize()}`;
	}

	//How many of the draft's own cards the preview line names, and how many ids
	//are retained per collection to name them from. Three titles is a line; a
	//fourth is a paragraph, and the count beside them already says how many there
	//are in total.
	_rememberPreviewIDs(key : string, ids : readonly string[]) {
		if (this._retainedPreviewIDs.size >= RETAINED_PREVIEW_COUNT_LIMIT) {
			const oldest = this._retainedPreviewIDs.keys().next().value;
			if (oldest !== undefined) this._retainedPreviewIDs.delete(oldest);
		}
		this._retainedPreviewIDs.set(key, ids.slice(0, PREVIEW_TITLE_LIMIT));
		this._previewIDsVersion++;
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
		//THE ONE FACT THAT CHANGES WHICH ROWS EXIST, derived where every other
		//count is derived and BEFORE any early return — a composer with previews
		//turned off still has a retained map, and the recovery section is not a
		//feature of the preview worker. Naming it as state is what puts it in
		//updated()'s trigger list; see _draftResolvesEmpty for why that matters.
		this._draftResolvesEmpty = this._countForDescription(previewDescription) === 0;
		if (!this.open || !collectionComposerPreviewEnabled()) {
			this._previewCounts = {};
			this._draftCountPending = false;
			return;
		}
		//A ROW IS COUNTED WHEN ITS COUNT WOULD MEAN SOMETHING. A row that opens
		//Source has no collection to count; a configurable family DOES have one
		//now (S3), spelled with its own default, and the window below is what
		//keeps that affordable.
		//
		//AND ONLY THE ROWS ON SCREEN. The list is the whole vocabulary now, so
		//"every row" would mean a few hundred collection runs per keystroke for
		//numbers nobody can see. The window the DOM renders is exactly the set
		//whose counts can be read, so it is exactly the set that is asked for;
		//scrolling extends both together.
		const countableRows = this._visiblePaletteRows(this._paletteRows, this._activeHighlightIndex(this._paletteRows));
		const previewSuggestions : CollectionComposerSuggestion[] = this._entryMode === 'source' ? [] :
			countableRows
				.filter(row => !row.sourceFilter && this._rowCountMeaningful(row))
				.map(row => ({
					id: row.id,
					kind: 'source' as const,
					action: 'open' as const,
					name: row.label,
					label: row.label,
					detail: '',
					description: this._appliedDescription(row),
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
			(suggestionID, count, ids) => {
				if (!this.open) return;
				const key = keyBySuggestionID.get(suggestionID);
				if (key) this._rememberPreviewCount(key, count);
				if (suggestionID === this._draftPreviewID) this._draftResolvesEmpty = count === 0;
				//ONLY THE DRAFT'S OWN NAMES ARE KEPT. Every row in the list is
				//counted; naming the cards behind three hundred of them would be
				//a title list nobody can read for a collection nobody has chosen.
				if (key && suggestionID === this._draftPreviewID) this._rememberPreviewIDs(key, ids);
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
		this._tagInfos = selectCollectionClauseTagInfos(state);
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
		this._requestedSelection = selectConfigureCollectionDialogSelection(state);
		this.title = collectionComposerEnabled() ? 'Compose a Collection' : 'Configure Collection';
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'configure-collection-dialog': ConfigureCollectionDialog;
	}
}
