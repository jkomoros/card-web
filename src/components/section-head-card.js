import { html } from '@polymer/lit-element';

import {BaseCard} from './base-card.js';

// This element is *not* connected to the Redux store.
class SectionHeadCard extends BaseCard {
	innerRender() {
		return html`
      <style>
        .background {
          position:absolute;
          height:50%;
          bottom:0;
          width:100%;
          background-color: var(--app-primary-color);
          /* counteract the padding in the base card */
          margin-left:-1.45em;
        }
        h1 {
          font:var(--app-header-font-family);
          font-weight:bold;
          font-size:3.0em;
          margin-top:2.25em;
        }
        h2 {
          color: var(--app-primary-color-subtle);
          font-size:1.2em;
          font-weight:normal;
          position:absolute;
          bottom:1em;
        }
      </style>
      <div class='background'></div>
      <h1>${this.title ? this.title : html`<span class='loading'>Loading...<span>`}</h1>
      <h2>${this.subtitle}</h2>
    `;
	}

	static get properties() {
		return {
			title: { type: String },
			subtitle: { type: String },
		};
	}
}

window.customElements.define('section-head-card', SectionHeadCard);
