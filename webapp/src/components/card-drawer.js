import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { collectionSelector } from '../reducers/data.js'

class CardDrawer extends connect(store)(LitElement) {
  render() {
    console.log(this._collection);
    return html`
      A card drawer will be rendered here.
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
