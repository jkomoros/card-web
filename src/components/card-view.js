/**
@license
Copyright (c) 2018 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
Code distributed by Google as part of the polymer project is also
subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
*/

import { html } from '@polymer/lit-element';
import { PageViewElement } from './page-view-element.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import {
	selectActiveCard,
	selectActiveSectionId,
	selectFinalCollection,
	selectDataIsFullyLoaded,
	selectUserSignedIn,
	selectUserMayEdit,
	selectUserMayStar,
	selectUserMayMarkRead,
	getCardHasStar,
	getCardIsRead,
	selectTags,
	selectActiveCollectionLabels,
	selectActiveSortLabelName,
	selectCollectionItemsThatWillBeRemovedOnPendingFilterCommit,
	getCardInReadingList,
	selectUserMayModifyReadingList,
	selectCardsDrawerPanelShowing,
	selectCollectionIsFallback,
	selectEditingCard,
	selectActiveCardTodosForCurrentUser
} from '../selectors.js';

import { updateCardSelector } from '../actions/collection.js';

import {
	editingStart
} from '../actions/editor.js';

import {
	createCard,
} from '../actions/data.js';

import {
	openFindDialog
} from '../actions/find.js';

import {
	canonicalizeURL
} from '../actions/collection.js';

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
	navigateToCard,
	openCommentsPanel,
	closeCommentsPanel,
	openCardInfoPanel,
	closeCardInfoPanel,
	openCardsDrawerPanel,
	closeCardsDrawerPanel,
	enablePresentationMode,
	disablePresentationMode,
	navigateToNextCard,
	navigateToPreviousCard
} from '../actions/app.js';

//Components needed by this
import './card-drawer.js';
import './card-stage.js';
import './card-editor.js';
import './tag-list.js';
import './comments-panel.js';
import './card-info-panel.js';

import {
	TODO_ALL_INFOS
} from '../reducers/collection.js';

import {
	editIcon,
	forumIcon,
	infoIcon,
	viewDayIcon,
	fullScreenIcon,
	arrowBackIcon,
	arrowForwardIcon,
	starIcon,
	starBorderIcon,
	visibilityIcon,
	searchIcon,
	playlistAddCheckIcon,
	playlistAddIcon
} from './my-icons.js';

import {
	modifyCard,
	reorderCard
} from '../actions/data.js';

// These are the shared styles needed by this element.
import { SharedStyles } from './shared-styles.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

class CardView extends connect(store)(PageViewElement) {
	render() {
		return html`
      ${SharedStyles}
      ${ButtonSharedStyles}
      <style>
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

        card-editor {
          display:none;
        }

        card-editor[active] {
          display:block;
          width:100%;
          /*TODO: this is a total hack. I don't know why flex-grow:1 doesn't do the right thing.*/
          height: 300px;
        }

		[slot=tags] {
			display:flex;
			flex-direction: column;
			align-items: center;
		}

        card-drawer {
          border-right: 1px solid var(--app-divider-color);
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

        @keyframes autoread {
          from {
            transform: scale(1.0);
          }
          to {
            transform: scale(0.0);
          }
        }
      </style>
      <div class='container${this._editing ? ' editing' : ''} ${this._presentationMode ? 'presenting' : ''} ${this._mobileMode ? 'mobile' : ''}'>
        <card-drawer .showing=${this._cardsDrawerPanelShowing} .labels=${this._collectionLabels} .labelName=${this._collectionLabelName} @thumbnail-tapped=${this._thumbnailActivatedHandler} @reorder-card=${this._handleReorderCard} @add-card='${this._handleAddCard}' .editable=${this._userMayReorder} .collection=${this._collection} .selectedCardId=${this._card ? this._card.id : ''} .reorderPending=${this._drawerReorderPending} .collectionItemsThatWillBeRemovedOnPendingFilterCommit=${this._collectionItemsThatWillBeRemovedOnPendingFilterCommit}></card-drawer>
        <div id='center'>
			<card-stage .highPadding=${true} .presenting=${this._presentationMode} .dataIsFullyLoaded=${this._dataIsFullyLoaded} .editing=${this._editing} .mobile=${this._mobileMode} .card=${this._displayCard} .bodyFromContentEditable=${this._bodyFromContentEditable} .titleFromContentEditable=${this._titleFromContentEditable} @body-updated=${this._handleBodyUpdated} @title-updated=${this._handleTitleUpdated} @card-swiped=${this._handleCardSwiped}>
				<div slot='actions' class='presentation'>
					<button class='round ${this._presentationMode ? 'selected' : ''}' ?hidden='${this._mobileMode}' @click=${this._handlePresentationModeClicked}>${fullScreenIcon}</button>
				</div>
				<div slot='actions' class='panels'>
					<button class='round ${this._cardsDrawerPanelOpen ? 'selected' : ''}' @click=${this._handleCardsDrawerClicked}>${viewDayIcon}</button>
					<button class='round ${this._commentsPanelOpen ? 'selected' : ''} ${this._card.thread_count > 0 ? 'primary' : ''}' @click='${this._handleCommentsClicked}'>${forumIcon}</button>
					<button class='round ${this._cardInfoPanelOpen ? 'selected' : ''}' @click='${this._handleCardInfoClicked}'>${infoIcon}</button>
					<button class='round' @click=${this._handleFindClicked}>${searchIcon}</button>
				</div>
				<div slot='actions' class='modify'>
					<button title='Add to your reading list' ?disabled=${this._collectionIsFallback} class='round ${this._cardInReadingList ? 'selected' : ''} ${this._userMayModifyReadingList ? '' : 'need-signin'}' @click='${this._handleReadingListClicked}'>${this._cardInReadingList ? playlistAddCheckIcon : playlistAddIcon }</button>
					<button ?disabled=${this._collectionIsFallback} class='round ${this._cardHasStar ? 'selected' : ''} ${this._userMayStar ? '' : 'need-signin'}' @click='${this._handleStarClicked}'>${this._cardHasStar ? starIcon : starBorderIcon }</button>
					<button ?disabled=${this._collectionIsFallback} class='round ${this._cardIsRead ? 'selected' : ''} ${this._userMayMarkRead ? '' : 'need-signin'}' @click='${this._handleReadClicked}'><div class='auto-read ${this._autoMarkReadPending ? 'pending' : ''}'></div>${visibilityIcon}</button>
					<button class='round' ?hidden='${!this._userMayEdit}' @click='${this._handleEditClicked}'>${editIcon}</button>
				</div>
				<div slot='actions' class='next-prev'>
					<button class='round' @click=${this._handleBackClicked}>${arrowBackIcon}</button>
					<button class='round' @click=${this._handleForwardClicked}>${arrowForwardIcon}</button>
				</div>
				<div slot='tags'>
					<tag-list .card=${this._displayCard} .subtle=${true} .tags=${this._displayCard.tags} .tagInfos=${this._tagInfos}></tag-list>
					<tag-list .subtle=${true} .tags=${this._cardTodos} .tagInfos=${TODO_ALL_INFOS}></tag-list>
				</div>
          </card-stage>
          <card-editor ?active=${this._editing} ></card-editor>
        </div>
        <card-info-panel .active=${this.active}></card-info-panel>
        <comments-panel .active=${this.active}></comments-panel>
      </div>
    `;
	}

