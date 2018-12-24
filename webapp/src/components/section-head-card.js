import { LitElement, html } from '@polymer/lit-element';

import {BaseCard} from './base-card.js';

// This element is *not* connected to the Redux store.
class SectionHeadCard extends BaseCard {
  innerRender() {
    return html`
      <h1>${this.title ? this.title : html`<span class='loading'>Loading...<span>`}</h1>
      <h2>${this.subtitle}</h2>
    `;
  }

  static get properties() {
    return {
      title: { type: String },
      subtitle: { type: String },
    }
  }
}

window.customElements.define('section-head-card', SectionHeadCard);
