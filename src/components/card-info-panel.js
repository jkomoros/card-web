import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';
import { repeat } from 'lit-html/directives/repeat';

// This element is connected to the Redux store.
import { store } from '../store.js';

import {
  cardSelector,
  sectionTitle
} from '../reducers/data.js';

import {
  PageViewElement
} from './page-view-element.js';

import {
  prettyTime
} from '../actions/util.js';

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
          color: var(--app-dark-text-color);
        }
        h3 {
          margin:0;
          font-weight:normal;
          color: var(--app-dark-text-color-light);
        }
        div>h4 {
          font-size:0.7em;
          font-weight:normal;
          margin:0;
        }
        div>p {
          margin:0;
        }
        div>ul {
          margin:0;
          padding-inline-start: 1.2em;
        }
        .container > div {
          margin: 0.5em 0;
        }
      </style>
      <div class='container' ?hidden=${!this._open}>
        <h3>Card Info</h3>
        <div>
          <h4>ID</h4>
          <p>${this._card.id}</p>
        </div>
        <div>
          <h4>Name</h4>
          <p>${this._card.name}</p>
        </div>
        <div>
          <h4>Slugs</h4>
          ${this._card && this._card.slugs && this._card.slugs.length 
            ? html`<ul>${this._card.slugs.map((item) => html`<li>${item}</li>`)}</ul>`
            : html`<p><em>No slugs</em></p>`
          }
        </div>
        <div>
          <h4>Section</h4>
          <p>${this._sectionTitle}</p>
        </div>
        <div>
          <h4>Last Updated</h4>
          <p>${prettyTime(this._card.updated_substantive)}</p>
        </div>
        <div>
          <h4>Created</h4>
          <p>${prettyTime(this._card.created)}</p>
        </div>
      </div>
    `;
  }

  static get properties() {
    return {
      _open: {type: Boolean},
      _card: {type: Object},
      _sectionTitle: { type: String}
    }
  }

  stateChanged(state) {
    this._open = state.app.cardInfoPanelOpen;
    this._card = cardSelector(state);
    this._sectionTitle = sectionTitle(state, this._card ? this._card.section : "");
  }

}

window.customElements.define('card-info-panel', CardInfoPanel);
