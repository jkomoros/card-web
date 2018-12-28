import { LitElement, html } from '@polymer/lit-element';

import {ContentCard} from './content-card.js';

// This element is *not* connected to the Redux store.
class CenteredCard extends ContentCard {
  innerRender() {
    return html`
      <style>
        section {
          height:100%;
          width:100%;
          display:flex;
          flex-direction:column;
          justify-content:center;
          align-items:center;
        }
      </style>
      <section>${this._makeSection(this.body)}</section>
    `;
  }
}

window.customElements.define('centered-card', CenteredCard);