	static get properties() {
		return {
			_card: { type: Object },
			_editing: {type: Boolean },
			_pageExtra: {type: String},
			_userMayEdit: { type: Boolean },
			_userMayReorder: {type: Boolean},
			_userMayStar: { type: Boolean },
			_userMayMarkRead: { type: Boolean },
			_userMayModifyReadingList: { type: Boolean},
			_autoMarkReadPending : { type: Boolean},
			_displayCard: { type: Object },
			_editingCard: { type: Object },
			_commentsPanelOpen: {type: Boolean},
			_cardInfoPanelOpen: {type: Boolean},
			_cardsDrawerPanelOpen: {type:Boolean},
			_cardsDrawerPanelShowing: {type: Boolean},
			_headerPanelOpen: {type: Boolean},
			_bodyFromContentEditable: {type:Boolean},
			_titleFromContentEditable: {type:Boolean},
			_presentationMode: {type:Boolean},
			_mobileMode: {type: Boolean},
			_cardHasStar: {type: Boolean},
			_cardIsRead: {type: Boolean},
			_cardInReadingList: {type: Boolean},
			_collection: {type: Array},
			_collectionIsFallback: {type:Boolean},
			_collectionLabels: {type:Array},
			_collectionLabelName: {type:String},
			_collectionItemsThatWillBeRemovedOnPendingFilterCommit: {type:Object},
			_drawerReorderPending : {type: Boolean},
			_activeSectionId: {type: String},
			_dataIsFullyLoaded: {type:Boolean},
			_tagInfos: {type:Object},
			_cardTodos: {type: Array},
		};
	}

	modifyTitle() {
		let title = prompt('What should the new title be for this card?', this._card.title);
		if (!title) return;
		store.dispatch(modifyCard(this._card, {title:title}, false));
	}

	_thumbnailActivatedHandler(e) {
		let ele = e.composedPath()[0];
		if (e.detail.ctrl) {
			store.dispatch(toggleOnReadingList(e.detail.card));
		} else {
			store.dispatch(navigateToCard(ele.name || ele.id));
		}
	}

	_handleEditClicked(e) {
		if (this._editing) {
			return this._handleCloseEditor(e);
		}
		store.dispatch(editingStart());
	}

	_handleCardSwiped(e) {
		if (e.detail.direction == 'left') {
			this._handleForwardClicked(e);
		}
		if (e.detail.direction == 'right') {
			this._handleBackClicked(e);
		}
	}

	_handleBodyUpdated(e) {
		this.shadowRoot.querySelector('card-editor').bodyUpdatedFromContentEditable(e.detail.html);
	}

