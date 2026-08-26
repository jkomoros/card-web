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
registerSnackbarAction(UNDO_COLLECTION_NAVIGATION_ACTION_ID, (dispatch, getState) => {
	const expectedLocation = pendingCollectionNavigationReceipt();
	clearCollectionNavigationReceipt();
	//The route canonicalizes the active card from an ID to its preferred slug
	//after arrival, so a byte comparison against the recorded path would
	//refuse a receipt the user never left. The aliases let the guard tell
	//"same card, better spelling" from "somewhere else entirely".
	const card = selectActiveCard(getState());
	const aliases = card ? [card.id || '', card.name || '', ...(card.slugs || [])] : [];
	if (collectionReceiptCanUndo(expectedLocation, currentBrowserLocation(), aliases)) {
		window.history.back();
		return;
	}
	//A refusal is never silent (HOUSE-STYLE §3.5). Sentence case, second person,
	//contractions used consistently (§2.3), U+2019 apostrophes (§2.2), and it
	//reports rather than scolds — moving on is not a mistake.
	//'refused' is the kind for something that did not happen with no data at
	//stake; 'committed'/'queued'/'discarded' are write outcomes and none apply.
	dispatch(showSnackbar('You’ve moved on since then, so there’s nothing to undo.', {kind: 'refused'}));
});

//BOTH ways of opening a collection report it the same way. They were two
//copies of the same call, already disagreeing about how to spell the card
//count, which is exactly how a receipt and its Undo drift apart.
const showCollectionNavigationReceipt = (expression : string, count : number | undefined) : void => {
	//Recorded BEFORE the message: the guard reads this slot, and the dedupeKey
	//replacing the visible receipt is what invalidates the previous one.
	recordCollectionNavigationReceipt(currentBrowserLocation());
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
	ParsedCollectionSource,
} from '../collection-source.js';

import {
	buildCollectionFilterCatalog,
	collectionFilterCatalogCategories,
	CollectionFilterCatalogCategory,
	CollectionFilterCatalogItem,
	CollectionFilterCatalogPolarity,
} from '../collection-filter-catalog.js';

//The synthetic suggestion the primary action and a highlight-free Enter both
//open. It is the only destination allowed to close the composer silently when
//it turns out to be the collection already on screen.
const CURRENT_DRAFT_SUGGESTION_ID = 'current-draft';

