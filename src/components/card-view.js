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
  selectRequestedCard,
  selectExpandedActiveCollection,
  selectDataIsFullyLoaded,
  selectUserSignedIn,
  selectUserMayEdit,
  selectUserMayStar,
  selectUserMayMarkRead,
  getCardHasStar,
  getCardIsRead,
} from '../selectors.js';

import { updateCardSelector } from '../actions/collection.js'

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
  showNeedSignin
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
import './card-renderer.js';
import './card-drawer.js';
import './card-editor.js';
import './comments-panel.js';
import './card-info-panel.js';

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
  screenRotationIcon
} from './my-icons.js';

import {
  modifyCard,
  reorderCard
} from '../actions/data.js';

import comments from '../reducers/comments.js';
store.addReducers({
  comments,
});

import {
  cardsDrawerPanelShowing
} from '../reducers/app.js';

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

        #canvas {
          flex-grow: 1;
          display:flex;
          flex-direction:column;
          justify-content:center;
          align-items: center;
          background-color: var(--canvas-color);
        }

        .presenting #canvas {
          background-color: var(--app-dark-text-color);
        }

        .presenting {
          --shadow-color:#444;
          /* have to redefine it because it uses the variables at the site where it's derived */
          --card-shadow: var(--card-shadow-first-part) var(--shadow-color);
        }

        .presenting .actions {
          position:absolute;
          bottom:0.5em;
          right:0.5em;
          display:flex;
          flex-direction:column;
          opacity: 0.3;
          transition: opacity var(--transition-fade);
        }

        .presenting .actions:hover {
          opacity:1.0;
        }


        .presenting .actions > div {
          display:flex;
          flex-direction: column;
        }

        .actions{
          /* This is a hack to allow the information/edit buttons to be on top of a section-head-card container. See #44. */
          z-index: 1;
          display:flex;
          flex-direction:row;
        }

        .actions .next-prev {
          display:none;
        }

        .presenting .actions .next-prev {
          display:flex;
        }

        .presenting .actions .panels {
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

        card-drawer {
          border-right: 1px solid var(--app-divider-color);
        }

        card-renderer {
          font-size:22px;
        }

        .editing card-renderer {
          font-size:16px;
        }

        .container.editing .actions {
          display:none;
        }

        [hidden] {
          display:none;
        }

        card-renderer {
          /* this will be overridden via an explicit property set directly on card-renderer */
          font-size:20px;
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

        #portrait-message {
          display:none;
        }

        #portrait-message > div {
          margin:5em;
        }

        #portrait-message svg {
          fill: var(--app-light-text-color);
          height:36px;
          width: 36px;
        }

        @media (orientation:portrait) {

          .mobile #portrait-message {
            position:absolute;
            height:100%;
            width:100%;
            background-color:#000000CC;
            color: var(--app-light-text-color);
            font-size:24px;
            display:flex;
            flex-direction:column;
            justify-content:center;
            align-items: center;
            /* needs to be at least one above the z-index for actions */
            z-index:2;
            text-align:center;
          }

        }

      </style>
      <div class='container${this._editing ? ' editing' : ''} ${this._presentationMode ? 'presenting' : ''} ${this._mobileMode ? 'mobile' : ''}'>
        <card-drawer .showing=${this._cardsDrawerPanelShowing} @thumbnail-tapped=${this._thumbnailActivatedHandler} @reorder-card=${this._handleReorderCard} @add-card='${this._handleAddCard}' .editable=${this._userMayReorder} .collection=${this._collection} .selectedCardId=${this._card ? this._card.id : ''} .stars=${this._stars} .reads=${this._reads} .reorderPending=${this._drawerReorderPending}></card-drawer>
        <div id='center'>
          <div id='canvas'>
            <div id='portrait-message'>
              <div>
                <div>${screenRotationIcon}</div>
                <div>Rotate your device to landscape orientation</div>
              </div>
            </div>
            <card-renderer .dataIsFullyLoaded=${this._dataIsFullyLoaded} .editing=${this._editing} .card=${this._displayCard} .bodyFromContentEditable=${this._bodyFromContentEditable} .titleFromContentEditable=${this._titleFromContentEditable} @body-updated=${this._handleBodyUpdated} @title-updated=${this._handleTitleUpdated}></card-renderer>
            <div class='actions'>
              <div class='presentation'>
                <button class='round ${this._presentationMode ? 'selected' : ''}' ?hidden='${this._mobileMode}' @click=${this._handlePresentationModeClicked}>${fullScreenIcon}</button>
              </div>
              <div class='panels'>
                <button class='round ${this._cardsDrawerPanelOpen ? 'selected' : ''}' @click=${this._handleCardsDrawerClicked}>${viewDayIcon}</button>
                <button class='round ${this._commentsPanelOpen ? 'selected' : ''} ${this._card.thread_count > 0 ? 'primary' : ''}' @click='${this._handleCommentsClicked}'>${forumIcon}</button>
                <button class='round ${this._cardInfoPanelOpen ? 'selected' : ''}' @click='${this._handleCardInfoClicked}'>${infoIcon}</button>
                <button class='round' @click=${this._handleFindClicked}>${searchIcon}</button>
              </div>
              <div class='modify'>
                <button class='round ${this._cardHasStar ? 'selected' : ''} ${this._userMayStar ? '' : 'need-signin'}' @click='${this._handleStarClicked}'>${this._cardHasStar ? starIcon : starBorderIcon }</button>
                <button class='round ${this._cardIsRead ? 'selected' : ''} ${this._userMayMarkRead ? '' : 'need-signin'}' @click='${this._handleReadClicked}'><div class='auto-read ${this._autoMarkReadPending ? 'pending' : ''}'></div>${visibilityIcon}</button>
                <button class='round' ?hidden='${!this._userMayEdit}' @click='${this._handleEditClicked}'>${editIcon}</button>
              </div>
              <div class='next-prev'>
                <button class='round' @click=${this._handleBackClicked}>${arrowBackIcon}</button>
                <button class='round' @click=${this._handleForwardClicked}>${arrowForwardIcon}</button>
              </div>
            </div>
          </div>
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
      _requestedCard: {type:String},
      _userMayEdit: { type: Boolean },
      _userMayReorder: {type: Boolean},
      _userMayStar: { type: Boolean },
      _userMayMarkRead: { type: Boolean },
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
      _collection: {type: Array},
      _stars: {type: Object},
      _reads: {type: Object},
      _drawerReorderPending : {type: Boolean},
      _activeSectionId: {type: String},
      _dataIsFullyLoaded: {type:Boolean},
    }
  }

  modifyTitle() {
    let title = prompt("What should the new title be for this card?", this._card.title);
    if (!title) return;
    store.dispatch(modifyCard(this._card, {title:title}, false));
  }

  _thumbnailActivatedHandler(e) {
    let ele = e.composedPath()[0];
    store.dispatch(navigateToCard(ele.name || ele.id));
  }

  _handleEditClicked(e) {
    if (this._editing) {
      return this._handleCloseEditor(e);
    }
    store.dispatch(editingStart())
  }

  _handleBodyUpdated(e) {
    this.shadowRoot.querySelector('card-editor').bodyUpdatedFromContentEditable(e.detail.html);
  }

  _handleTitleUpdated(e) {
    this.shadowRoot.querySelector('card-editor').titleUpdatedFromContentEditable(e.detail.text);
  }

  _handleCommentsClicked(e) {
    if (this._commentsPanelOpen) {
      store.dispatch(closeCommentsPanel());
    } else {
      store.dispatch(openCommentsPanel());
    }
  }

  _handleCardInfoClicked(e) {
    if (this._cardInfoPanelOpen) {
      store.dispatch(closeCardInfoPanel());
    } else {
      store.dispatch(openCardInfoPanel());
    }
  }

  _handleCardsDrawerClicked(e) {
    if (this._cardsDrawerPanelOpen) {
      store.dispatch(closeCardsDrawerPanel());
    } else {
      store.dispatch(openCardsDrawerPanel());
    }
  }

  _handlePresentationModeClicked(e) {
    if (this._presentationMode) {
      store.dispatch(disablePresentationMode());
    } else {
      store.dispatch(enablePresentationMode());
    }
  }

  _handleFindClicked(e) {
    store.dispatch(openFindDialog());
  }

  _handleBackClicked(e) {
    store.dispatch(navigateToPreviousCard());
  }

  _handleForwardClicked(e) {
    store.dispatch(navigateToNextCard());
  }

  _handleStarClicked(e) {
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

  _handleReadClicked(e) {
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

  _handleAddCard(e) {
    store.dispatch(createCard(this._activeSectionId));
  }

  _handleReorderCard(e) {
    store.dispatch(reorderCard(e.detail.card, e.detail.index));
  }

  stateChanged(state) {
    this._editingCard = state.editor.card;
    this._card = selectActiveCard(state) || {};
    this._displayCard = this._editingCard ? this._editingCard : this._card;
    this._pageExtra = state.app.pageExtra;
    this._requestedCard = selectRequestedCard(state);
    this._editing = state.editor.editing; 
    this._signedIn = selectUserSignedIn(state);
    this._userMayStar  =  selectUserMayStar(state);
    this._userMayMarkRead =  selectUserMayMarkRead(state);
    this._autoMarkReadPending = state.user.autoMarkReadPending;
    this._userMayEdit = selectUserMayEdit(state);
    this._userMayReorder = selectUserMayEdit(state) && selectActiveSectionId(state) != "";
    this._headerPanelOpen = state.app.headerPanelOpen;
    this._commentsPanelOpen = state.app.commentsPanelOpen;
    this._cardInfoPanelOpen = state.app.cardInfoPanelOpen;
    //Note: do NOT use this for whether the panel is showing.
    this._cardsDrawerPanelOpen = state.app.cardsDrawerPanelOpen;
    this._bodyFromContentEditable = state.editor.bodyFromContentEditable;
    this._titleFromContentEditable = state.editor.titleFromContentEditable;
    this._cardsDrawerPanelShowing = cardsDrawerPanelShowing(state);
    this._presentationMode = state.app.presentationMode;
    this._mobileMode = state.app.mobileMode;
    this._cardHasStar = getCardHasStar(state, this._card ? this._card.id : "");
    this._cardIsRead = getCardIsRead(state, this._card ? this._card.id : "");
    this._collection = selectExpandedActiveCollection(state);
    this._stars = state.user.stars;
    this._reads = state.user.reads;
    this._drawerReorderPending = state.data.reorderPending;
    this._activeSectionId = selectActiveSectionId(state);
    this._dataIsFullyLoaded = selectDataIsFullyLoaded(state);
  }

  _changedPropsAffectCanvasSize(changedProps) {
    let sizeProps = [
      '_headerPanelOpen',
      '_commentsPanelOpen',
      '_cardInfoPanelOpen',
      '_cardsDrawerPanelShowing',
      '_editing'
    ]
    for (let item of sizeProps) {
      if (changedProps.has(item)) return true;
    }
    return false;
  }

  _resizeCard() {
    let fontSize = 20;
    const canvas = this.shadowRoot.getElementById("canvas");
    if (!canvas) {
      console.warn("Couldn't find canvas element");
      return;
    }

    const rect = canvas.getBoundingClientRect();


    const paddingInPx = Math.round(rect.width / 12);
    //Next two come from the style for base-card
    const cardWidthInEms = 43.63;
    const cardWidthPaddingInEms = 2 * (1.45);

    const cardHeightInEms = 24.54;
    const cardHeightPaddingInEms = 2 * (1.0);

    const totalCardWidthInEms = cardWidthInEms + cardWidthPaddingInEms;
    const totalCardHeighInEms = cardHeightInEms + cardHeightPaddingInEms;

    let targetWidth = rect.width - paddingInPx;
    //TODO: take into account size of actions bar.
    //On small screens don't worry about any vertical padding.
    let targetHeight = rect.height - (this._mobileMode ? 0 : paddingInPx);

    let widthFontSize = Math.round(targetWidth / totalCardWidthInEms);
    let heightFontSize = Math.round(targetHeight / totalCardHeighInEms);

    //Pick the smaller of the two
    fontSize = widthFontSize;
    if (heightFontSize < fontSize) fontSize = heightFontSize;

    const renderer = this.shadowRoot.querySelector('card-renderer');
    if (!renderer) {
      console.warn("Couldn't find card-renderer to update its size");
      return;
    }

    renderer.style.fontSize = '' + fontSize + 'px';
  }

  firstUpdated(changedProps) {
    window.addEventListener('resize', e => this._resizeCard());
  }

  updated(changedProps) {
    if (changedProps.has('_pageExtra')) {
      if (this._pageExtra) {
        store.dispatch(updateCardSelector(this._pageExtra))
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
    if (this._changedPropsAffectCanvasSize(changedProps)) Promise.resolve().then(() => this._resizeCard());
  }
}

window.customElements.define('card-view', CardView);