	_handleTitleUpdated(e) {
		this.shadowRoot.querySelector('card-editor').titleUpdatedFromContentEditable(e.detail.text);
	}

	_handleCommentsClicked() {
		if (this._commentsPanelOpen) {
			store.dispatch(closeCommentsPanel());
		} else {
			store.dispatch(openCommentsPanel());
		}
	}

	_handleCardInfoClicked() {
		if (this._cardInfoPanelOpen) {
			store.dispatch(closeCardInfoPanel());
		} else {
			store.dispatch(openCardInfoPanel());
		}
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
			store.dispatch(removeFromReadingList(this._card));
		} else {
			store.dispatch(addToReadingList(this._card));
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
		store.dispatch(createCard({section: this._activeSectionId}));
	}

	_handleReorderCard(e) {
		store.dispatch(reorderCard(e.detail.card, e.detail.index));
	}

	stateChanged(state) {
		this._editingCard = selectEditingCard(state);
		this._card = selectActiveCard(state) || {};
		this._displayCard = this._editingCard ? this._editingCard : this._card;
		this._pageExtra = state.app.pageExtra;
		this._editing = state.editor.editing; 
		this._signedIn = selectUserSignedIn(state);
		this._userMayStar  =  selectUserMayStar(state);
		this._userMayMarkRead =  selectUserMayMarkRead(state);
		this._userMayModifyReadingList = selectUserMayModifyReadingList(state);
		this._autoMarkReadPending = state.user.autoMarkReadPending;
		this._userMayEdit = selectUserMayEdit(state);
		this._userMayReorder = selectUserMayEdit(state) && selectActiveSectionId(state) != '';
		this._headerPanelOpen = state.app.headerPanelOpen;
		this._commentsPanelOpen = state.app.commentsPanelOpen;
		this._cardInfoPanelOpen = state.app.cardInfoPanelOpen;
		//Note: do NOT use this for whether the panel is showing.
		this._cardsDrawerPanelOpen = state.app.cardsDrawerPanelOpen;
		this._bodyFromContentEditable = state.editor.bodyFromContentEditable;
		this._titleFromContentEditable = state.editor.titleFromContentEditable;
		this._cardsDrawerPanelShowing = selectCardsDrawerPanelShowing(state);
		this._presentationMode = state.app.presentationMode;
		this._mobileMode = state.app.mobileMode;
		this._cardHasStar = getCardHasStar(state, this._card ? this._card.id : '');
		this._cardIsRead = getCardIsRead(state, this._card ? this._card.id : '');
		this._cardInReadingList = getCardInReadingList(state, this._card ? this._card.id : '');
		this._collection = selectFinalCollection(state);
		this._collectionIsFallback = selectCollectionIsFallback(state);
		this._collectionLabels = selectActiveCollectionLabels(state);
		this._collectionLabelName = selectActiveSortLabelName(state);
		this._collectionItemsThatWillBeRemovedOnPendingFilterCommit = selectCollectionItemsThatWillBeRemovedOnPendingFilterCommit(state);
		this._tagInfos = selectTags(state);
		this._drawerReorderPending = state.data.reorderPending;
		this._activeSectionId = selectActiveSectionId(state);
		this._dataIsFullyLoaded = selectDataIsFullyLoaded(state);
		this._cardTodos = selectActiveCardTodosForCurrentUser(state);
	}

	_changedPropsAffectCanvasSize(changedProps) {
		let sizeProps = [
			'_headerPanelOpen',
			'_commentsPanelOpen',
			'_cardInfoPanelOpen',
			'_cardsDrawerPanelShowing',
			'_editing'
		];
		for (let item of sizeProps) {
			if (changedProps.has(item)) return true;
		}
		return false;
	}

	_resizeCard() {
		//This is called when we've changed something that should resize the
		//card.
		let stage = this.shadowRoot.querySelector('card-stage');
		if (!stage) return;
		stage.resizeCard();
	}

	updated(changedProps) {
		if (changedProps.has('_pageExtra')) {
			if (this._pageExtra) {
				store.dispatch(updateCardSelector(this._pageExtra));
			} else {
				//Dispatching to '' will use default;
				store.dispatch(navigateToCard(''));
			}
		}
		if (changedProps.has('_editing') && !this._editing) {
			//Verify that our URL shows the canoncial name, which may have just
			//changed when edited.
			store.dispatch(canonicalizeURL());
		}
		if (changedProps.has('_card') && this._card && this._card.name) {
			store.dispatch(canonicalizeURL());
		}
		if (changedProps.has('_activeSectionId')) {
			store.dispatch(canonicalizeURL());
		}
		//Promise.resolve().then() timing doesn't wait long enough; on stable
		//channel Chrome  by the time it fires layout hasn't been done.

		if (this._changedPropsAffectCanvasSize(changedProps)) window.setTimeout(() => this._resizeCard(), 0);
	}
}

window.customElements.define('card-view', CardView);
