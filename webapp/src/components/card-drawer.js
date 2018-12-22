import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';
import { repeat } from 'lit-html/directives/repeat';

// This element is connected to the Redux store.
import { store } from '../store.js';

import './card-thumbnail.js';

import { collectionSelector } from '../reducers/data.js'

class CardDrawer extends connect(store)(LitElement) {
  render() {
    console.log(this._collection);
    return html`
      <ul>
      ${repeat(this._collection, (i) => i.id, (i, index) => html`
        <card-thumbnail .title=${i.title}></card-thumbnail>`)}
      </ul>
    `;
  }

  static get properties() { return {
    _collection: { type: Array }
  }}

  // This is called every time something is updated in the store.
  stateChanged(state) {
    this._collection = collectionSelector(state);
  }
}

window.customElements.define('card-drawer', CardDrawer);
