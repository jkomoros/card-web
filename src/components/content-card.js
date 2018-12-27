import { LitElement, html } from '@polymer/lit-element';

import {BaseCard} from './base-card.js';

let loadingTemplate = html`<span class='loading'>Loading...<span>`
let blankTemplate = html`<span class='loading'>Content goes here...</span>`

// This element is *not* connected to the Redux store.
class ContentCard extends BaseCard {
  innerRender() {
    return html`
      <style>

        h1 {
          font-family: 'Raleway', sans-serif;
          font-weight:bold;
          color: var(--app-primary-color);
          margin-top:0;
          font-size:1.45em;
        }

        section {
          font-family: 'Source Sans Pro', sans-serif;
          font-size: 1em;
          color: var(--app-dark-text-color);
          background-color:transparent;
        }

        .small {
          font-size:0.72em;
        }

        .loading {
          font-style:italic;
          opacity: 0.5;
        }

      </style>
      <h1>${this.title ? this.title : this._emptyTemplate}</h1>
      ${this._makeSection(this.body)}
    `;
  }

  static get properties() {
    return {
      title: { type: String },
      body: { type: String },
      id: {type: String},
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

  get _emptyTemplate() {
    return this.id ? blankTemplate : loadingTemplate;
  }

  _makeSection(body) {
    if (!body) {
      return this._emptyTemplate;
    }
    const section = document.createElement("section");
    section.innerHTML = body;
    section.querySelectorAll('a').forEach(this._updateA)
    return section;
  }
}

window.customElements.define('content-card', ContentCard);
