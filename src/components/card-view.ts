import { html, css, PropertyValues } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { PageViewElement } from './page-view-element.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import {
	selectActiveCard,
	selectActiveCardEnriched,
	selectActiveSectionId,
	selectDataIsFullyLoaded,
	selectUserSignedIn,
	selectUserMayAddCardToActiveCollection,
	selectUserMayReorderActiveCollection,
	selectActiveCollectionCardTypeToAdd,
	selectUserMayStar,
	selectUserMayMarkRead,
	getCardHasStar,
	getCardIsRead,
	selectTags,
	getCardInReadingList,
	selectUserMayModifyReadingList,
	selectCardsDrawerPanelShowing,
	selectActiveCollection,
	selectEditingCardForDisplay,
	selectPendingSaveCardForDisplay,
	selectActiveCardTodosForCurrentUser,
	selectCommentsAndInfoPanelOpen,
	selectUserMayEditActiveCard,
	selectUserMayCreateCard,
	selectSectionsAndTagsLoaded,
	selectEditingUpdatedFromContentEditable,
	selectPendingNewCardIDToNavigateTo,
	selectUserMayForkActiveCard,
	selectWordCloudForMainCardDrawer,
	selectCardsDrawerInfoExpanded,
	selectExpandedPrimaryReferenceBlocksForEditingOrActiveCard,
	selectCollectionConstructorArguments,
	selectCollectionConstructorArgumentsWithEditingCard,
	selectEditingNormalizedCard,
	selectEditingCardSuggestedConceptReferences,
	selectCardIDsUserMayEdit,
	selectSuggestMissingConceptsEnabled,
	selectUserIsAdmin,
	selectActiveRenderOffset,
	selectEditorMinimized,
	selectUserMayUseAI,
	selectIsEditing,
	selectSuggestionsForActiveCard,
	selectSuggestionsOpen,
	selectCardsSelected,
	selectActiveCollectionNotFullySelected,
	selectActiveCollectionNotFilteredToSelected,
	selectCollectionWordCloudVersion,
	selectCardModificationPending,
	selectUid,
	selectCardSavesEligible,
	selectCorpusStatus,
	selectWorkerActiveCollectionReady,
	selectConfigureCollectionDialogOpen,
} from '../selectors.js';

import {
	randomizeCollection,
	updateCardSelector,
	canonicalizeURL,
	updateRenderOffset,
	navigateToRandomCard,
	doSelectCards,
	unselectCards,
	clearSelectedCards,
	incrementCollectionWordCloud
} from '../actions/collection.js';

import {
	editingStart
} from '../actions/editor.js';

import {
	createCard,
	navigateToNewCard,
	createForkedCard,
	durableCardMutationPending,
} from '../actions/data.js';

import {
	keepSlugLegalWarm
} from '../actions/database.js';

import {
	openFindDialog
} from '../actions/find.js';

import {
	toggleCardsDrawerInfo,
	openConfigureCollectionDialog,
	navigateToCollectionWithSelected,
	askForPathToNavigateTo,
	showSnackbar,
	urlForCollection,
} from '../actions/app.js';

import {
	killEvent,
	deepActiveElement
} from '../util.js';

import {
	collectionComposerEnabled,
} from '../collection-composer-mode.js';

import {
	readableCollectionExpression,
} from '../collection-composer-suggestions.js';

import {
	addStar,
	removeStar,
	markRead,
	markUnread,
	AUTO_MARK_READ_DELAY,
	showNeedSignin,
	removeFromReadingList,
	addToReadingList,
	toggleOnReadingList
} from '../actions/user.js';

import {
	navigateToCardInCurrentCollection,
	navigateToDefaultIfSectionsAndTagsLoaded,
	openCardsDrawerPanel,
	closeCardsDrawerPanel,
	enablePresentationMode,
	disablePresentationMode,
	navigateToNextCard,
	navigateToPreviousCard,
	openCommentsAndInfoPanel,
	closeCommentsAndInfoPanel,
	turnSuggestMissingConcepts,
} from '../actions/app.js';

import {
	openMultiEditDialog
} from '../actions/multiedit.js';

//Components needed by this
import './card-drawer.js';
import './card-stage.js';
import './card-editor.js';
import './tag-list.js';
import './word-cloud.js';
import './comments-panel.js';
import './card-info-panel.js';
import './suggestions-viewer.js';

import {
	TODO_ALL_INFOS
} from '../filters.js';

import {
	EDIT_ICON,
	FORUM_ICON,
	INFO_ICON,
	VIEW_DAY_ICON,
	FULL_SCREEN_ICON,
	ARROW_BACK_ICON,
	ARROW_FORWARD_ICON,
	STAR_ICON,
	STAR_BORDER_ICON,
	VISIBILITY_ICON,
	SEARCH_ICON,
	PLAYLISLT_ADD_CHECK_ICON,
	PLAYLIST_ADD_ICON,
	FILE_COPY_ICON,
	RULE_ICON,
	CASINO_ICON,
	AUTO_AWESOME_ICON,
	PSYCHOLOGY_ICON,
	CANCEL_ICON,
	PLUS_ICON,
	FILTER_ALT_ICON,
	SAVE_ICON,
	REPEAT_ICON,
	COPY_ALL_ICON,
} from '../../shared/icons.js';

import {
	reorderCard
} from '../actions/data.js';

import {
	missingConceptsWithAI,
	summarizeCardsWithAI
} from '../actions/ai.js';

// These are the shared styles needed by this element.
import { SharedStyles } from './shared-styles.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	Card,
	CardFieldMap,
	CardID,
	CardType,
	CorpusStatus,
	ProcessedCard,
	SectionID,
	State,
	Suggestion,
	TagInfos,
	TODOType,
	WordCloud
} from '../types.js';

import {
	blockedReason,
	CREATE_VERB,
	SAVE_VERB
} from '../sync-copy.js';

import {
	Collection
} from '../collection_description.js';


import {
	ExpandedReferenceBlocks,
	expandReferenceBlocksViaRunner,
	primaryReferenceBlocksForCard
} from '../reference_blocks.js';

import {
	corpusWorkerCanRunCollections,
	corpusWorkerRunCollection
} from '../corpus-bridge.js';

import {
	corpusWorkerServesCollections
} from '../corpus-mode.js';

import {
	deferredWorkIsOverdue,
	deferredWorkStartedAt
} from '../deferred-work.js';

import {
	sectionResultCommits
} from '../section-coherence.js';

import {
	CardSelectedEvent,
	CardSwipedEvent,
	DisabledCardHighlightClickedEvent,
	EditabledCardFieldUpdatedEvent,
	ReorderCardEvent,
	ThumbnailTappedEvent,
	UpdateRenderOffsetEvent
} from '../events.js';

import {
	calculateSuggestionsForActiveCard,
	suggestionsTogglePanel
} from '../actions/suggestions.js';

import {
	openBulkImportDialog
} from '../actions/bulk-import.js';

import {
	showCreateChatPrompt
} from '../actions/chat.js';

