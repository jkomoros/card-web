import { LitElement, html } from '@polymer/lit-element';

import './card-renderer.js';

class CardPreview extends LitElement {
	render() {
		return html`
      <style>
        :host {
          position:absolute;
          right: 1em;
          bottom: 1em;
        }

        card-renderer {
          /* font-size is the primary way to affect the size of a card-renderer */
          font-size: 10px;
        }

      </style>
      <div ?hidden='${!this.card}'>
        <card-renderer .card=${this.card}></card-renderer>
      </div>
    `;
	}

	static get properties() { 
		return {
			card: {type: Object},
		};
	}
  

}

window.customElements.define('card-preview', CardPreview);
