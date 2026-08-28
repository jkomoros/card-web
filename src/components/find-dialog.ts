import {
	blockedReason,
	CREATE_VERB
} from '../sync-copy.js';

import { html, css, PropertyValues } from 'lit';

import './loading-placeholder.js';
import { customElement, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import {
	corpusWorkerServesCollections
} from '../corpus-mode.js';

import { DialogElement } from './dialog-element.js';

import find from '../reducers/find.js';
store.addReducers({
	find
});

import {
	closeFindDialog,
	setCardToConfigure,
	updateQuery,
	findUpdateCardTypeFilter,
	findUpdateSortByRecent,
	findUpdateRenderOffset,
	updateStickySearchFiltersEnabled
} from '../actions/find.js';

import {
	navigateToCardInCurrentCollection, 
	navigateToCollection
} from '../actions/app.js';

import {
	linkCard,
	linkURL,
	cancelLink,
	savedSelectionRangeIsLink,
	setCardToReference,
} from '../actions/editor.js';

import {
	createCard
} from '../actions/data.js';

import {
	setCardToAddPermissionTo
} from '../actions/permissions.js';

import {
	selectCollectionForQuery,
	selectUserMayCreateCard,
	selectCardSavesEligible,
	selectCorpusStatus,
	selectFindLegalCardTypeFilters,
	selectFindCardTypeFilter,
	selectFindCardTypeFilterLocked,
	selectFindReferencing,
	selectFindConfiguring,
	selectEditingPendingReferenceType,
	selectCollectionDescriptionForQuery,
	selectFindPermissions,
	selectFindLinking,
	selectFindSortByRecent,
	selectFindStickyFiltersEnabled,
	selectFindStickyFiltersExpression,
	selectFindSearchPreparing,
	selectWorkerQueryCollectionReady,
	selectIsEditing,
	selectFindRenderOffset,
	selectFindDialogOpen,
} from '../selectors.js';

import { 
	PLUS_ICON,
	LINK_ICON,
	LINK_OFF_ICON,
	OPEN_IN_BROWSER_ICON
} from '../../shared/icons.js';

import {
	REFERENCE_TYPES,
	DEFAULT_CARD_TYPE,
	editableFieldsForCardType,
	CARD_TYPE_CONFIGURATION,
} from '../../shared/card_fields.js';

import {
	UNION_FILTER_DELIMITER
} from '../filters.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import './card-drawer.js';
import './limit-warning.js';

import { 
	newID, 
	capitalizeFirstLetter
} from '../util.js';

import {
	CardID,
	CardType,
	CreateCardOpts,
	ReferenceType,
	State,
	CorpusStatus,
} from '../types.js';

import {
	Collection, CollectionDescription
} from '../collection_description.js';

import {
	ThumbnailTappedEvent,
	UpdateRenderOffsetEvent
} from '../events.js';

@customElement('find-dialog')
class FindDialog extends connect(store)(DialogElement) {

	@state()
		_query: string;

	@state()
		_collection: Collection | null;

	@state()
		_searchPreparing: {built : number, total : number} | null;

	@state()
		_collectionUpdating: boolean;
	_lastReadyCollection: Collection | null = null;
	_collectionUpdatingTimeout = 0;

	@state()
		_renderOffset: number;

	@state()
		_linking: boolean;

	@state()
		_permissions: boolean;

	@state()
		_referencing: boolean;

	//The collection composer picking the card a card-valued filter names. It is
	//a PICKER like linking and permissions: no stub-card affordance, because a
	//filter that names a card nobody has written yet matches nothing.
	@state()
		_configuring: boolean;

	//The card the keyboard is pointing at, in picker mode. Empty until the user
	//arrows into the list, so opening the dialog does not preselect anything
	//Enter would then commit by accident.
	@state()
		_highlightedCardID: CardID = '';

	@state()
		_pendingReferenceType: ReferenceType;

	@state()
		_userMayCreateCard: boolean;

	//Creating a stub writes a card, so it is gated on the same readiness as
	//saving one. EACH needs its own @state(): a decorator applies to one field,
	//so declaring these under the one above left them non-reactive and the
	//create button never re-rendered when sync went live.
	@state()
		_saveEligible: boolean;

	@state()
		_corpusStatus: CorpusStatus;

	@state()
		_legalCardTypeFilters: CardType[];
	
	@state()
		_cardTypeFilter: string;

	@state()
		_sortByRecent: boolean;

	@state()
		_stickyFiltersEnabled: boolean;

	@state()
		_stickyFiltersExpression: string;

	@state()
		_collectionDescription: CollectionDescription | null;

	@state()
		_cardTypeFilterLocked: boolean;

	static override styles = [
		...DialogElement.styles,
		ButtonSharedStyles,
		css`
			card-drawer {
				font-size:14px;
			}

			/* Spacing only. This used to also set font-size: 0.75em, italic and
			   a colour — all three of which loading-placeholder sets itself, so
			   the size applied TWICE and the line rendered at 9px. Same defect
			   as commit 354ad2a5, in a different file: a host restating what its
			   child already says. */
			.search-preparing {
				margin: 0.25em 0;
			}

			.row {
				display: flex;
				flex-direction: row;
			}

			#query {
				border: 0 solid black;
				font-size:0.8em;
				border-bottom:1px solid var(--app-dark-text-color);
				flex-grow: 1;
			}

			.add {
				text-align:right;
				position:absolute;
				bottom: 0.5em;
				right: 0.5em;
			}

			.spacer {
				flex-grow: 1;
			}

			/* On a narrow dialog the spacer collapses and the status line ran
			   straight into the 'Sort by Recent' label with no gap at all. */
			.limit {
				margin-left: 1em;
			}
		`
	];

	override innerRender() {

		const isLink = savedSelectionRangeIsLink();

		return html`
		<form @submit=${this._handleFormSubmitted}>
			<div class='row'>
				<div>
					${this._legalCardTypeFilters.length > 1 ? html`<span>Card type:</span>
						${this._legalCardTypeFilters.map(typ => html`<input type='radio' name='card-type' .disabled=${this._cardTypeFilterLocked} @change=${this._handleCardTypeChanged} .checked=${this._cardTypeFilter === typ} .title=${CARD_TYPE_CONFIGURATION[typ]?.description || 'All card types'} value='${typ}' id='card-type-${typ}'><label for='card-type-${typ}' .title=${CARD_TYPE_CONFIGURATION[typ]?.description || 'All card types'}>${typ || html`<em>Default</em>`}</label>`)}
					` : ''}
					<input type='checkbox' .checked=${this._sortByRecent} id='sort-by-recent' @change=${this._handleSortByRecentChanged}><label for='sort-by-recent'>Sort by Recent</label>
					${!this._linking && !this._permissions && !this._referencing && !this._configuring ? html`
					<input type='checkbox' .checked=${this._stickyFiltersEnabled} id='sticky-filters' @change=${this._handleStickyFiltersChanged}><label for='sticky-filters' title=${'Only include cards matching: ' + this._stickyFiltersExpression + '. This choice is remembered on this device.'}>Only ${this._stickyFiltersExpression.replace(/\+/g, ' or ')}</label>` : ''}
				</div>
				<div class='spacer'></div>
				<div class='limit'>
						<limit-warning
							.tight=${true}
						>
						</limit-warning>
				</div>
			</div>
			<div class='row'>
				<!-- The composer's listbox idiom, in the one mode that needs it.
				     In a picker the thumbnails ARE the choices, and they were
				     reachable only by mouse: no keydown handler anywhere in this
				     file, and card-thumbnail-list's thumbnails are plain divs
				     with no tabindex, so dialog-element's own Tab cycle skips
				     them too. A keyboard user could type a query and then had
				     nowhere to go with the results. -->
				<input
					placeholder='Text to search for'
					id='query'
					type='search'
					role=${ifDefined(this._picker ? 'combobox' : undefined)}
					aria-expanded=${ifDefined(this._picker ? String(this._pickerCardIDs.length > 0) : undefined)}
					@keydown=${this._handleQueryKeyDown}
					@input=${this._handleQueryChanged}
					.value=${this._query}></input>
				<button title='Navigate to this collection' @click=${this._handleNavigateCollection} class='small'>${OPEN_IN_BROWSER_ICON}</button>
			</div>
		</form>
		${this._searchPreparing ? html`<loading-placeholder class='search-preparing' noun='the search index' .value=${this._searchPreparing.built} .total=${this._searchPreparing.total}></loading-placeholder>` : ''}
		<!-- highlightedCardId is card-drawer's existing property, and
		     card-thumbnail-list already paints the highlighted thumbnail and
		     scrolls it into view. The picker did not need a new highlight
		     mechanism; it needed to use the one that was already there.
		     (No backticks in this comment: it is inside a tagged template, and
		     one would end the template right here.) -->
		<card-drawer showing grid @thumbnail-tapped=${this._handleThumbnailTapped} .collection=${this._collection} .updating=${this._collectionUpdating} .highlightedCardId=${this._picker ? this._highlightedCardID : ''} .renderOffset=${this._renderOffset} @update-render-offset=${this._handleUpdateRenderOffset}></card-drawer>
		<!-- The highlight cannot be announced with aria-activedescendant: the
		     thumbnail it names lives two shadow roots down, and that attribute
		     does not cross shadow boundaries. A polite live region says the same
		     thing in the one place a screen reader can hear it. -->
		${this._picker ? html`<div class='visually-hidden' aria-live='polite'>${this._highlightedCardAnnouncement}</div>` : ''}
		<div ?hidden=${!this._linking && !this._referencing} class='add'>
			<div ?hidden=${!this._linking}>
				<button ?hidden=${!isLink} class='round' @click='${this._handleRemoveLink}' title='Remove the current link'>${LINK_OFF_ICON}</button>
				<button class='round' @click='${this._handleAddLink}' title='Link to a URL, not a card'>${LINK_ICON}</button>
			</div>
			<span class='reason' ?hidden=${!this._userMayCreateCard} title=${this._saveEligible ? 'Create a new stub card to link to of type ' + this._cardTypeToAdd : blockedReason(this._corpusStatus, CREATE_VERB)}><button title='Create a card' aria-label='Create a card' class='round' @click='${this._handleAddSlide}' ?disabled=${!this._saveEligible}>${PLUS_ICON}</button></span>
		</div>
	`;
	}

	constructor() {
		super();
		this.title = this._computedTitle;
		this._legalCardTypeFilters = [];
	}

	//The four picker modes, asked once. Every other test in this file spells
	//the same four flags out longhand, which is how `_configuring` came to be
	//added to some of those lists and not others.
	get _picker() : boolean {
		return this._linking || this._permissions || this._referencing || this._configuring;
	}

	get _pickerCardIDs() : CardID[] {
		return this._collection ? this._collection.finalSortedCards.map(card => card.id) : [];
	}

	get _highlightedCardAnnouncement() : string {
		if (!this._highlightedCardID) return '';
		const cards = this._collection?.finalSortedCards || [];
		const index = cards.findIndex(card => card.id === this._highlightedCardID);
		if (index < 0) return '';
		const card = cards[index];
		return `${card.title || card.name || card.id}, ${index + 1} of ${cards.length}`;
	}

	//ArrowUp/ArrowDown move the highlight, Enter picks it. Deliberately only in
	//picker mode: in the ordinary find dialog Enter is the form's own submit
	//(the link-a-URL path) and the arrows belong to the query field.
	_handleQueryKeyDown(e : KeyboardEvent) {
		if (!this._picker) return;
		//An IME composition sends keyCode 229 for every keystroke; treating one
		//as ArrowDown would move the highlight while somebody is typing kana.
		if (e.keyCode === 229) return;
		const ids = this._pickerCardIDs;
		if (!ids.length) return;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const current = ids.indexOf(this._highlightedCardID);
			//From nowhere, ArrowDown enters at the top and ArrowUp at the
			//bottom, which is what every listbox does and what the composer's
			//own suggestion list does.
			const next = current < 0 ?
				(e.key === 'ArrowDown' ? 0 : ids.length - 1) :
				(current + (e.key === 'ArrowDown' ? 1 : -1) + ids.length) % ids.length;
			this._highlightedCardID = ids[next];
			return;
		}
		if (e.key === 'Enter' && this._highlightedCardID) {
			//The form's submit handler would otherwise also see this.
			e.preventDefault();
			e.stopPropagation();
			this._pickCard(this._highlightedCardID);
		}
	}

	override _shouldClose(cancelled  = false) {
		if (cancelled && this._linking) {
			store.dispatch(cancelLink());
		}
		//Override base class.
		store.dispatch(closeFindDialog());
	}

	_handleFormSubmitted(e : SubmitEvent) {
		e.preventDefault();
		if(!this._linking) return;
		if(this._collection && this._collection.numCards > 0) return;
		if(!this._query) return;
		if(!this._query.startsWith('http')) return;
		store.dispatch(linkURL(this._query));
		this._shouldClose();
	}

	_handleUpdateRenderOffset(e : UpdateRenderOffsetEvent) {
		store.dispatch(findUpdateRenderOffset(e.detail.value));
	}

	_handleNavigateCollection() {
		if (!this._collectionDescription) return;
		store.dispatch(navigateToCollection(this._collectionDescription));
		this._shouldClose();
	}

	_handleQueryChanged(e : InputEvent) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLInputElement)) throw new Error('not input ele');
		store.dispatch(updateQuery(ele.value));
	}

	_handleSortByRecentChanged(e : Event) {
		const ele = e.target;
		if (!(ele instanceof HTMLInputElement)) throw new Error('not input ele');
		store.dispatch(findUpdateSortByRecent(ele.checked));
	}

	_handleStickyFiltersChanged(e : Event) {
		const ele = e.target;
		if (!(ele instanceof HTMLInputElement)) throw new Error('not input ele');
		store.dispatch(updateStickySearchFiltersEnabled(ele.checked));
	}

	_handleCardTypeChanged(e : Event) {
		const ele = e.target;
		if (!(ele instanceof HTMLInputElement)) throw new Error('not input ele');
		const filter = ele.value;
		store.dispatch(findUpdateCardTypeFilter(filter));
	}

	_handleAddLink() {
		const href = prompt('Where should the URL point?', this._query);
		if (!href) {
			console.warn('No href provided');
			return;
		}
		store.dispatch(linkURL(href));
		this._shouldClose();
	}

	_handleRemoveLink(){
		store.dispatch(linkURL(''));
		this._shouldClose();
	}

	get _cardTypeToAdd() : CardType {
		const cardType = this._cardTypeFilter || DEFAULT_CARD_TYPE;
		//cardTypeFilter could possibly be a union of multiple allowable card types, so use whatever the first one is.
		return cardType.split(UNION_FILTER_DELIMITER)[0] as CardType;
	}

	_handleAddSlide() {
		if (!this._linking && !this._referencing) return;
		//createCard would be refused while sync is still verifying, and the
		//link/reference below would then point at a card that was never
		//created. The button is disabled for the same reason.
		if (!this._saveEligible) return;

		const cardType = this._cardTypeToAdd;

		const needTitle = editableFieldsForCardType(cardType).title;
		let title : string | null = '';
		if (needTitle) {
			const query = this._query || '';
			title = prompt('What should the title be?', capitalizeFirstLetter(query.trim()));
			if (!title || !title.trim()) {
				console.warn('No title provided');
				return;
			}
		}
		const id = newID();
		const opts : CreateCardOpts = {
			id,
			title,
			cardType: cardType,
			noNavigate: true,
		};
		store.dispatch(createCard(opts));
		if (this._linking) {
			store.dispatch(linkCard(id));
		} else if(this._referencing) {
			store.dispatch(setCardToReference(id));
		}
		this._shouldClose();
	}

	_handleThumbnailTapped(e : ThumbnailTappedEvent) {
		this._pickCard(e.detail.card);
	}

	//ONE path for picking a card, whichever input chose it. Enter on the
	//highlighted thumbnail and a click on it have to mean the same thing, and
	//they cannot if the keyboard gets its own copy of this five-way branch.
	_pickCard(cardID : CardID) {
		this._shouldClose();
		if (this._configuring) {
			store.dispatch(setCardToConfigure(cardID));
			return;
		}
		if (this._linking) {
			store.dispatch(linkCard(cardID));
			return;
		}
		if (this._permissions) {
			store.dispatch(setCardToAddPermissionTo(cardID));
			return;
		}
		if (this._referencing) {
			store.dispatch(setCardToReference(cardID));
			return;
		}
		store.dispatch(navigateToCardInCurrentCollection(cardID));
	}

	get _computedTitle() {
		if (this._linking) {
			return 'Find card to link';
		}
		if (this._permissions) {
			return 'Find card to add permissions to';
		}
		if (this._referencing) {
			return this._pendingReferenceType ? 'Find card to reference as ' + REFERENCE_TYPES[this._pendingReferenceType].name : 'Find card to reference';
		}
		if (this._configuring) {
			return 'Find card for this filter';
		}
		return 'Search';
	}

	override updated(changedProps : PropertyValues<this>) {
		if (changedProps.has('open') && this.open) {
			//When first opened, select the text in query, so if the starter
			//query is wrong as you long keep typing it will be no cost
			
			const shadowRoot = this.shadowRoot;
			if (!shadowRoot) throw new Error('no shadowroot');
			const ele = shadowRoot.getElementById('query') as HTMLInputElement;
			ele.select();
			//A fresh picker points at nothing, so the first Enter cannot commit
			//a card left over from the last time this dialog was open.
			this._highlightedCardID = '';
		}
		if (changedProps.has('_linking') || changedProps.has('_referencing') || changedProps.has('_permissions') || changedProps.has('_configuring')) {
			this.title = this._computedTitle;
		}
	}

	override stateChanged(state : State) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectFindDialogOpen(state);
		this.mobile = state.app ? state.app.mobileMode : false;
		this._query = state.find ? state.find.query : '';
		//coalling the collection into being is expensive so only do it if we're open.
		//Stale-while-revalidate, mirroring card-view: while the worker's
		//result for the CURRENT query hasn't arrived, keep the previous
		//results visible; dim + label them after a short grace instead of
		//blanking the list on every keystroke.
		if (this.open) {
			const current = selectCollectionForQuery(state);
			const ready = !corpusWorkerServesCollections() || selectIsEditing(state) || selectWorkerQueryCollectionReady(state);
			if (ready) {
				this._collection = current;
				this._lastReadyCollection = current;
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
					}, 200);
				}
			} else {
				this._collection = current;
			}
		} else {
			this._collection = null;
			this._lastReadyCollection = null;
			this._collectionUpdating = false;
			if (this._collectionUpdatingTimeout) {
				window.clearTimeout(this._collectionUpdatingTimeout);
				this._collectionUpdatingTimeout = 0;
			}
		}
		//A highlight names a card in the list. Once the query changes that card
		//may not be in the list any more, and a highlight pointing at a card
		//nobody can see is one Enter away from picking a card the user cannot
		//even read the title of. Dropping it also puts ArrowDown back at the top
		//of the new results, which is where it belongs.
		if (this._highlightedCardID && !this._pickerCardIDs.includes(this._highlightedCardID)) this._highlightedCardID = '';
		this._collectionDescription = this.open ? selectCollectionDescriptionForQuery(state) : null;
		this._renderOffset = selectFindRenderOffset(state);
		this._linking = selectFindLinking(state);
		this._permissions = selectFindPermissions(state);
		this._referencing = selectFindReferencing(state);
		this._configuring = selectFindConfiguring(state);
		this._pendingReferenceType = selectEditingPendingReferenceType(state);
		this._userMayCreateCard = selectUserMayCreateCard(state);
		this._saveEligible = selectCardSavesEligible(state);
		this._corpusStatus = selectCorpusStatus(state);
		this._legalCardTypeFilters = selectFindLegalCardTypeFilters(state);
		this._cardTypeFilter = selectFindCardTypeFilter(state);
		this._cardTypeFilterLocked = selectFindCardTypeFilterLocked(state);
		this._sortByRecent = selectFindSortByRecent(state);
		this._stickyFiltersEnabled = selectFindStickyFiltersEnabled(state);
		this._stickyFiltersExpression = selectFindStickyFiltersExpression(state);
		this._searchPreparing = this.open ? selectFindSearchPreparing(state) : null;
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'find-dialog': FindDialog;
	}
}
