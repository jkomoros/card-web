import { LitElement, html } from '@polymer/lit-element';

import './base-card.js';

// This element is *not* connected to the Redux store.
class ContentCard extends LitElement {
  render() {
    const subTemplate = html(this.body);
    return html`
      <base-card>
        <h1>${this.title}</h1>
        <section>
          <slot></slot>
        </section>
      </base-card>
    `;
  }

  static get properties() {
    return {
      title: { type: String },
      body: {type: String}
    }
  }
}

window.customElements.define('content-card', ContentCard);
