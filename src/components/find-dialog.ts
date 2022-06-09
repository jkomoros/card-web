import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import find from '../reducers/find.js';
store.addReducers({
	find
});

import {
	closeFindDialog,
	updateQuery,
	findUpdateCardTypeFilter,
	findUpdateSortByRecent,
	findUpdateRenderOffset
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
	selectFindLegalCardTypeFilters,
	selectFindCardTypeFilter,
	selectFindCardTypeFilterLocked,
	selectFindReferencing,
	selectEditingPendingReferenceType,
	selectCollectionDescriptionForQuery,
	selectFindPermissions,
	selectFindLinking,
	selectFindSortByRecent,
	selectFindRenderOffset
} from '../selectors.js';

import { 
	PLUS_ICON,
	LINK_ICON,
	LINK_OFF_ICON,
	OPEN_IN_BROWSER_ICON
} from './my-icons.js';

import {
	REFERENCE_TYPES,
	DEFAULT_CARD_TYPE,
	editableFieldsForCardType,
	CARD_TYPE_CONFIGURATION,
} from '../card_fields.js';

import {
	TEXT_FIELD_TITLE,
} from '../card_field_constants.js';

import {
	UNION_FILTER_DELIMITER
} from '../filters.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import './card-drawer.js';

import { 
	newID, 
	capitalizeFirstLetter
} from '../util.js';