//How long after the last state change the active card's reference blocks
//recompute. Long enough that holding an arrow key never pays the ~1-2s
//whole-corpus cost mid-navigation; short enough that blocks feel immediate
//once the user settles.
const REFERENCE_BLOCKS_DEBOUNCE_MS = 250;
//The debounce timer resets on EVERY state change, so sustained churn
//(worker pushes, similarity fetches, boot batches) could starve it
//indefinitely — blocks would simply never appear. The max-wait guarantees
//blocks compute within this bound of the FIRST deferral no matter how busy
//the store is.
const REFERENCE_BLOCKS_MAX_WAIT_MS = 1000;
//How long a collection may be worker-pending before the stale content dims
//with the "updating" affordance. Below this, the previous collection shows
//unlabeled — a bounded, sub-perceptual staleness that avoids flicker.
const COLLECTION_UPDATING_GRACE_MS = 200;

//e.code is the PHYSICAL key position, so on AZERTY, Dvorak or any non-QWERTY
//layout the printed shortcut stops working and a DIFFERENT printed key silently
//triggers it — Cmd-M creating a card from whatever key sits where M is on
//QWERTY. e.key is what the user actually pressed.
const pressedLetter = (e : KeyboardEvent) : string => (e.key || '').toLowerCase();

@customElement('card-view')
class CardView extends connect(store)(PageViewElement) {

	@state()
		_card: ProcessedCard | null;

	@state()
		_editing: boolean;

	@state()
		_cardModificationsPending: boolean;

	@state()
		_durableCardMutationPending: boolean;

	@state()
		_hideActions: boolean;

	@state()
		_editorMinimized: boolean;

	@state()
		_pageExtra: string;

	@state()
		_userMayEdit: boolean;

	@state()
		_cardTypeToAdd: CardType;

	@state()
		_userMayAddCardToActiveCollection: boolean;

	@state()
		_userMayReorderCollection: boolean;

	@state()
		_userMayCreateCard: boolean;

	@state()
		_userMayStar: boolean;

	@state()
		_userMayUseAI: boolean;

	@state()
		_userMayMarkRead: boolean;

	@state()
		_userMayModifyReadingList: boolean;

	@state()
		_userMayForkCard: boolean;

	@state()
		_autoMarkReadPending: boolean;

	@state()
		_displayCard: Card | null;

	//True while _displayCard is the optimistic committed-but-unconfirmed save
	//draft rather than server truth — drives the small card-level "Saving…"
	//chip. Own @state: read directly by the template.
	@state()
		_displayCardPendingSave: boolean;

	@state()
		_editingCard: Card | null;

	@state()
		_cardsSelected : boolean;

	@state()
		_collectionNotFullySelected : boolean;

	@state()
		_collectionNotFilteredToSelected : boolean;

	@state()
		_commentsAndInfoPanelOpen : boolean;

	@state()
		_cardsDrawerPanelOpen: boolean;

	@state()
		_cardsDrawerPanelShowing: boolean;

	@state()
		_headerPanelOpen: boolean;

	@state()
		_updatedFromContentEditable: CardFieldMap;

	@state()
		_presentationMode: boolean;

	@state()
		_mobileMode: boolean;

	@state()
		_cardHasStar: boolean;

	@state()
		_cardIsRead: boolean;

	@state()
		_cardInReadingList: boolean;

	@state()
		_collection: Collection | null;

	@state()
		_collectionIsFallback: boolean;

	@state()
		_collectionUpdating: boolean;

	//"the active collection has not been served yet", as distinct from
	//_collectionUpdating, which only becomes true when there is a PREVIOUS ready
	//collection being held as stale. On a first boot there is none, so
	//_collectionUpdating stays false and the drawer rendered a bare "0 cards" —
	//the cold-visit case.
	//
	//It needs its OWN @state(): declared under the previous field's decorator it
	//was a plain property, so assigning it triggered no re-render and the fix
	//worked only when unrelated boot traffic happened to re-render this
	//component — which is frequent during boot, so it USUALLY appeared to work.
	@state()
		_collectionPending: boolean;

	@state()
		_saveEligible: boolean;

	//The actual sync status, so blocked-control copy can say what is TRUE
	//rather than always asserting "still verifying".
	@state()
		_corpusStatus: CorpusStatus;
	_lastReadyCollection: Collection | null = null;
	_collectionUpdatingTimeout = 0;
	_lastCollectionScopeUid = '';

	@state()
		_renderOffset: number;

	@state()
		_drawerReorderPending : boolean;

	@state()
		_activeSectionId: SectionID;

	@state()
		_dataIsFullyLoaded: boolean;

	@state()
		_sectionsAndTagsLoaded: boolean;

	@state()
		_tagInfos: TagInfos;

	@state()
		_cardTodos: TODOType[];

	@state()
		_pendingNewCardIDToNavigateTo: CardID;

	@state()
		_collectionWordCloud: WordCloud | null;

	@state()
		_collectionWordCloudVersion = 0;

	@state()
		_infoExpanded: boolean;

	@state()
		_suggestMissingConceptsEnabled: boolean;

	@state()
		_suggestedConcepts: CardID[] | null;

	@state()
		_userIsAdmin: boolean;

	@state()
		_cardReferenceBlocks: ExpandedReferenceBlocks;

	_referenceBlocksTimeout : number;
	//When the CURRENT string of deferrals began (0 = none pending) — for the
	//max-wait guarantee.
	_referenceBlocksFirstDeferredAt = 0;
	//Which card the currently-rendered _cardReferenceBlocks belong to, so a
	//navigation can clear MISMATCHED blocks immediately (showing the
	//previous card's "similar cards" under a new card misattributes
	//relations; empty-until-ready is honest, wrong-then-right is not).
	_cardReferenceBlocksForCardID = '';

	@state()
		_signedIn: boolean;

	@state()
		_suggestionsForCard : Suggestion[];

	@state()
		_suggestionsPanelOpen : boolean;

