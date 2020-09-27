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
	selectUserMayEditActiveSection,
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
	selectActiveCardTodosForCurrentUser,
	selectCommentsAndInfoPanelOpen,
	selectUserMayEditActiveCard,
	selectUserMayCreateCard,
	selectSectionsLoaded,
	selectEditingUpdatedFromContentEditable
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
	navigateToDefaultIfSectionsLoaded,
	openCardsDrawerPanel,
	closeCardsDrawerPanel,
	enablePresentationMode,
	disablePresentationMode,
	navigateToNextCard,
	navigateToPreviousCard,
	openCommentsAndInfoPanel,
	closeCommentsAndInfoPanel,
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
	PLAYLIST_ADD_ICON
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
          flex-grow: 1;
		  min-height: 300px;
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
      </style>
      <div class='container${this._editing ? ' editing' : ''} ${this._presentationMode ? 'presenting' : ''} ${this._mobileMode ? 'mobile' : ''}'>
        <card-drawer .showing=${this._cardsDrawerPanelShowing} .labels=${this._collectionLabels} .labelName=${this._collectionLabelName} @thumbnail-tapped=${this._thumbnailActivatedHandler} @reorder-card=${this._handleReorderCard} @add-card='${this._handleAddCard}' .editable=${this._userMayEditActiveSection} .suppressAdd=${!this._userMayCreateCard} .collection=${this._collection} .selectedCardId=${this._card ? this._card.id : ''} .reorderPending=${this._drawerReorderPending} .collectionItemsToGhost=${this._collectionItemsThatWillBeRemovedOnPendingFilterCommit}></card-drawer>
        <div id='center'>
			<card-stage .highPadding=${true} .presenting=${this._presentationMode} .dataIsFullyLoaded=${this._dataIsFullyLoaded} .editing=${this._editing} .mobile=${this._mobileMode} .card=${this._displayCard} .updatedFromContentEditable=${this._updatedFromContentEditable} @text-field-updated=${this._handleTextFieldUpdated} @card-swiped=${this._handleCardSwiped}>
				<div slot='actions' class='presentation'>
					<button class='round ${this._presentationMode ? 'selected' : ''}' ?hidden='${this._mobileMode}' @click=${this._handlePresentationModeClicked}>${FULL_SCREEN_ICON}</button>
				</div>
				<div slot='actions' class='panels'>
					<button class='round ${this._cardsDrawerPanelOpen ? 'selected' : ''}' @click=${this._handleCardsDrawerClicked}>${VIEW_DAY_ICON}</button>
					<button class='round ${this._commentsAndInfoPanelOpen ? 'selected' : ''} ${this._card.thread_count > 0 ? 'primary' : ''}' @click='${this._handleCommentsOrInfoPanelClicked}'>${FORUM_ICON}</button>
					<button class='round ${this._commentsAndInfoPanelOpen ? 'selected' : ''}' @click='${this._handleCommentsOrInfoPanelClicked}'>${INFO_ICON}</button>
				</div>
				<div slot='actions' class='modify'>
					<button class='round' @click=${this._handleFindClicked}>${SEARCH_ICON}</button>
					<button title='Add to your reading list' ?disabled=${this._collectionIsFallback} class='round ${this._cardInReadingList ? 'selected' : ''} ${this._userMayModifyReadingList ? '' : 'need-signin'}' @click='${this._handleReadingListClicked}'>${this._cardInReadingList ? PLAYLISLT_ADD_CHECK_ICON : PLAYLIST_ADD_ICON }</button>
					<button ?disabled=${this._collectionIsFallback} class='round ${this._cardHasStar ? 'selected' : ''} ${this._userMayStar ? '' : 'need-signin'}' @click='${this._handleStarClicked}'>${this._cardHasStar ? STAR_ICON : STAR_BORDER_ICON }</button>
					<button ?disabled=${this._collectionIsFallback} class='round ${this._cardIsRead ? 'selected' : ''} ${this._userMayMarkRead ? '' : 'need-signin'}' @click='${this._handleReadClicked}'><div class='auto-read ${this._autoMarkReadPending ? 'pending' : ''}'></div>${VISIBILITY_ICON}</button>
					<button class='round' ?hidden='${!this._userMayEdit}' @click='${this._handleEditClicked}'>${EDIT_ICON}</button>
				</div>
				<div slot='actions' class='next-prev'>
					<button class='round' @click=${this._handleBackClicked}>${ARROW_BACK_ICON}</button>
					<button class='round' @click=${this._handleForwardClicked}>${ARROW_FORWARD_ICON}</button>
				</div>
				<div slot='tags'>
					<tag-list .card=${this._displayCard} .hideOnEmpty=${true} .subtle=${true} .tags=${this._displayCard.tags} .tagInfos=${this._tagInfos}></tag-list>
					<tag-list .hideOnEmpty=${true} .tags=${this._cardTodos} .tagInfos=${TODO_ALL_INFOS}></tag-list>
				</div>
          </card-stage>
          <card-editor ?active=${this._editing} ></card-editor>
        </div>
		<div class='right-panel'>
        	<card-info-panel .active=${this.active}></card-info-panel>
        	<comments-panel .active=${this.active}></comments-panel>
		</div>
      </div>
    `;
	}

	static get properties() {
		return {
			_card: { type: Object },
			_editing: {type: Boolean },
			_pageExtra: {type: String},
			_userMayEdit: { type: Boolean },
			_userMayEditActiveSection: {type: Boolean},
			_userMayCreateCard: { type: Boolean },
			_userMayStar: { type: Boolean },
			_userMayMarkRead: { type: Boolean },
			_userMayModifyReadingList: { type: Boolean},
			_autoMarkReadPending : { type: Boolean},
			_displayCard: { type: Object },
			_editingCard: { type: Object },
			_commentsAndInfoPanelOpen : {type: Object},
			_cardsDrawerPanelOpen: {type:Boolean},
			_cardsDrawerPanelShowing: {type: Boolean},
			_headerPanelOpen: {type: Boolean},
			_updatedFromContentEditable: {type: Object},
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
			_sectionsLoaded: {type:Boolean},
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
		if (e.detail.ctrl) {
			store.dispatch(toggleOnReadingList(e.detail.card));
		} else {
			store.dispatch(navigateToCard(e.detail.card));
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

	_handleTextFieldUpdated(e) {
		this.shadowRoot.querySelector('card-editor').textFieldUpdatedFromContentEditable(e.detail.field, e.detail.value);
	}

	_handleCommentsOrInfoPanelClicked() {
		if (this._commentsAndInfoPanelOpen) {
			store.dispatch(closeCommentsAndInfoPanel());
		} else {
			store.dispatch(openCommentsAndInfoPanel());
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
		this._userMayEdit = selectUserMayEditActiveCard(state);
		this._userMayEditActiveSection = selectUserMayEditActiveSection(state);
		this._userMayCreateCard = selectUserMayCreateCard(state);
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
		this._collection = selectFinalCollection(state);
		this._collectionIsFallback = selectCollectionIsFallback(state);
		this._collectionLabels = selectActiveCollectionLabels(state);
		this._collectionLabelName = selectActiveSortLabelName(state);
		this._collectionItemsThatWillBeRemovedOnPendingFilterCommit = selectCollectionItemsThatWillBeRemovedOnPendingFilterCommit(state);
		this._tagInfos = selectTags(state);
		this._drawerReorderPending = state.data.reorderPending;
		this._activeSectionId = selectActiveSectionId(state);
		this._dataIsFullyLoaded = selectDataIsFullyLoaded(state);
		this._sectionsLoaded = selectSectionsLoaded(state);
		this._cardTodos = selectActiveCardTodosForCurrentUser(state);
	}

	_changedPropsAffectCanvasSize(changedProps) {
		let sizeProps = [
			'_headerPanelOpen',
			'_commentsAndInfoPanelOpen',
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
			} else if(this._sectionsLoaded) {
				//Dispatching to '' will use default. This will fail if sections
				//aren't yet loaded; we'll try again when sections loaded.
				store.dispatch(navigateToDefaultIfSectionsLoaded());
			}
		}
		if (changedProps.has('_sectionsLoaded') && this._sectionsLoaded) {
			if (!this._pageExtra) {
				//Dispatching to '' will use default. We will have also tried if
				//_pageExtra loaded when sections were already loaded
				store.dispatch(navigateToDefaultIfSectionsLoaded());
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