import {
	CardType,
	ReferenceType,
	State
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
	_collection: Collection;

	@state()
	_renderOffset: number;

	@state()
	_linking: boolean;

	@state()
	_permissions: boolean;

	@state()
	_referencing: boolean;

	@state()
	_pendingReferenceType: ReferenceType;

	@state()
	_userMayCreateCard: boolean;

	@state()
	_legalCardTypeFilters: CardType[];
	
	@state()
	_cardTypeFilter: CardType;

	@state()
	_sortByRecent: boolean;

	@state()
	_collectionDescription: CollectionDescription;

	@state()
	_cardTypeFilterLocked: boolean;

	static override styles = [
		...DialogElement.styles,
		ButtonSharedStyles,
		css`
			card-drawer {
				font-size:14px;
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
		`
	];

	override innerRender() {

		const isLink = savedSelectionRangeIsLink();

		return html`
		<form @submit=${this._handleFormSubmitted}>
			<div>
				${this._legalCardTypeFilters.length > 1 ? html`<span>Card type:</span>
					${this._legalCardTypeFilters.map(typ => html`<input type='radio' name='card-type' .disabled=${this._cardTypeFilterLocked} @change=${this._handleCardTypeChanged} .checked=${this._cardTypeFilter === typ} .title=${CARD_TYPE_CONFIGURATION[typ] ? CARD_TYPE_CONFIGURATION[typ].description : 'All card types'} value='${typ}' id='card-type-${typ}'><label for='card-type-${typ}' .title=${CARD_TYPE_CONFIGURATION[typ] ? CARD_TYPE_CONFIGURATION[typ].description : 'All card types'}>${typ || html`<em>Default</em>`}</label>`)}
				` : ''}
				<input type='checkbox' .checked=${this._sortByRecent} id='sort-by-recent' @change=${this._handleSortByRecentChanged}><label for='sort-by-recent'>Sort by Recent</label>
			</div>
			<div class='row'>
				<input placeholder='Text to search for' id='query' type='search' @input=${this._handleQueryChanged} .value=${this._query}></input>
				<button title='Navigate to this collection' @click=${this._handleNavigateCollection} class='small'>${OPEN_IN_BROWSER_ICON}</button>
			</div>
		</form>
		<card-drawer showing grid @thumbnail-tapped=${this._handleThumbnailTapped} .collection=${this._collection} .renderOffset=${this._renderOffset} @update-render-offset=${this._handleUpdateRenderOffset}></card-drawer>
		<div ?hidden=${!this._linking && !this._referencing} class='add'>
			<div ?hidden=${!this._linking}>
				<button ?hidden=${!isLink} class='round' @click='${this._handleRemoveLink}' title='Remove the current link'>${LINK_OFF_ICON}</button>
				<button class='round' @click='${this._handleAddLink}' title='Link to a URL, not a card'>${LINK_ICON}</button>
			</div>
			<button class='round' @click='${this._handleAddSlide}' title=${'Create a new stub card to link to of type ' + this._cardTypeToAdd} ?hidden=${!this._userMayCreateCard}>${PLUS_ICON}</button>
		</div>
	`;
	}

	constructor() {
		super();
		this.title = this._computedTitle;
		this._legalCardTypeFilters = [];
	}

	override _shouldClose(cancelled : boolean = false) {
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
		store.dispatch(navigateToCollection(this._collectionDescription));
		this._shouldClose();
	}

	_handleQueryChanged(e : InputEvent) {
		let ele = e.composedPath()[0];
		if (!(ele instanceof HTMLInputElement)) return;
		store.dispatch(updateQuery(ele.value));
	}

	_handleSortByRecentChanged(e : Event) {
		const ele = e.target;
		if (!(ele instanceof HTMLInputElement)) return;
		store.dispatch(findUpdateSortByRecent(ele.checked));
	}

	_handleCardTypeChanged(e : Event) {
		const ele = e.target;
		if (!(ele instanceof HTMLInputElement)) return;
		const filter = ele.value;
		store.dispatch(findUpdateCardTypeFilter(filter));
	}

	_handleAddLink() {
		let href = prompt('Where should the URL point?', this._query);
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

		const cardType = this._cardTypeToAdd;

		const needTitle = editableFieldsForCardType(cardType)[TEXT_FIELD_TITLE];
		let title = '';
		if (needTitle) {
			const query = this._query || '';
			title = prompt('What should the title be?', capitalizeFirstLetter(query.trim()));
			if (!title || !title.trim()) {
				console.warn('No title provided');
				return;
			}
		}
		const id = newID();
		const opts = {
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
		this._shouldClose();
		if (this._linking) {
			store.dispatch(linkCard(e.detail.card));
			return;
		}
		if (this._permissions) {
			store.dispatch(setCardToAddPermissionTo(e.detail.card));
			return;
		}
		if (this._referencing) {
			store.dispatch(setCardToReference(e.detail.card));
			return;
		}
		store.dispatch(navigateToCardInCurrentCollection(e.detail.card));
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
		return 'Search';
	}

	override updated(changedProps : Map<string, any>) {
		if (changedProps.has('open') && this.open) {
			//When first opened, select the text in query, so if the starter
			//query is wrong as you long keep typing it will be no cost
			
			const ele = this.shadowRoot.getElementById('query') as HTMLInputElement;
			ele.select();
		}
		if (changedProps.has('_linking') || changedProps.has('_referencing') || changedProps.has('_permissions')) {
			this.title = this._computedTitle;
		}
	}

	override stateChanged(state : State) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = state.find.open;
		this.mobile = state.app.mobileMode;
		this._query = state.find.query;
		//coalling the collection into being is expensive so only do it if we're open.
		this._collection = this.open ? selectCollectionForQuery(state) : null;
		this._collectionDescription = this.open ? selectCollectionDescriptionForQuery(state) : null;
		this._renderOffset = selectFindRenderOffset(state);
		this._linking = selectFindLinking(state);
		this._permissions = selectFindPermissions(state);
		this._referencing = selectFindReferencing(state);
		this._pendingReferenceType = selectEditingPendingReferenceType(state);
		this._userMayCreateCard = selectUserMayCreateCard(state);
		this._legalCardTypeFilters = selectFindLegalCardTypeFilters(state);
		this._cardTypeFilter = selectFindCardTypeFilter(state);
		this._cardTypeFilterLocked = selectFindCardTypeFilterLocked(state);
		this._sortByRecent = selectFindSortByRecent(state);
	}

}

declare global {
	interface HTMLElementTagNameMap {
	  'find-dialog': FindDialog;
	}
}