	static override styles = [
		ButtonSharedStyles,
		SharedStyles,
		css`
			:host {
				height: 100%;
				width: 100%;
				position:absolute;
			}
			.container {
				display:flex;
				height:100%;
				width:100%;
			}

			#center {
				flex-grow:1;
				/* The next property means that we take up as much space as we're given, and our content doesn't create a floor of size */
				overflow:hidden;
				display:flex;
				flex-direction:column;
			}

			.next-prev {
				display:none;
			}

			.presenting .next-prev {
				display:flex;
			}

			.presenting .panels {
				display:none;
			}

			.collection-mobile {
				display: none;
			}

			.mobile .collection-mobile {
				display: block;
			}

			card-editor {
				display:none;
			}

			card-editor[data-active] {
				display:block;
				width:100%;
				flex-grow: 1;
				min-height: 300px;
			}

			card-editor[data-minimized] {
				flex-grow: initial;
				min-height: initial;
			}

			[slot=tags] {
				display:flex;
				flex-direction: column;
				align-items: center;
			}

			/* Hover target for a disabled control's explanation. The buttons it
			   wraps sit in an inline row beside UNWRAPPED buttons, which
			   ButtonSharedStyles gives vertical-align:middle; a default
			   baseline-aligned wrapper dropped the wrapped ones ~6px lower
			   than their neighbours. */
			span.reason {
				display: inline-flex;
				vertical-align: middle;
			}

			.collection-summary {
				display: grid;
				grid-template-columns: minmax(0, 1fr) 44px;
				align-items: center;
				gap: 0.15em;
				margin: 0.35em 0.4em 0.65em;
				text-align: left;
			}

			.collection-summary-main {
				background: transparent;
				box-shadow: none;
				color: var(--app-dark-text-color);
				margin: 0;
				min-width: 0;
				padding: 0.4em;
				text-align: left;
			}

			.collection-summary-main:hover {
				background: var(--app-primary-color-light-very-transparent);
				box-shadow: none;
			}

			.collection-summary-expression {
				display: -webkit-box;
				-webkit-box-orient: vertical;
				-webkit-line-clamp: 2;
				overflow: hidden;
				font-size: 0.82em;
				line-height: 1.25;
			}

			.collection-summary-action {
				color: var(--app-primary-color);
				display: block;
				font-size: 0.7em;
				margin-top: 0.25em;
			}

			#copy-collection-link {
				height: 44px;
				width: 44px;
				display: grid;
				place-items: center;
			}

			card-drawer.showing {
				border-right: 1px solid var(--app-divider-color);
				/* Reserve the loaded column width. The drawer is shrink-to-fit,
				   so without this it grows ~70px -> ~209px as thumbnails stream
				   in during boot, shoving the card stage sideways. 12em
				   thumbnail (card-thumbnail-list) plus its margins. */
				min-width: 13em;
			}

			/* 13em is over half of a 375px viewport. The reservation exists to
			   stop a layout jump on a wide screen; on a narrow one, holding
			   that much width during boot is worse than the jump it prevents.
			   900px matches the app's own mobile breakpoint (card-web-app). */
			@media (max-width: 900px) {
				card-drawer.showing {
					min-width: 0;
				}
			}

			[hidden] {
				display:none;
			}

			.auto-read {
				display: none;
				height: 100%;
				width: 100%;
				border-radius: 50%;
				position: absolute;
				top: 0;
				left: 0;
				z-index:1;
				background-color:#FFFFFF66;
			}

			.auto-read.pending {
				display:block;
				animation-name: autoread;
				animation-duration: ${AUTO_MARK_READ_DELAY / 1000 }s;
				animation-timing-function: linear;
			}

			.right-panel {
				display:flex;
				flex-direction: column;
			}

			@keyframes autoread {
				from {
					transform: scale(1.0);
				}
				to {
					transform: scale(0.0);
				}
			}
		`
	];

