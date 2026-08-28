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
	registerSnackbarAction,
	showSnackbar,
} from '../actions/app.js';

import {
	collectionReceiptCanUndo,
	currentBrowserLocation,
	clearCollectionNavigationReceipt,
	pendingCollectionNavigationReceipt,
	recordCollectionNavigationReceipt,
} from '../collection-composer-receipt.js';

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
	CONFIGURABLE_FILTER_INFO,
	LEGAL_VIEW_MODES,
} from '../filters.js';

import {
	CANCEL_ICON,
	LINK_ICON,
	OPEN_IN_BROWSER_ICON,
	PLUS_ICON
} from '../../shared/icons.js';

import './configure-collection-filter.js';

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
	formatCollectionCountDelta,
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
	collectionComposerSuggestions,
	rankedComposerSuggestions,
	readableCollectionExpression,
} from '../collection-composer-suggestions.js';

import {
	readRememberedCollections,
	RememberedCollectionEntry,
} from '../collection-composer-history.js';

import {
	memoize,
} from '../memoize.js';

export const UNDO_COLLECTION_NAVIGATION_ACTION_ID = 'undo-collection-navigation';

export const COLLECTION_NAVIGATION_RECEIPT_DEDUPE_KEY = 'collection-navigation-receipt';

//Registered at MODULE scope, and in the same module that shows the receipt.
//The registry maps a serializable id to a thunk, so the mapping has to exist
//before any message carrying that id can be pressed — putting both in one
//module makes that true by construction rather than by boot ordering.
//A refusal is never silent (HOUSE-STYLE §3.5). Sentence case, second person,
//contractions used consistently (§2.3), U+2019 apostrophes (§2.2), and it
//reports rather than scolds — being back already is not a mistake.
const UNDO_ALREADY_BACK_MESSAGE = 'You’re already back at that collection, so there’s nothing to undo.';

registerSnackbarAction(UNDO_COLLECTION_NAVIGATION_ACTION_ID, (dispatch) => {
	const returnPath = pendingCollectionNavigationReceipt();
	clearCollectionNavigationReceipt();
	//EVERY press produces an outcome. The old shape had two ways to do nothing
	//visible: a guard that refused an untouched receipt, and a history.back()
	//with nothing behind it. Undo now NAVIGATES to the collection the receipt
	//interrupted, so the only refusal left is the one that is actually true.
	//'refused' is the kind for something that did not happen with no data at
	//stake; 'committed'/'queued'/'discarded' are write outcomes and none apply.
	if (!collectionReceiptCanUndo(returnPath, currentBrowserLocation())) {
		dispatch(showSnackbar(UNDO_ALREADY_BACK_MESSAGE, {kind: 'refused'}));
		return;
	}
	const result = dispatch(navigatePathToResult(returnPath));
	if (result.status === 'committed') return;
	//'unchanged' cannot reach here (the guard just proved the collections
	//differ) but a blocked edit can, and it is the same refusal the composer's
	//own commit paths speak.
	dispatch(showSnackbar(result.status === 'blocked-editing' ?
		'Finish or cancel the current card edit before undoing this.' :
		UNDO_ALREADY_BACK_MESSAGE, {kind: 'refused'}));
});

//BOTH ways of opening a collection report it the same way. They were two
//copies of the same call, already disagreeing about how to spell the card
//count, which is exactly how a receipt and its Undo drift apart.
const showCollectionNavigationReceipt = (returnPath : string, expression : string, count : number | undefined) : void => {
	//Recorded BEFORE the message: the guard reads this slot, and the dedupeKey
	//replacing the visible receipt is what invalidates the previous one.
	//returnPath is where the user was BEFORE this navigation — captured by the
	//caller, because by the time this runs the URL is already the destination.
	recordCollectionNavigationReceipt(returnPath);
	//Hoisted rather than inlined: the copy-quality scanner reads the message
	//literal, and a nested template ends its parse early.
	const countSuffix = count === undefined ? '' : ` · ${formatCollectionCardCount(count)}`;
	store.dispatch(showSnackbar(
		`Now showing ${expression}${countSuffix}.`,
		{
			//'info', not 'committed'/'queued': nothing was written to a server.
			//Those are write-outcome words (snackbar-copy.ts).
			kind: 'info',
			action: {label: 'Undo', actionID: UNDO_COLLECTION_NAVIGATION_ACTION_ID},
			//One receipt at a time.
			dedupeKey: COLLECTION_NAVIGATION_RECEIPT_DEDUPE_KEY,
		}
	));
};

import {
	parseCollectionSource,
	CollectionSourceExpectedKind,
	ParsedCollectionSource,
} from '../collection-source.js';

import {
	buildCollectionFilterCatalog,
	collectionFilterCatalogCategories,
	CollectionFilterCatalogCategory,
	CollectionFilterCatalogItem,
	CollectionFilterCatalogPolarity,
} from '../collection-filter-catalog.js';

//The three lists that are painted by the .suggestion rules. Naming them means
//the pointer rule below is written once rather than three times.
type ComposerRowList = 'suggestion' | 'catalog' | 'source-completion';

//The synthetic suggestion the primary action and a highlight-free Enter both
//open. It is the only destination allowed to close the composer silently when
//it turns out to be the collection already on screen.
const CURRENT_DRAFT_SUGGESTION_ID = 'current-draft';

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

const catalogItemsFor = memoize((
	filterDescriptions : {[filterName : string]: string},
	candidates : CollectionComposerCandidate[],
	draft : CollectionDescription,
	query : string,
	polarity : CollectionFilterCatalogPolarity
) : CollectionFilterCatalogItem[] => buildCollectionFilterCatalog(filterDescriptions, candidates, draft, query, polarity), 2) as (
	filterDescriptions : {[filterName : string]: string},
	candidates : CollectionComposerCandidate[],
	draft : CollectionDescription,
	query : string,
	polarity : CollectionFilterCatalogPolarity
) => CollectionFilterCatalogItem[];

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

const frozenOrderSuggestions = memoize((suggestions : CollectionComposerSuggestion[], order : string[]) : CollectionComposerSuggestion[] => {
	const position = new Map(order.map((id, index) => [id, index]));
	return suggestions
		.map((suggestion, index) => ({suggestion, index}))
		.sort((left, right) =>
			(position.get(left.suggestion.id) ?? left.index) - (position.get(right.suggestion.id) ?? right.index))
		.map(({suggestion}) => suggestion);
}, 2) as (suggestions : CollectionComposerSuggestion[], order : string[]) => CollectionComposerSuggestion[];

const composerSuggestionsFor = memoize((
	draft : CollectionDescription,
	input : string,
	filterDescriptions : {[filterName : string]: string},
	cardsSelected : boolean,
	recentCollections : RecentComposerCollection[],
	activeCollection : CollectionDescription | undefined,
	previousCollection : string | undefined,
	preservedSelectedCard : string,
	candidates : CollectionComposerCandidate[]
) : CollectionComposerSuggestion[] => collectionComposerSuggestions(draft, input, filterDescriptions, {
	cardsSelected,
	recentCollections,
	activeCollection,
	previousCollection,
	preservedSelectedCard,
	sourceAllowedOrigins: COMPOSER_ALLOWED_ORIGINS,
	candidates,
}), 2) as (
	draft : CollectionDescription,
	input : string,
	filterDescriptions : {[filterName : string]: string},
	cardsSelected : boolean,
	recentCollections : RecentComposerCollection[],
	activeCollection : CollectionDescription | undefined,
	previousCollection : string | undefined,
	preservedSelectedCard : string,
	candidates : CollectionComposerCandidate[]
) => CollectionComposerSuggestion[];

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

