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
      </style>
      <div class='container'>
        <card-drawer></card-drawer>
        <div class='card'>
          <content-card title="${this._card.title}" body="${this._card.body}">
          </content-card>
        </div>
      </div>
    `;
  }

  static get properties() {
    return {
      _card: { type: Object },
      _cardIdOrSlug: { type: String }
    }
  }

  extractPageExtra(pageExtra) {
    return pageExtra.split("/")[0];
  }

  stateChanged(state) {
    this._card = cardSelector(state);
    this._cardIdOrSlug = this.extractPageExtra(state.app.pageExtra);
  }

  updated(changedProps) {
    if (changedProps.has('_cardIdOrSlug')) {
      store.dispatch(showCard(this._cardIdOrSlug));
    }
    if (changedProps.has('_card') && this._card) {
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
