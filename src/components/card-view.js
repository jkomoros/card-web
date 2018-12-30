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
  closeCardInfoPanel
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
  infoIcon
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

        .card {
          flex-grow:1;
          display:flex;
          flex-direction:column;
          justify-content:center;
          align-items: center;
          background-color: var(--app-divider-color);
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
      </style>
      <div class='container${this._editing ? ' editing' : ''}'>
        <card-drawer></card-drawer>
        <div class='card'>
          <card-renderer .editing=${this._editing} .card=${this._displayCard}></card-renderer>
          <div class='actions'>
            <button class='round' ?hidden='${!this._userMayEdit}' @click='${this._handleEditClicked}'>${editIcon}</button>
            <button class='round ${this._commentsPanelOpen ? 'selected' : ''} ${this._activeCardHasComments ? 'primary' : ''}' @click='${this._handleCommentsClicked}'>${forumIcon}</button>
            <button class='round ${this._cardInfoPanelOpen ? 'selected' : ''}' @click='${this._handleCardInfoClicked}'>${infoIcon}</button>
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
      _activeCardHasComments: {type:Boolean},
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

  stateChanged(state) {
    this._editingCard = state.editor.card;
    this._card = cardSelector(state);
    this._displayCard = this._editingCard ? this._editingCard : this._card;
    this._cardIdOrSlug = this.extractPageExtra(state.app.pageExtra)[0];
    this._editing = state.editor.editing;     
    this._userMayEdit = userMayEdit(state);
    this._commentsPanelOpen = state.app.commentsPanelOpen;
    this._cardInfoPanelOpen = state.app.cardInfoPanelOpen;
    this._activeCardHasComments = activeCardHasComments(state);
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
  }
}

window.customElements.define('card-view', CardView);