//WHAT A ROW COSTS YOU, in one word the eye can sort on.
//
//Open is the only verb that LEAVES: it commits a navigation and closes the
//composer. Add / Remove / Replace / Configure / Edit all rewrite the draft (or
//its representation) in place and leave the user composing. Sentence case makes
//the words quieter than the old caps did, so the consequence class has to be
//carried visually as well as lexically — filled for the one that navigates,
//outlined for the ones that do not.
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
		_highlightedSuggestion = 0;

	//Whether _highlightedSuggestion currently means anything. The spec draws a
	//hard line between "Enter with a highlighted suggestion" (open that
	//destination) and "Enter with no highlighted suggestion" (open the current
	//draft). A row is highlighted only once the user has pointed at one: by
	//typing (the list is then interpretations of what they typed), by arrowing,
	//or by genuinely moving the mouse over a row. Rebuilding the list — after a
	//Tab materialization, a clause edit, or an undo — leaves nothing
	//highlighted, so the next Enter commits the draft the user just composed
	//rather than whatever happens to sit in row 0.
	@state()
		_suggestionHighlightActive = false;

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

	@state()
		_builderExpanded = false;

	@state()
		_catalogOpen = false;

	@state()
		_catalogHighlightedIndex = 0;

	@state()
		_pendingCatalogFilter = '';

	@state()
		_pendingCatalogChanged = false;

	@state()
		_expandedCatalogCategories = new Set<CollectionFilterCatalogCategory>();

	//Which half of each `x` / `not-x` pair the catalog row is currently
	//offering, for the pairs the user has flipped. One row stands for the whole
	//pair; this is the only state the affordance needs.
	@state()
		_catalogPolarity : CollectionFilterCatalogPolarity = {};

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

	@state()
		_selectedClauseIndex = -1;

	@state()
		_draftReceiptMessage = '';

	@state()
		_clauseSelectionMessage = '';

	//The order the suggestion list was last ranked in, keyed by the identity of
	//the rows it ranked. Deliberately not @state: it is a memo of a render, not
	//an input to one.
	_suggestionOrder : {key : string, order : string[]} | null = null;

	_draftUndoDescription : CollectionDescription | null = null;
	_draftUndoSelectedCard : string | null = null;
	_cancelPreviews : (() => void) | null = null;
	readonly _draftPreviewID = 'current-draft-preview';

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
			/* The composer is a full workspace, not a confirm box. The base
			   .content sizes to its content, and the flex-basis-0 lists below
			   contribute no intrinsic height — so a content-sized dialog gave
			   the catalog only its min-height (128px in a 720px viewport).
			   Pinning the dialog to its maximum height gives the suggestion
			   list and catalog real space to flex into, and keeps the dialog
			   from resizing as the lists change under typing.

			   THE WIDTH IS PINNED FOR THE SAME REASON THE HEIGHT IS, and it is
			   the half that was missing. .content sizes to content
			   horizontally between min-width:40% and max-width:70%, so the
			   dialog's content box was measured at 512px, 896px and 567px on
			   three consecutive keystrokes of one session — and because
			   .background centres it, every change moved the dialog's left
			   edge too. The suggestion list changing under typing must not be
			   able to move the input the user is typing into.

			   All three of width/min-width/max-width take the SAME value, so
			   the base rule's percentages cannot re-enter and make the box
			   content-sized again. 64em is chosen to fit the widest designed
			   row — a 14em count column, a 5.5em action column, their gaps and
			   the dialog's own padding still leave the label column ~39em,
			   which is more than the longest filter label needs. 92vw is the
			   same box on a viewport too narrow for 64em; it is a viewport
			   unit, so it changes only when the window does. */
			.content {
				--composer-width: min(64em, 92vw);
				height: 90%;
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

			.expression {
				align-items: center;
				color: var(--app-dark-text-color);
				display: flex;
				flex-wrap: wrap;
				font-size: 1.05em;
				gap: 0.3em;
				line-height: 1.55;
				overflow-wrap: anywhere;
				padding: 0.75em 0;
			}

			/* THE EMPHASIS WAS UPSIDE DOWN.
			   The set name is the one term in this sentence that is NOT
			   interactive — it is a plain span, changed from the catalog's
			   "Start From" control — and it was bold purple 700, the loudest
			   token in the dialog, while every editable clause sat in a quiet
			   grey box beside it. Purple is the brand/link/committing colour
			   (§4.5), so painting a non-control with it promises a click that
			   does not exist.
			   It now reads at the sentence's own weight and colour, and the
			   presence goes to the clauses, which are what the user can act on.
			   The operators stay subordinate below both. */
			.expression-set {
				color: var(--app-dark-text-color);
				font-weight: 400;
			}

			.expression-operator,
			.expression-modifiers {
				color: var(--app-dark-text-color-light);
				font-size: 0.8em;
			}

			/* One operator plus the clause it introduces, as one unwrappable
			   unit. inline-flex rather than white-space:nowrap so the CHIP may
			   still wrap its own label internally. */
			.expression-term {
				align-items: center;
				display: inline-flex;
				gap: 0.3em;
				max-width: 100%;
				min-width: 0;
			}

			/* HelpStyles sizes the badge at 1.3em of whatever it sits in, which
			   suits a 0.75em form label. The expression row runs at 1.05em,
			   where that would make the badge the largest glyph in the dialog. */
			.expression .help svg {
				height: 1em;
				width: 1em;
			}

			/* A TOKEN IN A SENTENCE, NOT A CELL IN A TABLE.
			   The chip was a white box with a 1px divider around it and a
			   SECOND 1px divider down its middle, splitting label from remove —
			   which is exactly the anatomy of a two-column table cell, and it
			   read as one. Square corners stay (§4.4: a clause is a core
			   surface, not a pill); what changes is that the outer rule becomes
			   the subtle primary wash the spec asks for ("focused/editable
			   clauses receive a clear outline or subtle primary wash using
			   existing theme colors"), and the internal rule is gone. The wash
			   is also what gives the clauses the presence the set name just gave
			   up. */
			.expression-clause {
				align-items: stretch;
				background: var(--app-primary-color-light-very-transparent);
				border: 1px solid var(--app-divider-color);
				display: inline-flex;
				min-width: 0;
			}

			.expression-clause[data-selected] {
				border-color: var(--app-primary-color);
				box-shadow: 0 0 0 1px var(--app-primary-color);
			}

			.expression-clause button {
				background: transparent;
				box-shadow: none;
				color: var(--app-dark-text-color);
				margin: 0;
				min-height: 44px;
			}

			.expression-clause button:hover,
			.expression-clause button:focus-visible {
				background: var(--app-primary-color-light-transparent);
				box-shadow: none;
			}

			.expression-clause-label {
				max-width: 18em;
				overflow-wrap: anywhere;
				padding: 0.35em 0.6em;
				text-align: left;
			}

			.expression-clause-remove {
				align-items: center;
				display: inline-flex;
				justify-content: center;
				min-width: 44px;
				padding: 0.35em;
			}

			/* QUIET UNTIL HOVER OR FOCUS. The spec asks for destructive removal
			   to stay visually quiet until focused, and §3.7 keeps the warning
			   colour for Tier 1 acts — removing a draft clause is Tier 2 and
			   loses nothing, so the escalation is from subordinate grey to body
			   grey, not to red. It is never invisible: hover-only affordances
			   are unreachable on touch (§3.6.4). */
			.expression-clause-remove svg {
				fill: var(--app-dark-text-color-light);
				height: 1em;
				width: 1em;
			}

			.expression-clause-remove:hover svg,
			.expression-clause-remove:focus-visible svg {
				fill: var(--app-dark-text-color);
			}

			/* THE INPUT CONTINUES THE SENTENCE; IT IS NOT A SECOND FIELD.
			   A 14em flex-basis is the width the flex algorithm uses to decide
			   whether this item fits on the current line, so with a couple of
			   chips on a narrow-ish dialog the input jumped to a line of its
			   own and then grew to fill it — two stacked underlined boxes, which
			   is a form, not a sentence. 8em is a real minimum typing width and
			   is what the line-breaking test now uses, so the input wraps only
			   when there is genuinely no room left beside the last chip. */
			.composer-input {
				border: 0;
				border-bottom: 1px solid var(--app-dark-text-color);
				box-sizing: border-box;
				flex: 1 1 8em;
				font: inherit;
				min-width: 8em;
				padding: 0.6em 0.2em;
				width: auto;
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

			/* The list takes the height the dialog body has left rather than a
			   fixed fraction of the viewport: at 800x450 the old
			   min(42vh, 26em) showed two of twelve rows while the dialog had
			   room for far more. flex-basis 0 plus min-height keeps it from
			   collapsing when a long draft expression pushes it down. */
			.suggestions {
				flex: 1 1 0;
				list-style: none;
				margin: 0.25em 0 0;
				min-height: 7em;
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
			.suggestions,
			.catalog-list {
				--composer-edge-fade: 1.5em;
				mask-image: linear-gradient(to bottom,
					currentColor calc(100% - var(--composer-edge-fade)),
					transparent 100%);
				scroll-padding-block: 2.2em var(--composer-edge-fade);
			}

			/* ONE GRID FOR EVERY ROW IN THE DIALOG.
			   The three lists that use .suggestion — the composer's
			   suggestions, the source completions and the filter catalog —
			   all used content-sized auto tracks, and a CSS grid is scoped
			   to its own container, so every row measured its own columns.
			   The live review measured adjacent count columns starting at
			   634px and 739px, and ADD / REPLACE chips landing at a different
			   x on every line. Fixed tracks below are what make a column a
			   column. */
			.suggestion {
				align-items: start;
				border-top: 1px solid var(--app-divider-color);
				display: grid;
				grid-template-columns: minmax(0, 1fr) auto;
				margin: 0;
			}

			/* Only some catalog rows offer a polarity toggle, so an auto
			   second track made the ROW's own width — and therefore every
			   column inside it — depend on whether this particular filter has
			   an opposite. Reserved on every catalog row instead: 3.25em is
			   §4.2's 44px floor plus the room the uppercase word needs. */
			.catalog-list .suggestion {
				grid-template-columns: minmax(0, 1fr) 3.25em;
			}

			/* The count column is FIXED, not auto, and it is fixed even while
			   the counts are still being computed — that is what stops the
			   whole row re-flowing when a number lands 150ms after the row
			   does. 14em holds the longest thing this cell can say ('9,999
			   cards · same number of cards') without wrapping; the action
			   column holds the longest chip ('CONFIGURE'). */
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
				grid-template-columns: minmax(0, 1fr) 14em 5.5em;
				grid-template-areas:
					'category category category'
					'label    count    action'
					'detail   detail   detail'
					'example  example  example'
					'applied  applied  applied';
				margin: 0;
				padding: 0.65em 0.5em;
				padding-left: calc(0.5em - 3px);
				text-align: left;
				width: 100%;
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
			:host([data-pointer-armed]) .suggestion button:hover {
				background: var(--app-primary-color-light-very-transparent);
				box-shadow: none;
			}

			/* Categorically stronger than a hover tint: the fill, the bar, and
			   the row's action chip filled rather than outlined. */
			.suggestion button[data-highlighted] {
				background: var(--app-primary-color-light-very-transparent);
				border-left-color: var(--app-primary-color);
				box-shadow: none;
			}

			.suggestion button[data-highlighted] .suggestion-action {
				background: var(--app-primary-color);
				color: var(--app-light-text-color);
			}

			.suggestion-label {
				grid-area: label;
				min-width: 0;
				overflow-wrap: anywhere;
			}

			.suggestion-detail,
			.key-hints,
			.no-suggestions {
				color: var(--app-dark-text-color-light);
				font-size: 0.78em;
				margin-top: 0.2em;
				overflow-wrap: anywhere;
			}

			.suggestion-detail {
				grid-area: detail;
			}

			/* Was float:right inside the wrapping detail block, so on a 375px
			   screen the count ran straight through the detail text. Its own
			   grid area cannot overlap anything.
			   RIGHT-ALIGNED, so the numbers line up with each other rather
			   than with the variable-length words that follow them. */
			.suggestion-count {
				color: var(--app-dark-text-color-light);
				font-size: 0.82em;
				grid-area: count;
				text-align: right;
				white-space: nowrap;
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
			   row it modifies. Colour, margin and height come from .verb.
			   Its label is the word "Not", which §2.1 wants in sentence case
			   like every other button label — so the caps and the spacing that
			   was opening them up are both gone. */
			.catalog-polarity {
				align-self: center;
				font-size: 0.75em;
				min-width: 44px;
			}

			/* THE ON STATE HAS TO PAINT. aria-pressed=true and aria-pressed=
			   false rendered identical pixels: ButtonSharedStyles gives a
			   toggle its on state through button.selected, and button.small's
			   transparent background has the same specificity and comes after
			   it, so the shared rule never reached the screen.
			   Restated here at a specificity the local rules cannot shadow,
			   with §4.5's teal, which is what a toggle that is on means.
			   The text darkens with it: the purple .verb sets is unreadable on
			   teal, --app-dark-text-color-darker is 4.8:1. The selector carries
			   the element too, because button.small.verb would otherwise
			   out-specify the colour the same way button.small out-specified
			   the background. */
			button.catalog-polarity.selected {
				background: var(--app-secondary-color-light);
				color: var(--app-dark-text-color-darker);
			}

			/* The key-hints line sits below the list and outside it, so the
			   list's last row was clipped underneath it on a narrow screen. */
			.mobile .suggestions {
				padding-bottom: 2.75em;
			}

			/* Same discipline, a narrower column: 14em of a 375px screen would
			   leave the label nothing. The count is allowed to wrap here
			   instead of being cut off, since it no longer shares its row with
			   anything but the label. */
			.mobile .suggestion-count {
				white-space: normal;
			}

			/* READING ORDER: WHAT IT IS, WHAT IT COSTS, WHAT IT DOES, WHY.
			   The verb had a full-width row of its own between the label and the
			   description, so a mobile row read "Add Starred / 18 cards / ADD /
			   Adds Starred to this collection" — the consequence interrupting
			   the thing it is a consequence of. The label now spans two rows so
			   the count and the verb can stack in the same right-hand column,
			   which puts the verb directly under the number it applies to and
			   leaves the description last and unbroken. Both areas stay
			   rectangular, which is what lets one track serve two rows. */
			.mobile .suggestion button {
				grid-template-columns: minmax(0, 1fr) 9em;
				grid-template-areas:
					'category category'
					'label    count'
					'label    action'
					'detail   detail'
					'example  example'
					'applied  applied';
			}

			/* Right-aligned under the right-aligned count, so the two elements
			   of the same column share an edge. */
			.mobile .suggestion-action {
				justify-self: end;
			}

			.builder-toggle {
				border-top: 1px solid var(--app-divider-color);
				margin-top: 0.75em;
				padding-top: 0.5em;
			}

			/* Only the padding differs from .verb here: this row's two toggles sit
			   flush against its rule, not inset from it. */
			.builder-toggle button.verb {
				padding: 0.35em 0;
			}

			.builder {
				display: flex;
				flex-direction: column;
				margin-top: 0.5em;
				min-height: 0;
			}

			/* The catalog's own scroller is nested two levels below the dialog
			   body, so the intervening wrapper has to pass the available height
			   down instead of shrink-wrapping its content. hidden, not visible:
			   a flex item that has been shrunk still PAINTS its overflow, and
			   an unclipped one hit-tests over whatever the footer draws. */
			.builder-catalog {
				flex: 1 1 0;
				overflow: hidden;
			}

			/* THE CLAUSE EDITOR IS A BOUNDED PANE, NOT LOOSE CONTENT.
			   Live review: with a date-range clause plus two more, the
			   262px 'Editing Updated between…' panel ran past the bottom of a
			   720px dialog. It was a flex item with no bound and no clipping,
			   so it shrank to nothing in layout while still painting at full
			   height — and .composer-actions, laid out after it, hit-tested
			   ABOVE both date inputs. The fields were click-dead and 'Done
			   editing' and 'Remove filter' rendered where nothing paints.
			   Bounding this container (it takes .scroller, per the #759
			   convention for a deliberate inner pane) means the editor's own
			   content scrolls INSIDE the dialog body and can never reach the
			   footer's box, so every control in it is clickable at 720px. */
			.builder-clause {
				flex: 1 1 0;
				min-height: 6em;
				overscroll-behavior: contain;
			}

			.catalog-setup,
			.pending-filter-editor,
			.clause-editor {
				background: var(--app-primary-color-light-very-transparent);
				border: 1px solid var(--app-divider-color);
				margin: 0.5em 0;
				padding: 0.65em;
			}

			.catalog-setup {
				display: flex;
				flex-wrap: wrap;
				gap: 0.65em 1em;
			}

			.catalog-setup label {
				display: flex;
				flex-direction: column;
				font-size: 0.78em;
				gap: 0.25em;
			}

			/* Same reason as .suggestions: at 800x450 the fixed max-height
			   showed six of forty-seven filters inside a dialog with room to
			   spare. */
			.catalog-list {
				flex: 1 1 0;
				min-height: 8em;
			}

			.catalog-item-applied {
				color: var(--app-primary-color);
				font-size: 0.75em;
				grid-area: applied;
			}

			/* Subordinate, not "live" (§4.5): teal means a thing exists or is on,
			   and an example line is neither — it is the smallest supporting
			   detail on the row, which is what --app-dark-text-color-light is
			   for. */
			.catalog-example {
				color: var(--app-dark-text-color-light);
				font-size: 0.78em;
				grid-area: example;
				margin-top: 0.15em;
			}

			/* Both of the composer's button rows ARE the dialog contract's row —
			   bottom-right, primary last (§3.3) — so they take .buttons from
			   DialogElement rather than restating its three properties. What is
			   left here is only what genuinely differs: this one sits inside a
			   nested editor and needs the gap and the rule of space above it. */
			.buttons.pending-filter-actions {
				align-items: center;
				gap: 0.5em;
				margin-top: 0.5em;
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
				.pending-filter-editor {
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

	_sourceRender() {
		const parsed = this._parsedSource;
		const shown = parsed.status === 'valid' ? parsed : this._lastValidSource;
		const description = shown?.description || this._collectionDescription;
		const count = this._previewCounts[this._draftPreviewID];
		//ONE HONEST HEADER PER STATE CLASS (HS-2.4).
		//
		//'Not supported here' and 'Can’t understand this source' were two headers
		//for one class — the source cannot be opened — and each was wrong about
		//half of it. The app understands `foo` perfectly well and simply has no
		//such filter, so "can't understand" is false; a malformed date is
		//understood and rejected, so "not supported" is false. The header now
		//states the one fact both share, and the diagnostic underneath says which
		//it was, which is the division of labour §2.4 asks for. The
		//incomplete/keep-typing state stays distinct, because nothing is wrong
		//there yet.
		const statusLabel = parsed.status === 'valid' ? 'Ready to open' :
			parsed.status === 'incomplete' ? 'Keep typing' : 'Can’t open this source';
		const diagnostic = parsed.diagnostics[0]?.message || 'This source is complete and safe to open.';
		const completionDiagnostic = parsed.diagnostics.find(item => item.expected?.length);
		const completionMode = completionDiagnostic ? 'complete' : 'add';
		const completionDetails = completionDiagnostic?.expectedDetails || parsed.nextExpectedDetails || {};
		//Which production the completions belong to. Only the parser knows, and
		//without it every completion fell through to 'filter'.
		const completionKind : CollectionSourceExpectedKind = completionDiagnostic?.expectedKind || parsed.nextExpectedKind || 'root';
		const completions = this._sourceCompletionsDismissed ? [] : (completionDiagnostic?.expected || parsed.nextExpected || []);
		const expressionParts = collectionExpressionParts(description, this._composerFilterLabels);
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
			<div class='source-steps' role='group' aria-label=${readableCollectionExpression(description, this._composerFilterLabels)}>
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

	_selectedClauseEditorRender() {
		const index = this._selectedClauseIndex;
		const filterName = this._collectionDescription.filters[index];
		if (index < 0 || !filterName) return '';
		return html`
			<div class='clause-editor'>
				<div>
					<strong>Editing ${this._readableComposerFilter(filterName)}</strong>
					<div class='suggestion-detail'>Changes update the draft immediately. You can undo them before opening.</div>
				</div>
				<configure-collection-filter
					.value=${filterName}
					.index=${index}
					.mobile=${this.mobile}
					.lockFilterFamily=${true}
					.filterDescriptions=${this._filterDescriptions}
					.cardTagInfos=${this._cardTagInfos}
					.userIDs=${this._userIDs}
					.userInfos=${this._userInfos}
					@filter-modified=${this._handleFilterModified}
					@filter-removed=${this._handleFilterRemoved}>
				</configure-collection-filter>
				<button class='small verb done-editing' @click=${this._handleBuilderToggle}>Done editing</button>
			</div>
		`;
	}

	get _catalogItems() : CollectionFilterCatalogItem[] {
		return catalogItemsFor(
			this._filterDescriptions || EMPTY_FILTER_DESCRIPTIONS,
			this._contextualComposerCandidates,
			this._collectionDescription || EMPTY_COLLECTION_DESCRIPTION,
			this._composerInput,
			this._catalogPolarity
		);
	}

	get _visibleCatalogItems() : CollectionFilterCatalogItem[] {
		const items = this._catalogItems;
		if (this._composerInput.trim()) return items;
		return collectionFilterCatalogCategories.flatMap(category => {
			const categoryItems = items.filter(item => item.category === category);
			return this._expandedCatalogCategories.has(category) ? categoryItems : categoryItems.slice(0, 6);
		});
	}

	_catalogRender() {
		const items = this._visibleCatalogItems;
		const allItems = this._catalogItems;
		return html`
			<div class='catalog-setup' role='group' aria-label='Collection setup'>
				<!-- Every <select> here has its options select themselves. A
				     .value binding on the <select> commits before the child
				     part that renders the <option>s, so it lands on an empty
				     select and is dropped, and the control ends up displaying
				     its first option while the draft says something else. -->
				<label>Start From
					<select aria-label='Starting collection set' @change=${this._handleSetSelectChanged}>
						${Object.entries(SET_INFOS).map(entry => html`<option value=${entry[0]} title=${entry[1].description} .selected=${live(entry[0] === this._collectionDescription.set)}>${collectionOptionDisplayName(entry[0])}</option>`)}
					</select>
				</label>
				<label>Order By
					<select aria-label='Card order' @change=${this._handleSortSelectChanged}>
						${Object.entries(SORTS).map(entry => html`<option value=${entry[0]} title=${entry[1].description} .selected=${live(entry[0] === this._collectionDescription.sort)}>${collectionOptionDisplayName(entry[0])}</option>`)}
					</select>
				</label>
				<label>Direction
					<select aria-label='Sort direction' @change=${this._handleCatalogDirectionChanged}>
						<option value='normal' .selected=${live(!this._collectionDescription.sortReversed)}>Normal</option>
						<option value='reverse' .selected=${live(this._collectionDescription.sortReversed)}>Reverse</option>
					</select>
				</label>
				<label>Display As
					<select aria-label='Collection view' @change=${this._handleViewModeChanged}>
						${Object.keys(LEGAL_VIEW_MODES).map(mode => html`<option value=${mode} .selected=${live(mode === this._collectionDescription.viewMode)}>${collectionOptionDisplayName(mode)}</option>`)}
					</select>
				</label>
				${LEGAL_VIEW_MODES[this._collectionDescription.viewMode] ? html`
					<label>Web Focus Card
						<configure-collection-key-card
							.value=${this._collectionDescription.viewModeExtra || '_'}
							.cardTagInfos=${this._cardTagInfos}
							.allowIncludeKeyCard=${false}
							@filter-modified-complex=${this._handleViewCardChanged}>
						</configure-collection-key-card>
					</label>
				` : ''}
			</div>
			${this._pendingCatalogFilter ? this._pendingCatalogFilterRender() : ''}
			<div id='collection-filter-catalog' class='catalog-list scroller' role='listbox' aria-label='Filter catalog'>
				${collectionFilterCatalogCategories.map(category => {
		const categoryItems = items.filter(item => item.category === category);
		const shown = categoryItems;
		const total = allItems.filter(item => item.category === category).length;
		const expanded = this._expandedCatalogCategories.has(category);
		if (!shown.length) return '';
		return html`
						<div role='group' aria-label=${category}>
							<div class='suggestion-heading'>${category}</div>
							${shown.map(item => {
		const index = items.indexOf(item);
		return html`
									<div class='suggestion' role='presentation'>
										<button
											id=${`collection-filter-catalog-item-${index}`}
											role='option'
											data-filter=${item.filter}
											aria-selected=${index === this._catalogHighlightedIndex}
											?data-highlighted=${index === this._catalogHighlightedIndex}
											@mousemove=${() => this._handleRowPointerMove('catalog', index)}
											@mouseenter=${() => this._handleRowPointerEnter('catalog', index)}
											@click=${() => this._handleCatalogItem(item)}
										>
											<span class='suggestion-label'>${item.label}</span>
											${(() => {
		const verb = !item.guided || item.appliedIndex >= 0 ? 'edit' : item.configurable && !item.filter.includes('/') ? 'configure' : 'add';
		return html`<span class='suggestion-action' data-consequence=${rowConsequence(verb)}>${sentenceCase(verb)}</span>`;
	})()}
											<span class='suggestion-detail'>${item.detail}</span>
											<span class='catalog-example'>Example: ${item.example}</span>
											${item.appliedIndex >= 0 ? html`<span class='catalog-item-applied'>Already in this collection</span>` : ''}
										</button>
										${item.oppositeFilter ? html`
											<button
												class='small verb catalog-polarity ${item.negated ? 'selected' : ''}'
												data-polarity-key=${item.polarityKey}
												aria-pressed=${item.negated ? 'true' : 'false'}
												title=${`Use ${this._readableComposerFilter(item.oppositeFilter)} instead`}
												aria-label=${`Use ${this._readableComposerFilter(item.oppositeFilter)} instead of ${item.label}`}
												@click=${() => this._handleCatalogPolarityToggle(item)}
											>Not</button>
										` : ''}
									</div>
								`;
	})}
							${!this._composerInput.trim() && total > 6 ? html`
								<button
									class='small verb catalog-more'
									aria-label=${expanded ? `Show fewer filters in ${category.toLowerCase()}` : `Show ${total - shown.length} more filters in ${category.toLowerCase()}`}
									@click=${() => this._handleCatalogCategoryToggle(category)}
								>
									${expanded ? 'Show fewer' : `Show ${total - shown.length} more`}
								</button>
							` : ''}
						</div>
					`;
	})}
			</div>
			${!items.length ? html`<div class='no-suggestions'>No filters match yet. Try a broader word such as date, tag, author, relationship, or text.</div>` : ''}
		`;
	}

	_pendingCatalogFilterRender() {
		const family = this._pendingCatalogFilter.split('/')[0];
		return html`
			<div class='pending-filter-editor' role='group' aria-label=${`Configure ${this._readableComposerFilter(family)}`}>
				<div><strong>Configure ${this._readableComposerFilter(family)}</strong></div>
				<div class='suggestion-detail'>Choose the values below before this filter is added. The collection will not change until you confirm.</div>
				<!-- A reason a control is unavailable is VISIBLE text, not only a
				     title: hover is unreachable on touch (§3.6.4). The wrapper's
				     title below still explains it on hover for a mouse user. -->
				${this._pendingCatalogChanged ? '' : html`<div class='suggestion-detail'>Change a value to add this filter.</div>`}
				<configure-collection-filter
					.value=${this._pendingCatalogFilter}
					.index=${-1}
					.mobile=${this.mobile}
					.lockFilterFamily=${true}
					.allowRemove=${false}
					.filterDescriptions=${this._filterDescriptions}
					.cardTagInfos=${this._cardTagInfos}
					.userIDs=${this._userIDs}
					.userInfos=${this._userInfos}
					@filter-modified=${this._handlePendingCatalogFilterModified}
					@filter-removed=${this._cancelPendingCatalogFilter}>
				</configure-collection-filter>
				<div class='buttons pending-filter-actions'>
					<button class='small verb' @click=${this._cancelPendingCatalogFilter}>Cancel</button>
					<!-- The one committing action of this nested editor, so §3.3's
					     round primary glyph applies here too. PLUS_ICON is the
					     app's add glyph (§4.2 names it by hand): the same one
					     configure-collection-filter uses one level down for 'Add
					     an OR filter', and find-dialog for its round 'Create a
					     card'. The reason still lives on the wrapper, because the
					     button spends most of its life disabled. -->
					<span class='reason' title=${this._pendingCatalogChanged ? 'Add this filter to the draft' : 'Change a value first — adding this filter as it stands would not narrow anything'}>
						<button class='round primary' title='Add this filter to the draft' aria-label='Add this filter to the draft' ?disabled=${!this._pendingCatalogChanged} @click=${this._commitPendingCatalogFilter}>${PLUS_ICON}</button>
					</span>
				</div>
			</div>
		`;
	}

	_composerRender() {
		if (!this._collectionDescription) return html``;
		const suggestions = this._catalogOpen ? [] : this._composerSuggestions;
		const highlightedIndex = this._activeHighlightIndex(suggestions);
		const highlighted = suggestions[highlightedIndex];
		const expressionParts = collectionExpressionParts(this._collectionDescription, this._composerFilterLabels);
		const draftCount = this._previewCounts[this._draftPreviewID];
		const recentSuggestions = suggestions.filter(suggestion => suggestion.kind === 'recent');
		const refinementSuggestions = suggestions.filter(suggestion => suggestion.kind !== 'recent');
		return html`
			<div class='visually-hidden' aria-live='polite'>Draft: ${readableCollectionExpression(this._collectionDescription, this._composerFilterLabels)}</div>
			<div class='expression' role='group' aria-label='Draft collection clauses'>
				<span class='expression-set'>${expressionParts.set.label}</span>
				<!-- AN OPERATOR BELONGS TO THE CLAUSE IT INTRODUCES.
				     AND was a sibling of its chip in a wrapping flex row, so a
				     line whose next chip did not fit ended on a dangling "AND"
				     and the clause it announced started the line below. Bound
				     into one inline group, the pair can only wrap together. -->
				${expressionParts.filters.map(filter => html`
					<span class='expression-term'>
						<span class='expression-operator' aria-hidden='true'>AND</span>
						<span class='expression-clause' role='group' aria-label=${`${filter.label} filter`} ?data-selected=${filter.index === this._selectedClauseIndex}>
							<button
								class='expression-clause-label'
								aria-label=${`Edit ${filter.label} filter`}
								@click=${() => this._handleClauseEdit(filter.index)}
							>${filter.label}</button>
							<!-- CANCEL_ICON, not a literal ×. §4.2's MUST: never
							     render a text glyph where an icon exists. It is
							     quiet until hover or focus, per the spec's
							     "destructive removal remains visually quiet until
							     focused" — and it takes no warning colour, because
							     removing a draft clause loses nothing (§3.7 Tier 2). -->
							<button
								class='expression-clause-remove'
								aria-label=${`Remove ${filter.label} filter`}
								title=${`Remove ${filter.label} filter`}
								@click=${() => this._removeDraftClause(filter.index)}
							>${CANCEL_ICON}</button>
						</span>
					</span>
				`)}
				${expressionParts.modifiers.length ? html`<span class='expression-modifiers'>· ${expressionParts.modifiers.join(' · ')}</span>` : ''}
				<input
					class='composer-input'
					id='collection-composer-input'
					type='text'
					role='combobox'
					aria-label='Compose collection filters'
					aria-autocomplete='list'
					aria-controls=${ifDefined(this._catalogOpen ? 'collection-filter-catalog' : (suggestions.length ? 'collection-composer-suggestions' : undefined))}
					aria-expanded=${this._catalogOpen ? this._visibleCatalogItems.length > 0 : suggestions.length > 0}
					aria-activedescendant=${ifDefined(this._catalogOpen ?
		(this._visibleCatalogItems[this._catalogHighlightedIndex] ? `collection-filter-catalog-item-${this._catalogHighlightedIndex}` : undefined) :
		(highlighted ? `collection-suggestion-${highlightedIndex}` : undefined))}
					aria-busy=${this._activationPending}
					placeholder=${this._catalogOpen ? 'Search dates, tags, authors, relationships…' : 'Type another condition…'}
					.value=${this._composerInput}
					@input=${this._handleComposerInput}
					@keydown=${this._handleComposerKeyDown}
				>
				<!-- AFTER the expression, not in front of it. The badge was the
				     first element of the sentence, so the draft opened with a
				     help glyph and only then said what collection it was. It
				     defines the word "collection" (HS-1.3's MUST, debt item D1),
				     which is a footnote to the sentence, not its subject. -->
				${help(COLLECTION_HELP)}
			</div>
			<!-- Visible, not a title: hover is unreachable on touch (§3.6.4),
			     and a clause the user cannot edit is exactly the one that has to
			     explain itself. Empty for every ordinary clause. -->
			${expressionParts.filters.filter(filter => filter.explanation).map(filter => html`
				<div class='suggestion-detail unsupported-clause'>${filter.label}: ${filter.explanation}</div>
			`)}
			${this._draftReceiptMessage ? html`
				<div class='draft-receipt' role='status'>
					<span>${this._draftReceiptMessage}</span>
					${this._draftUndoDescription ? html`<button class='small verb' @click=${this._undoDraftEdit}>Undo</button>` : ''}
				</div>
			` : ''}
			${this._clauseSelectionMessage ? html`<div class='draft-receipt' role='status'>${this._clauseSelectionMessage}</div>` : ''}
			${this._activationPending || this._activationMessage ? html`
				<!-- role='alert' already announces immediately; the explicit
				     assertive was a second, louder copy of the same instruction.
				     §3.6.4 reserves assertive for work at RISK — the unsaved-draft
				     banner is the bar, and "finish your edit first" is not it. -->
				<div class='activation-message' ?data-problem=${Boolean(this._activationMessage)} role=${this._activationMessage ? 'alert' : 'status'} aria-live=${ifDefined(this._activationMessage ? undefined : 'polite')}>
					${this._activationMessage || 'Opening collection…'}
				</div>
			` : ''}
			${this._catalogOpen ? '' : suggestions.length ? html`
				<div class='suggestions scroller' id='collection-composer-suggestions' role='listbox'>
					${recentSuggestions.length ? html`
						<div role='group' aria-labelledby='recent-suggestion-heading'>
							<div class='suggestion-heading' id='recent-suggestion-heading'>Continue</div>
							${recentSuggestions.map(suggestion => this._suggestionRow(suggestion, suggestions.indexOf(suggestion), highlightedIndex))}
						</div>
					` : ''}
					${refinementSuggestions.length ? html`
						<div role='group' aria-labelledby='refinement-suggestion-heading'>
							<div class='suggestion-heading' id='refinement-suggestion-heading'>${this._composerInput ? 'Interpretations' : 'Refine this collection'}</div>
							${refinementSuggestions.map(suggestion => this._suggestionRow(suggestion, suggestions.indexOf(suggestion), highlightedIndex))}
						</div>
					` : ''}
				</div>
			` : html`
				<div class='suggestion-heading'>${this._composerInput ? 'Interpretations' : 'Refine this collection'}</div>
				<div class='no-suggestions'>No complete interpretation yet. Keep typing or browse all filters.</div>
			`}
			<div class='key-hints'>${this._composerKeyHints(suggestions, highlighted)}</div>
			${this._modifierNoteRender()}
			<div class='builder-toggle mode-actions'>
				<button class='small verb' @click=${this._handleCatalogToggle}>${this._catalogOpen ? 'Hide filter catalog' : 'Browse all filters'}</button>
				<button class='small verb' @click=${this._handleEditSource}>Edit source</button>
			</div>
			${this._catalogOpen ? html`<div class='builder builder-catalog'>${this._catalogRender()}</div>` : ''}
			${this._builderExpanded ? html`<div class='builder builder-clause scroller'>${this._selectedClauseEditorRender()}</div>` : ''}
			${this._openActionRender(
		draftCount,
		this._activationPending,
		this._activationPending ? 'Already opening this collection' : 'Open this collection',
		this._handleOpenCurrentDraft,
		Boolean(highlighted)
	)}
		`;
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
	//The branches are ordered the way _applyComposerSuggestion and the row's
	//own visible chip already order them — source, then configure, then the
	//plain action — so the footer cannot promise a verb the click would not
	//perform.
	//
	//AND A TOUCH LAYOUT HAS NO KEYBOARD TO STATE A CONTRACT FOR. On a phone this
	//line named ↑↓, Tab, Click and Escape — four inputs the device does not
	//have — which is the same defect as the wrong verb, one level up: a footer
	//that describes controls the user cannot reach. Each row now carries its own
	//visible verb chip (Open / Add / Remove / Replace / Configure / Edit), so the
	//touch line points at the affordance that IS there rather than restating a
	//keyboard grammar. It makes no per-row claim, for the same reason the
	//nothing-highlighted desktop branch makes none.
	_composerKeyHints(suggestions : CollectionComposerSuggestion[], highlighted : CollectionComposerSuggestion | undefined) : string {
		const escapeHint = `${shortcutKeys('dialog-escape')} cancels`;
		if (this.mobile) {
			if (this._catalogOpen) return 'Tap a filter to add or configure it';
			if (this._selectedClauseIndex >= 0) return 'Tap a clause to edit it · tap its remove button to take it out';
			return suggestions.length ?
				'Tap a row to use it — each says what it does · tap the open button for this collection' :
				'Type to compose · tap the open button for this collection';
		}
		if (this._catalogOpen) return `Type to search · ↑↓ choose · Enter opens Source, configures, or adds · ${shortcutKeys('dialog-escape')} closes catalog`;
		if (this._selectedClauseIndex >= 0) return '←→ choose clause · Delete removes · type to continue';
		if (!highlighted) {
			return suggestions.length ?
				`↑↓ or Tab choose · Enter opens this collection · ${escapeHint}` :
				`Type to compose · Enter opens this collection · ${escapeHint}`;
		}
		if (highlighted.sourceFilter) return '↑↓ choose · Click, Tab, or Enter opens Source';
		if (highlighted.configureFilter) return '↑↓ choose · Click, Tab, or Enter configures';
		//A destination: clicking it and Enter do the same thing, and Tab is the
		//spec's labeled secondary action.
		if (highlighted.action === 'open') return '↑↓ choose · Click or Enter opens · Tab copies it into the draft';
		//A transformation, named by what it does to the draft rather than by
		//one word for both halves of the pair.
		const verb = highlighted.action === 'replace' ? 'replaces' : 'adds';
		return `↑↓ choose · Click or Tab ${verb} · Enter ${verb} and opens`;
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

	_suggestionRow(suggestion : CollectionComposerSuggestion, index : number, highlightedIndex : number) {
		const count = this._previewCounts[suggestion.id];
		const draftCount = this._previewCounts[this._draftPreviewID];
		const countDescription = count === undefined ? '' : `${formatCollectionCardCount(count)}${draftCount === undefined ? '' : ` · ${formatCollectionCountDelta(count, draftCount)}`}`;
		const visibleAction = suggestion.sourceFilter ? 'edit' : suggestion.configureFilter ? (suggestion.action === 'replace' ? 'edit' : 'configure') : suggestion.action;
		return html`
						<div class='suggestion' role='presentation'>
							<button
								id='collection-suggestion-${index}'
								role='option'
								tabindex='-1'
								aria-selected=${index === highlightedIndex}
								aria-label=${`${suggestion.label}. ${suggestion.detail}${countDescription ? `. ${countDescription}` : ''}`}
								data-index=${index}
								?disabled=${this._activationPending}
								?data-highlighted=${index === highlightedIndex}
								@mousemove=${() => this._handleRowPointerMove('suggestion', index)}
								@mouseenter=${() => this._handleRowPointerEnter('suggestion', index)}
								@click=${() => this._applyComposerSuggestion(suggestion, suggestion.action === 'open')}
							>
								<span class='suggestion-label'>${suggestion.label}</span>
								<span class='suggestion-action' data-consequence=${rowConsequence(visibleAction)}>${sentenceCase(visibleAction)}</span>
								${countDescription ? html`<span class='suggestion-count'>${countDescription}</span>` : ''}
								<span class='suggestion-detail'>${suggestion.detail}</span>
							</button>
						</div>
		`;
	}

	//The index of the visibly highlighted suggestion, or -1 when nothing is
	//highlighted. Everything that reads the highlight — the rendered marker,
	//aria-activedescendant, the key hints, and the keydown handlers — goes
	//through here, so "the transformation accepted on keydown is the one
	//visibly highlighted on keydown" is a structural property rather than a
	//coincidence.
	_activeHighlightIndex(suggestions : CollectionComposerSuggestion[]) : number {
		if (!this._suggestionHighlightActive) return -1;
		if (!suggestions.length) return -1;
		return Math.min(this._highlightedSuggestion, suggestions.length - 1);
	}

	//ALL THREE LISTS FOLLOW ONE POINTER RULE, so none of them can end up with a
	//hover fill on one row and a keyboard highlight on another. The suggestion
	//list had this already; the catalog and the source completions did not, and
	//they are painted by the same .suggestion rules.
	_highlightListRowFromPointer(list : ComposerRowList, index : number) {
		if (list === 'suggestion') {
			this._highlightedSuggestion = index;
			this._suggestionHighlightActive = true;
			return;
		}
		if (list === 'catalog') {
			this._catalogHighlightedIndex = index;
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

	get _composerSuggestions() : CollectionComposerSuggestion[] {
		if (!this._collectionDescription) return [];
		const remembered = readRememberedCollections(this._userScope, this._knownFilterNames);
		const activeCanonical = this._activeCollectionDescription?.serialize();
		//The first two remembered entries are in raw visit order, so the first
		//of them that is not the collection on screen is genuinely the one
		//visited before it. That is the only thing that earns the words "Back
		//to"; anything further back is a destination, not a direction.
		const previousCollection = remembered.slice(0, 2).find(entry => entry.canonical !== activeCanonical)?.canonical;
		const suggestions = composerSuggestionsFor(
			this._collectionDescription,
			this._composerInput,
			this._filterDescriptions || EMPTY_FILTER_DESCRIPTIONS,
			this._cardsSelected,
			recentCollectionsFor(remembered),
			this._activeCollectionDescription || undefined,
			previousCollection,
			this._draftSelectedCard,
			this._contextualComposerCandidates
		);
		//Count-aware ranking, without the list moving under the user's hands.
		//The identity of the row set is the "was this list rebuilt?" test: a
		//new input or draft produces different rows, and only then may counts
		//reorder them. While a row is highlighted the order is frozen outright,
		//so the transformation accepted on keydown is the one that was visible.
		const key = suggestions.map(suggestion => suggestion.id).join('\n');
		const memo = this._suggestionOrder;
		if (memo && memo.key === key && this._suggestionHighlightActive) {
			return frozenOrderSuggestions(suggestions, memo.order);
		}
		const ranked = rankedSuggestionsFor(suggestions, this._previewCounts);
		const order = ranked.map(suggestion => suggestion.id);
		//Only when the order actually moved: reassigning an identical memo would
		//hand the frozen-order path a new array every render and defeat its
		//cache, which is the whole reason the list is stable to begin with.
		if (!memo || memo.key !== key || memo.order.length !== order.length || memo.order.some((id, index) => id !== order[index])) {
			this._suggestionOrder = {key, order};
		}
		return ranked;
	}

	get _contextualComposerCandidates() : CollectionComposerCandidate[] {
		return composerCandidatesFor(this._activeCard, this._composerCandidates, this._activeCardID);
	}

	get _composerFilterLabels() : Record<string, string> {
		return composerFilterLabelsFor(this._contextualComposerCandidates);
	}

	_readableComposerFilter(filter : string) : string {
		return collectionFilterDisplayName(filter, this._composerFilterLabels);
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
	//card-view's copy button on the same collection already says exactly these
	//two sentences this way; two spellings of one outcome is how sync-copy's
	//eight sentences happened.
	async _handleCopySourceLink() {
		const path = this._parsedSource.canonicalPath;
		if (!path) return;
		try {
			await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
			store.dispatch(showSnackbar('Collection link copied.'));
		} catch {
			store.dispatch(showSnackbar('Could not copy the collection link.', {kind: 'refused'}));
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
			readableCollectionExpression(arrived, this._composerFilterLabels),
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
		this._selectedClauseIndex = -1;
		this._clauseSelectionMessage = '';
		this._highlightedSuggestion = 0;
		//Typed text makes the list interpretations of what was typed, so the
		//top interpretation is the highlighted one and Enter opens it. Emptying
		//the input returns the list to destinations nobody has pointed at, and
		//Enter goes back to meaning "open the draft".
		this._suggestionHighlightActive = Boolean(input.value.trim());
		this._pointerHighlightArmed = false;
		this._catalogHighlightedIndex = 0;
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
		if (this._catalogOpen) {
			const items = this._visibleCatalogItems;
			if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length) {
				e.preventDefault();
				e.stopPropagation();
				const direction = e.key === 'ArrowDown' ? 1 : -1;
				this._catalogHighlightedIndex = (this._catalogHighlightedIndex + direction + items.length) % items.length;
				return;
			}
			if (e.key === 'Enter' && items[this._catalogHighlightedIndex]) {
				e.preventDefault();
				e.stopPropagation();
				committedKeystrokes.add(e);
				this._handleCatalogItem(items[this._catalogHighlightedIndex]);
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				this._handleCatalogToggle();
				return;
			}
		}
		//Match what the composer actually shows: with the catalog open the
		//suggestion list is hidden, so no suggestion can be the visibly
		//highlighted one that Tab or Enter accepts.
		const suggestions = this._catalogOpen ? [] : this._composerSuggestions;
		if (!this._composerInput && this._collectionDescription.filters.length) {
			if (e.key === 'Backspace') {
				e.preventDefault();
				e.stopPropagation();
				if (this._selectedClauseIndex < 0) {
					this._selectedClauseIndex = this._collectionDescription.filters.length - 1;
					this._clauseSelectionMessage = `${this._readableComposerFilter(this._collectionDescription.filters[this._selectedClauseIndex])} selected · Backspace again to remove`;
				} else {
					this._removeDraftClause(this._selectedClauseIndex);
				}
				return;
			}
			if (e.key === 'Delete' && this._selectedClauseIndex >= 0) {
				e.preventDefault();
				e.stopPropagation();
				this._removeDraftClause(this._selectedClauseIndex);
				return;
			}
			if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
				e.preventDefault();
				e.stopPropagation();
				if (e.key === 'ArrowLeft') {
					this._selectedClauseIndex = this._selectedClauseIndex < 0 ? this._collectionDescription.filters.length - 1 : Math.max(0, this._selectedClauseIndex - 1);
				} else {
					this._selectedClauseIndex = this._selectedClauseIndex < 0 ? 0 : this._selectedClauseIndex + 1;
					if (this._selectedClauseIndex >= this._collectionDescription.filters.length) this._selectedClauseIndex = -1;
				}
				this._clauseSelectionMessage = this._selectedClauseIndex < 0 ? '' : `${this._readableComposerFilter(this._collectionDescription.filters[this._selectedClauseIndex])} selected`;
				return;
			}
		}
		const highlightedIndex = this._activeHighlightIndex(suggestions);
		const highlighted = suggestions[highlightedIndex];
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			if (e.isComposing || e.keyCode === 229) return;
			if (!suggestions.length) return;
			e.preventDefault();
			e.stopPropagation();
			const direction = e.key === 'ArrowDown' ? 1 : -1;
			//Arrowing into a list with nothing highlighted lands on the first
			//(or last) row instead of skipping one.
			this._highlightedSuggestion = highlightedIndex < 0 ?
				(direction === 1 ? 0 : suggestions.length - 1) :
				(highlightedIndex + direction + suggestions.length) % suggestions.length;
			this._suggestionHighlightActive = true;
			return;
		}
		if (e.key === 'Tab' && !e.shiftKey && suggestions.length) {
			if (e.isComposing || e.keyCode === 229) return;
			e.preventDefault();
			e.stopPropagation();
			//Tab is how the keyboard reaches the list without typing first.
			//With nothing highlighted it highlights the first row — the list
			//becomes enterable — and with a row highlighted it materializes
			//that row into the draft. A destination materializes as its
			//expression rather than opening, which is the labeled secondary
			//action the spec allows for an Open row.
			if (!highlighted) {
				this._highlightedSuggestion = 0;
				this._suggestionHighlightActive = true;
				return;
			}
			this._applyComposerSuggestion(highlighted, false);
			return;
		}
		if (e.key === 'Enter' && !this._catalogOpen) {
			if (e.isComposing || e.keyCode === 229) return;
			e.preventDefault();
			e.stopPropagation();
			committedKeystrokes.add(e);
			//Spec: Enter opens the highlighted destination including its visible
			//preview, or the current draft when no suggestion is highlighted.
			if (highlighted) this._applyComposerSuggestion(highlighted, true);
			else this._handleOpenCurrentDraft();
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

	_applyComposerSuggestion(suggestion : CollectionComposerSuggestion, open : boolean) {
		if (suggestion.sourceFilter) {
			this._openSource(suggestion.action === 'replace' ? '' : suggestion.sourceFilter);
			return;
		}
		if (suggestion.configureFilter) {
			void this._configureFilterFamily(suggestion.configureFilter);
			return;
		}
		if (open) {
			if (this._activationPending) return;
			const isDraft = suggestion.id === CURRENT_DRAFT_SUGGESTION_ID;
			//A suggestion carrying its own destination path can still be a real
			//navigation (a different selected card, say), so only the draft —
			//whose selected card is checkable here — gets the semantic
			//comparison when a path is present.
			const alreadyActive = (isDraft || !suggestion.destinationPath) &&
				this._destinationIsActiveCollection(suggestion.description, isDraft ? this._draftSelectedCard : null);
			if (alreadyActive) {
				//Spec: if the draft is equivalent to the active collection, Enter
				//simply closes the composer. Choosing a *destination* that is
				//already on screen is a different act: it navigates nowhere, so
				//say so rather than closing with no explanation, which would look
				//to the user like their draft evaporated. Recents no longer offer
				//the active collection at all, so that branch is a backstop.
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
				suggestion.destinationPath ||
				collectionURLPath(suggestion.description, {selectedCard: this._draftSelectedCard, originalOrder: true})
			);
			const result = store.dispatch(navigatePathToResult(destinationPath));
			if (result.status === 'blocked-editing') {
				this._activationPending = false;
				this._activationMessage = 'Finish or cancel the current card edit before opening this collection.';
				return;
			}
			if (result.status === 'unchanged') {
				this._activationPending = false;
				//Spec: if the draft is equivalent to the active collection,
				//Enter simply closes the composer without a duplicate history
				//entry. A chosen suggestion that turns out to resolve to the
				//route already on screen instead says so.
				if (suggestion.id === CURRENT_DRAFT_SUGGESTION_ID) {
					store.dispatch(cancelConfigureCollectionDialog());
					return;
				}
				this._activationMessage = ALREADY_ACTIVE_MESSAGE;
				return;
			}
			store.dispatch(cancelConfigureCollectionDialog());
			this._showArrivalReceipt(returnPath, suggestion.description);
			return;
		}
		//A destination materialized by Tab is not "added"; the draft becomes it.
		//Everything else says what it did to the draft, derived from the same
		//canonical names the row used.
		this._commitDraftEdit(
			suggestion.description,
			suggestion.action === 'open' ? `Replaced the draft with ${suggestion.name}` : '',
			true
		);
		this._composerInput = '';
		this._highlightedSuggestion = 0;
	}

	_commitDraftEdit(description : CollectionDescription, message = '', focusInput = false, selectedCard = this._draftSelectedCard) {
		this._draftUndoDescription = this._collectionDescription;
		this._draftUndoSelectedCard = this._draftSelectedCard;
		this._draftSelectedCard = selectedCard;
		this._draftReceiptMessage = message || collectionDraftReceipt(this._collectionDescription, description, this._composerFilterLabels);
		this._selectedClauseIndex = -1;
		//The draft just changed, so the suggestion list is about to be rebuilt
		//around it. Nothing in the new list is what the user was pointing at,
		//so the next Enter commits the draft they just composed.
		this._suggestionHighlightActive = false;
		this._pointerHighlightArmed = false;
		this._clauseSelectionMessage = '';
		store.dispatch(updateCollectionConfigurationSnapshot(description));
		if (focusInput) this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
	}

	_removeDraftClause(index : number) {
		const filter = this._collectionDescription.filters[index];
		if (filter === undefined) return;
		//What the clause editor was editing, before the removal renumbers
		//everything after it. _commitDraftEdit clears the selection but leaves
		//the panel expanded, which used to render '' into a still-visible
		//.builder container -- an empty grey box where the editor had been.
		const editing = this._builderExpanded ? this._selectedClauseIndex : -1;
		this._commitDraftEdit(
			collectionDescriptionWithFilterRemoved(this._collectionDescription, index),
			'',
			true
		);
		if (editing < 0) return;
		if (editing === index) {
			//The clause being edited is the one that just went away, so there is
			//nothing left to edit. Collapse rather than show an empty panel.
			this._builderExpanded = false;
			this._clauseSelectionMessage = '';
			return;
		}
		//A different clause was removed; keep editing the same one, at whatever
		//index it now sits at.
		const next = editing > index ? editing - 1 : editing;
		const nextFilter = this._collectionDescription.filters[next];
		if (nextFilter === undefined) {
			this._builderExpanded = false;
			this._clauseSelectionMessage = '';
			return;
		}
		this._selectedClauseIndex = next;
		this._clauseSelectionMessage = `Editing ${this._readableComposerFilter(nextFilter)}`;
	}

	_undoDraftEdit() {
		if (!this._draftUndoDescription) return;
		const description = this._draftUndoDescription;
		const selectedCard = this._draftUndoSelectedCard;
		this._draftUndoDescription = null;
		this._draftUndoSelectedCard = null;
		if (selectedCard !== null) this._draftSelectedCard = selectedCard;
		this._draftReceiptMessage = 'Restored previous draft';
		this._selectedClauseIndex = -1;
		this._suggestionHighlightActive = false;
		this._pointerHighlightArmed = false;
		this._clauseSelectionMessage = '';
		store.dispatch(updateCollectionConfigurationSnapshot(description));
		this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
	}

	async _handleClauseEdit(index : number) {
		this._catalogOpen = false;
		this._pendingCatalogFilter = '';
		this._selectedClauseIndex = index;
		this._clauseSelectionMessage = `Editing ${this._readableComposerFilter(this._collectionDescription.filters[index])}`;
		this._builderExpanded = true;
		await this.updateComplete;
		const control = this.shadowRoot?.querySelector<HTMLElement & {focusPrimaryControl?: () => boolean}>('.clause-editor configure-collection-filter');
		if (!control?.focusPrimaryControl?.()) this.shadowRoot?.querySelector<HTMLElement>('.clause-editor .done-editing')?.focus();
	}

	_handleBuilderToggle() {
		this._builderExpanded = !this._builderExpanded;
		if (!this._builderExpanded) {
			this._selectedClauseIndex = -1;
			this._clauseSelectionMessage = '';
			this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
		}
	}

	_handleCatalogToggle() {
		this._catalogOpen = !this._catalogOpen;
		this._catalogHighlightedIndex = 0;
		this._pendingCatalogFilter = '';
		this._pendingCatalogChanged = false;
		if (this._catalogOpen) this._expandedCatalogCategories = new Set();
		if (this._catalogOpen) {
			this._builderExpanded = false;
			this._selectedClauseIndex = -1;
			this._clauseSelectionMessage = '';
		}
		this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
	}

	//One row per `x` / `not-x` pair: the toggle swaps which half the row offers
	//rather than adding anything, so the draft only changes when the row itself
	//is chosen.
	_handleCatalogPolarityToggle(item : CollectionFilterCatalogItem) {
		if (!item.oppositeFilter) return;
		this._catalogPolarity = {...this._catalogPolarity, [item.polarityKey]: item.oppositeFilter};
	}

	_handleCatalogCategoryToggle(category : CollectionFilterCatalogCategory) {
		const expanded = new Set(this._expandedCatalogCategories);
		if (expanded.has(category)) expanded.delete(category);
		else expanded.add(category);
		this._expandedCatalogCategories = expanded;
		this._catalogHighlightedIndex = 0;
	}

	_defaultCatalogFilter(family : string) : string {
		if (['created', 'updated', 'last-tweeted'].includes(family)) return `${family}/after/7-days-ago`;
		const info = CONFIGURABLE_FILTER_INFO[family];
		return info ? `${family}/${info.arguments.map(argument => argument.default).join('/')}` : family;
	}

	async _configureFilterFamily(family : string) {
		const appliedIndex = this._collectionDescription.filters.findIndex(filter => filter === family || filter.startsWith(`${family}/`));
		if (appliedIndex >= 0) {
			await this._handleClauseEdit(appliedIndex);
			return;
		}
		this._catalogOpen = true;
		this._builderExpanded = false;
		this._selectedClauseIndex = -1;
		this._clauseSelectionMessage = '';
		this._pendingCatalogFilter = this._defaultCatalogFilter(family);
		this._pendingCatalogChanged = this._catalogDefaultIsReady(family);
		this._composerInput = '';
		this._catalogHighlightedIndex = 0;
		this._expandedCatalogCategories = new Set();
		await this.updateComplete;
		this.shadowRoot?.querySelector<HTMLElement & {focusPrimaryControl?: () => void}>('.pending-filter-editor configure-collection-filter')?.focusPrimaryControl?.();
	}

	_catalogDefaultIsReady(family : string) : boolean {
		return ['created', 'updated', 'last-tweeted', 'author', 'limit', 'offset'].includes(family);
	}

	async _handleCatalogItem(item : CollectionFilterCatalogItem) {
		if (!item.guided) {
			this._openSource(item.appliedIndex >= 0 ? '' : item.filter.split('/')[0]);
			return;
		}
		if (item.appliedIndex >= 0) {
			this._catalogOpen = false;
			await this._handleClauseEdit(item.appliedIndex);
			return;
		}
		const family = item.filter.split('/')[0];
		if (item.configurable && item.filter === family) {
			await this._configureFilterFamily(family);
			return;
		}
		this._commitDraftEdit(collectionDescriptionWithFilterAppended(this._collectionDescription, item.filter));
		this._composerInput = '';
		this._catalogHighlightedIndex = 0;
		this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
	}

	_handlePendingCatalogFilterModified(e : FilterModifiedEvent) {
		this._pendingCatalogFilter = e.detail.value;
		this._pendingCatalogChanged = true;
	}

	_cancelPendingCatalogFilter() {
		this._pendingCatalogFilter = '';
		this._pendingCatalogChanged = false;
		this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
	}

	_commitPendingCatalogFilter() {
		if (!this._pendingCatalogFilter || !this._pendingCatalogChanged) return;
		const filter = this._pendingCatalogFilter;
		this._commitDraftEdit(collectionDescriptionWithFilterAppended(this._collectionDescription, filter));
		this._pendingCatalogFilter = '';
		this._pendingCatalogChanged = false;
		this._composerInput = '';
		this._catalogHighlightedIndex = 0;
		this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
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
		this._applyComposerSuggestion({
			id: CURRENT_DRAFT_SUGGESTION_ID,
			kind: 'source',
			action: 'open',
			name: readableCollectionExpression(this._collectionDescription, this._composerFilterLabels),
			label: 'Open this collection',
			detail: readableCollectionExpression(this._collectionDescription, this._composerFilterLabels),
			description: this._collectionDescription,
			destinationPath: collectionURLPath(this._collectionDescription, {selectedCard: this._draftSelectedCard, originalOrder: true}),
		}, true);
	}

	_handleModifyPath() {
		store.dispatch(askForPathToNavigateTo());
	}

	_handleFilterModified(e : FilterModifiedEvent) {
		this._commitDraftEdit(collectionDescriptionWithFilterModified(this._collectionDescription, e.detail.index, e.detail.value));
	}

	_handleFilterRemoved(e : FilterModifiedEvent) {
		this._removeDraftClause(e.detail.index);
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
					if (this._catalogOpen) {
						if (this._pendingCatalogFilter) this._cancelPendingCatalogFilter();
						else this._handleCatalogToggle();
						return true;
					}
					if (this._builderExpanded) {
						this._builderExpanded = false;
						this._selectedClauseIndex = -1;
						this._clauseSelectionMessage = '';
						this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
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
			store.dispatch(cancelConfigureCollectionDialog());
		} else {
			store.dispatch(closeConfigureCollectionDialog());
		}
	}

	override updated(changedProps : PropertyValues<this>) {
		super.updated(changedProps);
		//Mirrored onto the host so ONE rule can gate hover for all three lists,
		//rather than three containers each having to remember the attribute.
		//(The same idiom snack-bar uses for its mobile class, and for the same
		//reason: a property Lit does not reflect cannot be matched from CSS.)
		this.toggleAttribute('data-pointer-armed', this._pointerHighlightArmed);
		if ((changedProps.has('_highlightedSuggestion') || changedProps.has('_suggestionHighlightActive')) && this._suggestionHighlightActive) {
			this.shadowRoot?.querySelector(`#collection-suggestion-${this._highlightedSuggestion}`)?.scrollIntoView?.({block: 'nearest'});
		}
		if (changedProps.has('open')) {
			this._activationPending = false;
			this._activationMessage = '';
			if (this.open) {
				this._composerInput = '';
				this._highlightedSuggestion = 0;
				//Opening over a resting cursor must not decide what Enter does.
				this._suggestionHighlightActive = false;
				this._pointerHighlightArmed = false;
				this._builderExpanded = false;
				this._catalogOpen = false;
				this._catalogHighlightedIndex = 0;
				this._pendingCatalogFilter = '';
				this._pendingCatalogChanged = false;
				this._expandedCatalogCategories = new Set();
				this._catalogPolarity = {};
				//A fresh session gets fresh counts: corpus membership may have
				//changed since the last time this composer was open.
				this._retainedPreviewCounts.clear();
				this._selectedClauseIndex = -1;
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
			changedProps.has('_userScope')
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
		const previewSuggestions = this._entryMode === 'source' ? [] : this._composerSuggestions.filter(suggestion => !suggestion.configureFilter && !suggestion.sourceFilter);
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
