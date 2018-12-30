import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import {
  cardSelector
} from '../reducers/data.js';

import {
  PageViewElement
} from './page-view-element.js';

class CardInfoPanel extends connect(store)(PageViewElement) {
  render() {
    return html`
      <style>
        .container {
          min-width:6em;
        }
      </style>
      <div class='container' ?hidden=${!this._open}>
        <h2>This is an info panel</h2>
      </div>
    `;
  }

  static get properties() {
    return {
      _open: {type: Boolean},
      _card: {type: Object},
    }
  }

  stateChanged(state) {
    this._open = state.app.cardInfoPanelOpen;
    this._card = cardSelector(state);
  }

}

window.customElements.define('card-info-panel', CardInfoPanel);
