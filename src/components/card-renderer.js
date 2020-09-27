import { LitElement, html } from '@polymer/lit-element';

import './content-card.js';
import './section-head-card.js';

// This element is *not* connected to the Redux store.
export class CardRenderer extends LitElement {
	render() {
		return html`
      <style>
        [hidden] {
          display:none;
        }
      </style>
      <section-head-card .dataIsFullyLoaded=${this.dataIsFullyLoaded} ?hidden=${this._cardType != 'section-head'} .updatedFromContentEditable=${this.updatedFromContentEditable} .editing=${this.editing} .card=${this.card}></section-head-card>
      <content-card .dataIsFullyLoaded=${this.dataIsFullyLoaded} ?hidden=${this._cardType != 'content'} .updatedFromContentEditable=${this.updatedFromContentEditable} .editing=${this.editing} .card=${this.card}></content-card>
    `;
	}

	static get properties() {
		return {
			editing : { type:Boolean },
			card: { type: Object },
			updatedFromContentEditable: {type:Object},
			dataIsFullyLoaded: {type:Boolean},
		};
	}

	get _cardType() {
		return this.card && Object.keys(this.card).length ? this.card.card_type : 'content';
	}
}

window.customElements.define('card-renderer', CardRenderer);
