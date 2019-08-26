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
          /* TODO: this z-index ia a bit of a hack to make sure it shows up
          above e.g. dialogs, which are 1000 */
          z-index: 10001;
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