	override render() {
		return html`
      <div class='container${this._editing ? ' editing' : ''} ${this._presentationMode ? 'presenting' : ''} ${this._mobileMode ? 'mobile' : ''}'>
        <card-drawer
				class='${this._cardsDrawerPanelShowing ? 'showing' : ''}'
				.showing=${this._cardsDrawerPanelShowing}
				.collection=${this._collection}
				.updating=${this._collectionUpdating}
				.pending=${this._collectionPending}
				.selectable=${this._userMayEdit}
				@info-zippy-clicked=${this._handleInfoZippyClicked}
				@thumbnail-tapped=${this._thumbnailActivatedHandler}
				@reorder-card=${this._handleReorderCard}
				@add-card='${this._handleAddCard}'
				@add-working-notes-card='${this._handleAddWorkingNotesCard}'
				@update-render-offset=${this._handleUpdateRenderOffset}
				@card-selected=${this._handleCardSelected}
				.reorderable=${this._userMayReorderCollection}
				.showCreateCard=${this._userMayAddCardToActiveCollection}
				.showCreateWorkingNotes=${this._userMayCreateCard}
				.createEligible=${this._saveEligible}
				.createBlockedReason=${blockedReason(this._corpusStatus, CREATE_VERB)}
				.highlightedCardId=${this._card ? this._card.id : ''}
				.reorderPending=${this._drawerReorderPending}
				.ghostCardsThatWillBeRemoved=${true}
				.infoExpanded=${this._infoExpanded}
				.infoCanBeExpanded=${true}
				.cardTypeToAdd=${this._cardTypeToAdd}
				.renderOffset=${this._renderOffset}
			>
			<div slot='info'>
				${this._collectionWordCloud ? html`<word-cloud .wordCloud=${this._collectionWordCloud}></word-cloud>` : html``}
				<button id='regenerate-word-cloud' class='small' title='Regenerate Word Cloud' @click=${this._handleRegenerateWordCloudClicked}>${REPEAT_ICON}</button><label for='regenerate-word-cloud'>${this._collectionWordCloud ? html`Regenerate` : html`Generate`} Word Cloud</label><br/>
				${this._userIsAdmin ? html`
				<input type='checkbox' .checked=${this._suggestMissingConceptsEnabled} @change=${this._handleSuggestMissingConceptsChanged} id='suggested-concepts-enabled'><label for='suggested-concepts-enabled'>Suggest Missing Concepts <strong>(SLOW)</strong></label><br/>
				<button id='edit-multi' class='small' title='Edit all cards' @click=${this._handleMultiEditClicked}>${EDIT_ICON}</button><label for='edit-multi'>Edit All Cards</label><br/>
				` : ''}
				${this._userMayUseAI ? html`
				<button id ='ai-assistant-summary' class='small' title='Summarize Cards with AI' @click=${this._handleAIAssistantSummaryClicked}>${AUTO_AWESOME_ICON}</button><label for='ai-assitant-summary'>Summarize Cards</label><br/>
				<button id ='ai-assistant-concepts' class='small' title='Suggest Missing Concepts with AI' @click=${this._handleAIAssistantConceptsClicked}>${AUTO_AWESOME_ICON}</button><label for='ai-assitant-concepts'>Suggest Missing Concepts</label><br/>
				<button id ='ai-chat-with-collection' class='small' title='Chat with these cards' @click=${this._handleAIAssistantChatWithCollection}>${FORUM_ICON}</button><label for='ai-chat-with-collection'>Chat with Cards</label><br/>` : ''}
				${this._userMayCreateCard ? html`
					<button
						id='bulk-import'
						class='small'
						title='Bulk Import Cards'
						@click=${this._handleBulkImportClicked}
					>
						${PLUS_ICON}
					</button>
					<label for='bulk-import'>Bulk Import</label>
					<br />
					<!-- technically you don't need to have create card ability to use this, but don't clutter up most user's UI with it -->
					<button
						id='bulk-export'
						class='small'
						title='Bulk Export Cards'
						@click=${this._handleBulkExportClicked}
					>
						${SAVE_ICON}
					</button>
					<label for='bulk-export'>Bulk Export</label>
					<br />
				`: ''}
				<button id='configure-collection' class='small' title='Configure Collection' @click=${this._handleConfigureCollectionClicked}>${RULE_ICON}</button><label for='configure-collection'>Configure Collection</label>
			</div>
			<div slot='visible-info'>
				${collectionComposerEnabled() && this._collection ? html`
					<div class='collection-summary'>
						<button
							class='collection-summary-main'
							title=${readableCollectionExpression(this._collection.description)}
							aria-label=${`Refine collection: ${readableCollectionExpression(this._collection.description)}`}
							@click=${this._handleConfigureCollectionClicked}
						>
							<span class='collection-summary-expression'>${readableCollectionExpression(this._collection.description)}</span>
							<span class='collection-summary-action'>${
								this._collection.description.filters.length ||
								this._collection.description.set !== 'main' ||
								this._collection.description.sort !== 'default' ||
								this._collection.description.sortReversed ||
								this._collection.description.viewMode !== 'list' ?
									'Refine · Ctrl K' : 'Show cards matching… · Ctrl K'
							}</span>
						</button>
						<button
							id='copy-collection-link'
							class='small'
							title='Copy link to this collection'
							aria-label='Copy link to this collection'
							@click=${this._handleCopyCollectionLink}
						>${COPY_ALL_ICON}</button>
					</div>
				` : ''}
				${this._cardsSelected ? 
		html`<button
				id='clear-selection'
				class='small'
				title='Clear Selected Cards'
				@click=${this._handleClearSelectionClicked}
			>
			${CANCEL_ICON}
			</button>
			<label for='clear-selection'>Clear Selection</label>
			<br />
			${this._collectionNotFilteredToSelected ?
		html`
				<button
					id='filter-to-selected'
					class='small'
					title='Filter to Selected Cards'
					@click=${this._handleFilterToSelectedClicked}
				>
				${FILTER_ALT_ICON}
				</button>
				<label for='filter-to-selected'>Show Only Selected</label>
				<br />
			` 
		:''	
}
			${this._collectionNotFullySelected ?
		html`<button
			id='add-to-selection'
			class='small'
			title='Add all cards to selection'
			@click=${this._handleAddCollectionToSelectionClicked}
		>
		${PLUS_ICON}
		</button>
		<label for='add-to-selection'>Add all cards to selection</label>`
		: ''}

			`
		: ''
}
				${this._collection?.description.isRandom ? html`
					<button
						id='randomize'
						class='small'
						title='Randomize (⌘⌥R)'
						@click=${this._handleRandomizeClicked}>
							${CASINO_ICON}
						</button>
						<label for='randomize'>Randomize</label>
				` : ''}
			</div>
		</card-drawer>
        <div id='center'>
			<!-- The loading property is what applies the uniform fade that
			makes the boot placeholder read as pending rather than as real card
			content; it was never set here, so the placeholder rendered at full
			weight and opacity, visually identical to a loaded card. -->
			<card-stage .loading=${!this._dataIsFullyLoaded} .highPadding=${true} .presenting=${this._presentationMode} .dataIsFullyLoaded=${this._dataIsFullyLoaded} .cardModificationsPending=${this._cardModificationsPending} .editing=${this._editing} .pendingSave=${this._displayCardPendingSave} .hideActions=${this._hideActions} .mobile=${this._mobileMode} .card=${this._displayCard} .expandedReferenceBlocks=${this._cardReferenceBlocks} .suggestedConcepts=${this._suggestedConcepts || []} .updatedFromContentEditable=${this._updatedFromContentEditable} @editable-card-field-updated=${this._handleTextFieldUpdated} @card-swiped=${this._handleCardSwiped} @disabled-card-highlight-clicked=${this._handleDisabledCardHighlightClicked}>
				<div slot='actions' class='presentation'>
					<button class='round ${this._presentationMode ? 'selected' : ''}' ?hidden='${this._mobileMode}' @click=${this._handlePresentationModeClicked}>${FULL_SCREEN_ICON}</button>
				</div>
				<div slot='actions' class='panels'>
					<button class='round ${this._cardsDrawerPanelOpen ? 'selected' : ''}' @click=${this._handleCardsDrawerClicked}>${VIEW_DAY_ICON}</button>
					<button class='round ${this._commentsAndInfoPanelOpen ? 'selected' : ''} ${(this._card?.thread_count || 0) > 0 ? 'primary' : ''}' @click='${this._handleCommentsOrInfoPanelClicked}'>${FORUM_ICON}</button>
					<button class='round ${this._commentsAndInfoPanelOpen ? 'selected' : ''}' @click='${this._handleCommentsOrInfoPanelClicked}'>${INFO_ICON}</button>
				</div>
				${collectionComposerEnabled() ? html`<div slot='actions' class='collection-mobile'>
					<button
						class='round'
						title='Compose collection'
						aria-label='Compose collection'
						@click=${this._handleConfigureCollectionClicked}
					>${RULE_ICON}</button>
				</div>` : ''}
				<div slot='actions' class='modify'>
					<button class='round' @click=${this._handleFindClicked}>${SEARCH_ICON}</button>
					<!-- Titles on wrappers, and a reason for the disabled state:
					these three were ?disabled with the explanation either ON the
					button (invisible in Chrome/Safari, which suppress hover on
					disabled controls) or missing entirely. -->
					<span class='reason' title=${this._collectionIsFallback ? 'Not available while showing placeholder content' : 'Add to your reading list'}>
						<button ?disabled=${this._collectionIsFallback} class='round ${this._cardInReadingList ? 'selected' : ''} ${this._userMayModifyReadingList ? '' : 'need-signin'}' aria-label=${this._cardInReadingList ? 'Remove from your reading list' : 'Add to your reading list'} aria-pressed=${this._cardInReadingList ? 'true' : 'false'} @click='${this._handleReadingListClicked}'>${this._cardInReadingList ? PLAYLISLT_ADD_CHECK_ICON : PLAYLIST_ADD_ICON }</button>
					</span>
					<span class='reason' title=${this._collectionIsFallback ? 'Not available while showing placeholder content' : this._cardHasStar ? 'Remove star' : 'Star this card'}>
						<button ?disabled=${this._collectionIsFallback} class='round ${this._cardHasStar ? 'selected' : ''} ${this._userMayStar ? '' : 'need-signin'}' aria-label=${this._cardHasStar ? 'Remove star' : 'Star this card'} aria-pressed=${this._cardHasStar ? 'true' : 'false'} @click='${this._handleStarClicked}'>${this._cardHasStar ? STAR_ICON : STAR_BORDER_ICON }</button>
					</span>
					<span class='reason' title=${this._collectionIsFallback ? 'Not available while showing placeholder content' : this._cardIsRead ? 'Mark unread' : 'Mark read'}>
						<button ?disabled=${this._collectionIsFallback} class='round ${this._cardIsRead ? 'selected' : ''} ${this._userMayMarkRead ? '' : 'need-signin'}' aria-label=${this._cardIsRead ? 'Mark unread' : 'Mark read'} aria-pressed=${this._cardIsRead ? 'true' : 'false'} @click='${this._handleReadClicked}'><div class='auto-read ${this._autoMarkReadPending ? 'pending' : ''}'></div>${VISIBILITY_ICON}</button>
					</span>
					<!-- Gated like its siblings. Forking creates a card, so it is
					     refused by the same eligibility check that gates Save
					     and the other create controls — it used to fail AFTER
					     the click with an alert instead of being disabled with
					     a reason. Title on the wrapper so it stays readable
					     while the button is disabled. -->
					<span class='reason' ?hidden='${!this._userMayForkCard}' title=${this._saveEligible ? 'Fork this card' : blockedReason(this._corpusStatus, CREATE_VERB)}><button class='round' ?disabled=${!this._saveEligible} @click='${this._handleForkClicked}'>${FILE_COPY_ICON}</button></span>
					<button class='round ${this._suggestionsForCard.length ? 'selected' : ''}' ?hidden='${!this._userMayEdit}' @click=${this._handleShowSuggestionsClicked} title='Show Suggestions'>${PSYCHOLOGY_ICON}</button>
					<!-- Title on the wrapper so it is readable while the button
					is disabled (Chrome/Safari suppress hover on disabled
					controls). -->
					<span class='reason' ?hidden='${!this._userMayEdit}' title=${this._cardModificationsPending || this._durableCardMutationPending ? 'A saved card operation is still finishing — editing reopens when it clears, or use Retry/Stop on the save indicator' : !this._saveEligible ? `Edit card (Cmd-E) — ${blockedReason(this._corpusStatus, SAVE_VERB)}` : 'Edit card (Cmd-E)'}>
						<button class='round' data-testid='edit-card' aria-label='Edit card (Cmd-E)' ?disabled=${this._cardModificationsPending || this._durableCardMutationPending} @click='${this._handleEditClicked}'>${EDIT_ICON}</button>
					</span>
				</div>
				<div slot='actions' class='next-prev'>
					<button class='round' @click=${this._handleBackClicked}>${ARROW_BACK_ICON}</button>
					<button class='round' @click=${this._handleForwardClicked}>${ARROW_FORWARD_ICON}</button>
				</div>
				<div slot='tags'>
					<tag-list .card=${this._displayCard} .hideOnEmpty=${true} .subtle=${true} .tags=${this._displayCard?.tags || []} .tagInfos=${this._tagInfos}></tag-list>
					<tag-list .hideOnEmpty=${true} .tags=${this._cardTodos} .tagInfos=${TODO_ALL_INFOS}></tag-list>
				</div>
          </card-stage>
		  <suggestions-viewer></suggestions-viewer>
          <card-editor ?data-active=${this._editing} ?data-minimized=${this._editorMinimized}></card-editor>
        </div>
		<div class='right-panel'>
        	<card-info-panel .active=${this.active}></card-info-panel>
        	<comments-panel .active=${this.active}></comments-panel>
		</div>
      </div>
    `;
	}

