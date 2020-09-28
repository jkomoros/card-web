import { LitElement, html } from '@polymer/lit-element';

import {
	CARD_TYPE_CONTENT,
	CARD_TYPE_SECTION_HEAD
} from '../card_fields.js';

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
      <section-head-card .dataIsFullyLoaded=${this.dataIsFullyLoaded} ?hidden=${this._cardType != CARD_TYPE_SECTION_HEAD} .updatedFromContentEditable=${this.updatedFromContentEditable} .editing=${this.editing} .card=${this.card}></section-head-card>
      <content-card .dataIsFullyLoaded=${this.dataIsFullyLoaded} ?hidden=${this._cardType != CARD_TYPE_CONTENT} .updatedFromContentEditable=${this.updatedFromContentEditable} .editing=${this.editing} .card=${this.card}></content-card>
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
		return this.card && Object.keys(this.card).length ? this.card.card_type : CARD_TYPE_CONTENT;
	}
}

window.customElements.define('card-renderer', CardRenderer);
