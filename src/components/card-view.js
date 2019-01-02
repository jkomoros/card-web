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

import { cardSelector } from '../reducers/data.js'

import { showCard } from '../actions/data.js'

import {
  userMayEdit
} from '../reducers/user.js';

import {
  editingStart
} from '../actions/editor.js';

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
  arrowForwardIcon
} from './my-icons.js';

import {
  modifyCard
} from '../actions/data.js';

import {
  activeCardHasComments
} from '../reducers/comments.js';

import comments from '../reducers/comments.js';
store.addReducers({
  comments
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

        #canvas {
          flex-grow:1;
          /* The next two properties mean that we take up as much space as we're given, and our content doesn't create a floor of size */
          flex-basis:1;
          overflow:hidden;
          display:flex;
          flex-direction:column;
          justify-content:center;
          align-items: center;
          background-color: var(--app-divider-color);
        }

        .presentation-actions {
          position:absolute;
          bottom:0.5em;
          right:0.5em;
        }

        .actions {
          /* This is a hack to allow the information/edit buttons to be on top of a section-head-card container. See #44. */
          z-index: 1;
        }

        card-editor {
          display:none;
        }
        card-editor[active] {
          display:block;
          width:100%;
          flex-grow:1;
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

      </style>
      <div class='container${this._editing ? ' editing' : ''}'>
        <card-drawer></card-drawer>
        <div id='canvas'>
          <div class='presentation-actions' ?hidden=${!this._presentationMode}>
            <button class='round' @click=${this._handleBackClicked}>${arrowBackIcon}</button>
            <button class='round' @click=${this._handleForwardClicked}>${arrowForwardIcon}</button>
            <button class='round ${this._presentationMode ? 'selected' : ''}' @click=${this._handlePresentationModeClicked}>${fullScreenIcon}</button>
          </div>
          <card-renderer .editing=${this._editing} .card=${this._displayCard} .fromContentEditable=${this._fromContentEditable} @body-updated=${this._handleBodyUpdated}></card-renderer>
          <div class='actions' ?hidden=${this._presentationMode}>
            <button class='round ${this._presentationMode ? 'selected' : ''}' @click=${this._handlePresentationModeClicked}>${fullScreenIcon}</button>
            <button class='round ${this._cardsDrawerPanelOpen ? 'selected' : ''}' @click=${this._handleCardsDrawerClicked}>${viewDayIcon}</button>
            <button class='round ${this._commentsPanelOpen ? 'selected' : ''} ${this._activeCardHasComments ? 'primary' : ''}' @click='${this._handleCommentsClicked}'>${forumIcon}</button>
            <button class='round ${this._cardInfoPanelOpen ? 'selected' : ''}' @click='${this._handleCardInfoClicked}'>${infoIcon}</button>
            <button class='round' ?hidden='${!this._userMayEdit}' @click='${this._handleEditClicked}'>${editIcon}</button>
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
      _cardIdOrSlug: { type: String },
      _editing: {type: Boolean },
      _userMayEdit: { type: Boolean },
      _displayCard: { type: Object },
      _editingCard: { type: Object },
      _commentsPanelOpen: {type: Boolean},
      _cardInfoPanelOpen: {type: Boolean},
      _cardsDrawerPanelOpen: {type:Boolean},
      _cardsDrawerPanelShowing: {type: Boolean},
      _headerPanelOpen: {type: Boolean},
      _activeCardHasComments: {type:Boolean},
      _fromContentEditable: {type:Boolean},
      _presentationMode: {type:Boolean}
    }
  }

  modifyTitle() {
    let title = prompt("What should the new title be for this card?", this._card.title);
    if (!title) return;
    store.dispatch(modifyCard(this._card, {title:title}, false));
  }

  extractPageExtra(pageExtra) {
    let parts = pageExtra.split("/");
    let cardId = parts[0];
    let editing = false;
    if (parts[1] == 'edit') editing = true;

    return [cardId, editing]
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

  _handleBackClicked(e) {
    store.dispatch(navigateToPreviousCard());
  }

  _handleForwardClicked(e) {
    store.dispatch(navigateToNextCard());
  }

  stateChanged(state) {
    this._editingCard = state.editor.card;
    this._card = cardSelector(state);
    this._displayCard = this._editingCard ? this._editingCard : this._card;
    this._cardIdOrSlug = this.extractPageExtra(state.app.pageExtra)[0];
    this._editing = state.editor.editing;     
    this._userMayEdit = userMayEdit(state);
    this._headerPanelOpen = state.app.headerPanelOpen;
    this._commentsPanelOpen = state.app.commentsPanelOpen;
    this._cardInfoPanelOpen = state.app.cardInfoPanelOpen;
    //Note: do NOT use this for whether the panel is showing.
    this._cardsDrawerPanelOpen = state.app.cardsDrawerPanelOpen;
    this._activeCardHasComments = activeCardHasComments(state);
    this._fromContentEditable = state.editor.fromContentEditable;
    this._cardsDrawerPanelShowing = cardsDrawerPanelShowing(state);
    this._presentationMode = state.app.presentationMode;
  }

  _ensureUrlShowsName() {
    //Ensure that the article name that we're shwoing--no matter how they
    //havigated here--is the preferred slug name.
    if (!this._card || !this._card.name) return;
    if (this._card.name != this._cardIdOrSlug) {
      //Deliberately do not call the navigate sction cretator, since this
      //should be a no-op.
      store.dispatch(navigateToCard(this._card, true));
    }
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

    //TODO: do calculation for height and width and take the fontSize that's smaller.
    const widthPaddingInPx = 100;
    //Next two come from the style for base-card
    const cardWidthInEms = 43.63;
    const cardWidthPaddingInEms = 2 * (1.45);
    const totalCardWidthInEms = cardWidthInEms + cardWidthPaddingInEms;

    let targetWidth = rect.width - widthPaddingInPx;
    fontSize = Math.round(targetWidth / totalCardWidthInEms);

    const renderer = this.shadowRoot.querySelector('card-renderer');
    if (!renderer) {
      console.warn("Couldn't find card-renderer to update its size");
      return;
    }

    renderer.style.fontSize = '' + fontSize + 'px';
  }

  updated(changedProps) {
    if (changedProps.has('_cardIdOrSlug')) {
      if (this._cardIdOrSlug) {
        store.dispatch(showCard(this._cardIdOrSlug))
      } else {
        //Dispatching to '' will use default;
        store.dispatch(navigateToCard(''));
      }
    }
    if (changedProps.has('_editing') && !this._editing) {
      //Verify that our URL shows the canoncial name, which may have just
      //changed when edited.
      this._ensureUrlShowsName();
    }
    if (changedProps.has('_card') && this._card && this._card.name) {
      this._ensureUrlShowsName();
    }
    if (this._changedPropsAffectCanvasSize(changedProps)) Promise.resolve().then(() => this._resizeCard());
  }
}

window.customElements.define('card-view', CardView);
