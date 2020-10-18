import { LitElement, html } from '@polymer/lit-element';

import {
	CARD_TYPE_CONTENT,
	CARD_TYPE_SECTION_HEAD,
	CARD_TYPE_WORKING_NOTES,
} from '../card_fields.js';

import './content-card.js';
import './section-head-card.js';
import './working-notes-card.js';

// This element is *not* connected to the Redux store.
export class CardRenderer extends LitElement {
	render() {
		switch(this._cardType) {
		case CARD_TYPE_SECTION_HEAD:
			return html` <section-head-card .dataIsFullyLoaded=${this.dataIsFullyLoaded} ?hidden=${this._cardType != CARD_TYPE_SECTION_HEAD} .updatedFromContentEditable=${this.updatedFromContentEditable} .editing=${this.editing} .card=${this.card}></section-head-card>`;
		case CARD_TYPE_WORKING_NOTES:
			return html`<section-head-card .dataIsFullyLoaded=${this.dataIsFullyLoaded} ?hidden=${this._cardType != CARD_TYPE_WORKING_NOTES} .updatedFromContentEditable=${this.updatedFromContentEditable} .editing=${this.editing} .card=${this.card}></section-head-card>`;
		case CARD_TYPE_CONTENT:
		default:
			return html`<content-card .dataIsFullyLoaded=${this.dataIsFullyLoaded} ?hidden=${this._cardType != CARD_TYPE_CONTENT} .updatedFromContentEditable=${this.updatedFromContentEditable} .editing=${this.editing} .card=${this.card}></content-card>`;
		}
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