const ALREADY_ACTIVE_MESSAGE = 'This collection is already open.';

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
			   from resizing as the lists change under typing. */
			.content {
				height: 90%;
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

			/* 700, not 500: only 400 and 700 are loaded (§4.3), so 500 was
			   being synthesized. The set name is the lead term of the
			   expression — the same emphasis register as the <strong> in
			   .source-status — so it rounds up rather than down. */
			.expression-set {
				color: var(--app-primary-color);
				font-weight: 700;
			}

			.expression-operator,
			.expression-modifiers {
				color: var(--app-dark-text-color-light);
				font-size: 0.8em;
			}

			/* HelpStyles sizes the badge at 1.3em of whatever it sits in, which
			   suits a 0.75em form label. The expression row runs at 1.05em,
			   where that would make the badge the largest glyph in the dialog. */
			.expression .help svg {
				height: 1em;
				width: 1em;
			}

			/* Square, per §4.4: a clause chip is a core surface, not a pill. */
			.expression-clause {
				align-items: stretch;
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
				background: var(--app-primary-color-light-very-transparent);
				box-shadow: none;
			}

			.expression-clause-label {
				max-width: 18em;
				overflow-wrap: anywhere;
				padding: 0.35em 0.6em;
				text-align: left;
			}

			.expression-clause-remove {
				border-left: 1px solid var(--app-divider-color);
				font-size: 1.2em;
				min-width: 44px;
				padding: 0.35em;
			}

			.composer-input {
				border: 0;
				border-bottom: 1px solid var(--app-dark-text-color);
				box-sizing: border-box;
				flex: 1 1 14em;
				font: inherit;
				padding: 0.6em 0.2em;
				width: auto;
			}

			.composer-input:focus {
				border-bottom-color: var(--app-primary-color);
			}

			.composer-input:focus-visible {
				border-bottom-color: transparent;
				outline: 2px solid var(--app-primary-color);
				outline-offset: 2px;
			}

			.draft-receipt {
				align-items: center;
				color: var(--app-dark-text-color-light);
				display: flex;
				font-size: 0.82em;
				gap: 0.5em;
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

			.suggestion-heading {
				color: var(--app-dark-text-color-light);
				font-size: 0.75em;
				margin-top: 1.2em;
				text-transform: uppercase;
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

			.suggestion {
				align-items: start;
				border-top: 1px solid var(--app-divider-color);
				display: grid;
				grid-template-columns: minmax(0, 1fr) auto;
				margin: 0;
			}

			/* scrollIntoView({block:'nearest'}) scrolls to the row's own box, so
			   the group heading above row 0 went out of view on the first arrow
			   press and never came back — the CONTINUE label vanished for the
			   rest of the session. The heading is 0.75em text with a 1.2em
			   margin above it; reserving that much scroll margin keeps it on
			   screen when its first row is revealed. */
			.suggestion button {
				background: transparent;
				box-shadow: none;
				color: var(--app-dark-text-color);
				column-gap: 0.75em;
				display: grid;
				grid-template-columns: minmax(0, 1fr) auto auto;
				grid-template-areas:
					'category category category'
					'label    count    action'
					'detail   detail   detail'
					'example  example  example'
					'applied  applied  applied';
				margin: 0;
				padding: 0.65em 0.5em;
				scroll-margin-top: 2.2em;
				text-align: left;
				width: 100%;
			}

			.suggestion button:hover,
			.suggestion button[data-highlighted] {
				background: var(--app-primary-color-light-very-transparent);
				box-shadow: none;
			}

			.suggestion button[data-highlighted] {
				border-left: 3px solid var(--app-primary-color);
				padding-left: calc(0.5em - 3px);
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
			   grid area cannot overlap anything. */
			.suggestion-count {
				color: var(--app-dark-text-color-light);
				font-size: 0.82em;
				grid-area: count;
				white-space: nowrap;
			}

			.suggestion-action {
				color: var(--app-primary-color);
				font-size: 0.68em;
				grid-area: action;
				letter-spacing: 0.04em;
				text-transform: uppercase;
				white-space: nowrap;
			}

			/* A genuine extension rather than a repaint: this is a toggle (it
			   pairs with aria-pressed and takes .selected from
			   ButtonSharedStyles), and it needs the small-caps register and a
			   square hit target beside the row it modifies. Colour, margin and
			   height come from .verb. */
			.catalog-polarity {
				align-self: center;
				font-size: 0.7em;
				letter-spacing: 0.04em;
				min-width: 44px;
				text-transform: uppercase;
			}

			/* The key-hints line sits below the list and outside it, so the
			   list's last row was clipped underneath it on a narrow screen. */
			.mobile .suggestions {
				padding-bottom: 2.75em;
			}

			.mobile .suggestion button {
				grid-template-columns: minmax(0, 1fr) auto;
				grid-template-areas:
					'category category'
					'label    count'
					'action   action'
					'detail   detail'
					'example  example'
					'applied  applied';
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
			   down instead of shrink-wrapping its content. */
			.builder-catalog {
				flex: 1 1 0;
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
			   it. Everything else comes from .buttons. */
			.buttons.composer-actions {
				align-items: center;
				gap: 0.5em;
				margin-top: 0.75em;
				padding: 0.5em 0 max(0.25em, env(safe-area-inset-bottom));
			}

			/* §4.2's 44px hit target. button.round is 2.75em square, which is
			   44px only while this dialog renders at 16px; pin both dimensions
			   to the same floor so the button stays a circle rather than an
			   ellipse when it is the min-width that binds. */
			.buttons .primary {
				min-height: 44px;
				min-width: 44px;
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
			   subordinate small-caps register as .suggestion-heading and as
			   ButtonSharedStyles' own label rule, both of which are already 400 —
			   rounding up to 700 would make them the loudest thing in the
			   source pane. */
			.source-editor label,
			.source-interpretation-label {
				display: block;
				font-size: 0.78em;
				font-weight: 400;
				margin: 0.8em 0 0.35em;
				text-transform: uppercase;
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

			.source-status {
				border-left: 3px solid var(--app-divider-color);
				font-size: 0.85em;
				margin-top: 0.6em;
				padding: 0.35em 0.6em;
			}

			.source-status[data-valid] {
				border-left-color: var(--app-primary-color);
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

			.source-suggestion-category {
				color: var(--app-dark-text-color-light);
				font-size: 0.68em;
				grid-area: category;
				letter-spacing: 0.04em;
				text-transform: uppercase;
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
		const statusLabel = parsed.status === 'valid' ? 'Ready to open' :
			parsed.status === 'incomplete' ? 'Keep typing' :
				parsed.status === 'unsupported' ? 'Not supported here' : 'Can’t understand this source';
		const diagnostic = parsed.diagnostics[0]?.message || 'This source is complete and safe to open.';
		const completionDiagnostic = parsed.diagnostics.find(item => item.expected?.length);
		const completionMode = completionDiagnostic ? 'complete' : 'add';
		const completionDetails = completionDiagnostic?.expectedDetails || parsed.nextExpectedDetails || {};
		const completions = this._sourceCompletionsDismissed ? [] : (completionDiagnostic?.expected || parsed.nextExpected || []);
		const expressionParts = collectionExpressionParts(description, this._composerFilterLabels);
		const fullDestination = parsed.canonicalPath ? new URL(parsed.canonicalPath, window.location.origin).toString() : '';
		//The app elides the default set, so a perfectly good `/c/main/starred/`
		//canonicalizes to `/c/starred/`. Shown under "Will open as" with no
		//further comment, that reads as the app quietly rewriting what was
		//typed. Naming it as the same collection in canonical form is the whole
		//difference between a rewrite and a spelling.
		const canonicalized = Boolean(parsed.canonicalPath) && parsed.canonicalPath !== this._sourceInput;
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
				<div id='collection-source-status' class='source-status' role='status' ?data-valid=${parsed.status === 'valid'}>
					<strong>${statusLabel}</strong> — ${diagnostic}
				</div>
			</div>
			${completions.length ? html`
				<div class='source-suggestion-heading'>${completionMode === 'add' ? 'Add another filter or modifier — type to search all filters' : 'Choose the next value'}</div>
				<div id='collection-source-completions' class='suggestions scroller' role='listbox' aria-label='Legal next source values'>
					${completions.map((completion, index) => {
		const presentation = this._sourceCompletionPresentation(completion, completionDetails[completion]);
		return html`
						<div class='suggestion' role='presentation'>
							<button id=${`collection-source-completion-${index}`} role='option' tabindex='-1' aria-selected=${index === this._sourceCompletionIndex} ?data-highlighted=${index === this._sourceCompletionIndex} @click=${() => this._acceptSourceCompletion(completion)}>
								<span class='source-suggestion-category'>${presentation.category}</span>
								<span class='suggestion-label'>${presentation.label}</span>
								<span class='suggestion-action'>${completionMode}</span>
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
			${shown?.selectedCardRaw ? html`
				<span class='source-interpretation-label'>Opens on</span>
				<div>${shown.selectedCardRaw === '_' ? 'The first card in the collection' : shown.selectedCardRaw}</div>
			` : ''}
			${fullDestination ? html`
				<span class='source-interpretation-label'>${canonicalized ? 'Will open as' : 'Link'}</span>
				<div id='collection-source-destination' class='source-link'>${fullDestination}</div>
				${canonicalized ? html`<div class='key-hints'>Same collection, written in this app’s canonical form</div>` : ''}
			` : ''}
			${parsed.notices.map(notice => html`<div class='key-hints'>${notice} ${parsed.query}${parsed.hash}</div>`)}
			${fullDestination ? html`<button class='small verb' @click=${this._handleCopySourceLink} aria-label='Copy collection link'>Copy link</button>` : ''}
			${this._sourceReturnWarning ? html`
				<div id='collection-source-return-warning' class='source-status' role='alert' tabindex='-1'>
					These source edits do not form an openable collection.
					<div><button class='small verb' @click=${() => this._sourceReturnWarning = false}>Keep editing</button><button class='small verb' @click=${this._returnToLastValidSource}>Return to last valid collection</button></div>
				</div>
			` : ''}
			<div class='mode-actions'>
				<button class='small verb' @click=${this._handleBackToCompose}>Edit visually</button>
				<span class='key-hints'>${completions.length ? (completionMode === 'add' ? `↑↓ Choose · Tab adds · Enter opens · ${shortcutKeys('dialog-escape')} dismisses suggestions` : `↑↓ Choose · Tab or Enter completes · ${shortcutKeys('dialog-escape')} dismisses suggestions`) : (parsed.status === 'valid' ? `Enter opens · ${shortcutKeys('dialog-escape')} cancels` : `Keep editing · ${shortcutKeys('dialog-escape')} cancels`)}</span>
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
											@click=${() => this._handleCatalogItem(item)}
										>
											<span class='suggestion-label'>${item.label}</span>
											<span class='suggestion-action'>${!item.guided || item.appliedIndex >= 0 ? 'edit' : item.configurable && !item.filter.includes('/') ? 'configure' : 'add'}</span>
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
				${help(COLLECTION_HELP)}
				<span class='expression-set'>${expressionParts.set.label}</span>
				${expressionParts.filters.map(filter => html`
					<span class='expression-operator' aria-hidden='true'>AND</span>
					<span class='expression-clause' role='group' aria-label=${`${filter.label} filter`} ?data-selected=${filter.index === this._selectedClauseIndex}>
						<button
							class='expression-clause-label'
							aria-label=${`Edit ${filter.label} filter`}
							@click=${() => this._handleClauseEdit(filter.index)}
						>${filter.label}</button>
						<button
							class='expression-clause-remove'
							aria-label=${`Remove ${filter.label} filter`}
							title=${`Remove ${filter.label} filter`}
							@click=${() => this._removeDraftClause(filter.index)}
						>×</button>
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
			</div>
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
			<div class='key-hints'>${this._catalogOpen ? `Type to search · ↑↓ choose · Enter opens Source, configures, or adds · ${shortcutKeys('dialog-escape')} closes catalog` : this._selectedClauseIndex >= 0 ?
		'←→ choose clause · Delete removes · type to continue' : !highlighted ?
			(suggestions.length ? '↑↓ or Tab choose · Click edits · Enter opens this collection' : 'Type to compose · Enter opens this collection') : highlighted.action === 'open' ?
				'↑↓ choose · Enter opens · Tab copies it into the draft' :
				highlighted.sourceFilter ? '↑↓ choose · Click, Tab, or Enter opens Source' :
					highlighted.configureFilter ? '↑↓ choose · Click, Tab, or Enter configures' :
						'↑↓ choose · Click or Tab adds · Enter adds and opens'}</div>
			<div class='builder-toggle mode-actions'>
				<button class='small verb' @click=${this._handleCatalogToggle}>${this._catalogOpen ? 'Hide filter catalog' : 'Browse all filters'}</button>
				<button class='small verb' @click=${this._handleEditSource}>Edit source</button>
			</div>
			${this._catalogOpen ? html`<div class='builder builder-catalog'>${this._catalogRender()}</div>` : ''}
			${this._builderExpanded ? html`<div class='builder'>${this._selectedClauseEditorRender()}</div>` : ''}
			${this._openActionRender(
		draftCount,
		this._activationPending,
		this._activationPending ? 'Already opening this collection' : 'Open this collection',
		this._handleOpenCurrentDraft
	)}
		`;
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
	_openActionRender(count : number | undefined, disabled : boolean, reason : string, handler : (e : Event) => void) {
		return html`
			<div class='buttons composer-actions'>
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
								@mousemove=${() => this._handleSuggestionPointerMove(index)}
								@mouseenter=${() => this._handleSuggestionPointerEnter(index)}
								@click=${() => this._applyComposerSuggestion(suggestion, suggestion.action === 'open')}
							>
								<span class='suggestion-label'>${suggestion.label}</span>
								<span class='suggestion-action'>${visibleAction}</span>
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

	_highlightSuggestionFromPointer(index : number) {
		this._highlightedSuggestion = index;
		this._suggestionHighlightActive = true;
	}

	_handleSuggestionPointerMove(index : number) {
		//A mousemove is proof the pointer actually moved, so it both arms
		//pointer highlighting and takes the highlight itself. mouseenter alone
		//is not proof: it also fires when rows shift under a resting cursor.
		this._pointerHighlightArmed = true;
		this._highlightSuggestionFromPointer(index);
	}

	_handleSuggestionPointerEnter(index : number) {
		if (!this._pointerHighlightArmed) return;
		this._highlightSuggestionFromPointer(index);
	}

	get _composerSuggestions() : CollectionComposerSuggestion[] {
		if (!this._collectionDescription) return [];
		const remembered = readRememberedCollections(this._userScope);
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

	_sourceCompletionPresentation(token : string, grammarDetail = '') : {label: string, detail: string, category: string} {
		const candidate = this._contextualComposerCandidates.find(item => item.filter === token);
		if (candidate) return {label: this._readableComposerFilter(token), detail: candidate.detail, category: candidate.category};
		if (token === 'sort') return {label: 'Choose an order', detail: grammarDetail || 'Control the order cards appear in', category: 'ordering'};
		if (token === 'view') return {label: 'Choose a view', detail: grammarDetail || 'Control how cards are displayed', category: 'display'};
		if (['main', 'everything', 'reading-list'].includes(token)) return {label: collectionOptionDisplayName(token), detail: grammarDetail, category: 'starting set'};
		if (['before', 'after', 'between', 'today', 'yesterday'].includes(token) || /-ago$/.test(token)) {
			return {label: this._readableComposerFilter(token), detail: grammarDetail || 'A date boundary', category: 'date'};
		}
		return {label: this._readableComposerFilter(token), detail: grammarDetail || 'A legal collection filter', category: 'filter'};
	}

	constructor() {
		super();
		this.title = collectionComposerEnabled() ? 'Compose a Collection' : 'Configure Collection';
	}

	_handleSourceInput(e : InputEvent) {
		const input = e.composedPath()[0];
		if (!(input instanceof HTMLTextAreaElement)) throw new Error('not textarea element');
		const previous = this._sourceInput;
		const startsNewFilter = !this._sourceAutoDelimitedSegment && previous.endsWith('/') &&
			input.value.startsWith(previous) && input.value.length > previous.length && Boolean(this._parsedSource.nextExpected?.length);
		let nextValue = input.value;
		const nextCaret = input.selectionStart;
		if (startsNewFilter) {
			nextValue += '/';
			this._sourceAutoDelimitedSegment = true;
		} else if (this._sourceAutoDelimitedSegment) {
			const extendsAutoDelimitedValue = input.value.startsWith(previous.slice(0, -1));
			if (extendsAutoDelimitedValue && !input.value.endsWith('/')) nextValue += '/';
			const caretBeforeDelimiter = nextValue.endsWith('/') && nextCaret === nextValue.length - 1;
			this._sourceAutoDelimitedSegment = caretBeforeDelimiter && nextValue !== previous.slice(0, previous.lastIndexOf('/') + 1);
		}
		this._sourceInput = nextValue;
		this._sourceDirty = true;
		this._activationMessage = '';
		this._sourceReturnWarning = false;
		this._sourceCompletionsDismissed = false;
		this._sourceCompletionIndex = 0;
		const parsed = this._parsedSource;
		if (parsed.status === 'valid') this._lastValidSource = parsed;
		if (startsNewFilter || this._sourceAutoDelimitedSegment) this.updateComplete.then(() => {
			const sourceInput = this.shadowRoot?.querySelector<HTMLTextAreaElement>('#collection-source-input');
			sourceInput?.setSelectionRange(nextCaret, nextCaret);
		});
	}

	_handleSourceKeyDown(e : KeyboardEvent) {
		if (e.isComposing || e.keyCode === 229) return;
		const parsed = this._parsedSource;
		const completionDiagnostic = parsed.diagnostics.find(item => item.expected?.length);
		const completions = this._sourceCompletionsDismissed ? [] : (completionDiagnostic?.expected || parsed.nextExpected || []);
		if (completions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
			e.preventDefault();
			const direction = e.key === 'ArrowDown' ? 1 : -1;
			this._sourceCompletionIndex = (this._sourceCompletionIndex + direction + completions.length) % completions.length;
			return;
		}
		if (completions.length && (e.key === 'Tab' || (e.key === 'Enter' && completionDiagnostic))) {
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
		if (parsed.status === 'valid') this._handleOpenSource();
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
			this._sourceInput = `/c/${this._collectionDescription.serializeShortOriginalOrder()}${appendedFilter}${this._draftSelectedCard}`;
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

	_handleOpenSource() {
		const parsed = this._parsedSource;
		if (parsed.status !== 'valid' || !parsed.description || !parsed.canonicalPath || this._activationPending) return;
		this._activationPending = true;
		this._activationMessage = '';
		const result = store.dispatch(navigatePathToResult(parsed.canonicalPath));
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
		showCollectionNavigationReceipt(
			readableCollectionExpression(parsed.description, this._composerFilterLabels),
			this._previewCounts[this._draftPreviewID]
		);
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
			//Spec: Enter opens the highlighted destination including its visible
			//preview, or the current draft when no suggestion is highlighted.
			if (highlighted) this._applyComposerSuggestion(highlighted, true);
			else this._handleOpenCurrentDraft();
		}
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
			//Compare collections, not URL spellings: /c/ and /c/main/ name the
			//same collection, so the path comparison inside navigatePathToResult
			//would push a duplicate history entry for the collection already on
			//screen. A suggestion carrying its own destination path can still be
			//a real navigation (a different selected card, say), so only the
			//draft — whose selected card is checkable here — gets the semantic
			//comparison when a path is present.
			const alreadyActive = (isDraft || !suggestion.destinationPath) &&
				selectActiveCollectionDescription(store.getState() as State).serialize() === suggestion.description.serialize() &&
				(!isDraft || this._draftSelectedCard === this._requestedCard);
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
			const destinationPath = suggestion.destinationPath || `/c/${suggestion.description.serializeShortOriginalOrder()}${this._draftSelectedCard}`;
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
			showCollectionNavigationReceipt(
				readableCollectionExpression(suggestion.description, this._composerFilterLabels),
				this._previewCounts[suggestion.id]
			);
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
		this._applyComposerSuggestion({
			id: CURRENT_DRAFT_SUGGESTION_ID,
			kind: 'source',
			action: 'open',
			name: readableCollectionExpression(this._collectionDescription, this._composerFilterLabels),
			label: 'Open this collection',
			detail: readableCollectionExpression(this._collectionDescription, this._composerFilterLabels),
			description: this._collectionDescription,
			destinationPath: `/c/${this._collectionDescription.serializeShortOriginalOrder()}${this._draftSelectedCard}`,
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
	private _syncNestedEscapeShortcut() {
		if (this.open && !this._unregisterNestedEscapeShortcut) {
			this._unregisterNestedEscapeShortcut = registerShortcut({
				id: 'collection-composer-nested-escape',
				keys: SHORTCUT_COMBOS['dialog-escape'],
				label: 'Close the composer’s current layer',
				priority: DIALOG_SHORTCUT_PRIORITY + 1,
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
			if (!this._sourceDirty && !this._sourceInput) this._sourceInput = `/c/${this._collectionDescription.serializeShortOriginalOrder()}${this._draftSelectedCard}`;
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
		this._composerCandidates = selectCollectionComposerCandidates(state);
		this._userIDs = selectAuthorAndCollaboratorUserIDs(state);
		this._userInfos = selectAuthorsForTagList(state);
		this._cardTagInfos = selectTagInfosForCards(state);
		this._cardsSelected = selectCardsSelected(state);
		this._userScope = selectUid(state);
		this._activeCardID = selectActiveCardID(state);
		this._requestedCard = selectRequestedCard(state) || '';
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
