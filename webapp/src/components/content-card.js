import { LitElement, html } from '@polymer/lit-element';

import './base-card.js';

// This element is *not* connected to the Redux store.
class ContentCard extends LitElement {
  render() {
    const subTemplate = html(this.body);
    return html`
      <style>

        @import url('https://fonts.googleapis.com/css?family=Raleway:400,700');
        @import url('https://fonts.googleapis.com/css?family=Source+Sans+Pro:400,700');

        h1 {
          font-family: 'Raleway', sans-serif;
          font-weight:bold;
          color: var(--app-primary-color);
          margin-top:0;
        }

        ::slotted(*) {
          font-family: 'Source Sans Pro', sans-serif;
          font-size: 22px;
          color: var(--app-dark-text-color);
          background-color:transparent;
        }

        a {
          color: var(--app-secondary-color);
        }
      </style>
      <base-card>
        <h1>${this.title}</h1>
        ${this._makeSection(this.body)}
      </base-card>
    `;
  }

  static get properties() {
    return {
      title: { type: String },
      body: { type: String },
    }
  }

  _makeSection(body) {
    const section = document.createElement("section");
    section.innerHTML = body;
    return section;
  }
}

window.customElements.define('content-card', ContentCard);