	_thumbnailActivatedHandler(e : ThumbnailTappedEvent) {
		if (e.detail.ctrl) {
			store.dispatch(toggleOnReadingList(e.detail.card));
		} else {
			store.dispatch(navigateToCardInCurrentCollection(e.detail.card));
		}
	}

	_handleRegenerateWordCloudClicked() {
		store.dispatch(incrementCollectionWordCloud());
	}

	_handleUpdateRenderOffset(e : UpdateRenderOffsetEvent) {
		if (this._editing) return;
		store.dispatch(updateRenderOffset(e.detail.value));
	}

	_handleCardSelected(e : CardSelectedEvent) {
		if (e.detail.selected) {
			store.dispatch(doSelectCards(e.detail.cards));
			return;
		}
		store.dispatch(unselectCards(e.detail.cards));
	}

	_handleFilterToSelectedClicked() {
		store.dispatch(navigateToCollectionWithSelected());
	}

	_handleBulkImportClicked() {
		store.dispatch(openBulkImportDialog('import'));
	}

	_handleBulkExportClicked() {
		store.dispatch(openBulkImportDialog('export'));
	}

	_handleEditClicked() {
		store.dispatch(editingStart());
	}

	_handleClearSelectionClicked() {
		store.dispatch(clearSelectedCards());
	}

	_handleAddCollectionToSelectionClicked() {
		if (!this._collection) return;
		store.dispatch(doSelectCards(this._collection.finalSortedCards.map(c => c.id)));
	}

	_handleForkClicked() {
		if (this._editing) {
			return;
		}
		if (!this._saveEligible) return;
		store.dispatch(createForkedCard(this._card));
	}

	_handleCardSwiped(e : CardSwipedEvent) {
		if (e.detail.direction == 'left') {
			this._handleForwardClicked();
		}
		if (e.detail.direction == 'right') {
			this._handleBackClicked();
		}
	}

	_handleConfigureCollectionClicked() {
		store.dispatch(openConfigureCollectionDialog());
	}

	async _handleCopyCollectionLink() {
		if (!this._collection) return;
		const url = new URL(urlForCollection(this._collection.description), window.location.origin).toString();
		try {
			await navigator.clipboard.writeText(url);
			store.dispatch(showSnackbar('Collection link copied'));
		} catch {
			store.dispatch(showSnackbar('Could not copy the collection link'));
		}
	}

	_handleAIAssistantSummaryClicked() {
		store.dispatch(summarizeCardsWithAI());
	}

	_handleAIAssistantConceptsClicked() {
		store.dispatch(missingConceptsWithAI());
	}

	_handleAIAssistantChatWithCollection() {
		store.dispatch(showCreateChatPrompt());
	}

