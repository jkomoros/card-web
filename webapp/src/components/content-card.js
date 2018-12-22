import { LitElement, html } from '@polymer/lit-element';

import {BaseCard} from './base-card.js';

// This element is *not* connected to the Redux store.
class ContentCard extends BaseCard {
  innerRender() {
    return html`
      <style>

        @import url('https://fonts.googleapis.com/css?family=Raleway:400,700');
        @import url('https://fonts.googleapis.com/css?family=Source+Sans+Pro:400,700');

        h1 {
          font-family: 'Raleway', sans-serif;
          font-weight:bold;
          color: var(--app-primary-color);
          margin-top:0;
          font-size:32px;
        }

        * {
          font-family: 'Source Sans Pro', sans-serif;
          font-size: 22px;
          color: var(--app-dark-text-color);
          background-color:transparent;
        }

        a {
          color: var(--app-primary-color);
        }

        a[card] {
          color: var(--app-secondary-color);
        }

      </style>
      <h1>${this.title}</h1>
      ${this._makeSection(this.body)}
    `;
  }

  static get properties() {
    return {
      title: { type: String },
      body: { type: String },
    }
  }

  _updateA(a) {
    if (a.href) {
      a.target = "_blank";
    }
    var card = a.getAttribute('card');
    if (!card) return;
    a.href = "/c/" + card;
  }

  _makeSection(body) {
    const section = document.createElement("section");
    section.innerHTML = body;
    section.querySelectorAll('a').forEach(this._updateA)
    return section;
  }
}

window.customElements.define('content-card', ContentCard);
