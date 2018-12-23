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
  navigateToCard
} from '../actions/app.js';

//Components needed by this
import './content-card.js';
import './card-drawer.js';
import './card-editor.js';

import {
  modifyCard
} from '../actions/data.js';

// These are the shared styles needed by this element.
import { SharedStyles } from './shared-styles.js';

class CardView extends connect(store)(PageViewElement) {
  render() {
    return html`
      ${SharedStyles}
      <style>
        :host {
          position: absolute;
          height: 100%;
          width: 100%;
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
        }
        card-editor {
          display:none;
        }
        card-editor[active] {
          display:block;
        }
      </style>
      <div class='container'>
        <card-drawer></card-drawer>
        <div class='card'>
          <content-card title="${this._card.title}" body="${this._card.body}">
          </content-card>
          <card-editor ?active=${this._editing} .card=${this._card}></card-editor>
        </div>
      </div>
    `;
  }

  static get properties() {
    return {
      _card: { type: Object },
      _cardIdOrSlug: { type: String },
      _editing: {type: Boolean }
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

  stateChanged(state) {
    this._card = cardSelector(state);
    let cardId;
    let editing;
    [cardId, editing] = this.extractPageExtra(state.app.pageExtra);
    this._cardIdOrSlug = cardId;
    this._editing = editing;
  }

  updated(changedProps) {
    if (changedProps.has('_cardIdOrSlug')) {
      store.dispatch(showCard(this._cardIdOrSlug));
    }
    if (changedProps.has('_card') && this._card && this._card.name) {
      //Ensure that the article name that we're shwoing--no matter how they
      //havigated here--is the preferred slug name.
      if (this._card.name != this._cardIdOrSlug) {
        //Deliberately do not call the navigate sction cretator, since this
        //should be a no-op.
        store.dispatch(navigateToCard(this._card, true));
      }
    }
  }
}

window.customElements.define('card-view', CardView);