	_handleSuggestMissingConceptsChanged(e : Event) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLInputElement)) throw new Error('not input element');
		const on = ele.checked;
		store.dispatch(turnSuggestMissingConcepts(on));
	}

	_handleShowSuggestionsClicked() {
		store.dispatch(suggestionsTogglePanel());
	}

	_handleTextFieldUpdated(e : EditabledCardFieldUpdatedEvent) {
		const shadowRoot = this.shadowRoot;
		if (!shadowRoot) throw new Error('no shadow root');
		const ele = shadowRoot.querySelector('card-editor');
		if (!ele) throw new Error('no card-editor');
		ele.textFieldUpdatedFromContentEditable(e.detail.field, e.detail.value);
	}

	_handleDisabledCardHighlightClicked(e : DisabledCardHighlightClickedEvent) {
		const shadowRoot = this.shadowRoot;
		if (!shadowRoot) throw new Error('no shadow root');
		const ele = shadowRoot.querySelector('card-editor');
		if (!ele) throw new Error('no card-editor');
		ele.disabledCardHighlightClicked(e.detail.card, e.detail.alternate);
	}

	_handleRandomizeClicked() {
		store.dispatch(randomizeCollection());
	}

	_handleCommentsOrInfoPanelClicked() {
		if (this._commentsAndInfoPanelOpen) {
			store.dispatch(closeCommentsAndInfoPanel());
		} else {
			store.dispatch(openCommentsAndInfoPanel());
		}
	}

	_handleInfoZippyClicked() {
		store.dispatch(toggleCardsDrawerInfo());
	}

	_handleCardsDrawerClicked() {
		if (this._cardsDrawerPanelOpen) {
			store.dispatch(closeCardsDrawerPanel());
		} else {
			store.dispatch(openCardsDrawerPanel());
		}
	}

	_handlePresentationModeClicked() {
		if (this._presentationMode) {
			store.dispatch(disablePresentationMode());
		} else {
			store.dispatch(enablePresentationMode());
		}
	}

	_handleMultiEditClicked() {
		store.dispatch(openMultiEditDialog());
	}

	_handleFindClicked() {
		store.dispatch(openFindDialog());
	}

	_handleBackClicked() {
		store.dispatch(navigateToPreviousCard());
	}

	_handleForwardClicked() {
		store.dispatch(navigateToNextCard());
	}

	_handleStarClicked() {
		if (!this._userMayStar) {
			store.dispatch(showNeedSignin());
			return;
		}
		if (this._cardHasStar) {
			store.dispatch(removeStar(this._card));
		} else {
			store.dispatch(addStar(this._card));
		}
	}

	_handleReadingListClicked() {
		if (!this._userMayModifyReadingList) {
			store.dispatch(showNeedSignin());
			return;
		}
		if (this._cardInReadingList) {
			store.dispatch(removeFromReadingList(this._card?.id || ''));
		} else {
			store.dispatch(addToReadingList(this._card?.id || ''));
		}
	}

	_handleReadClicked() {
		if (!this._userMayMarkRead) {
			store.dispatch(showNeedSignin());
			return;
		}
		if (this._cardIsRead) {
			store.dispatch(markUnread(this._card));
		} else {
			store.dispatch(markRead(this._card));
		}
	}

	_handleAddCard() {
		if (!this._saveEligible) return;
		store.dispatch(createCard({section: this._activeSectionId, cardType: this._cardTypeToAdd}));
	}

	_handleAddWorkingNotesCard() {
		if (!this._saveEligible) return;
		store.dispatch(createCard({cardType: 'working-notes'}));
	}

	_handleReorderCard(e : ReorderCardEvent) {
		store.dispatch(reorderCard(e.detail.card, e.detail.otherID, e.detail.isAfter));
	}

	//Debounced recompute of the active card's reference blocks. Cleared and
	//rescheduled on every state change, so rapid navigation never pays the
	//cost; it lands once the user settles on a card.
	_scheduleReferenceBlocksUpdate(cardChanged = false) {
		if (this._referenceBlocksTimeout) window.clearTimeout(this._referenceBlocksTimeout);
		const now = Date.now();
		this._referenceBlocksFirstDeferredAt = deferredWorkStartedAt(this._referenceBlocksFirstDeferredAt, now, cardChanged);
		//Fire immediately (next tick) if deferrals have been piling up past
		//the max-wait — but ONLY when the worker can serve (async,
		//off-thread). When the fallback would be the SYNCHRONOUS 1-2s local
		//computation (worker off/loading), an early fire is a mid-navigation
		//freeze — the exact jank the debounce exists to prevent — and the
		//starvation this guards against only occurs from worker-mode store
		//churn anyway.
		const overdue = deferredWorkIsOverdue(this._referenceBlocksFirstDeferredAt, now, REFERENCE_BLOCKS_MAX_WAIT_MS) && corpusWorkerCanRunCollections();
		this._referenceBlocksTimeout = window.setTimeout(() => {
			this._referenceBlocksTimeout = 0;
			this._referenceBlocksFirstDeferredAt = 0;
			//Read fresh state at fire time.
			const state = store.getState() as State;
			//While editing, compute the blocks for the LIVE editing card —
			//related cards refresh as you type, throttled by the 1s-debounced
			//normalized editing card (and by this debounce). In worker modes
			//the bridge mirrors the editing card into the worker, so the
			//compute stays off-thread.
			const editing = selectIsEditing(state);
			//Suggested in-body concept highlights ride this same debounce: the
			//selector is a cheap memoized lookup keyed on the extraction
			//version, and putting it here (rather than on the keystroke path)
			//restores master's highlights without per-keystroke work.
			this._suggestedConcepts = editing ? selectEditingCardSuggestedConceptReferences(state) : null;
			//Prefer computing the blocks in the corpus worker (off the UI
			//thread) when it holds the corpus; fall back to the synchronous
			//local computation otherwise.
			if (corpusWorkerCanRunCollections()) {
				const card = editing ? (selectEditingNormalizedCard(state) || null) : selectActiveCardEnriched(state);
				const cardID = card ? card.id : '';
				const workerPromise = expandReferenceBlocksViaRunner(
					card,
					primaryReferenceBlocksForCard(card),
					editing ? selectCollectionConstructorArgumentsWithEditingCard(state) : selectCollectionConstructorArguments(state),
					selectCardIDsUserMayEdit(state),
					corpusWorkerRunCollection
				);
				workerPromise.then(blocks => {
					if (blocks === null) {
						if (corpusWorkerServesCollections()) {
							//Commit the empty state only if this run was for
							//the STILL-active card. An unguarded commit here
							//used to clobber a newer card's correct blocks
							//and stamp them with this run's stale card id.
							if (!sectionResultCommits(cardID, selectActiveCard(store.getState() as State)?.id || '')) return;
							this._cardReferenceBlocks = [];
							this._cardReferenceBlocksForCardID = cardID;
							return;
						}
						//Worker went away mid-flight: local fallback, computed
						//from FRESH state — so label ownership with the fresh
						//card, not the captured one (a stale label makes the
						//next stateChanged clear CORRECT content).
						const fallbackState = store.getState() as State;
						this._cardReferenceBlocks = selectExpandedPrimaryReferenceBlocksForEditingOrActiveCard(fallbackState);
						this._cardReferenceBlocksForCardID = selectActiveCard(fallbackState)?.id || '';
						return;
					}
					//Drop stale results if the user navigated or toggled
					//editing meanwhile. (Same-id compare covers both modes:
					//the editing card's id IS the active card's id.)
					const freshState = store.getState() as State;
					if (selectIsEditing(freshState) !== editing) return;
					if (!sectionResultCommits(cardID, selectActiveCard(freshState)?.id || '')) return;
					this._cardReferenceBlocks = blocks;
					this._cardReferenceBlocksForCardID = cardID;
				});
				return;
			}
			//In worker-on mode, empty-until-ready is vastly safer than a
			//synchronous whole-corpus fallback while the cold worker is loading.
			//The live-status Redux update schedules this method again once the
			//worker can serve. If the worker circuit-breaks, servesCollections()
			//becomes false and the legacy fallback below remains available.
			if (corpusWorkerServesCollections()) return;
			this._cardReferenceBlocks = selectExpandedPrimaryReferenceBlocksForEditingOrActiveCard(state);
			this._cardReferenceBlocksForCardID = selectActiveCard(state)?.id || '';
		}, overdue ? 0 : REFERENCE_BLOCKS_DEBOUNCE_MS);
	}

	override stateChanged(state : State) {
		const previousCardID = this._card?.id || '';
		this._editingCard = selectEditingCardForDisplay(state);
		this._card = selectActiveCard(state);
		const activeCardChanged = previousCardID !== (this._card?.id || '');
		this._editing = selectIsEditing(state);
		//Reference blocks run ~10 key-card collections over the whole corpus
		//(~1-2s at 40k cards), so they must never compute synchronously on the
		//navigation keystroke path — schedule them for after navigation
		//settles. Blocks rendered for a DIFFERENT card are cleared right now:
		//empty-until-ready is honest; the previous card's "similar cards"
		//under the new card silently misattributes relations.
		if (this._cardReferenceBlocksForCardID && this._card && this._card.id !== this._cardReferenceBlocksForCardID) {
			this._cardReferenceBlocks = [];
			this._cardReferenceBlocksForCardID = '';
		}
		this._scheduleReferenceBlocksUpdate(activeCardChanged);
		//Use enriched card for display when not editing. While editing, avoid
		//semantic enrichment on the keystroke path and keep the active card's
		//previous NLP block only as a display fallback. Between a committed
		//single-card save and its server confirmation, prefer the optimistic
		//pending-save face over the (still-stale) active card, so the face
		//never flashes back to the pre-edit value while the save round-trips.
		const pendingSaveCard = selectPendingSaveCardForDisplay(state);
		this._displayCard = this._editingCard ? this._editingCard : (pendingSaveCard || selectActiveCardEnriched(state));
		this._displayCardPendingSave = !this._editingCard && Boolean(pendingSaveCard);
		this._pageExtra = state.app.pageExtra;
		this._cardModificationsPending = selectCardModificationPending(state);
		this._saveEligible = selectCardSavesEligible(state);
		this._corpusStatus = selectCorpusStatus(state);
		this._durableCardMutationPending = durableCardMutationPending();
		this._cardsSelected = selectCardsSelected(state);
		this._collectionNotFullySelected = selectActiveCollectionNotFullySelected(state);
		this._collectionNotFilteredToSelected = selectActiveCollectionNotFilteredToSelected(state);
		this._hideActions = selectIsEditing(state) || selectSuggestionsOpen(state);
		this._editorMinimized = selectEditorMinimized(state);
		this._signedIn = selectUserSignedIn(state);
		this._userMayStar  =  selectUserMayStar(state);
		this._userMayMarkRead =  selectUserMayMarkRead(state);
		this._userMayUseAI = selectUserMayUseAI(state);
		this._userMayModifyReadingList = selectUserMayModifyReadingList(state);
		this._autoMarkReadPending = state.user ? state.user.autoMarkReadPending : false;
		this._userMayEdit = selectUserMayEditActiveCard(state);
		this._cardTypeToAdd = selectActiveCollectionCardTypeToAdd(state);
		this._userMayAddCardToActiveCollection = selectUserMayAddCardToActiveCollection(state);
		this._userMayReorderCollection = selectUserMayReorderActiveCollection(state);
		this._userMayCreateCard = selectUserMayCreateCard(state);
		this._userMayForkCard = selectUserMayForkActiveCard(state);
		this._headerPanelOpen = state.app.headerPanelOpen;
		this._commentsAndInfoPanelOpen = selectCommentsAndInfoPanelOpen(state);
		//Note: do NOT use this for whether the panel is showing.
		this._cardsDrawerPanelOpen = state.app.cardsDrawerPanelOpen;
		this._updatedFromContentEditable = selectEditingUpdatedFromContentEditable(state);
		this._cardsDrawerPanelShowing = selectCardsDrawerPanelShowing(state);
		this._presentationMode = state.app.presentationMode;
		this._mobileMode = state.app.mobileMode;
		this._cardHasStar = getCardHasStar(state, this._card ? this._card.id : '');
		this._cardIsRead = getCardIsRead(state, this._card ? this._card.id : '');
		this._cardInReadingList = getCardInReadingList(state, this._card ? this._card.id : '');

		//Stale-while-revalidate instead of honest-empty: when the worker
		//hasn't pushed a result for the CURRENT description yet, keep showing
		//the last ready collection. For fast pushes (the common case) the
		//swap is invisible; if the wait exceeds a short grace the drawer dims
		//with an "updating" affordance, so stale content is labeled stale
		//rather than blanking the list (the original wrong-then-right hazard
		//was unlabeled stale content, not stale content per se).
		const currentCollection = selectActiveCollection(state);
		//A held stale collection must never survive an auth-scope change: on
		//sign-out it could briefly keep rendering unpublished titles that the
		//purge just removed from Redux.
		const collectionScopeUid = selectUid(state);
		if (collectionScopeUid !== this._lastCollectionScopeUid) {
			this._lastCollectionScopeUid = collectionScopeUid;
			this._lastReadyCollection = null;
			this._collectionUpdating = false;
		}
		const activeCollectionReady = !corpusWorkerServesCollections() || selectWorkerActiveCollectionReady(state);
		this._collectionPending = !activeCollectionReady;
		if (activeCollectionReady) {
			this._collection = currentCollection;
			this._lastReadyCollection = currentCollection;
			this._collectionUpdating = false;
			if (this._collectionUpdatingTimeout) {
				window.clearTimeout(this._collectionUpdatingTimeout);
				this._collectionUpdatingTimeout = 0;
			}
		} else if (this._lastReadyCollection) {
			this._collection = this._lastReadyCollection;
			if (!this._collectionUpdating && !this._collectionUpdatingTimeout) {
				this._collectionUpdatingTimeout = window.setTimeout(() => {
					this._collectionUpdatingTimeout = 0;
					this._collectionUpdating = true;
				}, COLLECTION_UPDATING_GRACE_MS);
			}
		} else {
			//Nothing ready yet this session. The transitional worker result is
			//an empty placeholder with isFallback:false, so without this the
			//drawer asserted a confident, undimmed "0 cards" for the whole
			//pre-loadComplete window — while the stage beside it said
			//"Loading…" — and then popped to 40,225. Mark it updating on the
			//same grace timer used for a description change, so the branch's
			//own dim + "updating…" affordance covers the longest wait rather
			//than only the shortest one.
			if (!this._collectionUpdating && !this._collectionUpdatingTimeout) {
				this._collectionUpdatingTimeout = window.setTimeout(() => {
					this._collectionUpdatingTimeout = 0;
					this._collectionUpdating = true;
				}, COLLECTION_UPDATING_GRACE_MS);
			}
			this._collection = currentCollection;
		}

		this._collectionIsFallback = Boolean(this._collection && this._collection.isFallback);
		this._renderOffset = selectActiveRenderOffset(state);
		this._tagInfos = selectTags(state);
		this._drawerReorderPending = state.data.pendingReorder;
		this._activeSectionId = selectActiveSectionId(state);
		//Raw cards finish installing before the worker's authoritative collection
		//result arrives. Keep the honest loading placeholder during that short gap
		//instead of flashing the false "No card by that name" error.
		this._dataIsFullyLoaded = selectDataIsFullyLoaded(state) &&
			(!corpusWorkerServesCollections() || selectWorkerActiveCollectionReady(state));
		this._sectionsAndTagsLoaded = selectSectionsAndTagsLoaded(state);
		this._cardTodos = selectActiveCardTodosForCurrentUser(state);
		this._pendingNewCardIDToNavigateTo = selectPendingNewCardIDToNavigateTo(state);
		this._infoExpanded = selectCardsDrawerInfoExpanded(state);
		this._suggestMissingConceptsEnabled = selectSuggestMissingConceptsEnabled(state);
		this._userIsAdmin = selectUserIsAdmin(state);
		this._suggestionsForCard = selectSuggestionsForActiveCard(state);
		this._suggestionsPanelOpen = selectSuggestionsOpen(state);

		if (!this._editing) this._suggestedConcepts = null;

		const lastWordCloudVersion = this._collectionWordCloudVersion;
		this._collectionWordCloudVersion = selectCollectionWordCloudVersion(state);

		//This ensures that when the collection changes, we don't show an old word cloud for the old collection.
		if (this._collectionWordCloudVersion == 0) this._collectionWordCloud = null;

		if (this._cardsDrawerPanelOpen && this._infoExpanded && lastWordCloudVersion != this._collectionWordCloudVersion) {
			//This is potentially EXTREMELY expensive so only fetch it if the
			//panel is expanded, and we just had the 'regenerate' button
			//clicked, which would have incremented the version.
			this._collectionWordCloud = selectWordCloudForMainCardDrawer(state);

			//TODO: in a perfect world we'd render the word cloud differently if
			//it was out of date or not, so it was more obvious if it needs to
			//be regenerated.
		}

	}

	override firstUpdated() {
		document.addEventListener('keydown', e => this._handleKeyDown(e));
	}

	_handleKeyDown(e : KeyboardEvent) {
		//We have to hook this to issue content editable commands when we're
		//active. But most of the time we don't want to do anything.
		//main-view historically marks this page active with a boolean attribute,
		//while PageViewElement also exposes a property. Accept both forms so the
		//document-level shortcuts work in the actually visible card view.
		if (!this.active && !this.hasAttribute('active')) return false;
		//The modal owns the keyboard while it is open. In particular, do not
		//prevent Escape before the dialog's own handler can close it.
		if (selectConfigureCollectionDialogOpen(store.getState() as State)) return false;
		if (e.key == 'Escape') {
			const activeEle = deepActiveElement();
			if (!activeEle) return false;
			if (activeEle instanceof HTMLElement) activeEle.blur();
			return killEvent(e);
		}
		if (!e.metaKey && !e.ctrlKey) return false;
		if (this._editing) return false;

		if (pressedLetter(e) == 'm') {
			//these action creators will fail if the user may not do these now.
			//While sync is still verifying, createCard refuses via
			//modifyCardFailure — which alerts. A HELD Cmd-M then produces one
			//modal per repeat for the whole verification window, the same storm
			//Round 7b removed from editingStart. Swallow the shortcut instead;
			//the drawer's buttons are disabled and carry the explanation.
			if (!this._saveEligible) return killEvent(e);
			if (e.shiftKey) {
				store.dispatch(createCard({cardType: 'working-notes'}));
			} else {
				store.dispatch(createCard({section: this._activeSectionId}));
			}
			return killEvent(e);
		} else if (pressedLetter(e) == 'k' && collectionComposerEnabled()) {
			store.dispatch(openConfigureCollectionDialog());
			return killEvent(e);
		} else if (pressedLetter(e) == 'l') {
			//Ctrl-Shift-L is a way to navigate to a URL in the web app without
			//modifying the URL bar in the browser, which will lead to a full
			//refresh.
			if (e.shiftKey) {
				if (collectionComposerEnabled()) {
					store.dispatch(openConfigureCollectionDialog());
				} else {
					store.dispatch(askForPathToNavigateTo());
				}
				return killEvent(e);
			}
			//NOTE: an old comment here warned that holding Alt composes e.key
			//away from 'r'. Measured on macOS Chrome: with Meta held, Option
			//composition is suppressed and the event arrives as key:'r'
			//(or 'R' with Shift). Every branch in this handler is behind an
			//early `if (!e.metaKey && !e.ctrlKey) return`, so the composition
			//case is unreachable — which is why comparing e.key is correct.
		} else if (pressedLetter(e) == 'r') {
			if (e.altKey) {
				if (e.shiftKey) {
					store.dispatch(navigateToRandomCard());
				} else {
					store.dispatch(randomizeCollection());
				}
				return killEvent(e);
			}
		}
	}

	_changedPropsAffectCanvasSize(changedProps : PropertyValues<this>) {
		const sizeProps = [
			'_headerPanelOpen',
			'_commentsAndInfoPanelOpen',
			'_cardsDrawerPanelShowing',
			'_editing',
			'_editorMinimized'
		] as const;
		for (const item of sizeProps) {
			if (changedProps.has(item)) return true;
		}
		return false;
	}

	_resizeCard() {
		//This is called when we've changed something that should resize the
		//card.
		const shadowRoot = this.shadowRoot;
		if (!shadowRoot) throw new Error('no shadow root');
		const stage = shadowRoot.querySelector('card-stage');
		if (!stage) return;
		stage.resizeCard();
	}

	override updated(changedProps : PropertyValues<this>) {
		if (changedProps.has('_pageExtra')) {
			if (this._pageExtra) {
				store.dispatch(updateCardSelector(this._pageExtra));
			} else if(this._sectionsAndTagsLoaded) {
				//Dispatching to '' will use default. This will fail if sections
				//aren't yet loaded; we'll try again when sections loaded.
				store.dispatch(navigateToDefaultIfSectionsAndTagsLoaded());
			}
		}
		if (changedProps.has('_sectionsAndTagsLoaded') && this._sectionsAndTagsLoaded) {
			if (!this._pageExtra) {
				//Dispatching to '' will use default. We will have also tried if
				//_pageExtra loaded when sections were already loaded
				store.dispatch(navigateToDefaultIfSectionsAndTagsLoaded());
			}
		}
		if ((changedProps.has('_pendingNewCardIDToNavigateTo') || changedProps.has('_dataIsFullyLoaded')) && this._dataIsFullyLoaded && this._pendingNewCardIDToNavigateTo) {
			store.dispatch(navigateToNewCard());
		}
		if (changedProps.has('_editing') && !this._editing) {
			//Verify that our URL shows the canoncial name, which may have just
			//changed when edited.
			store.dispatch(canonicalizeURL());
		}
		if ((changedProps.has('_userMayEdit') && this._userMayEdit) || (changedProps.has('_userMayCreateCard') && this._userMayCreateCard)) {
			keepSlugLegalWarm();
		}
		if (changedProps.has('_card') && this._card && this._card.name) {
			store.dispatch(canonicalizeURL());
		}
		if (changedProps.has('_card') || changedProps.has('_dataIsFullyLoaded')) {
			if (this._card && this._dataIsFullyLoaded) store.dispatch(calculateSuggestionsForActiveCard());
		} 
		if (changedProps.has('_activeSectionId')) {
			store.dispatch(canonicalizeURL());
		}
		//Promise.resolve().then() timing doesn't wait long enough; on stable
		//channel Chrome  by the time it fires layout hasn't been done.

		if (this._changedPropsAffectCanvasSize(changedProps)) window.setTimeout(() => this._resizeCard(), 0);

	}
}

declare global {
	interface HTMLElementTagNameMap {
		'card-view': CardView;
	}
}
