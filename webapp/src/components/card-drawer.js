import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';
import { repeat } from 'lit-html/directives/repeat';

// This element is connected to the Redux store.
import { store } from '../store.js';

import './card-thumbnail.js';

import {
  navigateToCard
} from '../actions/app.js';

import { collectionSelector } from '../reducers/data.js'

class CardDrawer extends connect(store)(LitElement) {
  render() {
    return html`
      <style>
        .container {
          overflow:scroll;
          max-height:100%;
        }
      </style>
      <div class='container'>
      ${repeat(this._collection, (i) => i.id, (i, index) => html`
        <card-thumbnail @thumbnail-tapped=${this._thumbnailActivatedHandler} .id=${i.id} .title=${i.title} .selected=${i.id == this._activeCard}></card-thumbnail>`)}
      </div>
    `;
  }

  _thumbnailActivatedHandler(e) {
    store.dispatch(navigateToCard(e.target.id));
  }

  static get properties() { return {
    _collection: { type: Array },
    _activeCard: { type: String }
  }}

  // This is called every time something is updated in the store.
  stateChanged(state) {
    this._collection = collectionSelector(state);
    this._activeCard = state.data.activeCard;
  }
}

window.customElements.define('card-drawer', CardDrawer);
