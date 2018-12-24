import { LitElement, html } from '@polymer/lit-element';

import './content-card.js';

// This element is *not* connected to the Redux store.
export class CardRenderer extends LitElement {
  render() {
    return html`
      <content-card .editing=${this.editing} title="${this.card && this.card.title ? this.card.title : ""}" body="${this.card && this.card.body ? this.card.body : ""}"></content-card>
    `;
  }

  static get properties() {
    return {
      editing : { type:Boolean },
      card: { type: Object }
    }
  }

}

window.customElements.define('card-renderer', CardRenderer);
