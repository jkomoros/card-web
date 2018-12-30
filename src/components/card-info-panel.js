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
          min-width: 12em;
          height:100%;
          padding:0.5em;
          border-left: 1px solid var(--app-divider-color);
          position:relative;
        }

        h3 {
          margin:0;
          font-weight:normal;
          color: var(--app-dark-text-color-light);
        }
      </style>
      <div class='container' ?hidden=${!this._open}>
        <h3>Card Info</h3>
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
